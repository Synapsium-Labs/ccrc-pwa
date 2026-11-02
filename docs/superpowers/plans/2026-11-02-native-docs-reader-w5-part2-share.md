# Native Docs reader, W5 part 2 — Share Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 2 (2026-11-02): review round 1's eleven findings applied (see the review's dispositions). Drafted at base `02622053c312e6d93819d19a54d17c03e1639cc5` (`origin/main`, 2026-11-02). **Approved by the operator on 2026-11-02, with every recommendation taken**: (f) a failed raster image settles Share; (r) a leaf that opens nothing links at the tree's commit; and the six departing refinements are written into the spec in the ledger PR (#2124). It replaces the Share draft of 2026-10-17, which was written against #402's tip before W5 part 1 merged; the technical decisions that still hold at this base are carried in, re-verified (refinements below), and the rest is dropped.

**Scope:**
- In: spec §4.16 Share in full: `shareTargetFor` and its words (`SHARE_SENTENCE`, `SHARE_NOTE`, the closed worktree label); the share sheet (Share… through Web Share, Copy link through `copyText`, the read-only fallback field); Share in the Docs header on project, section, directory and leaf pages, hidden until the tree slot is `ok`, disabled reading "Updating to <short>…" while the leaf does not show `pinFor`'s pin; the raster leaf's settled image pin; the Share chrome's tap-target and contrast standing; the M4.SH7 scans. Rows: M4.SH1, M4.SH2, M4.SH3 (Share half), M4.SH4-SH7, M4.SH8 (Share half), M4.EX12 (Share half), M4.T7's Share clause, M4.S1's Share clause.
- Out: Export (§4.17) and every row of it, including the Export halves of M4.SH3 and M4.SH8 (refinement (c)); the `GithubTarget` widening, `githubPermalink` and `githubUrlAt`, which W5 part 1's first L0 task already landed (measured at base: `shared/docs.ts#githubPermalink`, M3.16-M3.18 in `server/test/docs-shared.test.ts`); W5h-a, W5h-b, W5b, W6, W7, W8b; Share in `frame=full` and on version views (§4.13). No route, wire field, page key, census entry or durable state (§4.16).

**Goal:** A Docs page can be sent to someone who has no ccrc session. Tapping Share on a project, section, directory or leaf page opens a sheet holding a GitHub permalink at the commit the page opened, the notes that say what the link does not carry (drafts, `onRef`, an HTML page shown as source) and the access note, with Share… (the native share sheet, where the browser has one) and Copy link. Where no link can work, the sheet says why. Nothing leaves the browser but a GitHub URL, its title and its text.

**Architecture:** Share runs entirely in the PWA and makes no request. `docs/share.ts` (beside the existing `copyText`) holds the pure `shareTargetFor(tree, page, opened)`: it takes the page's GitHub target from `githubTargetFor` (moved from `DocsHead.tsx` to `docsTree.ts`, re-exported), the commit from what the page opened, and the link from L0 `githubPermalink`, and returns the link with its title, text and notes, or a closed refusal word. Every draft word comes from `entryView` through `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`; every worktree is named by the new closed label. `DocsHead.tsx` decides when Share is offered (`shareStateFor`, pure) from the page, the tree, the visit's file slot and, for a raster leaf, the pin its own image settled at, which `DocImage` reports through a new context that only `RasterBody` provides (`DocImage → DocsLeaf → DocsScreen → DocsHead`). The header's Share is a `<button>` riding `.docs-action`; a tap opens `docs/ShareSheet.tsx` on `@ccrc/ui`'s `Sheet`. Share reads the visit's file slot, never the body, so it behaves the same whether a Markdown leaf shows in W8a's reader frame or in the plain view.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`), React 19, `@ccrc/ui` (`Sheet`, `Button`, `QC_ACTIONS`), vitest 5 (the lock's 5.0.5) on jsdom (no `Worker`, no Web Share, no clipboard), the TypeScript AST for the scans; Node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`: §0 (`sharing`, `share-drafts`, `share-export` decisions 1, 8 and 10), §1, §3.11 (the permalink builder, as landed), §4.3 item 5 (`pinFor`, the opened pin, the raster leaf), §4.4, §4.5 (actions, "Share and Export"), §4.6, §4.7 (the Share maps), §4.13 (deferred), §4.14 (the Share chrome), §4.15 (M4.SH1-SH8, M4.EX12, M4.T7, M4.S1), §4.16, §7.7's "W5 Share" row and §7.9's Share suites. Where the spec and the base disagree, the refinements below say so.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md`, Waves row 5 ("Part 2, Share") and "Next-wave brief (W5h-a and Share)": Share runs in parallel with W5h-a; Export follows both.

**Format:** Markdown, by the operator's ruling of 2026-10-07. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 10's tools parse this file's `### Task` headings and the JSON row fences each task records.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only). Every Docs test injects its loaders (`docsFixtures.ts#fakeLoaders`) and its parser; no test reaches a server.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each). Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/w5s-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/w5s-mut/` is removed at Task 10.
- **Scope.** This wave creates `pwa/src/docs/ShareSheet.tsx`, `pwa/test/docs-share.test.ts` and `pwa/test/docs-share-sheet.test.tsx`. It edits `pwa/src/docs/share.ts`, `pwa/src/docs/docsText.ts`, `pwa/src/docs/docsTree.ts`, `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/useDocsVisit.ts` (two `export` keywords and their doc comments only), `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocsLeaf.tsx` (its `./DocImage` import, `RasterBody`, the `DocsLeaf` prop and the raster call site only), `pwa/src/docs/docs.css`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/docs-screen.test.tsx` (five import lines across Tasks 4 and 6, two appended describes), `pwa/test/tap-targets.test.tsx` (one import line, one inserted describe), `pwa/test/control-census.test.ts` (one registry entry), `pwa/test/docs-scans.test.ts` (one appended clause), and this plan (Task 9 defines `## Deviations found`, Task 10 appends `## Share results`). Byte-identical: `shared/**`, `server/src/**`, `agent/**`, `ccd/**`, `deploy/**`, `ui/**`, `pwa/design/**`, `pwa/test/contrast.test.ts`, `pwa/test/hover-states.test.ts`, `pwa/test/motion-reduced.test.ts`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/docs-truth.test.tsx`, `pwa/test/reader-frame.test.tsx`, every other `pwa/test/docs-*` file, `pwa/src/lib/**`, `pwa/src/docs/reader/**`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/DocMarkdown.tsx`, `README.md`. One allowed exception, claimed first: if `pwa/test/reader-frame.test.tsx` reds because its `vi.mock('../src/docs/share', () => ({ copyText: … }))` factory lacks a name Share reads at render, its factory becomes `async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/docs/share')>()), copyText: vi.fn(async () => {}) })` and nothing else in it changes (by design nothing in `share.ts` but `copyText` is read while no sheet is open, so it should stay untouched). Any other file is a stop-and-ask.
- **Base.** The child workspace is minted from `main` at or after `02622053c312e6d93819d19a54d17c03e1639cc5`. Task 1 Step 0 runs a **content** check, not an ancestry check (`T1-BASE-OK`), and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-02-native-docs-reader-w5-share/progress.md`.
- **Rings and seams.** `pwaRing` decides each file's ring from its facts (`server/test/rings/pwa-rings.test.ts`). `docs/docsTree.ts` and `docs/docsText.ts` stay L1 (pure; `docsText.ts` takes Share's types with `import type` only, so it gains no runtime edge). `docs/share.ts` is L3 by its own fact (`copyText` reads `navigator.clipboard`); `shareTargetFor` in it is pure and imports only `shared/docs`, `docsText` and `docsTree`, never a `.tsx`, a store or `lib/api.ts`. `docs/ShareSheet.tsx` and `docs/DocsHead.tsx` are L4. No overloaded `null`: `shareTargetFor` answers `null` for one condition ("this page has no Share": the index, or a path this listing does not hold); `DocsLeafImageContext`'s `null` means one thing ("nothing listens"); the leaf image report's `null` means one thing ("no pin is settled"); `ShareState` and `ShareTarget` are discriminated unions.
- **Exact values.** Nothing is restated: `DOCS_CLASS_CAP`, `DOC_SECTIONS`, `docRepoPath`, `githubPermalink`, `entryView`, `admitDraft` and `contentClass` are imported from `shared/docs.ts`; badge and withheld words come from `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`; the short commit is `shortCommit`'s. No production file spells GitHub's address (the permalink comes from L0; M3.17 holds `shared/docs.ts` to one such literal).
- **Never spelled by this wave** (W5 part 1's and W8a's lists, as they apply): a quoted `x-ccrc-docs`; a second declaration of an L0 name or cap; a quoted section slug or the four slugs joined in production code (derive from `DOC_SECTIONS`; test fixtures may name `specs`, as `docsFixtures.ts` does); PNG magic bytes (read `DOCS_RASTER_TYPES`); the standalone docs server's lower-case name or directory name anywhere in `pwa/src` or this plan (M7.9); `repeat(<n>, 1fr)` in any stylesheet; the word `full` inside a `<Sheet>` tag; real host, user, project, pool, account or path names (projects `demo`, `a`, `b`; branch `main`; `example-org/example-repo`; `/repo/...`; `https://a.example`); raw control bytes in fixtures (build them with `String.fromCharCode`); a numeric line citation (`file.ts` + colon + line) in any code or test file (`citations.test.ts` refuses an added one: cite `file#symbol`); a `D-` number outside `## Deviations found`; a `D-TBD` token in any commit (`server/test/dtbd.test.ts`); a 25-character-or-longer sentence written twice under `pwa/src`, `ui/src` or `shared/` (`literal-census.test.ts`).
- **PUBLIC REPO.** `Synapsium-Labs/ccrc-pwa` is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 10 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block below is quoted from the base and must match exactly once; if it is absent or matches twice (W5h-a may have merged first), stop and ask the coordinator. A later task that re-spells anchored code re-anchors the earlier row under the same id.
- **File-shape invariants are judged NET against BASE.** Counts a step relies on are re-derived at that step, never carried from planning.
- **Text-scan guards** use the TypeScript AST (`ts.createSourceFile`) and list their known evasions in their header as "NOT EXHAUSTIVE".
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and records the measured rows as ONE JSON fence (`id`, `pkg`, `file`, `old`, `new`, `tests`, `red`) in the SDD ledger at its last step; Task 10 copies every fence into `## Share results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `W5S-T<n>-M<k>`. A row's expected red names every test it turns red, with the count, at the END STATE (Task 10's run of the whole table); where tests a later task adds also go red, the row says how many failed at its own task as well ("5 failed at the end state (2 at Task 4)"). A row whose measured red differs from its stated red is a stop-and-ask, never a silent re-count.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, the census and contrast suites) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `typecheck-tests`, `fleet-screen`, `session-hook`, `ccd-*`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` (pwa's tsconfig includes `test/`, so a non-exhaustive `Record` in a test or in `src` is a TSC failure).
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 9's last step defines them in `## Deviations found`. A session that cannot reach the allocator writes `D-TBD-<slug>` in its report only, never in a commit.
- **The parallel wave.** W5h-a runs beside this wave (operator, 2026-10-15) and moves highlighting off the main thread: it edits `lib/markdown.tsx`, `DocsLeaf.tsx`'s `TextBody`, `DocMarkdown`/`DocParse` and chat, and may append to `docs-scans.test.ts`, `control-census.test.ts`, `tap-targets.test.tsx` and `docs.css`. Share renders no body and reads no highlight result, so its edits stay out of those areas: in `DocsLeaf.tsx` it touches the import of `./DocImage`, `RasterBody`, the `DocsLeaf` props and the raster call site, and nothing of `TextBody`. Whichever of the two merges second takes `main` and re-measures (claims checked at dispatch and at each task's Step 0).
- **Carried items** (the ledger's "Carried constraints (reviewers get these)"): none is fixed by this wave's code and none blocks Share. One is already closed: the line "`GithubTarget` cannot express `resolveDocRef`'s `repo` kind. This is W5's first L0 task" was closed by W5 part 1 (#627: `shared/docs.ts#GithubTarget` has `repo` and `root`, held by M3.16-M3.18), and the ledger PR that carries this plan marks it closed there, citing those. W8a's residue goes to W8b; W3's, W2's, W4's and SEC-3/SEC-4 stay with the waves the ledger names; the W7 prose residue stays W7's. This wave adds one item for W7: README's Share prose (§7.5) describes Share as shipped here, refinements included.
- **Commits.** One per task (Task 9's fixes one per finding), files staged by name, message `<area>: <what> (docs W5 Share)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Task 10 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR (#2124), which besides the spec amendments does three things:
  - **It moves M4.SH3's and M4.SH8's Export halves to Export, unconditionally (refinement (c)).** It adds "M4.SH3's and M4.SH8's Export halves (moved from Share, refinement (c))" to §7.7's W5 Export row and to the ledger's Export bullet in "Next-wave brief (W5h-a and Share)". Neither names them at the base (the Export row lists M4.EX1-EX16, M4.T7, M4.S1, M5.17, M5.B9, M4.EX17, M4.EX18 and M4.H21; the Share row lists M4.SH1-SH8 whole), so without this the two halves would belong to no wave. Before opening the run the coordinator checks it: `git grep -n "M4.SH3" -- docs/superpowers/specs/2026-10-01-native-docs-reader-design.md docs/superpowers/programs/native-docs-reader.md` lists the W5 Export row and the Export bullet, and so does the same grep for `M4.SH8`.
  - **It closes the carried `GithubTarget` line** as closed by #627 (Global Constraints, "Carried items").
  - **It records this plan** in the ledger's Plans line.
  Separately, refinements (a), (b), (c), (e), (f) and (i) depart from the spec's text. The ledger PR (#2124) amended those sentences in place, each edit marked "(amended 2026-11-02; Share)", as the operator ruled on 2026-11-02: §4.1's file table (the closed label's home, (b); the `design/audit.mjs` and `test/contrast.test.ts` row's "the Share and Export chrome", (e)); §4.3 item 5 ((f), worded "for Share, a raster leaf reads 'the image has settled, loaded or failed'", so that Export's "the image is loaded" stands); §4.14 ("joins the registrations", (e), and the Sheet's path, (d)); §4.15's M4.SH3, M4.SH8, M4.EX12 and M4.S1; §4.16 ((a), (i)); §7.7's Share row ((c)). The child workspace therefore holds this plan; Task 9 and Task 10 append to it on the branch, and Task 10's PR body links its GitHub `blob/main` path.
- **The run row and the issued block.** The coordinator opens the Share run row (`planned`) and is issued a contiguous deviation block by `POST /api/ledger/deviations` at run-open, at least ten numbers: six for the departing refinements (a), (b), (c), (e), (f) and (i), in that order, the rest for departures found while executing and in fix rounds. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the base.
- **Claims** are checked at dispatch, against W5h-a's run in particular, and again in Step 0 of each task that edits a shared file: `pwa/src/docs/share.ts`, `pwa/src/docs/docsText.ts`, `pwa/src/docs/docsTree.ts`, `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/useDocsVisit.ts`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/docs.css`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/docs-screen.test.tsx`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts`, `pwa/test/docs-scans.test.ts`. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-10, the base, the issued block, the claim state (W5h-a's included), and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers; an `opus` per-task reviewer on Tasks 2 to 6; the whole-branch panel on `opus` (Task 9) with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill, any `gh` write verb, any token in an argv, and approval-prompting shell forms.
- **Worker flow:** the worker acks, runs Tasks 1-8 with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalation to the operator: none is expected; a Find block that W5h-a moved is a stop-and-ask to the coordinator, not an operator question. Task 9 is the held-out whole-branch review and its fix wave. Task 10 closes: the suites, the whole mutation table, `## Share results` (that commit is the `handoffCommit` and the tip), push, the ONE pull request, the fingerprint with that PR's number and `prPhase: 'open'`, and the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming four lenses: (1) what leaves the browser (every share argument, the notes, the closed label, no document text, the refusal words and the access note); (2) the opened pin and its timing (`shareStateFor`, the same-blob rule, the raster report, the sheet's lifetime, the reader frame and the plain view alike); (3) the sheet's two doors (synchronous Web Share, `AbortError` by name, `copyText` only, the fallback field) and the M4.SH7 scan with its controls; (4) the test and mutation table, the chrome's census standing (control, markup, literal, shape, tap targets, the no-colour guard), rings, and spec and deviation fidelity, plus the public-repo scan.
- **Merge gate:** the operator's approval of this plan (given 2026-11-02); part 1 merged (it is, #627); every Share row green; the reviewer's report accepted by the coordinator; the PR's required checks green. No R1/R2 gate: Share changes no server route.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel); the coordinator or operator rolls it out fleet first (`ccrc rollout --to vX.Y.Z`; Share is PWA-only). Share is then live on the dev channel. The Export run follows W5h-a and Share; it adds Export after Share in the header, passes its own availability to the sheet's `exportOffered`, and carries the Export halves of M4.SH3 and M4.SH8, which the ledger PR wrote into its §7.7 row and its ledger bullet.

## Review Focus

The untrusted inputs a person meets first, each pinned in the task that owns it:

| Input | What could go wrong | Pinned by |
|---|---|---|
| A document's own text (a hostile h1, bidi controls, a URL in the body) | It becomes the shared link's title or text | Task 2 (M4.SH1's sweep and hostile-h1 case: W5S-T2-M8) |
| The tree answer's worktree paths and branch names | A fleet path leaves the browser in a note | Task 1 (the closed label: W5S-T1-M3), Task 2 (M4.SH1's sweep) |
| A re-list during the visit (C1 to C2, the blob changed or not) | Share links a commit the page is not showing, or says C1's `onRef` of C2 | Task 2 (W5S-T2-M1, M4), Task 3 (W5S-T3-M1, M2), Task 6 (the screen's M4.EX12 cases) |
| The served ref's relation to origin | A permalink GitHub cannot open | L0 `githubPermalink` (M3.16, landed); Task 2's refusal cases (W5S-T2-M3) |
| Web Share and the clipboard | A lost user activation, a swallowed failure, a link left with no way to copy it | Task 5 (W5S-T5-M1 to M6) |
| A second sharer or clipboard writer | A path around the sheet or `copyText` | Task 8 (M4.SH7's scan and its planted controls: W5S-T8-M1 to M3) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/src/docs/docsText.ts` | 1 | L1 | `SHARE_SENTENCE`, `SHARE_NOTE`, `SHARE_TEXT`, `SHARE_SHEET_TEXT`, the Export seam (`SHARE_EXPORT_CLAUSE`, `SHARE_EXPORT_CLAUSE_FOR`, `shareRefusalSentence`), `shareNoteSentence`, `closedWorktreeLabel`; three header words |
| `pwa/src/docs/share.ts` | 1, 2 | L3 (by `copyText`) | Share's types; `shareTargetFor`; `copyText` unchanged |
| `pwa/src/docs/docsTree.ts` | 2 | L1 | `githubTargetFor`, moved from `DocsHead.tsx` |
| `pwa/test/docs-share.test.ts` | 1-3 | — | M4.SH1, SH2, SH3 (Share half), SH6, EX12 (pure), T7 (Share clause), SH8 (pure half) |
| `pwa/src/docs/DocsHead.tsx` | 2, 3, 6 | L4 | the re-export; `shareStateFor`; `ShareAction`; the actions row |
| `pwa/src/docs/useDocsVisit.ts` | 3 | L4 (as today) | `samePin` and `pinCommit` exported, bodies unchanged |
| `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocsLeaf.tsx` | 4 | L4 | `DocsLeafImageContext`; the leaf's own image reports its settled pin |
| `pwa/src/docs/ShareSheet.tsx`, `pwa/test/docs-share-sheet.test.tsx` | 5, 7 | L4 | the sheet (M4.SH4, SH5, SH6 rendered); Task 7 appends the no-colour guard |
| `pwa/src/screens/DocsScreen.tsx`, `pwa/test/docs-screen.test.tsx`, `pwa/test/control-census.test.ts` | 4, 6 | L4 | the leaf image state and its two props; M4.SH8, M4.EX12 and the raster clause of M4.SH1 on the screen; the Share button's census entry |
| `pwa/src/docs/docs.css`, `pwa/test/tap-targets.test.tsx` | 7 | — | the Share chrome, tokens only and no colour; both tap-target halves |
| `pwa/test/docs-scans.test.ts` | 8 | — | M4.SH7; M4.T7's scan reaching the Share files |

## Spec refinements (decided while planning)

Each refinement says What, Why and Cost if wrong. A **departure** contradicts a spec sentence and gets one issued number in `## Deviations found` (Task 9's last step), in the order (a), (b), (c), (e), (f), (i). The rest fill a silence or follow the base, and get no number.

- **(a) A same-blob re-list: the link names the opened pin, and `onRef` speaks only of the commit it was measured at. Departure.**
  - What: Share's commit for a committed leaf is the opened pin's `commit`. When a re-list moves the served commit from C1 to C2 and the file's blob is unchanged, the visit keeps the C1 answer and rebinds the slot's pin to C2 without a second read (`useDocsVisit.ts#useDocsVisit`'s "The same blob at a newer commit" branch, measured at base). Share then links C2, and the C1 answer's `onRef` note is not shown, because it was measured for C1. Departs from §4.16 ("that is the commit `DocsShowOk.commit` echoes, and M4.EX12 checks that they agree") and M4.EX12's "equals the file answer's `commit`", which hold at this base only when the blob changed.
  - Why: the bytes on screen are C2's bytes (same blob), the truth line names C2, and C2 is what the page served (goal 4). Linking C1 would disagree with the page; saying C1's `onRef` of C2 would narrow an older fact into a newer claim.
  - Cost if wrong: if the operator wants the answer's commit and the link to agree always, Share must wait for a fresh read after every same-blob re-list, which the visit deliberately avoids (one more file request per re-list).
- **(b) The closed worktree label lives in `docs/docsText.ts`. Departure.**
  - What: `closedWorktreeLabel` ("main checkout", "workspace <last segment>", "another worktree") is written now, in `docsText.ts`, beside the truth line's `worktreeLabel`; Export's `provenance.ts` imports it later. Departs from §4.1's file table, which puts "the provenance block and closed label" in `docs/export/provenance.ts`.
  - Why: Share's notes name a worktree (§4.16: "The labels in the notes are the closed labels of §4.17") and Share ships before Export; one definition, in the module that holds every other Docs sentence.
  - Cost if wrong: Export moves one function; nothing else changes.
- **(c) The Export halves of M4.SH3 and M4.SH8 go to Export's run; the Export clause is a seam, not text. Departure.**
  - What: Share's run carries M4.SH3's link and refusal half and M4.SH8's Share half (no Share on the index or in `frame=full`; View on GitHub, Share, Open committed version, in that order; the project page's Share through `root`; hidden while the tree slot loads). "Export enabled / absent", Export's position and "Export is not offered for `other`, nor for `html`" go to the Export plan. The refusal sentences are the spec's without "Export makes a file you can send" (§4.16 says so until Export ships); the clause and the four refusals that take it are declared once (`SHARE_EXPORT_CLAUSE`, `SHARE_EXPORT_CLAUSE_FOR`), and `shareRefusalSentence(why, fields, exportOffered)` adds it only when the page offers Export. Every caller in this wave passes `false`. Departs from §7.7's "W5 Share" row, which lists M4.SH1-SH8 whole.
  - Why: a test should fail when the code its run owns breaks; this run builds no Export. The seam lets Export add the clause by passing its availability, with no rewrite of any sentence.
  - Cost if wrong: none to Share. The two halves are not lost: the ledger PR writes them into §7.7's W5 Export row and the ledger's Export bullet unconditionally, whatever the operator rules on the spec amendments ("How this wave runs"), and the coordinator greps for both before the run opens.
- **(d) The sheet sits on `@ccrc/ui`'s `Sheet`. Not a departure.** §4.16 and §4.14 ("Both sheets use the existing `components/Sheet.tsx`") name `components/Sheet.tsx`; that file is not on `main` (the bottom sheet moved into `@ccrc/ui`, `ui/src/primitives/sheet.tsx`, which W8a's `ReaderSheets.tsx` uses). Same primitive, current path. Cost if wrong: none.
- **(e) The Share chrome paints no colour, so nothing is registered in `design/audit.mjs`. Departure.**
  - What: the header's Share wears `.docs-action` (its ink is its container's: `color: inherit`), and the sheet's rules set no colour, ground or border colour: they inherit the `Sheet` panel's measured ink and ground, as W8a's reader sheets do. So the contrast census is unchanged and there is nothing to register; the guard is a test that no `.docs-share` rule sets a colour (Task 7, W5S-T7-M2). Departs from M4.S1's amended text ("the Share and Export chrome … registered"), §4.14's "Share and Export chrome … joins the registrations" and §4.1's file row for `design/audit.mjs` and `test/contrast.test.ts` ("from W5 (2026-10-13) also the Share and Export chrome"), for Share's half only.
  - Why: a registration names a ground for an ink a rule sets; with no ink set, an entry would register nothing, and the frozen census admits no entry without a rule.
  - Cost if wrong: if the operator wants the Share notes in a quieter ink, each such rule needs an `INHERITED_GROUNDS` entry on the Sheet's ground and a contrast measurement; the guard tells the next author so.
- **(f) A raster leaf's Share waits for its image to settle, loaded or failed; an over-cap raster is ready without a load. Departure (the failed case).**
  - What: `DocImage` reports, through `DocsLeafImageContext` (provided only by `RasterBody`), the pin of the leaf's own image once it is shown or has failed, and `null` while it loads or after it unmounts; Share is ready when that pin equals `pinFor`'s. A raster over `DOCS_CLASS_CAP.raster`, which `DocImage` refuses without a load, is ready at `pinFor`'s pin at once, as a file slot's `too-large` is. Departs from §4.3 item 5's "a raster leaf reads 'the image is loaded'" and M4.EX12's "wait for the image to load" for an image that fails, for Share only: Export, which needs the bytes, keeps "the image is loaded". The over-cap case fills a silence.
  - Why: a failed file read settles a normal leaf (its slot carries the pin, so Share is offered), and a raster leaf whose image failed would otherwise read "Updating to <short>…" for ever, which is false. The link is to the tree's own commit either way.
  - Cost if wrong: one condition in `DocImage`'s report (`shown.s !== 'loading'` becomes `shown.s === 'loaded'`) and one test; Share on a failed raster then stays disabled.
- **(g) `shareTargetFor(tree, page, opened)` reads its entry from the tree. Not a departure.** §4.16 writes `(tree, page, entry, opened)`. The entry is found through `docsPathKind`, the rule that decides what the page is, so a caller cannot hand in an entry that disagrees with the page. It answers `null` for one condition: the page has no Share (the index, or a path this listing does not hold). Same inputs, same answers.
- **(h) One disabled state.** A leaf that has not shown anything yet (its first read is in flight, or its raster image is loading) has no opened pin, so it differs from `pinFor`'s: Share is disabled and reads "Updating to <short>…", the one disabled state §4.16 defines. Not a departure.
- **(i) `dir-drafts` counts in words. Departure.** The note reads "{k} uncommitted doc{s} here {be} not included." (§4.16: "<k> uncommitted docs here are not included."), so one draft reads "1 uncommitted doc here is not included." The banners already do this (`DOCS_BANNER_TEXT`'s `{s}` and `{be}`). Cost if wrong: one string.
- **(j) `new-withheld`'s reason drops its final full stop.** The sentence embeds `WITHHELD_SENTENCE[reason]` in parentheses; its trailing "." is dropped there ("(The draft is too large for Docs to read)"). Rendering detail; not a departure.
- **(k) `githubTargetFor` moves to `docs/docsTree.ts`.** It is pure and uses only `docsPathKind`, which lives there; `share.ts` needs the one target rule without importing a component, and `DocsHead.tsx` re-exports it, so `docs-truth.test.tsx`'s import stays as it is. Not a departure.
- **(l) The header's Share is `<button className="docs-action docs-share">`.** It rides `.docs-action`'s floor and look beside the two link actions; `.docs-share` adds the pointer and drops the underline while disabled. Not a departure.
- **(m) No Share on a path this listing does not hold.** §4.16 lists the pages Share is on (project, section, directory, leaf); a path the tree does not hold is none of them, and View on GitHub is absent there too (`githubTargetFor` answers `null`). Not a departure.
- **(n) An open sheet closes when what it is about changes.** `ShareAction` is keyed by the page's URL, the tree's commit and what the leaf opened, so a re-list or a back gesture under an open sheet closes it instead of leaving a link to a page the screen no longer shows; the target is computed when the sheet opens. Not a departure.
- **(o) `shareStateFor` lives in `DocsHead.tsx`, not `share.ts`.** `reader-frame.test.tsx` (W8a) mocks `../src/docs/share` with `copyText` alone and renders `DocsScreen`, so the header must read nothing else of `share.ts` while no sheet is open. The decision is pure and exported beside `githubTargetFor`'s re-export and `truthSource`. Not a departure.
- **(p) M4.SH1's "no `/docs/`" means ccrc's page path; no session id can reach Share's inputs. Not a departure.**
  - What: M4.SH1 says no ccrc origin, `/docs/`, `/api/`, worktree path or session id appears in any argument. Read literally, `/docs/` cannot hold for the URL: every permalink holds the repository path `docs/superpowers/...`. The plan reads it as ccrc's own page path, `DOCS_PAGE_PREFIX` followed by `/<project>`, and the API prefix `DOCS_API_PREFIX`: no argument holds either, and `title`, `text` and every note sentence hold no `/docs/` at all (Task 2's sweep). A session id: the tree answer (`DocsTreeOk`) and the file answer carry no session id field; the one place a fleet name can sit in Share's inputs is a worktree path, which a workspace may be named after. So the sweep plants a placeholder session id (`wrapper-a-demo`, the `<wrapper>-<project>` shape) as a segment of the holder's worktree path that is not its last, and asserts it never appears. The last segment is the spec's own allowance ("workspace <last segment>", §4.17's closed label).
  - Why: the literal check fails on every correct link, and the narrowed one must still catch a ccrc URL for any page of the project, not only the page's own.
  - Cost if wrong: none to the code; the sweep's assertions change.
- **(q) A leaf of a class Docs does not preview (`other`) is ready at `pinFor`'s pin. Not a departure.**
  - What: such a leaf reads no file (`useDocsVisit.ts#wantedFile` gives it no file slot within its cap; its page offers Download), so there is no opened pin to wait for. Share is ready at once, with `pinFor`'s pin and no answer. §4.16's "Which commit" covers a leaf that opened a committed pin and a leaf that opened a draft; this fills the silence for a leaf that reads nothing.
  - Why: `pinFor`'s pin is what the page lists and what Download would fetch; waiting for a read that never comes would leave Share disabled for ever.
  - Cost if wrong: one line in `shareStateFor` and one case in Task 3 (Share absent, or disabled, on such leaves instead).
- **(r) A leaf that opens nothing (a committed symlink or submodule: `pinFor` is null) links at `tree.ref.commit`. Not a departure.**
  - What: Share is ready with nothing opened, and the link is `/blob/<tree.ref.commit>/<repo path>`, as View on GitHub's leaf target already is for such an entry. A new file Docs withheld (`opens === 'none'` with no committed side) is refused instead, `new-withheld`, by L0's `uncommitted` row.
  - Why: the page shows the tree's own view of the entry ("not followed"), so the commit the page served is the tree's (goal 4).
  - Cost if wrong: if the operator rules Share absent on such leaves, `shareStateFor` answers `absent` where `pinFor` is null on a leaf (one line, two cases). GitHub may not open a submodule's `/blob/` URL, exactly as it may not for View on GitHub today.
- **Measurements, not departures:** the base already holds the `GithubTarget` widening, `githubPermalink`, `githubUrlAt` and their rows (W5 part 1's first L0 task); this plan builds on them and re-plans none.

### Task 1: Share's words, the Export seam and the closed worktree label (M4.SH6's maps; refinements (b), (c), (i), (j))

**Model routing:** `sonnet`, effort `medium`. Little judgment: the sentences are the spec's, and the seam is one function.

**Spec rows:** §4.7's Share maps, §4.16's refusal and note tables, M4.SH6 (exhaustive maps); refinements (b), (c), (i), (j).

**Files:**
- Modify: `pwa/src/docs/share.ts` (header comment; Share's four word types appended after `copyText`), `pwa/src/docs/docsText.ts` (one import line, three `DOCS_HEAD_TEXT` keys, one appended block).
- Create: `pwa/test/docs-share.test.ts`.
- Guards (not edited): `pwa/test/docs-truth.test.tsx`, `pwa/test/docs-banners.test.tsx`, `pwa/test/docs-failures.test.tsx`, `pwa/test/literal-census.test.ts`.

**Interfaces:** Consumes `fillSentence`, `DOCS_HEAD_TEXT` (`docsText.ts`). Produces, in `share.ts`: `ShareRefusal`, `ShareNote`, `ShareFields`, `ShareNoteLine`; in `docsText.ts`: `SHARE_SHEET_TEXT`, `SHARE_TEXT`, `SHARE_SENTENCE`, `SHARE_EXPORT_CLAUSE`, `SHARE_EXPORT_CLAUSE_FOR`, `shareRefusalSentence(why, fields, exportOffered)`, `SHARE_NOTE`, `shareNoteSentence(line)`, `closedWorktreeLabel(w)`, and `DOCS_HEAD_TEXT.share`, `.shareUpdating`, `.worktreeOther`.

**Decisions:** (1) The refusal sentences are §4.16's without "Export makes a file you can send"; the clause and the four refusals that take it (`no-github-origin`, `bad-slug`, `bad-target`, `new-draft`, as §4.16's table has it) are declared once, and only `shareRefusalSentence` joins them, when its `exportOffered` is true (refinement (c)). (2) `docsText.ts` takes Share's types with `import type` only, so it stays L1 with no runtime edge into `share.ts`. (3) `closedWorktreeLabel` is new and separate from `worktreeLabel`, which stays as it is: the truth line stays in the browser and may name two segments (refinement (b)). (Departures: (b), (c), (i).)

- [ ] **Step 0: Base, claims, counts.** Run:
  `git grep -qF "export function githubPermalink" HEAD -- shared/docs.ts && git grep -qF "export async function copyText" HEAD -- pwa/src/docs/share.ts && ! git grep -qF "export function shareTargetFor" HEAD -- pwa/src && git grep -qF "export function githubTargetFor" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "function RasterBody(p: { readonly link: LinkBase; readonly name: string }): ReactNode {" HEAD -- pwa/src/docs/DocsLeaf.tsx && test ! -e pwa/src/docs/ShareSheet.tsx && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Record BASE (`git rev-parse HEAD`) in `.superpowers/sdd/2026-11-02-native-docs-reader-w5-share/progress.md`. Confirm the claims on `share.ts` and `docsText.ts` (and W5h-a's state). Record the counts of the guard suites above.
- [ ] **Step 1: Write `pwa/test/docs-share.test.ts`** with exactly this content (Tasks 2 and 3 replace its import block and append to it):

```ts
// Docs W5 Share (spec 2026-10-01 4.5, 4.7, 4.16; native Docs reader W5, Share): what Share sends and when, pure.
// Task 1, the words: the refusal and note maps, exhaustive by key; Export's clause as a seam no page takes yet; the
// closed worktree label. Task 2, `shareTargetFor` over hand-built tree answers and pins (M4.SH1, M4.SH2, M4.SH3's
// Share half, M4.SH6, M4.EX12's pure half, M4.T7's Share clause). Task 3, `shareStateFor` (M4.SH8's pure half and
// M4.EX12's "disabled while the pin differs"). Placeholders only: project `demo`, branch `main`,
// `example-org/example-repo`, `/repo/...`.
import { describe, expect, it } from 'vitest';
import {
  DOCS_HEAD_TEXT, SHARE_EXPORT_CLAUSE, SHARE_EXPORT_CLAUSE_FOR, SHARE_NOTE, SHARE_SENTENCE, closedWorktreeLabel,
  shareNoteSentence, shareRefusalSentence, worktreeLabel,
} from '../src/docs/docsText';
import type { ShareRefusal } from '../src/docs/share';

const SHORT_A = 'a'.repeat(8);

describe('the Share words (spec 4.7, 4.16; M4.SH6)', () => {
  const REFUSALS: ShareRefusal[] =
    ['bad-slug', 'bad-target', 'new-draft', 'new-withheld', 'no-github-origin', 'not-on-origin', 'unmeasured'];
  const NOTES = ['access', 'admitted-committed', 'dir-drafts', 'drafts-excluded', 'html-source', 'onRef-not-contained',
    'onRef-unmeasured', 'view-committed'];
  const FIELDS = { short: SHORT_A, withheld: 'The draft is too large for Docs to read' };

  it('SHARE_SENTENCE has one sentence per refusal word, and SHARE_NOTE one per note word', () => {
    expect(Object.keys(SHARE_SENTENCE).sort()).toEqual(REFUSALS);
    expect(Object.keys(SHARE_NOTE).sort()).toEqual(NOTES);
  });

  it("no refusal sentence carries Export's clause while no page offers Export (refinement (c))", () => {
    for (const why of REFUSALS) expect(shareRefusalSentence(why, FIELDS, false), why).not.toContain('Export makes');
  });

  it('the Export seam: a page that offers Export adds the clause to exactly the four refusals the spec gives it', () => {
    const takers = REFUSALS.filter((why) => shareRefusalSentence(why, FIELDS, true).endsWith(' ' + SHARE_EXPORT_CLAUSE));
    expect(takers).toEqual(['bad-slug', 'bad-target', 'new-draft', 'no-github-origin']);
    expect([...SHARE_EXPORT_CLAUSE_FOR].sort()).toEqual(takers);
  });

  it("the refusal sentences are spec 4.16's, without Export's clause", () => {
    expect(shareRefusalSentence('no-github-origin', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-slug', {}, false)).toBe('No GitHub link for this project.');
    expect(shareRefusalSentence('bad-target', {}, false)).toBe('Docs could not build a GitHub link for this page.');
    expect(shareRefusalSentence('not-on-origin', { short: SHORT_A }, false))
      .toBe(`Commit ${SHORT_A} is not on origin; push it to share.`);
    expect(shareRefusalSentence('unmeasured', { short: SHORT_A }, false))
      .toBe(`Docs could not measure whether origin has ${SHORT_A}; Refresh, then share.`);
    expect(shareRefusalSentence('new-draft', {}, false)).toBe('Not committed yet, so GitHub has nothing to show.');
    expect(shareRefusalSentence('new-withheld', FIELDS, false))
      .toBe('Not committed yet, and Docs did not read it (The draft is too large for Docs to read); nothing to share or export.');
  });

  it("the notes are spec 4.16's", () => {
    expect(shareNoteSentence({ note: 'access', fields: { slug: 'example-org/example-repo' } }))
      .toBe("Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.");
    expect(shareNoteSentence({ note: 'html-source', fields: {} })).toBe('GitHub shows this page as source.');
    expect(shareNoteSentence({ note: 'view-committed', fields: { label: 'main checkout' } }))
      .toBe('Uncommitted changes in main checkout are not included.');
  });

  it('dir-drafts counts in words: one doc is, three docs are (refinement (i))', () => {
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 1, s: '', be: 'is' } }))
      .toBe('1 uncommitted doc here is not included.');
    expect(shareNoteSentence({ note: 'dir-drafts', fields: { k: 3, s: 's', be: 'are' } }))
      .toBe('3 uncommitted docs here are not included.');
  });

  it('closedWorktreeLabel names a worktree from a closed set, never another segment of its path (refinement (b))', () => {
    expect(closedWorktreeLabel({ path: '/repo/demo', class: 'main' })).toBe('main checkout');
    expect(closedWorktreeLabel({ path: '/repo/demo/.ws/ws-a/', class: 'workspace' })).toBe('workspace ws-a');
    expect(closedWorktreeLabel({ path: '/', class: 'workspace' })).toBe(DOCS_HEAD_TEXT.worktreeOther);
    expect(closedWorktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('another worktree');
    // The truth line's label is unchanged: it stays in the browser and may name the last two segments.
    expect(worktreeLabel({ path: '/repo/elsewhere/wt-b', class: 'other' })).toBe('elsewhere/wt-b');
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` — Expected: `Tests  7 failed (7)` (none of the new names exists yet).
- [ ] **Step 3: Implement `share.ts`'s header and types.** Find (the file's first four lines):

```ts
// The Docs screen's clipboard writer (spec 2026-10-01 4.5's "One clipboard writer"; refinement (t); W5 part 1 Task
// 10). `copyText` is the ONE place under `pwa/src/docs` that writes the clipboard: the truth line's "copy commit" in
// part 1, and part 2's share sheet ("Copy link") beside it, which adds `shareTargetFor` here (`downloadExport` goes
// beside `saveBytes` in `docs/objectUrls.ts`, spec 4.1 and 5.4).
```

Replace with:

```ts
// Share (spec 2026-10-01 4.5, 4.16; native Docs reader W5, Share) and the Docs screen's one clipboard writer.
//
// `copyText` is the ONE place under `pwa/src/docs` that writes the clipboard (spec 4.5's "One clipboard writer";
// M4.SH7): the truth line's "copy commit", the share sheet's Copy link and the reader frame's copy op all call it.
//
// `shareTargetFor` is what Share sends: a GitHub permalink at the commit the page opened (L0 `githubPermalink`), its
// title and text, and the notes the sheet shows, or the closed word for why there is no link. It reads the tree
// answer, the page and what the leaf opened, never a document's bytes, so no h1, `<title>` or body text reaches a
// link (M4.SH1); every draft word it carries is `entryView`'s, through `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`
// (M4.T7); and a worktree is named only by its closed label. Its sentences are docsText.ts's; the sheet is
// ShareSheet.tsx. It makes no request and keeps no state. (`downloadExport` goes beside `saveBytes` in
// `docs/objectUrls.ts`, spec 4.1 and 5.4.)
```

  Then append after `copyText`'s closing brace (its five body lines stay byte-identical; `git diff` shows no `-` line inside it):

```ts

/** Why Share sends no link (spec 4.16 "Refusal words"). Each `GithubPermalink` refusal keeps its own word except
 *  `uncommitted`, which splits by what the leaf opens: `new-draft`, a readable new draft; `new-withheld`, a new file
 *  Docs did not read. They need different sentences, so they are different words. */
export type ShareRefusal =
  | 'no-github-origin' | 'bad-slug' | 'bad-target' | 'not-on-origin' | 'unmeasured' | 'new-draft' | 'new-withheld';

/** The sheet's notes (spec 4.16 "Note words"), one word per note. */
export type ShareNote =
  | 'access' | 'html-source' | 'onRef-not-contained' | 'onRef-unmeasured' | 'drafts-excluded' | 'view-committed'
  | 'admitted-committed' | 'dir-drafts';

/** The values a Share sentence names (`fillSentence`'s fields). */
export type ShareFields = Readonly<Record<string, string | number>>;

/** One note on the sheet: its word, and the values its sentence names. */
export interface ShareNoteLine {
  readonly note: ShareNote;
  readonly fields: ShareFields;
}
```

- [ ] **Step 4: Implement `docsText.ts`.**
  - Find `import type { ImagePin } from './docsLinks';` and add on the next line: `import type { ShareFields, ShareNote, ShareNoteLine, ShareRefusal } from './share';`
  - In `DOCS_HEAD_TEXT`, find `  openCommitted: 'Open committed version',` and add after it `  share: 'Share',` and `  shareUpdating: 'Updating to {short}…',` (U+2026). Find `  worktreeWorkspace: 'workspace {name}',` (the line before `} as const;`) and add after it `  worktreeOther: 'another worktree',`.
  - Find the end of `worktreeLabel`:

```ts
    case 'other':
      return parts.slice(-2).join('/');
  }
}
```

  and append after it:

```ts

// ===== Share (spec 4.7, 4.16; native Docs reader W5, Share) =====
// Share's words: the sheet's own, a link's text, the refusal sentences and the notes, each map keyed by Share's own
// closed word so a new word is a compile error until it has its sentence. Every `{field}` is a value `shareTargetFor`
// computes from the tree answer: a short commit, a served ref, a closed worktree label, a badge's text, a count, the
// repository's slug; never a path on the fleet box, and never a document's text.

/** The share sheet's own words (spec 4.16). */
export const SHARE_SHEET_TEXT = {
  title: 'Share',
  share: 'Share…',
  copy: 'Copy link',
  copied: 'Link copied.',
  copyRefused: 'The clipboard refused the link. It is selected below; copy it by hand.',
  shareFailed: 'Sharing did not finish. Copy link still works.',
  field: 'The link to share',
} as const;

/** A link's text (spec 4.16 "Text"): a leaf, a directory or a section by its own repo path, the project page by its
 *  name alone. Never the document's h1 or `<title>`, which its author controls. */
export const SHARE_TEXT = {
  path: '{project} · {path} at {short}',
  project: '{project} at {short}',
} as const;

const NO_GITHUB_LINK = 'No GitHub link for this project.';

/** Why Share sends no link (spec 4.16's refusal table), each without Export's clause, which `shareRefusalSentence`
 *  adds on a page that offers Export. `{short}` is the short commit; `{withheld}` is `WITHHELD_SENTENCE`'s reason
 *  without its full stop (refinement (j)). `bad-slug` says what `no-github-origin` says, under its own key. */
export const SHARE_SENTENCE: Record<ShareRefusal, string> = {
  'no-github-origin': NO_GITHUB_LINK,
  'bad-slug': NO_GITHUB_LINK,
  'bad-target': 'Docs could not build a GitHub link for this page.',
  'not-on-origin': 'Commit {short} is not on origin; push it to share.',
  'unmeasured': 'Docs could not measure whether origin has {short}; Refresh, then share.',
  'new-draft': 'Not committed yet, so GitHub has nothing to show.',
  'new-withheld': 'Not committed yet, and Docs did not read it ({withheld}); nothing to share or export.',
};

/** Export's clause (spec 4.16), and the refusals that take it on a page that offers Export. THE SEAM FOR EXPORT
 *  (refinement (c)): until Export ships no page offers it, so every caller passes `exportOffered: false` and no
 *  sentence carries the clause. Export's run passes its own availability and changes no sentence here. */
export const SHARE_EXPORT_CLAUSE = 'Export makes a file you can send.';
export const SHARE_EXPORT_CLAUSE_FOR: ReadonlySet<ShareRefusal> =
  new Set<ShareRefusal>(['no-github-origin', 'bad-slug', 'bad-target', 'new-draft']);

/** A refusal's sentence, filled from its fields, with Export's clause when the page offers Export. */
export function shareRefusalSentence(why: ShareRefusal, fields: ShareFields, exportOffered: boolean): string {
  const sentence = fillSentence(SHARE_SENTENCE[why], fields);
  return exportOffered && SHARE_EXPORT_CLAUSE_FOR.has(why) ? `${sentence} ${SHARE_EXPORT_CLAUSE}` : sentence;
}

/** The sheet's notes (spec 4.16's table). `{label}` is `closedWorktreeLabel`'s; `{badge}` is `ENTRY_BADGE_TEXT`'s;
 *  `{served}` is `servedRefText`'s; `{slug}` is the repository's `owner/name`; `{k}`, `{s}` and `{be}` count the drafts
 *  a listing's link leaves out (refinement (i)). W6 adds Export's "viewable copy" sentence to `html-source`. */
export const SHARE_NOTE: Record<ShareNote, string> = {
  'access': "Opens on GitHub ({slug}). People without access see GitHub's 404.",
  'html-source': 'GitHub shows this page as source.',
  'onRef-not-contained': 'Commit {short} is no longer on {served}; GitHub may stop serving it.',
  'onRef-unmeasured': 'Docs could not tell whether {short} is still on {served}.',
  'drafts-excluded':
    'Drafts are not included: the link opens the committed version at {short}; {label} has uncommitted changes to this doc.',
  'view-committed': 'Uncommitted changes in {label} are not included.',
  'admitted-committed': '{badge} in {label}; the link opens the committed version.',
  'dir-drafts': '{k} uncommitted doc{s} here {be} not included.',
};

/** One note's sentence, filled from its fields. */
export function shareNoteSentence(line: ShareNoteLine): string {
  return fillSentence(SHARE_NOTE[line.note], line.fields);
}

/** A worktree as Share (and, later, Export) names it: the closed label of spec 4.17, "main checkout", "workspace
 *  <last segment>" (class `workspace` only) or "another worktree" (refinement (b)). Never another segment of the path,
 *  which the truth line's `worktreeLabel` may show: these words leave the browser in a link's notes. A workspace path
 *  with no segment reads as another worktree, never as the path. */
export function closedWorktreeLabel(w: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): string {
  switch (w.class) {
    case 'main':
      return DOCS_HEAD_TEXT.worktreeMain;
    case 'workspace': {
      const last = w.path.split('/').filter((s) => s !== '').at(-1);
      return last === undefined ? DOCS_HEAD_TEXT.worktreeOther : fillSentence(DOCS_HEAD_TEXT.worktreeWorkspace, { name: last });
    }
    case 'other':
      return DOCS_HEAD_TEXT.worktreeOther;
  }
}
```

- [ ] **Step 5: Run to verify it passes**, then the guards. `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` — Expected: `Tests  7 passed (7)`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-truth.test.tsx test/docs-banners.test.tsx test/docs-failures.test.tsx )` — Expected: Step 0's counts, all green. `( cd pwa && ./node_modules/.bin/vitest run test/literal-census.test.ts )` — Expected: unchanged, green (no Share sentence of 25 characters or more is written twice). `TSC-OK`.
- [ ] **Step 6: Commit.** `git add pwa/src/docs/share.ts pwa/src/docs/docsText.ts pwa/test/docs-share.test.ts` (expect 3), message `docs: Share's words, the Export seam and the closed worktree label (docs W5 Share)`, trailer. Record the task's JSON row fence in the SDD ledger.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T1-M1 | pwa | `src/docs/docsText.ts` | `return exportOffered && SHARE_EXPORT_CLAUSE_FOR.has(why)` → `return SHARE_EXPORT_CLAUSE_FOR.has(why)` | `test/docs-share.test.ts` | 2 failed — `"no refusal sentence carries Export's clause while no page offers Export (refinement (c))"`; `"the refusal sentences are spec 4.16's, without Export's clause"` |
| W5S-T1-M2 | pwa | `src/docs/docsText.ts` | `['no-github-origin', 'bad-slug', 'bad-target', 'new-draft']` → `['no-github-origin', 'bad-slug', 'new-draft']` | `test/docs-share.test.ts` | 1 failed — `'the Export seam: a page that offers Export adds the clause to exactly the four refusals the spec gives it'` |
| W5S-T1-M3 | pwa | `src/docs/docsText.ts` | in `closedWorktreeLabel`, `case 'other':\n      return DOCS_HEAD_TEXT.worktreeOther;` → `case 'other':\n      return w.path.split('/').filter((s) => s !== '').slice(-2).join('/');` | `test/docs-share.test.ts` | 2 failed at the end state (1 at Task 1) — `'closedWorktreeLabel names a worktree from a closed set, never another segment of its path (refinement (b))'`; from Task 2, `'a worktree outside the closed set is named "another worktree", never by its path'` |
| W5S-T1-M4 | pwa | `src/docs/docsText.ts` | `'{k} uncommitted doc{s} here {be} not included.'` → `'{k} uncommitted docs here are not included.'` | `test/docs-share.test.ts` | 1 failed — `'dir-drafts counts in words: one doc is, three docs are (refinement (i))'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` — 7 passed; the guards unchanged; `TSC-OK`.

### Task 2: `shareTargetFor`, and View on GitHub's target moved to `docsTree.ts` (M4.SH1, SH2, SH3 Share half, SH6, EX12 pure half, T7 Share clause; refinements (a), (g), (k), (p), (r))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in which commit a page names and in what may leave the browser.

**Spec rows:** §4.16 ("Which commit", `shareTargetFor`, "What Share sends, by page", the refusals), M4.SH1, M4.SH2, M4.SH3 (link half), M4.SH6, M4.EX12 (the link names the opened pin), M4.T7 (Share clause); refinements (a), (g), (j), (k), (p), (r).

**Files:**
- Modify: `pwa/src/docs/docsTree.ts` (its `shared/docs` import; `githubTargetFor` added after `docsPathKind`), `pwa/src/docs/DocsHead.tsx` (its `./docsTree` import; `githubTargetFor`'s body replaced by a re-export), `pwa/src/docs/share.ts` (an import block after the header; two types, `draftsInScope` and `shareTargetFor` appended), `pwa/test/docs-share.test.ts` (its import block replaced; describes appended).
- Guards (not edited): `pwa/test/docs-truth.test.tsx` (its `githubTargetFor` cases import it from `DocsHead`), `pwa/test/docs-tree.test.ts`, `pwa/test/docs-scans.test.ts` (clause 1 reads `share.ts` for `.draft.state`), `server/test/rings/pwa-rings.test.ts`.

**Interfaces:**
- Consumes: `githubPermalink`, `entryView`, `admitDraft`, `contentClass`, `docRepoPath`, `DOC_SECTIONS` (`shared/docs.ts`); `docsPathKind`, `leafName` (`docsTree.ts`); Task 1's words; `ENTRY_BADGE_TEXT`, `WITHHELD_SENTENCE`, `servedRefText`, `shortCommit`, `pluralS`, `fillSentence` (`docsText.ts`).
- Produces: `export function githubTargetFor(page: DocsPageLocation, tree: DocsTreeOk): GithubTarget | null` in `docsTree.ts` (body unchanged; `DocsHead.tsx` re-exports it); in `share.ts`: `ShareOpened`, `ShareTarget` and `export function shareTargetFor(tree: DocsTreeOk, page: DocsPageLocation, opened: ShareOpened): ShareTarget | null`.

**Decisions:** (1) The commit (§4.16 "Which commit"): a leaf whose opened pin is committed names that pin's `commit`; every other page names `tree.ref.commit`, which is also the committed side an opened draft stands on (a draft opens only when its holder's HEAD is the served commit) and the commit of a leaf that opens nothing (refinement (r)). (2) `onRef` notes only when the answer's `commit` equals the opened pin's (refinement (a)). (3) Notes in this order: one draft note (`view-committed` when admitted and `view=committed`; else `drafts-excluded` when the leaf opens a draft; else `admitted-committed` when admitted), then `html-source`, then the `onRef` note, then (listings in a ref view) `dir-drafts`, then `access` last. (4) A refusal carries the `access` note unless it is `no-github-origin` or `bad-slug`, and no other note. (5) `dir-drafts` counts the entries in the page's scope that `entryView(e, drafts, 'ref')` badges; a directory's scope is `path + '/'`, so `guide` never counts `guidebook/`. (6) Title and text use the target's own repo path, never anything read from the document. (Departure: (a). Fills: (g), (j), (p), (r).)

- [ ] **Step 0:** `git grep -qF "export function githubTargetFor(page: DocsPageLocation, tree: DocsTreeOk): GithubTarget | null {" HEAD -- pwa/src/docs/DocsHead.tsx && git grep -qF "export type ShareNote" HEAD -- pwa/src/docs/share.ts && echo T2-BASE-OK`. Claim `docsTree.ts`, `DocsHead.tsx`. Record the guard suites' counts.
- [ ] **Step 1: Replace `docs-share.test.ts`'s import block** (from `import { describe, expect, it } from 'vitest';` through `import type { ShareRefusal } from '../src/docs/share';`) with:

```ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import {
  DOCS_API_PREFIX, DOCS_PAGE_PREFIX, type DocPin, type DocsEntry, type DocsShowOk, type DocsTreeOk, type DraftsFacts,
} from '../../shared/docs';
import { DocsTreeView } from '../src/docs/DocsTreeView';
import {
  DOCS_HEAD_TEXT, SHARE_EXPORT_CLAUSE, SHARE_EXPORT_CLAUSE_FOR, SHARE_NOTE, SHARE_SENTENCE, closedWorktreeLabel,
  shareNoteSentence, shareRefusalSentence, worktreeLabel,
} from '../src/docs/docsText';
import { shareTargetFor, type ShareOpened, type ShareRefusal, type ShareTarget } from '../src/docs/share';
import { pinFor } from '../src/docs/useDocsVisit';
import {
  BLOB_1, BLOB_2, COMMIT_A, COMMIT_B, SERVED, draftOf, entry, fileResponse, holder, pageAt, treeOk,
} from './docsFixtures';
```

  and append at the end of the file:

```ts

// ---- Task 2: shareTargetFor -------------------------------------------------------------------------------------

const GH = 'https://github.com/example-org/example-repo';
const NONE: ShareOpened = { kind: 'none' };
const ACCESS = "Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.";

const committedPin = (commit: string, path = 'a.md'): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });
const opened = (pin: DocPin, show: DocsShowOk | null = null): ShareOpened => ({ kind: 'file', pin, show });

/** A committed answer at `commit` whose text is a hostile h1 (a URL, a bidi override) that Share must never read. */
function showAt(commit: string, over: Partial<DocsShowOk> = {}): DocsShowOk {
  const h1 = `# Re-authenticate at https://a.example ${String.fromCharCode(0x202e)}gpj.exe\n`;
  return { ...fileResponse(h1).show, commit, blob: BLOB_1, onRef: 'contains', ...over };
}

/** An entry under `specs` with a draft over it: by default a modified regular file over a committed one. */
function drafted(path: string, draft = draftOf('modified'),
  committed: DocsEntry['committed'] = { kind: 'file', blob: BLOB_2, size: 100 }): DocsEntry {
  return { section: 'specs', path, committed, draft };
}

/** The pin the tree implies for `url`'s leaf; throws when it opens nothing (a fixture defect). */
function pinOf(tree: DocsTreeOk, url: string): DocPin {
  const pin = pinFor(tree, pageAt(url));
  if (pin === null) throw new Error(`fixture: ${url} opens no file`);
  return pin;
}

function linkOf(t: ShareTarget | null): Extract<ShareTarget, { ok: true }> {
  if (t === null || !t.ok) throw new Error(`expected a link, got ${JSON.stringify(t)}`);
  return t;
}

function refusalOf(t: ShareTarget | null): Extract<ShareTarget, { ok: false }> {
  if (t === null || t.ok) throw new Error(`expected a refusal, got ${JSON.stringify(t)}`);
  return t;
}

const noteWords = (t: ShareTarget): string[] => t.notes.map((n) => n.note);

function noteText(t: ShareTarget, note: string): string | undefined {
  const line = t.notes.find((n) => n.note === note);
  return line === undefined ? undefined : shareNoteSentence(line);
}

const withRef = (tree: DocsTreeOk, over: Partial<DocsTreeOk['ref']>): DocsTreeOk => ({ ...tree, ref: { ...tree.ref, ...over } });

/** `holder()`'s record with another worktree. `holder()` answers the whole `DraftsFacts` union, so it is narrowed to the
 *  holder arm before the spread (a spread over the union would keep arms whose `worktree` is a string). */
function holderAt(worktree: { readonly path: string; readonly class: 'main' | 'workspace' | 'other' }): DraftsFacts {
  const h = holder();
  if (h.state !== 'holder') throw new Error('fixture: holder() is not a holder');
  return { ...h, worktree: { ...h.worktree, ...worktree } };
}

/** A placeholder in a session id's shape (`<wrapper>-<project>`), planted where a fleet name could sit in Share's
 *  inputs: a worktree path segment that is not its last (refinement (p)). */
const SESSION_ID = 'wrapper-a-demo';

describe('shareTargetFor: the link, its title and its text, by page (spec 4.16; M4.SH1)', () => {
  it('the project page: /tree/<C>, titled by the project, its text "<project> at <short>"', () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo'), NONE));
    expect(t).toMatchObject({ url: `${GH}/tree/${COMMIT_A}`, commit: COMMIT_A, title: 'demo', text: `demo at ${SHORT_A}` });
    expect(noteWords(t)).toEqual(['access']);
    expect(noteText(t, 'access')).toBe(ACCESS);
  });

  it("a section page: /tree/<C>/<section path>, titled by its last segment", () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs'), NONE));
    expect(t).toMatchObject({
      url: `${GH}/tree/${COMMIT_A}/docs/superpowers/specs`, title: 'specs', text: `demo · docs/superpowers/specs at ${SHORT_A}`,
    });
  });

  it('a directory page: /tree/<C>/<its repo path>', () => {
    const tree = treeOk({ entries: [entry('specs', 'd/x.md')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/d/'), NONE));
    expect(t).toMatchObject({
      url: `${GH}/tree/${COMMIT_A}/docs/superpowers/specs/d`, title: 'd', text: `demo · docs/superpowers/specs/d at ${SHORT_A}`,
    });
  });

  it("a leaf: /blob/<the opened commit>/<repo path>, titled by its basename even when the doc's h1 is hostile", () => {
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/a.md'), opened(committedPin(COMMIT_A), showAt(COMMIT_A))));
    expect(t).toMatchObject({
      url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`, title: 'a.md',
      text: `demo · docs/superpowers/specs/a.md at ${SHORT_A}`,
    });
  });

  it("a leaf that opens nothing (a committed symlink) links at the tree's commit (refinement (r))", () => {
    const tree = treeOk({ entries: [entry('specs', 'l.md', { committed: { kind: 'symlink', blob: BLOB_1, size: 10 } })] });
    expect(pinFor(tree, pageAt('/docs/demo/specs/l.md'))).toBeNull();
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/l.md'), NONE));
    expect(t).toMatchObject({ url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/l.md`, title: 'l.md' });
  });

  it('a raster leaf links the commit of the pin its image settled at', () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/x.png'), opened(committedPin(COMMIT_A, 'x.png'))));
    expect(t).toMatchObject({ url: `${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`, title: 'x.png' });
  });

  it('every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p))', () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md'), entry('specs', 'd/x.md'), entry('specs', 'x.png'), drafted('m.md')],
      drafts: holderAt({ path: `/repo/${SESSION_ID}/ws-a`, class: 'workspace' }),
    });
    const PERMALINK = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:blob|tree)\/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:\/|$)/;
    const cases: [string, ShareOpened][] = [
      ['/docs/demo', NONE],
      ['/docs/demo/specs', NONE],
      ['/docs/demo/specs/d/', NONE],
      ['/docs/demo/specs/a.md', opened(committedPin(COMMIT_A), showAt(COMMIT_A))],
      ['/docs/demo/specs/x.png', opened(committedPin(COMMIT_A, 'x.png'))],
      ['/docs/demo/specs/m.md?ref=main', opened(pinOf(tree, '/docs/demo/specs/m.md?ref=main'))],
      ['/docs/demo/specs/m.md?ref=main&view=committed', opened(committedPin(COMMIT_A, 'm.md'))],
    ];
    for (const [url, o] of cases) {
      const page = pageAt(url);
      const t = linkOf(shareTargetFor(tree, page, o));
      expect(t.url, url).toMatch(PERMALINK);
      const sentences = t.notes.map(shareNoteSentence);
      for (const arg of [t.url, t.title, t.text, ...sentences]) {
        expect(arg, url).not.toContain(location.origin);
        expect(arg, url).not.toContain(`${DOCS_PAGE_PREFIX}/demo`);
        expect(arg, url).not.toContain(DOCS_API_PREFIX);
        expect(arg, url).not.toContain('/api/');
        expect(arg, url).not.toContain('/repo/');
        expect(arg, url).not.toContain(SESSION_ID);
        expect(arg, url).not.toContain('a.example');
        expect(arg, url).not.toContain(String.fromCharCode(0x202e));
      }
      // The repository path in the URL starts with `docs/`; nothing else Share sends may hold `/docs/` at all.
      for (const words of [t.title, t.text, ...sentences]) expect(words, url).not.toContain('/docs/');
    }
    // The planted session id does reach Share's input, and the label that leaves names only the last segment.
    const draftLink = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/m.md?ref=main'),
      opened(pinOf(tree, '/docs/demo/specs/m.md?ref=main'))));
    expect(noteText(draftLink, 'drafts-excluded')).toContain('workspace ws-a has uncommitted changes');
  });

  it('the index and a path this listing does not hold have no Share target', () => {
    expect(shareTargetFor(treeOk(), pageAt('/docs'), NONE)).toBeNull();
    expect(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/zzz.md'), NONE)).toBeNull();
  });
});

describe('shareTargetFor: drafts (the drafts ruling; M4.SH2, M4.SH3 Share half)', () => {
  it('a ref-view leaf opening a draft with a committed side sends the committed permalink at C, and says drafts are not included (M4.SH2)', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.url).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
    expect(noteWords(t)).toEqual(['drafts-excluded', 'access']);
    expect(noteText(t, 'drafts-excluded')).toBe(
      `Drafts are not included: the link opens the committed version at ${SHORT_A}; main checkout has uncommitted changes to this doc.`);
  });

  it('the default view of the same leaf gives no warning (M4.SH2)', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md';
    expect(noteWords(linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url)))))).toEqual(['access']);
  });

  it('view=committed on an admitted entry: the permalink, and the uncommitted changes are not included', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main&view=committed';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteWords(t)).toEqual(['view-committed', 'access']);
    expect(noteText(t, 'view-committed')).toBe('Uncommitted changes in main checkout are not included.');
  });

  it.each([
    ['deleted', draftOf('deleted', { kind: 'absent', fp: null, size: null }), 'draft · deleted'],
    ['typechange', draftOf('typechange', { kind: 'symlink', fp: null }), 'draft · type changed'],
    ['withheld', draftOf('modified', { fp: null }), 'draft · withheld'],
  ] as const)('admitted but opening committed (%s): the permalink, and the badge the row shows', (_name, draft, badge) => {
    const tree = treeOk({ entries: [drafted('a.md', draft)], drafts: holder() });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteWords(t)).toEqual(['admitted-committed', 'access']);
    expect(noteText(t, 'admitted-committed')).toBe(`${badge} in main checkout; the link opens the committed version.`);
  });

  it.each(['added', 'untracked'] as const)('a readable new draft (%s, fp set) sends no link: new-draft, with the access note (M4.SH3)', (state) => {
    const tree = treeOk({ entries: [drafted('n.md', draftOf(state), null)], drafts: holder() });
    const url = '/docs/demo/specs/n.md?ref=main';
    const t = refusalOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.why).toBe('new-draft');
    expect(noteWords(t)).toEqual(['access']);
  });

  it('a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3)', () => {
    const tree = treeOk({ entries: [drafted('n.md', draftOf('added', { fp: null }), null)], drafts: holder() });
    const url = '/docs/demo/specs/n.md?ref=main';
    expect(pinFor(tree, pageAt(url))).toBeNull();
    const t = refusalOf(shareTargetFor(tree, pageAt(url), NONE));
    expect(t.why).toBe('new-withheld');
    expect(shareRefusalSentence(t.why, t.fields, false)).toBe(
      'Not committed yet, and Docs did not read it (The draft is too large for Docs to read); nothing to share or export.');
    expect(noteWords(t)).toEqual(['access']);
  });

  it('a worktree outside the closed set is named "another worktree", never by its path', () => {
    const tree = treeOk({ entries: [drafted('a.md')], drafts: holderAt({ path: '/repo/elsewhere/wt-b', class: 'other' }) });
    const url = '/docs/demo/specs/a.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(noteText(t, 'drafts-excluded')).toContain('another worktree has uncommitted changes');
    expect(t.notes.map(shareNoteSentence).join(' ')).not.toContain('wt-b');
  });
});

describe('shareTargetFor: the notes and the refusals (spec 4.16; M4.SH6)', () => {
  it('an html leaf: the permalink, and GitHub shows it as source', () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    const t = linkOf(shareTargetFor(tree, pageAt('/docs/demo/specs/m.html'), opened(committedPin(COMMIT_A, 'm.html'))));
    expect(noteWords(t)).toEqual(['html-source', 'access']);
    expect(noteText(t, 'html-source')).toBe('GitHub shows this page as source.');
  });

  it.each([
    ['not-contained', 'onRef-not-contained', `Commit ${SHORT_A} is no longer on origin/main; GitHub may stop serving it.`],
    ['unmeasured', 'onRef-unmeasured', `Docs could not tell whether ${SHORT_A} is still on origin/main.`],
  ] as const)('a file answer whose onRef is %s: the permalink and its note', (onRef, note, text) => {
    const o = opened(committedPin(COMMIT_A), showAt(COMMIT_A, { onRef }));
    const t = linkOf(shareTargetFor(treeOk(), pageAt('/docs/demo/specs/a.md'), o));
    expect(noteWords(t)).toEqual([note, 'access']);
    expect(noteText(t, note)).toBe(text);
  });

  it.each([
    ['not-on-origin', withRef(treeOk(), { side: 'local', relation: 'local-only', via: 'local' }), { short: SHORT_A }],
    ['unmeasured', withRef(treeOk(), { side: 'local', relation: 'unmeasured', via: 'local' }), { short: SHORT_A }],
    ['bad-target', withRef(treeOk(), { commit: 'a'.repeat(39) }), {}],
  ] as const)('%s: no link, its fields, and the access note, since the slug is usable', (why, tree, fields) => {
    const t = refusalOf(shareTargetFor(tree, pageAt('/docs/demo/specs'), NONE));
    expect(t.why).toBe(why);
    expect(t.fields).toEqual(fields);
    expect(noteWords(t)).toEqual(['access']);
  });

  it('no-github-origin and bad-slug: no link and no access note, for there is no usable slug to name', () => {
    const none: DocsTreeOk = { ...treeOk(), github: { state: 'none' } };
    const badSlug: DocsTreeOk = { ...treeOk(), github: { state: 'named', slug: '../x' } };
    expect(refusalOf(shareTargetFor(none, pageAt('/docs/demo/specs'), NONE))).toMatchObject({ why: 'no-github-origin', notes: [] });
    expect(refusalOf(shareTargetFor(badSlug, pageAt('/docs/demo/specs'), NONE))).toMatchObject({ why: 'bad-slug', notes: [] });
  });
});

describe('shareTargetFor: which commit (spec 4.16; M4.EX12, refinement (a))', () => {
  it("a leaf links the commit its opened pin names, never the tree's newer commit (M4.EX12)", () => {
    const o = opened(committedPin(COMMIT_A), showAt(COMMIT_A));
    const t = linkOf(shareTargetFor(treeOk({ commit: COMMIT_B }), pageAt('/docs/demo/specs/a.md'), o));
    expect(t.commit).toBe(COMMIT_A);
    expect(t.url).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`);
  });

  it("a same-blob re-list: the pin is at C2 and the answer still says C1; the link names C2, and C1's onRef is not said of it", () => {
    const o = opened(committedPin(COMMIT_B), showAt(COMMIT_A, { onRef: 'not-contained' }));
    const t = linkOf(shareTargetFor(treeOk({ commit: COMMIT_B }), pageAt('/docs/demo/specs/a.md'), o));
    expect(t.commit).toBe(COMMIT_B);
    expect(noteWords(t)).toEqual(['access']);
  });
});

describe('shareTargetFor: a listing in a ref view says how many uncommitted docs its link leaves out (dir-drafts)', () => {
  const tree = treeOk({
    drafts: holder(),
    entries: [
      drafted('a.md'), drafted('d/x.md', draftOf('added'), null), entry('specs', 'd/y.md'),
      { ...drafted('p.md'), section: 'plans' }, drafted('guide/g.md'), drafted('guidebook/h.md'),
    ],
  });

  it.each([
    ['/docs/demo?ref=main', 5], ['/docs/demo/specs?ref=main', 4], ['/docs/demo/specs/d/?ref=main', 1],
    ['/docs/demo/specs/guide/?ref=main', 1],
  ] as const)('%s counts %i', (url, k) => {
    const t = linkOf(shareTargetFor(tree, pageAt(url), NONE));
    expect(noteWords(t)).toEqual(['dir-drafts', 'access']);
    expect(t.notes[0]?.fields).toEqual({ k, s: k === 1 ? '' : 's', be: k === 1 ? 'is' : 'are' });
  });

  it.each(['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/'])('the default view %s says nothing of drafts', (url) => {
    expect(noteWords(linkOf(shareTargetFor(tree, pageAt(url), NONE)))).toEqual(['access']);
  });
});

describe('one badge function: Share names the badge the row shows (M4.T7, Share clause)', () => {
  const COMMITTED = { kind: 'file', blob: BLOB_2, size: 100 } as const;
  it.each([
    ['deleted', draftOf('deleted', { kind: 'absent', fp: null, size: null })],
    ['typechange', draftOf('typechange', { kind: 'symlink', fp: null })],
    ['withheld, too large', draftOf('modified', { fp: null })],
    ['withheld, unreadable', draftOf('modified', { kind: 'unreadable', fp: null })],
    ['withheld, not a file', draftOf('modified', { kind: 'special', fp: null })],
  ] as const)('%s', (_name, draft) => {
    const e: DocsEntry = { section: 'specs', path: 'x.md', committed: COMMITTED, draft };
    const tree = treeOk({ entries: [e], drafts: holder() });
    const row = render(createElement(DocsTreeView, { tree, page: pageAt('/docs/demo/specs?ref=main') }));
    const rowText = row.container.querySelector('.docs-badge')?.textContent;
    row.unmount();
    expect(rowText).toBeTruthy();
    const url = '/docs/demo/specs/x.md?ref=main';
    const t = linkOf(shareTargetFor(tree, pageAt(url), opened(pinOf(tree, url))));
    expect(t.notes.find((n) => n.note === 'admitted-committed')?.fields['badge']).toBe(rowText);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` — Expected: Task 1's 7 cases green; every Task 2 case red (`shareTargetFor` does not exist yet).
- [ ] **Step 3: Move `githubTargetFor`.**
  - `docsTree.ts`: in its `shared/docs` import, add `type DocsPageLocation,` and `type GithubTarget,` to the type names. Find `/** The last segment of a section-relative path: a leaf's file name, and the name Download saves it under. */` and insert before it:

```ts
/** What View on GitHub and Share point at (spec 3.11, 4.4, 4.16): the repository root on a project page, the section,
 *  the directory, or the leaf (`uncommitted` when its entry has no committed side). Null has one meaning: the page has
 *  no GitHub counterpart (the index, or a path this listing does not hold). Moved here from `DocsHead.tsx`, which
 *  re-exports it, so `share.ts` reaches the one target rule without importing a component (refinement (k)). */
export function githubTargetFor(page: DocsPageLocation, tree: DocsTreeOk): GithubTarget | null {
  switch (page.kind) {
    case 'index':
      return null;
    case 'project':
      return { kind: 'root' };
    case 'section':
      return { kind: 'section', section: page.section };
    case 'path': {
      const k = docsPathKind(tree, page.section, page.path, page.ref === null ? 'default' : 'ref');
      if (k.kind === 'leaf') return { kind: 'leaf', section: page.section, path: page.path, uncommitted: k.entry.committed === null };
      return k.kind === 'dir' ? { kind: 'dir', section: page.section, path: page.path } : null;
    }
  }
}

```

  - `DocsHead.tsx`: `import { SECTION_LABEL, docsPathKind } from './docsTree';` becomes `import { SECTION_LABEL, docsPathKind, githubTargetFor } from './docsTree';`. Replace the whole `githubTargetFor` declaration (from its doc comment `/** What View on GitHub points at (spec 3.11, 4.4): the repository root on a project page, the section, the` through the function's closing brace) with:

```ts
/** View on GitHub's and Share's target (spec 3.11, 4.4, 4.16): `docsTree.ts`'s, re-exported for the callers that import
 *  it from the header. */
export { githubTargetFor };
```

- [ ] **Step 4: Implement `shareTargetFor`.** In `share.ts`, insert after the header comment (before ``/** Writes `text` to the clipboard.``):

```ts
import {
  DOC_SECTIONS, admitDraft, contentClass, docRepoPath, entryView, githubPermalink,
  type DocPin, type DocsPageLocation, type DocsShowOk, type DocsTreeOk, type EntryMode,
} from '../../../shared/docs';
import {
  DOCS_HEAD_TEXT, ENTRY_BADGE_TEXT, SHARE_TEXT, WITHHELD_SENTENCE, closedWorktreeLabel, fillSentence, pluralS,
  servedRefText, shortCommit,
} from './docsText';
import { docsPathKind, githubTargetFor, leafName } from './docsTree';

```

  and append at the end of the file:

```ts

/** What the page opened, which decides the commit a link names (spec 4.16 "Which commit"). `file`: a leaf's opened
 *  pin (a raster leaf's is the pin its image settled at), with the file answer when the read answered (null for a
 *  raster leaf, a failed or too-large read, and a class Docs does not preview). `none`: the page opened no file: a
 *  project, section or directory page, or a leaf that opens nothing (a symlink, a submodule, a withheld new file). */
export type ShareOpened =
  | { readonly kind: 'file'; readonly pin: DocPin; readonly show: DocsShowOk | null }
  | { readonly kind: 'none' };

/** What Share sends from a page, or why it sends nothing (spec 4.16). A discriminated union, so a later kind of link
 *  (spec 4.13's expiring links) adds an arm without changing callers. Both arms carry the notes the sheet shows. */
export type ShareTarget =
  | {
    readonly ok: true; readonly url: string; readonly commit: string; readonly title: string; readonly text: string;
    readonly notes: readonly ShareNoteLine[];
  }
  | { readonly ok: false; readonly why: ShareRefusal; readonly fields: ShareFields; readonly notes: readonly ShareNoteLine[] };

/** How many entries in a listing page's scope a ref view badges: the uncommitted docs its link leaves out. A
 *  directory's scope is the entries under `path + '/'`, so `guide` never counts `guidebook/`. */
function draftsInScope(tree: DocsTreeOk, page: Exclude<DocsPageLocation, { kind: 'index' }>): number {
  const inScope = (e: DocsTreeOk['entries'][number]): boolean => page.kind === 'project'
    || (e.section === page.section && (page.kind === 'section' || e.path.startsWith(page.path + '/')));
  return tree.entries.filter((e) => inScope(e) && entryView(e, tree.drafts, 'ref').badge !== null).length;
}

/** What Share sends from `page` (spec 4.16), given what the page `opened`. Null has one meaning: the page has no Share
 *  (the index, or a path this listing does not hold; refinement (m)). The entry is read from the tree through
 *  `docsPathKind`, the rule that decides what the page is (refinement (g)). */
export function shareTargetFor(tree: DocsTreeOk, page: DocsPageLocation, opened: ShareOpened): ShareTarget | null {
  const target = githubTargetFor(page, tree);
  if (target === null || page.kind === 'index') return null;
  const mode: EntryMode = page.ref === null ? 'default' : 'ref';
  const kind = page.kind === 'path' ? docsPathKind(tree, page.section, page.path, mode) : null;
  const leaf = kind?.kind === 'leaf' ? kind : null;
  // Which commit: a leaf's opened committed pin; otherwise the tree's, which is also the committed side an opened draft
  // stands on (a draft opens only when its holder's HEAD is the served commit) and the commit of a leaf that opens
  // nothing, whose page shows the tree's own view of the entry (refinement (r)).
  const commit = leaf !== null && opened.kind === 'file' && opened.pin.kind === 'committed' ? opened.pin.commit : tree.ref.commit;
  const short = shortCommit(commit);
  const link = githubPermalink(tree.github, tree.ref, commit, target);
  const access: ShareNoteLine[] = tree.github.state === 'named' ? [{ note: 'access', fields: { slug: tree.github.slug } }] : [];
  if (!link.ok) {
    const why: ShareRefusal = link.why !== 'uncommitted' ? link.why
      : leaf !== null && leaf.view.opens === 'none' ? 'new-withheld' : 'new-draft';
    const withheld = leaf === null ? null : leaf.view.withheld;
    const fields: ShareFields = why === 'not-on-origin' || why === 'unmeasured' ? { short }
      : why === 'new-withheld' && withheld !== null ? { withheld: WITHHELD_SENTENCE[withheld].replace(/\.$/, '') }
        : {};
    // The access note names the slug, so it shows wherever there is a usable one (spec 4.16, decision 8).
    return { ok: false, why, fields, notes: why === 'no-github-origin' || why === 'bad-slug' ? [] : access };
  }
  const notes: ShareNoteLine[] = [];
  if (leaf !== null && page.kind === 'path') {
    const { entry, view } = leaf;
    const admitted = mode === 'ref' && admitDraft(entry, tree.drafts);
    const label = tree.drafts.state === 'holder' ? closedWorktreeLabel(tree.drafts.worktree) : DOCS_HEAD_TEXT.worktreeOther;
    if (admitted && page.view === 'committed') notes.push({ note: 'view-committed', fields: { label } });
    else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });
    else if (admitted && view.badge !== null) {
      notes.push({ note: 'admitted-committed', fields: { badge: ENTRY_BADGE_TEXT[view.badge], label } });
    }
    if (contentClass(page.path) === 'html') notes.push({ note: 'html-source', fields: {} });
    // `onRef` describes the commit the answer was read at. After a same-blob re-list that is older than the opened pin,
    // and says nothing of it (refinement (a)).
    if (opened.kind === 'file' && opened.pin.kind === 'committed' && opened.show !== null
      && opened.show.commit === opened.pin.commit) {
      const served = servedRefText(tree.ref);
      if (opened.show.onRef === 'not-contained') notes.push({ note: 'onRef-not-contained', fields: { short, served } });
      if (opened.show.onRef === 'unmeasured') notes.push({ note: 'onRef-unmeasured', fields: { short, served } });
    }
  } else if (mode === 'ref') {
    const k = draftsInScope(tree, page);
    if (k > 0) notes.push({ note: 'dir-drafts', fields: { k, s: pluralS(k), be: k === 1 ? 'is' : 'are' } });
  }
  notes.push(...access);
  const repoPath = target.kind === 'root' ? null
    : target.kind === 'section' ? DOC_SECTIONS[target.section]
      : target.kind === 'repo' ? target.repoPath
        : docRepoPath(target.section, target.path);
  return {
    ok: true, url: link.url, commit: link.commit,
    title: repoPath === null ? page.project : leafName(repoPath),
    text: repoPath === null
      ? fillSentence(SHARE_TEXT.project, { project: page.project, short })
      : fillSentence(SHARE_TEXT.path, { project: page.project, path: repoPath, short }),
    notes,
  };
}
```

- [ ] **Step 5: Run to verify they pass**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` all green; `( cd pwa && ./node_modules/.bin/vitest run test/docs-truth.test.tsx test/docs-tree.test.ts test/docs-scans.test.ts )` Step 0's counts, green; `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` green (`docsTree.ts` stays L1; `docsText.ts`'s new edge is type-only).
- [ ] **Step 6: Commit.** `git add pwa/src/docs/docsTree.ts pwa/src/docs/DocsHead.tsx pwa/src/docs/share.ts pwa/test/docs-share.test.ts` (expect 4), message `docs: shareTargetFor, a permalink at the commit the page opened (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T2-M1 | pwa | `src/docs/share.ts` | `opened.pin.kind === 'committed' ? opened.pin.commit : tree.ref.commit` → `opened.pin.kind === 'committed' ? tree.ref.commit : tree.ref.commit` | `test/docs-share.test.ts` | 1 failed — `"a leaf links the commit its opened pin names, never the tree's newer commit (M4.EX12)"` |
| W5S-T2-M2 | pwa | `src/docs/share.ts` | `leaf !== null && leaf.view.opens === 'none' ? 'new-withheld' : 'new-draft'` → `'new-draft'` | `test/docs-share.test.ts` | 1 failed — `'a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3)'` |
| W5S-T2-M3 | pwa | `src/docs/share.ts` | `notes: why === 'no-github-origin' \|\| why === 'bad-slug' ? [] : access` → `notes: []` | `test/docs-share.test.ts` | 6 failed — the three `'%s: no link, its fields, and the access note, since the slug is usable'` cases (`not-on-origin`, `unmeasured`, `bad-target`); the two `'a readable new draft (%s, fp set) sends no link: new-draft, with the access note (M4.SH3)'` cases; `'a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3)'` |
| W5S-T2-M4 | pwa | `src/docs/share.ts` | `&& opened.show.commit === opened.pin.commit` → removed | `test/docs-share.test.ts` | 1 failed — `"a same-blob re-list: the pin is at C2 and the answer still says C1; the link names C2, and C1's onRef is not said of it"` |
| W5S-T2-M5 | pwa | `src/docs/share.ts` | `else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });` → removed | `test/docs-share.test.ts` | 3 failed — `'a ref-view leaf opening a draft with a committed side sends the committed permalink at C, and says drafts are not included (M4.SH2)'`; `'a worktree outside the closed set is named "another worktree", never by its path'`; `'every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p))'` |
| W5S-T2-M6 | pwa | `src/docs/share.ts` | `e.path.startsWith(page.path + '/')` → `e.path.startsWith(page.path)` | `test/docs-share.test.ts` | 1 failed — `'/docs/demo/specs/guide/?ref=main counts 1'` |
| W5S-T2-M7 | pwa | `src/docs/share.ts` | `} else if (mode === 'ref') {` → `} else {` | `test/docs-share.test.ts` | 3 failed — `'the default view %s says nothing of drafts'` for `/docs/demo`, `/docs/demo/specs` and `/docs/demo/specs/d/` |
| W5S-T2-M8 | pwa | `src/docs/share.ts` | `title: repoPath === null ? page.project : leafName(repoPath),` → `title: page.project,` | `test/docs-share.test.ts` | 5 failed — `'a section page: /tree/<C>/<section path>, titled by its last segment'`; `'a directory page: /tree/<C>/<its repo path>'`; `"a leaf: /blob/<the opened commit>/<repo path>, titled by its basename even when the doc's h1 is hostile"`; `"a leaf that opens nothing (a committed symlink) links at the tree's commit (refinement (r))"`; `'a raster leaf links the commit of the pin its image settled at'` |
| W5S-T2-M9 | pwa | `src/docs/share.ts` | `fields: { badge: ENTRY_BADGE_TEXT[view.badge], label }` → `fields: { badge: view.badge, label }` (a second badge spelling) | `test/docs-share.test.ts` | 8 failed — the three `'admitted but opening committed (%s): the permalink, and the badge the row shows'` cases (`deleted`, `typechange`, `withheld`) and the five cases of `'one badge function: Share names the badge the row shows (M4.T7, Share clause)'` |
| W5S-T2-M10 | pwa | `src/docs/share.ts` | `closedWorktreeLabel(tree.drafts.worktree)` → `tree.drafts.worktree.path` | `test/docs-share.test.ts` | 7 failed — `'every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p))'` (`/repo/` and the session id); the M4.SH2 committed-permalink case; `'view=committed on an admitted entry: the permalink, and the uncommitted changes are not included'`; the three `'admitted but opening committed (%s) …'` cases; `'a worktree outside the closed set is named "another worktree", never by its path'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts test/docs-truth.test.tsx test/docs-tree.test.ts )`; `TSC-OK`; `pwa-rings` green.

### Task 3: When Share is offered: `shareStateFor` (M4.SH8 pure half; M4.EX12 "disabled while the pin differs"; refinements (f), (h), (m), (o), (q), (r))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in what counts as "the pin the page opened" for each kind of leaf.

**Spec rows:** §4.3 item 5, §4.5 "Share and Export", §4.16 "When Share is not offered", M4.SH8 (absent on the index and in `frame=full`), M4.EX12 (disabled while the opened pin differs from `pinFor`); refinements (f), (h), (m), (o).

**Files:**
- Modify: `pwa/src/docs/useDocsVisit.ts` (`samePin` and `pinCommit` gain `export` and a doc comment; bodies unchanged), `pwa/src/docs/DocsHead.tsx` (three import lines; `ShareState` and `shareStateFor` inserted after `truthSource`), `pwa/test/docs-share.test.ts` (three import lines; one appended describe).
- Guards (not edited): `pwa/test/docs-visit.test.tsx`, `pwa/test/docs-truth.test.tsx`, `pwa/test/docs-refresh.test.tsx`.

**Interfaces:** Consumes `pinFor`, `samePin`, `pinCommit`, `FileSlot` (`useDocsVisit.ts`); `githubTargetFor`, `docsPathKind` (`docsTree.ts`); `contentClass`, `DOCS_CLASS_CAP` (`shared/docs.ts`); `ShareOpened` (Task 2). Produces `export type ShareState` and `export function shareStateFor(page: DocsPageLocation, tree: DocsTreeOk, file: FileSlot, leafImage: DocPin | null): ShareState` in `DocsHead.tsx`.

**Decisions:** (1) Order: absent (the index, `frame=full`, no GitHub target); ready with nothing opened (a project, section or directory page, or a leaf whose `pinFor` is `null`: refinement (r)); a raster leaf: ready at `pinFor`'s pin when the listed size of the side it opens is over `DOCS_CLASS_CAP.raster`, or when the image's reported pin equals `pinFor`'s, else updating; any other leaf: `file.s === 'none'` is ready at `pinFor`'s pin for class `other` (nothing is read until Download: refinement (q)) and updating otherwise; `loading`, or a slot whose pin differs from `pinFor`'s, is updating; any other slot (`ok`, `failed`, `too-large`, `changing`, a client slot) is ready at the slot's pin, with the answer only when `ok`. (2) `updating.to` is `pinCommit(pinFor(...))`, the commit the leaf is moving to. (3) It lives in `DocsHead.tsx` (refinement (o)). (None departs beyond (f); (q) and (r) fill silences.)

- [ ] **Step 0:** `git grep -qF "function samePin(a: DocPin, b: DocPin): boolean {" HEAD -- pwa/src/docs/useDocsVisit.ts && git grep -qF "function pinCommit(pin: DocPin): string {" HEAD -- pwa/src/docs/useDocsVisit.ts && git grep -qF "export function shareTargetFor" HEAD -- pwa/src/docs/share.ts && echo T3-BASE-OK`. Claim `useDocsVisit.ts`. Record the guard suites' counts.
- [ ] **Step 1: Write the failing cases.** In `docs-share.test.ts`: the `shared/docs` import's value names `DOCS_API_PREFIX, DOCS_PAGE_PREFIX,` become `DOCS_API_PREFIX, DOCS_CLASS_CAP, DOCS_PAGE_PREFIX,`; add `import { shareStateFor } from '../src/docs/DocsHead';` after it; the `useDocsVisit` import becomes `import { pinFor, type FileSlot } from '../src/docs/useDocsVisit';`. Append:

```ts

// ---- Task 3: shareStateFor --------------------------------------------------------------------------------------

describe('shareStateFor: where Share is offered, and when it waits (spec 4.5, 4.16; M4.SH8 pure half, M4.EX12)', () => {
  const tree = treeOk({
    entries: [
      entry('specs', 'a.md'), entry('specs', 'm.html'), entry('specs', 'x.png'), entry('specs', 'o.pdf'),
      entry('specs', 'big.png', { committed: { kind: 'file', blob: BLOB_2, size: DOCS_CLASS_CAP.raster + 1 } }),
      entry('specs', 'l.md', { committed: { kind: 'symlink', blob: BLOB_1, size: 10 } }),
      entry('specs', 'd/x.md'),
    ],
  });
  const NO_FILE: FileSlot = { s: 'none' };
  const okAt = (pin: DocPin): FileSlot => ({ s: 'ok', pin, answer: { ...fileResponse(), show: showAt(COMMIT_A) }, receivedAt: 0 });
  const readyAt = (pin: DocPin, show: DocsShowOk | null = null) => ({ s: 'ready', opened: { kind: 'file', pin, show } });

  it.each(['/docs', '/docs/demo/specs/m.html?ref=main&frame=full', '/docs/demo/specs/zzz.md'])('%s: no Share', (url) => {
    expect(shareStateFor(pageAt(url), tree, NO_FILE, null)).toEqual({ s: 'absent' });
  });

  it.each(['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/d/', '/docs/demo/specs/l.md'])(
    '%s: ready, having opened no file', (url) => {
      expect(shareStateFor(pageAt(url), tree, NO_FILE, null)).toEqual({ s: 'ready', opened: { kind: 'none' } });
    });

  it("a leaf whose read answered at pinFor's pin is ready, with that pin and that answer", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, okAt(pin), null)).toEqual(readyAt(pin, showAt(COMMIT_A)));
  });

  it("a leaf whose first read is in flight is updating, to pinFor's commit (refinement (h))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, { s: 'loading', pin }, null))
      .toEqual({ s: 'updating', to: COMMIT_A });
  });

  it('a leaf still showing C1 while the tree is at C2 is updating, to C2 (M4.EX12)', () => {
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), treeOk({ commit: COMMIT_B }), okAt(committedPin(COMMIT_A)), null))
      .toEqual({ s: 'updating', to: COMMIT_B });
  });

  it("a leaf whose read failed at pinFor's pin is ready, with no answer", () => {
    const pin = pinOf(tree, '/docs/demo/specs/a.md');
    expect(shareStateFor(pageAt('/docs/demo/specs/a.md'), tree, { s: 'unreachable', pin }, null)).toEqual(readyAt(pin));
  });

  it("a class Docs does not preview reads nothing, so it is ready at pinFor's pin (refinement (q))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/o.pdf');
    expect(shareStateFor(pageAt('/docs/demo/specs/o.pdf'), tree, NO_FILE, null)).toEqual(readyAt(pin));
  });

  it('a raster leaf waits for its own image, and is ready at the pin the image settled at (refinement (f))', () => {
    const page = pageAt('/docs/demo/specs/x.png');
    const pin = pinOf(tree, '/docs/demo/specs/x.png');
    expect(shareStateFor(page, tree, NO_FILE, null)).toEqual({ s: 'updating', to: COMMIT_A });
    expect(shareStateFor(page, tree, NO_FILE, committedPin(COMMIT_B, 'x.png'))).toEqual({ s: 'updating', to: COMMIT_A });
    expect(shareStateFor(page, tree, NO_FILE, pin)).toEqual(readyAt(pin));
  });

  it("a raster over its class cap is never loaded, so it is ready at pinFor's pin at once (refinement (f))", () => {
    const pin = pinOf(tree, '/docs/demo/specs/big.png');
    expect(shareStateFor(pageAt('/docs/demo/specs/big.png'), tree, NO_FILE, null)).toEqual(readyAt(pin));
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` — Expected: every Task 3 case red (`shareStateFor` does not exist); Tasks 1 and 2 green.
- [ ] **Step 3: Export the two pin helpers.** In `useDocsVisit.ts`, `function samePin(a: DocPin, b: DocPin): boolean {` becomes:

```ts
/** Whether two pins name the same bytes: every field equal; a committed pin never equals a draft pin. Share compares a
 *  leaf's opened pin with `pinFor`'s answer through it (spec 4.16). */
export function samePin(a: DocPin, b: DocPin): boolean {
```

  and `function pinCommit(pin: DocPin): string {` becomes:

```ts
/** The commit a pin reads at: a committed pin's commit, a draft pin's holder HEAD. */
export function pinCommit(pin: DocPin): string {
```

- [ ] **Step 4: Implement `shareStateFor`.** In `DocsHead.tsx`: the `shared/docs` import's value names `docsPageUrl, entryView, githubBlobUrl,` become `DOCS_CLASS_CAP, contentClass, docsPageUrl, entryView, githubBlobUrl,` and its type names gain `type DocsShowOk,`; `import { copyText } from './share';` becomes `import { copyText, type ShareOpened } from './share';`; `import { pinFor, type DocsVisit, type Freshness } from './useDocsVisit';` becomes `import { pinCommit, pinFor, samePin, type DocsVisit, type FileSlot, type Freshness } from './useDocsVisit';`. Find ``/** The freshness chip's `data-state` (spec 4.5's table). */`` and insert before it:

```ts
/** Whether Share is offered on `page`, and on what (spec 4.5, 4.16; M4.SH8, M4.EX12). The header draws no actions until
 *  the tree slot is `ok`, so Share is hidden before then. Past that:
 *  - `absent`: no Share here: the index, a full-screen mockup (`frame=full`), or a path this listing does not hold
 *    (no GitHub counterpart, as for View on GitHub; refinement (m));
 *  - `updating`: a leaf that does not show `pinFor`'s pin yet: its first read is in flight, a re-list moved the pin and
 *    the new read is in flight, or its raster image has not settled (refinements (f), (h)). `to` is the commit it is
 *    moving to (a draft pin's holder HEAD);
 *  - `ready`: what the page opened, for `shareTargetFor`.
 *  Here and not in `share.ts` (refinement (o)): the header renders under tests that mock `share.ts` to `copyText`. */
export type ShareState =
  | { readonly s: 'absent' }
  | { readonly s: 'updating'; readonly to: string }
  | { readonly s: 'ready'; readonly opened: ShareOpened };

export function shareStateFor(
  page: DocsPageLocation, tree: DocsTreeOk, file: FileSlot, leafImage: DocPin | null,
): ShareState {
  if (page.kind === 'index' || (page.kind === 'path' && page.frame === 'full')) return { s: 'absent' };
  if (githubTargetFor(page, tree) === null) return { s: 'absent' };
  const none: ShareState = { s: 'ready', opened: { kind: 'none' } };
  if (page.kind !== 'path') return none;
  const k = docsPathKind(tree, page.section, page.path, modeOf(page));
  const expected = pinFor(tree, page);
  // A directory, or a leaf that opens nothing (a symlink, a submodule, a withheld new file): refinement (r).
  if (k.kind !== 'leaf' || expected === null) return none;
  const updating: ShareState = { s: 'updating', to: pinCommit(expected) };
  const readyAt = (pin: DocPin, show: DocsShowOk | null): ShareState => ({ s: 'ready', opened: { kind: 'file', pin, show } });
  if (contentClass(page.path) === 'raster') {
    // `DocImage` refuses a raster over its class cap and never loads it, as nothing is read for a file slot's
    // `too-large`: the leaf is ready at `pinFor`'s pin.
    const size = expected.kind === 'draft' ? k.entry.draft?.size : k.entry.committed?.size;
    if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return readyAt(expected, null);
    return leafImage !== null && samePin(leafImage, expected) ? readyAt(expected, null) : updating;
  }
  // `none` at a leaf that opens a file is a class Docs does not preview (`other`): nothing is read until Download, so
  // the leaf is ready at `pinFor`'s pin (refinement (q)).
  if (file.s === 'none') return contentClass(page.path) === 'other' ? readyAt(expected, null) : updating;
  if (file.s === 'loading' || !samePin(file.pin, expected)) return updating;
  return readyAt(file.pin, file.s === 'ok' ? file.answer.show : null);
}

```

- [ ] **Step 5: Run to verify they pass**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts )` all green; `( cd pwa && ./node_modules/.bin/vitest run test/docs-visit.test.tsx test/docs-truth.test.tsx test/docs-refresh.test.tsx )` Step 0's counts; `TSC-OK`.
- [ ] **Step 6: Commit.** `git add pwa/src/docs/useDocsVisit.ts pwa/src/docs/DocsHead.tsx pwa/test/docs-share.test.ts` (expect 3), message `docs: shareStateFor, when Share is offered and when it waits for the leaf (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T3-M1 | pwa | `src/docs/DocsHead.tsx` | `if (file.s === 'loading' \|\| !samePin(file.pin, expected)) return updating;` → `if (file.s === 'loading') return updating;` | `test/docs-share.test.ts` | 1 failed — `'a leaf still showing C1 while the tree is at C2 is updating, to C2 (M4.EX12)'` |
| W5S-T3-M2 | pwa | `src/docs/DocsHead.tsx` | same line → `if (!samePin(file.pin, expected)) return updating;` | `test/docs-share.test.ts` | 1 failed — `"a leaf whose first read is in flight is updating, to pinFor's commit (refinement (h))"` |
| W5S-T3-M3 | pwa | `src/docs/DocsHead.tsx` | `(page.kind === 'path' && page.frame === 'full')` → `false` | `test/docs-share.test.ts` | 1 failed — `'/docs/demo/specs/m.html?ref=main&frame=full: no Share'` |
| W5S-T3-M4 | pwa | `src/docs/DocsHead.tsx` | `return leafImage !== null && samePin(leafImage, expected) ? readyAt(expected, null) : updating;` → `return readyAt(expected, null);` | `test/docs-share.test.ts` | 1 failed — `'a raster leaf waits for its own image, and is ready at the pin the image settled at (refinement (f))'` |
| W5S-T3-M5 | pwa | `src/docs/DocsHead.tsx` | `if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return readyAt(expected, null);` → removed | `test/docs-share.test.ts` | 1 failed — `"a raster over its class cap is never loaded, so it is ready at pinFor's pin at once (refinement (f))"` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share.test.ts test/docs-visit.test.tsx test/docs-truth.test.tsx test/docs-refresh.test.tsx )`; `TSC-OK`.

### Task 4: A raster leaf's own image reports the pin it settled at (M4.EX12's raster clause; refinement (f))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in reporting only the leaf's own image, once per settled pin, and taking the report back.

**Spec rows:** §4.3 item 5 ("its opened pin is the pin `DocImage` loaded"), §4.16 "Which commit" (a raster leaf), M4.EX12 (raster clause), M4.SH1 (raster clause; its screen half is Task 6); refinement (f).

**Files:**
- Modify: `pwa/src/docs/DocImage.tsx` (`DocsLeafImageContext` after `DocsAssetContext`; the report after the drafted-asset effect), `pwa/src/docs/DocsLeaf.tsx` (the `./DocImage` import; `RasterBody`'s doc tail, signature and provider; the `DocsLeaf` prop; the raster call site), `pwa/test/docs-screen.test.tsx` (two import lines; one appended describe).
- Guards (not edited): `pwa/test/docs-images.test.tsx`, `pwa/test/docs-markdown.test.tsx`, `pwa/test/reader-images.test.ts`, `pwa/test/reader-frame.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/control-census.test.ts`.

**Interfaces:** Produces `export const DocsLeafImageContext: React.Context<((pin: DocPin | null) => void) | null>` (`DocImage.tsx`) and the optional `DocsLeaf` prop `onLeafImage?: ((pin: DocPin | null) => void) | null`. `DocsScreen` passes it in Task 6.

**Decisions:** (1) Only `RasterBody` provides the context, around the leaf's one image; no image inside a document has a listener, so nothing else can make a page look ready. (2) The report fires when the image's job has settled (`shown.s` is `loaded` or `failed`; refinement (f)), keyed by the job's key (`docsApi.file(project, pin)`, which names the pin exactly), and its cleanup reports `null`, so a new pin loading, or the leaf leaving, takes the report back. (3) The prop is optional and defaults to "nothing listens", so every existing `<DocsLeaf … />` in the tests stays byte-identical. (None departs beyond (f).)

- [ ] **Step 0:** `git grep -qF "export const DocsAssetContext = createContext<DocsAssetContextValue | null>(null);" HEAD -- pwa/src/docs/DocImage.tsx && git grep -qF "<DocLinkContext value={ctx}><DocInLinkContext value={true}><DocImage node={node} alt={p.name} /></DocInLinkContext></DocLinkContext>" HEAD -- pwa/src/docs/DocsLeaf.tsx && echo T4-BASE-OK`. Claim `DocImage.tsx`, `DocsLeaf.tsx`, `docs-screen.test.tsx`; check W5h-a's state on `DocsLeaf.tsx` (it edits `TextBody` only). Record the guard suites' counts.
- [ ] **Step 1: Write the failing cases.** In `docs-screen.test.tsx`, after `import { DocsLeaf } from '../src/docs/DocsLeaf';` add `import { DocsAssetContext } from '../src/docs/DocImage';` and `import { createFetchQueue } from '../src/docs/fetchQueue';`. Append at the end of the file:

```tsx

// ---- W5 Share, Task 4: a raster leaf's own image reports the pin it settled at ------------------------------------

describe("W5 Share: a raster leaf's own image reports the pin it settled at (spec 4.3 item 5, 4.16; refinement (f))", () => {
  const visitOf = (tree: DocsTreeOk, file: DocsVisit['file']): DocsVisit => ({
    tree: { s: 'ok', answer: treeResponse(tree), receivedAt: 0 }, file, freshness: { s: 'idle' }, updatedTo: null,
    pendingFragment: null, retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(),
    setFragment: vi.fn(),
  });

  /** `url`'s leaf alone, under the assets context the screen gives it, with `listen` as its leaf-image listener. */
  function leafAlone(url: string, tree: DocsTreeOk, f: FakeLoaders, listen: (pin: DocPin | null) => void,
    file: DocsVisit['file'] = { s: 'none' }): ReturnType<typeof render> {
    const page = pageAt(url);
    if (page.kind !== 'path') throw new Error('fixture: not a leaf');
    const assets = { loaders: f.loaders, queue: createFetchQueue(), onDraftAsset: () => {} };
    return render(
      <DocsAssetContext value={assets}>
        <DocsLeaf visit={visitOf(tree, file)} tree={tree} page={page} parser={parser} onLeafImage={listen} />
      </DocsAssetContext>,
    );
  }

  const RASTER = treeOk({ entries: [entry('specs', 'x.png')] });
  const RASTER_URL = '/docs/demo/specs/x.png';

  it("reports the leaf's pin once its bytes are shown, and null when it unmounts", async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockResolvedValue(okPng());
    const seen = vi.fn();
    const view = leafAlone(RASTER_URL, RASTER, f, seen);
    const pin = pinFor(RASTER, pageAt(RASTER_URL));
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith(pin));
    expect(seen.mock.calls.every(([p]) => p === null || JSON.stringify(p) === JSON.stringify(pin))).toBe(true);
    view.unmount();
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('reports nothing while the image loads', async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockImplementation(() => new Promise<never>(() => {}));
    const seen = vi.fn();
    leafAlone(RASTER_URL, RASTER, f, seen);
    await waitFor(() => expect(f.raster).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(seen.mock.calls.filter(([p]) => p !== null)).toEqual([]);
  });

  it('a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f))', async () => {
    const f = fakeLoaders({ tree: okTree(RASTER) });
    f.raster.mockResolvedValue({ s: 'unreachable' });
    const seen = vi.fn();
    leafAlone(RASTER_URL, RASTER, f, seen);
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith(pinFor(RASTER, pageAt(RASTER_URL))));
  });

  it('an image inside a Markdown document reports nothing', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });
    const pin = pinFor(tree, pageAt('/docs/demo/specs/a.md'));
    if (pin === null) throw new Error('fixture: no pin');
    const f = fakeLoaders({ tree: okTree(tree) });
    f.raster.mockResolvedValue(okPng());
    const seen = vi.fn();
    const { container } = leafAlone('/docs/demo/specs/a.md', tree, f, seen,
      { s: 'ok', pin, answer: fileResponse('![x](x.png)\n'), receivedAt: 0 });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(seen.mock.calls.filter(([p]) => p !== null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx -t "own image reports" )` — Expected: 2 failed (cases 1 and 3: nothing reports yet), 2 passed (cases 2 and 4 hold today; they are the controls that keep a later report honest).
- [ ] **Step 3: Implement the context and the report.** In `DocImage.tsx`, after `export const DocsAssetContext = createContext<DocsAssetContextValue | null>(null);` add:

```ts

/** Where a raster leaf's own image reports the pin it settled at, loaded or failed (spec 4.16: Share waits for that
 *  image; refinement (f)). `RasterBody` provides it around the leaf's one image, and nothing provides it around an image
 *  inside a document. `null`, the default, has one meaning: nothing listens. The listener gets `null` when the image
 *  unsettles (a new pin starts loading) or unmounts. */
export const DocsLeafImageContext = createContext<((pin: DocPin | null) => void) | null>(null);
```

  and after the drafted-asset effect (its last line `  }, [draftKey, onDraftAsset]);`) add:

```ts
  // Tell a raster leaf's listener (`DocsLeafImageContext`) the pin this image settled at, and take it back when the
  // image unsettles or unmounts. Keyed by the job's key, which names the pin exactly (`docsApi.file`).
  const onLeafImage = useContext(DocsLeafImageContext);
  const settled = job !== null && shown.s !== 'loading' ? job : null;
  const settledPin = useRef<DocPin | null>(null);
  settledPin.current = settled === null ? null : settled.pin;
  const settledKey = settled === null ? null : settled.key;
  useEffect(() => {
    const pin = settledPin.current;
    if (onLeafImage === null || settledKey === null || pin === null) return undefined;
    onLeafImage(pin);
    return () => onLeafImage(null);
  }, [onLeafImage, settledKey]);
```

- [ ] **Step 4: Provide it in `RasterBody` and thread the prop.** In `DocsLeaf.tsx`:
  - `import { DocImage, DocsAssetContext, svgDataUrl, type DocsAssetContextValue } from './DocImage';` becomes `import { DocImage, DocsAssetContext, DocsLeafImageContext, svgDataUrl, type DocsAssetContextValue } from './DocImage';`.
  - Find the end of `RasterBody`'s doc comment and its signature:

```tsx
 *  nothing. */
function RasterBody(p: { readonly link: LinkBase; readonly name: string }): ReactNode {
```

  and replace with:

```tsx
 *  nothing. Its one image reports the pin it settled at to `onLeafImage` (through `DocsLeafImageContext`), which Share
 *  waits for (spec 4.16; refinement (f)); no image inside a document has that listener. */
function RasterBody(p: {
  readonly link: LinkBase; readonly name: string; readonly onLeafImage: ((pin: DocPin | null) => void) | null;
}): ReactNode {
```

  - `<DocLinkContext value={ctx}><DocInLinkContext value={true}><DocImage node={node} alt={p.name} /></DocInLinkContext></DocLinkContext>` becomes `<DocLinkContext value={ctx}><DocInLinkContext value={true}><DocsLeafImageContext value={p.onLeafImage}><DocImage node={node} alt={p.name} /></DocsLeafImageContext></DocInLinkContext></DocLinkContext>`.
  - In `DocsLeaf`'s props, after `  readonly reader?: ReaderDeps | null;` add:

```tsx
  /** Where the leaf's own raster image reports the pin it settled at (Share waits for it, spec 4.16); absent or `null`,
   *  nothing listens. */
  readonly onLeafImage?: ((pin: DocPin | null) => void) | null;
```

  - `      body = <><RasterBody link={link} name={name} /><div className="docs-leaf-actions">{download}</div></>;` becomes `      body = <><RasterBody link={link} name={name} onLeafImage={p.onLeafImage ?? null} /><div className="docs-leaf-actions">{download}</div></>;`.
- [ ] **Step 5: Run to verify they pass**, then the guards: Step 2's command, 4 passed; `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx test/docs-images.test.tsx test/docs-markdown.test.tsx )` Step 0's counts plus 4; `( cd pwa && ./node_modules/.bin/vitest run test/reader-images.test.ts test/reader-frame.test.tsx )` unchanged; `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/control-census.test.ts )` unchanged (no new control, and `RasterBody`'s block signature is its own); `TSC-OK`.
- [ ] **Step 6: Commit.** `git add pwa/src/docs/DocImage.tsx pwa/src/docs/DocsLeaf.tsx pwa/test/docs-screen.test.tsx` (expect 3), message `docs: a raster leaf's own image reports the pin it settled at (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T4-M1 | pwa | `src/docs/DocImage.tsx` | in the report effect, `    onLeafImage(pin);\n` → removed | `test/docs-screen.test.tsx` | 5 failed at the end state (2 at Task 4) — `"reports the leaf's pin once its bytes are shown, and null when it unmounts"`; `'a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f))'`; from Task 6, `'a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f))'`, `'a ref-view raster leaf that opens a draft: …'` and `'the same raster leaf at view=committed: …'` |
| W5S-T4-M2 | pwa | `src/docs/DocImage.tsx` | `job !== null && shown.s !== 'loading' ? job : null` → `job !== null && shown.s === 'loaded' ? job : null` | `test/docs-screen.test.tsx` | 1 failed — `'a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f))'` |
| W5S-T4-M3 | pwa | `src/docs/DocsLeaf.tsx` | `<DocsLeafImageContext value={p.onLeafImage}>` → `<DocsLeafImageContext value={null}>` | `test/docs-screen.test.tsx` | 5 failed at the end state (2 at Task 4) — the same five as W5S-T4-M1 |
| W5S-T4-M4 | pwa | `src/docs/DocImage.tsx` | `return () => onLeafImage(null);` → `return undefined;` | `test/docs-screen.test.tsx` | 1 failed — `"reports the leaf's pin once its bytes are shown, and null when it unmounts"` |

**Verify:** the four cases green; the guards unchanged; `TSC-OK`.

### Task 5: The share sheet (M4.SH4, M4.SH5, M4.SH6 rendered; refinements (c), (d))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the Share… handler: the call on `navigator`, first, in a handler that is not async, and the one error path.

**Spec rows:** §4.16 "The sheet", decision 1 (Share always opens the sheet), decision 8 (the access note), M4.SH4, M4.SH5, M4.SH6 (as rendered); refinements (c), (d).

**Files:**
- Create: `pwa/src/docs/ShareSheet.tsx`, `pwa/test/docs-share-sheet.test.tsx`.
- Guards (not edited): `pwa/test/markup-census.test.ts`, `pwa/test/control-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/hook-class-collision.test.ts`, `pwa/test/focus-ring.test.ts`, `pwa/test/docs-scans.test.ts`.

**Interfaces:** Consumes `ShareTarget`, `ShareNoteLine`, `copyText` (`share.ts`); `SHARE_SHEET_TEXT`, `shareNoteSentence`, `shareRefusalSentence` (`docsText.ts`); `Sheet`, `Button`, `QC_ACTIONS` (`@ccrc/ui`). Produces `export function ShareSheet(p: { readonly target: ShareTarget; readonly exportOffered: boolean; readonly onClose: () => void }): ReactNode`.

**Decisions:** (1) Web Share is usable iff `navigator.share` is a function and `navigator.canShare`, where present, answers exactly `true`; a probe that throws says no. (2) Share…'s handler is not async, and `navigator.share(data)` is its first statement, called on `navigator`; a synchronous throw and a rejection reach one handler, which ignores only a refusal whose `name` is `AbortError` (read by name, not `instanceof`, so a refusal from another realm is still recognised). (3) Copy link calls `copyText(url)` only; on refusal the sheet shows a read-only `<input>` holding the URL, focused and selected. (4) A refusal shows its sentence and its notes and no buttons. (5) The sheet adds no hand-drawn control: both buttons are `@ccrc/ui`'s `Button` (the census reads them as the primitive), and the field is a text `<input>`, which `control-census` does not count. (None departs.)

- [ ] **Step 0:** `test ! -e pwa/src/docs/ShareSheet.tsx && git grep -qF "export function shareNoteSentence" HEAD -- pwa/src/docs/docsText.ts && git grep -qF "QC_ACTIONS" HEAD -- pwa/src/docs/ReaderSheets.tsx && echo T5-BASE-OK`. Record the guard suites' counts.
- [ ] **Step 1: Write `pwa/test/docs-share-sheet.test.tsx`:**

```tsx
// Docs W5 Share, Task 5: the share sheet (spec 2026-10-01 4.16; M4.SH4, M4.SH5, and M4.SH6 as the sheet shows it).
// The sheet renders the `ShareTarget` it is given. `copyText` is a spy here (the module's other exports are the real
// ones); `navigator.share` and `navigator.canShare` are defined per case and removed after each, since jsdom has
// neither. Task 7 appends the Share chrome's colour guard. Placeholders only: `example-org/example-repo`, `demo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ShareSheet } from '../src/docs/ShareSheet';
import { SHARE_EXPORT_CLAUSE, SHARE_SENTENCE, SHARE_SHEET_TEXT } from '../src/docs/docsText';
import { copyText, type ShareRefusal, type ShareTarget } from '../src/docs/share';
import { COMMIT_A } from './docsFixtures';

vi.mock('../src/docs/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/docs/share')>()),
  copyText: vi.fn(async () => {}),
}));

const SHORT = COMMIT_A.slice(0, 8);
const URL_A = `https://github.com/example-org/example-repo/blob/${COMMIT_A}/docs/superpowers/specs/a.md`;
const ACCESS = "Opens on GitHub (example-org/example-repo). People without access see GitHub's 404.";
const ACCESS_NOTE = [{ note: 'access', fields: { slug: 'example-org/example-repo' } }] as const;
const LINK: Extract<ShareTarget, { ok: true }> = {
  ok: true, url: URL_A, commit: COMMIT_A, title: 'a.md', text: `demo · docs/superpowers/specs/a.md at ${SHORT}`,
  notes: ACCESS_NOTE,
};

/** Gives this page Web Share for one case: `navigator.share`, and `navigator.canShare` when one is passed. */
function webShare(share: (this: unknown, data: unknown) => Promise<void>, canShare?: (data: unknown) => boolean): void {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
  if (canShare !== undefined) Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShare });
}

function sheet(target: ShareTarget = LINK, exportOffered = false): void {
  render(<ShareSheet target={target} exportOffered={exportOffered} onClose={() => {}} />);
}

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(undefined);
});

describe('the share sheet: the link, its notes, and Copy link where there is no Web Share (M4.SH5)', () => {
  it('shows the link and the access note, and offers Copy link only', async () => {
    sheet();
    expect(await screen.findByText(URL_A)).toBeInTheDocument();
    expect(screen.getByText(ACCESS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
    expect(screen.getByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
  });

  it.each([
    ['says no', (): boolean => false],
    ['throws', (): boolean => { throw new TypeError('no'); }],
  ])('offers no Share… where navigator.canShare %s', async (_name, canShare) => {
    webShare(() => Promise.resolve(), canShare);
    sheet();
    expect(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
  });

  it('Copy link writes the link through copyText and says so', async () => {
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy }));
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(URL_A);
    expect(await screen.findByText(SHARE_SHEET_TEXT.copied)).toBeInTheDocument();
  });

  it('a refused copy leaves a read-only field holding the link, focused and selected', async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'));
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.copy }));
    const field = await screen.findByRole('textbox', { name: SHARE_SHEET_TEXT.field });
    if (!(field instanceof HTMLInputElement)) throw new Error('the field is not an input');
    expect(field).toHaveValue(URL_A);
    expect(field).toHaveAttribute('readonly');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, URL_A.length]);
    expect(screen.getByText(SHARE_SHEET_TEXT.copyRefused)).toBeInTheDocument();
  });
});

describe('Share…: navigator.share, called in the click itself (M4.SH4, M4.SH5)', () => {
  it('calls navigator.share on navigator, with url, title and text, before any microtask runs', async () => {
    const calls: { receiver: unknown; data: unknown; afterMicrotask: boolean }[] = [];
    let microtaskRan = false;
    webShare(function share(this: unknown, data: unknown) {
      calls.push({ receiver: this, data, afterMicrotask: microtaskRan });
      return Promise.resolve();
    });
    sheet();
    const button = await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share });
    queueMicrotask(() => { microtaskRan = true; });
    fireEvent.click(button);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.receiver).toBe(navigator);
    expect(calls[0]?.data).toEqual({ url: URL_A, title: 'a.md', text: LINK.text });
    expect(calls[0]?.afterMicrotask).toBe(false);
  });

  it('AbortError (the reader closed the native sheet) does nothing', async () => {
    webShare(() => Promise.reject(new DOMException('closed', 'AbortError')));
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share }));
    await settle();
    expect(screen.queryByText(SHARE_SHEET_TEXT.shareFailed)).toBeNull();
  });

  it.each([
    ['a rejection', (): Promise<void> => Promise.reject(new DOMException('denied', 'NotAllowedError'))],
    ['a throw', (): Promise<void> => { throw new TypeError('no'); }],
  ])('any other refusal (%s) shows the notice, and Copy link stays', async (_name, share) => {
    webShare(share);
    sheet();
    fireEvent.click(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share }));
    expect(await screen.findByText(SHARE_SHEET_TEXT.shareFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeInTheDocument();
  });
});

describe('a refusal on the sheet (M4.SH6; refinement (c))', () => {
  it('shows its sentence and the access note, and offers neither Share… nor Copy link', async () => {
    webShare(() => Promise.resolve());
    sheet({ ok: false, why: 'not-on-origin', fields: { short: SHORT }, notes: ACCESS_NOTE });
    expect(await screen.findByText(`Commit ${SHORT} is not on origin; push it to share.`)).toBeInTheDocument();
    expect(screen.getByText(ACCESS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.share })).toBeNull();
    expect(screen.queryByRole('button', { name: SHARE_SHEET_TEXT.copy })).toBeNull();
  });

  it.each(Object.keys(SHARE_SENTENCE) as ShareRefusal[])('%s says nothing of Export while the page offers none', async (why) => {
    sheet({ ok: false, why, fields: { short: SHORT, withheld: 'x' }, notes: [] });
    await screen.findByRole('dialog');
    expect(document.body.textContent).not.toContain('Export');
  });

  it('the seam reaches the sheet: a page that offers Export shows the clause on a refusal that takes it', async () => {
    sheet({ ok: false, why: 'new-draft', fields: {}, notes: [] }, true);
    expect(await screen.findByText(`Not committed yet, so GitHub has nothing to show. ${SHARE_EXPORT_CLAUSE}`)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share-sheet.test.tsx )` — Expected: the file fails to load (`ShareSheet.tsx` does not exist).
- [ ] **Step 3: Write `pwa/src/docs/ShareSheet.tsx`:**

```tsx
// The share sheet (spec 2026-10-01 4.16; native Docs reader W5, Share). Ring L4 delivery over @ccrc/ui's `Sheet`: it
// shows the `ShareTarget` it is given (`shareTargetFor`'s answer, worked out when the sheet opens) and runs the two
// ways a link leaves the page; it decides nothing about the link. Decision 1: Share always opens this sheet.
// - Share… shows only where Web Share can send the link (`navigator.share`, and `navigator.canShare` where the browser
//   has it). Its click calls `navigator.share` as the FIRST statement of a handler that is not async, on `navigator`,
//   so the reader's activation is still live when the browser checks it (M4.SH4). `AbortError` (the reader closed the
//   native sheet) does nothing; any other refusal, thrown or rejected, shows a notice and leaves Copy link.
// - Copy link goes through `copyText`, the one clipboard writer under `pwa/src/docs` (M4.SH7). When the clipboard
//   refuses, a read-only field holds the link, focused and selected, to copy by hand.
// - A refusal shows its sentence and its notes (the access note wherever the slug is usable) and offers neither button.
//   `exportOffered` is the seam Export takes (spec 4.16, 4.17): it adds Export's clause to the refusals that take it.
// Every word is docsText.ts's.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { SHARE_SHEET_TEXT, shareNoteSentence, shareRefusalSentence } from './docsText';
import { copyText, type ShareNoteLine, type ShareTarget } from './share';

type ShareLink = Extract<ShareTarget, { ok: true }>;
interface SharePayload { readonly url: string; readonly title: string; readonly text: string }

/** A refusal's `name`, read without assuming its realm (a `DOMException` from another realm is not `instanceof` this
 *  one's); '' when it has none. */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return '';
  const name: unknown = (e as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** Whether Web Share can send `data` here: `navigator.share` is a function, and `navigator.canShare`, where the browser
 *  has it, says yes. A probe that throws says no. */
function webShareUsable(data: SharePayload): boolean {
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare(data) === true;
  } catch {
    return false;
  }
}

function Notes(p: { readonly notes: readonly ShareNoteLine[] }): ReactNode {
  return p.notes.map((n) => <p key={n.note} className="docs-share-note">{shareNoteSentence(n)}</p>);
}

function LinkSheet(p: { readonly link: ShareLink; readonly onClose: () => void }): ReactNode {
  const { link } = p;
  const data = useMemo<SharePayload>(() => ({ url: link.url, title: link.title, text: link.text }), [link]);
  const canShare = useMemo(() => webShareUsable(data), [data]);
  const [shareFailed, setShareFailed] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle');
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (copy !== 'refused' || field.current === null) return;
    field.current.focus();
    field.current.select();
  }, [copy]);
  const refused = (e: unknown): void => {
    if (errorName(e) !== 'AbortError') setShareFailed(true);
  };
  // NOT async, and `navigator.share` its first statement: nothing that spends a microtask may come before it, or the
  // click's activation is gone and the browser refuses the call (M4.SH4). Called on `navigator`, never detached.
  const onShare = (): void => {
    let sent: Promise<void>;
    try {
      sent = navigator.share(data);
    } catch (e) {
      refused(e);
      return;
    }
    setShareFailed(false);
    sent.then(undefined, refused);
  };
  const onCopy = (): void => {
    copyText(link.url).then(() => setCopy('copied'), () => setCopy('refused'));
  };
  return (
    <Sheet
      open
      onClose={p.onClose}
      title={SHARE_SHEET_TEXT.title}
      footer={
        <div className={QC_ACTIONS}>
          {canShare && <Button variant="primary" onClick={onShare}>{SHARE_SHEET_TEXT.share}</Button>}
          <Button variant="ghost" onClick={onCopy}>{SHARE_SHEET_TEXT.copy}</Button>
        </div>
      }
    >
      <div className="docs-share-sheet">
        <p className="docs-share-url">{link.url}</p>
        <Notes notes={link.notes} />
        {shareFailed && <p className="docs-share-note" role="alert">{SHARE_SHEET_TEXT.shareFailed}</p>}
        {copy === 'copied' && <p className="docs-share-note" role="status">{SHARE_SHEET_TEXT.copied}</p>}
        {copy === 'refused' && <p className="docs-share-note" role="alert">{SHARE_SHEET_TEXT.copyRefused}</p>}
        {copy === 'refused' && (
          <input ref={field} className="docs-share-field" readOnly value={link.url} aria-label={SHARE_SHEET_TEXT.field} />
        )}
      </div>
    </Sheet>
  );
}

/** The share sheet (spec 4.16): the link with Share… and Copy link, or a refusal's sentence. `exportOffered`: whether
 *  this page offers Export (spec 4.17), whose clause the refusals that take it then carry; false on every page until
 *  Export ships (refinement (c)). */
export function ShareSheet(p: {
  readonly target: ShareTarget; readonly exportOffered: boolean; readonly onClose: () => void;
}): ReactNode {
  const { target } = p;
  if (target.ok) return <LinkSheet link={target} onClose={p.onClose} />;
  return (
    <Sheet open onClose={p.onClose} title={SHARE_SHEET_TEXT.title}>
      <div className="docs-share-sheet">
        <p className="docs-share-note" role="status">{shareRefusalSentence(target.why, target.fields, p.exportOffered)}</p>
        <Notes notes={target.notes} />
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run to verify it passes**, then the guards: `( cd pwa && ./node_modules/.bin/vitest run test/docs-share-sheet.test.tsx )` all green; `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/control-census.test.ts test/literal-census.test.ts test/hook-class-collision.test.ts test/focus-ring.test.ts test/docs-scans.test.ts )` through `ccrc test`, Step 0's counts, green (the footer's `div.{QC_ACTIONS}(Button,Button)` block is already registered in `markup-census`'s `REGISTERED_BLOCKS`; `docs-scans`' clause 1 now reads `ShareSheet.tsx` and finds no draft state); `TSC-OK`.
- [ ] **Step 5: Commit.** `git add pwa/src/docs/ShareSheet.tsx pwa/test/docs-share-sheet.test.tsx` (expect 2), message `docs: the share sheet, Web Share in the click and Copy link through copyText (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T5-M1 | pwa | `src/docs/ShareSheet.tsx` | `const onShare = (): void => {\n    let sent: Promise<void>;` → `const onShare = async (): Promise<void> => {\n    await Promise.resolve();\n    let sent: Promise<void>;` | `test/docs-share-sheet.test.tsx` | 1 failed — `'calls navigator.share on navigator, with url, title and text, before any microtask runs'` |
| W5S-T5-M2 | pwa | `src/docs/ShareSheet.tsx` | `if (errorName(e) !== 'AbortError') setShareFailed(true);` → `setShareFailed(true);` | `test/docs-share-sheet.test.tsx` | 1 failed — `'AbortError (the reader closed the native sheet) does nothing'` |
| W5S-T5-M3 | pwa | `src/docs/ShareSheet.tsx` | `sent.then(undefined, refused);` → `sent.then(undefined, () => {});` | `test/docs-share-sheet.test.tsx` | 1 failed — `'any other refusal (a rejection) shows the notice, and Copy link stays'` |
| W5S-T5-M4 | pwa | `src/docs/ShareSheet.tsx` | the `{copy === 'refused' && (` … `<input ref={field} … />` … `)}` block → removed | `test/docs-share-sheet.test.tsx` | 1 failed — `'a refused copy leaves a read-only field holding the link, focused and selected'` |
| W5S-T5-M5 | pwa | `src/docs/ShareSheet.tsx` | `{canShare && <Button variant="primary" onClick={onShare}>` → `{<Button variant="primary" onClick={onShare}>` | `test/docs-share-sheet.test.tsx` | 3 failed — `'shows the link and the access note, and offers Copy link only'`; both `'offers no Share… where navigator.canShare %s'` cases |
| W5S-T5-M6 | pwa | `src/docs/ShareSheet.tsx` | `sent = navigator.share(data);` → `sent = navigator.share.call(undefined, data);` | `test/docs-share-sheet.test.tsx` | 1 failed — `'calls navigator.share on navigator, …'` (the receiver) |
| W5S-T5-M7 | pwa | `src/docs/ShareSheet.tsx` | in `ShareSheet`'s refusal arm, `        <Notes notes={target.notes} />\n` → removed | `test/docs-share-sheet.test.tsx` | 1 failed — `'shows its sentence and the access note, and offers neither Share… nor Copy link'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share-sheet.test.tsx )`; the census guards unchanged; `TSC-OK`.

### Task 6: Share in the Docs header, wired through the screen (M4.SH8 Share half, M4.EX12 Share half, M4.SH1's raster clause; refinements (a), (c), (f), (l), (n))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the action's lifetime: a sheet never outlives what it was opened about.

**Spec rows:** §4.5 "Share and Export", §4.16 ("When Share is not offered", Figure 1), M4.SH8 (Share half), M4.EX12 (Share half), M4.SH1 (raster clause); refinements (a), (c), (f), (l), (n).

**Files:**
- Modify: `pwa/src/docs/DocsHead.tsx` (its header comment; the `./share` import; one new import; `shareKeyOf` and `ShareAction` before `Actions`; `Actions` replaced; the `DocsHead` prop and its `Actions` call), `pwa/src/screens/DocsScreen.tsx` (its `shared/docs` import; one state; two props), `pwa/test/control-census.test.ts` (one entry), `pwa/test/docs-screen.test.tsx` (three import lines; one appended describe).
- Guards (not edited): `pwa/test/docs-truth.test.tsx`, `pwa/test/docs-refresh.test.tsx`, `pwa/test/docs-banners.test.tsx`, `pwa/test/docs-visit.test.tsx`, `pwa/test/reader-frame.test.tsx`, `pwa/test/markup-census.test.ts`, `pwa/test/literal-census.test.ts`, `pwa/test/app-docs-boundary.test.tsx`.

**Interfaces:** Consumes `shareStateFor` (Task 3), `shareTargetFor` (Task 2), `ShareSheet` (Task 5), `onLeafImage` (Task 4). Produces the `DocsHead` prop `leafImage?: DocPin | null` (optional, so every existing `<DocsHead … />` in the tests stays byte-identical).

**Decisions:** (1) Share sits after View on GitHub and before Open committed version, as `<button className="docs-action docs-share">`, disabled with "Updating to <short>…" while `shareStateFor` says `updating`. (2) `ShareAction` is keyed by `shareKeyOf` (the page URL, the tree's commit, and what the leaf opened), and computes `shareTargetFor` only while its sheet is open, so nothing of `share.ts` but `copyText` is read while no sheet is open (refinement (o)). (3) `exportOffered={false}` at the one call site, with the comment that Export passes its availability there (refinement (c)). (4) `DocsScreen` holds the leaf image's pin (`useState`, whose setter is stable) and passes it to `DocsHead`, and its setter to `DocsLeaf`. (None departs beyond (a), (c), (f).)

- [ ] **Step 0:** `git grep -qF "export function shareStateFor" HEAD -- pwa/src/docs/DocsHead.tsx && test -f pwa/src/docs/ShareSheet.tsx && git grep -qF "readonly onLeafImage?:" HEAD -- pwa/src/docs/DocsLeaf.tsx && git grep -qF "{page !== null && <DocsHead page={page} visit={visit} tree={tree} />}" HEAD -- pwa/src/screens/DocsScreen.tsx && echo T6-BASE-OK`. Claim `DocsScreen.tsx`, `control-census.test.ts`; check W5h-a's state on `DocsScreen.tsx`. Record the guard suites' counts.
- [ ] **Step 1: Write the failing cases.** In `docs-screen.test.tsx`: `import { DOCS_FAILURE_SENTENCE, DOCS_PAGE_INVALID_SENTENCE } from '../src/docs/docsText';` becomes `import { DOCS_FAILURE_SENTENCE, DOCS_HEAD_TEXT, DOCS_PAGE_INVALID_SENTENCE, fillSentence, shortCommit } from '../src/docs/docsText';`; in the `./docsFixtures` import, `  BLOB_1, COMMIT_A,` becomes `  BLOB_1, BLOB_2, COMMIT_A,`; after Task 4's `import { createFetchQueue } from '../src/docs/fetchQueue';` add `import type { ReaderDeps } from '../src/docs/ReaderFrame';`. Append at the end of the file:

```tsx

// ---- W5 Share, Task 6: Share on the Docs screen -----------------------------------------------------------------

describe('W5 Share on the Docs screen (spec 4.5, 4.16; M4.SH8 Share half, M4.EX12 Share half, M4.SH1 raster clause)', () => {
  const GH = 'https://github.com/example-org/example-repo';
  const shareButton = (): HTMLElement | null => screen.queryByRole('button', { name: DOCS_HEAD_TEXT.share });
  const updatingTo = (commit: string): string => fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(commit) });
  const sheetUrl = (): string | null | undefined => document.querySelector('.docs-share-url')?.textContent;
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  /** A committed answer for `a.md` at `commit`, of blob `blob`, its h1 `heading`. */
  function answerAt(commit: string, blob: string, heading: string, over: Partial<DocsFileResponse['show']> = {}): DocsFileAnswer {
    const r = fileResponse(`# ${heading}\n`);
    return { s: 'ok', value: { ...r, show: { ...r.show, commit, blob, onRef: 'contains', ...over } } };
  }

  it('no Share on the index (M4.SH8)', async () => {
    openIndex();
    await waitFor(() => expect(mainRowNames().length).toBeGreaterThan(0));
    expect(document.querySelector('.docs-share')).toBeNull();
  });

  it('no Share in frame=full; the same page inline has it (M4.SH8)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    const files = { 'm.html': fileAs('m.html', '<p>a</p>', 'html') };
    open('/docs/demo/specs/m.html?ref=main&frame=full', byPath(tree, files));
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    expect(document.querySelector('.docs-share')).toBeNull();
    cleanup();
    open('/docs/demo/specs/m.html?ref=main', byPath(tree, files));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled();
  });

  it('hidden while the tree slot is loading (M4.SH8)', async () => {
    const f = fakeLoaders();
    f.tree.mockImplementation(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', f);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(f.tree).toHaveBeenCalled();
    expect(document.querySelector('.docs-share')).toBeNull();
  });

  it("a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)", async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });
    open('/docs/demo/specs/a.md?ref=main', fakeLoaders({ tree: okTree(tree) }));
    expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share })).toBeEnabled();
    const actions = [...document.querySelectorAll('.docs-actions .docs-action')].map((e) => e.textContent);
    expect(actions).toEqual([DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.openCommitted]);
  });

  it('the project page carries View on GitHub and Share, through root (M4.SH8)', async () => {
    open('/docs/demo', fakeLoaders());
    expect(await screen.findByRole('link', { name: DOCS_HEAD_TEXT.github })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/tree/${COMMIT_A}`));
  });

  it('a tree moved to C2 while the file is at C1 disables Share, reading Updating to; the C2 answer enables it, and the link names C2 (M4.EX12)', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    const later = deferred<DocsFileAnswer>();
    f.file.mockImplementation(async (_project: string, pin: DocPin) =>
      (pin.kind === 'committed' && pin.commit === COMMIT_B ? later.promise : answerAt(COMMIT_A, BLOB_1, 'A')));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({
      commit: COMMIT_B, entries: [entry('specs', 'a.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })],
    }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    expect(shareButton()).toBeEnabled();
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_B) })).toBeDisabled();
    await act(async () => { later.resolve(answerAt(COMMIT_B, BLOB_2, 'B')); });
    await screen.findByRole('heading', { name: 'B' });
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_B}/docs/superpowers/specs/a.md`));
  });

  it("a same-blob re-list: Share links C2 with no second read, and the sheet says nothing of C1's onRef (refinement (a))", async () => {
    const f = fakeLoaders({ tree: okTree(treeOk()) });
    f.file.mockResolvedValue(answerAt(COMMIT_A, BLOB_1, 'A', { onRef: 'not-contained' }));
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs/a.md', f);
    await screen.findByRole('heading', { name: 'A' });
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_B}/docs/superpowers/specs/a.md`));
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain('GitHub may stop serving it');
    expect(f.file).toHaveBeenCalledTimes(1);
  });

  it('a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f))', async () => {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.png')] })) });
    const image = deferred<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png', f);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_A) })).toBeDisabled();
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
  });

  it('a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    const image = deferred<DocsRasterAnswer>();
    f.raster.mockImplementation(() => image.promise);
    open('/docs/demo/specs/x.png?ref=main', f);
    expect(await screen.findByRole('button', { name: updatingTo(COMMIT_A) })).toBeDisabled();
    await waitFor(() => expect(f.raster).toHaveBeenCalled());
    expect(f.raster.mock.calls[0]?.[1]?.kind).toBe('draft');
    await act(async () => { image.resolve(okPng()); });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
    expect(document.querySelector('.docs-share-sheet')?.textContent).toContain('Drafts are not included');
  });

  it('the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note', async () => {
    const tree = treeOk({ entries: [entry('specs', 'x.png', { draft: draftOf('modified') })], drafts: holder() });
    const f = fakeLoaders({ tree: okTree(tree) });
    f.raster.mockResolvedValue(okPng());
    open('/docs/demo/specs/x.png?ref=main&view=committed', f);
    await waitFor(() => expect(shareButton()).toBeEnabled());
    expect(f.raster.mock.calls[0]?.[1]?.kind).toBe('committed');
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/x.png`));
    expect(document.querySelector('.docs-share-sheet')?.textContent)
      .toContain('Uncommitted changes in main checkout are not included.');
  });

  // The two lifetime cases leave the sheet open across a change after which Share is ready AT ONCE, so an unkeyed
  // ShareAction (same position, `open` still true) would show the sheet again straight away: only the key closes it.
  it('a sheet left open closes when the page changes, even to a page whose Share is ready at once (refinement (n))', async () => {
    open('/docs/demo/specs/a.md', fakeLoaders());
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => { navigate('/docs/demo/specs'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sheetUrl()).toBeUndefined();
  });

  it('a sheet left open closes when a re-list moves the served commit (refinement (n))', async () => {
    const f = fakeLoaders();
    f.refresh.mockResolvedValue(okRefresh(RAN, treeResponse(treeOk({ commit: COMMIT_B }))));
    const { container } = open('/docs/demo/specs', f);
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/tree/${COMMIT_A}/docs/superpowers/specs`));
    // fireEvent.click dispatches no pointerdown, so the sheet's press-outside dismissal never runs here.
    fireEvent.click(container.querySelector('button.docs-fresh') as HTMLElement);
    await waitFor(() => expect(container.querySelector('code.docs-truth-commit')?.getAttribute('title')).toBe(COMMIT_B));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sheetUrl()).toBeUndefined();
  });

  it('Share reads the visit, not the body: the reader frame gives the link the plain view gives (W8a)', async () => {
    const reader = { render: vi.fn(() => new Promise<never>(() => {})), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const f = fakeLoaders();
    navigate('/docs/demo/specs/a.md');
    render(<DocsScreen path={location.pathname} search={location.search} loaders={f.loaders} parser={parser} reader={reader} />);
    await waitFor(() => expect(reader.render).toHaveBeenCalled());
    await waitFor(() => expect(shareButton()).toBeEnabled());
    fireEvent.click(shareButton() as HTMLElement);
    await waitFor(() => expect(sheetUrl()).toBe(`${GH}/blob/${COMMIT_A}/docs/superpowers/specs/a.md`));
  });

  it('no refusal on the screen says Export while no page offers it (refinement (c))', async () => {
    open('/docs/demo', fakeLoaders({ tree: okTree({ ...treeOk(), github: { state: 'none' } }) }));
    fireEvent.click(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share }));
    expect(await screen.findByText('No GitHub link for this project.')).toBeInTheDocument();
    expect(document.querySelector('.docs-share-sheet')?.textContent).not.toContain('Export');
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx -t "W5 Share on the Docs screen" )` — Expected: 12 failed (no Share button yet), 2 passed (the index and loading cases, which hold today and are the controls).
- [ ] **Step 3: Implement the header.** In `DocsHead.tsx`:
  - Header comment: `// and the freshness chip), the actions (View on GitHub, Open committed version) and "Updated to <short>". A pure` becomes `// and the freshness chip), the actions (View on GitHub, Share, Open committed version) and "Updated to <short>". A pure`; `// too (M4.T7). Share and Export are W5 part 2's.` becomes `// too (M4.T7). Share (spec 4.16) opens ShareSheet over shareTargetFor's answer and makes no request either; Export is` plus a next line `// its own run's.`
  - The `shared/docs` import's value names gain `docsApi,` (after `contentClass,`); `import { copyText, type ShareOpened } from './share';` becomes `import { copyText, shareTargetFor, type ShareOpened } from './share';` followed by a new line `import { ShareSheet } from './ShareSheet';`.
  - Replace the whole `Actions` function, from ``/** The actions (spec 4.5): View on GitHub, and Open committed version, offered iff `entryView(...).offersCommitted` `` through its closing brace, with:

```tsx
/** What an open share sheet is about (refinement (n)): the page, the commit its tree serves, and what the leaf opened.
 *  `ShareAction` is keyed by it, so a sheet left open closes when any of them changes, rather than name a page the
 *  screen no longer shows. */
function shareKeyOf(page: TreePage, tree: DocsTreeOk, share: Exclude<ShareState, { s: 'absent' }>): string {
  const opened = share.s === 'updating' ? 'updating'
    : share.opened.kind === 'none' ? 'none' : docsApi.file(page.project, share.opened.pin);
  return [docsPageUrl(page), tree.ref.commit, opened].join('\u0000');
}

/** Share (spec 4.5, 4.16), after View on GitHub: disabled, reading "Updating to <short>…", while the leaf does not show
 *  `pinFor`'s pin; otherwise a tap opens the sheet over `shareTargetFor`'s answer for what the page opened, worked out
 *  while the sheet is open. */
function ShareAction(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly share: Exclude<ShareState, { s: 'absent' }>;
}): ReactNode {
  const { page, tree, share } = p;
  const [open, setOpen] = useState(false);
  const target = open && share.s === 'ready' ? shareTargetFor(tree, page, share.opened) : null;
  return (
    <>
      <button type="button" className="docs-action docs-share" disabled={share.s === 'updating'} onClick={() => setOpen(true)}>
        {share.s === 'updating' ? fillSentence(DOCS_HEAD_TEXT.shareUpdating, { short: shortCommit(share.to) }) : DOCS_HEAD_TEXT.share}
      </button>
      {/* Export (spec 4.17) passes whether it offers Export on this page; until it ships, no page does. */}
      {target !== null && <ShareSheet target={target} exportOffered={false} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The actions (spec 4.5): View on GitHub; Share (spec 4.16), wherever `shareStateFor` offers it; and Open committed
 *  version, offered iff `entryView(...).offersCommitted` on a leaf not already at `view=committed`. Open committed
 *  version navigates with a history entry (URL state, so Back returns to the draft); the commit never enters the URL,
 *  it is resolved from this visit's tree. Export joins after Share in its own run. */
function Actions(p: {
  readonly page: TreePage; readonly tree: DocsTreeOk; readonly file: DocsVisit['file']; readonly leafImage: DocPin | null;
}): ReactNode {
  const { page, tree, file } = p;
  const target = githubTargetFor(page, tree);
  const showsDraft = page.kind === 'path' && openedPin(tree, page, file)?.kind === 'draft';
  const share = shareStateFor(page, tree, file, p.leafImage);
  let committedHref: string | null = null;
  if (page.kind === 'path' && page.view !== 'committed') {
    const k = docsPathKind(tree, page.section, page.path, modeOf(page));
    if (k.kind === 'leaf' && k.view.offersCommitted) {
      const to = { kind: 'path', section: page.section, path: page.path, dirSlash: false, view: 'committed' } as const;
      committedHref = docsPageUrl(docsLocation(page, to));
    }
  }
  if (target === null && committedHref === null) return null;
  return (
    <div className="docs-actions">
      {target !== null && <GithubAction tree={tree} target={target} showsDraft={showsDraft} />}
      {share.s !== 'absent' && <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} />}
      {committedHref !== null && <DocsPageLink className="docs-action" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}
    </div>
  );
}
```

  - `export function DocsHead(p: { readonly page: DocsPageLocation; readonly visit: DocsVisit; readonly tree: DocsTreeOk | null }): ReactNode {` becomes:

```tsx
export function DocsHead(p: {
  readonly page: DocsPageLocation; readonly visit: DocsVisit; readonly tree: DocsTreeOk | null;
  /** The pin a raster leaf's own image settled at (`DocsScreen`'s); absent or `null`, none has. */
  readonly leafImage?: DocPin | null;
}): ReactNode {
```

  - `          <Actions page={page} tree={tree} file={visit.file} />` becomes `          <Actions page={page} tree={tree} file={visit.file} leafImage={p.leafImage ?? null} />`.
- [ ] **Step 4: Wire the screen.** In `DocsScreen.tsx`: in the `shared/docs` import, `type DocsPageLocation, type DocsProjectsResponse, type DocsRefSpec, type DocsTreeOk,` becomes `type DocPin, type DocsPageLocation, type DocsProjectsResponse, type DocsRefSpec, type DocsTreeOk,`. After `  const assets = useMemo<DocsAssetContextValue>(() => ({ loaders, queue, onDraftAsset }), [loaders, queue, onDraftAsset]);` add:

```tsx
  // The pin a raster leaf's own image settled at, which Share waits for (spec 4.16; refinement (f)). `null`: none has
  // (not a raster leaf, or its image is still loading). The setter is stable, so the image reports once per pin.
  const [leafImage, setLeafImage] = useState<DocPin | null>(null);
```

  `        ? <DocsLeaf visit={visit} tree={t} page={page} parser={parser} reader={reader} />` becomes `        ? <DocsLeaf visit={visit} tree={t} page={page} parser={parser} reader={reader} onLeafImage={setLeafImage} />`, and `        {page !== null && <DocsHead page={page} visit={visit} tree={tree} />}` becomes `        {page !== null && <DocsHead page={page} visit={visit} tree={tree} leafImage={leafImage} />}`.
- [ ] **Step 5: Run, then register the control.** Step 2's command — Expected: 14 passed. Then `( cd pwa && ./node_modules/.bin/vitest run test/control-census.test.ts )` — Expected: 1 failed, `'registers every one'`, naming `docs/DocsHead.tsx <button> docs-action docs-share`. In `control-census.test.ts`, after `  'docs/DocsHead.tsx <button> docs-copy': 'TOKEN. Copy commit, on the truth line.',` add:

```ts
  'docs/DocsHead.tsx <button> docs-action docs-share':
    "TOKEN. Share (spec 4.16), after View on GitHub: a <button> wearing the header's link-action class, `.docs-action`, "
    + 'whose rule carries the floor.',
```

  Re-run: all green.
- [ ] **Step 6: Guards.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-screen.test.tsx test/docs-truth.test.tsx test/docs-refresh.test.tsx test/docs-banners.test.tsx test/docs-visit.test.tsx test/app-docs-boundary.test.tsx )` — Step 0's counts plus 14, green; `( cd pwa && ./node_modules/.bin/vitest run test/reader-frame.test.tsx )` — unchanged (its mock of `share.ts` holds `copyText` only, and no sheet opens there); `( cd pwa && ./node_modules/.bin/vitest run test/markup-census.test.ts test/literal-census.test.ts )` through `ccrc test`, unchanged; `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` green.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/DocsHead.tsx pwa/src/screens/DocsScreen.tsx pwa/test/control-census.test.ts pwa/test/docs-screen.test.tsx` (expect 4), message `docs: Share in the Docs header, beside View on GitHub (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T6-M1 | pwa | `src/docs/DocsHead.tsx` | `<ShareAction key={shareKeyOf(page, tree, share)} page={page}` → `<ShareAction page={page}` | `test/docs-screen.test.tsx` | 2 failed — `'a sheet left open closes when the page changes, even to a page whose Share is ready at once (refinement (n))'`; `'a sheet left open closes when a re-list moves the served commit (refinement (n))'` |
| W5S-T6-M2 | pwa | `src/docs/DocsHead.tsx` | the `{share.s !== 'absent' && <ShareAction … />}` line moved after the `{committedHref !== null && …}` line | `test/docs-screen.test.tsx` | 1 failed — `"a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)"` |
| W5S-T6-M3 | pwa | `src/screens/DocsScreen.tsx` | `leafImage={leafImage}` → `leafImage={null}` | `test/docs-screen.test.tsx` | 3 failed — `'a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f))'`; `'a ref-view raster leaf that opens a draft: …'`; `'the same raster leaf at view=committed: …'` |
| W5S-T6-M4 | pwa | `test/control-census.test.ts` | the `'docs/DocsHead.tsx <button> docs-action docs-share'` entry → removed | `test/control-census.test.ts` | 1 failed — `'registers every one'` |
| W5S-T6-M5 | pwa | `src/docs/DocsHead.tsx` | `exportOffered={false}` → `exportOffered` | `test/docs-screen.test.tsx` | 1 failed — `'no refusal on the screen says Export while no page offers it (refinement (c))'` |
| W5S-T6-M6 | pwa | `src/docs/DocsHead.tsx` | `return [docsPageUrl(page), tree.ref.commit, opened].join('\u0000');` → `return [docsPageUrl(page), opened].join('\u0000');` | `test/docs-screen.test.tsx` | 1 failed — `'a sheet left open closes when a re-list moves the served commit (refinement (n))'` |
| W5S-T6-M7 | pwa | `src/docs/DocsHead.tsx` | `return leafImage !== null && samePin(leafImage, expected)` → `return leafImage !== null && leafImage.kind === 'committed' && samePin(leafImage, expected)` (a Share that knows only committed images) | `test/docs-screen.test.tsx` | 1 failed — `'a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note'` |
| W5S-T6-M8 | pwa | `src/docs/DocImage.tsx` | in `leafOf`, `dirSlash: false, view: ctx.view });` → `dirSlash: false, view: 'effective' });` (the image's pin derived without the page's `view`) | `test/docs-screen.test.tsx` | 2 failed — `'the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note'`; the existing `'on view=committed the tap keeps the view and reads no draft'` |

**Verify:** the Task 6 describe, 14 passed; the guards; `TSC-OK`; `pwa-rings` green.

### Task 7: The Share chrome: tokens only, no colour of its own, and both tap-target halves (§4.14; M4.S1 Share clause; refinements (e), (l))

**Model routing:** `sonnet`, effort `medium`. Little judgment: six short rules and two guards.

**Spec rows:** §4.14 ("Share and Export chrome … joins the registrations and both halves of `tap-targets.test.tsx`"), M4.S1 (Share clause, as refinement (e) reads it); refinements (e), (l).

**Files:**
- Modify: `pwa/src/docs/docs.css` (one block inserted after `.docs-reader-sheet-text`'s rule, before the reduced-motion block, which must stay last), `pwa/test/tap-targets.test.tsx` (one import line; one describe inserted), `pwa/test/docs-share-sheet.test.tsx` (three import lines; one appended describe).
- Guards (not edited): `pwa/test/contrast.test.ts` (its census unchanged), `pwa/test/hover-states.test.ts` (no hover rule added; the reduced-motion block still ends the sheet), `pwa/test/motion-reduced.test.ts`, `pwa/test/shape-census.test.ts` (each new rule declares three things or fewer), `pwa/test/css-vars.test.ts`, `pwa/test/shell-css.test.ts`, `pwa/test/fleet-css.test.ts`, `pwa/test/control-census.test.ts`.

**Decisions:** (1) The header's Share takes its floor and look from `.docs-action`; `.docs-share` sets only `cursor`, and drops the underline while disabled. (2) No Share rule sets a colour, ground or border colour; the sheet inherits the `Sheet` panel's measured ink and ground (refinement (e)). (3) The fallback field is a control and carries `min-height: var(--tap-min)` in its own rule; the sheet's two buttons are `@ccrc/ui`'s `Button`, whose `buttonVariants` carry `min-h-tap`. (Departure: (e).)

- [ ] **Step 0:** `git grep -qF ".docs-reader-sheet-text {" HEAD -- pwa/src/docs/docs.css && ! git grep -qF ".docs-share" HEAD -- pwa/src/docs/docs.css && echo T7-BASE-OK`. Claim `docs.css`, `tap-targets.test.tsx`; check W5h-a's state on both. Record the guard suites' counts.
- [ ] **Step 1: Write the failing cases.**
  - `docs-share-sheet.test.tsx`: after `import { act, fireEvent, render, screen } from '@testing-library/react';` add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';`; after `import { COMMIT_A } from './docsFixtures';` add `import { stripComments } from './cssRule';`. Append:

```tsx

// ---- Task 7: the Share chrome paints no colour of its own (M4.S1's Share clause, as refinement (e) reads it) ------

describe('the Share chrome paints no colour of its own (M4.S1 Share clause; refinement (e))', () => {
  const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8'));
  const shareRules = css.split('}').map((chunk) => chunk.split('{')).filter(([sel]) => /\.docs-share\b/.test(sel ?? ''));

  it('every rule naming .docs-share sets no ink, ground or border colour, so design/audit.mjs owes it no entry', () => {
    expect(shareRules.map(([sel]) => (sel ?? '').trim()).sort()).toEqual([
      '.docs-share', '.docs-share-field', '.docs-share-note', '.docs-share-sheet', '.docs-share-url', '.docs-share:disabled',
    ]);
    for (const [sel, body] of shareRules) {
      expect(body ?? '', sel)
        .not.toMatch(/(?:^|[;{\s])(?:color|background[a-z-]*|border[a-z-]*|outline[a-z-]*|fill|stroke|text-decoration-color)\s*:/);
    }
  });
});
```

  - `tap-targets.test.tsx`: `import { DOC_IMAGE_TEXT, DOCS_BANNER_TEXT, DOCS_HEAD_TEXT, DOCS_VIEW_TEXT } from '../src/docs/docsText';` becomes `import { DOC_IMAGE_TEXT, DOCS_BANNER_TEXT, DOCS_HEAD_TEXT, DOCS_VIEW_TEXT, SHARE_SHEET_TEXT } from '../src/docs/docsText';`. Find `describe('TextLink stays inside a line of text — a link alone is a control', () => {` and insert before it:

```tsx
// — native Docs reader W5, Share: the header's Share, the share sheet's two buttons, and the field a refused copy
// leaves (spec 2026-10-01 4.14, 4.16). Both halves for each, as for the Docs controls above. —
describe('Share: .docs-share on .docs-action, the share sheet’s Share… and Copy link, and .docs-share-field (docs W5 Share)', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('are at least one tap tall: .docs-action and .docs-share-field on the token, the sheet’s buttons off @ccrc/ui’s Button', () => {
    expect(floorIn(docsCss, '.docs-action')).toBe('var(--tap-min)');
    expect(floorIn(docsCss, '.docs-share-field')).toBe('var(--tap-min)');
    expect(buttonVariants({ variant: 'primary' })).toContain('min-h-tap');
    expect(buttonVariants({ variant: 'ghost' })).toContain('min-h-tap');
  });

  it('are the classes the rendered controls carry', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: () => Promise.resolve() });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    openDocs('/docs/demo/specs/a.md', markdownLeaf('# A\n'));
    const share = await screen.findByRole('button', { name: DOCS_HEAD_TEXT.share });
    expect(share).toHaveClass('docs-action', 'docs-share');
    fireEvent.click(share);
    expect(await screen.findByRole('button', { name: SHARE_SHEET_TEXT.share })).toHaveClass('min-h-tap');
    const copy = screen.getByRole('button', { name: SHARE_SHEET_TEXT.copy });
    expect(copy).toHaveClass('min-h-tap');
    fireEvent.click(copy);
    expect(await screen.findByRole('textbox', { name: SHARE_SHEET_TEXT.field })).toHaveClass('docs-share-field');
  });
});

```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-share-sheet.test.tsx -t "paints no colour" )` — Expected: 1 failed (no `.docs-share` rule yet). `( cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx -t "docs W5 Share" )` through `ccrc test` — Expected: 1 failed (`'are at least one tap tall: …'`: no `.docs-share-field` rule), 1 passed (the classes are on the rendered controls since Tasks 5 and 6).
- [ ] **Step 3: Implement the CSS.** In `docs.css`, find:

```css
.docs-reader-sheet-text {
  margin: 0; max-block-size: 40dvh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text;
  font: var(--weight-regular) var(--text-sm) / var(--leading-mono) var(--font-mono);
}
```

  and insert after it:

```css

/* — Share (section 4.16; native Docs reader W5, Share). The header's Share is a <button> wearing `.docs-action`, the
   link actions' look and floor (tap-targets.test.tsx holds both halves); `.docs-share` adds the pointer and, while it
   waits for the leaf ("Updating to …", disabled), drops the underline. The share sheet sets no colour, ground or border
   colour of its own: it inherits the Sheet panel's measured ink and ground, as the reader's sheets do, so
   design/audit.mjs owes it no entry (docs-share-sheet.test.tsx holds that). The read-only field a refused copy leaves
   is a control, and carries the floor. — */
.docs-share { cursor: pointer; }
.docs-share:disabled { cursor: default; text-decoration: none; }
.docs-share-sheet { display: grid; gap: var(--sp-3); min-width: 0; }
.docs-share-url { margin: 0; font: var(--weight-regular) var(--text-sm) / var(--leading-mono) var(--font-mono); overflow-wrap: anywhere; }
.docs-share-note { margin: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }
.docs-share-field { inline-size: 100%; min-height: var(--tap-min); font: var(--weight-regular) var(--text-sm) / var(--leading-mono) var(--font-mono); }
```

- [ ] **Step 4: Run to verify they pass**, then the guards: Step 2's two commands, all green; `( cd pwa && ./node_modules/.bin/vitest run test/hover-states.test.ts test/motion-reduced.test.ts test/shape-census.test.ts test/css-vars.test.ts test/shell-css.test.ts test/fleet-css.test.ts test/control-census.test.ts )` Step 0's counts; `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )` through `ccrc test`, alone — Step 0's count, its census unchanged (re-run a spawned-gate timeout alone before calling it broken).
- [ ] **Step 5: Commit.** `git add pwa/src/docs/docs.css pwa/test/tap-targets.test.tsx pwa/test/docs-share-sheet.test.tsx` (expect 3), message `docs: the Share chrome, tokens only, no colour of its own, on the tap floor (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T7-M1 | pwa | `src/docs/docs.css` | `.docs-share-field { inline-size: 100%; min-height: var(--tap-min); font:` → `.docs-share-field { inline-size: 100%; font:` | `test/tap-targets.test.tsx` | 1 failed — `'are at least one tap tall: .docs-action and .docs-share-field on the token, …'` |
| W5S-T7-M2 | pwa | `src/docs/docs.css` | `.docs-share-note { margin: 0;` → `.docs-share-note { color: var(--ink-tertiary); margin: 0;` | `test/docs-share-sheet.test.tsx` | 1 failed — `'every rule naming .docs-share sets no ink, ground or border colour, so design/audit.mjs owes it no entry'` |
| W5S-T7-M3 | pwa | `src/docs/DocsHead.tsx` | `className="docs-action docs-share"` → `className="docs-share"` | `test/tap-targets.test.tsx`, `test/control-census.test.ts` | 3 failed — `'are the classes the rendered controls carry'` (tap-targets); `'registers every one'` and `'keeps no stale entry'` (control-census) |

**Verify:** Step 4's commands, all green.

### Task 8: One share door and one clipboard writer, scanned (M4.SH7; M4.T7's scan reaching the Share files)

**Model routing:** `sonnet`, effort `high`. The judgment is in the scan's forms and its planted controls.

**Spec rows:** M4.SH7 (`navigator.share(` only in `docs/ShareSheet.tsx`; `clipboard.writeText(` under `pwa/src/docs` only in `docs/share.ts`; no `postMessage(` and no `'message'` listener added), M4.T7 (the scan covers `share.ts`).

**Files:**
- Modify: `pwa/test/docs-scans.test.ts` (one clause appended after the W8a clause's last line).
- Guards: the file's existing clauses (unchanged).

**Decisions:** (1) The clause reads the TypeScript AST with the file's own `unwrap` and `memberName`, NOT EXHAUSTIVE, its evasions listed in its header. (2) `navigator.share` is read across `pwa/src`; `writeText` under `pwa/src/docs` only, as M4.SH7 scopes it (`lib/markdown.tsx`'s code-block copy and `fleet/TroubleCard.tsx` write the clipboard outside Docs, untouched). (3) Planted controls run on a copy of `pwa/src` in a temporary directory (the file's existing `mkdtempSync` pattern), removed in `afterAll`. (4) The "no `postMessage`, no `message` listener" half reuses clause W8a's `readerScan` over the Share files rather than a second walk; the M4.T7 half reuses clause 1's `scanTree`. (None departs.)

- [ ] **Step 0:** `git grep -qF "describe('clause W8a: the reader library has its homes (M8.10 amended, M8.21)'" HEAD -- pwa/test/docs-scans.test.ts && git grep -qF "navigator.share(data)" HEAD -- pwa/src/docs/ShareSheet.tsx && echo T8-BASE-OK`. Claim `docs-scans.test.ts`; check W5h-a's clauses there (both append at the end; the second to merge appends after the first's). Record the file's count.
- [ ] **Step 1: Append the describe** (the helpers it calls come in Step 3) at the end of `docs-scans.test.ts`:

```ts

describe('clause W5 Share: one share door and one clipboard writer (M4.SH7; M4.T7 Share clause)', () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** A copy of `pwa/src` with `text` appended to `rel`; returns the directory holding `src`. */
  function planted(rel: string, text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-share-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    writeFileSync(file, readFileSync(file, 'utf8') + text);
    return dir;
  }

  it('M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard', () => {
    const { files, uses } = shareDoorScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/ShareSheet.tsx', 'src/docs/share.ts', 'src/docs/DocsHead.tsx']));
    expect(uses.sort()).toEqual(['src/docs/ShareSheet.tsx share', 'src/docs/share.ts writeText']);
  });

  it.each([
    ['navigator.share(x)', 'export const f = (x: ShareData) => navigator.share(x);', ['src/docs/x.ts share']],
    ['navigator?.share(x)', 'export const f = (x: ShareData) => navigator?.share(x);', ['src/docs/x.ts share']],
    ["navigator['share'](x)", "export const f = (x: ShareData) => navigator['share'](x);", ['src/docs/x.ts share']],
    ['(navigator as Navigator).share(x)', 'export const f = (x: ShareData) => (navigator as Navigator).share(x);', ['src/docs/x.ts share']],
    ['clipboard.writeText(t)', 'export const f = (t: string) => navigator.clipboard.writeText(t);', ['src/docs/x.ts writeText']],
    ['clipboard?.writeText(t)', 'export const f = (t: string) => navigator.clipboard?.writeText(t);', ['src/docs/x.ts writeText']],
  ])('M4.SH7: the scan reads %s', (_name, source, want) => {
    expect(shareDoorUses(source, 'src/docs/x.ts').map((u) => `${u.file} ${u.door}`)).toEqual(want);
  });

  it.each([
    ['a capability probe', 'export const f = (x: ShareData) => navigator.canShare(x);'],
    ['another owner', 'export const f = (o: { share(x: unknown): void }) => o.share(1);'],
    ['a comment', '// navigator.share(x) is never called here\nexport const x = 1;'],
    ['a string', "export const x = 'navigator.share(x)';"],
  ])('M4.SH7: the scan does not count %s', (_name, source) => {
    expect(shareDoorUses(source, 'src/docs/x.ts')).toEqual([]);
  });

  it("M4.SH7: a clipboard write outside pwa/src/docs is not this clause's", () => {
    expect(shareDoorUses('export const f = (t: string) => navigator.clipboard.writeText(t);', 'src/fleet/x.ts')).toEqual([]);
  });

  it('M4.SH7 planted: a navigator.share in DocsHead is red', () => {
    const dir = planted('src/docs/DocsHead.tsx', "\nexport const plantedShare = (): Promise<void> => navigator.share({ url: 'x' });\n");
    expect(shareDoorScan(dir).uses).toContain('src/docs/DocsHead.tsx share');
  });

  it('M4.SH7 planted: a clipboard write in ShareSheet is red', () => {
    const dir = planted('src/docs/ShareSheet.tsx', "\nexport const plantedCopy = (): Promise<void> => navigator.clipboard.writeText('x');\n");
    expect(shareDoorScan(dir).uses).toContain('src/docs/ShareSheet.tsx writeText');
  });

  it('M4.SH7: Share adds no postMessage and no message listener (clause W8a reads the Share files)', () => {
    const { files, hits } = readerScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/share.ts', 'src/docs/ShareSheet.tsx']));
    expect(hits.filter((h) => h.file === 'src/docs/share.ts' || h.file === 'src/docs/ShareSheet.tsx')).toEqual([]);
  });

  it('M4.T7 Share clause: the badge scan reads share.ts and ShareSheet.tsx, and finds no draft state', () => {
    const { files, hits } = scanTree([DOCS_DIR, DOCS_SCREEN], PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/share.ts', 'src/docs/ShareSheet.tsx']));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts -t "clause W5 Share" )` — Expected: the cases that call `shareDoorUses` or `shareDoorScan` red (`ReferenceError`); the last two (they reuse existing walks) green.
- [ ] **Step 3: Insert the clause's header and helpers** directly above that describe:

```ts

// ---------------------------------------------------------------------------------------------------------------
// Clause W5 Share (M4.SH7; spec 2026-10-01 4.5, 4.16): one share door and one clipboard writer. Across `pwa/src`, a
// call of `share` on the bare `navigator` (`navigator.share(…)`, `navigator?.share(…)`, `navigator['share'](…)`,
// through parentheses, `!` and casts) sits only in `docs/ShareSheet.tsx`; under `pwa/src/docs`, a call of a member
// named `writeText` sits only in `docs/share.ts` (`copyText`, which Copy link, the truth line's copy commit and the
// reader's copy op all call). `navigator.canShare(…)` is a capability probe, not a share, and is not counted. Share
// adds no `postMessage` and no `message` listener: clause W8a's walk reads the Share files and finds none.
// NOT EXHAUSTIVE. Known evasions it does not see: `navigator` held in a variable first (`const n = navigator;
// n.share(x)`), a computed key (`navigator[k](x)`), `.call` / `.apply` / `.bind` (`navigator.share.call(navigator, x)`),
// `window.navigator.share(x)` or `globalThis.navigator.share(x)` (the owner is not the bare identifier), and a
// `writeText` reached through an alias (`const w = clipboard.writeText; w(t)`). Review lens 3 reads for those, and
// docs-share-sheet.test.tsx's receiver case catches a detached call in the sheet itself.
// ---------------------------------------------------------------------------------------------------------------

/** One door use: the file (relative to the scanned base, `/` separators) and which door. */
interface DoorUse { file: string; door: 'share' | 'writeText' }

/** Every `navigator.share(…)` call in one module, and, under `src/docs/`, every `….writeText(…)` call. */
function shareDoorUses(source: string, file: string): DoorUse[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const uses: DoorUse[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = memberName(callee);
      if (name === 'share' && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
        const owner = unwrap(callee.expression);
        if (ts.isIdentifier(owner) && owner.text === 'navigator') uses.push({ file, door: 'share' });
      }
      if (name === 'writeText' && file.startsWith('src/docs/')) uses.push({ file, door: 'writeText' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return uses;
}

/** The door scan over every `.ts` and `.tsx` file under `<base>/src`: the files read, and each use as `<file> <door>`. */
function shareDoorScan(base: string): { files: string[]; uses: string[] } {
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const uses = files.flatMap((rel) => shareDoorUses(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel));
  return { files, uses: uses.map((u) => `${u.file} ${u.door}`) };
}
```

- [ ] **Step 4: Run to verify they pass**, then the whole file: `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — Step 0's count plus this clause's cases, all green; `TSC-OK`.
- [ ] **Step 5: Commit.** `git add pwa/test/docs-scans.test.ts` (expect 1), message `docs: one share door and one clipboard writer, scanned (docs W5 Share)`, trailer. Record the JSON row fence.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W5S-T8-M1 | pwa | `src/docs/DocsHead.tsx` | a line appended at the end: `export const plantedShare = (): Promise<void> => navigator.share({ url: 'x' });` | `test/docs-scans.test.ts` | 1 failed — `'M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard'` |
| W5S-T8-M2 | pwa | `src/docs/ShareSheet.tsx` | a line appended at the end: `export const plantedCopy = (): Promise<void> => navigator.clipboard.writeText('x');` | `test/docs-scans.test.ts` | 1 failed — the same case |
| W5S-T8-M3 | pwa | `test/docs-scans.test.ts` | `if (ts.isIdentifier(owner) && owner.text === 'navigator')` → `if (ts.isIdentifier(owner) && owner.text === 'window')` | `test/docs-scans.test.ts` | 6 failed — the four share forms of `'M4.SH7: the scan reads %s'` (`navigator.share(x)`, `navigator?.share(x)`, `navigator['share'](x)`, `(navigator as Navigator).share(x)`); `'M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard'`; `'M4.SH7 planted: a navigator.share in DocsHead is red'` |
| W5S-T8-M4 | pwa | `src/docs/share.ts` | a line appended at the end: `export const plantedState = (e: DocsTreeOk['entries'][number]): string \| undefined => e.draft?.state;` | `test/docs-scans.test.ts` | 3 failed — `'the Docs screen code reads no draft state'`; `'a file planted beside the real ones is found, by file and line'` (its copy of `pwa/src/docs` now holds the planted read too); `'M4.T7 Share clause: the badge scan reads share.ts and ShareSheet.tsx, and finds no draft state'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — all passed.

### Task 9: Whole-branch review (held out), its fixes, and `## Deviations found`

**Model routing:** reviewers `opus`, four lenses; one `sonnet` refute pass per finding; fixes by `sonnet` implementers, each reviewed by `opus`.

- [ ] **Step 1:** Four `opus` lenses over `BASE..HEAD` against this plan and the spec: (1) what leaves the browser (every share argument, the notes, the closed label, no document text, the refusal words, the access note, the Export seam); (2) the opened pin and its timing (`shareStateFor`, the same-blob rule, the raster report and its cleanup, the sheet's key, the reader frame and the plain view alike); (3) the sheet's two doors and the M4.SH7 scan (synchronous Web Share, `AbortError` by name, `copyText` only, the fallback field, the scan's evasions and controls); (4) the test and mutation table, the chrome's census standing, rings, and spec and deviation fidelity, plus the public-repo scan of every changed file.
- [ ] **Step 2:** Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 3: Define the deviations.** Replace `## Deviations found`'s placeholder line with the issued numbers: the first six go to the departing refinements (a), (b), (c), (e), (f) and (i), in that order, then any departure found while executing, in the order found. Entry form: `- **D-<n> (<date>)** — <slug> (refinement (<letter>)). <what departs from which spec sentence, and why>. <Task and rows that apply it>.` Then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green; `grep -c '^- \*\*D-[0-9]* (' <plan>` equals the number defined; `sed -n '/^## Deviations found/,/^## /p' <plan> | grep -nE 'D-<n|<date>|D-TBD-[a-z0-9]'` prints nothing. Commit `docs: Share's deviations, as issued (docs W5 Share)`.

### Task 10: Close — suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus), with `sonnet` subagents for the runs.

- [ ] **Step 1: Suites**, each in the foreground through `ccrc test`, split to fit: the `pwa` full suite in pieces; `TSC-OK`; `contrast.test.ts` alone; `git fetch -q origin main` then `server`'s `docs-parity`, the `single-definition/` suites (the spec's `single-definition.test.ts` is now that directory; `docs-l0` holds the Docs L0 names), `rings/pwa-rings`, `rings/totality`, `rings/pwa-one-owner`, `census-w7/pwa`, `deviation-refs`, `dtbd`, `topology-clean`, `anchors`, `citations`. Re-run any known load flake alone before calling it broken. Spec §7.9's Share list (`docs-share`, `docs-scans`, `docs-screen`, `contrast`, `tap-targets`) is a subset of these.
- [ ] **Step 2: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 3: Append `## Share results`**: the counts per suite; every task's JSON row fence as measured; "Named, without a number" (choices that filled a silence while executing); "Carried, not fixed". This commit is the `handoffCommit`.
- [ ] **Step 4: Public-repo scan** of every changed file and of the PR body (rc 0, zero hits). Remove `$HOME/.cc-tmp/w5s-mut/`.
- [ ] **Step 5: Push** the workspace branch and open the ONE pull request (title `Docs W5: Share`; body: what ships, the departing refinements with their numbers, the shared files with W5h-a, the expected CI (a selected server run; the pwa legs in full), the plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives).
- [ ] **Step 6:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Issued at the run's opening (run 1350); the first six go to the departing refinements (a), (b), (c), (e), (f) and (i), in that order, then the departures found while executing, in the order found.

- **D-7767 (2026-11-02)** — same-blob-link-names-the-opened-pin (refinement (a)). §4.16 and M4.EX12 have the link's commit equal the file answer's `commit`; after a same-blob re-list the visit rebinds the slot's pin to the new commit without a second read, so Share links the opened pin's commit and shows the answer's `onRef` note only when the answer was measured at that commit, because the bytes on screen are the new commit's bytes and an older `onRef` must not speak of a newer commit. Task 2 (`shareTargetFor`; rows W5S-T2-M1, W5S-T2-M4).
- **D-7768 (2026-11-02)** — closed-worktree-label-in-docsText (refinement (b)). §4.1's file table puts the closed label in `docs/export/provenance.ts`; `closedWorktreeLabel` is written now in `docs/docsText.ts`, beside `worktreeLabel`, because Share's notes name a worktree and Share ships before Export, which imports it later. Task 1 (row W5S-T1-M3).
- **D-7769 (2026-11-02)** — share-export-rows-split (refinement (c)). §7.7's "W5 Share" row lists M4.SH1-SH8 whole; the Export halves of M4.SH3 and M4.SH8 move to Export's run, and Export's clause is a seam (`SHARE_EXPORT_CLAUSE`, `SHARE_EXPORT_CLAUSE_FOR`, `shareRefusalSentence(why, fields, exportOffered)`) that every caller in this wave passes `false`, because this run builds no Export. Tasks 1, 5 and 6 (rows W5S-T1-M1, W5S-T1-M2, W5S-T6-M5).
- **D-7770 (2026-11-02)** — share-chrome-paints-no-colour (refinement (e)). M4.S1, §4.14 and §4.1's `design/audit.mjs` row register the Share chrome in the contrast census; no Share rule sets an ink, ground or border colour (the sheet inherits the `Sheet` panel's), so there is nothing to register, and a test holds that no `.docs-share` rule sets one. Task 7 (row W5S-T7-M2).
- **D-7771 (2026-11-02)** — failed-raster-image-settles-share (refinement (f)). §4.3 item 5 and M4.EX12 have a raster leaf wait for its image to load; for Share, an image that failed settles the leaf too (Export keeps "the image is loaded"), and an over-cap raster is ready at `pinFor`'s pin at once, because a failed read settles any other leaf and the link names the tree's commit either way. Tasks 3, 4 and 6 (rows W5S-T3-M4, W5S-T3-M5, W5S-T4-M2, W5S-T4-M5).
- **D-7772 (2026-11-02)** — dir-drafts-counts-in-words (refinement (i)). §4.16 writes "<k> uncommitted docs here are not included."; the note reads "{k} uncommitted doc{s} here {be} not included.", so one draft reads "1 uncommitted doc here is not included.", as the banners already count. Task 1 (`SHARE_NOTE`'s `dir-drafts`).
- **D-7773 (2026-11-02)** — settled-non-ok-slot-is-ready-at-pinFor (found in Task 9's review, lens 2). §4.16 and M4.EX12 keep Share disabled while the leaf does not show `pinFor`'s pin; the visit rebinds only an `ok` slot's pin on a same-blob re-list, so a `failed`, `changing`, `too-large` or client slot kept its old pin and Share read "Updating to <short>…" until Retry. A settled slot that is not `ok` shows no bytes, so it is ready at `pinFor`'s pin with no answer, as refinement (f) settles a failed raster; an `ok` slot keeps the same-pin gate. Task 9 fix 297f99a7a (row W5S-T9-M1). Spec text: amended in place by the coordinator's ledger PR.
- **D-7774 (2026-11-02)** — open-sheet-target-recomputed-while-open (refinement (n); found in review run 1356). Refinement (n) says the sheet's target "is computed when the sheet opens"; `ShareAction` works `shareTargetFor` out on every render while the sheet is open, because it is keyed by the page's URL, the tree's commit and what the leaf opened, so any change that would alter the target closes the sheet first, and a frozen target would keep a drafts note a same-commit re-list had changed. Cost if wrong: a later change to that key would let the target change under an open sheet. Task 6 (`ShareAction`, `shareKeyOf`; rows W5S-T6-M1, W5S-T6-M6); fix round 1 (`ShareSheet.tsx`'s header).

Issued and unused: 7775 to 7779, written without the prefix so they seed no floor.

## Where things stand

### Agreed
- Share as §4.16 rules it: a GitHub permalink at the commit the page opened; a sheet on every tap (decision 1); the access note wherever the repository's slug is usable (decision 8); drafts never in a link, with a note saying so (the drafts ruling); an unpushed commit gets no link (decision 10).
- The L0 half is already on `main` (W5 part 1's first task: the `GithubTarget` widening, `githubPermalink`, `githubUrlAt`); this wave changes nothing under `shared/`.
- Share runs beside W5h-a; Export follows both and takes Share's seam (`exportOffered`, `closedWorktreeLabel`).
- The Export halves of M4.SH3 and M4.SH8 move to Export unconditionally (coordinator): the ledger PR writes them into §7.7's W5 Export row and the ledger's Export bullet, and closes the carried `GithubTarget` line as done by #627.
- Two silences filled, not departures: a leaf Docs does not preview is ready at `pinFor`'s pin (q), and a leaf that opens nothing links at the tree's commit (r).
- This plan, approved by the operator on 2026-11-02, with every recommendation taken (operator, 2026-11-02).
- Refinement (r): Share on a leaf that opens nothing (a symlink or submodule) links it at the tree's commit, as View on GitHub already does (operator, 2026-11-02).
- The six departing refinements ((a) the same-blob link and `onRef`, (b) the closed label's home, (c) the Share/Export row split, (e) no colour so no registration, (f) a failed raster image settles Share, (i) `dir-drafts` in words) are written into the spec in the ledger PR, #2124 (operator, 2026-11-02).
- Refinement (f): Share on a raster leaf whose image failed to load is offered at that pin, as a failed file read is (operator, 2026-11-02).

### Waiting on you
- Nothing before dispatch. Mid-wave, only a stop-and-ask the tasks name (a moved anchor, or a mutation row whose measured red differs from the plan's).

### Later
- Export, after W5h-a and Share: Export after Share in the header, its own availability passed as `exportOffered`, the Export halves of M4.SH3 and M4.SH8, `closedWorktreeLabel` imported into its provenance.
- W6: `html-source` gains "Export makes a viewable copy."
- W5b: Share's rows re-derived for version views (§4.13).
- W7: README's Share prose (§7.5), refinements included.
- Expiring share links (§4.13): their own designed wave, with a threat model.

## Share results

Measured at the end state (Task 10, 2026-11-02), every run through `ccrc test`, in the foreground.

| Suite | Files | Passed | Failed | Skipped |
|---|---|---|---|---|
| `pwa`, the full suite in six chunks | 395 | 11773 | 0 | 3 |
| `pwa/test/contrast.test.ts`, alone | 1 | 307 | 0 | 0 |
| `pwa` typecheck | — | `TSC-OK` | — | — |
| `server`: `docs-parity`, `single-definition/`, `rings/pwa-rings`, `rings/totality`, `rings/pwa-one-owner`, `census-w7/pwa`, `deviation-refs`, `dtbd`, `topology-clean`, `anchors`, `citations` | 29 | 1333 (one re-run green after the fix below) | 0 | 0 |

The first full run was green in `pwa` and red in one `server` guard: `single-definition/core-vocab`'s "one repoLabel" scan read Share's `tree.github.state === 'named'` as a second reader of the repo-label switch. The line was respelled as the base's L0 readers of `DocsGithub` spell it (`state === 'none'`, same behaviour; commit `39a0b0d41`), and `core-vocab` (44) and `single-definition/` (19 files, 1045 tests) re-ran green.

Fix round 1 (review run 1356) re-ran, at its own tip: the six Share files (`docs-share`, `docs-share-sheet`, `docs-screen`, `docs-scans`, `tap-targets`, `control-census`), 356 passed; the `pwa` typecheck, `TSC-OK`; `contrast.test.ts` alone, 307 passed; and `server`'s `single-definition/`, 19 files, 1045 passed. The suite table above is Task 10's, measured before the round.

The whole mutation table: 53 rows (the last occurrence of each id), run one at a time in the workspace, each restored from a saved copy with its sha256 checked and `git status --porcelain` clean after every row. Every row went red. Three rows went red in one test more than they stated, each time a test the Task 9 fix wave added for exactly what the row mutates: W5S-T2-M1, W5S-T5-M1 and W5S-T5-M4. The coordinator ruled on 2026-11-02 (mail 13988) that they are restated as "2 failed at the end state (1 at its task)", naming both tests; they are corrections of the plan's predictions, not departures. Task 9's three rows (W5S-T9-M1 to M3) prove its fixes. Fix round 1 (review run 1356, the coordinator's rulings in mail 14018) restated W5S-T3-M1 and W5S-T5-M3 on the same principle, added W5S-T9-M4 and W5S-T9-M5 for `webShareUsable`'s `canShare` arm, and re-measured W5S-T4-M5 once the raster screen cases waited for the image; those three rows were measured in fix round 1, the other fifty at Task 10.

```json
{"id": "W5S-T1-M1", "pkg": "pwa", "file": "src/docs/docsText.ts", "old": "return exportOffered && SHARE_EXPORT_CLAUSE_FOR.has(why)", "new": "return SHARE_EXPORT_CLAUSE_FOR.has(why)", "tests": "test/docs-share.test.ts", "red": "2 failed (of 66): no refusal sentence carries Export's clause while no page offers Export (refinement (c)); the refusal sentences are spec 4.16's, without Export's clause"}
{"id": "W5S-T1-M2", "pkg": "pwa", "file": "src/docs/docsText.ts", "old": "['no-github-origin', 'bad-slug', 'bad-target', 'new-draft']", "new": "['no-github-origin', 'bad-slug', 'new-draft']", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): the Export seam: a page that offers Export adds the clause to exactly the four refusals the spec gives it"}
{"id": "W5S-T1-M4", "pkg": "pwa", "file": "src/docs/docsText.ts", "old": "'{k} uncommitted doc{s} here {be} not included.'", "new": "'{k} uncommitted docs here are not included.'", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): dir-drafts counts in words: one doc is, three docs are (refinement (i))"}
{"id": "W5S-T2-M1", "pkg": "pwa", "file": "src/docs/share.ts", "old": "opened.pin.kind === 'committed' ? opened.pin.commit : tree.ref.commit", "new": "opened.pin.kind === 'committed' ? tree.ref.commit : tree.ref.commit", "tests": "test/docs-share.test.ts", "red": "2 failed at the end state (1 at Task 2): a raster leaf links the commit of the pin its image settled at, not the tree's; a leaf links the commit its opened pin names, never the tree's newer commit (M4.EX12)"}
{"id": "W5S-T2-M2", "pkg": "pwa", "file": "src/docs/share.ts", "old": "leaf !== null && leaf.view.opens === 'none' ? 'new-withheld' : 'new-draft'", "new": "'new-draft'", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3)"}
{"id": "W5S-T2-M3", "pkg": "pwa", "file": "src/docs/share.ts", "old": "notes: why === 'no-github-origin' || why === 'bad-slug' ? [] : access", "new": "notes: []", "tests": "test/docs-share.test.ts", "red": "6 failed (of 66): a readable new draft (added, fp set) sends no link: new-draft, with the access note (M4.SH3); a readable new draft (untracked, fp set) sends no link: new-draft, with the access note (M4.SH3); a withheld new file (it opens nothing) sends no link: new-withheld, naming why Docs did not read it (M4.SH3); not-on-origin: no link, its fields, and the access note, since the slug is usable; unmeasured: no link, its fields, and the access note, since the slug is usable; bad-target: no link, its fields, and the access note, since the slug is usable"}
{"id": "W5S-T2-M4", "pkg": "pwa", "file": "src/docs/share.ts", "old": " && opened.show.commit === opened.pin.commit", "new": "", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a same-blob re-list: the pin is at C2 and the answer still says C1; the link names C2, and C1's onRef is not said of it"}
{"id": "W5S-T2-M5", "pkg": "pwa", "file": "src/docs/share.ts", "old": "    else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });\n", "new": "    ", "tests": "test/docs-share.test.ts", "red": "3 failed (of 66): every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p)); a ref-view leaf opening a draft with a committed side sends the committed permalink at C, and says drafts are not included (M4.SH2); a worktree outside the closed set is named \"another worktree\", never by its path"}
{"id": "W5S-T2-M6", "pkg": "pwa", "file": "src/docs/share.ts", "old": "e.path.startsWith(page.path + '/')", "new": "e.path.startsWith(page.path)", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): /docs/demo/specs/guide/?ref=main counts 1"}
{"id": "W5S-T2-M7", "pkg": "pwa", "file": "src/docs/share.ts", "old": "} else if (mode === 'ref') {", "new": "} else {", "tests": "test/docs-share.test.ts", "red": "3 failed (of 66): the default view /docs/demo says nothing of drafts; the default view /docs/demo/specs says nothing of drafts; the default view /docs/demo/specs/d/ says nothing of drafts"}
{"id": "W5S-T2-M8", "pkg": "pwa", "file": "src/docs/share.ts", "old": "title: repoPath === null ? page.project : leafName(repoPath),", "new": "title: page.project,", "tests": "test/docs-share.test.ts", "red": "5 failed (of 66): a section page: /tree/<C>/<section path>, titled by its last segment; a directory page: /tree/<C>/<its repo path>; a leaf: /blob/<the opened commit>/<repo path>, titled by its basename even when the doc's h1 is hostile; a leaf that opens nothing (a committed symlink) links at the tree's commit (refinement (r)); a raster leaf links the commit of the pin its image settled at, not the tree's"}
{"id": "W5S-T2-M9", "pkg": "pwa", "file": "src/docs/share.ts", "old": "fields: { badge: ENTRY_BADGE_TEXT[view.badge], label }", "new": "fields: { badge: view.badge, label }", "tests": "test/docs-share.test.ts", "red": "8 failed (of 66): admitted but opening committed (deleted): the permalink, and the badge the row shows; admitted but opening committed (typechange): the permalink, and the badge the row shows; admitted but opening committed (withheld): the permalink, and the badge the row shows; deleted; typechange; withheld, too large; withheld, unreadable; withheld, not a file"}
{"id": "W5S-T2-M10", "pkg": "pwa", "file": "src/docs/share.ts", "old": "closedWorktreeLabel(tree.drafts.worktree)", "new": "tree.drafts.worktree.path", "tests": "test/docs-share.test.ts", "red": "7 failed (of 66): every argument over the page fixtures is a permalink at a full commit and carries nothing of ccrc (refinement (p)); a ref-view leaf opening a draft with a committed side sends the committed permalink at C, and says drafts are not included (M4.SH2); view=committed on an admitted entry: the permalink, and the uncommitted changes are not included; admitted but opening committed (deleted): the permalink, and the badge the row shows; admitted but opening committed (typechange): the permalink, and the badge the row shows; admitted but opening committed (withheld): the permalink, and the badge the row shows; a worktree outside the closed set is named \"another worktree\", never by its path"}
{"id": "W5S-T3-M3", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "(page.kind === 'path' && page.frame === 'full')", "new": "false", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): /docs/demo/specs/m.html?ref=main&frame=full: no Share"}
{"id": "W5S-T3-M4", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return leafImage !== null && samePin(leafImage, expected) ? readyAt(expected, null) : updating;", "new": "return readyAt(expected, null);", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a raster leaf waits for its own image, and is ready at the pin the image settled at (refinement (f))"}
{"id": "W5S-T3-M5", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "    if (typeof size === 'number' && size > DOCS_CLASS_CAP.raster) return readyAt(expected, null);\n", "new": "", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a raster over its class cap is never loaded, so it is ready at pinFor's pin at once (refinement (f))"}
{"id": "W5S-T3-M6", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "contentClass(page.path) === 'other'", "new": "false", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a class Docs does not preview reads nothing, so it is ready at pinFor's pin (refinement (q))"}
{"id": "W5S-T3-M7", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "expected === null", "new": "false", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): /docs/demo/specs/l.md: ready, having opened no file"}
{"id": "W5S-T4-M2", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "job !== null && shown.s !== 'loading' ? job : null", "new": "job !== null && shown.s === 'loaded' ? job : null", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f))"}
{"id": "W5S-T4-M4", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "return () => onLeafImage(null);", "new": "return undefined;", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): reports the leaf's pin once its bytes are shown, and null when it unmounts"}
{"id": "W5S-T5-M1", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "const onShare = (): void => {\n    let sent: Promise<void>;", "new": "const onShare = async (): Promise<void> => {\n    await Promise.resolve();\n    let sent: Promise<void>;", "tests": "test/docs-share-sheet.test.tsx", "red": "2 failed at the end state (1 at Task 5): calls navigator.share on navigator, with url, title and text, before any microtask runs; a double tap: the second call is refused while the first is open, and the first finishing clears the notice"}
{"id": "W5S-T5-M2", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "if (errorName(e) !== 'AbortError') setShareFailed(true);", "new": "setShareFailed(true);", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): AbortError (the reader closed the native sheet) does nothing"}
{"id": "W5S-T5-M5", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "{canShare && <Button variant=\"primary\" onClick={onShare}>", "new": "{<Button variant=\"primary\" onClick={onShare}>", "tests": "test/docs-share-sheet.test.tsx", "red": "3 failed (of 21): shows the link and the access note, and offers Copy link only; offers no Share… where navigator.canShare says no; offers no Share… where navigator.canShare throws"}
{"id": "W5S-T5-M6", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "sent = navigator.share(data);", "new": "sent = navigator.share.call(undefined, data);", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): calls navigator.share on navigator, with url, title and text, before any microtask runs"}
{"id": "W5S-T6-M1", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "<ShareAction key={shareKeyOf(page, tree, share)} page={page}", "new": "<ShareAction page={page}", "tests": "test/docs-screen.test.tsx", "red": "2 failed (of 101): a sheet left open closes when the page changes, even to a page whose Share is ready at once (refinement (n)); a sheet left open closes when a re-list moves the served commit (refinement (n))"}
{"id": "W5S-T6-M3", "pkg": "pwa", "file": "src/screens/DocsScreen.tsx", "old": "leafImage={leafImage}", "new": "leafImage={null}", "tests": "test/docs-screen.test.tsx", "red": "3 failed (of 101): a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f)); a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note; the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note"}
{"id": "W5S-T6-M5", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "exportOffered={false}", "new": "exportOffered", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): no refusal on the screen says Export while no page offers it (refinement (c))"}
{"id": "W5S-T6-M6", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return [docsPageUrl(page), tree.ref.commit, opened].join('\\u0000');", "new": "return [docsPageUrl(page), opened].join('\\u0000');", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): a sheet left open closes when a re-list moves the served commit (refinement (n))"}
{"id": "W5S-T6-M7", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "return leafImage !== null && samePin(leafImage, expected)", "new": "return leafImage !== null && leafImage.kind === 'committed' && samePin(leafImage, expected)", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note"}
{"id": "W5S-T6-M8", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "dirSlash: false, view: ctx.view });", "new": "dirSlash: false, view: 'effective' });", "tests": "test/docs-screen.test.tsx", "red": "2 failed (of 101): on view=committed the tap keeps the view and reads no draft; the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note"}
{"id": "W5S-T7-M1", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-share-field { inline-size: 100%; min-height: var(--tap-min); font:", "new": ".docs-share-field { inline-size: 100%; font:", "tests": "test/tap-targets.test.tsx", "red": "1 failed (of 86): are at least one tap tall: .docs-action and .docs-share-field on the token, the sheet’s buttons off @ccrc/ui’s Button"}
{"id": "W5S-T7-M2", "pkg": "pwa", "file": "src/docs/docs.css", "old": ".docs-share-note { margin: 0;", "new": ".docs-share-note { color: var(--ink-tertiary); margin: 0;", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): every rule naming .docs-share sets no ink, ground or border colour, so design/audit.mjs owes it no entry"}
{"id": "W5S-T7-M3", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "className=\"docs-action docs-share\"", "new": "className=\"docs-share\"", "tests": "test/tap-targets.test.tsx, test/control-census.test.ts", "red": "3 failed (of 97): registers every one; keeps no stale entry; are the classes the rendered controls carry"}
{"id": "W5S-T8-M3", "pkg": "pwa", "file": "test/docs-scans.test.ts", "old": "if (ts.isIdentifier(owner) && owner.text === 'navigator')", "new": "if (ts.isIdentifier(owner) && owner.text === 'window')", "tests": "test/docs-scans.test.ts", "red": "6 failed (of 69): M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard; M4.SH7: the scan reads navigator.share(x); M4.SH7: the scan reads navigator?.share(x); M4.SH7: the scan reads navigator['share'](x); M4.SH7: the scan reads (navigator as Navigator).share(x); M4.SH7 planted: a navigator.share in DocsHead is red"}
{"id": "W5S-T1-M3", "pkg": "pwa", "file": "src/docs/docsText.ts", "old": "    case 'other':\n      return DOCS_HEAD_TEXT.worktreeOther;", "new": "    case 'other':\n      return w.path.split('/').filter((s) => s !== '').slice(-2).join('/');", "tests": "test/docs-share.test.ts", "red": "2 failed (of 66): closedWorktreeLabel names a worktree from a closed set, never another segment of its path (refinement (b)); a worktree outside the closed set is named \"another worktree\", never by its path"}
{"id": "W5S-T3-M1", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "  return samePin(file.pin, expected) ? readyAt(file.pin, file.answer.show) : updating;\n", "new": "  return readyAt(file.pin, file.answer.show);\n", "tests": "test/docs-share.test.ts", "red": "2 failed at the end state (1 at Task 3): a leaf still showing C1 while the tree is at C2 is updating, to C2 (M4.EX12); control: an ok slot at the C1 pin under a C2 tree stays updating (its held body is in flight)"}
{"id": "W5S-T3-M2", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "  if (file.s === 'loading') return updating;\n", "new": "", "tests": "test/docs-share.test.ts", "red": "1 failed (of 66): a leaf whose first read is in flight is updating, to pinFor's commit (refinement (h))"}
{"id": "W5S-T4-M1", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "    onLeafImage(pin);\n", "new": "", "tests": "test/docs-screen.test.tsx", "red": "5 failed (of 101): reports the leaf's pin once its bytes are shown, and null when it unmounts; a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f)); a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f)); a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note; the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note"}
{"id": "W5S-T4-M3", "pkg": "pwa", "file": "src/docs/DocsLeaf.tsx", "old": "<DocsLeafImageContext value={p.onLeafImage}>", "new": "<DocsLeafImageContext value={null}>", "tests": "test/docs-screen.test.tsx", "red": "5 failed (of 101): reports the leaf's pin once its bytes are shown, and null when it unmounts; a failed load settles it too: the pin is reported, as a failed read settles any leaf (refinement (f)); a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f)); a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note; the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note"}
{"id": "W5S-T4-M5", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "job !== null && shown.s !== 'loading' ? job : null", "new": "job !== null ? job : null", "tests": "test/docs-screen.test.tsx", "red": "4 failed (of 101): reports nothing while the image loads; a raster leaf: Share waits for its image, then links the pin the image loaded (M4.SH1, M4.EX12; refinement (f)); a ref-view raster leaf that opens a draft: Share waits for the drafted image, then sends the committed permalink at C with the drafts note; the same raster leaf at view=committed: Share waits for the committed image, then sends the permalink with the not-included note"}
{"id": "W5S-T5-M3", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "    sent.then(() => setShareFailed(false), refused);\n", "new": "    sent.then(() => setShareFailed(false), () => {});\n", "tests": "test/docs-share-sheet.test.tsx", "red": "2 failed at the end state (1 at Task 5): any other refusal (a rejection) shows the notice, and Copy link stays; a double tap: the second call is refused while the first is open, and the first finishing clears the notice"}
{"id": "W5S-T5-M4", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "        {copy === 'refused' && (\n          <input ref={field} className=\"docs-share-field\" readOnly value={link.url} aria-label={SHARE_SHEET_TEXT.field} />\n        )}\n", "new": "", "tests": "test/docs-share-sheet.test.tsx", "red": "2 failed at the end state (1 at Task 5): a refused copy leaves a read-only field holding the link, focused and selected; a second refused copy focuses and selects the field again, and announces the refusal anew"}
{"id": "W5S-T5-M7", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "        <Notes notes={target.notes} />\n", "new": "", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): shows its sentence and the access note, and offers neither Share… nor Copy link"}
{"id": "W5S-T6-M2", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "      {share.s !== 'absent' && <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} />}\n      {committedHref !== null && <DocsPageLink className=\"docs-action\" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}", "new": "      {committedHref !== null && <DocsPageLink className=\"docs-action\" href={committedHref}>{DOCS_HEAD_TEXT.openCommitted}</DocsPageLink>}\n      {share.s !== 'absent' && <ShareAction key={shareKeyOf(page, tree, share)} page={page} tree={tree} share={share} />}", "tests": "test/docs-screen.test.tsx", "red": "1 failed (of 101): a leaf's actions read View on GitHub, Share, Open committed version, in that order (M4.SH8)"}
{"id": "W5S-T6-M4", "pkg": "pwa", "file": "test/control-census.test.ts", "old": "  'docs/DocsHead.tsx <button> docs-action docs-share':\n    \"TOKEN. Share (spec 4.16), after View on GitHub: a <button> wearing the header's link-action class, `.docs-action`, \"\n    + 'whose rule carries the floor.',\n", "new": "", "tests": "test/control-census.test.ts", "red": "1 failed (of 11): registers every one"}
{"id": "W5S-T8-M1", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "    </header>\n  );\n}\n", "new": "    </header>\n  );\n}\nexport const plantedShare = (): Promise<void> => navigator.share({ url: 'x' });\n", "tests": "test/docs-scans.test.ts", "red": "1 failed (of 69): M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard"}
{"id": "W5S-T8-M2", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "        <Notes notes={target.notes} />\n      </div>\n    </Sheet>\n  );\n}\n", "new": "        <Notes notes={target.notes} />\n      </div>\n    </Sheet>\n  );\n}\nexport const plantedCopy = (): Promise<void> => navigator.clipboard.writeText('x');\n", "tests": "test/docs-scans.test.ts", "red": "1 failed (of 69): M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard"}
{"id": "W5S-T8-M4", "pkg": "pwa", "file": "src/docs/share.ts", "old": "    notes,\n  };\n}\n", "new": "    notes,\n  };\n}\nexport const plantedState = (e: DocsTreeOk['entries'][number]): string | undefined => e.draft?.state;\n", "tests": "test/docs-scans.test.ts", "red": "3 failed (of 69): the Docs screen code reads no draft state; a file planted beside the real ones is found, by file and line; M4.T7 Share clause: the badge scan reads share.ts and ShareSheet.tsx, and finds no draft state"}
{"id": "W5S-T9-M1", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "  if (file.s !== 'ok') return readyAt(expected, null);\n  return samePin(file.pin, expected) ? readyAt(file.pin, file.answer.show) : updating;\n", "new": "  if (!samePin(file.pin, expected)) return updating;\n  return readyAt(file.pin, file.s === 'ok' ? file.answer.show : null);\n", "tests": "test/docs-share.test.ts, test/docs-screen.test.tsx", "red": "6 failed (of 167): a leaf whose read settled unreachable, then a same-blob re-list to C2: Share is enabled, not stuck Updating, and links C2; failed at the C1 pin under a C2 tree: ready at C2, with no answer; changing at the C1 pin under a C2 tree: ready at C2, with no answer; too-large at the C1 pin under a C2 tree: ready at C2, with no answer; unreachable at the C1 pin under a C2 tree: ready at C2, with no answer; auth at the C1 pin under a C2 tree: ready at C2, with no answer"}
{"id": "W5S-T9-M2", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "    sent.then(() => setShareFailed(false), refused);\n", "new": "    sent.then(undefined, refused);\n", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): a double tap: the second call is refused while the first is open, and the first finishing clears the notice"}
{"id": "W5S-T9-M3", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "  }, [copy, attempt]);\n", "new": "  }, [copy]);\n", "tests": "test/docs-share-sheet.test.tsx", "red": "1 failed (of 21): a second refused copy focuses and selects the field again, and announces the refusal anew"}
{"id": "W5S-T9-M4", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "return navigator.canShare(data) === true;", "new": "return false;", "tests": "test/docs-share-sheet.test.tsx test/tap-targets.test.tsx test/docs-screen.test.tsx", "red": "1 failed (of 210): test/docs-share-sheet.test.tsx > ... > offers Share… where navigator.canShare answers true, asking it about exactly what the sheet would share"}
{"id": "W5S-T9-M5", "pkg": "pwa", "file": "src/docs/ShareSheet.tsx", "old": "return navigator.canShare(data) === true;", "new": "return Boolean(navigator.canShare(data));", "tests": "test/docs-share-sheet.test.tsx test/tap-targets.test.tsx test/docs-screen.test.tsx", "red": "1 failed (of 210): test/docs-share-sheet.test.tsx > ... > offers no Share… where navigator.canShare answers something truthy that is not true"}
```

### Named, without a number

- The fallback field's font is `var(--text-input)`, not `var(--text-sm)`, so a field focused from script is not under the input floor (iOS zooms the page under it). The field draws no border, by refinement (e).
- The Share chrome's three sheet rules stay separate from `.docs-reader-sheet*` rather than grouped with them: grouping would edit W8a's rules and couple the two sheets. They are three rules of three declarations each.
- Three mutation rows were added for guards the plan's table left unproved: refinement (q)'s `other` arm (W5S-T3-M6), refinement (r)'s `pinFor` null arm (W5S-T3-M7) and `DocImage`'s loading gate (W5S-T4-M5).
- Task 9's other fixes (the settled-slot rule is in Deviations found): a share that finishes clears the notice a double tap left; a repeated refused Copy link focuses and selects the field again and is announced again; the raster case runs under a tree at another commit than its pin; no Share sentence may carry `fillSentence`'s `?`; the two guards' headers list what they do not see, and the colour guard reads `opacity`, `filter`, `box-shadow`, `accent-color` and `caret-color` too.

### Carried, not fixed

- The mode rule (`page.ref === null ? 'default' : 'ref'`) is now spelled in eight places; one exported `modeOf` in `docsTree.ts` is a follow-up.
- `shareStateFor`'s draft arms (a draft pin's `updating.to`, the raster draft-size side) have no case of their own.
- No screen case re-lists under a raster leaf; the mechanism (the image re-derives its pin from the tree) was read, not run.
- A re-list that remounts Share drops keyboard focus from it, and a sheet closed that way unmounts without returning focus.
- A one-frame "Updating to …" on every same-blob re-list; an `onRef` note can be stale when the served ref is renamed at the same commit.
- The fallback field's `select()` on iOS, and screen-reader announcements beyond the refusal alert, want a phone and a reader to measure.
- Each planted control of the M4.SH7 scan copies `pwa/src`; a Share rule inside an at-rule escapes the colour guard (listed in its header).
- After a double tap, a native sheet the reader cancels leaves the second tap's "Sharing did not finish." standing (the first call rejects with `AbortError`, which is ignored). The notice is literally true of the second tap, and Copy link still works.
