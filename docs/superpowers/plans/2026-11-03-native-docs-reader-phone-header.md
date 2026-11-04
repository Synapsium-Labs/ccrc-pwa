# Native Docs reader, compact phone header (one console row) — Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 2 (2026-11-03), drafted for the coordinator; reviewed by three lenses with a refuter per finding (round 1); approved by the operator on 2026-11-04 with every recommendation (console item 13; see "Where things stand"). Base: `main` after Export (#2237) merges. Every Find block below is quoted from one of two commits, named on the block itself: Export's tip `5fcc4268ac3c3a59959ee8b3cd9ce91e914707bb` (PR #2237, branch `ws/docs-reader-export`) for every file Export changes, and `origin/main` at `94bdcf45485c9cea22ce0563ef07a90a19fe9197` (2026-11-03) for every other file (the table under Global Constraints). `main` has not touched any Export-changed file this wave edits since the two branched (measured: `git diff a3c319d44 94bdcf454` is empty for all six), so after the merge they read as at `5fcc4268a`. Export is still in review and may change, so **Task 1 Step 0 re-checks every Find block against the dispatch base** with one script, and any miss is a stop-and-ask. It replaces nothing.

**Revisions:** rev 3 (2026-11-04): the operator's approval is recorded, and one Find block is re-quoted. Export's review added a case after the old anchor of the floor-half block in `pwa/test/tap-targets.test.tsx`, so that block now anchors on the end of Export's Retry case, quoted from `b55e96a75`, Export's merge on `main`. The find-check, run by the coordinator against `main` at `707eae764`, counts 22 blocks and no miss. rev 2 (2026-11-03) applies review round 1 (sixteen findings upheld): the draft badge is drawn beside the ellipsised first line, never in it, with a 412 px long-branch case (spec-intent F1); the compact head keeps the crumbs while the tree slot is not `ok`, so §4.7 holds (F2); Share's waiting icon is named "Share: …" (F3); §4.17's "When it is offered" words and the "Export (plain view)" label join (e)'s departure and Q1, and Task 4 pins each word (F4); the row names the served ref for every default view that is not origin/HEAD (F5); the picked mockup's 1 px divider is kept inside the 44 px row, never-fetched and failed share its attention colour, and the parent-crumb label is named as a departure from the mockup (F6); the failed name is the neutral "Page details (freshness problem)" (F7); Q3 states the landscape cost and a 915 x 412 case records it (F8); Task 3's comment no longer spells the width constant, so Task 4 Step 0 can pass (executability F1); Task 2 keeps npm's cache and the tarball in the scratch directory it removes and extracts only the files the generator reads, with measured sizes (executability F2); the tap-targets render half waits for Share (executability F3, tests-guards F2); the disabled icon's fade is registered in `OPACITY_REGISTRY` (tests-guards F1); twelve mutation rows added, two predictions restated, and the "Formatting…" selector chain pinned against the live DOM (tests-guards F3 to F5). Find blocks: 22.

**Scope:**
- In: on a leaf page under 600 CSS px, `DocsHead` draws one row (back, a two-line label naming where and what, Share and Export as icons, Page details) and, under it, a Page details panel that holds the crumbs, the truth line, View on GitHub and Open committed version; while the tree slot is not `ok`, back and the crumbs, as today; the picked mockup's 1 px divider inside the row's 44 px; the Docs screen gives that row the top (no padding above it, 4 px under it); "Formatting…" lies over the reader's host on that screen instead of taking a line; three lucide icons vendored for it; five words in `docsText.ts`; the tests (jsdom behaviour, the stylesheet's declarations, both tap-target halves, the control census entry, two contrast grounds and one registered fade, and a browser test that measures the pixels above the title at the operator's phone's viewport).
- Out: option 2 (one bar merged with the reader frame's own, which needs hooks and a release of the shared reader library) and option 3 (a header that scrolls away); any change to the shared reader library, its pin, its bridge or its frame's own bar; the index, project, section and directory pages at any width; every page at 600 CSS px and wider (tablets and desktops); the banners, their order and their words; the share and export sheets; `DocsScreen.tsx` and `ReaderFrame.tsx`; the spec text (question Q1); the server, the agent, `ccd` and `shared/`.
- Byte-identical: `pwa/src/screens/DocsScreen.tsx`, `pwa/src/docs/ReaderFrame.tsx`, every other file under `pwa/src/docs/` (`DocsLeaf.tsx`, `DocsBanners.tsx`, `ShareSheet.tsx`, `ExportSheet.tsx`, `export/**`, `reader/**` and the rest), `pwa/src/app.tsx`, `pwa/src/skins/**`, `pwa/src/styles/**`, every file under `ui/src/` but `ui/src/icons/lucide.ts`, `ui/package.json`, `pwa/package.json`, both lockfiles, `pwa/vite.config.ts`, `pwa/vitest.browser.config.ts`, `pwa/browser/app.ts`, `pwa/browser/harness.ts`, `pwa/browser/slowFirst.ts`, `pwa/browser/reader-frame.browser.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/contrast.test.ts`, `pwa/test/docs-screen.test.tsx`, `pwa/test/docs-truth.test.tsx`, `pwa/test/shell-css.test.ts`, `pwa/test/setup.ts`, `pwa/design/contrast-check.mjs`, `shared/**`, `server/**`, `agent/**`, `ccd/**`, `deploy/**`, `.github/**`, `README.md`, the specs and the ledger. Any other file is a stop-and-ask.

**Goal:** On the operator's phone (a Pixel 10 Pro XL in Chrome on Android 17, CSS viewport about 412 x 915) about 341 px sat above a reader doc's title, and 256 of them, the console's own head, never scrolled away. After this wave the console's part is one 44 px row and a 4 px gap, and the title sits at most 133 px down (the figure of the mockup the operator picked), measured in a real Chromium at 412 x 915. Nothing the page says about what it served is lost: it is one tap away, and the row itself still says when the page is a ref view or a draft.

**Architecture:** One switch, `headLayoutFor(compactWidth, page)` in `pwa/src/docs/DocsHead.tsx`, decides the header: `compact` on a leaf page while `DOCS_COMPACT_QUERY` (`(max-width: 599.98px)`) matches, `full` everywhere else. The full header's DOM is unchanged. The compact head (`CompactHead`, `CompactRow`, `CompactLabel`) reuses the header's own parts: `BackButton` (the back control, now one function both headers call), `ShareAction` and `ExportAction` with a `glyph` prop (an icon, its words as the accessible name; same element, class, key and sheet), `Crumbs` with an `unfold` prop, `TruthLine` and `GithubAction` unchanged, and one hook, `useHeadActions`, that works out Share's, Export's and the two links' states for either header. Page details is a disclosure (`aria-expanded`, `aria-controls`, a `role="region"` panel in the page's flow, `hidden` while closed, Escape closes it and returns focus). `docs.css` keys every new rule on the compact head's own classes, never on a width, so the component is the only place the width is decided.

**Tech Stack:** TypeScript (pwa's own `tsc`, strict, `noUnusedLocals`), React 19 (`useId`), vitest on jsdom (`@testing-library/react`, `jest-dom`), the browser leg (`vitest.browser.config.ts`, `playwright-core` driving Chromium over the run's one production build), `@ccrc/ui`'s `Icon` over vendored lucide nodes (`ui/design/make-icons.mjs`).

**Ruling:** the operator's pick of 2026-11-03 among the three static mockups on the branch `brainstorm/docs-phone-header` (commit `7c82a11f2`): **option 1, one console row** (`docs/superpowers/specs/2026-11-03-docs-phone-header-one-line-prototype.html` there; about 133 px above the title, a ccrc-only change), to build now. Option 2 (`...-merge-bars-prototype.html`, about 81 px, one bar merged with the reader frame's) is wanted later, with a library release; this plan names under Later what option 2 needs from option 1's structure and keeps it open. Option 3 (`...-scroll-away-prototype.html`) was not picked.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md` (Decisions, 2026-11-03 (late), "The phone header"; the operator's pick is recorded by the coordinator's ledger PR with this plan).

**Format:** Markdown. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans; Task 1's find-check reads this file's `Find (...)` blocks, and Task 6's tools parse its `### Task` headings and the JSON row fences each task records.

**What the base says (each checked at BASE, each handled below):**
- **On a phone nothing of the console draws above the Docs screen.** `pwa/src/skins/frame.tsx#ShellFrame` renders the bar, the banners, the rail and the status bar only at the desk width (`useMediaQuery(DESK_QUERY)`), the skip link is visually hidden, the phone nav sits at the bottom, and `pwa/src/styles/shell.css` hides `.shell-nav` on a session view under 900 px; `AuthResumeInDetail` draws only while a sign-in waits. So the "console app bar" above a Docs page on a phone is the Docs head itself (read, not rendered: Task 1 measures `.docs-screen`'s top at 0).
- **Today's phone head** (`DocsHead`): `.docs-head-bar` (back, then the crumbs with all but the last two behind a leading `…` button under 900 px), the truth line (`TruthLine`: served ref, short commit with copy commit, how the ref was chosen, a leaf's source, badge and size, the freshness chip), the actions (`Actions`: View on GitHub, Share, Export, Open committed version), the plain-view note, and "Updated to <short>". `.docs-screen` pads `--sp-2` (8 px) and gaps `--sp-3` (12 px) (`docs.css`). The mockup's map, read from CSS and not rendered: 8 + 70 + 8 + 106 + 8 + 44 + 12 = 256 px of console, then 85 px inside the reader frame (its body margin 8, its own bar 48, the gap 29) = 341. Task 1 measures both parts.
- **Box-sizing is border-box everywhere** (`ui/src/styles/reset.css`), so a border inside a box given `block-size: var(--tap-min)` adds no height, as in the picked mockup (`.onerow{height:44px; border-bottom:1px solid …}` under `*{box-sizing:border-box}`).
- **The default view's served ref** comes from `ccd/ccd#default_chain`: origin/HEAD (`via` `default:origin-head`), then origin's main and master, then local main and master. A dangling origin/HEAD is recorded in `tried` and the chain goes on, so its `via` is the next rung's, never `default:origin-head`.
- **The head is pinned only on a reader page.** `docs.css`'s §4.1 block makes a page that holds `.docs-reader` one pane tall: the shell, the pane, the screen and the leaf are flex columns and only the frame scrolls. Every other Docs page scrolls the pane, so its head scrolls away.
- **Export, as at `5fcc4268a`:** `ExportAction` follows `ShareAction` inside `Actions`, keyed by `exportKeyOf` (an `export` prefix keeps it from equalling Share's key), reads "Export (plain view)" on a page the reader shows, and its tap turns the reader off on that page (`DocsScreen`'s `plainAt`), after which `exportPlainShown` shows under the actions. Its accessible name is "Export: <words>" only while it waits.
- **jsdom renders the full header today, and keeps doing so.** `pwa/test/setup.ts` stubs `matchMedia` to answer `false` to every query, so every existing jsdom suite sees `DOCS_COMPACT_QUERY` unmatched. The suites that stub a width (`refined-phone.test.tsx#atWidth`) render `DocsHead` on a leaf at 390 only with `tree: null` and read `.docs-back`, which the compact head keeps. `docs-truth.test.tsx` stubs only the desk query.
- **The width is owned elsewhere.** `DESK_QUERY` (`(min-width: 900px)`) is `@ccrc/ui`'s; `shell-css.test.ts` requires `useMediaQuery(DESK_QUERY)` in `docs/DocsHead.tsx` (`Crumbs` keeps it) and `sheet-desktop-arm.test.tsx` forbids a second `(min-width: 900px)` literal. `docs.css` has one `max-width` block, the reader layout's `(max-width: 899.98px)`.
- **The censuses this wave meets.** `control-census.test.ts` keys a control by file, tag and literal class (`docs/DocsHead.tsx <button> docs-back` and the rest) and checks a TOKEN claim against the stylesheets; `tap-targets.test.tsx` holds both halves for each Docs control (the rule's `min-height: var(--tap-min)` and a rendered element with the class) and refuses a literal `44px`; `contrast.test.ts` measures every `docs.css` rule that sets `color`, on the ground it paints or on one registered in `design/audit.mjs`'s `INHERITED_GROUNDS` (`under: ['var(--bg-page)']`, a `why` over 40 characters), grandfathers none and exempts none, and lists every static `opacity` between 0 and 1 as a fade that must be registered in `OPACITY_REGISTRY` (key `<selector> <value>`, exactly one of `pairs` or `noText`), one `it.each` case per fade (`.bell:disabled 0.35` is the precedent); `shape-census.test.ts` does not read `docs.css` (its `SHEETS`); `markup-census.test.ts` reads JSX blocks, two-word class literals and leaves with two attributes; `docs-scans.test.ts` clause 1 reads every file under `pwa/src/docs` for a draft `state` read, and its M4.SH7 clause reads `DocsHead.tsx` for a share or clipboard door; `server/test/docs-parity.test.ts` M7.9 forbids the shared reader library's name anywhere in `pwa/src`.
- **Icons.** `@ccrc/ui`'s `Icon` draws vendored lucide nodes from `ui/src/icons/lucide.ts`, generated by `ui/design/make-icons.mjs` from lucide-static 1.59.0 (`npm pack` into a scratch directory, per the script's header), reading only `<from>/<name>.svg` for each name in `NAMES` (27 today); `share`, `download` and an ellipsis are not vendored. Measured on the registry while planning: the 1.59.0 tarball is 6,972,252 bytes and unpacks to 51,939,501 bytes in 5,970 files; the three SVGs exist there, each under 400 bytes, made of `path` or `circle` nodes the generator accepts. `pwa/test/icon.test.tsx` holds the closed tag set, the geometric attrs and named icons per feature.
- **The browser leg.** `pwa/browser/*.browser.test.*` under `vitest.browser.config.ts`; the run builds the production PWA once (`browser/globalSetup.ts`) and every file serves it (`browser/app.ts#sharedDist`; `browser-dist.test.ts` pins `dist = sharedDist();` followed by `server = await serveDist(dist);`). `openApp` gives a touch context under 900 px; `reader-frame.browser.test.ts#openSession` answers `/api/docs` from fixtures with `DOCS_RESPONSE_HEADERS`, and reads the frame through `elementHandle().contentFrame()`. A pull request skips the leg; the merge queue runs it.
- **Overlap.** `pwa/test/contrast.test.ts` changed on both `main` and Export; this wave leaves it byte-identical. The W5h-b plan, dispatched after Export too, edits `pwa/src/docs/docsText.ts` only around its `'part1-bounds'` entry, a hunk apart from this wave's (the `exportPlainShown` line), and `pwa/test/docs-scans.test.ts`, which this wave leaves byte-identical.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). No test reaches a network or a real server: the browser file serves the run's own build from loopback and answers `/api` from fixtures.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); this wave changes no lock and no `package.json`. The transient directories are the tests' `mkdtemp` trees, the browser leg's one build per run, and Task 2's scratch directory `$HOME/.cc-tmp/phh-icons/`: the 6,972,252-byte lucide-static tarball, npm's cached copy of it (`--cache` points inside the directory), and about 30 extracted SVG files of under 0.5 KB each (only the files the generator reads; the whole package would unpack to about 52 MB in 5,970 files), about 14 MB in all, removed with the cache in Task 2 Step 6. Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/phh-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` (`timeout -k 10 900` for a browser row, which rebuilds) and `ulimit -u 4096`. `$HOME/.cc-tmp/phh-mut/` is removed at Task 6.
- **Scope.** As the header's Scope says: this wave creates `pwa/test/docs-compact-css.test.ts`, `pwa/test/docs-compact-head.test.tsx` and `pwa/browser/docs-compact-head.browser.test.ts`; it edits `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docsText.ts` (one hunk), `pwa/src/docs/docs.css` (one block), `pwa/design/audit.mjs` (three entries: two grounds and one fade), `pwa/test/tap-targets.test.tsx` (one loop line, one import, two describes), `pwa/test/control-census.test.ts` (one entry), `pwa/test/icon.test.tsx` (one case), `ui/design/make-icons.mjs` (three names) and `ui/src/icons/lucide.ts` (regenerated, three icons added), and this plan (Task 6 defines `## Deviations found` and appends `## Results`). One allowed exception, claimed first: if the CI selection or Task 6's whole runs red a census in another programme's file that this wave's new words, classes or files trip, the worker stops and asks the coordinator, who rules on that file.
- **Base.** The child workspace is minted from `main` after Export (#2237) merged. Task 1 Step 0 runs a **content** check (`T1-BASE-OK`) and the find-check (`FINDS-OK`), not an ancestry check, and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-03-native-docs-reader-phone-header/progress.md`.
- **Which commit each Find block is quoted from.**

| File | Quoted from | Why |
|---|---|---|
| `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docsText.ts`, `pwa/src/docs/docs.css`, `pwa/design/audit.mjs`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts` | `5fcc4268a` (Export's tip) | Export changes each; `main` has not touched them since the two branched |
| `ui/design/make-icons.mjs`, `pwa/test/icon.test.tsx` | `94bdcf454` (`origin/main`) | Export changes neither |
| `pwa/test/tap-targets.test.tsx`, the floor-half block only (Task 3 Step 1) | `b55e96a75` (Export's merge on `main`) | Export's review added a case after its old anchor (rev 3) |

- **Rings and seams.** `DocsHead.tsx` stays ring L4 delivery: it decides the layout with one pure function (`headLayoutFor`) and one pure mapping (`freshDot`), and renders; it starts no request (the chip's tap is still `visit.refreshManual`). No overloaded `null` at a seam: `FreshDot`'s `null` has one meaning (no dot), `HeadActions.target`'s and `committedHref`'s each one (not offered). `Icon` is decoration (`aria-hidden`), so every icon's meaning is its button's accessible name.
- **Exact values.** `DOCS_COMPACT_QUERY = '(max-width: 599.98px)'` (declared once, in `DocsHead.tsx`); the row's border box 44 px tall (`block-size: var(--tap-min)`) with a 1 px `--edge-subtle` divider inside it; the screen's `padding-top: 0` and `gap: var(--sp-1)` (4 px) when it holds the compact head; icons `share` (Share), `download` (Export), `ellipsis` (Page details) at size 20; a disabled row icon `opacity: 0.35`; the dot `var(--sp-2)` square at `--sp-2` from the button's top and end, `--status-done` (ok), `--status-attention` (never fetched, and failed); the five words `exportPlainHint`, `shareBusy` ("Share: {state}"), `more` ("Page details"), `moreNever` ("Page details (never fetched)"), `moreFailed` ("Page details (freshness problem)") (Task 4); the fade's registry key `.docs-compact-bar .docs-action:disabled 0.35`; the browser file's `PHONE` 412 x 915, `PHONE_TITLE_MAX` 133, `CONSOLE_PART_MAX` 48, `TAP` 44, `LONG_BRANCH` `ws/a-long-workspace-branch-for-the-phone-header`.
- **Never spelled by this wave:** the shared reader library's package name or directory name, anywhere in `pwa/src` (docs-parity M7.9) or in this plan; a literal colour in `docs.css` or any new or edited pwa file (`contrast.test.ts`); `44px` in a size declaration (`tap-targets.test.tsx`); `(min-width: 900px)` in TypeScript (`sheet-desktop-arm.test.tsx`); `599.98` anywhere under `pwa/src` but `docs/DocsHead.tsx` (Task 4's census case); a numeric line citation (`file.ts` + colon + line) in any code or test file (`citations.test.ts`; cite `file#symbol`); a `D-` number outside `## Deviations found`; a placeholder deviation token in any commit (`server/test/dtbd.test.ts`); real host, user, project, account or path names (fixtures use `demo`, `specs`, `example-org/example-repo`).
- **PUBLIC REPO.** This repository is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 6 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block is quoted from the commit it names and must match exactly once; the find-check (Task 1 Step 0) counts every one at the dispatch base, and the `Edit` tool refuses a miss. Apply a task's blocks in the order written: each was checked to match once at BASE and still once after the blocks before it. A block absent or matching twice is a stop-and-ask. Cite code by `file#symbol`, never by line number.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and **one JSON fence** (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`), which the worker records in the SDD ledger at the task's last step as measured; Task 6 copies every fence into `## Results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `PHH-T<n>-M<k>`; `spec` carries the refinement letter the row guards. `pkg` is the package the tests run in and `file` is relative to it. A row's `old` and `new` quote the file's own text from its first non-blank character; an empty `new` deletes the line. **Every count in this plan (a row's red, a file's case count, a figure in px) is a prediction.** A row whose measured red differs from its stated red is reported to the coordinator with the extra test names; the coordinator restates it, which takes no number. A row that stays green is a stop-and-ask.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; the browser file `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, `contrast.test.ts`, every browser file, every mutation run) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `typecheck-tests`, `session-hook`, `ccd-*`, `contrast.test.ts`' spawned-gate cases. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` (its program includes `test/` and `browser/`) and `( cd ui && ./node_modules/.bin/tsc --noEmit && echo UI-TSC-OK )`.
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter. Three refinements depart from a spec sentence: (c), (d) and (e) (each says which). Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 6 defines them in `## Deviations found`, in the order (c), (d), (e), then any found while executing. An issued number that goes unused is written without its prefix ("Issued and unused: 7xxx to 7yyy"). A session that cannot reach the allocator says so in its report (worker clause 11) and writes no placeholder token in any commit.
- **Commits.** One per task (review fixes one per finding), files staged by name, message `<area>: <what> (docs phone header)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Task 1 commits nothing: its browser file stays untracked until Task 5 commits it green. Only Task 6 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR, which records it in the ledger's Plans line with the operator's pick of 2026-11-03 and the operator's answers to Q1 to Q3 below.
- **After Export.** The run is dispatched only after Export (#2237) has merged: Export edits the same header, its stylesheet and its tests. If Export's review changed any file this plan quotes, Task 1 Step 0's find-check names the miss and the coordinator re-quotes the block (a restatement, no number) before the worker goes on.
- **The run row and the issued block.** The coordinator opens one run row (`planned`) and is issued a contiguous block by `POST /api/ledger/deviations` at run-open: three for refinements (c), (d) and (e), and three in reserve for departures found while executing and in a fix round. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the merge of #2237.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docsText.ts`, `pwa/src/docs/docs.css`, `pwa/design/audit.mjs`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts`, `pwa/test/icon.test.tsx`, `ui/design/make-icons.mjs`, `ui/src/icons/lucide.ts`. W5h-b, if it runs at the same time, holds `docsText.ts` for a hunk apart from this wave's; where a live claim of another run covers a file this wave edits, the brief names the coordinator's scoped agreement for it. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-6, the base (the merge commit of #2237), the issued block, the claim state, `CCRC_CHROME` (Tasks 1 and 5 run browser files locally), and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers at `medium` effort; per-task reviewers `opus` on Tasks 1, 4 and 5 (the measurement, the head's truth and accessibility, the measured figure) and `sonnet` on Tasks 2 and 3; Task 6's held-out whole-branch pass on three `opus` lenses and one `sonnet` lens, with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill, any `gh` write verb, any token in an argv, and approval-prompting shell forms.
- **Worker flow:** the worker acks, runs Tasks 1-5 with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalation: Task 1 Step 4's BASE conditions (each a stop-and-ask, before any code changes); a Find block that misses; a measured red outside its row's prediction, reported; a row that stays green, a stop-and-ask; a tablet or desktop figure in Task 5 that moved from BASE by more than 1 px, a stop-and-ask. Task 6 closes: the review and its fixes, the suites, the whole mutation table, `## Results` (that commit is the `handoffCommit` and the tip), push, the ONE pull request, the fingerprint with that PR's number and `prPhase: 'open'`, and the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming four lenses: (1) the page's truth (goal 4 and refinements (d) and (g): what the row keeps, what the panel holds, the banners and notes left in the flow, the badge's single source); (2) accessibility and interaction (names, order, `aria-expanded`/`aria-controls`, Escape and focus, the panel's `hidden`, tap targets in the real engine, the dot's meaning in the name); (3) layout and the measurement (the switch, the 600 boundary, desktop and tablet unchanged, the CSS keyed on classes, "Formatting…", the browser file's validity, Task 1's and Task 5's figures); (4) the tests and the mutation table, the censuses (`control-census`, `tap-targets`, `contrast`, `markup-census`, `docs-scans`, `docs-parity`, `icon`), and the public-repo scan.
- **Merge gate:** the operator's approval of this plan with Q1 to Q3 answered; every row red as measured; the browser figure at 412 x 915 at or under 133 px and the console's part at or under 48 px, recorded in `## Results` beside the BASE figures; the tablet, desktop and sideways (915 x 412) figures within 1 px of BASE; the long-branch draft's badge whole inside the label; the reviewer's report accepted by the coordinator; the PR's required checks green, and `browser (pwa)` green in the merge queue (a fast PR skips it).
- **After the merge, NOT in this wave:** the merge becomes a prerelease; the operator moves the fleet (the console's update tap, or `ccrc rollout --to vX.Y.Z`) and re-opens a spec on the phone. The device figure is the operator's: Chrome's own address bar and Android's status bar sit outside the page and are not counted, the same as in the mockups.

## Review Focus

| Input | What could go wrong | Pinned by |
|---|---|---|
| The viewport's width: 390, 412, 599, 600, 768, 1280, a phone turned sideways (915 x 412) | the row on a tablet or a desktop, the full header on a phone, a dead band at the boundary, a sideways phone's cost unrecorded | Task 4 (`at %ipx` cases, PHH-T4-M2), Task 5 (the 599, 600, 768, 1280 and 915 x 412 cases, PHH-T5-M2), PHH-T3-M12 (no rule keys on a width) |
| The page's kind: a leaf, a nested leaf, a directory URL, a section, a project, the index | the row on a listing, where the crumbs and the truth line are the page's point and scroll away anyway | `headLayoutFor`'s table and the listing cases (PHH-T4-M1) |
| A ref view, a draft leaf, a badged leaf, a default view served from local main or from origin's main, the usual default view | the row looking like origin's `main` when it is not, or a long ref cutting the draft badge (goal 4) | the ref and draft case and the default-view ref case (PHH-T4-M8, M9, M15); the badge from `entryView` only (PHH-T4-M12, docs-scans clause 1); the badge beside the cut text (PHH-T3-M13, and in a real engine PHH-T5-M4) |
| The tree slot not `ok` (loading, failed) | a head with no crumbs, against §4.7 | the two tree-slot cases (PHH-T4-M18) |
| Share's and Export's states: ready, updating, waiting (formatting, gate, image failed, highlighting), plain view, absent | an icon greyed with no reason a sighted user can find, a name that does not say which control it is, two controls with one name | the updating case (PHH-T4-M6, M14), the four waiting-word cases, the plain-view case (PHH-T4-M7, M11); the fade registered (PHH-T3-M9) |
| Keyboard and screen reader | focus lost when the panel closes, Escape that works only inside the panel, a panel announced while hidden, a dot whose meaning only colour carries | the Escape case on the panel and on the button (PHH-T4-M5, M19, PHH-T5-M5), `hidden` (PHH-T4-M4, PHH-T3-M2), the key that closes it on a new page (PHH-T4-M16), the dot's name case (PHH-T4-M10) |
| The row's height and boxes | a divider that adds a pixel, a control under one tap | the row case in the browser (`bar.h`, `divider`, every button's box; PHH-T5-M3), the declarations (PHH-T3-M3, M4, M10, M11) |
| "Formatting…" over the host | a selector chain that stops matching the live DOM, so the frame jumps again unnoticed | the formatting-chain case (PHH-T4-M20) and the declarations (PHH-T3-M5) |
| The measured figure | a figure read off the wrong heading, before the reader is up, before fonts load, or at a scrolled frame | refinement (l): the lowest matching `h1`, `fonts.ready` in both documents, `frameScroll` 0, the ready wait; Task 1 measures BASE first |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/browser/docs-compact-head.browser.test.ts` | 1 (written, run at BASE), 5 (committed green) | — | the figure at 412 x 915 in both skins; the row's boxes and divider; the long-branch draft's badge; Page details in a real engine; 599, 600, 768, 1280 and 915 x 412 |
| `ui/design/make-icons.mjs` | 2 | build-time script | three names in `NAMES` |
| `ui/src/icons/lucide.ts` | 2 | generated | the three icons' nodes |
| `pwa/test/icon.test.tsx` | 2 | — | the three icons are vendored and draw |
| `pwa/src/docs/docs.css` | 3 | stylesheet | the compact head's rules |
| `pwa/design/audit.mjs` | 3 | contrast census | `.docs-compact-where` and `.docs-more` on `--bg-page`; the fade `.docs-compact-bar .docs-action:disabled 0.35` |
| `pwa/test/docs-compact-css.test.ts` | 3 | — | the declarations |
| `pwa/test/tap-targets.test.tsx` | 3 (the floor half, the 44px loop), 4 (the render half, one import) | — | both halves for `.docs-more` and the row's icons |
| `pwa/src/docs/DocsHead.tsx` | 4 | L4 delivery | `DOCS_COMPACT_QUERY`, `headLayoutFor`, `freshDot`, `shareWords`, `exportWords`, `useHeadActions`, `BackButton`, `rowBadge`, `CompactLabel`, `rowRefText`, `CompactHead`, `CompactRow`; `Crumbs`' `unfold`; Share's and Export's `glyph` |
| `pwa/src/docs/docsText.ts` | 4 | words | `exportPlainHint`, `shareBusy`, `more`, `moreNever`, `moreFailed` |
| `pwa/test/docs-compact-head.test.tsx` | 4 | — | which header, the row, the crumbs while the tree is not `ok`, the panel, keyboard, the row's truth, the waiting words, the notes, the "Formatting…" chain |
| `pwa/test/control-census.test.ts` | 4 | — | `docs/DocsHead.tsx <button> docs-more` |

## Refinements (decided while planning)

Each refinement says What, Why and Cost if wrong, and whether it departs from a spec sentence. Three depart: (c), (d) and (e).

- **(a) The compact head is drawn on a leaf page alone, and one function decides it.**
  - What: `headLayoutFor(compactWidth, page)` answers `compact` when `DOCS_COMPACT_QUERY` matches and the page is a path page whose URL does not end in `/` (a leaf, or a missing path the tree will name); `full` for a directory, a section, a project and the index at every width, and for every page at a wider viewport. `DocsHead` reads the query with `useMediaQuery` and returns `CompactHead` for `compact`, keyed by `docsPageUrl(page)`; the full header's DOM is unchanged. `docs.css` keys every new rule on `.docs-compact` and its children, never on a width.
  - Why: the operator's figure is a reader doc's, and a leaf is the only page whose head stays on screen (a reader page is one pane tall and only its frame scrolls); a listing's head scrolls away with the list, and there the crumbs and the truth line are what the page is for. A leaf is known from the URL before the tree answers (a directory's canonical URL ends in `/`, and `DocsScreen#slashRedirect` fixes one that does not), so the head never swaps shape when a body arrives or the reader falls back; a rule keyed on "the reader is shown" would swap the head on every fallback and on Export's plain view. One switch in the component means the CSS cannot disagree with it at a boundary.
  - Cost if wrong: a leaf shown as an image, a text file or the plain view also gets the row, where its head would have scrolled away anyway; nothing is lost (the panel holds it all). Extending the row to listings later is one line in `headLayoutFor` and its table.
  - Departs from no spec sentence by itself; (c), (d) and (e) say what changes on that page.
- **(b) The compact width is under 600 CSS px.**
  - What: `DOCS_COMPACT_QUERY = '(max-width: 599.98px)'`, declared once in `DocsHead.tsx` and spelled nowhere else under `pwa/src` (Task 4's census case). 600 to 899.98 px keeps today's phone layout, 900 px and up the desk layout.
  - Why: phones are 360 to about 440 CSS px wide (the operator's is 412), tablets and an unfolded foldable 600 and up; 600 is the compact window class's edge. The brief asks for desktop and tablet unchanged; the mockup's own "desktop (900 and up) keeps today's head" would have moved a portrait tablet to the row too.
  - Cost if wrong: a large phone wider than 600 CSS px would keep today's header; the value is one constant, and Task 4's and Task 5's width cases move with it. A phone turned sideways (about 915 x 412) is a desk width and keeps today's desk bar and full header above the frame on a viewport about 412 px tall, unchanged from today; the 915 x 412 browser case records what that costs. A height arm (for example `(max-height: 499.98px)` beside the width) would give it the row, but it changes the constant and its census, can catch a short desktop window, and needs desk-width tests of its own, so Q3 offers it only as an alternative.
  - Departs from no spec sentence: §4.4's "Phone (<900 px)" layout stays for 600 to 899.98, and under 600 (c) and (d) say what departs.
- **(c) The row names where and what in two lines of text, and the whole path moves to the panel.**
  - What: the row is back (`BackButton`, the same `.docs-back` the full header draws), a two-line label (`CompactLabel`: the parent crumb in 11 px mono, then the file name in 14 px, each one line ending in an ellipsis), Share, Export and Page details. The label is text, not links. The panel's first line is every crumb as a link, never folded (`Crumbs` with `unfold`), so the `…` button does not exist on the row. While the tree slot is not `ok` (loading, or failed) the head is back and the crumbs (`Crumbs` as the phone draws them today, `…` and the last two), as the full header's is, so §4.7 ("a tree failure replaces the listing and keeps the crumbs") holds.
  - Why: the mockup's row; two 44 px crumb links cannot share a 44 px row with four controls, back already goes up one level (to the parent the label names), and the whole path stays one tap away with every level a link.
  - **A deliberate departure from the picked mockup:** its first line is the section ("section in 11 px mono"); this plan's is the parent crumb, which is the section for a leaf at a section's top and the directory for a nested one (`d` for `specs/d/x.md`). The reason: the line names where back goes, so the row reads as "up to this, you are here".
  - Cost if wrong: jumping two levels up costs a tap more (Page details, then the crumb), as the mockup said; a nested leaf's first line does not name its section (the panel's crumbs do).
  - **Departs from §4.4's Layout sentence:** "Phone (<900 px): one column, breadcrumb of the last two crumbs behind a leading `…` button, …". Under 600 px on a leaf whose tree slot is `ok`, the breadcrumb is a two-line label and the path is in the panel.
- **(d) Page details is a disclosure in the page's flow, and the truth line moves into it.**
  - What: a `<button class="docs-more">` named "Page details" with `aria-expanded` and `aria-controls`, controlling a `<div role="region" aria-label="Page details" class="docs-more-panel">` placed under the row in the page's flow and `hidden` while closed. A tap toggles it; Escape inside the button or the panel closes it and puts focus back on the button; a navigation closes it (the head is keyed by the page's URL). The panel holds the crumbs, `TruthLine` unchanged (served ref with the full refname in its title, the short commit with copy commit, how the ref was chosen, the source, badge and size, the freshness chip and its refresh tap), View on GitHub with its may-differ note, Open committed version, and the words of a waiting Share or Export. Open, it pushes the reader's host down; the frame still fills what is left.
  - Why: the disclosure pattern is native to a button and a region: no focus trap, no arrow-key menu semantics for content that is mostly text, nothing a screen reader announces while hidden. In the flow, the panel sits on the page's own ground, so every ink registered on `--bg-page` (the truth line, the chip, copy commit) stays true with no new registration; an overlay over the reader would need a scrim, because a tap inside the sandboxed frame never reaches the page to close it. The same panel body is what option 2's details sheet holds (Later).
  - Cost if wrong: while open, the panel takes the height the full header took; the operator may prefer the mockup's floating menu with a scrim (Q2). Moving the same body into an overlay is a container change.
  - **Departs from §4.4's Layout sentence** ("truth-line facts inline joined by ` · `") **and from the Leaf row of §4.4's Views table** ("Truth line, banners, actions"): on that page the truth line is one tap away. Goal 4 ("A page says exactly what it served. It shows the full refname, the commit, why that ref was chosen, and whether a draft overlays it") still holds through the panel and (g); whether one tap is enough for "shows" is the operator's call (Q1).
- **(e) Share and Export become icons on the row; View on GitHub and Open committed version move to the panel; one hook works out all four.**
  - What: `ShareAction` and `ExportAction` gain `glyph`: the same `<button>` with the same classes (`docs-action docs-share`, `docs-action docs-export`), keys, sheets and states, drawing `Icon` (`share`, `download`, size 20) and taking their words as the accessible name. Share is "Share", or "Share: Updating to <short>…" while it waits (on an icon nothing visible says Share, so its waiting name carries the word, as Export's does). Export is "Export", "Export (plain view)", or "Export: <words>" while it waits, as today. `shareWords` and `exportWords` give both headers the same words; the full header's visible words are unchanged. The panel says why a disabled icon waits ("Share: Updating to <short>…", "Export: <words>") and what Export (plain view) does (`exportPlainHint`). `useHeadActions` works out View on GitHub's target, the draft flag, Share's and Export's states and Open committed version's href once, for `Actions` (the full header, output unchanged) and for `CompactRow`.
  - Why: the mockup's row; a word button per action does not fit 412 px beside the label. Keeping the element means the control census, the tap floor (`.docs-action`) and every role-and-name query keep their meaning; one hook means the two headers cannot disagree on an action's state.
  - Cost if wrong: View on GitHub costs a tap more; a sighted user reads a waiting icon's reason in the panel, not on the row (the mockup's own loss).
  - **Departs from §4.5:** "**Share** sits after View on GitHub and before Open committed version" (on the row, Share and Export stand alone; the two links are in the panel), and "On a leaf both are disabled while the opened pin differs from `pinFor(tree, page)` (§4.3), reading "Updating to <short>…"" (on the row the words are the accessible name and a line in the panel, not visible text). **And from §4.17's "When it is offered" table**, whose disabled rows are visible words on the button ("Updating to <short>…", "Formatting…", "Highlighting…", "Choose Format or Show as text first", "Render the mockup first"), and from the visible labels of the operator's Export rulings ("the button reads "Export (plain view)"", and "Image not loaded" on an image page whose image failed): on the row each is the icon's accessible name and the panel's line. Task 4 pins every word a leaf produces today (all but "Render the mockup first", which waits for W6's mockups, where Export is absent).
- **(f) The freshness chip stays in the truth line; Page details carries a dot.**
  - What: `freshDot(chip.state)`: `ok` draws a `--status-done` dot; `never` and `failed` (a failed fetch, re-list or refresh, or a stale lock) both draw a `--status-attention` dot, the picked mockup's "amber stale or failed"; the rest draw none. The dot is `aria-hidden`; the button's name says what it means: "Page details (never fetched)", "Page details (freshness problem)", else "Page details". The failed name is neutral because five conditions map to it and only one is a fetch.
  - Why: the mockup's dot, and a stale or failed page must be visible at a glance without opening anything; colour alone would leave a screen reader out, so the name carries it, and the name tells never-fetched from failed where the colour does not.
  - Cost if wrong: the dot's fill is a non-text graphic the contrast census does not measure (it measures inks); the fills are the status tokens the fleet's chips use on the same page ground.
  - Departs from no spec sentence: §4.5's chip, its states and its tap are unchanged inside the truth line.
- **(g) The row keeps what goal 4 needs at a glance.**
  - What: the label's first line adds, after the parent crumb and joined by ` · `, the served ref (`servedRefText`) whenever what was served is not the usual default (`rowRefText`: the page names a ref, or the served side is local, or the default chain's `via` is not `default:origin-head`, which covers a local main or master and origin's main or master when origin/HEAD is unset or dangling, measured in `ccd/ccd#default_chain`), and then the draft badge `rowBadge` gives: the truth line's own badge for this leaf, from `entryView` through `ENTRY_BADGE_TEXT` (a draft source's badge, or the view's badge), drawn as `.docs-badge`. The crumb and the ref are two spans in one flex text (`.docs-compact-where-text`: `.docs-compact-where-crumb` and `.docs-compact-where-ref`, the ref's holding the ` · `), each cut by its own ellipsis and the crumb giving way first (a thousandfold flex-shrink), so a long parent directory never hides the served ref; the badge is the text's sibling with `flex: none`, so the order stays "where · ref · badge" and only a ref too long for the line is cut, at its end. The usual default view, origin/HEAD resolved, adds nothing.
  - Why: with the truth line behind a tap, a branch, a local default or a draft would otherwise look like origin's `main` on the row (the mockup named this loss and this fix, at no height). The draft view the banners link to is `?ref=refs/heads/<branch>`, served as "<branch> (local)", and a workspace branch can run past the 35 or so characters of 11 px mono the label has at 412 px; the badge is the part goal 4 needs, so it is the part that is never cut. One badge function (M4.T7) keeps the row and the truth line from disagreeing; docs-scans clause 1 reads `DocsHead.tsx`.
  - Cost if wrong: on a ref view with a long branch name the ref is what is truncated, never the badge; the full refname is the panel's. Task 5's long-branch case measures the badge whole and inside the label at 412 px.
  - Departs from no spec sentence; it narrows (d)'s departure.
- **(h) Banners and the notes that answer a tap stay in the flow.**
  - What: `DocsBanners` and the redirect note are `DocsScreen`'s and do not move; the compact head draws "Showing the plain view, which Export saves." and "Updated to <short>" under the row, outside the panel, where the full header draws them.
  - Why: they are warnings or answers to something the reader just did; behind a tap nobody would see them.
  - Cost if wrong: on a draft page the banners still take their height above the frame, as in the mockup.
  - Departs from no spec sentence (§4.5's banners table is unchanged).
- **(i) The vertical budget, and "Formatting…".**
  - What: `.docs-screen:has(> .docs-compact)` sets `padding-top: 0` and `gap: var(--sp-1)`. The row is one tap tall (`block-size: var(--tap-min)`) and carries the picked mockup's 1 px divider (`border-block-end: 1px solid var(--edge-subtle)`) inside that height, since box-sizing is border-box everywhere (`ui/src/styles/reset.css`), exactly as the mockup's `height: 44px; border-bottom: 1px` row does; the controls keep their 44 px boxes, centred, so they overhang the row's 43 px content box by half a pixel at its top and bottom. So the console's part above the frame is 48 px. On that screen `.doc-formatting` lies over the reader's host (`position: absolute` in a `position: relative` leaf, painting `--bg-page`) instead of taking a line, so the frame does not move when the reader is ready. The reader frame's own bar, body margin and gap (85 px in the mockup's map) are untouched.
  - Why: the mockup's 133 = 44 + 4 + 85, its divider counted inside the 44.
  - Cost if wrong: if the frame's own part measures above 85 at BASE, 133 is out of this wave's reach (Task 1 Step 4 stops before any code). The "Formatting…" overlay's selector chain (`.docs-screen > .docs-leaf > .doc-formatting` beside `.docs-reader`) is pinned against the live DOM in jsdom (Task 4's formatting-chain case), because the formatting window cannot be held in the browser file without naming the build's hashed chunks.
  - Departs from no spec sentence (the rich-docs spec's §4.1 "Size: sized to the Docs pane, and the frame scrolls itself" holds).
- **(j) Three lucide icons are vendored the way the others were.**
  - What: `share`, `download` and `ellipsis` join `make-icons.mjs`'s `NAMES`, and `lucide.ts` is regenerated from lucide-static 1.59.0, the version already vendored, so every existing icon's nodes stay byte-identical and the diff only adds. Measured on the registry while planning: all three exist at 1.59.0, each under 400 bytes and made only of `path` or `circle` nodes with geometric attributes.
  - Why: `Icon` is the design system's glyph, stroked in the control's ink; a text glyph for Share or Export would fall to the platform's font, which `Icon` exists to avoid.
  - Cost if wrong: if the box cannot reach the registry, Task 2 Step 0 stops before anything changes.
  - Departs from no spec sentence.
- **(k) Tokens, grounds, floors and the dimmed icon.**
  - What: every new rule uses tokens only. The colour rules are `.docs-compact-where` and `.docs-more` (registered in `INHERITED_GROUNDS` on `--bg-page`) and `.docs-more[aria-expanded='true']` (self-grounded: `--bg-pressed` with `--ink-primary`, the pressed row's pair). `.docs-more` carries `min-height` and `min-width: var(--tap-min)` in its own rule (TOKEN in the control census); Share and Export keep `.docs-action`'s floor and gain `min-width: var(--tap-min)` on the row. A disabled row icon is dimmed with `opacity: 0.35`, not recoloured, and the fade is registered in `design/audit.mjs`'s `OPACITY_REGISTRY` as `.docs-compact-bar .docs-action:disabled 0.35` with a `noText` reason, beside the `.bell:disabled 0.35` entry it follows.
  - Why: the docs contrast census measures every `docs.css` rule that sets `color`, in every palette, and admits no exemption, so a `--ink-disabled` rule would red it (WCAG 1.4.3 exempts inactive controls, but the census does not). The auditor lists every static opacity between 0 and 1 as a fade and reds one the opacity registry does not hold.
  - Cost if wrong: the faded icon's ink is the measured `.docs-action` container's before the fade; the registry entry says why no pair is measured (the icon is decoration, and its words are the button's name and an unfaded panel line).
  - Departs from no spec sentence (§4.14: tokens only, registered grounds, both tap halves).
- **(l) The figure is measured in the real engine, at the operator's viewport, against the mockup's number.**
  - What: `pwa/browser/docs-compact-head.browser.test.ts` opens a reader leaf in the production build at 412 x 915 (the Pixel's CSS viewport as the brief gives it) and reads the iframe's top in the page plus the doc title's top in the frame (the lowest `h1` reading the title, after `document.fonts.ready` in both documents, at the frame's scroll 0, once the frame is up and "Formatting…" is gone). It pins the title at or under 133 px in Refined (the skin a phone boots) and the console's part at or under 48 px in both skins; the row's border box at one tap with its 1 px divider and its controls at 44 x 44 or more; on a draft leaf of a ref view with a long branch, the ref cut and the badge whole inside the label; Page details in a real engine; and the full header at 600, 768, 1280 and 915 x 412 (the last a phone turned sideways, recorded for Q3). Every case prints its figures on a `PHH-FIGURE` line. Task 1 runs it at BASE before any change.
  - Why: jsdom lays nothing out; only a real engine can say what sits above the title. Reading BASE first proves the test measures what the mockup counted (about 341) and that the frame's own part is the 85 the 133 assumes.
  - Cost if wrong: Android Chrome's fonts differ from the runner's, but the row's height is the tap token and the label's lines are token sizes, so the figure does not depend on them; the operator's device check after rollout is the last word.
  - Departs from no spec sentence.
- **(m) Option 2 is not made harder.** Nothing here reaches into the frame, its bridge or its bar, and nothing depends on the frame's bar height (the stylesheet keys on ccrc's own classes; the browser file reads the frame's part, it does not pin it). The parts option 2 reuses are named under Later.

### Task 1: Base, claims, and the BASE figure (refinement (l))

**Model routing:** the main loop runs Step 0 and judges Step 4; a `sonnet` implementer writes the file at `medium` effort; per-task reviewer `opus` (does the file measure what the mockup counted).

**Files:**
- Create (left untracked until Task 5 commits it green): `pwa/browser/docs-compact-head.browser.test.ts`.
- Guards (not edited): `pwa/test/browser-dist.test.ts`, `pwa/test/browser-leg.test.ts`.

**Decisions:** (1) The file imports only what BASE already exports, so it typechecks at BASE and in every later task while it sits in the working tree; the new words are matched by `^Page details`, not imported. (2) It routes `/api/docs` after `openApp`'s own `/api` route, so its answer wins (Playwright runs the newest matching route first), as `reader-frame.browser.test.ts#openSession` does. (3) It serves the run's one build in the exact form `browser-dist.test.ts` pins.

- [ ] **Step 0: Base, the Find blocks, claims.** Run:
  `git grep -qF "function ExportAction(p: {" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "exportPlainShown: 'Showing the plain view, which Export saves.'," HEAD -- pwa/src/docs/docsText.ts && git grep -qF ".docs-export-note { margin: 0;" HEAD -- pwa/src/docs/docs.css && git grep -qF "export function sharedDist(): string {" HEAD -- pwa/browser/app.ts && git grep -qF "export const LUCIDE_VERSION = '1.59.0';" HEAD -- ui/src/icons/lucide.ts && ! git grep -qF "docs-compact" HEAD -- pwa/src pwa/test pwa/browser && test ! -e pwa/browser/docs-compact-head.browser.test.ts && test ! -e pwa/test/docs-compact-head.test.tsx && test ! -e pwa/test/docs-compact-css.test.ts && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. Then write the find-check and run it over this plan (as merged to `main` by the ledger PR):

````bash
mkdir -p .superpowers/sdd/2026-11-03-native-docs-reader-phone-header
cat > .superpowers/sdd/2026-11-03-native-docs-reader-phone-header/find-check.mjs <<'EOF'
// Every Find block in the plan, counted in HEAD's copy of the file it names: each must match exactly once.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const plan = readFileSync(process.argv[2], 'utf8');
const re = /^ *Find \(`([^`]+)`, quoted from `[0-9a-f]+`\):\n```[a-z]*\n([\s\S]*?)\n```$/gm;
let n = 0;
let bad = 0;
for (const m of plan.matchAll(re)) {
  n += 1;
  const text = execFileSync('git', ['show', `HEAD:${m[1]}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const count = text.split(m[2]).length - 1;
  if (count !== 1) {
    bad += 1;
    console.log(`FIND-MISS ${m[1]} matches ${count}: ${m[2].split('\n')[0]}`);
  }
}
console.log(`find blocks ${n}, misses ${bad}`);
process.exit(n === 22 && bad === 0 ? 0 : 1);
EOF
node .superpowers/sdd/2026-11-03-native-docs-reader-phone-header/find-check.mjs docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md && echo FINDS-OK
````

  Expected: `find blocks 22, misses 0` then `FINDS-OK`. A miss (Export changed in review, or another merge moved a line) is a stop-and-ask: the coordinator re-quotes the block. Confirm the claims on every file in "How this wave runs". Record BASE (`git rev-parse HEAD`) in the SDD ledger.
- [ ] **Step 1: Write `pwa/browser/docs-compact-head.browser.test.ts`** with exactly this content:

```ts
// The Docs reader's compact phone head, measured in a real Chrome over the production build (native Docs reader, the
// phone-header plan of 2026-11-03, refinements (a), (b), (d), (i)). The operator's phone, a Pixel 10 Pro XL in Chrome on
// Android, has a CSS viewport of about 412 x 915; on it about 341 px sat above a reader doc's title, and the mockup the
// operator picked (one console row) draws 133. So, at 412 x 915 with the reader up:
//   - the head is the compact row, and the console's part above the frame (the row and the gap under it) is at most
//     CONSOLE_PART_MAX px, in either skin;
//   - in Refined, the phone's skin, the title's top is at most PHONE_TITLE_MAX px below the top of the page;
//   - every control on the row is at least one tap (44 x 44), and the row, the mockup's 1 px divider inside it, is one
//     tap tall (its border box, as getBoundingClientRect reads it);
//   - on a draft leaf of a ref view with a long branch name, the ref is cut and the draft badge is whole, inside the label;
//   - on a leaf under a 46-character directory in a ref view, the ref still has room on the first line (the directory
//     gives way first), and the badge is inside the label;
//   - Page details opens the truth line under the row, and Escape closes it with focus back on the button.
// At 599 the head is still the row; at 600, 768 and 1280 it is the full header, as before (its truth line on the page,
// its crumbs folded below the desk width), and the phone turned sideways (915 x 412, a touch screen) is a desk width that
// keeps the full header too: that case records what it costs. Every case prints its figures on a `PHH-FIGURE` line for
// the plan's Results.
//
// The figure is the iframe's top in the page plus the doc title's top inside the frame (Playwright's frame evaluation),
// at the frame's scroll 0, once the reader is up ("Formatting…" gone, no fallback note) and both documents' fonts have
// loaded. The title is the LOWEST `h1` reading TITLE, so a heading the reader may draw in its own bar never stands in for
// it. No server, no ccd: `/api/docs` answers one leaf from fixtures, as reader-frame.browser.test.ts's sessions do.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/docs-compact-head.browser.test.ts )`, through `ccrc test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS } from '../../shared/docs';
import { DOCS_HEAD_TEXT } from '../src/docs/docsText';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { COMMIT_A, draftOf, entry, holder, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
const NAME = '2026-10-20-path-identity-design.md';
const TITLE = 'Path identity design';
const BLOB = 'c'.repeat(40);
const DOC = `# ${TITLE}\n\nA path names one document at one ref, so a link means the same thing on every checkout.\n\n`
  + Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the body, long enough to wrap on a phone's width.`).join('\n\n')
  + '\n';
const SIZE = Buffer.byteLength(DOC, 'utf8');
/** A branch name long enough to overflow the label's first line at 412 px. */
const LONG_BRANCH = 'ws/a-long-workspace-branch-for-the-phone-header';

/** A parent directory as long as this repository's own plan directories run (46 characters), so the row's first line
 *  holds the directory and nothing else unless the ref is given its own room. */
const LONG_DIR = '2026-10-27-a-long-directory-name-for-the-row-case';

/** The picked mockup's figures: 133 px above the title, of which the console's row and the gap under it are 48 (44 + 4)
 *  and the reader frame's own top (its body margin, its bar and the gap under the bar) 85, unchanged by this wave. */
const PHONE_TITLE_MAX = 133;
const CONSOLE_PART_MAX = 48;
/** The floor every control on the row reaches (`--tap-min`). */
const TAP = 44;
const PHONE = { width: 412, height: 915 } as const;

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const JSON_TYPE = 'application/json; charset=utf-8';
const bodyOf = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');

/** The one committed leaf on origin's default branch. */
const COMMITTED_TREE = treeOk({ entries: [entry(SECTION, NAME, { committed: { kind: 'file', blob: BLOB, size: SIZE } })] });

/** The same leaf in a ref view of a long local branch, with a draft over it held by that branch's checkout. */
function draftTree(leaf = NAME): ReturnType<typeof treeOk> {
  const base = treeOk({
    entries: [entry(SECTION, leaf, { committed: { kind: 'file', blob: BLOB, size: SIZE }, draft: draftOf('modified') })],
    drafts: { ...holder(), branch: LONG_BRANCH },
  });
  return {
    ...base,
    ref: { ...base.ref, requested: LONG_BRANCH, served: `refs/heads/${LONG_BRANCH}`, name: LONG_BRANCH, side: 'local', via: 'local' },
  };
}

/** `/api/docs/demo/tree` answers `tree` and `/api/docs/demo/file` the leaf's Markdown; any other `/api/docs` request (a
 *  refresh) answers 204. Routed after `openApp`'s own `/api` route, so this one answers first. */
async function answerDocs(app: OpenedApp, tree = COMMITTED_TREE, leaf = NAME): Promise<void> {
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      await route.fulfill({ status: 204 });
      return;
    }
    const headers = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
    if (new URL(req.url()).pathname.endsWith('/tree')) {
      await route.fulfill({ status: 200, headers, body: bodyOf(treeResponse(tree)) });
      return;
    }
    const show = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: leaf, size: SIZE,
      sha256: BLOB.padEnd(64, '0'), encoding: 'utf8', text: DOC, commit: COMMIT_A, blob: BLOB, onRef: 'contains',
    };
    await route.fulfill({ status: 200, headers, body: bodyOf({ ok: true, contentClass: 'markdown', from: 'ccd', show }) });
  });
}

interface View { readonly width: number; readonly height: number; readonly skin: string; readonly touch?: boolean }

/** A context at `view` (a touch screen below 900 px, or when `touch` asks), its `/api/docs` answering `tree`. */
async function openView(view: View, tree = COMMITTED_TREE, leaf = NAME): Promise<OpenedApp> {
  const app = await openApp(browser!, { width: view.width, skin: view.skin, theme: 'light', touch: view.touch }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize({ width: view.width, height: view.height });
  await answerDocs(app, tree, leaf);
  return app;
}

/** A context at `view` with the leaf open and the reader up. Throws when the reader fell back to the plain view or never
 *  came up: the figure is about the reader page. */
async function openLeaf(view: View): Promise<OpenedApp> {
  const app = await openView(view);
  await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}`, { waitUntil: 'load' });
  const up = await app.page.waitForFunction((note) => {
    if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
    return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
  }, READER_FALLBACK_NOTE, { timeout: 90_000, polling: 100 });
  const outcome = await up.jsonValue();
  if (outcome !== 'ready') throw new Error(`the reader did not come up: ${String(outcome)}`);
  return app;
}

interface Figure {
  readonly head: 'compact' | 'full';
  /** `.docs-screen`'s top in the page. */
  readonly screenTop: number;
  /** The reader iframe's top in the page. */
  readonly frameTop: number;
  /** The doc title's top inside the frame. */
  readonly titleInFrame: number;
  /** The frame's own scroll offset when the title was read (0 expected). */
  readonly frameScroll: number;
  /** px above the title: `frameTop + titleInFrame`. */
  readonly above: number;
}

async function measure(page: Page): Promise<Figure> {
  const outer = await page.evaluate(async () => {
    await document.fonts.ready;
    const top = (sel: string): number => document.querySelector(sel)?.getBoundingClientRect().top ?? Number.NaN;
    const head: 'compact' | 'full' = document.querySelector('.docs-head.docs-compact') === null ? 'full' : 'compact';
    return { head, screenTop: top('.docs-screen'), frameTop: top('.docs-reader iframe') };
  });
  const handle = await page.locator('.docs-reader iframe').elementHandle({ timeout: 30_000 });
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) throw new Error('the reader iframe has no content frame');
  const inner = await frame.evaluate(async (title) => {
    await document.fonts.ready;
    const tops = [...document.querySelectorAll('h1')]
      .filter((h) => h.textContent?.trim() === title)
      .map((h) => h.getBoundingClientRect().top);
    return { tops, scroll: window.scrollY };
  }, TITLE);
  if (inner.tops.length === 0) throw new Error(`no h1 in the frame reads ${TITLE}`);
  const titleInFrame = Math.max(...inner.tops);
  return { ...outer, titleInFrame, frameScroll: inner.scroll, above: outer.frameTop + titleInFrame };
}

/** Opens the leaf at `view`, runs `check`, asks that the page threw nothing, and closes the context whatever happens. */
async function at(view: View, check: (app: OpenedApp) => Promise<void>): Promise<void> {
  const app = await openLeaf(view);
  try {
    await check(app);
    expect(app.errors, 'no page error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

describe('a phone draws one console row above the reader (refinements (a), (i))', () => {
  it(`412 x 915, Refined: the title is at most ${PHONE_TITLE_MAX} px down, ${CONSOLE_PART_MAX} of them the console's`, async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 412x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
      expect(f.screenTop, 'nothing of the console draws above the Docs screen').toBe(0);
      expect(f.frameScroll, 'the frame is at its top').toBe(0);
      expect(f.frameTop - f.screenTop, 'the row and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
      expect(f.above, 'px above the title').toBeLessThanOrEqual(PHONE_TITLE_MAX);
    });
  }, 120_000);

  it(`412 x 915, Instrument: the same row, and at most ${CONSOLE_PART_MAX} px of the console above the frame`, async () => {
    await at({ ...PHONE, skin: INSTRUMENT }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE instrument 412x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
      expect(f.frameTop - f.screenTop, 'the row and the gap under it').toBeLessThanOrEqual(CONSOLE_PART_MAX);
    });
  }, 120_000);

  it('599 x 915: still the row (the compact width ends at 600)', async () => {
    await at({ width: 599, height: 915, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 599x915 ${JSON.stringify(f)}`);
      expect(f.head).toBe('compact');
    });
  }, 120_000);

  it('412 x 915: back, Share, Export and Page details, each at least one tap, on a row one tap tall', async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const row = await page.evaluate(() => {
        const bar = document.querySelector('.docs-compact-bar');
        if (bar === null) return null;
        const box = (e: Element): { w: number; h: number } => {
          const r = e.getBoundingClientRect();
          return { w: r.width, h: r.height };
        };
        return {
          bar: box(bar),
          divider: getComputedStyle(bar).borderBottomWidth,
          buttons: [...bar.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') ?? '', ...box(b) })),
          lines: [...bar.querySelectorAll('.docs-compact-where, .docs-compact-name')].map((e) => box(e).h),
        };
      });
      console.log(`PHH-FIGURE refined 412x915 row ${JSON.stringify(row)}`);
      expect(row, 'the compact row is drawn').not.toBeNull();
      const r = row!;
      expect(r.buttons.map((b) => b.name).slice(0, 3)).toEqual([DOCS_HEAD_TEXT.back, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.exportPlainView]);
      expect(r.buttons[3]?.name).toMatch(/^Page details/);
      expect(r.buttons).toHaveLength(4);
      for (const b of r.buttons) {
        expect(b.w, b.name).toBeGreaterThanOrEqual(TAP);
        expect(b.h, b.name).toBeGreaterThanOrEqual(TAP);
      }
      expect(r.bar.h, 'the row is one tap tall, its divider inside').toBeLessThanOrEqual(TAP + 0.5);
      expect(r.divider, 'the mockup\'s 1 px divider').toBe('1px');
      expect(r.lines.reduce((s, h) => s + h, 0), 'the label\'s two lines fit the row').toBeLessThanOrEqual(TAP);
    });
  }, 120_000);

  it('412 x 915: a draft in a ref view of a long branch; the ref is cut, the draft badge is whole and inside the label (refinement (g))', async () => {
    const app = await openView({ ...PHONE, skin: REFINED }, draftTree());
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${NAME}?ref=${LONG_BRANCH}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-compact-where .docs-badge') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(() => {
        const rect = (sel: string): { left: number; right: number } | null => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r === undefined ? null : { left: r.left, right: r.right };
        };
        const text = document.querySelector('.docs-compact-where-ref');
        const badge = document.querySelector('.docs-compact-where .docs-badge');
        return {
          label: rect('.docs-compact-label'), badge: rect('.docs-compact-where .docs-badge'),
          textCut: text === null ? null : text.scrollWidth > text.clientWidth,
          badgeWhole: badge === null ? null : badge.scrollWidth <= badge.clientWidth + 1,
          words: badge?.textContent ?? null,
        };
      });
      console.log(`PHH-FIGURE refined 412x915 long-branch-draft ${JSON.stringify(got)}`);
      expect(got.textCut, 'the long ref overflows and is cut').toBe(true);
      expect(got.badgeWhole, 'the badge is not cut').toBe(true);
      expect(got.label).not.toBeNull();
      expect(got.badge).not.toBeNull();
      expect(got.badge!.left).toBeGreaterThanOrEqual(got.label!.left - 0.5);
      expect(got.badge!.right, 'the badge lies inside the label').toBeLessThanOrEqual(got.label!.right + 0.5);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it('412 x 915: a ref view of a leaf under a 46-character directory still draws the ref, and the badge is inside the label (refinement (g))', async () => {
    const leaf = `${LONG_DIR}/${NAME}`;
    const app = await openView({ ...PHONE, skin: REFINED }, draftTree(leaf), leaf);
    try {
      await app.page.goto(`${server!.origin}/docs/${PROJECT}/${SECTION}/${leaf}?ref=${LONG_BRANCH}`, { waitUntil: 'load' });
      await app.page.waitForFunction(() => document.querySelector('.docs-compact-where-ref') !== null, undefined, { timeout: 30_000 });
      const got = await app.page.evaluate(() => {
        const box = (sel: string): { left: number; right: number; width: number } | null => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r === undefined ? null : { left: r.left, right: r.right, width: r.width };
        };
        // The separator's own space is drawn: the first character of the ref's text has a box of its own.
        const ref = document.querySelector('.docs-compact-where-ref');
        const first = document.createRange();
        if (ref?.firstChild != null) { first.setStart(ref.firstChild, 0); first.setEnd(ref.firstChild, 1); }
        return {
          label: box('.docs-compact-label'), crumb: box('.docs-compact-where-crumb'), ref: box('.docs-compact-where-ref'),
          badge: box('.docs-compact-where .docs-badge'), separatorW: first.getBoundingClientRect().width,
          refText: ref?.textContent ?? null,
        };
      });
      console.log(`PHH-FIGURE refined 412x915 long-directory-ref ${JSON.stringify(got)}`);
      expect(got.ref, 'the ref is drawn').not.toBeNull();
      expect(got.ref!.width, 'the ref has room for at least four mono characters').toBeGreaterThan(24);
      expect(got.separatorW, 'the separator\'s space is drawn').toBeGreaterThan(0);
      expect(got.badge).not.toBeNull();
      expect(got.label).not.toBeNull();
      expect(got.badge!.right, 'the badge lies inside the label').toBeLessThanOrEqual(got.label!.right + 0.5);
      expect(got.ref!.right, 'the ref ends before the badge').toBeLessThanOrEqual(got.badge!.left + 0.5);
      expect(app.errors, 'no page error').toEqual([]);
    } finally {
      await app.ctx.close();
    }
  }, 120_000);

  it('412 x 915: Page details opens the truth line under the row; Escape closes it, focus back on the button (refinement (d))', async () => {
    await at({ ...PHONE, skin: REFINED }, async ({ page }) => {
      const more = page.locator('.docs-compact-bar .docs-more');
      expect(await more.count(), 'Page details is on the row').toBe(1);
      expect(await page.locator('.docs-truth').isVisible(), 'the truth line is behind the tap').toBe(false);
      await more.click();
      expect(await more.getAttribute('aria-expanded')).toBe('true');
      expect(await page.locator('.docs-truth').isVisible()).toBe(true);
      expect(await page.locator('.docs-more-panel').getByRole('link', { name: DOCS_HEAD_TEXT.github }).isVisible()).toBe(true);
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 412x915 panel-open ${JSON.stringify(f)}`);
      expect(f.frameTop, 'the frame stays under the open panel').toBeGreaterThan(CONSOLE_PART_MAX);
      await page.keyboard.press('Escape');
      expect(await more.getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator('.docs-truth').isVisible()).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('docs-more') ?? false), 'focus is on Page details')
        .toBe(true);
    });
  }, 120_000);
});

describe('a tablet and a desktop keep the full header (refinement (b))', () => {
  it.each([
    [600, 960, true],
    [768, 1024, true],
    [1280, 800, false],
  ] as const)('%i x %i: the full header, its truth line and View on GitHub on the page; crumbs folded: %s', async (width, height, folded) => {
    await at({ width, height, skin: REFINED }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined ${width}x${height} ${JSON.stringify(f)}`);
      expect(f.head).toBe('full');
      expect(await page.locator('.docs-more').count()).toBe(0);
      expect(await page.locator('.docs-truth').isVisible()).toBe(true);
      expect(await page.locator('.docs-actions').getByRole('link', { name: DOCS_HEAD_TEXT.github }).isVisible()).toBe(true);
      expect(await page.locator('.docs-crumbs-more').count()).toBe(folded ? 1 : 0);
    });
  }, 120_000);

  it('915 x 412, a phone turned sideways: a desk width, so the full header, as today; the figure records its cost (refinement (b))', async () => {
    await at({ width: 915, height: 412, skin: REFINED, touch: true }, async ({ page }) => {
      const f = await measure(page);
      console.log(`PHH-FIGURE refined 915x412 ${JSON.stringify(f)}`);
      expect(f.head).toBe('full');
      expect(await page.locator('.docs-more').count()).toBe(0);
    });
  }, 120_000);
});
```

- [ ] **Step 2: It typechecks at BASE, and the two browser censuses hold it.** `TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/browser-dist.test.ts test/browser-leg.test.ts )` — green, counts unchanged from BASE (the file serves `sharedDist()` in the pinned form and is named `*.browser.test.ts`).
- [ ] **Step 3: Run it at BASE**, through `ccrc test`: `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-compact-head.browser.test.ts )`. Expected (prediction): `Tests  6 failed | 4 passed (10)`: the 412 x 915 Refined and Instrument cases and the 599 case red at `expect(f.head).toBe('compact')`, the row case at `the compact row is drawn`, the long-branch draft case at its 30 s wait for the row's badge, the Page details case at `Page details is on the row`; the 600, 768, 1280 and 915 x 412 cases green. Copy every `PHH-FIGURE` line into the SDD ledger.
- [ ] **Step 4: Judge the BASE figures** (the main loop). From `PHH-FIGURE refined 412x915`: `screenTop`, `frameTop`, `titleInFrame`, `frameScroll`, `above` (predictions: 0, about 256, about 85, 0, about 341). Each of these is a **stop-and-ask, before any code changes**: `screenTop` not 0 (something draws above the Docs screen that the mockup did not count); `frameScroll` not 0; `48 + titleInFrame > 133` (the frame's own part is over the mockup's 85, so 133 is out of this wave's reach; the coordinator rules on the pin); a case that never got the reader up (`the reader did not come up`); a full-header case red at BASE (`no page error` names the errors). A `frameTop` or `above` far from the prediction is reported, not a stop.
- [ ] **Step 5: Record, commit nothing.** The file stays untracked (Tasks 2 to 4 stage their files by name; Task 5 commits it). Record its sha256 (`sha256sum pwa/browser/docs-compact-head.browser.test.ts`) and the BASE figures for 412 (both skins), 599, 600, 768, 1280 and 915 x 412 in the SDD ledger; Task 5 compares against them. Task 1 contributes no mutation row: its guards are Task 5's.

**Verify:** `T1-BASE-OK`, `FINDS-OK`, `TSC-OK`; the browser file red as predicted, with every BASE figure recorded and none of Step 4's conditions met.

### Task 2: Three icons (refinement (j))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`.

**Files:**
- Modify: `ui/design/make-icons.mjs` (three names), `pwa/test/icon.test.tsx` (one case).
- Regenerate: `ui/src/icons/lucide.ts` (by the script, never by hand).
- Guards (not edited): `pwa/test/ui-package-boundary.test.ts`, `pwa/test/markup-census.test.ts`.

**Decisions:** (1) The same lucide-static version as the vendored set (1.59.0), so the regenerated file only adds. (2) Everything the step writes stays under `$HOME/.cc-tmp/phh-icons/`, outside the workspace: `npm pack` runs inside that directory, so the tarball lands there, and `--cache` points npm's cache there too, so its cached copy of the tarball is not left in `~/.npm`. Step 6 removes the directory, cache and all. (3) Only the SVG files the generator reads are extracted: it reads `<from>/<name>.svg` for each name in `NAMES` and nothing else, and the whole package unpacks to about 52 MB in 5,970 files (the registry's `dist.unpackedSize` 51,939,501 and `dist.fileCount` 5,970 for 1.59.0, read while planning). Measured while planning, on the registry: the tarball is 6,972,252 bytes, and each of the three new SVGs is under 400 bytes (`share` 394, `download` 397, `ellipsis` 391), each made only of `path` or `circle` nodes with geometric attributes, which the generator accepts. So the step writes about 14 MB at most (the tarball and npm's cached copy of it, plus about 30 SVG files of under 0.5 KB each), all removed in Step 6.

- [ ] **Step 0: Claims, and the three names exist at 1.59.0.** Confirm the claims on `ui/design/make-icons.mjs`, `ui/src/icons/lucide.ts` and `pwa/test/icon.test.tsx`. Then:
  `mkdir -p "$HOME/.cc-tmp/phh-icons" && ( cd "$HOME/.cc-tmp/phh-icons" && npm pack --silent --cache "$HOME/.cc-tmp/phh-icons/npm-cache" lucide-static@1.59.0 >/dev/null && tar -tzf lucide-static-1.59.0.tgz | grep -cE '^package/icons/(share|download|ellipsis)\.svg$' ) && du -sh "$HOME/.cc-tmp/phh-icons"`
  Expected: `3`, then a size of about 14M. Fewer than 3, or a registry the box cannot reach, is a stop-and-ask. Nothing is extracted yet.
- [ ] **Step 1: Write the failing test.** In `pwa/test/icon.test.tsx`:
  Find (`pwa/test/icon.test.tsx`, quoted from `94bdcf454`):
```tsx
  it('the vendored set ships its licence and names its lucide version', () => {
```
  Replace:
```tsx
  // The Docs reader's compact phone head (the phone-header plan of 2026-11-03): Share and Export as icons on the row,
  // and the Page details button. Each is vendored, and each draws.
  it('the Docs compact head icons are vendored', () => {
    const GEOMETRIC = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
    for (const name of ['share', 'download', 'ellipsis'] as const) {
      // Named first, so a missing icon reds with its name, not a TypeError inside Icon.
      expect(Object.keys(ICONS), name).toContain(name);
      const { container, unmount } = render(<Icon name={name} size={20} />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      const drawn = [...svg!.children].filter((c) => GEOMETRIC.has(c.tagName.toLowerCase()));
      expect(drawn.length, `${name} draws at least one geometric child`).toBeGreaterThan(0);
      unmount();
    }
  });

  it('the vendored set ships its licence and names its lucide version', () => {
```
- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/icon.test.tsx )` — Expected (prediction): `1 failed`, `'the Docs compact head icons are vendored'`, at its `toContain` for `share`.
- [ ] **Step 3: Add the names.** In `ui/design/make-icons.mjs`:
  Find (`ui/design/make-icons.mjs`, quoted from `94bdcf454`):
```js
  'panel-right-close',
  'panel-right-open',
];
```
  Replace:
```js
  'panel-right-close',
  'panel-right-open',
  // The Docs reader's compact phone head (the phone-header plan of 2026-11-03): Share, Export and Page details.
  'share',
  'download',
  'ellipsis',
];
```
- [ ] **Step 4: Extract only what the generator reads, regenerate, and check the diff only adds.** Extract the SVG of every name in `NAMES`, as the script now lists them, and nothing else:
  `NAMES=$(sed -n "/^const NAMES = \[/,/^\];/p" ui/design/make-icons.mjs | grep -oE "^  '[a-z0-9-]+'" | tr -d " '") && echo "$NAMES" | wc -l && ( cd "$HOME/.cc-tmp/phh-icons" && tar -xzf lucide-static-1.59.0.tgz $(for n in $NAMES; do printf 'package/icons/%s.svg ' "$n"; done) ) && ls "$HOME/.cc-tmp/phh-icons/package/icons" | wc -l`
  Expected: the same count twice, 30 (the 27 vendored names and the three new ones). Then `node ui/design/make-icons.mjs --from "$HOME/.cc-tmp/phh-icons/package/icons"`, then `git diff --numstat -- ui/src/icons/lucide.ts` — Expected: one line whose second column (deletions) is `0`, and `git diff -- ui/src/icons/lucide.ts | grep -c '^+  [a-z]*: \[$'` prints `3` (the keys `share`, `download`, `ellipsis`). Any deleted line is a stop-and-ask (the script or the version is not the one that made the file).
- [ ] **Step 5: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/icon.test.tsx )` — every case green, one more than at BASE. `TSC-OK` and `UI-TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/ui-package-boundary.test.ts test/markup-census.test.ts )` — green.
- [ ] **Step 6: Clean and commit.** `rm -rf "$HOME/.cc-tmp/phh-icons"` (the tarball, npm's cache under `npm-cache/` and the extracted SVGs), then `test ! -e "$HOME/.cc-tmp/phh-icons" && echo ICONS-CLEAN`. `git add ui/design/make-icons.mjs ui/src/icons/lucide.ts pwa/test/icon.test.tsx` (expect 3), message `ui: vendor the share, download and ellipsis icons (docs phone header)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, file `../ui/src/icons/lucide.ts`, tests `test/icon.test.tsx`):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| PHH-T2-M1 | (j) | `ellipsis: [` → `ellipsisGone: [` | 1 failed — `'the Docs compact head icons are vendored'` |

```json
[
  {"id": "PHH-T2-M1", "spec": "(j)", "pkg": "pwa", "file": "../ui/src/icons/lucide.ts", "old": "ellipsis: [", "new": "ellipsisGone: [", "tests": ["test/icon.test.tsx"], "red": "1 failed: the Docs compact head icons are vendored"}
]
```

**Verify:** `test/icon.test.tsx` green with the new case; `lucide.ts` gained three icons and lost nothing; `TSC-OK`, `UI-TSC-OK`; `ICONS-CLEAN`.

### Task 3: The stylesheet and its registrations (refinements (d), (e), (f), (g), (i), (k))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`.

**Files:**
- Create: `pwa/test/docs-compact-css.test.ts`.
- Modify: `pwa/src/docs/docs.css` (one block after Export's), `pwa/design/audit.mjs` (three entries: two in `INHERITED_GROUNDS` after `.docs-crumb, .docs-crumbs-more`, one in `OPACITY_REGISTRY` after `.bell:disabled 0.35`), `pwa/test/tap-targets.test.tsx` (one loop line, one describe: the floor half).
- Guards (not edited): `pwa/test/contrast.test.ts`, `pwa/test/shell-css.test.ts`, `pwa/test/motion-reduced.test.ts`, `pwa/test/shape-census.test.ts`, `pwa/test/control-census.test.ts`.

**Decisions:** (1) The rules land before the component that draws them (Task 4), so each commit is green: the control census sees no new button yet, and the contrast census measures the new colour rules and the new fade as soon as they exist. (2) No rule declares a `transition`, so `motion-reduced.test.ts` owes nothing. (3) The block sits after Export's rules and before the reduced-motion block, which stays last. (4) The block's comment names `headLayoutFor`, never the width constant, so Task 4 Step 0's check that the constant is not yet spelled anywhere under `pwa` holds.

- [ ] **Step 0: Base and claims.** `git grep -qF ".docs-export-note { margin: 0;" HEAD -- pwa/src/docs/docs.css && git grep -qF "'.docs-crumb, .docs-crumbs-more': {" HEAD -- pwa/design/audit.mjs && git grep -qF "'.bell:disabled 0.35': { noText: 'WCAG 1.4.3 exempts inactive controls' }," HEAD -- pwa/design/audit.mjs && ! git grep -qF "docs-compact" HEAD -- pwa/src pwa/design && echo T3-BASE-OK` — Expected: `T3-BASE-OK`. Confirm the claims on the three edited files. Record the BASE counts of `contrast.test.ts` and `tap-targets.test.tsx` (each alone, through `ccrc test`).
- [ ] **Step 1: Write the failing test,** `pwa/test/docs-compact-css.test.ts`, with exactly this content:

```ts
// The Docs reader's compact head, its stylesheet half (the phone-header plan of 2026-11-03, Task 3). vitest evaluates no
// stylesheet and jsdom lays nothing out, so this file holds docs.css's own declarations for the compact head: the screen
// gives the row the top, the row's controls take a whole tap, a closed panel is not drawn, "Formatting…" lies over the
// frame's host, and no rule keys on a width (the head's component alone decides when the row is drawn). The pixels are
// browser/docs-compact-head.browser.test.ts's; the colours are contrast.test.ts's, through design/audit.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declValue, effectiveValue, ruleIn, stripComments } from './cssRule';

const docsCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');
const SCREEN = '.docs-screen:has(> .docs-compact)';
const LEAF = `${SCREEN} > .docs-leaf:has(> .docs-reader)`;

describe('the compact head in docs.css (the phone-header plan, refinements (d), (e), (f), (i), (k))', () => {
  it('the screen gives the row the top: no padding above it and a 4 px gap under it; its sides and bottom as before', () => {
    const rule = ruleIn(docsCss, SCREEN);
    expect(declValue(rule, 'padding-top')).toBe('0');
    expect(declValue(rule, 'gap')).toBe('var(--sp-1)');
    expect(declValue(rule, 'padding')).toBeNull();
    expect(declValue(ruleIn(docsCss, '.docs-screen'), 'padding')).toBe('var(--sp-2)');
  });

  it('the row is one tap tall with the mockup\'s 1 px divider inside that height; the label gives way to the controls', () => {
    const bar = ruleIn(docsCss, '.docs-compact-bar');
    expect(declValue(bar, 'block-size')).toBe('var(--tap-min)');
    expect(declValue(bar, 'border-block-end')).toBe('1px solid var(--edge-subtle)');
    expect(declValue(ruleIn(docsCss, '.docs-compact-label'), 'min-width')).toBe('0');
    expect(declValue(ruleIn(docsCss, '.docs-compact-crumbs'), 'display')).toBe('flex');
  });

  it('the first line\'s text and the name end in an ellipsis; the draft badge beside the text never shrinks (refinement (g))', () => {
    for (const sel of ['.docs-compact-where-text', '.docs-compact-name']) {
      const lines = ruleIn(docsCss, sel);
      expect(declValue(lines, 'overflow'), sel).toBe('hidden');
      expect(declValue(lines, 'text-overflow'), sel).toBe('ellipsis');
      expect(declValue(lines, 'white-space'), sel).toBe('nowrap');
    }
    expect(declValue(ruleIn(docsCss, '.docs-compact-where'), 'display')).toBe('flex');
    expect(declValue(ruleIn(docsCss, '.docs-compact-where'), 'overflow')).toBeNull();
    expect(declValue(ruleIn(docsCss, '.docs-compact-where .docs-badge'), 'flex')).toBe('none');
  });

  it('the crumb and the ref are two spans, each cut at its own end, the crumb giving way first, so a long directory never hides the ref (refinement (g))', () => {
    // The first line's text also sits in the grouped ellipsis rule, so its flex line is read over every rule naming it.
    expect(effectiveValue(docsCss, '.docs-compact-where-text', 'display')).toBe('flex');
    expect(effectiveValue(docsCss, '.docs-compact-where-text', 'min-width')).toBe('0');
    const crumb = ruleIn(docsCss, '.docs-compact-where-crumb');
    const ref = ruleIn(docsCss, '.docs-compact-where-ref');
    for (const [sel, rule] of [['crumb', crumb], ['ref', ref]] as const) {
      expect(declValue(rule, 'min-width'), sel).toBe('0');
      expect(declValue(rule, 'overflow'), sel).toBe('hidden');
      expect(declValue(rule, 'text-overflow'), sel).toBe('ellipsis');
    }
    expect(declValue(crumb, 'white-space')).toBe('nowrap');
    // The ref's span opens with the separator's space, which a flex item drops under `nowrap`.
    expect(declValue(ref, 'white-space')).toBe('pre');
    const shrink = (rule: string): number => Number(/^0\s+(\d+)\s+auto$/.exec(declValue(rule, 'flex') ?? '')?.[1] ?? Number.NaN);
    expect(shrink(ref)).toBe(1);
    expect(shrink(crumb), 'the crumb shrinks first').toBeGreaterThan(shrink(ref));
  });

  it('Share and Export on the row are a whole tap wide with no underline, and a disabled one is dimmed, not recoloured', () => {
    const icon = ruleIn(docsCss, '.docs-compact-bar .docs-action');
    expect(declValue(icon, 'min-width')).toBe('var(--tap-min)');
    expect(declValue(icon, 'justify-content')).toBe('center');
    expect(declValue(icon, 'text-decoration')).toBe('none');
    const off = ruleIn(docsCss, '.docs-compact-bar .docs-action:disabled');
    expect(declValue(off, 'opacity')).toBe('0.35');
    expect(declValue(off, 'color')).toBeNull();
  });

  it('Page details is a tap square holding its dot (never fetched and failed in the mockup\'s one attention colour), and an open one paints its own pressed ground and ink', () => {
    const more = ruleIn(docsCss, '.docs-more');
    expect(declValue(more, 'min-width')).toBe('var(--tap-min)');
    expect(declValue(more, 'min-height')).toBe('var(--tap-min)');
    expect(declValue(more, 'position')).toBe('relative');
    const open = ruleIn(docsCss, ".docs-more[aria-expanded='true']");
    expect(declValue(open, 'background')).toBe('var(--bg-pressed)');
    expect(declValue(open, 'color')).toBe('var(--ink-primary)');
    expect(declValue(ruleIn(docsCss, '.docs-more-dot'), 'position')).toBe('absolute');
    expect(['ok', 'warn', 'failed'].map((tone) => declValue(ruleIn(docsCss, `.docs-more-dot[data-tone='${tone}']`), 'background')))
      .toEqual(['var(--status-done)', 'var(--status-attention)', 'var(--status-attention)']);
  });

  it('a closed panel is not drawn: its own display gives way to [hidden]', () => {
    expect(declValue(ruleIn(docsCss, '.docs-more-panel'), 'display')).toBe('grid');
    expect(declValue(ruleIn(docsCss, '.docs-more-panel[hidden]'), 'display')).toBe('none');
  });

  it('"Formatting…" lies over the frame host on the compact screen, on the page\'s own ground', () => {
    expect(declValue(ruleIn(docsCss, LEAF), 'position')).toBe('relative');
    const over = ruleIn(docsCss, `${LEAF} > .doc-formatting`);
    expect(declValue(over, 'position')).toBe('absolute');
    expect(declValue(over, 'inset-block-start')).toBe('0');
    expect(declValue(over, 'background')).toBe('var(--bg-page)');
  });

  it('no rule keys the compact head on a width: the one max-width block is the reader layout\'s, as before (refinement (b))', () => {
    const text = stripComments(docsCss);
    expect(text).not.toMatch(/599/);
    const blocks = [...text.matchAll(/@media[^{]*max-width[^{]*\{/g)].map((m) => m[0]);
    expect(blocks).toEqual(['@media (max-width: 899.98px) {']);
  });
});
```

  and, in `pwa/test/tap-targets.test.tsx`, the floor half and one loop line:
  Find (`pwa/test/tap-targets.test.tsx`, quoted from `b55e96a75`):
```tsx
    expect(await screen.findByRole('button', { name: EXPORT_TEXT.retry })).toHaveClass('min-h-tap');
  });
});
```
  Replace:
```tsx
    expect(await screen.findByRole('button', { name: EXPORT_TEXT.retry })).toHaveClass('min-h-tap');
  });
});

// — the Docs reader's compact head (the phone-header plan of 2026-11-03): Page details, and Share and Export as the
// row's icons. The floor half; the render half is the describe after it, which lands with the head itself. —
describe('the compact head: .docs-more and the row’s .docs-action icons are a whole tap (docs phone header)', () => {
  it('are at least one tap tall and one tap wide, off the shared token', () => {
    expect(floorIn(docsCss, '.docs-more')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(docsCss, '.docs-more'), 'min-width')).toBe('var(--tap-min)');
    expect(floorIn(docsCss, '.docs-action')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(docsCss, '.docs-compact-bar .docs-action'), 'min-width')).toBe('var(--tap-min)');
  });
});
```
  Find (`pwa/test/tap-targets.test.tsx`, quoted from `5fcc4268a`):
```tsx
      ruleIn(docsCss, '.btn-ghost.docs-banner-action'), ruleIn(docsCss, '.doc-img-link'),
```
  Replace:
```tsx
      ruleIn(docsCss, '.btn-ghost.docs-banner-action'), ruleIn(docsCss, '.doc-img-link'),
      ruleIn(docsCss, '.docs-more'),
```
- [ ] **Step 2: Run them to see them fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-compact-css.test.ts test/tap-targets.test.tsx )` — Expected (prediction): `docs-compact-css.test.ts` 7 failed, 1 passed (every case but the width one throws `no rule for …`; `no rule keys the compact head on a width` is green at BASE); `tap-targets.test.tsx` 2 failed (the new floor case, and the 44px loop at `no rule for .docs-more`).
- [ ] **Step 3: Write the rules.** In `pwa/src/docs/docs.css`:
  Find (`pwa/src/docs/docs.css`, quoted from `5fcc4268a`):
```css
.docs-export-note { margin: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }
```
  Replace:
```css
.docs-export-note { margin: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }

/* — the compact head (the phone-header plan of 2026-11-03). A leaf page under 600 CSS px draws one row, `CompactHead` in
   DocsHead.tsx, and the head's component alone decides when (`headLayoutFor`). So every rule here keys on the head's own
   classes and none on a width: a tablet and a desktop never render them, and a phone's listings keep the rules above.
   The row is back (`.docs-back`), two lines naming where and what, Share and Export as icons (`.docs-action`, as in the
   full header, given a whole tap's width here), and Page details (`.docs-more`); the panel under it holds the crumbs,
   the truth line and the link actions, closed until Page details opens it. While the tree slot is not `ok` the head is
   back and the crumbs (`.docs-compact-crumbs`), as the full header's is. The row is one tap tall with the picked
   mockup's 1 px divider inside that height (box-sizing is border-box everywhere, reset.css), so the row and the 4 px gap
   under it are the console's whole part above the frame. The first line's draft badge sits beside its text, never
   inside the part that ends in an ellipsis. That part is two spans, the parent crumb and the served ref, each cut at its
   own end, the crumb giving way first (a flex-shrink a thousand times the ref's), so a long parent directory never hides
   which ref is served; the ref's span holds the ` · ` separator, so it keeps its spaces (`white-space: pre`: a flex item
   drops a leading space under `nowrap`). GROUNDS: the row, the label and the panel paint nothing, so everything here
   sits on body's --bg-page as the full header does (design/audit.mjs registers `.docs-compact-where` and `.docs-more`
   there); an open `.docs-more` paints its own pressed ground and ink and is measured on it; the dot paints a status fill
   and sets no ink. A disabled icon is dimmed by opacity, registered in design/audit.mjs's OPACITY_REGISTRY beside the
   `.bell:disabled` fade it follows, because every docs rule that sets a colour is measured and none is exempt. — */
.docs-screen:has(> .docs-compact) { padding-top: 0; gap: var(--sp-1); }
.docs-compact-bar {
  display: flex; align-items: center; min-width: 0;
  block-size: var(--tap-min);
  border-block-end: 1px solid var(--edge-subtle);
}
.docs-compact-crumbs { display: flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.docs-compact-label { flex: 1 1 auto; min-width: 0; margin: 0; }
.docs-compact-where-text, .docs-compact-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.docs-compact-where {
  display: flex; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap;
  font: var(--weight-regular) var(--text-2xs) / var(--leading-tight) var(--font-mono);
  color: var(--ink-secondary);
}
.docs-compact-where-text { flex: 0 1 auto; min-width: 0; display: flex; }
.docs-compact-where-crumb { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.docs-compact-where-ref { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; }
.docs-compact-where .docs-badge { flex: none; }
.docs-compact-name { display: block; font: var(--weight-medium) var(--text-md) / var(--leading-tight) var(--font-ui); }
.docs-compact-bar .docs-action { justify-content: center; min-width: var(--tap-min); padding: 0; text-decoration: none; }
.docs-compact-bar .docs-action:disabled { opacity: 0.35; }
.docs-more {
  position: relative; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--tap-min); min-width: var(--tap-min);
  border: 0; border-radius: var(--r-md);
  background: none; color: var(--ink-secondary);
  cursor: pointer;
}
.docs-more[aria-expanded='true'] { background: var(--bg-pressed); color: var(--ink-primary); }
.docs-more-dot {
  position: absolute; inset-block-start: var(--sp-2); inset-inline-end: var(--sp-2);
  inline-size: var(--sp-2); block-size: var(--sp-2); border-radius: var(--r-full);
}
.docs-more-dot[data-tone='ok'] { background: var(--status-done); }
.docs-more-dot[data-tone='warn'], .docs-more-dot[data-tone='failed'] { background: var(--status-attention); }
.docs-more-panel { display: grid; gap: var(--sp-2); min-width: 0; padding-block-end: var(--sp-2); }
.docs-more-panel[hidden] { display: none; }
/* "Formatting…" lies over the frame's host instead of taking a line above it, so the frame does not move when the
   reader is ready. It paints the page's own ground, so its registered ink (.doc-formatting, on --bg-page) holds there. */
.docs-screen:has(> .docs-compact) > .docs-leaf:has(> .docs-reader) { position: relative; }
.docs-screen:has(> .docs-compact) > .docs-leaf:has(> .docs-reader) > .doc-formatting {
  position: absolute; inset-block-start: 0; inset-inline: 0; z-index: 1;
  padding: var(--sp-2); background: var(--bg-page);
}
```
- [ ] **Step 4: See the contrast census ask for the two grounds and the fade.** `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )` through `ccrc test` — Expected (prediction): red in `'measures every docs rule that sets a colour in both themes, at or above its floor'`, naming `.docs-compact-where` and `.docs-more` as uncovered (`.docs-more[aria-expanded='true']` paints its own ground and is measured on it), and in `'.docs-compact-bar .docs-action:disabled 0.35 is registered with a contrast decision'`, the new `it.each` case for the unregistered fade (the auditor also lists it in `report.problems` as `unregistered fade .docs-compact-bar .docs-action:disabled 0.35`).
- [ ] **Step 5: Register them.** In `pwa/design/audit.mjs`, the two grounds:
  Find (`pwa/design/audit.mjs`, quoted from `5fcc4268a`):
```js
  '.docs-crumb, .docs-crumbs-more': {
    under: ['var(--bg-page)'],
    why: "the crumb links and the phone's leading … button, in .docs-crumbs on the same unpainted .docs-head-bar as .docs-back, so the same --bg-page",
  },
```
  Replace:
```js
  '.docs-crumb, .docs-crumbs-more': {
    under: ['var(--bg-page)'],
    why: "the crumb links and the phone's leading … button, in .docs-crumbs on the same unpainted .docs-head-bar as .docs-back, so the same --bg-page",
  },
  // The compact head (the phone-header plan of 2026-11-03): a leaf page's one row under 600 CSS px. Its row, label and
  // panel paint nothing, so the full header's ground and reasoning hold.
  '.docs-compact-where': {
    under: ['var(--bg-page)'],
    why: "the compact row's first line (the parent crumb and a served ref that is not origin's default, in .docs-compact-where-text, then the draft badge beside it), a flex line in the unpainted .docs-compact-label inside the unpainted .docs-compact-bar and .docs-head on .docs-screen, so --bg-page, the .docs-crumb reasoning; the badge paints its own ground",
  },
  '.docs-more': {
    under: ['var(--bg-page)'],
    why: "the compact row's Page details button while closed: `background: none` in the unpainted .docs-compact-bar, so --bg-page, as .docs-back beside it. Open, `.docs-more[aria-expanded='true']` paints --bg-pressed with --ink-primary and is measured on that ground as a self-grounded rule of its own",
  },
```
  and the fade, beside the `.bell:disabled` fade it follows (exactly one of `pairs` or `noText`, a `noText` over 20 characters):
  Find (`pwa/design/audit.mjs`, quoted from `5fcc4268a`):
```js
  '.bell:disabled 0.35': { noText: 'WCAG 1.4.3 exempts inactive controls' },
```
  Replace:
```js
  '.bell:disabled 0.35': { noText: 'WCAG 1.4.3 exempts inactive controls' },
  // The compact Docs head (the phone-header plan of 2026-11-03): Share's or Export's icon while it waits. The icon is
  // aria-hidden and the button's accessible name carries the words; the Page details panel shows them unfaded.
  '.docs-compact-bar .docs-action:disabled 0.35': {
    noText: 'WCAG 1.4.3 exempts inactive controls; a waiting Share or Export icon, whose words are its accessible name and an unfaded line in the Page details panel',
  },
```
- [ ] **Step 6: Run them to see them pass.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-compact-css.test.ts test/tap-targets.test.tsx )` — `docs-compact-css.test.ts` 8 passed; `tap-targets.test.tsx` its BASE count plus one, all green. `contrast.test.ts` through `ccrc test` — green, its BASE count plus one (the new fade's `it.each` case; the docs describe's lower bounds, 28 colour rules and 20 registrations, still hold, and its opacity registry is one entry longer with nothing stale). `( cd pwa && ./node_modules/.bin/vitest run test/shell-css.test.ts test/motion-reduced.test.ts test/control-census.test.ts )` — green. `TSC-OK`.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/docs.css pwa/design/audit.mjs pwa/test/docs-compact-css.test.ts pwa/test/tap-targets.test.tsx` (expect 4), message `pwa: the compact Docs head's stylesheet, its grounds and its fade (docs phone header)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| PHH-T3-M1 | (i) | `src/docs/docs.css` | `.docs-screen:has(> .docs-compact) { padding-top: 0; gap: var(--sp-1); }` → `.docs-screen:has(> .docs-compact) { gap: var(--sp-1); }` | `docs-compact-css` | 1 failed — `'the screen gives the row the top: …'` |
| PHH-T3-M2 | (d) | `src/docs/docs.css` | `.docs-more-panel[hidden] { display: none; }` → removed | `docs-compact-css` | 1 failed — `'a closed panel is not drawn: …'` |
| PHH-T3-M3 | (k) | `src/docs/docs.css` | `min-height: var(--tap-min); min-width: var(--tap-min);` → `min-width: var(--tap-min);` | `docs-compact-css`, `tap-targets` | 2 failed — `'Page details is a tap square holding its dot …'`; `'are at least one tap tall and one tap wide, off the shared token'` |
| PHH-T3-M4 | (e) | `src/docs/docs.css` | `.docs-compact-bar .docs-action { justify-content: center; min-width: var(--tap-min); padding: 0; text-decoration: none; }` → `.docs-compact-bar .docs-action { justify-content: center; padding: 0; text-decoration: none; }` | `docs-compact-css`, `tap-targets` | 2 failed — `'Share and Export on the row are a whole tap wide …'`; the tap-targets floor case |
| PHH-T3-M5 | (i) | `src/docs/docs.css` | `position: absolute; inset-block-start: 0; inset-inline: 0; z-index: 1;` → `inset-block-start: 0; inset-inline: 0; z-index: 1;` | `docs-compact-css` | 1 failed — `'"Formatting…" lies over the frame host …'` |
| PHH-T3-M6 | (f) | `src/docs/docs.css` | `.docs-more-dot[data-tone='warn'], .docs-more-dot[data-tone='failed'] { background: var(--status-attention); }` → `.docs-more-dot[data-tone='warn'], .docs-more-dot[data-tone='failed'] { background: var(--status-done); }` | `docs-compact-css` | 1 failed — `'Page details is a tap square holding its dot …'` |
| PHH-T3-M7 | (k) | `design/audit.mjs` | `'.docs-more': {` → `'.docs-more-gone': {` | `contrast` | at least 1 failed — `'measures every docs rule that sets a colour …'` (the audit may also refuse the key that matches no rule; measured reds are restated) |
| PHH-T3-M8 | (k) | `design/audit.mjs` | `'.docs-compact-where': {` → `'.docs-compact-where-gone': {` | `contrast` | at least 1 failed — as PHH-T3-M7 |
| PHH-T3-M9 | (k) | `design/audit.mjs` | `'.docs-compact-bar .docs-action:disabled 0.35': {` → `'.docs-compact-bar .docs-action:disabled 0.5': {` | `contrast` | at least 2 failed — `'.docs-compact-bar .docs-action:disabled 0.35 is registered with a contrast decision'`; `'has no stale opacity registry entry …'` (and `report.problems`, where asserted) |
| PHH-T3-M10 | (i) | `src/docs/docs.css` | `block-size: var(--tap-min);` → removed | `docs-compact-css` | 1 failed — `'the row is one tap tall with the mockup's 1 px divider inside that height; …'` |
| PHH-T3-M11 | (i) | `src/docs/docs.css` | `border-block-end: 1px solid var(--edge-subtle);` → removed | `docs-compact-css` | 1 failed — as PHH-T3-M10 |
| PHH-T3-M12 | (a) | `src/docs/docs.css` | `.docs-more-panel[hidden] { display: none; }` → `.docs-more-panel[hidden] { display: none; } @media (max-width: 599.98px) { .docs-compact-bar { gap: 0; } }` | `docs-compact-css` | 1 failed — `'no rule keys the compact head on a width: …'` |
| PHH-T3-M13 | (g) | `src/docs/docs.css` | `.docs-compact-where .docs-badge { flex: none; }` → removed | `docs-compact-css` | 1 failed — `'the first line's text and the name end in an ellipsis; the draft badge beside the text never shrinks …'` |

```json
[
  {"id": "PHH-T3-M1", "spec": "(i)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-screen:has(> .docs-compact) { padding-top: 0; gap: var(--sp-1); }", "new": ".docs-screen:has(> .docs-compact) { gap: var(--sp-1); }", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: the screen gives the row the top"},
  {"id": "PHH-T3-M2", "spec": "(d)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-more-panel[hidden] { display: none; }", "new": "", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: a closed panel is not drawn"},
  {"id": "PHH-T3-M3", "spec": "(k)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "min-height: var(--tap-min); min-width: var(--tap-min);", "new": "min-width: var(--tap-min);", "tests": ["test/docs-compact-css.test.ts", "test/tap-targets.test.tsx"], "red": "2 failed: Page details is a tap square holding its dot; are at least one tap tall and one tap wide, off the shared token"},
  {"id": "PHH-T3-M4", "spec": "(e)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-compact-bar .docs-action { justify-content: center; min-width: var(--tap-min); padding: 0; text-decoration: none; }", "new": ".docs-compact-bar .docs-action { justify-content: center; padding: 0; text-decoration: none; }", "tests": ["test/docs-compact-css.test.ts", "test/tap-targets.test.tsx"], "red": "2 failed: Share and Export on the row are a whole tap wide; are at least one tap tall and one tap wide, off the shared token"},
  {"id": "PHH-T3-M5", "spec": "(i)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "position: absolute; inset-block-start: 0; inset-inline: 0; z-index: 1;", "new": "inset-block-start: 0; inset-inline: 0; z-index: 1;", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: Formatting lies over the frame host"},
  {"id": "PHH-T3-M6", "spec": "(f)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-more-dot[data-tone='warn'], .docs-more-dot[data-tone='failed'] { background: var(--status-attention); }", "new": ".docs-more-dot[data-tone='warn'], .docs-more-dot[data-tone='failed'] { background: var(--status-done); }", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: Page details is a tap square holding its dot"},
  {"id": "PHH-T3-M7", "spec": "(k)", "pkg": "pwa", "file": "design/audit.mjs", "old": "'.docs-more': {", "new": "'.docs-more-gone': {", "tests": ["test/contrast.test.ts"], "red": "at least 1 failed: measures every docs rule that sets a colour in both themes"},
  {"id": "PHH-T3-M8", "spec": "(k)", "pkg": "pwa", "file": "design/audit.mjs", "old": "'.docs-compact-where': {", "new": "'.docs-compact-where-gone': {", "tests": ["test/contrast.test.ts"], "red": "at least 1 failed: measures every docs rule that sets a colour in both themes"},
  {"id": "PHH-T3-M9", "spec": "(k)", "pkg": "pwa", "file": "design/audit.mjs", "old": "'.docs-compact-bar .docs-action:disabled 0.35': {", "new": "'.docs-compact-bar .docs-action:disabled 0.5': {", "tests": ["test/contrast.test.ts"], "red": "at least 2 failed: .docs-compact-bar .docs-action:disabled 0.35 is registered with a contrast decision; has no stale opacity registry entry"},
  {"id": "PHH-T3-M10", "spec": "(i)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "block-size: var(--tap-min);", "new": "", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: the row is one tap tall with the mockup's 1 px divider inside that height"},
  {"id": "PHH-T3-M11", "spec": "(i)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "border-block-end: 1px solid var(--edge-subtle);", "new": "", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: the row is one tap tall with the mockup's 1 px divider inside that height"},
  {"id": "PHH-T3-M12", "spec": "(a)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-more-panel[hidden] { display: none; }", "new": ".docs-more-panel[hidden] { display: none; } @media (max-width: 599.98px) { .docs-compact-bar { gap: 0; } }", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: no rule keys the compact head on a width"},
  {"id": "PHH-T3-M13", "spec": "(g)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-compact-where .docs-badge { flex: none; }", "new": "", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: the first line's text and the name end in an ellipsis; the draft badge beside the text never shrinks"}
]
```

**Verify:** `docs-compact-css.test.ts` 8 passed; `tap-targets.test.tsx` and `contrast.test.ts` green (the latter one case more than BASE); `TSC-OK`.

### Task 4: The compact head (refinements (a) to (h))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `opus` (the page's truth, accessibility, and the full header unchanged).

**Files:**
- Create: `pwa/test/docs-compact-head.test.tsx`.
- Modify: `pwa/src/docs/DocsHead.tsx` (eleven blocks, in order), `pwa/src/docs/docsText.ts` (one), `pwa/test/control-census.test.ts` (one entry), `pwa/test/tap-targets.test.tsx` (one import, the render half).
- Guards (not edited): `pwa/src/docs/ReaderFrame.tsx` (PHH-T4-M20 mutates it and restores it), `pwa/test/docs-screen.test.tsx`, `pwa/test/docs-truth.test.tsx`, `pwa/test/refined-phone.test.tsx`, `pwa/test/docs-scans.test.ts`, `pwa/test/shell-css.test.ts`, `pwa/test/sheet-desktop-arm.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`, `server/test/docs-parity.test.ts`, `server/test/citations.test.ts`.

**Interfaces:** Produces `DOCS_COMPACT_QUERY`, `type HeadLayout`, `headLayoutFor(compactWidth, page): HeadLayout`, `type FreshDot`, `freshDot(state: FreshChipState): FreshDot` (all exported from `DocsHead.tsx`); module-private `shareWords`, `exportWords`, `useHeadActions`, `BackButton`, `rowBadge`, `CompactLabel`, `rowRefText`, `CompactHead`, `CompactRow`; `DOCS_HEAD_TEXT.exportPlainHint`, `.shareBusy`, `.more`, `.moreNever`, `.moreFailed`.

**Decisions:** (1) `CompactHead` is keyed by `docsPageUrl(page)`, so a navigation (another leaf, another ref, `view=committed`) closes the panel and drops nothing else: `DocsScreen` stays mounted for the visit. (2) The panel's notes for a waiting Share or Export are plain `<p class="docs-note">`, not `role="status"`, so a screen reader is not told twice (the icon's name already says it). (3) `CompactRow` calls `useHeadActions` once and draws the four actions in two places; `Actions` calls it once and draws today's line. (4) While the tree slot is not `ok` (loading, or failed), `CompactHead` draws back and the crumbs, as the full header does (spec 4.7: "a tree failure replaces the listing and keeps the crumbs"), in `.docs-compact-crumbs`, which has no fixed height, so a long path may wrap; the row and its panel need the tree. (5) A dangling `origin/HEAD` falls to the next rung of the default chain, so its `via` is never `default:origin-head` and `rowRefText` names the served ref (measured in `ccd/ccd#default_chain` while planning: the chain records `dangling` in `tried` and goes on).

- [ ] **Step 0: Base and claims.** `git grep -qF "function Actions(p: {" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "export function useMediaQuery" HEAD -- ui/src/lib/use-media-query.ts && git grep -qF "ellipsis: [" HEAD -- ui/src/icons/lucide.ts && git grep -qF ".docs-screen:has(> .docs-compact)" HEAD -- pwa/src/docs/docs.css && ! git grep -qF "DOCS_COMPACT_QUERY" HEAD -- pwa && echo T4-BASE-OK` — Expected: `T4-BASE-OK` (Tasks 2 and 3 landed). Confirm the claims on the four edited files. Record the BASE counts of `docs-screen.test.tsx`, `docs-truth.test.tsx`, `refined-phone.test.tsx`, `docs-scans.test.ts` and `control-census.test.ts` (each alone).
- [ ] **Step 1: Write the failing test,** `pwa/test/docs-compact-head.test.tsx`, with exactly this content:

```tsx
// The Docs reader's compact head (the phone-header plan of 2026-11-03, Task 4). Under DOCS_COMPACT_QUERY a leaf page
// draws one row (back, where and what, Share and Export as icons, Page details) and keeps the crumbs, the truth line and
// the link actions in a panel Page details opens; a tablet, a desktop and every listing keep the full header. jsdom lays
// nothing out, so this file holds the markup: which header, the names and their order, the panel's states, keyboard,
// the words the row keeps for the page's truth, and where the notes go. The stylesheet is docs-compact-css.test.ts's and
// the pixels are browser/docs-compact-head.browser.test.ts's. `atWidth` answers a width query as a real engine would
// (refined-phone.test.tsx#atWidth's form); setup.ts's default answers false to every query, which is the full header.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { entryView } from '../../shared/docs';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DOCS_COMPACT_QUERY, freshDot, headLayoutFor } from '../src/docs/DocsHead';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import { DOCS_BANNER_TEXT, DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, EXPORT_WAIT_TEXT, fillSentence, servedRefText, shortCommit } from '../src/docs/docsText';
import type { DocsFileAnswer, DocsLoaders, DocsTreeAnswer } from '../src/docs/failures';
import { HighlighterContext } from '../src/lib/highlighterContext';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate, useLocation } from '../src/lib/router';
import {
  COMMIT_A, draftOf, entry, fakeLoaders, fileResponse, holder, okFile, okTree, pageAt, treeOk, type FakeLoaders,
} from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

/** matchMedia at `width`: a min-width or max-width query answered as an engine at that width answers it. */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]))
      && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

/** Parses in this thread, as the worker would. */
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** A parse that never answers: a Markdown leaf stays on "Formatting…" and publishes no body. */
const heldParser: MarkdownParser = () => new Promise<never>(() => {});

/** The screen under the live location, as the app's `docs` arm mounts it (one mount across navigations). */
function Routed(p: { readonly loaders: DocsLoaders; readonly reader: ReaderDeps | null; readonly parser?: MarkdownParser }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={p.parser ?? parser} reader={p.reader} />;
}

function open(url: string, f: FakeLoaders, reader: ReaderDeps | null = null, withParser?: MarkdownParser): ReturnType<typeof render> {
  navigate(url);
  return render(<Routed loaders={f.loaders} reader={reader} parser={withParser} />);
}

/** "Export: <words>", the name a waiting Export carries and the panel's line for it. */
const exportBusy = (words: string): string => fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words });

const more = (): HTMLElement => screen.getByRole('button', { name: /^Page details/ });
const panel = (): HTMLElement => {
  const el = document.getElementById(more().getAttribute('aria-controls') ?? '');
  if (el === null) throw new Error('Page details controls no element');
  return el;
};
const bar = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.docs-compact-bar');
  if (el === null) throw new Error('no compact row');
  return el;
};
/** A reader whose render never answers: the frame's arm stays up, so the leaf shows the reader (Export's plain view). */
const heldReader = (): ReaderDeps =>
  ({ render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() }) as unknown as ReaderDeps;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('which header a page draws (refinements (a), (b))', () => {
  it.each([
    [true, '/docs/demo/specs/a.md', 'compact'],
    [true, '/docs/demo/specs/d/x.md?ref=main', 'compact'],
    [true, '/docs/demo/specs/d/', 'full'],
    [true, '/docs/demo/specs', 'full'],
    [true, '/docs/demo', 'full'],
    [true, '/docs', 'full'],
    [false, '/docs/demo/specs/a.md', 'full'],
  ] as const)('compact width %s, %s: %s', (compactWidth, url, want) => {
    expect(headLayoutFor(compactWidth, pageAt(url))).toBe(want);
  });

  it('the compact width is under 600 CSS px, and only DocsHead.tsx spells it under pwa/src', () => {
    expect(DOCS_COMPACT_QUERY).toBe('(max-width: 599.98px)');
    const src = path.join(import.meta.dirname, '..', 'src');
    const spelled = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(tsx?|css)$/.test(d.name))
      .map((d) => path.join(d.parentPath, d.name))
      .filter((f) => readFileSync(f, 'utf8').includes('599.98'))
      .map((f) => path.relative(src, f).split(path.sep).join('/'));
    expect(spelled).toEqual(['docs/DocsHead.tsx']);
  });

  it.each([
    [390, true], [599, true], [600, false], [768, false], [1280, false],
  ] as const)('at %ipx a leaf draws the compact row: %s; the full header keeps its line of actions', async (width, compact) => {
    atWidth(width);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    expect(document.querySelector('.docs-head.docs-compact') !== null).toBe(compact);
    // The full header's truth line is on the page at once; the row's is behind Page details.
    expect(screen.queryByRole('button', { name: DOCS_HEAD_TEXT.copyCommit }) !== null).toBe(!compact);
    if (!compact) {
      expect([...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.textContent))
        .toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]);
    }
  });

  it.each(['/docs/demo/specs', '/docs/demo', '/docs/demo/specs/d/'])('%s at 390px keeps the full header', async (url) => {
    atWidth(390);
    open(url, fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md')] })) }));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.copyCommit })).toBeInTheDocument();
    expect(document.querySelector('.docs-compact')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Page details/ })).toBeNull();
  });
});

describe('the compact row (refinements (c), (e), (g))', () => {
  it('reads back, Share, Export and Page details, in that order, each named; Share and Export draw an icon and no word', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await waitFor(() => expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.export })).toBeEnabled());
    expect(within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual([DOCS_HEAD_TEXT.back, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export, DOCS_HEAD_TEXT.moreNever]);
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe('specs');
    expect(bar().querySelector('.docs-compact-name')?.textContent).toBe('a.md');
    for (const name of [DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.export]) {
      const b = within(bar()).getByRole('button', { name });
      expect(b.querySelector('svg[aria-hidden="true"]'), name).not.toBeNull();
      expect(b.textContent, name).toBe('');
    }
  });

  it.each(['loading', 'unreachable'] as const)('while the tree slot is %s, the head is back and the crumbs (spec 4.7: a tree failure keeps the crumbs)', async (slot) => {
    atWidth(412);
    const f = fakeLoaders();
    if (slot === 'loading') f.tree.mockImplementation(() => new Promise<DocsTreeAnswer>(() => {}));
    else f.tree.mockResolvedValue({ s: 'unreachable' });
    open('/docs/demo/specs/d/x.md', f);
    await waitFor(() => expect(document.querySelector('.docs-compact .docs-compact-crumbs')).not.toBeNull());
    const head = document.querySelector('.docs-compact-crumbs') as HTMLElement;
    expect(within(head).getByRole('button', { name: DOCS_HEAD_TEXT.back })).toHaveClass('docs-back');
    expect(within(head).getByRole('link', { name: 'd' })).toHaveClass('docs-crumb');
    expect(within(head).getByRole('button', { name: DOCS_HEAD_TEXT.crumbsMore })).toHaveClass('docs-crumbs-more');
    expect(head.querySelector('[aria-current="page"]')?.textContent).toBe('x.md');
    expect(document.querySelector('.docs-compact-label')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Page details/ })).toBeNull();
  });

  it('a ref view names its served ref on the row, and a draft leaf its badge, in the truth line\'s words (refinement (g))', async () => {
    atWidth(412);
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge, 'the fixture opens a badged draft').not.toBeNull();
    const where = bar().querySelector('.docs-compact-where') as HTMLElement;
    expect(where.textContent).toBe(`specs · ${servedRefText(tree.ref)} · ${ENTRY_BADGE_TEXT[badge!]}`);
    // The ref is in the text that ends in an ellipsis; the badge is its sibling, so a long ref is cut and the badge never is.
    expect([...where.children].map((c) => c.className)).toEqual(['docs-compact-where-text', 'docs-badge']);
    expect(where.querySelector('.docs-compact-where-text')?.textContent).toBe(`specs · ${servedRefText(tree.ref)}`);
    expect(where.querySelector('.docs-badge')?.textContent).toBe(ENTRY_BADGE_TEXT[badge!]);
    cleanup();
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(bar().querySelector('.docs-compact-where')?.textContent, 'the default view on origin/HEAD adds nothing').toBe('specs');
  });

  it('a ref view of a nested leaf draws the parent directory and the ref as two spans, the ref with its separator (refinement (g))', async () => {
    atWidth(412);
    const tree = treeOk({ entries: [entry('specs', 'd/x.md')] });
    open('/docs/demo/specs/d/x.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const where = bar().querySelector('.docs-compact-where') as HTMLElement;
    expect(where.textContent).toBe(`d · ${servedRefText(tree.ref)}`);
    expect([...where.children].map((c) => c.className)).toEqual(['docs-compact-where-text']);
    const text = where.querySelector('.docs-compact-where-text') as HTMLElement;
    // Each is cut at its own end (docs.css), so a long directory never takes the whole line from the ref.
    expect([...text.children].map((c) => [c.className, c.textContent])).toEqual([
      ['docs-compact-where-crumb', 'd'],
      ['docs-compact-where-ref', ` · ${servedRefText(tree.ref)}`],
    ]);
    cleanup();
    open('/docs/demo/specs/d/x.md', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect([...bar().querySelectorAll('.docs-compact-where-text > *')].map((c) => c.className), 'no ref, no ref span')
      .toEqual(['docs-compact-where-crumb']);
  });

  it('on view=committed of a draft leaf the row keeps its ref and draft badge and says nothing of the view; the banner under it does (refinement (g), (h))', async () => {
    atWidth(412);
    const e = entry('specs', 'a.md', { draft: draftOf('modified') });
    const tree = treeOk({ entries: [e], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main&view=committed', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    const badge = entryView(e, tree.drafts, 'ref').badge;
    expect(badge, 'the fixture opens a badged draft').not.toBeNull();
    // The row is the draft view's row, byte for byte; the view is told by the banner in the flow, not by the row.
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe(`specs · ${servedRefText(tree.ref)} · ${ENTRY_BADGE_TEXT[badge!]}`);
    const banner = await screen.findByText(fillSentence(DOCS_BANNER_TEXT.viewCommitted, { short: shortCommit(tree.ref.commit) }));
    expect(bar().contains(banner) || panel().contains(banner), 'the banner is outside the row and its panel').toBe(false);
    expect(within(banner.closest('.docs-screen') as HTMLElement).getByRole('link', { name: DOCS_BANNER_TEXT.backToDraft })).toBeInTheDocument();
  });

  it('a default view served from anywhere but origin/HEAD names its served ref on the row (refinement (g))', async () => {
    atWidth(412);
    const base = treeOk();
    const tree = { ...base, ref: { ...base.ref, served: 'refs/heads/main', side: 'local' as const, via: 'default:local-main' as const } };
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(servedRefText(tree.ref)).toBe('main (local)');
    expect(bar().querySelector('.docs-compact-where')?.textContent).toBe('specs · main (local)');
  });

  it('while the leaf moves to its pin, Share and Export are disabled and named for it, and the panel says why (refinement (e))', async () => {
    atWidth(412);
    const f = fakeLoaders();
    f.file.mockImplementation(() => new Promise<DocsFileAnswer>(() => {}));
    open('/docs/demo/specs/a.md', f);
    const updating = fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(COMMIT_A) });
    // Nothing visible says Share on the icon, so its waiting name says so, as Export's does.
    const shareBusy = fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: updating });
    expect(await screen.findByRole('button', { name: shareBusy })).toBeDisabled();
    expect(screen.queryByRole('button', { name: updating }), 'never the bare sentence').toBeNull();
    expect(screen.getByRole('button', { name: exportBusy(updating) })).toBeDisabled();
    fireEvent.click(more());
    expect(within(panel()).getByText(shareBusy)).toBeInTheDocument();
    expect(within(panel()).getByText(exportBusy(updating))).toBeInTheDocument();
  });

  // §4.17's "When it is offered" words a leaf can produce today, each the icon's name and the panel's line (refinement
  // (e)). "Updating to <short>…" is the case above; "Render the mockup first" needs W6's mockups, where Export is absent.
  it.each([
    ['Formatting…, a parse still running', EXPORT_WAIT_TEXT.formatting],
    ['Choose Format or Show as text first, a document over the render gate', EXPORT_WAIT_TEXT.gate],
    ['Image not loaded, a raster leaf whose image failed', EXPORT_WAIT_TEXT['image-failed']],
    ['Highlighting…, a text leaf whose colouring is held', EXPORT_WAIT_TEXT.highlighting],
  ] as const)('%s: the Export icon is named for it and the panel says it', async (_why, words) => {
    atWidth(412);
    if (words === EXPORT_WAIT_TEXT.formatting) {
      open('/docs/demo/specs/a.md', fakeLoaders(), null, heldParser);
    } else if (words === EXPORT_WAIT_TEXT.gate) {
      open('/docs/demo/specs/a.md', fakeLoaders({ file: okFile('# Big\n\n' + 'x'.repeat(DOCS_RENDER_GATE_BYTES)) }));
    } else if (words === EXPORT_WAIT_TEXT['image-failed']) {
      open('/docs/demo/specs/x.png', fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.png')] })) }));
    } else {
      const text = 'const a: number = 1;';
      const r = fileResponse(text);
      const f = fakeLoaders({
        tree: okTree(treeOk({ entries: [entry('specs', 'x.ts')] })),
        file: { s: 'ok', value: { ...r, contentClass: 'text', show: { ...r.show, path: 'x.ts', size: text.length } } },
      });
      navigate('/docs/demo/specs/x.ts');
      render(<HighlighterContext value={inThreadContext(inThreadHighlighter({ hold: true }))}><Routed loaders={f.loaders} reader={null} /></HighlighterContext>);
    }
    expect(await screen.findByRole('button', { name: exportBusy(words) })).toBeDisabled();
    fireEvent.click(more());
    expect(within(panel()).getByText(exportBusy(words))).toBeInTheDocument();
  });

  it('while the reader formats, the live DOM is the chain docs.css lays "Formatting…" over the host by (refinement (i))', async () => {
    atWidth(412);
    const { container } = open('/docs/demo/specs/a.md', fakeLoaders(), heldReader());
    await waitFor(() => expect(container.querySelector('.doc-formatting')).not.toBeNull());
    // docs.css: `.docs-screen:has(> .docs-compact) > .docs-leaf:has(> .docs-reader) > .doc-formatting`.
    const formatting = container.querySelector('.doc-formatting') as HTMLElement;
    const leaf = formatting.parentElement as HTMLElement;
    expect(leaf.classList.contains('docs-leaf')).toBe(true);
    expect([...leaf.children].some((c) => c.classList.contains('docs-reader'))).toBe(true);
    const screenEl = leaf.parentElement as HTMLElement;
    expect(screenEl.classList.contains('docs-screen')).toBe(true);
    expect([...screenEl.children].some((c) => c.matches('header.docs-head.docs-compact'))).toBe(true);
  });

  it('on a leaf the reader shows, the Export icon is named Export (plain view); its tap turns the reader off and says so under the row', async () => {
    atWidth(412);
    const { container } = open('/docs/demo/specs/a.md', fakeLoaders(), heldReader());
    const plain = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.exportPlainView });
    expect(plain).toHaveClass('docs-export');
    expect(container.querySelector('.docs-reader')).not.toBeNull();
    fireEvent.click(more());
    expect(within(panel()).getByText(DOCS_HEAD_TEXT.exportPlainHint)).toBeInTheDocument();
    fireEvent.click(plain);
    const shown = await screen.findByText(DOCS_HEAD_TEXT.exportPlainShown);
    expect(panel().contains(shown), 'the note is under the row, not in the panel').toBe(false);
    await waitFor(() => expect(container.querySelector('.docs-reader')).toBeNull());
    expect(container.querySelector('.docs-head.docs-compact'), 'the plain view keeps the row').not.toBeNull();
  });
});

describe('Page details (refinements (c), (d), (f))', () => {
  it('opens the panel: the whole path with no … button, the truth line, View on GitHub; a second tap closes it', async () => {
    atWidth(412);
    open('/docs/demo/specs/d/x.md', fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'd/x.md')] })) }));
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
    expect(screen.queryByRole('link', { name: DOCS_HEAD_TEXT.github }), 'behind the tap').toBeNull();
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toBeVisible();
    const region = screen.getByRole('region', { name: DOCS_HEAD_TEXT.more });
    expect(region).toBe(panel());
    expect(within(region).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Docs', 'demo', 'specs', 'd', 'x.md']);
    expect(within(region).queryByRole('button', { name: DOCS_HEAD_TEXT.crumbsMore })).toBeNull();
    expect(within(region).getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit })).toHaveClass('docs-copy');
    expect(region.querySelector('.docs-truth-ref')?.getAttribute('title')).toBe(treeOk().ref.served);
    expect(region.querySelector('.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_A);
    expect(within(region).getByRole('link', { name: DOCS_HEAD_TEXT.github })).toHaveClass('docs-action');
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toBeVisible();
  });

  it('Escape in the open panel closes it and puts focus back on Page details (refinement (d))', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    fireEvent.click(more());
    const copy = within(panel()).getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit });
    copy.focus();
    fireEvent.keyDown(copy, { key: 'Escape' });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(more());
    // And on the button itself, where focus sits after a tap on it.
    fireEvent.click(more());
    more().focus();
    fireEvent.keyDown(more(), { key: 'Escape' });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(more());
  });

  it('a new page closes the panel: the head is keyed by the page', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    act(() => { navigate('/docs/demo/specs/b.md'); });
    await waitFor(() => expect(bar().querySelector('.docs-compact-name')?.textContent).toBe('b.md'));
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['ok', 'ok'], ['never', 'warn'], ['failed', 'failed'], ['none', null], ['local', null], ['fetching', null], ['soon', null],
  ] as const)('the chip state %s draws the dot %s', (state, dot) => {
    expect(freshDot(state)).toBe(dot);
  });

  it('a page whose last fetch failed names it: Page details (freshness problem), with the failed dot (refinement (f))', async () => {
    atWidth(412);
    const base = treeOk();
    const tree = {
      ...base,
      freshness: {
        ...base.freshness,
        stamp: { okAgeMs: 179 * 60_000, attemptAgeMs: 5 * 60_000, lastOutcome: 'fetch-transport', okCommit: COMMIT_A },
      },
    } as const;
    open('/docs/demo/specs/a.md', fakeLoaders({ tree: okTree(tree) }));
    const b = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.moreFailed });
    expect(b.querySelector('.docs-more-dot')).toHaveAttribute('data-tone', 'failed');
    expect(screen.queryByRole('button', { name: DOCS_HEAD_TEXT.moreNever }), 'failed is not never fetched').toBeNull();
  });

  it('a page never fetched draws the amber dot and says so in the name; the dot itself is hidden from a screen reader', async () => {
    atWidth(412);
    open('/docs/demo/specs/a.md', fakeLoaders());
    const b = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.moreNever });
    const dot = b.querySelector('.docs-more-dot');
    expect(dot).toHaveAttribute('data-tone', 'warn');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-compact-head.test.tsx )` — Expected (prediction): every case fails (`headLayoutFor is not a function`, `freshDot is not a function`, an undefined query, or a row that is not drawn) but the three full-header width cases (600, 768, 1280) and the three listing cases, which hold today's header and pass: `Tests  33 failed | 6 passed (39)`. Report the measured split; the point is that no compact-row case passes before the head exists.
- [ ] **Step 3: The words.** In `pwa/src/docs/docsText.ts`:
  Find (`pwa/src/docs/docsText.ts`, quoted from `5fcc4268a`):
```ts
  exportPlainShown: 'Showing the plain view, which Export saves.',
```
  Replace:
```ts
  exportPlainShown: 'Showing the plain view, which Export saves.',
  exportPlainHint: 'Export saves the plain view: its button turns the reader off on this page first.',
  shareBusy: 'Share: {state}',
  more: 'Page details',
  moreNever: 'Page details (never fetched)',
  moreFailed: 'Page details (freshness problem)',
```
- [ ] **Step 4: The head.** In `pwa/src/docs/DocsHead.tsx`, these eleven blocks in order (each matches once at BASE and once after the blocks before it). The file's header:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
// (spec 4.17) follows Share on a leaf: exportStateFor decides, and ExportSheet builds and saves.
```
  Replace:
```tsx
// (spec 4.17) follows Share on a leaf: exportStateFor decides, and ExportSheet builds and saves.
// Under DOCS_COMPACT_QUERY (600 CSS px) a leaf page draws the compact head instead (the phone-header plan of 2026-11-03):
// one row of back, where and what, Share and Export as icons, and Page details, which opens a panel holding the crumbs,
// the truth line and the link actions (`CompactHead`). Every other page, and every page at a wider viewport, draws the
// header above, unchanged.
```
  The imports:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
```
  Replace:
```tsx
import { useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
```
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
import { useNow } from '@ccrc/ui';
```
  Replace:
```tsx
import { Icon, useNow } from '@ccrc/ui';
```
  The width, the switch, the dot, the two actions' words, and `Crumbs`' `unfold`:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
/** The crumbs (spec 4.4's layout): every crumb on a desktop; on a phone (under 900 px) the last two behind a leading
 *  `…` button, which shows them all. The last crumb is the page itself. */
function Crumbs(p: { readonly crumbs: readonly DocsCrumb[] }): ReactNode {
  const desktop = useMediaQuery(DESK_QUERY);
  const [whole, setWhole] = useState(false);
  const folded = !desktop && !whole && p.crumbs.length > 2;
```
  Replace:
```tsx
/** The compact head's width (phone-header refinement (b)): under 600 CSS px, the compact window class. A leaf page draws one row there
 *  (`CompactHead`); a tablet, a desktop, and every other page at any width keep the header as it was. Spelled once, here:
 *  docs.css keys the row's rules on its own classes, never on a width (docs-compact-head.test.tsx holds both). */
export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';

/** Which header a page draws. */
export type HeadLayout = 'full' | 'compact';

/** The header for `page` (phone-header refinement (a)): the compact row on a leaf page at the compact width, else the full header. A
 *  directory (its URL ends in `/`), a section, a project and the index keep the full header at every width. */
export function headLayoutFor(compactWidth: boolean, page: DocsPageLocation): HeadLayout {
  return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';
}

/** The Page details button's dot (phone-header refinement (f)), from the freshness chip's state: `ok` a good fetch, `warn`
 *  never fetched, `failed` a failed fetch, re-list or refresh, or a stale lock. `warn` and `failed` draw the same
 *  attention colour, as the picked mockup does; the button's name tells them apart. `null` has one meaning: no dot (no
 *  origin, a local ref, a fetch in flight, a `soon` wait), where the chip itself says nothing a glance must catch. */
export type FreshDot = 'ok' | 'warn' | 'failed' | null;

export function freshDot(state: FreshChipState): FreshDot {
  return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;
}

/** Share's words (spec 4.5): "Share", or "Updating to <short>…" while the leaf moves to `pinFor`'s pin. The full header's
 *  button reads them; the compact row's icon takes them as its accessible name (phone-header refinement (e)). */
function shareWords(share: Exclude<ShareState, { s: 'absent' }>): string {
  return share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(share.to) }) : DOCS_HEAD_TEXT.share;
}

/** Export's words (spec 4.17): "Export", "Export (plain view)", "Updating to <short>…" or why it waits. As for Share's. */
function exportWords(state: Exclude<ExportState, { s: 'absent' }>): string {
  return state.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(state.to) })
    : state.s === 'waiting' ? EXPORT_WAIT_TEXT[state.why]
      : state.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainView : DOCS_HEAD_TEXT.export;
}

/** The crumbs (spec 4.4's layout): every crumb on a desktop; on a phone (under 900 px) the last two behind a leading
 *  `…` button, which shows them all. The last crumb is the page itself. `unfold`: every crumb at any width, with no `…`
 *  button (the compact head's panel, phone-header refinement (c)). */
function Crumbs(p: { readonly crumbs: readonly DocsCrumb[]; readonly unfold?: boolean }): ReactNode {
  const desktop = useMediaQuery(DESK_QUERY);
  const [whole, setWhole] = useState(false);
  const folded = p.unfold !== true && !desktop && !whole && p.crumbs.length > 2;
```
  Share's `glyph`:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
function ShareAction(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>; readonly exportOffered: boolean;
}): ReactNode {
  const { page, tree, share } = p;
  const [open, setOpen] = useState(false);
  const target = open && share.s === 'ready' ? shareTargetFor(tree, page, share.opened) : null;
  return (
    <>
      <button type="button" className="docs-action docs-share" disabled={share.s === 'updating'} onClick={() => setOpen(true)}>
        {share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(share.to) }) : DOCS_HEAD_TEXT.share}
      </button>
```
  Replace:
```tsx
function ShareAction(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>; readonly exportOffered: boolean;
  /** The compact row's form (phone-header refinement (e)): an icon, its words the accessible name ("Share: <words>" while
   *  it waits, as Export's is, since nothing visible says Share). */
  readonly glyph?: boolean;
}): ReactNode {
  const { page, tree, share } = p;
  const [open, setOpen] = useState(false);
  const target = open && share.s === 'ready' ? shareTargetFor(tree, page, share.opened) : null;
  const words = shareWords(share);
  return (
    <>
      <button
        type="button" className="docs-action docs-share" disabled={share.s === 'updating'} onClick={() => setOpen(true)}
        aria-label={p.glyph !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}
      >
        {p.glyph === true ? <Icon name="share" size={20} /> : words}
      </button>
```
  Export's `glyph`, in two blocks:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
function ExportAction(p: {
  readonly page: Leaf; readonly tree: DocsTreeOk; readonly state: Exclude<ExportState, { s: 'absent' }>;
  readonly assets: ExportAssets | null; readonly readAt: number | null; readonly onPlainView: (() => void) | null;
}): ReactNode {
  const { page, tree, state } = p;
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const words = state.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(state.to) })
    : state.s === 'waiting' ? EXPORT_WAIT_TEXT[state.why]
      : state.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainView : DOCS_HEAD_TEXT.export;
```
  Replace:
```tsx
function ExportAction(p: {
  readonly page: Leaf; readonly tree: DocsTreeOk; readonly state: Exclude<ExportState, { s: 'absent' }>;
  readonly assets: ExportAssets | null; readonly readAt: number | null; readonly onPlainView: (() => void) | null;
  /** The compact row's form (phone-header refinement (e)): an icon, its words the accessible name. */
  readonly glyph?: boolean;
}): ReactNode {
  const { page, tree, state } = p;
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const words = exportWords(state);
```
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
        aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : undefined}
      >
        {words}
      </button>
```
  Replace:
```tsx
        aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : p.glyph === true ? words : undefined}
      >
        {p.glyph === true ? <Icon name="download" size={20} /> : words}
      </button>
```
  `Actions` reads the one hook (its JSX below this block is unchanged):
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
function Actions(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;
  readonly exportBody: ExportBody | null; readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null;
  readonly onPlainView: (() => void) | null;
}): ReactNode {
  const { page, tree, file } = p;
  const target = githubTargetFor(page, tree);
  const showsDraft = page.kind === 'path' && openedPin(tree, page, file)?.kind === 'draft';
  const share = shareStateFor(page, tree, file, p.leafImage);
  const settled = useStoreSettled(p.pageStore);
  useAssetsVersion(p.exportAssets);
  const exported = exportStateFor(page, tree, file, { body: p.exportBody, store: p.pageStore, settled, assets: p.exportAssets });
  let committedHref: string | null = null;
  if (page.kind === 'path' && page.view !== 'committed') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf' && k.view.offersCommitted) {
      const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'committed' } as const;
      committedHref = docsPageUrl(docsLocation(page, to));
    }
  }
  if (target === null && committedHref === null) return null;
```
  Replace:
```tsx
function Actions(p: ActionInputs): ReactNode {
  const { page, tree, file } = p;
  const { target, showsDraft, share, exported, committedHref } = useHeadActions(p);
  if (target === null && committedHref === null) return null;
```
  The hook and its two types, before `DocsHead`'s docstring:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
/** The Docs header. `tree` null has one meaning: the visit's tree slot is not `ok` (loading, failed, or the page names
```
  Replace:
```tsx
/** What the actions read: the page, its tree and file slot, and Export's inputs. */
interface ActionInputs {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;
  readonly exportBody: ExportBody | null; readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null;
  readonly onPlainView: (() => void) | null;
}

/** The actions on a page, worked out once for either header (phone-header refinement (e)): View on GitHub's target (`null`: none),
 *  whether the leaf shows draft bytes, Share's and Export's states, and Open committed version's href (`null`: not
 *  offered). The full header draws all of them in one line; the compact row draws Share and Export, and its panel the
 *  two links. */
interface HeadActions {
  readonly target: GithubTarget | null;
  readonly showsDraft: boolean;
  readonly share: ShareState;
  readonly exported: ExportState;
  readonly committedHref: string | null;
}

function useHeadActions(p: ActionInputs): HeadActions {
  const { page, tree, file } = p;
  const target = githubTargetFor(page, tree);
  const showsDraft = page.kind === 'path' && openedPin(tree, page, file)?.kind === 'draft';
  const share = shareStateFor(page, tree, file, p.leafImage);
  const settled = useStoreSettled(p.pageStore);
  useAssetsVersion(p.exportAssets);
  const exported = exportStateFor(page, tree, file, { body: p.exportBody, store: p.pageStore, settled, assets: p.exportAssets });
  let committedHref: string | null = null;
  if (page.kind === 'path' && page.view !== 'committed') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf' && k.view.offersCommitted) {
      const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'committed' } as const;
      committedHref = docsPageUrl(docsLocation(page, to));
    }
  }
  return { target, showsDraft, share, exported, committedHref };
}

/** The Docs header. `tree` null has one meaning: the visit's tree slot is not `ok` (loading, failed, or the page names
```
  The switch in `DocsHead`, and the back control as `BackButton`:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
  const crumbs = docsCrumbs(page);
  const slot = visit.tree;
  const receivedAt = slot?.s === 'ok' ? slot.receivedAt : now;
  return (
    <header className="docs-head">
      <div className="docs-head-bar">
        {/* The index's up door goes to the fleet: it is the `go-fleet` door there (W2 Task S5), and only there. */}
        <button
          type="button"
          className="docs-back"
          aria-label={DOCS_HEAD_TEXT.back}
          onClick={() => navigate(docsUpHref(page))}
          {...(docsUpHref(page) === '/' ? doorMark('go-fleet') : {})}
        >
          ‹
        </button>
        <Crumbs key={crumbs.at(-1)?.href} crumbs={crumbs} />
      </div>
```
  Replace:
```tsx
  const crumbs = docsCrumbs(page);
  const slot = visit.tree;
  const receivedAt = slot?.s === 'ok' ? slot.receivedAt : now;
  const compactWidth = useMediaQuery(DOCS_COMPACT_QUERY);
  // Phone-header refinement (a): a leaf page at the compact width draws one row. Keyed by the page, so a navigation closes its panel.
  if (headLayoutFor(compactWidth, page) === 'compact' && page.kind === 'path') {
    return (
      <CompactHead
        key={docsPageUrl(page)} page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}
        leafImage={p.leafImage ?? null} exportBody={p.exportBody ?? null} pageStore={p.pageStore ?? null}
        exportAssets={p.exportAssets ?? null} plainView={p.plainView === true} onPlainView={p.onPlainView ?? null}
      />
    );
  }
  return (
    <header className="docs-head">
      <div className="docs-head-bar">
        <BackButton page={page} />
        <Crumbs key={crumbs.at(-1)?.href} crumbs={crumbs} />
      </div>
```
  The compact head, at the end of the file:
  Find (`pwa/src/docs/DocsHead.tsx`, quoted from `5fcc4268a`):
```tsx
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}
```
  Replace:
```tsx
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}

/** Back (spec 4.4: up one level, never `history.back()`), the one control both headers draw. The index's up door goes to
 *  the fleet: it is the `go-fleet` door there (W2 Task S5), and only there. */
function BackButton(p: { readonly page: DocsPageLocation }): ReactNode {
  const up = docsUpHref(p.page);
  return (
    <button
      type="button"
      className="docs-back"
      aria-label={DOCS_HEAD_TEXT.back}
      onClick={() => navigate(up)}
      {...(up === '/' ? doorMark('go-fleet') : {})}
    >
      ‹
    </button>
  );
}

/** The compact row's draft word (phone-header refinement (g)): the badge the truth line draws for this leaf, `entryView`'s through
 *  `ENTRY_BADGE_TEXT` (M4.T7, one badge function), or `null` when the truth line draws none. */
function rowBadge(tree: DocsTreeOk, page: Leaf, file: DocsVisit['file']): string | null {
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  if (k.kind !== 'leaf') return null;
  const s = leafSource(tree, page, openedPin(tree, page, file));
  if (s.kind === 'draft') return badgeText(s.badge);
  return k.view.badge === null ? null : ENTRY_BADGE_TEXT[k.view.badge];
}

/** The compact row's two lines (phone-header refinements (c), (g)): where the page is over its name. The first line is the
 *  parent crumb and, when one is shown, the served ref, joined by ` · ` (the ref's own span holds the separator), each its
 *  own text that ends in an ellipsis and the crumb the one that gives way first, so a long parent directory never hides
 *  which ref is served; the draft badge follows as a sibling, so a long ref is cut and the badge never is. Text, not
 *  links: back goes up one level, and the whole path is the panel's first line. */
function CompactLabel(p: {
  readonly where: string; readonly name: string; readonly refText: string | null; readonly badge: string | null;
}): ReactNode {
  return (
    <p className="docs-compact-label">
      <span className="docs-compact-where">
        <span className="docs-compact-where-text">
          <span className="docs-compact-where-crumb">{p.where}</span>
          {p.refText !== null && <span className="docs-compact-where-ref">{SEP}{p.refText}</span>}
        </span>
        {p.badge !== null && <>{SEP}<span className="docs-badge">{p.badge}</span></>}
      </span>
      <span className="docs-compact-name">{p.name}</span>
    </p>
  );
}

/** The served ref the row names (phone-header refinement (g)): a ref the page asked for, a local side, or any default
 *  that is not origin/HEAD (a local main or master, or origin's main or master when origin/HEAD is unset or dangling,
 *  `ccd/ccd#default_chain`). The usual default view, origin/HEAD resolved, adds nothing. */
function rowRefText(page: Leaf, tree: DocsTreeOk): string | null {
  const ref = tree.ref;
  return page.ref !== null || ref.side === 'local' || ref.via !== 'default:origin-head' ? servedRefText(ref) : null;
}

/** What the compact head is given: the full header's inputs, settled (phone-header refinement (a)). */
interface CompactProps {
  readonly page: Leaf; readonly visit: DocsVisit; readonly receivedAt: number; readonly now: number;
  readonly crumbs: readonly DocsCrumb[]; readonly leafImage: DocPin | null; readonly exportBody: ExportBody | null;
  readonly pageStore: HighlightStore | null; readonly exportAssets: ExportAssets | null; readonly plainView: boolean;
  readonly onPlainView: (() => void) | null;
}

/** The compact head (phone-header refinements (a) to (h)): a leaf page under DOCS_COMPACT_QUERY. While the tree slot is
 *  not `ok` (loading, or failed) the head is back and the crumbs, as the full header's is (spec 4.7: a tree failure keeps
 *  the crumbs); the row and its panel need the tree. The two notes that answer a tap or a re-list (the plain view shown,
 *  Updated to) stay under the row, outside the panel, where the full header draws them. */
function CompactHead(p: CompactProps & { readonly tree: DocsTreeOk | null }): ReactNode {
  const { page, visit, tree } = p;
  const where = p.crumbs.at(-2)?.label ?? '';
  const name = p.crumbs.at(-1)?.label ?? '';
  return (
    <header className="docs-head docs-compact">
      {tree === null
        ? (
          <div className="docs-compact-crumbs">
            <BackButton page={page} />
            <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} />
          </div>
        )
        : <CompactRow {...p} tree={tree} where={where} name={name} />}
      {p.plainView && <p className="docs-note" role="status">{DOCS_HEAD_TEXT.exportPlainShown}</p>}
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}

/** The compact row once the tree is `ok`, and its panel (phone-header refinements (c) to (g)). Page details is a disclosure: a button
 *  whose `aria-expanded` and `aria-controls` name the panel, a region drawn in the page's flow under the row and `hidden`
 *  while closed. Escape inside either closes it and puts focus back on the button. */
function CompactRow(p: CompactProps & { readonly tree: DocsTreeOk; readonly where: string; readonly name: string }): ReactNode {
  const { page, visit, tree } = p;
  const file = visit.file;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { target, showsDraft, share, exported, committedHref } = useHeadActions({
    page, tree, file, leafImage: p.leafImage, exportBody: p.exportBody, pageStore: p.pageStore,
    exportAssets: p.exportAssets, onPlainView: p.onPlainView,
  });
  const dot = freshDot(freshnessChip(tree, p.receivedAt, visit.freshness, p.now).state);
  const exportNote = exported.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainHint
    : exported.s === 'updating' || exported.s === 'waiting' ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: exportWords(exported) })
      : null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <>
      <div className="docs-compact-bar">
        <BackButton page={page} />
        <CompactLabel
          where={p.where} name={p.name} refText={rowRefText(page, tree)} badge={rowBadge(tree, page, file)}
        />
        {share.s !== 'absent' && (
          <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} exportOffered={exported.s !== 'absent'} glyph />
        )}
        {exported.s !== 'absent' && (
          <ExportAction
            key={exportKeyOf(page, tree, exported)} page={page} tree={tree} state={exported} assets={p.exportAssets}
            readAt={file.s === 'ok' ? file.receivedAt : null} onPlainView={p.onPlainView} glyph
          />
        )}
        <button
          ref={toggle} type="button" className="docs-more" aria-expanded={open} aria-controls={panelId}
          aria-label={dot === 'failed' ? DOCS_HEAD_TEXT.moreFailed : dot === 'warn' ? DOCS_HEAD_TEXT.moreNever : DOCS_HEAD_TEXT.more}
          onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}
        >
          <Icon name="ellipsis" size={20} />
          {dot !== null && <span className="docs-more-dot" data-tone={dot} aria-hidden="true" />}
        </button>
      </div>
      <div
        id={panelId} className="docs-more-panel" role="region" aria-label={DOCS_HEAD_TEXT.more} onKeyDown={onKeyDown}
        hidden={!open}
      >
        <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} unfold />
        <TruthLine page={page} visit={visit} tree={tree} receivedAt={p.receivedAt} now={p.now} />
        {(target !== null || committedHref !== null) && (
          <div className="docs-actions">
            {target !== null && <GithubAction tree={tree} target={target} showsDraft={showsDraft} />}
            {committedHref !== null && <DocsPageLink className="docs-action" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}
          </div>
        )}
        {share.s === 'updating' && <p className="docs-note">{fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: shareWords(share) })}</p>}
        {exportNote !== null && <p className="docs-note">{exportNote}</p>}
      </div>
    </>
  );
}
```
- [ ] **Step 5: The censuses.** In `pwa/test/control-census.test.ts`:
  Find (`pwa/test/control-census.test.ts`, quoted from `5fcc4268a`):
```ts
  'docs/DocsHead.tsx <button> docs-copy': 'TOKEN. Copy commit, on the truth line.',
```
  Replace:
```ts
  'docs/DocsHead.tsx <button> docs-copy': 'TOKEN. Copy commit, on the truth line.',
  'docs/DocsHead.tsx <button> docs-more':
    "TOKEN. Page details, the compact row's last button (the phone-header plan of 2026-11-03), which opens the panel "
    + 'holding the crumbs, the truth line and the link actions.',
```
  In `pwa/test/tap-targets.test.tsx`, the import and the render half:
  Find (`pwa/test/tap-targets.test.tsx`, quoted from `5fcc4268a`):
```tsx
import { DocsScreen } from '../src/screens/DocsScreen';
```
  Replace:
```tsx
import { DocsScreen } from '../src/screens/DocsScreen';
import { DOCS_COMPACT_QUERY } from '../src/docs/DocsHead';
```
  Find (`pwa/test/tap-targets.test.tsx`, quoted from `5fcc4268a`):
```tsx
describe('TextLink stays inside a line of text — a link alone is a control', () => {
```
  Replace:
```tsx
// — the Docs reader's compact head (the phone-header plan of 2026-11-03): the render half of the describe above. —
describe('the compact head: the rendered row carries .docs-back, .docs-action and .docs-more (docs phone header)', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('are the classes the rendered row carries', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === DOCS_COMPACT_QUERY, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    openDocs('/docs/demo/specs/a.md', markdownLeaf('# A\n'));
    // Share is named "Share" only once the leaf's read settles; Page details and back are drawn from the tree alone.
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toHaveClass('docs-action', 'docs-share');
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.export })).toHaveClass('docs-action', 'docs-export');
    expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.moreNever })).toHaveClass('docs-more');
    expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.back })).toHaveClass('docs-back');
  });
});

describe('TextLink stays inside a line of text — a link alone is a control', () => {
```
- [ ] **Step 6: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-compact-head.test.tsx )` — Expected (prediction): `Tests  42 passed (42)`. `TSC-OK`.
- [ ] **Step 7: The full header is unchanged, and the censuses hold.** Each alone, through `ccrc test` where heavy: `docs-screen.test.tsx`, `docs-truth.test.tsx`, `refined-phone.test.tsx` — green, each at its BASE count (they render the full header: setup's `matchMedia` answers false, and `refined-phone`'s 390 case reads `.docs-back` on a `tree: null` leaf, which the compact head keeps). `control-census.test.ts`, `tap-targets.test.tsx`, `docs-scans.test.ts`, `shell-css.test.ts`, `sheet-desktop-arm.test.tsx`, `markup-census.test.ts`, `literal-census.test.ts`, `docs-compact-css.test.ts` — green (`tap-targets.test.tsx` one case more than after Task 3; `control-census.test.ts` at its BASE count, with one more entry). `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/citations.test.ts )` — green.
- [ ] **Step 8: Commit.** `git add pwa/src/docs/DocsHead.tsx pwa/src/docs/docsText.ts pwa/test/docs-compact-head.test.tsx pwa/test/control-census.test.ts pwa/test/tap-targets.test.tsx` (expect 5), message `pwa: one Docs row on a phone, the rest behind Page details (docs phone header)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, file `src/docs/DocsHead.tsx` unless the row says otherwise, tests `test/docs-compact-head.test.tsx` unless the row says otherwise):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| PHH-T4-M1 | (a) | `return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';` → `return compactWidth && page.kind === 'path' ? 'compact' : 'full';` | 2 failed — `'compact width true, /docs/demo/specs/d/: full'`; `'/docs/demo/specs/d/ at 390px keeps the full header'` |
| PHH-T4-M2 | (b) | `export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';` → `export const DOCS_COMPACT_QUERY = '(max-width: 899.98px)';` | 3 failed — `'the compact width is under 600 CSS px, …'`; `'at 600px …'`; `'at 768px …'` |
| PHH-T4-M3 | (c) | `const folded = p.unfold !== true && !desktop && !whole && p.crumbs.length > 2;` → `const folded = !desktop && !whole && p.crumbs.length > 2;` | 1 failed — `'opens the panel: the whole path with no … button, …'` |
| PHH-T4-M4 | (d) | `hidden={!open}` → `hidden={false}` | 3 failed — `'opens the panel: …'`; `'at 390px …'`; `'at 599px …'` (the truth line's copy commit is on the page while closed) |
| PHH-T4-M5 | (d) | `toggle.current?.focus();` → removed | 1 failed — `'Escape in the open panel closes it and puts focus back on Page details …'` |
| PHH-T4-M6 | (e) | `aria-label={p.glyph !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}` → `aria-label={undefined}` | 7 failed — the order case, the ref and draft case, the default-view ref case, the updating case, the panel case, the Escape case, the new-page case (Share's icon has no name) |
| PHH-T4-M7 | (e) | `aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : p.glyph === true ? words : undefined}` → `aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : undefined}` | 4 failed — `'at 390px …'`; `'at 599px …'`; the order case; the plain-view case |
| PHH-T4-M8 | (g) | `if (s.kind === 'draft') return badgeText(s.badge);` → `if (s.kind === 'draft') return null;` | 1 failed — `'a ref view names its served ref on the row, and a draft leaf its badge, …'` |
| PHH-T4-M9 | (g) | `where={p.where} name={p.name} refText={rowRefText(page, tree)} badge={rowBadge(tree, page, file)}` → `where={p.where} name={p.name} refText={null} badge={rowBadge(tree, page, file)}` | 2 failed — the ref and draft case; `'a default view served from anywhere but origin/HEAD names its served ref on the row …'` |
| PHH-T4-M10 | (f) | `return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;` → `return state === 'ok' ? 'ok' : state === 'failed' ? 'failed' : null;` | 3 failed — `'the chip state never draws the dot warn'`; `'a page never fetched draws the amber dot …'`; the order case |
| PHH-T4-M11 | (e) | `const exportNote = exported.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainHint` → `const exportNote = exported.s === 'plain-view' ? null` | 1 failed — the plain-view case |
| PHH-T4-M12 | (g) | `if (s.kind === 'draft') return badgeText(s.badge);` → `if (s.kind === 'draft') return tree.entries.find((x) => x.path === page.path)?.draft?.state ?? null;`; tests `test/docs-scans.test.ts` | 4 failed — `'the Docs screen code reads no draft state'`, `'a file planted beside the real ones is found, by file and line'` (its copy of `src/docs` carries the mutated head), `'M4.T7 Share clause: …'`, `'M4.T7 Export clause: …'` |
| PHH-T4-M13 | (k) | file `test/control-census.test.ts`: `'docs/DocsHead.tsx <button> docs-more':` → `'docs/DocsHead.tsx <button> docs-more-gone':`; tests `test/control-census.test.ts` | 3 failed — `'registers every one'`, `'keeps no stale entry'`, `'verifies every TOKEN claim against the stylesheets'` (no rule selects `.docs-more-gone`) |
| PHH-T4-M14 | (e) | `aria-label={p.glyph !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}` → `aria-label={p.glyph !== true ? undefined : words}` | 1 failed — `'while the leaf moves to its pin, Share and Export are disabled and named for it, …'` (Share's waiting icon is named by the bare sentence) |
| PHH-T4-M15 | (g) | `return page.ref !== null \|\| ref.side === 'local' \|\| ref.via !== 'default:origin-head' ? servedRefText(ref) : null;` → `return page.ref !== null ? servedRefText(ref) : null;` | 1 failed — `'a default view served from anywhere but origin/HEAD names its served ref on the row …'` |
| PHH-T4-M16 | (d) | `key={docsPageUrl(page)} page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}` → `page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}` | 1 failed — `'a new page closes the panel: the head is keyed by the page'` |
| PHH-T4-M17 | (k) | `ref={toggle} type="button" className="docs-more" aria-expanded={open} aria-controls={panelId}` → `ref={toggle} type="button" className="docs-more-x" aria-expanded={open} aria-controls={panelId}`; tests `test/tap-targets.test.tsx`, `test/control-census.test.ts` | 3 failed — tap-targets `'are the classes the rendered row carries'`; control-census `'registers every one'`, `'keeps no stale entry'` |
| PHH-T4-M18 | (c) | `<Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} />` → `{null}` | 2 failed — `'while the tree slot is loading, …'`, `'while the tree slot is unreachable, …'` |
| PHH-T4-M19 | (d) | `onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}` → `onClick={() => setOpen((o) => !o)}` | 1 failed — the Escape case, at its second half (Escape on the button itself) |
| PHH-T4-M20 | (i) | file `src/docs/ReaderFrame.tsx`: `{state.s !== 'ready' && <p className="doc-formatting">{DOC_FORMATTING}</p>}` → `{state.s !== 'ready' && <div><p className="doc-formatting">{DOC_FORMATTING}</p></div>}` | 1 failed — `'while the reader formats, the live DOM is the chain docs.css lays "Formatting…" over the host by …'` |

```json
[
  {"id": "PHH-T4-M1", "spec": "(a)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';", "new": "return compactWidth && page.kind === 'path' ? 'compact' : 'full';", "tests": ["test/docs-compact-head.test.tsx"], "red": "2 failed: compact width true, /docs/demo/specs/d/: full; /docs/demo/specs/d/ at 390px keeps the full header"},
  {"id": "PHH-T4-M2", "spec": "(b)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';", "new": "export const DOCS_COMPACT_QUERY = '(max-width: 899.98px)';", "tests": ["test/docs-compact-head.test.tsx"], "red": "3 failed: the compact width is under 600 CSS px; at 600px; at 768px"},
  {"id": "PHH-T4-M3", "spec": "(c)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "const folded = p.unfold !== true && !desktop && !whole && p.crumbs.length > 2;", "new": "const folded = !desktop && !whole && p.crumbs.length > 2;", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: opens the panel: the whole path with no … button"},
  {"id": "PHH-T4-M4", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "hidden={!open}", "new": "hidden={false}", "tests": ["test/docs-compact-head.test.tsx"], "red": "3 failed: opens the panel; at 390px; at 599px"},
  {"id": "PHH-T4-M5", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "toggle.current?.focus();", "new": "", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: Escape in the open panel closes it and puts focus back on Page details"},
  {"id": "PHH-T4-M6", "spec": "(e)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "aria-label={p.glyph !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}", "new": "aria-label={undefined}", "tests": ["test/docs-compact-head.test.tsx"], "red": "7 failed: the order case; the ref and draft case; the default-view ref case; the updating case; the panel case; the Escape case; the new-page case"},
  {"id": "PHH-T4-M7", "spec": "(e)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : p.glyph === true ? words : undefined}", "new": "aria-label={busy ? fillSentence(DOCS_HEAD_TEXT.exportBusy, { state: words }) : undefined}", "tests": ["test/docs-compact-head.test.tsx"], "red": "4 failed: at 390px; at 599px; the order case; the plain-view case"},
  {"id": "PHH-T4-M8", "spec": "(g)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "if (s.kind === 'draft') return badgeText(s.badge);", "new": "if (s.kind === 'draft') return null;", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: a ref view names its served ref on the row, and a draft leaf its badge"},
  {"id": "PHH-T4-M9", "spec": "(g)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "where={p.where} name={p.name} refText={rowRefText(page, tree)} badge={rowBadge(tree, page, file)}", "new": "where={p.where} name={p.name} refText={null} badge={rowBadge(tree, page, file)}", "tests": ["test/docs-compact-head.test.tsx"], "red": "2 failed: the ref and draft case; a default view served from anywhere but origin/HEAD names its served ref on the row"},
  {"id": "PHH-T4-M10", "spec": "(f)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;", "new": "return state === 'ok' ? 'ok' : state === 'failed' ? 'failed' : null;", "tests": ["test/docs-compact-head.test.tsx"], "red": "3 failed: the chip state never draws the dot warn; a page never fetched draws the amber dot; the order case"},
  {"id": "PHH-T4-M11", "spec": "(e)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "const exportNote = exported.s === 'plain-view' ? DOCS_HEAD_TEXT.exportPlainHint", "new": "const exportNote = exported.s === 'plain-view' ? null", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: the plain-view case"},
  {"id": "PHH-T4-M12", "spec": "(g)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "if (s.kind === 'draft') return badgeText(s.badge);", "new": "if (s.kind === 'draft') return tree.entries.find((x) => x.path === page.path)?.draft?.state ?? null;", "tests": ["test/docs-scans.test.ts"], "red": "4 failed: the Docs screen code reads no draft state; a file planted beside the real ones is found, by file and line; M4.T7 Share clause; M4.T7 Export clause"},
  {"id": "PHH-T4-M13", "spec": "(k)", "pkg": "pwa", "file": "test/control-census.test.ts", "old": "'docs/DocsHead.tsx <button> docs-more':", "new": "'docs/DocsHead.tsx <button> docs-more-gone':", "tests": ["test/control-census.test.ts"], "red": "3 failed: registers every one; keeps no stale entry; verifies every TOKEN claim against the stylesheets"},
  {"id": "PHH-T4-M14", "spec": "(e)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "aria-label={p.glyph !== true ? undefined : share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: words }) : words}", "new": "aria-label={p.glyph !== true ? undefined : words}", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: while the leaf moves to its pin, Share and Export are disabled and named for it"},
  {"id": "PHH-T4-M15", "spec": "(g)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return page.ref !== null || ref.side === 'local' || ref.via !== 'default:origin-head' ? servedRefText(ref) : null;", "new": "return page.ref !== null ? servedRefText(ref) : null;", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: a default view served from anywhere but origin/HEAD names its served ref on the row"},
  {"id": "PHH-T4-M16", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "key={docsPageUrl(page)} page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}", "new": "page={page} visit={visit} tree={tree} receivedAt={receivedAt} now={now} crumbs={crumbs}", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: a new page closes the panel: the head is keyed by the page"},
  {"id": "PHH-T4-M17", "spec": "(k)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "ref={toggle} type=\"button\" className=\"docs-more\" aria-expanded={open} aria-controls={panelId}", "new": "ref={toggle} type=\"button\" className=\"docs-more-x\" aria-expanded={open} aria-controls={panelId}", "tests": ["test/tap-targets.test.tsx", "test/control-census.test.ts"], "red": "3 failed: are the classes the rendered row carries; registers every one; keeps no stale entry"},
  {"id": "PHH-T4-M18", "spec": "(c)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "<Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} />", "new": "{null}", "tests": ["test/docs-compact-head.test.tsx"], "red": "2 failed: while the tree slot is loading; while the tree slot is unreachable"},
  {"id": "PHH-T4-M19", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}", "new": "onClick={() => setOpen((o) => !o)}", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: Escape in the open panel closes it and puts focus back on Page details"},
  {"id": "PHH-T4-M20", "spec": "(i)", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "{state.s !== 'ready' && <p className=\"doc-formatting\">{DOC_FORMATTING}</p>}", "new": "{state.s !== 'ready' && <div><p className=\"doc-formatting\">{DOC_FORMATTING}</p></div>}", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: while the reader formats, the live DOM is the chain docs.css lays Formatting over the host by"}
]
```

**Verify:** `docs-compact-head.test.tsx` 39 passed; the full-header suites at their BASE counts; the censuses green; `TSC-OK`.

### Task 5: The measured figure, green (refinements (i), (l))

**Model routing:** the main loop runs and reads the measurement; per-task reviewer `opus` (the figures against BASE, and whether the test still measures what it says).

**Files:**
- Commit: `pwa/browser/docs-compact-head.browser.test.ts` (written in Task 1, unchanged since).
- Guards (not edited): `pwa/browser/reader-frame.browser.test.ts` (its 390 x 844 layout row now runs with the compact head).

- [ ] **Step 0: The file is Task 1's.** `git status --porcelain -- pwa/browser/docs-compact-head.browser.test.ts` prints `?? pwa/browser/docs-compact-head.browser.test.ts`, and its sha256 equals the one recorded in Task 1 Step 5. A difference is a stop-and-ask.
- [ ] **Step 1: Run it**, through `ccrc test`: `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-compact-head.browser.test.ts )` — Expected (prediction): `Tests  11 passed (11)`. Copy every `PHH-FIGURE` line into the SDD ledger. Predicted at 412 x 915 in Refined: `screenTop` 0, `frameTop` 48 (the 44 px row, its 1 px divider inside that height, and the 4 px gap), `titleInFrame` as at BASE (about 85), `above` about 133; the row line's `bar.h` 44 and `divider` `1px`; the long-branch line's `textCut` and `badgeWhole` both true.
- [ ] **Step 2: Compare with BASE.** For 600 x 960, 768 x 1024, 1280 x 800 and 915 x 412, `frameTop` and `above` within 1 px of Task 1's figures (the full header is unchanged); a larger move is a stop-and-ask. The 915 x 412 figure is the cost Q3 names (a phone turned sideways keeps today's header); it is recorded, not pinned. For 412 x 915 in both skins, `titleInFrame` within 1 px of BASE (the frame's own part is untouched).
- [ ] **Step 3: The reader's own browser rows still hold.** `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/reader-frame.browser.test.ts )` through `ccrc test` — green at its BASE count (its `'the reader is sized to the Docs pane and only the frame scrolls, at 1280x800 and 390x844'` row now meets the compact head at 390 and must still find the frame one pane tall).
- [ ] **Step 4: Commit.** `git add pwa/browser/docs-compact-head.browser.test.ts` (expect 1), message `pwa: the Docs phone header's figure, measured in Chromium at 412 x 915 (docs phone header)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, tests `browser/docs-compact-head.browser.test.ts` under `--config vitest.browser.config.ts`; each run rebuilds the PWA, so each is bounded at `timeout -k 10 900`):

| id | spec | file | old → new | expected red (prediction) |
|---|---|---|---|---|
| PHH-T5-M1 | (i) | `src/docs/docs.css` | `.docs-screen:has(> .docs-compact) { padding-top: 0; gap: var(--sp-1); }` → `.docs-screen:has(> .docs-compact) { gap: var(--sp-1); }` | 2 failed — the 412 x 915 Refined and Instrument cases (the console's part 56 px) |
| PHH-T5-M2 | (b) | `src/docs/DocsHead.tsx` | `export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';` → `export const DOCS_COMPACT_QUERY = '(max-width: 899.98px)';` | 2 failed — `'600 x 960: …'`, `'768 x 1024: …'` |
| PHH-T5-M3 | (e) | `src/docs/docs.css` | `.docs-compact-bar .docs-action { justify-content: center; min-width: var(--tap-min); padding: 0; text-decoration: none; }` → `.docs-compact-bar .docs-action { justify-content: center; padding: 0; text-decoration: none; }` | 1 failed — `'412 x 915: back, Share, Export and Page details, each at least one tap, …'` (Share and Export about 28 px wide) |
| PHH-T5-M4 | (g) | `src/docs/docs.css` | `display: flex; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap;` → `display: block; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap;` | 1 failed — `'412 x 915: a draft in a ref view of a long branch; …'` (the badge runs past the label) |
| PHH-T5-M5 | (d) | `src/docs/DocsHead.tsx` | `onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}` → `onClick={() => setOpen((o) => !o)}` | 1 failed — `'412 x 915: Page details opens the truth line under the row; Escape closes it, …'` |

```json
[
  {"id": "PHH-T5-M1", "spec": "(i)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-screen:has(> .docs-compact) { padding-top: 0; gap: var(--sp-1); }", "new": ".docs-screen:has(> .docs-compact) { gap: var(--sp-1); }", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "2 failed: 412 x 915, Refined; 412 x 915, Instrument"},
  {"id": "PHH-T5-M2", "spec": "(b)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "export const DOCS_COMPACT_QUERY = '(max-width: 599.98px)';", "new": "export const DOCS_COMPACT_QUERY = '(max-width: 899.98px)';", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "2 failed: 600 x 960; 768 x 1024"},
  {"id": "PHH-T5-M3", "spec": "(e)", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-compact-bar .docs-action { justify-content: center; min-width: var(--tap-min); padding: 0; text-decoration: none; }", "new": ".docs-compact-bar .docs-action { justify-content: center; padding: 0; text-decoration: none; }", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "1 failed: 412 x 915: back, Share, Export and Page details, each at least one tap"},
  {"id": "PHH-T5-M4", "spec": "(g)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "display: flex; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap;", "new": "display: block; align-items: center; gap: var(--sp-1); min-width: 0; white-space: nowrap;", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "1 failed: 412 x 915: a draft in a ref view of a long branch"},
  {"id": "PHH-T5-M5", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}", "new": "onClick={() => setOpen((o) => !o)}", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "1 failed: 412 x 915: Page details opens the truth line under the row; Escape closes it"}
]
```

A browser row's `tests` run under the browser config: `( cd pwa && CCRC_CHROME=<…> ./node_modules/.bin/vitest run --config vitest.browser.config.ts <tests> )`.

**Verify:** the browser file 10 passed with the figures at or under 133 and 48, the row one tap tall with its divider inside, the long ref cut and the badge whole, and the full header's figures at BASE (the sideways figure recorded); `reader-frame.browser.test.ts` green.

### Task 6: Close — review, suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus); review lenses as below; `sonnet` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Three `opus` lenses over `BASE..HEAD` against this plan: (1) the page's truth (goal 4, refinements (c), (d), (g), (h): what the row keeps, what the panel holds, the badge's one source, the notes and banners in the flow); (2) accessibility and interaction (refinements (d), (e), (f): names and their order, `aria-expanded`/`aria-controls`, Escape and focus, `hidden`, the dot's meaning in the name, tap targets in the real engine); (3) layout and the measurement (refinements (a), (b), (i), (l): the switch, the 600 boundary, desktop and tablet unchanged, CSS keyed on classes, "Formatting…", the browser file's validity, Task 1's and Task 5's figures). One `sonnet` lens: the tests and rows, the censuses, and the public-repo scan of every changed file. Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix. A fix that moves a row's measured red restates that row (it takes no number).
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit:
  - the whole `pwa` suite in pieces, `TSC-OK` and `UI-TSC-OK`;
  - the browser leg's two Docs files locally (`docs-compact-head`, `reader-frame`), with their counts; a fast PR skips `browser (pwa)`, which first runs in the merge queue;
  - `git fetch -q origin main`, then the WHOLE `server` suite in pieces (`docs-parity`, `citations`, `topology-clean`, `typecheck-tests` among them; not a list: the PR's CI selection runs suites a list misses), `typecheck-tests` alone; a red census in a file outside this wave's Scope is a stop-and-ask, never a silent edit;
  - re-run any known load flake alone before calling it broken.
- [ ] **Step 3: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 4: Define the deviations.** Replace `## Deviations found`'s placeholder with the issued numbers, first for (c), (d) and (e), then any found while executing (entry form: `- **D-<n> (<date>)** — <slug>. <what departs from which sentence, and why>. <Task and rows that apply it>.`), and write the unused ones without their prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green (the guard reads tracked files only).
- [ ] **Step 5: Draft `## Results`** in this plan in the working tree: the counts per suite; every task's JSON row fence as measured; every `PHH-FIGURE` line at BASE (Task 1) and at the end (Task 5), side by side, for 412 x 915 in both skins, 599, 600, 768, 1280 and 915 x 412, the row's boxes, the long-branch draft line and the panel-open figure; the figure at 412 x 915 against 133 and the console's part against 48; the tablet and desktop deltas against BASE; "Named, without a number" (choices that filled a silence while executing); "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-phone-header/pr-body.md` (gitignored): title `Docs: one header row on a phone, the rest behind Page details`; what ships; the figure before and after; the departures by letter with their numbers and the spec sentences each names (§4.4, §4.5 and §4.17); the operator's answers to Q1 to Q3; what option 2 will reuse; the review's findings and fixes; the test plan.
- [ ] **Step 6: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan) and the drafted PR body with the scan the dispatch names: rc 0, zero hits. A hit is fixed and the scan re-run before Step 7. Remove `$HOME/.cc-tmp/phh-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: the Docs phone header's results (docs phone header)`, trailer. This commit is the `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Issued at the run's opening (run 1436, 2026-11-04): 7953 to 7959. The first three are for refinements (c), (d) and (e), in that order; the other four are for departures found while executing and in a fix round. (Task 6 Step 4 replaces this line.)

## Where things stand

### Agreed
- The operator's pick of 2026-11-03: option 1, one console row (about 133 px above a reader doc's title on the phone, from about 341), a ccrc-only change, built now and after Export (#2237), which edits the same header. Option 2, one bar merged with the reader frame's own (about 81 px), comes later with a release of the shared reader library. Option 3, a header that scrolls away, was not picked.
- From the base, not a choice: on a phone nothing of the console draws above the Docs screen, so the console's part above a reader doc is the Docs head alone; the reader frame's own bar stays as it is in this option.
- From the brief: desktops and tablets keep today's header, tested in jsdom and in a real Chromium.
- The coordinator's rulings on review round 1 (2026-11-03), applied in rev 2: the draft badge is drawn beside the ellipsised text, never in it, with a 412 px long-branch case and its rows; the compact head keeps the crumbs while the tree slot is not `ok`, so spec §4.7 holds rather than being departed from; Share's waiting icon is named "Share: …", as Export's is; §4.17's "When it is offered" words join (e)'s departure and Q1; the picked mockup is followed for the 1 px divider (inside the 44 px row) and for the one attention colour for never fetched and failed, and the parent-crumb label is named as a deliberate departure from the mockup; Q3 states the landscape cost, a 915 x 412 case records it, and a height arm is offered only as an alternative; the icon step keeps npm's cache and the tarball in the scratch directory it removes and extracts only the files the generator reads; the disabled icon's fade is registered in the contrast census's opacity registry.

### Waiting on you
- Nothing. The operator approved the plan on 2026-11-04 (below).

### Answered by the operator (2026-11-04)
- "Approve with every recommendation" (console item 13). Q1: one tap for the full truth on a phone, with (g) on the row; the departures stay plan-only, numbered at the run's opening as 7953 (c), 7954 (d) and 7955 (e); §4.4, §4.5 and §4.17 are amended in one place when option 2 lands. Q2: the Page details panel is a disclosure in the page's flow under the row. Q3: the row applies to leaf pages under 600 CSS px only. The questions as asked follow.
- **Q1, the spec's sentences (refinements (c), (d), (e)).** On a phone leaf, these change meaning:
  - §4.4's Layout sentence: the breadcrumb behind `…` and the truth-line facts inline;
  - the Leaf row of §4.4's Views table: the truth line on the page;
  - §4.5's placement of Share and Export ("**Share** sits after View on GitHub and before Open committed version") and its "reading "Updating to <short>…"";
  - §4.17's "When it is offered" table, whose disabled words ("Updating to <short>…", "Formatting…", "Highlighting…", "Choose Format or Show as text first", "Render the mockup first") are visible on the button today. The same goes for the two visible labels the operator approved for Export: "Export (plain view)" and "Image not loaded". On the row, each becomes the icon's accessible name ("Export: <words>") and a line in the Page details panel, and Task 4 pins each word a leaf can produce today.
  - **What review round 1 changed:** §4.17 and the plain-view label were added to this list (finding F4). The tree-failure case no longer departs from §4.7, because the head keeps the crumbs while the tree slot is not `ok` (F2). The row now shows the served ref for every default view that is not origin/HEAD, not only when the URL names a ref (F5). The draft badge can no longer be cut off by a long ref (F1).
  - **Goal 4** ("It shows the full refname, the commit, why that ref was chosen, and whether a draft overlays it") holds one tap away. The row itself still shows any served ref other than origin/HEAD and a draft's badge, whole (refinement (g)).
  - **Recommended:** accept one tap for the full truth on a phone, with (g) on the row. Keep the departures plan-only, numbered when the run opens, as the Export plan's approval did, and amend §4.4, §4.5 and §4.17 in one place when option 2 lands, since option 2 moves the same sentences again. The alternative is to amend the spec in this wave: one more file in Scope, and a spec edit beside the code.
- **Q2, the panel (refinement (d)).** Recommended: a disclosure in the page's flow under the row. It uses native button and region semantics, needs no focus trap and no scrim, and keeps the page's own ground under every measured ink; the frame shrinks while it is open. Escape closes it from the button or from inside it and returns focus to the button, and opening another page closes it.
  - The alternative is the mockup's floating menu over the reader with a scrim. It is closer to the picture, but it needs the scrim to close, because a tap inside the sandboxed frame never reaches the page, and the contrast census would have to measure a new ground for the menu.
  - **What review round 1 changed:** only the button's name for a freshness problem, now the neutral "Page details (freshness problem)" (F7), and the dot, which now uses the mockup's one attention colour for both never-fetched and failed, the name telling them apart (F6). The recommendation stands.
- **Q3, where the row applies (refinements (a), (b)).** Recommended: leaf pages only, under 600 CSS px. Listings keep the full header: it scrolls away there, and the crumbs and truth line are what a listing is for. Tablets (600 to 899 px) keep today's header.
  - **The cost:** a phone turned sideways (about 915 x 412) is a desk width, so it keeps today's desk bar and full header above the frame on a viewport about 412 px tall, unchanged from today. The review estimates that at 256 px or more of console; the 915 x 412 browser case measures it and records it next to BASE (F8).
  - The alternatives are the mockup's "under 900 px", where a portrait tablet gets the row too; the row on every Docs page; or a height arm such as `(max-height: 499.98px)` beside the width. The height arm would put the row on a phone turned sideways, but it would change `DOCS_COMPACT_QUERY` and its census, could catch a short desktop window, and needs desk-width tests of its own, so it is offered only as an alternative.

### Later
- **Option 2, with the library release.** What it will need from this wave's structure, which this wave keeps open:
  - `headLayoutFor` gains a third answer (one bar) when the frame reports that it can take host commands; nothing else in `DocsHead` decides a layout.
  - `useHeadActions` stays the one reader of View on GitHub, Share, Export and Open committed version, so moving them into a ⋯ menu is a different render of the same states.
  - The panel's body (the crumbs, `TruthLine`, the link actions, the waiting words) is one block, so option 2's details sheet, opened by tapping the title, holds the same block.
  - `freshDot` and its names move beside the title unchanged.
  - The row's order (back, label, actions, Page details) leaves room for the library's three tools (quick jump, Aa, contents) before ⋯.
  - The label shows the file name; option 2 shows the document's title, which needs the frame to report it (or the parse's first heading).
  - On the library's side, not ccrc's: the bridge passes `features.chrome.bar = false` (the adapter set's pinned key count grows by one), host commands to open quick jump, Aa and contents, a throttled progress report, and an optional trim of the frame's 8 px body margin and 29 px gap (about 133 to 100 px for this option, 81 to 61 for option 2).
- The compact row for tablets or listings, or a height arm for a phone turned sideways (Q3's alternatives), if the operator wants one after using this one (one line in `headLayoutFor`, one constant, and its own width and height cases).
- "Formatting…" over the host on the full header too (desktops and tablets), which this wave leaves as it is.
- The operator's device check after rollout, on the phone that set the figure.
