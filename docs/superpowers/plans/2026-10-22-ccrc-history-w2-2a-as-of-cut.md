# ccrc history wave W2-2a: the as-of cut, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W2's as-of cut in ONE PR on `main`, on the fleet lane after W2-1 (#1105) merged, beside W2-5a, whose files are disjoint. Under a cut at boundary N, every read verb treats a row, node or epoch the cut hides exactly as if it were not stored, at every door: a hit, a gist, a leaf id, a prefix, an ambiguity, a header count, a cursor, the regex child and an exit code. This PR builds the cut and applies it wherever it must apply. It does not let a session set one: the cut applies only when `rc.scope.cut` is set, and in this PR only an in-process caller (the tests) sets it. W2-2b's headless seam is the first production caller, at W2-D46 step 7 (R3). Task by task:
- **Task 1 (W2-D34, W2-D38, W2-D39's word).** Lib's one definition of the cut. `asOfCut({ asof, boundary, copy, kept })` decides the cut from what a reader measured and answers `{ ok: true, cut }`, `cut` holding exactly W2-D38's seven fields, or exit 2 `asof-invalid`. `asOfEntrySql(alias)` is the one SQL predicate over an `entries` alias, with named `asof_*` parameters only, and `asOfBinds(cut)` answers exactly their values (R1). `asof-invalid` joins `REASON_ROWS`' exit-2 list after W2-1's two words, beside D-5765's comment.
- **Task 2 (W2-D35's entry side, W2-D36, W2-D39's store half).** recall.mjs gains `asOfCutOf(rc, asof)`, the measuring half that hands lib `asOfCut` its inputs (R2), and splices the predicate into every statement that returns or counts entries: `referrerSql`'s three arms (before `GREP_FILTER`, the ranking, `LIMIT :pool` and `countSql`), expand's uuid lookup (a hidden uuid is exit 3, never `out-of-scope`), `--around` before its LIMIT, a node's lineage, and the paired-path walk. `VERB_TABLES.grep` gains `'memberships'` (R5).
- **Task 3 (W2-D35, W2-D36).** The node cut. A leaf is visible iff its boundary entry is; a parent iff every leaf under it is, whenever it was formed; an epoch iff one of its transcripts holds a visible entry. Lib gains `asOfHiddenNodesSql`, `asOfVisibleEpochsSql` and `asOfVisibleEntriesSql`, built on the predicate. recall.mjs applies them at `coveringLeaves` (C31), `leafHeads` (exported as a test seam), `scopePrefixes`, `runTree`, `resolveNodeInScope` (describe, `grep --node`, expand's node target), describe's parent and children (`childRowsOf`), and describe's entry doors `sourcesOf` and `producerOfLeaf` (R5). A leafless `condensed` node is hidden (R4), so describe drops one from a visible parent's children. Under a cut describe also drops a node's refs mined from source rows (origin `tool_use`), and the `files` derived from them, when a source row under it, its own or a descendant leaf's, is hidden; refs of origin `model` and `meta` stay (R8, SEC-2). `VERB_TABLES.tree` gains `'memberships'`.
- **Task 4 (W2-D37, W2-D38).** The remaining doors: the regex child's job gains a required `cut` key (the parent's binds, or null) and the child applies lib's predicate; grep's cursor key hashes `asof` and expand's key gains `:asof:<uuid>` (lib's `expandCursorKey`), each only under a cut; the header and the `--json` scope count, name and read the lag over `visibleScope(rc)`, and the `--json` scope is defined once, as recall.mjs's `scopeJsonOf` (cli.mjs's twin is deleted); tree's per-family heading reads `visibleScope(rc).families`, so a family with no visible epoch is never named by tree (R8, SEC-1).
- **Task 5 (W2-D39's CLI half, W2-D45's in-pane half).** `readContextIn` reads `CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM` and `CCRC_RECALL_ASOF`, once each, by name; lib's `decideSeamInPane` (over `recallSeamEngaged`) answers exit 2 `headless-in-pane` when `TMUX_PANE` is defined (`''` included) and any of the three is non-empty, after the Darwin and role rows and before any tmux spawn. The `process.env` allow-list grows from four names to seven in place.
- **Task 6.** The whole-PR checks (the file list, D-5765 and D-5766 once each, the spec unchanged, lib's 67 redaction declarations byte-identical, the census of the cut's doors, every history suite alone), then the PR body and the PR.

Sessions see no change in behaviour. With no cut, every statement, answer, cursor and job is byte for byte the base's (W2-D45). The one new answer a session can reach is `headless-in-pane`, and only when a seam variable is set inside a pane, which no shipped caller does. The hook, `ccd`, `ccd/ccd-history-sweep` and the wire are untouched. The rollout is part of W2's final release (W2-D6), the operator's, never the worker's.

**Architecture:** Fleet-side `ccd/history/*` only. Ring membership is a property of a file's imports. W2-2a applies the cut only when `rc.scope.cut` is set: W2-2a's tests set it in process, and W2-2b's headless seam sets it in production (W2-D46, R3).

*L1 `ccd/history/lib.mjs`* (imports `node:crypto` only; it returns SQL text and binds and runs none) decides:
- `asOfCut`, `asOfEntrySql`, `asOfBinds` and `asof-invalid` in `REASON_ROWS` (Task 1); `VERB_TABLES.grep`'s `'memberships'` (Task 2);
- `asOfHiddenNodesSql`, `asOfVisibleEpochsSql`, `asOfVisibleEntriesSql` and `VERB_TABLES.tree`'s `'memberships'` (Task 3);
- the module-private `ASOF_KEY_SEP`, the exported `expandCursorKey`, and `expandResumeOf`'s suffix strip (Task 4);
- `recallSeamEngaged` and `decideSeamInPane` (Task 5).

*L4* measures and applies lib's answers, deciding nothing:
- `ccd/history/recall.mjs`: `asOfCutOf`, the helpers `cutOf`, `cutTerm`, `cutAnd`, `cutBinds`, `visibleEntryIds`, `uuidVisible` and `aroundRows`, and every entry site (Task 2); `cutHiddenNodes`, `cutVisibleEpochs`, `cutVisibleEntries` and `cutHidesASource`, and every node, epoch and describe site, describe's mined refs included (Task 3); `visibleScope`, `scopeJsonOf`, `asOfOf`, `grepKey`, tree's family headings, the regex job's `cut` and expand's cursor key (Task 4). It reads the cut from `rc.scope.cut`, where absent and `null` both mean no cut. `asOfEntrySql` is called once in the file (in `cutTerm`) and `asOfBinds` once (in `cutBinds`).
- `ccd/history/regex-worker.mjs`: `scanRegexJob` requires the job's `cut` key, and `candidateSql(withPrefilter, withCut)` splices lib's predicate. It imports `asOfEntrySql` and spells no predicate (Task 4).
- `ccd/history/cli.mjs`: imports `scopeJsonOf` in place of its deleted `scopeJson` (Task 4); `readContextIn` reads the three seam names and refuses in a pane (Task 5). Nothing in cli.mjs sets `rc.scope.cut`: that is W2-2b's.

*L3 `ccd/history/store.mjs`* stays `node:sqlite`'s sole importer and is not edited: `childrenOf`, `parentOf`, `lineageEntries` and `openReader` are consumed as they are, and recall.mjs filters their answers. `derive.mjs` is not edited: `asOfCutOf` reads kept(N) through its W2-1 exports `keptOf` and `blobReadStmts`, a new recall.mjs to derive.mjs import edge that history-lib's rings pin allows (card.mjs already has one).

No schema migration (the store stays v2), no table, column or index, and `JOURNAL_V` stays 1. The cut reads v1 columns only: `entries.entry_id`, `uuid` and `ts_ms`, `memberships (file_id, entry_id, line)` by its primary key, `boundaries`, `nodes`, `node_children`, `node_sources`, `epochs` and `transcripts`.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`). The read handle is `rc.db`; the regex child opens its own through `openReader`.
- SQLite through `node:sqlite`, named parameters bound by bare name (as `bindFor` does). The new SQL uses `json_each` (kept(N), id lists), `NOT EXISTS` on `memberships`' primary key (the positional hide) and a top-level `WITH RECURSIVE` down `node_children` (the parent rule). No new statement mixes `?` with `:name`.
- vitest in `server/`, in process (rc built by hand, as history-recall's in-process cases do) and through the placed shim with fixture HOMEs (`historyHelpers.ts`). Task 4 calls `scanRegexJob` in process with the parent's captured job. Task 5 spawns the CLI under `withPane`'s tmux stub.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6 as amended in place by W2-1. **W2-2a amends none of it**: E2's `asof-invalid` half and E11 are W2-5b's (decisions §6, W2-D3), and Task 6 checks the spec's diff is empty. Line numbers are hints measured at `cd622b2f6`. The sections this PR implements:
- §8.2's headless seam bullets: `ASOF` "makes every verb treat rows, nodes and epochs after that boundary as absent" (about :1531), from which the time cut departs (D-5766, W2-D34); "Inside a pane: exit 2 `headless-in-pane`" (about :1528).
- §8.3's exit table, the exit-2 row (about :1671), which names no `asof-invalid` until W2-5b's E2; the spelling is this plan's (D-5765).
- §10.1's Seams bullet (about :2618): the `process.env` allow-list admits the three `CCRC_RECALL_*` names from W2.
- The pins: C4's in-pane half (Task 5); C11 under a cut (Task 4's expand cursor case); C16's one word (Task 1); C27 with the cut before the LIMIT (Task 2); C31 in process (Task 3) with its in-pane refusal (Task 5); C59 and C69, which stay green (Tasks 2, 4 and 6).

**Authority:** `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (the W2 decisions document): section 2's "W2-2a (fleet): the as-of cut" entry, section 3 D (W2-D34 to W2-D39), section 3 E (read to know where W2-2a stops), section 6's rows E2 and E11 and section 7's residuals; **W2-D35 and W2-D39 as the coordinator amended them in place in the same docs PR as this plan (R4, R1)**. Then the coordinator's rulings R1 to R8 (Decisions below), then the spec, then the merged code at the base. The decisions document was written at `bd363a76b`, before 5h-1 (#737), W2-3 (#856), W2-4 (#826), 5h-2 (#1010) and W2-1 (#1105) merged; every line it cites is a hint, and "Drifts since the decisions document" below lists what moved. Before editing a function in place, re-read the merged code at the base: plan text is never ground truth.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`: the W2-2a row; "Decisions & deviations" (the W2 block issued 2026-10-19, of which D-5765 and D-5766 are this plan's to define); "Carried constraints"; and the "Later (coordinator), from the build" item on the display doors and the widened rules, which Task 6 Step 3 measures and leaves open. The ledger is the coordinator's file. No task edits it.

**Base:** `main` at `cd622b2f6`, #1105's merge (wave W2-1). It holds every PR W2-2a waits for (W2-D2): W2-1, and through it 5h-1, 5h-2, W2-3 and W2-4. From W2-1 it holds `stampAtOrBefore` in lib (about :6014), `pickHoldingCopy` (about :7360), derive.mjs's exports `blobReadStmts`, `bodyOf` and `keptOf`, and W2-1's two exit-2 words. Each task's Step 0 checks the base or the earlier tasks' names and stops before any edit if they are missing. W2-5a may run beside this PR: its files are disjoint, and Task 6 Step 0 checks that `main` moved no path of this PR.

## Global Constraints

- **One PR, fleet lane.** One commit per task, in task order; Task 6 commits only to correct a figure in this plan's own text (R7). The fleet lane runs one worker at a time (W2-D2), and W2-2a dispatches only when no running worker claims any of its paths (W2-D3).
- **No schema change (W2-D10).** No table, column, index, `SCHEMA_ADDED` entry or migration. `SCHEMA_VERSION` stays 2 (W2-1's pin holds it) and `JOURNAL_V` stays 1.
- **No new file (W2-D5).** No new test file, source file or `.d.mts`, so `ci.yml`'s node-floor heredoc is unchanged. A worker who finds a new file unavoidable stops and reports to the coordinator first.
- **The files this PR may modify:** `ccd/history/recall.mjs`, `ccd/history/regex-worker.mjs`, `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/cli.mjs`; appends to `server/test/history-recall.test.ts`, `history-cli.test.ts`, `history-lib.test.ts` and `single-definition.test.ts` (Task 5 also edits `ALLOWED`'s 4 lines in place); and this plan, only by Task 6's conditional correction.
- **Never touched by this PR:** the spec, `deploy/**`, `shared/**`, `README.md`, `server/test/lifecycle.test.ts`, `ccd/history/derive.mjs`, `sweep.mjs`, `store.mjs` and `card.mjs`, `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccd-history-sweep`, `.github/**`, `CLAUDE.md`, the programme ledger, `ccd/history-skill/SKILL.md` (its exit-2 row is generic, W2-D48), the growth check's machinery (`GROWTH_MACHINERY`) and `growth-waivers.json`. A mutant may edit a file in place, one mutant per tool call, through its task's helpers under `.superpowers/sdd/history-w2-2a/t<N>/` (`mut.sh`: the files are copied there once, and every one is restored and checked with `cmp` when the call exits, a signal included); each task's commit step checks the restore again, and no mutant is committed.
- **The spec stays rev 3.6 with W2-1's errata, byte for byte (W2-D3).** Task 6 Step 1 checks the spec's diff is empty, E11's and E2's rev 3.6 words stand once each, the spec names no `asof-invalid`, and line 3 still reads rev 3.6.
- **Entry guards.** `cli.mjs` and `regex-worker.mjs` end in `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. Every new block goes above it, with no top-level await. Importing cli.mjs runs `process.umask(0o077)` in the importing process, so no in-process test imports cli.mjs, and the measuring half lives in recall.mjs.
- **Single definition (W2-D38).** The cut rule is spelled once, in lib.mjs: `asOfCut`, `asOfEntrySql`, `asOfBinds` and Task 3's three statements are each declared once in lib.mjs and once in `lib.d.mts` (count them: `skipLibCheck` hides a duplicate). recall.mjs calls `asOfEntrySql` once and `asOfBinds` once; regex-worker.mjs imports the predicate and spells no stamp, membership or kept column of its own; `:asof:` is spelled once (`ASOF_KEY_SEP`); the `--json` scope object is built once (`scopeJsonOf`); each `CCRC_RECALL_*` name is read once, dotted, in cli.mjs alone. The rule is keyed on entries, never on blobs.
- **No overloaded null at a seam.** `rc.scope.cut`: absent and `null` mean no cut, and a site with no cut adds no clause and no binds (R1); any other value is a frozen `AsOfCut`. `asOfCut` answers `{ ok: true, cut }` or `{ ok: false, rc: 2, reason: 'asof-invalid' }`, never a cut with missing fields. The regex job's `cut`: absent is a refusal in fixed words (exit 1, fail closed), `null` means no cut. `summaryEntryId: null` matches nothing in SQL.
- **With no cut, nothing changes (W2-D45).** No cut statement is prepared (Task 3's W2-D45 case), the regex job's SQL is the base's text, both cursor keys are the base's (Task 4), and cli.mjs's `--json` envelope keeps its shape (history-cli's existing cases).
- **The security property.** A cut-hidden row, node, epoch, id or count never leaks through ANY door. Every door has a case that shows the hidden thing absent under the cut and a CONTROL on the same fixture, without the cut, that shows it present. Task 6's door table names the task that pins each, and Task 6 Step 4 takes the census.
- **Seams.** The `process.env` allow-list grows from `HOME`, `TMUX_PANE`, `CLAUDECODE` and `CCRC_SESSION_GENERATION` to exactly seven names, adding `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF` and `CCRC_RECALL_SESSION`; a fourth `CCRC_RECALL_*` name is not read (R3). W2-2a reads only whether each seam value is empty: it never validates one, never makes SESSION an identity, never sets a cut from ASOF, never answers exit 8 for ARM, and writes no `arm` on a counter line (all W2-2b's). Test seams are function parameters and in-process `rc` fields; no new env var, flag or file arms one.
- **FIXTURE HOMEs only.** Tests use `historyHelpers.ts` (`makeHistoryBox`, `runSweep`, `runCli`, `withPane`, `seedFamily`, `plantSession`, `plantTranscript`, `openStoreRO`) with `tmux`, `claude`, `gh`, `ssh`, `curl` and the managers poisoned. No step runs `ccd`, `ccrc`, the shim, `sweep.mjs`, `cli.mjs` or any history verb against the live `$HOME`, and no step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. Describes that seed a store or spawn skip on darwin; the pure lib and single-definition cases run there.
- **Running tests.** From the repository root, `(cd server && ./node_modules/.bin/vitest run test/<file>.test.ts -t '<regex>')`, in the foreground, with a timeout of at least 600000 ms and one suite per tool call. Never bare `npx vitest`. Each `-t` filter is regex-safe and selects at least one test: a run that reports only skipped tests selected nothing and is not green. Re-run CLAUDE.md's load flakes alone before calling a red a break.
- **Red-first.** Every new guard is watched red on the unguarded code, with the prediction written before the run; then each mutant in its task's list is measured red, then green again. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. A guard no mutant can red is not added. A mutant whose red differs from its prediction is recorded as measured and reported, never re-predicted. Scratch goes under `.superpowers/sdd/history-w2-2a/` (gitignored), never `git stash`.
- **Never on timing.** No assertion reads a duration. Fixture stamps are fixed integers, `T_N` exactly and `T_N - 1` included.
- **Citation corpus.** `session-hook.test.ts`' citation audit cites `single-definition.test.ts` by line: new describes are appended at the end, the `ALLOWED` edit keeps its 4 lines, and the CITATION DEBT case runs after each edit of that file. `citations.test.ts` refuses an added numeric line citation in code or tests (D-5893). `growth-check.test.ts` (armed, D-6178) lists no file this PR edits: every row reads `delta +0`, and no waiver (D-6223) or exemption (D-6211) is added.
- **Fixtures.** Key-shaped fixtures are assembled at runtime from parts. Fixture paths are synthetic, `/home/u/tree` style. Fixture ids follow ccd's grammar with neutral words.
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body. Task 6 Step 8 runs the private-name count over every added line, every commit message and the PR body; it must print 0.
- **D-numbers.** This plan defines exactly two issued numbers, once each, in "Deviations found" at its end, which lands on `main` with the plan before dispatch (R7): **D-5765** (`history-w2-asof-invalid-word`) and **D-5766** (`history-w2-asof-time-cut`). Task 1 cites both in lib.mjs's comments; no task adds a second definition. Earlier numbers are cited bare: D-4247, D-4675, D-5745, D-5764, D-5774, D-5893, D-6178, D-6211 and D-6223. Never write a number that was not issued, and never a range: cite each number on its own. A departure found while executing takes the next unused number from the run's block named in the brief, defined in "Deviations found" in the commit that first cites it; otherwise it is reported, never invented. Before the PR: `git fetch origin main`, then `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)`.
- **Peers.** Before each first edit of an existing file, read `GET /api/claims?project=ccrc-pwa`. The hot paths are `ccd/history/*.mjs`, the history tests and `single-definition.test.ts`. Whichever PR lands second merges `main` (never a rebase) and keeps both sides.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D34 | **The cut rule.** T_N is boundary N's `ts_ms`, else the newest non-null stamp at or before N in its holding copy (`stampAtOrBefore`, W2-D33); with none, `asof-invalid`. An entry is visible iff it is stamped at or before T_N and is not a row of N's holding copy after N's line, or it is N's boundary entry, N's summary entry, or a member of kept(N) present in the store. The positional-hide CONTROL. Departs from §8.2 (D-5766). | coordinator ruling (W2 decisions document) | 1; 2, 3, 4 consume it |
| W2-D35 | **Nodes, epochs, sidecars and grouping**, as amended in place (R4): a leafless `condensed` node is hidden, "only a damaged store holds one". Variants and sidecars follow their entry, and a sidecar with a NULL `entry_id` is absent (Task 2; the child's join, Task 4). Leaf, parent and epoch rules at `coveringLeaves` (C31's CONTROL), `leafHeads`, `scopePrefixes`, tree, describe and `--node` (Task 3); the epoch rule at the header (Task 4). | coordinator ruling (W2 decisions document, as amended) | 2, 3, 4 |
| W2-D36 | **Hidden means absent.** Exit 3, never `out-of-scope`. The cut is applied before scope and before every LIMIT and ranking cut. A hidden id never makes a prefix ambiguous: entries have no prefix door (Task 2: a hidden full uuid is exit 3), and the node prefix rule sits in `resolveNodeInScope` (Task 3). | coordinator ruling (W2 decisions document) | 2, 3, 4 |
| W2-D37 | **Cursors and the header.** grep's and expand's cursor keys gain `asof` only under a cut; a cursor minted under another cut, or none, gets the verb's existing stale-cursor answer. The header grammar is unchanged and its counts are over what is visible. | coordinator ruling (W2 decisions document) | 4 |
| W2-D38 | **One definition.** lib owns `asOfCut` and the one predicate. The cut rides on `rc.scope.cut`, keyed on entries, never blobs. The regex child receives the cut with its job and applies the same predicate. W2-5a's reconstruction defines "as of N" by the same kept(N) membership (W2-D75); W2-5b's re-check (W2-D78(iii)(c)) and card parent (W2-D75's card line) call lib's own decision. | coordinator ruling (W2 decisions document) | 1, 3, 4 |
| W2-D39 | **W2-2a's CLI half**, as amended in place (R1): `headless-in-pane` with a non-empty seam variable and a defined `TMUX_PANE`, before any tmux spawn; with no pane, `no-identity`; the allow-list grows to 7; `asof-invalid` joins `REASON_ROWS` with the store half of `asOfCut`'s validation, "a boundary row, a main transcript, a copy holding N, and T_N" (D-5765). | coordinator ruling (W2 decisions document, as amended) | 1 (the word), 2 (the store half), 5 (the CLI half) |
| W2-D33, W2-D45, W2-D46 | **`stampAtOrBefore` in lib** (W2-1, consumed unchanged); **empty means unset, a defined `TMUX_PANE` is a pane** (its in-pane half, and the no-cut pins); **the decision order**, only the pane row's place after row 0 and before the identity's tmux spawn. | merged (W2-1); coordinator ruling (W2 decisions document) | 1; 3, 4, 5 |
| W2-D2, W2-D3, W2-D4, W2-D5, W2-D6, W2-D10 | **Lane, claims, D-numbers, no new test file, rollout, no schema change.** | coordinator ruling (W2 decisions document) | all; 6 checks them |
| R1 | **The lib names and shapes.** `asOfCut({ asof, boundary, copy, kept })`, pure, answering `{ ok: true, cut }` with exactly W2-D38's fields (frozen, `keptUuids` sorted, once each) or `ScopeRefusal<'asof-invalid'>`. The predicate is two exports: `asOfEntrySql(alias)`, a parenthesised boolean over an `entries` alias with named parameters only, each `asof_`-prefixed (inner alias `asof_hm`; an alias off `^[A-Za-z_][A-Za-z0-9_]*$` throws `TypeError`), and `asOfBinds(cut)`, a plain object whose keys are exactly those names, bare, with kept(N) as JSON text. Task 1 pins that the names parsed out of `asOfEntrySql('e')` equal `Object.keys(asOfBinds(cut))`. With no cut a site adds no clause and no binds. `lib.d.mts` declares `AsOfCopyRow`, `AsOfCut`, `asOfCut`, `asOfEntrySql` and `asOfBinds` once each. The "no copy holds N" arm is part of `asof-invalid`'s store half, named in D-5765, with no new number; W2-D39 is amended in place to list it. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| R2 | **The store half.** `asOfCutOf(rc, asof)` lives in recall.mjs (never cli.mjs, whose import sets a vitest worker's umask) and Task 2 ships it. It measures boundary N (`entries.uuid = asof` joined to `boundaries` and `transcripts`, main meaning `agent_id = ''`), picks the holding copy with lib's `pickHoldingCopy` as `producerOfLeaf` does, reads that copy's rows in derive's `copyRows` column names ordered by `memberships.line`, reads kept(N) through `keptOf(blobReadStmts(rc.db), kept_blob_id, { bytes: 0 })`, and returns lib `asOfCut`'s answer unchanged. Each recall-side test keeps its SQL-measured `cutAt` and adds one CONTROL that `asOfCutOf` deep-equals it. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 3 |
| R3 | **How the cut is supplied, and the CLI half.** W2-2a applies the cut only when `rc.scope.cut` is set; production sets it from the headless seam in W2-2b (W2-D46), and W2-2a's tests set it in process. The CLI reads the three seam names spec §8.2 lists, each by name, and refuses them inside a pane before any tmux spawn; a fourth `CCRC_RECALL_*` name is not refused, pinned as a CONTROL. W2-2a exports `recallSeamEngaged` and `decideSeamInPane`; W2-2b's `decideHeadless` calls them, or folds them and deletes them in its own PR. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 5 |
| R4 | **The leafless node.** A `condensed` node with no descendant leaf is hidden under any cut (fail closed: its gist cannot be checked against the cut). Not a departure: W2-D35 is amended in place to say so. Task 3's mutant M13 pins it. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R5 | **Who owns which door.** Task 3 owns `sourcesOf` and `producerOfLeaf` (describe's doors). Task 2 adds `'memberships'` to `VERB_TABLES.grep`; Task 3 edits tree's line only. Task 4 owns the header and `--json` scope (families and transcripts named and counted over what is visible, there only, `rc.scope` left intact; indexed-through and lag read over visible transcripts only); Task 3 makes visible-only only the counts its own sites list (tree's N, describe's `sources_total`). The regex child's variant branch under a cut was to be a named residual unless a fixture could pin it without a second copy that changes N's holding copy; Task 2's fixture shows such a copy leaves the holding copy in place, so Task 4's fixture carries one and pins the branch (mutant W5). Task 6's door table has a Task column. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 3, 4, 6 |
| R6 | **Residuals the PR body names.** A visible node's stored aggregates (`src_chars`, `desc_chars`, `earliest_ms`, `latest_ms`, `desc_count`) were computed over all its sources, hidden ones included: node-level figures, not entry content. Variants follow their entry, so a variant of a visible entry first seen after T_N stays visible (W2-D35 as written). A row outside N's holding copy stamped at or before T_N by a backward clock step or in the same millisecond stays visible; W2-5a counts `asof_same_ms_hits` (W2-D34). A visible node's refs of origin `model` and `meta` stay under a cut: they come from the summary written at N (R8). The regex child's variant branch under a cut is pinned (Task 4, W5), so it is not among them. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 3, 4, 6 |
| R7 | **The record and the commits.** The plan merges to `main` before dispatch, carrying D-5765's and D-5766's entries in its "Deviations found"; Task 1 cites them in code comments, and the PR defines no number. Task 6's checks expect both entries present at the merge-base and no added file. Task 6 has no commit unless a measured figure in the plan's own text must be corrected, so the PR carries five commits, or six. The free-space cases (history-holds 2, history-export 1) are box state, never breaks. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 6 |
| R8 | **Two doors the leak lens found, both fail closed.** SEC-1 (Task 4): `runTree`'s per-family heading (`family <id> generation=… first-seen=…`) reads `visibleScope(rc).families` under a cut, never `rc.scope.families`, so a family with no visible epoch is never named by tree; pinned by Task 4's widened tree case (the hidden family's id and generation absent under N, present in the no-cut CONTROL) and Task 4's mutant R19, which restores `rc.scope.families`. SEC-2 (Task 3): under a cut, describe drops the `origin = 'tool_use'` `node_refs`, and the `files` derived from them, of a node with a hidden source row, its own or a descendant leaf's, since those refs were mined from rows the cut hides; refs of origin `model` and `meta`, from the summary written at N, stay (R6 records it). Pinned by Task 3's mined-refs case (the hidden-row path absent under the cut, present in the no-cut CONTROL) and Task 3's mutant M18, which drops the filter; Task 3's M19 to M21 pin the walk down to a parent's leaves and the over-filter. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4, 6 |

## Review Focus

Each of these would bite a person who reads recall under a cut. Each names the task whose tests pin it, and what the reviewer should probe beyond those tests.

1. **A door that leaks a hidden id, gist or count.**
   - A grep hit on a kept(N) row grouped under leaf N+1, with N+1's id and gist printed (C31): Task 3's `coveringLeaves` case (M1) and its direct `leafHeads` case.
   - A hidden node making a prefix ambiguous, or a display prefix measured against hidden ids: Task 3, `resolveNodeInScope` and `scopePrefixes`.
   - describe naming a hidden parent, a hidden source row, a hidden child (a leafless `condensed` child, R4), or a producer read from a post-boundary reply (leaf N's producer reads `unknown` under `ASOF=N`): Task 3 (R5).
   - describe printing a ref, or a `files` path, mined from a source row the cut hides, under a visible leaf or a visible parent (R8, SEC-2): Task 3's mined-refs case (M18 to M21). The summary's own refs (`model`, `meta`) stay, by ruling (R6).
   - The header's counts, family names and lag moved by a hidden transcript: Task 4's header, widened and lag cases.
   - tree's per-family heading naming a family with no visible epoch, with its generation (R8, SEC-1): Task 4's widened tree case (R19).
   - The regex child scanning hidden rows: its matches are re-filtered by the parent, so the child's door is pinned in process at `scanRegexJob` with the parent's captured job (Task 4, mutants W1, W2 and W5: the entry, sidecar and variant branches).

   The reviewer probes R6's residuals (a visible node's stored aggregates, and its `model` and `meta` refs), that `refsOf` and `nodes_fts` have no reader that skips `resolveNodeInScope`, and that no other place prints a family, a ref or a path from `rc.scope` or `node_refs` without the cut.
2. **NULL-ts boundaries and NULL-ts rows.** A boundary with no stamp falls back to the newest stamp before it in its holding copy, a stamp of 0 is a time, and no stamp at all is `asof-invalid` (Task 1, mutants M3 and M8). Every NULL-ts row is hidden, before the boundary too, unless it is N, N's summary or kept(N). An orphan sidecar is hidden because the predicate is false over the LEFT JOIN's all-NULL row (Task 2, cut-A3). A kept row with no stamp reaches the regex child (Task 4). The reviewer probes that "non-null" rests on SQL's NULL comparison with no `IS NOT NULL` term, and that no site wraps `ts_ms` in `COALESCE` inside the predicate.
3. **Same-millisecond rows.** A post-boundary row of N's holding copy stamped exactly T_N, and one stamped before it, are both hidden: the positional-hide CONTROL (Task 1, M1, M2, M17). A row in another copy stamped exactly T_N stays visible (`o_eq`, pinned visible on purpose): D-5766's residual. The reviewer probes that no site "fixes" the residual locally, and that the holding copy the cut measures is the one `pickHoldingCopy` picks when two live copies exist (Task 2's fixture has two).
4. **A cursor reused across cuts.** A grep, `--regex` or expand cursor minted under no cut, under N or under N+1 resumes only under the same one, in both directions; `--regex` refuses before spawning a child; a bare `expand --cursor` resolves its target under the caller's own cut before the key check; uncut keys are the base's, so cursors printed before W2-2a still resume (Task 4). The reviewer probes that `:asof:` never occurs in a node id, entry key or around key (mutant L4), that the longest key (91 characters) stays inside `CURSOR_TEXT_RE`'s 128, and that a cursor minted under N may shift by newly ingested hits, as it can today.
5. **A LIMIT or ranking slot filled with hidden rows.** `RANK_POOL + 1` hidden rows outranking one visible hit (C27's shape): the cut sits inside `referrerSql`'s arms, before `LIMIT :pool` and `countSql` (Task 2, cut-A4, mutant M4: a post-LIMIT JS filter stays green on small results and reds only here). `--around`'s `LIMIT :n` (Task 2, cut-B3, M8). `coveringLeaves`' `min(node_id)` taken after hidden leaves are dropped (Task 3, C31's shared-row half, mutant M16). The reviewer probes every statement Task 3 filters in JS for a LIMIT that would run before the filter (`sourcesOf` and `producerOfLeaf` have none at the base), and the cost of per-call statements under a cut on long lineages.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `ccd/history/lib.mjs` | modify | **Task 1:** `'asof-invalid'` at the end of `REASON_ROWS`' exit-2 list after `    'generation-malformed', 'generation-mismatch',` (about :56), with a four-line comment ending `// D-5765 (history-w2-asof-invalid-word)`; a new section, "the as-of cut", holding `asOfCut`, `asOfEntrySql` and `asOfBinds`, directly above `// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw` (about :4353). **Task 2:** `VERB_TABLES.grep` gains `'memberships'` (about :8512). **Task 3:** `asOfHiddenNodesSql`, `asOfVisibleEpochsSql` and `asOfVisibleEntriesSql` directly after `asOfBinds`; `VERB_TABLES.tree` gains `'memberships'` (about :8515). **Task 4:** the module-private `ASOF_KEY_SEP` and the exported `expandCursorKey` above the doc comment that begins `/** What a decoded expand cursor names,` (about :8361), and `expandResumeOf` strips the suffix. **Task 5:** `recallSeamEngaged` and `decideSeamInPane` above `decideIdentity`'s doc comment (about :4222). | L1 | 1, 2, 3, 4, 5 |
| `ccd/history/lib.d.mts` | modify | **Task 1:** `AsOfCopyRow`, `AsOfCut`, `asOfCut`, `asOfEntrySql` and `asOfBinds` after `resolveScopedId`'s declaration (about :540). **Task 3:** three `(): string` declarations after `asOfBinds`'. **Task 4:** `expandCursorKey` above `entryScopeVerdict`'s declaration (about :906). **Task 5:** `RecallSeamValues`, `recallSeamEngaged` and `decideSeamInPane` after `decideIdentity`'s two-line declaration (about :520). | types | 1, 3, 4, 5 |
| `ccd/history/recall.mjs` | modify | **Task 2:** the lib import line gains `asOfEntrySql, asOfBinds, asOfCut,`; a derive.mjs import (`blobReadStmts`, `keptOf`); `cutOf`, `cutTerm`, `cutAnd`, `cutBinds`, `visibleEntryIds`, `uuidVisible` and the exported `asOfCutOf` after `bindFor` (about :353); `referrerSql`'s three arms and `grepParams`; `aroundRows` above the doc comment that begins `/** A condensed node's source entries in leaf order` (about :1344); `expandResolve`'s `entryNamed`, `--around` loop and node target `entryIds`; `expandPairedPath`'s hop. **Task 3:** `cutHiddenNodes`, `cutVisibleEpochs`, `cutVisibleEntries` and `cutHidesASource` after `isoOf` (about :85); `runTree`'s node list, `parentById` and epoch loop; `resolveNodeInScope`, `scopePrefixes`, `coveringLeaves`, `leafHeads` (gains `export`), `sourcesOf`, `producerOfLeaf`'s witnesses, `runDescribe`'s parent and its `refsAll` (R8, SEC-2), and `childRowsOf`. **Task 4:** `VISIBLE` and `export function visibleScope(rc)` above `const HEADERS = new WeakMap();` (about :157); `scopeHeader`'s counts and lag; `runTree`'s family loop head (about :268, R8, SEC-1); `jsonScope` replaced by `export function scopeJsonOf(rc)`; `asOfOf`, `grepKey`, `runRegex`'s job key `cut`, and `runExpand`'s check and mint through `expandCursorKey`. | L4 | 2, 3, 4 |
| `ccd/history/regex-worker.mjs` | modify | **Task 4:** the header comment's last sentence; the lib import gains `asOfEntrySql`; `candidateSql(withPrefilter, withCut)`; `scanRegexJob` requires `Object.hasOwn(job, 'cut')` and spreads `job.cut` into its binds. | L4 | 4 |
| `ccd/history/cli.mjs` | modify | **Task 4:** the recall.mjs import gains `scopeJsonOf`; `scopeJson` and its doc comment are deleted (about :815); `emitResult` prints `scopeJsonOf(rc)`; `SCOPE_FAMILIES_JSON_MAX` leaves the lib import. **Task 5:** the read verbs' lib import line gains `decideSeamInPane` (about :59); the dispatcher's order comment gains `//     2a. …` (about :456); in `readContextIn`, between `const pane = process.env.TMUX_PANE ?? null;` and `const who = decideIdentity(...)` (about :690-691), the three reads and the refusal. | L4 | 4, 5 |
| `server/test/history-lib.test.ts` | modify | **Task 1:** `W2-2a as-of cut: asOfCut, asOfEntrySql and asOfBinds, lib's one definition (W2-D34, W2-D38, W2-D39)`, 10 cases. **Task 4:** `expandCursorKey and expandResumeOf under an as-of cut (W2-D37; W2-2a Task 4)`, 5 pure cases. | test | 1, 4 |
| `server/test/history-recall.test.ts` | modify | **Task 2:** `W2-D36: hidden means absent at every entry read in recall.mjs (W2-2a Task 2)`, 13 cases. **Task 3:** `W2-D35: the as-of cut hides nodes, epochs and their ids at every read door (W2-2a Task 3)`, 11 cases. **Task 4:** `W2-D37 and W2-D38: the regex child, the cursors and the header under an as-of cut (W2-2a Task 4)`, 12 cases. Each appended at the end and skipped on darwin; no import line is added. | test | 2, 3, 4 |
| `server/test/history-cli.test.ts` | modify | **Task 5:** `W2-D39: decideSeamInPane refuses the seam variables inside a pane (W2-2a Task 5)`, 3 pure cases; `W2-D39: the read verbs refuse the seam variables inside a pane, before any tmux spawn (C4, C31; W2-2a Task 5)`, 3 spawned cases, through the `healthHh` namespace with no import line. | test | 5 |
| `server/test/single-definition.test.ts` | modify | **Task 1:** an appended describe, `ccrc history: the as-of cut is defined once, in lib.mjs (W2-D38; W2-2a Task 1)`, 2 cases. **Task 5:** in place, keeping its 4 lines, the allow-list describe's title and `ALLOWED` (about :5464-5467); an appended describe pinning the three seam names' holders, 2 cases. | test (citation corpus) | 1, 5 |
| this plan | modify (conditional) | **Task 6:** only to correct a figure its own text predicted, if a step measures another (R7). | docs | 6 |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the base is `cd622b2f6`. Each row gives what the document says, what the code at the base says, and what that changes here.

| Document says | Code at `cd622b2f6` | Effect | Task |
|---|---|---|---|
| W2-D36: `resolveScopedId` "at lib.mjs:3880-3886" | About :4345-4351, pure. Its one caller, recall.mjs's `resolveNodeInScope` (about :441), resolves node ids only. An entry is addressed only by a full id (`expandTargetOf`: `UUID_RE`, or `x` and 32 hex) | Entries have no prefix door. Task 3 filters hidden nodes in `resolveNodeInScope` before either list, and `resolveScopedId` is not edited. Task 2 pins the entry half: a hidden full uuid is exit 3. Task 1's section is anchored on the lossless-claw comment after it | 1, 2, 3 |
| §2 and W2-D39: `ALLOWED` "at single-definition.test.ts:5364" | About :5467, inside the describe at about :5464, whose title says "four-name". The file ends at about :8449 | Edited in place by content, keeping 4 lines. New describes go at the end. The CITATION DEBT case runs after each edit | 1, 5, 6 |
| W2-D34: T_N is the boundary's `ts_ms`, "else lib's `stampAtOrBefore` over `pickHoldingCopy`" | `stampAtOrBefore(rows, index)` (lib about :6014) reads row `index`'s own `ts_ms` before earlier rows | T_N is one call, `stampAtOrBefore(copy.rows, at)`, with no second branch | 1 |
| W2-D38: `asOfCut(...)` "returning {asof, tsCut, …}" | lib's deciders answer a refusal as `{ ok: false, rc, reason }` | `asOfCut` answers `{ ok: true, cut }` or `ScopeRefusal<'asof-invalid'>` | 1 |
| W2-D38: lib owns "one SQL predicate fragment" | lib.mjs is L1 and runs no SQL. A node's visibility needs a walk down `node_children`, and no correlated recursive CTE exists in the tree | The fragment is `asOfEntrySql(alias)` with `asOfBinds(cut)` (R1); its SQL cases run in history-lib over an in-memory db plus one real-schema prepare. Task 3's three named-only statements are built on it | 1, 3 |
| W2-D39: the store half is "a boundary row, a main transcript, and T_N" | The positional hide needs N's holding copy (`pickHoldingCopy`, about :7360). No `memberships` row is deleted at the base | A fourth arm, "no copy holds N", fails closed; W2-D39 is amended in place to list it (R1, D-5765) | 1, 2 |
| W2-D34: kept(N) "read from N's `kept_blob_id`" | derive.mjs exports `keptOf` and `blobReadStmts` (W2-1). `keptOf` folds a NULL id, a tombstone and a non-array body into an empty set | `asOfCutOf` passes `keptOf`'s set, the one derivation's spans use, so an unreadable kept blob hides more (fail closed, D-5766's entry) | 2 |
| `REASON_ROWS`, as the document knew it | W2-1 appended `'generation-malformed', 'generation-mismatch',` with D-5764's comment as the exit-2 list's last line. `REASONS` has 53 keys and `REFUSALS` 35; `headless-in-pane` is already an exit-2 word (W1-B2) | `asof-invalid` goes after W2-1's line, so W2-1's pin stays green: 54 and 36 after Task 1. Task 5 adds no word | 1, 5, 6 |
| W2-D34 and E11 cite "§8.2:1530" | The sentence is at about :1531; §8.3's exit-2 row is at about :1671 and carries W2-1's E1 words (D-5764); the spec names no `asof-invalid` | D-5766's entry cites "about :1531 at cd622b2f6". Task 6 asserts both rev 3.6 texts by content | 1, 6 |
| The tables to cut include `entries_fts` | No `entries_fts` exists. The one FTS index is `blobs_fts`, keyed by blob rowid; entries are reached only through `referrerSql`'s three arms | The cut goes into the arms, keyed on entries, never into the FTS match | 2 |
| W2-D36: the cut is applied "in SQL before scope and before every LIMIT" | grep's scope is `GREP_FILTER`, a WHERE over the `refs` CTE; expand's scope is a JS verdict (`entryScopeVerdict`) | grep: the cut sits inside the CTE's arms. expand: `found` is cut before the verdict (Task 2's mutant M6b pins the order) | 2 |
| W2-D35: "A sidecar with a NULL entry_id is absent" | The grep sidecar arm LEFT JOINs its entry and dates a hit `COALESCE(se.ts_ms, s.first_seen_ms)`; `expandItems` already skips `entry_id === null`; the regex child's sidecar branch reads `sidecars s` alone | Parent: a WHERE on `se`, never on the COALESCE. Child: under a cut, the branch joins `entries se`; with no cut its SQL is byte-identical | 2, 4 |
| W2-D35 lists describe as a node site | describe also reads entries, in `sourcesOf` and `producerOfLeaf`'s witnesses, both with positional `?` | Task 3 filters both in JS through `asOfVisibleEntriesSql`, keeping the base statements' text (R5) | 3 |
| W2-D33: `expandEntryBody(rc, e)`, rc `{db, version, schema}` | It reads `entry_variants` inside, and its `rc` carries no scope | Not edited: the cut is applied upstream, to the ids that reach it | 2 |
| (no document text) the `--around` statements | `expandStmts` caches `before` and `after` per read handle in `EXPAND_STMTS` | A cut is per read: cut statements are prepared per call, never cached | 2 |
| W2-D35: `nodes_fts` hits and `node_refs` follow their node | No read-path file reads `nodes_fts`. `node_refs` has one reader, `refsOf`, whose one caller passes an id `resolveNodeInScope` resolved | No site of their own for a HIDDEN node: a scan pins `nodes_fts`' absence (Task 3, M11), and the exit-3 case asserts a hidden node's ref never prints (M7). A VISIBLE node's `tool_use` refs were mined from its source rows, so describe cuts them when a source row under the node is hidden (Task 3, site 16, R8, SEC-2) | 3 |
| W2-D35 lists tree's epochs and nodes as tree's sites | `runTree` heads each family of `rc.scope.families` with `family <id> generation=… first-seen=…` before its epoch loop, so a family whose every epoch the cut hides is still named, with its generation | The heading loop reads `visibleScope(rc).families` (Task 4, R8, SEC-1); Task 3's epoch filter leaves the heading to it | 3, 4 |
| W2-D35 names six sites | describe, `grep --node` and expand's node target all call `resolveNodeInScope`; six more doors print a node or node field: `runTree`'s `parentById` and epoch loop, `runDescribe`'s parent, `sourcesOf`, `producerOfLeaf` and `childRowsOf` (whose hidden child only a damaged store holds, R4) | One filter serves three doors; each further door is cut with its own mutant | 3 |
| W2-D35: `scopePrefixes` over visible nodes, at tree | `runTree` never calls `scopePrefixes`; it measures `displayPrefixes` over its own node list | tree's prefixes follow from filtering its node list; `scopePrefixes`' cut covers grep headers and describe | 3 |
| W2-D35 names `leafHeads` | `renderHits` passes it only the ids `coveringLeaves` chose | `leafHeads` is exported as a test seam and tested directly | 3 |
| `VERB_TABLES`' doc comment: every table each read verb reads | `tree` and `grep` lack `'memberships'` (about :8512-8515); under a cut both read it through the predicate | grep's line gains it in Task 2, tree's in Task 3 (R5) | 2, 3 |
| W2-D38: "the regex child receives the cut with its job" | `runRegex`'s job holds `dbPath`, `transcriptPks`, `provenance`, `prefilter`, `pattern`, `pairs` and `belt`; `scanRegexJob` binds `tpks`, `provs` and `pre` | The job gains a required `cut` key, carrying the binds or `null`; a job without it is refused in fixed words, exit 1 | 4 |
| W2-D38 implies a child that ignores the cut is visible at the CLI | `runRegex` re-runs the child's matches through grep's own referrer join, which Task 2 cuts | The child's door is pinned in process at `scanRegexJob` with the parent's captured job (Task 4, mutant W1) | 4 |
| W2-D37: "the grep and expand cursor keys gain asof" | Cursors are exact-field shapes (`CURSOR_FIELDS`; `cursorShapeOk` refuses an extra key). expand's key `t` is also a bare `--cursor`'s resume target (`expandResumeOf`) | grep hashes `asof` into `q` only under a cut; expand appends `:asof:<uuid>` through `expandCursorKey`, and `expandResumeOf` strips it | 4 |
| W2-D37: "its counts are computed over what is visible" | `scopeHeader` counts `rc.scope.families` and `rc.scope.transcriptPks` and reads the lag over them; the `--json` scope is spelled twice (recall.mjs's `jsonScope`, cli.mjs's `scopeJson`) | One `visibleScope(rc)`; `scopeHeader` and the single exported `scopeJsonOf` read it, cli.mjs's twin is deleted | 4 |
| W2-D41 (W2-2b) drops a family with no visible epoch "from the scope and its count" | `rc.scope` is built in cli.mjs's `readContextIn` with no cut | Task 4 counts and names families over what is visible at the header and the `--json` scope only and never narrows `rc.scope` (R5); W2-2b builds on `visibleScope` | 4 |
| W2-D39 and W2-D45: "any non-empty `CCRC_RECALL_*`" | Spec §8.2 names exactly three seam variables; the allow-list scan reads every `process.env` use by name, so a prefix scan reads `<not by name>` and reds | The three names only; a fourth is no seam, pinned as a CONTROL (R3) | 5 |
| W2-D39: refuse "before any tmux spawn" | `readContextIn` reads `TMUX_PANE` and spawns `tmuxSession` inside `decideIdentity`'s argument on the next line; the operator verbs' irreversible check calls `tmuxSession` separately | The check goes between those two lines; the operator verbs never read the seam (W2-D47 is W2-2b's), a named residual | 5 |
| §2 Pins: C4's in-pane half in history-cli | C4's no-pane half lives in history-recall.test.ts; history-cli.test.ts reaches `runCli`, `withPane` and `seedFamily` only through its `healthHh` namespace | The in-pane half is appended to history-cli through `healthHh` and a dynamic import of `historyFixtures` | 5 |
| Spec §10.1: the allow-list is "pinned in exact-holders form" | The existing scan checks only that reads are a subset of `ALLOWED` | An appended describe pins the three names' holders: one dotted read each, in cli.mjs alone | 5 |
| W2-1's Global Constraints keep the allow-list at four names; spec §8.2: `SCOPE_SOURCES` is `["tmux"]` in W1 | §10.1 admits the seam "from W2"; `SCOPE_SOURCES` is `Object.freeze(['tmux'])` | Superseded here by W2-D39. `SCOPE_SOURCES` is left as it is; `'env'` is W2-2b's (W2-D41) | 5 |
| §2 Pins: "C59 and C69 stay green", no holders named | Titled describes in history-recall.test.ts only (about :3993 and :4303) | Tasks 2, 4 and 6 run them by name | 2, 4, 6 |
| §2 Tests names no deploy-side suite | D-5774's pin ("the gate declares no name lib.mjs exports") is in measure-history.test.ts; the driver's words are pinned in history-replay.test.ts | Tasks 1 and 6 run both, read only | 1, 6 |
| The decisions predate the armed growth check (D-6178) and its waiver ledger (D-6223) | `GROWTH_FILES` lists nine paths, none under `ccd/history/` | Task 6 expects nine `delta +0` rows and `GROWTH_OVER: (none)` | 6 |
| The ledger's "Later" item: the display doors and widened rules wait for "the first wave after 5h-2 that may change a base reading or the widened rules" | lib's 67 redaction declarations are unchanged from `02d75ae5f` to `cd622b2f6` | Task 6 Step 3 measures the same over the PR, with a CONTROL on 5h-2's change; the item stays open | 6 |

## Not in this plan

- **W2-2b, the headless seam** (W2-D40 to W2-D50), after W2-2a: the env identity from ASOF (`decideAsOfFamily`); the widened-scope guard that drops a family with no visible epoch (W2-D41) and `SCOPE_SOURCES` gaining `'env'`; `RECALL_ARMS`, the pre-store `asof-invalid` half (W2-D42) and exit 8 for `ARM=control`; the counter line's `arm` and the drain skip (W2-D43); the marker grammar (W2-D44); `decideHeadless` in W2-D46's order, **including step 7, which sets `rc.scope.cut` from `CCRC_RECALL_ASOF` through `asOfCutOf`** (R3); box and operator verbs ignoring the seam (W2-D47); `headless-malformed` and `headless-arm-unknown` (W2-D48); the `history-switches` row (W2-D49); O14's three constants. Whether W2-2b's `decideHeadless` calls W2-2a's `recallSeamEngaged` and `decideSeamInPane` or folds them and deletes them in its own PR is W2-2b's plan's choice (R3). Until W2-2b, no door prints `asof-invalid`, and C16's spawned check covers the word only from then.
- **W2-5a.** The per-question `asof_same_ms_hits` count of D-5766's residual (W2-D34), reconstruction's kept(N) as-of (W2-D75 items 1 to 3), and the `keptOf` scan (W2-D68).
- **W2-5b.** The replay driver's re-check (W2-D78(iii)(c)) and the treatment card's parent (W2-D75's card line), which call lib's own as-of decision (W2-D38); Task 3's `asOfHiddenNodesSql` is the statement the card parent is meant to ask.
- **The spec errata E2 and E11** (decisions §6), amended in place by W2-5b, never by W2-2a.
- **The display doors and the widened rules** (the ledger's "Later" item): left open. Task 6 Step 3 measures that this PR moves no base reading and no widened rule (D-5745).
- **describe's cursor and a `next:` line under a cut.** W2-D37 names grep and expand. A `next:` argv carries no cut, because the cut rides on W2-2b's env path.
- **The rollout** (W2-D6, W2-D10) and **the window and its operator acts** (decisions §5): the coordinator's or the operator's, never the worker's.

**PR:** One PR against `main`, on this workspace's own branch, executed in task order: six tasks, one commit each, the sixth only when Task 6 corrects a figure in this plan (R7):
1. `feat(history): the as-of cut's one definition in lib, and asof-invalid (W2-2a Task 1; W2-D34, W2-D38, W2-D39; D-5765, D-5766)`;
2. `feat(history): the as-of cut at every entry read in recall.mjs, and its store half (W2-2a Task 2; W2-D35, W2-D36, W2-D39)`;
3. `feat(history): the as-of cut hides leaves, parents and epochs at every read door, and a hidden id is absent (W2-2a Task 3; W2-D35, W2-D36)`;
4. `feat(history): the as-of cut reaches the regex child, the grep and expand cursors and the header (W2-2a Task 4; W2-D37, W2-D38)`;
5. `feat(history): the read verbs refuse the seam variables inside a pane, and the env allow-list grows to seven (W2-2a Task 5; W2-D39, W2-D45)`;
6. `docs(history): the W2-2a plan's predicted figures, as measured (W2-2a Task 6; W2-D4)`, only when needed.

Task 1 goes first: every later task consumes its predicate and its cut. Task 2 needs Task 1. Task 3 needs Task 2's `cutOf`, `cutBinds` and `asOfCutOf`. Task 4 needs Tasks 1 to 3: the predicate, `asOfCutOf`, `cutAnd`, `cutBinds`, `cutVisibleEpochs` and the cut referrer join. Task 5 touches none of their regions and goes fifth. Task 6 checks Tasks 1 to 5 and runs last. Every task leaves every suite green at its commit. Task 6 Step 9 opens the PR, only after Steps 0 to 8, ready for review (not a draft), titled **"ccrc history wave W2-2a: the as-of cut"**, with the body Task 6 Step 8 gives.

---

### Task 1: lib's single definition of the as-of cut, and the asof-invalid word (W2-D34, W2-D38, W2-D39)

Every later task of this plan reads the cut through what this task adds, and nothing else: the read verbs' sites in recall.mjs, the regex child, the cursors, and (in W2-5b) the replay driver's re-check and card parent (W2-D38). lib.mjs is L1: it imports `node:crypto` alone and never reads the store. So the cut is split the way every lib decision is (R1):
- `asOfCut({ asof, boundary, copy, kept })` decides the cut at boundary N from what a reader measured, and answers either `{ ok: true, cut }` or exit 2 `asof-invalid`. That refusal is the store half of W2-D39's validation; Task 2's `asOfCutOf` is the reader that measures its inputs.
- `asOfEntrySql(alias)` is the one SQL predicate that decides whether an `entries` row is visible under a cut, exactly as W2-D34 states it: one parenthesised boolean term over the alias, with named parameters only, each `asof_`-prefixed so none collides with a caller's own. `asOfBinds(cut)` answers exactly those parameters' values, by bare name, the way recall.mjs's `bindFor` binds. A caller with no cut adds neither.

This task changes nothing a session sees. No shipped door builds a cut yet: recall.mjs applies it in Tasks 2 to 4, and W2-2b's env path is the first production caller (R3). The new exit-2 word is in `REASONS` and `REFUSALS`, and no door prints it until W2-2b.

**How the cut is supplied in W2-2a (R3).** The cut rides on the `ReadContext` as `rc.scope.cut`, of type `AsOfCut | null`; a context built without the field (every builder at the base, cli.mjs's `readContextIn` included) reads as no cut. The verbs that carry it are the existing recall.mjs runners, each of which takes `rc` (`runTree`, `runGrep`, `runRegex`, `runDescribe`, `runExpand`, `resolveNodeInScope`, `scopeHeader`), with their signatures unchanged. In W2-2a only tests set `scope.cut`, in process. W2-2b's env path sets it at W2-D46 step 7.

**Order.** This is the plan's first task. It edits two regions of lib.mjs (`REASON_ROWS`, and a new block after `resolveScopedId`) that no later task reopens, one region of `lib.d.mts`, and appends to the end of `history-lib.test.ts` and `single-definition.test.ts`. The two departures it cites, D-5765 and D-5766, are already defined in this plan's "Deviations found", on `main` with the plan (R7); this task cites them in lib.mjs's comments and defines nothing. Line numbers are hints measured at `cd622b2f6`; Step 4's script asserts that each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - `REASON_ROWS`' exit-2 list. After `    'generation-malformed', 'generation-mismatch',` (about :56), before the list's `  ]],`, a four-line comment ending `// D-5765 (history-w2-asof-invalid-word)`, then `    'asof-invalid',`. `REASONS` and `REFUSALS` stay derived.
  - A new section, `the as-of cut`, holding `asOfCut`, `asOfEntrySql` and `asOfBinds` with their doc comments, directly above `// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw` (about :4353), which follows `resolveScopedId`. It calls the module's own `refuseScope` (about :4218), `summaryRowFor` (about :5760) and `stampAtOrBefore` (about :6014), all hoisted. No new import and no new module-level constant, so O14's `VOCABS` does not change.
- Modify: `ccd/history/lib.d.mts`: one block directly after `export function resolveScopedId(i: { wanted: string; inScope: readonly string[]; outOfScope: readonly string[] }): ScopedId;` (about :540), holding `AsOfCopyRow`, `AsOfCut`, `asOfCut`, `asOfEntrySql` and `asOfBinds`. `ScopeRefusal<R>` (about :517) is reused.
- Test: `server/test/history-lib.test.ts`: one describe appended at the end of the file, 10 cases. No import line: lib is reached by dynamic import, and the file-level `EXIT`, `REASONS`, `REFUSALS`, `readFileSync`, `fileURLToPath`, `FtsDb` (`node:sqlite`'s `DatabaseSync`), `replayStore` (store.mjs) and `mkTmp` are already imported.
- Test: `server/test/single-definition.test.ts`: one describe appended after the last describe (about :8449), 2 cases, with no import line (the CCRC HISTORY block's reason: `session-hook.test.ts`' citation audit cites this file by line). `ALL_MJS`, `stallCode` and `rel` are that block's.
- Not edited: `recall.mjs`, `regex-worker.mjs` and `cli.mjs` (later tasks); `derive.mjs`, `store.mjs`, `sweep.mjs`; the spec; README.md; `ccd/history-skill/SKILL.md` (its exit-2 row is generic, W2-D48); this plan.

**Interfaces:**
- Consumes (base, unchanged):
  - `lib.mjs`: `stampAtOrBefore(rows, index): number | null` (W2-D33): row `index`'s own `ts_ms` when non-null, else the newest non-null stamp before it, a stamp of 0 being a time, null when none; `summaryRowFor({ boundaryUuid, anchorUuid, rows: { uuid, isCompactSummary, isEcho }[] })`, derivation's summary pick; module-private `refuseScope(reason)`, answering `{ ok: false, rc: EXIT.REFUSED, reason }`; `EXIT`, `REASON_ROWS`, `REASONS`, `REFUSALS`.
  - `lib.d.mts`: `ScopeRefusal<R extends string> { ok: false; rc: 2; reason: R }`.
  - The store's v1 columns the predicate names: `entries.entry_id`, `uuid`, `ts_ms`, and `memberships (file_id, entry_id, line)` with its primary key `(file_id, entry_id)`.
- Produces:
  - `lib.mjs`: `export function asOfCut({ asof, boundary, copy, kept })`:
    - `asof: string`, N's uuid as the caller was given it;
    - `boundary: { entryId: number, uuid: string, main: boolean, anchorUuid: string | null } | null`: the `entries` row whose uuid is `asof`, joined to its `boundaries` row and its transcript (`main` is `transcripts.agent_id === ''`, `anchorUuid` is `boundaries.anchor_uuid`); null when no `boundaries` row has that uuid;
    - `copy: { fileId: number, rows: AsOfCopyRow[] } | null`: N's holding copy (lib's `pickHoldingCopy` over the transcript's files that hold N), its rows in file order, in derive.mjs's `copyRows` column names (`entry_id`, `uuid`, `line`, `ts_ms`, `type`, `provenance`, `is_compact_summary`); null when no file holds N;
    - `kept: Iterable<unknown>`: kept(N), derive.mjs's `keptOf` set; non-strings are dropped;
    - answers `{ ok: true, cut: AsOfCut }` or `{ ok: false, rc: 2, reason: 'asof-invalid' }`. The cut is frozen, and so is its `keptUuids`.
  - `lib.mjs`: `export function asOfEntrySql(alias): string`: one parenthesised boolean term over the `entries` row aliased `alias`, true iff W2-D34 makes that row visible, false over a LEFT JOIN's all-NULL row. Its parameters are named only: `:asof_ts`, `:asof_file`, `:asof_line`, `:asof_boundary`, `:asof_summary` and `:asof_kept`. `alias` must match `^[A-Za-z_][A-Za-z0-9_]*$`, else `TypeError`; the inner `memberships` alias is `asof_hm`, which a caller never uses.
  - `lib.mjs`: `export function asOfBinds(cut)`: `{ asof_ts: tsCut, asof_file: holdingFileId, asof_line: boundaryLine, asof_boundary: boundaryEntryId, asof_summary: summaryEntryId, asof_kept: JSON.stringify(keptUuids) }`, keys exactly `asOfEntrySql`'s parameter names, bare. node:sqlite refuses an unknown named parameter, and the regex child spreads these unfiltered (Task 4), so Step 2 pins the equality.
  - `AsOfCut` (W2-D38's fields): `{ asof: string, tsCut: number, boundaryEntryId: number, summaryEntryId: number | null, keptUuids: readonly string[] (sorted, once each), holdingFileId: number, boundaryLine: number }`, plain data.
  - `lib.d.mts`: `AsOfCopyRow`, `AsOfCut`, `asOfCut`, `asOfEntrySql` and `asOfBinds`, one declaration each.
  - `REASONS['asof-invalid'] === 2`, so `REFUSALS` contains `'asof-invalid'`.
- The contract later tasks keep: `rc.scope.cut` holds an `AsOfCut` or is absent or null. A site that reads `entries` under a cut splices `asOfEntrySql('<its entries alias>')` and binds `asOfBinds(cut)`; with no cut it adds neither. Node, epoch and sidecar visibility (W2-D35) is reached through the same predicate, applied to the entry each hangs on, never through a second rule.

**Choices this task makes:**
- **T_N is one call.** `stampAtOrBefore(copy.rows, at)`, where `at` is N's index in its holding copy, answers N's own `ts_ms` when it has one, otherwise the newest non-null stamp before it in that copy: exactly W2-D34's first bullet. A NULL answer is `asof-invalid`.
- **The summary entry is derivation's pick.** `summaryRowFor` runs over the same copy, with `isEcho` computed as derive.mjs computes it (`type === 'user' && provenance === 'harness'`). An echo row is never the summary; no pick gives `summaryEntryId: null`, which `= :asof_summary` never matches.
- **"Non-null" through SQL's NULL rule.** `ts_ms <= :asof_ts` is NULL for a NULL `ts_ms`, so such a row never passes the timed arm, and no redundant `IS NOT NULL` term is written (a mutant dropping it would stay green). The mutant that matters, reading a NULL stamp as a time (`ifnull(ts_ms, 0)`), reds (M3).
- **The positional clause reaches `memberships` by its primary key** `(file_id, entry_id)`. An entry has at most one line per file, so "a row of N's holding copy at a line after N's" is one `NOT EXISTS` probe.
- **Keyed on entries, never on blobs.** The predicate names no `blob_id`. Two entries sharing one stored body are decided apart (the per-entry case pins it).
- **kept(N) is derivation's set, matched in SQL.** Members are matched by `uuid` through `json_each(:asof_kept)`, which makes "present in the store" structural: a kept uuid with no `entries` row matches nothing.
- **The refusal arms, in order:** no `boundaries` row, or one whose uuid is not `asof`; a sidechain transcript; no copy holds N (`copy` null, or N not among its rows); no stamp at or before N. One word, `asof-invalid`, no sub-reason. The "no copy holds N" arm is part of the store half, named in D-5765, with W2-D39 amended in place to list it (R1): the positional hide (W2-D34) is defined only inside N's holding copy, so the cut fails closed rather than drop that clause. Only a damaged store reaches it.
- **`asOfCut` answers `{ ok: true, cut }`.** W2-D38's fields are the fields of `cut`; the wrapper is how lib's deciders answer a refusal (`decideHarness`, `decideScope`).
- **`keptUuids` is sorted and holds each uuid once**, so the cut has one canonical form, and a cursor key or job that carries it never differs by input order.
- **An in-memory store for the SQL cases**, holding the two tables the predicate reads (as history-lib's FTS cases do with `FtsDb`), and one real-schema prepare through `store.mjs`'s `createStore`, so a renamed column reds here, not in a later task.

**Residuals, named:** D-5766's entry names the stamp-based residual outside N's holding copy (the same-millisecond row `o_eq` is pinned visible, so the residual is stated, not hidden) and the empty kept set `keptOf` answers for an unreadable kept blob (fail closed). No door prints `asof-invalid` in W2-2a: C16's spawned check (`history-skill.test.ts`) covers it from W2-2b.

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'base holds W2-1' || echo 'STOP: W2-1 (#1105) is not on this base'
```

Expected: `base holds W2-1`. On `STOP`, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, that no name is taken, the two entries, and the base counts.** From the repository root:

```bash
grep -c "^    'generation-malformed', 'generation-mismatch',$" ccd/history/lib.mjs
grep -c '^// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw$' ccd/history/lib.mjs
grep -c '^export function resolveScopedId(i: { wanted: string; inScope: readonly string\[\]; outOfScope: readonly string\[\] }): ScopedId;$' ccd/history/lib.d.mts
grep -c '^export function stampAtOrBefore(rows, index) {$' ccd/history/lib.mjs
grep -c '^export function summaryRowFor({ boundaryUuid, anchorUuid, rows }) {$' ccd/history/lib.mjs
grep -c '^function refuseScope(reason) {$' ccd/history/lib.mjs
grep -c '^- \*\*D-5765\*\* — `history-w2-asof-invalid-word`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md
grep -c '^- \*\*D-5766\*\* — `history-w2-asof-time-cut`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md
grep -c 'asOfCut\|asOfEntrySql\|asOfBinds\|asof-invalid\|AsOfCut\|AsOfCopyRow\|asof_hm' ccd/history/*.mjs ccd/history/lib.d.mts deploy/*.mjs server/test/history-lib.test.ts server/test/single-definition.test.ts
```

Expected (measured at `cd622b2f6`): `1` for each of the first eight lines (the last two: this plan's entries, on `main` with it); `0` for every file on the last line (`deploy/history-replay.mjs` spells `asof` only as a lowercase field of its spawn spec).

Then record the base counts, each in the foreground with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
```

Write each `N passed` (and any `skipped`) to `.superpowers/sdd/history-w2-2a/base-counts-task1.txt` (gitignored). Every file must be green at the base.

- [ ] **Step 2: Write the failing tests.** Two appends, each after the file's last line.

(a) `server/test/history-lib.test.ts`: append:

```ts

// ── W2-2a Task 1 (W2-D34, W2-D38, W2-D39): the as-of cut, lib's one definition ────────────────────────────────────
// asOfCut decides the cut at boundary N from what a reader measured; asOfEntrySql is the one SQL predicate that applies
// it to an entries row, and asOfBinds its named parameters' values. Pure, so it runs on darwin too: the SQL cases run
// over an in-memory node:sqlite database holding the two tables the predicate reads, and one case prepares it against a
// real store's schema. D-5765 (history-w2-asof-invalid-word), D-5766 (history-w2-asof-time-cut)
describe('W2-2a as-of cut: asOfCut, asOfEntrySql and asOfBinds, lib\'s one definition (W2-D34, W2-D38, W2-D39)', () => {
  type Lib = typeof import('../../ccd/history/lib.mjs');
  type Cut = import('../../ccd/history/lib.mjs').AsOfCut;
  type In = Parameters<Lib['asOfCut']>[0];
  type Row = { entry_id: number; uuid: string; line: number; ts_ms: number | null; type: string; provenance: string; is_compact_summary: number };
  const lib = async (): Promise<Lib> => await import('../../ccd/history/lib.mjs');
  const T = 1_760_000_000_000;   // T_N in the main fixture
  const row = (entry_id: number, uuid: string, line: number, ts_ms: number | null, o: Partial<Row> = {}): Row =>
    ({ entry_id, uuid, line, ts_ms, type: 'assistant', provenance: 'model', is_compact_summary: 0, ...o });
  /** N's holding copy (file 1), in file order. N (`B`) has no stamp of its own, so T_N is p2's, the newest before it. */
  const HOLD: readonly Row[] = [
    row(1, 'p0', 0, T - 200, { type: 'user', provenance: 'operator' }),
    row(2, 'pn', 1, null),
    row(3, 'p2', 2, T),
    row(4, 'B', 3, null, { type: 'system', provenance: 'harness' }),
    row(5, 'q_lt', 4, T - 50),
    row(6, 'echo', 5, T + 5, { type: 'user', provenance: 'harness', is_compact_summary: 1 }),
    row(7, 'S', 6, T + 10, { type: 'user', provenance: 'summary', is_compact_summary: 1 }),
    row(8, 'q_eq', 7, T),
    row(9, 'k1', 8, null, { type: 'user', provenance: 'operator' }),
    row(10, 'q_gt', 9, T + 100),
  ];
  /** Another transcript's copy (file 2): decided by stamp alone. */
  const OTHER: readonly Row[] = [
    row(11, 'o_lt', 0, T - 1),
    row(12, 'o_eq', 1, T),
    row(13, 'o_gt', 2, T + 1),
    row(14, 'o_null', 3, null),
    row(15, 'o_late', 20, T - 10),
  ];
  const ALL = [...HOLD, ...OTHER].map((r) => r.uuid);
  const N = { entryId: 4, uuid: 'B', main: true, anchorUuid: 'B' };
  const input = (o: Partial<In> = {}): In => ({ asof: 'B', boundary: N, copy: { fileId: 1, rows: HOLD }, kept: ['k1', 'ghost', 'k1', 7], ...o });
  const cutOf = async (o: Partial<In> = {}): Promise<Cut> => {
    const r = (await lib()).asOfCut(input(o));
    if (!r.ok) throw new Error(`expected a cut, got ${JSON.stringify(r)}`);
    return r.cut;
  };
  /** HOLD with the named rows restamped. */
  const stamped = (ts: Record<string, number | null>): Row[] => HOLD.map((r) => (r.uuid in ts ? { ...r, ts_ms: ts[r.uuid] ?? null } : r));
  const REFUSED = { ok: false, rc: 2, reason: 'asof-invalid' };
  /** The two tables the predicate reads, holding HOLD as file 1 and OTHER as file 2. q_eq and q_lt are also early rows
   *  of file 2, and q_eq shares one stored body (blob 900) with o_eq. */
  const storeOf = (): FtsDb => {
    const db = new FtsDb(':memory:');
    db.exec(`CREATE TABLE entries (entry_id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE, ts_ms INTEGER, blob_id INTEGER NOT NULL);
      CREATE TABLE memberships (file_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, line INTEGER NOT NULL, PRIMARY KEY (file_id, entry_id));`);
    const ent = db.prepare('INSERT INTO entries (entry_id, uuid, ts_ms, blob_id) VALUES (?, ?, ?, ?)');
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    for (const [fileId, rows] of [[1, HOLD], [2, OTHER]] as const) {
      for (const r of rows) {
        ent.run(r.entry_id, r.uuid, r.ts_ms, r.uuid === 'q_eq' || r.uuid === 'o_eq' ? 900 : 100 + r.entry_id);
        mem.run(fileId, r.entry_id, r.line);
      }
    }
    mem.run(2, 8, 4);   // q_eq, early in file 2
    mem.run(2, 5, 5);   // q_lt, early in file 2
    return db;
  };
  /** The uuids a statement returns with the cut spliced and bound, or with neither when there is no cut. */
  const visible = (l: Lib, db: FtsDb, cut: Cut | null): string[] => {
    const where = cut === null ? '' : ` AND ${l.asOfEntrySql('e')}`;
    return (db.prepare(`SELECT e.uuid AS uuid FROM entries e WHERE e.entry_id > :min${where} ORDER BY e.entry_id`)
      .all({ min: 0, ...(cut === null ? {} : l.asOfBinds(cut)) }) as Array<{ uuid: string }>).map((r) => r.uuid);
  };

  it('C16, its one word: asof-invalid is an exit-2 REASONS word, so REFUSALS holds it', () => {
    expect(REASONS['asof-invalid']).toBe(EXIT.REFUSED);
    expect(REFUSALS).toContain('asof-invalid');
  });

  it('REASON_ROWS lists asof-invalid on its own line, beside its departure, D-5765', () => {
    const src = readFileSync(fileURLToPath(new URL('../../ccd/history/lib.mjs', import.meta.url)), 'utf8').split('\n');
    const at = src.findIndex((l) => l === "    'asof-invalid',");
    expect(at, 'REASON_ROWS lists asof-invalid on its own line').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 4), at).join('\n')).toContain('D-5765 (history-w2-asof-invalid-word)');
  });

  it('asOfCut: T_N is the boundary\'s own stamp, the summary is derivation\'s pick, kept(N) is its strings once each, sorted', async () => {
    const own = await cutOf({ copy: { fileId: 1, rows: stamped({ B: T - 20 }) } });
    expect(own, 'N\'s own stamp is T_N, though p2 before it is stamped later').toEqual({
      asof: 'B', tsCut: T - 20, boundaryEntryId: 4, summaryEntryId: 7, keptUuids: ['ghost', 'k1'], holdingFileId: 1, boundaryLine: 3,
    });
    expect(Object.isFrozen(own) && Object.isFrozen(own.keptUuids), 'one cut has one form').toBe(true);
    expect((await cutOf({ kept: new Set<string>() })).keptUuids, 'an empty kept(N)').toEqual([]);
  });

  it('a NULL-ts boundary: T_N is the newest stamp at or before it in its holding copy, past NULL rows, and a stamp of 0 is a time', async () => {
    expect((await cutOf()).tsCut, 'B has no stamp: p2\'s').toBe(T);
    expect((await cutOf({ copy: { fileId: 1, rows: stamped({ p2: null }) } })).tsCut, 'p2 and pn have none: p0\'s').toBe(T - 200);
    expect((await cutOf({ copy: { fileId: 1, rows: stamped({ p0: 0, p2: null }) } })).tsCut).toBe(0);
    expect((await cutOf({ copy: { fileId: 1, rows: stamped({ p2: null, q_lt: T - 5 }) } })).tsCut, 'a row after N is never read').toBe(T - 200);
  });

  it('asof-invalid, each arm against its CONTROL: no boundary row, another row\'s, a sidechain, no holding copy, a copy without N, no time at or before N', async () => {
    const l = await lib();
    expect(l.asOfCut(input()).ok, 'CONTROL: the fixture cuts').toBe(true);
    const arms: Array<[string, Partial<In>]> = [
      ['no boundaries row has the uuid', { boundary: null }],
      ['the boundary measured is not the asof\'s', { asof: 'p2' }],
      ['N sits on a sidechain transcript', { boundary: { ...N, main: false } }],
      ['no file holds N', { copy: null }],
      ['the copy given does not hold N', { copy: { fileId: 2, rows: OTHER } }],
      ['no stamp at or before N in its holding copy', { copy: { fileId: 1, rows: stamped({ p0: null, p2: null }) } }],
    ];
    for (const [arm, o] of arms) expect(l.asOfCut(input(o)), arm).toEqual(REFUSED);
    expect(REASONS[REFUSED.reason], 'the refusal is a REASONS word of its exit').toBe(EXIT.REFUSED);
  });

  it('the summary entry is derivation\'s pick: never an echo row; the row an anchor names; none without an anchor or a summary', async () => {
    expect((await cutOf()).summaryEntryId, 'the first compact summary after N that is not an echo').toBe(7);
    expect((await cutOf({ boundary: { ...N, anchorUuid: 'q_lt' } })).summaryEntryId, 'an anchor naming a row picks it').toBe(5);
    expect((await cutOf({ boundary: { ...N, anchorUuid: 'echo' } })).summaryEntryId, 'an echo row is never the pick').toBeNull();
    expect((await cutOf({ boundary: { ...N, anchorUuid: null } })).summaryEntryId).toBeNull();
    expect((await cutOf({ copy: { fileId: 1, rows: HOLD.filter((r) => r.uuid !== 'S') } })).summaryEntryId, 'only an echo after N').toBeNull();
  });

  it('asOfEntrySql and asOfBinds: an alias off the SQL-name grammar throws; no blob is named; the parameters are named, asof_-prefixed, and exactly the binds\' keys', async () => {
    const l = await lib();
    for (const bad of ['', '1e', 'e; DROP TABLE entries', 'e.x', 'e ']) {
      expect(() => l.asOfEntrySql(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    const sql = l.asOfEntrySql('ent_2');
    expect(sql.startsWith('(') && sql.endsWith(')'), 'one parenthesised boolean term').toBe(true);
    expect(sql).toContain('ent_2.ts_ms <= :asof_ts');
    expect(sql, 'keyed on entries, never on blobs').not.toMatch(/blob/i);
    expect(sql, 'named parameters only').not.toContain('?');
    const names = [...new Set([...l.asOfEntrySql('e').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))].sort();
    expect(names.length > 0 && names.every((n) => n.startsWith('asof_')), names.join(' ')).toBe(true);
    const binds = l.asOfBinds(await cutOf());
    expect(Object.keys(binds).sort(), 'the regex child spreads the binds unfiltered, and node:sqlite refuses an unknown name').toEqual(names);
    expect(binds).toEqual({ asof_ts: T, asof_file: 1, asof_line: 3, asof_boundary: 4, asof_summary: 7, asof_kept: '["ghost","k1"]' });
  });

  it('the positional-hide CONTROL: rows after N in its holding copy stamped exactly T_N and before T_N are hidden; without the cut they show', async () => {
    const l = await lib();
    const db = storeOf();
    try {
      const cut = await cutOf();
      expect(cut.tsCut, 'CONTROL: T_N is the stamp both rows are measured against').toBe(T);
      const seen = visible(l, db, cut);
      expect(seen, 'q_eq is stamped exactly T_N, after N in its holding copy (and early in another copy too)').not.toContain('q_eq');
      expect(seen, 'q_lt is stamped before T_N, the row right after N in its holding copy').not.toContain('q_lt');
      expect(seen, 'CONTROL: p2, stamped exactly T_N before N in the same copy, is visible').toContain('p2');
      expect(visible(l, db, null), 'CONTROL: the same fixture without the cut shows every row').toEqual(ALL);
    } finally { db.close(); }
  });

  it('the cut decides by entry: NULL-ts rows absent; N, its summary and kept(N) present whatever their stamp or line; other copies by stamp alone', async () => {
    const l = await lib();
    const db = storeOf();
    try {
      const seen = new Set(visible(l, db, await cutOf()));
      expect(Object.fromEntries(ALL.map((u) => [u, seen.has(u)]))).toEqual({
        p0: true,                    // stamped before T_N, before N
        pn: false,                   // NULL ts, before N
        p2: true,                    // stamped exactly T_N, before N
        B: true,                     // N itself, no stamp of its own
        q_lt: false,                 // the row right after N in its holding copy, stamped before T_N
        echo: false,                 // an echo after N: never the summary
        S: true,                     // N's summary, stamped after T_N
        q_eq: false,                 // after N in its holding copy, stamped exactly T_N
        k1: true,                    // a member of kept(N), no stamp, after N
        q_gt: false,
        o_lt: true,
        o_eq: true,                  // the named residual: another copy, the same millisecond as T_N (D-5766)
        o_gt: false,
        o_null: false,
        o_late: true,                // another copy, before T_N, at a line past N's: the positional clause is the holding copy's alone
      });
      expect([seen.has('q_eq'), seen.has('o_eq')], 'q_eq and o_eq share one stored body and are decided apart').toEqual([false, true]);
    } finally { db.close(); }
  });

  it('the predicate prepares and runs against a real store\'s schema', async () => {
    const l = await lib();
    const h = mkTmp('ccrc-history-asof-');
    replayStore.createStore(h);
    const db = replayStore.openWriter(l.historyPaths(h).dbFile);
    try {
      const cut = await cutOf();
      expect(db.prepare(`SELECT e.uuid AS uuid FROM entries e WHERE e.transcript_pk = :tpk AND ${l.asOfEntrySql('e')}`)
        .all({ tpk: 1, ...l.asOfBinds(cut) })).toEqual([]);
    } finally { db.close(); }
  });
});
```

(b) `server/test/single-definition.test.ts`: append:

```ts

// W2-2a Task 1 (W2-D38): the as-of cut is defined once, in lib.mjs. APPENDED after the last describe, for the reason the
// CCRC HISTORY block above states; no import line is added. ALL_MJS, stallCode and rel are that block's.
describe('ccrc history: the as-of cut is defined once, in lib.mjs (W2-D38; W2-2a Task 1)', () => {
  const DEFINES = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`);
  const definers = (name: string): string[] =>
    ALL_MJS.filter((f) => stallCode(f).split('\n').some((l) => DEFINES(name).test(l))).map(rel).sort();

  it('CONTROL: the pattern sees a function or binding declaration, exported or not, and never a call', () => {
    expect(DEFINES('asOfCut').test('export function asOfCut({ asof, boundary, copy, kept }) {')).toBe(true);
    expect(DEFINES('asOfCut').test('const asOfCut = (i) => i;')).toBe(true);
    expect(DEFINES('asOfEntrySql').test('function asOfEntrySql(alias) {')).toBe(true);
    expect(DEFINES('asOfCut').test('  const c = asOfCut({ asof, boundary, copy, kept });')).toBe(false);
    expect(DEFINES('asOfBinds').test('  const b = xlib.asOfBinds(cut);')).toBe(false);
  });

  it('asOfCut, asOfEntrySql and asOfBinds are each defined in lib.mjs alone', () => {
    for (const name of ['asOfCut', 'asOfEntrySql', 'asOfBinds']) expect(definers(name), name).toEqual(['ccd/history/lib.mjs']);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. First list what each filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-lib.test.ts -t 'W2-2a as-of cut')
(cd server && ./node_modules/.bin/vitest list test/single-definition.test.ts -t 'the as-of cut is defined once')
```

Expected: 10 tests and 2 tests. Then run them:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2a as-of cut')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the as-of cut is defined once')
```

Expected (predicted, written before the code):
- history-lib: `10 failed`.
  - `C16, its one word`: `expected undefined to be 2`.
  - `REASON_ROWS lists asof-invalid`: `expected -1 to be greater than -1`.
  - `asOfEntrySql and asOfBinds`: `TypeError: … asOfEntrySql is not a function`, at `const sql = l.asOfEntrySql('ent_2')`. The alias loop above it passes vacuously: calling a missing member throws a `TypeError` too.
  - The other seven: `TypeError: … asOfCut is not a function`. Each builds or refuses a cut before anything else.
- single-definition: `1 failed | 1 passed`. The CONTROL passes; the census fails on `asOfCut` with `[]` against `[ 'ccd/history/lib.mjs' ]`.

- [ ] **Step 4: Write the code.** From the repository root, run this script. Each replacement asserts that its anchor occurs exactly once. The python body is a quoted heredoc, and every block is a raw string.

```bash
python3 - . <<'PYEOF'
import sys
ROOT = sys.argv[1]
def rep(rel, old, new):
    p = f'{ROOT}/{rel}'
    s = open(p).read()
    assert s.count(old) == 1, (rel, old[:80], s.count(old))
    open(p, 'w').write(s.replace(old, new))

# lib.mjs: the exit-2 word, after W2-1's two, beside its departure.
rep('ccd/history/lib.mjs',
r"""    'generation-malformed', 'generation-mismatch',
  ]],
""",
r"""    'generation-malformed', 'generation-mismatch',
    // `asof-invalid` (W2-2a, W2-D39): the as-of cut's refusal. Its store half is asOfCut's: the uuid names no boundaries
    // row, or a boundary on a sidechain transcript, held by no copy, or with no stamp at or before it in its holding copy.
    // W2-2b adds the pre-store half (an empty or non-UUID seam value) and the family half, under the same word.
    // D-5765 (history-w2-asof-invalid-word)
    'asof-invalid',
  ]],
""")

# lib.mjs: the cut, its one predicate and its binds, after resolveScopedId.
rep('ccd/history/lib.mjs',
r"""// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
""",
r"""// ── the as-of cut (W2-2a; W2-D34, W2-D38, W2-D39) ──────────────────────────
// ONE definition of "as of boundary N" (W2-D38): asOfCut decides the cut from what a reader measured, asOfEntrySql is
// the one SQL predicate that applies it to an entries row, and asOfBinds is that predicate's named parameters' values.
// Every read verb, the regex child and the replay driver's re-check read these and spell no second rule. A cut is plain
// data (numbers, strings, one array), so it rides on a ReadContext as `rc.scope.cut` (absent or null: no cut, and a
// site then adds no clause and no binds). It is keyed on entries, never on blobs: two entries that share one stored
// body are decided apart. W2-2b's headless seam is the first production caller; until then only tests set it.
// D-5766 (history-w2-asof-time-cut)

/** The cut at boundary N (W2-D34, W2-D38), from what the reader measured:
 *  - `asof`: N's uuid, as the caller was given it;
 *  - `boundary`: the entries row whose uuid is `asof`, joined to its boundaries row and its transcript, as
 *    `{ entryId, uuid, main, anchorUuid }` (`main`: that transcript's agent_id is ''; `anchorUuid`: the boundaries
 *    row's anchor_uuid); null when no boundaries row has that uuid;
 *  - `copy`: N's holding copy, the file pickHoldingCopy picks among the transcript's files that hold N, as
 *    `{ fileId, rows }`, its rows in file order in derive.mjs's copyRows shape (`entry_id`, `uuid`, `line`, `ts_ms`,
 *    `type`, `provenance`, `is_compact_summary`); null when no file holds N;
 *  - `kept`: kept(N), derive.mjs's keptOf over N's kept_blob_id (option (a)), the set derivation spans with.
 *  The store half of W2-D39's validation answers exit 2 `asof-invalid` when the boundary is absent or is not `asof`'s,
 *  sits on a sidechain transcript, has no copy holding it, or has no time at or before it. T_N is stampAtOrBefore over
 *  the copy at N's own row (W2-D33): N's own ts_ms, else the newest non-null stamp before it in that copy; a stamp of
 *  0 is a time. The summary entry is summaryRowFor's pick over the same copy, the rule derivation uses, so an echo row
 *  is never it; null when there is none. `keptUuids` is the kept set's strings, once each, sorted, so one cut has one
 *  form. D-5765 (history-w2-asof-invalid-word) */
export function asOfCut({ asof, boundary, copy, kept }) {
  if (boundary === null || boundary.uuid !== asof) return refuseScope('asof-invalid');
  if (boundary.main !== true) return refuseScope('asof-invalid');
  const at = copy === null ? -1 : copy.rows.findIndex((r) => Number(r.entry_id) === Number(boundary.entryId));
  if (at < 0) return refuseScope('asof-invalid');
  const tsCut = stampAtOrBefore(copy.rows, at);
  if (tsCut === null) return refuseScope('asof-invalid');
  const meta = copy.rows.map((r) => ({
    uuid: r.uuid, isCompactSummary: Number(r.is_compact_summary) === 1, isEcho: r.type === 'user' && r.provenance === 'harness',
  }));
  const pick = summaryRowFor({ boundaryUuid: boundary.uuid, anchorUuid: boundary.anchorUuid, rows: meta });
  const summary = pick.uuid === null ? undefined : copy.rows.find((r) => r.uuid === pick.uuid);
  return {
    ok: true,
    cut: Object.freeze({
      asof,
      tsCut,
      boundaryEntryId: Number(boundary.entryId),
      summaryEntryId: summary === undefined ? null : Number(summary.entry_id),
      keptUuids: Object.freeze([...new Set([...kept].filter((u) => typeof u === 'string'))].sort()),
      holdingFileId: Number(copy.fileId),
      boundaryLine: Number(copy.rows[at].line),
    }),
  };
}

/** The one SQL predicate of the cut (W2-D34): one parenthesised boolean term over the entries row aliased `alias`, true
 *  iff the cut leaves that row visible. Its parameters are named only, each `asof_`-prefixed so none collides with a
 *  caller's own, and asOfBinds(cut) answers exactly their values. An entry is visible iff:
 *  - its ts_ms is at most T_N (a NULL ts_ms compares NULL, so it never passes), and it is not a row of N's holding copy
 *    at a line after N's (memberships reached by its primary key, file_id and entry_id); or
 *  - it is N's boundary entry, or N's summary entry (a NULL summary matches nothing); or
 *  - its uuid is a member of kept(N), whatever its stamp or line, matched in SQL, so a member with no entries row
 *    matches nothing.
 *  Everything else is absent: every NULL-ts row, and every row after N in its holding copy whatever its stamp. Outside
 *  the holding copy the decision is the stamp alone, so a row written after N in another copy but stamped at or before
 *  T_N stays visible: the residual W2-5a counts for the same millisecond. Over a LEFT JOIN's all-NULL row it is false.
 *  `alias` is interpolated, so it must be an SQL name; the inner memberships alias is `asof_hm`. Keyed on entries,
 *  never on blobs. D-5766 (history-w2-asof-time-cut) */
export function asOfEntrySql(alias) {
  if (typeof alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new TypeError(`asOfEntrySql: ${JSON.stringify(alias)} is not an SQL name`);
  }
  const e = alias;
  return `((${e}.ts_ms <= :asof_ts`
    + ` AND NOT EXISTS (SELECT 1 FROM memberships asof_hm WHERE asof_hm.file_id = :asof_file AND asof_hm.entry_id = ${e}.entry_id AND asof_hm.line > :asof_line))`
    + ` OR ${e}.entry_id = :asof_boundary OR ${e}.entry_id = :asof_summary`
    + ` OR ${e}.uuid IN (SELECT value FROM json_each(:asof_kept)))`;
}

/** asOfEntrySql's named parameters for `cut`, by bare name, the way node:sqlite binds them here (recall.mjs's bindFor):
 *  exactly the names asOfEntrySql uses, because node:sqlite refuses an unknown named parameter and the regex child
 *  spreads these unfiltered. kept(N) travels as JSON text for json_each, so the object crosses JSON as it is. */
export function asOfBinds(cut) {
  return {
    asof_ts: cut.tsCut,
    asof_file: cut.holdingFileId,
    asof_line: cut.boundaryLine,
    asof_boundary: cut.boundaryEntryId,
    asof_summary: cut.summaryEntryId,
    asof_kept: JSON.stringify(cut.keptUuids),
  };
}

// derived from lossless-claw src/tools/lcm-describe-id.ts @ e05d8d3, MIT, see LICENSE.lossless-claw
""")

# lib.d.mts: one block after resolveScopedId's declaration.
rep('ccd/history/lib.d.mts',
r"""export function resolveScopedId(i: { wanted: string; inScope: readonly string[]; outOfScope: readonly string[] }): ScopedId;
""",
r"""export function resolveScopedId(i: { wanted: string; inScope: readonly string[]; outOfScope: readonly string[] }): ScopedId;
// --- W2-2a Task 1: the as-of cut, lib's one definition (W2-D34, W2-D38, W2-D39)
/** One row of N's holding copy, in file order, in derive.mjs's copyRows column names. */
export interface AsOfCopyRow {
  readonly entry_id: number | bigint; readonly uuid: string; readonly line: number | bigint; readonly ts_ms: number | bigint | null;
  readonly type: string; readonly provenance: string; readonly is_compact_summary: number | bigint;
}
/** The cut at boundary N (W2-D38). Plain data: it rides on `rc.scope.cut`. */
export interface AsOfCut {
  readonly asof: string; readonly tsCut: number; readonly boundaryEntryId: number; readonly summaryEntryId: number | null;
  readonly keptUuids: readonly string[]; readonly holdingFileId: number; readonly boundaryLine: number;
}
export function asOfCut(i: {
  asof: string;
  boundary: { entryId: number; uuid: string; main: boolean; anchorUuid: string | null } | null;
  copy: { fileId: number; rows: readonly AsOfCopyRow[] } | null;
  kept: Iterable<unknown>;
}): { ok: true; cut: AsOfCut } | ScopeRefusal<'asof-invalid'>;
/** The cut's one SQL predicate over an entries alias: one parenthesised boolean term, named `asof_` parameters only. */
export function asOfEntrySql(alias: string): string;
/** asOfEntrySql's named parameters for a cut, by bare name: exactly the names it uses; kept(N) as JSON text. */
export function asOfBinds(cut: AsOfCut): {
  asof_ts: number; asof_file: number; asof_line: number; asof_boundary: number; asof_summary: number | null; asof_kept: string;
};
""")
print('lib.mjs and lib.d.mts written')
PYEOF
```

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2a as-of cut')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the as-of cut is defined once')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `10 passed`, `2 passed`, and tsc silent with exit 0. Then count the declarations, because `skipLibCheck` hides a duplicate:

```bash
grep -c '^export function asOfCut(\|^export function asOfEntrySql(\|^export function asOfBinds(\|^export interface AsOfCut \|^export interface AsOfCopyRow ' ccd/history/lib.d.mts
```

Expected: `5`, one each.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2a/t1/mut.sh`: it applies one exact replacement (or two), asserted to match once, runs its filter and shows red, then restores every file the task edits and checks each with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

First write the helpers, once, after Step 5's green run. They copy the files as they stand then, so a file changed on purpose after this point needs this block run again before any later mutant:

```bash
mkdir -p .superpowers/sdd/history-w2-2a/t1
cat > .superpowers/sdd/history-w2-2a/t1/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2a/t1
FILES="ccd/history/lib.mjs ccd/history/recall.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(s.replace(old, new))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
LIB_T='W2-2a as-of cut'
SH
for f in ccd/history/lib.mjs ccd/history/recall.mjs; do cp "$f" ".superpowers/sdd/history-w2-2a/t1/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms. Never split one mutant across calls: the helpers restore every file when a call exits. If a call's runs would pass 600000 ms on a loaded box, join its filters for the same file into one `-t` regex (`'a|b'`) and read each case's line from that one run. A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M1: the positional clause dropped (W2-D34's CONTROL).
mut ccd/history/lib.mjs 'asof_hm.line > :asof_line))' 'asof_hm.line > :asof_line AND 0))'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'the positional-hide CONTROL' (q_eq is shown) and 'the cut decides by entry'
# (q_lt and q_eq read true).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M2: the time cut made strict.
mut ccd/history/lib.mjs '(${e}.ts_ms <= :asof_ts' '(${e}.ts_ms < :asof_ts'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 3 failed. 'the positional-hide CONTROL' (the p2 CONTROL), 'the cut decides by entry'
# (p2 and o_eq read false), and 'asOfEntrySql and asOfBinds' (the text no longer holds 'ent_2.ts_ms <= :asof_ts').
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M3: a NULL stamp read as a time.
mut ccd/history/lib.mjs '(${e}.ts_ms <= :asof_ts' '(ifnull(${e}.ts_ms, 0) <= :asof_ts'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the cut decides by entry')
restore
# Expected RED (predicted): pn and o_null read true.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M4: N's boundary arm dropped.
mut ccd/history/lib.mjs '    asof_boundary: cut.boundaryEntryId,' '    asof_boundary: null,'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'the cut decides by entry' (B reads false: it has no stamp) and
# 'asOfEntrySql and asOfBinds' (asof_boundary null for 4).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M5: N's summary arm dropped.
mut ccd/history/lib.mjs '    asof_summary: cut.summaryEntryId,' '    asof_summary: null,'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'the cut decides by entry' (S reads false) and 'asOfEntrySql and asOfBinds'.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M6: the kept(N) arm dropped.
mut ccd/history/lib.mjs '    asof_kept: JSON.stringify(cut.keptUuids),' "    asof_kept: '[]',"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 2 failed. 'the cut decides by entry' (k1 reads false) and 'asOfEntrySql and asOfBinds'.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M7: the positional clause no longer bound to the holding copy.
mut ccd/history/lib.mjs 'WHERE asof_hm.file_id = :asof_file' 'WHERE asof_hm.file_id >= :asof_file'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the cut decides by entry')
restore
# Expected RED (predicted): o_late (file 2, line 20, past N's line 3) reads false.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M8: T_N read from N's own row only, with no fallback (W2-D34's NULL-ts arm).
mut ccd/history/lib.mjs '  const tsCut = stampAtOrBefore(copy.rows, at);' '  const tsCut = copy.rows[at].ts_ms;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 8 failed | 2 passed. Every case that cuts at the NULL-ts B throws 'expected a cut' ('a NULL-ts
# boundary', 'the summary entry', 'asOfEntrySql and asOfBinds', the two SQL cases and the real-schema case); the arms'
# CONTROL reads ok false; 'asOfCut: T_N is the boundary' passes its stamped-B line and fails on its empty-kept cut at B.
# The C16 and REASON_ROWS cases stay green.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M9: a sidechain boundary accepted.
mut ccd/history/lib.mjs "  if (boundary.main !== true) return refuseScope('asof-invalid');" "  if (false) return refuseScope('asof-invalid');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asof-invalid, each arm')
restore
# Expected RED (predicted): 'N sits on a sidechain transcript' answers ok true.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M10: the measured boundary not checked against asof.
mut ccd/history/lib.mjs "  if (boundary === null || boundary.uuid !== asof) return refuseScope('asof-invalid');" "  if (boundary === null) return refuseScope('asof-invalid');"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asof-invalid, each arm')
restore
# Expected RED (predicted): 'the boundary measured is not the asof's' answers ok true.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M11: no holding copy not refused.
mut ccd/history/lib.mjs "  if (at < 0) return refuseScope('asof-invalid');" '  // (removed)'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asof-invalid, each arm')
restore
# Expected RED (predicted): 'no file holds N' throws a TypeError (copy is null). Equivalent, named: 'the copy given
# does not hold N' stays refused, because stampAtOrBefore(rows, -1) reads nothing and the no-time arm answers the
# same word.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M12: an echo row allowed as the summary.
mut ccd/history/lib.mjs "    uuid: r.uuid, isCompactSummary: Number(r.is_compact_summary) === 1, isEcho: r.type === 'user' && r.provenance === 'harness'," '    uuid: r.uuid, isCompactSummary: Number(r.is_compact_summary) === 1, isEcho: false,'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 4 failed. 'the summary entry' (6 for 7, and the echo anchor picks 6), 'asOfCut: T_N is the
# boundary' (summaryEntryId 6), 'asOfEntrySql and asOfBinds' (asof_summary 6), and 'the cut decides by entry' (echo
# true, S false).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M13: the word missing from REASON_ROWS.
mut ccd/history/lib.mjs "    'asof-invalid',
" ''
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 3 failed. 'C16, its one word', 'REASON_ROWS lists asof-invalid', and 'asof-invalid, each
# arm' on its last line (REASONS has no such word).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M14: kept(N) left in input order.
mut ccd/history/lib.mjs "      keptUuids: Object.freeze([...new Set([...kept].filter((u) => typeof u === 'string'))].sort())," "      keptUuids: Object.freeze([...new Set([...kept].filter((u) => typeof u === 'string'))]),"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfCut: T_N is the boundary')
restore
# Expected RED (predicted): keptUuids [ 'k1', 'ghost' ] against [ 'ghost', 'k1' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M15: kept(N) not deduplicated.
mut ccd/history/lib.mjs "      keptUuids: Object.freeze([...new Set([...kept].filter((u) => typeof u === 'string'))].sort())," "      keptUuids: Object.freeze([...kept].filter((u) => typeof u === 'string').sort()),"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfCut: T_N is the boundary')
restore
# Expected RED (predicted): keptUuids [ 'ghost', 'k1', 'k1' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M16: the alias guard weakened to a type check.
mut ccd/history/lib.mjs "  if (typeof alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*\$/.test(alias)) {" "  if (typeof alias !== 'string') {"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfEntrySql and asOfBinds')
restore
# Expected RED (predicted): '""' does not throw.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M17: the boundary line taken one row late.
mut ccd/history/lib.mjs '      boundaryLine: Number(copy.rows[at].line),' '      boundaryLine: Number(copy.rows[at + 1].line),'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 4 failed. 'asOfCut: T_N is the boundary' (boundaryLine 4), 'asOfEntrySql and asOfBinds'
# (asof_line 4 for 3), 'the positional-hide CONTROL' and 'the cut decides by entry' (q_lt, the row right after N, is shown).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M18: a second definition of the predicate in recall.mjs.
mut ccd/history/recall.mjs 'const IN_PART = 500;' "const IN_PART = 500;
function asOfEntrySql(alias) { return alias; }"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the as-of cut is defined once')
restore
# Expected RED (predicted): 1 failed | 1 passed: asOfEntrySql's definers [ 'ccd/history/lib.mjs', 'ccd/history/recall.mjs' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M19: the binds answer a name the predicate does not use.
mut ccd/history/lib.mjs '    asof_kept: JSON.stringify(cut.keptUuids),' '    asof_kept: JSON.stringify(cut.keptUuids), asof_spare: 0,'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
restore
# Expected RED (predicted): 4 failed. 'asOfEntrySql and asOfBinds' (the keys hold asof_spare), and the two SQL cases and
# the real-schema case, where node:sqlite refuses the unknown named parameter.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M20: the cut no longer frozen.
mut ccd/history/lib.mjs '    cut: Object.freeze({' '    cut: ({'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfCut: T_N is the boundary')
restore
# Expected RED (predicted): 'one cut has one form': expected false to be true (the deep-equal above it passes:
# toEqual ignores freezing).
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M21: the predicate names a blob column.
mut ccd/history/lib.mjs '(${e}.ts_ms <= :asof_ts' '(${e}.blob_id IS NOT NULL AND ${e}.ts_ms <= :asof_ts'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfEntrySql and asOfBinds')
restore
# Expected RED (predicted): 'keyed on entries, never on blobs': the text matches /blob/i.
```

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
# M22: a positional parameter in the predicate.
mut ccd/history/lib.mjs ' OR ${e}.entry_id = :asof_summary' ' OR ${e}.entry_id = ?'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'asOfEntrySql and asOfBinds')
restore
# Expected RED (measured: 4 failed | 6 passed; predicted: 1 failed): 'named parameters only' (the text contains '?'),
# and, because the bound asof_summary now names no parameter, the positional-hide CONTROL, 'the cut decides by entry' and
# the real-schema case, each with node:sqlite's `Unknown named parameter 'asof_summary'`.
```

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2a/t1/mut.sh
for f in ccd/history/lib.mjs ccd/history/recall.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t1/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the as-of cut is defined once')
```

Expected: each mutant red as predicted, and no call printing `NOT RESTORED`; then the last call's loop prints nothing, and its runs print `10 passed` and `2 passed`. In M16 the `\$` keeps bash from reading `$/` inside the double quotes.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. A red file is re-run alone before it is called a break:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'DRIVER_REASONS is disjoint from lib REASONS')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'O14, local half')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'THE CITATION DEBT this task creates')
(cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green, each against Step 1's base count:
- `history-lib`: the base's count plus 10. `single-definition -t 'ccrc history'`: plus 2 (the new describe's name begins `ccrc history:`).
- `history-skill`: exactly the base's count. Its C16 derivation holds the new word, and its exit-code table is unchanged.
- `history-replay -t 'DRIVER_REASONS …'` and `measure-history -t 'O14, local half'`: green. `asof-invalid` is not a driver word (C-J), and no new lib export shares a gate name (D-5774).
- `history-cli`: green; no CLI path changed. `citations`: green; no numeric line citation added. The citation-debt case: green and unchanged (an append below the last describe). `dtbd`: green. tsc: silent.

Then the ledger check:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-lib.test.ts server/test/single-definition.test.ts || echo 'no D-TBD token'
grep -c 'D-5765\|D-5766' ccd/history/lib.mjs
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `no D-TBD token`; `4` (the `REASON_ROWS` comment, the section header and the two doc comments); then green: both numbers are cited in lib.mjs and defined once, in this plan.

- [ ] **Step 8: Commit.**

```bash
for f in ccd/history/lib.mjs ccd/history/recall.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t1/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git add ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts server/test/single-definition.test.ts
git status --short
git commit -m "feat(history): the as-of cut's one definition in lib, and asof-invalid (W2-2a Task 1; W2-D34, W2-D38, W2-D39; D-5765, D-5766)"
```

The loop prints nothing: no mutant is left in a file the commit takes (a `NOT RESTORED` line stops the commit; report it). `git status --short` must list exactly these four files before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.

---

### Task 2: the cut at every entry read in recall.mjs, and its store half (W2-D35's entry side, W2-D36, W2-D39)

Task 1 gives lib the one definition of the cut: `asOfCut`, `asOfEntrySql` and `asOfBinds` (W2-D34, W2-D38). This task, the first that edits recall.mjs, ships the store half that measures `asOfCut`'s inputs (R2), and splices the predicate into every statement in recall.mjs that returns or counts entries. After it, a row the cut hides answers exactly as if it were not stored (W2-D36):
- **The store half.** `export function asOfCutOf(rc, asof)` measures boundary N, its holding copy and kept(N) on `rc.db` and returns lib `asOfCut`'s answer unchanged. Only tests call it in W2-2a; W2-2b's env path is its first production caller (W2-D46 step 7, R3).
- **grep, FTS and `--regex` alike.** The cut sits inside `referrerSql`'s three arms (entry, variant, sidecar), so it applies before `GREP_FILTER`'s scope term, before the ranking, before `LIMIT :pool` (C27), and before `countSql`'s true count.
- **expand.** A hidden uuid is exit 3, never `out-of-scope`, because visibility is decided before `entryScopeVerdict`. `--around` keeps the visible rows before its LIMIT. A node's lineage lists visible entries only, and with them only those entries' sidecars. A hidden ancestor never names the outline's file.

The cut follows W2-D35's entry bullet. A variant follows its entry. A sidecar follows the entry it is linked to, and a sidecar linked to no entry is absent.

With no cut set, the read path answers byte for byte as before: every changed statement is spliced with `''`, and every new helper answers its input (or `true`) without preparing a statement.

This task stops at entries. Which **nodes** and **epochs** are visible, and describe's own doors, are Task 3's (R5): `coveringLeaves`, `leafHeads`, `scopePrefixes`, `resolveNodeInScope`, `tree`, describe's parent, `sourcesOf` and `producerOfLeaf`. The regex child's own candidate set, the cursors and the header counts are Task 4's. Spec: none. W2-D36 is not a departure: the time cut is Task 1's predicate (D-5766), and the store half's refusal is D-5765's word.

**Departures:** none.

**Every statement in recall.mjs that reads entries, entry_variants or sidecars** (line numbers are hints at `cd622b2f6`; there is no `entries_fts` table, see Drifts):

| # | Site (content anchor) | Reads | How the cut applies | Mutant |
|---|---|---|---|---|
| 1 | `referrerSql`, the `'entry'` arm (about :368-370) | entries ⋈ match | `${cutAnd(rc, 'e')}` in the JOIN's ON, inside the CTE: before the scope, the rank and the LIMIT | M1, M4 |
| 2 | `referrerSql`, the `'variant'` arm (about :372-376) | entry_variants ⋈ entries | `${cutAnd(rc, 'e')}` after `v.blob_id <> e.blob_id`: a variant follows its entry | M2 |
| 3 | `referrerSql`, the `'sidecar'` arm (about :378-381) | sidecars ⟕ entries | `WHERE ${cutTerm(rc, 'se')}` on the LEFT JOIN's entry. A sidecar follows its linked entry. One linked to none has an all-NULL `se`, the predicate is false there, and it is absent | M3 |
| 4 | `rankedSql` (about :388-394) | refs | through #1 to #3: the cut sits before `ORDER BY … LIMIT :pool` (C27) | M4 |
| 5 | `countSql` (about :397-400) | refs | through #1 to #3: `total` (the N of `shown K of N`) counts visible referrers only | M1 |
| 6 | `grepParams` (about :482-491) | binds | `...cutBinds(rc)`; `bindFor` keeps each statement's own | M5 |
| 7 | `expandStmts.entryByUuid` via `expandResolve`'s `entryNamed` (about :1308, :1375) | entries | `uuidVisible(rc, uuid)` decides `found` before `entryScopeVerdict`: hidden is exit 3, never `out-of-scope` | M6, M6b |
| 8 | `expandStmts.before` and `.after` via `--around` (about :1318-1319, :1388-1390) | memberships | with a cut, `aroundRows`' own statement joins entries and keeps the visible ones before `LIMIT :n`. With no cut, the cached statements, unchanged | M7, M8 |
| 9 | `lineageEntries` (store.mjs) via `expandLineage` (about :1409) | node_sources ⋈ entries | the id list goes through `visibleEntryIds` | M9, M13 |
| 10 | `expandStmts.entryById` via `expandItems` (about :1307) | entries | uncut: every id it is handed has passed #7, #8 or #9 | (covered by M6 to M9) |
| 11 | `expandStmts.sidecars` via `expandItems` (about :1314) | sidecars | follows its entry: read only for an item entry, which is visible; `entry_id IS NULL` was already skipped | (M9) |
| 12 | `expandStmts.variants` in `expandEntryBody` (about :1313) | entry_variants | follows its entry: reached only for a visible item. `expandEntryBody` is also the deploy lane's export (W2-D33), whose `rc` carries no scope, so it is not edited | — |
| 13 | `expandStmts.hop` in `expandPairedPath` (about :1559) | entries | `uuidVisible(rc, uuid)`: a hidden ancestor ends the walk, as an absent one does | M10 |
| 14 | `sourcesOf` (about :920-926) | node_sources ⋈ entries ⋈ blobs | Task 3 (R5): describe's door, filtered there by lib's visible-entries statement | — |
| 15 | `producerOfLeaf`'s witness read (about :975-981) | memberships ⋈ entries | Task 3 (R5), as #14 | — |
| 16 | `summaryLine`'s two reads (about :940-951) | boundaries ⋈ entries, memberships ⋈ entries | **not cut**: they answer a line number that only says where #15's walk starts, and print nothing; Task 3 cuts the witnesses after it | — |
| 17 | `producerOfLeaf`'s copies read (about :966-969) | ingest_files ⟕ memberships | not cut: the boundary's holding copy, a position | — |
| 18 | `transcriptsOf` (about :135-146) | `EXISTS` over entries | not cut here: it decides which transcripts are in scope, and its count is the header's (Task 4). A transcript whose rows are all hidden adds no hit, because #1 to #3 are cut | — |
| 19 | `nodeEntries` → `lineageEntries` for `grep --node` (about :473-480) | node_sources ⋈ entries | not cut: a filter over `refs`, which #1 to #3 already cut; never printed | — |
| 20 | `coveringLeaves` (about :665-674) | node_sources ⋈ nodes | Task 3 (the node cut). It is handed the visible hits' entry ids only | — |
| 21 | `hitSnippet`'s `blobOf`, `expandBlob`'s `blobLen` and `blob`, `summaryOf` | blobs | not cut: keyed on blobs, reached only from a visible referrer, a visible item or a node (W2-D38: "keyed on entries, never on blobs") | — |
| 22 | `FTS_MATCH`, `REGEX_MATCH` | blobs_fts, the child's blob list | not cut: blob-level; the cut applies where #1 to #3 join them to entries | — |
| 23 | `visibleEntryIds`, `uuidVisible`, `aroundRows` (new) | entries, memberships | each is the cut, from lib's one predicate | M13, M14, M17 |
| 24 | `asOfCutOf` (new) | entries ⋈ boundaries ⋈ transcripts, ingest_files ⟕ memberships, memberships ⋈ entries, blobs | the store half: it measures the cut's inputs and applies no cut | M11, M12, M15, M16 |
| — | `regex-worker.mjs`'s candidate read (not recall.mjs) | entries, entry_variants, sidecars | Task 4's (W2-D38: the child gets the cut with its job). Until then the child may match a hidden row's blob, and #1 to #3 drop it in the parent (case A5) | — |

**Files:**
- Modify: `ccd/history/recall.mjs`:
  - the lib import's line `  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths,` (about :28) gains `asOfEntrySql, asOfBinds, asOfCut,`;
  - a new line, `import { blobReadStmts, keptOf } from './derive.mjs';`, directly after the store.mjs named import (about :33). history-lib's rings pin allows it (recall.mjs forbids only `node:sqlite`, `./sweep.mjs` and `./cli.mjs`), and card.mjs already imports derive.mjs;
  - seven helpers directly after `bindFor` (about :353-358): the module-private `cutOf`, `cutTerm`, `cutAnd`, `cutBinds`, `visibleEntryIds` and `uuidVisible`, and the exported `asOfCutOf`;
  - `referrerSql`'s doc comment gains one sentence, and its three arms gain the cut (about :364-383);
  - `grepParams` spreads `cutBinds(rc)` (about :489);
  - `aroundRows` goes directly above the doc comment that begins `/** A condensed node's source entries in leaf order` (about :1344);
  - in `expandResolve`: `entryNamed` (about :1375), the `--around` loop (about :1388-1390) and the node target's `entryIds` (about :1409);
  - in `expandPairedPath`: the `hop` check (about :1559-1560).
- Modify: `ccd/history/lib.mjs`: `VERB_TABLES`' line `  grep: Object.freeze([...READ_CONTEXT_TABLES, 'blobs', 'entry_variants', 'sidecars', 'nodes', 'node_sources', 'node_children']),` (about :8512) gains `'memberships'` (R5): under a cut grep reads it through the predicate, and `VERB_TABLES`' doc comment promises every table each verb reads. It is a v1 table, so no store misses it and no case reds without it: this is the list's promise kept, not a guard.
- Test: `server/test/history-recall.test.ts`: one describe appended at the end of the file (about :5853 at `cd622b2f6`), 13 cases, skipped on darwin.
- Not edited: `lib.d.mts` (`asOfCutOf` is recall.mjs's and is typed at its test call sites, as W2-1's exports are); `sourcesOf` and `producerOfLeaf` (Task 3's, R5); `regex-worker.mjs` and `cli.mjs` (Tasks 4 and 5); `store.mjs` and `derive.mjs` (consumed: `lineageEntries` is filtered in recall.mjs); `single-definition.test.ts`; the spec.

**Interfaces:**
- Consumes (Task 1):
  - `asOfEntrySql(alias): string`: W2-D34's visibility as one parenthesised SQL term over an entries alias exposing `entry_id`, `uuid` and `ts_ms`, with named `asof_*` parameters only; false over an all-NULL alias row.
  - `asOfBinds(cut)`: exactly those parameters' values, by bare name, so `bindFor` keeps each statement's own.
  - `asOfCut({ asof, boundary, copy, kept })` and `AsOfCut` (W2-D38), with `summaryEntryId: number | null`.
  - `rc.scope.cut`: `null` or an absent key means no cut. In W2-2a only tests set it, in process (R3).
- Consumes (base): recall.mjs's `bindFor(sql, all)`, `versioned`, `referrerSql`, `rankedSql`, `countSql`, `grepParams`, `expandStmts`, `expandResolve`, `expandHolding`, `expandLineage` and `expandPairedPath`; lib's `entryScopeVerdict` and `pickHoldingCopy`; derive.mjs's `blobReadStmts(db)` and `keptOf(s, blobId, budget)` (W2-1).
- Tests, from history-recall.test.ts's module scope: `GRX` (`rc`, `recall`, `grepArgs`), the types `GrepRc`, `GrepVerbResult` and `GrepMod`, `t16seed`, `t16scan`, `t16uuid`, `t16ts`, `t16summary`, `t16leafOf`, `rH` (`makeHistoryBox`, `plantTranscript`, `openStoreRO`), `rFx`, `libRead`, `RDatabaseSync`, `REPO`, `fs` and `path`. store.mjs's `openWriter` and `closeWriter` come through a dynamic import, as the F4 case does.
- Produces (recall.mjs):
  - `export function asOfCutOf(rc, asof)`: lib `asOfCut`'s answer, `{ ok: true, cut }` or `{ ok: false, rc: 2, reason: 'asof-invalid' }`, over what it measures on `rc.db` (it reads nothing else of `rc`): the `entries` row of `asof` joined to its `boundaries` row and its transcript (main means `agent_id = ''`); the transcript's files and whether each holds N, picked by lib's `pickHoldingCopy` as `producerOfLeaf` picks; that copy's rows in derive's `copyRows` column names, ordered by `memberships.line`; kept(N) through `keptOf(blobReadStmts(rc.db), kept_blob_id, { bytes: 0 })` (R2).
  - module-private, each reused by Tasks 3 and 4: `cutOf(rc): AsOfCut | null` (`rc.scope.cut ?? null`); `cutTerm(rc, alias)`: `(${asOfEntrySql(alias)})` or `''`, the one call of `asOfEntrySql` in the file; `cutAnd(rc, alias)`: `` ` AND ${cutTerm(rc, alias)}` `` or `''`; `cutBinds(rc)`: `asOfBinds(cut)` or `{}`, the one call of `asOfBinds`.
  - module-private: `visibleEntryIds(rc, ids)`: the subset the cut leaves visible, in `ids`' order, or `ids` itself (the same array) with no cut or an empty list; `uuidVisible(rc, uuid)`: true with no cut, false for a hidden row and for no row; `aroundRows(rc, s, hold, side, n)`: `{ entry_id, line }[]`, nearest first, like `s.before` and `s.after`.
- Behaviour, under `rc.scope.cut`: `runGrep` and `runRegex` answer exit 3 (`grepNotFound`) where every matching referrer is hidden, and `total` counts visible referrers; `runExpand` answers exit 3 with no `reason` for a hidden uuid, in scope or not, and lists visible entries and their sidecars only.

**Choices this task makes:**
- **The cut is spliced, never spelled.** recall.mjs calls `asOfEntrySql` once, in `cutTerm`, and `asOfBinds` once, in `cutBinds`, and holds no copy of the predicate's text (case D1, mutant M14). Tasks 3 and 4 reuse `cutOf`, `cutAnd` and `cutBinds`.
- **The store half lives in recall.mjs (R2)**, never in cli.mjs, whose import sets the importing process's umask. It reads the holding copy with its own statement in derive's `copyRows` column names rather than reaching into derive's private statement set.
- **The sidecar arm adds no `s.entry_id IS NOT NULL` term.** It could never red: the predicate is already false over the LEFT JOIN's all-NULL row. Case A3's orphan pins that property at this site.
- **A hidden `hop` ends the walk.** `expandPairedPath` treats a hidden ancestor as one that is not stored (`r === undefined`). It does not skip past it to a grandparent: an absent row has no parent to follow.
- **Statements are prepared per call under a cut.** `visibleEntryIds` makes one statement per call over a `json_each` list, `uuidVisible` one per call, and `aroundRows` one per side. With no cut, none of them prepares anything.

**Residuals, named (R6):**
- **A variant of a visible entry is shown whatever its `first_seen_ms`.** A later copy that rewrote a visible row's body after N stays visible as that row's variant: W2-D35's rule ("follow their entry") as written.
- **A visible node's stored aggregates can count hidden rows** (`src_chars`, `desc_chars`, `earliest_ms`, `latest_ms`, `desc_count`): node-level figures, never entry text.
- **Until Task 4, the regex child scans hidden rows' blobs.** Its matches are dropped in the parent (#1 to #3, case A5), but the child's work, and so whether it reaches `regex-timeout`, still counts them. **Until Task 4, the cursors carry no `asof`.** No CLI path sets a cut in this PR.

- [ ] **Step 0: Check that Task 1's names are on the branch.** From the repository root:

```bash
git log --oneline -1 --grep='W2-2a Task 1'
grep -c '^export function asOfEntrySql(alias) {$' ccd/history/lib.mjs
grep -c '^export function asOfBinds(cut) {$' ccd/history/lib.mjs
grep -c '^export function asOfCut({ asof, boundary, copy, kept }) {$' ccd/history/lib.mjs
```

Expected: one commit line, then `1`, `1`, `1`. Any other count: make no edit, and report the names Task 1 shipped to the coordinator.

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
grep -c '^  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths,$' ccd/history/recall.mjs
grep -c "^import { childrenOf, parentOf, ftsGateFactsOn, blobPlainText, blobPlainTextMeasured, lineageEntries, recoverOpenOn } from './store.mjs';\$" ccd/history/recall.mjs
grep -c '^function bindFor(sql, all) {$' ccd/history/recall.mjs
grep -cF "      FROM m JOIN \${e('e')} ON e.blob_id = m.blob_id" ccd/history/recall.mjs
grep -c '^      WHERE v.blob_id <> e.blob_id$' ccd/history/recall.mjs
grep -c "ON se.entry_id = s.entry_id\$" ccd/history/recall.mjs
grep -c '^    pool: RANK_POOL, now_ms: rc.nowMs,$' ccd/history/recall.mjs
grep -c '^    const e = s.entryByUuid.get(uuid);$' ccd/history/recall.mjs
grep -c 's.before.all(hold.fileId, hold.line, a.before)' ccd/history/recall.mjs
grep -c 'entryIds: expandLineage(rc, s, found.id, node.kind), whole: false' ccd/history/recall.mjs
grep -c '^    const r = s.hop.get(uuid);$' ccd/history/recall.mjs
grep -c "^/\*\* A condensed node's source entries in leaf order" ccd/history/recall.mjs
grep -c "^  grep: Object.freeze(\[...READ_CONTEXT_TABLES, 'blobs', 'entry_variants', 'sidecars', 'nodes', 'node_sources', 'node_children'\]),\$" ccd/history/lib.mjs
grep -c 'derive.mjs' ccd/history/recall.mjs
grep -c 'function cutOf\|function cutTerm\|function cutAnd\|function cutBinds\|function visibleEntryIds\|function uuidVisible\|function aroundRows\|function asOfCutOf' ccd/history/recall.mjs
grep -c 'W2-2a Task 2' server/test/history-recall.test.ts
```

Expected: `1` for each of the first thirteen lines (measured: the fourth line printed `0` under plain `grep -c` because GNU grep reads the mid-pattern `$` as an anchor, so it is a fixed-string `grep -cF` above, which prints `1`), and `0` for the last three (recall.mjs names no derive.mjs yet, the names are free, and nothing is appended yet). A `0` on an anchor line: re-read the region, re-anchor by the same content and record it in the notes; never widen an assertion.

Then record the base counts. Step 7 compares against them. In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
```

Write each `N passed` (and any `skipped`) into `.superpowers/sdd/history-w2-2a/base-counts-task2.txt` (gitignored). Every file must be green at Task 1's commit.

- [ ] **Step 2: Write the failing tests.** Append to `server/test/history-recall.test.ts`, after its last line, never above an existing describe:

```ts

// ── W2-2a Task 2 (W2-D35, W2-D36): the as-of cut at every entry read in recall.mjs ─────────────────────────────
// One family's transcript holds, in file order:
//   1. two stamped rows;
//   2. a NULL-ts row, then a NULL-ts row that boundary N keeps;
//   3. a NULL-ts tool_use and its stamped tool_result;
//   4. boundary N and its summary;
//   5. post-boundary rows stamped exactly T_N, before T_N and after it;
//   6. RANK_POOL + 1 post-boundary rows that outrank row 1 on every sort.
// A second copy of the transcript, in another account's home, gives a visible row and a hidden row each a variant
// body. Three sidecars are linked: one to a visible row, one to a hidden row, one to no row. A second family of the
// same project holds one row stamped before T_N and one after. Every case reads in process (GRX.rc) twice: once with
// rc.scope.cut set to boundary N's cut, and once without it (the CONTROL). The cut is W2-D38's literal shape, measured
// from the store as W2-D34 defines it (cutAt); cut-A6 checks that this task's store half, asOfCutOf, measures the same
// cut (R2).
describe.skipIf(process.platform === 'darwin')('W2-D36: hidden means absent at every entry read in recall.mjs (W2-2a Task 2)', () => {
  const XID = 'claude-a-w2cut';
  const OID = 'claude-a-w2cutb';
  const XT = 'a2c20001';
  const OT = 'a2c20002';
  const XU = t16uuid(XT, 0);
  const OU = t16uuid(OT, 0);
  const c = (i: number): string => t16uuid(XT, i);
  const o = (i: number): string => t16uuid(OT, i);
  const POOL = libRead.RANK_POOL + 1;
  const PAIRED = '/home/u/tree/demo/zqcutpaired.ts';
  const BIG = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'] })), null, 1);
  type Cut = Readonly<{
    asof: string; tsCut: number; boundaryEntryId: number; summaryEntryId: number | null;
    keptUuids: readonly string[]; holdingFileId: number; boundaryLine: number;
  }>;
  type XResult = { exit: number; reason?: string; blocks: string[]; items: Array<Record<string, unknown>>; total: number; next: string[] | null };
  let box: rH.HistoryBox;
  let cut: Cut;
  let leaf = '';

  const noTs = (row: rFx.Row): rFx.Row => { const r = { ...row }; delete r['timestamp']; return r; };
  /** Rows 1 to 11. `variant` is the second copy, whose rows 2 and 9 carry one more word each. */
  const head = (variant: boolean): rFx.Row[] => [
    rFx.userRow({ uuid: c(1), ts: t16ts(1), sessionId: XU, text: 'zqcutvis1 an older note with a single zqcutpool among many other plain words here' }),
    rFx.assistantRow({ uuid: c(2), ts: t16ts(2), parentUuid: c(1), sessionId: XU, text: `zqcutvis2 the answer${variant ? ' zqcutvarvis' : ''}`,
      requestId: 'req_w2cut_2', msgId: 'msg_w2cut_2' }),
    noTs(rFx.userRow({ uuid: c(3), ts: t16ts(3), parentUuid: c(2), sessionId: XU, text: 'zqcutnull1 a row with no timestamp' })),
    noTs(rFx.userRow({ uuid: c(4), ts: t16ts(4), parentUuid: c(3), sessionId: XU, text: 'zqcutkept1 a kept row with no timestamp' })),
    noTs(rFx.toolUseRow({ uuid: c(5), ts: t16ts(5), parentUuid: c(4), sessionId: XU, toolUseId: 'toolu_01W2CUTPAIR', name: 'Read',
      input: { file_path: PAIRED }, requestId: 'req_w2cut_5', msgId: 'msg_w2cut_5' })),
    rFx.toolResultRow({ uuid: c(6), ts: t16ts(6), parentUuid: c(5), sessionId: XU, toolUseId: 'toolu_01W2CUTPAIR', content: BIG }),
    rFx.boundaryRow({ uuid: c(7), ts: t16ts(10), parentUuid: c(6), sessionId: XU, trigger: 'manual', headUuid: c(4), anchorUuid: c(8),
      tailUuid: c(4), allUuids: [c(4)] }),
    rFx.summaryRow({ uuid: c(8), ts: t16ts(11), parentUuid: c(7), sessionId: XU, text: t16summary('zqcutsum') }),
    rFx.assistantRow({ uuid: c(9), ts: t16ts(10), parentUuid: c(8), sessionId: XU, text: `zqcutsame stamped at the cut${variant ? ' zqcutvarhid' : ''}`,
      requestId: 'req_w2cut_9', msgId: 'msg_w2cut_9' }),
    rFx.userRow({ uuid: c(10), ts: t16ts(5), parentUuid: c(9), sessionId: XU, text: 'zqcutback stamped before the cut' }),
    rFx.assistantRow({ uuid: c(11), ts: t16ts(12), parentUuid: c(10), sessionId: XU, text: 'zqcutlate stamped after the cut',
      requestId: 'req_w2cut_11', msgId: 'msg_w2cut_11' }),
  ];
  const pool = (): rFx.Row[] => Array.from({ length: POOL }, (_, i) =>
    rFx.userRow({ uuid: c(100 + i), ts: t16ts(100 + i), sessionId: XU, text: `zqcutpool zqcutpool zqcutpool p${i}` }));

  /** W2-D38's cut for boundary `uuid`, measured as W2-D34 defines it:
   *  - T_N is the boundary's own stamp (the fixture gives it one);
   *  - the holding copy is lib's pickHoldingCopy (a live copy first, then the lowest file_id);
   *  - the summary is the row the boundary's anchor names;
   *  - kept(N) is what the fixture's boundary keeps. */
  function cutAt(db: RDatabaseSync, uuid: string, kept: string[]): Cut {
    const b = db.prepare(`SELECT e.entry_id AS entry_id, e.ts_ms AS ts_ms, e.transcript_pk AS tpk, bd.anchor_uuid AS anchor
      FROM entries e JOIN boundaries bd ON bd.entry_id = e.entry_id WHERE e.uuid = ?`).get(uuid) as unknown as
      { entry_id: number; ts_ms: number | null; tpk: number; anchor: string } | undefined;
    expect(b, 'CONTROL: boundary N is stored with its boundaries row').toBeDefined();
    expect(b!.ts_ms, 'CONTROL: boundary N carries its own stamp').not.toBeNull();
    const copies = db.prepare(`SELECT f.file_id AS file_id, f.source_key AS source_key, mb.line AS line FROM ingest_files f
      LEFT JOIN memberships mb ON mb.file_id = f.file_id AND mb.entry_id = ? WHERE f.transcript_pk = ? ORDER BY f.file_id`)
      .all(b!.entry_id, b!.tpk) as unknown as Array<{ file_id: number; source_key: string; line: number | null }>;
    const held = libRead.pickHoldingCopy(copies.map((x) => ({ fileId: Number(x.file_id), live: x.source_key === '', holds: x.line !== null })));
    expect(held, 'CONTROL: a copy holds boundary N').not.toBeNull();
    const at = copies.find((x) => Number(x.file_id) === held)!;
    const sum = db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(b!.anchor) as unknown as { entry_id: number } | undefined;
    return Object.freeze({
      asof: uuid, tsCut: Number(b!.ts_ms), boundaryEntryId: Number(b!.entry_id), summaryEntryId: sum === undefined ? null : Number(sum.entry_id),
      keptUuids: Object.freeze([...kept].sort()), holdingFileId: Number(held), boundaryLine: Number(at.line),
    });
  }

  beforeAll(async () => {
    box = rH.makeHistoryBox('ccrc-hist-w2cut-');
    const t = t16seed(box, { id: XID, project: 'demo', generation: '0189abcd-1234-4678-9abc-00000000c2a1', uuid: XU, rows: [...head(false), ...pool()] });
    t16seed(box, { id: OID, project: 'demo', generation: '0189abcd-1234-4678-9abc-00000000c2a2', uuid: OU, rows: [
      rFx.userRow({ uuid: o(1), ts: t16ts(3), sessionId: OU, text: 'zqcutbearly stamped before the cut' }),
      rFx.userRow({ uuid: o(2), ts: t16ts(50), parentUuid: o(1), sessionId: OU, text: 'zqcutblate stamped after the cut' }),
    ] });
    // The second copy is ingested after the first, so its two differing bodies are variants, and the first copy (the
    // lower file_id) holds boundary N.
    rH.plantTranscript(box, 'claude-b', path.basename(path.dirname(t)), XU, head(true));
    const dir = path.join(path.dirname(t), XU, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'zqcutvisside.txt'), 'zqcutsidevis a sidecar of a visible row\n');
    fs.writeFileSync(path.join(dir, 'zqcuthidside.txt'), 'zqcutsidehid a sidecar of a hidden row\n');
    fs.writeFileSync(path.join(dir, 'zqcutorphan.txt'), 'zqcutsideorphan a sidecar of no row\n');
    t16scan(box);
    const store = await import('../../ccd/history/store.mjs');
    const w = store.openWriter(libRead.historyPaths(box.home).dbFile);
    try {
      const id = (u: string): number => Number((w.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(u) as { entry_id: number }).entry_id);
      const link = w.prepare('UPDATE sidecars SET entry_id = ? WHERE name LIKE ?');
      expect(Number(link.run(id(c(6)), '%zqcutvisside.txt').changes), 'CONTROL: the visible row\'s sidecar').toBe(1);
      expect(Number(link.run(id(c(3)), '%zqcuthidside.txt').changes), 'CONTROL: the hidden row\'s sidecar').toBe(1);
      expect(Number(link.run(null, '%zqcutorphan.txt').changes), 'CONTROL: the orphan').toBe(1);
    } finally { store.closeWriter(w); }
    leaf = t16leafOf(box, XID);
    const db = rH.openStoreRO(box);
    try { cut = cutAt(db, c(7), [c(4)]); } finally { db.close(); }
  }, 600_000);

  const withCut = (rc: GrepRc, on: boolean): GrepRc => ({ ...rc, scope: { ...rc.scope, cut: on ? cut : null } }) as unknown as GrepRc;
  /** `fn` over ONE read handle: with the cut, then without it (the CONTROL). The handle is closed after. */
  async function both<T>(fn: (mod: GrepMod, rc: GrepRc) => T | Promise<T>): Promise<{ cut: T; none: T }> {
    const mod = await GRX.recall();
    const rc = await GRX.rc(box, XID);
    try { return { cut: await fn(mod, withCut(rc, true)), none: await fn(mod, withCut(rc, false)) }; } finally { rc.db.close(); }
  }
  const grep = async (argv: string[]): Promise<{ cut: GrepVerbResult; none: GrepVerbResult }> => {
    const a = await GRX.grepArgs([...argv, '--json']);
    return both((mod, rc) => mod.runGrep(rc, a));
  };
  const hitUuids = (r: GrepVerbResult): unknown[] => r.items.map((x) => x['entry_uuid']);
  const expandArgs = (a: Record<string, unknown>): Record<string, unknown> => ({ target: null, around: null, before: 5, after: 5, cursor: null, json: true, ...a });
  const expand = (a: Record<string, unknown>): Promise<{ cut: XResult; none: XResult }> =>
    both((mod, rc) => mod.runExpand!(rc, expandArgs(a)) as unknown as XResult);
  /** Every item of an expansion, following its own cursors (at most 20 pages). */
  const pages = (mod: GrepMod, rc: GrepRc, a: Record<string, unknown>): { exit: number; items: Array<Record<string, unknown>>; total: number } => {
    const base = expandArgs(a);
    let r = mod.runExpand!(rc, base) as unknown as XResult;
    const items = [...r.items];
    for (let k = 0; r.exit === 0 && r.next !== null && k < 20; k += 1) {
      r = mod.runExpand!(rc, { ...base, cursor: r.next[r.next.indexOf('--cursor') + 1] }) as unknown as XResult;
      items.push(...r.items);
    }
    return { exit: r.exit, items, total: r.total };
  };
  const entryUuids = (x: { items: Array<Record<string, unknown>> }): unknown[] => x.items.filter((i) => i['kind'] === 'entry').map((i) => i['uuid']);
  const sidecarNames = (x: { items: Array<Record<string, unknown>> }): string => x.items.filter((i) => i['kind'] === 'sidecar').map((i) => String(i['name'])).join(' ');

  it('cut-A0: CONTROL: the fixture is what the cases assume (W2-D34\'s positional hide and its NULL-ts rows)', () => {
    const db = rH.openStoreRO(box);
    try {
      const ts = (u: string): unknown => (db.prepare('SELECT ts_ms FROM entries WHERE uuid = ?').get(u) as { ts_ms: unknown }).ts_ms;
      expect([ts(c(3)), ts(c(4)), ts(c(5))], 'three NULL-ts rows before the boundary').toEqual([null, null, null]);
      expect(Number(ts(c(9))), 'a post-boundary row stamped exactly T_N').toBe(cut.tsCut);
      expect(Number(ts(c(10))), 'a post-boundary row stamped before T_N').toBeLessThan(cut.tsCut);
      const line = (u: string): number => Number((db.prepare(`SELECT m.line AS line FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
        WHERE m.file_id = ? AND e.uuid = ?`).get(cut.holdingFileId, u) as { line: number }).line);
      expect(line(c(6)), 'the tool_result is before the boundary in the holding copy').toBeLessThan(cut.boundaryLine);
      for (const u of [c(9), c(10), c(11), c(100)]) expect(line(u), `${u} is after the boundary in the holding copy`).toBeGreaterThan(cut.boundaryLine);
      expect(cut.summaryEntryId, 'the boundary names its summary row').not.toBeNull();
    } finally { db.close(); }
  });

  it('cut-A1: grep, the entry arm: a NULL-ts row and every post-boundary row of the holding copy are exit 3; a kept row and an earlier stamped row are hits', async () => {
    for (const [word, u] of [['zqcutnull1', c(3)], ['zqcutsame', c(9)], ['zqcutback', c(10)], ['zqcutlate', c(11)]] as const) {
      const r = await grep([word]);
      expect(r.none.exit, `CONTROL ${word}: with no cut it is a hit`).toBe(0);
      expect(hitUuids(r.none), `CONTROL ${word}`).toContain(u);
      expect([r.cut.exit, r.cut.total, r.cut.items], word).toEqual([3, 0, []]);
    }
    for (const [word, u] of [['zqcutvis2', c(2)], ['zqcutkept1', c(4)]] as const) {
      const r = await grep([word]);
      expect(r.cut.exit, `${word} stays visible`).toBe(0);
      expect([...new Set(hitUuids(r.cut))], word).toEqual([u]);
      expect(r.cut.total, `${word}: the cut takes nothing from a visible row`).toBe(r.none.total);
    }
  }, HEAVY);

  it('cut-A2: grep, the variant arm: a hidden entry\'s variant body is no hit, a visible entry\'s is', async () => {
    const db = rH.openStoreRO(box);
    try {
      const n = (u: string): number => Number((db.prepare(`SELECT count(*) AS n FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
        WHERE e.uuid = ? AND v.blob_id <> e.blob_id`).get(u) as { n: number }).n);
      expect([n(c(2)), n(c(9))], 'CONTROL: the second copy gave each row one variant body').toEqual([1, 1]);
    } finally { db.close(); }
    const hid = await grep(['zqcutvarhid']);
    expect([hid.none.exit, hitUuids(hid.none)], 'CONTROL: with no cut the variant is a hit').toEqual([0, [c(9)]]);
    expect([hid.cut.exit, hid.cut.total, hid.cut.items]).toEqual([3, 0, []]);
    const vis = await grep(['zqcutvarvis']);
    expect([vis.cut.exit, hitUuids(vis.cut), vis.cut.total], 'a visible entry\'s variant stays').toEqual([0, [c(2)], 1]);
  }, HEAVY);

  it('cut-A3: grep, the sidecar arm: a sidecar follows its entry, and one linked to no entry is absent', async () => {
    const db = rH.openStoreRO(box);
    try {
      const rows = db.prepare("SELECT name, entry_id FROM sidecars WHERE name LIKE '%zqcut%'").all() as unknown as Array<{ name: string; entry_id: number | null }>;
      expect(rows.map((x) => [path.basename(x.name), x.entry_id === null]).sort(), 'CONTROL: three sidecars, the orphan unlinked').toEqual([
        ['zqcuthidside.txt', false], ['zqcutorphan.txt', true], ['zqcutvisside.txt', false]]);
    } finally { db.close(); }
    for (const word of ['zqcutsidehid', 'zqcutsideorphan']) {
      const r = await grep([word]);
      expect([r.none.exit, r.none.total], `CONTROL ${word}: with no cut it is a hit`).toEqual([0, 1]);
      expect([r.cut.exit, r.cut.total, r.cut.items], word).toEqual([3, 0, []]);
    }
    const vis = await grep(['zqcutsidevis']);
    expect([vis.cut.exit, vis.cut.total], 'a visible row\'s sidecar stays').toEqual([0, 1]);
    expect(String(vis.cut.items[0]!['sidecar'])).toContain('zqcutvisside');
  }, HEAVY);

  it('cut-A4: C27 under the cut: RANK_POOL + 1 hidden rows outrank one visible hit on every sort, and the hit is returned with total 1', async () => {
    const db = rH.openStoreRO(box);
    try {   // CONTROL: globally, the visible row's blob is outside the top RANK_POOL on rank
      const blob = (db.prepare('SELECT blob_id AS b FROM entries WHERE uuid = ?').get(c(1)) as { b: number }).b;
      const top = (db.prepare(`SELECT rowid AS r FROM blobs_fts WHERE blobs_fts MATCH ? ORDER BY rank LIMIT ${libRead.RANK_POOL}`).all('zqcutpool') as unknown as
        Array<{ r: number }>).map((x) => x.r);
      expect(top).toHaveLength(libRead.RANK_POOL);
      expect(top).not.toContain(blob);
    } finally { db.close(); }
    for (const sort of ['relevance', 'recency', 'hybrid']) {
      const r = await grep(['zqcutpool', '--sort', sort]);
      expect([r.none.exit, r.none.total], `CONTROL ${sort}: with no cut every row is a hit`).toEqual([0, POOL + 1]);
      expect(hitUuids(r.none), `CONTROL ${sort}: the visible row is not on the uncut page`).not.toContain(c(1));
      expect([r.cut.exit, hitUuids(r.cut), r.cut.total, r.cut.next], sort).toEqual([0, [c(1)], 1, null]);
    }
  }, HEAVY);

  it('cut-A5: grep --regex: the child matches the hidden row, and the referrer join keeps it out (exit 3)', async () => {
    const r = await grep(['--regex', 'zqcutnul+1']);
    expect([r.none.exit, hitUuids(r.none)], 'CONTROL: with no cut the regex hit is returned').toEqual([0, [c(3)]]);
    expect([r.cut.exit, r.cut.total, r.cut.items]).toEqual([3, 0, []]);
    const vis = await grep(['--regex', 'zqcutkep+t1']);
    expect([vis.cut.exit, hitUuids(vis.cut)], 'a visible row\'s regex match stays').toEqual([0, [c(4)]]);
  }, HEAVY);

  it('cut-A6: asOfCutOf, the store half, measures the cut cutAt measures; a row that is no boundary, an unknown uuid and a sidechain boundary are asof-invalid', async () => {
    const mod = (await GRX.recall()) as unknown as { asOfCutOf(rc: { db: RDatabaseSync }, asof: string): unknown };
    const REFUSED = { ok: false, rc: 2, reason: 'asof-invalid' };
    const at = (asof: string): unknown => {
      const db = rH.openStoreRO(box);
      try { return mod.asOfCutOf({ db }, asof); } finally { db.close(); }
    };
    expect(at(c(7)), 'CONTROL: the store half deep-equals the cut cutAt measured').toEqual({ ok: true, cut });
    expect(at(c(1)), 'a stored row that is no boundary').toEqual(REFUSED);
    expect(at('0189abcd-1234-4678-9abc-0000000000ff'), 'a uuid no row has').toEqual(REFUSED);
    const store = await import('../../ccd/history/store.mjs');
    const w = store.openWriter(libRead.historyPaths(box.home).dbFile);
    const side = (from: string, to: string): number =>
      Number(w.prepare('UPDATE transcripts SET agent_id = ? WHERE cc_session_uuid = ? AND agent_id = ?').run(to, XU, from).changes);
    try {
      expect(side('', 'zqcutside'), 'CONTROL: the transcript is made a sidechain').toBe(1);
      expect(at(c(7)), 'a boundary on a sidechain transcript').toEqual(REFUSED);
    } finally {
      side('zqcutside', '');
      store.closeWriter(w);
    }
    expect(at(c(7)), 'CONTROL: restored, the store half cuts again').toEqual({ ok: true, cut });
  }, HEAVY);

  it('cut-B1: expand <uuid> of a hidden row is exit 3 with no reason; a kept NULL-ts row still expands', async () => {
    for (const u of [c(3), c(9), c(11)]) {
      const r = await expand({ target: u });
      expect(r.none.exit, `CONTROL ${u}: with no cut it expands`).toBe(0);
      expect([r.cut.exit, r.cut.reason, r.cut.items], u).toEqual([3, undefined, []]);
    }
    const kept = await expand({ target: c(4) });
    expect([kept.cut.exit, entryUuids(kept.cut)], 'kept(N) is visible').toEqual([0, [c(4)]]);
  }, HEAVY);

  it('cut-B2: a hidden row outside the scope is exit 3, never out-of-scope: the cut runs before the scope', async () => {
    const late = await expand({ target: o(2) });
    expect([late.none.exit, late.none.reason], 'CONTROL: with no cut it is out of scope').toEqual([2, 'out-of-scope']);
    expect([late.cut.exit, late.cut.reason]).toEqual([3, undefined]);
    const early = await expand({ target: o(1) });
    expect([early.none.exit, early.none.reason]).toEqual([2, 'out-of-scope']);
    expect([early.cut.exit, early.cut.reason], 'CONTROL: a visible row outside the scope stays out of scope').toEqual([2, 'out-of-scope']);
    const around = await expand({ around: o(2), before: 0, after: 0 });
    expect([around.cut.exit, around.cut.reason], '--around names it the same way').toEqual([3, undefined]);
  }, HEAVY);

  it('cut-B3: expand --around runs the cut before its LIMIT: a window past hidden rows reaches the visible rows beyond them', async () => {
    const fwd = await expand({ around: c(1), before: 0, after: 2 });
    expect(entryUuids(fwd.none), 'CONTROL: with no cut the window holds the NULL-ts row').toEqual([c(1), c(2), c(3)]);
    expect(sidecarNames(fwd.none), 'CONTROL: the hidden row brings its sidecar').toContain('zqcuthidside');
    expect(entryUuids(fwd.cut)).toEqual([c(1), c(2), c(4)]);
    expect(sidecarNames(fwd.cut)).not.toContain('zqcuthidside');
    expect(fwd.cut.total).toBe(fwd.cut.items.length);
    const back = await expand({ around: c(6), before: 3, after: 0 });
    expect(entryUuids(back.none), 'CONTROL').toEqual([c(3), c(4), c(5), c(6)]);
    expect(entryUuids(back.cut), '--before 3 past two hidden rows reaches the stamped rows before them').toEqual([c(1), c(2), c(4), c(6)]);
    const hidden = await expand({ around: c(3), before: 1, after: 1 });
    expect([hidden.cut.exit, hidden.cut.reason], 'a hidden anchor is exit 3').toEqual([3, undefined]);
  }, HEAVY);

  it('cut-B4: expand <leaf N> lists only visible entries and the sidecars of visible entries, and its total counts them', async () => {
    const r = await both((mod, rc) => pages(mod, rc, { target: leaf }));
    expect([r.none.exit, r.cut.exit]).toEqual([0, 0]);
    expect(entryUuids(r.none), 'CONTROL: with no cut the lineage holds the NULL-ts rows').toEqual(expect.arrayContaining([c(3), c(5)]));
    expect(sidecarNames(r.none), 'CONTROL').toContain('zqcuthidside');
    expect(entryUuids(r.cut)).toEqual(entryUuids(r.none).filter((u) => u !== c(3) && u !== c(5)));
    expect(sidecarNames(r.cut)).not.toContain('zqcuthidside');
    expect(sidecarNames(r.cut), 'a visible row keeps its sidecar').toContain('zqcutvisside');
    expect(r.cut.total).toBe(r.cut.items.length);
    expect(r.none.total - r.cut.total, 'two hidden entries and one hidden sidecar').toBe(3);
  }, HEAVY);

  it('cut-B5: a hidden tool_use never names the outline\'s file', async () => {
    const r = await expand({ around: c(6), before: 0, after: 0 });
    const item = (x: XResult): Record<string, unknown> => x.items.find((i) => i['kind'] === 'entry' && i['uuid'] === c(6))!;
    expect(item(r.none)['outline_kind'], 'CONTROL: with no cut the paired path makes it a code outline').toBe('code');
    expect(String(item(r.none)['outline']), 'CONTROL: the code outline names the file').toContain('zqcutpaired');
    expect(item(r.cut)['outline_kind'], 'the kind is code in both arms: a shape check, not the guard').toBe('code');
    expect(String(item(r.cut)['outline']), 'no visible pair: the outline names no file').toContain('Code exploration summary:');
    expect(JSON.stringify(r.cut.items) + r.cut.blocks.join('\n')).not.toContain('zqcutpaired');
  }, HEAVY);

  it('cut-D1: the predicate is spelled once, in lib: recall.mjs splices asOfEntrySql and asOfBinds once each and copies neither', () => {
    const src = fs.readFileSync(path.join(REPO, 'ccd', 'history', 'recall.mjs'), 'utf8');
    expect(src, 'no copy of the predicate text').not.toContain(libRead.asOfEntrySql('e'));
    expect(src.match(/\basOfEntrySql\(/g) ?? [], 'one splice point, cutTerm').toHaveLength(1);
    expect(src.match(/\basOfBinds\(/g) ?? [], 'one binding point, cutBinds').toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms. First list what the filter selects:

```bash
(cd server && ./node_modules/.bin/vitest list test/history-recall.test.ts -t 'W2-2a Task 2')
```

Expected: 13 tests. Then run them:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-2a Task 2')
```

Expected (predicted, written before the code): `12 failed | 1 passed`.
- `cut-A0` passes: it reads only the store.
- `cut-A1`: the first loop's cut arm, `[0, 1, [ … ]]` against `[3, 0, []]` for `zqcutnull1`: recall.mjs ignores `rc.scope.cut`.
- `cut-A2`: `[0, 1, [ … ]]` against `[3, 0, []]`.
- `cut-A3`: `zqcutsidehid`'s cut arm, `[0, 1, [ … ]]` against `[3, 0, []]`.
- `cut-A4`: `relevance`'s cut arm, `[0, [ …20 pool uuids ], 2002, [ … ]]` against `[0, [c(1)], 1, null]`.
- `cut-A5`: `[0, 1, [ … ]]` against `[3, 0, []]`.
- `cut-A6`: `TypeError: … asOfCutOf is not a function`.
- `cut-B1`: `[0, undefined, [ … ]]` against `[3, undefined, []]`.
- `cut-B2`: `[2, 'out-of-scope']` against `[3, undefined]`.
- `cut-B3`: `[c(1), c(2), c(3)]` against `[c(1), c(2), c(4)]`.
- `cut-B4`: the cut's list still holds `c(3)`.
- `cut-B5`: the cut's outline names the file (`Code exploration summary (zqcutpaired.ts)`) against `Code exploration summary:` (measured: the first draft paired a `.json` path, whose JSON outline never prints the file's name, so its CONTROL `toContain('zqcutpaired')` failed before the code existed; the fixture now pairs a `.ts` path, whose code outline does name it, and the 'json' against 'code' prediction is replaced by this one. The fixed B5 was never run red before the code: its red was measured through M10, at the line `no visible pair: the outline names no file`).
- `cut-D1`: `[]` against length 1 (`asOfEntrySql(` is not in recall.mjs yet).

Any other failure first (a CONTROL, the beforeAll) is the fixture's: fix the fixture, never the expectation. If `cut-A0` reds, the fixture is not what W2-D34's cases need. For example, a NULL-ts row may not be stored as NULL, or the second copy may have become the holding copy. Re-measure it and fix the rows.

- [ ] **Step 4: Write the code.** From the repository root, run this script. Each replacement asserts its anchor occurs exactly once. The python body is a quoted heredoc, and every block is a raw string.

```bash
python3 - . <<'PYEOF'
import sys
ROOT = sys.argv[1]
P = f'{ROOT}/ccd/history/recall.mjs'
s = open(P).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, (old[:90], s.count(old))
    s = s.replace(old, new)

# 1. The lib import gains Task 1's predicate, its binds and its decision; derive.mjs gives the store half kept(N).
rep(r"""  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths,
""", r"""  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths, asOfEntrySql, asOfBinds, asOfCut,
""")
rep(r"""import { childrenOf, parentOf, ftsGateFactsOn, blobPlainText, blobPlainTextMeasured, lineageEntries, recoverOpenOn } from './store.mjs';
""", r"""import { childrenOf, parentOf, ftsGateFactsOn, blobPlainText, blobPlainTextMeasured, lineageEntries, recoverOpenOn } from './store.mjs';
import { blobReadStmts, keptOf } from './derive.mjs';
""")

# 2. The cut's helpers and the store half, directly after bindFor.
rep(r"""function bindFor(sql, all) {
  const out = {};
  for (const [k, v] of Object.entries(all)) if (new RegExp(`:${k}(?![A-Za-z0-9_])`).test(sql)) out[k] = v;
  return out;
}
""", r"""function bindFor(sql, all) {
  const out = {};
  for (const [k, v] of Object.entries(all)) if (new RegExp(`:${k}(?![A-Za-z0-9_])`).test(sql)) out[k] = v;
  return out;
}

// ── The as-of cut at every entry read (W2-2a Task 2; W2-D35, W2-D36, W2-D38) ─────────────────────────────────────
// lib's asOfEntrySql is the ONE spelling of W2-D34's rule (D-5766 (history-w2-asof-time-cut)), and asOfBinds its
// values. This module only says where the rule is spliced. Every statement here that returns or counts entries
// splices it before its scope term, its ORDER BY and its LIMIT, so a hidden row answers exactly as a row that was never
// stored: exit 3, never out-of-scope (W2-D36; C27's order). With no cut, each splice is '' and the statement is
// unchanged.

/** This read's as-of cut (lib's asOfCut answer, W2-D38), or null for none. A context with no `cut` key reads as none. */
function cutOf(rc) {
  return rc.scope.cut ?? null;
}

/** The cut over one entries alias, as one parenthesised SQL term; '' with no cut. The alias exposes entry_id, uuid and
 *  ts_ms. */
function cutTerm(rc, alias) {
  return cutOf(rc) === null ? '' : `(${asOfEntrySql(alias)})`;
}

/** cutTerm as an `AND` clause; '' with no cut. */
function cutAnd(rc, alias) {
  return cutOf(rc) === null ? '' : ` AND ${cutTerm(rc, alias)}`;
}

/** The cut's named parameters' values, {} with no cut. bindFor keeps each statement's own. */
function cutBinds(rc) {
  const cut = cutOf(rc);
  return cut === null ? {} : asOfBinds(cut);
}

/** The ids among `ids` the cut leaves visible, in `ids`' order; `ids` itself with no cut. The statement is prepared per
 *  call, never cached: EXPAND_STMTS is per handle, and a cut is per read. */
function visibleEntryIds(rc, ids) {
  if (cutOf(rc) === null || ids.length === 0) return ids;
  const sql = `SELECT e.entry_id AS entry_id FROM entries e WHERE e.entry_id IN (SELECT value FROM json_each(:ids))${cutAnd(rc, 'e')}`;
  const keep = new Set(rc.db.prepare(sql).all(bindFor(sql, { ids: JSON.stringify(ids.map(Number)), ...cutBinds(rc) })).map((r) => Number(r.entry_id)));
  return ids.filter((id) => keep.has(Number(id)));
}

/** Whether the row stored under `uuid` is visible: true with no cut; false for a hidden row and for no row. */
function uuidVisible(rc, uuid) {
  if (cutOf(rc) === null) return true;
  const sql = `SELECT e.entry_id AS entry_id FROM entries e WHERE e.uuid = :uuid${cutAnd(rc, 'e')}`;
  return rc.db.prepare(sql).get(bindFor(sql, { uuid, ...cutBinds(rc) })) !== undefined;
}

/** W2-D39's store half (R2): the as-of cut at the boundary whose uuid is `asof`, measured on `rc.db` (nothing else of `rc`
 *  is read) and decided by lib's asOfCut, whose answer it returns unchanged: `{ ok: true, cut }`, or exit 2
 *  `asof-invalid` (D-5765 (history-w2-asof-invalid-word)). It measures the entries row of `asof` joined to its
 *  boundaries row and its transcript (main: agent_id ''); the transcript's files and whether each holds N, the copy
 *  picked by lib's pickHoldingCopy as producerOfLeaf picks it; that copy's rows in derive.mjs's copyRows column names,
 *  in file order; and kept(N) through derive.mjs's keptOf, the set derivation spans with (W2-D34, option (a)). Only
 *  tests call it in W2-2a; W2-2b's env path sets rc.scope.cut from it (W2-D46 step 7). */
export function asOfCutOf(rc, asof) {
  const b = rc.db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.transcript_pk AS transcript_pk, t.agent_id AS agent_id,
      bd.anchor_uuid AS anchor_uuid, bd.kept_blob_id AS kept_blob_id
    FROM entries e JOIN boundaries bd ON bd.entry_id = e.entry_id JOIN transcripts t ON t.transcript_pk = e.transcript_pk
    WHERE e.uuid = :uuid`).get({ uuid: asof });
  if (b === undefined) return asOfCut({ asof, boundary: null, copy: null, kept: [] });
  const boundary = { entryId: Number(b.entry_id), uuid: b.uuid, main: b.agent_id === '', anchorUuid: b.anchor_uuid ?? null };
  const files = rc.db.prepare(`SELECT f.file_id AS file_id, f.source_key AS source_key, mb.line AS line FROM ingest_files f
      LEFT JOIN memberships mb ON mb.file_id = f.file_id AND mb.entry_id = :entry
    WHERE f.transcript_pk = :tpk ORDER BY f.file_id`).all({ entry: b.entry_id, tpk: b.transcript_pk });
  const held = pickHoldingCopy(files.map((f) => ({ fileId: Number(f.file_id), live: f.source_key === '', holds: f.line !== null })));
  const copy = held === null ? null : {
    fileId: held,
    rows: rc.db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.provenance AS provenance,
        e.is_compact_summary AS is_compact_summary, e.ts_ms AS ts_ms
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = :file ORDER BY m.line`).all({ file: held }),
  };
  const kept = keptOf(blobReadStmts(rc.db), b.kept_blob_id === null ? null : Number(b.kept_blob_id), { bytes: 0 });
  return asOfCut({ asof, boundary, copy, kept });
}
""")

# 3. referrerSql: one doc sentence, and the cut in each of its three arms, inside the CTE.
rep(r"""(§6.2: the first body also gets a variant row once a second appears), so it is not counted twice. */
function referrerSql(rc, matchSql) {""", r"""(§6.2: the first body also gets a variant row once a second appears), so it is not counted twice.
 *  Under an as-of cut each arm keeps only the referrers whose entry is visible, inside the CTE, so before the scope
 *  filter, the ranking, the LIMIT and the count (W2-D35, W2-D36; C27). A variant follows its entry, and a sidecar the
 *  entry it is linked to. A sidecar linked to none is absent: lib's predicate is false over the LEFT JOIN's NULL row. */
function referrerSql(rc, matchSql) {""")
rep(r"""      FROM m JOIN ${e('e')} ON e.blob_id = m.blob_id
""", r"""      FROM m JOIN ${e('e')} ON e.blob_id = m.blob_id${cutAnd(rc, 'e')}
""")
rep(r"""      WHERE v.blob_id <> e.blob_id
""", r"""      WHERE v.blob_id <> e.blob_id${cutAnd(rc, 'e')}
""")
rep(r"""        LEFT JOIN ${versioned(rc, 'entries', 'se', ['entry_id', 'uuid', 'ts_ms'])} ON se.entry_id = s.entry_id
  )`;""", r"""        LEFT JOIN ${versioned(rc, 'entries', 'se', ['entry_id', 'uuid', 'ts_ms'])} ON se.entry_id = s.entry_id${cutOf(rc) === null ? '' : `
      WHERE ${cutTerm(rc, 'se')}`}
  )`;""")

# 4. grep's bindings carry the cut's.
rep(r"""    pool: RANK_POOL, now_ms: rc.nowMs,
  };""", r"""    pool: RANK_POOL, now_ms: rc.nowMs,
    ...cutBinds(rc),
  };""")

# 5. expand: --around's neighbours, cut before their LIMIT.
rep(r"""/** A condensed node's source entries in leaf order""", r"""/** --around's neighbours of `hold` in its copy: `n` of them on `side` ('before' or 'after'), nearest first. With no cut,
 *  expand's cached `before` and `after` statements, unchanged. Under an as-of cut each membership is joined to its entry
 *  and the visible ones are kept BEFORE the LIMIT (W2-D36, C27's order), so a hidden row never takes a visible
 *  neighbour's place: `--after 2` past one hidden row reads the two visible rows beyond it. Prepared per call: a cut is
 *  per read, and EXPAND_STMTS is per handle. */
function aroundRows(rc, s, hold, side, n) {
  if (cutOf(rc) === null) return (side === 'before' ? s.before : s.after).all(hold.fileId, hold.line, n);
  const sql = `SELECT mb.entry_id AS entry_id, mb.line AS line FROM memberships mb JOIN entries e ON e.entry_id = mb.entry_id
    WHERE mb.file_id = :file AND mb.line ${side === 'before' ? '<' : '>'} :line${cutAnd(rc, 'e')}
    ORDER BY mb.line ${side === 'before' ? 'DESC' : 'ASC'} LIMIT :n`;
  return rc.db.prepare(sql).all(bindFor(sql, { file: hold.fileId, line: hold.line, n, ...cutBinds(rc) }));
}

/** A condensed node's source entries in leaf order""")

# 6. expand: a hidden uuid is not stored, decided before the scope.
rep(r"""  const entryNamed = (uuid) => {
    const e = s.entryByUuid.get(uuid);
    const hold = e === undefined ? null : expandHolding(s, files, e.entry_id);""", r"""  const entryNamed = (uuid) => {
    const stored = s.entryByUuid.get(uuid);
    // W2-D36: a row the as-of cut hides answers as one never stored, decided BEFORE the scope: exit 3, never out-of-scope.
    const e = stored === undefined || !uuidVisible(rc, uuid) ? undefined : stored;
    const hold = e === undefined ? null : expandHolding(s, files, e.entry_id);""")
rep(r"""      for (const r of s.before.all(hold.fileId, hold.line, a.before).reverse()) ids.push(r.entry_id);
      ids.push(e.entry_id);
      for (const r of s.after.all(hold.fileId, hold.line, a.after)) ids.push(r.entry_id);""", r"""      for (const r of aroundRows(rc, s, hold, 'before', a.before).reverse()) ids.push(r.entry_id);
      ids.push(e.entry_id);
      for (const r of aroundRows(rc, s, hold, 'after', a.after)) ids.push(r.entry_id);""")

# 7. expand: a node's lineage lists its visible entries only (W2-D36); their sidecars follow them in expandItems.
rep(r"""entryIds: expandLineage(rc, s, found.id, node.kind), whole: false };""",
    r"""entryIds: visibleEntryIds(rc, expandLineage(rc, s, found.id, node.kind)), whole: false };""")

# 8. expand: a hidden ancestor never names the outline's file.
rep(r"""    const r = s.hop.get(uuid);
    if (r === undefined) return null;""", r"""    const r = s.hop.get(uuid);
    // A hidden ancestor is absent (W2-D36): the walk ends there, and its tool_use never names the outline's file.
    if (r === undefined || !uuidVisible(rc, uuid)) return null;""")

open(P, 'w').write(s)

# 9. lib.mjs: grep reads memberships through the predicate (R5).
LP = f'{ROOT}/ccd/history/lib.mjs'
ls = open(LP).read()
old = """  grep: Object.freeze([...READ_CONTEXT_TABLES, 'blobs', 'entry_variants', 'sidecars', 'nodes', 'node_sources', 'node_children']),\n"""
assert ls.count(old) == 1, ls.count(old)
open(LP, 'w').write(ls.replace(old, """  grep: Object.freeze([...READ_CONTEXT_TABLES, 'blobs', 'entry_variants', 'sidecars', 'nodes', 'node_sources', 'node_children', 'memberships']),\n"""))
print('recall.mjs: 13 replacements applied; lib.mjs: VERB_TABLES.grep')
PYEOF
grep -c 'asOfEntrySql(' ccd/history/recall.mjs
grep -c 'asOfBinds(' ccd/history/recall.mjs
git diff --stat
```

Expected: `recall.mjs: 13 replacements applied; lib.mjs: VERB_TABLES.grep`, then `1`, `1`, and a diff over `ccd/history/recall.mjs`, `ccd/history/lib.mjs` and `server/test/history-recall.test.ts` only. No comment carries a numeric line citation (`citations.test.ts`, D-5893).

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-2a Task 2')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected: `13 passed`, and tsc clean. `libRead.asOfEntrySql` and `libRead.pickHoldingCopy` are declared in `lib.d.mts` (the first by Task 1). The `cut` key on a `GrepRc` scope is set through `as unknown as GrepRc`, and `asOfCutOf` is reached through a cast at its one call site, so `GrepRc` and `GrepMod` are not edited.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2a/t2/mut.sh`: it applies one exact replacement (or two), asserted to match once, runs its filter and shows red, then restores every file the task edits and checks each with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

First write the helpers, once, after Step 5's green run. They copy the files as they stand then, so a file changed on purpose after this point needs this block run again before any later mutant:

```bash
mkdir -p .superpowers/sdd/history-w2-2a/t2
cat > .superpowers/sdd/history-w2-2a/t2/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2a/t2
FILES="ccd/history/recall.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(s.replace(old, new))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
R=ccd/history/recall.mjs
run() { (cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$1"); }
SH
for f in ccd/history/recall.mjs; do cp "$f" ".superpowers/sdd/history-w2-2a/t2/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms. Never split one mutant across calls: the helpers restore every file when a call exits. If a call's runs would pass 600000 ms on a loaded box, join its filters for the same file into one `-t` regex (`'a|b'`) and read each case's line from that one run. A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M1: the entry arm uncut.
mut "$R" 'ON e.blob_id = m.blob_id${cutAnd(rc, '"'"'e'"'"')}' 'ON e.blob_id = m.blob_id'
run 'cut-A1|cut-A4|cut-A5'; restore
# Expected RED (predicted): 3 failed. A1: zqcutnull1's cut arm [0, 1, …] against [3, 0, []]. A4: total 2002 against 1.
# A5: the regex hit returned.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M2: the variant arm uncut.
mut "$R" 'WHERE v.blob_id <> e.blob_id${cutAnd(rc, '"'"'e'"'"')}' 'WHERE v.blob_id <> e.blob_id'
run 'cut-A1|cut-A2'; restore
# Expected RED (predicted): 2 failed. A2: zqcutvarhid returned under the cut. A1: zqcutsame's variant body (it holds the
# word too) is a hit under the cut.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M3: the sidecar arm uncut.
mut "$R" 'ON se.entry_id = s.entry_id${cutOf(rc) === null ? '"'"''"'"' : `
      WHERE ${cutTerm(rc, '"'"'se'"'"')}`}' 'ON se.entry_id = s.entry_id'
run 'cut-A3'; restore
# Expected RED (predicted): zqcutsidehid's cut arm [0, 1, …] against [3, 0, []]. Under M3, A3's loop stops at
# zqcutsidehid, so the orphan's absence is measured by M3b below, not by M3.
# Measured: red at zqcutsidehid, `[0, 1, …]` against `[3, 0, []]`.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M3b: the sidecar arm keeps a sidecar linked to no entry (the orphan), and still cuts a hidden entry's.
mut "$R" '      WHERE ${cutTerm(rc, '"'"'se'"'"')}`}' '      WHERE (se.entry_id IS NULL OR ${cutTerm(rc, '"'"'se'"'"')})`}'
run 'cut-A3'; restore
# Expected RED (predicted): zqcutsidehid's arm passes (its entry is cut), and the loop's next word, zqcutsideorphan,
# answers [0, 1, …] against [3, 0, []].
# Measured: red at zqcutsideorphan, `[0, 1, …]` against `[3, 0, []]` (sidecar zqcutorphan.txt returned).
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M4: the cut moved after the LIMIT: the entry arm uncut, the ranked pool filtered in JS.
mut "$R" 'ON e.blob_id = m.blob_id${cutAnd(rc, '"'"'e'"'"')}' 'ON e.blob_id = m.blob_id'
mut "$R" '    const pool = rc.db.prepare(rs).all(bindFor(rs, all));' '    const pool = rc.db.prepare(rs).all(bindFor(rs, all)).filter((h) => h.via !== '"'"'entry'"'"' || visibleEntryIds(rc, [h.entry_id]).length === 1);'
run 'cut-A1|cut-A4|cut-A5'; restore
# Expected RED (predicted): 1 failed | 2 passed. A4: relevance's cut arm is [3, [], 0, null] (the top RANK_POOL are all
# hidden, so the filtered page is empty) against [0, [c(1)], 1, null]. A1 and A5 stay GREEN: a post-LIMIT filter is
# right for a small result, so only C27's shape tells the two apart.
# Measured: 1 failed | 2 passed (as predicted): A4 [3, [], 0, null] against [0, [c(1)], 1, null]; A1 and A5 green. The
# shared entry arm is uncut here, so the empty pool answers exit 3 with total 0 at A1's and A5's hidden words.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M4b: only the ranked pool is uncut, and filtered in JS after its LIMIT (countSql keeps the cut).
mut "$R" 'function rankedSql(rc, matchSql, sort) {
  return `${referrerSql(rc, matchSql)}' 'function rankedSql(rc, matchSql, sort) {
  return `${referrerSql({ ...rc, scope: { ...rc.scope, cut: null } }, matchSql)}'
mut "$R" '    const pool = rc.db.prepare(rs).all(bindFor(rs, all));' '    const pool = rc.db.prepare(rs).all(bindFor(rs, all)).filter((h) => h.via !== '"'"'entry'"'"' || visibleEntryIds(rc, [h.entry_id]).length === 1);'
run 'cut-A1|cut-A4|cut-A5'; restore
# Expected RED (predicted): 1 failed | 2 passed. A4: [3, [], 0, null] against [0, [c(1)], 1, null]; A1 and A5 stay GREEN.
# Measured: 1 failed | 2 passed (as predicted): A4 [3, [], 0, null] against [0, [c(1)], 1, null]; A1 and A5 green.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M5: grep's statements without the cut's bindings.
mut "$R" '    ...cutBinds(rc),
  };' '  };'
run 'cut-A1'; restore
# Expected RED (predicted): zqcutvis2 answers exit 3 under the cut. The unbound parameters read NULL, the predicate is
# false everywhere, and every row is hidden.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M6: expand's uuid lookup uncut.
mut "$R" '    const e = stored === undefined || !uuidVisible(rc, uuid) ? undefined : stored;' '    const e = stored;'
run 'cut-B1|cut-B2'; restore
# Expected RED (predicted): 2 failed. B1: [0, undefined, […]] against [3, undefined, []]. B2: [2, 'out-of-scope']
# against [3, undefined].
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M6b: the cut applied after the scope (only to in-scope rows).
mut "$R" '    const e = stored === undefined || !uuidVisible(rc, uuid) ? undefined : stored;' '    const e = stored === undefined || (scopeTranscripts.has(stored.transcript_pk) && !uuidVisible(rc, uuid)) ? undefined : stored;'
run 'cut-B1|cut-B2'; restore
# Expected RED (predicted): 1 failed | 1 passed. B2's late row answers [2, 'out-of-scope'] against [3, undefined]; B1 stays green.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M7: --around uncut.
mut "$R" '  if (cutOf(rc) === null) return (side === '"'"'before'"'"' ? s.before : s.after).all(hold.fileId, hold.line, n);' '  return (side === '"'"'before'"'"' ? s.before : s.after).all(hold.fileId, hold.line, n);'
run 'cut-B3'; restore
# Expected RED (predicted): [c(1), c(2), c(3)] against [c(1), c(2), c(4)].
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M8: --around's cut moved after its LIMIT.
mut "$R" '  if (cutOf(rc) === null) return (side === '"'"'before'"'"' ? s.before : s.after).all(hold.fileId, hold.line, n);' '  if (true) return (side === '"'"'before'"'"' ? s.before : s.after).all(hold.fileId, hold.line, n).filter((r) => cutOf(rc) === null || visibleEntryIds(rc, [r.entry_id]).length === 1);'
run 'cut-B3'; restore
# Expected RED (predicted): [c(1), c(2)] against [c(1), c(2), c(4)].
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M9: a node's lineage uncut.
mut "$R" 'entryIds: visibleEntryIds(rc, expandLineage(rc, s, found.id, node.kind)), whole: false };' 'entryIds: expandLineage(rc, s, found.id, node.kind), whole: false };'
run 'cut-B4'; restore
# Expected RED (predicted): the cut's list still holds c(3) and c(5).
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M10: the paired-path walk uncut.
mut "$R" '    if (r === undefined || !uuidVisible(rc, uuid)) return null;' '    if (r === undefined) return null;'
run 'cut-B5'; restore
# Expected RED (predicted): outline_kind 'json' against 'code'.
# Measured: red at B5's no-visible-pair line: the cut's outline is 'Code exploration summary (zqcutpaired…' against
# 'Code exploration summary:' (predicted: outline_kind 'json' against 'code'; the fixture pairs a .ts path now).
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M11: the store half reads every boundary as a main transcript's.
mut "$R" "  const boundary = { entryId: Number(b.entry_id), uuid: b.uuid, main: b.agent_id === '', anchorUuid: b.anchor_uuid ?? null };" "  const boundary = { entryId: Number(b.entry_id), uuid: b.uuid, main: true, anchorUuid: b.anchor_uuid ?? null };"
run 'cut-A6'; restore
# Expected RED (predicted): 'a boundary on a sidechain transcript' answers { ok: true, cut }.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M12: the store half reads no kept(N).
mut "$R" '  const kept = keptOf(blobReadStmts(rc.db), b.kept_blob_id === null ? null : Number(b.kept_blob_id), { bytes: 0 });' '  const kept = new Set();'
run 'cut-A6'; restore
# Expected RED (predicted): the first CONTROL: keptUuids [] against [ c(4) ].
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M13: visibleEntryIds ignores the cut.
mut "$R" '  if (cutOf(rc) === null || ids.length === 0) return ids;' '  return ids;'
run 'cut-B4'; restore
# Expected RED (predicted): as M9.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M14: a second spelling of the predicate in recall.mjs.
mut "$R" 'WHERE e.uuid = :uuid${cutAnd(rc, '"'"'e'"'"')}' 'WHERE e.uuid = :uuid AND (${asOfEntrySql('"'"'e'"'"')})'
run 'cut-D1'; restore
# Expected RED (predicted): two asOfEntrySql( calls against one.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M15: the store half takes the highest file_id that holds N, not pickHoldingCopy's pick.
mut "$R" "  const held = pickHoldingCopy(files.map((f) => ({ fileId: Number(f.file_id), live: f.source_key === '', holds: f.line !== null })));" '  const held = files.filter((f) => f.line !== null).map((f) => Number(f.file_id)).sort((x, y) => y - x)[0] ?? null;'
run 'cut-A6'; restore
# Expected RED (predicted): the first line, 'CONTROL: the store half deep-equals the cut cutAt measured': holdingFileId is
# the second copy's file_id, not the first's. That line is R2's CONTROL and this guard's red: the fixture's two live
# copies both hold N, so only the pick tells them apart.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M16: the store half no longer requires a boundaries row.
mut "$R" 'FROM entries e JOIN boundaries bd ON bd.entry_id = e.entry_id JOIN transcripts t' 'FROM entries e LEFT JOIN boundaries bd ON bd.entry_id = e.entry_id JOIN transcripts t'
run 'cut-A6'; restore
# Expected RED (predicted): 'a stored row that is no boundary' answers { ok: true, cut: … }, not asof-invalid: c(1) is
# measured as a boundary of a main transcript, held by its copy and stamped.
```

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
# M17: a copy of the predicate's text in recall.mjs, beside the one splice.
printf '// %s\n' "$(node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); process.stdout.write(l.asOfEntrySql('e'))")" >> "$R"
run 'cut-D1'; restore
# Expected RED (predicted): 'no copy of the predicate text': recall.mjs contains asOfEntrySql('e')'s text.
```

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2a/t2/mut.sh
for f in ccd/history/recall.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t2/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
run 'W2-2a Task 2'
```

Expected:
- every mutant red as stated, and no call printing `NOT RESTORED`;
- the last call's loop printing nothing, and its run `13 passed`.

If a mutant stays green, its guard does not hold: report it, and never weaken the mutant to make it red. Record each red's first failing line in the scratch notes.

- [ ] **Step 7: Run the neighbours that read these statements.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C11')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C27')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C59')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C69')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'F7')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```

Expected green. Why the pins outside this task stay as they were:
- **C11** (partial and cursor; `-t 'C11'` selects its two expand cases): the CLI builds every context these cases read with no cut, so `cutOf` answers null at every site:
  - `aroundRows` returns the cached `before` and `after` statements' rows;
  - `visibleEntryIds` returns the very array it was handed;
  - `uuidVisible` answers true.

  The items, positions, `total` and cursors are byte for byte the base's. Task 4 binds the cursor to the cut (W2-D37), and its expand cursor case is C11's shape under a cut.
- **C27**: its family scope is unchanged. With no cut the three arms' SQL text is the base's, character for character, and `bindFor` drops nothing a statement used.
- **C59** (redaction before every cut) and **C69** (the belt at every door): the cut adds no output path and no field. It only removes rows before any rendering, so every string still goes through the same redaction, cut and envelope. C69's `--regex` door is unchanged: this task does not touch the child's job (Task 4's).
- **F7**: it pins Task 12's helper names and `renderHits`' signature and body; neither is edited, and `blobOf` is still called once.
- `history-recall`: the base's count plus 13. `history-cli` and `history-lib`: the base's counts. They read recall.mjs through the CLI with no cut. history-lib's rings describe holds recall.mjs's new derive.mjs import (its ring forbids only `node:sqlite`, `./sweep.mjs` and `./cli.mjs`), and its `VERB_TABLES` case holds grep's `'memberships'`, a v1 table.
- `single-definition -t 'ccrc history'`: green. The W2-D33 pin on `expandEntryText` reading through `expandEntryBody` still holds, because neither function is edited.
- `citations`: green. No added line carries a numeric line citation.

Then the ledger checks:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history/recall.mjs server/test/history-recall.test.ts || echo 'no D-TBD token'
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `no D-TBD token`, then green. D-5765 and D-5766 are cited bare in the new comments; each is defined once, in this plan's "Deviations found", never here.

- [ ] **Step 8: Commit.**

```bash
for f in ccd/history/recall.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t2/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git add ccd/history/recall.mjs ccd/history/lib.mjs server/test/history-recall.test.ts
git status --short
git commit -m "feat(history): the as-of cut at every entry read in recall.mjs, and its store half (W2-2a Task 2; W2-D35, W2-D36, W2-D39)"
```

The loop prints nothing: no mutant is left in a file the commit takes (a `NOT RESTORED` line stops the commit; report it). `git status --short` must list exactly these three files before the commit. Nothing under `.superpowers/` appears: it is gitignored.

---
### Task 3: the node cut: leaves, parents, epochs and their ids at every read door (W2-D35, W2-D36)

Task 1 gave lib one definition of the cut (`asOfCut`, the entry predicate `asOfEntrySql` and its values `asOfBinds`), riding on `rc.scope.cut` (W2-D38). Task 2 applied the predicate where a read verb picks ROWS, and gave recall.mjs `cutOf`, `cutAnd`, `cutBinds` and the store half `asOfCutOf`. A read verb also shows NODES: a leaf's id and gist head every grep group, describe and `--node` resolve ids, tree lists nodes under epochs, and every one of those prints display prefixes measured against the scope's other ids. At the Task 2 commit none of that knows the cut, so under `ASOF=N` a grep hit on a kept(N) row is still grouped under leaf N+1, with leaf N+1's id and gist printed above it: exactly the leak C31 names. This task closes it (W2-D35), and makes every hidden node and epoch ABSENT rather than out of scope (W2-D36).

**Changed after the whole-branch review (D-6282, D-6283; see "## Deviations found").** Two rules below read differently in the shipped code: a leaf other than N's is also hidden when its summary row is hidden (D-6282), and a node is hidden when any condensed node at or below it has no leaf below it, not only when the top has none (D-6283). The ASOF=8 tree, describe and mined-ref expectations for the parent P below changed with the second: P sits over the leafless EMPTY, so P is hidden under ASOF=8 as well, and the cases that need a visible P under that cut take EMPTY away from it first (the "C intact" CONTROL).

The rules, from W2-D35, in lib's one statement (`asOfHiddenNodesSql`, below):
- **A leaf** (any `kind` but `condensed`) is visible iff its `boundary_entry_id`'s entry is visible under W2-D34. A NULL `boundary_entry_id`, or one naming no stored entry, is not visible.
- **A parent** is visible iff every leaf under it is visible, whenever it was formed: the walk goes down `node_children` and never reads `created_ms`.
- **A `condensed` node with no leaf under it** is hidden, fail closed (W2-D35 as amended in place, R4: "only a damaged store holds one").
- **An epoch** is visible iff one of its transcripts holds a visible entry (`asOfVisibleEpochsSql`).
- **Hidden means absent** (W2-D36): a hidden node is removed before the in-scope/out-of-scope split, so it answers exit 3, never `out-of-scope`, and is never one of an ambiguous prefix's candidates; display prefixes are computed over the visible nodes only; N counts only what is visible.

**The sites, found by content in recall.mjs at `cd622b2f6`.** W2-D35 names six; reading every place a node, a parent, an epoch or a node-derived field reaches output found six more doors, the leak lens one more here (describe's mined refs, site 16, R8's SEC-2; its SEC-1, tree's family headings, is Task 4's), and two of W2-D35's names have no reader of their own (Drifts).

| # | Site (anchor; hint at `cd622b2f6`) | Door it guards | What the cut does there | Mutant | Case it reds |
|---|---|---|---|---|---|
| 1 | `coveringLeaves` (about :665) | a grep hit's group: the `── leaf` header and the item's `node_id` | every in-scope covering leaf, hidden ones dropped BEFORE the lower id is taken; a row only a hidden leaf covers has none, so `renderHits` puts it under the live tail | M1, M16 | C31 (case 2: kept(7), and u(1) shared with the lower-id HID) |
| 2 | `leafHeads` (about :676) | the header's time range and gist | a hidden leaf has no head; exported as a test seam (Choices) | M2 | case 3 |
| 3 | `scopePrefixes` (about :655) | the display prefix in grep's headers and every describe line | measured over the visible nodes only | M3 | case 7 |
| 4 | `runTree`'s node list (`const nodes = [];`, about :242) | tree's node lines, `--json` items, N, and tree's own prefixes (`displayPrefixes` over `byId`, about :247) | hidden nodes filtered before `byId` | M4 | cases 4, 5 |
| 5 | `runTree`'s `parentById` (about :249) | `parent_id`, and which nodes are roots | a hidden parent reads as none, so its visible children are roots of their epoch | M5 | case 4 |
| 6 | `runTree`'s epoch loop (about :270, over the `epochs` statement at :258) | the `epoch N cause started= session=` lines | an epoch none of whose transcripts holds a visible row is skipped | M6 | cases 4, 5 |
| 7 | `resolveNodeInScope` (about :441): describe (about :1092), `grep --node` through `nodeEntries` (about :473), and expand's node target (`expandResolve`, about :1406) | an id, a prefix or a pasted line: exit 3 against exit 2 `out-of-scope`, and ambiguity | hidden candidates removed before `resolveScopedId` sees either list | M7 | cases 6, 7 |
| 8 | `runDescribe`'s `parent` (about :1099) | the `parent` line and `parent_id` | a hidden parent reads as none | M8 | case 8 |
| 9 | `sourcesOf` (about :920) | describe's `sources` list and `sources_total` | a hidden source row (a NULL-ts row, W2-D34) is dropped (R5: this task's) | M9 | case 8 |
| 10 | `producerOfLeaf` (about :964) | describe's `producer` | a hidden witness (the first reply after N's summary, under `ASOF=N`) is skipped | M10 | case 8 |
| 11 | `refsOf` (`node_refs`, about :914) | describe's `refs` and `files` of a HIDDEN node | none of its own: its one caller passes an id site 7 resolved, so a hidden node's refs are never read (a visible node's are site 16's) | M7 | case 6 (its refs assertion) |
| 12 | `nodes_fts` | none: no read-path file reads it at `cd622b2f6` | a scan pins that, so a future reader must arrive with a cut | M11 | case 9 |
| 13 | lib `asOfHiddenNodesSql` | every node site above | the leafless rule; the walk down | M13, M14 | cases 4, 5, 6, 8 / 5, 8, 11 |
| 14 | the no-cut path (Task 2's `cutOf`, `cutHiddenNodes`) | W2-D45: nothing set, nothing changes | with no cut the helpers prepare no statement | M15 | case 10 |
| 15 | `childRowsOf` (about :929) | describe's `children` list and `children_total` | a hidden child is dropped; under R4 a visible parent holds one only in a damaged store (a leafless `condensed` child) | M17 | case 8 |
| 16 | `runDescribe`'s `refsAll` (about :1154), through `cutHidesASource` | a VISIBLE node's `refs`, `refs_total`, `files` and `files_total` | a ref of origin `tool_use` is dropped when a source row under the node, its own (a leaf) or a descendant leaf's (a parent), is hidden: it was mined from those rows, and `node_refs` names no row. Refs of origin `model` and `meta`, from the summary written at N, stay (R8, SEC-2; R6) | M18, M19, M20, M21 | case 11 |

Not sites, by construction (each named, so a reviewer can check the claim rather than trust it):
- `expandLineage` (expand's leaves): every LEAF under a visible node is visible, by W2-D35's parent rule. (A non-leaf child need not be: under R4 a leafless `condensed` child of a visible parent is hidden, which only a damaged store holds, so describe's `childRowsOf` is a site, #15. `expandLineage` lists leaves' entries only.)
- `hitFamilies` (about :567) joins epochs to a hit's transcript. A hit is a visible row, so that transcript's epoch holds a visible entry and is visible.
- `transcriptsOf` (about :135), `familiesOf`'s workspace join (about :111) and `scopeHeader`'s counts: the header's counts are Task 4's (W2-D37, R5), and narrowing the scope is W2-D41's (W2-2b).

**Files:** (anchors measured at `cd622b2f6`; Tasks 1 and 2 edit none of these lines. Line numbers are hints only: re-anchor by the quoted content, and Step 1 asserts each anchor occurs once.)
- Modify: `ccd/history/lib.mjs`:
  - three new exports, `asOfHiddenNodesSql`, `asOfVisibleEpochsSql` and `asOfVisibleEntriesSql`, with a section header and doc comments, inserted directly after the closing `}` of Task 1's `export function asOfBinds(cut) {`;
  - `VERB_TABLES`' line `  tree: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_children']),` (about :8515) gains `'memberships'`: under a cut, tree reads it through `asOfEntrySql`'s positional clause, and `VERB_TABLES`' doc comment promises every table each verb reads. `describe` and `expand` already list it; `grep`'s line is Task 2's (R5).
- Modify: `ccd/history/lib.d.mts`: three declarations and their comment line, directly after Task 1's `asOfBinds` declaration (its last line is `};`, the third line of that declaration).
- Modify: `ccd/history/recall.mjs` (it reaches the new lib names through its existing `import * as xlib from './lib.mjs';`, so its named-import block is not edited):
  - the cut helpers `cutHiddenNodes`, `cutVisibleEpochs`, `cutVisibleEntries` and `cutHidesASource` (R8, SEC-2), with a section comment, inserted directly after `` const isoOf = (ms) => (ms === null || ms === undefined ? 'unknown' : `${new Date(Number(ms)).toISOString().slice(0, 16)}Z`); `` (about :85);
  - `runTree` (about :236): the node list (about :242-245), `parentById` (about :249) and the epoch loop's head `    for (const e of epochs.all(f.sessionPk)) {` (about :270);
  - `resolveNodeInScope` (about :441-443);
  - `scopePrefixes` with its doc comment (about :653-659);
  - `coveringLeaves` with its doc comment (about :661-673);
  - `leafHeads` with its doc comment (about :675-681), which gains `export`;
  - `sourcesOf` with its doc comment (about :919-926);
  - `producerOfLeaf`'s `after` statement and `models` generator (about :975-981);
  - `runDescribe`'s `  const parent = parentOf(rc.db, id);` (about :1099);
  - `runDescribe`'s `  const refsAll = refsOf(rc, id).map(...)` line (about :1154; R8, SEC-2);
  - `childRowsOf`'s return line (about :931).
- Test: `server/test/history-recall.test.ts`: one describe appended after the file's last line (about :5853 at `cd622b2f6`, below whatever Tasks 1 and 2 appended), 11 cases, skipped on darwin like every describe there that seeds a store.
- Not edited: Task 2's helpers (`cutOf`, `cutBinds`; reused here, so recall.mjs still calls `asOfBinds` once), `store.mjs` (`childrenOf`, `parentOf` and `lineageEntries` are its own, and recall.mjs filters their answers), `card.mjs`, `regex-worker.mjs` (Task 4's; grouping a hit under a leaf is the parent's `renderHits`), `cli.mjs`, derive.mjs, the spec, README.md, `shared/**`, `deploy/**`, `single-definition.test.ts`.

**Interfaces:**
- Consumes:
  - from Task 1, in lib.mjs (R1; Step 1 counts them and stops on any other):
    - `export function asOfEntrySql(alias)`: one parenthesised boolean SQL term over the `entries` row aliased `alias`, true iff W2-D34 makes that row visible. It reads `memberships` (the positional clause), and its only parameters are named `asof_*` ones, exactly the keys of `asOfBinds(cut)`.
    - the cut object on `rc.scope.cut`: `AsOfCut`, `{ asof, tsCut, boundaryEntryId, summaryEntryId: number | null, keptUuids: readonly string[], holdingFileId, boundaryLine }` (W2-D38), frozen. An absent `cut` key and `cut: null` both mean "no cut".
  - from Task 2, in recall.mjs: `cutOf(rc)` (`rc.scope.cut ?? null`) and `cutBinds(rc)` (`asOfBinds(cut)`, or `{}`), module-private, reused here; `asOfCutOf(rc, asof)`, the store half, which case 1 checks against this describe's own `cutAt` (R2); and the predicate at grep's referrer join, expand's items and `--around`. This task's cases rely on Task 2 only for the claim that case 2's grep hit (a kept(7) row stamped before `T_7`) is visible. The regex child's job is Task 4's.
  - base, unchanged: recall.mjs's `bindFor(sql, all)` (about :353), `versioned`, `displayPrefixes` and `resolveScopedId` (lib), `parentOf`, `childrenOf` and `lineageEntries` (store.mjs; recall.mjs's named import already holds all three; `lineageEntries(db, nodeId)` answers every source entry under a node, a leaf's own or every leaf's below a parent, as `{ nodeId, entryId, ord, tsMs }`); W2-1's derive.mjs exports `blobReadStmts(db)` and `keptOf(s, blobId, budget)` (the test's cut builder); tests: `GRX` (`rc`, `grepArgs`, `spyDb`), `GrepRc`, `GrepVerbResult`, `RGrepArgs`, `rH`, `rFx`, `libRead`, `RDatabaseSync`, `REPO`, `fs`, `path` and `HEAVY` from history-recall's own top level.
- Produces:
  - `lib.mjs`:
    - `export function asOfHiddenNodesSql(): string`. A statement with one column, `node_id`: of the node ids bound as a JSON array at `:asof_nodes`, those the cut hides. Its parameters are `asOfBinds(cut)`'s plus `asof_nodes`. An id that names no node answers nothing. W2-5b's card parent (W2-D75) and its re-check (W2-D78(iii)(c)) are meant to ask this same statement.
    - `export function asOfVisibleEpochsSql(): string`. One column, `cc_session_uuid`: of the epoch session uuids bound as a JSON array at `:asof_epochs`, those one of whose transcripts holds a row the cut shows.
    - `export function asOfVisibleEntriesSql(): string`. One column, `entry_id`: of the entry ids bound as a JSON array at `:asof_entries`, those the cut shows.
    - `VERB_TABLES.tree` gains `'memberships'`.
  - `lib.d.mts`: the three declarations, each `(): string`.
  - `recall.mjs`:
    - `export function leafHeads(rc, ids): Map<string, { node_id, earliest_ms, latest_ms, gist }>`, as before, minus every id the cut hides. Exported as a test seam only.
    - module-private: `cutHiddenNodes(rc, ids): Set<string>` (empty with no cut, and no statement prepared); `cutVisibleEpochs(rc, uuids): Set<string> | null` and `cutVisibleEntries(rc, entryIds): Set<number> | null` (null with no cut, and no statement prepared); `cutHidesASource(rc, id): boolean`, whether the cut hides a source row under node `id` (false with no cut, and nothing read; R8, SEC-2).
    - every read verb's answer under a cut, as the site table says. With no cut, every statement and answer is the base's (W2-D45).

**Choices this task makes:**
- **The node rule is one lib statement, not a fragment.** "Every leaf under it" needs a walk down `node_children`. A recursive CTE correlated with an outer row is not something this tree uses anywhere, so the walk is a top-level `WITH RECURSIVE` over a JSON list of candidate ids, and recall.mjs asks it once per site for the ids that site is about to show. It is lib's (W2-D38: one definition), built on Task 1's `asOfEntrySql`, so a leaf is judged by exactly the entry rule rows are judged by, and W2-5b reads the same text.
- **Named-only statements; the base's statements keep their text.** Each new statement binds by name through `bindFor`, as grep's do. No base statement gains a cut clause: under a cut, recall.mjs runs the base statement (or, for `coveringLeaves`, `sourcesOf` and `producerOfLeaf`, the same text with one more selected column or no `GROUP BY`) and filters its answer by the helper's set. So the read path with no cut prepares byte-identical statements (case 10 pins it), and no statement mixes `?` and `:name` parameters.
- **`coveringLeaves` drops hidden leaves before it takes the lower id.** At the base, `min(ns.node_id)` picks one leaf per row in SQL. Filtering after that min would group a row two fork leaves share under the live tail whenever the lower one is hidden, though a visible leaf covers it. So under a cut the statement answers every (row, leaf) pair, and the min is taken over the visible pairs in JS. Node ids are ASCII, so JS `<` is SQLite's BINARY order. C31's second half pins the order: HID, hidden under cut 7 and lower in id than leaf 1, shares u(1) with it, so u(1) groups under leaf 1, and mutant M16 (the base min, then a filter) answers the live tail there.
- **`leafHeads` keeps its own cut and is exported as a test seam.** W2-D35 names it, and its cut is the one that stops a gist printing if a later edit hands it an uncut id. But `renderHits` only ever passes it ids `coveringLeaves` has already cut, so no read verb can show its guard red alone, and a guard no case can red is a request, not a mechanism (CLAUDE.md's doctrine). Case 3 calls it directly, as `describePageEnd` is exported for HA2 H-16. `renderHits` is not changed to re-group a headless leaf: that would make M1 green, and W2-D35 requires that a mutant leaving `coveringLeaves` uncut goes red.
- **A leafless `condensed` node is hidden (R4).** "A parent is visible iff every descendant leaf is visible" would be vacuously true for a `condensed` node with no leaf under it. Only a damaged store holds one, and nothing about it can be checked against the cut, so it is hidden (fail closed). W2-D35 is amended in place by the coordinator to say so; this is not a departure and takes no number. Mutant M13 pins it.
- **describe's producer reads only visible witnesses.** `producerOfLeaf` names the backend of the first assistant row after a leaf's summary. For leaf N under `ASOF=N`, every such row is after N's boundary in N's holding copy, so it is hidden (W2-D34's positional clause), and the producer is `unknown`. Printing `anthropic` there would be a field of a hidden row. W2-D35 does not list this door; W2-D36 covers it ("a cut-hidden row ... answers exactly as if it were not stored").
- **describe's source list drops hidden rows.** A visible leaf can hold NULL-ts source rows, which W2-D34 hides. Their uuids are a describe door, and this task owns it and the producer's witnesses (R5). Both base statements keep their text (one more selected column under a cut) and are filtered by `asOfVisibleEntriesSql`'s set; neither has a LIMIT, so filtering after the read loses nothing.
- **describe's children drop a hidden child.** By the parent rule every LEAF under a visible node is visible, but under R4 a leafless `condensed` child is hidden while its parent may be visible; only a damaged store holds one. `childRowsOf` filters it, so its id, kind and size never print and `children_total` does not count it. The fixture lists EMPTY as a child of the parent, and mutant M17 reds the describe case.
- **A hidden node's `node_refs` and `nodes_fts` get no site of their own.** `refsOf`'s one caller is `runDescribe`, after site 7 has resolved the id, so a hidden node's refs are never read; a second guard in `refsOf` would sit in series behind M7 and could never be shown red. No read-path file reads `nodes_fts` at the base. Case 6 asserts a hidden node's ref value never prints, under M7's mutant too, and case 9 pins that `nodes_fts` has no reader.
- **A visible node's mined refs are cut at describe, fail closed (R8, SEC-2).** derive.mjs's `minedRefs` writes `origin = 'tool_use'` refs from the `tool_use` blocks of a span's assistant rows; a parent's refs roll up its children's. `node_refs` names no row, so a ref cannot be traced to the row it came from: when ANY source row under the node, its own (a leaf) or a descendant leaf's (a parent), is one the cut hides, every `tool_use` ref of the node is dropped before `refsAll` is built, so `files` (derived from `refsAll`) and both `_total` counts follow. Refs of origin `model` and `meta` come from the summary written at N and stay (R6). The question is `cutHidesASource`: store.mjs's `lineageEntries` (the walk down `node_children` that expand's node target already reads) lists the rows, and `cutVisibleEntries` (lib's `asOfVisibleEntriesSql`) judges them, so no rule is spelled in recall.mjs. With no cut it returns `false` before reading anything, so describe prepares the base's statements (case 10). The fixture's visible leaf with a hidden source row is leaf 1 (its NULL-ts reply u(2), hidden under every cut): R8 says "leaf N", and no leaf N of this fixture holds a hidden row, so case 11 reads leaf 1 under cut 7 for the drop, leaf 7 (leaf N under cut 7, every row visible) as the CONTROL that keeps a mined ref, and the parent under cut 8 for the descendant walk. Mutants M18 (no filter), M19 (the node's own rows only), M20 (every origin dropped) and M21 (dropped whenever a cut is set) each red it.

**Residuals, named (R6):**
- A hidden node's own `src_chars`, `desc_count` and `desc_chars` are never printed, but a VISIBLE node's are its stored values, computed over all its sources, hidden ones included. For a visible leaf with a NULL-ts source row, `chars=` on its parent's child line counts that row. These are node-level figures, not entry content, and recomputing them per read would put the derivation's cost on every describe.
- A visible leaf's gist and summary may describe NULL-ts rows the cut hides. The summary row is N's own (W2-D34 keeps it visible), written at N, so this is what was known at N.
- A visible node's refs of origin `model` and `meta` stay under a cut, for the same reason: they come from the summary written at N (R6, R8). Its `tool_use` refs go whenever a source row under it is hidden, even a ref that came from a visible row (fail closed: `node_refs` names no row).
- The helpers cost one statement per site per call under a cut, `producerOfLeaf` one per witness row it skips, and describe's mined-refs check one lineage walk plus one statement over every row under the node (R8); with no cut they cost nothing.

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'base holds W2-1' || echo 'STOP: W2-1 (#1105) is not on this base'
```

Expected: `base holds W2-1`. On `STOP`, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, Task 1's names, that no new name is taken, and the base counts.** From the repository root:

```bash
grep -c '^export function asOfEntrySql(alias) {$' ccd/history/lib.mjs
grep -c '^export function asOfBinds(cut) {$' ccd/history/lib.mjs
grep -c '^function cutOf(rc) {$' ccd/history/recall.mjs
grep -c '^function cutBinds(rc) {$' ccd/history/recall.mjs
grep -c '^export function asOfCutOf(rc, asof) {$' ccd/history/recall.mjs
grep -c "^  tree: Object.freeze(\[...READ_CONTEXT_TABLES, 'nodes', 'node_children'\]),$" ccd/history/lib.mjs
grep -c '^const isoOf = (ms) => ' ccd/history/recall.mjs
grep -c '^  const nodes = \[\];$' ccd/history/recall.mjs
grep -c '^  const parentById = new Map(nodes.map((n) => \[n.node_id, parentOf(db, n.node_id)\]));$' ccd/history/recall.mjs
grep -c '^    for (const e of epochs.all(f.sessionPk)) {$' ccd/history/recall.mjs
grep -c '^export function resolveNodeInScope(rc, wanted) {$' ccd/history/recall.mjs
grep -c '^function scopePrefixes(rc) {$' ccd/history/recall.mjs
grep -c '^function coveringLeaves(rc, entryIds) {$' ccd/history/recall.mjs
grep -c '^function leafHeads(rc, ids) {$' ccd/history/recall.mjs
grep -c '^function sourcesOf(rc, id) {$' ccd/history/recall.mjs
grep -c '^function producerOfLeaf(rc, n) {$' ccd/history/recall.mjs
grep -c '^  const parent = parentOf(rc.db, id);$' ccd/history/recall.mjs
grep -c '^  const refsAll = refsOf(rc, id).map((r) => ({ kind: r.kind, value: redactForDisplay(r.value, rc.pairIdx), origin: r.origin }));$' ccd/history/recall.mjs
grep -c '^  return childrenOf(rc.db, id).slice().sort((x, y) => x.ord - y.ord).map((c) => st.get(c.childId)).filter((r) => r !== undefined);$' ccd/history/recall.mjs
grep -c 'nodes_fts' ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs
grep -c 'cutHiddenNodes\|cutVisibleEpochs\|cutVisibleEntries\|cutHidesASource\|minedHidden\|asOfHiddenNodesSql\|asOfVisibleEpochsSql\|asOfVisibleEntriesSql' ccd/history/*.mjs ccd/history/lib.d.mts server/test/history-recall.test.ts
```

Expected: 1 for each of the first nineteen lines; 0 in every file for the last two. A 0 on any of the first five lines means Task 1 or Task 2 shipped another name: stop and report the names shipped. Any other mismatch: stop and report.

Then record the base counts. Step 8 compares against them. In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'VERB_TABLES|missingTablesAt')
```

Write each `N passed` (and any `skipped`) into `.superpowers/sdd/history-w2-2a/base-counts-task3.txt` (gitignored). Both must be green at this base. A red file is re-run alone (CLAUDE.md's load flakes) before it is reported.

- [ ] **Step 2: Write the failing tests.** Append to `server/test/history-recall.test.ts`, after its last line, never above an existing describe:

```ts

// ── W2-2a Task 3 (W2-D35, W2-D36): the node cut ─────────────────────────────────────────────────────────────────────
// The as-of cut (lib's asOfCut, Task 1) rides on rc.scope.cut. W2-2a turns no CCRC_RECALL_* variable into a cut (W2-2b's
// W2-D40 does), so every case here runs in-process over a ReadContext built by GRX.rc, with a cut this describe measures
// from the store by W2-D38's own fields. One box:
//   - family A: eight manual compactions, so eight leaves and the parent over them, and a reply with no timestamp inside
//     leaf 1's span (hidden under every cut, W2-D34);
//   - written by hand after derivation, with no sweep after it: two crafted leaves of A that share 19 hex digits (VIS, bound
//     to boundary 1, and HID, bound to boundary 8, whose id sorts below every derived leaf's and which also covers u(1), a
//     row leaf 1 covers), a condensed node of A with no leaf under it (EMPTY), also listed as a child of the parent (a
//     damaged store, R4), a second epoch of A whose transcript holds only rows stamped after both cuts, and two crafted
//     leaves of family B, out of A's scope (OUT_VIS on boundary 1, OUT_HID on boundary 8);
//   - refs written by hand (R8, SEC-2): one mined ref (origin tool_use) each on leaf 1, leaf 7 and the parent, and one
//     summary ref (origin model) each on leaf 1 and the parent.
// Cut 7 is ASOF = boundary 7; cut 8 is ASOF = boundary 8, each measured by this describe's cutAt; case 1 checks that
// Task 2's store half, asOfCutOf, measures the same two cuts (R2).
describe.skipIf(process.platform === 'darwin')('W2-D35: the as-of cut hides nodes, epochs and their ids at every read door (W2-2a Task 3)', () => {
  type W35Cut = Readonly<{
    asof: string; tsCut: number; boundaryEntryId: number; summaryEntryId: number | null; keptUuids: readonly string[];
    holdingFileId: number; boundaryLine: number;
  }>;
  type W35Rc = GrepRc & { gen: string | null; scopeArgs: string[]; scope: GrepRc['scope'] & { cut?: W35Cut | null } };
  type W35Recall = {
    runGrep(rc: W35Rc, a: RGrepArgs): GrepVerbResult;
    runTree(rc: W35Rc, a: { depth: number; json: boolean }): GrepVerbResult;
    runDescribe(rc: W35Rc, a: { target: string; full: boolean; cursor: string | null; json: boolean }): GrepVerbResult;
    runExpand(rc: W35Rc, a: { target: string; around: null; before: number; after: number; cursor: null; json: boolean }): GrepVerbResult;
    leafHeads(rc: W35Rc, ids: string[]): Map<string, { node_id: string; gist: string | null }>;
    asOfCutOf(rc: { db: RDatabaseSync }, asof: string): unknown;
  };
  type W35Derive = {
    blobReadStmts(db: RDatabaseSync): Record<string, unknown>;
    keptOf(s: Record<string, unknown>, blobId: number | null, budget: { bytes: number }): Set<string>;
  };
  const A = 'claude-a-w2d35';
  const B = 'claude-b-w2d35';
  const TXA = '2d35aaaa-0000-4000-8000-000000000001';
  const TXB = '2d35bbbb-0000-4000-8000-000000000002';
  const GA = '0189abcd-1234-4678-9abc-00000000d351';
  const GB = '0189abcd-1234-4678-9abc-00000000d352';
  const T0W = Date.UTC(2026, 9, 2, 10, 0, 0);
  const ts = (k: number): string => new Date(T0W + k * 1000).toISOString();
  const ms = (k: number): number => T0W + k * 1000;
  /** Row uuids. Cycle c: u(5c-4) the ask, u(5c-3) the reply, u(5c-2) the kept follow-up, u(5c-1) the boundary, u(5c) the summary. */
  const u = (i: number): string => `2d35eeee-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
  const bnd = (c: number): string => u(5 * c - 1);
  const kept = (c: number): string => u(5 * c - 2);
  const hex20 = (head: string, last: string): string => `${head}${'0'.repeat(20 - head.length - last.length)}${last}`;
  const VIS = `L${hex20('000001', '2')}`;
  const HID = `L${hex20('000001', '1')}`;   // the lower of the two, and below every derived leaf's id
  const EMPTY = `N${hex20('e0e0e0', '1')}`;
  const OUT_VIS = `L${hex20('d00d00', '1')}`;
  const OUT_HID = `L${hex20('d00d01', '1')}`;
  /** The shortest display prefix any read verb prints for an id: its letter and NODE_ID_DISPLAY_MIN (6) hex digits. */
  const pre7 = (id: string): string => id.slice(0, 7);
  const all = (r: GrepVerbResult): string => JSON.stringify(r);
  const ans = (r: GrepVerbResult): unknown[] => [r.exit, r.reason];

  let box: rH.HistoryBox;
  let R: W35Recall;
  let L: string[] = [];   // L[c - 1] is leaf c, found by its boundary
  let P = '';
  let parentCreatedMs = 0;
  let cut7: W35Cut;
  let cut8: W35Cut;

  function rowsA(): rFx.Row[] {
    const rows: rFx.Row[] = [];
    const base = { sessionId: TXA, cwd: '/home/u/worktrees/p/quiet-basin' };
    for (let c = 1; c <= 8; c += 1) {
      rows.push(rFx.userRow({ ...base, uuid: u(5 * c - 4), ts: ts(5 * c), text: `zqw2d35ask${c} fixture request` }));
      const reply = rFx.assistantRow({ ...base, uuid: u(5 * c - 3), ts: ts(5 * c + 1), text: `zqw2d35reply${c} fixture answer`,
        requestId: `req_w2d35_${c}`, msgId: `msg_w2d35_${c}` });
      if (c === 1) delete reply['timestamp'];   // leaf 1's NULL-ts row: hidden under every cut (W2-D34)
      rows.push(reply);
      rows.push(rFx.userRow({ ...base, uuid: kept(c), ts: ts(5 * c + 2), text: `zqw2d35kept${c} fixture follow-up` }));
      rows.push(rFx.boundaryRow({ ...base, uuid: bnd(c), ts: ts(5 * c + 3), trigger: 'manual', headUuid: kept(c), anchorUuid: u(5 * c),
        tailUuid: kept(c), allUuids: [kept(c)] }));
      rows.push(rFx.summaryRow({ ...base, uuid: u(5 * c), ts: ts(5 * c + 4), text: [
        'This session is being continued from a previous conversation. The summary below covers the earlier portion.',
        '<summary>', '1. Primary Request and Intent:', `   The fixture request ${c}.`,
        '8. Current Work:', `   Wrote zqw2d35gist${c} of the fixture.`,
        '9. Optional Next Step:', `   Continue past zqw2d35gist${c}.`, '</summary>',
      ].join('\n') }));
    }
    return rows;
  }

  /** W2-D38's fields for ASOF = `boundaryUuid`, measured from the store: the boundary's own stamp (every boundary here has
   *  one), its holding copy by lib's pickHoldingCopy rule (a live copy first, then the lowest file_id) and its line there,
   *  the summary row its anchor names, and kept(N) through derive.mjs's keptOf. */
  function cutAt(db: RDatabaseSync, d: W35Derive, boundaryUuid: string): W35Cut {
    const b = db.prepare(`SELECT e.entry_id AS entry_id, e.ts_ms AS ts_ms, e.transcript_pk AS tpk, b.anchor_uuid AS anchor,
        b.kept_blob_id AS kept FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?`).get(boundaryUuid) as
      { entry_id: number; ts_ms: number; tpk: number; anchor: string; kept: number | null };
    const hold = db.prepare(`SELECT f.file_id AS file_id, m.line AS line FROM ingest_files f
        JOIN memberships m ON m.file_id = f.file_id AND m.entry_id = ?
      WHERE f.transcript_pk = ? ORDER BY (f.source_key = '') DESC, f.file_id LIMIT 1`).get(b.entry_id, b.tpk) as { file_id: number; line: number };
    const summary = db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(b.anchor) as { entry_id: number };
    const keptSet = d.keptOf(d.blobReadStmts(db), b.kept === null ? null : Number(b.kept), { bytes: 0 });
    return Object.freeze({
      asof: boundaryUuid, tsCut: Number(b.ts_ms), boundaryEntryId: Number(b.entry_id), summaryEntryId: Number(summary.entry_id),
      keptUuids: Object.freeze([...keptSet].sort()), holdingFileId: Number(hold.file_id), boundaryLine: Number(hold.line),
    });
  }

  /** A ReadContext for A's family with `cut` on its scope; undefined leaves the key out, as every pre-W2-2a context does. */
  async function rcOf(cut: W35Cut | null | undefined): Promise<W35Rc> {
    const rc = await GRX.rc(box, A);
    return { ...rc, gen: rc.scope.generation, scopeArgs: [], scope: { ...rc.scope, ...(cut === undefined ? {} : { cut }) } };
  }
  /** `f` over a fresh read handle carrying `cut`, closed after. */
  async function under<T>(cut: W35Cut | null | undefined, f: (rc: W35Rc) => T): Promise<T> {
    const rc = await rcOf(cut);
    try { return f(rc); } finally { rc.db.close(); }
  }
  const describeOf = (target: string) => (rc: W35Rc): GrepVerbResult => R.runDescribe(rc, { target, full: false, cursor: null, json: true });
  const expandOf = (target: string) => (rc: W35Rc): GrepVerbResult =>
    R.runExpand(rc, { target, around: null, before: 5, after: 5, cursor: null, json: true });
  const treeOf = (rc: W35Rc): GrepVerbResult => R.runTree(rc, { depth: 2, json: true });
  const treeIds = (r: GrepVerbResult): string[] => r.items.map((i) => String(i['node_id'])).sort();

  beforeAll(async () => {
    box = rH.makeHistoryBox('ccrc-hist-w2d35-');
    rH.seedFamily(box, { id: A, project: 'demo', uuid: TXA, generation: GA, rows: rowsA() });
    rH.seedFamily(box, { id: B, project: 'demo', uuid: TXB, generation: GB, accountId: 'claude-b',
      rows: [rFx.userRow({ uuid: u(100), ts: ts(100), sessionId: TXB, text: 'zqw2d35other family row' })] });
    for (let i = 0; i < 2; i += 1) { const s = rH.runSweep(box); expect(s.code, s.stderr).toBe(0); }   // derivation shares the run budget
    const w = new RDatabaseSync(libRead.historyPaths(box.home).dbFile);
    try {
      const leaves = w.prepare(`SELECT n.node_id AS node_id, e.uuid AS b FROM nodes n JOIN entries e ON e.entry_id = n.boundary_entry_id
        WHERE n.kind <> 'condensed'`).all() as { node_id: string; b: string }[];
      L = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => leaves.find((r) => r.b === bnd(c))?.node_id ?? '');
      const parents = w.prepare("SELECT node_id, created_ms FROM nodes WHERE kind = 'condensed'").all() as { node_id: string; created_ms: number }[];
      P = parents.length === 1 ? parents[0]!.node_id : '';
      parentCreatedMs = parents.length === 1 ? Number(parents[0]!.created_ms) : 0;
      type Home = { session_pk: number; epoch_seq: number; transcript_pk: number };
      const a = w.prepare('SELECT session_pk, epoch_seq, transcript_pk FROM nodes WHERE node_id = ?').get(L[0]!) as Home;
      const b = w.prepare(`SELECT s.session_pk AS session_pk, e.seq AS epoch_seq, t.transcript_pk AS transcript_pk FROM sessions s
          JOIN epochs e ON e.session_pk = s.session_pk JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid
        WHERE s.ccrc_id = ? AND e.confirmed_ms IS NOT NULL`).get(B) as Home;
      const entryOf = (uuid: string): number => Number((w.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number }).entry_id);
      const ins = w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
        summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
        directive_flag, capped, parser_version, created_ms)
        VALUES (?, ?, ?, ?, ?, ?, 'fixture', ?, NULL, NULL, ?, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`);
      const now = Date.now();
      ins.run(VIS, a.session_pk, a.epoch_seq, a.transcript_pk, 'native_leaf', 0, 'zqw2d35craftvis gist', entryOf(bnd(1)), ms(8), ms(8), now);
      ins.run(HID, a.session_pk, a.epoch_seq, a.transcript_pk, 'native_leaf', 0, 'zqw2d35crafthid gist', entryOf(bnd(8)), ms(43), ms(43), now);
      ins.run(EMPTY, a.session_pk, a.epoch_seq, a.transcript_pk, 'condensed', 1, 'zqw2d35craftempty gist', null, ms(8), ms(8), now);
      ins.run(OUT_VIS, b.session_pk, b.epoch_seq, b.transcript_pk, 'native_leaf', 0, 'zqw2d35outvis gist', entryOf(bnd(1)), ms(8), ms(8), now);
      ins.run(OUT_HID, b.session_pk, b.epoch_seq, b.transcript_pk, 'native_leaf', 0, 'zqw2d35outhid gist', entryOf(bnd(8)), ms(43), ms(43), now);
      // EMPTY is also a child of the parent (a damaged store, R4): the parent stays visible by its leaves, EMPTY never is.
      w.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)').run(P, EMPTY, 8);
      // HID also covers u(1), which leaf 1 covers: two in-scope leaves share one row, and HID's id is the lower.
      w.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, ?)').run(HID, entryOf(u(1)), 0);
      const ref = w.prepare("INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, 'path', ?, 'model')");
      ref.run(VIS, '/home/u/tree/zqw2d35refvis');
      ref.run(HID, '/home/u/tree/zqw2d35refhid');
      // R8 (SEC-2): refs a derivation mines from source rows (origin tool_use). Leaf 1 holds u(2), hidden under every cut, so
      // its mined ref may come from that row; leaf 7 (leaf N under cut 7) holds no hidden row; the parent holds u(2) through
      // leaf 1. The model refs beside them stand for what the summary written at N names, and stay.
      const mined = w.prepare("INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, 'path', ?, 'tool_use')");
      mined.run(L[0]!, '/home/u/tree/zqw2d35minedrow1');
      mined.run(L[6]!, '/home/u/tree/zqw2d35minedrow7');
      mined.run(P, '/home/u/tree/zqw2d35minedparent');
      ref.run(L[0]!, '/home/u/tree/zqw2d35modelrow1');
      ref.run(P, '/home/u/tree/zqw2d35modelparent');
      const seq = Number((w.prepare('SELECT max(seq) AS m FROM epochs WHERE session_pk = ?').get(a.session_pk) as { m: number }).m) + 1;
      w.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(a.session_pk, seq, TXB, 'clear', 'fixture', ms(99), ms(99));
      const d = (await import('../../ccd/history/derive.mjs')) as unknown as W35Derive;
      cut7 = cutAt(w, d, bnd(7));
      cut8 = cutAt(w, d, bnd(8));
    } finally { w.close(); }
    R = (await import('../../ccd/history/recall.mjs')) as unknown as W35Recall;
  }, 4 * HEAVY);

  it('the fixture: eight leaves by their boundaries, one parent over them formed after both cuts, a NULL-ts reply in leaf 1, kept(7) in leaf 8', () => {
    expect(L.every((id) => /^L[0-9a-f]{20}$/.test(id)), L.join(' ')).toBe(true);
    expect(P).toMatch(/^N[0-9a-f]{20}$/);
    const db = rH.openStoreRO(box);
    try {
      const kids = (db.prepare('SELECT child_id FROM node_children WHERE node_id = ?').all(P) as { child_id: string }[]).map((r) => r.child_id);
      expect(kids.sort(), 'the parent condenses the eight leaves, and (crafted) the leafless EMPTY').toEqual([...L, EMPTY].sort());
      const a1 = db.prepare('SELECT ts_ms FROM entries WHERE uuid = ?').get(u(2)) as { ts_ms: number | null } | undefined;
      expect(a1, 'the reply without a timestamp is stored').toBeDefined();
      expect(a1!.ts_ms).toBeNull();
      const src = (leaf: string): string[] => (db.prepare(`SELECT e.uuid AS uuid FROM node_sources ns JOIN entries e ON e.entry_id = ns.entry_id
        WHERE ns.node_id = ? ORDER BY ns.ord`).all(leaf) as { uuid: string }[]).map((r) => r.uuid);
      expect(src(L[0]!), 'leaf 1 holds the NULL-ts reply').toEqual([u(1), u(2)]);
      expect(src(L[7]!), 'kept(7) belongs to leaf 8 (G12)').toEqual([kept(7), u(36), u(37)]);
      expect([src(HID), L.every((id) => HID < id)], 'u(1) is shared: HID covers it too, and HID\'s id is below every derived leaf\'s').toEqual([[u(1)], true]);
      expect(R.asOfCutOf({ db }, bnd(7)), 'CONTROL: the store half (Task 2) measures cut 7').toEqual({ ok: true, cut: cut7 });
      expect(R.asOfCutOf({ db }, bnd(8)), 'CONTROL: and cut 8').toEqual({ ok: true, cut: cut8 });
    } finally { db.close(); }
    expect([cut7.tsCut, cut7.keptUuids], 'cut 7 is boundary 7\'s stamp and kept(7)').toEqual([ms(38), [kept(7)]]);
    expect(cut8.tsCut).toBe(ms(43));
    expect(parentCreatedMs, 'the parent was formed after both boundaries; its visibility never reads that').toBeGreaterThan(cut8.tsCut);
  });

  it('C31: under ASOF=N a grep hit on a kept(N) row groups under the live tail, and neither leaf N+1\'s id nor its gist prints; a row a hidden lower-id leaf shares groups under its visible leaf (coveringLeaves)', async () => {
    const a = await GRX.grepArgs(['zqw2d35kept7']);
    const open = await under(undefined, (rc) => R.runGrep(rc, a));
    expect(open.exit, all(open)).toBe(0);
    expect(open.items.map((i) => [i['entry_uuid'], i['node_id']]), 'CONTROL: with no cut the kept(7) row groups under leaf 8').toEqual([[kept(7), L[7]]]);
    expect(open.blocks.join('\n'), 'CONTROL: leaf 8\'s header carries its gist').toContain('zqw2d35gist8');
    const r = await under(cut7, (rc) => R.runGrep(rc, a));
    expect(r.exit, all(r)).toBe(0);
    expect(r.items.map((i) => [i['entry_uuid'], i['node_id']]), 'the kept(7) row is visible; its only covering leaf is not').toEqual([[kept(7), null]]);
    expect(r.blocks[0]!.split('\n')[0]).toBe('── live tail (rows no leaf covers yet)');
    expect(all(r), 'no display of leaf 8\'s id').not.toContain(pre7(L[7]!));
    expect(all(r), 'leaf 8\'s gist').not.toContain('zqw2d35gist8');
    // u(1) has two in-scope covering leaves: leaf 1 (visible under cut 7) and HID (boundary 8, hidden), whose id is the
    // lower. Hidden leaves are dropped BEFORE the lower id is taken, so u(1) groups under leaf 1, never the live tail.
    const ask = await GRX.grepArgs(['zqw2d35ask1']);
    const shared = await under(undefined, (rc) => R.runGrep(rc, ask));
    expect(shared.items.map((i) => [i['entry_uuid'], i['node_id']]), 'CONTROL: with no cut u(1) groups under the lower id, HID').toEqual([[u(1), HID]]);
    const sharedCut = await under(cut7, (rc) => R.runGrep(rc, ask));
    expect(sharedCut.items.map((i) => [i['entry_uuid'], i['node_id']]), 'the visible leaf that covers it').toEqual([[u(1), L[0]]]);
    expect(all(sharedCut), 'HID\'s id').not.toContain(HID);
    expect(all(sharedCut), 'HID\'s gist').not.toContain('zqw2d35crafthid');
  }, HEAVY);

  it('leafHeads answers no head for a leaf the cut hides (a test seam: no read verb reaches it with an id coveringLeaves has not cut)', async () => {
    const open = await under(undefined, (rc) => [...R.leafHeads(rc, [L[6]!, L[7]!]).keys()].sort());
    expect(open, 'CONTROL').toEqual([L[6]!, L[7]!].sort());
    const cut = await under(cut7, (rc) => [...R.leafHeads(rc, [L[6]!, L[7]!]).keys()]);
    expect(cut).toEqual([L[6]]);
  });

  it('tree under ASOF=7: a hidden leaf, its parent, a hidden crafted leaf, a leafless node and an epoch with no visible row are absent; N counts the visible', async () => {
    const open = await under(undefined, treeOf);
    expect(open.exit, all(open)).toBe(0);
    expect(treeIds(open), 'CONTROL').toEqual([...L, P, VIS, HID, EMPTY].sort());
    expect(open.total).toBe(12);
    expect(open.items.find((i) => i['node_id'] === L[0])?.['parent_id'], 'CONTROL: leaf 1 sits under the parent').toBe(P);
    expect(open.blocks.some((l) => /^ {2}epoch \d+ clear started=\S+ session=2d35bbbb$/.test(l)), 'CONTROL: the second epoch is listed').toBe(true);
    expect(open.blocks.some((l) => l.startsWith(`    ${VIS} native_leaf depth=0 `)), 'CONTROL: HID beside it makes VIS\'s prefix its whole id').toBe(true);
    const r = await under(cut7, treeOf);
    expect(r.exit, all(r)).toBe(0);
    expect(treeIds(r)).toEqual([...L.slice(0, 7), VIS].sort());
    expect(r.total, 'N counts the visible nodes only').toBe(8);
    for (const i of r.items) expect(i['parent_id'], `${String(i['node_id'])}: a hidden parent is no parent`).toBeNull();
    expect(r.blocks.some((l) => /^ {2}epoch \d+ startup /.test(l)), 'the epoch with visible rows stays').toBe(true);
    expect(r.blocks.some((l) => l.includes('session=2d35bbbb')), 'the epoch whose transcript holds only hidden rows').toBe(false);
    expect(r.blocks.some((l) => l.startsWith(`    ${pre7(VIS)} native_leaf depth=0 `)), 'hidden HID no longer lengthens VIS\'s prefix').toBe(true);
    for (const h of [L[7]!, P, EMPTY]) expect(all(r), h).not.toContain(pre7(h));
    expect(all(r)).not.toContain(HID);
    for (const g of ['zqw2d35gist8', 'zqw2d35crafthid', 'zqw2d35craftempty']) expect(all(r), g).not.toContain(g);
  }, HEAVY);

  it('tree under ASOF=8: the parent shows once every leaf under it does, whenever it was formed; a node with no leaf under it stays hidden', async () => {
    const r = await under(cut8, treeOf);
    expect(r.exit, all(r)).toBe(0);
    expect(treeIds(r)).toEqual([...L, P, VIS, HID].sort());
    expect(r.total).toBe(11);
    expect(r.items.find((i) => i['node_id'] === L[0])?.['parent_id']).toBe(P);
    expect(all(r), 'the leafless condensed node, fail closed').not.toContain(pre7(EMPTY));
    expect(r.blocks.some((l) => l.includes('session=2d35bbbb'))).toBe(false);
  }, HEAVY);

  it('a hidden node answers exit 3 at describe, grep --node and expand, never out-of-scope, and its refs never print; a visible out-of-scope node stays 2', async () => {
    const node = await GRX.grepArgs(['--node', L[7]!, 'zqw2d35ask8']);
    const grepNode = (rc: W35Rc): GrepVerbResult => R.runGrep(rc, node);
    const opened: Array<[string, (rc: W35Rc) => GrepVerbResult]> = [
      ['describe leaf 8', describeOf(L[7]!)], ['describe the parent', describeOf(P)], ['describe HID', describeOf(HID)],
      ['describe the leafless node', describeOf(EMPTY)], ['expand leaf 8', expandOf(L[7]!)], ['grep --node leaf 8', grepNode],
    ];
    for (const [name, f] of opened) {
      const r = await under(undefined, f);
      expect(r.exit, `CONTROL, ${name}: ${all(r)}`).toBe(0);
    }
    expect(all(await under(undefined, describeOf(HID))), 'CONTROL: HID\'s refs print with no cut').toContain('zqw2d35refhid');
    expect(ans(await under(undefined, describeOf(OUT_HID))), 'CONTROL: B\'s leaf is out of scope with no cut').toEqual([2, 'out-of-scope']);
    const hidden: Array<[string, (rc: W35Rc) => GrepVerbResult]> = [
      ...opened, ['describe leaf 8 by its prefix', describeOf(pre7(L[7]!))], ['describe B\'s hidden leaf', describeOf(OUT_HID)],
      ['expand the parent', expandOf(P)],
    ];
    for (const [name, f] of hidden) {
      const r = await under(cut7, f);
      expect(ans(r), name).toEqual([3, undefined]);
      expect(all(r), name).not.toContain('zqw2d35refhid');
    }
    expect(ans(await under(cut7, describeOf(OUT_VIS))), 'a visible node of another family is still out of scope').toEqual([2, 'out-of-scope']);
  }, 2 * HEAVY);

  it('a hidden id never makes a prefix ambiguous, and display prefixes are computed over the visible nodes only (resolveNodeInScope, scopePrefixes)', async () => {
    const open = await under(undefined, describeOf(pre7(VIS)));
    expect(ans(open), 'CONTROL: with no cut both crafted leaves match the prefix').toEqual([2, 'bad-args']);
    expect(open.hint ?? '').toContain(HID);
    const openVis = await under(undefined, describeOf(VIS));
    expect(openVis.blocks[0], 'CONTROL: HID makes VIS\'s display prefix its whole id').toMatch(new RegExp(`^node ${VIS} native_leaf `));
    const r = await under(cut7, describeOf(pre7(VIS)));
    expect(r.exit, all(r)).toBe(0);
    expect(r.items[0]!['node_id']).toBe(VIS);
    expect(r.blocks[0]).toMatch(new RegExp(`^node ${pre7(VIS)} native_leaf `));
    expect(all(r)).not.toContain(HID);
    expect(all(r), 'a visible node\'s refs still print').toContain('zqw2d35refvis');
  }, HEAVY);

  it('describe drops a hidden parent, a hidden source row, a hidden witness of its producer and a hidden child, and keeps each one the cut shows', async () => {
    type Item = { parent_id: string | null; sources: Array<{ uuid: string }>; sources_total: number; producer: string };
    const item = (r: GrepVerbResult): Item => r.items[0] as unknown as Item;
    const shape = (r: GrepVerbResult): unknown[] => [item(r).parent_id, item(r).sources.map((s) => s.uuid), item(r).sources_total];
    expect(shape(await under(undefined, describeOf(L[0]!))), 'CONTROL').toEqual([P, [u(1), u(2)], 2]);
    const r1 = await under(cut7, describeOf(L[0]!));
    expect(r1.exit, all(r1)).toBe(0);
    expect(shape(r1)).toEqual([null, [u(1)], 1]);
    expect(r1.blocks.some((l) => l.startsWith('parent ')), 'no parent line').toBe(false);
    expect(all(r1), 'no display of the hidden parent').not.toContain(pre7(P));
    expect(all(r1), 'the NULL-ts reply\'s uuid').not.toContain(u(2));
    expect(item(await under(cut8, describeOf(L[0]!))).parent_id, 'under ASOF=8 the parent is visible, so it is named').toBe(P);
    expect(item(await under(undefined, describeOf(L[6]!))).producer, 'CONTROL: leaf 7\'s producer is the reply after its summary').toBe('anthropic');
    expect(item(await under(cut7, describeOf(L[6]!))).producer, 'under ASOF=7 that reply is hidden').toBe('unknown');
    expect(item(await under(cut8, describeOf(L[6]!))).producer, 'under ASOF=8 it is visible again').toBe('anthropic');
    // childRowsOf: under R4 a visible parent holds a hidden child only in a damaged store (EMPTY, a leafless condensed child).
    type Kids = { children: Array<{ id: string }>; children_total: number };
    const kids = (r: GrepVerbResult): unknown[] => { const k = r.items[0] as unknown as Kids; return [k.children.map((c) => c.id).sort(), k.children_total]; };
    expect(kids(await under(undefined, describeOf(P))), 'CONTROL: with no cut the leafless child is listed and counted').toEqual([[...L, EMPTY].sort(), 9]);
    const p8 = await under(cut8, describeOf(P));
    expect(p8.exit, all(p8)).toBe(0);
    expect(kids(p8), 'under ASOF=8 the parent is visible, and its hidden child is neither listed nor counted').toEqual([[...L].sort(), 8]);
    expect(all(p8), 'no display of the hidden child').not.toContain(pre7(EMPTY));
  }, HEAVY);

  it('nodes_fts has no reader on the read path, so node text reaches a read verb only through its node', () => {
    const src = (f: string): string => fs.readFileSync(path.join(REPO, 'ccd', 'history', f), 'utf8');
    for (const f of ['recall.mjs', 'regex-worker.mjs', 'cli.mjs']) expect(src(f).match(/\bnodes_fts\b/g) ?? [], f).toEqual([]);
    expect(src('derive.mjs'), 'CONTROL: the writer spells the table name the scan looks for').toMatch(/\bnodes_fts\b/);
  });

  it('W2-D45: with no cut, or a null one, no read verb prepares a cut statement; under a cut each of the three is prepared', async () => {
    const MARKS: Record<string, RegExp> = { nodes: /\basof_down\b/, epochs: /:asof_epochs\b/, entries: /:asof_entries\b/ };
    const grep = await GRX.grepArgs(['zqw2d35kept7']);
    const prepared = async (cut: W35Cut | null | undefined): Promise<string[]> => {
      const rc = await rcOf(cut);
      const calls: string[] = [];
      const spied: W35Rc = { ...rc, db: GRX.spyDb(rc.db, calls) };
      try {
        expect(R.runTree(spied, { depth: 2, json: true }).exit).toBe(0);
        expect(R.runDescribe(spied, { target: L[0]!, full: false, cursor: null, json: true }).exit).toBe(0);
        expect(R.runGrep(spied, grep).exit).toBe(0);
      } finally { rc.db.close(); }
      return calls;
    };
    for (const cut of [undefined, null]) {
      const calls = await prepared(cut);
      for (const [k, re] of Object.entries(MARKS)) expect(calls.filter((s) => re.test(s)), `${String(cut)}: ${k}`).toEqual([]);
    }
    const withCut = await prepared(cut7);
    for (const [k, re] of Object.entries(MARKS)) expect(withCut.some((s) => re.test(s)), `CONTROL: the cut prepares its ${k} statement`).toBe(true);
  }, HEAVY);

  it('R8 (SEC-2): describe drops the refs mined from source rows (origin tool_use), and the files derived from them, of a node with a hidden source row, its own or a descendant leaf\'s; the summary\'s refs stay, and so do the mined refs of a node whose rows are all visible', async () => {
    type Refs = { refs: Array<{ value: string; origin: string }>; refs_total: number; files: string[]; files_total: number };
    const refs = (r: GrepVerbResult): Refs => r.items[0] as unknown as Refs;
    // Leaf 1: its NULL-ts reply u(2) is hidden under every cut, and a ref mined from its rows may name that row.
    const open1 = await under(undefined, describeOf(L[0]!));
    expect(open1.exit, all(open1)).toBe(0);
    expect(refs(open1).refs.some((x) => x.value.includes('zqw2d35minedrow1') && x.origin === 'tool_use'), 'CONTROL: with no cut leaf 1\'s mined ref prints').toBe(true);
    expect(refs(open1).files.some((f) => f.includes('zqw2d35minedrow1')), 'CONTROL: and its path is among the files').toBe(true);
    const cut1 = await under(cut7, describeOf(L[0]!));
    expect(cut1.exit, all(cut1)).toBe(0);
    expect(all(cut1), 'the hidden-row path, in refs, files and every line').not.toContain('zqw2d35minedrow1');
    expect(all(cut1), 'the summary\'s ref stays (R6)').toContain('zqw2d35modelrow1');
    expect([refs(cut1).refs_total, refs(cut1).files_total], 'neither count holds it')
      .toEqual([refs(open1).refs_total - 1, refs(open1).files_total - 1]);
    // Leaf 7 is leaf N under cut 7, and every source row of it is visible: its mined ref stays.
    expect(all(await under(cut7, describeOf(L[6]!))), 'leaf N\'s mined ref, every row under it visible').toContain('zqw2d35minedrow7');
    // The parent holds u(2) through leaf 1. It is visible under cut 8: its mined ref goes, its summary's ref stays.
    expect(all(await under(undefined, describeOf(P))), 'CONTROL: the parent\'s mined ref with no cut').toContain('zqw2d35minedparent');
    const p8 = await under(cut8, describeOf(P));
    expect(p8.exit, all(p8)).toBe(0);
    expect(all(p8), 'a hidden descendant source drops the parent\'s mined ref').not.toContain('zqw2d35minedparent');
    expect(all(p8), 'the parent\'s summary ref stays (R6)').toContain('zqw2d35modelparent');
  }, HEAVY);
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D35: the as-of cut')
```

Expected (predicted before the code): `9 failed | 2 passed`.
- Passing: "the fixture: …" (it measures the store, and Task 2's `asOfCutOf`, already shipped) and "nodes_fts has no reader …" (it pins a fact the base already holds; M11 measures its red).
- C31: `expected [ [ '2d35eeee-…-000000000021', 'L…' ] ] to deeply equal [ [ '2d35eeee-…-000000000021', null ] ]`: `coveringLeaves` still groups the kept(7) row under leaf 8.
- leafHeads: `R.leafHeads is not a function` (it is not exported yet).
- both tree cases: the item ids still hold leaf 8, the parent, HID and EMPTY.
- the exit-3 case: `describe leaf 8` answers `[ 0, undefined ]` under the cut.
- the prefix case: `describe L000001` answers `[ 2, 'bad-args' ]` under the cut (measured: with the ids as first written, `hex20('000000', …)`, the shared prefix `L000000` is all zeros, which `extractNodeId` refuses before any lookup (`a node id cannot be all zeros: L000000`), so the case failed at its no-cut CONTROL; the crafted ids now start `000001`, still below every derived leaf's id (predicted: `000000`)). The run measured `9 failed | 2 passed`, as predicted.
- the describe case: `parent_id` is still the parent under cut 7.
- W2-D45: its two no-cut halves pass; its CONTROL fails, because no cut statement exists yet.
- the R8 case: its CONTROLs pass, then `expected '…' not to contain 'zqw2d35minedrow1'`: describe of leaf 1 under cut 7 still prints every ref.

- [ ] **Step 4: Write lib's three statements, their declarations and tree's table.**

(a) In `ccd/history/lib.mjs`, directly after the closing `}` of Task 1's `export function asOfBinds(cut) {`, insert:

```js

// ── The as-of cut's node, epoch and entry statements (W2-2a Task 3; W2-D35, W2-D36, W2-D38) ─────────────────────────
// Each is ONE statement text, built on asOfEntrySql, so a node, an epoch and a row are judged by the same entry rule, and
// recall.mjs and W2-5b's card parent (W2-D75) ask the same question. Each binds by name only: asOfBinds(cut)'s parameters
// plus one JSON array of candidates. None is run without a cut: recall.mjs prepares nothing then (W2-D45).

/** W2-D35's node rule. Of the node ids bound as a JSON array at `:asof_nodes`, the ones the cut hides (column `node_id`):
 *  - a leaf (any kind but `condensed`) is hidden when its boundary entry is not stored or asOfEntrySql hides it (W2-D34);
 *  - any node is hidden when a leaf under it is hidden, whenever the node was formed: the walk goes down node_children
 *    (UNION, so a cycle ends it) and never reads `created_ms`;
 *  - a `condensed` node with no leaf under it is hidden too, fail closed: "every leaf under it is visible" would hold
 *    vacuously there, and only a damaged store has one (W2-D35 as amended).
 *  An id that names no node answers nothing. */
export function asOfHiddenNodesSql() {
  return `WITH RECURSIVE asof_down(top, node_id) AS (
    SELECT value, value FROM json_each(:asof_nodes)
    UNION
    SELECT d.top, c.child_id FROM asof_down d JOIN node_children c ON c.node_id = d.node_id
  )
  SELECT d.top AS node_id
    FROM asof_down d
    JOIN nodes asof_n ON asof_n.node_id = d.node_id
    LEFT JOIN entries asof_b ON asof_b.entry_id = asof_n.boundary_entry_id
    GROUP BY d.top
    HAVING sum(asof_n.kind <> 'condensed') = 0
      OR sum(asof_n.kind <> 'condensed' AND NOT coalesce(asof_b.entry_id IS NOT NULL AND (${asOfEntrySql('asof_b')}), 0)) > 0`;
}

/** W2-D35's epoch rule. Of the epoch session uuids bound as a JSON array at `:asof_epochs`, the ones the cut shows (column
 *  `cc_session_uuid`): one of the epoch's transcripts (any agent_id) holds a row asOfEntrySql shows. */
export function asOfVisibleEpochsSql() {
  return `SELECT j.value AS cc_session_uuid FROM json_each(:asof_epochs) AS j
    WHERE EXISTS (SELECT 1 FROM transcripts asof_t JOIN entries asof_e ON asof_e.transcript_pk = asof_t.transcript_pk
      WHERE asof_t.cc_session_uuid = j.value AND (${asOfEntrySql('asof_e')}))`;
}

/** Of the entry ids bound as a JSON array at `:asof_entries`, the ones the cut shows (column `entry_id`): W2-D34's rule, for
 *  a read that lists rows a node holds (describe's sources, a producer's witnesses). */
export function asOfVisibleEntriesSql() {
  return `SELECT asof_e.entry_id AS entry_id FROM entries asof_e
    WHERE asof_e.entry_id IN (SELECT value FROM json_each(:asof_entries)) AND (${asOfEntrySql('asof_e')})`;
}
```

(b) In `ccd/history/lib.mjs`, replace

```js
  tree: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_children']),
```

with

```js
  tree: Object.freeze([...READ_CONTEXT_TABLES, 'nodes', 'node_children', 'memberships']),
```

(c) In `ccd/history/lib.d.mts`, directly after Task 1's `asOfBinds` declaration (after its closing `};`), insert:

```ts
// --- W2-2a Task 3: the as-of cut's node, epoch and entry statements (W2-D35, W2-D36, W2-D38). Each binds asOfBinds' names plus one JSON array.
/** Of the node ids at :asof_nodes, those the cut hides (column node_id): a leaf by its boundary entry, any node by every leaf under it. */
export function asOfHiddenNodesSql(): string;
/** Of the epoch session uuids at :asof_epochs, those one of whose transcripts holds a row the cut shows (column cc_session_uuid). */
export function asOfVisibleEpochsSql(): string;
/** Of the entry ids at :asof_entries, those the cut shows (column entry_id). */
export function asOfVisibleEntriesSql(): string;
```

- [ ] **Step 5: Apply the cut at every site in recall.mjs.** Write no comment that spells the node index table's name: case 9's scan reads every comment too.

(a) The helpers. Directly after the line `` const isoOf = (ms) => (ms === null || ms === undefined ? 'unknown' : `${new Date(Number(ms)).toISOString().slice(0, 16)}Z`); ``, insert:

```js

// ── The as-of cut's reads (W2-2a Task 3; W2-D35, W2-D36, W2-D38) ────────────────────────────────────────────────────
// The cut (lib's asOfCut) rides on rc.scope.cut, read through cutOf and bound through cutBinds (both below bindFor, Task
// 2). Each helper here asks one of lib's statements and answers a set (cutHidesASource answers whether cutVisibleEntries'
// set misses a row under a node). With no cut they prepare nothing, so a read with
// nothing set prepares exactly the statements it prepared before W2-2a (W2-D45).
// A node, epoch or row the cut hides is ABSENT (W2-D36): each site filters it before scope, so it is never out of scope,
// never one of an ambiguous prefix's candidates and never counted.

/** Of `ids`, the node ids the cut hides, by lib's asOfHiddenNodesSql: a leaf by its boundary entry, any other node by every
 *  leaf under it, whenever it was formed. An empty set with no cut. */
function cutHiddenNodes(rc, ids) {
  const cut = cutOf(rc);
  if (cut === null || ids.length === 0) return new Set();
  const sql = xlib.asOfHiddenNodesSql();
  const rows = rc.db.prepare(sql).all(bindFor(sql, { ...cutBinds(rc), asof_nodes: JSON.stringify([...new Set(ids)]) }));
  return new Set(rows.map((r) => r.node_id));
}

/** Of these epochs' session uuids, the ones the cut shows (one of their transcripts holds a row it shows). null with no
 *  cut, which shows every epoch. */
function cutVisibleEpochs(rc, uuids) {
  const cut = cutOf(rc);
  if (cut === null) return null;
  if (uuids.length === 0) return new Set();
  const sql = xlib.asOfVisibleEpochsSql();
  const rows = rc.db.prepare(sql).all(bindFor(sql, { ...cutBinds(rc), asof_epochs: JSON.stringify([...new Set(uuids)]) }));
  return new Set(rows.map((r) => r.cc_session_uuid));
}

/** Of these entry ids, the ones the cut shows (lib's asOfVisibleEntriesSql, W2-D34's rule). null with no cut. */
function cutVisibleEntries(rc, entryIds) {
  const cut = cutOf(rc);
  if (cut === null) return null;
  if (entryIds.length === 0) return new Set();
  const sql = xlib.asOfVisibleEntriesSql();
  const ids = JSON.stringify([...new Set(entryIds.map(Number))]);
  const rows = rc.db.prepare(sql).all(bindFor(sql, { ...cutBinds(rc), asof_entries: ids }));
  return new Set(rows.map((r) => Number(r.entry_id)));
}

/** Whether the as-of cut hides a source row under node `id`: its own (a leaf) or any descendant leaf's (a parent), listed
 *  by store.mjs's lineageEntries and judged by cutVisibleEntries (lib's asOfVisibleEntriesSql). false with no cut, and
 *  then nothing is read (W2-D45). describe drops the node's tool_use refs when it answers true (R8). */
function cutHidesASource(rc, id) {
  if (cutOf(rc) === null) return false;
  const ids = lineageEntries(rc.db, id).map((x) => x.entryId);
  const shown = cutVisibleEntries(rc, ids);
  return ids.some((e) => !shown.has(e));
}
```

(b) `runTree`'s node list. Replace

```js
  const nodes = [];
  for (const part of inParts(rc.scope.sessionPks)) {
    nodes.push(...db.prepare(`SELECT ${cols} FROM nodes n WHERE n.session_pk IN (${marks(part)}) AND EXISTS (SELECT 1 FROM epochs e WHERE e.session_pk = n.session_pk AND e.seq = n.epoch_seq AND e.confirmed_ms IS NOT NULL)`).all(...part));
  }
```

with

```js
  const stored = [];
  for (const part of inParts(rc.scope.sessionPks)) {
    stored.push(...db.prepare(`SELECT ${cols} FROM nodes n WHERE n.session_pk IN (${marks(part)}) AND EXISTS (SELECT 1 FROM epochs e WHERE e.session_pk = n.session_pk AND e.seq = n.epoch_seq AND e.confirmed_ms IS NOT NULL)`).all(...part));
  }
  // W2-D35: a node the as-of cut hides is absent (W2-D36): not listed, not counted in N, and no display prefix below is
  // measured against it.
  const hiddenTree = cutHiddenNodes(rc, stored.map((n) => n.node_id));
  const nodes = hiddenTree.size === 0 ? stored : stored.filter((n) => !hiddenTree.has(n.node_id));
```

(c) `runTree`'s parents. Replace

```js
  const parentById = new Map(nodes.map((n) => [n.node_id, parentOf(db, n.node_id)]));
```

with

```js
  // A parent the cut hides is no parent: its visible children are then roots of their epoch, as they were before it formed.
  const parentById = new Map(nodes.map((n) => {
    const p = parentOf(db, n.node_id);
    return [n.node_id, p !== null && hiddenTree.has(p) ? null : p];
  }));
```

(d) `runTree`'s epochs. Replace

```js
    for (const e of epochs.all(f.sessionPk)) {
```

with

```js
    const listed = epochs.all(f.sessionPk);
    // W2-D35: an epoch shows iff one of its transcripts holds a row the as-of cut shows; null with no cut shows them all.
    const shownEpochs = cutVisibleEpochs(rc, listed.map((e) => e.cc_session_uuid));
    for (const e of listed) {
      if (shownEpochs !== null && !shownEpochs.has(e.cc_session_uuid)) continue;
```

(e) `resolveNodeInScope`. Replace

```js
  const rows = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'session_pk'], rc.schema)} FROM nodes
    WHERE node_id >= ? AND node_id < ?`).all(wanted, `${wanted}g`);
```

with

```js
  const stored = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'session_pk'], rc.schema)} FROM nodes
    WHERE node_id >= ? AND node_id < ?`).all(wanted, `${wanted}g`);
  // W2-D36: a node the as-of cut hides is absent BEFORE scope, so it is neither in scope nor out of it. It answers 3, never
  // out-of-scope, and never makes a prefix ambiguous. One filter for describe, grep --node and expand's node target.
  const hiddenHere = cutHiddenNodes(rc, stored.map((x) => x.node_id));
  const rows = hiddenHere.size === 0 ? stored : stored.filter((x) => !hiddenHere.has(x.node_id));
```

(f) `scopePrefixes`. Replace

```js
/** Display prefixes for every node of the scope (§6.1): unique within the scope, never shorter than
 *  NODE_ID_DISPLAY_MIN. */
function scopePrefixes(rc) {
  const ids = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id'], rc.schema)} FROM nodes
    WHERE session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rc.scope.sessionPks)).map((r) => r.node_id);
  return displayPrefixes(ids);
}
```

with

```js
/** Display prefixes for every node of the scope (§6.1): unique within the scope, never shorter than
 *  NODE_ID_DISPLAY_MIN. Under an as-of cut, computed over the visible nodes only (W2-D35), so a hidden neighbour never
 *  lengthens a visible node's prefix. */
function scopePrefixes(rc) {
  const ids = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id'], rc.schema)} FROM nodes
    WHERE session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rc.scope.sessionPks)).map((r) => r.node_id);
  const hiddenPre = cutHiddenNodes(rc, ids);
  return displayPrefixes(hiddenPre.size === 0 ? ids : ids.filter((id) => !hiddenPre.has(id)));
}
```

(g) `coveringLeaves`. Replace

```js
 *  leaf of the scope's own families counts: an entry is store-global, so another family's leaf can hold the same
 *  row, and that leaf is not this scope's to show. */
function coveringLeaves(rc, entryIds) {
  if (entryIds.length === 0) return new Map();
  const rows = rc.db.prepare(`SELECT ns.entry_id AS entry_id, min(ns.node_id) AS node_id
      FROM ${versioned(rc, 'node_sources', 'ns', ['node_id', 'entry_id'])}
      JOIN ${versioned(rc, 'nodes', 'n', ['node_id', 'session_pk'])} ON n.node_id = ns.node_id
      WHERE ns.entry_id IN (SELECT value FROM json_each(?)) AND n.session_pk IN (SELECT value FROM json_each(?))
      GROUP BY ns.entry_id`).all(JSON.stringify(entryIds), JSON.stringify(rc.scope.sessionPks));
  return new Map(rows.map((r) => [r.entry_id, r.node_id]));
}
```

with

```js
 *  leaf of the scope's own families counts: an entry is store-global, so another family's leaf can hold the same
 *  row, and that leaf is not this scope's to show. Under an as-of cut only a VISIBLE leaf counts (W2-D35), and the
 *  hidden ones are dropped BEFORE the lower id is taken: a row a hidden leaf and a visible one share groups under the
 *  visible one, and a row only a hidden leaf covers (kept(N) under ASOF=N, leaf N+1's) has none, so renderHits groups
 *  it under the live tail and no hidden leaf's id or gist prints (C31). */
function coveringLeaves(rc, entryIds) {
  if (entryIds.length === 0) return new Map();
  if (cutOf(rc) === null) {
    const rows = rc.db.prepare(`SELECT ns.entry_id AS entry_id, min(ns.node_id) AS node_id
      FROM ${versioned(rc, 'node_sources', 'ns', ['node_id', 'entry_id'])}
      JOIN ${versioned(rc, 'nodes', 'n', ['node_id', 'session_pk'])} ON n.node_id = ns.node_id
      WHERE ns.entry_id IN (SELECT value FROM json_each(?)) AND n.session_pk IN (SELECT value FROM json_each(?))
      GROUP BY ns.entry_id`).all(JSON.stringify(entryIds), JSON.stringify(rc.scope.sessionPks));
    return new Map(rows.map((r) => [r.entry_id, r.node_id]));
  }
  const pairs = rc.db.prepare(`SELECT ns.entry_id AS entry_id, ns.node_id AS node_id
      FROM ${versioned(rc, 'node_sources', 'ns', ['node_id', 'entry_id'])}
      JOIN ${versioned(rc, 'nodes', 'n', ['node_id', 'session_pk'])} ON n.node_id = ns.node_id
      WHERE ns.entry_id IN (SELECT value FROM json_each(?)) AND n.session_pk IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(entryIds), JSON.stringify(rc.scope.sessionPks));
  const hiddenLeaves = cutHiddenNodes(rc, pairs.map((r) => r.node_id));
  const out = new Map();
  for (const r of pairs) {
    if (hiddenLeaves.has(r.node_id)) continue;
    const had = out.get(r.entry_id);
    if (had === undefined || r.node_id < had) out.set(r.entry_id, r.node_id);   // ASCII ids: SQLite's BINARY min
  }
  return out;
}
```

The no-cut branch's statement text is the base's, character for character: only the `const rows =` line moves into the `if`, and the literal's continuation lines keep their six-space indent. Case 10 pins that the branch prepares no cut statement; history-recall's existing grep describes pin what it answers.

(h) `leafHeads`. Replace

```js
/** The time range and gist of each group's leaf. */
function leafHeads(rc, ids) {
  if (ids.length === 0) return new Map();
  const rows = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'earliest_ms', 'latest_ms', 'gist'], rc.schema)}
    FROM nodes WHERE node_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  return new Map(rows.map((r) => [r.node_id, r]));
}
```

with

```js
/** The time range and gist of each group's leaf. A leaf the as-of cut hides has no head (W2-D35), so neither its range nor
 *  its gist can print. Exported as a test seam (the describePageEnd precedent): renderHits hands it only ids coveringLeaves
 *  has already cut, so no read verb can show this guard red on its own. */
export function leafHeads(rc, ids) {
  if (ids.length === 0) return new Map();
  const rows = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'earliest_ms', 'latest_ms', 'gist'], rc.schema)}
    FROM nodes WHERE node_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  const hiddenHeads = cutHiddenNodes(rc, ids);
  return new Map(rows.filter((r) => !hiddenHeads.has(r.node_id)).map((r) => [r.node_id, r]));
}
```

(i) `sourcesOf`. Replace

```js
/** A leaf's sources in order, each with its blob's raw length. */
function sourcesOf(rc, id) {
  return rc.db.prepare(`SELECT e.uuid AS uuid, e.type AS type, e.role AS role, b.raw_len AS raw_len
```

with

```js
/** A leaf's sources in order, each with its blob's raw length. Under an as-of cut a source row the cut hides (a NULL-ts
 *  row, W2-D34) is absent from the list and from its count (W2-D36). */
function sourcesOf(rc, id) {
  const cutSet = cutOf(rc) !== null;
  const rows = rc.db.prepare(`SELECT e.uuid AS uuid, e.type AS type, e.role AS role, b.raw_len AS raw_len${cutSet ? ', e.entry_id AS entry_id' : ''}
```

and, in the same function, replace

```js
      WHERE ns.node_id = ? ORDER BY ns.ord`).all(id);
}
```

with

```js
      WHERE ns.node_id = ? ORDER BY ns.ord`).all(id);
  const shownRows = cutVisibleEntries(rc, cutSet ? rows.map((r) => r.entry_id) : []);
  return shownRows === null ? rows : rows.filter((r) => shownRows.has(Number(r.entry_id)));
}
```

(Both `sourcesOf` replacements are asserted to match once: the second's two-line old text closes `sourcesOf` alone, at about :925-926.)

(j) `producerOfLeaf`. Replace

```js
  const after = rc.db.prepare(`SELECT e.model AS model
      FROM ${versioned(rc, 'memberships', 'mb', ['file_id', 'entry_id', 'line'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'type', 'model'])} ON e.entry_id = mb.entry_id
      WHERE mb.file_id = ? AND mb.line > ? AND e.type = 'assistant' ORDER BY mb.line`);
  function* models() {
    for (const r of after.iterate(at.file_id, from)) yield r.model;
  }
```

with

```js
  const witnessCut = cutOf(rc) !== null;
  const after = rc.db.prepare(`SELECT e.model AS model${witnessCut ? ', e.entry_id AS entry_id' : ''}
      FROM ${versioned(rc, 'memberships', 'mb', ['file_id', 'entry_id', 'line'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'type', 'model'])} ON e.entry_id = mb.entry_id
      WHERE mb.file_id = ? AND mb.line > ? AND e.type = 'assistant' ORDER BY mb.line`);
  function* models() {
    for (const r of after.iterate(at.file_id, from)) {
      // W2-D36: a witness the as-of cut hides is absent, so a leaf's producer never names the model of a hidden reply.
      if (witnessCut && !cutVisibleEntries(rc, [r.entry_id]).has(Number(r.entry_id))) continue;
      yield r.model;
    }
  }
```

(k) `runDescribe`'s parent. Replace

```js
  const parent = parentOf(rc.db, id);
```

with

```js
  // W2-D35: a parent the as-of cut hides is absent: no parent line, and parent_id is null.
  const storedParent = parentOf(rc.db, id);
  const parent = storedParent !== null && cutHiddenNodes(rc, [storedParent]).has(storedParent) ? null : storedParent;
```

(l) `childRowsOf`. Replace

```js
  return childrenOf(rc.db, id).slice().sort((x, y) => x.ord - y.ord).map((c) => st.get(c.childId)).filter((r) => r !== undefined);
}
```

with

```js
  const kids = childrenOf(rc.db, id).slice().sort((x, y) => x.ord - y.ord).map((c) => st.get(c.childId)).filter((r) => r !== undefined);
  // W2-D36: a child the as-of cut hides is absent, from the list and from children_total. Under the parent rule a visible
  // parent holds one only in a damaged store: a condensed child with no leaf under it (R4).
  const hiddenKids = cutHiddenNodes(rc, kids.map((k) => k.node_id));
  return hiddenKids.size === 0 ? kids : kids.filter((k) => !hiddenKids.has(k.node_id));
}
```

(m) `runDescribe`'s refs (R8, SEC-2). Replace

```js
  const refsAll = refsOf(rc, id).map((r) => ({ kind: r.kind, value: redactForDisplay(r.value, rc.pairIdx), origin: r.origin }));
```

with

```js
  // R8: under an as-of cut, a ref mined from source rows (origin tool_use) is dropped when a source row under this node,
  // its own or a descendant leaf's, is one the cut hides: node_refs names no row, so it may come from that row. Refs of
  // origin model and meta come from the summary written at N and stay (R6). files are read from refsAll, so they follow.
  const minedHidden = cutHidesASource(rc, id);
  const refsAll = refsOf(rc, id).filter((r) => !(minedHidden && r.origin === 'tool_use'))
    .map((r) => ({ kind: r.kind, value: redactForDisplay(r.value, rc.pairIdx), origin: r.origin }));
```

The `filesAll` line below it is not edited: it reads `refsAll`. With no cut `minedHidden` is `false`, nothing is read for it, and the filter keeps every row.

- [ ] **Step 6: Run them and see them pass.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D35: the as-of cut')
```

Expected: `11 passed`.

- [ ] **Step 7: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2a/t3/mut.sh`: it applies one exact replacement (or two), asserted to match once, runs its filter and shows red, then restores every file the task edits and checks each with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Multi-line old texts are passed with bash `$'…'` quoting, so `\n` is a real newline.

First write the helpers, once, after Step 6's green run. They copy the files as they stand then, so a file changed on purpose after this point needs this block run again before any later mutant:

```bash
mkdir -p .superpowers/sdd/history-w2-2a/t3
cat > .superpowers/sdd/history-w2-2a/t3/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2a/t3
FILES="ccd/history/recall.mjs ccd/history/lib.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(s.replace(old, new))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
F='W2-D35: the as-of cut'
SH
for f in ccd/history/recall.mjs ccd/history/lib.mjs; do cp "$f" ".superpowers/sdd/history-w2-2a/t3/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms. Never split one mutant across calls: the helpers restore every file when a call exits. If a call's runs would pass 600000 ms on a loaded box, join its filters for the same file into one `-t` regex (`'a|b'`) and read each case's line from that one run. A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M1: coveringLeaves left uncut (W2-D35's own CONTROL).
mut ccd/history/recall.mjs '  const hiddenLeaves = cutHiddenNodes(rc, pairs.map((r) => r.node_id));' '  const hiddenLeaves = new Set();'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, C31: the kept(7) row's node_id is leaf 8's id, not null.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M2: leafHeads left uncut.
mut ccd/history/recall.mjs '  const hiddenHeads = cutHiddenNodes(rc, ids);' '  const hiddenHeads = new Set();'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the leafHeads case: [L7, L8] where [L7] was expected.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M3: scopePrefixes measured over every node, hidden ones included.
mut ccd/history/recall.mjs '  return displayPrefixes(hiddenPre.size === 0 ? ids : ids.filter((id) => !hiddenPre.has(id)));' '  return displayPrefixes(ids);'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the prefix case: describe's node line under cut 7 shows VIS's whole id, not L000001.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M4: tree lists every stored node.
mut ccd/history/recall.mjs '  const nodes = hiddenTree.size === 0 ? stored : stored.filter((n) => !hiddenTree.has(n.node_id));' '  const nodes = stored;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 2 failed | 9 passed, both tree cases (leaf 8, the parent, HID and EMPTY listed under cut 7; EMPTY under cut 8).
# Measured: 3 failed | 8 passed. The W2-D45 case reds too: with the node list unfiltered, the cut tree reads `readEnvelope: shown 16 of 12 is not a count` (predicted: 2 failed | 9 passed).
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M5: a hidden parent kept as the parent.
mut ccd/history/recall.mjs '    return [n.node_id, p !== null && hiddenTree.has(p) ? null : p];' '    return [n.node_id, p];'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the ASOF=7 tree case: leaves 1 to 7 are no roots and are never walked, so the ids are [VIS] alone.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M6: every epoch listed.
mut ccd/history/recall.mjs '      if (shownEpochs !== null && !shownEpochs.has(e.cc_session_uuid)) continue;' ''
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 2 failed | 9 passed, both tree cases: an epoch line holds session=2d35bbbb.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M7: resolveNodeInScope ignores the cut (describe, grep --node, expand; node_refs through describe).
mut ccd/history/recall.mjs '  const rows = hiddenHere.size === 0 ? stored : stored.filter((x) => !hiddenHere.has(x.node_id));' '  const rows = stored;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 2 failed | 9 passed: the exit-3 case ('describe leaf 8': [0, undefined]; 'describe HID' prints zqw2d35refhid;
# 'describe B's hidden leaf': [2, 'out-of-scope']) and the prefix case (describe L000001: [2, 'bad-args']).
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M8: describe names a hidden parent.
mut ccd/history/recall.mjs '  const parent = storedParent !== null && cutHiddenNodes(rc, [storedParent]).has(storedParent) ? null : storedParent;' '  const parent = storedParent;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the describe case: parent_id under cut 7 is the parent's id, not null.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M9: describe lists a hidden source row.
mut ccd/history/recall.mjs '  return shownRows === null ? rows : rows.filter((r) => shownRows.has(Number(r.entry_id)));' '  return rows;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the describe case: sources under cut 7 are [u(1), u(2)] and sources_total 2.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M10: a hidden reply witnesses the producer.
mut ccd/history/recall.mjs '      if (witnessCut && !cutVisibleEntries(rc, [r.entry_id]).has(Number(r.entry_id))) continue;' ''
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the describe case: leaf 7's producer under cut 7 is 'anthropic', not 'unknown'.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M11: a node index reader appears on the read path.
printf '%s\n' '// FROM nodes_fts' >> ccd/history/recall.mjs
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the nodes_fts case: recall.mjs: expected [ 'nodes_fts' ] to deeply equal [].
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M13: a leafless condensed node reads as visible (R4's rule, W2-D35 as amended).
mut ccd/history/lib.mjs $'    HAVING sum(asof_n.kind <> \'condensed\') = 0\n      OR sum(' '    HAVING sum('
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 4 failed | 7 passed: both tree cases (EMPTY listed), the exit-3 case ('describe the leafless node' answers 0)
# and the describe case (under ASOF=8 the parent's children are [...L, EMPTY] and 9, not [...L] and 8).
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M14: no walk down: a node is judged by itself alone.
mut ccd/history/lib.mjs $'    UNION\n    SELECT d.top, c.child_id FROM asof_down d JOIN node_children c ON c.node_id = d.node_id\n' ''
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 3 failed | 8 passed: the parent then has no leaf in its own group and reads as hidden, so the ASOF=8 tree
# case misses it, the describe case's 'under ASOF=8 the parent is visible' reads null, and the R8 case's describe of the
# parent under cut 8 answers exit 3, not 0.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M15: a read with no cut asks the node statement anyway (W2-D45).
mut ccd/history/recall.mjs '  if (cut === null || ids.length === 0) return new Set();' '  if (ids.length === 0) return new Set();'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): the W2-D45 case, whose no-cut halves now see an asof_down statement. With no cut cutBinds answers {}, so
# the statement's asof_ parameters read NULL and every node reads hidden: other cases' no-cut CONTROLs red too. Write the measured
# failing names in the run's notes; the W2-D45 case must be among them.
# Measured: 8 failed | 3 passed. Red: C31, leafHeads, tree under ASOF=7, the exit-3 case, the prefix case, the describe case, W2-D45 and the R8 case; green: the fixture, tree under ASOF=8 and the nodes_fts case.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M16: coveringLeaves takes the lower id first and drops a hidden one after (the base min, then a filter).
mut ccd/history/recall.mjs $'    if (hiddenLeaves.has(r.node_id)) continue;\n' ''
mut ccd/history/recall.mjs $'    if (had === undefined || r.node_id < had) out.set(r.entry_id, r.node_id);   // ASCII ids: SQLite\'s BINARY min\n  }\n' $'    if (had === undefined || r.node_id < had) out.set(r.entry_id, r.node_id);   // ASCII ids: SQLite\'s BINARY min\n  }\n  for (const [k, v] of out) if (hiddenLeaves.has(v)) out.delete(k);\n'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, C31 at 'the visible leaf that covers it': [[u(1), null]] against
# [[u(1), L[0]]]. Its kept(7) half stays green: a row only a hidden leaf covers answers null either way.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M17: describe lists a hidden child.
mut ccd/history/recall.mjs '  return hiddenKids.size === 0 ? kids : kids.filter((k) => !hiddenKids.has(k.node_id));' '  return kids;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the describe case: under ASOF=8 the parent's children are [...L, EMPTY]
# and 9, not [...L] and 8.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M18: describe keeps a ref mined from a hidden row (R8, SEC-2: the filter dropped).
mut ccd/history/recall.mjs '  const minedHidden = cutHidesASource(rc, id);' '  const minedHidden = false;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the R8 case at 'the hidden-row path, in refs, files and every line': describe of
# leaf 1 under cut 7 contains zqw2d35minedrow1.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M19: only the node's own source rows are judged, no walk down to its leaves'.
mut ccd/history/recall.mjs '  const ids = lineageEntries(rc.db, id).map((x) => x.entryId);' '  const ids = lineageEntries(rc.db, id).filter((x) => x.nodeId === id).map((x) => x.entryId);'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the R8 case at 'a hidden descendant source drops the parent's mined ref': the
# parent holds no source row of its own, so under cut 8 it prints zqw2d35minedparent. Leaf 1's half stays green: u(2) is its own.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M20: every ref of such a node dropped, the summary's included.
mut ccd/history/recall.mjs "  const refsAll = refsOf(rc, id).filter((r) => !(minedHidden && r.origin === 'tool_use'))" '  const refsAll = refsOf(rc, id).filter(() => !minedHidden)'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the R8 case at 'the summary's ref stays (R6)': leaf 1 under cut 7 prints no
# zqw2d35modelrow1. The prefix case stays green: VIS has no source row, so its model ref still prints.
```

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
# M21: mined refs dropped whenever a cut is set, the rows under the node not read.
mut ccd/history/recall.mjs '  return ids.some((e) => !shown.has(e));' '  return true;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
restore
# Expected RED (predicted): 1 failed | 10 passed, the R8 case at 'leaf N's mined ref, every row under it visible': leaf 7 under
# cut 7 prints no zqw2d35minedrow7.
```

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2a/t3/mut.sh
for f in ccd/history/recall.mjs ccd/history/lib.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t3/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$F")
```

Expected at the end: the loop prints nothing, then `11 passed`. A mutant whose red differs from its prediction is recorded with what it actually did, and reported; it is never re-predicted after the fact. (M12 is not a separate edit: `node_refs` has no site of its own, and M7's red includes the exit-3 case's `zqw2d35refhid` assertion.)

- [ ] **Step 8: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, one suite per call. If a file goes red, re-run it alone before calling it a break: `typecheck-tests` is among CLAUDE.md's load flakes.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'VERB_TABLES|missingTablesAt')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: each passes. history-recall's count is Step 1's plus 11, with the same skips. The DM44 describe ("the read verbs answer an older store by its own version") builds contexts with no `cut` key, so it runs the base's statements. `VERB_TABLES covers exactly the read verbs …` holds with `memberships` in tree's list, a v1 table.

- [ ] **Step 9: Check the text this task adds.** Each command prints what follows it:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-recall.test.ts || echo 'no D-TBD token'
grep -c 'nodes_fts' ccd/history/recall.mjs
git diff --stat -- ccd/history/sweep.mjs ccd/history/store.mjs ccd/history/derive.mjs ccd/history/card.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs
```

Expected: `no D-TBD token`; `0`; an empty diff stat.

- [ ] **Step 10: Commit.**

```bash
for f in ccd/history/recall.mjs ccd/history/lib.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t3/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git add ccd/history/recall.mjs ccd/history/lib.mjs ccd/history/lib.d.mts server/test/history-recall.test.ts
git status --short
git commit -m "feat(history): the as-of cut hides leaves, parents and epochs at every read door, and a hidden id is absent (W2-2a Task 3; W2-D35, W2-D36)"
```

The loop prints nothing: no mutant is left in a file the commit takes (a `NOT RESTORED` line stops the commit; report it). `git status --short` must list exactly these four files before the commit.

**Not in this task:**
- The cut's definition, `asOfEntrySql`, `asOfBinds` and `asof-invalid` (Task 1); the store half and the predicate at grep's referrer join, expand's items and `--around` (Task 2), with `VERB_TABLES.grep`'s `memberships`; the regex child's job (Task 4).
- W2-D37 (Task 4): the cursor keys gaining `asof`, and the header's counts (families, transcripts) and lag over what is visible. tree's N and describe's `sources_total` are this task's, because they count what the site itself lists (R5); so are describe's `refs_total` and `files_total` (site 16, R8).
- R8's SEC-1 (Task 4): tree's per-family heading over `visibleScope(rc).families`. This task's epoch filter leaves a family with no visible epoch headed and empty; Task 4's edit removes the heading.
- W2-D39's CLI half (the in-pane refusal and the allow-list, Task 5).
- W2-D41 (W2-2b): a family with no visible epoch dropped from the scope and its count, and the env path's widened scopes.
- W2-5b's card parent, which is meant to ask `asOfHiddenNodesSql` (W2-D75).

This task's drifts are the header's rows for Task 3 (`nodes_fts`, `node_refs` with R8's mined refs, `resolveScopedId`, `--node`, the six further doors, tree's own prefixes, `leafHeads`, `VERB_TABLES`).

---
### Task 4: the remaining doors: the regex child, the cursors and the header (W2-D37, W2-D38)

Tasks 1 to 3 give lib its one cut definition and `asof-invalid`, give recall.mjs the store half `asOfCutOf` and its cut helpers, and apply the cut at every entry, node and epoch site in recall.mjs. Three doors are left, and this task closes them:
- **The regex child** (W2-D38). The parent hands the child a JSON job on stdin. The child picks its own candidate blobs with its own SQL, so today it scans every in-scope row. This task gives the job a required `cut` key. Its value is the bind values the parent uses for lib's one predicate (`asOfBinds`, through Task 2's `cutBinds`), or null when no cut is set. The child applies lib's own fragment (`asOfEntrySql`) to its entry branch and its variant branch. A sidecar follows its entry (W2-D35): under a cut, it is a candidate only through a visible entry, so one with a NULL `entry_id` never is.
- **The cursors** (W2-D37). Each resource's cursor has a fixed set of fields (`CURSOR_FIELDS`; `cursorShapeOk` refuses any extra key), so the cut goes into the key itself. grep's key is a hash, and it gains `asof` only when a cut is set. expand's key `t` is also the target that a bare `--cursor` resumes, so lib's new `expandCursorKey(key, asof)` appends `:asof:<uuid>` only under a cut, and `expandResumeOf` drops that suffix before it reads the target. A cursor minted under another cut, or under none, gets the verb's existing stale-cursor answer. This holds in both directions. With no cut, both keys are the ones every earlier build printed.
- **The header** (W2-D37). The header grammar is unchanged, but its counts are computed over what is visible. A new `visibleScope(rc)` returns the scope's families and transcripts as the cut leaves them: a transcript by the predicate, a family by Task 3's `cutVisibleEpochs` (W2-D35's epoch rule, asked of lib's one statement). The header's transcript and family counts read it, and so does its lag. So does the `--json` scope object, which is now defined once: recall.mjs's private `jsonScope` becomes the exported `scopeJsonOf`, and cli.mjs's hand-kept twin `scopeJson` is deleted in favour of it. So does tree's per-family heading (`family <id> generation=… first-seen=…`), which the leak lens found reading `rc.scope.families` (R8, SEC-1): a family with no visible epoch is never named by tree.

C59 and C69 stay green. With no cut, the job's new key is `null`, the child's SQL is byte for byte the base's, and both cursor keys are unchanged. C69's malformed-job case still gets its fixed words. A job that lacks `cut` gets new fixed words of its own, and neither message echoes a unit. Spec: none. W2-D37 and W2-D38 are not departures (section 3 marks both "no"), section 6 has no erratum for them, and this task defines no D-number.

**Order.** This task consumes Tasks 1 to 3 and runs before Task 5, whose regions it does not touch. It touches none of Tasks 1 to 3's regions:
- not lib's cut definition or `REASON_ROWS`;
- not recall.mjs's per-site SQL cuts (`referrerSql`, the grep filter, `expandResolve`, `coveringLeaves`, `leafHeads`, `scopePrefixes`, `resolveNodeInScope`, `tree`'s node list, parents and epoch loop, `describe`); its one `runTree` edit is the family loop's head, the line above Task 3's epoch-loop edit (R8);
- not cli.mjs's `readContextIn`, where Task 5 adds the seam refusal.

Line numbers below were measured at `cd622b2f6` and are hints only. Tasks 1 to 3 move them. Re-anchor every edit by the quoted content: Step 1 asserts that each anchor occurs exactly once.

**Files:**
- Modify: `ccd/history/lib.mjs`:
  - the module-private `ASOF_KEY_SEP` and the exported `expandCursorKey`, directly above the doc comment that begins `/** What a decoded expand cursor names, for \`expand --cursor <c>\` given alone:` (about :8361 at `cd622b2f6`);
  - that doc comment and `expandResumeOf`'s body, replaced (about :8361-8373).
- Modify: `ccd/history/lib.d.mts`: one declaration, directly above `export function entryScopeVerdict(i: { found: boolean; inScope: boolean }): 'ok' | 'out-of-scope' | 'not-found';` (about :906).
- Modify: `ccd/history/recall.mjs`:
  - `VISIBLE` and `export function visibleScope(rc)`, directly above `const HEADERS = new WeakMap();` (about :157);
  - `scopeHeader`'s three lines that read `rc.scope.transcriptPks` and `rc.scope.families` (about :165-168), and its doc comment;
  - `function jsonScope(rc) {` and its doc comment (about :198-207), replaced by `export function scopeJsonOf(rc) {`;
  - `renderJson`'s `scope: jsonScope(rc),` (about :212);
  - `runTree`'s family loop head, `  for (const f of rc.scope.families) {` (about :268; R8, SEC-1);
  - `asOfOf(rc)`, new, directly above `/** The hint a refused cursor carries. */` (about :609);
  - `grepKey` and its doc comment (about :612-620);
  - `runRegex`'s job, one key after `    pattern: guard.source,` (about :844);
  - `runExpand`'s `const at = xlib.decideExpandCursor({ cursor: decoded, key: r.key, total: items.length });` (about :1738) and its `t: r.key, i: next.i` (about :1756).
- Modify: `ccd/history/regex-worker.mjs`:
  - the header comment's last sentence (about :25-26);
  - the lib import line (about :29);
  - `candidateSql` and its doc comment (about :39-55);
  - `scanRegexJob`'s first lines, its `prepare` and its `base` (about :62-73).
- Modify: `ccd/history/cli.mjs`:
  - the recall.mjs import line (about :64) gains `scopeJsonOf`;
  - `scopeJson` and its doc comment are deleted (about :815-824);
  - `emitResult`'s `scope: scopeJson(rc),` (about :834);
  - `SCOPE_FAMILIES_JSON_MAX,` leaves the lib import (about :60), where it has no other reader.
- Test: `server/test/history-lib.test.ts`: one describe appended at the end of the file, 5 cases, pure (runs on darwin).
- Test: `server/test/history-recall.test.ts`: one describe appended at the end of the file, 12 cases, skipped on darwin like every spawning describe there.
- Not edited:
  - `single-definition.test.ts`: `ASOF_KEY_SEP` is module-private, so O14's `VOCABS` does not change. This task's one-definition scans live in its own recall describe.
  - `history-cli.test.ts`: cli.mjs's envelope keeps its exact shape with no cut, and its existing `--json` cases are this task's identity check (Step 9).
  - The spec, `deploy/**`, `shared/**`, README.md, `lifecycle.test.ts`, `derive.mjs`, `sweep.mjs`, `store.mjs`, `ccd/session-hook.sh` and `.github/**` (W2-2a's never-touch list).

**Interfaces:**
- Consumes, from Tasks 1 to 3. Step 0 checks each name, and stops if one is missing.
  - `lib.mjs` (Task 1): W2-D38's one SQL predicate fragment, `asOfEntrySql(alias: string): string`. It is a boolean SQL expression over an `entries` row aliased `alias`, it uses named parameters only, and it names schema v1 columns only (the child has no version-aware select).
  - `lib.mjs` (Task 1): `asOfBinds(cut: AsOfCut): Record<string, string | number | null>`. It answers exactly the named parameters `asOfEntrySql` uses, as JSON-safe values (kept(N) as JSON text, never a `Set`), so the job carries them through `JSON.stringify` unchanged.
  - `AsOfCut` (Task 1; W2-D38): `{ asof, tsCut, boundaryEntryId, summaryEntryId, keptUuids, holdingFileId, boundaryLine }`, with `asof` boundary N's entry uuid.
  - `recall.mjs` (Task 2; W2-D39's store half, R2): `asOfCutOf(rc, asof: string): { ok: true; cut: AsOfCut } | { ok: false; rc: 2; reason: 'asof-invalid' }`. This task's cases build every cut through it. The fixture case keeps R2's CONTROL: it measures N's cut with SQL (`sqlCutAt`, Task 2's `cutAt` shape: the boundary row, `pickHoldingCopy` over `ingest_files` LEFT JOIN `memberships`, the anchor's summary row, kept(N) from the fixture) and asserts that `asOfCutOf` deep-equals it, all seven fields.
  - `recall.mjs` (Task 2), module-private: `cutOf(rc)`, `cutAnd(rc, alias)` and `cutBinds(rc)`, reused here so recall.mjs still calls `asOfEntrySql` and `asOfBinds` once each; and every entry site honouring `rc.scope.cut` (grep's referrer join, so a hidden referrer is never a hit, for FTS and `--regex` alike, and never counted; `expandResolve`, so a hidden entry answers exit 3).
  - `recall.mjs` (Task 3), module-private: `cutVisibleEpochs(rc, uuids)`, the epochs lib's `asOfVisibleEpochsSql` shows (null with no cut); and the node sites (a hidden node is exit 3 when it is resolved).
  - Base, unchanged: `decodeCursor`, `encodeCursor`, `CURSOR_FIELDS` and `CURSOR_TEXT_RE` (at most 128 characters of `[A-Za-z0-9._:-]`), `decideExpandCursor`, `expandTargetOf`, `AROUND_MAX`, `headerLine`, `scopeLag`, `SCOPE_FAMILIES_JSON_MAX`; recall.mjs's private `bindFor`, `eofOf`, `STALE_CURSOR` and `refusal`; and the regex child's job keys `dbPath`, `transcriptPks`, `provenance`, `prefilter`, `pattern`, `pairs` and `belt`.
  - Tests: `historyHelpers.ts` (`makeHistoryBox`, `runSweep`, `plantSession`, `plantTranscript`, `spoolLine`, `openStoreRO`, `SEED_SLUG`, `REPO`) and history-recall's file-level `GRX` (`rc`, `grepArgs`), `GrepRc`, `GrepVerbResult`, `GrepDeps`, `t16seed`, `t16scan`, `t16uuid`, `t16ts`, `t16summary`, `RDatabaseSync`, `libRead` (its `pickHoldingCopy` for `sqlCutAt`) and `HEAVY`.
- Produces:
  - `lib.mjs`: `export function expandCursorKey(key, asof): string`. With `asof === null`, it answers `key` unchanged. Otherwise it answers `` `${key}:asof:${asof}` ``. No key expand prints contains `:asof:`: a node id is a kind letter and hex, an entry key is a uuid or `x` and 32 hex, and an around key is `around:<uuid>:<b>:<a>`.
  - `lib.mjs`: `expandResumeOf(cursor)`, same signature. It drops a trailing `:asof:…` from `cursor.t` before it reads the target, so a bare `expand --cursor <c>` minted under a cut names its target again. The cut itself is checked by `decideExpandCursor`, never here.
  - `lib.mjs`, module-private: `ASOF_KEY_SEP = ':asof:'`, spelled once.
  - `lib.d.mts`: `export function expandCursorKey(key: string, asof: string | null): string;`, declared once.
  - `recall.mjs`: `export function visibleScope(rc): { families: ScopeFamily[]; transcriptPks: number[] }`.
    - With no cut, it answers the scope's own two arrays.
    - Under a cut, a transcript counts iff it holds an entry `asOfEntrySql` leaves visible. A family counts iff one of its confirmed epochs is visible by `cutVisibleEpochs` (lib's `asOfVisibleEpochsSql`), so the epoch rule has one definition (W2-D38).
    - It is computed once per context (a `WeakMap` keyed by `rc`), and it never narrows `rc.scope`.
  - `recall.mjs`: `export function scopeJsonOf(rc): { kind, id, project, families: { ccrc_id, generation, first_seen_ms }[], families_total, transcripts }`. This is the base's JSON scope object, read over `visibleScope`. It is the one definition: cli.mjs's envelope prints it, and tree's cap fitting measures it.
  - `recall.mjs`: `scopeHeader(rc)` answers what it answered before (`{ line, indexedThroughMs, lagS }`). Its `families`, `transcripts` and lag are read over `visibleScope`, so the grammar (`headerLine`) is unchanged.
  - `recall.mjs`: `runTree(rc, a)` heads the families of `visibleScope(rc).families`, in scope order, never `rc.scope.families` (R8, SEC-1). With no cut that is the scope's own list, so tree's output is the base's.
  - `recall.mjs`, module-private:
    - `asOfOf(rc): string | null`, which is `rc.scope.cut.asof`, or null;
    - `grepKey(rc, a)`, whose hashed object gains `asof` only when a cut is set;
    - `runRegex`'s job, which gains `cut: Record<string, string | number | null> | null`, always present;
    - `runExpand`, which checks and mints its cursor against `expandCursorKey(r.key, asOfOf(rc))`.
  - `regex-worker.mjs`:
    - `scanRegexJob(job)` requires `Object.hasOwn(job, 'cut')`. Without it, it throws `the job names no cut`: fixed words that echo nothing.
    - `job.cut === null` scans as the base did.
    - Otherwise `candidateSql(withPrefilter, true)` adds `AND (asOfEntrySql(alias))` to the entry and variant branches. The sidecar branch joins `entries se` on its `entry_id` and adds the same fragment over `se`, and the job's `cut` values are spread into the binds as they came.
    - `candidateSql(withPrefilter, false)` is the base's text, byte for byte.
  - `cli.mjs`: `scopeJson` is gone, and `emitResult` prints `scopeJsonOf(rc)`.

**Choices this task makes:**
- **The cut joins the key, never the cursor's fields.** `encodeCursor` and `decodeCursor` hold each resource to an exact field list. That keeps recalled text out of a `next:` line (the comment above `cursorShapeOk`). An optional `asof` field would loosen that rule for every resource. W2-D37 says "the cursor keys gain asof", and both keys can carry it:
  - grep's `q` is a hash of a canonical object, so `asof` joins the object only when a cut is set;
  - expand's `t` is checked by plain equality, so a suffix is enough. With an exact uuid `asof`, the longest key is 91 characters, inside `CURSOR_TEXT_RE`'s 128. If some other `asof` ever made it longer, `encodeCursor`'s own check throws: exit 1, never a silent mismatch.
- **With no cut, both keys are unchanged.** A cursor printed by an earlier build, or by an uncut call, still resumes. Case 5 pins grep's uncut key against the base's object, and case 7 (the expand cursor case) pins expand's uncut `t` against the target.
- **The stale answer is each verb's existing one.** grep answers `bad-args` with `STALE_CURSOR`'s hint, and runRegex refuses it before any child is spawned. expand answers `bad-args` with "that --cursor belongs to another expansion". No new word: W2-D37 says "the stale-cursor answer".
- **A bare `expand --cursor` resolves its target under the call's own cut before the key check**, as it does today. A target the call's cut hides therefore answers exit 3 (Tasks 2 and 3's hidden-means-absent), and a visible one with a foreign cursor answers the stale refusal. Neither tells the caller what the other cut showed. The expand cursor case's last lines pin it (a window minted under N+1 around e8, resumed alone under N, is exit 3), and mutant R18, a key check moved before the resolve, reds there.
- **C11 under a cut is the expand cursor case.** e3 alone outgrows a page, so its first page is partial with a `next:` cursor; that cursor resumes at `from > 0` under the cut it was minted under, alone and with its target, and is stale under any other cut or none. That is C11's shape (an oversized first item answers partial with a cursor that resumes) under a cut, so no separate case is added.
- **The job carries the binds, not the cut object.** `cutBinds` (lib's `asOfBinds`) answers the exact values the parent binds for the same predicate, so parent and child bind one set of values. A `Set` in the cut object could never reach the child as `{}`, because the child never sees the object. Case 4 (a kept(N) row with no stamp) pins the transit end to end.
- **`cut` is required in the job, and null means "no cut".** The child refuses a job without the key, so a parent that forgot it fails closed (exit 1, `childFailed`) and never scans uncut. Absent and null are two conditions with two answers (no overloaded null at a seam).
- **The child's own door is pinned in-process.** The parent re-runs the child's matches through grep's own referrer join (`REGEX_MATCH` through `rankedAndCounted`), and Task 2 cuts that join. So with Task 2's cut in place, a child that ignored the cut would change no CLI answer. Case 3 therefore calls `scanRegexJob` with the parent's own captured job. It is the case that reds when the child ignores the cut (mutant W1), and it also pins that hidden candidates are not even scanned (`scanned`).
- **The header's lag is read over the visible transcripts too.** §8.3's lag is now minus the oldest end-of-file mark in scope. A transcript the cut hides would otherwise move it, or make it `unmeasured`, and so reveal that the transcript exists. Case 11 (the lag case) pins this. The mark itself is a tick's reading time, never a row's stamp.
- **Families are counted and named over what is visible in the header and the JSON scope, and `rc.scope` is not narrowed (R5).** W2-D37 asks for the counts. W2-D41, which is W2-2b's, drops a family with no visible epoch "from the scope and its count". This task does only the counting and naming half, at the doors it owns, and W2-2b's drop can build on `visibleScope`. The leak lens found a third naming door, tree's per-family heading, and R8 (SEC-1) gives it to this task: the loop reads `visibleScope(rc).families`, fail closed, and the widened tree case pins it (mutant R19). tree's `family` map, which fills a node item's `ccrc_id` and `generation`, keeps `rc.scope.families`: a node the cut shows has a visible boundary entry, so its family has a visible epoch, and a hidden family has no visible node to name it.
- **The JSON scope object is defined once.** recall.mjs's `jsonScope` called itself a mirror of cli.mjs's `scopeJson`. Making the counts visible in two hand-kept copies would leave one door open the first time either drifted. cli.mjs already imports `scopeHeader` from recall.mjs, and it now imports `scopeJsonOf` the same way.
- **The fixture carries a second copy of the first transcript (the DM2b shape, as Task 2's has).** It rewrites hidden e9's body, so the child's variant branch has a hidden variant to skip (mutant W5), and N's holding copy stays the first: the fixture case measures the cut with SQL through `pickHoldingCopy` and deep-equals `asOfCutOf`'s against it (R2's CONTROL).
- **regex-worker.mjs imports only `asOfEntrySql`.** The binds come from the job, so the child never builds them. Case 12 (the scan case) pins that the child spells no stamp, membership or kept column of its own.

**Residuals, named:**
- **"A sidecar follows its entry" is composed twice from the one predicate:** in the parent's referrer join (Task 2) and in the child's candidate join (here). Each composition is a join plus lib's fragment. Neither spells the predicate.
- **describe's cursor is not bound to the cut.** W2-D37 names grep and expand. A describe cursor names a node and an offset into that node's summary, and a node the cut hides answers exit 3 when it is resolved (Task 3).
- **A `next:` line names no cut.** The argv it prints reproduces the query, the scope and the filters. The cut rides on the env path, which is W2-2b's.
- **A cursor minted under N resumes under N after more rows are ingested.** The offset can shift by the number of new hits, as it can today (the comment above `cursorPos`).

- [ ] **Step 0: Check the base holds Tasks 1 to 3.** From the repository root, before any edit:

```bash
git log --oneline -3 | grep -c 'W2-2a Task [123]'
grep -c '^export function asOfEntrySql(' ccd/history/lib.mjs
grep -c '^export function asOfBinds(' ccd/history/lib.mjs
grep -c '^export function asOfCutOf(rc, asof) {$' ccd/history/recall.mjs
grep -cE '^function (cutOf\(rc\)|cutAnd\(rc, alias\)|cutBinds\(rc\)|cutVisibleEpochs\(rc, uuids\)) \{$' ccd/history/recall.mjs
```

Expected: `3`, `1`, `1`, `1`, then `4`. If any count differs, make no edit, and report the names Tasks 1 to 3 actually produced to the coordinator.

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
grep -c '^const HEADERS = new WeakMap();$' ccd/history/recall.mjs
grep -c '^  const lag = scopeLag({ eofMs: eofOf(rc.db, rc.scope.transcriptPks), nowMs: rc.nowMs, recovering });$' ccd/history/recall.mjs
grep -c '^    transcripts: rc.scope.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,$' ccd/history/recall.mjs
grep -c '^function jsonScope(rc) {$' ccd/history/recall.mjs
grep -c 'scope: jsonScope(rc),' ccd/history/recall.mjs
grep -c '^/\*\* The hint a refused cursor carries. \*/$' ccd/history/recall.mjs
grep -c '^function grepKey(rc, a) {$' ccd/history/recall.mjs
grep -c '^    pattern: guard.source,$' ccd/history/recall.mjs
grep -c 'key: r.key, total: items.length' ccd/history/recall.mjs
grep -c 't: r.key, i: next.i' ccd/history/recall.mjs
grep -c '^  for (const f of rc.scope.families) {$' ccd/history/recall.mjs
grep -c "^import { entryIndexText, makeBelt, makePairIndex } from './lib.mjs';$" ccd/history/regex-worker.mjs
grep -c '^function candidateSql(withPrefilter) {$' ccd/history/regex-worker.mjs
grep -c '^    const stmt = db.prepare(candidateSql(job.prefilter !== null));$' ccd/history/regex-worker.mjs
grep -c '^export function expandResumeOf(cursor) {$' ccd/history/lib.mjs
grep -c '^export function entryScopeVerdict(' ccd/history/lib.d.mts
grep -c '^function scopeJson(rc) {$' ccd/history/cli.mjs
grep -c 'scope: scopeJson(rc),' ccd/history/cli.mjs
grep -c 'SCOPE_FAMILIES_JSON_MAX' ccd/history/cli.mjs
grep -c 'expandCursorKey\|ASOF_KEY_SEP\|visibleScope\|scopeJsonOf\|asOfOf' ccd/history/*.mjs ccd/history/lib.d.mts server/test/history-lib.test.ts server/test/history-recall.test.ts
```

Expected (measured at `cd622b2f6`; Tasks 1 to 3 may have moved a line, never these texts):
- `1` for each of the first eighteen lines (the family loop head among them: Task 3 edits the epoch loop below it, never this line);
- `2` for `SCOPE_FAMILIES_JSON_MAX` in cli.mjs: the import and `scopeJson`'s one reader;
- `0` in every file for the last line: the five new names are free.

A `0` on an anchor means an earlier task rewrote that line. Read the function, apply this task's change to its current text, and record the drift in the run's notes. A `0` on `SCOPE_FAMILIES_JSON_MAX`'s second use means it already has no reader in cli.mjs: then leave its import line as it is.

Then record the base counts, one suite per tool call, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
```

Write each `N passed` (and any `skipped`) to `.superpowers/sdd/history-w2-2a/base-counts-task4.txt` (gitignored). Every file must be green at the base. Re-run a red file alone before reporting it (CLAUDE.md's load flakes).

- [ ] **Step 2: Write the failing tests.** Two appends, each after the file's last line, never above an existing describe.

(a) `server/test/history-lib.test.ts`: append:

```ts

// ── W2-2a Task 4 (W2-D37): an expand cursor's key names the as-of cut it was minted under ──────────────────────────
// Pure, so it runs on darwin too. A cursor holds exactly its resource's fields (encodeCursor refuses any other), so the cut
// joins the key itself: grep hashes it into `q` (recall.mjs grepKey), expand appends it to `t` here.
describe('expandCursorKey and expandResumeOf under an as-of cut (W2-D37; W2-2a Task 4)', () => {
  const lib = async () => await import('../../ccd/history/lib.mjs');
  const N = '0189abcd-1234-4678-9abc-00000000a5f6';
  const M = '0189abcd-1234-4678-9abc-00000000a5f7';
  const U = '0189abcd-1234-4678-9abc-00000000a5f8';
  /** One key of each kind expand prints: a node id, an entry uuid, a raw-only row's key and an around key. */
  const KEYS = ['L0123456789abcdef0123', U, `x${'0123456789abcdef'.repeat(2)}`, `around:${U}:50:50`];
  const cur = (t: string) => ({ v: 1 as const, resource: 'expand' as const, t, i: 0, o: 0 });

  it('with no cut, the key is the expansion\'s own, unchanged, so a cursor printed before W2-2a still resumes', async () => {
    const l = await lib();
    for (const k of KEYS) expect(l.expandCursorKey(k, null), k).toBe(k);
  });

  it('under a cut, the key names its boundary, and no two cuts, nor a cut and none, share a key', async () => {
    const l = await lib();
    for (const k of KEYS) {
      expect(l.expandCursorKey(k, N), k).toBe(`${k}:asof:${N}`);
      expect(new Set([l.expandCursorKey(k, null), l.expandCursorKey(k, N), l.expandCursorKey(k, M)]).size, k).toBe(3);
    }
  });

  it('a key minted under a cut resumes its own target, so a bare --cursor still names what it pages', async () => {
    const l = await lib();
    for (const k of KEYS) {
      const plain = l.expandResumeOf(cur(k));
      expect(plain, `CONTROL: ${k} resumes with no cut`).not.toBeNull();
      expect(l.expandResumeOf(cur(l.expandCursorKey(k, N))), k).toEqual(plain);
    }
  });

  it('decideExpandCursor refuses a cursor minted under another cut or under none, in both directions', async () => {
    const l = await lib();
    const K = KEYS[0]!;
    const at = (minted: string | null, used: string | null) =>
      l.decideExpandCursor({ cursor: cur(l.expandCursorKey(K, minted)), key: l.expandCursorKey(K, used), total: 1 });
    expect([at(null, null), at(N, N)], 'CONTROL: the same cut, or none, resumes').toEqual([{ ok: true, i: 0, o: 0 }, { ok: true, i: 0, o: 0 }]);
    for (const [minted, used] of [[null, N], [N, null], [N, M], [M, N]] as const) {
      expect(at(minted, used), `${String(minted)} then ${String(used)}`).toEqual({ ok: false });
    }
  });

  it('the longest key expand prints, under a cut, is still a cursor encodeCursor accepts and decodeCursor reads back', async () => {
    const l = await lib();
    const c = cur(l.expandCursorKey(`around:${U}:${l.AROUND_MAX}:${l.AROUND_MAX}`, N));
    expect(c.t.length, 'CONTROL: the longest key there is').toBe(91);
    expect(l.decodeCursor(l.encodeCursor(c), 'expand')).toEqual(c);
  });
});
```

(b) `server/test/history-recall.test.ts`: append:

```ts

// ── W2-2a Task 4 (W2-D37, W2-D38): the remaining doors of the as-of cut ──────────────────────────────────────────
// The regex child applies lib's one predicate with the values the parent binds; the grep and expand cursors are bound to
// the cut; the header and the --json scope count and name only what the cut leaves visible. In-process: no W2-2a CLI path
// sets a cut (W2-2b's env path does), so every cut here rides on rc.scope.cut, built by Task 2's store half.
//
// The fixture: one family whose first transcript holds boundary N (e6, kept(N) = [e5]) and boundary N+1 (e13), then a
// /clear epoch and another family of the project, both stamped long after N. Under N: e1-e3 are visible by stamp; e4 has
// no stamp and is outside kept(N), so it is hidden; e5 has no stamp but is kept(N), so it is visible; e8 is after N;
// e9 is stamped before T_N but written after N's boundary in its holding copy (the positional clause), and a second copy
// of the transcript rewrites its body, so hidden e9 has a variant; out44.txt is the sidecar of hidden e11; orphan44.txt is
// a sidecar no row names (a NULL entry_id).
describe.skipIf(process.platform === 'darwin')('W2-D37 and W2-D38: the regex child, the cursors and the header under an as-of cut (W2-2a Task 4)', () => {
  const ID = 'claude-a-asof4';
  const OID = 'claude-a-asof4o';
  const G = '0189abcd-1234-4678-9abc-00000000a5f4';
  const GO = '0189abcd-1234-4678-9abc-00000000b5f4';
  const T1 = 'a5f40001';
  const T2 = 'a5f40002';
  const TO = 'a5f40003';
  const U1 = t16uuid(T1, 0);
  const U2 = t16uuid(T2, 0);
  const UO = t16uuid(TO, 0);
  const e = (i: number): string => t16uuid(T1, i);
  const LONG = `zqasoflong ${'plain words '.repeat(3000)}end`;
  const STALE_GREP = 'that --cursor belongs to another query, scope or filter; run the query again without it';
  const STALE_EXPAND = 'that --cursor belongs to another expansion';
  type Cut = {
    asof: string; tsCut: number; boundaryEntryId: number; summaryEntryId: number | null; keptUuids: readonly string[];
    holdingFileId: number; boundaryLine: number;
  };
  type CutRc = GrepRc & { scope: { cut?: Cut | null } };
  type Job = Record<string, unknown> & { cut: Record<string, unknown> | null };
  type Recall = {
    runGrep(rc: CutRc, a: RGrepArgs, deps?: GrepDeps): GrepVerbResult;
    runExpand(rc: CutRc, a: Record<string, unknown>): GrepVerbResult;
    runTree(rc: CutRc & { scopeArgs: string[] }, a: { depth: number; json: boolean }): GrepVerbResult;
    scopeHeader(rc: CutRc): { line: string; indexedThroughMs: number | null; lagS: number | null };
    scopeJsonOf(rc: CutRc): { kind: string; id: string; project: string | null; families: Array<{ ccrc_id: string; generation: string; first_seen_ms: number }>; families_total: number; transcripts: number };
    asOfCutOf(rc: CutRc, asof: string): { ok: true; cut: Cut } | { ok: false; rc: 2; reason: 'asof-invalid' };
  };
  type Worker = { scanRegexJob(job: Record<string, unknown>): { matches: Array<{ blob_id: number; match: string }>; scanned: number } };
  const L = libRead as unknown as { asOfBinds(c: Cut): Record<string, unknown>; expandCursorKey(k: string, a: string | null): string };
  let box: rH.HistoryBox;
  const rec = async (): Promise<Recall> => (await import('../../ccd/history/recall.mjs')) as unknown as Recall;
  const withCut = (rc: GrepRc, cut: Cut | null): CutRc => ({ ...rc, scope: { ...rc.scope, cut } });
  /** The cut at boundary `uuid`, through Task 2's store half (W2-D39, R2): every case's cut comes through it, and the
   *  fixture case's CONTROL deep-equals it against the cut sqlCutAt measures. */
  const cutAt = async (rc: GrepRc, uuid: string): Promise<Cut> => {
    const r = (await rec()).asOfCutOf(rc, uuid);
    if (!r.ok) throw new Error(`fixture: boundary ${uuid} gave no cut (${r.reason})`);
    return r.cut;
  };
  /** W2-D38's cut for boundary `uuid`, measured with SQL as W2-D34 defines it, without asOfCutOf (R2), as Task 2's cutAt
   *  measures it: the boundary's own stamp, its holding copy by lib's pickHoldingCopy (a live copy first, then the lowest
   *  file_id) and its line there, the summary row its anchor names, and the kept set the fixture's boundary keeps. */
  function sqlCutAt(db: RDatabaseSync, uuid: string, kept: string[]): Cut {
    const b = db.prepare(`SELECT e.entry_id AS entry_id, e.ts_ms AS ts_ms, e.transcript_pk AS tpk, bd.anchor_uuid AS anchor
      FROM entries e JOIN boundaries bd ON bd.entry_id = e.entry_id WHERE e.uuid = ?`).get(uuid) as unknown as
      { entry_id: number; ts_ms: number; tpk: number; anchor: string };
    const copies = db.prepare(`SELECT f.file_id AS file_id, f.source_key AS source_key, mb.line AS line FROM ingest_files f
      LEFT JOIN memberships mb ON mb.file_id = f.file_id AND mb.entry_id = ? WHERE f.transcript_pk = ? ORDER BY f.file_id`)
      .all(b.entry_id, b.tpk) as unknown as Array<{ file_id: number; source_key: string; line: number | null }>;
    expect(copies.filter((x) => x.line !== null), 'CONTROL: two copies hold boundary N').toHaveLength(2);
    const held = libRead.pickHoldingCopy(copies.map((x) => ({ fileId: Number(x.file_id), live: x.source_key === '', holds: x.line !== null })));
    const at = copies.find((x) => Number(x.file_id) === held)!;
    const sum = db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(b.anchor) as unknown as { entry_id: number };
    return {
      asof: uuid, tsCut: Number(b.ts_ms), boundaryEntryId: Number(b.entry_id), summaryEntryId: Number(sum.entry_id),
      keptUuids: [...kept].sort(), holdingFileId: Number(held), boundaryLine: Number(at.line),
    };
  }
  /** A spawn seam that records each job the parent writes on the child's stdin. With `real`, the child runs as runRegex runs
   *  it; otherwise it answers "no match" at once, for a case that reads only the job. */
  const spyOn = (jobs: Job[], real: boolean): GrepDeps['spawn'] => ((cmd: string, args: string[], opts: { input: string }) => {
    jobs.push(JSON.parse(opts.input) as Job);
    return real ? spawnSync(cmd, args, opts as never)
      : { status: 0, signal: null, error: undefined, stdout: `${JSON.stringify({ done: true, scanned: 0, matched: 0 })}\n`, stderr: '' };
  }) as unknown as GrepDeps['spawn'];
  const cursorOf = (next: string[] | null): string => {
    expect(next, 'CONTROL: the page has a next line').not.toBeNull();
    return next![next!.indexOf('--cursor') + 1]!;
  };
  const uuids = (r: GrepVerbResult): unknown[] => r.items.map((x) => x['entry_uuid']);

  beforeAll(() => {
    box = rH.makeHistoryBox('ccrc-hist-asof4-');
    const noStamp = (r: rFx.Row): rFx.Row => { const o = { ...r }; delete o['timestamp']; return o; };
    /** The first transcript's rows. `variant` is its second copy, which rewrites e9's body (a hidden row's variant). */
    const rows1 = (variant: boolean): rFx.Row[] => [
      rFx.userRow({ uuid: e(1), ts: t16ts(1), sessionId: U1, text: 'zqasofpage first zqasofpre' }),
      rFx.assistantRow({ uuid: e(2), ts: t16ts(2), parentUuid: e(1), sessionId: U1, text: 'zqasofpage second', requestId: 'req_a5f4_2', msgId: 'msg_a5f4_2' }),
      rFx.userRow({ uuid: e(3), ts: t16ts(3), parentUuid: e(2), sessionId: U1, text: LONG }),
      noStamp(rFx.userRow({ uuid: e(4), ts: t16ts(4), parentUuid: e(3), sessionId: U1, text: 'zqasofnull a row with no stamp' })),
      noStamp(rFx.userRow({ uuid: e(5), ts: t16ts(5), parentUuid: e(4), sessionId: U1, text: 'zqasofkept kept by boundary N' })),
      rFx.boundaryRow({ uuid: e(6), ts: t16ts(6), parentUuid: e(5), sessionId: U1, trigger: 'manual', headUuid: e(5), anchorUuid: e(7), tailUuid: e(5), allUuids: [e(5)] }),
      rFx.summaryRow({ uuid: e(7), ts: t16ts(7), parentUuid: e(6), sessionId: U1, text: t16summary('zqa5f4n') }),
      rFx.userRow({ uuid: e(8), ts: t16ts(8), parentUuid: e(7), sessionId: U1, text: 'zqasofpage third zqasofpost' }),
      rFx.userRow({ uuid: e(9), ts: t16ts(5), parentUuid: e(8), sessionId: U1,
        text: variant ? 'zqasofvar a later copy rewrote this row' : 'zqasofstep stamped before N, written after it' }),
      rFx.toolUseRow({ uuid: e(10), ts: t16ts(10), parentUuid: e(9), sessionId: U1, toolUseId: 'toolu_01A5F4SIDE', name: 'Bash', input: { command: 'cat out44.log' }, requestId: 'req_a5f4_10', msgId: 'msg_a5f4_10' }),
      rFx.toolResultRow({ uuid: e(11), ts: t16ts(11), parentUuid: e(10), sessionId: U1, toolUseId: 'toolu_01A5F4SIDE', content: 'Output too large. Full output saved to: tool-results/out44.txt' }),
      rFx.userRow({ uuid: e(12), ts: t16ts(12), parentUuid: e(11), sessionId: U1, text: 'zqasofmore kept by boundary N+1' }),
      rFx.boundaryRow({ uuid: e(13), ts: t16ts(13), parentUuid: e(12), sessionId: U1, trigger: 'manual', headUuid: e(12), anchorUuid: e(14), tailUuid: e(12), allUuids: [e(12)] }),
      rFx.summaryRow({ uuid: e(14), ts: t16ts(14), parentUuid: e(13), sessionId: U1, text: t16summary('zqa5f4m') }),
    ];
    const t = t16seed(box, { id: ID, project: 'demo', generation: G, uuid: U1, rows: rows1(false) });
    // A second copy in another account's home, read after the first (t16scan below), so e9's rewritten body is a variant
    // and the first copy (the lower file_id) still holds N: the DM2b shape, as Task 2's fixture has it.
    rH.plantTranscript(box, 'claude-b', path.basename(path.dirname(t)), U1, rows1(true));
    const dir = path.join(path.dirname(t), U1, 'tool-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'out44.txt'), 'zqasofside the sidecar body\n');
    fs.writeFileSync(path.join(dir, 'orphan44.txt'), 'zqasoforphan nobody names this file\n');
    // A /clear after N: epoch 2 of the same family, its one row stamped long after T_N (the history-card precedent).
    rH.plantSession(box, ID, { uuid: U2 });
    rH.plantTranscript(box, Object.keys(box.accountHome)[0]!, rH.SEED_SLUG, U2,
      [rFx.userRow({ uuid: t16uuid(T2, 1), ts: t16ts(30), sessionId: U2, text: 'zqasofclear after the clear' })]);
    rH.spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U2, src: 'clear', gen: G });
    const cleared = (): boolean => {
      const db = rH.openStoreRO(box);
      try {
        return Number((db.prepare(`SELECT count(*) AS n FROM epochs ep WHERE ep.cc_session_uuid = ? AND ep.confirmed_ms IS NOT NULL
          AND EXISTS (SELECT 1 FROM transcripts t JOIN entries x ON x.transcript_pk = t.transcript_pk WHERE t.cc_session_uuid = ep.cc_session_uuid)`)
          .get(U2) as { n: number }).n) === 1;
      } finally { db.close(); }
    };
    for (let i = 0; i < 4 && !cleared(); i += 1) { const s = rH.runSweep(box); expect(s.code, s.stderr).toBe(0); }
    expect(cleared(), 'CONTROL: the /clear epoch is confirmed and holds its row').toBe(true);
    // Another family of the same project, wholly after N.
    t16seed(box, { id: OID, project: 'demo', generation: GO, uuid: UO,
      rows: [rFx.userRow({ uuid: t16uuid(TO, 1), ts: t16ts(40), sessionId: UO, text: 'zqasofother another family' })] });
    t16scan(box);
  }, 6 * HEAVY);

  it('the fixture: boundary N keeps a row with no stamp, N+1 follows, a hidden row has a variant, a /clear epoch and another family come after N, and the store half measures the SQL-measured cut', async () => {
    const rc = await GRX.rc(box, ID);
    try {
      const cut = await cutAt(rc, e(6));
      expect([cut.asof, cut.tsCut, [...cut.keptUuids]], 'N, T_N and kept(N)').toEqual([e(6), Date.parse(t16ts(6)), [e(5)]]);
      const measured = ((): Cut => {
        const db = rH.openStoreRO(box);
        try { return sqlCutAt(db, e(6), [e(5)]); } finally { db.close(); }
      })();
      expect((await rec()).asOfCutOf(rc, e(6)), 'CONTROL (R2): the store half deep-equals the cut measured with SQL, all seven fields')
        .toEqual({ ok: true, cut: measured });
      const variants = Number((rc.db.prepare(`SELECT count(*) AS n FROM entry_variants v JOIN entries x ON x.entry_id = v.entry_id
        WHERE x.uuid = ? AND v.blob_id <> x.blob_id`).get(e(9)) as { n: number }).n);
      expect(variants, 'CONTROL: the second copy gave hidden e9 one variant body').toBe(1);
      const ts = (u: string): unknown => (rc.db.prepare('SELECT ts_ms AS t FROM entries WHERE uuid = ?').get(u) as { t: number | null }).t;
      expect([ts(e(4)), ts(e(5)), ts(e(9))], 'two rows with no stamp; one written after N, stamped before T_N').toEqual([null, null, Date.parse(t16ts(5))]);
      expect(rc.db.prepare(`SELECT s.name AS name, x.uuid AS uuid FROM sidecars s LEFT JOIN entries x ON x.entry_id = s.entry_id
        WHERE s.name IN ('orphan44.txt', 'out44.txt') ORDER BY s.name`).all(), 'one sidecar linked to e11, one linked to nothing')
        .toEqual([{ name: 'orphan44.txt', uuid: null }, { name: 'out44.txt', uuid: e(11) }]);
      expect(rc.scope.transcriptPks, 'two confirmed epochs: the first transcript and the /clear one').toHaveLength(2);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D38: the parent hands the regex child the cut as the values it binds, and a row the cut hides is no --regex hit', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const cutN = await cutAt(rc, e(6));
      const jobs: Job[] = [];
      const spawn = spyOn(jobs, true);
      const a = await GRX.grepArgs(['--regex', '[z]qasofpos[t]']);
      const open = recall.runGrep(rc, a, { spawn, budgetMs: 60_000 });
      expect([open.exit, uuids(open)], 'CONTROL: with no cut, the row after N is a hit').toEqual([0, [e(8)]]);
      expect(Object.hasOwn(jobs[0]!, 'cut'), 'with no cut the job says so, never by leaving the key out').toBe(true);
      expect(jobs[0]!.cut).toBeNull();
      const cut = recall.runGrep(withCut(rc, cutN), a, { spawn, budgetMs: 60_000 });
      expect([cut.exit, cut.items, cut.total, cut.hint], 'exit 3 with the reach line, nothing shown or counted').toEqual([3, [], 0, libRead.SEARCH_REACH]);
      expect(jobs[1]!.cut, 'the job carries lib asOfBinds of the cut, through JSON').toEqual(JSON.parse(JSON.stringify(L.asOfBinds(cutN))));
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D38: the child applies the lib predicate itself: hidden rows, a row with no stamp, a positional hide, a hidden row\'s variant and the sidecars of a hidden row or of none are never scanned', async () => {
    const recall = await rec();
    const worker = (await import('../../ccd/history/regex-worker.mjs')) as unknown as Worker;
    const rc = await GRX.rc(box, ID);
    try {
      const cutN = await cutAt(rc, e(6));
      const jobs: Job[] = [];
      const spawn = spyOn(jobs, false);
      const a = await GRX.grepArgs(['--regex', '[z]qasofpr[e]']);
      recall.runGrep(rc, a, { spawn });
      recall.runGrep(withCut(rc, cutN), a, { spawn });
      expect(jobs, 'CONTROL: one job each, as the parent wrote them').toHaveLength(2);
      const label = new Map<number, string>();
      const byUuid = (u: string, l: string): void => { label.set(Number((rc.db.prepare('SELECT blob_id AS b FROM entries WHERE uuid = ?').get(u) as { b: number }).b), l); };
      const byName = (n: string, l: string): void => { label.set(Number((rc.db.prepare('SELECT blob_id AS b FROM sidecars WHERE name = ?').get(n) as { b: number }).b), l); };
      byUuid(e(1), 'pre'); byUuid(e(8), 'post'); byUuid(e(9), 'step'); byUuid(e(4), 'null'); byUuid(e(5), 'kept');
      byName('out44.txt', 'side'); byName('orphan44.txt', 'orphan');
      label.set(Number((rc.db.prepare(`SELECT v.blob_id AS b FROM entry_variants v JOIN entries x ON x.entry_id = v.entry_id
        WHERE x.uuid = ? AND v.blob_id <> x.blob_id`).get(e(9)) as { b: number }).b), 'stepvar');
      const P = 'zqasof(?:pre|post|step|null|kept|side|orphan|var)';
      const scan = (j: Job) => worker.scanRegexJob({ ...j, pattern: P, prefilter: null });
      const open = scan(jobs[0]!);
      expect(open.matches.map((m) => label.get(m.blob_id)).sort(), 'CONTROL: with no cut, the child matches every one')
        .toEqual(['kept', 'null', 'orphan', 'post', 'pre', 'side', 'step', 'stepvar']);
      const cut = scan(jobs[1]!);
      expect(cut.matches.map((m) => label.get(m.blob_id)).sort(), 'under N: the row before N and kept(N) only').toEqual(['kept', 'pre']);
      expect(cut.scanned, 'a hidden candidate is not even scanned').toBeLessThan(open.scanned);
      const noKey: Record<string, unknown> = { ...jobs[1]!, pattern: P, prefilter: null };
      delete noKey['cut'];
      expect(() => worker.scanRegexJob(noKey), 'a job with no cut key is malformed, never read as uncut').toThrow('the job names no cut');
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D38: a kept row reaches the child with the cut, and a row with no stamp outside kept(N) does not: --regex end to end', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      const run = async (r: CutRc, pattern: string) => recall.runGrep(r, await GRX.grepArgs(['--regex', pattern]), { budgetMs: 60_000 });
      const kept = await run(rcN, '[z]qasofkep[t]');
      expect([kept.exit, uuids(kept)], 'kept(N) is visible whatever its stamp').toEqual([0, [e(5)]]);
      const nul = await run(rcN, '[z]qasofnul[l]');
      expect([nul.exit, nul.items], 'a row with no stamp outside kept(N) is absent').toEqual([3, []]);
      const open = await run(rc, '[z]qasofnul[l]');
      expect([open.exit, uuids(open)], 'CONTROL: with no cut it is a hit').toEqual([0, [e(4)]]);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D37: a grep cursor is bound to its cut: minted with none, under N or under N+1, it resumes only under the same one', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      const rcM = withCut(rc, await cutAt(rc, e(13)));
      const page = async (r: CutRc, cursor: string | null) =>
        recall.runGrep(r, await GRX.grepArgs(['zqasofpage', '--limit', '1', ...(cursor === null ? [] : ['--cursor', cursor])]));
      const u = await page(rc, null);
      const n = await page(rcN, null);
      const m = await page(rcM, null);
      expect([u.total, n.total, m.total], 'CONTROL: the count each cut leaves (e8 is after N, before N+1)').toEqual([3, 2, 3]);
      const [cu, cn, cm] = [cursorOf(u.next), cursorOf(n.next), cursorOf(m.next)];
      expect((await page(rc, cu)).exit, 'CONTROL: no cut, then no cut').toBe(0);
      const nn = await page(rcN, cn);
      expect([nn.exit, uuids(nn)], 'CONTROL: N then N, the second page').toEqual([0, [e(1)]]);
      expect((await page(rcM, cm)).exit, 'CONTROL: N+1 then N+1').toBe(0);
      for (const [name, r, c] of [['none then N', rcN, cu], ['N then none', rc, cn], ['N then N+1', rcM, cn], ['N+1 then N', rcN, cm]] as const) {
        const s = await page(r, c);
        expect([s.exit, s.reason, s.hint, s.items, s.total], name).toEqual([2, 'bad-args', STALE_GREP, [], 0]);
      }
      // With no cut the key is the one every earlier build printed: its hashed object holds no asof.
      expect(libRead.decodeCursor(cu, 'grep')!.q).toBe(libRead.sha256Hex(libRead.canonicalJson({
        words: libRead.sanitizeFtsQuery('zqasofpage'), regex: null, scope: ['family', ID, G],
        role: null, tool: null, since: null, before: null, node: null, sort: 'recency', recall: false,
      })).slice(0, 20));
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D37: a --regex cursor is bound to its cut the same way, and refused before any child is spawned', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      const jobs: Job[] = [];
      const spawn = spyOn(jobs, true);
      const argv = (cursor: string | null) => GRX.grepArgs(['--regex', '[z]qasofpag[e]', '--limit', '1', ...(cursor === null ? [] : ['--cursor', cursor])]);
      const n = recall.runGrep(rcN, await argv(null), { spawn, budgetMs: 60_000 });
      expect([n.exit, n.total], 'CONTROL: under N two hits, e8 hidden').toEqual([0, 2]);
      expect(recall.runGrep(rc, await argv(null), { spawn, budgetMs: 60_000 }).total, 'CONTROL: with no cut, three').toBe(3);
      const cn = cursorOf(n.next);
      const spawned = jobs.length;
      const s = recall.runGrep(rc, await argv(cn), { spawn, budgetMs: 60_000 });
      expect([s.exit, s.reason, s.hint], 'N then none').toEqual([2, 'bad-args', STALE_GREP]);
      expect(jobs.length, 'refused before the child').toBe(spawned);
      const ok = recall.runGrep(rcN, await argv(cn), { spawn, budgetMs: 60_000 });
      expect([ok.exit, uuids(ok)], 'CONTROL: N then N').toEqual([0, [e(1)]]);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D37: an expand cursor is bound to its cut, with its target and given alone; with no cut its key is the target itself; alone, it resolves its target under the call\'s own cut first', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      const rcM = withCut(rc, await cutAt(rc, e(13)));
      const X = (r: CutRc, cursor: string | null, target: string | null) =>
        recall.runExpand(r, { target, around: null, before: 5, after: 5, cursor, json: true });
      const mint = (r: CutRc): string => {
        const p = X(r, null, e(3));
        expect(p.exit, 'CONTROL: the long row is visible').toBe(0);
        return cursorOf(p.next);
      };
      const [cu, cn, cm] = [mint(rc), mint(rcN), mint(rcM)];
      expect(libRead.decodeCursor(cu, 'expand')!.t, 'no cut: the key every earlier build printed').toBe(e(3));
      expect(libRead.decodeCursor(cn, 'expand')!.t).toBe(L.expandCursorKey(e(3), e(6)));
      const how = (target: string | null): string => (target === null ? 'alone' : 'with its target');
      for (const [name, r, c] of [['none', rc, cu], ['N', rcN, cn], ['N+1', rcM, cm]] as const) {
        for (const target of [e(3), null]) {
          const p = X(r, c, target);
          expect([p.exit, Number(p.items[0]?.['from'] ?? 0) > 0], `CONTROL ${name} then ${name}, ${how(target)}: the second page`).toEqual([0, true]);
        }
      }
      for (const [name, r, c] of [['none then N', rcN, cu], ['N then none', rc, cn], ['N then N+1', rcM, cn], ['N+1 then N', rcN, cm]] as const) {
        for (const target of [e(3), null]) {
          const p = X(r, c, target);
          expect([p.exit, p.reason, p.hint, p.items], `${name}, ${how(target)}`).toEqual([2, 'bad-args', STALE_EXPAND, []]);
        }
      }
      // A bare --cursor resolves its target under the call's own cut BEFORE the key check: a window minted under N+1 around
      // e8, which N hides, answers exit 3 under N, never the stale refusal, so it tells nothing about what N+1 showed.
      const win = recall.runExpand(rcM, { target: null, around: e(8), before: 5, after: 5, cursor: null, json: true });
      expect(win.exit, 'CONTROL: under N+1 the window around e8 is visible, and e3 outgrows its first page').toBe(0);
      const cw = cursorOf(win.next);
      expect(X(rcM, cw, null).exit, 'CONTROL: N+1 then N+1, alone').toBe(0);
      const gone = X(rcN, cw, null);
      expect([gone.exit, gone.reason], 'N+1 then N, alone, on a target N hides').toEqual([3, undefined]);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D37: the header and the --json scope count only the transcripts the cut leaves visible, in the same grammar', async () => {
    const recall = await rec();
    const rc = await GRX.rc(box, ID);
    try {
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      const GRAMMAR = /^scope=family\(claude-a-asof4, (\d+) transcripts\) coverage=this-box indexed-through=\S+ lag=\S+$/;
      expect(GRAMMAR.exec(recall.scopeHeader(rc).line)?.[1], 'CONTROL: with no cut, the /clear transcript counts').toBe('2');
      expect(GRAMMAR.exec(recall.scopeHeader(rcN).line)?.[1], 'under N, the /clear transcript holds nothing visible').toBe('1');
      expect(recall.scopeJsonOf(rc).transcripts, 'CONTROL').toBe(2);
      expect(recall.scopeJsonOf(rcN)).toEqual({
        kind: 'family', id: ID, project: 'demo', families: [{ ccrc_id: ID, generation: G, first_seen_ms: rc.scope.families[0]!.firstSeenMs }],
        families_total: 1, transcripts: 1,
      });
      // One definition: cli.mjs's --json envelope prints recall.mjs's object, and builds none of its own.
      const read = (f: string): string => fs.readFileSync(path.join(REPO, 'ccd', 'history', f), 'utf8');
      const cliText = read('cli.mjs');
      expect(cliText).toContain('scope: scopeJsonOf(rc),');
      expect(cliText).not.toMatch(/^function scopeJson\(/m);
      expect(cliText).not.toContain('transcripts: rc.scope.transcriptPks.length');
      expect(cliText).not.toContain('families_total:');
      expect(read('recall.mjs')).not.toMatch(/^function jsonScope\(/m);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('W2-D37: a widened header counts and names only the families with a visible epoch', async () => {
    const recall = await rec();
    const a = await GRX.rc(box, ID);
    const b = await GRX.rc(box, OID);
    try {
      const proj: GrepRc = { ...a, scope: { ...a.scope, kind: 'project', id: ID, generation: null, project: 'demo',
        sessionPks: [...a.scope.sessionPks, ...b.scope.sessionPks],
        transcriptPks: [...a.scope.transcriptPks, ...b.scope.transcriptPks].sort((x, y) => x - y),
        families: [...a.scope.families, ...b.scope.families] } };
      const projN = withCut(proj, await cutAt(a, e(6)));
      expect(recall.scopeHeader(proj).line, 'CONTROL').toMatch(/^scope=project\(demo, 2 families\) coverage=this-box /);
      expect(recall.scopeHeader(projN).line).toMatch(/^scope=project\(demo, 1 families\) coverage=this-box /);
      expect(recall.scopeJsonOf(proj).families_total, 'CONTROL').toBe(2);
      const j = recall.scopeJsonOf(projN);
      expect([j.families_total, j.transcripts, j.families.map((f) => f.ccrc_id)]).toEqual([1, 1, [ID]]);
      expect(JSON.stringify(j), 'the hidden family is not named, nor is its generation').not.toMatch(new RegExp(`${OID}|${GO}`));
    } finally { a.db.close(); b.db.close(); }
  }, HEAVY);

  it('W2-D37 and R8 (SEC-1): a widened tree heads only the families with a visible epoch, so a family the cut hides prints no heading, id or generation', async () => {
    const recall = await rec();
    const a = await GRX.rc(box, ID);
    const b = await GRX.rc(box, OID);
    try {
      const proj: GrepRc = { ...a, scope: { ...a.scope, kind: 'project', id: ID, generation: null, project: 'demo',
        sessionPks: [...a.scope.sessionPks, ...b.scope.sessionPks],
        transcriptPks: [...a.scope.transcriptPks, ...b.scope.transcriptPks].sort((x, y) => x - y),
        families: [...a.scope.families, ...b.scope.families] } };
      const tree = (r: CutRc): GrepVerbResult => recall.runTree({ ...r, scopeArgs: [] }, { depth: 2, json: true });
      /** Each family heading's first three words: `family <id> generation=<g>`. */
      const heads = (r: GrepVerbResult): string[] => r.blocks.filter((l) => l.startsWith('family ')).map((l) => l.split(' ').slice(0, 3).join(' '));
      const open = tree(proj);
      expect(open.exit, JSON.stringify(open)).toBe(0);
      expect(heads(open), 'CONTROL: with no cut both families head the tree, each with its generation')
        .toEqual([`family ${ID} generation=${G}`, `family ${OID} generation=${GO}`]);
      const r = tree(withCut(proj, await cutAt(a, e(6))));
      expect(r.exit, JSON.stringify(r)).toBe(0);
      expect(heads(r), 'only the visible family heads the tree').toEqual([`family ${ID} generation=${G}`]);
      expect(JSON.stringify(r), 'the hidden family is not named anywhere in the answer, nor is its generation').not.toMatch(new RegExp(`${OID}|${GO}`));
    } finally { a.db.close(); b.db.close(); }
  }, HEAVY);

  it('W2-D37: the lag is read over visible transcripts only: a hidden transcript with no end-of-file mark leaves the cut header measured', async () => {
    const recall = await rec();
    const w = new RDatabaseSync(libRead.historyPaths(box.home).dbFile);
    const u2 = Number((w.prepare('SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?').get(U2) as { pk: number }).pk);
    const u1 = Number((w.prepare('SELECT transcript_pk AS pk FROM transcripts WHERE cc_session_uuid = ?').get(U1) as { pk: number }).pk);
    const LIVE = "FROM ingest_files WHERE source_key = '' AND status = 'live' AND transcript_pk = ?";
    const orig = (w.prepare(`SELECT eof_ms AS m ${LIVE}`).get(u2) as { m: number | null }).m;
    let rc: GrepRc | null = null;
    try {
      w.prepare(`UPDATE ingest_files SET eof_ms = NULL WHERE source_key = '' AND transcript_pk = ?`).run(u2);
      rc = await GRX.rc(box, ID);
      const rcN = withCut(rc, await cutAt(rc, e(6)));
      expect(recall.scopeHeader(rc).line, 'CONTROL: with no cut, the /clear transcript has no mark').toMatch(/ indexed-through=unmeasured lag=unmeasured$/);
      const eofMs = (w.prepare(`SELECT eof_ms AS m ${LIVE}`).all(u1) as Array<{ m: number | null }>).map((r) => r.m);
      expect(eofMs.length > 0 && eofMs.every((m) => typeof m === 'number'), 'CONTROL: the first transcript is read to its end').toBe(true);
      expect(recall.scopeHeader(rcN).line).toBe(libRead.headerLine({
        kind: 'family', id: ID, project: 'demo', families: 1, transcripts: 1,
        ...libRead.scopeLag({ eofMs: eofMs as number[], nowMs: rc.nowMs, recovering: false }),
      }));
    } finally {
      w.prepare(`UPDATE ingest_files SET eof_ms = ? WHERE source_key = '' AND transcript_pk = ?`).run(orig, u2);
      w.close();
      rc?.db.close();
    }
  }, HEAVY);

  it('W2-D38: the child spells no predicate of its own, the parent hands it lib asOfBinds through cutBinds, and the expand key suffix is spelled once, in lib', () => {
    const read = (f: string): string => fs.readFileSync(path.join(REPO, 'ccd', 'history', f), 'utf8');
    const worker = read('regex-worker.mjs');
    expect(worker).toMatch(/^import \{[^}]*\basOfEntrySql\b[^}]*\} from '\.\/lib\.mjs';$/m);
    for (const own of ['ts_ms', 'memberships', 'boundary_line', 'kept_blob_id']) expect(worker, own).not.toContain(own);
    expect(read('recall.mjs').split('cut: cutOf(rc) === null ? null : cutBinds(rc),').length - 1, 'the job line').toBe(1);
    for (const f of ['recall.mjs', 'regex-worker.mjs', 'cli.mjs']) expect(read(f), f).not.toContain(':asof:');
    expect(read('lib.mjs').split("':asof:'").length - 1).toBe(1);
  });
});
```

- [ ] **Step 3: Run the new tests and watch them fail as predicted.** One suite per tool call, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'expandCursorKey and expandResumeOf under an as-of cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D37 and W2-D38: the regex child')
```

Predicted, written before the run:
- history-lib: `5 failed`, each with `TypeError: l.expandCursorKey is not a function`.
- history-recall: `10 failed | 2 passed`.
  - **Green (2):**
    - the fixture case, which reads only the store and Task 2's store half;
    - the kept-row case. With no cut in the job, the base child matches both e5 and e4, and the parent's referrer join (Task 2) already keeps e5 and hides e4. This case guards the cut's transit to the child, and mutant R7 measures it red.
  - **Red (10):**
    - the parent-hands case: `expected false to be true`, because the job holds no `cut` key;
    - the child-applies case: the cut scan's labels are all eight, against `['kept', 'pre']`, because the job holds no cut and the child applies none;
    - the grep cursor case: `none then N` answers exit 0, because the key ignores the cut and so accepts the cursor;
    - the `--regex` cursor case: `N then none` answers exit 0, for the same reason;
    - the expand cursor case: `TypeError: L.expandCursorKey is not a function`;
    - the header case: `expected '2' to be '1'`;
    - the widened case: `project(demo, 2 families)` under N;
    - the widened tree case: its CONTROL passes, then `only the visible family heads the tree` holds both headings, the hidden family's with its generation: Task 3's epoch filter drops its epoch, never its heading;
    - the lag case: measured: the cut header counts two transcripts, `expected 'scope=family(claude-a-asof4, 2 transc…' to be 'scope=family(claude-a-asof4, 1 transc…'` (predicted: the cut header reads `indexed-through=unmeasured lag=unmeasured`; both hold on the unguarded code, and the transcript count differs first);
    - the scan case: the worker holds no `asOfEntrySql` import.

A different count means a prediction is wrong. Read the first failing line of each case before writing any code. When a CONTROL is what failed, correct the fixture, never the guard.

- [ ] **Step 4: lib: the expand cursor key.** In `ccd/history/lib.mjs`, insert directly above the line `/** What a decoded expand cursor names, for \`expand --cursor <c>\` given alone: its key is the target, or`:

```js
/** W2-D37: what joins an expand cursor's key to the as-of boundary it was minted under. No key expand prints holds it: a
 *  node id is a kind letter and hex, an entry key is a uuid or `x` and 32 hex, and an around key is
 *  `around:<uuid>:<before>:<after>`. */
const ASOF_KEY_SEP = ':asof:';

/** W2-D37: an expand cursor's key. With no cut (`asof` null), the expansion's own key, unchanged, so a cursor printed by an
 *  earlier build still resumes; under an as-of cut, that key, then `:asof:` and boundary N's uuid. A cursor minted under
 *  one cut, or under none, therefore never equals the key of a call under another, and decideExpandCursor refuses it. A
 *  uuid `asof` keeps the longest key at 91 characters, inside the cursor grammar's 128. */
export function expandCursorKey(key, asof) {
  return asof === null ? key : `${key}${ASOF_KEY_SEP}${asof}`;
}

```

Then replace `expandResumeOf`'s doc comment and body, from `/** What a decoded expand cursor names, for` through the function's closing `}`, with:

```js
/** What a decoded expand cursor names, for `expand --cursor <c>` given alone: its key is the target, or
 *  `around:<uuid>:<before>:<after>`, followed under an as-of cut by expandCursorKey's suffix, which names no target and
 *  is dropped here; the cut itself is checked against the call's own by decideExpandCursor (W2-D37). null when the key
 *  names nothing expand could resolve. */
export function expandResumeOf(cursor) {
  if (cursor === null || typeof cursor.t !== 'string') return null;
  const sep = cursor.t.indexOf(ASOF_KEY_SEP);
  const t = sep === -1 ? cursor.t : cursor.t.slice(0, sep);
  const m = /^around:([^:]+):([0-9]{1,2}):([0-9]{1,2})$/.exec(t);
  if (m !== null) {
    const before = Number(m[2]);
    const after = Number(m[3]);
    return before > AROUND_MAX || after > AROUND_MAX ? null : { target: null, around: m[1], before, after };
  }
  return expandTargetOf(t) === 'bad' ? null : { target: t, around: null, before: AROUND_DEFAULT, after: AROUND_DEFAULT };
}
```

In `ccd/history/lib.d.mts`, insert directly above `export function entryScopeVerdict(i: { found: boolean; inScope: boolean }): 'ok' | 'out-of-scope' | 'not-found';`:

```ts
export function expandCursorKey(key: string, asof: string | null): string;
```

- [ ] **Step 5: the regex child applies the cut.** In `ccd/history/regex-worker.mjs`:

(a) The header comment's last two lines, `// It reads no environment variable and trusts only its job. Every column it names exists at schema v1, and` and `// migrations are additive (§6.11), so it needs no version-aware select.`, become:

```js
// It reads no environment variable and trusts only its job. Every column it names exists at schema v1, and
// migrations are additive (§6.11), so it needs no version-aware select. Under an as-of cut (W2-D38), the job's `cut`
// holds the very values the parent binds for lib's one predicate (asOfBinds), and the child applies that predicate,
// asOfEntrySql, which names schema v1 columns only; a sidecar follows its entry (W2-D35). A job without the key is refused.
```

(b) `import { entryIndexText, makeBelt, makePairIndex } from './lib.mjs';` becomes:

```js
import { asOfEntrySql, entryIndexText, makeBelt, makePairIndex } from './lib.mjs';
```

(c) Replace `candidateSql` and its doc comment, from `/** The in-scope candidate blobs in blob_id order, ids only,` through the function's closing `}`, with:

```js
/** The in-scope candidate blobs in blob_id order, ids only, each with a stored body (z not pruned): those an in-scope
 *  entry of a listed provenance references (its first body or a variant), and those an in-scope sidecar holds when
 *  `tool` is listed. A prefilter is lib's regexPrefilter: the exact-token MATCH text of a whole-word literal the
 *  pattern must contain (never a prefix query); it narrows the candidates without changing the answer.
 *  Under an as-of cut (`withCut`, W2-D38), lib's one predicate keeps only the entries it leaves visible, in the entry
 *  branch and the variant branch alike, and a sidecar is a candidate only through a visible entry (W2-D35), so one with
 *  no entry is never one. With no cut, the text is the one every earlier build ran. */
function candidateSql(withPrefilter, withCut) {
  const visible = (alias) => (withCut ? ` AND (${asOfEntrySql(alias)})` : '');
  return `WITH cand(blob_id) AS (
      SELECT e.blob_id FROM entries e
        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))${visible('e')}
      UNION
      SELECT v.blob_id FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id
        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))${visible('e')}
      UNION
      SELECT s.blob_id FROM sidecars s${withCut ? ' JOIN entries se ON se.entry_id = s.entry_id' : ''}
        WHERE s.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND 'tool' IN (SELECT value FROM json_each(:provs))${visible('se')})
    SELECT c.blob_id AS blob_id, EXISTS (SELECT 1 FROM sidecars s2 WHERE s2.blob_id = c.blob_id) AS is_sidecar
      FROM cand c JOIN blobs b ON b.blob_id = c.blob_id
      WHERE b.z IS NOT NULL${withPrefilter ? '\n        AND c.blob_id IN (SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH :pre)' : ''}
      ORDER BY c.blob_id`;
}
```

(d) In `scanRegexJob`, the first line of its body, `  const re = new RegExp(job.pattern);`, becomes:

```js
  // W2-D38: `cut` is a required key. null is "no cut"; a job without the key is malformed, never read as uncut.
  if (!Object.hasOwn(job, 'cut')) throw new Error('the job names no cut');
  const cut = job.cut;
  const re = new RegExp(job.pattern);
```

`    const stmt = db.prepare(candidateSql(job.prefilter !== null));` becomes `    const stmt = db.prepare(candidateSql(job.prefilter !== null, cut !== null));`, and the line `      ...(job.prefilter === null ? {} : { pre: job.prefilter }),` gains one line after it:

```js
      ...(cut === null ? {} : cut),
```

`main` is unchanged: its fixed words for a job that is not JSON, and the entry guard.

- [ ] **Step 6: recall.mjs and cli.mjs: the key, the job and the visible header.** In `ccd/history/recall.mjs`:

(a) Insert directly above `const HEADERS = new WeakMap();`:

```js
const VISIBLE = new WeakMap();
/** W2-D37, with W2-D35's epoch rule: the scope's families and transcripts as the header and the --json scope count and
 *  name them. With no cut, the scope's own lists. Under an as-of cut (rc.scope.cut, W2-D38), a transcript counts iff it
 *  holds an entry lib's one predicate leaves visible, and a family iff one of its confirmed epochs is visible by lib's
 *  epoch statement (cutVisibleEpochs), so a transcript, an epoch or a family that holds only what the cut hides is never
 *  counted, never named and never read for the lag. rc.scope itself is not narrowed (R5): each read site applies the cut
 *  in its own SQL. Once per context. */
export function visibleScope(rc) {
  if (cutOf(rc) === null) return { families: rc.scope.families, transcriptPks: rc.scope.transcriptPks };
  const known = VISIBLE.get(rc);
  if (known !== undefined) return known;
  const tsql = `SELECT DISTINCT e.transcript_pk AS pk FROM entries e
    WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks))${cutAnd(rc, 'e')}`;
  const transcriptPks = rc.db.prepare(tsql).all(bindFor(tsql, { tpks: JSON.stringify(rc.scope.transcriptPks), ...cutBinds(rc) }))
    .map((r) => Number(r.pk)).sort((a, b) => a - b);
  const epochs = rc.db.prepare(`SELECT session_pk AS pk, cc_session_uuid AS u FROM epochs
    WHERE confirmed_ms IS NOT NULL AND session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rc.scope.families.map((f) => f.sessionPk)));
  const shown = cutVisibleEpochs(rc, epochs.map((r) => r.u));
  const held = new Set(epochs.filter((r) => shown.has(r.u)).map((r) => Number(r.pk)));
  const out = Object.freeze({ families: rc.scope.families.filter((f) => held.has(f.sessionPk)), transcriptPks });
  VISIBLE.set(rc, out);
  return out;
}

```

(b) In `scopeHeader`:
- its doc comment's last sentence, `Computed once per context. */`, becomes `Its counts and its lag read only what the as-of cut leaves visible (visibleScope; W2-D37). Computed once per context. */`;
- `  const lag = scopeLag({ eofMs: eofOf(rc.db, rc.scope.transcriptPks), nowMs: rc.nowMs, recovering });` becomes the two lines:

```js
  const vis = visibleScope(rc);
  const lag = scopeLag({ eofMs: eofOf(rc.db, vis.transcriptPks), nowMs: rc.nowMs, recovering });
```

- `    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project, families: rc.scope.families.length,` becomes `    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project, families: vis.families.length,`;
- `    transcripts: rc.scope.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,` becomes `    transcripts: vis.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,`.

(c) Replace `/** The JSON scope mirrors cli.mjs's scopeJson exactly, including its cap-fitting family prefix. */` and `function jsonScope(rc) {` through its closing `}` with:

```js
/** The --json scope object (§8.3), defined once: cli.mjs's envelope prints it and tree's cap fitting measures it. A widened
 *  scope names only a bounded prefix, and `families_total` is complete. Under an as-of cut both name and count only what
 *  is visible (visibleScope; W2-D37). */
export function scopeJsonOf(rc) {
  const vis = visibleScope(rc);
  return {
    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project,
    families: vis.families.slice(0, SCOPE_FAMILIES_JSON_MAX)
      .map((f) => ({ ccrc_id: f.ccrcId, generation: f.generation, first_seen_ms: f.firstSeenMs })),
    families_total: vis.families.length,
    transcripts: vis.transcriptPks.length,
  };
}
```

and in `renderJson`, `scope: jsonScope(rc),` becomes `scope: scopeJsonOf(rc),`.

(d) Insert directly above `/** The hint a refused cursor carries. */`:

```js
/** W2-D37: the as-of boundary this call reads under, rc.scope.cut's `asof` (W2-D38), or null when no cut is set. */
function asOfOf(rc) {
  const cut = cutOf(rc);
  return cut === null ? null : cut.asof;
}

```

(e) Replace `grepKey` and its doc comment, from `/** What a grep cursor is bound to:` through the function's closing `}`, with:

```js
/** What a grep cursor is bound to: the query, the scope, every filter and, only under an as-of cut, its boundary
 *  (W2-D37). A cursor from another query, scope or cut, or from none, is refused, never applied to the wrong list. With no
 *  cut the key is the one every earlier build printed. */
function grepKey(rc, a) {
  const asof = asOfOf(rc);
  return sha256Hex(canonicalJson({
    words: a.regex === null ? sanitizeFtsQuery(a.words.join(' ')) : null, regex: a.regex,
    scope: [rc.scope.kind, rc.scope.id, rc.scope.generation],
    role: a.role, tool: a.tool, since: a.sinceMs, before: a.beforeMs, node: a.node, sort: a.sort, recall: a.includeRecall,
    ...(asof === null ? {} : { asof }),
  })).slice(0, 20);
}
```

(f) In `runRegex`'s job, insert after `    pattern: guard.source,`:

```js
    // W2-D38: the cut, as the very values the parent binds for lib's one predicate (cutBinds, lib's asOfBinds), so the
    //  child applies that predicate itself; null with no cut. The key is always present: the child refuses a job without it.
    cut: cutOf(rc) === null ? null : cutBinds(rc),
```

(g) In `runExpand`, `  const at = xlib.decideExpandCursor({ cursor: decoded, key: r.key, total: items.length });` becomes:

```js
  // W2-D37: the key a cursor is checked against, and minted with, names the as-of cut, only when one is set.
  const ckey = xlib.expandCursorKey(r.key, asOfOf(rc));
  const at = xlib.decideExpandCursor({ cursor: decoded, key: ckey, total: items.length });
```

and `t: r.key, i: next.i` becomes `t: ckey, i: next.i`.

(h) In `runTree`, the family loop's head (R8, SEC-1): the loop whose first statement pushes the `family …` heading, above Task 3's `    const listed = epochs.all(f.sessionPk);`. Replace

```js
  for (const f of rc.scope.families) {
```

with

```js
  // R8: a family heading names only a family the as-of cut leaves visible (visibleScope, W2-D35's epoch rule), so a family
  // with no visible epoch is never named by tree, nor its generation. With no cut, the scope's own families.
  for (const f of visibleScope(rc).families) {
```

`scopeHeader(rc)` at the top of `runTree` has already asked `visibleScope` for this context, so the loop reads the cached answer and prepares nothing more. The `family` map above it, which names a node item's family, is not edited (Choices).

In `ccd/history/cli.mjs`:
- `import { runTree, grepVerb, describeVerb, expandVerb, familiesOf, transcriptsOf, scopeHeader } from './recall.mjs';` becomes `import { runTree, grepVerb, describeVerb, expandVerb, familiesOf, transcriptsOf, scopeHeader, scopeJsonOf } from './recall.mjs';`;
- delete `/** The --json scope object (§8.3). A widened scope names only a bounded prefix; \`families_total\` is complete. */` and `function scopeJson(rc) {` through its closing `}`, and the blank line after it;
- in `emitResult`, `scope: scopeJson(rc),` becomes `scope: scopeJsonOf(rc),`;
- if Step 1 counted 2 for `SCOPE_FAMILIES_JSON_MAX`, `  decideRecallOff, parseSpoolLine, SCOPE_FAMILIES_JSON_MAX,` becomes `  decideRecallOff, parseSpoolLine,`. Then `grep -c 'SCOPE_FAMILIES_JSON_MAX' ccd/history/cli.mjs` prints `0`.

Every edit sits above cli.mjs's entry guard and adds no top-level statement with an effect.

- [ ] **Step 7: Run the new tests green.** One suite per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'expandCursorKey and expandResumeOf under an as-of cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D37 and W2-D38: the regex child')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `5 passed` and `12 passed`.
- tsc names no file this task touched. A line that names only `agent/src/` (the `ws` module) or `test/workflow-yaml-parses.test.ts` (the `yaml` module) comes from the worktree's install.

If the history-recall describe reds with `Unknown named parameter`, then `asOfBinds` answers a key `asOfEntrySql` does not use, and that breaks the consumed contract. Report it to the coordinator. Never filter the binds in the child to make it green: the child binds exactly what the parent binds.

- [ ] **Step 8: Measure every new guard red, then green.** From the repository root. Each mutant runs in its own tool call, through helpers written once to `.superpowers/sdd/history-w2-2a/t4/mut.sh`: it applies one exact replacement (or two), asserted to match once, runs its filter and shows red, then restores every file the task edits and checks each with `cmp`. The helpers also restore on exit, a signal included, so a call killed by its timeout never leaves a mutant in the tree. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

First write the helpers, once, after Step 7's green run. They copy the files as they stand then, so a file changed on purpose after this point needs this block run again before any later mutant:

```bash
mkdir -p .superpowers/sdd/history-w2-2a/t4
cat > .superpowers/sdd/history-w2-2a/t4/mut.sh <<'SH'
SCRATCH=.superpowers/sdd/history-w2-2a/t4
FILES="ccd/history/lib.mjs ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs"
# mut <file> <old> <new>: one exact replacement, refused unless <old> occurs exactly once.
mut() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
c = s.count(old)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(s.replace(old, new))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
LIB_T='expandCursorKey and expandResumeOf under an as-of cut'
REC_T='W2-D37 and W2-D38: the regex child'
SH
for f in ccd/history/lib.mjs ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs; do cp "$f" ".superpowers/sdd/history-w2-2a/t4/$(basename "$f").orig"; done
```

Then each mutant, ONE tool call each, in the foreground with a timeout of at least 600000 ms. Never split one mutant across calls: the helpers restore every file when a call exits. If a call's runs would pass 600000 ms on a loaded box, join its filters for the same file into one `-t` regex (`'a|b'`) and read each case's line from that one run. A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# L1: the expand key always carries the suffix, so a key with no cut is no longer the target.
mut ccd/history/lib.mjs '  return asof === null ? key : `${key}${ASOF_KEY_SEP}${asof}`;' '  return `${key}${ASOF_KEY_SEP}${asof}`;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): lib, 1 failed | 4 passed: 'with no cut, the key is ... unchanged' (k:asof:null against k;
# the other cases build both sides with the same function, so they agree); recall, 'no cut: the key every earlier build
# printed', expected '<e3>:asof:null' to be e3.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# L2: the expand key ignores the cut.
mut ccd/history/lib.mjs '  return asof === null ? key : `${key}${ASOF_KEY_SEP}${asof}`;' '  return key;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): lib, 3 failed | 2 passed: 'names its boundary' (the key is k), 'refuses ... in both
# directions' ({ ok: true }) and the longest key (length 49, not 91); recall, 1 failed, first at the stale loop's
# 'none then N, with its target': [0, …] against [2, 'bad-args', STALE_EXPAND, []]. The decoded-cursor line above it
# stays green: it compares the mutated expandCursorKey with itself (that line is R4's red, never L2's).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# L3: a key minted under a cut no longer resumes when given alone.
mut ccd/history/lib.mjs '  const t = sep === -1 ? cursor.t : cursor.t.slice(0, sep);' '  const t = cursor.t;'
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'a key minted under a cut resumes its own target')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): lib, null against the plain resume; recall, 'CONTROL N then N, alone': exit 2 bad-args (the
# expand target hint), not 0.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# L4: a separator that occurs inside a key expand prints.
mut ccd/history/lib.mjs "const ASOF_KEY_SEP = ':asof:';" "const ASOF_KEY_SEP = ':';"
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): 3 failed | 2 passed: 'names its boundary' (k:N, not k:asof:N); the resume case at its
# CONTROL, because the plain around key itself is cut at its first ':' to 'around', which names nothing (null); the
# longest key (length 86, not 91). The scan case, 1 failed: lib.mjs holds no ':asof:' (0, not 1).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R1: grep's key ignores the cut.
mut ccd/history/recall.mjs '    ...(asof === null ? {} : { asof }),
  })).slice(0, 20);' '  })).slice(0, 20);'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a grep cursor is bound to its cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a --regex cursor is bound to its cut')
restore
# Expected RED (predicted): 'none then N' answers exit 0 with a page, not the stale refusal; the regex case's
# 'N then none' answers exit 0.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R2: grep's key carries asof when no cut is set, so every earlier cursor goes stale.
mut ccd/history/recall.mjs '    ...(asof === null ? {} : { asof }),' '    asof,'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a grep cursor is bound to its cut')
restore
# Expected RED (predicted): the uncut key pin, two different 20-hex strings (the mutant's object holds "asof":null).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R3: expand checks a cursor against the bare key.
mut ccd/history/recall.mjs 'key: ckey, total: items.length' 'key: r.key, total: items.length'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): 'CONTROL N then N, with its target': exit 2, not 0 (the minted key holds the suffix, the
# checked one does not).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R4: expand mints a cursor with the bare key.
mut ccd/history/recall.mjs 't: ckey, i: next.i' 't: r.key, i: next.i'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): the decoded N cursor's t is e3, not e3:asof:e6.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R5: the job leaves the key out.
mut ccd/history/recall.mjs '    cut: cutOf(rc) === null ? null : cutBinds(rc),
' ''
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the parent hands the regex child the cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): the uncut CONTROL is [1, []], not [0, [e8]]: the child refuses the job ('the job names no
# cut'), so runRegex answers exit 1, childFailed. It fails closed. The scan case: the job line is counted 0 times, not 1.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R6: the job never carries the cut.
mut ccd/history/recall.mjs 'cut: cutOf(rc) === null ? null : cutBinds(rc),' 'cut: null,'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the parent hands the regex child the cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): the job's cut is null, not asOfBinds' values; the cut scan's labels are all eight; the scan
# case, the job line counted 0 times, not 1.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R7: the parent hands the child a cut with no kept members.
mut ccd/history/recall.mjs 'cut: cutOf(rc) === null ? null : cutBinds(rc),' "cut: cutOf(rc) === null ? null : { ...cutBinds(rc), asof_kept: '[]' },"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a kept row reaches the child with the cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): kept(N) answers [3, []], not [0, [e5]]; the cut scan's labels are ['pre']; the scan case, the
# job line counted 0 times, not 1.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R8: the header counts every transcript.
mut ccd/history/recall.mjs '    transcripts: vis.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,' '    transcripts: rc.scope.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): expected '2' to be '1'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R9: the header counts every family.
mut ccd/history/recall.mjs 'project: rc.scope.project, families: vis.families.length,' 'project: rc.scope.project, families: rc.scope.families.length,'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
# Expected RED (predicted): 'scope=project(demo, 2 families)' under N.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R10: the lag reads every transcript.
mut ccd/history/recall.mjs 'eofMs: eofOf(rc.db, vis.transcriptPks)' 'eofMs: eofOf(rc.db, rc.scope.transcriptPks)'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the lag is read over visible transcripts only')
restore
# Expected RED (predicted): the cut header reads 'indexed-through=unmeasured lag=unmeasured'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R11: the --json scope names every family, then counts every family.
mut ccd/history/recall.mjs '    families: vis.families.slice(0, SCOPE_FAMILIES_JSON_MAX)' '    families: rc.scope.families.slice(0, SCOPE_FAMILIES_JSON_MAX)'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
mut ccd/history/recall.mjs '    families_total: vis.families.length,' '    families_total: rc.scope.families.length,'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
# Expected RED (predicted): first, the names are [ID, OID], not [ID]; then families_total is 2, not 1.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R12: the --json scope counts every transcript.
mut ccd/history/recall.mjs '    transcripts: vis.transcriptPks.length,
  };' '    transcripts: rc.scope.transcriptPks.length,
  };'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): scopeJsonOf under N has transcripts 2, not 1.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R13: visibleScope keeps every family.
mut ccd/history/recall.mjs '  const out = Object.freeze({ families: rc.scope.families.filter((f) => held.has(f.sessionPk)), transcriptPks });' '  const out = Object.freeze({ families: rc.scope.families, transcriptPks });'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
# Expected RED (predicted): 'project(demo, 2 families)' under N.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R14: visibleScope's transcripts uncut (bindFor drops the binds the statement no longer names).
mut ccd/history/recall.mjs "    WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks))\${cutAnd(rc, 'e')}\`;" '    WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks))`;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
# Expected RED (predicted): '2' against '1'; the widened case's --json transcripts 3, not 1 (its family count stays 1,
# because families are decided by the epoch statement).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R15: visibleScope's families by every confirmed epoch, the epoch statement not asked.
mut ccd/history/recall.mjs '  const held = new Set(epochs.filter((r) => shown.has(r.u)).map((r) => Number(r.pk)));' '  const held = new Set(epochs.map((r) => Number(r.pk)));'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened header counts and names only')
restore
# Expected RED (predicted): 'scope=project(demo, 2 families)' under N.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# C1: cli.mjs builds its own scope count again, beside the shared object (which it still prints, so the case's
# 'scope: scopeJsonOf(rc),' line stays green and the red lands on the hand-kept count).
mut ccd/history/cli.mjs 'scope: scopeJsonOf(rc),' 'scope: scopeJsonOf(rc), scopeCount: { transcripts: rc.scope.transcriptPks.length },'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): 1 failed, at not.toContain: cli.mjs contains 'transcripts: rc.scope.transcriptPks.length'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# W1: THE CHILD IGNORES THE CUT. With Task 2's referrer cut in place, the CLI's answers stay right (the parent re-filters),
# so the case that must red is the child's own door.
mut ccd/history/regex-worker.mjs '  const cut = job.cut;' '  const cut = null;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the parent hands the regex child the cut')
restore
# Expected RED (predicted): the cut scan's labels are ['kept', 'null', 'orphan', 'post', 'pre', 'side', 'step', 'stepvar'], not
# ['kept', 'pre'], and scanned is not less. The parent-hands case stays GREEN (predicted): the parent's referrer join
# hides e8. That is why the child's door is pinned in-process.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# W2: the sidecar branch joins its entry but applies no predicate to it.
mut ccd/history/regex-worker.mjs "'tool' IN (SELECT value FROM json_each(:provs))\${visible('se')})" "'tool' IN (SELECT value FROM json_each(:provs)))"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
restore
# Expected RED (predicted): ['kept', 'pre', 'side']: the sidecar of hidden e11 is scanned; the join still keeps the
# sidecar with no entry out.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# W3: the child adds a stamp clause of its own.
mut ccd/history/regex-worker.mjs "  const visible = (alias) => (withCut ? \` AND (\${asOfEntrySql(alias)})\` : '');" "  const visible = (alias) => (withCut ? \` AND (\${asOfEntrySql(alias)}) AND \${alias}.ts_ms IS NOT NULL\` : '');"
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): ['pre'] (kept e5 has no stamp, so the child's own clause drops it); the scan finds 'ts_ms'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# W4: a job with no cut key is read as uncut.
mut ccd/history/regex-worker.mjs "  if (!Object.hasOwn(job, 'cut')) throw new Error('the job names no cut');
" ''
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
restore
# Expected RED (predicted): 'a job with no cut key is malformed'. An undefined cut takes the cut's SQL with none of its
# binds, so the call either throws a node:sqlite error that is not 'the job names no cut', or reads the unbound
# parameters as NULL and returns without throwing. Either way the toThrow assertion is red.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R16: recall.mjs spells the expand key's suffix itself (behaviour unchanged; only the scan sees it).
mut ccd/history/recall.mjs '  const ckey = xlib.expandCursorKey(r.key, asOfOf(rc));' '  const ckey = asOfOf(rc) === null ? r.key : `${r.key}:asof:${asOfOf(rc)}`;'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child spells no predicate of its own')
restore
# Expected RED (predicted): 1 failed: recall.mjs contains ':asof:'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R17: recall.mjs keeps a second scope builder beside scopeJsonOf.
mut ccd/history/recall.mjs 'const VISIBLE = new WeakMap();' $'function jsonScope(rc) { return scopeJsonOf(rc); }\nconst VISIBLE = new WeakMap();'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): 1 failed, at its last line: recall.mjs matches /^function jsonScope\(/m.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R18: expand checks a cursor's key before it resolves the cursor's target under the call's own cut.
mut ccd/history/recall.mjs $'  if (r.refuse !== undefined) return r.refuse;\n  const items = expandItems(s, r.entryIds);' $'  if (decoded !== null && decoded.t !== xlib.expandCursorKey(r.key ?? \'\', asOfOf(rc))) return refusal(\'bad-args\', \'that --cursor belongs to another expansion\');\n  if (r.refuse !== undefined) return r.refuse;\n  const items = expandItems(s, r.entryIds);'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'an expand cursor is bound to its cut')
restore
# Expected RED (predicted): 1 failed, at 'N+1 then N, alone, on a target N hides': [2, 'bad-args'] against [3, undefined].
# Every earlier line stays green: a target the call's cut shows resolves first either way.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# C2: cli.mjs counts the families itself again, beside the shared object.
mut ccd/history/cli.mjs 'scope: scopeJsonOf(rc),' 'scope: scopeJsonOf(rc), scopeCount: { families_total: rc.scope.families.length },'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): 1 failed, at not.toContain: cli.mjs contains 'families_total:'.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# C3: cli.mjs keeps its own scopeJson beside the import.
mut ccd/history/cli.mjs "/** A verb's result." $'function scopeJson(rc) { return scopeJsonOf(rc); }\n/** A verb\'s result.'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the header and the --json scope count only')
restore
# Expected RED (predicted): 1 failed: cli.mjs matches /^function scopeJson\(/m.
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# W5: the variant branch uncut in the child (R5's residual, now pinned).
mut ccd/history/regex-worker.mjs $'      SELECT v.blob_id FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id\n        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))${visible(\'e\')}' $'      SELECT v.blob_id FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id\n        WHERE e.transcript_pk IN (SELECT value FROM json_each(:tpks)) AND e.provenance IN (SELECT value FROM json_each(:provs))'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'the child applies the lib predicate itself')
restore
# Expected RED (predicted): ['kept', 'pre', 'step', 'stepvar']: both of hidden e9's bodies are scanned through the
# variant branch, its first body included, because the first body also gets a variant row once a second appears (§6.2).
```

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
# R19: tree heads every family of the scope again (ruling R8's SEC-1: rc.scope.families restored).
mut ccd/history/recall.mjs '  for (const f of visibleScope(rc).families) {' '  for (const f of rc.scope.families) {'
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'a widened tree heads only the families')
restore
# Expected RED (predicted): 1 failed, at 'only the visible family heads the tree': both headings, ID's and OID's with
# generation GO, against ID's alone. Its CONTROL stays green: with no cut both lists are the scope's.
```

After the last mutant, one more call:

```bash
. .superpowers/sdd/history-w2-2a/t4/mut.sh
for f in ccd/history/lib.mjs ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t4/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t "$LIB_T")
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t "$REC_T")
```

Expected:
- every mutant red as stated, including W1's stated green, and no call printing `NOT RESTORED`;
- the last call's loop printing nothing: the four files restored;
- the two describes green again: `5 passed` and `12 passed`.

If a mutant stays green where red is predicted, its guard does not hold. Report it, and never weaken the mutant to make it red. Record each red's first failing line in the scratch notes.

- [ ] **Step 9: Run the neighbours that read these files, C59 and C69 by name first.** In the foreground, with a timeout of at least 600000 ms, ONE tool call per line. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C59: redaction before every cut')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C69: the substring belt on every verb')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'grep --regex: refused unspawned')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'task 14 fix round 1')
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'expand \(Task 16\): pages, cursors')
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected green:
- **C59** (cursor page boundaries in expand, with no cut) and **C69** (the child receives the CLI's units on stdin; a malformed job is named in fixed words) are green, each with its base count. With no cut, the job's added key is `null`, the child's SQL is the base's, and both cursor keys are the base's.
- Task 14's two describes and Task 16's paging describe are green: the stale-cursor answers, the spawn seams and the child-output guards are unchanged.
- `history-lib`: the base count plus 5. `history-recall`: the base count plus 12.
- `history-cli` and `history-maint`: exactly their base counts. cli.mjs's `--json` envelope now prints `scopeJsonOf`, the same object with no cut, so the existing scope assertions are the identity check.
- `single-definition -t 'ccrc history'`: unchanged and green. `expandCursorKey` is declared once in `lib.d.mts`, and no list changes.
- `citations`: green. No added numeric line citation.
- tsc: as in Step 7.

Then the ledger check. This task defines no D-number and cites none of its own:

```bash
grep -rn 'D-TBD-[a-z0-9]' ccd/history server/test/history-lib.test.ts server/test/history-recall.test.ts || echo 'no D-TBD token'
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: `no D-TBD token`, then green.

- [ ] **Step 10: Commit.**

```bash
for f in ccd/history/lib.mjs ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs; do cmp -s ".superpowers/sdd/history-w2-2a/t4/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs \
  server/test/history-lib.test.ts server/test/history-recall.test.ts
git status --short
git commit -m "feat(history): the as-of cut reaches the regex child, the grep and expand cursors and the header (W2-2a Task 4; W2-D37, W2-D38)"
```

The loop prints nothing: no mutant is left in a file the commit takes (a `NOT RESTORED` line stops the commit; report it). `git status --short` must list exactly these seven files. Nothing under `.superpowers/` appears: it is gitignored.

---
### Task 5: the read verbs refuse the seam variables inside a pane, and the env allow-list grows to seven (W2-D39's CLI half)

W2-D39 gives W2-2a the CLI half of the headless seam: the half that refuses. Spec §8.2 says: "They are honoured only when `TMUX_PANE` is unset", and "Inside a pane: exit 2 `headless-in-pane`." W2-2a is the first PR whose shipped code reads `CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM` and `CCRC_RECALL_ASOF`, so this task also grows the `process.env` allow-list from four names to seven (spec §10.1 Seams). Three changes:
- lib.mjs decides. `recallSeamEngaged(recall)` is W2-D45's rule, spelled once: the seam is engaged iff at least one of its three values is non-empty. `decideSeamInPane({ pane, recall })` answers exit 2 `headless-in-pane` when `TMUX_PANE` is defined (so `''` and a malformed value count as a pane) and the seam is engaged. In every other case it answers `{ ok: true }`.
- cli.mjs measures. `readContextIn` reads the three variables by name, once each. It then runs the decision after §8.3's Darwin and role rows and **before** `decideIdentity`'s `tmuxSession` spawn.
- single-definition.test.ts: the existing allow-list describe gains the three names in place, and its title drops "four-name". A new describe, appended at the end of the file, holds the three names to their exact holders: one dotted read each, in cli.mjs alone.

**What W2-2a does with the `CCRC_RECALL_*` values (section 3 E, W2-D46).** It reads only whether each one is empty. Nothing else:
- the CLI never validates a value. The ASOF grammar and the pre-store `asof-invalid`, `RECALL_ARMS` and `headless-arm-unknown`, and `idOk` on SESSION are all W2-2b's (W2-D42, W2-D46 step 1);
- SESSION never becomes an identity (W2-D40 is W2-2b's), and ARM never answers exit 8 (W2-D42);
- ASOF never reaches `asOfCutOf` and never sets `rc.scope.cut`. This plan's cut is reached in process, through `rc.scope.cut` (R3). W2-D46 step 7, "the cut", is W2-2b's, and so is the env path that would set the cut from ASOF;
- no counter line carries `arm` (W2-D43 is W2-2b's).

So `asof-invalid`, whose word and store half Tasks 1 and 2 ship (W2-D39's last bullet), has **no CLI producer** in W2-2a. Outside a pane the three variables change nothing: with no pane the read verbs still answer exit 2 `no-identity` (C4's no-pane half), and a Darwin or server-role box still answers 9 first. `status`, `doctor` and the operator verbs never read the three names. W2-D47, which says they ignore the seam, is W2-2b's to pin. W2-2a gives them nothing to ignore.

**No new word, no D-number.** `headless-in-pane` is already an exit-2 word in `REASON_ROWS` (lib.mjs, W1-B2), and the spec already names it (§8.2's headless bullet and §8.3's exit-2 row). This task produces it and adds no second copy. `decideSeamInPane` calls `refuseScope('headless-in-pane')` the way `decideIdentity` calls `refuseScope('no-identity')`. C16 is unchanged: `REFUSALS` stays derived, and its exit-2 set does not move. This task defines no departure. W2-D39's `D-5765` belongs to the `asof-invalid` spelling, which Task 1 ships, and section 3 marks the in-pane half "no". The task cites D-4247 bare, in the comment it edits in place, plus D-5893 (the citations ratchet) and D-6178 (the armed growth check), the two whole-PR checks it runs.

**Order.** The task runs fifth and needs nothing from Tasks 1 to 4. It touches none of their regions: the cut, the cursors, the regex child, `asof-invalid`'s row, and cli.mjs's `scopeJson` (Task 4 deleted it; this task edits the read verbs' lib import line and `readContextIn` only). Line numbers below were measured at `cd622b2f6` and are hints only. Step 1 asserts that each anchor occurs exactly once. If one of Tasks 1 to 4 moved a line, re-anchor it by its quoted content.

**Files:**
- Modify: `ccd/history/lib.mjs`. Insert `recallSeamEngaged` and `decideSeamInPane`, with their doc comments, directly above the doc comment that begins `/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The` (`decideIdentity`'s, about :4222 at `cd622b2f6`). Both use the module-private `refuseScope` (about :4218), which is already above them. No import changes, and lib stays `node:crypto`-only.
- Modify: `ccd/history/lib.d.mts`. Add one interface and two declarations directly after `decideIdentity`'s two-line declaration, whose second line is `  { ok: true; id: string } | ScopeRefusal<'no-identity' | 'bad-id'>;` (about :520).
- Modify: `ccd/history/cli.mjs`:
  - the read verbs' lib import line `  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, paneOk,` (about :59) gains `decideSeamInPane, ` at its front, in place, on the same line;
  - the dispatcher block's order comment gains one line, `//     2a. …`, directly after `//        pane;` (about :456), which ends step 2's two lines;
  - in `readContextIn`, between `  const pane = process.env.TMUX_PANE ?? null;` (about :690) and `  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });` (about :691): a two-line comment, the three reads inside one `decideSeamInPane` call, and the refusal (12 lines).
- Test: `server/test/history-cli.test.ts`. Append two describes at the end of the file (about :1445 at `cd622b2f6`, or wherever Tasks 1 to 4 left it):
  - a pure one with 3 cases, which runs on darwin too;
  - a spawning one with 3 cases, skipped on darwin like every spawning describe in this file.

  No import line is added. The spawning cases reach `runCli`, `withPane` and `seedFamily` through the file's existing `healthHh` namespace import (W2-1's recall-off describe is the precedent), and `historyFixtures.js` through a dynamic `import()` inside the seeding helper.
- Test: `server/test/single-definition.test.ts`:
  - In place, with the line count unchanged (4 lines, about :5464-5467): the allow-list describe's title, its two comment lines and its `ALLOWED` line.
  - One describe appended after the file's last line, with 2 cases. It adds no import line, for the reason the file's CCRC HISTORY block states: `session-hook.test.ts`' citation audit cites this file by line.
- Not edited: the spec, `README.md`, `ccd/history-skill/SKILL.md` (its exit-2 row is generic), `deploy/**`, `shared/**`, `lifecycle.test.ts`, `derive.mjs`, `sweep.mjs`, `store.mjs`, `recall.mjs`, `regex-worker.mjs`, `ccd/session-hook.sh`, `.github/**`, and `history-recall.test.ts`. C4's no-pane half lives in that file (W1-B2 Task 10) and is re-run unedited in Step 9.

**Interfaces:**
- Consumes (at the base, unchanged):
  - `lib.mjs`:
    - module-private `refuseScope(reason): { ok: false, rc: 2, reason }`;
    - `EXIT.REFUSED` (2), and `REASONS['headless-in-pane'] === 2`, already in `REASON_ROWS`' exit-2 row;
    - `decideIdentity({ pane, tmux })` and `paneOk(pane)`, unchanged.
  - `cli.mjs`:
    - module-private `refusal(exit, reason, storeId, id, gen)`;
    - `tmuxSession(pane)`, exported, and called on the read path only from `readContextIn`;
    - module-private `emitRefusal`. Its `--json` envelope for a refusal is `{ v, exit, reason, store_id: null, coverage, scope: null, indexed_through_ms: null, lag_s: null, items: [], shown: 0, total: 0, next: null }`, and its human form is `exit 2 headless-in-pane: …`;
    - module-private `readVerb`'s counter: it writes no spool line while `id` is null, so a refusal before the identity is never counted.
  - Tests:
    - `historyHelpers.ts`: `makeHistoryBox`, `runSweep`, and through `healthHh`: `runCli`, `withPane` (a tmux stub that appends its argv to `$HOME/tmux-calls` and answers `cc-<id>` for `TMUX_PANE=%1`) and `seedFamily`. `scrubbedEnv` removes every `CCRC_RECALL_*` from `box.env`.
    - `historyFixtures.ts`: `userRow` and `assistantRow`.
    - `history-cli.test.ts`' file-level `ID`, `G1`, `hist`, `boundBox` and the `HistoryBox` type.
    - `single-definition.test.ts`' file-level `HISTORY_MJS`, `stallCode`, `stallCodeText` and `rel`.
- Produces:
  - `lib.mjs`:
    - `export function recallSeamEngaged({ session, arm, asof }): boolean`. It answers true iff at least one of the three is a non-empty string (W2-D45: empty is unset). It checks no value's grammar.
    - `export function decideSeamInPane({ pane, recall }): { ok: true } | { ok: false, rc: 2, reason: 'headless-in-pane' }`. It refuses iff `typeof pane === 'string'` (a defined `TMUX_PANE`, `''` included) **and** `recallSeamEngaged(recall)`.
  - `lib.d.mts`:
    - `export interface RecallSeamValues { session: string | null; arm: string | null; asof: string | null }`;
    - `export function recallSeamEngaged(recall: RecallSeamValues): boolean;`
    - `export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<'headless-in-pane'>;` Each is declared once.
  - `cli.mjs`: `readContextIn` reads `process.env.CCRC_RECALL_SESSION`, `process.env.CCRC_RECALL_ARM` and `process.env.CCRC_RECALL_ASOF`, each once, dotted, `?? null`. It answers `refusal(2, 'headless-in-pane', null, null, null)` before `decideIdentity` and before any `tmuxSession` spawn. No export changes.
  - `single-definition.test.ts`: `ALLOWED` holds the seven names `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF`, `CCRC_RECALL_SESSION`, `CCRC_SESSION_GENERATION`, `CLAUDECODE`, `HOME` and `TMUX_PANE`. The describe's title becomes exactly `ccrc history: process.env is read by name, from an allow-list (spec 2026-10-05 §10.1 Seams)`.

**Choices this task makes:**
- **The decision is lib's, the reads are cli.mjs's.** cli.mjs is L4: it "decides nothing itself" (its header). `decideIdentity` cannot hold the rule, because its `tmux` argument is measured by the spawn this rule must precede. So the rule is a new L1 function that runs before that measurement. It is named for its one row, not `decideHeadless`, because `decideHeadless`, with the marker, the ARM and ASOF rows and the rest of W2-D46's order, is W2-2b's (W2-D45, W2-D46). W2-2b's `decideHeadless` calls these two, or folds them and deletes them in its own PR (R3).
- **The three names, by name, and no prefix scan.** W2-D39 and W2-D45 say "any non-empty `CCRC_RECALL_*`". Spec §8.2 names exactly three seam variables, and §10.1's allow-list forbids reading any name that is not on it. `Object.keys(process.env)` or a computed `process.env[k]` reads `<not by name>` to the scan and goes red. So a fourth name such as `CCRC_RECALL_OTHER` is not read, and inside a pane it is no seam. Spawned case (c) pins that as a CONTROL (R3).
- **After §8.3's Darwin and role rows, after the argument whitelist.** This is W2-D46's order 0 then 1, and the dispatcher's steps 1 and 2. So `grep` with no words, seam set, in a pane answers `bad-args`, and a server-role box answers 9 first. Neither row reads any recalled thing.
- **The refusal carries no id and no store id.** It is `refusal(2, 'headless-in-pane', null, null, null)`, exactly like `no-identity`. Two things follow from that. `readVerb` writes no counter line (W2-D46: "A counter line is written iff step 4 admitted the family"). And the `--json` envelope's `store_id` is null: the store is never measured.
- **The value is never checked here.** `CCRC_RECALL_ASOF=not-a-uuid` inside a pane is `headless-in-pane`, never `asof-invalid`. The pane row comes before every grammar row in W2-D46's step 1, and that grammar is W2-2b's.

**Residuals, named:**
- **The operator verbs still spawn tmux in a pane.** `runOpVerb`'s irreversible-form check (`tmuxSession` from cli.mjs's operator block, and the sweep's own `display-message`) never reads the seam. W2-D47 rules that box and operator verbs ignore it, and W2-2b pins that. "Before any tmux spawn" is about the read path, the only path that would read the seam.
- **A fourth `CCRC_RECALL_*` name is unread** (Choices). It arms nothing and reaches nothing, because no shipped code reads it.

**Security doors this task owns.** Its door is the read path's first answer inside a pane. Under the seam, nothing is read: no identity, no store, no row, node, epoch, id or count. Spawned case (a) checks every place such a thing could show:
- the exit and the word;
- stdout and stderr, which hold no recalled word;
- the envelope's `scope`, `indexed_through_ms`, `lag_s`, `items`, `shown`, `total`, `next` and `store_id`;
- the counter spool, which is unchanged;
- the `--regex` child, which is never spawned because the refusal precedes the store;
- tmux, which is never asked.

Its CONTROL runs the same pane on the same seeded family with no seam variable. There, every read verb derives the identity (one tmux call each), `grep`, `grep --regex` and `expand` recall the family's word, `tree`'s scope counts one transcript, and a counter line is written.

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'base holds W2-1' || echo 'STOP: W2-1 (#1105) is not on this base'
```

Expected: `base holds W2-1`. On `STOP`, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, that no name is taken, and the base counts.** From the repository root:

```bash
grep -c "^  const pane = process.env.TMUX_PANE ?? null;$" ccd/history/cli.mjs
grep -c "^  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });$" ccd/history/cli.mjs
grep -c "^  if (!who.ok) return refusal(who.rc, who.reason, null, null, null);$" ccd/history/cli.mjs
grep -c "^  decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, paneOk,$" ccd/history/cli.mjs
grep -c "^//        pane;$" ccd/history/cli.mjs
grep -c "^/\*\* The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The$" ccd/history/lib.mjs
grep -c "^function refuseScope(reason) {$" ccd/history/lib.mjs
grep -c "^  { ok: true; id: string } | ScopeRefusal<'no-identity' | 'bad-id'>;$" ccd/history/lib.d.mts
grep -c "^describe('ccrc history: process.env is read by name, from a four-name allow-list (spec 2026-10-05 §10.1 Seams)', () => {$" server/test/single-definition.test.ts
grep -c "^  const ALLOWED = \['CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'\];$" server/test/single-definition.test.ts
grep -c "'headless-in-pane'" ccd/history/lib.mjs
grep -c 'recallSeamEngaged\|decideSeamInPane\|RecallSeamValues\|zqseampane' ccd/history/*.mjs ccd/history/lib.d.mts deploy/*.mjs server/test/history-cli.test.ts server/test/single-definition.test.ts
grep -n 'process\.env\.CCRC_RECALL_\|process\.env\[' ccd/history/*.mjs
```

Expected (measured at `cd622b2f6`):
- 1 for each of the first eleven lines. The eleventh is `REASON_ROWS`' one copy of the word.
- 0 in every file for the twelfth line, so the names are free.
- No output for the last line: no module reads a `CCRC_RECALL_*` variable or reads `process.env` by a computed name (§8.2, §10.1). A hit means a merge or an earlier task already reads one: stop and report.

Then record the base counts. Step 9 compares against them. Run each command in the foreground with a timeout of at least 600000 ms, one per tool call, each from the repository root:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C4 .no-pane half.|C3: the identity|C65: a tmux|C24: consecutive')
```

Write each `N passed` (and any `skipped`) into `.superpowers/sdd/history-w2-2a/base-counts-task5.txt` (gitignored). Every file must be green. A red file is re-run alone (CLAUDE.md's load flakes) before it is reported.

- [ ] **Step 2: Write the failing tests.** Three appends, each after its file's last line, never above an existing describe.

(a) `server/test/history-cli.test.ts`: append:

```ts

// ── W2-2a Task 5 (W2-D39, W2-D45): the seam variables inside a pane are refused before any tmux spawn ─────────────
// Spec §8.2: the headless seam is honoured only when TMUX_PANE is unset; inside a pane the answer is exit 2
// headless-in-pane (C4's in-pane half; C31's "set inside a pane"). W2-2a refuses; it reads no value beyond whether it is
// empty. The env identity, ARM, ASOF and the marker are W2-2b's. The pure describe runs everywhere.
describe('W2-D39: decideSeamInPane refuses the seam variables inside a pane (W2-2a Task 5)', () => {
  const lib = async () => await import('../../ccd/history/lib.mjs');
  const NONE: { session: string | null; arm: string | null; asof: string | null } = { session: null, arm: null, asof: null };
  const ASOF = 'd4d4d4d4-4444-4444-8444-444444444444';
  const IN_PANE = { ok: false, rc: 2, reason: 'headless-in-pane' };

  it('the seam is engaged iff one of its three values is non-empty (W2-D45)', async () => {
    const { recallSeamEngaged } = await lib();
    expect(recallSeamEngaged(NONE)).toBe(false);
    expect(recallSeamEngaged({ session: '', arm: '', asof: '' }), 'an empty variable is unset').toBe(false);
    expect(recallSeamEngaged({ ...NONE, session: ID })).toBe(true);
    expect(recallSeamEngaged({ ...NONE, arm: 'fixture-arm' })).toBe(true);
    expect(recallSeamEngaged({ ...NONE, asof: ASOF })).toBe(true);
    expect(recallSeamEngaged({ session: '', arm: '', asof: 'not-a-uuid' }), 'no value is checked here').toBe(true);
  });

  it('a pane with any seam value is 2 headless-in-pane; no pane, or no seam value, passes to the tmux path', async () => {
    const { decideSeamInPane, REASONS, EXIT } = await lib();
    expect(REASONS['headless-in-pane'], 'the W1 word, not a new one').toBe(EXIT.REFUSED);
    const engaged = [{ ...NONE, session: ID }, { ...NONE, arm: 'fixture-arm' }, { ...NONE, asof: ASOF }, { session: ID, arm: 'fixture-arm', asof: ASOF }];
    for (const recall of engaged) {
      expect(decideSeamInPane({ pane: '%1', recall }), JSON.stringify(recall)).toEqual(IN_PANE);
      expect(decideSeamInPane({ pane: null, recall }), `no pane: ${JSON.stringify(recall)}`).toEqual({ ok: true });
    }
    expect(decideSeamInPane({ pane: '%1', recall: NONE }), 'CONTROL: a pane and no seam is today\'s path').toEqual({ ok: true });
    expect(decideSeamInPane({ pane: '%1', recall: { session: '', arm: '', asof: '' } }), 'CONTROL: empty values are no seam').toEqual({ ok: true });
  });

  it('TMUX_PANE set means defined: an empty or malformed pane is still a pane', async () => {
    const { decideSeamInPane } = await lib();
    for (const pane of ['', '-x', '%', 'not a pane']) {
      expect(decideSeamInPane({ pane, recall: { ...NONE, asof: ASOF } }), JSON.stringify(pane)).toEqual(IN_PANE);
      expect(decideSeamInPane({ pane, recall: NONE }), `CONTROL: ${JSON.stringify(pane)} with no seam`).toEqual({ ok: true });
    }
  });
});

// The same rule, spawned, on one seeded family: in a pane every read verb and the --regex door answer
// headless-in-pane with no tmux call, no counter line and nothing recalled; the CONTROL is the same pane with no seam
// variable, which derives the identity and recalls the family's word.
describe('W2-D39: the read verbs refuse the seam variables inside a pane, before any tmux spawn (C4, C31; W2-2a Task 5)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const SP_T = 'c3c3c3c3-3333-4333-8333-333333333333';
  const SP_ROW = 'c3c3c3c3-0000-4000-8000-000000000001';
  const WORD = 'zqseampane';
  const ASOF = 'd4d4d4d4-4444-4444-8444-444444444444';
  const SEAM: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['CCRC_RECALL_SESSION alone', { CCRC_RECALL_SESSION: ID }],
    ['CCRC_RECALL_ARM alone', { CCRC_RECALL_ARM: 'fixture-arm' }],
    ['CCRC_RECALL_ASOF alone (C31)', { CCRC_RECALL_ASOF: ASOF }],
    ['all three', { CCRC_RECALL_SESSION: ID, CCRC_RECALL_ARM: 'fixture-arm', CCRC_RECALL_ASOF: ASOF }],
  ];
  /** Every read verb and the --regex child's door, each with argv that parses; the refusal comes before the store. */
  const VERBS: ReadonlyArray<readonly string[]> = [
    ['grep', WORD, '--json'], ['grep', '--regex', 'zqseam(pane|none)', '--json'], ['describe', SP_ROW, '--json'],
    ['expand', SP_ROW, '--json'], ['tree', '--json'],
  ];
  type Run = ReturnType<typeof healthHh.runCli>;
  const ans = (r: Run): unknown[] => [r.code, r.json?.['reason']];
  const calls = (box: HistoryBox): string => path.join(box.home, 'tmux-calls');
  const spool = (box: HistoryBox): string => {
    const p = hist(box, 'spool', `${ID}.jsonl`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const ENVELOPE_KEYS = ['scope', 'indexed_through_ms', 'lag_s', 'items', 'shown', 'total', 'next', 'store_id'] as const;
  let seeded: HistoryBox | null = null;
  /** One family, one question and its answer, both carrying WORD; captured once for the describe. */
  async function seededBox(): Promise<HistoryBox> {
    if (seeded !== null) return seeded;
    const fx = await import('./historyFixtures.js');
    const box = makeHistoryBox('ccrc-hist-cli-seampane-', { role: 'fleet', shim: true });
    const base = { sessionId: SP_T, cwd: '/home/u/tree/demo' };
    healthHh.seedFamily(box, { id: ID, project: 'demo', uuid: SP_T, generation: G1, rows: [
      fx.userRow({ ...base, uuid: SP_ROW, ts: '2026-10-01T10:00:01.000Z', text: `${WORD} the question` }),
      fx.assistantRow({ ...base, uuid: 'c3c3c3c3-0000-4000-8000-000000000002', ts: '2026-10-01T10:00:02.000Z',
        text: `${WORD} the answer`, requestId: 'req_seampane_1', msgId: 'msg_seampane_1' }),
    ] });
    seeded = box;
    return box;
  }

  it('C4 and C31, in-pane half: each seam variable in a pane is 2 headless-in-pane for every read verb, with no tmux call, no counter line and nothing recalled; CONTROL: the same pane without it reads the family', async () => {
    const box = await seededBox();
    const pane = healthHh.withPane(box, ID);
    fs.rmSync(calls(box), { force: true });
    // CONTROL: the same pane and family, no seam variable. Every verb derives the identity from tmux, and the family's
    // text, counts and a counter line are there to be hidden.
    for (const argv of VERBS) {
      const r = healthHh.runCli(box, [...argv], { env: pane });
      const what = `CONTROL ${argv.join(' ')}: ${r.stderr}`;
      expect(r.json?.['reason'], what).not.toBe('headless-in-pane');
      if (argv[0] === 'grep' || argv[0] === 'expand') {
        expect(r.code, what).toBe(0);
        expect(r.stdout, `${what} the family's text is recalled`).toContain(WORD);
      }
      if (argv[0] === 'tree') {
        expect(r.code, what).toBe(0);
        expect(r.json?.['scope'], `${what} the header counts the transcript`).toMatchObject({ transcripts: 1 });
      }
    }
    expect(fs.readFileSync(calls(box), 'utf8').trim().split('\n'), 'CONTROL: tmux was asked once per verb').toHaveLength(VERBS.length);
    const counted = spool(box);
    expect(counted, 'CONTROL: a read with an identity writes a counter line').not.toBe('');
    fs.rmSync(calls(box), { force: true });
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: { ...pane, ...seam } });
        const what = `${label}, ${argv.join(' ')}`;
        expect(ans(r), `${what}: ${r.stderr}${r.stdout}`).toEqual([2, 'headless-in-pane']);
        expect(`${r.stdout}${r.stderr}`, `${what}: nothing recalled`).not.toContain(WORD);
        expect(ENVELOPE_KEYS.map((k) => r.json?.[k]), `${what}: no scope, count, cursor or store id`)
          .toEqual([null, null, null, [], 0, 0, null, null]);
      }
      const human = healthHh.runCli(box, ['grep', WORD], { env: { ...pane, ...seam } });
      expect(human.code, label).toBe(2);
      expect(human.stdout.trim(), `${label}: the human refusal line`).toMatch(/^exit 2 headless-in-pane: /);
      expect(human.stdout, label).not.toContain(WORD);
    }
    expect(fs.existsSync(calls(box)), 'no tmux spawn under any seam variable').toBe(false);
    expect(spool(box), 'no counter line: no identity was derived').toBe(counted);
  }, 240_000);

  it('CONTROL, no pane: the seam variables change nothing, and every read verb still answers 2 no-identity with no tmux call (C4, no-pane half)', async () => {
    const box = await seededBox();
    healthHh.withPane(box, ID);   // a working tmux IS on PATH; the env below carries no TMUX_PANE
    fs.rmSync(calls(box), { force: true });
    for (const [label, seam] of SEAM) {
      for (const argv of VERBS) {
        const r = healthHh.runCli(box, [...argv], { env: seam });
        expect(ans(r), `${label}, ${argv.join(' ')}: ${r.stderr}${r.stdout}`).toEqual([2, 'no-identity']);
        expect(r.stdout, label).not.toContain(WORD);
      }
    }
    expect(fs.existsSync(calls(box))).toBe(false);
  }, 240_000);

  it('an empty or malformed TMUX_PANE is a pane; an empty seam variable, or a CCRC_RECALL_ name outside the three, is no seam (W2-D45)', async () => {
    const box = await seededBox();
    const pane = healthHh.withPane(box, ID);
    fs.rmSync(calls(box), { force: true });
    for (const p of ['', '-x']) {
      const r = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, TMUX_PANE: p, CCRC_RECALL_ASOF: ASOF } });
      expect(ans(r), `TMUX_PANE=${JSON.stringify(p)}: ${r.stderr}`).toEqual([2, 'headless-in-pane']);
      const control = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, TMUX_PANE: p } });
      expect(ans(control), `CONTROL: TMUX_PANE=${JSON.stringify(p)} with no seam is today's answer`).toEqual([2, 'no-identity']);
    }
    expect(fs.existsSync(calls(box)), 'neither pane is %<n>, so tmux is never asked').toBe(false);
    const empty = healthHh.runCli(box, ['grep', WORD, '--json'],
      { env: { ...pane, CCRC_RECALL_SESSION: '', CCRC_RECALL_ARM: '', CCRC_RECALL_ASOF: '' } });
    expect(ans(empty), `three empty variables are no seam: ${empty.stderr}`).toEqual([0, undefined]);
    expect(empty.stdout).toContain(WORD);
    const other = healthHh.runCli(box, ['grep', WORD, '--json'], { env: { ...pane, CCRC_RECALL_OTHER: ASOF } });
    expect(ans(other), `a name outside the three is not read: ${other.stderr}`).toEqual([0, undefined]);
    expect(other.stdout).toContain(WORD);
  }, 240_000);
});
```

(b) `server/test/single-definition.test.ts`: append:

```ts

// ── W2-2a Task 5 (W2-D39): the three seam names, read once each, by name, in cli.mjs alone ─────────────────────────
// APPENDED after the file's last describe, for the reason the blocks above state: session-hook.test.ts's citation audit
// cites this file by line. The allow-list describe holds every read to a name it lists. This one holds the three seam
// names to their exact holders (spec §10.1, "pinned in exact-holders form"), so a second read, a read in another
// module, a computed read, a bracketed read or a quoted name each go red here.
describe('ccrc history W2-2a Task 5: the three CCRC_RECALL_ seam names are each read once, by name, in cli.mjs alone (W2-D39)', () => {
  const SEAM_NAME = /(process\.env\.)?(CCRC_RECALL_[A-Za-z0-9_]*)/g;
  const seamUses = (code: string): string[] =>
    [...code.matchAll(SEAM_NAME)].map((m) => `${m[1] === undefined ? 'named' : 'read'} ${m[2]}`);

  it('CONTROL: the needle tells a dotted read from a bare, bracketed or quoted name, and sees no comment line', () => {
    expect(seamUses('const a = process.env.CCRC_RECALL_ASOF ?? null;')).toEqual(['read CCRC_RECALL_ASOF']);
    expect(seamUses("const k = 'CCRC_RECALL_ARM'; const v = process.env[k];")).toEqual(['named CCRC_RECALL_ARM']);
    expect(seamUses("const s = process.env['CCRC_RECALL_SESSION'];")).toEqual(['named CCRC_RECALL_SESSION']);
    expect(seamUses(stallCodeText('  // CCRC_RECALL_ASOF is read below\n * CCRC_RECALL_ARM\nconst x = 1;'))).toEqual([]);
  });

  it('cli.mjs reads CCRC_RECALL_SESSION, CCRC_RECALL_ARM and CCRC_RECALL_ASOF once each, dotted, and no other history module names one', () => {
    const uses = HISTORY_MJS.flatMap((f) => seamUses(stallCode(f)).map((u) => `${rel(f)}: ${u}`)).sort();
    expect(uses).toEqual([
      'ccd/history/cli.mjs: read CCRC_RECALL_ARM',
      'ccd/history/cli.mjs: read CCRC_RECALL_ASOF',
      'ccd/history/cli.mjs: read CCRC_RECALL_SESSION',
    ]);
  });
});
```

(c) Neither append adds an import line. Write no numeric line citation into either file: `citations.test.ts` refuses one (D-5893).

- [ ] **Step 3: Run the new tests and watch them fail as predicted.** One per tool call, each from the repository root:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'decideSeamInPane refuses the seam variables inside a pane')
```
Predicted: `3 failed`, a `TypeError`: `recallSeamEngaged is not a function` for the first case and `decideSeamInPane is not a function` for the other two.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'the read verbs refuse the seam variables inside a pane')
```
Predicted: `2 failed | 1 passed`.
- Case (a) fails at its first refused run, `CCRC_RECALL_SESSION alone, grep zqseampane --json`, with `expected [ 0, undefined ] to deeply equal [ 2, 'headless-in-pane' ]`. Its CONTROL half passed before that line.
- Case (c) fails at `TMUX_PANE=""` with `expected [ 2, 'no-identity' ] to deeply equal [ 2, 'headless-in-pane' ]`.
- Case (b) passes: it is the CONTROL of today's behaviour, and stays green before and after.

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
```
Predicted: `1 failed | 1 passed`. The holders case fails with `expected [] to deeply equal [ 'ccd/history/cli.mjs: read CCRC_RECALL_ARM', … ]`, and the CONTROL passes.

Record each first failing line in the scratch notes. A red anywhere else is the fixture's to fix before any code is written.

- [ ] **Step 4: lib.mjs and lib.d.mts.**

(a) `ccd/history/lib.mjs`: insert directly above `/** The session's id from tmux (§8.2, D-4675 (history-identity-from-tmux)). The`:

```js
/** W2-D45's rule, spelled once: the headless seam (§8.2) is engaged iff at least one of its three values is
 *  non-empty. The values are what the CLI read from CCRC_RECALL_SESSION, CCRC_RECALL_ARM and CCRC_RECALL_ASOF, each
 *  null when the variable is undefined; an empty variable reads as unset. No value's grammar is checked here. */
export function recallSeamEngaged({ session, arm, asof }) {
  return [session, arm, asof].some((v) => typeof v === 'string' && v !== '');
}

/** W2-D39, the CLI half of §8.2's "Inside a pane: exit 2 headless-in-pane" (C4, C31). The read verbs run it after
 *  §8.3's Darwin and role rows and before any tmux spawn. TMUX_PANE is set iff it is defined (W2-D45), so an empty or
 *  malformed pane is still a pane, and a seam value inside one is refused. Anything else passes to the tmux path
 *  unchanged, which answers no-identity when there is no pane. */
export function decideSeamInPane({ pane, recall }) {
  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');
  return { ok: true };
}

```

(b) `ccd/history/lib.d.mts`: insert directly after `  { ok: true; id: string } | ScopeRefusal<'no-identity' | 'bad-id'>;`:

```ts
/** The headless seam's three values as the CLI read them (§8.2; W2-D39, W2-D45): null when the variable is undefined. */
export interface RecallSeamValues { session: string | null; arm: string | null; asof: string | null }
export function recallSeamEngaged(recall: RecallSeamValues): boolean;
export function decideSeamInPane(i: { pane: string | null; recall: RecallSeamValues }): { ok: true } | ScopeRefusal<'headless-in-pane'>;
```

Then count the declarations, because `skipLibCheck` hides a duplicate:

```bash
grep -c '^export function recallSeamEngaged\|^export function decideSeamInPane\|^export interface RecallSeamValues' ccd/history/lib.d.mts ccd/history/lib.mjs
```

Expected: 3 in `lib.d.mts` and 2 in `lib.mjs`.

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'decideSeamInPane refuses the seam variables inside a pane')
```

Expected: `3 passed`.

- [ ] **Step 5: cli.mjs.**

(a) The read verbs' lib import line, in place:

```js
  decideSeamInPane, decideIdentity, decideHarness, resolveGeneration, decideScope, parseReadArgs, paneOk,
```

(b) The dispatcher's order comment: insert one line directly after `//        pane;`:

```js
//     2a. the seam variables inside a pane (decideSeamInPane, W2-D39): 2 headless-in-pane, before any tmux spawn;
```

(c) In `readContextIn`, replace:

```js
  const pane = process.env.TMUX_PANE ?? null;
  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
```

with:

```js
  const pane = process.env.TMUX_PANE ?? null;
  // W2-D39: the seam variables inside a pane are 2 headless-in-pane, decided before any tmux spawn (C4, C31). Each of
  // the three is read here, by name and once; lib decides what set means (W2-D45).
  const inPane = decideSeamInPane({
    pane,
    recall: {
      session: process.env.CCRC_RECALL_SESSION ?? null,
      arm: process.env.CCRC_RECALL_ARM ?? null,
      asof: process.env.CCRC_RECALL_ASOF ?? null,
    },
  });
  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);
  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
```

Then smoke-load the module in a child, so its umask never reaches a vitest worker:

```bash
node --no-warnings --input-type=module -e "await import('./ccd/history/cli.mjs'); process.stdout.write('loaded\n')"
```

Expected: `loaded`, and no other output.

- [ ] **Step 6: Run the new tests green, and watch the allow-list see the three reads.** One per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'W2-D39')
```
Expected: `6 passed`.

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
```
Expected: `2 passed`.

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'process.env is read by name')
```
Predicted: `1 failed | 1 passed`. The red is `every process.env read in ccd/history/*.mjs names an allowed variable`, with `expected [ 'ccd/history/cli.mjs: CCRC_RECALL_SESSION', 'ccd/history/cli.mjs: CCRC_RECALL_ARM', 'ccd/history/cli.mjs: CCRC_RECALL_ASOF' ] to deeply equal []`. This is the allow-list's own red-first. The scan names all three reads by name, so none of them reads as `<not by name>`. Record the line. Any other entry in the list is a read this task did not plan: stop and report it.

- [ ] **Step 7: Grow the allow-list to seven, in place.** In `server/test/single-definition.test.ts`, replace these four lines:

```ts
describe('ccrc history: process.env is read by name, from a four-name allow-list (spec 2026-10-05 §10.1 Seams)', () => {
  // D-4247: no env var arms a seam in the shipped modules. A test's faults arrive through
  // a NODE_OPTIONS preload it writes itself, and `process.env` is read only for these four names.
  const ALLOWED = ['CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];
```

with these four:

```ts
describe('ccrc history: process.env is read by name, from an allow-list (spec 2026-10-05 §10.1 Seams)', () => {
  // D-4247: no env var arms a test seam in the shipped modules. A test's faults arrive through a NODE_OPTIONS
  // preload it writes itself, and `process.env` is read only for these names; W2-2a adds §8.2's three (W2-D39).
  const ALLOWED = ['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION', 'CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];
```

The title drops "four-name" and states no count, so the next name added does not make it stale. The line count is unchanged. Then run, one per tool call:

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'process.env is read by name')
```
Expected: `2 passed`: the existing CONTROL and scan cases. Step 2's holders describe does not match this filter, and Step 6 already ran it.

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'THE CITATION DEBT this task creates')
```

Expected: green and unchanged. This task's only line-count change in `single-definition.test.ts` is the append after the file's last describe, and the in-place block keeps its four lines. If the census for `server/test/single-definition.test.ts` moves, record the measured number. Do not edit the census to fit it: stop and report.

- [ ] **Step 8: Measure each guard red under its mutant, then green.** From the repository root. First write the helpers, once:

```bash
SCRATCH=.superpowers/sdd/history-w2-2a/t5
mkdir -p "$SCRATCH"
for f in ccd/history/cli.mjs ccd/history/lib.mjs server/test/single-definition.test.ts; do cp "$f" "$SCRATCH/$(basename "$f").orig"; done
cat > "$SCRATCH/mut.sh" <<'EOF'
SCRATCH=.superpowers/sdd/history-w2-2a/t5
FILES="ccd/history/cli.mjs ccd/history/lib.mjs server/test/single-definition.test.ts"
# mut <file>: replace the text of $SCRATCH/old with $SCRATCH/new in <file>, refusing unless it occurs exactly once.
mut() {
  python3 - "$1" "$SCRATCH/old" "$SCRATCH/new" <<'PY'
import sys
p, o, n = sys.argv[1], open(sys.argv[2]).read(), open(sys.argv[3]).read()
t = open(p).read()
c = t.count(o)
if c != 1:
    sys.exit(f'anchor occurs {c} times in {p}')
open(p, 'w').write(t.replace(o, n))
PY
}
# restore: every file back to its copy, checked with cmp. It also runs when the call exits, by a signal too, so a call
# that is killed mid-mutant never leaves the mutant in the tree.
restore() { for f in $FILES; do cp "$SCRATCH/$(basename "$f").orig" "$f"; cmp -s "$SCRATCH/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done; }
trap restore EXIT
trap 'exit 143' INT TERM HUP
EOF
```

Then run each mutant in its own tool call. Each call starts with `. .superpowers/sdd/history-w2-2a/t5/mut.sh`, writes `old` and `new` with quoted heredocs, applies the mutant, runs the named filters one at a time, and ends with `restore`. Every run is in the foreground with a timeout of at least 600000 ms. A `mut` that exits non-zero means the anchor moved: re-read the region, re-anchor on the line that now makes the same decision, and name the substitution in the commit body. Never split one mutant across calls: the helpers restore every file when a call exits. A call that prints `NOT RESTORED` stops the task: report it.

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M1: the identity measured (tmux spawned) before the refusal is returned, on the refusing path only. The no-seam path
# is untouched, so case (a)'s CONTROL still asks tmux once per verb and the red lands on the seam half.
cat > "$SCRATCH/old" <<'EOF'
  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);
EOF
cat > "$SCRATCH/new" <<'EOF'
  if (!inPane.ok) {
    void decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
    return refusal(inPane.rc, inPane.reason, null, null, null);
  }
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
restore
# Predicted RED: `1 failed`: "no tmux spawn under any seam variable": expected true to be false. Every answer is still
# [2, 'headless-in-pane'], and the CONTROL's "tmux was asked once per verb" still reads 5 lines (the mutant spawns only
# when it refuses), so only the spawn before the refusal reds it. CONTROL: the pure describe stays green.
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M2: the check moved after the identity's own refusal.
cat > "$SCRATCH/old" <<'EOF'
  if (!who.ok) return refusal(who.rc, who.reason, null, null, null);
EOF
cat > "$SCRATCH/new" <<'EOF'
  if (!who.ok) return refusal(who.rc, who.reason, null, null, null);
  if (!inPaneLate.ok) return refusal(inPaneLate.rc, inPaneLate.reason, null, null, null);
EOF
mut ccd/history/cli.mjs
cat > "$SCRATCH/old" <<'EOF'
  if (!inPane.ok) return refusal(inPane.rc, inPane.reason, null, null, null);
  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
EOF
cat > "$SCRATCH/new" <<'EOF'
  const inPaneLate = inPane;
  const who = decideIdentity({ pane, tmux: paneOk(pane) ? tmuxSession(pane) : null });
EOF
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'an empty or malformed TMUX_PANE is a pane')
restore
# Predicted RED: (a) `1 failed`, no tmux spawn (expected true to be false); (c) `1 failed` at TMUX_PANE="":
# expected [ 2, 'no-identity' ] to deeply equal [ 2, 'headless-in-pane' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M3: CCRC_RECALL_SESSION dropped from the reads.
printf '      session: process.env.CCRC_RECALL_SESSION ?? null,\n' > "$SCRATCH/old"
printf '      session: null,\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
restore
# Predicted RED: (a) `1 failed` at "CCRC_RECALL_SESSION alone, grep zqseampane --json": expected [ 0, undefined ] to
# deeply equal [ 2, 'headless-in-pane' ]; the holders case `1 failed` (the SESSION read missing).
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M4: CCRC_RECALL_ARM dropped from the reads.
printf '      arm: process.env.CCRC_RECALL_ARM ?? null,\n' > "$SCRATCH/old"
printf '      arm: null,\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
restore
# Predicted RED: (a) `1 failed` at "CCRC_RECALL_ARM alone, …"; the holders case `1 failed` (the ARM read missing).
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M5: CCRC_RECALL_ASOF dropped from the reads (C31's in-pane half).
printf '      asof: process.env.CCRC_RECALL_ASOF ?? null,\n' > "$SCRATCH/old"
printf '      asof: null,\n' > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'an empty or malformed TMUX_PANE is a pane')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
restore
# Predicted RED: (a) `1 failed` at "CCRC_RECALL_ASOF alone (C31), …"; (c) `1 failed` at TMUX_PANE="" (it sets ASOF);
# the holders case `1 failed` (the ASOF read missing).
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M6: lib's rule forgets ASOF.
printf "  return [session, arm, asof].some((v) => typeof v === 'string' && v !== '');\n" > "$SCRATCH/old"
printf "  return [session, arm].some((v) => typeof v === 'string' && v !== '');\n" > "$SCRATCH/new"
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'decideSeamInPane refuses the seam variables inside a pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
restore
# Predicted RED: the pure describe `3 failed` (the ASOF row of each); (a) `1 failed` at "CCRC_RECALL_ASOF alone (C31), …".
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M7: an empty variable counts as set (W2-D45 broken).
printf "  return [session, arm, asof].some((v) => typeof v === 'string' && v !== '');\n" > "$SCRATCH/old"
printf "  return [session, arm, asof].some((v) => typeof v === 'string');\n" > "$SCRATCH/new"
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'decideSeamInPane refuses the seam variables inside a pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'an empty or malformed TMUX_PANE is a pane')
restore
# Predicted RED: the pure describe `2 failed` ("an empty variable is unset"; "CONTROL: empty values are no seam");
# (c) `1 failed`: "three empty variables are no seam": expected [ 2, 'headless-in-pane' ] to deeply equal [ 0, undefined ].
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M8: an empty TMUX_PANE read as no pane.
printf "  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');\n" > "$SCRATCH/old"
printf "  if (typeof pane === 'string' && pane !== '' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');\n" > "$SCRATCH/new"
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'TMUX_PANE set means defined')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'an empty or malformed TMUX_PANE is a pane')
restore
# Predicted RED: pure `1 failed` at '""'; (c) `1 failed` at TMUX_PANE="": expected [ 2, 'no-identity' ] to deeply
# equal [ 2, 'headless-in-pane' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M9: the allow-list back at four names.
printf "  const ALLOWED = ['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION', 'CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];\n" > "$SCRATCH/old"
printf "  const ALLOWED = ['CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];\n" > "$SCRATCH/new"
mut server/test/single-definition.test.ts
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'names an allowed variable')
restore
# Predicted RED: `1 failed`, the three cli.mjs reads listed (Step 6's line).
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M10: a computed read of ASOF (behaviour unchanged; only the pins see it).
printf '      asof: process.env.CCRC_RECALL_ASOF ?? null,\n' > "$SCRATCH/old"
printf "      asof: process.env[['CCRC', 'RECALL', 'ASOF'].join('_')] ?? null,\n" > "$SCRATCH/new"
mut ccd/history/cli.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'names an allowed variable')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'seam names are each read once, by name')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
restore
# Predicted RED: the allow-list `1 failed` ('ccd/history/cli.mjs: <not by name>'); the holders case `1 failed` (the
# ASOF read missing). CONTROL: (a) stays green, because the CLI still refuses; only the pins see a computed read.
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M11: the wrong word.
printf "  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');\n" > "$SCRATCH/old"
printf "  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('no-identity');\n" > "$SCRATCH/new"
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'decideSeamInPane refuses the seam variables inside a pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'each seam variable in a pane is 2 headless-in-pane')
restore
# Predicted RED: pure `2 failed` (the IN_PANE rows); (a) `1 failed`: expected [ 2, 'no-identity' ] to deeply equal
# [ 2, 'headless-in-pane' ].
```

```bash
. .superpowers/sdd/history-w2-2a/t5/mut.sh
# M12: the seam refused with no pane too (W2-2a would answer W2-2b's question early).
printf "  if (typeof pane === 'string' && recallSeamEngaged(recall)) return refuseScope('headless-in-pane');\n" > "$SCRATCH/old"
printf "  if (recallSeamEngaged(recall)) return refuseScope('headless-in-pane');\n" > "$SCRATCH/new"
mut ccd/history/lib.mjs
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'a pane with any seam value is 2 headless-in-pane')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'CONTROL, no pane')
restore
# Predicted RED: pure `1 failed` at "no pane: …"; (b) `1 failed`: expected [ 2, 'headless-in-pane' ] to deeply equal
# [ 2, 'no-identity' ].
```

After the last block:

```bash
for f in ccd/history/cli.mjs ccd/history/lib.mjs server/test/single-definition.test.ts; do cmp "$f" ".superpowers/sdd/history-w2-2a/t5/$(basename "$f").orig" || echo "NOT RESTORED: $f"; done
git status --short
```

Expected: the loop prints nothing, and `git status --short` lists exactly this task's five files, modified. If a mutant stays green, its guard does not hold. Report it, and never weaken the guard or fit a CONTROL to the mutant. Record each measured red line in the scratch notes, for the commit body.

**Mutants, by guard:**

| Guard (new unless named) | Mutant | Must red | Must stay green |
|---|---|---|---|
| cli.mjs: the check before `decideIdentity`'s spawn | M1, M2 | (a) "no tmux spawn under any seam variable"; M2 also (c) at `TMUX_PANE=""` | the pure describe |
| cli.mjs: three dotted reads | M3, M4, M5 | (a) at that variable's "alone" row; the holders case; M5 also (c) | the "all three" rows |
| lib `recallSeamEngaged`: all three values | M6 | the pure rows for ASOF; (a) at "CCRC_RECALL_ASOF alone (C31)" | the SESSION and ARM rows |
| lib `recallSeamEngaged`: empty is unset (W2-D45) | M7 | pure "an empty variable is unset", "CONTROL: empty values are no seam"; (c) "three empty variables are no seam" | (a), (b) |
| lib `decideSeamInPane`: a defined pane is a pane | M8 | pure "TMUX_PANE set means defined" at `""`; (c) at `TMUX_PANE=""` | (a), which runs at `%1` |
| lib `decideSeamInPane`: the word | M11 | the pure IN_PANE rows; (a) | (b), (c)'s CONTROLs |
| lib `decideSeamInPane`: no pane passes (C4's no-pane half) | M12 | pure "no pane: …"; (b) | — |
| single-definition allow-list (existing, now seven names) | M9, M10 | `names an allowed variable` | — |
| single-definition holders (new) | M3, M4, M5, M10 | `cli.mjs reads CCRC_RECALL_SESSION, …` | its CONTROL case |

- [ ] **Step 9: Run the neighbours that read these files.** Run each in the foreground with a timeout of at least 600000 ms, one per tool call, from the repository root. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes: `typecheck-tests` and `session-hook` are among them).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C4 .no-pane half.|C3: the identity|C65: a tmux|C24: consecutive')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
```
```bash
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'the exit codes and reason words')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```
```bash
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```

Expected: green. The predictions, by file:
- **`history-cli`**: the base count plus 6. W2-1's recall-off describe and the status describes are unchanged, because `status` and the operator verbs never reach `readContextIn`.
- **`history-recall`'s four cases**: unchanged. `scrubbedEnv` removes every `CCRC_RECALL_*` from `box.env`, so C3, C65 and C24 take today's path. C4's no-pane half answers `no-identity` as before.
- **`single-definition`**: the base count plus 2.
- **`history-lib`'s C16 describe**: unchanged. `headless-in-pane` was already an exit-2 word.
- **`typecheck-tests`**: `lib.d.mts`' three new declarations type the pure describe's calls. A red names a declaration mismatch: fix the declaration, never the test.
- **`citations`**: no numeric line citation was added (D-5893).

Compare each count with Step 1's notes.

- [ ] **Step 10: Commit.** This task defines no departure, so `## Deviations found` is not touched.

First write the message, with a quoted heredoc so nothing in it is expanded:

```bash
cat > .superpowers/sdd/history-w2-2a/t5/commit-msg.txt <<'EOF'
feat(history): the read verbs refuse the seam variables inside a pane, and the env allow-list grows to seven (W2-2a Task 5; W2-D39, W2-D45)

<each mutant's measured red line from Step 8, all twelve, one line each, its mutant first>
<Step 6's allow-list red line>
<the passing counts of Steps 6, 7 and 9>
<any re-anchoring Step 1 or Step 8 needed, or: no re-anchoring>

<the attribution line the session's reminder names>
EOF
```

Replace each `<…>` line with what it names, from the scratch notes. Then:

```bash
for f in ccd/history/cli.mjs ccd/history/lib.mjs server/test/single-definition.test.ts; do cmp -s ".superpowers/sdd/history-w2-2a/t5/$(basename "$f").orig" "$f" || echo "NOT RESTORED: $f"; done
grep -c '^<' .superpowers/sdd/history-w2-2a/t5/commit-msg.txt
git add ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs server/test/history-cli.test.ts server/test/single-definition.test.ts
git status --short
git commit -F .superpowers/sdd/history-w2-2a/t5/commit-msg.txt
git status --short
```

Expected: the loop prints nothing (no mutant is left in a file the commit takes; a `NOT RESTORED` line stops the commit: report it); then `0` (no placeholder left); then `git status --short` lists exactly these five files, modified, before the commit, and nothing after it. Nothing under `.superpowers/` appears: it is gitignored.
### Task 6: the whole-PR checks, the departures check and the PR

W2-2a never holds the spec path (W2-D3: only 5h-1, 5h-2, W2-1, W2-5b and W2-6 claim it). The two errata this PR's code makes true, E2's `asof-invalid` half (the exit-2 row) and E11 (§8.2's "rows, nodes and epochs after that boundary as absent"), are amended in place by W2-5b (decisions §6, "Amended by"), so the spec stays at rev 3.6 with W2-1's errata, byte for byte, and this task checks that. It adds no code, no test and no guard. It checks that the PR holds only W2-2a's files, that D-5765 and D-5766 are defined once, in this plan on `main` (R7), and that no base reading and no widened rule moved (the ledger's "Later" item on the display doors); it takes a census of the cut's doors against the tests Tasks 1 to 5 added, runs the whole-PR checks, writes the PR body and opens the PR.

This plan defines exactly two departures, both in "## Deviations found" at its end, landed on `main` with the plan before dispatch (R7), in the em-dash form: **D-5765** (`history-w2-asof-invalid-word`, W2-D39: the plan-chosen spelling of the exit-2 word) and **D-5766** (`history-w2-asof-time-cut`, W2-D34: the time cut at T_N plus the positional hide, which departs from spec §8.2's "rows, nodes and epochs after that boundary as absent"). Section 6 of the decisions document names W2-2a as their "Defined in" PR. This task checks each is there once and defines nothing. The PR body cites three earlier numbers bare: D-5745 (the 5h-2 plan's, the widened rules), and D-6178 and D-6223 (the consolidation W0 plan's, the armed growth check and its waiver ledger).

**Files:** (anchors measured at `cd622b2f6`, #1105's merge; every one is re-anchored by its content)
- Modify: none by default. This task edits this plan (`docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md`) only to correct a figure in its own text that a step measured otherwise (a task's predicted count or output); it never adds or edits a `## Deviations found` entry.
- Read, no edit: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (the E2 row, §8.3's exit-2 row, about :1671; E11's sentence in §8.2's headless bullets, about :1531; the status line, :3); this plan's `## Deviations found`; `server/test/growth-check.test.ts`' `GROWTH_FILES` (about :57); `server/test/growthCheck.ts`' `GROWTH_MACHINERY` and `GROWTH_LIMIT`; `server/test/growth-waivers.json`; the programme ledger's "Later (coordinator), from the build" item "The display doors and the widened rules, from 5h-2's reviews".
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-2a/rules-same.mjs`, `.superpowers/sdd/history-w2-2a/titles.txt`, `.superpowers/sdd/history-w2-2a/names-control.tsv` and `.superpowers/sdd/history-w2-2a/pr-body.md`.
- Never edited by this task or this PR: the spec; `deploy/**`; `shared/**`; `README.md`; `CLAUDE.md`; the programme ledger; `server/test/lifecycle.test.ts`; `ccd/history/derive.mjs`, `sweep.mjs`, `store.mjs` and `card.mjs`; `ccd/session-hook.sh`, `ccd/ccd`, `ccd/ccrc` and `ccd/ccd-history-sweep`; `.github/**`; the growth check's own files (`GROWTH_MACHINERY`) and `growth-waivers.json`. Step 1 checks every one.

**Interfaces:**
- Consumes (names the checks and the PR body state; Step 1 measures each, and this task defines none):
  - `ccd/history/lib.mjs`: `export function asOfCut(...)` answering `{ ok: true, cut }` with `cut` holding `{asof, tsCut, boundaryEntryId, summaryEntryId, keptUuids, holdingFileId, boundaryLine}`, and the one predicate, `asOfEntrySql(alias)` with `asOfBinds(cut)` (W2-D38, R1), each declared once in `lib.d.mts`; `REASONS['asof-invalid'] === EXIT.REFUSED` (exit 2, W2-D39, D-5765), so `Object.keys(REASONS).length` goes from 53 to 54 and `REFUSALS.length` from 35 to 36; `stampAtOrBefore(rows, index)` (about :6014) and `pickHoldingCopy(files)` (about :7360) as W2-1 left them, read by the cut and not edited; lib's 67 redaction declarations (`contextRules`, `BASE_RULES`, `composeDoor`, the `redact*` doors, `displaySnippet`, `displayWindow`, `entryIndexText`, `sidecarIndexText`, `BELT_VERSION` and the rest), unchanged;
  - `server/test/single-definition.test.ts`: the env allow-list `ALLOWED` (about :5467) holding exactly `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF`, `CCRC_RECALL_SESSION`, `CCRC_SESSION_GENERATION`, `CLAUDECODE`, `HOME` and `TMUX_PANE`, and its describe title (about :5464) without `four-name`;
  - the cut-door cases Tasks 1 to 5 added to `history-recall.test.ts`, `history-cli.test.ts` and `history-lib.test.ts` (Step 4 takes their census by title);
  - `server/test/growth-check.test.ts`' `GROWTH_FILES` (nine paths, none under `ccd/history/`) and `growthCheck.ts`' `GROWTH_MACHINERY`;
  - this plan's D-5765 and D-5766, each defined once in "## Deviations found".
- Produces: text only. The PR body file and the PR. No repository file by default.

**Decisions:** W2-D2 (the fleet lane runs one PR at a time; W2-2a after W2-1, beside W2-5a), W2-D3 (no spec path; E2 and E11 are W2-5b's), W2-D4 (D-5765 and D-5766 defined once, in this plan), W2-D5 (no new test file), W2-D6 and W2-D10 (rollout with W2's final release; no migrate), and W2-D34, W2-D35, W2-D36, W2-D37, W2-D38 and W2-D39 as the PR body states them.

**Choices this task makes:**
- **No spec edit, and the check that there is none.** E2 lists `asof-invalid` beside W2-2b's `headless-malformed` and `headless-arm-unknown`, and E11 is the as-of sentence; both are W2-5b's to amend (W2-D3, decisions §6). Step 1 asserts the spec is unchanged over the PR, that E11's rev 3.6 sentence and E2's rev 3.6 words still stand once each, that the spec names no `asof-invalid`, and that line 3 still reads rev 3.6. The PR body says the spec stays rev 3.6 plus W2-1's errata until W2-5b.
- **The ledger's "Later" item is not taken by this PR, with evidence.** The item waits for "the first wave after 5h-2 that may change a base reading or the widened rules (D-5745's)". A base reading is a door's rev 3.6 reading (`BASE_RULES`, R11 of the 5h-2 plan); the widened rules are D-5745's. W2-2a changes which rows, nodes and epochs reach the doors, and so may change which texts a door is handed, but never what a door prints for a given text. Step 3 measures that by comparing every top-level declaration of `lib.mjs` at the merge-base and at HEAD and requiring the 67 redaction declarations byte-identical; its CONTROL runs the same script over 5h-2's own change (`3af16cf97` to `02d75ae5f`), which must red and name 33 of them. A second grep checks that no changed line in `recall.mjs`, `regex-worker.mjs` or `cli.mjs` names a door. So the item stays open for a later wave, and the PR body says so in one paragraph.
- **growth-check lists no W2-2a file.** `GROWTH_FILES` is `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/sessionws.ts` and `pwa/src/lib/api.ts`. The check is armed (D-6178), and a listed file over `GROWTH_LIMIT` (40 net code lines) needs an operator-named exemption (D-6211) or an added waiver entry under its own D-number (D-6223). W2-2a edits none of the nine, adds no waiver and no exemption, and edits none of `GROWTH_MACHINERY`, so every row reads `delta +0` and `GROWTH_OVER: (none)`. A growth in `lib.mjs`, `recall.mjs` or `cli.mjs`, however large, is not measured by it.
- **The doors are counted by title, then read.** The security property is that a cut-hidden row, node, epoch, id or count never leaks through any door. Tasks 1 to 5 own the doors and their cases; Step 4 lists every added test title and counts, per door, the titles that name it and those that carry a CONTROL, then the worker reads each case to confirm it asserts absence under the cut and presence without it. A door with no case, or a case with no CONTROL anywhere in it, is a finding against the task the door table below names, reported to the coordinator and never added here.
- **No commit by default (R7).** Every edit this PR makes is in Tasks 1 to 5. If a step measures a figure that differs from a prediction in this plan's text, the correction is this task's one commit (below), touching only this plan's text. The PR carries five commits, or six (measured: nine, the five task commits, two from the whole-branch review's fix waves, this one for the figures here it corrected and one from review 778's fix round; the R7 row above states the plan's original prediction).
- **Free-space cases are box state, not breaks (R7).** Three cases, two in `history-holds` and one in `history-export`, read the box's real free space and fail on a box below the store's free-space floor, at the base too. A red there is re-run alone; if it still reds, the worker names each case by title, records the assertion line and the free space of the test volume (`df -P --output=avail` on the fixture root, a number only), and says so in the PR body. CI on the quiet box is the arbiter, and only for a file its selection ran.

**The cut's doors, and the task whose cases pin each** (W2-D34 to W2-D39 as section 2 of the decisions assigns them; the Task column is filled from the File Structure, R5). A door with no case in its task is a finding against that task:

| Door | What must be absent under the cut | CONTROL without the cut | Decision | Task (cases) |
|---|---|---|---|---|
| a hit (grep, plain and FTS) | a hidden row's hit, and its snippet | the same hit shown | W2-D34, W2-D36 | 2 (cut-A1, cut-A4) |
| a variant, a sidecar | an `entry_variants` row or sidecar of a hidden entry; a sidecar with a NULL `entry_id` | each shown | W2-D35 | 2 (cut-A2, cut-A3, cut-B4); 4 (the child's join) |
| the regex child | a hidden candidate scanned or matched by `--regex`, a hidden row's variant body included | scanned and matched | W2-D38 | 4 (the child-applies and kept-row cases, mutants W1, W2 and W5); 2 (cut-A5, the parent's filter) |
| a gist (`tree`, `describe`) | a hidden leaf's or parent's gist | the gist shown | W2-D35 | 3 (C31, the tree cases) |
| a leaf id (`coveringLeaves`, `leafHeads`, grouping) | leaf N+1's id beside a kept(N) hit (C31's CONTROL); a hit whose only leaf is hidden is grouped under the live tail; a hit a hidden lower-id leaf shares is grouped under its visible leaf | leaf N+1's id, or the lower id, shown | W2-D35 | 3 (C31, `leafHeads`) |
| a prefix (`scopePrefixes`, `--node`) | a hidden node's id prefix | the prefix shown | W2-D35, W2-D36 | 3 (the prefix and tree cases) |
| an ambiguity (`resolveNodeInScope`) | a hidden id making a prefix ambiguous | the prefix answered ambiguous | W2-D36 | 3 (the prefix case) |
| an exit code | a hidden id or uuid answering `out-of-scope` (exit 2) instead of exit 3 | the visible one answering | W2-D36 | 2 (cut-B1, cut-B2); 3 (the exit-3 case) |
| expand's outline file (`expandPairedPath`) | a hidden `tool_use` ancestor's file path and outline kind | the json outline naming the file | W2-D36 | 2 (cut-B5, mutant M10) |
| describe's sources, `sources_total`, producer, parent, children and `children_total` | a hidden source row, witness, parent or child | each shown | W2-D35, W2-D36 | 3 (the describe case) |
| an epoch | an epoch with no visible entry | the epoch listed | W2-D35 | 3 (the tree cases) |
| a header count, family names, the lag, the `--json` scope | hidden transcripts and families in any count, name or lag | the counts with them | W2-D37 | 4 (the header, widened and lag cases) |
| tree's family headings | a family with no visible epoch, its id and its generation | both families headed | W2-D37, R8 (SEC-1) | 4 (the widened tree case, mutant R19) |
| describe's refs and files (`refs_total`, `files_total`) | a `tool_use` ref, and its path, of a visible node with a hidden source row, its own or a descendant leaf's | the mined ref and its path shown | W2-D35, W2-D36, R8 (SEC-2) | 3 (the R8 case, mutants M18 to M21) |
| a cursor | a cursor minted under another cut, or none, resuming | the same cursor resuming under its own cut | W2-D37 | 4 (the grep, `--regex` and expand cursor cases; lib's `expandCursorKey` cases) |
| before every LIMIT | a hidden row consuming a LIMIT or ranking slot (C27's shape) | the visible hit returned | W2-D36 | 2 (cut-A4, cut-B3) |
| the in-pane seam | any identity, store, row, count, cursor, child or tmux call | the same pane with no seam | W2-D39 | 5 (spawned case a) |
| `asof-invalid` | a cut with missing fields | a cut | W2-D39 | 1 (the arms with their CONTROL); 2 (cut-A6, the store half) |

- [ ] **Step 0: Measure the base and main.** From the repository root:

```bash
git fetch origin main
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'on W2-1' || echo 'BASE MISSING'
MB=$(git merge-base origin/main HEAD); git rev-parse --short "$MB"
git diff --name-only "$MB" origin/main | grep -xF -f <(git diff --name-only "$MB" HEAD) || echo 'main moved no path of this PR'
```

Expected: `on W2-1`; the merge-base's short sha; `main moved no path of this PR`. W2-5a runs beside this PR with disjoint files (W2-D2), so a listed path is another PR's edit of one of ours: merge `origin/main` (never a rebase), keep both sides, and run Steps 1 to 5 on the merge. A conflict in a path outside this PR's list is reported to the coordinator, never resolved here.

- [ ] **Step 1: Check that the PR holds only W2-2a's files, and what they state.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git diff --name-only "$MB" HEAD | grep -vxF -f <(printf '%s\n' \
  ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/lib.mjs ccd/history/lib.d.mts ccd/history/cli.mjs \
  "$PLAN" server/test/history-recall.test.ts server/test/history-cli.test.ts server/test/history-lib.test.ts \
  server/test/single-definition.test.ts) || echo 'only W2-2a files'
git diff --name-only "$MB" HEAD -- docs/superpowers/specs deploy shared README.md CLAUDE.md docs/superpowers/programs \
  server/test/lifecycle.test.ts ccd/history/derive.mjs ccd/history/sweep.mjs ccd/history/store.mjs ccd/history/card.mjs \
  ccd/session-hook.sh ccd/ccd ccd/ccrc ccd/ccd-history-sweep .github server/test/growthCheck.ts \
  server/test/growth-check.test.ts server/test/growth-exemptions.json server/test/growth-waivers.json \
  server/test/rings server/test/scan/parse.ts | wc -l
git diff --name-only --diff-filter=A "$MB" HEAD | wc -l
for n in $(git diff "$MB" HEAD -- ccd/history/lib.mjs | sed -nE 's/^\+export (async )?(function\*? |const |let )([A-Za-z_$][A-Za-z0-9_$]*).*/\3/p' | sort -u); do
  git show "$MB":ccd/history/lib.mjs | grep -qE "^export (async )?(function\*? |const |let )$n\b" && continue
  printf '%s d.mts %s' "$n" "$(grep -cE "^export (function|const|let) $n\b" ccd/history/lib.d.mts)"
  case "$n" in [A-Z]*) grep -qw "'$n'" server/test/single-definition.test.ts && printf ' bound\n' || printf ' UNBOUND\n';; *) printf '\n';; esac
done
node -e "import('./ccd/history/lib.mjs').then((l)=>{console.log('asof-invalid', l.REASONS['asof-invalid'], 'refused', l.EXIT.REFUSED, 'reasons', Object.keys(l.REASONS).length, 'refusals', l.REFUSALS.length, 'asOfCut', typeof l.asOfCut)})"
node -e "const s=require('fs').readFileSync('server/test/single-definition.test.ts','utf8'); const m=/const ALLOWED = (\[[^\]]*\])/.exec(s); console.log(m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x)=>x[1]).sort().join(' ') : 'ALLOWED not found'); console.log('four-name', (s.match(/four-name/g)||[]).length)"
git diff "$MB" HEAD -- ccd/history | grep -E '^\+.*process\.env' \
  | grep -vE "process\.env(\.|\[')(HOME|TMUX_PANE|CLAUDECODE|CCRC_SESSION_GENERATION|CCRC_RECALL_SESSION|CCRC_RECALL_ARM|CCRC_RECALL_ASOF)\b" \
  || echo 'every new env read is one of the seven, by name'
git diff "$MB" HEAD -- ccd/history server/test | grep -nE '^\+.*\b(lib|cli|sweep|store|derive|recall|card|regex-worker)\.mjs:[0-9]' || echo 'no new mjs line citation'
{ git diff "$MB" HEAD | grep '^+' | grep -v '^+++'; git log --format=%B "$MB"..HEAD; } \
  | grep -nE '\bD-[0-9]+(\.\.|-[0-9]|–| to D-)' || echo 'no D-number range'
git diff --quiet "$MB" HEAD -- "$SPEC" && echo 'spec untouched'
grep -cF '  - `ASOF` makes every verb treat rows, nodes and epochs after that boundary as absent.' "$SPEC"
grep -cF 'headless seam (`headless-unarmed`, `headless-in-pane`, `headless-unlisted`; W2), no identity' "$SPEC"
grep -c 'asof-invalid' "$SPEC"
sed -n '3p' "$SPEC" | grep -c 'rev 3\.6'
```

Expected:
- `only W2-2a files`; `0` (no never-edit path); `0` (the PR creates no file: W2-D5, and the plan is on `main` before dispatch, R7);
- one line per new lib export, each `d.mts 1` (count them: `skipLibCheck` hides a duplicate): `asOfCut`, `asOfEntrySql`, `asOfBinds`, `asOfHiddenNodesSql`, `asOfVisibleEpochsSql`, `asOfVisibleEntriesSql`, `expandCursorKey`, `recallSeamEngaged` and `decideSeamInPane` (measured: ten, with `asOfSummaryPickSql`, the D-6282 pick's test seam, which the fix wave added), and no upper-case name (`ASOF_KEY_SEP` and `ASOF_PICK_CTES` are module-private, so O14's `VOCABS` binds nothing new). An upper-case line is a finding against the task that added it;
- `asof-invalid 2 refused 2 reasons 54 refusals 36 asOfCut function` (53 and 35 at `cd622b2f6`: W2-2a adds exactly one word, C16's; `headless-in-pane` is already a word, at about lib.mjs:46);
- `CCRC_RECALL_ARM CCRC_RECALL_ASOF CCRC_RECALL_SESSION CCRC_SESSION_GENERATION CLAUDECODE HOME TMUX_PANE`, then `four-name 0` (1 at `cd622b2f6`);
- `every new env read is one of the seven, by name`; `no new mjs line citation` (D-5893's ratchet); `no D-number range`;
- `spec untouched`, `1`, `1`, `0`, `1`: E11's and E2's rev 3.6 words stand once each, the spec names no `asof-invalid`, and it is still rev 3.6.

Any other path, a `d.mts` count other than 1, an unexplained `UNBOUND`, an eighth env name, a new line citation, a range, or a spec change is a finding against the task that added it: report it to the coordinator, and never fix it here.

- [ ] **Step 2: Check the departures.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md
for d in D-5765 D-5766 D-6281 D-6282 D-6283 D-6284; do printf '%s %s\n' "$d" "$(grep -c "^- \*\*$d\*\* — " "$PLAN")"; done
grep -cE '^- \*\*D-[0-9]+\*\* — ' "$PLAN"
grep '^- \*\*D-5765\*\* — `history-w2-asof-invalid-word`' "$PLAN" | grep -c 'W2-D39'
grep '^- \*\*D-5766\*\* — `history-w2-asof-time-cut`' "$PLAN" | grep -c 'W2-D34'
for d in D-5765 D-5766 D-6281 D-6282 D-6283 D-6284; do git log --format="$d %h %s" -S"- **$d** — " "$MB"..HEAD -- "$PLAN"; done
for d in D-5765 D-5766 D-6281 D-6282 D-6283 D-6284; do printf '%s at merge-base %s\n' "$d" "$(git show "$MB:$PLAN" 2>/dev/null | grep -c "^- \*\*$d\*\* — ")"; done
grep -c 'D-5765\|D-5766' ccd/history/lib.mjs
for d in D-5765 D-5766 D-6281 D-6282 D-6283 D-6284; do printf '%s defined in %s plan(s)\n' "$d" "$(grep -lE "^(#{2,4} |- \*\*)$d\b" docs/superpowers/plans/*.md | wc -l)"; done
git diff "$MB" HEAD -- docs ":(exclude)$PLAN" | grep -cE '^\+(#{2,4} |- \*\*)D-[0-9]+'
git grep -n 'D-TBD-[a-z0-9]' -- "$PLAN" ccd/history server/test || echo 'no D-TBD token'
```

Expected: `1` for each of `D-5765`, `D-5766`, `D-6281`, `D-6282`, `D-6283` and `D-6284`, one line apiece; `2` (the plan defines those two numbers and no other; measured: `6`, the two plus the four review numbers D-6281, D-6282, D-6283 and D-6284, which the whole-branch review's fix waves and review 778's fix round took from the run's block, each defined once in the commit that first cites it); `1` and `1` (each entry in the em-dash form under its slug, naming its decision); no `git log` line for D-5765 or D-5766 (the PR adds no entry: both came with the plan, R7; measured: one line each for D-6281, D-6282, D-6283 and D-6284, whose entries the fix commits added); `D-5765 at merge-base 1` and `D-5766 at merge-base 1` (and `0` for each of the four review numbers, D-6281, D-6282, D-6283 and D-6284); `4` (Task 1's comments cite both: `REASON_ROWS`, the section header and two doc comments); `D-5765 defined in 1 plan(s)`, `D-5766 defined in 1 plan(s)`, `D-6281 defined in 1 plan(s)`, `D-6282 defined in 1 plan(s)`, `D-6283 defined in 1 plan(s)` and `D-6284 defined in 1 plan(s)` (corrected in place by the coordinator's ledger PR, 2026-10-22, review 791 F-D: the loop and this text named D-5765 and D-5766 only); `0` (no other document defines a number); `no D-TBD token`.

A count of definitions above 2, or a `git log` line, is either a number from this run's block that the worker used for a departure found while executing (defined in the commit that first cites it, named in the wave-done and listed in the PR body), or a finding. Never add a second definition, and never renumber.

- [ ] **Step 3: Measure that no base reading and no widened rule moved (the ledger's "Later" item).** From the repository root, write the script (a quoted heredoc, so nothing in it is expanded):

```bash
mkdir -p .superpowers/sdd/history-w2-2a
cat > .superpowers/sdd/history-w2-2a/rules-same.mjs <<'EOF'
// Which top-level declarations of ccd/history/lib.mjs differ between two commits, and whether any of them is a
// redaction rule or door: the base reading (BASE_RULES, 5h-2's R11) or the widened rules (D-5745). Reads git only.
import { execFileSync } from 'node:child_process';
const [a, b] = process.argv.slice(2);
const RULES = /[Rr]edact|[Rr]ules|RULES|Door|[Dd]isplay|Snippet|[Bb]elt|BELT|PairIndex|IndexText/;
const DECL = /^(?:export )?(?:async )?(?:function\*? |const |let |class )([A-Za-z_$][\w$]*)/;
const TOP = /^(?:export )?(?:async )?(?:function|const|let|class) |^\/\*\*|^\/\/|^if \(/;
function chunks(sha) {
  const lines = execFileSync('git', ['show', `${sha}:ccd/history/lib.mjs`], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !TOP.test(lines[j])) j++;
    if (out.has(m[1])) throw new Error(`${sha}: ${m[1]} declared twice`);
    out.set(m[1], lines.slice(i, j).join('\n').trimEnd());
  }
  return out;
}
const A = chunks(a), B = chunks(b);
const differ = [...new Set([...A.keys(), ...B.keys()])].sort().filter((n) => A.get(n) !== B.get(n));
const rules = differ.filter((n) => RULES.test(n));
console.log(`redaction declarations: ${[...B.keys()].filter((n) => RULES.test(n)).length}; changed: ${rules.length ? rules.join(', ') : 'none'}`);
console.log(`every changed declaration: ${differ.length ? differ.join(', ') : 'none'}`);
process.exitCode = rules.length ? 1 : 0;
EOF
```

Then run its CONTROL, which must red, and the real comparison, which must not:

```bash
node .superpowers/sdd/history-w2-2a/rules-same.mjs 3af16cf97 02d75ae5f > .superpowers/sdd/history-w2-2a/rules-control.txt; r=$?
head -1 .superpowers/sdd/history-w2-2a/rules-control.txt | tr ',' '\n' | wc -l; echo "rc $r"
rm -f .superpowers/sdd/history-w2-2a/rules-control.txt
MB=$(git merge-base origin/main HEAD)
node .superpowers/sdd/history-w2-2a/rules-same.mjs "$MB" HEAD; r=$?; echo "rc $r"
git diff -U0 "$MB" HEAD -- ccd/history/recall.mjs ccd/history/regex-worker.mjs ccd/history/cli.mjs \
  | grep -nE '^[-+].*\b(redact[A-Za-z]*|displaySnippet|displayWindow|entryIndexText|sidecarIndexText|blobPlainText|makeBelt|makePairIndex)\b' \
  || echo 'no changed line names a door'
```

Expected (the CONTROL measured on a read-only checkout of `cd622b2f6`, which holds both commits): `33` and `rc 1` (5h-2's change, `3af16cf97` to `02d75ae5f`, changed 33 redaction declarations, `BASE_RULES` and `composeDoor` among them, so the scan sees a rules change). Then `redaction declarations: 67; changed: none`, then `every changed declaration: ` followed by the names Tasks 1 to 5 add or edit in `lib.mjs`: `ASOF_KEY_SEP`, `REASON_ROWS`, `VERB_TABLES`, `asOfBinds`, `asOfCut`, `asOfEntrySql`, `asOfHiddenNodesSql`, `asOfVisibleEntriesSql`, `asOfVisibleEpochsSql`, `decideSeamInPane`, `expandCursorKey`, `expandResumeOf` and `recallSeamEngaged`, and no other (measured: also `ASOF_PICK_CTES` and `asOfSummaryPickSql`, which the D-6282 fix wave added); then `rc 0`. Then (measured, not `no changed line names a door`) four lines: `refsAll`'s `redactForDisplay` line removed and re-added with the same arguments when the filter on mined refs was spliced in, and `regex-worker.mjs`'s import line, removed and re-added with `asOfEntrySql` beside `entryIndexText`, `makeBelt` and `makePairIndex`. The expected result reads "no changed line changes what a door is called with": each of the four is read, and none changes a door's arguments. The script compared `02d75ae5f` with `cd622b2f6` at planning time and printed `changed: none` (W2-1 moved no rule either).

So W2-2a changes no base reading and no widened rule: it changes which rows, nodes and epochs reach the doors, and therefore which texts a door is handed, never what a door prints for a text. The ledger's "Later" item on the display doors and the widened rules waits for a wave that changes one of those, so it stays open and this PR does not take it; the PR body states this with the two counts above. A redaction name in the `changed:` list, a door named on a changed line in a way that changes its arguments, or a changed declaration no task names, is a finding: report it to the coordinator, who rules whether this PR has become that wave.

- [ ] **Step 4: Take the census of the cut's doors.** From the repository root:

```bash
MB=$(git merge-base origin/main HEAD)
git diff "$MB" HEAD -- server/test/history-recall.test.ts server/test/history-cli.test.ts server/test/history-lib.test.ts \
  server/test/single-definition.test.ts | grep -E "^\+\s*(describe|it)(\.[A-Za-z]+(\([^)]*\))?)?\(" \
  | sed -E 's/^\+\s*//' > .superpowers/sdd/history-w2-2a/titles.txt
wc -l < .superpowers/sdd/history-w2-2a/titles.txt
for door in 'hit' 'gist|tree|describe' 'leaf|covering' 'prefix' 'ambig' 'header|count' 'cursor' 'regex' 'exit 3|out-of-scope' 'epoch' 'variant|sidecar' 'LIMIT|C27' 'C31' 'C4|pane' 'C16|asof-invalid|asOfCutOf' 'positional' 'R8|SEC-1|SEC-2|famil|refs|files' 'outline|paired'; do
  T=.superpowers/sdd/history-w2-2a/titles.txt
  printf '%s: %s titles, %s naming a CONTROL\n' "$door" "$(grep -ciE "$door" "$T")" "$(grep -iE "$door" "$T" | grep -c 'CONTROL')"
done
```

Expected: a title count, then one line per door pattern. Then read every case those titles name and fill one table, door by door as in the table above: the case title that asserts the hidden thing absent under the cut, and the case (or the same case's CONTROL half) that shows the same fixture without the cut showing it. A 0 in the CONTROL column is settled by reading the case: a CONTROL inside the same `it` counts. A door left with no hidden-absent case, or with no CONTROL anywhere, is a finding against the task the door table's Task column names: report it to the coordinator, and never write the case here. The table goes into the PR body under `### Pins`. C59 and C69 are W1-B2's describes in `history-recall.test.ts` (about :3993 and :4303 at `cd622b2f6`); this PR adds no case to them, and Step 5 runs them by name.

- [ ] **Step 5: The whole-PR checks.** Each line in the foreground, with a timeout of at least 600000 ms, ONE tool call per line: never two suites in one call, never a loop over suites, never a suite in the background (the history suites together run far past 600 s). Re-run a red file alone before calling it a break: CLAUDE.md names the load flakes. The census first: every `history-*.test.ts` file runs, the seventeen at `cd622b2f6`, and any other one on a line of its own.

```bash
ls server/test/history-*.test.ts | wc -l
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'C59|C69')
(cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-sweep.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-ingest.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-maint.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-op.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-export.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-holds.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-recover.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-derive.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-drain.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-parser.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-store.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT')
(cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'history')
(cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts)
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts)
(cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts)
(cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit)
(cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- the census prints `17`, or 17 plus a history suite another PR added on `main`, which then gets a line of its own like these;
- every `history-*.test.ts` file green alone, with this PR's pins among them: C31 in process and its in-pane refusal, C4's in-pane half, the cursors under a cut (C11's shape in Task 4's expand cursor case), C16's one word (`asof-invalid`, in `history-lib` and `history-skill`'s derivation), C27 with the cut before the LIMIT, the positional-hide CONTROL (W2-D34), the `coveringLeaves` CONTROL (W2-D35), and R8's two cases (describe's mined refs in Task 3's describe, tree's family headings in Task 4's);
- the `-t 'C59|C69'` run selects the two W1-B2 describes and is green: redaction before every cut and the substring belt at every door, unchanged by the cut;
- `history-holds` and `history-export` green, except for the three cases that read the box's real free space (two in `history-holds`, one in `history-export`), which red on a box below the store's free-space floor exactly as they do at the base: re-run each file alone, and for a case still red, record its title, its assertion line and the volume's free space, and put them under `### Tests run` as box state, never as a break (R7);
- `history-replay` and `measure-history` green, read and never edited: the driver and the gate import `lib.mjs`, and `measure-history`'s "O14, local half: the gate declares no name lib.mjs exports" reds if a new lib export shares a name with the gate (D-5774), as `history-replay`'s driver-words describe does for the driver;
- `single-definition` green: the env allow-list at seven names (W2-D39), O14 and the rest unchanged; then the `CITATION DEBT` case green, because `session-hook.test.ts` cites `single-definition.test.ts` by line and Task(s) editing it in place kept the cited lines where they were;
- `ccrc-doctor`'s `'history'` cases green (doctor runs `status`, a box verb, which no seam variable reaches in this PR);
- `docs-policy`, `topology-clean`, `citations` (no added numeric line citation, D-5893), `docs-parity` and `dtbd` (no concrete `D-TBD-` token) green;
- `growth-check` prints `growth-check: net code lines against the merge-base`, nine rows each `delta +0`, `GROWTH_OVER: (none)` and `ledger entries this diff adds: (none)`, and is green: no W2-2a file is listed (D-6178), and the PR adds no waiver (D-6223);
- both `tsc` runs print nothing.

Copy each `Test Files … | Tests …` summary line, as printed, into the PR body. A `topology-clean` red means a new sentence names a host, an id or a private path: report it against the task that wrote it, never touch the scanner. A `single-definition` red on a new spelling is a finding against the task that added it: report it, never weaken the scan.

- [ ] **Step 6: Check the deviation ledger against `main` without merging.**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)
```

Expected: green. A red names a number defined in two plans: report it to the coordinator, and never renumber one. D-5765 and D-5766 are defined once, in this plan's "## Deviations found", on `main` (Step 2); D-5745, D-6178 and D-6223 are cited bare in the PR body and defined in the 5h-2 plan and the consolidation W0 plan.

- [ ] **Step 7: Confirm the tree holds only this PR's work.** Run `git status --short`. It lists nothing: Tasks 1 to 5 committed their work, and the scratch files sit under the ignored `.superpowers/`. No step read or wrote a live `~/.ccrc`: every test ran in a fixture HOME, and no step ran `ccd`, the shim, `sweep.mjs`, `cli.mjs` or any history verb. Then remove this task's scratch: `rm -f .superpowers/sdd/history-w2-2a/titles.txt`, and the fixture directories the runs left, as Global Constraints say.

- [ ] **Step 8: Write the PR body, and check it, every added line and every message for private names.** Write `.superpowers/sdd/history-w2-2a/pr-body.md` with exactly the text below. Then replace its five parenthesised lines, each from the source it names:
  - under `### Departures`, the line with this plan's two `## Deviations found` entries, D-5765 and D-5766, copied whole, then one line per number this run's block issued during the build (each defined in this plan in the commit that first cites it), each as defined;
  - under `### Pins`, the line with Step 4's table, door by door, each cell a case title;
  - under `### Rulings made in the operator's place`, the line with this plan's Decisions-table rows marked as the coordinator's rulings in the operator's place, one line each, then every ruling the coordinator made during the build, one line each with its date;
  - under `### Choices the tasks made`, the line with every task's choice bullets, one line each, its task number first, plus any finding Steps 1 to 4 reported and the coordinator's answer to it;
  - under `### Tests run`, the line with Step 5's and Step 6's summary lines as printed, Step 3's two `rc` lines, and any free-space case Step 5 recorded.

Every other line is final.

```markdown
## ccrc history wave W2-2a: the as-of cut

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6 with W2-1's errata, **not edited by this PR**: §8.2's as-of seam (`CCRC_RECALL_ASOF`), §8.3's exit table (exit 2 and exit 3), and the pins C4, C11, C16, C27, C31, C59 and C69. The two errata this PR's code makes true, E2's `asof-invalid` and E11 (the cut that replaces "rows, nodes and epochs after that boundary as absent"), are amended in place by W2-5b, which holds the spec path after the fleet lane ends (W2-D3; decisions §6).
Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-2a (fleet): the as-of cut" entry and §3 D: W2-D34, W2-D35, W2-D36, W2-D37, W2-D38 and W2-D39. Plan: `docs/superpowers/plans/2026-10-22-ccrc-history-w2-2a-as-of-cut.md`.

W2's arms ask a question "as of" a compaction boundary N, so every read verb has to answer exactly as if nothing after N were stored. This PR builds that cut, in one definition, and applies it at every door; it is the fleet lane's PR after W2-1 (#1105), beside W2-5a (W2-D2):

- **One cut, in lib** (W2-D34, W2-D38): `asOfCut(...)` answers `{ ok: true, cut }`, `cut` holding `{asof, tsCut, boundaryEntryId, summaryEntryId, keptUuids, holdingFileId, boundaryLine}`, or exit 2 `asof-invalid`, and lib holds the one SQL predicate every reader applies, `asOfEntrySql(alias)` with its named values `asOfBinds(cut)`. recall.mjs's `asOfCutOf(rc, asof)` measures the cut's inputs from the store. T_N is N's `ts_ms`, or, when that is NULL, the newest stamp at or before N in N's holding copy (`stampAtOrBefore` over `pickHoldingCopy`). An entry is visible iff it is stamped at or before T_N and is not a row after N's boundary line in N's holding copy, or it is N's boundary or summary entry, or a member of kept(N). Every NULL-stamped row is hidden, and so is every post-boundary row of the holding copy whatever its stamp. This time cut plus the positional hide departs from §8.2's "after that boundary as absent" (D-5766).
- **The cut at every door** (W2-D35, W2-D36): grep (plain, FTS and the regex child, which receives the cut with its job), `expand`, `tree`, `describe`, `--node`, and `coveringLeaves`, `leafHeads` and `scopePrefixes`. Entries are cut in SQL, inside each statement, before scope and before every LIMIT and ranking cut; nodes and epochs are removed before scope, by lib's node and epoch statements, before a lower id is taken, a prefix is measured or anything is counted. A leaf is visible iff its boundary entry is; a parent iff every descendant leaf is; an epoch iff one of its transcripts holds a visible entry; variants and sidecars follow their entry. A hidden row, node, epoch or id answers as if it were not stored: exit 3, never `out-of-scope`, and it never makes a prefix ambiguous. Two doors the leak lens found close fail closed (R8): tree heads only the families with a visible epoch, and describe drops the refs mined from source rows (origin `tool_use`), and the `files` derived from them, of a node with a hidden source row, its own or a descendant leaf's.
- **Cursors and the header** (W2-D37): the grep and expand cursor keys carry `asof` when a cut is set, so a cursor minted under another cut or none answers stale; header counts are computed over what is visible.
- **The CLI half** (W2-D39): a non-empty `CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM` or `CCRC_RECALL_ASOF` with `TMUX_PANE` set (empty included) answers exit 2 `headless-in-pane` before any tmux spawn (a fourth `CCRC_RECALL_*` name is not read); with no pane the CLI still answers `no-identity`; the env allow-list grows from four names to seven, because this is the first PR that reads the three; and `asof-invalid` joins `REASON_ROWS` (exit 2, D-5765) with `asOfCut`'s store half: a boundary row, a main transcript, a copy holding N, and T_N.

Sessions see no change. Nothing outside the tests sets a cut in this PR: the environment's identity from `CCRC_RECALL_ASOF`, `CCRC_RECALL_ARM` and the `headless-on` marker are W2-2b's (W2-D40, W2-D42, W2-D44), and with no seam variable set every verb reads exactly as before. Files: `ccd/history/lib.mjs`, `lib.d.mts`, `recall.mjs`, `regex-worker.mjs` and `cli.mjs`, and appended tests in `history-recall`, `history-cli`, `history-lib` and `single-definition`. Schema v2, no migration (W2-D10), no new file (W2-D5), and nothing in the spec, `deploy/**`, `shared/**`, README, `lifecycle.test.ts`, `derive.mjs`, `sweep.mjs`, `store.mjs`, `ccd/session-hook.sh` or `.github/**`.

### Departures

(this plan's two `## Deviations found` entries, D-5765 and D-5766, copied whole, then any number of this run's block, as defined)

Cited bare, defined elsewhere: D-5745 (the 5h-2 plan: the widened rules), D-6178 and D-6223 (the consolidation W0 plan: the armed growth check and its waiver ledger).

### Decisions this PR applies

- W2-D34 and W2-D38: the one cut and its one definition, keyed on entries, never on blobs, riding on `rc.scope.cut`.
- W2-D35, W2-D36 and W2-D37: nodes, epochs, sidecars and grouping; hidden means absent, cut before scope and every LIMIT; cursors and the header.
- W2-D39: the in-pane refusal, the seven-name allow-list and `asof-invalid` with its store half (D-5765).
- W2-D2, W2-D3, W2-D5 and W2-D10: the fleet lane's order, no spec path, no new test file, no schema change.

### Pins

C31 in process, with its in-pane refusal and its `coveringLeaves` CONTROL (W2-D35); C4's in-pane half; C11's shape under a cut (the expand cursor case); C16's one word, `asof-invalid`; C27 with the cut before the LIMIT; the positional-hide CONTROL (W2-D34); R8's two doors, tree's family headings (SEC-1) and describe's mined refs (SEC-2); single-definition's env allow-list at seven names. C59 and C69 run unchanged and green. Every new guard was measured red under its mutant, then green; the plan lists each mutant and the case it reds. The doors of the cut, each with the case that shows a hidden thing absent there and its CONTROL that shows the same fixture without the cut:

(Step 4's table, door by door, each cell a case title)

### The display doors and the widened rules

The ledger's "Later" item from 5h-2's reviews waits for the first wave that changes a base reading or the widened rules (D-5745). This PR changes neither: every one of `lib.mjs`'s 67 redaction declarations is byte-identical to the merge-base (a scan whose CONTROL, run over 5h-2's own change, names 33 of them), and no changed line in `recall.mjs`, `regex-worker.mjs` or `cli.mjs` names a door. The cut changes which rows, nodes and epochs reach the doors, never what a door prints for a given text. The item stays open, for a later wave.

### Steps for the coordinator or the operator, never the worker

1. **Full suite.** This PR changes no `.github/` file, so the pull request runs its selection. Check that its `select tests` summary lists `history-recall`, `history-cli`, `history-lib`, `history-skill`, `measure-history`, `history-replay` and `single-definition`; if one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Rollout through the release lane only**, and only as part of W2's final release (W2-D6). No node owes a `doctor --migrate` (W2-D10).
3. **The spec errata.** E2's `asof-invalid` and E11 are W2-5b's to amend in place (W2-D3); until then the spec reads rev 3.6 with W2-1's errata, and this PR's departures, D-5765 and D-5766, are stated in its plan.
4. **The ledger.** Its W2-1 and W2-2a rows, and the "Later" item above (still open), are the coordinator's.

### Residuals, named

- A row outside N's holding copy, written after N but stamped at or before T_N (the same millisecond, or a backward clock step), stays visible, and Baseline B does not cover it. W2-5a counts the same-millisecond hits per question (`asof_same_ms_hits`) and reports them; a backward clock step is not measurable (W2-D34, D-5766).
- A visible node's stored aggregates (`src_chars`, `desc_chars`, `earliest_ms`, `latest_ms`, `desc_count`) were computed over all its sources, hidden ones included: node-level figures, not entry content; recomputing them per read would put the derivation's cost on every describe (R6).
- Variants follow their entry (W2-D35): a variant of a visible entry first seen after T_N stays visible (R6).
- A visible node's refs of origin `model` and `meta` stay under a cut: they come from the summary written at N (R6, R8). Its `tool_use` refs go whenever a source row under it is hidden, even one mined from a visible row, because `node_refs` names no row (fail closed).
- Every NULL-stamped row is hidden under a cut, so W2-5a never asks a fact only such rows carry (W2-D70); a sidecar with a NULL `entry_id` is absent under a cut (W2-D35); an unreadable kept blob gives an empty kept(N), which hides more (D-5766).
- Until W2-2b, a seam variable outside a pane answers `no-identity`, and the cut is reached only in process (W2-D39, R3); the operator verbs' irreversible-form check still asks tmux in a pane and never reads the seam (W2-D47 is W2-2b's).

### Rulings made in the operator's place

(this plan's Decisions-table rows taken by the coordinator in the operator's place, one line each, then every ruling made during the build, one line each with its date)

Every ruling here is the coordinator's, under the operator's directive of 2026-10-19 to proceed through the build waves; the operator may change any of them.

### Choices the tasks made

(every task's choice bullets, one line each, its task number first, plus any finding Steps 1 to 4 reported and the coordinator's answer)

### How it was measured

Each task's guards were watched red on the unguarded code, with the prediction written before the run, then each mutant in its task's list was measured red and the code green again. The whole-PR checks ran one suite per call, in the foreground, on the worker's box; `deviation-refs` ran against `origin/main` without merging; the private-name count over every added line, every commit message and this body is 0.

### Tests run (foreground, on the worker's box)

(Step 5's and Step 6's summary lines as printed, Step 3's two rc lines, and any free-space case Step 5 recorded)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then check the two scans' CONTROLs, and the body, every added line and every message. Each command prints a count or a line number, never a token:

```bash
printf '# comment\nk\tzqprivword\n' > .superpowers/sdd/history-w2-2a/names-control.tsv
printf 'one zqprivword two\nzqprivwordy\n' | grep -c -i -w -F -f <(cut -f2 .superpowers/sdd/history-w2-2a/names-control.tsv | grep -v '^#')
printf '/%s/zqowner/x\n/home/u/tree\n' home | grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/mnt/|/tmp/claude-|/home/([^u]|u[^/])'
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
test -s "$LIST" && grep -vc '^#' "$LIST" || echo 'PRIVATE-NAME LIST MISSING'
MB=$(git merge-base origin/main HEAD)
TITLE='ccrc history wave W2-2a: the as-of cut'
{ git diff -U0 "$MB" HEAD | grep '^+' | grep -v '^+++'; git log --format=%B "$MB"..HEAD; printf '%s\n' "$TITLE"; cat .superpowers/sdd/history-w2-2a/pr-body.md; } \
  | grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/mnt/|/tmp/claude-|/home/([^u]|u[^/])' | cut -d: -f1 || echo 'no host or home path'
{ git diff -U0 "$MB" HEAD | grep '^+' | grep -v '^+++'; git log --format=%B "$MB"..HEAD; printf '%s\n' "$TITLE"; cat .superpowers/sdd/history-w2-2a/pr-body.md; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
rm -f .superpowers/sdd/history-w2-2a/names-control.tsv
```

Expected: `1` (the private-name pipeline counts a whole-word hit and skips a comment line and a longer word); `1` (the host and home-path pattern takes a home path and leaves the `/home/u/tree` fixture style alone); a positive count, the number of names the real list holds (a missing or empty list would hand `grep -f` no pattern, and its `0` would read as a pass, so `PRIVATE-NAME LIST MISSING` or `0` here stops the step: report it, and run no scan until the list is there); `no host or home path`; `0`. A non-zero count or a line number is judged by its line, never by printing the token: re-run the same pipeline with `grep -n -i -w -F -f <(…) | cut -d: -f1` for line numbers only, read those lines, and have the task that wrote each one rewrite it with a neutral stand-in before any push (a commit message by an amended commit before the first push only; after it, report to the coordinator). The fixture paths in this PR's tests are `/home/u/…` style; the body names none. The plan is on `main` before dispatch (R7), so its own pattern lines are not among the PR's added lines; a Task 6 correction commit changes figures only, never these lines.

- [ ] **Step 9: Open the PR, then read its review threads.** Push the workspace branch, then open the PR against `main`, ready for review (not a draft):

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-2a: the as-of cut" \
  --body-file .superpowers/sdd/history-w2-2a/pr-body.md
read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
PR=$(gh pr view --json number -q .number)
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved path line}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | "threads \(.totalCount) open \([.nodes[] | select(.isResolved | not)] | length)"'
gh pr checks "$PR"
```

Expected: the PR URL; `threads N open 0`; and, once CI settles, every required check green (build-pwa, test (agent), test (pwa), test (server), node floor, typecheck), with `test (server)`'s `select tests` summary read as Step 8's body asks the coordinator to. Re-read the threads after every push. A thread left open blocks the merge even while its check reads green; a CodeQL thread's cause is fixed in code by the task that owns the line (argv arrays, never a shell; no env value in a command string; SQL by bound parameters, never by a concatenated value), and a thread is never resolved, nor an alert dismissed, by the worker. Wave-done is the brief's: the PR open, its checks green, no open thread, and the branch tip the PR head.

**Mutants.** This task adds no guard, no test and no code path, so it has no mutant list. Its scripted checks carry their own CONTROLs, each measured before the real run: Step 3's scan reds on 5h-2's rules change (33 declarations, rc 1) before it is trusted to read green on this PR's; Step 8's two scans each count a planted hit (`1` and `1`) before they are trusted to read 0 over the PR. Every guard this PR adds is in Tasks 1 to 5, each with its own mutant list, and Step 4 checks every door of the cut has a case and a CONTROL there.

**Commit:** none by default; Steps 0 to 9 change no tracked file (R7). If a step measures a figure that differs from what this plan predicted in its own text (a task's predicted count or output), the correction is this task's one commit, touching only this plan's text and never a `## Deviations found` entry: `docs(history): the W2-2a plan's predicted figures, as measured (W2-2a Task 6; W2-D4)`.

This task's drifts are the header's rows for Task 6.

---
## Deviations found

D-5765 and D-5766 were issued on 2026-10-19 in the W2 decisions document's block, and this plan is the one that defines them (decisions §6's "Defined in"). Each is defined once, here, and lands on `main` with the plan before dispatch (R7); Task 1 cites both in lib.mjs's comments, Task 6 checks each entry is here once, and the PR defines no number but the departures its reviews found (the whole-branch review's three and review 778's one), below. Every other number this plan cites is defined on `main` and cited bare. A departure found while executing takes the next number from the run's block and is defined here in the commit that first cites it.

- **D-5765** — `history-w2-asof-invalid-word` (Task 1; W2-D39, with W2-D34's T_N): the as-of cut's refusal is spelled `asof-invalid`, an exit-2 word in lib's `REASON_ROWS`, so `REFUSALS` holds it (C16, its one word). The spec names the seam (`CCRC_RECALL_ASOF=<boundary uuid>`, §8.2) but no word for an ASOF that names no usable boundary, and §8.3's exit-2 row holds none: the spelling is this plan's. W2-2a ships the store half, decided by lib's `asOfCut` over what recall.mjs's `asOfCutOf` measured: no `boundaries` row has the uuid (or the row measured is not the ASOF's), the boundary sits on a sidechain transcript (`agent_id` not `''`), **no copy holds it**, or no stamp lies at or before it in its holding copy. The "no copy holds N" arm is a fourth condition beside W2-D39's "a boundary row, a main transcript, and T_N": the positional hide (W2-D34) is defined only inside N's holding copy, so the cut fails closed rather than drop that clause. No `memberships` row is deleted at the base, so only a damaged store reaches it; it takes no number of its own, and the coordinator amended W2-D39 in place to list it (R1). W2-2b adds the pre-store half (an empty or non-UUID ASOF, W2-D42) and the family half (W2-D40) under the same word; no door prints it before W2-2b's env path. Erratum E2 (decisions §6) adds the word to §8.3's exit-2 row, amended in place by W2-5b, never by W2-2a. SKILL.md is not edited: its exit-2 row is generic (W2-D48's rule). Pins: history-lib's C16 case, its `REASON_ROWS` case beside this entry's comment, and the arms' case with its CONTROL (Task 1, mutants M9, M10, M11 and M13); history-recall's cut-A6, the store half's unknown uuid, non-boundary row and sidechain boundary (Task 2: mutant M11 the sidechain arm, M12 the kept(N) set and M15 the holding-copy pick under its deep-equal CONTROL, M16 the non-boundary-row arm).
- **D-5766** — `history-w2-asof-time-cut` (Task 1; W2-D34, W2-D38): "as of boundary N" is decided by time and by position, not by position alone. T_N is N's `ts_ms`, else the newest non-null stamp at or before N in N's holding copy (lib's `stampAtOrBefore`, W2-D33). An entry is visible iff its `ts_ms` is non-null and at most T_N and it is not a row of N's holding copy at a line after N's `boundary_line`; or it is N's boundary entry; or N's summary entry (derivation's `summaryRowFor` pick); or a member of kept(N) present in the store (N's `kept_blob_id`, option (a)). Every other entry is absent: every NULL-ts entry, before the boundary too, and every row after N in its holding copy, whatever its stamp. lib's `asOfEntrySql` is the one predicate, with `asOfBinds` its values, keyed on entries, never on blobs. This departs from spec §8.2's "`ASOF` makes every verb treat rows, nodes and epochs after that boundary as absent" (about :1531 at cd622b2f6; erratum E11), which hides by position alone: the time cut also hides NULL-ts rows before the boundary, keeps kept(N) and N's summary visible after it, and outside the holding copy decides by stamp. Why: the store has no order across transcripts and copies, a position is defined only inside one file, and a stamp is the one coordinate every entry carries (W2-D34; SEAM-b1, pick (a)); the positional clause closes the holding copy, where a boundary's answers are written. Residual, named: a row outside N's holding copy (another transcript, or another copy of N's) that was written after N but stamped at or before T_N, in the same millisecond or after a backward clock step, stays visible, and Baseline B does not cover it (its part 3 stops at the first operator or assistant row after the boundary, W2-D68), so a fact repeated in such a row is visible to treatment and absent from B. W2-5a counts, per admitted question, the FTS hits for F_raw on entries visible under the cut, outside N's holding copy and stamped exactly T_N, as `asof_same_ms_hits`, reported and never gating; a backward clock step is not measurable and stays named in decisions §7. Also residual: kept(N) is derive's `keptOf` set, which folds a NULL `kept_blob_id`, a tombstoned or undecodable kept blob and a non-array body into an empty set, so the cut then hides a kept row rewritten after N (fail closed). Erratum E11 is amended in place by W2-5b, with "absent means exit 3, before scope" (W2-D36), which Tasks 2 to 4 of this plan build. Pins: history-lib's positional-hide CONTROL (rows after N in its holding copy stamped exactly T_N and before T_N hidden, the same fixture without the cut showing them) and its per-entry case (the same-millisecond row in another copy visible, named); Task 1's mutants M1 to M8 and M17.
- **D-6281** — `history-w2-asof-boundary-transcript` (whole-branch review; W2-D39, R2, Review Focus 3): `asOfCutOf` finds N's transcript from the boundaries row, not the entries row. The plan prescribed `asOfCutOf`'s SQL as `JOIN transcripts t ON t.transcript_pk = e.transcript_pk` with `:tpk` bound from `e.transcript_pk`, the entries row's column. Measured: the two columns are written independently and can diverge. `ENTRY_UPSERT`'s `ON CONFLICT(uuid)` never updates `entries.transcript_pk` (sweep.mjs), and `replayBoundaryRow` takes the boundary's transcript from the export record's (cc_session_uuid, agent_id) but finds the entry by uuid alone, so an entry stored first under one transcript can gain its boundaries row under another. derive.mjs keys on the BOUNDARIES row's `transcript_pk` throughout: `todo` filters the main transcript (`agent_id = ''`) on `b.transcript_pk`, `holdingCopy` picks among `s.files.all(b.transcript_pk)` and `insNode` stores `b.transcript_pk`, which `producerOfLeaf` then reads as `n.transcript_pk`. With the entries column, `asOfCutOf` looked for N's holding copy among the files of a transcript derivation never spanned N in: a spurious `asof-invalid` when no file there holds N, another copy's file and line when one does, and the `main` test answered by the wrong transcript's `agent_id`. Now `asOfCutOf` selects `bd.transcript_pk`, joins `transcripts` on it for `main`, and binds it as the files query's `:tpk`, so the cut's holding copy is the one derivation's `pickHoldingCopy` picks (Review Focus 3). No other column changes: the entry, its summary and kept(N) are still read as before. Pins: history-recall's cut-A7 plants a boundary whose `entries.transcript_pk` names another main transcript, first with no file there holding N (the old code answered `asof-invalid`), then with a file there holding N too (the old code would pick that file), and asserts the cut deep-equals the one measured on the boundaries row's transcript, with CONTROLs that the columns agreed at first, that the plant took, and that the restored store cuts again; mutants M4 (both uses of `e.transcript_pk` restored) and M5 (the `:tpk` bind alone restored) of the fix wave are red under it.
- **D-6282** — `history-w2-asof-leaf-summary-row` (whole-branch review; W2-D35, R4): a leaf other than N's is visible iff its boundary entry is visible AND, when it has a summary row, that row is visible. The door is `asOfHiddenNodesSql`, hence every read of a node: describe, tree, grep's leaf header and `--node`, expand, and the prefix and scope rules. The plan prescribed W2-D35's rule as written, "a leaf iff its boundary entry", which left a visible leaf whose summary row the cut hides printing that row's text (describe's gist, excerpt and `--full` pages, tree's gist, grep's leaf header and the leaf's model and meta refs) while grep and expand treat the row as absent (the finding: a compaction whose summary row is stamped after T_N, has no stamp, or sits outside N's holding copy). "Its summary row" is summaryRowFor's pick over the leaf's holding copy, the rule derivation and `asOfCut` use. Measured: it is identifiable from stored columns with no schema change and no re-derivation per read: the holding copy is pickHoldingCopy's over the files of `boundaries.transcript_pk` that hold the boundary (live first, then the lowest `file_id`), and the row is the `boundaries.anchor_uuid` row among that copy's memberships (an echo row, `user` with provenance `harness`, never), or, when the anchor names the boundary itself, the first non-echo compact summary after the boundary in it; in the D-6282 fixture (one transcript, one file) each derived leaf's `summary_blob_id` is the `blob_id` of the row the fixture names as its summary, which pins that fixture against derivation and nothing about the copy order. A leaf with no pick (a raw leaf) is judged by its boundary alone, as before (D-6284 narrows this: a leaf whose stored `summary_blob_id` is not NULL is hidden when its pick is NULL), and N's own summary stays exempt through `asof_summary`, unchanged: N's leaf is skipped by the arm. Parents and epochs follow by the existing rules. The code: two CTEs, `asof_hold` and `asof_pick`, and one clause in the leaf term of the HAVING, in lib's one statement (the rule stays in lib; the predicate is reused). This is the coordinator's ruling in the operator's place under the directive of 2026-10-19 (the answer to the worker's mail 7893). The pick itself is pinned apart from the statement: history-lib's seeded equivalence case builds 250 stores (about 730 leaves; several files per transcript, live and retired, divergent memberships, anchors none, empty, self, other, echo and missing) and holds `asOfSummaryPickSql`, the same CTE text, to `pickHoldingCopy` plus `asOfCut`'s `summaryRowFor` pick on every leaf; the review-fix mutants M18 (live copy ranked last), M19 (highest file_id first), M20 to M26 (the self arm's line test and echo test, the anchor arm's echo test, the summary order, the holding test, the transcript join, the compact-summary test) are each red under it. Pins of the statement's arms: history-recall's D-6282 describe (a family of four compactions, ASOF = the fourth: leaf 1's summary row without a stamp, leaf 2's stamped after T_N, leaf 3's before, N's after and exempt): tree, describe by id and by prefix, grep's leaf header (the row groups under the live tail), `--node` and expand are exit 3 or absent for leaves 1 and 2, with CONTROLs for no cut, for a summary stamped at or before T_N, for a leaf with no anchor, for an anchor on the boundary itself and for an echo row; the fix wave's mutants M9 (the summary clause dropped), M13 (the anchor-on-the-boundary arm dropped), M14 (the echo test dropped) and M10 (N's exemption dropped, red in the no-summary case of the node rule).
- **D-6283** — `history-w2-asof-leafless-descendant` (whole-branch review; W2-D35, R4): a node is hidden under any cut when any condensed node at or below it has no leaf below it. This is R4's test applied to every descendant, not only the top. The door is `asOfHiddenNodesSql`: describe, tree, `--node`, expand, the prefix and scope rules, and with them the refs and rolled-up text a hidden node prints. The plan hid a leafless condensed node itself (R4) but judged a parent only by its leaves, so a parent over a leafless condensed child stayed visible on its other leaves and printed that child's rolled-up gist, topics and refs (`parentRollup` takes each child's text). Measured: the form "a condensed node with no `node_children` rows" is not the same as "no leaf below it" on this store, whose constraints allow a cycle of condensed nodes (`node_children` is keyed on the pair alone) and a chain ending in a childless condensed node, so the code uses the semantic form: a recursive `asof_up` walks from the leaves of the walk down, kept to its nodes, and a condensed node in the walk that it does not reach has no leaf below it. A cycle with no leaf is hidden, with everything over it. The Task 3 expectations changed: the ASOF=8 tree case now hides P (P sits over the leafless EMPTY) and the describe, parent_id and mined-ref expectations for P under that cut moved with it, each with a CONTROL on the same tree with EMPTY taken away, where P is visible under the cut; childRowsOf's filter has no visible parent left to act on and stays as defence in depth. This is the coordinator's ruling in the operator's place under the directive of 2026-10-19 (the answer to the worker's mail 7893). Pins: history-recall's D-6283 case (a grandparent over P over EMPTY, and a node over leaf 1 and a leafless two-node cycle: all hidden under ASOF=8 at describe, expand, `--node` and tree, visible with no cut and visible under the cut once the leafless parts are removed) and the flipped ASOF=8 tree case; the fix wave's mutants M11 (the arm dropped), M12 (the childless-node form in its place, red on the cycle) and M16 (the walk up cut off).
- **D-6284** — `history-w2-asof-leaf-stored-summary` (review 778, F2; W2-D35, D-6282): under a cut, a leaf other than N's is also hidden when its stored `nodes.summary_blob_id` is not NULL and either its read-time pick (`asof_pick`) is NULL or the pick's entry carries another `blob_id`. N's own leaf stays exempt, as under D-6282; a leaf whose `summary_blob_id` is NULL keeps D-6282's rule (judged by its boundary, and by its pick's visibility when it has one). The door is `asOfHiddenNodesSql`, hence every read of a node. What the read doors print comes from the derived row: `summaryOf` (recall.mjs) reads the STORED `nodes.summary_blob_id`, and describe's excerpt and the `--full` pages come from it; describe's gist, tree's `nodeLine` and grep's leaf header print `nodes.gist`, which derivation writes from the same pick (corrected in place by the coordinator's ledger PR, 2026-10-22, review 791 F-C: this entry said describe's gist and excerpt, tree's `nodeLine` and grep's leaf header all come from the stored blob). D-6282 judged the leaf by the pick it re-computes at read time, so when the pick came back NULL the leaf was judged by its boundary alone and failed open, printing text from a row the cut hides. The review's scenario: leaf L is derived from copy F_a, which holds its summary row S, stamped after T_N; derive.mjs never re-derives a boundary that has a node; later the sweep retires F_a on an inode recycle and ingests a live copy F_b that holds the boundary but not S; `asof_hold` now picks F_b, `asof_pick` is NULL, L is visible under N and prints S's text. The ruling (the coordinator's, in the operator's place under the directive of 2026-10-19, mail 7966, extending ruling 7894's L2 and D-6282) closes it fail closed rather than naming it a residual. The blob half (a pick that names another blob) was licensed only if two facts hold, each measured at 9fe784454 and re-verified by one grep each at this commit. (1) Derivation stores exactly the picked entry's `blob_id`: derive.mjs's `copyRows` selects `e.blob_id`; `copyPlan` fills `copy.picks` with `summaryRowFor` over the holding copy; `deriveOne` reads `copy.picks.get(b.uuid)`; `leafFields` takes `summary = copy.rows[copy.index.get(pick.uuid)]`; and the leaf insert writes `summary === null ? null : summary.blob_id` into `summary_blob_id` (about :428); `parseFailedFields` uses the same pick; the condensed insert (about :611) writes NULL. (2) Nothing moves either value afterwards: no `UPDATE nodes` in `ccd/history` sets `summary_blob_id` (derive.mjs `setParent`, the parse-failed rewrite whose comment says `summary_blob_id` stays, reparse's kind, status and gist rewrite and the topics rewrite; sweep.mjs's `session_pk` merge), and no statement sets `entries.blob_id` after the insert: `ENTRY_UPSERT`'s `DO UPDATE SET` omits `blob_id` (D-4346's comment: it keeps its first `blob_id`), and every other `UPDATE entries` sets only `exported_ms` and `exported_seg`; reparse and the re-clean and recover paths write no node or entry blob column. The code is one more AND term in the leaf term of the HAVING in lib's one statement, inside the existing `NOT coalesce((…), 0)` (the predicate stays three-valued safe); `ASOF_PICK_CTES` and `asOfSummaryPickSql`'s columns do not change. One existing D-6282 CONTROL changed with it: the raw-leaf and echo-anchor shapes now take leaf 2's stored summary away first, since a leaf that keeps its stored summary while its pick goes is exactly what this rule hides, and each shape has a CONTROL with the summary kept (hidden). Pins: history-recall's D-6284 describe, nested in the D-6282 describe for its fixture: leaf 3 visible under N before the plant and with no cut, then hidden at describe, tree, `--node`, expand and a grep hit with its gist printed nowhere, in two planted states (F_a retired and a live copy without S, so the pick is NULL; a self-anchored leaf whose live copy holds another non-echo compact summary stamped at or before T_N, so the pick is shown and names another blob), each with CONTROLs on the pick and the stored blob; history-lib's seeded equivalence case now gives its entries a `blob_id` (shared across entries) and its nodes a `summary_blob_id` written by derivation's rule from the JS pick, and asserts the SQL pick's entry carries the stored blob on every leaf. Mutants, measured: D1 (a NULL pick passes) is red at the first planted state and D2 (the blob comparison dropped) is red at the second, each at its own case alone; M9 (the D-6282 pick-visibility term dropped) is red at three D-6282 cases and at the F7 case below; M18 and M23 are still red at the seeded case. Review 778's F7 is pinned beside it with no new rule: a leaf whose summary row sits outside N's holding copy (a second copy holds it; N's copy holds neither the boundary nor the row), stamped after T_N, is hidden under N at the same doors, and shows with the row stamped at or before T_N.
