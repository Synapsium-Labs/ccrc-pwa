# Native Docs reader, wave 8a — the reader frame core Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 1 (2026-10-31): drafted from the W8a architecture at base `46da405e2170ad67b1471af77d8b2285059a09af` (`origin/main`, 2026-10-31 22:07Z). Waiting on the operator's review of this plan; nothing is dispatched.

**Scope:**
- In: the exact library pin and M7.9's in-place exception; the CI signature and provenance checks; the shell's `frame-src 'none'` meta; the render job on W4's `docsRunner`; the reader mounted through the library's `./host` with one ccrc adapter; the external-link and copy sheets; reader state under `ccrc:reader:v1:`; the plain view's images as `data:`; Mermaid gated and drawn on tap; the watchdog and the plain fallback; the precache split; the reader's source scans; real-browser rows M8.B1-M8.B6 and the worst-case measurement.
- Out: W8b (G5 "changes since", G6's version menu, `at=<sha>`, `only`, the seed's history), W5b, W6 (mockups, the asset planner, `MockupFrame`), W7 (README prose, carried residue), W5h-b, Export on the reader path, Mermaid auto-draw, the phone rows (E17, E18, M8.B7, M8.B8), and retiring the standalone docs server.

**Goal:** A Markdown leaf on the Docs screen opens in the rich reader: the shared Markdown library's `render()` runs in W4's parse worker under `DOCS_PARSE_BUDGET_MS`, and the library's own `mountDocFrame()` (`./host`) mounts the result in an opaque, script-hashed, network-less `srcdoc` frame, talking to ccrc over one checked port. Every failure lands on today's plain pipeline (`DocMarkdown`) with one fixed note. Done means W8a is live in ccrc (operator ruling (6)).

**Architecture:** ccrc writes no bridge, no `MessageChannel`, no message parser, no seed serialiser, no frame policy string and no `<iframe>`/`srcDoc` JSX. One L3 adapter, `pwa/src/docs/reader/bridge.ts`, is the only file that imports `@synapsium-labs/docserver/host`; it builds `HostAdapters` from ccrc's L1 decisions (`pwa/src/docs/reader/policy.ts`, which imports nothing from the library) and ccrc's ports (the storage port, the router, `copyText`, the image loaders, the asset loader). The render runs in the worker through a new job kind, behind one literal dynamic `import('./readerRenderJob')`, so the library's markdown-it, js-yaml and highlight.js land in a lazily loaded worker chunk the chat runner never loads. `ReaderFrame.tsx` (L4) renders a host `<div>`, runs the render, loads the plain view's images as `data:` URLs, then calls `mountReader`; any of seven triggers renders `DocMarkdown` instead. The shell gains exactly one CSP meta, `frame-src 'none'`. The library's asset texts arrive as `?raw` imports in `docs/reader/assets.ts`; Mermaid's is its own chunk, kept out of the precache by a `globIgnores` entry. ccrc's tests run the installed library copy, the code the bundle ships, and pin its constants, its frame policy and its asset hashes; the browser leg proves the walls.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`), React 19, Vite 8, vite-plugin-pwa (workbox `globPatterns` at `pwa/vite.config.ts#globPatterns`), vitest 4 on jsdom (no `Worker` global), the browser leg (`vitest.browser.config.ts`, `playwright-core` 1.64.1, Chrome from `CCRC_CHROME`); `@synapsium-labs/docserver` **1.0.0 exactly** (new dependency; its own exact pins: markdown-it 14.3.2, markdown-it-footnote 4.0.0, js-yaml 4.3.2, highlight.js 11.12.0, which equals the version already in ccrc's lock); Node `>=22.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (the rich-docs spec), as amended by this plan's spec amendment (its edits cover refinements (a)-(f), (i), (j) and (o); (g) and (h) stay plan-only departures): §3.1 (Host helper row), §3.6, §3.8, §4.1-§4.7, §5 (walls), §6's G7 row, §7's A1, A2b, A3, A5, A6, A7, A8, A9, A15, A17, A21, A22; §7.1's M8.1-M8.8, M8.10-M8.21 (M8.5 without its `changes` fixture); §7.2's M8.B1-M8.B6; labs E14-E16; §8's W8a row. With `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (the base spec): §4.9 (`DOCS_PARSE_BUDGET_MS`, the render gate), §4.10 (the worker, the timeout outcome, `DocMarkdown`), §4.11 (`resolveDocRef`, `imagePinFor`, the per-page image index), §5.1's walls, §5.6.1's shell meta (M5.19), §5.7 (the browser leg).

**Ledger:** `docs/superpowers/programs/native-docs-reader.md`, Waves row 8, which this plan's ledger PR splits into 8a (this plan) and 8b (after W5b), with the ruling below recorded under "Decisions & deviations".

**Operator ruling of 2026-10-31 ("defaults"), quoted as relayed:**

> (1) split W8: W8a, the frame core, runs now in parallel with W5h-a and Share; W8b (version menu G6, "changes since" G5, at=<sha>) follows W5b; W7 moves last. (2) Use the library's own ./host mount helper (mountDocFrame) unless the plan finds it conflicts with ccrc's architecture rules, in which case the plan says so before building and proposes the smallest conforming alternative. (3) Images: W8a carries the images the plain view already shows; mockups stay in W6. (4) Mermaid: inlined only for docs whose fences pass the gate, and drawn on tap (the library's on-request draw mode); auto-draw may follow after the operator's phone measurement. (5) Accept for now that the frame's colouring (library render(), its highlight.js) differs from the plain fallback's. (6) Done means W8a is live in ccrc; retiring the standalone docs server is a separate later gate.

**Ruling (2)'s finding, stated before any task:** `mountDocFrame` does **not** conflict with ccrc's architecture rules. Rings: it is called from one L3 adapter that an L4 component drives; every decision stays in an L1 file that imports nothing from the library; L0 is untouched. "An adapter may not narrow a distinction it received": the nine `FallbackReason`s are kept in component state and the console; only the shown note is one sentence, which the spec requires. "No overloaded null at a seam": where the storage port answers `null` ("no storage here"), the adapter omits `store`, which the library documents as one meaning, "nothing stored or seeded". The storage port: the library needs `key()` and `length`, which `StoragePort` lacks; a thin widening goes inside `pwa/src/lib/storage.ts`, the one storage owner, so the W7 storage census keeps its exact counts. Single definition: a ccrc L0 parser would be a second definition that nothing on the live path calls. Every §4.4 behaviour is a property of `mountDocFrame` 1.0.0 (the architecture's §2.1 table). What departs is ownership ("ccrc builds the frame"), not behaviour, recorded as refinement (b). The smallest conforming alternative, held in reserve and NOT built: a ccrc-owned mount on `./frame`'s `frameDocument` (the bridge, the parser and the limiter, about 600 lines the library already ships), the operator's call if Task 7 or Task 10 measures a library behaviour that differs from the architecture's §2.1.

**Format:** Markdown, by the operator's ruling of 2026-10-07. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 12's scratch tools parse this file's `### Task` headings and the JSON row fences each task's last step records.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (`gh` reads `GH_TOKEN` from its own environment; read-only `gh` verbs only). Every Docs test injects its loaders, its `parser`, its `render`, its `mount` and its `images`, or a `createApi(fetchImpl)`; no test reaches a real server. The browser leg serves fixture `/api` only (`pwa/browser/app.ts`).
- **FIXTURE HOME.** No task runs `ccd`. If any guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); never the live `$HOME`, and quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace (the fleet box's disk; operator ruling on disk-heavy exercises). The run installs `ui/`, `pwa/` and `server/` modules once, in its own workspace (`npm ci` in each). The only transient directories are the existing built-output tests' own `mkdtemp` builds, which they remove, and the browser leg's own build. Mutation rows are therefore measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/w8a-mut/<id>.orig` with its sha256, apply the row's `old`→`new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. A row whose `file` is under `pwa/node_modules/@synapsium-labs/docserver/` (its `dist/` or `assets/`) is restored the same way and its sha256 checked against the sha256 recorded at Task 1 Step 6. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/w8a-mut/` is removed at Task 12.
- **Scope.** W8a creates `pwa/src/lib/readerLimits.ts`, `pwa/src/lib/readerRenderJob.ts`, `pwa/src/docs/reader/{policy,readerText,images,assets,bridge}.ts`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/ReaderSheets.tsx`, `.github/ci/library-provenance.sh`, `pwa/test/{reader-pin,shell-csp,reader-render-job,reader-policy,reader-images,reader-assets,reader-bridge,reader-built}.test.ts`, `pwa/test/reader-frame.test.tsx` and `pwa/browser/reader-frame.browser.test.ts`. It edits `pwa/package.json`, `pwa/package-lock.json`, `pwa/index.html`, `pwa/vite.config.ts`, `pwa/src/lib/{markdownWorker,markdownRunner,storage,router}.ts`, `pwa/src/docs/{DocsLeaf,DocImage}.tsx`, `pwa/src/docs/docs.css`, `pwa/src/screens/DocsScreen.tsx`, `.github/workflows/ci.yml`, `server/test/docs-parity.test.ts` (M7.9's block only, in place), `server/test/ci-pipeline.test.ts`, `pwa/test/{markdown-runner,markdown-purity,markdown-worker-built,docs-scans,w7-storage-keys}.test.ts`, and this plan (Task 11 appends `## Deviations found`'s numbers, Task 12 appends `## W8a results`). Byte-identical: `shared/**`, `server/src/**`, `agent/**`, `ccd/**`, `deploy/**`, `ui/**`, `pwa/src/docs/share.ts`, `pwa/src/docs/DocMarkdown.tsx`, `pwa/src/lib/markdownLimits.ts`, `pwa/src/lib/markdownParse.ts`, `pwa/src/lib/markdownGuard.ts`, `README.md`, `server/test/census-w7/**`, every existing `pwa/test/docs-*.test.tsx`. Any other file is a stop-and-ask.
- **Base.** The child workspace is minted from `main` at or after `46da405e2170ad67b1471af77d8b2285059a09af`. Task 1 Step 0 runs a **content** check, not an ancestry check (`T1-BASE-OK` below), and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-10-31-native-docs-reader-w8a/progress.md`.
- **Rings and seams.** Every new `pwa/src` file states its ring in its header, which `pwaRing` decides (`server/test/rings/pwa-rings.test.ts`): L1 `docs/reader/policy.ts`, `docs/reader/readerText.ts`, `lib/readerLimits.ts` (imports nothing) and `lib/readerRenderJob.ts` (worker-side, imports only `./readerLimits`, `./markdownLimits`, `./markdownGuard`, types from `./markdownParse`, and the library's `./render`; on the main thread it is reached only through `import type`, Task 9's clause); L3 `docs/reader/bridge.ts`, `docs/reader/assets.ts`, `docs/reader/images.ts`; L4 `docs/ReaderFrame.tsx`, `docs/ReaderSheets.tsx`. No L1 file imports a `.tsx`, a store or `lib/api.ts`, and no L1 file other than `lib/readerRenderJob.ts` imports anything from the library. No timer handle is kept on an object field or at module scope outside L4. `shared/` gains nothing. No overloaded `null`: `readerDocKey` answers `null` for one condition only ("no per-doc state for this doc"); `enumerablePageStorage` answers `null` for one ("no storage here"); the render answer is a discriminated union, never `null`.
- **Library imports.** `@synapsium-labs/docserver/host` only in `docs/reader/bridge.ts`; `/render` only in `lib/readerRenderJob.ts`; `/assets/…?raw` only in `docs/reader/assets.ts`; `/frame` only under `docs/reader/`; the bare package, `/enhance`, `/highlight` and `/conformance` nowhere in `pwa/src`. `./host` and the asset strings reach the main bundle only through `ReaderFrame.tsx`'s one literal dynamic `import()` of each adapter file. Tests (`pwa/test`, `pwa/browser`) may import any subpath.
- **Exact values.** The spec's numbers are imported where they are declared, never restated in production code: `DOCS_PARSE_BUDGET_MS`, `DOCS_RENDER_GATE_BYTES` (`pwa/src/lib/markdownLimits.ts`), `DOCS_MAX_IMAGES_PER_PAGE` (`shared/docs.ts`). New caps are declared once in `pwa/src/lib/readerLimits.ts`: `READER_HTML_MAX_BYTES = 4194304`, `READER_IMAGE_BUDGET_BYTES = 5242880`, `READER_STORE_PREFIX = 'ccrc:reader:v1:'`. Tests pin the library's own constants against the spec's literal numbers (that is the point of those tests).
- **Never spelled by this wave** (W5 part 1's list, as it applies here): a quoted `x-ccrc-docs`; a second declaration of an L0 name or cap; a quoted section slug (derive it from `DOC_SECTIONS`); PNG magic bytes (call `sniffRaster`); redactor fragments; the standalone docs server's lower-case name or directory name **anywhere in `pwa/src` or `pwa/vite.config.ts` except as an exact allowed import specifier** (write "the shared Markdown library" in comments: M7.9 reds on the word in a comment, and its exception covers specifiers only); `repeat(<n>, 1fr)` in any stylesheet; the word `full` inside a `<Sheet>` tag; real host, user, project, pool, account or path names (use `demo`, `a`, `b`, `example-org/example-repo`, `you@example.com`, `https://a.example`); raw control bytes in fixtures (build them with `String.fromCharCode`); a `D-` number outside `## Deviations found`; a `D-TBD` token in any commit (`server/test/dtbd.test.ts`); `default-src 'none'`, `<iframe`, `srcDoc`, `srcdoc`, `postMessage(`, `MessageChannel` and `.onmessage` anywhere in `pwa/src/docs` (Task 9's scan), except Export's two allowances that A2b and M8.10 keep (`<iframe`/`srcDoc` in `docs/export/buildExport.tsx`, `default-src 'none'` in `docs/export/policy.ts`), by exact path; `addEventListener('message'` anywhere in `pwa/src`.
- **PUBLIC REPO.** `Synapsium-Labs/ccrc-pwa` is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 12 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Cite code by `file#symbol` or `file#@anchor`, never by line number (`anchors.test.ts`, `citations.test.ts`). Each Find block must match exactly once; if it is absent or matches twice, stop and ask the coordinator. A later task that re-spells anchored code re-anchors the earlier row under the same id.
- **File-shape invariants are judged NET against BASE.** Counts a step relies on are re-derived at that step, never carried from planning.
- **Text-scan guards** use the TypeScript AST (`ts.createSourceFile`), or list their known evasions in the header as "NOT EXHAUSTIVE" (lesson 8).
- **Built artefacts.** Anything visible only in the BUILT bundle (the meta surviving `vite build`, the Mermaid chunk out of `sw.js`, the asset texts in the chunks, the lazy render chunk) gets a production-build test that runs `vite build` in a node child, not in jsdom (`pwa/test/fonts-built.test.ts`'s `BUILDER` pattern). Never set a `CCRC_SW_DENYLIST` covering `/docs` in any PWA run's environment.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** below and records the measured rows as ONE JSON fence (`id`, `pkg`, `file`, `old`, `new`, `tests`, `red`) in the SDD ledger at its last step; Task 12 copies every fence into `## W8a results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `W8A-T<n>-M<k>`. Rows anchored in the installed library (`pkg: pwa`, `file: node_modules/@synapsium-labs/docserver/dist/...`) take their `old` text from the installed copy at that task's Step 0, because the plan cannot quote it from git.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, built-output tests, the browser leg) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `typecheck-tests`, `fleet-screen`, `session-hook`, `ccd-*`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. The browser leg is `( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts <file> )` and needs `CCRC_CHROME` as the brief gives it. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`.
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 11's last step defines them in `## Deviations found`. A session that cannot reach the allocator writes `D-TBD-<slug>` in its report only, never in a commit.
- **Open PRs touching this wave's files** (measured by the architect at planning; re-measured at dispatch and at each Step 0): #1610 (TypeScript 7) edits `pwa/package.json` and `pwa/package-lock.json`; #1615 (actions bump) edits `.github/workflows/ci.yml`. W5h-a and Share run in parallel and may touch `pwa/vite.config.ts`, `pwa/test/markdown-purity.test.ts`, `pwa/test/markdown-worker-built.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/src/docs/DocsLeaf.tsx` and `pwa/src/lib/markdownRunner.ts`. Export runs after W5h-a, beside W8a's window, and adds `docs/export/buildExport.tsx` and `docs/export/policy.ts`, which Task 9's clause allows by exact path (its allowance case passes whether or not those files exist yet, so neither PR reds the other on `main`). Whichever merges second takes `main` and re-measures (the lock is regenerated, never hand-merged).
- **Carried items** (the ledger's "Carried constraints (reviewers get these)", verbatim in substance; none is fixed here, each is deferred to its named wave):
  - W3's accepted residue: the fetch lane's generation map grows by one short entry per distinct project refreshed (session-gated, not safely prunable); `policy.ts`'s `lowerAscii` duplicates a private L0 helper, pinned by a parity case, for W7; the second redaction pass rewrites values, not key names (latent, the fix belongs to L3); the `JSON.parse` cost inside `ccdsource.ts` is deferred.
  - W2's parked minors are in its SDD ledger; none blocks.
  - SEC-3: a helper killed from outside leaves git's process group running; W2 pins the budget invariant; the real fix is unscheduled. SEC-4: fetch stamps accumulate, one per distinct branch name (W5 housekeeping). No stamp after a failed post-fetch for-each-ref (W5). `branch: null` covers both a detached HEAD and an unmeasured read (W2 adapter, W5 rendering).
  - `GithubTarget` and `resolveDocRef`'s `repo` kind (closed by W5 part 1's first L0 task). A commit missing from a partial clone answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on 2.55 (carried in W2's results). Over-cap `too-many-entries` reports `bytes` measured on a stripped body.
  - W7 prose residue: stale `ccrc-doctor-checks` citations in `ccd/ccrc` that predate W1; `deploy/account-op.mjs`'s stale citation; spec §7.2's two python3/placement sentences; the lockAgeMs prose; docs-shared's claim about two refinements; the dropped clause "git 2.43 ignores the key"; README's doctor table has no row for W1's `docs` check and its server-role SKIP sentence does not name `docs`; W4's two stale comments (`pwa/src/lib/api.ts`, `server/test/sourceScan.ts`); `ccd/ccrc-doctor-checks`' `auth box-token` table line; N1's docstring nits; review 5-2. **This wave adds one to W7's list: A22's README "rendering" bullet (refinement (j)).**
  - W2's one-reader scan residue (review 343): for the next wave that edits `docs-source.test.ts`, or W7. Not this wave.
  - W3 residue (review 364) and its W7 prose pass items: not this wave.
  - W4 residue for W5 (review 412, R1-R7) and W4's carried items (shape (c); the sync path's cost on a crafted message of 4 KiB or less; review 1-4; the 2-2 residual; N1's minors; M4.P12's "count only after render"; r10 and r11, highlight.js's half closed by W5h): inherited unchanged. W8a's reader path colours with `render()` under C24 inside `DOCS_PARSE_BUDGET_MS` in the worker; the plain fallback keeps part 1's bounds until W5h.
  - U5: the private vulnerability report is not filed yet.
- **Commits.** One per task (Task 11's fixes one per finding), files staged by name, message `<area>: <what> (docs W8a)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Task 12 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR, which also carries the spec amendment (its edits cover refinements (a)-(f), (i), (j) and (o), each edit marked "(amended 2026-10-31; …)"; (g) and (h) are plan-only departures whose spec sentences stay the target, as the amendment's "Not amended here, on purpose" list says), and the ledger's row 8 split into 8a and 8b with the operator's ruling of 2026-10-31 recorded under "Decisions & deviations". The child workspace therefore holds the amended spec and this plan; Task 11 and Task 12 append to this plan on the branch, and Task 12's PR body links its GitHub `blob/main` path.
- **The run row and the issued block.** The coordinator opens W8a's run row (`planned`) and is issued a contiguous deviation block by `POST /api/ledger/deviations` at run-open, at least seventeen numbers: eleven for the departing refinements (a)-(j) and (o), in that order, the rest for departures found while executing and fix rounds. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the base. W8b gets its own run row and block when it is planned, after W5b.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `pwa/package.json`, `pwa/package-lock.json`, `.github/workflows/ci.yml`, `server/test/ci-pipeline.test.ts`, `server/test/docs-parity.test.ts`, `pwa/index.html`, `pwa/vite.config.ts`, `pwa/src/lib/markdownRunner.ts`, `pwa/src/lib/markdownWorker.ts`, `pwa/src/lib/storage.ts`, `pwa/src/lib/router.ts`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/docs.css`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/markdown-runner.test.ts`, `pwa/test/markdown-purity.test.ts`, `pwa/test/markdown-worker-built.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/w7-storage-keys.test.ts`. A subagent edit outside the claim is the worker's to claim first.
- **The library is on the registry before dispatch.** The release PR's merge and the npm publish with the signed tag are separate operator steps, so the coordinator first runs, read-only, `npm view @synapsium-labs/docserver@1.0.0 version dist.integrity`: it must print `1.0.0` and a `sha512-` integrity. If it does not, nothing is dispatched; the coordinator asks the operator. Task 1 Step 0 repeats the check.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-12, the base, the issued block, the claim state, the open-PR state, `CCRC_CHROME`, and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers; an `opus` per-task reviewer; the whole-branch panel on `opus` (Task 11) with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill (kill only recorded PIDs), any `gh` write verb, any token in an argv, approval-prompting shell forms, and a `CCRC_SW_DENYLIST` covering `/docs`.
- **Worker flow:** the worker acks, runs Tasks 1-10 with native subagents, puts questions to the operator as structured asks, lists mail before every push and before its wave-done. Escalations to the operator: Task 2 if the GitHub attestation is absent; Task 10 if the measured worst case forces `READER_IMAGE_BUDGET_BYTES` below 2 MiB; any library behaviour that differs from the architecture's §2.1 table (do not patch around it: a difference argues for the reserve alternative, which is the operator's call). Task 11 is the held-out whole-branch review and its fix wave, after Task 10 and before the close. Task 12 closes: the suites, the invariants, the built-output tests, the browser file and the whole mutation table; it appends `## W8a results` (that commit is the `handoffCommit` and the tip), pushes the workspace branch, opens the ONE pull request, measures the fingerprint with that PR's number and `prPhase: 'open'`, and sends the wave-done. W8a edits `pwa/package.json`, the lock and `.github/`, so its PR runs the FULL server suite by design.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming five lenses: (1) the walls and the bridge (the frame attributes and policy as the installed library builds them, the handshake count, the shell meta, the browser battery and its controls, no window `message` listener); (2) rings, seams and no overloaded null (the adapter, the L1 decisions, the storage widening, `replaceFragment`, the render outcome union); (3) the test and mutation table, including the installed-`dist` rows and the in-workspace restore discipline; (4) build, precache and CI supply chain (the exact pin, M7.9's exception, `audit signatures`, the provenance identity check, the lazy chunks, `globIgnores`, the built-output tests); (5) spec and deviation fidelity (refinements (a)-(f), (i), (j) and (o) against the amended spec, (g) and (h) against this plan, each departure numbered once) plus the public-repo scan.
- **Merge gate:** the operator's review of this plan; the reviewer's report accepted by the coordinator; the PR's required checks green, including the full server suite its change set triggers; `browser (pwa)` green in the merge queue (a fast PR skips it, so grep its log before treating a green as a run). No R1/R2 gate: W8a changes no server route.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel). The coordinator or operator rolls it out fleet first (`ccrc rollout --to vX.Y.Z`; W8a is PWA-only, so fleet first holds). "Done" (ruling (6)) is measured on the server box: `/health`'s `version` equals the tag, and a Markdown doc opened on the Docs screen shows the reader (not the fallback note). Then the operator's phone steps E17 (M8.B7) and E18 (M8.B8); auto-draw for Mermaid is one adapter value after E17. W8b is planned after W5b; W7 runs last.

## Review Focus

The untrusted inputs a person meets first, each pinned in the task that owns it:

| Input | What could go wrong | Pinned by |
|---|---|---|
| A document built to break the render gate (over 512 KiB, a delimiter run, a pathological fence, an output blow-up) | The main thread freezes; a frame mounts over a refused doc | Task 4 (pre-scan first, `maxHtmlBytes`, the budget timer: W8A-T4-M1, M3, M4), Task 8 (no mount before the gate: W8A-T8-M1; timeout outcome with no second parse) |
| The rendered HTML inside the frame (author-controlled markup, hostile Mermaid init directives) | A network channel, a cookie, a popup, a top navigation, an injected style | Task 7 (M8.2's policy shape, the asset hashes: W8A-T7-M4, M9; W8A-T10-M6), Task 10 (M8.B1's 27 channels and its control, M8.B2-M8.B4, W8A-T10-M2) |
| Bridge messages from the frame (`navigate`, `copy`, `store.set`, `hash`, a stray `parent.postMessage`, a second `load`) | An in-app route to `/api/…`, a silent copy of a bidi control, a raw key in localStorage, a port that outlives its document | Task 5 (L1 routing and copy decisions: W8A-T5-M1-M3), Task 7 (the adapter key set and prefix: W8A-T7-M1-M3), Task 8 (sheets before `window.open` and before a hidden-character copy: W8A-T8-M4, M5), Task 10 (M8.B5, M8.6: W8A-T10-M1, M3) |
| Mermaid fences (count, size, a doc over the gate, the chunk failing offline) | Mermaid inlined for an ungated doc; a hard fallback when the chunk is missing | Task 7 (`MERMAID_GATE_DEFAULTS` pinned: W8A-T7-M5; M8.20's three caps through the adapter: W8A-T7-M12; `scan` dropped when the chunk rejects), Task 8 and Task 9 (Mermaid out of the precache: W8A-T9-M1), Task 10 (every figure drawn on tap, the hostile one included; M8.20 live) |
| Image refs (external, `repo`, above the root, past index 30, past 5 MiB, a space in a path) | A `blob:` or remote URL in the frame; a pin that differs from the plain view's | Task 6 (W8A-T6-M1-M4) |
| A library bump | Bridge behaviour changes under ccrc | Task 1 (exact pin: W8A-T1-M1), Task 2 (provenance identity, checked before any install script runs: W8A-T2-M1-M6), Task 7 (constants pinned) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/package.json`, `pwa/package-lock.json` | 1 | — | `"@synapsium-labs/docserver": "1.0.0"`, exact |
| `server/test/docs-parity.test.ts` | 1 | — | M7.9's block, in place: the library-specifier exception (A21, M8.18) |
| `pwa/test/reader-pin.test.ts` | 1 | — | The pin half of M8.12 and the single highlight.js |
| `.github/ci/library-provenance.sh` | 2 | — | Lock integrity equals the packed tarball; `gh attestation verify` against the library's repo and release workflow |
| `.github/workflows/ci.yml`, `server/test/ci-pipeline.test.ts` | 2 | — | `build-pwa`: provenance (right after `actions/setup-node`, before ui's and pwa's `npm ci`, so before any install script runs) → `npm ci` → `npm audit signatures` → `vite build` (M8.16; refinement (o)); the least-privilege comment and its FR-6 case name `build-pwa`; the existing 'typechecked once' case reads `vite build` as its own step |
| `pwa/index.html`, `pwa/test/shell-csp.test.ts` | 3 | — | The one shell meta, `frame-src 'none'` (M8.13, A3) |
| `pwa/src/lib/readerLimits.ts` | 4 | L1 | `READER_HTML_MAX_BYTES`, `READER_IMAGE_BUDGET_BYTES`, `READER_STORE_PREFIX` |
| `pwa/src/lib/readerRenderJob.ts` | 4 | L1 (worker) | `ReaderRenderJob`, `ReaderRenderOutcome`, `answerRenderJob` |
| `pwa/src/lib/markdownWorker.ts`, `pwa/src/lib/markdownRunner.ts` | 4 | L4/L3 as today | The `render` job kind; lazy job module |
| `pwa/test/reader-render-job.test.ts`, `markdown-runner`, `markdown-purity`, `markdown-worker-built` | 4 | — | A6, M8.21 |
| `pwa/src/docs/reader/policy.ts`, `readerText.ts` | 5 | L1 | Routing, copy decision, doc key, prefs, watchdog, body reducer; the words |
| `pwa/src/lib/storage.ts`, `pwa/src/lib/router.ts` | 5 | L3 | `EnumerableStoragePort`, `enumerablePageStorage`; `replaceFragment` |
| `pwa/test/reader-policy.test.ts` | 5 | — | M8.7, M8.19 decisions, R7, R13 |
| `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/reader/images.ts`, `pwa/test/reader-images.test.ts` | 6 | L4 / L3 | `planImageRef`, `rasterDataUrl`; `loadReaderImages` |
| `pwa/src/docs/reader/assets.ts`, `bridge.ts`, `pwa/test/reader-assets.test.ts`, `reader-bridge.test.ts`, `w7-storage-keys.test.ts` | 7 | L3 | Asset texts; `mountReader` over `mountDocFrame` (M8.2, M8.12, M8.15) |
| `pwa/src/docs/ReaderFrame.tsx`, `ReaderSheets.tsx`, `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs.css`, `pwa/vite.config.ts`, `pwa/test/reader-frame.test.tsx` | 8 | L4 | The leaf wiring, fallback, sheets (M8.7, M8.11, M8.17, M8.19); `globIgnores`, in the task that first makes the Mermaid chunk reachable |
| `pwa/test/docs-scans.test.ts`, `pwa/test/reader-built.test.ts` | 9 | — | Amended M8.10 (and M8.21's main-thread import rule); M8.13/M8.14/M8.12 built halves |
| `pwa/browser/reader-frame.browser.test.ts` | 10 | — | M8.B1-M8.B6, M8.1/3/4/6 on the live DOM, E14-E16, the worst case |

## Spec refinements (decided while planning)

Each refinement that contradicts the spec's text is a departure and gets one issued number in `## Deviations found` (Task 11's last step), in the order below. The spec amendment that the ledger PR carries edits the spec's own text for (a)-(f), (i), (j) and (o). (g) and (h) are plan-only departures: their spec sentences (§4.3's 2 MiB row, §4.4's link-sheet sentence) stay the target, as the amendment's "Not amended here, on purpose" list says.

- **(a) The W8 split (operator ruling (1)).** W8 becomes W8a (this plan) and W8b (G5, G6's version menu, `at=<sha>`, `only`, the seed's history, M8.9, M8.22, M8.5's `changes` fixture, M9.10), after W5b. W7 runs last. W8a's prerequisites are W5 part 1 and library v1 only; the W8 row's W5b, W6, W7 and W5h-b dependencies are relaxed. Amends RD24, the W8 row, Figure 3, A19, §4's "It lands in W8" and RD14's op counts (6 and 2 in W8a). **Departure.**
- **(b) `./host` with one thin adapter (operator ruling (2)).** See "Ruling (2)'s finding" above. ccrc mounts with `mountDocFrame`; it spells no frame policy, port, parser, seed or `<iframe>`. Amends §3.1's Host helper row, §3.8's CSP-hashes bullet, §4.1's Element row, §4.2's home bullet, §4.4's Checking bullet, §4.7 (table and bullets), A1, A2b, A5, A17, M8.5 (fixtures are the library's; ccrc pins its constants), M8.10 (the amended scan rule of Task 9), M8.12 (hashes pinned against the manifest and the bytes ccrc reads), RD14; M8.1, M8.3, M8.4, M8.6 and M8.8 now measure the installed library's output, and their mutations are planted in the installed `dist`. **Departure.**
- **(c) Mermaid drawn on tap is the default (operator ruling (4)).** `mermaidDraw: 'on-request'`; the spec's contingency `reader-mermaid-on-tap` becomes W8a's default without E17. The library's gate defaults (24 fences, 16 384 and 131 072 UTF-16 code units) are the spec's numbers and are pinned (the spec's "KiB" are measured in code units: a measurement note, not a departure). The watchdog carries no Mermaid allowance, because `ready` does not wait for Mermaid in on-request mode. **Departure.**
- **(d) Images: the plain view's, until W6 (operator ruling (3)).** A7's §5.6.3 planner does not exist on `main`. W8a loads exactly the images the plain view would show, through the plain view's own pin rule (`planImageRef`), as `data:` URLs, at most `DOCS_MAX_IMAGES_PER_PAGE` (30) and `READER_IMAGE_BUDGET_BYTES` (5 MiB); a deferred or over-budget image is the library's "not loaded" chip, whose link goes through `navigate`. W6's planner replaces the path wholesale. **Departure.**
- **(e) Colouring (operator ruling (5)).** (1) The reader colours with `render()` under C24 and the plain fallback as it does today: accepted for now. (2) The W8 row's "`highlight.js` 11.11.1 against 11.12.0, two copies" is measured resolved on `main`: ccrc's lock holds 11.12.0, the library's exact pin, and Task 1 pins exactly one copy. (3) The grammar sets differ (ccrc's has php; the library's has ini/toml, java, shell and plaintext): accepted. Requests (a) and (b) shipped in v1 (`./highlight`, `render()`'s `highlight` option); W8a imports neither. **Departure** (the row asked W8 to rule; the ruling accepts the divergence rather than closing it).
- **(f) W8a owns the shell meta.** M5.19's `frame-src 'none'` meta (W6) lands in W8a with M8.13's test; W6 references it rather than adding a second. **Departure.**
- **(g) The reader serves at most the base render gate.** A doc over `DOCS_RENDER_GATE_BYTES` (512 KiB) never mounts a frame; its "Format anyway" formats plain. §4.3's 2 MiB is the server's document cap. Keeps the srcdoc near lab E4's measured footing; Task 10 measures it. **Departure.**
- **(h) The link sheet highlights any host other than the console's own.** §4.4 says "a host whose registrable name differs from `CCRC_ORIGIN`'s"; `pwa/src` has no public-suffix data, so the sheet highlights any host other than `location.hostname` (stricter). **Departure.**
- **(i) Precache reading of M8.14 and A21.** The library's woff2 fonts are never emitted (they travel as `data:` inside its CSS), so M8.14's "lists the woff2 fonts" is read as "ccrc's own Geist woff2 still precached". Mermaid's entry is a chunk glob (`**/mermaid.frame-*.js`), not a directory, and names no library, so A21's `vite.config.ts` exception is unused and the config stays fully red for the name. **Departure.**
- **(j) A22's README bullet moves to W7.** W7 runs last so the README is written once; W8a edits no README. **Departure.**
- **(k) Seeded version (fills a silence).** W8a passes `document.version` as `{sha, draft}` only, and only when the served commit is full 40 or 64 hex; no `commits` and no `only` (W8b). Not a departure.
- **(l) The storage widening (fills a silence).** `EnumerableStoragePort` and `enumerablePageStorage()` inside `pwa/src/lib/storage.ts`, the one storage owner. Not a departure.
- **(m) Homes and chunks (fill silences).** The reader caps live in `pwa/src/lib/readerLimits.ts`, not `markdownLimits.ts` (W5h-a edits it in parallel) and not `shared/docs.ts` (PWA-side bounds); the render job is a lazy worker chunk; `./host` and the assets are lazy main-thread chunks. Not departures.
- **(n) `replaceFragment` without notify (fills a silence).** `onHash` rewrites the fragment with `history.replaceState(history.state, '', '#' + id)` and no router notify, so the body never remounts. Not a departure.
- **(o) Provenance before install (re-review of 2026-10-31).** M8.16 and §3.6 order `npm audit signatures` after `npm ci`, then the provenance identity check. W8a runs the identity check first, right after `actions/setup-node` and before ui's and pwa's `npm ci`, then `npm ci`, `npm audit signatures` and `vite build`: `npm ci` runs every installed package's lifecycle scripts, and a tarball published outside the library's release workflow could append to `GITHUB_PATH`/`GITHUB_ENV` and plant the `gh` and `openssl` the check then runs. Amends §3.6's CI check row and M8.16 (spec amendment entries 59-60). **Departure.**
- **Measurements, not departures:** Task 10's measured image budget (§4.3 directs it); Task 7's jsdom capability measurement; Task 2's attestation measurement.

### Task 1: Pin the shared Markdown library at exactly 1.0.0 and amend M7.9 in place (A21, M8.12 pin half, M8.18)

**Model routing:** `sonnet`, effort `high`. The judgment is in the specifier grammar: it must admit exactly the four import forms W8a uses and nothing that merely contains the word.

**Spec rows:** A21, M8.12 (pin half), M8.18; refinement (e)(2), (i).

**Files:**
- Modify: `pwa/package.json` (+1 dependency line), `pwa/package-lock.json` (regenerated by npm), `server/test/docs-parity.test.ts` (M7.9's block only, in place; plus one header sentence).
- Create: `pwa/test/reader-pin.test.ts`.
- Guards (not edited): `pwa/test/markdown-purity.test.ts` (its pins unchanged here), `server/test/single-definition/*`.

**Interfaces:** Consumes `m79Scan`, `M79_NAME`, `M79_PWA_CONFIG`, and the block's `swapped`, `added` and `textOf` helpers (`server/test/docs-parity.test.ts#m79Scan`). Produces `M79_LIBRARY_SPECIFIER` (a RegExp const in the same block).

**Decisions this task makes:** (1) The exception admits exactly: `@synapsium-labs/docserver/render`, `/frame`, `/host`, with no suffix; and `@synapsium-labs/docserver/assets/<path>?raw` with the suffix required, `<path>` in `[A-Za-z0-9._/-]+`. The bare package and every other subpath stay red here (Task 9's scan polices homes). (2) It applies to `pwa/src/` lines only; `M79_PWA_CONFIG` stays fully red (refinement (i)). (3) A specifier counts only as the quoted string right after `from` or `import(`, in either quote, the quotes matching. (None departs from the spec's text beyond (i).)

- [ ] **Step 0: Base, claims, counts.** Run:
  `git grep -q "export async function copyText" HEAD -- pwa/src/docs/share.ts && git grep -q "export const DOCS_RENDER_GATE_BYTES = 524288" HEAD -- pwa/src/lib/markdownLimits.ts && ! git grep -q "Content-Security-Policy" HEAD -- pwa/index.html && ! git grep -q "synapsium-labs" HEAD -- pwa/package.json && git grep -q '"node_modules/highlight.js"' HEAD -- pwa/package-lock.json && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Then, read-only: `npm view @synapsium-labs/docserver@1.0.0 version dist.integrity` — Expected: `1.0.0` and a `sha512-` integrity. If it fails (E404 or anything else), stop and ask the coordinator before claiming any file. Record BASE (`git rev-parse HEAD`) in `.superpowers/sdd/2026-10-31-native-docs-reader-w8a/progress.md`. Confirm the claims on `pwa/package.json`, `pwa/package-lock.json`, `server/test/docs-parity.test.ts`. Measure and record: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )`'s total.
- [ ] **Step 1: Write `pwa/test/reader-pin.test.ts`.** One `describe('W8a: the shared Markdown library is pinned exactly (M8.12, pin half)')` with five cases, reading files with `node:fs` from `path.join(import.meta.dirname, '..')`:
  1. `'pwa/package.json pins @synapsium-labs/docserver at exactly 1.0.0'`: `expect(pkg.dependencies['@synapsium-labs/docserver']).toBe('1.0.0')`, and `expect(pkg.devDependencies?.['@synapsium-labs/docserver']).toBeUndefined()`.
  2. `'the lock root and its node_modules entry carry 1.0.0 with a sha512 integrity'`: `lock.packages[''].dependencies['@synapsium-labs/docserver'] === '1.0.0'`; `lock.packages['node_modules/@synapsium-labs/docserver'].version === '1.0.0'`; its `integrity` matches `/^sha512-[A-Za-z0-9+/]+=*$/`; its `resolved` starts with `https://registry.npmjs.org/@synapsium-labs/docserver/-/docserver-1.0.0.tgz`.
  3. `'the installed package reports version 1.0.0'`: `node_modules/@synapsium-labs/docserver/package.json`'s `version === '1.0.0'`.
  4. `'the installed assets manifest is 1.0.0 with bridge protocol 1'`: `node_modules/@synapsium-labs/docserver/assets/assets.json`: `manifest === 1`, `package === '@synapsium-labs/docserver'`, `version === '1.0.0'`, `bridgeProtocol === 1`.
  5. `'the lock holds exactly one highlight.js, at 11.12.0'`: the keys of `lock.packages` ending in `node_modules/highlight.js` are exactly `['node_modules/highlight.js']`, and its `version === '11.12.0'`.
- [ ] **Step 2: Write M7.9's new cases, in place** inside `m79Vitest.describe('M7.9: the tree does not know a standalone docs server', …)`, after its last existing case, each built with `added(swapped(<pwa/src file>, <text>))` exactly as the existing planted controls are (a planted line appended to `textOf('pwa/src/app.tsx')`):
  1. `'M8.18: a /frame import specifier in pwa/src is not a hit'` — appends `import { frameCsp } from '@synapsium-labs/docserver/frame';` → `toEqual([])`.
  2. `'M8.18: /host and /render import specifiers in pwa/src are not hits'` — appends `import { mountDocFrame } from '@synapsium-labs/docserver/host';` and `const r = await import('@synapsium-labs/docserver/render');` → `toEqual([])`.
  3. `'M8.18: an /assets ?raw dynamic import specifier in pwa/src is not a hit'` — appends `const g = await import("@synapsium-labs/docserver/assets/frame/guard.js?raw");` → `toEqual([])`.
  4. `'M8.18: the word in a pwa/src comment is a hit'` — appends `// the ` + M79_NAME + ` mount` → one violation naming the line.
  5. `'M8.18: the specifier in a string that is not an import is a hit'` — appends `const s = '@synapsium-labs/docserver/frame';` → one violation.
  6. `'M8.18: another scope is a hit'` — appends `import x from '@other/docserver/frame';` → one violation.
  7. `'M8.18: a longer name is a hit'` — appends `import x from '@synapsium-labs/docserverx/frame';` → one violation.
  8. `'M8.18: a trailing comment after an allowed import is a hit'` — appends `import { frameCsp } from '@synapsium-labs/docserver/frame'; // ` + M79_NAME → one violation.
  9. `'M8.18: /frame?raw is a hit'` — appends `const f = await import('@synapsium-labs/docserver/frame?raw');` → one violation.
  10. `'M8.18: the bare package specifier is a hit'` — appends `import * as d from '@synapsium-labs/docserver';` → one violation.
  11. `'M8.18: an allowed specifier in pwa/vite.config.ts is still a hit'` — appends `import { frameCsp } from '@synapsium-labs/docserver/frame';` to `M79_PWA_CONFIG` → one violation.
  Each "is a hit" case asserts the exact violation string the block's existing form produces (`<file>:<line>: the standalone server's name in the PWA`), with the line number computed from `textOf(...).split('\n').length + 1` as the existing `cfgN` case does.
  Add one sentence to the file's header comment, after "APPEND ONLY.": `W8a edits M7.9's block in place for the shared Markdown library's import specifiers (rich-docs spec A21, M8.18): the one exception to append-only, recorded in its plan.`
- [ ] **Step 3: Run to verify they fail.**
  Run: `( cd pwa && ./node_modules/.bin/vitest run test/reader-pin.test.ts )`
  Expected: `Tests  4 failed | 1 passed (5)`: cases 1-4 fail (the dependency is absent); case 5 pins today's lock, which already holds exactly one highlight.js at 11.12.0, so it stays green.
  Run: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )`
  Expected: exactly 3 failed (cases 1-3: the word is refused everywhere today); cases 4-11 are green before code, because the base refuses every occurrence; Step 0's count plus 11 in total.
- [ ] **Step 4: Implement.**
  - Install: `( cd pwa && npm install --save-exact @synapsium-labs/docserver@1.0.0 )`. Check `git diff --stat pwa/package.json` shows one added line, and that `npm` changed no other dependency's version (`git diff pwa/package-lock.json | grep '^[-+]\s*"version"'` shows only the new entries). If npm rewrote any other entry, stop and ask.
  - In M7.9's block, declare beside `M79_NAME`: `const M79_LIBRARY_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])@synapsium-labs\/docserver\/(?:render|frame|host|assets\/[A-Za-z0-9._\/-]+\?raw)\2/g;` with a comment naming A21 and refinement (i).
  - In `m79Scan`, in the per-line loop, for a line of a file that `startsWith('pwa/src/')` only, compute `const checked = line.replace(M79_LIBRARY_SPECIFIER, '$1$2$2')` and run the existing lower-case `M79_NAME` check on `checked` instead of `line`. `M79_PWA_CONFIG` lines keep the unmodified check. The directory needle (`M79_DIR`) is unchanged.
- [ ] **Step 5: Run to verify they pass.** Both commands of Step 3. Expected: `reader-pin` `Tests  5 passed (5)`; `docs-parity` all green, Step 0's count plus 11.
- [ ] **Step 6: Guard suites.**
  Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-purity.test.ts )` — Expected: unchanged count, all green (its pins are untouched).
  Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` — Expected: `TSC-OK`.
  Record in the SDD ledger the sha256 of every installed library file a later row plants in: `pwa/node_modules/@synapsium-labs/docserver/dist/host/mount.js`, `dist/host/store.js`, `dist/frame/gate.js`, `dist/frame/csp.js`, `dist/frame/document.js`, `dist/frame/seed.js` and `assets/frame/guard.js` (the restore checks of later installed-library rows).
- [ ] **Step 7: Commit.**
  ```bash
  git add pwa/package.json pwa/package-lock.json pwa/test/reader-pin.test.ts server/test/docs-parity.test.ts
  git diff --cached --name-only | wc -l   # expect 4
  git commit -m "pwa: pin the shared Markdown library at exactly 1.0.0; M7.9 admits its import specifiers (docs W8a)" \
    -m "M7.9's block is edited in place (rich-docs spec A21, M8.18): in pwa/src only, the exact specifiers /render, /frame, /host and /assets/...?raw after from or import( are removed before the name check; every other occurrence, and anything in vite.config.ts, stays red." \
    -m "Co-Authored-By: <trailer from the dispatch>"
  ```

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T1-M1 | pwa | `package.json` | `"@synapsium-labs/docserver": "1.0.0"` → `"@synapsium-labs/docserver": "^1.0.0"` | `test/reader-pin.test.ts` | 1 failed — `'pwa/package.json pins @synapsium-labs/docserver at exactly 1.0.0'` |
| W8A-T1-M2 | server | `test/docs-parity.test.ts` | `@synapsium-labs\/docserver\/(?:` → `@[a-z-]+\/docserver\/(?:` | `test/docs-parity.test.ts` | 1 failed — `'M8.18: another scope is a hit'` |
| W8A-T1-M3 | server | `test/docs-parity.test.ts` | `line.replace(M79_LIBRARY_SPECIFIER, '$1$2$2')` → `(M79_LIBRARY_SPECIFIER.test(line) ? '' : line)` | `test/docs-parity.test.ts` | 1+ failed — `'M8.18: a trailing comment after an allowed import is a hit'` |
| W8A-T1-M4 | server | `test/docs-parity.test.ts` | `(?:render\|frame\|host\|assets` → `(?:render\|frame(?:\?raw)?\|host\|assets` | `test/docs-parity.test.ts` | 1 failed — `'M8.18: /frame?raw is a hit'` |
| W8A-T1-M5 | server | `test/docs-parity.test.ts` | the `startsWith('pwa/src/')` guard on the replacement → `true` | `test/docs-parity.test.ts` | 1 failed — `'M8.18: an allowed specifier in pwa/vite.config.ts is still a hit'` |

(The measured `old`/`new` of every row are recorded verbatim in the task's JSON fence at Step 7.)

**Verify:**
- `( cd pwa && ./node_modules/.bin/vitest run test/reader-pin.test.ts )` — Expected: 5 passed.
- `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )` — Expected: all passed.
- `( cd pwa && ./node_modules/.bin/vitest run test/markdown-purity.test.ts )` — Expected: unchanged, all passed.
- `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` — Expected: `TSC-OK`.

### Task 2: Supply chain in CI — registry signatures and the library's provenance identity in `build-pwa` (M8.16)

**Model routing:** `sonnet`, effort `high`. The judgment is in the identity check: a valid signature alone would pass a package published from someone else's repo.

**Spec rows:** M8.16; §3.6.

**Files:**
- Create: `.github/ci/library-provenance.sh` (mode 755).
- Modify: `.github/workflows/ci.yml` (the `build-pwa` job, and the top "Least privilege, stated rather than inherited" comment, which gains `build-pwa`), `server/test/ci-pipeline.test.ts` (one appended describe, and two existing cases edited in place: the FR-6 case `'the least-privilege comment names every job that asks for more than contents: read (FR-6)'` for `build-pwa`, and `'pwa is typechecked once per run: test (pwa) runs tsc, build-pwa runs vite build alone'` for the split step).

**Interfaces:** Consumes the `build-pwa` job's pwa step (`run: npm ci && ./node_modules/.bin/vite build`). Produces the script's exit code (0 verified; non-zero on any mismatch or verification failure).

**Decisions this task makes:** (1) The repo and workflow constants live once, in the script. (2) The script takes no argument that changes the repo or workflow (the negative measurement calls `gh attestation verify` directly). (3) No `continue-on-error`: an attestation outage reds `build-pwa`, and the remedy is a re-run. (4) `deploy/build-release.sh` keeps `npm ci --no-audit`; the lock's sha512 ties the release build to the bytes CI checked. (5) The provenance step runs FIRST in `build-pwa`, right after `actions/setup-node` and before ui's and pwa's `npm ci`: `npm ci` runs every installed package's lifecycle scripts, and a tarball published outside the library's release workflow could append to `GITHUB_PATH`/`GITHUB_ENV` and plant the `gh` and `openssl` the check then runs. The script needs only node, `npm pack`, `openssl`, `gh` and `pwa/package-lock.json`, never `node_modules`. (6) The verify call also pins the source ref (`--source-ref "refs/tags/v$version"`) and refuses self-hosted runners (`--deny-self-hosted-runners`). (7) `build-pwa`'s own `permissions:` block makes it a sixth job in ci.yml's least-privilege census: the top comment names it and why, and FR-6 checks it against its own block. (Decision (5) departs from M8.16's and §3.6's order: refinement (o).)

- [ ] **Step 0: Base and claims.** `git grep -q "run: npm ci && ./node_modules/.bin/vite build" HEAD -- .github/workflows/ci.yml && test ! -e .github/ci/library-provenance.sh && git grep -q '"@synapsium-labs/docserver": "1.0.0"' HEAD -- pwa/package.json && echo T2-BASE-OK`. Expected `T2-BASE-OK`. Confirm claims on `ci.yml` and `ci-pipeline.test.ts`; re-check #1615's state. **Measure the attestation exists:** `npm pack @synapsium-labs/docserver@1.0.0 --pack-destination "$HOME/.cc-tmp/w8a-mut"` then `gh attestation verify "$HOME/.cc-tmp/w8a-mut/synapsium-labs-docserver-1.0.0.tgz" --repo Synapsium-Labs/docserver --signer-workflow Synapsium-Labs/docserver/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners` (read-only; `GH_TOKEN` from the environment). If it verifies without the last two flags but not with them, stop and ask the coordinator (the attestation's ref or runner differs from Decision (6)). If it does not verify at all, stop and put a structured ask to the operator (fallback named in the brief: `npm audit signatures` plus `npm view --json dist.attestations`'s SLSA predicate repository). Record the result.
- [ ] **Step 1: Write the failing test.** Append `describe('M8.16: build-pwa verifies the shared Markdown library before it builds', …)` to `server/test/ci-pipeline.test.ts`, reading `ci.yml` the way the file's existing describes do (its own YAML reader), with cases:
  1. `'build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build'` — the `build-pwa` steps whose `working-directory` is `pwa` or whose `run` names the script have `run` values, in order, exactly `bash .github/ci/library-provenance.sh`, `npm ci`, `npm audit signatures`, `./node_modules/.bin/vite build`; the provenance step is the first step after `actions/setup-node`, and no `build-pwa` step before it runs `npm ci` (ui's included), `npm install` or any other install; each carries `if: env.CCRC_LEG == 'run'`; none carries `continue-on-error`.
  2. `'build-pwa grants attestations: read and gives GH_TOKEN to the provenance step only'` — the job's `permissions` equal `{ contents: 'read', attestations: 'read' }`; the provenance step's `env.GH_TOKEN` is `${{ github.token }}`; no other `build-pwa` step has an `env.GH_TOKEN`.
  3. `'the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text'` — the script holds the lines `REPO=Synapsium-Labs/docserver` and `SIGNER=Synapsium-Labs/docserver/.github/workflows/release.yml`, each exactly once, and exactly one verify line holding `gh attestation verify "$tgz" --repo "$REPO" --signer-workflow "$SIGNER" --source-ref "refs/tags/v$version" --deny-self-hosted-runners`; it starts with `#!/usr/bin/env bash` and `set -euo pipefail`, and its mode has the owner execute bit.
  4. `'the provenance script compares the packed tarball sha512 with the lock integrity before it verifies the attestation'` — the script reads `node_modules/@synapsium-labs/docserver`'s `integrity` from `pwa/package-lock.json`, the index of the integrity comparison is less than the index of `gh attestation verify`, and the comparison exits non-zero on inequality (`exit 1` in its else-branch).
  5. `'no other file under .github names the release signer workflow'` — the files listed by `git ls-files --cached --others --exclude-standard -- .github` (the form `docs-parity.test.ts`'s `m79Files` uses, so the untracked script counts before Step 6's `git add`) that contain `docserver/.github/workflows/release.yml` are exactly `['.github/ci/library-provenance.sh']`.
  Edit FR-6 in place: `own` gains `'build-pwa'` (`['build-pwa', 'fast-plan', 'macos', 'macos-probe', 'map-build', 'select']`); the per-job loop checks `build-pwa` against its own block (`/^ {4}permissions:\n {6}contents: read\n {6}attestations: read\n(?! {6}[a-z-]+:)/m`) and every other job against the existing `contents: read` + `actions: read` block; the comment check reads `'Six jobs ask for more than this'`. Edit `'pwa is typechecked once per run: test (pwa) runs tsc, build-pwa runs vite build alone'` in place: its `/^ {8}run: npm ci && \.\/node_modules\/\.bin\/vite build$/m` becomes `/^ {8}run: \.\/node_modules\/\.bin\/vite build$/m`; its not-`npm run build` and not-`tsc --noEmit` checks stay.
- [ ] **Step 2: Run to verify they fail.** `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts )` — Expected: 7 failed (the five new cases, the edited FR-6 and the edited 'typechecked once' case, whose new regex needs the split step), every other existing case green.
- [ ] **Step 3: Implement.**
  - `.github/ci/library-provenance.sh`: header comment naming M8.16, §3.6 and why it runs before `npm ci` (Decision (5)) (it may name the package; `.github/` is outside M7.9's roots). Body: `set -euo pipefail`; `REPO=Synapsium-Labs/docserver`; `SIGNER=Synapsium-Labs/docserver/.github/workflows/release.yml`; read `version` and `integrity` of `packages["node_modules/@synapsium-labs/docserver"]` from `pwa/package-lock.json` with `node -e` (fail if either is missing); `dest=$(mktemp -d "${RUNNER_TEMP:-/tmp}/lib-prov.XXXXXX")`; `npm pack "@synapsium-labs/docserver@$version" --pack-destination "$dest" --silent`; `tgz="$dest/synapsium-labs-docserver-$version.tgz"`; `actual="sha512-$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)"`; if `actual != integrity`, print both and `exit 1`; then `gh attestation verify "$tgz" --repo "$REPO" --signer-workflow "$SIGNER" --source-ref "refs/tags/v$version" --deny-self-hosted-runners`; print one success line. The script runs from the repo root and never reads `node_modules`.
  - `ci.yml` `build-pwa`: add a job-level `permissions:` block in block form (`permissions:` alone on its line, four spaces in, then `contents: read` and `attestations: read`, six spaces in), the form FR-6's `own` filter (`/^ {4}permissions:$/m`) and its per-job check read; a one-line flow map would drop `build-pwa` out of `own`. Insert the provenance step (`if: env.CCRC_LEG == 'run'`, at the repo root, `run: bash .github/ci/library-provenance.sh`) right after the `actions/setup-node` step and before the `working-directory: ui` `npm ci` step, with its `env:` in block form (`env:` on its own line, then `GH_TOKEN: ${{ github.token }}`), as the file's other steps write it. Then split the pwa step into three `if: env.CCRC_LEG == 'run'` steps with `working-directory: pwa`: `npm ci`; `npm audit signatures`; `./node_modules/.bin/vite build`; keeping the existing comments above the split step. In the top "Least privilege, stated rather than inherited" comment, "Five jobs ask for more than this" becomes "Six jobs ask for more than this", and the census gains `` `build-pwa` `` with its reason: it asks for `contents: read` plus `attestations: read` (not `actions: read`), to verify the shared Markdown library's GitHub attestation before it installs it (M8.16); the comment's "each for exactly `contents: read` plus `actions: read`" is reworded so it holds of the other five and names `build-pwa`'s different pair.
- [ ] **Step 4: Run to verify they pass.** Step 2's command. Expected: all green.
- [ ] **Step 5: Manual measurement (recorded in results, not a unit test: it needs the network).** From the workspace root: `bash .github/ci/library-provenance.sh` → exit 0. Then the negative: `gh attestation verify "$HOME/.cc-tmp/w8a-mut/synapsium-labs-docserver-1.0.0.tgz" --repo Synapsium-Labs/ccrc-pwa --signer-workflow Synapsium-Labs/docserver/.github/workflows/release.yml; echo "rc=$?"` → a non-zero rc. Record both lines (no token in any argv or output).
- [ ] **Step 6: Commit.** `git add .github/ci/library-provenance.sh .github/workflows/ci.yml server/test/ci-pipeline.test.ts` (expect 3), message `ci: build-pwa checks registry signatures and the shared library's provenance identity (docs W8a)` with a body naming M8.16 and the trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T2-M1 | server | `../.github/workflows/ci.yml` | the `run: npm audit signatures` step → deleted | `test/ci-pipeline.test.ts` | 1 failed — `'build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build'` |
| W8A-T2-M2 | server | `../.github/ci/library-provenance.sh` | `REPO=Synapsium-Labs/docserver` → `REPO=example-org/docserver` | `test/ci-pipeline.test.ts` | 1 failed — `'the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text'` |
| W8A-T2-M3 | server | `../.github/ci/library-provenance.sh` | the integrity comparison block → deleted | `test/ci-pipeline.test.ts` | 1 failed — `'the provenance script compares the packed tarball sha512 with the lock integrity before it verifies the attestation'` |
| W8A-T2-M4 | server | `../.github/workflows/ci.yml` | the provenance step moved after the `npm ci` step | `test/ci-pipeline.test.ts` | 1 failed — `'build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build'` |
| W8A-T2-M5 | server | `../.github/workflows/ci.yml` | `` `build-pwa` `` removed from the least-privilege comment | `test/ci-pipeline.test.ts` | 1 failed — `'the least-privilege comment names every job that asks for more than contents: read (FR-6)'` |
| W8A-T2-M6 | server | `../.github/ci/library-provenance.sh` | ` --source-ref "refs/tags/v$version"` → removed | `test/ci-pipeline.test.ts` | 1 failed — `'the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text'` |

**Verify:** `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts )` — Expected: all passed. The PR's change under `.github/` runs the full server suite (the selection rule), as expected.

### Task 3: The shell's one CSP meta, `frame-src 'none'` (A3, M8.13 source half; refinement (f))

**Model routing:** `sonnet`, effort `medium`. Little judgment: placement before the first script.

**Spec rows:** A3, M8.13 (source half; the built half is Task 9), base M5.19; refinement (f).

**Files:** Modify `pwa/index.html` (+1 line, after the viewport meta). Create `pwa/test/shell-csp.test.ts`.

**Decisions:** The meta is `<meta http-equiv="Content-Security-Policy" content="frame-src 'none'" />`, inserted on the line after `<meta name="viewport" …>`, before every `<style>` and `<script>`. (None departs beyond (f).)

- [ ] **Step 0:** `! git grep -qi "content-security-policy" HEAD -- pwa/index.html pwa/src ':!pwa/src/docs/export' && git grep -q 'name="viewport"' HEAD -- pwa/index.html && echo T3-BASE-OK` (Export's page under `pwa/src/docs/export/` may carry its own CSP, so it is excluded). Claim `pwa/index.html`. Grep `pwa/test` for suites that read `index.html` (`git grep -l "index.html" HEAD -- pwa/test`) and record them as this task's guard suites.
- [ ] **Step 1: Write `pwa/test/shell-csp.test.ts`**, parsing `pwa/index.html` with jsdom's `DOMParser` (`'text/html'`), one `describe('M8.13: the shell carries exactly one CSP meta, frame-src none')`:
  1. `'index.html holds exactly one Content-Security-Policy meta'` — `[...doc.querySelectorAll('meta')].filter((m) => (m.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy')` has length 1.
  2. `'its policy re-tokenised is exactly frame-src none'` — split `content` on `;`, trim, drop empties, split each on ASCII white space: `toEqual([['frame-src', "'none'"]])`.
  3. `'it names no script-src, default-src, style-src or font-src'` — requires the one meta (fails if absent), then no directive name in that set.
  4. `'it precedes the first script and the first style'` — in `doc.head.children`, the meta's index is below the first `SCRIPT`'s and the first `STYLE`'s.
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/shell-csp.test.ts )` — Expected: `Tests  4 failed (4)`.
- [ ] **Step 3: Implement** the one line.
- [ ] **Step 4: Run to verify they pass**, then the guard suites found at Step 0 and `test/fonts-built.test.ts` alone (it builds). Expected: all green; the inline pre-paint scripts are unaffected (the meta has no `script-src`, A3).
- [ ] **Step 5: Commit.** `git add pwa/index.html pwa/test/shell-csp.test.ts` (expect 2), message `pwa: the shell carries one CSP meta, frame-src 'none' (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T3-M1 | pwa | `index.html` | `content="frame-src 'none'"` → `content="frame-src 'none'; script-src 'self'"` | `test/shell-csp.test.ts` | 2 failed — `'its policy re-tokenised is exactly frame-src none'`; `'it names no script-src, default-src, style-src or font-src'` |
| W8A-T3-M2 | pwa | `index.html` | the meta line → the meta line twice | `test/shell-csp.test.ts` | 1+ failed — `'index.html holds exactly one Content-Security-Policy meta'` |
| W8A-T3-M3 | pwa | `index.html` | the meta moved to the line before `</head>` | `test/shell-csp.test.ts` | 1 failed — `'it precedes the first script and the first style'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/shell-csp.test.ts )` — Expected: 4 passed. `( cd pwa && ./node_modules/.bin/vitest run test/fonts-built.test.ts )` alone — Expected: unchanged, all passed.

### Task 4: The render job on `docsRunner`, in a lazy worker chunk (A6, M8.21; refinement (m))

**Model routing:** `sonnet`, effort `high`. The judgment is in sharing the runner's queue, budget and terminate without changing a parse job's post shape or `ParseOutcome`.

**Spec rows:** A6, M8.21, §4.3's "Rendered HTML" row, base §4.10 (worker, timeout outcome).

**Files:**
- Create: `pwa/src/lib/readerLimits.ts`, `pwa/src/lib/readerRenderJob.ts`, `pwa/test/reader-render-job.test.ts`.
- Modify: `pwa/src/lib/markdownWorker.ts`, `pwa/src/lib/markdownRunner.ts`, `pwa/test/markdown-runner.test.ts` (appended cases), `pwa/test/markdown-purity.test.ts` (`ROOTS` gains two entries (Step 6) and `ALLOWED_PACKAGES` one (Step 3), plus one case), `pwa/test/markdown-worker-built.test.ts` (appended cases).
- Guards (not edited): `pwa/src/lib/markdownParse.ts` (`ParseOutcome` keeps its eight arms), `pwa/src/lib/markdownLimits.ts`.

**Interfaces:**
- Consumes `answerMarkdownJob`, `MarkdownJob`, `MarkdownReply`, `ParseOutcome` (`pwa/src/lib/markdownParse.ts`), `prescanMarkdown` (`pwa/src/lib/markdownGuard.ts`), `createMarkdownRunner`, `WorkerLike`, `docsRunner` (`pwa/src/lib/markdownRunner.ts`), and the library's `render(src, {maxBytes, maxHtmlBytes})` and `scanRefs(src, {maxBytes})` (`@synapsium-labs/docserver/render`).
- Produces:
  ```ts
  // pwa/src/lib/readerLimits.ts (L1, imports nothing)
  export const READER_HTML_MAX_BYTES = 4194304;
  export const READER_IMAGE_BUDGET_BYTES = 5242880;
  export const READER_STORE_PREFIX = 'ccrc:reader:v1:';
  // pwa/src/lib/readerRenderJob.ts (L1, worker side)
  export interface ReaderRenderJob { readonly id: number; readonly kind: 'render'; readonly src: string }
  export type ReaderRenderOutcome =
    | { kind: 'rendered'; result: { outcome: 'rendered'; html: string; meta: { title: string | null; frontList: …; headings: …; figures: number; mermaidKinds: readonly string[] } };
        mermaid: { fences: number; largestBytes: number; totalBytes: number; largestChars: number; totalChars: number };
        images: readonly string[]; imagesTruncated: boolean }
    | Extract<ParseOutcome, { kind: 'refused' }>
    | { kind: 'not-rendered'; why: 'over-limit' | 'output-over-limit' | 'failed' }
    | Extract<ParseOutcome, { kind: 'threw' | 'timeout' | 'worker-unavailable' | 'worker-failed' }>;
  export interface ReaderRenderReply { readonly id: number; readonly outcome: ReaderRenderOutcome }
  export function answerRenderJob(data: unknown, post: (reply: ReaderRenderReply) => void): void;
  // pwa/src/lib/markdownRunner.ts
  export interface MarkdownRunner { …; readonly render: (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome> }
  ```
  The `meta` types are the library's `RenderMeta` fields, imported as types from `@synapsium-labs/docserver/render` in `readerRenderJob.ts` only.

**Decisions this task makes:** (1) `answerRenderJob` runs `prescanMarkdown(src)` first; a refusal answers ParseOutcome's own `refused` arm (no second spelling of its fields). (2) Then `render(src, {maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES})`; a non-`rendered` outcome answers `not-rendered` with the library's outcome as `why`; then `scanRefs(src, {maxBytes: DOCS_RENDER_GATE_BYTES})`. (3) The worker routes on `kind === 'render'` through ONE literal `import('./readerRenderJob')`, cached in a module-level promise inside the worker; every other message goes to `answerMarkdownJob` unchanged. (4) The runner's `Job` gains `kind: 'parse' | 'render'`; a parse job still posts exactly `{id, src, profile}`; a render job posts exactly `{id, kind: 'render', src}`; both share the FIFO, the budget timer, terminate-and-respawn, abort and dispose. (5) `ParseOutcome` is unchanged (8 arms). (None departs from the spec's text.)

- [ ] **Step 0:** `git grep -q "worker.onmessage = (e) => answerMarkdownJob" HEAD -- pwa/src/lib/markdownWorker.ts && git grep -q "w.postMessage({ id: job.id, src: job.src, profile: job.profile })" HEAD -- pwa/src/lib/markdownRunner.ts && test -d pwa/node_modules/@synapsium-labs/docserver/dist/render && echo T4-BASE-OK`. Claim the runner, worker and the three test files; check W5h-a's state on them. Record each suite's starting count.
- [ ] **Step 1: Write `pwa/test/reader-render-job.test.ts`** (calls `answerRenderJob` directly, collecting posts):
  1. `'a small doc answers rendered with html, meta, the mermaid counts and its image refs'` — src `'# T\n\n![a](a.png)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n'` → one post `{id: 1, outcome}` with `outcome.kind === 'rendered'`, `result.html` containing `data-line=`, `result.meta.title === 'T'`, `mermaid.fences === 1`, `images` equal `['a.png']`, `imagesTruncated === false`.
  2. `'a delimiter run the pre-scan refuses answers refused, before render runs'` — a delimiter run built with `String.fromCharCode(42).repeat(n)` past the pre-scan's own threshold (read the threshold as `MD_MAX_DELIMITER_RUN` imported from `pwa/src/lib/markdownLimits.ts`, its one declaration, not restated; `markdownGuard.ts` exports no constant) → `outcome.kind === 'refused'`, `why === 'delimiter-run'` (asserted by outcome only; the module has no test seam).
  3. `'html past READER_HTML_MAX_BYTES answers not-rendered output-over-limit'` — a doc of many short paragraphs whose html passes the cap while the source stays under `DOCS_RENDER_GATE_BYTES` (built by repetition, measured in the test with `new TextEncoder()`) → `{kind: 'not-rendered', why: 'output-over-limit'}`.
  4. `'a source over the render gate answers not-rendered over-limit'` → `{kind: 'not-rendered', why: 'over-limit'}`.
  5. `'a non-string src answers threw TypeError'` → `{kind: 'threw', error: 'TypeError'}`.
  6. `'a message with no numeric id gets no answer'` — `{kind: 'render', src: 'x'}` and `{id: 'a', kind: 'render', src: 'x'}` → zero posts.
  7. `'a post that throws is answered once more with threw'` — the first `post` throws a `DOMException('x', 'DataCloneError')` → second post `{kind: 'threw', error: 'DataCloneError'}`; a throwing second post is swallowed.
- [ ] **Step 2: Append to `pwa/test/markdown-runner.test.ts`** (its fake-worker harness):
  1. `'a render job posts exactly {id, kind: render, src}'` — `toEqual` on the posted object's keys and values.
  2. `'a parse job still posts exactly {id, src, profile}'`.
  3. `'a render job answers timeout at budgetMs and the worker is terminated'` — fake timer fires → `{kind: 'timeout', budgetMs}`; `terminate` called once; the next job spawns again.
  4. `'render and parse share one FIFO: a render then a parse are posted in order, one at a time'`.
  5. `'an aborted render job rejects with AbortError and dispose rejects pending renders'`.
  6. `'ParseOutcome keeps its eight arms'` — a type-level case: `const arms: Record<ParseOutcome['kind'], true> = { tree: true, refused: true, 'too-deep': true, 'too-wide': true, threw: true, timeout: true, 'worker-unavailable': true, 'worker-failed': true }` plus `expect(Object.keys(arms)).toHaveLength(8)` (a ninth arm is a compile error under `tsc --noEmit`, which Verify runs).
- [ ] **Step 3: Edit `pwa/test/markdown-purity.test.ts`.** `ALLOWED_PACKAGES` gains `'@synapsium-labs/docserver/render'`. Append case `'the worker entry holds no static import of readerRenderJob'` — an AST walk of `markdownWorker.ts`: no `ImportDeclaration` whose specifier resolves to `readerRenderJob` (type-only declarations included: the worker names the reply type as the type query `import('./readerRenderJob').ReaderRenderReply`, which is neither an `ImportDeclaration` nor a `CallExpression`), and exactly one `CallExpression` with `ImportKeyword` callee whose single argument is the string literal `'./readerRenderJob'`. `ROOTS` is NOT edited here: `closure()` reads every root with `readFileSync` while the describe is collected, so a root whose file does not exist yet fails the whole file to collect; the two roots are added in Step 6, with their files.
- [ ] **Step 4: Append to `pwa/test/markdown-worker-built.test.ts`** (its existing build): `'the render job is its own lazily loaded worker chunk that loads with no DOM'` — exactly one emitted worker-side chunk contains `markdown-it`'s text marker (a string the test reads from the installed `markdown-it` package's `package.json` `name` appearing in the chunk, or the chunk imported via `import()` in a node child exposing `answerRenderJob`); it imports in a node child with no DOM globals; the worker entry chunk does not contain that marker.
- [ ] **Step 5: Run to verify they fail.**
  `( cd pwa && ./node_modules/.bin/vitest run test/reader-render-job.test.ts )` — Expected: the file fails to import (module absent): 1 failed file.
  `( cd pwa && ./node_modules/.bin/vitest run test/markdown-runner.test.ts test/markdown-purity.test.ts )` — Expected: runner cases 1, 3, 4, 5 and the purity case red; runner cases 2 and 6 green before code (they pin today's behaviour).
- [ ] **Step 6: Implement.**
  - `readerLimits.ts`: the three constants with a header (ring L1, "imports nothing", the spec rows, refinement (m); `READER_IMAGE_BUDGET_BYTES` equals the library's internal image budget and §4.3's 5 MiB; Task 10 may lower it by measurement).
  - `readerRenderJob.ts`: header (ring L1 worker side, A6, M8.21; "the shared Markdown library's renderer" in prose). `answerRenderJob` per Decisions (1)-(2), mirroring `answerMarkdownJob`'s id check and double-wrapped post. It never throws.
  - `markdown-purity.test.ts`: `ROOTS` gains `'readerRenderJob.ts'` and `'readerLimits.ts'`, now that both files exist.
  - `markdownWorker.ts`: `let renderJob: Promise<typeof import('./readerRenderJob')> | undefined;` and `worker.onmessage = (e) => { const d = e.data as { kind?: unknown } | null; if (typeof d === 'object' && d !== null && d.kind === 'render') { (renderJob ??= import('./readerRenderJob')).then((m) => m.answerRenderJob(e.data, (r) => worker.postMessage(r)), () => undefined); return; } answerMarkdownJob(e.data, (reply) => worker.postMessage(reply)); };` widening the worker's `postMessage` type to `MarkdownReply | import('./readerRenderJob').ReaderRenderReply` (a type query, never an `import type` declaration: Step 3's case refuses any `ImportDeclaration` of the module). A rejected chunk import posts nothing; the runner's budget answers `timeout`. Header gains one sentence naming the render job.
  - `markdownRunner.ts`: the tagged `Job` (Decision (4)); `WorkerLike.postMessage` widened to `MarkdownJob | ReaderRenderJob`; the reply handler resolves the running job with the reply's `outcome` whichever kind it is (each job's own `resolve` is typed); `render` on the returned object; the header's list gains one bullet. `docsRunner` and `chatRunner` unchanged in construction.
- [ ] **Step 7: Run to verify they pass.** Step 5's commands, then `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone. Expected: all green.
- [ ] **Step 8: Guard suites.** `tsc --noEmit` (`TSC-OK`); `( cd pwa && ./node_modules/.bin/vitest run test/docs-markdown.test.tsx test/docs-highlight-budget.test.tsx )` — unchanged, green; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/docs-parity.test.ts )` — green (the new files' rings are as declared; the `/render` specifier is admitted).
- [ ] **Step 9: Commit.** 8 files by name (`markdown-purity.test.ts` once, with Step 3's and Step 6's edits), message `pwa: the reader's render job runs on docsRunner in a lazy worker chunk (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T4-M1 | pwa | `src/lib/markdownRunner.ts` | the budget-timer start for a render job → skipped when `job.kind === 'render'` | `test/markdown-runner.test.ts` | 1 failed — `'a render job answers timeout at budgetMs and the worker is terminated'` |
| W8A-T4-M2 | pwa | `src/lib/markdownWorker.ts` | the dynamic import → a static `import { answerRenderJob } from './readerRenderJob';` used directly | `test/markdown-purity.test.ts` | 1 failed — `'the worker entry holds no static import of readerRenderJob'` |
| W8A-T4-M3 | pwa | `src/lib/readerRenderJob.ts` | the `prescanMarkdown` refusal branch → removed | `test/reader-render-job.test.ts` | 1 failed — `'a delimiter run the pre-scan refuses answers refused, before render runs'` |
| W8A-T4-M4 | pwa | `src/lib/readerRenderJob.ts` | `maxHtmlBytes: READER_HTML_MAX_BYTES` → removed | `test/reader-render-job.test.ts` | 1 failed — `'html past READER_HTML_MAX_BYTES answers not-rendered output-over-limit'` |
| W8A-T4-M5 | pwa | `src/lib/markdownRunner.ts` | a render job's post → `{ id: job.id, src: job.src, profile: 'docs' }` | `test/markdown-runner.test.ts` | 1 failed — `'a render job posts exactly {id, kind: render, src}'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/reader-render-job.test.ts test/markdown-runner.test.ts test/markdown-purity.test.ts )` — all passed; `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker-built.test.ts )` alone — all passed; `TSC-OK`.

### Task 5: L1 reader decisions, the enumerable storage port and `replaceFragment` (M8.7 and M8.19 decisions; refinements (h), (l), (n))

**Model routing:** `sonnet`, effort `high`. The judgment is in routing every link kind through `docLinkTarget` and in keeping each `null` to one meaning.

**Spec rows:** M8.7, M8.19 (decision halves), M8.11 (reducer), A15/G7 (keys), §4.4's `navigate`/`copy`/`hash` rows; refinements (h), (l), (n).

**Files:**
- Create: `pwa/src/docs/reader/policy.ts`, `pwa/src/docs/reader/readerText.ts`, `pwa/test/reader-policy.test.ts`.
- Modify: `pwa/src/lib/storage.ts` (+1 interface, +1 export, +1 header sentence), `pwa/src/lib/router.ts` (+1 export).
- Guards (not edited): `server/test/census-w7/pwa.test.ts`, `pwa/test/w7-storage-keys.test.ts`, `pwa/src/docs/docsLinks.ts`.

**Interfaces:**
- Consumes `docLinkTarget(ctx, raw)` and `DocLinkTarget` (`pwa/src/docs/docsLinks.ts#docLinkTarget`), `DocLinkContextValue`, `DOCS_PARSE_BUDGET_MS`, `StoragePort`.
- Produces:
  ```ts
  // policy.ts (L1)
  export type ReaderLink = { kind: 'fragment'; id: string } | { kind: 'relative'; path: string; fragment: string | null }
    | { kind: 'external'; url: string; scheme: 'http' | 'https' | 'mailto'; host: string };  // mirrors the library's HostLink, no import
  export type ReaderRoute = { kind: 'in-app'; href: string; fragment: string | null } | { kind: 'hash'; id: string }
    | { kind: 'sheet'; url: string; scheme: string; host: string; foreign: boolean } | { kind: 'inert' };
  export function routeReaderLink(ctx: DocLinkContextValue, link: ReaderLink, ownHost: string): ReaderRoute;
  export type CopyDecision = { kind: 'write'; text: string } | { kind: 'sheet'; text: string; hidden: readonly { index: number; codePoint: number; name: string }[] };
  export function copyDecision(text: string, hidden: readonly { index: number; codePoint: number; name: string }[]): CopyDecision;
  export function readerDocKey(project: string, section: string, path: string): string | null;  // null: no per-doc state
  export function readerPrefsOf(themeChoice: string): { theme: 'light' | 'dark' | 'auto' };
  export function readerWatchdogMs(bytes: number): number;
  export type ReaderBodyState = { s: 'rendering' } | { s: 'mounting' } | { s: 'ready' } | { s: 'fallback'; reason: string } | { s: 'plain'; why: string };
  export function readerBodyReducer(state: ReaderBodyState, ev: …): ReaderBodyState;
  // storage.ts (L3)
  export interface EnumerableStoragePort extends StoragePort { key(index: number): string | null; readonly length: number }
  export function enumerablePageStorage(): EnumerableStoragePort | null;  // null: no storage here
  // router.ts
  export function replaceFragment(id: string): void;
  ```

**Decisions this task makes:** (1) `relative` → rebuild `path` plus `#fragment` when non-null → `docLinkTarget`: `in-app` → `{kind:'in-app'}`; `inert` → `{kind:'inert'}`; `external` or `github` → `{kind:'sheet'}` with the URL parsed for scheme and host. `external` → sheet. `fragment` → `hash`. (2) `foreign` is `host !== ownHost` (exact, lower-cased; refinement (h)). (3) `copyDecision` writes only when `hidden` is empty and the text is at most 65 536 UTF-8 bytes; anything else is the sheet. (4) `readerDocKey` joins `project:section:path`; `null` when the result is over 1024 code units or holds a control character (C0, DEL, C1). (5) `readerPrefsOf` maps `system`→`auto`, `light`→`light`, `dark`→`dark`, anything else → `auto`. (6) `readerWatchdogMs(bytes) === DOCS_PARSE_BUDGET_MS(bytes)` (refinement (c): no Mermaid allowance). (7) `readerBodyReducer`: `fallback` and `plain` are terminal for a body key (every event returns the same state). (None departs beyond (h).)

- [ ] **Step 0:** `git grep -q "export interface StoragePort" HEAD -- pwa/src/lib/storage.ts && git grep -q "export function docLinkTarget" HEAD -- pwa/src/docs/docsLinks.ts && ! git grep -q "replaceFragment" HEAD -- pwa/src && echo T5-BASE-OK`. Claim `storage.ts`, `router.ts`. Record the census counts: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/census-w7/pwa.test.ts )`.
- [ ] **Step 1: Write `pwa/test/reader-policy.test.ts`** with a `DocLinkContextValue` fixture for project `demo`, section from `DOC_SECTIONS[0]`, path `a/b.md`, tree entries for `a/c.md`:
  - links: `'relative /api/x is inert'`; `'a path above the root is inert'` (`../../../x.md`); `'a doc link routes in-app with its query dropped and its fragment kept'` (`{kind:'relative', path:'c.md', fragment:'h'}` after the library dropped `?x=1`; asserts `href` has no `?` and `fragment === 'h'`); `'an external https link opens the sheet, foreign, with its host'` (`https://c.a.example/p` with own host `b.a.example` → `{kind:'sheet', host:'c.a.example', foreign:true}`: the two hosts share their last two labels, so only the exact comparison of refinement (h) calls it foreign); `'the console's own host is not foreign'` (`https://b.a.example/p` with own host `b.a.example` → `foreign:false`); `'a repo resolution opens the sheet on the GitHub blob URL'`; `'a fragment link becomes a hash'`.
  - copy: `'clean text is written'`; `'ESC, U+202E and U+200B each send the text to the sheet with their indices'` (built with `String.fromCharCode(27)`, `String.fromCharCode(0x202e)`, `String.fromCharCode(0x200b)`; the `hidden` list passed is the one the test computes; asserts `kind === 'sheet'` and the indices); `'text over 64 KiB goes to the sheet'`.
  - docKey: `'demo:<section>:a/b.md is the doc key'`; `'a key over 1024 code units is null'`; `'a key with a control character is null'`.
  - prefs: `'system maps to auto'`, `'light and dark pass through'`.
  - watchdog: `'the watchdog equals DOCS_PARSE_BUDGET_MS at 0, 65536 and 524288 bytes'`.
  - reducer: `'fallback is terminal for a body key'` (every event from `fallback` returns it, `toBe` the same object); `'plain is terminal'`.
  - storage: `'enumerablePageStorage is null when naming localStorage throws'` (stub `window.localStorage` getter to throw with `vi.spyOn(window, 'localStorage', 'get')`); `'enumerablePageStorage exposes key() and length'`.
  - router: `'replaceFragment keeps history.state and does not notify'` (set `history.replaceState({a: 1}, '', '/docs/demo')`, spy `dispatchEvent`, call `replaceFragment('h')` → `history.state` deep-equals `{a:1}`, `location.hash === '#h'`, `dispatchEvent` not called).
- [ ] **Step 2: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-policy.test.ts )` — Expected: the file fails to import.
- [ ] **Step 3: Implement** per Interfaces and Decisions. `readerText.ts` exports `READER_FALLBACK_NOTE = 'The rich view did not start; shown in the plain view.'` (§4.6's exact text), the sheet words (`READER_SHEET_TEXT`: title, the foreign-host warning, Open, Cancel; the copy sheet's title, warning, marker form `⟦U+XXXX NAME⟧` built from `codePoint` and `name`, Copy anyway, Cancel). `storage.ts`'s header gains: `enumerablePageStorage hands the page's store to one guarded consumer (the reader mount), which needs key() and length; it is the same store and adds no owner.` `enumerablePageStorage` returns `window.localStorage` inside try/catch, `null` on throw or absence, and declares no `getItem` of its own. `replaceFragment` per refinement (n).
- [ ] **Step 4: Run to verify they pass.** Step 2's command — all green.
- [ ] **Step 5: Guard suites.** `( cd pwa && ./node_modules/.bin/vitest run test/w7-storage-keys.test.ts )` — unchanged, green. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/census-w7/pwa.test.ts test/rings/pwa-rings.test.ts test/docs-parity.test.ts )` — the census counts equal Step 0's (no new storage owner or type), green. `TSC-OK`.
- [ ] **Step 6: Commit.** 5 files by name, message `pwa: the reader's L1 decisions, an enumerable storage port and replaceFragment (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T5-M1 | pwa | `src/docs/reader/policy.ts` | the `docLinkTarget` call for `relative` → `{ kind: 'in-app', href: link.path, fragment: link.fragment }` | `test/reader-policy.test.ts` | 2+ failed — `'relative /api/x is inert'`; `'a path above the root is inert'` |
| W8A-T5-M2 | pwa | `src/docs/reader/policy.ts` | `hidden.length === 0 &&` → removed | `test/reader-policy.test.ts` | 1 failed — `'ESC, U+202E and U+200B each send the text to the sheet with their indices'` |
| W8A-T5-M3 | pwa | `src/docs/reader/policy.ts` | `host !== ownHost` → `host.split('.').slice(-2).join('.') !== ownHost.split('.').slice(-2).join('.')` | `test/reader-policy.test.ts` | 1 failed — `'an external https link opens the sheet, foreign, with its host'` (fixture hosts share a registrable half) |
| W8A-T5-M4 | pwa | `src/docs/reader/policy.ts` | the terminal `fallback` arm → returns `{ s: 'mounting' }` on a `mount` event | `test/reader-policy.test.ts` | 1 failed — `'fallback is terminal for a body key'` |
| W8A-T5-M5 | pwa | `src/lib/router.ts` | `history.replaceState(history.state,` → `history.replaceState(null,` | `test/reader-policy.test.ts` | 1 failed — `'replaceFragment keeps history.state and does not notify'` |

(W8A-T5-M3's fixture is Step 1's: own host `b.a.example`, link host `c.a.example`; the test asserts `foreign: true`.)

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/reader-policy.test.ts test/w7-storage-keys.test.ts )`; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/census-w7/pwa.test.ts test/rings/pwa-rings.test.ts )` — all passed.

### Task 6: The plain view's images as `data:` URLs (refinement (d))

**Model routing:** `sonnet`, effort `high`. The judgment is in keeping ONE pin rule: `planImage`'s behaviour must not move while it gains a string-keyed core.

**Spec rows:** A7 as refined by (d); §4.3's Images row; base §4.11 (`imagePinFor`, the per-page index).

**Files:**
- Modify: `pwa/src/docs/DocImage.tsx` (extract `planImageRef`, export `rasterDataUrl` beside `svgDataUrl`, and export the existing `fetchImage` with its `LoadJob` and `Fetched` types and `ImagePlan`, unchanged, so the reader's loader calls the plain view's own and holds no second copy of the loader path or its raster checks).
- Create: `pwa/src/docs/reader/images.ts`, `pwa/test/reader-images.test.ts`.
- Guards (not edited): `pwa/test/docs-images.test.tsx`, `pwa/test/staged-images.test.tsx`, `pwa/test/docs-object-urls.test.ts`, `pwa/test/golden/markdown/images-https.html`.

**Interfaces:**
- Produces: `export function planImageRef(ctx: DocLinkContextValue, src: string, index: number | null): ImagePlan` (exported with `ImagePlan`); `fetchImage`, `LoadJob` and `Fetched` exported from `DocImage.tsx` as they are (no change of signature or behaviour); `export function rasterDataUrl(bytes: Uint8Array, mime: RasterMime): string` (`'data:' + mime + ';base64,' + base64Of(bytes)`); `export function loadReaderImages(refs: readonly string[], ctx: DocLinkContextValue, assets: DocsAssetContextValue, signal: AbortSignal): Promise<{ readonly urls: Readonly<Record<string, string>>; readonly drafts: number }>`.

**Decisions:** (1) `planImage(ctx, node)` becomes `planImageRef(ctx, recorded?.attrs['src'] ?? '', recorded?.imageIndex ?? null)`; behaviour unchanged. (2) `loadReaderImages` walks `refs` in order with index `i`; only `pinned`, non-`deferred` plans load, by calling the exported `fetchImage` through `assets.queue.run` with `assets.loaders` (a `Fetched` value `f` per image); a raster becomes `rasterDataUrl(f.bytes, f.mime)` and counts `f.bytes.length`; an SVG uses `f.src` as is (`fetchImage` already returns it as `data:image/svg+xml;base64,…`, the library's grammar, and returns no bytes), and its decoded size is derived from the base64 text after that prefix: `Math.floor(b64.length * 3 / 4)` minus its count of trailing `=`; the running total of decoded bytes stops adding once the next image would pass `READER_IMAGE_BUDGET_BYTES`; a failed load is left out. (3) The refs are `scanRefs`' `src` strings exactly; each `urls` key is that exact string. (4) Draft images count toward `onDraftAsset` as the plain view's do, one per loaded draft image, but `loadReaderImages` calls no `onDraftAsset`: it returns `drafts`, the number of loaded images whose plan is a draft pin, and its caller (Task 8's `ReaderFrame`) adds `onDraftAsset(drafts)` once the images resolve and takes back `onDraftAsset(-drafts)` on unmount (the provider sums deltas, `DocsScreen.tsx#onDraftAsset`). (None departs beyond (d).)

- [ ] **Step 0:** `git grep -q "function planImage(ctx: DocLinkContextValue, node: HastElement | undefined): ImagePlan" HEAD -- pwa/src/docs/DocImage.tsx && git grep -q "export function svgDataUrl" HEAD -- pwa/src/docs/DocImage.tsx && echo T6-BASE-OK`. Claim `DocImage.tsx`. Record the counts of the three guard suites.
- [ ] **Step 1: Write `pwa/test/reader-images.test.ts`** with injected loaders and queue (the `docsFixtures.ts` helpers):
  1. `'a raster becomes a data:image/png;base64 URL in the library's image grammar'` — asserts the URL matches `/^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/` (re-spelled from the spec's type list; the library's own pattern is internal) and never starts with `blob:`.
  2. `'an SVG becomes a data:image/svg+xml;base64 URL'` (the `Fetched` value's `src`, unchanged).
  3. `'external, refused and repo refs are absent from the map'` (`https://a.example/x.png`, `../../../x.png`, a ref outside the section).
  4. `'index 30 and later are absent'` — 31 pinned refs → 30 keys; the 31st absent.
  5. `'the byte budget stops adding'` — three 2 MiB rasters → two keys.
  6. `'a space-in-path ref in scanRefs' encoded form pins like the plain view's raw src'` — ref `a%20b.png` and the plain view's `a b.png` give the same `pin` from `planImageRef`.
  7. `'a failed load is left out and the rest load'`.
  8. `'an aborted signal stops further loads'`.
  9. `'drafts counts the loaded draft images, and no onDraftAsset is called'` — two draft-pinned refs and one committed ref, all loaded → `drafts === 2`; the injected `onDraftAsset` spy is never called.
- [ ] **Step 2: Run to verify they fail** (import failure).
- [ ] **Step 3: Implement** per Decisions. `images.ts` header: ring L3, refinement (d), "W6's asset planner replaces this file".
- [ ] **Step 4: Run to verify they pass**, then the three guard suites unchanged and green, `TSC-OK`.
- [ ] **Step 5: Commit.** 3 files, message `pwa: the reader loads the plain view's images as data: URLs (docs W8a)`, trailer. (Its callers hold a full `DocLinkContextValue`: Task 8's `ReaderFrame` builds one from its `LinkBase`.)

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T6-M1 | pwa | `src/docs/reader/images.ts` | `rasterDataUrl(f.bytes, f.mime)` → `rasterObjectUrl(f.bytes, f.mime)` | `test/reader-images.test.ts` | 1+ failed — `'a raster becomes a data:image/png;base64 URL in the library's image grammar'` |
| W8A-T6-M2 | pwa | `src/docs/reader/images.ts` | `plan.deferred` check → removed | `test/reader-images.test.ts` | 1 failed — `'index 30 and later are absent'` |
| W8A-T6-M3 | pwa | `src/docs/reader/images.ts` | the budget comparison → removed | `test/reader-images.test.ts` | 1 failed — `'the byte budget stops adding'` |
| W8A-T6-M4 | pwa | `src/docs/DocImage.tsx` | `if (typeof size === 'number' && size > cap)` → `if (false)` | `test/docs-images.test.tsx` | 1+ failed — its existing too-large case(s), named at measurement |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/reader-images.test.ts test/docs-images.test.tsx test/staged-images.test.tsx test/docs-object-urls.test.ts )` — all passed; `TSC-OK`.

### Task 7: Asset texts and the `./host` adapter (refinements (b), (c), (k); M8.2, M8.12, M8.15)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the adapter's key set: what ccrc hands the library is the whole of ccrc's control over the frame.

**Spec rows:** M8.2, M8.12 (hash half), M8.15 (keys, the 64 KiB value cap, the doc key, the 1 MiB budget), M8.20 (adapter half; the live half is Task 10), §4.4's ops in W8a (6 and 2, `prefs` included), §4.6's Mermaid gate, G7; refinements (b), (c), (k).

**Files:**
- Create: `pwa/src/docs/reader/assets.ts`, `pwa/src/docs/reader/bridge.ts`, `pwa/test/reader-assets.test.ts`, `pwa/test/reader-bridge.test.ts`.
- Modify: `pwa/test/w7-storage-keys.test.ts` (one appended, separate describe; the union list untouched).

**Interfaces:**
- Consumes (library): `mountDocFrame(el, {document, adapters}) → DocFrame`, `HostAdapters`, `HostLink`, `HiddenChar`, `FallbackReason` (`@synapsium-labs/docserver/host`); `frameCsp`, `FRAME_MANIFEST`, `MERMAID_GATE_DEFAULTS`, `mermaidGate`, `BRIDGE_LIMITS`, `BRIDGE_PROTOCOL`, `ERROR_WHY`, `PREF_KEYS`, `RenderInput`, `FrameAssets` (`@synapsium-labs/docserver/frame`).
- Consumes (ccrc): Task 5's `policy.ts` and `enumerablePageStorage`; `READER_STORE_PREFIX`; Task 4's `ReaderRenderOutcome` `rendered` arm.
- Produces:
  ```ts
  // assets.ts (L3)
  export function loadReaderAssets(): Promise<FrameAssets>;   // guard, bootstrap, enhance, css (assets/frame/reader.css) via ?raw
  export function loadMermaidAsset(): Promise<string>;         // assets/mermaid/mermaid.frame.js?raw
  // bridge.ts (L3)
  export interface ReaderMountInput {
    readonly document: RenderInput; readonly bytes: number; readonly docKey: string | null;
    readonly prefs: { theme: 'light' | 'dark' | 'auto' };
    readonly onLink: (l: ReaderLink) => void; readonly onHash: (id: string) => void;
    readonly copy: (text: string, hidden: readonly HiddenChar[]) => void;
    readonly onReady: () => void; readonly onFallback: (r: FallbackReason) => void;
  }
  export interface ReaderMountDeps { readonly mount?: typeof mountDocFrame; readonly store?: () => EnumerableStoragePort | null;
    readonly assets?: () => Promise<FrameAssets>; readonly mermaid?: () => Promise<string> }
  export interface ReaderMount { destroy(): void; setPrefs(p: { theme: 'light' | 'dark' | 'auto' }): void }  // setPrefs wraps DocFrame.setPrefs: the `prefs` op, no remount
  export async function mountReader(el: HTMLElement, input: ReaderMountInput, deps?: ReaderMountDeps): Promise<ReaderMount>;
  ```

**Decisions:** (1) Adapters are exactly `assets, watchdogMs, store, storePrefix, docKey, prefs, mermaidDraw, title, focus, onLink, onHash, copy, onReady, onFallback`; never `changes`, `openVersion`, `features` or `mermaidGate`. (2) `mermaidDraw: 'on-request'`, `storePrefix: READER_STORE_PREFIX`, `focus: true`, `watchdogMs: readerWatchdogMs(bytes)`, `title` the doc's file name. (3) `store` omitted when the port answers `null`; `docKey` omitted when `readerDocKey` answered `null`. (4) If `document.scan` is present and `mermaidGate(document.scan.mermaid).inline` is true, load the Mermaid text into `assets.mermaid`; if that import rejects, mount without `scan` (figures as source; refinement (c)); if the gate does not pass, mount with `scan` and no Mermaid text (the library shows source). (5) `document.version` is `{sha, draft}` only when the served commit is full hex (refinement (k)). (6) `mountReader` never calls `DocFrame.update`; `destroy` is idempotent; `setPrefs` forwards to `DocFrame.setPrefs` (the `prefs` parent-to-frame op, applied without a remount, §4.4). (7) A rejected `loadReaderAssets` calls `onFallback('assets')` and mounts nothing. (8) The callbacks are adapters, not pass-throughs: the library calls `copy(text, { hidden })`, so bridge.ts sets `copy: (text, check) => input.copy(text, check.hidden)`; `onLink` maps the library's `HostLink` to `ReaderLink` field by field; `onHash` is forwarded as is. (9) `loadReaderAssets` reads the frame stylesheet from `assets/frame/reader.css` (`FRAME_MANIFEST.css.path === 'frame/reader.css'`, the built copy with the fonts inlined as `data:`), never the source `assets/reader.css`, whose hash differs and which the frame's asset check refuses with `asset-mismatch`. (None departs beyond (b), (c).)

- [ ] **Step 0: Base and the jsdom measurement.** `test -f pwa/src/docs/reader/policy.ts && test -f pwa/src/lib/readerRenderJob.ts && test -f pwa/node_modules/@synapsium-labs/docserver/assets/frame/guard.js && test -f pwa/node_modules/@synapsium-labs/docserver/assets/frame/reader.css && test -f pwa/node_modules/@synapsium-labs/docserver/assets/mermaid/mermaid.frame.js && test -f pwa/node_modules/@synapsium-labs/docserver/dist/host/store.js && echo T7-BASE-OK`. Then measure, in a throwaway test run (not committed): in vitest's jsdom realm, `typeof window.MessageChannel === 'function'`, and whether an `<iframe srcdoc="<p>x">` appended to `document.body` fires `load`. Record yes/no for each in the SDD ledger. Two "yes" keep the real-mount cases (Step 2 case 10) here; any "no" moves them to Task 10, and the results say so. Record the installed `dist/host/mount.js`, `dist/host/store.js`, `dist/frame/gate.js` and `dist/frame/csp.js` text for the dist rows' `old`, and the order of `frameCsp()`'s `script-src` sources.
- [ ] **Step 1: Write `pwa/test/reader-assets.test.ts`:**
  1. `'each asset text's sha256 equals FRAME_MANIFEST's entry'` — for guard, bootstrap, enhance, css and mermaid: `createHash('sha256').update(text, 'utf8').digest('hex')` equals `FRAME_MANIFEST[guard|bootstrap|enhance|css|mermaid].sha256` (paths `frame/guard.js`, `frame/bootstrap.js`, `frame/enhance.js`, `frame/reader.css`, `mermaid/mermaid.frame.js`), never assets.json's top-level `reader.css` entry (texts via `loadReaderAssets()`/`loadMermaidAsset()` under vitest's `?raw` support).
  1b. `'each asset's ?raw specifier is its manifest path'` — `assets.ts`'s source (read with `node:fs`, AST) has exactly five `import()` calls, and the set of their literal arguments equals the set of `'@synapsium-labs/docserver/assets/' + FRAME_MANIFEST[key].path + '?raw'` for guard, bootstrap, enhance, css and mermaid (so the css import is `assets/frame/reader.css?raw`).
  2. `'frameCsp's script-src hashes are the manifest's csp sources for guard, bootstrap, enhance and Mermaid'` (M8.12).
  3. `'M8.2: frameCsp re-tokenised has exactly the listed directives'` — directive names, as a set, equal `{default-src, script-src, style-src, font-src, img-src, base-uri, form-action}`; `default-src` is `['\'none\'']`.
  4. `'M8.2: script-src holds sha256 sources only'`.
  5. `'M8.2: no host, self, unsafe-eval, connect-src or frame-src'` — no token matches `/^https?:|^\/\/|\*|\.[a-z]/i`, no `'self'`, no `'unsafe-eval'`.
  6. `'M8.2: base-uri and form-action are none; img-src and font-src are data: only'`.
  6b. `'M8.2: the re-tokenised policy is exactly this map'` — the directives, re-tokenised, `toEqual`: `default-src` `["'none'"]`; `script-src` the manifest's csp sources for guard, bootstrap, enhance and Mermaid, in the order `frameCsp()` emits them (measured at Step 0); `style-src` `["'unsafe-inline'", 'data:']`; `font-src` and `img-src` `['data:']`; `base-uri` and `form-action` `["'none'"]`. (Case 5's token pattern misses `blob:`, `ws:`, `wss:`, `filesystem:`, `'unsafe-hashes'` and `'wasm-unsafe-eval'`; this case does not.)
  7. `'the bridge constants are the spec's numbers'` — `BRIDGE_LIMITS` `bucketCapacity 40`, `bucketRefillPerSecond 20`, `storeSetBucketCapacity 10`, `storeSetRefillPerSecond 10`, `changesInFlight 1`, `coalesceMs 250`, `refusalsToClose 16`, `valueMaxBytes 65536`, `copyMaxBytes 65536`, `hashMaxCodeUnits 256`, `storeBudgetBytes 1048576`; `BRIDGE_PROTOCOL === 1`; `[...ERROR_WHY].sort()` equals `['assets','boot','mermaid','protocol','render']`; `PREF_KEYS` equals `['prefs','ui']`.
  8. `'the Mermaid gate defaults are the spec's 24, 16384 and 131072'` — `MERMAID_GATE_DEFAULTS` `toEqual({ maxFences: 24, maxFenceChars: 16384, maxTotalChars: 131072 })`.
  9. `'READER_IMAGE_BUDGET_BYTES is the spec's 5 MiB or lower'` — `<= 5 * 1024 * 1024` and `> 0`.
- [ ] **Step 2: Write `pwa/test/reader-bridge.test.ts`** with an injected `mount` spy that records its options, an injected `store`, and stub assets:
  1. `'the adapters are exactly ccrc's fourteen keys, with no changes or openVersion'`.
  2. `'mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true'`.
  3. `'watchdogMs is readerWatchdogMs of the document's bytes'`.
  4. `'store is omitted when the port answers null'`; `'docKey is omitted when readerDocKey answered null'`.
  5. `'a gated Mermaid doc carries the Mermaid text; a rejected Mermaid import drops scan and mounts'`.
  6. `'M8.20: a doc over the Mermaid fence count mounts with scan and no Mermaid text'` — 25 fences.
  6b. `'M8.20: a doc over the total cap mounts with scan and no Mermaid text'` — two fences of 65 537 and 65 536 code units (131 073 in total).
  6c. `'M8.20: one fence over the per-fence cap still inlines Mermaid, with maxTextSize 16384'` — one fence of 16 385 code units: the Mermaid text is inlined (the gate passes) and the library shows that fence as source, under `maxTextSize` 16 384.
  7. `'version carries sha and draft only for a full-hex commit, and never commits or only'`.
  8. `'a rejected asset load falls back with assets and never mounts'`.
  9. `'copy receives the library's check.hidden array; onLink receives a ReaderLink mapped from HostLink; onHash is forwarded; update is never called'` — the test calls the captured adapters with the library's real argument shapes (`copy('a' + String.fromCharCode(0x202e), { hidden: [h] })` → `input.copy` called with `(text, [h])`, an array; `copy('ab', { hidden: [] })` → `input.copy('ab', [])`; `onLink` with each `HostLink` kind → the matching `ReaderLink`).
  9b. `'setPrefs forwards to DocFrame.setPrefs and never remounts'` — the injected `mount` returns a `DocFrame` spy; `(await mountReader(...)).setPrefs({theme:'dark'})` → the spy's `setPrefs` called once with `{theme:'dark'}`; `mount` still called once; `update` never.
  10. (real mount, if Step 0 measured yes; else these move to Task 10) `'M8.1 in jsdom: the installed mount's iframe has sandbox allow-scripts, referrerpolicy no-referrer, csp equal to frameCsp and to the srcdoc meta's content, and no src, name or allow'`; `'M8.3 in jsdom: the srcdoc starts with the CSP meta carrying frameCsp exactly, then the guard, the seed and the bootstrap, each once'` (parse the srcdoc: its first element is a `meta` whose `http-equiv`, lower-cased, is `content-security-policy` and whose `content` equals `frameCsp()` exactly and equals the iframe's `csp` attribute); `'M8.15 seed half: every key the real mount reads starts with ccrc:reader:v1:'` (a spy store records every key passed to `getItem`/`key`/`setItem`).
- [ ] **Step 3: Append to `pwa/test/w7-storage-keys.test.ts`** a separate `describe('W8a: the reader's keys stay under its own prefix (M8.15)')`. The library's store is `createHostStore` in the installed `dist/host/store.js`; `./host` does not export it, so the test imports that file by file URL (`pathToFileURL` of `pwa/node_modules/@synapsium-labs/docserver/dist/host/store.js`; the exports map governs specifiers, not file URLs) after asserting that the installed `dist/host/mount.js` imports `./store.js` (so the module under test is the one the mount runs). It builds `createHostStore(spy, READER_STORE_PREFIX, docKey)` over a spy `localStorage` seeded with console keys, `docKey` from `readerDocKey`, and calls `set` as `dist/host/store.d.ts` declares:
  1. `'the adapter hands the page store with storePrefix ccrc:reader:v1:'` — through `mountReader` with a `mount` spy: `adapters.store` is the port and `adapters.storePrefix === READER_STORE_PREFIX`. The case imports `mountReader` with `await import('../src/docs/reader/bridge')` inside the case, never at the file's top, so the file still collects before `bridge.ts` exists.
  2. `'a store.set flood past 1 MiB evicts the oldest other documents, only ccrc:reader:v1: keys, stays within the budget and leaves ccrc.fleet-snapshot.v1 writable'` — other docs' fields first, each doc through its own `createHostStore(spy, READER_STORE_PREFIX, <its docKey>)`, in a recorded order, then the current doc's, totalling past `BRIDGE_LIMITS.storeBudgetBytes` (each value at most `valueMaxBytes`); after every `set`, the UTF-8 bytes of every key and value under `READER_STORE_PREFIX` (summed by the test over the spy) are at most `storeBudgetBytes`; at least one other document's keys were removed, and the removed documents are the first ones written (a prefix of the recorded order, oldest first); every removed key starts with `READER_STORE_PREFIX`; every seeded console key is still present; `ccrc.fleet-snapshot.v1` still writes.
  2b. `'a write that cannot fit without evicting the prefs, the current document or a non-document key is refused with budget and evicts nothing'` — the spy is seeded with one non-document key under the prefix (`READER_STORE_PREFIX + 'x'`, which the store counts but never evicts) whose bytes leave less room than the next value needs, and with one other document's fields; `set('pref:prefs', <a JSON value of 60 KiB>)` answers `{ ok: false, reason: 'budget' }`; the spy's `setItem` and `removeItem` are not called, and every seeded key is still present.
  3. `'a value over 64 KiB is refused'` — a value of `BRIDGE_LIMITS.valueMaxBytes + 1` UTF-8 bytes is refused (`oversize`) and nothing is written.
  4. `'a frame-supplied doc field lands under the current doc's key'` — a `doc:` field set lands at `<prefix>doc:<current docKey>:<field>`; a key naming another doc is refused or lands under the current doc's key, never under the other doc's.
  The real-mount seed half stays in Step 2 group 10 (or Task 10). The existing union list is not edited.
- [ ] **Step 4: Run to verify they fail** (import failures for the two new files; `w7-storage-keys.test.ts` still collects, because its case 1 imports `bridge.ts` dynamically: the storage describe's case 1 red, cases 2, 2b, 3 and 4 green before code, since they pin the installed library's store under ccrc's prefix, their red being W8A-T7-M10, M11, M14 and M15; the file's existing cases green).
- [ ] **Step 5: Implement.**
  - `assets.ts` (header: ring L3, refinement (b), "the shared Markdown library's frame assets as inert strings"): `loadReaderAssets = async () => { const [g, b, e, c] = await Promise.all([import('@synapsium-labs/docserver/assets/frame/guard.js?raw'), import('@synapsium-labs/docserver/assets/frame/bootstrap.js?raw'), import('@synapsium-labs/docserver/assets/frame/enhance.js?raw'), import('@synapsium-labs/docserver/assets/frame/reader.css?raw')]); return { guard: g.default, bootstrap: b.default, enhance: e.default, css: c.default }; }` (each specifier written once, as the literal argument of its `import()`: M7.9's exception admits it only there); `loadMermaidAsset = async () => (await import('@synapsium-labs/docserver/assets/mermaid/mermaid.frame.js?raw')).default`. Add `declare module '*?raw'` only if pwa's `vite/client` types do not already cover it (check at Step 0).
  - `bridge.ts` (header: ring L3, refinements (b), (c), (k); "the one file that imports the shared Markdown library's host mount"): `mountReader` per Decisions; the `copy` adapter unwraps `check.hidden`, the `onLink` adapter maps the library's `HostLink` to `ReaderLink` field by field, and the returned `setPrefs` wraps `DocFrame.setPrefs` (Decision (8), (6)).
- [ ] **Step 6: Run to verify they pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-assets.test.ts test/reader-bridge.test.ts test/w7-storage-keys.test.ts )` — all green.
- [ ] **Step 7: Guard suites.** `TSC-OK`; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/rings/pwa-rings.test.ts test/census-w7/pwa.test.ts )` — green (specifiers admitted; rings as declared; census counts unchanged).
- [ ] **Step 8: Commit.** 5 files, message `pwa: the reader mounts through the shared library's host with ccrc's adapters (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T7-M1 | pwa | `src/docs/reader/bridge.ts` | `mermaidDraw: 'on-request'` → `mermaidDraw: 'auto'` | `test/reader-bridge.test.ts` | 1 failed — `'mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true'` |
| W8A-T7-M2 | pwa | `src/docs/reader/bridge.ts` | the adapters object gains `changes: async () => null,` | `test/reader-bridge.test.ts` | 1 failed — `'the adapters are exactly ccrc's fourteen keys, with no changes or openVersion'` |
| W8A-T7-M3 | pwa | `src/docs/reader/bridge.ts` | `storePrefix: READER_STORE_PREFIX` → `storePrefix: 'docreader:'` | `test/reader-bridge.test.ts` | 1 failed — the on-request/prefix/focus case |
| W8A-T7-M4 | pwa | `node_modules/@synapsium-labs/docserver/assets/frame/guard.js` | one byte appended (`\n`) | `test/reader-assets.test.ts` | 1+ failed — `'each asset text's sha256 equals FRAME_MANIFEST's entry'` |
| W8A-T7-M5 | pwa | `node_modules/@synapsium-labs/docserver/dist/frame/gate.js` | the default `maxFences: 24` → `maxFences: 25` (measured text) | `test/reader-assets.test.ts` | 1 failed — `'the Mermaid gate defaults are the spec's 24, 16384 and 131072'` |
| W8A-T7-M6 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/mount.js` | the sandbox token `'allow-scripts'` → `'allow-scripts allow-same-origin'` (measured text) | `test/reader-bridge.test.ts` (if Step 0 yes) else Task 10's file | 1 failed — the M8.1 case |
| W8A-T7-M7 | pwa | `src/docs/reader/assets.ts` | `assets/frame/reader.css?raw` → `assets/reader.css?raw` | `test/reader-assets.test.ts` | 2 failed — `'each asset text's sha256 equals FRAME_MANIFEST's entry'`; `'each asset's ?raw specifier is its manifest path'` |
| W8A-T7-M8 | pwa | `src/docs/reader/bridge.ts` | the returned `setPrefs` body → empty (`setPrefs() {}`) | `test/reader-bridge.test.ts` | 1 failed — `'setPrefs forwards to DocFrame.setPrefs and never remounts'` |
| W8A-T7-M9 | pwa | `node_modules/@synapsium-labs/docserver/dist/frame/csp.js` | the `style-src` sources gain ` wss:` (measured text) | `test/reader-assets.test.ts` | 1 failed — `'M8.2: the re-tokenised policy is exactly this map'` |
| W8A-T7-M10 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/store.js` | the refusal after the eviction loop, `projected() > BRIDGE_LIMITS.storeBudgetBytes` → `false` (measured text) | `test/w7-storage-keys.test.ts` | 1 failed — `'a write that cannot fit without evicting the prefs, the current document or a non-document key is refused with budget and evicts nothing'` |
| W8A-T7-M11 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/store.js` | the value cap `utf8Bytes(value) > BRIDGE_LIMITS.valueMaxBytes` → `false` (measured text) | `test/w7-storage-keys.test.ts` | 1 failed — `'a value over 64 KiB is refused'` |
| W8A-T7-M12 | pwa | `src/docs/reader/bridge.ts` | `mermaidGate(document.scan.mermaid).inline` → `document.scan.mermaid.fences <= 24` (measured text) | `test/reader-bridge.test.ts` | 1 failed — `'M8.20: a doc over the total cap mounts with scan and no Mermaid text'` |
| W8A-T7-M13 | pwa | `src/docs/reader/bridge.ts` | the `copy` adapter → `copy: input.copy` | `test/reader-bridge.test.ts` (and `tsc`) | 1 failed — `'copy receives the library's check.hidden array; …'` |
| W8A-T7-M14 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/store.js` | the eviction loop's `evicted.add(doc);` → removed (measured text) | `test/w7-storage-keys.test.ts` | 1 failed — `'a store.set flood past 1 MiB evicts the oldest other documents, …'` |
| W8A-T7-M15 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/store.js` | `storageKeyOf`'s document arm drops `docKey`: ``docStorageKey(docKey, key.slice('doc:'.length))`` → `` `${docPrefix}${key.slice('doc:'.length)}` `` (measured text) | `test/w7-storage-keys.test.ts` | 1 failed — `'a frame-supplied doc field lands under the current doc's key'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/reader-assets.test.ts test/reader-bridge.test.ts test/w7-storage-keys.test.ts )`; `TSC-OK`.

### Task 8: `ReaderFrame`, the sheets and the leaf wiring (M8.7, M8.11, M8.17, M8.19; refinement (g))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the fallback triggers: each lands on the plain pipeline once, with no remount loop and no reason in the DOM.

**Spec rows:** §4.1 (host, focus, remount), §4.6 (every trigger, the fixed note), M8.7, M8.11, M8.17, M8.19, A22; refinement (g).

**Files:**
- Create: `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/ReaderSheets.tsx`, `pwa/test/reader-frame.test.tsx`.
- Modify: `pwa/src/docs/DocsLeaf.tsx` (`MarkdownBody` and the prop thread), `pwa/src/screens/DocsScreen.tsx` (one prop, its default, its thread to `DocsLeaf`), `pwa/src/docs/docs.css` (the reader's rules), `pwa/vite.config.ts` (`globIgnores` beside `globPatterns`: this task's literal `import('./reader/assets')` is the first to make the 3.7 MB Mermaid `?raw` chunk reachable, and vite-plugin-pwa throws on any precached asset over workbox's 2 MiB default, so without the entry every `vite build` fails from this commit on).
- Guards (not edited): `pwa/test/docs-screen.test.tsx`, `docs-markdown.test.tsx`, `docs-links.test.tsx`, `docs-images.test.tsx`, `docs-visit.test.tsx`, `docs-truth.test.tsx`, `docs-banners.test.tsx`, `docs-failures.test.tsx`, `tap-targets.test.tsx`, `markup-census`, `literal-census`, `control-census`, `role-census`, `shape-census`, `shell-css`.

**Interfaces:**
- Produces: `export interface ReaderDeps { render(src: string, o: { budgetMs: number; signal?: AbortSignal }): Promise<ReaderRenderOutcome>; mount(el: HTMLElement, input: ReaderMountInput): Promise<ReaderMount>; images: typeof loadReaderImages }` (Task 7's `ReaderMountInput` and `ReaderMount`, `{destroy, setPrefs}`, named in `ReaderFrame.tsx` by `import type` only); `export const lazyMountReader: ReaderDeps['mount']` in `ReaderFrame.tsx`, the default `mount`, which holds the two literal dynamic imports, `import('./reader/bridge')` and `import('./reader/assets')`, and calls `mountReader(el, input, { assets: loadReaderAssets, mermaid: loadMermaidAsset })`; and `export function ReaderFrame(p: { show: DocsShowOk; bodyKey: string; link: LinkBase; parser: MarkdownParser; reader: ReaderDeps; pendingFragment: string | null; onFragmentConsumed(): void }): ReactNode`; `DocsScreen` prop `reader?: ReaderDeps | null` defaulting to `typeof Worker === 'function' ? DEFAULT_READER : null`; `DocsLeaf` prop `reader?: ReaderDeps | null`, OPTIONAL and defaulting to `null` (G1), because `pwa/test/docs-screen.test.tsx` renders `<DocsLeaf … />` with no `reader` and stays byte-identical (a required prop is TS2741 under `tsc --noEmit`).

**Decisions:** (1) Triggers, in order (the architecture's R6): G1 `reader === null` → `DocMarkdown` exactly as today (every existing suite's DOM unchanged); G2 bytes over `DOCS_RENDER_GATE_BYTES` → `DocMarkdown` with its own ask gate, "Format anyway" formats plain, no render, no mount (M8.17, refinement (g)); G4 render answer `refused`/`not-rendered`/`threw`/`worker-failed`/`worker-unavailable` → `DocMarkdown` (its own notes), the reason to `console.warn('ccrc: reader …')`; G5 render `timeout` → `DocPlain` with `docsPlainNote({kind:'timeout', budgetMs})`, no second parse; G3 the lazy `bridge`/`assets` import rejects, or `mountReader` rejects for any cause (the library's `mountDocFrame` throws `TypeError`/`RangeError` synchronously on an adapter it refuses, such as a title outside 1-1024 code units or a bad `watchdogMs`, and `mountReader` is async) → destroy whatever exists, then `DocMarkdown` with `READER_FALLBACK_NOTE`, the reason in the console only; G6 `onFallback(reason)` → destroy, then `DocMarkdown` with `READER_FALLBACK_NOTE`, the reason kept in state and the console only; G7 Mermaid chunk rejects → handled inside `mountReader` (Task 7). (2) The body stays in fallback until its `bodyKey` changes (`ReaderFrame` is keyed by `bodyKey` in `MarkdownBody`): no remount loop. (3) Render → images (`loadReaderImages`; its `drafts` added once with `onDraftAsset(drafts)` and taken back with `onDraftAsset(-drafts)` on unmount, Task 6 Decision (4)) → mount, under one `AbortController` aborted on unmount. (4) `onLink`: `routeReaderLink(ctx, link, location.hostname)` → `in-app` → `navigate(href)` and `visit.setFragment(fragment)`; `hash` → `replaceFragment(id)`; `sheet` → the external-link sheet; `inert` → nothing. `window.open(url, '_blank', 'noopener,noreferrer')` only in the sheet's Open handler. (5) `copy`: `copyDecision` → `write` → `copyText(text)`, and on rejection the copy sheet; `sheet` → the copy sheet, which writes only from its Copy anyway button. (6) `initialHash` from `pendingFragment`, then `onFragmentConsumed()`. (7) Prefs theme from `useThemeChoice()` through `readerPrefsOf`: the first value seeds the mount; a later change calls the mount's `setPrefs(readerPrefsOf(theme))` once, with no change of key and no remount, so the reading position survives (§4.4's `prefs` op). (8) CSS: `.docs-reader` fills the pane (`block-size` to the pane, `inline-size: 100%`), the iframe inside it `border: 0; inline-size: 100%; block-size: 100%`; sheet controls at `min-height: var(--tap-min)`; no `overflow` on `.shell-detail`. (9) `routeReaderLink`, `loadReaderImages` and `planImageRef` take a full `DocLinkContextValue`, and `ReaderFrame` holds a `LinkBase` (`Omit<DocLinkContextValue, 'urls'>`): it builds `{ ...p.link, urls: new WeakMap() }` once in a `useMemo`, as `DocsLeaf.tsx#RasterBody` does (none of the three reads `urls`). (10) For Task 10's worst-case figure, `ReaderFrame` brackets its `mountReader` call with `performance.mark('ccrc-reader-mount-start')` and `performance.mark('ccrc-reader-mount-end')` (User Timing, L4 delivery; no window property is read or written, and nothing decides on it). (11) `pwa/vite.config.ts` gains `globIgnores: ['**/mermaid.frame-*.js']` beside `globPatterns`, with a comment naming A9, M8.14 and refinement (i) and no library name. (None departs beyond (g).)

- [ ] **Step 0:** `git grep -q "function MarkdownBody(p: { readonly show: DocsShowOk; readonly bodyKey: string; readonly link: LinkBase; readonly parser: MarkdownParser })" HEAD -- pwa/src/docs/DocsLeaf.tsx && test -f pwa/src/docs/reader/bridge.ts && ! git grep -q globIgnores HEAD -- pwa/vite.config.ts && echo T8-BASE-OK`. Claim `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs.css`, `vite.config.ts`; check W5h-a's and Share's state on `DocsLeaf.tsx` and `vite.config.ts`. Record every guard suite's count.
- [ ] **Step 1: Write `pwa/test/reader-frame.test.tsx`** rendering `ReaderFrame` with injected `render`, `mount` (resolving to a `{destroy, setPrefs}` spy and capturing the input), `images` (resolving to `{urls, drafts}`) and `parser`:
  1. `'M8.17: a doc over the render gate never renders or mounts, and shows the gate prompt'` — 524 289 bytes; `render` and `mount` not called; `docGateSentence(bytes)` shown; "Format anyway" shows the plain-formatted body (parser called), still no mount.
  2. `'a render timeout shows the timeout note with no mount and no parse'`.
  3. `'a refused render shows DocMarkdown's own refusal note'`.
  4. `'M8.11: onFallback unmounts, shows the fixed note, never shows the reason, and never mounts again'` — invoke the captured `onFallback('timeout')` → `destroy` called once; `READER_FALLBACK_NOTE` shown; `container.textContent` does not contain `timeout`; `mount` called exactly once after further renders/ticks.
  5. `'a new body key mounts again'` — rerender with a new `bodyKey` → `mount` called a second time with a fresh input.
  6. `'M8.7: an external link opens the sheet, and window.open runs only on Open, with _blank and noopener,noreferrer'` — spy `window.open`; call `onLink({kind:'external', url:'https://a.example/p', scheme:'https', host:'a.example'})` → the sheet names `https://a.example` and its foreign warning; `window.open` not called; tap Open → called once with `('https://a.example/p', '_blank', 'noopener,noreferrer')`.
  7. `'a doc link routes in-app and hands the fragment to the visit'` — `navigate` spy (module mock of `lib/router`).
  8. `'M8.19: a copy with hidden characters shows the sheet with a marker each, and copyText waits for its button'` — text with `String.fromCharCode(27)` and `String.fromCharCode(0x202e)`; `copyText` (module mock of `docs/share`) not called; two markers shown; tap Copy anyway → called once with the original text.
  9. `'clean text calls copyText directly; a rejected write opens the copy sheet'`.
  10. `'onHash calls replaceFragment'`.
  11. `'a rejected adapter import falls back with the fixed note'` — `reader.mount` is the exported `lazyMountReader`, and `vi.doMock('../src/docs/reader/bridge', …)` makes that module's evaluation throw, so its literal `import()` rejects (a route case 11b's injected rejection does not take).
  11b. `'a mount that rejects with a RangeError falls back with the fixed note'` — the injected `mount` rejects with `new RangeError('x')` → `READER_FALLBACK_NOTE` shown, the body is `DocMarkdown`'s, `container.textContent` does not contain `RangeError`, and `mount` is not called again.
  12. `'unmount aborts the render and destroys the mount'`.
  13. `'a theme change calls setPrefs once and never remounts'` — after `ready`, change the theme choice (`useThemeChoice`'s store) from light to dark → the captured mount's `setPrefs` called once with `{theme:'dark'}`; `mount` still called once; `destroy` not called.
  14. `'with no Worker, DocsScreen's default reader is null and docsRunner.render is never called'` — delete `globalThis.Worker` for the case (restored after), `vi.spyOn(docsRunner, 'render')`, render `DocsScreen` with no `reader` prop on a Markdown leaf → the plain body appears and `render` is never called.
  15. `'loaded draft images are counted once and taken back on unmount'` — `images` resolves `{urls: {}, drafts: 2}`; the asset context's `onDraftAsset` spy receives `2` after the load and `-2` on unmount, and nothing else.
- [ ] **Step 2: Run to verify they fail** (import failure).
- [ ] **Step 3: Implement** `ReaderFrame.tsx` (header: ring L4, §4.1, §4.6, refinement (g); the lazy `import('./reader/bridge')` and `import('./reader/assets')` are literal and sit in `lazyMountReader`), `ReaderSheets.tsx` (the two sheets on `@ccrc/ui`'s `Sheet`; words from `readerText.ts`; never the word `full` inside a `<Sheet>` tag), the `MarkdownBody` branch (`p.reader === null ? <DocMarkdown …/> : <ReaderFrame key={p.bodyKey} …/>`) and the `pendingFragment` thread (the existing `useFragmentScroll` call keeps working for the plain path), `DocsScreen`'s prop and default (`DEFAULT_READER = { render: (s, o) => docsRunner.render(s, o), mount: lazyMountReader, images: loadReaderImages }`), and the CSS.
- [ ] **Step 4: Run to verify they pass**, then every guard suite of Files: counts equal Step 0's (G1 keeps jsdom's DOM byte for byte, since jsdom has no `Worker`). Then `( cd pwa && ./node_modules/.bin/vitest run test/fonts-built.test.ts )` alone: green, which shows `vite build` still succeeds with the Mermaid chunk now reachable and ignored by the precache.
- [ ] **Step 5:** `TSC-OK`; `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/rings/pwa-rings.test.ts )` green.
- [ ] **Step 6: Commit.** 7 files, message `pwa: a Markdown leaf opens in the rich reader, with the plain view as its fallback (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T8-M1 | pwa | `src/docs/ReaderFrame.tsx` | the gate check before render → moved after mount | `test/reader-frame.test.tsx` | 1 failed — `'M8.17: a doc over the render gate never renders or mounts, and shows the gate prompt'` |
| W8A-T8-M2 | pwa | `src/docs/ReaderFrame.tsx` | the fallback dispatch → re-dispatch `mount` after fallback | `test/reader-frame.test.tsx` | 1 failed — `'M8.11: onFallback unmounts, shows the fixed note, never shows the reason, and never mounts again'` |
| W8A-T8-M3 | pwa | `src/docs/ReaderFrame.tsx` | the note `READER_FALLBACK_NOTE` → `` `${READER_FALLBACK_NOTE} (${state.reason})` `` | `test/reader-frame.test.tsx` | 1 failed — the M8.11 case |
| W8A-T8-M4 | pwa | `src/docs/ReaderFrame.tsx` | the `sheet` route → `window.open(r.url, '_blank', 'noopener,noreferrer')` directly | `test/reader-frame.test.tsx` | 1 failed — `'M8.7: an external link opens the sheet, …'` |
| W8A-T8-M5 | pwa | `src/docs/ReaderFrame.tsx` | the copy handler → `void copyText(text)` regardless of the decision | `test/reader-frame.test.tsx` | 1 failed — `'M8.19: a copy with hidden characters …'` |
| W8A-T8-M6 | pwa | `src/screens/DocsScreen.tsx` | `typeof Worker === 'function' ? DEFAULT_READER : null` → `DEFAULT_READER` | `test/reader-frame.test.tsx` | 1 failed — `'with no Worker, DocsScreen's default reader is null and docsRunner.render is never called'` |
| W8A-T8-M7 | pwa | `src/docs/ReaderFrame.tsx` | the rejection handler on the `mountReader` promise → removed (measured text) | `test/reader-frame.test.tsx` | 1 failed — `'a mount that rejects with a RangeError falls back with the fixed note'` |
| W8A-T8-M8 | pwa | `src/docs/ReaderFrame.tsx` | the `setPrefs(readerPrefsOf(theme))` call on a theme change → removed | `test/reader-frame.test.tsx` | 1 failed — `'a theme change calls setPrefs once and never remounts'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/reader-frame.test.tsx )`; the Docs guard suites in two calls; `( cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx test/markup-census.test.ts test/literal-census.test.ts test/control-census.test.ts test/shell-css.test.ts )`; `test/fonts-built.test.ts` alone; `TSC-OK` — all passed.

### Task 9: Source scans, the precache split and the built output (amended M8.10; M8.21's main-thread rule; M8.12, M8.13, M8.14 built halves; refinement (i))

**Model routing:** `sonnet`, effort `high`. The judgment is in the scan's homes and its planted controls, which replace `MockupFrame.tsx`'s (absent on `main`).

**Spec rows:** A2b, A9, M8.10 (as amended by (b)), M8.12, M8.13, M8.14 (as read by (i)), M8.21 (no `render()` on the main thread), A21.

**Files:**
- Modify: `pwa/test/docs-scans.test.ts` (one appended clause). (`pwa/vite.config.ts`'s `globIgnores` landed in Task 8; this task measures it in the built output.)
- Create: `pwa/test/reader-built.test.ts`.

**Decisions:** (1) The clause, in the file's AST style, NOT EXHAUSTIVE (its known evasions listed in its header: a specifier built at run time, `eval`, a re-export through a non-`pwa/src` file, a `message` listener added through a variable holding the event name): import declarations and literal dynamic `import()` of `@synapsium-labs/docserver…` in `pwa/src` have homes exactly: `/host` → `docs/reader/bridge.ts`; `/render` → `lib/readerRenderJob.ts`; `/assets/…?raw` → `docs/reader/assets.ts`; `/frame` → `docs/reader/*`; bare, `/enhance`, `/highlight`, `/conformance` → none. In `pwa/src/docs`: no identifier or member `postMessage` call, no `MessageChannel` identifier, no `onmessage` member, no JSX `iframe` element, no `srcDoc`/`srcdoc` JSX attribute or string, no `default-src 'none'` string, except Export's allowances, by exact path, as A2b and M8.10 keep them: a JSX `iframe` and `srcDoc` only in `docs/export/buildExport.tsx`, and `default-src 'none'` only in `docs/export/policy.ts` (the allowance holds whether or not those files exist yet). Across `pwa/src`: a value import of `lib/readerRenderJob` (an `ImportDeclaration` that is not `import type`, or a dynamic `import()`, of a specifier resolving to it) appears only in `lib/markdownWorker.ts`; every other importer (`lib/markdownRunner.ts`, `docs/ReaderFrame.tsx`) uses `import type` or a type query only (M8.21: the library's `render()` runs only through `docsRunner`). Also across `pwa/src`: no `addEventListener` call whose first argument is the literal `'message'`, no `window.onmessage`/`self.onmessage` assignment outside `lib/markdownWorker.ts` (and W5h's `lib/markdownHighlightWorker.ts` when it exists). (2) Planted controls, each in a copy of the tree in a temp directory made by the file's existing `mkdtempSync` helper (the scan reads the copy): a `/host` import in `docs/DocsLeaf.tsx`; a `/render` import in `docs/DocsLeaf.tsx`; an `addEventListener('message', …)` in `lib/router.ts`; a `postMessage(` call in `docs/DocsLeaf.tsx`; a `srcDoc` JSX attribute and a `default-src 'none'` string in `docs/DocsLeaf.tsx`; a value import of `../lib/readerRenderJob` in `docs/ReaderFrame.tsx`; each red; a copy that adds `docs/export/buildExport.tsx` holding `<iframe srcDoc={…} />` and `docs/export/policy.ts` holding `default-src 'none'` is green; the real tree green. (3) `reader-built.test.ts` finds each asset's chunk by content, never by matching raw text: a `?raw` import is emitted as a JS string literal, so quotes, newlines and non-ASCII characters are escaped in the chunk, and every frame script opens with `"use strict";` and a newline.

- [ ] **Step 0:** `git grep -q "globIgnores: \['\*\*/mermaid.frame-\*.js'\]" HEAD -- pwa/vite.config.ts && test -f pwa/src/docs/ReaderFrame.tsx && echo T9-BASE-OK`. Claim `docs-scans.test.ts`; check W5h-a's, Share's and Export's clauses there and whether Export's two files exist on `main` yet.
- [ ] **Step 1: Append the clause and its cases** to `pwa/test/docs-scans.test.ts`: `'M8.10: library specifiers sit only in their homes'`; `'M8.10: pwa/src/docs holds no port, frame or frame policy of its own'`; `'M8.10: pwa/src holds no window message listener'`; `'M8.10 planted: a /host import in DocsLeaf is red'`; `'M8.10 planted: a /render import in DocsLeaf is red'`; `'M8.10 planted: a message listener in lib/router is red'`; `'M8.10 planted: a postMessage call in DocsLeaf is red'`; `'M8.10 planted: srcDoc and default-src none in DocsLeaf are red'`; `'M8.10: Export's iframe, srcDoc and policy are allowed at their exact paths'`; `'M8.21: a value import of readerRenderJob sits only in the worker entry'`; `'M8.21 planted: a value import of readerRenderJob in ReaderFrame is red'`.
- [ ] **Step 2: Write `pwa/test/reader-built.test.ts`** (one `vite build` in a node child into `mkdtemp`, `fonts-built.test.ts`'s `BUILDER`, env `PATH`, `HOME`, `NODE_ENV` only):
  1. `'exactly one emitted file matches mermaid.frame-*.js'`.
  2. `'sw.js precaches no file that carries the Mermaid asset'` — in `beforeAll`, a node child imports every emitted `assets/*.js` chunk whose default export is a string, hashes each default export (sha256, UTF-8) and returns `{ file, sha256 }`; the file whose hash equals `FRAME_MANIFEST.mermaid.sha256` is NOT among `sw.js`'s precache URLs (the `precacheAndRoute` manifest), and no precache URL's basename matches `mermaid.frame-`.
  3. `'sw.js precaches the chunks that carry guard, bootstrap, enhance and the reader css'` — the files whose hashes equal `FRAME_MANIFEST.guard`, `.bootstrap`, `.enhance` and `.css` (`frame/reader.css`) are each among `sw.js`'s precache URLs.
  4. `'the emitted chunks carry each frame asset's text exactly'` — each of the five manifest sha256 values (`css` being `frame/reader.css`'s) is carried by exactly one emitted chunk in that map.
  5. `'the built index.html holds the one frame-src none meta before any script'`.
  6. `'ccrc's own Geist woff2 files are still precached'` (M8.14 as read by (i)).
- [ ] **Step 3: Run to verify they fail.** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — Expected: the eleven new cases red (the clause they call does not exist yet), every existing clause green. `( cd pwa && ./node_modules/.bin/vitest run test/reader-built.test.ts )` alone — Expected: all six green, because `globIgnores` landed with Task 8, where the chunk first became reachable; this file's red is measured by W8A-T9-M1 (record the counts).
- [ ] **Step 4: Implement** the clause.
- [ ] **Step 5: Run to verify they pass**, then `( cd pwa && ./node_modules/.bin/vitest run test/fonts-built.test.ts )` alone and `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )` (the config stays red-clean).
- [ ] **Step 6: Commit.** 2 files, message `pwa: the reader's import homes are scanned; Mermaid stays out of the precache (docs W8a)`, trailer.

**Mutation rows this task contributes:**

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T9-M1 | pwa | `vite.config.ts` | the `globIgnores` line → removed | `test/reader-built.test.ts` | every case fails — the build in `beforeAll` throws (vite-plugin-pwa's "Assets exceeding the limit" for the Mermaid chunk); record that message as the red line |
| W8A-T9-M2 | pwa | `test/docs-scans.test.ts` | the `/host` home `docs/reader/bridge.ts` → any file under `docs/` | `test/docs-scans.test.ts` | 1 failed — `'M8.10 planted: a /host import in DocsLeaf is red'` |
| W8A-T9-M3 | pwa | `test/docs-scans.test.ts` | the `message` listener check → limited to `docs/` | `test/docs-scans.test.ts` | 1 failed — `'M8.10 planted: a message listener in lib/router is red'` |
| W8A-T9-M4 | pwa | `test/docs-scans.test.ts` | the Export allowance's exact paths → any file under `docs/` | `test/docs-scans.test.ts` | 1 failed — `'M8.10 planted: srcDoc and default-src none in DocsLeaf are red'` |
| W8A-T9-M5 | pwa | `test/docs-scans.test.ts` | the `readerRenderJob` value-import home `lib/markdownWorker.ts` → any file under `pwa/src` | `test/docs-scans.test.ts` | 1 failed — `'M8.21 planted: a value import of readerRenderJob in ReaderFrame is red'` |

**Verify:** `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )`; `test/reader-built.test.ts` alone; `test/fonts-built.test.ts` alone — all passed.

### Task 10: Real-browser rows and the worst-case measurement (M8.B1-M8.B6; M8.1, M8.3, M8.4, M8.6, M8.8, M8.20 on the live DOM; E14-E16)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`. The judgment is in the battery's channel list and in each row's control: a row whose control does not go the other way proves nothing.

**Spec rows:** M8.B1-M8.B6 (with M8.B4's and M8.B5's controls), M8.1, M8.3, M8.4, M8.6, M8.8, M8.11 (live), M8.20 (live), labs E14, E15, E16; §4.3's worst-case measurement.

**Files:** Create `pwa/browser/reader-frame.browser.test.ts`. Modify `pwa/test/browser-leg.test.ts` only if its wiring pin lists files (check at Step 0).

**Decisions:** (1) It uses `app.ts`'s built PWA (`buildDist`, the fixture `/api`) and `harness.ts`'s `startOrigins` and `waitForHit`. Fixture docs (project `demo`): a doc with a Mermaid flowchart, sequence and gantt fence; an image; an external link `https://a.example/p`; a doc link; a code block holding `String.fromCharCode(27)`; a hostile Mermaid `%%{init: …}%%` directive with a `themeCSS` payload; a 25-fence doc; an M8.8 doc that carries `'</' + 'script><' + 'script>'` (built by concatenation) and `String.fromCharCode(0x2028)` in three places: its first `# ` heading (the seed's `title`, which `render()` takes as the first h1's raw text), a front-matter value (the seed's `frontList`) and its body text; a `## ` heading whose slug equals a library global or the seed element's id (the names read from the installed `dist/frame/seed.js` and `assets/frame/bootstrap.js` at Step 0), and a `<!-- id:X -->` anchor of the same name. (2) The handshake count wraps `HTMLIFrameElement.prototype.contentWindow`'s getter in the parent realm with an init script and records every `postMessage` call (target, payload, port count). (3) M8.B1's control is a hand-built `srcdoc` with no CSP meta, mounted in the same page by the test, which reaches origin B on at least 20 of 27 channels. (4) The worst case: a 512 KiB doc, 30 images totalling `READER_IMAGE_BUDGET_BYTES`, and a passing Mermaid gate; record the srcdoc length, the main-thread mount time (the duration between the `ccrc-reader-mount-start` and `ccrc-reader-mount-end` User Timing marks that Task 8's `ReaderFrame` sets, read with `performance.getEntriesByName`; no window hook and no source edit here), and the time to `ready`. If `ready` misses the watchdog, lower `READER_IMAGE_BUDGET_BYTES` in `readerLimits.ts` to the largest measured value that passes and record it (a measurement, not a departure); below 2 MiB is an operator ask.

- [ ] **Step 0:** `test -f pwa/browser/app.ts && git grep -q "export async function startOrigins\|export function startOrigins" HEAD -- pwa/browser/harness.ts && test -f pwa/src/docs/ReaderFrame.tsx && echo T10-BASE-OK`. `CCRC_CHROME` set as the brief gives it. If Task 7 Step 0 measured "no", this task also carries Task 7's real-mount cases (M8.1, M8.3, M8.15 seed half) and W8A-T7-M6. Read and record the installed `dist/frame/document.js`, `dist/frame/seed.js` and `dist/host/mount.js` text for this task's dist rows' `old`, and the names M8.8's fixture needs. Measure whether a Playwright init script reaches the srcdoc frame's realm before its bootstrap runs (needed by case 7's port cases) and record yes/no.
- [ ] **Step 1: Write the cases** (`describe('W8a reader frame in Chrome')`):
  1. `'M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style'` — tap Render on EVERY figure, the hostile one included, and wait for each: the flowchart, the sequence and the gantt figure each hold an `svg` (E15's pass condition); the hostile figure is drawn or shows its documented refusal, and no `style` element's text and no element's computed style carries the hostile payload; `document.fonts` in the frame reports the library's faces `loaded` (M8.B1's "fonts load"); THEN run the base spec's lab 1-2 channel list through Playwright's frame evaluation: 0/27 hits to A and B, with Mermaid having run.
  1b. `'M8.B1 meta-only: with the iframe csp attribute suppressed, the srcdoc meta alone holds 0 of 27'` — an init script makes `Element.prototype.setAttribute` skip `csp` on an `IFRAME` before the mount (or the `csp` property setter, whichever the installed `dist/host/mount.js` uses, read at Step 0) (WebKit's and Gecko's condition, which enforce only the meta), the reader mounts, and the battery re-runs: 0/27 to A and B.
  2. `'M8.B1 control: a srcdoc without the meta reaches B on at least 20 of 27'`.
  3. `'M8.B2: no request from the frame carries the session cookie'` (fetch with `credentials:'include'` with and without the marker, XHR, `sendBeacon`, WebSocket, `Image`: none arrives at the server, or none carries the cookie).
  4. `'M8.B3: storage, IndexedDB, cookie and caches throw or are empty, with zero uncaught errors'`.
  5. `'M8.B4: window.open returns null, top.location= throws, and _blank is inert'` (its control, `allow-popups` added, is W8A-T10-M8).
  6. `'M8.B5: a width change persists under ccrc:reader:v1:pref:prefs and is seeded back on remount'`.
  7. `'M8.B5: a doc link click routes in-app'`; `'M8.B5: a parent.postMessage of a well-formed navigate has no effect'`; `'M8.B5: a second load gives the plain view with the fixed note'`; on the frame's own port, captured in the frame realm by an init script that wraps the port the bootstrap receives: `'M8.B5: an unknown op and a 70 KiB value on the port have no effect'` and `'M8.B5: a navigate sent before ready has no effect'` (the hook posts it synchronously at capture, before the bootstrap's `ready`); and the control `'M8.B5 control: without the shell meta, a navigated child receives the port and still achieves no effect'` (the built `index.html` with its `frame-src 'none'` meta removed in the test's served copy; the frame navigates itself, the child loads, and no route, store write or sheet follows). If Step 0 measured that no init script reaches the frame realm before the bootstrap, record that and pin the unknown-op, oversize and pre-ready clauses through dist rows on the host parser in `dist/host/mount.js` instead (measured text), each red on a parent-side effect the test observes; stop and ask only if neither route works.
  8. `'M8.B6 control: a shell meta with script-src self makes the reader fall back'` (the built `index.html` rewritten in the test's served copy; E14).
  9. `'M8.1 live: the iframe's attributes, the csp attribute equal to the srcdoc meta, and focus on mount'` (`document.activeElement` is the iframe after mount); `'M8.3 live: the srcdoc prefix order, with the meta carrying frameCsp exactly'` (the first element is a `meta` whose `http-equiv`, lower-cased, is `content-security-policy` and whose `content` equals `frameCsp()` and the iframe's `csp` attribute; then the guard, the seed and the bootstrap, each once, the seed immediately before the bootstrap's script); `'M8.4 live: no http(s) or // value in src, href, srcset, @import or url() outside script bodies, and no modulepreload or preconnect'`.
  10. `'M8.6: exactly one contentWindow.postMessage per mount, {t:hello,v:1}, target *, one port; the nonce is in the seed only and new on remount'` — the hello payload has no nonce; the srcdoc's seed parses and its `nonce` matches `/^[0-9a-f]{32}$/`; the frame is then driven to a second `load` (a self-navigation, which the shell's `frame-src 'none'` blocks, lab E11) and the `contentWindow.postMessage` count stays 1; a remount (a new body key) gives a different nonce and a new port. (The wrong-nonce `ready` arm is the library's own, covered by its browser suite; ccrc does not plant one.)
  11. `'E16: pushState inside the frame does not change the console URL; clipboard.writeText inside the frame is refused; the copy op still reaches the parent sheet'` (recorded as measured).
  12. `'the worst case renders inside the watchdog'` (records the figures; red if `ready` misses the watchdog at the final budget).
  13. `'M8.8: a seed value with </script><script> and U+2028 round-trips inert, and ids named like the seed or a library global change nothing'` — the M8.8 doc reaches `ready`; parse the srcdoc and take the seed element's text: it holds no raw `<`, `>`, `&`, U+2028 or U+2029, and `JSON.parse` of it gives back the hostile title and front-matter value exactly; the frame holds exactly the script elements the srcdoc prefix carries (no extra `script`); the rendered text contains the `</script><script>` text and U+2028 exactly; the heading and the anchor render with their ids and the frame still behaves (a doc link routes in-app).
  14. `'M8.20 live: a 25-fence doc shows every figure as source and inlines no Mermaid'` — every figure shows its source text and no Render button draws; the srcdoc holds no script whose sha256 equals `FRAME_MANIFEST.mermaid.sha256`.
- [ ] **Step 2: Run** `( cd pwa && ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/reader-frame.browser.test.ts )` through `ccrc test`. Expected: all green against the installed library; any red that is a library behaviour differing from the architecture's §2.1 is a stop-and-ask (do not patch around it).
- [ ] **Step 3:** Run the whole browser leg once through `ccrc test`: unchanged files green.
- [ ] **Step 4: Commit.** `pwa/browser/reader-frame.browser.test.ts` (and `readerLimits.ts` if the budget was lowered; `browser-leg.test.ts` if its pin lists files), message `pwa: the reader's walls and bridge, measured in Chrome (docs W8a)`, trailer; the measured figures go in the SDD ledger for Task 12.

**Mutation rows this task contributes** (planted in the workspace's installed library `dist`, restored and sha-checked per the low-disk rule):

| id | pkg | file | old → new | tests | expected red |
|---|---|---|---|---|---|
| W8A-T10-M1 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/mount.js` | the `loads === 1` condition on the hello send → `loads >= 1` (measured text) | `browser/reader-frame.browser.test.ts` (browser config) | 1+ failed — `'M8.6: exactly one contentWindow.postMessage per mount, …'` |
| W8A-T10-M2 | pwa | same | the sandbox token → `'allow-scripts allow-same-origin'` (measured text) | same | 2+ failed — `'M8.B2: …'`; `'M8.B3: …'` |
| W8A-T10-M3 | pwa | same | the second-load fallback/port close → removed (measured text) | same | 1 failed — `'M8.B5: a second load gives the plain view with the fixed note'` |
| W8A-T10-M4 | pwa | `node_modules/@synapsium-labs/docserver/dist/frame/document.js` | the guard and the seed swapped in the srcdoc skeleton (measured text) | `browser/reader-frame.browser.test.ts` (browser config) | 1+ failed — `'M8.3 live: …'` |
| W8A-T10-M5 | pwa | same | the skeleton gains `<link rel=preconnect href=https://a.example>` after the meta (measured text) | same | 1+ failed — `'M8.4 live: …'` |
| W8A-T10-M6 | pwa | same | the meta's `content="${p.policy}"` → `content="default-src *"` (measured text) | same (and `test/reader-bridge.test.ts` if Task 7 Step 0 measured yes) | 2+ failed — `'M8.3 live: …'`; `'M8.B1 meta-only: …'` |
| W8A-T10-M7 | pwa | `node_modules/@synapsium-labs/docserver/dist/frame/seed.js` | the seed serialiser's escaping → a raw `JSON.stringify` (measured text) | same | 1+ failed — `'M8.8: …'` (re-measured with the hostile title and front-matter value: the seed text holds a raw `<`, and the title ends the seed early) |
| W8A-T10-M8 | pwa | `node_modules/@synapsium-labs/docserver/dist/host/mount.js` | the sandbox token → `'allow-scripts allow-popups'` (measured text) | same | 1+ failed — `'M8.B4: …'` |

**Verify:** the browser file through `ccrc test` — all passed; the figures recorded.

### Task 11: Whole-branch review (held out), its fixes, and `## Deviations found`

**Model routing:** reviewers `opus`, five lenses; one `sonnet` refute pass per finding; fixes by `sonnet` implementers, each reviewed by `opus`.

- [ ] **Step 1:** Five `opus` lenses over `BASE..HEAD` against this plan and the amended spec: (1) security walls and the bridge; (2) rings, seams and no overloaded null; (3) the test and mutation table, including the installed-`dist` rows and the restore discipline; (4) build, precache and CI supply chain; (5) spec and deviation fidelity, plus the public-repo scan of every changed file.
- [ ] **Step 2:** Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 3: Define the deviations.** Replace this plan's `## Deviations found` section's working list with the issued numbers: the first eleven issued numbers go to the departing refinements (a)-(j) and (o), in that order, then any departure found while executing, in the order found. Entry form: `- **D-<n> (<date>)** — <what departs from which spec sentence, and why>. <Task and rows that apply it>.` Then: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green; `grep -c '^- \*\*D-[0-9]* (' <plan>` equals the number defined; `sed -n '/^## Deviations found/,/^## /p' <plan> | grep -nE 'D-<n|<date>|D-TBD-[a-z0-9]'` prints nothing (the check is scoped to the section, because the Global Constraints and this step spell the placeholder forms on purpose; a concrete `D-TBD-<slug>` token anywhere else is `dtbd.test.ts`'s to catch). The section's intro line is rewritten too, so it no longer names the working list. Commit `docs: W8a's deviations, as issued (docs W8a)`.

### Task 12: Close — suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus), with `sonnet` subagents for the runs.

- [ ] **Step 1: Suites**, each in the foreground through `ccrc test`, split to fit: `pwa` full suite in pieces; `tsc --noEmit`; `reader-built`, `markdown-worker-built`, `fonts-built` each alone; the browser file; `git fetch -q origin main` then `server`'s `docs-parity`, `ci-pipeline`, `census-w7/pwa`, `rings/pwa-rings`, `deviation-refs`, `dtbd`, `topology-clean`, `anchors`, `citations`. Re-run any known load flake alone before calling it broken.
- [ ] **Step 2: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 3: Append `## W8a results`**: the counts per suite; every task's JSON row fence as measured; Task 2's provenance measurement (both lines); Task 7's jsdom measurement; Task 10's worst-case figures and the final `READER_IMAGE_BUDGET_BYTES`; the measured Mermaid chunk name; E14-E16 as measured; "Carried, not fixed". This commit is the `handoffCommit`.
- [ ] **Step 4: Public-repo scan** of every changed file and of the PR body (rc 0, zero hits). Remove `$HOME/.cc-tmp/w8a-mut/`.
- [ ] **Step 5: Push** the workspace branch and open the ONE pull request (title `Docs W8a: the rich reader frame core`; body: what ships, the departing refinements (a)-(j) and (o) with their numbers, the expected CI (full server suite; `browser (pwa)` gates in the merge queue), the plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives).
- [ ] **Step 6:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

W8a's departures, numbered as issued at the run's opening (D-7691 to D-7701 for refinements (a)-(j) and (o), in that order), then the departures found while executing, in the order found.

- **D-7691 (2026-11-01)** — `w8-split` (refinement (a)). Operator ruling (1): W8 runs as W8a (the frame core, beside W5h-a and Share, needing W5 part 1 and library v1 only) and W8b (G5, G6's version menu, `at=<sha>`, `only`, the seed's history, after W5b), with W7 last. Departs from RD24 ("W8, gated on library v1"), the §8 W8 row's dependencies (W5b, W6, W7, v1, W5h-b) and Figure 3's edges, A19, §4's "It lands in W8", RD14's op counts (6 and 2 in W8a), and the acceptance rows that move to W8b (G5, G6's version menu, `at=<sha>`, `only`, the seed's history, M8.9, M8.22, M8.5's `changes` fixture, M9.10). Applied by the plan's scope and Task 7's adapter key set (W8A-T7-M2).
- **D-7692 (2026-11-01)** — `w8a-host-mount` (refinement (b)). Operator ruling (2), with the plan's finding of no conflict: ccrc mounts the reader with the library's `mountDocFrame` through one adapter, `docs/reader/bridge.ts`, and spells no frame policy, port, parser, seed or `<iframe>`. Departs from §3.1's Host helper row ("ccrc does not use it"), §3.8's CSP-hashes bullet, §4.1's Element row, §4.2's home bullet, §4.4's Checking bullet ("one pure L0 parser … in `shared/`"), §4.7 (table and bullets), A1, A2b, A5, A17, M8.5, M8.10, M8.12 and RD14; M8.1, M8.3, M8.4, M8.6 and M8.8 measure the installed library. Tasks 7, 9, 10 (W8A-T7-M1-M6, W8A-T9-M2, W8A-T10-M1-M3).
- **D-7693 (2026-11-01)** — `w8a-mermaid-on-request` (refinement (c)). Operator ruling (4): the contingency `reader-mermaid-on-tap` (§4.6, §5.2's WebKit row, E17) becomes W8a's default without waiting for E17, through `mermaidDraw: 'on-request'`; the watchdog carries no Mermaid allowance. Task 7 (W8A-T7-M1), Task 10 (M8.B1's tap).
- **D-7694 (2026-11-01)** — `w8a-images-interim` (refinement (d)). Operator ruling (3): until W6, A7's §5.6.3 planner is replaced by the plain view's own pin rule, at most 30 images and 5 MiB, as `data:`; deferred and over-budget images are the library's "not loaded" chip. Task 6 (W8A-T6-M1-M4).
- **D-7695 (2026-11-01)** — `w8a-colouring` (refinement (e)). Operator ruling (5): the W8 row's divergences (1) and (3) are accepted for now rather than closed; (2) is measured resolved (ccrc's lock holds 11.12.0, one copy). Task 1 (the single highlight.js case).
- **D-7696 (2026-11-01)** — `w8a-shell-meta-owner` (refinement (f)). M5.19's shell meta, assigned to W6, lands in W8a with M8.13's test. Task 3 (W8A-T3-M1-M3), Task 9 (built half).
- **D-7697 (2026-11-01)** — `w8a-gate-512k` (refinement (g)). The reader serves at most `DOCS_RENDER_GATE_BYTES`; "Format anyway" formats plain; departs from §4.3's "the base spec's 2 MiB document cap". Task 8 (W8A-T8-M1).
- **D-7698 (2026-11-01)** — `w8a-link-sheet-host` (refinement (h)). The sheet highlights any host other than the console's own, not only a different registrable name (§4.4, M8.7). Task 5 (W8A-T5-M3), Task 8.
- **D-7699 (2026-11-01)** — `w8a-precache-fonts` (refinement (i)). M8.14's woff2 half is read as ccrc's own fonts; Mermaid's entry is a chunk glob, not a directory (A9); A21's `vite.config.ts` exception is unused. Tasks 1, 8 and 9 (W8A-T1-M5; `globIgnores` in Task 8, measured by W8A-T9-M1).
- **D-7700 (2026-11-01)** — `w8a-readme-to-w7` (refinement (j)). A22's README "rendering" bullet moves from W8 to W7, which runs last. No task (W8a edits no README).
- **D-7701 (2026-11-01)** — `w8a-provenance-first` (refinement (o)). The provenance identity check runs first in `build-pwa`, before any `npm ci`, then `npm ci`, `npm audit signatures` and `vite build`; departs from M8.16's and §3.6's order (`npm audit signatures` after `npm ci`, then the identity check), because `npm ci` runs install scripts that could plant the tools the check runs. Spec amendment entries 59-60. Task 2 (W8A-T2-M4).
- **D-7702 (2026-11-01)** — `w8a-bounded-npm-ci` (found while executing, Task 2). `build-pwa`'s pwa install runs as `../.github/ci/bounded.sh 180 npm ci`, not the bare `npm ci` of Task 2's step text and M8.16's step list: #2050 bounded every CI install after the plan's base (46da405e2), and the replay keeps that bound, after the provenance check and before `npm audit signatures`. This entry credits #2050 for the bounded `npm ci` only; the other deadlines in `build-pwa` are this wave's own (D-7704). Task 2 (M8.16's step-order case, which spells the bounded install; W8A-T2-M4).
- **D-7703 (2026-11-01)** — `w8a-image-index-distinct` (found while executing, Task 6). The reader numbers images by distinct `src` (the library's `scanRefs` dedupes), where the plain view numbers every `img` element, so "exactly the images the plain view already shows" (A7 as amended, and refinement (d)) holds per distinct image, not per element: a doc that repeats one image counts it once against the 30-image and 5 MiB limits. W6's planner replaces the path wholesale. Task 6 (W8A-T6-M1-M5).
- **D-7704 (2026-11-01)** — `w8a-supply-chain-deadlines` (found while executing, Task 11). The held-out review's fix bounds the rest of `build-pwa`'s supply-chain steps: `npm audit signatures` runs as `../.github/ci/bounded.sh 180 npm audit signatures`, and the provenance script runs `npm pack` and `gh attestation verify` under `bounded.sh 90` (one retry; a call that never answers still fails the script closed). Departs from Task 2 Step 1 case 1 (the run value is exactly `npm audit signatures`), Step 3's bare pack and verify lines, and M8.16's step list; a stalled registry or attestation call now costs minutes rather than the job's 15-minute limit. Task 11 (M8.16's deadline cases; W8A-T11-M9-M11, M15).
- **D-7705 (2026-11-01)** — `w8a-reader-theme-follows-palette-mode` (found while executing, Task 8). `readerPrefsOf(themeChoice, palettes)` maps a named palette to that palette's own mode (`THEMES`), so the frame's theme matches the shell's. Departs from Task 5's Interfaces (`readerPrefsOf(themeChoice: string)`) and Decision (5), which sent every named palette to `auto`. The policy tests state the rule case by case: `system` gives auto, `light` and `dark` pass through, a named palette gives its own mode, an unknown id gives auto. Task 8's fix round (reader-policy.test.ts).
- **D-7706 (2026-11-01)** — `w8a-mermaid-asset-deadline` (found by review). `mountReader` bounds its wait for the Mermaid asset by `readerWatchdogMs(bytes)`, the value the mount already passes as `watchdogMs`; past it, the mount takes exactly the rejected-import path (no `scan`, the figures show as source) and a late chunk is ignored. Departs from Task 7 Decision (4), which names only an import that rejects; it makes refinement (c)'s "ready does not wait for Mermaid" true of a stalled chunk as well. Fix round 1 (reader-bridge.test.ts; W8A-T7-M16).
- **D-7707 (2026-11-01)** — `w8a-copy-failed-sheet` (found while executing, Tasks 8 and 11). A copy the clipboard refuses opens a third sheet (`copy-failed`), which shows the text and says to copy it by hand, and the hidden-characters sheet shows the text with each hidden character marked in place: the first `READER_COPY_SHEET_MARKERS_MAX` (64) markers are named inline, every later one is an unnamed hidden marker, and a count line follows. Departs from the plan's two-sheet design, where Task 8 Decision (5) sends a rejected copy to the copy sheet: that sheet's hidden-character warning would be false for clean text. Tasks 8 and 11 (reader-frame.test.tsx; W8A-T11-M6, M14).

### Review dispositions

The plan review of 2026-10-31 confirmed 37 findings. All of them are applied in the tasks above, and entries 51-58 of the spec amendment carry the spec-text ones. The re-review that followed confirmed 17 more findings, some overlapping, all applied; its one spec-text finding (the CI order) is refinement (o), carried by entries 59-60. Four of them were applied by a route other than the one the finding proposed, or only in part:
- **The nonce and the second load (M8.6, M8.11).** Applied in part. Task 10 case 10 now checks that the nonce sits only in the seed (32 lower-case hex digits), is absent from `hello` and is new on remount, and it forces a second `load`, so W8A-T10-M1 reds the case it names. No ccrc row plants a wrong-nonce `ready`. The library generates and compares the nonce internally (`parseBridgeMessage`'s `nonce` refusal, `fail('nonce')`), and its own browser suite drives that arm. ccrc's tests measure the installed library's output, not its internals, so a dist row on the comparison would add nothing that W8A-T10-M1 and the seed checks do not already give.
- **The `store.set` flood (M8.15).** Two findings proposed different routes: drive the real store, or move the case to Task 10. Task 7 Step 3 now imports the installed `dist/host/store.js` by file URL. That is `createHostStore`, the module `dist/host/mount.js` imports, and the test asserts that import. The package's exports map governs specifiers, not file URLs, so the import works. jsdom never runs the frame's bootstrap. A browser flood through the frame would also be throttled by `storeSetRefillPerSecond` and would need the frame's internal store handle. The 64 KiB case, the foreign-doc case, the flood case and the budget-refusal case therefore run under jsdom against the real eviction (W8A-T7-M10, M11, M14, M15). End-to-end persistence through the frame stays M8.B5's case 6.
- **The worst-case timing hook.** The finding proposed listing `ReaderFrame.tsx` in Task 10 or specifying a window hook in Task 8. Task 8 Decision (10) instead specifies two User Timing marks around `mountReader`, which Task 10 reads. Nothing reads a window property, and Task 10 edits no source file.
- **`LinkBase` against the helpers' full context.** Of the two fixes offered, the plan takes the second: `ReaderFrame` builds `{ ...p.link, urls: new WeakMap() }` once, as `RasterBody` does. Widening the helpers' parameter types would not work, because `routeReaderLink` hands its context to `docLinkTarget`, and `docLinkTarget` takes a full `DocLinkContextValue` in a file this wave does not edit.

One item is outside this pass: the architecture document's R8 wording of the reader stylesheet's path (`assets/frame/reader.css`, not `assets/reader.css`) is not edited here, because this pass edits only the plan and the spec amendment. It goes to the architect.


## W8a results

Measured at the end state (branch tip before this section: `a27b637bb`), 2026-11-01.

### Suites (each through `ccrc test`, first run green, no re-run)

| Suite | Files | Tests |
|---|---|---|
| pwa, five batches | 381 passed | 9812 passed, 3 skipped |
| pwa `reader-built`, alone | 1 passed | 6 passed |
| pwa `markdown-worker-built`, alone | 1 passed | 6 passed |
| pwa `fonts-built`, alone | 1 passed | 4 passed |
| pwa `tsc --noEmit` | | clean |
| browser `reader-frame.browser.test.ts` (Chromium 153) | 1 passed | 23 passed (43.95 s) |
| server `docs-parity`, `ci-pipeline`, `census-w7/pwa`, `rings/pwa-rings`, `deviation-refs`, `dtbd`, `topology-clean`, `anchors`, `citations` (after `git fetch origin main`) | 9 passed | 347 passed |

The whole browser leg, run once at Task 10, passed 41 of 42 files locally; `session-header.browser.test.ts` failed two 900 px cases there, the same alone, and is green on main's merge-queue run, so it is the local Chromium's, not this branch's. The merge queue's `browser (pwa)` is the arbiter.

### The mutation table

111 rows, the last occurrence of each id, run at the end state in the workspace, one at a time, each bounded by `timeout -k 10 600` and `ulimit -u 4096`, each restored from a saved copy with its sha256 checked, `git status --porcelain` empty after every row. All 111 are red (W8A-T7-M16 added and measured in fix round 1). W8A-T9-M1 reds the whole file (its build refuses the Mermaid chunk), which is the guard's own clause. Rows planted in the installed library were also checked against the pinned 1.0.0 tarball after restore, and at the end all 394 installed files equal the tarball's. Seven rows were re-spelt at this step because later tasks changed their text or the earlier row described the edit in prose (W8A-T2-M1, T2-M3, T2-M4, T3-M2, T3-M3, T4-M2, T7-M4), and W8A-T6-M1 was re-spelt in fix round 1: its earlier `new` named a function `images.ts` does not import, so it went red on a ReferenceError and proved nothing; its `new` is now a `blob:` literal in place of the data URL, which reds the named case alone on its assertion.

Task 1:

```json
[
 {
  "id": "W8A-T1-M1",
  "pkg": "pwa",
  "file": "package.json",
  "old": "\"@synapsium-labs/docserver\": \"1.0.0\"",
  "new": "\"@synapsium-labs/docserver\": \"^1.0.0\"",
  "tests": "test/reader-pin.test.ts",
  "red": "Tests  1 failed | 4 passed (5) | first failing: × pwa/package.json pins @synapsium-labs/docserver at exactly 1.0.0 5ms | AssertionError: expected '^1.0.0' to be '1.0.0' // Object.is equality"
 },
 {
  "id": "W8A-T1-M2",
  "pkg": "server",
  "file": "test/docs-parity.test.ts",
  "old": "@synapsium-labs\\/docserver\\/(?:",
  "new": "@[a-z-]+\\/docserver\\/(?:",
  "tests": "test/docs-parity.test.ts",
  "red": "Tests  1 failed | 67 passed (68) | first failing: × M8.18: another scope is a hit 93ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T1-M3",
  "pkg": "server",
  "file": "test/docs-parity.test.ts",
  "old": "line.replace(M79_LIBRARY_SPECIFIER, '$1$2$2')",
  "new": "(M79_LIBRARY_SPECIFIER.test(line) ? '' : line)",
  "tests": "test/docs-parity.test.ts",
  "red": "Tests  3 failed | 65 passed (68) | first failing: × the shipped source is clean 46ms | AssertionError: expected [ …(2) ] to deeply equal []"
 },
 {
  "id": "W8A-T1-M4",
  "pkg": "server",
  "file": "test/docs-parity.test.ts",
  "old": "(?:render|frame|host|assets",
  "new": "(?:render|frame(?:\\?raw)?|host|assets",
  "tests": "test/docs-parity.test.ts",
  "red": "Tests  1 failed | 67 passed (68) | first failing: × M8.18: /frame?raw is a hit 96ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T1-M5",
  "pkg": "server",
  "file": "test/docs-parity.test.ts",
  "old": "name.startsWith('pwa/src/') ? line.replace(",
  "new": "true ? line.replace(",
  "tests": "test/docs-parity.test.ts",
  "red": "Tests  1 failed | 67 passed (68) | first failing: × M8.18: an allowed specifier in pwa/vite.config.ts is still a hit 152ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 }
]
```

Task 2:

```json
[
 {
  "id": "W8A-T2-M1",
  "pkg": "server",
  "file": "../.github/workflows/ci.yml",
  "old": "      - if: env.CCRC_LEG == 'run'\n        working-directory: pwa\n        run: ../.github/ci/bounded.sh 180 npm audit signatures\n",
  "new": "",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  1 failed | 110 passed (111) | first failing: × build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build 5ms | AssertionError: expected [ …(3) ] to deeply equal [ …(4) ]"
 },
 {
  "id": "W8A-T2-M2",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": "REPO=Synapsium-Labs/docserver",
  "new": "REPO=example-org/docserver",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  2 failed | 109 passed (111) | first failing: × the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text 8ms | AssertionError: expected +0 to be 1 // Object.is equality"
 },
 {
  "id": "W8A-T2-M5",
  "pkg": "server",
  "file": "../.github/workflows/ci.yml",
  "old": "The sixth, `build-pwa`, asks for",
  "new": "The sixth, asks for",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  1 failed | 110 passed (111) | first failing: × the least-privilege comment names every job that asks for more than contents: read (FR-6) 6ms | AssertionError: the comment does not name build-pwa: expected '# Least privilege, stated rather than…' to contain '`build-pwa`'"
 },
 {
  "id": "W8A-T2-M6",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": " --source-ref \"refs/tags/v$version\"",
  "new": "",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  2 failed | 109 passed (111) | first failing: × the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text 5ms | AssertionError: exactly one verify line: expected [] to have a length of 1 but got +0"
 },
 {
  "id": "W8A-T2-M7",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": "actual=\"sha512-$(openssl dgst -sha512 -binary \"$tgz\" | base64 -w0)\"",
  "new": "actual=\"$integrity\"",
  "tests": "test/ci-pipeline.test.ts (M8.16)",
  "red": "Tests  2 failed | 109 passed (111) | first failing: × the provenance script computes the integrity from the packed tarball, never from the lock (exact npm pack, tgz and actual lines) 5ms | AssertionError: the actual line: expected +0 to be 1 // Object.is equality"
 },
 {
  "id": "W8A-T2-M3",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": "if [ \"$actual\" = \"$integrity\" ]; then\n  echo \"library-provenance: the packed tarball matches the lock's integrity\"\nelse\n  echo \"library-provenance: the packed tarball is not the one the lock records\" >&2\n  echo \"  lock:   $integrity\" >&2\n  echo \"  packed: $actual\" >&2\n  exit 1\nfi\n",
  "new": "",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  2 failed | 109 passed (111) | first failing: × the provenance script compares the packed tarball sha512 with the lock integrity before it verifies the attestation 4ms | AssertionError: the integrity comparison is missing: expected -1 to be greater than -1"
 },
 {
  "id": "W8A-T2-M4",
  "pkg": "server",
  "file": "../.github/workflows/ci.yml",
  "old": "      - if: env.CCRC_LEG == 'run'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: bash .github/ci/library-provenance.sh\n      # The build reads ui SOURCE through `exports['.']`. Same resolution rule\n      # as the test leg: ui's own node_modules or nothing resolves.\n      #\n      # `vite build` alone, not `npm run build` (`tsc --noEmit && vite build`):\n      # `test (pwa)`'s Typecheck step (in `pwa-static`, D-6768) already runs\n      # that same `tsc --noEmit` on every run, so the second copy here bought\n      # nothing but a duplicate (D-6770). Exactly one pwa typecheck runs per CI\n      # run, in that job.\n      - if: env.CCRC_LEG == 'run'\n        working-directory: ui\n        run: ../.github/ci/bounded.sh 180 npm ci\n      - if: env.CCRC_LEG == 'run'\n        working-directory: pwa\n        run: ../.github/ci/bounded.sh 180 npm ci\n",
  "new": "      # The build reads ui SOURCE through `exports['.']`. Same resolution rule\n      # as the test leg: ui's own node_modules or nothing resolves.\n      #\n      # `vite build` alone, not `npm run build` (`tsc --noEmit && vite build`):\n      # `test (pwa)`'s Typecheck step (in `pwa-static`, D-6768) already runs\n      # that same `tsc --noEmit` on every run, so the second copy here bought\n      # nothing but a duplicate (D-6770). Exactly one pwa typecheck runs per CI\n      # run, in that job.\n      - if: env.CCRC_LEG == 'run'\n        working-directory: ui\n        run: ../.github/ci/bounded.sh 180 npm ci\n      - if: env.CCRC_LEG == 'run'\n        working-directory: pwa\n        run: ../.github/ci/bounded.sh 180 npm ci\n      - if: env.CCRC_LEG == 'run'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: bash .github/ci/library-provenance.sh\n",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  1 failed | 110 passed (111) | first failing: × build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build 5ms | AssertionError: the provenance step is the first step after setup-node: expected 4 to be 2 // Object.is equality"
 }
]
```

Task 3:

```json
[
 {
  "id": "W8A-T3-M1",
  "pkg": "pwa",
  "file": "index.html",
  "old": "content=\"frame-src 'none'\"",
  "new": "content=\"frame-src 'none'; script-src 'self'\"",
  "tests": "test/shell-csp.test.ts",
  "red": "Tests  2 failed | 2 passed (4) | first failing: × its policy re-tokenised is exactly frame-src none 4ms | AssertionError: expected [ [ 'frame-src', '\\'none\\'' ], …(1) ] to deeply equal [ [ 'frame-src', '\\'none\\'' ] ]"
 },
 {
  "id": "W8A-T3-M2",
  "pkg": "pwa",
  "file": "index.html",
  "old": "    <meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'\" />\n",
  "new": "    <meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'\" />\n    <meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'\" />\n",
  "tests": "test/shell-csp.test.ts",
  "red": "Tests  2 failed | 2 passed (4) | first failing: × index.html holds exactly one Content-Security-Policy meta 5ms | AssertionError: expected [ <meta …(2)></meta>, …(1) ] to have a length of 1 but got 2"
 },
 {
  "id": "W8A-T3-M3",
  "pkg": "pwa",
  "file": "index.html",
  "old": "    <meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'\" />\n    <meta name=\"description\"",
  "new": "    <meta name=\"description\"",
  "tests": "test/shell-csp.test.ts",
  "also": {
   "file": "index.html",
   "old": "    <title>ccrc</title>\n  </head>",
   "new": "    <title>ccrc</title>\n    <meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'\" />\n  </head>"
  },
  "red": "Tests  1 failed | 3 passed (4) | first failing: × it precedes the first script and the first style 3ms | AssertionError: expected 15 to be less than 6"
 }
]
```

Task 4:

```json
[
 {
  "id": "W8A-T4-M1",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "running = { job, timer: setTimer(() => expire(job), job.budgetMs) };",
  "new": "running = { job, timer: job.kind === 'render' ? undefined : setTimer(() => expire(job), job.budgetMs) };",
  "tests": "test/markdown-runner.test.ts",
  "red": "Tests  1 failed | 44 passed (45) | first failing: × a render job answers timeout at budgetMs and the worker is terminated 7ms | AssertionError: expected { state: 'pending' } to deeply equal { state: 'resolved', value: { …(2) } }"
 },
 {
  "id": "W8A-T4-M3",
  "pkg": "pwa",
  "file": "src/lib/readerRenderJob.ts",
  "old": "  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };\n",
  "new": "",
  "tests": "test/reader-render-job.test.ts",
  "red": "Tests  1 failed | 6 passed (7) | first failing: × a delimiter run the pre-scan refuses answers refused, before render runs 4ms | AssertionError: expected 'rendered' to be 'refused' // Object.is equality"
 },
 {
  "id": "W8A-T4-M4",
  "pkg": "pwa",
  "file": "src/lib/readerRenderJob.ts",
  "old": "{ maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES }",
  "new": "{ maxBytes: DOCS_RENDER_GATE_BYTES }",
  "tests": "test/reader-render-job.test.ts",
  "red": "Tests  1 failed | 6 passed (7) | first failing: × html past READER_HTML_MAX_BYTES answers not-rendered output-over-limit 599ms | AssertionError: expected [ { id: 3, outcome: { …(5) } } ] to deeply equal [ { id: 3, outcome: { …(2) } } ]"
 },
 {
  "id": "W8A-T4-M5",
  "pkg": "pwa",
  "file": "src/lib/markdownRunner.ts",
  "old": "{ id: job.id, kind: 'render', src: job.src }",
  "new": "{ id: job.id, src: job.src, profile: 'docs' }",
  "tests": "test/markdown-runner.test.ts",
  "red": "Tests  1 failed | 44 passed (45) | first failing: × a render job posts exactly {id, kind: render, src} 7ms | AssertionError: expected [ { id: 1, src: '# T', …(1) } ] to deeply equal [ { id: Any<Number>, …(2) } ]"
 },
 {
  "id": "W8A-T4-M2",
  "pkg": "pwa",
  "file": "src/lib/markdownWorker.ts",
  "old": "    (renderJob ??= import('./readerRenderJob')).then(\n      ({ answerRenderJob }) => answerRenderJob(e.data, (r) => worker.postMessage(r)),\n      () => undefined,\n    );",
  "new": "    answerRenderJob(e.data, (r) => worker.postMessage(r));",
  "tests": "test/markdown-purity.test.ts",
  "also": {
   "file": "src/lib/markdownWorker.ts",
   "old": "import { answerMarkdownJob, type MarkdownReply } from './markdownParse';\n",
   "new": "import { answerMarkdownJob, type MarkdownReply } from './markdownParse';\nimport { answerRenderJob } from './readerRenderJob';\n"
  },
  "red": "Tests  1 failed | 33 passed (34) | first failing: × the worker entry holds no static import of readerRenderJob 6ms | AssertionError: expected [ './readerRenderJob' ] to deeply equal []"
 }
]
```

Task 5:

```json
[
 {
  "id": "W8A-T5-M1",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "const target = docLinkTarget(ctx, link.fragment === null ? link.path : `${link.path}#${link.fragment}`);",
  "new": "const target: DocLinkTarget = { kind: 'in-app', href: link.path, fragment: link.fragment };",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  5 failed | 45 passed (50) | first failing: × relative /api/x is inert 5ms | AssertionError: expected { Object (kind, href, ...) } to deeply equal { kind: 'inert' }"
 },
 {
  "id": "W8A-T5-M2",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "hidden.length === 0 && ",
  "new": "",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × ESC, U+202E and U+200B each send the text to the sheet with their indices 4ms | AssertionError: expected 'write' to be 'sheet' // Object.is equality"
 },
 {
  "id": "W8A-T5-M3",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "host !== ownHost",
  "new": "host.split('.').slice(-2).join('.') !== ownHost.split('.').slice(-2).join('.')",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  2 failed | 48 passed (50) | first failing: × an external https link opens the sheet, foreign, with its host 5ms | AssertionError: expected { kind: 'sheet', …(4) } to deeply equal { kind: 'sheet', …(4) }"
 },
 {
  "id": "W8A-T5-M5",
  "pkg": "pwa",
  "file": "src/lib/router.ts",
  "old": "history.replaceState(history.state,",
  "new": "history.replaceState(null,",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × keeps history.state and does not notify 5ms | AssertionError: expected null to deeply equal { a: 1 }"
 },
 {
  "id": "W8A-T5-M6",
  "pkg": "pwa",
  "file": "src/lib/router.ts",
  "old": "history.replaceState(history.state, '', '#' + id);",
  "new": "history.replaceState(history.state, '', '#' + id);\n  dispatchEvent(new PopStateEvent('popstate'));",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × keeps history.state and does not notify 4ms | AssertionError: expected \"vi.fn()\" to not be called at all, but actually been called 1 times"
 },
 {
  "id": "W8A-T5-M4",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "  if (state.s === 'fallback' || state.s === 'plain') return state;",
  "new": "  if (state.s === 'fallback' && ev.e === 'mount') return { s: 'mounting' };\n  if (state.s === 'fallback' || state.s === 'plain') return state;",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × fallback is terminal for a body key 5ms | AssertionError: expected { s: 'mounting' } to be { s: 'fallback', reason: 'timeout' } // Object.is equality"
 },
 {
  "id": "W8A-T5-M7",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "  return palette === undefined ? { theme: 'auto' } : { theme: palette.mode };",
  "new": "  return { theme: 'auto' };",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  12 failed | 38 passed (50) | first failing: × the palette phosphor reads dark 5ms | AssertionError: expected { theme: 'auto' } to deeply equal { theme: 'dark' }"
 },
 {
  "id": "W8A-T5-M8",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "      return ev.budgetMs === undefined ? { s: 'plain', why: ev.why } : { s: 'plain', why: ev.why, budgetMs: ev.budgetMs };",
  "new": "      return { s: 'plain', why: ev.why };",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × plain carries the render budget of a timeout, and only then 5ms | AssertionError: expected { s: 'plain', why: 'timeout' } to deeply equal { s: 'plain', why: 'timeout', …(1) }"
 },
 {
  "id": "W8A-T5-M9",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "  if (themeChoice === 'system') return { theme: 'auto' };\n",
  "new": "",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × system and an unknown id map to auto 5ms | AssertionError: expected { theme: 'dark' } to deeply equal { theme: 'auto' }"
 },
 {
  "id": "W8A-T5-M10",
  "pkg": "pwa",
  "file": "src/docs/reader/policy.ts",
  "old": "  if (!SHEET_SCHEMES.includes(scheme)) return { kind: 'inert' };",
  "new": "  if (false) return { kind: 'inert' };",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × an external link whose URL does not parse, or whose scheme is outside the allowlist, is inert 5ms | AssertionError: expected { kind: 'sheet', …(4) } to deeply equal { kind: 'inert' }"
 }
]
```

Task 6:

```json
[
 {
  "id": "W8A-T6-M1",
  "pkg": "pwa",
  "file": "src/docs/reader/images.ts",
  "old": "rasterDataUrl(f.bytes, f.mime)",
  "new": "'blob:' + rasterDataUrl(f.bytes, f.mime)",
  "tests": "test/reader-images.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × a raster becomes a data:image/png;base64 URL in the library's image grammar | AssertionError: expected 'blob:data:image/png;base64,iVBORw0KGg…' to match the image grammar; no ReferenceError in the output"
 },
 {
  "id": "W8A-T6-M2",
  "pkg": "pwa",
  "file": "src/docs/reader/images.ts",
  "old": "if (plan.kind !== 'pinned' || plan.deferred) return;",
  "new": "if (plan.kind !== 'pinned') return;",
  "tests": "test/reader-images.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × index 30 and later are absent 5ms | AssertionError: expected [ 'i0.png', 'i1.png', 'i2.png', …(28) ] to have a length of 30 but got 31"
 },
 {
  "id": "W8A-T6-M3",
  "pkg": "pwa",
  "file": "src/docs/reader/images.ts",
  "old": "if (total + size > READER_IMAGE_BUDGET_BYTES) {",
  "new": "if (false) {",
  "tests": "test/reader-images.test.ts",
  "red": "Tests  2 failed | 9 passed (11) | first failing: × the byte budget stops adding 136ms | AssertionError: expected [ 'a.png', 'b.png', 'c.png' ] to deeply equal [ 'a.png', 'b.png' ]"
 },
 {
  "id": "W8A-T6-M4",
  "pkg": "pwa",
  "file": "src/docs/DocImage.tsx",
  "old": "if (typeof size === 'number' && size > cap)",
  "new": "if (false)",
  "tests": "test/docs-images.test.tsx",
  "red": "Tests  2 failed | 72 passed (74) | first failing: × an image listed over its class cap is refused too-large before any fetch; at the cap it loads 8ms | AssertionError: expected undefined to be 'Image not loaded: it is 2049 KiB; Doc…' // Object.is equality"
 },
 {
  "id": "W8A-T6-M5",
  "pkg": "pwa",
  "file": "src/docs/reader/images.ts",
  "old": "  return Math.floor(b64.length * 3 / 4) - pad;",
  "new": "  return 0;",
  "tests": "test/reader-images.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × an SVG counts its decoded size toward the budget, to the byte 209ms | AssertionError: 3145729: expected [ 'a.png', 'b.png', 'c.svg' ] to deeply equal [ 'a.png', 'b.png' ]"
 }
]
```

Task 7:

```json
[
 {
  "id": "W8A-T7-M1",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "mermaidDraw: 'on-request'",
  "new": "mermaidDraw: 'auto'",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true 6ms | AssertionError: expected 'auto' to be 'on-request' // Object.is equality"
 },
 {
  "id": "W8A-T7-M2",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "    focus: true,\n",
  "new": "    focus: true,\n    changes: async () => null,\n",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × the adapters are exactly ccrc's fourteen keys, with no changes or openVersion 6ms | AssertionError: expected [ 'assets', 'changes', 'copy', …(12) ] to deeply equal [ 'assets', 'copy', 'docKey', …(11) ]"
 },
 {
  "id": "W8A-T7-M3",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "storePrefix: READER_STORE_PREFIX",
  "new": "storePrefix: 'docreader:'",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  2 failed | 17 passed (19) | first failing: × mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true 4ms | AssertionError: expected 'docreader:' to be 'ccrc:reader:v1:' // Object.is equality"
 },
 {
  "id": "W8A-T7-M5",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/gate.js",
  "old": "maxFences: 24,",
  "new": "maxFences: 25,",
  "tests": "test/reader-assets.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × the Mermaid gate defaults are the spec's 24, 16384 and 131072 4ms | AssertionError: expected { maxFences: 25, …(2) } to deeply equal { maxFences: 24, …(2) }"
 },
 {
  "id": "W8A-T7-M6",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "iframe.setAttribute('sandbox', 'allow-scripts');",
  "new": "iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × M8.1 in jsdom: the installed mount's iframe has sandbox allow-scripts, referrerpolicy no-referrer, csp equal to frameCsp and to the srcdoc meta's content, and no src, name or allow 47ms | AssertionError: expected 'allow-scripts allow-same-origin' to be 'allow-scripts' // Object.is equality"
 },
 {
  "id": "W8A-T7-M7",
  "pkg": "pwa",
  "file": "src/docs/reader/assets.ts",
  "old": "assets/frame/reader.css?raw",
  "new": "assets/reader.css?raw",
  "tests": "test/reader-assets.test.ts",
  "red": "Tests  2 failed | 9 passed (11) | first failing: × each asset text's sha256 equals FRAME_MANIFEST's entry 57ms | AssertionError: expected '901ccd09d3377419f7db51e97ce336bfacb3a…' to be '99c87d57f9e2a944e2cec431705e5aa6004a4…' // Object.is equality"
 },
 {
  "id": "W8A-T7-M8",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "    setPrefs(p) {\n      if (destroyed) return;\n      frame.setPrefs({ theme: p.theme });\n    },",
  "new": "    setPrefs() {},",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × setPrefs forwards to DocFrame.setPrefs and never remounts 3ms | AssertionError: expected \"vi.fn()\" to be called 1 times, but got 0 times"
 },
 {
  "id": "W8A-T7-M9",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/csp.js",
  "old": "style-src 'unsafe-inline' data:;",
  "new": "style-src 'unsafe-inline' data: wss:;",
  "tests": "test/reader-assets.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × M8.2: the re-tokenised policy is exactly this map 5ms | AssertionError: expected { 'default-src': [ '\\'none\\'' ], …(6) } to deeply equal { 'default-src': [ '\\'none\\'' ], …(6) }"
 },
 {
  "id": "W8A-T7-M10",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/store.js",
  "old": "if (projected() > BRIDGE_LIMITS.storeBudgetBytes)",
  "new": "if (false)",
  "tests": "test/w7-storage-keys.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × a write that cannot fit without evicting the prefs, the current document or a non-document key is refused with budget and evicts nothing 6ms | AssertionError: expected { ok: true } to deeply equal { ok: false, reason: 'budget' }"
 },
 {
  "id": "W8A-T7-M11",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/store.js",
  "old": "if (utf8Bytes(value) > BRIDGE_LIMITS.valueMaxBytes)",
  "new": "if (false)",
  "tests": "test/w7-storage-keys.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × a value over 64 KiB is refused 5ms | AssertionError: expected { ok: true } to deeply equal { ok: false, reason: 'oversize' }"
 },
 {
  "id": "W8A-T7-M12",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "mermaidGate(document.scan.mermaid).inline",
  "new": "document.scan.mermaid.fences <= 24",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × M8.20: a doc over the total cap mounts with scan and no Mermaid text 4ms | AssertionError: expected \"vi.fn()\" to not be called at all, but actually been called 1 times"
 },
 {
  "id": "W8A-T7-M13",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "copy: (text, check) => input.copy(text, check.hidden),",
  "new": "copy: input.copy as never,",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × copy receives the library's check.hidden array; onLink receives a ReaderLink mapped from HostLink; onHash is forwarded; update is never called 5ms | AssertionError: expected last \"vi.fn()\" call to have been called with [ 'a\\u202e', [ { index: 1, …(2) } ] ]"
 },
 {
  "id": "W8A-T7-M14",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/store.js",
  "old": "evicted.add(doc);",
  "new": "",
  "tests": "test/w7-storage-keys.test.ts",
  "red": "Tests  1 failed | 18 passed (19) | first failing: × a store.set flood past 1 MiB evicts the oldest other documents, only ccrc:reader:v1: keys, stays within the budget and leaves ccrc.fleet-snapshot.v1 writable 25ms | AssertionError: expected 1080804 to be less than or equal to 1048576"
 },
 {
  "id": "W8A-T7-M15",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/store.js",
  "old": "docStorageKey(docKey, key.slice('doc:'.length))",
  "new": "`${docPrefix}${key.slice('doc:'.length)}`",
  "tests": "test/w7-storage-keys.test.ts",
  "red": "Tests  2 failed | 17 passed (19) | first failing: × a store.set flood past 1 MiB evicts the oldest other documents, only ccrc:reader:v1: keys, stays within the budget and leaves ccrc.fleet-snapshot.v1 writable 17ms | AssertionError: expected +0 to be 6 // Object.is equality"
 },
 {
  "id": "W8A-T7-M4",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/assets/frame/guard.js",
  "old": "ubmit\", (e) => preventDefault.call(e), true);\n  })();\n})();\n",
  "new": "ubmit\", (e) => preventDefault.call(e), true);\n  })();\n})();\n\n",
  "tests": "test/reader-assets.test.ts",
  "red": "Tests  1 failed | 10 passed (11) | first failing: × each asset text's sha256 equals FRAME_MANIFEST's entry 66ms | AssertionError: expected 'b9d6de41dd84fb5345380c48d94c2685f4f9e…' to be 'ff3c25da5703bc06d40ca0412b2e760c619a7…' // Object.is equality"
 },
 {
  "id": "W8A-T7-M16",
  "pkg": "pwa",
  "file": "src/docs/reader/bridge.ts",
  "old": "await Promise.race([(deps.mermaid ?? loadMermaidAsset)(), deadline])",
  "new": "await (deps.mermaid ?? loadMermaidAsset)()",
  "tests": "test/reader-bridge.test.ts",
  "red": "Tests  1 failed | 20 passed (21) | first failing: a Mermaid import that never settles mounts without scan once the watchdog passes, and a late chunk changes nothing | AssertionError: expected \"vi.fn()\" to be called 1 times, but got 0 times (test/reader-bridge.test.ts, after advancing the fake clock past the watchdog); the unbounded wait also leaves the unused deadline's rejection unhandled (1 Unhandled Rejection)"
 }
]
```

Task 8:

```json
[
 {
  "id": "W8A-T8-M1",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "    if (overGate) return undefined;\n    const ac = new AbortController();",
  "new": "    const ac = new AbortController();",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × M8.17: a doc over the render gate never renders or mounts, and shows the gate prompt 23ms | AssertionError: expected \"vi.fn()\" to not be called at all, but actually been called 1 times"
 },
 {
  "id": "W8A-T8-M2",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "      drop();\n      giveBack();\n      dispatch({ e: 'fallback', reason });",
  "new": "      drop();\n      giveBack();\n      dispatch({ e: 'fallback', reason });\n      void live.current.props.reader.mount(hostRef.current as HTMLElement, {} as ReaderMountInput);",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  2 failed | 36 passed (38) | first failing: × M8.11: onFallback unmounts, shows the fixed note, never shows the reason, and never mounts again 83ms | Errors  1 error"
 },
 {
  "id": "W8A-T8-M3",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "<p className=\"doc-plain-note\">{READER_FALLBACK_NOTE}</p>",
  "new": "<p className=\"doc-plain-note\">{`${READER_FALLBACK_NOTE} (${state.reason})`}</p>",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  6 failed | 32 passed (38) | first failing: × M8.11: onFallback unmounts, shows the fixed note, never shows the reason, and never mounts again 1058ms"
 },
 {
  "id": "W8A-T8-M4",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "          setAsk({ kind: 'link', ask: { url: r.url, host: r.host, foreign: r.foreign } });",
  "new": "          window.open(r.url, '_blank', 'noopener,noreferrer');",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  2 failed | 36 passed (38) | first failing: × M8.7: an external link opens the sheet, and window.open runs only on Open, with _blank and noopener,noreferrer 1058ms"
 },
 {
  "id": "W8A-T8-M5",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "      if (d.kind === 'sheet') {",
  "new": "      if (d.kind === ('sheet' as string) && false) {",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  3 failed | 35 passed (38) | first failing: × M8.19: a copy with hidden characters shows the sheet with a marker each, and copyText waits for its button 1057ms"
 },
 {
  "id": "W8A-T8-M6",
  "pkg": "pwa",
  "file": "src/screens/DocsScreen.tsx",
  "old": "reader = typeof Worker === 'function' ? DEFAULT_READER : null,",
  "new": "reader = DEFAULT_READER,",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × with no Worker, DocsScreen`s default reader is null and docsRunner.render is never called 18ms | AssertionError: expected \"render\" to not be called at all, but actually been called 1 times"
 },
 {
  "id": "W8A-T8-M7",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "        fallBack(`mount ${reasonOf(e)}`);\n        return;\n      } finally {",
  "new": "        throw e;\n      } finally {",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  3 failed | 35 passed (38) | first failing: × a rejected adapter import falls back with the fixed note 1004ms | Errors  3 errors"
 },
 {
  "id": "W8A-T8-M8",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "    seededPrefs.current = prefs;\n    m.setPrefs({ theme: prefs });\n  }, [prefs]);",
  "new": "    seededPrefs.current = prefs;\n  }, [prefs]);",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  2 failed | 36 passed (38) | first failing: × a theme change calls setPrefs once and never remounts 1059ms | AssertionError: expected \"vi.fn()\" to be called 1 times, but got 0 times"
 },
 {
  "id": "W8A-T8-M9",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "      drop();\n      giveBack();\n      dispatch({ e: 'fallback', reason });",
  "new": "      drop();\n      dispatch({ e: 'fallback', reason });",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × a fallback takes the drafts back once, and the unmount takes back nothing more 59ms | AssertionError: expected [ [ 2 ] ] to deeply equal [ [ 2 ], [ -2 ] ]"
 },
 {
  "id": "W8A-T8-M10",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "      if (cur.props.pendingFragment !== null) cur.props.onFragmentConsumed();\n      const latest",
  "new": "      const latest",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × hands the mount the document, the file name and the fragment, and spends the fragment 1057ms | AssertionError: expected \"vi.fn()\" to be called 1 times, but got 0 times"
 },
 {
  "id": "W8A-T8-M11",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "      copyText(d.text).catch(() => setAsk({ kind: 'copy-failed', ask: { text: d.text } }));",
  "new": "      copyText(d.text).catch(() => setAsk({ kind: 'copy', ask: { text: d.text, hidden: [], failed: false } }));",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  2 failed | 36 passed (38) | first failing: × clean text calls copyText directly; a rejected write opens the copy sheet 1059ms"
 },
 {
  "id": "W8A-T8-M12",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "    seededPrefs.current = prefs;\n    m.setPrefs({ theme: prefs });",
  "new": "    seededPrefs.current = prefs;\n    m.setPrefs({ theme: prefs });\n    m.setPrefs({ theme: prefs });",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  2 failed | 36 passed (38) | first failing: × a theme change calls setPrefs once and never remounts 1059ms | AssertionError: expected \"vi.fn()\" to be called 1 times, but got 2 times"
 },
 {
  "id": "W8A-T8-M13",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "onCopy={(a) => writeFromSheet(a.text, () => setAsk({ kind: 'copy', ask: { ...a, failed: true } }))}",
  "new": "onCopy={(a) => { setAsk(null); void copyText(a.text).catch(() => {}); }}",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × a Copy anyway that the clipboard refuses keeps the sheet open and says so 1069ms"
 }
]
```

Task 9:

```json
[
 {
  "id": "W8A-T9-M1",
  "pkg": "pwa",
  "file": "vite.config.ts",
  "old": "        globIgnores: ['**/mermaid.frame-*.js'],\n",
  "new": "",
  "tests": "test/reader-built.test.ts",
  "red": "Test Files 1 failed (1), Tests 6 skipped (6): the file's beforeAll vite build throws: Assets exceeding the limit: assets/mermaid.frame-*.js is 3.77 MB, and won't be precached"
 },
 {
  "id": "W8A-T9-M2",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(file) => file === 'src/docs/reader/bridge.ts']",
  "new": "(file) => file.startsWith('src/docs/')]",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a /host import in DocsLeaf is red 369ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M3",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "file.startsWith('src/');",
  "new": "file.startsWith('src/docs/');",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  4 failed | 49 passed (53) | first failing: × M8.10 planted: a message listener in lib/router is red 262ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M4",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "return file === (kind === 'iframe' ? 'src/docs/export/buildExport.tsx' : 'src/docs/export/policy.ts');",
  "new": "return file.startsWith('src/docs/');",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  6 failed | 47 passed (53) | first failing: × M8.10 planted: srcDoc and default-src none in DocsLeaf are red 316ms | AssertionError: expected [] to deeply equal [ …(2) ]"
 },
 {
  "id": "W8A-T9-M5",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(file: string): boolean => file === 'src/lib/markdownWorker.ts';",
  "new": "(file: string): boolean => file.startsWith('src/');",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.21 planted: a value import of readerRenderJob in ReaderFrame is red 374ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M6",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe'",
  "new": "ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe-off'",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a JSX iframe in DocsLeaf is red 353ms | AssertionError: expected [] to deeply equal [ 'src/docs/DocsLeaf.tsx docs:iframe' ]"
 },
 {
  "id": "W8A-T9-M7",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "n.text === 'MessageChannel') hit",
  "new": "n.text === 'MessageChannelOff') hit",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a MessageChannel in DocsLeaf is red 327ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M8",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "['window', 'self', 'globalThis'].includes(owner.text)",
  "new": "['window', 'globalThis'].includes(owner.text)",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a self.onmessage assignment in lib/router is red 309ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M9",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "ts.isIdentifier(target) && target.text === 'onmessage'",
  "new": "ts.isIdentifier(target) && target.text === 'onmessageOff'",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a bare onmessage assignment in lib/router is red 308ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M10",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (home === undefined || !home[1](file))",
  "new": "if (home !== undefined && !home[1](file))",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  2 failed | 51 passed (53) | first failing: × M8.10 planted: the bare package import in DocsLeaf is red 301ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M11",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(file) => file.startsWith('src/docs/reader/')]",
  "new": "(file) => file.startsWith('src/')]",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a /frame import in DocsLeaf is red 355ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M12",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(file) => file === 'src/docs/reader/assets.ts']",
  "new": "(file) => file.startsWith('src/')]",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: an /assets raw import outside assets.ts is red 295ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M13",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (/srcdoc/i.test(text) && ",
  "new": "if (false && /srcdoc/i.test(text) && ",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a srcdoc string in DocsLeaf is red 377ms | AssertionError: expected [] to deeply equal [ 'src/docs/DocsLeaf.tsx docs:srcDoc' ]"
 },
 {
  "id": "W8A-T9-M14",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "n.text.toLowerCase() === 'srcdoc'",
  "new": "n.text.toLowerCase() === 'srcdocOff'",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  2 failed | 51 passed (53) | first failing: × M8.10 planted: srcDoc and default-src none in DocsLeaf are red 336ms | AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]"
 },
 {
  "id": "W8A-T9-M15",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (/<iframe/i.test(text) && ",
  "new": "if (/<iframeOff/i.test(text) && ",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a string holding an iframe tag in DocsLeaf is red 315ms | AssertionError: expected [] to deeply equal [ 'src/docs/DocsLeaf.tsx docs:iframe' ]"
 },
 {
  "id": "W8A-T9-M16",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "/default-src\\s+'none'/i.test(text)",
  "new": "/default-src\\s+'none'/.test(text)",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: an upper-case default-src none string in DocsLeaf is red 319ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M17",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(ts.isIdentifier(callee) && callee.text === 'addEventListener') || memberName(callee) === 'addEventListener'",
  "new": "memberName(callee) === 'addEventListener'",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a bare addEventListener message listener in lib/router is red 307ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M18",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "if (use.value && !adapterUseAllowed(file, target, use.dynamic)) hit(",
  "new": "if (false && use.value && !adapterUseAllowed(file, target, use.dynamic)) hit(",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  3 failed | 50 passed (53) | first failing: × Library imports planted: a static import of ./reader/bridge in DocsLeaf is red 370ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M19",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "memberName(n) === 'onmessage') hit(n, 'docs:onmessage')",
  "new": "memberName(n) === 'onmessageOff') hit(n, 'docs:onmessage')",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: an onmessage member in DocsLeaf is red 310ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M20",
  "pkg": "pwa",
  "file": "vite.config.ts",
  "old": "globIgnores: ['**/mermaid.frame-*.js'],",
  "new": "globIgnores: ['**/mermaid.frame-*.js', '**/readerRenderJob-*.js'],",
  "tests": "test/reader-built.test.ts",
  "red": "Tests  1 failed | 5 passed (6) | first failing: × sw.js precaches the chunks that carry guard, bootstrap, enhance and the reader css 4ms | AssertionError: expected [ 'push-sw.js', …(24) ] to include 'assets/readerRenderJob-CdYRK6-z.js'"
 },
 {
  "id": "W8A-T9-M21",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "memberName(callee) === 'postMessage') hit(n, 'docs:postMessage')",
  "new": "memberName(callee) === 'postMessageOff') hit(n, 'docs:postMessage')",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × M8.10 planted: a postMessage call in DocsLeaf is red 349ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 },
 {
  "id": "W8A-T9-M22",
  "pkg": "pwa",
  "file": "test/docs-scans.test.ts",
  "old": "(file === ADAPTER_LOADER && dynamic)",
  "new": "(file === ADAPTER_LOADER)",
  "tests": "test/docs-scans.test.ts",
  "red": "Tests  1 failed | 52 passed (53) | first failing: × Library imports planted: a static import of ./reader/bridge or ./reader/assets in ReaderFrame is red; a literal dynamic import there is the one allowed use 427ms | AssertionError: expected [] to deeply equal [ Array(1) ]"
 }
]
```

Task 10:

```json
[
 {
  "id": "W8A-T10-M1",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "            if (loads === 1) {",
  "new": "            if (loads >= 1) {",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  2 failed | 21 passed (23) | first failing: × M8.B5: a second load gives the plain view with the fixed note 20521ms | AssertionError: a blocked self-navigation still fires a second load, and the reader falls back: expected 'timeout' to be 'fallback' // Object.is equality"
 },
 {
  "id": "W8A-T10-M2",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "iframe.setAttribute('sandbox', 'allow-scripts');",
  "new": "iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  21 failed | 2 passed (23) | first failing: × M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style 572ms | AssertionError: expected 'fallback' to be 'ready' // Object.is equality"
 },
 {
  "id": "W8A-T10-M3",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "            fail('navigated');\n        });\n        // The handles are published",
  "new": "        });\n        // The handles are published",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  1 failed | 22 passed (23) | first failing: × M8.B5: a second load gives the plain view with the fixed note 20491ms | AssertionError: a blocked self-navigation still fires a second load, and the reader falls back: expected 'timeout' to be 'fallback' // Object.is equality"
 },
 {
  "id": "W8A-T10-M4",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/document.js",
  "old": "        `<script>${p.guard}</script>` +\n        `<script type=\"application/json\">${p.seed}</script>` +",
  "new": "        `<script type=\"application/json\">${p.seed}</script>` +\n        `<script>${p.guard}</script>` +",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  21 failed | 2 passed (23) | first failing: × M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style 2329ms | AssertionError: expected 'fallback' to be 'ready' // Object.is equality"
 },
 {
  "id": "W8A-T10-M5",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/document.js",
  "old": "content=\"${p.policy}\">` +\n",
  "new": "content=\"${p.policy}\">` +\n        `<link rel=preconnect href=https://a.example>` +\n",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  21 failed | 2 passed (23) | first failing: × M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style 519ms | AssertionError: expected 'fallback' to be 'ready' // Object.is equality"
 },
 {
  "id": "W8A-T10-M6",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/document.js",
  "old": "content=\"${p.policy}\"",
  "new": "content=\"default-src *\"",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  21 failed | 2 passed (23) | first failing: × M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style 2333ms | AssertionError: expected 'fallback' to be 'ready' // Object.is equality"
 },
 {
  "id": "W8A-T10-M7",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/frame/seed.js",
  "old": "    return escapeSeedJson(JSON.stringify(seed));",
  "new": "    return JSON.stringify(seed);",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  1 failed | 22 passed (23) | first failing: × M8.8: a seed value with </script><script> and U+2028 round-trips inert, and ids named like every bootstrap global change nothing 400ms | AssertionError: the seed text holds no raw \"<\": expected true to be false // Object.is equality"
 },
 {
  "id": "W8A-T10-M8",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "iframe.setAttribute('sandbox', 'allow-scripts');",
  "new": "iframe.setAttribute('sandbox', 'allow-scripts allow-popups');",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  2 failed | 21 passed (23) | first failing: × M8.B4: window.open returns null, top.location= throws, and _blank is inert (a planted target=_blank link, and the author link) 2325ms | AssertionError: window.open returns null: expected 'window' to be 'null' // Object.is equality"
 },
 {
  "id": "W8A-T10-M9",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/dist/host/mount.js",
  "old": "                else\n                    refused();\n                return;\n            }\n            if (!parsed.ok || parsed.msg.t === 'ready') {",
  "new": "                else if (parsed.ok)\n                    effect(parsed.msg);\n                else\n                    refused();\n                return;\n            }\n            if (!parsed.ok || parsed.msg.t === 'ready') {",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "red": "Tests  2 failed | 21 passed (23) | first failing: × M8.B5: a navigate sent before ready has no effect 1104ms | AssertionError: no route: expected '/docs/demo/specs/other.md' to be '/docs/demo/specs/small.md' // Object.is equality"
 },
 {
  "id": "W8A-T10-M10",
  "pkg": "pwa",
  "file": "node_modules/@synapsium-labs/docserver/assets/frame/bootstrap.js",
  "old": "return}dt(n,O)}catch{N(\"boot\")",
  "new": "return}}catch{N(\"boot\")",
  "tests": "browser/reader-frame.browser.test.ts (browser config)",
  "also": {
   "file": "node_modules/@synapsium-labs/docserver/dist/frame/manifest.generated.js",
   "old": "bootstrap: { path: \"frame/bootstrap.js\", sha256: \"7660d62d5edc48db520205fd2d24041f409b35270b2739d5f43497abef06310c\", bytes: 27689, chars: 27689, csp: \"'sha256-dmDWLV7cSNtSAgX9LSQEH0CbNScLJznV9DSXq+8GMQw='\" },",
   "new": "bootstrap: { path: \"frame/bootstrap.js\", sha256: \"e956a98a06873a4b1593778eb4af438ff81a613706e418bb32230983c9e79089\", bytes: 27682, chars: 27682, csp: \"'sha256-6VapigaHOksVk3eOtK9Dj/gaYTcG5Bi7MiMJg8nnkIk='\" },",
   "why": "the library refuses an asset whose sha256 is not the manifest's, and the frame's CSP names the bootstrap by its hash, so the manifest entry is re-hashed for the edited text"
  },
  "red": "Tests  1 failed | 22 passed (23) | first failing: × M8.8: a seed value with </script><script> and U+2028 round-trips inert, and ids named like every bootstrap global change nothing 1422ms | AssertionError: no global the bootstrap guards reads as the element with its id (the pin holds): expected [ 'Buffer', 'Dimension', …(15) ] to deeply equal []"
 }
]
```

Task 11 (the held-out review's fixes):

```json
[
 {
  "id": "W8A-T11-M2",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "          version: cur.props.show.source === 'draft'\n            ? { sha: cur.props.show.head ?? null, draft: true }\n            : { sha: cur.props.show.commit ?? null, draft: false },\n",
  "new": "",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × refinement (k): a committed doc reaches the mount with its commit and no draft flag, a draft with its head and the flag 58ms | AssertionError: expected undefined to deeply equal { …(2) }"
 },
 {
  "id": "W8A-T11-M3",
  "pkg": "pwa",
  "file": "src/docs/ReaderFrame.tsx",
  "old": "        const reason = outcomeReason(outcome);\n        console.warn(`ccrc: reader not rendered (${reason})`);\n        goPlain(reason);\n",
  "new": "        console.warn(`ccrc: reader not rendered (${outcome.kind})`);\n        goPlain(outcome.kind);\n",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  6 failed | 32 passed (38) | first failing: × a refused render shows the plain view, mounts nothing, and names the render`s own reason in the console 11ms | AssertionError: the line carries the arm and its own reason: expected [ Array(1) ] to include 'ccrc: reader not rendered (refused: c…'"
 },
 {
  "id": "W8A-T11-M4",
  "pkg": "pwa",
  "file": "src/lib/readerLimits.ts",
  "old": "export const READER_COPY_WRITE_MAX_BYTES = 65536;",
  "new": "export const READER_COPY_WRITE_MAX_BYTES = 131072;",
  "tests": "test/reader-policy.test.ts, test/w7-storage-keys.test.ts",
  "red": "Tests  2 failed | 67 passed (69) | first failing: × the write cap is the library's own copy cap, so the library refuses an over-cap copy first and this is its backstop 5ms | AssertionError: expected 131072 to be 65536 // Object.is equality"
 },
 {
  "id": "W8A-T11-M5",
  "pkg": "pwa",
  "file": "src/lib/readerLimits.ts",
  "old": "export const READER_DOC_KEY_MAX_UNITS = 1024;",
  "new": "export const READER_DOC_KEY_MAX_UNITS = 2048;",
  "tests": "test/reader-policy.test.ts, test/w7-storage-keys.test.ts",
  "red": "Tests  2 failed | 67 passed (69) | first failing: × a key over 1024 code units is null 5ms | AssertionError: expected 'demo:specs:aaaaaaaaaaaaaaaaaaaaaaaaaa…' to be null"
 },
 {
  "id": "W8A-T11-M6",
  "pkg": "pwa",
  "file": "src/docs/ReaderSheets.tsx",
  "old": "        <pre className=\"docs-reader-sheet-text\">{marked.text}</pre>\n",
  "new": "",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  3 failed | 35 passed (38) | first failing: × M8.19: a copy with hidden characters shows the sheet with a marker each, and copyText waits for its button 67ms | AssertionError: expected '' to be 'a⟦U+001B ESCAPE⟧b⟦U+202E RIGHT-TO-LEF…' // Object.is equality"
 },
 {
  "id": "W8A-T11-M7",
  "pkg": "pwa",
  "file": "src/docs/reader/readerText.ts",
  "old": "    if (named < namedMax) {",
  "new": "    if (true) {",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × a copy with more hidden characters than the cap names the first ones, marks the rest without a name, and says how many 69ms | AssertionError: the named markers stop at the cap: expected 71 to be 64 // Object.is equality"
 },
 {
  "id": "W8A-T11-M8",
  "pkg": "pwa",
  "file": "src/docs/reader/readerText.ts",
  "old": "    host === ''\n      ? 'This link opens your mail app. Check the address before you open it.' // a mailto with no host to name\n      : `This link",
  "new": "    `This link",
  "tests": "test/reader-policy.test.ts",
  "red": "Tests  1 failed | 49 passed (50) | first failing: × a mailto with no host (empty, or recipients only in ?to=) still opens a sheet, and its warning never reads \"goes to .\" 4ms | AssertionError: expected 'This link leaves this console and goe…' not to match /goes to\\s*\\./"
 },
 {
  "id": "W8A-T11-M9",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": "\"$bounded\" 90 npm pack",
  "new": "npm pack",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  4 failed | 107 passed (111) | first failing: × the provenance script computes the integrity from the packed tarball, never from the lock (exact npm pack, tgz and actual lines) 5ms | AssertionError: the pack line: expected +0 to be 1 // Object.is equality"
 },
 {
  "id": "W8A-T11-M10",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": "\"$bounded\" 90 gh attestation verify",
  "new": "gh attestation verify",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  3 failed | 108 passed (111) | first failing: × the provenance script pins the library repo, its release workflow, the tag ref and hosted runners by exact text 6ms | AssertionError: exactly one verify line: expected [] to have a length of 1 but got +0"
 },
 {
  "id": "W8A-T11-M11",
  "pkg": "server",
  "file": "../.github/workflows/ci.yml",
  "old": "../.github/ci/bounded.sh 180 npm audit signatures",
  "new": "npm audit signatures",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  1 failed | 110 passed (111) | first failing: × build-pwa runs the provenance script before npm ci, then npm audit signatures, then vite build 6ms | AssertionError: expected [ …(4) ] to deeply equal [ …(4) ]"
 },
 {
  "id": "W8A-T11-M1",
  "pkg": "pwa",
  "file": "src/docs/docs.css",
  "old": "/* §4.1: the reader is sized to the Docs pane and the frame scrolls itself. A Docs page that holds the reader is one\n   pane tall: the shell is a viewport-tall column (the desktop grid already is), the pane and the screen and the leaf are\n   columns in turn, and the frame takes what the chrome above it leaves (never below `min-block-size`, where the pane\n   scrolls again). Every other Docs page, the plain view and the fallbacks keep the pane's own scrolling. */\n.app-shell:has(.docs-reader) { height: 100dvh; }\n.app-shell:has(.docs-reader) > .shell-detail { display: flex; flex-direction: column; min-block-size: 0; }\n@media (max-width: 899.98px) {\n  .app-shell:has(.docs-reader) { display: flex; flex-direction: column; }\n  .app-shell:has(.docs-reader) > .shell-detail { flex: 1 1 auto; }\n}\n.shell-detail > .docs-screen:has(.docs-reader) { display: flex; flex-direction: column; flex: 1 1 auto; min-block-size: 0; }\n.docs-screen:has(.docs-reader) > * { flex: none; }\n.docs-screen:has(.docs-reader) > .docs-leaf { display: flex; flex-direction: column; flex: 1 1 auto; min-block-size: 0; gap: var(--sp-2); }\n.docs-leaf:has(.docs-reader) > .doc-formatting { flex: none; }\n/* The frame fills its host by position, and the host takes the room by `flex-basis: 0`, so neither a percentage height\n   nor an auto flex basis has to resolve: the same in every engine. */\n.docs-reader { position: relative; flex: 1 1 0; inline-size: 100%; min-block-size: 20rem; }\n.docs-reader iframe { position: absolute; inset: 0; border: 0; inline-size: 100%; block-size: 100%; }\n",
  "new": ".docs-reader { inline-size: 100%; block-size: calc(100dvh - var(--sp-12)); min-block-size: 20rem; }\n.docs-reader iframe { border: 0; inline-size: 100%; block-size: 100%; }\n",
  "tests": "browser/reader-frame.browser.test.ts -t \"sized to the Docs pane\" (browser config)",
  "red": "Tests  1 failed | 22 skipped (23) | first failing: × the reader is sized to the Docs pane and only the frame scrolls, at 1280x800 and 390x844 1006ms | AssertionError: the reader is one pane tall and only its frame scrolls, at both sizes: expected [ …(5) ] to deeply equal []"
 },
 {
  "id": "W8A-T11-M12",
  "pkg": "pwa",
  "file": "src/docs/docs.css",
  "old": ".shell-detail > .docs-screen:has(.docs-reader) { display: flex; flex-direction: column; flex: 1 1 auto; min-block-size: 0; }\n",
  "new": "",
  "tests": "browser/reader-frame.browser.test.ts -t \"sized to the Docs pane\" (browser config)",
  "red": "Tests  1 failed | 22 skipped (23) | first failing: × the reader is sized to the Docs pane and only the frame scrolls, at 1280x800 and 390x844 1051ms | AssertionError: the reader is one pane tall and only its frame scrolls, at both sizes: expected [ …(4) ] to deeply equal []"
 },
 {
  "id": "W8A-T11-M13",
  "pkg": "pwa",
  "file": "src/docs/reader/readerText.ts",
  "old": " || text.codePointAt(h.index) !== h.codePoint",
  "new": "",
  "tests": "test/reader-policy.test.ts, test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 87 passed (88) | first failing: × skips an entry out of range or naming another character, and that character stays as it is 5ms | AssertionError: expected { text: 'a⟦U+001B ESCAPE⟧b', …(1) } to deeply equal { text: 'a​b', unnamed: +0 }"
 },
 {
  "id": "W8A-T11-M14",
  "pkg": "pwa",
  "file": "src/docs/ReaderSheets.tsx",
  "old": "{READER_SHEET_TEXT.copyByHandMarked}",
  "new": "{READER_SHEET_TEXT.copyByHand}",
  "tests": "test/reader-frame.test.tsx",
  "red": "Tests  1 failed | 37 passed (38) | first failing: × a Copy anyway that the clipboard refuses keeps the sheet open and says so 71ms"
 },
 {
  "id": "W8A-T11-M15",
  "pkg": "server",
  "file": "../.github/ci/library-provenance.sh",
  "old": " --silent || { echo \"library-provenance: npm pack failed or passed its deadline twice\" >&2; exit 1; }",
  "new": " --silent >/dev/null",
  "tests": "test/ci-pipeline.test.ts",
  "red": "Tests  2 failed | 109 passed (111) | first failing: × the provenance script computes the integrity from the packed tarball, never from the lock (exact npm pack, tgz and actual lines) 5ms | AssertionError: the pack line: expected +0 to be 1 // Object.is equality"
 }
]
```

### Measurements

- **Provenance (Task 2).** `bash .github/ci/library-provenance.sh`: rc 0, last line `library-provenance: @synapsium-labs/docserver@1.0.0 was built by Synapsium-Labs/docserver/.github/workflows/release.yml at refs/tags/v1.0.0`. Negative control with `--repo Synapsium-Labs/ccrc-pwa`: rc 1, `Error: HTTP 404: Not Found` (no attestation of that tarball in this repository). No escalation.
- **jsdom (Task 7 Step 0).** `MessageChannel` exists and an `iframe`'s `srcdoc` loads, so the real-mount cases and W8A-T7-M6 stay in Task 7.
- **Worst case (Task 10).** A 512 KiB document (524 288 bytes), 30 images totalling 5 242 880 bytes, and a passing Mermaid gate with 6 fences (57 295 elements in the frame): srcdoc 13 540 112 characters; main-thread mount 102-112 ms; ready 1.41-1.46 s after the mount starts, against a 10 s watchdog; all 30 images decoded. Final `READER_IMAGE_BUDGET_BYTES` = 5242880 (unchanged).
- **Mermaid chunk (Task 9).** `assets/mermaid.frame-_6G3RlMM.js`, 3.77 MB, not in `sw.js`'s precache; the `readerRenderJob` chunk is precached.
- **E14.** The shell meta `script-src 'self'` is inherited by the srcdoc, its inline scripts do not run, and the 2 s watchdog falls back to the plain view with the fixed note.
- **E15.** Five figures (flowchart, sequence, gantt, two hostile) each show Render; none is drawn before the tap and all five are drawn after, one svg each; no style carries the hostile `themeCSS` payload; the loose-level `img` label and click binding reach neither origin.
- **E16.** `history.pushState` in the frame throws SecurityError (the console's URL and history length unchanged); `clipboard.writeText` in the frame rejects NotAllowedError; a Copy tap on a block holding ESC reaches the parent's copy sheet, which names U+001B.
- **Sizing (Task 11).** 1280x800: the reader spans 277-792 px, the iframe is 515 px, the pane ends at 800 and nothing outside the frame scrolls. 390x844: 230-836 px, iframe 606 px, nothing outside the frame scrolls.

### Named, without a number

These were judged fills of a silence or choices of measurement, not departures from a spec sentence: the vitest `css` include line for `.css?raw` imports (Task 7); `w7-storage-keys`' red at Task 7 was a whole-file import failure, not the plan's predicted case (the rows carry the red); Task 10's pre-ready navigate clause is driven from the parent's end of the port (W8A-T10-M9), because a Playwright init script reaches the srcdoc frame early in some loads and late in others; and `pageStorage` is retyped to return the enumerable port, with `enumerablePageStorage` delegating to it (Task 11's one guard body): the same store, no behaviour change.

### Carried, not fixed

- Task 4's `answerRenderJob` mirrors `answerMarkdownJob` (a third `errorName`), as the plan mandates.
- `docs/reader/images.ts` (L3) imports `DocImage.tsx` (L4) for the plain view's pin rule; a ring bend, gone when W6's planner replaces the path.
- `pwa/package-lock.json` re-syncs the stale `../ui` link entry's ranges (metadata only, equal to `ui/package.json`).
- A failed image load, a 401 included, is left out of the reader (Task 6 Decision (2)); the plain view retries after sign-in, the reader on remount. W6 replaces the path.
- A render chunk that fails to load in the worker ends as the timeout note (plan Task 4 Step 6); the chunk is precached.
- The copy check flags exactly §4.4's "Hidden characters in a copy" set (U+202A-202E, U+2066-2069, U+200B-200D, U+2060, U+FEFF), the library's set and W8a's accepted floor. U+200E, U+200F, U+061C and the tag characters U+E0000-E007F are not flagged; extending the set is a spec and library change that has been put to the operator.
- `.github/ci/bounded.sh`'s header still says it bounds an install command; it now also bounds the pack, the attestation lookup and the signature audit.
- `build-pwa` keeps `attestations: read` as the plan specifies; whether the step needs it is measured on the pull request's run.
- The frame's click net cannot see a non-composed click inside a shadow root; only library code can make one (raw HTML is off), and the sandbox is the wall (W8A-T10-M8).
- Only Chromium is measured; the phone steps E17 and E18 follow rollout.
- Fixed waits before "nothing happened" checks in the jsdom and browser tests; one jsdom case matches vitest's own mocking error text.
- `docs/reader/policy.ts` (L1) imports a type from `DocLink.tsx` and `docLinkTarget` from `docsLinks.ts`, which reaches a hook module; the fix needs those two files, outside this wave's edit list. The adapter-import scan lets any file under `docs/reader/` import `/frame`.
- Browser-battery control gaps, for W8b beside E17 and E18: no row reds the M8.B1 meta-only assertion itself (the planted rows red through the boot gate); the `parent.postMessage` navigate case has no control; and the battery's `iframe` channel cannot tell the frame's policy from the shell's inherited `frame-src 'none'`.

## Where things stand

### Agreed
- The operator's ruling of 2026-10-31, applied as written: W8a now, beside W5h-a and Share; W8b after W5b; W7 last; images as the plain view shows them; Mermaid gated and drawn on tap; the colouring difference accepted for now; done means live.
- Ruling (2)'s check: `./host` does not conflict with ccrc's rings, adapter or null rules; ccrc mounts with it through one adapter file, and keeps the ccrc-owned mount on `./frame` in reserve.
- W8a owns the shell's `frame-src 'none'` meta; W6 references it.
- The reader serves documents up to the base render gate (512 KiB); larger ones read plain until Task 10's measurement supports more.

### Waiting on you
- Your review of this plan, and of the spec amendment the ledger PR carries (its edits cover refinements (a)-(f), (i), (j) and (o); (g) and (h) are plan-only).
- After the merge and rollout: the phone steps E17 (M8.B7, is the console live with a heavy-Mermaid doc) and E18 (M8.B8, do the walls hold on your phone's engine). Auto-draw for Mermaid is one adapter value after E17.
- Only if Task 2 finds no GitHub attestation for 1.0.0, or Task 10 forces the image budget below 2 MiB, or a library behaviour differs from the architecture: a structured ask, mid-wave.

### Later
- W8b after W5b: "changes since" (G5), the version menu (G6), `at=<sha>`, `only`, the seed's history.
- W6: mockups and the asset planner, which replaces W8a's image path; W6 widens the `pwa/src/docs` scan for `MockupFrame.tsx` and Export.
- W7, last: README prose for the reader (A22) and the carried W7 residue.
- One colouring for both paths (the library's `./highlight` in W5h's worker), only if you ask for it.
- Raising the reader's size gate toward 2 MiB, once Task 10's figures support it.
- Retiring the standalone docs server: a separate gate after W8b, W7, E17 and E18 (§9).
