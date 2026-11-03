# Native Docs reader, wave 5h-a — highlighting off the main thread (the worker path) Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 3 (2026-11-02): drafted at base `02622053c312e6d93819d19a54d17c03e1639cc5` (`origin/main`, 2026-11-02); revised the same day after review round 1 (three lenses, each finding refuted against BASE; all 21 applied, with the coordinator's rulings on R19's item 8, dense JSON, census entries, mutation-row text and the scan's order), then after a scoped re-review (five items: the command registry's two id-pinning cases, `block`'s retired prop, the hook's `show` pinned, Task 8 Step 3b's row, every row's `old` quoted exactly). **Approved by the operator on 2026-11-02, with every recommendation taken:** tool wells move onto the worker (refinement (a)); the departures (b), (e), (f), (h) and (q) are accepted as plan-only; dense JSON or YAML staying plain until W5h-b is accepted, and the provisional per-block HTML cap stays 262 144; R19's retirement bound, the longest wait for one block's colours, is 2 s; the measurement page lives at `/settings/measure-highlighting`; one run. Nothing is dispatched yet.

**Scope:**
- In: the new limits at provisional values (M4.H22); the pure registry modules `highlightNames.ts` and `highlightGrammars.ts` (M4.H5, M4.H6); the highlight worker and its job (M4.H13, M4.H18 and M4.H20 worker halves; M4.H3); the generic `createWorkerRunner` with the ready handshake and the `'detach'` abort, the parse runner unchanged as one instance, `spawnHighlightWorker`, `docsHighlighter` and `chatHighlighter` (M4.H7-M4.H10); the store and the main-thread check (M4.H11-M4.H14, M4.H18); `CodeBlock` on the store behind the one sink, `HighlighterContext` and the test store, with chat, the Docs page, text leaves and tool wells on the worker path (M4.M1, M4.P10, M4.H1, M4.H2 re-proved); chat's streaming rules, the prewarms and the Export hand-off (M4.C4, M4.C5, M4.H16, M4.H19); the scans and the built chunk (M4.H4, M4.H15, M4.H17, M7.11); R19's measurement page behind the session gate (M7.12). Part 1's main-thread bounds stay in force throughout, applied from `highlightNames.ts`'s data.
- Out: W5h-b (the measured values, retiring part 1's bounds, M4.H23); Export (M4.H21, M4.EX15, M4.EX17, M4.EX18, the settled-outcome context, `EXPORT_PLAIN_SENTENCE`); Share; W6 (Source as a one-block store, M5.16's third file); W8b; any highlight.js version change; the library programme's requests (a)-(c), which are listed as a hand-off and which nothing here depends on; the reader path's colouring (the frame keeps the library's `render()` and its own highlighting, W8a's refinement (e)).

**Goal:** No path in the main bundle runs highlight.js. Every code block in chat, on a Docs page's plain pipeline, in a text leaf and in a tool well renders plain first, in its final layout, and gains its colours when a dedicated highlight worker answers. One block per job, each under its own deadline: an overrun terminates that worker and leaves only that block plain. The main thread inserts the worker's HTML only after a strict, linear check, through the one `dangerouslySetInnerHTML` in `lib/markdown.tsx`. The measurement page lets the operator time the real corpus once on the phone, which W5h-b needs to set every value.

**Architecture:** highlight.js moves into a closure of four worker-side modules: `lib/highlightGrammars.ts` (a private `hljs.newInstance()`, the 15 grammars, the xml strip, moved from `lib/markdown.tsx`), `lib/highlightJob.ts` (one highlight call per job, the HTML cap, the worker-side LRU, the line retry), `lib/highlightProtocol.ts` (types only) and the entry `lib/markdownHighlightWorker.ts`, which posts `{ready: true}` and assigns `onmessage`. The main thread knows grammars only as data, `lib/highlightNames.ts`, held equal to the worker's registry by a test. `lib/markdownRunner.ts` becomes the generic `createWorkerRunner<M, O>` (a FIFO, a timer started at post, terminate on expiry, sticky `worker-unavailable`, id matching, plus two options: a ready handshake under a boot budget, and `abortRunning: 'terminate' | 'detach'`); the parse runner, with W8a's render job, is one instance, its behaviour pinned by the existing `markdown-runner.test.ts` rows; the highlighter is another, `createHighlighter()`, with two singletons. `lib/highlightStore.ts` holds one content-keyed store per Docs page, text leaf, chat message or tool well: `keyOf`, `seed`, `peek`, `request`, `subscribe`, `settled`, the page ceilings, the line retry and the check, whose only product is a frozen `CheckedHighlightHtml` recorded in a module-private `WeakSet`. `CodeBlock` reads its entry with `useSyncExternalStore` and requests in an effect; `HighlightedCode`, the one sink, inserts only a value `isCheckedHighlightHtml` accepts. `lib/highlighterContext.ts`'s `HighlighterContext` is the one seam: its default is the production singletons and store factory, tests replace it with `pwa/test/highlightTestStore.tsx`. A Docs page's store (created in `DocParse`) or a text leaf's (in `TextBody`) is published through the context's `publish` slot, which is what Export will read. R19's page, `screens/HighlightMeasure.tsx`, runs eight measurements on its own highlighter instances, spawned through `spawnHighlightWorker()`, and shows one text result.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`), React 19 (`useSyncExternalStore`), Vite 8 (`worker: { format: 'es' }`, unchanged), vite-plugin-pwa (`globPatterns` already admits the new chunk), vitest 5 on jsdom (no `Worker` global), highlight.js 11.12.0 (the version in the lock at BASE; no change), Node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (the base spec), as amended on 2026-10-15 for W5h ("W5h" throughout): §0 `offthread-highlight` (rulings 1-5 and the coordinator's a-e); §2's Risks, R19; §4.1's W5h rows; §4.4's "The text leaf"; §4.9's limits table, "What the highlight limits bound" and "W5 part 1's highlight bounds under W5h"; §4.10's Highlighting (Files, the job and its outcome, the worker-side cache, the highlight runner and its singletons, the store, page ceilings, `CodeBlock`, the line retry, the single sink and its check, Tests, Guards, the main thread's worst case, "What W5h changes in these bounds"); §4.11's `detachUrls` sentence; §4.12's chat clause 2 and "Chat highlighting"; §4.15's M4.M1, M4.P10, M4.H1, M4.H2, M4.C4, M4.C5; §7.7's W5h-a row; §7.8's R19; §7.9's W5h-a suites; §7.10's M7.11, M7.12 and the W5h rows M4.H3-M4.H20, M4.H22. With `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (the rich-docs spec): A2a, A6, A22, M9.14, the W5h-a and W8a rows of its §8, its requests (a)-(c), and its §1.4 terms "Highlight worker" and "C24".

**Ledger:** `docs/superpowers/programs/native-docs-reader.md`: Waves row 5h-a, the Decisions entry of 2026-10-15 (five operator rulings and the coordinator's rulings, the split into W5h-a and W5h-b among them), the W8 split of 2026-10-31 (W8a beside W5h-a and Share), and the "Next-wave brief (W5h-a and Share)".

**Format:** Markdown, by the operator's ruling of 2026-10-07. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 11's scratch tools parse this file's `### Task` headings and the JSON row fences each task's last step records.

**What changed at BASE since the spec was amended (each checked at BASE, each handled below):**
- **W8a (#2061) put a second job kind on the parse runner.** `markdownRunner.ts` posts a parse job as `{id, src, profile}` and the reader's render job as `{id, kind: 'render', src}` through one FIFO, and `markdownWorker.ts` answers the latter through one literal `import('./readerRenderJob')`. The generic runner keeps both kinds exactly as they are. They are pinned by `markdown-runner.test.ts` (M4.P6, M4.P7, M4.P8, M4.P11, "the queue: FIFO, abort, prewarm, dispose", "two runners", "source pins", the two T11 review describes, and "W8a Task 4: a render job on the same runner"), `reader-render-job.test.ts` and `markdown-worker-built.test.ts`'s render-chunk describe. Task 4 adds the one pin they lack (a parse runner ignores a `{ready: true}` message) before it touches the runner.
- **`lib/highlightCache.ts` exists (desktop polish C7, #1767).** It is a pure, bounded LRU (`createLru`, entries and weight), which `markdown.tsx#highlighted` uses as a module-scope cache of highlight.js's markup on the MAIN thread, at `HIGHLIGHT_CACHE_MAX_ENTRIES = 256` and `HIGHLIGHT_CACHE_MAX_CHARS = 4_000_000` (declared in `markdown.tsx`). It is neither the spec's store nor its worker-side cache, but it is exactly the worker-side cache's shape: Task 3 reuses `createLru` inside the highlight worker, and Task 1 moves the two bounds into `markdownLimits.ts` (refinement (c)). The main-thread cache goes with the main thread's highlighting (Task 6). `pwa/test/setup.ts`'s `clearEveryLru()` stays: it now empties the worker module's caches that tests build in-thread.
- **W8a's reader shows a Markdown leaf through the library's frame, which colours code itself.** W5h-a changes nothing on that path: `ReaderFrame.tsx`, `docs/reader/*` and `lib/readerRenderJob.ts` are byte-identical. What W5h-a changes is the plain pipeline (`DocMarkdown`), which the reader falls back to and which renders every Markdown leaf where the reader is off, plus text leaves, chat and tool wells. The two paths may colour one fence differently; the operator accepted that on 2026-10-31 (W8a's refinement (e)), and W8 rules on it later.
- **W8a added source scans.** `docs-scans.test.ts`'s W8a clause already names `src/lib/markdownHighlightWorker.ts` among `MESSAGE_ASSIGN_HOMES`, so the new entry's `onmessage` assignment passes it unchanged; the library-specifier homes, the `postMessage` ban in `pwa/src/docs`, M8.21's render-job rule and the precache split are untouched by this wave (no new library import, nothing under `pwa/src/docs` posts). `markdown-runner.test.ts`'s source pin "no other lib/markdown* file posts or receives messages" would red the day `markdownHighlightWorker.ts` lands; Task 4 widens it in place to the spec's M4.H3 message clause, with planted controls.
- **A highlight consumer the spec does not name.** The tool wells (`session/ToolWellText.tsx`, #1732) call `markdown.tsx#boundedHighlight` directly and hold a second `dangerouslySetInnerHTML`. W5h-a moves them onto `chatHighlighter` and the one sink (refinement (a)).
- **highlight.js is already 11.12.0 in the lock** (W8a measured it; the spec's "11.11.1" sentences are stale). "No highlight.js bump in W5h" holds trivially (refinement (d)).

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). Every test injects its highlighters, its spawn, its clock, its parser and its loaders; no test reaches a real server or a real `Worker`.
- **FIXTURE HOME.** No task runs `ccd`. If any guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); never the live `$HOME`, and quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once, in its own workspace (`npm ci` in each); this wave changes no `package.json` and no lock. The only transient directories are the built-output tests' own `mkdtemp` builds and `docs-scans.test.ts`'s tree copies, which they remove. Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/w5ha-mut/<id>.orig` with its sha256, apply the row's `old`→`new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/w5ha-mut/` is removed at Task 11.
- **Scope.** W5h-a creates `pwa/src/lib/{highlightNames,highlightGrammars,highlightProtocol,highlightJob,markdownHighlightWorker,highlightStore,highlighterContext}.ts`, `pwa/src/screens/HighlightMeasure.tsx`, `pwa/src/screens/highlightMeasureRun.tsx`, `pwa/test/highlightTestStore.tsx`, `pwa/test/{highlight-names,markdown-highlight-worker,highlight-store}.test.ts` and `pwa/test/{highlight-html,highlight-wiring,highlight-measure}.test.tsx`. It edits `pwa/src/lib/{markdownLimits,markdownRunner,highlightCache}.ts`, `pwa/src/lib/markdown.tsx`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`, `pwa/src/docs/{DocMarkdown,DocsLeaf}.tsx`, `pwa/src/docs/docsLinks.ts`, `pwa/src/screens/DocsScreen.tsx`, `pwa/src/session/ToolWellText.tsx`, `pwa/src/session/toolWell.ts` (one comment line), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (one cell of its ring-context-map table, Task 9), `pwa/test/{markdown-limits,markdown-purity,markdown-runner,markdown-worker-built,docs-scans,reader-images,tool-well-plan,command-registry}.test.ts`, `pwa/test/{markdown-golden,render-hast,markdown-highlight,markdown-bounds,code-block,docs-highlight-budget,docs-markdown,docs-screen,docs-links,docs-images,tool-well,chat-hardening,app,command-layer}.test.tsx`, `pwa/test/setup.ts` (one comment), `pwa/browser/tool-well-colour.browser.test.ts` (one wait), and this plan (Task 10 appends `## Deviations found`'s numbers, Task 11 appends `## W5h-a results`). Byte-identical: `shared/**`, `server/src/**`, `agent/**`, `ccd/**`, `deploy/**`, `ui/**`, `.github/**`, `pwa/package.json`, `pwa/package-lock.json`, `pwa/vite.config.ts`, `pwa/index.html`, `pwa/src/lib/{markdownWorker,markdownParse,markdownGuard,readerRenderJob,readerLimits,useParsedMarkdown}.ts`, `pwa/src/lib/renderHast.tsx`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/reader/**`, `pwa/src/docs/share.ts`, `README.md`, every file under `pwa/test/golden/**`. Any other file is a stop-and-ask.
- **Base.** The child workspace is minted from `main` at or after `02622053c312e6d93819d19a54d17c03e1639cc5`. Task 1 Step 0 runs a **content** check, not an ancestry check (`T1-BASE-OK`), and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-02-native-docs-reader-w5h-a/progress.md`.
- **Rings and seams.** Every new `pwa/src` file states its ring in its header, which `pwaRing` decides (`server/test/rings/pwa-rings.test.ts`): L1 `lib/highlightNames.ts`, `lib/highlightGrammars.ts`, `lib/highlightJob.ts` and `lib/highlightStore.ts` (pure: the store takes its clock and its highlighter as arguments and names no timer global); L2 `lib/highlightProtocol.ts` (types only); L4 `lib/markdownHighlightWorker.ts` (the worker entry, as `markdownWorker.ts` is), `lib/highlighterContext.ts` (composition: the production singletons and the store's real clock; its header says "L4 composition"), `screens/HighlightMeasure.tsx` and `screens/highlightMeasureRun.tsx`. No L1 file imports a `.tsx`, a store or `lib/api.ts`. No timer handle is kept at module scope or on an object field outside L4. `shared/` gains nothing. No overloaded `null`: `checkHighlightHtml` answers `null` for one condition (refused); `PreHighlightContext`'s `null` means one thing (no store: the block renders plain); every other answer is a discriminated union (`BlockKey`, `HighlightEntry`, `HighlightOutcome`, `HighlighterStatus`).
- **highlight.js's homes.** From Task 6 on, an import of any `highlight.js` specifier in `pwa/src` sits only in `lib/highlightGrammars.ts` (`highlight.js/lib/core` and the 15 `highlight.js/lib/languages/*` part 1 registers). Before Task 6, `lib/markdown.tsx` and `docs/DocsLeaf.tsx` keep their BASE imports. Tests (`pwa/test`, `pwa/browser`) may import highlight.js and `highlightGrammars.ts`; `pwa/src` never imports anything under `pwa/test`.
- **Exact values.** The spec's numbers are imported where they are declared, never restated in production code: every limit from `pwa/src/lib/markdownLimits.ts`. New values are declared once there (Task 1): `HIGHLIGHT_BLOCK_DEADLINE_MS = 750`, `HIGHLIGHT_BOOT_BUDGET_MS = 2000`, `HIGHLIGHT_PAGE_WORKER_MS = 3000`, `HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2`, `MD_HIGHLIGHT_MAX_HTML_CHARS = 262144`, `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152` and `HIGHLIGHT_STREAM_DEBOUNCE_MS = 250` (the seven provisional values, each docstring starting `PROVISIONAL (W5h-a; W5h-b sets it from R19).`), `HIGHLIGHT_LINE_RETRY_UNITS = 256`, and, moved from `markdown.tsx` unchanged, `HIGHLIGHT_CACHE_MAX_ENTRIES = 256` and `HIGHLIGHT_CACHE_MAX_CHARS = 4000000`. R19's measurement-only deadline, `MEASURE_DEADLINE_MS = 60000`, is declared once, in `screens/highlightMeasureRun.tsx`, because no production path reads it.
- **Never spelled by this wave:** an import of `highlight.js` in `pwa/src` outside `lib/highlightGrammars.ts` (from Task 6); a second `new URL('./markdownHighlightWorker.ts'` literal in `pwa/src` (the one is in `markdownRunner.ts#spawnHighlightWorker`); a `dangerouslySetInnerHTML` in `pwa/src` outside `lib/markdown.tsx#HighlightedCode` (from Task 6); `addPlugin`, `configure` or `debugMode` on any highlight.js instance; a second declaration of a limit; a quoted section slug in `pwa/src` (derive it from `DOC_SECTIONS`); the standalone docs server's lower-case name or directory name anywhere in `pwa/src`, in this plan's code or in a comment (write "the shared Markdown library"; M7.9 reds on the word in `pwa/src`); real host, user, project, pool, account or path names (use `demo`, `a`, `b`, `example-org/example-repo`); raw control bytes in fixtures (build them with `String.fromCharCode`); in R19's result, any project name, path, file name or code text (a block is named by its grammar, its length and an ordinal); a `D-` number outside `## Deviations found`; a `D-TBD` token in any commit (`server/test/dtbd.test.ts`).
- **PUBLIC REPO.** `Synapsium-Labs/ccrc-pwa` is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 11 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Cite code by `file#symbol` or `file#@anchor`, never by line number (`anchors.test.ts`, `citations.test.ts`). Each Find block must match exactly once; if it is absent or matches twice, stop and ask the coordinator. A later task that re-spells anchored code re-anchors the earlier row under the same id.
- **File-shape invariants are judged NET against BASE.** Counts a step relies on are re-derived at that step, never carried from planning.
- **Text-scan guards** use the TypeScript AST (`ts.createSourceFile`), or list their known evasions in the header as "NOT EXHAUSTIVE" (lesson 8).
- **Built artefacts.** Anything visible only in the BUILT bundle (the second worker chunk, its precache entry, highlight.js absent from the main chunks) gets a production-build test that runs `vite build` in a node child, not in jsdom (`markdown-worker-built.test.ts`'s `BUILDER` pattern). Never set a `CCRC_SW_DENYLIST` covering `/docs` in any PWA run's environment.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and records the measured rows as ONE JSON fence (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`) in the SDD ledger at its last step; Task 11 copies every fence into `## W5h-a results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `W5HA-T<n>-M<k>`; `spec` carries the spec's row id (M4.Hxx, M4.Cx, M7.1x) where there is one. A row whose code a later task rewrites is re-anchored by that task under the same id. **A row's `old` and `new` quote the file's own text**, never this plan's: for a file this plan writes, the fenced code less the fence's indentation; a single-line row is quoted from its first non-blank character (the Edit tool's exact match then finds it once and leaves the file's indentation as it is), and a later line of a multi-line row carries the file's indentation, written as `\n` plus the spaces. Every `old` matches the file at the task's end state exactly once; one that does not is a stop-and-ask. **Every row names its expected failing test file(s), the failing case(s) and a count**: an exact count (`1 failed`) or a floor (`1+ failed`, naming the case that must be among them). A measured count that differs from an exact count, a floor not reached, or a named case that stays green is a stop-and-ask.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, built-output tests, the browser file, mutation runs) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `typecheck-tests`, `fleet-screen`, `session-hook`, `ccd-*`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. The browser file is `( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts <file> )` and needs `CCRC_CHROME` as the brief gives it. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`.
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 10's last step defines them in `## Deviations found`. A session that cannot reach the allocator writes `D-TBD-<slug>` in its report only, never in a commit.
- **Open work touching this wave's files** (measured at planning; re-measured at dispatch and at each Step 0): Share runs in parallel, from its own plan, and may touch `pwa/test/docs-scans.test.ts` (an appended clause), `pwa/src/screens/DocsScreen.tsx`, `pwa/test/docs-screen.test.tsx` and `pwa/src/docs/DocsLeaf.tsx`. Export follows W5h-a and reads `HighlighterContext`'s `publish` slot and the store's `keyOf`, `peek` and `settled`. Whichever of W5h-a and Share merges second takes `main` and re-measures. Every clause this wave appends to a shared test file goes after the file's last describe and names W5h-a in its banner comment, so a merge is an append on both sides.
- **Carried items** (the ledger's "Carried constraints (reviewers get these)", in substance; none is fixed here unless named):
  - W8a's residue is W8b's and is not touched here (the pending fragment, the same-page link, the overlong image `src`, the copy check through the real library, the browser battery's control gaps, the smaller items).
  - W3's accepted residue, W2's parked minors and one-reader scan residue, W3's prose residue, SEC-3, SEC-4, the missing stamp after a failed post-fetch, `branch: null`'s two meanings, the partial-clone answer, the over-cap `bytes`, and every W7 prose item: not this wave.
  - W4's carried items: nesting continued by indentation (shape (c)); the sync path's cost on a crafted message of 4 KiB or less; review 1-4; the 2-2 residual; N1's minors; M4.P12's "count only after render"; r10 and r11. **W5h-a closes r10's highlight.js half by construction** (from Task 6 no main-thread module imports highlight.js); r11 and 2-2 stay with part 1's keystroke bounds, unchanged. Review 5-2 goes to W7. W6's M5.16 carry stands: M4.H3's message clause pins the third worker file until W6's M5.16 carries it.
  - U5: the private vulnerability report is not filed yet.
- **Commits.** One per task (Task 10's fixes one per finding), files staged by name, message `<area>: <what> (docs W5h-a)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Task 11 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR. The spec amendment of 2026-10-15 is already on `main`; this wave's departures (the refinements marked "Departure" below) are plan-only: the spec's sentences are not edited by this wave, and each departure is numbered once issued. The child workspace therefore holds this plan; Task 10 and Task 11 append to it on the branch, and Task 11's PR body links its GitHub `blob/main` path.
- **The run row and the issued block.** The coordinator opens W5h-a's run row (`planned`) and is issued a contiguous deviation block by `POST /api/ledger/deviations` at run-open, at least thirteen numbers: six for the departing refinements (a), (b), (e), (f), (h) and (q), in that order, the rest for departures found while executing and fix rounds. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the base. W5h-b gets its own run row and block when it is planned, after R19.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `pwa/src/lib/markdown.tsx`, `pwa/src/lib/markdownRunner.ts`, `pwa/src/lib/markdownLimits.ts`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/docsLinks.ts`, `pwa/src/screens/DocsScreen.tsx`, `pwa/src/session/ToolWellText.tsx`, `pwa/test/docs-scans.test.ts`, `pwa/test/markdown-runner.test.ts`, `pwa/test/markdown-purity.test.ts`, `pwa/test/markdown-worker-built.test.ts`, `pwa/test/docs-screen.test.tsx`, `pwa/test/app.test.tsx`, `pwa/test/command-layer.test.tsx`, `pwa/test/command-registry.test.ts`, `pwa/test/markdown-limits.test.ts`, `pwa/src/session/toolWell.ts`, `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, `pwa/browser/tool-well-colour.browser.test.ts`. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-11, the base, the issued block, the claim state, Share's state, `CCRC_CHROME`, and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers, `high` effort; an `opus` per-task reviewer for Tasks 4, 5 and 6 and a `sonnet` one for the rest; the whole-branch panel on `opus` (Task 10) with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill (kill only recorded PIDs), any `gh` write verb, any token in an argv, and a `CCRC_SW_DENYLIST` covering `/docs`.
- **Worker flow:** the worker acks, runs Tasks 1-9 with native subagents, puts questions to the operator as structured asks, lists mail before every push and before its wave-done. Escalations to the operator: none planned; any measured behaviour of the parse runner that the refactor of Task 4 changes is a stop (the refactor must leave every existing case green, unchanged). Task 10 is the held-out whole-branch review and its fix wave. Task 11 closes: the suites, the built-output tests, the browser file and the whole mutation table; it appends `## W5h-a results` (that commit is the `handoffCommit` and the tip), pushes the workspace branch, opens the ONE pull request, measures the fingerprint with that PR's number and `prPhase: 'open'`, and sends the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming five lenses: (1) the main thread's bound (no highlight.js reachable from the main bundle, the check's linearity and its accepted forms, the one sink, the length re-checks, what a hostile page or message can still cost); (2) the runner (the parse runner's behaviour unchanged, the handshake, the boot budget and the sticky states, detach, the deadline, id matching, dispose); (3) the store (content keys, references and release, the ceilings and their latch, the line retry, `settled()`, seeding order, eviction, the publish slot, no overloaded null); (4) the test and mutation table, the test store's seam, the migrated suites' meaning kept (goldens byte-identical, part 1's rows green beside the new path); (5) spec and deviation fidelity (each refinement against the spec text, each departure numbered once), R19's page (reads only, names nothing private, passes every census and architecture suite), plus the public-repo scan.
- **Merge gate:** the operator's approval of this plan (given 2026-11-02); the reviewer's report accepted by the coordinator; the PR's required checks green (a change to `pwa/src` only, so the PR runs its selection; `test (pwa)` and `build-pwa` run in full); `browser (pwa)` green in the merge queue (a fast PR skips it, so grep its log before treating a green as a run). Every row named in §7.7's W5h-a row green: M4.H3-M4.H20 and M4.H22 at the provisional values, M7.11 (its built no-DOM case and precache check among them), M7.12, M4.C4, M4.C5, M4.H1 and M4.H2 re-proved through the store, M4.M1 and M4.P10 over settled output, and part 1's rows for its highlight bounds still green beside them. No R1/R2 gate: W5h-a changes no server route.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel). The operator rolls it out, fleet first (`ccrc rollout --to vX.Y.Z`; PWA only, so fleet first holds); phones take it at the service worker's next update check. Then: (1) the operator opens Settings › Measure highlighting once on the phone (the palette's "Go to Settings › Measure highlighting", or `/settings/measure-highlighting`), lets it finish, and sends the result; R19's retirement gate is measured against the operator's bound of 2 s for one block's colours (agreed 2026-11-02); (2) W5h-b is planned from it. Export is planned after W5h-a and Share merge; it does not wait for W5h-b.

## Review Focus

The untrusted inputs a person meets first, each pinned in the task that owns it:

| Input | What could go wrong | Pinned by |
|---|---|---|
| A crafted code block on a Docs page or in a chat message (a quadratic grammar shape, a huge identifier, a long line, a whitespace flood) | The main thread freezes inside highlight.js | Task 6 (highlight.js leaves `pwa/src`'s main-thread modules), Task 8 (M4.H4's source scan and the built chunks: W5HA-T8-M1, M2), Task 4 (the per-block deadline terminates the worker: W5HA-T4-M1), Task 5 (the page ceilings bound worker time and timeouts: W5HA-T5-M5-M8) |
| The worker's answer (HTML that a compromised or buggy grammar could emit) | Markup or an attribute reaching the DOM through the sink; a huge string parsed on the main thread | Task 3 and Task 5 (the worker's HTML cap and the main thread's re-check, M4.H13: W5HA-T3-M1, W5HA-T5-M9; the check's accepted forms and linearity, M4.H14: W5HA-T5-M1-M4; the page sum: W5HA-T5-M6), Task 6 and Task 8 (one sink, behind `isCheckedHighlightHtml`, M4.H15: W5HA-T6-M2, W5HA-T8-M3) |
| A page of many blocks, or a page that keeps timing out | The worker is churned without end; Export (later) waits for ever; one block's overrun blanks the page | Task 4 (one block per job, only that block plain: M4.H7), Task 5 (M4.H12's four ceilings and `settled()`: W5HA-T5-M5-M8, M11) |
| A streaming chat message | One worker request per settle; a superseded answer colouring the wrong text; a respawn per settle | Task 4 (detach never terminates: W5HA-T4-M3), Task 7 (M4.C5's debounce, the closed fence requested once: W5HA-T7-M1, M2) |
| The worker failing to load or to boot (an old browser, a broken chunk, no `Worker`) | A main-thread fallback that brings highlight.js back; a hang | Task 4 (the handshake and the boot budget, sticky after two failures, sticky unavailable: W5HA-T4-M2, M4, M5, M6; M4.H8, M4.H10), Task 5 and Task 7 (no Worker: plain at once, bare label: W5HA-T5-M15, W5HA-T7-M3; M4.C4) |
| R19's page (reachable by any signed-in session) | A write, a refresh, a stored or sent result, a private name in its output | Task 9 (M7.12's clauses: W5HA-T9-M1-M4; the result names no project, path or code: W5HA-T9-M5) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/src/lib/markdownLimits.ts`, `pwa/test/markdown-limits.test.ts` | 1 | L1 | The seven provisional limits, the line-retry units, the two cache bounds moved from `markdown.tsx` (M4.H22) |
| `pwa/src/lib/highlightNames.ts` | 2 | L1 | Pure data: the 15 grammar names, their aliases, `LANG_LABEL`, `codeLanguage`, `isRegisteredGrammar`; until W5h-b, part 1's grammar caps, its page-budget sets and its three scans (moved from `markdown.tsx`) |
| `pwa/src/lib/highlightGrammars.ts` | 2 | L1 (worker side) | `HLJS`, the one private `hljs.newInstance()`; the 15 registrations and ccrc's three alias lists; `xmlWithoutSubLanguages` and `deriveBoundedCaps` (moved from `markdown.tsx`) |
| `pwa/src/lib/highlightProtocol.ts` | 2 | L2 | Types only: `HighlightJob`, `HighlightReply`, `HighlightResult`, `HighlightOutcome`, `HighlightRequest`, `Highlighter`, `HighlighterStatus` |
| `pwa/test/highlight-names.test.ts` | 2 | — | M4.H5 (one registry, both directions; part 1's grammar caps equal the derivation), M4.H6 (one `newInstance`, no `addPlugin`/`configure`/`debugMode`) |
| `pwa/src/lib/highlightJob.ts`, `pwa/src/lib/markdownHighlightWorker.ts`, `pwa/src/lib/highlightCache.ts` (header) | 3 | L1 / L4 | `createHighlightAnswerer`: one call per job, the HTML cap before posting, the LRU, `mode: 'line'` under C24; the entry posts `{ready: true}` |
| `pwa/test/markdown-highlight-worker.test.ts`, `pwa/test/markdown-purity.test.ts` | 3 | — | M4.H13, M4.H18 and M4.H20 worker halves; M4.H3's closure (appended describe) |
| `pwa/src/lib/markdownRunner.ts`, `pwa/test/markdown-runner.test.ts` | 4 | L3 as today | `createWorkerRunner`, the parse runner as an instance, `createHighlighter`, `spawnHighlightWorker`, `docsHighlighter`, `chatHighlighter`; M4.H7-M4.H10 runner halves; M4.H3's message clause |
| `pwa/src/lib/highlightStore.ts`, `pwa/test/highlight-store.test.ts`, `pwa/test/highlight-html.test.tsx` | 5 | L1 | `blockKey`, `codeBlocksOf`, `checkHighlightHtml`, `isCheckedHighlightHtml`, `createHighlightStore`; M4.H11, M4.H12, M4.H13 main half, M4.H14, M4.H18 store half |
| `pwa/src/lib/highlighterContext.ts`, `pwa/src/lib/markdown.tsx`, `pwa/test/highlightTestStore.tsx` | 6 | L4 | `HighlighterContext`; `CodeBlock` on the store; `HighlightedCode`, the one sink; chat's store per message |
| `pwa/src/docs/{DocMarkdown,DocsLeaf}.tsx`, `pwa/src/docs/docsLinks.ts`, `pwa/src/session/ToolWellText.tsx` | 6 | L4 / L1 / L4 | The Docs page's store, seeded; `detachUrls` without its sums; the text leaf's one-block store; the tool wells on `chatHighlighter` |
| the migrated suites (Task 6's list) | 6 | — | M4.M1, M4.P10, M4.H1, M4.H2 re-proved; part 1's rows kept |
| `pwa/src/lib/markdown.tsx`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/highlight-wiring.test.tsx`, `pwa/test/chat-hardening.test.tsx` | 7 | L4 | The streaming debounce and eviction, the prewarms, the `publish` slot; M4.C4, M4.C5, M4.H16, M4.H19 |
| `pwa/test/docs-scans.test.ts`, `pwa/test/markdown-worker-built.test.ts` | 8 | — | M4.H4 (source and built), M4.H15 (scan half), M4.H17, M7.11 |
| `pwa/src/screens/{HighlightMeasure,highlightMeasureRun}.tsx`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`, `pwa/test/highlight-measure.test.tsx`, `pwa/test/app.test.tsx`, `pwa/test/command-layer.test.tsx`, `pwa/test/docs-scans.test.ts` | 9 | L4 | R19's page behind the session gate, its route, M7.12 |

## Spec refinements (decided while planning)

Each refinement marked **Departure** contradicts a sentence of the spec or of BASE's code the spec relies on, and gets one issued number in `## Deviations found` (Task 10's last step), in the order below. The others fill a silence or record a measurement.

- **(a) Tool wells join chat's highlighter and the one sink.** What: `session/ToolWellText.tsx` (#1732, after the amendment) highlights a tool call's input and result with `markdown.tsx#boundedHighlight` and holds a second `dangerouslySetInnerHTML`. From Task 6 each code or diff well holds a one-block store on `chatHighlighter` (chat's per-message ceilings), renders plain first through `HighlightedCode`, the one sink, and keeps BASE's rule that a well over a highlight bound shows its original text. Why: the spec's "no path runs highlight.js on the main thread" (§4.9) and M4.H15's single sink cannot hold otherwise; §4.10 names chat, Docs pages, text leaves and Export as the worker's clients and is silent on tool wells. Cost if wrong: a tool well flashes plain for one worker round trip, where today it is coloured in its first frame (the browser test `tool-well-colour.browser.test.ts` now waits for the colours). **Departure.**
- **(b) The worker's code lives in three files, not one.** What: §4.10's Files table puts the call, the HTML cap, the cache and the line retry in `lib/markdownHighlightWorker.ts`, importing `highlightGrammars.ts` and `markdownLimits.ts`. W5h-a keeps the entry as wiring only (it posts `{ready: true}` and assigns `onmessage`, as `markdownWorker.ts` does) and puts the logic in `lib/highlightJob.ts`, the protocol types in `lib/highlightProtocol.ts` (shared, type-only, by the worker and the main thread), and reuses `lib/highlightCache.ts`'s `createLru` for the cache. Why: the entry has a module side effect (it assigns `self.onmessage` and posts at import), so a test that imports it under jsdom would post to `window`; the parse worker is split the same way (`markdownParse.ts` and `markdownWorker.ts`); and the main thread may not import a module that reaches highlight.js, even for a type. Cost if wrong: none at run time; M4.H3's closure gains three first-party files, none of them a package. **Departure** (the Files table's text).
- **(c) The worker-side cache is BASE's C7 LRU, at BASE's bounds.** What: each highlight worker keeps one `createLru(HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_CACHE_MAX_CHARS, html => html.length)`, keyed on mode, language and code; the two bounds move from `markdown.tsx` to `markdownLimits.ts` under their BASE names and values (256 entries, 4 000 000 characters). Why: §4.10 leaves the bound to this plan; C7 measured it on chat's corpus and a dense 64 KiB JSON block. Two workers each hold one, so the worst case doubles C7's main-thread figure, off the main thread. Not a departure.
- **(d) highlight.js is 11.12.0 at BASE.** The spec's sentences about 11.11.1 predate W8a, which measured the lock at 11.12.0 (one copy). Nothing here changes the version. Not a departure (a measurement).
- **(e) The receipt check measures the length first.** What: §4.10 describes the structural check, then "two length re-checks follow". The store checks, in order: the per-block length (`MD_HIGHLIGHT_MAX_HTML_CHARS`, answered as `too-large`, which gets the line retry), then the structure (a refusal is `malformed`, in Export's `failed` class), then the Docs page sum (`DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS`, answered as `skipped` by that ceiling). Why: §4.10's "The main thread's worst case" bounds the linear pass by the per-block cap, which holds only if the length is compared first; an O(1) comparison before an O(n) pass is the cheap order. Cost if wrong: an answer that is both malformed and over the per-block cap is counted as "output too large" (and retried line by line) rather than "failed". **Departure** (the order of §4.10's sentences).
- **(f) M4.H4's built half admits the reader's render chunk.** What: M4.H4 says "no chunk but the highlight worker's carries a string the plan picks from `highlight.js/lib/core`". At BASE the library's `render()` already carries its own highlight.js inside the parse worker's lazy chunk, `readerRenderJob-*.js` (W8a; rich-docs spec A6 and A22). The built rule is: every emitted `.js` file carrying the marker is either the one `markdownHighlightWorker-*.js` (the control: it must carry it) or the one `readerRenderJob-*.js`; no other file does, so no main-thread chunk does. The marker is `did you forget to load/include a language module?`, part of highlight.js core's language-not-found message (checked in the installed copy at Task 8 Step 0). Why: the rich-docs spec keeps `render()`'s own highlighting on the reader path; both carriers are worker chunks. **Departure** (M4.H4's wording).
- **(g) A highlighter answers its status synchronously.** What: `Highlighter.status()` answers `'live'`, `'worker-unavailable'` (a spawn threw: sticky) or `'worker-failed'` (two boot failures in a row: sticky), spawning the worker if none is live. A store asks it before queuing a job and marks the entry `plain` at once when it is not `'live'`. Why: with no `Worker` (jsdom, an old browser) a request would otherwise settle on a later microtask, outside React's commit; the outcome is the spec's (plain, bare label, no main-thread fallback), only sooner. Fills a silence. Not a departure.
- **(h) The `publish` slot is built and filled; its holder and reader are Export's.** What: `HighlighterContextValue` gains an optional `publish(store | null)`; `DocParse` and `TextBody` call it with their store when it is created and with `null` when it goes; a test provides the slot and reads the store's `peek`, `keyOf` and `settled()` through it. Nothing in W5h-a provides the slot in production: the screen-level holder and the leaf's actions that read it (Export's sheet) land with Export, which "composes the two" (§4.10). Why: an unread state in `DocsScreen` and an ignored prop on `DocsHead` would be dead code until Export, and Export's plan owns the sheet that reads it. Cost if wrong: Export adds one `useState` and one provider in `DocsScreen`. **Departure** (§4.10 Tests: "the Docs leaf provides a nested value that adds one slot").
- **(i) R19's page, as planned.** What: the route is `/settings/measure-highlighting` (id `measure-highlighting`, a page under Settings, so the palette offers "Go to Settings › Measure highlighting"; not a Docs page key); the corpus is every committed Markdown file of every `ready` project's default view, read through `api.docs`' `projects`, `tree` and `file` at `DOCS_PWA_FETCH_CONCURRENCY`, parsed on `docsRunner`, its code blocks by `codeBlocksOf`; item 2's boot is the time from a fresh highlighter's first `highlight` call (which spawns) to that job's post (which waits for `{ready}`); item 4 checks and inserts a page of real answers through `checkHighlightHtml` and `HighlightedCode` in one commit and forces layout; item 5 renders the largest page through `DocMarkdown` under a store with no ceilings and no part-1 bounds; item 8's cadences are refinement (q); the result is shown in one read-only `<pre>`, which a tap on the page's `Select result` button (`@ccrc/ui`'s `Button`) selects whole, so the page draws no hand-drawn control (control-census) and writes no clipboard; the two page modules take a file row each in the 08-10 architecture spec's context table, beside `screens/DocsScreen.tsx` (C9 Docs), as ARCH-04's totality test requires; the result names no project, path, file or code, and describes the device only by `navigator.hardwareConcurrency` (the operator names the phone when sending it). Why: §7.8 leaves the route, the measurement deadline and the candidates to this plan, and the result is recorded in a public plan. Not a departure.
- **(j) Seeding counts what the store can request.** What: part 1's three page budgets moved from `detachUrls` (which summed every `pre`, its trailing newline included) into `seed`, which sums each requestable key once, in document order, over the block's raw text (one trailing newline stripped, as `CodeBlock` strips it). A block over the block cap, or in no registered grammar, no longer counts. The input ceiling's skip is labelled "· not highlighted (page highlighting limit)"; a skip by part 1's scan or markdown budget keeps part 1's bare label. Why: §4.10's Seeding says exactly this. Cost: part 1's boundary cases in `docs-highlight-budget.test.tsx` move by one character per block and need distinct block texts (Task 6 re-derives them). Not a departure.
- **(k) Three store options exist for R19.** What: `createHighlightStore(highlighter, { mode, part1?, ceilings?, debounceMs? }, clock)`. Production uses `{ mode }` (part 1's bounds on, ceilings on, chat's debounce `HIGHLIGHT_STREAM_DEBOUNCE_MS`, docs 0). `CodeBlock` and the seeding walk both ask `store.keyOf(lang, raw)`, which is `blockKey(lang, raw, part1)`, so they never disagree. Why: §7.8 runs items 1-5 and 8 with no page ceilings and none of part 1's bounds, item 7 under the shipped ceilings without part 1's bounds, and item 8 over several debounces. Not a departure.
- **(l) M4.H3's homes.** The closure half is an appended describe in `markdown-purity.test.ts` (its `closure()` gains two optional parameters, roots and allowed packages, defaulting to today's); the message half is `markdown-runner.test.ts`'s existing source pin, widened in place to `lib/markdown*` and `lib/highlight*` with the third worker file and two planted controls. §7.10 names `highlight-purity.test.ts` "or the names the plan chooses". Not a departure.
- **(m) One pin added before the refactor.** The parse runner's behaviour is pinned by the existing cases listed in "What changed at BASE"; Task 4 adds one more before touching the runner: a parse runner ignores a `{ready: true}` message and a reply with no `outcome`. Not a departure.
- **(n) Moved helpers keep their names.** `LANG_LABEL`, `codeLanguage`, `isRegisteredGrammar`, `HIGHLIGHT_BOUNDED_CAPS`, `highlightBlockCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `longestWordRun`, `longestLine` and `longestBlankRun` move from `markdown.tsx` to `highlightNames.ts` with their BASE signatures, computed from static data instead of highlight.js; `deriveBoundedCaps` and `xmlWithoutSubLanguages` move to `highlightGrammars.ts`. The three scans are functions, not data; they go with part 1's bounds in W5h-b. Not a departure (§4.10 puts part 1's data in `highlightNames.ts` until W5h-b).
- **(o) One store per parsed tree; no provider at the app root.** A Docs page's store is created when a tree settles and lives as long as that tree (Retry or Format anyway parse again and get a new store). `HighlighterContext`'s default value is the production one, so `app.tsx` needs no provider. Not departures.
- **(p) Chat prewarms on its first `ChatMarkdown` mount**, an idempotent `prewarm()`. Fills a silence ("chat prewarms `chatHighlighter` on its first mount"). Not a departure.
- **(q) R19's item 8 runs over three fixed settle cadences, not "chat's own".** What: §7.8 item 8 streams a message "at chat's own settle cadence" and reports "the gaps between settles". BASE has no fixed chat settle cadence: chat re-renders when stream frames arrive, at whatever pace the model and the link give them. The page therefore streams its 40-line fence at three cadences, `MEASURE_SETTLE_CADENCES_MS = [50, 100, 250]`, and for each cadence and each candidate debounce (0, 150, 250, 400 ms) reports the requests the growing block made and the time from its fence closing to its colours; it reports no settle gaps (they would be its own sleep). W5h-b sets `HIGHLIGHT_STREAM_DEBOUNCE_MS` from that table across cadences, and its basis is conditional on the real cadence, which no part of R19 measures. Why: a figure for a cadence nobody measured would read as a measurement. Cost if wrong: the debounce is tuned for a cadence chat does not have, so a stream asks the worker a little more or a little later than it could. **Departure** (§7.8 item 8's "chat's own settle cadence" and its gaps).
- **(r) A mounted block shows its key before it requests it.** What: the store gains `show(key)`, which a `CodeBlock` or a tool well calls for the key it displays (in the same effect that requests it, released on cleanup); a chat store's `settled()` reads the shown keys as well as the requested ones. Why: §4.10 defines a chat store as settled when "no key a mounted block references is `unrequested` or `pending`"; in the streaming debounce window a block shows a key it has not requested yet, and reading only requested keys would answer settled while the block is plain. Not a departure (it implements the spec's definition).
- **Measurements, not departures:** Task 2 Step 0's grammar and alias table on the installed highlight.js; Task 8 Step 0's marker check; Task 11's timings of the built chunks.
- **Census and architecture entries this wave adds, each with its reason** (the coordinator's ruling: a new screen, route or control passes BASE's suites in the task that adds it): the two page modules' rows in the 08-10 spec's ring-context-map table (`server/test/rings/totality.test.ts`); `command-registry.test.ts`'s Go-to oracle widened to `GO_TO`'s own rule (a page under a top route); `command-layer.test.tsx`'s Settings Go-to count; no control-census entry (the page draws no hand-drawn control); no stylesheet rule.

### Hand-off to the library programme (not this wave's work)

The three requests of §0 `offthread-highlight` stand. W8a recorded that library v1 ships (a) a public `./highlight` subpath and (b) `render()`'s `highlight` option; ccrc imports neither, and W5h-a does not depend on them. (c), the stock xml grammar's `<script>` and `<style>` cost under C24 with a hostile corpus case, is not known to have shipped; ccrc keeps its xml strip either way. The coordinator relays this list to the library programme; no code here changes.

### Task 1: The new limits, declared once (M4.H22)

**Model routing:** `sonnet`, effort `medium`. Little judgment: the values are this plan's.

**Spec rows:** §4.9's table (the seven W5h rows), "Two more", M4.H22; refinement (c).

**Files:**
- Modify: `pwa/src/lib/markdownLimits.ts` (ten declarations appended, one header sentence), `pwa/src/lib/markdown.tsx` (the two cache bounds' declarations replaced by an import), `pwa/test/markdown-limits.test.ts` (`VALUES`, the export count, one case), `pwa/test/markdown-highlight.test.tsx` (the two cache names' import moves).
- Guards (not edited): `pwa/test/markdown-purity.test.ts` (`markdownLimits.ts` stays in the parse closure and imports nothing).

**Decisions this task makes:** (1) The seven provisional values: `HIGHLIGHT_BLOCK_DEADLINE_MS = 750`, `HIGHLIGHT_PAGE_WORKER_MS = 3000`, `HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2` and `MD_HIGHLIGHT_MAX_HTML_CHARS = 262144` are §7.8's starting points; this plan picks `HIGHLIGHT_BOOT_BUDGET_MS = 2000` (34 ms measured on a server CPU in Node; a phone's chunk fetch, parse and grammar registration with a wide margin, and short enough that a worker that never boots costs a code block two seconds of plain), `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152` (2 Mi characters: admits M4.H2's eight 60 000-character blocks at the measured 2.90 HTML characters per input character, 1 392 000, with half again of headroom), and `HIGHLIGHT_STREAM_DEBOUNCE_MS = 250` (a pause in a stream, not a settle; R19's item 8 measures 0, 150, 250 and 400). (2) `HIGHLIGHT_LINE_RETRY_UNITS = 256` is C24's figure, not provisional. (3) The cache bounds move with their BASE names and values (refinement (c)).

- [ ] **Step 0: Base, claims, counts.** Run:
  `git grep -q "export const MD_KEYSTROKE_MAX_CHARS = 64;" HEAD -- pwa/src/lib/markdownLimits.ts && git grep -q "export const HIGHLIGHT_CACHE_MAX_ENTRIES = 256;" HEAD -- pwa/src/lib/markdown.tsx && git grep -q "export function createLru" HEAD -- pwa/src/lib/highlightCache.ts && git grep -q "worker.onmessage = (e) => {" HEAD -- pwa/src/lib/markdownWorker.ts && git grep -q "'src/lib/markdownHighlightWorker.ts'" HEAD -- pwa/test/docs-scans.test.ts && ! git grep -q "markdownHighlightWorker" HEAD -- pwa/src && git grep -q '"version": "11.12.0"' HEAD -- pwa/package-lock.json && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Record BASE (`git rev-parse HEAD`) in `.superpowers/sdd/2026-11-02-native-docs-reader-w5h-a/progress.md`. Confirm the claims on `markdownLimits.ts` and `markdown.tsx`. Record the starting counts of `markdown-limits.test.ts` and `markdown-highlight.test.tsx`.
- [ ] **Step 1: Edit `pwa/test/markdown-limits.test.ts`.** In `VALUES`, after `MD_KEYSTROKE_MAX_CHARS: 64,`, add:
  ```ts
    // W5h-a (base spec 4.9's W5h rows and "Two more"): seven provisional values, then two fixed ones, then the
    // highlight cache's two bounds, moved from markdown.tsx unchanged (the W5h-a plan's refinement (c)).
    HIGHLIGHT_BLOCK_DEADLINE_MS: 750,
    HIGHLIGHT_BOOT_BUDGET_MS: 2000,
    HIGHLIGHT_PAGE_WORKER_MS: 3000,
    HIGHLIGHT_PAGE_MAX_TIMEOUTS: 2,
    MD_HIGHLIGHT_MAX_HTML_CHARS: 262144,
    DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS: 2097152,
    HIGHLIGHT_STREAM_DEBOUNCE_MS: 250,
    HIGHLIGHT_LINE_RETRY_UNITS: 256,
    HIGHLIGHT_CACHE_MAX_ENTRIES: 256,
    HIGHLIGHT_CACHE_MAX_CHARS: 4000000,
  ```
  Rename the case `'exports exactly the nineteen limits'` to `'exports exactly the twenty-nine limits'` (its body is unchanged: it compares against `NAMES`). Append inside `describe('markdownLimits: the values of section 4.9', …)`:
  ```ts
    it('M4.H22: the provisional page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character', () => {
      expect(limits.DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS).toBeGreaterThanOrEqual(Math.ceil(8 * 60000 * 2.9));
      expect(limits.MD_HIGHLIGHT_MAX_HTML_CHARS).toBe(4 * limits.MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    });

    it('M4.H22: each provisional value says so in its docstring', () => {
      const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownLimits.ts'), 'utf8');
      for (const name of ['HIGHLIGHT_BLOCK_DEADLINE_MS', 'HIGHLIGHT_BOOT_BUDGET_MS', 'HIGHLIGHT_PAGE_WORKER_MS',
        'HIGHLIGHT_PAGE_MAX_TIMEOUTS', 'MD_HIGHLIGHT_MAX_HTML_CHARS', 'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS',
        'HIGHLIGHT_STREAM_DEBOUNCE_MS']) {
        expect(src, name).toMatch(new RegExp(`/\\*\\* PROVISIONAL \\(W5h-a; W5h-b sets it from R19\\)\\.(?:(?!\\*/)[^])*\\*/\\nexport const ${name} = `));
      }
    });
  ```
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts )` — Expected: the ten new value cases, the export-count case, both new cases and the ten new declared-once cases red; every existing value and declared-once case green.
- [ ] **Step 3: Implement.** In `markdownLimits.ts`: append after `export const MD_KEYSTROKE_MAX_CHARS = 64;`:
  ```ts

  // ---------------------------------------------------------------------------------------------------------------
  // Highlighting off the main thread (base spec 2026-10-01 section 4.9's W5h rows and "Two more"; W5h-a). The first
  // seven are PROVISIONAL starting values: R19 measures them on the operator's phone (section 7.8) and W5h-b sets each
  // with its basis stated here. Section 4.9's table says what each bounds.

  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). The worker time one block may take, from post to answer; its timer
   *  starts only after the worker's ready handshake. An overrun terminates the highlight worker and leaves only that
   *  block plain. Starting point: section 7.8's 750 ms. */
  export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). From spawning a highlight worker to its `{ready: true}`; past it the
   *  worker is terminated and the jobs waiting for it answer `worker-failed`. Measured in Node on a server CPU: 34 ms;
   *  the W5h-a plan's starting point leaves a phone's chunk fetch, parse and grammar registration a wide margin. */
  export const HIGHLIGHT_BOOT_BUDGET_MS = 2000;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). The summed post-to-answer worker time of one highlight store (a Docs
   *  page, a text leaf, a chat message, a tool well); past it, every block not yet answered is skipped. Starting point:
   *  section 7.8's 3 s. */
  export const HIGHLIGHT_PAGE_WORKER_MS = 3000;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). The block timeouts one highlight store may take, each a worker
   *  respawn; once reached, every block not yet answered is skipped. Starting point: section 7.8's 2. */
  export const HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). The longest HTML one block's answer may carry, an absolute count for
   *  every block, chat's included: the worker refuses a longer one before posting and the main thread re-checks it on
   *  receipt. Starting point: section 7.8's 4 x MD_HIGHLIGHT_BLOCK_MAX_CHARS (ordinary output measured 2.90 HTML
   *  characters per input character; desktop polish C7 measured a dense 64 KiB JSON block at about 858 000). */
  export const MD_HIGHLIGHT_MAX_HTML_CHARS = 262144;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). The HTML one Docs page may insert from highlighting, summed over the
   *  answers it received; past it the remaining blocks are skipped. Docs only. The W5h-a plan's starting point admits
   *  M4.H2's eight 60 000-character blocks at 2.90 HTML characters per character (1 392 000) with half again to spare. */
  export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152;
  /** PROVISIONAL (W5h-a; W5h-b sets it from R19). Chat only: a block whose text changed less than this long ago is not
   *  requested yet, so a streaming block asks the worker when it pauses, not on every settle. The W5h-a plan's starting
   *  point; R19's item 8 measures 0, 150, 250 and 400. */
  export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 250;
  /** The line retry's unit (section 4.10 "The line retry", the shared library's C24): a block of at most this many
   *  UTF-16 code units is never retried; a longer one is retried line by line, and one line longer than this answers
   *  `line-too-long`. */
  export const HIGHLIGHT_LINE_RETRY_UNITS = 256;
  /** The entries one highlight worker's cache holds (desktop polish Task C7's bound, moved here from `markdown.tsx` by
   *  W5h-a): chat's corpus highlights 33 blocks of at most 1 315 characters of markup each, so a long session's fences
   *  fit many times over. */
  export const HIGHLIGHT_CACHE_MAX_ENTRIES = 256;
  /** The characters of markup one highlight worker's cache holds (C7's bound, moved here by W5h-a): a dense 64 KiB
   *  JSON block comes out as about 858 000 characters, so four or so of those at once. The bound weighs the markup
   *  only; a key is at most its markup plus a mode, a language and two separators. */
  export const HIGHLIGHT_CACHE_MAX_CHARS = 4000000;
  ```
  In the file's header, after `// Imports nothing: the parse worker's closure reaches this file (\`markdown-purity.test.ts\`).`, add the line `// The highlight worker's closure reaches it too (W5h-a; \`markdown-purity.test.ts\`'s M4.H3 describe).`
  In `markdown.tsx`: delete the two declarations `export const HIGHLIGHT_CACHE_MAX_ENTRIES = 256;` and `export const HIGHLIGHT_CACHE_MAX_CHARS = 4_000_000;` with their docstrings, and add `HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES,` to its existing `from './markdownLimits'` import list.
  In `markdown-highlight.test.tsx`: move `HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES` from its `'../src/lib/markdown'` import to its `'../src/lib/markdownLimits'` import.
- [ ] **Step 4: Run to verify they pass.** Step 2's command — all green. Then `( cd pwa && ./node_modules/.bin/vitest run test/markdown-highlight.test.tsx test/markdown-purity.test.ts )` — unchanged counts, green. `TSC-OK`.
- [ ] **Step 5: Commit.** 4 files by name, message `pwa: the highlight worker's limits, provisional, declared once (docs W5h-a)`, trailer. Record the task's JSON row fence in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T1-M1 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;` → `export const HIGHLIGHT_BLOCK_DEADLINE_MS = 751;` | `test/markdown-limits.test.ts` | 1 failed — `'HIGHLIGHT_BLOCK_DEADLINE_MS is 750'` |
| W5HA-T1-M2 | M4.H22 | pwa | `src/lib/markdown.tsx` | `import '../session/chat.css';` → `import '../session/chat.css';\nconst HIGHLIGHT_BOOT_BUDGET_MS = 2000;` | `test/markdown-limits.test.ts` | 1 failed — `'HIGHLIGHT_BOOT_BUDGET_MS has exactly one declaration, in pwa/src/lib/markdownLimits.ts'` |
| W5HA-T1-M3 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152;` → `export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 1391999;` | `test/markdown-limits.test.ts` | 2 failed — its value case and `'M4.H22: the provisional page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character'` |
| W5HA-T1-M4 | M4.H22 | pwa | `src/lib/markdownLimits.ts` | `/** PROVISIONAL (W5h-a; W5h-b sets it from R19). Chat only:` → `/** Chat only:` | `test/markdown-limits.test.ts` | 1 failed — `'M4.H22: each provisional value says so in its docstring'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts test/markdown-highlight.test.tsx test/markdown-purity.test.ts )` — all passed; `TSC-OK`.

### Task 2: The registry modules and the wire's types (M4.H5, M4.H6; refinements (b), (n))

**Model routing:** `sonnet`, effort `high`. The judgment is in the alias table, which must be measured on the installed highlight.js, and in moving code without changing it.

**Spec rows:** §4.10 Files (`highlightGrammars.ts`, `highlightNames.ts`), "One registry", "The private instance", "The job and its outcome"; §4.4 "Is there a grammar?"; M4.H5, M4.H6.

**Files:**
- Create: `pwa/src/lib/highlightNames.ts`, `pwa/src/lib/highlightGrammars.ts`, `pwa/src/lib/highlightProtocol.ts`, `pwa/test/highlight-names.test.ts`.
- Guards (not edited): `pwa/src/lib/markdown.tsx` (keeps its own registration until Task 6; two instances coexist meanwhile, the core module's default and `HLJS`), `pwa/test/markdown-bounds.test.tsx`.

**Interfaces:**
- Consumes (moved, text unchanged): `markdown.tsx#xmlWithoutSubLanguages`, `#embeddedGrammars`, `#deriveBoundedCaps`, `#LANG_LABEL`, `#codeLanguage`, `#longestWordRun`, `#longestLine`, `#longestBlankRun`, and the bodies of `#boundedCap`, `#highlightBlockCap`, `#inScanPageBudget`, `#inMarkdownPageBudget`, `#isRegisteredGrammar`, re-expressed over static data. In this task they are COPIED; Task 6 deletes the originals from `markdown.tsx`.
- Produces:
  ```ts
  // highlightNames.ts (L1)
  export const HIGHLIGHT_GRAMMARS: readonly string[];                 // 15, sorted
  export const HIGHLIGHT_ALIASES: Readonly<Record<string, string>>;   // alias -> grammar
  export const HIGHLIGHT_NAME_SET: ReadonlySet<string>;               // names and aliases (the check's language-NAME set)
  export function grammarOf(lang: string): string | null;            // null: no grammar
  export function isRegisteredGrammar(lang: string): boolean;
  export const LANG_LABEL: Readonly<Record<string, string>>;
  export function codeLanguage(className: string): string;
  export const HIGHLIGHT_BOUNDED_CAPS: ReadonlyMap<string, number>;   // until W5h-b
  export function highlightBlockCap(lang: string): number;            // until W5h-b
  export function inScanPageBudget(lang: string): boolean;            // until W5h-b
  export function inMarkdownPageBudget(lang: string): boolean;        // until W5h-b
  export function longestWordRun(s: string): number;                  // until W5h-b
  export function longestLine(s: string): number;                     // until W5h-b
  export function longestBlankRun(s: string): number;                 // until W5h-b
  // highlightGrammars.ts (L1, worker side)
  export type HighlightApi = typeof hljs;
  export const CCRC_ALIASES: Readonly<Record<string, readonly string[]>>;
  export const HLJS: HighlightApi;
  export function deriveBoundedCaps(h: HighlightApi, base: ReadonlyMap<string, number>): ReadonlyMap<string, number>;
  // highlightProtocol.ts (L2): HighlightJob, HighlightResult, HighlightReply, HighlightOutcome, HighlightRequest,
  // HighlighterStatus, Highlighter (exact text in Step 3)
  ```

**Decisions this task makes:** (1) `grammarOf` resolves as highlight.js's `getLanguage` does (lower-cased; a name, else an alias) and reads the alias table with `Object.hasOwn`, so `constructor` or `__proto__` is no grammar. (2) Types are taken from `highlight.js/lib/core` (`typeof hljs`), never from the bare `highlight.js` specifier, so the worker closure names only the 16 specifiers M4.H3 allows. (3) `HLJS` is the only instance the worker uses; registrations and aliases go through it; nothing calls `addPlugin`, `configure` or `debugMode`. (4) `HIGHLIGHT_BOUNDED_CAPS` is a static table, held equal to `deriveBoundedCaps(HLJS, base)` by M4.H5's last case, so the subLanguage closure stays enforced without highlight.js on the main thread.

- [ ] **Step 0: Measure the registry on the installed highlight.js.** Claim nothing yet (all four files are new). Write `.superpowers/sdd/2026-11-02-native-docs-reader-w5h-a/registry.cjs` (gitignored) and run it as `( cd pwa && node ../.superpowers/sdd/2026-11-02-native-docs-reader-w5h-a/registry.cjs )` (read-only: it imports the installed package and prints). A script resolves a bare `require` from its own directory, which has no `node_modules`, so it resolves through `createRequire` anchored at `pwa/package.json` (the cwd):
  ```js
  const req = require('node:module').createRequire(require('node:path').resolve('package.json'));
  const core = req('highlight.js/lib/core');
  const h = core.newInstance();
  for (const n of ['bash','typescript','javascript','json','python','css','xml','yaml','markdown','diff','sql','dockerfile','rust','go','php']) h.registerLanguage(n, req('highlight.js/lib/languages/' + n));
  h.registerAliases(['zsh', 'shell'], { languageName: 'bash' });
  h.registerAliases(['tsx'], { languageName: 'typescript' });
  h.registerAliases(['html', 'svg'], { languageName: 'xml' });
  const names = h.listLanguages().sort();
  const aliases = {};
  for (const g of names) for (const a of h.getLanguage(g).aliases || []) aliases[a] = g;
  for (const [g, l] of [['bash', ['zsh', 'shell']], ['typescript', ['tsx']], ['xml', ['html', 'svg']]]) for (const a of l) aliases[a] = g;
  console.log(JSON.stringify(names));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(aliases).sort())));
  ```
  Planning measured (highlight.js 11.11.1, a stale local copy; the installed 11.12.0 is the authority): names `["bash","css","diff","dockerfile","go","javascript","json","markdown","php","python","rust","sql","typescript","xml","yaml"]`; aliases `{"atom":"xml","cjs":"javascript","cts":"typescript","docker":"dockerfile","golang":"go","gyp":"python","html":"xml","ipython":"python","js":"javascript","jsonc":"json","jsx":"javascript","md":"markdown","mjs":"javascript","mkd":"markdown","mkdown":"markdown","mts":"typescript","patch":"diff","plist":"xml","py":"python","rs":"rust","rss":"xml","sh":"bash","shell":"bash","svg":"xml","ts":"typescript","tsx":"typescript","wsf":"xml","xhtml":"xml","xjb":"xml","xsd":"xml","xsl":"xml","yml":"yaml","zsh":"bash"}`. Record the measured output in the SDD ledger; `HIGHLIGHT_ALIASES` is exactly what it prints. If the names differ from the 15 above, stop and ask.
- [ ] **Step 1: Write `pwa/test/highlight-names.test.ts`:**
  ```ts
  // One registry (native Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 "One registry" and "The private
  // instance", M4.H5 and M4.H6). The main thread knows grammars as data (`highlightNames.ts`); the highlight worker
  // registers them on one private highlight.js instance (`highlightGrammars.ts#HLJS`). This file holds the two equal
  // in both directions, holds part 1's grammar caps equal to their derivation over the worker's grammars (until
  // W5h-b), and pins the instance: one `hljs.newInstance()`, registrations only on it, and no `addPlugin`,
  // `configure` or `debugMode` call in the worker's first-party closure, each clause with a planted control.
  // The escaping scan reads calls through TypeScript's parser. NOT EXHAUSTIVE: a call through a variable holding the
  // method (`const c = HLJS.configure; c({})`), an element access with a computed key, and anything reached through
  // `any` or `eval` are not seen; review lens 1 reads for those.
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import ts from 'typescript';
  import { describe, expect, it } from 'vitest';
  import { CCRC_ALIASES, HLJS, deriveBoundedCaps } from '../src/lib/highlightGrammars';
  import {
    HIGHLIGHT_ALIASES, HIGHLIGHT_BOUNDED_CAPS, HIGHLIGHT_GRAMMARS, HIGHLIGHT_NAME_SET, grammarOf, isRegisteredGrammar,
  } from '../src/lib/highlightNames';
  import { MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';

  const LIB = path.join(import.meta.dirname, '..', 'src', 'lib');

  /** Every alias the worker's instance resolves: each grammar's own, and ccrc's three lists. */
  function workerAliases(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const g of HLJS.listLanguages()) for (const a of HLJS.getLanguage(g)?.aliases ?? []) out[a] = g;
    for (const [g, list] of Object.entries(CCRC_ALIASES)) for (const a of list) out[a] = g;
    return out;
  }

  describe('M4.H5: highlightNames.ts is the worker\'s registry, in both directions', () => {
    it('the grammar names are the worker instance\'s listLanguages(), sorted', () => {
      expect([...HIGHLIGHT_GRAMMARS]).toEqual([...HLJS.listLanguages()].sort());
      expect(HIGHLIGHT_GRAMMARS).toHaveLength(15);
    });

    it('the alias table is every alias the worker resolves, each to the same grammar', () => {
      expect({ ...HIGHLIGHT_ALIASES }).toEqual(workerAliases());
    });

    it('every name and alias resolves to the same grammar on both sides, in either case', () => {
      for (const n of HIGHLIGHT_NAME_SET) {
        const def = HLJS.getLanguage(n);
        expect(def, n).toBeDefined();
        expect(HLJS.getLanguage(grammarOf(n)!), n).toBe(def);
        expect(isRegisteredGrammar(n), n).toBe(true);
        expect(isRegisteredGrammar(n.toUpperCase()), n).toBe(true);
      }
      expect(HIGHLIGHT_NAME_SET.size).toBe(HIGHLIGHT_GRAMMARS.length + Object.keys(HIGHLIGHT_ALIASES).length);
    });

    it('no other name is registered: the empty name, an unknown one, and the object prototype\'s keys', () => {
      for (const n of ['', 'nope', 'text', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        expect(isRegisteredGrammar(n), n).toBe(false);
        expect(grammarOf(n), n).toBeNull();
      }
    });

    it('part 1\'s grammar caps equal deriveBoundedCaps over the worker\'s grammars (until W5h-b)', () => {
      const derived = deriveBoundedCaps(HLJS, new Map<string, number>([
        ['typescript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS], ['javascript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS],
        ['rust', MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS],
      ]));
      const sorted = (m: ReadonlyMap<string, number>): [string, number][] => [...m].sort(([a], [b]) => a.localeCompare(b));
      expect(sorted(HIGHLIGHT_BOUNDED_CAPS)).toEqual(sorted(derived));
    });
  });

  /** What the escaping pin finds in one module: each `hljs.newInstance()`, each registration's receiver, and each
   *  forbidden call (`addPlugin`, `configure`, `debugMode`), as `<what> <line>`. */
  function escaping(source: string, file: string): { instances: number; receivers: string[]; forbidden: string[] } {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let instances = 0;
    const receivers: string[] = [];
    const forbidden: string[] = [];
    const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const member = n.expression.name.text;
        const owner = n.expression.expression;
        const ownerText = ts.isIdentifier(owner) ? owner.text : '(expr)';
        if (member === 'newInstance' && ownerText === 'hljs') instances += 1;
        if (member === 'registerLanguage' || member === 'registerAliases') receivers.push(`${ownerText}.${member}`);
        if (member === 'addPlugin' || member === 'configure' || member === 'debugMode') forbidden.push(`${member} ${line(n)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return { instances, receivers, forbidden };
  }

  const WORKER_FIRST_PARTY = ['highlightGrammars.ts', 'highlightJob.ts', 'markdownHighlightWorker.ts'];
  /** The worker's first-party files that exist yet (Task 3 adds the last two). */
  const present = (): string[] => WORKER_FIRST_PARTY.filter((f) => {
    try { readFileSync(path.join(LIB, f)); return true; } catch { return false; }
  });
  const read = (f: string): string => readFileSync(path.join(LIB, f), 'utf8');

  describe('M4.H6: highlight.js\'s own escaping (one private instance, no plugin, no configuration)', () => {
    it('highlightGrammars.ts makes exactly one hljs.newInstance() and registers only on HLJS', () => {
      const found = escaping(read('highlightGrammars.ts'), 'highlightGrammars.ts');
      expect(found.instances).toBe(1);
      expect(found.receivers.length).toBeGreaterThanOrEqual(2);
      expect(found.receivers.every((r) => r.startsWith('HLJS.'))).toBe(true);
      expect(read('highlightGrammars.ts')).toMatch(/^export const HLJS: HighlightApi = hljs\.newInstance\(\);$/m);
    });

    it('no file of the worker\'s first-party closure calls addPlugin, configure or debugMode', () => {
      expect(present()).toContain('highlightGrammars.ts');
      for (const f of present()) expect(escaping(read(f), f).forbidden, f).toEqual([]);
    });

    it('planted: a registration on the core default instance is red', () => {
      const found = escaping(`${read('highlightGrammars.ts')}\nhljs.registerLanguage('planted', bash);\n`, 'planted.ts');
      expect(found.receivers).toContain('hljs.registerLanguage');
    });

    it('planted: configure, addPlugin and debugMode on HLJS are each red', () => {
      for (const call of ["HLJS.configure({ classPrefix: 'x-' });", 'HLJS.addPlugin({});', 'HLJS.debugMode();']) {
        expect(escaping(`${read('highlightGrammars.ts')}\n${call}\n`, 'planted.ts').forbidden, call).toHaveLength(1);
      }
    });
  });
  ```
- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-names.test.ts )` — Expected: the file fails to import (the modules are absent): 1 failed file.
- [ ] **Step 3: Implement.**
  - `pwa/src/lib/highlightProtocol.ts`:
    ```ts
    // The highlight worker's wire and a highlighter's face (native Docs reader, W5h-a Task 2; base spec 2026-10-01
    // section 4.10 "The job and its outcome"). Types only, importing nothing: the worker side (`highlightJob.ts`,
    // `markdownHighlightWorker.ts`) and the main thread (`markdownRunner.ts`, `highlightStore.ts`) both name them, and
    // neither may import the other (the W5h-a plan's refinement (b)). `HighlightOutcome` is its own union, so
    // `ParseOutcome` keeps its eight arms (M4.H10).
    //
    // Ring L2: declarations only.

    /** One job is one block. `mode` absent: the whole block; `'line'`: the retry under C24. */
    export interface HighlightJob {
      readonly id: number;
      readonly lang: string;
      readonly code: string;
      readonly mode?: 'line';
    }

    /** What the worker answers one job. `html` says which mode produced it. */
    export type HighlightResult =
      | { readonly kind: 'html'; readonly html: string; readonly mode: 'block' | 'line' }
      | { readonly kind: 'unregistered' }
      /** Over MD_HIGHLIGHT_MAX_HTML_CHARS: refused before posting. */
      | { readonly kind: 'too-large'; readonly htmlChars: number }
      /** Line mode only: one line over HIGHLIGHT_LINE_RETRY_UNITS. */
      | { readonly kind: 'line-too-long'; readonly chars: number }
      /** `error.name` only. */
      | { readonly kind: 'threw'; readonly error: string };

    /** What the worker posts: `{ready: true}` once its module has evaluated, then one reply per job. */
    export type HighlightReply = { readonly ready: true } | { readonly id: number; readonly result: HighlightResult };

    /** A job's outcome on the main thread: the worker's result, or one of the runner's own three arms. */
    export type HighlightOutcome =
      | HighlightResult
      /** HIGHLIGHT_BLOCK_DEADLINE_MS passed after the post. */
      | { readonly kind: 'timeout'; readonly budgetMs: number }
      | { readonly kind: 'worker-unavailable' }
      /** A worker error, a failed post, or a boot past HIGHLIGHT_BOOT_BUDGET_MS. */
      | { readonly kind: 'worker-failed'; readonly error: string };

    /** What a store asks a highlighter to colour. */
    export interface HighlightRequest {
      readonly lang: string;
      readonly code: string;
      readonly mode?: 'line';
    }

    /** Whether a highlighter can take a job now: `live` (a worker is up or booting), `worker-unavailable` (spawning
     *  threw: no `Worker` here, for good), `worker-failed` (two boots failed in a row: sticky until the app reloads). */
    export type HighlighterStatus = 'live' | 'worker-unavailable' | 'worker-failed';

    /** A highlight runner as a store sees it. `onPosted` runs when the job is posted to the worker (after the ready
     *  handshake, after any job ahead of it), never for a job that is not posted. The promise rejects only on an
     *  abort: an aborted running job is detached (its answer is dropped, the worker lives on). */
    export interface Highlighter {
      highlight(
        request: HighlightRequest,
        opts: { readonly signal?: AbortSignal; readonly onPosted?: () => void },
      ): Promise<HighlightOutcome>;
      /** Spawns the worker when none is live, then answers whether a job can be taken. */
      status(): HighlighterStatus;
      /** Spawns the worker now, when there is none, so the first block does not wait for its boot. */
      prewarm(): void;
    }
    ```
  - `pwa/src/lib/highlightGrammars.ts`: header (ring L1 worker side; §4.10 Files and "The private instance"; M4.H3, M4.H5, M4.H6; refinement (n); "imported only inside the highlight worker's closure and by tests"). Body, in this order: `import hljs from 'highlight.js/lib/core';` and the 15 `import <name> from 'highlight.js/lib/languages/<name>';` lines exactly as `markdown.tsx` writes them (its `// html / svg` comment on xml kept); `export type HighlightApi = typeof hljs;` and `type LanguageFn = Parameters<HighlightApi['registerLanguage']>[1];`; `xmlWithoutSubLanguages` with its whole docstring, moved verbatim and now `export const`; `embeddedGrammars` and `deriveBoundedCaps` with their docstrings verbatim, `HLJSApi` replaced by `HighlightApi` (four places), `deriveBoundedCaps` exported; then:
    ```ts
    /** ccrc's own alias lists, registered beside the aliases each grammar declares. Registering a grammar also
     *  registers the aliases IT declares (that is where `golang` comes from); the php grammar declares none, so `php`
     *  is the only fence word that reaches it. */
    export const CCRC_ALIASES: Readonly<Record<string, readonly string[]>> = {
      bash: ['zsh', 'shell'],
      typescript: ['tsx'],
      xml: ['html', 'svg'],
    };

    /** The highlight worker's one highlight.js instance: never the core module's default instance, never given a plugin
     *  or a configuration, so its escaping is highlight.js's default (M4.H6). */
    export const HLJS: HighlightApi = hljs.newInstance();
    for (const [name, def] of Object.entries({
      bash, typescript, javascript, json, python, css, xml: xmlWithoutSubLanguages,
      yaml, markdown, diff, sql, dockerfile, rust, go, php,
    })) HLJS.registerLanguage(name, def);
    for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });
    ```
  - `pwa/src/lib/highlightNames.ts`: header (ring L1; §4.10 Files, "One registry", §4.4 "Is there a grammar?"; "imports only `markdownLimits.ts`, for part 1's caps, until W5h-b, and nothing after"; refinement (n)). Body:
    ```ts
    import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS } from './markdownLimits';

    /** The 15 grammars the highlight worker registers, sorted (its `listLanguages()`; M4.H5). */
    export const HIGHLIGHT_GRAMMARS: readonly string[] = [
      'bash', 'css', 'diff', 'dockerfile', 'go', 'javascript', 'json', 'markdown', 'php', 'python', 'rust', 'sql',
      'typescript', 'xml', 'yaml',
    ];

    /** Every alias the worker resolves, to its grammar: each grammar's own aliases and `highlightGrammars.ts`'s
     *  `CCRC_ALIASES`, as the installed highlight.js answers them (measured at the W5h-a plan's Task 2 Step 0). */
    export const HIGHLIGHT_ALIASES: Readonly<Record<string, string>> = {
      // exactly Step 0's second line, one `alias: 'grammar',` entry per key, in its sorted order
    };

    /** Every name a fence may use to reach a grammar: the 15 names and every alias. The main thread's check accepts
     *  `<span class="language-NAME">` for these names only (section 4.10). */
    export const HIGHLIGHT_NAME_SET: ReadonlySet<string> = new Set([...HIGHLIGHT_GRAMMARS, ...Object.keys(HIGHLIGHT_ALIASES)]);

    /** The grammar `lang` names, resolved as highlight.js's `getLanguage` resolves it (lower-cased; a name, else an
     *  alias); `null` when none. Own keys only, so no prototype key is a grammar. */
    export function grammarOf(lang: string): string | null {
      const name = lang.toLowerCase();
      if (HIGHLIGHT_GRAMMARS.includes(name)) return name;
      return Object.hasOwn(HIGHLIGHT_ALIASES, name) ? HIGHLIGHT_ALIASES[name]! : null;
    }

    /** Whether `lang` names a registered grammar (a name or an alias). The one predicate: `CodeBlock`, `blockKey`, the
     *  text leaf and the tool wells' plan read it; nothing on the main thread asks highlight.js. */
    export function isRegisteredGrammar(lang: string): boolean {
      return lang !== '' && grammarOf(lang) !== null;
    }
    ```
    then `LANG_LABEL` (its declaration and value moved verbatim from `markdown.tsx`) and `codeLanguage` (docstring and body verbatim), then a banner `// ---- Until W5h-b: what W5 part 1's main-thread bounds need (base spec 4.10; the W5h-a plan's refinement (n)). ----` and:
    ```ts
    /** Part 1's per-grammar block caps (review 450 F1): `typescript` and `javascript` at MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS,
     *  `rust` at MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS, by grammar. Static: `highlight-names.test.ts` holds it equal to
     *  `highlightGrammars.ts#deriveBoundedCaps` over the worker's grammars, so a grammar that comes to embed a bounded
     *  one through `subLanguage` reds that test until it is added here. */
    export const HIGHLIGHT_BOUNDED_CAPS: ReadonlyMap<string, number> = new Map<string, number>([
      ['javascript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS],
      ['rust', MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS],
      ['typescript', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS],
    ]);

    /** The part 1 cap of the grammar `lang` resolves to; `null` for any other grammar, or none. */
    function boundedCap(lang: string): number | null {
      const grammar = grammarOf(lang);
      return grammar === null ? null : HIGHLIGHT_BOUNDED_CAPS.get(grammar) ?? null;
    }

    /** The longest block, in characters, part 1 lets be highlighted in `lang`: its grammar's cap, else
     *  MD_HIGHLIGHT_BLOCK_MAX_CHARS. */
    export function highlightBlockCap(lang: string): number {
      return boundedCap(lang) ?? MD_HIGHLIGHT_BLOCK_MAX_CHARS;
    }

    /** Whether a block in `lang` counts against part 1's scan page budget (DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS). */
    export function inScanPageBudget(lang: string): boolean {
      return boundedCap(lang) !== null;
    }

    /** Whether a block in `lang` counts against part 1's markdown page budget (DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS):
     *  every name that resolves to the `markdown` grammar. */
    export function inMarkdownPageBudget(lang: string): boolean {
      return grammarOf(lang) === 'markdown';
    }
    ```
    then `longestWordRun`, `longestLine` and `longestBlankRun`, each with its docstring and body moved verbatim.
- [ ] **Step 4: Run to verify it passes.** Step 2's command — `Tests  9 passed (9)`.
- [ ] **Step 5: Guard suites.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-bounds.test.tsx test/markdown-purity.test.ts )` — unchanged, green (nothing imports the new modules yet). `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` — green (the three files' rings as their headers say). `TSC-OK`.
- [ ] **Step 6: Commit.** 4 files by name, message `pwa: the highlight registry as data and as one private instance (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T2-M1 | M4.H5 | pwa | `src/lib/highlightNames.ts` | `mkd: 'markdown',` → removed (its own line in `HIGHLIGHT_ALIASES`, one entry per line) | `test/highlight-names.test.ts` | 1+ failed — `'the alias table is every alias the worker resolves, each to the same grammar'` |
| W5HA-T2-M2 | M4.H5 | pwa | `src/lib/highlightNames.ts` | `zsh: 'bash',` → `zsh: 'bash', planted: 'bash',` | `test/highlight-names.test.ts` | 2 failed — the alias-table case and `'every name and alias resolves to the same grammar on both sides, in either case'` |
| W5HA-T2-M3 | M4.H6 | pwa | `src/lib/highlightGrammars.ts` | `export const HLJS: HighlightApi = hljs.newInstance();` → `export const HLJS: HighlightApi = hljs;` | `test/highlight-names.test.ts` | 1 failed — `'highlightGrammars.ts makes exactly one hljs.newInstance() and registers only on HLJS'` |
| W5HA-T2-M4 | M4.H6 | pwa | `src/lib/highlightGrammars.ts` | `for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });` → `for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });\nHLJS.configure({ classPrefix: 'x-' });` | `test/highlight-names.test.ts` | 1+ failed — `'no file of the worker\'s first-party closure calls addPlugin, configure or debugMode'` |
| W5HA-T2-M5 | M4.H5 | pwa | `src/lib/highlightNames.ts` | `['rust', MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS],` → removed | `test/highlight-names.test.ts` | 1 failed — `'part 1\'s grammar caps equal deriveBoundedCaps over the worker\'s grammars (until W5h-b)'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-names.test.ts test/markdown-bounds.test.tsx )` — all passed; `TSC-OK`.

### Task 3: The highlight job and the worker entry (M4.H13, M4.H18, M4.H20 worker halves; M4.H3's closure; refinements (b), (c))

**Model routing:** `sonnet`, effort `high`. The judgment is in C24's line rule (keep each break as written) and in caching by mode.

**Spec rows:** §4.10 "The job and its outcome" (the call, the HTML cap, the worker-side cache), "The line retry" (the worker's half), "The highlight runner" (the ready handshake's sender), Guards (the highlight worker's closure); M4.H3 (closure), M4.H13, M4.H18, M4.H20 (worker halves).

**Files:**
- Create: `pwa/src/lib/highlightJob.ts`, `pwa/src/lib/markdownHighlightWorker.ts`, `pwa/test/markdown-highlight-worker.test.ts`.
- Modify: `pwa/src/lib/highlightCache.ts` (its header's first sentence and `MADE`'s docstring: the cache's user is now the highlight worker), `pwa/test/markdown-purity.test.ts` (`closure()` gains two optional parameters; one appended describe).
- Guards (not edited): `pwa/test/highlight-cache.test.ts`, `pwa/test/markdown-runner.test.ts` (its source pins still list two worker files; Task 4 widens them, and this task's new entry file reds "no other lib/markdown* file posts or receives messages" until then — so this task does NOT run that file, and Task 4 Step 0 starts by running it).

**Interfaces:**
- Consumes `HLJS`, `HighlightApi` (Task 2), `createLru`, `Lru` (`highlightCache.ts`), the limits of Task 1, `HighlightReply`, `HighlightResult` (Task 2).
- Produces:
  ```ts
  // highlightJob.ts (L1, worker side)
  export type HighlightInstance = Pick<HighlightApi, 'getLanguage' | 'highlight'>;
  export function createHighlightAnswerer(
    h?: HighlightInstance, cache?: Lru<string>,
  ): (data: unknown, post: (reply: HighlightReply) => void) => void;
  // markdownHighlightWorker.ts (L4): no exports; posts { ready: true } once, after assigning onmessage
  ```

**Decisions this task makes:** (1) The cache key is `<mode>\0<lang>\0<code>`, `mode` being the mode actually used (`line` only for a block over the unit), so a block retried line by line never reads its whole-block answer. (2) The worker caches whatever it computed, an over-cap answer included, and refuses an over-cap answer on every read: a block that keeps coming back is highlighted once. `line-too-long` is not cached (it costs one scan). (3) Line mode splits at `\r\n`, `\r` and `\n` and keeps each break as written, so `textContent` of the joined answer equals the block. (4) The entry assigns `onmessage` before it posts `{ready: true}`, so no job can arrive unheard.

- [ ] **Step 0:** `test -f pwa/src/lib/highlightGrammars.ts && test -f pwa/src/lib/highlightProtocol.ts && git grep -q "export function createLru" HEAD -- pwa/src/lib/highlightCache.ts && git grep -q "^function closure(read: (file: string) => string = (f) => readFileSync(f, 'utf8')): { files: string\[\]; refused: string\[\] } {$" HEAD -- pwa/test/markdown-purity.test.ts && echo T3-BASE-OK`. Claim `markdown-purity.test.ts` and `highlightCache.ts`. Record `markdown-purity.test.ts`'s count.
- [ ] **Step 1: Write `pwa/test/markdown-highlight-worker.test.ts`:**
  ```ts
  // The highlight worker's job (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10's "The job and its
  // outcome", "The worker-side cache" and "The line retry"; M4.H13, M4.H18 and M4.H20, worker halves). Each case calls
  // `createHighlightAnswerer` in-thread, over the worker's own instance (`HLJS`) or a counting fake, and collects what
  // it posts. The built chunk's own run, with no DOM, is `markdown-worker-built.test.ts`'s (M7.11).
  import { describe, expect, it } from 'vitest';
  import { createLru } from '../src/lib/highlightCache';
  import { HLJS } from '../src/lib/highlightGrammars';
  import { createHighlightAnswerer, type HighlightInstance } from '../src/lib/highlightJob';
  import type { HighlightReply } from '../src/lib/highlightProtocol';
  import {
    HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_LINE_RETRY_UNITS, MD_HIGHLIGHT_MAX_HTML_CHARS,
  } from '../src/lib/markdownLimits';

  type Answer = ReturnType<typeof createHighlightAnswerer>;
  /** Every post one message makes. */
  function posts(answer: Answer, job: unknown): HighlightReply[] {
    const out: HighlightReply[] = [];
    answer(job, (r) => { out.push(r); });
    return out;
  }

  /** A fake instance that knows `ts` only, answers `html(code)` (default: the code in one `hljs-x` span), and records
   *  every code it is asked to colour. */
  function fake(html: (code: string) => string = (c) => `<span class="hljs-x">${c}</span>`): { h: HighlightInstance; calls: string[] } {
    const calls: string[] = [];
    const h = {
      getLanguage: (name: string) => (name === 'ts' ? {} : undefined),
      highlight: (code: string) => { calls.push(code); return { value: html(code) }; },
    } as unknown as HighlightInstance;
    return { h, calls };
  }

  /** `n` distinct lines of `width` characters, the last with no break after it. */
  const lines = (n: number, width: number): string[] =>
    Array.from({ length: n }, (_, i) => String(i).padStart(width, 'a'));

  describe('the job: one block, one call, one answer', () => {
    it('a registered block answers html in block mode, with the instance\'s spans', () => {
      expect(posts(createHighlightAnswerer(), { id: 1, lang: 'typescript', code: 'const a = 1;' })).toEqual([
        { id: 1, result: { kind: 'html', mode: 'block', html: expect.stringContaining('<span class="hljs-keyword">const</span>') } },
      ]);
    });

    it('an unknown or empty language answers unregistered, and nothing is coloured', () => {
      const f = fake();
      const answer = createHighlightAnswerer(f.h);
      expect(posts(answer, { id: 2, lang: 'nope', code: 'x' })).toEqual([{ id: 2, result: { kind: 'unregistered' } }]);
      expect(posts(answer, { id: 3, lang: '', code: 'x' })).toEqual([{ id: 3, result: { kind: 'unregistered' } }]);
      expect(f.calls).toEqual([]);
    });

    it('a markdown fence holding a tag answers a language-xml span (the check\'s subLanguage form)', () => {
      const [reply] = posts(createHighlightAnswerer(), { id: 4, lang: 'markdown', code: '<b>x</b>' });
      expect(reply).toMatchObject({ id: 4, result: { kind: 'html' } });
      expect((reply as { result: { html: string } }).result.html).toContain('<span class="language-xml">');
    });

    it('a message with no finite numeric id gets no answer', () => {
      const answer = createHighlightAnswerer(fake().h);
      for (const job of [{ lang: 'ts', code: 'x' }, { id: 'a', lang: 'ts', code: 'x' }, { id: Infinity, lang: 'ts', code: 'x' }, null, 7]) {
        expect(posts(answer, job), JSON.stringify(job)).toEqual([]);
      }
    });

    it('a non-string lang or code answers threw TypeError', () => {
      const answer = createHighlightAnswerer(fake().h);
      expect(posts(answer, { id: 5, lang: 'ts', code: 7 })).toEqual([{ id: 5, result: { kind: 'threw', error: 'TypeError' } }]);
      expect(posts(answer, { id: 6, lang: 1, code: 'x' })).toEqual([{ id: 6, result: { kind: 'threw', error: 'TypeError' } }]);
    });

    it('a post that throws is answered once more with threw; a second throwing post is swallowed', () => {
      const answer = createHighlightAnswerer(fake().h);
      const seen: HighlightReply[] = [];
      answer({ id: 7, lang: 'ts', code: 'x' }, (r) => {
        seen.push(r);
        if (seen.length === 1) throw new DOMException('x', 'DataCloneError');
      });
      expect(seen[1]).toEqual({ id: 7, result: { kind: 'threw', error: 'DataCloneError' } });
      expect(() => answer({ id: 8, lang: 'ts', code: 'x' }, () => { throw new Error('again'); })).not.toThrow();
    });
  });

  describe('M4.H13 (worker half): the HTML cap is applied before posting', () => {
    it('HTML over MD_HIGHLIGHT_MAX_HTML_CHARS is posted as too-large with its length, never as HTML', () => {
      const answer = createHighlightAnswerer(fake(() => 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS + 1)).h);
      expect(posts(answer, { id: 9, lang: 'ts', code: 'a' })).toEqual([
        { id: 9, result: { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 } },
      ]);
    });

    it('HTML of exactly MD_HIGHLIGHT_MAX_HTML_CHARS is posted', () => {
      const answer = createHighlightAnswerer(fake(() => 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS)).h);
      expect(posts(answer, { id: 10, lang: 'ts', code: 'a' })[0]).toMatchObject({ result: { kind: 'html', mode: 'block' } });
    });
  });

  describe('M4.H18 (worker half): line mode under C24', () => {
    it('a block over the unit, in line mode, colours each line alone and keeps each break as written', () => {
      const f = fake();
      const parts = lines(40, 9);
      const breaks = parts.slice(1).map((_, i) => (i % 3 === 0 ? '\r\n' : i % 3 === 1 ? '\n' : '\r'));
      const code = parts.map((l, i) => l + (breaks[i] ?? '')).join('');
      expect(code.length).toBeGreaterThan(HIGHLIGHT_LINE_RETRY_UNITS);
      const [reply] = posts(createHighlightAnswerer(f.h), { id: 11, lang: 'ts', code, mode: 'line' });
      expect(f.calls).toEqual(parts);
      expect(reply).toEqual({ id: 11, result: { kind: 'html', mode: 'line',
        html: parts.map((l, i) => `<span class="hljs-x">${l}</span>${breaks[i] ?? ''}`).join('') } });
    });

    it('line mode answers line-too-long, with its length, when one line is over the unit, and colours nothing', () => {
      const f = fake();
      const code = `${'a'.repeat(HIGHLIGHT_LINE_RETRY_UNITS + 1)}\nb`;
      expect(posts(createHighlightAnswerer(f.h), { id: 12, lang: 'ts', code, mode: 'line' })).toEqual([
        { id: 12, result: { kind: 'line-too-long', chars: HIGHLIGHT_LINE_RETRY_UNITS + 1 } },
      ]);
      expect(f.calls).toEqual([]);
    });

    it('line mode on a block of at most the unit colours it whole, in block mode', () => {
      const f = fake();
      const code = 'a'.repeat(HIGHLIGHT_LINE_RETRY_UNITS - 2) + '\nb';
      expect(code).toHaveLength(HIGHLIGHT_LINE_RETRY_UNITS);
      expect(posts(createHighlightAnswerer(f.h), { id: 13, lang: 'ts', code, mode: 'line' })[0])
        .toMatchObject({ result: { kind: 'html', mode: 'block' } });
      expect(f.calls).toEqual([code]);
    });

    it('line mode still applies the HTML cap to the joined answer', () => {
      const code = lines(40, 9).join('\n');
      const answer = createHighlightAnswerer(fake(() => 'x'.repeat(Math.ceil(MD_HIGHLIGHT_MAX_HTML_CHARS / 39))).h);
      expect(posts(answer, { id: 14, lang: 'ts', code, mode: 'line' })[0]).toMatchObject({ result: { kind: 'too-large' } });
    });
  });

  describe('M4.H20: the worker-side LRU', () => {
    it('the same (mode, lang, code) twice calls highlight once; the other mode is its own entry', () => {
      const f = fake();
      const answer = createHighlightAnswerer(f.h);
      const code = lines(40, 9).join('\n');
      posts(answer, { id: 15, lang: 'ts', code });
      posts(answer, { id: 16, lang: 'ts', code });
      expect(f.calls).toEqual([code]);
      posts(answer, { id: 17, lang: 'ts', code, mode: 'line' });
      posts(answer, { id: 18, lang: 'ts', code, mode: 'line' });
      expect(f.calls).toHaveLength(1 + 40);
    });

    it('past the cache\'s size the least recently used entry is evicted', () => {
      const f = fake();
      const answer = createHighlightAnswerer(f.h, createLru<string>(2, 1_000_000, (s) => s.length));
      for (const code of ['a', 'b', 'c', 'a']) posts(answer, { id: 19, lang: 'ts', code });
      expect(f.calls).toEqual(['a', 'b', 'c', 'a']);
    });

    it(`the default cache holds ${HIGHLIGHT_CACHE_MAX_ENTRIES} entries and ${HIGHLIGHT_CACHE_MAX_CHARS} characters of markup`, () => {
      const byCount = fake();
      const a = createHighlightAnswerer(byCount.h);
      for (let i = 0; i <= HIGHLIGHT_CACHE_MAX_ENTRIES; i += 1) posts(a, { id: 20, lang: 'ts', code: `c${i}` });
      posts(a, { id: 21, lang: 'ts', code: 'c1' });
      posts(a, { id: 22, lang: 'ts', code: 'c0' });
      expect(byCount.calls.filter((c) => c === 'c1')).toHaveLength(1);
      expect(byCount.calls.filter((c) => c === 'c0')).toHaveLength(2);
      const heavy = Math.floor(HIGHLIGHT_CACHE_MAX_CHARS / 4) + 1;
      const byWeight = fake(() => 'x'.repeat(heavy));
      const b = createHighlightAnswerer(byWeight.h);
      for (const code of ['w0', 'w1', 'w2', 'w3', 'w0']) posts(b, { id: 23, lang: 'ts', code });
      expect(byWeight.calls).toEqual(['w0', 'w1', 'w2', 'w3', 'w0']);
    });
  });

  describe('the worker\'s instance strips xml\'s script and style sub-languages (kept, section 4.9)', () => {
    it('an xml block holding script and style answers no sub-language span inside them', () => {
      const [reply] = posts(createHighlightAnswerer(), { id: 24, lang: 'xml', code: '<script>var a = 1;</script><style>a { b: c }</style>' });
      const html = (reply as { result: { html: string } }).result.html;
      expect(html).not.toContain('language-javascript');
      expect(html).not.toContain('language-css');
      expect(HLJS.getLanguage('html')).toBe(HLJS.getLanguage('xml'));
    });
  });
  ```
- [ ] **Step 2: Append to `pwa/test/markdown-purity.test.ts`.** First change `closure`'s signature in place: Find `function closure(read: (file: string) => string = (f) => readFileSync(f, 'utf8')): { files: string[]; refused: string[] } {` → Replace `function closure(read: (file: string) => string = (f) => readFileSync(f, 'utf8'), roots: readonly string[] = ROOTS, allowed: ReadonlySet<string> = ALLOWED_PACKAGES): { files: string[]; refused: string[] } {`; in its body, `const todo = ROOTS.map((r) => path.join(LIB, r));` → `const todo = roots.map((r) => path.join(LIB, r));` and `} else if (!ALLOWED_PACKAGES.has(spec)) refused.push(\`${rel}: ${spec}\`);` → `} else if (!allowed.has(spec)) refused.push(\`${rel}: ${spec}\`);`. Then append after the file's last describe:
  ```ts

  // Docs W5h-a Task 3 (base spec 2026-10-01 section 4.10's Guards, M4.H3): the highlight worker's closure. From its two
  // roots it reaches only first-party lib files, and of packages only `highlight.js/lib/core` and the 15 language modules
  // part 1 registers; React, unified and the full `highlight.js` entry are refused (planted). The parse worker's closure
  // above is unchanged, and highlight.js is still its planted refusal (T11 review 1-1's case). The message tokens are
  // M4.H3's other half, in `markdown-runner.test.ts`'s source pins.
  const HIGHLIGHT_ROOTS: readonly string[] = ['markdownHighlightWorker.ts', 'highlightGrammars.ts'];
  const HIGHLIGHT_LANGUAGES: readonly string[] = [
    'bash', 'typescript', 'javascript', 'json', 'python', 'css', 'xml', 'yaml', 'markdown', 'diff', 'sql', 'dockerfile',
    'rust', 'go', 'php',
  ];
  const HIGHLIGHT_PACKAGES: ReadonlySet<string> = new Set([
    'highlight.js/lib/core', ...HIGHLIGHT_LANGUAGES.map((l) => `highlight.js/lib/languages/${l}`),
  ]);

  describe('M4.H3: the highlight worker closure', () => {
    const { files, refused } = closure(undefined, HIGHLIGHT_ROOTS, HIGHLIGHT_PACKAGES);

    it('is exactly the highlight worker\'s lib files', () => {
      expect(files).toEqual([
        'src/lib/highlightCache.ts', 'src/lib/highlightGrammars.ts', 'src/lib/highlightJob.ts',
        'src/lib/highlightProtocol.ts', 'src/lib/markdownHighlightWorker.ts', 'src/lib/markdownLimits.ts',
      ]);
    });

    it('imports nothing but highlight.js/lib/core and the 15 language modules', () => {
      expect(refused).toEqual([]);
    });

    it('planted: react and unified in the closure are refused', () => {
      const { refused: r } = closure(appendTo('highlightJob.ts', [
        "import { createElement } from 'react';",
        "import { unified } from 'unified';",
        'export const plantedPair = [createElement, unified];',
      ].join('\n')), HIGHLIGHT_ROOTS, HIGHLIGHT_PACKAGES);
      expect(r).toEqual(expect.arrayContaining(['src/lib/highlightJob.ts: react', 'src/lib/highlightJob.ts: unified']));
    });

    it('planted: the full highlight.js entry is refused', () => {
      const { refused: r } = closure(appendTo('highlightGrammars.ts', "import plantedAll from 'highlight.js';\nexport const plantedEntry = plantedAll;"),
        HIGHLIGHT_ROOTS, HIGHLIGHT_PACKAGES);
      expect(r).toContain('src/lib/highlightGrammars.ts: highlight.js');
    });

    it('planted: highlightGrammars imported by the parse worker is refused in the parse closure', () => {
      const { files: f, refused: r } = closure(appendTo('markdownWorker.ts', "import { HLJS } from './highlightGrammars';\nexport const plantedH = HLJS;"));
      expect(f).toContain('src/lib/highlightGrammars.ts');
      expect(r).toContain('src/lib/highlightGrammars.ts: highlight.js/lib/core');
    });
  });
  ```
- [ ] **Step 3: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-highlight-worker.test.ts )` — Expected: the file fails to import. `( cd pwa && ./node_modules/.bin/vitest run test/markdown-purity.test.ts )` — Expected: the file fails to collect (`closure()` reads `markdownHighlightWorker.ts` while the new describe is collected, and the file does not exist yet: ENOENT); record that as the red. W8a's Task 4 met the same shape.
- [ ] **Step 4: Implement.**
  - `pwa/src/lib/highlightJob.ts`:
    ```ts
    // The highlight worker's job (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10 "The job and its
    // outcome", "The worker-side cache" and "The line retry"). `createHighlightAnswerer` answers one job, one block. It
    // drops a message with no finite numeric `id`; answers `unregistered` for a language the instance does not know;
    // else highlights the block whole with the call `CodeBlock` made before W5h (`highlight(code, {language,
    // ignoreIllegals: true}).value`), or, for `mode: 'line'` on a block longer than HIGHLIGHT_LINE_RETRY_UNITS, line by
    // line under the shared Markdown library's C24 rule (each line on its own, joined by its own breaks as written; one
    // line longer than the unit answers `line-too-long`); refuses HTML longer than MD_HIGHLIGHT_MAX_HTML_CHARS as
    // `too-large` before it is posted; and keeps what it computed in a bounded LRU keyed on mode, language and code
    // (desktop polish C7's `createLru`, at its bounds: the W5h-a plan's refinement (c)), so a chat stream highlights
    // only the block that grows. A throw anywhere answers `threw` and the thrown name; a `post` that throws (a structured
    // clone's `DataCloneError`) is answered once more with `threw`, and a throw from that second post is swallowed, so
    // the runner's deadline answers the job.
    //
    // Ring L1, worker side: no I/O. Imports `highlightGrammars.ts`, `highlightCache.ts`, `markdownLimits.ts` and types
    // from `highlightProtocol.ts` (`markdown-purity.test.ts`'s M4.H3 describe holds the closure).
    import { createLru, type Lru } from './highlightCache';
    import { HLJS, type HighlightApi } from './highlightGrammars';
    import type { HighlightReply, HighlightResult } from './highlightProtocol';
    import {
      HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_LINE_RETRY_UNITS, MD_HIGHLIGHT_MAX_HTML_CHARS,
    } from './markdownLimits';

    /** What an answer needs of highlight.js: `getLanguage` and `highlight`. A test hands in a fake. */
    export type HighlightInstance = Pick<HighlightApi, 'getLanguage' | 'highlight'>;

    /** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
    function errorName(e: unknown): string {
      if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
      return typeof e;
    }

    /** `code` as lines and the breaks between them, each break as written (`\r\n`, `\r` or `\n`). One pass. */
    function linesOf(code: string): { readonly lines: string[]; readonly breaks: string[] } {
      const lines: string[] = [];
      const breaks: string[] = [];
      let start = 0;
      for (let i = 0; i < code.length; i += 1) {
        const c = code.charCodeAt(i);
        if (c !== 0x0a && c !== 0x0d) continue;
        lines.push(code.slice(start, i));
        const crlf = c === 0x0d && code.charCodeAt(i + 1) === 0x0a;
        breaks.push(crlf ? '\r\n' : code.charAt(i));
        if (crlf) i += 1;
        start = i + 1;
      }
      lines.push(code.slice(start));
      return { lines, breaks };
    }

    /** An answerer over `h` that keeps its HTML in `cache`. The worker makes one over `HLJS` and a cache at the limits'
     *  bounds; a test hands in a fake instance or a smaller cache. */
    export function createHighlightAnswerer(
      h: HighlightInstance = HLJS,
      cache: Lru<string> = createLru<string>(HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_CACHE_MAX_CHARS, (html) => html.length),
    ): (data: unknown, post: (reply: HighlightReply) => void) => void {
      const colour = (lang: string, code: string): string => h.highlight(code, { language: lang, ignoreIllegals: true }).value;
      const answer = (lang: unknown, code: unknown, mode: unknown): HighlightResult => {
        if (typeof lang !== 'string' || typeof code !== 'string') throw new TypeError('a highlight job needs a string lang and code');
        if (lang === '' || h.getLanguage(lang) === undefined) return { kind: 'unregistered' };
        const lineMode = mode === 'line' && code.length > HIGHLIGHT_LINE_RETRY_UNITS;
        const key = `${lineMode ? 'line' : 'block'}\u0000${lang}\u0000${code}`;
        let html = cache.get(key);
        if (html === undefined) {
          if (lineMode) {
            const { lines, breaks } = linesOf(code);
            const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
            if (longest > HIGHLIGHT_LINE_RETRY_UNITS) return { kind: 'line-too-long', chars: longest };
            html = lines.map((l, i) => colour(lang, l) + (breaks[i] ?? '')).join('');
          } else {
            html = colour(lang, code);
          }
          cache.set(key, html);
        }
        if (html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) return { kind: 'too-large', htmlChars: html.length };
        return { kind: 'html', html, mode: lineMode ? 'line' : 'block' };
      };
      return (data, post) => {
        const d = data as { readonly id?: unknown; readonly lang?: unknown; readonly code?: unknown; readonly mode?: unknown } | null;
        if (typeof d !== 'object' || d === null || typeof d.id !== 'number' || !Number.isFinite(d.id)) return;
        const id = d.id;
        let result: HighlightResult;
        try {
          result = answer(d.lang, d.code, d.mode);
        } catch (e) {
          result = { kind: 'threw', error: errorName(e) };
        }
        try {
          post({ id, result });
        } catch (e) {
          try {
            post({ id, result: { kind: 'threw', error: errorName(e) } });
          } catch {
            // The second post failed too: the runner's deadline answers the job.
          }
        }
      };
    }
    ```
  - `pwa/src/lib/markdownHighlightWorker.ts`:
    ```ts
    // The highlight worker's entry (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10 "Highlighting":
    // its Files table and the ready handshake). `markdownRunner.ts#spawnHighlightWorker` spawns it as a module worker;
    // Vite emits it as a second worker chunk, which the service worker precaches with the shell (M7.11,
    // `markdown-worker-built.test.ts`). It is only the wiring: once its imports have evaluated (the 15 grammars
    // registered on the private instance) it assigns `onmessage`, then posts `{ready: true}` once; each message goes to
    // `highlightJob.ts`'s answerer, whose reply is posted back. Messages are received by ASSIGNING `onmessage`, never by
    // adding a listener (M4.H3's message clause, `markdown-runner.test.ts`). The PWA's tsconfig has no WebWorker lib, so
    // the worker global is typed here by what is used of it.
    //
    // Ring L4: the worker's delivery. Its closure is `markdown-purity.test.ts`'s M4.H3 describe.
    import { createHighlightAnswerer } from './highlightJob';
    import type { HighlightReply } from './highlightProtocol';

    const worker = self as unknown as {
      onmessage: ((e: { data: unknown }) => void) | null;
      postMessage(reply: HighlightReply): void;
    };

    const answer = createHighlightAnswerer();
    worker.onmessage = (e) => answer(e.data, (reply) => worker.postMessage(reply));
    worker.postMessage({ ready: true });
    ```
  - `highlightCache.ts`: its first header sentence becomes `// A bounded least-recently-used cache (desktop polish Task C7; moved off the main thread by native Docs reader W5h-a): the highlight worker (\`highlightJob.ts#createHighlightAnswerer\`) keeps what highlight.js answered in one, so a block drawn again (a row that renders again, the same fence in another message, a Docs page reopened) is not highlighted again.` (the rest of the header unchanged), and in `MADE`'s docstring `a module that makes one (\`markdown.tsx\`)` becomes `a module that makes one (\`highlightJob.ts\`, or \`markdown.tsx\` until W5h-a's Task 6)`.
- [ ] **Step 5: Run to verify they pass.** Step 3's two commands — `markdown-highlight-worker` `Tests  16 passed (16)`; `markdown-purity` Step 0's count plus 5, all green. Then `( cd pwa && ./node_modules/.bin/vitest run test/highlight-cache.test.ts test/highlight-names.test.ts )` — green. `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` — green.
- [ ] **Step 6: Commit.** 5 files by name, message `pwa: the highlight worker answers one block a job, capped, cached, line by line on retry (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T3-M1 | M4.H13 | pwa | `src/lib/highlightJob.ts` | `if (html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) return { kind: 'too-large', htmlChars: html.length };` → removed | `test/markdown-highlight-worker.test.ts` | 2 failed — `'HTML over MD_HIGHLIGHT_MAX_HTML_CHARS is posted as too-large with its length, never as HTML'`; `'line mode still applies the HTML cap to the joined answer'` |
| W5HA-T3-M2 | M4.H18 | pwa | `src/lib/highlightJob.ts` | `const lineMode = mode === 'line' && code.length > HIGHLIGHT_LINE_RETRY_UNITS;` → `const lineMode = mode === 'line';` | `test/markdown-highlight-worker.test.ts` | 1 failed — `'line mode on a block of at most the unit colours it whole, in block mode'` |
| W5HA-T3-M3 | M4.H18 | pwa | `src/lib/highlightJob.ts` | `if (longest > HIGHLIGHT_LINE_RETRY_UNITS) return { kind: 'line-too-long', chars: longest };` → removed | `test/markdown-highlight-worker.test.ts` | 1 failed — `'line mode answers line-too-long, with its length, when one line is over the unit, and colours nothing'` |
| W5HA-T3-M4 | M4.H20 | pwa | `src/lib/highlightJob.ts` | `let html = cache.get(key);` → `let html: string \| undefined = undefined;` | `test/markdown-highlight-worker.test.ts` | 2+ failed — `'the same (mode, lang, code) twice calls highlight once; the other mode is its own entry'`; the default-cache case |
| W5HA-T3-M5 | M4.H3 | pwa | `src/lib/highlightJob.ts` | `import { createLru, type Lru } from './highlightCache';` → that line, then `import 'react';` | `test/markdown-purity.test.ts` | 1 failed — `'imports nothing but highlight.js/lib/core and the 15 language modules'` |
| W5HA-T3-M6 | M4.H3 | pwa | `src/lib/highlightGrammars.ts` | `import hljs from 'highlight.js/lib/core';` → `import hljs from 'highlight.js';` | `test/markdown-purity.test.ts` | 1 failed — `'imports nothing but highlight.js/lib/core and the 15 language modules'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-highlight-worker.test.ts test/markdown-purity.test.ts test/highlight-cache.test.ts )` — all passed; `TSC-OK`.

### Task 4: The generic runner, the highlighter and its two singletons (M4.H7-M4.H10 runner halves, M4.H3's message clause; refinements (g), (l), (m))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in keeping every parse-runner behaviour byte for byte while two options change the core: the existing cases are the contract, and none of them is edited.

**Spec rows:** §4.10 "Worker and runner" (unchanged for the parse runner), "The highlighter", "The highlight runner" (generic, `abortRunning`, the ready handshake, the deadline, the singletons, the one literal); M4.H7, M4.H8, M4.H9, M4.H10; M4.H3's message clause; rich-docs spec A6 (the render job's queue untouched).

**Files:**
- Modify: `pwa/src/lib/markdownRunner.ts` (rewritten around `createWorkerRunner`; its exported names and their behaviour kept, five added), `pwa/test/markdown-runner.test.ts` (one pin describe before the refactor; the source pins widened in place; one appended describe).
- Guards (not edited): `pwa/test/reader-render-job.test.ts`, `pwa/test/markdown-worker.test.ts`, `pwa/test/use-parsed-markdown.test.tsx`, `pwa/test/chat-hardening.test.tsx`, `pwa/test/docs-markdown.test.tsx`, `pwa/test/reader-frame.test.tsx` (every caller of the parse runner).

**Interfaces:**
- Consumes `HighlightJob`, `HighlightOutcome`, `HighlightRequest`, `Highlighter`, `HighlighterStatus` (Task 2), `HIGHLIGHT_BLOCK_DEADLINE_MS`, `HIGHLIGHT_BOOT_BUDGET_MS` (Task 1).
- Keeps, unchanged in meaning: `MarkdownParser`, `WorkerLike` (now generic with today's message type as its default), `MarkdownRunnerDeps` (likewise), `MarkdownRunner`, `defaultSpawn`, `createMarkdownRunner`, `docsRunner`, `chatRunner`.
- Produces: `WorkerMessage<O>`, `WorkerRunnerOptions<M, O>`, `WorkerRunner<M, O>`, `createWorkerRunner`, `spawnHighlightWorker`, `HighlighterDeps`, `createHighlighter`, `docsHighlighter`, `chatHighlighter` (exact text in Step 4).

**Decisions this task makes:** (1) The core is one function; the parse runner passes `abortRunning: 'terminate'` and no `bootBudgetMs`, and with no handshake `booted` is true from spawn, so every branch the parse runner took at BASE is taken in the same order. (2) The highlighter's boot timer starts at spawn; `{ready: true}` clears it, resets the failure count and pumps. A boot failure (the timer, or an `error`/`messageerror` before ready) drops the worker, counts one, and answers every waiting job `worker-failed` (`boot-timeout`, `error` or `messageerror`). At two in a row the runner is sticky: `status()` answers `'worker-failed'`, and a job answers `{kind: 'worker-failed', error: 'boot'}` at once with no spawn. (3) A job's deadline timer starts at post, so a boot never counts against a block (M4.H8). (4) `'detach'` rejects an aborted running job at once with the signal's reason and leaves its timer and the worker alone; `finish` resolves nobody for a detached job, and `dispose` does not reject it twice. (5) `onPosted` runs right after a successful `postMessage`, never for a job whose post threw. (6) `status()` spawns when no worker is live (refinement (g)), as `prewarm()` does. (7) The highlighter's job message is exactly `{id, lang, code}`, or `{id, lang, code, mode: 'line'}` for a retry.

- [ ] **Step 0: Base and the pins as they stand.** `test -f pwa/src/lib/markdownHighlightWorker.ts && git grep -q "export function createMarkdownRunner(deps: Partial<MarkdownRunnerDeps> = {}): MarkdownRunner {" HEAD -- pwa/src/lib/markdownRunner.ts && git grep -q "const WORKER_FILES = \['markdownRunner.ts', 'markdownWorker.ts'\];" HEAD -- pwa/test/markdown-runner.test.ts && echo T4-BASE-OK`. Claim `markdownRunner.ts` and `markdown-runner.test.ts`. Run `( cd pwa && ./node_modules/.bin/vitest run test/markdown-runner.test.ts )` and record: every case green except exactly `'no other lib/markdown* file posts or receives messages'`, red on `markdownHighlightWorker.ts` (Task 3's new entry; this task widens the pin). Any other red: stop and ask. Record the count of each existing describe (they are the parse runner's contract for this task).
- [ ] **Step 1: Pin what the parse runner lacks, before the refactor (refinement (m)).** Insert a new describe in `markdown-runner.test.ts` directly before `describe('source pins', () => {`:
  ```ts
  // Docs W5h-a Task 4, refinement (m): two behaviours of the parse runner no case above pinned, measured green on the
  // BASE runner before it becomes one instance of the generic `createWorkerRunner`.
  describe('W5h-a Task 4: the parse runner, pinned before the generic runner', () => {
    it('a parse runner ignores {ready: true} and a reply with no outcome; the running job answers only its own reply', async () => {
      const { runner, workers } = harness();
      const p = track(runner.parse('a', CHAT));
      workers[0]!.send({ ready: true });
      workers[0]!.send({ id: 1 });
      await flush();
      expect(p.state).toBe('pending');
      expect(workers[0]!.posts).toHaveLength(1);
      workers[0]!.reply(1, answer(1));
      await flush();
      expect(p).toMatchObject({ state: 'resolved', value: answer(1) });
    });

    it('a parse runner posts its first job in the same call that spawns, with no handshake', () => {
      const { runner, workers, spawn } = harness();
      void runner.parse('a', CHAT);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(workers[0]!.posts).toEqual([{ id: 1, src: 'a', profile: 'chat' }]);
    });
  });
  ```
  Run Step 0's command: the two new cases green on the BASE runner (if either is red, stop and ask: the pin would describe a behaviour BASE does not have).
- [ ] **Step 2: Widen the source pins in place (M4.H3's message clause; refinement (l)).** In `describe('source pins', …)`:
  - `const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^markdown.*\.tsx?$/.test(f)).sort();` → `const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^(?:markdown|highlight).*\.tsx?$/.test(f)).sort();`
  - `const WORKER_FILES = ['markdownRunner.ts', 'markdownWorker.ts'];` → `const WORKER_FILES = ['markdownHighlightWorker.ts', 'markdownRunner.ts', 'markdownWorker.ts'];`
  - Add, after `WORKER_FILES`: `/** Whether a source posts or receives messages; whether it adds a message listener. One predicate each, read by the real cases and by their planted controls. */ const postsOrReceives = (s: string): boolean => /postMessage\s*\(|onmessage/.test(s); const addsMessageListener = (s: string): boolean => /addEventListener\s*\(\s*['"\`]message/.test(s);` and use them in the two cases below in place of their inline regexes.
  - Rename `'the two worker files receive by assigning onmessage and send with postMessage('` to `'the three worker files receive by assigning onmessage and send with postMessage( (M4.H3)'`; rename `'no other lib/markdown* file posts or receives messages'` to `'no other lib/markdown* or lib/highlight* file posts or receives messages (M4.H3)'` and change its first assertion's list to `[...WORKER_FILES, 'markdownParse.ts', 'markdown.tsx', 'highlightJob.ts', 'highlightGrammars.ts']`; rename `'no lib/markdown* file adds a message listener or makes an object URL'` to `'no lib/markdown* or lib/highlight* file adds a message listener or makes an object URL (M4.H3)'`.
  - Append two cases inside the describe:
    ```ts
    it('planted (M4.H3): a postMessage( or an onmessage assignment in the store is red', () => {
      expect(postsOrReceives('export const plant = (w: Worker) => w.postMessage(1);')).toBe(true);
      expect(postsOrReceives('export const plant = (w: { onmessage: unknown }) => { w.onmessage = null; };')).toBe(true);
      expect(MARKDOWN_FILES.filter((f) => !WORKER_FILES.includes(f)).every((f) => !postsOrReceives(read(f)))).toBe(true);
    });

    it('planted (M4.H3): a message listener in the store is red', () => {
      expect(addsMessageListener("self.addEventListener('message', () => undefined);")).toBe(true);
      expect(MARKDOWN_FILES.every((f) => !addsMessageListener(read(f)))).toBe(true);
    });
    ```
  Run Step 0's command: all green now (the widened pin admits the third file).
- [ ] **Step 3: Write the highlighter's describe.** Append to `markdown-runner.test.ts`, after its last describe:
  ```ts
  // Docs W5h-a Task 4 (base spec 2026-10-01 section 4.10's "The highlight runner"; M4.H7, M4.H8, M4.H9, M4.H10): the
  // highlighter is `createWorkerRunner` with the ready handshake and the detach abort. Fake spawn, fake clock. The parse
  // runner's cases above pass unchanged beside it.
  class FakeHlWorker implements WorkerLike<HighlightJob> {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessageerror: ((e: unknown) => void) | null = null;
    readonly posts: HighlightJob[] = [];
    terminated = 0;
    postMessage(job: HighlightJob): void { this.posts.push(job); }
    terminate(): void { this.terminated += 1; }
    ready(): void { this.onmessage?.({ data: { ready: true } }); }
    answer(id: number, result: HighlightResult): void { this.onmessage?.({ data: { id, result } }); }
    fail(): void { this.onerror?.({ type: 'error' }); }
  }

  function hlHarness(throwOnSpawn = false) {
    const clock = new FakeClock();
    const workers: FakeHlWorker[] = [];
    const spawn = vi.fn((): WorkerLike<HighlightJob> => {
      if (throwOnSpawn) throw new ReferenceError('Worker is not defined');
      const w = new FakeHlWorker();
      workers.push(w);
      return w;
    });
    const hl = createHighlighter({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    return { hl, clock, workers, spawn };
  }

  const HTML = (s: string): HighlightResult => ({ kind: 'html', html: s, mode: 'block' });
  function trackHl(p: Promise<HighlightOutcome>): { state: string; value?: HighlightOutcome; reason?: unknown } {
    const t: { state: string; value?: HighlightOutcome; reason?: unknown } = { state: 'pending' };
    p.then((v) => { t.state = 'resolved'; t.value = v; }, (r: unknown) => { t.state = 'rejected'; t.reason = r; });
    return t;
  }
  const req = (code: string): HighlightRequest => ({ lang: 'ts', code });

  describe('W5h-a: the highlighter (createWorkerRunner with a ready handshake and detach)', () => {
    it('M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line', async () => {
      const { hl, workers } = hlHarness();
      void hl.highlight(req('a'), {});
      void hl.highlight({ lang: 'ts', code: 'b', mode: 'line' }, {});
      expect(workers[0]!.posts).toEqual([]);
      workers[0]!.ready();
      expect(workers[0]!.posts).toEqual([{ id: 1, lang: 'ts', code: 'a' }]);
      workers[0]!.answer(1, HTML('a'));
      await flush();
      expect(workers[0]!.posts[1]).toEqual({ id: 2, lang: 'ts', code: 'b', mode: 'line' });
    });

    it('M4.H8: the block deadline starts at post, not at request: a 1 999 ms boot then 749 ms of work is no timeout', async () => {
      const { hl, clock, workers } = hlHarness();
      const p = trackHl(hl.highlight(req('a'), {}));
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS - 1);
      workers[0]!.ready();
      clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS - 1);
      await flush();
      expect(p.state).toBe('pending');
      clock.advance(1);
      await flush();
      expect(p.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
    });

    it('M4.H8: a worker that never says ready answers every waiting job worker-failed at the boot budget, terminated', async () => {
      const { hl, clock, workers } = hlHarness();
      const a = trackHl(hl.highlight(req('a'), {}));
      const b = trackHl(hl.highlight(req('b'), {}));
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
      await flush();
      expect([a.value, b.value]).toEqual([
        { kind: 'worker-failed', error: 'boot-timeout' }, { kind: 'worker-failed', error: 'boot-timeout' },
      ]);
      expect(workers[0]!.terminated).toBe(1);
      expect(workers[0]!.posts).toEqual([]);
    });

    it('M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn', async () => {
      const { hl, clock, spawn } = hlHarness();
      void hl.highlight(req('a'), {});
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
      const b = trackHl(hl.highlight(req('b'), {}));
      expect(spawn).toHaveBeenCalledTimes(2);
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
      await flush();
      expect(b.value).toEqual({ kind: 'worker-failed', error: 'boot-timeout' });
      const c = trackHl(hl.highlight(req('c'), {}));
      await flush();
      expect(c.value).toEqual({ kind: 'worker-failed', error: 'boot' });
      expect(hl.status()).toBe('worker-failed');
      hl.prewarm();
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('M4.H8: a boot that succeeds resets the count: fail, ready, then one more failure is not sticky', async () => {
      const { hl, clock, workers, spawn } = hlHarness();
      void hl.highlight(req('a'), {});
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
      const b = trackHl(hl.highlight(req('b'), {}));
      workers[1]!.ready();
      clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
      await flush();
      expect(b.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
      void hl.highlight(req('c'), {});
      clock.advance(HIGHLIGHT_BOOT_BUDGET_MS);
      expect(hl.status()).toBe('live');
      expect(spawn).toHaveBeenCalledTimes(4);
    });

    it('M4.H8: an error event while booting is a boot failure for the waiting jobs', async () => {
      const { hl, workers } = hlHarness();
      const a = trackHl(hl.highlight(req('a'), {}));
      workers[0]!.fail();
      await flush();
      expect(a.value).toEqual({ kind: 'worker-failed', error: 'error' });
    });

    it('M4.H7: after {ready}, a job that never answers times out at the deadline, terminate once, the next job respawns', async () => {
      const { hl, clock, workers, spawn } = hlHarness();
      const a = trackHl(hl.highlight(req('a'), {}));
      workers[0]!.ready();
      clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
      await flush();
      expect(a.value).toEqual({ kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
      expect(workers[0]!.terminated).toBe(1);
      void hl.highlight(req('b'), {});
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('M4.H7: only the overrun block is lost: of a, b, c, b never answers and a and c are answered', async () => {
      const { hl, clock, workers } = hlHarness();
      const [a, b, c] = ['a', 'b', 'c'].map((s) => trackHl(hl.highlight(req(s), {})));
      workers[0]!.ready();
      workers[0]!.answer(1, HTML('A'));
      await flush();
      clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
      await flush();
      workers[1]!.ready();
      workers[1]!.answer(3, HTML('C'));
      await flush();
      expect([a!.value, b!.value, c!.value]).toEqual([HTML('A'), { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, HTML('C')]);
    });

    it('M4.H9: aborting a running highlight job rejects it, never terminates, and the same worker serves the next job', async () => {
      const { hl, workers, spawn } = hlHarness();
      const ctl = new AbortController();
      const a = trackHl(hl.highlight(req('a'), { signal: ctl.signal }));
      const b = trackHl(hl.highlight(req('b'), {}));
      workers[0]!.ready();
      ctl.abort();
      await flush();
      expect(a.state).toBe('rejected');
      expect(workers[0]!.terminated).toBe(0);
      expect(workers[0]!.posts).toHaveLength(1);
      workers[0]!.answer(1, HTML('A'));
      await flush();
      expect(workers[0]!.posts[1]).toEqual({ id: 2, lang: 'ts', code: 'b' });
      workers[0]!.answer(2, HTML('B'));
      await flush();
      expect(b.value).toEqual(HTML('B'));
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('M4.H9: a detached job\'s deadline still runs: its timeout terminates and reaches nobody', async () => {
      const { hl, clock, workers } = hlHarness();
      const ctl = new AbortController();
      const a = trackHl(hl.highlight(req('a'), { signal: ctl.signal }));
      workers[0]!.ready();
      ctl.abort();
      clock.advance(HIGHLIGHT_BLOCK_DEADLINE_MS);
      await flush();
      expect(a.state).toBe('rejected');
      expect(workers[0]!.terminated).toBe(1);
    });

    it('M4.H9: aborting a running parse job still terminates', async () => {
      const { runner, workers } = harness();
      const ctl = new AbortController();
      const p = track(runner.parse('a', { ...CHAT, signal: ctl.signal }));
      ctl.abort();
      await flush();
      expect(p.state).toBe('rejected');
      expect(workers[0]!.terminated).toBe(1);
    });

    it('M4.H10: a spawn that throws is a sticky worker-unavailable: status says so, every job answers it, no further spawn', async () => {
      const { hl, spawn } = hlHarness(true);
      expect(hl.status()).toBe('worker-unavailable');
      const a = trackHl(hl.highlight(req('a'), {}));
      await flush();
      expect(a.value).toEqual({ kind: 'worker-unavailable' });
      hl.prewarm();
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('M4.H10: HighlightOutcome is its own union of eight arms, and ParseOutcome keeps its eight', () => {
      const arms: Record<HighlightOutcome['kind'], true> = {
        html: true, unregistered: true, 'too-large': true, 'line-too-long': true, threw: true, timeout: true,
        'worker-unavailable': true, 'worker-failed': true,
      };
      expect(Object.keys(arms)).toHaveLength(8);
      // ParseOutcome keeps its eight arms: an exhaustive literal is a type error under the pwa typecheck when an arm is
      // added or removed (W8a's 'ParseOutcome keeps its eight arms' case pins the same, in this file).
      const parseArms: Record<ParseOutcome['kind'], true> = {
        tree: true, refused: true, 'too-deep': true, 'too-wide': true, threw: true, timeout: true,
        'worker-unavailable': true, 'worker-failed': true,
      };
      expect(Object.keys(parseArms)).toHaveLength(8);
      // @ts-expect-error a highlight answer is not a parse outcome
      const notParse: ParseOutcome = { kind: 'html', html: '', mode: 'block' };
      expect(notParse.kind).toBe('html');
    });

    it('onPosted runs when the job is posted: after ready, after the job ahead of it, never for an unposted job', async () => {
      const { hl, workers } = hlHarness();
      const seen: string[] = [];
      void hl.highlight(req('a'), { onPosted: () => seen.push('a') });
      void hl.highlight(req('b'), { onPosted: () => seen.push('b') });
      expect(seen).toEqual([]);
      workers[0]!.ready();
      expect(seen).toEqual(['a']);
      workers[0]!.answer(1, HTML('A'));
      await flush();
      expect(seen).toEqual(['a', 'b']);
    });

    it('a reply for another id, or with no result object, is ignored', async () => {
      const { hl, workers } = hlHarness();
      const a = trackHl(hl.highlight(req('a'), {}));
      workers[0]!.ready();
      workers[0]!.answer(9, HTML('X'));
      workers[0]!.onmessage?.({ data: { id: 1, result: null } });
      await flush();
      expect(a.state).toBe('pending');
    });

    it('docsHighlighter and chatHighlighter are two highlighters', () => {
      expect(docsHighlighter).not.toBe(chatHighlighter);
      expect(typeof docsHighlighter.highlight).toBe('function');
    });

    it('markdownRunner.ts spells the highlight worker URL as one literal expression, once, in spawnHighlightWorker', () => {
      const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownRunner.ts'), 'utf8');
      const literal = "new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' })";
      expect(src.split(literal)).toHaveLength(2);
      expect(src).toMatch(/export function spawnHighlightWorker\(\): WorkerLike<HighlightJob> \{\n\s+return new Worker\(new URL\('\.\/markdownHighlightWorker\.ts'/);
    });
  });
  ```
  Extend the file's imports: `import type { HighlightJob, HighlightOutcome, HighlightRequest, HighlightResult } from '../src/lib/highlightProtocol';`; add `chatHighlighter, createHighlighter, docsHighlighter` to the `'../src/lib/markdownRunner'` import; add `HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS` to the `'../src/lib/markdownLimits'` import.
- [ ] **Step 4: Run to verify they fail.** Step 0's command — Expected: the file fails to compile its imports (`createHighlighter`, `chatHighlighter`, `docsHighlighter` absent) — one failed file; record it as the red.
- [ ] **Step 5: Implement.** Rewrite `pwa/src/lib/markdownRunner.ts`. Keep its header comment as it is and append to it:
  ```ts
  //
  // W5h-a Task 4 (base spec 2026-10-01 section 4.10's "The highlighter" and "The highlight runner"): everything above
  // is `createWorkerRunner<M, O>`, generic over the message a job posts and the outcome it resolves with. The parse
  // runner (`createMarkdownRunner`, both of its job kinds) is one instance and behaves exactly as described above,
  // which `markdown-runner.test.ts` pins case by case. It uses neither of the two options:
  //   - `bootBudgetMs`, the ready handshake: a spawned worker takes no job until it posts `{ready: true}`. The boot timer
  //     starts at spawn; past it, or on an error before ready, the worker is dropped and every job waiting for it
  //     answers `onFailed`. The next job, `prewarm` or `status` respawns once; a second boot failure in a row is sticky,
  //     and every later job answers `onFailed('boot')` at once, with no spawn, until the app reloads. A job's own timer
  //     starts at post, after ready, so a boot never counts against a block.
  //   - `abortRunning: 'detach'`: an aborted running job rejects at once, but the worker is kept and the job's timer still
  //     runs; its answer, or its timeout, reaches nobody, and the FIFO waits for it at most one deadline.
  // The highlighter (`createHighlighter`) is the other instance: a deadline of HIGHLIGHT_BLOCK_DEADLINE_MS from post, a
  // boot budget of HIGHLIGHT_BOOT_BUDGET_MS, detach. Its worker is spawned through ONE literal, in `spawnHighlightWorker()`,
  // which both singletons and R19's measurement page use, so Vite emits a second worker chunk (M7.11). Two singletons,
  // `docsHighlighter` and `chatHighlighter`: a Docs page's queue never delays chat, and no highlight job ever shares a
  // queue or a terminate with a parse or a render job (the rich-docs spec's A6).
  ```
  The body below the header, in full:
  ```ts
  import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';
  import type { ReaderRenderJob, ReaderRenderOutcome } from './readerRenderJob';
  import type {
    Highlighter, HighlighterStatus, HighlightJob, HighlightOutcome, HighlightRequest,
  } from './highlightProtocol';
  import { HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS } from './markdownLimits';

  /** The type of `runner.parse`. Resolves with the job's outcome; rejects only on an abort or `dispose()`. */
  export type MarkdownParser = (
    src: string,
    opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal },
  ) => Promise<ParseOutcome>;

  /** The part of a `Worker` a runner uses; a test hands in a fake. `M` is the message a job posts. */
  export interface WorkerLike<M = MarkdownJob | ReaderRenderJob> {
    postMessage(message: M): void;
    terminate(): void;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: unknown) => void) | null;
    onmessageerror: ((e: unknown) => void) | null;
  }

  export interface MarkdownRunnerDeps<M = MarkdownJob | ReaderRenderJob> {
    /** Starts a worker. A throw means no worker can be had here, for good. */
    spawn: () => WorkerLike<M>;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
  }

  export interface MarkdownRunner {
    readonly parse: MarkdownParser;
    /** The reader's render job, on the same queue and budget as `parse`. Resolves with the job's outcome; rejects only
     *  on an abort or `dispose()`. */
    readonly render: (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome>;
    /** Spawns the worker now, when there is none, so the first job does not wait for it to start. */
    prewarm(): void;
    /** Terminates the worker and rejects every pending job with an `AbortError`. A later job spawns again. */
    dispose(): void;
  }

  /** A module worker over `markdownWorker.ts`. Throws where there is no `Worker` (jsdom, an old browser). */
  export function defaultSpawn(): WorkerLike {
    return new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
  }

  /** What a runner reads from one worker message: a reply for the job `id`, the ready handshake, or neither. */
  export type WorkerMessage<O> =
    | { readonly kind: 'reply'; readonly id: unknown; readonly outcome: O }
    | { readonly kind: 'ready' }
    | { readonly kind: 'other' };

  const OTHER = { kind: 'other' } as const;

  export interface WorkerRunnerOptions<M, O> extends MarkdownRunnerDeps<M> {
    /** Reads one message from the worker. */
    readonly read: (data: unknown) => WorkerMessage<O>;
    /** The outcomes the runner makes itself. */
    readonly onTimeout: (budgetMs: number) => O;
    readonly onFailed: (error: string) => O;
    readonly onUnavailable: () => O;
    /** What an abort does to the running job: terminate the worker, or drop the job's answer and keep the worker. */
    readonly abortRunning: 'terminate' | 'detach';
    /** The ready handshake's budget, from spawn; absent, a spawned worker takes jobs at once. */
    readonly bootBudgetMs?: number;
  }

  export interface WorkerRunner<M, O> {
    /** Queues one job; `message(id)` is what it posts. Resolves with its outcome; rejects only on an abort or
     *  `dispose()`. `onPosted` runs right after the job is posted. */
    run(
      message: (id: number) => M, budgetMs: number,
      opts?: { readonly signal?: AbortSignal; readonly onPosted?: () => void },
    ): Promise<O>;
    /** Spawns when no worker is live, then answers whether a job can be taken. */
    status(): 'live' | 'unavailable' | 'failed';
    prewarm(): void;
    dispose(): void;
  }

  /** The error a job answers once two boots have failed in a row. */
  const BOOT_FAILED = 'boot';

  interface Job<M, O> {
    readonly id: number;
    readonly message: (id: number) => M;
    readonly budgetMs: number;
    /** The caller's signal; absent when the caller gave none. */
    readonly signal?: AbortSignal;
    readonly onPosted?: () => void;
    readonly resolve: (outcome: O) => void;
    readonly reject: (reason: unknown) => void;
    readonly onAbort: () => void;
  }

  /** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
  function thrownName(e: unknown): string {
    if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
    return typeof e;
  }

  export function createWorkerRunner<M, O>(o: WorkerRunnerOptions<M, O>): WorkerRunner<M, O> {
    const { spawn, setTimer, clearTimer, read, onTimeout, onFailed, onUnavailable, abortRunning, bootBudgetMs } = o;
    /** The live worker; absent before the first spawn and after a drop. */
    let worker: WorkerLike<M> | undefined;
    /** Set by a spawn that threw; never cleared. */
    let unavailable = false;
    /** Boots that failed in a row; two make the runner sticky. Only a runner with a handshake ever counts one. */
    let bootFailures = 0;
    /** Whether the live worker may take a job: from spawn without a handshake, from `{ready}` with one. */
    let booted = false;
    /** The live worker's boot timer, while it boots. */
    let bootTimer: unknown;
    let nextId = 1;
    const queue: Job<M, O>[] = [];
    /** The posted job, its timer, and whether it was detached; absent while no job is posted. */
    let running: { readonly job: Job<M, O>; readonly timer: unknown; detached: boolean } | undefined;

    const sticky = (): boolean => bootFailures >= 2;

    /** Forgets the live worker: its boot timer is cleared, its handlers are cleared, then it is terminated. */
    function drop(): void {
      const w = worker;
      worker = undefined;
      if (bootTimer !== undefined) {
        clearTimer(bootTimer);
        bootTimer = undefined;
      }
      if (w === undefined) return;
      w.onmessage = null;
      w.onerror = null;
      w.onmessageerror = null;
      w.terminate();
    }

    /** The live worker, spawned when there is none; absent when no worker can be had (unavailable, or sticky). */
    function live(): WorkerLike<M> | undefined {
      if (unavailable || sticky()) return undefined;
      if (worker !== undefined) return worker;
      let w: WorkerLike<M>;
      try {
        w = spawn();
      } catch {
        unavailable = true;
        return undefined;
      }
      w.onmessage = (e) => {
        const m = read(e.data);
        if (m.kind === 'ready') {
          if (!booted) ready();
          return;
        }
        if (m.kind === 'reply' && running !== undefined && m.id === running.job.id) finish(m.outcome);
      };
      w.onerror = () => fail('error');
      w.onmessageerror = () => fail('messageerror');
      worker = w;
      booted = bootBudgetMs === undefined;
      if (bootBudgetMs !== undefined) bootTimer = setTimer(() => bootFail('boot-timeout'), bootBudgetMs);
      return w;
    }

    /** The live worker said ready: its boot timer stops, the failure count resets, and the queue moves. */
    function ready(): void {
      booted = true;
      bootFailures = 0;
      if (bootTimer !== undefined) {
        clearTimer(bootTimer);
        bootTimer = undefined;
      }
      pump();
    }

    /** The live worker never said ready: it is dropped, one failure is counted, and every waiting job answers. */
    function bootFail(error: string): void {
      drop();
      bootFailures += 1;
      for (const job of queue.splice(0)) {
        job.signal?.removeEventListener('abort', job.onAbort);
        job.resolve(onFailed(error));
      }
    }

    /** The running job answers `outcome` (nobody hears it when it was detached); the next queued job is posted. */
    function finish(outcome: O): void {
      const r = running;
      if (r === undefined) return;
      running = undefined;
      clearTimer(r.timer);
      r.job.signal?.removeEventListener('abort', r.job.onAbort);
      if (!r.detached) r.job.resolve(outcome);
      pump();
    }

    /** The worker failed: before ready, a boot failure; after, it is dropped and the running job answers `onFailed`. */
    function fail(error: string): void {
      if (!booted) {
        bootFail(error);
        return;
      }
      drop();
      finish(onFailed(error));
    }

    /** The budget of `job` ran out. */
    function expire(job: Job<M, O>): void {
      if (running?.job !== job) return;
      drop();
      finish(onTimeout(job.budgetMs));
    }

    /** Posts the next queued job when none is running and the worker is ready; with no worker to be had, answers each
     *  queued job at once. A queued job whose signal is already aborted is skipped and rejects as an abort does, with
     *  no spawn and no post (review 408, F7). */
    function pump(): void {
      while (running === undefined) {
        const job = queue[0];
        if (job === undefined) return;
        if (job.signal?.aborted) {
          queue.shift();
          job.signal.removeEventListener('abort', job.onAbort);
          job.reject(job.signal.reason);
          continue;
        }
        const w = live();
        if (w === undefined) {
          queue.shift();
          job.signal?.removeEventListener('abort', job.onAbort);
          job.resolve(unavailable ? onUnavailable() : onFailed(BOOT_FAILED));
          continue;
        }
        if (!booted) return;
        queue.shift();
        running = { job, timer: setTimer(() => expire(job), job.budgetMs), detached: false };
        try {
          w.postMessage(job.message(job.id));
        } catch (e) {
          fail(thrownName(e));
          continue;
        }
        job.onPosted?.();
      }
    }

    function abort(job: Job<M, O>): void {
      const reason: unknown = job.signal?.reason;
      if (running?.job === job) {
        if (abortRunning === 'detach') {
          running.detached = true;
          job.reject(reason);
          return;
        }
        clearTimer(running.timer);
        running = undefined;
        drop();
        job.reject(reason);
        pump();
        return;
      }
      const at = queue.indexOf(job);
      if (at !== -1) {
        // Out of the queue now, not skipped by `pump` at its turn: its source is not held behind a running job.
        queue.splice(at, 1);
        job.reject(reason);
      }
    }

    function run(
      message: (id: number) => M, budgetMs: number,
      opts: { readonly signal?: AbortSignal; readonly onPosted?: () => void } = {},
    ): Promise<O> {
      return new Promise<O>((resolve, reject) => {
        const signal = opts.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const id = nextId;
        nextId += 1;
        const job: Job<M, O> = {
          id, message, budgetMs, signal, onPosted: opts.onPosted, resolve, reject, onAbort: () => abort(job),
        };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        queue.push(job);
        pump();
      });
    }

    function status(): 'live' | 'unavailable' | 'failed' {
      live();
      return unavailable ? 'unavailable' : sticky() ? 'failed' : 'live';
    }

    function prewarm(): void {
      live();
    }

    function dispose(): void {
      const reason = new DOMException('disposed', 'AbortError');
      const pending = queue.splice(0);
      const r = running;
      running = undefined;
      if (r !== undefined) {
        clearTimer(r.timer);
        if (!r.detached) pending.unshift(r.job);
      }
      drop();
      for (const job of pending) {
        job.signal?.removeEventListener('abort', job.onAbort);
        job.reject(reason);
      }
    }

    return { run, status, prewarm, dispose };
  }

  const realSetTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
  const realClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

  /** The parse worker's reply: `{id, outcome}`; anything else (a `{ready: true}` included) is not one. */
  function readParseReply(data: unknown): WorkerMessage<ParseOutcome | ReaderRenderOutcome> {
    const reply = data as { readonly id?: unknown; readonly outcome?: ParseOutcome | ReaderRenderOutcome } | null;
    if (typeof reply !== 'object' || reply === null || reply.outcome === undefined) return OTHER;
    return { kind: 'reply', id: reply.id, outcome: reply.outcome };
  }

  export function createMarkdownRunner(deps: Partial<MarkdownRunnerDeps> = {}): MarkdownRunner {
    const core = createWorkerRunner<MarkdownJob | ReaderRenderJob, ParseOutcome | ReaderRenderOutcome>({
      spawn: deps.spawn ?? defaultSpawn,
      setTimer: deps.setTimer ?? realSetTimer,
      clearTimer: deps.clearTimer ?? realClearTimer,
      read: readParseReply,
      onTimeout: (budgetMs) => ({ kind: 'timeout', budgetMs }),
      onFailed: (error) => ({ kind: 'worker-failed', error }),
      onUnavailable: () => ({ kind: 'worker-unavailable' }),
      abortRunning: 'terminate',
    });
    // The worker answers each kind with that kind's own outcome type, and the runner's three arms belong to both.
    const parse: MarkdownParser = (src, opts) =>
      core.run((id) => ({ id, src, profile: opts.profile }), opts.budgetMs, { signal: opts.signal }) as Promise<ParseOutcome>;
    const render: MarkdownRunner['render'] = (src, opts) =>
      core.run((id) => ({ id, kind: 'render', src }), opts.budgetMs, { signal: opts.signal }) as Promise<ReaderRenderOutcome>;
    return { parse, render, prewarm: () => core.prewarm(), dispose: () => core.dispose() };
  }

  /** The Docs screen's runner (W5 passes `docsRunner.parse` as its default parser). */
  export const docsRunner: MarkdownRunner = createMarkdownRunner();
  /** Chat's runner, for messages over `CHAT_SYNC_MAX_BYTES` (Task 6). */
  export const chatRunner: MarkdownRunner = createMarkdownRunner();

  /** The highlight worker's message: `{ready: true}`, or `{id, result}` with a result object. */
  function readHighlightReply(data: unknown): WorkerMessage<HighlightOutcome> {
    if (typeof data !== 'object' || data === null) return OTHER;
    const d = data as { readonly ready?: unknown; readonly id?: unknown; readonly result?: unknown };
    if (d.ready === true) return { kind: 'ready' };
    if (typeof d.result !== 'object' || d.result === null) return OTHER;
    return { kind: 'reply', id: d.id, outcome: d.result as HighlightOutcome };
  }

  /** A module worker over `markdownHighlightWorker.ts`: the ONE literal that spawns it (M7.11). Throws where there is no
   *  `Worker`. */
  export function spawnHighlightWorker(): WorkerLike<HighlightJob> {
    return new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike<HighlightJob>;
  }

  export interface HighlighterDeps extends MarkdownRunnerDeps<HighlightJob> {
    /** A job's deadline from post: HIGHLIGHT_BLOCK_DEADLINE_MS unless R19's page measures past it. */
    readonly deadlineMs: number;
    /** From spawn to `{ready}`: HIGHLIGHT_BOOT_BUDGET_MS. */
    readonly bootBudgetMs: number;
  }

  const HIGHLIGHTER_STATUS: Readonly<Record<'live' | 'unavailable' | 'failed', HighlighterStatus>> = {
    live: 'live', unavailable: 'worker-unavailable', failed: 'worker-failed',
  };

  /** A highlighter: `createWorkerRunner` over the highlight worker, with the ready handshake and the detach abort. */
  export function createHighlighter(deps: Partial<HighlighterDeps> = {}): Highlighter {
    const deadlineMs = deps.deadlineMs ?? HIGHLIGHT_BLOCK_DEADLINE_MS;
    const core = createWorkerRunner<HighlightJob, HighlightOutcome>({
      spawn: deps.spawn ?? spawnHighlightWorker,
      setTimer: deps.setTimer ?? realSetTimer,
      clearTimer: deps.clearTimer ?? realClearTimer,
      read: readHighlightReply,
      onTimeout: (budgetMs) => ({ kind: 'timeout', budgetMs }),
      onFailed: (error) => ({ kind: 'worker-failed', error }),
      onUnavailable: () => ({ kind: 'worker-unavailable' }),
      abortRunning: 'detach',
      bootBudgetMs: deps.bootBudgetMs ?? HIGHLIGHT_BOOT_BUDGET_MS,
    });
    const message = (r: HighlightRequest) => (id: number): HighlightJob =>
      r.mode === 'line' ? { id, lang: r.lang, code: r.code, mode: 'line' } : { id, lang: r.lang, code: r.code };
    return {
      highlight: (request, opts) => core.run(message(request), deadlineMs, opts),
      status: () => HIGHLIGHTER_STATUS[core.status()],
      prewarm: () => core.prewarm(),
    };
  }

  /** The Docs screen's highlighter: a Docs page's, a text leaf's (and from W6 a mockup Source's) blocks. */
  export const docsHighlighter: Highlighter = createHighlighter();
  /** Chat's highlighter: every message's blocks and every tool well's. */
  export const chatHighlighter: Highlighter = createHighlighter();
  ```
- [ ] **Step 6: Run to verify they pass.** Step 0's command — all green: every pre-existing case unchanged, the two pins, the two planted message cases, the highlighter's 17 cases. Then the guard suites, each unchanged and green: `( cd pwa && ./node_modules/.bin/vitest run test/reader-render-job.test.ts test/markdown-worker.test.ts test/use-parsed-markdown.test.tsx test/chat-hardening.test.tsx test/docs-markdown.test.tsx test/reader-frame.test.tsx )`; `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone (the parse chunk and the render chunk still build and answer; the highlight chunk is now emitted too, which Task 8 pins). `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` — green.
- [ ] **Step 7: Commit.** 2 files by name, message `pwa: one generic worker runner; the parse runner is an instance, the highlighter another (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T4-M1 | M4.H7 | pwa | `src/lib/markdownRunner.ts` | `running = { job, timer: setTimer(() => expire(job), job.budgetMs), detached: false };` → `running = { job, timer: undefined, detached: false };` | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H7: after {ready}, a job that never answers times out at the deadline, terminate once, the next job respawns'` (M4.P6's cases red with it) |
| W5HA-T4-M2 | M4.H8 | pwa | `src/lib/markdownRunner.ts` | `if (!booted) return;` → removed | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line'` |
| W5HA-T4-M3 | M4.H9 | pwa | `src/lib/markdownRunner.ts` | `if (abortRunning === 'detach') {` → `if (abortRunning !== abortRunning) {` | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H9: aborting a running highlight job rejects it, never terminates, and the same worker serves the next job'` |
| W5HA-T4-M4 | M4.H8 | pwa | `src/lib/markdownRunner.ts` | `const sticky = (): boolean => bootFailures >= 2;` → `const sticky = (): boolean => false;` | `test/markdown-runner.test.ts` | 1 failed — `'M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn'` |
| W5HA-T4-M5 | M4.H8 | pwa | `src/lib/markdownRunner.ts` | `if (bootBudgetMs !== undefined) bootTimer = setTimer(() => bootFail('boot-timeout'), bootBudgetMs);` → removed | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H8: a worker that never says ready answers every waiting job worker-failed at the boot budget, terminated'` |
| W5HA-T4-M6 | M4.H10 | pwa | `src/lib/markdownRunner.ts` | `unavailable = true;` → removed (a spawn that throws is no longer sticky) | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H10: a spawn that throws is a sticky worker-unavailable: status says so, every job answers it, no further spawn'` (M4.P7's cases red with it) |
| W5HA-T4-M7 | M4.H3 | pwa | `test/markdown-runner.test.ts` | `const WORKER_FILES = ['markdownHighlightWorker.ts', 'markdownRunner.ts', 'markdownWorker.ts'];` → `const WORKER_FILES = ['markdownRunner.ts', 'markdownWorker.ts'];` | `test/markdown-runner.test.ts` | 1+ failed — `'no other lib/markdown* or lib/highlight* file posts or receives messages (M4.H3)'` (with it, `'planted (M4.H3): a postMessage( or an onmessage assignment in the store is red'`, whose third assertion filters by `WORKER_FILES`: 2 in all; Task 8's planted-read case reads `highlightStore.ts` alone and stays green; W5HA-T8-M10 is its row) |
| W5HA-T4-M8 | M4.H8 | pwa | `src/lib/markdownRunner.ts` | `if (d.ready === true) return { kind: 'ready' };` → removed | `test/markdown-runner.test.ts` | 1+ failed — `'M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line'` |
| W5HA-T4-M9 | M4.H10 | pwa | `src/lib/markdownParse.ts` | `\| { kind: 'worker-failed'; error: string }; // runner only` → `\| { kind: 'worker-failed'; error: string } // runner only\n  \| { kind: 'planted' };` (a ninth `ParseOutcome` arm) | the pwa typecheck (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, run in `pwa/`; its program includes `test/`) | 1+ errors — TS2741 (property `planted` missing) on the `parseArms` literal of `'M4.H10: HighlightOutcome is its own union of eight arms, and ParseOutcome keeps its eight'` and on W8a's `'ParseOutcome keeps its eight arms'` literal; the exhaustive switches of `chatPlainNote` and `docsPlainNote` may error too |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-runner.test.ts test/reader-render-job.test.ts test/use-parsed-markdown.test.tsx )` — all passed; `markdown-worker-built.test.ts` alone — all passed; `TSC-OK`.

### Task 5: The store and the main-thread check (M4.H11, M4.H12, M4.H13 main half, M4.H14, M4.H18 store half; refinements (e), (g), (j), (k), (r))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the ceilings' latch (one ceiling wins, before any listener runs), in what a retry the ceilings refuse becomes, and in keeping the check one linear pass.

**Spec rows:** §4.10 "The store" (its operation table, Keys, Seeding, Entries, References, Unmount, Chat), "Page ceilings", "The line retry", "The single sink and its check" (the check and `CheckedHighlightHtml`), "Export's longest wait" (what the ceilings bound); M4.H11, M4.H12, M4.H13 (main half), M4.H14, M4.H18 (store half).

**Files:**
- Create: `pwa/src/lib/highlightStore.ts`, `pwa/test/highlight-store.test.ts`, `pwa/test/highlight-html.test.tsx`.
- Guards (not edited): `pwa/test/markdownCorpus.ts` (read for M4.H14's corpus), `pwa/src/lib/markdownParse.ts`.

**Interfaces:**
- Consumes `HIGHLIGHT_NAME_SET`, `codeLanguage`, `highlightBlockCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `isRegisteredGrammar`, `longestWordRun`, `longestLine`, `longestBlankRun` (Task 2), `Highlighter`, `HighlightOutcome` (Task 2), the limits.
- Produces (exact text in Step 3): `CheckedHighlightHtml`, `checkHighlightHtml(html, steps?)`, `isCheckedHighlightHtml(v)`, `BlockKey`, `blockKey(lang, raw, part1?)`, `CodeBlockText`, `codeBlocksOf(tree)`, `PlainCause`, `RetryOutcome`, `SkipCeiling`, `HighlightEntry`, `UNREQUESTED_ENTRY`, `HighlightClock`, `HighlightStoreOptions`, `HighlightStore`, `createHighlightStore(highlighter, options, clock)`.

**Decisions this task makes:** (1) Keys are `${lang}\0${raw}`; `lang` is the code element's language as written (lower-cased by `codeLanguage`), so `ts` and `typescript` are two keys for one grammar, as today's C7 cache keyed them. (2) `blockKey`'s order is BASE's label order: unregistered, then the 64 KiB cap, then (part 1) the grammar cap, the word, the line, the blank run. (3) The receipt order is length, structure, page sum (refinement (e)). (4) The latch: the first ceiling that fires names every skip that follows; a ceiling's skips are written before any later request can run, because the store is synchronous. (5) A job detached by a release returns its key to `unrequested`; a job detached by a ceiling makes its key `skipped` (a first attempt) or `plain` under its first failure with the retry `refused` (a retry). (6) A request on a highlighter that is not `live` is `plain` at once (refinement (g)); its cause is `worker-unavailable`, or `worker-failed` with the error `boot`. (7) Worker time is measured from the highlighter's `onPosted` to the answer, and a timer for what remains of `HIGHLIGHT_PAGE_WORKER_MS` runs while a job is posted, so the ceiling fires mid-job; when a job is detached its clock stops. (8) A mounted block shows its key (`show`) apart from requesting it, and a chat store's `settled()` reads both, so a block in its debounce window is not settled (refinement (r)); a Docs store's `settled()` reads its seeded keys.

- [ ] **Step 0:** `test -f pwa/src/lib/highlightNames.ts && test -f pwa/src/lib/highlightProtocol.ts && ! test -e pwa/src/lib/highlightStore.ts && git grep -q "export const CHAT_CORPUS" HEAD -- pwa/test/markdownCorpus.ts && echo T5-BASE-OK`. No shared file is edited.
- [ ] **Step 1: Write `pwa/test/highlight-html.test.tsx`:**
  ```ts
  // The main thread's check of the worker's HTML (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section
  // 4.10 "The single sink and its check", M4.H14). `checkHighlightHtml` accepts exactly `<span class="hljs-…">` with
  // highlight.js scope classes, `<span class="language-NAME">` for a registered name or alias, `</span>`, and text
  // whose `&` begins one of highlight.js's five entities, balanced; anything else is `null`. Linear: its step counter
  // (not a clock) grows in proportion to the input. Only the check makes a `CheckedHighlightHtml`. The sink's half (a
  // plain string at the code component renders plain) is appended by Task 6.
  import { describe, expect, it } from 'vitest';
  import { HLJS } from '../src/lib/highlightGrammars';
  import { HIGHLIGHT_NAME_SET, isRegisteredGrammar } from '../src/lib/highlightNames';
  import { checkHighlightHtml, codeBlocksOf, isCheckedHighlightHtml } from '../src/lib/highlightStore';
  import { parseMarkdown } from '../src/lib/markdownParse';
  import { CHAT_ALIAS_TAGS, CHAT_CORPUS, languageCases } from './markdownCorpus';

  const colour = (lang: string, code: string): string => HLJS.highlight(code, { language: lang, ignoreIllegals: true }).value;

  describe('M4.H14: what the check accepts', () => {
    it('the HTML highlight.js gives for every code block of M4.M1\'s corpus', () => {
      const cases = [...CHAT_CORPUS, ...languageCases([...HLJS.listLanguages(), ...CHAT_ALIAS_TAGS])];
      let seen = 0;
      for (const c of cases) {
        const parsed = parseMarkdown(c.text, 'chat');
        if (parsed.kind !== 'tree') continue;
        for (const b of codeBlocksOf(parsed.tree)) {
          if (!isRegisteredGrammar(b.lang)) continue;
          seen += 1;
          expect(checkHighlightHtml(colour(b.lang, b.raw)), `${c.name} ${b.lang}`).not.toBeNull();
        }
      }
      expect(seen).toBeGreaterThan(30);
    });

    it('a language-NAME wrapper for every registered name and alias, and the two real subLanguage shapes', () => {
      for (const n of HIGHLIGHT_NAME_SET) expect(checkHighlightHtml(`<span class="language-${n}">x</span>`), n).not.toBeNull();
      const md = colour('markdown', 'text <b>bold</b>');
      const docker = colour('dockerfile', 'RUN apt-get install -y a && echo "b"');
      expect(md).toContain('class="language-xml"');
      expect(docker).toContain('class="language-bash"');
      expect(checkHighlightHtml(md)).not.toBeNull();
      expect(checkHighlightHtml(docker)).not.toBeNull();
    });

    it('nested scope classes, the five entities and plain text', () => {
      const html = '<span class="hljs-title class_ inherited__">A</span> &amp; &lt; &gt; &quot; &#x27; <span class="hljs-meta"><span class="hljs-keyword">x</span></span>';
      expect(checkHighlightHtml(html)?.html).toBe(html);
      expect(checkHighlightHtml('')?.html).toBe('');
    });
  });

  describe('M4.H14: what the check refuses (each leaves the block plain)', () => {
    it.each([
      ['an img with onerror', '<img src=x onerror=alert(1)>'],
      ['an event attribute on a span', '<span onclick="x">a</span>'],
      ['a class without the hljs- prefix', '<span class="x">a</span>'],
      ['an unknown language name', '<span class="language-nope">a</span>'],
      ['a single-quoted class', "<span class='hljs-x'>a</span>"],
      ['an upper-case tag', '<SPAN class="hljs-x">a</SPAN>'],
      ['an upper-case class character', '<span class="hljs-X">a</span>'],
      ['an empty scope', '<span class="hljs-">a</span>'],
      ['a second attribute', '<span class="hljs-a" id="x">a</span>'],
      ['a link', '<a href="https://a.example">a</a>'],
      ['a named entity outside the five', 'a&nbsp;b'],
      ['a numeric entity', 'a&#60;b'],
      ['a bare <', 'a < b'],
      ['a bare >', 'a > b'],
      ['a raw double quote', 'say "x"'],
      ['a raw single quote', "it's"],
      ['an unclosed span', '<span class="hljs-x">a'],
      ['an extra </span>', 'a</span>'],
      ['a closer before its opener', '</span><span class="hljs-x">a'],
    ])('%s', (_name, html) => {
      expect(checkHighlightHtml(html)).toBeNull();
    });
  });

  describe('M4.H14: the check is one linear pass', () => {
    const steps = (html: string): number => {
      const s = { n: 0 };
      checkHighlightHtml(html, s);
      return s.n;
    };
    it.each([
      ['unterminated span openers', (n: number) => '<span class="hljs-'.repeat(n)],
      ['valid but never closed spans', (n: number) => '<span class="hljs-a">'.repeat(n)],
      ['plain text', (n: number) => 'a'.repeat(n * 20)],
      ['balanced spans', (n: number) => '<span class="hljs-a">b</span>'.repeat(n)],
    ])('%s: steps grow in proportion to the input (n against 2n)', (_name, make) => {
      const small = make(1 << 15);
      const big = make(1 << 16);
      expect(steps(small)).toBeLessThanOrEqual(2 * small.length);
      expect(steps(big)).toBeLessThanOrEqual(2.05 * steps(small) + 64);
      expect(big.length).toBeGreaterThan(1.9 * small.length);
    });
  });

  describe('only the check makes a CheckedHighlightHtml', () => {
    it('its answer is frozen and accepted; a look-alike, a string and null are not', () => {
      const checked = checkHighlightHtml('<span class="hljs-a">b</span>')!;
      expect(Object.isFrozen(checked)).toBe(true);
      expect(isCheckedHighlightHtml(checked)).toBe(true);
      expect(isCheckedHighlightHtml(Object.freeze({ html: checked.html }))).toBe(false);
      expect(isCheckedHighlightHtml(checked.html)).toBe(false);
      expect(isCheckedHighlightHtml(null)).toBe(false);
    });
  });
  ```
- [ ] **Step 2: Write `pwa/test/highlight-store.test.ts`:**
  ```ts
  // The highlight store (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section 4.10 "The store", "Page
  // ceilings", "The line retry"; M4.H11, M4.H12, M4.H13 main half, M4.H18 store half). A fake highlighter records
  // every request with its signal and `onPosted`, and answers on demand; a fake clock drives the worker-time ceiling.
  // The React side (`CodeBlock` on the store) is Task 6's and Task 7's.
  import { describe, expect, it } from 'vitest';
  import type { Root as HastRoot } from 'hast';
  import type { Highlighter, HighlighterStatus, HighlightOutcome, HighlightRequest } from '../src/lib/highlightProtocol';
  import {
    UNREQUESTED_ENTRY, blockKey, codeBlocksOf, createHighlightStore, type HighlightClock, type HighlightEntry,
    type HighlightStoreOptions,
  } from '../src/lib/highlightStore';
  import {
    DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS,
    DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS, HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_LINE_RETRY_UNITS,
    HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS,
    MD_HIGHLIGHT_MAX_BLANK_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS, MD_HIGHLIGHT_MAX_LINE_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS,
  } from '../src/lib/markdownLimits';

  interface Call {
    readonly req: HighlightRequest;
    readonly signal?: AbortSignal;
    readonly onPosted?: () => void;
    readonly resolve: (o: HighlightOutcome) => void;
    aborted: boolean;
    posted: boolean;
  }

  /** A highlighter that records each request and answers only when told. */
  class FakeHighlighter implements Highlighter {
    readonly calls: Call[] = [];
    state: HighlighterStatus = 'live';
    highlight(req: HighlightRequest, opts: { signal?: AbortSignal; onPosted?: () => void }): Promise<HighlightOutcome> {
      return new Promise((resolve, reject) => {
        const call: Call = { req, signal: opts.signal, onPosted: opts.onPosted, resolve, aborted: false, posted: false };
        this.calls.push(call);
        opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(opts.signal!.reason); }, { once: true });
      });
    }
    status(): HighlighterStatus { return this.state; }
    prewarm(): void {}
  }

  /** A clock whose timers fire only when the test advances it. */
  function fakeClock(): HighlightClock & { advance(ms: number): void } {
    let now = 0;
    let next = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      now: () => now,
      setTimer: (fn, ms) => { const h = next++; timers.set(h, { at: now + ms, fn }); return h; },
      clearTimer: (h) => { timers.delete(h as number); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          const due = [...timers].filter(([, t]) => t.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
          if (due === undefined) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].fn();
        }
        now = end;
      },
    };
  }

  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
  const HTML = (html: string, mode: 'block' | 'line' = 'block'): HighlightOutcome => ({ kind: 'html', html, mode });
  const TIMEOUT: HighlightOutcome = { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS };
  const OK = '<span class="hljs-keyword">x</span>';

  function setup(options: HighlightStoreOptions = { mode: 'docs' }) {
    const h = new FakeHighlighter();
    const clock = fakeClock();
    const store = createHighlightStore(h, options, clock);
    const key = (lang: string, raw: string): string => {
      const k = store.keyOf(lang, raw);
      if (k.kind !== 'key') throw new Error(`no key: ${JSON.stringify(k)}`);
      return k.key;
    };
    /** Posts call `i` once (its onPosted runs), as the highlighter does when the job reaches the worker. */
    const post = (i: number): void => {
      const call = h.calls[i]!;
      if (call.posted) return;
      call.posted = true;
      call.onPosted?.();
    };
    /** Posts call `i` if it was not, then answers it, then lets the store hear it. */
    const answer = async (i: number, o: HighlightOutcome): Promise<void> => {
      post(i);
      h.calls[i]!.resolve(o);
      await flush();
    };
    return { h, clock, store, key, post, answer };
  }

  /** `n` characters of python, distinct by `tag`, in lines under 100 characters, with no long word or blank run. */
  const py = (n: number, tag: string): string =>
    (tag + ' ' + 'x '.repeat(n)).replace(/(.{80})/g, '$1\n').slice(0, n);
  const kinds = (store: { peek(k: string): HighlightEntry }, keys: string[]): string[] => keys.map((k) => store.peek(k).kind);

  describe('M4.H11: a content-keyed store', () => {
    it('two blocks with equal (lang, raw) make one request; peek is synchronous and never requests', () => {
      const { h, store, key } = setup();
      const k = key('ts', 'const a = 1;');
      expect(store.peek(k)).toBe(UNREQUESTED_ENTRY);
      expect(h.calls).toHaveLength(0);
      store.request(k);
      store.request(k);
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]!.req).toEqual({ lang: 'ts', code: 'const a = 1;' });
      expect(store.peek(k).kind).toBe('pending');
    });

    it('a re-request of an answered key (a re-render, a Copy click) makes no request', async () => {
      const { h, store, key, answer } = setup();
      const k = key('ts', 'a');
      const release = store.request(k);
      await answer(0, HTML(OK));
      release();
      store.request(k)();
      store.request(k);
      expect(h.calls).toHaveLength(1);
      expect(store.peek(k).kind).toBe('html');
    });

    it('releasing one of two references keeps the job; releasing the last detaches it and the key is unrequested again', () => {
      const { h, store, key } = setup();
      const k = key('ts', 'a');
      const one = store.request(k);
      const two = store.request(k);
      one();
      one();
      expect(h.calls[0]!.aborted).toBe(false);
      two();
      expect(h.calls[0]!.aborted).toBe(true);
      expect(store.peek(k)).toBe(UNREQUESTED_ENTRY);
    });

    it('peek returns the same object until the entry changes; subscribe(key) returns the same function for a key', async () => {
      const { store, key, answer } = setup();
      const k = key('ts', 'a');
      expect(store.peek('never-seen')).toBe(store.peek('never-seen-either'));
      store.request(k);
      const pending = store.peek(k);
      expect(store.peek(k)).toBe(pending);
      await answer(0, HTML(OK));
      const html = store.peek(k);
      expect(html).not.toBe(pending);
      expect(store.peek(k)).toBe(html);
      expect(store.subscribe(k)).toBe(store.subscribe(k));
      expect(store.subscribe()).toBe(store.subscribe());
    });

    it('a listener on a key hears its change, and a store-wide listener hears every change', async () => {
      const { store, key, answer } = setup();
      const k = key('ts', 'a');
      const heard: string[] = [];
      store.subscribe(k)(() => heard.push('key'));
      store.subscribe()(() => heard.push('all'));
      store.request(k);
      await answer(0, HTML(OK));
      expect(heard).toEqual(['key', 'all', 'key', 'all']);
    });

    it('releaseAll detaches every outstanding job', () => {
      const { h, store, key } = setup();
      store.request(key('ts', 'a'));
      store.request(key('ts', 'b'));
      store.releaseAll();
      expect(h.calls.map((c) => c.aborted)).toEqual([true, true]);
    });

    it('a chat store evicts every key no block references after a commit', async () => {
      const { store, key, answer } = setup({ mode: 'chat' });
      const a = key('ts', 'a');
      const b = key('ts', 'b');
      const releaseA = store.request(a);
      store.request(b);
      await answer(0, HTML(OK));
      releaseA();
      store.evictUnreferenced();
      expect(store.peek(a)).toBe(UNREQUESTED_ENTRY);
      expect(store.peek(b).kind).toBe('pending');
    });

    it('keyOf: a key, or why the block can never be requested, in BASE\'s order; part 1\'s bounds only with part1', () => {
      expect(blockKey('ts', 'a')).toEqual({ kind: 'key', key: 'ts\u0000a' });
      expect(blockKey('nope', 'a')).toEqual({ kind: 'unregistered' });
      expect(blockKey('', 'a')).toEqual({ kind: 'unregistered' });
      const big = 'a\n'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
      expect(blockKey('python', big)).toEqual({ kind: 'over-cap', chars: big.length });
      const ts = 'a\n'.repeat(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
      expect(blockKey('ts', ts)).toEqual({ kind: 'part1', bound: 'grammar-cap', chars: ts.length });
      expect(blockKey('ts', ts, false).kind).toBe('key');
      const word = 'a'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1);
      expect(blockKey('python', word)).toEqual({ kind: 'part1', bound: 'word', chars: word.length });
      const line = 'a '.repeat(MD_HIGHLIGHT_MAX_LINE_CHARS);
      expect(blockKey('python', line)).toEqual({ kind: 'part1', bound: 'line', chars: line.length });
      const blank = `a${'\n'.repeat(MD_HIGHLIGHT_MAX_BLANK_CHARS + 1)}b`;
      expect(blockKey('python', blank)).toEqual({ kind: 'part1', bound: 'blank', chars: MD_HIGHLIGHT_MAX_BLANK_CHARS + 1 });
      expect(blockKey('python', blank, false).kind).toBe('key');
    });
  });

  describe('M4.H12: page ceilings and settled()', () => {
    it('the input ceiling skips at seed, in document order, a shared key counted once', () => {
      const { store, key } = setup();
      const blocks = Array.from({ length: 9 }, (_, i) => ({ lang: 'python', raw: py(60000, `b${i}`) }));
      expect(8 * 60000).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
      store.seed([...blocks.slice(0, 2), blocks[0]!, ...blocks.slice(2)]);
      const keys = blocks.map((b) => key(b.lang, b.raw));
      expect(kinds(store, keys)).toEqual([...Array(8).fill('unrequested'), 'skipped']);
      expect(store.peek(keys[8]!)).toEqual({ kind: 'skipped', ceiling: 'page-input' });
    });

    it('the output ceiling: the answer that would pass the page HTML cap is skipped, and every later request', async () => {
      const { store, key, answer } = setup();
      const big = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / big.length);
      const raws = Array.from({ length: fit + 2 }, (_, i) => `b${i}`);
      store.seed(raws.map((raw) => ({ lang: 'python', raw })));
      const ks = raws.map((r) => key('python', r));
      for (const k of ks) store.request(k);
      for (let i = 0; i <= fit; i += 1) await answer(i, HTML(big));
      expect(kinds(store, ks)).toEqual([...Array(fit).fill('html'), 'skipped', 'skipped']);
      expect(store.peek(ks[fit]!)).toEqual({ kind: 'skipped', ceiling: 'page-output' });
    });

    it('the timeout ceiling: at HIGHLIGHT_PAGE_MAX_TIMEOUTS timeouts every unanswered key is skipped, the running job detached', async () => {
      const { h, store, key, answer } = setup();
      const ks = ['a', 'b', 'c', 'd'].map((s) => key('python', s));
      store.seed(['a', 'b', 'c', 'd'].map((raw) => ({ lang: 'python', raw })));
      for (const k of ks) store.request(k);
      for (let i = 0; i < HIGHLIGHT_PAGE_MAX_TIMEOUTS; i += 1) await answer(i, TIMEOUT);
      expect(store.peek(ks[0]!)).toEqual({ kind: 'plain', first: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, retry: null });
      expect(kinds(store, ks.slice(HIGHLIGHT_PAGE_MAX_TIMEOUTS))).toEqual(['skipped', 'skipped']);
      expect(store.peek(ks[3]!)).toEqual({ kind: 'skipped', ceiling: 'page-timeouts' });
      expect(h.calls.slice(HIGHLIGHT_PAGE_MAX_TIMEOUTS).every((c) => c.aborted)).toBe(true);
      expect(store.settled()).toBe(true);
    });

    it('the worker-time ceiling fires mid-job: the running job is detached and the rest skipped', async () => {
      const { h, clock, store, key, post, answer } = setup();
      const ks = ['a', 'b', 'c'].map((s) => key('python', s));
      store.seed(['a', 'b', 'c'].map((raw) => ({ lang: 'python', raw })));
      for (const k of ks) store.request(k);
      post(0);
      clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 1);
      await answer(0, HTML(OK));
      post(1);
      clock.advance(1);
      await flush();
      expect(h.calls[1]!.aborted).toBe(true);
      expect(kinds(store, ks)).toEqual(['html', 'skipped', 'skipped']);
      expect(store.peek(ks[1]!)).toEqual({ kind: 'skipped', ceiling: 'page-worker-time' });
    });

    it('a detached job\'s timeout counts against no ceiling', async () => {
      const { h, store, key, answer } = setup({ mode: 'chat' });
      const release = store.request(key('python', 'a'));
      release();
      h.calls[0]!.resolve(TIMEOUT);
      await flush();
      for (const s of ['b', 'c']) store.request(key('python', s));
      await answer(1, TIMEOUT);
      expect(h.calls).toHaveLength(3);
      expect(h.calls[2]!.aborted).toBe(false);
      expect(store.peek(key('python', 'c')).kind).toBe('pending');
    });

    it('settled(): false while a seeded key is unanswered, from creation; true once every one is html, plain or skipped', async () => {
      const { store, key, answer } = setup();
      store.seed([{ lang: 'python', raw: 'a' }, { lang: 'python', raw: 'b' }]);
      expect(store.settled()).toBe(false);
      store.request(key('python', 'a'));
      store.request(key('python', 'b'));
      await answer(0, HTML(OK));
      expect(store.settled()).toBe(false);
      await answer(1, { kind: 'threw', error: 'Error' });
      expect(store.settled()).toBe(true);
    });

    it('a Docs store seeded with nothing is settled; a chat store is settled when no referenced key is waiting', async () => {
      expect(setup().store.settled()).toBe(true);
      const { store, key, answer } = setup({ mode: 'chat' });
      store.request(key('python', 'a'));
      expect(store.settled()).toBe(false);
      await answer(0, HTML(OK));
      expect(store.settled()).toBe(true);
    });

    it('a chat store applies neither page cap: no input skip at any size, no output skip', async () => {
      const { store, key, answer } = setup({ mode: 'chat' });
      const huge = `<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
      const ks = Array.from({ length: Math.ceil(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / huge.length) + 1 }, (_, i) => key('python', `k${i}`));
      for (const [i, k] of ks.entries()) { store.request(k); await answer(i, HTML(huge)); }
      expect(kinds(store, ks).every((s) => s === 'html')).toBe(true);
    });

    it('part 1\'s scan page budget skips at seed with its own ceiling, and only its grammars; part1 off, never', () => {
      const { store, key } = setup();
      const n = Math.floor(DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
      const ts = Array.from({ length: n + 1 }, (_, i) => ({ lang: 'ts', raw: py(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, `t${i}`) }));
      const json = { lang: 'json', raw: py(1000, 'j') };
      store.seed([...ts, json]);
      expect(store.peek(key('ts', ts[n]!.raw))).toEqual({ kind: 'skipped', ceiling: 'part1-scan' });
      expect(store.peek(key('ts', ts[n - 1]!.raw)).kind).toBe('unrequested');
      expect(store.peek(key('json', json.raw)).kind).toBe('unrequested');
      const off = setup({ mode: 'docs', part1: false }).store;
      off.seed(ts);
      expect(off.peek(`ts\u0000${ts[n]!.raw}`).kind).toBe('unrequested');
    });

    it('part 1\'s markdown page budget skips at seed with its own ceiling, and only markdown', () => {
      const { store, key } = setup();
      const md = Array.from({ length: 3 }, (_, i) => ({ lang: i === 1 ? 'md' : 'markdown', raw: py(DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS / 2, `m${i}`) }));
      const yaml = { lang: 'yaml', raw: py(1000, 'y') };
      store.seed([...md, yaml]);
      expect(kinds(store, md.map((b) => key(b.lang, b.raw)))).toEqual(['unrequested', 'unrequested', 'skipped']);
      expect(store.peek(key('markdown', md[2]!.raw))).toEqual({ kind: 'skipped', ceiling: 'part1-markdown' });
      expect(store.peek(key('yaml', yaml.raw)).kind).toBe('unrequested');
    });

    it('a chat store is not settled while a shown key waits for its request (the debounce window)', async () => {
      const { store, key, answer } = setup({ mode: 'chat' });
      const k = key('python', 'a');
      const unshow = store.show(k);
      expect(store.settled()).toBe(false);
      store.request(k);
      expect(store.settled()).toBe(false);
      await answer(0, HTML(OK));
      expect(store.settled()).toBe(true);
      unshow();
      expect(store.settled()).toBe(true);
    });

    it('with ceilings off nothing is skipped, at seed or live (R19\'s store)', async () => {
      const { store, key, answer } = setup({ mode: 'docs', ceilings: false });
      const blocks = Array.from({ length: 10 }, (_, i) => ({ lang: 'python', raw: py(60000, `c${i}`) }));
      store.seed(blocks);
      const ks = blocks.map((b) => key(b.lang, b.raw));
      expect(kinds(store, ks).every((s) => s === 'unrequested')).toBe(true);
      for (const k of ks) store.request(k);
      for (let i = 0; i < 4; i += 1) await answer(i, TIMEOUT);
      expect(kinds(store, ks.slice(4)).every((s) => s === 'pending')).toBe(true);
    });
  });

  describe('M4.H13 (main half) and M4.H18 (store half): the receipt re-check and the line retry', () => {
    const long = 'a\n'.repeat(HIGHLIGHT_LINE_RETRY_UNITS);

    it('an answer over MD_HIGHLIGHT_MAX_HTML_CHARS is too-large on receipt, and a long block is retried in line mode, pending meanwhile', async () => {
      const { h, store, key, answer } = setup();
      const k = key('python', long);
      store.seed([{ lang: 'python', raw: long }]);
      store.request(k);
      await answer(0, HTML(`<span class="hljs-a">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS)}</span>`));
      expect(h.calls[1]!.req).toEqual({ lang: 'python', code: long, mode: 'line' });
      expect(store.peek(k).kind).toBe('pending');
      expect(store.settled()).toBe(false);
      await answer(1, HTML(OK, 'line'));
      expect(store.peek(k)).toMatchObject({ kind: 'html', mode: 'line' });
    });

    it('a block of exactly the unit gets no retry and stays plain under its first failure; one unit more is retried', async () => {
      const at = 'a '.repeat(HIGHLIGHT_LINE_RETRY_UNITS / 2);
      const { h, store, key, answer } = setup({ mode: 'chat', ceilings: false });
      store.request(key('python', at));
      await answer(0, TIMEOUT);
      expect(h.calls).toHaveLength(1);
      expect(store.peek(key('python', at))).toEqual({ kind: 'plain', first: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }, retry: null });
      store.request(key('python', `${at}b`));
      await answer(1, TIMEOUT);
      expect(h.calls[2]!.req.mode).toBe('line');
    });

    it('a retry that fails differently leaves the block plain under its first failure, the retry\'s outcome recorded', async () => {
      const { store, key, answer } = setup({ mode: 'chat', ceilings: false });
      const k = key('python', long);
      store.request(k);
      await answer(0, { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 });
      await answer(1, TIMEOUT);
      expect(store.peek(k)).toEqual({ kind: 'plain', first: { kind: 'too-large' }, retry: { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS } });
    });

    it('a retry the ceilings refuse leaves the block plain under its first failure, never skipped', async () => {
      const { store, key, answer } = setup({ mode: 'chat' });
      const ks = Array.from({ length: HIGHLIGHT_PAGE_MAX_TIMEOUTS }, (_, i) => key('python', `${long}${i}`));
      for (const k of ks) store.request(k);
      for (let i = 0; i < ks.length; i += 1) await answer(i, TIMEOUT);
      for (const k of ks) expect(store.peek(k)).toMatchObject({ kind: 'plain', first: { kind: 'timeout' } });
      expect(store.peek(ks[ks.length - 1]!)).toMatchObject({ retry: { kind: 'refused' } });
    });

    it('threw and unregistered get no retry; a block coloured whole is never sent in line mode', async () => {
      const { h, store, key, answer } = setup({ mode: 'chat' });
      store.request(key('python', `${long}x`));
      await answer(0, { kind: 'threw', error: 'Error' });
      store.request(key('python', `${long}y`));
      await answer(1, { kind: 'unregistered' });
      store.request(key('python', `${long}z`));
      await answer(2, HTML(OK));
      expect(h.calls.map((c) => c.req.mode ?? 'block')).toEqual(['block', 'block', 'block']);
    });

    it('the retry counts against the page ceilings: its timeout is counted', async () => {
      const { store, key, answer } = setup({ mode: 'chat' });
      const k = key('python', long);
      const other = key('python', 'other');
      store.request(k);
      store.request(other);
      await answer(0, TIMEOUT);
      await answer(2, TIMEOUT);
      expect(store.peek(other)).toEqual({ kind: 'skipped', ceiling: 'page-timeouts' });
    });
  });

  describe('refinement (g): no worker, no fallback', () => {
    it.each<[HighlighterStatus, unknown]>([
      ['worker-unavailable', { kind: 'worker-unavailable' }],
      ['worker-failed', { kind: 'worker-failed', error: 'boot' }],
    ])('a highlighter that is %s: the block is plain at once with that cause, nothing queued', (state, cause) => {
      const { h, store, key } = setup({ mode: 'chat' });
      h.state = state;
      const k = key('python', 'a');
      store.request(k);
      expect(h.calls).toHaveLength(0);
      expect(store.peek(k)).toEqual({ kind: 'plain', first: cause, retry: null });
    });
  });

  describe('codeBlocksOf: the seeding walk', () => {
    it('walks pre elements in document order: the code class\'s language, and the text with one trailing newline stripped', () => {
      const code = (cls: string[] | undefined, text: string) => ({
        type: 'element', tagName: 'pre', properties: {},
        children: [{ type: 'element', tagName: 'code', properties: cls === undefined ? {} : { className: cls }, children: [{ type: 'text', value: text }] }],
      });
      const tree = { type: 'root', children: [
        code(['language-TS'], 'a\n\n'),
        { type: 'element', tagName: 'blockquote', properties: {}, children: [code(['x', 'language-md', 'language-ts'], 'b')] },
        code(undefined, 'c\n'),
      ] } as unknown as HastRoot;
      expect(codeBlocksOf(tree)).toEqual([{ lang: 'ts', raw: 'a\n' }, { lang: 'md', raw: 'b' }, { lang: '', raw: 'c' }]);
    });
  });
  ```
- [ ] **Step 3: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-html.test.tsx test/highlight-store.test.ts )` — Expected: both files fail to import (the module is absent): 2 failed files.
- [ ] **Step 4: Implement `pwa/src/lib/highlightStore.ts`:**
  ```ts
  // The highlight store and the main thread's check (native Docs reader, W5h-a Task 5; base spec 2026-10-01 section
  // 4.10 "The store", "Page ceilings", "The line retry", "The single sink and its check"). One store per Docs page,
  // text leaf, chat message or tool well, keyed by content, `${lang}\0${raw}`, so identical blocks share one entry and
  // one job.
  //   - `blockKey(lang, raw, part1)` is the ONE function that answers a key, or why the block can never be requested:
  //     no registered grammar, over MD_HIGHLIGHT_BLOCK_MAX_CHARS, or (until W5h-b, `part1` true) one of W5 part 1's
  //     per-block bounds. `store.keyOf` applies it with the store's own `part1`; `CodeBlock` and the seeding walk both
  //     ask it, so they never disagree.
  //   - `seed(blocks)`, a Docs page's or a text leaf's, once, at creation: every requestable block, in document order,
  //     a key that several blocks share counted once; the input ceiling and (until W5h-b) part 1's scan and markdown
  //     page budgets apply here, so a key past one is `skipped` from the first commit, whatever order effects run in.
  //   - `peek(key)` is synchronous and never requests; it returns the same entry object until that entry changes, and
  //     one shared frozen `unrequested` entry for a key it has not seen (useSyncExternalStore's contract).
  //   - `request(key)` adds a reference and asks the highlighter once per key; its release drops the reference, and
  //     the last release detaches the key's job (the highlighter's `'detach'`: the worker lives on).
  //   - `subscribe(key)` returns the same function for the same key; `subscribe()` is store-wide.
  //   - `settled()`: a Docs store when every seeded key is `html`, `plain` or `skipped`; a chat store when no key a
  //     mounted block references is `unrequested` or `pending`, a block referencing the key it shows (`show`) as well as
  //     the key it requested, so a block in chat's debounce window, showing a key it has not requested yet, is waiting.
  //   - On receipt, in this order (the W5h-a plan's refinement (e)): an answer longer than MD_HIGHLIGHT_MAX_HTML_CHARS
  //     is `too-large`; one the check refuses is `malformed`; on a Docs store, one that would take the page's HTML past
  //     DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS is `skipped` by that ceiling. Only `checkHighlightHtml` makes a
  //     `CheckedHighlightHtml`, a frozen `{html}` this module records in a private WeakSet; the sink inserts only a
  //     value `isCheckedHighlightHtml` accepts.
  //   - A first answer of `timeout` or `too-large` on a block longer than HIGHLIGHT_LINE_RETRY_UNITS is retried once,
  //     line by line, while the ceilings admit it; the entry stays `pending` meanwhile, and a failed or refused retry
  //     leaves it `plain` under its first failure.
  //   - Page ceilings (option `ceilings`, on by default): a Docs store counts input (at seed), HTML received, timeouts and
  //     worker time; a chat store the last two. Past a live one the store latches: every request not yet answered, and
  //     every later one, is `skipped` by it, and its running job is detached. Worker time runs from the highlighter's
  //     `onPosted` to the answer, live, so the ceiling can fire mid-job.
  //   - A highlighter whose status is not `live` makes a request `plain` at once (refinement (g)): no main-thread
  //     fallback.
  //
  // Ring L1: pure. Its clock and its highlighter are arguments (`highlighterContext.ts` supplies the real ones); it holds
  // no timer global, makes no I/O and posts nothing.
  import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
  import {
    HIGHLIGHT_NAME_SET, codeLanguage, highlightBlockCap, inMarkdownPageBudget, inScanPageBudget, isRegisteredGrammar,
    longestBlankRun, longestLine, longestWordRun,
  } from './highlightNames';
  import type { Highlighter, HighlightOutcome } from './highlightProtocol';
  import {
    DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS,
    DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS, HIGHLIGHT_LINE_RETRY_UNITS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS,
    HIGHLIGHT_STREAM_DEBOUNCE_MS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_BLANK_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
    MD_HIGHLIGHT_MAX_LINE_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS,
  } from './markdownLimits';

  // ---- The check ----

  /** HTML the check accepted. Only `checkHighlightHtml` makes one; `isCheckedHighlightHtml` recognises it. */
  export interface CheckedHighlightHtml {
    readonly html: string;
  }

  const CHECKED = new WeakSet<object>();
  const ENTITIES: readonly string[] = ['&amp;', '&lt;', '&gt;', '&quot;', '&#x27;'];
  const OPEN = '<span class="';
  const CLOSE = '</span>';
  const HLJS_PREFIX = 'hljs-';
  const LANGUAGE_PREFIX = 'language-';

  /** A class the check accepts: `hljs-` then one or more of `[a-z0-9_ -]`, or `language-NAME` for a registered name or
   *  alias. */
  function acceptedClass(cls: string): boolean {
    if (cls.startsWith(HLJS_PREFIX)) {
      if (cls.length === HLJS_PREFIX.length) return false;
      for (let k = HLJS_PREFIX.length; k < cls.length; k += 1) {
        const c = cls.charCodeAt(k);
        if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x20 || c === 0x2d)) return false;
      }
      return true;
    }
    return cls.startsWith(LANGUAGE_PREFIX) && HIGHLIGHT_NAME_SET.has(cls.slice(LANGUAGE_PREFIX.length));
  }

  /** The worker's HTML, checked: one linear pass that accepts exactly `<span class="…">` with an accepted class,
   *  `</span>`, and text holding no `<`, `>`, `"` or `'`, each `&` beginning one of the five entities, the spans
   *  balanced; `null` for anything else. `steps`, when given, counts the units the pass reads (M4.H14's linearity). */
  export function checkHighlightHtml(html: string, steps?: { n: number }): CheckedHighlightHtml | null {
    let depth = 0;
    let i = 0;
    while (i < html.length) {
      if (steps !== undefined) steps.n += 1;
      const c = html.charCodeAt(i);
      if (c === 0x3c) {
        if (html.startsWith(CLOSE, i)) {
          depth -= 1;
          if (depth < 0) return null;
          i += CLOSE.length;
          continue;
        }
        if (!html.startsWith(OPEN, i)) return null;
        const start = i + OPEN.length;
        const end = html.indexOf('"', start);
        if (end === -1 || html.charCodeAt(end + 1) !== 0x3e) return null;
        if (steps !== undefined) steps.n += end - start;
        if (!acceptedClass(html.slice(start, end))) return null;
        depth += 1;
        i = end + 2;
        continue;
      }
      if (c === 0x3e || c === 0x22 || c === 0x27) return null;
      if (c === 0x26) {
        const entity = ENTITIES.find((e) => html.startsWith(e, i));
        if (entity === undefined) return null;
        i += entity.length;
        continue;
      }
      i += 1;
    }
    if (depth !== 0) return null;
    const checked: CheckedHighlightHtml = Object.freeze({ html });
    CHECKED.add(checked);
    return checked;
  }

  /** Whether `v` is a value `checkHighlightHtml` made (by identity, not by shape). */
  export function isCheckedHighlightHtml(v: unknown): v is CheckedHighlightHtml {
    return typeof v === 'object' && v !== null && CHECKED.has(v);
  }

  // ---- Keys and the seeding walk ----

  /** A block's key, or why it can never be requested. */
  export type BlockKey =
    | { readonly kind: 'key'; readonly key: string }
    | { readonly kind: 'unregistered' }
    | { readonly kind: 'over-cap'; readonly chars: number }
    /** Until W5h-b: one of W5 part 1's per-block bounds, with the figure its label reads. */
    | { readonly kind: 'part1'; readonly bound: 'grammar-cap' | 'word' | 'line' | 'blank'; readonly chars: number };

  /** THE key function (section 4.10 "Keys"). `part1` (until W5h-b) applies W5 part 1's per-block bounds, in BASE's
   *  label order: the grammar cap, the word, the line, the blank run. */
  export function blockKey(lang: string, raw: string, part1 = true): BlockKey {
    if (!isRegisteredGrammar(lang)) return { kind: 'unregistered' };
    if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };
    if (part1) {
      if (raw.length > highlightBlockCap(lang)) return { kind: 'part1', bound: 'grammar-cap', chars: raw.length };
      const word = longestWordRun(raw);
      if (word > MD_HIGHLIGHT_MAX_WORD_CHARS) return { kind: 'part1', bound: 'word', chars: word };
      const line = longestLine(raw);
      if (line > MD_HIGHLIGHT_MAX_LINE_CHARS) return { kind: 'part1', bound: 'line', chars: line };
      const blank = longestBlankRun(raw);
      if (blank > MD_HIGHLIGHT_MAX_BLANK_CHARS) return { kind: 'part1', bound: 'blank', chars: blank };
    }
    return { kind: 'key', key: `${lang}\u0000${raw}` };
  }

  /** One code block as `CodeBlock` reads it: its language and its text with one trailing newline stripped. */
  export interface CodeBlockText {
    readonly lang: string;
    readonly raw: string;
  }

  /** Every text node under `node`, in document order (what `CodeBlock`'s `nodeText` flattens). Iterative. */
  function textOf(node: HastElement): string {
    let out = '';
    const stack: RootContent[] = [...node.children].reverse();
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.type === 'text') out += n.value;
      else if (n.type === 'element') for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
    }
    return out;
  }

  /** The class of `pre`'s first `code` child as `CodeBlock` reads it: hast's array joined with a space; `''` for none. */
  function preCodeClass(pre: HastElement): string {
    const code = pre.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'code');
    const cls = code?.properties.className;
    return Array.isArray(cls) ? cls.map((v) => String(v)).join(' ') : typeof cls === 'string' ? cls : '';
  }

  /** The seeding walk (section 4.10 "Seeding"): every `pre` of a parsed tree, in document order, iteratively. */
  export function codeBlocksOf(tree: HastRoot): CodeBlockText[] {
    const out: CodeBlockText[] = [];
    const stack: RootContent[] = [...tree.children].reverse();
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.type !== 'element') continue;
      if (n.tagName === 'pre') {
        out.push({ lang: codeLanguage(preCodeClass(n)), raw: textOf(n).replace(/\n$/, '') });
        continue;
      }
      for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
    }
    return out;
  }

  // ---- Entries ----

  /** Why a block is plain after a request (Export's provenance reads the first). */
  export type PlainCause =
    | { readonly kind: 'timeout'; readonly budgetMs: number }
    | { readonly kind: 'too-large' }
    | { readonly kind: 'line-too-long' }
    | { readonly kind: 'unregistered' }
    | { readonly kind: 'threw'; readonly error: string }
    | { readonly kind: 'malformed' }
    | { readonly kind: 'worker-failed'; readonly error: string }
    | { readonly kind: 'worker-unavailable' };

  /** What became of a line retry: its own failure, or `refused` (a ceiling closed before or while it ran). */
  export type RetryOutcome = PlainCause | { readonly kind: 'refused' };

  /** Which ceiling skipped a block: one of the four page ceilings, or (until W5h-b) one of part 1's page budgets. */
  export type SkipCeiling = 'page-input' | 'page-output' | 'page-timeouts' | 'page-worker-time' | 'part1-scan' | 'part1-markdown';

  /** One key's state. `unrequested` and `pending` are two words with two meanings, never folded. */
  export type HighlightEntry =
    | { readonly kind: 'unrequested' }
    | { readonly kind: 'pending' }
    | { readonly kind: 'html'; readonly mode: 'block' | 'line'; readonly checked: CheckedHighlightHtml }
    | { readonly kind: 'plain'; readonly first: PlainCause; readonly retry: RetryOutcome | null }
    | { readonly kind: 'skipped'; readonly ceiling: SkipCeiling };

  /** The one entry `peek` answers for a key the store has not seen. */
  export const UNREQUESTED_ENTRY: HighlightEntry = Object.freeze({ kind: 'unrequested' } as const);
  const PENDING: HighlightEntry = Object.freeze({ kind: 'pending' } as const);
  const REFUSED: RetryOutcome = Object.freeze({ kind: 'refused' } as const);

  /** A failure outcome as the entry records it. */
  function causeOf(o: Exclude<HighlightOutcome, { kind: 'html' }>): PlainCause {
    switch (o.kind) {
      case 'timeout': return { kind: 'timeout', budgetMs: o.budgetMs };
      case 'too-large': return { kind: 'too-large' };
      case 'line-too-long': return { kind: 'line-too-long' };
      case 'unregistered': return { kind: 'unregistered' };
      case 'threw': return { kind: 'threw', error: o.error };
      case 'worker-failed': return { kind: 'worker-failed', error: o.error };
      case 'worker-unavailable': return { kind: 'worker-unavailable' };
    }
  }

  // ---- The store ----

  /** The store's clock: `highlighterContext.ts` hands in the real one, a test a fake. */
  export interface HighlightClock {
    now(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
  }

  /** `mode` is the store's owner kind. The other three exist for R19's page (refinement (k)): production passes
   *  `{ mode }` alone, so part 1's bounds and the ceilings are on and the debounce is chat's constant (Docs: none). */
  export interface HighlightStoreOptions {
    readonly mode: 'docs' | 'chat';
    readonly part1?: boolean;
    readonly ceilings?: boolean;
    readonly debounceMs?: number;
  }

  export interface HighlightStore {
    readonly mode: 'docs' | 'chat';
    /** How long a mounted block whose text changed waits before it requests its new key (chat only). */
    readonly debounceMs: number;
    keyOf(lang: string, raw: string): BlockKey;
    seed(blocks: readonly CodeBlockText[]): void;
    peek(key: string): HighlightEntry;
    request(key: string): () => void;
    /** A mounted block shows `key` (from its first commit, before any debounced request); the release ends that. A
     *  chat store's `settled()` reads shown keys as well as requested ones (refinement (r)). */
    show(key: string): () => void;
    subscribe(key?: string): (listener: () => void) => () => void;
    settled(): boolean;
    evictUnreferenced(): void;
    releaseAll(): void;
  }

  export function createHighlightStore(
    highlighter: Highlighter, options: HighlightStoreOptions, clock: HighlightClock,
  ): HighlightStore {
    const docs = options.mode === 'docs';
    const part1 = options.part1 ?? true;
    const ceilingsOn = options.ceilings ?? true;
    const debounceMs = options.debounceMs ?? (docs ? 0 : HIGHLIGHT_STREAM_DEBOUNCE_MS);

    interface Job {
      readonly key: string;
      /** The first attempt's failure, for a retry; null for a first attempt. */
      readonly first: PlainCause | null;
      readonly controller: AbortController;
    }

    const entries = new Map<string, HighlightEntry>();
    const refs = new Map<string, number>();
    const shownKeys = new Map<string, number>();
    const seeded = new Set<string>();
    const jobs = new Map<string, Job>();
    const listeners = new Map<string, Set<() => void>>();
    const subscribers = new Map<string, (listener: () => void) => () => void>();
    const everyone = new Set<() => void>();
    let storeWide: ((listener: () => void) => () => void) | undefined;
    let outputChars = 0;
    let timeouts = 0;
    let spent = 0;
    let closed: SkipCeiling | null = null;
    let posted: { readonly job: Job; readonly at: number; readonly timer: unknown } | null = null;

    const peek = (key: string): HighlightEntry => entries.get(key) ?? UNREQUESTED_ENTRY;

    function set(key: string, entry: HighlightEntry): void {
      entries.set(key, entry);
      for (const l of [...(listeners.get(key) ?? [])]) l();
      for (const l of [...everyone]) l();
    }

    /** Stops `job`'s worker-time clock, when it is the posted job, adding what it ran. */
    function stopClock(job: Job): void {
      if (posted === null || posted.job !== job) return;
      spent += clock.now() - posted.at;
      clock.clearTimer(posted.timer);
      posted = null;
    }

    /** `job` was posted: its worker time starts, and the worker-time ceiling's timer runs for what is left. */
    function onPosted(job: Job): void {
      if (jobs.get(job.key) !== job) return;
      const timer = ceilingsOn
        ? clock.setTimer(() => {
          if (posted?.job !== job) return;
          spent = HIGHLIGHT_PAGE_WORKER_MS;
          posted = null;
          close('page-worker-time');
        }, Math.max(0, HIGHLIGHT_PAGE_WORKER_MS - spent))
        : undefined;
      posted = { job, at: clock.now(), timer };
    }

    /** Detaches `job`: its answer will reach nobody; the worker lives on. */
    function detach(job: Job): void {
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      stopClock(job);
      job.controller.abort();
    }

    /** Latches the first live ceiling: every key not yet answered, and every later request, is skipped by it; a running
     *  retry becomes plain under its first failure. */
    function close(ceiling: SkipCeiling): void {
      if (closed !== null) return;
      closed = ceiling;
      for (const job of [...jobs.values()]) {
        detach(job);
        set(job.key, job.first === null ? { kind: 'skipped', ceiling } : { kind: 'plain', first: job.first, retry: REFUSED });
      }
      for (const key of [...seeded, ...refs.keys()]) if (peek(key).kind === 'unrequested') set(key, { kind: 'skipped', ceiling });
    }

    function checkCeilings(): void {
      if (!ceilingsOn) return;
      if (timeouts >= HIGHLIGHT_PAGE_MAX_TIMEOUTS) close('page-timeouts');
      else if (spent >= HIGHLIGHT_PAGE_WORKER_MS) close('page-worker-time');
    }

    function start(key: string, mode: 'block' | 'line', first: PlainCause | null): void {
      if (ceilingsOn && closed !== null) {
        set(key, first === null ? { kind: 'skipped', ceiling: closed } : { kind: 'plain', first, retry: REFUSED });
        return;
      }
      const status = highlighter.status();
      if (status !== 'live') {
        const cause: PlainCause = status === 'worker-unavailable' ? { kind: 'worker-unavailable' } : { kind: 'worker-failed', error: 'boot' };
        set(key, first === null ? { kind: 'plain', first: cause, retry: null } : { kind: 'plain', first, retry: cause });
        return;
      }
      const sep = key.indexOf('\u0000');
      const lang = key.slice(0, sep);
      const code = key.slice(sep + 1);
      const job: Job = { key, first, controller: new AbortController() };
      jobs.set(key, job);
      if (first === null) set(key, PENDING);
      highlighter.highlight(
        mode === 'line' ? { lang, code, mode } : { lang, code },
        { signal: job.controller.signal, onPosted: () => onPosted(job) },
      ).then((o) => answered(job, o), () => undefined);
    }

    function answered(job: Job, o: HighlightOutcome): void {
      if (jobs.get(job.key) !== job) return;
      jobs.delete(job.key);
      stopClock(job);
      const key = job.key;
      if (o.kind === 'timeout') timeouts += 1;
      let failure: PlainCause;
      if (o.kind !== 'html') {
        failure = causeOf(o);
      } else if (o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {
        failure = { kind: 'too-large' };
      } else {
        const checked = checkHighlightHtml(o.html);
        if (checked === null) {
          failure = { kind: 'malformed' };
        } else if (docs && ceilingsOn && outputChars + o.html.length > DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS) {
          set(key, job.first === null ? { kind: 'skipped', ceiling: 'page-output' } : { kind: 'plain', first: job.first, retry: REFUSED });
          close('page-output');
          return;
        } else {
          outputChars += o.html.length;
          set(key, { kind: 'html', mode: o.mode, checked });
          checkCeilings();
          return;
        }
      }
      checkCeilings();
      const rawLength = key.length - key.indexOf('\u0000') - 1;
      if (job.first === null && (failure.kind === 'timeout' || failure.kind === 'too-large') && rawLength > HIGHLIGHT_LINE_RETRY_UNITS) {
        start(key, 'line', failure);
        return;
      }
      set(key, job.first === null ? { kind: 'plain', first: failure, retry: null } : { kind: 'plain', first: job.first, retry: failure });
    }

    function seed(blocks: readonly CodeBlockText[]): void {
      let input = 0;
      let scan = 0;
      let markdown = 0;
      for (const b of blocks) {
        const k = blockKey(b.lang, b.raw, part1);
        if (k.kind !== 'key' || seeded.has(k.key)) continue;
        seeded.add(k.key);
        const inScan = part1 && inScanPageBudget(b.lang);
        const inMarkdown = part1 && inMarkdownPageBudget(b.lang);
        input += b.raw.length;
        if (inScan) scan += b.raw.length;
        if (inMarkdown) markdown += b.raw.length;
        if (ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS) entries.set(k.key, { kind: 'skipped', ceiling: 'page-input' });
        else if (inScan && scan > DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS) entries.set(k.key, { kind: 'skipped', ceiling: 'part1-scan' });
        else if (inMarkdown && markdown > DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS) entries.set(k.key, { kind: 'skipped', ceiling: 'part1-markdown' });
      }
    }

    function request(key: string): () => void {
      refs.set(key, (refs.get(key) ?? 0) + 1);
      if (peek(key).kind === 'unrequested') start(key, 'block', null);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (refs.get(key) ?? 1) - 1;
        if (n > 0) {
          refs.set(key, n);
          return;
        }
        refs.delete(key);
        const job = jobs.get(key);
        if (job !== undefined) {
          detach(job);
          set(key, UNREQUESTED_ENTRY);
        }
      };
    }

    function show(key: string): () => void {
      shownKeys.set(key, (shownKeys.get(key) ?? 0) + 1);
      let hidden = false;
      return () => {
        if (hidden) return;
        hidden = true;
        const left = (shownKeys.get(key) ?? 1) - 1;
        if (left > 0) shownKeys.set(key, left);
        else shownKeys.delete(key);
      };
    }

    function subscribe(key?: string): (listener: () => void) => () => void {
      if (key === undefined) {
        storeWide ??= (l) => {
          everyone.add(l);
          return () => { everyone.delete(l); };
        };
        return storeWide;
      }
      let fn = subscribers.get(key);
      if (fn === undefined) {
        fn = (l) => {
          let held = listeners.get(key);
          if (held === undefined) {
            held = new Set();
            listeners.set(key, held);
          }
          held.add(l);
          return () => { listeners.get(key)?.delete(l); };
        };
        subscribers.set(key, fn);
      }
      return fn;
    }

    function settled(): boolean {
      if (docs) {
        for (const key of seeded) {
          const kind = peek(key).kind;
          if (kind === 'unrequested' || kind === 'pending') return false;
        }
        return true;
      }
      for (const key of new Set([...refs.keys(), ...shownKeys.keys()])) {
        const kind = peek(key).kind;
        if (kind === 'unrequested' || kind === 'pending') return false;
      }
      return true;
    }

    function evictUnreferenced(): void {
      for (const key of [...entries.keys()]) {
        if (refs.has(key) || seeded.has(key) || shownKeys.has(key)) continue;
        entries.delete(key);
        listeners.delete(key);
        subscribers.delete(key);
      }
    }

    function releaseAll(): void {
      refs.clear();
      for (const job of [...jobs.values()]) {
        detach(job);
        set(job.key, UNREQUESTED_ENTRY);
      }
    }

    return {
      mode: options.mode, debounceMs, keyOf: (lang, raw) => blockKey(lang, raw, part1), seed, peek, request, show,
      subscribe, settled, evictUnreferenced, releaseAll,
    };
  }
  ```
- [ ] **Step 5: Run to verify they pass.** Step 3's command — `highlight-html` all green (3 + 19 + 4 + 1 cases), `highlight-store` all green (8 + 12 + 6 + 2 + 1 cases). `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` — green (`highlightStore.ts` reads L1 by its facts: no timer global, no I/O).
- [ ] **Step 6: Commit.** 3 files by name, message `pwa: the content-keyed highlight store, its ceilings, its line retry and the strict check (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T5-M1 | M4.H14 | pwa | `src/lib/highlightStore.ts` | `if (!acceptedClass(html.slice(start, end))) return null;` → removed | `test/highlight-html.test.tsx` | 4 failed — `'a class without the hljs- prefix'`, `'an unknown language name'`, `'an upper-case class character'`, `'an empty scope'` |
| W5HA-T5-M2 | M4.H14 | pwa | `src/lib/highlightStore.ts` | `return cls.startsWith(LANGUAGE_PREFIX) && HIGHLIGHT_NAME_SET.has(cls.slice(LANGUAGE_PREFIX.length));` → `return cls.startsWith(LANGUAGE_PREFIX);` | `test/highlight-html.test.tsx` | 1 failed — `'an unknown language name'` |
| W5HA-T5-M3 | M4.H14 | pwa | `src/lib/highlightStore.ts` | `if (entity === undefined) return null;` → `if (entity === undefined) { i += 1; continue; }` | `test/highlight-html.test.tsx` | 2 failed — `'a named entity outside the five'`, `'a numeric entity'` |
| W5HA-T5-M4 | M4.H14 | pwa | `src/lib/highlightStore.ts` | `if (depth !== 0) return null;` → removed | `test/highlight-html.test.tsx` | 1 failed — `'an unclosed span'` |
| W5HA-T5-M5 | M4.H12 | pwa | `src/lib/highlightStore.ts` | `if (ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS) entries.set(k.key, { kind: 'skipped', ceiling: 'page-input' });\n      else if (inScan` → `if (inScan` | `test/highlight-store.test.ts` | 1 failed — `'the input ceiling skips at seed, in document order, a shared key counted once'` |
| W5HA-T5-M6 | M4.H12 | pwa | `src/lib/highlightStore.ts` | `} else if (docs && ceilingsOn && outputChars + o.html.length > DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS) {` → `} else if (false) {` | `test/highlight-store.test.ts` | 1 failed — `'the output ceiling: the answer that would pass the page HTML cap is skipped, and every later request'` |
| W5HA-T5-M7 | M4.H12 | pwa | `src/lib/highlightStore.ts` | `if (timeouts >= HIGHLIGHT_PAGE_MAX_TIMEOUTS) close('page-timeouts');` → `if (timeouts >= 1000) close('page-timeouts');` | `test/highlight-store.test.ts` | 3 failed — `'the timeout ceiling: at HIGHLIGHT_PAGE_MAX_TIMEOUTS timeouts every unanswered key is skipped, the running job detached'`; `'the retry counts against the page ceilings: its timeout is counted'`; `'a retry the ceilings refuse leaves the block plain under its first failure, never skipped'` |
| W5HA-T5-M8 | M4.H12 | pwa | `src/lib/highlightStore.ts` | `const timer = ceilingsOn` → `const timer = false` (no worker-time timer: worker time is counted only for jobs that answered) | `test/highlight-store.test.ts` | 1 failed — `'the worker-time ceiling fires mid-job: the running job is detached and the rest skipped'` |
| W5HA-T5-M9 | M4.H13 | pwa | `src/lib/highlightStore.ts` | `} else if (o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {\n      failure = { kind: 'too-large' };\n    } else {` → `} else {` | `test/highlight-store.test.ts` | 1 failed — `'an answer over MD_HIGHLIGHT_MAX_HTML_CHARS is too-large on receipt, and a long block is retried in line mode, pending meanwhile'` |
| W5HA-T5-M10 | M4.H11 | pwa | `src/lib/highlightStore.ts` | `const peek = (key: string): HighlightEntry => entries.get(key) ?? UNREQUESTED_ENTRY;` → `const peek = (key: string): HighlightEntry => ({ ...(entries.get(key) ?? UNREQUESTED_ENTRY) });` | `test/highlight-store.test.ts` | 2+ failed — `'peek returns the same object until the entry changes; subscribe(key) returns the same function for a key'`; `'two blocks with equal (lang, raw) make one request; peek is synchronous and never requests'` |
| W5HA-T5-M11 | M4.H12 | pwa | `src/lib/highlightStore.ts` | `if (docs) {\n      for (const key of seeded) {` → `if (false) {\n      for (const key of seeded) {` (a Docs store's `settled()` read over referenced keys only) | `test/highlight-store.test.ts` | 1 failed — `'settled(): false while a seeded key is unanswered, from creation; true once every one is html, plain or skipped'` |
| W5HA-T5-M12 | M4.H11 | pwa | `src/lib/highlightStore.ts` | `if (n > 0) {\n        refs.set(key, n);\n        return;\n      }` → removed (detach on the first release of a shared key) | `test/highlight-store.test.ts` | 1 failed — `'releasing one of two references keeps the job; releasing the last detaches it and the key is unrequested again'` |
| W5HA-T5-M13 | M4.H18 | pwa | `src/lib/highlightStore.ts` | `if (job.first === null && (failure.kind === 'timeout'` → `if ((failure.kind === 'timeout'` (retry twice) | `test/highlight-store.test.ts` | 1 failed — `'a retry that fails differently leaves the block plain under its first failure, the retry\'s outcome recorded'` |
| W5HA-T5-M14 | M4.H18 | pwa | `src/lib/highlightStore.ts` | `rawLength > HIGHLIGHT_LINE_RETRY_UNITS) {` → `rawLength >= HIGHLIGHT_LINE_RETRY_UNITS) {` | `test/highlight-store.test.ts` | 1 failed — `'a block of exactly the unit gets no retry and stays plain under its first failure; one unit more is retried'` |
| W5HA-T5-M15 | (g) | pwa | `src/lib/highlightStore.ts` | `if (status !== 'live') {` → `if (status === 'worker-failed') {` | `test/highlight-store.test.ts` | 1 failed — `'a highlighter that is worker-unavailable: the block is plain at once with that cause, nothing queued'` |
| W5HA-T5-M16 | — | pwa | `src/lib/highlightStore.ts` | `raw: textOf(n).replace(/\n$/, '') });` → `raw: textOf(n) });` | `test/highlight-store.test.ts` | 1 failed — `'walks pre elements in document order: the code class\'s language, and the text with one trailing newline stripped'` |
| W5HA-T5-M17 | (r) | pwa | `src/lib/highlightStore.ts` | `for (const key of new Set([...refs.keys(), ...shownKeys.keys()])) {` → `for (const key of refs.keys()) {` | `test/highlight-store.test.ts` | 1 failed — `'a chat store is not settled while a shown key waits for its request (the debounce window)'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-html.test.tsx test/highlight-store.test.ts )` — all passed; `TSC-OK`.

### Task 6: The switch — `CodeBlock` on a store, the one sink, the seam, and every main-thread highlighter moved (M4.M1, M4.P10, M4.H1, M4.H2, M4.H15's sink half; part 1's rows kept; refinements (a), (h), (j), (n), (o))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. This is the wave's largest task and its one atomic change: once `markdown.tsx` stops importing highlight.js, every consumer must read a store in the same commit, and every suite that saw colours must render under a test store. The judgment is in keeping each migrated test's meaning (what it pins) while its mechanism changes, and in leaving the golden files byte-identical.

**Spec rows:** §4.10 `CodeBlock` (its table of entries and labels), "The single sink and its check" (the sink), Tests (`HighlighterContext`, the test store), "The store" (a Docs page in `DocParse`, a text leaf, a chat message), "The settled outcome"'s W5h paragraph (`publish`), §4.4 "The text leaf", §4.11 `detachUrls`, §4.12 "Chat highlighting" (store per message; the debounce is Task 7's), §4.9's three moves from `lib/markdown.tsx`; M4.M1, M4.P10, M4.H1, M4.H2 (re-proved through the store, nine distinct blocks), M4.H15 (`highlight-html.test.ts`'s sink case); refinement (a) (tool wells).

**Files:**
- Create: `pwa/src/lib/highlighterContext.ts`, `pwa/test/highlightTestStore.tsx`.
- Modify (production): `pwa/src/lib/markdown.tsx`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/docs/docsLinks.ts`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/session/ToolWellText.tsx`, `pwa/src/session/toolWell.ts` (one comment line: its citation of the moved `isRegisteredGrammar`).
- Modify (tests): `pwa/test/markdown-golden.test.tsx`, `render-hast.test.tsx`, `markdown-highlight.test.tsx`, `markdown-bounds.test.tsx`, `code-block.test.tsx`, `docs-highlight-budget.test.tsx`, `docs-markdown.test.tsx` (one case), `docs-screen.test.tsx` (one case), `tool-well.test.tsx`, `tool-well-plan.test.ts` (one import), `docs-links.test.tsx`, `docs-images.test.tsx`, `reader-images.test.ts` (the `detachUrls` call sites), `highlight-html.test.tsx` (one appended describe), `setup.ts` (comment (4) only), `pwa/browser/tool-well-colour.browser.test.ts` (one wait).
- Guards (not edited): every file under `pwa/test/golden/**` (byte-identical: the test that writes them must not move one byte), `pwa/test/chat-hardening.test.tsx`, `pwa/test/message-bubble.test.tsx`, `pwa/test/message-links.test.tsx` (unmodified, §7.9), `pwa/test/reader-frame.test.tsx`, `pwa/test/contrast.test.ts`.

**Interfaces:**
- Consumes everything of Tasks 2-5.
- Produces:
  ```ts
  // highlighterContext.ts (L4 composition)
  export interface HighlighterContextValue {
    readonly docs: Highlighter; readonly chat: Highlighter;
    readonly createStore: (highlighter: Highlighter, mode: 'docs' | 'chat') => HighlightStore;
    readonly publish?: (store: HighlightStore | null) => void;   // null: the published store is gone
  }
  export function createProductionStore(highlighter: Highlighter, mode: 'docs' | 'chat'): HighlightStore;
  export const HIGHLIGHTER_DEFAULT: HighlighterContextValue;
  export const HighlighterContext: React.Context<HighlighterContextValue>;
  // markdown.tsx (L4): CodeBlock({children}) (no highlight prop); codeBlockLabel(label, raw, answer, entry);
  // HighlightedCode({entry, raw}), the one sink; useHighlightEntry(store, key); useHighlightRequest(store, key);
  // PreHighlightContext: Context<HighlightStore | null>
  // docsLinks.ts: detachUrls(tree): Detached; DetachedUrls without `highlight`; DocsHighlightLanguages deleted
  // pwa/test/highlightTestStore.tsx: syncTestStore, inThreadHighlighter, SYNC_HIGHLIGHT, inThreadContext,
  //   withSyncHighlight, withSyncStore (exact text in Step 1)
  ```

**Decisions this task makes:** (1) `CodeBlock` keeps its DOM exactly: the label in `.code-block-lang`, the copy button, `<pre><code class="hljs">`, so the plain first frame and the coloured frame differ only in the spans, and the golden files do not move. (2) A block with no store (`PreHighlightContext` null) is plain, with the label `blockKey` gives it (so an over-cap block still says its KiB). (3) In this task a block requests its key at once on every key change; Task 7 adds chat's debounce, the eviction and the prewarms, with their tests. (4) A Docs page's store is created in `DocParse` when a tree settles, seeded at once, published through `publish` in an effect and released on cleanup (refinement (o)); `DocTree` receives it. (5) The text leaf asks `isRegisteredGrammar(ext)`; its store is seeded with its one block. (6) The tool wells keep BASE's rule that a well over a highlight bound shows its original text, and otherwise draw `plan.text` through `HighlightedCode`, plain first (refinement (a)). (7) Every test that asserted colours renders under `SYNC_HIGHLIGHT` (a context of synchronous test stores) or `withSyncStore` (a `PreHighlightContext` provider), so its assertion still holds; a test that pins the production path's behaviour uses `inThreadContext()` (production stores over in-thread highlighters) and waits.

- [ ] **Step 0:** `test -f pwa/src/lib/highlightStore.ts && git grep -q "^import hljs from 'highlight.js/lib/core';$" HEAD -- pwa/src/lib/markdown.tsx pwa/src/docs/DocsLeaf.tsx && git grep -q "export function detachUrls(tree: HastRoot, langs: DocsHighlightLanguages): Detached {" HEAD -- pwa/src/docs/docsLinks.ts && git grep -q "const { html } = boundedHighlight(plan.text, plan.kind === 'diff' ? 'diff' : plan.lang);" HEAD -- pwa/src/session/ToolWellText.tsx && echo T6-BASE-OK`. Claim `markdown.tsx`, `DocMarkdown.tsx`, `docsLinks.ts`, `DocsLeaf.tsx`, `ToolWellText.tsx`, `docs-screen.test.tsx`, the browser file. Record the count of every test file this task edits, and `git diff --stat HEAD -- pwa/test/golden` (empty).
- [ ] **Step 1: Write the seam and the test store.**
  - `pwa/src/lib/highlighterContext.ts`:
    ```ts
    // The highlighting seam (native Docs reader, W5h-a Task 6; base spec 2026-10-01 section 4.10 "Tests"). One context,
    // `HighlighterContext`, whose default is the production value, `HIGHLIGHTER_DEFAULT`: the two singletons
    // (`docsHighlighter`, `chatHighlighter`) and `createProductionStore`, which builds a store on the real clock.
    // `DocParse`, `TextBody`, `ChatMarkdown` and the tool wells create their stores through it; tests replace it with
    // `pwa/test/highlightTestStore.tsx`'s values, never as the default (M4.H17). The default needs no provider, so the
    // app root has none (the W5h-a plan's refinement (o)). A Docs page's store and a text leaf's are also published
    // through the optional `publish` slot, which Export's sheet will read; nothing provides the slot in production yet
    // (refinement (h)).
    //
    // Ring L4 composition: it binds the production singletons and the store's real clock (timers).
    import { createContext } from 'react';
    import { createHighlightStore, type HighlightClock, type HighlightStore } from './highlightStore';
    import type { Highlighter } from './highlightProtocol';
    import { chatHighlighter, docsHighlighter } from './markdownRunner';

    export interface HighlighterContextValue {
      readonly docs: Highlighter;
      readonly chat: Highlighter;
      readonly createStore: (highlighter: Highlighter, mode: 'docs' | 'chat') => HighlightStore;
      /** The page's or text leaf's store, handed up for the leaf's actions; `null` when that store is gone. Absent:
       *  nobody reads it. */
      readonly publish?: (store: HighlightStore | null) => void;
    }

    const REAL_CLOCK: HighlightClock = {
      now: () => performance.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };

    /** A production store: part 1's bounds and the ceilings on, chat's debounce for a chat store (section 4.10). */
    export function createProductionStore(highlighter: Highlighter, mode: 'docs' | 'chat'): HighlightStore {
      return createHighlightStore(highlighter, { mode }, REAL_CLOCK);
    }

    export const HIGHLIGHTER_DEFAULT: HighlighterContextValue = {
      docs: docsHighlighter, chat: chatHighlighter, createStore: createProductionStore,
    };

    export const HighlighterContext = createContext<HighlighterContextValue>(HIGHLIGHTER_DEFAULT);
    ```
  - `pwa/test/highlightTestStore.tsx`:
    ```tsx
    // The highlighting seam's test values (native Docs reader, W5h-a Task 6; base spec 2026-10-01 section 4.10 "Tests" and
    // section 4.12's chat table). jsdom has no `Worker`, so the production highlighters answer `worker-unavailable` there
    // and every block stays plain. A test that needs colours renders under one of these:
    //   - `syncTestStore(mode)`: a store whose `peek` colours a key in-thread, at once, on the highlight worker's own
    //     instance (`highlightGrammars.ts#HLJS`), and runs the main thread's check on the result, so the sink receives a
    //     `CheckedHighlightHtml`. It never asks a highlighter and is always settled. `renderToStaticMarkup` reads it, so
    //     `markdown-golden.test.tsx`'s stored files stay byte-identical (M4.M1) and M4.P10 holds over settled output.
    //     `vi.spyOn(HLJS, 'highlight')` counts what it colours.
    //   - `SYNC_HIGHLIGHT` / `withSyncHighlight(node)`: a `HighlighterContext` value whose stores are `syncTestStore`s.
    //   - `withSyncStore(node, store?)`: a `PreHighlightContext` provider, for a `CodeBlock` or a renderer drawn directly.
    //   - `inThreadHighlighter({hold})`: a `Highlighter` that answers through the worker's own answerer in-thread, one
    //     microtask later, or when the test calls `release()`; `inThreadContext(...)`: production stores over two of them,
    //     so a test runs the real store, its ceilings and its check, and waits for the colours.
    // This file is under `pwa/test`; nothing under `pwa/src` imports it (M4.H17, `docs-scans.test.ts`).
    import type { ReactNode } from 'react';
    import { HLJS } from '../src/lib/highlightGrammars';
    import { createHighlightAnswerer } from '../src/lib/highlightJob';
    import type { Highlighter, HighlighterStatus, HighlightOutcome, HighlightReply, HighlightRequest } from '../src/lib/highlightProtocol';
    import { HighlighterContext, createProductionStore, type HighlighterContextValue } from '../src/lib/highlighterContext';
    import { UNREQUESTED_ENTRY, blockKey, checkHighlightHtml, type HighlightEntry, type HighlightStore } from '../src/lib/highlightStore';
    import { PreHighlightContext } from '../src/lib/markdown';
    import { MD_HIGHLIGHT_MAX_HTML_CHARS } from '../src/lib/markdownLimits';

    const NO_SUBSCRIPTION = (_listener: () => void): (() => void) => () => undefined;

    /** A store whose `peek` colours a key in-thread, once (a later peek reads what it kept). `requests` lists every key
     *  a block requested. */
    export function syncTestStore(mode: 'docs' | 'chat' = 'chat'): HighlightStore & { readonly requests: readonly string[] } {
      const kept = new Map<string, HighlightEntry>();
      const requests: string[] = [];
      const peek = (key: string): HighlightEntry => {
        const held = kept.get(key);
        if (held !== undefined) return held;
        const sep = key.indexOf('\u0000');
        if (sep === -1) return UNREQUESTED_ENTRY;
        let entry: HighlightEntry;
        try {
          const html = HLJS.highlight(key.slice(sep + 1), { language: key.slice(0, sep), ignoreIllegals: true }).value;
          const checked = html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? null : checkHighlightHtml(html);
          entry = checked !== null
            ? { kind: 'html', mode: 'block', checked }
            : { kind: 'plain', first: html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? { kind: 'too-large' } : { kind: 'malformed' }, retry: null };
        } catch (e) {
          entry = { kind: 'plain', first: { kind: 'threw', error: e instanceof Error ? e.name : typeof e }, retry: null };
        }
        kept.set(key, entry);
        return entry;
      };
      return {
        mode, debounceMs: 0, keyOf: (lang, raw) => blockKey(lang, raw), seed: () => undefined, peek,
        request: (key) => { requests.push(key); return () => undefined; }, show: () => () => undefined,
        subscribe: () => NO_SUBSCRIPTION, settled: () => true, evictUnreferenced: () => undefined,
        releaseAll: () => undefined, requests,
      };
    }

    export interface InThreadHighlighter extends Highlighter {
      /** Every request, in order, and the signal each came with. */
      readonly calls: HighlightRequest[];
      readonly signals: (AbortSignal | undefined)[];
      /** What `status()` answers. */
      state: HighlighterStatus;
      /** With `hold`: posts and answers every waiting request now. */
      release(): void;
    }

    /** A highlighter that answers through the worker's own answerer, in-thread: one microtask later, or, with `hold`, when
     *  the test calls `release()`. Its `onPosted` runs just before the answer. */
    export function inThreadHighlighter(opts: { readonly hold?: boolean } = {}): InThreadHighlighter {
      const answer = createHighlightAnswerer();
      const waiting: (() => void)[] = [];
      let id = 0;
      const h: InThreadHighlighter = {
        calls: [],
        signals: [],
        state: 'live',
        highlight(request, o) {
          h.calls.push(request);
          h.signals.push(o.signal);
          return new Promise<HighlightOutcome>((resolve, reject) => {
            if (o.signal?.aborted) {
              reject(o.signal.reason);
              return;
            }
            o.signal?.addEventListener('abort', () => reject(o.signal!.reason), { once: true });
            const run = (): void => {
              o.onPosted?.();
              id += 1;
              answer({ id, ...request }, (r: HighlightReply) => { if ('result' in r) resolve(r.result); });
            };
            if (opts.hold === true) waiting.push(run);
            else queueMicrotask(run);
          });
        },
        status: () => h.state,
        prewarm: () => undefined,
        release: () => { for (const run of waiting.splice(0)) run(); },
      };
      return h;
    }

    /** Synchronous test stores for every store the tree creates. */
    export const SYNC_HIGHLIGHT: HighlighterContextValue = {
      docs: inThreadHighlighter(), chat: inThreadHighlighter(), createStore: (_h, mode) => syncTestStore(mode),
    };

    /** Production stores over in-thread highlighters (by default two fresh ones), and, when given, a `publish` slot. */
    export function inThreadContext(
      docs: Highlighter = inThreadHighlighter(), chat: Highlighter = inThreadHighlighter(),
      publish?: (store: HighlightStore | null) => void,
    ): HighlighterContextValue {
      return publish === undefined
        ? { docs, chat, createStore: createProductionStore }
        : { docs, chat, createStore: createProductionStore, publish };
    }

    export function withSyncHighlight(node: ReactNode): ReactNode {
      return <HighlighterContext value={SYNC_HIGHLIGHT}>{node}</HighlighterContext>;
    }

    export function withSyncStore(node: ReactNode, store: HighlightStore = syncTestStore()): ReactNode {
      return <PreHighlightContext value={store}>{node}</PreHighlightContext>;
    }
    ```
- [ ] **Step 2: Write the sink's case first (M4.H15, its behavioural half).** Append to `pwa/test/highlight-html.test.tsx`:
  ```ts

  // Docs W5h-a Task 6 (M4.H15's behavioural half): the code component inserts only a value the check made.
  describe('M4.H15: the one sink inserts only checked HTML', () => {
    it('a checked value renders its spans; a plain string or a look-alike at the sink renders the block plain', () => {
      const good = render(<HighlightedCode entry={{ kind: 'html', mode: 'block', checked: checkHighlightHtml('<span class="hljs-keyword">x</span>')! }} raw="x" />);
      expect(good.container.querySelector('code.hljs .hljs-keyword')?.textContent).toBe('x');
      for (const forged of [{ html: '<img src=x onerror=alert(1)>' }, Object.freeze({ html: '<img src=x onerror=alert(1)>' })]) {
        const { container } = render(<HighlightedCode entry={{ kind: 'html', mode: 'block', checked: forged as never }} raw="<img src=x>" />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('code.hljs')?.textContent).toBe('<img src=x>');
      }
    });
  });
  ```
  with `import { render } from '@testing-library/react';` and `import { HighlightedCode } from '../src/lib/markdown';` added to its imports. Run `( cd pwa && ./node_modules/.bin/vitest run test/highlight-html.test.tsx )` — Expected: fails to import `HighlightedCode`: the red.
- [ ] **Step 3: Migrate the suites that saw colours (tests first, so the switch is measured).** Each edit keeps the case's name and what it pins:
  - `markdown-golden.test.tsx`: replace `import hljs from 'highlight.js/lib/core';` with `import { HIGHLIGHT_GRAMMARS, isRegisteredGrammar } from '../src/lib/highlightNames';` and `import { withSyncHighlight } from './highlightTestStore';`; `const REGISTERED: readonly string[] = [...hljs.listLanguages()].sort();` → `const REGISTERED: readonly string[] = [...HIGHLIGHT_GRAMMARS];`; in `html`, `renderToStaticMarkup(\n    <MessageBubble` → `renderToStaticMarkup(withSyncHighlight(\n    <MessageBubble` with the matching `)` added; in `openedRecap`, the `render(` argument likewise wrapped; in `'measures a non-empty grammar list…'`, `expect(hljs.getLanguage(tag), tag).toBeDefined()` → `expect(isRegisteredGrammar(tag), tag).toBe(true)` and `.toBeUndefined()` → `.toBe(false)`. Header: after "This file imports nothing W4 creates: …", add `// From W5h-a (base spec 4.15's M4.M1, amended) it also imports the registry as data and the test store, and renders under that store, so the stored files are unchanged (the settled output). Never regenerate them.` Append one control case inside `describe('the golden is not vacuous', …)`:
    ```ts
    it('M4.M1 control: rendered with no test store, a coloured golden loses its spans (W5h-a)', () => {
      const c = CASES.find((x) => x.name === 'lang-ts')!;
      const plain = renderToStaticMarkup(<MessageBubble id="s" event={{ kind: 'assistant', uuid: `g-${c.name}`, ts: TS, text: c.text }} />);
      expect(html(c)).toContain('hljs-keyword');
      expect(plain).not.toContain('hljs-keyword');
    });
    ```
  - `render-hast.test.tsx`: replace `import hljs from 'highlight.js/lib/core';` with `import { HIGHLIGHT_GRAMMARS } from '../src/lib/highlightNames';` and `import { syncTestStore, withSyncStore } from './highlightTestStore';`; `[...hljs.listLanguages()].sort()` → `[...HIGHLIGHT_GRAMMARS]`; add `const STORE = syncTestStore('chat');` and wrap both `viaMarkdown`'s and `viaRenderHast`'s rendered element in `withSyncStore(<element>, STORE)` (M4.P10: both sides under one injected synchronous test store). Header gains: `// From W5h-a, M4.P10 is stated over settled output: both sides render under one synchronous test store.`
  - `code-block.test.tsx`: in `fenced`, `render(\n    <MessageBubble` → `render(withSyncHighlight(\n    <MessageBubble` (and its `)`), every other `render(` of a component that draws a fence likewise; import `withSyncHighlight`. Header's `hljs`-gating paragraph: append `// From W5h-a the gate is \`highlightNames.ts#isRegisteredGrammar\` and the colours come from the highlight worker (here the synchronous test store).`
  - `markdown-highlight.test.tsx`: imports — `CHAT_COMPONENTS, CodeBlock` from `'../src/lib/markdown'` only; `boundedHighlight`, `hljs` and the C7 cache names dropped; add `import { withSyncStore, inThreadHighlighter } from './highlightTestStore';`, `import { createProductionStore } from '../src/lib/highlighterContext';` and `import { PreHighlightContext } from '../src/lib/markdown';`. Every `render(<CodeBlock …>…</CodeBlock>)` and the `renderHast(...)` render become `render(withSyncStore(…))`. The helper `block` loses its third parameter and the prop it passed (the new `CodeBlock` takes `children` only: the prop would be TS2322, and the parameter left unused TS6133 under `noUnusedParameters`): `function block(lang: string, body: string, highlight?: boolean): HTMLElement {` → `function block(lang: string, body: string): HTMLElement {` and `<CodeBlock highlight={highlight}>` → `<CodeBlock>`, its `render(` argument wrapped in `withSyncStore(…)` like the others; no remaining call passes a third argument once the two `highlight` prop cases are deleted. Delete the two `highlight` prop cases (`'highlight={false} renders a small registered block…'`, `'highlight={true} is the default'`: the prop is retired, §4.10) and move `'an unregistered language is unchanged by the cap…'` into the M4.H1 describe; delete the describe `'the highlight cache (C7)'` (its cases moved to `markdown-highlight-worker.test.ts`'s M4.H20, Task 3) and replace it with:
    ```tsx
    describe('M4.H1 through the real store: a block over the cap is never posted', () => {
      it('a 70 000-character python block makes no request and says its size; a 1 000-character one is requested', async () => {
        const h = inThreadHighlighter();
        const store = createProductionStore(h, 'chat');
        const big = render(<PreHighlightContext value={store}><CodeBlock><code className="language-python">{pyBody(70000)}</code></CodeBlock></PreHighlightContext>);
        expect(big.container.querySelector('.code-block-lang')?.textContent).toBe('Python · not highlighted (69 KiB)');
        expect(h.calls).toHaveLength(0);
        const small = render(<PreHighlightContext value={store}><CodeBlock><code className="language-python">{pyBody(1000)}</code></CodeBlock></PreHighlightContext>);
        await waitFor(() => expect(small.container.querySelector('.hljs-keyword')).not.toBeNull());
        expect(h.calls.map((c) => c.code.length)).toEqual([1000]);
      });
    });
    ```
    (add `waitFor` to its `@testing-library/react` import). Header: append `// From W5h-a the cap is \`highlightStore.ts#blockKey\`'s and the colours the highlight worker's; the cases render under a synchronous test store, and one runs the real store (M4.H1 re-proved through the store).`
  - `markdown-bounds.test.tsx`: imports — `ChatMarkdown, CodeBlock, SHARED_COMPONENTS` from `'../src/lib/markdown'`; `HIGHLIGHT_BOUNDED_CAPS, highlightBlockCap, inMarkdownPageBudget, inScanPageBudget, longestBlankRun, longestWordRun` from `'../src/lib/highlightNames'`; `HLJS, deriveBoundedCaps` from `'../src/lib/highlightGrammars'`; `withSyncHighlight, withSyncStore` from `'./highlightTestStore'`; `import hljs from 'highlight.js/lib/core';` deleted. Then, mechanically: `vi.spyOn(hljs, 'highlight')` → `vi.spyOn(HLJS, 'highlight')`; every other `hljs.` → `HLJS.`; `block()`'s `render(` argument wrapped in `withSyncStore(…)`; `chat()`'s and every inline `render(` of `ChatMarkdown`, `CodeBlock`, `MessageBubble` or `renderHast(...)` wrapped in `withSyncHighlight(…)` (a `ChatMarkdown` makes its own store through the context) or `withSyncStore(…)` (a bare `CodeBlock` or renderer). The describe `'T13 review 4-3: a block the page budget refuses labels itself by its size…'` (three cases on the retired `highlight` prop) is re-pointed, names kept: a block a part-1 page budget skips is drawn under a production docs store (`createProductionStore(inThreadHighlighter({ hold: true }), 'docs')`) seeded so that block is past `DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS`: within its own cap it keeps the bare label; a block over its own cap is never seeded and says its KiB; neither is ever requested (`h.calls` empty) — which is what the three cases pinned. Two more cases outside that describe pass the retired prop too: `'an unregistered fence and highlight={false} are never scanned either'` keeps its unregistered half (`block('mermaid', …)`: `blockKey` answers `unregistered` before any scan) and drops its `highlight={false}` half, with a comment that from W5h-a a block the page budget skips is still keyed by `blockKey`, which scans it once, linearly, and the store never requests it (what that half pinned, no highlight.js call, is the T13 describe's); `'a ts block of 10 000 characters the page budget refuses is labelled by its own cap: 10 KiB'` drops the prop (`<CodeBlock>` under `withSyncStore`): its label comes from `blockKey`'s part-1 grammar cap (10 000 > 8 192), and the spy stays uncalled. `deriveBoundedCaps(hljs, …)` cases now take `HLJS`; `'the module\'s bounded set is exactly the closure…'` compares `HIGHLIGHT_BOUNDED_CAPS` (now static) with `deriveBoundedCaps(HLJS, base)`. Header: append `// From W5h-a part 1's bounds are applied by \`highlightStore.ts#blockKey\` from \`highlightNames.ts\`'s data on the main thread (until W5h-b), and the colours come from the highlight worker; here, from the synchronous test store, whose \`HLJS.highlight\` calls the spies count.`
  - `docs-highlight-budget.test.tsx` (M4.H2 and part 1's page budgets, re-proved through the store; refinement (j)): drop the `hljs`, `PreHighlightContext`, `codeLanguage`/`inScanPageBudget`/`inMarkdownPageBudget` and `DocsHighlightLanguages` imports and `LANGS`; add `import { codeBlocksOf } from '../src/lib/highlightStore';`, `import { createProductionStore, HighlighterContext } from '../src/lib/highlighterContext';`, `import { inThreadContext, inThreadHighlighter } from './highlightTestStore';` and the helper:
    ```ts
    /** Each block's admission as the page's store decides it at seed, in document order: `admitted`, `skipped` (by
     *  which ceiling) or why it can never be requested. */
    function decisions(root: HastRoot): string[] {
      const store = createProductionStore(inThreadHighlighter({ hold: true }), 'docs');
      const blocks = codeBlocksOf(root);
      store.seed(blocks);
      return blocks.map((b) => {
        const k = store.keyOf(b.lang, b.raw);
        if (k.kind !== 'key') return k.kind;
        const e = store.peek(k.key);
        return e.kind === 'skipped' ? `skipped:${e.ceiling}` : 'admitted';
      });
    }
    ```
    Every `detachUrls(…, LANGS)` + `.highlight` read becomes `decisions(root)` (`true` → `'admitted'`, `false` → `'skipped:page-input'`, `'skipped:part1-scan'` or `'skipped:part1-markdown'` by the budget the case names). Every fixture of repeated blocks gets distinct texts of the same length (`distinct(text, i)`: the block's first characters replaced by the index in base 36, its length unchanged), because a key identical blocks share counts once; and every boundary is re-derived on raw lengths (the trailing newline the parse keeps is no longer counted: §4.10 Seeding), so a case "at the budget" sums raw lengths to exactly the budget. The two rendered cases (M4.H2's nine blocks, and the markdown budget's `'(f) rendered…'`) render `DocMarkdown` (or `renderHast` under a `PreHighlightContext` of a seeded production store) inside `<HighlighterContext value={inThreadContext()}>`, wait with `waitFor` until the store's colours land, and assert the eight coloured blocks and the ninth's label `'Python · not highlighted (page highlighting limit)'`; review 460 F10's end-to-end case asserts the same blocks coloured, now through the store. The case `'counts only the text under the pre\'s code children'` becomes `'a pre with no code child is no requestable block and counts nothing'` (`decisions` answers `'unregistered'` for it). `'the Docs page hands detachUrls the real highlight-budget languages'` (its describe name kept) asserts through `DocMarkdown` that a `tsx` block past the scan budget and an `md` block past the markdown budget are never requested (`h.calls`) and keep their bare labels. Header: rewritten to say the decisions moved from `detachUrls` into the store's seed (W5h-a).
  - `docs-markdown.test.tsx`, `'the page highlight budget reaches the blocks: of nine 60 000-character python blocks the ninth is not highlighted'`: `fence` takes an index and its body starts `import a${i}= 1` in place of `import a = 1` (the same length), so the nine are distinct; the render is wrapped in `<HighlighterContext value={inThreadContext()}>`; after the existing `waitFor`, add `await waitFor(() => expect(container.querySelectorAll('.hljs-keyword')).toHaveLength(8), { timeout: 60000 });`, keep the per-block assertion, and assert the ninth label ends `· not highlighted (page highlighting limit)`.
  - `docs-screen.test.tsx`, `'text with a registered grammar (x.ts) is highlighted through CodeBlock; x.txt is pre.doc-plain'`: in place of `const { container } = open('/docs/demo/specs/x.ts', f);` it does `navigate('/docs/demo/specs/x.ts');` then `const { container } = render(withSyncHighlight(<Routed loaders={f.loaders} />));` (the file's own `Routed`; import `withSyncHighlight`).
  - `tool-well.test.tsx`: `expanded()`'s and every `render(` wrapped in `withSyncHighlight`; in `'memoizes mounted well work by scalar inputs'`, `const highlights = vi.spyOn(markdown, 'boundedHighlight');` → `const highlights = vi.spyOn(HLJS, 'highlight');` (import `HLJS`; drop the `* as markdown` import if now unused). Header: `the one bounded highlighter` → `the highlight worker, through a one-block store per well (W5h-a)`.
  - `tool-well-plan.test.ts`: `import { isRegisteredGrammar } from '../src/lib/markdown';` → `from '../src/lib/highlightNames';`.
  - `docs-links.test.tsx`, `docs-images.test.tsx`, `reader-images.test.ts`: every `detachUrls(x, LANGS)` (or `, { codeLanguage, inScanPageBudget, inMarkdownPageBudget }`) → `detachUrls(x)`; their `LANGS` constants and the now-unused imports deleted; in `docs-links.test.tsx`, `&& d.urls.get(e)?.highlight === null` deleted and `toEqual({ attrs: { href: 'd.md' }, imageIndex: null, highlight: null })` → `toEqual({ attrs: { href: 'd.md' }, imageIndex: null })`.
  - `pwa/browser/tool-well-colour.browser.test.ts`: before `const m = await card.evaluate(`, add `await card.locator('.well .hljs-string').first().waitFor({ timeout: 20_000 });` with the comment `// From W5h-a the well is plain first and coloured when the highlight worker answers.`
  Run `( cd pwa && ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/markdown-highlight.test.tsx test/tool-well.test.tsx test/highlight-html.test.tsx )` — Expected, on the BASE renderer (which still colours on the main thread and ignores the context): red `'M4.M1 control: rendered with no test store, a coloured golden loses its spans (W5h-a)'`, `'a 70 000-character python block makes no request and says its size; a 1 000-character one is requested'` and `'memoizes mounted well work by scalar inputs'` (its `HLJS.highlight` spy counts 0); `'a 70 000-char block from the parse pipeline is capped too'`, a TypeError from BASE's `SharedPre`, which calls the `PreHighlightContext` value as a function and is handed a store by `withSyncStore`; and `highlight-html.test.tsx` fails to import `HighlightedCode`. Every other case of those files is green. Record them; a different red set is a stop-and-ask. `render-hast.test.tsx`, `markdown-bounds.test.tsx`, `code-block.test.tsx`, `docs-markdown.test.tsx` and `docs-highlight-budget.test.tsx` are migrated in this step but first run in Step 5: on the BASE renderer, a case that draws a fence through `SharedPre` under `withSyncStore` throws the same TypeError (BASE calls the context's value as a function), so their cases cannot be measured red first; Step 5 measures them green on the new renderer, and their rows (W5HA-T6-M*) measure the guards.
- [ ] **Step 4: The switch.**
  - `markdown.tsx`:
    - Header: append `// W5h-a Task 6 (base spec 2026-10-01 section 4.10 "Highlighting"): this file no longer imports highlight.js. The grammar registration moved to \`highlightGrammars.ts\` (the highlight worker's closure), \`LANG_LABEL\`, \`codeLanguage\` and part 1's scans to \`highlightNames.ts\`, the cache into the worker. \`CodeBlock\` reads a highlight store (\`PreHighlightContext\`) with \`useSyncExternalStore\`, requests in an effect, renders plain first, and draws through \`HighlightedCode\`, the one \`dangerouslySetInnerHTML\` in \`pwa/src\`, which inserts only a value \`isCheckedHighlightHtml\` accepts. \`ChatMarkdown\` holds one store per message on \`chatHighlighter\`.` and delete the header's two sentences about `boundedHighlight` (desktop polish C7's and W5 Task 6's "reads PreHighlightContext, the Docs page's highlight budget").
    - Imports: delete `import hljs from 'highlight.js/lib/core';`, `import type { HLJSApi, LanguageFn } from 'highlight.js';`, the 15 `highlight.js/lib/languages/*` imports, `import { createLru } from './highlightCache';` and `import type { Element as HastElement } from 'hast';`; the react import gains `useEffect, useMemo, useSyncExternalStore`; the `./markdownLimits` import keeps only `CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN, MD_MAX_TREE_DEPTH`; add `import { LANG_LABEL, codeLanguage } from './highlightNames';`, `import { HighlighterContext } from './highlighterContext';`, `import { UNREQUESTED_ENTRY, blockKey, isCheckedHighlightHtml, type BlockKey, type HighlightEntry, type HighlightStore } from './highlightStore';`.
    - Delete (moved in Task 2, or retired): `xmlWithoutSubLanguages`, the registration loop and the three `registerAliases`, `LANG_LABEL`, `longestWordRun`, `longestLine`, `longestBlankRun`, `codeLanguage`, `embeddedGrammars`, `deriveBoundedCaps`, `HIGHLIGHT_BOUNDED_CAPS`, `BOUNDED_BY_DEF`, `boundedCap`, `highlightBlockCap`, `inScanPageBudget`, `inMarkdownPageBudget`, `BoundedHighlight`, `isRegisteredGrammar`, `HIGHLIGHTED`, `highlighted` and `boundedHighlight`, each with its docstring.
    - Replace `CodeBlock`, `PreHighlightContext` and `SharedPre` (from `/** Fenced code: language label + copy bar over a syntax-highlighted well.` through the end of `SharedPre`, `TableWrap` kept between them) with:
      ```tsx
      const NO_SUBSCRIPTION = (_listener: () => void): (() => void) => () => undefined;

      /** A block's entry in `store`, read as React reads an external store; the shared `unrequested` entry with no store
       *  or no key. `peek` is also the server snapshot, so `renderToStaticMarkup` reads the store and never requests. */
      export function useHighlightEntry(store: HighlightStore | null, key: string | null): HighlightEntry {
        const subscribe = store === null || key === null ? NO_SUBSCRIPTION : store.subscribe(key);
        const snapshot = (): HighlightEntry => (store === null || key === null ? UNREQUESTED_ENTRY : store.peek(key));
        return useSyncExternalStore(subscribe, snapshot, snapshot);
      }

      /** Shows `key` and holds one reference on it while the block displays it; releases both on cleanup or when the key
       *  changes (Task 7 adds chat's debounce to the request). */
      export function useHighlightRequest(store: HighlightStore | null, key: string | null): void {
        useEffect(() => {
          if (store === null || key === null) return undefined;
          const unshow = store.show(key);
          const release = store.request(key);
          return () => {
            release();
            unshow();
          };
        }, [store, key]);
      }

      /** What a block's label says (section 4.10's table): the language, then why a registered block is not coloured. */
      export function codeBlockLabel(label: string, raw: string, answer: BlockKey, entry: HighlightEntry): string {
        const kib = `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)`;
        switch (answer.kind) {
          case 'unregistered':
            return label;
          case 'over-cap':
            return kib;
          case 'part1':
            return answer.bound === 'grammar-cap' ? kib
              : `${label} · not highlighted (a ${answer.chars}-character ${answer.bound === 'word' ? 'word' : answer.bound === 'line' ? 'line' : 'run of whitespace'})`;
          case 'key':
            break;
        }
        switch (entry.kind) {
          case 'html':
            return entry.mode === 'line' ? `${label} · highlighted line by line` : label;
          case 'skipped':
            return entry.ceiling === 'part1-scan' || entry.ceiling === 'part1-markdown' ? label : `${label} · not highlighted (page highlighting limit)`;
          case 'plain':
            if (entry.first.kind === 'timeout') return `${label} · not highlighted (took over ${entry.first.budgetMs / 1000} s)`;
            return entry.first.kind === 'too-large' ? `${label} · not highlighted (output too large)` : label;
          case 'unrequested':
          case 'pending':
            return label;
        }
      }

      /** THE highlight sink in `pwa/src` (section 4.10 "The single sink and its check", M4.H15): the one
       *  `dangerouslySetInnerHTML`, which inserts only the `html` of a value `isCheckedHighlightHtml` accepts. Anything
       *  else, a plain string from a forged store included, renders `raw` as text in the same element. `CodeBlock` and
       *  the tool wells draw code through it. */
      export function HighlightedCode({ entry, raw }: { readonly entry: HighlightEntry; readonly raw: string }): ReactNode {
        const checked: unknown = entry.kind === 'html' ? entry.checked : null;
        if (isCheckedHighlightHtml(checked)) return <code className="hljs" dangerouslySetInnerHTML={{ __html: checked.html }} />;
        return <code className="hljs">{raw}</code>;
      }

      /** The highlight store a code block reads (section 4.10 `CodeBlock`): a Docs page's, a text leaf's or a chat
       *  message's. `null`, the default, has ONE meaning: no store, so the block renders plain. Every production mount
       *  provides one. */
      export const PreHighlightContext = createContext<HighlightStore | null>(null);

      /** Fenced code: language label + copy bar over the well. The bar is a SIBLING above the scrolling <pre>, never an
       *  overlay. It makes no highlight.js call: it reads its entry in the store, plain until the worker's answer is
       *  `html` (the plain first frame, section 4.10), and its label says why a registered block is not coloured. */
      export function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
        const store = useContext(PreHighlightContext);
        const [copied, setCopied] = useState(false);
        const codeEl = React.Children.toArray(children).find(React.isValidElement) as
          | React.ReactElement<{ className?: string; children?: ReactNode }>
          | undefined;
        const lang = codeLanguage(codeEl?.props.className ?? '');
        const label = LANG_LABEL[lang] ?? (lang || 'text');
        const raw = nodeText(children).replace(/\n$/, '');
        const answer = useMemo(() => (store === null ? blockKey(lang, raw) : store.keyOf(lang, raw)), [store, lang, raw]);
        const key = answer.kind === 'key' ? answer.key : null;
        const entry = useHighlightEntry(store, key);
        useHighlightRequest(store, key);
        const onCopy = useCallback(() => {
          void navigator.clipboard?.writeText(raw).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }, [raw]);
        return (
          <div className="code-block">
            <div className="code-block-bar">
              <span className="code-block-lang">{codeBlockLabel(label, raw, answer, entry)}</span>
              <button type="button" className="code-block-copy" onClick={onCopy}
                      aria-label="Copy code" data-copied={copied || undefined}>
                <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre>
              <HighlightedCode entry={entry} raw={raw} />
            </pre>
          </div>
        );
      }
      ```
      then `TableWrap` unchanged, then:
      ```tsx
      /** Fenced code through `CodeBlock`, which reads the store `PreHighlightContext` carries. */
      function SharedPre({ children }: { children?: ReactNode }): ReactNode {
        return <CodeBlock>{children}</CodeBlock>;
      }
      ```
      and in `SHARED_COMPONENTS`' docstring, `fenced code (under the Docs page's highlight budget when one is provided)` → `fenced code (on the highlight store \`PreHighlightContext\` carries)`.
    - `ChatMarkdown`: its body becomes
      ```tsx
        const highlighters = useContext(HighlighterContext);
        // One highlight store per message, on chat's own highlighter, for both paths (section 4.12 "Chat highlighting").
        const store = useMemo(() => highlighters.createStore(highlighters.chat, 'chat'), [highlighters]);
        useEffect(() => () => store.releaseAll(), [store]);
        return (
          <PreHighlightContext value={store}>
            {utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES
              ? <SyncChatMarkdown text={text} />
              : <AsyncChatMarkdown text={text} parser={parser} />}
          </PreHighlightContext>
        );
      ```
      and its docstring gains `It holds one highlight store for the message (W5h-a).`
  - `docsLinks.ts`: delete `preCodeChars`, `preCodeClass`, `DocsHighlightLanguages` and the import of the three limits; in `DetachedUrls` delete `readonly highlight: boolean | null;` and the sentence `` `highlight: null` means it is not a `pre`. ``; `detachUrls`' signature becomes `export function detachUrls(tree: HastRoot): Detached {`, its body loses `codeChars`, `scanChars`, `markdownChars` and the whole `if (node.tagName === 'pre') { … }` block and `let highlight`, and `if (Object.keys(attrs).length > 0 || imageIndex !== null || highlight !== null) {\n      urls.set(copy, { attrs, imageIndex, highlight });` becomes `if (Object.keys(attrs).length > 0 || imageIndex !== null) {\n      urls.set(copy, { attrs, imageIndex });`. Its docstring loses everything from `; and each \`pre\` records the page highlight budget's decision` to the end of the review 450 F1 sentence, and `` `langs` holds the renderer's grammar facts … `` is deleted; it gains `From W5h-a it decides nothing about highlighting: the page's highlight store does (\`lib/highlightStore.ts\`).` The file header's `and records the page highlight budget's decision for each \`pre\`` is deleted.
  - `DocMarkdown.tsx`: the import changes listed under Interfaces' consumer side (`PreHighlightContext, SHARED_COMPONENTS` from `'../lib/markdown'`; `useContext, useEffect` added to the react import; `import type { Root as HastRoot } from 'hast';`; `import { HighlighterContext } from '../lib/highlighterContext';`; `import { codeBlocksOf, type HighlightStore } from '../lib/highlightStore';`; `import { detachUrls } from './docsLinks';`); delete `DOCS_HIGHLIGHT_LANGUAGES` and its docstring; `DocTree` takes `readonly store: HighlightStore`, detaches with `detachUrls(p.tree)`, drops `budget`, and provides `<PreHighlightContext value={p.store}>` where it provided `value={budget}`; its docstring's `and highlight budget` becomes `and highlight store`. In `DocParse`, replace from `if (pending || outcome === null) return <p className="doc-formatting">{DOC_FORMATTING}</p>;` through `const shown = inThread ?? outcome;` with:
    ```tsx
      const highlighters = useContext(HighlighterContext);
      const shown = pending || outcome === null ? null : inThread ?? outcome;
      const tree = shown?.kind === 'tree' ? shown.tree : null;
      // The page's highlight store (section 4.10 "The store"): one per settled tree, seeded at once with the tree's code
      // blocks in document order, so `settled()` is false from the first commit while any is unanswered; published for
      // the leaf's actions (Export) and released when the tree goes.
      const store = useMemo(() => {
        if (tree === null) return null;
        const s = highlighters.createStore(highlighters.docs, 'docs');
        s.seed(codeBlocksOf(tree));
        return s;
      }, [highlighters, tree]);
      useEffect(() => {
        if (store === null) return undefined;
        highlighters.publish?.(store);
        return () => {
          store.releaseAll();
          highlighters.publish?.(null);
        };
      }, [highlighters, store]);
      if (shown === null) return <p className="doc-formatting">{DOC_FORMATTING}</p>;
    ```
    and in the tree branch `<DocTree tree={shown.tree} link={p.link} />` → `{store !== null && <DocTree tree={shown.tree} link={p.link} store={store} />}`.
  - `DocsLeaf.tsx`: delete `import hljs from 'highlight.js/lib/core';`; `import { CodeBlock } from '../lib/markdown';` → `import { CodeBlock, PreHighlightContext } from '../lib/markdown';`; add `import { isRegisteredGrammar } from '../lib/highlightNames';` and `import { HighlighterContext } from '../lib/highlighterContext';`; in `RasterBody`, `imageIndex: 0, highlight: null });` → `imageIndex: 0 });`; replace `TextBody` (docstring and function) with:
    ```tsx
    /** A `text` leaf (spec 4.4, "The text leaf"): when a registered grammar knows the extension (`highlightNames.ts`, never
     *  highlight.js), the file is one `CodeBlock` on a one-block highlight store on the Docs highlighter, seeded with
     *  that block when it is created, published for the leaf's actions and released on unmount; else plain. */
    function TextBody(p: { readonly show: DocsShowOk; readonly path: string }): ReactNode {
      const highlighters = useContext(HighlighterContext);
      const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
      const name = leafName(p.path);
      // contentClass said `text`, so the extension is ASCII `a-z0-9` once lowered: `toLowerCase` lowers it the same way.
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      const text = src.kind === 'markdown' && isRegisteredGrammar(ext) ? src.text : null;
      const store = useMemo(() => {
        if (text === null) return null;
        const s = highlighters.createStore(highlighters.docs, 'docs');
        s.seed([{ lang: ext, raw: text.replace(/\n$/, '') }]);
        return s;
      }, [highlighters, ext, text]);
      useEffect(() => {
        if (store === null) return undefined;
        highlighters.publish?.(store);
        return () => {
          store.releaseAll();
          highlighters.publish?.(null);
        };
      }, [highlighters, store]);
      if (src.kind === 'no-bytes') return <DocsFailureView answer={malformed(DOCS_SHOW_NO_BYTES)} />;
      if (src.kind === 'not-utf8') return <DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />;
      if (store === null) return <pre className="doc-plain">{src.text}</pre>;
      return (
        <PreHighlightContext value={store}>
          <CodeBlock><code className={'language-' + ext}>{src.text}</code></CodeBlock>
        </PreHighlightContext>
      );
    }
    ```
    and the header's `` `text` is the file in `<pre class="doc-plain">`, or `CodeBlock` `` sentence gains `on a one-block highlight store (W5h-a)`.
  - `ToolWellText.tsx`: header's first paragraph: `go through \`lib/markdown.tsx#boundedHighlight\`, the ONE highlighter (never \`hljs\` here), into the same \`<code className="hljs">\` a fenced block renders` → `are coloured by the highlight worker through a one-block store per well on chat's highlighter, plain first, and drawn by \`lib/markdown.tsx#HighlightedCode\`, the one sink (W5h-a, the plan's refinement (a))`; imports: `useContext, useEffect, useMemo` from react; `HighlightedCode, useHighlightEntry, useHighlightRequest` from `'../lib/markdown'`; `isRegisteredGrammar` from `'../lib/highlightNames'`; `HighlighterContext` from `'../lib/highlighterContext'`. Replace `HighlightedWell` with:
    ```tsx
    /** A code or diff well: the Write's path as a leading comment when the plan has one, then the code, on a one-block
     *  highlight store on chat's highlighter, plain until the worker answers. A well over a highlight bound shows
     *  `fallback`, the original text, exactly as a fenced block over its bound renders plain. */
    function CodeWell({ lang, text, head, fallback }: { lang: string; text: string; head?: string; fallback: string }): ReactNode {
      const highlighters = useContext(HighlighterContext);
      const store = useMemo(() => highlighters.createStore(highlighters.chat, 'chat'), [highlighters]);
      useEffect(() => () => store.releaseAll(), [store]);
      const answer = useMemo(() => store.keyOf(lang, text), [store, lang, text]);
      const key = answer.kind === 'key' ? answer.key : null;
      const entry = useHighlightEntry(store, key);
      useHighlightRequest(store, key);
      if (key === null) return fallback;
      return (
        <>
          {head !== undefined && <span className="hljs-comment">{head}</span>}
          {head !== undefined && '\n'}
          <HighlightedCode entry={entry} raw={text} />
        </>
      );
    }
    ```
    and in `ToolWellText`'s `case 'code': case 'diff':` arm, replace from `const { html } = boundedHighlight(` through `return <HighlightedWell html={html} head={plan.kind === 'code' ? plan.head : undefined} />;` with `return <CodeWell lang={plan.kind === 'diff' ? 'diff' : plan.lang} text={plan.text} head={plan.kind === 'code' ? plan.head : undefined} fallback={text} />;`, keeping the comment about escapes above it.
  - `toolWell.ts`: in its header, `` `lib/markdown.tsx#isRegisteredGrammar` `` → `` `lib/highlightNames.ts#isRegisteredGrammar` `` (the symbol moved; the line's reasoning about L1 and `.tsx` is left as it is).
  - `setup.ts`: comment (4)'s first sentence becomes `` The highlight worker's answerer (`highlightJob.ts`) keeps highlight.js's markup in a bounded cache, and a test builds one in-thread (`markdown-highlight-worker.test.ts`, the test store's `inThreadHighlighter`). `` (the rest unchanged).
- [ ] **Step 5: Run to verify they pass.** `( cd pwa && ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/render-hast.test.tsx test/code-block.test.tsx test/highlight-html.test.tsx )`, then `test/markdown-highlight.test.tsx test/markdown-bounds.test.tsx`, then `test/docs-highlight-budget.test.tsx test/docs-markdown.test.tsx test/docs-links.test.tsx test/docs-images.test.tsx test/reader-images.test.ts`, then `test/docs-screen.test.tsx test/tool-well.test.tsx test/tool-well-plan.test.ts test/chat-hardening.test.tsx test/message-bubble.test.tsx test/message-links.test.tsx` — all green. `git diff --stat HEAD -- pwa/test/golden` — empty (the stored files did not move). `git grep -n "from 'highlight.js" -- pwa/src` lists only `pwa/src/lib/highlightGrammars.ts`; `git grep -n "dangerouslySetInnerHTML" -- pwa/src` lists only `lib/markdown.tsx#HighlightedCode`. `TSC-OK`.
- [ ] **Step 6: Guard suites.** The whole pwa suite in pieces through `ccrc test` (every file green; the known load flakes re-run alone); `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/docs-parity.test.ts )`. The browser file: `( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/tool-well-colour.browser.test.ts )` through `ccrc test` — green (the real highlight worker colours the well).
- [ ] **Step 7: Commit.** Every file this task created or edited, by name (expect 24; count them with `git diff --cached --name-only | wc -l`), message `pwa: code blocks read a highlight store; highlight.js leaves the main thread (docs W5h-a)`, with a body naming the one sink, the seam, the tool wells (refinement (a)) and the unchanged golden files, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T6-M1 | M4.M1 | pwa | `test/markdown-golden.test.tsx` | `renderToStaticMarkup(withSyncHighlight(` → `renderToStaticMarkup((` (render without the test store) | `test/markdown-golden.test.tsx` | 2+ failed — the coloured language cases of `'M4.M1: chat Markdown output is held to its golden files'` against their stored files, `'lang-ts'` and `'lang-bash'` among them |
| W5HA-T6-M2 | M4.H15 | pwa | `src/lib/markdown.tsx` | `if (isCheckedHighlightHtml(checked)) return` → `if (checked !== null) return` (and `checked.html` → `(checked as { html: string }).html`) | `test/highlight-html.test.tsx` | 1 failed — `'a checked value renders its spans; a plain string or a look-alike at the sink renders the block plain'` |
| W5HA-T6-M3 | M4.P10 | pwa | `src/lib/markdown.tsx` | `const store = useContext(PreHighlightContext);` (in `CodeBlock`) → `const store: HighlightStore \| null = null;` | `test/markdown-golden.test.tsx`, `test/render-hast.test.tsx` | 2+ failed — the coloured language cases of `'M4.M1: chat Markdown output is held to its golden files'`, `'lang-ts'` and `'lang-bash'` among them (render-hast's parity cases may stay green: both of its sides draw plain) |
| W5HA-T6-M4 | M4.H1 | pwa | `src/lib/highlightStore.ts` | `if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };` → removed | `test/highlight-store.test.ts` | 1 failed — `'keyOf: a key, or why the block can never be requested, in BASE\'s order; part 1\'s bounds only with part1'` (with part 1 on, a block over the cap is still refused, as part 1's grammar cap, whose fallback is `MD_HIGHLIGHT_BLOCK_MAX_CHARS`, with the same KiB label, so the rendered M4.H1 cases stay green until W5h-b) |
| W5HA-T6-M5 | M4.H2 | pwa | `src/docs/DocMarkdown.tsx` | `s.seed(codeBlocksOf(tree));` → removed | `test/docs-highlight-budget.test.tsx`, `test/docs-markdown.test.tsx` | 2+ failed — among them `'the page highlight budget reaches the blocks: of nine 60 000-character python blocks the ninth is not highlighted'` (the ninth coloured, no page-limit label) and `docs-highlight-budget.test.tsx`'s rendered nine-block case |
| W5HA-T6-M6 | §4.4 | pwa | `src/docs/DocsLeaf.tsx` | `const text = src.kind === 'markdown' && isRegisteredGrammar(ext) ? src.text : null;` → `const text = null;` | `test/docs-screen.test.tsx` | 1 failed — `'text with a registered grammar (x.ts) is highlighted through CodeBlock; x.txt is pre.doc-plain'` |
| W5HA-T6-M7 | (a) | pwa | `src/session/ToolWellText.tsx` | `if (key === null) return fallback;` → `if (key === null) return text;` | `test/tool-well.test.tsx` | 1 failed — `'strips input escapes on the plain fallback; over its bound an input shows its JSON text as written'` |

**Verify:** the four Step 5 commands — all passed; `git diff --stat HEAD~1 -- pwa/test/golden` empty; `TSC-OK`; the browser file green.

### Task 7: Chat's streaming rules, the prewarms, the labels and the Export hand-off (M4.C4, M4.C5, M4.H16, M4.H19, the page halves of M4.H7, M4.H13 and M4.H18; refinements (h), (p), (r))

**Model routing:** `sonnet`, effort `high`. The judgment is in the debounce's first-render rule under React's double effects (a block's first key, and a re-run of the same key, request at once), and in proving each rule with fake timers rather than a clock.

**Spec rows:** §4.12 "Chat highlighting" (plain first frame, no Worker, streaming debounce, a closed fence once, ceilings per message, eviction), §4.10 "The store" (Chat; References; Unmount), "The highlight runner" (the prewarms), Tests (`publish`), "The settled outcome"'s W5h paragraph; M4.C4, M4.C5, M4.H16, M4.H19.

**Files:**
- Modify: `pwa/src/lib/markdown.tsx` (`useHighlightRequest` debounced; two effects in `ChatMarkdown`), `pwa/src/screens/DocsScreen.tsx` (one effect, two imports), `pwa/test/chat-hardening.test.tsx` (one appended describe).
- Create: `pwa/test/highlight-wiring.test.tsx`.
- Guards (not edited): `pwa/test/docs-screen.test.tsx`, `pwa/test/message-bubble.test.tsx`, `pwa/test/chat-memo.test.tsx`, `pwa/test/chat.test.tsx`.

**Interfaces:** Consumes Task 6's `useHighlightRequest`, `ChatMarkdown`, `HighlighterContext`, `inThreadHighlighter`, `inThreadContext`, `SYNC_HIGHLIGHT`. Produces no new export.

**Decisions this task makes:** (1) A block requests at once when the store has no debounce, when the key is the block's first, or when an effect re-runs on the same key (React's development double effects); otherwise it requests once the key has held still for `store.debounceMs`, and its previous key was released at the change (detached, the worker lives on). (2) `ChatMarkdown` evicts after every commit (an effect with no dependency list, after its blocks' effects) and prewarms its highlighter on mount (refinement (p)). (3) `DocsScreen` prewarms the Docs highlighter on mount, beside the parser's prewarm, whatever parser it was given (the highlighter is the context's, which a test replaces).

- [ ] **Step 0:** `git grep -q "export function useHighlightRequest(store: HighlightStore | null, key: string | null): void {" HEAD -- pwa/src/lib/markdown.tsx && git grep -q "if (parser === DEFAULT_DOCS_PARSER) docsRunner.prewarm();" HEAD -- pwa/src/screens/DocsScreen.tsx && echo T7-BASE-OK`. Claim `markdown.tsx`, `DocsScreen.tsx`, `chat-hardening.test.tsx`; check Share's claim on `DocsScreen.tsx`. Record `chat-hardening.test.tsx`'s count.
- [ ] **Step 1: Append to `pwa/test/chat-hardening.test.tsx`:**
  ```tsx

  // Docs W5h-a Task 7 (base spec 2026-10-01 section 4.12 "Chat highlighting"; M4.C4, M4.C5, M4.H19 chat half). Chat's
  // code is coloured off the main thread, through one store per message on chat's own highlighter. These run the real
  // store over in-thread highlighters that answer only when the test releases them (`highlightTestStore.tsx`).
  describe('W5h-a: chat highlighting', () => {
    const FENCE = '```ts\nconst a = 1;\n```';
    /** A message of about `bytes` UTF-8 bytes: prose, then the fence. */
    const message = (bytes: number): string => `${'word '.repeat(Math.max(0, Math.floor((bytes - FENCE.length - 2) / 5)))}\n\n${FENCE}`;
    const under = (ctx: HighlighterContextValue, node: ReactNode): ReactNode => <HighlighterContext value={ctx}>{node}</HighlighterContext>;
    const shape = (c: HTMLElement): string[] =>
      [...c.querySelectorAll('.code-block')].map((b) => [...b.querySelectorAll('*')].filter((e) => !e.className.toString().startsWith('hljs-')).map((e) => e.tagName + '.' + e.className).join(' '));

    it('M4.C4: a 1 000 B and a 5 000 B message render the fence plain first, same layout and text, then coloured', async () => {
      vi.spyOn(chatRunner, 'parse').mockImplementation(async (src, o) => parseMarkdown(src, o.profile));
      for (const bytes of [1000, 5000]) {
        const chat = inThreadHighlighter({ hold: true });
        const text = message(bytes);
        expect(utf8ByteLength(text) > CHAT_SYNC_MAX_BYTES).toBe(bytes === 5000);
        const { container, unmount } = render(under(inThreadContext(inThreadHighlighter(), chat), bubble(text)));
        await waitFor(() => expect(container.querySelector('.code-block code.hljs')).not.toBeNull());
        const first = shape(container);
        expect(container.querySelector('code.hljs')?.textContent).toBe('const a = 1;');
        expect(container.querySelector('[class^="hljs-"]')).toBeNull();
        expect(container.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
        await act(async () => { chat.release(); });
        await waitFor(() => expect(container.querySelector('code.hljs .hljs-keyword')?.textContent).toBe('const'));
        expect(container.querySelector('code.hljs')?.textContent).toBe('const a = 1;');
        expect(shape(container)).toEqual(first);
        unmount();
      }
    });

    it('M4.C4: with no Worker the fence stays plain with its bare label, and nothing is queued', () => {
      const chat = inThreadHighlighter();
      chat.state = 'worker-unavailable';
      const { container } = render(under(inThreadContext(inThreadHighlighter(), chat), bubble(message(1000))));
      expect(container.querySelector('code.hljs')?.textContent).toBe('const a = 1;');
      expect(container.querySelector('[class^="hljs-"]')).toBeNull();
      expect(container.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
      expect(chat.calls).toHaveLength(0);
    });

    it('M4.C5: a growing fence is requested at once on its first render, then only once its text holds still', () => {
      vi.useFakeTimers();
      try {
        const chat = inThreadHighlighter({ hold: true });
        const ctx = inThreadContext(inThreadHighlighter(), chat);
        const r = render(under(ctx, bubble('```ts\nconst a', true)));
        expect(chat.calls.map((c) => c.code)).toEqual(['const a']);
        r.rerender(under(ctx, bubble('```ts\nconst a = 1', true)));
        expect(chat.signals[0]?.aborted).toBe(true);
        act(() => { vi.advanceTimersByTime(HIGHLIGHT_STREAM_DEBOUNCE_MS - 1); });
        r.rerender(under(ctx, bubble('```ts\nconst a = 12', true)));
        act(() => { vi.advanceTimersByTime(HIGHLIGHT_STREAM_DEBOUNCE_MS - 1); });
        expect(chat.calls).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(1); });
        expect(chat.calls.map((c) => c.code)).toEqual(['const a', 'const a = 12']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('M4.C5: once the fence closes, later settles, a re-render and a Copy tap add no request for it', () => {
      vi.useFakeTimers();
      try {
        const chat = inThreadHighlighter({ hold: true });
        const ctx = inThreadContext(inThreadHighlighter(), chat);
        const closed = '```ts\nconst a = 12\n```';
        const r = render(under(ctx, bubble('```ts\nconst a = 12', true)));
        r.rerender(under(ctx, bubble(closed, true)));
        r.rerender(under(ctx, bubble(`${closed}\n\nDone`, true)));
        r.rerender(under(ctx, bubble(`${closed}\n\nDone.`, false)));
        act(() => { vi.advanceTimersByTime(10 * HIGHLIGHT_STREAM_DEBOUNCE_MS); });
        fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
        expect(chat.calls.map((c) => c.code)).toEqual(['const a = 12']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('M4.C5: after each commit the message\'s store evicts what no block references', () => {
      const evictions = vi.fn();
      const ctx: HighlighterContextValue = {
        ...inThreadContext(),
        createStore: (h, mode) => {
          const s = createProductionStore(h, mode);
          return { ...s, evictUnreferenced: () => { evictions(); s.evictUnreferenced(); } };
        },
      };
      const r = render(under(ctx, bubble('```ts\nx\n```')));
      const before = evictions.mock.calls.length;
      r.rerender(under(ctx, bubble('```ts\nxy\n```')));
      expect(before).toBeGreaterThan(0);
      expect(evictions.mock.calls.length).toBeGreaterThan(before);
    });

    it('refinement (r): in the debounce window the block shows its new key, so the message\'s store is not settled', async () => {
      vi.useFakeTimers();
      try {
        const chat = inThreadHighlighter({ hold: true });
        const stores: HighlightStore[] = [];
        const ctx: HighlighterContextValue = {
          ...inThreadContext(inThreadHighlighter(), chat),
          createStore: (h, mode) => {
            const s = createProductionStore(h, mode);
            stores.push(s);
            return s;
          },
        };
        const r = render(under(ctx, bubble('```ts\nconst a', true)));
        await act(async () => { chat.release(); });
        // The message's stores, read together (a store a part no longer renders holds no key and reads settled).
        const settled = (): boolean => stores.length > 0 && stores.every((x) => x.settled());
        expect(settled()).toBe(true);
        r.rerender(under(ctx, bubble('```ts\nconst a = 1', true)));
        expect(settled()).toBe(false);
        act(() => { vi.advanceTimersByTime(HIGHLIGHT_STREAM_DEBOUNCE_MS - 1); });
        expect(chat.calls).toHaveLength(1);
        expect(settled()).toBe(false);
        act(() => { vi.advanceTimersByTime(1); });
        expect(chat.calls.map((c) => c.code)).toEqual(['const a', 'const a = 1']);
        await act(async () => { chat.release(); });
        expect(settled()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('M4.H19 (chat half): chat\'s requests go to the chat highlighter, never the Docs one, and chat prewarms it on mount', () => {
      const docs = inThreadHighlighter({ hold: true });
      const chat = inThreadHighlighter({ hold: true });
      const prewarm = vi.spyOn(chat, 'prewarm');
      render(under(inThreadContext(docs, chat), bubble(message(1000))));
      expect(chat.calls).toHaveLength(1);
      expect(docs.calls).toHaveLength(0);
      expect(prewarm).toHaveBeenCalled();
    });
  });
  ```
  Imports to add: `import type { ReactNode } from 'react';`, `fireEvent` and `waitFor` from `@testing-library/react`, `HIGHLIGHT_STREAM_DEBOUNCE_MS` from `../src/lib/markdownLimits`, `import { HighlighterContext, createProductionStore, type HighlighterContextValue } from '../src/lib/highlighterContext';`, `import { inThreadContext, inThreadHighlighter } from './highlightTestStore';`, `import type { HighlightStore } from '../src/lib/highlightStore';`.
- [ ] **Step 2: Write `pwa/test/highlight-wiring.test.tsx`:**
  ```tsx
  // The Docs side of the worker path (native Docs reader, W5h-a Task 7; base spec 2026-10-01 section 4.10 "CodeBlock" and
  // "The store", section 4.4 "The text leaf"; M4.H16, M4.H19 Docs half; the Export hand-off). The real store over
  // in-thread highlighters that answer when the test releases them: a Docs page's block and a text leaf render plain
  // first and are coloured when the worker answers; their stores go to the Docs highlighter only; each is published
  // through `HighlighterContext`'s `publish` slot with its `settled()`, which is what Export reads (refinement (h)); the
  // Docs screen prewarms the Docs highlighter.
  import type { ReactNode } from 'react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { act, cleanup, render, waitFor } from '@testing-library/react';
  import { DocMarkdown } from '../src/docs/DocMarkdown';
  import type { DocLinkContextValue } from '../src/docs/DocLink';
  import { HighlighterContext, type HighlighterContextValue } from '../src/lib/highlighterContext';
  import type { HighlightStore } from '../src/lib/highlightStore';
  import { parseMarkdown } from '../src/lib/markdownParse';
  import type { MarkdownParser } from '../src/lib/markdownRunner';
  import { DocsScreen } from '../src/screens/DocsScreen';
  import { HLJS } from '../src/lib/highlightGrammars';
  import type { Highlighter, HighlightOutcome, HighlightRequest } from '../src/lib/highlightProtocol';
  import { HIGHLIGHT_BLOCK_DEADLINE_MS, MD_HIGHLIGHT_MAX_HTML_CHARS } from '../src/lib/markdownLimits';
  import { entry, fakeLoaders, fileResponse, okTree, treeOk } from './docsFixtures';
  import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

  afterEach(cleanup);

  const SRC = '# T\n\n```ts\nconst a = 1;\n```\n';
  const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
  const LINK: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
    pageSource: 'committed', onFragment: () => undefined,
  } as Omit<DocLinkContextValue, 'urls'>;
  const under = (ctx: HighlighterContextValue, node: ReactNode): ReactNode => <HighlighterContext value={ctx}>{node}</HighlighterContext>;

  /** A Docs screen on the text leaf `specs/x.ts`, its file `text`. */
  function textLeaf(ctx: HighlighterContextValue, text: string) {
    const r = fileResponse(text);
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.ts')] })), file: { s: 'ok', value: { ...r, contentClass: 'text', show: { ...r.show, path: 'x.ts', size: text.length } } } });
    return render(under(ctx, <DocsScreen path="/docs/demo/specs/x.ts" search="" loaders={f.loaders} parser={parser} reader={null} />));
  }

  describe('M4.H16: plain first frame on the Docs side', () => {
    it('a Docs page\'s block: plain, same text and label, until the worker answers; then spans, text unchanged', async () => {
      const docs = inThreadHighlighter({ hold: true });
      const { container } = render(under(inThreadContext(docs), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(container.querySelector('article .code-block code.hljs')).not.toBeNull());
      const pre = container.querySelector('article pre')!;
      expect(pre.textContent).toBe('const a = 1;');
      expect(container.querySelector('[class^="hljs-"]')).toBeNull();
      expect(container.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
      await act(async () => { docs.release(); });
      await waitFor(() => expect(container.querySelector('article .hljs-keyword')?.textContent).toBe('const'));
      expect(pre.textContent).toBe('const a = 1;');
    });

    it('a text leaf: plain first, then coloured, on the Docs highlighter', async () => {
      const docs = inThreadHighlighter({ hold: true });
      const { container } = textLeaf(inThreadContext(docs), 'const b = 2;');
      await waitFor(() => expect(container.querySelector('.docs-leaf .code-block code.hljs')?.textContent).toBe('const b = 2;'));
      expect(container.querySelector('.docs-leaf [class^="hljs-"]')).toBeNull();
      await act(async () => { docs.release(); });
      await waitFor(() => expect(container.querySelector('.docs-leaf .hljs-keyword')?.textContent).toBe('const'));
    });
  });

  describe('M4.H19 (Docs half): a Docs page\'s and a text leaf\'s requests go to the Docs highlighter only', () => {
    it('neither asks the chat highlighter', async () => {
      const docs = inThreadHighlighter({ hold: true });
      const chat = inThreadHighlighter({ hold: true });
      const page = render(under(inThreadContext(docs, chat), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(docs.calls).toHaveLength(1));
      page.unmount();
      textLeaf(inThreadContext(docs, chat), 'const c = 3;');
      await waitFor(() => expect(docs.calls).toHaveLength(2));
      expect(chat.calls).toHaveLength(0);
    });

    it('the Docs screen prewarms the Docs highlighter on mount', () => {
      const docs = inThreadHighlighter();
      const prewarm = vi.spyOn(docs, 'prewarm');
      render(under(inThreadContext(docs), <DocsScreen path="/docs" search="" loaders={fakeLoaders().loaders} parser={parser} reader={null} />));
      expect(prewarm).toHaveBeenCalled();
    });
  });

  describe('the Export hand-off: the store is published with its settled()', () => {
    it('a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount', async () => {
      const docs = inThreadHighlighter({ hold: true });
      const published: (HighlightStore | null)[] = [];
      const { unmount } = render(under(inThreadContext(docs, undefined, (s) => published.push(s)), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(published.at(-1)).not.toBeNull());
      const store = published.at(-1)!;
      const k = store.keyOf('ts', 'const a = 1;');
      expect(k.kind).toBe('key');
      expect(store.settled()).toBe(false);
      await act(async () => { docs.release(); });
      await waitFor(() => expect(store.settled()).toBe(true));
      expect(store.peek((k as { key: string }).key).kind).toBe('html');
      unmount();
      expect(published.at(-1)).toBeNull();
    });

    it('a text leaf publishes its one-block store the same way', async () => {
      const docs = inThreadHighlighter({ hold: true });
      const published: (HighlightStore | null)[] = [];
      textLeaf(inThreadContext(docs, undefined, (s) => published.push(s)), 'const d = 4;');
      await waitFor(() => expect(published.at(-1)).not.toBeNull());
      const store = published.at(-1)!;
      expect(store.settled()).toBe(false);
      await act(async () => { docs.release(); });
      await waitFor(() => expect(store.settled()).toBe(true));
    });
  });

  /** A highlighter the test answers request by request (`answer(i, outcome)`), posting each first. */
  function scripted(): Highlighter & { readonly calls: HighlightRequest[]; answer(i: number, o: HighlightOutcome): void } {
    const calls: HighlightRequest[] = [];
    const waiting: { readonly onPosted?: () => void; readonly resolve: (o: HighlightOutcome) => void }[] = [];
    return {
      calls,
      highlight: (req, o) => new Promise<HighlightOutcome>((resolve) => {
        calls.push(req);
        waiting.push({ onPosted: o.onPosted, resolve });
      }),
      status: () => 'live',
      prewarm: () => undefined,
      answer: (i, outcome) => {
        waiting[i]!.onPosted?.();
        waiting[i]!.resolve(outcome);
      },
    };
  }
  const coloured = (code: string, mode: 'block' | 'line' = 'block'): HighlightOutcome =>
    ({ kind: 'html', html: HLJS.highlight(code, { language: 'ts', ignoreIllegals: true }).value, mode });
  const labels = (c: HTMLElement): string[] => [...c.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? '');
  /** A ts fence of 30 lines: over the line retry's unit. */
  const LONG = 'const a = 1;\n'.repeat(30).replace(/\n$/, '');

  describe('the page halves of M4.H7, M4.H13 and M4.H18: what a block left plain, or coloured line by line, says', () => {
    it('M4.H7: of three blocks whose second times out, the first and third are coloured and only the second is plain', async () => {
      const h = scripted();
      const src = '```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n\n```ts\nconst c = 3;\n```\n';
      const { container } = render(under(inThreadContext(h), <DocMarkdown text={src} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(h.calls).toHaveLength(3));
      await act(async () => {
        h.answer(0, coloured('const a = 1;'));
        h.answer(1, { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
        h.answer(2, coloured('const c = 3;'));
      });
      await waitFor(() => expect(container.querySelectorAll('.hljs-keyword')).toHaveLength(2));
      expect([...container.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length)).toEqual([1, 0, 1]);
      expect(labels(container)).toEqual(['TypeScript', `TypeScript · not highlighted (took over ${HIGHLIGHT_BLOCK_DEADLINE_MS / 1000} s)`, 'TypeScript']);
    });

    it('M4.H13: an answer over the per-block HTML cap, whose line retry is too large as well, says "output too large"', async () => {
      const h = scripted();
      const { container } = render(under(inThreadContext(h), <DocMarkdown text={`\`\`\`ts\n${LONG}\n\`\`\`\n`} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(h.calls).toHaveLength(1));
      await act(async () => { h.answer(0, { kind: 'html', html: 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS + 1), mode: 'block' }); });
      await waitFor(() => expect(h.calls).toHaveLength(2));
      expect(h.calls[1]!.mode).toBe('line');
      await act(async () => { h.answer(1, { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 }); });
      await waitFor(() => expect(labels(container)).toEqual(['TypeScript · not highlighted (output too large)']));
      expect(container.querySelector('.hljs-keyword')).toBeNull();
    });

    it('M4.H18: a block that timed out and was coloured by its line retry says "highlighted line by line"', async () => {
      const h = scripted();
      const { container } = render(under(inThreadContext(h), <DocMarkdown text={`\`\`\`ts\n${LONG}\n\`\`\`\n`} pinKey="p" parser={parser} link={LINK} />));
      await waitFor(() => expect(h.calls).toHaveLength(1));
      await act(async () => { h.answer(0, { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }); });
      await waitFor(() => expect(h.calls).toHaveLength(2));
      await act(async () => { h.answer(1, coloured(LONG, 'line')); });
      await waitFor(() => expect(labels(container)).toEqual(['TypeScript · highlighted line by line']));
      expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    });
  });
  ```
  (If `LINK`'s fixture does not satisfy `DocLinkContextValue` at BASE, build it the way `docs-markdown.test.tsx`'s own `LINK` is built and import that shape; record the change.)
- [ ] **Step 3: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/chat-hardening.test.tsx test/highlight-wiring.test.tsx )` — Expected red: the two M4.C5 debounce cases (every changed key is requested at once), the refinement (r) case (Task 6's hook requests the changed key at once, so two calls before the debounce has passed), the eviction case (no eviction call), and both prewarm assertions; the M4.C4, M4.H16, M4.H19-routing, hand-off and label cases green already (Task 6 built them; this file pins them). Record each; a different red set is a stop-and-ask.
- [ ] **Step 4: Implement.**
  - `markdown.tsx`: replace `useHighlightRequest` (its docstring and body) with:
    ```tsx
    /** Holds one reference on `key` while the block shows it, and releases it on cleanup or when the key changes. A
     *  block's first key is requested at once, and so is a re-run of the same key (React's development double effects);
     *  on a store with a debounce (chat), a CHANGED key is requested only once it has held still for `store.debounceMs`
     *  (section 4.12's streaming rule), so a fence that grows on every settle asks the worker when the stream pauses,
     *  and the request it supersedes was released at the change (detached: the worker lives on). */
    export function useHighlightRequest(store: HighlightStore | null, key: string | null): void {
      const lastKey = useRef<string | null>(null);
      useEffect(() => {
        if (store === null || key === null) return undefined;
        // The block shows `key` from now, requested or not, so a chat store is not settled while it waits (refinement (r)).
        const unshow = store.show(key);
        const immediate = store.debounceMs === 0 || lastKey.current === null || lastKey.current === key;
        lastKey.current = key;
        let release: (() => void) | undefined;
        let timer: number | undefined;
        if (immediate) release = store.request(key);
        else timer = window.setTimeout(() => { release = store.request(key); }, store.debounceMs);
        return () => {
          if (timer !== undefined) window.clearTimeout(timer);
          release?.();
          unshow();
        };
      }, [store, key]);
    }
    ```
    (add `useRef` to the react import). In `ChatMarkdown`, after `useEffect(() => () => store.releaseAll(), [store]);` add:
    ```tsx
        // Chat prewarms its highlighter on its first message's mount (section 4.10's singletons; refinement (p)).
        useEffect(() => { highlighters.chat.prewarm(); }, [highlighters.chat]);
        // After each commit, the keys no mounted block references are evicted, so the store holds this message's current
        // blocks only (section 4.10 "Chat"). No dependency list: it runs after every commit, after the blocks' effects.
        useEffect(() => { store.evictUnreferenced(); });
    ```
  - `DocsScreen.tsx`: add `useContext` to its react import and `import { HighlighterContext } from '../lib/highlighterContext';`; after the effect that ends `if (parser === DEFAULT_DOCS_PARSER) docsRunner.prewarm();\n  }, [parser]);` add:
    ```tsx
      // The Docs highlighter's worker is started on mount too, so the first code block does not wait for its boot
      // (base spec 4.10 "The highlight runner").
      const highlighters = useContext(HighlighterContext);
      useEffect(() => {
        highlighters.docs.prewarm();
      }, [highlighters.docs]);
    ```
- [ ] **Step 5: Run to verify they pass.** Step 3's command — all green. Then `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx test/message-bubble.test.tsx test/chat-memo.test.tsx test/chat.test.tsx test/markdown-golden.test.tsx )` — unchanged, green. `TSC-OK`.
- [ ] **Step 6: Commit.** 4 files by name, message `pwa: chat requests a growing fence when it pauses; prewarms; the page's store is published for Export (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T7-M1 | M4.C5 | pwa | `src/lib/markdown.tsx` | `const immediate = store.debounceMs === 0 \|\| lastKey.current === null \|\| lastKey.current === key;` → `const immediate = true;` | `test/chat-hardening.test.tsx` | 1 failed — `'M4.C5: a growing fence is requested at once on its first render, then only once its text holds still'` |
| W5HA-T7-M2 | M4.C5 | pwa | `src/lib/markdown.tsx` | `useEffect(() => { store.evictUnreferenced(); });` → removed | `test/chat-hardening.test.tsx` | 1 failed — `'M4.C5: after each commit the message\'s store evicts what no block references'` |
| W5HA-T7-M3 | M4.C4 | pwa | `src/lib/highlightStore.ts` | `if (status !== 'live') {` → `if (status !== status) {` (no plain-at-once: the request reaches a highlighter that says it has no worker) | `test/chat-hardening.test.tsx` | 1 failed — `'M4.C4: with no Worker the fence stays plain with its bare label, and nothing is queued'` |
| W5HA-T7-M4 | M4.H19 | pwa | `src/lib/markdown.tsx` | `highlighters.createStore(highlighters.chat, 'chat')` (in `ChatMarkdown`) → `highlighters.createStore(highlighters.docs, 'chat')` | `test/chat-hardening.test.tsx` | 1 failed — `'M4.H19 (chat half): chat\'s requests go to the chat highlighter, never the Docs one, and chat prewarms it on mount'` |
| W5HA-T7-M5 | M4.H16 | pwa | `src/lib/markdown.tsx` | `return <code className="hljs">{raw}</code>;` (in `HighlightedCode`) → `return null;` (hide the block while pending) | `test/highlight-wiring.test.tsx` | 2 failed — `'a Docs page\'s block: plain, same text and label, until the worker answers; then spans, text unchanged'`; `'a text leaf: plain first, then coloured, on the Docs highlighter'` (chat's M4.C4 cases red with it in `chat-hardening.test.tsx`, which this row does not run) |
| W5HA-T7-M6 | (h) | pwa | `src/docs/DocMarkdown.tsx` | `highlighters.publish?.(store);` → removed | `test/highlight-wiring.test.tsx` | 1 failed — `'a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount'` |
| W5HA-T7-M7 | (p) | pwa | `src/lib/markdown.tsx` | `useEffect(() => { highlighters.chat.prewarm(); }, [highlighters.chat]);` → removed | `test/chat-hardening.test.tsx` | 1 failed — `'M4.H19 (chat half): chat\'s requests go to the chat highlighter, never the Docs one, and chat prewarms it on mount'` (its prewarm assertion) |
| W5HA-T7-M8 | §4.10 | pwa | `src/screens/DocsScreen.tsx` | `highlighters.docs.prewarm();` → removed | `test/highlight-wiring.test.tsx` | 1 failed — `'the Docs screen prewarms the Docs highlighter on mount'` |
| W5HA-T7-M9 | M4.H7 | pwa | `src/lib/markdown.tsx` | `not highlighted (took over ` → `not highlighted (took longer than ` (in `codeBlockLabel`) | `test/highlight-wiring.test.tsx` | 1 failed — `'M4.H7: of three blocks whose second times out, the first and third are coloured and only the second is plain'` |
| W5HA-T7-M10 | M4.H13 | pwa | `src/lib/markdown.tsx` | `not highlighted (output too large)` → `not highlighted (too large)` | `test/highlight-wiring.test.tsx` | 1 failed — `'M4.H13: an answer over the per-block HTML cap, whose line retry is too large as well, says "output too large"'` |
| W5HA-T7-M11 | M4.H18 | pwa | `src/lib/markdown.tsx` | `· highlighted line by line` → `· highlighted by lines` | `test/highlight-wiring.test.tsx` | 1 failed — `'M4.H18: a block that timed out and was coloured by its line retry says "highlighted line by line"'` |
| W5HA-T7-M12 | (r) | pwa | `src/lib/markdown.tsx` | `const unshow = store.show(key);` → `const unshow = (): void => undefined;` (the block never shows its key) | `test/chat-hardening.test.tsx` | 1 failed — `'refinement (r): in the debounce window the block shows its new key, so the message\'s store is not settled'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/chat-hardening.test.tsx test/highlight-wiring.test.tsx test/docs-screen.test.tsx )` — all passed; `TSC-OK`.

### Task 8: The scans and the built chunk (M4.H4, M4.H15's scan half, M4.H17, M7.11, M4.H22's use sites, M4.H3's store control; refinement (f))

**Model routing:** `sonnet`, effort `high`. The judgment is in the scans' homes and their planted controls, and in the built marker rule that admits the reader's render chunk and nothing else.

**Spec rows:** §4.10 Guards (the main thread; the one sink; the test store's seam), "The second chunk"; §7.9's W5h-a built-chunk and precache steps; M4.H4, M4.H15, M4.H17, M7.11.

**Files:**
- Modify: `pwa/test/docs-scans.test.ts` (one appended clause), `pwa/test/markdown-worker-built.test.ts` (one appended describe), `pwa/test/highlight-wiring.test.tsx` (one appended describe), `pwa/test/markdown-limits.test.ts` (one appended describe: M4.H22's "a literal at a use site"), `pwa/test/markdown-runner.test.ts` (one case in its source pins: M4.H3's control planted in the store).
- Guards (not edited): `pwa/test/reader-built.test.ts`, `pwa/test/fonts-built.test.ts`, `pwa/vite.config.ts` (its `globPatterns` already precaches every emitted `.js`; nothing to add).

**Decisions this task makes:** (1) The chain of homes is checked as imports, not as a closure: `highlight.js` only in `lib/highlightGrammars.ts`, that module only from `lib/highlightJob.ts`, that one only from `lib/markdownHighlightWorker.ts`, and the entry from nobody; with M4.H3's closure, that is "no module outside the worker's closure reaches highlight.js". (2) The sink scan accepts exactly one shape, `{ __html: x.html }` inside `HighlightedCode`, where that function passes `x` to `isCheckedHighlightHtml`. (3) The built marker is `did you forget to load/include a language module?` (refinement (f)); the rule admits `markdownHighlightWorker-*.js` (required) and `readerRenderJob-*.js` (the library's renderer, the parse worker's lazy chunk) and nothing else.

- [ ] **Step 0:** `test -f pwa/src/lib/highlighterContext.ts && ! git grep -q "from 'highlight.js" HEAD -- pwa/src/lib/markdown.tsx && git grep -q "const MESSAGE_ASSIGN_HOMES" HEAD -- pwa/test/docs-scans.test.ts && grep -q "did you forget to load/include a language module?" pwa/node_modules/highlight.js/lib/core.js && echo T8-BASE-OK`. (If the marker is absent from the installed core, stop and ask: refinement (f) needs another string, picked from that file.) Claim `docs-scans.test.ts` and `markdown-worker-built.test.ts`; check Share's clause in `docs-scans.test.ts` (append after whichever is last). Record both files' counts.
- [ ] **Step 1: Append the clause to `pwa/test/docs-scans.test.ts`:**
  ```ts

  // ---------------------------------------------------------------------------------------------------------------
  // Clause W5h-a (native Docs reader, W5h-a Task 8; base spec 2026-10-01 section 4.10's Guards; M4.H4, M4.H15's scan
  // half, M4.H17's seam half). Across `pwa/src`, read with TypeScript's parser:
  //   - a `highlight.js` specifier (any import or export form, `import()` and `import('x').T` included) sits only in
  //     `lib/highlightGrammars.ts`; `lib/highlightGrammars` is imported only by `lib/highlightJob.ts`, `lib/highlightJob`
  //     only by `lib/markdownHighlightWorker.ts`, and `lib/markdownHighlightWorker` by nothing (it is spawned by URL), so
  //     no main-thread module reaches highlight.js (M4.H4; the built half is `markdown-worker-built.test.ts`'s);
  //   - nothing imports a module under `pwa/test`, the test store above all (M4.H17);
  //   - exactly one `dangerouslySetInnerHTML` JSX attribute, in `lib/markdown.tsx`'s `HighlightedCode`, whose value is
  //     `{ __html: <name>.html }` for a `<name>` that function passes to `isCheckedHighlightHtml` (M4.H15). Export's
  //     `<style>` exception joins this clause, with its planted control, when Export lands.
  // NOT EXHAUSTIVE. Known evasions: a specifier built at run time or reached through `require`, `eval` or a re-export
  // from outside `pwa/src`; HTML written through the DOM (`innerHTML`, `outerHTML`, `insertAdjacentHTML`: none in
  // `pwa/src`, which review lens 1 reads for); a checked value's `html` read through an alias before the sink. The
  // behavioural halves are `highlight-html.test.tsx` (a forged value renders plain) and `highlight-wiring.test.tsx`
  // (the context's default is production).
  // ---------------------------------------------------------------------------------------------------------------

  /** Each link of the highlight worker's chain, base-relative without an extension, and the one file that may import it
   *  (`null`: none may). */
  const HIGHLIGHT_CHAIN: ReadonlyArray<readonly [string, string | null]> = [
    ['src/lib/highlightGrammars', 'src/lib/highlightJob.ts'],
    ['src/lib/highlightJob', 'src/lib/markdownHighlightWorker.ts'],
    ['src/lib/markdownHighlightWorker', null],
  ];
  const HLJS_HOME = 'src/lib/highlightGrammars.ts';

  /** Where a sink is and whether it has the one allowed shape: `<file> <function> ok|bad`. */
  function sinkVerdict(attr: ts.JsxAttribute, file: string): string {
    let fn: ts.Node | undefined = attr.parent;
    while (fn !== undefined && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
    const name = fn !== undefined && ts.isFunctionDeclaration(fn) && fn.name !== undefined ? fn.name.text : '(none)';
    const expr = attr.initializer !== undefined && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
    let ok = false;
    if (fn !== undefined && expr !== undefined && ts.isObjectLiteralExpression(expr) && expr.properties.length === 1) {
      const prop = expr.properties[0]!;
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === '__html'
        && ts.isPropertyAccessExpression(prop.initializer) && prop.initializer.name.text === 'html'
        && ts.isIdentifier(prop.initializer.expression)) {
        const held = prop.initializer.expression.text;
        const look = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'isCheckedHighlightHtml'
            && n.arguments.length === 1 && ts.isIdentifier(n.arguments[0]!) && (n.arguments[0] as ts.Identifier).text === held) ok = true;
          ts.forEachChild(n, look);
        };
        look(fn);
      }
    }
    return `${file} ${name} ${ok ? 'ok' : 'bad'}`;
  }

  /** The findings in one module: its forbidden imports (`<file> <rule>`) and its sinks. */
  function scanHighlightFile(source: string, file: string): { hits: string[]; sinks: string[] } {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const hits: string[] = [];
    const sinks: string[] = [];
    for (const use of moduleUses(sf)) {
      if (use.specifier === 'highlight.js' || use.specifier.startsWith('highlight.js/')) {
        if (file !== HLJS_HOME) hits.push(`${file} highlight.js:import`);
        continue;
      }
      const target = relativeTarget(file, use.specifier);
      if (target === undefined) continue;
      if (target === 'test' || target.startsWith('test/')) hits.push(`${file} test:import`);
      for (const [module, home] of HIGHLIGHT_CHAIN) {
        if (target === module && file !== home) hits.push(`${file} ${module.slice('src/lib/'.length)}:import`);
      }
    }
    const visit = (n: ts.Node): void => {
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'dangerouslySetInnerHTML') sinks.push(sinkVerdict(n, file));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return { hits, sinks };
  }

  /** The scan over every `.ts` and `.tsx` file under `<base>/src`, named relative to `base`. */
  function highlightScan(base: string): { files: string[]; hits: string[]; sinks: string[] } {
    const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
    const found = files.map((rel) => scanHighlightFile(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel));
    return { files, hits: found.flatMap((f) => f.hits), sinks: found.flatMap((f) => f.sinks) };
  }

  describe('clause W5h-a: highlight.js stays in the worker, one checked sink, no test seam in pwa/src (M4.H4, M4.H15, M4.H17)', () => {
    const copies: string[] = [];
    afterAll(() => { for (const dir of copies) rmSync(dir, { recursive: true, force: true }); });
    /** A fresh copy of `pwa/src` with `edit` applied to one file (created when absent); returns the copy's base. */
    function planted(rel: string, edit: (old: string) => string): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-w5ha-'));
      copies.push(dir);
      cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
      const file = path.join(dir, ...rel.split('/'));
      let old = '';
      try { old = readFileSync(file, 'utf8'); } catch { /* a new file */ }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, edit(old));
      return dir;
    }
    const append = (text: string) => (old: string): string => old + text;

    it('M4.H4: highlight.js and the worker chain sit only in their homes across pwa/src', () => {
      const { files, hits } = highlightScan(PWA);
      expect(files).toEqual(expect.arrayContaining(['src/lib/highlightGrammars.ts', 'src/lib/highlightJob.ts', 'src/lib/markdown.tsx']));
      expect(readFileSync(path.join(SRC_DIR, 'lib', 'highlightGrammars.ts'), 'utf8')).toContain("from 'highlight.js/lib/core'");
      expect(hits.filter((h) => !h.endsWith('test:import'))).toEqual([]);
    });

    it('M4.H17: nothing under pwa/src imports from pwa/test', () => {
      expect(highlightScan(PWA).hits.filter((h) => h.endsWith('test:import'))).toEqual([]);
    });

    it('M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode', () => {
      expect(highlightScan(PWA).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok']);
    });

    it('M4.H4 planted: highlight.js imported in lib/markdown.tsx is red', () => {
      const dir = planted('src/lib/markdown.tsx', append("\nimport plantedHljs from 'highlight.js/lib/core';\nexport const plantedH = plantedHljs;\n"));
      expect(highlightScan(dir).hits).toEqual(['src/lib/markdown.tsx highlight.js:import']);
    });

    it('M4.H4 planted: highlightGrammars imported in DocsLeaf, and the worker entry imported by the runner, are red', () => {
      const leaf = planted('src/docs/DocsLeaf.tsx', append("\nimport { HLJS as plantedG } from '../lib/highlightGrammars';\nexport const plantedGr = plantedG;\n"));
      expect(highlightScan(leaf).hits).toEqual(['src/docs/DocsLeaf.tsx highlightGrammars:import']);
      const runner = planted('src/lib/markdownRunner.ts', append("\nimport './markdownHighlightWorker';\n"));
      expect(highlightScan(runner).hits).toEqual(['src/lib/markdownRunner.ts markdownHighlightWorker:import']);
    });

    it('M4.H17 planted: the test store imported from pwa/src is red', () => {
      const dir = planted('src/lib/markdown.tsx', append("\nimport { SYNC_HIGHLIGHT } from '../../test/highlightTestStore';\nexport const plantedSync = SYNC_HIGHLIGHT;\n"));
      expect(highlightScan(dir).hits).toEqual(['src/lib/markdown.tsx test:import']);
    });

    it('M4.H15 planted: a second sink under lib/ or under docs/export/ is red', () => {
      const lib = planted('src/lib/markdown.tsx', append('\nexport function PlantedSink(p: { h: string }) { return <i dangerouslySetInnerHTML={{ __html: p.h }} />; }\n'));
      expect(highlightScan(lib).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedSink bad']);
      const exp = planted('src/docs/export/buildExport.tsx', append("export function Planted() { return <style dangerouslySetInnerHTML={{ __html: 'a{}' }} />; }\n"));
      expect(highlightScan(exp).sinks).toContain('src/docs/export/buildExport.tsx Planted bad');
    });

    it('M4.H15 planted: the sink fed the raw string, unchecked, is red', () => {
      const dir = planted('src/lib/markdown.tsx', (old) => old.replace('__html: checked.html', '__html: raw'));
      expect(highlightScan(dir).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode bad']);
    });
  });
  ```
  (Every name it uses beyond its own, `moduleUses`, `relativeTarget`, `sourceFiles`, `SRC_DIR`, `PWA`, `ts`, `os`, `path`, `cpSync`, `mkdtempSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, `rmSync`, `afterAll`, is already at the file's module scope at BASE.)
- [ ] **Step 2: Append to `pwa/test/markdown-worker-built.test.ts`:**
  ```ts

  // Docs W5h-a Task 8 (base spec 2026-10-01 section 7.10's M7.11 and section 4.10's M4.H4, built half; the W5h-a
  // plan's refinement (f)). The production build emits the highlight worker as its own chunk; a plain node child with no
  // DOM loads it, sees `{ready: true}`, and gets spans for a typescript job; the built `sw.js` precaches it beside the
  // parse worker's chunk; highlight.js core (named by a string from its language-not-found message) is in that chunk
  // and in the reader's render chunk (the shared Markdown library's own colouring, A6 and A22), and in no other emitted
  // file, so in no main-thread chunk. And `pwa/src` spawns it through one literal.
  const HL_LOADER = `
  import { pathToFileURL } from 'node:url';
  const [chunk] = process.argv.slice(1);
  const replies = [];
  globalThis.self = { postMessage: (r) => replies.push(r) };
  const report = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  try {
    await import(pathToFileURL(chunk).href);
  } catch (e) {
    report({ load: 'threw', name: e?.name, message: String(e?.message).slice(0, 200), document: typeof document });
    process.exit(0);
  }
  if (typeof self.onmessage !== 'function') { report({ load: 'no-onmessage', replies }); process.exit(0); }
  const ready = replies.splice(0);
  self.onmessage({ data: { id: 3, lang: 'typescript', code: 'const a: number = 1;' } });
  report({ load: 'ok', document: typeof document, window: typeof window, ready, replies });
  `;

  describe('the built highlight worker chunk (W5h-a: M7.11, M4.H4 built half)', () => {
    const assets = (): string => path.join(out, 'assets');
    const MARKER = 'did you forget to load/include a language module?';
    const precached = (): string[] => {
      const manifest = /precacheAndRoute\(\[(.*?)\],/s.exec(readFileSync(path.join(out, 'sw.js'), 'utf8'));
      expect(manifest, 'sw.js calls precacheAndRoute with a manifest').not.toBeNull();
      return [...manifest![1]!.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
    };

    it('M7.11: exactly one markdownHighlightWorker chunk; it loads with no DOM, says ready, and answers a typescript job with spans', () => {
      const chunks = readdirSync(assets()).filter((n) => /^markdownHighlightWorker-[\w-]+\.js$/.test(n));
      expect(chunks).toHaveLength(1);
      const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', HL_LOADER, path.join(assets(), chunks[0]!)],
        { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' }, timeout: 60_000 });
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!) as {
        load: string; document?: string; window?: string; ready?: unknown[];
        replies?: { id: number; result: { kind: string; mode?: string; html?: string } }[];
      };
      expect(result).toMatchObject({ load: 'ok', document: 'undefined', window: 'undefined', ready: [{ ready: true }] });
      expect(result.replies).toHaveLength(1);
      expect(result.replies![0]).toMatchObject({ id: 3, result: { kind: 'html', mode: 'block' } });
      expect(result.replies![0]!.result.html).toContain('<span class="hljs-keyword">const</span>');
    }, 90_000);

    it('M7.11: sw.js precaches the highlight worker chunk beside the parse worker\'s', () => {
      const urls = precached();
      expect(urls.filter((u) => /^assets\/markdownHighlightWorker-[\w-]+\.js$/.test(u))).toHaveLength(1);
      expect(urls.filter((u) => /^assets\/markdownWorker-[\w-]+\.js$/.test(u))).toHaveLength(1);
    });

    it('M4.H4 (built): highlight.js core is in the highlight worker\'s chunk, may be in the reader\'s render chunk, and is in no other file', () => {
      const files = readdirSync(assets()).filter((n) => n.endsWith('.js'));
      const holders = files.filter((n) => readFileSync(path.join(assets(), n), 'utf8').includes(MARKER));
      expect(holders.filter((n) => /^markdownHighlightWorker-[\w-]+\.js$/.test(n))).toHaveLength(1);
      expect(holders.filter((n) => !/^(?:markdownHighlightWorker|readerRenderJob)-[\w-]+\.js$/.test(n))).toEqual([]);
    });

    it('M7.11: pwa/src holds exactly one new URL(\'./markdownHighlightWorker.ts\' literal, in spawnHighlightWorker; a second is counted', () => {
      const SRC = path.join(PWA, 'src');
      const literal = "new URL('./markdownHighlightWorker.ts'";
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
      const count = (texts: readonly string[]): number => texts.reduce((n, t) => n + t.split(literal).length - 1, 0);
      const texts = walk(SRC).map((f) => readFileSync(f, 'utf8'));
      expect(count(texts)).toBe(1);
      const runner = readFileSync(path.join(SRC, 'lib', 'markdownRunner.ts'), 'utf8');
      expect(runner.slice(runner.indexOf('export function spawnHighlightWorker'))).toContain(literal);
      expect(count([...texts, `export const planted = () => new Worker(${literal}, import.meta.url));`])).toBe(2);
    });
  });
  ```
- [ ] **Step 3: Append to `pwa/test/highlight-wiring.test.tsx`:**
  ```tsx

  describe('M4.H17: the seam\'s default is production', () => {
    it('HighlighterContext\'s default holds docsHighlighter, chatHighlighter and the production createStore, and no publish slot', () => {
      let seen: HighlighterContextValue | undefined;
      function Probe(): ReactNode {
        seen = useContext(HighlighterContext);
        return null;
      }
      render(<Probe />);
      expect(seen).toBe(HIGHLIGHTER_DEFAULT);
      expect(HIGHLIGHTER_DEFAULT.docs).toBe(docsHighlighter);
      expect(HIGHLIGHTER_DEFAULT.chat).toBe(chatHighlighter);
      expect(HIGHLIGHTER_DEFAULT.createStore).toBe(createProductionStore);
      expect(HIGHLIGHTER_DEFAULT.publish).toBeUndefined();
    });
  });
  ```
  with `useContext` from react, `HIGHLIGHTER_DEFAULT` and `createProductionStore` from `highlighterContext`, and `chatHighlighter`, `docsHighlighter` from `markdownRunner` added to its imports.
- [ ] **Step 3a: Append to `pwa/test/markdown-limits.test.ts`** (M4.H22's "a literal at a use site", which the declared-once scan cannot see):
  ```ts

  // Docs W5h-a Task 8 (base spec 2026-10-01 section 7.10's M4.H22, its mutation "a literal at a use site"): each new limit
  // reaches its consumer by name, imported from `./markdownLimits`, and its value is not spelled as a number there. Read
  // with TypeScript's parser. NOT EXHAUSTIVE: a value built from pieces, or spelled in a consumer not listed here, is not
  // seen; the values 2 and 256 are too common to scan for, so `HIGHLIGHT_PAGE_MAX_TIMEOUTS`, `HIGHLIGHT_LINE_RETRY_UNITS`
  // and `HIGHLIGHT_CACHE_MAX_ENTRIES` are checked by import only.
  const USE_SITES: Readonly<Record<string, readonly string[]>> = {
    'markdownRunner.ts': ['HIGHLIGHT_BLOCK_DEADLINE_MS', 'HIGHLIGHT_BOOT_BUDGET_MS'],
    'highlightJob.ts': ['MD_HIGHLIGHT_MAX_HTML_CHARS', 'HIGHLIGHT_LINE_RETRY_UNITS', 'HIGHLIGHT_CACHE_MAX_ENTRIES', 'HIGHLIGHT_CACHE_MAX_CHARS'],
    'highlightStore.ts': [
      'HIGHLIGHT_PAGE_WORKER_MS', 'HIGHLIGHT_PAGE_MAX_TIMEOUTS', 'MD_HIGHLIGHT_MAX_HTML_CHARS',
      'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS', 'HIGHLIGHT_STREAM_DEBOUNCE_MS', 'HIGHLIGHT_LINE_RETRY_UNITS',
    ],
  };

  describe('M4.H22: the new limits reach their consumers by name (W5h-a)', () => {
    it.each(Object.entries(USE_SITES))('%s imports its limits from ./markdownLimits and spells none of their values', (file, names) => {
      const sf = ts.createSourceFile(file, readFileSync(path.join(PWA, 'src', 'lib', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const imported = new Set<string>();
      const numbers = new Set<number>();
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === './markdownLimits'
          && n.importClause?.namedBindings !== undefined && ts.isNamedImports(n.importClause.namedBindings)) {
          for (const el of n.importClause.namedBindings.elements) imported.add(el.name.text);
        }
        if (ts.isNumericLiteral(n)) numbers.add(Number(n.text.replaceAll('_', '')));
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const name of names) {
        expect(imported.has(name), `${file} imports ${name}`).toBe(true);
        const value = VALUES[name]!;
        if (value !== 2 && value !== 256) expect(numbers.has(value), `${file} spells ${name}'s value, ${value}`).toBe(false);
      }
    });
  });
  ```
- [ ] **Step 3b: Append one case inside `pwa/test/markdown-runner.test.ts`'s `describe('source pins', …)`**, after its last case (M4.H3's control planted in the store itself, now that the store and the context exist):
  ```ts
    it('M4.H3: the scan reads the store and the context, and a postMessage or a message listener planted in the store is red', () => {
      expect(MARKDOWN_FILES).toEqual(expect.arrayContaining(['highlightStore.ts', 'highlighterContext.ts']));
      expect(postsOrReceives(read('highlightStore.ts'))).toBe(false);
      const planted = `${read('highlightStore.ts')}\nself.postMessage(1);\nself.addEventListener('message', () => undefined);\n`;
      expect(postsOrReceives(planted)).toBe(true);
      expect(addsMessageListener(planted)).toBe(true);
    });
  ```
- [ ] **Step 4: Run.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/highlight-wiring.test.tsx test/markdown-limits.test.ts test/markdown-runner.test.ts )` and `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone — all green (these pin what Tasks 3-7 built; their red is measured by the rows below, each applied to the code they guard). `( cd pwa && ./node_modules/.bin/vitest run test/reader-built.test.ts )` and `test/fonts-built.test.ts`, each alone — unchanged, green. Record the measured chunk names.
- [ ] **Step 5: Commit.** 5 files by name, message `pwa: highlight.js stays in its worker chunk, one checked sink, no test seam in src (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T8-M1 | M4.H4 | pwa | `src/lib/markdown.tsx` | `import '../session/chat.css';` → `import '../session/chat.css';\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedVersion = plantedCore.versionString;` | `test/docs-scans.test.ts` | 1+ failed — `'M4.H4: highlight.js and the worker chain sit only in their homes across pwa/src'` (the planted cases that compare a copy's exact hit list red with it: the markdown.tsx, DocsLeaf/runner and M4.H17 plants, about 4 in all) |
| W5HA-T8-M2 | M4.H4 | pwa | `src/lib/markdown.tsx` | `import '../session/chat.css';` → `import '../session/chat.css';\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedVersion = plantedCore.versionString;` (W5HA-T8-M1's edit) | `test/markdown-worker-built.test.ts` | 1 failed — `'M4.H4 (built): highlight.js core is in the highlight worker\'s chunk, may be in the reader\'s render chunk, and is in no other file'` |
| W5HA-T8-M3 | M4.H15 | pwa | `src/lib/markdown.tsx` | `dangerouslySetInnerHTML={{ __html: checked.html }}` → `dangerouslySetInnerHTML={{ __html: raw }}` | `test/docs-scans.test.ts` | 1+ failed — `'M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode'` (with it `'M4.H15 planted: a second sink under lib/ or under docs/export/ is red'`, which expects `HighlightedCode ok` first: 2 in all) |
| W5HA-T8-M4 | M7.11 | pwa | `vite.config.ts` | `globIgnores: ['**/mermaid.frame-*.js'],` → `globIgnores: ['**/mermaid.frame-*.js', '**/markdownHighlightWorker-*.js'],` | `test/markdown-worker-built.test.ts` | 1 failed — `'M7.11: sw.js precaches the highlight worker chunk beside the parse worker\'s'` |
| W5HA-T8-M5 | M7.11 | pwa | `src/lib/markdownHighlightWorker.ts` | `const answer = createHighlightAnswerer();` → `void document.title;\nconst answer = createHighlightAnswerer();` | `test/markdown-worker-built.test.ts` | 1 failed — `'M7.11: exactly one markdownHighlightWorker chunk; it loads with no DOM, says ready, and answers a typescript job with spans'` |
| W5HA-T8-M6 | M7.11 | pwa | `src/lib/markdownRunner.ts` | `export const chatHighlighter: Highlighter = createHighlighter();` → that line, then `export const plantedSpawn = () => new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' });` | `test/markdown-worker-built.test.ts` | 1 failed — `'M7.11: pwa/src holds exactly one new URL(\'./markdownHighlightWorker.ts\' literal, in spawnHighlightWorker; a second is counted'` |
| W5HA-T8-M7 | M4.H17 | pwa | `src/lib/highlighterContext.ts` | `docs: docsHighlighter, chat: chatHighlighter, createStore: createProductionStore,` → `docs: docsHighlighter, chat: chatHighlighter, createStore: (h, mode) => createProductionStore(h, mode),` | `test/highlight-wiring.test.tsx` | 1 failed — `'HighlighterContext\'s default holds docsHighlighter, chatHighlighter and the production createStore, and no publish slot'` |
| W5HA-T8-M8 | M4.H17 | pwa | `test/docs-scans.test.ts` | `if (target === 'test' \|\| target.startsWith('test/')) hits.push(` → `if (target === 'tests') hits.push(` | `test/docs-scans.test.ts` | 1 failed — `'M4.H17 planted: the test store imported from pwa/src is red'` |
| W5HA-T8-M9 | M4.H22 | pwa | `src/lib/markdownRunner.ts` | `const deadlineMs = deps.deadlineMs ?? HIGHLIGHT_BLOCK_DEADLINE_MS;` → `const deadlineMs = deps.deadlineMs ?? 750;` | `test/markdown-limits.test.ts` | 1 failed — the `markdownRunner.ts` case of `'%s imports its limits from ./markdownLimits and spells none of their values'` |
| W5HA-T8-M10 | M4.H3 | pwa | `test/markdown-runner.test.ts` | `const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^(?:markdown\|highlight).*\.tsx?$/.test(f)).sort();` → `const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^(?:markdown\|highlightJob\|highlightGrammars).*\.tsx?$/.test(f)).sort();` (the scan no longer reads the store or the context) | `test/markdown-runner.test.ts` | 1 failed — `'M4.H3: the scan reads the store and the context, and a postMessage or a message listener planted in the store is red'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/highlight-wiring.test.tsx )`; `test/markdown-worker-built.test.ts` alone — all passed.

### Task 9: R19's measurement page behind the session gate (§7.8 R19, M7.12; refinements (i), (k), (q))

**Model routing:** `sonnet`, effort `high`. The judgment is in keeping the page small and honest: it measures what W5h-b needs, names nothing private, reads and never writes, and is safe to leave shipped.

**Spec rows:** §7.8 R19 (the page; who opens it; how it measures; items 1-8; what it decides); §4.1's R19 row; §4.10 "The third and fourth singletons" (`spawnHighlightWorker` reused, never a second literal); M7.11 (its planted second literal), M7.12.

**Files:**
- Create: `pwa/src/screens/HighlightMeasure.tsx`, `pwa/src/screens/highlightMeasureRun.tsx`, `pwa/test/highlight-measure.test.tsx`.
- Modify: `pwa/src/lib/routes.ts` (one row), `pwa/src/app.tsx` (one import, one ladder rung), `pwa/test/app.test.tsx` (`PROBES` gains the path; one case), `pwa/test/command-layer.test.tsx` (the Settings Go-to count and name, in place), `pwa/test/command-registry.test.ts` (its Go-to oracle widened in place to `GO_TO`'s own rule, one helper, one case; its two cases that pin the base commands' ids taught the new command, in place), `pwa/test/docs-scans.test.ts` (one appended clause), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C9 Docs row's `pwa/src` cell of its ring-context-map table gains the two page modules).
- Guards (not edited): `server/test/rings/totality.test.ts` (ARCH-04: every `pwa/src` file takes exactly one context from that table), `pwa/test/screens-back-edges.test.ts`, `pwa/test/page-scaffold.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/control-census.test.ts`, `pwa/test/role-census.test.ts`, `pwa/test/shape-census.test.ts`, `pwa/test/design-system-boundary.test.ts`, `pwa/test/tap-targets.test.tsx`, `server/test/auth-gate.test.ts` (no route is added, so its census is unchanged).

**Interfaces:**
- Consumes `api.docs` (`pwa/src/lib/api.ts`; its `projects`, `tree` and `file` only), `docsRunner.parse`, `createHighlighter` (whose default spawn is `spawnHighlightWorker`), `createHighlightStore`, `codeBlocksOf`, `checkHighlightHtml`, `HIGHLIGHT_GRAMMARS`, `grammarOf`, `isRegisteredGrammar`, `HighlighterContext`, `HighlightedCode`, `ChatMarkdown`, `DocMarkdown`, `docMarkdownSource`, `createFetchQueue`, `contentClass` (`shared/docs.ts`), `PageScaffold` and `Button` (`@ccrc/ui`).
- Produces: `MeasureDeps`, `MeasureResult`, `runHighlightMeasure(deps, progress)`, `formatMeasureResult(result)`, `CRAFTED_SHAPES`, `MEASURE_DEADLINE_MS`, `MEASURE_CANDIDATE_DEBOUNCES`, `MEASURE_SETTLE_CADENCES_MS`, `MEASURE_TEXT` (all in `highlightMeasureRun.tsx`); `HighlightMeasure` (the screen); the route `{ id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' }`.

**Decisions this task makes (refinements (i) and (q)):** (1) The route sits under Settings so the palette offers it ("Go to Settings › Measure highlighting") and a phone can reach it without typing a URL; its id does not start with `settings-`, so the ladder renders the page, not the Settings frame. (2) The corpus is every committed Markdown file of every `ready` project's default view, read through `projects`, `tree` and `file` at `DOCS_PWA_FETCH_CONCURRENCY` (`createFetchQueue()`'s default), parsed on the page's parser with `DOCS_PARSE_BUDGET_LARGE_MS`, its blocks by `codeBlocksOf`, those of a registered grammar within `MD_HIGHLIGHT_BLOCK_MAX_CHARS` kept. One project at a time, one document's text held at a time beyond the project's batch. (3) Items 1-5 and 8 run with `MEASURE_DEADLINE_MS = 60000`, no ceilings and none of part 1's bounds (their stores pass `{ part1: false, ceilings: false }`; items 1-3 post directly). Items 6 and 7 run with the shipped deadline and boot budget, item 7 under the shipped ceilings with `part1: false` (refinement (k)). (4) Item 2's boot is a fresh highlighter's first-call-to-post time: the page's first highlighter is "cold", and each grammar's cold-block highlighter of item 1 gives a "respawn" boot. (5) Item 5's page is the one with the most code among documents at most `DOCS_RENDER_GATE_BYTES`, rendered through `DocMarkdown`, so it is what a reader sees. (6) Item 8 streams at each of `MEASURE_SETTLE_CADENCES_MS = [50, 100, 250]` and, at each, tries `MEASURE_CANDIDATE_DEBOUNCES = [0, 150, 250, 400]`; it reports no settle gaps, which would be its own sleep (refinement (q), a departure: BASE has no fixed chat settle cadence, so W5h-b sets `HIGHLIGHT_STREAM_DEBOUNCE_MS` from the table across cadences). (7) The result is JSON (`r19: 1`), names no project, path, file or code, and describes the device only by `navigator.hardwareConcurrency`. (8) The page has a Stop that aborts the run; unmounting aborts it too. (9) The result is one `<figure>`: the caption "Result" and a `<pre>` of the JSON, which the `Select result` button (`@ccrc/ui`'s `Button`) selects whole; the page draws no hand-drawn control (control-census), adds no class or stylesheet, and writes no clipboard (M7.12). (10) The census and architecture suites pass in this task (the coordinator's ruling): the two modules take file rows in the 08-10 spec's C9 Docs cell (they read Docs and nothing else), and `command-registry.test.ts`'s oracle is widened to `GO_TO`'s own rule (a page under a top route, whatever its id) rather than renaming the id, whose `settings-` prefix would make the ladder draw the Settings frame.

- [ ] **Step 0:** `git grep -q "{ id: 'settings-section', pattern:" HEAD -- pwa/src/lib/routes.ts && git grep -q "  ) : route === 'digest' ? (" HEAD -- pwa/src/app.tsx && git grep -q "expect(screen.getAllByRole('option', { name: /^Go to Settings/ })).toHaveLength(6);" HEAD -- pwa/test/command-layer.test.tsx && git grep -q "export const DOCS_PWA_FETCH_CONCURRENCY = 2;" HEAD -- pwa/src/docs/fetchQueue.ts && git grep -qF "const offered = ROUTES.filter((r) => r.path !== null && (r.top || r.id.startsWith('settings-')));" HEAD -- pwa/test/command-registry.test.ts && git grep -qF ".filter((id) => id !== 'toggle-inspector');" HEAD -- pwa/test/command-registry.test.ts && git grep -qF '| C9 Docs | `docs/**` | `docs/**`, `screens/DocsScreen.tsx` |' HEAD -- docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md && echo T9-BASE-OK`. Claim `routes.ts`, `app.tsx`, `app.test.tsx`, `command-layer.test.tsx`, `command-registry.test.ts`, `docs-scans.test.ts` and the 08-10 spec. Record the counts of `app.test.tsx`, `command-layer.test.tsx`, `command-registry.test.ts`, `server/test/rings/totality.test.ts` and each census suite above.
- [ ] **Step 1: Write `pwa/test/highlight-measure.test.tsx`:**
  ```tsx
  // R19's measurement page (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19, M7.12's behavioural
  // half). The driver runs on fakes: a one-project corpus through injected loaders, the parse in-thread, in-thread
  // highlighters (and, for the shipped deadline, one that times out at once), a counting clock and an immediate frame,
  // so it measures nothing real; the cases pin its shape, that it reads only, and that its result names nothing
  // private. The page is opened once, on the operator's phone, after W5h-a is deployed.
  import { afterEach, describe, expect, it } from 'vitest';
  import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
  import type { Highlighter } from '../src/lib/highlightProtocol';
  import { HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS } from '../src/lib/markdownLimits';
  import { parseMarkdown } from '../src/lib/markdownParse';
  import { HighlightMeasure } from '../src/screens/HighlightMeasure';
  import {
    MEASURE_CANDIDATE_DEBOUNCES, MEASURE_SETTLE_CADENCES_MS, MEASURE_TEXT, formatMeasureResult, runHighlightMeasure, type MeasureDeps,
  } from '../src/screens/highlightMeasureRun';
  import { entry, fakeLoaders, fileResponse, okTree, treeOk } from './docsFixtures';
  import { inThreadHighlighter } from './highlightTestStore';

  afterEach(cleanup);

  const SECRET = 'const secretValue = 1;';
  const DOC = `# Notes\n\n\`\`\`ts\n${SECRET}\n\`\`\`\n\n\`\`\`json\n{"a": 1}\n\`\`\`\n`;

  /** A highlighter that answers every job `timeout` as soon as it is posted (the shipped deadline, on a slow phone). */
  const timingOut = (): Highlighter => ({
    highlight: async (_r, o) => { o.onPosted?.(); return { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }; },
    status: () => 'live',
    prewarm: () => undefined,
  });

  function fakes(over: Partial<MeasureDeps> = {}) {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'secret-plan.md'), entry('plans', 'b.md'), entry('specs', 'c.ts')] })), file: { s: 'ok', value: fileResponse(DOC) } });
    f.projects.mockResolvedValue({ s: 'ok', value: { ok: true, cacheAgeMs: null, index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 1, unlisted: 0, duplicates: [], projects: [{ project: 'demo', state: 'ready', github: null }] } } } as never);
    let t = 0;
    const host = document.createElement('div');
    document.body.append(host);
    const deps: MeasureDeps = {
      loaders: f.loaders,
      parse: async (src) => parseMarkdown(src, 'docs'),
      highlighter: (deadlineMs) => (deadlineMs === HIGHLIGHT_BLOCK_DEADLINE_MS ? timingOut() : inThreadHighlighter()),
      now: () => (t += 1),
      frame: async () => t,
      sleep: async () => undefined,
      host,
      signal: new AbortController().signal,
      hardwareConcurrency: 8,
      ...over,
    };
    return { f, deps };
  }

  describe('R19: the driver', () => {
    it('reads the corpus through projects, tree and file only, and never asks for a refresh', async () => {
      const { f, deps } = fakes();
      const r = await runHighlightMeasure(deps, () => undefined);
      expect(f.projects).toHaveBeenCalledTimes(1);
      expect(f.tree).toHaveBeenCalledWith('demo', null);
      expect(f.file).toHaveBeenCalledTimes(2);
      expect(f.refresh).not.toHaveBeenCalled();
      expect(f.raster).not.toHaveBeenCalled();
      expect(r.corpus).toEqual({ projects: 1, docs: 2, unreadDocs: 0, blocks: 4 });
    });

    it('answers every item, by grammar, with the shipped values and section 4.10\'s sum for Export\'s wait', async () => {
      const { deps } = fakes();
      const r = await runHighlightMeasure(deps, () => undefined);
      expect(r.r19).toBe(1);
      expect(r.item1.byGrammar.map((g) => g.grammar).sort()).toEqual(['json', 'typescript']);
      expect(r.item1.byGrammar.find((g) => g.grammar === 'typescript')).toMatchObject({ blocks: 2, cold: { chars: SECRET.length } });
      expect(r.item2.coldMs).not.toBeNull();
      expect(r.item4.blocks).toBeGreaterThan(0);
      expect(r.item6.map((s) => s.outcome).every((o) => o === 'timeout')).toBe(true);
      expect(r.item7.sumMs).toBe(HIGHLIGHT_PAGE_WORKER_MS + HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * HIGHLIGHT_BOOT_BUDGET_MS);
      expect(r.item7.entries.length).toBe(8);
      expect(Object.keys(r.item8)).toEqual(['byCadence']);
      expect(r.item8.byCadence.map((c) => c.settleMs)).toEqual([...MEASURE_SETTLE_CADENCES_MS]);
      for (const c of r.item8.byCadence) expect(c.byDebounce.map((d) => d.debounceMs)).toEqual([...MEASURE_CANDIDATE_DEBOUNCES]);
      expect(r.shipped).toMatchObject({ HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS });
    }, 60_000);

    it('its text is JSON that names no project, path, file or code', async () => {
      const { deps } = fakes();
      const text = formatMeasureResult(await runHighlightMeasure(deps, () => undefined));
      expect(JSON.parse(text)).toMatchObject({ r19: 1 });
      for (const word of ['demo', 'secret-plan', 'b.md', 'secretValue', 'Notes', 'specs', 'plans']) expect(text, word).not.toContain(word);
    }, 60_000);

    it('an abort stops the run', async () => {
      const ctl = new AbortController();
      ctl.abort();
      const { deps } = fakes({ signal: ctl.signal });
      await expect(runHighlightMeasure(deps, () => undefined)).rejects.toBeDefined();
    });
  });

  describe('R19: the page', () => {
    it('Start runs the measurement and shows its result as text, which Select result selects whole', async () => {
      const { deps } = fakes();
      render(<HighlightMeasure deps={deps} />);
      expect(screen.getByRole('heading', { level: 1, name: 'Measure highlighting' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
      const caption = await waitFor(() => screen.getByText(MEASURE_TEXT.result), { timeout: 60_000 });
      const pre = caption.closest('figure')?.querySelector('pre') ?? null;
      expect(pre).not.toBeNull();
      expect(JSON.parse(pre!.textContent ?? '')).toMatchObject({ r19: 1 });
      expect(document.querySelector('textarea, input')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.select }));
      const selection = window.getSelection();
      expect(selection?.anchorNode).toBe(pre);
      expect(selection?.focusOffset).toBe(pre!.childNodes.length);
    }, 90_000);
  });
  ```
- [ ] **Step 2: Append the M7.12 clause to `pwa/test/docs-scans.test.ts`:**
  ```ts

  // Clause W5h-a, M7.12 (base spec 2026-10-01 section 7.10): R19's page only reads. In its two modules, read with
  // TypeScript's parser: no `.refresh(` call, no `fetch(` (bare or as a member), no `localStorage`, `sessionStorage` or
  // `indexedDB`, no `clipboard` member, no import of `lib/storage`, and every member read of the `api` import is `docs`.
  // NOT EXHAUSTIVE: a call through an alias (`const r = loaders.refresh`), a computed member, and anything reached
  // through `any` or `eval` are not seen; the driver's own test asserts the fake loaders' `refresh` is never called.
  const MEASURE_MODULES: readonly string[] = ['src/screens/HighlightMeasure.tsx', 'src/screens/highlightMeasureRun.tsx'];

  function measureFindings(source: string, file: string): string[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const out: string[] = [];
    for (const use of moduleUses(sf)) if (relativeTarget(file, use.specifier) === 'src/lib/storage') out.push(`${file} storage`);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (memberName(callee) === 'refresh') out.push(`${file} refresh`);
        if ((ts.isIdentifier(callee) && callee.text === 'fetch') || memberName(callee) === 'fetch') out.push(`${file} fetch`);
      }
      if (ts.isIdentifier(n) && ['localStorage', 'sessionStorage', 'indexedDB'].includes(n.text)) out.push(`${file} storage`);
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'clipboard') out.push(`${file} clipboard`);
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'api' && n.name.text !== 'docs') out.push(`${file} api`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  describe('clause W5h-a, M7.12: R19\'s measurement page only reads', () => {
    const read = (rel: string): string => readFileSync(path.join(PWA, ...rel.split('/')), 'utf8');

    it('its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs', () => {
      expect(read('src/screens/HighlightMeasure.tsx')).toContain('api.docs');
      expect(MEASURE_MODULES.flatMap((f) => measureFindings(read(f), f))).toEqual([]);
    });

    it.each([
      ['a refresh call', 'export const planted = (l: { refresh(p: string): void }) => l.refresh("x");', 'refresh'],
      ['a fetch of its own', "export const planted = () => fetch('/api/x');", 'fetch'],
      ['a storage write', "export const planted = () => localStorage.setItem('k', 'v');", 'storage'],
      ['a clipboard write', "export const planted = () => navigator.clipboard.writeText('x');", 'clipboard'],
      ['another api read', "import { api } from '../lib/api';\nexport const planted = () => api.sessions;", 'api'],
      ['the storage owner', "import { pageStorage } from '../lib/storage';\nexport const planted = pageStorage;", 'storage'],
    ])('planted: %s in the run module is red', (_name, text, rule) => {
      const file = 'src/screens/highlightMeasureRun.tsx';
      expect(measureFindings(`${read(file)}\n${text}\n`, file)).toEqual([`${file} ${rule}`]);
    });
  });
  ```
  (`unwrap` and `memberName` are the file's module-scope helpers at BASE. If `lib/storage.ts` exports no `pageStorage`, the planted line names any export it has: the rule reads the specifier, not the name.)
- [ ] **Step 3: Edit the route table and its tests.**
  - `pwa/test/app.test.tsx`: in `PROBES`, after `'/settings/security', '/settings/bogus', '/settings/a/b',` add `'/settings/measure-highlighting',`; append inside `describe('ROUTES and the ladder, both ways', …)`:
    ```tsx
    it('`/settings/measure-highlighting` renders R19\'s measurement page, not the Settings frame (W5h-a)', () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      try {
        navigate('/settings/measure-highlighting');
        render(<App />);
        const detail = document.querySelector('.shell-detail')!;
        expect(within(detail as HTMLElement).getByRole('heading', { level: 1, name: 'Measure highlighting' })).toBeInTheDocument();
        expect(within(detail as HTMLElement).queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
    ```
  - `pwa/test/command-layer.test.tsx`, in the case whose name begins `"the palette's Go-to list offers Settings › Updates and the others`: after its `for` loop add `expect(screen.getByRole('option', { name: /^Go to Settings › Measure highlighting/ })).toBeTruthy();`, and `toHaveLength(6)` → `toHaveLength(7)` with the comment `// Settings itself, its five pages and R19's measurement page (W5h-a): nothing for the catch-all row.` replacing the comment above it.
  - `pwa/test/command-registry.test.ts` (the coordinator's ruling: the new route passes BASE's registry oracle in this task). Before `describe('the base commands', () => {`, add:
    ```ts
    /** GO_TO's rule for a row that is not top (W5h-a): its path sits under a top row's path other than `/`, whatever its
     *  id. R19's measurement page, `measure-highlighting` at `/settings/measure-highlighting`, is the first such row
     *  whose id does not start `settings-`. */
    const underTop = (routes: readonly { readonly top: boolean; readonly path: string | null }[], p: string): boolean =>
      routes.some((t) => t.top && t.path !== null && t.path !== '/' && p.startsWith(`${t.path}/`));

    ```
    In `'every Go to command targets a route app.tsx routes: the top rows of ROUTES, the ladder\'s one table'`, `const offered = ROUTES.filter((r) => r.path !== null && (r.top || r.id.startsWith('settings-')));` → `const offered = ROUTES.filter((r) => r.path !== null && (r.top || underTop(ROUTES, r.path)));`, with `// From W5h-a, GO_TO's own rule (underTop): a page under a top route is offered whatever its id.` as a new comment line above it. After that case's closing `});` (the case ending `for (const go of GO_TO) expect(ids.has(go.id), go.id).toBe(true);`), add:
    ```ts

      it('offers R19\'s measurement page under Settings, and the oracle\'s rule admits a planted page under a top route and none under no top route (W5h-a)', () => {
        expect(GO_TO.find((g) => g.id === 'go-measure-highlighting')?.title).toBe('Go to Settings › Measure highlighting');
        expect(underTop(ROUTES, '/settings/planted')).toBe(true);
        expect(underTop(ROUTES, '/planted/page')).toBe(false);
        expect(underTop(ROUTES.filter((r) => r.path !== '/settings'), '/settings/planted')).toBe(false);
      });
    ```
    `baseCommands()` spreads `GO_TO`, so the route's command also reaches BASE's two cases that pin the base commands' ids. Untouched, both would stay green here and go red at Step 4; taught the command now, both are red here and green at Step 4:
    - In `'every base command carries the id docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md §The door table names'`: Find ``      'go-settings-security',\n      // W2 Task S2d:`` (two lines, the file's indentation; the one place that line ends the Settings pages of the door list) → Replace with ``      'go-settings-security',\n      // Docs W5h-a Task 9: R19's measurement page, a page under Settings; its door is the palette's Go to.\n      'go-measure-highlighting',\n      // W2 Task S2d:``.
    - In `'entries with no terms, tier or searchOnly rank exactly as before'`: `.filter((id) => id !== 'toggle-inspector');` → `.filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting');`, with `// W5h-a reads the table without go-measure-highlighting the same way; its own rank row and place are pinned below.` as a new comment line above `const ranked`; and after the case's last line, `expect(empty[empty.indexOf('toggle-inspector') + 1]).toBe('switch-layout');`, add:
      ```ts
          // W5h-a: the one command whose title holds "measure", placed right after Settings' five pages.
          expect(rankCommands('measure', baseCommands()).map((c) => c.id)).toEqual(['go-measure-highlighting']);
          expect(empty.indexOf('go-measure-highlighting'), 'after Settings\' five pages').toBe(empty.indexOf('go-settings-security') + 1);
      ```
      (No other base command's title holds m, e, a, s, u, r, e in that order: checked against `commands.ts`'s titles at BASE.)
  Run `( cd pwa && ./node_modules/.bin/vitest run test/highlight-measure.test.tsx test/app.test.tsx test/command-layer.test.tsx test/command-registry.test.ts test/docs-scans.test.ts )` — Expected red, and only these: `highlight-measure` fails to import; the new route case (`PROBES`' existing case stays green: at BASE the `settings-section` row matches the new probe both ways); the palette case; `command-registry`'s new case, its door-table case and its ranked case (each names `go-measure-highlighting`, which no command has yet; the widened oracle's case stays green, because no BASE row with a path sits under a top route without a `settings-` id); the M7.12 clause (its modules are absent: ENOENT). Record them; a different red set is a stop-and-ask.
- [ ] **Step 4: Implement.**
  - `routes.ts`: after the `...SETTINGS_SECTIONS.map(…)` spread and before the `settings-section` row (whose pattern would match the path first), add:
    ```ts
      // R19's measurement page (W5h-a; base spec 2026-10-01 section 7.8): under Settings so the palette offers it ("Go to
      // Settings › Measure highlighting") on a phone; its id is not `settings-…`, so the ladder renders the page itself.
      { id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },
    ```
  - `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, in its ring-context-map table, the C9 Docs row ``| C9 Docs | `docs/**` | `docs/**`, `screens/DocsScreen.tsx` |``: its `pwa/src` cell gains `` , `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` `` after `` `screens/DocsScreen.tsx` `` (ARCH-04's totality: every `pwa/src` file takes exactly one context; the page reads Docs and nothing else). Done after the two modules exist, since a row that names no file reds the same test as stale. Then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/totality.test.ts )` — green.
  - `app.tsx`: `import { HighlightMeasure } from './screens/HighlightMeasure';` beside the other screen imports; in the ladder, Find `  ) : route === 'digest' ? (\n    <DigestScreen day={digestDay} />` → Replace with the same two lines followed by `  ) : route === 'measure-highlighting' ? (\n    <HighlightMeasure />`.
  - `pwa/src/screens/highlightMeasureRun.tsx`:
    ```tsx
    // R19's measurements (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19; the W5h-a plan's
    // refinements (i) and (k)). `runHighlightMeasure` runs the eight items on the shipped highlight worker chunk, each
    // through highlighters of its own (`deps.highlighter`, which the page builds with `createHighlighter`, so every worker
    // is spawned by `spawnHighlightWorker`: never a second `new Worker` literal), and answers one `MeasureResult`, which
    // `formatMeasureResult` turns into the page's text. It reads documents only through the docs loaders' `projects`,
    // `tree` and `file` (never `refresh`), at the Docs screen's fetch concurrency; it stores and sends nothing and writes
    // no clipboard (M7.12). The result names no project, path, file or code: a block is its grammar, its length, an
    // ordinal. Items, as section 7.8 numbers them:
    //   1. every block of the corpus, one per job, on a warm highlighter (MEASURE_DEADLINE_MS, no ceilings, none of part
    //      1's bounds): time by grammar; then each grammar's largest block first on a fresh highlighter (cold);
    //   2. boot: a fresh highlighter's first call (which spawns) to its post (after `{ready}`): the page's first, cold;
    //      the cold-block highlighters of item 1, after a respawn;
    //   3. HTML characters per input character, by grammar, on the corpus (item 1's figures) and the crafted shapes;
    //   4. checking and inserting DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS of real answers through the one sink, and layout;
    //   5. the largest real page within the render gate, through `DocMarkdown`: plain first frame to last block coloured;
    //   6. part 1's crafted shapes under the SHIPPED deadline: outcome, time, the longest main-thread frame gap;
    //   7. eight crafted blocks under the SHIPPED ceilings, none of part 1's bounds: the wait to settled, against section
    //      4.10's sum for Export's longest wait;
    //   8. a `ChatMarkdown` streamed at each of MEASURE_SETTLE_CADENCES_MS and, at each, for each candidate debounce:
    //      the requests the growing block made and the time from its fence closing to its colours. No settle gaps: they
    //      would be this page's own sleep (BASE has no fixed chat settle cadence; the W5h-a plan's refinement (q)).
    //
    // Ring L4: it renders, schedules and measures; the decisions are the store's and the runner's.
    import { flushSync } from 'react-dom';
    import { createRoot } from 'react-dom/client';
    import { contentClass, type DocPin, type DocsTreeOk } from '../../../shared/docs';
    import type { DocLinkContextValue } from '../docs/DocLink';
    import { DocMarkdown, docMarkdownSource } from '../docs/DocMarkdown';
    import type { DocsLoaders } from '../docs/failures';
    import { createFetchQueue } from '../docs/fetchQueue';
    import { HIGHLIGHT_GRAMMARS, grammarOf, isRegisteredGrammar } from '../lib/highlightNames';
    import type { Highlighter, HighlightOutcome } from '../lib/highlightProtocol';
    import {
      checkHighlightHtml, codeBlocksOf, createHighlightStore, type CodeBlockText, type HighlightClock, type HighlightEntry, type HighlightStore,
    } from '../lib/highlightStore';
    import { HighlighterContext, type HighlighterContextValue } from '../lib/highlighterContext';
    import { ChatMarkdown, HighlightedCode } from '../lib/markdown';
    import { utf8ByteLength } from '../lib/markdownGuard';
    import {
      DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_RENDER_GATE_BYTES, HIGHLIGHT_BLOCK_DEADLINE_MS,
      HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS, HIGHLIGHT_STREAM_DEBOUNCE_MS,
      MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
    } from '../lib/markdownLimits';
    import type { MarkdownParser } from '../lib/markdownRunner';

    /** R19's measurement-only deadline: well above any candidate value, so a slow block is timed, not cut off. */
    export const MEASURE_DEADLINE_MS = 60000;
    /** Item 8's candidate debounces. */
    export const MEASURE_CANDIDATE_DEBOUNCES: readonly number[] = [0, 150, 250, 400];
    /** Item 8's settle cadences (refinement (q)): BASE has no fixed chat settle cadence, so item 8 runs at three, and
     *  W5h-b reads its debounce off the table across them. */
    export const MEASURE_SETTLE_CADENCES_MS: readonly number[] = [50, 100, 250];

    export interface MeasureDeps {
      readonly loaders: Pick<DocsLoaders, 'projects' | 'tree' | 'file'>;
      readonly parse: MarkdownParser;
      /** A fresh highlighter with this deadline (each call a new worker). */
      readonly highlighter: (deadlineMs: number) => Highlighter;
      readonly now: () => number;
      /** The next animation frame's time. */
      readonly frame: () => Promise<number>;
      readonly sleep: (ms: number) => Promise<void>;
      /** Where items 4, 5 and 8 render: laid out, off screen. */
      readonly host: HTMLElement;
      readonly signal: AbortSignal;
      readonly hardwareConcurrency: number | null;
    }

    export interface GrammarFigures {
      readonly grammar: string;
      readonly blocks: number;
      readonly chars: number;
      readonly warmMs: { readonly p50: number; readonly p95: number; readonly max: number };
      readonly cold: { readonly chars: number; readonly ms: number } | null;
      readonly htmlRatio: { readonly p95: number; readonly max: number };
      /** Blocks the worker did not answer as HTML (too large, threw, unregistered). */
      readonly notHtml: number;
    }

    export interface MeasureResult {
      readonly r19: 1;
      readonly device: { readonly hardwareConcurrency: number | null };
      readonly shipped: Readonly<Record<string, number>>;
      readonly corpus: { readonly projects: number; readonly docs: number; readonly unreadDocs: number; readonly blocks: number };
      readonly item1: { readonly byGrammar: readonly GrammarFigures[]; readonly slowest: readonly { readonly grammar: string; readonly chars: number; readonly ms: number }[] };
      readonly item2: { readonly coldMs: number | null; readonly respawnMs: readonly number[] };
      readonly item3: { readonly crafted: readonly { readonly shape: string; readonly ratio: number | null }[] };
      readonly item4: { readonly blocks: number; readonly htmlChars: number; readonly checkMs: number; readonly insertAndLayoutMs: number };
      readonly item5: { readonly blocks: number; readonly codeChars: number; readonly firstFrameToColouredMs: number | null };
      readonly item6: readonly { readonly shape: string; readonly grammar: string; readonly chars: number; readonly outcome: string; readonly ms: number; readonly longestFrameGapMs: number }[];
      readonly item7: { readonly waitMs: number | null; readonly sumMs: number; readonly withinSum: boolean | null; readonly entries: readonly string[] };
      readonly item8: { readonly byCadence: readonly { readonly settleMs: number; readonly byDebounce: readonly { readonly debounceMs: number; readonly requests: number; readonly closeToColouredMs: number | null }[] }[] };
    }

    /** `unit` repeated to `chars` characters, broken into lines of `line` characters (0: one line). */
    function shape(unit: string, chars: number, line: number): string {
      const body = unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
      return line === 0 ? body : (body.match(new RegExp(`[^]{1,${line}}`, 'g')) ?? []).join('\n').slice(0, chars);
    }
    const BLOCK = 65000;
    const LS = String.fromCharCode(0x2028);
    /** W5 part 1's crafted shapes, from `markdownLimits.ts`'s notes, each in its grammar, under the block cap. */
    export const CRAFTED_SHAPES: readonly { readonly name: string; readonly lang: string; readonly code: string }[] = [
      { name: 'markdown-link-openers', lang: 'markdown', code: shape('[](', BLOCK, 2048) },
      { name: 'yaml-flow', lang: 'yaml', code: shape('[]', BLOCK, 2048) },
      { name: 'ts-tags', lang: 'typescript', code: shape('<a>', BLOCK, 1800) },
      { name: 'rust-raw-string', lang: 'rust', code: shape('r#"', BLOCK, 1800) },
      { name: 'ts-newlines', lang: 'typescript', code: `a${'\n'.repeat(BLOCK - 2)}b` },
      { name: 'ts-line-separators', lang: 'typescript', code: shape(`${LS}\n`, BLOCK, 0) },
      { name: 'php-identifier', lang: 'php', code: shape('_é', BLOCK, 0) },
      { name: 'ts-identifier', lang: 'typescript', code: shape('a', 32768, 0) },
      { name: 'markdown-bracket-line', lang: 'markdown', code: shape('[', BLOCK, 0) },
      { name: 'yaml-words-line', lang: 'yaml', code: shape('a ', BLOCK, 0) },
      { name: 'xml-script-lines', lang: 'xml', code: shape('<script>\n', BLOCK, 0) },
    ];

    const round = (n: number): number => Math.round(n * 10) / 10;
    function pct(xs: readonly number[], p: number): number {
      if (xs.length === 0) return 0;
      const s = [...xs].sort((a, b) => a - b);
      return round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
    }
    const clockOf = (deps: MeasureDeps): HighlightClock => ({
      now: deps.now, setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (h) => window.clearTimeout(h as number),
    });

    /** One block posted; its outcome and its worker time, post to answer. */
    async function timed(deps: MeasureDeps, h: Highlighter, lang: string, code: string): Promise<{ outcome: HighlightOutcome; ms: number; postedAt: number }> {
      let postedAt = Number.NaN;
      const outcome = await h.highlight({ lang, code }, { signal: deps.signal, onPosted: () => { postedAt = deps.now(); } });
      return { outcome, ms: round(deps.now() - postedAt), postedAt };
    }

    /** The time `test` first holds, checked once a frame, or `null` past `capMs`. */
    async function until(deps: MeasureDeps, test: () => boolean, capMs: number): Promise<number | null> {
      const start = deps.now();
      while (deps.now() - start < capMs) {
        deps.signal.throwIfAborted();
        if (test()) return deps.now();
        await deps.frame();
      }
      return null;
    }

    /** The longest gap between animation frames while `during` runs. */
    async function longestGap(deps: MeasureDeps, during: Promise<unknown>): Promise<number> {
      let done = false;
      void during.finally(() => { done = true; });
      let last = await deps.frame();
      let gap = 0;
      while (!done) {
        const t = await deps.frame();
        gap = Math.max(gap, t - last);
        last = t;
      }
      return round(gap);
    }

    interface Page { readonly text: string; readonly codeChars: number; readonly blocks: number; readonly link: Omit<DocLinkContextValue, 'urls'> }

    /** Reads the corpus, one project at a time, its files through the fetch queue, and hands each parsed document's
     *  blocks to `onDoc`. */
    async function readCorpus(
      deps: MeasureDeps, progress: (line: string) => void,
      onDoc: (blocks: readonly CodeBlockText[], text: string, link: Omit<DocLinkContextValue, 'urls'>) => Promise<void>,
    ): Promise<{ projects: number; docs: number; unreadDocs: number }> {
      const index = await deps.loaders.projects();
      if (index.s !== 'ok') throw new Error(`the docs index answered ${index.s}`);
      const ready = index.value.index.projects.filter((p) => p.state === 'ready');
      const queue = createFetchQueue();
      let docs = 0;
      let unreadDocs = 0;
      for (const p of ready) {
        deps.signal.throwIfAborted();
        const answer = await deps.loaders.tree(p.project, null);
        if (answer.s !== 'ok') continue;
        const tree: DocsTreeOk = answer.value.tree;
        const pins = tree.entries
          .filter((e) => contentClass(e.path) === 'markdown' && (e.committed?.kind === 'file' || e.committed?.kind === 'exec'))
          .map((e): DocPin => ({ kind: 'committed', commit: tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path }));
        const texts = await Promise.all(pins.map((pin) => queue.run(async (signal) => {
          const f = await deps.loaders.file(p.project, pin, signal);
          if (f.s !== 'ok') return null;
          const src = docMarkdownSource(f.value.show);
          return src.kind === 'markdown' ? { pin, text: src.text } : null;
        }, deps.signal)));
        for (const t of texts) {
          if (t === null) { unreadDocs += 1; continue; }
          const parsed = await deps.parse(t.text, { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS, signal: deps.signal });
          if (parsed.kind !== 'tree') { unreadDocs += 1; continue; }
          docs += 1;
          await onDoc(codeBlocksOf(parsed.tree), t.text, {
            project: p.project, pageRef: null, view: 'effective', section: t.pin.section, path: t.pin.path, tree,
            pageSource: 'committed', onFragment: () => undefined,
          });
          progress(`Item 1: ${docs} documents read`);
        }
      }
      return { projects: ready.length, docs, unreadDocs };
    }

    const PLAIN: HighlightEntry = { kind: 'plain', first: { kind: 'malformed' }, retry: null };

    export async function runHighlightMeasure(deps: MeasureDeps, progress: (line: string) => void): Promise<MeasureResult> {
      deps.signal.throwIfAborted();
      // Items 1-3: the corpus, warm, after one tiny job per grammar (the first of which boots: item 2, cold).
      const warm = deps.highlighter(MEASURE_DEADLINE_MS);
      const created = deps.now();
      let coldMs: number | null = null;
      for (const g of HIGHLIGHT_GRAMMARS) {
        const r = await timed(deps, warm, g, 'x');
        if (coldMs === null) coldMs = round(r.postedAt - created);
      }
      const stats = new Map<string, { ms: number[]; ratios: number[]; chars: number; notHtml: number; largest: string }>();
      const slowest: { grammar: string; chars: number; ms: number }[] = [];
      const kept: { raw: string; html: string }[] = [];
      let keptChars = 0;
      let blocks = 0;
      let page: Page | null = null;
      const corpus = await readCorpus(deps, progress, async (docBlocks, text, link) => {
        let codeChars = 0;
        let docCount = 0;
        for (const b of docBlocks) {
          const grammar = grammarOf(b.lang);
          if (grammar === null || !isRegisteredGrammar(b.lang) || b.raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) continue;
          blocks += 1;
          docCount += 1;
          codeChars += b.raw.length;
          const s = stats.get(grammar) ?? { ms: [], ratios: [], chars: 0, notHtml: 0, largest: '' };
          stats.set(grammar, s);
          const r = await timed(deps, warm, b.lang, b.raw);
          s.ms.push(r.ms);
          s.chars += b.raw.length;
          if (b.raw.length > s.largest.length) s.largest = b.raw;
          if (r.outcome.kind === 'html') {
            if (b.raw.length > 0) s.ratios.push(r.outcome.html.length / b.raw.length);
            if (keptChars + r.outcome.html.length <= DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS) {
              kept.push({ raw: b.raw, html: r.outcome.html });
              keptChars += r.outcome.html.length;
            }
          } else {
            s.notHtml += 1;
          }
          slowest.push({ grammar, chars: b.raw.length, ms: r.ms });
          slowest.sort((x, y) => y.ms - x.ms);
          slowest.length = Math.min(slowest.length, 20);
        }
        if (utf8ByteLength(text) <= DOCS_RENDER_GATE_BYTES && (page === null || codeChars > page.codeChars)) {
          page = { text, codeChars, blocks: docCount, link };
        }
      });
      // Item 1, cold; item 2, boots after a respawn.
      const cold = new Map<string, { chars: number; ms: number }>();
      const respawnMs: number[] = [];
      for (const [grammar, s] of stats) {
        progress(`Item 1: ${grammar}, cold`);
        const fresh = deps.highlighter(MEASURE_DEADLINE_MS);
        const at = deps.now();
        const r = await timed(deps, fresh, grammar, s.largest);
        respawnMs.push(round(r.postedAt - at));
        cold.set(grammar, { chars: s.largest.length, ms: r.ms });
      }
      const byGrammar: GrammarFigures[] = [...stats].map(([grammar, s]) => ({
        grammar, blocks: s.ms.length, chars: s.chars,
        warmMs: { p50: pct(s.ms, 0.5), p95: pct(s.ms, 0.95), max: pct(s.ms, 1) },
        cold: cold.get(grammar) ?? null,
        htmlRatio: { p95: pct(s.ratios, 0.95), max: pct(s.ratios, 1) },
        notHtml: s.notHtml,
      }));
      // Item 4: check, insert and lay out a page's worth of real answers through the one sink.
      progress('Item 4');
      const t0 = deps.now();
      const checked = kept.map((k) => ({ raw: k.raw, checked: k.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS ? null : checkHighlightHtml(k.html) }));
      const t1 = deps.now();
      const root4 = createRoot(deps.host);
      flushSync(() => root4.render(
        <>{checked.map((c, i) => <pre key={i}><HighlightedCode entry={c.checked === null ? PLAIN : { kind: 'html', mode: 'block', checked: c.checked }} raw={c.raw} /></pre>)}</>,
      ));
      void deps.host.offsetHeight;
      const t2 = deps.now();
      root4.unmount();
      // Item 5: the largest real page through DocMarkdown, no ceilings, no part-1 bounds.
      progress('Item 5');
      let firstFrameToColouredMs: number | null = null;
      const largest = page as Page | null;
      if (largest !== null) {
        const h5 = deps.highlighter(MEASURE_DEADLINE_MS);
        let published: HighlightStore | null = null;
        const ctx: HighlighterContextValue = {
          docs: h5, chat: h5, publish: (s) => { published = s; },
          createStore: (h, mode) => createHighlightStore(h, { mode, part1: false, ceilings: false }, clockOf(deps)),
        };
        const root5 = createRoot(deps.host);
        root5.render(<HighlighterContext value={ctx}><DocMarkdown text={largest.text} pinKey="r19" parser={deps.parse} link={largest.link} /></HighlighterContext>);
        const first = await until(deps, () => deps.host.querySelector('article') !== null, MEASURE_DEADLINE_MS);
        const coloured = await until(deps, () => (published as HighlightStore | null)?.settled() === true, MEASURE_DEADLINE_MS * 4);
        firstFrameToColouredMs = first === null || coloured === null ? null : round(coloured - first);
        root5.unmount();
      }
      // Items 6 and 3 (crafted): the shipped deadline.
      const item6: MeasureResult['item6'][number][] = [];
      const crafted: { shape: string; ratio: number | null }[] = [];
      const shipped = deps.highlighter(HIGHLIGHT_BLOCK_DEADLINE_MS);
      for (const s of CRAFTED_SHAPES) {
        progress(`Item 6: ${s.name}`);
        const job = timed(deps, shipped, s.lang, s.code);
        const gap = await longestGap(deps, job);
        const r = await job;
        item6.push({ shape: s.name, grammar: s.lang, chars: s.code.length, outcome: r.outcome.kind, ms: r.ms, longestFrameGapMs: gap });
        crafted.push({ shape: s.name, ratio: r.outcome.kind === 'html' ? round(r.outcome.html.length / s.code.length) : null });
      }
      // Item 7: eight crafted blocks under the shipped ceilings, none of part 1's bounds.
      progress('Item 7');
      const sumMs = HIGHLIGHT_PAGE_WORKER_MS + HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * HIGHLIGHT_BOOT_BUDGET_MS;
      const store7 = createHighlightStore(deps.highlighter(HIGHLIGHT_BLOCK_DEADLINE_MS), { mode: 'docs', part1: false }, clockOf(deps));
      const blocks7 = CRAFTED_SHAPES.slice(0, 8).map((s, i) => ({ lang: s.lang, raw: `${s.code.slice(0, BLOCK - 4)}\n${i}` }));
      store7.seed(blocks7);
      const keys7 = blocks7.map((b) => store7.keyOf(b.lang, b.raw)).flatMap((k) => (k.kind === 'key' ? [k.key] : []));
      const start7 = deps.now();
      const releases = keys7.map((k) => store7.request(k));
      const settled7 = await until(deps, () => store7.settled(), 2 * sumMs);
      const entries7 = keys7.map((k) => store7.peek(k).kind);
      releases.forEach((release) => release());
      const waitMs = settled7 === null ? null : round(settled7 - start7);
      // Item 8: a streamed chat message, at each settle cadence and, at each, for each candidate debounce.
      const LINES = Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i}, "x${i}");`);
      const full = LINES.join('\n');
      const byCadence: MeasureResult['item8']['byCadence'][number][] = [];
      for (const settleMs of MEASURE_SETTLE_CADENCES_MS) {
        const byDebounce: MeasureResult['item8']['byCadence'][number]['byDebounce'][number][] = [];
        for (const d of MEASURE_CANDIDATE_DEBOUNCES) {
          progress(`Item 8: every ${settleMs} ms, debounce ${d} ms`);
          const inner = deps.highlighter(MEASURE_DEADLINE_MS);
          let requests = 0;
          const counting: Highlighter = {
            highlight: (r, o) => { if (r.code.startsWith(LINES[0]!)) requests += 1; return inner.highlight(r, o); },
            status: () => inner.status(), prewarm: () => inner.prewarm(),
          };
          const ctx: HighlighterContextValue = {
            docs: counting, chat: counting,
            createStore: (h, mode) => createHighlightStore(h, { mode, part1: false, ceilings: false, debounceMs: d }, clockOf(deps)),
          };
          const root8 = createRoot(deps.host);
          const show = (text: string): void => {
            flushSync(() => root8.render(<HighlighterContext value={ctx}><ChatMarkdown text={text} /></HighlighterContext>));
          };
          for (let n = 1; n <= LINES.length; n += 1) {
            show(`Working on it.\n\n\`\`\`ts\n${LINES.slice(0, n).join('\n')}`);
            await deps.sleep(settleMs);
          }
          show(`Working on it.\n\n\`\`\`ts\n${full}\n\`\`\`\n\nDone.`);
          const closedAt = deps.now();
          const colouredAt = await until(deps, () => {
            const code = deps.host.querySelector('code.hljs');
            return code !== null && code.textContent === full && code.querySelector('[class^="hljs-"]') !== null;
          }, 10 * HIGHLIGHT_STREAM_DEBOUNCE_MS + MEASURE_DEADLINE_MS);
          root8.unmount();
          byDebounce.push({ debounceMs: d, requests, closeToColouredMs: colouredAt === null ? null : round(colouredAt - closedAt) });
        }
        byCadence.push({ settleMs, byDebounce });
      }
      progress('Done');
      return {
        r19: 1,
        device: { hardwareConcurrency: deps.hardwareConcurrency },
        shipped: {
          HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_WORKER_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS,
          MD_HIGHLIGHT_MAX_HTML_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, HIGHLIGHT_STREAM_DEBOUNCE_MS,
        },
        corpus: { ...corpus, blocks },
        item1: { byGrammar, slowest: slowest.map((s) => ({ ...s })) },
        item2: { coldMs, respawnMs },
        item3: { crafted },
        item4: { blocks: checked.length, htmlChars: keptChars, checkMs: round(t1 - t0), insertAndLayoutMs: round(t2 - t1) },
        item5: { blocks: largest?.blocks ?? 0, codeChars: largest?.codeChars ?? 0, firstFrameToColouredMs },
        item6,
        item7: { waitMs, sumMs, withinSum: waitMs === null ? null : waitMs <= sumMs, entries: entries7 },
        item8: { byCadence },
      };
    }

    /** The page's text: the result as indented JSON, which a tap selects whole. */
    export function formatMeasureResult(r: MeasureResult): string {
      return JSON.stringify(r, null, 2);
    }

    /** What the page shows while it measures and after (kept here, beside the run, for the page to import). */
    export const MEASURE_TEXT = {
      title: 'Measure highlighting',
      intro: 'Times this device\'s highlight worker on the Docs you can read, once, for the next release\'s values. Keep the screen on and the app in front until it says Done; then select the result and copy it, or take a screenshot, and send it on. It saves and sends nothing itself.',
      start: 'Start',
      stop: 'Stop',
      starting: 'Starting…',
      done: 'Done.',
      result: 'Result',
      select: 'Select result',
    } as const;
    ```
    (`utf8ByteLength` is `markdownGuard.ts`'s, as `DocMarkdown` imports it.)
  - `pwa/src/screens/HighlightMeasure.tsx`:
    ```tsx
    // R19's measurement page (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19; the route
    // `/settings/measure-highlighting`, the W5h-a plan's refinement (i)). Reached only inside the signed-in console:
    // every read goes through `api.docs`, whose 401 raises the login overlay. Start runs `runHighlightMeasure` once;
    // Stop aborts it, and so does leaving the page. The result is shown as text in one `<pre>`, which the Select result
    // button selects whole, so the page draws no hand-drawn control. It stores and sends nothing and writes no clipboard
    // (M7.12, `docs-scans.test.ts`).
    //
    // Ring L4: a screen.
    import { useEffect, useRef, useState, type ReactNode } from 'react';
    import { Button, PageScaffold } from '@ccrc/ui';
    import { api } from '../lib/api';
    import { createHighlighter, docsRunner } from '../lib/markdownRunner';
    import { MEASURE_TEXT, formatMeasureResult, runHighlightMeasure, type MeasureDeps } from './highlightMeasureRun';

    type State =
      | { readonly s: 'idle' }
      | { readonly s: 'running'; readonly line: string }
      | { readonly s: 'done'; readonly text: string }
      | { readonly s: 'failed'; readonly why: string };

    export function HighlightMeasure(p: { readonly deps?: Partial<MeasureDeps> }): ReactNode {
      const host = useRef<HTMLDivElement | null>(null);
      const running = useRef<AbortController | null>(null);
      const result = useRef<HTMLPreElement | null>(null);
      const [state, setState] = useState<State>({ s: 'idle' });
      useEffect(() => () => running.current?.abort(), []);
      const start = (): void => {
        const ctl = new AbortController();
        running.current = ctl;
        setState({ s: 'running', line: MEASURE_TEXT.starting });
        const deps: MeasureDeps = {
          loaders: api.docs,
          parse: (src, o) => docsRunner.parse(src, o),
          highlighter: (deadlineMs) => createHighlighter({ deadlineMs }),
          now: () => performance.now(),
          frame: () => new Promise((resolve) => { requestAnimationFrame(resolve); }),
          sleep: (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }),
          host: host.current!,
          signal: ctl.signal,
          hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
          ...p.deps,
        };
        runHighlightMeasure(deps, (line) => setState({ s: 'running', line })).then(
          (r) => setState({ s: 'done', text: formatMeasureResult(r) }),
          (e: unknown) => setState(ctl.signal.aborted ? { s: 'idle' } : { s: 'failed', why: e instanceof Error ? e.message : String(e) }),
        );
      };
      return (
        <PageScaffold title={MEASURE_TEXT.title}>
          <p>{MEASURE_TEXT.intro}</p>
          {state.s === 'running'
            ? <Button onClick={() => running.current?.abort()}>{MEASURE_TEXT.stop}</Button>
            : <Button onClick={start}>{MEASURE_TEXT.start}</Button>}
          <p aria-live="polite">{state.s === 'running' ? state.line : state.s === 'failed' ? state.why : state.s === 'done' ? MEASURE_TEXT.done : ''}</p>
          {state.s === 'done' && (
            <>
              <Button onClick={() => { if (result.current !== null) window.getSelection()?.selectAllChildren(result.current); }}>{MEASURE_TEXT.select}</Button>
              <figure>
                <figcaption>{MEASURE_TEXT.result}</figcaption>
                <pre ref={result}>{state.text}</pre>
              </figure>
            </>
          )}
          <div ref={host} aria-hidden="true" className="sr-only" />
        </PageScaffold>
      );
    }
    ```
    The host uses the shell's one visually-hidden utility (`sr-only`, `pwa/src/styles/base.css`): laid out (so `offsetHeight` forces layout), clipped, and adding no class or stylesheet. Read against BASE's censuses: `markup-census` counts a block only when a class hooks it and a leaf only with a class and two attributes besides it, so the classless `<p>`, `<figure>`, `<figcaption>` and `<pre>` are outside it, and `div.sr-only[aria-hidden,ref]` is written nowhere else; `control-census` counts hand-drawn controls, and the page's only controls are `@ccrc/ui`'s `Button`; `literal-census`'s floor is 25 characters with a space, and the page's one such string, the intro, is written once. The JSON is indented two spaces and its lines are short, so the `<pre>` fits a phone's width. If a census suite still refuses something here, follow the census' own fix, never a waiver; a change that would need a new stylesheet is a stop-and-ask.
- [ ] **Step 5: Run to verify they pass.** Step 3's command — all green. Then the guard suites listed under Files, through `ccrc test` in pieces; `TSC-OK`; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/rings/totality.test.ts test/auth-gate.test.ts )` — green, `auth-gate` unchanged. And `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone: the one literal still counts 1 (the page spawns through `createHighlighter`).
- [ ] **Step 6: Commit.** 10 files by name, message `pwa: R19's measurement page, read-only, behind the session gate (docs W5h-a)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5HA-T9-M1 | M7.12 | pwa | `src/screens/highlightMeasureRun.tsx` | `const answer = await deps.loaders.tree(p.project, null);` → `const answer = await (deps.loaders as DocsLoaders).refresh(p.project, { ref: null, reason: 'manual' }).then(() => deps.loaders.tree(p.project, null));` | `test/docs-scans.test.ts` | 1 failed — `'its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs'` |
| W5HA-T9-M2 | M7.12 | pwa | `src/screens/HighlightMeasure.tsx` | `running.current = ctl;` → `running.current = ctl;\n    void navigator.clipboard?.writeText('');` (a clipboard write in Start's handler) | `test/docs-scans.test.ts` | 1 failed — the same case |
| W5HA-T9-M3 | M7.12 | pwa | `src/screens/HighlightMeasure.tsx` | `loaders: api.docs,` → `loaders: { ...api.docs, projects: () => { void api.sessions; return api.docs.projects(); } },` | `test/docs-scans.test.ts` | 1 failed — the same case |
| W5HA-T9-M4 | M7.12 | pwa | `test/docs-scans.test.ts` | `if (memberName(callee) === 'refresh') out.push(` → `if (memberName(callee) === 'refetch') out.push(` | `test/docs-scans.test.ts` | 1 failed — `'planted: a refresh call in the run module is red'` |
| W5HA-T9-M5 | §7.8 | pwa | `src/screens/highlightMeasureRun.tsx` | `slowest.push({ grammar, chars: b.raw.length, ms: r.ms });` → `slowest.push({ grammar, chars: b.raw.length, ms: r.ms, code: b.raw } as never);` | `test/highlight-measure.test.tsx` | 1 failed — `'its text is JSON that names no project, path, file or code'` |
| W5HA-T9-M6 | §7.8 | pwa | `src/lib/routes.ts` | `{ id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },` → `{ id: 'settings-section', pattern: /^\/settings\/([^/]+)\/?$/, title: 'Settings', top: false, path: null },\n  { id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },` (the catch-all row ahead of the page's, as it would be had the row been added after it; `matchRoute` takes the first match) | `test/app.test.tsx` | 1 failed — `'`/settings/measure-highlighting` renders R19\'s measurement page, not the Settings frame (W5h-a)'` |
| W5HA-T9-M7 | §7.8 | pwa | `test/command-registry.test.ts` | `const offered = ROUTES.filter((r) => r.path !== null && (r.top \|\| underTop(ROUTES, r.path)));` → `const offered = ROUTES.filter((r) => r.path !== null && (r.top \|\| r.id.startsWith('settings-')));` (BASE's oracle) | `test/command-registry.test.ts` | 1 failed — `'every Go to command targets a route app.tsx routes: the top rows of ROUTES, the ladder\'s one table'` |
| W5HA-T9-M8 | ARCH-04 | server | `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (repository-relative) | `` , `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` `` → removed (the C9 Docs cell as at BASE) | `test/rings/totality.test.ts` | 1 failed — `'pwa/src: every file takes exactly one context from the spec\'s table, and the table has no stale or nested row'` |
| W5HA-T9-M9 | §7.8 | pwa | `test/command-registry.test.ts` | `'go-measure-highlighting',` → removed (the door list without the new command) | `test/command-registry.test.ts` | 1 failed — `'every base command carries the id docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md §The door table names'` |
| W5HA-T9-M10 | §7.8 | pwa | `test/command-registry.test.ts` | `.filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting');` → `.filter((id) => id !== 'toggle-inspector');` | `test/command-registry.test.ts` | 1 failed — `'entries with no terms, tier or searchOnly rank exactly as before'` (the BASE table read with the new command in it) |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/highlight-measure.test.tsx test/app.test.tsx test/command-layer.test.tsx test/command-registry.test.ts test/docs-scans.test.ts )` — all passed; the census suites unchanged; `( cd server && ./node_modules/.bin/vitest run test/rings/totality.test.ts )` green; `TSC-OK`.

### Task 10: Whole-branch review (held out), its fixes, and `## Deviations found`

**Model routing:** reviewers `opus`, five lenses; one `sonnet` refute pass per finding; fixes by `sonnet` implementers, each reviewed by `opus`.

- [ ] **Step 1:** Five `opus` lenses over `BASE..HEAD` against this plan and the spec: (1) the main thread's bound (no highlight.js reachable from the main bundle, by source and by build; the check's accepted forms and its linearity; the one sink; the length re-checks; what a hostile page, message or tool well can still cost); (2) the runner (the parse runner's behaviour unchanged, case by case against BASE; the handshake, the boot budget, the sticky states; detach; the deadline from post; id matching; dispose); (3) the store (content keys, references and release, the latch, the line retry and what a refused retry becomes, `settled()`, seeding order and dedupe, eviction, the publish slot, no overloaded null); (4) the test and mutation table, the test store's seam and its default, the migrated suites (their names and what they pin kept; golden files byte-identical; part 1's rows green beside the new path); (5) spec and deviation fidelity (each refinement against the spec text, the departing ones (a), (b), (e), (f), (h) and (q) each numbered once), R19's page (reads only; names nothing private; safe to leave shipped; its census and architecture entries argued), plus the public-repo scan of every changed file.
- [ ] **Step 2:** Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 3: Define the deviations.** Replace this plan's `## Deviations found` section's working list with the issued numbers: the first six issued numbers go to the departing refinements (a), (b), (e), (f), (h) and (q), in that order, then any departure found while executing, in the order found. Entry form: `- **D-<n> (<date>)** — <slug> (refinement (<letter>)). <what departs from which spec sentence, and why>. <Task and rows that apply it>.` Then: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green; `grep -c '^- \*\*D-[0-9]* (' <plan>` equals the number defined; `sed -n '/^## Deviations found/,/^## /p' <plan> | grep -nE 'D-<n|<date>|D-TBD-[a-z0-9]'` prints nothing. The section's intro line is rewritten so it no longer names the working list. Commit `docs: W5h-a's deviations, as issued (docs W5h-a)`.

### Task 11: Close — suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus), with `sonnet` subagents for the runs.

- [ ] **Step 1: Suites**, each in the foreground through `ccrc test`, split to fit: the `pwa` suite in pieces; `tsc --noEmit`; `markdown-worker-built`, `reader-built`, `fonts-built`, each alone; the browser files `tool-well-colour` and `reader-frame`; `git fetch -q origin main` then `server`'s `rings/pwa-rings`, `rings/totality`, `docs-parity`, `auth-gate`, `deviation-refs`, `dtbd`, `topology-clean`, `single-definition`, `anchors`, `citations`, `typecheck-tests`. Re-run any known load flake alone before calling it broken. `git diff --stat <BASE> -- pwa/test/golden` is empty.
- [ ] **Step 2: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 3: Draft, do not commit.** Write `## W5h-a results` into this plan in the working tree: the counts per suite; every task's JSON row fence as measured; Task 2's measured grammar and alias table; Task 8's measured chunk names and whether `readerRenderJob-*.js` carries the marker; the built highlight chunk's size; "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-02-native-docs-reader-w5h-a/pr-body.md` (gitignored): title `Docs W5h-a: highlighting off the main thread (the worker path)`; what ships; part 1's bounds still in force; the departing refinements (a), (b), (e), (f), (h) and (q) with their issued numbers, (q) saying that R19's item 8 runs at three fixed cadences and W5h-b's debounce is conditional on chat's real cadence; the provisional values, and that until W5h-b a dense JSON or YAML block over about 20 000 characters stays plain, labelled as output too large, unless the operator raised the cap; the measurement page's route and that the operator opens it once after the rollout; the expected CI (the PR's selection; `browser (pwa)` gates in the merge queue); the plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives.
- [ ] **Step 4: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan), and the drafted PR body: rc 0, zero hits. A hit is fixed, and the scan re-run, before Step 5. Remove `$HOME/.cc-tmp/w5ha-mut/`.
- [ ] **Step 5: Commit the results, last.** Stage this plan by name, message `docs: W5h-a's results (docs W5h-a)`, trailer. This commit is the `handoffCommit` and the branch tip; nothing is committed after it.
- [ ] **Step 6: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 7:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Issued to this wave by the coordinator at run-open (block 7751 to 7766); the first six go to the departing refinements (a), (b), (e), (f), (h) and (q), in that order, then the departures found while executing, in the order found. Numbers 7761 to 7766 were not needed.

- **D-7751 (2026-11-03)** — w5ha-tool-wells-on-the-worker (refinement (a)). §4.10 names chat, Docs pages, text leaves and Export as the highlight worker's clients and is silent on tool wells, which at BASE coloured on the main thread through `boundedHighlight` and held a second `dangerouslySetInnerHTML`. Each code or diff well now holds a one-block chat-mode store on `chatHighlighter`, with its ceilings counted per well (so a message with N tool calls can take N times `HIGHLIGHT_PAGE_MAX_TIMEOUTS`) and chat's stream debounce for a changed well text; it renders plain first through `HighlightedCode`, keeps BASE's rule that a well over a highlight bound shows its original text, and evicts after every commit. Cost: a well flashes plain for one worker round trip. Task 6, Task 10 (fix A); rows W5HA-T6-*, W5HA-T10-A*.
- **D-7752 (2026-11-03)** — w5ha-worker-in-three-files (refinement (b)). §4.10's Files table puts the call, the HTML cap, the cache and the line retry in `lib/markdownHighlightWorker.ts`. The entry is wiring only (it posts `{ready: true}` and assigns `onmessage`); the logic is `lib/highlightJob.ts`, the wire's types `lib/highlightProtocol.ts`, the cache BASE's `lib/highlightCache.ts`, so no test imports a module with a side effect and the main thread never imports a module that reaches highlight.js. Task 3; rows W5HA-T3-*.
- **D-7753 (2026-11-03)** — w5ha-length-before-structure (refinement (e)). §4.10 describes the structural check, then "two length re-checks follow". The store checks the per-block length first (`too-large`, which gets the line retry), then the structure (`malformed`), then the Docs page sum, so the linear pass is bounded by the per-block cap. An answer both malformed and over the cap counts as output too large. Task 5 and its fix round; rows W5HA-T5-M30 and neighbours.
- **D-7754 (2026-11-03)** — w5ha-built-marker-admits-render-chunk (refinement (f)). M4.H4 says no chunk but the highlight worker's carries highlight.js core's marker string. At BASE the reader's lazy `readerRenderJob-*.js` (W8a) already carries the shared Markdown library's own highlight.js, so the built rule admits exactly two carriers, both worker chunks: the one `markdownHighlightWorker-*.js` (which must carry it) and the one `readerRenderJob-*.js`. Task 8; rows W5HA-T8-*.
- **D-7755 (2026-11-03)** — w5ha-publish-holder-is-exports (refinement (h)). §4.10 Tests has the Docs leaf provide a nested context value that adds the `publish` slot. `DocParse` and `TextBody` call `publish(store | null)` through the optional slot, and a test provides and reads it, but nothing in W5h-a provides it in production: the screen-level holder and the sheet that reads it land with Export. Tasks 6 and 7; Task 10 (fix A) moved the calls into one hook.
- **D-7756 (2026-11-03)** — w5ha-r19-chat-cadences (refinement (q)). §7.8 item 8 streams a message "at chat's own settle cadence" and reports "the gaps between settles". BASE has no fixed chat settle cadence, so the page streams its 40-line fence at three fixed cadences (50, 100 and 250 ms) and reports, per cadence and candidate debounce, the requests made and the time from the fence closing to its colours; it reports no settle gaps. W5h-b's `HIGHLIGHT_STREAM_DEBOUNCE_MS` is conditional on chat's real cadence, which R19 does not measure. Task 9; rows W5HA-T9-*.
- **D-7757 (2026-11-03)** — w5ha-over-cap-cases-stay-plain (coordinator ruling of 2026-11-02, mail 13939). Part 1's migrated cases whose block yields more HTML than `MD_HIGHLIGHT_MAX_HTML_CHARS` (markdown-highlight's two 65 536-character cases, markdown-bounds' 65 536-character markdown cases and the markdown arm of its 64 KiB xml/html/markdown case, docs-highlight-budget's '(f) rendered') no longer assert colour: each asserts part 1's decision (admitted, its key requestable, requested), then the shipped outcome (plain, "not highlighted (output too large)"; '(f)' also that the line retry's refusal leaves it plain), and each suite keeps a coloured below-cap case. Why: the operator's 2026-11-02 ruling that dense output stays plain until W5h-b and the cap stays 262 144. Cost if wrong: W5h-b revisits these cases when it sets the measured cap; a raised cap turns them back to coloured. Task 6.
- **D-7758 (2026-11-03)** — w5ha-check-accepts-scope-classes-only (Task 5's review; coordinator ruling, mail 13999). The plan's `acceptedClass` admitted any lower-case token list after a first `hljs-` token, so `<span class="hljs-a fab">` (an app class with `position: fixed`) could reach the DOM. The check now accepts exactly highlight.js 11.12's `scopeToCSSClass` form (single spaces; token 0 `hljs-` plus at least one `[a-z0-9_-]`; token k ≥ 1 `[a-z0-9-]+` followed by exactly k underscores) and `language-NAME` for a registered name or alias. Why: the spec's "highlight.js scope classes". Cost if wrong: under-admitting does not fail open; it leaves a block plain silently. The test that real highlight.js 11.12 output from all 15 registered grammars passes it, including `hljs-title class_` and `hljs-title function_`, is `highlight-html.test.tsx`'s 'real output of every registered grammar passes, and the corpus emits the multi-class sub-scope forms'; W8's highlight.js bump must keep it green. Task 5 (fix round 1), Task 10 (fix A); rows W5HA-T5-M18 to M32, W5HA-T10-A6.
- **D-7759 (2026-11-03)** — w5ha-no-root-provider (refinement (o), numbered in Task 10). §4.10 Tests says the seam is one context "provided at the app root". No provider is mounted: `HighlighterContext`'s default value is the production one (`docsHighlighter`, `chatHighlighter`, the production store factory), pinned by M4.H17, so `app.tsx` is unchanged. Cost if wrong: Export, or any nested provider, nests under the default rather than a root element. Task 6.
- **D-7760 (2026-11-03)** — w5ha-r19-select-button (refinement (i), numbered in Task 10). §7.8 says the result is "one read-only field, which a tap selects whole". The page shows the result in one read-only `<pre>` and selects it whole from a `Select result` button (`@ccrc/ui`'s `Button`), so it draws no hand-drawn control (control-census) and writes no clipboard. Cost if wrong: one extra tap. Task 9.

## Where things stand

### Agreed
- The operator's five rulings of 2026-10-15 and the coordinator's rulings of that day, applied as written: W5h-a ships the worker path, the store, the check, the measurement page and the constants at provisional values, with part 1's main-thread bounds still in force; no highlight.js version change (11.12.0 is already in the lock).
- The design as recommended: one block per job under its own deadline, a ready handshake, a detach abort for the highlighter only, a content-keyed store per page, text leaf and chat message, a plain first frame everywhere, no main-thread fallback, one sink behind a strict linear check, Export reading by peek.
- The parse runner and W8a's render job behave exactly as before; the reader path's colouring is the library's, unchanged.
- Provisional values: 750 ms a block, 2 s boot, 3 s of worker time and 2 timeouts a store, 262 144 characters of HTML a block, 2 097 152 a Docs page, 250 ms of streaming debounce.
- The coordinator's rulings of 2026-11-02: R19's item 8 runs at three fixed settle cadences (50, 100 and 250 ms) and reports no settle gaps, because BASE has no fixed chat settle cadence; W5h-b sets `HIGHLIGHT_STREAM_DEBOUNCE_MS` from the table across cadences, and that basis is conditional on chat's real cadence, which R19 does not measure (refinement (q), a departure). Every new screen, route or control passes BASE's census and architecture suites in the task that adds it (Task 9's entries, each with its reason).
- **The operator's approval of 2026-11-02, every recommendation taken:**
  - The plan as written, one run (no split after Task 8).
  - Refinement (a): tool wells move onto the worker and the one sink, and flash plain once per worker round trip. The departures (b), (e), (f), (h) and (q) (item 8's three cadences) are accepted as plan-only departures, each numbered once issued.
  - **A visible regression until W5h-b, accepted: dense JSON or YAML stays plain.** At the provisional per-block HTML cap of 262 144 characters, and desktop polish C7's measured 13 characters of markup per character of dense JSON (a 64 KiB block came to about 858 000), a dense JSON or YAML block over about 20 000 characters answers "output too large"; its line-by-line retry joins to the same size, so it stays plain, labelled "not highlighted (output too large)", where today it is coloured. The recommendation, taken: keep 262 144, since R19 measures the real ratio and W5h-b sets the cap from it; raising it to 1 048 576 now colours such blocks up to about 80 000 characters (past the 64 KiB block cap), at the cost of up to four times as much markup checked and inserted on the main thread per block (the check is linear, so about four times the time). The operator kept 262 144.
  - R19's retirement bound, the longest wait for one code block's colours: **2 seconds**, four times the provisional deadline, a wait a reader notices but tolerates once per block, and the parse budget a small document already gets. R19's retirement gate is measured against it (§7.8).
  - The measurement page lives at `/settings/measure-highlighting` (the palette's "Go to Settings › Measure highlighting").

### Waiting on you
- After the merge: roll the prerelease out (`ccrc rollout --to vX.Y.Z`, fleet first), then open Settings › Measure highlighting once on your phone (the palette's "Go to Settings › Measure highlighting"), keep the screen on until it says Done, and send the result with the phone's name.

### Later
- W5h-b, after R19: the seven values set from the measurement, each with its basis; then, in a commit of its own, part 1's main-thread highlight bounds retired (M4.H23), if every real block finishes cold within the agreed 2 s bound.
- Export, after W5h-a and Share: it provides the `publish` slot's holder, reads the store by peek, waits for `settled()` within the ceilings, and says in its provenance what stayed plain.
- W6: Source as a one-block store on the Docs highlighter; M5.16 carries the third worker file.
- W8: one colouring for both paths (the library's `./highlight` behind the same block wire), only if you ask for it. The library's request (c) (the xml `<script>`/`<style>` cost under C24) goes to the library programme; ccrc keeps its xml strip either way.

## W5h-a results

Measured on the workspace branch after `main` was merged in (Share, #2145, landed first), at the tip that this section's commit sits on, 2026-11-03.

### Suites

| Suite | Result |
|---|---|
| `pwa`, four shards | 403 files, 12 352 tests passed, 3 skipped. One case, `highlight-wiring.test.tsx`'s "M4.H16 … a text leaf: plain first, then coloured", failed once under load (a `waitFor` timing) and passed alone and on the shard's re-run. |
| `pwa` typecheck (`tsc --noEmit -p tsconfig.json`) | clean |
| `markdown-worker-built`, `reader-built`, `fonts-built`, each alone | 9, 6 and 4 passed |
| browser: `tool-well-colour`, `reader-frame` | 16 and 24 passed |
| `server`: `rings/pwa-rings`, `rings/totality`, `docs-parity`, `auth-gate` | 333 passed |
| `server`: `deviation-refs`, `dtbd`, `topology-clean`, `anchors`, `citations` | 105 passed |
| `server`: `single-definition/` | 1 045 passed |
| `server`: `typecheck-tests` | 12 passed |
| `git diff --stat <BASE> -- pwa/test/golden` | empty |

### The mutation table

137 rows (the last occurrence of each id), run sequentially in the workspace, each restored from a saved copy and checked by sha256, with `git status` clean after every row: **137 red, 0 green, 0 unmatched.** Seven rows measured more failing cases than their earlier record, with every recorded case still among them, because later tasks and fix rounds added cases the same mutation also reds: W5HA-T4-M2 (7), W5HA-T4-M8 (9), W5HA-T5-M8 (2), W5HA-T5-M28 (3), W5HA-T9-M1 (8), W5HA-T9-M13 (4), W5HA-T7-X1 (2, now the same mutant as W5HA-T7-M6). The rows below carry the measured red; a `note` records a coordinator ruling or a re-anchoring. Part 1's moved bounds are pinned at their new homes by W5HA-T10-A7 to A14.

### Measurements

- **Grammar and alias table (Task 2, on the installed highlight.js 11.12.0).** The 15 grammars: `bash`, `css`, `diff`, `dockerfile`, `go`, `javascript`, `json`, `markdown`, `php`, `python`, `rust`, `sql`, `typescript`, `xml`, `yaml`. The alias table printed one entry more than the planning table: `json5 → json`. The full table is `HIGHLIGHT_ALIASES` in `pwa/src/lib/highlightNames.ts`, held equal to the worker's registry in both directions by `highlight-names.test.ts`.
- **Built chunks (Task 8).** `markdownHighlightWorker-*.js` is one chunk of 78 931 bytes and carries highlight.js core's marker (`did you forget to load/include a language module?`). `readerRenderJob-*.js` (250 915 bytes) carries it too, as refinement (f) and D-7754 admit. `markdownWorker-*.js` (158 372 bytes) does not, and no other emitted `.js` file does.

### Carried, not fixed

- W5h-b: the seven provisional values set from R19, each with its basis; part 1's main-thread bounds retired (M4.H23). Until then, a dense JSON or YAML block over about 20 000 characters stays plain, labelled "output too large" (D-7757).
- Export: the `publish` slot's holder and reader (D-7755). `publish(null)` names no store, so a holder that ever has two publishers cannot tell whose withdrawal it is.
- The store stops its clock when a posted job is detached, while the runner keeps the worker on that job for up to one deadline, so that remaining time is not counted against `HIGHLIGHT_PAGE_WORKER_MS`.
- Scan residue, each listed in its clause's NOT EXHAUSTIVE header or below:
  - the sink name given as a string argument or array element (`Object.defineProperty`, `Reflect.set`, `Object.fromEntries`);
  - `new globalThis.URL(…)` for the worker URL;
  - the worker chain reached through the `@/` alias.
- Test-double fidelity: `syncTestStore` restates the store's receipt order (with no line retry or ceilings) for markdown-bounds' D-7757 cases. The production receipt is pinned by docs-highlight-budget's '(f)' and by `highlight-store.test.ts`.
- R19: the measurement host is visually hidden (1 px wide), so items 4 and 5's layout figures are taken in a container unlike the reader's. A corpus repeat that the worker's cache already evicted is counted as a repeat, not timed.
- A future grammar emitting an underscore inside a sub-scope piece (such as `built_in_`) would be refused by D-7758's check and stay plain. A registry addition re-runs the real-output test.
- The comment `HIGHLIGHT_CACHE_MAX_CHARS` lost BASE's "at most twice the bound plus per-entry overhead" sentence when the bound moved.
- Every item carried in this plan's Global Constraints, unchanged.

### Rows as measured

#### Task 1 (4 rows)

```json
[
 {
  "id": "W5HA-T1-M1",
  "spec": "M4.H22",
  "pkg": "pwa",
  "file": "src/lib/markdownLimits.ts",
  "old": "export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;",
  "new": "export const HIGHLIGHT_BLOCK_DEADLINE_MS = 751;",
  "tests": "test/markdown-limits.test.ts",
  "red": "1 failed: 'HIGHLIGHT_BLOCK_DEADLINE_MS is 750'"
 },
 {
  "id": "W5HA-T1-M2",
  "spec": "M4.H22",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "import '../session/chat.css';",
  "new": "import '../session/chat.css';\nconst HIGHLIGHT_BOOT_BUDGET_MS = 2000;",
  "tests": "test/markdown-limits.test.ts",
  "red": "1 failed: 'HIGHLIGHT_BOOT_BUDGET_MS has exactly one declaration, in pwa/src/lib/markdownLimits.ts'"
 },
 {
  "id": "W5HA-T1-M3",
  "spec": "M4.H22",
  "pkg": "pwa",
  "file": "src/lib/markdownLimits.ts",
  "old": "export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152;",
  "new": "export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 1391999;",
  "tests": "test/markdown-limits.test.ts",
  "red": "2 failed: 'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS is 2097152'; 'M4.H22: the provisional page HTML cap admits M4.H2's eight 60 000-character blocks at 2.90 HTML characters a character'"
 },
 {
  "id": "W5HA-T1-M4",
  "spec": "M4.H22",
  "pkg": "pwa",
  "file": "src/lib/markdownLimits.ts",
  "old": "/** PROVISIONAL (W5h-a; W5h-b sets it from R19). Chat only:",
  "new": "/** Chat only:",
  "tests": "test/markdown-limits.test.ts",
  "red": "1 failed: 'M4.H22: each provisional value says so in its docstring'"
 }
]
```

#### Task 2 (5 rows)

```json
[
 {
  "id": "W5HA-T2-M1",
  "spec": "M4.H5",
  "pkg": "pwa",
  "file": "src/lib/highlightNames.ts",
  "old": "mkd: 'markdown',",
  "new": "",
  "tests": "test/highlight-names.test.ts",
  "red": "1 failed: 'the alias table is every alias the worker resolves, each to the same grammar'"
 },
 {
  "id": "W5HA-T2-M2",
  "spec": "M4.H5",
  "pkg": "pwa",
  "file": "src/lib/highlightNames.ts",
  "old": "zsh: 'bash',",
  "new": "zsh: 'bash', planted: 'bash',",
  "tests": "test/highlight-names.test.ts",
  "red": "2 failed: 'the alias table is every alias the worker resolves, each to the same grammar'; 'every name and alias resolves to the same grammar on both sides, in either case'"
 },
 {
  "id": "W5HA-T2-M3",
  "spec": "M4.H6",
  "pkg": "pwa",
  "file": "src/lib/highlightGrammars.ts",
  "old": "export const HLJS: HighlightApi = hljs.newInstance();",
  "new": "export const HLJS: HighlightApi = hljs;",
  "tests": "test/highlight-names.test.ts",
  "red": "1 failed: 'highlightGrammars.ts makes exactly one hljs.newInstance() and registers only on HLJS'"
 },
 {
  "id": "W5HA-T2-M4",
  "spec": "M4.H6",
  "pkg": "pwa",
  "file": "src/lib/highlightGrammars.ts",
  "old": "for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });",
  "new": "for (const [languageName, aliases] of Object.entries(CCRC_ALIASES)) HLJS.registerAliases([...aliases], { languageName });\nHLJS.configure({ classPrefix: 'x-' });",
  "tests": "test/highlight-names.test.ts",
  "red": "2 failed: 'no file of the worker's first-party closure calls addPlugin, configure or debugMode'; 'planted: configure, addPlugin and debugMode on HLJS are each red'"
 },
 {
  "id": "W5HA-T2-M5",
  "spec": "M4.H5",
  "pkg": "pwa",
  "file": "src/lib/highlightNames.ts",
  "old": "['rust', MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS],",
  "new": "",
  "tests": "test/highlight-names.test.ts",
  "red": "1 failed: 'part 1's grammar caps equal deriveBoundedCaps over the worker's grammars (until W5h-b)'"
 }
]
```

#### Task 3 (6 rows)

```json
[
 {
  "id": "W5HA-T3-M1",
  "spec": "M4.H13",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "if (html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) return { kind: 'too-large', htmlChars: html.length };",
  "new": "",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "2 failed: 'HTML over MD_HIGHLIGHT_MAX_HTML_CHARS is posted as too-large with its length, never as HTML'; 'line mode still applies the HTML cap to the joined answer'"
 },
 {
  "id": "W5HA-T3-M2",
  "spec": "M4.H18",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "const lineMode = mode === 'line' && code.length > HIGHLIGHT_LINE_RETRY_UNITS;",
  "new": "const lineMode = mode === 'line';",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "1 failed: 'line mode on a block of at most the unit colours it whole, in block mode'"
 },
 {
  "id": "W5HA-T3-M3",
  "spec": "M4.H18",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "if (longest > HIGHLIGHT_LINE_RETRY_UNITS) return { kind: 'line-too-long', chars: longest };",
  "new": "",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "1 failed: 'line mode answers line-too-long, with its length, when one line is over the unit, and colours nothing'"
 },
 {
  "id": "W5HA-T3-M4",
  "spec": "M4.H20",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "let html = cache.get(key);",
  "new": "let html: string | undefined = undefined;",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "2 failed: 'the same (mode, lang, code) twice calls highlight once; the other mode is its own entry'; 'the default cache holds 256 entries and 4000000 characters of markup'"
 },
 {
  "id": "W5HA-T3-M5",
  "spec": "M4.H3",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "import { createLru, type Lru } from './highlightCache';",
  "new": "import { createLru, type Lru } from './highlightCache';\nimport 'react';",
  "tests": "test/markdown-purity.test.ts",
  "red": "1 failed: 'imports nothing but highlight.js/lib/core and the 15 language modules'"
 },
 {
  "id": "W5HA-T3-M6",
  "spec": "M4.H3",
  "pkg": "pwa",
  "file": "src/lib/highlightGrammars.ts",
  "old": "import hljs from 'highlight.js/lib/core';",
  "new": "import hljs from 'highlight.js';",
  "tests": "test/markdown-purity.test.ts",
  "red": "2 failed: 'imports nothing but highlight.js/lib/core and the 15 language modules'; 'planted: highlightGrammars imported by the parse worker is refused in the parse closure'",
  "note": "plan predicted 1; the coordinator ruled the measured count on 2026-11-02 (mail 13940)"
 }
]
```

#### Task 4 (9 rows)

```json
[
 {
  "id": "W5HA-T4-M1",
  "spec": "M4.H7",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "running = { job, timer: setTimer(() => expire(job), job.budgetMs), detached: false };",
  "new": "running = { job, timer: undefined, detached: false };",
  "tests": "test/markdown-runner.test.ts",
  "red": "14 failed: 'a job that never answers is a timeout exactly at its budget, after one terminate'; 'the next job after a timeout spawns a fresh worker and is answered by it'; 'honours each job's own budget: 30 000 ms (Format anyway's) times out at 30 000, not before'; 'the timer starts when a job is posted, not when it is queued'; 'a reply, an error and an abort each cancel the job timer'; 'a dropped worker is no longer heard: its late reply and its error reach nobody'; 'a messageerror from a worker dropped by a timeout leaves the live worker and its job alone'; 'a respawn that throws answers worker-unavailable to each job queued behind the expired one'; 'a render job answers timeout at budgetMs and the worker is terminated'; 'M4.H8: the block deadline starts at post, not at request: a 1 999 ms boot then 749 ms of work is no timeout'; 'M4.H8: a boot that succeeds resets the count: fail, ready, then one more failure is not sticky'; 'M4.H7: after {ready}, a job that never answers times out at the deadline, terminate once, the next job respawns'; 'M4.H7: only the overrun block is lost: of a, b, c, b never answers and a and c are answered'; 'M4.H9: a detached job's deadline still runs: its timeout terminates and reaches nobody'"
 },
 {
  "id": "W5HA-T4-M2",
  "spec": "M4.H8",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "if (!booted) return;",
  "new": "",
  "tests": "test/markdown-runner.test.ts",
  "red": "7 failed: 'M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line'; 'M4.H8: the block deadline starts at post, not at request: a 1 999 ms boot then 749 ms of work is no timeout'; 'M4.H8: a worker that never says ready answers every waiting job worker-failed at the boot budget, terminated'; 'M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn'; 'M4.H8: an error event while booting is a boot failure for the waiting jobs'; 'L2-1: a boot failure's timer dies with its worker (drop() clears the boot timer)'; 'onPosted runs when the job is posted: after ready, after the job ahead of it, never for an unposted job'"
 },
 {
  "id": "W5HA-T4-M3",
  "spec": "M4.H9",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "if (abortRunning === 'detach') {",
  "new": "if (abortRunning !== abortRunning) {",
  "tests": "test/markdown-runner.test.ts",
  "red": "1 failed: 'M4.H9: aborting a running highlight job rejects it, never terminates, and the same worker serves the next job'"
 },
 {
  "id": "W5HA-T4-M4",
  "spec": "M4.H8",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "const sticky = (): boolean => bootFailures >= 2;",
  "new": "const sticky = (): boolean => false;",
  "tests": "test/markdown-runner.test.ts",
  "red": "1 failed: 'M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn'"
 },
 {
  "id": "W5HA-T4-M5",
  "spec": "M4.H8",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "if (bootBudgetMs !== undefined) bootTimer = setTimer(() => bootFail('boot-timeout'), bootBudgetMs);",
  "new": "",
  "tests": "test/markdown-runner.test.ts",
  "red": "3 failed: 'M4.H8: a worker that never says ready answers every waiting job worker-failed at the boot budget, terminated'; 'M4.H8: the next job respawns once; a second boot failure in a row is sticky, with no further spawn'; 'M4.H8: a boot that succeeds resets the count: fail, ready, then one more failure is not sticky'"
 },
 {
  "id": "W5HA-T4-M6",
  "spec": "M4.H10",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "unavailable = true;",
  "new": "",
  "tests": "test/markdown-runner.test.ts",
  "red": "4 failed: 'a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried'; 'with no Worker global, defaultSpawn throws and a runner with no deps answers worker-unavailable'; 'a respawn that throws answers worker-unavailable to each job queued behind the expired one'; 'M4.H10: a spawn that throws is a sticky worker-unavailable: status says so, every job answers it, no further spawn'"
 },
 {
  "id": "W5HA-T4-M7",
  "spec": "M4.H3",
  "pkg": "pwa",
  "file": "test/markdown-runner.test.ts",
  "old": "const WORKER_FILES = ['markdownHighlightWorker.ts', 'markdownRunner.ts', 'markdownWorker.ts'];",
  "new": "const WORKER_FILES = ['markdownRunner.ts', 'markdownWorker.ts'];",
  "tests": "test/markdown-runner.test.ts",
  "red": "2 failed: 'no other lib/markdown* or lib/highlight* file posts or receives messages (M4.H3)'; 'planted (M4.H3): a postMessage( or an onmessage assignment in the store is red'"
 },
 {
  "id": "W5HA-T4-M8",
  "spec": "M4.H8",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "if (d.ready === true) return { kind: 'ready' };",
  "new": "",
  "tests": "test/markdown-runner.test.ts",
  "red": "9 failed: 'M4.H8: no job is posted before {ready}; then exactly {id, lang, code}, and a retry adds mode line'; 'M4.H8: the block deadline starts at post, not at request: a 1 999 ms boot then 749 ms of work is no timeout'; 'M4.H8: a boot that succeeds resets the count: fail, ready, then one more failure is not sticky'; 'L2-1: a ready worker is not failed by its own boot budget (ready() clears the boot timer)'; 'M4.H7: after {ready}, a job that never answers times out at the deadline, terminate once, the next job respawns'; 'M4.H7: only the overrun block is lost: of a, b, c, b never answers and a and c are answered'; 'M4.H9: aborting a running highlight job rejects it, never terminates, and the same worker serves the next job'; 'M4.H9: a detached job's deadline still runs: its timeout terminates and reaches nobody'; 'onPosted runs when the job is posted: after ready, after the job ahead of it, never for an unposted job'"
 },
 {
  "id": "W5HA-T4-M9",
  "spec": "M4.H10",
  "pkg": "pwa",
  "file": "src/lib/markdownParse.ts",
  "old": "| { kind: 'worker-failed'; error: string }; // runner only",
  "new": "| { kind: 'worker-failed'; error: string } // runner only\n  | { kind: 'planted' };",
  "tests": "the pwa typecheck (node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json, run in pwa/)",
  "red": "5 type errors"
 }
]
```

#### Task 5 (32 rows)

```json
[
 {
  "id": "W5HA-T5-M1",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (!acceptedClass(html.slice(start, end))) return null;",
  "new": "",
  "tests": "test/highlight-html.test.tsx",
  "red": "15 failed: 'a class without the hljs- prefix'; 'an unknown language name'; 'an upper-case class character'; 'an empty scope'; 'a plain class after the scope (it could be a styled class of the app)'; 'an app class after the scope'; 'an empty scope before a second token'; 'two spaces between tokens'; 'a second token with no underscore'; 'a second token with the wrong underscore count'; 'a third token with the second's count'; 'a trailing space'; 'an underscore-only second token'; 'an underscore inside a second token'; 'an upper-case second token'"
 },
 {
  "id": "W5HA-T5-M2",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "return cls.startsWith(LANGUAGE_PREFIX) && HIGHLIGHT_NAME_SET.has(cls.slice(LANGUAGE_PREFIX.length));",
  "new": "return cls.startsWith(LANGUAGE_PREFIX);",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'an unknown language name'"
 },
 {
  "id": "W5HA-T5-M3",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (entity === undefined) return null;",
  "new": "if (entity === undefined) { i += 1; continue; }",
  "tests": "test/highlight-html.test.tsx",
  "red": "2 failed: 'a named entity outside the five'; 'a numeric entity'"
 },
 {
  "id": "W5HA-T5-M4",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (depth !== 0) return null;",
  "new": "",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'an unclosed span'"
 },
 {
  "id": "W5HA-T5-M5",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (ceilingsOn && input > DOCS_HIGHLIGHT_PAGE_MAX_CHARS) entries.set(k.key, { kind: 'skipped', ceiling: 'page-input' });\n      else if (inScan",
  "new": "if (inScan",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'the input ceiling skips at seed, in document order, a shared key counted once'"
 },
 {
  "id": "W5HA-T5-M6",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "} else if (docs && ceilingsOn && outputChars + o.html.length > DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS) {",
  "new": "} else if (false) {",
  "tests": "test/highlight-store.test.ts",
  "red": "2 failed: 'the output ceiling: the answer that would pass the page HTML cap is skipped, and every later request'; 'the output ceiling latches before the skipped key's listener runs: a request made from it starts no job'"
 },
 {
  "id": "W5HA-T5-M7",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (timeouts >= HIGHLIGHT_PAGE_MAX_TIMEOUTS) close('page-timeouts');",
  "new": "if (timeouts >= 1000) close('page-timeouts');",
  "tests": "test/highlight-store.test.ts",
  "red": "3 failed: 'the timeout ceiling: at HIGHLIGHT_PAGE_MAX_TIMEOUTS timeouts every unanswered key is skipped, the running job detached'; 'a retry the ceilings refuse leaves the block plain under its first failure, never skipped'; 'the retry counts against the page ceilings: its timeout is counted'"
 },
 {
  "id": "W5HA-T5-M8",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "const timer = ceilingsOn",
  "new": "const timer = false",
  "tests": "test/highlight-store.test.ts",
  "red": "2 failed: 'the worker-time ceiling fires mid-job: the running job is detached and the rest skipped'; 'five 700 ms jobs answered back to back: the fifth is skipped by page-worker-time 200 ms into its run'"
 },
 {
  "id": "W5HA-T5-M9",
  "spec": "M4.H13",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "} else if (o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {\n      failure = { kind: 'too-large' };\n    } else {",
  "new": "} else {",
  "tests": "test/highlight-store.test.ts",
  "red": "2 failed: 'an answer over MD_HIGHLIGHT_MAX_HTML_CHARS is too-large on receipt, and a long block is retried in line mode, pending meanwhile'; 'an answer both over the per-block cap and malformed is too-large (length first, refinement (e)), and a long block is retried'"
 },
 {
  "id": "W5HA-T5-M10",
  "spec": "M4.H11",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "const peek = (key: string): HighlightEntry => entries.get(key) ?? UNREQUESTED_ENTRY;",
  "new": "const peek = (key: string): HighlightEntry => ({ ...(entries.get(key) ?? UNREQUESTED_ENTRY) });",
  "tests": "test/highlight-store.test.ts",
  "red": "4 failed: 'two blocks with equal (lang, raw) make one request; peek is synchronous and never requests'; 'releasing one of two references keeps the job; releasing the last detaches it and the key is unrequested again'; 'peek returns the same object until the entry changes; subscribe(key) returns the same function for a key'; 'a chat store evicts every key no block references after a commit'"
 },
 {
  "id": "W5HA-T5-M11",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (docs) {\n      for (const key of seeded) {",
  "new": "if (false) {\n      for (const key of seeded) {",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'settled(): false while a seeded key is unanswered, from creation; true once every one is html, plain or skipped'"
 },
 {
  "id": "W5HA-T5-M12",
  "spec": "M4.H11",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (n > 0) {\n        refs.set(key, n);\n        return;\n      }",
  "new": "",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'releasing one of two references keeps the job; releasing the last detaches it and the key is unrequested again'"
 },
 {
  "id": "W5HA-T5-M13",
  "spec": "M4.H18",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (job.first === null && (failure.kind === 'timeout'",
  "new": "if ((failure.kind === 'timeout'",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'a retry that fails differently leaves the block plain under its first failure, the retry's outcome recorded'"
 },
 {
  "id": "W5HA-T5-M14",
  "spec": "M4.H18",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "rawLength > HIGHLIGHT_LINE_RETRY_UNITS) {",
  "new": "rawLength >= HIGHLIGHT_LINE_RETRY_UNITS) {",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'a block of exactly the unit gets no retry and stays plain under its first failure; one unit more is retried'"
 },
 {
  "id": "W5HA-T5-M15",
  "spec": "(g)",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (status !== 'live') {",
  "new": "if (status === 'worker-failed') {",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'a highlighter that is worker-unavailable: the block is plain at once with that cause, nothing queued'"
 },
 {
  "id": "W5HA-T5-M16",
  "spec": "-",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "raw: textOf(n).replace(/\\n$/, '') });",
  "new": "raw: textOf(n) });",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'walks pre elements in document order: the code class's language, and the text with one trailing newline stripped'"
 },
 {
  "id": "W5HA-T5-M17",
  "spec": "(r)",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "for (const key of new Set([...refs.keys(), ...shownKeys.keys()])) {",
  "new": "for (const key of refs.keys()) {",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'a chat store is not settled while a shown key waits for its request (the debounce window)'"
 },
 {
  "id": "W5HA-T5-M18",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (c === 0x3e || c === 0x22 || c === 0x27) return null;",
  "new": "if (c === 0x22 || c === 0x27) return null;",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'a bare >'"
 },
 {
  "id": "W5HA-T5-M19",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (c === 0x3e || c === 0x22 || c === 0x27) return null;",
  "new": "if (c === 0x3e || c === 0x27) return null;",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'a raw double quote'"
 },
 {
  "id": "W5HA-T5-M20",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (c === 0x3e || c === 0x22 || c === 0x27) return null;",
  "new": "if (c === 0x3e || c === 0x22) return null;",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'a raw single quote'"
 },
 {
  "id": "W5HA-T5-M21",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (depth < 0) return null;",
  "new": "",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'a closer before its opener'"
 },
 {
  "id": "W5HA-T5-M22",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (end === -1 || html.charCodeAt(end + 1) !== 0x3e) return null;",
  "new": "if (end === -1) return null;",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'an opener whose class quote is not followed by >'"
 },
 {
  "id": "W5HA-T5-M23",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (!html.startsWith(OPEN, i)) return null;",
  "new": "",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'another tag as long as an opener'"
 },
 {
  "id": "W5HA-T5-M24",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (end - pos <= HLJS_PREFIX.length) return false;",
  "new": "",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'an empty scope'"
 },
 {
  "id": "W5HA-T5-M25",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (end - body !== tier || body === pos) return false;",
  "new": "if (body === pos) return false;",
  "tests": "test/highlight-html.test.tsx",
  "red": "5 failed: 'a plain class after the scope (it could be a styled class of the app)'; 'an app class after the scope'; 'a second token with no underscore'; 'a second token with the wrong underscore count'; 'a third token with the second's count'"
 },
 {
  "id": "W5HA-T5-M26",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (end - body !== tier || body === pos) return false;",
  "new": "if (end - body !== tier) return false;",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'an underscore-only second token'"
 },
 {
  "id": "W5HA-T5-M27",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (!(isLowerAlnum(c) || c === 0x2d)) return false;",
  "new": "if (!(isLowerAlnum(c) || c === 0x2d || c === 0x5f || (c >= 0x41 && c <= 0x5a))) return false;",
  "tests": "test/highlight-html.test.tsx",
  "red": "2 failed: 'an underscore inside a second token'; 'an upper-case second token'"
 },
 {
  "id": "W5HA-T5-M28",
  "spec": "M4.H14",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (!(isLowerAlnum(c) || c === 0x5f || c === 0x2d)) return false;",
  "new": "if (!(isLowerAlnum(c) || c === 0x2d)) return false;",
  "tests": "test/highlight-html.test.tsx",
  "red": "3 failed: 'the HTML highlight.js gives for every code block of M4.M1's corpus'; 'real output of every registered grammar passes, and the corpus emits the multi-class sub-scope forms'; 'a language-NAME wrapper for every registered name and alias, and the two real subLanguage shapes'"
 },
 {
  "id": "W5HA-T5-M29",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (jobs.get(job.key) !== job) return;\n    jobs.delete(job.key);",
  "new": "jobs.delete(job.key);",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'a detached job's timeout counts against no ceiling'"
 },
 {
  "id": "W5HA-T5-M30",
  "spec": "M4.H13",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "} else if (o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {",
  "new": "} else if (checkHighlightHtml(o.html) !== null && o.html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) {",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'an answer both over the per-block cap and malformed is too-large (length first, refinement (e)), and a long block is retried'"
 },
 {
  "id": "W5HA-T5-M31",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "close('page-output');\n        set(key, job.first === null ? { kind: 'skipped', ceiling: 'page-output' } : { kind: 'plain', first: job.first, retry: REFUSED });",
  "new": "set(key, job.first === null ? { kind: 'skipped', ceiling: 'page-output' } : { kind: 'plain', first: job.first, retry: REFUSED });\n        close('page-output');",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'the output ceiling latches before the skipped key's listener runs: a request made from it starts no job'"
 },
 {
  "id": "W5HA-T5-M32",
  "spec": "M4.H12",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "checkCeilings();\n        set(key, { kind: 'html', mode: o.mode, checked });",
  "new": "set(key, { kind: 'html', mode: o.mode, checked });\n        checkCeilings();",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'the worker-time ceiling, reached by an html answer, latches before that key's listener runs'"
 }
]
```

#### Task 6 (7 rows)

```json
[
 {
  "id": "W5HA-T6-M1",
  "spec": "M4.M1",
  "pkg": "pwa",
  "file": "test/markdown-golden.test.tsx",
  "old": "renderToStaticMarkup(withSyncHighlight(",
  "new": "renderToStaticMarkup(Object(",
  "tests": "test/markdown-golden.test.tsx",
  "red": "33 failed: 'lang-bash'; 'lang-css'; 'lang-diff'; 'lang-dockerfile'; 'lang-go'; 'lang-javascript'; 'lang-json'; 'lang-markdown'; 'lang-php'; 'lang-python'; 'lang-rust'; 'lang-sql'; 'lang-typescript'; 'lang-xml'; 'lang-yaml'; 'lang-zsh'; 'lang-shell'; 'lang-tsx'; 'lang-html'; 'lang-svg'; 'lang-sh'; 'lang-ts'; 'lang-js'; 'lang-jsx'; 'lang-mjs'; 'lang-py'; 'lang-yml'; 'lang-md'; 'lang-docker'; 'lang-golang'; 'lang-rs'; 'lang-jsonc'; 'M4.M1 control: rendered with no test store, a coloured golden loses its spans (W5h-a)'",
  "note": "row text corrected: the plan's `renderToStaticMarkup((` was a syntax error (the coordinator agreed, mail 13999)"
 },
 {
  "id": "W5HA-T6-M2",
  "spec": "M4.H15",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "if (isCheckedHighlightHtml(checked)) return",
  "new": "if (checked !== null) return",
  "tests": "test/highlight-html.test.tsx",
  "red": "1 failed: 'a checked value renders its spans; a plain string or a look-alike at the sink renders the block plain'"
 },
 {
  "id": "W5HA-T6-M3",
  "spec": "M4.P10",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "const store = useContext(PreHighlightContext);",
  "new": "const store: HighlightStore | null = null;",
  "tests": "test/markdown-golden.test.tsx, test/render-hast.test.tsx",
  "red": "34 failed: 'lang-bash'; 'lang-css'; 'lang-diff'; 'lang-dockerfile'; 'lang-go'; 'lang-javascript'; 'lang-json'; 'lang-markdown'; 'lang-php'; 'lang-python'; 'lang-rust'; 'lang-sql'; 'lang-typescript'; 'lang-xml'; 'lang-yaml'; 'lang-zsh'; 'lang-shell'; 'lang-tsx'; 'lang-html'; 'lang-svg'; 'lang-sh'; 'lang-ts'; 'lang-js'; 'lang-jsx'; 'lang-mjs'; 'lang-py'; 'lang-yml'; 'lang-md'; 'lang-docker'; 'lang-golang'; 'lang-rs'; 'lang-jsonc'; 'recap-opened: the compaction card opened, its Markdown body rendered'; 'M4.M1 control: rendered with no test store, a coloured golden loses its spans (W5h-a)'"
 },
 {
  "id": "W5HA-T6-M4",
  "spec": "M4.H1",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS) return { kind: 'over-cap', chars: raw.length };",
  "new": "",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'keyOf: a key, or why the block can never be requested, in BASE's order; part 1's bounds only with part1'"
 },
 {
  "id": "W5HA-T6-M5",
  "spec": "re-anchored at Task 10 fix A item 3 (the seed moved into useDocsHighlightStore; the DocsLeaf seed is W5HA-T7-X2)",
  "pkg": "pwa",
  "file": "src/lib/highlighterContext.ts",
  "old": "    s.seed(blocks);\n",
  "new": "",
  "tests": "test/docs-highlight-budget.test.tsx, test/docs-markdown.test.tsx, test/highlight-wiring.test.tsx",
  "red": "7 failed: 'a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount'; 'a text leaf publishes its one-block store the same way'; 'nine 60 000-character python blocks: the first eight are highlighted and the ninth is not'; '(f) rendered: a third 64 KiB markdown block is skipped (bare label, never requested), the first two are admitted and requested and stay plain over the HTML cap until W5h-b'; 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels'; 'the page highlight budget reaches the blocks: of nine 60 000-character python blocks the ninth is not highlighted'"
 },
 {
  "id": "W5HA-T6-M6",
  "spec": "§4.4",
  "pkg": "pwa",
  "file": "src/docs/DocsLeaf.tsx",
  "old": "const text = src.kind === 'markdown' && isRegisteredGrammar(ext) ? src.text : null;",
  "new": "const text = null;",
  "tests": "test/docs-screen.test.tsx",
  "red": "1 failed: 'text with a registered grammar (x.ts) is highlighted through CodeBlock; x.txt is pre.doc-plain'"
 },
 {
  "id": "W5HA-T6-M7",
  "spec": "(a)",
  "pkg": "pwa",
  "file": "src/session/ToolWellText.tsx",
  "old": "if (key === null) return fallback;",
  "new": "if (key === null) return text;",
  "tests": "test/tool-well.test.tsx",
  "red": "1 failed: 'strips input escapes on the plain fallback; over its bound an input shows its JSON text as written'"
 }
]
```

#### Task 7 (16 rows)

```json
[
 {
  "id": "W5HA-T7-M1",
  "spec": "M4.C5",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "const immediate = store.debounceMs === 0 || lastKey.current === null || lastKey.current === key;",
  "new": "const immediate = true;",
  "tests": "test/chat-hardening.test.tsx",
  "red": "2 failed: 'M4.C5: a growing fence is requested at once on its first render, then only once its text holds still'; 'refinement (r): in the debounce window the block shows its new key, so the message's store is not settled'",
  "note": "plan predicted 1; the coordinator ruled the measured count on 2026-11-02 (mail 13998)"
 },
 {
  "id": "W5HA-T7-M2",
  "spec": "M4.C5",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "useEffect(() => { store?.evictUnreferenced(); });",
  "new": "",
  "tests": "test/chat-hardening.test.tsx",
  "red": "2 failed: 'M4.C5: after each commit the message's store evicts what no block references'; 'M4.C5: on the async path, the commit of the new tree evicts the superseded round's keys'"
 },
 {
  "id": "W5HA-T7-M3",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (status !== 'live') {",
  "new": "if (status !== status) {",
  "tests": "test/chat-hardening.test.tsx",
  "red": "1 failed: 'M4.C4: with no Worker the fence stays plain with its bare label, and nothing is queued'"
 },
 {
  "id": "W5HA-T7-M4",
  "spec": "re-anchored at Task 10 fix A item 3 (the chat store is made in useChatHighlightStore)",
  "pkg": "pwa",
  "file": "src/lib/highlighterContext.ts",
  "old": "highlighters.createStore(highlighters.chat, 'chat')",
  "new": "highlighters.createStore(highlighters.docs, 'chat')",
  "tests": "test/chat-hardening.test.tsx",
  "red": "6 failed: 'M4.C4: a 1 000 B and a 5 000 B message render the fence plain first, same layout and text, then coloured'; 'M4.C5: a growing fence is requested at once on its first render, then only once its text holds still'; 'M4.C5: once the fence closes, later settles, a re-render and a Copy tap add no request for it'; 'M4.C5: under StrictMode's double effects, a block's first fence is requested at once and stays pending'; 'refinement (r): in the debounce window the block shows its new key, so the message's store is not settled'; 'M4.H19 (chat half): chat's requests go to the chat highlighter, never the Docs one, and chat prewarms it on mount'",
  "note": "plan predicted 1; the coordinator ruled the measured count on 2026-11-02 (mail 13998); it grew with the fix rounds' cases"
 },
 {
  "id": "W5HA-T7-M5",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "return <code className=\"hljs\">{raw}</code>;",
  "new": "return null;",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "2 failed: 'a Docs page's block: plain, same text and label, until the worker answers; then spans, text unchanged'; 'a text leaf: plain first, then coloured, on the Docs highlighter'"
 },
 {
  "id": "W5HA-T7-M6",
  "spec": "re-anchored at Task 10 fix A item 3 (one publish line now serves the page and the text leaf; W5HA-T7-X1 is merged into this row)",
  "pkg": "pwa",
  "file": "src/lib/highlighterContext.ts",
  "old": "    highlighters.publish?.(store);\n",
  "new": "",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "2 failed: 'a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount'; 'a text leaf publishes its one-block store the same way'"
 },
 {
  "id": "W5HA-T7-M7",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "useEffect(() => { highlighters.chat.prewarm(); }, [highlighters.chat]);",
  "new": "",
  "tests": "test/chat-hardening.test.tsx",
  "red": "1 failed: 'M4.H19 (chat half): chat's requests go to the chat highlighter, never the Docs one, and chat prewarms it on mount'"
 },
 {
  "id": "W5HA-T7-M8",
  "spec": "",
  "pkg": "pwa",
  "file": "src/screens/DocsScreen.tsx",
  "old": "highlighters.docs.prewarm();",
  "new": "",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'the Docs screen prewarms the Docs highlighter on mount'"
 },
 {
  "id": "W5HA-T7-M9",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "not highlighted (took over ",
  "new": "not highlighted (took longer than ",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'M4.H7: of three blocks whose second times out, the first and third are coloured and only the second is plain'"
 },
 {
  "id": "W5HA-T7-M10",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "not highlighted (output too large)",
  "new": "not highlighted (too large)",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'M4.H13: an answer over the per-block HTML cap, whose line retry is too large as well, says \"output too large\"'"
 },
 {
  "id": "W5HA-T7-M11",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "· highlighted line by line",
  "new": "· highlighted by lines",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'M4.H18: a block that timed out and was coloured by its line retry says \"highlighted line by line\"'"
 },
 {
  "id": "W5HA-T7-M12",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "const unshow = store.show(key);",
  "new": "const unshow = (): void => undefined;",
  "tests": "test/chat-hardening.test.tsx",
  "red": "1 failed: 'refinement (r): in the debounce window the block shows its new key, so the message's store is not settled'"
 },
 {
  "id": "W5HA-T7-X1",
  "spec": "",
  "pkg": "pwa",
  "file": "src/lib/highlighterContext.ts",
  "old": "    highlighters.publish?.(store);\n",
  "new": "",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "2 failed: 'a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount'; 'a text leaf publishes its one-block store the same way'",
  "note": "re-anchored at Task 11 (Task 10 moved the publish call into highlighterContext.ts); the same mutant as W5HA-T7-M6"
 },
 {
  "id": "W5HA-T7-X2",
  "spec": "re-anchored at Task 10 fix A item 3 (the leaf now passes its one block to useDocsHighlightStore)",
  "pkg": "pwa",
  "file": "src/docs/DocsLeaf.tsx",
  "old": "[{ lang: ext, raw: text.replace(/\\n$/, '') }]",
  "new": "[]",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'a text leaf publishes its one-block store the same way'"
 },
 {
  "id": "W5HA-T7-M13",
  "spec": "M4.C5",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "|| lastKey.current === key;",
  "new": ";",
  "tests": "test/chat-hardening.test.tsx",
  "red": "1 failed: 'M4.C5: under StrictMode's double effects, a block's first fence is requested at once and stays pending'"
 },
 {
  "id": "W5HA-T7-M14",
  "spec": "M4.C5",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "useEvictAfterCommit(useContext(PreHighlightContext));",
  "new": "",
  "tests": "test/chat-hardening.test.tsx",
  "red": "1 failed: 'M4.C5: on the async path, the commit of the new tree evicts the superseded round's keys'"
 }
]
```

#### Task 8 (15 rows)

```json
[
 {
  "id": "W5HA-T8-M1",
  "spec": "M4.H4",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "import '../session/chat.css';",
  "new": "import '../session/chat.css';\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedVersion = plantedCore.versionString;",
  "tests": "test/docs-scans.test.ts",
  "red": "5 failed: 'M4.H4: highlight.js and the worker chain sit only in their homes across pwa/src'; 'M4.H4 planted: highlight.js imported in lib/markdown.tsx is red'; 'M4.H4 planted: highlightGrammars imported in DocsLeaf, and the worker entry imported by the runner, are red'; 'M4.H17 planted: the test store imported from pwa/src is red'; 'M4.H4 planted: highlight.js reached by a path into node_modules, or imported anywhere in ui/src, is red'"
 },
 {
  "id": "W5HA-T8-M2",
  "spec": "M4.H4",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "import '../session/chat.css';",
  "new": "import '../session/chat.css';\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedVersion = plantedCore.versionString;",
  "tests": "test/markdown-worker-built.test.ts",
  "red": "1 failed: 'M4.H4 (built): highlight.js core is in the highlight worker's chunk, may be in the reader's render chunk, and is in no other file'"
 },
 {
  "id": "W5HA-T8-M3",
  "spec": "M4.H15",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "dangerouslySetInnerHTML={{ __html: checked.html }}",
  "new": "dangerouslySetInnerHTML={{ __html: raw }}",
  "tests": "test/docs-scans.test.ts",
  "red": "5 failed: 'M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode'; 'M4.H15 planted: a second sink under lib/ or under docs/export/ is red'; 'M4.H15 planted: the sink name in a JSX spread is red'; 'M4.H15 planted: the sink name in a props object given to createElement is red'; 'M4.H15 planted: the sink name as an element-access key, a string key, a computed key or a shorthand is red; a comment is not'"
 },
 {
  "id": "W5HA-T8-M4",
  "spec": "M7.11",
  "pkg": "pwa",
  "file": "vite.config.ts",
  "old": "globIgnores: ['**/mermaid.frame-*.js'],",
  "new": "globIgnores: ['**/mermaid.frame-*.js', '**/markdownHighlightWorker-*.js'],",
  "tests": "test/markdown-worker-built.test.ts",
  "red": "1 failed: 'M7.11: sw.js precaches the highlight worker chunk beside the parse worker's'"
 },
 {
  "id": "W5HA-T8-M5",
  "spec": "M7.11",
  "pkg": "pwa",
  "file": "src/lib/markdownHighlightWorker.ts",
  "old": "const answer = createHighlightAnswerer();",
  "new": "void document.title;\nconst answer = createHighlightAnswerer();",
  "tests": "test/markdown-worker-built.test.ts",
  "red": "1 failed: 'M7.11: exactly one markdownHighlightWorker chunk; it loads with no DOM, says ready, and answers a typescript job with spans'"
 },
 {
  "id": "W5HA-T8-M6",
  "spec": "M7.11",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "export const chatHighlighter: Highlighter = createHighlighter();",
  "new": "export const chatHighlighter: Highlighter = createHighlighter();\nexport const plantedSpawn = () => new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url), { type: 'module' });",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M7.11: pwa/src holds exactly one new URL for the highlight worker, in spawnHighlightWorker, whatever its quoting or layout'"
 },
 {
  "id": "W5HA-T8-M7",
  "spec": "M4.H17",
  "pkg": "pwa",
  "file": "src/lib/highlighterContext.ts",
  "old": "docs: docsHighlighter, chat: chatHighlighter, createStore: createProductionStore,",
  "new": "docs: docsHighlighter, chat: chatHighlighter, createStore: (h, mode) => createProductionStore(h, mode),",
  "tests": "test/highlight-wiring.test.tsx",
  "red": "1 failed: 'HighlighterContext's default holds docsHighlighter, chatHighlighter and the production createStore, and no publish slot'"
 },
 {
  "id": "W5HA-T8-M8",
  "spec": "M4.H17",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (target === 'test' || target.startsWith('test/')) hits.push(",
  "new": "if (target === 'tests') hits.push(",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M4.H17 planted: the test store imported from pwa/src is red'"
 },
 {
  "id": "W5HA-T8-M9",
  "spec": "M4.H22",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "const deadlineMs = deps.deadlineMs ?? HIGHLIGHT_BLOCK_DEADLINE_MS;",
  "new": "const deadlineMs = deps.deadlineMs ?? 750;",
  "tests": "test/markdown-limits.test.ts",
  "red": "1 failed: 'markdownRunner.ts imports its limits from ./markdownLimits and spells none of their values'"
 },
 {
  "id": "W5HA-T8-M10",
  "spec": "M4.H3",
  "pkg": "pwa",
  "file": "test/markdown-runner.test.ts",
  "old": "/^(?:markdown|highlight).*\\.tsx?$/",
  "new": "/^(?:markdown|highlightJob|highlightGrammars).*\\.tsx?$/",
  "tests": "test/markdown-runner.test.ts",
  "red": "1 failed: 'M4.H3: the scan reads the store and the context, and a postMessage or a message listener planted in the store is red'"
 },
 {
  "id": "W5HA-T8-M11",
  "spec": "M4.H15",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "  if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isMethodDeclaration(n)) return isSinkPropertyName(n.name);",
  "new": "  if (ts.isShorthandPropertyAssignment(n) || ts.isMethodDeclaration(n)) return isSinkPropertyName(n.name);",
  "tests": "test/docs-scans.test.ts",
  "red": "3 failed: 'M4.H15 planted: the sink name in a JSX spread is red'; 'M4.H15 planted: the sink name in a props object given to createElement is red'; 'M4.H15 planted: the sink name as an element-access key, a string key, a computed key or a shorthand is red; a comment is not'"
 },
 {
  "id": "W5HA-T8-M12",
  "spec": "M4.H15",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "  if (ts.isElementAccessExpression(n)) return isSinkText(unwrap(n.argumentExpression));",
  "new": "  if (ts.isElementAccessExpression(n)) return false;",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M4.H15 planted: the sink name as an element-access key, a string key, a computed key or a shorthand is red; a comment is not'"
 },
 {
  "id": "W5HA-T8-M13",
  "spec": "M4.H4",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "const HLJS_SEGMENT = /(?:^|\\/)highlight\\.js(?:\\/|$)/;",
  "new": "const HLJS_SEGMENT = /^highlight\\.js(?:\\/|$)/;",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M4.H4 planted: highlight.js reached by a path into node_modules, or imported anywhere in ui/src, is red'"
 },
 {
  "id": "W5HA-T8-M14",
  "spec": "M4.H4",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "hits: [...found.flatMap((f) => f.hits), ...uiHits], sinks",
  "new": "hits: [...found.flatMap((f) => f.hits)], sinks",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M4.H4 planted: highlight.js reached by a path into node_modules, or imported anywhere in ui/src, is red'"
 },
 {
  "id": "W5HA-T8-M15",
  "spec": "M7.11",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "/markdownHighlightWorker(?:\\.ts)?$/.test(",
  "new": "/markdownHighlightWorker\\.ts$/.test(",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'M7.11: pwa/src holds exactly one new URL for the highlight worker, in spawnHighlightWorker, whatever its quoting or layout'"
 }
]
```

#### Task 9 (17 rows)

```json
[
 {
  "id": "W5HA-T9-M1",
  "spec": "M7.12",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "const answer = await deps.loaders.tree(p.project, null);",
  "new": "const answer = await (deps.loaders as DocsLoaders).refresh(p.project, { ref: null, reason: 'manual' }).then(() => deps.loaders.tree(p.project, null));",
  "tests": "test/docs-scans.test.ts",
  "red": "8 failed: 'its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs'; 'planted: a refresh call in the run module is red'; 'planted: a fetch of its own in the run module is red'; 'planted: a storage write in the run module is red'; 'planted: a clipboard write in the run module is red'; 'planted: another api read in the run module is red'; 'planted: the storage owner in the run module is red'; 'planted: a production highlighter singleton in the run module is red'",
  "note": "plan predicted 1: the planted cases append to the live module (the same coupling as W5HA-T3-M6)"
 },
 {
  "id": "W5HA-T9-M2",
  "spec": "M7.12",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "running.current = ctl;",
  "new": "running.current = ctl;\n        void navigator.clipboard?.writeText('');",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs'"
 },
 {
  "id": "W5HA-T9-M3",
  "spec": "M7.12 (re-measured at fix B: HighlightMeasure.tsx changed beside it)",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "loaders: api.docs,",
  "new": "loaders: { ...api.docs, projects: () => { void api.sessions; return api.docs.projects(); } },",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs'"
 },
 {
  "id": "W5HA-T9-M4",
  "spec": "M7.12",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (memberName(callee) === 'refresh') out.push(",
  "new": "if (memberName(callee) === 'refetch') out.push(",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'planted: a refresh call in the run module is red'"
 },
 {
  "id": "W5HA-T9-M5",
  "spec": "§7.8 (re-measured at fix B: its region now sits after the first-occurrence test)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "slowest.push({ grammar, chars: b.raw.length, ms: r.ms });",
  "new": "slowest.push({ grammar, chars: b.raw.length, ms: r.ms, code: b.raw } as never);",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'its text is JSON that names no project, path, file or code'"
 },
 {
  "id": "W5HA-T9-M6",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/lib/routes.ts",
  "old": "{ id: 'measure-highlighting', pattern: /^\\/settings\\/measure-highlighting\\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },",
  "new": "{ id: 'settings-section', pattern: /^\\/settings\\/([^/]+)\\/?$/, title: 'Settings', top: false, path: null },\n  { id: 'measure-highlighting', pattern: /^\\/settings\\/measure-highlighting\\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },",
  "tests": "test/app.test.tsx",
  "red": "1 failed: '`/settings/measure-highlighting` renders R19's measurement page, not the Settings frame (W5h-a)'"
 },
 {
  "id": "W5HA-T9-M7",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "test/command-registry.test.ts",
  "old": "const offered = ROUTES.filter((r) => r.path !== null && (r.top || underTop(ROUTES, r.path)));",
  "new": "const offered = ROUTES.filter((r) => r.path !== null && (r.top || r.id.startsWith('settings-')));",
  "tests": "test/command-registry.test.ts",
  "red": "1 failed: 'every Go to command targets a route app.tsx routes: the top rows of ROUTES, the ladder's one table'"
 },
 {
  "id": "W5HA-T9-M8",
  "spec": "ARCH-04",
  "pkg": "server",
  "file": "docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md",
  "old": ", `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx`",
  "new": "",
  "tests": "test/rings/totality.test.ts",
  "red": "1 failed: 'pwa/src: every file takes exactly one context from the spec's table, and the table has no stale or nested row'"
 },
 {
  "id": "W5HA-T9-M9",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "test/command-registry.test.ts",
  "old": "'go-measure-highlighting',",
  "new": "",
  "tests": "test/command-registry.test.ts",
  "red": "1 failed: 'every base command carries the id docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md §The door table names'"
 },
 {
  "id": "W5HA-T9-M10",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "test/command-registry.test.ts",
  "old": ".filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting');",
  "new": ".filter((id) => id !== 'toggle-inspector');",
  "tests": "test/command-registry.test.ts",
  "red": "1 failed: 'entries with no terms, tier or searchOnly rank exactly as before'"
 },
 {
  "id": "W5HA-T9-M11",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "        end();\n        ends.current.delete(end);",
  "new": "        ends.current.delete(end);",
  "tests": "test/highlight-measure.test.tsx",
  "red": "2 failed: 'terminates every worker it spawned once the run is done'; 'Stop mid-run terminates its workers and unmounts its roots; Start then completes with no root warning and a clean host'"
 },
 {
  "id": "W5HA-T9-M12",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "    for (const end of [...ends.current]) end();",
  "new": "",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'unmounting the page aborts the run and terminates its workers; nothing it spawned outlives it'"
 },
 {
  "id": "W5HA-T9-M13",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "root8.unmount();",
  "new": "",
  "tests": "test/highlight-measure.test.tsx",
  "red": "4 failed: 'is seen at the next frame of the streamed message, not after the rest of it'; 'Stop mid-run terminates its workers and unmounts its roots; Start then completes with no root warning and a clean host'; 'unmounting the page aborts the run and terminates its workers; nothing it spawned outlives it'; 'a highlighter that cannot answer ends the run with a line naming its answer, not \"Done.\"'"
 },
 {
  "id": "W5HA-T9-M14",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "void during.then(() => { done = true; }, () => { done = true; });",
  "new": "void during.finally(() => { done = true; });",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a rejection during item 6 raises no unhandled rejection of its own'"
 },
 {
  "id": "W5HA-T9-M15",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "if (r.outcome.kind !== 'html') throw new Error(",
  "new": "if (false as boolean) throw new Error(",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a highlighter that cannot answer ends the run with a line naming its answer, not \"Done.\"'"
 },
 {
  "id": "W5HA-T9-M16",
  "spec": "M7.12",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "['docsHighlighter', 'chatHighlighter'].includes(n.text)",
  "new": "['docsHighlighters', 'chatHighlighter'].includes(n.text)",
  "tests": "test/docs-scans.test.ts",
  "red": "1 failed: 'planted: a production highlighter singleton in the run module is red'"
 },
 {
  "id": "W5HA-T9-M17",
  "spec": "§7.8",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "const w = (p.spawn ?? spawnHighlightWorker)();\n      workers.push(w);",
  "new": "const w = (p.spawn ?? spawnHighlightWorker)();",
  "tests": "test/highlight-measure.test.tsx",
  "red": "3 failed: 'terminates every worker it spawned once the run is done'; 'Stop mid-run terminates its workers and unmounts its roots; Start then completes with no root warning and a clean host'; 'unmounting the page aborts the run and terminates its workers; nothing it spawned outlives it'"
 }
]
```

#### Task 10 (26 rows)

```json
[
 {
  "id": "W5HA-T10-M1",
  "spec": "§4.9 / §7.8 (L5-1)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "o.kind === 'html' ? o.html.length : o.kind === 'too-large' ? o.htmlChars : null;",
  "new": "o.kind === 'html' ? o.html.length : null;",
  "tests": "test/highlight-measure.test.tsx",
  "red": "2 failed: 'an answer over the HTML cap still gives its ratio, so the maximum is not censored at the cap, and the grammar says how many'; 'a crafted shape answered over the cap gives its ratio and is marked over the cap'"
 },
 {
  "id": "W5HA-T10-M2",
  "spec": "§4.9 / §7.8 (L5-1)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "        if (r.outcome.kind === 'too-large') s.overCap += 1;",
  "new": "",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'an answer over the HTML cap still gives its ratio, so the maximum is not censored at the cap, and the grammar says how many'"
 },
 {
  "id": "W5HA-T10-M3",
  "spec": "§4.9 / §7.8 (L5-1)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "overCap: r.outcome.kind === 'too-large' });",
  "new": "overCap: false });",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a crafted shape answered over the cap gives its ratio and is marked over the cap'"
 },
 {
  "id": "W5HA-T10-M4",
  "spec": "§7.8 (L5-2)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "const measured = measureHighlighter();",
  "new": "const measured = deps.highlighter(HIGHLIGHT_BLOCK_DEADLINE_MS);",
  "tests": "test/highlight-measure.test.tsx",
  "red": "2 failed: 'a shape the shipped deadline cuts off still gives its ratio, and item 6 still reports the cut'; 'items 1 to 5 and 8 ask for the measurement deadline as the boot budget; items 6 and 7 ask for the shipped deadline and no budget'",
  "note": "re-anchored at Task 11 (fix B's own later commit rewrote the line)"
 },
 {
  "id": "W5HA-T10-M5",
  "spec": "§4.9 / §7.8 (L5-4)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "deps.highlighter(MEASURE_DEADLINE_MS, MEASURE_DEADLINE_MS);",
  "new": "deps.highlighter(MEASURE_DEADLINE_MS);",
  "tests": "test/highlight-measure.test.tsx",
  "red": "2 failed: 'items 1 to 5 and 8 ask for the measurement deadline as the boot budget; items 6 and 7 ask for the shipped deadline and no budget'; 'a first boot slower than the shipped boot budget is timed by item 2, not turned into a failed run'"
 },
 {
  "id": "W5HA-T10-M6",
  "spec": "§4.9 / §7.8 (L5-4)",
  "pkg": "pwa",
  "file": "src/screens/HighlightMeasure.tsx",
  "old": "createHighlighter({ deadlineMs, spawn, ...(bootBudgetMs === undefined ? {} : { bootBudgetMs }) })",
  "new": "createHighlighter({ deadlineMs, spawn })",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a first boot slower than the shipped boot budget is timed by item 2, not turned into a failed run'"
 },
 {
  "id": "W5HA-T10-M7",
  "spec": "§7.8 (L5-8)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "const coloured = first === null ? null : await until(",
  "new": "const coloured = await until(",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'does not wait a second time for colours when the first wait found no article'"
 },
 {
  "id": "W5HA-T10-M8",
  "spec": "§7.8 (L5-9)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "          deps.signal.throwIfAborted();\n          show(",
  "new": "          show(",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'is seen at the next frame of the streamed message, not after the rest of it'"
 },
 {
  "id": "W5HA-T10-M9",
  "spec": "§7.8 (L5-10)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "      if (first) s.ms.push(r.ms); else s.repeats += 1;",
  "new": "      s.ms.push(r.ms); if (!first) s.repeats += 1;",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a block the corpus repeats is counted as a repeat and left out of the warm times and the slowest list'"
 },
 {
  "id": "W5HA-T10-M10",
  "spec": "§7.8 (L5-10)",
  "pkg": "pwa",
  "file": "src/screens/highlightMeasureRun.tsx",
  "old": "      if (first) {\n        slowest.push(",
  "new": "      if (first || !first) {\n        slowest.push(",
  "tests": "test/highlight-measure.test.tsx",
  "red": "1 failed: 'a block the corpus repeats is counted as a repeat and left out of the warm times and the slowest list'"
 },
 {
  "id": "W5HA-T10-A1",
  "spec": "§4.10 Page ceilings (L3-1)",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "    if (posted !== null) stopClock(posted.job);\n",
  "new": "",
  "tests": "test/highlight-store.test.ts",
  "red": "1 failed: 'five 700 ms jobs answered back to back: the fifth is skipped by page-worker-time 200 ms into its run'"
 },
 {
  "id": "W5HA-T10-A2",
  "spec": "§4.10 runner, M4.H8 (L2-1)",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "    worker = undefined;\n    if (bootTimer !== undefined) {\n      clearTimer(bootTimer);\n      bootTimer = undefined;\n    }\n",
  "new": "    worker = undefined;\n",
  "tests": "test/markdown-runner.test.ts",
  "red": "1 failed: 'L2-1: a boot failure's timer dies with its worker (drop() clears the boot timer)'"
 },
 {
  "id": "W5HA-T10-A3",
  "spec": "§4.10 runner, M4.H8 (L2-1)",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "    bootFailures = 0;\n    if (bootTimer !== undefined) {\n      clearTimer(bootTimer);\n      bootTimer = undefined;\n    }\n",
  "new": "    bootFailures = 0;\n",
  "tests": "test/markdown-runner.test.ts",
  "red": "1 failed: 'L2-1: a ready worker is not failed by its own boot budget (ready() clears the boot timer)'"
 },
 {
  "id": "W5HA-T10-A4",
  "spec": "§4.10 CodeBlock label (L1-2)",
  "pkg": "pwa",
  "file": "src/lib/markdown.tsx",
  "old": "(Object.hasOwn(LANG_LABEL, lang) ? LANG_LABEL[lang] : undefined)",
  "new": "LANG_LABEL[lang]",
  "tests": "test/markdown-highlight.test.tsx",
  "red": "2 failed: 'a ```__proto__ fence renders its code plain under its own name, with no throw'; 'a ```constructor fence renders its code plain under its own name, with no throw'"
 },
 {
  "id": "W5HA-T10-A5",
  "spec": "§4.10 Chat eviction (L1-3)",
  "pkg": "pwa",
  "file": "src/session/ToolWellText.tsx",
  "old": "  useEvictAfterCommit(store);\n",
  "new": "",
  "tests": "test/tool-well.test.tsx",
  "red": "1 failed: 'after the text changes and commits, the superseded text's answered entry is gone from the well's store'"
 },
 {
  "id": "W5HA-T10-A6",
  "spec": "M4.H14, D-7758 condition (L4-1)",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "      let body = end;\n",
  "new": "      let body = end;\n      if (cls.startsWith('invoke__', pos)) return false;\n",
  "tests": "test/highlight-html.test.tsx, test/markdown-bounds.test.tsx, test/markdown-highlight.test.tsx, test/highlight-wiring.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "1 failed: 'real output of every registered grammar passes, and the corpus emits the multi-class sub-scope forms'"
 },
 {
  "id": "W5HA-T10-A7",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (raw.length > highlightBlockCap(lang)) return",
  "new": "if (false) return",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "23 failed: 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'a 64 KiB ts block of \"<a>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB ts block of \"<a>\" in lines of 0 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB ts block of \"<ab>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB tsx block of \"<a>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB tsx block of \"<a>\" in lines of 0 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB tsx block of \"<ab>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB javascript block of \"<a>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB javascript block of \"<a>\" in lines of 0 characters is not highlighted and says 64 KiB (Docs)'; 'a 64 KiB javascript block of \"<ab>\" in lines of 1800 characters is not highlighted and says 64 KiB (Docs)'; 'the same ts shapes through chat's worker path are not highlighted either'; 'the same tsx shapes through chat's worker path are not highlighted either'; 'the same javascript shapes through chat's worker path are not highlighted either'; 'a 64 KiB rust block of `r#\"` lines is not highlighted and says 64 KiB, in Docs and on the worker path'; 'a ts block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a tsx block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a jsx block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a javascript block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a mjs block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a cts block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB'; 'a rust block of exactly 4 096 characters is highlighted; 4 097 is not, and says 5 KiB'; 'a rs block of exactly 4 096 characters is highlighted; 4 097 is not, and says 5 KiB'; 'a ts block of 10 000 characters the page budget refuses is labelled by its own cap: 10 KiB'"
 },
 {
  "id": "W5HA-T10-A8",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (word > MD_HIGHLIGHT_MAX_WORD_CHARS)",
  "new": "if (false)",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "9 failed: 'a ts fence holding a 257-character identifier is not highlighted and says why; 256 is highlighted'; 'a 32 KiB one-identifier python fence through SHARED_COMPONENTS never reaches highlight.js'; 'the same fence through chat's worker path (ChatMarkdown, injected parser) never reaches highlight.js'; 'a php fence of 257 `_é` units (a 514-character run) is not highlighted and says why'; 'a run of 256 code units that holds non-ASCII units still highlights; 257 does not'; 'a block that trips both bounds is labelled by its word: the word bound is checked first'; 'the label order is size, then word, then line, then whitespace'"
 },
 {
  "id": "W5HA-T10-A9",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (line > MD_HIGHLIGHT_MAX_LINE_CHARS)",
  "new": "if (false)",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "7 failed: 'a markdown block of \"[\" lines one character over the bound is not highlighted and says why'; 'a markdown block of \"[a\" lines one character over the bound is not highlighted and says why'; 'a markdown block of \"![\" lines one character over the bound is not highlighted and says why'; 'a yaml block of \"a a a \" lines one character over the bound is not highlighted and says why'; 'one long line among short ones is found, and the label carries that line length'; 'chat gets the bound through the shared components, on the synchronous path and the worker path'; 'the label order is size, then word, then line, then whitespace'"
 },
 {
  "id": "W5HA-T10-A10",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (blank > MD_HIGHLIGHT_MAX_BLANK_CHARS)",
  "new": "if (false)",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "13 failed: 'a ts block of \"\\n\" one unit over the bound is not highlighted and says why (a newline)'; 'a ts block of \" \\n\" one unit over the bound is not highlighted and says why (a space and a newline)'; 'a ts block of \"\\t\\n\" one unit over the bound is not highlighted and says why (a tab and a newline)'; 'a ts block of \"\\r\\n\" one unit over the bound is not highlighted and says why (a CRLF pair)'; 'the same shapes through Docs (parseMarkdown, renderHast, SHARED_COMPONENTS) never reach highlight.js'; 'chat gets the bound on the synchronous path and on the worker path'; 'every grammar the shared components register is bounded the same way, not only ts and js'; 'a mixed run of tabs, spaces, CR and LF counts as one run'; 'a run of \"　\\n\" (a blank unit from 0x7f up joins a run) is bounded'; 'a run of \" \\n\" (a blank unit from 0x7f up joins a run) is bounded'; 'a run of \"﻿\\n\" (a blank unit from 0x7f up joins a run) is bounded'"
 },
 {
  "id": "W5HA-T10-A11",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "else if (inScan && scan > DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS)",
  "new": "else if (false)",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "11 failed: '(a) 49 ts blocks of 8 192 characters: the first 48 (exactly 393 216) are admitted, the 49th is skipped by the scan budget'; '(b) a json block after them is still admitted: another grammar is never refused by the scan budget'; '(c) rust and javascript blocks count in the same sum, aliases included'; '(e) xml and markdown reach no bounded grammar, so they do not count in the scan sum: an xml block after the ts budget is spent is still admitted'; '(d) markdown does not count in the scan sum: a ts block after 64 KiB of markdown is admitted, and only its own sum refuses the next'; 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'C2 a tsx block fills the scan sum, at and past the boundary'; 'C3 the canonical names and js count in the scan sum, json does not'; 'C4 the language is read from the code class: case-folded, from a string className, and the first language- wins'; 'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels'; 'highlight={false} within the cap keeps its plain label, and an unregistered language over it keeps its own'"
 },
 {
  "id": "W5HA-T10-A12",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "else if (inMarkdown && markdown > DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS)",
  "new": "else if (false)",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "9 failed: '(a) three markdown blocks of 65 536 characters: the first two (exactly 131 072) are admitted, the third is skipped'; '(a2) at the budget: markdown blocks summing to exactly 131 072 are all admitted, one more character in a following markdown block is skipped'; '(b) an md block counts in the same sum, every alias highlight.js resolves to markdown included'; '(c) a yaml block and a ts block after them are still admitted: another grammar is never refused by it'; '(f) rendered: a third 64 KiB markdown block is skipped (bare label, never requested), the first two are admitted and requested and stay plain over the HTML cap until W5h-b'; 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'C4 the language is read from the code class: case-folded, from a string className, and the first language- wins'; 'C5 an md block fills the markdown sum, and ts and tsx are untouched by it'; 'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels'"
 },
 {
  "id": "W5HA-T10-A13",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightStore.ts",
  "old": "if (inScan) scan += b.raw.length;",
  "new": "",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "11 failed: '(a) 49 ts blocks of 8 192 characters: the first 48 (exactly 393 216) are admitted, the 49th is skipped by the scan budget'; '(b) a json block after them is still admitted: another grammar is never refused by the scan budget'; '(c) rust and javascript blocks count in the same sum, aliases included'; '(e) xml and markdown reach no bounded grammar, so they do not count in the scan sum: an xml block after the ts budget is spent is still admitted'; '(d) markdown does not count in the scan sum: a ts block after 64 KiB of markdown is admitted, and only its own sum refuses the next'; 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'C2 a tsx block fills the scan sum, at and past the boundary'; 'C3 the canonical names and js count in the scan sum, json does not'; 'C4 the language is read from the code class: case-folded, from a string className, and the first language- wins'; 'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels'; 'highlight={false} within the cap keeps its plain label, and an unregistered language over it keeps its own'"
 },
 {
  "id": "W5HA-T10-A14",
  "spec": "part 1 bound on the store path (L4-2); supersedes the W5P1 rows of this bound that no longer anchor",
  "pkg": "pwa",
  "file": "src/lib/highlightNames.ts",
  "old": "return grammarOf(lang) === 'markdown';",
  "new": "return false;",
  "tests": "test/markdown-bounds.test.tsx, test/docs-highlight-budget.test.tsx",
  "red": "10 failed: '(a) three markdown blocks of 65 536 characters: the first two (exactly 131 072) are admitted, the third is skipped'; '(a2) at the budget: markdown blocks summing to exactly 131 072 are all admitted, one more character in a following markdown block is skipped'; '(b) an md block counts in the same sum, every alias highlight.js resolves to markdown included'; '(c) a yaml block and a ts block after them are still admitted: another grammar is never refused by it'; '(f) rendered: a third 64 KiB markdown block is skipped (bare label, never requested), the first two are admitted and requested and stay plain over the HTML cap until W5h-b'; 'end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits'; 'C4 the language is read from the code class: case-folded, from a string className, and the first language- wins'; 'C5 an md block fills the markdown sum, and ts and tsx are untouched by it'; 'through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels'; 'inMarkdownPageBudget is true for markdown and every alias highlight.js resolves to it, and false for every other name'"
 },
 {
  "id": "W5HA-T10-A15",
  "spec": "answerer guard (L4-7)",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": " || !Number.isFinite(d.id)",
  "new": "",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "1 failed: 'a message with no finite numeric id gets no answer'"
 },
 {
  "id": "W5HA-T10-A16",
  "spec": "answerer guard (L4-7)",
  "pkg": "pwa",
  "file": "src/lib/highlightJob.ts",
  "old": "        post({ id, result: { kind: 'threw', error: errorName(e) } });\n",
  "new": "",
  "tests": "test/markdown-highlight-worker.test.ts",
  "red": "1 failed: 'a post that throws is answered once more with threw; a second throwing post is swallowed'"
 }
]
```
