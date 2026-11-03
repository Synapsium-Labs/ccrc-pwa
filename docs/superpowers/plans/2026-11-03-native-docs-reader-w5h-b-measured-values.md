# Native Docs reader, wave 5h-b — the measured values, then part 1's highlight bounds retired Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 1 (2026-11-03): drafted at base `ecba5ee6f85b18a4a7d40e9f8f33e1c00b67b9a4` (`origin/main`, 2026-11-03, after W5h-a #2161, Share #2145 and the scan-timeout fix #2192), from R19 as the operator ran it on 2026-11-03. Export (run 1368) is being dispatched from its approved plan (`docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`, on the ledger branch at drafting). Approved by the operator on 2026-11-03 with every recommendation (see "Where things stand").

**Revisions:** rev 2 (2026-11-03) applies review round 1 (nine findings upheld) and the coordinator's sequencing ruling: W5h-b is dispatched only after Export has merged, so BASE becomes `main` at dispatch and Export's anchors are BASE text then (Base, How this wave runs; the dispatch-now path and its question are gone, Q1-Q4 remain). Also: the stale part-1 prose in `highlighterContext.ts` and in `markdown.tsx`'s header (Task 3); a row for `part1-bounds` planted back in `EXPORT_PLAIN_SENTENCE` and a row that re-inserts a per-block bound (Task 3); `boundedCap` in Task 3's grep (seventeen names); an explicit step that measures Task 3's rows; the `markdownLimits.ts` section header names the two departures; the row-text rule admits a unique mid-line fragment; Q1 says which pages may still colour partly.

**Scope:**
- In: the seven W5h constants set from R19, each with its basis (M4.H22 at the measured values; Task 2); Export's longest wait derived from §4.10's sum at those values and pinned; the over-cap cases W5h-a kept plain (its D-7757) revisited at the measured HTML cap; then, in a commit of its own, all of W5 part 1's main-thread highlight bounds retired, with their labels, their data in `highlightNames.ts`, their mutation rows re-pointed, and Export's `part1-bounds` word removed (M4.H23; Task 3); the xml subLanguage strip, `MD_HIGHLIGHT_BLOCK_MAX_CHARS` and `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` kept and re-argued; the two minor test gaps review run 1366 carried from W5h-a (F3, F4; Task 1).
- Out: any change to the runner, the store's design, the worker, the check or the sink (W5h-a's, unchanged); the per-job overhead R19's item 5 shows (a Later item, see "R19, as measured"); changes to R19's page beyond what the retirement forces (it stays shipped); Export's own work; W5b, W6, W7, W8b; a highlight.js version change; the spec and the ledger (the coordinator's ledger PR records the values and numbers the departures).

**Goal:** The highlight worker's deadline, boot budget, ceilings, HTML caps and stream debounce hold values measured on the operator's phone, each with its basis in `lib/markdownLimits.ts`. Then nothing of W5 part 1's main-thread highlight bounds is left in `pwa/src`: no word, line or whitespace scan, no per-grammar block cap, no scan or markdown page budget, no label or skip word for them. The worker's per-block deadline and the store's page ceilings are the only time bounds, as §0 `offthread-highlight` ruling 3 decided.

**Architecture:** No new module. Task 1 pins the output ceiling's `<=` from both sides and makes a dead assertion live. Task 2 edits seven declarations and their docstrings in `markdownLimits.ts`, pins the measured values, the retirement gate and Export's longest wait in `markdown-limits.test.ts`, and moves the cases whose 64 KiB blocks now fit the HTML cap back to colour. Task 3 deletes part 1's bounds where W5h-a left them: `highlightStore.ts#blockKey`'s `part1` parameter and arm, `seed`'s two sub-budgets, the `part1` store option and the `part1-scan`/`part1-markdown` skip words; `highlightNames.ts`'s banner section and its import (it then imports nothing); `highlightGrammars.ts#deriveBoundedCaps` and `embeddedGrammars`; `markdown.tsx#codeBlockLabel`'s `part1` arm and its bare-label exception; the seven constants in `markdownLimits.ts`; R19's `part1: false` options; and, Export being on `main`, its `part1-bounds` word. A new clause in `docs-scans.test.ts` (M4.H23) holds the result.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`, `noUnusedLocals` on), React 19, vitest 5 on jsdom, highlight.js 11.12.0 (no change), Node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`: §0 `offthread-highlight` (rulings 1-5, the coordinator's a-e); §4.9's table (the seven W5h rows, `MD_HIGHLIGHT_BLOCK_MAX_CHARS`, `DOCS_HIGHLIGHT_PAGE_MAX_CHARS`), "What the highlight limits bound" and "W5 part 1's highlight bounds under W5h"; §4.10 "Highlighting", "Page ceilings", "Export's longest wait", "`CodeBlock`" (the label table), "The main thread's worst case" and "What W5h changes in these bounds"; §7.7's W5h-b row; §7.8 R19 ("What it decides", "The retirement gate"); §7.9's W5h-b suites; §7.10's W5h rows (M4.H22, M4.H23, and the re-pointing paragraph).

**Ledger:** `docs/superpowers/programs/native-docs-reader.md`: Waves row 5h-b; Decisions 2026-11-03 (W5h-a accepted; "Two minor test gaps are carried to W5h-b"); Decisions 2026-11-02 (the operator's approval: R19's retirement bound is 2 s; dense JSON or YAML plain until W5h-b; R19's item 8 at three fixed cadences, from which W5h-b sets the debounce); "Next-wave brief (W5h-a and Share)"'s W5h-b bullet.

**Format:** Markdown, by the operator's ruling of 2026-10-07. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 5's tools parse this file's `### Task` headings and the JSON row fences each task records.

**What changed at BASE since the spec was amended (each checked at BASE, each handled below):**
- **W5h-a moved part 1's bounds, it did not delete them.** At BASE they sit in `lib/highlightStore.ts` (`blockKey`'s `part1 = true` parameter and its four checks; `seed`'s scan and markdown sums; the `part1` option; `SkipCeiling`'s `part1-scan` and `part1-markdown`), `lib/highlightNames.ts` (the banner "Until W5h-b": `HIGHLIGHT_BOUNDED_CAPS`, `highlightBlockCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `longestWordRun`, `longestLine`, `longestBlankRun`, and the import of three limits), `lib/highlightGrammars.ts` (`deriveBoundedCaps`, `embeddedGrammars`), `lib/markdown.tsx` (`codeBlockLabel`'s `part1` arm and its bare label for a `part1-*` skip), `lib/markdownLimits.ts` (the seven constants and the residual note on `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`) and `screens/highlightMeasureRun.tsx` (`part1: false` three times). `detachUrls` holds none of them any more. Task 3 deletes each.
- **Part 1's rows were re-homed by W5h-a.** Part 1's plan lists the rows of each bound under its "The six bounds"; their code moved, and W5h-a's rows W5HA-T10-A7 to A14 and W5HA-T2-M5 supersede the ones that no longer anchor. Task 3 retires both sets and re-points them ("Rows retired and re-pointed", below).
- **Export's approved plan adds `part1-bounds`.** Its `ExportPlain` word, its sentence in `docsText.ts`, and `docs/export/colouring.ts`, which reads `BlockKey`'s `part1` arm and the `part1-scan`/`part1-markdown` skip words (its refinement (t): "`part1-bounds` goes with W5h-b (M4.H23)"). Once Task 3 deletes that arm and those words, Export's code no longer typechecks, so W5h-b lands after Export and removes the word itself, as M4.H23's Export clause says. Those files are not at this plan's drafting base: their anchors below are quoted from Export's approved plan. W5h-b is dispatched only after Export merges (the coordinator's ruling), so they are BASE text at dispatch, re-checked at Task 1 Step 0 against `main` at dispatch and again at Task 3 Step 0.
- **The xml strip has no measured row at its W5h-a home.** Part 1's rows for it (W5P1-T13-M76, W5P1-T13-M81) anchor in `markdown.tsx`, which no longer holds it; no W5h-a row targets `highlightGrammars.ts#xmlWithoutSubLanguages`. Task 3 adds two (M4.H23).
- **One test hard-codes the provisional worker-time arithmetic.** `highlight-store.test.ts`'s "five 700 ms jobs answered back to back: the fifth is skipped by page-worker-time 200 ms into its run" assumes `HIGHLIGHT_PAGE_WORKER_MS = 3000`. Task 2 derives it from the constant.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). Every test injects its highlighters, its spawn, its clock and its parser; no test reaches a real server or a real `Worker`.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); this wave changes no `package.json` and no lock. The only transient files are Task 2 Step 0's throwaway measuring test (deleted in the same step), `docs-scans.test.ts`'s tree copies (removed by its `afterAll`) and the built-output tests' own `mkdtemp` builds. Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/w5hb-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/w5hb-mut/` is removed at Task 5.
- **Scope.** W5h-b creates no file. It edits `pwa/src/lib/{markdownLimits,highlightNames,highlightGrammars,highlightStore}.ts`, `pwa/src/lib/highlighterContext.ts` (one docstring only), `pwa/src/lib/markdown.tsx`, `pwa/src/screens/highlightMeasureRun.tsx`, `pwa/test/{markdown-limits,highlight-store,highlight-names,docs-scans}.test.ts`, `pwa/test/{markdown-highlight,markdown-bounds,docs-highlight-budget,docs-markdown}.test.tsx`, and, Export being on `main` at dispatch, `pwa/src/docs/export/{policy,colouring}.ts`, `pwa/src/docs/docsText.ts` and `pwa/test/docs-export.test.tsx` (each only to remove the word `part1-bounds` and what reads it); and this plan (Task 4 defines `## Deviations found`, Task 5 appends `## W5h-b results`). Byte-identical: `shared/**`, `server/**`, `agent/**`, `ccd/**`, `deploy/**`, `ui/**`, `.github/**`, `pwa/package.json`, `pwa/package-lock.json`, `pwa/vite.config.ts`, `pwa/index.html`, `pwa/src/lib/{markdownRunner,markdownWorker,markdownHighlightWorker,highlightJob,highlightProtocol,highlightCache,markdownParse,markdownGuard,useParsedMarkdown}.ts`, `pwa/src/lib/renderHast.tsx`, `pwa/src/screens/HighlightMeasure.tsx`, `pwa/src/session/**`, every other file under `pwa/src/docs/**`, `pwa/test/highlightTestStore.tsx`, `pwa/test/highlight-measure.test.tsx`, `pwa/test/golden/**`, `README.md`, the specs, the ledger and every other plan. Any other file is a stop-and-ask. One allowed exception, claimed first: if the CI selection or Task 5's full server run reds a census in another programme's file that this wave's edits trip (as `update-move.test.ts` and `delegation-wave3.integration.test.ts` did for W5h-a), the worker stops and asks the coordinator, who rules on that file.
- **Base.** W5h-b is dispatched only after Export (run 1368) has merged (the coordinator's ruling, 2026-11-03), so BASE is `main` at dispatch: it holds `ecba5ee6f85b18a4a7d40e9f8f33e1c00b67b9a4` (this plan's drafting base) and Export. Every anchor this plan quotes from Export's approved plan is BASE text then, and is re-checked against `main` at dispatch in Task 1 Step 0 (`T1-BASE-OK` covers Export's anchors too); Task 3 Step 0 checks them again before it edits (`T3-EXPORT-ON`), and a mismatch there is a stop-and-ask. Task 1 Step 0 runs a **content** check, not an ancestry check. BASE is recorded in the gitignored SDD ledger `.superpowers/sdd/2026-11-03-native-docs-reader-w5h-b/progress.md`.
- **Rings and seams.** No file changes ring. `highlightNames.ts` stays L1 and, after Task 3, imports nothing (base spec §4.10's Files table: "`markdownLimits.ts` only, until W5h-b; nothing after"). `highlightStore.ts` stays L1: it keeps taking its clock and highlighter as arguments. No overloaded `null` is added; `BlockKey`, `SkipCeiling` and `HighlightStoreOptions` only lose members.
- **Exact values.** Declared once, in `pwa/src/lib/markdownLimits.ts` (Task 2): `HIGHLIGHT_BLOCK_DEADLINE_MS = 750`, `HIGHLIGHT_BOOT_BUDGET_MS = 2000`, `HIGHLIGHT_PAGE_WORKER_MS = 12000`, `HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2`, `MD_HIGHLIGHT_MAX_HTML_CHARS = 1048576`, `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152`, `HIGHLIGHT_STREAM_DEBOUNCE_MS = 150`; each docstring starts `MEASURED (W5h-b, R19 of 2026-11-03).`. Kept unchanged: `MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536`, `DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524288`, `HIGHLIGHT_LINE_RETRY_UNITS = 256`, `HIGHLIGHT_CACHE_MAX_ENTRIES = 256`, `HIGHLIGHT_CACHE_MAX_CHARS = 4000000`, `MD_KEYSTROKE_MAX_CHARS = 64`. Deleted (Task 3): `MD_HIGHLIGHT_MAX_WORD_CHARS`, `MD_HIGHLIGHT_MAX_LINE_CHARS`, `MD_HIGHLIGHT_MAX_BLANK_CHARS`, `MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS`, `MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS`, `DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS`, `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`. Export's longest wait at these values is 18 750 ms (§4.10's sum; `markdown-limits.test.ts` holds it). R19's own figures live only in this plan and in the docstrings' bases; the two that a test holds (the gate's 96.1 + 143.7 ms and the operator's 2 000 ms) are written in that test as R19's measurement and the operator's ruling.
- **Never spelled by this wave:** from Task 3 on, any retired identifier anywhere in `pwa/src`, comments included (the seven constants; `HIGHLIGHT_BOUNDED_CAPS`, `highlightBlockCap`, `boundedCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `longestWordRun`, `longestLine`, `longestBlankRun`, `deriveBoundedCaps`, `embeddedGrammars`; the word `part1` in any form); a second declaration of a limit, or a limit's value spelled at a use site; the stems the delegation census refuses in `pwa/src` code (`retain…`, `lease`, `adopt…`, `carrier…`, `dispos…`, `spool`; write "kept" or "stays"), and a quoted `'detach'` outside `markdownRunner.ts`'s `abortRunning` lines; the standalone docs server's lower-case name or directory name anywhere in `pwa/src`, in this plan's code or in a comment (write "the shared Markdown library"); real host, user, project, pool, account or path names; any R19 figure that names a project, a path or a document (R19 reports none; the device's model is named in this plan only); a `D-` number outside `## Deviations found` except the issued ones quoted from BASE (W5h-a's D-7755, D-7756, D-7757, D-7762, D-7763; `docs-highlight-budget.test.tsx`'s own D-7574); a `D-TBD` token in any commit (`server/test/dtbd.test.ts`).
- **PUBLIC REPO.** `Synapsium-Labs/ccrc-pwa` is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 5 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block below is quoted from BASE (or, for Export's files, from Export's approved plan: BASE text at dispatch, re-checked at Task 1 Step 0 and Task 3 Step 0) and must match exactly once; if it is absent or matches twice, stop and ask the coordinator. Cite code by `file#symbol`, never by line number. A later task that re-spells anchored code re-anchors the earlier row under the same id.
- **File-shape invariants are judged NET against BASE.** Counts a step relies on are re-derived at that step, never carried from planning.
- **Text-scan guards** use the TypeScript AST, or say "NOT EXHAUSTIVE" and list their known evasions in their header. M4.H23's retired-word scan reads text on purpose (a retired name left in a comment is a name left behind) and lists its evasion.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and records the measured rows as ONE JSON fence (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`) in the SDD ledger at its last step; Task 5 copies every fence into `## W5h-b results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `W5HB-T<n>-M<k>`; `spec` carries the spec's row id (M4.H12, M4.H22, M4.H23) where there is one. A row's `old` and `new` quote the file's own text: a single-line row from its first non-blank character, or a fragment of one line that occurs exactly once in the file (as W5h-a's measured rows did, W5HA-T5-M6's `(!capped || outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS)` among them); a multi-line row carries the file's indentation after each `\n`. Every row names its expected failing test file(s), the failing case(s) and a count. **A stated count is a prediction**: W5h-a and Share both measured rows above their predictions when a later task's or a fix round's test aimed at the same line also went red (ledger, 2026-11-02). A row whose measured red differs from its stated red is reported to the coordinator with the extra test names; the coordinator restates it, which takes no number. A row that stays green is a stop-and-ask.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, built-output tests, the browser file, mutation runs) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `typecheck-tests`, `fleet-screen`, `session-hook`, `ccd-*`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` (pwa's tsconfig includes `test/` and has `noUnusedLocals`, so an import a deletion leaves unused fails it).
- **Deviations.** The plan's body and tasks spell no new `D-` number; a departure is named by its refinement letter. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 4's last step defines them in `## Deviations found`. An issued number that goes unused is written without its prefix ("Issued and unused: 7xxx to 7yyy"), because `deviation-refs` reds any tracked file naming a `D-<n>` above `main`'s highest defined number. A session that cannot reach the allocator writes `D-TBD-<slug>` in its report only, never in a commit.
- **Lessons from W5h-a, Share and Export's planning (2026-11-03), applied here.**
  - **The PR's CI selection runs server suites a hand-picked list misses**, other programmes' closed word censuses among them (`update-move.test.ts`'s `'detach'`, `delegation-wave3.integration.test.ts`'s `retain` stem). Task 5 runs the WHOLE `server` suite in pieces before the push, not a list; a red census outside this wave's files is a stop-and-ask (the Scope exception).
  - **The browser legs skip on a fast pull request and first run in the merge queue.** Task 5 runs `browser/tool-well-colour.browser.test.ts` (it waits for a tool well's colours, which the debounce and the HTML cap reach) locally and records the count; the PR body says the leg first runs in the queue.
  - **`deviation-refs` reds an unissued number**: see "Deviations".
  - **Mutation counts are predictions**: see "Mutation-table discipline".
  - **A held highlighter is released only after its request arrives** (#2192): a case that holds `inThreadHighlighter({ hold: true })` and then releases first waits with `await waitFor(() => expect(h.calls).toHaveLength(n))`. This wave's new held cases never release; they wait for the request the same way before asserting.
  - **A `docs-scans.test.ts` describe that copies `pwa/src` carries `{ timeout: 30_000 }`** (#2192). Task 3's clause does.
  - **No crafted shape runs through highlight.js in-thread in a test** (W5h-a's first CI run: two R19 cases timed out at 92 s doing so). Task 3's re-pointed cases hold the highlighter and assert the request, never the colour.
- **Carried items** (the ledger's "Carried constraints" and the two plans' "Carried, not fixed", in substance; none is fixed here unless named):
  - From W5h-a, for W5h-b: F3 and F4 (Task 1); the seven values and the retirement (Tasks 2 and 3); the `HIGHLIGHT_CACHE_MAX_CHARS` docstring's lost sentence ("at most twice the bound plus per-entry overhead"; restored in Task 2, the file being edited anyway).
  - From W5h-a, named by Export's plan as W5h-b's: "the store stops its clock when a posted job is detached, while the runner keeps the worker on that job for up to one deadline". **Not changed, by design:** §4.10's page-ceilings table says of worker time "a detached job stops counting when it is detached", and §4.10's sum for Export's longest wait already counts the one detached predecessor that can hold the FIFO for at most one deadline.
  - From W5h-a, not W5h-b's: the scan residue (the sink name as a string argument, `new globalThis.URL`, the `@/` alias); the test-double fidelity note; the future-grammar underscore note; M4.H14's step count. R19's 1-px host is read into item 4's and item 5's figures below, and its fix is a Later item.
  - W8a's residue is W8b's; W3's, W2's, W4's, SEC-3/SEC-4, U5 and the W7 prose residue stay with the waves the ledger names.
- **Commits.** One per task, files staged by name, message `<area>: <what> (docs W5h-b)`, ending with the `Co-Authored-By:` trailer the dispatch gives. **Task 3 is ONE commit** (the spec's "in a commit of its own"); Task 4's fixes are one commit per finding. Commits go on the workspace branch, never a feature branch. Only Task 5 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR, which records R19's result and this plan in the ledger and the operator's answers to Q1-Q4. The departing refinements ((b) and (c)) stay plan-only unless the operator asks for the spec's §4.9 rules to be amended in place.
- **The run row and the issued block.** The coordinator opens W5h-b's run row (`planned`) and is issued a contiguous deviation block by `POST /api/ledger/deviations` at run-open, at least six numbers: two for the departing refinements (b) and (c), in that order, the rest for departures found while executing and in fix rounds. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main`.
- **Order: after Export merges** (the coordinator's ruling, 2026-11-03). Export's `docs/export/colouring.ts` reads `BlockKey`'s `part1` arm and the `part1-*` skip words, and Export's word list holds `part1-bounds`; Task 3 deletes the first two, so a W5h-b that landed first would leave Export's branch failing its typecheck on its merge of `main`, mid-run, against its approved plan. Landing second, W5h-b removes the word itself (M4.H23's Export clause). The run opens, and its workspace is minted, only once Export's PR has merged.
- **Files Export also edits:** `pwa/src/lib/markdown.tsx` (Export lifts `codeBlockParts` out of `CodeBlock`; W5h-b edits the header comment and `codeBlockLabel`, about forty lines above: separate hunks), `pwa/test/docs-scans.test.ts` (each appends one clause at the end: the second lander keeps both), and, after Export, its own `docs/export/policy.ts`, `docs/export/colouring.ts`, `docsText.ts` and `docs-export.test.tsx` (Task 3's Export step). W5h-b edits none of `DocMarkdown.tsx`, `DocsLeaf.tsx`, `DocsHead.tsx`, `DocsScreen.tsx` or the census tests.
- **Claims** are checked at dispatch and again in Step 0 of each task: every file in Scope. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-5, the base, the issued block, the claim state, Export's state, and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers, effort `high`; an `opus` per-task reviewer for Task 3 and a `sonnet` one for Tasks 1 and 2; the whole-branch panel on `opus` (Task 4) with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill (kill only recorded PIDs), any `gh` write verb, any token in an argv, approval-prompting shell forms, and a `CCRC_SW_DENYLIST` covering `/docs`.
- **Worker flow:** the worker acks, runs Tasks 1-3 with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalations to the operator: none planned. A measurement this plan branches on that lands outside its branches (Task 2 Step 0's HTML lengths; Task 1 and Task 3 Step 0's Export anchors and hits) is a stop-and-ask to the coordinator. Task 4 is the held-out whole-branch review and its fix wave. Task 5 closes: the suites, the browser file, the whole mutation table, `## W5h-b results` (that commit is the `handoffCommit` and the tip), push, the ONE pull request, the fingerprint with that PR's number and `prPhase: 'open'`, and the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming five lenses: (1) the values (each against R19's items and §4.9's rule; the gate; Export's longest wait; the reading of item 5); (2) the retirement's completeness (no part-1 bound, label, skip word or helper left in `pwa/src`; the xml strip and the two input caps kept and re-argued; the residual note rewritten; Export's word gone); (3) the tests (each deleted case is a part-1 case; each re-pointed case proves the bound is gone without running a crafted shape in-thread; the over-cap cases routed by measured length; F3 and F4); (4) the mutation table, the re-anchored W5h-a rows and the retired-rows table; (5) spec and deviation fidelity, plus the public-repo scan.
- **Merge gate** (§7.7's W5h-b row): R19 run on the operator's phone, and its values stated in this plan (done: "R19, as measured"); the retirement commit lands only because R19 shows every real block, cold, inside a deadline set no higher than the operator's 2 s bound (the gate PASSES, below); every row named in §7.7's W5h-b row green (M4.H22 at the measured values, M4.H23, part 1's retired rows re-pointed); the reviewer's report accepted by the coordinator; the PR's required checks green (a change to `pwa/src` and `pwa/test` only, so the PR runs its selection; `test (pwa)` and `build-pwa` run in full); `browser (pwa)` green in the merge queue. No R1/R2 gate: no server route changes.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel); the coordinator or operator rolls it out fleet first (`ccrc rollout --to vX.Y.Z`; PWA only). W8 may now start whenever its other dependencies hold (it follows W5h-b). The measurement page stays; a later re-run of R19 is the Later item below.

## Review Focus

The untrusted inputs a person meets first, and what this wave changes about them:

| Input | What could go wrong | Pinned by |
|---|---|---|
| A crafted code block on a Docs page or in a chat message | With part 1's main-thread scans gone, a shape they refused now reaches the worker; if the worker path regressed, the main thread would freeze or the page would never settle | M4.H7's deadline (W5HA-T4-M1, unchanged), M4.H12's ceilings (W5HA-T5-M5 to M8, re-anchored where Task 3 moves their text), and Task 3's re-pointed cases (each retired shape is requested whole, under its bare label, never scanned) |
| A page of many blocks | A raised worker-time ceiling lets a hostile page keep the docs highlighter busy for up to 12 s; Export waits up to 18.75 s | Task 2's values and their tests (W5HB-T2-M1, M4, M5; the longest-wait pin) and Q1 |
| The worker's HTML | A raised per-block HTML cap lets one block insert up to 1 MiB on the main thread | Task 2 (W5HB-T2-M2, M6) and the unchanged check and length re-check (W5HA-T5-M9, M30) |
| A page whose copies sum to the HTML ceiling exactly | An off-by-one in the output ceiling, unpinned | Task 1 (W5HB-T1-M1, M2) |
| An xml, html or markdown fence holding `<script>` or `<style>` | The strip silently dropped with part 1's bounds, so the quadratic regions return | Task 3 (W5HB-T3-M2, M3) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/test/highlight-store.test.ts`, `pwa/test/docs-highlight-budget.test.tsx` | 1 | — | F4: the output ceiling at its exact boundary; F3: the inserted sum over every drawn copy |
| `pwa/src/lib/markdownLimits.ts`, `pwa/test/markdown-limits.test.ts` | 2 | L1 | The seven measured values and their bases; the gate, Export's longest wait and the two caps' relation pinned (M4.H22) |
| `pwa/test/markdown-highlight.test.tsx`, `pwa/test/markdown-bounds.test.tsx`, `pwa/test/docs-highlight-budget.test.tsx`, `pwa/test/highlight-store.test.ts` | 2 | — | The over-cap cases routed by measured length; the worker-time case derived from its constant |
| `pwa/src/lib/{markdownLimits,highlightNames,highlightGrammars,highlightStore}.ts`, `pwa/src/lib/markdown.tsx`, `pwa/src/screens/highlightMeasureRun.tsx` | 3 | L1 / L4 | Part 1's bounds, labels, skip words, data and option deleted; the kept caps and the xml strip re-argued |
| `pwa/test/docs-scans.test.ts` | 3 | — | M4.H23: no retired word in `pwa/src`, the kept caps read, the xml strip kept |
| `pwa/test/{markdown-bounds,docs-highlight-budget}.test.tsx`, `pwa/test/{highlight-store,highlight-names,markdown-limits}.test.ts`, `pwa/test/docs-markdown.test.tsx` | 3 | — | Part 1's cases deleted; the re-pointed cases; `highlightNames.ts` imports nothing |
| `pwa/src/docs/export/{policy,colouring}.ts`, `pwa/src/docs/docsText.ts`, `pwa/test/docs-export.test.tsx` | 3 | L1 | Export's `part1-bounds` word removed (M4.H23's Export clause) |

## R19, as measured

The operator ran R19 once on 2026-11-03, from Settings › Measure highlighting, on a Pixel 10 Pro XL (Google Chrome, Android 17; the page read `navigator.hardwareConcurrency` as 8), against W5h-a's build with the provisional values (750, 2 000, 3 000, 2, 262 144, 2 097 152, 250). What each item measures is read from `screens/highlightMeasureRun.tsx#runHighlightMeasure` at BASE. Every per-block time below is on the main thread's clock (`performance.now()`), from the job's post to the moment the main thread handles its answer; items 1-5 and 8 run on highlighters of their own with a 60 s measurement deadline and boot budget (`MEASURE_DEADLINE_MS`), no page ceilings and none of part 1's bounds; items 6 and 7 use the shipped deadline, boot budget and ceilings.

**Corpus:** 24 projects; 1 381 documents read, 245 not read (no answer or not a tree); 41 871 code blocks of a registered grammar within the 64 KiB block cap, 57 793 270 characters.

**Item 1** (each distinct block once, posted alone on a warm worker, after one one-character job per grammar compiled it; a repeat is the worker's cache hit, counted, not timed) **and item 3's real ratios** (HTML characters per input character):

| Grammar | Blocks (repeats) | Warm ms p50 / p95 / max | Largest block, cold | HTML ratio p95 / max | Not HTML / over 262 144 |
|---|---|---|---|---|---|
| `typescript` | 20 786 (201) | 0.4 / 5 / 143.7 | 56 070 chars, 96.1 ms | 4.5 / 7.2 | 0 / 0 |
| `bash` | 16 226 (1 393) | 0.2 / 0.9 / 54.4 | 52 256, 21.4 | 3.4 / 8.1 | 0 / 0 |
| `python` | 1 366 (9) | 0.4 / 3.4 / 69.8 | 38 738, 25.7 | 3.4 / 6.4 | 0 / 0 |
| `javascript` | 1 049 (8) | 0.4 / 6.9 / 121.9 | 40 923, 54.0 | 4.8 / 7.6 | 0 / 0 |
| `json` | 843 (24) | 1 / 9.3 / 86.8 | 45 709, 19.4 | 9 / 39 | 1 / 1 |
| `markdown` | 780 (11) | 0.2 / 1.3 / 22.9 | 28 827, 19.4 | 2.3 / 5.6 | 0 / 0 |
| `sql` | 309 (2) | 0.4 / 3.5 / 46.4 | 18 877, 19.2 | 4 / 5.5 | 0 / 0 |
| `yaml` | 194 (5) | 0.3 / 4.4 / 38.2 | 45 118, 29.2 | 4.9 / 6.5 | 0 / 0 |
| `css` | 151 (5) | 0.4 / 3.1 / 18 | 13 375, 26.4 | 4.5 / 5.4 | 0 / 0 |
| `diff` | 75 (2) | 0.3 / 2 / 18.1 | 14 045, 8.8 | 2 / 3.3 | 0 / 0 |
| `xml` | 45 (0) | 0.6 / 1.5 / 11.1 | 2 145, 14.3 | 6.9 / 7.6 | 0 / 0 |
| `php` | 32 (0) | 0.3 / 1.5 / 20.2 | 1 896, 26.5 | 5.4 / 5.4 | 0 / 0 |
| `dockerfile` | 15 (0) | 0.4 / 2.1 / 2.1 | 1 468, 11.4 | 2.9 / 2.9 | 0 / 0 |

The slowest blocks warm: 143.7 ms (`typescript`, 5 734 characters), 121.9 (`javascript`, 7 239), 104.5 (`typescript`, 12 552), 101.1 (`typescript`, 5 058). The list also holds a 122-character `typescript` block at 67.6 ms and a 113-character `python` block at 69.8 ms: those are not highlight.js's time for so little code, but the main thread's or the collector's, which this clock includes. So the warm maxima are upper bounds.

**Item 2, the boot** (a fresh highlighter's first call, which spawns, to that job's post, which waits for `{ready}`): 32.2 ms for the run's first highlighter; 23.4 to 74.4 ms (median 28.1) for the thirteen fresh highlighters item 1's cold blocks spawned. The PWA's service worker precaches the highlight chunk (M7.11 pins its entry), so every one of these boots loaded it from the precache or from memory, not over the network; a boot on a page no service worker controls is not measured.

**Item 3, crafted shapes** (65 000 characters each, `ts-identifier` 32 768, under the measurement deadline): ratios 1 to 3 for most shapes; `rust-raw-string` 8.2 and `yaml-words-line` 17.5, both over the provisional 262 144; `php-identifier` gave no ratio (it did not answer as HTML or as too large within the 60 s measurement deadline).

**Item 4, the main thread's cost of a page's highlight HTML:** 954 real answers, 2 097 145 characters, checked in 20.6 ms and inserted through the one sink and laid out in 255.7 ms, all in one commit (276.3 ms, about 132 ns a character). The host is the page's 1-px hidden element, so the layout half is taken in a container unlike the reader's (W5h-a's "Carried, not fixed").

**Item 5, the largest real page** (the document within the render gate with the most code characters: 238 blocks, 323 842 characters), drawn through `DocMarkdown` on a fresh highlighter, no ceilings: **9 515.6 ms** from the first frame that held the `article` to the first frame at which its published store answered `settled()`.

**Item 6, the crafted shapes under the shipped 750 ms deadline:** nine of eleven timed out at 750.3 to 751.2 ms; `yaml-flow` answered in 154 ms and `xml-script-lines` in 8.6 ms (the xml strip). The main thread's longest frame gap while each ran was 16.7 to 17.2 ms, and 25 ms for the first shape, whose job spawned that highlighter's worker.

**Item 7, the longest wait the shipped ceilings allow:** eight crafted blocks in one Docs store settled in **1 700.2 ms**, against §4.10's sum of 9 750 ms: the first timed out (its line retry answered `line-too-long`: its lines are 2 048 characters), the second coloured, the third timed out, and the timeout ceiling (2) skipped the other five.

**Item 8, a 40-line `ts` fence streamed into `ChatMarkdown`** at three fixed settle cadences (the W5h-a plan's refinement (q), D-7756): requests the growing block made / ms from its fence closing to its colours.

| Settle every | debounce 0 | 150 | 250 | 400 |
|---|---|---|---|---|
| 50 ms | 40 / 0.3 | 2 / 108.3 | 2 / 205.5 | 2 / 385.0 |
| 100 ms | 40 / 0.1 | 2 / 89.7 | 2 / 156.3 | 2 / 321.1 |
| 250 ms | 40 / 0.1 | 40 / 0.1 | 40 / 9.2 | 2 / 162.3 |

### What item 5's 9.5 s holds, and what the shipped ceilings would do to that page

From the code: `until()` polls once a frame, so the interval opens at the first frame whose callback finds the `article` (React has committed the whole page; that frame's style and layout of the page come after the callback, inside the interval) and closes at the first frame after the store settles. Between them: the fresh worker's boot (item 2: under 75 ms); then 238 jobs in one FIFO. `markdownRunner.ts#createWorkerRunner` posts the next job from `finish`, inside the handler of the previous answer's message, so the worker sits idle from the moment it answers until the main thread handles that message: behind the store's check and React's commit of the previous block, and behind whatever frame the browser renders in between (style and layout of a large page, in the 1-px host). That is 9 515.6 / 238 = **40 ms a block**, where item 1 puts a warm block's worker time at a p50 of at most 1 ms and a p95 of at most 9.3 ms in every grammar, and at the cold rate of the largest `typescript` block (56 070 characters in 96.1 ms, its grammar's compile included) the page's 323 842 characters would take about 0.55 s. So most of the 9.5 s is per-job main-thread latency, not highlight.js. R19 does not split it.

The store's worker-time ceiling counts exactly that chain: `highlightStore.ts#onPosted` stops the previous job's clock when the next is posted, so a store's `spent` is post-to-handled time, the main thread's latency included. On the evidence of item 5, at the shipped `HIGHLIGHT_PAGE_WORKER_MS` of 3 000 ms that page would colour about its first 75 blocks (3 000 / 40) and skip the rest as "page highlighting limit". Its other ceilings would not fire: 323 842 characters are under the 524 288 input ceiling; no real block came near the 750 ms deadline, so no timeout; and its HTML, though R19 does not report it, passes 2 097 152 only if its blocks average a ratio over 6.5, which no grammar's p95 but `json`'s reaches. Part 1's bounds, still in force in that build, would also refuse its `typescript` blocks over 8 192 characters and any line over 2 048 (counts not measured).

**Fix now, or Later? Later** (notes Q4). (1) R19 does not separate the latency from the worker's time; a fix needs that split first. (2) Each candidate changes a contract the spec states: the store notifying its subscribers once a frame instead of once an answer (so the browser can handle several answers between renders); a runner that posts ahead of an answer (§4.10's "one job posted at a time", shared with the parse runner and pinned by M4.P6-P8 and M4.H7); or a worker-time ceiling that counts only the worker's own time (it would then no longer bound Export's wall-clock wait). (3) Any of them must be measured again on the phone, which needs a release and an R19 run. (4) Neither the gate nor the retirement depends on it, and the measured `HIGHLIGHT_PAGE_WORKER_MS` below covers that page meanwhile. The Later item: R19's item 5 reports the store's summed post-to-answer time and the page's summed item-1 worker time, draws the page at the reader's width, and also runs the page with the most blocks (not only the most code) and reports each page's HTML; then a design for the latency; then `HIGHLIGHT_PAGE_WORKER_MS` set again.

### The values

| Constant | Provisional | Measured | Basis, by §4.9's rule |
|---|---|---|---|
| `HIGHLIGHT_BLOCK_DEADLINE_MS` | 750 | **750** | Must let the largest real block, cold, finish inside it, and not exceed the operator's 2 s. A block cold costs at most its grammar's compile plus its own highlight; each grammar's compile is at most its largest block's cold time, so no real block cold passes 96.1 + 143.7 = 239.8 ms (even if one block compiled every grammar on first use: 371.8 + 143.7 = 515.5 ms). 750 is about three times 240 ms, room for a slower or busier device and for the main thread's latency this clock counts (item 5: about 40 ms a block on a large page); item 6 shows every growing crafted shape cut there with no frame gap over 25 ms |
| `HIGHLIGHT_BOOT_BUDGET_MS` | 2 000 | **2 000** | The slowest boot measured, 74.4 ms, with headroom: about 27 times. The clock is the main thread's, so a long task when the worker spawns (a large page's first layout, a chat list's first render) delays `{ready}` though the worker is ready, and a page no service worker controls fetches the chunk over the network; neither is measured, and two failed boots in a row leave highlighting off until a reload (refinement (e)) |
| `HIGHLIGHT_PAGE_WORKER_MS` | 3 000 | **12 000** | The largest real page's summed worker time, with headroom. Item 5's 9 515.6 ms is an upper bound on that page's chained post-to-answer time (it also holds the boot, the page's first layout and a frame of polling); 12 000 is about a quarter more (refinement (a), Q1) |
| `HIGHLIGHT_PAGE_MAX_TIMEOUTS` | 2 | **2** | The rule's "smallest count no real page reaches" is 1 (no real block came near the deadline), but at 1 the first timeout latches the store before the timed-out block's line retry is posted, so a large real block that times out on a slower phone could never be coloured line by line. 2 is the smallest count that lets one timed-out block's retry run. **Departure** (refinement (b), Q3) |
| `MD_HIGHLIGHT_MAX_HTML_CHARS` | 262 144 | **1 048 576** | The rule's product, the highest real ratio (39) × 65 536 = 2 555 904, rests on one-token `json` blocks (a lone `,` is a 39-character span). 1 048 576 = 16 × 65 536 admits a 64 KiB block at a ratio of 16, over every grammar's p95 (at most 9) and over desktop polish C7's dense 64 KiB JSON (about 13), and every real block of twelve grammars at their maximum ratio (at most 8.1 × 52 256 = 423 274). At item 4's rate a block at the cap costs the main thread about 140 ms. **Departure** (refinement (c), Q2) |
| `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS` | 2 097 152 | **2 097 152** | The most HTML R19 shows the main thread checking, inserting and laying out within this plan's stated time for one page, 300 ms: item 4 did 2 097 145 characters in 276.3 ms, in one commit (in the reader the same HTML arrives one commit per block). It is twice the per-block cap, so two blocks at that cap fit. "Never less than the largest real page's HTML" is not measured by R19 (refinement (d)) |
| `HIGHLIGHT_STREAM_DEBOUNCE_MS` | 250 | **150** | Item 8: at the 50 and 100 ms cadences 150 makes the same 2 requests as 250 and 400 and colours the closed fence in 108.3 and 89.7 ms, against 205.5 and 156.3 at 250; at the 250 ms cadence every candidate up to 250 asks once a settle, 40 small requests 250 ms apart. Conditional on chat's real cadence, which R19 does not measure (D-7756) |

**Export's longest wait** (§4.10's sum): `HIGHLIGHT_PAGE_WORKER_MS + HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) × HIGHLIGHT_BOOT_BUDGET_MS` = 12 000 + 750 + 3 × 2 000 = **18 750 ms**, up from 9 750. Item 7 measured 1 700.2 ms for a crafted page, where the timeout ceiling fired first; the sum is reached only by a page of blocks that each run just under the deadline.

**The main thread's worst case** (§4.10, stated here as it asks): no highlight.js. Per block it posts at most 65 536 characters and checks and inserts at most 1 048 576 characters of HTML, about 140 ms on the phone measured; per Docs page it inserts at most 2 097 152, 276 ms measured in one commit. Re-renders are at most one per `pre`.

**The retirement gate: PASS.** Every real block, cold in its grammar, finishes within 239.8 ms (515.5 ms on the most pessimistic reading), under the operator's 2 s bound; `HIGHLIGHT_BLOCK_DEADLINE_MS` is 750, between the slowest real block and that bound, and was not raised. Task 3 may land.

### Rows retired and re-pointed

Part 1's rows for each retired bound (part 1's plan, "The six bounds") and the W5h-a rows that superseded them where their code moved. Task 3 deletes the code they mutate; each is retired here, naming the guard that replaces it (§4.9, §7.10). They are recorded in this plan rather than edited into part 1's or W5h-a's plan, which are dated history (refinement (h)).

| Rows | Bound | After W5h-b | Replaced by |
|---|---|---|---|
| W5P1-T3-M1, M2, M3, M4, M13, M15; W5HA-T10-A8 | the word bound (r10) | retired | M4.H7: the per-block deadline (W5HA-T4-M1); M4.H23 (W5HB-T3-M1) |
| W5P1-T3-M16 to M21; W5HA-T10-A9 | the line bound | retired | M4.H7 (W5HA-T4-M1); M4.H23 (W5HB-T3-M1) |
| W5P1-T13-M34 to M38; W5HA-T10-A10 | the whitespace bound | retired | M4.H7 (W5HA-T4-M1); M4.H23 (W5HB-T3-M1) |
| W5P1-T13-M63, M64, M65, M69, M70, M77, M78, M80; W5HA-T10-A7; W5HA-T2-M5 | the per-grammar block caps for `typescript`/`javascript` and `rust`, and their derivation over `subLanguage` | retired | M4.H7 (W5HA-T4-M1); M4.H23 (W5HB-T3-M1, W5HB-T3-M4, W5HB-T3-M8) |
| W5P1-T13-M66, M67, M68, M71, M82 to M87; W5HA-T10-A11 to A14 | the scan and markdown page budgets | retired | M4.H12: the timeout and worker-time ceilings (W5HA-T5-M7, M8) and the input ceiling (W5HA-T5-M5, re-anchored by Task 3); M4.H23 (W5HB-T3-M1) |
| W5P1-T13-M79 | part 1's size label for a block a budget refused | retired | M4.H1's label (W5HA-T6-M4); M4.H23 (W5HB-T3-M6: a skip always says so) |
| W5P1-T13-M76, M81 | the xml subLanguage strip | **kept**; anchors moved | M4.H23 (W5HB-T3-M2, M3) |
| Export's W5X-T3-M6 (the `part1-bounds` count) | Export's word for part 1's bounds | retired | M4.H23 (W5HB-T3-M5, M7) |

W5h-a rows whose text or named case this wave changes, re-anchored under their own ids and run at Task 5:

| Row | Change |
|---|---|
| W5HA-T1-M3 | its red's second case is renamed (Task 2): "M4.H22: the page HTML cap admits M4.H2's eight 60 000-character blocks at 2.90 HTML characters a character, and two blocks at the per-block HTML cap" |
| W5HA-T1-M4 | `old` becomes `/** MEASURED (W5h-b, R19 of 2026-11-03). Chat only:` (→ `/** Chat only:`); red: "M4.H22: each measured value says so in its docstring" |
| W5HA-T5-M5 | `old` becomes `ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS ? 'page-input' : null` (→ `null`); red: 1+ failed, among them `highlight-store.test.ts`'s "INPUT: copies of one block are admitted until their combined length passes the page input ceiling, then skipped as copies; the key is still requestable, one job" and `docs-scans.test.ts`'s "M4.H23: the two caps on input crossing to the worker stay, …" |
| W5HA-T6-M4 | same `old`; red: 1+ failed, among them `highlight-store.test.ts`'s renamed keyOf case and `docs-scans.test.ts`'s "M4.H23: the two caps on input crossing to the worker stay, …" |

## Spec refinements (decided while planning)

Each refinement marked **Departure** contradicts a sentence of the spec and gets one issued number in `## Deviations found` (Task 4's last step), in the order below. The others fill a silence or record a reading of R19.

- **(a) `HIGHLIGHT_PAGE_WORKER_MS` is set from item 5's interval, an upper bound.** What: 12 000 ms, from 9 515.6 ms with about a quarter more. Why: §4.9's rule is "the largest real page's summed worker time on the phone, with headroom"; the store counts post-to-handled time (`onPosted` to `answered`), and item 5's interval is that chain plus the boot, the page's first layout and a frame of polling, so it bounds the chain from above. Two limits of the reading, both Later: item 5's page is the one with the most code characters, and the chain grows with the number of blocks and the page's size, so a page of more and smaller blocks may take longer; and the 1-px host may make each frame cheaper or dearer than the reader's. Cost if wrong (too high): a hostile Docs page or chat message can keep its highlighter busy for up to 12 s before its unanswered blocks are skipped (the main thread stays responsive: item 6), and Export can wait up to 18.75 s. Cost if wrong (too low): the largest real pages colour only partly on a phone like the operator's. Not a departure (Q1 asks the operator to accept the cost).
- **(b) `HIGHLIGHT_PAGE_MAX_TIMEOUTS` stays 2, not the rule's 1.** What: §4.9: "Its value: the smallest count no real page reaches." No real block came near the deadline, so that count is 1. Why: `highlightStore.ts#answered` runs `checkCeilings()` before it starts a line retry, so at 1 the first timeout latches the store and the retry is refused; a large real block that times out on a slower device could then never be coloured line by line, and every unanswered block of its page would be skipped with it. 2 is the smallest count that lets one timed-out block's retry run. Cost: one more timeout and boot before a hostile page's store latches, and one more `HIGHLIGHT_BOOT_BUDGET_MS` in Export's longest wait (2 s). **Departure** (Q3).
- **(c) `MD_HIGHLIGHT_MAX_HTML_CHARS` is 1 048 576, not the rule's product.** What: §4.9: "Its value: the highest HTML ratio R19 measures on real blocks, times `MD_HIGHLIGHT_BLOCK_MAX_CHARS`, with headroom" gives 39 × 65 536 = 2 555 904 and more. Why: the 39 is a ratio of one-token `json` blocks (`<span class="hljs-punctuation">,</span>` is 39 characters for one); no real 64 KiB block carries it, and taken at 64 KiB it would put one block's HTML above the page's own cap (2 097 152) and let one chat block, which has no page cap, cost the main thread about 340 ms. 1 048 576 admits a 64 KiB block at a ratio of 16 (every grammar's p95 is at most 9; C7's dense JSON ran about 13), every real block of the twelve other grammars at their maximum ratio, and costs about 140 ms at the cap. It keeps the page cap twice the block cap, which W5h-a's ceiling tests assume. Cost if wrong: `json`'s one real block over 262 144 stays plain if its ratio exceeds 22.9 (its length is at most 45 709); a block made mostly of single-character tokens over about 27 000 characters stays plain, labelled "output too large". **Departure** (Q2; the rule-literal alternative, 2 621 440, is costed there).
- **(d) The page HTML cap's "never less than the largest real page's HTML" is not measured.** R19 reports no page's HTML (item 5 ran with no ceilings and does not report its store's output). The cap stays 2 097 152, which item 4 shows within this plan's 300 ms for one page. The largest page by code (item 5's) passes it only if its blocks average a ratio over 6.5. Later: R19 reports each page's HTML. Not a departure (a measurement gap, recorded).
- **(e) `HIGHLIGHT_BOOT_BUDGET_MS` keeps 27 times the slowest measured boot.** Every R19 boot loaded a precached chunk on an idle main thread; the budget is wall time on the main thread from spawn, and two failures in a row are sticky until a reload, so it keeps room for what R19 could not see. Lowering it to 1 000 would shorten Export's longest wait by 3 s. Not a departure.
- **(f) `HIGHLIGHT_STREAM_DEBOUNCE_MS` is 150**, read off item 8's table across its cadences (D-7756's condition stands: chat's real cadence is unmeasured). Not a departure.
- **(g) `HIGHLIGHT_BLOCK_DEADLINE_MS` stays 750**, between the slowest real block cold (at most 239.8 ms) and the operator's 2 s, never raised to pass the gate. The cold bound is derived (a grammar's compile is at most its largest block's cold time), since R19 timed only each grammar's largest block cold. Not a departure.
- **(h) The retired rows are re-pointed in this plan.** §7.10: "W5h-b's retirement commit deletes their code and re-points the rows: each is marked retired and names the guard that replaces it." Part 1's and W5h-a's plans are dated history (`citations.test.ts` exempts `docs/` for that reason), so the table "Rows retired and re-pointed" above is the record; it reaches `main` with this plan, before the run. Not a departure.
- **(i) M4.H23's scan is wider than its seven names, and reads text.** What: besides the seven constants, it refuses part 1's helpers (`HIGHLIGHT_BOUNDED_CAPS`, `highlightBlockCap`, `boundedCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `longestWordRun`, `longestLine`, `longestBlankRun`, `deriveBoundedCaps`, `embeddedGrammars`) and the word `part1` in any form (the store's option, its two skip words, Export's `part1-bounds`), by whole word in the text of every `pwa/src` source file, comments included. Why: §7.7 retires the bounds "with their labels and the data `highlightNames.ts` holds for them", and M4.H23's Export clause names `part1-bounds`; one scan holds all of it. Not a departure.
- **(j) The retirement removes Export's `part1-bounds`.** M4.H23: "If Export merged before W5h-b, no part-1 `ExportPlain` word remains". Export merges first (the coordinator's ruling), so Task 3 removes the word, its sentence, the two branches of `colouring.ts` that produce it, and its test fixture. Not a departure.
- **(k) The xml strip is re-argued, not moved.** §4.10 "What stays": it keeps xml linear, so fewer blocks time out, and restoring script and style colouring would shift the goldens. Task 3 rewrites `xmlWithoutSubLanguages`'s docstring to say so and drops its two sentences about part 1's markdown budget and caps. Not a departure.
- **(l) The cases W5h-a kept plain over the HTML cap are routed by measured length.** D-7757's "Cost if wrong" foresaw it: "W5h-b revisits these cases when it sets the measured cap; a raised cap turns them back to coloured." At 1 048 576 some 64 KiB shapes fit and some may not. Task 2 Step 0 measures each block's HTML (highlight.js's output length is the same on every device) and each case asserts what that length decides. Not a departure.
- **(m) `highlightNames.ts` imports nothing, pinned.** §4.10's Files table: "`markdownLimits.ts` only, until W5h-b; nothing after." Task 3 adds a case and a row. Not a departure.
- **(n) The output ceiling's boundary and F3's sum** (review run 1366's F3 and F4, carried by the ledger): a store-level case at the exact boundary, rows on both sides of its `<=`, and the end-to-end case's sum taken over every drawn copy and asserted first. Not a departure.
- **(o) The per-job latency is not fixed here** (the reasons are under "R19, as measured"). Not a departure; a Later item (Q4).
- **Measurements, not departures:** Task 2 Step 0's HTML lengths of the over-cap cases; Task 3 Step 0's list of `part1` hits on `main` after Export.

### Task 1: The page HTML ceiling's boundary, pinned from both sides; the inserted sum made live (review 1366 F4 and F3; M4.H12; refinement (n))

**Model routing:** `sonnet`, effort `medium`; reviewer `sonnet`. Two test edits, no production change.

**Spec rows:** M4.H12 (the output ceiling); the ledger's "Two minor test gaps are carried to W5h-b" (W5h-a's "Carried, not fixed": the F1 sum "slices to `fit` copies, so it cannot fail", and "the output ceiling's `<=` boundary is pinned from neither side").

**Files:**
- Modify: `pwa/test/highlight-store.test.ts` (one case inserted in the describe `'F1: the page ceilings count every drawn copy of a shared key'`), `pwa/test/docs-highlight-budget.test.tsx` (the sum in one case).
- Guards (not edited): `pwa/src/lib/highlightStore.ts#createHighlightStore`'s output walk, `while (fitted < copies.length && (!capped || outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS))`.

**Decisions:** (1) The boundary case sizes its answer from the page cap alone (`DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / 8`, an integer at every value this plan sets, and within the per-block cap), so it holds at the provisional and the measured values alike. (2) F3's sum counts every copy that carries highlight spans, not a slice, and is asserted before the per-copy checks, so a ceiling that admits one copy too many fails on the sum first.

- [ ] **Step 0: Base, claims, counts.** Run:
  `git grep -q "export const HIGHLIGHT_PAGE_WORKER_MS = 3000;" HEAD -- pwa/src/lib/markdownLimits.ts && git grep -q "export function blockKey(lang: string, raw: string, part1 = true): BlockKey {" HEAD -- pwa/src/lib/highlightStore.ts && git grep -q "outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS" HEAD -- pwa/src/lib/highlightStore.ts && git grep -q "slice(0, fit).reduce((sum, c) => sum + c.innerHTML.length, 0)" HEAD -- pwa/test/docs-highlight-budget.test.tsx && git grep -q "{ timeout: 30_000 }" HEAD -- pwa/test/docs-scans.test.ts && git grep -q "'part1-bounds'" HEAD -- pwa/src/docs/export/policy.ts && git grep -q "count('part1-bounds');" HEAD -- pwa/src/docs/export/colouring.ts && git grep -q "'part1-bounds': 'refused by the page highlight bounds'," HEAD -- pwa/src/docs/docsText.ts && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Export has merged by dispatch (the coordinator's ruling), so its files are BASE: check also that every Find block of Task 3 Step 5, and W5HB-T3-M5's and W5HB-T3-M7's `old`, occurs exactly once in its file at HEAD (`git grep -c -F -e '<text>' HEAD -- <file>` for single lines; read the file for the multi-line ones), and record the counts in the SDD ledger. One that does not is a stop-and-ask. Record BASE (`git rev-parse HEAD`) in `.superpowers/sdd/2026-11-03-native-docs-reader-w5h-b/progress.md`. Take the claims on the two files. Record the starting counts of both test files.
- [ ] **Step 1: The boundary case (F4).** In `highlight-store.test.ts`, inside `describe('F1: the page ceilings count every drawn copy of a shared key', …)`, find `    it('OUTPUT: the verdicts are readable when the key\'s listeners run (recorded before the entry is set)', async () => {` and insert before it:
  ```ts
      // Review 1366 F4: the output walk's `<=` pinned from both sides. Copies whose HTML sums to exactly the page cap are
      // all drawn; one copy more is skipped. The answer is sized from the page cap alone (an eighth of it, within the
      // per-block cap), so the case holds at any value this plan sets.
      it('OUTPUT, at the boundary: copies whose HTML sums to exactly the page cap are all drawn, and one copy more is skipped (review 1366 F4)', async () => {
        const { h, store, key, answer } = setup();
        const size = DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / 8;
        expect(Number.isInteger(size)).toBe(true);
        expect(size).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);
        const html = `<span class="hljs-a">${'x'.repeat(size - 28)}</span>`;
        expect(html).toHaveLength(size);
        const ats = copiesOf(9);
        store.seed(ats.map((at) => ({ lang: 'python', raw: 'same', at })));
        const k = key('python', 'same');
        store.request(k);
        await answer(0, HTML(html));
        expect(h.calls).toHaveLength(1);
        expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'block' });
        expect(verdicts(store, ats)).toEqual([...Array(8).fill(null), 'page-output']);
      });

  ```
- [ ] **Step 2: The sum over every drawn copy (F3).** In `docs-highlight-budget.test.tsx`, in the case `'the HTML ceiling: copies of one fence whose HTML together passes the page cap are coloured up to it, the rest are plain and say so; one job'`, delete these three lines:
  ```tsx
      // The inserted HTML is within the ceiling: the characters the drawn copies carry.
      const inserted = [...container.querySelectorAll('pre > code.hljs')].slice(0, fit).reduce((sum, c) => sum + c.innerHTML.length, 0);
      expect(inserted).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS);
  ```
  and, in the same case, after its line `    expect(docs.calls).toHaveLength(1);`, insert:
  ```tsx
      // The HTML the drawn copies insert, summed over EVERY copy that carries highlight spans (review 1366 F3: a sum
      // sliced to the copies the ceiling admits could not fail), is within the ceiling. Asserted before the per-copy
      // checks, so a ceiling that admits one copy too many fails here first.
      const inserted = [...container.querySelectorAll('pre > code.hljs')]
        .filter((c) => c.querySelector('span[class^="hljs-"]') !== null)
        .reduce((sum, c) => sum + c.innerHTML.length, 0);
      expect(inserted, 'inserted HTML within the ceiling').toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS);
  ```
  (The case's `fit` stays in use by its `coloured` and `labels` expectations.)
- [ ] **Step 3: Run; then see each pin red through its row.** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-store.test.ts test/docs-highlight-budget.test.tsx )` — green, each count one more case than Step 0 for `highlight-store`, unchanged for `docs-highlight-budget`. These pin behaviour that is already right, so they are seen red through W5HB-T1-M1 and M2 (measured now, under the LOW DISK procedure): M1 reds the boundary case; M2 reds the boundary case and the HTML-ceiling case, whose first failing expectation is `inserted HTML within the ceiling` (read it in the failure output: that is F3's sum, live). `TSC-OK`.
- [ ] **Step 4: Commit.** 2 files by name, message `test(pwa): the page HTML ceiling's boundary from both sides, and the inserted sum over every copy (docs W5h-b)`, trailer. Record the task's JSON row fence in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HB-T1-M1 | M4.H12 (F4) | pwa | `src/lib/highlightStore.ts` | `outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS` → `outputChars + o.html.length < DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS` | `test/highlight-store.test.ts` | 1 failed — `'OUTPUT, at the boundary: copies whose HTML sums to exactly the page cap are all drawn, and one copy more is skipped (review 1366 F4)'` |
| W5HB-T1-M2 | M4.H12 (F4, F3) | pwa | `src/lib/highlightStore.ts` | `outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS` → `outputChars + o.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS + o.html.length` | `test/highlight-store.test.ts`, `test/docs-highlight-budget.test.tsx` | 2+ failed — among them the boundary case and `'the HTML ceiling: copies of one fence whose HTML together passes the page cap are coloured up to it, the rest are plain and say so; one job'`, the latter failing first at `inserted HTML within the ceiling` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-store.test.ts test/docs-highlight-budget.test.tsx )` — all passed; `TSC-OK`.

### Task 2: The seven values, measured (M4.H22 at the measured values; Export's longest wait; the over-cap cases routed; refinements (a)-(g), (l))

**Model routing:** `sonnet`, effort `high`; reviewer `sonnet`. The values and their bases are this plan's ("R19, as measured"); the judgment left is Step 0's routing.

**Spec rows:** §4.9's seven W5h rows and their rules; §4.10 "Export's longest wait", "The main thread's worst case"; §7.8 R19 "What it decides"; M4.H22.

**Files:**
- Modify: `pwa/src/lib/markdownLimits.ts` (the W5h section's header and seven docstrings and values; one sentence restored in `HIGHLIGHT_CACHE_MAX_CHARS`'s docstring), `pwa/test/markdown-limits.test.ts` (`VALUES`, two cases replaced by four), `pwa/test/markdown-highlight.test.tsx`, `pwa/test/markdown-bounds.test.tsx` and `pwa/test/docs-highlight-budget.test.tsx` (the over-cap cases, by Step 0's measurement), `pwa/test/highlight-store.test.ts` (one case derived from its constant).
- Guards (not edited): `markdown-limits.test.ts`'s declared-once and use-site describes (no value is spelled at a use site: none of 12000, 1048576 or 150 is a literal in `markdownRunner.ts`, `highlightJob.ts` or `highlightStore.ts` at BASE).

- [ ] **Step 0: Claims, then measure the over-cap cases' HTML.** Take the claims on the six files. Write a throwaway `pwa/test/w5hb-html-lengths.tmp.test.ts` (never staged) that imports `HLJS` from `../src/lib/highlightGrammars`, rebuilds each body below with its file's own helper copied verbatim, and prints `HLJS.highlight(body, { language, ignoreIllegals: true }).value.length` for each:
  - (i) `markdown-highlight.test.tsx`'s `pyBody(65536)`, `python`: the cases `'the cap is inclusive: 65 536 characters are admitted and requested, and stay plain over the HTML cap until W5h-b; 65 537 are not requested'` and `'counts the block after the trailing-newline strip, as the copy button does: admitted and requested, plain over the HTML cap until W5h-b'`;
  - (ii) `markdown-bounds.test.tsx`'s three `shapes` at 65 536 (`shape('<script>', 8, n)`, `shape('<script><a>', 11, n)`, `shape('<style>{', 8, n)`, with that describe's `shape`), `markdown` (the `md` alias is the same grammar): the `it.each` `'a %s block holding HTML, shape %s at %i characters, is admitted and requested, and stays plain over the HTML cap until W5h-b'`;
  - (iii) `markdown-bounds.test.tsx`'s `scripted(65536)`, `markdown`: the markdown arm of `'a 64 KiB xml, html and svg block of <script> then <a> lines IS highlighted; the body of the script is plain; the markdown block of the same shape is admitted and requested, and stays plain over the HTML cap until W5h-b'`;
  - (iv) `docs-highlight-budget.test.tsx`'s `worst(65536)` with `serial` at 0, `markdown`: `'(f) rendered: …'`.
  Run it, record the six lengths in the SDD ledger, delete the file, and check `git status --porcelain` is as before. Prediction: (i) is 313 090 (the low figure the ledger records for these cases), under 1 048 576; (iv) is over it. A length within 1 048 576 routes its case to the colour form (Step 4), one over it keeps the plain form.
- [ ] **Step 1: Edit `pwa/test/markdown-limits.test.ts`.** In `VALUES`, replace the comment line `  // W5h-a (base spec 4.9's W5h rows and "Two more"): seven provisional values, then two fixed ones, then the` and its next line with `  // W5h-a and W5h-b (base spec 4.9's W5h rows and "Two more"): seven values R19 measured (W5h-b), then two fixed ones,\n  // then the highlight cache's two bounds, moved from markdown.tsx unchanged (the W5h-a plan's refinement (c)).`, and set `HIGHLIGHT_PAGE_WORKER_MS: 12000,`, `MD_HIGHLIGHT_MAX_HTML_CHARS: 1048576,` and `HIGHLIGHT_STREAM_DEBOUNCE_MS: 150,` (the other four stay). Replace the two cases `'M4.H22: the provisional page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character'` and `'M4.H22: each provisional value says so in its docstring'` with:
  ```ts
    it('M4.H22: the page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character, and two blocks at the per-block HTML cap', () => {
      expect(limits.DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS).toBeGreaterThanOrEqual(Math.ceil(8 * 60000 * 2.9));
      expect(limits.DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS).toBeGreaterThanOrEqual(2 * limits.MD_HIGHLIGHT_MAX_HTML_CHARS);
    });

    it('M4.H22: each measured value says so in its docstring', () => {
      const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownLimits.ts'), 'utf8');
      expect(src).not.toContain('PROVISIONAL');
      for (const name of ['HIGHLIGHT_BLOCK_DEADLINE_MS', 'HIGHLIGHT_BOOT_BUDGET_MS', 'HIGHLIGHT_PAGE_WORKER_MS',
        'HIGHLIGHT_PAGE_MAX_TIMEOUTS', 'MD_HIGHLIGHT_MAX_HTML_CHARS', 'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS',
        'HIGHLIGHT_STREAM_DEBOUNCE_MS']) {
        expect(src, name).toMatch(new RegExp(`/\\*\\* MEASURED \\(W5h-b, R19 of 2026-11-03\\)\\.(?:(?!\\*/)[^])*\\*/\\nexport const ${name} = `));
      }
    });

    // Section 7.8's retirement gate, as R19 measured it on the operator's phone on 2026-11-03: a real block, cold in its
    // grammar, takes at most the slowest cold block's 96.1 ms plus the slowest warm block's 143.7 ms; the operator's bound
    // for one block's colours is 2 000 ms (the W5h-a plan's approval, 2026-11-02). The deadline sits between the two.
    it('M4.H22: the block deadline sits between the slowest real block, cold, and the operator\'s per-block bound', () => {
      expect(limits.HIGHLIGHT_BLOCK_DEADLINE_MS).toBeGreaterThan(96.1 + 143.7);
      expect(limits.HIGHLIGHT_BLOCK_DEADLINE_MS).toBeLessThanOrEqual(2000);
    });

    it('M4.H22: Export\'s longest wait, section 4.10\'s sum at the measured values, is 18 750 ms', () => {
      expect(limits.HIGHLIGHT_PAGE_WORKER_MS + limits.HIGHLIGHT_BLOCK_DEADLINE_MS
        + (limits.HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * limits.HIGHLIGHT_BOOT_BUDGET_MS).toBe(18750);
    });
  ```
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts )` — Expected: 5 failed (the three changed value cases, the docstring case, the longest wait); the gate case and the two caps' relation pass already; every declared-once and use-site case green.
- [ ] **Step 3: Implement in `markdownLimits.ts`.** Replace everything from the line `// Highlighting off the main thread (base spec 2026-10-01 section 4.9's W5h rows and "Two more"; W5h-a). The first` through the line `export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 250;` with:
  ```ts
  // Highlighting off the main thread (base spec 2026-10-01 section 4.9's W5h rows and "Two more"; W5h-a, W5h-b). The
  // first seven are MEASURED: R19 ran once on the operator's phone on 2026-11-03, against W5h-a's build, and W5h-b set
  // each from R19 under its section 4.9 rule, except two departures the W5h-b plan numbers: the timeout count and the
  // per-block HTML cap (the plan records the result). Every time is the main thread's clock, so
  // it holds the main thread's latency as well as the worker's time. A slower or busier device colours fewer blocks; it
  // never gives the main thread more to do. Export's longest wait (section 4.10) is HIGHLIGHT_PAGE_WORKER_MS +
  // HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) x HIGHLIGHT_BOOT_BUDGET_MS = 18 750 ms.

  /** MEASURED (W5h-b, R19 of 2026-11-03). The time one block may take, from post to answer; its timer starts only after
   *  the worker's ready handshake. An overrun terminates the highlight worker and leaves only that block plain. Basis:
   *  the slowest of 41 871 real blocks took 143.7 ms warm and each grammar's largest at most 96.1 ms cold, so no real
   *  block cold passes about 240 ms; 750 is about three times that, for a slower or busier device and the main thread's
   *  latency, and under the operator's 2 s bound for one block. Every crafted shape that grows ended here, with the
   *  main thread's longest frame gap at most 25 ms. */
  export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;
  /** MEASURED (W5h-b, R19 of 2026-11-03). From spawning a highlight worker to its `{ready: true}`; past it the worker is
   *  terminated and the jobs waiting for it answer `worker-failed`, and a second failure in a row is sticky until a
   *  reload. Basis: 32.2 ms for a first boot and at most 74.4 ms for thirteen respawns, each from the service worker's
   *  precache on an idle main thread; about 27 times that, because a long main-thread task when the worker spawns
   *  delays `{ready}` and a page no service worker controls fetches the chunk over the network, neither measured. */
  export const HIGHLIGHT_BOOT_BUDGET_MS = 2000;
  /** MEASURED (W5h-b, R19 of 2026-11-03). The summed post-to-answer time of one highlight store's jobs (a Docs page, a
   *  text leaf, a chat message, a tool well); past it, every block not yet answered is skipped. Basis: the real page
   *  with the most code (238 blocks, 323 842 characters) went from its plain first frame to its last block coloured in
   *  9 515.6 ms, about 40 ms a block where the worker's own time is a few: an upper bound on that page's sum, which
   *  counts the main thread's latency between answers. 12 000 is about a quarter more. It also bounds Export's wait. */
  export const HIGHLIGHT_PAGE_WORKER_MS = 12000;
  /** MEASURED (W5h-b, R19 of 2026-11-03). The block timeouts one highlight store may take, each a worker respawn; once
   *  reached, every block not yet answered is skipped. Basis: no real block came near the deadline, so no real page
   *  reaches one timeout; 2 rather than 1 so that one timed-out block's line-by-line retry can still run (at 1 the
   *  first timeout closes the store before the retry is posted). */
  export const HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2;
  /** MEASURED (W5h-b, R19 of 2026-11-03). The longest HTML one block's answer may carry, an absolute count for every
   *  block, chat's included: the worker refuses a longer one before posting and the main thread re-checks it on receipt.
   *  Basis: on real blocks the HTML ratio was at most 9 at the 95th percentile of any grammar, and 39 only for one-token
   *  `json` blocks; 16 x MD_HIGHLIGHT_BLOCK_MAX_CHARS admits a 64 KiB block at a ratio of 16 (desktop polish C7's dense
   *  JSON ran about 13) and every real block of twelve grammars at their highest ratio, and checking and inserting it
   *  costs the main thread about 140 ms on the phone measured. */
  export const MD_HIGHLIGHT_MAX_HTML_CHARS = 1048576;
  /** MEASURED (W5h-b, R19 of 2026-11-03). The HTML one Docs page may insert from highlighting, each drawn copy counted;
   *  past it the remaining blocks are skipped. Docs only. Basis: R19 checked (20.6 ms), inserted and laid out (255.7 ms)
   *  2 097 145 characters of real answers in one commit, within the 300 ms the W5h-b plan allows one page; it is twice
   *  MD_HIGHLIGHT_MAX_HTML_CHARS, so two blocks at that cap fit. */
  export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152;
  /** MEASURED (W5h-b, R19 of 2026-11-03). Chat only: a block whose text changed less than this long ago is not
   *  requested yet, so a streaming block asks the worker when it pauses. Basis: a 40-line fence streamed at settles of
   *  50 and 100 ms made 2 requests at 150, as at 250 and 400, and coloured 108 and 90 ms after its fence closed, against
   *  206 and 156 at 250; at 250 ms settles every candidate up to 250 asked once a settle. Chat has no fixed cadence of
   *  its own, so the basis holds as far as its real cadence is one of those. */
  export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 150;
  ```
  Then find ` *  only; a key is at most its markup plus a mode, a language and two separators. */` and replace it with ` *  only; a key is at most its markup plus a mode, a language and two separators, so the cache holds at most twice\n *  this many characters, plus a mode, a language and two characters per entry. */` (W5h-a's "Carried, not fixed").
- [ ] **Step 4: The cases the values move.**
  - **(i), `markdown-highlight.test.tsx`** (if Step 0 measured it within 1 048 576; otherwise stop and ask). Replace the comment block that begins `  // From W5h-a the shipped per-block HTML cap (MD_HIGHLIGHT_MAX_HTML_CHARS) keeps a 65 536-character python block of` (four lines) and the two cases under it with:
    ```tsx
      // W5h-b: at the measured per-block HTML cap (MD_HIGHLIGHT_MAX_HTML_CHARS) a 65 536-character python block of keyword
      // lines is coloured again: its markup is under the cap, and the case says so first.
      it('the cap is inclusive: 65 536 characters are highlighted; 65 537 are not requested', () => {
        expect(MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
        const atBody = pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
        expect(HLJS.highlight(atBody, { language: 'python', ignoreIllegals: true }).value.length).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);
        const at = block('python', atBody);
        expect(keywords(at)).toBeGreaterThan(0);
        expect(label(at)).toBe('Python');
        cleanup();
        const overStore = syncTestStore('chat');
        const over = render(withSyncStore(<CodeBlock><code className="language-python">{`${pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1)}\n`}</code></CodeBlock>, overStore)).container;
        expect(overStore.keyOf('python', pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1)).kind).toBe('over-cap');
        expect(overStore.requests).toEqual([]);
        expect(keywords(over)).toBe(0);
        expect(label(over)).toBe('Python · not highlighted (65 KiB)');
      });

      it('counts the block after the trailing-newline strip, as the copy button does: 65 536 characters are highlighted', () => {
        // pyBody(65 536) plus the newline the block appends is 65 537 characters before the strip.
        const body = pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
        const c = block('python', body);
        expect(keywords(c)).toBeGreaterThan(0);
        expect(label(c)).toBe('Python');
        expect(code(c)).toBe(body);
      });
    ```
  - **(ii) and (iii), `markdown-bounds.test.tsx`.** Add `MD_HIGHLIGHT_MAX_HTML_CHARS` to its `'../src/lib/markdownLimits'` import. For each shape of (ii) that Step 0 measured within the cap, the `it.each` row moves to a new `it.each` over those shapes, titled `'a %s block holding HTML, shape %s at %i characters, is highlighted under the measured HTML cap'`, whose body is: `const body = make(n);`, `expect(HLJS.highlight(body, { language: 'markdown', ignoreIllegals: true }).value.length).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);`, `const c = real(lang, body);`, `expect(label(c)).not.toMatch(/not highlighted/);`, `expect(c.querySelector('code')!.textContent).toBe(body);`, `expect(c.querySelector('code span')).not.toBeNull();`. A shape over the cap stays in the existing `it.each`, retitled `'a %s block holding HTML, shape %s at %i characters, is admitted and requested, and stays plain over the measured HTML cap'`, with `expect(HLJS.highlight(body, { language: 'markdown', ignoreIllegals: true }).value.length).toBeGreaterThan(MD_HIGHLIGHT_MAX_HTML_CHARS);` added after its `const body = make(n);`; an empty table is deleted. Rewrite the `// R-P1 (W5h-a): …` comment above them to say which shapes Step 0 measured within the cap and that the others stay plain over it. For (iii): within the cap, replace the case's markdown arm (from `    // R-P1: the markdown arm.` through the `cleanup();` after `expect(md.querySelector('code')!.children).toHaveLength(0);`) with a colour arm of the same form (the length assertion first, then `const md = real('markdown', body);`, the label without "not highlighted", a span present, `cleanup();`), and end the case's title with `; the markdown block of the same shape is highlighted under the measured HTML cap`; over the cap, keep the arm, add the `toBeGreaterThan` length assertion, and end the title with `; the markdown block of the same shape is admitted and requested, and stays plain over the measured HTML cap`.
  - **(iv), `docs-highlight-budget.test.tsx`'s `'(f) rendered: …'`** (Task 3 deletes it with part 1's markdown budget). Over the cap (predicted): replace `until W5h-b` in its title and in its `// R-P1 (W5h-a): …` comment with `over the measured HTML cap`. Within the cap: also change its two `'Markdown · not highlighted (output too large)'` labels to `'Markdown'`, its loop's `toHaveLength(0)` on `.hljs-tag` to `.not.toHaveLength(0)` for the first two blocks only, its `toMatchObject({ kind: 'plain', … })` to `toMatchObject({ kind: 'html' })`, and its last line's `toBeGreaterThan` to `toBeLessThanOrEqual`.
  - **`highlight-store.test.ts`'s worker-time arithmetic.** Replace the case `'five 700 ms jobs answered back to back: the fifth is skipped by page-worker-time 200 ms into its run'` (from its `it(` line to its closing `});`) with:
    ```ts
      // W5h-b: derived from HIGHLIGHT_PAGE_WORKER_MS (it was written for the provisional 3 000 ms): as many 700 ms jobs as
      // fit are coloured, and the next is skipped (HIGHLIGHT_PAGE_WORKER_MS - fit x 700) ms into its run, under its deadline.
      it('back-to-back 700 ms jobs: as many as fit the worker-time ceiling are coloured, and the next is skipped by page-worker-time mid-run', async () => {
        const JOB_MS = 700;
        expect(JOB_MS).toBeLessThan(HIGHLIGHT_BLOCK_DEADLINE_MS);
        const fit = Math.floor(HIGHLIGHT_PAGE_WORKER_MS / JOB_MS);
        const left = HIGHLIGHT_PAGE_WORKER_MS - fit * JOB_MS;
        expect(left).toBeGreaterThan(0);
        const clock = fakeClock();
        const worker = new Worker();
        const highlighter = createHighlighter({ spawn: () => worker, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
        const store = createHighlightStore(highlighter, { mode: 'docs' }, clock);
        const raws = Array.from({ length: fit + 1 }, (_, i) => `b${i}`);
        store.seed(raws.map((raw) => ({ lang: 'python', raw })));
        const ks = raws.map((raw) => { const k = store.keyOf('python', raw); if (k.kind !== 'key') throw new Error('no key'); return k.key; });
        for (const k of ks) store.request(k);
        worker.onmessage?.({ data: { ready: true } });
        for (let i = 1; i <= fit; i += 1) {
          clock.advance(JOB_MS);
          worker.onmessage?.({ data: { id: i, result: { kind: 'html', html: OK, mode: 'block' } } });
          await flush();
        }
        expect(kinds(store, ks)).toEqual([...Array(fit).fill('html'), 'pending']);
        clock.advance(left + 50);
        await flush();
        expect(store.peek(ks[fit]!)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
        expect(store.settled()).toBe(true);
      });
    ```
- [ ] **Step 5: Run to verify they pass.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts test/markdown-highlight.test.tsx test/markdown-bounds.test.tsx test/docs-highlight-budget.test.tsx test/highlight-store.test.ts )` — green. Then the suites that read these limits, unchanged: `( cd pwa && ./node_modules/.bin/vitest run test/highlight-wiring.test.tsx test/chat-hardening.test.tsx test/markdown-highlight-worker.test.ts test/markdown-runner.test.ts test/highlight-measure.test.tsx test/highlight-html.test.tsx test/tool-well.test.tsx test/docs-screen.test.tsx )` — green. Any red there is a stop-and-ask, unless it is arithmetic written for a provisional value, which is derived from its constant as Step 4 did (and recorded in the SDD ledger). `TSC-OK`.
- [ ] **Step 6: Commit.** The six files by name, message `pwa: the highlight worker's limits, measured on the operator's phone (R19) (docs W5h-b)`, trailer. Record the task's JSON row fence, and the re-anchored W5HA-T1-M3 and W5HA-T1-M4 measured now, in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HB-T2-M1 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_PAGE_WORKER_MS = 12000;` → `export const HIGHLIGHT_PAGE_WORKER_MS = 3000;` | `test/markdown-limits.test.ts` | 2 failed — `'HIGHLIGHT_PAGE_WORKER_MS is 12000'`; `'M4.H22: Export\'s longest wait, section 4.10\'s sum at the measured values, is 18 750 ms'` |
| W5HB-T2-M2 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const MD_HIGHLIGHT_MAX_HTML_CHARS = 1048576;` → `export const MD_HIGHLIGHT_MAX_HTML_CHARS = 262144;` | `test/markdown-limits.test.ts`, `test/markdown-highlight.test.tsx` | 2+ failed — among them `'MD_HIGHLIGHT_MAX_HTML_CHARS is 1048576'` and `'the cap is inclusive: 65 536 characters are highlighted; 65 537 are not requested'` |
| W5HB-T2-M3 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 150;` → `export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 250;` | `test/markdown-limits.test.ts` | 1 failed — `'HIGHLIGHT_STREAM_DEBOUNCE_MS is 150'` |
| W5HB-T2-M4 | M4.H22 (refinement (b)) | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2;` → `export const HIGHLIGHT_PAGE_MAX_TIMEOUTS = 1;` | `test/markdown-limits.test.ts`, `test/highlight-store.test.ts` | 3+ failed — among them `'HIGHLIGHT_PAGE_MAX_TIMEOUTS is 2'`, the longest-wait case, and `highlight-store.test.ts`'s `'OUTPUT: a line retry\'s html answer counts every copy too'` (a timed-out block's line retry is refused at 1) |
| W5HB-T2-M5 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_BOOT_BUDGET_MS = 2000;` → `export const HIGHLIGHT_BOOT_BUDGET_MS = 1999;` | `test/markdown-limits.test.ts` | 2 failed — `'HIGHLIGHT_BOOT_BUDGET_MS is 2000'`; the longest-wait case |
| W5HB-T2-M6 | M4.H22 (refinement (c)) | pwa | `src/lib/markdownLimits.ts` | `export const MD_HIGHLIGHT_MAX_HTML_CHARS = 1048576;` → `export const MD_HIGHLIGHT_MAX_HTML_CHARS = 1048577;` | `test/markdown-limits.test.ts` | 2 failed — `'MD_HIGHLIGHT_MAX_HTML_CHARS is 1048576'`; `'M4.H22: the page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character, and two blocks at the per-block HTML cap'` |
| W5HB-T2-M7 | M4.H22 (the gate) | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;` → `export const HIGHLIGHT_BLOCK_DEADLINE_MS = 2001;` | `test/markdown-limits.test.ts` | 3 failed — `'HIGHLIGHT_BLOCK_DEADLINE_MS is 750'`; `'M4.H22: the block deadline sits between the slowest real block, cold, and the operator\'s per-block bound'`; the longest-wait case |

**Verify:** Step 5's two runs green; `TSC-OK`; `git grep -c PROVISIONAL -- pwa/src/lib/markdownLimits.ts` prints nothing (or `0`).

### Task 3: The retirement — all of part 1's main-thread highlight bounds, in one commit (M4.H23; part 1's rows re-pointed; refinements (h)-(k), (m))

**Model routing:** `sonnet`, effort `high`; reviewer `opus` (it deletes guards: the review reads each deletion against "Rows retired and re-pointed" and each kept bound against M4.H23).

**Spec rows:** §0 `offthread-highlight` ruling 3; §4.9 "W5 part 1's highlight bounds under W5h"; §4.10 "What W5h changes in these bounds", the label table's "until W5h-b" rows; §7.7's W5h-b row; §7.10 M4.H23 and the re-pointing paragraph.

**Files:**
- Modify (production): `pwa/src/lib/markdownLimits.ts`, `pwa/src/lib/highlightNames.ts`, `pwa/src/lib/highlightGrammars.ts`, `pwa/src/lib/highlightStore.ts`, `pwa/src/lib/highlighterContext.ts` (one docstring), `pwa/src/lib/markdown.tsx`, `pwa/src/screens/highlightMeasureRun.tsx`; Export's `pwa/src/docs/export/policy.ts`, `pwa/src/docs/export/colouring.ts`, `pwa/src/docs/docsText.ts`.
- Modify (tests): `pwa/test/docs-scans.test.ts` (one clause appended), `pwa/test/highlight-names.test.ts`, `pwa/test/markdown-bounds.test.tsx`, `pwa/test/docs-highlight-budget.test.tsx`, `pwa/test/highlight-store.test.ts`, `pwa/test/markdown-limits.test.ts`, `pwa/test/docs-markdown.test.tsx` (one comment), `pwa/test/docs-export.test.tsx`; this plan (nothing: the retired rows' record is already in it).
- Guards (not edited): `markdown-runner.test.ts` (M4.H7, the deadline that replaces the per-block bounds), `highlight-wiring.test.tsx`, `chat-hardening.test.tsx`, `markdown-golden.test.tsx` (goldens byte-identical: no golden block was refused by part 1), `pwa-rings`, `rings/totality`. `pwa/src/lib/markdownParse.ts` stays byte-identical: its comment that highlight.js's spans are "bounded instead by the highlight page budgets (`markdownLimits.ts`)" stays true of the page input and HTML ceilings declared there.

**Decisions:** (1) ONE commit holds the whole retirement, its tests and Export's word (the spec's "in a commit of its own"). (2) Part 1's deleted cases are replaced by cases that prove each bound is gone without running a crafted shape through highlight.js: the highlighter holds every request, and the case asserts the request (whole text, once) and the bare label. (3) `codeBlockLabel` labels every page-ceiling skip "page highlighting limit": the bare label part 1's own budgets used goes with them. (4) The retired-word scan is text, comments included (refinement (i)).

- [ ] **Step 0: Export is on the branch; list what this task touches.** Run:
  `git grep -q "export const HIGHLIGHT_PAGE_WORKER_MS = 12000;" HEAD -- pwa/src/lib/markdownLimits.ts && git grep -q "'part1-bounds'" HEAD -- pwa/src/docs/export/policy.ts && git grep -q "count('part1-bounds');" HEAD -- pwa/src/docs/export/colouring.ts && echo T3-EXPORT-ON`
  Expected: `T3-EXPORT-ON`. If it does not print, stop and ask the coordinator (the run is dispatched only after Export merges, so Export's files are on the branch; a failing grep means its code differs from its plan's text). Then record, in the SDD ledger, the output of `git grep -n -w -e part1 -e part1-bounds -e part1-scan -e part1-markdown -- pwa/src pwa/test` and of `git grep -n -w -E 'MD_HIGHLIGHT_MAX_WORD_CHARS|MD_HIGHLIGHT_MAX_LINE_CHARS|MD_HIGHLIGHT_MAX_BLANK_CHARS|MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS|MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS|DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS|DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS|HIGHLIGHT_BOUNDED_CAPS|highlightBlockCap|boundedCap|inScanPageBudget|inMarkdownPageBudget|longestWordRun|longestLine|longestBlankRun|deriveBoundedCaps|embeddedGrammars' -- pwa`. Every hit must be in a file this task names; a hit elsewhere is a stop-and-ask. Take the claims on every file in Files.
- [ ] **Step 1: Write the failing tests.**
  - **1a. M4.H23, `docs-scans.test.ts`.** Append after the file's last `});` (Export's clause, if it landed last):
    ```ts

    // ---------------------------------------------------------------------------------------------------------------
    // Clause W5h-b, M4.H23 (base spec 2026-10-01 section 7.10): what the retirement of W5 part 1's main-thread highlight
    // bounds keeps. (1) No `.ts`/`.tsx` file under `pwa/src` spells a retired limit, a part-1 helper or the word `part1` in
    // any form (the store's option and skip words, Export's `part1-bounds`): read as TEXT, comments included, by whole
    // word, because a retired name left in a comment is a name left behind. (2) The two caps on input crossing to the
    // worker stay, at 65 536 and 524 288, and `lib/highlightStore.ts` reads each outside its import. (3) The xml grammar
    // the worker registers carries no sub-language inside `<script>` or `<style>`; stock xml beside javascript and css is
    // the control. Its imports are dynamic, inside the cases, so the clause leaves the file's import block as it is.
    // NOT EXHAUSTIVE: a retired name built from pieces (`'MD_HIGHLIGHT_' + 'MAX_WORD_CHARS'`) is not seen.
    // ---------------------------------------------------------------------------------------------------------------

    /** Every name W5h-b retired, matched as a whole word. */
    const RETIRED_WORDS: readonly string[] = [
      'MD_HIGHLIGHT_MAX_WORD_CHARS', 'MD_HIGHLIGHT_MAX_LINE_CHARS', 'MD_HIGHLIGHT_MAX_BLANK_CHARS', 'MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS',
      'MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS', 'DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS', 'DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS',
      'HIGHLIGHT_BOUNDED_CAPS', 'highlightBlockCap', 'boundedCap', 'inScanPageBudget', 'inMarkdownPageBudget', 'longestWordRun',
      'longestLine', 'longestBlankRun', 'deriveBoundedCaps', 'embeddedGrammars', 'part1',
    ];

    /** Each retired word found in the source files under `<base>/src`, as `<file> <word>`. */
    function retiredWordHits(base: string): string[] {
      const hits: string[] = [];
      for (const f of sourceFiles(path.join(base, 'src'))) {
        const text = readFileSync(f, 'utf8');
        const rel = path.relative(base, f).split(path.sep).join('/');
        for (const word of RETIRED_WORDS) if (new RegExp(`\\b${word}\\b`).test(text)) hits.push(`${rel} ${word}`);
      }
      return hits;
    }

    /** How many times each identifier occurs in one module outside its import declarations. */
    function identifierUses(source: string, file: string): Map<string, number> {
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const uses = new Map<string, number>();
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n)) return;
        if (ts.isIdentifier(n)) uses.set(n.text, (uses.get(n.text) ?? 0) + 1);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return uses;
    }

    // Its planted case copies the whole of pwa/src, so it takes the same 30 s bound as the clauses above.
    describe('clause W5h-b, M4.H23: what the retirement of part 1\'s highlight bounds keeps', { timeout: 30_000 }, () => {
      const copies: string[] = [];
      afterAll(() => {
        for (const dir of copies) rmSync(dir, { recursive: true, force: true });
      });
      /** A copy of `pwa/src` with `text` appended to `rel`; returns the directory holding `src`. */
      function planted(rel: string, text: string): string {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-w5hb-'));
        copies.push(dir);
        cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
        const file = path.join(dir, ...rel.split('/'));
        writeFileSync(file, readFileSync(file, 'utf8') + text);
        return dir;
      }

      it('M4.H23: no retired limit, part-1 helper or part1 word is left anywhere in pwa/src', () => {
        expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(100);
        expect(retiredWordHits(PWA)).toEqual([]);
      });

      it('M4.H23 planted: a retired limit declared again, a helper named in a comment, and a part1 word in a string are each red', () => {
        expect(retiredWordHits(planted('src/lib/markdownLimits.ts', '\nexport const MD_HIGHLIGHT_MAX_LINE_CHARS = 2048;\n')))
          .toEqual(['src/lib/markdownLimits.ts MD_HIGHLIGHT_MAX_LINE_CHARS']);
        expect(retiredWordHits(planted('src/lib/markdown.tsx', '\n// longestWordRun once bounded r10.\n')))
          .toEqual(['src/lib/markdown.tsx longestWordRun']);
        expect(retiredWordHits(planted('src/lib/highlightStore.ts', "\nexport const plantedSkip = 'part1-scan';\n")))
          .toEqual(['src/lib/highlightStore.ts part1']);
      });

      it('M4.H23: the two caps on input crossing to the worker stay, at 65 536 and 524 288, and highlightStore.ts reads each outside its import', async () => {
        const limits = await import('../src/lib/markdownLimits');
        expect(limits.MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
        expect(limits.DOCS_HIGHLIGHT_PAGE_MAX_CHARS).toBe(524288);
        const uses = identifierUses(readFileSync(path.join(SRC_DIR, 'lib', 'highlightStore.ts'), 'utf8'), 'highlightStore.ts');
        expect(uses.get('MD_HIGHLIGHT_BLOCK_MAX_CHARS') ?? 0, 'MD_HIGHLIGHT_BLOCK_MAX_CHARS read').toBeGreaterThan(0);
        expect(uses.get('DOCS_HIGHLIGHT_PAGE_MAX_CHARS') ?? 0, 'DOCS_HIGHLIGHT_PAGE_MAX_CHARS read').toBeGreaterThan(0);
      });

      it('M4.H23: the worker\'s xml carries no sub-language inside <script> or <style>; stock xml beside javascript and css, the control, does', async () => {
        const { HLJS } = await import('../src/lib/highlightGrammars');
        const { default: hljs } = await import('highlight.js/lib/core');
        const { default: stockXml } = await import('highlight.js/lib/languages/xml');
        const { default: javascript } = await import('highlight.js/lib/languages/javascript');
        const { default: css } = await import('highlight.js/lib/languages/css');
        const src = '<script>let a = 1;</script><style>a { color: red }</style>';
        const SUB = /hljs-(?:keyword|selector-tag|attribute)/;
        const ours = HLJS.highlight(src, { language: 'xml', ignoreIllegals: true }).value;
        expect(ours).toMatch(/hljs-tag/);
        expect(ours).not.toMatch(SUB);
        const stock = hljs.newInstance();
        stock.registerLanguage('xml', stockXml);
        stock.registerLanguage('javascript', javascript);
        stock.registerLanguage('css', css);
        expect(stock.highlight(src, { language: 'xml', ignoreIllegals: true }).value).toMatch(SUB);
      });
    });
    ```
  - **1b. `highlightNames.ts` imports nothing, `highlight-names.test.ts`.** Append after the file's last `});`:
    ```ts

    // W5h-b (base spec 4.10's Files table: `highlightNames.ts` imports "`markdownLimits.ts` only, until W5h-b; nothing
    // after"). Read with TypeScript's parser: every import declaration and every `export … from`. NOT EXHAUSTIVE: a dynamic
    // `import()` and a `require` are not seen.
    /** The module specifiers one module imports or re-exports from. */
    function specifiersOf(source: string): string[] {
      const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      return sf.statements.flatMap((s) => (
        (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier !== undefined && ts.isStringLiteral(s.moduleSpecifier)
          ? [s.moduleSpecifier.text] : []));
    }

    describe('W5h-b: highlightNames.ts imports nothing', () => {
      it('highlightNames.ts imports and re-exports from no module', () => {
        expect(specifiersOf(readFileSync(path.join(LIB, 'highlightNames.ts'), 'utf8'))).toEqual([]);
      });

      it('planted: an import of markdownLimits, a type import and a re-export are each seen', () => {
        expect(specifiersOf("import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from './markdownLimits';\nexport const c = MD_HIGHLIGHT_BLOCK_MAX_CHARS;"))
          .toEqual(['./markdownLimits']);
        expect(specifiersOf("import type { HighlightJob } from './highlightProtocol';\nexport type J = HighlightJob;"))
          .toEqual(['./highlightProtocol']);
        expect(specifiersOf("export { LANG_LABEL } from './other';")).toEqual(['./other']);
      });
    });
    ```
  - **1c. The shapes part 1 refused, now requested, `markdown-bounds.test.tsx`.** Add `waitFor` to its `@testing-library/react` import, then insert before `describe('W5 bound r11: a code span longer than MD_KEYSTROKE_MAX_CHARS is never a chord', () => {`:
    ```tsx
    // W5h-b (base spec 2026-10-01 section 4.9 "W5 part 1's highlight bounds under W5h", M4.H23): part 1's word, line and
    // whitespace bounds and its per-grammar block caps are retired. A block of each shape they refused now has a key, is
    // requested whole and once, and shows its bare label while it waits; the worker's per-block deadline is its bound
    // (M4.H7, `markdown-runner.test.ts`). The highlighter holds every request, so no crafted shape runs through
    // highlight.js here.
    describe('W5h-b: a block of a shape part 1 refused is requested whole, under its bare label (M4.H23)', () => {
      const RETIRED_SHAPES: ReadonlyArray<readonly [string, string, string, string]> = [
        ['a 257-character identifier (the word bound)', 'ts', 'TypeScript', `const ${'a'.repeat(257)} = 1;`],
        ['a 32 768-character identifier in python (the word bound)', 'python', 'Python', 'a'.repeat(32768)],
        ['a 2 049-character line of "[" in markdown (the line bound)', 'markdown', 'Markdown', '['.repeat(2049)],
        ['2 049 newlines in typescript (the whitespace bound)', 'ts', 'TypeScript', `a${'\n'.repeat(2049)}b`],
        ['8 193 characters of typescript (its grammar cap)', 'ts', 'TypeScript', 'const a = 1;\n'.repeat(631).slice(0, 8193)],
        ['4 097 characters of rust (its grammar cap)', 'rust', 'Rust', 'let a = 1;\n'.repeat(373).slice(0, 4097)],
      ];

      it.each(RETIRED_SHAPES)('%s: one request with the whole text, and the bare label while it waits', async (_name, lang, label, body) => {
        const h = inThreadHighlighter({ hold: true });
        const store = createProductionStore(h, 'docs');
        const { container } = render(
          <PreHighlightContext value={store}><CodeBlock><code className={`language-${lang}`}>{`${body}\n`}</code></CodeBlock></PreHighlightContext>,
        );
        await waitFor(() => expect(h.calls).toHaveLength(1));
        expect(h.calls[0]).toMatchObject({ lang, code: body });
        expect(container.querySelector('.code-block-lang')?.textContent).toBe(label);
      });
    });

    ```
  - **1d. The page budgets gone, `docs-highlight-budget.test.tsx`.** Insert before `describe('review 450 F1: the scan budget, a page\'s code of typescript, javascript and rust together (393 216 characters)', () => {`:
    ```tsx
    // W5h-b (M4.H23): part 1's scan and markdown page budgets are retired. Every grammar's code counts only against the
    // page input ceiling, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, in document order (M4.H12). Literal sizes, so a mutated
    // constant reds a behaviour case.
    describe('W5h-b: the scan and markdown page budgets are retired; every grammar counts only against the page input ceiling', () => {
      it('64 ts blocks of 8 192 characters (exactly 524 288) are all admitted; one more ts character is skipped by the input ceiling', () => {
        expect(decisions(root([...spreadLang('ts', 524288, 8192), lang('ts', 1)]))).toEqual([...rep(A, 64), INPUT]);
      });

      it('eight markdown and md blocks of 65 536 characters are all admitted; one more md character is skipped by the input ceiling', () => {
        expect(decisions(root([...spreadLang('markdown', 262144, 65536), ...spreadLang('md', 262144, 65536), lang('md', 1)])))
          .toEqual([...rep(A, 8), INPUT]);
      });

      it('tsx, jsx and rs blocks fill the page together, past what the scan budget allowed, and the next block of any grammar is skipped', () => {
        expect(decisions(root([
          ...spreadLang('tsx', 196608, 8192), ...spreadLang('jsx', 196608, 8192), ...spreadLang('rs', 131072, 4096), lang('yaml', 1),
        ]))).toEqual([...rep(A, 24 + 24 + 32), INPUT]);
      });

      it('a ts block over 8 192 characters and a rust block over 4 096 each have a key: part 1\'s grammar caps are gone', () => {
        expect(decisions(root([lang('ts', 8193), lang('rust', 4097), lang('tsx', 65536)]))).toEqual([A, A, A]);
      });
    });

    ```
    In the case `'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'` (describe `'review 460 F10: …'`): retitle it `'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks the page input ceiling admits'`; replace its first six lines (from `    const tsChars = MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS; // raw characters: the cap is inclusive` through `    expect(tsCount * MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + mdCount * MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);`) with:
    ```tsx
        // Literal sizes: 48 ts blocks of 8 192 and two markdown blocks of 65 536 fill the page input ceiling exactly.
        const tsChars = 8192;
        const mdChars = 65536;
        const tsCount = 48;
        const mdCount = 2;
        expect(tsCount * tsChars + mdCount * mdChars).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    ```
    replace `    // Page S, the scan budget: 48 ts blocks fill it exactly; then tsx (a ts alias), javascript and rust are refused, yaml is not.` with `    // Page S: 48 ts blocks, then tsx, yaml, javascript, rust and a ts block of 8 193: all within the page, all coloured.`, the `mixed('ts', 's-over', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + 1),` element with `mixed('ts', 's-over', tsChars + 1),`, and its two expectations (`expect(s.highlighted).toEqual([...rep(true, tsCount), false, true, false, false, false]);` and the `s.labels` line after it) with `    expect(s.highlighted).toEqual(rep(true, tsCount + 5));\n    expect(s.labels.filter((l) => l.includes('not highlighted'))).toEqual([]);`; replace `    // Page M, the markdown budget: a markdown and an md block fill it exactly; then a small markdown block is refused, yaml is not.` with `    // Page M: two markdown blocks of 65 536, then a small markdown and a yaml block: all within the page, all coloured.` and `    expect(m.highlighted).toEqual([true, true, false, true]);` with `    expect(m.highlighted).toEqual([true, true, true, true]);`; and in the comment above Page G, `yaml is in neither sub-budget and is refused by the general one` with `the yaml block after them is refused by the page input ceiling`. Page G's expectation is unchanged.
  - **1e. `blockKey` without part 1, `highlight-store.test.ts`.** Replace the case `'keyOf: a key, or why the block can never be requested, in BASE\'s order; part 1\'s bounds only with part1'` (its `it(` line to its closing `});`) with:
    ```ts
      it('keyOf: a key, or why the block can never be requested (no registered grammar, over the block cap); a block of any shape part 1 refused has a key', () => {
        expect(blockKey('ts', 'a')).toEqual({ kind: 'key', key: 'ts\u0000a' });
        expect(blockKey('nope', 'a')).toEqual({ kind: 'unregistered' });
        expect(blockKey('', 'a')).toEqual({ kind: 'unregistered' });
        const big = 'a\n'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
        expect(blockKey('python', big)).toEqual({ kind: 'over-cap', chars: big.length });
        // Literal sizes, one over each retired bound: the grammar cap (8 192), the word (256), the line (2 048), the blank run (2 048).
        for (const [lang, raw] of [
          ['ts', 'a\n'.repeat(4097)], ['python', 'a'.repeat(257)], ['python', 'a '.repeat(1025)], ['python', `a${'\n'.repeat(2049)}b`],
        ] as const) expect(blockKey(lang, raw).kind, `${lang}, ${raw.length} characters`).toBe('key');
      });
    ```
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/highlight-names.test.ts test/markdown-bounds.test.tsx test/docs-highlight-budget.test.tsx test/highlight-store.test.ts )` — Expected red: `docs-scans` 2 (the retired-word case and its planted case, which finds BASE's hits beside the planted one); `highlight-names` 1 (`'highlightNames.ts imports and re-exports from no module'`); `markdown-bounds` 6 (each `RETIRED_SHAPES` row: part 1 refuses it, so no request arrives); `docs-highlight-budget` 5 (the new describe's four cases, and the rewritten F10 case); `highlight-store` 1 (the keyOf case). The kept-caps case and the xml case pass already. Everything else green.
- [ ] **Step 3: Delete part 1's bounds from production.**
  - **`markdownLimits.ts`.** Delete everything from the line that begins `/** The longest run of word units a code block may hold and still be highlighted (W5 bound r10); a word unit is a` through `export const DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS = 131072;` (the seven declarations, contiguous, and their docstrings, the residual note among them). Replace `/** One code block's characters, at most, that highlight.js is asked to colour. */` with `/** One code block's characters, at most, that the main thread posts to the highlight worker: it bounds the input one\n *  block clones across the worker boundary, and the main thread checks the length itself (base spec 4.9, re-argued by\n *  W5h-b); the worker's deadline, not this cap, bounds the time a block takes, whatever its shape. */`, and `/** Code characters per Docs page, at most, that highlight.js is asked to colour. */` with `/** Code characters per Docs page, at most, that the main thread posts to the highlight worker, summed in document order\n *  with every drawn copy counted; a block past it is never posted and stays plain (base spec 4.9, re-argued by W5h-b). */`. After the W5h section's header paragraph (Task 2's, ending `… x HIGHLIGHT_BOOT_BUDGET_MS = 18 750 ms.`), add one comment line `//` and then:
    ```ts
    // What the highlight limits leave (base spec 4.9, rewritten by W5h-b when it retired W5 part 1's main-thread highlight
    // bounds): no highlight.js runs on the main thread. There, per block, the main thread posts at most
    // MD_HIGHLIGHT_BLOCK_MAX_CHARS, receives at most MD_HIGHLIGHT_MAX_HTML_CHARS, checks it in one linear pass and inserts
    // it once; per Docs page it posts at most DOCS_HIGHLIGHT_PAGE_MAX_CHARS and inserts at most
    // DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS; upgrade re-renders are at most one per `pre`, so DOCS_MAX_RENDER_ELEMENTS bounds
    // their count. On the phone R19 measured, checking, inserting and laying out 2 097 145 characters of highlight HTML
    // in one commit took 276 ms. highlight.js's own time is the worker's, bounded per block by HIGHLIGHT_BLOCK_DEADLINE_MS
    // and per store by HIGHLIGHT_PAGE_WORKER_MS and HIGHLIGHT_PAGE_MAX_TIMEOUTS, whatever shape a block takes.
    ```
  - **`highlightNames.ts`.** Replace the header's two lines `// Imports only \`markdownLimits.ts\`, for part 1's caps, until W5h-b, and nothing after. The helpers below the banner` and `// moved here from \`markdown.tsx\`, their text unchanged (Task 6 deleted that file's copies).` with `// Imports nothing (base spec 4.10's Files table): W5h-b retired W5 part 1's main-thread highlight bounds, whose caps and\n// scans this file held until then.`. Delete the line `import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS } from './markdownLimits';` and the blank line after it. Delete everything from the line `// ---- Until W5h-b: what W5 part 1's main-thread bounds need (base spec 4.10; the W5h-a plan's refinement (n)). ----` to the end of the file, and keep the file's final newline after `codeLanguage`'s closing `}`.
  - **`highlightGrammars.ts`.** Replace the header's first five lines (from `// The highlight worker's grammars: one private highlight.js instance with the 15 grammars part 1 registered, and the` through `// Task 6 deletes them, so two instances coexist meanwhile: the core module's default and \`HLJS\`).`) with:
    ```ts
    // The highlight worker's grammars: one private highlight.js instance with the 15 grammars part 1 registered (native
    // Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 Files and "The private instance"; M4.H3, M4.H5, M4.H6).
    // `xmlWithoutSubLanguages` moved here from `markdown.tsx` in W5h-a; the grammar-graph helpers that derived part 1's
    // per-grammar caps retired with those caps in W5h-b.
    ```
    In `xmlWithoutSubLanguages`'s docstring, replace `which is why it has a page budget of its own,\n *  \`DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS\`; the claim` with `which W5 part 1 gave a page budget of its own\n *  (retired in W5h-b); the claim`, and `and chat's golden files are unchanged. \`xml\` and \`markdown\` then reach no\n *  bounded grammar, so they keep the 64 KiB cap. */` with `and chat's golden files are unchanged.\n *  It stays after W5h-b retired part 1's other bounds (base spec 4.10 "What stays"): it keeps xml linear on those\n *  regions, so fewer xml, html and markdown blocks reach the worker's deadline, and restoring script and style\n *  colouring would change chat's golden files. */`. Delete `embeddedGrammars` and `deriveBoundedCaps` with their docstrings: everything from `/** The registered grammars a definition embeds through highlight.js \`subLanguage\`, by registered name. A grammar's` through `deriveBoundedCaps`'s closing `}` and the blank line after it, so that `/** ccrc's own alias lists, registered beside the aliases each grammar declares.` follows `xmlWithoutSubLanguages`'s `};` and one blank line. `HighlightApi` and `LanguageFn` stay (the job and the strip use them).
  - **`highlightStore.ts`.** Replace the header's lines from `//   - \`blockKey(lang, raw, part1)\` is the ONE function that answers a key, or why the block can never be requested:` through `//     ask it, so they never disagree.` with `//   - \`blockKey(lang, raw)\` is the ONE function that answers a key, or why the block can never be requested: no\n//     registered grammar, or over MD_HIGHLIGHT_BLOCK_MAX_CHARS (W5h-b retired W5 part 1's per-block bounds).\n//     \`store.keyOf\` is it; \`CodeBlock\` and the seeding walk both ask it, so they never disagree.`, and in the next bullet `the input ceiling and (until W5h-b) part 1's scan and markdown page budgets\n//     apply here.` with `the input ceiling applies here.`. In the import from `'./highlightNames'`, keep `HIGHLIGHT_NAME_SET, codeLanguage, isRegisteredGrammar` and drop the other six names; in the import from `'./markdownLimits'`, drop `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`, `DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS`, `MD_HIGHLIGHT_MAX_BLANK_CHARS`, `MD_HIGHLIGHT_MAX_LINE_CHARS` and `MD_HIGHLIGHT_MAX_WORD_CHARS`. In `BlockKey`, delete the two lines `  /** Until W5h-b: one of W5 part 1's per-block bounds, with the figure its label reads. */` and `  | { readonly kind: 'part1'; readonly bound: 'grammar-cap' | 'word' | 'line' | 'blank'; readonly chars: number };`, and end the previous line, `  | { readonly kind: 'over-cap'; readonly chars: number }`, with `;`. Replace `blockKey`'s docstring and signature (`/** THE key function (section 4.10 "Keys"). \`part1\` (until W5h-b) applies W5 part 1's per-block bounds, in BASE's\n *  label order: the grammar cap, the word, the line, the blank run. */\nexport function blockKey(lang: string, raw: string, part1 = true): BlockKey {`) with `/** THE key function (section 4.10 "Keys"): no registered grammar, then over the block cap, else the key. */\nexport function blockKey(lang: string, raw: string): BlockKey {`, and delete its `  if (part1) {` block (the line and the eight lines after it, through its closing `  }`). Replace `/** Which ceiling skipped a block: one of the four page ceilings, or (until W5h-b) one of part 1's page budgets. */\nexport type SkipCeiling = 'page-input' | 'page-output' | 'page-timeouts' | 'page-worker-time' | 'part1-scan' | 'part1-markdown';` with `/** Which of the four page ceilings skipped a block. */\nexport type SkipCeiling = 'page-input' | 'page-output' | 'page-timeouts' | 'page-worker-time';`. Replace `/** \`mode\` is the store's owner kind. The other three exist for R19's page (refinement (k)): production passes\n *  \`{ mode }\` alone, so part 1's bounds and the ceilings are on and the debounce is chat's constant (Docs: none). */` with `/** \`mode\` is the store's owner kind. The other two exist for R19's page (the W5h-a plan's refinement (k)): production\n *  passes \`{ mode }\` alone, so the ceilings are on and the debounce is chat's constant (Docs: none). */`, and delete `  readonly part1?: boolean;` and `  const part1 = options.part1 ?? true;`. In `seed`, replace the lines from `    let scan = 0;` through `          : inMarkdown && markdown > DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS ? 'part1-markdown' : null;` with:
    ```ts
        for (const b of blocks) {
          const k = blockKey(b.lang, b.raw);
          if (k.kind !== 'key') continue;
          // Every occurrence counts: each drawn copy inserts the key's text and HTML again (review 1364 F1).
          input += b.raw.length;
          const past: SkipCeiling | null = ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS ? 'page-input' : null;
    ```
    (the `let input = 0;` above it and the `if (!seeded.has(k.key)) {` below it stay). In the returned object, replace `keyOf: (lang, raw) => blockKey(lang, raw, part1),` with `keyOf: (lang, raw) => blockKey(lang, raw),`.
  - **`markdown.tsx`.** Replace the header lines `// Bounded per W5 Task 3 (section 4.10's "Bounds on the shared components"): \`CodeBlock\` does not highlight a block`, `// holding a word longer than \`MD_HIGHLIGHT_MAX_WORD_CHARS\` (r10), and \`keystrokeParts\` moved to \`markdownGuard.ts\`,` and `// where the parse's element count calls it too (2-2) and it refuses a span over \`MD_KEYSTROKE_MAX_CHARS\` (r11).` with `// Bounded per W5 Task 3 (section 4.10's "Bounds on the shared components"): \`keystrokeParts\` moved to \`markdownGuard.ts\`,\n// where the parse's element count calls it too (2-2) and it refuses a span over \`MD_KEYSTROKE_MAX_CHARS\` (r11). W5h-b\n// retired r10's word bound and the main-thread highlight bounds beside it: highlight.js runs only in the worker.`. In the next header line (it begins `// W5h-a Task 6 (base spec 2026-10-01 section 4.10 "Highlighting"): this file no longer imports highlight.js.`), replace `` `LANG_LABEL`, `codeLanguage` and part 1's scans to `highlightNames.ts`, `` with `` `LANG_LABEL` and `codeLanguage` to `highlightNames.ts`, ``. In `codeBlockLabel`, delete the three lines `    case 'part1':`, `      return answer.bound === 'grammar-cap' ? kib` and `        : \`${label} · not highlighted (a ${answer.chars}-character ${answer.bound === 'word' ? 'word' : answer.bound === 'line' ? 'line' : 'run of whitespace'})\`;`, and replace `      return entry.ceiling === 'part1-scan' || entry.ceiling === 'part1-markdown' ? label : \`${label} · not highlighted (page highlighting limit)\`;` with `      return \`${label} · not highlighted (page highlighting limit)\`;`.
  - **`highlighterContext.ts`** (one docstring; nothing else in the file changes). Replace `/** A production store: part 1's bounds and the ceilings on, chat's debounce for a chat store (section 4.10). */` with `/** A production store: the page ceilings on, chat's debounce for a chat store (section 4.10). */`.
  - **`highlightMeasureRun.tsx`.** Replace `{ mode, part1: false, ceilings: false }` with `{ mode, ceilings: false }`, `{ mode: 'docs', part1: false }` with `{ mode: 'docs' }`, and `{ mode, part1: false, ceilings: false, debounceMs: d }` with `{ mode, ceilings: false, debounceMs: d }`. In its comments, delete the phrases `, none of part\n//      1's bounds` (item 1's line), `, none of part 1's bounds` (item 7's line and the `// Item 7:` comment) and `, no part-1 bounds` (the `// Item 5:` comment), and replace `/** W5 part 1's crafted shapes, from \`markdownLimits.ts\`'s notes, each in its grammar, under the block cap. */` with `/** The crafted shapes W5 part 1's reviews found (its notes in \`markdownLimits.ts\` retired with its bounds in W5h-b),\n *  each in its grammar, under the block cap. */`. `git grep -n -w part1 -- pwa/src/screens` prints nothing. Then `git grep -n -E "part 1's (bounds|scans|caps)|part-1 bounds" -- pwa/src` lists only sentences that call those bounds retired (this step's new headers); a sentence that describes them as live is rewritten the same way. The retired-word scan stays on identifiers and `part1`: the historical sentences W5h-b writes name part 1 in words.
- [ ] **Step 4: Delete part 1's cases; re-home what stays.** Remove every import and helper a file no longer uses after these deletions (`noUnusedLocals`: `TSC-OK` proves it). Test prose: this step rewrites the header and comments of every file and case it edits; other test comments that name part 1's bounds as history are out of Task 4 lens 2's "by reading" scope (lens 3 reads the tests).
  - **`markdown-bounds.test.tsx`.** Rewrite the header (lines 1-13) to describe r11 and 2-2 as they stand, then: `// r10, and the word, line, whitespace and per-grammar bounds part 1 set beside it, retired in W5h-b (M4.H23):\n// highlight.js runs only in the highlight worker, under its per-block deadline (M4.H7). The first describe shows each\n// shape they refused is now requested whole; the last holds the xml subLanguage strip, which stays.` Delete these describes whole: `'W5 bound r10: no highlighting for a block holding a word longer than MD_HIGHLIGHT_MAX_WORD_CHARS'`, `'the line bound: no highlighting for a block holding a line longer than MD_HIGHLIGHT_MAX_LINE_CHARS'`, `'T13 review 4-3: a block the page budget refuses labels itself by its size when it is over the cap'`, `'Review 439 F1: a fence of whitespace that spans lines is not highlighted past MD_HIGHLIGHT_MAX_BLANK_CHARS'` and `'review 450 F1: typescript, javascript and rust have their own, smaller block caps'`. In `'review 450 F1, the closure: a grammar that embeds a bounded grammar through \`subLanguage\` is bounded too'`: retitle it `'the xml subLanguage strip, kept by W5h-b (M4.H23): xml carries no sub-language inside <script> or <style>'`; replace its opening comment with `// \`xml\` is registered WITHOUT its script and style sub-languages (highlight.js's xml is quadratic on those regions\n// whatever they embed); the strip stays after W5h-b. Literal sizes, never the imported constants.`; delete `BASE`, `closure`, the cases `'the module\'s bounded set is exactly the closure of the base set under the registered grammars\' subLanguage references'`, `'today that set is typescript and javascript at 8 192 and rust at 4 096; yaml\'s ruby and xml\'s handlebars are not registered'`, `'every name of HIGHLIGHT_BOUNDED_CAPS and every alias highlight.js resolves to it takes its cap and the scan budget; every other grammar takes 65 536 and does not'`, `'inMarkdownPageBudget is true for markdown and every alias highlight.js resolves to it, and false for every other name'`, `'a grammar that embeds nothing bounded keeps the 64 KiB cap: 20 000 characters of dockerfile (embeds bash) are highlighted'` and `'a ts block of 10 000 characters the page budget refuses is labelled by its own cap: 10 KiB'`, and the nested describe `'deriveBoundedCaps on synthetic grammars'`. Keep `shape`, `scripted`, `subLanguagesOf`, `real`, `HLJS_SPANS`, `shapes`, `'the registered xml carries no subLanguage on any mode …'`, the two `it.each` at 8 192, Task 2's 65 536 cases, the 64 KiB xml/html/svg case, `'markup outside script and style is still coloured'` and `'an html fence with a script and a style carries no keyword, selector or attribute span inside them'`. Keep `'W5 bound r11: …'`, `"W5 bound 2-2: …"` and Step 1c's describe.
  - **`docs-highlight-budget.test.tsx`.** Rewrite the header (lines 1-11) so it names one ceiling at seed, `skipped:page-input`, and says part 1's two sub-budgets retired in W5h-b; drop "(no word, line or blank run over part 1's bounds)" from it. Delete the constants `SCAN` and `MARKDOWN`, the describes `'review 450 F1: the scan budget, …'` and `'review 450 F1: the markdown budget, …'` (the latter holds `'(f) rendered: …'`), and, in `'F1: a page of copies of one block, …'`, the case `'the scan budget: copies of one typescript fence past the scan sum are plain and keep the bare label (part 1\'s ceiling is not the page\'s)'`. In `'D-7574 characterization: highlight decisions across the three budgets, with the aliases ts, tsx and md'`: retitle it `'D-7574 characterization: highlight decisions at the page input ceiling, with the aliases ts, tsx and md'`; rewrite its comment so it names the grammar facts the seed reads now (`codeLanguage` and `isRegisteredGrammar`) and no retired helper; delete C2, C3 and C5; keep C1 and C6; rename C7 to `'C7 ts and md blocks filling the page exactly, and every later block is refused'` (its body holds as it is); and replace C4's body with `    expect(codeBlocksOf(root([block(['hljs', 'language-TSX'], 'a'), block('language-ts', 'b'), block(['language-md', 'language-ts'], 'c')]))\n      .map((b) => b.lang)).toEqual(['tsx', 'ts', 'md']);`. Replace the describe `'D-7574: the Docs page hands detachUrls the real highlight-budget languages'` (its comment stays, less "a block past a budget" → "a block past the page input ceiling") with:
    ```tsx
    describe('D-7574: the Docs page seeds its store from the tree it draws', () => {
      it('through DocMarkdown, a tsx block and an md block past the page input ceiling are never requested and say so', async () => {
        const tsx = lang('tsx', 12);
        const md = lang('md', 12);
        const page = await drawn(root([...spreadLang('python', 524288, 65536), tsx, md]));
        const raws = codeBlocksOf(root([tsx, md])).map((b) => b.raw);
        expect(page.docs.calls.some((c) => raws.includes(c.code))).toBe(false);
        const labels = [...page.container.querySelectorAll('.code-block-lang')].map((l) => l.textContent);
        expect(labels.slice(-2)).toEqual(['TSX · not highlighted (page highlighting limit)', 'Markdown · not highlighted (page highlighting limit)']);
      }, 120000);
    });
    ```
  - **`highlight-store.test.ts`.** Delete the cases `'INPUT: the same with part 1 on (the block is within every per-block bound of its grammar)'`, `'SCAN: copies of one typescript block count in part 1\'s scan sum too: the first copy past it is skipped by part1-scan'`, `'MARKDOWN: copies of one markdown block count in part 1\'s markdown sum too'`, `'part 1\'s scan page budget skips at seed with its own ceiling, and only its grammars; part1 off, never'` and `'part 1\'s markdown page budget skips at seed with its own ceiling, and only markdown'`. Retitle `'INPUT: copies of one block are admitted until their combined length passes the page input ceiling, then skipped as copies; the key is still requestable, one job (part1 off: no per-block bound applies)'` to end at `…, one job`, and replace its `setup({ mode: 'docs', part1: false })` with `setup()`. `git grep -n -w part1 -- pwa/test/highlight-store.test.ts` prints nothing.
  - **`highlight-names.test.ts`.** In the header, replace `in both directions, holds part 1's grammar caps equal to their derivation over the worker's grammars (until\n// W5h-b), and pins the instance:` with `in both directions, holds \`highlightNames.ts\` to importing nothing (W5h-b), and pins the instance:`. Delete the case `'part 1\'s grammar caps equal deriveBoundedCaps over the worker\'s grammars (until W5h-b)'`, the import `import { MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';`, `deriveBoundedCaps` from the `highlightGrammars` import and `HIGHLIGHT_BOUNDED_CAPS` from the `highlightNames` import.
  - **`markdown-limits.test.ts`.** Delete the seven retired entries from `VALUES`, and retitle `'exports exactly the twenty-nine limits'` to `'exports exactly the twenty-two limits'`.
  - **`docs-markdown.test.tsx`.** In `'the page highlight budget reaches the blocks: of nine 60 000-character python blocks the ninth is not highlighted'`, replace the two comment lines `    // 60 000 characters in 60 lines of 1 000 (the line bound caps a line at MD_HIGHLIGHT_MAX_LINE_CHARS, so one long line` and `    // would be unhighlighted), with no long run of blank units (the whitespace bound, MD_HIGHLIGHT_MAX_BLANK_CHARS).` with the one line `    // 60 000 characters in 60 lines of 1 000, with no long run of blank units: ordinary code, cheap to highlight.`.
- [ ] **Step 5: Export's word (M4.H23's Export clause, refinement (j)).** The anchors are Export's plan's text; Step 0 confirmed them on `main`, and Step 0's hit list is the full set.
  - `pwa/src/docs/export/policy.ts`: replace ` *  structural refusals); no highlight worker; and, until W5h-b, refused by W5 part 1's bounds. */` with ` *  structural refusals); or no highlight worker. */`, and `export type ExportPlain = 'over-cap' | 'page-ceiling' | 'timeout' | 'too-large' | 'failed' | 'no-worker' | 'part1-bounds';` with `export type ExportPlain = 'over-cap' | 'page-ceiling' | 'timeout' | 'too-large' | 'failed' | 'no-worker';`.
  - `pwa/src/docs/docsText.ts`: delete the line `  'part1-bounds': 'refused by the page highlight bounds',`.
  - `pwa/src/docs/export/colouring.ts`: delete the header line ``// `part1-bounds` (W5 part 1's per-block bounds and its two page budgets) goes with W5h-b (M4.H23).``; delete the four lines `    if (answer.kind === 'part1') {`, `      count('part1-bounds');`, `      continue;`, `    }`; replace `        count(entry.ceiling === 'part1-scan' || entry.ceiling === 'part1-markdown' ? 'part1-bounds' : 'page-ceiling');` with `        count('page-ceiling');`.
  - `pwa/test/docs-export.test.tsx`: in `'EXPORT_PLAIN_SENTENCE has one sentence per class of plain block, and none takes a field'`, drop `'part1-bounds', ` from the expected keys; in `'counts each plain class under its closed word, a coloured block not at all, and an unregistered one not at all'`, drop `'scan', ` from `raws`, the block `{ lang: 'bash', raw: 'w'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1) },`, the entry `[key('bash', 'scan')]: { kind: 'skipped', ceiling: 'part1-scan' },` and `'part1-bounds': 2, ` from the expected map; drop `MD_HIGHLIGHT_MAX_WORD_CHARS` from its `markdownLimits` import. Any other hit in Step 0's list is handled the same way (the word, its sentence, its count and its fixture go; nothing else changes).
- [ ] **Step 6: Run to verify they pass.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/highlight-names.test.ts test/markdown-bounds.test.tsx test/docs-highlight-budget.test.tsx test/highlight-store.test.ts test/markdown-limits.test.ts test/docs-markdown.test.tsx test/docs-export.test.tsx )` — green. Then, unchanged: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/render-hast.test.tsx test/markdown-highlight.test.tsx test/markdown-runner.test.ts test/highlight-wiring.test.tsx test/chat-hardening.test.tsx test/highlight-html.test.tsx test/highlight-measure.test.tsx test/markdown-highlight-worker.test.ts test/markdown-purity.test.ts test/tool-well.test.tsx test/docs-screen.test.tsx )` — green. `TSC-OK`. `git grep -n -w -E 'part1|<the seventeen retired names of Step 0>' -- pwa/src` prints nothing; `git diff --stat <BASE> -- pwa/test/golden` is empty; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/rings/totality.test.ts test/single-definition/ )` — green.
- [ ] **Step 7: Measure this task's rows.** Run W5HB-T3-M1 to M8, and the re-anchored W5HA-T5-M5 and W5HA-T6-M4, one at a time by the LOW DISK procedure (saved copy and sha256, the row's `old` → `new`, its `tests`, the red line recorded, restore, sha check, `git status --porcelain` unchanged). Every row red; a count that differs from its prediction is reported to the coordinator with the extra case names.
- [ ] **Step 8: Commit, once.** Stage the Files list by name (`git status --porcelain` shows nothing else), message `pwa: retire W5 part 1's main-thread highlight bounds; the worker's deadline and the page ceilings bound highlighting (docs W5h-b)`, trailer. This is the retirement's one commit. Record the task's JSON row fence, and the re-anchored W5HA-T5-M5 and W5HA-T6-M4 measured now, in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HB-T3-M1 | M4.H23 | pwa | `src/lib/markdownLimits.ts` | `export const MD_KEYSTROKE_MAX_CHARS = 64;` → `export const MD_KEYSTROKE_MAX_CHARS = 64;\nexport const MD_HIGHLIGHT_MAX_LINE_CHARS = 2048;` | `test/docs-scans.test.ts`, `test/markdown-limits.test.ts` | 3 failed — `'M4.H23: no retired limit, part-1 helper or part1 word is left anywhere in pwa/src'`; `'M4.H23 planted: a retired limit declared again, a helper named in a comment, and a part1 word in a string are each red'` (its copies carry the mutation too); `'exports exactly the twenty-two limits'` |
| W5HB-T3-M2 | M4.H23 | pwa | `src/lib/highlightGrammars.ts` | `xml: xmlWithoutSubLanguages,` → `xml,` | `test/docs-scans.test.ts`, `test/markdown-bounds.test.tsx` | 1+ failed — among them `'M4.H23: the worker\'s xml carries no sub-language inside <script> or <style>; stock xml beside javascript and css, the control, does'` |
| W5HB-T3-M3 | M4.H23 | pwa | `src/lib/highlightGrammars.ts` | `delete m.subLanguage;` → `void m.subLanguage;` | `test/docs-scans.test.ts`, `test/markdown-bounds.test.tsx` | 1+ failed — among them the same xml case |
| W5HB-T3-M4 | M4.H23 (refinement (m)) | pwa | `src/lib/highlightNames.ts` | `export const HIGHLIGHT_GRAMMARS: readonly string[] = [` → `import { MD_HIGHLIGHT_BLOCK_MAX_CHARS as PLANTED } from './markdownLimits';\nexport const PLANTED_CAP = PLANTED;\nexport const HIGHLIGHT_GRAMMARS: readonly string[] = [` | `test/highlight-names.test.ts` | 1 failed — `'highlightNames.ts imports and re-exports from no module'` |
| W5HB-T3-M5 | M4.H23 (Export clause) | pwa | `src/docs/export/policy.ts` | `export type ExportPlain = 'over-cap' \| 'page-ceiling' \| 'timeout' \| 'too-large' \| 'failed' \| 'no-worker';` → `export type ExportPlain = 'over-cap' \| 'page-ceiling' \| 'timeout' \| 'too-large' \| 'failed' \| 'no-worker' \| 'part1-bounds';` | `test/docs-scans.test.ts` | 2 failed — `'M4.H23: no retired limit, part-1 helper or part1 word is left anywhere in pwa/src'`; the planted case (its copies carry the mutation too) |
| W5HB-T3-M6 | M4.H12 label (W5h-b) | pwa | `src/lib/markdown.tsx` | ``return `${label} · not highlighted (page highlighting limit)`;`` → `return label;` | `test/docs-highlight-budget.test.tsx` | 1+ failed — among them `'nine 60 000-character python blocks: the first eight are highlighted and the ninth is not'` and `'through DocMarkdown, a tsx block and an md block past the page input ceiling are never requested and say so'` |
| W5HB-T3-M7 | M4.H23 (Export clause: `EXPORT_PLAIN_SENTENCE`) | pwa | `src/docs/docsText.ts` | `'no-worker': 'this browser has no highlight worker',` → `'no-worker': 'this browser has no highlight worker',\n  'part1-bounds': 'x',` | `test/docs-scans.test.ts` | 2 failed — `'M4.H23: no retired limit, part-1 helper or part1 word is left anywhere in pwa/src'`; `'M4.H23 planted: a retired limit declared again, a helper named in a comment, and a part1 word in a string are each red'` (its copies carry the mutation too). `tsc` would also refuse the key (`Record<ExportPlain, string>`), but that refusal is not this row's red: the row's red is vitest's |
| W5HB-T3-M8 | M4.H23 (the per-block bounds stay gone) | pwa | `src/lib/highlightStore.ts` | `if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };` → `if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };\n  if (raw.length > 8192) return { kind: 'over-cap', chars: raw.length };` | `test/markdown-bounds.test.tsx`, `test/docs-highlight-budget.test.tsx`, `test/highlight-store.test.ts` | 3+ failed — among them `markdown-bounds.test.tsx`'s `'8 193 characters of typescript (its grammar cap): one request with the whole text, and the bare label while it waits'`, `docs-highlight-budget.test.tsx`'s `'a ts block over 8 192 characters and a rust block over 4 096 each have a key: part 1\'s grammar caps are gone'` and `highlight-store.test.ts`'s `'keyOf: a key, or why the block can never be requested (no registered grammar, over the block cap); a block of any shape part 1 refused has a key'` (every block over 8 192 characters in those files reds with them) |

**Verify:** Step 6's runs green; Step 7's rows red; `TSC-OK`; `git log -1 --stat` shows the one commit holding every file of Files.

### Task 4: Whole-branch review (held out), its fixes, and `## Deviations found`

**Model routing:** reviewers `opus`, five lenses; one `sonnet` refute pass per finding; fixes by `sonnet` implementers, each reviewed by `opus`.

- [ ] **Step 1:** Five `opus` lenses over `BASE..HEAD` against this plan and the spec: (1) the values (each docstring's basis against "R19, as measured" and §4.9's rule; the gate's arithmetic; Export's longest wait; that the plan's reading of item 5 matches `highlightMeasureRun.tsx` and `highlightStore.ts#onPosted`); (2) the retirement's completeness (no part-1 bound, label, skip word, option, helper or datum left in `pwa/src`, by reading, not only by the scan; the xml strip and the two input caps kept and re-argued; the residual note rewritten; Export's word gone with nothing else of Export changed); (3) the tests (every deleted case belonged to a retired bound; every kept guard still has a case; the re-pointed cases prove absence without running a crafted shape in-thread; the over-cap cases routed by Step 0's measurement; F3's sum and F4's boundary); (4) the mutation table, the re-anchored W5h-a rows and "Rows retired and re-pointed" (each retired row's code is gone, each replacement row reds); (5) spec and deviation fidelity (each refinement against the spec text; the departures (b) and (c) each numbered once), plus the public-repo scan of every changed file.
- [ ] **Step 2:** Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 3: Define the deviations.** Replace this plan's `## Deviations found` working list with the issued numbers: the first two go to the departing refinements (b) and (c), in that order, then any departure found while executing, in the order found; unused numbers are written without the `D-` prefix. Entry form: `- **D-<n> (<date>)** — <slug> (refinement (<letter>)). <what departs from which spec sentence, and why>. <Task and rows that apply it>.` Then: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green; `grep -c '^- \*\*D-[0-9]* (' <plan>` equals the number defined; `sed -n '/^## Deviations found/,/^## /p' <plan> | grep -nE 'D-<n|<date>|D-TBD-[a-z0-9]'` prints nothing. Commit `docs: W5h-b's deviations, as issued (docs W5h-b)`.

### Task 5: Close — suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus), with `sonnet` subagents for the runs.

- [ ] **Step 1: Suites**, each in the foreground through `ccrc test`, split to fit: the whole `pwa` suite in pieces; `tsc --noEmit`; `markdown-worker-built` alone; the browser file `browser/tool-well-colour.browser.test.ts` locally (`( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/tool-well-colour.browser.test.ts )`; `resolveChrome()` finds the box's Playwright Chromium, `CCRC_CHROME` only if it throws; never leave a browser process behind); `git fetch -q origin main`, then the WHOLE `server` suite in pieces (every file under `server/test`, split by directory and name so each call fits; not a hand-picked list); `git diff --stat <BASE> -- pwa/test/golden` empty. Re-run any known load flake alone before calling it broken. A red census in another programme's file is the Scope exception: stop and ask.
- [ ] **Step 2: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline: every `W5HB-*` row (last occurrence of each id); the re-anchored W5h-a rows (W5HA-T1-M3, W5HA-T1-M4, W5HA-T5-M5, W5HA-T6-M4); and every other W5h-a row anchored in a file this wave edits whose recorded red names only cases this wave deleted or renamed (list them first by reading W5h-a's "Rows as measured" against the end state's case names, and record the list). Every row red, every restore sha-checked, `git status --porcelain` clean after the last row. A W5h-a row whose red changes is restated in the results with its new count, as the coordinator restates a prediction (no number).
- [ ] **Step 3: Draft, do not commit.** Write `## W5h-b results` into this plan in the working tree: the counts per suite; every task's JSON row fence as measured, and the W5h-a rows re-measured; Task 2 Step 0's six HTML lengths and where each case went; Task 3 Step 0's hit lists; "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-w5h-b/pr-body.md` (gitignored): title `Docs W5h-b: the measured highlight values, and part 1's main-thread bounds retired`; R19 in brief (the phone, the corpus, the gate's pass); the values table with each basis in one line; Export's longest wait (18 750 ms); what the retirement deletes and what stays (the xml strip, the two input caps); the departures (b) and (c) with their issued numbers; the Later items (the per-job latency and R19's breakdown); the expected CI (the PR's selection; `browser (pwa)` gates in the merge queue, and this run's local result); the plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives.
- [ ] **Step 4: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan) and the drafted PR body: rc 0, zero hits. A hit is fixed, and the scan re-run, before Step 5. Remove `$HOME/.cc-tmp/w5hb-mut/`.
- [ ] **Step 5: Commit the results, last.** Stage this plan by name, message `docs: W5h-b's results (docs W5h-b)`, trailer. This commit is the `handoffCommit` and the branch tip; nothing is committed after it.
- [ ] **Step 6: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 7:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Working list, until Task 4 Step 3 replaces it with the issued numbers: the departing refinements (b) (`HIGHLIGHT_PAGE_MAX_TIMEOUTS` stays 2, not §4.9's "smallest count no real page reaches", 1) and (c) (`MD_HIGHLIGHT_MAX_HTML_CHARS` is 1 048 576, not §4.9's "highest HTML ratio … times `MD_HIGHLIGHT_BLOCK_MAX_CHARS`, with headroom"), in that order; then any departure found while executing, in the order found.

## Where things stand

### Agreed
- R19 ran once on the operator's phone on 2026-11-03 (the operator, the W5h-a plan's approval of 2026-11-02 for its bound and its page). Its retirement gate passes: no real block, cold, comes near the operator's 2 s bound, and the deadline was not raised.
- The order the spec set: the seven values first, then all of W5 part 1's main-thread highlight bounds retired in a commit of their own, with the xml strip, the 64 KiB block cap and the 512 KiB page cap kept (§0 `offthread-highlight` ruling 3; the coordinator's ruling b of 2026-10-15). R19's page stays shipped.
- The two minor test gaps review run 1366 carried from W5h-a are closed here (the ledger, 2026-11-03).
- The coordinator's ruling of 2026-11-02 on R19's item 8: the debounce is read off the three fixed cadences, conditional on chat's real cadence (D-7756).
- W5h-b is dispatched after Export merges (coordinator, 2026-11-03), so it removes Export's `part1-bounds` itself and its BASE holds Export.
- The operator's answers of 2026-11-03 ("Approve both with every recommendation", given on the console): Q1, `HIGHLIGHT_PAGE_WORKER_MS` is 12 000 ms; Q2, `MD_HIGHLIGHT_MAX_HTML_CHARS` is 1 048 576 (refinement (c), a departure); Q3, `HIGHLIGHT_PAGE_MAX_TIMEOUTS` stays 2 (refinement (b), a departure); Q4, the per-job latency is a follow-up after Export and W5h-b. The departing refinements stay plan-only: they are numbered at the run's opening and recorded in `## Deviations found`.

### Waiting on you
- Nothing before dispatch. The run opens once Export has merged.

### Answered by the operator (2026-11-03)
- The plan was approved, and every question answered with its recommendation. The questions as asked:
  - **Q1. `HIGHLIGHT_PAGE_WORKER_MS`.** Recommended: **12 000 ms**, so the largest real pages colour fully on a phone like yours, at the cost of up to 12 s of worker time for a hostile page or chat message (your screen stays responsive; other blocks on the same highlighter wait) and an Export wait of up to 18.75 s. Item 5's page was the one with the most code characters, not the most blocks; this repository has real docs within the render gate with more blocks (about 280 to 295 fences in several plans), and at about 40 ms a block those may still colour partly at 12 000 until the Later re-run settles the value. Alternatives: keep 3 000 ms (large real pages colour their first third on your phone until the per-job latency is fixed, Q4), or hold W5h-b until that fix is designed and measured.
  - **Q2. `MD_HIGHLIGHT_MAX_HTML_CHARS`.** Recommended: **1 048 576** (a departure from §4.9's product rule): dense 64 KiB JSON and every real block of twelve grammars colour; one block costs the main thread about 140 ms at most. The rule's literal value, 2 621 440, would also colour a 64 KiB block made only of single-character JSON tokens, cost about 345 ms a block, sit above the page's own cap, and need W5h-a's ceiling tests re-derived.
  - **Q3. `HIGHLIGHT_PAGE_MAX_TIMEOUTS`.** Recommended: **keep 2** (a departure from §4.9's "smallest count no real page reaches", which is 1): at 1 the first timeout ends a page's highlighting before that block's line-by-line retry can run.
  - **Q4. The per-job latency.** Recommended: a small follow-up after Export and W5h-b, not this wave: R19's item 5 learns to split the main thread's latency from the worker's time (and to draw at the reader's width, try the page with the most blocks, and report each page's HTML); then a design (the likeliest: the store tells its blocks once a frame, not once an answer); then you re-run R19 and `HIGHLIGHT_PAGE_WORKER_MS` is set again.

### Later
- The per-job latency and R19's item 5 breakdown (Q4), then `HIGHLIGHT_PAGE_WORKER_MS` re-set from the split figure; with it, R19 measures a boot over the network (a page no service worker controls), which could let `HIGHLIGHT_BOOT_BUDGET_MS` come down.
- R19 reports each page's HTML, so `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS`'s "never less than the largest real page's HTML" is measured, not argued (refinement (d)).
- W8 rules on the colouring difference between the reader path and the plain fallback, the highlight.js version split and the two grammar sets (the rich-docs spec); W8 now follows W5h-b with part 1's bounds gone.
- Restoring xml's `<script>` and `<style>` colouring: the strip stays until you rule on it.
