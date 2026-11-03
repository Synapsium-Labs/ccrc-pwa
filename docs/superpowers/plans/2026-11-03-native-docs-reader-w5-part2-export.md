# Native Docs reader, W5 part 2 — Export Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 2 (2026-11-03): review round 1 applied ("Revisions", below). Base `ee7a9c44fb4ae45eddbba52ae11d1cb807f1f8a7` (`origin/main`, 2026-11-03: #2170, W5h-a accepted and the spec amended for D-7762 and D-7763). Rev 1 was drafted at `408d938062790c6031650d0145fc823d3200352d`, just after W5h-a merged as #2161 and Share as #2145; the two commits hold the same `pwa/`, `ui/` and `shared/` trees, so every Find block below matches at either. It replaces nothing: no earlier Export draft is carried in. Approved by the operator on 2026-11-03 with every recommendation (see "Where things stand").

**Revisions:** rev 2 applies review round 1's twelve upheld findings and one more case. Refinement (a) now names all four spec sentences it departs from and what its tap costs (one parse, one highlight pass, one docs read per image), Q1 compares the three options on those costs, and the reader comes back when the page changes, on a later return too (Task 6 Step 5, Task 8's return case, W5X-T8-M12). Refinement (h) is now a departure: `DocsScreen` and `DocsHead` compose the body's publication with the store, not `ExportSheet`, and a publication carries its text, not its pin. The View fact goes on every Markdown export, tree or plain (Task 7, W5X-T7-M7). Task 8 adds M4.EX15's worker-time ceiling through Export (W5X-T8-M11). Task 2: Step 0's printed line, `contrast.test.ts`' collection-time red and its count, and the conditional `shape-census` stage. Task 5: branch 6b's sink exception moves into Task 5, and W5X-T5-M4's 6a form. `renderHast.tsx` in the byte-identical list; "Agreed" says theme, not palette. The scoped re-check then added three fixes: under branch 6b, Task 5 also edits clause W5h-a's five planted M4.H15 cases, so it commits green; W5X-T8-M5 names the worker-time case; and Task 11 times the plain-view switch on a doc that costs something, as a check after the run, while Q1 says what is known before it.

**Scope:**
- In: spec §4.17 Export in full for Markdown, text and image leaves: the builder (`docs/export/buildExport.tsx`, `EXPORT_COMPONENTS`, the CSP, the stylesheet, the theme, the provenance, the drafts banner, the filename, the 10 MiB budget), images from memory (`ExportAssets`, the 10 s wait, the placeholders), colouring read from the page's highlight store by peek only, the settled-outcome context and its composition with W5h-a's `HighlighterContext`, the export sheet (build, then a synchronous Save through `downloadExport`), Export in the Docs header after Share, the Export chrome's census standing, and the scans. Rows: M4.EX1-EX18, M4.H21 (= M4.EX15, EX17, EX18), M4.T7's Export clause, M4.S1's Export clause, M4.SH3's and M4.SH8's Export halves (moved from Share), M5.17 as amended, M5.B9. The §7.7 "W5 Export" row and its merge gate's W5 measurements.
- Also in: the W5h-a hand-off (the `publish` slot's holder, D-7755; `copySkip` per drawn copy, D-7762; a body that fell back publishes no store, D-7763) and the three items Share carried to Export (Export after Share; `exportOffered` through Share's seam; `closedWorktreeLabel` in the provenance).
- Out: mockup export (§5.6.9, W6) and every `html` row; the reader frame's own export (the rich-docs spec's W8 row keeps Export on the plain render; refinement (a) says what the Export action does on a leaf the reader frame shows); W5h-b, W5b, W6, W7, W8b; the shared library; the contingency `export-share-file` (W6's phone pass decides whether it fires); Share's carried double-tap notice (not Export's sheet; carried on).

**Goal:** A Docs leaf can be saved as one self-contained HTML file that opens anywhere, offline, and carries nothing that runs or fetches. Tapping Export on a Markdown, text or image leaf builds the file from what the page already holds (the parsed tree, the page's highlight results, the images already loaded), shows its name, size and provenance, and saves it on a second tap. The file says where it came from (project, path, served ref, commit, the GitHub permalink or why there is none, the source, drafts), what it left out (images not loaded, code left plain, by class), and, for a draft, says so in a banner first.

**Architecture:** Export runs in the PWA and makes no request. The page's bodies publish what they show through a new context (`docs/exportBody.ts`): `DocMarkdown`'s tree with its detached URL map and link context, a plain-text body with its note, the render gate, a text leaf's text, or "the reader frame is showing". `DocsScreen` holds that publication, the page's highlight store (it provides W5h-a's `publish` slot) and a per-visit `ExportAssets` registry, which every `DocImage` fills with the bytes it already holds. `DocsHead` decides when Export is offered (`exportStateFor`, pure) and, on a tap, opens `docs/ExportSheet.tsx`, which assembles the input (`docs/export/exportInput.ts`, pure: the provenance from `docs/export/provenance.ts`, the name from `docs/export/filename.ts`) and loads the builder chunk (`docs/export/buildExport.tsx`, through one dynamic `import()`). The builder renders one React `<html>` with `react-dom/server`'s `renderToStaticMarkup`: the CSP meta, the `ccrc:*` metas, one `<style>` (`docs/export/stylesheet.ts`: @ccrc/ui's tokens and prose rules and `docs/export/export.css`, read as text), the banner, the provenance and the body through `EXPORT_COMPONENTS` (`docs/export/exportMarkdown.tsx`), whose `pre` reads the page's store with `copySkip` and `peek` and draws through `lib/markdown.tsx`'s one sink. Save calls `downloadExport` synchronously in the click.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`), React 19 (`react-dom/server.browser`'s `renderToStaticMarkup`, `useSyncExternalStore`), Vite 8 (`?raw` imports, a lazy chunk), `@ccrc/ui` (`Sheet`, `Button`, `QC_ACTIONS`, `PROSE`, `cn`), vitest 5 on jsdom (no `Worker`, no layout), `playwright-core` for the browser leg, the TypeScript AST for the scans; Node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`: §0 (`share-export` decisions 2-7 and 12, `share-drafts`, `offthread-highlight`), §4.1 (the Export rows), §4.3 items 5 and 6, §4.4 "The text leaf", §4.5 "Share and Export", §4.7's Export maps, §4.10 "The settled outcome", "Page ceilings", "Export's longest wait", §4.11 (`imagePinFor`, the image loader), §4.13 ("Export after W8"), §4.14 (the Markdown rules, Export's stylesheet, the chrome), §4.15 (M4.EX1-EX18, M4.T7, M4.S1, M4.SH3, M4.SH8), §4.17 in full, §5.4 (`saveBytes`, `downloadExport`), §5.8 (M5.17, M5.B9), §7.7's "W5 Export" row, §7.9's Export suites, §7.10's M4.H21. The rich-docs spec (`docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`): its W8a row ("Export stays on the plain render") and A22. Where the spec and the base disagree, the refinements below say so.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md`: Waves row 5 ("Part 2, Export: dispatched after W5h-a and Share merge; it does not wait for W5h-b"), the Decisions entries of 2026-10-13 (Share and Export's twelve decisions), 2026-10-15 (W5h, the Export wait and provenance rulings), 2026-11-02 (M4.SH3's and M4.SH8's Export halves move to Export) and 2026-11-03 (Share accepted; its carried notice), and "Next-wave brief (W5h-a and Share)"'s Export bullet.

**Format:** Markdown, by the operator's ruling of 2026-10-07. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 13's tools parse this file's `### Task` headings and the JSON row fences each task records.

**What changed at BASE since the spec's Export text was written (each checked at BASE, each handled below):**
- **The Markdown rules already left `session/chat.css`.** §4.14 moves them to a new `lib/markdown.css` "so that Export can include them without the rest of chat's 2 799 lines". At BASE the design system did that move: `ui/src/components/prose.css` holds `.msg-assist`, `.code-block*`, `.md-table-wrap` and the `hljs-*` colours, in `@layer components` (its header: "These travelled here from pwa/src/session/chat.css verbatim"). `chat.css` keeps only `.msg-plain*` and `.msg-img*`, chat's own elements. Refinement (b).
- **`tokens.css` lives in @ccrc/ui and declares two `@font-face` rules.** It is `ui/src/styles/tokens.css` (package subpath `@ccrc/ui/styles/tokens.css`), holds twelve palettes (`[data-theme='<id>']` blocks) and self-hosts Geist through `url('../fonts/…woff2')`. §4.17 says "`tokens.css` declares no `@font-face`" and that the export is light or dark only. Refinements (c) and (e).
- **`?raw`, not `?inline`, is the tree's form for a stylesheet's text.** W8a reads the library's frame stylesheet as `?raw` (`docs/reader/assets.ts`), and `vite.config.ts`'s `test.css.include` lets exactly `/\.css\?raw$/` through under vitest ("Vitest otherwise turns a `.css?raw` import into an empty string"). Refinement (c).
- **The reader frame shows most Markdown leaves.** W8a (#2061) mounts the shared Markdown library's reader wherever a `Worker` exists (`DocsScreen`'s `DEFAULT_READER`); `ReaderFrame` falls back to `DocMarkdown` only on its G2-G6 triggers. While the frame shows a leaf there is no plain tree, no `DetachedUrls` map and no page highlight store to export. Refinement (a).
- **Parts of Export's plumbing exist.** `saveBytes` (`docs/objectUrls.ts`, W5 part 1's refinement (t)) clicks an octet-stream blob synchronously; `imagePinFor` (`docs/docsLinks.ts`) and `planImageRef`, `rasterDataUrl`, `svgDataUrl` (`docs/DocImage.tsx`, W8a) are the image rule and its encoders; `docs-scans.test.ts`'s clause W8a already allows Export's `iframe`/`srcDoc` in `docs/export/buildExport.tsx` and `default-src 'none'` in `docs/export/policy.ts` by exact path; Share's seam (`SHARE_EXPORT_CLAUSE`, `SHARE_EXPORT_CLAUSE_FOR`, `shareRefusalSentence(why, fields, exportOffered)`, `ShareSheet`'s `exportOffered`) waits with `exportOffered={false}` in `DocsHead.tsx#ShareAction`; `closedWorktreeLabel` is in `docsText.ts` (Share's D-7768). `ExportAssets`, `downloadExport`, `DOCS_EXPORT_*`, the settled-outcome context, `EXPORT_COMPONENTS` and `docs/export/*` do not exist.
- **W5h-a's store and hand-off are on `main`.** `HighlighterContextValue.publish?` (`lib/highlighterContext.ts`) is called by `useDocsHighlightStore`, which `DocTree` and `TextBody` call; nothing provides it in production (D-7755). `HighlightStore` has `keyOf`, `peek`, `copySkip(at)` (D-7762), `subscribe()` (store-wide) and `settled()`; `lib/markdown.tsx#HighlightedCode` is the one sink; `codeBlocksOf(tree)` seeds each drawn `pre` with its own element as `at`. A body that falls back to plain text never mounts `DocTree`, so it publishes no store (D-7763).
- **No build version reaches the PWA bundle.** `BuildLine` reads `/api/fleet/health`; no `define` or constant names the build. Refinement (f).
- **`react-dom` is aliased to a directory in `vite.config.ts`**, so `react-dom/server` would resolve the package's `server.js`, which loads the Node build. Refinement (o).

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). Every Docs test injects its loaders (`docsFixtures.ts#fakeLoaders`), its parser and its highlighters; no test reaches a server or a real `Worker`.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); this wave changes no lock. The only transient directories are the scans' `mkdtemp` tree copies, the browser leg's temporary export files and Task 11's one production build (`vite build` into a `mkdtemp` directory, removed at once). Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/w5x-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/w5x-mut/` is removed at Task 13.
- **Scope.** This wave creates `pwa/src/docs/export/{policy,filename,provenance,colouring,exportAssets,exportInput,stylesheet}.ts`, `pwa/src/docs/export/{exportMarkdown,buildExport}.tsx`, `pwa/src/docs/export/export.css`, `pwa/src/docs/exportBody.ts`, `pwa/src/docs/ExportSheet.tsx`, `pwa/test/docs-export.test.tsx`, `pwa/test/docs-export-assets.test.tsx`, `pwa/test/docs-export-body.test.tsx`, `pwa/test/docs-export-sheet.test.tsx` and `pwa/browser/docs-export.browser.test.ts`. It edits `pwa/src/docs/docsText.ts`, `pwa/src/docs/objectUrls.ts`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/docs/DocsLeaf.tsx` (`TextBody` and `DocsLeaf`'s props only), `pwa/src/docs/ReaderFrame.tsx` (one import, the `ReaderShown` marker and one element), `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docs.css`, `pwa/src/lib/markdown.tsx` (`codeBlockParts` extracted from `CodeBlock`, behaviour unchanged), `pwa/src/screens/DocsScreen.tsx`, `pwa/design/audit.mjs` (one `INHERITED_GROUNDS` entry), `ui/package.json` (one `exports` subpath), `pwa/test/docs-screen.test.tsx` (one appended describe and its imports), `pwa/test/docs-object-urls.test.ts` (one appended describe and one import line), `pwa/test/docs-scans.test.ts` (one appended clause; under Task 5's branch 6b only, also clause W5h-a's `sinkVerdict` exception, its real-tree M4.H15 case renamed, and the admitted `src/docs/export/buildExport.tsx documentOf ok` entry added first to the exact sink lists of its five planted M4.H15 cases: Task 5 Step 6b says why), `pwa/test/contrast.test.ts` (one `APP_SHEETS` line, one appended describe), `pwa/test/tap-targets.test.tsx` (one import line, one inserted describe), `pwa/test/control-census.test.ts` (one registry entry), `pwa/test/markup-census.test.ts` and `pwa/test/shape-census.test.ts` (one registry entry each, only if a task's census run reports a new cluster: Tasks 2, 5 and 7 say when), and this plan (Task 12 defines `## Deviations found`, Task 13 appends `## Export results`). Byte-identical: `shared/**`, `server/src/**`, `agent/**`, `ccd/**`, `deploy/**`, `.github/**`, `ui/src/**`, `pwa/package.json`, `pwa/package-lock.json`, `pwa/vite.config.ts`, `pwa/vitest.browser.config.ts`, `pwa/index.html`, `pwa/src/lib/{highlightStore,highlighterContext,markdownRunner,highlightNames,useParsedMarkdown}.ts`, `pwa/src/lib/renderHast.tsx`, `pwa/src/docs/{share.ts,ShareSheet.tsx,docsLinks.ts,docsTree.ts,useDocsVisit.ts,DocLink.tsx}`, `pwa/src/docs/reader/**`, `pwa/src/session/chat.css`, `pwa/test/golden/**`, `README.md`. Any other file is a stop-and-ask. One allowed exception, claimed first: if the CI selection or Task 13's full server run reds a census in another programme's file that this wave's new words or files trip (as `update-move.test.ts` and `delegation-wave3.integration.test.ts` did for W5h-a), the worker stops and asks the coordinator, who rules on that file.
- **Base.** The child workspace is minted from `main` at or after `ee7a9c44fb4ae45eddbba52ae11d1cb807f1f8a7`. Task 1 Step 0 runs a **content** check, not an ancestry check (`T1-BASE-OK`), and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-03-native-docs-reader-w5-export/progress.md`.
- **Rings and seams.** `pwaRing` decides each file's ring from its facts (`server/test/rings/pwa-rings.test.ts`); an L1 file loads no `.tsx`, no store and not `lib/api.ts` at run time. L1 (pure): `docs/export/policy.ts`, `filename.ts`, `provenance.ts` (it imports `shareTargetFor` from `docs/share.ts`, a `.ts` file, for the one link rule), `colouring.ts`, `exportInput.ts`; `docsText.ts` stays L1 and takes Export's word types with `import type` only. L3 by its timer: `docs/export/exportAssets.ts` (no DOM, no request). L4: `docs/export/exportMarkdown.tsx`, `docs/export/buildExport.tsx`, `docs/exportBody.ts` (a hook), `docs/ExportSheet.tsx`, `docs/DocsHead.tsx`, `screens/DocsScreen.tsx`. `docs/export/stylesheet.ts` reads three `?raw` texts and is pure. No overloaded `null`: `ExportBodyContext`'s and `exportStateFor`'s inputs each name one meaning for `null` in their doc comments; `ExportState`, `ExportBody`, `ExportSource`, `ExportBodyInput`, `ExportAssetState`, `ExportImageDecision`, `ExportLinkTarget` and `ExportResult` are discriminated unions.
- **Exact values.** Declared once, in `docs/export/policy.ts` (Task 1): `DOCS_EXPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'"`, `DOCS_EXPORT_MAX_BYTES = 10485760`, `DOCS_EXPORT_IMAGE_WAIT_MS = 10000`, `EXPORT_PREFIX = '<!doctype html>'`, `EXPORT_GENERATOR = 'ccrc-docs-export/1'`, `EXPORT_FILENAME_MAX = 150`. Everything else is imported: `DOCS_CLASS_CAP`, `DOCS_RASTER_TYPES`, `docsApi`, `docRepoPath`, `entryView`, `admitDraft`, `contentClass`, `githubPermalink`, `resolveDocRef` from `shared/docs.ts`; `ENTRY_BADGE_TEXT`, `VIA_SENTENCE`, `closedWorktreeLabel`, `servedRefText`, `shortCommit`, `pluralS`, `fillSentence`, `kib`, the Share words from `docsText.ts`; `MD_HIGHLIGHT_BLOCK_MAX_CHARS` and the ceilings only through the store. No production file spells GitHub's address.
- **Never spelled by this wave** (W5 part 1's, W8a's and Share's lists, as they apply): a quoted `x-ccrc-docs`; a second declaration of an L0 name, a limit or a policy constant; a quoted section slug or the four slugs joined in production code (derive from `DOC_SECTIONS`; test fixtures may name `specs`); PNG magic bytes (read `DOCS_RASTER_TYPES`, or `harness.ts#onePixelPng` in the browser leg); the standalone docs server's lower-case name or directory name anywhere in `pwa/src` or this plan (M7.9; write "the shared Markdown library"); `repeat(<n>, 1fr)` in any stylesheet; the word `full` inside a `<Sheet>` tag; a hex or named colour in `docs/export/**` or in a `.docs-export` rule; `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcDoc`, `<iframe` or `window.open` anywhere under `docs/export/` or in `docs/ExportSheet.tsx` (one conditional exception, Task 5 Step 6); a string or template literal beginning `<` and a letter, `/` or `!` in those files other than `EXPORT_PREFIX`; real host, user, project, pool, account or path names (projects `demo`, branch `main`, `example-org/example-repo`, `/repo/...`, `https://a.example`); raw control bytes in fixtures (build them with `String.fromCharCode`); a numeric line citation (`file.ts` + colon + line) in any code or test file (`citations.test.ts`; cite `file#symbol`); a `D-` number outside `## Deviations found`; a `D-TBD` token in any commit (`server/test/dtbd.test.ts`); a 25-character-or-longer sentence written twice under `pwa/src`, `ui/src` or `shared/` (`literal-census.test.ts`).
- **PUBLIC REPO.** `Synapsium-Labs/ccrc-pwa` is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 13 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block below is quoted from BASE and must match exactly once; if it is absent or matches twice, stop and ask the coordinator. Cite code by `file#symbol`, never by line number. A later task that re-spells anchored code re-anchors the earlier row under the same id.
- **File-shape invariants are judged NET against BASE.** Counts a step relies on are re-derived at that step, never carried from planning.
- **Text-scan guards** use the TypeScript AST (`ts.createSourceFile`) and list their known evasions in their header as "NOT EXHAUSTIVE".
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and records the measured rows as ONE JSON fence (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`) in the SDD ledger at its last step; Task 13 copies every fence into `## Export results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `W5X-T<n>-M<k>`; `spec` carries the spec's row id (M4.EXn, M4.T7, M4.S1, M4.SH3, M4.SH8, M5.17, M5.B9) where there is one. A row's `old` and `new` quote the file's own text (a single-line row from its first non-blank character). Every row names its expected failing test file(s), the failing case(s) and a count. **A stated count is a prediction**: W5h-a and Share both measured rows above their predictions when a later task's or a fix round's test aimed at the same line also went red (ledger, 2026-11-02, "Rulings: mutation rows measured above the plan's prediction"). A row whose measured red differs from its stated red is reported to the coordinator with the extra test names; the coordinator restates it, which takes no number. A row that stays green is a stop-and-ask. A row may plant its mutation in a file this wave keeps byte-identical (W5X-T8-M11 does, in `pwa/src/lib/highlightStore.ts`): the LOW DISK restore and its sha256 check keep that file byte-identical, and the row's `git status --porcelain` check proves it.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, the census and contrast suites, the browser file, mutation runs) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `typecheck-tests`, `fleet-screen`, `session-hook`, `ccd-*`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. The browser file is `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-export.browser.test.ts )`. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` (pwa's tsconfig includes `test/` and `browser/`).
- **Deviations.** The plan's body and tasks spell no `D-` number except the issued ones it quotes from BASE (W5h-a's D-7755, D-7762 and D-7763; Share's D-7767 to D-7774); a departure is named by its refinement letter. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 12's last step defines them in `## Deviations found`. An issued number that goes unused is written without its prefix ("Issued and unused: 7xxx to 7yyy"), because `deviation-refs` reds any tracked file naming a `D-<n>` above `main`'s highest defined number. A session that cannot reach the allocator writes `D-TBD-<slug>` in its report only, never in a commit.
- **Lessons from W5h-a and Share (2026-11-03), applied here.**
  - **The PR's CI selection runs server suites a hand-picked list misses**, other programmes' closed word censuses among them (`update-move.test.ts`'s `'detach'`, `delegation-wave3.integration.test.ts`'s `retain` stem). Task 13 runs the WHOLE `server` suite in pieces before the push, not a list, and any red census outside this wave's files is a stop-and-ask (the Scope exception).
  - **The browser legs skip on a fast pull request and first run in the merge queue.** Task 13 runs `browser/docs-export.browser.test.ts`, `browser/reader-frame.browser.test.ts` and `browser/docs-headers.browser.test.ts` locally and records the counts; the PR body says the leg first runs in the queue.
  - **`deviation-refs` reds an unissued number**: see "Deviations".
  - **Mutation counts are predictions**: see "Mutation-table discipline".
- **Carried items** (the ledger's "Carried constraints (reviewers get these)" and the two plans' "Carried, not fixed", in substance):
  - From W5h-a: D-7755's holder is built here (Task 6); "`publish(null)` names no store" is handled by one body at a time (a leaf mounts one body; React runs an unmounting body's cleanup before the next body's effect, Task 6's case); D-7762's per-copy skip is read through `copySkip(at)` (Tasks 3 and 5); D-7763's fallback body is a plain body with no store to wait for (Tasks 6 and 8). "The store stops its clock when a posted job is detached" stays W5h-b's.
  - From Share: Export after Share in the header, `exportOffered` through the seam, `closedWorktreeLabel` in the provenance (Tasks 3 and 8). "The mode rule is spelled in eight places" is not taken: Export reads `DocsHead.tsx`'s private `modeOf`, and `provenance.ts` spells the rule a ninth time, recorded in "Carried, not fixed" for the follow-up that exports one `modeOf`. "A double tap followed by a cancelled native sheet leaves tap 2's notice standing" is `ShareSheet.tsx`'s and does not fall out of Export's sheet: carried on.
  - W8a's residue is W8b's; W3's, W2's, W4's, SEC-3/SEC-4 and the W7 prose residue stay with the waves the ledger names. This wave adds one item for W7: README's Export prose (§7.5), refinements included.
- **Commits.** One per task (Task 12's fixes one per finding), files staged by name, message `<area>: <what> (docs W5 Export)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Task 13 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR, which records this plan in the ledger's Plans line and the operator's answers to the planning questions (Q1 to Q6 below, in "Answered by the operator"). The departing refinements ((a), (b), (c), (e), (f), (g), (h), (w)) are written into the spec in place in that PR, each marked "(amended 2026-11-03; Export)", if the operator so rules (Share's precedent); otherwise they stay plan-only and are numbered at run-open either way. The approval of 2026-11-03 asked for no amendment: they stay plan-only.
- **The run row and the issued block.** The coordinator opens the Export run row (`planned`) and is issued a contiguous deviation block by `POST /api/ledger/deviations` at run-open, at least fourteen numbers: eight for the departing refinements (a), (b), (c), (e), (f), (g), (h) and (w), in that order, the rest for departures found while executing and in fix rounds. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the base.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `pwa/src/docs/docsText.ts`, `pwa/src/docs/objectUrls.ts`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docs.css`, `pwa/src/lib/markdown.tsx`, `pwa/src/screens/DocsScreen.tsx`, `pwa/design/audit.mjs`, `ui/package.json`, `pwa/test/docs-screen.test.tsx`, `pwa/test/docs-object-urls.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/contrast.test.ts`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts`. No Docs wave runs beside this one (W5h-b waits for the phone measurement; W5b follows Export); the desktop-polish programme's open work is the likeliest overlap on `audit.mjs`, `contrast.test.ts`, `tap-targets.test.tsx` and `control-census.test.ts`, each an append here. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-13, the base, the issued block, the claim state, `CCRC_CHROME`, and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers, `high` effort; an `opus` per-task reviewer on Tasks 3, 5, 6, 7 and 8 and a `sonnet` one on the rest; the whole-branch panel on `opus` (Task 12) with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill, any `gh` write verb, any token in an argv, approval-prompting shell forms, and a `CCRC_SW_DENYLIST` covering `/docs`.
- **Worker flow:** the worker acks, runs Tasks 1-11 with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalation to the operator: Task 11's build-time measurement, if a build at `DOCS_MAX_RENDER_ELEMENTS` or at a 10 MiB output takes longer than the parse budget (§4.17, the merge gate); a measurement the plan branches on (Task 5 Step 6) that lands outside its branches is a stop-and-ask to the coordinator. Task 12 is the held-out whole-branch review and its fix wave. Task 13 closes: the suites, the browser files, the whole mutation table, `## Export results` (that commit is the `handoffCommit` and the tip), push, the ONE pull request, the fingerprint with that PR's number and `prPhase: 'open'`, and the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming five lenses: (1) what the file can do (inert by construction, the CSP and its order, every URL-bearing attribute, the stylesheet's text, the scans and their controls, M5.B9's three builds); (2) what the file says (the provenance and the banner against the page, the closed labels and words, no path or session id, the drafts table, the colouring classes, the images not included); (3) when Export is offered and what it reads (the settled-outcome publications, the store hand-off, the pin and the text it answers, the reader path, the raster and SVG leaves, the sheet's lifetime); (4) the save (two phases, the synchronous Save, octet-stream only, the lazy chunk and its failure, the size budget and its order); (5) the test and mutation table, the census standing (contrast, control, markup, literal, shape, tap targets), rings, the measurements, and spec and deviation fidelity, plus the public-repo scan.
- **Merge gate** (§7.7's W5 Export row): the operator's approval of this plan; W5h-a and Share merged (they are, #2161 and #2145; W5h-b does not hold Export back); every Export row green; §4.17's W5 measurements recorded in `## Export results` (the head order and the `<style>` text, Task 5; `?raw` under vitest and the build, Task 2; the build's time at `DOCS_MAX_RENDER_ELEMENTS` and at a 10 MiB output on desktop Chromium, and the builder chunk's size, Task 11); M5.B9 green; an Export build time over the parse budget goes to the operator; the reviewer's report accepted by the coordinator; the PR's required checks green, and `browser (pwa)` green in the merge queue (a fast PR skips it). No R1/R2 gate: Export changes no server route.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel); the coordinator or operator rolls it out fleet first (`ccrc rollout --to vX.Y.Z`; Export is PWA-only). Export is then live on the dev channel. W5b follows (RD23). W6's phone pass measures Save on iOS and Android (`export-share-file`).

## Review Focus

The untrusted inputs a person meets first, each pinned in the task that owns it:

| Input | What could go wrong | Pinned by |
|---|---|---|
| A document's own text (a hostile h1 ending `</title>`, raw HTML, a `<br class=x>`, hostile link and image targets) | Markup, a script, a frame, a form or a fetch in the saved file; the banner hidden by the document's own style | Task 5 (M4.EX2's structural half: W5X-T5-M1 to M4), Task 10 (M4.EX2's scan: W5X-T10-M1, M2), Task 11 (M5.B9's three builds: W5X-T11-M1, M2) |
| An SVG leaf's bytes (a `<script>`, an `onload`, an external `href`) | Inlined as markup, it runs or fetches | Task 5 (exactly one `img[src^="data:image/"]`: its SVG case), Task 10 (no sink, no markup string: W5X-T10-M1) |
| The tree answer's worktree paths, failure details and candidates | A fleet path, a user name or a session id leaves in the file | Task 3 (the closed label and M4.EX5's sweep: W5X-T3-M1, M2), Task 1 (closed words: W5X-T1-M2) |
| The page's highlight store (a worker's HTML, a forged plain string) | A second sink, an unchecked string inserted, a highlight call from the build, a block left plain without saying so, a wait that never ends | Task 5 (peek only, the sink's check: W5X-T5-M6, M7), Task 3 (the provenance classes: W5X-T3-M4 to M6), Task 8 (the worker-time ceiling ends the wait: W5X-T8-M11), Task 10 (M4.EX17's closure: W5X-T10-M5) |
| A re-list during the visit, a parse in flight, a body that answers another text, a reader frame that shows the leaf | Export saves a commit, a text or a body the page is not showing | Task 6 (the publications: W5X-T6-M1 to M4), Task 8 (`exportStateFor`: W5X-T8-M1 to M6; the reader's return: W5X-T8-M12) |
| Images (one loading, one deferred, an `fp` that changed, one past 10 MiB) | A fetch on export, old bytes, a body cut, a file over the cap | Task 4 (the registry: W5X-T4-M1 to M4), Task 5 (the wait, the order, the cap: W5X-T5-M8 to M10) |
| The Save tap | A lost user activation; a `text/html` blob; the export rendered in the sheet | Task 7 (M4.EX13: W5X-T7-M1), Task 4 (M4.EX8: W5X-T4-M5), Task 10 (M4.EX16: W5X-T10-M3, M4) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/src/docs/export/policy.ts` | 1 | L1 | `DOCS_EXPORT_CSP`, `DOCS_EXPORT_MAX_BYTES`, `DOCS_EXPORT_IMAGE_WAIT_MS`, `EXPORT_PREFIX`, `EXPORT_GENERATOR`, `EXPORT_FILENAME_MAX`; the closed word types `ExportMissing`, `ExportPlain` |
| `pwa/src/docs/export/filename.ts` | 1 | L1 | `exportFilename` (M4.EX9) |
| `pwa/src/docs/docsText.ts` | 1, 8 | L1 | `EXPORT_TEXT`, `EXPORT_FACT`, `EXPORT_MISSING_SENTENCE`, `EXPORT_PLAIN_SENTENCE`; five `DOCS_HEAD_TEXT` keys (Task 8) |
| `pwa/test/docs-export.test.tsx` | 1-3, 5 | — | the words (M4.EX5, EX18 maps), the filename (EX9), the stylesheet (EX10, EX14 as refined), the provenance (T7, EX5, EX6), the colouring (EX18), the builder (EX1-EX4, EX7, EX10, EX18) |
| `pwa/src/docs/export/export.css`, `pwa/src/docs/export/stylesheet.ts`, `ui/package.json`, `pwa/design/audit.mjs`, `pwa/test/contrast.test.ts` | 2 | — / L1 | the export's chrome, tokens only; `EXPORT_CSS` derived from three texts; the registrations (M4.S1, M4.EX10) |
| `pwa/src/docs/export/provenance.ts`, `pwa/src/docs/export/colouring.ts` | 3 | L1 | `exportProvenance`, `colouringNotes`, `missingNotes`; `exportEntry`, `exportColouring` |
| `pwa/src/docs/export/exportAssets.ts`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/objectUrls.ts`, `pwa/test/docs-export-assets.test.tsx`, `pwa/test/docs-object-urls.test.ts` | 4 | L3 / L4 / L3 | the per-visit registry and its wait; `DocImage` reports what it holds; `downloadExport` (M4.EX3, EX8, M5.17) |
| `pwa/src/lib/markdown.tsx`, `pwa/src/docs/export/exportMarkdown.tsx`, `pwa/src/docs/export/buildExport.tsx` | 5 | L4 | `codeBlockParts`; `EXPORT_COMPONENTS`, `ExportCode`, `exportLinkTarget`; `buildExport` |
| `pwa/src/docs/exportBody.ts`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/docs-export-body.test.tsx` | 6 | L4 | the settled-outcome context and its publishers; the screen's holders (the body, the store through `publish`, the registry, the plain view) |
| `pwa/src/docs/export/exportInput.ts`, `pwa/src/docs/ExportSheet.tsx`, `pwa/test/docs-export-sheet.test.tsx` | 7 | L1 / L4 | `exportInputOf`; the sheet, two phases (M4.EX13) |
| `pwa/src/docs/DocsHead.tsx`, `pwa/test/docs-screen.test.tsx` | 8 | L4 | `exportStateFor`, `ExportAction`, the Share seam, the plain-view line (M4.SH3, SH8, EX12, EX15) |
| `pwa/src/docs/docs.css`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts` | 9 | — | the Export chrome, no colour of its own; both tap-target halves |
| `pwa/test/docs-scans.test.ts` | 10 | — | M4.EX2's scan, M4.EX11, M4.EX16, M4.EX17, M4.T7's Export clause |
| `pwa/browser/docs-export.browser.test.ts` | 11 | — | M5.B9; the W5 time and size measurements |

## Spec refinements (decided while planning)

Each refinement says What, Why and Cost if wrong. A **departure** contradicts a spec sentence and gets one issued number in `## Deviations found` (Task 12's last step), in the order (a), (b), (c), (e), (f), (g), (h), (w). The rest fill a silence or follow the base, and get no number.

- **(a) On a leaf the reader frame shows, Export first switches the page to the plain view, then saves that view. Departure.**
  - What: when a Markdown leaf's body is the reader frame (`ReaderFrame` in its rendering, mounting or ready state), Export is enabled and reads "Export (plain view)". A tap does not open the sheet: it turns the reader off for this page (`DocsScreen` holds the page URL it was turned off at; `DocsLeaf` gets `reader={null}` there), so `MarkdownBody` mounts `DocMarkdown`, and a line under the header says "Showing the plain view, which Export saves." From then on Export follows the plain view's states (Formatting…, Highlighting…, then Export) and saves what the plain view shows. Every export of a `markdown`-class leaf carries a "View" fact, "Docs' plain view; the rich view's layout is not kept.", whatever its body (the parsed tree or plain text) and whether or not a reader was ever shown: `exportInputOf` reads the leaf's class (Task 7, W5X-T7-M7). Leaving the page brings the reader back, on a later return too: an effect keyed on the page URL clears the switch (Task 6 Step 5; Task 8's return case, W5X-T8-M12).
  - What the tap costs: the switch, not the build, does what Export otherwise never does. Once per page, it runs one parse of the leaf's text, one highlight pass over the page's blocks (within the page ceilings) and one docs file read per image the plain view shows, through the screen's queue: `DocImage` loads its own bytes, and the frame's images, which `reader/images.ts` loaded as `data:` URLs, are not reused. The reader's layout and Mermaid drawings leave the page until the reader returns, and the exporter taps once more, then waits for the plain view to settle. This is the work, and the limits (`DOCS_PARSE_BUDGET_MS`, the page highlight ceilings, `DOCS_MAX_IMAGES_PER_PAGE`), of opening that page in the plain view, which a browser without a `Worker` does on every open. The build that follows still makes no request, no parse and no highlight call. Task 11 Step 4 times the switch after the run, on desktop Chromium and a CPU-throttled proxy, as a check of the ruled option; W6's phone pass times it on a phone.
  - Departs from four spec sentences: §4.17's "When it is offered" (it has no reader case); §4.17's opening "Export makes no docs request" and Figure 2's note "no docs request, no re-parse, no highlighting" (the switch Export's tap starts makes all three, once per page); and §4.13's "Until W8, every page uses the plain pipeline", which W8a made untrue.
  - Why: the rich-docs spec's W8a row rules "Export stays on the plain render, as it is", and base §4.13 lets W8 keep Export on the plain render "with the provenance saying so". At BASE the reader frame produces no hast tree, no URL map and no page highlight store, so there is nothing plain to export until a plain view is drawn. Of the three ways to get one (Q1), drawing it on the page does the same work as drawing it off screen (the same parse, highlight pass and image reads), reuses the plain view's own publications, store and image registry rather than a second pipeline, and keeps §4.17's "the leaf as shown" literal: at Save, the screen shows what the file holds.
  - Cost if wrong: if the operator rules Export absent while the reader shows (Q1's B), `exportStateFor`'s reader arm answers `absent`, and `onPlainView`, the plain-view line, the effect, two words and two cases go. Q1's C needs a hidden body of its own, with its own states.
- **(b) The Markdown rules are not moved to `lib/markdown.css`: @ccrc/ui's `prose.css` already holds them, and Export includes it. Departure.**
  - What: §4.14's move (the Markdown block of `chat.css` to `lib/markdown.css`, `lib/markdown.tsx` importing it in place of `../session/chat.css`, the `chat.css` keys re-keyed) is not made. Export's stylesheet includes `ui/src/components/prose.css`, the design system's copy of those rules. M4.EX14's guard becomes a derivation test: `EXPORT_CSS` equals tokens, prose and `export.css`, each less its comments and `@font-face` blocks, read from disk (Task 2, W5X-T2-M1). M4.S1's "the moved Markdown entries re-keyed to `markdown.css`" has nothing to re-key.
  - Why: at BASE `chat.css` holds no Markdown rule Export needs (its remaining `.msg-plain*` and `.msg-img*` are chat's elements, and the export draws its own image and plain-text classes), and prose.css is a standalone file of exactly the rules the export needs, so moving anything would only churn the cascade the move was meant to preserve.
  - Cost if wrong: none to the export; if the operator still wants `lib/markdown.css`, it is a CSS-only follow-up with M4.EX14's build comparison.
- **(c) The stylesheet's text arrives through `?raw`, not `?inline`, less comments and `@font-face`. Departure.**
  - What: `docs/export/stylesheet.ts` imports `@ccrc/ui/styles/tokens.css?raw`, `@ccrc/ui/styles/prose.css?raw` and `./export.css?raw`, removes `/* … */` comments and every `@font-face { … }` block from each, and joins them as `EXPORT_CSS`. Departs from §4.14's "imported with Vite's `?inline`" and §4.17's "`tokens.css` declares no `@font-face`".
  - Why: `?raw` is the form the tree already uses for a stylesheet's text (W8a's `docs/reader/assets.ts`), and the one `vite.config.ts` lets through under vitest (`test.css.include`), so the tests read the real text; `?inline` would run the Tailwind plugin over files with Tailwind directives and is empty under vitest. Geist's `@font-face` names font files by `url()`, which the export's CSP refuses and M4.EX2 forbids; without it the token stacks (`--family-ui`, `--family-mono`) fall back to system faces, the spec's intent ("A Markdown export uses system fonts only"). The comments go too: `tokens.css` is mostly prose, and one of its comments spells `url()`.
  - Cost if wrong: if a later stylesheet needs Vite's processing (a Tailwind directive that must be compiled), the export carries it as written and the browser ignores it.
- **(d) prose.css is reached through a new `@ccrc/ui` subpath, `./styles/prose.css`.** One line in `ui/package.json`'s `exports`, beside the three existing style subpaths, so pwa never imports ui's source by a relative path. Not a departure. Cost if wrong: one line moves to a relative import.
- **(e) The export pins the exporter's palette, any of the twelve. Departure.**
  - What: `<html data-theme>` carries the `data-theme` value `applyTheme` stamped on the exporter's document (`'light'`, `'nord'`, `'github-light'` and so on), and no attribute for the dark Phosphor default, which `applyTheme` applies by removing it. `tokens.css` carries every palette block, so the recipient sees the sender's palette. Skins (`data-skin`) are not carried: the export uses the default skin's tokens. Departs from §4.17's "`<html data-theme="light">`, or no attribute" (written when there were two palettes) and M4.EX10's "a light exporter gives `data-theme="light"`, a dark one no attribute", which still hold for Phosphor's two palettes.
  - Why: decision 12 is "the export pins the exporter's theme"; at BASE a theme is one of twelve palettes.
  - Cost if wrong: one line in `ExportSheet` maps any dark palette to no attribute and any light one to `light`.
- **(f) The provenance names no build version. Departure.**
  - What: §4.17's provenance lists "the time it was exported (ISO 8601, UTC) and the build version". The PWA bundle holds no build version at BASE (`BuildLine` reads `/api/fleet/health`), and Export makes no request, so the provenance carries the export time and the `generator` meta's format version (`ccrc-docs-export/1`) only.
  - Why: a build version needs a build-time `define` in `vite.config.ts` and a stamp the build does not have, a change outside Export.
  - Cost if wrong: a later wave adds the `define` and one fact; files exported before then cannot say which build made them.
- **(g) `ExportAssets` is a per-visit registry in `docs/export/exportAssets.ts`, reached through `DocsAssetContext`, reference-counted per image key, holding bytes. Departure.**
  - What: §4.1 and §4.3 item 6 put "the per-leaf `ExportAssets` registry" in `useDocsVisit.ts`, holding "the raster `Blob`s and SVG `data:` strings that `DocImage` already holds". `DocsScreen` creates one registry per visit beside the image queue (`createExportAssets`) and gives it to every image through `DocsAssetContextValue.exportAssets`; each `DocImage` tracks its key (`docsApi.file(project, pin)`, which names the pin exactly, a draft's `fp` included) while it shows it, and reports `loading`, then the verified raster bytes with their table MIME (the `Uint8Array` it already holds; `DocImage` never makes a `Blob` but the object URL's) or the SVG's `data:` URL, or `failed`; the last image showing a key releases it. So the registry holds what the page shows and nothing else, and "cleared when the leaf's pin changes" follows from the images remounting.
  - Why: the bytes live in `DocImage`'s load, not in the visit's slots, and the asset context already reaches every image (the raster leaf's own included) without threading the visit through `DocLinkContext`. Two images of one key share one row.
  - Cost if wrong: none to behaviour; the registry moves into `useDocsVisit` and the context carries it from there.
- **(h) Whichever body is on screen publishes what it shows through `docs/exportBody.ts`; `DocsScreen` holds that beside the page's store, and `DocsHead` composes the two. Departure.**
  - What: each body publishes what it shows, in an effect, and withdraws it on cleanup: `DocTree` (the tree, its text, its URL map and its link context), `DocPlain` (its text and note: an unformatted outcome, Show as text, not UTF-8, the doc-body boundary's fallback, the reader's timeout), `DocMarkdown`'s gate, `TextBody` (its text and the grammar it matched, or none), and a marker inside `ReaderFrame`'s frame arm. "Formatting…" publishes nothing. `DocsScreen` holds the publication and the page's store (refinement (i)) side by side; `DocsHead#exportStateFor` composes them at every render, and the header hands the composed `ExportSource` (the body with its store) to `ExportSheet` in the request, so the sheet reads neither context. A publication carries the text its outcome answers, not the pin: `exportStateFor` compares that text with the opened file answer's text and takes the pin from the file slot, so an outcome that answers another text is never exported (M4.EX15).
  - Departs from §4.4's "when Export lands, `ExportSheet` composes the two" and §4.10's "the outcome it rendered, the pin and text that outcome answers" (the publication carries the text alone). §4.10's "Export's run builds it, and composes the two" holds: this run composes them, in `DocsHead`.
  - Why: `ExportSheet` opens from the header, outside the body's context tree, so it cannot read what a body publishes into a context; `DocsScreen` is the nearest component above both, and the header needs the composed state before any sheet exists, to decide whether Export is enabled. As for the pin: the file slot's pin is the one the opened text answers, equal texts parse to the same outcome, and the provenance names the file slot's pin either way.
  - Cost if wrong: a `pin` field on `ExportBody`'s `tree`, `plain` and `text` arms and one more comparison in `exportStateFor`; or a context `DocsScreen` provides around the header, read by the sheet.
- **(i) The page's highlight store reaches Export through W5h-a's `publish` slot, held by `DocsScreen` (D-7755). Not a departure.** `DocsScreen` provides a nested `HighlighterContext` value (the context's own value plus `publish`), memoised on the outer value so `useDocsHighlightStore`'s memo is stable. A tree body with no store published reads as "Highlighting…"; a plain body needs none (D-7763). Composing the store with the body's publication is (h)'s.
- **(j) A raster leaf's Export waits for its own image to load; a failed image disables Export; an over-cap raster has no Export. Not a departure.** §4.3 item 5 keeps "the image is loaded" for Export (Share's D-7771 amended it for Share only). The registry entry at `pinFor`'s key: absent or `loading` reads "Updating to <short>…"; `failed` reads "Image not loaded", disabled; a raster over `DOCS_CLASS_CAP.raster`, which `DocImage` refuses without a load, has no bytes, so Export is absent, as for a withheld new file.
- **(k) A file slot that settled without bytes to show (failed, `too-large`, `changing`, a client slot, an answer with no bytes) has no Export. Not a departure.** Fills a silence: there is nothing on screen to save; Download stays.
- **(l) The exported `<title>` is the document's first `h1` text, else the file name. Not a departure.** M4.EX2 asserts "the title text equals the input" for a hostile h1, so the title is the h1; a text, plain or image body has none, so it is the leaf's name.
- **(m) Links (`EXPORT_COMPONENTS.a`).** A `doc` link's own fragment is not carried onto the permalink (GitHub prefixes heading ids); a permalink refusal and an inert link carry a `title` from the closed Share and inert-link sentences; a `mailto:` link takes the external arm, as the table says. Not a departure.
- **(n) `EXPORT_COMPONENTS` overrides `a`, `img` and `pre`; the table wrapper stays `SHARED_COMPONENTS`'.** At BASE `TableWrap` is a plain `div.md-table-wrap` with no scroll control, which is what §4.17 asks the fourth override for. Not a departure.
- **(o) The builder imports `renderToStaticMarkup` from `react-dom/server.browser`.** `vite.config.ts` aliases `react-dom` to a directory, so `react-dom/server` resolves the package's `server.js`, which loads the Node build into a browser chunk. The scans match both specifiers. Not a departure.
- **(p) `buildExport(input, limits?)`.** The second argument (`{ maxBytes, imageWaitMs }`) defaults to `policy.ts`'s two values; `ExportSheet` passes none (Task 10's scan pins it), and tests pass small values so a size case need not build 10 MiB. Not a departure.
- **(q) Exactly one doctype.** `buildExport` joins `EXPORT_PREFIX` to the rendered markup in one place, after removing a doctype React may have written at its start, so the file holds exactly one whichever way React behaves (Task 5's measurement records which). Not a departure.
- **(r) "Images are inlined in document order while the file fits" is a prefix.** The first image that does not fit, and every image after it, becomes an `over-size` placeholder; a later small image does not skip ahead. Not a departure.
- **(s) The provenance's link is Share's link.** `exportProvenance` calls `shareTargetFor(tree, page, opened)`, so the commit, the permalink, the refusal and the `onRef` notes follow Share's rules exactly (D-7767's same-blob rule included). A draft's link is the committed version at C, labelled "Committed version on GitHub". Not a departure.
- **(t) The closed words.** `ExportMissing` (`refused`, `external`, `deferred`, `failed`, `timed-out`, `over-size`) and `ExportPlain` (`over-cap`, `page-ceiling`, `timeout`, `too-large`, `failed`, `no-worker`, `part1-bounds`), with their sentences in `docsText.ts` (§4.17: "The plan lists the words"). A block the worker called `unregistered`, and one whose entry is `html` but whose `checked` the sink would refuse, are counted as the sink draws them: not at all, and `failed`. `part1-bounds` goes with W5h-b (M4.H23). Not a departure.
- **(u) The sheet builds as soon as it opens.** One tap opens it and starts the build ("Building…"); Save is the second tap (decision 7's two phases). The sheet is keyed like Share's (the page, the tree's commit, the opened pin), so a re-list or a back gesture closes it. Not a departure.
- **(w) The export sheet's chrome paints no colour, so it registers nothing. Departure.**
  - What: `.docs-export*` (the header's Export and the export sheet) sets no ink, ground or border colour: the button wears `.docs-action`, and the sheet inherits the `Sheet` panel's measured ink and ground. A test holds that no `.docs-export` rule sets one (Task 9, W5X-T9-M1). Departs from M4.S1's "the … Export chrome … registered" and §4.14's "The Export chrome joins the registrations too", for the sheet's chrome only, as Share's D-7770 did for Share's; the exported FILE's own chrome, `export.css`, is registered (Task 2).
  - Why: a registration names a ground for an ink a rule sets; with none set there is nothing to register, and the frozen census admits no entry without a rule.
  - Cost if wrong: a quieter ink for the sheet's notes needs an `INHERITED_GROUNDS` entry on the Sheet's ground and a contrast measurement; the guard says so.
- **(v) M4.EX16's `<iframe`/`srcDoc` clause is "nowhere in `pwa/src`" in W5**, including `docs/export/buildExport.tsx`; clause W8a's exact-path allowance stays for W6, which relaxes this clause when its wrapper lands. Not a departure.
- **Measurements, not departures:** React 19's head order, its `<style>` text and its doctype (Task 5); `?raw` under vitest and in the production build (Task 2, Task 11); the build's time and the chunk's size (Task 11).

### Task 1: Export's limits, its closed words and the file name (M4.EX5's maps, M4.EX9, M4.EX18's map; refinement (t))

**Model routing:** `sonnet`, effort `medium`. Little judgment: the values are the spec's, the words the plan's.

**Spec rows:** §4.7's Export maps, §4.17 ("CSP", "Size", "Filename", "Placeholder text is closed", "Closed words"), M4.EX5 (the map half), M4.EX9, M4.EX18 (the map half); refinement (t).

**Files:**
- Create: `pwa/src/docs/export/policy.ts`, `pwa/src/docs/export/filename.ts`, `pwa/test/docs-export.test.tsx`.
- Modify: `pwa/src/docs/docsText.ts` (one import line; one appended block).
- Guards (not edited): `pwa/test/literal-census.test.ts`, `pwa/test/docs-share.test.ts`, `server/test/rings/pwa-rings.test.ts`, `server/test/single-definition/` (the whole directory).

**Interfaces:** Produces, in `policy.ts`: `DOCS_EXPORT_CSP`, `DOCS_EXPORT_MAX_BYTES`, `DOCS_EXPORT_IMAGE_WAIT_MS`, `EXPORT_PREFIX`, `EXPORT_GENERATOR`, `EXPORT_FILENAME_MAX`, `type ExportMissing`, `type ExportPlain`; in `filename.ts`: `exportFilename(project: string, pin: DocPin, commit: string): string`; in `docsText.ts`: `EXPORT_TEXT`, `EXPORT_FACT`, `EXPORT_MISSING_SENTENCE: Record<ExportMissing, string>`, `EXPORT_PLAIN_SENTENCE: Record<ExportPlain, string>`.

**Decisions:** (1) The limits and the word types live in `policy.ts`, never in `lib/markdownLimits.ts` ("limits on a saved file", §4.17). (2) Both closed maps name a class, never an instance, and hold no `{field}`; a count is a number beside the sentence (`EXPORT_TEXT.missing`, `EXPORT_TEXT.plainBlocks`). (3) `docsText.ts` takes the two word types with `import type` only, so it stays L1. (4) The file name cuts from its end, so the path goes first, then the section, then the project, and the tail (`_<short8>[-draft].html`) is always whole. (None departs.)

- [ ] **Step 0: Base, claims, counts.** Run:
  `git grep -qF "export function saveBytes(name: string, bytes: Uint8Array<ArrayBuffer>): void {" HEAD -- pwa/src/docs/objectUrls.ts && git grep -qF "export function closedWorktreeLabel" HEAD -- pwa/src/docs/docsText.ts && git grep -qF "exportOffered={false}" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "readonly publish?: (store: HighlightStore | null) => void;" HEAD -- pwa/src/lib/highlighterContext.ts && git grep -qF "copySkip(at: object): SkipCeiling | null;" HEAD -- pwa/src/lib/highlightStore.ts && test ! -e pwa/src/docs/export && test ! -e pwa/src/docs/ExportSheet.tsx && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Record BASE (`git rev-parse HEAD`) in `.superpowers/sdd/2026-11-03-native-docs-reader-w5-export/progress.md`. Confirm the claim on `docsText.ts`. Record the counts of the guard suites above.
- [ ] **Step 1: Write `pwa/test/docs-export.test.tsx`** with exactly this content (Tasks 2, 3 and 5 replace its import block and append to it):

```tsx
// Docs W5 Export (spec 2026-10-01 4.7, 4.14, 4.17; native Docs reader W5, Export): what an export holds, pure and built.
// Task 1, the words and the name (M4.EX5's and M4.EX18's maps, M4.EX9). Task 2, the stylesheet (M4.EX10, M4.EX14 as
// refinement (b) reads it). Task 3, the provenance and the colouring (M4.T7, M4.EX5, M4.EX6, M4.EX18). Task 5, the
// builder (M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`, `https://a.example`.
import { describe, expect, it } from 'vitest';
import type { DocPin } from '../../shared/docs';
import { EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import { exportFilename } from '../src/docs/export/filename';
import { EXPORT_FILENAME_MAX } from '../src/docs/export/policy';
import { COMMIT_A, FP_1, SERVED } from './docsFixtures';

const SHORT_A = COMMIT_A.slice(0, 8);
const committedPin = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const draftPin = (path: string): DocPin =>
  ({ kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp: FP_1 });

describe('the Export words (spec 4.7, 4.17; M4.EX5, M4.EX18)', () => {
  it('EXPORT_MISSING_SENTENCE has one sentence per placeholder word, and none takes a field', () => {
    expect(Object.keys(EXPORT_MISSING_SENTENCE).sort())
      .toEqual(['deferred', 'external', 'failed', 'over-size', 'refused', 'timed-out']);
    for (const s of Object.values(EXPORT_MISSING_SENTENCE)) expect(s).not.toContain('{');
  });

  it('EXPORT_PLAIN_SENTENCE has one sentence per class of plain block, and none takes a field', () => {
    expect(Object.keys(EXPORT_PLAIN_SENTENCE).sort())
      .toEqual(['failed', 'no-worker', 'over-cap', 'page-ceiling', 'part1-bounds', 'timeout', 'too-large']);
    for (const s of Object.values(EXPORT_PLAIN_SENTENCE)) expect(s).not.toContain('{');
  });

  it("the sheet's failure and wait sentences are spec 4.17's", () => {
    expect(EXPORT_TEXT.tooLarge).toBe('Too large to export; use Download.');
    expect(fillSentence(EXPORT_TEXT.couldNotStart, { error: 'TypeError' })).toBe('Export could not start (TypeError).');
    expect(fillSentence(EXPORT_TEXT.failed, { error: 'RangeError' })).toBe('Export failed (RangeError).');
    expect(fillSentence(EXPORT_TEXT.deferred, { k: 2, s: 's' })).toBe('2 images not loaded; tap Load image first.');
  });
});

describe('exportFilename (spec 4.17 "Filename"; M4.EX9)', () => {
  const SAFE = /^[A-Za-z0-9._-]+$/;

  it("is <project>_<section>_<path with '/' as '__'>_<short8>.html", () => {
    expect(exportFilename('demo', committedPin('d/a.md'), COMMIT_A)).toBe(`demo_specs_d__a.md_${SHORT_A}.html`);
  });

  it('ends -draft.html for a draft', () => {
    expect(exportFilename('demo', draftPin('a.md'), COMMIT_A)).toBe(`demo_specs_a.md_${SHORT_A}-draft.html`);
  });

  it.each([
    ['non-ASCII letters', 'café/naïve.md', 'caf-__na-ve.md'],
    ['spaces and quotes', 'a b/"c".md', 'a-b__-c-.md'],
    ['a control byte', `a${String.fromCharCode(1)}b.md`, 'a-b.md'],
  ])('turns every character outside [A-Za-z0-9._-] into "-" (%s)', (_name, path, want) => {
    const name = exportFilename('demo', committedPin(path), COMMIT_A);
    expect(name).toMatch(SAFE);
    expect(name).toBe(`demo_specs_${want}_${SHORT_A}.html`);
  });

  it('is at most 150 characters: the path is cut first, and the tail stays whole', () => {
    const name = exportFilename('demo', draftPin(`${'x'.repeat(300)}/a.md`), COMMIT_A);
    expect(name).toHaveLength(EXPORT_FILENAME_MAX);
    expect(name.startsWith('demo_specs_xxx')).toBe(true);
    expect(name.endsWith(`_${SHORT_A}-draft.html`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: the file fails to load (`docs/export/filename` does not exist).
- [ ] **Step 3: Write `pwa/src/docs/export/policy.ts`:**

```ts
// Export's limits, its policy and its closed words (spec 2026-10-01 4.17; native Docs reader W5, Export). These are
// limits on a saved file, not render limits, so they live here and not in `lib/markdownLimits.ts`; a PWA policy lives
// in the PWA (spec 4.17 "CSP"). Each value is declared once here and imported wherever it is read. The sentences for
// the two word types are `docsText.ts`'s (`EXPORT_MISSING_SENTENCE`, `EXPORT_PLAIN_SENTENCE`).
//
// Ring L1: constants and types only.

/** The export's Content-Security-Policy (spec 4.17 "CSP"): no `script-src`, so scripts fall back to `'none'`; images,
 *  styles and fonts only from the file itself; no `<base>`, no form target. It is the first `<head>` child after
 *  `meta charset` (M4.EX1). `font-src data:` is for W6's mockup export; a Markdown export carries no font. */
export const DOCS_EXPORT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'";

/** The largest file Export saves (decision 4): 10 MiB of output. Images are inlined in document order while the file
 *  fits; the body is never cut (spec 4.17 "Size"). */
export const DOCS_EXPORT_MAX_BYTES = 10485760;

/** How long Export waits for an image the page is still loading before that image becomes a placeholder (decision 3). */
export const DOCS_EXPORT_IMAGE_WAIT_MS = 10000;

/** The one doctype (spec 4.17 "The doctype"), joined to the rendered markup in exactly one place, `buildExport`. */
export const EXPORT_PREFIX = '<!doctype html>';

/** The `generator` meta's content: the export format and its version (spec 4.13: it versions the format). */
export const EXPORT_GENERATOR = 'ccrc-docs-export/1';

/** The longest file name Export gives (spec 4.17 "Filename"). */
export const EXPORT_FILENAME_MAX = 150;

/** Why an image of the page is a placeholder in the file (spec 4.17 "Placeholders"; refinement (t)): the page does not
 *  show it (`refused`), it is on another site (`external`), it waits for Load image (`deferred`), its load failed
 *  (`failed`), it was still loading after `DOCS_EXPORT_IMAGE_WAIT_MS` (`timed-out`), or the file had no room left for it
 *  (`over-size`). A class, never an instance. */
export type ExportMissing = 'refused' | 'external' | 'deferred' | 'failed' | 'timed-out' | 'over-size';

/** Why a code block of the page is plain in the file (spec 4.17 "Said in the provenance"; M4.EX18; refinement (t)):
 *  over the block cap; past a page ceiling; timed out; output too large; failed (the worker's failures and the check's
 *  structural refusals); no highlight worker; and, until W5h-b, refused by W5 part 1's bounds. */
export type ExportPlain = 'over-cap' | 'page-ceiling' | 'timeout' | 'too-large' | 'failed' | 'no-worker' | 'part1-bounds';
```

- [ ] **Step 4: Write `pwa/src/docs/export/filename.ts`:**

```ts
// Export's file name (spec 2026-10-01 4.17 "Filename"; M4.EX9; native Docs reader W5, Export):
// `<project>_<section>_<path with '/' as '__'>_<short8>[-draft].html`, only `[A-Za-z0-9._-]` (every other character
// becomes `-`), at most `EXPORT_FILENAME_MAX` characters. The name is cut from the end of its front part, so the path
// goes first; the tail is always whole. `commit` is the commit the export names (`exportProvenance`'s `commit`).
//
// Ring L1: pure.
import type { DocPin } from '../../../../shared/docs';
import { shortCommit } from '../docsText';
import { EXPORT_FILENAME_MAX } from './policy';

const UNSAFE = /[^A-Za-z0-9._-]/g;
const safe = (s: string): string => s.replace(UNSAFE, '-');

export function exportFilename(project: string, pin: DocPin, commit: string): string {
  const tail = `_${shortCommit(commit)}${pin.kind === 'draft' ? '-draft' : ''}.html`;
  const front = `${safe(project)}_${safe(pin.section)}_${safe(pin.path.split('/').join('__'))}`;
  return front.slice(0, EXPORT_FILENAME_MAX - tail.length) + tail;
}
```

- [ ] **Step 5: Implement `docsText.ts`.** Find `import type { ShareFields, ShareNote, ShareNoteLine, ShareRefusal } from './share';` and add on the next line: `import type { ExportMissing, ExportPlain } from './export/policy';`. Then append at the end of the file (after `closedWorktreeLabel`'s closing brace):

```ts

// ===== Export (spec 4.7, 4.17; native Docs reader W5, Export) =====
// Export's words: the sheet's own, the file's fixed sentences, the provenance's labels and the two closed maps. Every
// `{field}` is a count, a commit, a closed label, a badge's text, a served ref or a time; never a path on the fleet box,
// a failure's detail, or a document's text.

/** The export sheet's own words and the sentences the file carries (spec 4.17). `{k}`/`{s}` count; `{error}` is an
 *  error's `name` only. `banner` is spec 4.17's drafts banner, `{label}` the closed worktree label. */
export const EXPORT_TEXT = {
  title: 'Export',
  building: 'Building…',
  save: 'Save {name} ({size})',
  couldNotStart: 'Export could not start ({error}).',
  failed: 'Export failed ({error}).',
  tooLarge: 'Too large to export; use Download.',
  retry: 'Retry',
  deferred: '{k} image{s} not loaded; tap Load image first.',
  provenance: 'Where this copy came from',
  notListed: 'not in this listing at {short}',
  missing: '{k} image{s} not included.',
  plainBlocks: '{k} code block{s} left plain: {sentence}.',
  colouringDropped: 'Code colouring was dropped to fit the file size limit.',
  draftNotIncluded: '{badge} in {label}; not included.',
  plainView: "Docs' plain view; the rich view's layout is not kept.",
  banner: 'Draft, not committed. This copy includes uncommitted changes from {label} on {branch}. Based on commit '
    + '{commit} ({served}). It is not on GitHub. Content fingerprint sha256:{fp}. Read {time}.',
  bannerImages: 'It embeds {k} uncommitted image{s}.',
} as const;

/** The provenance block's labels (spec 4.17 "Provenance"); the same facts are written as `ccrc:*` metas. */
export const EXPORT_FACT = {
  project: 'Project',
  path: 'Path',
  served: 'Served',
  commit: 'Commit',
  link: 'On GitHub',
  committedLink: 'Committed version on GitHub',
  noLink: 'No GitHub link',
  source: 'Source',
  exported: 'Exported',
  view: 'View',
} as const;

/** A placeholder's sentence, one per class of missing image (spec 4.17; M4.EX5): closed, no `{field}`. */
export const EXPORT_MISSING_SENTENCE: Record<ExportMissing, string> = {
  'refused': 'Image not included: the page did not show it.',
  'external': 'Image not included: it is on another site.',
  'deferred': 'Image not included: it was not loaded on the page.',
  'failed': 'Image not included: it did not load.',
  'timed-out': 'Image not included: it was still loading.',
  'over-size': 'Image not included: the file had no room left for it.',
};

/** Why a class of code block is plain (spec 4.17; M4.EX18): closed, no `{field}`; `EXPORT_TEXT.plainBlocks` puts the
 *  count beside it. */
export const EXPORT_PLAIN_SENTENCE: Record<ExportPlain, string> = {
  'over-cap': 'over the block size limit',
  'page-ceiling': 'past a page highlighting limit',
  'timeout': 'highlighting took too long',
  'too-large': 'highlighted output too large',
  'failed': 'highlighting failed',
  'no-worker': 'this browser has no highlight worker',
  'part1-bounds': 'refused by the page highlight bounds',
};
```

- [ ] **Step 6: Run to verify it passes**, then the guards. `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: `Tests  9 passed (9)`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts test/literal-census.test.ts )` — Step 0's counts, green (no Export sentence of 25 characters or more is written twice). `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/single-definition/ )` — green.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/export/policy.ts pwa/src/docs/export/filename.ts pwa/src/docs/docsText.ts pwa/test/docs-export.test.tsx` (expect 4), message `docs: Export's limits, closed words and file name (docs W5 Export)`, trailer. Record the task's JSON row fence in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T1-M1 | M4.EX9 | pwa | `src/docs/export/filename.ts` | `const UNSAFE = /[^A-Za-z0-9._-]/g;` → `const UNSAFE = /[\u0000-\u001f"]/g;` | `test/docs-export.test.tsx` | 2 failed — `'turns every character outside [A-Za-z0-9._-] into "-" (non-ASCII letters)'`; `'… (spaces and quotes)'` |
| W5X-T1-M2 | M4.EX5 | pwa | `src/docs/docsText.ts` | `'failed': 'Image not included: it did not load.',` → `'failed': 'Image not included: {detail}.',` | `test/docs-export.test.tsx` | 1 failed — `'EXPORT_MISSING_SENTENCE has one sentence per placeholder word, and none takes a field'` |
| W5X-T1-M3 | M4.EX9 | pwa | `src/docs/export/filename.ts` | `return front.slice(0, EXPORT_FILENAME_MAX - tail.length) + tail;` → `return (front + tail).slice(0, EXPORT_FILENAME_MAX);` | `test/docs-export.test.tsx` | 1 failed — `'is at most 150 characters: the path is cut first, and the tail stays whole'` |
| W5X-T1-M4 | M4.EX9 | pwa | `src/docs/export/filename.ts` | `${pin.kind === 'draft' ? '-draft' : ''}` → removed | `test/docs-export.test.tsx` | 2 failed — `'ends -draft.html for a draft'`; `'is at most 150 characters: …'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — 9 passed; the guards unchanged; `TSC-OK`.

### Task 2: The export's stylesheet, derived, and its chrome registered (M4.EX10, M4.EX14 as refined, M4.S1's Export clause; refinements (b), (c), (d))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`. The judgment is in what the `<style>` may hold and in the contrast registration.

**Spec rows:** §4.14 ("The Markdown rules move", "Export's stylesheet"), §4.17 ("Stylesheet and theme"), M4.EX10 (registration and no hex), M4.EX14 (as refinement (b) replaces it), M4.S1 (the Export chrome and `export.css`); refinements (b), (c), (d).

**Files:**
- Create: `pwa/src/docs/export/export.css`, `pwa/src/docs/export/stylesheet.ts`.
- Modify: `ui/package.json` (one `exports` line), `pwa/design/audit.mjs` (one `INHERITED_GROUNDS` entry after `.doc-plain-note`'s), `pwa/test/contrast.test.ts` (one `APP_SHEETS` line; one appended describe), `pwa/test/docs-export.test.tsx` (import lines; one appended describe).
- Guards (not edited): `pwa/test/css-vars.test.ts`, `pwa/test/shape-census.test.ts`, `pwa/test/hover-states.test.ts`, `pwa/test/motion-reduced.test.ts`, `pwa/test/prose-lists.test.ts`, `pwa/test/design-system-boundary.test.ts`.

**Interfaces:** Produces `export function exportStylesheetPart(css: string): string` and `export const EXPORT_CSS: string` (`stylesheet.ts`); the subpath `@ccrc/ui/styles/prose.css`.

**Decisions:** (1) `EXPORT_CSS` is three `?raw` texts in a fixed order (tokens, prose, the export's own), each less its comments and `@font-face` blocks (refinement (c)); nothing is typed twice. (2) `export.css` restates what `styles/base.css` gives the app body (ground, ink, face) on `.ccrc-export`, the export's `<body>`, and sets one more ink, `--ink-secondary`, on one selector list, registered on `--bg-page`; every border is `currentColor`. (3) The sheet joins `contrast.test.ts`'s closed `APP_SHEETS` list, because the auditor walks every stylesheet under `pwa/src`, imported or not. (Departures: (b), (c).)

- [ ] **Step 0:** `git grep -qF '"./styles/reset.css": "./src/styles/reset.css"' HEAD -- ui/package.json && git grep -qF "css: { include: [/\.css\?raw$/] }," HEAD -- pwa/vite.config.ts && git grep -qF "'src/docs/docs.css'," HEAD -- pwa/test/contrast.test.ts && git grep -qF "'.doc-plain-note': {" HEAD -- pwa/design/audit.mjs && git grep -c "@font-face" HEAD -- ui/src/styles/tokens.css && ! git grep -q "url(" HEAD -- ui/src/components/prose.css && echo T2-BASE-OK` (the count line prints `HEAD:ui/src/styles/tokens.css:3`: `git grep -c` counts lines, and the file has one comment line naming the at-rule and the two `@font-face` rules). Claim `ui/package.json`, `audit.mjs`, `contrast.test.ts`. Record the guard suites' counts and `contrast.test.ts`'s count.
- [ ] **Step 1: Write the failing cases.** In `docs-export.test.tsx`, after `import { describe, expect, it } from 'vitest';` add `import { readFileSync, readdirSync } from 'node:fs';` and `import path from 'node:path';`; after the `../src/docs/export/policy` import add `import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';`. Append:

```tsx

// ---- Task 2: the stylesheet ---------------------------------------------------------------------------------------

describe('the export stylesheet (spec 4.14, 4.17; M4.EX10, M4.EX14 as refinement (b) reads it)', () => {
  const read = (...parts: string[]): string => readFileSync(path.join(import.meta.dirname, '..', ...parts), 'utf8');

  it('is tokens.css, prose.css and export.css, in that order, each less its comments and @font-face blocks', () => {
    const parts = [read('..', 'ui', 'src', 'styles', 'tokens.css'), read('..', 'ui', 'src', 'components', 'prose.css'),
      read('src', 'docs', 'export', 'export.css')];
    expect(EXPORT_CSS).toBe(parts.map(exportStylesheetPart).join('\n'));
    expect(EXPORT_CSS).toContain("[data-theme='light']");
    expect(EXPORT_CSS).toContain('.msg-assist');
    expect(EXPORT_CSS).toContain('.ccrc-export-draft');
  });

  it('holds no comment, no @font-face, no @import, no url( and no </style', () => {
    expect(EXPORT_CSS).not.toMatch(/\/\*/);
    expect(EXPORT_CSS).not.toMatch(/@font-face/i);
    expect(EXPORT_CSS).not.toMatch(/@import/i);
    expect(EXPORT_CSS).not.toMatch(/url\(/i);
    expect(EXPORT_CSS).not.toMatch(/<\/style/i);
  });

  it('exportStylesheetPart drops comments and every @font-face block, and nothing else', () => {
    const css = "/* a url() */\n@font-face { font-family: X; src: url('x.woff2'); }\n.a { margin: 0; }\n@font-face{src:url(y)}";
    expect(exportStylesheetPart(css)).toBe('.a { margin: 0; }');
  });

  it('no hex colour in docs/export/*.ts or *.tsx, comments aside (M4.EX10)', () => {
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs', 'export');
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
    expect(files).toEqual(expect.arrayContaining(['policy.ts', 'stylesheet.ts']));
    for (const name of files) {
      const code = readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
```

  In `contrast.test.ts`, find `      'src/docs/docs.css',` and add on the next line `      'src/docs/export/export.css', // Export's own chrome (W5 Export): never imported by the app; read into every export's <style>`. Append at the end of the file:

```ts

// ── native Docs reader W5, Export: the export's own chrome (docs/export/export.css; M4.S1's Export clause, M4.EX10) ──
// The app never imports this sheet: docs/export/stylesheet.ts reads it as text into every export's one <style>. Its
// <body> rule (.ccrc-export) paints the export's ground and ink and is measured on it; the one other colour rule sets
// --ink-secondary inside it and is registered in INHERITED_GROUNDS with its reason. None joins the frozen census, none
// is grandfathered, and every palette is measured, as the export may carry any of them (refinement (e)).
describe('the export chrome is measured, not left in the blind spot (M4.S1 Export clause, M4.EX10)', () => {
  const exportRules = rulesOf(ROOT, 'src/docs/export/export.css');
  const NOT_A_COLOUR = /^(inherit|currentColor|unset|initial|revert)$/i;
  const colourRules = exportRules.filter((r) => {
    const ink = declOf(r.body, 'color');
    return ink !== null && !NOT_A_COLOUR.test(ink);
  });
  const QUIET = '.ccrc-export-provenance, .ccrc-export-note, .ccrc-export-missing, .ccrc-export-caption';
  const rowsOf = (key: string): typeof report.measured => report.measured.filter((m) => {
    const label = m.label.replace(/^\S+\s+/, '');
    return label === key || label.startsWith(`${key} [in `);
  });

  it('finds the sheet and its two colour rules (not a vacuous pass)', () => {
    expect(report.sheets).toContain('src/docs/export/export.css');
    expect(colourRules.map(ruleKey).sort()).toEqual(['.ccrc-export', QUIET]);
  });

  it('measures both colour rules in every palette, at or above the floor', () => {
    for (const r of colourRules) {
      const key = ruleKey(r);
      expect(report.uncovered, key).not.toContain(key);
      const rows = rowsOf(key);
      expect(rows, key).toHaveLength(THEME_COUNT);
      for (const row of rows) expect(row.ratio, row.label).toBeGreaterThanOrEqual(row.floor);
    }
  });

  it('grandfathers nothing, and registers exactly the quiet ink, on the page, with a reason', () => {
    const keys = new Set(exportRules.map(ruleKey));
    expect([...GRANDFATHERED_UNCOVERED].filter((k) => keys.has(k))).toEqual([]);
    const registered = Object.entries(INHERITED_GROUNDS).filter(([k]) => keys.has(k));
    expect(registered.map(([k]) => k)).toEqual([QUIET]);
    expect(registered[0]?.[1].under).toEqual(['var(--bg-page)']);
    expect(registered[0]?.[1].why.length).toBeGreaterThan(40);
  });

  it('spells no literal colour (tokens only, section 4.14)', () => {
    const text = exportRules.map((r) => r.body).join(';');
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  });
});
```

  (`rulesOf`, `declOf`, `ruleKey`, `INHERITED_GROUNDS`, `report`, `ROOT`, `THEME_COUNT` and `GRANDFATHERED_UNCOVERED` are the file's own names at BASE; the docs.css describe uses each.)
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: the file fails to load (`stylesheet.ts` does not exist). `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )` through `ccrc test`, alone — Expected: the whole file fails at collection, before any case runs. The new describe's body calls `rulesOf(ROOT, 'src/docs/export/export.css')`, and `audit.mjs#readCss` (`readFileSync`) throws `ENOENT: no such file or directory` naming `src/docs/export/export.css`, so vitest reports `test/contrast.test.ts` failed with no test run. That error is the expected red; any other error is a stop-and-ask.
- [ ] **Step 3: Add the subpath.** In `ui/package.json`, `    "./styles/reset.css": "./src/styles/reset.css"` becomes `    "./styles/reset.css": "./src/styles/reset.css",` followed by a new line `    "./styles/prose.css": "./src/components/prose.css"`.
- [ ] **Step 4: Write `pwa/src/docs/export/export.css`:**

```css
/* — Export's own chrome (spec 2026-10-01 4.14 "Export's stylesheet", 4.17; native Docs reader W5, Export). The app never
   imports this sheet: docs/export/stylesheet.ts reads it as text into every export's one <style>, after @ccrc/ui's
   tokens and prose rules, less its comments. Tokens only (contrast.test.ts holds that). An export has no
   styles/base.css, so .ccrc-export, the export's <body>, restates the app body's ground, ink and face, and
   .ccrc-export-page holds the reading measure. The quiet lines set --ink-secondary on that ground (design/audit.mjs
   INHERITED_GROUNDS); every border is currentColor; nothing else sets a colour. — */
.ccrc-export { background: var(--bg-page); color: var(--ink-primary); font-family: var(--family-ui); }
.ccrc-export-page { margin: 0 auto; max-width: 52rem; padding: var(--sp-4); }
.ccrc-export-draft { margin: 0; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid currentColor; font-weight: var(--weight-semibold); }
.ccrc-export-provenance, .ccrc-export-note, .ccrc-export-missing, .ccrc-export-caption { color: var(--ink-secondary); }
.ccrc-export-provenance { margin-block-end: var(--sp-4); font-size: var(--fs-sm); }
.ccrc-export-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--sp-1) var(--sp-3); }
.ccrc-export-facts > dt, .ccrc-export-facts > dd { margin: 0; overflow-wrap: anywhere; }
.ccrc-export-notes { margin: var(--sp-2) 0 0; padding-inline-start: var(--sp-4); }
.ccrc-export-note, .ccrc-export-caption { font-size: var(--fs-sm); }
.ccrc-export-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.ccrc-export-img { display: block; max-width: 100%; height: auto; }
.ccrc-export-missing { display: inline-block; padding: var(--sp-1) var(--sp-2); border: 1px dashed currentColor; }
.ccrc-export-inert { text-decoration: underline dotted; }
```

- [ ] **Step 5: Write `pwa/src/docs/export/stylesheet.ts`:**

```ts
// Export's stylesheet (spec 2026-10-01 4.14 "Export's stylesheet", 4.17 "Stylesheet and theme"; native Docs reader W5,
// Export; refinements (b), (c), (d)). Derived, never typed twice: @ccrc/ui's tokens (every palette block, so the
// exporter's palette applies in the file) and its prose rules (the Markdown body, code blocks, tables and the hljs
// colours, which left chat.css for @ccrc/ui), then the export's own chrome. Each is read as text at build time through
// Vite's `?raw` (vite.config.ts lets `.css?raw` through under vitest too), less its comments and its `@font-face`
// blocks: a face names a font file by `url()`, which the export's CSP refuses and M4.EX2 forbids, so the token stacks
// fall back to system faces. `EXPORT_CSS` holds no `</style`, no `@import` and no `url(` (docs-export.test.tsx).
//
// Ring L1: pure; three build-time texts.
import tokensCss from '@ccrc/ui/styles/tokens.css?raw';
import proseCss from '@ccrc/ui/styles/prose.css?raw';
import exportCss from './export.css?raw';

/** One stylesheet's text as the export carries it: its comments and its `@font-face` blocks removed, trimmed. */
export function exportStylesheetPart(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').trim();
}

/** The one `<style>` text of every export: tokens, prose, the export's chrome, in that order. */
export const EXPORT_CSS = [tokensCss, proseCss, exportCss].map(exportStylesheetPart).join('\n');
```

- [ ] **Step 6: Register the quiet ink.** In `audit.mjs`, find:

```js
  '.doc-plain-note': {
    under: ['var(--bg-page)'],
    why: "the note above a document shown as plain text (DocPlain), a <p> in the unpainted leaf, so --bg-page, as chat's .msg-plain-note",
  },
```

  and insert after it:

```js
  // ── native Docs reader W5, Export: the export's own chrome (docs/export/export.css) ──
  '.ccrc-export-provenance, .ccrc-export-note, .ccrc-export-missing, .ccrc-export-caption': {
    under: ['var(--bg-page)'],
    why: "an exported file's quiet ink: the provenance block, a plain body's note, an image placeholder and an image's draft caption, each in --ink-secondary inside the export's <body>, .ccrc-export, which paints --bg-page and is measured as a pair of its own. A placeholder inside a table or a callout sits on that block's tint instead; the auditor takes one ground per rule",
  },
```

- [ ] **Step 7: Run to verify they pass**, then the guards: Step 2's two commands, all green (`docs-export.test.tsx`: 13 passed; `contrast.test.ts`: Step 0's count plus 5, the four new cases and the file's own `'parses rules out of %s'` case for `src/docs/export/export.css`, which `audit.mjs#stylesheets` finds by walking `pwa/src`). `( cd pwa && ./node_modules/.bin/vitest run test/css-vars.test.ts test/shape-census.test.ts test/hover-states.test.ts test/motion-reduced.test.ts test/prose-lists.test.ts test/design-system-boundary.test.ts )` through `ccrc test` — Step 0's counts (a new shape cluster from `export.css` is registered in `shape-census.test.ts` with its reason, a stop-and-ask only if it would register more than one); `TSC-OK`. Record in the SDD ledger, as the `?raw` measurement (§4.17's first W5 row): under vitest, `EXPORT_CSS` holds the three texts (case 1 green); the production build's half is Task 11 Step 4.
- [ ] **Step 8: Commit.** `git add ui/package.json pwa/src/docs/export/export.css pwa/src/docs/export/stylesheet.ts pwa/design/audit.mjs pwa/test/contrast.test.ts pwa/test/docs-export.test.tsx` (expect 6), plus `pwa/test/shape-census.test.ts` if Step 7 registered a cluster (expect 7), message `docs: the export's stylesheet, derived, and its chrome registered (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T2-M1 | M4.EX14 | pwa | `src/docs/export/stylesheet.ts` | `[tokensCss, proseCss, exportCss]` → `[tokensCss, exportCss]` | `test/docs-export.test.tsx` | 1 failed — `'is tokens.css, prose.css and export.css, in that order, each less its comments and @font-face blocks'` |
| W5X-T2-M2 | M4.EX2 | pwa | `src/docs/export/stylesheet.ts` | `.replace(/@font-face\s*\{[^}]*\}/g, '')` → removed | `test/docs-export.test.tsx` | 2 failed — `'holds no comment, no @font-face, no @import, no url( and no </style'`; `'exportStylesheetPart drops comments and every @font-face block, and nothing else'` |
| W5X-T2-M3 | M4.S1 | pwa | `design/audit.mjs` | the `'.ccrc-export-provenance, .ccrc-export-note, .ccrc-export-missing, .ccrc-export-caption'` entry → removed | `test/contrast.test.ts` | 2+ failed — `'measures both colour rules in every palette, at or above the floor'`; `'grandfathers nothing, and registers exactly the quiet ink, on the page, with a reason'` (the frozen uncovered census may red too) |
| W5X-T2-M4 | M4.EX10 | pwa | `src/docs/export/export.css` | `.ccrc-export { background: var(--bg-page);` → `.ccrc-export { background: #10141a;` | `test/contrast.test.ts` | 1+ failed — `'spells no literal colour (tokens only, section 4.14)'` |
| W5X-T2-M5 | M4.S1 | pwa | `test/contrast.test.ts` | the `'src/docs/export/export.css', // Export's own chrome …` line → removed | `test/contrast.test.ts` | 1 failed — the closed `APP_SHEETS` case |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — 13 passed; `contrast.test.ts` alone, green; the guards unchanged; `TSC-OK`.

### Task 3: The provenance, and the colouring counted as the page draws it (M4.T7 Export clause, M4.EX5, M4.EX6, M4.EX12's commit, M4.EX18's counting; refinements (s), (t))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in what may leave in the file and in counting every drawn block once, as it is drawn.

**Spec rows:** §4.17 ("Provenance", "Drafts", "The banner", "Highlighting": "Said in the provenance" and "Closed words"), M4.T7 (its `provenance.ts` clause), M4.EX5 (the provenance half), M4.EX6 (the pure half), M4.EX12 (the provenance commit), M4.EX18 (the counting half); refinements (a)'s View fact, (f), (s), (t).

**Files:**
- Create: `pwa/src/docs/export/provenance.ts`, `pwa/src/docs/export/colouring.ts`.
- Modify: `pwa/test/docs-export.test.tsx` (its import block replaced; two appended describes).
- Guards (not edited): `pwa/test/docs-share.test.ts`, `pwa/test/highlight-store.test.ts`, `server/test/rings/pwa-rings.test.ts`.

**Interfaces:**
- Consumes: `shareTargetFor` (`docs/share.ts`); `closedWorktreeLabel`, `ENTRY_BADGE_TEXT`, `VIA_SENTENCE`, `servedRefText`, `shareNoteSentence`, `shareRefusalSentence`, `DOCS_HEAD_TEXT`, Task 1's words (`docsText.ts`); `entryView`, `admitDraft`, `docRepoPath` (`shared/docs.ts`); `blockKey`, `isCheckedHighlightHtml`, `UNREQUESTED_ENTRY` and the store's types (`lib/highlightStore.ts`).
- Produces: in `provenance.ts`: `ExportFact`, `ExportMeta`, `ProvenanceInput`, `ExportProvenance`, `exportProvenance(p)`, `colouringNotes(c)`, `missingNotes(m)`; in `colouring.ts`: `ExportColouring`, `exportEntry(store, answer, at)`, `exportColouring(blocks, store, dropped)`.

**Decisions:** (1) The commit, the permalink or its refusal, and the `onRef` notes are `shareTargetFor`'s (refinement (s)); the provenance never re-derives a link. (2) Every draft word is `entryView`'s through `ENTRY_BADGE_TEXT`, and every worktree is named by `closedWorktreeLabel` (M4.T7, M4.EX5); `tree.mainCheckout.path`, a failure's `detail` and `candidates` are never read. (3) `exportEntry` is the one reading of a drawn block: its own copy's skip first (`copySkip(at)`, D-7762), then `peek`, never `request`; the builder draws through it and the counting reads through it, so they cannot disagree. (4) An `html` entry whose `checked` the sink would refuse (`isCheckedHighlightHtml` false) is drawn plain, so it is counted `failed`; a worker `unregistered` answer, and a block in no registered grammar, are not counted (refinement (t)). (5) When colouring was dropped to fit, the notes say that and nothing else. (None departs; (a)'s View fact and (f)'s missing build version are their refinements'.)

- [ ] **Step 0:** `test -f pwa/src/docs/export/policy.ts && git grep -qF "export function shareTargetFor(tree: DocsTreeOk, page: DocsPageLocation, opened: ShareOpened): ShareTarget | null {" HEAD -- pwa/src/docs/share.ts && git grep -qF "export function codeBlocksOf(tree: HastRoot): CodeBlockText[] {" HEAD -- pwa/src/lib/highlightStore.ts && echo T3-BASE-OK`. No shared file is edited. Record the guard suites' counts.
- [ ] **Step 1: Replace `docs-export.test.tsx`'s import block** (from `import { describe, expect, it } from 'vitest';` through `import { COMMIT_A, FP_1, SERVED } from './docsFixtures';`) with:

```tsx
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  entryView, type DocPin, type DocsEntry, type DocsPageLocation, type DocsShowOk, type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { ENTRY_BADGE_TEXT, EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import { exportColouring, type ExportColouring } from '../src/docs/export/colouring';
import { exportFilename } from '../src/docs/export/filename';
import { EXPORT_FILENAME_MAX, type ExportMissing, type ExportPlain } from '../src/docs/export/policy';
import { colouringNotes, exportProvenance, missingNotes, type ExportProvenance } from '../src/docs/export/provenance';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { pinFor } from '../src/docs/useDocsVisit';
import {
  UNREQUESTED_ENTRY, checkHighlightHtml, type CheckedHighlightHtml, type CodeBlockText, type HighlightEntry,
  type HighlightStore, type PlainCause, type SkipCeiling,
} from '../src/lib/highlightStore';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS } from '../src/lib/markdownLimits';
import { BLOB_1, COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';
import { syncTestStore } from './highlightTestStore';
```

  and append at the end of the file:

```tsx

// ---- Task 3: the provenance and the colouring --------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const GH = 'https://github.com/example-org/example-repo';
type Leaf = DocsPageLocation & { kind: 'path' };

function leafAt(url: string): Leaf {
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error(`fixture: ${url} is not a leaf`);
  return page;
}

/** The provenance of `url`'s leaf at the pin its tree implies (the page has read it). */
function provenanceAt(tree: DocsTreeOk, url: string, show: DocsShowOk | null = null): ExportProvenance {
  const page = leafAt(url);
  const pin = pinFor(tree, page);
  if (pin === null) throw new Error(`fixture: ${url} opens nothing`);
  return exportProvenance({ tree, page, pin, show, exportedAt: NOW, readAt: NOW - 1000, plainView: true });
}

const factOf = (p: ExportProvenance, label: string): string | undefined => p.facts.find((f) => f.label === label)?.value;
const metaOf = (p: ExportProvenance, name: string): string | undefined => p.metas.find((m) => m.name === name)?.content;

/** `holder()`'s record at another worktree, narrowed to the holder arm before the spread (as docs-share.test.ts does). */
function holderAt(worktree: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): DraftsFacts {
  const h = holder();
  if (h.state !== 'holder') throw new Error('fixture: holder() is not a holder');
  return { ...h, worktree: { ...h.worktree, ...worktree } };
}

const DRAFT_STATES: [string, Partial<DocsEntry>][] = [
  ['modified', { draft: draftOf('modified') }],
  ['added', { committed: null, draft: draftOf('added') }],
  ['untracked', { committed: null, draft: draftOf('untracked') }],
  ['conflicted', { draft: draftOf('conflicted') }],
  ['deleted', { draft: draftOf('deleted', { kind: 'absent', size: null, fp: null }) }],
  ['typechange', { draft: draftOf('typechange', { kind: 'symlink', fp: null }) }],
  ['withheld', { draft: draftOf('modified', { fp: null }) }],
];

describe('exportProvenance: what the file says it is (spec 4.17 "Provenance", "Drafts"; M4.T7, M4.EX5, M4.EX6)', () => {
  it('a committed leaf: project, repo path, served ref and how, the full commit, its permalink, its source, the time and the view', () => {
    const p = provenanceAt(treeOk(), '/docs/demo/specs/a.md');
    expect(p.commit).toBe(COMMIT_A);
    expect(p.facts).toEqual([
      { label: 'Project', value: 'demo' },
      { label: 'Path', value: 'docs/superpowers/specs/a.md' },
      { label: 'Served', value: 'origin/main (default branch (origin/HEAD))' },
      { label: 'Commit', value: COMMIT_A },
      { label: 'On GitHub', value: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md` },
      { label: 'Source', value: 'committed' },
      { label: 'Exported', value: '2026-11-03T12:00:00.000Z' },
      { label: 'View', value: EXPORT_TEXT.plainView },
    ]);
    expect(metaOf(p, 'ccrc:commit')).toBe(COMMIT_A);
    expect(metaOf(p, 'ccrc:link')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.banner).toBeNull();
    expect(p.notes).toEqual([]);
  });

  it('a draft leaf is the draft, under the banner, its worktree named by its closed label (M4.EX6)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect(p.draft).toBe(true);
    expect(factOf(p, 'Source')).toBe('draft · modified in main checkout');
    expect(factOf(p, 'Committed version on GitHub')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.banner).toBe('Draft, not committed. This copy includes uncommitted changes from main checkout on main. '
      + `Based on commit ${COMMIT_A} (${SERVED}). It is not on GitHub. Content fingerprint sha256:${FP_1.slice(0, 12)}. `
      + 'Read 2026-11-03T11:59:59.000Z.');
  });

  it('view=committed on an admitted entry is the committed bytes, with no banner and the not-included note (M4.EX6)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main&view=committed');
    expect(p.draft).toBe(false);
    expect(p.banner).toBeNull();
    expect(factOf(p, 'Source')).toBe('committed (view=committed)');
    expect(p.notes).toEqual(['draft · modified in main checkout; not included.']);
  });

  it.each(DRAFT_STATES)("names the rows' badge for a %s draft (M4.T7 Export clause)", (_state, over) => {
    const e = entry('specs', 'a.md', over);
    const tree = treeOk({ entries: [e], drafts: holder() });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    if (badge === null) throw new Error('fixture: no badge');
    const p = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect([...p.facts.map((f) => f.value), ...p.notes].join('\n')).toContain(`${ENTRY_BADGE_TEXT[badge]} in main checkout`);
  });

  it('names a worktree by its closed label only, and carries no path, user, candidate or failure detail (M4.EX5)', () => {
    const HOME = '/repo/home-x/user-x/wrapper-a-demo/ws-x';
    const base = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holderAt({ path: HOME, class: 'workspace' }) });
    const tree: DocsTreeOk = { ...base, mainCheckout: { path: HOME, branch: 'main', head: COMMIT_A } };
    const drafted = provenanceAt(tree, '/docs/demo/specs/a.md?ref=main');
    expect(factOf(drafted, 'Source')).toBe('draft · modified in workspace ws-x');
    const others: DraftsFacts[] = [
      { state: 'ambiguous', branch: 'main', candidates: [HOME, `${HOME}-2`] },
      { state: 'unreadable', branch: 'main', worktree: HOME, step: 'status', detail: `fatal: ${HOME}: user-x` },
      { state: 'untrusted', branch: 'main', worktree: HOME, why: 'foreign-owner' },
    ];
    const all = [drafted, ...others.map((d) => provenanceAt({ ...tree, drafts: d }, '/docs/demo/specs/a.md?ref=main'))];
    for (const p of all) {
      const text = JSON.stringify(p);
      for (const leak of ['home-x', 'user-x', 'wrapper-a-demo', '/repo/']) expect(text).not.toContain(leak);
    }
  });

  it('says what Share says of onRef, measured at the opened commit', () => {
    const show: DocsShowOk = { ...fileResponse('# A').show, commit: COMMIT_A, blob: BLOB_1, onRef: 'not-contained' };
    const p = provenanceAt(treeOk(), '/docs/demo/specs/a.md', show);
    expect(p.notes).toEqual([`Commit ${SHORT_A} is no longer on origin/main; GitHub may stop serving it.`]);
  });

  it('with no GitHub origin, the reason stands in for the link, and its meta is the closed word', () => {
    const p = provenanceAt({ ...treeOk(), github: { state: 'none' } }, '/docs/demo/specs/a.md');
    expect(factOf(p, 'No GitHub link')).toBe('No GitHub link for this project.');
    expect(metaOf(p, 'ccrc:no-link')).toBe('no-github-origin');
  });

  it("names the commit the leaf opened, not the tree's (M4.EX12)", () => {
    const p = exportProvenance({
      tree: treeOk({ commit: COMMIT_B }), page: leafAt('/docs/demo/specs/a.md'), pin: committedPin('a.md', COMMIT_A),
      show: null, exportedAt: NOW, readAt: NOW, plainView: false,
    });
    expect(p.commit).toBe(COMMIT_A);
    expect(factOf(p, 'On GitHub')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(p.facts.some((f) => f.label === 'View')).toBe(false);
  });
});

describe('exportColouring and its notes: each drawn block counted by the entry it draws (spec 4.17; M4.EX18)', () => {
  const OK_HTML = checkHighlightHtml('<span class="hljs-keyword">const</span>');
  if (OK_HTML === null) throw new Error('fixture: the check refused plain hljs markup');
  const html = (checked: object): HighlightEntry => ({ kind: 'html', mode: 'block', checked: checked as CheckedHighlightHtml });
  const plain = (first: PlainCause): HighlightEntry => ({ kind: 'plain', first, retry: null });
  const key = (lang: string, raw: string): string => `${lang}\u0000${raw}`;
  /** A Docs store over fixed entries, with per-copy skips, that never asks a highlighter. */
  function storeOf(entries: Readonly<Record<string, HighlightEntry>>, skips: ReadonlyMap<object, SkipCeiling> = new Map()): HighlightStore {
    return { ...syncTestStore('docs'), peek: (k) => entries[k] ?? UNREQUESTED_ENTRY, copySkip: (at) => skips.get(at) ?? null };
  }

  it('counts each plain class under its closed word, a coloured block not at all, and an unregistered one not at all', () => {
    const raws = ['ok', 'skipped', 'scan', 'slow', 'big', 'dead', 'threw', 'bad', 'none', 'forged', 'unregistered'];
    const blocks: CodeBlockText[] = [
      ...raws.map((raw) => ({ lang: 'bash', raw })),
      { lang: 'bash', raw: 'x'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1) },
      { lang: 'bash', raw: 'w'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1) },
      { lang: 'nope', raw: 'no grammar' },
    ];
    const c = exportColouring(blocks, storeOf({
      [key('bash', 'ok')]: html(OK_HTML),
      [key('bash', 'skipped')]: { kind: 'skipped', ceiling: 'page-output' },
      [key('bash', 'scan')]: { kind: 'skipped', ceiling: 'part1-scan' },
      [key('bash', 'slow')]: plain({ kind: 'timeout', budgetMs: 750 }),
      [key('bash', 'big')]: plain({ kind: 'too-large' }),
      [key('bash', 'dead')]: plain({ kind: 'worker-failed', error: 'Error' }),
      [key('bash', 'threw')]: plain({ kind: 'threw', error: 'TypeError' }),
      [key('bash', 'bad')]: plain({ kind: 'malformed' }),
      [key('bash', 'none')]: plain({ kind: 'worker-unavailable' }),
      [key('bash', 'forged')]: html({ html: '<img src=x onerror=alert(1)>' }),
      [key('bash', 'unregistered')]: plain({ kind: 'unregistered' }),
    }), false);
    expect(c.coloured).toBe(1);
    expect(Object.fromEntries(c.plain)).toEqual({
      'over-cap': 1, 'part1-bounds': 2, 'page-ceiling': 1, 'timeout': 1, 'too-large': 1, 'failed': 4, 'no-worker': 1,
    });
  });

  it('a later copy of a coloured block that the page skipped counts as past a page ceiling, by its own pre', () => {
    const first = {};
    const second = {};
    const c = exportColouring([{ lang: 'bash', raw: 'ok', at: first }, { lang: 'bash', raw: 'ok', at: second }],
      storeOf({ [key('bash', 'ok')]: html(OK_HTML) }, new Map([[second, 'page-output']])), false);
    expect(c.coloured).toBe(1);
    expect(Object.fromEntries(c.plain)).toEqual({ 'page-ceiling': 1 });
  });

  it('colouring dropped to fit says that, and nothing else', () => {
    const c = exportColouring([{ lang: 'bash', raw: 'slow' }], storeOf({ [key('bash', 'slow')]: plain({ kind: 'timeout', budgetMs: 750 }) }), true);
    expect(colouringNotes(c)).toEqual({ notes: [EXPORT_TEXT.colouringDropped], metas: [{ name: 'ccrc:colouring', content: 'dropped' }] });
  });

  it('the notes count each class in closed words, in a fixed order, and say nothing when every block is coloured', () => {
    const c: ExportColouring = { coloured: 3, plain: new Map<ExportPlain, number>([['timeout', 2], ['over-cap', 1]]), dropped: false };
    expect(colouringNotes(c)).toEqual({
      notes: ['1 code block left plain: over the block size limit.', '2 code blocks left plain: highlighting took too long.'],
      metas: [{ name: 'ccrc:plain-over-cap', content: '1' }, { name: 'ccrc:plain-timeout', content: '2' }],
    });
    expect(colouringNotes({ coloured: 3, plain: new Map(), dropped: false })).toEqual({ notes: [], metas: [] });
  });

  it('missingNotes counts the images not included, each class in its own meta', () => {
    expect(missingNotes(new Map<ExportMissing, number>([['deferred', 2], ['external', 1]]))).toEqual({
      notes: ['3 images not included.'],
      metas: [{ name: 'ccrc:missing-deferred', content: '2' }, { name: 'ccrc:missing-external', content: '1' }],
    });
    expect(missingNotes(new Map())).toEqual({ notes: [], metas: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: the file fails to load (`provenance.ts` and `colouring.ts` do not exist).
- [ ] **Step 3: Write `pwa/src/docs/export/colouring.ts`:**

```ts
// Export's colouring, read and counted (spec 2026-10-01 4.17 "Highlighting"; M4.EX18; native Docs reader W5, Export).
// `exportEntry` is the ONE reading of a drawn code block for Export: the page's store says first whether it skipped this
// very copy (`copySkip(at)`, `at` being the block's own `pre` element; review 1364 F1), else what its key holds (`peek`).
// It never calls `request`, so building an export asks no highlighter anything. The builder draws each block through it
// and `exportColouring` counts through it, so the file and its provenance cannot disagree. A block is counted as the sink
// draws it: an `html` entry the check never made (`isCheckedHighlightHtml` false) is drawn plain, so it counts `failed`;
// a worker `unregistered` answer, like a block in no registered grammar, is not counted, since nothing would colour it.
// `part1-bounds` (W5 part 1's per-block bounds and its two page budgets) goes with W5h-b (M4.H23).
//
// Ring L1: pure; it reads a store it is given.
import {
  UNREQUESTED_ENTRY, blockKey, isCheckedHighlightHtml,
  type BlockKey, type CodeBlockText, type HighlightEntry, type HighlightStore, type PlainCause,
} from '../../lib/highlightStore';
import type { ExportPlain } from './policy';

/** What an export's colouring came to: the coloured blocks, the plain ones by class, or that colouring was dropped to fit
 *  the size limit (then nothing is counted by class). */
export interface ExportColouring {
  readonly coloured: number;
  readonly plain: ReadonlyMap<ExportPlain, number>;
  readonly dropped: boolean;
}

/** The entry a drawn block shows: `UNREQUESTED_ENTRY` (plain) with no store or no key; else the store's verdict on this
 *  copy, then its key's entry. */
export function exportEntry(store: HighlightStore | null, answer: BlockKey, at: object | undefined): HighlightEntry {
  if (store === null || answer.kind !== 'key') return UNREQUESTED_ENTRY;
  const skipped = at === undefined ? null : store.copySkip(at);
  return skipped === null ? store.peek(answer.key) : { kind: 'skipped', ceiling: skipped };
}

/** A failure's class; `null`: not counted. */
function plainClassOf(first: PlainCause): ExportPlain | null {
  switch (first.kind) {
    case 'timeout':
      return 'timeout';
    case 'too-large':
      return 'too-large';
    case 'worker-unavailable':
      return 'no-worker';
    case 'unregistered':
      return null;
    case 'threw':
    case 'malformed':
    case 'worker-failed':
    case 'line-too-long':
      return 'failed';
  }
}

/** Every block of `blocks` (a tree's `codeBlocksOf`, or a text leaf's one block), counted by what it draws. `dropped`:
 *  the builder rendered with no store to fit the size limit. */
export function exportColouring(
  blocks: readonly CodeBlockText[], store: HighlightStore | null, dropped: boolean,
): ExportColouring {
  const plain = new Map<ExportPlain, number>();
  if (dropped) return { coloured: 0, plain, dropped: true };
  let coloured = 0;
  const count = (word: ExportPlain): void => {
    plain.set(word, (plain.get(word) ?? 0) + 1);
  };
  for (const b of blocks) {
    const answer = store === null ? blockKey(b.lang, b.raw) : store.keyOf(b.lang, b.raw);
    if (answer.kind === 'unregistered') continue;
    if (answer.kind === 'over-cap') {
      count('over-cap');
      continue;
    }
    if (answer.kind === 'part1') {
      count('part1-bounds');
      continue;
    }
    const entry = exportEntry(store, answer, b.at);
    switch (entry.kind) {
      case 'html':
        if (isCheckedHighlightHtml(entry.checked)) coloured += 1;
        else count('failed');
        break;
      case 'skipped':
        count(entry.ceiling === 'part1-scan' || entry.ceiling === 'part1-markdown' ? 'part1-bounds' : 'page-ceiling');
        break;
      case 'plain': {
        const word = plainClassOf(entry.first);
        if (word !== null) count(word);
        break;
      }
      case 'unrequested':
      case 'pending':
        // A settled store has none; drawn plain, so counted, never left out.
        count('failed');
        break;
    }
  }
  return { coloured, plain, dropped: false };
}
```

- [ ] **Step 4: Write `pwa/src/docs/export/provenance.ts`:**

```ts
// Export's provenance (spec 2026-10-01 4.17 "Provenance", "Drafts", "The banner"; native Docs reader W5, Export;
// refinements (a), (f), (s)). What the file says about where it came from, before its content and again as `ccrc:*`
// metas: the project and the repo path; the served ref and how it was chosen; the full commit C the export names; the
// GitHub permalink, or why there is none, by Share's own rule (`shareTargetFor`), so the two never disagree; the source
// (committed, `view=committed`, or a draft with its badge); the time it was exported; on a Markdown export, that it is
// Docs' plain view; and the notes: `onRef` (Share's sentences) and an admitted draft that is not included. A draft's
// banner names the worktree by its closed label, its branch, C, the served ref, the first 12 hex of its fingerprint and
// when it was read. Nothing here reads a document's bytes, a worktree's path (only `closedWorktreeLabel` of it), the main
// checkout's path, a failure's detail or a candidate list (M4.EX5). The builder adds the colouring and image lines once
// it knows what it inlined (`colouringNotes`, `missingNotes`).
//
// Ring L1: pure.
import {
  admitDraft, docRepoPath, entryView, type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk,
} from '../../../../shared/docs';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, EXPORT_FACT, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, VIA_SENTENCE, closedWorktreeLabel,
  fillSentence, pluralS, servedRefText, shareNoteSentence, shareRefusalSentence,
} from '../docsText';
import { shareTargetFor } from '../share';
import type { ExportColouring } from './colouring';
import type { ExportMissing, ExportPlain } from './policy';

type Leaf = DocsPageLocation & { kind: 'path' };

/** One line of the provenance block. */
export interface ExportFact { readonly label: string; readonly value: string }
/** One `<meta name content>`. */
export interface ExportMeta { readonly name: string; readonly content: string }

export interface ProvenanceInput {
  readonly tree: DocsTreeOk;
  readonly page: Leaf;
  /** The pin the leaf opened: its file slot's, or a raster leaf's image's. */
  readonly pin: DocPin;
  /** The file answer the leaf shows; `null`: a raster leaf, which has none. */
  readonly show: DocsShowOk | null;
  readonly exportedAt: number;
  /** When Docs read the bytes: the file slot's `receivedAt` (a raster leaf: the export time). */
  readonly readAt: number;
  /** A `markdown`-class leaf, whatever its body (`exportInputOf` reads the class): the file is Docs' plain view
   *  (refinement (a)). */
  readonly plainView: boolean;
}

export interface ExportProvenance {
  /** C: the opened pin's commit for a committed leaf, the tree's for a draft (refinement (s)). */
  readonly commit: string;
  readonly draft: boolean;
  readonly facts: readonly ExportFact[];
  readonly notes: readonly string[];
  readonly metas: readonly ExportMeta[];
  /** The drafts banner without its images clause, which the builder adds; `null`: not a draft. */
  readonly banner: string | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function exportProvenance(p: ProvenanceInput): ExportProvenance {
  const { tree, page, pin } = p;
  const ref = tree.ref;
  const drafts = tree.drafts;
  const entry = tree.entries.find((e) => e.section === page.section && e.path === page.path);
  const view = entry === undefined ? null : entryView(entry, drafts, page.ref === null ? 'default' : 'ref');
  const badge = view === null || view.badge === null ? DOCS_HEAD_TEXT.sourceDraftUnbadged : ENTRY_BADGE_TEXT[view.badge];
  const label = drafts.state === 'holder' ? closedWorktreeLabel(drafts.worktree) : DOCS_HEAD_TEXT.worktreeOther;
  const commit = pin.kind === 'committed' ? pin.commit : ref.commit;
  const repoPath = docRepoPath(page.section, page.path);
  const via = fillSentence(VIA_SENTENCE[ref.via], ref.requested === null ? {} : { requested: ref.requested });
  const facts: ExportFact[] = [
    { label: EXPORT_FACT.project, value: page.project },
    { label: EXPORT_FACT.path, value: repoPath },
    { label: EXPORT_FACT.served, value: `${servedRefText(ref)} (${via})` },
    { label: EXPORT_FACT.commit, value: commit },
  ];
  const metas: ExportMeta[] = [
    { name: 'ccrc:project', content: page.project },
    { name: 'ccrc:path', content: repoPath },
    { name: 'ccrc:served', content: ref.served },
    { name: 'ccrc:via', content: ref.via },
    { name: 'ccrc:commit', content: commit },
  ];
  const target = shareTargetFor(tree, page, { kind: 'file', pin, show: p.show });
  if (target !== null && target.ok) {
    facts.push({ label: pin.kind === 'draft' ? EXPORT_FACT.committedLink : EXPORT_FACT.link, value: target.url });
    metas.push({ name: 'ccrc:link', content: target.url });
  } else if (target !== null) {
    facts.push({ label: EXPORT_FACT.noLink, value: shareRefusalSentence(target.why, target.fields, false) });
    metas.push({ name: 'ccrc:no-link', content: target.why });
  }
  const source = pin.kind === 'draft' ? fillSentence(DOCS_HEAD_TEXT.sourceDraft, { badge, label })
    : page.view === 'committed' ? DOCS_HEAD_TEXT.sourceViewCommitted : DOCS_HEAD_TEXT.sourceCommitted;
  facts.push({ label: EXPORT_FACT.source, value: source }, { label: EXPORT_FACT.exported, value: iso(p.exportedAt) });
  metas.push(
    { name: 'ccrc:source', content: pin.kind === 'draft' ? 'draft' : page.view === 'committed' ? 'view-committed' : 'committed' },
    { name: 'ccrc:exported', content: iso(p.exportedAt) },
  );
  if (pin.kind === 'draft') metas.push({ name: 'ccrc:worktree', content: label });
  if (p.plainView) {
    facts.push({ label: EXPORT_FACT.view, value: EXPORT_TEXT.plainView });
    metas.push({ name: 'ccrc:view', content: 'plain' });
  }
  const notes: string[] = [];
  for (const line of target?.notes ?? []) {
    if (line.note === 'onRef-not-contained' || line.note === 'onRef-unmeasured') notes.push(shareNoteSentence(line));
  }
  // An admitted draft the leaf does not open (deleted, type changed, withheld), or one `view=committed` set aside: the
  // committed bytes, with the note (spec 4.17's drafts table).
  if (pin.kind === 'committed' && page.ref !== null && entry !== undefined && admitDraft(entry, drafts)) {
    notes.push(fillSentence(EXPORT_TEXT.draftNotIncluded, { badge, label }));
  }
  const banner = pin.kind === 'draft'
    ? fillSentence(EXPORT_TEXT.banner, {
      label, branch: pin.branch, commit, served: ref.served, fp: pin.fp.slice(0, 12), time: iso(p.readAt),
    })
    : null;
  return { commit, draft: pin.kind === 'draft', facts, notes, metas, banner };
}

/** The colouring lines and metas (spec 4.17 "Said in the provenance"): one line per class left plain, in
 *  `EXPORT_PLAIN_SENTENCE`'s order, or the one dropped line; nothing when every block was coloured. */
export function colouringNotes(c: ExportColouring): { readonly notes: readonly string[]; readonly metas: readonly ExportMeta[] } {
  if (c.dropped) return { notes: [EXPORT_TEXT.colouringDropped], metas: [{ name: 'ccrc:colouring', content: 'dropped' }] };
  const notes: string[] = [];
  const metas: ExportMeta[] = [];
  for (const word of Object.keys(EXPORT_PLAIN_SENTENCE) as ExportPlain[]) {
    const k = c.plain.get(word) ?? 0;
    if (k === 0) continue;
    notes.push(fillSentence(EXPORT_TEXT.plainBlocks, { k, s: pluralS(k), sentence: EXPORT_PLAIN_SENTENCE[word] }));
    metas.push({ name: `ccrc:plain-${word}`, content: String(k) });
  }
  return { notes, metas };
}

/** The images-not-included line (one, with the total) and one meta per class. */
export function missingNotes(missing: ReadonlyMap<ExportMissing, number>): { readonly notes: readonly string[]; readonly metas: readonly ExportMeta[] } {
  let k = 0;
  const metas: ExportMeta[] = [];
  for (const [word, n] of missing) {
    if (n === 0) continue;
    k += n;
    metas.push({ name: `ccrc:missing-${word}`, content: String(n) });
  }
  return k === 0 ? { notes: [], metas: [] } : { notes: [fillSentence(EXPORT_TEXT.missing, { k, s: pluralS(k) })], metas };
}
```

- [ ] **Step 5: Run to verify they pass**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: `Tests  32 passed (32)`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts test/highlight-store.test.ts )` — Step 0's counts. `TSC-OK`. `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` — green (`provenance.ts` and `colouring.ts` are L1 and load no `.tsx`).
- [ ] **Step 6: Commit.** `git add pwa/src/docs/export/provenance.ts pwa/src/docs/export/colouring.ts pwa/test/docs-export.test.tsx` (expect 3), message `docs: Export's provenance, and its colouring counted as the page draws it (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T3-M1 | M4.EX5 | pwa | `src/docs/export/provenance.ts` | `const label = drafts.state === 'holder' ? closedWorktreeLabel(drafts.worktree) : DOCS_HEAD_TEXT.worktreeOther;` → `const label = drafts.state === 'holder' ? drafts.worktree.path : DOCS_HEAD_TEXT.worktreeOther;` | `test/docs-export.test.tsx` | 10 failed — `'a draft leaf is the draft, under the banner, …'`; `'view=committed on an admitted entry …'`; the seven `"names the rows' badge for a %s draft (M4.T7 Export clause)"` cases; `'names a worktree by its closed label only, …'` |
| W5X-T3-M2 | M4.T7 | pwa | `src/docs/export/provenance.ts` | `: ENTRY_BADGE_TEXT[view.badge];` → `` : `draft · ${view.badge}`; `` | `test/docs-export.test.tsx` | 1 failed — `"names the rows' badge for a typechange draft (M4.T7 Export clause)"` |
| W5X-T3-M3 | M4.EX6 | pwa | `src/docs/export/provenance.ts` | `if (pin.kind === 'committed' && page.ref !== null && entry !== undefined && admitDraft(entry, drafts)) {` → `if (false) {` | `test/docs-export.test.tsx` | 4 failed — `'view=committed on an admitted entry …'`; the deleted, typechange and withheld cases of `"names the rows' badge …"` |
| W5X-T3-M4 | M4.EX18 | pwa | `src/docs/export/colouring.ts` | `if (isCheckedHighlightHtml(entry.checked)) coloured += 1;\n        else count('failed');` → `coloured += 1;` | `test/docs-export.test.tsx` | 1 failed — `'counts each plain class under its closed word, …'` |
| W5X-T3-M5 | M4.EX18 | pwa | `src/docs/export/colouring.ts` | `const skipped = at === undefined ? null : store.copySkip(at);` → `const skipped = null;` | `test/docs-export.test.tsx` | 1 failed — `'a later copy of a coloured block that the page skipped counts as past a page ceiling, by its own pre'` |
| W5X-T3-M6 | M4.EX18 | pwa | `src/docs/export/colouring.ts` | `count(entry.ceiling === 'part1-scan' \|\| entry.ceiling === 'part1-markdown' ? 'part1-bounds' : 'page-ceiling');` → `count('page-ceiling');` | `test/docs-export.test.tsx` | 1 failed — `'counts each plain class under its closed word, …'` |
| W5X-T3-M7 | M4.EX7 | pwa | `src/docs/export/provenance.ts` | `if (c.dropped) return { notes: [EXPORT_TEXT.colouringDropped], metas: [{ name: 'ccrc:colouring', content: 'dropped' }] };` → removed | `test/docs-export.test.tsx` | 1 failed — `'colouring dropped to fit says that, and nothing else'` |
| W5X-T3-M8 | M4.EX12 | pwa | `src/docs/export/provenance.ts` | `const commit = pin.kind === 'committed' ? pin.commit : ref.commit;` → `const commit = ref.commit;` | `test/docs-export.test.tsx` | 1 failed — `"names the commit the leaf opened, not the tree's (M4.EX12)"` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — 32 passed; the guards unchanged; `TSC-OK`; `pwa-rings` green.

### Task 4: Images from memory: the registry, `DocImage`'s reports and `downloadExport` (M4.EX3's registry half, M4.EX8, M5.17 as amended; refinement (g))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`. The judgment is in holding a key exactly as long as an image shows it.

**Spec rows:** §4.3 item 6 (`ExportAssets`), §4.11 (the loader "also fills `ExportAssets`"), §4.17 ("Images: bytes already in memory, never fetched", "Waiting"), §5.4 (`downloadExport`), M4.EX3 (the registry half: bytes from memory, the 10 s wait, a changed `fp`), M4.EX8, M5.17 (as amended 2026-10-13); refinement (g).

**Files:**
- Create: `pwa/src/docs/export/exportAssets.ts`, `pwa/test/docs-export-assets.test.tsx`.
- Modify: `pwa/src/docs/DocImage.tsx` (one import; one field of `DocsAssetContextValue`; `useImageSrc`'s signature, effect and deps; its one call), `pwa/src/docs/objectUrls.ts` (`downloadExport` appended after `saveBytes`), `pwa/test/docs-object-urls.test.ts` (its `objectUrls` import; one appended describe).
- Guards (not edited): `pwa/test/docs-images.test.tsx`, `pwa/test/reader-images.test.ts`, `pwa/test/docs-screen.test.tsx`, `pwa/test/staged-images.test.tsx`.

**Interfaces:** Produces, in `exportAssets.ts`: `ExportAsset`, `ExportAssetState`, `ASSET_LOADING`, `ASSET_FAILED`, `ExportAssetHold`, `ExportAssets`, `createExportAssets()`, `settleExportAssets(assets, keys, ms): Promise<void>`; `DocsAssetContextValue.exportAssets?: ExportAssets | null`; `downloadExport(result: { readonly name: string; readonly bytes: Uint8Array<ArrayBuffer> }): void` in `objectUrls.ts`.

**Decisions:** (1) A row per key (`docsApi.file(project, pin)`, so a changed `fp` is another key), counting the images that show it; a hold's `report` after its `release` is ignored, and the last release forgets the key, so the registry never answers older bytes than the page shows. (2) A raster is recorded only after `rasterObjectUrl` accepted its MIME (a MIME outside the table throws there and is reported `failed`), so a recorded MIME is always the table's, never `Blob.type`. (3) The field is optional on the context, so every existing test's assets object stays as it is; `DocsScreen` gives the registry in Task 6. (4) `downloadExport` is the one consumer of the builder's output and only calls `saveBytes`. (Departure: (g).)

- [ ] **Step 0:** `git grep -qF "function useImageSrc(job: LoadJob | null): Shown {" HEAD -- pwa/src/docs/DocImage.tsx && git grep -qF "export function saveBytes(name: string, bytes: Uint8Array<ArrayBuffer>): void {" HEAD -- pwa/src/docs/objectUrls.ts && ! git grep -q "downloadExport(" HEAD -- pwa/src && echo T4-BASE-OK`. Claim `DocImage.tsx`, `objectUrls.ts`, `docs-object-urls.test.ts`. Record the guard suites' counts.
- [ ] **Step 1: Write `pwa/test/docs-export-assets.test.tsx`:**

```tsx
// Docs W5 Export, Task 4: images from memory (spec 2026-10-01 4.3 item 6, 4.17 "Images"; M4.EX3's registry half;
// refinement (g)). The registry holds what each `DocImage` already holds, under its pin's key, by reference, and forgets
// a key when the last image showing it goes; `settleExportAssets` waits for the keys still loading, at most its bound.
// The images load through injected loaders; nothing reaches a server. Placeholders only: project `demo`, `specs/...`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { Element as HastElement } from 'hast';
import { DOCS_RASTER_TYPES, docsApi, type DocsTreeOk } from '../../shared/docs';
import { DocImage, DocsAssetContext } from '../src/docs/DocImage';
import { DocLinkContext, type DocLinkContextValue } from '../src/docs/DocLink';
import type { DetachedUrls } from '../src/docs/docsLinks';
import {
  ASSET_FAILED, ASSET_LOADING, createExportAssets, settleExportAssets, type ExportAssets,
} from '../src/docs/export/exportAssets';
import { DOCS_EXPORT_IMAGE_WAIT_MS } from '../src/docs/export/policy';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { pinFor } from '../src/docs/useDocsVisit';
import { COMMIT_A, SERVED, draftOf, entry, fakeLoaders, holder, pageAt, treeOk, type FakeLoaders } from './docsFixtures';

const PNG = new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
const KEY = docsApi.file('demo', { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'x.png' });

afterEach(() => {
  vi.useRealTimers();
});

/** One Markdown image (`src`) on the page `url` of `tree`, under the screen's two contexts, `assets` its registry. */
function image(tree: DocsTreeOk, f: FakeLoaders, assets: ExportAssets, url = '/docs/demo/specs/a.md', src = 'x.png') {
  const node: HastElement = { type: 'element', tagName: 'img', properties: {}, children: [] };
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error('fixture: not a leaf');
  const ui = (t: DocsTreeOk) => {
    const urls = new WeakMap<HastElement, DetachedUrls>([[node, { attrs: { src }, imageIndex: 0 }]]);
    const ctx: DocLinkContextValue = {
      project: 'demo', pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree: t,
      pageSource: pinFor(t, page)?.kind === 'draft' ? 'draft' : 'committed', urls, onFragment: vi.fn(),
    };
    return (
      <DocsAssetContext value={{ loaders: f.loaders, queue, onDraftAsset: () => {}, exportAssets: assets }}>
        <DocLinkContext value={ctx}><DocImage node={node} alt="x" /></DocLinkContext>
      </DocsAssetContext>
    );
  };
  const queue = createFetchQueue();
  const view = render(ui(tree));
  return { ...view, rerenderAt: (t: DocsTreeOk) => view.rerender(ui(t)) };
}

describe('the ExportAssets registry (spec 4.3 item 6; refinement (g))', () => {
  it('holds a key while any image shows it, and forgets it with the last', () => {
    const assets = createExportAssets();
    const a = assets.track('k');
    const b = assets.track('k');
    a.report(ASSET_FAILED);
    expect(assets.get('k')).toBe(ASSET_FAILED);
    a.release();
    expect(assets.get('k')).toBe(ASSET_FAILED);
    b.release();
    expect(assets.get('k')).toBeUndefined();
  });

  it('ignores a report after its hold is released, and counts every change', () => {
    const assets = createExportAssets();
    const a = assets.track('k');
    const before = assets.version();
    a.release();
    a.report(ASSET_FAILED);
    expect(assets.get('k')).toBeUndefined();
    expect(assets.version()).toBe(before + 1);
  });

  it('settleExportAssets answers at once when no key is loading, and waits for a loading key until it settles', async () => {
    vi.useFakeTimers();
    const assets = createExportAssets();
    await expect(settleExportAssets(assets, ['k'], 10)).resolves.toBeUndefined();
    const hold = assets.track('k');
    hold.report(ASSET_LOADING);
    let done = false;
    void settleExportAssets(assets, ['k'], DOCS_EXPORT_IMAGE_WAIT_MS).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(DOCS_EXPORT_IMAGE_WAIT_MS - 1);
    expect(done).toBe(false);
    hold.report(ASSET_FAILED);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('settleExportAssets gives up after its bound, leaving the key loading (M4.EX3)', async () => {
    vi.useFakeTimers();
    const assets = createExportAssets();
    assets.track('k').report(ASSET_LOADING);
    let done = false;
    void settleExportAssets(assets, ['k'], DOCS_EXPORT_IMAGE_WAIT_MS).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(DOCS_EXPORT_IMAGE_WAIT_MS);
    expect(done).toBe(true);
    expect(assets.get('k')).toBe(ASSET_LOADING);
  });
});

describe("DocImage reports what it holds into the page's registry (spec 4.11; M4.EX3)", () => {
  const TREE = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });

  it("a loaded raster reports its bytes, by reference, and its table MIME under its pin's key; the key goes with the image", async () => {
    const assets = createExportAssets();
    const f = fakeLoaders();
    f.raster.mockResolvedValue({ s: 'ok', value: { bytes: PNG, mime: DOCS_RASTER_TYPES.png.mime } });
    const view = image(TREE, f, assets);
    await waitFor(() => expect(assets.get(KEY)?.s).toBe('loaded'));
    const held = assets.get(KEY);
    if (held?.s !== 'loaded' || held.asset.kind !== 'raster') throw new Error('not a loaded raster');
    expect(held.asset.bytes).toBe(PNG);
    expect(held.asset.mime).toBe('image/png');
    view.unmount();
    expect(assets.get(KEY)).toBeUndefined();
  });

  it('a failed load reports failed', async () => {
    const assets = createExportAssets();
    image(TREE, fakeLoaders(), assets);
    await waitFor(() => expect(assets.get(KEY)).toBe(ASSET_FAILED));
  });

  it("an image whose fingerprint changed is another key, and the old key's bytes are forgotten (M4.EX3)", async () => {
    const drafted = (fp: string) => treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'x.png', { draft: draftOf('modified', { fp }) })],
      drafts: holder(),
    });
    const before = drafted('d'.repeat(64));
    const after = drafted('e'.repeat(64));
    const keyAt = (t: DocsTreeOk): string => {
      const e = t.entries[1]!;
      const d = t.drafts;
      if (d.state !== 'holder' || e.draft === null || e.draft.fp === null) throw new Error('fixture');
      return docsApi.file('demo', { kind: 'draft', branch: d.branch, head: d.worktree.head, section: 'specs', path: 'x.png', fp: e.draft.fp });
    };
    const assets = createExportAssets();
    const f = fakeLoaders();
    f.raster.mockResolvedValue({ s: 'ok', value: { bytes: PNG, mime: DOCS_RASTER_TYPES.png.mime } });
    const view = image(before, f, assets, '/docs/demo/specs/a.md?ref=main');
    await waitFor(() => expect(assets.get(keyAt(before))?.s).toBe('loaded'));
    view.rerenderAt(after);
    await waitFor(() => expect(assets.get(keyAt(after))?.s).toBe('loaded'));
    expect(assets.get(keyAt(before))).toBeUndefined();
  });
});
```

  In `docs-object-urls.test.ts`, `import { DOCS_SAVE_REVOKE_MS, downloadDocFile, rasterObjectUrl, saveBytes, showBytes } from '../src/docs/objectUrls';` becomes `import { DOCS_SAVE_REVOKE_MS, downloadDocFile, downloadExport, rasterObjectUrl, saveBytes, showBytes } from '../src/docs/objectUrls';`. Append at the end of the file:

```ts

describe('downloadExport (spec 4.17 "Save", 5.4; M4.EX8, M5.17 as amended 2026-10-13)', () => {
  it("saves the result's bytes under its name, as application/octet-stream, clicked inside the call", async () => {
    const bytes = new TextEncoder().encode('<!doctype html><p>x</p>');
    downloadExport({ name: 'demo_specs_a.md_aaaaaaaa.html', bytes });
    // No await between the call and these lines: the click happened inside it.
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe('demo_specs_a.md_aaaaaaaa.html');
    expect(blobs()).toHaveLength(1);
    expect(blobs()[0]!.type).toBe('application/octet-stream');
    expect(await bytesOf(blobs()[0]!)).toEqual([...bytes]);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-assets.test.tsx test/docs-object-urls.test.ts )` — Expected: `docs-export-assets.test.tsx` fails to load (`exportAssets.ts` does not exist); `docs-object-urls.test.ts`: the new case red (`downloadExport` is not a function yet), the rest green.
- [ ] **Step 3: Write `pwa/src/docs/export/exportAssets.ts`:**

```ts
// Export's images, from memory (spec 2026-10-01 4.3 item 6, 4.17 "Images: bytes already in memory, never fetched";
// native Docs reader W5, Export; refinement (g)). One registry per Docs visit: `DocsScreen` makes it beside the image
// queue and gives it to every image through `DocsAssetContext`. Each `DocImage` tracks its key (`docsApi.file(project,
// pin)`, which names the pin exactly, a draft's fingerprint included) while it shows that key, and reports what became of
// its load: loading, the bytes it holds (a raster's verified bytes with their table MIME, an SVG's `data:` URL), or
// failed. The registry holds those by reference, never copies them, and forgets a key when the last image showing it
// goes, so it holds no more than the page does and never answers bytes older than the page shows (M4.EX3). Export reads
// it and never a loader: `settleExportAssets` waits, at most its bound (`DOCS_EXPORT_IMAGE_WAIT_MS` in production), for
// the keys still loading.
//
// Ring L3 (its wait holds a timer): it reads no DOM and makes no request.
import type { RasterMime } from '../../../../shared/docs';

/** What an image holds once loaded. */
export type ExportAsset =
  | { readonly kind: 'raster'; readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: RasterMime }
  | { readonly kind: 'svg'; readonly src: string };

/** One key's state. A key the registry does not hold answers `undefined` from `get`: no image shows it. */
export type ExportAssetState =
  | { readonly s: 'loading' }
  | { readonly s: 'loaded'; readonly asset: ExportAsset }
  | { readonly s: 'failed' };

export const ASSET_LOADING: ExportAssetState = Object.freeze({ s: 'loading' } as const);
export const ASSET_FAILED: ExportAssetState = Object.freeze({ s: 'failed' } as const);

/** One image's hold on its key. */
export interface ExportAssetHold {
  report(state: ExportAssetState): void;
  release(): void;
}

export interface ExportAssets {
  track(key: string): ExportAssetHold;
  get(key: string): ExportAssetState | undefined;
  /** Store-wide; the same function on every call, for `useSyncExternalStore`. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Bumped on every change, for `useSyncExternalStore`'s snapshot. */
  version(): number;
}

export function createExportAssets(): ExportAssets {
  const rows = new Map<string, { holds: number; state: ExportAssetState }>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = (): void => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    track(key) {
      const row = rows.get(key) ?? { holds: 0, state: ASSET_LOADING };
      row.holds += 1;
      rows.set(key, row);
      let live = true;
      return {
        report(state) {
          if (!live || rows.get(key) !== row) return;
          row.state = state;
          changed();
        },
        release() {
          if (!live) return;
          live = false;
          row.holds -= 1;
          if (row.holds === 0 && rows.get(key) === row) {
            rows.delete(key);
            changed();
          }
        },
      };
    },
    get: (key) => rows.get(key)?.state,
    subscribe,
    version: () => version,
  };
}

/** Resolves once no key of `keys` is `loading`, or after `ms`, whichever is first. It never rejects. */
export function settleExportAssets(assets: ExportAssets, keys: readonly string[], ms: number): Promise<void> {
  const loading = (): boolean => keys.some((k) => assets.get(k)?.s === 'loading');
  if (!loading()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve();
    };
    const timer = setTimeout(finish, ms);
    stop = assets.subscribe(() => {
      if (!loading()) finish();
    });
  });
}
```

- [ ] **Step 4: `DocImage.tsx` reports into it.**
  - After `import type { FetchQueue } from './fetchQueue';` add `import { ASSET_FAILED, ASSET_LOADING, type ExportAssets } from './export/exportAssets';`.
  - After `  readonly onDraftAsset: (count: number) => void;` add:

```tsx
  /** Export's registry of the bytes this page's images hold (spec 4.3 item 6; refinement (g)); absent or `null`: nothing
   *  is recorded. */
  readonly exportAssets?: ExportAssets | null;
```

  - `function useImageSrc(job: LoadJob | null): Shown {` becomes `function useImageSrc(job: LoadJob | null, exportAssets: ExportAssets | null): Shown {`.
  - After `    let created: string | null = null;` add:

```tsx
    // Export's registry (refinement (g)): this image shows `key` while this effect stands, and says what its load held.
    const held = exportAssets === null ? null : exportAssets.track(key);
    held?.report(ASSET_LOADING);
```

  - Find:

```tsx
      if (f.s === 'raster') {
        created = rasterObjectUrl(f.bytes, f.mime);
        setDone({ key, shown: { s: 'loaded', src: created } });
      } else if (f.s === 'svg') {
        setDone({ key, shown: { s: 'loaded', src: f.src } });
      } else {
        setDone({ key, shown: f });
      }
```

    and replace with:

```tsx
      if (f.s === 'raster') {
        created = rasterObjectUrl(f.bytes, f.mime);
        setDone({ key, shown: { s: 'loaded', src: created } });
        held?.report({ s: 'loaded', asset: { kind: 'raster', bytes: f.bytes, mime: f.mime } });
      } else if (f.s === 'svg') {
        setDone({ key, shown: { s: 'loaded', src: f.src } });
        held?.report({ s: 'loaded', asset: { kind: 'svg', src: f.src } });
      } else {
        setDone({ key, shown: f });
        held?.report(ASSET_FAILED);
      }
```

  - After `      setDone({ key, shown: { s: 'failed', sentence: fillSentence(DOC_IMAGE_TEXT.loaderFailed, { error }), auth: false } });` add `      held?.report(ASSET_FAILED);`.
  - After `      ctl.abort();` add `      held?.release();`.
  - `  }, [key, job?.loaders, job?.queue, attempt]);` becomes `  }, [key, job?.loaders, job?.queue, attempt, exportAssets]);`.
  - `  const shown = useImageSrc(job);` becomes `  const shown = useImageSrc(job, assets?.exportAssets ?? null);`.
- [ ] **Step 5: `downloadExport`.** In `objectUrls.ts`, find the end of `saveBytes`:

```ts
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOCS_SAVE_REVOKE_MS);
}
```

  and append after it:

```ts

/** Export's Save (spec 4.17 "Save", 5.4): the builder's bytes under their file name, through `saveBytes`, so an export
 *  is saved as `.html` by name but typed octet-stream, never `text/html` (E6, M5.17). The ONE consumer of the builder's
 *  output (M4.EX16). It is synchronous, so the Save click that calls it keeps its user activation (M4.EX13). */
export function downloadExport(result: { readonly name: string; readonly bytes: Uint8Array<ArrayBuffer> }): void {
  saveBytes(result.name, result.bytes);
}
```

  and in the file's header comment, `// SVG, HTML or any other active type: opened top-level, such a URL is a same-origin document carrying the session` stays; add nothing else.
- [ ] **Step 6: Run to verify they pass**, then the guards: Step 2's command — `docs-export-assets.test.tsx` 7 passed; `docs-object-urls.test.ts` Step 0's count plus 1. `( cd pwa && ./node_modules/.bin/vitest run test/docs-images.test.tsx test/reader-images.test.ts test/docs-screen.test.tsx test/staged-images.test.tsx )` — Step 0's counts; `TSC-OK`.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/export/exportAssets.ts pwa/src/docs/DocImage.tsx pwa/src/docs/objectUrls.ts pwa/test/docs-export-assets.test.tsx pwa/test/docs-object-urls.test.ts` (expect 5), message `docs: Export's images from memory, and downloadExport (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T4-M1 | M4.EX3 | pwa | `src/docs/DocImage.tsx` | `      held?.release();\n` → removed | `test/docs-export-assets.test.tsx` | 2 failed — `"a loaded raster reports its bytes, by reference, …; the key goes with the image"`; `"an image whose fingerprint changed is another key, and the old key's bytes are forgotten (M4.EX3)"` |
| W5X-T4-M2 | M4.EX3 | pwa | `src/docs/export/exportAssets.ts` | `if (row.holds === 0 && rows.get(key) === row) {` → `if (false) {` | `test/docs-export-assets.test.tsx` | 4 failed — `'holds a key while any image shows it, and forgets it with the last'`; `'ignores a report after its hold is released, and counts every change'`; the raster case; the fingerprint case |
| W5X-T4-M3 | M4.EX3 | pwa | `src/docs/export/exportAssets.ts` | `if (!loading()) return Promise.resolve();` → `return Promise.resolve();` | `test/docs-export-assets.test.tsx` | 1 failed — `'settleExportAssets answers at once when no key is loading, and waits for a loading key until it settles'` |
| W5X-T4-M4 | M4.EX3 | pwa | `src/docs/DocImage.tsx` | `        held?.report({ s: 'loaded', asset: { kind: 'raster', bytes: f.bytes, mime: f.mime } });\n` → removed | `test/docs-export-assets.test.tsx` | 2 failed — the raster case; the fingerprint case |
| W5X-T4-M5 | M4.EX8 | pwa | `src/docs/objectUrls.ts` | `  saveBytes(result.name, result.bytes);` → `  URL.createObjectURL(new Blob([result.bytes], { type: 'text/html' }));` | `test/docs-object-urls.test.ts` | 1 failed — `"saves the result's bytes under its name, as application/octet-stream, clicked inside the call"` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-assets.test.tsx test/docs-object-urls.test.ts )` — green; the guards unchanged; `TSC-OK`.

### Task 5: The builder: one React `<html>`, inert by construction (M4.EX1, M4.EX2's structural half, M4.EX3's build half, M4.EX4, M4.EX7, M4.EX10's theme, M4.EX18's build half; the head and `<style>` measurements; refinements (e), (m), (n), (o), (p), (q), (r))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in what reaches the file and in the size order.

**Spec rows:** §4.17 ("Built as React, never as strings", "The doctype", "The head", "The stylesheet's text", "The body", "Highlighting", "CSP", "Stylesheet and theme", "Images", "Links", "Size"), M4.EX1, M4.EX2 (structural), M4.EX3 (the build half), M4.EX4, M4.EX7, M4.EX10 (the theme), M4.EX18 (the build half); refinements (e), (l)'s pass-through, (m), (n), (o), (p), (q), (r).

**Files:**
- Create: `pwa/src/docs/export/exportMarkdown.tsx`, `pwa/src/docs/export/buildExport.tsx`.
- Modify: `pwa/src/lib/markdown.tsx` (`codeBlockParts` extracted from `CodeBlock`; `CodeBlock`'s behaviour unchanged), `pwa/test/docs-export.test.tsx` (its import block replaced; one appended describe).
- Guards (not edited): `pwa/test/markdown-golden.test.tsx`, `pwa/test/code-block.test.tsx`, `pwa/test/markdown-highlight.test.tsx`, `pwa/test/highlight-html.test.tsx`, `pwa/test/render-hast.test.tsx`, `pwa/test/docs-markdown.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/docs-scans.test.ts` (edited only under Step 6's branch 6b).

**Interfaces:**
- Consumes: Tasks 1-4; `DOC_COMPONENTS` (`DocMarkdown.tsx`); `planImageRef`, `rasterDataUrl`, `svgDataUrl` (`DocImage.tsx`); `renderHast`; `codeBlocksOf`, `blockKey` (`lib/highlightStore.ts`); `HighlightedCode`, `codeBlockLabel` (`lib/markdown.tsx`); `PROSE`, `cn` (`@ccrc/ui`); `resolveDocRef`, `githubPermalink`, `docsApi`, `DOCS_RASTER_TYPES` (`shared/docs.ts`).
- Produces: in `lib/markdown.tsx`: `CodeBlockParts`, `codeBlockParts(children)`; in `exportMarkdown.tsx`: `ExportImageDecision`, `ExportMarkdownContextValue`, `ExportMarkdownContext`, `ExportLinkTarget`, `exportLinkTarget(link, commit, raw)`, `ExportCode`, `EXPORT_COMPONENTS`; in `buildExport.tsx`: `ExportBodyInput`, `ExportInput`, `ExportLimits`, `ExportResult`, `buildExport(input, limits?)` (and nothing else: M4.EX16).

**Decisions:** (1) `buildExport` renders one element per attempt, `<html>`, through `renderToStaticMarkup` from `react-dom/server.browser` (refinement (o)), and joins `EXPORT_PREFIX` in exactly one place, after removing a doctype React may have written (refinement (q)). (2) The head is charset, CSP, title, `generator`, the `ccrc:*` metas, one `<style>` whose text child is `EXPORT_CSS`; the body is the banner (a draft only, first child), then `.ccrc-export-page` holding the provenance and the content. (3) Images come only from the page's registry, after `settleExportAssets`; a key the registry holds loaded is inlined wherever it appears, a deferred copy included, since the bytes are the page's own; a pinned image the registry does not hold is `deferred` when it waits for Load image, else `failed`. (4) The size order (refinement (r)): everything; else the body with every image an `over-size` placeholder, coloured, then plain; then images back in document order while the estimate fits, stopping at the first that does not; then the last one back out until the file fits. (5) The static `pre` draws through `HighlightedCode`, the one sink, and reads its entry through `exportEntry`; `codeBlockParts` is lifted out of `CodeBlock` so both read a block alike. (6) An `<a>` keeps the props `DocLink` keeps (an `id`, `title`, footnote `data-*`/`aria-*`), never a URL prop of the tree's. (None departs beyond (e).)

- [ ] **Step 0:** `test -f pwa/src/docs/export/colouring.ts && test -f pwa/src/docs/export/exportAssets.ts && test -f pwa/node_modules/@types/react-dom/server.browser.d.ts && test -f pwa/node_modules/react-dom/server.browser.js && git grep -qF "export const DOC_COMPONENTS: Components = { ...SHARED_COMPONENTS, a: DocLink, img: DocImage };" HEAD -- pwa/src/docs/DocMarkdown.tsx && git grep -qF "export function planImageRef(ctx: DocLinkContextValue, src: string, index: number | null): ImagePlan {" HEAD -- pwa/src/docs/DocImage.tsx && git grep -qF "  const raw = nodeText(children).replace(/\n\$/, '');" HEAD -- pwa/src/lib/markdown.tsx && echo T5-BASE-OK`. If either `react-dom` file is absent, stop and ask (refinement (o)'s specifier). Claim `markdown.tsx`. Record the guard suites' counts (the census suites through `ccrc test`).
- [ ] **Step 1: Replace `docs-export.test.tsx`'s import block** with:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DOCS_RASTER_TYPES, docsApi, entryView, type DocPin, type DocsEntry, type DocsPageLocation, type DocsShowOk,
  type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';
import {
  DOC_LINK_INERT_SENTENCE, ENTRY_BADGE_TEXT, EXPORT_MISSING_SENTENCE, EXPORT_PLAIN_SENTENCE, EXPORT_TEXT, fillSentence,
} from '../src/docs/docsText';
import { buildExport, type ExportBodyInput, type ExportInput, type ExportLimits, type ExportResult } from '../src/docs/export/buildExport';
import { exportColouring, type ExportColouring } from '../src/docs/export/colouring';
import { createExportAssets, type ExportAssets } from '../src/docs/export/exportAssets';
import { exportLinkTarget } from '../src/docs/export/exportMarkdown';
import { exportFilename } from '../src/docs/export/filename';
import {
  DOCS_EXPORT_CSP, DOCS_EXPORT_MAX_BYTES, EXPORT_FILENAME_MAX, EXPORT_PREFIX, type ExportMissing, type ExportPlain,
} from '../src/docs/export/policy';
import { colouringNotes, exportProvenance, missingNotes, type ExportProvenance } from '../src/docs/export/provenance';
import { EXPORT_CSS, exportStylesheetPart } from '../src/docs/export/stylesheet';
import { pinFor } from '../src/docs/useDocsVisit';
import type { Highlighter } from '../src/lib/highlightProtocol';
import {
  UNREQUESTED_ENTRY, checkHighlightHtml, codeBlocksOf, createHighlightStore, type CheckedHighlightHtml, type CodeBlockText,
  type HighlightEntry, type HighlightStore, type PlainCause, type SkipCeiling,
} from '../src/lib/highlightStore';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { docsHighlighter } from '../src/lib/markdownRunner';
import { BLOB_1, COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';
import { FROZEN_CLOCK, syncTestStore } from './highlightTestStore';
```

  and append at the end of the file:

```tsx

// ---- Task 5: the builder ------------------------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

const PNG = new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
const BIG = (n: number): Uint8Array<ArrayBuffer> => { const b = new Uint8Array(n); b.set(PNG); return b; };
const WIDE: ExportLimits = { maxBytes: 1e9, imageWaitMs: 20 };

/** A Markdown body for `src`, parsed in this thread and detached as `DocTree` holds it, on `url`'s leaf of `tree`. */
function treeBody(src: string, tree: DocsTreeOk = treeOk(), url = '/docs/demo/specs/a.md',
  store: HighlightStore = syncTestStore('docs')): Extract<ExportBodyInput, { kind: 'tree' }> {
  const outcome = parseMarkdown(src, 'docs');
  if (outcome.kind !== 'tree') throw new Error(`fixture: ${outcome.kind}`);
  const detached = detachUrls(outcome.tree);
  const page = leafAt(url);
  const link: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree,
    pageSource: pinFor(tree, page)?.kind === 'draft' ? 'draft' : 'committed', onFragment: () => {},
  };
  return { kind: 'tree', tree: detached.tree, urls: detached.urls, link, store };
}

/** An export of `body` from the committed leaf `specs/a.md` of the default tree, unless `over` says otherwise. */
function inputOf(body: ExportBodyInput, over: Partial<ExportInput> = {}): ExportInput {
  const provenance = exportProvenance({
    tree: treeOk(), page: leafAt('/docs/demo/specs/a.md'), pin: committedPin('a.md'), show: null,
    exportedAt: NOW, readAt: NOW, plainView: body.kind === 'tree' || body.kind === 'plain',
  });
  return {
    title: 'a.md', name: exportFilename('demo', committedPin('a.md'), COMMIT_A), theme: null, commit: COMMIT_A,
    provenance, body, assets: null, ...over,
  };
}

async function built(input: ExportInput, limits?: ExportLimits): Promise<{ text: string; doc: Document; result: Extract<ExportResult, { ok: true }> }> {
  const result = await buildExport(input, limits);
  if (!result.ok) throw new Error('expected a file');
  const text = new TextDecoder().decode(result.bytes);
  return { text, doc: new DOMParser().parseFromString(text, 'text/html'), result };
}

const imageKey = (path: string): string =>
  docsApi.file('demo', { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path });
function loaded(assets: ExportAssets, path: string, bytes: Uint8Array<ArrayBuffer> = PNG): void {
  assets.track(imageKey(path)).report({ s: 'loaded', asset: { kind: 'raster', bytes, mime: 'image/png' } });
}

const HOSTILE_H1 = '</title><meta http-equiv=refresh content="0;url=https://a.example/r"><style>.ccrc-export-draft{display:none}</style>';
const HOSTILE = [
  `# ${HOSTILE_H1}`,
  '',
  '<script>fetch("https://a.example/s")</script>',
  '',
  '<iframe src="https://a.example/f"></iframe> <form action="https://a.example/x"><button>go</button></form>',
  '',
  'a<br>b<br class=x>c',
  '',
  '[js](javascript:alert(1)) [data](data:text/html,x) [api](/api/docs/demo/file) [far](https://a.example/far) [doc](b.md) [frag](#top)',
  '',
  '![ext](https://a.example/i.png) ![api](/api/x.png) ![local](x.png)',
  '',
  '```bash',
  'echo <b>hi</b>',
  '```',
  '',
].join('\n');

describe('buildExport: one React <html>, inert by construction (spec 4.17; M4.EX1-EX4, M4.EX7, M4.EX10, M4.EX18)', () => {
  it('begins with one <!doctype html>, then meta charset, the CSP meta (exactly DOCS_EXPORT_CSP), the title, the metas and one style (M4.EX1)', async () => {
    const { text, doc } = await built(inputOf(treeBody('# A\n\ntext\n')));
    expect(text.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(text.match(/<!doctype/gi)).toHaveLength(1);
    const head = [...doc.head.children];
    expect(head[0]?.getAttribute('charset')).toBe('utf-8');
    expect(head[1]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(head[1]?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
    expect(head[2]?.tagName).toBe('TITLE');
    expect(head.at(-1)?.tagName).toBe('STYLE');
    expect(head.slice(3, -1).every((e) => e.tagName === 'META' && e.hasAttribute('name'))).toBe(true);
    expect(doc.querySelector('meta[name="generator"]')?.getAttribute('content')).toBe('ccrc-docs-export/1');
  });

  it("DOCS_EXPORT_CSP, re-tokenised: default-src 'none'; no script, connect, frame, child or worker source; no 'self'; exact img, style and font sources (M4.EX1)", () => {
    const directives = new Map(DOCS_EXPORT_CSP.split(';').map((d) => d.trim().split(/\s+/)).filter((t) => t[0] !== '')
      .map((t) => [t[0]!, t.slice(1)] as const));
    expect(directives.get('default-src')).toEqual(["'none'"]);
    for (const banned of ['script-src', 'script-src-elem', 'script-src-attr', 'connect-src', 'frame-src', 'child-src', 'worker-src']) {
      expect(directives.has(banned), banned).toBe(false);
    }
    expect(DOCS_EXPORT_CSP).not.toContain("'self'");
    expect(directives.get('img-src')).toEqual(['data:']);
    expect(directives.get('style-src')).toEqual(["'unsafe-inline'", 'data:']);
    expect(directives.get('font-src')).toEqual(['data:']);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('is inert over a hostile corpus: no active element, no on* or style attribute, URLs only where allowed, the banner first (M4.EX2)', async () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'b.md'), entry('specs', 'x.png')], drafts: holder(),
    });
    const url = '/docs/demo/specs/a.md?ref=main';
    const page = leafAt(url);
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture');
    const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: NOW, readAt: NOW, plainView: true });
    const { doc } = await built(inputOf(treeBody(HOSTILE, tree, url), { provenance, title: HOSTILE_H1 }), WIDE);
    for (const tag of ['script', 'iframe', 'object', 'embed', 'base', 'form', 'button', 'svg', 'link']) {
      expect(doc.querySelectorAll(tag), tag).toHaveLength(0);
    }
    for (const el of doc.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) expect(a.startsWith('on'), `${el.tagName} ${a}`).toBe(false);
      for (const a of ['srcset', 'poster', 'cite', 'background', 'action', 'formaction', 'ping', 'data', 'xlink:href', 'style']) {
        expect(el.hasAttribute(a), `${el.tagName} ${a}`).toBe(false);
      }
      const src = el.getAttribute('src');
      if (src !== null) {
        expect(el.tagName, src).toBe('IMG');
        expect(src.startsWith('data:image/'), src).toBe(true);
      }
      const href = el.getAttribute('href');
      if (href !== null) {
        expect(el.tagName, href).toBe('A');
        expect(href, href).toMatch(/^(#|https:|http:|mailto:)/);
        expect(href, href).not.toContain('/api/');
      }
    }
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    const style = doc.querySelector('style')?.textContent ?? '';
    expect(style).toBe(EXPORT_CSS);
    expect(style).not.toMatch(/@import|url\(/i);
    expect(doc.body.firstElementChild?.className).toBe('ccrc-export-draft');
    expect(doc.querySelector('title')?.textContent).toBe(HOSTILE_H1);
  });

  it('an SVG leaf is exactly one img of a data:image/ URL, never markup (M4.EX2)', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'https://a.example/o\')">'
      + '<script>fetch("https://a.example/s")</script><image href="https://a.example/i.png"/></svg>');
    const { doc } = await built(inputOf({ kind: 'image', alt: 'x.svg', draft: false, image: { kind: 'svg', bytes: svg } }));
    const imgs = doc.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(doc.querySelectorAll('svg, script, image')).toHaveLength(0);
  });

  it('a raster leaf is one img of its bytes, typed from the raster table', async () => {
    const { doc } = await built(inputOf({ kind: 'image', alt: 'x.png', draft: false, image: { kind: 'raster', bytes: PNG, mime: 'image/png' } }));
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
  });

  it("images come from the page's registry only: loaded ones inline, the rest closed placeholders, no fetch (M4.EX3)", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const assets = createExportAssets();
    loaded(assets, 'x.png');
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png'), entry('specs', 'y.png')] });
    const body = treeBody('![x](x.png) ![y](y.png) ![e](https://a.example/e.png)\n', tree);
    const { doc, result } = await built(inputOf(body, { assets }), WIDE);
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
    expect([...doc.querySelectorAll('.ccrc-export-missing')].map((s) => s.textContent))
      .toEqual([EXPORT_MISSING_SENTENCE.failed, EXPORT_MISSING_SENTENCE.external]);
    expect(result.notes).toContain('2 images not included.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an image the page is still loading is awaited, inlined when it lands, a timed-out placeholder when it does not (M4.EX3)', async () => {
    const assets = createExportAssets();
    const hold = assets.track(imageKey('x.png'));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const body = treeBody('![x](x.png)\n', tree);
    setTimeout(() => hold.report({ s: 'loaded', asset: { kind: 'raster', bytes: PNG, mime: 'image/png' } }), 5);
    expect((await built(inputOf(body, { assets }), { maxBytes: 1e9, imageWaitMs: 1000 })).doc.querySelectorAll('img')).toHaveLength(1);
    const slow = createExportAssets();
    slow.track(imageKey('x.png'));
    const { doc } = await built(inputOf(body, { assets: slow }), { maxBytes: 1e9, imageWaitMs: 10 });
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['timed-out']);
  });

  it('an image past the page limit that the page did not load is a deferred placeholder, and the sheet is told (M4.EX3)', async () => {
    const names = Array.from({ length: 31 }, (_, i) => `x${i}.png`);
    const assets = createExportAssets();
    for (const n of names.slice(0, 30)) loaded(assets, n);
    const tree = treeOk({ entries: [entry('specs', 'a.md'), ...names.map((n) => entry('specs', n))] });
    const body = treeBody(names.map((n) => `![${n}](${n})`).join(' ') + '\n', tree);
    const { doc, result } = await built(inputOf(body, { assets }), WIDE);
    expect(doc.querySelectorAll('img')).toHaveLength(30);
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE.deferred);
    expect(result.deferred).toBe(1);
  });

  it('links follow spec 4.17\'s table (M4.EX4)', () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md'), entry('specs', 'n.md', { committed: null, draft: draftOf('added') })] });
    const at = { section: 'specs' as const, path: 'a.md', tree };
    expect(exportLinkTarget(at, COMMIT_A, 'b.md#sec')).toEqual({ kind: 'permalink', href: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/b.md` });
    expect(exportLinkTarget(at, COMMIT_A, 'gone.md')).toEqual({ kind: 'inert', title: `not in this listing at ${SHORT_A}` });
    expect(exportLinkTarget(at, COMMIT_A, 'n.md')).toEqual({ kind: 'inert', title: `not in this listing at ${SHORT_A}` });
    expect(exportLinkTarget(at, COMMIT_A, '../../../README.md')).toEqual({ kind: 'permalink', href: `${GH}/blob/${COMMIT_A}/README.md` });
    expect(exportLinkTarget(at, COMMIT_A, '#top')).toEqual({ kind: 'fragment', href: '#top' });
    expect(exportLinkTarget(at, COMMIT_A, 'https://a.example/x')).toEqual({ kind: 'external', href: 'https://a.example/x' });
    expect(exportLinkTarget(at, COMMIT_A, 'mailto:someone').kind).toBe('external');
    expect(exportLinkTarget(at, COMMIT_A, '/api/x')).toEqual({ kind: 'inert', title: DOC_LINK_INERT_SENTENCE['root-relative'] });
    expect(exportLinkTarget(at, COMMIT_A, 'data:text/html,x')).toEqual({ kind: 'inert', title: DOC_LINK_INERT_SENTENCE.data });
    expect(exportLinkTarget({ ...at, tree: { ...tree, github: { state: 'none' } } }, COMMIT_A, 'b.md'))
      .toEqual({ kind: 'inert', title: 'No GitHub link for this project.' });
  });

  it('renders a permalink with rel and no target, an external link in a new tab, and an inert span with no href (M4.EX4)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'b.md')] });
    const { doc } = await built(inputOf(treeBody('[doc](b.md) [far](https://a.example/far) [gone](gone.md)\n', tree)));
    const [doc1, far] = [...doc.querySelectorAll('article a')];
    expect(doc1?.getAttribute('href')).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/b.md`);
    expect(doc1?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(doc1?.hasAttribute('target')).toBe(false);
    expect(far?.getAttribute('target')).toBe('_blank');
    expect(far?.getAttribute('rel')).toBe('noopener noreferrer');
    const inert = doc.querySelector('.ccrc-export-inert');
    expect(inert?.tagName).toBe('SPAN');
    expect(inert?.textContent).toBe('gone');
  });

  it('inlines images in document order while the file fits: the first that does not, and every later one, stay out (M4.EX7)', async () => {
    const assets = createExportAssets();
    loaded(assets, 'x.png', BIG(3000));
    loaded(assets, 'y.png', BIG(3000));
    loaded(assets, 'z.png', BIG(10));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png'), entry('specs', 'y.png'), entry('specs', 'z.png')] });
    const body = treeBody('![x](x.png) ![y](y.png) ![z](z.png)\n', tree);
    const all = await built(inputOf(body, { assets }), WIDE);
    expect(all.doc.querySelectorAll('img')).toHaveLength(3);
    const cut = await built(inputOf(body, { assets }), { maxBytes: all.result.size - 2000, imageWaitMs: 20 });
    expect(cut.result.size).toBeLessThanOrEqual(all.result.size - 2000);
    expect([...cut.doc.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual(['x']);
    expect([...cut.doc.querySelectorAll('.ccrc-export-missing')].map((s) => s.getAttribute('aria-label'))).toEqual(['y', 'z']);
    expect(cut.doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  });

  it('never cuts the body: over the limit it drops colouring, says so and asks nothing; still over, too large (M4.EX7)', async () => {
    const store = syncTestStore('docs');
    // Twenty coloured lines: their spans outweigh the colouring-dropped line the plain file gains.
    const body = treeBody(`\`\`\`bash\n${Array.from({ length: 20 }, () => 'echo hi').join('\n')}\n\`\`\`\n`, treeOk(), '/docs/demo/specs/a.md', store);
    const full = await built(inputOf(body), WIDE);
    expect(full.doc.querySelector('pre code span')).not.toBeNull();
    const dropped = await built(inputOf(body), { maxBytes: full.result.size - 1, imageWaitMs: 20 });
    expect(dropped.doc.querySelector('pre code span')).toBeNull();
    expect(dropped.result.notes).toContain(EXPORT_TEXT.colouringDropped);
    expect(dropped.doc.querySelector('meta[name="ccrc:colouring"]')?.getAttribute('content')).toBe('dropped');
    expect(store.requests).toEqual([]);
    expect(await buildExport(inputOf(body), { maxBytes: 100, imageWaitMs: 20 })).toEqual({ ok: false, why: 'too-large' });
  });

  it('at the real limit, an image that would pass 10 MiB is a placeholder and the file fits (M4.EX7)', async () => {
    const assets = createExportAssets();
    loaded(assets, 'x.png', BIG(8 * 1048576));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const { doc, result } = await built(inputOf(treeBody('![x](x.png)\n', tree), { assets }));
    expect(result.size).toBeLessThanOrEqual(DOCS_EXPORT_MAX_BYTES);
    expect(doc.querySelector('.ccrc-export-missing')?.textContent).toBe(EXPORT_MISSING_SENTENCE['over-size']);
  });

  it.each([
    ['light', 'light'], ['nord', 'nord'], ['the dark default', null],
  ])("pins the exporter's palette: %s (M4.EX10; refinement (e))", async (_name, theme) => {
    const { doc } = await built(inputOf(treeBody('# A\n'), { theme }));
    expect(doc.documentElement.getAttribute('data-theme')).toBe(theme);
  });

  it("colours code from the page's store by peek only: no request, no job, every block's HTML the store's (M4.EX18)", async () => {
    const job = vi.spyOn(docsHighlighter, 'highlight');
    const store = syncTestStore('docs');
    const body = treeBody('```bash\necho one\n```\n\n```bash\necho two\n```\n', treeOk(), '/docs/demo/specs/a.md', store);
    const { doc } = await built(inputOf(body));
    const codes = [...doc.querySelectorAll('pre code')];
    expect(codes).toHaveLength(2);
    for (const [i, raw] of ['echo one', 'echo two'].entries()) {
      const entryOf = store.peek(`bash\u0000${raw}`);
      if (entryOf.kind !== 'html') throw new Error('fixture: not coloured');
      expect(codes[i]?.innerHTML).toBe(entryOf.checked.html);
    }
    expect(store.requests).toEqual([]);
    expect(job).not.toHaveBeenCalled();
  });

  it("a worker's hostile HTML is refused on receipt, and a forged plain string is drawn as text: either way plain, counted failed (M4.EX18)", async () => {
    const hostile: Highlighter = {
      highlight: async () => ({ kind: 'html', html: '<img src=x onerror=alert(1)>', mode: 'block' }),
      status: () => 'live', prewarm: () => undefined,
    };
    const src = '```bash\necho one\n```\n';
    const probe = treeBody(src);
    const real = createHighlightStore(hostile, { mode: 'docs' }, FROZEN_CLOCK);
    real.seed(codeBlocksOf(probe.tree));
    real.request('bash\u0000echo one');
    await vi.waitFor(() => expect(real.settled()).toBe(true));
    const forged: HighlightStore = {
      ...syncTestStore('docs'),
      peek: () => ({ kind: 'html', mode: 'block', checked: { html: '<img src=x onerror=alert(1)>' } as CheckedHighlightHtml }),
    };
    for (const store of [real, forged]) {
      const { doc } = await built(inputOf({ ...probe, store }));
      expect(doc.querySelectorAll('img')).toHaveLength(0);
      expect(doc.querySelector('pre code')?.textContent).toBe('echo one');
      expect(doc.querySelector('meta[name="ccrc:plain-failed"]')?.getAttribute('content')).toBe('1');
    }
  });

  it('a text leaf exports its one block from its store, or plain text when no grammar matched; a plain body keeps its note', async () => {
    const store = syncTestStore('docs');
    const coloured = await built(inputOf({ kind: 'text', text: 'echo hi\n', lang: 'bash', store }));
    const entryOf = store.peek('bash\u0000echo hi');
    if (entryOf.kind !== 'html') throw new Error('fixture: not coloured');
    expect(coloured.doc.querySelector('pre code')?.innerHTML).toBe(entryOf.checked.html);
    const bare = await built(inputOf({ kind: 'text', text: 'a\nb\n', lang: null, store: null }));
    expect(bare.doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe('a\nb\n');
    const plain = await built(inputOf({ kind: 'plain', text: '# not formatted', note: 'Formatting took longer than 2 s; shown as plain text.' }));
    expect(plain.doc.querySelector('.ccrc-export-note')?.textContent).toBe('Formatting took longer than 2 s; shown as plain text.');
    expect(plain.doc.querySelector('pre.ccrc-export-plain')?.textContent).toBe('# not formatted');
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: the file fails to load (`buildExport.tsx` does not exist).
- [ ] **Step 3: Lift `codeBlockParts` out of `CodeBlock`.** In `lib/markdown.tsx`, first replace, inside `CodeBlock`, the seven lines from `  const codeEl = React.Children.toArray(children).find(React.isValidElement) as` through `  const raw = nodeText(children).replace(/\n$/, '');` with the one line `  const { lang, label, raw } = codeBlockParts(children);`. Then find ``/** Fenced code: language label + copy bar over the well.`` and insert before it:

```tsx
/** What a fenced block's code element says: its language (`codeLanguage` of its class), its label (`LANG_LABEL`, own
 *  keys only, else the language, else `text`) and its raw text with one trailing newline stripped. `CodeBlock` and
 *  Export's static `pre` (`docs/export/exportMarkdown.tsx`) both read a block through it, so they label and key it alike. */
export interface CodeBlockParts { readonly lang: string; readonly label: string; readonly raw: string }
export function codeBlockParts(children: ReactNode): CodeBlockParts {
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = codeLanguage(codeEl?.props.className ?? '');
  // Own keys only, as `grammarOf` reads its tables: a fence named `__proto__` or `constructor` is no label.
  const label = (Object.hasOwn(LANG_LABEL, lang) ? LANG_LABEL[lang] : undefined) ?? (lang || 'text');
  return { lang, label, raw: nodeText(children).replace(/\n$/, '') };
}

```

  Run `( cd pwa && ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/code-block.test.tsx test/markdown-highlight.test.tsx test/highlight-html.test.tsx )` — Step 0's counts (the goldens byte-identical).
- [ ] **Step 4: Write `pwa/src/docs/export/exportMarkdown.tsx`:**

```tsx
// Export's Markdown components (spec 2026-10-01 4.17 "The body", "Links", "Images", "Highlighting"; native Docs reader
// W5, Export; refinements (m), (n)). `EXPORT_COMPONENTS` is `DOC_COMPONENTS` with three overrides, each reading
// `ExportMarkdownContext`, which only `buildExport` provides:
//   - `a`: spec 4.17's link table, by `exportLinkTarget`, from the URL `detachUrls` moved into the map: a document in the
//     listing with a committed side, or a repository file, is a GitHub permalink at the commit the export names; a
//     fragment is kept; an http(s) or mailto link opens in a new tab; anything else is an inert span with no `href`;
//   - `img`: the builder's decision for this very element: inlined as a `data:image/` URL, or a placeholder whose words
//     are closed (`EXPORT_MISSING_SENTENCE`); it loads nothing;
//   - `pre`: a static code block with no copy button, its entry read through `exportEntry` (the copy's own skip, then
//     `peek`; never `request`) and drawn through `lib/markdown.tsx`'s one sink, `HighlightedCode`.
// The table wrapper stays `SHARED_COMPONENTS`' (refinement (n)). Every value is a React prop or child, so React escapes
// it; nothing here builds markup from a string.
//
// Ring L4 delivery.
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { Element as HastElement } from 'hast';
import { githubPermalink, resolveDocRef, type GithubPermalink } from '../../../../shared/docs';
import { blockKey, type HighlightStore } from '../../lib/highlightStore';
import { HighlightedCode, codeBlockLabel, codeBlockParts, type CodeBlockParts } from '../../lib/markdown';
import { DOC_COMPONENTS } from '../DocMarkdown';
import type { DocLinkContextValue } from '../DocLink';
import {
  DOC_IMAGE_TEXT, DOC_LINK_INERT_SENTENCE, EXPORT_MISSING_SENTENCE, EXPORT_TEXT, fillSentence, shareRefusalSentence,
  shortCommit,
} from '../docsText';
import type { ShareRefusal } from '../share';
import { exportEntry } from './colouring';
import type { ExportMissing } from './policy';

/** What the builder decided for one `img` of the body. */
export type ExportImageDecision =
  | { readonly kind: 'inline'; readonly src: string; readonly draft: boolean }
  | { readonly kind: 'missing'; readonly why: ExportMissing };

export interface ExportMarkdownContextValue {
  readonly link: DocLinkContextValue;
  /** C: the commit every permalink names. */
  readonly commit: string;
  readonly images: ReadonlyMap<HastElement, ExportImageDecision>;
  /** The page's store; `null`: draw every block plain (colouring dropped to fit). */
  readonly store: HighlightStore | null;
}

/** `null`, the default, has one meaning: rendered outside `buildExport`, so links are inert, images placeholders and
 *  code plain. */
export const ExportMarkdownContext = createContext<ExportMarkdownContextValue | null>(null);

/** What a link of the body becomes in the file (spec 4.17's link table). */
export type ExportLinkTarget =
  | { readonly kind: 'permalink'; readonly href: string }
  | { readonly kind: 'fragment'; readonly href: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'inert'; readonly title: string };

function refusedTitle(why: Extract<GithubPermalink, { ok: false }>['why'], commit: string): string {
  const word: ShareRefusal = why === 'uncommitted' ? 'new-draft' : why;
  return shareRefusalSentence(word, { short: shortCommit(commit) }, false);
}

/** Spec 4.17's link table, for the raw `href` a document wrote, on the leaf `link` names, at commit `commit`. A
 *  document's own fragment is not carried onto its permalink (refinement (m)). */
export function exportLinkTarget(
  link: Pick<DocLinkContextValue, 'section' | 'path' | 'tree'>, commit: string, raw: string,
): ExportLinkTarget {
  const r = resolveDocRef({ section: link.section, path: link.path }, raw);
  switch (r.kind) {
    case 'doc': {
      const kind = link.tree.entries.find((e) => e.section === r.section && e.path === r.path)?.committed?.kind;
      if (kind !== 'file' && kind !== 'exec') return { kind: 'inert', title: fillSentence(EXPORT_TEXT.notListed, { short: shortCommit(commit) }) };
      const p = githubPermalink(link.tree.github, link.tree.ref, commit, { kind: 'leaf', section: r.section, path: r.path, uncommitted: false });
      return p.ok ? { kind: 'permalink', href: p.url } : { kind: 'inert', title: refusedTitle(p.why, commit) };
    }
    case 'repo': {
      const p = githubPermalink(link.tree.github, link.tree.ref, commit, { kind: 'repo', repoPath: r.repoPath });
      return p.ok ? { kind: 'permalink', href: p.url } : { kind: 'inert', title: refusedTitle(p.why, commit) };
    }
    case 'fragment':
      return { kind: 'fragment', href: `#${r.fragment}` };
    case 'external':
      return { kind: 'external', href: r.url };
    case 'self-contained':
      return { kind: 'inert', title: DOC_LINK_INERT_SENTENCE[r.scheme] };
    case 'refused':
      return { kind: 'inert', title: DOC_LINK_INERT_SENTENCE[r.why] };
  }
}

/** The Markdown `a` of an export. Of the tree's own props it keeps what `DocLink` keeps (an `id`, a `title`, a
 *  footnote's `data-*` and `aria-*`), never a URL prop. */
function ExportLink(p: ComponentProps<'a'> & { node?: HastElement }): ReactNode {
  const { node, children, href: _href, ping: _ping, target: _target, rel: _rel, onClick: _onClick, ...rest } = p;
  const ctx = useContext(ExportMarkdownContext);
  const raw = (ctx === null || node === undefined ? undefined : ctx.link.urls.get(node)?.attrs['href']) ?? '';
  const t: ExportLinkTarget = ctx === null ? { kind: 'inert', title: '' } : exportLinkTarget(ctx.link, ctx.commit, raw);
  switch (t.kind) {
    case 'permalink':
      return <a {...rest} href={t.href} rel="noopener noreferrer">{children}</a>;
    case 'fragment':
      return <a {...rest} href={t.href}>{children}</a>;
    case 'external':
      return <a {...rest} href={t.href} target="_blank" rel="noopener noreferrer">{children}</a>;
    case 'inert':
      return <span className="ccrc-export-inert" title={t.title}>{children}</span>;
  }
}

/** The Markdown `img` of an export: the builder's decision for this element. */
function ExportImage(p: ComponentProps<'img'> & { node?: HastElement }): ReactNode {
  const ctx = useContext(ExportMarkdownContext);
  const alt = p.alt ?? '';
  const d = ctx === null || p.node === undefined ? undefined : ctx.images.get(p.node);
  if (d === undefined || d.kind === 'missing') {
    return <span className="ccrc-export-missing" role="img" aria-label={alt}>{EXPORT_MISSING_SENTENCE[d?.why ?? 'refused']}</span>;
  }
  return (
    <>
      <img className="ccrc-export-img" src={d.src} alt={alt} title={p.title} />
      {d.draft && <>{' '}<span className="ccrc-export-caption">{DOC_IMAGE_TEXT.draft}</span></>}
    </>
  );
}

/** A static code block: its label and its code as the page's `CodeBlock` draws them, from `store`, with no copy button
 *  and no request. `at` is the block's own `pre` element (the page skipped some copies, D-7762). */
export function ExportCode(p: { readonly parts: CodeBlockParts; readonly store: HighlightStore | null; readonly at?: object }): ReactNode {
  const { lang, label, raw } = p.parts;
  const answer = p.store === null ? blockKey(lang, raw) : p.store.keyOf(lang, raw);
  const entry = exportEntry(p.store, answer, p.at);
  return (
    <div className="code-block">
      <div className="code-block-bar"><span className="code-block-lang">{codeBlockLabel(label, raw, answer, entry)}</span></div>
      <pre><HighlightedCode entry={entry} raw={raw} /></pre>
    </div>
  );
}

function ExportPre({ children, node }: { children?: ReactNode; node?: HastElement }): ReactNode {
  const ctx = useContext(ExportMarkdownContext);
  return <ExportCode parts={codeBlockParts(children)} store={ctx?.store ?? null} at={node} />;
}

/** The components an export's Markdown body renders with (spec 4.17 "The body"). */
export const EXPORT_COMPONENTS: Components = { ...DOC_COMPONENTS, a: ExportLink, img: ExportImage, pre: ExportPre };
```

- [ ] **Step 5: Write `pwa/src/docs/export/buildExport.tsx`:**

```tsx
// The export builder (spec 2026-10-01 4.17 "Built as React, never as strings", "The doctype", "The head", "CSP",
// "Stylesheet and theme", "Images", "Size", "Highlighting"; native Docs reader W5, Export; refinements (e), (o), (p),
// (q), (r)). `buildExport` builds one React element, `<html>`, renders it with `renderToStaticMarkup`, joins
// `EXPORT_PREFIX` to the markup in this one place, and answers the bytes, their size, the notes and the count of images
// waiting for Load image, or that the body alone is too large. Every value enters as a React prop or child, so React
// escapes it: an export is inert by construction, with no string-level strip pass (M4.EX2). Images come from the page's
// registry only, after waiting at most `limits.imageWaitMs` for those still loading, and are inlined in document order
// while the file fits `limits.maxBytes`; the first that does not, and every later one, is a placeholder (refinement
// (r)). The body is never cut: a body alone over the limit is rendered again with no store, so every block is plain and
// the provenance says colouring was dropped; still over, the answer is `too-large`. Building makes no request and no
// highlight call: code reads the page's store through `exportEntry` (M4.EX18), and this file's import closure holds no
// highlighter (M4.EX17). The element never leaves this file, which exports only `buildExport` and types (M4.EX16); only
// `ExportSheet.tsx` imports it, through one dynamic `import()`, so `react-dom/server` stays out of the main chunk.
//
// Ring L4 delivery.
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { PROSE, cn } from '@ccrc/ui';
import { DOCS_RASTER_TYPES, docsApi, type RasterMime } from '../../../../shared/docs';
import { codeBlocksOf, type HighlightStore } from '../../lib/highlightStore';
import { codeBlockParts } from '../../lib/markdown';
import { renderHast } from '../../lib/renderHast';
import { planImageRef, rasterDataUrl, svgDataUrl } from '../DocImage';
import type { DocLinkContextValue } from '../DocLink';
import type { DetachedUrls } from '../docsLinks';
import { DOC_IMAGE_TEXT, EXPORT_TEXT, fillSentence, pluralS } from '../docsText';
import { exportColouring, type ExportColouring } from './colouring';
import { settleExportAssets, type ExportAsset, type ExportAssets } from './exportAssets';
import { EXPORT_COMPONENTS, ExportCode, ExportMarkdownContext, type ExportImageDecision } from './exportMarkdown';
import {
  DOCS_EXPORT_CSP, DOCS_EXPORT_IMAGE_WAIT_MS, DOCS_EXPORT_MAX_BYTES, EXPORT_GENERATOR, EXPORT_PREFIX, type ExportMissing,
} from './policy';
import { colouringNotes, missingNotes, type ExportMeta, type ExportProvenance } from './provenance';
import { EXPORT_CSS } from './stylesheet';

/** The body an export holds (spec 4.17 "What the file holds, by content class"). */
export type ExportBodyInput =
  | {
    readonly kind: 'tree'; readonly tree: HastRoot; readonly urls: WeakMap<HastElement, DetachedUrls>;
    readonly link: Omit<DocLinkContextValue, 'urls'>; readonly store: HighlightStore;
  }
  | { readonly kind: 'plain'; readonly text: string; readonly note: string }
  | { readonly kind: 'text'; readonly text: string; readonly lang: string | null; readonly store: HighlightStore | null }
  | {
    readonly kind: 'image'; readonly alt: string; readonly draft: boolean;
    readonly image:
      | { readonly kind: 'raster'; readonly bytes: Uint8Array; readonly mime: RasterMime }
      | { readonly kind: 'svg'; readonly bytes: Uint8Array };
  };

export interface ExportInput {
  readonly title: string;
  readonly name: string;
  /** The exporter's `data-theme` (refinement (e)); `null`: the dark default, which has none. */
  readonly theme: string | null;
  /** C: the commit every permalink names (`ExportProvenance.commit`). */
  readonly commit: string;
  readonly provenance: ExportProvenance;
  readonly body: ExportBodyInput;
  /** The page's image registry, for a Markdown body's images; `null`: none. */
  readonly assets: ExportAssets | null;
}

/** The file's two limits; production passes none and gets `policy.ts`'s (refinement (p)). */
export interface ExportLimits { readonly maxBytes: number; readonly imageWaitMs: number }

export type ExportResult =
  | {
    readonly ok: true; readonly name: string; readonly bytes: Uint8Array<ArrayBuffer>; readonly size: number;
    readonly notes: readonly string[]; readonly deferred: number;
  }
  | { readonly ok: false; readonly why: 'too-large' };

const LIMITS: ExportLimits = { maxBytes: DOCS_EXPORT_MAX_BYTES, imageWaitMs: DOCS_EXPORT_IMAGE_WAIT_MS };
const RASTER_MIMES: readonly string[] = Object.values(DOCS_RASTER_TYPES).map((t) => t.mime);
const NO_IMAGES: ReadonlyMap<HastElement, ExportImageDecision> = new Map();
/** A doctype React may write before `<html>`: removed, so the file holds `EXPORT_PREFIX` only (refinement (q)). */
const LEADING_DOCTYPE = /^<!doctype html>/i;
const encoder = new TextEncoder();
const missing = (why: ExportMissing): ExportImageDecision => ({ kind: 'missing', why });

/** Every `img` of `tree`, in document order. Iterative. */
function imagesOf(tree: HastRoot): HastElement[] {
  const out: HastElement[] = [];
  const stack: RootContent[] = [...tree.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'img') out.push(n);
    for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

function rasterSrc(bytes: Uint8Array, mime: string): string | null {
  return RASTER_MIMES.includes(mime) ? rasterDataUrl(bytes, mime as RasterMime) : null;
}

const srcOf = (asset: ExportAsset): string | null => (asset.kind === 'svg' ? asset.src : rasterSrc(asset.bytes, asset.mime));

/** What each image of the body becomes, from the page's registry only (spec 4.17 "Images"; M4.EX3). */
async function decideImages(
  tree: HastRoot, link: DocLinkContextValue, assets: ExportAssets | null, waitMs: number,
): Promise<Map<HastElement, ExportImageDecision>> {
  const planned = imagesOf(tree).map((node) => {
    const recorded = link.urls.get(node);
    const plan = planImageRef(link, recorded?.attrs['src'] ?? '', recorded?.imageIndex ?? null);
    return { node, plan, key: plan.kind === 'pinned' ? docsApi.file(link.project, plan.pin) : null };
  });
  if (assets !== null) await settleExportAssets(assets, planned.flatMap((p) => (p.key === null ? [] : [p.key])), waitMs);
  const out = new Map<HastElement, ExportImageDecision>();
  for (const { node, plan, key } of planned) {
    if (plan.kind === 'refused') {
      out.set(node, missing(plan.why === 'external' ? 'external' : 'refused'));
      continue;
    }
    const held = key === null || assets === null ? undefined : assets.get(key);
    if (held === undefined) out.set(node, missing(plan.deferred ? 'deferred' : 'failed'));
    else if (held.s === 'loading') out.set(node, missing('timed-out'));
    else if (held.s === 'failed') out.set(node, missing('failed'));
    else {
      const src = srcOf(held.asset);
      out.set(node, src === null ? missing('failed') : { kind: 'inline', src, draft: plan.draft });
    }
  }
  return out;
}

/** What the build adds to the provenance for one attempt: the colouring and image lines, the banner's images clause,
 *  and the store the body draws with (`null` once colouring is dropped). */
function partsOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean) {
  const body = input.body;
  const store = coloured && (body.kind === 'tree' || body.kind === 'text') ? body.store : null;
  const colouring: ExportColouring | null = body.kind === 'tree'
    ? exportColouring(codeBlocksOf(body.tree), store, !coloured)
    : body.kind === 'text' && body.lang !== null
      ? exportColouring([{ lang: body.lang, raw: body.text.replace(/\n$/, '') }], store, !coloured)
      : null;
  const counts = new Map<ExportMissing, number>();
  let draftImages = 0;
  for (const d of images.values()) {
    if (d.kind === 'missing') counts.set(d.why, (counts.get(d.why) ?? 0) + 1);
    else if (d.draft) draftImages += 1;
  }
  const lines = [...(colouring === null ? [] : [colouringNotes(colouring)]), missingNotes(counts)];
  const notes: readonly string[] = [...input.provenance.notes, ...lines.flatMap((l) => l.notes)];
  const metas: readonly ExportMeta[] = [...input.provenance.metas, ...lines.flatMap((l) => l.metas)];
  const base = input.provenance.banner;
  const banner = base === null || draftImages === 0 ? base
    : `${base} ${fillSentence(EXPORT_TEXT.bannerImages, { k: draftImages, s: pluralS(draftImages) })}`;
  return { store, notes, metas, banner, deferred: counts.get('deferred') ?? 0 };
}

function bodyOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, store: HighlightStore | null): ReactNode {
  const body = input.body;
  switch (body.kind) {
    case 'tree':
      return (
        <ExportMarkdownContext value={{ link: { ...body.link, urls: body.urls }, commit: input.commit, images, store }}>
          <article className={cn('doc-body', PROSE)}>{renderHast(body.tree, { components: EXPORT_COMPONENTS })}</article>
        </ExportMarkdownContext>
      );
    case 'plain':
      return (
        <article className="doc-body">
          <p className="ccrc-export-note">{body.note}</p>
          <pre className="ccrc-export-plain">{body.text}</pre>
        </article>
      );
    case 'text':
      return body.lang === null
        ? <article className="doc-body"><pre className="ccrc-export-plain">{body.text}</pre></article>
        : (
          <article className={cn('doc-body', PROSE)}>
            <ExportCode parts={codeBlockParts(<code className={'language-' + body.lang}>{body.text}</code>)} store={store} />
          </article>
        );
    case 'image': {
      const src = body.image.kind === 'svg' ? svgDataUrl(body.image.bytes) : rasterSrc(body.image.bytes, body.image.mime);
      if (src === null) throw new Error('buildExport: the image is not a raster type');
      return (
        <article className="doc-body">
          <img className="ccrc-export-img" src={src} alt={body.alt} />
          {body.draft && <>{' '}<span className="ccrc-export-caption">{DOC_IMAGE_TEXT.draft}</span></>}
        </article>
      );
    }
  }
}

function documentOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ReactElement {
  const parts = partsOf(input, images, coloured);
  return (
    <html data-theme={input.theme ?? undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="Content-Security-Policy" content={DOCS_EXPORT_CSP} />
        <title>{input.title}</title>
        <meta name="generator" content={EXPORT_GENERATOR} />
        {parts.metas.map((m) => <meta key={m.name} name={m.name} content={m.content} />)}
        <style>{EXPORT_CSS}</style>
      </head>
      <body className="ccrc-export">
        {parts.banner !== null && <p className="ccrc-export-draft" role="note">{parts.banner}</p>}
        <div className="ccrc-export-page">
          <section className="ccrc-export-provenance" aria-label={EXPORT_TEXT.provenance}>
            <dl className="ccrc-export-facts">
              {input.provenance.facts.map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>)}
            </dl>
            {parts.notes.length > 0 && <ul className="ccrc-export-notes">{parts.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </section>
          {bodyOf(input, images, parts.store)}
        </div>
      </body>
    </html>
  );
}

/** The file for one attempt: `EXPORT_PREFIX` joined to the rendered `<html>`, here and nowhere else. */
function fileOf(input: ExportInput, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): Uint8Array<ArrayBuffer> {
  const markup = renderToStaticMarkup(documentOf(input, images, coloured));
  return encoder.encode(EXPORT_PREFIX + markup.replace(LEADING_DOCTYPE, ''));
}

export async function buildExport(input: ExportInput, limits: ExportLimits = LIMITS): Promise<ExportResult> {
  const body = input.body;
  const decided = body.kind === 'tree'
    ? await decideImages(body.tree, { ...body.link, urls: body.urls }, input.assets, limits.imageWaitMs)
    : NO_IMAGES;
  const done = (bytes: Uint8Array<ArrayBuffer>, images: ReadonlyMap<HastElement, ExportImageDecision>, coloured: boolean): ExportResult => {
    const parts = partsOf(input, images, coloured);
    return { ok: true, name: input.name, bytes, size: bytes.length, notes: parts.notes, deferred: parts.deferred };
  };
  const whole = fileOf(input, decided, true);
  if (whole.length <= limits.maxBytes) return done(whole, decided, true);
  // The body alone (every inlined image an over-size placeholder), coloured, then plain. The body is never cut.
  const none = new Map<HastElement, ExportImageDecision>(
    [...decided].map(([node, d]): [HastElement, ExportImageDecision] => [node, d.kind === 'inline' ? missing('over-size') : d]));
  let coloured = true;
  let file = fileOf(input, none, true);
  if (file.length > limits.maxBytes) {
    coloured = false;
    file = fileOf(input, none, false);
    if (file.length > limits.maxBytes) return { ok: false, why: 'too-large' };
  }
  // Images back in document order while the file fits: the first that does not, and every later one, stay out.
  const kept = new Map(none);
  const inlined: HastElement[] = [];
  let estimate = file.length;
  for (const [node, d] of decided) {
    if (d.kind !== 'inline') continue;
    if (estimate + d.src.length > limits.maxBytes) break;
    kept.set(node, d);
    inlined.push(node);
    estimate += d.src.length;
  }
  file = fileOf(input, kept, coloured);
  // The estimate leaves out a few bytes of markup per image: take the last one back out until the file fits.
  while (file.length > limits.maxBytes && inlined.length > 0) {
    kept.set(inlined.pop()!, missing('over-size'));
    file = fileOf(input, kept, coloured);
  }
  return done(file, kept, coloured);
}
```

- [ ] **Step 6: Measure, record, and branch** (§4.17's W5 rows: React 19's head order, its `<style>` text, its doctype). Run `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )`. Record in the SDD ledger, from the M4.EX1 case's parsed head and a one-line throwaway print (never committed) of `renderToStaticMarkup(<html><head><meta charSet="utf-8" /><meta httpEquiv="Content-Security-Policy" content="x" /><title>t</title><meta name="a" content="b" /><style>{'a>b{c:"&"}'}</style></head><body /></html>)`: whether React wrote a doctype, the order of the head's children, and whether the `<style>` text came out exactly as given.
  - **Expected (no change):** the head is charset, CSP, title, metas, style, and the style text is unescaped. Every Task 5 case green.
  - **6a, React moved a meta** (M4.EX1's head-order case red): the spec's fallback. In `policy.ts`, `EXPORT_PREFIX` becomes `` `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DOCS_EXPORT_CSP}">` `` (built from constants only; declare `DOCS_EXPORT_CSP` above it) and its docstring says why; in `buildExport.tsx#documentOf`, the two `<meta charSet>` and `<meta httpEquiv>` lines are removed. The HTML parser puts the two metas first in `<head>` and merges `<html>`'s `data-theme` into the root, so M4.EX1's case holds unchanged. Record it as a measurement, not a departure.
  - **6b, React escaped the style text** (M4.EX2's `style).toBe(EXPORT_CSS)` red): the spec's one exception. `<style>{EXPORT_CSS}</style>` becomes `<style dangerouslySetInnerHTML={{ __html: EXPORT_CSS }} />`. That is a second sink, which `docs-scans.test.ts`' clause W5h-a reds (`'M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode'`), so this task admits it before Step 7 and commits green. Claim `pwa/test/docs-scans.test.ts`. In clause W5h-a's `sinkVerdict`, before `return \`${file} ${functionName(fn)} ${ok ? 'ok' : 'bad'}\`;` add: `if (file === 'src/docs/export/buildExport.tsx' && expr !== undefined && ts.isObjectLiteralExpression(expr) && expr.properties.length === 1 && ts.isPropertyAssignment(expr.properties[0]!) && ts.isIdentifier(expr.properties[0]!.initializer) && (expr.properties[0]!.initializer as ts.Identifier).text === 'EXPORT_CSS' && ts.isJsxAttributes(attr.parent) && ts.isJsxSelfClosingElement(attr.parent.parent) && ts.isIdentifier(attr.parent.parent.tagName) && attr.parent.parent.tagName.text === 'style') ok = true;`. Its case `'M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode'` is renamed `'M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode, and Export's one <style>'` and expects `['src/docs/export/buildExport.tsx documentOf ok', 'src/lib/markdown.tsx HighlightedCode ok']`. The admitted sink also reaches clause W5h-a's planted cases: their `planted(rel, edit)` copies the whole of `pwa/src` (`cpSync(SRC_DIR, …)`), `buildExport.tsx` included, and five of them compare the copy's sink list EXACTLY (`toEqual`), so each copy's list now begins with the admitted entry and all five would red. Each exact list therefore gains 'src/docs/export/buildExport.tsx documentOf ok' as its FIRST element, where `sourceFiles`' sorted walk puts it (`src/docs/…` sorts before `src/lib/…`): in `docs-scans.test.ts`, every `.sinks).toEqual(['` becomes `.sinks).toEqual(['src/docs/export/buildExport.tsx documentOf ok', '` — ten replacements, the real-tree case above plus nine arrays in the five planted cases: `'M4.H15 planted: a second sink under lib/ or under docs/export/ is red'` (its `lib` list; its `exp` half uses `toContain` and is unchanged), `'M4.H15 planted: the sink fed the raw string, unchecked, is red'`, `'M4.H15 planted: the sink name in a JSX spread is red'`, `'M4.H15 planted: the sink name in a props object given to createElement is red'` and `'M4.H15 planted: the sink name as an element-access key, a string key, a computed key or a shorthand is red; a comment is not'` (its five lists). A count other than ten is a stop-and-ask. Each planted case still proves what it proved: its list still names its planted sink `bad` (or `HighlightedCode bad` for the raw string), and the exact comparison still reds on any sink besides the one now listed, so admitting more than `EXPORT_CSS`'s `<style>` reds them. Copying `pwa/src` less `docs/export` would keep the lists as they are, but every planted case would then stop covering that directory, so it is not taken. The `<style>` exception's own control is the first planted case's `exp` half: it plants `<style dangerouslySetInnerHTML={{ __html: 'a{}' }} />` in `buildExport.tsx` (not `EXPORT_CSS`, so still `bad`) and stays green. Task 10 Step 1b then adds only the matching skip to `exportInertHits`, which Task 10 creates. Record the exception and the ten edits in the SDD ledger as the measurement's consequence.
  - **Anything else** (React writes a `link`, a `template`, a comment, or a second root): stop and ask the coordinator.
- [ ] **Step 7: Run to verify they pass**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — Expected: `Tests  51 passed (51)` (Task 3's 32 plus this task's 19). `( cd pwa && ./node_modules/.bin/vitest run test/render-hast.test.tsx test/docs-markdown.test.tsx test/docs-scans.test.ts )` — Step 0's counts (`docs-scans`' clause W5h-a still finds one sink, `HighlightedCode`'s, under branch "Expected"; under 6b the real-tree case lists `buildExport.tsx documentOf ok` first and then `HighlightedCode`'s, and the five planted M4.H15 cases, their lists edited in Step 6b, are green, each still naming its planted sink `bad`). `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/literal-census.test.ts )` through `ccrc test` — Step 0's counts; if `markup-census` reports `ExportCode`'s bar as a second copy of `CodeBlock`'s, register that one cluster with the reason "Export's static copy of the code block's bar: the same label, no copy button (spec 4.17)", and stop and ask if it reports more. `TSC-OK`.
- [ ] **Step 8: Commit.** `git add pwa/src/lib/markdown.tsx pwa/src/docs/export/exportMarkdown.tsx pwa/src/docs/export/buildExport.tsx pwa/test/docs-export.test.tsx` (plus `pwa/test/markup-census.test.ts` and `pwa/src/docs/export/policy.ts` if Step 6a or 7 edited them, and, under 6b, `pwa/test/docs-scans.test.ts`, whose exception and ten list edits Step 7 needs to be green, so this commit carries no red guard into Tasks 6-9), message `docs: the export builder, one React html, inert by construction (docs W5 Export)`, trailer. Record the JSON row fence and the measurements.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T5-M1 | M4.EX2 | pwa | `src/docs/export/exportMarkdown.tsx` | `      return <span className="ccrc-export-inert" title={t.title}>{children}</span>;` → `      return <a {...rest} href={raw}>{children}</a>;` | `test/docs-export.test.tsx` | 2 failed — `'is inert over a hostile corpus: …'`; `'renders a permalink with rel and no target, an external link in a new tab, and an inert span with no href (M4.EX4)'` |
| W5X-T5-M2 | M4.EX3 | pwa | `src/docs/export/buildExport.tsx` | `    if (plan.kind === 'refused') {` → `    if (plan.kind === 'refused' && plan.why !== 'external') {` (an external image falls through to the registry) | `test/docs-export.test.tsx` | 1 failed — `"images come from the page's registry only: loaded ones inline, the rest closed placeholders, no fetch (M4.EX3)"` |
| W5X-T5-M3 | M4.EX6 | pwa | `src/docs/export/buildExport.tsx` | `        {parts.banner !== null && <p className="ccrc-export-draft" role="note">{parts.banner}</p>}` → removed | `test/docs-export.test.tsx` | 1 failed — `'is inert over a hostile corpus: …'` (the banner first) |
| W5X-T5-M4 | M4.EX1 | pwa | `src/docs/export/buildExport.tsx` | the `<meta httpEquiv="Content-Security-Policy" content={DOCS_EXPORT_CSP} />` line moved after the `<title>` line | `test/docs-export.test.tsx` | 1 failed — `'begins with one <!doctype html>, then meta charset, the CSP meta …'` (under branch 6a, the row's file is `src/docs/export/policy.ts` and it moves the CSP meta BEFORE the charset meta inside `EXPORT_PREFIX`'s template, so the parsed head's first child is the CSP meta and `head[0]`'s charset check reds) |
| W5X-T5-M5 | M4.EX1 | pwa | `src/docs/export/buildExport.tsx` | `return encoder.encode(EXPORT_PREFIX + markup.replace(LEADING_DOCTYPE, ''));` → `return encoder.encode(markup.replace(LEADING_DOCTYPE, ''));` | `test/docs-export.test.tsx` | 1 failed — `'begins with one <!doctype html>, …'` |
| W5X-T5-M6 | M4.EX18 | pwa | `src/docs/export/exportMarkdown.tsx` | `  const entry = exportEntry(p.store, answer, p.at);` → `  const entry = exportEntry(p.store, answer, p.at);\n  if (p.store !== null && answer.kind === 'key') p.store.request(answer.key);` | `test/docs-export.test.tsx` | 2 failed — `"colours code from the page's store by peek only: …"`; `'never cuts the body: …'` |
| W5X-T5-M7 | M4.EX18 | pwa | `src/docs/export/exportMarkdown.tsx` | `      <pre><HighlightedCode entry={entry} raw={raw} /></pre>` → `      <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: entry.kind === 'html' ? entry.checked.html : raw }} /></pre>` | `test/docs-export.test.tsx` | 1 failed — `"a worker's hostile HTML is refused on receipt, and a forged plain string is drawn as text: …"` (`docs-scans.test.ts`' M4.H15 case reds too) |
| W5X-T5-M8 | M4.EX3 | pwa | `src/docs/export/buildExport.tsx` | `  if (assets !== null) await settleExportAssets(assets, planned.flatMap((p) => (p.key === null ? [] : [p.key])), waitMs);` → removed | `test/docs-export.test.tsx` | 1 failed — `'an image the page is still loading is awaited, inlined when it lands, a timed-out placeholder when it does not (M4.EX3)'` |
| W5X-T5-M9 | M4.EX7 | pwa | `src/docs/export/buildExport.tsx` | `    if (estimate + d.src.length > limits.maxBytes) break;` → `    if (estimate + d.src.length > limits.maxBytes) continue;` | `test/docs-export.test.tsx` | 1 failed — `'inlines images in document order while the file fits: …'` |
| W5X-T5-M10 | M4.EX7 | pwa | `src/docs/export/buildExport.tsx` | `    file = fileOf(input, none, false);` → `    file = fileOf(input, none, true);` | `test/docs-export.test.tsx` | 1 failed — `'never cuts the body: …'` |
| W5X-T5-M11 | M4.EX10 | pwa | `src/docs/export/buildExport.tsx` | `<html data-theme={input.theme ?? undefined}>` → `<html data-theme={input.theme ?? 'dark'}>` | `test/docs-export.test.tsx` | 1 failed — `"pins the exporter's palette: the dark default (M4.EX10; refinement (e))"` |
| W5X-T5-M12 | M4.EX4 | pwa | `src/docs/export/exportMarkdown.tsx` | `if (kind !== 'file' && kind !== 'exec') return { kind: 'inert', title: fillSentence(EXPORT_TEXT.notListed, { short: shortCommit(commit) }) };` → removed | `test/docs-export.test.tsx` | 2 failed — `"links follow spec 4.17's table (M4.EX4)"`; `'renders a permalink with rel and no target, …'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export.test.tsx )` — 51 passed; the goldens and the guards unchanged; `TSC-OK`.

### Task 6: What the leaf's body shows, published; the screen holds it, the page's store and the registry (M4.EX15's publication half; the W5h-a hand-off, D-7755 and D-7763; refinements (a), (h), (i))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in publishing exactly what is on screen, once, and in a holder that never makes a store twice.

**Spec rows:** §4.10 "The settled outcome" and the W5h-a hand-off (§4.4 "The text leaf"; the composition moves to `DocsScreen` and `DocsHead`, refinement (h)), §4.17 ("When it is offered", "What the file holds"), M4.EX15 (the publication half); refinements (a), (h), (i).

**Files:**
- Create: `pwa/src/docs/exportBody.ts`, `pwa/test/docs-export-body.test.tsx`.
- Modify: `pwa/src/docs/DocMarkdown.tsx` (one import; `DocPlain`'s, `DocTree`'s and `DocMarkdown`'s publications; `DocTree`'s `text` prop and its one call), `pwa/src/docs/DocsLeaf.tsx` (one import; `TextBody`'s publication), `pwa/src/docs/ReaderFrame.tsx` (one import; `ReaderShown`; one element in the frame's arm), `pwa/src/screens/DocsScreen.tsx` (imports; the registry, the holders, the nested `HighlighterContext`, the `ExportBodyContext` provider; the plain view's URL and the effect that clears it; `DocsLeaf`'s `reader` and `DocsHead`'s new props), `pwa/src/docs/DocsHead.tsx` (three type imports; five optional props, read in Task 8).
- Guards (not edited): `pwa/test/docs-markdown.test.tsx`, `pwa/test/highlight-wiring.test.tsx`, `pwa/test/reader-frame.test.tsx`, `pwa/test/docs-screen.test.tsx`, `pwa/test/docs-truth.test.tsx`, `pwa/test/docs-visit.test.tsx`, `pwa/test/app-docs-boundary.test.tsx`.

**Interfaces:** Produces, in `exportBody.ts`: `ExportBody`, `READER_BODY`, `GATE_BODY`, `ExportBodyContext: React.Context<((body: ExportBody | null) => void) | null>`, `usePublishExportBody(body)`; the `DocsHead` props `exportBody?`, `pageStore?`, `exportAssets?`, `plainView?`, `onPlainView?`.

**Decisions:** (1) Each body publishes what it shows, in an effect, and withdraws it in the effect's cleanup; "Formatting…" publishes nothing (refinement (h)). React runs an unmounting body's cleanup before the next body's effect in one commit, so one holder, one slot, is enough (D-7755's "`publish(null)` names no store": a leaf mounts one body at a time). (2) A tree's publication carries its text, its detached tree and URL map and its link context, so Export renders the very objects the page rendered (the store's `copySkip` keys on those `pre` elements, D-7762) and never runs `detachUrls` again. (3) The reader frame's arm mounts `ReaderShown`, which publishes `READER_BODY`; its fallbacks mount `DocMarkdown` or `DocPlain`, which publish their own (refinement (a)). (4) `DocsScreen` gives W5h-a's `publish` slot a holder through a nested `HighlighterContext` value memoised on the outer one, so `useDocsHighlightStore`'s memo is stable (refinement (i)); a body that fell back publishes no store (D-7763), and none is needed for a plain body. (5) `plainAt` is the page URL the reader was turned off at; `DocsLeaf` gets `reader={null}` there, and an effect keyed on `here` clears it once the page changes (the form of `setTrail`'s effect beside it), so leaving the page brings the reader back, on a later return too (refinement (a); Task 8's return case, W5X-T8-M12). (6) The body's publication and the store meet in `DocsScreen` and are composed in `DocsHead`, not in `ExportSheet` (refinement (h)). (Departures: (a), (h).)

- [ ] **Step 0:** `test -f pwa/src/docs/export/exportAssets.ts && git grep -qF "function DocTree(p: { readonly tree: HastRoot; readonly link: Omit<DocLinkContextValue, 'urls'> }): ReactNode {" HEAD -- pwa/src/docs/DocMarkdown.tsx && git grep -qF "          {sheets}" HEAD -- pwa/src/docs/ReaderFrame.tsx && git grep -qF "const highlighters = useContext(HighlighterContext);" HEAD -- pwa/src/screens/DocsScreen.tsx && echo T6-BASE-OK`. Claim `DocMarkdown.tsx`, `DocsLeaf.tsx`, `ReaderFrame.tsx`, `DocsScreen.tsx`, `DocsHead.tsx`. Record the guard suites' counts.
- [ ] **Step 1: Write `pwa/test/docs-export-body.test.tsx`:**

```tsx
// Docs W5 Export, Task 6: what a leaf's body shows, published for Export (spec 2026-10-01 4.10 "The settled outcome",
// 4.17; M4.EX15's publication half; refinements (a), (h); the W5h-a hand-off). Each body publishes what it shows
// through `ExportBodyContext`, in an effect, and withdraws it on cleanup: a parsed tree with its text and URL map, a
// plain body with its note, the render gate, a text leaf's text and grammar, or the reader frame. Placeholders only:
// project `demo`, `specs/...`.
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { DocsTreeOk } from '../../shared/docs';
import { DOC_MARKDOWN_ACTION, DocMarkdown, docShownAsTextNote, docsPlainNote } from '../src/docs/DocMarkdown';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { ExportBodyContext, type ExportBody } from '../src/docs/exportBody';
import { ReaderFrame, type ReaderDeps } from '../src/docs/ReaderFrame';
import { pinFor, type DocsVisit } from '../src/docs/useDocsVisit';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { entry, fileResponse, pageAt, treeOk, treeResponse } from './docsFixtures';
import { withSyncHighlight } from './highlightTestStore';

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** `node` under an `ExportBodyContext` whose one, stable listener records every publication in order. */
function recording(node: ReactNode): { seen: (ExportBody | null)[]; view: ReturnType<typeof render>; again: (n: ReactNode) => void } {
  const seen: (ExportBody | null)[] = [];
  const publish = (b: ExportBody | null): void => { seen.push(b); };
  const view = render(<ExportBodyContext value={publish}>{node}</ExportBodyContext>);
  return { seen, view, again: (n) => view.rerender(<ExportBodyContext value={publish}>{n}</ExportBodyContext>) };
}

function firstImg(tree: HastRoot): HastElement | undefined {
  const stack = [...tree.children];
  while (stack.length > 0) {
    const n = stack.shift()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'img') return n;
    stack.unshift(...n.children);
  }
  return undefined;
}

describe("what a leaf's body shows, published for Export (spec 4.10, 4.17; M4.EX15)", () => {
  it('a Markdown page publishes nothing while it formats, then its tree, text and URL map, and withdraws them when it goes', async () => {
    let resolve: (o: ParseOutcome) => void = () => {};
    const slow: MarkdownParser = () => new Promise<ParseOutcome>((r) => { resolve = r; });
    const text = '# A\n\n![x](x.png)\n';
    const { seen, view } = recording(<DocMarkdown text={text} pinKey="p" parser={slow} link={LINK} />);
    await act(async () => { await Promise.resolve(); });
    expect(seen.filter((b) => b !== null)).toEqual([]);
    await act(async () => { resolve(parseMarkdown(text, 'docs')); });
    await waitFor(() => expect(seen.at(-1)?.kind).toBe('tree'));
    const body = seen.at(-1);
    if (body?.kind !== 'tree') throw new Error('not a tree');
    expect(body.text).toBe(text);
    expect(body.link).toBe(LINK);
    const img = firstImg(body.tree);
    expect(img === undefined ? undefined : body.urls.get(img)?.attrs['src']).toBe('x.png');
    view.unmount();
    expect(seen.at(-1)).toBeNull();
  });

  it('a body Docs did not format publishes its text plain, with the note it shows', async () => {
    const timeout: MarkdownParser = async () => ({ kind: 'timeout', budgetMs: 2000 });
    const { seen } = recording(<DocMarkdown text="# A" pinKey="p" parser={timeout} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'plain', text: '# A', note: docsPlainNote({ kind: 'timeout', budgetMs: 2000 }) }));
  });

  it('the render gate publishes the gate; Show as text then publishes the text plain', async () => {
    const big = `# A\n\n${'x'.repeat(DOCS_RENDER_GATE_BYTES)}\n`;
    const { seen } = recording(<DocMarkdown text={big} pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'gate' }));
    fireEvent.click(screen.getByRole('button', { name: DOC_MARKDOWN_ACTION.showAsText }));
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'plain', text: big, note: docShownAsTextNote(utf8ByteLength(big)) }));
  });

  const TEXT_LEAVES: [string, string | null][] = [['a.json', 'json'], ['a.txt', null]];
  it.each(TEXT_LEAVES)('a text leaf (%s) publishes its text and the grammar it matched (%s)', async (path, lang) => {
    const tree: DocsTreeOk = treeOk({ entries: [entry('specs', path)] });
    const page = pageAt(`/docs/demo/specs/${path}`);
    if (page.kind !== 'path') throw new Error('fixture: not a leaf');
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture: opens nothing');
    const r = fileResponse('{"a":1}\n');
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: 0 },
      file: { s: 'ok', pin, answer: { ...r, contentClass: 'text', show: { ...r.show, path } }, receivedAt: 0 },
      freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null, retryTree: vi.fn(), retryFile: vi.fn(),
      refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    const { seen } = recording(withSyncHighlight(<DocsLeaf visit={visit} tree={tree} page={page} parser={parser} />));
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'text', text: '{"a":1}\n', lang }));
  });

  it("while the reader frame shows the leaf it publishes that; a reader that falls back hands over to the plain view's tree (refinement (a))", async () => {
    const show = fileResponse('# A\n').show;
    const frame = (reader: ReaderDeps): ReactNode => (
      <ReaderFrame show={show} bodyKey="k" link={LINK} parser={parser} reader={reader} pendingFragment={null} onFragmentConsumed={() => {}} />
    );
    const pending = { render: () => new Promise(() => {}), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const shown = recording(frame(pending));
    await waitFor(() => expect(shown.seen.at(-1)).toEqual({ kind: 'reader' }));
    shown.view.unmount();
    expect(shown.seen.at(-1)).toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusing = { render: async () => ({ kind: 'worker-unavailable' }), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const fell = recording(frame(refusing));
    await waitFor(() => expect(fell.seen.at(-1)?.kind).toBe('tree'));
    vi.restoreAllMocks();
  });

  it('a re-parse withdraws the old tree before the new one lands, so one holder ends on the body on screen (D-7755)', async () => {
    const { seen, again } = recording(<DocMarkdown key="1" text="# A" pinKey="1" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)?.kind).toBe('tree'));
    again(<DocMarkdown key="2" text="# B" pinKey="2" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: 'tree', text: '# B' }));
    const lastA = seen.findLastIndex((b) => b?.kind === 'tree' && b.text === '# A');
    expect(seen[lastA + 1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-body.test.tsx )` — Expected: the file fails to load (`exportBody.ts` does not exist).
- [ ] **Step 3: Write `pwa/src/docs/exportBody.ts`:**

```ts
// The settled outcome (spec 2026-10-01 4.10 "The settled outcome", 4.17; native Docs reader W5, Export; refinements (a),
// (h)): what a leaf's body shows, published for the leaf's Export. Each body publishes what it shows, in an effect, and
// withdraws it (`null`) in that effect's cleanup:
//   - `tree`: `DocMarkdown`'s parsed tree, as `DocTree` drew it: the text it answers, the detached tree and its URL map
//     (Export renders these very objects and never runs `detachUrls` again), and the page's link context;
//   - `plain`: a body shown as plain text, with its note (`DocPlain`: an outcome Docs did not format, Show as text, bytes
//     that are not UTF-8, the doc-body boundary's fallback, the reader's timeout);
//   - `gate`: the render gate, waiting for Format anyway or Show as text;
//   - `text`: a text leaf's text and the grammar its extension matched, or `null` (`TextBody`);
//   - `reader`: the reader frame shows the leaf (refinement (a)).
// "Formatting…" publishes nothing. A leaf mounts one body at a time, and React runs the leaving body's cleanup before the
// next body's effect, so one holder (`DocsScreen`'s) always ends on the body on screen. The page's highlight store
// travels apart, through W5h-a's `HighlighterContext` `publish` slot; `DocsScreen` holds both and `DocsHead#exportStateFor`
// composes them (refinement (h)).
//
// Ring L4 (a hook).
import { createContext, useContext, useEffect } from 'react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { DocLinkContextValue } from './DocLink';
import type { DetachedUrls } from './docsLinks';

export type ExportBody =
  | { readonly kind: 'reader' }
  | { readonly kind: 'gate' }
  | {
    readonly kind: 'tree'; readonly text: string; readonly tree: HastRoot;
    readonly urls: WeakMap<HastElement, DetachedUrls>; readonly link: Omit<DocLinkContextValue, 'urls'>;
  }
  | { readonly kind: 'plain'; readonly text: string; readonly note: string }
  | { readonly kind: 'text'; readonly text: string; readonly lang: string | null };

export const READER_BODY: ExportBody = Object.freeze({ kind: 'reader' } as const);
export const GATE_BODY: ExportBody = Object.freeze({ kind: 'gate' } as const);

/** Where a body publishes. `null`, the default, has one meaning: nothing listens (a body outside the Docs screen). */
export const ExportBodyContext = createContext<((body: ExportBody | null) => void) | null>(null);

/** Publishes `body` while it stands and the component is mounted; `null` publishes nothing. The caller memoises `body`. */
export function usePublishExportBody(body: ExportBody | null): void {
  const publish = useContext(ExportBodyContext);
  useEffect(() => {
    if (publish === null || body === null) return undefined;
    publish(body);
    return () => publish(null);
  }, [publish, body]);
}
```

- [ ] **Step 4: The publishers.**
  - `DocMarkdown.tsx`: after `import { showBytes } from './objectUrls';` add `import { GATE_BODY, usePublishExportBody, type ExportBody } from './exportBody';`. In `DocPlain`, after its signature line `export function DocPlain(p: { readonly text: string; readonly note: string; readonly action?: ReactNode }): ReactNode {` add `  usePublishExportBody(useMemo<ExportBody>(() => ({ kind: 'plain', text: p.text, note: p.note }), [p.text, p.note]));`. `function DocTree(p: { readonly tree: HastRoot; readonly link: Omit<DocLinkContextValue, 'urls'> }): ReactNode {` becomes `function DocTree(p: { readonly tree: HastRoot; readonly text: string; readonly link: Omit<DocLinkContextValue, 'urls'> }): ReactNode {`, and after its `  const ctx = useMemo<DocLinkContextValue>(() => ({ ...p.link, urls: detached.urls }), [p.link, detached]);` add:

```tsx
  // What this body shows, for Export (refinement (h)): the very tree, map and link context drawn here.
  usePublishExportBody(useMemo<ExportBody>(
    () => ({ kind: 'tree', text: p.text, tree: detached.tree, urls: detached.urls, link: p.link }), [p.text, detached, p.link]));
```

    `        <DocTree tree={shown.tree} link={p.link} />` becomes `        <DocTree tree={shown.tree} text={p.text} link={p.link} />`. In `DocMarkdown`, after `  const [attempt, setAttempt] = useState(0);` add `  usePublishExportBody(choice === 'ask' ? GATE_BODY : null);`.
  - `DocsLeaf.tsx`: after `import { pinFor, type DocsVisit, type FileSlot } from './useDocsVisit';` add `import { usePublishExportBody, type ExportBody } from './exportBody';`. In `TextBody`, after the statement that ends `    [ext, text],\n  ));` add:

```tsx
  // What this body shows, for Export: its text, and the grammar that colours it, if any. Bytes that are not UTF-8 are
  // `DocPlain`'s, which publishes itself.
  usePublishExportBody(useMemo<ExportBody | null>(
    () => (src.kind === 'markdown' ? { kind: 'text', text: src.text, lang: text === null ? null : ext } : null), [src, text, ext]));
```

  - `ReaderFrame.tsx`: after `import { copyText } from './share';` add `import { READER_BODY, usePublishExportBody } from './exportBody';`. Before `export function ReaderFrame(p: ReaderFrameProps): ReactNode {` insert:

```tsx
/** Tells Export that the reader frame shows this body (refinement (a)). Mounted in the frame's arm only, so a fallback's
 *  plain view publishes its own body in its place. */
function ReaderShown(): null {
  usePublishExportBody(READER_BODY);
  return null;
}

```

    and `          {sheets}` becomes `          {sheets}` followed by a new line `          <ReaderShown />`.
- [ ] **Step 5: The screen's holders.** In `DocsScreen.tsx`:
  - After `import { createFetchQueue } from '../docs/fetchQueue';` add `import { createExportAssets } from '../docs/export/exportAssets';` and `import { ExportBodyContext, type ExportBody } from '../docs/exportBody';`. `import { HighlighterContext } from '../lib/highlighterContext';` becomes `import { HighlighterContext, type HighlighterContextValue } from '../lib/highlighterContext';`, followed by a new line `import type { HighlightStore } from '../lib/highlightStore';`.
  - After `  const [queue] = useState(createFetchQueue);` add `  const [exportAssets] = useState(createExportAssets);`. `  const assets = useMemo<DocsAssetContextValue>(() => ({ loaders, queue, onDraftAsset }), [loaders, queue, onDraftAsset]);` becomes `  const assets = useMemo<DocsAssetContextValue>(() => ({ loaders, queue, onDraftAsset, exportAssets }), [loaders, queue, onDraftAsset, exportAssets]);`.
  - After `  const [leafImage, setLeafImage] = useState<DocPin | null>(null);` add:

```tsx
  // Export (spec 4.17): what the leaf's body shows (`docs/exportBody.ts`), the page's or text leaf's highlight store (W5h-a's
  // `publish` slot, held here: D-7755), and the page URL the reader was turned off at so Export can save the plain view
  // (refinement (a)). The image registry is `exportAssets`, above, in the images' context.
  const [exportBody, setExportBody] = useState<ExportBody | null>(null);
  const [pageStore, setPageStore] = useState<HighlightStore | null>(null);
  const [plainAt, setPlainAt] = useState<string | null>(null);
  // Leaving the page brings the reader back, on a later return too (refinement (a)); `setTrail`'s effect has this form.
  useEffect(() => { setPlainAt((at) => (at === null || at === here ? at : null)); }, [here]);
```

  - After `  const highlighters = useContext(HighlighterContext);` add:

```tsx
  // The page's store reaches Export through the context's `publish` slot (refinement (i)). Memoised on the outer value, so
  // `useDocsHighlightStore`'s memo is stable and no render makes a second store.
  const withPublish = useMemo<HighlighterContextValue>(() => ({ ...highlighters, publish: setPageStore }), [highlighters]);
```

  - `        ? <DocsLeaf visit={visit} tree={t} page={page} parser={parser} reader={reader} onLeafImage={setLeafImage} />` becomes `        ? <DocsLeaf visit={visit} tree={t} page={page} parser={parser} reader={plainAt === here ? null : reader} onLeafImage={setLeafImage} />`.
  - `        {page !== null && <DocsHead page={page} visit={visit} tree={tree} leafImage={leafImage} />}` becomes:

```tsx
        {page !== null && (
          <DocsHead
            page={page} visit={visit} tree={tree} leafImage={leafImage} exportBody={exportBody} pageStore={pageStore}
            exportAssets={exportAssets} plainView={plainAt === here} onPlainView={() => setPlainAt(here)}
          />
        )}
```

  - `        {body}` becomes:

```tsx
        <ExportBodyContext value={setExportBody}>
          <HighlighterContext value={withPublish}>{body}</HighlighterContext>
        </ExportBodyContext>
```

  In `DocsHead.tsx`, after `import { ShareSheet } from './ShareSheet';` add `import type { ExportBody } from './exportBody';`, `import type { ExportAssets } from './export/exportAssets';` and `import type { HighlightStore } from '../lib/highlightStore';`, and after `  readonly leafImage?: DocPin | null;` (inside `DocsHead`'s props) add:

```tsx
  /** What the leaf's body shows, published for Export (`docs/exportBody.ts`); absent or `null`: nothing yet. */
  readonly exportBody?: ExportBody | null;
  /** The page's or text leaf's highlight store (W5h-a's `publish` slot); absent or `null`: none published. */
  readonly pageStore?: HighlightStore | null;
  /** The visit's image registry (refinement (g)); absent or `null`: none. */
  readonly exportAssets?: ExportAssets | null;
  /** The reader is off on this page, so Export can save the plain view (refinement (a)). */
  readonly plainView?: boolean;
  /** Turns the reader off on this page (refinement (a)); absent or `null`: the screen offers no plain view. */
  readonly onPlainView?: (() => void) | null;
```

- [ ] **Step 6: Run to verify they pass**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-body.test.tsx )` — `Tests  7 passed (7)`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-markdown.test.tsx test/highlight-wiring.test.tsx test/reader-frame.test.tsx test/docs-screen.test.tsx test/docs-truth.test.tsx test/docs-visit.test.tsx test/app-docs-boundary.test.tsx )` — Step 0's counts (`highlight-wiring`'s "no publish slot" case reads `HIGHLIGHTER_DEFAULT`, which is unchanged); `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` green.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/exportBody.ts pwa/src/docs/DocMarkdown.tsx pwa/src/docs/DocsLeaf.tsx pwa/src/docs/ReaderFrame.tsx pwa/src/screens/DocsScreen.tsx pwa/src/docs/DocsHead.tsx pwa/test/docs-export-body.test.tsx` (expect 7), message `docs: what the leaf's body shows, published, and the screen's holders for Export (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T6-M1 | M4.EX15 | pwa | `src/docs/exportBody.ts` | `    return () => publish(null);` → `    return undefined;` | `test/docs-export-body.test.tsx` | 3 failed — `'a Markdown page publishes nothing while it formats, …, and withdraws them when it goes'`; `"while the reader frame shows the leaf it publishes that; …"`; `'a re-parse withdraws the old tree before the new one lands, …'` |
| W5X-T6-M2 | M4.EX15 | pwa | `src/docs/DocMarkdown.tsx` | `() => ({ kind: 'tree', text: p.text, tree: detached.tree, urls: detached.urls, link: p.link }), [p.text, detached, p.link]));` → `() => ({ kind: 'tree', text: p.text, tree: detached.tree, urls: detached.urls, link: p.link }), [p.text, detached, p.link]) && null);` | `test/docs-export-body.test.tsx` | 3 failed — the Markdown page case; the reader case; the re-parse case |
| W5X-T6-M3 | M4.EX15 | pwa | `src/docs/DocMarkdown.tsx` | `  usePublishExportBody(useMemo<ExportBody>(() => ({ kind: 'plain', text: p.text, note: p.note }), [p.text, p.note]));` → removed | `test/docs-export-body.test.tsx` | 2 failed — `'a body Docs did not format publishes its text plain, with the note it shows'`; `'the render gate publishes the gate; Show as text then publishes the text plain'` |
| W5X-T6-M4 | M4.EX15 | pwa | `src/docs/DocsLeaf.tsx` | `lang: text === null ? null : ext` → `lang: ext` | `test/docs-export-body.test.tsx` | 1 failed — `'a text leaf (a.txt) publishes its text and the grammar it matched (null)'` |
| W5X-T6-M5 | M4.EX15 | pwa | `src/docs/ReaderFrame.tsx` | `          <ReaderShown />\n` → removed | `test/docs-export-body.test.tsx` | 1 failed — `"while the reader frame shows the leaf it publishes that; …"` |
| W5X-T6-M6 | M4.EX15 | pwa | `src/docs/DocMarkdown.tsx` | `  usePublishExportBody(choice === 'ask' ? GATE_BODY : null);` → `  usePublishExportBody(null);` | `test/docs-export-body.test.tsx` | 1 failed — `'the render gate publishes the gate; …'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-body.test.tsx )` — 7 passed; the guards unchanged; `TSC-OK`; `pwa-rings` green.

### Task 7: The export sheet: build on open, then a synchronous Save (M4.EX13, §4.17's failures; refinements (e), (l), (u))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the Save handler (nothing before `downloadExport`) and in the two failure arms.

**Spec rows:** §4.17 ("Save", "Failures and limits", "Loading"), decision 7 (two phases), M4.EX13; the sheet half of M4.EX3 ("<k> images not loaded; tap Load image first"); refinements (e) (the palette read), (l) (the title), (u).

**Files:**
- Create: `pwa/src/docs/export/exportInput.ts`, `pwa/src/docs/ExportSheet.tsx`, `pwa/test/docs-export-sheet.test.tsx`.
- Guards (not edited): `pwa/test/markup-census.test.ts`, `pwa/test/control-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/focus-ring.test.ts`, `pwa/test/docs-scans.test.ts`, `server/test/rings/pwa-rings.test.ts`.

**Interfaces:**
- Consumes: `exportProvenance` (Task 3), `exportFilename` (Task 1), `ExportBody` (Task 6), `ExportAssets` (Task 4), `ExportInput`/`ExportResult` (Task 5, types), `downloadExport` (Task 4), `leafName` (`docsTree.ts`), `mib` (`DocMarkdown.tsx`), `kib`, `pluralS`, `fillSentence`, `EXPORT_TEXT` (`docsText.ts`), `Sheet`, `Button`, `QC_ACTIONS` (`@ccrc/ui`).
- Produces: in `exportInput.ts`: `ExportSource`, `ExportRequest`, `firstHeading(tree)`, `exportInputOf(request, { exportedAt, theme })`; in `ExportSheet.tsx`: `ExportBuilder`, `ExportSheet(p: { request; onClose; load? })`.

**Decisions:** (1) The sheet builds once per open and per Retry, in an effect, from the request the header captured at the tap; the time and the exporter's palette (`document.documentElement`'s `data-theme`, refinement (e)) are read then. (2) The builder's chunk is the one dynamic `import('./export/buildExport')` in `pwa/src`; a test injects `load`. A rejected import is "Export could not start ({name})" with Retry; a builder that throws is "Export failed ({name})" with no Retry; `too-large` is "Too large to export; use Download." (3) Save is `@ccrc/ui`'s `Button` whose handler's only statement is `downloadExport(result)` (M4.EX13); the sheet never reads the result's bytes and never renders the file (M4.EX16). (4) The sheet previews the provenance facts and every note before Save, because they leave with the file (§4.17 "Provenance"). (5) The View fact goes on every export of a `markdown`-class leaf, whatever its body: `exportInputOf` reads the leaf's class, not the body's kind (refinement (a)). (None departs beyond (e).)

- [ ] **Step 0:** `test -f pwa/src/docs/export/buildExport.tsx && test -f pwa/src/docs/exportBody.ts && ! test -e pwa/src/docs/ExportSheet.tsx && git grep -qF "export function mib(bytes: number): string {" HEAD -- pwa/src/docs/DocMarkdown.tsx && echo T7-BASE-OK`. No shared file is edited. Record the guard suites' counts.
- [ ] **Step 1: Write `pwa/test/docs-export-sheet.test.tsx`:**

```tsx
// Docs W5 Export, Task 7: the export sheet (spec 2026-10-01 4.17 "Save", "Failures and limits"; decision 7; M4.EX13;
// refinements (e), (l), (u)). The sheet builds as soon as it opens, through an injected builder (or, in one case, the real
// chunk), and its Save calls `downloadExport` inside the click. `setup.ts` stubs `URL.createObjectURL`; the anchor's
// `click` is spied so jsdom never navigates. Task 9 appends the Export chrome's colour guard. Placeholders only:
// project `demo`, `specs/...`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DocPin, DocsPageLocation } from '../../shared/docs';
import { ExportSheet, type ExportBuilder } from '../src/docs/ExportSheet';
import { EXPORT_FACT, EXPORT_TEXT, fillSentence } from '../src/docs/docsText';
import type { ExportInput, ExportResult } from '../src/docs/export/buildExport';
import { exportInputOf, firstHeading, type ExportRequest } from '../src/docs/export/exportInput';
import { detachUrls } from '../src/docs/docsLinks';
import { parseMarkdown } from '../src/lib/markdownParse';
import { COMMIT_A, SERVED, fileResponse, pageAt, treeOk } from './docsFixtures';
import { syncTestStore } from './highlightTestStore';

type Leaf = DocsPageLocation & { kind: 'path' };
const PAGE = pageAt('/docs/demo/specs/a.md') as Leaf;
const PIN: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' };
const NAME = `demo_specs_a.md_${COMMIT_A.slice(0, 8)}.html`;
const REQUEST: ExportRequest = {
  page: PAGE, tree: treeOk(), assets: null, readAt: 0,
  source: { kind: 'plain', pin: PIN, show: fileResponse('# A').show, body: { kind: 'plain', text: '# A', note: 'a note' } },
};

/** A builder that records each input and answers `answer` (by default a one-byte file). */
function builder(answer?: (input: ExportInput) => ExportResult | Promise<ExportResult>): ExportBuilder & { inputs: ExportInput[] } {
  const inputs: ExportInput[] = [];
  return {
    inputs,
    buildExport: async (input) => {
      inputs.push(input);
      return answer === undefined
        ? { ok: true, name: input.name, bytes: new TextEncoder().encode('x'), size: 2048, notes: ['a note', 'one more'], deferred: 0 }
        : answer(input);
    },
  };
}

function sheet(load: () => Promise<ExportBuilder>, request: ExportRequest = REQUEST): void {
  render(<ExportSheet request={request} onClose={() => {}} load={load} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('the export sheet: build on open, then Save (spec 4.17; M4.EX13)', () => {
  it('says Building…, then the provenance, the notes and Save <name> (<size>)', async () => {
    const b = builder();
    sheet(async () => b);
    expect(screen.getByText(EXPORT_TEXT.building)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` })).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('one more')).toBeInTheDocument();
    expect(b.inputs).toHaveLength(1);
  });

  it('Save clicks the download anchor inside the click itself, before any microtask runs (M4.EX13)', async () => {
    const clicks: boolean[] = [];
    let microtaskRan = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { clicks.push(microtaskRan); });
    sheet(async () => builder());
    const save = await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` });
    queueMicrotask(() => { microtaskRan = true; });
    fireEvent.click(save);
    expect(clicks).toEqual([false]);
  });

  it('a chunk that does not load says so with Retry, and Retry loads again', async () => {
    let tries = 0;
    sheet(async () => {
      tries += 1;
      if (tries === 1) throw new TypeError('failed to fetch a module');
      return builder();
    });
    expect(await screen.findByText(fillSentence(EXPORT_TEXT.couldNotStart, { error: 'TypeError' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EXPORT_TEXT.retry }));
    expect(await screen.findByRole('button', { name: `Save ${NAME} (2 KiB)` })).toBeInTheDocument();
  });

  it('a build that throws says Export failed with its name, and offers neither Save nor Retry', async () => {
    sheet(async () => builder(() => { throw new RangeError('too deep'); }));
    expect(await screen.findByText(fillSentence(EXPORT_TEXT.failed, { error: 'RangeError' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
    expect(screen.queryByRole('button', { name: EXPORT_TEXT.retry })).toBeNull();
  });

  it('a body too large says to use Download, and offers no Save', async () => {
    sheet(async () => builder(() => ({ ok: false, why: 'too-large' })));
    expect(await screen.findByText(EXPORT_TEXT.tooLarge)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull();
  });

  it("images waiting for Load image are named in the sheet", async () => {
    sheet(async () => builder((input) => ({ ok: true, name: input.name, bytes: new Uint8Array(1), size: 1, notes: [], deferred: 2 })));
    expect(await screen.findByText('2 images not loaded; tap Load image first.')).toBeInTheDocument();
  });

  it("builds with the exporter's palette, read from the document (refinement (e))", async () => {
    document.documentElement.setAttribute('data-theme', 'nord');
    const b = builder();
    sheet(async () => b);
    await screen.findByRole('button', { name: /^Save / });
    expect(b.inputs[0]?.theme).toBe('nord');
  });

  it('loads the real builder chunk and saves what it built', async () => {
    render(<ExportSheet request={REQUEST} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: new RegExp(`^Save ${NAME.replace(/\./g, '\\.')} \\(\\d+ KiB\\)$`) })).toBeInTheDocument();
  });
});

describe('exportInputOf (spec 4.17; refinement (l))', () => {
  it("titles a Markdown export by its first h1, else the file name, and names the file by the opened pin", () => {
    const outcome = parseMarkdown('Intro\n\n# The title\n\n# Later\n', 'docs');
    if (outcome.kind !== 'tree') throw new Error('fixture');
    const d = detachUrls(outcome.tree);
    expect(firstHeading(d.tree)).toBe('The title');
    const link = { project: 'demo', pageRef: null, view: 'effective' as const, section: 'specs' as const, path: 'a.md', tree: treeOk(), pageSource: 'committed' as const, onFragment: () => {} };
    const input = exportInputOf({
      ...REQUEST, source: { kind: 'tree', pin: PIN, show: fileResponse('x').show, body: { kind: 'tree', text: 'x', tree: d.tree, urls: d.urls, link }, store: syncTestStore('docs') },
    }, { exportedAt: 0, theme: null });
    expect(input.title).toBe('The title');
    expect(input.name).toBe(NAME);
    expect(input.commit).toBe(COMMIT_A);
    expect(exportInputOf(REQUEST, { exportedAt: 0, theme: null }).title).toBe('a.md');
  });

  it("every Markdown export says it is Docs' plain view, a tree or a plain body alike; a text leaf's does not (refinement (a))", () => {
    const view = (r: ExportRequest): string | undefined =>
      exportInputOf(r, { exportedAt: 0, theme: null }).provenance.facts.find((f) => f.label === EXPORT_FACT.view)?.value;
    expect(REQUEST.source.kind).toBe('plain');
    expect(view(REQUEST)).toBe(EXPORT_TEXT.plainView);
    const text: ExportRequest = {
      ...REQUEST, page: pageAt('/docs/demo/specs/a.txt') as Leaf,
      source: { kind: 'text', pin: { ...PIN, path: 'a.txt' }, show: fileResponse('a').show, body: { kind: 'text', text: 'a', lang: null }, store: null },
    };
    expect(view(text)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-sheet.test.tsx )` — Expected: the file fails to load (`ExportSheet.tsx` and `exportInput.ts` do not exist).
- [ ] **Step 3: Write `pwa/src/docs/export/exportInput.ts`:**

```ts
// Export's input, assembled (spec 2026-10-01 4.17; native Docs reader W5, Export; refinements (l), (s)). From what the
// header found ready to export (`ExportSource`: a parsed tree with the page's store, a plain body, a text leaf with its
// one-block store, an SVG's bytes, or a raster's image, each with the pin it shows), `exportInputOf` builds what
// `buildExport` takes: the title (a Markdown export's first `h1`, else the file name), the file name, the provenance and
// the body. The sheet adds the export time and the exporter's palette.
//
// Ring L1: pure; it loads no `.tsx` at run time (the builder's, the body's and the registry's types are type-only).
import type { Element as HastElement, Root as HastRoot, RootContent } from 'hast';
import { contentClass, type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk } from '../../../../shared/docs';
import type { HighlightStore } from '../../lib/highlightStore';
import { leafName } from '../docsTree';
import type { ExportBody } from '../exportBody';
import type { ExportBodyInput, ExportInput } from './buildExport';
import type { ExportAsset, ExportAssets } from './exportAssets';
import { exportFilename } from './filename';
import { exportProvenance } from './provenance';

type Leaf = DocsPageLocation & { kind: 'path' };

/** What a leaf that is ready to export holds (`DocsHead.tsx#exportStateFor`'s answer). */
export type ExportSource =
  | {
    readonly kind: 'tree'; readonly pin: DocPin; readonly show: DocsShowOk;
    readonly body: Extract<ExportBody, { kind: 'tree' }>; readonly store: HighlightStore;
  }
  | { readonly kind: 'plain'; readonly pin: DocPin; readonly show: DocsShowOk; readonly body: Extract<ExportBody, { kind: 'plain' }> }
  | {
    readonly kind: 'text'; readonly pin: DocPin; readonly show: DocsShowOk;
    readonly body: Extract<ExportBody, { kind: 'text' }>; readonly store: HighlightStore | null;
  }
  | { readonly kind: 'svg'; readonly pin: DocPin; readonly show: DocsShowOk; readonly bytes: Uint8Array }
  | { readonly kind: 'raster'; readonly pin: DocPin; readonly asset: Extract<ExportAsset, { kind: 'raster' }> };

/** What the header hands the sheet at the tap. */
export interface ExportRequest {
  readonly page: Leaf;
  readonly tree: DocsTreeOk;
  readonly source: ExportSource;
  readonly assets: ExportAssets | null;
  /** When the leaf's bytes were read (its file slot's `receivedAt`); `null`: a raster leaf, which has no file slot. */
  readonly readAt: number | null;
}

function textOf(el: HastElement): string {
  let out = '';
  const stack: RootContent[] = [...el.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'text') out += n.value;
    else if (n.type === 'element') for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return out;
}

/** The text of `tree`'s first `h1`; `null`: it has none, or it is empty. Iterative. */
export function firstHeading(tree: HastRoot): string | null {
  const stack: RootContent[] = [...tree.children].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'h1') {
      const text = textOf(n);
      return text === '' ? null : text;
    }
    for (let k = n.children.length - 1; k >= 0; k -= 1) stack.push(n.children[k]!);
  }
  return null;
}

function bodyOf(source: ExportSource, alt: string): ExportBodyInput {
  switch (source.kind) {
    case 'tree':
      return { kind: 'tree', tree: source.body.tree, urls: source.body.urls, link: source.body.link, store: source.store };
    case 'plain':
      return { kind: 'plain', text: source.body.text, note: source.body.note };
    case 'text':
      return { kind: 'text', text: source.body.text, lang: source.body.lang, store: source.store };
    case 'svg':
      return { kind: 'image', alt, draft: source.pin.kind === 'draft', image: { kind: 'svg', bytes: source.bytes } };
    case 'raster':
      return {
        kind: 'image', alt, draft: source.pin.kind === 'draft',
        image: { kind: 'raster', bytes: source.asset.bytes, mime: source.asset.mime },
      };
  }
}

export function exportInputOf(r: ExportRequest, o: { readonly exportedAt: number; readonly theme: string | null }): ExportInput {
  const { page, tree, source } = r;
  const provenance = exportProvenance({
    tree, page, pin: source.pin, show: source.kind === 'raster' ? null : source.show, exportedAt: o.exportedAt,
    readAt: r.readAt ?? o.exportedAt, plainView: contentClass(page.path) === 'markdown',
  });
  const name = leafName(page.path);
  return {
    title: source.kind === 'tree' ? firstHeading(source.body.tree) ?? name : name,
    name: exportFilename(page.project, source.pin, provenance.commit),
    theme: o.theme,
    commit: provenance.commit,
    provenance,
    body: bodyOf(source, name),
    assets: source.kind === 'tree' ? r.assets : null,
  };
}
```

- [ ] **Step 4: Write `pwa/src/docs/ExportSheet.tsx`:**

```tsx
// The export sheet (spec 2026-10-01 4.17 "Save", "Failures and limits", "Loading"; decision 7; native Docs reader W5,
// Export; refinement (u)). Ring L4 delivery over @ccrc/ui's `Sheet`. Two phases. The sheet builds as soon as it opens
// ("Building…"), from the request the header captured at the tap, the time, and the exporter's palette, through the
// builder's chunk, which the one dynamic `import()` of `./export/buildExport` in `pwa/src` loads (M4.EX16): so
// `react-dom/server` stays out of the main chunk. Then it shows the provenance and every note, which leave with the
// file, and its one Save button calls `downloadExport` synchronously in the click, with nothing before it that spends a
// microtask, so an installed app keeps the click's user activation (M4.EX13). It never renders the file, never reads its
// bytes, and holds no sink. A chunk that does not load is "Export could not start" with Retry; a build that throws is
// "Export failed"; a body alone over the limit is "use Download". Every word is docsText.ts's.
import { useEffect, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { mib } from './DocMarkdown';
import { EXPORT_TEXT, fillSentence, kib, pluralS } from './docsText';
import type { ExportInput, ExportResult } from './export/buildExport';
import { exportInputOf, type ExportRequest } from './export/exportInput';
import type { ExportFact } from './export/provenance';
import { downloadExport } from './objectUrls';

/** The builder's chunk, as the sheet calls it. A test injects one. */
export interface ExportBuilder { readonly buildExport: (input: ExportInput) => Promise<ExportResult> }

const loadBuilder = (): Promise<ExportBuilder> => import('./export/buildExport');

type SheetState =
  | { readonly s: 'building' }
  | { readonly s: 'no-start'; readonly error: string }
  | { readonly s: 'failed'; readonly error: string }
  | { readonly s: 'too-large' }
  | { readonly s: 'ready'; readonly result: Extract<ExportResult, { ok: true }>; readonly facts: readonly ExportFact[] };

/** An error's `name`, read without assuming its realm; `Error` when it has none. */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return 'Error';
  const name: unknown = (e as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' ? name : 'Error';
}

/** A file's size as Save says it: KiB under 1 MiB, else MiB. */
const sizeOf = (bytes: number): string => (bytes < 1048576 ? kib(bytes) : mib(bytes));

export function ExportSheet(p: {
  readonly request: ExportRequest; readonly onClose: () => void; readonly load?: () => Promise<ExportBuilder>;
}): ReactNode {
  const { request } = p;
  const load = p.load ?? loadBuilder;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SheetState>({ s: 'building' });
  useEffect(() => {
    let live = true;
    setState({ s: 'building' });
    void (async () => {
      let builder: ExportBuilder;
      try {
        builder = await load();
      } catch (e) {
        if (live) setState({ s: 'no-start', error: errorName(e) });
        return;
      }
      try {
        const input = exportInputOf(request, { exportedAt: Date.now(), theme: document.documentElement.getAttribute('data-theme') });
        const result = await builder.buildExport(input);
        if (live) setState(result.ok ? { s: 'ready', result, facts: input.provenance.facts } : { s: 'too-large' });
      } catch (e) {
        if (live) setState({ s: 'failed', error: errorName(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [request, load, attempt]);
  const ready = state.s === 'ready' ? state : null;
  const footer = ready !== null || state.s === 'no-start'
    ? (
      <div className={QC_ACTIONS}>
        {ready !== null && (
          // Nothing before `downloadExport` in this handler: the click's activation must still be live (M4.EX13).
          <Button variant="primary" onClick={() => downloadExport(ready.result)}>
            {fillSentence(EXPORT_TEXT.save, { name: ready.result.name, size: sizeOf(ready.result.size) })}
          </Button>
        )}
        {state.s === 'no-start' && <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>{EXPORT_TEXT.retry}</Button>}
      </div>
    )
    : undefined;
  return (
    <Sheet open onClose={p.onClose} title={EXPORT_TEXT.title} footer={footer}>
      <div className="docs-export-sheet">
        {state.s === 'building' && <p className="docs-export-note" role="status">{EXPORT_TEXT.building}</p>}
        {state.s === 'no-start' && <p className="docs-export-note" role="alert">{fillSentence(EXPORT_TEXT.couldNotStart, { error: state.error })}</p>}
        {state.s === 'failed' && <p className="docs-export-note" role="alert">{fillSentence(EXPORT_TEXT.failed, { error: state.error })}</p>}
        {state.s === 'too-large' && <p className="docs-export-note" role="alert">{EXPORT_TEXT.tooLarge}</p>}
        {ready !== null && (
          <>
            <dl className="docs-export-facts">
              {ready.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
            </dl>
            {ready.result.notes.map((n, i) => <p key={i} className="docs-export-note">{n}</p>)}
            {ready.result.deferred > 0 && (
              <p className="docs-export-note" role="status">
                {fillSentence(EXPORT_TEXT.deferred, { k: ready.result.deferred, s: pluralS(ready.result.deferred) })}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
```

  (Check at this step that `@ccrc/ui`'s `Sheet` takes `footer` as a `ReactNode | undefined`, as `ShareSheet.tsx` passes it; if `footer={undefined}` is refused by its type, pass `{...(footer === undefined ? {} : { footer })}` instead.)
- [ ] **Step 5: Run to verify it passes**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-sheet.test.tsx )` — `Tests  10 passed (10)`. `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/control-census.test.ts test/literal-census.test.ts test/focus-ring.test.ts test/docs-scans.test.ts )` through `ccrc test` — Step 0's counts (the footer's `div.{QC_ACTIONS}(Button…)` block is registered at BASE; register a new `markup-census` cluster only if it reports one, with its reason, and stop and ask if it reports more than one); `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` green (`exportInput.ts` is L1).
- [ ] **Step 6: Commit.** `git add pwa/src/docs/export/exportInput.ts pwa/src/docs/ExportSheet.tsx pwa/test/docs-export-sheet.test.tsx` (expect 3), message `docs: the export sheet, build on open then a synchronous Save (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T7-M1 | M4.EX13 | pwa | `src/docs/ExportSheet.tsx` | `<Button variant="primary" onClick={() => downloadExport(ready.result)}>` → `<Button variant="primary" onClick={() => { void Promise.resolve().then(() => downloadExport(ready.result)); }}>` | `test/docs-export-sheet.test.tsx` | 1 failed — `'Save clicks the download anchor inside the click itself, before any microtask runs (M4.EX13)'` |
| W5X-T7-M2 | — | pwa | `src/docs/ExportSheet.tsx` | `onClick={() => setAttempt((n) => n + 1)}` → `onClick={() => {}}` | `test/docs-export-sheet.test.tsx` | 1 failed — `'a chunk that does not load says so with Retry, and Retry loads again'` |
| W5X-T7-M3 | M4.EX10 | pwa | `src/docs/ExportSheet.tsx` | `theme: document.documentElement.getAttribute('data-theme')` → `theme: null` | `test/docs-export-sheet.test.tsx` | 1 failed — `"builds with the exporter's palette, read from the document (refinement (e))"` |
| W5X-T7-M4 | — | pwa | `src/docs/ExportSheet.tsx` | `        if (live) setState({ s: 'no-start', error: errorName(e) });` → `        if (live) setState({ s: 'failed', error: errorName(e) });` | `test/docs-export-sheet.test.tsx` | 1 failed — `'a chunk that does not load says so with Retry, and Retry loads again'` |
| W5X-T7-M5 | M4.EX3 | pwa | `src/docs/ExportSheet.tsx` | `{ready.result.deferred > 0 && (` → `{false && (` | `test/docs-export-sheet.test.tsx` | 1 failed — `'images waiting for Load image are named in the sheet'` |
| W5X-T7-M6 | — | pwa | `src/docs/export/exportInput.ts` | `title: source.kind === 'tree' ? firstHeading(source.body.tree) ?? name : name,` → `title: name,` | `test/docs-export-sheet.test.tsx` | 1 failed — `'titles a Markdown export by its first h1, else the file name, and names the file by the opened pin'` |
| W5X-T7-M7 | — | pwa | `src/docs/export/exportInput.ts` | `plainView: contentClass(page.path) === 'markdown',` → `plainView: source.kind === 'tree',` | `test/docs-export-sheet.test.tsx` | 1 failed — `"every Markdown export says it is Docs' plain view, a tree or a plain body alike; a text leaf's does not (refinement (a))"` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-sheet.test.tsx )` — 10 passed; the guards unchanged; `TSC-OK`; `pwa-rings` green.

### Task 8: Export in the Docs header, after Share (M4.SH3 and M4.SH8 Export halves, M4.EX12 Export half, M4.EX15 on the screen, Share's seam; refinements (a), (j), (k), (u))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in `exportStateFor`: Export is offered only on what the screen shows, at the pin it shows.

**Spec rows:** §4.5 "Share and Export", §4.17 "When it is offered" (its case table), §4.16 (the Export clause on Share's refusals), M4.SH3 ("Export enabled", "Export absent"), M4.SH8 (Export's place, hidden while the tree loads, not for `other` nor `html`), M4.EX12 (Export disabled while the pin differs; the raster clause), M4.EX15 (on the screen: Formatting…, Highlighting…, the page ceilings bound the wait (the timeouts ceiling, and on a fake clock the worker-time ceiling), the exported blocks are the page's); refinements (a), (j), (k), (u).

**Files:**
- Modify: `pwa/src/docs/export/policy.ts` (one appended type), `pwa/src/docs/docsText.ts` (its policy import; four `DOCS_HEAD_TEXT` keys; one appended map), `pwa/src/docs/DocsHead.tsx` (header comment; imports; `exportStateFor` after `shareStateFor`; `exportKeyOf`, `ExportAction` and two hooks before `Actions`; `ShareAction`'s `exportOffered`; `Actions`; the `DocsHead` body), `pwa/test/control-census.test.ts` (one entry), `pwa/test/docs-screen.test.tsx` (import lines; Share's order case's selector; one appended describe).
- Guards (not edited): `pwa/test/docs-share.test.ts`, `pwa/test/docs-share-sheet.test.tsx`, `pwa/test/docs-truth.test.tsx`, `pwa/test/docs-refresh.test.tsx`, `pwa/test/docs-banners.test.tsx`, `pwa/test/docs-visit.test.tsx`, `pwa/test/reader-frame.test.tsx`, `pwa/test/app-docs-boundary.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`.

**Interfaces:** Consumes Tasks 4-7 and Share's `ShareAction`. Produces `type ExportWait` (`policy.ts`), `EXPORT_WAIT_TEXT` and `DOCS_HEAD_TEXT.export`, `.exportPlainView`, `.exportBusy`, `.exportPlainShown` (`docsText.ts`), and, in `DocsHead.tsx`, `export type ExportState`, `export interface ExportInputs`, `export function exportStateFor(page, tree, file, inputs): ExportState`.

**Decisions:** (1) `exportStateFor` (pure, beside `shareStateFor`, for refinement (o) of Share's plan: nothing of `share.ts` but `copyText` is read while no sheet is open) answers, in order: absent (not a leaf, `frame=full`, a leaf that opens nothing, class `other` or `html`, an over-cap raster, a file slot settled with no bytes: refinement (k)); a raster leaf from the registry at `pinFor`'s key (refinement (j)); updating while the file slot is not `ok` at `pinFor`'s pin; an SVG ready from its answer's bytes; then the body: none published is `formatting`, the reader is `plain-view`, the gate is `gate`, a plain body of the shown text is ready, a tree or a text of the shown text waits for its store to be published and settled, and anything else (a body that answers another text) is `formatting`. (2) The button's text is the state's words; while it waits its accessible name is "Export: <words>", so two disabled actions never share a name and a reader hears which waits. (3) `ExportAction` is keyed by the page, the tree's commit and the pin it would export (refinement (u)); it captures the request at the tap. (4) `ShareAction` passes `exportOffered = exportState.s !== 'absent'` to its sheet: Share's seam (Share's refinement (c)). (5) `Actions` reads the store's settledness and the registry's version through `useSyncExternalStore`, so a block's colours or an image's arrival re-renders the header. (Departures: (a), (h).)

- [ ] **Step 0:** `test -f pwa/src/docs/ExportSheet.tsx && git grep -qF "exportOffered={false}" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "readonly exportBody?: ExportBody | null;" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "  it(\"a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)\", async () => {" HEAD -- pwa/test/docs-screen.test.tsx && echo T8-BASE-OK`. Claim `docsText.ts`, `DocsHead.tsx`, `control-census.test.ts`, `docs-screen.test.tsx`. Record the guard suites' counts.
- [ ] **Step 1: The words.** In `policy.ts`, append:

```ts

/** Why Export is shown but disabled (spec 4.17's "When it is offered"; refinement (j)): the parse has not settled or
 *  answers another text, the page's highlight store has not settled, the render gate waits, or a raster leaf's own image
 *  did not load. */
export type ExportWait = 'formatting' | 'highlighting' | 'gate' | 'image-failed';
```

  In `docsText.ts`, `import type { ExportMissing, ExportPlain } from './export/policy';` becomes `import type { ExportMissing, ExportPlain, ExportWait } from './export/policy';`; after `  shareUpdating: 'Updating to {short}…',` add:

```ts
  export: 'Export',
  exportPlainView: 'Export (plain view)',
  exportBusy: 'Export: {state}',
  exportPlainShown: 'Showing the plain view, which Export saves.',
```

  and append at the end of the file:

```ts

/** What a disabled Export reads, by why it waits (spec 4.17's "When it is offered"; refinement (j)). */
export const EXPORT_WAIT_TEXT: Record<ExportWait, string> = {
  'formatting': 'Formatting…',
  'highlighting': 'Highlighting…',
  'gate': 'Choose Format or Show as text first',
  'image-failed': 'Image not loaded',
};
```

- [ ] **Step 2: Write the failing cases.** In `docs-screen.test.tsx`: `import { DOCS_FAILURE_SENTENCE, DOCS_HEAD_TEXT, DOCS_PAGE_INVALID_SENTENCE, fillSentence, shortCommit } from '../src/docs/docsText';` becomes `import { DOCS_FAILURE_SENTENCE, DOCS_HEAD_TEXT, DOCS_PAGE_INVALID_SENTENCE, EXPORT_WAIT_TEXT, SHARE_EXPORT_CLAUSE, fillSentence, shortCommit } from '../src/docs/docsText';`; `import { pinFor, type DocsVisit } from '../src/docs/useDocsVisit';` becomes `import { pinFor, type DocsVisit, type FileSlot } from '../src/docs/useDocsVisit';` followed by a new line `import { exportStateFor } from '../src/docs/DocsHead';`; `import { parseMarkdown } from '../src/lib/markdownParse';` becomes `import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';` followed by `import { HighlighterContext } from '../src/lib/highlighterContext';`, `import type { Highlighter } from '../src/lib/highlightProtocol';` and `import type { HighlightClock } from '../src/lib/highlightStore';`; `import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';` becomes `import { DOCS_RENDER_GATE_BYTES, HIGHLIGHT_PAGE_WORKER_MS } from '../src/lib/markdownLimits';`; `import { detachUrls } from '../src/docs/docsLinks';` is added after `import { createFetchQueue } from '../src/docs/fetchQueue';`; in the `./docsFixtures` import, `  okRefresh, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,` becomes `  okFile, okRefresh, okTree, pageAt, treeOk, treeResponse, type FakeLoaders,`; `import { withSyncHighlight } from './highlightTestStore';` becomes `import { inThreadContext, inThreadHighlighter, syncTestStore, withSyncHighlight } from './highlightTestStore';`. In Share's case `"a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)"`, `const actions = [...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.textContent);` becomes `const actions = [...document.querySelectorAll('.docs-actions .docs-action:not(.docs-export)')].map((e) => e.textContent);` (Share's three keep their order; Export's place is this task's case). Append at the end of the file:

```tsx

// ---- W5 Export, Task 8: Export on the Docs screen ----------------------------------------------------------------

describe('W5 Export on the Docs screen (spec 4.5, 4.17; M4.SH3, M4.SH8 Export halves, M4.EX12, M4.EX15; refinements (a), (j))', () => {
  const exportButton = (): HTMLElement | null => screen.queryByRole('button', { name: DOCS_HEAD_TEXT.export });
  const busy = (state: string): string => fillSentence(DOCS_HEAD_TEXT.exportBusy, { state });
  const updatingTo = (commit: string): string => fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(commit) });
  function deferredOf<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  function answerOf(commit: string, blob: string, heading: string): DocsFileAnswer {
    const r = fileResponse(`# ${heading}\n`);
    return { s: 'ok', value: { ...r, show: { ...r.show, commit, blob, onRef: 'contains' } } };
  }
  beforeEach(() => {
    vi.mocked(URL.createObjectURL).mockClear();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Taps Export, then Save, and answers the saved file, parsed. */
  async function exported(): Promise<Document> {
    fireEvent.click(exportButton() as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: /^Save / }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0];
    if (!(blob instanceof Blob)) throw new Error('nothing saved');
    return new DOMParser().parseFromString(new TextDecoder().decode(await blob.arrayBuffer()), 'text/html');
  }

  /** A store clock the case moves by hand (`highlight-store.test.ts#fakeClock`'s form): `advance` fires every timer due. */
  function handClock(): HighlightClock & { advance(ms: number): void } {
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

  it("a leaf's actions read View on GitHub, Share, Export, Open committed version, in that order (M4.SH8)", async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const actions = [...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.textContent);
    expect(actions).toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export, DOCS_HEAD_TEXT.openCommitted]);
  });

  it('no Export on the index, a project, section or directory page, in frame=full, or while the tree slot loads (M4.SH8)', async () => {
    openIndex();
    await waitFor(() => expect(mainRowNames().length).toBeGreaterThan(0));
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    const tree = treeOk({ entries: [entry('specs', 'd/x.md'), entry('specs', 'm.html')] });
    for (const url of ['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/']) {
      open(url, fakeLoaders({ tree: okTree(tree) }));
      await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
      expect(document.querySelector('.docs-export'), url).toBeNull();
      cleanup();
    }
    open('/docs/demo/specs/m.html?ref=main&frame=full', byPath(tree, { 'm.html': fileAs('m.html', '<p>a</p>', 'html') }));
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    const f = fakeLoaders();
    f.tree.mockImplementation(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', f);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('no Export for class other, nor for html in W5 (M4.SH8)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'o.pdf'), entry('specs', 'm.html')] });
    open('/docs/demo/specs/o.pdf', fakeLoaders({ tree: okTree(tree) }));
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled());
    expect(document.querySelector('.docs-export')).toBeNull();
    cleanup();
    open('/docs/demo/specs/m.html', byPath(tree, { 'm.html': fileAs('m.html', '<p>a</p>', 'html') }));
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled());
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it("a new draft: Export is enabled and Share's refusal carries Export's clause; a withheld new file: no Export, no clause (M4.SH3)", async () => {
    const fresh = treeOk({ entries: [entry('specs', 'n.md', { committed: null, draft: draftOf('added') })], drafts: holder() });
    open('/docs/demo/specs/n.md?ref=main', fakeLoaders({ tree: okTree(fresh) }));
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText(`Not committed yet, so GitHub has nothing to show. ${SHARE_EXPORT_CLAUSE}`)).toBeInTheDocument();
    cleanup();
    const withheld = treeOk({ entries: [entry('specs', 'w.md', { committed: null, draft: draftOf('added', { fp: null }) })], drafts: holder() });
    open('/docs/demo/specs/w.md?ref=main', fakeLoaders({ tree: okTree(withheld) }));
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText(/^Not committed yet, and Docs did not read it/)).toBeInTheDocument();
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain(SHARE_EXPORT_CLAUSE);
    expect(document.querySelector('.docs-export')).toBeNull();
  });

  it('Formatting… while the parse runs, Export once it lands, and the file holds the tree the page shows (M4.EX15)', async () => {
    const text = '# Alpha\n\nbody text\n';
    let resolve: (o: ParseOutcome) => void = () => {};
    const slow: MarkdownParser = () => new Promise<ParseOutcome>((r) => { resolve = r; });
    open('/docs/demo/specs/a.md', fakeLoaders({ file: okFile(text) }), slow);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.formatting) })).toBeDisabled();
    await act(async () => { resolve(parseMarkdown(text, 'docs')); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const page = document.querySelector('.doc-body')?.textContent;
    const doc = await exported();
    expect(doc.querySelector('title')?.textContent).toBe('Alpha');
    expect(doc.querySelector('article')?.textContent).toBe(page);
  });

  it("Highlighting… until the page's store settles; then each exported block's HTML is what the page inserted (M4.EX15)", async () => {
    const docs = inThreadHighlighter({ hold: true });
    const f = fakeLoaders({ file: okFile('```bash\necho one\n```\n\n```bash\necho two\n```\n') });
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(docs)}><Routed loaders={f.loaders} /></HighlighterContext>);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    await act(async () => { docs.release(); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const page = [...document.querySelectorAll('.doc-body pre code')].map((c) => c.innerHTML);
    expect(page).toHaveLength(2);
    expect(page.every((h) => h.includes('hljs-'))).toBe(true);
    const doc = await exported();
    expect([...doc.querySelectorAll('article pre code')].map((c) => c.innerHTML)).toEqual(page);
  });

  it('the page ceilings bound the wait: a highlighter that only times out settles the store, and Export saves those blocks plain, counted (M4.EX15)', async () => {
    const timesOut: Highlighter = {
      highlight: async (_r, o) => { o.onPosted?.(); return { kind: 'timeout', budgetMs: 750 }; },
      status: () => 'live', prewarm: () => undefined,
    };
    const text = ['one', 'two', 'three'].map((w) => `\`\`\`bash\necho ${w}\n\`\`\`\n`).join('\n');
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(timesOut)}><Routed loaders={fakeLoaders({ file: okFile(text) }).loaders} /></HighlighterContext>);
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelectorAll('article pre code span')).toHaveLength(0);
    const count = (word: string): number => Number(doc.querySelector(`meta[name="ccrc:plain-${word}"]`)?.getAttribute('content') ?? '0');
    expect(count('timeout')).toBeGreaterThan(0);
    expect(count('page-ceiling')).toBeGreaterThan(0);
    expect(count('timeout') + count('page-ceiling')).toBe(3);
  });

  it('the worker-time ceiling bounds the wait: with a highlighter that never answers, Highlighting… holds until HIGHLIGHT_PAGE_WORKER_MS passes, then Export saves the blocks plain (M4.EX15)', async () => {
    const hangs: Highlighter = {
      highlight: (_r, o) => { o.onPosted?.(); return new Promise<never>(() => {}); },
      status: () => 'live', prewarm: () => undefined,
    };
    const clock = handClock();
    const text = ['one', 'two'].map((w) => `\`\`\`bash\necho ${w}\n\`\`\`\n`).join('\n');
    navigate('/docs/demo/specs/a.md');
    render(<HighlighterContext value={inThreadContext(hangs, undefined, undefined, clock)}><Routed loaders={fakeLoaders({ file: okFile(text) }).loaders} /></HighlighterContext>);
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    act(() => { clock.advance(HIGHLIGHT_PAGE_WORKER_MS - 1); });
    expect(screen.getByRole('button', { name: busy(EXPORT_WAIT_TEXT.highlighting) })).toBeDisabled();
    act(() => { clock.advance(1); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelectorAll('article pre code span')).toHaveLength(0);
    expect(doc.querySelector('meta[name="ccrc:plain-page-ceiling"]')?.getAttribute('content')).toBe('2');
  });

  it('a body that answers another text is not exported: it reads Formatting… (M4.EX15)', () => {
    const tree = treeOk();
    const page = pageAt('/docs/demo/specs/a.md');
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture');
    const file: FileSlot = { s: 'ok', pin, answer: fileResponse('# New\n'), receivedAt: 0 };
    const old = parseMarkdown('# Old\n', 'docs');
    if (old.kind !== 'tree') throw new Error('fixture');
    const d = detachUrls(old.tree);
    const link = { project: 'demo', pageRef: null, view: 'effective' as const, section: 'specs' as const, path: 'a.md', tree, pageSource: 'committed' as const, onFragment: () => {} };
    const body = { kind: 'tree' as const, text: '# Old\n', tree: d.tree, urls: d.urls, link };
    expect(exportStateFor(page, tree, file, { body, store: syncTestStore('docs'), settled: true, assets: null }))
      .toEqual({ s: 'waiting', why: 'formatting' });
    expect(exportStateFor(page, tree, file, { body: { ...body, text: '# New\n' }, store: syncTestStore('docs'), settled: true, assets: null }).s)
      .toBe('ready');
  });

  it('a tree moved to C2 while the file is at C1: Export reads Updating to; once C2 lands it exports C2 (M4.EX12)', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    const later = deferredOf<DocsFileAnswer>();
    f.file.mockImplementation(async (_project: string, pin: DocPin) =>
      (pin.kind === 'committed' && pin.commit === COMMIT_B ? later.promise : answerOf(COMMIT_A, BLOB_1, 'A')));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({
      commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })],
    }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    expect(await screen.findByRole('button', { name: busy(updatingTo(COMMIT_B)) })).toBeDisabled();
    await act(async () => { later.resolve(answerOf(COMMIT_B, BLOB_2, 'B')); });
    await screen.findByRole('heading', { name: 'B' });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelector('meta[name="ccrc:commit"]')?.getAttribute('content')).toBe(COMMIT_B);
  });

  it('on a leaf the reader frame shows, Export (plain view) turns the reader off there, says so, then exports the plain view (refinement (a))', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    navigate('/docs/demo/specs/a.md');
    const { container } = render(<DocsScreen path={location.pathname} search={location.search} loaders={fakeLoaders().loaders} parser={parser} reader={reader} />);
    const plain = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView });
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    fireEvent.click(plain);
    expect(await screen.findByText(DOCS_HEAD_TEXT.exportPlainShown)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.doc-body')).not.toBeNull());
    expect(container.querySelector('.docs-reader')).toBeNull();
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect(doc.querySelector('meta[name="ccrc:view"]')?.getAttribute('content')).toBe('plain');
  });

  it('leaving the page brings the reader back, on a later return too (refinement (a))', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const f = fakeLoaders();
    function WithReader(): ReactNode {
      const { path, search } = useLocation();
      return <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />;
    }
    navigate('/docs/demo/specs/a.md');
    const { container } = render(<WithReader />);
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView }));
    await waitFor(() => expect(container.querySelector('.doc-body')).not.toBeNull());
    await act(async () => { navigate('/docs/demo/specs'); });
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    await act(async () => { navigate('/docs/demo/specs/a.md'); });
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView })).toBeEnabled();
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    expect(screen.queryByText(DOCS_HEAD_TEXT.exportPlainShown)).toBeNull();
  });

  it('a raster leaf: Export waits for its own image, then exports its bytes; an image that failed disables it (M4.EX12, refinement (j))', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png')] });
    const f = fakeLoaders({ tree: okTree(tree) });
    const image = deferredOf<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png', f);
    expect(await screen.findByRole('button', { name: busy(updatingTo(COMMIT_A)) })).toBeDisabled();
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    const doc = await exported();
    expect([...doc.querySelectorAll('img')].map((i) => i.getAttribute('src')?.slice(0, 22))).toEqual(['data:image/png;base64,']);
    cleanup();
    open('/docs/demo/specs/x.png', fakeLoaders({ tree: okTree(tree) }));
    expect(await screen.findByRole('button', { name: busy(EXPORT_WAIT_TEXT['image-failed']) })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx -t "W5 Export on the Docs screen" )` — Expected: every case red except the two whose expectation is an absence that holds at BASE (`'no Export on the index, …'`, `'no Export for class other, …'`); the pure case fails on the missing `exportStateFor`. Share's edited order case stays green.
- [ ] **Step 4: Implement `DocsHead.tsx`.**
  - Header comment: `// too (M4.T7). Share (spec 4.16) opens ShareSheet over shareTargetFor's answer and makes no request either; Export is` and `// its own run's.` become `// too (M4.T7). Share (spec 4.16) opens ShareSheet over shareTargetFor's answer and makes no request either; Export` and `// (spec 4.17) follows Share on a leaf: exportStateFor decides, and ExportSheet builds and saves.`
  - `import { useState, type ReactNode } from 'react';` becomes `import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';`. After `import { ShareSheet } from './ShareSheet';` add `import { docMarkdownSource } from './DocMarkdown';`, `import { ExportSheet } from './ExportSheet';`, `import type { ExportRequest, ExportSource } from './export/exportInput';`, `import type { ExportWait } from './export/policy';` and `import { showBytes } from './objectUrls';`. In the `./docsText` import add `EXPORT_WAIT_TEXT` to its value names.
  - Find ``/** The freshness chip's `data-state` (spec 4.5's table). */`` and insert before it:

```tsx
/** Whether Export is offered on `page`, and on what (spec 4.5, 4.17; M4.SH3, M4.SH8, M4.EX12, M4.EX15; refinements (a),
 *  (j), (k)). Only a leaf has Export, never in `frame=full`; the header draws no actions until the tree slot is `ok`.
 *  - `absent`: a leaf that opens nothing (a withheld new file, a symlink, a submodule); class `other` or `html` (W6); an
 *    over-cap raster; a file slot that settled with no bytes to show (refinement (k));
 *  - `updating`: the leaf does not show `pinFor`'s pin yet (its read, or its raster image, is in flight);
 *  - `waiting`: disabled, with why (`ExportWait`);
 *  - `plain-view`: the reader frame shows the leaf; a tap turns it off so Export saves the plain view (refinement (a));
 *  - `ready`: what to export.
 *  Here and not in a module the header imports from `share.ts`: Share's refinement (o). */
export type ExportState =
  | { readonly s: 'absent' }
  | { readonly s: 'updating'; readonly to: string }
  | { readonly s: 'waiting'; readonly why: ExportWait }
  | { readonly s: 'plain-view' }
  | { readonly s: 'ready'; readonly source: ExportSource };

export interface ExportInputs {
  /** What the leaf's body shows; `null`: nothing published (it is formatting, or nothing is mounted). */
  readonly body: ExportBody | null;
  /** The page's or text leaf's store; `null`: none published. */
  readonly store: HighlightStore | null;
  /** `store.settled()`, read by the caller so the header re-renders when it settles. */
  readonly settled: boolean;
  /** The visit's image registry; `null`: none, so a raster leaf never readies. */
  readonly assets: ExportAssets | null;
}

const EXPORT_ABSENT: ExportState = { s: 'absent' };
const exportWaits = (why: ExportWait): ExportState => ({ s: 'waiting', why });

export function exportStateFor(page: DocsPageLocation, tree: DocsTreeOk, file: FileSlot, x: ExportInputs): ExportState {
  if (page.kind !== 'path' || page.frame === 'full') return EXPORT_ABSENT;
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  const expected = pinFor(tree, page);
  if (k.kind !== 'leaf' || expected === null) return EXPORT_ABSENT;
  const cls = contentClass(page.path);
  if (cls === 'other' || cls === 'html') return EXPORT_ABSENT;
  const updating: ExportState = { s: 'updating', to: pinCommit(expected) };
  if (cls === 'raster') {
    const size = expected.kind === 'draft' ? k.entry.draft?.size : k.entry.committed?.size;
    if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return EXPORT_ABSENT;
    const held = x.assets?.get(docsApi.file(page.project, expected));
    if (held === undefined || held.s === 'loading') return updating;
    if (held.s === 'failed') return exportWaits('image-failed');
    return held.asset.kind === 'raster' ? { s: 'ready', source: { kind: 'raster', pin: expected, asset: held.asset } } : EXPORT_ABSENT;
  }
  if (file.s === 'none' || file.s === 'loading') return updating;
  if (file.s !== 'ok') return EXPORT_ABSENT;
  if (!samePin(file.pin, expected)) return updating;
  const pin = file.pin;
  const show = file.answer.show;
  if (cls === 'svg') {
    const bytes = file.answer.contentClass === 'svg' ? showBytes(show) : null;
    return bytes === null ? EXPORT_ABSENT : { s: 'ready', source: { kind: 'svg', pin, show, bytes } };
  }
  const src = docMarkdownSource(show);
  if (src.kind === 'no-bytes') return EXPORT_ABSENT;
  const b = x.body;
  if (b === null) return exportWaits('formatting');
  if (cls === 'markdown' && b.kind === 'reader') return { s: 'plain-view' };
  if (cls === 'markdown' && b.kind === 'gate') return exportWaits('gate');
  if (b.kind === 'plain' && b.text === src.text) return { s: 'ready', source: { kind: 'plain', pin, show, body: b } };
  if (cls === 'markdown' && b.kind === 'tree' && b.text === src.text) {
    return x.store === null || !x.settled ? exportWaits('highlighting')
      : { s: 'ready', source: { kind: 'tree', pin, show, body: b, store: x.store } };
  }
  if (cls === 'text' && b.kind === 'text' && b.text === src.text) {
    if (b.lang === null) return { s: 'ready', source: { kind: 'text', pin, show, body: b, store: null } };
    return x.store === null || !x.settled ? exportWaits('highlighting')
      : { s: 'ready', source: { kind: 'text', pin, show, body: b, store: x.store } };
  }
  return exportWaits('formatting');
}

```

  - Find ``/** What an open share sheet is about (refinement (n)): the page, the commit its tree serves, and what the leaf opened.`` and insert before it:

```tsx
const NO_SUBSCRIPTION = (_listener: () => void): (() => void) => () => undefined;

/** Whether `store` has settled, re-read whenever it changes (its store-wide `subscribe()`); no store reads settled. */
function useStoreSettled(store: HighlightStore | null): boolean {
  const subscribe = useMemo(() => (store === null ? NO_SUBSCRIPTION : store.subscribe()), [store]);
  const read = (): boolean => store === null || store.settled();
  return useSyncExternalStore(subscribe, read, read);
}

/** Re-renders the caller whenever the image registry changes. */
function useAssetsVersion(assets: ExportAssets | null): number {
  const read = (): number => (assets === null ? 0 : assets.version());
  return useSyncExternalStore(assets === null ? NO_SUBSCRIPTION : assets.subscribe, read, read);
}

/** What an open export sheet is about (refinement (u)): the page, the commit its tree serves, and the pin it exports.
 *  `ExportAction` is keyed by it, so a re-list or a back gesture closes the sheet. */
function exportKeyOf(page: Leaf, tree: DocsTreeOk, state: Exclude<ExportState, { s: 'absent' }>): string {
  const shows = state.s === 'ready' ? docsApi.file(page.project, state.source.pin) : state.s;
  return [docsPageUrl(page), tree.ref.commit, shows].join('\u0000');
}

/** Export (spec 4.17), after Share on a leaf. Ready: a tap opens the sheet over the request captured now. Plain view: a
 *  tap turns the reader off on this page (refinement (a)). Otherwise disabled, reading why; its accessible name then
 *  says it is Export's ("Export: <why>"), so it never shares a name with Share's own "Updating to <short>…". */
function ExportAction(p: {
  readonly page: Leaf; readonly tree: DocsTreeOk; readonly state: Exclude<ExportState, { s: 'absent' }>;
  readonly assets: ExportAssets | null; readonly readAt: number | null; readonly onPlainView: (() => void) | null;
}): ReactNode {
  const { page, tree, state } = p;
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const words = state.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(state.to) })
    : state.s === 'waiting' ? EXPORT_WAIT_TEXT[state.why]
      : state.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainView : DOCS_HEAD_TEXT.export;
  const busy = state.s === 'updating' || state.s === 'waiting';
  const enabled = state.s === 'ready' || (state.s === 'plain-view' && p.onPlainView !== null);
  const onClick = (): void => {
    if (state.s === 'plain-view') p.onPlainView?.();
    else if (state.s === 'ready') setRequest({ page, tree, source: state.source, assets: p.assets, readAt: p.readAt });
  };
  return (
    <>
      <button
        type="button" className="docs-action docs-export" disabled={!enabled} onClick={onClick}
        aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : undefined}
      >
        {words}
      </button>
      {request !== null && <ExportSheet request={request} onClose={() => setRequest(null)} />}
    </>
  );
}

```

  - In `ShareAction`'s props, `  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>;` becomes `  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>; readonly exportOffered: boolean;`; `      {/* Export (spec 4.17) passes whether it offers Export on this page; until it ships, no page does. */}` becomes `      {/* Whether this page offers Export (spec 4.17): the refusals that take Export's clause then carry it (spec 4.16). */}`; `exportOffered={false}` becomes `exportOffered={p.exportOffered}`.
  - In `Actions`: the doc comment's ` *  it is resolved from this visit's tree. Export joins after Share in its own run. */` becomes ` *  it is resolved from this visit's tree. Export (spec 4.17) follows Share on a leaf. */`; its props line `  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;` becomes:

```tsx
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;
  readonly exportBody: ExportBody | null; readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null;
  readonly onPlainView: (() => void) | null;
```

    after `  const share = shareStateFor(page, tree, file, p.leafImage);` add:

```tsx
  const settled = useStoreSettled(p.pageStore);
  useAssetsVersion(p.exportAssets);
  const exported = exportStateFor(page, tree, file, { body: p.exportBody, store: p.pageStore, settled, assets: p.exportAssets });
```

    `      {share.s !== 'absent' && <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} />}` becomes:

```tsx
      {share.s !== 'absent' && (
        <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} exportOffered={exported.s !== 'absent'} />
      )}
      {exported.s !== 'absent' && page.kind === 'path' && (
        <ExportAction
          key={exportKeyOf(page, tree, exported)} page={page} tree={tree} state={exported} assets={p.exportAssets}
          readAt={file.s === 'ok' ? file.receivedAt : null} onPlainView={p.onPlainView}
        />
      )}
```

  - In `DocsHead`, `          <Actions page={page} tree={tree} file={visit.file} leafImage={p.leafImage ?? null} />` becomes:

```tsx
          <Actions
            page={page} tree={tree} file={visit.file} leafImage={p.leafImage ?? null} exportBody={p.exportBody ?? null}
            pageStore={p.pageStore ?? null} exportAssets={p.exportAssets ?? null} onPlainView={p.onPlainView ?? null}
          />
          {p.plainView === true && <p className="docs-note" role="status">{DOCS_HEAD_TEXT.exportPlainShown}</p>}
```

  (`Leaf` is the file's own alias, `DocsPageLocation & { kind: 'path' }`. The two hooks run before `Actions`' early `return null`, as every hook must.)
- [ ] **Step 5: Run, then register the control.** Step 3's command — Expected: 13 passed. Then `( cd pwa && ./node_modules/.bin/vitest run test/control-census.test.ts )` — Expected: 1 failed, `'registers every one'`, naming `docs/DocsHead.tsx <button> docs-action docs-export`. In `control-census.test.ts`, after the two lines of the `'docs/DocsHead.tsx <button> docs-action docs-share'` entry add:

```ts
  'docs/DocsHead.tsx <button> docs-action docs-export':
    "TOKEN. Export (spec 4.17), after Share on a leaf: a <button> wearing the header's link-action class, `.docs-action`, "
    + 'whose rule carries the floor.',
```

  Re-run: green.
- [ ] **Step 6: Guards.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx test/docs-share.test.ts test/docs-share-sheet.test.tsx test/docs-truth.test.tsx test/docs-refresh.test.tsx test/docs-banners.test.tsx test/docs-visit.test.tsx test/reader-frame.test.tsx test/app-docs-boundary.test.tsx )` — Step 0's counts plus 11, green (`reader-frame.test.tsx` mocks `share.ts` to `copyText` alone, and nothing in the header calls another `share.ts` name while no sheet is open). `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/literal-census.test.ts )` through `ccrc test` — unchanged (if `literal-census` reads `EXPORT_WAIT_TEXT.formatting` against `DocMarkdown.tsx#DOC_FORMATTING`, both are under 25 characters and it does not; leave both). `TSC-OK`.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/export/policy.ts pwa/src/docs/docsText.ts pwa/src/docs/DocsHead.tsx pwa/test/control-census.test.ts pwa/test/docs-screen.test.tsx` (expect 5), message `docs: Export in the Docs header, after Share (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T8-M1 | M4.SH8 | pwa | `src/docs/DocsHead.tsx` | the `{exported.s !== 'absent' && page.kind === 'path' && (` … `)}` block moved before the `{share.s !== 'absent' && (` block | `test/docs-screen.test.tsx` | 1 failed — `"a leaf's actions read View on GitHub, Share, Export, Open committed version, in that order (M4.SH8)"` |
| W5X-T8-M2 | M4.SH3 | pwa | `src/docs/DocsHead.tsx` | `  if (k.kind !== 'leaf' \|\| expected === null) return EXPORT_ABSENT;` → `  if (k.kind !== 'leaf') return EXPORT_ABSENT;` | `test/docs-screen.test.tsx` | 1+ failed — `"a new draft: Export is enabled and Share's refusal carries Export's clause; a withheld new file: …"` |
| W5X-T8-M3 | M4.SH8 | pwa | `src/docs/DocsHead.tsx` | `  if (cls === 'other' \|\| cls === 'html') return EXPORT_ABSENT;` → `  if (cls === 'html') return EXPORT_ABSENT;` | `test/docs-screen.test.tsx` | 1 failed — `'no Export for class other, nor for html in W5 (M4.SH8)'` |
| W5X-T8-M4 | M4.SH3 | pwa | `src/docs/DocsHead.tsx` | `exportOffered={exported.s !== 'absent'}` → `exportOffered={false}` | `test/docs-screen.test.tsx` | 1 failed — `"a new draft: Export is enabled and Share's refusal carries Export's clause; …"` |
| W5X-T8-M5 | M4.EX15 | pwa | `src/docs/DocsHead.tsx` | in the `cls === 'markdown' && b.kind === 'tree'` arm, `return x.store === null \|\| !x.settled ? exportWaits('highlighting')` → `return x.store === null ? exportWaits('highlighting')` | `test/docs-screen.test.tsx` | 2 failed — `"Highlighting… until the page's store settles; …"`; `'the worker-time ceiling bounds the wait: with a highlighter that never answers, …'` (its first `Highlighting…` never shows; the timeouts-ceiling case may red as well if its export runs before its timeouts land, a third name reported as the discipline says) |
| W5X-T8-M6 | M4.EX15 | pwa | `src/docs/DocsHead.tsx` | `  if (cls === 'markdown' && b.kind === 'tree' && b.text === src.text) {` → `  if (cls === 'markdown' && b.kind === 'tree') {` | `test/docs-screen.test.tsx` | 1 failed — `'a body that answers another text is not exported: it reads Formatting… (M4.EX15)'` |
| W5X-T8-M7 | — | pwa | `src/docs/DocsHead.tsx` | `  if (cls === 'markdown' && b.kind === 'reader') return { s: 'plain-view' };` → `  if (cls === 'markdown' && b.kind === 'reader') return exportWaits('formatting');` | `test/docs-screen.test.tsx` | 2 failed — `'on a leaf the reader frame shows, Export (plain view) turns the reader off there, …'`; `'leaving the page brings the reader back, on a later return too (refinement (a))'` |
| W5X-T8-M8 | M4.EX12 | pwa | `src/docs/DocsHead.tsx` | `    if (held.s === 'failed') return exportWaits('image-failed');` → `    if (held.s === 'failed') return updating;` | `test/docs-screen.test.tsx` | 1 failed — `'a raster leaf: Export waits for its own image, …'` |
| W5X-T8-M9 | — | pwa | `test/control-census.test.ts` | the `'docs/DocsHead.tsx <button> docs-action docs-export'` entry → removed | `test/control-census.test.ts` | 1 failed — `'registers every one'` |
| W5X-T8-M10 | M4.EX15 | pwa | `src/screens/DocsScreen.tsx` | `({ ...highlighters, publish: setPageStore })` → `({ ...highlighters })` | `test/docs-screen.test.tsx` | 8 failed — the order case, the new-draft case, the Formatting… and Highlighting… cases, both ceiling cases, the C2 case and the reader case (no store is ever published, so every Markdown leaf waits) |
| W5X-T8-M11 | M4.EX15 | pwa | `src/lib/highlightStore.ts` | `    const timer = ceilingsOn` → `    const timer = false` (the worker-time ceiling's timer is never set: a wait with no worker-time ceiling; a byte-identical file, restored and sha-checked like any row) | `test/docs-screen.test.tsx` | 1 failed — `'the worker-time ceiling bounds the wait: with a highlighter that never answers, …'` |
| W5X-T8-M12 | — | pwa | `src/screens/DocsScreen.tsx` | `  useEffect(() => { setPlainAt((at) => (at === null \|\| at === here ? at : null)); }, [here]);` → removed | `test/docs-screen.test.tsx` | 1 failed — `'leaving the page brings the reader back, on a later return too (refinement (a))'` |

**Verify:** the Task 8 describe, 13 passed; the guards; `TSC-OK`.

### Task 9: The Export chrome: tokens only, no colour of its own, and both tap-target halves (§4.14; M4.S1's Export chrome; refinement (w))

**Model routing:** `sonnet`, effort `medium`. Little judgment: a handful of short rules and two guards, as Share's Task 7.

**Spec rows:** §4.14 ("Share and Export chrome … joins … both halves of `tap-targets.test.tsx`: … `.docs-export*`, meaning the … sheets, … Save, Retry"), M4.S1 (its Export chrome clause, as refinement (w) reads it).

**Files:**
- Modify: `pwa/src/docs/docs.css` (one block after the Share block, before the reduced-motion block, which stays last), `pwa/test/tap-targets.test.tsx` (one describe inserted), `pwa/test/docs-export-sheet.test.tsx` (three import lines; one appended describe).
- Guards (not edited): `pwa/test/contrast.test.ts` (its census unchanged by `docs.css`), `pwa/test/hover-states.test.ts`, `pwa/test/motion-reduced.test.ts`, `pwa/test/shape-census.test.ts`, `pwa/test/css-vars.test.ts`, `pwa/test/shell-css.test.ts`, `pwa/test/control-census.test.ts`.

**Decisions:** (1) The header's Export takes its floor and look from `.docs-action`; `.docs-export` sets the pointer and drops the underline while disabled, as `.docs-share` does. (2) No `.docs-export` rule sets a colour, ground or border colour: the sheet inherits the `Sheet` panel's measured ink and ground, so `design/audit.mjs` owes it nothing (the export FILE's chrome, `export.css`, was registered in Task 2). (3) The sheet's Save and Retry are `@ccrc/ui`'s `Button`, whose variants carry `min-h-tap`. (4) Each new rule declares four things or fewer, so the shape census sees no new cluster. (Departure: (w), as Share's D-7770 for Share's chrome.)

- [ ] **Step 0:** `git grep -qF ".docs-share-field {" HEAD -- pwa/src/docs/docs.css && ! git grep -qF ".docs-export" HEAD -- pwa/src/docs/docs.css && git grep -qF "describe('TextLink stays inside a line of text — a link alone is a control', () => {" HEAD -- pwa/test/tap-targets.test.tsx && echo T9-BASE-OK`. Claim `docs.css`, `tap-targets.test.tsx`. Record the guard suites' counts.
- [ ] **Step 1: Write the failing cases.**
  - `docs-export-sheet.test.tsx`: after `import { fireEvent, render, screen } from '@testing-library/react';` add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';`; after `import { syncTestStore } from './highlightTestStore';` add `import { stripComments } from './cssRule';`. Append:

```tsx

// ---- Task 9: the Export chrome paints no colour of its own (M4.S1's Export clause) ------------------------------

describe('the Export chrome paints no colour of its own (M4.S1 Export clause; spec 4.14)', () => {
  const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8'));
  const exportRules = css.split('}').map((chunk) => chunk.split('{')).filter(([sel]) => /\.docs-export\b/.test(sel ?? ''));

  it('every rule naming .docs-export sets no ink, ground, border, outline, fill or shadow, so design/audit.mjs owes it no entry', () => {
    expect(exportRules.map(([sel]) => (sel ?? '').trim()).sort()).toEqual([
      '.docs-export', '.docs-export-facts', '.docs-export-facts > div', '.docs-export-facts dt, .docs-export-facts dd',
      '.docs-export-note', '.docs-export-sheet', '.docs-export:disabled',
    ]);
    for (const [sel, body] of exportRules) {
      expect(body ?? '', sel).not.toMatch(
        /(?:^|[;{\s])(?:color|background[a-z-]*|border[a-z-]*|outline[a-z-]*|fill|stroke|text-decoration-color|opacity|filter|box-shadow|accent-color|caret-color)\s*:/);
    }
  });
});
```

  - `tap-targets.test.tsx`: find `describe('TextLink stays inside a line of text — a link alone is a control', () => {` and insert before it:

```tsx
// — native Docs reader W5, Export: the header's Export and the export sheet's Save and Retry (spec 2026-10-01 4.14,
// 4.17). Both halves for each, as for the Docs controls above. —
describe('Export: .docs-export on .docs-action, and the export sheet’s Save and Retry off @ccrc/ui’s Button (docs W5 Export)', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('are at least one tap tall: .docs-action on the token, the sheet’s buttons off @ccrc/ui’s Button', () => {
    expect(floorIn(docsCss, '.docs-action')).toBe('var(--tap-min)');
    expect(buttonVariants({ variant: 'primary' })).toContain('min-h-tap');
    expect(buttonVariants({ variant: 'ghost' })).toContain('min-h-tap');
  });

  it('are the classes the rendered controls carry', async () => {
    openDocs('/docs/demo/specs/a.md', markdownLeaf('# A\n'));
    const exportButton = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.export });
    expect(exportButton).toHaveClass('docs-action', 'docs-export');
    fireEvent.click(exportButton);
    expect(await screen.findByRole('button', { name: /^Save / })).toHaveClass('min-h-tap');
  });
});

```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-export-sheet.test.tsx -t "paints no colour" )` — Expected: 1 failed (no `.docs-export` rule yet). `( cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx -t "docs W5 Export" )` through `ccrc test` — Expected: 2 passed (the floor rides `.docs-action`, and the classes are on the rendered controls since Task 8): the census half of this task is the colour guard.
- [ ] **Step 3: Implement the CSS.** In `docs.css`, find `.docs-share-field { inline-size: 100%; min-height: var(--tap-min); font: var(--weight-regular) var(--text-input) / var(--leading-mono) var(--font-mono); }` and insert after it:

```css

/* — Export (section 4.17; native Docs reader W5, Export). The header's Export is a <button> wearing `.docs-action`, as
   Share's is (tap-targets.test.tsx holds both halves); `.docs-export` adds the pointer and, while it waits ("Updating
   to …", "Formatting…", "Highlighting…"), drops the underline. The export sheet sets no colour, ground or border colour
   of its own: it inherits the Sheet panel's measured ink and ground, as the share sheet does, so design/audit.mjs owes
   it no entry (docs-export-sheet.test.tsx holds that). Save and Retry are @ccrc/ui's Button, which carries the floor. — */
.docs-export { cursor: pointer; }
.docs-export:disabled { cursor: default; text-decoration: none; }
.docs-export-sheet { display: grid; gap: var(--sp-3); min-width: 0; }
.docs-export-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--sp-1) var(--sp-3); margin: 0; }
.docs-export-facts > div { display: contents; }
.docs-export-facts dt, .docs-export-facts dd { margin: 0; overflow-wrap: anywhere; font-size: var(--text-sm); }
.docs-export-note { margin: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }
```

- [ ] **Step 4: Run to verify they pass**, then the guards: Step 2's two commands, all green; `( cd pwa && ./node_modules/.bin/vitest run test/hover-states.test.ts test/motion-reduced.test.ts test/shape-census.test.ts test/css-vars.test.ts test/shell-css.test.ts test/control-census.test.ts )` — Step 0's counts; `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )` through `ccrc test`, alone — Task 2's count, its census unchanged by these rules (none sets a colour).
- [ ] **Step 5: Commit.** `git add pwa/src/docs/docs.css pwa/test/tap-targets.test.tsx pwa/test/docs-export-sheet.test.tsx` (expect 3), message `docs: the Export chrome, tokens only, no colour of its own, on the tap floor (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T9-M1 | M4.S1 | pwa | `src/docs/docs.css` | `.docs-export-note { margin: 0;` → `.docs-export-note { color: var(--ink-tertiary); margin: 0;` | `test/docs-export-sheet.test.tsx` | 1 failed — `'every rule naming .docs-export sets no ink, ground, border, outline, fill or shadow, …'` |
| W5X-T9-M2 | M4.S1 | pwa | `src/docs/DocsHead.tsx` | `className="docs-action docs-export"` → `className="docs-export"` | `test/tap-targets.test.tsx`, `test/control-census.test.ts` | 3 failed — `'are the classes the rendered controls carry'` (tap-targets, the Export describe); `'registers every one'` and `'keeps no stale entry'` (control-census) |

**Verify:** Step 4's commands, all green.

### Task 10: The scans: inert by construction, confined, one pin rule, no highlighter in the closure (M4.EX2's scan, M4.EX11, M4.EX16, M4.EX17, M4.T7's Export clause; refinement (v))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`. The judgment is in the scans' forms and their planted controls.

**Spec rows:** M4.EX2 (the scan), M4.EX11, M4.EX16, M4.EX17, M4.T7 (the scan covers `provenance.ts` and `buildExport.tsx`), M4.H21 (= M4.EX15, EX17, EX18, now all landed); refinement (v).

**Files:**
- Modify: `pwa/test/docs-scans.test.ts` (one clause appended after Share's clause, the file's last describe; under Task 5's branch 6b, the matching skip in `exportInertHits`, Step 1b; clause W5h-a's exception is Task 5's).
- Guards: the file's existing clauses (unchanged unless 6b).

**Decisions:** (1) Every clause reads the TypeScript AST with the file's own helpers (`sourceFiles`, `unwrap`, `memberName`, `moduleUses`, `relativeTarget`, `stringText`, `namesSink`, `namesHighlightJs`, `scanTree`), NOT EXHAUSTIVE, its evasions in its header. (2) M4.EX17's closure follows value imports, static and dynamic, through relative specifiers, from `docs/export/buildExport.tsx`; a type-only import is erased and moves nothing; a bare specifier is recorded and checked against the `highlight.js` segment. (3) Planted controls run on a copy of `pwa/src` in a temporary directory, removed in `afterAll` (the file's `mkdtempSync` pattern). (4) M4.EX16's "`<iframe`/`srcDoc` nowhere in `pwa/src`" holds in W5 even at `buildExport.tsx`, which clause W8a still allows by exact path for W6 (refinement (v)). (None departs.)

- [ ] **Step 0:** `git grep -qF "describe('clause W5 Share: one share door, and one clipboard writer under pwa/src/docs (M4.SH7; M4.T7 Share clause)'" HEAD -- pwa/test/docs-scans.test.ts && test -f pwa/src/docs/export/buildExport.tsx && test -f pwa/src/docs/ExportSheet.tsx && echo T10-BASE-OK`. Claim `docs-scans.test.ts`. Record the file's count.
- [ ] **Step 1: Append the clause** at the end of `docs-scans.test.ts` (its helpers first, then the describe):

```ts

// ---------------------------------------------------------------------------------------------------------------
// Clause W5 Export (spec 2026-10-01 4.17; M4.EX2's scan, M4.EX11, M4.EX16, M4.EX17, M4.T7's Export clause), read with
// TypeScript's parser:
//   - M4.EX2: in `docs/export/**`, `docs/ExportSheet.tsx`, `docs/share.ts` and `docs/ShareSheet.tsx`: no
//     `dangerouslySetInnerHTML` (any spelling clause W5h-a's `namesSink` reads), no assignment to `innerHTML` or
//     `outerHTML`, no `insertAdjacentHTML` call, no `document.write` or `document.writeln` call, and no string or
//     template piece that begins with `<` and a letter, `/` or `!`, except `EXPORT_PREFIX`'s own initialiser in
//     `docs/export/policy.ts`;
//   - M4.EX11: the name `imagePinFor` (a call, an import, any identifier) appears only in `docs/docsLinks.ts`, its
//     definition, and `docs/DocImage.tsx`, whose `planImageRef` is the one way Export reaches it;
//   - M4.EX16: across `pwa/src`, a `react-dom/server` specifier (any subpath) and the name `renderToStaticMarkup` only in
//     `docs/export/buildExport.tsx`, which exports `buildExport` and types only; `./export/buildExport` imported only by
//     `docs/ExportSheet.tsx`, through a dynamic `import()`; `ExportSheet.tsx` calls `downloadExport`, reads no member
//     named `bytes`, and holds no `srcDoc`, `innerHTML`, `document.write` or `window.open`; under `pwa/src/docs` and
//     `lib/markdown*`, `new Blob(`, `new File(` and `URL.createObjectURL(` only in `docs/objectUrls.ts`; and in W5 no JSX
//     `iframe` element and no `srcDoc` attribute anywhere in `pwa/src` (refinement (v));
//   - M4.EX17: the run-time import closure of `docs/export/buildExport.tsx`, static and dynamic, through every relative
//     specifier, holds neither `lib/markdownHighlightWorker.ts` nor `lib/highlightGrammars.ts`, and no `highlight.js`
//     specifier;
//   - M4.T7: clause 1's badge scan reads the export files and finds no draft state.
// NOT EXHAUSTIVE. Known evasions: a specifier, a name or a tag built at run time; a sink, `write`, `open` or `bytes`
// reached through an alias (`const w = document.write`, `const { bytes } = result`); `Reflect.set` or
// `Object.defineProperty` onto `innerHTML`; an `@/` import in the closure (`ui/src` holds no highlight.js: clause
// W5h-a); `require`. The behavioural halves are docs-export.test.tsx (the hostile corpus) and the browser leg (M5.B9).
// ---------------------------------------------------------------------------------------------------------------

const parse = (source: string, file: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** The files M4.EX2's token rule reads. */
const exportInertScope = (file: string): boolean => file.startsWith('src/docs/export/')
  || ['src/docs/ExportSheet.tsx', 'src/docs/share.ts', 'src/docs/ShareSheet.tsx'].includes(file);

/** Whether `n` sits in the initialiser of `EXPORT_PREFIX` in `docs/export/policy.ts`. */
function inExportPrefix(n: ts.Node, file: string): boolean {
  if (file !== 'src/docs/export/policy.ts') return false;
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !ts.isVariableDeclaration(p)) p = p.parent;
  return p !== undefined && ts.isIdentifier(p.name) && p.name.text === 'EXPORT_PREFIX';
}

/** `<owner>.<name>(…)` with the bare identifier `owner`. */
function callsOn(n: ts.CallExpression, owner: string, names: readonly string[]): string | undefined {
  const callee = unwrap(n.expression);
  const name = memberName(callee);
  if (name === undefined || !names.includes(name)) return undefined;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return undefined;
  const o = unwrap(callee.expression);
  return ts.isIdentifier(o) && o.text === owner ? `${owner}.${name}` : undefined;
}

/** M4.EX2's findings in one module, `<file> <rule>`. */
function exportInertHits(source: string, file: string): string[] {
  const hits = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (namesSink(n)) hits.add(`${file} sink`);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = memberName(unwrap(n.left));
      if (name === 'innerHTML' || name === 'outerHTML') hits.add(`${file} ${name}`);
    }
    if (ts.isCallExpression(n)) {
      if (memberName(unwrap(n.expression)) === 'insertAdjacentHTML') hits.add(`${file} insertAdjacentHTML`);
      const write = callsOn(n, 'document', ['write', 'writeln']);
      if (write !== undefined) hits.add(`${file} ${write}`);
    }
    const text = stringText(n);
    if (text !== undefined && /^<[A-Za-z/!]/.test(text) && !inExportPrefix(n, file)) hits.add(`${file} markup-string`);
    ts.forEachChild(n, visit);
  };
  visit(parse(source, file));
  return [...hits];
}

/** M4.EX11, M4.EX16's findings in one module, `<file> <use>`, each once. */
function exportUses(source: string, file: string): string[] {
  const sf = parse(source, file);
  const uses = new Set<string>();
  for (const use of moduleUses(sf)) {
    if (/^react-dom\/server(?:[./]|$)/.test(use.specifier)) uses.add(`${file} react-dom/server`);
    if (use.value && relativeTarget(file, use.specifier) === 'src/docs/export/buildExport') {
      uses.add(`${file} buildExport:${use.dynamic ? 'dynamic' : 'static'}`);
    }
  }
  const blobScope = file.startsWith('src/docs/') || file.startsWith('src/lib/markdown');
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === 'renderToStaticMarkup') uses.add(`${file} renderToStaticMarkup`);
    if (ts.isIdentifier(n) && n.text === 'imagePinFor') uses.add(`${file} imagePinFor`);
    if (blobScope && ts.isNewExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'Blob' || n.expression.text === 'File')) {
      uses.add(`${file} new ${n.expression.text}`);
    }
    if (blobScope && ts.isCallExpression(n) && callsOn(n, 'URL', ['createObjectURL']) !== undefined) uses.add(`${file} createObjectURL`);
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe') {
      uses.add(`${file} iframe`);
    }
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text.toLowerCase() === 'srcdoc') uses.add(`${file} srcDoc`);
    if (file === 'src/docs/ExportSheet.tsx') {
      if (memberName(n) === 'bytes') uses.add(`${file} bytes`);
      if (memberName(n) === 'innerHTML') uses.add(`${file} innerHTML`);
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee) && callee.text === 'downloadExport') uses.add(`${file} downloadExport`);
        if (callsOn(n, 'document', ['write', 'writeln']) !== undefined) uses.add(`${file} document.write`);
        if (callsOn(n, 'window', ['open']) !== undefined) uses.add(`${file} window.open`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...uses];
}

/** The names `buildExport.tsx` exports as values (a function, a class, a variable, or an `export { … }` that is not
 *  type-only). */
function exportedValues(source: string, file: string): string[] {
  const out: string[] = [];
  for (const st of parse(source, file).statements) {
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name !== undefined) out.push(st.name.text);
    if (exported && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
    }
    if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause !== undefined && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) out.push(e.name.text);
    }
  }
  return out;
}

/** A base-relative module path (no extension) as the source file it names, or undefined (a stylesheet, a package). */
function sourceOf(base: string, mod: string): string | undefined {
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    try {
      if (statSync(path.join(base, mod + ext)).isFile()) return mod + ext;
    } catch { /* absent */ }
  }
  return undefined;
}

/** M4.EX17: the run-time import closure of `entry` under `base`: its source files and every bare specifier on the way. */
function closureFrom(base: string, entry: string): { files: string[]; bare: string[] } {
  const files = new Set<string>();
  const bare: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = sourceOf(base, queue.shift()!);
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const use of moduleUses(parse(readFileSync(path.join(base, file), 'utf8'), file))) {
      if (!use.value) continue;
      const target = relativeTarget(file, use.specifier);
      if (target === undefined) bare.push(use.specifier);
      else queue.push(target);
    }
  }
  return { files: [...files].sort(), bare };
}

/** Every finding of `scan` over the `.ts`/`.tsx` files under `<base>/src`, sorted. */
function scanSrc(base: string, scan: (source: string, file: string) => string[], scope: (file: string) => boolean = () => true): string[] {
  return sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'))
    .filter(scope).flatMap((rel) => scan(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel)).sort();
}

describe('clause W5 Export: inert by construction, confined, one pin rule, no highlighter (M4.EX2, M4.EX11, M4.EX16, M4.EX17, M4.T7)', { timeout: 30_000 }, () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** A copy of `pwa/src` with `text` appended to `rel`; returns the copy's base. */
  function planted(rel: string, text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-export-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    writeFileSync(file, readFileSync(file, 'utf8') + text);
    return dir;
  }

  it('M4.EX2: the export files hold no sink, no HTML writer and no markup string but EXPORT_PREFIX', () => {
    const files = sourceFiles(path.join(SRC_DIR, 'docs')).map((f) => path.relative(PWA, f).split(path.sep).join('/')).filter(exportInertScope);
    expect(files).toEqual(expect.arrayContaining([
      'src/docs/ExportSheet.tsx', 'src/docs/ShareSheet.tsx', 'src/docs/export/buildExport.tsx', 'src/docs/export/exportMarkdown.tsx',
      'src/docs/export/policy.ts', 'src/docs/share.ts',
    ]));
    expect(scanSrc(PWA, exportInertHits, exportInertScope)).toEqual([]);
  });

  it.each([
    ['a markup string', "export const planted = '<b>x</b>';", 'markup-string'],
    ['a markup template', 'export const planted = (x: string) => `</p>${x}`;', 'markup-string'],
    ['an innerHTML write', 'export const planted = (e: Element) => { e.innerHTML = "x"; };', 'innerHTML'],
    ['an insertAdjacentHTML call', "export const planted = (e: Element) => e.insertAdjacentHTML('beforeend', 'x');", 'insertAdjacentHTML'],
    ['a document.write call', "export const planted = () => document.write('x');", 'document.write'],
  ])('M4.EX2 planted: %s in exportMarkdown.tsx is red', (_name, text, rule) => {
    const dir = planted('src/docs/export/exportMarkdown.tsx', `\n${text}\n`);
    expect(scanSrc(dir, exportInertHits, exportInertScope)).toContain(`src/docs/export/exportMarkdown.tsx ${rule}`);
  });

  it('M4.EX2: EXPORT_PREFIX is allowed by name, and only in policy.ts', () => {
    expect(exportInertHits("export const EXPORT_PREFIX = '<!doctype html>';", 'src/docs/export/policy.ts')).toEqual([]);
    expect(exportInertHits("export const EXPORT_PREFIX = '<!doctype html>';", 'src/docs/export/filename.ts'))
      .toEqual(['src/docs/export/filename.ts markup-string']);
  });

  it('M4.EX16 and M4.EX11: the builder, the blob, the pin rule and the frame have exactly their homes', () => {
    expect(scanSrc(PWA, exportUses)).toEqual([
      'src/docs/DocImage.tsx imagePinFor',
      'src/docs/ExportSheet.tsx buildExport:dynamic',
      'src/docs/ExportSheet.tsx downloadExport',
      'src/docs/docsLinks.ts imagePinFor',
      'src/docs/export/buildExport.tsx react-dom/server',
      'src/docs/export/buildExport.tsx renderToStaticMarkup',
      'src/docs/objectUrls.ts createObjectURL',
      'src/docs/objectUrls.ts new Blob',
    ]);
  });

  it('M4.EX16: buildExport.tsx exports buildExport and types only', () => {
    const file = 'src/docs/export/buildExport.tsx';
    expect(exportedValues(readFileSync(path.join(PWA, file), 'utf8'), file)).toEqual(['buildExport']);
  });

  it.each([
    ['a static import of the builder in DocsHead', 'src/docs/DocsHead.tsx', "\nimport { buildExport as plantedBuild } from './export/buildExport';\nexport const plantedB = plantedBuild;\n", 'src/docs/DocsHead.tsx buildExport:static'],
    ['react-dom/server in exportMarkdown', 'src/docs/export/exportMarkdown.tsx', "\nimport { renderToString as plantedRender } from 'react-dom/server';\nexport const plantedR = plantedRender;\n", 'src/docs/export/exportMarkdown.tsx react-dom/server'],
    ['a bytes read in the sheet', 'src/docs/ExportSheet.tsx', '\nexport const plantedBytes = (r: { bytes: Uint8Array }) => r.bytes.length;\n', 'src/docs/ExportSheet.tsx bytes'],
    ['a window.open in the sheet', 'src/docs/ExportSheet.tsx', "\nexport const plantedOpen = () => window.open('x');\n", 'src/docs/ExportSheet.tsx window.open'],
    ['a Blob in the builder', 'src/docs/export/buildExport.tsx', "\nexport const plantedBlob = () => new Blob(['x']);\n", 'src/docs/export/buildExport.tsx new Blob'],
    ['an iframe in the builder', 'src/docs/export/buildExport.tsx', '\nexport const PlantedFrame = () => <iframe srcDoc="x" />;\n', 'src/docs/export/buildExport.tsx iframe'],
    ['imagePinFor in Export', 'src/docs/export/exportMarkdown.tsx', "\nimport { imagePinFor as plantedPin } from '../docsLinks';\nexport const plantedP = plantedPin;\n", 'src/docs/export/exportMarkdown.tsx imagePinFor'],
  ])('M4.EX16/M4.EX11 planted: %s is red', (_name, rel, text, use) => {
    expect(scanSrc(planted(rel, text), exportUses)).toContain(use);
  });

  it('M4.EX17: the builder reaches lib/markdown.tsx and neither highlight worker module nor highlight.js', () => {
    const { files, bare } = closureFrom(PWA, 'src/docs/export/buildExport');
    expect(files).toEqual(expect.arrayContaining(['src/docs/export/buildExport.tsx', 'src/lib/markdown.tsx', 'src/docs/DocImage.tsx']));
    expect(files.filter((f) => f === 'src/lib/markdownHighlightWorker.ts' || f === 'src/lib/highlightGrammars.ts')).toEqual([]);
    expect(bare.filter((s) => namesHighlightJs('src/docs/export/buildExport.tsx', s))).toEqual([]);
  });

  it('M4.EX17 planted: highlight.js, or the grammars module, in a file the builder reaches is red', () => {
    const core = closureFrom(planted('src/docs/export/colouring.ts', "\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedC = plantedCore;\n"), 'src/docs/export/buildExport');
    expect(core.bare.filter((s) => namesHighlightJs('src/docs/export/colouring.ts', s))).not.toEqual([]);
    const grammars = closureFrom(planted('src/docs/export/exportMarkdown.tsx', "\nimport { HLJS as plantedG } from '../../lib/highlightGrammars';\nexport const plantedH = plantedG;\n"), 'src/docs/export/buildExport');
    expect(grammars.files).toContain('src/lib/highlightGrammars.ts');
  });

  it('M4.T7 Export clause: the badge scan reads the export files and finds no draft state', () => {
    const { files, hits } = scanTree([DOCS_DIR, DOCS_SCREEN], PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/export/provenance.ts', 'src/docs/export/buildExport.tsx', 'src/docs/ExportSheet.tsx']));
    expect(hits).toEqual([]);
  });
});
```

  (`SRC_DIR`, `PWA`, `DOCS_DIR`, `DOCS_SCREEN`, `sourceFiles`, `unwrap`, `memberName`, `moduleUses`, `relativeTarget`, `stringText`, `namesSink`, `namesHighlightJs` and `scanTree` are the file's module-scope names at BASE; `cpSync`, `mkdtempSync`, `rmSync`, `statSync`, `writeFileSync`, `readFileSync`, `os`, `path`, `ts` and `afterAll` are already imported. If `exportUses` reports a `createObjectURL` or `new Blob` outside `objectUrls.ts` under `pwa/src/docs` or `lib/markdown*` that BASE already had, stop and ask: it would be a pre-existing break of M4.EX16's clause.)
- [ ] **Step 1b (only under Task 5's branch 6b):** Task 5 Step 6b already gave clause W5h-a's `sinkVerdict` its one `<style>` exception, renamed its real-tree M4.H15 case and put the admitted `buildExport.tsx documentOf ok` first in the exact lists of its five planted M4.H15 cases. Here, in `exportInertHits`, `if (namesSink(n)) hits.add(...)` skips that one attribute by the same test (Task 5's condition, read on the same node, so only a `<style>` in `buildExport.tsx` fed the identifier `EXPORT_CSS` passes). This clause's planted cases, which plant elsewhere, stay its red controls, and clause W5h-a's planted `<style>` case stays green. Record it in the SDD ledger beside Task 5's entry.
- [ ] **Step 2: Run to verify** (the scans pin code already written, so they are green at once; the planted cases are their red controls). `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — Step 0's count plus this clause's 19 cases, all green. Then measure each row below, which is the red half.
- [ ] **Step 3: Commit.** `git add pwa/test/docs-scans.test.ts` (expect 1), message `docs: Export's scans, inert, confined, one pin rule, no highlighter (docs W5 Export)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T10-M1 | M4.EX2 | pwa | `src/docs/export/exportMarkdown.tsx` | a line appended at the end: `export const plantedMarkup = '<b>x</b>';` | `test/docs-scans.test.ts` | 1 failed — `'M4.EX2: the export files hold no sink, no HTML writer and no markup string but EXPORT_PREFIX'` |
| W5X-T10-M2 | M4.EX2 | pwa | `test/docs-scans.test.ts` | `  return p !== undefined && ts.isIdentifier(p.name) && p.name.text === 'EXPORT_PREFIX';` → `  return false;` | `test/docs-scans.test.ts` | 2 failed — the M4.EX2 case (policy.ts's prefix now a hit); `'M4.EX2: EXPORT_PREFIX is allowed by name, and only in policy.ts'` |
| W5X-T10-M3 | M4.EX16 | pwa | `src/docs/DocsHead.tsx` | a line appended at the end: `export const plantedBuild = () => import('./export/buildExport');` | `test/docs-scans.test.ts` | 1 failed — `'M4.EX16 and M4.EX11: the builder, the blob, the pin rule and the frame have exactly their homes'` |
| W5X-T10-M4 | M4.EX16 | pwa | `src/docs/ExportSheet.tsx` | a line appended at the end: `export const plantedBytes = (r: { bytes: Uint8Array }) => r.bytes.length;` | `test/docs-scans.test.ts` | 1 failed — the same homes case |
| W5X-T10-M5 | M4.EX17 | pwa | `src/docs/export/colouring.ts` | a line appended at the end: `import plantedCore from 'highlight.js/lib/core'; export const plantedC = plantedCore;` | `test/docs-scans.test.ts` | 2 failed — `'M4.EX17: the builder reaches lib/markdown.tsx and neither highlight worker module nor highlight.js'`; clause W5h-a's `'M4.H4: highlight.js and the worker chain sit only in their homes across pwa/src'` |
| W5X-T10-M6 | M4.EX11 | pwa | `src/docs/export/exportMarkdown.tsx` | a line appended at the end: `import { imagePinFor as plantedPin } from '../docsLinks'; export const plantedP = plantedPin;` | `test/docs-scans.test.ts` | 1 failed — the homes case |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — all passed.

### Task 11: The browser leg (M5.B9), and the W5 measurements (§4.17: the build's time, the chunk's size, `?raw` in the build)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`. The judgment is in the controls: a property that holds only because nothing loaded is red.

**Spec rows:** M5.B9 (as amended 2026-10-13), §4.17's "What W5 and W6 must measure" (the W5 rows), §7.7's W5 Export merge gate (M5.B9 green; the measurements recorded; a build time over the parse budget goes to the operator).

**Files:**
- Create: `pwa/browser/docs-export.browser.test.ts`.
- Not committed: one throwaway measurement file under `pwa/browser/` (Step 4), deleted before the commit.
- Guards (not edited): `pwa/test/browser-leg.test.ts`, `pwa/browser/docs-headers.browser.test.ts`, `pwa/browser/reader-frame.browser.test.ts`.

**Decisions:** (1) The battery is planted in one corpus aimed at origin B: an `img`, CSS `url()` and `@import`, `link rel=prefetch`, `preload` and `stylesheet`, `meta http-equiv=refresh`, `base`, a `form` submission, `object` and `embed`, `iframe`, and a planted raw-HTML link that is clicked. (2) Three builds: production (`buildExport` as shipped); construction only (the production file with its CSP meta removed); meta only (the same corpus interpolated into a string page that carries the production `DOCS_EXPORT_CSP` meta); and the CONTROL, the string page with no meta, which must reach B on a fetch-type channel. (3) Each is opened top-level from `file://` and from origin A, a static route that sends only a content type, with the harness's cookie set for A. (4) Chrome is launched with its local-network checks off (as W8a's battery does), so those checks cannot make a property hold that the file itself does not. (5) The file builds exports in-process through `buildExport` under the browser config, which reads `.css?raw` as an empty string (it has no `test.css.include`): the battery is the input's channels, and the stylesheet's own text is held by `docs-export.test.tsx` (refinement (c)). (None departs.)

- [ ] **Step 0:** `test -f pwa/src/docs/export/buildExport.tsx && git grep -qF "export async function startOrigins" HEAD -- pwa/browser/harness.ts && git grep -qF "export function resolveChrome(" HEAD -- pwa/browser/harness.ts && echo T11-BASE-OK`. Confirm `CCRC_CHROME` from the brief. No shared file is edited.
- [ ] **Step 1: Write `pwa/browser/docs-export.browser.test.ts`:**

```ts
// The real-browser row native Docs reader spec 2026-10-01 5.8 gives W5 Export: M5.B9, a hostile export opened
// top-level. One corpus plants every channel a script-free document can open, aimed at origin B: an `img`, CSS `url()`
// and `@import`, `link rel=prefetch`, `preload` and `stylesheet`, `meta http-equiv=refresh`, `base`, a `form`
// submission, `object` and `embed`, `iframe`, and a raw-HTML link that is clicked. Three builds of it are opened
// top-level, from `file://` and from origin A (a static route sending only a content type, with the harness's cookie set
// for A): production (`buildExport` as shipped) reaches neither B nor A's `/api/`; construction only (the CSP meta
// removed) the same, navigation included, because nothing from the input became an element; meta only (the corpus
// interpolated into a string page under the production meta) closes every fetch-type channel, and only navigation
// (the refresh, the clicked link), excluded by name, may reach B, because a CSP meta does not stop navigation (lab 3).
// The CONTROL, the string page with no meta, reaches B on a fetch-type channel: the detector is not blind. Chrome's
// local-network checks are off, so they cannot make a property hold. Under this config `.css?raw` reads as an empty
// string: the stylesheet's own text is docs-export.test.tsx's to hold.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-export.browser.test.ts )`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';
import { buildExport } from '../src/docs/export/buildExport';
import { DOCS_EXPORT_CSP } from '../src/docs/export/policy';
import { exportProvenance } from '../src/docs/export/provenance';
import { UNREQUESTED_ENTRY, type HighlightStore } from '../src/lib/highlightStore';
import { parseMarkdown } from '../src/lib/markdownParse';
import { COMMIT_A, SERVED, entry, pageAt, treeOk } from '../test/docsFixtures';
import { resolveChrome, startOrigins, type OriginHit, type Origins } from './harness';

const SETTLE_MS = 1500;
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;
type Build = 'production' | 'construction' | 'meta' | 'control';
const BUILDS: readonly Build[] = ['production', 'construction', 'meta', 'control'];
/** The channels that fetch, by the path each plants on B; and the two that navigate. */
const FETCH_PATHS = ['/img.png', '/raw-img.png', '/import.css', '/bg.png', '/prefetch', '/preload', '/sheet.css', '/object', '/embed', '/iframe', '/form'];
const NAVIGATION_PATHS = ['/refresh', '/planted'];

let o: Origins;
let browser: Browser;
let dir: string;
const html: Partial<Record<Build, string>> = {};

/** The hostile corpus, every channel aimed at `b`, as raw HTML (a string page's body) and as Markdown (the export's). */
function corpus(b: string): { raw: string; markdown: string; heading: string } {
  const heading = `Report </title><meta http-equiv="refresh" content="0;url=${b}/refresh">`;
  const raw = [
    `<meta http-equiv="refresh" content="0;url=${b}/refresh">`,
    `<img src="${b}/raw-img.png" alt="r">`,
    `<style>@import url(${b}/import.css); body { background: url(${b}/bg.png) }</style>`,
    `<link rel="prefetch" href="${b}/prefetch"><link rel="preload" href="${b}/preload" as="image"><link rel="stylesheet" href="${b}/sheet.css">`,
    `<base href="${b}/base/">`,
    `<form action="${b}/form" method="get"><button id="planted-submit">go</button></form>`,
    `<object data="${b}/object"></object><embed src="${b}/embed">`,
    `<iframe src="${b}/iframe"></iframe>`,
    `<a id="planted" href="${b}/planted">planted</a>`,
  ].join('\n');
  return { raw, markdown: `# ${heading}\n\n![img](${b}/img.png)\n\n${raw}\n`, heading };
}

/** The production export of the corpus, built as Docs builds it: parsed, detached, rendered by `buildExport`. */
async function production(b: string): Promise<string> {
  const { markdown, heading } = corpus(b);
  const outcome = parseMarkdown(markdown, 'docs');
  if (outcome.kind !== 'tree') throw new Error(`the corpus did not parse: ${outcome.kind}`);
  const tree = treeOk({ entries: [entry('specs', 'a.md')] });
  const page = pageAt('/docs/demo/specs/a.md');
  if (page.kind !== 'path') throw new Error('fixture');
  const link: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree, pageSource: 'committed', onFragment: () => {},
  };
  const pin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' } as const;
  const provenance = exportProvenance({ tree, page, pin, show: null, exportedAt: 0, readAt: 0, plainView: true });
  const detached = detachUrls(outcome.tree);
  const result = await buildExport({
    title: heading, name: 'a.html', theme: null, commit: COMMIT_A, provenance, assets: null,
    body: { kind: 'tree', tree: detached.tree, urls: detached.urls, link, store: EMPTY_STORE },
  });
  if (!result.ok) throw new Error('the corpus did not fit');
  return new TextDecoder().decode(result.bytes);
}

/** A store that has nothing and asks nothing: the corpus has no code. */
const EMPTY_STORE: HighlightStore = {
  mode: 'docs', debounceMs: 0, keyOf: () => ({ kind: 'unregistered' }), seed: () => undefined,
  peek: () => UNREQUESTED_ENTRY, copySkip: () => null, request: () => () => undefined, show: () => () => undefined,
  subscribe: () => () => () => undefined, settled: () => true, evictUnreferenced: () => undefined,
  heldKeys: () => ({ entries: 0, subscribers: 0, listeners: 0 }), releaseAll: () => undefined,
};

/** The corpus interpolated into a string page, with or without the production CSP meta. */
function stringPage(b: string, meta: boolean): string {
  const { raw, heading } = corpus(b);
  const csp = meta ? `<meta http-equiv="Content-Security-Policy" content="${DOCS_EXPORT_CSP}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${csp}<title>${heading}</title></head>`
    + `<body><h1>${heading}</h1><img src="${b}/img.png" alt="img">${raw}</body></html>`;
}

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  const page = (name: Build) => (): { headers: Record<string, string>; body: string } =>
    ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: html[name] ?? '' });
  o = await startOrigins(Object.fromEntries(BUILDS.map((n) => [`/export/${n}.html`, page(n)])));
  const prod = await production(o.b);
  html.production = prod;
  html.construction = prod.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  html.meta = stringPage(o.b, true);
  html.control = stringPage(o.b, false);
  dir = mkdtempSync(path.join(tmpdir(), 'ccrc-export-b9-'));
  for (const n of BUILDS) writeFileSync(path.join(dir, `${n}.html`), html[n] ?? '');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await o?.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

/** Opens `build` top-level from `where`, clicks the planted link and button if they exist, waits, and answers every hit
 *  any origin received meanwhile. */
async function openAndWatch(build: Build, where: 'file' | 'a'): Promise<OriginHit[]> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ ...COOKIE, url: o.a }]);
  const tab = await ctx.newPage();
  const from = o.hits.length;
  const url = where === 'file' ? pathToFileURL(path.join(dir, `${build}.html`)).href : `${o.a}/export/${build}.html`;
  await tab.goto(url, { waitUntil: 'load' }).catch(() => undefined);
  for (const id of ['#planted-submit', '#planted']) {
    if (await tab.locator(id).count().catch(() => 0) > 0) await tab.locator(id).click({ timeout: 2000 }).catch(() => undefined);
  }
  await tab.waitForTimeout(SETTLE_MS);
  await ctx.close();
  return o.hits.slice(from);
}

const onB = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'b');
const onApi = (hits: readonly OriginHit[]): OriginHit[] => hits.filter((h) => h.origin === 'a' && h.path.startsWith('/api/'));
const fetchType = (h: OriginHit): boolean => FETCH_PATHS.some((p) => h.path.startsWith(p));

describe('M5.B9: the hostile export opened top-level (spec 2026-10-01 5.8)', () => {
  it('the production file holds none of the corpus as an element (the precondition of what follows)', () => {
    const doc = new DOMParser().parseFromString(html.production ?? '', 'text/html');
    expect(doc.querySelectorAll('img, link, base, form, object, embed, iframe, script, meta[http-equiv="refresh"]')).toHaveLength(0);
  });

  it.each(['file', 'a'] as const)('production, opened from %s: nothing reaches B, and nothing reaches A\'s /api/', async (where) => {
    const hits = await openAndWatch('production', where);
    expect(onB(hits)).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('construction only (no CSP meta), opened from %s: the same, navigation included', async (where) => {
    const hits = await openAndWatch('construction', where);
    expect(onB(hits)).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('meta only (a string page under the meta), opened from %s: every fetch-type channel closed; only navigation, by name', async (where) => {
    const hits = await openAndWatch('meta', where);
    expect(onB(hits).filter((h) => !NAVIGATION_PATHS.some((p) => h.path.startsWith(p)))).toEqual([]);
    expect(onApi(hits)).toEqual([]);
  });

  it.each(['file', 'a'] as const)('CONTROL: the string page with no meta, opened from %s, reaches B on a fetch-type channel', async (where) => {
    const hits = await openAndWatch('control', where);
    expect(onB(hits).some(fetchType)).toBe(true);
  });
});
```

  (The image `![img](…/img.png)` is an external image, so the production file draws its placeholder and makes no request. The heading carries `</title>`, so a title written as raw HTML would close the element early: row W5X-T11-M2 is that mutation.)
- [ ] **Step 2: Run it.** `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-export.browser.test.ts )` through `ccrc test` — Expected: `Tests  9 passed (9)`. A CONTROL that stays red (nothing reached B even without the meta) is a stop-and-ask: the detector is blind and every other row means nothing.
- [ ] **Step 3: Measure the rows' red** (below). Then run `( cd pwa && ./node_modules/.bin/vitest run test/browser-leg.test.ts )` — green (the new file matches the browser config's include and the hermetic run excludes it).
- [ ] **Step 4: The W5 measurements** (§4.17; recorded in the SDD ledger now, in `## Export results` at Task 13; not committed as tests).
  - **The builder chunk and `?raw` in the production build.** Build once into a temporary directory (`( cd pwa && node node_modules/vite/bin/vite.js build --outDir "$(mktemp -d)/dist" )`, or the `BUILDER` snippet `markdown-worker-built.test.ts` uses), then record: the name and size of the chunk holding `buildExport` (the one emitted `.js` file containing `ccrc-docs-export/1`); that it contains `.ccrc-export-draft` and `.msg-assist` (the stylesheet's text arrived through `?raw`), no `@font-face`, and none of `require("stream")`, `require("util")`, `"node:` (the browser build of `react-dom/server`, refinement (o)); that `sw.js` lists it (the precache). Remove the directory.
  - **The build's main-thread time on desktop Chromium**, at `DOCS_MAX_RENDER_ELEMENTS` and at a 10 MiB output, with the page's highlight store settled. Write a throwaway file `pwa/browser/zz-export-measure.browser.test.ts` (never staged; deleted after) on `browser/app.ts`'s `buildDist`/`serveDist`/`openApp`, answering `/api/docs/demo/tree` and `/api/docs/demo/file` from a fixture as `reader-frame.browser.test.ts`'s `/api/docs/` route does: (a) a Markdown doc whose parse counts about `DOCS_MAX_RENDER_ELEMENTS` elements (a list of short items), (b) a doc with one image whose bytes take the file near 10 MiB. For each, open the leaf, take Export (plain view) if the reader shows, wait for Export, then time the tap on Export to the Save button's appearance three times (median), and the same tap with the builder chunk already loaded. Record the medians and `DOCS_PARSE_BUDGET_MS` for each doc's bytes. A median over that budget is the merge gate's operator finding (§7.7): the worker sends it as a structured ask with the numbers, and the run continues.
  - **The plain-view switch (refinement (a)), a check after the run of the option Q1 ruled; it is not an input to Q1.** Doc (a) has no code block and no image, so it would time the parse alone. Add doc (c) to the same throwaway file, built to cost what the switch can cost: about 480 KiB of Markdown (under `DOCS_RENDER_GATE_BYTES`, so no gate, and a `DOCS_PARSE_BUDGET_MS` near its 10 s cap), with fenced blocks in `bash`, `ts`, `json` and `yaml` whose code totals about 400 KiB (under `DOCS_HIGHLIGHT_PAGE_MAX_CHARS`, so the input ceiling skips none), and `DOCS_MAX_IMAGES_PER_PAGE` distinct committed PNGs (`img-<k>.png`, each served by the fixture's `/api/docs/demo/file` route, as `reader-frame.browser.test.ts` serves `pix.png`). Open it with the reader showing, tap `Export (plain view)`, and record three spans, median of three runs each: to `.doc-body` mounted (the parse), to every image loaded, and to Export enabled (the store settled). Run it again under CDP's `Emulation.setCPUThrottlingRate` at 4 as a phone proxy, recorded as a proxy. If Export is not enabled within the doc's `DOCS_PARSE_BUDGET_MS` plus `HIGHLIGHT_PAGE_WORKER_MS`, report it to the coordinator with the numbers; the run continues. A phone's figure is W6's phone pass.
- [ ] **Step 5: Commit.** Confirm `git status --porcelain` lists no `zz-export-measure` file. `git add pwa/browser/docs-export.browser.test.ts` (expect 1), message `docs: the hostile export opened top-level, three builds and a control (M5.B9) (docs W5 Export)`, trailer. Record the JSON row fence and the measurements.

**Mutation rows this task contributes** (run with the browser config, `CCRC_CHROME` set):

| id | spec | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|---|
| W5X-T11-M1 | M5.B9 | pwa | `browser/docs-export.browser.test.ts` | `  const csp = meta ? \`<meta http-equiv="Content-Security-Policy" content="${DOCS_EXPORT_CSP}">\` : '';` → `  const csp = '';` | `browser/docs-export.browser.test.ts` | 2 failed — both `'meta only (a string page under the meta), opened from %s: …'` cases |
| W5X-T11-M2 | M5.B9 | pwa | `src/docs/export/buildExport.tsx` | `        <title>{input.title}</title>` → `        <title dangerouslySetInnerHTML={{ __html: input.title }} />` | `browser/docs-export.browser.test.ts` | 3+ failed — `'the production file holds none of the corpus as an element …'` and both production cases (the title's raw `</title><meta http-equiv=refresh>` becomes a refresh to B); `docs-export.test.tsx`'s hostile case and `docs-scans.test.ts`' sink cases red too |

**Verify:** the browser file, 9 passed; `browser-leg.test.ts` green; the measurements recorded.

### Task 12: Whole-branch review (held out), its fixes, and `## Deviations found`

**Model routing:** reviewers `opus`, five lenses; one `sonnet` refute pass per finding; fixes by `sonnet` implementers, each reviewed by `opus`.

- [ ] **Step 1:** Five `opus` lenses over `BASE..HEAD` against this plan and the spec, the lenses of "How this wave runs": (1) what the file can do (inert by construction, the CSP and its order, every URL-bearing attribute, the stylesheet's text, the scans and their controls, M5.B9's three builds and its control); (2) what the file says (the provenance against the page, the banner, the closed labels and words, no path or session id, the drafts table, the colouring classes and their counting, the images not included); (3) when Export is offered and what it reads (the publications and their withdrawal, the store hand-off and the nested context's stability, the text and the pin it answers, the reader path, the raster and SVG leaves, the sheet's key); (4) the save (two phases, the synchronous Save, octet-stream only, the lazy chunk and its two failures, the size order and its prefix rule); (5) the test and mutation table, the census standing (contrast, control, markup, literal, shape, tap targets), rings, the measurements, spec and deviation fidelity (each refinement against the spec text; the departing ones (a), (b), (c), (e), (f), (g), (h) and (w) each numbered once), plus the public-repo scan of every changed file.
- [ ] **Step 2:** Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix. A fix that moves a row's measured red restates that row (it takes no number).
- [ ] **Step 3: Define the deviations.** Replace `## Deviations found`'s placeholder line with the issued numbers: the first eight go to the departing refinements (a), (b), (c), (e), (f), (g), (h) and (w), in that order, then any departure found while executing, in the order found. Entry form: `- **D-<n> (<date>)** — <slug> (refinement (<letter>)). <what departs from which spec sentence, and why>. <Task and rows that apply it>.` Numbers issued and not used are written WITHOUT their prefix ("Issued and unused: 7xxx to 7yyy"), so no unissued token raises the floor. Then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green (the guard reads tracked files only: commit first, then run); `grep -c '^- \*\*D-[0-9]* (' <plan>` equals the number defined; `sed -n '/^## Deviations found/,/^## /p' <plan> | grep -nE 'D-<n|<date>|D-TBD-[a-z0-9]'` prints nothing. Commit `docs: Export's deviations, as issued (docs W5 Export)`.

### Task 13: Close — suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus), with `sonnet` subagents for the runs.

- [ ] **Step 1: Suites**, each in the foreground through `ccrc test`, split to fit:
  - the `pwa` suite in pieces, and `TSC-OK`; `contrast.test.ts` alone;
  - the browser files locally (a fast PR skips `browser (pwa)`; it first runs in the merge queue): `browser/docs-export.browser.test.ts`, `browser/reader-frame.browser.test.ts`, `browser/docs-headers.browser.test.ts`;
  - `git fetch -q origin main`, then the WHOLE `server` suite in pieces (not a list: the PR's CI selection runs suites a list misses, other programmes' closed word censuses among them), `typecheck-tests` alone; a red census in a file outside this wave's Scope is a stop-and-ask to the coordinator (the Scope exception), never a silent edit;
  - re-run any known load flake alone before calling it broken.
- [ ] **Step 2: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row. A row whose measured red exceeds its stated red because a later task's or a fix's test also reds is reported to the coordinator with the extra names and restated as measured; a row that stays green is a stop-and-ask.
- [ ] **Step 3: Draft `## Export results`** in this plan in the working tree: the counts per suite; every task's JSON row fence as measured; the measurements (React's head order, its `<style>` text and its doctype, Task 5; `?raw` under vitest and in the build, Tasks 2 and 11; the builder chunk's name and size; the build's medians against the parse budget, Task 11); "Named, without a number" (choices that filled a silence while executing); "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-w5-export/pr-body.md` (gitignored): title `Docs W5: Export`; what ships; the departing refinements with their issued numbers; the reader path (refinement (a)) in one plain sentence; the measurements; the expected CI (the PR's selection, a full run if `ui/package.json`'s change triggers it; `browser (pwa)` gates in the merge queue); the plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives.
- [ ] **Step 4: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan) and the drafted PR body: rc 0, zero hits. A hit is fixed and the scan re-run before Step 5. Remove `$HOME/.cc-tmp/w5x-mut/`.
- [ ] **Step 5: Commit the results, last.** Stage this plan by name, message `docs: Export's results (docs W5 Export)`, trailer. This commit is the `handoffCommit` and the branch tip.
- [ ] **Step 6: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 7:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Issued at the run's opening; the first eight go to the departing refinements (a), (b), (c), (e), (f), (g), (h) and (w), in that order, then the departures found while executing, in the order found. (Task 12 Step 3 replaces this line.)

## Where things stand

### Agreed
- Export as §4.17 rules it, for Markdown, text and image leaves: one self-contained HTML file built as React, never as strings; the CSP meta first; the exporter's theme (decision 12; how far it reaches is Q3); the provenance and, for a draft, the banner first; images from memory only, waiting at most 10 s; 10 MiB, the body never cut; Save in its own tap, octet-stream only (the operator's twelve decisions of 2026-10-13, the drafts ruling of 2026-10-07).
- Colouring from the page's highlight store by peek only, waiting for it to settle within the page ceilings, counted by class in the provenance (the operator's rulings of 2026-10-15 and the coordinator's of that day); Export waits for W5h-a and Share, not for W5h-b (2026-10-15).
- M4.SH3's and M4.SH8's Export halves are Export's (2026-11-02); Share's seam takes Export's availability.
- The W5h-a hand-off: Export holds the `publish` slot (D-7755), reads each drawn copy through `copySkip` (D-7762), and treats a body with no store as plain (D-7763).
- The operator's answers of 2026-11-03 ("approved with recommendations"): Q1 A, "Export (plain view)" switches the page to the plain view and exports it; Q2, no build version for now; Q3, the exporter's palette, any of the twelve; Q4, Export shown disabled, reading "Image not loaded"; Q5, one `exports` line in `ui/package.json`; Q6, one run. The departing refinements stay plan-only.

### Waiting on you
- After the run, if Task 11 measures a build over the parse budget: what to do about it.

### Answered by the operator (2026-11-03)
- The plan was approved, and every question answered with its recommendation ("approved with recommendations"). The questions as asked:
  - **Q1, the reader path (refinement (a)).** At BASE the reader frame shows Markdown leaves wherever a `Worker` exists, and while it shows one there is nothing plain to export. Three options, each costed the same way:
    - **A, recommended: "Export (plain view)".** The tap switches that page to the plain view, and Export then saves it. Work: once per page, at the first tap, one parse, one highlight pass over the page's blocks and one docs file read per image the plain view shows. The exporter sees the plain view replace the rich view (no rich layout, no Mermaid drawings) until the page changes, taps once more, and waits through Formatting… and Highlighting… as on any plain page; at Save the screen shows what the file holds. Code: one state, one holder and its effect, two words.
    - **B, no Export while the reader shows.** Work: none. The exporter has no Markdown export on any browser with a `Worker`, which is every current one: only text leaves, images and the Markdown leaves the reader fell back on export. Code: one state.
    - **C, a hidden plain pipeline on the tap.** Work: the same parse, highlight pass and image reads as A, at every tap unless the hidden result is kept. The rich view stays on screen and the file differs from it, and the wait reads Formatting… and Highlighting… for a view nobody sees. Code: a second body mounted off screen, with its own publications, store and image registry, and their tests.
    - Why A: A and C do the same work; A reuses the plain view's own body, store and registry and saves what the screen shows, where C adds a second pipeline that saves what the screen does not show. B does no work, but in practice removes Markdown export until a later wave exports the reader's own rendering. A and C depart from §4.17's "Export makes no docs request" and Figure 2's "no re-parse, no highlighting"; all three need a reader case that §4.17's "When it is offered" does not have.
    - What is known now, and what comes later: A's switch is the work of opening that page in the plain view, one parse, one highlight pass and one read per image, within the same limits (`DOCS_PARSE_BUDGET_MS`, the page highlight ceilings, `DOCS_MAX_IMAGES_PER_PAGE`); a browser without a `Worker` does exactly this on every open of a Markdown page today. No timing of the switch exists before the run. Task 11 times it after the run on a doc built to cost the most (code near the page's highlight limit, the most images a page may load), on desktop Chromium and a 4x CPU-throttled proxy, as a check of the answer given here; W6's phone pass times it on a phone.
  - **Q2, the build version (refinement (f)).** Recommended: leave it out now; the `generator` meta carries the format's version. Adding it needs a build-time stamp in `vite.config.ts`, a change outside Export.
  - **Q3, the palette (refinement (e)).** Recommended: the export pins the exporter's palette, any of the twelve, as decision 12 says of "the theme".
  - **Q4, a raster image that failed (refinement (j)).** Recommended: Export shown but disabled, reading "Image not loaded"; the alternative is no Export at all on that leaf.
  - **Q5, prose.css's subpath (refinement (d)).** Recommended: one `exports` line in `ui/package.json`; the alternative is a relative import of ui's source from pwa.
  - **Q6, one run or two.** Recommended: one run. If two, the split is after Task 5: the first run lands the words, the stylesheet, the provenance, the registry and the builder (nothing a user sees); the second the publications, the sheet, the header, the chrome, the scans and the browser leg.

### Later
- W6: mockup Export (§5.6.9), M4.EX16's frame allowance, `html-source`'s "Export makes a viewable copy", the phone pass (`export-share-file`, and the plain-view switch's time on a phone, refinement (a)).
- W5b: Export's rows re-derived for version views (`at=<sha>`).
- W8b, or a later wave: an export of the reader's own rendering (the rich-docs spec's "no-JS static variant"), which would retire refinement (a).
- W7: README's Export prose (§7.5), refinements included.
- A build version in the provenance, if the operator wants one (refinement (f)).
