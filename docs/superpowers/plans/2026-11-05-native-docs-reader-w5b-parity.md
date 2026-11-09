# Native Docs reader, W5b: parity, the server half (six sections, per-doc history, the version key) — Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as TWO runs, one after the other (see "The split" and "How this wave runs"). Each run's worker executes its own tasks with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 3 (2026-11-07), Q1 a, Q2 a and Q3 two runs approved through console item 50: “Approve with every recommendation (Q1 a, Q2 a, Q3 two runs)”. Rev 2 applied the plan review's 27 confirmed findings. The answers are recorded here; exact-tip checks, amendment review and plan landing remain before dispatch. Approval is not a claim that CI, merge or implementation occurred. Base: `origin/main` at `d32c339d3ae36daad3d4cbc4d8f06fb2d24892f3` (the programme's ledger PR #2345). Every Find block below is quoted from that commit. The library 1.1 take-up (open PR #2346's plan) merges before W5b-1 is dispatched, and W5b-1 merges before W5b-2 is dispatched, so **each run's Task 1 re-checks its own Find blocks against its dispatch base** with one script; a miss is a stop-and-ask. "Overlap with the take-up wave" below names every Find block in a file the take-up also edits, and why the take-up leaves it matching. This plan replaces nothing.

**Goal:** ccrc's Docs reader reaches the standalone docs server's parity on the server side. A project shows six sections (`vision` and `promise` join the four), and a fleet box that predates them still shows four, with no `?` and no failed listing. Each doc has a read-only history (the newest 100 commits that changed it, with parent, date, author and subject), served at `GET /api/docs/:project/history`. A doc can be opened at any commit with `at=<sha>` in its page URL: the header names the version and links back to the latest, its images and links stay at that version, and Share links that version only when origin is known to hold it. W8b's version menu and "changes since" then build on these, inside the frame.

**Architecture:** the same four layers W1-W3 built, one row more in each. ccd: `SECTIONS` gains two pairs and `ccd caps` says `docs-sections-v2`; a fifth verb, `docs-log`, has its bash front, its helper section `# ===== docs: log =====`, one fixed `git log` row in the hardened runner's allowlist, and `docs-log-v1`. Agent: one grant, enrolled. Server: one builder and one cap row (`ccdargv.ts`), one runner budget row, a section gate and a log arm inside the adapter's one gated executor (`ccdsource.ts#readDocs`), a query parser, a shape check and a lane job in L1 (`policy.ts`), a port operation (`ports.ts`), and a fifth route (`routes.ts`). L0 (`shared/docs.ts`) declares the sections, the log vocabulary and its caps once, and the page key `at`. PWA: the section tables and one reader of each section field (`docsTree.ts`); the version view through the one location builder (`docsLinks.ts#docsLocation`), the visit's pin (`useDocsVisit.ts#pinFor`), the header's truth line, one banner, and Share's re-derived rule; and the history loader.

**Tech stack:** bash and python 3.8 (stdlib only) inside `ccd/ccd`; TypeScript (server, agent and pwa `tsc`, strict); Fastify 5 (`inject` in tests); React 19; vitest (node and jsdom; `typecheck` on); the agent's bypass fixtures (TS2322 by `tsc`); the browser leg (`vitest.browser.config.ts`, run locally); git 2.43 on the fleet box (`--end-of-options` on `log` needs 2.24).

**Spec:** `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (the rich-docs spec): R-d, §6 (G1, G4, G6 and the parity table), §7 (A11, A12, A14, A19, A23), §7.3 (M9.2-M9.9, M9.11-M9.13), §8 (the W5b row, Figure 3), §10 (RD16, RD17, RD19, RD23, RD29). `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (the base spec): §2 (a) verbs, caps, budgets and the runner, §2 (b) wire and redactor, §3.1 and §3.4 (pages and routes), §3.13 (census), §4.3-§4.5 (visit, views, truth line, banners), §4.11 (`imagePinFor`), §4.13's "Share on a version view (W5b)", §4.16, §7.1 (skew), §7.2 (doctor), §7.7's W5b row.

**Ruling:** R-d (2026-10-12, "doc's address - yes": `at=<sha>`); RD23 (2026-10-13: W5b after W5); A23 (W5b is rolled `--server-first`). Q1 to Q3 below are this wave's own.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md` (Waves row 5b; "Carried constraints"). The coordinator's ledger PR records this plan, the split and the answers.

**Branch rule:** commit on the workspace branch, never a separate feature branch (a feature branch wedges every close with `stale-tip`).

**Format:** Markdown. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans; each run's Task 1 find-check reads this file's `Find (...)` blocks of its own run, and each close task parses its run's `### Task` headings and JSON row fences. Task numbers run on across the two runs (1-13, then 14-22), so every heading and row id is unique.

## Execution consistency amendment (2026-11-07)

Known departures are allocated **and defined in the same act** in the coordinator ledger at run-open, before dispatch: W5b-1 (a), (b); W5b-2 (m), (n), (p), (q), (t). Close steps reconcile/copy those definitions, never mint or defer known definitions. Every required review names actual model/effort; the completion plan's three-lens/critical-important-three-refuter contract supersedes older single-refuter wording. Any PR-body or mutation scratch path shown under `.superpowers/` in historical instructions is instead created under the session temp root; task notes that are intended committed evidence remain task notes, not scratch.

## Operator answer receipt (2026-11-07)

Console item 50 records the actual choice: keep `ref` beside `at` in the URL (Q1 a); body links stay at the version (Q2 a); two sequential runs (Q3). The alternatives at the end remain audit history, not unanswered questions. Item confirmation acknowledges recording this answer; it does not impersonate the operator's tick or assert implementation. The completion spec/plan of 2026-11-07 places these runs after A and before W6/W8b/W7.

## The split

W5b runs as **two runs, each with its own plan section, PR and review**:

| Run | Scope | Boxes | Why it is one review |
|---|---|---|---|
| **W5b-1** (Tasks 1-13) | G1 everywhere (L0, ccd, server gate, the PWA's tables and readers), G4's whole server half (L0 vocabulary, ccd verb and helper, agent grant, builder, budget, adapter, policy, route, censuses), the doctor's token check, the growth waiver, the spec text | fleet (ccd, agent), server, PWA (sections only) | One wire change across the boxes. `DOC_SECTIONS` and ccd's `SECTIONS` are held equal by `docs-parity.test.ts`, and the PWA's section tables are `Record`s over the L0 type, so G1 cannot land on one box only without a red suite or a broken build. |
| **W5b-2** (Tasks 14-22) | G6's key and page (the page grammar's `at`, the visit's pin, links and images at the version, the truth line, the banner, Share's version rule) and the history loader `api.docs.history` | PWA only (the page grammar lives in L0, which the server compiles but never calls) | One user-facing behaviour, read by one PWA lens set. No route, wire field or argv. |

**Why not one run.** W5b-1 alone touches about 45 files across four packages (W1 needed 19 tasks in one run; W2 and W3 were two runs). Adding the version view would put a third, unrelated review lens (page grammar and UX) on the same PR.

**Why not three.** G1 could stand alone (Tasks 2-4, then the waiver for its few ccd lines), but it shares the caps block, the parity block, `shared/docs.ts`'s wire types and the adapter's gate with G4, so a third run would re-open the same files one PR later. Tasks 2-4 come first in W5b-1 so the coordinator can still cut there (Q3).

**`main` stays consistent after each merge** (each merge is a prerelease the operator may roll):
- **After W5b-1:** server and PWA know six sections and the history route. Over a four-section fleet (old ccd, no `docs-sections-v2`, no `docs-log-v1`), the PWA shows four section rows and four counts, a `vision` or `promise` page says the fleet box does not serve it yet, and every request naming those sections or `docs-log` answers `unsupported` with zero execs (M9.3, M9.9). Over a six-section fleet, everything is served. Rolled `--server-first` (A23), because a W5-era server would refuse a tree that holds a `vision` entry (`server/src/docs/policy.ts:841-845`, `entryOk` holds every entry to `isDocsSection`): fleet first would break every tree of a project with such docs until the server moved.
- **After W5b-2:** the PWA adds the version view and the loader; the server and ccd are unchanged from W5b-1. Its own change is order-free, but only once both boxes run W5b-1 or later. Every merge is a prerelease, and a W5b-2 tag (or any later wave's) carries W5b-1's ccd and server too, so **the server-first order applies to the first rollout that carries W5b-1's commit, whichever tag that is**: W5b-1's own, W5b-2's, or a later wave's. Rolled fleet first over a W5-era server, it would break every tree that holds a `vision` or `promise` entry, as above.
- **A cached older PWA can meet the new server:** a phone keeps its PWA until its service worker updates. That older PWA lists and counts only the four slugs it knows (its `DOC_SECTION_SLUGS` loops), ignores `vision` and `promise` entries and index keys, and refuses a `vision` or `promise` page URL as `bad-section`, so nothing breaks.

## What the base says (each checked at `d32c339d3`, each handled below)

- **Sections.** `shared/docs.ts:21-29` declares the four in `DOC_SECTIONS`; `:31-39` derive `DocSectionSlug`, `DOC_SECTION_SLUGS` and `isDocsSection`; `:111` derives `DOCS_SECTION_RE_BODY`. ccd's parity copy is `ccd/ccd:41954` (`SECTIONS`), from which `SECTION_RE` (`:41961`), the listing's section bytes (`:43216`), the tree's one `ls-tree` (`:43315`), the index's counts (`:43550-43561`) and `sectionsOnDisk` (`:43526-43537`) all derive. `server/test/docs-parity.test.ts:361-363` holds the two equal as ordered pairs. The PWA's tables are `Record<DocSectionSlug, …>` (`pwa/src/docs/docsTree.ts:12-26`, `:79-84`), so a new slug is a compile error there until placed (`:3-4` says so).
- **Readers of the section fields.** `DocsTreeOk.sections` is commented "All four" (`shared/docs.ts:497-498`) and read once, by `ProjectPage` (`pwa/src/docs/DocsTreeView.tsx:45-48`), which already skips a slug the answer lacks. `DocsIndexOk.projects[].sections` is a full `Record` (`shared/docs.ts:571`) read twice: `hasDocs` (`pwa/src/docs/DocsIndexView.tsx:32`) and `sectionCountsText` (`pwa/src/docs/docsTree.ts:86-93`), which renders a missing key as `undefined ?? '?'`, so an old fleet's row would read `? vision · ? promise`. `ListingPage` shows "Nothing is listed here." for a section the answer does not hold (`DocsTreeView.tsx:116`), and `MissingPage` "Not in this listing" (`:150-156`).
- **The server does not check the sections array**, only each entry's slug (`server/src/docs/policy.ts:841-845`, `:863-876`).
- **The gate.** `server/src/docs/ccdsource.ts:117-143` (`readDocs`) is the one gated executor: `caps-unknown` (`:118-119`), then `ccdCan` of the call's own row (`:120-123`), then one `switch` that builds every read argv. `verb-gate.test.ts` reads the nearest enclosing function of each `CCD_ARGV.docs*(` for a `ccdCan(` naming that row (`ccdsource.ts:12-14`). `DOCS_CAP` is `server/src/ccdargv.ts:1247`; the docs rows of `CCD_CAN` are `:1479-1481`; `capSupported` is `:1350`; cap tokens are spelled once in `server/src` and held equal to ccd's echo by `server/test/ccd-archive.test.ts:209-211` over `server/test/ccdCapTokens.ts:8`.
- **The verbs.** Each docs verb is a bash front (`ccd/ccd:41864-41901`), `_docs_front` (python and redactor probes), and `_docs_py`, one embedded helper (`:41903-45518`) whose sections are marked `# ===== docs: <name> =====` and pinned in order by `docs-parity.test.ts:237-243`. The helper reads values by fixed index (`:42161-42168`, `read_args` `:42177-42218`), bounds every call (`HELPER_DEADLINE_S`, `CALL_S` `:42243-42244`), runs git only through `docs_git` (`:42673-42698`) behind `READ_ALLOW` (`:42568-42574`), `NEVER_FLAGS` and the no-colon rule for `OBJECT_NAME_VERBS` (`:42579-42580`, `:42626-42627`), drops every `GIT_*` from the environment and sets `GIT_NO_LAZY_FETCH=1` (`:42632-42643`), redacts through the pinned node redactor (`redact` `:42032`), and writes one line through a final guard (`guard_listing` `:43358-43377`, `guard_show` `:45100-45117`, `run` `:45453-45501`). The caps lines are `ccd/ccd:9326-9337`; the dispatcher arms `:45784-45787`; the usage line `:45789`.
- **`log` is never used today** (base spec §2 (a), "Never used"); `cat-file --batch-check` classifies a commit (`ccd/ccd:44963-44979`), and `on_ref` measures ancestry, calling a shallow repository's rc 1 `unmeasured` (`:45050-45067`).
- **`ccd/ccd` needs no restamp.** It is stamped when it is installed (`README.md:8199-8206`); the rich-docs spec's W5b row still says "`ccd/ccd` is restamped" (§8), which predates that rule.
- **The growth check is armed.** `ccd/ccd` is a listed file (`server/test/growth-check.test.ts:56-67`); a listed file that grows by more than `GROWTH_LIMIT` (40, `server/test/growthCheck.ts:48`) net code lines fails unless the PR adds a waiver file in `server/test/growth-waivers/` citing an issued number (`growth-check.test.ts:26-31`). A docs verb is about 100 net code lines (heredoc bodies count, `growthCheck.ts:148-180`).
- **Grants.** `agent/src/whitelist.ts:352-367` (`REQUIRED_VERB_FLAG`, docs at `:357`), the docs grants `:635-648`; bypass fixtures `agent/test/types/bypasses/g16`-`g19` (docs), the highest number `g27`.
- **Budgets.** `server/src/remote/runner.ts:162-179`; `server/test/docs-budget.test.ts:40-67` and `:117-160` hold each runner budget above helper deadline + `KILL_GRACE_S` + `REDACT_BUDGET_MS` + 5 s.
- **Routes and census.** `server/src/docs/routes.ts:227-292` registers three reads; `server/test/auth-gate.test.ts:342` (`toBe(4)`), `:542` (`toBe(183)`), `:592-593`; `server/test/box-token-census.test.ts:1057-1058` (`DOCS_DOORS`); `server/test/docs-headers.test.ts:461-490` (M5.4's keys and recipes); `server/test/docs-routes.test.ts:1055-1056`; `server/test/secret-mask.test.ts:1243-1245`.
- **The doctor.** `ccd/ccrc-doctor-checks:6800-6923` (`_check_docs`) runs `docs-index` only; the fixture stub prints one line whatever its argv (`server/test/docsIndexFixtures.ts:86-89`), and the ready fixture carries four section keys (`:34-46`).
- **Pages.** `shared/docs.ts:1053` (`DOCS_PAGE_KEYS = ['ref','view','frame']`), `:1054-1056` (pin keys refused as `commit-in-page`), `:1058-1066` (the location and its failures), `:1087-1094` (canonicalisation), `:1146-1206` (`parseDocsPage`), `:1214-1232` (`docsPageUrl`). `docsLocation` (`pwa/src/docs/docsLinks.ts:120-138`) is the one location builder (the W5 part 1 plan's refinement (q): "W5b adds `at` in one place"); `pwa/src/docs/DocsIndexView.tsx:20-22` already names "W5b's `at`".
- **The visit.** `pinFor` (`pwa/src/docs/useDocsVisit.ts:97-114`) always pins at `tree.ref.commit`; `fileKey` (`:85-91`) keys a committed body by the LISTING's blob, whatever the pin's commit; `wantedFile` (`:213-226`) pre-checks the listing's size; `applyFile` (`:520-528`) re-lists on `DOCS_RELIST_WORDS` (`pwa/src/docs/docsText.ts:284-285`, `unknown-commit` among them). `DocsLeaf`'s body key is the answer's blob (`pwa/src/docs/DocsLeaf.tsx:201-204`), and the reader is keyed by it (`:221-225`).
- **Images.** `imagePinFor` (`docsLinks.ts:203-231`) pins at `tree.ref.commit`; `DocImage` rebuilds the leaf from `DocLinkContext` (`pwa/src/docs/DocImage.tsx:66-71`), and the reader's images go through the same planner (`pwa/src/docs/reader/images.ts:43`).
- **Header, banners, Share.** `leafSource`, `truthSource`, `TruthLine` and `rowBadge` (`pwa/src/docs/DocsHead.tsx:105-143`, `:441-502`, `:756-762`); `useHeadActions` offers Open committed version (`:660-666`); the not-contained banner (`pwa/src/docs/DocsBanners.tsx:141-157`); `shareTargetFor` uses the opened pin's commit and judges the served ref's tip (`pwa/src/docs/share.ts:80-138`, the judgement at `:91`); base §4.13 says W5b re-derives Share's rows for a version view.
- **Loaders.** `api.docs` is typed `DocsLoaders` (`pwa/src/lib/api.ts:957`; `pwa/src/docs/failures.ts:57-63`), which 13 test files fake.
- **Results go into this plan** with a `Ledger-Edit:` trailer on the head commit (`.github/ci/ledger-guard.mjs:13-17`; RL-b's merge `ce55b1ca9` did so).

## Global Constraints (both runs)

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). No test reaches a network.
- **FIXTURE HOME.** Every ccd case runs the shipped dispatcher under `makeCcdHarness` (`server/test/ccdWsHelpers.ts`) through `runCcdDocs`, with git recorded at PATH level by `plantGitRecorder` (`server/test/ccdDocsHelpers.ts`); quote every fixture path. Fixture names: projects `demo`, sections `specs`, `vision`, `promise`, GitHub slug `example-org/example-repo`.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules`. Install `server/`, `agent/`, `pwa/` and `ui/` modules once (`npm ci` in each). A fixture repository with 120 commits (M9.13) lives in the harness HOME and is reaped with it. Mutation rows run **in the workspace**, sequentially: save the file to `$HOME/.cc-tmp/w5b-mut/<id>.orig` with its sha256, apply the row (the `Edit` tool, exact unique match), run the row's tests, record the red line, restore from the saved copy (never `git checkout`), check the sha256 and that `git status --porcelain` is unchanged. Bounded: `timeout -k 10 600` (`timeout -k 10 900` for a browser row) and `ulimit -u 4096`. `$HOME/.cc-tmp/w5b-mut/` is removed at each close.
- **Rings and seams.** `shared/docs.ts` stays L0 (imports only `./redact.mjs` and `./utf8.js`, pure ASCII). `server/src/docs/policy.ts` imports only `shared/` and spells no cap token (`policy.ts:9-10`). `ports.ts` stays type-only. `ccdsource.ts` stays L3 (no fastify, no reply, no timer) and keeps ONE gated executor for reads. `routes.ts` decides nothing. `pwa/src/docs/docsTree.ts` stays pure. No overloaded null at a seam: `sectionFacts` → `null` means only "this ccd serves no such section"; `DocsLogEntry.parent` → `null` means only "a root commit"; `DocsPathLocation.at` → `null` means only "the latest"; a `path` target's `at` absent means "the page's own", `null` "the latest".
- **Never spelled by this wave:** in shipped source (`server/src`, `shared`, `pwa/src`, `agent/src`), a cap token anywhere but its constant and docstring in `server/src/ccdargv.ts` (`capsupported.test.ts` counts the spellings there); its other spellings are ccd's echo lines, `ccdCapTokens.ts` and the doctor's one literal bound by `docs-parity.test.ts`, and a test may name the words; a grammar body or a section list outside `shared/docs.ts` and ccd's parity block; a numeric line citation (`file.ts` + colon + line, or `ccd:` + digits) in any code or test file (`server/test/citations.test.ts`: cite `file#symbol`); a `D-` number anywhere but `## Deviations found` and the issued number's growth-waiver file, except the numbers already defined that existing code comments cite (a comment this wave rewrites keeps its citation); a placeholder deviation token in any commit; real host, user, project, account or path names; `"refused":`, `"verdict":` or `_reap_refuse` shapes in `ccd/ccd` (`server/test/wsaudit.test.ts:57-60`; the docs key is `failure`).
- **PUBLIC REPO.** Code, docs, commit messages, branch names, the PR body and every comment are public. Each close scans every changed file and the PR body before the push; every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block is quoted from `d32c339d3` and must match exactly once at the run's dispatch base; apply a task's blocks in the order written. A block absent or matching twice is a stop-and-ask. Spec amendments carry the date the run commits them.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured. Each task ends with its rows as a table and one JSON fence (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`), recorded in the SDD ledger as measured; each close runs its run's whole table at the end state and keeps the last occurrence of each id. Ids are `W5B-T<n>-M<k>`; `spec` carries the rich-docs row (`M9.x`) or the refinement letter. `pkg` is where the tests run and `file` is relative to it. Every count here is a prediction; a measured red that differs is reported to the coordinator and restated; a row that stays green is a stop-and-ask.
- **Test commands.** `( cd <pkg> && ./node_modules/.bin/vitest run test/<file> )`; the browser files `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<file> )`; never bare `npx vitest`. Every run in the foreground, Bash timeout 600000 ms; heavy runs (whole package suites, typecheck, every ccd suite, every mutation run) through `ccrc test`. The ccd suites are load-sensitive: re-run a red one alone before calling it broken. Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` in `server`, `agent` and `pwa`, plus `server/test/typecheck-tests.test.ts`. `git fetch -q origin main` before `deviation-refs`, `dtbd`, `citations`, `topology-clean` and `growth-check`; the growth check runs locally with `GROWTH_CHECK=1`.
- **CI.** A change under `server/scripts/` or to a lockfile runs the full suite; neither run makes one. A pull request runs its selected server tests and skips the browser leg (`browser (pwa)`); the merge queue runs it. Both runs run the browser files locally at close.
- **Deviations.** The plan spells no `D-` number; a departure is named by its refinement letter. Departures from a spec, design or README sentence: (a) and (b) in W5b-1; (m), (n), (p), (q) and (t) in W5b-2. Numbers are ISSUED by `POST /api/ledger/deviations` at each run's opening, never looked up; the coordinator allocates and defines the known departures in its ledger in the same act at run-open and includes the definitions in the brief; each close copies/reconciles them in `## Deviations found`. An issued number left unused is written without its prefix. A session that cannot reach the allocator says so (worker clause 11) and writes no placeholder token.
- **Commits.** One per task (review fixes one per finding), files staged by name, message `<area>: <what> (docs W5b-1)` or `(docs W5b-2)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Only each close pushes, and it opens that run's ONE pull request. The head commit that writes Results carries `Ledger-Edit: This run owns the W5b plan's <run> Results and its issued deviations.`
- **Residue.** W5b edits none of the files the ledger's RL-a, RL-b, header or compression residue name. W2's one-reader residue is "for the next wave that edits `docs-source.test.ts`, or for W7", and that trigger is any edit to the file. W5b leaves `server/test/docs-source.test.ts` byte-identical: its adapter cases (Tasks 3 and 9) go in a new file, `server/test/docs-source-w5b.test.ts`, so the residue stays with W7. If a task must edit `docs-source.test.ts` after all, the residue comes with that edit (the two widening arms pinned with rows, the three docstrings, the W2-T5-M1 note, the four evasion spellings), and the run says so. `pwa/test/docs-export.test.tsx` is not edited either: W5b-2's Export case goes in `docs-version.test.tsx`. W8a's residue stays with W8b.

## How this wave runs (coordinator)

- **Order.** W5b-1 is dispatched after the library 1.1 take-up merges (the brief's sequencing). W5b-2 is dispatched from `main` after W5b-1 merges. Each run is one run row, opened at `planned` when the plan lands.
- **The plan reaches `main` first**, through the programme's ledger PR, with the operator's answers to Q1 to Q3.
- **The issued blocks.** At each run's opening the coordinator is issued a contiguous block by `POST /api/ledger/deviations`: W5b-1, two for refinements (a) and (b), three in reserve; W5b-2, five for (m), (n), (p), (q) and (t), three in reserve. Each run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main`.
- **Claims** are checked at dispatch and at the start of each task that edits a shared file. W5b-1: `ccd/ccd`, `ccd/ccrc-doctor-checks`, `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/remote/runner.ts`, `server/src/docs/*`, `shared/docs.ts`, `pwa/src/docs/{docsTree.ts,DocsTreeView.tsx,DocsIndexView.tsx,docsText.ts}`, the census tests (`auth-gate`, `box-token-census`, `secret-mask`, `verb-gate`, `ccd-can-sites`, `capsupported`, `whitelist-subset`, `ccd-archive`, `ccdCapTokens.ts`, `ccdArgvSamples.ts`, `docs-budget`, `docs-parity`, `single-definition/docs-l0`), the rich-docs spec and the base spec (§2 (a)). W5b-2: `shared/docs.ts`, `pwa/src/docs/{docsLinks.ts,DocLink.tsx,DocImage.tsx,DocsLeaf.tsx,useDocsVisit.ts,DocsHead.tsx,DocsBanners.tsx,docsText.ts,share.ts,failures.ts,export/exportMarkdown.tsx}`, `pwa/src/lib/api.ts`, `pwa/src/screens/highlightMeasureRun.tsx`, `server/test/docs-url.test.ts`, both specs. Where another run holds one, the brief names the coordinator's scoped agreement.
- **Dispatch:** one `ccrc-worker` brief per run (`WORKER_KICKOFF_PREFIX`), carrying WAVE SPECIFICS only: this plan's path, the run's task range, the base, the issued block, the claim state, `CCRC_CHROME`, the operator's answers, and the branch-discipline sentence. Routing: Opus/high main loop; `sonnet`/`high` implementers for all implementation; only Tasks 12/21 mechanical documentation may use `sonnet`/`medium`; per-task reviewers `opus`/`high` on Tasks 3, 6, 9, 10, 15, 16, 17, 18 and 19, `sonnet`/`high` on the rest except mechanical documentation Tasks 12/21 (`sonnet`/`medium`); each close's held-out whole-branch pass on three `opus`/`high` lenses (correctness, spec/boundaries, reproduction/evidence), with three independent `sonnet`/`high` refuters per critical/important finding and majority adjudication; minor findings get one advisory refuter; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, pattern kills, any `gh` write verb, any token in an argv and approval-prompting shell forms.
- **Review (W5b-1):** one independent `ccrc-reviewer` run with three Opus/high held-out lenses as above; assign these four subject groups across them, not a fourth replacement lens: (1) ccd's verb and helper (argv by fixed index, the runner's log row and shape check, exact-byte matching, the walk's bounds and `truncated`, the redactor, the guard, `docs-parity`); (2) skew and gates (the tri-state, the section gate, a four-section fleet end to end, the grant, the budget, the doctor); (3) the server half (port, adapter echo, L1 shape and redaction check, route, lane, census); (4) tests, the mutation table, the waiver, the spec text, the public-repo scan.
- **Review (W5b-2):** one independent `ccrc-reviewer` run, three Opus/high held-out lenses with the refutation contract above; cover: (1) the page grammar and the one location builder (round trips, canonicalisation, every target's `at`); (2) the visit and the reader at a version (pin, file key, re-list, body key, images, the header and banners); (3) Share's version rule and Export's body links, the loader, tests, rows, spec text and the scan.
- **Model evidence:** record actual model/effort identities; missing/dead/mismatched required lenses are unverified, not approval. Internal worker reviews do not replace the separate exact-tip review run.
- **Merge gates.** W5b-1: every row red as measured; `GROWTH_CHECK=1` growth row green with the waiver at the measured delta; the reviewer's report accepted; the PR's required checks green, `browser (pwa)` green in the merge queue. W5b-2: the operator's answers to Q1 and Q2 applied; every row red as measured; the reviewer's report accepted; the same checks.
- **After each merge, NOT in this wave:** the merge becomes a prerelease. **The first rollout that carries W5b-1's commit is `ccrc rollout --server-first --to <tag>` (A23), whichever tag that is:** W5b-1's own, W5b-2's, or any later wave's, since each later tag holds W5b-1's ccd and server. `rollout`'s default is fleet first, so the operator must pass `--server-first` on that one rollout; the coordinator's ledger PR adds this to the ledger's Carried constraints, where the operator and every later wave's coordinator read it. The server box moves first, then the fleet box, whose `ccrc update` places the new `ccd` and restarts the agent for the grant. Between ccd's swap and the agent's restart, `docs-log` answers `not-granted` (manual retry, base §7.1). The fleet box's `ccrc doctor` then reads `docs` PASS. Once both boxes run W5b-1 or later, W5b-2 and later waves roll in any order; W5b-2 is a PWA build, and phones take it at the worker's next update check.

## Overlap with the take-up wave

The take-up (PR #2346's plan) edits `pwa/package.json`, its lock, `pwa/src/docs/reader/{policy,bridge}.ts`, a new `pwa/src/docs/readerBar.ts`, `ReaderFrame.tsx`, `DocsScreen.tsx`, `DocsHead.tsx`, `docsHeadWords.ts`, `docsText.ts`, `docs.css`, `pwa/design/audit.mjs`, `pwa/src/readerLab/run.ts` (one comment), and the tests `reader-pin`, `reader-policy`, `reader-bridge`, `reader-lab-bridge`, `reader-frame`, `docs-compact-head`, `docs-desk-head`, the new `docs-one-bar.test.tsx`, `reader-lab-window.test.ts` and `reader-commands.test-d.ts`, `docs-compact-css`, `tap-targets`, `control-census`, both browser files, plus three specs. After C16, take-up edits the existing `docsHeadWords.ts` policy owner for the third layout answer, not a duplicate in DocsHead. Its amended Task 9 also edits `pwa/src/screens/settings/SettingsIndex.tsx` (one shared row renderer), `pwa/src/fleet/settingsText.ts` (diagnostic purposes) and `pwa/test/settings-frame.test.tsx`, `settings-screen.test.tsx`, `command-layer.test.tsx` and `command-registry.test.ts` for Reader lab and Measure highlighting; `SETTINGS_SECTIONS` and the route/command grammar remain unchanged. W5b edits none of those Settings files, and its Task 1 still rechecks the actual merged A tree, not this historical census. It holds `server/**`, `shared/**`, `DocsLeaf.tsx`, `DocsBanners.tsx`, `ShareSheet.tsx`, `ExportSheet.tsx` and `export/**` byte-identical.

| File both edit | W5b's blocks | The take-up's blocks | How they compose |
|---|---|---|---|
| `pwa/src/docs/docsText.ts` (W5b-1 Task 4; W5b-2 Tasks 15, 17, 18, 19) | `DOCS_FAILURE_SENTENCE['bad-section']`; `DOCS_PAGE_INVALID_SENTENCE` (`bad-section`, `bad-frame`'s neighbour, `commit-in-page`); `DOCS_VIEW_TEXT`'s `missing` line, and the `sectionUnserved` line W5b-1 adds after it; `DOCS_HEAD_TEXT`'s `sourceNone` line; `DOCS_BANNER_TEXT`'s `backToDraft` line; `SHARE_SENTENCE` and `SHARE_EXPORT_CLAUSE_FOR` | appends `DOCS_TOOL_TEXT` after `DOCS_HEAD_TEXT`'s closing `worktreeOther` line, and one import | Disjoint. W5b never anchors on `worktreeOther` or the file's imports; it adds `DOCS_HEAD_TEXT` keys after `sourceNone`, not at the object's end. |
| `pwa/src/docs/DocsHead.tsx` (W5b-2 Task 18) | `LeafSource` and `leafSource`, `truthSource`, `TruthLine`'s leaf arm, `rowBadge`, `useHeadActions`' Open committed version condition | the header comment, imports, `freshDot`/`moreName`, `DocsHead`'s layout branch, `CompactLabel` → `CompactWhere`, `CompactRow`'s `aria-label`, and the file's end (`OneBar`, `ReadLine`, tools) | Disjoint functions. The take-up's `OneBar` renders `TruthLine` in its panel and passes `rowBadge(...)` to `CompactWhere` (its Task 6), so the version's words and Back to the latest reach the one bar with no edit to `OneBar`. Task 18 Step 0 greps both calls at dispatch. |
| none else | W5b leaves `DocsScreen.tsx`, `ReaderFrame.tsx`, `reader/*`, `docs.css`, `audit.mjs` and every take-up test file as they are | — | W5b-2 puts its page-level cases in a new file (`pwa/test/docs-version.test.tsx`), and W5b-1 its PWA cases in another (`pwa/test/docs-sections.test.tsx`), so no test file is edited by both. W5b reuses existing classes (`docs-hint-link`, `docs-badge`, `docs-note`), so no stylesheet, contrast or tap-target census moves. |

## Refinements (decided while planning)

Each says What, Why and Cost if wrong, and whether it departs from a spec, design or README sentence.

**W5b-1**

- **(a) The growth waiver.** Departs from ARCH-01's limit (`growth-check.test.ts:26-31`).
  - What: `ccd/ccd` grows by about 140 net code lines (the docs-log front, its helper section, the runner's log row and shape check, the parity literals, the caps lines). `growthCheck.ts#measureBash` counts every non-blank heredoc line as code, the python helper's comments and docstrings included, so the log section alone is about 105. Task 12 adds one waiver file for `ccd/ccd` in the ledger's form, named and `d`-tagged with the number issued for (a), its `maxDelta` the measured delta, its reason the verb's.
  - Why: the helper is embedded for `_pr_py`'s reason (`ccd/ccd:41904-41907`: a sibling file would be a second deployment step), so the verb cannot move out of the listed file.
  - Cost if wrong: one more waiver; nothing ships differently.
- **(b) No restamp of `ccd/ccd`.** Departs from the rich-docs spec §8's W5b row ("`ccd/ccd` is restamped").
  - What: the run edits `ccd/ccd` and never restamps it; Task 12 amends the sentence.
  - Why: `README.md:8199-8206`: the stamp is written at install time, and `ccrc restamp ccd/ccd` is refused.
  - Cost if wrong: none; the sentence was stale.
- **(c) The doctor reads the two tokens.** Fills A12's "doctor token" (§7.2 in G4's Amends column), which says no more.
  - What: `_check_docs` reads `ccd caps` once, after its existing WARN arms, and WARNs naming `docs-log-v1` or `docs-sections-v2` when either is missing ("this ccd does not list …"), remedy `ccrc update`. The two tokens are one literal, `CCRC_DOCTOR_DOCS_CAPS`, bound to `DOCS_LOG_CAP` and `DOCS_SECTIONS_CAP` by a `docs-parity.test.ts` case, as M7.3 binds the page prefix. The fixture stub answers `caps` with both tokens, so `healthy()` stays PASS.
  - Why: a fleet box whose `ccd` predates W5b serves four sections and no history, which no other check names.
  - Cost if wrong: drop Task 11; nothing else depends on it (see "What I could not settle").
- **(d) Six sections, labelled `vision` and `promise`, listed alphabetically; one reader per section field.**
  - What: `SECTION_LABEL`, `SECTION_LABEL_ONE` and `SECTION_ORDER` gain the two (`alphabetical`, as `product-design` and `conventions`). `presentSectionCounts` becomes the ONE reader of `DocsIndexRow.sections` (`hasDocs` and `sectionCountsText` both call it) and leaves out a slug the row does not carry; `sectionFacts` becomes the ONE reader of `DocsTreeOk.sections`, and a section or leaf page under a section the answer does not hold says "The fleet box does not serve this section yet …" instead of "Nothing is listed here." or "Not in this listing". The L0 type becomes `Partial<Record<…>>`, and the wire comment says six or four.
  - Why: the wire rule (CLAUDE.md "additive-only, absence-permits": a newer peer tolerates an older peer's missing field through one reader), and M9.3's "four section rows" over a four-section fleet.
  - Cost if wrong: words only.
- **(e) The log, measured.** Fills G4 where it is silent.
  - What: the row is `git -c log.showSignature=false -c log.follow=false -c log.mailmap=false -c log.showRoot=true log --no-show-signature --encoding=UTF-8 --no-merges --format=%H%x00%P%x00%cI%x00%an%x00%s -z --name-only --end-of-options <C> -- <section path>`, exactly. The format has no `format:` prefix, so `log` joins `OBJECT_NAME_VERBS`' no-colon rule (measured on git 2.53 at planning: a string holding `%` is read as `tformat`, and the record is five NUL-ended fields, the subject's NUL, a newline, then NUL-ended names, the next record after the last name's NUL; a root commit's parent field is empty). The `-c` pairs pin every `log.*` setting that changes the record's shape. The helper drops every `GIT_*` variable but still reads the user's and the repository's config, and under `log.showRoot=false` git prints a root commit's record with no newline and no names (measured on git 2.53: the commit that created the doc is dropped with `truncated` false, and in a history with two roots the next record lands where the newline should be, so the whole log answers `git-failed`). `--root` in the row restores the names too (measured); the `-c` pair is chosen because the runner's one `LOG_CFLAGS` check then covers it. A name equal to the section path itself is read and never a hit: a commit that touched a FILE at `docs/vision` (a section that was once a file) lists that bare name, before any name under it (measured), and the parse must stay aligned past it. The runner checks the whole tail (`--end-of-options`, one commit, `--`, one `SECTIONS` path) and the `-c` pairs, so no `-n`, pathspec or caller's path can reach git. The date is the committer's (`%cI`): the log walks in committer-date order, so the dates are monotone with the list. The author is the name (`%an`), never the email, at most 100 code points (`DOCS_LOG_AUTHOR_MAX_CHARS`), redacted before it is cut, as a subject is (200, `DOCS_LOG_SUBJECT_MAX_CHARS`). Authors and subjects go through ONE redactor call over their lines joined by newlines (neither can hold one), its line count checked. `truncated` is true when the walk ended short of 100 by the deadline or the stdout cap, AND when a shallow repository's walk ended short (`on_ref`'s rule: a cut history can hide older commits). The over-size answer is `too-many-entries {count, bytes}` at `DOCS_LOG_MAX_WIRE_BYTES` (131 072 framed bytes, G4's "about 128 KiB", kept), the listings' word and measure. Not every full answer fits under it, and that is by design. A worst case of three-byte characters fits: 100 entries, 200-code-point subjects and 100-code-point authors, a 1 KiB path and the longest section frame to about 109 500 bytes for sha1 and 114 300 for sha256. The same worst case in four-byte characters frames to about 139 500 and 144 300 bytes, over the cap, and answers `too-many-entries {count, bytes}` instead of a list (measured with ccd's own `line_of` and `framed_len`). Helper deadline 10 s, call bound 8 s, runner budget 20 000 ms (margin 2.1 s with the redactor's 0.9 s).
  - Why: each is either measured or the base's existing rule applied to one more verb.
  - Cost if wrong: one constant or one word; the wire shape does not move.
- **(f) The server checks what it carries, and rewrites nothing.**
  - What: the adapter holds a log answer to its ask (`commit`, `section`, `path` echoed, else `malformed-answer {why:'pin'}`, as check 8 holds a show). L1's `docsAnswerShape('docs-log', …)` checks the entries (at most 100; a full sha; a full sha or `null` parent; text date; author and subject within their caps), a boolean `truncated`, and that `redactDocsText` changes no author or subject (else `{why:'schema'}`). The history route books `HISTORY_JOB` (`{raw, wire}` = `DOCS_LOG_MAX_WIRE_BYTES`) on the read lane, joins a flight keyed by (node, project, commit, section, path), and sends `no-store` (every JSON docs answer's rule).
  - Why: `ccdsource.ts`'s rule "An ok answer is never rewritten" (`:25`, `:309`) and G4's "the shared redactor": the redactor runs in the helper, and the server proves it ran.
  - Cost if wrong: a refused answer reads `malformed-answer`, never a leak.

**W5b-2**

- **(m) `ref` stays in the URL beside `at`; W5b writes nothing into `history.state`** (pending Q1). Departs from two sentences of the rich-docs spec. G6 says "'Back to the latest' its ref, in `history.state` for the visit, not in the URL". RD19, a Ruled row, says "`at=<sha>` (R-d). `only` and `latest` stay in-visit state". The spec's Later item, "`only` and `latest` in the URL beside `at=`, if in-visit state proves too thin", loses its `latest` half, because the latest is then the page URL less `at`; its `only` half stays W8b's. The library host table's `openVersion` still supplies a separate `latestUrl`, which W8b fills with that same URL.
  - What: `at` is a leaf page's key, written after `ref` (`DOCS_PAGE_KEYS = ['ref','at','view','frame']`). Back to the latest is the same URL less `at` (`docsLocation(page, { kind: 'version', at: null })`). `only` lands in `history.state` with W8b's `version` op (M8.22), which this run does not build.
  - Why: a version page's listing, served ref, `onRef` and Share all read the ref's tree; with `ref` out of the URL, a reload or a shared link would open the version over the default branch's listing, and a version from a branch view would read `not-contained`. Today's page grammar already carries `ref` on every page but the index (base §3.1), and no spec sentence refuses it beside `at` (A14 refuses only the other pin keys).
  - Cost if wrong: Q1's option (b), one task's edits: when a version page is opened, the visit also keeps the latest URL in `history.state` (RD19's `latest`), Back to the latest reads it back, and a reload or a shared link, which has no such state, falls back to the URL less `at`. RD19 and the Later line then stand. (m) still departs from G6's last clause as worded, because its ref stays in the URL as the page key it already is, so (m) keeps its number under either answer.
- **(n) A version page's images are read at the version.** Departs from base §4.11's pin rule ("committed page … giving `CommittedPin{commit: ref.commit, servedRef: ref.served, section, path}`").
  - What: on a page with `at`, `imagePinFor` pins at `at` (and never marks `uncommittedNotShown`); `DocImage`, Export and the reader's images all take it, being the one derivation (`planImageRef`). Whether an image is offered is still the served listing's answer, as (p) asks of the leaf: an image the listing does not hold as a committed `file` or `exec` is `absent`, with no request, so a version whose image was deleted or renamed since shows it absent. The listing's size is the tip's, so on a version page `planImageRef` skips the size pre-check and lets ccd's class cap answer, as Task 17 does for the leaf.
  - Why: G6's "the page opens a committed pin at that commit"; an old doc shown with today's diagrams would be wrong. Presence comes from the served listing because a version page reads no listing at its own commit.
  - Cost if wrong: one line each.
- **(o) Links inside a version page keep the version** (pending Q2).
  - What: a `path` target from a leaf page with `at` inherits it, unless the target names `at` (`null` for the latest) or is a directory. So a version page's in-document doc links, its image's leaf link and its own crumb stay at the version (GitHub's blob-at-commit rule); the crumbs above it, Back, every listing, and Back to the latest go to the latest. `docLinkTarget` passes the page's `at` from `DocLinkContext` (`pageAt`).
  - Why: a version is read as a snapshot; a relative link that jumped to today's copy would mix two commits on one reading path.
  - Cost if wrong: Q2's option (b): `docsLocation`'s path arm sets `at: null`.
- **(p) The version view needs the doc in the served listing, as a committed file.** Departs from four sentences of base §2 (e) and one of §4.3. §2 (e) says "A pinned commit that has since been gc'd answers `unknown-commit`, and the PWA re-lists once", "A commit reaches a request only from a tree answer of the same visit", and that the tree is re-fetched "after … `unknown-commit`, with one automatic retry"; its failure table reads `unknown-commit | 404 | auto | re-list`. §4.3 item 2 says "Committed bodies are keyed by `blob`".
  - What: `pinFor` answers `CommittedPin(at, ref.served)` only when the served listing holds the entry with a committed `file` or `exec`; otherwise the page opens nothing (a version of a doc deleted since, or of a new draft, is not a page). The commit comes from the URL's `at`, the one place a page names one. Its size is not the listing's, so the pre-check is skipped and the class cap is ccd's. `unknown-commit` (and the other re-list words) on a version page is that commit's own answer, so the visit fails it rather than re-listing. The failed page then says "This box's copy of the repository has no commit <short>." instead of the re-list sentence, because on a shared link the commit may simply not be in the box's clone. An image's `unknown-commit` is that image's own failure: no asset path re-lists at `d32c339d3` (base §2 (e)'s asset re-list and re-plan is not built; `DOCS_RELIST_WORDS` is read by the visit's file slot only), so a version page's images do not re-list either. A committed body at a version is keyed by its pin, so a version whose blob equals the latest's still remounts the reader with its own sha (rich-docs §4.1: "every … `at=` commit is a remount").
  - Why: page kind comes from the tree answer (base §4.4); a re-list cannot change a commit named in the URL.
  - Cost if wrong: a version of a deleted doc needs W8b's menu to reach it anyway.
- **(q) The header and one banner name the version.** Departs from base §3.1, which says `view=committed` survives on a leaf "only together with `ref`" (so it would survive beside `at` too), and from §4.5's banner and truth-line rows on a version page.
  - What: the truth line's source reads `version <short>` (full sha in `title`), followed by a `docs-hint-link` "Back to the latest"; the phone row's badge reads the same words (`rowBadge`, which the one bar shares). The entry's badge beside the source is drawn for every source but `draft` and `version`, so a leaf that opens nothing (a withheld new draft) keeps it and still agrees with `rowBadge`. An info banner, "Showing the version at <short>, not the latest on <served>." with Back to the latest, mirrors `view=committed`'s banner, so a phone reader sees it without opening the panel. The not-contained banner on a version page says "Commit <short> is not on <served>; it comes from another branch." with no Re-list. On a version page, no banner about the latest's drafts is shown: withheld, deleted, typechange, conflicted, the draft images, and the default and base hints, whose same-page "open draft view" link would keep `at`. The banners about the listing's drafts snapshot (the two caveats, ambiguous, untrusted, unreadable, unsettled, too many, skipped) stay, because a version page still reads that listing (p). Open committed version is not offered on a version page (it is committed already). `view=committed` beside `at` is canonicalised away, and `at` on a directory too.
  - Why: G6's "the truth line names it and links back to the latest"; the rest follows the base §4.5 idioms. A version is one commit, so the latest's drafts say nothing about it, as Share's version rule (r) already says.
  - Cost if wrong: words.
- **(r) Share on a version view.** Fills base §4.13's "W5b re-derives Share's rows for version views".
  - What: the link names the version's commit (already the opened pin's). It is offered only when `githubPermalink` would link the served ref's tip AND the read that showed the version measured `onRef === 'contains'` (a commit on a tip that origin holds is on origin). Otherwise the refusal is a new word, `version-unmeasured`, "Docs cannot tell whether origin has <short>, so it gives no link to this version.", with Export's clause; `no-github-origin`, `bad-slug` and `bad-target` keep their own words. A version view carries no draft notes. Export's provenance calls `shareTargetFor`, so its link line follows this rule with no edit; its body links are (t)'s.
  - Why: `githubPermalink` judges the tip (`share.ts:91`); a version on a local-ahead branch may or may not be on origin, and ccrc makes no GitHub call.
  - Cost if wrong: one refusal too many; never a 404 link.
- **(t) An Export of a version page writes its body's doc and repo links inert.** Departs from base §4.17's link table, whose `doc` and `repo` rows give `githubPermalink` at C.
  - What: `exportLinkTarget` gives an inert span with `version-unmeasured`'s sentence for a `doc` or `repo` link when the export's commit is not the listing's commit (a version page). Fragments, external links and the other inert rows are unchanged, and so is every export whose commit is the listing's.
  - Why: the body links name the export's commit, and `githubPermalink` judges only the served ref's tip, never `onRef`. With a version that is not on origin, every such link would 404. Export's link table cannot read the version read's `onRef` without new plumbing through `exportInput.ts` and `buildExport.tsx`, which this run leaves byte-identical.
  - Cost if wrong: links too few on an export of a version that origin does hold; never a 404 link. W8b or Later can pass `onRef` to the table and apply (r)'s rule.
- **(s) The history loader is `api.docs.history`, outside `DocsLoaders`.**
  - What: `api.docs` is typed `DocsLoaders & DocsHistoryLoader`; `DocsLoaders` does not change, so the 13 test fakes do not move. W8b chooses how its consumer takes it.
  - Why: the spec's W5b row lists `api.docs.history`; no W5b view reads history (the menu is W8b's).
  - Cost if wrong: W8b adds it to `DocsLoaders` when it wires its consumer.

## W5b-1: ccd, the agent and the server (G1 and G4), with the PWA's six sections

**Scope (W5b-1):**
- In: `shared/docs.ts` (six sections; the log vocabulary, caps and `docsApi.history`; the wire comments); `ccd/ccd` (`SECTIONS`, the docs-log front, arm, usage and caps lines, the helper's parity literals, argument reader, runner row and shape check, log section, guard, `VERBS`); `ccd/ccrc-doctor-checks` (`_check_docs`'s token WARN); `agent/src/whitelist.ts` and one bypass fixture; `server/src/ccdargv.ts`, `server/src/remote/runner.ts`, `server/src/docs/{ports,ccdsource,policy,routes}.ts`; `pwa/src/docs/{docsTree.ts,DocsTreeView.tsx,DocsIndexView.tsx,docsText.ts}`; the tests and fixtures named in each task (`pwa/test/docs-screen.test.tsx`, `pwa/test/docs-tree.test.ts`, `server/test/ccdArgvSamples.ts` and the new `server/test/docs-source-w5b.test.ts` among them); one growth waiver; the rich-docs spec's text for (a), (b), (c), (d), (e), and the base spec's §2 (a) `log` row.
- Out: the page key `at`, the version view, Share, the history loader (W5b-2); the version menu, "changes since" and `history.state` (W8b); README and CLAUDE.md (W7); the programme ledger (the coordinator's).
- Byte-identical: `server/src/server.ts` (the plugin's registration takes `registerDocsReadRoutes` as is), `server/src/docs/{hooks,lane,cache}.ts`, `pwa/src/screens/**`, `pwa/src/docs/{DocsHead,DocsLeaf,DocsBanners,useDocsVisit,docsLinks,share,ReaderFrame}.tsx|ts`, `pwa/src/docs/reader/**`, `docs.css`, `pwa/src/lib/**`, `ui/**`, `.github/**`, `README.md`, `CLAUDE.md`, and `server/test/docs-source.test.ts` (W2's residue trigger; see Residue). Any other file is a stop-and-ask.

### File Structure (W5b-1)

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `shared/docs.ts` | 2, 5 | L0 | `DOC_SECTIONS` (six); wire comments; `Partial` index counts; `DocsVerb`; `DocsLogAsk`, `DocsLogEntry`, `DocsLogOk`, `DocsHistoryResponse`; the four log caps; `docsApi.history` |
| `ccd/ccd` | 2, 6 | — | `SECTIONS`; caps lines; `cmd_docs_log`, its arm and usage; the helper's log section and runner row |
| `pwa/src/docs/docsTree.ts` | 2, 4 | pure | the three tables; `presentSectionCounts`, `sectionCountsText`, `sectionFacts` |
| `server/src/ccdargv.ts`, `server/src/docs/policy.ts`, `server/src/docs/ccdsource.ts` | 3, 8, 9 | —, L1, L3 | `DOCS_SECTIONS_CAP`, `DOCS_LOG_CAP`, `docsLog`, its row; `DOCS_SECTION_GATED`, the history query, the log shape, `HISTORY_JOB`, the flight key; the section gate and the log arm |
| `pwa/src/docs/{DocsTreeView.tsx,DocsIndexView.tsx,docsText.ts}`, `pwa/test/docs-sections.test.tsx` (new) | 4 | L4, words | the pages over four or six sections |
| `agent/src/whitelist.ts`, `agent/test/types/bypasses/g28-docs-log-without-project.ts` (new) | 7 | — | the grant |
| `server/src/remote/runner.ts` | 8 | — | the budget row |
| `server/src/docs/ports.ts`, `server/src/docs/routes.ts` | 9, 10 | L2, L4 | `DocsReader.log`; the history route |
| `server/test/ccd-docs-log.test.ts` (new) | 6 | — | the verb end to end on fixture HOMEs |
| `server/test/docs-source-w5b.test.ts` (new) | 3, 9 | — | the adapter's section gate and log read, over its own recording runner |
| existing four-section pins (`docs-shared`, `docs-grammar`, `ccd-docs-tree`, `ccd-docs-index`, `ccd-docs-helper-redactor`, pwa `docs-tree`, `docs-screen`) | 2 | — | restated for six sections |
| `ccd/ccrc-doctor-checks`, `server/test/docsIndexFixtures.ts` | 11 | — | the token WARN; the stub's `caps` |
| `server/test/growth-waivers/<issued number>-ccd-ccd.json` (new) | 12 | — | the waiver |

### Task 1: Base, claims, find-check and the BASE figures (W5b-1)

- [ ] **Step 0: Base.** `git fetch -q origin main`; the workspace branch is at `origin/main` and holds the take-up's merge (`git log --oneline -1 --grep 'library 1.1' origin/main` names it) and no W5b commit. Expected `T1-BASE-OK`; otherwise stop and ask.
- [ ] **Step 1: Find-check.** The coordinator's script runs every `Find (...)` block of Tasks 2-12 against the dispatch base: each matches its file exactly once. Expected `FINDS-OK`. A miss (expected only if a merge since `d32c339d3` moved the text) is a stop-and-ask, with the block and the file's current text.
- [ ] **Step 2: BASE figures,** recorded in the SDD ledger: `ccd/ccd`'s code lines as `growthCheck.ts#codeLines` counts them; `auth-gate.test.ts`'s `ROUTES.length` (183 at `d32c339d3`); `ccd caps | wc -l` on a fixture HOME; the count of `## Deviations found` numbers in the issued block; `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts` (green at base).
- [ ] **Step 3: Claims** per "How this wave runs".

### Task 2: Six sections in L0 and in ccd's parity copy, with `docs-sections-v2` (refinement (d); M9.2)

**Files:** Modify `shared/docs.ts`, `ccd/ccd`, `pwa/src/docs/docsTree.ts`, `server/test/docs-parity.test.ts`, `server/test/single-definition/docs-l0.test.ts`, `server/test/ccd-docs-tree.test.ts`, `server/test/ccd-docs-index.test.ts`, `server/test/docsIndexFixtures.ts`, `server/test/ccdCapTokens.ts`, `server/test/ccd-archive.test.ts`, and the existing tests that assert exactly four sections (Step 5 names each edit): `server/test/docs-shared.test.ts`, `server/test/docs-grammar.test.ts`, `server/test/ccd-docs-helper-redactor.test.ts`, `pwa/test/docs-tree.test.ts`, `pwa/test/docs-screen.test.tsx`.

- [ ] **Step 1: Red first.** Append to `ccd-docs-tree.test.ts` a describe `'six sections (rich-docs spec G1, W5b)'`: a fixture repository with `docs/vision/v.md`, `docs/promise/p.md` and `docs/promise/sub/q.md` lists `sections` as six rows in `DOC_SECTIONS` order (the two `present`, counts 1 and 2) and the three entries with sections `vision`, `promise`, `promise` (recursively). Append to `ccd-docs-index.test.ts`: `'ccd caps lists docs-sections-v2'`, and the ready row's `sections` carries six keys. Add `'docs-sections-v2'` to `CCD_CAPABILITY_TOKENS` in sorted order. `pwa/test/docs-tree.test.ts`: `presentSectionCounts` leaves out a missing slug and keeps a `null` count; `sectionCountsText` over a four-key record has four parts. Run: the two ccd files, `ccd-archive.test.ts` and `docs-tree.test.ts` red (four rows; the token not advertised; no `presentSectionCounts`).
- [ ] **Step 2: L0.** Find (`shared/docs.ts`):
```ts
/** The four doc sections, slug to repo path, in display order. Every other list of sections is derived from this
 *  object: `DOC_SECTION_SLUGS`, `DOCS_SECTION_RE_BODY`, and ccd's `SECTIONS` parity copy. */
export const DOC_SECTIONS = {
  specs: 'docs/superpowers/specs',
  plans: 'docs/superpowers/plans',
  'product-design': 'docs/product-design',
  conventions: 'docs/conventions',
} as const;
```
  Replace:
```ts
/** The six doc sections, slug to repo path, in display order. Every other list of sections is derived from this
 *  object: `DOC_SECTION_SLUGS`, `DOCS_SECTION_RE_BODY`, and ccd's `SECTIONS` parity copy. `vision` and `promise` came
 *  with the rich-docs spec's G1 (W5b): a ccd that serves them says so in `ccd caps` (the token
 *  `server/src/ccdargv.ts#DOCS_SECTIONS_CAP` names), and the server names either to ccd only behind it
 *  (`server/src/docs/ccdsource.ts#readDocs`). */
export const DOC_SECTIONS = {
  specs: 'docs/superpowers/specs',
  plans: 'docs/superpowers/plans',
  'product-design': 'docs/product-design',
  conventions: 'docs/conventions',
  vision: 'docs/vision',
  promise: 'docs/promise',
} as const;
```
  Find: `` /** True iff `s` is one of the four slugs. A list test, never `in`: `toString` and `__proto__` are no section. */ `` — Replace: `` /** True iff `s` is one of the slugs. A list test, never `in`: `toString` and `__proto__` are no section. */ ``
  Find: `  /** All four, in DOC_SECTIONS order. */` — Replace:
```ts
  /** Every section this ccd serves, in DOC_SECTIONS order: all six from a ccd that lists the sections token, the first
   *  four from an older one. A reader never assumes a slug is here (`pwa/src/docs/docsTree.ts#sectionFacts`). */
```
  Find:
```ts
    default?: { name: string; via: string; commit: Sha }; sections?: Record<DocSectionSlug, number | null>;
    sectionsOnDisk?: DocSectionSlug[] /* non-git dirs: 4 lstats */; owner?: string | null; branch?: string | null;
```
  Replace:
```ts
    default?: { name: string; via: string; commit: Sha };
    /** One count per section this ccd serves: six, or four from a ccd without the sections token. A slug it does not
     *  carry is a section that ccd does not know, never zero (`pwa/src/docs/docsTree.ts#presentSectionCounts`). */
    sections?: Partial<Record<DocSectionSlug, number | null>>;
    sectionsOnDisk?: DocSectionSlug[] /* non-git dirs: one lstat per section */; owner?: string | null; branch?: string | null;
```
- [ ] **Step 3: ccd.** Find (`ccd/ccd`): `SECTIONS={'specs':'docs/superpowers/specs','plans':'docs/superpowers/plans','product-design':'docs/product-design','conventions':'docs/conventions'}` — Replace: `SECTIONS={'specs':'docs/superpowers/specs','plans':'docs/superpowers/plans','product-design':'docs/product-design','conventions':'docs/conventions','vision':'docs/vision','promise':'docs/promise'}`
  Find: ``  echo docs-v1; echo delegation-events-v1   # delegation broker wave 3: the spool grammar and ccd-made spool directories (`_delegation_spool_dir`); the hook's registration is the doctor's to measure, not this token's`` — Replace: that line, then:
```bash
  echo docs-sections-v2   # native Docs reader W5b (rich-docs spec G1): SECTIONS in the Docs helper holds vision and promise; the server names either only behind this word
```
  Find: `cmd_docs_tree() {   # --project P [--ref R]; one project's four sections at one ref, with its drafts` — Replace: `cmd_docs_tree() {   # --project P [--ref R]; one project's sections at one ref, with its drafts`
  Find: `    - sections: all four, in SECTIONS order, each {slug, path, state, count}.` — Replace: `    - sections: every one in SECTIONS, in its order, each {slug, path, state, count}.`
  Find: `    """The sections a non-git directory holds as directories: four lstats, in` — Replace: `    """The sections a non-git directory holds as directories: one lstat each, in`
- [ ] **Step 4: The PWA's tables and its counts reader** (the tables are `Record`s over the slug type, and Step 2 makes `DocsIndexRow.sections` a `Partial`, which `DocsIndexView.tsx`'s `sectionCountsText(row.sections)` and `pwa` `tsc`, which compiles `test`, accept only once the reader takes a `Partial`; so the build needs both in this commit). Find (`pwa/src/docs/docsTree.ts`): `` // `Record`s over its type, so a fifth section is a compile error here until it has both. No React, no DOM, no state. `` — Replace: `` // `Record`s over its type, so a seventh section is a compile error here until it has both. No React, no DOM, no state. ``
  Find:
```ts
  'product-design': 'design',
  conventions: 'conventions',
};

/** How a section lists (spec 4.4): `specs` and `plans` newest first (name descending; their names are
 *  date-prefixed), the other two alphabetical. Folders and files each follow it. */
export const SECTION_ORDER: Readonly<Record<DocSectionSlug, 'newest-first' | 'alphabetical'>> = {
  specs: 'newest-first',
  plans: 'newest-first',
  'product-design': 'alphabetical',
  conventions: 'alphabetical',
};
```
  Replace:
```ts
  'product-design': 'design',
  conventions: 'conventions',
  vision: 'vision',
  promise: 'promise',
};

/** How a section lists (spec 4.4): `specs` and `plans` newest first (name descending; their names are
 *  date-prefixed), the other four alphabetical. Folders and files each follow it. */
export const SECTION_ORDER: Readonly<Record<DocSectionSlug, 'newest-first' | 'alphabetical'>> = {
  specs: 'newest-first',
  plans: 'newest-first',
  'product-design': 'alphabetical',
  conventions: 'alphabetical',
  vision: 'alphabetical',
  promise: 'alphabetical',
};
```
  Find:
```ts
  'product-design': 'design',
  conventions: 'convention',
};
```
  Replace:
```ts
  'product-design': 'design',
  conventions: 'convention',
  vision: 'vision',
  promise: 'promise',
};
```
  Find:
```ts
/** The four section counts in `DOC_SECTION_SLUGS` order, joined by ` · ` (spec 4.4). A `null` count renders `?`:
 *  the count is not known, never zero. A count of one takes the singular noun (D-5502). */
export function sectionCountsText(counts: Readonly<Record<DocSectionSlug, number | null>>): string {
  return DOC_SECTION_SLUGS.map((slug) => {
    const n = counts[slug];
    return `${n ?? '?'} ${n === 1 ? SECTION_LABEL_ONE[slug] : SECTION_LABEL[slug]}`;
  }).join(' · ');
}
```
  Replace:
```ts
/** An index row's counts in `DOC_SECTION_SLUGS` order, for the sections its ccd serves: six, or four from a ccd without
 *  the sections token (rich-docs spec G1, W5b). THE ONE READER of `DocsIndexRow.sections` (the wire's absence-permits
 *  rule): a slug the row does not carry is left out, never shown as `?` or 0; a `null` count is kept (not known). */
export function presentSectionCounts(counts: Readonly<Partial<Record<DocSectionSlug, number | null>>>):
  readonly (readonly [DocSectionSlug, number | null])[] {
  return DOC_SECTION_SLUGS.flatMap((slug) => {
    const n = counts[slug];
    return n === undefined ? [] : [[slug, n] as const];
  });
}

/** The section counts `presentSectionCounts` gives, joined by ` · ` (spec 4.4). A `null` count renders `?`: the count is
 *  not known, never zero. A count of one takes the singular noun (D-5502). */
export function sectionCountsText(counts: Readonly<Partial<Record<DocSectionSlug, number | null>>>): string {
  return presentSectionCounts(counts)
    .map(([slug, n]) => `${n ?? '?'} ${n === 1 ? SECTION_LABEL_ONE[slug] : SECTION_LABEL[slug]}`)
    .join(' · ');
}
```
  (The comment keeps its existing deviation citation, as CLAUDE.md asks of every `D-` reference in source.) `DocsIndexView.tsx` is unchanged here: its `sectionCountsText(row.sections)` now compiles, and Task 4 moves `hasDocs` onto `presentSectionCounts`.
- [ ] **Step 5: The pins.** Each existing test that asserts exactly four sections, restated for six (`vision` and `promise` last, in `DOC_SECTIONS` order):
  - `docsIndexFixtures.ts`: both ready rows' `sections` gain `vision: null, promise: null` (`DOCS_INDEX_READY`, `DOCS_INDEX_UNREADABLE`).
  - `single-definition/docs-l0.test.ts`: the `section` LITERAL row keeps its fingerprint (the four-joined body, which a six-joined copy contains) and its CONTROL gains a second planted copy, `"const S = 'specs|plans|product-design|conventions|vision|promise';"`, which it must see (M9.2: "the single-definition scans are updated").
  - `server/test/docs-shared.test.ts`, the describe `'DOC_SECTIONS: the four sections, declared once'`: `DOC_SECTIONS` `toEqual` the six pairs and `DOC_SECTION_SLUGS` `toEqual` the six slugs; the describe's title and the `'isDocsSection admits the four slugs …'` title say "the sections" and "the slugs".
  - `server/test/docs-grammar.test.ts`, `'the section grammar'`: `DOCS_SECTION_RE_BODY` `toBe('specs|plans|product-design|conventions|vision|promise')`.
  - `server/test/ccd-docs-tree.test.ts`: the four-row `sections` assertions gain `vision` and `promise` rows (`state: 'absent'`, `count: 0`): `'answers all four sections in SECTIONS order …'` (and its title, "every section"), `'answers a commit with no docs at all as four absent sections …'` (title, "every section absent"), the symlinked-ancestor case, the not-a-directory case (row 25), and the T15 drafts case's `t['sections']`. `SECTION_PATHS_T10` and `T14_SECTION_PATHS` gain `'docs/vision', 'docs/promise'`, so the ls-tree argv case (`'… over the four section paths …'`, title "the section paths") and row 64's status argv read six paths.
  - `server/test/ccd-docs-index.test.ts`, `'a ready row carries its default branch, commit and section counts …'`: both `sections` `toEqual` gain `vision: null, promise: null`.
  - `server/test/ccd-docs-helper-redactor.test.ts`: the golden `DRAFTS_TREE_LINE` gains `{"slug":"vision","path":"docs/vision","state":"absent","count":0},{"slug":"promise","path":"docs/promise","state":"absent","count":0}` after the `conventions` row (both cases that compare it).
  - `pwa/test/docs-tree.test.ts`: `'SECTION_LABEL and SECTION_ORDER each have exactly the four slugs …'` says "exactly the slugs"; the `SECTION_ORDER` `toEqual` literal gains `vision: 'alphabetical', promise: 'alphabetical'` (title: "the other four alphabetically"). The three `sectionCountsText` texts stay as they are: a four-key record gives four parts.
  - `pwa/test/docs-screen.test.tsx`, `'four section rows in DOC_SECTIONS order …'`: `treeOk()` builds its sections from `DOC_SECTION_SLUGS`, so the page draws six rows; the names `toEqual` `['specs', 'plans', 'design', 'conventions', 'vision', 'promise']`, and the title says "six".
  - `ccd-archive.test.ts` gains nothing here (Task 3 adds the `toContain`).
- [ ] **Step 6: Green.** `( cd server && ./node_modules/.bin/vitest run test/ccd-docs-tree.test.ts test/ccd-docs-index.test.ts test/ccd-docs-helper-redactor.test.ts test/ccd-archive.test.ts test/docs-parity.test.ts test/single-definition/docs-l0.test.ts test/docs-grammar.test.ts test/docs-shared.test.ts test/docs-url.test.ts )` and `( cd pwa && ./node_modules/.bin/vitest run test/docs-tree.test.ts test/docs-screen.test.tsx )` green; `tsc` in `server` and `pwa` clean. Any other red that asserts four sections is a stop-and-ask, with the file and line.
- [ ] **Step 7: Commit.** Files by name; message `docs: six sections, vision and promise, in L0 and ccd, with docs-sections-v2 (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T2-M1 | M9.2 | `../shared/docs.ts` | drop `promise` from `DOC_SECTIONS` (and nothing else) | `docs-parity`, `ccd-docs-tree` | 2+ failed — `SECTIONS equals DOC_SECTIONS as ORDERED pairs`; `six sections …` |
| W5B-T2-M2 | M9.2 | `../ccd/ccd` | drop `promise` from `SECTIONS` | `docs-parity`, `ccd-docs-tree` | 2+ failed — the same two |
| W5B-T2-M3 | (d) | `../ccd/ccd` | drop the `docs-sections-v2` echo line | `ccd-archive`, `ccd-docs-index` | 2 failed — the exact caps set; `ccd caps lists docs-sections-v2` |

```json
{"id": "W5B-T2-M1", "spec": "M9.2", "pkg": "server", "file": "../shared/docs.ts", "old": "  vision: 'docs/vision',\n  promise: 'docs/promise',\n} as const;", "new": "  vision: 'docs/vision',\n} as const;", "tests": ["test/docs-parity.test.ts", "test/ccd-docs-tree.test.ts"], "red": "2+ failed: SECTIONS equals DOC_SECTIONS as ORDERED pairs; six sections"}
{"id": "W5B-T2-M2", "spec": "M9.2", "pkg": "server", "file": "../ccd/ccd", "old": ",'vision':'docs/vision','promise':'docs/promise'}", "new": ",'vision':'docs/vision'}", "tests": ["test/docs-parity.test.ts", "test/ccd-docs-tree.test.ts"], "red": "2+ failed: SECTIONS equals DOC_SECTIONS as ORDERED pairs; six sections"}
{"id": "W5B-T2-M3", "spec": "(d)", "pkg": "server", "file": "../ccd/ccd", "old": "  echo docs-sections-v2   # native Docs reader W5b", "new": "  : docs-sections-v2   # native Docs reader W5b", "tests": ["test/ccd-archive.test.ts", "test/ccd-docs-index.test.ts"], "red": "2 failed: advertises exactly the verbs … plus the known capability tokens; ccd caps lists docs-sections-v2"}
```

### Task 3: The server's section gate (refinement (d); M9.3, the server half)

**Files:** Modify `server/src/ccdargv.ts`, `server/src/docs/policy.ts`, `server/src/docs/ccdsource.ts`, `server/test/capsupported.test.ts`, `server/test/ccd-archive.test.ts`; Create `server/test/docs-source-w5b.test.ts`.

- [ ] **Step 1: Red first.** Create `docs-source-w5b.test.ts` (not an edit of `docs-source.test.ts`; see Residue), with its own few-line recording runner and `res`, `state` and `line` helpers declared as `docs-source.test.ts` declares its own (they are file-local there), and the describe `'the sections gate (rich-docs spec G1, M9.3)'`, over that recording runner: (1) `'a vision pin without docs-sections-v2 is unsupported, with zero execs'` (`ccdVerbs: ['caps', DOCS_CAP]`, a committed pin in `vision`); (2) `'a promise draft pin, the same'`; (3) `'with docs-sections-v2 the vision pin execs once'`; (4) `'a specs pin needs no new token'`; (5) `'caps-unknown still answers first'` (`ccdVerbs: []`, a vision pin → `caps-unknown`). `capsupported.test.ts`: `DOCS_SECTIONS_CAP` is `'docs-sections-v2'`, spelled once in `server/src`, refused on no evidence. `ccd-archive.test.ts`: `expect(KNOWN_CAPABILITY_TOKENS).toContain(DOCS_SECTIONS_CAP)`. Run: red (no constant, no gate).
- [ ] **Step 2: The token.** Find (`server/src/ccdargv.ts`): `export const DOCS_CAP = 'docs-v1';` — Replace:
```ts
export const DOCS_CAP = 'docs-v1';

/** The `ccd caps` token that says this box's ccd serves the sections `vision` and `promise` (rich-docs spec 2026-10-12
 *  G1, W5b): ccd's `SECTIONS` holds them, so `docs-show` and `docs-log` accept them and `docs-tree` and `docs-index`
 *  list them. Spelled ONCE in `server/src`; ccd's `echo docs-sections-v2` and `ccdCapTokens.ts` are the other two
 *  spellings, held equal by `ccd-archive.test.ts`'s `toContain`. READ IT WITH `capSupported`, after the docs gate's
 *  tri-state has measured a list (`docs/ccdsource.ts#readDocs`): an older ccd answers `bad-section` for either slug, a
 *  failure word for a request a new server should never have sent. */
export const DOCS_SECTIONS_CAP = 'docs-sections-v2';
```
- [ ] **Step 3: L1.** Find (`server/src/docs/policy.ts`): `` /** The `:project` route parameter: the project grammar, else `bad-project` (section 3.4), before any exec. */ `` — Replace:
```ts
/** Whether a section came to ccd with the sections token (rich-docs spec G1, W5b; `ccdargv.ts#DOCS_SECTIONS_CAP`, which
 *  this file never spells), so the adapter names it to ccd only on a box that lists that token. Keyed by the L0 type: a seventh section does not compile here until it is placed. */
export const DOCS_SECTION_GATED: Readonly<Record<DocSectionSlug, boolean>> = {
  specs: false, plans: false, 'product-design': false, conventions: false, vision: true, promise: true,
};

/** The `:project` route parameter: the project grammar, else `bad-project` (section 3.4), before any exec. */
```
- [ ] **Step 4: The gate.** Find (`server/src/docs/ccdsource.ts`): `import { CCD_ARGV, ccdCan } from '../ccdargv.js';` — Replace: `import { CCD_ARGV, DOCS_SECTIONS_CAP, capSupported, ccdCan } from '../ccdargv.js';`. Find: `import { LISTING_JOB, type DocsJob } from './policy.js';` — Replace: `import { DOCS_SECTION_GATED, LISTING_JOB, type DocsJob } from './policy.js';`. Find:
```ts
      : call.pin.kind === 'committed' ? 'docsShowCommitted' : 'docsShowDraft');
  if (!can) return fail('unsupported');
```
  Replace:
```ts
      : call.pin.kind === 'committed' ? 'docsShowCommitted' : 'docsShowDraft');
  if (!can) return fail('unsupported');
  // The rich-docs spec's G1 (W5b): a section that came with DOCS_SECTIONS_CAP is named to ccd only on a box that lists
  // that token, so a new server only ever under-calls an old fleet. `null`: this call names no section. Decided before
  // any exec, like the two answers above.
  const section = call.verb === 'docs-show' ? call.pin.section : null;
  if (section !== null && DOCS_SECTION_GATED[section] && !docsSectionsServed(deps.fleetState)) {
    return fail('unsupported');
  }
```
  The token is read in a module-level helper, never inside `readDocs`: `verb-gate.test.ts` counts a site as gated when its enclosing function holds `capSupported(` and the verb is in `CAP_GATED_VERBS`, which holds every docs verb, so a bare `capSupported(` in `readDocs` would leave every `CCD_ARGV.docs*` site there green whatever became of the `ccdCan(` row gate (`ccdsource.ts`'s header says verb-gate is that gate's catcher). Find:
```ts
/**
 * The gated read executor: the gate, then ONE `switch` that builds and runs each read argv (refinement (c)). The two
```
  Replace:
```ts
/** Whether this box's ccd serves the sections that came with `DOCS_SECTIONS_CAP` (rich-docs spec G1, W5b), refusing on
 *  no evidence. Module-level on purpose: a `capSupported(` inside `readDocs` would read to `verb-gate.test.ts` as a gate
 *  for every docs argv there, and hide a lost `ccdCan(` row gate. */
function docsSectionsServed(state: CcdDocsDeps['fleetState']): boolean {
  return capSupported(state, DOCS_SECTIONS_CAP);
}

/**
 * The gated read executor: the gate, then ONE `switch` that builds and runs each read argv (refinement (c)). The two
```
  Add one sentence to the gate's docstring above `readDocs` (Find: `` *   `verbSupported` would permit it. `` — Replace: that line, then `` * - a section that needs `DOCS_SECTIONS_CAP`, on a measured list without it: `unsupported` too (rich-docs spec G1), asked through `docsSectionsServed`. ``).
- [ ] **Step 5: Green.** `docs-source-w5b`, `docs-source` (unchanged, still green), `capsupported`, `ccd-archive`, `verb-gate`, `ccd-can-sites`, `single-definition/docs-ring`, `docs-policy`; `tsc` in `server`.
- [ ] **Step 6: Commit.** Message `server: name vision and promise to ccd only behind docs-sections-v2 (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T3-M1 | M9.3 | `src/docs/ccdsource.ts` | the gate's condition reads `false &&` | `docs-source-w5b` | 2 failed — the vision and promise cases |
| W5B-T3-M2 | M9.3 | `src/docs/policy.ts` | `vision: true` → `vision: false` | `docs-source-w5b` | 1 failed — the vision pin case |
| W5B-T3-M3 | (d) | `src/ccdargv.ts` | the token reads `docs-sections-v1` | `ccd-archive`, `capsupported` | 2 failed |
| W5B-T3-M4 | M9.3 | `src/docs/ccdsource.ts` | `readDocs`' `ccdCan(` row gate deleted (always true) | `verb-gate` | 2 failed — no ungated call site outside `UNGATED_BY_DECISION`; every verb this branch added is gated. Green if the `capSupported(` call sat in `readDocs`' scope, which is why it does not |

```json
{"id": "W5B-T3-M1", "spec": "M9.3", "pkg": "server", "file": "src/docs/ccdsource.ts", "old": "  if (section !== null && DOCS_SECTION_GATED[section] && !docsSectionsServed(deps.fleetState)) {", "new": "  if (false && section !== null && DOCS_SECTION_GATED[section] && !docsSectionsServed(deps.fleetState)) {", "tests": ["test/docs-source-w5b.test.ts"], "red": "2 failed: a vision pin without docs-sections-v2 is unsupported, with zero execs; a promise draft pin, the same"}
{"id": "W5B-T3-M2", "spec": "M9.3", "pkg": "server", "file": "src/docs/policy.ts", "old": "conventions: false, vision: true, promise: true,", "new": "conventions: false, vision: false, promise: true,", "tests": ["test/docs-source-w5b.test.ts"], "red": "1 failed: a vision pin without docs-sections-v2 is unsupported, with zero execs"}
{"id": "W5B-T3-M3", "spec": "(d)", "pkg": "server", "file": "src/ccdargv.ts", "old": "export const DOCS_SECTIONS_CAP = 'docs-sections-v2';", "new": "export const DOCS_SECTIONS_CAP = 'docs-sections-v1';", "tests": ["test/ccd-archive.test.ts", "test/capsupported.test.ts"], "red": "2 failed: the toContain; the spelling case"}
{"id": "W5B-T3-M4", "spec": "M9.3", "pkg": "server", "file": "src/docs/ccdsource.ts", "old": "  const can = ccdCan(deps.fleetState, call.verb === 'docs-index' ? 'docsIndex'", "new": "  const can = ((_s: unknown, _r: string): boolean => true)(deps.fleetState, call.verb === 'docs-index' ? 'docsIndex'", "tests": ["test/verb-gate.test.ts"], "red": "2 failed: has no ungated call site outside UNGATED_BY_DECISION; gates every verb this branch added, at every one of its call sites"}
```

### Task 4: The PWA over a four- or six-section fleet (refinement (d); M9.3, the PWA half)

**Files:** Modify `pwa/src/docs/docsTree.ts`, `pwa/src/docs/DocsIndexView.tsx`, `pwa/src/docs/DocsTreeView.tsx`, `pwa/src/docs/docsText.ts`, `pwa/test/docs-tree.test.ts`; Create `pwa/test/docs-sections.test.tsx`.

- [ ] **Step 1: Red first.** `docs-sections.test.tsx` (the `DocsScreen` with `fakeLoaders` from `pwa/test/docsFixtures.ts`): (1) `'an index row from a four-section fleet counts four sections, with no ? for vision or promise'`; (2) `'an index row from a six-section fleet counts six, vision and promise last'`; (3) `'a project page over a four-section tree draws four section rows'` (M9.3); (4) `'a project page over a six-section tree draws six rows in DOC_SECTIONS order'`; (5) `'a vision page over a four-section tree says the fleet box does not serve it'`; (6) `'a vision leaf over a four-section tree says the same, not Not in this listing'`; (7) `'a ready row whose only docs are in vision is listed with the docs'`. `docs-tree.test.ts`: `sectionFacts` answers `null` for a slug the tree lacks (the counts reader's cases are Task 2's). Run: red.
- [ ] **Step 2: The tree reader.** Find (`pwa/src/docs/docsTree.ts`, as Task 2 left it):
```ts
export function sectionCountsText(counts: Readonly<Partial<Record<DocSectionSlug, number | null>>>): string {
  return presentSectionCounts(counts)
    .map(([slug, n]) => `${n ?? '?'} ${n === 1 ? SECTION_LABEL_ONE[slug] : SECTION_LABEL[slug]}`)
    .join(' · ');
}
```
  Replace: that text, then:
```ts

/** One section's facts from a tree answer. `null` has one meaning: this ccd serves no such section (a fleet box without
 *  the sections token). A section the repository lacks is a fact of its own (`state: 'absent'`), never `null`. THE ONE
 *  READER of `DocsTreeOk.sections`. */
export function sectionFacts(tree: DocsTreeOk, slug: DocSectionSlug): DocsTreeOk['sections'][number] | null {
  return tree.sections.find((s) => s.slug === slug) ?? null;
}
```
- [ ] **Step 3: The views.** Find (`pwa/src/docs/DocsIndexView.tsx`): `import { sectionCountsText } from './docsTree';` — Replace: `import { presentSectionCounts, sectionCountsText } from './docsTree';`. Find: `  if (row.state === 'ready') return row.sections === undefined || Object.values(row.sections).some((n) => n !== 0);` — Replace: `  if (row.state === 'ready') return row.sections === undefined || presentSectionCounts(row.sections).some(([, n]) => n !== 0);`
  Find (`pwa/src/docs/DocsTreeView.tsx`): `import { CLASS_GLYPH, FOLDER_GLYPH, SECTION_LABEL, docsPathKind, leafName, listDir } from './docsTree';` — Replace: `import { CLASS_GLYPH, FOLDER_GLYPH, SECTION_LABEL, docsPathKind, leafName, listDir, sectionFacts } from './docsTree';`. Find: `/** A project's four section rows, in `DOC_SECTIONS` order, and its notes (spec 4.4's project row). */` — Replace: `/** A project's section rows, in `DOC_SECTIONS` order, for the sections the tree answer lists, and its notes (spec 4.4). */`. Find:
```tsx
          const s = tree.sections.find((x) => x.slug === slug);
          if (s === undefined) return null;
```
  Replace:
```tsx
          const s = sectionFacts(tree, slug);
          if (s === null) return null;
```
  Find: `      {listing.folders.length + listing.files.length === 0 && <p className="docs-note">{DOCS_VIEW_TEXT.emptyListing}</p>}` — Replace:
```tsx
      {sectionFacts(tree, section) === null
        ? <p className="docs-note">{DOCS_VIEW_TEXT.sectionUnserved}</p>
        : listing.folders.length + listing.files.length === 0 && <p className="docs-note">{DOCS_VIEW_TEXT.emptyListing}</p>}
```
  Find:
```tsx
function MissingPage(p: { readonly tree: DocsTreeOk }): ReactNode {
  return (
    <div className="docs-missing">
      <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.missing, { short: shortCommit(p.tree.ref.commit) })}</p>
    </div>
  );
}
```
  Replace:
```tsx
function MissingPage(p: { readonly tree: DocsTreeOk; readonly section: DocSectionSlug }): ReactNode {
  const unserved = sectionFacts(p.tree, p.section) === null;
  return (
    <div className="docs-missing">
      <p className="docs-note">
        {unserved ? DOCS_VIEW_TEXT.sectionUnserved : fillSentence(DOCS_VIEW_TEXT.missing, { short: shortCommit(p.tree.ref.commit) })}
      </p>
    </div>
  );
}
```
  Find: `      return kind === 'missing' ? <MissingPage tree={tree} /> : null;` — Replace: `      return kind === 'missing' ? <MissingPage tree={tree} section={page.section} /> : null;`
- [ ] **Step 4: The words.** Find (`pwa/src/docs/docsText.ts`): `  'bad-section': 'That section is not one of the four Docs sections.',` — Replace: `  'bad-section': 'That section is not one of the Docs sections.',`. Find: `  'bad-section': 'This address names a section that is not one of the four Docs sections.',` — Replace: `  'bad-section': 'This address names a section that is not one of the Docs sections.',`. Find: `  missing: 'Not in this listing at {short}.',` — Replace: that line, then `  sectionUnserved: "The fleet box does not serve this section yet; it appears once that box's ccrc is updated.",`. Grep `four sections` and `four Docs sections` across `pwa/src`, `server/src`, `shared` and `ccd`; fix each in a file this run already edits, and list the rest in Results' "Carried, not fixed" for W7.
- [ ] **Step 5: Green.** `docs-sections`, `docs-tree`, `docs-screen`, `docs-failures`, `control-census`, `markup-census`, `tsc` in `pwa`.
- [ ] **Step 6: Commit.** Message `pwa: show the sections a fleet box serves, four or six (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T4-M1 | M9.3 | `src/docs/docsTree.ts` | `presentSectionCounts` (placed by Task 2) keeps a missing slug as `null` | `docs-sections`, `docs-tree` | 6 failed — (1); the missing-slug and four-part cases; the three `sectionCountsText` texts, whose four-key records gain `? vision · ? promise` |
| W5B-T4-M2 | (d) | `src/docs/DocsTreeView.tsx` | the listing's unserved arm reads `false` | `docs-sections` | 1 failed — (5) |
| W5B-T4-M3 | (d) | `src/docs/DocsTreeView.tsx` | `MissingPage`'s `unserved` reads `false` | `docs-sections` | 1 failed — (6) |

```json
{"id": "W5B-T4-M1", "spec": "M9.3", "pkg": "pwa", "file": "src/docs/docsTree.ts", "old": "    return n === undefined ? [] : [[slug, n] as const];", "new": "    return [[slug, n ?? null] as const];", "tests": ["test/docs-sections.test.tsx", "test/docs-tree.test.ts"], "red": "6 failed: an index row from a four-section fleet counts four sections; presentSectionCounts leaves out a missing slug; sectionCountsText over a four-key record has four parts; the three sectionCountsText texts"}
{"id": "W5B-T4-M2", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsTreeView.tsx", "old": "      {sectionFacts(tree, section) === null\n", "new": "      {false\n", "tests": ["test/docs-sections.test.tsx"], "red": "1 failed: a vision page over a four-section tree says the fleet box does not serve it"}
{"id": "W5B-T4-M3", "spec": "(d)", "pkg": "pwa", "file": "src/docs/DocsTreeView.tsx", "old": "  const unserved = sectionFacts(p.tree, p.section) === null;", "new": "  const unserved = false;", "tests": ["test/docs-sections.test.tsx"], "red": "1 failed: a vision leaf over a four-section tree says the same"}
```

### Task 5: The log vocabulary in L0 (refinement (e); M9.7's caps)

**Files:** Modify `shared/docs.ts`, `server/test/docs-shared.test.ts`, `server/test/single-definition/docs-l0.test.ts`, `server/test/docs-url.test.ts`.

- [ ] **Step 1: Red first.** `docs-shared.test.ts`: the four caps hold 100, 200, 100 and 131 072; a worst-case entry set of THREE-byte characters (100 entries, 200-code-point subjects and 100-code-point authors, a 1 KiB path, the longest section, sha1 and sha256 both) stays at or under the wire cap by the framing estimate written beside it (about 109 500 and 114 300 framed bytes); and the same set in FOUR-byte characters is over it (about 139 500 and 144 300), so such a history answers `too-many-entries`, never a list (Task 6's case 23 holds ccd to that); `docs-url.test.ts`: `docsApi.history('demo', {commit, section: 'specs', path: 'a b+c.md'})` is `/api/docs/demo/history?commit=<c>&section=specs&path=a%20b%2Bc.md`. `docs-l0.test.ts`: the four caps join `CAPS`; `DocsLogAsk`, `DocsLogEntry`, `DocsLogOk` and `DocsHistoryResponse` join `TYPES`. Red.
- [ ] **Step 2: The caps.** Find (`shared/docs.ts`):
```ts
/** ccd: the floor between two fetch attempts of one branch. */
export const DOCS_FETCH_MIN_INTERVAL_MS = 10000;
```
  Replace: that text, then:
```ts
/** ccd: the most entries one docs-log answer lists (rich-docs spec G4). The helper stops reading there. */
export const DOCS_LOG_MAX_ENTRIES = 100;
/** ccd: the most code points of one commit subject in a docs-log answer, cut after it is redacted. */
export const DOCS_LOG_SUBJECT_MAX_CHARS = 200;
/** ccd: the most code points of one author name in a docs-log answer, cut after it is redacted. */
export const DOCS_LOG_AUTHOR_MAX_CHARS = 100;
/** ccd's final docs-log guard, in framed bytes; over it the answer is `too-many-entries {count, bytes}`. */
export const DOCS_LOG_MAX_WIRE_BYTES = 131072;
```
- [ ] **Step 3: The types.** Find: `export type DocsVerb = 'docs-index' | 'docs-tree' | 'docs-show' | 'docs-fetch';` — Replace: `export type DocsVerb = 'docs-index' | 'docs-tree' | 'docs-show' | 'docs-fetch' | 'docs-log';`. Find: `export type DocsIndexRow = DocsIndexOk['projects'][number];` — Replace: that line, then:
```ts

/** What a history read asks for (rich-docs spec G4): the doc's place and the commit its walk starts from. Every value
 *  reaches ccd as a value read by fixed index, never as a pathspec: ccd matches the path by exact bytes. */
export interface DocsLogAsk { commit: Sha; section: DocSectionSlug; path: string }

/** One commit that changed the doc. `parent` is the first parent; `null` has one meaning, a root commit. `date` is the
 *  committer date in strict ISO 8601; `author` is the author's name (never an email); both texts are redacted, then cut
 *  to `DOCS_LOG_AUTHOR_MAX_CHARS` and `DOCS_LOG_SUBJECT_MAX_CHARS` code points. */
export interface DocsLogEntry { sha: Sha; parent: Sha | null; date: string; author: string; subject: string }

/** `docs-log`'s answer: the ask echoed, at most `DOCS_LOG_MAX_ENTRIES` entries newest first, and `truncated`: true when
 *  the walk ended short of that many before it reached the start of history (the helper deadline, the stdout cap, or a
 *  shallow repository's cut history), so an older change may be missing. */
export interface DocsLogOk {
  v: 1; verb: 'docs-log'; ok: true; elapsedMs: number;
  commit: Sha; section: DocSectionSlug; path: string; entries: DocsLogEntry[]; truncated: boolean;
}
```
  Find: `export interface DocsRefreshResponse { ok: true; fetch: DocsRefreshFetch; tree: DocsTreeResponse | DocsFailureBody }` — Replace: that line, then `export interface DocsHistoryResponse { ok: true; log: DocsLogOk }`.
- [ ] **Step 4: The URL.** Find: `/** The four docs API routes live under this prefix (spec 3.4). */` — Replace: `/** The docs API routes live under this prefix (spec 3.4; the history route, rich-docs spec G4). */`. Find:
```ts
  refresh: (project: string): string => apiProjectPath(project) + '/refresh',
};
```
  Replace:
```ts
  refresh: (project: string): string => apiProjectPath(project) + '/refresh',
  /** One doc's history (rich-docs spec G4): commit, section, path, in ccd's argv order. */
  history: (project: string, ask: DocsLogAsk): string => apiProjectPath(project) + '/history'
    + apiQuery([['commit', ask.commit], ['section', ask.section], ['path', ask.path]]),
};
```
- [ ] **Step 5: Green.** `docs-shared`, `docs-url`, `single-definition/docs-l0`, `docs-grammar`; `tsc` in `server`, `agent`, `pwa` (an exhaustive `Record<DocsVerb, …>` anywhere reds here; place it).
- [ ] **Step 6: Commit.** Message `docs: the docs-log vocabulary and its caps in L0 (docs W5b-1)`.

Rows: none of its own (constants and types; the parity rows of Task 6 hold the caps).

### Task 6: The ccd verb `docs-log` (refinements (a), (e); M9.4-M9.7, M9.13)

**Files:** Modify `ccd/ccd`, `server/test/docs-parity.test.ts`, `server/test/ccd-docs-index.test.ts` (the caps case), `server/test/ccdCapTokens.ts`; Create `server/test/ccd-docs-log.test.ts`.

- [ ] **Step 1: Red first.** `ccd-docs-log.test.ts`, every end-to-end case through `runCcdDocs` on a fixture HOME with `plantGitRecorder`, each name a row's handle:
  1. `'lists the commits that changed the doc, newest first, with sha, parent, date, author and subject'` (three commits on `docs/superpowers/specs/a.md`, one on `b.md` between them: three entries; the root's `parent` is `null`; `date` matches strict ISO 8601; `truncated` false).
  2. `'git log runs once with exactly the fixed flags, the commit and the section path'` (the recorder's one `log` argv equals the expected list token for token, after the hardened prefix; the test writes that list out, its four `-c` pairs included, never reads `LOG_CFLAGS` or `LOG_ROW`; no `-n` or `--max-count` anywhere; no `fetch`, `show`, `diff` or `cat-file blob` call).
  3. `'the caller path never appears in any argv'` (path `a.md`: no recorded argv holds `a.md`).
  4. `'a path holding * matches only itself'` (`x*.md` and `xy.md` both committed: only `x*.md`'s commits).
  5. `'a doc whose name prefixes another lists only its own commits'` (`a.md` and `a.md.bak`).
  6. `'a merge commit is not listed'` (a merge that touched the doc: absent; its parents' commits present).
  7. `'a subject holding a token is redacted, then cut to 200 code points'` (a `ghp_` token and 300 characters).
  8. `'an author is the name only, redacted, at most 100 code points'`.
  9. `'a doc whose last change is older than the newest 100 commits in its section still lists its history'` (M9.13: 120 commits to `b.md` after the doc's last change).
  10. `'101 matching commits list 100, truncated false'`.
  11. `'a walk the stdout cap ends answers truncated'` (a unit over `parse_log` and `verb_log` with `GIT_STDOUT_CAP` lowered through a planted `SYS` that cuts `out`, as `unitJson` does for show).
  12. `'a walk the deadline ends answers truncated'` (a unit like (11): a planted `SYS` whose spawn answers `timed_out=True`, with a partial `out` holding one whole record and a cut one, ONLY for the argv whose subcommand is `log`; discovery and `cat-file` run for real. Expected: the whole record's entry, and `truncated` true. A `Deadline` already spent cannot reach the log call: `docs_git` spawns nothing past a spent budget, and discovery and `show_object_type` then raise `git-timeout` first).
  13. `'a shallow repository whose walk ends short answers truncated'`.
  14. `'over the wire cap answers too-many-entries {count, bytes}'` (a unit over `guard_log`).
  15. `'grammar refusals make no git call: bad-project, bad-commit (short, uppercase), bad-section (vision passes, wiki fails), bad-path'`, each with zero git calls. A commit of the wrong object length is (20): it is decided only after discovery.
  16. `'an unknown commit is unknown-commit; a tree id is not-a-commit'`.
  17. `'a ninth token, a missing flag or flags out of order is a usage error, rc 1, empty stdout'` (M9.4).
  18. `'the runner refuses log with any other tail'` (units over `git_argv`: `-n 1` inserted; a second pathspec; a pathspec that is not a SECTIONS path; a `C:path` argument; a `-c` pair missing: each `GitRefused`).
  19. `'helper-unavailable when python3 is too old'` (`_docs_front`'s probe, as `ccd-docs-index.test.ts` M7.8 does it).
  20. `'a commit of the wrong object length is bad-commit after discovery'` (a 64-hex commit on a sha1 repository: `bad-commit`, and the recorder holds discovery's calls only, its `rev-parse` and its partial-clone `config` read, with no `cat-file` and no `log`).
  21. `'a repository whose config sets log.showRoot=false still lists the root commit'` (the fixture repository runs `git config log.showRoot false`, creates the doc in its root commit, and merges in a second root that added another doc to the section: the doc's root commit is listed with `parent: null`, the second root's record parses and is not a hit, `truncated` is false, and nothing answers `git-failed`).
  22. `'a section path that was once a file still lists the doc's history'` (a commit holds `docs/vision` as a file; a later commit removes it and adds `docs/vision/a.md`: the doc's commit is listed, and the bare `docs/vision` name is read past, never a hit, never `git-failed`).
  23. `'a hundred entries of four-byte authors and subjects answer too-many-entries; of three-byte ones, the list'` (a unit over `log_entries` and `guard_log`, beside (14), with a 1 KiB path: the four-byte set answers `too-many-entries {count: 100, bytes}` with `bytes` over 131 072; the three-byte set answers its line).
  `docs-parity.test.ts`: `MARKERS` gains `'# ===== docs: log ====='` between show and fetch; `VERBS` names five; `PARITY` and `CAPS` gain the four log caps. `ccd-docs-index.test.ts`: `ccd caps` lists `docs-log` and `docs-log-v1`. `ccdCapTokens.ts` gains `'docs-log-v1'`. Run: red.
- [ ] **Step 2: The bash front, the arm, the usage.** Find (`ccd/ccd`):
```bash
cmd_docs_fetch() {   # --project P [--branch B]; fetch ONE branch from origin into refs/remotes/origin/<b>
  [[ "${1-}" == --project && ( $# -eq 2 || ( $# -eq 4 && "${3-}" == --branch ) ) ]] \
    || die "usage: ccd docs-fetch --project P [--branch B]"
  _docs_front docs-fetch || return 0
  _docs_py docs-fetch "$PROJECTS_ROOT" "$WORKTREES_ROOT" "$REG" "$@" </dev/null
}
```
  Replace: that text, then:
```bash

cmd_docs_log() {   # --project P --commit C --section S --path X; one doc's commits from C back, newest first (rich-docs spec G4)
  # Exactly 8 tokens in this order; the helper reads each value by fixed index, so the path is a value and never a
  # pathspec: git logs the fixed section path, and the helper matches the doc's path by exact bytes.
  [[ $# -eq 8 && "${1-}" == --project && "${3-}" == --commit && "${5-}" == --section && "${7-}" == --path ]] \
    || die "usage: ccd docs-log --project P --commit C --section S --path X"
  _docs_front docs-log || return 0
  _docs_py docs-log "$PROJECTS_ROOT" "$WORKTREES_ROOT" "$REG" "$@" </dev/null
}
```
  Find: `  docs-fetch) shift; cmd_docs_fetch "$@" ;;` — Replace: that line, then `  docs-log)   shift; cmd_docs_log "$@" ;;`. Find: `|docs-index|docs-tree|docs-show|docs-fetch|version} <args>" >&2; exit 1 ;;` — Replace: `|docs-index|docs-tree|docs-show|docs-fetch|docs-log|version} <args>" >&2; exit 1 ;;`.
  Find (as Task 2 left it): `  echo docs-sections-v2   # native Docs reader W5b (rich-docs spec G1): SECTIONS in the Docs helper holds vision and promise; the server names either only behind this word` — Replace: that line, then `  echo docs-log; echo docs-log-v1   # native Docs reader W5b (rich-docs spec G4): the verb, and the token that says it takes exactly this argv; the server sends it only behind the token`
- [ ] **Step 3: The parity literals.** Find: `DOCS_FETCH_MIN_INTERVAL_MS=10000` — Replace:
```python
DOCS_FETCH_MIN_INTERVAL_MS=10000
DOCS_LOG_MAX_ENTRIES=100
DOCS_LOG_SUBJECT_MAX_CHARS=200
DOCS_LOG_AUTHOR_MAX_CHARS=100
DOCS_LOG_MAX_WIRE_BYTES=131072
```
- [ ] **Step 4: The argument reader.** Find: `FetchArgs = namedtuple('FetchArgs', ['project', 'branch'])` — Replace: that line, then `LogArgs = namedtuple('LogArgs', ['project', 'commit', 'section', 'path'])`. Find: `SHOW_DRAFT_FLAGS = ('--project', '--draft-branch', '--head', '--section', '--path', '--fingerprint', '--max-bytes')` — Replace: that line, then `LOG_ARG_FLAGS = ('--project', '--commit', '--section', '--path')`. Find: `    raise RuntimeError('docs argv contract: no argument reader for ' + repr(verb))` — Replace:
```python
    if verb == 'docs-log':
        project, commit, section, raw_path = _values(rest, LOG_ARG_FLAGS)
        _refuse(valid_project(project), 'bad-project')
        _refuse(valid_sha(commit), 'bad-commit')
        _refuse(valid_section(section), 'bad-section')
        rel = valid_rel_path(raw_path)
        _refuse(rel is not None, 'bad-path')
        return LogArgs(project, commit, section, rel)
    raise RuntimeError('docs argv contract: no argument reader for ' + repr(verb))
```
  In `read_args`' docstring add `log -- project, commit, section, path.` to its "Order:" sentence.
- [ ] **Step 5: The runner.** Find: `HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45}` — Replace: `HELPER_DEADLINE_S={'docs-index':12,'docs-tree':12,'docs-show':7,'docs-fetch':45,'docs-log':10}`. Find: `CALL_S={'ref':5,'list':8,'count':2,'show':5,'onref':2,'fetch':40,'index':5}` — Replace: `CALL_S={'ref':5,'list':8,'count':2,'show':5,'onref':2,'fetch':40,'index':5,'log':8}`. Find:
```python
READ_ALLOW = (
    ('rev-parse',), ('symbolic-ref',), ('for-each-ref',), ('ls-tree',),
    ('cat-file', '--batch-check'), ('cat-file', 'blob'),
    ('worktree', 'list'), ('status',), ('ls-files',),
    ('merge-base', '--is-ancestor'), ('rev-list', '--left-right', '--count'),
    ('config', '--get'), ('config', '-z', '--get-regexp'),
)
```
  Replace:
```python
# The log row (rich-docs spec G4, M9.5; docs-log only): `log` runs with exactly
# these -c pairs and this head, then `--end-of-options <commit> -- <section
# path>`, and nothing else: no -n, no other pathspec, no caller's path
# (git_argv checks the whole tail). The format has no `format:` prefix, so the
# no-colon rule below holds for log too (git reads a string holding % as
# tformat): five NUL-ended fields, the newline before the names, NUL-ended names.
# The -c pairs pin every log.* setting that changes that shape, since the
# user's and the repository's config are still read: under log.showRoot=false
# a root commit prints no newline and no names (measured, git 2.53).
LOG_CFLAGS = ('-c', 'log.showSignature=false', '-c', 'log.follow=false', '-c', 'log.mailmap=false',
              '-c', 'log.showRoot=true')
LOG_ROW = ('log', '--no-show-signature', '--encoding=UTF-8', '--no-merges',
           '--format=%H%x00%P%x00%cI%x00%an%x00%s', '-z', '--name-only')
READ_ALLOW = (
    ('rev-parse',), ('symbolic-ref',), ('for-each-ref',), ('ls-tree',),
    ('cat-file', '--batch-check'), ('cat-file', 'blob'),
    ('worktree', 'list'), ('status',), ('ls-files',),
    ('merge-base', '--is-ancestor'), ('rev-list', '--left-right', '--count'),
    ('config', '--get'), ('config', '-z', '--get-regexp'),
    LOG_ROW,
)
```
  Find: `OBJECT_NAME_VERBS = ('cat-file', 'ls-tree', 'rev-parse', 'merge-base', 'rev-list')` — Replace: `OBJECT_NAME_VERBS = ('cat-file', 'ls-tree', 'rev-parse', 'merge-base', 'rev-list', 'log')`. Find:
```python
    if sub[0] in OBJECT_NAME_VERBS and any(':' in a for a in sub[1:]):
        raise GitRefused('no <rev>:<path> object names: ' + sub[0])
```
  Replace: that text, then:
```python
    if sub[0] == 'log' and (tuple(cflags) != LOG_CFLAGS or len(sub) != len(LOG_ROW) + 4
                            or sub[-4] != '--end-of-options' or sub[-2] != '--'
                            or sub[-1] not in SECTIONS.values()):
        raise GitRefused('log takes its fixed flags, one commit and one section path')
```
- [ ] **Step 6: The log section.** Find:
```python
    return encode_show(data, base)

# ===== docs: fetch =====
```
  Replace:
```python
    return encode_show(data, base)

# ===== docs: log =====
# docs-log (rich-docs spec 2026-10-12 G4; W5b): one doc's commits, newest
# first, from --commit back. ONE `git log` of the fixed SECTION path (LOG_ROW),
# so the caller's path never reaches an argv or a pathspec. No -n: the helper
# keeps the first DOCS_LOG_MAX_ENTRIES records whose names hold the doc's repo
# path, byte for byte, and stops there. The helper deadline and GIT_STDOUT_CAP
# bound the walk; a walk either ended short of that many is `truncated`, and so
# is a shallow repository's short walk, since a cut history can hide older
# commits (on_ref's rule).
LOG_SHA_RE = re.compile(rb'[0-9a-f]{40}|[0-9a-f]{64}')


def parse_log(buf, sec_b, want, limit):
    """The records of LOG_ROW's output whose names hold `want` exactly, as
    (sha, parents, date, author, subject) byte strings, newest first, at most
    `limit`. A record is five NUL-ended fields, the newline git writes before
    the names, then NUL-ended names, each under `sec_b` + '/' or `sec_b`
    itself (the pathspec limits them; the bare name is a commit that touched a
    FILE at the section path, which is never the doc but must be read past);
    the next record starts after the last name's NUL. A buffer cut inside a
    record (an expiry or the stdout cap) ends the walk at the last whole
    record. A record that does not parse is git-failed {step:'log'}."""
    rows = []
    prefix = sec_b + b'/'
    bare = sec_b + b'\0'
    i, n = 0, len(buf)
    while i < n and len(rows) < limit:
        fields = []
        for _ in range(5):
            j = buf.find(b'\0', i)
            if j < 0:
                return rows
            fields.append(buf[i:j])
            i = j + 1
        if i >= n:
            return rows
        parent = fields[1].split(b' ')[0]
        if (buf[i:i + 1] != b'\n' or not LOG_SHA_RE.fullmatch(fields[0])
                or (parent and not LOG_SHA_RE.fullmatch(parent))):
            raise fail('git-failed', step='log', detail='unexpected log output')
        i += 1
        hit = False
        while i < n and (buf.startswith(prefix, i) or buf.startswith(bare, i)):
            j = buf.find(b'\0', i)
            if j < 0:
                return rows
            hit = hit or buf[i:j] == want
            i = j + 1
        if hit:
            rows.append(tuple(fields))
    return rows


def log_entries(rows):
    """The wire entries for parse_log's rows: sha, first parent (None for a
    root commit), the committer date, and the author and subject decoded,
    redacted by ONE redactor call over their lines (neither can hold a
    newline; the line count is checked), then cut to their caps in code
    points, so a cut never splits a secret the redactor would have matched."""
    texts = []
    for row in rows:
        texts.append(row[3].decode('utf-8', 'replace'))
        texts.append(row[4].decode('utf-8', 'replace'))
    red = redact('\n'.join(texts)).split('\n') if texts else []
    if len(red) != len(texts):
        raise RuntimeError('docs-log: the redactor changed the line count')
    out = []
    for k, row in enumerate(rows):
        first = row[1].split(b' ')[0]
        out.append({'sha': row[0].decode('ascii'),
                    'parent': first.decode('ascii') if first else None,
                    'date': row[2].decode('ascii', 'replace'),
                    'author': red[2 * k][:DOCS_LOG_AUTHOR_MAX_CHARS],
                    'subject': red[2 * k + 1][:DOCS_LOG_SUBJECT_MAX_CHARS]})
    return out


def guard_log(obj, line):
    """docs-log's final guard (M9.7): `line`, or too-many-entries {count,
    bytes} in its place when the entries pass DOCS_LOG_MAX_ENTRIES or the line,
    framed as the agent frames it, passes DOCS_LOG_MAX_WIRE_BYTES (the
    listings' word and measure). run() hands it ok lines only."""
    count = len(obj['entries'])
    size = framed_len(line)
    if count <= DOCS_LOG_MAX_ENTRIES and size <= DOCS_LOG_MAX_WIRE_BYTES:
        return line
    return line_of({'v': 1, 'verb': obj['verb'], 'ok': False, 'elapsedMs': obj['elapsedMs'],
                    'failure': 'too-many-entries', 'count': count, 'bytes': size})


def verb_log(ctx, a):
    """docs-log: the doc's history as DocsLogOk's body. Discovery first, as in
    every verb; the commit must be the repository's own object-id length (else
    bad-commit), present (else unknown-commit) and a commit (else
    not-a-commit), as a committed docs-show checks it. One log call, soft: an
    expiry or the stdout cap keeps what was read, and any other non-zero rc is
    git-failed {step:'log'}. run() puts the line through guard_log."""
    dl = Deadline(HELPER_DEADLINE_S[ctx.verb])
    repo = discover(ctx, a.project, dl)
    if len(a.commit) != SHOW_OID_HEX.get(repo.object_format):
        raise fail('bad-commit')
    kind = show_object_type(repo, a.commit, dl)
    if kind is None:
        raise fail('unknown-commit')
    if kind != 'commit':
        raise fail('not-a-commit')
    sec = SECTIONS[a.section]
    r = docs_git(repo.path, list(LOG_CFLAGS) + list(LOG_ROW) + ['--end-of-options', a.commit, '--', sec],
                 call_s=CALL_S['log'], dl=dl, ceiling=ceiling_of(repo.path), soft=True)
    cut = r.timed_out or r.overflow
    if not cut and r.rc != 0:
        raise show_failed('log', r)
    want = (sec + '/' + a.path).encode('utf-8')
    entries = log_entries(parse_log(r.out, sec.encode('ascii'), want, DOCS_LOG_MAX_ENTRIES))
    truncated = len(entries) < DOCS_LOG_MAX_ENTRIES and (cut or repo.shallow)
    return {'commit': a.commit, 'section': a.section, 'path': a.path, 'entries': entries, 'truncated': truncated}

# ===== docs: fetch =====
```
- [ ] **Step 7: The entry.** Find: `VERBS = {'docs-index': verb_index, 'docs-tree': verb_tree, 'docs-show': verb_show, 'docs-fetch': verb_fetch}` — Replace: `VERBS = {'docs-index': verb_index, 'docs-tree': verb_tree, 'docs-show': verb_show, 'docs-fetch': verb_fetch, 'docs-log': verb_log}`. Find:
```python
        elif verb == 'docs-show':
            line = guard_show(line)
```
  Replace: that text, then:
```python
        elif verb == 'docs-log':
            line = guard_log(obj, line)
```
  In `run`'s docstring, after "and guard_show(line) every ok docs-show answer", add ", and guard_log(obj, line) every ok docs-log answer".
- [ ] **Step 8: Green,** each alone first (load-sensitive): `ccd-docs-log`, `docs-parity`, `ccd-docs-index`, `ccd-docs-show`, `ccd-docs-tree`, `ccd-docs-fetch`, `ccd-docs-helper-redactor`, `ccd-archive`, `caps-token-shape`, `wsaudit`, `ownership`, `ccd-harness-containment`, `macos-platform`, `install-census`; then `citations` and `GROWTH_CHECK=1 growth-check` (expected: `ccd/ccd` over 40, red until Task 12's waiver; record the delta). Two suites are red from this task until Task 8, as expected, and are not run here: `ccd-verb-sets` (its `'dispatched, never sent: exactly SERVER_NEVER_SENDS'` sees a `docs-log` arm with no `CCD_ARGV` row until Task 8 adds `docsLog`) and `docs-budget` (its `helperDeadlinesIn` throws unless `HELPER_DEADLINE_S` holds exactly the `DOCS_BUDGET_VERBS`, which gain `'docs-log'` in Task 8). Task 8's green list holds both.
- [ ] **Step 9: Commit.** Message `ccd: docs-log, one doc's history from a commit, by fixed index (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T6-M1 | M9.4 | `../ccd/ccd` | the front's `$# -eq 8` → `$# -ge 8` | `ccd-docs-log` | 1 failed — (17) |
| W5B-T6-M2 | M9.5 | `../ccd/ccd` | `'--no-merges', ` dropped from `LOG_ROW` | `ccd-docs-log` | 2 failed — (2), (6) |
| W5B-T6-M3 | M9.13 | `../ccd/ccd` | `'--max-count=100', ` added to `LOG_ROW` | `ccd-docs-log` | 2+ failed — (9), (2) |
| W5B-T6-M4 | M9.6 | `../ccd/ccd` | the pathspec is the doc's path | `ccd-docs-log` | 10+ failed — (1), (2) and every other case that reaches the log call, each `helper-failed`: the runner's shape check refuses the argv (`sub[-1]` is no `SECTIONS` path) before anything spawns. Not (3), which records no argv at all, and not (18), a unit over `git_argv` with its own inputs |
| W5B-T6-M5 | M9.6 | `../ccd/ccd` | exact match → prefix match | `ccd-docs-log` | 2 failed — (4), (5) |
| W5B-T6-M6 | M9.7 | `../ccd/ccd` | the redactor skipped | `ccd-docs-log` | 2 failed — (7), (8) |
| W5B-T6-M7 | M9.7 | `../ccd/ccd` | the subject cap dropped | `ccd-docs-log` | 1 failed — (7) |
| W5B-T6-M8 | M9.7 | `../ccd/ccd` | the parent dropped (always `None`) | `ccd-docs-log` | 1 failed — (1) |
| W5B-T6-M9 | M9.7 | `../ccd/ccd` | `truncated` always false | `ccd-docs-log` | 3 failed — (11), (12), (13) |
| W5B-T6-M10 | M9.7 | `../ccd/ccd` | the guard's wire bound dropped | `ccd-docs-log` | 2 failed — (14), (23) |
| W5B-T6-M11 | M9.5 | `../ccd/ccd` | the runner's log shape check dropped | `ccd-docs-log` | 1 failed — (18) |
| W5B-T6-M12 | M9.5 | `../ccd/ccd` | `'log'` dropped from `OBJECT_NAME_VERBS` | `ccd-docs-log` | 1 failed — (18), its `C:path` case |
| W5B-T6-M13 | (e) | `../ccd/ccd` | the `log.showRoot=true` pair dropped from `LOG_CFLAGS` | `ccd-docs-log` | 2 failed — (21) (the second root's record answers `git-failed`), (2) (its expected argv spells the pair) |
| W5B-T6-M14 | (e) | `../ccd/ccd` | `parse_log`'s bare section-path arm dropped | `ccd-docs-log` | 1 failed — (22) |

```json
{"id": "W5B-T6-M1", "spec": "M9.4", "pkg": "server", "file": "../ccd/ccd", "old": "  [[ $# -eq 8 && \"${1-}\" == --project && \"${3-}\" == --commit", "new": "  [[ $# -ge 8 && \"${1-}\" == --project && \"${3-}\" == --commit", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: a ninth token, a missing flag or flags out of order is a usage error"}
{"id": "W5B-T6-M2", "spec": "M9.5", "pkg": "server", "file": "../ccd/ccd", "old": "LOG_ROW = ('log', '--no-show-signature', '--encoding=UTF-8', '--no-merges',", "new": "LOG_ROW = ('log', '--no-show-signature', '--encoding=UTF-8',", "tests": ["test/ccd-docs-log.test.ts"], "red": "2 failed: git log runs once with exactly the fixed flags; a merge commit is not listed"}
{"id": "W5B-T6-M3", "spec": "M9.13", "pkg": "server", "file": "../ccd/ccd", "old": "LOG_ROW = ('log', '--no-show-signature', '--encoding=UTF-8', '--no-merges',", "new": "LOG_ROW = ('log', '--max-count=100', '--no-show-signature', '--encoding=UTF-8', '--no-merges',", "tests": ["test/ccd-docs-log.test.ts"], "red": "2+ failed: a doc whose last change is older than the newest 100 commits; git log runs once with exactly the fixed flags"}
{"id": "W5B-T6-M4", "spec": "M9.6", "pkg": "server", "file": "../ccd/ccd", "old": "['--end-of-options', a.commit, '--', sec],", "new": "['--end-of-options', a.commit, '--', sec + '/' + a.path],", "tests": ["test/ccd-docs-log.test.ts"], "red": "10+ failed: lists the commits; git log runs once with exactly the fixed flags; every other case that reaches the log call, each helper-failed (the runner's shape check refuses the argv before any spawn); not the caller-path case, not the runner unit"}
{"id": "W5B-T6-M5", "spec": "M9.6", "pkg": "server", "file": "../ccd/ccd", "old": "            hit = hit or buf[i:j] == want", "new": "            hit = hit or buf[i:j].startswith(want)", "tests": ["test/ccd-docs-log.test.ts"], "red": "2 failed: a path holding * matches only itself; a doc whose name prefixes another"}
{"id": "W5B-T6-M6", "spec": "M9.7", "pkg": "server", "file": "../ccd/ccd", "old": "    red = redact('\\n'.join(texts)).split('\\n') if texts else []", "new": "    red = '\\n'.join(texts).split('\\n') if texts else []", "tests": ["test/ccd-docs-log.test.ts"], "red": "2 failed: a subject holding a token is redacted; an author is the name only, redacted"}
{"id": "W5B-T6-M7", "spec": "M9.7", "pkg": "server", "file": "../ccd/ccd", "old": "'subject': red[2 * k + 1][:DOCS_LOG_SUBJECT_MAX_CHARS]})", "new": "'subject': red[2 * k + 1]})", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: a subject holding a token is redacted, then cut to 200 code points"}
{"id": "W5B-T6-M8", "spec": "M9.7", "pkg": "server", "file": "../ccd/ccd", "old": "'parent': first.decode('ascii') if first else None,", "new": "'parent': None,", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: lists the commits that changed the doc, newest first, with sha, parent"}
{"id": "W5B-T6-M9", "spec": "M9.7", "pkg": "server", "file": "../ccd/ccd", "old": "    truncated = len(entries) < DOCS_LOG_MAX_ENTRIES and (cut or repo.shallow)", "new": "    truncated = False", "tests": ["test/ccd-docs-log.test.ts"], "red": "3 failed: the stdout cap, the deadline and the shallow cases"}
{"id": "W5B-T6-M10", "spec": "M9.7", "pkg": "server", "file": "../ccd/ccd", "old": "    if count <= DOCS_LOG_MAX_ENTRIES and size <= DOCS_LOG_MAX_WIRE_BYTES:", "new": "    if count <= DOCS_LOG_MAX_ENTRIES:", "tests": ["test/ccd-docs-log.test.ts"], "red": "2 failed: over the wire cap answers too-many-entries {count, bytes}; a hundred entries of four-byte authors and subjects answer too-many-entries"}
{"id": "W5B-T6-M11", "spec": "M9.5", "pkg": "server", "file": "../ccd/ccd", "old": "    if sub[0] == 'log' and (tuple(cflags) != LOG_CFLAGS", "new": "    if False and sub[0] == 'log' and (tuple(cflags) != LOG_CFLAGS", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: the runner refuses log with any other tail"}
{"id": "W5B-T6-M12", "spec": "M9.5", "pkg": "server", "file": "../ccd/ccd", "old": "OBJECT_NAME_VERBS = ('cat-file', 'ls-tree', 'rev-parse', 'merge-base', 'rev-list', 'log')", "new": "OBJECT_NAME_VERBS = ('cat-file', 'ls-tree', 'rev-parse', 'merge-base', 'rev-list')", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: the runner refuses log with any other tail (its C:path case)"}
{"id": "W5B-T6-M13", "spec": "(e)", "pkg": "server", "file": "../ccd/ccd", "old": "LOG_CFLAGS = ('-c', 'log.showSignature=false', '-c', 'log.follow=false', '-c', 'log.mailmap=false',\n              '-c', 'log.showRoot=true')", "new": "LOG_CFLAGS = ('-c', 'log.showSignature=false', '-c', 'log.follow=false', '-c', 'log.mailmap=false')", "tests": ["test/ccd-docs-log.test.ts"], "red": "2 failed: a repository whose config sets log.showRoot=false still lists the root commit; git log runs once with exactly the fixed flags"}
{"id": "W5B-T6-M14", "spec": "(e)", "pkg": "server", "file": "../ccd/ccd", "old": "        while i < n and (buf.startswith(prefix, i) or buf.startswith(bare, i)):", "new": "        while i < n and buf.startswith(prefix, i):", "tests": ["test/ccd-docs-log.test.ts"], "red": "1 failed: a section path that was once a file still lists the doc's history"}
```

### Task 7: The agent's grant (M9.4, the grant half)

**Files:** Modify `agent/src/whitelist.ts`, `agent/test/whitelist.test.ts`, `agent/test/whitelist-structural.test.ts`, `server/test/whitelist-subset.test.ts`; Create `agent/test/types/bypasses/g28-docs-log-without-project.ts`.

- [ ] **Step 1: Red first.** The bypass fixture, g18's shape for the history verb (`ccd: [['start'], ['docs-log']]`, `LawfulGrants` proof line), registered in `whitelist-structural.test.ts` as `'g28-docs-log-without-project.ts': { what: 'the docs history verb granted without --project', codes: ['TS2322'] }`, and in its "only with its flag" table (`[['docs-log'], '--project']`). `whitelist.test.ts`: the 8-token argv is allowed; `['docs-log', 'demo']` and `['docs-log', '--commit', …]` are not. `whitelist-subset.test.ts`: the docs verbs' grant list (`'docs verbs are grantable ONLY with their flag …'`'s `GRANTS`) gains `['docs-log', '--project']`, and an `isExecAllowed` case allows the literal 8-token argv. Its builder table `EXPECTED` is typed `Record<keyof typeof CCD_ARGV, string[]>`, so its `docsLog` row waits for Task 8, which creates `CCD_ARGV.docsLog` (a row here would be an excess-property `tsc` error). Red.
- [ ] **Step 2: The grant.** Find (`agent/src/whitelist.ts`): `  'docs-index': '--all', 'docs-tree': '--project', 'docs-show': '--project', 'docs-fetch': '--project',` — Replace: `  'docs-index': '--all', 'docs-tree': '--project', 'docs-show': '--project', 'docs-fetch': '--project', 'docs-log': '--project',`. Find:
```ts
    // The one docs verb that writes: a fetch of one branch from origin.
    ['docs-fetch', '--project'],
```
  Replace: that text, then:
```ts
    // One doc's history (rich-docs spec G4; the server sends it behind its own cap token): read-only, 8 tokens, ENROLLED above on
    // `--project` like the four; ccd dies with usage on any other shape.
    ['docs-log',   '--project'],
```
- [ ] **Step 3: Green.** The whole `agent` suite and `tsc`; `server`'s `whitelist-subset`.
- [ ] **Step 4: Commit.** Message `agent: grant docs-log on --project, enrolled (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T7-M1 | M9.4 | `src/whitelist.ts` | the `REQUIRED_VERB_FLAG` entry dropped | `whitelist-structural` | 2 failed — g28 compiles; the "only with its flag" table's `[['docs-log'], '--project']` |
| W5B-T7-M2 | M9.4 | `src/whitelist.ts` | the grant narrowed to `['docs-log']` | `whitelist-structural` (its `tsc` of the source) | 1+ failed |

```json
{"id": "W5B-T7-M1", "spec": "M9.4", "pkg": "agent", "file": "src/whitelist.ts", "old": "'docs-fetch': '--project', 'docs-log': '--project',", "new": "'docs-fetch': '--project',", "tests": ["test/whitelist-structural.test.ts"], "red": "2 failed: g28-docs-log-without-project.ts must not compile; docs-log is grantable only with --project"}
{"id": "W5B-T7-M2", "spec": "M9.4", "pkg": "agent", "file": "src/whitelist.ts", "old": "    ['docs-log',   '--project'],", "new": "    ['docs-log'],", "tests": ["test/whitelist-structural.test.ts"], "red": "1+ failed: the source no longer typechecks (TS2322 on the enrolled verb)"}
```

### Task 8: The builder, the cap row and the runner budget (M9.9, M9.12)

**Files:** Modify `server/src/ccdargv.ts`, `server/src/remote/runner.ts`, `server/test/ccdArgvSamples.ts`, `server/test/whitelist-subset.test.ts`, `server/test/verb-gate.test.ts`, `server/test/ccd-can-sites.test.ts`, `server/test/capsupported.test.ts`, `server/test/ccd-archive.test.ts`, `server/test/docs-budget.test.ts`, and `ccdargv-brand`/`ccdargv-dec-parity` if they enumerate `CCD_ARGV`'s rows.

- [ ] **Step 1: Red first.** `ccdArgvSamples.ts`: `CCD_ARGV_SAMPLES` gains `docsLog: ['demo', 'a'.repeat(40), 'specs', 'a.md']` beside the docs samples (`whitelist-subset.test.ts` holds its keys equal to `CCD_ARGV`'s, and `ccd-verb-sets.test.ts` builds every row from it). `whitelist-subset.test.ts`: `EXPECTED` gains `docsLog: ['docs-log', '--project', 'demo', '--commit', 'a'.repeat(40), '--section', 'specs', '--path', 'a.md']` (moved here from Task 7). `verb-gate.test.ts`: `'docs-log'` joins `CAP_GATED_VERBS` and the second docs list (`verb-gate.test.ts` near its `'docs-fetch', 'ws-collect', 'project-add'` list). `ccd-can-sites.test.ts`: `'docs-log over a list without docs-log-v1 is unsupported, with zero execs'` over `FOUR(DOCS_LOG_CAP)`. `capsupported.test.ts`: `DOCS_LOG_CAP` is `'docs-log-v1'`, spelled once. `ccd-archive.test.ts`: `toContain(DOCS_LOG_CAP)`. `docs-budget.test.ts`: `DOCS_BUDGET_VERBS` gains `'docs-log'`; the rows case reads five budgets (20 000 for `docs-log`); "exactly the four docs verbs" becomes "exactly the docs verbs" in its two messages and its CONTROL. Red.
- [ ] **Step 2: The builder and the row.** Find (`server/src/ccdargv.ts`):
```ts
  docsFetch: (project: string, branch: string | null) =>
               argv(['docs-fetch', '--project', project, ...docsBranchFlags(branch)]),
} as const;
```
  Replace:
```ts
  docsFetch: (project: string, branch: string | null) =>
               argv(['docs-fetch', '--project', project, ...docsBranchFlags(branch)]),

  /** One doc's history (rich-docs spec 2026-10-12 G4, W5b): the commits from `commit` back that changed
   *  `section/path`, newest first, at most 100. 8 tokens after the verb, under its own grant
   *  `['docs-log','--project']`, behind `DOCS_LOG_CAP`. The path is a value read by fixed index, never a pathspec. */
  docsLog: (project: string, commit: string, section: DocSectionSlug, path: string) =>
             argv(['docs-log', '--project', project, '--commit', commit, '--section', section, '--path', path]),
} as const;
```
  Find (as Task 3 left it): `export const DOCS_SECTIONS_CAP = 'docs-sections-v2';` — Replace: that line, then:
```ts

/** The `ccd caps` token that says this box's ccd has `docs-log` at exactly the argv `docsLog` builds (rich-docs spec
 *  G4, W5b). Spelled ONCE in `server/src`; ccd's `echo docs-log-v1` and `ccdCapTokens.ts` are the other two spellings.
 *  Read through `ccdCan`'s `docsLog` row (refuses on no evidence), inside the docs gate's tri-state. */
export const DOCS_LOG_CAP = 'docs-log-v1';
```
  Find:
```ts
  docsShowDraft: capRow(DOCS_CAP),
  docsFetch: capRow(DOCS_CAP),
} as const satisfies Record<keyof typeof CCD_ARGV, CanRow>;
```
  Replace:
```ts
  docsShowDraft: capRow(DOCS_CAP),
  docsFetch: capRow(DOCS_CAP),
  docsLog: capRow(DOCS_LOG_CAP),
} as const satisfies Record<keyof typeof CCD_ARGV, CanRow>;
```
- [ ] **Step 3: The budget.** Find (`server/src/remote/runner.ts`):
```ts
  'docs-show': 15_000,
  'docs-fetch': 60_000,
};
```
  Replace:
```ts
  'docs-show': 15_000,
  'docs-fetch': 60_000,
  // docs-log (rich-docs spec G4, W5b): helper deadline 10 s, so 10 + 2 + the redactor's 0.9 + 5 = 17.9 s < 20 s.
  'docs-log': 20_000,
};
```
  In the comment above the docs rows, "The four Docs verbs" becomes "The Docs verbs", and the deadline list gains "log 10 s".
- [ ] **Step 4: Green.** `verb-gate`, `ccd-can-sites`, `capsupported`, `ccd-archive`, `docs-budget` and `ccd-verb-sets` (both red since Task 6, green from here), `remote-runner`, `ccdargv-brand`, `ccdargv-dec-parity`, `whitelist-subset`, `pr-timeout-budget`; `tsc`.
- [ ] **Step 5: Commit.** Message `server: the docs-log builder, its cap row and its runner budget (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T8-M1 | M9.9 | `src/ccdargv.ts` | `docsLog: capRow(DOCS_LOG_CAP)` → `verbRow('docs-log')` | `ccd-can-sites`, `verb-gate` | 1+ failed — the zero-exec case over `null` |
| W5B-T8-M2 | M9.12 | `src/remote/runner.ts` | `'docs-log': 20_000` → `17_000` | `docs-budget` | 3 failed — the rows case (it pins the five budgets by value), the inequality and the redactor inequality |

```json
{"id": "W5B-T8-M1", "spec": "M9.9", "pkg": "server", "file": "src/ccdargv.ts", "old": "  docsLog: capRow(DOCS_LOG_CAP),", "new": "  docsLog: verbRow('docs-log'),", "tests": ["test/ccd-can-sites.test.ts", "test/verb-gate.test.ts"], "red": "1+ failed: docs-log over a list without docs-log-v1 is unsupported, with zero execs (no evidence permits)"}
{"id": "W5B-T8-M2", "spec": "M9.12", "pkg": "server", "file": "src/remote/runner.ts", "old": "  'docs-log': 20_000,", "new": "  'docs-log': 17_000,", "tests": ["test/docs-budget.test.ts"], "red": "3 failed: the five CCD_VERB_TIMEOUT_MS rows; docs-log: helper deadline + KILL_GRACE_S + 5 s; … + REDACT_BUDGET_MS + 5 s"}
```

### Task 9: The port, the adapter and the policy (refinement (f); M9.3's log half, M9.7's server half, M9.9)

**Files:** Modify `server/src/docs/ports.ts`, `server/src/docs/ccdsource.ts`, `server/src/docs/policy.ts`, `server/test/docs-source-w5b.test.ts` (Task 3's), `server/test/docs-policy.test.ts`, `server/test/consolidationCensus.ts` (one row: it lists every docs `runCcd(` site in `ccdsource.ts`, `consolidationCensus.ts:311-314`).

- [ ] **Step 1: Red first.** `docs-source-w5b.test.ts`, appended describe `'the log read (rich-docs spec G4)'`, over the recording runner and canned lines: (1) `'a list without docs-log-v1 is unsupported, with zero execs'` (M9.9); (2) `'with docs-log-v1 the argv is exactly the builder's 9 tokens'`; (3) `'a log of a vision doc without docs-sections-v2 is unsupported, with zero execs'` (M9.3); (4) `'an answer for another path, section or commit is malformed-answer {why:pin}'`; (5) `'a ccd failure line is carried verbatim'` (`unknown-commit`); (6) `'an answer over HISTORY_JOB's wire is malformed-answer {why:oversize}'`. `docs-policy.test.ts`: (7) `parseDocsApiQuery('history', …)`: the three keys in any order parse; a missing key is `bad-query {why:'pin-shape'}`; a repeated key `{why:'repeated'}`; an unknown key `{why:'unknown'}`; a short commit `bad-commit`; `wiki` `bad-section`; `../a` `bad-path`; (8) `docsAnswerShape('docs-log', …)`: a good answer passes; 101 entries, a short sha, a non-hex parent, a 201-code-point subject, a 101-code-point author, a non-boolean `truncated`, and an unredacted subject (`redactDocsText` would change it) each give `{why:'schema'}`; (9) `docsLogFlightKey` differs in each field; (10) `HISTORY_JOB` is frozen and equal to the cap. Red.
- [ ] **Step 2: The port.** Find (`server/src/docs/ports.ts`):
```ts
import type {
  DocPin, DocsFailureBody, DocsFetchOk, DocsIndexOk, DocsRefSpec, DocsShowOk, DocsTreeOk,
} from '../../../shared/docs.js';
```
  Replace:
```ts
import type {
  DocPin, DocsFailureBody, DocsFetchOk, DocsIndexOk, DocsLogAsk, DocsLogOk, DocsRefSpec, DocsShowOk, DocsTreeOk,
} from '../../../shared/docs.js';
```
  Find: `export type DocsFetchRun = { ok: true; answer: DocsFetchOk } | DocsFailureBody;` — Replace: that line, then:
```ts

/** `docs-log`'s answer, carried verbatim once it echoes the ask, or the failure (rich-docs spec G4). */
export type DocsLogRead = { ok: true; answer: DocsLogOk } | DocsFailureBody;
```
  Find:
```ts
  show(src: DocsSourceId, pin: DocPin, ask: DocsShowAsk): Promise<DocsShowRead>;
}
```
  Replace:
```ts
  show(src: DocsSourceId, pin: DocPin, ask: DocsShowAsk): Promise<DocsShowRead>;
  /** One doc's history from `ask.commit` back (rich-docs spec G4); `ask` is what L1's history parser admitted. */
  log(src: DocsSourceId, ask: DocsLogAsk): Promise<DocsLogRead>;
}
```
  The interface's comment "The three reads" becomes "The four reads".
- [ ] **Step 3: L1.** Find (`server/src/docs/policy.ts`, the import block): `  type DocsFetchOk, type DocsFileResponse, type DocsRefreshFetch, type DocsRefreshResponse, type DocsRefSpec,` — Replace: `  type DocsFetchOk, type DocsFileResponse, type DocsLogAsk, type DocsRefreshFetch, type DocsRefreshResponse, type DocsRefSpec,`; and in the same block add `DOCS_LOG_AUTHOR_MAX_CHARS, DOCS_LOG_MAX_ENTRIES, DOCS_LOG_MAX_WIRE_BYTES, DOCS_LOG_SUBJECT_MAX_CHARS,` and `redactDocsText,` in sorted place. Find:
```ts
/** The three GET routes whose query `parseDocsApiQuery` reads. The refresh POST's body is `parseDocsRefreshBody`'s. */
export type DocsApiRoute = 'projects' | 'tree' | 'file';
```
  Replace:
```ts
/** The four GET routes whose query `parseDocsApiQuery` reads. The refresh POST's body is `parseDocsRefreshBody`'s. */
export type DocsApiRoute = 'projects' | 'tree' | 'file' | 'history';
```
  Find:
```ts
  | { route: 'file'; pin: DocPin };
```
  Replace:
```ts
  | { route: 'file'; pin: DocPin }
  | { route: 'history'; ask: DocsLogAsk };
```
  Find:
```ts
  file: [...DOCS_PIN_KEYS, 'section', 'path'],
};
```
  Replace:
```ts
  file: [...DOCS_PIN_KEYS, 'section', 'path'],
  history: [PIN_COMMIT, 'section', 'path'],
};
```
  (`PIN_COMMIT` is declared above `API_KEYS`, `policy.ts:204`.) Find:
```ts
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, req: { route, pin: pin.pin } } : pin;
}
```
  Replace:
```ts
  if (route === 'history') {
    // Rich-docs spec G4: all three keys, then each value in ccd's argv order (commit, section, path).
    if (!Object.hasOwn(query, PIN_COMMIT) || !Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path')) {
      return badQuery('pin-shape');
    }
    const commit = own(query, PIN_COMMIT);
    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');
    const place = parsePinPlace(query);
    return place.ok ? { ok: true, req: { route, ask: { commit, section: place.section, path: place.path } } } : place;
  }
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, req: { route, pin: pin.pin } } : pin;
}
```
  Find:
```ts
/** The estimate of every tree and index job: ccd's framed listing bound on both sides (section 6.2). Frozen, so
 *  no caller can change every other caller's estimate. */
export const LISTING_JOB: Readonly<DocsJob> =
  Object.freeze({ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES });
```
  Replace: that text, then:
```ts

/** The estimate of every history job: ccd's framed log bound on both sides (rich-docs spec G4). Frozen, as above. */
export const HISTORY_JOB: Readonly<DocsJob> =
  Object.freeze({ raw: DOCS_LOG_MAX_WIRE_BYTES, wire: DOCS_LOG_MAX_WIRE_BYTES });
```
  Find: `const KEY_REFRESH = 'refresh';` — Replace: that line, then `const KEY_LOG = 'log';`. Find:
```ts
export function docsRefreshFlightKey(node: string, project: string, branch: string | null): string {
  return docsKey(KEY_REFRESH, [node, project, branch ?? '']);
}
```
  Replace: that text, then:
```ts

/** A history flight (rich-docs spec G4): the ask's three fields. A log at a fixed commit is the same answer for every
 *  joiner, so no generation is needed. */
export function docsLogFlightKey(node: string, project: string, ask: DocsLogAsk): string {
  return docsKey(KEY_LOG, [node, project, ask.commit, ask.section, ask.path]);
}
```
  Find:
```ts
/** The index field W3 reads: `projects`, an array of plain objects. */
```
  Replace:
```ts
/** Text of at most `max` code points that the docs redactor leaves as it is (refinement (f)): ccd redacted it, and this
 *  proves it without rewriting the answer. */
function redactedText(v: unknown, max: number): boolean {
  return isText(v) && [...v].length <= max && redactDocsText(v) === v;
}

/** One history entry: a full sha, a full sha or `null` parent, a text date, and an author and a subject inside their caps
 *  and already redacted. */
function logEntryOk(e: unknown): boolean {
  if (!isRecord(e)) return false;
  const sha = own(e, 'sha');
  const parent = own(e, 'parent');
  return isText(sha) && isDocsCommit(sha) && (parent === null || (isText(parent) && isDocsCommit(parent)))
    && isText(own(e, 'date')) && redactedText(own(e, 'author'), DOCS_LOG_AUTHOR_MAX_CHARS)
    && redactedText(own(e, 'subject'), DOCS_LOG_SUBJECT_MAX_CHARS);
}

/** The log fields the history route sends: at most `DOCS_LOG_MAX_ENTRIES` entries, each `logEntryOk`, and a boolean
 *  `truncated`. */
function logShapeOk(l: AnswerRecord): boolean {
  const entries = own(l, 'entries');
  return Array.isArray(entries) && entries.length <= DOCS_LOG_MAX_ENTRIES && entries.every(logEntryOk)
    && typeof own(l, 'truncated') === 'boolean';
}

/** The index field W3 reads: `projects`, an array of plain objects. */
```
  Find:
```ts
  if (verb === 'docs-index' && !indexShapeOk(answer)) return schemaFault();
  return { ok: true };
```
  Replace:
```ts
  if (verb === 'docs-index' && !indexShapeOk(answer)) return schemaFault();
  if (verb === 'docs-log' && !logShapeOk(answer)) return schemaFault();
  return { ok: true };
```
  Add "5. `docs-log`: `logShapeOk`." to `docsAnswerShape`'s numbered docstring.
- [ ] **Step 4: The adapter.** Find (`server/src/docs/ccdsource.ts`, the shared import block): `  type DocPin, type DocsFailure, type DocsFailureBody, type DocsFetchOk, type DocsIndexOk, type DocsRefSpec,` — Replace: `  type DocPin, type DocsFailure, type DocsFailureBody, type DocsFetchOk, type DocsIndexOk, type DocsLogAsk, type DocsLogOk, type DocsRefSpec,`. Find (as Task 3 left it): `import { DOCS_SECTION_GATED, LISTING_JOB, type DocsJob } from './policy.js';` — Replace: `import { DOCS_SECTION_GATED, HISTORY_JOB, LISTING_JOB, type DocsJob } from './policy.js';`. Find: `import type { DocsFetchRun, DocsFetcher, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';` — Replace: `import type { DocsFetchRun, DocsFetcher, DocsLogRead, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';`. Find:
```ts
  | { verb: 'docs-show'; project: string; pin: DocPin; ask: DocsShowAsk };
```
  Replace:
```ts
  | { verb: 'docs-show'; project: string; pin: DocPin; ask: DocsShowAsk }
  | { verb: 'docs-log'; project: string; log: DocsLogAsk };
```
  Find:
```ts
    : call.verb === 'docs-tree' ? 'docsTree'
      : call.pin.kind === 'committed' ? 'docsShowCommitted' : 'docsShowDraft');
```
  Replace:
```ts
    : call.verb === 'docs-tree' ? 'docsTree'
      : call.verb === 'docs-log' ? 'docsLog'
        : call.pin.kind === 'committed' ? 'docsShowCommitted' : 'docsShowDraft');
```
  Find (as Task 3 left it): `  const section = call.verb === 'docs-show' ? call.pin.section : null;` — Replace: `  const section = call.verb === 'docs-show' ? call.pin.section : call.verb === 'docs-log' ? call.log.section : null;`. Find:
```ts
            call.pin.fp, call.ask.maxBytes)),
      };
  }
}
```
  Replace:
```ts
            call.pin.fp, call.ask.maxBytes)),
      };
    case 'docs-log':
      return {
        ok: true,
        res: await deps.runCcd(CCD_ARGV.docsLog(call.project, call.log.commit, call.log.section, call.log.path)),
      };
  }
}
```
  Find:
```ts
        const shown = checkShow(answer, pin, ask);
        return shown.ok ? { ok: true, answer, bytes: shown.bytes } : shown;
      }),
```
  Replace:
```ts
        const shown = checkShow(answer, pin, ask);
        return shown.ok ? { ok: true, answer, bytes: shown.bytes } : shown;
      }),
    // Rich-docs spec G4: the answer must echo the ask, as check 8 holds a show to its pin; L1's `docsAnswerShape` checks
    // the entries where the route believes it.
    log: async (src, ask): Promise<DocsLogRead> => settle(
      await readDocs(deps, { verb: 'docs-log', project: src.project, log: ask }), 'docs-log', HISTORY_JOB, (line) => {
        const answer = line as unknown as DocsLogOk;
        return answer.commit === ask.commit && answer.section === ask.section && answer.path === ask.path
          ? { ok: true, answer } : fail('malformed-answer', { why: 'pin' });
      }),
```
  The module's header comment's "THE GATE comes first, inside each of the two functions" stays true (still two).
- [ ] **Step 4b: The census row.** `server/test/consolidationCensus.ts`: after the row whose text is `'return { ok: true, res: await deps.runCcd(CCD_ARGV.docsFetch(project, branch)) };'`, add `{ file: 'server/src/docs/ccdsource.ts', text: 'res: await deps.runCcd(CCD_ARGV.docsLog(call.project, call.log.commit, call.log.section, call.log.path)),', nth: 1, arm: 'carried' },` (the new site carries ccd's answer as the other four do; if the census's arms read otherwise for a read that is checked and never rewritten, take the arm its own doc comment gives a carried read, and say so in Results).
- [ ] **Step 5: Green.** `docs-source-w5b`, `docs-source` (unchanged), `docs-policy`, `consolidation-census`, `verb-gate` (the new `CCD_ARGV.docsLog(` call is in `readDocs`, whose `ccdCan(` names `'docsLog'`, and no `capSupported(` stands in that scope to mask it), `ccd-can-sites`, `single-definition/docs-ring`, `single-definition/docs-l0`, `docs-budget`; `tsc`.
- [ ] **Step 6: Commit.** Message `server: the history read, gated, checked and never rewritten (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T9-M1 | M9.7 | `src/docs/ccdsource.ts` | the echo check always passes | `docs-source-w5b` | 1 failed — (4) |
| W5B-T9-M2 | (f) | `src/docs/policy.ts` | `redactedText` drops the redactor comparison | `docs-policy` | 1 failed — (8), the unredacted case |
| W5B-T9-M3 | M9.7 | `src/docs/policy.ts` | the entries cap dropped | `docs-policy` | 1 failed — (8), the 101 case |
| W5B-T9-M4 | M9.3 | `src/docs/ccdsource.ts` | the log arm of the section gate reads `null` | `docs-source-w5b` | 1 failed — (3) |
| W5B-T9-M5 | (f) | `src/docs/policy.ts` | the history commit check dropped | `docs-policy` | 1 failed — (7), the short commit |

```json
{"id": "W5B-T9-M1", "spec": "M9.7", "pkg": "server", "file": "src/docs/ccdsource.ts", "old": "        return answer.commit === ask.commit && answer.section === ask.section && answer.path === ask.path", "new": "        return true", "tests": ["test/docs-source-w5b.test.ts"], "red": "1 failed: an answer for another path, section or commit is malformed-answer {why:pin}"}
{"id": "W5B-T9-M2", "spec": "(f)", "pkg": "server", "file": "src/docs/policy.ts", "old": "  return isText(v) && [...v].length <= max && redactDocsText(v) === v;", "new": "  return isText(v) && [...v].length <= max;", "tests": ["test/docs-policy.test.ts"], "red": "1 failed: docsAnswerShape docs-log refuses an unredacted subject"}
{"id": "W5B-T9-M3", "spec": "M9.7", "pkg": "server", "file": "src/docs/policy.ts", "old": "  return Array.isArray(entries) && entries.length <= DOCS_LOG_MAX_ENTRIES && entries.every(logEntryOk)", "new": "  return Array.isArray(entries) && entries.every(logEntryOk)", "tests": ["test/docs-policy.test.ts"], "red": "1 failed: docsAnswerShape docs-log refuses 101 entries"}
{"id": "W5B-T9-M4", "spec": "M9.3", "pkg": "server", "file": "src/docs/ccdsource.ts", "old": ": call.verb === 'docs-log' ? call.log.section : null;", "new": ": null;", "tests": ["test/docs-source-w5b.test.ts"], "red": "1 failed: a log of a vision doc without docs-sections-v2 is unsupported, with zero execs"}
{"id": "W5B-T9-M5", "spec": "(f)", "pkg": "server", "file": "src/docs/policy.ts", "old": "    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');\n    const place = parsePinPlace(query);\n    return place.ok ? { ok: true, req: { route, ask:", "new": "    if (!isText(commit)) return refused('bad-commit');\n    const place = parsePinPlace(query);\n    return place.ok ? { ok: true, req: { route, ask:", "tests": ["test/docs-policy.test.ts"], "red": "1 failed: parseDocsApiQuery history, a short commit is bad-commit"}
```

### Task 10: The history route and the censuses (M9.8)

**Files:** Modify `server/src/docs/routes.ts`, `server/test/docs-routes.test.ts`, `server/test/docs-headers.test.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`, `server/test/secret-mask.test.ts`.

- [ ] **Step 1: Red first.** `docs-routes.test.ts` (the real `buildServer`, `guardRunner`): `DOCS_KEYS` gains `'GET /api/docs/:project/history'`; `readyFleet()` gains `DOCS_LOG_CAP` and `DOCS_SECTIONS_CAP`; cases: (1) `'history answers 200 {ok, log} and execs one docs-log through the agent whitelist'`; (2) `'a refused query is 400 with zero execs'`; (3) `'two joiners share one flight'`; (4) `'a log answer that fails its shape is 502 malformed-answer'`; (5) `'over a fleet without docs-log-v1 it is 501 unsupported with zero execs'`; (6) `'the answer is no-store'`. `docs-headers.test.ts`: `M54_DOCS_KEYS` and `RECIPES` gain the route (ok: `docsApi.history('demo', {commit: FIXTURE_COMMIT, section: 'specs', path: 'a.md'})`; refused: the same with `&commit=x` appended). Its `m54Server` needs two more edits, or the history recipe answers 501 `unsupported` where the cases expect 200, and 501 where the 5xx case expects 502: the fixture fleet's `ccdVerbs: ['caps', DOCS_CAP]` gains `DOCS_LOG_CAP`, and so does the 5xx case's `state.ccdVerbs = req.method === 'POST' ? null : ['caps', DOCS_CAP]`; and its runner gains a `docs-log` arm (`if (args[0] === 'docs-log') return m54Exit(0, line({...}))`) that answers a `DocsLogOk` echoing the recipe's ask (`commit: FIXTURE_COMMIT`, `section: 'specs'`, `path: 'a.md'`) with one `logEntryOk`-valid entry (`sha: FIXTURE_COMMIT`, `parent: null`, a strict ISO date, author `demo`, subject `add a`) and `truncated: false`. `auth-gate.test.ts`: `scanRoutes('docs/routes.ts').length` `toBe(5)`; `ROUTES.length` `toBe(184)`; the COMPLETE list gains `'GET /api/docs/:project/history'`; re-measure its prose counts. `box-token-census.test.ts`: `DOCS_DOORS` gains `'/api/docs/:project/history'`. `secret-mask.test.ts`: `'/api/docs/:project/history': 'repository content (commit subjects and author names), not session text'`. Red.
- [ ] **Step 2: The route.** Find (`server/src/docs/routes.ts`): `  DocPin, DocsFailureBody, DocsProjectsResponse, DocsRefreshFetch, DocsRefSpec, DocsTreeOk, DocsTreeResponse,` — Replace: `  DocPin, DocsFailureBody, DocsHistoryResponse, DocsProjectsResponse, DocsRefreshFetch, DocsRefSpec, DocsTreeOk, DocsTreeResponse,`. In the `./policy.js` import add `HISTORY_JOB` and `docsLogFlightKey`; in the `./ports.js` import add `DocsLogRead`. Find: `type FileRequest = Extract<DocsApiRequest, { route: 'file' }>;` — Replace: that line, then `type HistoryRequest = Extract<DocsApiRequest, { route: 'history' }>;`. Find:
```ts
/**
 * One tree read (section 6.4): join the tree flight of (node, project, ref, the project's CURRENT generation), whose
```
  Replace:
```ts
/** An ok log the adapter passed, believed only after `docsAnswerShape` (rich-docs spec G4; refinement (f)). A failure is
 *  handed back as it came. Nothing is cached: a log is cheap, and its route answers `no-store` like every JSON. */
function believeLog(got: DocsLogRead): DocsLogRead {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-log', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs log answer failed its shape check');
    return shape;
  }
  return got;
}

/**
 * One tree read (section 6.4): join the tree flight of (node, project, ref, the project's CURRENT generation), whose
```
  Find: `  app.get('/api/docs/:project/file', { exposeHeadRoute: false }, async (req, reply) => {` — Replace:
```ts
  app.get('/api/docs/:project/history', { exposeHeadRoute: false }, async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const q = parseDocsApiQuery('history', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const { ask } = q.req as HistoryRequest;
    const src: DocsSourceId = { node, project: p.project };
    const run = await at.flights.join(docsLogFlightKey(node, src.project, ask), clientGone(reply),
      (flight) => at.read.run(HISTORY_JOB, flight, async () => believeLog(await reader.log(src, ask))));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendDocsFailure(reply, run.value);
    const body: DocsHistoryResponse = { ok: true, log: run.value.answer };
    return reply.send(body);
  });

  app.get('/api/docs/:project/file', { exposeHeadRoute: false }, async (req, reply) => {
```
  `registerDocsReadRoutes`' docstring: "The three docs reads" becomes "The four docs reads"; the module header's "registers the three reads" likewise.
- [ ] **Step 3: Green.** `docs-routes`, `docs-headers`, `docs-lanes`, `docs-cache`, `docs-file-bytes`, `docs-console-latency`, `auth-gate`, `box-token-census`, `secret-mask`, `coord-routes-single-file`, `coord-pause-route`; `tsc`.
- [ ] **Step 4: Commit.** Message `server: GET /api/docs/:project/history, session-gated, on the read lane (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T10-M1 | M9.8 | `src/docs/routes.ts` | the path reads `/log` | `box-token-census`, `auth-gate`, `docs-headers`, `docs-routes` | 4+ failed |
| W5B-T10-M2 | (f) | `src/docs/routes.ts` | `believeLog` skipped | `docs-routes` | 1 failed — (4) |

```json
{"id": "W5B-T10-M1", "spec": "M9.8", "pkg": "server", "file": "src/docs/routes.ts", "old": "  app.get('/api/docs/:project/history', { exposeHeadRoute: false }", "new": "  app.get('/api/docs/:project/log', { exposeHeadRoute: false }", "tests": ["test/box-token-census.test.ts", "test/auth-gate.test.ts", "test/docs-headers.test.ts", "test/docs-routes.test.ts"], "red": "4+ failed: DOCS_DOORS both ways; the COMPLETE list; M5.4's derived set; history answers 200"}
{"id": "W5B-T10-M2", "spec": "(f)", "pkg": "server", "file": "src/docs/routes.ts", "old": "async () => believeLog(await reader.log(src, ask))", "new": "async () => await reader.log(src, ask)", "tests": ["test/docs-routes.test.ts"], "red": "1 failed: a log answer that fails its shape is 502 malformed-answer"}
```

### Task 11: The doctor names a ccd that predates W5b (refinement (c))

**Files:** Modify `ccd/ccrc-doctor-checks`, `server/test/docsIndexFixtures.ts`, `server/test/ccrc-doctor-exposure.test.ts`, `server/test/docs-parity.test.ts`.

- [ ] **Step 1: Red first.** `docsIndexFixtures.ts`: `docsIndexStubScript(line, caps = ['docs-log-v1', 'docs-sections-v2'])` answers `caps` with those lines and anything else with `line` (builtins only: `case "$1" in caps) printf '%s\n' …;; *) printf '%s\n' '<line>';; esac`). `ccrc-doctor-exposure.test.ts`, beside the docs cases: (1) `'a ccd that lists both tokens PASSes'`; (2) `'a ccd without docs-log-v1 WARNs naming it, remedy ccrc update'`; (3) `'a ccd whose caps read fails WARNs naming both'`; (4) `'an unreadable row still WARNs first, with its own remedy'`; `HEALTHY_SKIPS` unchanged. `docs-parity.test.ts`: `CCRC_DOCTOR_DOCS_CAPS` is one literal in `ccd/ccrc-doctor-checks` and equals `[DOCS_LOG_CAP, DOCS_SECTIONS_CAP].join(' ')`. Red.
- [ ] **Step 2: The literal.** Find (`ccd/ccrc-doctor-checks`): `: "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"` — Replace:
```bash
: "${CCRC_DOCTOR_DOCS_TIMEOUT:=20}"
# The two `ccd caps` words the Docs screen's W5b features need (rich-docs spec A12): per-doc history and the vision and
# promise sections. One literal, held equal to server/src/ccdargv.ts's DOCS_LOG_CAP and DOCS_SECTIONS_CAP by
# server/test/docs-parity.test.ts.
CCRC_DOCTOR_DOCS_CAPS='docs-log-v1 docs-sections-v2'
```
- [ ] **Step 3: The WARN.** Find:
```bash
      if [ "$d" -gt 0 ]; then
        _dr_warn docs "$line" \
          "the index walk stopped at its time budget; re-run when the box is quieter: ccrc doctor"
        return 2
      fi
      _dr_pass docs "$line"
```
  Replace:
```bash
      if [ "$d" -gt 0 ]; then
        _dr_warn docs "$line" \
          "the index walk stopped at its time budget; re-run when the box is quieter: ccrc doctor"
        return 2
      fi
      # Rich-docs spec A12 (W5b): the tokens are read from `ccd caps`, as the server reads them; words only, never a
      # project name. A caps read that fails names both, since neither was measured.
      local caps="" tok missing=""
      caps="$(_plat_timeout "$CCRC_DOCTOR_DOCS_TIMEOUT" "$ccd" caps </dev/null 2>/dev/null)" || caps=""
      for tok in $CCRC_DOCTOR_DOCS_CAPS; do
        case $'\n'"$caps"$'\n' in *$'\n'"$tok"$'\n'*) ;; *) missing="$missing $tok" ;; esac
      done
      if [ -n "$missing" ]; then
        _dr_warn docs "$line; this ccd does not list$missing, so Docs here has no per-doc history or no vision and promise sections" \
          "ccrc update"
        return 2
      fi
      _dr_pass docs "$line"
```
- [ ] **Step 4: Green.** `ccrc-doctor-exposure`, `ccrc-doctor-core`, `ccrc-doctor*` (the doctor suite files), `docs-parity`, `docs-budget` (its doctor-default reader still finds one default), `ccd-docs-index`, `install-census`; the install and update fixtures that plant the stub (`ccrc-installFixture.ts`, `ccrc-updateFixture.ts` callers) unchanged in outcome.
- [ ] **Step 5: Commit.** Message `doctor: name a ccd without docs-log-v1 or docs-sections-v2 (docs W5b-1)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T11-M1 | (c) | `../ccd/ccrc-doctor-checks` | the WARN's condition reads false | `ccrc-doctor-exposure` | 2 failed — (2), (3) |
| W5B-T11-M2 | (c) | `../ccd/ccrc-doctor-checks` | the literal loses `docs-sections-v2` | `docs-parity` | 1 failed |

```json
{"id": "W5B-T11-M1", "spec": "(c)", "pkg": "server", "file": "../ccd/ccrc-doctor-checks", "old": "      if [ -n \"$missing\" ]; then", "new": "      if false; then", "tests": ["test/ccrc-doctor-exposure.test.ts"], "red": "2 failed: a ccd without docs-log-v1 WARNs; a ccd whose caps read fails WARNs naming both"}
{"id": "W5B-T11-M2", "spec": "(c)", "pkg": "server", "file": "../ccd/ccrc-doctor-checks", "old": "CCRC_DOCTOR_DOCS_CAPS='docs-log-v1 docs-sections-v2'", "new": "CCRC_DOCTOR_DOCS_CAPS='docs-log-v1'", "tests": ["test/docs-parity.test.ts"], "red": "1 failed: CCRC_DOCTOR_DOCS_CAPS equals DOCS_LOG_CAP and DOCS_SECTIONS_CAP"}
```

### Task 12: The growth waiver and the spec text (refinements (a)-(e))

**Files:** Create `server/test/growth-waivers/<the number issued for (a)>-ccd-ccd.json`; Modify the rich-docs spec and the base spec (§2 (a) only).

- [ ] **Step 1: Measure.** `git fetch -q origin main`, then `( cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts )`: record `ccd/ccd`'s net delta (predicted about 140, from 130 to 150: `measureBash` counts the helper's heredoc comments and docstrings as code) and every other listed file's (each under 40; `pwa/src/lib/api.ts` and `server/src/server.ts` unchanged in this run).
- [ ] **Step 2: The waiver,** in the form of the newest entries there: `{"file": "ccd/ccd", "maxDelta": <measured>, "d": "<the issued number for (a), with its prefix>", "reason": "native Docs reader W5b: docs-log, one doc's history (rich-docs spec G4): the bash front, the helper's log section (parse_log, log_entries, guard_log, verb_log), the runner's fixed log row and its shape check, the four log caps' parity literals and two caps lines; measured +<n> net code lines against the merge-base; kept in ccd/ccd because the Docs helper is embedded for _pr_py's reason (a sibling file would be a second deployment step)", "added": "<the commit's date>"}`. Re-run the growth check: green.
- [ ] **Step 3: The spec text** (the rich-docs spec, and the base spec's §2 (a); each edit ends `(amended <date>; W5b-1)`):
  - §6, G4's row. Find: `subjects of at most 200 characters (redacted), and a wire cap of about 128 KiB. | W5b |` — Replace: `subjects of at most 200 characters (redacted), and a wire cap of about 128 KiB. The cap is `DOCS_LOG_MAX_WIRE_BYTES` (131 072 framed bytes), and an answer over it is `too-many-entries {count, bytes}`, the listings' word. A full answer of three-byte characters fits under it; the same answer in four-byte characters (100 entries, every subject and author at its cap) does not, and answers `too-many-entries {count, bytes}` instead of a list. The date is the committer's, in strict ISO 8601; the author is the name, at most 100 characters, redacted before it is cut, as a subject is. A shallow repository's walk that ends short is `truncated` too. The server re-runs the redactor over each author and subject as a check, and refuses an answer it would change; it rewrites nothing (amended <date>; W5b-1). | W5b |`
  - §6, G1's row. Find: ``under `DOCS_MAX_ENTRIES` (5000) and the 1 MiB listing cap. | W5b |`` — Replace: ``under `DOCS_MAX_ENTRIES` (5000) and the 1 MiB listing cap. The labels are `vision` and `promise`, both listed alphabetically. An index row or a tree from a four-section fleet shows four, and a page under a section that fleet does not serve says so (amended <date>; W5b-1). | W5b |``
  - §7, A12. Find: `a fifth route; the census and doctor token |` — Replace: `a fifth route; the census and doctor token (the doctor's `docs` check WARNs when `ccd caps` lacks `docs-log-v1` or `docs-sections-v2`; amended <date>; W5b-1) |`
  - §7, A23. Find: `| W5b is rolled `--server-first`. Every other wave stays fleet first. |` — Replace: `| W5b is rolled `--server-first`: the first rollout that carries W5b-1's commit is `--server-first`, whichever wave's tag it is. Every other rollout stays fleet first (amended <date>; W5b-1). |`
  - The base spec's §2 (a), so ccd's comment above `READ_ALLOW`, "The subcommand allowlist of section 2 (a), verbatim", stays true (rich-docs A12 names this list among its amendments):
    - The allowlist. Find: `` - `config --get` and `config -z --get-regexp`. `` (the read-verb list's last item) — Replace: `` - `config --get` and `config -z --get-regexp`; `` then a new item: `` - `log`, for `docs-log` only and only as one fixed row: `-c log.showSignature=false -c log.follow=false -c log.mailmap=false -c log.showRoot=true log --no-show-signature --encoding=UTF-8 --no-merges --format=%H%x00%P%x00%cI%x00%an%x00%s -z --name-only --end-of-options <commit> -- <section path>` (rich-docs spec A12, G4; amended <date>; W5b-1). ``
    - The "Never used" list. Find: `` - **Never used:** `show`, `log`, `diff`, `archive`, `checkout-index`, `--textconv`, `--filters`, `<commit>:<path>`, `remote set-head`, `check-attr`. `` — Replace: `` - **Never used:** `show`, `diff`, `archive`, `checkout-index`, `--textconv`, `--filters`, `<commit>:<path>`, `remote set-head`, `check-attr`. `log` left this list for `docs-log`'s one row above (amended <date>; W5b-1). ``
  - §8, the W5b row. Find: ``and `api.docs.history`. `ccd/ccd` is restamped. The rollout is `--server-first` (A23), and the agent restarts for the grant.`` — Replace: ``and `api.docs.history`. `ccd/ccd` needs no restamp: it is stamped when it is installed (README). W5b runs as two runs: W5b-1, ccd, the agent, the server and the PWA's six sections; W5b-2, the PWA's version view and the history loader (amended <date>; W5b-1). The rollout is `--server-first` (A23), and the agent restarts for the grant.``
- [ ] **Step 4: Green.** `topology-clean`, `deviation-refs`, `dtbd`, `growth-check` with `GROWTH_CHECK=1`, and `docs-parity` (its M7.9 scan reads shipped source, not specs; it stays green).
- [ ] **Step 5: Commit.** Message `docs: the docs-log growth waiver and the rich-docs spec's W5b-1 text (docs W5b-1)`.

Rows: none (the waiver is pinned by `growth-check.test.ts` itself; the spec text by review).

### Task 13: Close W5b-1 — review, suites, the mutation table, Results, push and the one PR

**Model routing:** the main loop `opus`/`high`; review lenses as below; `sonnet`/`high` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Three `opus`/`high` lenses over `BASE..HEAD` against this plan: (1) ccd's verb and helper (Task 6, refinement (e)); (2) skew and gates (Tasks 2-4, 7, 8, 11; a four-section fleet end to end); (3) the server half (Tasks 9-10, refinement (f)). Assign tests/rows/censuses/waiver/spec/privacy across those three `opus`/`high` lenses. Critical/important findings get three independent `sonnet`/`high` refuters and majority adjudication, minors one advisory refuter; record actual identities, a dead/mismatched lens is unverified. This internal pass does not replace the independent review run; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit: the whole `agent` suite and `tsc`; the ccd suites one at a time (`ccd-docs-*`, `ccd-archive`, `ccd-verb-sets`, `wsaudit`, `ownership`, `session-hook`, `ccrc-doctor*`, `install-census`); `git fetch -q origin main`, then the whole `server` suite in pieces (`docs-*`, `auth-gate`, `box-token-census`, `secret-mask`, `verb-gate`, `capsupported`, `citations`, `topology-clean`, `single-definition/*`, `rings/*`, `typecheck-tests` alone, `GROWTH_CHECK=1 growth-check`); the whole `pwa` suite in pieces and `tsc`; the browser files locally (`docs-headers`, `docs-compact-head`, `docs-export`, `reader-frame`), with their counts. A red census in a file outside Scope is a stop-and-ask. Re-run a known load flake alone first.
- [ ] **Step 3: The whole mutation table** of Tasks 2-11 at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 4: Reconcile the deviations.** Copy the coordinator's already-issued-and-defined run-open W5b-1 entries into `## Deviations found`: (a), then (b), then any found while executing (entry form: `- **<number> (<date>)** — <slug>. <what departs from which sentence, and why>. <Task and rows that apply it>.`, the number with its prefix); write the unused ones without their prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green.
- [ ] **Step 5: Draft `## Results (W5b-1)`** in this plan: the counts per suite; every task's JSON row fence as measured; the BASE and end figures (ROUTES.length, `ccd/ccd`'s delta, caps lines); "Named, without a number"; "Carried, not fixed" (the `four sections` prose left for W7). Draft the PR body into `.superpowers/sdd/2026-11-05-native-docs-reader-w5b-parity/w5b-1-pr-body.md`: title `Docs: six sections and per-doc history on the server half (W5b-1)`; what ships, by box; the rollout (`--server-first` on the first rollout that carries this commit, whichever tag that is; the agent restart; the `not-granted` window); the departures by letter with their numbers; the review's findings and fixes; the test plan.
- [ ] **Step 6: Public-repo scan** of every file changed since BASE as it stands, the uncommitted plan and the drafted PR body: rc 0, zero hits. Remove `$HOME/.cc-tmp/w5b-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: W5b-1's results (docs W5b-1)`, with the `Ledger-Edit:` trailer, then the `Co-Authored-By:` trailer. This commit is the `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file`).
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), wait for the PR's CI run on that exact tip (read `CodeQL` itself, not only its Analyze jobs), list mail, then send the wave-done.

## W5b-2: the PWA's version view (G6) and the history loader

**Scope (W5b-2):**
- In: `shared/docs.ts`'s page layer (`at`); `pwa/src/docs/{docsLinks.ts,DocLink.tsx,DocImage.tsx,DocsLeaf.tsx,useDocsVisit.ts,DocsHead.tsx,DocsBanners.tsx,docsText.ts,share.ts,failures.ts}`; `pwa/src/docs/export/exportMarkdown.tsx` (`exportLinkTarget` only, refinement (t)); `pwa/src/lib/api.ts`; `pwa/src/screens/highlightMeasureRun.tsx` (one field); the tests named; the rich-docs and base specs' text for (m) to (t).
- Out: the version menu, the `version` op, `only` and anything in `history.state`, the seed's history, "changes since" (W8b); a history list in ccrc's chrome (Later); every server, agent and ccd file; README.
- Byte-identical: `server/**` but `server/test/docs-url.test.ts` and any server test whose `DocsPageLocation` literal `tsc` names; `agent/**`, `ccd/**`, `pwa/src/screens/DocsScreen.tsx`, `pwa/src/docs/{ReaderFrame.tsx,reader/**,docs.css,DocsTreeView.tsx,DocsIndexView.tsx,docsTree.ts,ShareSheet.tsx,ExportSheet.tsx}`, `pwa/src/docs/export/**` but `exportMarkdown.tsx`, `pwa/test/docs-export.test.tsx`, `pwa/src/readerLab/**`, `ui/**`, `.github/**`. Any other file is a stop-and-ask.

### File Structure (W5b-2)

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `shared/docs.ts` | 15 | L0 | `DOCS_PAGE_KEYS` with `at`; `DocsPathLocation.at`; `bad-at`; `pageKeepsAt`; parse and write |
| `pwa/src/docs/docsLinks.ts`, `DocLink.tsx`, `DocImage.tsx`, `DocsLeaf.tsx`, `pwa/src/screens/highlightMeasureRun.tsx` | 16 | pure, L4 | the `version` target; `at` through `path` targets; `pageAt`; images at the version |
| `pwa/src/docs/useDocsVisit.ts`, `DocsLeaf.tsx`, `docsText.ts` | 17 | L4 hook, words | the version pin, its file key, no re-list, no listing size; the body key; the version's `unknown-commit` sentence |
| `pwa/src/docs/DocsHead.tsx`, `DocsBanners.tsx`, `docsText.ts` | 18 | L4, words | the truth line and its badge, the row badge, the banner, no draft banners on a version, Open committed version |
| `pwa/src/docs/share.ts`, `docsText.ts`, `export/exportMarkdown.tsx` | 19 | pure, words | `version-unmeasured`; Export's body links on a version |
| `pwa/src/lib/api.ts`, `pwa/src/docs/failures.ts` | 20 | — | `api.docs.history`, `DocsHistoryLoader` |
| `pwa/test/docs-version.test.tsx` (new), `server/test/docs-url.test.ts`, `pwa/test/docs-links.test.tsx`, `docs-images.test.tsx`, `docs-share.test.ts`, `docs-api.test.ts` | 15-20 | — | the cases |

### Task 14: Base, claims, find-check (W5b-2)

- [ ] **Step 0: Base.** `git fetch -q origin main`; the workspace is at `origin/main`, which holds W5b-1's merge and the take-up's; expected `T14-BASE-OK`.
- [ ] **Step 1: Find-check** of Tasks 15-21's blocks: `FINDS-OK`, or stop and ask. Grep that the take-up's `OneBar` calls `rowBadge(` and renders `<TruthLine` (both once inside it).
- [ ] **Step 2: Claims;** the operator's answers to Q1 and Q2 are in the brief (each changes one task's code, as (m) and (o) say).

### Task 15: The page key `at` (refinements (m), (q); M9.11, the grammar half)

**Files:** Modify `shared/docs.ts`, `pwa/src/docs/docsText.ts`, `server/test/docs-url.test.ts`, and every `DocsPageLocation` path literal `tsc` names in `pwa/test` and `server/test` (each gains `at: null`).

- [ ] **Step 1: Red first.** `docs-url.test.ts`, describe `'the version key at= (rich-docs spec G6, M9.11)'`: (1) `'a leaf with a 40- or 64-hex at round-trips'`, with and without `ref` (`?ref=ws/a&at=<sha>`); (2) `'a short, uppercase or 39-hex at is bad-at'`; (3) `'at on the index, a project or a section is unknown-param'`; (4) `'at on a directory (trailing slash) is canonicalised away'`; (5) `'view=committed beside at is canonicalised away'`; (6) `'a repeated at is repeated-param'`; (7) `'commit=, servedRef=, branch=, head= and fp= still give commit-in-page, beside at too'` (M3.2); (8) `'keys are written ref, at, view, frame'`. Red.
- [ ] **Step 2: L0.** Find (`shared/docs.ts`):
```ts
/** The page query keys, in the order docsPageUrl writes them. */
export const DOCS_PAGE_KEYS = ['ref', 'view', 'frame'] as const;
/** Pin keys. On a page they are refused as commit-in-page, never canonicalised: a page URL never carries a
 *  commit, and a durable pointer to one exact commit is a GitHub URL (spec 3.1, 3.11). */
```
  Replace:
```ts
/** The page query keys, in the order docsPageUrl writes them. `at` is the version view's (rich-docs spec G6, R-d): a
 *  leaf's full commit, kept beside `ref`. */
export const DOCS_PAGE_KEYS = ['ref', 'at', 'view', 'frame'] as const;
/** Pin keys. On a page they are refused as commit-in-page, never canonicalised: a page names a commit only as `at`
 *  (rich-docs spec A14), and a durable pointer to one exact commit is a GitHub URL (spec 3.1, 3.11). */
```
  Find:
```ts
  | { kind: 'path'; project: string; section: DocSectionSlug; path: string; dirSlash: boolean;
      ref: DocsRefSpec | null; view: 'effective' | 'committed'; frame: 'inline' | 'full' };
export type DocsPageParseFailure = 'not-docs' | 'bad-project' | 'bad-section' | 'bad-path' | 'bad-ref'
```
  Replace:
```ts
  | { kind: 'path'; project: string; section: DocSectionSlug; path: string; dirSlash: boolean;
      ref: DocsRefSpec | null;
      /** The version view's commit (rich-docs spec G6); `null` has one meaning, the latest at `ref`. */
      at: string | null;
      view: 'effective' | 'committed'; frame: 'inline' | 'full' };
export type DocsPageParseFailure = 'not-docs' | 'bad-project' | 'bad-section' | 'bad-path' | 'bad-ref' | 'bad-at'
```
  Find:
```ts
function pageKeepsView(l: DocsPathLocation): boolean {
  return l.view === 'committed' && l.ref !== null && !l.dirSlash;
}
```
  Replace:
```ts
function pageKeepsView(l: DocsPathLocation): boolean {
  return l.view === 'committed' && l.ref !== null && !l.dirSlash && l.at === null;
}

/** `at` survives only on a leaf (rich-docs spec G6): a directory is no version. A version is committed bytes, so
 *  `view=committed` beside it is redundant (`pageKeepsView`). */
function pageKeepsAt(l: DocsPathLocation): boolean {
  return l.at !== null && !l.dirSlash;
}
```
  Find:
```ts
  let ref: DocsRefSpec | null = null;
  let view: DocsPathLocation['view'] = 'effective';
```
  Replace:
```ts
  let ref: DocsRefSpec | null = null;
  let at: string | null = null;
  let view: DocsPathLocation['view'] = 'effective';
```
  Find:
```ts
      if (ref === null) return { ok: false, why: 'bad-ref' };
    } else if (key === 'view') {
```
  Replace:
```ts
      if (ref === null) return { ok: false, why: 'bad-ref' };
    } else if (key === 'at') {
      if (!isDocsCommit(value)) return { ok: false, why: 'bad-at' };
      at = value;
    } else if (key === 'view') {
```
  Find:
```ts
    const asked: DocsPathLocation = { kind: 'path', project, section, path, dirSlash, ref, view, frame };
    loc = {
      ...asked,
```
  Replace:
```ts
    const asked: DocsPathLocation = { kind: 'path', project, section, path, dirSlash, ref, at, view, frame };
    loc = {
      ...asked,
      at: pageKeepsAt(asked) ? at : null,
```
  Find:
```ts
    ref: loc.ref === null ? null : docsRefText(loc.ref),
    view: loc.kind === 'path' && pageKeepsView(loc) ? 'committed' : null,
```
  Replace:
```ts
    ref: loc.ref === null ? null : docsRefText(loc.ref),
    at: loc.kind === 'path' && pageKeepsAt(loc) ? loc.at : null,
    view: loc.kind === 'path' && pageKeepsView(loc) ? 'committed' : null,
```
  `docsPageUrl`'s docstring: "`ref` is written verbatim" gains "and so is `at`, 40 or 64 lower-case hex".
- [ ] **Step 3: The words** (the `Record` over the failure union needs them). Find (`pwa/src/docs/docsText.ts`): `  'bad-frame': "This address's frame is not one Docs knows; only frame=full is.",` — Replace: that line, then `  'bad-at': "This address's at= is not a full 40- or 64-character lower-case commit id.",`. Find: `    'A Docs page address never names a commit; open the page without it, or use a GitHub link for one exact commit.',` — Replace: `    'A Docs page address names a commit only as at=; open the page without the other key, or use a GitHub link for one exact commit.',`
- [ ] **Step 4: The literals.** `tsc` in `pwa` and `server` (with `typecheck-tests`) names every `DocsPageLocation` path literal; each gains `at: null`, nothing else. `docsLocation` is Task 16's; until then its `path` arm compiles with one line. Find (`pwa/src/docs/docsLinks.ts`):
```ts
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        view: to.view ?? 'effective', frame: 'inline',
```
  Replace:
```ts
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        at: null,
        view: to.view ?? 'effective', frame: 'inline',
```
- [ ] **Step 5: Green.** `docs-url`, `docs-shared`, `docs-grammar`, `single-definition/docs-l0` (no grammar body spelled: `isDocsCommit` only), `docs-screen`, `docs-failures`, `docs-links`; `tsc` in both.
- [ ] **Step 6: Commit.** Message `docs: the page key at=, a leaf's version (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T15-M1 | M9.11 | `../shared/docs.ts` | the `at` grammar check dropped | `docs-url` | 1 failed — (2) |
| W5B-T15-M2 | M9.11 | `../shared/docs.ts` | the pin-key refusal dropped | `docs-url` | 2+ failed — (7), M3.2 |
| W5B-T15-M3 | (q) | `../shared/docs.ts` | `pageKeepsAt` keeps a directory's `at` | `docs-url` | 1 failed — (4) |
| W5B-T15-M4 | (q) | `../shared/docs.ts` | `pageKeepsView` keeps `view` beside `at` | `docs-url` | 1 failed — (5) |

```json
{"id": "W5B-T15-M1", "spec": "M9.11", "pkg": "server", "file": "../shared/docs.ts", "old": "      if (!isDocsCommit(value)) return { ok: false, why: 'bad-at' };\n", "new": "", "tests": ["test/docs-url.test.ts"], "red": "1 failed: a short, uppercase or 39-hex at is bad-at"}
{"id": "W5B-T15-M2", "spec": "M9.11", "pkg": "server", "file": "../shared/docs.ts", "old": "  if (pairs.some(([k]) => pinKeys.includes(k))) return { ok: false, why: 'commit-in-page' };", "new": "", "tests": ["test/docs-url.test.ts"], "red": "2+ failed: commit= … still give commit-in-page, beside at too; M3.2's cases"}
{"id": "W5B-T15-M3", "spec": "(q)", "pkg": "server", "file": "../shared/docs.ts", "old": "  return l.at !== null && !l.dirSlash;", "new": "  return l.at !== null;", "tests": ["test/docs-url.test.ts"], "red": "1 failed: at on a directory (trailing slash) is canonicalised away"}
{"id": "W5B-T15-M4", "spec": "(q)", "pkg": "server", "file": "../shared/docs.ts", "old": "  return l.view === 'committed' && l.ref !== null && !l.dirSlash && l.at === null;", "new": "  return l.view === 'committed' && l.ref !== null && !l.dirSlash;", "tests": ["test/docs-url.test.ts"], "red": "1 failed: view=committed beside at is canonicalised away"}
```

### Task 16: Links and images keep the version (refinements (n), (o))

**Files:** Modify `pwa/src/docs/docsLinks.ts`, `pwa/src/docs/DocLink.tsx`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/DocsLeaf.tsx` (the link memo), `pwa/src/screens/highlightMeasureRun.tsx`, `pwa/test/docs-links.test.tsx`, `pwa/test/docs-images.test.tsx`, and every `DocLinkContextValue` fake `tsc` names (each gains `pageAt: null`).

- [ ] **Step 1: Red first.** `docs-links.test.tsx`: (1) `'a path target from a version page keeps its at'`; (2) `'a directory target drops at'`; (3) `'a path target that names at: null goes to the latest'`; (4) `'the version target sets and clears at, keeping ref and frame'`; (5) `'a version target from a section page throws'`; (6) `'a doc link inside a version page keeps the version'` (`docLinkTarget` with `pageAt`); (7) `'the crumbs above a version leaf drop at, its own crumb keeps it'` (`docsCrumbs`). `docs-images.test.tsx`: (8) `'an image on a version page is pinned at the version'`; (9) `'it is never marked uncommittedNotShown'`; (10) `'on a version page an image whose listed size is over its class cap still requests, and ccd's class cap answers'` (the listing's size is the tip's); (11) `'on a version page an image the served listing does not hold is absent, with no request'` (refinement (n)'s presence rule, pinned as it stands). Red ((8), (9), (10)).
- [ ] **Step 2: The builder.** Find (`pwa/src/docs/docsLinks.ts`):
```ts
  | { kind: 'path'; section: DocSectionSlug; path: string; dirSlash: boolean; view?: 'effective' | 'committed' };
```
  Replace:
```ts
  | { kind: 'path'; section: DocSectionSlug; path: string; dirSlash: boolean; view?: 'effective' | 'committed';
      /** Absent: the page's own version (a leaf page's `at`, else the latest); `null`: the latest; a sha: that version. */
      at?: string | null }
  /** This leaf at the version `at`, or at the latest for `null` (rich-docs spec G6): Back to the latest, and W8b's
   *  `version` op. Keeps the page's project, ref and frame; `view` is `effective` (a version is committed bytes). */
  | { kind: 'version'; at: string | null };
```
  Find:
```ts
  if (to.kind === 'same-page') return { ...page, project: to.project, ref: to.ref };
```
  Replace:
```ts
  if (to.kind === 'same-page') return { ...page, project: to.project, ref: to.ref };
  if (to.kind === 'version') {
    if (page.kind !== 'path') throw new Error(`docsLocation: a version target needs a leaf page, not a ${page.kind}`);
    return { ...page, at: page.dirSlash ? null : to.at, view: 'effective' };
  }
```
  Find (the `path` arm, as Task 15 left it):
```ts
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        at: null,
```
  Replace:
```ts
        kind: 'path', project, section: to.section, path: to.path, dirSlash: to.dirSlash, ref,
        // Refinement (o): a leaf's version follows its links, as a GitHub blob URL's commit does; a directory has none.
        at: to.dirSlash ? null : to.at !== undefined ? to.at : page.kind === 'path' ? page.at : null,
```
  `docsLocation`'s docstring gains: "A `path` target inherits a leaf page's `at` unless it names one; `version` sets or clears it."
- [ ] **Step 3: The link and image context.** Find (`pwa/src/docs/DocLink.tsx`): `  readonly pageRef: DocsRefSpec | null;` — Replace: that line, then:
```ts
  /** The page's version (`at=`, rich-docs spec G6); `null` has one meaning, the latest. Its links and images follow it. */
  readonly pageAt: string | null;
```
  Find (`pwa/src/docs/docsLinks.ts`): `      const href = docsPageUrl(docsLocation(here, { kind: 'path', section: r.section, path: r.path, dirSlash: false }));` — Replace: `      const href = docsPageUrl(docsLocation(here, { kind: 'path', section: r.section, path: r.path, dirSlash: false, at: ctx.pageAt }));`
  Find (`pwa/src/docs/DocImage.tsx`): `    { kind: 'path', section: ctx.section, path: ctx.path, dirSlash: false, view: ctx.view });` — Replace: `    { kind: 'path', section: ctx.section, path: ctx.path, dirSlash: false, view: ctx.view, at: ctx.pageAt });`
  Find (`pwa/src/docs/DocsLeaf.tsx`): `    project: page.project, pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree,` — Replace: `    project: page.project, pageRef: page.ref, pageAt: page.at, view: page.view, section: page.section, path: page.path, tree,`
  Find (`pwa/src/screens/highlightMeasureRun.tsx`): `        project: p.project, pageRef: null, view: 'effective', section: t.pin.section, path: t.pin.path, tree,` — Replace: `        project: p.project, pageRef: null, pageAt: null, view: 'effective', section: t.pin.section, path: t.pin.path, tree,`
- [ ] **Step 4: The image pin.** Find (`pwa/src/docs/docsLinks.ts`):
```ts
    const pin: DocPin = {
      kind: 'committed', commit: tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path,
    };
    return { ok: true, pin, draft: false, uncommittedNotShown };
  };
  if (pinFor(tree, page)?.kind !== 'draft') return committed(page.ref !== null && admitDraft(e, drafts));
```
  Replace:
```ts
    // Refinement (n): a version page's images are read at its version (rich-docs spec G6), never at the tip.
    const pin: DocPin = {
      kind: 'committed', commit: page.at ?? tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path,
    };
    return { ok: true, pin, draft: false, uncommittedNotShown };
  };
  if (pinFor(tree, page)?.kind !== 'draft') return committed(page.at === null && page.ref !== null && admitDraft(e, drafts));
```
  `imagePinFor`'s docstring's committed-page line gains "at `page.at` on a version page".
  The size pre-check, in `planImageRef`, the one planner for the plain view's and the reader's images. Find (`pwa/src/docs/DocImage.tsx`): `  const size = ip.pin.kind === 'draft' ? e?.draft?.size : e?.committed?.size;` — Replace:
```ts
  // Refinement (n): on a version page the listing's size is the tip's, not the version's, so ccd's class cap answers.
  const size = ctx.pageAt !== null ? undefined : ip.pin.kind === 'draft' ? e?.draft?.size : e?.committed?.size;
```
  (Presence is still `imagePinFor`'s answer from the served listing: an image it does not hold as a committed file is `absent`, as (11) pins.)
- [ ] **Step 5: Green.** `docs-links`, `docs-images`, `docs-markdown`, `reader-images`, `docs-export`, `docs-export-assets`, `goals-panel`, `session-docs-link`, `highlight*`; `tsc`.
- [ ] **Step 6: Commit.** Message `pwa: a version page's links and images stay at its version (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T16-M1 | (o) | `src/docs/docsLinks.ts` | the path arm's `at` is always `null` | `docs-links` | 3 failed — (1), (6), (7) |
| W5B-T16-M2 | (n) | `src/docs/docsLinks.ts` | the image pin at the tip | `docs-images` | 1 failed — (8) |
| W5B-T16-M3 | (q) | `src/docs/docsLinks.ts` | the version target keeps the page's `at` | `docs-links` | 1 failed — (4) |
| W5B-T16-M4 | (n) | `src/docs/DocImage.tsx` | the version arm of the image size pre-check dropped | `docs-images` | 1 failed — (10) |

```json
{"id": "W5B-T16-M1", "spec": "(o)", "pkg": "pwa", "file": "src/docs/docsLinks.ts", "old": "        at: to.dirSlash ? null : to.at !== undefined ? to.at : page.kind === 'path' ? page.at : null,", "new": "        at: null,", "tests": ["test/docs-links.test.tsx"], "red": "3 failed: a path target from a version page keeps its at; a doc link inside a version page keeps the version; its own crumb keeps it"}
{"id": "W5B-T16-M2", "spec": "(n)", "pkg": "pwa", "file": "src/docs/docsLinks.ts", "old": "      kind: 'committed', commit: page.at ?? tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path,", "new": "      kind: 'committed', commit: tree.ref.commit, servedRef: tree.ref.served, section: e.section, path: e.path,", "tests": ["test/docs-images.test.tsx"], "red": "1 failed: an image on a version page is pinned at the version"}
{"id": "W5B-T16-M3", "spec": "(q)", "pkg": "pwa", "file": "src/docs/docsLinks.ts", "old": "    return { ...page, at: page.dirSlash ? null : to.at, view: 'effective' };", "new": "    return { ...page, view: 'effective' };", "tests": ["test/docs-links.test.tsx"], "red": "1 failed: the version target sets and clears at"}
{"id": "W5B-T16-M4", "spec": "(n)", "pkg": "pwa", "file": "src/docs/DocImage.tsx", "old": "  const size = ctx.pageAt !== null ? undefined : ip.pin.kind === 'draft' ? e?.draft?.size : e?.committed?.size;", "new": "  const size = ip.pin.kind === 'draft' ? e?.draft?.size : e?.committed?.size;", "tests": ["test/docs-images.test.tsx"], "red": "1 failed: on a version page an image whose listed size is over its class cap still requests"}
```

### Task 17: The visit opens the version (refinement (p); M9.11, the page half)

**Files:** Modify `pwa/src/docs/useDocsVisit.ts`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/docsText.ts`; Create `pwa/test/docs-version.test.tsx`.

- [ ] **Step 1: Red first.** `docs-version.test.tsx` (`DocsScreen` with `fakeLoaders` recording every `file` and `raster` call, and a fake `ReaderDeps.mount` that records its input, built as `pwa/test/reader-frame.test.tsx` builds its own): (1) `'a page at at= reads a committed pin at that commit, served ref the listing's'` (M9.11); (2) `'a version whose blob equals the latest's is read, not taken from the latest's body'`; (3) `'unknown-commit on a version page fails it, with no re-list, and says the box has no such commit'` (the tree loader called once; the page reads "This box's copy of the repository has no commit <short>.", never the re-list sentence); (4) `'a version page skips the listing's size and lets the class cap answer'` (a listed size over the cap still requests); (5) `'opening a version and coming back does not say Updated to'`; (6) `'the reader remounts at a version with the same blob, its version sha the version's'`; (7) `'a version of a doc the listing does not hold is Not in this listing'`; (8) `'a version of a new draft opens nothing'`; (9) `'a pending fragment for the latest is not spent on the version'`. Red.
- [ ] **Step 2: The pin.** Find (`pwa/src/docs/useDocsVisit.ts`):
```ts
  const entry = findEntry(tree, page.section, page.path);
  if (entry === undefined) return null;
  const view = entryView(entry, tree.drafts, page.ref === null ? 'default' : 'ref');
```
  Replace:
```ts
  const entry = findEntry(tree, page.section, page.path);
  if (entry === undefined) return null;
  // The version view (rich-docs spec G6; refinement (p)): the committed bytes at `at`, for a doc the served listing holds
  // as a committed file. Never a draft: a version is a commit.
  if (page.at !== null) {
    const kind = entry.committed?.kind;
    return kind === 'file' || kind === 'exec'
      ? { kind: 'committed', commit: page.at, servedRef: tree.ref.served, section: page.section, path: page.path }
      : null;
  }
  const view = entryView(entry, tree.drafts, page.ref === null ? 'default' : 'ref');
```
  `pinFor`'s docstring gains "A version page (`at`) opens the committed bytes at `at`, or nothing."
- [ ] **Step 3: The file key.** Find:
```ts
  if (pin.kind === 'draft') return ['draft', pin.branch, pin.head, pin.section, pin.path, pin.fp].join(NUL);
  const blob = findEntry(tree, pin.section, pin.path)?.committed?.blob;
```
  Replace:
```ts
  if (pin.kind === 'draft') return ['draft', pin.branch, pin.head, pin.section, pin.path, pin.fp].join(NUL);
  // A pin at another commit than the listing's (a version) is keyed by that commit: the listing's blob is the tip's.
  if (pin.commit !== tree.ref.commit) return ['commit', pin.commit, pin.section, pin.path].join(NUL);
  const blob = findEntry(tree, pin.section, pin.path)?.committed?.blob;
```
- [ ] **Step 4: The wanted read.** Find: `  | { kind: 'read'; target: Target; tKey: string; fKey: string; leaf: string; pin: DocPin };` — Replace: `  | { kind: 'read'; target: Target; tKey: string; fKey: string; leaf: string; pin: DocPin; version: boolean };`. Find:
```ts
  const size = pin.kind === 'draft' ? entry?.draft?.size : entry?.committed?.size;
```
  Replace:
```ts
  // A version's size is not the listing's (the listing is the served commit's): the class cap is ccd's answer there.
  const size = page.at !== null ? undefined : pin.kind === 'draft' ? entry?.draft?.size : entry?.committed?.size;
```
  Find:
```ts
  const leaf = [tKey, page.section, page.path, page.view].join(NUL);
  return { kind: 'read', target, tKey, fKey: fileKey(pin, tree), leaf, pin };
```
  Replace:
```ts
  const leaf = [tKey, page.section, page.path, page.view, page.at ?? ''].join(NUL);
  return { kind: 'read', target, tKey, fKey: fileKey(pin, tree), leaf, pin, version: page.at !== null };
```
  Find: `  return [treeKey(page.project, page.ref), page.section, page.path].join(NUL);` — Replace: `  return [treeKey(page.project, page.ref), page.section, page.path, page.at ?? ''].join(NUL);` (and `fragmentKey`'s docstring: "never its view, slash or frame" gains "; its version, yes").
  Find: `    if (DOCS_RELIST_WORDS.has(word)) {` — Replace:
```ts
    // A version's commit is the URL's, so a word that would mean "the listing moved" is that commit's own answer: no
    // re-list can change it (refinement (p)).
    if (DOCS_RELIST_WORDS.has(word) && !w.version) {
```
- [ ] **Step 5: The leaf.** Find (`pwa/src/docs/DocsLeaf.tsx`):
```ts
function bodyKeyOf(pin: DocPin, show: DocsShowOk, pinKey: string): string {
  if (pin.kind === 'draft' || show.blob === undefined) return pinKey;
```
  Replace:
```ts
function bodyKeyOf(pin: DocPin, show: DocsShowOk, pinKey: string, version: boolean): string {
  // A version is keyed by its pin, so it remounts the reader with its own sha (rich-docs spec 4.1) even when its blob is
  // the latest's.
  if (pin.kind === 'draft' || version || show.blob === undefined) return pinKey;
```
  Find: `              show={show} bodyKey={bodyKeyOf(file.pin, show, pinKey)} link={link} parser={parser}` — Replace: `              show={show} bodyKey={bodyKeyOf(file.pin, show, pinKey, page.at !== null)} link={link} parser={parser}`. Find: `      const size = pin.kind === 'draft' ? entry.draft?.size : entry.committed?.size;` — Replace: `      const size = page.at !== null ? undefined : pin.kind === 'draft' ? entry.draft?.size : entry.committed?.size;`
  The failed slot on a version page (refinement (p)): `docsText.ts:34`'s "the listing has to be read again" names a remedy that cannot work there. Find: `    } else if (file.s !== 'ok') {` — Replace:
```tsx
    } else if (file.s === 'failed' && page.at !== null && file.body.failure === 'unknown-commit') {
      // Refinement (p): the commit is the URL's, and no re-list can bring it back; on a shared link it may simply not be
      // in this box's clone, so the words name what is missing rather than the listing's remedy.
      body = <p className="docs-note">{fillSentence(DOCS_VIEW_TEXT.versionUnknownCommit, { short: shortCommit(page.at) })}</p>;
    } else if (file.s !== 'ok') {
```
  Find: `import { DOCS_SHOW_NO_BYTES, DOCS_SHOW_NOT_SVG, DOCS_VIEW_TEXT, failureSentence, fillSentence, kib, slotSentence } from './docsText';` — Replace: `import { DOCS_SHOW_NO_BYTES, DOCS_SHOW_NOT_SVG, DOCS_VIEW_TEXT, failureSentence, fillSentence, kib, shortCommit, slotSentence } from './docsText';`. The words: Find (`pwa/src/docs/docsText.ts`, as W5b-1 left it): `  sectionUnserved: "The fleet box does not serve this section yet; it appears once that box's ccrc is updated.",` — Replace: that line, then `  versionUnknownCommit: "This box's copy of the repository has no commit {short}.",`.
- [ ] **Step 6: Green.** `docs-version`, `docs-visit`, `docs-refresh`, `docs-relist-bounded`, `docs-screen`, `reader-frame`, `docs-export`, `docs-share-sheet`; `tsc`.
- [ ] **Step 7: Commit.** Message `pwa: a page at at= reads that commit, keyed by it, with no re-list (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T17-M1 | M9.11 | `src/docs/useDocsVisit.ts` | the version arm of `pinFor` reads `false` | `docs-version` | 4+ failed — (1), (2), (6), (8) |
| W5B-T17-M2 | (p) | `src/docs/useDocsVisit.ts` | the file key's version branch dropped | `docs-version` | 1 failed — (2) |
| W5B-T17-M3 | (p) | `src/docs/useDocsVisit.ts` | `&& !w.version` dropped | `docs-version` | 1 failed — (3) |
| W5B-T17-M4 | (p) | `src/docs/DocsLeaf.tsx` | `version ||` dropped from the body key | `docs-version` | 1 failed — (6) |
| W5B-T17-M5 | (p) | `src/docs/useDocsVisit.ts` | the leaf key loses `at` | `docs-version` | 1 failed — (5) |
| W5B-T17-M6 | (p) | `src/docs/DocsLeaf.tsx` | the version arm of the failed slot reads `false` | `docs-version` | 1 failed — (3), its sentence |

```json
{"id": "W5B-T17-M1", "spec": "M9.11", "pkg": "pwa", "file": "src/docs/useDocsVisit.ts", "old": "  if (page.at !== null) {\n    const kind = entry.committed?.kind;", "new": "  if (false) {\n    const kind = entry.committed?.kind;", "tests": ["test/docs-version.test.tsx"], "red": "4+ failed: a page at at= reads a committed pin at that commit; …"}
{"id": "W5B-T17-M2", "spec": "(p)", "pkg": "pwa", "file": "src/docs/useDocsVisit.ts", "old": "  if (pin.commit !== tree.ref.commit) return ['commit', pin.commit, pin.section, pin.path].join(NUL);\n", "new": "", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: a version whose blob equals the latest's is read"}
{"id": "W5B-T17-M3", "spec": "(p)", "pkg": "pwa", "file": "src/docs/useDocsVisit.ts", "old": "    if (DOCS_RELIST_WORDS.has(word) && !w.version) {", "new": "    if (DOCS_RELIST_WORDS.has(word)) {", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: unknown-commit on a version page fails it, with no re-list"}
{"id": "W5B-T17-M4", "spec": "(p)", "pkg": "pwa", "file": "src/docs/DocsLeaf.tsx", "old": "  if (pin.kind === 'draft' || version || show.blob === undefined) return pinKey;", "new": "  if (pin.kind === 'draft' || show.blob === undefined) return pinKey;", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: the reader remounts at a version with the same blob"}
{"id": "W5B-T17-M5", "spec": "(p)", "pkg": "pwa", "file": "src/docs/useDocsVisit.ts", "old": "  const leaf = [tKey, page.section, page.path, page.view, page.at ?? ''].join(NUL);", "new": "  const leaf = [tKey, page.section, page.path, page.view].join(NUL);", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: opening a version and coming back does not say Updated to"}
{"id": "W5B-T17-M6", "spec": "(p)", "pkg": "pwa", "file": "src/docs/DocsLeaf.tsx", "old": "    } else if (file.s === 'failed' && page.at !== null && file.body.failure === 'unknown-commit') {", "new": "    } else if (false) {", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: unknown-commit on a version page fails it, with no re-list, and says the box has no such commit"}
```

### Task 18: The header and one banner name the version (refinement (q))

**Files:** Modify `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/DocsBanners.tsx`, `pwa/src/docs/docsText.ts`, `pwa/test/docs-version.test.tsx`.

- [ ] **Step 0:** Grep (as the take-up left `DocsHead.tsx`): `OneBar` passes `rowBadge(tree, page, file)` and renders `<TruthLine` (each once inside it). If either is missing, stop and ask: the version's words would not reach the one bar.
- [ ] **Step 1: Red first.** `docs-version.test.tsx`, appended: (10) `'the truth line names the version and links back to the latest'` (the source reads `version <short>`, its `title` the full sha; the link's `href` is the page without `at`, keeping `ref`); (11) `'the phone row's badge names the version'` (at 412 px, the compact head's where line); (12) `'the version banner shows with Back to the latest'`; (13) `'the not-contained banner on a version says another branch, with no Re-list'`; (14) `'no Open committed version on a version page'`; (15) `'a version page's draft badge is not drawn'`; (16) `'a leaf that opens nothing still draws its badge in the truth line, as its phone row does'` (a withheld new draft in a ref view, no `at`: the truth line's badge and `rowBadge` agree); (17) `'a version page shows no banner about the latest's drafts'` (a ref view `?ref=ws/a&at=<sha>` whose holder has drafts, not base-equal, and the leaf `deleted` there: no base hint and no withheld, deleted, typechange or conflicted banner, while the version banner shows; in the default view of the same page, no default hint; and `DocsBanners` rendered directly on that version page with `draftAssets: 1` draws no draft-images banner, since a version page's own images are never drafts). Red.
- [ ] **Step 2: The words.** Find (`pwa/src/docs/docsText.ts`): `  sourceNone: 'nothing opened',` — Replace: that line, then:
```ts
  sourceVersion: 'version {short}',
  backToLatest: 'Back to the latest',
```
  Find: `  backToDraft: 'Back to the draft',` — Replace: that line, then:
```ts
  version: 'Showing the version at {short}, not the latest on {served}.',
  notContainedVersion: 'Commit {short} is not on {served}; it comes from another branch.',
```
- [ ] **Step 3: The head.** Find (`pwa/src/docs/DocsHead.tsx`):
```ts
  | { readonly kind: 'committed'; readonly viewCommitted: boolean }
```
  Replace:
```ts
  | { readonly kind: 'committed'; readonly viewCommitted: boolean }
  /** The version view (rich-docs spec G6): the committed bytes at `commit`, the page's `at`. */
  | { readonly kind: 'version'; readonly commit: string }
```
  Find:
```ts
  if (opened === null) return { kind: 'none' };
  if (opened.kind === 'committed') return { kind: 'committed', viewCommitted: page.view === 'committed' };
```
  Replace:
```ts
  if (opened === null) return { kind: 'none' };
  if (opened.kind === 'committed' && page.at !== null) return { kind: 'version', commit: opened.commit };
  if (opened.kind === 'committed') return { kind: 'committed', viewCommitted: page.view === 'committed' };
```
  Find:
```ts
    case 'committed':
      return s.viewCommitted ? DOCS_HEAD_TEXT.sourceViewCommitted : DOCS_HEAD_TEXT.sourceCommitted;
```
  Replace:
```ts
    case 'committed':
      return s.viewCommitted ? DOCS_HEAD_TEXT.sourceViewCommitted : DOCS_HEAD_TEXT.sourceCommitted;
    case 'version':
      return fillSentence(DOCS_HEAD_TEXT.sourceVersion, { short: shortCommit(s.commit) });
```
  Find:
```tsx
        : <span className="docs-truth-source">{truthSource(tree, page, opened)}</span>;
      leaf = (
        <>
          {SEP}{source}
          {k.view.badge !== null && s.kind !== 'draft' && <>{SEP}<span className="docs-badge">{ENTRY_BADGE_TEXT[k.view.badge]}</span></>}
```
  Replace:
```tsx
        : s.kind === 'version'
          ? (
            <>
              <span className="docs-truth-source" title={s.commit}>{truthSource(tree, page, opened)}</span>{SEP}
              <DocsPageLink className="docs-hint-link" href={docsPageUrl(docsLocation(page, { kind: 'version', at: null }))}>
                {DOCS_HEAD_TEXT.backToLatest}
              </DocsPageLink>
            </>
          )
          : <span className="docs-truth-source">{truthSource(tree, page, opened)}</span>;
      leaf = (
        <>
          {SEP}{source}
          {k.view.badge !== null && s.kind !== 'draft' && s.kind !== 'version' && <>{SEP}<span className="docs-badge">{ENTRY_BADGE_TEXT[k.view.badge]}</span></>}
```
  (Never `s.kind === 'committed'`: a leaf whose source is `none`, one that opens nothing, keeps its badge, and `rowBadge` returns that badge for every source but `draft` and `version`, so the truth line and the phone row stay one badge, M4.T7.)
  Find:
```ts
  if (s.kind === 'draft') return { word: badgeText(s.badge), badged: s.badge !== null };
```
  Replace:
```ts
  if (s.kind === 'draft') return { word: badgeText(s.badge), badged: s.badge !== null };
  if (s.kind === 'version') return { word: truthSource(tree, page, openedPin(tree, page, file)), badged: true };
```
  Find: `  if (page.kind === 'path' && page.view !== 'committed') {` — Replace: `  if (page.kind === 'path' && page.view !== 'committed' && page.at === null) {`
- [ ] **Step 4: The banners.** First the gate on the latest's drafts (refinement (q)). Find (`pwa/src/docs/DocsBanners.tsx`): `  const n = tree.entries.filter((e) => e.draft !== null).length;` — Replace:
```tsx
  const n = tree.entries.filter((e) => e.draft !== null).length;
  // Refinement (q): a version page is one commit, so no banner about the latest's drafts applies to it, and a hint's
  // same-page link would keep its `at`. The drafts-snapshot banners below stay: a version page still reads that listing.
  const version = page.kind === 'path' && page.at !== null;
```
  Then each of these Finds, in order, gains `!version` in its condition: `      if (mode === 'default' && n > 0) {` → `      if (mode === 'default' && n > 0 && !version) {`; `      if (mode === 'ref' && !d.baseEqual && n > 0) {` → `      if (mode === 'ref' && !d.baseEqual && n > 0 && !version) {`; `      if (v.badge === 'withheld' && v.withheld !== null) {` → `      if (!version && v.badge === 'withheld' && v.withheld !== null) {`; `      if (v.badge === 'deleted') {` → `      if (!version && v.badge === 'deleted') {`; `      if (v.badge === 'typechange') {` → `      if (!version && v.badge === 'typechange') {`; `      if (v.badge === 'conflicted') out.push(` → `      if (!version && v.badge === 'conflicted') out.push(`; `      if (draftAssets > 0) {` → `      if (!version && draftAssets > 0) {`.
  Then the not-contained banner. Find:
```tsx
          out.push(
            <Banner key="not-contained" id="not-contained" tone="warn"
              text={fillSentence(DOCS_BANNER_TEXT.notContained, { short: shortCommit(read), served: servedRefText(tree.ref) })}>
              <RelistButton label={DOCS_BANNER_TEXT.relist} onRelist={onRelist} />
            </Banner>,
          );
```
  Replace:
```tsx
          // A version is not on the served ref because it comes from elsewhere; a re-list cannot change that.
          out.push(page.at !== null
            ? (
              <Banner key="not-contained" id="not-contained" tone="warn"
                text={fillSentence(DOCS_BANNER_TEXT.notContainedVersion, { short: shortCommit(read), served: servedRefText(tree.ref) })} />
            )
            : (
              <Banner key="not-contained" id="not-contained" tone="warn"
                text={fillSentence(DOCS_BANNER_TEXT.notContained, { short: shortCommit(read), served: servedRefText(tree.ref) })}>
                <RelistButton label={DOCS_BANNER_TEXT.relist} onRelist={onRelist} />
              </Banner>
            ));
```
  Find: `      if (page.view === 'committed') {` — Replace:
```tsx
      if (page.at !== null) {
        out.push(
          <Banner key="version" id="version" tone="info"
            text={fillSentence(DOCS_BANNER_TEXT.version, { short: shortCommit(page.at), served: servedRefText(tree.ref) })}>
            <HintLink href={docsPageUrl(docsLocation(page, { kind: 'version', at: null }))} label={DOCS_HEAD_TEXT.backToLatest} />
          </Banner>,
        );
      }
      if (page.view === 'committed') {
```
  (add `DOCS_HEAD_TEXT` to the file's `./docsText` import).
- [ ] **Step 5: Green.** `docs-version`, `docs-truth`, `docs-banners`, `docs-compact-head`, `docs-one-bar` (the take-up's), `control-census` (no new key: `DocsPageLink`'s class is the computed entry's, `control-census.test.ts`'s `docs/DocsTreeView.tsx <a> (computed)`, which lists `.docs-hint-link`), `tap-targets`, `markup-census`, `contrast`; `tsc`.
- [ ] **Step 6: Commit.** Message `pwa: the header and a banner name the version, with Back to the latest (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T18-M1 | (q) | `src/docs/DocsHead.tsx` | `leafSource`'s version arm reads `false` | `docs-version` | 3 failed — (10), (11), (15) |
| W5B-T18-M2 | (q) | `src/docs/DocsHead.tsx` | Open committed version on a version page | `docs-version` | 1 failed — (14) |
| W5B-T18-M3 | (q) | `src/docs/DocsBanners.tsx` | the version banner's condition reads `false` | `docs-version` | 1 failed — (12) |
| W5B-T18-M4 | (q) | `src/docs/DocsBanners.tsx` | the not-contained banner keeps Re-list on a version | `docs-version` | 1 failed — (13) |
| W5B-T18-M5 | (q) | `src/docs/DocsHead.tsx` | the truth line's badge loses `&& s.kind !== 'version'` | `docs-version` | 1 failed — (15) |
| W5B-T18-M6 | (q) | `src/docs/DocsHead.tsx` | the truth line's badge reads `s.kind === 'committed'` | `docs-version` | 1 failed — (16) |
| W5B-T18-M7 | (q) | `src/docs/DocsBanners.tsx` | the version gate on the drafts banners reads `false` | `docs-version` | 1 failed — (17) |

```json
{"id": "W5B-T18-M1", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "  if (opened.kind === 'committed' && page.at !== null) return { kind: 'version', commit: opened.commit };", "new": "  if (false) return { kind: 'version', commit: opened.commit };", "tests": ["test/docs-version.test.tsx"], "red": "3 failed: the truth line names the version; the phone row's badge; a version page's draft badge"}
{"id": "W5B-T18-M2", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "  if (page.kind === 'path' && page.view !== 'committed' && page.at === null) {", "new": "  if (page.kind === 'path' && page.view !== 'committed') {", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: no Open committed version on a version page"}
{"id": "W5B-T18-M3", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsBanners.tsx", "old": "      if (page.at !== null) {\n        out.push(\n          <Banner key=\"version\"", "new": "      if (false) {\n        out.push(\n          <Banner key=\"version\"", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: the version banner shows with Back to the latest"}
{"id": "W5B-T18-M4", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsBanners.tsx", "old": "          out.push(page.at !== null\n", "new": "          out.push(false\n", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: the not-contained banner on a version says another branch, with no Re-list"}
{"id": "W5B-T18-M5", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "{k.view.badge !== null && s.kind !== 'draft' && s.kind !== 'version' && <>", "new": "{k.view.badge !== null && s.kind !== 'draft' && <>", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: a version page's draft badge is not drawn"}
{"id": "W5B-T18-M6", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "{k.view.badge !== null && s.kind !== 'draft' && s.kind !== 'version' && <>", "new": "{k.view.badge !== null && s.kind === 'committed' && <>", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: a leaf that opens nothing still draws its badge in the truth line, as its phone row does"}
{"id": "W5B-T18-M7", "spec": "(q)", "pkg": "pwa", "file": "src/docs/DocsBanners.tsx", "old": "  const version = page.kind === 'path' && page.at !== null;", "new": "  const version = false;", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: a version page shows no banner about the latest's drafts"}
```

### Task 19: Share on a version view, and Export's body links (refinements (r), (t))

**Files:** Modify `pwa/src/docs/share.ts`, `pwa/src/docs/docsText.ts`, `pwa/src/docs/export/exportMarkdown.tsx`, `pwa/test/docs-share.test.ts`, `pwa/test/docs-version.test.tsx`.

- [ ] **Step 1: Red first.** `docs-share.test.ts`, describe `'a version view (base spec 4.13; rich-docs G6)'`, a leaf at `at = V` with a file answer read at V: (1) `'origin served, onRef contains: the permalink names V'`; (2) `'local equal, onRef contains: links'`; (3) `'local-ahead, onRef contains: version-unmeasured'`; (4) `'onRef not-contained: version-unmeasured'`; (5) `'onRef unmeasured: version-unmeasured'`; (6) `'a raster version (no show answer): version-unmeasured'`; (7) `'no GitHub origin: no-github-origin'`; (8) `'a version carries no draft notes in a ref view with an admitted draft'`; (9) `'version-unmeasured carries Export's clause on a leaf'` (a unit over `shareRefusalSentence` and the clause set, so it reads the words, not the rule). `docs-version.test.tsx`, appended (refinement (t)): (18) `'an Export of a version page writes its doc and repo links inert, in version-unmeasured's words'` (a unit over `exportLinkTarget` with a commit that is not the listing's: a listed doc and a repo path give the inert span; a fragment and an external link are unchanged; at the listing's own commit the same doc is a permalink). Red.
- [ ] **Step 2: The rule.** Find (`pwa/src/docs/share.ts`):
```ts
export type ShareRefusal =
  | 'no-github-origin' | 'bad-slug' | 'bad-target' | 'not-on-origin' | 'unmeasured' | 'new-draft' | 'new-withheld';
```
  Replace:
```ts
export type ShareRefusal =
  | 'no-github-origin' | 'bad-slug' | 'bad-target' | 'not-on-origin' | 'unmeasured' | 'new-draft' | 'new-withheld'
  | 'version-unmeasured';
```
  Find:
```ts
  const access: ShareNoteLine[] = tree.github.state === 'none' ? [] : [{ note: 'access', fields: { slug: tree.github.slug } }];
  if (!link.ok) {
```
  Replace:
```ts
  const access: ShareNoteLine[] = tree.github.state === 'none' ? [] : [{ note: 'access', fields: { slug: tree.github.slug } }];
  // A version view (rich-docs spec G6; base spec 4.13; refinement (r)). `githubPermalink` judges the served ref's TIP; a
  // version is an older commit, which origin holds when the tip is on origin AND the version is on the served ref
  // (`onRef === 'contains'`, measured by the read that showed it). Anything else is unmeasured, never a guessed link.
  const version = leaf !== null && page.kind === 'path' && page.at !== null;
  if (version) {
    const onRef = opened.kind === 'file' && opened.pin.kind === 'committed' && opened.show !== null
      && opened.show.commit === opened.pin.commit ? opened.show.onRef : undefined;
    const ownWord = !link.ok && (link.why === 'no-github-origin' || link.why === 'bad-slug' || link.why === 'bad-target');
    if (!ownWord && (!link.ok || onRef !== 'contains')) {
      return { ok: false, why: 'version-unmeasured', fields: { short }, notes: access };
    }
  }
  if (!link.ok) {
```
  Find:
```ts
    if (admitted && page.view === 'committed') notes.push({ note: 'view-committed', fields: { label } });
    else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });
    else if (admitted && view.badge !== null) {
```
  Replace:
```ts
    if (version) {
      // A version is one commit: no draft is part of it, so no draft note applies.
    } else if (admitted && page.view === 'committed') notes.push({ note: 'view-committed', fields: { label } });
    else if (view.opens === 'draft') notes.push({ note: 'drafts-excluded', fields: { short, label } });
    else if (admitted && view.badge !== null) {
```
- [ ] **Step 3: The words.** Find (`pwa/src/docs/docsText.ts`): `  'new-withheld': 'Not committed yet, and Docs did not read it ({withheld}); nothing to share or export.',` — Replace: that line, then `  'version-unmeasured': 'Docs cannot tell whether origin has {short}, so it gives no link to this version.',`. Find: `  new Set<ShareRefusal>(['no-github-origin', 'bad-slug', 'bad-target', 'new-draft']);` — Replace: `  new Set<ShareRefusal>(['no-github-origin', 'bad-slug', 'bad-target', 'new-draft', 'version-unmeasured']);`
  Export's body links (refinement (t)). Find (`pwa/src/docs/export/exportMarkdown.tsx`): `  const r = resolveDocRef({ section: link.section, path: link.path }, raw);` — Replace:
```ts
  const r = resolveDocRef({ section: link.section, path: link.path }, raw);
  // Refinement (t), W5b: an export whose commit is not the listing's (a version page's) names a commit `githubPermalink`
  // cannot vouch for, since it judges the served ref's tip and never `onRef`. Its doc and repo links stay inert, in
  // Share's own words (refinement (r)), rather than risk a link that 404s.
  if (commit !== link.tree.ref.commit && (r.kind === 'doc' || r.kind === 'repo')) {
    return { kind: 'inert', title: shareRefusalSentence('version-unmeasured', { short: shortCommit(commit) }, false) };
  }
```
  `exportLinkTarget`'s docstring gains "A version page's doc and repo links are inert (refinement (t))." The file already imports `shareRefusalSentence` and `shortCommit`.
- [ ] **Step 4: Green.** `docs-share`, `docs-share-sheet`, `docs-version`, `docs-export` (unchanged: its link table's commit is the listing's), `docs-export-body`, `docs-export-sheet` (Export's provenance takes Share's link as it is); `tsc`.
- [ ] **Step 5: Commit.** Message `pwa: Share links a version only when origin is known to hold it (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T19-M1 | (r) | `src/docs/share.ts` | the version rule skipped | `docs-share` | 5 failed — (3), (4), (5), (6) (the raster version's link is ok without the rule), (8) (the draft notes return) |
| W5B-T19-M2 | (r) | `src/docs/share.ts` | `onRef !== 'contains'` → `onRef === 'not-contained'` | `docs-share` | 2 failed — (5), (6) |
| W5B-T19-M3 | (r) | `src/docs/docsText.ts` | the clause set loses the new word | `docs-share` | 1 failed — (9) |
| W5B-T19-M4 | (t) | `src/docs/export/exportMarkdown.tsx` | the version arm of `exportLinkTarget` dropped | `docs-version` | 1 failed — (18) |

```json
{"id": "W5B-T19-M1", "spec": "(r)", "pkg": "pwa", "file": "src/docs/share.ts", "old": "  const version = leaf !== null && page.kind === 'path' && page.at !== null;", "new": "  const version = false;", "tests": ["test/docs-share.test.ts"], "red": "5 failed: local-ahead, onRef contains: version-unmeasured; onRef not-contained; onRef unmeasured; a raster version; a version carries no draft notes"}
{"id": "W5B-T19-M2", "spec": "(r)", "pkg": "pwa", "file": "src/docs/share.ts", "old": "    if (!ownWord && (!link.ok || onRef !== 'contains')) {", "new": "    if (!ownWord && (!link.ok || onRef === 'not-contained')) {", "tests": ["test/docs-share.test.ts"], "red": "2 failed: onRef unmeasured; a raster version"}
{"id": "W5B-T19-M3", "spec": "(r)", "pkg": "pwa", "file": "src/docs/docsText.ts", "old": "'bad-target', 'new-draft', 'version-unmeasured']);", "new": "'bad-target', 'new-draft']);", "tests": ["test/docs-share.test.ts"], "red": "1 failed: version-unmeasured carries Export's clause on a leaf"}
{"id": "W5B-T19-M4", "spec": "(t)", "pkg": "pwa", "file": "src/docs/export/exportMarkdown.tsx", "old": "  if (commit !== link.tree.ref.commit && (r.kind === 'doc' || r.kind === 'repo')) {", "new": "  if (false && commit !== link.tree.ref.commit && (r.kind === 'doc' || r.kind === 'repo')) {", "tests": ["test/docs-version.test.tsx"], "red": "1 failed: an Export of a version page writes its doc and repo links inert, in version-unmeasured's words"}
```

### Task 20: The history loader (refinement (s))

**Files:** Modify `pwa/src/lib/api.ts`, `pwa/src/docs/failures.ts`, `pwa/test/docs-api.test.ts`.

- [ ] **Step 1: Red first.** `docs-api.test.ts`: (1) `'history GETs docsApi.history with the marker header'`; (2) `'an ok answer resolves {s:ok, value}'`; (3) `'a docs failure body resolves {s:failed}'`; (4) `'an answer without log is unexpected-response'`; (5) `'a 401 raises the login overlay through request'`. Red.
- [ ] **Step 2: The types.** Find (`pwa/src/docs/failures.ts`): `export type DocsRefreshLoaderAnswer = DocsAnswer<DocsRefreshResponse>;` — Replace: that line, then:
```ts
/** A history read's answer (rich-docs spec G4). */
export type DocsHistoryAnswer = DocsAnswer<DocsHistoryResponse>;

/** The history loader (refinement (s)): beside `DocsLoaders`, not in it, so no visit fake moves until a view reads
 *  history (W8b). Resolves a union, as every docs loader does. */
export interface DocsHistoryLoader { history(project: string, ask: DocsLogAsk): Promise<DocsHistoryAnswer> }
```
  and add `DocsHistoryResponse` and `DocsLogAsk` to its `shared/docs` type import.
- [ ] **Step 3: The loader.** Find (`pwa/src/lib/api.ts`): `    docs: ((): DocsLoaders => {` — Replace: `    docs: ((): DocsLoaders & DocsHistoryLoader => {`. Find:
```ts
          body: JSON.stringify({ ref: body.ref, reason: body.reason }),
        }),
      };
```
  Replace:
```ts
          body: JSON.stringify({ ref: body.ref, reason: body.reason }),
        }),
        history: (project, ask) => read<DocsHistoryResponse>(docsApi.history(project, ask), ['log'], { headers: marker }),
      };
```
  Add `type DocsHistoryResponse` to the file's `shared/docs` import and `type DocsHistoryLoader` to its `docs/failures` import (`api.ts:23`, `:27`).
- [ ] **Step 4: Green.** `docs-api`, `docs-screen`, `api*`; `tsc`; `GROWTH_CHECK=1 growth-check` (`pwa/src/lib/api.ts` is listed; predicted +3).
- [ ] **Step 5: Commit.** Message `pwa: api.docs.history, the history loader W8b reads (docs W5b-2)`.

| Id | Spec | File | Mutation | Tests | Predicted red |
|---|---|---|---|---|---|
| W5B-T20-M1 | (s) | `src/lib/api.ts` | the marker header dropped from history | `docs-api` | 1 failed — (1) |
| W5B-T20-M2 | (s) | `src/lib/api.ts` | its required fields `[]` | `docs-api` | 1 failed — (4) |

```json
{"id": "W5B-T20-M1", "spec": "(s)", "pkg": "pwa", "file": "src/lib/api.ts", "old": "docsApi.history(project, ask), ['log'], { headers: marker })", "new": "docsApi.history(project, ask), ['log'], {})", "tests": ["test/docs-api.test.ts"], "red": "1 failed: history GETs docsApi.history with the marker header"}
{"id": "W5B-T20-M2", "spec": "(s)", "pkg": "pwa", "file": "src/lib/api.ts", "old": "docsApi.history(project, ask), ['log'], { headers: marker })", "new": "docsApi.history(project, ask), [], { headers: marker })", "tests": ["test/docs-api.test.ts"], "red": "1 failed: an answer without log is unexpected-response"}
```

### Task 21: The spec text for W5b-2 (refinements (m)-(t))

**Files:** Modify the rich-docs spec and the base spec. Each edit ends `(amended <date>; W5b-2)`. If the operator answered Q1 (b) or Q2 (b), the matching sentence says so instead.

- [ ] **Step 1: The rich-docs spec.**
  - §6, G6's row. Find: ``Inside the frame, the `version` op asks for a version (§4.4). | W5b (the key and the page), W8 (the menu) |`` — Replace: ``Inside the frame, the `version` op asks for a version (§4.4). The key is a leaf's only, written after `ref`, which stays in the URL as the page key it is; Back to the latest is that URL less `at`. W5b writes nothing into `history.state`, and W8b's `version` op puts `only` there. The page needs the doc in the served listing as a committed file. Its in-document links, its images and its own crumb keep the version; its other crumbs, Back and the listings go to the latest. A banner names the version too, and Share links it only when origin is known to hold it (amended <date>; W5b-2). | W5b (the key and the page), W8 (the menu) |`` (Q1 (b): "…which stays in the URL as the page key it is; Back to the latest reads the latest URL kept in `history.state` when the page was opened, or that URL less `at` on a reload…".)
  - §7, A14. Find: ``Add the page key `at=<sha>`. The other pin keys stay refused.`` — Replace: ``Add the page key `at=<sha>`, a leaf's, beside `ref`; `view=committed` beside it and `at` on a directory are canonicalised away, and a bad value is `bad-at` (amended <date>; W5b-2). The other pin keys stay refused.``
  - §10, RD19 (Q1 (a) only; under Q1 (b) it stands). Find: ``| `at=<sha>` (R-d). `only` and `latest` stay in-visit state. | Ruled |`` — Replace: ``| `at=<sha>` (R-d). `only` stays in-visit state; the latest is the page URL less `at`, since `ref` stays in the URL (amended <date>; W5b-2). | Ruled |``
  - Later (Q1 (a) only). Find: ``- `only` and `latest` in the URL beside `at=`, if in-visit state proves too thin.`` — Replace: ``- `only` in the URL beside `at=`, if in-visit state proves too thin (`latest` needs no state: it is the page URL less `at`; amended <date>; W5b-2).``
- [ ] **Step 2: The base spec.**
  - §4.11's pin rule, its committed-page bullet. Find: ``giving `CommittedPin{commit: ref.commit, servedRef: ref.served, section, path}`; otherwise refused `absent`. If `mode === 'ref'` and `admitDraft(e, drafts)`, the image wears "uncommitted change not shown";`` — Replace: the same, then `` on a version page (rich-docs G6) the commit is `at`, and no image wears that note; the image must still be a committed file in the served listing, else `absent`, and its listed size, which is the tip's, is not checked, so ccd's class cap answers; an image's `unknown-commit` there is its own failure, with no re-list (amended <date>; W5b-2);``
  - §2 (e), the gc'd pin. Find: ``- A pinned commit that has since been gc'd answers `unknown-commit`, and the PWA re-lists once.`` — Replace: the same, then `` On a version page (rich-docs G6), whose commit is the URL's `at`, it does not: the read fails, and the page says "This box's copy of the repository has no commit <short>." (amended <date>; W5b-2).``
  - §2 (e), where a commit comes from. Find: ``A commit reaches a request only from a tree answer of the same visit. The page grammar never carries one (§3.1).`` — Replace: ``A commit reaches a request only from a tree answer of the same visit, or from a version page's `at=`, the one commit the page grammar carries, on a leaf (§3.1; rich-docs A14; amended <date>; W5b-2).``
  - §2 (e), the re-fetch. Find: ``  - after `draft-changed`, `worktree-moved`, `worktree-gone` or `unknown-commit`, with one automatic retry and then an inline "changing — retry".`` — Replace: the same, then `` A version page's file read does not re-list on these words: its commit is the URL's (amended <date>; W5b-2).``
  - The failure table. Find: ``| `unknown-commit` | 404 | auto | re-list |`` — Replace: ``| `unknown-commit` | 404 | auto, none on a version page | re-list; on a version page, none, and the page says its box has no such commit (amended <date>; W5b-2) |``
  - §4.3 item 2. Find: ``2. **File slots.** Committed bodies are keyed by `blob`, so a file unchanged across a moving default branch is not re-downloaded.`` — Replace: the same, then `` A body at a version (rich-docs G6) is keyed by its pin's commit instead, so a version whose blob equals the latest's still remounts (amended <date>; W5b-2).``
  - §3.1, `view`. Find: ``Without `ref` it is redundant, because the default view never overlays drafts, and it is canonicalised away.`` — Replace: the same, then `` Beside `at` it is redundant too, since a version is committed bytes, and it is canonicalised away (amended <date>; W5b-2).``
  - §4.5's truth line. Find: ``| Source (leaf) | the opened pin | `committed`, `committed (view=committed)`, or `draft · <state> in <worktree label>` |`` — Replace: ``| Source (leaf) | the opened pin | `committed`, `committed (view=committed)`, `draft · <state> in <worktree label>`, or `version <short>` with **Back to the latest**, beside which no entry badge is drawn (amended <date>; W5b-2) |``
  - §4.17's links. Find: ``**Links** (`EXPORT_COMPONENTS.a`; C is the commit the leaf opened, §4.16):`` — Replace: ``**Links** (`EXPORT_COMPONENTS.a`; C is the commit the leaf opened, §4.16). On a version page (rich-docs G6) C is not the listing's commit, and `githubPermalink` judges only the served ref's tip, so there the `doc` and `repo` rows give an inert span with `version-unmeasured`'s sentence (amended <date>; W5b-2):``
  - §4.13. Find: `W5b re-derives Share's rows for version views. W5's Share never sees one.` — Replace: ``W5b re-derives Share's rows for version views. W5's Share never sees one. W5b's rule: the link names the version's commit and is offered only when `githubPermalink` would link the served ref's tip and the read measured `onRef === 'contains'`; otherwise the refusal is `version-unmeasured`, with Export's clause, and a version carries no draft notes (amended <date>; W5b-2).``
  - §4.16's refusal table, after its `new-withheld` row: `| \`version-unmeasured\` | "Docs cannot tell whether origin has <short>, so it gives no link to this version." (amended <date>; W5b-2) |`.
  - §4.5's banner table, after the `view=committed` row: `| A version page (\`at=\`) | info | "Showing the version at {short}, not the latest on {served}." · **Back to the latest** (amended <date>; W5b-2) |`, then `| On a version page, the rows about the latest's drafts (the default and base hints, leaf withheld, \`deleted\` / \`typechange\`, \`conflicted\`, draft assets) | — | not shown: a version is one commit (amended <date>; W5b-2) |`; and after the not-contained row: `| The same, on a version page | warn | "Commit {short} is not on {served}; it comes from another branch." No Re-list (amended <date>; W5b-2) |`.
- [ ] **Step 3: Green.** `topology-clean`, `deviation-refs`, `dtbd`; `docs-parity` (M7.9 reads shipped source only; run it anyway).
- [ ] **Step 4: Commit.** Message `docs: the specs' W5b-2 text, the version view and Share's rule (docs W5b-2)`.

### Task 22: Close W5b-2 — review, suites, the mutation table, Results, push and the one PR

- [ ] **Step 1: Whole-branch review (held out).** Three `opus`/`high` lenses over `BASE..HEAD`: (1) the page grammar and the one location builder (Tasks 15-16; every `docsLocation` call site's `at`, found by grep); (2) the visit and the reader at a version (Tasks 17-18); (3) Share's rule and Export's body links (Task 19). Assign tests/rows/loader/spec/privacy across those three `opus`/`high` lenses. Critical/important get three independent `sonnet`/`high` refuters and majority adjudication, minors one advisory refuter; actual identities required, dead/mismatched lens unverified. This internal pass does not replace the independent review run; one commit per confirmed fix with its test or row.
- [ ] **Step 2: Suites** through `ccrc test`: the whole `pwa` suite in pieces and `tsc`; `git fetch -q origin main`, then `server`'s `docs-url`, `docs-shared`, `docs-grammar`, `single-definition/*`, `citations`, `topology-clean`, `typecheck-tests` alone, `GROWTH_CHECK=1 growth-check`; the browser files locally (`docs-headers`, `docs-compact-head`, `docs-export`, `reader-frame`) with their counts.
- [ ] **Step 3: The whole mutation table** of Tasks 15-20 at the end state, as Task 13 Step 3.
- [ ] **Step 4: Reconcile the already-issued-and-defined run-open deviations** of the W5b-2 block: (m) (a departure under either answer to Q1; its entry names the answer), then (n), then (p), then (q), then (t), then any found; unused without prefix. `deviation-refs` and `dtbd` green.
- [ ] **Step 5: Draft `## Results (W5b-2)`** and the PR body (`.superpowers/sdd/2026-11-05-native-docs-reader-w5b-parity/w5b-2-pr-body.md`; title `Docs: a doc at any commit, at=<sha>, with Back to the latest (W5b-2)`). The body names the departures by letter with their numbers, says that an Export of a version page writes its body's doc and repo links inert until Export reads the version's `onRef` (refinement (t)), and repeats the rollout rule: if neither box runs W5b-1 yet, this tag's rollout is `--server-first`.
- [ ] **Step 6: Public-repo scan**, as Task 13 Step 6.
- [ ] **Step 7: Commit the results, last**, with the `Ledger-Edit:` trailer; push; open the ONE PR; measure the fingerprint, wait for CI on the exact tip, list mail, send the wave-done.

## Deviations found

Known departures are allocated and defined by the coordinator in one act at each run-open, then included in the brief. Each close copies those definitions and reconciles its already issued reserve (W5b-1: refinement (a), then (b), then any found; W5b-2: refinement (m), then (n), (p), (q) and (t), then any found).

## Where things stand

### Agreed
- From the rich-docs spec, approved 2026-10-12 and ruled since: G1 (six sections, `docs-sections-v2`), G4 (`docs-log`, its grant, budget, redactor, `log` with fixed flags and no `-n`, the route and its caps), G6 (`at=<sha>`, R-d), A23 (`--server-first`), RD23 (W5b after W5), and the rows M9.2-M9.9 and M9.11-M9.13.
- From the README: `ccd/ccd` needs no restamp (refinement (b)); a feature PR edits this plan's Results only with a `Ledger-Edit:` trailer.
- From the base: the wire's absence-permits rule, the tri-state gate, the exit contract, the one redactor, the read lane, the census, the one location builder (refinement (q) of the W5 part 1 plan named `at` as W5b's).
- The version menu, `only` in `history.state`, the seed's history and "changes since" are W8b's.
- **For the ledger's Carried constraints (A23, restated):** the first rollout that carries W5b-1's commit is `ccrc rollout --server-first`, whichever tag that is, W5b-1's, W5b-2's or a later wave's. `rollout` defaults to fleet first, and a W5-era server refuses a tree that holds a `vision` or `promise` entry. Once both boxes run W5b-1 or later, rollouts go back to any order. The coordinator's ledger PR carries this sentence, so the operator and every later coordinator read it.

### Answered by the operator — item 50

Approved: Q1 a, Q2 a, Q3 two runs. No answer below remains pending; retained alternatives explain the choice.

- **Q1. Where does a version page keep its ref, and what does Back to the latest read?** The rich-docs spec says it three times. G6: "'Back to the latest' its ref, in `history.state` for the visit, not in the URL". RD19 (Ruled): "`only` and `latest` stay in-visit state". Later: "`only` and `latest` in the URL beside `at=`, if in-visit state proves too thin". None of them refuses `ref` as a page key beside `at` (A14 refuses only the other pin keys, and today's grammar carries `ref` on every page but the index), so both options keep `ref` in the URL.
  - **Recommended:** (a) keep `ref` in the URL beside `at` (`/docs/p/specs/x.md?ref=ws/a&at=<sha>`); Back to the latest is that URL less `at`, and W5b writes nothing into `history.state` (refinement (m)). This departs from RD19 and G6's last clause; Task 21 amends RD19 and drops `latest` from the Later line. Why: the version page reads the ref's listing, served ref, `onRef` and Share, so a reload or a shared link opens exactly what you saw, and the latest needs no state to find. `only` still lives in `history.state`, from W8b.
  - Alternative: (b) also keep RD19's `latest`: when a version page is opened, the visit writes the latest URL (the page you came from) into `history.state`, and Back to the latest reads it; a reload or a shared link, which has no such state, falls back to the URL less `at`. RD19 and the Later line then stand as written. One task's change.
  - Not offered: refusing `ref` beside `at`. It is a literal reading of G6's last clause alone, which no other sentence asks for, and it would open a shared branch version over the default branch's listing.
- **Q2. Where does a link inside a version page go?**
  - **Recommended:** (a) it stays at the version, as GitHub's links in a file at a commit do (refinement (o)): you read one snapshot; the header's crumbs above the doc, Back, the listings and Back to the latest go to the latest.
  - Alternative: (b) every link goes to the latest; only the doc you opened is old. One line.
- **Q3. Two runs or three?**
  - **Recommended:** two (W5b-1: ccd, agent, server and the PWA's six sections; W5b-2: the PWA's version view). Why: G1 and G4 share the caps block, the parity block, the wire types and the adapter's gate, so splitting them re-opens the same files a PR later.
  - Alternative: three, cutting W5b-1 after its Task 4 (G1 alone, reviewed alone, then G4 with Tasks 5-13); each cut keeps `main` consistent, and the growth waiver goes with whichever run passes 40 lines.

### Waiting on you

- No repeat Q1–Q3 approval. Exact-tip checks, review/landing, sequencing and dispatch are coordinator work; rollout remains the later reserved operator action.

### Later
- A history list in ccrc's own chrome, for the plain view (the reader's menu is W8b's, inside the frame; the plain fallback then has no history).
- An immutable browser cache for a history answer at a fixed commit (today `no-store`, as every JSON docs answer).
- A newer ccd's seventh section: today a W5b server refuses a tree holding an entry in a section it does not know (`entryOk`), which is why every new section needs a server-first rollout; tolerating it (drop and count) would make the next one fleet-order-free.
- A `more` signal when exactly 100 entries came back and older ones exist.
- Export's provenance on a version view keeps its admitted-draft note in a ref view (true, but noise).
- Export's body links on a version page follow Share's rule (r) once the version read's `onRef` reaches Export's link table; until then refinement (t) writes them inert. The PR body says so.
- A version page's images and links judged against a listing at the version, not the served one (today an image deleted or renamed since shows `absent`, refinement (n)).
- The "four sections" prose this run leaves in files outside its scope (W7's prose pass).
