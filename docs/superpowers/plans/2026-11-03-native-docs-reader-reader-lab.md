# Native Docs reader, the reader lab — Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as TWO runs, RL-a (Tasks 1-5) and then RL-b (Tasks 6-12) (see "How this wave runs" below). Each worker executes its run with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 2 draft (2026-11-03), after review round 1; waiting on the operator's review and the seven questions under "Where things stand". Base `94bdcf45485c9cea22ce0563ef07a90a19fe9197` (`origin/main`, 2026-11-03T20:59:04Z). Every Find block below is quoted from that commit, except the RL-b Find blocks marked "(as RL-a leaves it)", which quote the text RL-a's merged diff writes. It replaces nothing.

**Revisions:** rev 2 (2026-11-03) applies review round 1 (twenty findings upheld, two refuted): a run's life is derived from the lab's own caps, now declared in `shared/readerLab.ts` and summed by a test (about eighteen minutes), and the run keeps its counts once they are complete (the hostile step moves before the Mermaid mounts, and the final read degrades); a run answers only the session that opened it, through a one-way digest of the session cookie; the door is named for what it is, a permanent surface on every box that is inert until a session opens a run; the gate's origin-check note names the probe, and the armed box's foreign-origin journal line is asserted, not silenced; the uniform-answer test covers expired and saturated runs and an armed POST from origin `null`; the busy frame is a fact (shared thread or own thread) that gates nothing; the Mermaid line counts all six figures together and every mount that did not draw; `csp-27` needs M8.B1's control floor and a ready library mount; a teardown-signal line splits from the self-navigation wall; the gap window has a mode for the library change; the block carries the device's feature facts, a draw-on-open reading and the door's session-cookie class; a silent top-navigation block is refinement (u); the browser case reads headers with `allHeaders()` and leaves the preflight to a server test; Task 1 runs the single-definition directory; the browser time is reported per file.

**Scope:**
- In, RL-a (the door): `shared/readerLab.ts` (the vocabulary); `server/src/readerLab/runs.ts` (the run store) and `server/src/readerLab/routes.ts` (the counter hook and the five routes); their wiring in `server/src/server.ts`; two `EXEMPT` entries and reason 8 in `server/src/auth/gate.ts`; the census edits in `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` and `server/test/rings/fastify-l4.data.ts`; one row of the architecture spec's context table; one README sentence; three new server test files.
- In, RL-b (the page): `pwa/src/readerLab/` (the battery source, the frame scripts, the frame builder, the fixtures, the check list, the verdicts, the device line, the result block, the page's words, the run, a stylesheet); `pwa/src/docs/reader/labPolicy.ts` (the wall frame's policy); `pwa/src/lib/frameGap.ts` (R19's stall measure, moved); `pwa/src/screens/ReaderLab.tsx` and its route, ladder rung and palette door; `api.readerLab` in `pwa/src/lib/api.ts`; the `lab-draw` mount profile in `pwa/src/docs/reader/policy.ts`, `bridge.ts` and `pwa/src/lib/readerLimits.ts`; the desktop battery on the shared list in `pwa/browser/reader-frame.browser.test.ts`; the PWA cell of the same context-table row; six new PWA test files, one new browser test file, and edits to `reader-bridge.test.ts`, `app.test.tsx` and `command-registry.test.ts`.
- Out: the shared library's change that draws Mermaid after `ready` (it flips `LAB_GAP_WINDOW` in its own change); W8b (the version menu, "changes since") and every item of W8a's residue; W5b; a Settings index row (question Q7); any CI change: a `FILE_MS` entry for the lab's browser file in `pwa/browser/slowFirst.ts`, with the matching `pwa/test/browser-leg.test.ts` census, is a separate change that Task 11 Step 4's measured figure informs, and Playwright WebKit and Firefox proxies are the design's Later; the phone runs themselves, which are the operator's after rollout.

**Goal:** The operator opens Settings › Reader lab on a phone, taps Start, taps once inside one frame when the page asks, and typically about two minutes later selects a result block that says, for that engine, whether each of the reader frame's seven walls holds and whether a blocked navigation gives the teardown signal (E18), and whether the console stays live while the reader draws Mermaid on open, beside the fact of whether a busy frame shares the console's thread (E17). Today those labs have never run on a phone: every wall was measured on desktop Chromium through Playwright, which a phone does not have.

**Architecture:** RL-a adds a measurement door to the server, present on every box and inert until a signed-in session opens a run. A session opens a run (`POST /api/reader-lab/runs`) and is handed a 128-bit nonce the server mints; the run is bound to that session by a one-way digest of its cookie, never the cookie. For at most a life derived from the lab's own caps (about eighteen minutes; a run takes about two), a counter hook added immediately before the session gate counts each request to `/api/reader-lab/probe/<nonce>/<name>` by name, keeping only classes (the session cookie present by name or not, `Sec-Fetch-Site`, `Origin`, upgrade or not); the probe route itself is `EXEMPT` (a permanent reason 8) and answers every request one empty `204`. Only the opening session reads its counts back (`GET …/runs/:nonce`) and closes the run; any other gets the unknown-nonce answer. RL-b adds the page. It builds frames of the reader frame's shape (`sandbox="allow-scripts"`, `srcdoc`, `no-referrer`) whose constant scripts report only by requesting probe URLs; one "wall" frame runs the 27-channel battery under the shared library's own `frameCsp()` plus its script nonce and one canary URL; it mounts the production reader under a new `lab-draw` profile to time Mermaid and to expose it to hostile figures and stray messages; and it turns the counts and its own observations into three-outcome lines and a versioned text block. Every arrival that decides a verdict is read by step 7, before the Mermaid mounts, so a run whose life runs out later keeps its counts. No frame gets a port and the console adds no message listener: the door is the only channel out of a frame.

**Tech Stack:** TypeScript (server's own `tsc`, pwa's own `tsc`), Fastify 5 with `@fastify/websocket` 11 (`request.ws`, `injectWS`), vitest 5 (server on node, pwa on jsdom, the browser leg through `playwright-core`), React 19 with `@ccrc/ui`'s `PageScaffold` and `Button`, the shared Markdown library's `./frame` (`frameCsp`, `FRAME_MANIFEST`), `node:crypto` (`randomBytes`). Node `>=22.16.0`.

**Ruling:** the operator's ruling of 2026-11-03 on the static mockup on the branch `brainstorm/reader-lab`: "Build it: plan a wave for the lab page", as its own wave, with W8b (the version menu and "changes since") staying after W5b. The design is `docs/superpowers/specs/2026-11-03-reader-lab-design.md`, a spec amendment draft whose section 9 lists every rich-docs spec sentence this wave changes; refinements (a) to (t) below say which of them each task applies.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md` (a new Waves row "RL reader lab"; the coordinator's ledger PR records this plan and the operator's answers).

**Format:** Markdown. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Tasks 5 and 12's tools parse this file's `### Task` headings and the JSON row fences each task records.

**What the base says (each checked at BASE, each handled below):**
- **R19's page is the shape to copy.** `pwa/src/lib/routes.ts` holds the row `measure-highlighting` (`/settings/measure-highlighting`, `top: false`); `pwa/src/app.tsx`'s ladder renders `<HighlightMeasure />` for it; `pwa/src/command/commands.ts#GO_TO` derives "Go to Settings › Measure highlighting" from any row whose path sits under a top row; `pwa/test/app.test.tsx` and `pwa/test/command-registry.test.ts` pin the row, the probe and the palette order; `pwa/test/docs-scans.test.ts`'s clause M7.12 scans R19's two modules for storage, clipboard, `fetch` and non-`docs` `api` reads. The Settings index has no row for R19's page. Refinements (p), (r).
- **The reader frame cannot run a lab's code.** The library's `mountDocFrame` verifies every asset text against its manifest before it inlines anything (`pwa/src/docs/reader/assets.ts`' header), and `frameCsp()` (`./frame`, no arguments) allows exactly the library's four script hashes. W8a's desktop rows evaluate the battery in the frame through Playwright (`pwa/browser/reader-frame.browser.test.ts`, `CHANNELS` and `batterySource`), outside both policies, against loopback origins A and B (`pwa/browser/harness.ts#startOrigins`). Refinements (h), (i).
- **The gate.** `server/src/auth/gate.ts`: one `onRequest` hook (`installGate`), keyed on the MATCHED route (`request.routeOptions.url`); `EXEMPT` is keyed by method and path, with "THE SEVEN REASONS"; `needsOriginCheck` checks every WebSocket upgrade and every non-exempt write, and an opaque frame's `Origin: null` is a mismatch (`403 foreign-origin`, a bare `403` on an upgrade); `@fastify/websocket` routes an upgrade through Fastify routing as a GET with `request.ws === true`. `server/src/server.ts#buildServer` calls `installGate` before it registers almost every route, and registers the docs plugin later. `sessionVerdict` is not needed: the door keeps only whether the cookie `SESSION_COOKIE` (`ccrc_session`, `SameSite=Lax`, `server/src/auth/cookie.ts`) was present by name, through `parseCookies`, and, as a run's owner, a one-way digest of its value (the token is stable for a session's life: nothing on the server rotates it). The gate's `needsOriginCheck` skips every exempt route, and its note argues that from `curl` callers only; on an armed box a mismatched origin is refused with a `console.warn('ccrc-server: refused a … from a foreign origin …')` journal line. Refinements (b), (c), (d), (e).
- **The route census.** `server/test/auth-gate.test.ts` scans `app.get('…'`-style literals from NINE files (`ROUTES`) and holds them equal to Fastify's own table both ways; it pins `ROUTES.length` 170, per-file counts, the exact `EXEMPT` key list ("exempts exactly the seven classes"), and three numeral sentences against what it derives (the property loop's 167 HTTP routes, the third probe's 167 and 64 exempt, `gate.ts`'s "stands in front of all 167 routes", and "170 scanned + the static wildcard"). `server/test/box-token-census.test.ts` reads named route files for box-token calls and README's auth paragraph for number WORDS in sequence (two to fifty-eight). `server/test/rings/fastify-l4.data.ts` lists every file that imports `fastify`. `server/test/rings/totality.test.ts` gives every file under `server/src` and `pwa/src` a context from the architecture spec's `ring-context-map` table, whose C9 Docs row reads `docs/**` for the server and `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` for the PWA. Refinement (b).
- **Route errors.** A route-level `errorHandler` sees Fastify's own body refusals (413, 415, a parse 400) before the handler (`server/src/token/routes.ts`'s claim door uses one). Refinement (f).
- **The reader's mount.** `pwa/src/docs/reader/bridge.ts#mountReader` hands the library `mermaidDraw: 'on-request'`, `watchdogMs: readerWatchdogMs(bytes)` and the storage port; `pwa/src/docs/ReaderFrame.tsx` exports `lazyMountReader`, the one path to the bridge and the assets (M8.10's main-bundle rule); `pwa/src/screens/DocsScreen.tsx` renders through `docsRunner.render`. The library's `mermaidDraw` takes `'auto'` (its default) or `'on-request'`, and `watchdogMs` an integer up to 120 000. Refinement (k).
- **The source scans of W8a.** `pwa/test/docs-scans.test.ts`'s clause W8a: library specifiers have homes (`/frame` anywhere under `docs/reader/`); under `pwa/src/docs` no `postMessage`, `MessageChannel`, `onmessage`, `iframe`, `srcdoc` or `default-src 'none'` (Export's two allowances aside); across `pwa/src` no `message` listener. Nothing scans `srcdoc` outside `pwa/src/docs`, and no file in `pwa/src` holds a sandbox token today. Refinements (h), (p).
- **R19's stall measure is private.** `pwa/src/screens/highlightMeasureRun.tsx#longestGap` (animation-frame gaps while a promise runs, then `round`). Refinement (j).
- **The funnel.** `pwa/src/lib/api.ts#createApi`'s `request` raises the login overlay on a 401 and throws `ApiError` (`status`) otherwise; a POST to an unknown `/api` path answers `404 {ok:false, error:'not-found'}` through `server.ts`'s not-found handler. Refinement (s).

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). No test reaches a network or a real server; every server case runs on `app.inject` or `app.injectWS`; the browser leg serves the built PWA from loopback and answers `/api` from fixtures.
- **FIXTURE HOME.** No task runs `ccd`. A guard suite that drives `ccd` runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. Each run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); neither run changes a lock or a `package.json`. Nothing builds into `server/dist-pwa` in the workspace (`auth-gate.test.ts` changes what it asserts when that bundle exists); the browser leg builds into its own temporary directory as it always does. Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/rlb-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/rlb-mut/` is removed at Tasks 5 and 12.
- **Scope.** RL-a creates `shared/readerLab.ts`, `server/src/readerLab/runs.ts`, `server/src/readerLab/routes.ts`, `server/test/reader-lab-vocabulary.test.ts`, `server/test/reader-lab-runs.test.ts` and `server/test/reader-lab-routes.test.ts`; it edits `server/src/server.ts` (two import lines, one block before `installGate`, one registration line), `server/src/auth/gate.ts` (its first line's count, "THE EIGHT REASONS", reason 8, two `EXEMPT` entries), `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` (one appended describe), `server/test/rings/fastify-l4.data.ts` (one entry), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C9 row's server cell), `README.md` (one sentence) and this plan. RL-b creates the files File Structure lists under Tasks 6-11 and edits `pwa/src/lib/readerLimits.ts`, `pwa/src/docs/reader/policy.ts`, `pwa/src/docs/reader/bridge.ts`, `pwa/src/screens/highlightMeasureRun.tsx`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`, `pwa/src/lib/api.ts`, `pwa/browser/reader-frame.browser.test.ts`, `pwa/test/reader-bridge.test.ts` (one appended describe), `pwa/test/app.test.tsx`, `pwa/test/command-registry.test.ts`, the same context-table row's PWA cell, and this plan. Byte-identical in both runs: every other file, and in particular `shared/docs.ts`, `shared/api.ts`, every other file under `server/src/**` and `pwa/src/**`, `agent/**`, `ccd/**`, `deploy/**`, `install.sh`, `.github/**`, `ui/**`, `pwa/index.html`, `pwa/vite.config.ts`, `pwa/vitest.browser.config.ts`, `pwa/browser/harness.ts`, `pwa/browser/app.ts`, `pwa/test/docs-scans.test.ts`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/screens/HighlightMeasure.tsx`, `CLAUDE.md`, every `package.json` and lock. Any other file is a stop-and-ask. One allowed exception, claimed first: if the CI selection or a close task's whole-suite run reds a census in another programme's file that this wave's new words or files trip, the worker stops and asks the coordinator, who rules on that file.
- **Base.** RL-a's child workspace is minted from `main` at or after `94bdcf45485c9cea22ce0563ef07a90a19fe9197`; RL-b's from `main` at or after RL-a's merge. Each task's Step 0 runs a **content** check, not an ancestry check (`T<n>-BASE-OK`), and the first task of each run records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-03-native-docs-reader-reader-lab/progress.md`.
- **Rings and seams.** `shared/readerLab.ts` is L0: it imports nothing. `server/src/readerLab/runs.ts` is L1 (imports only `shared/`; no `fs`, no timers, no fastify; the clock is a parameter). `server/src/readerLab/routes.ts` is L4 (fastify, `node:crypto`). `pwa/src/readerLab/checks.ts`, `device.ts`, `verdicts.ts`, `result.ts`, `labText.ts`, `battery.ts`, `frameScripts.ts` and `fixtures.ts` are L1 (no `.tsx`, store or `lib/api.ts` import); `pwa/src/docs/reader/labPolicy.ts` and `pwa/src/lib/frameGap.ts` are L1; `pwa/src/readerLab/frames.ts` and `run.ts` and `pwa/src/screens/ReaderLab.tsx` are L4. No overloaded `null`: every `null` in a new type has one stated meaning; the door's read answers a union, never a `null` body.
- **Exact values.** Declared once each. In `shared/readerLab.ts`: the 27 channels, the 40 fixed probe names, the six `Sec-Fetch-Site` classes and three `Origin` classes, `READER_LAB_RUNS_PATH = '/api/reader-lab/runs'`, `READER_LAB_PROBE_ROUTE = '/api/reader-lab/probe/:nonce/:name'`, the nonce shape (22 base64url characters). Also in `shared/readerLab.ts`, the run's own time caps, which the page waits by and the door derives a run's life from: `LAB_SETTLE_MS = 2000`, `LAB_BUSY_SPIN_MS = 3000`, `LAB_TAP_WAIT_MS = 30_000`, `LAB_MOUNT_WAIT_MS = 65_000`, `LAB_DRAW_SETTLE_MS = 10_000`, `LAB_STEPS = 9`, `LAB_MOUNTS = 10`, and their sum `LAB_RUN_CAPS_MS` (801 000 ms). In `server/src/readerLab/runs.ts`: `READER_LAB_RUN_SLACK_MS = 300_000`, `READER_LAB_RUN_TTL_MS = LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS` (1 101 000 ms, about eighteen minutes), `READER_LAB_RUNS_MAX = 4`, `READER_LAB_RUN_HITS_MAX = 1024`. In `server/src/readerLab/routes.ts`: `READER_LAB_PROBE_BODY_MAX = 1024`, `LAB_NO_SESSION = '-'`. In `pwa/src/lib/readerLimits.ts`: `READER_LAB_DRAW_WATCHDOG_MS = 60000`. In `pwa/src/readerLab/run.ts`: `LAB_WATCHDOG_PROBE_MS = 500`, `LAB_TAP_READ_EVERY_MS = 1000`, `LAB_STALL_BUDGET_MS = 200` (question Q2), `LAB_GAP_WINDOW = 'ready'`. In `pwa/src/readerLab/verdicts.ts`: `LAB_CONTROL_FLOOR = 20` (M8.B1). In `pwa/src/readerLab/frames.ts`: `LAB_SANDBOX = 'allow-scripts'`. In `pwa/src/readerLab/result.ts`: `LAB_RESULT_FORMAT = 1`.
- **Never spelled by this wave:** the shared Markdown library's package or directory name, anywhere in `pwa/src` except as an import specifier in `docs/reader/labPolicy.ts` (M7.9; write "the shared Markdown library" in comments); a `docs/` path literal in `pwa/vite.config.ts` (untouched); a six-digit hex colour in any new or edited pwa file (`contrast.test.ts`); real host, user, project, account or path names (fixtures use `demo`, `https://box.example`, `project-a`); a numeric line citation (`file.ts` + colon + line) in any code or test file (`citations.test.ts`; cite `file#symbol`); a `D-` number outside `## Deviations found`; a placeholder deviation token in any commit (`server/test/dtbd.test.ts`); a number WORD from two upwards inside README's auth paragraph (box-token census).
- **PUBLIC REPO.** This repository is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or tracker links. Refer to other ccrc work by its GitHub `#n`. Each close task scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block below must match exactly once in the file it names, at the run's BASE; if it is absent or matches twice, stop and ask the coordinator. Cite code by `file#symbol`, never by line number.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and **one JSON fence** (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`), which the worker records in the SDD ledger at the task's last step as measured; each close task copies its run's fences into `## Results`, runs that run's table at its end state and keeps the LAST occurrence of each id. Ids are `RLB-T<n>-M<k>`; `spec` carries the refinement letter and the M10 row the row guards. A row's `old` and `new` quote the file's own text from its first non-blank character; an empty `new` deletes the line. **Every count in this plan (a row's red, a file's case count, a size, a time) is a prediction.** A row whose measured red differs from its stated red is reported to the coordinator with the extra test names; the coordinator restates it, which takes no number. A row that stays green is a stop-and-ask.
- **Test commands.** `( cd server && ./node_modules/.bin/vitest run test/<file> )` and `( cd pwa && ./node_modules/.bin/vitest run test/<file> )`; the browser leg `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, the browser leg, the built-output files, mutation runs) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `typecheck-tests`, `session-hook`, `ccd-*`, `contrast.test.ts`' spawned-gate cases. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. Typecheck: `( cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && echo SERVER-TSC-OK )` and `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`.
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter. Refinements (a), (b), (c), (h), (i), (k), (m) and (u) depart from a spec sentence (each says which); the rest fill silences. Numbers are ISSUED by `POST /api/ledger/deviations` at each run's opening, never looked up; each close task defines the ones its run used in `## Deviations found`. An issued number that goes unused is written without its prefix ("Issued and unused: 7xxx to 7yyy"). A session that cannot reach the allocator says so in its report (worker clause 11) and writes no placeholder token in any commit.
- **Commits.** One per task (review fixes one per finding), files staged by name, message `<area>: <what> (docs reader lab)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Tasks 5 and 12 push, and each opens its run's ONE pull request.

## How this wave runs (coordinator)

- **The plan and the design reach `main` before RL-a opens**, through the programme's ledger PR, which records the plan in the ledger's Plans line, adds the Waves row "RL reader lab (RL-a door, RL-b page)", and records the operator's answers to Q1-Q7. The rich-docs spec's amendments (the design's section 9) are written into that spec in place by the same PR, each marked "(amended 2026-11-03; reader lab)".
- **Two runs, in order (refinement (a), question Q1).** RL-a (Tasks 1-5) is a server-only PR: the door is the one part that needs a security review, and it is reviewed alone. RL-b (Tasks 6-12) is a PWA PR minted from `main` after RL-a merges, because it reads the door's wire (`shared/readerLab.ts`) and its Find blocks quote the context-table row as RL-a leaves it. If the operator answers Q1 "one run", the coordinator dispatches Tasks 1-12 as one run with Task 5 Steps 6-8 (push, PR, wave-done) moved to Task 12 and Task 5's review folded into Task 12's; nothing else changes.
- **Each run's row and issued block.** One run row (`planned`) per run, each issued a small contiguous block by `POST /api/ledger/deviations` at its opening (four numbers for RL-a, whose refinements (a), (b), (c) depart; six for RL-b, whose (h), (i), (k), (m), (u) depart; the block's spare numbers are for departures found while executing and in a fix round). Each run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main`.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `server/src/server.ts`, `server/src/auth/gate.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`, `server/test/rings/fastify-l4.data.ts`, `README.md`, the architecture spec, `pwa/src/docs/reader/bridge.ts`, `pwa/src/docs/reader/policy.ts`, `pwa/src/lib/api.ts`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx`, `pwa/test/app.test.tsx`, `pwa/test/command-registry.test.ts`, `pwa/browser/reader-frame.browser.test.ts`. Known overlaps: W8b edits `bridge.ts` and the reader-frame browser file in other hunks; the census files take every new route's edits. Where a live claim of another run covers a file this wave edits, the brief names the coordinator's scoped agreement for it. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief per run (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, the run's task range, the base, the issued block, the claim state, `CCRC_CHROME` (RL-b), and the branch-discipline sentence (commit on the workspace branch, never a feature branch). **Routing:** Opus main loop; `sonnet` implementers at `medium` effort (`high` for Tasks 3, 6, 8 and 9); per-task reviewers **`opus` on every task of the door, Tasks 1 to 4** (the vocabulary and the caps, the store and its owner, the routes and the counter, the census), and `opus` on Task 6 (the frames, the wall policy and the reach of every frame), Task 8 (the verdict rules and their anti-vacuity signals) and Task 11 (the scans and the page in Chrome); `sonnet` per-task reviewers on Tasks 7, 9 and 10. Each close task's held-out whole-branch pass: RL-a on two `opus` lenses (the door's security contract; the census and the gate's text) and one `sonnet` lens (tests, rows, public-repo scan); RL-b on two `opus` lenses (the frames, the walls and what the lab never does; the verdicts and their anti-vacuity signals) and one `sonnet` lens (the page, the palette, the censuses, the browser leg's time); a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill, any `gh` write verb, any token in an argv, and approval-prompting shell forms.
- **Worker flow:** the worker acks, runs its tasks with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalation: a measured red outside its row's prediction, reported; a row that stays green, a stop-and-ask; a Step 0 that does not print its `OK`, a stop-and-ask; in Task 11, the lab's browser file's own measured time, reported in the wave-done when it is above about 120 s (CI runs the browser leg in two shards, each limited to 20 minutes and balanced by `pwa/browser/slowFirst.ts#FILE_MS`, where a file the table does not name is costed at the table's median; a `FILE_MS` entry and its `browser-leg.test.ts` census are a separate change, never this wave's).
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run per run, reading the branch at one measured tip in its own worktree, naming the lenses above. RL-a's report must answer, for each property of the design's section 4, "which test proves it, and does it go red without the guard", the run's binding to its opener and its life derived from the caps included.
- **Merge gate (each run):** the operator's approval of this plan; every row red as measured; the reviewer's report accepted by the coordinator; the PR's required checks green, and `browser (pwa)` green in the merge queue for RL-b (a fast PR skips it). Rollout order: RL-a is server-only and changes nothing until a run is opened, so it rolls like any server change; RL-b's page tells a server without the door "update the server" (refinement (s)), so either order is safe, and server first is the useful one.
- **After the merges, NOT in this wave:** the merge becomes a prerelease; the coordinator or operator rolls it out. The operator then opens Settings › Reader lab on each phone or browser they read on, runs it, and sends the block; the coordinator records each block in the programme ledger as E17 and E18 for that engine, and reads the `busy-frame` and `mermaid` lines into the plan of the library change that draws Mermaid after `ready`.

## Review Focus

| Input | What could go wrong | Pinned by |
|---|---|---|
| An unauthenticated request to the probe path, from anywhere | it learns something, changes state, reads a body, gets a CORS header, or opens, extends or closes a run | Task 3 (RLB-T3-M3 to M5), Task 2 (RLB-T2-M1 to M6) |
| The counter hook, before the gate | it answers, so a request skips the gate; it is added after the gate, so a refused upgrade goes uncounted | Task 3 (RLB-T3-M1, M2) |
| A session's run routes | exempt by mistake, so anyone opens runs or reads counts | Task 3 (RLB-T3-M6), Task 4 |
| Another signed-in session | reads, closes or learns of a run it did not open | Task 2 (RLB-T2-M7, M8), Task 3 (RLB-T3-M8) |
| A stolen nonce | it adds arrivals: it can force "does not hold", saturate a run so its count lines read "not measured", or send a check's positive signal (the canary, a `*-held` report, `cookie-ran`, `popup-ran`, `strays-sent`, `busy-start`/`busy-end`) so a frame that never ran reads "holds"; it cannot erase a real "broke" or a real arrival at a wall's target | the nonce's secrecy (128 bits, server-minted, only in the lab's own frames and their referrer-free probe URLs, readable only by the opening session, gone with the run), not the verdict rules; Task 8's `'a forged arrival cannot hide a real broke'` pins the one thing the rules do guarantee |
| A slow phone | its run's life runs out mid-run and the counts already read are lost | Task 1 (RLB-T1-M4: the caps' sum), Task 2 (RLB-T2-M9: the life derived from it), Task 9 (RLB-T9-M6: the final read keeps the last view) |
| The gate's foreign-origin journal line on an armed box | it fires for each frame's WebSocket upgrade and reads as an attack, or is silenced in a test so nobody knows | Task 3's armed upgrade case asserts it; the page says it is expected (Task 10, RLB-T10-M5) |
| A lab frame | carries a token beyond `allow-scripts`, reaches beyond the console's origin, carries a policy other than the stated one, sends a value it read | Task 6 (RLB-T6-M1 to M6), Task 11 (scans, browser) |
| A missing report, canary, control floor, ready library mount, drawn figure or tap | read as "holds" | Task 8 (RLB-T8-M1 to M3, M7 to M10, M13), Task 9 |
| The busy frame on a shared thread | reads as a defect, or a deliberate spin is made a gate condition no engine can meet | Task 8 (RLB-T8-M11) |
| The six figures together, or a figure that fell back | left out of the Mermaid verdict | Task 8 (RLB-T8-M5, M7, M8) |
| The `lab-draw` profile | reaches the Docs reader, or keeps a store under the lab | Task 7 (RLB-T7-M1, M2), Task 11 (scan) |
| The result block | carries a host, an origin, a nonce or the user agent into a public ledger | Task 8 (RLB-T8-M6) |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `shared/readerLab.ts` | 1 | L0 | the channels, the probe names, the classes, the nonce shape, the paths, the wire |
| `server/test/reader-lab-vocabulary.test.ts` | 1 | — | the vocabulary as data |
| `server/src/readerLab/runs.ts` | 2 | L1 | `createReaderLabRuns`, the bounds, the life derived from the caps, a run's owner, `labSiteClass`, `labOriginClass` |
| `server/test/reader-lab-runs.test.ts` | 2 | — | the life, expiry, eviction, saturation, the owner, classes, copies, the shape check |
| the architecture spec's `ring-context-map` C9 row | 2, 6, 10 | — | `readerLab/**` for the server (Task 2), `readerLab/**` (Task 6) and `screens/ReaderLab.tsx` (Task 10) for the PWA |
| `server/src/readerLab/routes.ts` | 3 | L4 | `installReaderLabCounter`, `registerReaderLabRoutes`, `labOwnerOf` |
| `server/src/server.ts` | 3 | L5-ish host | the counter before `installGate`; the routes after the docs plugin |
| `server/src/auth/gate.ts` | 3 | L4 | the probe pair in `EXEMPT`, reason 8, a sentence in `needsOriginCheck`'s note, the route count |
| `server/test/reader-lab-routes.test.ts` | 3 | — | the door through the real server, dark and armed: the uniform answer, the owner, the gate's line, the preflight |
| `server/test/auth-gate.test.ts`, `server/test/rings/fastify-l4.data.ts` | 3 | — | the route census, the fastify allowlist |
| `server/test/box-token-census.test.ts`, `README.md` | 4 | — | the lab surface's census; the auth paragraph |
| `pwa/src/readerLab/battery.ts` | 6 | L1 | the 27 channels as frame-side text, shared with the desktop leg |
| `pwa/src/readerLab/frameScripts.ts` | 6 | L1 | the seven frame scripts |
| `pwa/src/docs/reader/labPolicy.ts` | 6 | L1 | `labWallCsp`, `READER_LIBRARY_BUILD` |
| `pwa/src/readerLab/frames.ts` | 6 | L4 | `LAB_SANDBOX`, `labSrcdoc`, `mountLabFrame`: the one frame home outside the Docs reader |
| `pwa/test/reader-lab-frames.test.ts` | 6 | — | shape, data block, wall policy, reach, channels |
| `pwa/browser/reader-frame.browser.test.ts` | 6 | — | the desktop battery on the shared channel list |
| `pwa/src/lib/frameGap.ts` | 7 | L1 | `longestFrameGap` |
| `pwa/src/screens/highlightMeasureRun.tsx` | 7 | L4 | R19 calls the shared measure |
| `pwa/src/lib/readerLimits.ts`, `pwa/src/docs/reader/policy.ts`, `pwa/src/docs/reader/bridge.ts` | 7 | L1, L1, L3 | `READER_LAB_DRAW_WATCHDOG_MS`, `readerMountPlan`, the profile applied |
| `pwa/test/frame-gap.test.ts`, `pwa/test/reader-bridge.test.ts` | 7 | — | the measure; the profile |
| `pwa/src/readerLab/checks.ts`, `device.ts`, `verdicts.ts`, `result.ts` | 8 | L1 | the ten lines, the device line and its feature facts, the three-outcome rules and the draw-on-open reading, the block |
| `pwa/test/reader-lab-verdicts.test.ts` | 8 | — | every line's three outcomes; the reading; the block |
| `pwa/src/readerLab/fixtures.ts`, `labText.ts`, `wire.ts`, `run.ts` | 9 | L1, L1, L1, L4 | the figures and hostile page; the words; the door's read, checked; the run |
| `pwa/src/lib/api.ts` | 9 | K | `api.readerLab`: open, read, close, probe, through the funnel |
| `pwa/test/reader-lab-run.test.ts` | 9 | — | the run with a fake door, frames and mounts; a run lost late; the gap window |
| `pwa/src/screens/ReaderLab.tsx`, `pwa/src/readerLab/readerLab.css`, `pwa/src/lib/routes.ts`, `pwa/src/app.tsx` | 10 | L4 | the page, its stylesheet, its route and rung |
| `pwa/test/reader-lab-page.test.tsx`, `pwa/test/app.test.tsx`, `pwa/test/command-registry.test.ts` | 10 | — | the page's states and `api.readerLab`'s requests; the route and palette |
| `pwa/test/reader-lab-scans.test.ts` | 11 | — | what the lab never does, with planted controls |
| `pwa/browser/reader-lab.browser.test.ts` | 11 | — | the page in Chrome with a fake door |

## Refinements (decided while planning)

Each refinement says What, Why and Cost if wrong. (a), (b), (c), (h), (i), (k), (m) and (u) depart from a spec sentence, named in each; they take numbers at their run's opening.

- **(a) Its own wave, in two runs.** Departs from the rich-docs spec's M8.B7 and M8.B8 ("Manual: …") and from the mockup's "lands in W8b".
  - What: RL-a (the door) then RL-b (the page), after W8a, independent of W5b and W8b.
  - Why: the operator ruled its own wave; the door is the one part that needs a security review, and a server-only PR keeps that review on it alone.
  - Cost if wrong: one more PR and review than a single run; Q1 lets the operator merge them.
- **(b) The door: three session routes and an exempt probe pair, gate reason 8.** Departs from `gate.ts`'s "THE SEVEN REASONS, and there are only seven" and adds a route family the base spec's §3.4 does not list (design A25).
  - What: `POST /api/reader-lab/runs`, `GET /api/reader-lab/runs/:nonce`, `POST /api/reader-lab/runs/:nonce/close` (not `EXEMPT`); `GET` and `POST /api/reader-lab/probe/:nonce/:name` (`EXEMPT`, reason 8). Every path is a literal in `registerReaderLabRoutes`, so `auth-gate.test.ts`' scan reads it.
  - Why: a frame's request carries no session cookie by design (that is what is measured), so a gated probe would count nothing; the run routes are the operator's and stay gated. The door is a permanent surface on every box, inert until a session opens a run, so reason 8 is a permanent exemption, on publicly reachable boxes too (question Q5 asks whether a box setting should switch it instead).
  - Cost if wrong: an eighth exemption to argue in review; section 4 of the design is that argument.
- **(c) The counter is an `onRequest` hook added immediately before the gate's.** Departs from nothing written, but changes the gate's position as the first `onRequest` hook of the root (design A25, question Q4).
  - What: `installReaderLabCounter(app, runs)` sits just above `installGate(app, …)` in `buildServer`. It acts only when `request.routeOptions.url` is the probe route, counts, and returns; it never answers, never reads a body, never awaits.
  - Why: an opaque frame's WebSocket upgrade carries `Origin: null`, which the gate refuses with `403` before any route handler, and `@fastify/websocket` would hand an upgrade on a non-WebSocket route to its own no-handler path anyway. Counting in the handler would leave the WebSocket channel unmeasured on every box.
  - Cost if wrong: the WebSocket channel reads "not measured"; moving the count into the handler is one function.
- **(d) The bounds: a life derived from the lab's own caps, four runs, 1024 counts, a run bound to its opener, always registered** (question Q5).
  - What: `READER_LAB_RUN_TTL_MS` is `LAB_RUN_CAPS_MS` (the 30 s tap wait, a 2 s settle per step, the 3 s spin, and ten mounts at their 65 s cap and 10 s draw settle: 801 000 ms, about thirteen minutes) plus five minutes, about eighteen; a test sums the caps. A run on a working phone takes about two minutes and sends about 150 requests. A run is bound to the session that opened it by `routes.ts#labOwnerOf`, a sha256 of `reader-lab:` and the session cookie's value, never the value; any other session's read or close gets exactly the unknown-nonce answer. With no session cookie (a box with the gate dark) every caller is the one owner `-`, so there anyone who reaches the port and holds the nonce can read or close a run, as every route there. A fifth open evicts the oldest run, whoever opened it; that page then reads "start again". The door is registered on every box, inert until a run opens.
  - Why: the life must outlast the run's own worst case on the slow phones E17 exists to measure; the owner keeps one signed-in session from reading or closing another's run for the price of one digest.
  - Cost if wrong: a box setting is added later (Q5's option b), or a run's life is set by a measured figure instead of the caps.
- **(e) Classes only, memory only.** The counter keeps whether `ccrc_session` was present by name with a value, the `Sec-Fetch-Site` class, the `Origin` class and whether the request was an upgrade; never a value, a path beyond the name, a query, a body, an address or a user agent; a run keeps its owner's digest, never the cookie; nothing is written to disk, and the door logs nothing of its own. On an armed box the gate's own foreign-origin line fires for each frame's WebSocket upgrade (one or two per run); the gate keeps that alarm unchanged, Task 3's test asserts it, and the page says it is expected. Cost if wrong: a diagnosis needs a header the door did not keep; the lab is re-run with a richer class.
- **(f) One answer for every probe.** `204`, no body, `cache-control: no-store`, nothing else, by GET or POST, for a live, unknown, malformed, closed, expired or saturated run and an unknown name, an armed box's POST from origin `null` included (exempt, so it skips the origin check on purpose; the gate's `needsOriginCheck` note says so); a body Fastify refuses (413, 415, 400) still answers the same `204` through the route's `errorHandler`. `exposeHeadRoute: false` on both GETs. No route answers `OPTIONS`, so a preflight is never approved (the cookie check's marker). Cost if wrong: a probe could tell a live nonce from a dead one, which a 128-bit nonce makes worthless anyway.
- **(g) One vocabulary.** `shared/readerLab.ts` declares the channels (W8a's 27, in its order), the 40 fixed probe names, the classes, the paths and the wire; the server and the PWA import it, and RL-b's desktop browser battery reads its channel list from it. Each union has its `Record<…, true>` map (`wire-totality.test.ts`). Cost if wrong: none to behaviour; a later name is one entry.
- **(h) The lab's frames have one home, outside the Docs reader.** Departs from the rich-docs spec's A2b ("`<iframe` and `srcDoc` only in `MockupFrame.tsx` and `docs/export/buildExport.tsx`").
  - What: `pwa/src/readerLab/frames.ts` builds every lab frame: `sandbox="allow-scripts"` and nothing else, `srcdoc`, `referrerpolicy="no-referrer"`, a JSON data block just before one constant script. No other file outside `pwa/src/docs` names `srcdoc` or an `iframe`, and no file in `pwa/src` holds another sandbox token (Task 11's scans).
  - Why: on a phone, a frame of the reader frame's shape running the lab's own script is the only way to exercise the walls (the reader frame's scripts are hash-locked).
  - Cost if wrong: a reviewer wants the frames under `pwa/src/docs`; that needs the W8a clause's `docs:` rules widened by one more allowance.
- **(i) The wall frame's policy is the library's, plus two sources.** Departs from E18's "re-run … the M8.B1 battery" in the production frame, and adds a file under `docs/reader/` that the rich-docs spec's A17 list does not name (question Q3).
  - What: `pwa/src/docs/reader/labPolicy.ts#labWallCsp(nonceSource, canary)` returns `frameCsp()` with `'nonce-<n>'` appended to `script-src` and the canary URL to `img-src`, and refuses anything that is not one such source; it lives under `docs/reader/` because that is `./frame`'s one home (M8.10). The real library is checked separately: Task 9 mounts it on two hostile figures aimed at the door.
  - Why: the nonce lets the battery's own inline script run; the canary is the positive signal that it ran, since a battery that never ran reaches nothing too.
  - Cost if wrong: an engine that matched CSP paths loosely would show a channel as reached: a false alarm, never a false pass.
- **(j) One stall measure.** R19's private `longestGap` becomes `pwa/src/lib/frameGap.ts#longestFrameGap`, which R19's module calls (rounding stays in R19); the lab uses the same function. Consolidation, not a departure: R19's behaviour is unchanged and `highlight-measure.test.tsx` is its characterization. Cost if wrong: none to R19; the mockup's 50 ms interval heartbeat is not built.
- **(k) The `lab-draw` mount profile.** Departs from the W8a plan's refinement (c) and the rich-docs spec's §4.6 `reader-mermaid-on-tap` as the only draw mode, for the lab's own mounts only.
  - What: `ReaderMountInput` gains `profile?: 'lab-draw'`; `pwa/src/docs/reader/policy.ts#readerMountPlan` maps it to `{draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false}` and no profile to `{draw: 'on-request', watchdogMs: readerWatchdogMs(bytes), store: true}`; `bridge.ts` applies the plan. `ReaderFrame.tsx` is byte-identical, so the Docs reader passes no profile.
  - Why: E17's Mermaid figure needs the real library drawing on open; 60 s lets a slow phone's draw be timed rather than cut off; no storage port keeps the lab from storing anything.
  - Cost if wrong: the profile could leak into the Docs reader; Task 11's scan allows `'lab-draw'` only in `policy.ts`, `bridge.ts` (its type) and `run.ts`.
- **(l) Three outcomes, each with its positive signal.** Every check needs a frame's own report, the control and its floor, the canary, the tap or a mount that reached `ready` before it can hold; a missing signal is "not measured", never "holds"; any arrival on a wall's target is "does not hold". A saturated run makes every count-based line "not measured". Three lines are shaped by what they measure:
  - `busy-frame` is a fact, `shared thread` or `own thread` (or not measured), with the gap and how late the watchdog's stand-in timer fired; it steers the Mermaid policy and gates nothing, because a deliberate 3 s spin on a shared thread can meet no budget;
  - `self-nav-teardown` holds when a blocked self-navigation fires a second `load` (the signal that closes the reader's port) and otherwise reads `differs from desktop`, a miss E18 investigates, never a broken wall; the `no-self-navigate` wall is the door's silence alone;
  - `mermaid` counts every figure mount, the six together (`all`) included, and a mount that fell back or timed out counts its gap: over the budget it does not hold; within it, a mount that did not draw makes the line "not measured", naming it.
  `csp-27` needs M8.B1's control floor (`LAB_CONTROL_FLOOR`, 20 of the 26 channels a srcdoc frame can reach; `iframe` is left out because the shell's `frame-src 'none'` stops it) and the library's hostile mount ready; otherwise it is "not measured". The no-cookie line counts toward the retirement gate only on a run against an armed box, which the block's door line names (`session cookie sent`); on a dark box it reads "not measured" here and "not applicable" at the gate (READER_CSP is the wall there). Cost if wrong: a check reads "not measured" on a slow phone; the operator runs it again.
- **(m) The popup check needs one tap.** Departs from E18's and M8.B4's scripted form (question Q6). The popup frame shows one button; the operator's tap is the user activation, so a browser's popup blocker cannot answer for the sandbox. With no tap within 30 s the check reads "not measured". Cost if wrong: one more instruction on the page.
- **(n) The result block, version 1.** Fixed keys, each line's words, a `reader-lab 1` first line with device classes only (engine and major version, OS class, cores, whether the browser has a Worker, the iframe `sandbox` attribute and the iframe `csp` attribute, and the library build's first twelve hex digits; the mockup's "srcdoc sandbox" is said as "frame sandbox", because Task 11's rule 2 reads the word `srcdoc` in any string outside the frame home, and the lab's own sandboxed srcdoc frames running is the stronger proof anyway); the E18 summary with the teardown signal; a `draw on open:` line that reads the busy frame's fact and the Mermaid line together into what the ruled draw-on-open needs on this engine (the mockup's verdict line, reworded for the ruling); a door line that names whether the console's own request carried the session cookie and whether the final read found the run gone. Never the user agent string, a device model, a host, an origin or a nonce. Cost if wrong: a later field is additive under the same version.
- **(o) Fixtures built into the page.** Six figures with the node and edge counts of the path-identity spec's six figures, relabelled with neutral words; a page with no figure; a page with one trivial figure; the six together; and W8a's two hostile figures rebuilt with the door's URLs as their targets. Cost if wrong: the figures are not the operator's real page; the "all" mount stands in for it.
- **(p) The page measures and nothing else.** Its code loads through one literal dynamic `import('../readerLab/run')`; its modules name no storage, no clipboard, no `fetch` of their own, no foreign URL, no `postMessage` and no `MessageChannel`, and read `api` only as `api.readerLab`. Cost if wrong: none to behaviour.
- **(q) The stall budget is 200 ms** for the Mermaid line (question Q2), the responsiveness line browsers use for a tap; the busy frame is a fact and has none. Cost if wrong: the verdict word moves; the numbers in the block stay.
- **(r) No Settings index row**, as for R19 (question Q7): the palette's "Go to Settings › Reader lab" and the URL. Cost if wrong: one row in `SettingsIndex.tsx` later.
- **(s) An older door fails the run clearly; a run lost late keeps its counts.** The run's door adapter answers `unreadable` when `readerLab/wire.ts#readLabRunView` finds the server's answer lacking any probe name of the page's vocabulary or a count, and `no-door` when the open answers `404`; the first read happens before any frame. The page then says "This server's lab door is older than this page; update the server." The hostile step (7) runs before the Mermaid mounts (8), so every arrival that decides a verdict is read by step 7, and every read up to there fails the run on `unknown-run` or `unreadable`; the final read (9) that finds the run gone or unreadable keeps the last view, and the door line says so. Cost if wrong: none; additive names keep both sides compatible once both are updated.
- **(t) The tap wait reads the door once a second, at most 30 times.** It is a bounded wait inside one measurement step, not a page poll, so it uses no `setInterval` and no `usePoll` (the census-w7 request-poll rule's subject is a page that keeps a view fresh). Cost if wrong: the census's next widening names it; it then moves behind `usePoll` with its bound.
- **(u) A silent top-navigation block holds.** Departs from the rich-docs spec's M8.B4 ("`top.location=` throws") and the design's §3.2 row as rev 1 wrote it.
  - What: the popup check holds when the frame's `top.location` write returned without an error while nothing reached its target, with the detail "top navigation blocked without an error"; a write that neither threw nor returned (no report) is "not measured".
  - Why: the wall is that the console stayed where it was, which the door's silence shows; an engine that blocks quietly keeps the console as safe as one that throws, and the detail keeps the difference visible to whoever reads E18.
  - Cost if wrong: an engine that blocks quietly reads "holds" where the literal M8.B4 reading wants a miss; the detail names it, so the coordinator can re-read that block.
- **(v) The gap window has a mode.** `run.ts#LAB_GAP_WINDOW` is `'ready'` for library 1.0.0, whose `ready` waits for its figures, so a mount's window from its start to `ready` holds the script's compile and the figure's draw. `'ready-and-settle'` runs the window `LAB_DRAW_SETTLE_MS` (10 s) past `ready`, for the library change that draws after `ready`; that change flips the constant in its own change (or ends the window at a drawn signal of its own). Cost if wrong: a draw slower than 10 s past `ready` escapes the window.

### Task 1: The vocabulary and the run's caps (refinements (g), (d); M10.1, M10.6)

**Run:** RL-a. **Model routing:** `sonnet`, effort `medium`; per-task reviewer `opus` (the door's wire).

**Files:**
- Create: `shared/readerLab.ts`, `server/test/reader-lab-vocabulary.test.ts`.
- Guards (not edited): `server/test/rings/wire-totality.test.ts`, `server/test/rings/shared-imports.test.ts`, every file under `server/test/single-definition/` and `server/test/single-definition-pin.test.ts` (the census is a directory now; there is no `single-definition.test.ts`), `server/test/citations.test.ts`.

**Interfaces:** Produces `LabBatteryChannel`, `LAB_BATTERY_CHANNELS`, `LabFixedProbe`, `LAB_FIXED_PROBES`, `LabProbeName`, `LAB_PROBE_NAMES`, `isLabProbeName`, `isLabNonce`, `LabSiteClass`, `LAB_SITE_CLASSES`, `LabOriginClass`, `LAB_ORIGIN_CLASSES`, `READER_LAB_RUNS_PATH`, `READER_LAB_PROBE_ROUTE`, `readerLabRunPath`, `readerLabClosePath`, `readerLabProbeBase`, `readerLabProbePath`, the run's caps `LAB_SETTLE_MS`, `LAB_BUSY_SPIN_MS`, `LAB_TAP_WAIT_MS`, `LAB_MOUNT_WAIT_MS`, `LAB_DRAW_SETTLE_MS`, `LAB_STEPS`, `LAB_MOUNTS` and their sum `LAB_RUN_CAPS_MS`, `LabProbeTally`, `LabRunView`, `LabOpenAnswer`, `LabReadAnswer`, `LabCloseAnswer`.

**Decisions:** (1) Every union has a sibling `Record<…, true>` map typed as a variable, and its list is `Object.keys(map) as X[]` (the `wire-totality` idiom). (2) The probe names are lower-case words joined by hyphens, at most 40 characters, so a name is safe in a URL path and inside a CSP source. (3) `LabRunView.probes` names every probe of the vocabulary, zeros included: absence never stands for zero (no overloaded absence). (4) The run's time caps live here, in L0, because both sides need them: the page waits by them and the door derives a run's life from their sum (refinement (d)); one declaration, so the two can never disagree.

- [ ] **Step 0: Base.** Run:
  `test ! -e shared/readerLab.ts && test ! -e server/src/readerLab && ! git grep -q "reader-lab" HEAD -- server/src shared pwa/src && git grep -qF "const CHANNELS = [" HEAD -- pwa/browser/reader-frame.browser.test.ts && git grep -qF "const PR_REASON_MAP: Record<PrReason, true> = {" HEAD -- shared/api.ts && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Record BASE (`git rev-parse HEAD`) in the SDD ledger.
- [ ] **Step 1: Write the failing test,** `server/test/reader-lab-vocabulary.test.ts`, with exactly this content:

```ts
// The reader lab's vocabulary (native Docs reader, the reader lab plan of 2026-11-03, Task 1; the rich-docs spec's row
// M10.1): `shared/readerLab.ts` read as data. The probe names are a closed list whose every name is safe in a URL path
// and in a CSP source; the battery is W8a's 27 channels in their order; a nonce is 16 bytes of base64url; the paths are
// built from one root; the run's own time caps sum to the figure the door's run life is derived from.
import { describe, expect, it } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_FIXED_PROBES, LAB_MOUNTS, LAB_MOUNT_WAIT_MS,
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_RUN_CAPS_MS, LAB_SETTLE_MS, LAB_SITE_CLASSES, LAB_STEPS, LAB_TAP_WAIT_MS,
  READER_LAB_PROBE_ROUTE, READER_LAB_RUNS_PATH, isLabNonce, isLabProbeName, readerLabClosePath, readerLabProbeBase,
  readerLabProbePath, readerLabRunPath,
} from '../../shared/readerLab.js';

describe('the reader lab vocabulary (reader lab plan, Task 1)', () => {
  it('the battery is the desktop battery\'s 27 channels, in its order', () => {
    expect(LAB_BATTERY_CHANNELS).toEqual([
      'fetch-cors', 'fetch-nocors', 'fetch-credentials', 'fetch-post', 'fetch-keepalive', 'xhr-get', 'xhr-post', 'beacon',
      'websocket', 'eventsource', 'image', 'image-srcset', 'script', 'script-module', 'link-stylesheet', 'link-prefetch',
      'link-preload', 'link-modulepreload', 'style-import', 'css-background', 'css-font-face', 'css-content-url', 'audio',
      'video', 'svg-image', 'import-dynamic', 'iframe',
    ]);
  });

  it('the probe names are the 40 fixed probes, then a wall and a control name per channel, each once', () => {
    expect(LAB_FIXED_PROBES).toHaveLength(40);
    expect(LAB_PROBE_NAMES).toEqual([
      ...LAB_FIXED_PROBES,
      ...LAB_BATTERY_CHANNELS.map((c) => `csp-${c}`),
      ...LAB_BATTERY_CHANNELS.map((c) => `ctl-${c}`),
    ]);
    expect(new Set(LAB_PROBE_NAMES).size).toBe(94);
  });

  it('every name is lower-case words joined by hyphens, at most 40 long: safe in a path and in a CSP source', () => {
    for (const n of LAB_PROBE_NAMES) {
      expect(n, n).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(n.length, n).toBeLessThanOrEqual(40);
    }
  });

  it('isLabProbeName is membership in the list and nothing more', () => {
    for (const n of LAB_PROBE_NAMES) expect(isLabProbeName(n), n).toBe(true);
    for (const n of ['', 'csp-', 'csp-nope', 'ambient-parent', 'COOKIE-FETCH', 'cookie-fetch ', '__proto__', 'constructor', 'toString']) {
      expect(isLabProbeName(n), JSON.stringify(n)).toBe(false);
    }
  });

  it('a nonce is exactly 22 base64url characters, the length 16 random bytes make', () => {
    expect(Buffer.from(new Uint8Array(16)).toString('base64url')).toHaveLength(22);
    for (const n of ['AAAAAAAAAAAAAAAAAAAAAA', 'aZ09-_aZ09-_aZ09-_aZ09']) expect(isLabNonce(n), n).toBe(true);
    for (const n of ['', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}=`, `${'A'.repeat(21)}+`, `${'A'.repeat(21)}/`, `${'A'.repeat(21)}.`]) {
      expect(isLabNonce(n), n).toBe(false);
    }
  });

  it('the classes are closed lists', () => {
    expect(LAB_SITE_CLASSES).toEqual(['same-origin', 'same-site', 'cross-site', 'none', 'absent', 'other']);
    expect(LAB_ORIGIN_CLASSES).toEqual(['null', 'absent', 'present']);
  });

  it('the paths are built from one root, and the probe route is the probe base with its two parameters', () => {
    const n = 'AAAAAAAAAAAAAAAAAAAAAA';
    expect(READER_LAB_RUNS_PATH).toBe('/api/reader-lab/runs');
    expect(readerLabRunPath(n)).toBe(`/api/reader-lab/runs/${n}`);
    expect(readerLabClosePath(n)).toBe(`/api/reader-lab/runs/${n}/close`);
    expect(readerLabProbeBase(n)).toBe(`/api/reader-lab/probe/${n}/`);
    expect(readerLabProbePath(n, 'csp-canary')).toBe(`/api/reader-lab/probe/${n}/csp-canary`);
    expect(READER_LAB_PROBE_ROUTE).toBe(`${readerLabProbeBase(':nonce')}:name`);
  });

  it('the run\'s own caps, and their sum, from which the door derives a run\'s life: about thirteen minutes', () => {
    expect([LAB_TAP_WAIT_MS, LAB_SETTLE_MS, LAB_BUSY_SPIN_MS, LAB_MOUNT_WAIT_MS, LAB_DRAW_SETTLE_MS, LAB_STEPS, LAB_MOUNTS])
      .toEqual([30_000, 2000, 3000, 65_000, 10_000, 9, 10]);
    expect(LAB_RUN_CAPS_MS)
      .toBe(LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS));
    expect(LAB_RUN_CAPS_MS).toBe(801_000);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-vocabulary.test.ts )` — Expected (prediction): the file fails to load (`Cannot find module '../../shared/readerLab.js'` or `Failed to load url`), `Test Files  1 failed (1)`.
- [ ] **Step 3: Write `shared/readerLab.ts`** with exactly this content:

```ts
// The reader lab's vocabulary (native Docs reader, the reader lab plan of 2026-11-03, Task 1; the reader lab design,
// sections 3 and 4; the rich-docs spec's row M10.1): the door's paths, the closed list of probe names a lab run counts,
// the classes the door keeps of each request, and the wire of its three session-gated routes. L0: it imports nothing,
// so the server's door and the PWA's page read one copy.

/** The frame CSP battery's 27 channels (lab 1-2's list; rich-docs spec M8.B1), in the battery's order. The desktop
 *  browser leg and the reader lab run this one list (M10.16). */
export type LabBatteryChannel =
  | 'fetch-cors' | 'fetch-nocors' | 'fetch-credentials' | 'fetch-post' | 'fetch-keepalive' | 'xhr-get' | 'xhr-post'
  | 'beacon' | 'websocket' | 'eventsource' | 'image' | 'image-srcset' | 'script' | 'script-module' | 'link-stylesheet'
  | 'link-prefetch' | 'link-preload' | 'link-modulepreload' | 'style-import' | 'css-background' | 'css-font-face'
  | 'css-content-url' | 'audio' | 'video' | 'svg-image' | 'import-dynamic' | 'iframe';

const LAB_BATTERY_CHANNEL_MAP: Record<LabBatteryChannel, true> = {
  'fetch-cors': true, 'fetch-nocors': true, 'fetch-credentials': true, 'fetch-post': true, 'fetch-keepalive': true,
  'xhr-get': true, 'xhr-post': true, beacon: true, websocket: true, eventsource: true, image: true, 'image-srcset': true,
  script: true, 'script-module': true, 'link-stylesheet': true, 'link-prefetch': true, 'link-preload': true,
  'link-modulepreload': true, 'style-import': true, 'css-background': true, 'css-font-face': true,
  'css-content-url': true, audio: true, video: true, 'svg-image': true, 'import-dynamic': true, iframe: true,
};
export const LAB_BATTERY_CHANNELS = Object.keys(LAB_BATTERY_CHANNEL_MAP) as LabBatteryChannel[];

/** Every probe that is not a battery channel, by the check that sends it (the reader lab design, section 3.2):
 *  - `cookie-console` is the console's own request, the cookie check's control; `cookie-*` the frame's requests, and
 *    `cookie-ran` its sign that it ran;
 *  - `ambient-<key>-held` / `-broke`: the opaque-origin frame's report for each thing it tried to reach;
 *  - `csp-canary`: the wall frame's one allowed request, its sign that the battery ran;
 *  - `popup-open`, `popup-blank`, `top-nav`: targets that must never be reached; `popup-null`, `popup-window`,
 *    `top-read-*`, `top-write-*`: the frame's report; `popup-ran`: its sign that the tap happened;
 *  - `self-nav-tried`, then `self-nav`, the target the frame must not reach;
 *  - `busy-start`, `busy-end`: the busy frame's spin;
 *  - `strays-sent`: the stray frame's sign that it posted;
 *  - `hostile-img`, `hostile-click`: the hostile figures' targets, which must never be reached. */
export type LabFixedProbe =
  | 'cookie-console' | 'cookie-fetch' | 'cookie-fetch-marker' | 'cookie-xhr' | 'cookie-beacon' | 'cookie-websocket'
  | 'cookie-image' | 'cookie-ran'
  | 'ambient-parent-held' | 'ambient-parent-broke' | 'ambient-origin-held' | 'ambient-origin-broke'
  | 'ambient-cookie-held' | 'ambient-cookie-broke' | 'ambient-local-held' | 'ambient-local-broke'
  | 'ambient-session-held' | 'ambient-session-broke' | 'ambient-idb-held' | 'ambient-idb-broke'
  | 'ambient-caches-held' | 'ambient-caches-broke'
  | 'csp-canary'
  | 'popup-open' | 'popup-blank' | 'top-nav' | 'popup-null' | 'popup-window' | 'top-read-held' | 'top-read-broke'
  | 'top-write-threw' | 'top-write-returned' | 'popup-ran'
  | 'self-nav-tried' | 'self-nav'
  | 'busy-start' | 'busy-end'
  | 'strays-sent'
  | 'hostile-img' | 'hostile-click';

const LAB_FIXED_PROBE_MAP: Record<LabFixedProbe, true> = {
  'cookie-console': true, 'cookie-fetch': true, 'cookie-fetch-marker': true, 'cookie-xhr': true, 'cookie-beacon': true,
  'cookie-websocket': true, 'cookie-image': true, 'cookie-ran': true,
  'ambient-parent-held': true, 'ambient-parent-broke': true, 'ambient-origin-held': true, 'ambient-origin-broke': true,
  'ambient-cookie-held': true, 'ambient-cookie-broke': true, 'ambient-local-held': true, 'ambient-local-broke': true,
  'ambient-session-held': true, 'ambient-session-broke': true, 'ambient-idb-held': true, 'ambient-idb-broke': true,
  'ambient-caches-held': true, 'ambient-caches-broke': true,
  'csp-canary': true,
  'popup-open': true, 'popup-blank': true, 'top-nav': true, 'popup-null': true, 'popup-window': true,
  'top-read-held': true, 'top-read-broke': true, 'top-write-threw': true, 'top-write-returned': true, 'popup-ran': true,
  'self-nav-tried': true, 'self-nav': true,
  'busy-start': true, 'busy-end': true,
  'strays-sent': true,
  'hostile-img': true, 'hostile-click': true,
};
export const LAB_FIXED_PROBES = Object.keys(LAB_FIXED_PROBE_MAP) as LabFixedProbe[];

/** Every name a lab run counts: the fixed probes, then the wall frame's battery (`csp-`) and the control frame's (`ctl-`). */
export type LabProbeName = LabFixedProbe | `csp-${LabBatteryChannel}` | `ctl-${LabBatteryChannel}`;
export const LAB_PROBE_NAMES: readonly LabProbeName[] = [
  ...LAB_FIXED_PROBES,
  ...LAB_BATTERY_CHANNELS.map((c): LabProbeName => `csp-${c}`),
  ...LAB_BATTERY_CHANNELS.map((c): LabProbeName => `ctl-${c}`),
];
const PROBE_NAME_SET: ReadonlySet<string> = new Set<string>(LAB_PROBE_NAMES);

/** Whether `s` is a name of the vocabulary: membership, nothing more. */
export const isLabProbeName = (s: string): s is LabProbeName => PROBE_NAME_SET.has(s);

/** A run's nonce: 16 random bytes as unpadded base64url, 22 characters, minted by the server and never by a client. */
const NONCE_SHAPE = /^[A-Za-z0-9_-]{22}$/;
export const isLabNonce = (s: string): boolean => NONCE_SHAPE.test(s);

/** `Sec-Fetch-Site`, as the door keeps it: the four values browsers send, `absent`, or `other`. */
export type LabSiteClass = 'same-origin' | 'same-site' | 'cross-site' | 'none' | 'absent' | 'other';
const LAB_SITE_CLASS_MAP: Record<LabSiteClass, true> = {
  'same-origin': true, 'same-site': true, 'cross-site': true, none: true, absent: true, other: true,
};
export const LAB_SITE_CLASSES = Object.keys(LAB_SITE_CLASS_MAP) as LabSiteClass[];

/** `Origin`, as the door keeps it: an opaque origin's literal `null`, `absent`, or `present` (whose text is not kept). */
export type LabOriginClass = 'null' | 'absent' | 'present';
const LAB_ORIGIN_CLASS_MAP: Record<LabOriginClass, true> = { null: true, absent: true, present: true };
export const LAB_ORIGIN_CLASSES = Object.keys(LAB_ORIGIN_CLASS_MAP) as LabOriginClass[];

/** The run routes' root. `server/src/readerLab/routes.ts` spells the same paths as literals, which the route census
 *  reads; `reader-lab-routes.test.ts` holds them equal. */
export const READER_LAB_RUNS_PATH = '/api/reader-lab/runs';
/** The probe route's pattern, as Fastify matches it: the counter compares a request's matched route with it. */
export const READER_LAB_PROBE_ROUTE = '/api/reader-lab/probe/:nonce/:name';
export const readerLabRunPath = (nonce: string): string => `${READER_LAB_RUNS_PATH}/${nonce}`;
export const readerLabClosePath = (nonce: string): string => `${READER_LAB_RUNS_PATH}/${nonce}/close`;
/** The path a lab frame appends a probe name to: the probe route with this run's nonce. */
export const readerLabProbeBase = (nonce: string): string => `/api/reader-lab/probe/${nonce}/`;
export const readerLabProbePath = (nonce: string, name: LabProbeName): string => `${readerLabProbeBase(nonce)}${name}`;

// The lab run's own time caps (the reader lab design, section 4.4). The page's run (`pwa/src/readerLab/run.ts`) waits by
// these, and the door derives a run's life from their sum (`server/src/readerLab/runs.ts`), so a run that spends every
// cap still ends inside its life.
/** How long a frame's script is given before its counts are read. */
export const LAB_SETTLE_MS = 2000;
/** How long the busy frame spins. */
export const LAB_BUSY_SPIN_MS = 3000;
/** How long the popup step waits for the operator's tap. */
export const LAB_TAP_WAIT_MS = 30_000;
/** The run's own cap on one timed reader mount, above the lab profile's 60 s watchdog. */
export const LAB_MOUNT_WAIT_MS = 65_000;
/** How far a mount's frame-gap window runs past `ready` once the library draws after `ready` (the run's
 *  `ready-and-settle` window; the reader lab design, section 8). */
export const LAB_DRAW_SETTLE_MS = 10_000;
/** The run's steps, for the page's progress. */
export const LAB_STEPS = 9;
/** The run's reader mounts: the nine pages and the hostile page. */
export const LAB_MOUNTS = 10;
/** The longest a run takes by its own caps: the tap wait, a settle per step, the spin, and every mount at its cap and its
 *  draw settle. About thirteen minutes; a run on a working phone takes about two. */
export const LAB_RUN_CAPS_MS = LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS
  + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);

/** What the door counted for one probe name: arrivals, and of those how many carried the session cookie (by name),
 *  were WebSocket upgrades, and fell in each class. */
export interface LabProbeTally {
  readonly hits: number;
  readonly cookie: number;
  readonly upgrade: number;
  readonly site: Readonly<Record<LabSiteClass, number>>;
  readonly origin: Readonly<Record<LabOriginClass, number>>;
}

/** One open run's counts. `probes` names every probe of the vocabulary, zeros included. `counted` is every request
 *  that named this run, `ignored` those of them whose name is outside the vocabulary; `saturated` is true once
 *  `counted` reached the door's cap, after which nothing more was counted, so the run's result is not trusted. */
export interface LabRunView {
  readonly openedAt: number;
  readonly expiresAt: number;
  readonly counted: number;
  readonly ignored: number;
  readonly saturated: boolean;
  readonly probes: Readonly<Record<LabProbeName, LabProbeTally>>;
}

/** `POST /api/reader-lab/runs`. */
export interface LabOpenAnswer { readonly ok: true; readonly nonce: string; readonly ttlMs: number }
/** `GET /api/reader-lab/runs/:nonce`: 200 with the run, or 404 `unknown-run` (no open run that this session opened
 *  carries that nonce: another session's run answers exactly as an unknown nonce does). */
export type LabReadAnswer = { readonly ok: true; readonly run: LabRunView } | { readonly ok: false; readonly error: 'unknown-run' };
/** `POST /api/reader-lab/runs/:nonce/close`: `closed` is false when no run of this session was open under that nonce. */
export interface LabCloseAnswer { readonly ok: true; readonly closed: boolean }
```

- [ ] **Step 4: Run it to see it pass.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-vocabulary.test.ts )` — Expected (prediction): `Tests  8 passed (8)`.
- [ ] **Step 5: Guards.** `SERVER-TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/wire-totality.test.ts test/rings/shared-imports.test.ts test/single-definition/ test/single-definition-pin.test.ts test/citations.test.ts )` through `ccrc test` — green, AND the run's own file list names at least one file under `single-definition/` and `single-definition-pin.test.ts` (vitest reads each argument as a path filter, so a filter that matches nothing passes silently; a list without them is a stop-and-ask). If `wire-totality` names a union of this file, the map beside it is the fix (Decision (1)); a red that names anything else is a stop-and-ask.
- [ ] **Step 6: Commit.** `git add shared/readerLab.ts server/test/reader-lab-vocabulary.test.ts` (expect 2), message `shared: the reader lab's vocabulary, paths, wire and run caps (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `server`, tests `test/reader-lab-vocabulary.test.ts`; the file is `../shared/readerLab.ts` from the package):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| RLB-T1-M1 | (g) M10.1 | `'css-content-url': true, audio: true, video: true, 'svg-image': true, 'import-dynamic': true, iframe: true,` → `'css-content-url': true, audio: true, video: true, 'svg-image': true, iframe: true, 'import-dynamic': true,` | 1 failed — `'the battery is the desktop battery\'s 27 channels, in its order'` (`'the probe names are the 40 fixed probes, …'` derives from the same list, so it stays green) |
| RLB-T1-M2 | (g) M10.2 | `const NONCE_SHAPE = /^[A-Za-z0-9_-]{22}$/;` → `const NONCE_SHAPE = /^[A-Za-z0-9_+/=-]{21,24}$/;` | 1 failed — `'a nonce is exactly 22 base64url characters, …'` |
| RLB-T1-M3 | (g) M10.1 | `export const isLabProbeName = (s: string): s is LabProbeName => PROBE_NAME_SET.has(s);` → `export const isLabProbeName = (s: string): s is LabProbeName => /^[a-z0-9-]+$/.test(s);` | 1 failed — `'isLabProbeName is membership in the list and nothing more'` |
| RLB-T1-M4 | (d) M10.6 | `+ LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);` → `+ LAB_MOUNTS * LAB_MOUNT_WAIT_MS;` | 1 failed — `'the run\'s own caps, and their sum, …'` |

```json
[
  {"id": "RLB-T1-M1", "spec": "(g) M10.1", "pkg": "server", "file": "../shared/readerLab.ts", "old": "'css-content-url': true, audio: true, video: true, 'svg-image': true, 'import-dynamic': true, iframe: true,", "new": "'css-content-url': true, audio: true, video: true, 'svg-image': true, iframe: true, 'import-dynamic': true,", "tests": ["test/reader-lab-vocabulary.test.ts"], "red": "1 failed: the battery is the desktop battery's 27 channels, in its order"},
  {"id": "RLB-T1-M2", "spec": "(g) M10.2", "pkg": "server", "file": "../shared/readerLab.ts", "old": "const NONCE_SHAPE = /^[A-Za-z0-9_-]{22}$/;", "new": "const NONCE_SHAPE = /^[A-Za-z0-9_+/=-]{21,24}$/;", "tests": ["test/reader-lab-vocabulary.test.ts"], "red": "1 failed: a nonce is exactly 22 base64url characters"},
  {"id": "RLB-T1-M3", "spec": "(g) M10.1", "pkg": "server", "file": "../shared/readerLab.ts", "old": "export const isLabProbeName = (s: string): s is LabProbeName => PROBE_NAME_SET.has(s);", "new": "export const isLabProbeName = (s: string): s is LabProbeName => /^[a-z0-9-]+$/.test(s);", "tests": ["test/reader-lab-vocabulary.test.ts"], "red": "1 failed: isLabProbeName is membership in the list and nothing more"},
  {"id": "RLB-T1-M4", "spec": "(d) M10.6", "pkg": "server", "file": "../shared/readerLab.ts", "old": "+ LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);", "new": "+ LAB_MOUNTS * LAB_MOUNT_WAIT_MS;", "tests": ["test/reader-lab-vocabulary.test.ts"], "red": "1 failed: the run's own caps, and their sum"}
]
```

**Verify:** `test/reader-lab-vocabulary.test.ts` 8 passed; `SERVER-TSC-OK`; the guards green, with the single-definition files in the run's list.

### Task 2: The run store (refinements (d), (e); M10.2, M10.5, M10.6, M10.7, M10.17)

**Run:** RL-a. **Model routing:** `sonnet`, effort `medium`; per-task reviewer `opus` (the door's bounds, its owner and what it keeps).

**Files:**
- Create: `server/src/readerLab/runs.ts`, `server/test/reader-lab-runs.test.ts`.
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C9 Docs row's server cell gains `readerLab/**`, so the new directory has its context the moment its first file exists).
- Guards (not edited): `server/test/rings/outward-edges.test.ts`, `server/test/rings/host-imports.test.ts`, `server/test/rings/totality.test.ts`.

**Interfaces:** Consumes Task 1's vocabulary and caps. Produces `READER_LAB_RUN_SLACK_MS`, `READER_LAB_RUN_TTL_MS`, `READER_LAB_RUNS_MAX`, `READER_LAB_RUN_HITS_MAX`, `LabObservation`, `LabCountOutcome`, `labSiteClass`, `labOriginClass`, `ReaderLabRuns` (`open(nonce, owner, now)`, `count(nonce, name, o, now)`, `read(nonce, owner, now)`, `close(nonce, owner)`, `openCount(now)`), `createReaderLabRuns()`.

**Decisions:** (1) No timer: every call that looks drops the expired runs first, so an idle door holds at most four stale entries and costs nothing. (2) The nonce is checked for its shape before any lookup; opening with a bad nonce throws, because only the route mints nonces. (3) `read` builds a fresh object every time, so nothing a caller does to a read reaches the run. (4) Map insertion order is opening order, so "the oldest" is the first key, whoever opened it. (5) The owner is an opaque string the route computes (`routes.ts#labOwnerOf`, Task 3); the store compares it and never derives it, so it stays L1. `read` and `close` by another owner answer exactly what an unknown nonce answers (`null`, `false`): `null` keeps its one meaning, "no open run of this owner carries that nonce". `count` asks no owner: a frame's request carries no session. (6) The life is `LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS`, never a literal; the test sums the caps itself.

- [ ] **Step 0: Base.** `test -f shared/readerLab.ts && test ! -e server/src/readerLab && git grep -qF "export const READER_LAB_PROBE_ROUTE = '/api/reader-lab/probe/:nonce/:name';" HEAD -- shared/readerLab.ts && echo T2-BASE-OK` — Expected: `T2-BASE-OK`.
- [ ] **Step 1: Write the failing test,** `server/test/reader-lab-runs.test.ts`, with exactly this content:

```ts
// The reader lab door's state (native Docs reader, the reader lab plan of 2026-11-03, Task 2; the rich-docs spec's rows
// M10.2, M10.5, M10.6, M10.7, M10.17): `server/src/readerLab/runs.ts`, its clock handed in. A run opens under a nonce the
// route minted, for the session that opened it, and lives as long as the lab run's own caps allow plus five minutes; four
// can be open and a fifth evicts the oldest; a run counts at most 1024 requests and is then saturated; what it keeps of a
// request is classes; with no run open nothing is counted; a run answers only its owner.
import { describe, expect, it } from 'vitest';
import {
  LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_MOUNTS, LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, LAB_SETTLE_MS, LAB_STEPS,
  LAB_TAP_WAIT_MS, type LabProbeTally,
} from '../../shared/readerLab.js';
import {
  READER_LAB_RUNS_MAX, READER_LAB_RUN_HITS_MAX, READER_LAB_RUN_TTL_MS, createReaderLabRuns, labOriginClass, labSiteClass,
  type LabObservation,
} from '../src/readerLab/runs.js';

const N1 = 'AAAAAAAAAAAAAAAAAAAAAA';
/** Two owners, as the route's digests stand in the store: opaque strings. */
const ME = 'owner-a';
const OTHER = 'owner-b';
/** The i-th of several distinct well-formed nonces. */
const nonceOf = (i: number): string => `${String(i).padStart(2, '0')}${'B'.repeat(20)}`;
const CROSS: LabObservation = { cookie: false, upgrade: false, site: 'cross-site', origin: 'null' };
const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};

describe('the reader lab run store (reader lab plan, Task 2)', () => {
  it('a run lives as long as the lab run\'s own caps allow, plus five minutes: between fifteen and twenty minutes (M10.6)', () => {
    const caps = LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);
    expect(READER_LAB_RUN_TTL_MS).toBe(caps + 5 * 60_000);
    expect(READER_LAB_RUN_TTL_MS).toBeGreaterThanOrEqual(15 * 60_000);
    expect(READER_LAB_RUN_TTL_MS).toBeLessThanOrEqual(20 * 60_000);
  });

  it('an opened run reads every probe name with a zero tally, and expires its life after it opened', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 1000);
    const v = runs.read(N1, ME, 1000)!;
    expect([v.openedAt, v.expiresAt]).toEqual([1000, 1000 + READER_LAB_RUN_TTL_MS]);
    expect(Object.keys(v.probes)).toEqual([...LAB_PROBE_NAMES]);
    for (const n of LAB_PROBE_NAMES) expect(v.probes[n], n).toEqual(ZERO);
    expect([v.counted, v.ignored, v.saturated]).toEqual([0, 0, false]);
  });

  it('a counted request adds to its name\'s hits and to exactly its classes, and to nothing else', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'cookie-fetch', { cookie: true, upgrade: false, site: 'same-origin', origin: 'absent' }, 1)).toBe('counted');
    expect(runs.count(N1, 'cookie-websocket', { cookie: false, upgrade: true, site: 'cross-site', origin: 'null' }, 2)).toBe('counted');
    const v = runs.read(N1, ME, 3)!;
    expect(v.probes['cookie-fetch']).toEqual({ ...ZERO, hits: 1, cookie: 1, site: { ...ZERO.site, 'same-origin': 1 }, origin: { ...ZERO.origin, absent: 1 } });
    expect(v.probes['cookie-websocket']).toEqual({ ...ZERO, hits: 1, upgrade: 1, site: { ...ZERO.site, 'cross-site': 1 }, origin: { ...ZERO.origin, null: 1 } });
    expect(v.probes['cookie-xhr']).toEqual(ZERO);
    expect(v.counted).toBe(2);
  });

  it('a name outside the vocabulary is counted as ignored and changes no tally', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    for (const name of ['nope', '__proto__', 'csp-', 'COOKIE-FETCH']) expect(runs.count(N1, name, CROSS, 1), name).toBe('ignored-name');
    const v = runs.read(N1, ME, 2)!;
    expect([v.counted, v.ignored]).toEqual([4, 4]);
    for (const n of LAB_PROBE_NAMES) expect(v.probes[n], n).toEqual(ZERO);
  });

  it('with no run open, or under a nonce of another shape or another run, nothing is counted (M10.5)', () => {
    const runs = createReaderLabRuns();
    expect(runs.count(N1, 'cookie-fetch', CROSS, 0)).toBe('no-run');
    runs.open(N1, ME, 0);
    for (const n of ['', 'A'.repeat(21), `${N1}A`, nonceOf(1), '../x']) expect(runs.count(n, 'cookie-fetch', CROSS, 1), n).toBe('no-run');
    expect(runs.read(N1, ME, 2)!.counted).toBe(0);
    expect(runs.read('A'.repeat(21), ME, 2)).toBeNull();
  });

  it('a run is gone at its expiry: it reads null and counts nothing (M10.6)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'busy-start', CROSS, READER_LAB_RUN_TTL_MS - 1)).toBe('counted');
    expect(runs.count(N1, 'busy-end', CROSS, READER_LAB_RUN_TTL_MS)).toBe('no-run');
    expect(runs.read(N1, ME, READER_LAB_RUN_TTL_MS)).toBeNull();
    expect(runs.openCount(READER_LAB_RUN_TTL_MS)).toBe(0);
  });

  it('four runs can be open; a fifth evicts the oldest, whoever opened it, and leaves the other three as they were (M10.6)', () => {
    expect(READER_LAB_RUNS_MAX).toBe(4);
    const runs = createReaderLabRuns();
    for (let i = 1; i <= 4; i += 1) {
      runs.open(nonceOf(i), ME, i);
      runs.count(nonceOf(i), 'busy-start', CROSS, i);
    }
    runs.open(nonceOf(5), OTHER, 5);
    expect(runs.openCount(5)).toBe(4);
    expect(runs.read(nonceOf(1), ME, 5)).toBeNull();
    for (let i = 2; i <= 4; i += 1) expect(runs.read(nonceOf(i), ME, 5)!.probes['busy-start'].hits, String(i)).toBe(1);
    expect(runs.read(nonceOf(5), OTHER, 5)!.counted).toBe(0);
  });

  it('a run counts at most 1024 requests, then reads saturated and counts nothing more (M10.6)', () => {
    expect(READER_LAB_RUN_HITS_MAX).toBe(1024);
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    for (let i = 0; i < READER_LAB_RUN_HITS_MAX; i += 1) expect(runs.count(N1, 'cookie-image', CROSS, 1)).toBe('counted');
    expect(runs.read(N1, ME, 1)!.saturated).toBe(true);
    expect(runs.count(N1, 'cookie-image', CROSS, 1)).toBe('saturated');
    expect(runs.count(N1, 'nope', CROSS, 1)).toBe('saturated');
    const v = runs.read(N1, ME, 1)!;
    expect([v.counted, v.ignored, v.probes['cookie-image'].hits]).toEqual([1024, 0, 1024]);
  });

  it('close ends a run once: true, then false; it then reads null and counts nothing', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.close(N1, ME)).toBe(true);
    expect(runs.close(N1, ME)).toBe(false);
    expect(runs.read(N1, ME, 0)).toBeNull();
    expect(runs.count(N1, 'busy-start', CROSS, 0)).toBe('no-run');
  });

  it('a run answers only its owner: another reads null, as an unknown nonce does, and cannot close it; counting asks no owner (M10.17)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'busy-start', CROSS, 1)).toBe('counted');
    expect(runs.read(N1, OTHER, 2)).toBeNull();
    expect(runs.read(nonceOf(9), ME, 2)).toBeNull();
    expect(runs.close(N1, OTHER)).toBe(false);
    expect(runs.read(N1, ME, 2)!.probes['busy-start'].hits).toBe(1);
    expect(runs.close(N1, ME)).toBe(true);
  });

  it('opening refuses a nonce of the wrong shape: only the route mints nonces, so that is a defect (M10.2)', () => {
    const runs = createReaderLabRuns();
    for (const n of ['', 'A'.repeat(21), `${N1}=`, 'a/b']) expect(() => runs.open(n, ME, 0), n).toThrow(TypeError);
    expect(runs.openCount(0)).toBe(0);
  });

  it('a read is a copy: changing it changes nothing in the run (M10.7)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    runs.count(N1, 'busy-start', CROSS, 0);
    const v = runs.read(N1, ME, 0)! as unknown as { probes: Record<string, { hits: number; site: Record<string, number> }> };
    v.probes['busy-start']!.hits = 99;
    v.probes['busy-start']!.site['cross-site'] = 99;
    expect(runs.read(N1, ME, 0)!.probes['busy-start'])
      .toEqual({ ...ZERO, hits: 1, site: { ...ZERO.site, 'cross-site': 1 }, origin: { ...ZERO.origin, null: 1 } });
  });

  it('Sec-Fetch-Site and Origin become classes; no header text is kept (M10.7)', () => {
    expect(['same-origin', 'same-site', 'cross-site', 'none', undefined, '', 'SAME-ORIGIN', 'cross-site, same-origin', 42]
      .map((h) => labSiteClass(h))).toEqual(['same-origin', 'same-site', 'cross-site', 'none', 'absent', 'absent', 'other', 'other', 'other']);
    expect(['null', undefined, '', 'https://box.example', 'NULL'].map((h) => labOriginClass(h)))
      .toEqual(['null', 'absent', 'absent', 'present', 'present']);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-runs.test.ts )` — Expected (prediction): the file fails to load (`Cannot find module '../src/readerLab/runs.js'`).
- [ ] **Step 3: Write `server/src/readerLab/runs.ts`** with exactly this content:

```ts
// The reader lab door's state (native Docs reader, the reader lab plan of 2026-11-03, Task 2; the reader lab design,
// section 4; the rich-docs spec's rows M10.2, M10.5, M10.6, M10.7). Ring L1: pure. No I/O, no timer, no fastify: the
// clock is an argument, and the nonce is minted by the route (`routes.ts`) and handed in. It holds at most
// READER_LAB_RUNS_MAX open runs, in process memory only, each for READER_LAB_RUN_TTL_MS from its opening, each counting
// at most READER_LAB_RUN_HITS_MAX requests. A call that looks drops the expired runs first; a restart forgets every run.
// A run answers only its owner, an opaque digest of the opening session that the route computes: another owner's read
// and close answer exactly as an unknown nonce's do. Counting asks no owner: a frame's request carries no session.
// What it keeps of a request is classes (`LabObservation`), never a value: no header text, no body, no address.
import {
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_RUN_CAPS_MS, LAB_SITE_CLASSES, isLabNonce, isLabProbeName,
  type LabOriginClass, type LabProbeName, type LabProbeTally, type LabRunView, type LabSiteClass,
} from '../../../shared/readerLab.js';

/** What a run's life adds to the lab run's own caps: the requests, the parses and a slow phone's own work. */
export const READER_LAB_RUN_SLACK_MS = 300_000;
/** How long a run stays open after it opened, derived from the lab run's own caps (`LAB_RUN_CAPS_MS`, every wait at its
 *  cap, about thirteen minutes) plus the slack: about eighteen minutes. A run on a working phone takes about two. */
export const READER_LAB_RUN_TTL_MS = LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS;
/** Runs open at once; opening one more evicts the oldest. */
export const READER_LAB_RUNS_MAX = 4;
/** Requests counted per run, every name included; a lab run sends about 150. Past it the run is saturated. */
export const READER_LAB_RUN_HITS_MAX = 1024;

/** What the door keeps of one request that names an open run. */
export interface LabObservation {
  /** The session cookie was present by name with a non-empty value; its value is never read past that test. */
  readonly cookie: boolean;
  /** A WebSocket upgrade. */
  readonly upgrade: boolean;
  readonly site: LabSiteClass;
  readonly origin: LabOriginClass;
}

/** What one count did. The probe's answer never depends on it; the tests read it. */
export type LabCountOutcome = 'counted' | 'ignored-name' | 'no-run' | 'saturated';

/** The four `Sec-Fetch-Site` values browsers send: the site classes but `absent` and `other`. */
const SENT_SITES: ReadonlySet<string> = new Set(LAB_SITE_CLASSES.filter((c) => c !== 'absent' && c !== 'other'));

/** `Sec-Fetch-Site` as a class. */
export function labSiteClass(header: unknown): LabSiteClass {
  if (header === undefined || header === '') return 'absent';
  if (typeof header !== 'string' || !SENT_SITES.has(header)) return 'other';
  return header as LabSiteClass;
}

/** `Origin` as a class: the opaque origin's literal `null`, `absent`, or `present` (its text is not kept). */
export function labOriginClass(header: unknown): LabOriginClass {
  if (header === undefined || header === '') return 'absent';
  return header === 'null' ? 'null' : 'present';
}

interface Tally {
  hits: number;
  cookie: number;
  upgrade: number;
  readonly site: Record<LabSiteClass, number>;
  readonly origin: Record<LabOriginClass, number>;
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const emptyTally = (): Tally => ({ hits: 0, cookie: 0, upgrade: 0, site: zeros(LAB_SITE_CLASSES), origin: zeros(LAB_ORIGIN_CLASSES) });

interface Run {
  /** The opening session's digest, as the route computed it; never the session. */
  readonly owner: string;
  readonly openedAt: number;
  readonly expiresAt: number;
  counted: number;
  ignored: number;
  readonly tallies: Map<LabProbeName, Tally>;
}

export interface ReaderLabRuns {
  /** Opens a run under `nonce`, which the route minted, for `owner`, the opening session's digest. Throws a TypeError on
   *  a nonce of another shape: a defect, never a request's input. With READER_LAB_RUNS_MAX open, the oldest is evicted
   *  first, whoever opened it. */
  open(nonce: string, owner: string, now: number): void;
  /** Counts one request that names `nonce` and `name`. */
  count(nonce: string, name: string, o: LabObservation, now: number): LabCountOutcome;
  /** The run's counts, a fresh copy naming every probe; or null. Null has one meaning: no open run of `owner` carries
   *  that nonce (never opened, opened by another owner, closed, expired, evicted, or forgotten by a restart), so another
   *  owner's run reads exactly as an unknown nonce does. */
  read(nonce: string, owner: string, now: number): LabRunView | null;
  /** Closes the run; false when no run of `owner` was open under that nonce. */
  close(nonce: string, owner: string): boolean;
  /** How many runs are open at `now`. */
  openCount(now: number): number;
}

export function createReaderLabRuns(): ReaderLabRuns {
  const runs = new Map<string, Run>();
  const sweep = (now: number): void => {
    for (const [k, r] of runs) if (r.expiresAt <= now) runs.delete(k);
  };
  return {
    open(nonce, owner, now) {
      if (!isLabNonce(nonce)) throw new TypeError('reader lab: a run nonce is 22 base64url characters');
      sweep(now);
      while (runs.size >= READER_LAB_RUNS_MAX) {
        const oldest = runs.keys().next();
        if (oldest.done === true) break;
        runs.delete(oldest.value);
      }
      runs.set(nonce, { owner, openedAt: now, expiresAt: now + READER_LAB_RUN_TTL_MS, counted: 0, ignored: 0, tallies: new Map() });
    },
    count(nonce, name, o, now) {
      if (!isLabNonce(nonce)) return 'no-run';
      sweep(now);
      const run = runs.get(nonce);
      if (run === undefined) return 'no-run';
      if (run.counted >= READER_LAB_RUN_HITS_MAX) return 'saturated';
      run.counted += 1;
      if (!isLabProbeName(name)) {
        run.ignored += 1;
        return 'ignored-name';
      }
      let t = run.tallies.get(name);
      if (t === undefined) {
        t = emptyTally();
        run.tallies.set(name, t);
      }
      t.hits += 1;
      if (o.cookie) t.cookie += 1;
      if (o.upgrade) t.upgrade += 1;
      t.site[o.site] += 1;
      t.origin[o.origin] += 1;
      return 'counted';
    },
    read(nonce, owner, now) {
      if (!isLabNonce(nonce)) return null;
      sweep(now);
      const run = runs.get(nonce);
      if (run === undefined || run.owner !== owner) return null;
      const probes = Object.fromEntries(LAB_PROBE_NAMES.map((n): [LabProbeName, LabProbeTally] => {
        const t = run.tallies.get(n) ?? emptyTally();
        return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: { ...t.site }, origin: { ...t.origin } }];
      })) as Record<LabProbeName, LabProbeTally>;
      return {
        openedAt: run.openedAt, expiresAt: run.expiresAt, counted: run.counted, ignored: run.ignored,
        saturated: run.counted >= READER_LAB_RUN_HITS_MAX, probes,
      };
    },
    close(nonce, owner) {
      const run = runs.get(nonce);
      return run !== undefined && run.owner === owner && runs.delete(nonce);
    },
    openCount(now) {
      sweep(now);
      return runs.size;
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-runs.test.ts )` — Expected (prediction): `Tests  13 passed (13)`.
- [ ] **Step 5: The context row.** Run `( cd server && ./node_modules/.bin/vitest run test/rings/totality.test.ts )` and record its red (prediction: `server/src/readerLab/runs.ts` unmapped). In `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`:
  Find:
```md
| C9 Docs | `docs/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` |
```
  Replace:
```md
| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` |
```
  Then `totality.test.ts` again — green.
- [ ] **Step 6: Guards.** `SERVER-TSC-OK`. `( cd server && ./node_modules/.bin/vitest run test/rings/outward-edges.test.ts test/rings/host-imports.test.ts test/rings/totality.test.ts )` through `ccrc test` — green (the file imports only `shared/`; its ring is L1 by its imports and header).
- [ ] **Step 7: Commit.** `git add server/src/readerLab/runs.ts server/test/reader-lab-runs.test.ts docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (expect 3), message `server: the reader lab door's run store: bounded, owned, in memory, classes only (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `server`, file `src/readerLab/runs.ts`, tests `test/reader-lab-runs.test.ts`):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| RLB-T2-M1 | (d) M10.6 | `for (const [k, r] of runs) if (r.expiresAt <= now) runs.delete(k);` → `for (const [k, r] of runs) if (r.expiresAt < now) runs.delete(k);` | 1 failed — `'a run is gone at its expiry: …'` |
| RLB-T2-M2 | (d) M10.6 | `while (runs.size >= READER_LAB_RUNS_MAX) {` → `while (runs.size > READER_LAB_RUNS_MAX) {` | 1 failed — `'four runs can be open; a fifth evicts the oldest …'` |
| RLB-T2-M3 | (d) M10.6 | `if (run.counted >= READER_LAB_RUN_HITS_MAX) return 'saturated';` → removed | 1 failed — `'a run counts at most 1024 requests, …'` |
| RLB-T2-M4 | (e) M10.7 | `if (o.cookie) t.cookie += 1;` → `t.cookie += 1;` | 1 failed — `'a counted request adds to its name\'s hits and to exactly its classes, …'` |
| RLB-T2-M5 | (d) M10.2 | `if (!isLabNonce(nonce)) throw new TypeError('reader lab: a run nonce is 22 base64url characters');` → removed | 1 failed — `'opening refuses a nonce of the wrong shape: …'` |
| RLB-T2-M6 | (e) M10.7 | `return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: { ...t.site }, origin: { ...t.origin } }];` → `return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: t.site, origin: t.origin }];` | 1 failed — `'a read is a copy: …'` |
| RLB-T2-M7 | (d) M10.17 | `if (run === undefined \|\| run.owner !== owner) return null;` → `if (run === undefined) return null;` | 1 failed — `'a run answers only its owner: …'` |
| RLB-T2-M8 | (d) M10.17 | `return run !== undefined && run.owner === owner && runs.delete(nonce);` → `return runs.delete(nonce);` | 1 failed — `'a run answers only its owner: …'` |
| RLB-T2-M9 | (d) M10.6 | `export const READER_LAB_RUN_TTL_MS = LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS;` → `export const READER_LAB_RUN_TTL_MS = 600_000;` | 1 failed — `'a run lives as long as the lab run\'s own caps allow, plus five minutes: …'` |

```json
[
  {"id": "RLB-T2-M1", "spec": "(d) M10.6", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "for (const [k, r] of runs) if (r.expiresAt <= now) runs.delete(k);", "new": "for (const [k, r] of runs) if (r.expiresAt < now) runs.delete(k);", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a run is gone at its expiry"},
  {"id": "RLB-T2-M2", "spec": "(d) M10.6", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "while (runs.size >= READER_LAB_RUNS_MAX) {", "new": "while (runs.size > READER_LAB_RUNS_MAX) {", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: four runs can be open; a fifth evicts the oldest"},
  {"id": "RLB-T2-M3", "spec": "(d) M10.6", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "if (run.counted >= READER_LAB_RUN_HITS_MAX) return 'saturated';", "new": "", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a run counts at most 1024 requests"},
  {"id": "RLB-T2-M4", "spec": "(e) M10.7", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "if (o.cookie) t.cookie += 1;", "new": "t.cookie += 1;", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a counted request adds to its name's hits and to exactly its classes"},
  {"id": "RLB-T2-M5", "spec": "(d) M10.2", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "if (!isLabNonce(nonce)) throw new TypeError('reader lab: a run nonce is 22 base64url characters');", "new": "", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: opening refuses a nonce of the wrong shape"},
  {"id": "RLB-T2-M6", "spec": "(e) M10.7", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: { ...t.site }, origin: { ...t.origin } }];", "new": "return [n, { hits: t.hits, cookie: t.cookie, upgrade: t.upgrade, site: t.site, origin: t.origin }];", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a read is a copy"},
  {"id": "RLB-T2-M7", "spec": "(d) M10.17", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "if (run === undefined || run.owner !== owner) return null;", "new": "if (run === undefined) return null;", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a run answers only its owner"},
  {"id": "RLB-T2-M8", "spec": "(d) M10.17", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "return run !== undefined && run.owner === owner && runs.delete(nonce);", "new": "return runs.delete(nonce);", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a run answers only its owner"},
  {"id": "RLB-T2-M9", "spec": "(d) M10.6", "pkg": "server", "file": "src/readerLab/runs.ts", "old": "export const READER_LAB_RUN_TTL_MS = LAB_RUN_CAPS_MS + READER_LAB_RUN_SLACK_MS;", "new": "export const READER_LAB_RUN_TTL_MS = 600_000;", "tests": ["test/reader-lab-runs.test.ts"], "red": "1 failed: a run lives as long as the lab run's own caps allow, plus five minutes"}
]
```

**Verify:** `test/reader-lab-runs.test.ts` 13 passed; `SERVER-TSC-OK`; `totality` green with the new row.

### Task 3: The door's routes, the counter before the gate, and the gate's census (refinements (b), (c), (d), (f); M10.2-M10.4, M10.8, M10.17)

**Run:** RL-a. **Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the security contract: the counter's position, the uniform answer, the run's owner, the exemption's argument and the gate's text).

**Files:**
- Create: `server/src/readerLab/routes.ts`, `server/test/reader-lab-routes.test.ts`.
- Modify: `server/src/server.ts` (two import lines; the store and the counter just above `installGate`; one registration after the docs plugin), `server/src/auth/gate.ts` (the route count in its first line, "THE EIGHT REASONS", reason 8, one sentence in `needsOriginCheck`'s note, two `EXEMPT` entries), `server/test/auth-gate.test.ts` (the scan's file list and counts, the specific registrations, the `EXEMPT` key list, "eight classes", the three numeral sentences), `server/test/rings/fastify-l4.data.ts` (one entry).
- Guards (not edited): `server/test/box-token-census.test.ts` (Task 4 adds its describe; run it here to see it still green), `server/test/coord-pause-route.test.ts`, `server/test/auth-passkey.test.ts`, `server/test/rings/fastify-l4.test.ts`, `server/test/rings/exemption-age.test.ts`, `server/test/rings/outward-edges.test.ts`, `server/test/rings/totality.test.ts`.

**Interfaces:** Consumes Tasks 1 and 2. Produces `installReaderLabCounter(app, runs)`, `registerReaderLabRoutes(app, runs)`, `READER_LAB_PROBE_BODY_MAX`, `LAB_NO_SESSION`, `labOwnerOf(cookieHeader)`.

**Decisions:** (1) Every registration is `app.get('<literal>'` or `app.post('<literal>'` on the parameter named `app`, so `auth-gate.test.ts`' scan and `box-token-census.test.ts`' `registrationsIn` both read it. (2) The run routes take no body and never read one; the nonce is minted from `node:crypto`'s `randomBytes(16)` and nothing in a request can name it for `open`. (3) The counter reads `request.routeOptions.url` and `request.params` (both set by routing, before `onRequest`), `request.ws` (set by `@fastify/websocket`'s own `onRequest`, which its registration added earlier), the `Cookie`, `Sec-Fetch-Site` and `Origin` headers, and nothing else. (4) The counter and the store are created in `buildServer`, once per server, so two servers in one test share no run. (5) A run's owner is `labOwnerOf(req.headers.cookie)`: a sha256 of `reader-lab:` and the session cookie's value, base64url, so the store never holds the cookie and the digest is never the session store's own key (`sessions.ts` keys by a bare sha256 of the token); with no cookie it is `LAB_NO_SESSION`. On an armed box the gate has already proved the cookie names a live session; on a dark box it proves nothing, and the owner only separates callers who send different cookies (refinement (d) says what holds there). (6) The gate's foreign-origin `console.warn` is the gate's and stays unchanged; the armed upgrade case asserts it fires once, so the expected journal line is documented by a test instead of silenced. (7) The `needsOriginCheck` note gains one sentence AFTER its order-pinned span (which `box-token-census.test.ts` reads from "EXEMPT ROUTES ARE SKIPPED" to "their real guard is"), with no number word in it.

- [ ] **Step 0: Base, claims, the installed websocket plugin.** Run:

```bash
git grep -qF "import { installDocsRequestPolicy, installDocsResponsePolicy } from './docs/hooks.js';" HEAD -- server/src/server.ts \
  && git grep -qF "  // Unconditional — the flag is decided INSIDE the hook (\`authVerdict\`'s first" HEAD -- server/src/server.ts \
  && git grep -qF "    registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);" HEAD -- server/src/server.ts \
  && git grep -qF " * THE SEVEN REASONS, and there are only seven:" HEAD -- server/src/auth/gate.ts \
  && git grep -qF " * THE GATE. One \`onRequest\` hook stands in front of all 167 routes, the static" HEAD -- server/src/auth/gate.ts \
  && git grep -qF " * and nothing caught it because the scanner reads numerals.)" HEAD -- server/src/auth/gate.ts \
  && git grep -qF "    expect(ROUTES.length).toBe(170);" HEAD -- server/test/auth-gate.test.ts \
  && git grep -qF "export function createReaderLabRuns(): ReaderLabRuns {" HEAD -- server/src/readerLab/runs.ts \
  && test ! -e server/src/readerLab/routes.ts \
  && grep -q "kWs\|request.ws\|\.ws = " server/node_modules/@fastify/websocket/index.js \
  && echo T3-BASE-OK
```

  Expected: `T3-BASE-OK`. Confirm the claims on `server/src/server.ts`, `server/src/auth/gate.ts`, `server/test/auth-gate.test.ts` and `server/test/rings/fastify-l4.data.ts`. Before any edit, after `git fetch -q origin main`, run `test/auth-gate.test.ts`, `test/box-token-census.test.ts`, `test/coord-pause-route.test.ts` and `test/auth-passkey.test.ts` each alone through `ccrc test`, and record each count at BASE (Step 6 compares).
- [ ] **Step 1: Write the failing test,** `server/test/reader-lab-routes.test.ts`, with exactly this content:

```ts
// The reader lab's door through the real server (native Docs reader, the reader lab plan of 2026-11-03, Task 3; the
// rich-docs spec's rows M10.2, M10.3, M10.4, M10.5, M10.7, M10.8, M10.17; the reader lab design, section 4): `buildServer`
// with the gate dark and armed. The run routes are session-gated and a run answers only the session that opened it; every
// probe answer is one empty 204, whatever it is sent; the counter sees a probe before the gate and keeps only classes; a
// frame's WebSocket upgrade is refused by the gate, which logs its foreign-origin line, and still counted; a CORS
// preflight to the probe is never approved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { EXEMPT } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { PtyLike } from '../src/pty.js';
import { DOCS_REQUEST_HEADER } from '../../shared/docs.js';
import {
  READER_LAB_PROBE_ROUTE, READER_LAB_RUNS_PATH, readerLabProbePath, type LabOpenAnswer, type LabReadAnswer,
} from '../../shared/readerLab.js';
import { labOwnerOf } from '../src/readerLab/routes.js';
import { READER_LAB_RUN_HITS_MAX, READER_LAB_RUN_TTL_MS } from '../src/readerLab/runs.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** A cheap scrypt line verifies through the identical code path (auth-gate.test.ts' FAST_PARAMS). */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** A pty that never touches tmux (auth-gate.test.ts' stubPty). */
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });
const UNKNOWN = 'ZZZZZZZZZZZZZZZZZZZZZZ';

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
});

/** The real server in a fixture home, the gate armed or dark, with a passphrase so a session can be minted. */
async function openApp(armed: boolean): Promise<FastifyInstance> {
  const home = mkTmp('ccrc-reader-lab-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: armed, cookieSecure: false }, spawnPty: stubPty };
  app = await buildServer(deps);
  await app.ready();
  return app;
}

/** A live session cookie, minted through the real login route. */
async function login(a: FastifyInstance): Promise<string> {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
}

const headersOf = (cookie?: string): Record<string, string> => (cookie === undefined ? {} : { cookie });

async function openRun(a: FastifyInstance, cookie?: string): Promise<string> {
  const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: headersOf(cookie) });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as LabOpenAnswer).nonce;
}

async function readRun(a: FastifyInstance, nonce: string, cookie?: string): Promise<LabReadAnswer> {
  const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: headersOf(cookie) });
  return JSON.parse(res.body) as LabReadAnswer;
}

const counted = (r: LabReadAnswer): Extract<LabReadAnswer, { ok: true }>['run'] => {
  if (!r.ok) throw new Error('the run is not open');
  return r.run;
};

describe('the reader lab door (reader lab plan, Task 3)', () => {
  it('registers the run routes and the probe pair at the paths the vocabulary names, as literals', async () => {
    const a = await openApp(false);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_RUNS_PATH })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/:nonce` })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/:nonce/close` })).toBe(true);
    expect(a.hasRoute({ method: 'GET', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    expect(a.hasRoute({ method: 'POST', url: READER_LAB_PROBE_ROUTE })).toBe(true);
    const src = readFileSync(path.join(here, '..', 'src', 'readerLab', 'routes.ts'), 'utf8');
    for (const lit of [`app.post('${READER_LAB_RUNS_PATH}'`, `app.get('${READER_LAB_PROBE_ROUTE}'`, `app.post('${READER_LAB_PROBE_ROUTE}'`]) {
      expect(src, lit).toContain(lit);
    }
  });

  it('armed: a session opens, reads and closes a run; an anonymous caller gets the gate\'s 401 on all three (M10.8)', async () => {
    const a = await openApp(true);
    for (const [method, url] of [['POST', READER_LAB_RUNS_PATH], ['GET', `${READER_LAB_RUNS_PATH}/${UNKNOWN}`],
      ['POST', `${READER_LAB_RUNS_PATH}/${UNKNOWN}/close`]] as const) {
      const anon = await a.inject({ method, url });
      expect(anon.statusCode, `${method} ${url}`).toBe(401);
      expect((JSON.parse(anon.body) as { verdict?: unknown }).verdict, `${method} ${url}`).toBe('no-session');
    }
    const cookie = await login(a);
    const opened = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, headers: { cookie } });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(opened.body) as LabOpenAnswer;
    expect(body.ok).toBe(true);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.ttlMs).toBe(READER_LAB_RUN_TTL_MS);
    expect(counted(await readRun(a, body.nonce, cookie)).counted).toBe(0);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: true });
    const gone = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${body.nonce}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(JSON.parse(gone.body)).toEqual({ ok: false, error: 'unknown-run' });
    const again = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${body.nonce}/close`, headers: { cookie } });
    expect(JSON.parse(again.body)).toEqual({ ok: true, closed: false });
  });

  it('the server mints every nonce: two opens differ, and a nonce sent in the body is not taken (M10.2)', async () => {
    const a = await openApp(false);
    const offered = 'AAAAAAAAAAAAAAAAAAAAAA';
    const res = await a.inject({ method: 'POST', url: READER_LAB_RUNS_PATH, payload: { nonce: offered } });
    const first = (JSON.parse(res.body) as LabOpenAnswer).nonce;
    const second = await openRun(a);
    expect(first).not.toBe(offered);
    expect(second).not.toBe(first);
    const r = await readRun(a, offered);
    expect(r).toEqual({ ok: false, error: 'unknown-run' });
  });

  it('every probe answer is the same empty 204, by GET and POST, for a live, unknown, malformed, closed, expired or saturated run and an unknown name (M10.4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_784_600_000_000);
    const a = await openApp(false);
    const expired = await openRun(a);
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS - 1000);
    const live = await openRun(a);
    const closed = await openRun(a);
    await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${closed}/close` });
    const full = await openRun(a);
    for (let i = 0; i < READER_LAB_RUN_HITS_MAX; i += 1) await a.inject({ method: 'GET', url: readerLabProbePath(full, 'cookie-image') });
    vi.setSystemTime(1_784_600_000_000 + READER_LAB_RUN_TTL_MS);
    expect(await readRun(a, expired)).toEqual({ ok: false, error: 'unknown-run' });
    expect(counted(await readRun(a, full)).saturated).toBe(true);
    const urls = [
      readerLabProbePath(live, 'cookie-image'), `/api/reader-lab/probe/${live}/not-a-probe`, readerLabProbePath(UNKNOWN, 'cookie-image'),
      '/api/reader-lab/probe/x/cookie-image', readerLabProbePath(closed, 'cookie-image'), readerLabProbePath(expired, 'cookie-image'),
      readerLabProbePath(full, 'cookie-image'),
    ];
    const shapes = new Set<string>();
    for (const url of urls) {
      for (const method of ['GET', 'POST'] as const) {
        const res = await a.inject({ method, url, ...(method === 'POST' ? { payload: 'x', headers: { 'content-type': 'text/plain' } } : {}) });
        const what = `${method} ${url}`;
        expect(res.statusCode, what).toBe(204);
        expect(res.body, what).toBe('');
        expect(res.headers['cache-control'], what).toBe('no-store');
        expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-') || h === 'set-cookie'), what).toEqual([]);
        shapes.add(Object.keys(res.headers).filter((h) => h !== 'date').sort().join(','));
      }
    }
    expect([...shapes], 'every probe answer carries the same header names').toHaveLength(1);
    expect(counted(await readRun(a, live)).counted).toBe(4);
  }, 60_000);

  it('a POST probe whose body the server will not take still answers 204, and is counted (M10.4)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    const report = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'),
      payload: '{"csp-report":{}}', headers: { 'content-type': 'application/csp-report' } });
    const big = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-xhr'),
      payload: 'x'.repeat(4096), headers: { 'content-type': 'text/plain' } });
    expect([report.statusCode, report.body, big.statusCode, big.body]).toEqual([204, '', 204, '']);
    const run = counted(await readRun(a, nonce));
    expect([run.probes['cookie-beacon'].hits, run.probes['cookie-xhr'].hits]).toEqual([1, 1]);
  });

  it('armed: the counter keeps classes, never a value: the cookie by name, Sec-Fetch-Site and Origin (M10.7)', async () => {
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const withCookie = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-fetch'),
      headers: { cookie, 'sec-fetch-site': 'cross-site', origin: 'null' } });
    const bare = await a.inject({ method: 'GET', url: readerLabProbePath(nonce, 'cookie-image'),
      headers: { 'sec-fetch-site': 'same-origin' } });
    expect([withCookie.statusCode, bare.statusCode]).toEqual([204, 204]);
    const res = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie } });
    const run = counted(JSON.parse(res.body) as LabReadAnswer);
    expect(run.probes['cookie-fetch']).toMatchObject({ hits: 1, cookie: 1, upgrade: 0 });
    expect(run.probes['cookie-fetch'].site['cross-site']).toBe(1);
    expect(run.probes['cookie-fetch'].origin.null).toBe(1);
    expect(run.probes['cookie-image']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-image'].site['same-origin']).toBe(1);
    expect(run.probes['cookie-image'].origin.absent).toBe(1);
    expect(res.body, 'the read never carries the cookie\'s value').not.toContain(cookie.slice(cookie.indexOf('=') + 1));
  });

  it('armed: a frame\'s WebSocket upgrade to the probe is refused by the gate (403), logged by the gate once, and still counted (M10.3)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    await expect(a.injectWS(readerLabProbePath(nonce, 'cookie-websocket'), { headers: { origin: 'null' } }))
      .rejects.toThrow('Unexpected server response: 403');
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-websocket']).toMatchObject({ hits: 1, upgrade: 1, cookie: 0 });
    expect(run.probes['cookie-websocket'].origin.null).toBe(1);
    // The gate's own CSRF line, unchanged: on an armed box each lab frame's upgrade writes it once, which the design's
    // section 4.4 and the page call expected. The door adds no line of its own.
    const refusals = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'));
    expect(refusals, 'the gate logs one foreign-origin line for the upgrade').toHaveLength(1);
    expect(refusals[0]).toContain('refused a websocket upgrade from a foreign origin');
    expect(refusals[0]).toContain('"null"');
  });

  it('armed: a frame\'s POST probe from origin null skips the origin check (reason 8): the same 204, counted, and no refusal logged (M10.4)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const a = await openApp(true);
    const cookie = await login(a);
    const nonce = await openRun(a, cookie);
    const res = await a.inject({ method: 'POST', url: readerLabProbePath(nonce, 'cookie-beacon'), payload: 'x',
      headers: { origin: 'null', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' } });
    expect([res.statusCode, res.body, res.headers['cache-control']]).toEqual([204, '', 'no-store']);
    const run = counted(await readRun(a, nonce, cookie));
    expect(run.probes['cookie-beacon']).toMatchObject({ hits: 1, cookie: 0 });
    expect(run.probes['cookie-beacon'].origin.null).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('foreign origin'))).toEqual([]);
  });

  it('a run answers only the session that opened it: any other gets exactly the unknown-nonce answer, and cannot close it (M10.17)', async () => {
    const a = await openApp(false);
    const mine = 'ccrc_session=lab-a';
    const other = 'ccrc_session=lab-b';
    const nonce = await openRun(a, mine);
    const theirs = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}`, headers: { cookie: other } });
    const unknown = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${UNKNOWN}`, headers: { cookie: mine } });
    expect([theirs.statusCode, theirs.body]).toEqual([unknown.statusCode, unknown.body]);
    expect(theirs.statusCode).toBe(404);
    const anon = await a.inject({ method: 'GET', url: `${READER_LAB_RUNS_PATH}/${nonce}` });
    expect(anon.statusCode, 'a caller with no session is another owner').toBe(404);
    const closed = await a.inject({ method: 'POST', url: `${READER_LAB_RUNS_PATH}/${nonce}/close`, headers: { cookie: other } });
    expect(JSON.parse(closed.body)).toEqual({ ok: true, closed: false });
    expect(counted(await readRun(a, nonce, mine)).counted).toBe(0);
    // The owner is a one-way digest: never the cookie, stable for one session, distinct between two; no cookie is one owner.
    expect(labOwnerOf(mine)).not.toContain('lab-a');
    expect(labOwnerOf(mine)).toBe(labOwnerOf(`${mine}; theme=dark`));
    expect(labOwnerOf(mine)).not.toBe(labOwnerOf(other));
    expect(labOwnerOf(undefined)).toBe(labOwnerOf('theme=dark'));
  });

  it('a CORS preflight to the probe is never approved: no CORS header, a refusal, and nothing counted, dark or armed', async () => {
    // The cookie check's marker request needs this preflight; the browser case cannot see it, because Playwright answers
    // preflights itself while it intercepts requests, so the refusal is pinned here, at the server.
    for (const armed of [false, true]) {
      const a = await openApp(armed);
      const cookie = armed ? await login(a) : undefined;
      const nonce = await openRun(a, cookie);
      const res = await a.inject({ method: 'OPTIONS', url: readerLabProbePath(nonce, 'cookie-fetch-marker'), headers: {
        origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': DOCS_REQUEST_HEADER } });
      expect(res.statusCode, `armed ${armed}`).toBeGreaterThanOrEqual(400);
      expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')), `armed ${armed}`).toEqual([]);
      expect(counted(await readRun(a, nonce, cookie)).counted, `armed ${armed}`).toBe(0);
      await a.close();
      app = undefined;
    }
  });

  it('with no run open under a nonce, probes naming it record nothing anywhere (M10.5)', async () => {
    const a = await openApp(false);
    const nonce = await openRun(a);
    for (const name of ['cookie-image', 'busy-start', 'csp-canary'] as const) {
      await a.inject({ method: 'GET', url: readerLabProbePath(UNKNOWN, name) });
    }
    const run = counted(await readRun(a, nonce));
    expect([run.counted, run.ignored]).toEqual([0, 0]);
  });

  it('the probe pair is EXEMPT under reason 8; the run routes are not (M10.8)', () => {
    for (const k of [`GET ${READER_LAB_PROBE_ROUTE}`, `POST ${READER_LAB_PROBE_ROUTE}`]) {
      expect(EXEMPT.has(k), k).toBe(true);
      expect(EXEMPT.get(k), k).toContain('reason 8');
      expect(EXEMPT.get(k), k).not.toContain('EXEMPT-BUT-AUTHENTICATED');
    }
    for (const k of [`POST ${READER_LAB_RUNS_PATH}`, `GET ${READER_LAB_RUNS_PATH}/:nonce`, `POST ${READER_LAB_RUNS_PATH}/:nonce/close`]) {
      expect(EXEMPT.has(k), k).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-routes.test.ts )` through `ccrc test` — Expected (prediction): the file fails to load (`Cannot find module '../src/readerLab/routes.js'`), `Test Files  1 failed (1)`.
- [ ] **Step 3: Write `server/src/readerLab/routes.ts`** with exactly this content:

```ts
// The reader lab's door (native Docs reader, the reader lab plan of 2026-11-03, Task 3; the reader lab design, section
// 4; the rich-docs spec's rows M10.2 to M10.8). Ring L4: the counter hook and the five registrations over `runs.ts`.
//
// The three run routes are the lab page's and are session-gated like every route not in `EXEMPT`: a session opens a
// run and is handed a nonce minted here, reads the run's counts, and closes it. A run is bound to the session that opened
// it through a one-way digest of its cookie (`labOwnerOf`), never the cookie itself: any other session's read or close
// answers exactly as an unknown nonce's does. The door is present on every box and inert until a session opens a run.
// The probe pair is `EXEMPT` (gate.ts
// reason 8): its callers are the lab's sandboxed frames, whose requests carry no session cookie by design. Every probe
// answer is one `204` with no body and `no-store`, whatever the nonce, the run or the name, by GET or POST, a refused
// body included, so a probe learns nothing. The counter is an `onRequest` hook the composition root adds immediately
// BEFORE the gate's, so a probe the gate refuses (a frame's WebSocket upgrade, `Origin: null`, on an armed box) is still
// counted. It never answers, reads no body and awaits nothing; the gate still decides every request. The door logs
// nothing of its own; on an armed box the gate's foreign-origin line for a frame's WebSocket upgrade is the gate's.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, parseCookies } from '../auth/cookie.js';
import {
  READER_LAB_PROBE_ROUTE, type LabCloseAnswer, type LabOpenAnswer, type LabReadAnswer,
} from '../../../shared/readerLab.js';
import { READER_LAB_RUN_TTL_MS, labOriginClass, labSiteClass, type ReaderLabRuns } from './runs.js';

const NO_STORE = 'no-store';

/** What Fastify may buffer of a probe POST before the handler, which never reads it. */
export const READER_LAB_PROBE_BODY_MAX = 1024;

/** The owner of every run opened without a session cookie: a box with the gate dark, where every route is open to anyone
 *  who reaches the port, and so is a run to anyone who holds its nonce. */
export const LAB_NO_SESSION = '-';

/** A run's owner: a one-way digest of the session cookie's value, prefixed so it is never the session store's own key,
 *  or LAB_NO_SESSION when the request carries none. The store keeps this, never the cookie. */
export function labOwnerOf(cookieHeader: string | undefined): string {
  const token = parseCookies(cookieHeader).get(SESSION_COOKIE);
  return token === undefined || token === '' ? LAB_NO_SESSION : createHash('sha256').update(`reader-lab:${token}`).digest('base64url');
}

/** The probe's one answer. */
const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).send();

/** The counter. `server.ts#buildServer` calls this immediately before `installGate`. */
export function installReaderLabCounter(app: FastifyInstance, runs: ReaderLabRuns): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return;
    const params = req.params as { readonly nonce?: unknown; readonly name?: unknown };
    if (typeof params.nonce !== 'string' || typeof params.name !== 'string') return;
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    runs.count(params.nonce, params.name, {
      cookie: token !== undefined && token !== '',
      upgrade: req.ws === true,
      site: labSiteClass(req.headers['sec-fetch-site']),
      origin: labOriginClass(req.headers.origin),
    }, Date.now());
  });
}

/** The three run routes and the probe pair, registered on the root instance. */
export function registerReaderLabRoutes(app: FastifyInstance, runs: ReaderLabRuns): void {
  app.post('/api/reader-lab/runs', async (req, reply) => {
    const nonce = randomBytes(16).toString('base64url');
    runs.open(nonce, labOwnerOf(req.headers.cookie), Date.now());
    return reply.code(200).header('cache-control', NO_STORE)
      .send({ ok: true, nonce, ttlMs: READER_LAB_RUN_TTL_MS } satisfies LabOpenAnswer);
  });

  app.get('/api/reader-lab/runs/:nonce', { exposeHeadRoute: false }, async (req, reply) => {
    const run = runs.read((req.params as { readonly nonce: string }).nonce, labOwnerOf(req.headers.cookie), Date.now());
    const answer: LabReadAnswer = run === null ? { ok: false, error: 'unknown-run' } : { ok: true, run };
    return reply.code(run === null ? 404 : 200).header('cache-control', NO_STORE).send(answer);
  });

  app.post('/api/reader-lab/runs/:nonce/close', async (req, reply) => reply.code(200).header('cache-control', NO_STORE)
    .send({ ok: true, closed: runs.close((req.params as { readonly nonce: string }).nonce, labOwnerOf(req.headers.cookie)) } satisfies LabCloseAnswer));

  app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));

  app.post('/api/reader-lab/probe/:nonce/:name', {
    bodyLimit: READER_LAB_PROBE_BODY_MAX,
    // A body Fastify refuses before the handler (a 413, a 415, a parse 400) answers exactly as an accepted one does.
    errorHandler: (_err, _req, reply) => probeAnswer(reply),
  }, async (_req, reply) => probeAnswer(reply));
}
```

- [ ] **Step 4: Wire it in `server/src/server.ts`.**
  Find:
```ts
import { installDocsRequestPolicy, installDocsResponsePolicy } from './docs/hooks.js';
```
  Replace:
```ts
import { installDocsRequestPolicy, installDocsResponsePolicy } from './docs/hooks.js';
import { createReaderLabRuns } from './readerLab/runs.js';
import { installReaderLabCounter, registerReaderLabRoutes } from './readerLab/routes.js';
```
  Find:
```ts
  // Unconditional — the flag is decided INSIDE the hook (`authVerdict`'s first
```
  Replace:
```ts
  // The reader lab's door (the reader lab design, section 4): its counter is an onRequest hook added HERE, before the
  // gate's, so a probe the gate refuses (a sandboxed frame's WebSocket upgrade on an armed box) is still counted. It only
  // counts, for a run a session opened, and never answers: the gate below still decides every request. Its routes are
  // registered after the docs plugin.
  const readerLab = createReaderLabRuns();
  installReaderLabCounter(app, readerLab);
  // Unconditional — the flag is decided INSIDE the hook (`authVerdict`'s first
```
  Find:
```ts
    registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);
  });
```
  Replace:
```ts
    registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);
  });
  registerReaderLabRoutes(app, readerLab);
```
- [ ] **Step 5: The gate's table and text, `server/src/auth/gate.ts`.**
  Find:
```ts
 * THE GATE. One `onRequest` hook stands in front of all 167 routes, the static
```
  Replace:
```ts
 * THE GATE. One `onRequest` hook stands in front of all 172 routes, the static
```
  Find: ` * THE SEVEN REASONS, and there are only seven:`
  Replace: ` * THE EIGHT REASONS, and there are only eight:`
  Find:
```ts
 *     live-code compare running before any budget (`token/door.ts`). Being exempt
 *     it also skips the origin check, which is right for a machine caller.
```
  Replace:
```ts
 *     live-code compare running before any budget (`token/door.ts`). Being exempt
 *     it also skips the origin check, which is right for a machine caller.
 *
 *  8. `GET` and `POST /api/reader-lab/probe/:nonce/:name` — the reader lab's probe
 *     (the reader lab design, section 4). Its callers are sandboxed frames the lab
 *     page builds, whose requests carry no session cookie BY DESIGN: whether one
 *     ever does is the thing measured, so a gated probe would count nothing. It is
 *     not a door into anything. It answers every request `204` with no body and the
 *     same headers, reads no body, sets no cookie and no CORS header, and changes
 *     nothing but the counters of a lab run that a signed-in session opened (the
 *     open, read and close routes are NOT here), named by a nonce the server minted
 *     from sixteen random bytes, for at most the life `readerLab/runs.ts` derives
 *     from the lab's own caps; with no run open it counts nothing. It is a permanent
 *     surface on every box, inert until a session opens a run. Being exempt it also
 *     skips the origin check, on purpose: its callers send origin `null`, and
 *     `needsOriginCheck`'s note below says why that costs nothing. Its counter
 *     (`readerLab/routes.ts#installReaderLabCounter`) is an `onRequest` hook added
 *     just before this file's: it counts and never answers, so a probe this gate
 *     refuses (a frame's WebSocket upgrade, origin `null`) is still counted, and the
 *     decision, with its journal line, stays here.
```
  Find:
```ts
 * and nothing caught it because the scanner reads numerals.)
 *
```
  Replace (one sentence after the order-pinned span, with no number word in it):
```ts
 * and nothing caught it because the scanner reads numerals.)
 *
 * The reader lab's probe (reason 8 above) is the one exempt write a browser calls
 * cross-origin: its sandboxed frames send `Origin: null`. It skips this check on
 * purpose, because it changes only a nonce-named counter, and counting what such a
 * request carries is its whole point.
 *
```
  Find:
```ts
  ['GET /*',
```
  Replace:
```ts
  ['GET /api/reader-lab/probe/:nonce/:name',
    "the reader lab's probe, reason 8: a sandboxed frame's request carries no cookie by design, and counting what it " +
    'carries is the point. It answers every request 204 with no body, reads no body, sets nothing, and only counts, in ' +
    'memory, for a run a session opened, whose nonce the request names (readerLab/routes.ts)'],
  ['POST /api/reader-lab/probe/:nonce/:name',
    "the reader lab's probe, reason 8, its POST half: the beacon, XHR and fetch POST channels a frame sends. The same " +
    '204 and the same count; the body is never read, and a body the server refuses still answers 204'],

  ['GET /*',
```
- [ ] **Step 6: The route census, `server/test/auth-gate.test.ts`.**
  Find: `/** NINE files register routes since the programme ledgers' PL3`
  Replace:
```ts
/** TEN files register routes since the reader lab's door (`server/src/readerLab/routes.ts`, the reader lab plan Task 3: its three run routes and the probe pair); NINE since the programme ledgers' PL3
```
  Find:
```ts
  ...scanRoutes('linear/proxyRoutes.ts'),
];
```
  Replace:
```ts
  ...scanRoutes('linear/proxyRoutes.ts'),
  ...scanRoutes('readerLab/routes.ts'),
];
```
  Find: `  it('found all nine files, and EXACTLY the route count the surface has', () => {`
  Replace: `  it('found all ten files, and EXACTLY the route count the surface has', () => {`
  Find: `    expect(ROUTES.length).toBe(170);`
  Replace:
```ts
    // 175 since the reader lab's door (the reader lab plan, Task 3), in a tenth file: three session-gated routes, NOT EXEMPT,
    // and the probe pair, IN EXEMPT (gate.ts reason 8), no box token: the HTTP half 167 -> 172, the gated count 103 -> 106,
    // the exempt-HTTP count 64 -> 66.
    expect(ROUTES.length).toBe(175);
```
  Find: `    expect(scanRoutes('linear/proxyRoutes.ts').length).toBe(12);`
  Replace:
```ts
    expect(scanRoutes('linear/proxyRoutes.ts').length).toBe(12);
    // 5 in `readerLab/routes.ts` (the reader lab plan, Task 3): `POST /api/reader-lab/runs`, `GET …/runs/:nonce` and
    // `POST …/runs/:nonce/close`, session-gated and NOT EXEMPT; `GET` and `POST /api/reader-lab/probe/:nonce/:name`, IN
    // EXEMPT under reason 8. None consults the box token.
    expect(scanRoutes('readerLab/routes.ts').length).toBe(5);
```
  Find:
```ts
      'POST /api/programmes/:slug/modifications/merged',
    ]) expect(keys, `${k} was not found by the scanner`).toContain(k);
```
  Replace:
```ts
      'POST /api/programmes/:slug/modifications/merged',
      // The tenth file's five (the reader lab's door): a scanner that stopped reading `readerLab/routes.ts` would lose them all.
      'POST /api/reader-lab/runs', 'GET /api/reader-lab/runs/:nonce', 'POST /api/reader-lab/runs/:nonce/close',
      'GET /api/reader-lab/probe/:nonce/:name', 'POST /api/reader-lab/probe/:nonce/:name',
    ]) expect(keys, `${k} was not found by the scanner`).toContain(k);
```
  Find: `    // 170 scanned + the static wildcard when the bundle is built.`
  Replace: `    // 175 scanned + the static wildcard when the bundle is built.`
  Find: `  it('exempts exactly the seven classes the plan names — nothing has crept in', () => {`
  Replace: `  it('exempts exactly the eight classes the plan names — nothing has crept in', () => {`
  Find: `    expect([...EXEMPT.keys()].sort()).toEqual([`
  Replace:
```ts
    // The reader lab's probe pair (the reader lab plan, Task 3) opened the EIGHTH class: a probe that authenticates nobody
    // and grants nothing, answering one empty 204 and counting arrivals for a run a session opened (gate.ts reason 8).
    // The three run routes beside it are DELIBERATELY NOT here: opening, reading and closing a run need a session.
    expect([...EXEMPT.keys()].sort()).toEqual([
```
  Find:
```ts
      'GET /api/programmes/:slug/items',
      'GET /api/runs',
```
  Replace:
```ts
      'GET /api/programmes/:slug/items',
      'GET /api/reader-lab/probe/:nonce/:name',
      'GET /api/runs',
```
  Find:
```ts
      'POST /api/questions/:id/rule',
      'POST /api/runs',
```
  Replace:
```ts
      'POST /api/questions/:id/rule',
      'POST /api/reader-lab/probe/:nonce/:name',
      'POST /api/runs',
```
  Find: `    // THE PROPERTY, in one loop over all 167 HTTP routes, with THREE probes each:`
  Replace: `    // THE PROPERTY, in one loop over all 172 HTTP routes, with THREE probes each:`
  Find: `          //    is not itself flag-aware — the assertion that covers all 167 HTTP routes, not the 64 exempt.`
  Replace: `          //    is not itself flag-aware — the assertion that covers all 172 HTTP routes, not the 66 exempt.`
- [ ] **Step 7: The fastify allowlist, `server/test/rings/fastify-l4.data.ts`.**
  Find:
```ts
  'server/src/update/routes.ts': { reason: "the update control plane's HTTP routes", since: '2026-10-20' },
};
```
  Replace (the `since` value is the commit's UTC date, `date -u +%F`, written as measured):
```ts
  'server/src/update/routes.ts': { reason: "the update control plane's HTTP routes", since: '2026-10-20' },
  'server/src/readerLab/routes.ts': { reason: "the reader lab door's counter hook and HTTP routes (the reader lab plan, Task 3)", since: '<the commit date>' },
};
```
- [ ] **Step 8: Run it to see it pass.** `( cd server && ./node_modules/.bin/vitest run test/reader-lab-routes.test.ts )` through `ccrc test` — Expected (prediction): `Tests  12 passed (12)`. The armed POST case is a prediction about the real gate: the probe pair is `EXEMPT`, so `needsOriginCheck` skips it and the answer is the same `204`; if the measured answer is a refusal instead, that is a stop-and-ask, never an edit to the test's expectation. Then, each alone through `ccrc test`: `test/auth-gate.test.ts` (its count equal to BASE: no case is added there, only expectations move), `test/rings/fastify-l4.test.ts`, `test/rings/exemption-age.test.ts`, `test/rings/outward-edges.test.ts`, `test/rings/totality.test.ts`, `test/box-token-census.test.ts`, `test/coord-pause-route.test.ts`, `test/auth-passkey.test.ts` — green, counts equal to Step 0's. `SERVER-TSC-OK`. A census in another file that reds on the new routes is a stop-and-ask, never a silent edit.
- [ ] **Step 9: The counter's position, measured once by hand.** In the workspace, move the two lines `  const readerLab = createReaderLabRuns();` and `  installReaderLabCounter(app, readerLab);` (save `server.ts` first, as a mutation row's discipline) to just after `installGate(app, { … });`'s closing line, run `test/reader-lab-routes.test.ts`, record the red (prediction: `1 failed` — the armed WebSocket case, counted 0; the armed POST case stays green, since the gate lets that exempt request through and a counter after it still counts it), restore from the saved copy and check its sha256. This is the order half of M10.3, which a one-hunk row cannot express; RLB-T3-M2 below is the deletion half.
- [ ] **Step 10: Commit.** `git add server/src/readerLab/routes.ts server/test/reader-lab-routes.test.ts server/src/server.ts server/src/auth/gate.ts server/test/auth-gate.test.ts server/test/rings/fastify-l4.data.ts` (expect 6), message `server: the reader lab's door: session-gated runs, an exempt probe, a counter before the gate (docs reader lab)`, trailer. Record the task's JSON row fence and Step 9's figure, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `server`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| RLB-T3-M1 | (c) M10.3 | `src/readerLab/routes.ts` | `if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return;` → `if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return; if (req.ws === true) throw Object.assign(new Error('planted'), { statusCode: 204 });` | `test/reader-lab-routes.test.ts` | 1 failed — `'armed: a frame\'s WebSocket upgrade to the probe is refused by the gate (403), logged by the gate once, and still counted (M10.3)'` (the counter answered before the gate) |
| RLB-T3-M2 | (c) M10.3 | `src/server.ts` | `installReaderLabCounter(app, readerLab);` → removed | `test/reader-lab-routes.test.ts` | 5 failed — the five cases that read a non-zero count (`'every probe answer is the same empty 204, …'`, `'a POST probe whose body …'`, `'armed: the counter keeps classes, …'`, `'armed: a frame\'s WebSocket upgrade …'`, `'armed: a frame\'s POST probe from origin null …'`) |
| RLB-T3-M3 | (f) M10.4 | `src/readerLab/routes.ts` | `app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));` → `app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => reply.code(200).send({ ok: true }));` | `test/reader-lab-routes.test.ts` | 1 failed — `'every probe answer is the same empty 204, …'` |
| RLB-T3-M4 | (f) M10.4 | `src/readerLab/routes.ts` | `errorHandler: (_err, _req, reply) => probeAnswer(reply),` → removed | `test/reader-lab-routes.test.ts` | 1 failed — `'a POST probe whose body the server will not take still answers 204, …'` |
| RLB-T3-M5 | (f) M10.4 | `src/readerLab/routes.ts` | `const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).send();` → `const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).header('access-control-allow-origin', '*').send();` | `test/reader-lab-routes.test.ts` | 1 failed — `'every probe answer is the same empty 204, …'` |
| RLB-T3-M6 | (b) M10.8 | `src/auth/gate.ts` | `['GET /api/reader-lab/probe/:nonce/:name',` → `['POST /api/reader-lab/runs', 'a planted exemption of the run route, long enough to read as a reason for the gate table'],\n  ['GET /api/reader-lab/probe/:nonce/:name',` | `test/reader-lab-routes.test.ts`, `test/auth-gate.test.ts` | 2+ failed — `'armed: a session opens, reads and closes a run; …'`, `'the probe pair is EXEMPT under reason 8; the run routes are not (M10.8)'`, and in `auth-gate.test.ts` `'exempts exactly the eight classes …'` (and the property sweep's armed-anonymous arm) |
| RLB-T3-M7 | (b) M10.8 | `src/readerLab/routes.ts` | `const nonce = randomBytes(16).toString('base64url');` → `const nonce = typeof (req.body as { nonce?: unknown } \| undefined)?.nonce === 'string' ? String((req.body as { nonce: string }).nonce) : randomBytes(16).toString('base64url');` | `test/reader-lab-routes.test.ts` | 1 failed — `'the server mints every nonce: …'` |
| RLB-T3-M8 | (d) M10.17 | `src/readerLab/routes.ts` | ``return token === undefined \|\| token === '' ? LAB_NO_SESSION : createHash('sha256').update(`reader-lab:${token}`).digest('base64url');`` → `return LAB_NO_SESSION;` | `test/reader-lab-routes.test.ts` | 1 failed — `'a run answers only the session that opened it: …'` |
| RLB-T3-M9 | (f) M10.4 | `src/readerLab/routes.ts` | `app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));` → `app.options('/api/reader-lab/probe/:nonce/:name', async (_req, reply) => reply.code(204).header('access-control-allow-origin', '*').header('access-control-allow-headers', '*').send()); app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));` | `test/reader-lab-routes.test.ts` | 1 failed — `'a CORS preflight to the probe is never approved: …'` (its dark half; on the armed box the gate's 401 still answers first) |

```json
[
  {"id": "RLB-T3-M1", "spec": "(c) M10.3", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return;", "new": "if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return; if (req.ws === true) throw Object.assign(new Error('planted'), { statusCode: 204 });", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: armed: a frame's WebSocket upgrade to the probe is refused by the gate (403), logged by the gate once, and still counted (M10.3)"},
  {"id": "RLB-T3-M2", "spec": "(c) M10.3", "pkg": "server", "file": "src/server.ts", "old": "installReaderLabCounter(app, readerLab);", "new": "", "tests": ["test/reader-lab-routes.test.ts"], "red": "5 failed: every probe answer is the same empty 204; a POST probe whose body the server will not take; armed: the counter keeps classes; armed: a frame's WebSocket upgrade; armed: a frame's POST probe from origin null"},
  {"id": "RLB-T3-M3", "spec": "(f) M10.4", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));", "new": "app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => reply.code(200).send({ ok: true }));", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: every probe answer is the same empty 204"},
  {"id": "RLB-T3-M4", "spec": "(f) M10.4", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "errorHandler: (_err, _req, reply) => probeAnswer(reply),", "new": "", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: a POST probe whose body the server will not take still answers 204"},
  {"id": "RLB-T3-M5", "spec": "(f) M10.4", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).send();", "new": "const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).header('access-control-allow-origin', '*').send();", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: every probe answer is the same empty 204"},
  {"id": "RLB-T3-M6", "spec": "(b) M10.8", "pkg": "server", "file": "src/auth/gate.ts", "old": "['GET /api/reader-lab/probe/:nonce/:name',", "new": "['POST /api/reader-lab/runs', 'a planted exemption of the run route, long enough to read as a reason for the gate table'],\n  ['GET /api/reader-lab/probe/:nonce/:name',", "tests": ["test/reader-lab-routes.test.ts", "test/auth-gate.test.ts"], "red": "2+ failed: armed: a session opens, reads and closes a run; the probe pair is EXEMPT under reason 8; exempts exactly the eight classes"},
  {"id": "RLB-T3-M7", "spec": "(b) M10.2", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "const nonce = randomBytes(16).toString('base64url');", "new": "const nonce = typeof (req.body as { nonce?: unknown } | undefined)?.nonce === 'string' ? String((req.body as { nonce: string }).nonce) : randomBytes(16).toString('base64url');", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: the server mints every nonce"},
  {"id": "RLB-T3-M8", "spec": "(d) M10.17", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "return token === undefined || token === '' ? LAB_NO_SESSION : createHash('sha256').update(`reader-lab:${token}`).digest('base64url');", "new": "return LAB_NO_SESSION;", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: a run answers only the session that opened it"},
  {"id": "RLB-T3-M9", "spec": "(f) M10.4", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));", "new": "app.options('/api/reader-lab/probe/:nonce/:name', async (_req, reply) => reply.code(204).header('access-control-allow-origin', '*').header('access-control-allow-headers', '*').send()); app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));", "tests": ["test/reader-lab-routes.test.ts"], "red": "1 failed: a CORS preflight to the probe is never approved"}
]
```

RLB-T3-M7's `new` reads `req`, the open handler's own parameter name, so it compiles as written. RLB-T3-M9 plants a preflight answer; the planted `app.options` call is not one the route census reads, and the row's tests do not include `auth-gate.test.ts`. The order half of M10.3 is Step 9's measured figure.

**Verify:** `test/reader-lab-routes.test.ts` 12 passed; `auth-gate`, the rings, `box-token-census`, `coord-pause-route` and `auth-passkey` green at their BASE counts; `SERVER-TSC-OK`; Step 9 recorded.

### Task 4: The lab surface in the box-token census, and the README's auth paragraph (refinement (b); M10.8)

**Run:** RL-a. **Model routing:** `sonnet`, effort `medium`; per-task reviewer `opus` (the census must see what it claims to see).

**Files:**
- Modify: `server/test/box-token-census.test.ts` (one appended describe), `README.md` (one sentence in the auth paragraph).
- Guards (not edited): `server/test/auth-gate.test.ts`, `server/test/coord-pause-route.test.ts`, `server/test/topology-clean.test.ts`, `server/test/ccrc-settings-census.test.ts`.

**Decisions:** (1) The lab surface joins neither `ALL_LANES` nor `SESSION_ONLY_ALL`: it is no coordination write, so no number word moves and `CLAUDE.md` owes it no sentence (the docs surface's stance). (2) The README sentence carries no number word (the census reads the paragraph's number words in sequence) and names the probe by its backticked path, which the new case reads.

- [ ] **Step 0: Base.** `git grep -qF "describe('the docs surface: four session-gated doors, no box token, no /docs route (spec 2026-10-01 §3.13)', () => {" HEAD -- server/test/box-token-census.test.ts && git grep -qF '`GET /api/auth/status` (with a minimized anonymous body), and `GET /*`, the' HEAD -- README.md && test -f server/src/readerLab/routes.ts && echo T4-BASE-OK` — Expected: `T4-BASE-OK`. Confirm the claims on both files. Run `test/box-token-census.test.ts` alone and record its count.
- [ ] **Step 1: Write the failing cases.** Append at the end of `server/test/box-token-census.test.ts`:

```ts

// ── the reader lab's door (the reader lab plan of 2026-11-03, Task 4) ─────────
//
// `server/src/readerLab/routes.ts` is the TENTH file that registers routes. Its three run routes are session-gated, NOT
// EXEMPT, and consult no box token; its probe pair is EXEMPT under gate.ts reason 8 and consults none either. So no lane,
// no door count and no CLAUDE.md sentence moves: the door is no coordination write, as the docs surface is not. EVERY
// file under `server/src/readerLab/` is read, as the docs surface's are: a token check in the counter would gate the
// probe as surely as one in a handler. README's auth paragraph names the probe among the exceptions.
describe('the reader lab door: three session-gated routes, an exempt probe pair, no box token (reader lab plan, Task 4)', () => {
  const LAB_SRC = read('server/src/readerLab/routes.ts');
  /** Every source file of the lab surface, by listing the directory, so a file added there is read without an edit here. */
  const LAB_FILES = readdirSync(path.join(REPO, 'server', 'src', 'readerLab'))
    .filter((f) => f.endsWith('.ts')).sort().map((f) => `server/src/readerLab/${f}`);
  /** The five doors. Hand-kept for the NAMES only: the first case derives the same set from the file, both directions. */
  const LAB_DOORS = ['POST /api/reader-lab/runs', 'GET /api/reader-lab/runs/:nonce', 'POST /api/reader-lab/runs/:nonce/close',
    'GET /api/reader-lab/probe/:nonce/:name', 'POST /api/reader-lab/probe/:nonce/:name'];
  const PROBE_PAIR = ['GET /api/reader-lab/probe/:nonce/:name', 'POST /api/reader-lab/probe/:nonce/:name'];
  const REGISTERED = registrationsIn(LAB_SRC).map((r) => r.key);
  /** The registration line the planted-call control anchors on (the plan's fixed registration text). */
  const OPEN_LINE = "app.post('/api/reader-lab/runs', async (req, reply) => {";

  it('readerLab/routes.ts registers exactly the five doors, each once, and every lab file is read', () => {
    expect(new Set(REGISTERED).size, 'a lab route is registered twice').toBe(REGISTERED.length);
    expect([...REGISTERED].sort(), 'readerLab/routes.ts and LAB_DOORS disagree').toEqual([...LAB_DOORS].sort());
    expect(LAB_FILES).toEqual(['server/src/readerLab/routes.ts', 'server/src/readerLab/runs.ts']);
  });

  it('no lab file consults the box token, and no lab handler is a lane', () => {
    for (const rel of LAB_FILES) {
      const src = read(rel);
      for (const re of GATE_PATTERNS) expect(re.test(src), `${rel} consults the box token (${re.source})`).toBe(false);
    }
    expect(lanesIn(LAB_SRC)).toEqual([]);
  });

  it('the probe pair is EXEMPT with reason 8, the run routes are not, and none claims a token or the cookie-or-token class', () => {
    for (const k of LAB_DOORS) {
      const at = GATE_SRC.indexOf(`  ['${k}',`);
      if (!PROBE_PAIR.includes(k)) {
        expect(at, `${k} became EXEMPT`).toBe(-1);
        continue;
      }
      expect(at, `${k} is not EXEMPT`).toBeGreaterThan(-1);
      const reason = GATE_SRC.slice(at, GATE_SRC.indexOf('],', at));
      expect(reason, k).toContain('reason 8');
      expect(reason, k).not.toContain('EXEMPT-BUT-AUTHENTICATED');
      expect(reason, k).not.toContain('box-token gated');
    }
  });

  it("README's auth paragraph names the probe among the exceptions", () => {
    const p = passage('README, the auth paragraph', README, 'What is gated, and what is not:', 'Enrolling a passkey');
    expect(p).toContain('`/api/reader-lab/probe/:nonce/:name`');
  });

  it('a box-token call planted after the open registration is SEEN: the lane source is live', () => {
    expect(LAB_SRC, 'the open registration line moved: re-point this control at it').toContain(OPEN_LINE);
    const planted = LAB_SRC.replace(OPEN_LINE, `${OPEN_LINE}\n    requireMailToken(req, reply);`);
    expect(lanesIn(planted)).toEqual(['POST /api/reader-lab/runs']);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts )` — Expected (prediction): `1 failed`, `"README's auth paragraph names the probe among the exceptions"`; the other four new cases pass (Task 3 built what they read), and every case at BASE stays green.
- [ ] **Step 3: The README sentence.** In `README.md`:
  Find:
```md
`GET /api/auth/status` (with a minimized anonymous body), and `GET /*`, the
```
  Replace:
```md
`GET /api/auth/status` (with a minimized anonymous body), the reader lab's probe
`/api/reader-lab/probe/:nonce/:name` (a sandboxed frame's request, answered with the same empty `204`
whatever it names, which only counts arrivals for a lab run a signed-in session opened), and `GET /*`, the
```
- [ ] **Step 4: Run it to see it pass.** `( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts )` — Expected (prediction): its BASE count plus 5, all passed. Then `test/auth-gate.test.ts`, `test/coord-pause-route.test.ts`, `test/topology-clean.test.ts` and `test/ccrc-settings-census.test.ts`, each alone through `ccrc test`, after `git fetch -q origin main` — green.
- [ ] **Step 5: Commit.** `git add server/test/box-token-census.test.ts README.md` (expect 2), message `server: the reader lab door in the box-token census, and the README's exceptions (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes:**

| id | spec | pkg | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|---|
| RLB-T4-M1 | (b) M10.8 | server | `src/readerLab/routes.ts` | `const NO_STORE = 'no-store';` → `const NO_STORE = 'no-store'; // checkMailToken(` | `test/box-token-census.test.ts` | 1 failed — `'no lab file consults the box token, and no lab handler is a lane'` |
| RLB-T4-M2 | (b) M10.8 | server | `../README.md` | `` `/api/reader-lab/probe/:nonce/:name` (a sandboxed frame's request, answered with the same empty `204` `` → `` the lab's probe path (a sandboxed frame's request, answered with the same empty `204` `` | `test/box-token-census.test.ts` | 1 failed — `"README's auth paragraph names the probe among the exceptions"` |

```json
[
  {"id": "RLB-T4-M1", "spec": "(b) M10.8", "pkg": "server", "file": "src/readerLab/routes.ts", "old": "const NO_STORE = 'no-store';", "new": "const NO_STORE = 'no-store'; // checkMailToken(", "tests": ["test/box-token-census.test.ts"], "red": "1 failed: no lab file consults the box token, and no lab handler is a lane"},
  {"id": "RLB-T4-M2", "spec": "(b) M10.8", "pkg": "server", "file": "../README.md", "old": "`/api/reader-lab/probe/:nonce/:name` (a sandboxed frame's request, answered with the same empty `204`", "new": "the lab's probe path (a sandboxed frame's request, answered with the same empty `204`", "tests": ["test/box-token-census.test.ts"], "red": "1 failed: README's auth paragraph names the probe among the exceptions"}
]
```

**Verify:** `test/box-token-census.test.ts` its BASE count plus 5; the guards green.

### Task 5: Close RL-a — review, suites, the mutation table, results, push and the one PR

**Run:** RL-a. **Model routing:** the main loop (Opus); review lenses as "How this wave runs" names them; `sonnet` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Two `opus` lenses over `BASE..HEAD` against this plan and the design's section 4: (1) the door's security contract, property by property (who can open, read or close, and the run's binding to its opener; what a probe can learn; the uniform answer, expired, saturated and armed-POST cases included; the preflight never approved; the counter's position and that it never answers; the bounds, the life derived from the caps; what is kept and for how long; the gate's expected journal line; inert until a run opens), each tied to the test that proves it and the row that reds without it; (2) the census and the gate's text (reason 8 beside the seven, the `needsOriginCheck` sentence outside its order-pinned span, the route counts, the `EXEMPT` list, the box-token census, the README sentence, the context row, the fastify allowlist). One `sonnet` lens: the tests and rows, the predictions against the measured reds, and the public-repo scan of every changed file. Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix. A fix that moves a row's measured red restates that row (it takes no number).
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit: `git fetch -q origin main`, then the WHOLE `server` suite in pieces (not a list: the PR's CI selection runs suites a list misses), `typecheck-tests` alone, `SERVER-TSC-OK`; a red census in a file outside this run's Scope is a stop-and-ask, never a silent edit; re-run any known load flake alone before calling it broken. The `pwa` suite is not run: RL-a changes no PWA file, and `shared/readerLab.ts` is imported by no PWA file until RL-b.
- [ ] **Step 3: The mutation table** of Tasks 1-4 at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row; re-measure Task 3 Step 9's order figure once at the end state.
- [ ] **Step 4: Define the deviations.** Replace `## Deviations found`'s RL-a placeholder with the issued numbers for refinements (a), (b) and (c), in that order, then any found while executing (entry form: `- **D-<n> (<date>)** — <slug>. <what departs from which sentence, and why>. <Task and rows that apply it>.`), and write the unused ones without their prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green (the guard reads tracked files only).
- [ ] **Step 5: Draft `## Results` (RL-a)** in this plan in the working tree: the counts per suite; every task's JSON row fence as measured; Task 3 Step 9's order figure; "Named, without a number" (choices that filled a silence while executing); "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-reader-lab/pr-body-rl-a.md` (gitignored): title `server: the reader lab's door (a session-opened, nonce-scoped probe counter)`; what ships; the design's section 4 contract as a short table; that it changes nothing until a run is opened; the expected CI (the PR's selection; `test (server)`; the census files); this plan's and the design's GitHub `blob/main` links; ending with the attribution line the dispatch gives.
- [ ] **Step 6: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan) and the drafted PR body with the scan the dispatch names: rc 0, zero hits. A hit is fixed and the scan re-run before Step 7. Remove `$HOME/.cc-tmp/rlb-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: the reader lab door's results (docs reader lab)`, trailer. This commit is RL-a's `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open RL-a's ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

### Task 6: The lab's frames: the battery, the scripts, the wall policy, the builder (refinements (g), (h), (i); M10.9, M10.10, M10.11, M10.16)

**Run:** RL-b. **Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (every frame's sandbox, policy and reach).

**Files:**
- Create: `pwa/src/readerLab/battery.ts`, `pwa/src/readerLab/frameScripts.ts`, `pwa/src/docs/reader/labPolicy.ts`, `pwa/src/readerLab/frames.ts`, `pwa/test/reader-lab-frames.test.ts`.
- Modify: `pwa/browser/reader-frame.browser.test.ts` (two import lines; `CHANNELS` and the battery's channel object read from the shared list and source), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C9 row's PWA cell gains `readerLab/**`).
- Guards (not edited): `pwa/test/docs-scans.test.ts` (clause W8a: `/frame` in `docs/reader/labPolicy.ts` is in its home; `labPolicy.ts` holds no `srcdoc`, `iframe` or `default-src 'none'` text), `server/test/docs-parity.test.ts` (M7.9: the library's name only as an import specifier), `pwa/test/contrast.test.ts`, `server/test/rings/totality.test.ts`, `server/test/rings/pwa-rings.test.ts`, `server/test/census-w7/pwa.test.ts`.

**Interfaces:** Consumes RL-a's `shared/readerLab.ts`. Produces `LAB_BATTERY_PRELUDE_JS`, `LAB_BATTERY_CHANNELS_JS`; `AMBIENT_SCRIPT`, `COOKIE_SCRIPT`, `BATTERY_SCRIPT`, `POPUP_SCRIPT`, `SELF_NAV_SCRIPT`, `BUSY_SCRIPT`, `STRAYS_SCRIPT`, `LAB_FRAME_SCRIPTS`, `LAB_STRAYS_POSTED`; `labWallCsp`, `READER_LIBRARY_BUILD`; `LAB_SANDBOX`, `LabFrameSpec`, `LabFrame`, `labDataText`, `labSrcdoc`, `mountLabFrame`.

**Decisions:** (1) A frame script never varies: what a run needs (the probe base, the battery's prefix, the spin time, the button's label) is in the JSON data block, which the script reads as the element just before itself (the library's seed rule, M8.8). So the wall frame needs one nonce, not a hash recomputed per run. (2) A script reports only through `hit(name)` (an image request to `<base><name>`), never sends a value it read, and deletes any store it managed to open. (3) The wall's nonce is fresh per frame (`crypto.getRandomValues` in the run's defaults; any string in the tests). (4) `mountLabFrame` sets `sandbox` before `srcdoc` and before insertion, and counts the frame's `load` events (an element listener, never a `message` one).

- [ ] **Step 0: Base (RL-a merged).** `test -f shared/readerLab.ts && test -f server/src/readerLab/routes.ts && test ! -e pwa/src/readerLab && test ! -e pwa/src/docs/reader/labPolicy.ts && git grep -qF '| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` |' HEAD -- docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md && git grep -qF "const CHANNELS = [" HEAD -- pwa/browser/reader-frame.browser.test.ts && echo T6-BASE-OK` — Expected: `T6-BASE-OK`. Record BASE in the SDD ledger. Confirm the claim on `pwa/browser/reader-frame.browser.test.ts` (W8b edits it too).
- [ ] **Step 1: Write the failing test,** `pwa/test/reader-lab-frames.test.ts`, with exactly this content:

```ts
// The reader lab's frames (native Docs reader, the reader lab plan of 2026-11-03, Task 6; the rich-docs spec's rows
// M10.9, M10.10, M10.11, M10.16): `readerLab/frames.ts`, `readerLab/frameScripts.ts`, `readerLab/battery.ts` and
// `docs/reader/labPolicy.ts` in jsdom. Every frame is the reader frame's shape; only the wall frame carries a policy, the
// library's own with exactly two sources added; every URL a frame can form is the console's origin plus this run's
// probe path; the battery is L0's 27 channels in order.
import { afterEach, describe, expect, it } from 'vitest';
import { frameCsp } from '@synapsium-labs/docserver/frame';
import { LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, readerLabProbeBase } from '../../shared/readerLab';
import { LAB_BATTERY_CHANNELS_JS } from '../src/readerLab/battery';
import { AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, LAB_FRAME_SCRIPTS } from '../src/readerLab/frameScripts';
import { LAB_SANDBOX, labDataText, labSrcdoc, mountLabFrame } from '../src/readerLab/frames';
import { labWallCsp } from '../src/docs/reader/labPolicy';

const ORIGIN = 'https://box.example';
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const BASE = `${ORIGIN}${readerLabProbeBase(NONCE)}`;
const CANARY = `${BASE}csp-canary`;
const SCRIPT_NONCE = 'Zm9vYmFyYmF6cXV4MTIzNA';
const SVG_NS = 'http://www.w3.org/2000/svg';

afterEach(() => {
  document.body.replaceChildren();
});

/** A policy's directives, each name to its sources. */
const directives = (p: string): Map<string, string[]> => new Map(p.split(';').map((d) => d.trim()).filter((d) => d !== '')
  .map((d): [string, string[]] => {
    const [name, ...sources] = d.split(/\s+/);
    return [name ?? '', sources];
  }));

const stage = (): HTMLElement => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};

describe('the reader lab frames (reader lab plan, Task 6)', () => {
  it("every lab frame is the reader frame's shape: sandbox exactly allow-scripts, a srcdoc, no-referrer, nothing that loads (M10.9)", () => {
    expect(LAB_SANDBOX).toBe('allow-scripts');
    const s = stage();
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) {
      const f = mountLabFrame(s, { script, config: { base: BASE } }, () => SCRIPT_NONCE);
      const el = s.querySelector('iframe');
      expect(el, name).not.toBeNull();
      expect(el!.getAttribute('sandbox'), name).toBe('allow-scripts');
      expect(el!.getAttribute('referrerpolicy'), name).toBe('no-referrer');
      expect(el!.getAttribute('srcdoc'), name).toContain(script);
      for (const a of ['src', 'name', 'allow', 'allowfullscreen', 'csp']) expect(el!.hasAttribute(a), `${name} ${a}`).toBe(false);
      f.remove();
      expect(s.querySelector('iframe'), name).toBeNull();
    }
  });

  it('the data block is the element just before the one script, and its text can end neither its element nor its line', () => {
    const hostile = { base: BASE, label: '</script><script>x()</script>\u2028\u2029' };
    const doc = new DOMParser().parseFromString(labSrcdoc({ script: BUSY_SCRIPT, config: hostile }, null, null), 'text/html');
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts).toHaveLength(2);
    expect(scripts[0]!.getAttribute('type')).toBe('application/json');
    expect(scripts[0]!.nextElementSibling).toBe(scripts[1]);
    expect(scripts[1]!.textContent).toBe(BUSY_SCRIPT);
    expect(labDataText(hostile)).not.toMatch(/[<\u2028\u2029]/);
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual(hostile);
  });

  it('only the wall frame carries a policy: frameCsp() plus its nonce in script-src and the canary in img-src, as the meta and the csp attribute (M10.10)', () => {
    const s = stage();
    mountLabFrame(s, { script: BATTERY_SCRIPT, config: { base: BASE, prefix: 'csp-', canary: true }, wall: { canary: CANARY } }, () => SCRIPT_NONCE);
    const el = s.querySelector('iframe')!;
    const policy = el.getAttribute('csp') ?? '';
    const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(policy);
    const got = directives(policy);
    const lib = directives(frameCsp());
    expect([...got.keys()]).toEqual([...lib.keys()]);
    for (const [name, sources] of lib) {
      const extra = name === 'script-src' ? [`'nonce-${SCRIPT_NONCE}'`] : name === 'img-src' ? [CANARY] : [];
      expect(got.get(name), name).toEqual([...sources, ...extra]);
    }
    expect(doc.body.querySelectorAll('script')[1]?.getAttribute('nonce')).toBe(SCRIPT_NONCE);
  });

  it('labWallCsp refuses anything but one nonce source and one URL with no separator in it', () => {
    const cases: readonly (readonly [string, string])[] = [
      ["'unsafe-inline'", CANARY], ["'nonce-abc def'", CANARY], [`'nonce-${SCRIPT_NONCE}'`, 'https://a.example; connect-src *'],
      [`'nonce-${SCRIPT_NONCE}'`, '*'], [`'nonce-${SCRIPT_NONCE}'`, "https://a.example/x'"], [`'nonce-${SCRIPT_NONCE}'`, 'https://a.example/x y'],
    ];
    for (const [source, canary] of cases) expect(() => labWallCsp(source, canary), `${source} ${canary}`).toThrow(TypeError);
  });

  it('every URL any lab frame can form is the console origin plus this run\'s probe path (M10.11)', () => {
    const urlsIn = (t: string): string[] => t.match(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)<>\\]*/gi) ?? [];
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) {
      expect(urlsIn(script), `${name} spells a URL of its own`).toEqual(script.includes(SVG_NS) ? [SVG_NS] : []);
      const policy = name === 'battery' ? labWallCsp(`'nonce-${SCRIPT_NONCE}'`, CANARY) : null;
      for (const url of urlsIn(labSrcdoc({ script, config: { base: BASE } }, policy, null))) {
        expect(url === SVG_NS || url.startsWith(BASE), `${name}: ${url}`).toBe(true);
      }
    }
  });

  it("the battery source names L0's 27 channels, in order, and is what the battery script inlines (M10.16)", () => {
    const keys = [...LAB_BATTERY_CHANNELS_JS.matchAll(/^\s*'([a-z-]+)': \(u\)/gm)].map((m) => m[1]);
    expect(keys).toEqual([...LAB_BATTERY_CHANNELS]);
    expect(BATTERY_SCRIPT).toContain(LAB_BATTERY_CHANNELS_JS);
  });

  it('every probe a script names is in the vocabulary, and the ambient keys are the seven the vocabulary holds', () => {
    const named = Object.values(LAB_FRAME_SCRIPTS)
      .flatMap((s) => [...s.matchAll(/'((?:cookie|ambient|csp|ctl|popup|top|self|busy|strays|hostile)-[a-z-]+)'/g)].map((m) => m[1]!));
    expect(named.length).toBeGreaterThan(20);
    for (const n of named) expect(LAB_PROBE_NAMES, n).toContain(n);
    const keys = [...AMBIENT_SCRIPT.matchAll(/report\('([a-z]+)'/g)].map((m) => m[1]);
    expect([...new Set(keys)]).toEqual(['parent', 'origin', 'cookie', 'local', 'session', 'idb', 'caches']);
  });

  it('no script holds a script close, and the builder refuses one', () => {
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) expect(script.toLowerCase().includes('</script'), name).toBe(false);
    expect(() => labSrcdoc({ script: 'x</script>y', config: { base: BASE } }, null, null)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-frames.test.ts )` — Expected (prediction): the file fails to load (`Failed to load url ../src/readerLab/battery`).
- [ ] **Step 3: Write `pwa/src/readerLab/battery.ts`** with exactly this content (the channel object is W8a's desktop battery's, moved, not rewritten):

```ts
// The frame CSP battery's channels, as frame-side JavaScript (native Docs reader, the reader lab plan of 2026-11-03,
// Task 6; the rich-docs spec's rows M8.B1 and M10.16): one object literal whose keys are L0's LAB_BATTERY_CHANNELS, in
// order, each a function of one URL that tries to load from it or send to it. Text, never run in the console: the reader
// lab's wall and control frames inline it (`frameScripts.ts`), and the desktop browser leg
// (`pwa/browser/reader-frame.browser.test.ts`) evaluates the same text inside the reader frame, so both run one battery.
// Ring L1: two string constants.

/** What the channels need in scope: the SVG namespace (a name, not a URL anything loads) and `mount`. */
export const LAB_BATTERY_PRELUDE_JS = "const ns = 'http://www.w3.org/2000/svg';\n"
  + 'const mount = (el) => { (document.body || document.documentElement).append(el); return el; };';

/** The 27 channels. */
export const LAB_BATTERY_CHANNELS_JS = `{
  'fetch-cors': (u) => fetch(u, { mode: 'cors' }).catch(() => 0),
  'fetch-nocors': (u) => fetch(u, { mode: 'no-cors' }).catch(() => 0),
  'fetch-credentials': (u) => fetch(u, { mode: 'cors', credentials: 'include' }).catch(() => 0),
  'fetch-post': (u) => fetch(u, { method: 'POST', body: 'x', mode: 'no-cors' }).catch(() => 0),
  'fetch-keepalive': (u) => fetch(u, { keepalive: true, mode: 'no-cors' }).catch(() => 0),
  'xhr-get': (u) => { const x = new XMLHttpRequest(); x.open('GET', u); x.send(); },
  'xhr-post': (u) => { const x = new XMLHttpRequest(); x.open('POST', u); x.send('x'); },
  'beacon': (u) => { navigator.sendBeacon(u, 'x'); },
  'websocket': (u) => { const w = new WebSocket(u.replace('http', 'ws')); w.onerror = () => {}; },
  'eventsource': (u) => { const s = new EventSource(u); s.onerror = () => s.close(); },
  'image': (u) => { const i = new Image(); i.src = u; },
  'image-srcset': (u) => { const i = document.createElement('img'); i.srcset = u + ' 1x'; mount(i); },
  'script': (u) => { const s = document.createElement('script'); s.src = u; mount(s); },
  'script-module': (u) => { const s = document.createElement('script'); s.type = 'module'; s.src = u; mount(s); },
  'link-stylesheet': (u) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; mount(l); },
  'link-prefetch': (u) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; mount(l); },
  'link-preload': (u) => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = u; mount(l); },
  'link-modulepreload': (u) => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = u; mount(l); },
  'style-import': (u) => { const s = document.createElement('style'); s.textContent = '@import url("' + u + '");'; mount(s); },
  'css-background': (u) => { const d = document.createElement('div'); d.style.cssText = 'width:10px;height:10px;background-image:url("' + u + '")'; mount(d); },
  'css-font-face': (u) => {
    const s = document.createElement('style'); s.textContent = '@font-face{font-family:bat;src:url("' + u + '")}.bat{font-family:bat}'; mount(s);
    const p = document.createElement('p'); p.className = 'bat'; p.textContent = 'x'; mount(p);
  },
  'css-content-url': (u) => {
    const s = document.createElement('style'); s.textContent = '.cu::before{content:url("' + u + '")}'; mount(s);
    const d = document.createElement('div'); d.className = 'cu'; d.textContent = 'x'; mount(d);
  },
  'audio': (u) => { const a = new Audio(); a.preload = 'auto'; a.src = u; a.load(); },
  'video': (u) => { const v = document.createElement('video'); v.preload = 'auto'; v.src = u; mount(v); v.load(); },
  'svg-image': (u) => {
    const s = document.createElementNS(ns, 'svg'); const i = document.createElementNS(ns, 'image');
    i.setAttribute('href', u); i.setAttribute('width', '10'); i.setAttribute('height', '10'); s.append(i); mount(s);
  },
  'import-dynamic': (u) => import(u).catch(() => 0),
  'iframe': (u) => { const f = document.createElement('iframe'); f.src = u; mount(f); },
}`;
```

- [ ] **Step 4: Write `pwa/src/readerLab/frameScripts.ts`** with exactly this content:

```ts
// The reader lab frames' scripts (native Docs reader, the reader lab plan of 2026-11-03, Task 6; the reader lab design,
// section 3). Text, never run in the console: `frames.ts` inlines one of these into each lab frame's srcdoc, after a JSON
// data block the script reads by position (the element just before it), so a script's text never varies and nothing
// about a run is spelled in it. Every script reports only by loading `<base><name>` as an image, `base` being this run's
// probe path on the console's own origin (M10.11); a name says what happened (`…-held`, `…-broke`), and no value a script
// reads is ever sent. A store a script manages to open is deleted at once. Classic scripts, ES2017 at most.
// Ring L1: string constants.
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from './battery';

/** Reads the data block and defines `url(name)` and `hit(name)`. Every script starts with it. */
const PRELUDE = [
  'var cfg = JSON.parse(document.currentScript.previousElementSibling.textContent);',
  "var url = function (name) { return cfg.base + name; };",
  'var hit = function (name) { var i = new Image(); i.src = url(name); return i; };',
].join('\n');

/** Opaque origin and ambient state (lab 1-2, M8.B3): `held` when the frame cannot reach the thing, `broke` when it can. */
export const AMBIENT_SCRIPT = `(function () {
${PRELUDE}
var report = function (key, held) { hit('ambient-' + key + (held ? '-held' : '-broke')); };
try { void parent.document.title; report('parent', false); } catch (e) { report('parent', true); }
report('origin', String(self.origin) === 'null');
try { report('cookie', document.cookie === ''); } catch (e) { report('cookie', true); }
try { void localStorage.length; report('local', false); } catch (e) { report('local', true); }
try { void sessionStorage.length; report('session', false); } catch (e) { report('session', true); }
try {
  var r = indexedDB.open('ccrc-reader-lab');
  r.onsuccess = function () { try { r.result.close(); indexedDB.deleteDatabase('ccrc-reader-lab'); } catch (e) {} report('idb', false); };
  r.onerror = function () { report('idb', true); };
} catch (e) { report('idb', true); }
try {
  if (typeof caches === 'undefined') { report('caches', true); } else {
    caches.open('ccrc-reader-lab').then(function () { caches.delete('ccrc-reader-lab'); report('caches', false); }, function () { report('caches', true); });
  }
} catch (e) { report('caches', true); }
})();`;

/** No cookie on frame requests (lab 1-2, M8.B2): every credentialed channel to the door, then a sign that it ran. */
export const COOKIE_SCRIPT = `(function () {
${PRELUDE}
var none = function () {};
try { fetch(url('cookie-fetch'), { credentials: 'include' }).catch(none); } catch (e) {}
try { var h = {}; h[cfg.marker] = cfg.markerValue; fetch(url('cookie-fetch-marker'), { credentials: 'include', headers: h }).catch(none); } catch (e) {}
try { var x = new XMLHttpRequest(); x.open('GET', url('cookie-xhr')); x.withCredentials = true; x.send(); } catch (e) {}
try { navigator.sendBeacon(url('cookie-beacon'), 'x'); } catch (e) {}
try { var w = new WebSocket(url('cookie-websocket').replace(/^http/, 'ws')); w.onerror = none; } catch (e) {}
try { hit('cookie-image'); } catch (e) {}
setTimeout(function () { hit('cookie-ran'); }, 300);
})();`;

/** The frame CSP battery (M8.B1): the wall frame first requests its canary, the one URL its policy allows, then every
 *  channel to `<base><prefix><channel>`; the control frame, with no policy, the same channels under its own prefix. */
export const BATTERY_SCRIPT = `(function () {
${PRELUDE}
${LAB_BATTERY_PRELUDE_JS}
var channels = ${LAB_BATTERY_CHANNELS_JS};
if (cfg.canary === true) hit('csp-canary');
Object.keys(channels).forEach(function (name) { try { channels[name](url(cfg.prefix + name)); } catch (e) {} });
})();`;

/** No popup, no top navigation (E1, M8.B4), after the operator's tap: every target is a door URL answering 204. */
export const POPUP_SCRIPT = `(function () {
${PRELUDE}
var b = document.createElement('button');
b.type = 'button';
b.textContent = cfg.label;
b.style.cssText = 'font: inherit; padding: 12px 20px; margin: 16px; min-height: 44px;';
(document.body || document.documentElement).append(b);
var done = false;
b.addEventListener('click', function () {
  if (done) return;
  done = true;
  var w = null;
  try { w = window.open(url('popup-open'), '_blank'); } catch (e) {}
  hit(w === null || w === undefined ? 'popup-null' : 'popup-window');
  try { void top.location.href; hit('top-read-broke'); } catch (e) { hit('top-read-held'); }
  try { top.location = url('top-nav'); hit('top-write-returned'); } catch (e) { hit('top-write-threw'); }
  try { var a = document.createElement('a'); a.href = url('popup-blank'); a.target = '_blank'; (document.body || document.documentElement).append(a); a.click(); } catch (e) {}
  setTimeout(function () { hit('popup-ran'); }, 300);
});
})();`;

/** The frame cannot navigate itself (E11): it says it tried, then sets its own location to a door URL. */
export const SELF_NAV_SCRIPT = `(function () {
${PRELUDE}
hit('self-nav-tried');
setTimeout(function () { location.href = url('self-nav'); }, 200);
})();`;

/** A busy frame (E17): it marks its start, spins for the configured time, and marks its end. */
export const BUSY_SCRIPT = `(function () {
${PRELUDE}
hit('busy-start');
var t = Date.now();
while (Date.now() - t < cfg.spinMs) { /* the console's thread is measured while this spins */ }
hit('busy-end');
})();`;

/** How many stray messages the stray frame posts (the result's detail). */
export const LAB_STRAYS_POSTED = 8;

/** Stray messages (M8.B5's stray half): well-formed ops, an unknown one and an oversize one, each on the window. */
export const STRAYS_SCRIPT = `(function () {
${PRELUDE}
var post = function (m) { try { parent.postMessage(m, '*'); } catch (e) {} };
post({ t: 'navigate', href: 'stray.md' });
post({ t: 'hash', id: 'reader-lab-stray' });
post({ t: 'copy', text: 'reader lab stray' });
post({ t: 'store.set', key: 'pref:prefs', value: '{}' });
post({ t: 'ready', v: 1, nonce: '00000000000000000000000000000000' });
post({ t: 'error', why: 'boot' });
post({ t: 'reader-lab-unknown' });
post({ t: 'navigate', href: new Array(5001).join('x') });
hit('strays-sent');
})();`;

/** Every frame script, by name: the tests and the scans walk it. */
export const LAB_FRAME_SCRIPTS: Readonly<Record<string, string>> = {
  ambient: AMBIENT_SCRIPT, cookie: COOKIE_SCRIPT, battery: BATTERY_SCRIPT, popup: POPUP_SCRIPT,
  selfNav: SELF_NAV_SCRIPT, busy: BUSY_SCRIPT, strays: STRAYS_SCRIPT,
};
```

- [ ] **Step 5: Write `pwa/src/docs/reader/labPolicy.ts`** with exactly this content:

```ts
// The reader lab's wall-frame policy (native Docs reader, the reader lab plan of 2026-11-03, Task 6, refinement (i); the
// rich-docs spec's row M10.10). Ring L1: pure. The lab's wall frame runs its battery under the shared Markdown library's
// own frame policy with exactly two sources added: the frame's script nonce in `script-src`, so the battery's own inline
// script runs, and one image URL, the run's canary, in `img-src`, which the battery requests first as its sign that it
// ran. Everything else is `frameCsp()` as the reader frame carries it, so the walls the lab measures are the reader's.
// This file lives under `docs/reader/` because that is the one home of the library's `./frame` (M8.10).
import { FRAME_MANIFEST, frameCsp } from '@synapsium-labs/docserver/frame';

/** The library build the lab ran against: the first twelve hex digits of its enhance asset's sha256. */
export const READER_LIBRARY_BUILD: string = FRAME_MANIFEST.enhance.sha256.slice(0, 12);

/** One CSP nonce source. */
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
/** One URL source: a scheme, a host and a path, with no character a policy splits on or quotes with. */
const URL_SOURCE = /^https?:\/\/[^\s;,'"]+$/;

/** The wall frame's policy. Throws a TypeError for a source that is not exactly one nonce or one URL: the lab builds
 *  both, so that is a defect. */
export function labWallCsp(nonceSource: string, canary: string): string {
  if (!NONCE_SOURCE.test(nonceSource)) throw new TypeError('labWallCsp: not one nonce source');
  if (!URL_SOURCE.test(canary)) throw new TypeError('labWallCsp: not one URL source');
  let scripts = 0;
  let images = 0;
  const out = frameCsp().split(';').map((d) => d.trim()).filter((d) => d !== '').map((d) => {
    const name = d.split(/\s+/)[0];
    if (name === 'script-src') {
      scripts += 1;
      return `${d} ${nonceSource}`;
    }
    if (name === 'img-src') {
      images += 1;
      return `${d} ${canary}`;
    }
    return d;
  });
  if (scripts !== 1 || images !== 1) throw new Error('labWallCsp: the library policy no longer has one script-src and one img-src');
  return out.join('; ');
}
```

- [ ] **Step 6: Write `pwa/src/readerLab/frames.ts`** with exactly this content:

```ts
// The reader lab's frames (native Docs reader, the reader lab plan of 2026-11-03, Task 6, refinement (h); the rich-docs
// spec's rows A24, M10.9, M10.10). The one place in `pwa/src` outside the Docs reader that builds an iframe or a srcdoc.
// Every frame is the reader frame's shape: `sandbox="allow-scripts"` and nothing else, a `srcdoc`,
// `referrerpolicy="no-referrer"`. Only the wall frame carries a policy, the library's own with its script nonce and
// canary added (`docs/reader/labPolicy.ts`), as a meta and as the iframe's `csp` attribute, as the reader frame does. A
// frame's script is one of `frameScripts.ts`' constants; what varies per run travels in a JSON data block just before it,
// which no policy runs. No frame is handed a port, and nothing here listens for a message: a frame reports only through
// the door. Ring L4: it makes DOM elements.
import { labWallCsp } from '../docs/reader/labPolicy';

/** The one sandbox a lab frame carries: the reader frame's, exactly (M10.9). */
export const LAB_SANDBOX = 'allow-scripts';

/** One lab frame: its constant script, the data the script reads, and, for the battery's wall frame only, its canary. */
export interface LabFrameSpec {
  readonly script: string;
  /** `base` is always this run's probe path on the console's origin. */
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly wall?: { readonly canary: string };
}

/** A mounted lab frame. */
export interface LabFrame {
  /** How many `load` events the frame has fired: its srcdoc's, then any navigation's. */
  loads(): number;
  /** Removes the frame. Idempotent. */
  remove(): void;
}

/** The data block's text: `<`, U+2028 and U+2029 escaped, so it can end neither its element nor a line of script. */
export function labDataText(config: LabFrameSpec['config']): string {
  return JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A lab frame's srcdoc: the policy's meta when there is one, then, in the body, the data block and the one script
 *  (carrying `nonce` when there is one). Throws on a script that would end its own element. */
export function labSrcdoc(spec: LabFrameSpec, policy: string | null, nonce: string | null): string {
  if (spec.script.toLowerCase().includes('</script')) throw new Error('a lab frame script holds a script close');
  const meta = policy === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">`;
  const nonceAttr = nonce === null ? '' : ` nonce="${attr(nonce)}"`;
  return `<!doctype html><html><head><meta charset="utf-8">${meta}<title>reader lab</title></head><body>`
    + `<script type="application/json">${labDataText(spec.config)}</script><script${nonceAttr}>${spec.script}</script></body></html>`;
}

/** Mounts one lab frame at the end of `stage`. `nonce` makes the wall frame's script nonce; no other frame asks for one. */
export function mountLabFrame(stage: HTMLElement, spec: LabFrameSpec, nonce: () => string): LabFrame {
  const el = document.createElement('iframe');
  el.setAttribute('sandbox', LAB_SANDBOX);
  el.setAttribute('referrerpolicy', 'no-referrer');
  el.setAttribute('title', 'reader lab frame');
  let policy: string | null = null;
  let scriptNonce: string | null = null;
  if (spec.wall !== undefined) {
    scriptNonce = nonce();
    policy = labWallCsp(`'nonce-${scriptNonce}'`, spec.wall.canary);
    el.setAttribute('csp', policy);
  }
  let loads = 0;
  el.addEventListener('load', () => {
    loads += 1;
  });
  el.setAttribute('srcdoc', labSrcdoc(spec, policy, scriptNonce));
  stage.append(el);
  return {
    loads: () => loads,
    remove: () => {
      el.remove();
    },
  };
}
```

- [ ] **Step 7: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-frames.test.ts )` — Expected (prediction): `Tests  8 passed (8)`.
- [ ] **Step 8: The desktop battery on the shared list.** In `pwa/browser/reader-frame.browser.test.ts`:
  Find: `import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';`
  Replace:
```ts
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { LAB_BATTERY_CHANNELS } from '../../shared/readerLab';
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from '../src/readerLab/battery';
```
  Find:
```ts
const CHANNELS = [
  'fetch-cors', 'fetch-nocors', 'fetch-credentials', 'fetch-post', 'fetch-keepalive', 'xhr-get', 'xhr-post', 'beacon',
  'websocket', 'eventsource', 'image', 'image-srcset', 'script', 'script-module', 'link-stylesheet', 'link-prefetch',
  'link-preload', 'link-modulepreload', 'style-import', 'css-background', 'css-font-face', 'css-content-url', 'audio',
  'video', 'svg-image', 'import-dynamic', 'iframe',
] as const;
```
  Replace:
```ts
/** The 27 channels: one list for this leg and the reader lab (the reader lab plan, Task 6; M10.16). */
const CHANNELS = LAB_BATTERY_CHANNELS;
```
  Find (the battery's helpers and channel object inside `batterySource`, 40 lines):
```js
  const ns = 'http://www.w3.org/2000/svg';
  const mount = (el) => { (document.body || document.documentElement).append(el); return el; };
  const channels = {
    'fetch-cors': (u) => fetch(u, { mode: 'cors' }).catch(() => 0),
    'fetch-nocors': (u) => fetch(u, { mode: 'no-cors' }).catch(() => 0),
    'fetch-credentials': (u) => fetch(u, { mode: 'cors', credentials: 'include' }).catch(() => 0),
    'fetch-post': (u) => fetch(u, { method: 'POST', body: 'x', mode: 'no-cors' }).catch(() => 0),
    'fetch-keepalive': (u) => fetch(u, { keepalive: true, mode: 'no-cors' }).catch(() => 0),
    'xhr-get': (u) => { const x = new XMLHttpRequest(); x.open('GET', u); x.send(); },
    'xhr-post': (u) => { const x = new XMLHttpRequest(); x.open('POST', u); x.send('x'); },
    'beacon': (u) => { navigator.sendBeacon(u, 'x'); },
    'websocket': (u) => { const w = new WebSocket(u.replace('http', 'ws')); w.onerror = () => {}; },
    'eventsource': (u) => { const s = new EventSource(u); s.onerror = () => s.close(); },
    'image': (u) => { const i = new Image(); i.src = u; },
    'image-srcset': (u) => { const i = document.createElement('img'); i.srcset = u + ' 1x'; mount(i); },
    'script': (u) => { const s = document.createElement('script'); s.src = u; mount(s); },
    'script-module': (u) => { const s = document.createElement('script'); s.type = 'module'; s.src = u; mount(s); },
    'link-stylesheet': (u) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; mount(l); },
    'link-prefetch': (u) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; mount(l); },
    'link-preload': (u) => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = u; mount(l); },
    'link-modulepreload': (u) => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = u; mount(l); },
    'style-import': (u) => { const s = document.createElement('style'); s.textContent = '@import url("' + u + '");'; mount(s); },
    'css-background': (u) => { const d = document.createElement('div'); d.style.cssText = 'width:10px;height:10px;background-image:url("' + u + '")'; mount(d); },
    'css-font-face': (u) => {
      const s = document.createElement('style'); s.textContent = '@font-face{font-family:bat;src:url("' + u + '")}.bat{font-family:bat}'; mount(s);
      const p = document.createElement('p'); p.className = 'bat'; p.textContent = 'x'; mount(p);
    },
    'css-content-url': (u) => {
      const s = document.createElement('style'); s.textContent = '.cu::before{content:url("' + u + '")}'; mount(s);
      const d = document.createElement('div'); d.className = 'cu'; d.textContent = 'x'; mount(d);
    },
    'audio': (u) => { const a = new Audio(); a.preload = 'auto'; a.src = u; a.load(); },
    'video': (u) => { const v = document.createElement('video'); v.preload = 'auto'; v.src = u; mount(v); v.load(); },
    'svg-image': (u) => {
      const s = document.createElementNS(ns, 'svg'); const i = document.createElementNS(ns, 'image');
      i.setAttribute('href', u); i.setAttribute('width', '10'); i.setAttribute('height', '10'); s.append(i); mount(s);
    },
    'import-dynamic': (u) => import(u).catch(() => 0),
    'iframe': (u) => { const f = document.createElement('iframe'); f.src = u; mount(f); },
  };
```
  Replace:
```js
  ${LAB_BATTERY_PRELUDE_JS}
  const channels = ${LAB_BATTERY_CHANNELS_JS};
```
  Then `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` and run the desktop browser file once through `ccrc test`: `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/reader-frame.browser.test.ts )` — green, its count unchanged from BASE (the battery is the same text; its three M8.B1 rows read the same channels).
- [ ] **Step 9: The context row's PWA cell.** In `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (as RL-a leaves it):
  Find:
```md
| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx` |
```
  Replace:
```md
| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx`, `readerLab/**` |
```
- [ ] **Step 10: Guards.** `TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/contrast.test.ts )` through `ccrc test` — green (clause W8a finds `/frame` in `docs/reader/labPolicy.ts`, its home, and no `docs:` text there). `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/rings/totality.test.ts test/rings/pwa-rings.test.ts test/census-w7/pwa.test.ts test/citations.test.ts )` through `ccrc test` — green. If `census-w7`'s storage-owner count moves, the frame scripts' text was read as identifiers: stop and ask (the strings must not count as owners).
- [ ] **Step 11: Commit.** `git add pwa/src/readerLab/battery.ts pwa/src/readerLab/frameScripts.ts pwa/src/docs/reader/labPolicy.ts pwa/src/readerLab/frames.ts pwa/test/reader-lab-frames.test.ts pwa/browser/reader-frame.browser.test.ts docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (expect 7), message `pwa: the reader lab's frames, its wall policy, and one battery for both legs (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, tests `test/reader-lab-frames.test.ts`):

| id | spec | file | old → new | expected red (prediction) |
|---|---|---|---|---|
| RLB-T6-M1 | (h) M10.9 | `src/readerLab/frames.ts` | `export const LAB_SANDBOX = 'allow-scripts';` → `export const LAB_SANDBOX = 'allow-scripts allow-same-origin';` | 1 failed — `"every lab frame is the reader frame's shape: …"` |
| RLB-T6-M2 | (i) M10.10 | `src/docs/reader/labPolicy.ts` | ``return `${d} ${canary}`;`` → ``return `${d} ${canary} 'self'`;`` | 1 failed — `'only the wall frame carries a policy: …'` |
| RLB-T6-M3 | (i) M10.10 | `src/readerLab/frames.ts` | `el.setAttribute('csp', policy);` → removed | 1 failed — `'only the wall frame carries a policy: …'` |
| RLB-T6-M4 | (h) M10.9 | `src/readerLab/frames.ts` | `return JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');` → `return JSON.stringify(config);` | 1 failed — `'the data block is the element just before the one script, …'` |
| RLB-T6-M5 | (g) M10.16 | `src/readerLab/battery.ts` | `'import-dynamic': (u) => import(u).catch(() => 0),` → removed | 1 failed — `"the battery source names L0's 27 channels, …"` |
| RLB-T6-M6 | (h) M10.11 | `src/readerLab/frameScripts.ts` | `"var url = function (name) { return cfg.base + name; };",` → `"var url = function (name) { return 'https://elsewhere.example/' + name; };",` | 1 failed — `"every URL any lab frame can form is the console origin plus this run's probe path (M10.11)"` |

```json
[
  {"id": "RLB-T6-M1", "spec": "(h) M10.9", "pkg": "pwa", "file": "src/readerLab/frames.ts", "old": "export const LAB_SANDBOX = 'allow-scripts';", "new": "export const LAB_SANDBOX = 'allow-scripts allow-same-origin';", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: every lab frame is the reader frame's shape"},
  {"id": "RLB-T6-M2", "spec": "(i) M10.10", "pkg": "pwa", "file": "src/docs/reader/labPolicy.ts", "old": "return `${d} ${canary}`;", "new": "return `${d} ${canary} 'self'`;", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: only the wall frame carries a policy"},
  {"id": "RLB-T6-M3", "spec": "(i) M10.10", "pkg": "pwa", "file": "src/readerLab/frames.ts", "old": "el.setAttribute('csp', policy);", "new": "", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: only the wall frame carries a policy"},
  {"id": "RLB-T6-M4", "spec": "(h) M10.9", "pkg": "pwa", "file": "src/readerLab/frames.ts", "old": "return JSON.stringify(config).replace(/</g, '\\\\u003c').replace(/\\u2028/g, '\\\\u2028').replace(/\\u2029/g, '\\\\u2029');", "new": "return JSON.stringify(config);", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: the data block is the element just before the one script"},
  {"id": "RLB-T6-M5", "spec": "(g) M10.16", "pkg": "pwa", "file": "src/readerLab/battery.ts", "old": "'import-dynamic': (u) => import(u).catch(() => 0),", "new": "", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: the battery source names L0's 27 channels"},
  {"id": "RLB-T6-M6", "spec": "(h) M10.11", "pkg": "pwa", "file": "src/readerLab/frameScripts.ts", "old": "\"var url = function (name) { return cfg.base + name; };\",", "new": "\"var url = function (name) { return 'https://elsewhere.example/' + name; };\",", "tests": ["test/reader-lab-frames.test.ts"], "red": "1 failed: every URL any lab frame can form is the console origin plus this run's probe path"}
]
```

**Verify:** `test/reader-lab-frames.test.ts` 8 passed; the desktop browser file green at its BASE count; `TSC-OK`; the guards green.

### Task 7: One stall measure, and the `lab-draw` mount profile (refinements (j), (k); M10.15)

**Run:** RL-b. **Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`.

**Files:**
- Create: `pwa/src/lib/frameGap.ts`, `pwa/test/frame-gap.test.ts`.
- Modify: `pwa/src/screens/highlightMeasureRun.tsx` (one import, `longestGap`'s body), `pwa/src/lib/readerLimits.ts` (one constant), `pwa/src/docs/reader/policy.ts` (one import, `ReaderMountProfile`, `readerMountPlan`), `pwa/src/docs/reader/bridge.ts` (one import, the input's `profile`, the plan applied), `pwa/test/reader-bridge.test.ts` (one appended describe).
- Guards (not edited): `pwa/test/highlight-measure.test.tsx` (R19's characterization), `pwa/test/reader-frame.test.tsx`, `pwa/test/w7-storage-keys.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/reader-policy.test.ts`.

**Interfaces:** Produces `longestFrameGap(frame, during)`, `READER_LAB_DRAW_WATCHDOG_MS`, `ReaderMountProfile`, `ReaderMountPlan`, `readerMountPlan(profile, bytes)`, and `ReaderMountInput.profile?`.

**Decisions:** (1) The move changes R19 by nothing: R19 still rounds; `highlight-measure.test.tsx` is the characterization, green before and after. (2) The plan is decided in L1 (`policy.ts`) and applied in L3 (`bridge.ts`), so the bridge still decides nothing (its header's rule). (3) `ReaderFrame.tsx` is byte-identical: the Docs reader passes no profile, so its mount is exactly W8a's.

- [ ] **Step 0: Base.** `git grep -qF "async function longestGap(deps: MeasureDeps, during: Promise<unknown>): Promise<number> {" HEAD -- pwa/src/screens/highlightMeasureRun.tsx && git grep -qF "    mermaidDraw: 'on-request'," HEAD -- pwa/src/docs/reader/bridge.ts && git grep -qF "export function readerWatchdogMs(bytes: number): number {" HEAD -- pwa/src/docs/reader/policy.ts && test ! -e pwa/src/lib/frameGap.ts && echo T7-BASE-OK` — Expected: `T7-BASE-OK`. Confirm the claim on `bridge.ts` and `policy.ts` (W8b edits `bridge.ts` in other hunks). Run `test/highlight-measure.test.tsx` and `test/reader-bridge.test.ts` alone and record their counts.
- [ ] **Step 1: Write the failing tests.** Create `pwa/test/frame-gap.test.ts` with exactly this content:

```ts
// One stall measure (native Docs reader, the reader lab plan of 2026-11-03, Task 7, refinement (j)): `lib/frameGap.ts`,
// R19's longest gap between animation frames, moved so R19's page and the reader lab share it.
import { describe, expect, it } from 'vitest';
import { longestFrameGap } from '../src/lib/frameGap';

/** A frame clock over fixed times that settles `during` as it hands out the last one. */
function clock(times: readonly number[]): { frame: () => Promise<number>; during: Promise<void> } {
  let i = 0;
  let settle: () => void = () => undefined;
  const during = new Promise<void>((resolve) => { settle = resolve; });
  const frame = (): Promise<number> => {
    const t = times[i] ?? times[times.length - 1] ?? 0;
    i += 1;
    if (i >= times.length) settle();
    return Promise.resolve(t);
  };
  return { frame, during };
}

describe('longestFrameGap (reader lab plan, Task 7)', () => {
  it('is the longest gap between two consecutive frames while the work runs', async () => {
    const c = clock([0, 16, 32, 400, 416]);
    expect(await longestFrameGap(c.frame, c.during)).toBe(368);
  });

  it('a work that settles by the first frame answers 0', async () => {
    const c = clock([5]);
    expect(await longestFrameGap(c.frame, c.during)).toBe(0);
  });

  it('a work that rejects ends the measure the same way', async () => {
    let n = 0;
    const frame = (): Promise<number> => Promise.resolve((n += 10));
    const during = Promise.reject(new Error('stopped'));
    expect(await longestFrameGap(frame, during)).toBeGreaterThanOrEqual(0);
  });
});
```

  Append at the end of `pwa/test/reader-bridge.test.ts`:

```ts

// The reader lab's mount profile (the reader lab plan of 2026-11-03, Task 7, refinement (k); M10.15): `lab-draw` draws
// Mermaid on open, waits the lab's watchdog and is handed no storage port; no profile is the Docs reader, unchanged.
describe('the reader lab profile (reader lab plan, Task 7)', () => {
  const inputOf = (profile?: 'lab-draw'): ReaderMountInput => ({
    document: docOf({ scan: { mermaid: mermaidCounts(1, 10, 10) } } as Partial<RenderInput>),
    bytes: 100, docKey: null, title: 'lab.md', prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    ...(profile === undefined ? {} : { profile }),
  });
  const adaptersFor = async (input: ReaderMountInput): Promise<HostAdapters> => {
    const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) =>
      ({ update: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn() }) as unknown as DocFrame);
    await mountReader(document.createElement('div'), input, {
      mount: mount as unknown as typeof mountDocFrame, store: () => fakeStore(),
      assets: () => Promise.resolve(STUB_ASSETS), mermaid: () => Promise.resolve('MERMAID'),
    });
    return mount.mock.calls[0]![1].adapters;
  };

  it('lab-draw draws Mermaid on open, waits READER_LAB_DRAW_WATCHDOG_MS, and is handed no storage port', async () => {
    expect(READER_LAB_DRAW_WATCHDOG_MS).toBe(60000);
    const a = await adaptersFor(inputOf('lab-draw'));
    expect(a.mermaidDraw).toBe('auto');
    expect(a.watchdogMs).toBe(READER_LAB_DRAW_WATCHDOG_MS);
    expect(Object.keys(a)).not.toContain('store');
  });

  it('no profile is the Docs reader: Mermaid on request, the reader watchdog, the storage port', async () => {
    const a = await adaptersFor(inputOf());
    expect(a.mermaidDraw).toBe('on-request');
    expect(a.watchdogMs).toBe(readerWatchdogMs(100));
    expect(Object.keys(a)).toContain('store');
  });

  it('readerMountPlan is the one decision, and only lab-draw maps to drawing on open', () => {
    expect(readerMountPlan('lab-draw', 100)).toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false });
    expect(readerMountPlan(undefined, 100)).toEqual({ draw: 'on-request', watchdogMs: readerWatchdogMs(100), store: true });
  });
});
```

  and in its imports, Find: `import { readerDocKey, readerWatchdogMs, type ReaderLink } from '../src/docs/reader/policy';`
  Replace:
```ts
import { readerDocKey, readerMountPlan, readerWatchdogMs, type ReaderLink } from '../src/docs/reader/policy';
import { READER_LAB_DRAW_WATCHDOG_MS } from '../src/lib/readerLimits';
```
- [ ] **Step 2: Run them to see them fail.** `( cd pwa && ./node_modules/.bin/vitest run test/frame-gap.test.ts test/reader-bridge.test.ts )` — Expected (prediction): `frame-gap` fails to load; `reader-bridge` fails to load (`readerMountPlan` and `READER_LAB_DRAW_WATCHDOG_MS` are not exported).
- [ ] **Step 3: Write `pwa/src/lib/frameGap.ts`** with exactly this content:

```ts
// The longest gap between animation frames while some work runs (native Docs reader, the reader lab plan of 2026-11-03,
// Task 7, refinement (j)): R19's measure (`screens/highlightMeasureRun.tsx`), moved here so the reader lab's stall
// figures are the same measure, not a second one. Ring L1: pure over an injected frame clock; no DOM of its own.

/** Awaits frames from `frame` until `during` settles, either way, and answers the longest gap between two consecutive
 *  frames, in the clock's own unit. A `during` that has settled by the first frame answers 0. */
export async function longestFrameGap(frame: () => Promise<number>, during: Promise<unknown>): Promise<number> {
  let done = false;
  void during.then(() => { done = true; }, () => { done = true; });
  let last = await frame();
  let gap = 0;
  while (!done) {
    const t = await frame();
    gap = Math.max(gap, t - last);
    last = t;
  }
  return gap;
}
```

  In `pwa/src/screens/highlightMeasureRun.tsx`:
  Find: `import { utf8ByteLength } from '../lib/markdownGuard';`
  Replace:
```ts
import { utf8ByteLength } from '../lib/markdownGuard';
import { longestFrameGap } from '../lib/frameGap';
```
  Find:
```ts
/** The longest gap between animation frames while `during` runs. */
async function longestGap(deps: MeasureDeps, during: Promise<unknown>): Promise<number> {
  let done = false;
  void during.then(() => { done = true; }, () => { done = true; });
  let last = await deps.frame();
  let gap = 0;
  while (!done) {
    const t = await deps.frame();
    gap = Math.max(gap, t - last);
    last = t;
  }
  return round(gap);
}
```
  Replace:
```ts
/** The longest gap between animation frames while `during` runs: `lib/frameGap.ts`'s one measure, which the reader lab
 *  shares (the reader lab plan, refinement (j)), rounded as R19 has always rounded it. */
async function longestGap(deps: MeasureDeps, during: Promise<unknown>): Promise<number> {
  return round(await longestFrameGap(deps.frame, during));
}
```
- [ ] **Step 4: The profile.** In `pwa/src/lib/readerLimits.ts`:
  Find: `export const READER_COPY_SHEET_MARKERS_MAX = 64;`
  Replace:
```ts
export const READER_COPY_SHEET_MARKERS_MAX = 64;

/** The reader lab's watchdog for its own timed mounts (the reader lab plan, refinement (k)): Mermaid drawn on open is
 *  inside it, so a slow phone's draw is timed rather than cut off. Never the Docs reader's: `readerMountPlan` gives it to
 *  the `lab-draw` profile only. Within the library's own ceiling of 120 000 ms. */
export const READER_LAB_DRAW_WATCHDOG_MS = 60000;
```
  In `pwa/src/docs/reader/policy.ts`:
  Find: `import { READER_COPY_WRITE_MAX_BYTES, READER_DOC_KEY_MAX_UNITS } from '../../lib/readerLimits';`
  Replace: `import { READER_COPY_WRITE_MAX_BYTES, READER_DOC_KEY_MAX_UNITS, READER_LAB_DRAW_WATCHDOG_MS } from '../../lib/readerLimits';`
  Find:
```ts
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}
```
  Replace:
```ts
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}

/** Who mounts (the reader lab plan, refinement (k)): no profile is the Docs reader; `lab-draw` is the reader lab's timed
 *  mount, and only the lab passes it. */
export type ReaderMountProfile = 'lab-draw';

/** How one mount draws, waits and stores. */
export interface ReaderMountPlan {
  readonly draw: 'auto' | 'on-request';
  readonly watchdogMs: number;
  /** Whether the mount is handed the reader's storage port. */
  readonly store: boolean;
}

/** The one decision: the Docs reader draws Mermaid on request, waits `readerWatchdogMs(bytes)` and keeps reader state;
 *  the reader lab's `lab-draw` draws on open, waits READER_LAB_DRAW_WATCHDOG_MS and keeps none, so the lab stores
 *  nothing. */
export function readerMountPlan(profile: ReaderMountProfile | undefined, bytes: number): ReaderMountPlan {
  return profile === 'lab-draw'
    ? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false }
    : { draw: 'on-request', watchdogMs: readerWatchdogMs(bytes), store: true };
}
```
  In `pwa/src/docs/reader/bridge.ts`:
  Find: `import { readerWatchdogMs, type ReaderLink } from './policy';`
  Replace: `import { readerMountPlan, type ReaderLink, type ReaderMountProfile } from './policy';`
  Find:
```ts
  readonly onFallback: (r: FallbackReason) => void;
}
```
  Replace:
```ts
  readonly onFallback: (r: FallbackReason) => void;
  /** Absent for the Docs reader. `lab-draw` is the reader lab's timed mount (`readerMountPlan`): Mermaid drawn on open,
   *  the lab's watchdog, no storage port. Only the reader lab passes it. */
  readonly profile?: ReaderMountProfile;
}
```
  Find: `  const watchdogMs = readerWatchdogMs(input.bytes);`
  Replace:
```ts
  const plan = readerMountPlan(input.profile, input.bytes);
  const watchdogMs = plan.watchdogMs;
```
  Find: `  const port = (deps.store ?? enumerablePageStorage)();`
  Replace: `  const port = plan.store ? (deps.store ?? enumerablePageStorage)() : null;`
  Find: `    mermaidDraw: 'on-request',`
  Replace: `    mermaidDraw: plan.draw,`
  Find: ``// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.``
  Replace:
```ts
// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.
// The watchdog, the draw mode and whether a storage port is handed over are `policy.ts#readerMountPlan`'s, by the input's
// `profile`: none for the Docs reader, `lab-draw` for the reader lab's timed mounts (the reader lab plan, refinement (k)).
```
- [ ] **Step 5: Run them to see them pass.** `( cd pwa && ./node_modules/.bin/vitest run test/frame-gap.test.ts test/reader-bridge.test.ts test/highlight-measure.test.tsx test/reader-frame.test.tsx test/w7-storage-keys.test.ts test/reader-policy.test.ts )` through `ccrc test` — Expected (prediction): `frame-gap` 3 passed; `reader-bridge` its BASE count plus 3; the other four at their BASE counts. `TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts )` — green.
- [ ] **Step 6: Commit.** `git add pwa/src/lib/frameGap.ts pwa/test/frame-gap.test.ts pwa/src/screens/highlightMeasureRun.tsx pwa/src/lib/readerLimits.ts pwa/src/docs/reader/policy.ts pwa/src/docs/reader/bridge.ts pwa/test/reader-bridge.test.ts` (expect 7), message `pwa: one stall measure for R19 and the lab, and the lab's draw-on-open mount profile (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| RLB-T7-M1 | (k) M10.15 | `src/docs/reader/policy.ts` | `? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false }` → `? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: true }` | `test/reader-bridge.test.ts` | 2 failed — `'lab-draw draws Mermaid on open, …'`, `'readerMountPlan is the one decision, …'` |
| RLB-T7-M2 | (k) M10.15 | `src/docs/reader/bridge.ts` | `mermaidDraw: plan.draw,` → `mermaidDraw: 'auto',` | `test/reader-bridge.test.ts` | 2+ failed — `'no profile is the Docs reader: …'` and W8a's `'mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true'` |
| RLB-T7-M3 | (j) | `src/lib/frameGap.ts` | `gap = Math.max(gap, t - last);` → `gap = Math.max(gap, t - last - 1);` | `test/frame-gap.test.ts` | 1 failed — `'is the longest gap between two consecutive frames while the work runs'` |

```json
[
  {"id": "RLB-T7-M1", "spec": "(k) M10.15", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false }", "new": "? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: true }", "tests": ["test/reader-bridge.test.ts"], "red": "2 failed: lab-draw draws Mermaid on open; readerMountPlan is the one decision"},
  {"id": "RLB-T7-M2", "spec": "(k) M10.15", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "mermaidDraw: plan.draw,", "new": "mermaidDraw: 'auto',", "tests": ["test/reader-bridge.test.ts"], "red": "2+ failed: no profile is the Docs reader; mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true"},
  {"id": "RLB-T7-M3", "spec": "(j)", "pkg": "pwa", "file": "src/lib/frameGap.ts", "old": "gap = Math.max(gap, t - last);", "new": "gap = Math.max(gap, t - last - 1);", "tests": ["test/frame-gap.test.ts"], "red": "1 failed: is the longest gap between two consecutive frames while the work runs"}
]
```

**Verify:** `frame-gap` 3 passed; `reader-bridge` BASE plus 3; R19's suite unchanged; `TSC-OK`.

### Task 8: The checks, the verdicts, the device line and the result block (refinements (l), (n), (u); M10.13, M10.14)

**Run:** RL-b. **Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the verdict rules and their anti-vacuity signals; Task 12's held-out `opus` lens reads them again).

**Files:**
- Create: `pwa/src/readerLab/checks.ts`, `pwa/src/readerLab/device.ts`, `pwa/src/readerLab/verdicts.ts`, `pwa/src/readerLab/result.ts`, `pwa/test/reader-lab-verdicts.test.ts`.
- Guards (not edited): `server/test/rings/pwa-rings.test.ts` (all four are L1: no `.tsx`, store or `lib/api.ts` import), `pwa/test/contrast.test.ts`.

**Interfaces:** Produces `LabCheckId`, `LAB_CHECKS`, `LAB_WALLS`, `LAB_E18`, `LAB_E17`, `LAB_CHECK_STEP`, `LabVerdict`, `LabOutcome`; `LabFeatures`, `LabDevice`, `labFeaturesOf(win)`, `deviceOf(ua, cores, features)`, `deviceFacts(device)`; `LabMount`, `LabLocal`, `LAB_CONTROL_FLOOR`, `labVerdicts(run, local, budgetMs)`, `drawOnOpenReading(outcomes, local, budgetMs)`; `LAB_RESULT_FORMAT`, `LAB_VERDICT_WORDS`, `LabFinalRead`, `formatLabResult(device, library, outcomes, local, run, budgetMs, finalRead)`.

**Decisions:** (1) A wall's broken signals are read before its positive signals, so a forged arrival cannot hide a real "broke" or a real arrival at a wall's target. That is all the rules guarantee: a forged POSITIVE signal (the canary, a `*-held` report, `cookie-ran`, `popup-ran`, `strays-sent`, `busy-start`/`busy-end`) can turn "not measured" into "holds" for a frame that never ran, and the defence against that is the nonce's secrecy (the design's section 4.6), not these rules. (2) `run === null` (the door could not be read) and a saturated run make every count-reading line "not measured"; `mermaid` reads only the page's own mounts. (3) The block names no host, origin, nonce or user agent; the device line is classes and three feature facts. (4) Each line has its own three words (`checks.ts#LabVerdict`): `busy-frame` answers a fact, `shared-thread` or `own-thread`, and is held to no budget (a deliberate spin on a shared thread meets none); `self-nav-teardown` answers `differs` when there is no second `load`, never `does-not-hold`, since the wall itself held. (5) `mermaid` decides over every figure mount, `all` included, whatever each one's outcome: the worst gap over the budget does not hold, and within it a mount that did not draw makes the line not measured. (6) `csp-27` compares the control frame's channels, `iframe` left out, with `LAB_CONTROL_FLOOR` (M8.B1's 20), and needs the hostile mount ready; either missing is not measured. (7) The popup check's silent block holds with its detail (refinement (u)); a write with no report is not measured. (8) The `draw on open:` line is a reading of the two E17 lines for the library change, never a verdict, and the door line names the console request's session-cookie class, which says whether the no-cookie line can count toward the gate.

- [ ] **Step 0: Base.** `test -f pwa/src/readerLab/frameScripts.ts && git grep -qF "export const LAB_STRAYS_POSTED = 8;" HEAD -- pwa/src/readerLab/frameScripts.ts && test ! -e pwa/src/readerLab/verdicts.ts && echo T8-BASE-OK` — Expected: `T8-BASE-OK`.
- [ ] **Step 1: Write the failing test,** `pwa/test/reader-lab-verdicts.test.ts`, with exactly this content:

```ts
// The reader lab's verdicts, device line and result block (native Docs reader, the reader lab plan of 2026-11-03, Task 8;
// the rich-docs spec's rows M10.13 and M10.14). Every line has three outcomes; a check holds only on its own positive
// signal; any arrival at a wall's target is "does not hold", and a forged arrival cannot hide a real one; the busy frame
// is a fact; the block is format 1 and names no host, nonce or user agent.
import { describe, expect, it } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, type LabProbeName, type LabProbeTally, type LabRunView,
} from '../../shared/readerLab';
import { LAB_CHECKS, LAB_E17, LAB_E18, LAB_WALLS } from '../src/readerLab/checks';
import { deviceOf, labFeaturesOf, type LabFeatures } from '../src/readerLab/device';
import { LAB_RESULT_FORMAT, formatLabResult } from '../src/readerLab/result';
import { LAB_CONTROL_FLOOR, drawOnOpenReading, labVerdicts, type LabLocal } from '../src/readerLab/verdicts';

const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};
type Over = Partial<Record<LabProbeName, Partial<LabProbeTally>>>;

/** A run whose every probe is zero but those `over` names. */
function runWith(over: Over, extra: Partial<LabRunView> = {}): LabRunView {
  const probes = Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...ZERO, ...(over[n] ?? {}) }])) as Record<LabProbeName, LabProbeTally>;
  return { openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false, probes, ...extra };
}

const one = { hits: 1 };
/** A healthy engine's counts: every report held, the control carried the cookie, the canary arrived, and the control frame
 *  reached the door on every channel but `link-prefetch` and `iframe`. */
const HEALTHY: Over = {
  'cookie-console': { hits: 1, cookie: 1 },
  'cookie-fetch': one, 'cookie-xhr': one, 'cookie-beacon': one, 'cookie-image': one, 'cookie-ran': one,
  'ambient-parent-held': one, 'ambient-origin-held': one, 'ambient-cookie-held': one, 'ambient-local-held': one,
  'ambient-session-held': one, 'ambient-idb-held': one, 'ambient-caches-held': one,
  'csp-canary': one,
  ...(Object.fromEntries(LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe' && c !== 'link-prefetch').map((c) => [`ctl-${c}`, one])) as Over),
  'popup-null': one, 'top-read-held': one, 'top-write-threw': one, 'popup-ran': one,
  'self-nav-tried': one, 'busy-start': one, 'busy-end': one, 'strays-sent': one,
};

const LOCAL_OK: LabLocal = {
  selfNavLoads: 2,
  busy: { longestGapMs: 30, timerLateMs: 5, spinMs: 3000 },
  mounts: [['none', 40], ['trivial', 120], ['f1', 30], ['f2', 20], ['f3', 50], ['f4', 60], ['f5', 70], ['f6', 25], ['all', 150]]
    .map(([label, gap]) => ({ label: String(label), outcome: 'ready' as const, longestGapMs: Number(gap), elapsedMs: 900 })),
  hostile: { ready: true, effects: 0, addressChanged: false },
};

const verdictsOf = (over: Over, local: LabLocal = LOCAL_OK) => labVerdicts(runWith({ ...HEALTHY, ...over }), local, 200);

describe('the reader lab verdicts (reader lab plan, Task 8)', () => {
  it('a healthy engine: all seven walls, the teardown signal and the Mermaid line hold, and the busy frame is a fact', () => {
    expect(LAB_CHECKS).toHaveLength(10);
    expect([LAB_WALLS.length, LAB_E18.length, [...LAB_E17]]).toEqual([7, 8, ['busy-frame', 'mermaid']]);
    const v = labVerdicts(runWith(HEALTHY), LOCAL_OK, 200);
    for (const k of LAB_CHECKS.filter((c) => c !== 'busy-frame')) expect(v[k].verdict, k).toBe('holds');
    expect(v['busy-frame']).toEqual({ verdict: 'own-thread', detail: 'longest gap 30 ms in a 3000 ms spin; watchdog timer 5 ms late' });
    expect(v['no-cookie'].detail).toBe('4 arrived, 0 with the cookie; the control carried it');
    expect(v['csp-27'].detail).toBe('0 of 27 reached; 25 measured; not measured: link-prefetch, iframe; library 0 of 2');
    expect(v['no-self-navigate'].detail).toBe('');
    expect(v['self-nav-teardown'].detail).toBe('second load fired');
    expect(v['bridge-strays'].detail).toBe('8 sent, 0 effects');
    expect(v.mermaid.detail).toBe('longest gap 150 ms, all six together; worst single: figure 5, 70 ms');
  });

  it('opaque origin: a broke report or a same-origin arrival does not hold; a missing report is not measured', () => {
    expect(verdictsOf({ 'ambient-parent-broke': one })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-origin-broke': one })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-idb-held': { hits: 1, site: { ...ZERO.site, 'same-origin': 1 } } })['opaque-origin'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'ambient-origin-held': { hits: 0 } })['opaque-origin']).toEqual({ verdict: 'not-measured', detail: 'no report: origin' });
  });

  it('ambient state: a reachable store does not hold; a missing report is not measured', () => {
    expect(verdictsOf({ 'ambient-local-broke': one })['no-ambient-state']).toEqual({ verdict: 'does-not-hold', detail: 'reachable: local' });
    expect(verdictsOf({ 'ambient-caches-held': { hits: 0 } })['no-ambient-state']).toEqual({ verdict: 'not-measured', detail: 'no report: caches' });
  });

  it('no cookie: a frame request with the cookie, or the preflighted one arriving, does not hold; no control cookie or no arrival is not measured', () => {
    expect(verdictsOf({ 'cookie-xhr': { hits: 1, cookie: 1 } })['no-cookie'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'cookie-fetch-marker': one })['no-cookie'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'cookie-console': { hits: 1, cookie: 0 } })['no-cookie'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'cookie-console': { hits: 0 } })['no-cookie'].verdict).toBe('not-measured');
    const none = { 'cookie-fetch': { hits: 0 }, 'cookie-xhr': { hits: 0 }, 'cookie-beacon': { hits: 0 }, 'cookie-image': { hits: 0 } };
    expect(verdictsOf(none)['no-cookie']).toEqual({ verdict: 'not-measured', detail: 'no frame request arrived' });
    expect(verdictsOf({ ...none, 'cookie-ran': { hits: 0 } })['no-cookie']).toEqual({ verdict: 'not-measured', detail: 'the frame did not run' });
  });

  it('csp-27: a wall channel or a hostile target arriving does not hold; no canary is not measured', () => {
    expect(verdictsOf({ 'csp-beacon': one })['csp-27']).toEqual({ verdict: 'does-not-hold', detail: '1 of 27 reached: beacon' });
    expect(verdictsOf({ 'hostile-img': one })['csp-27'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'csp-canary': { hits: 0 } })['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the wall frame did not run' });
  });

  it('csp-27: under M8.B1\'s control floor, iframe left out, the line is not measured; at the floor it holds (F6)', () => {
    expect(LAB_CONTROL_FLOOR).toBe(20);
    const reachable = LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe');
    const control = (n: number): Over => Object.fromEntries(LAB_BATTERY_CHANNELS.map((c) => [`ctl-${c}`, { hits: reachable.indexOf(c) > -1 && reachable.indexOf(c) < n ? 1 : 0 }])) as Over;
    expect(verdictsOf(control(19))['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the control frame reached 19 of 26 (floor 20)' });
    expect(verdictsOf({ ...control(19), 'ctl-iframe': one })['csp-27'].verdict, 'iframe does not count toward the floor').toBe('not-measured');
    expect(verdictsOf(control(20))['csp-27'].verdict).toBe('holds');
    expect(verdictsOf(control(0))['csp-27']).toEqual({ verdict: 'not-measured', detail: 'the control frame reached 0 of 26 (floor 20)' });
  });

  it('csp-27: a library mount that never became ready is not measured, never holds (F6)', () => {
    for (const hostile of [null, { ready: false, effects: 0, addressChanged: false }]) {
      expect(verdictsOf({}, { ...LOCAL_OK, hostile })['csp-27'])
        .toEqual({ verdict: 'not-measured', detail: 'library not measured: the hostile mount never became ready' });
    }
    expect(verdictsOf({ 'hostile-click': one }, { ...LOCAL_OK, hostile: null })['csp-27'].verdict, 'an arrival still decides first').toBe('does-not-hold');
  });

  it('popups: any target reached, a returned window or a read of the console address does not hold; no tap or a missing report is not measured', () => {
    for (const n of ['popup-open', 'popup-blank', 'top-nav', 'popup-window', 'top-read-broke'] as const) {
      expect(verdictsOf({ [n]: one } as Over)['no-popup-top-nav'].verdict, n).toBe('does-not-hold');
    }
    expect(verdictsOf({ 'popup-ran': { hits: 0 } })['no-popup-top-nav'])
      .toEqual({ verdict: 'not-measured', detail: 'the button in the frame was not tapped' });
    expect(verdictsOf({ 'top-write-threw': { hits: 0 } })['no-popup-top-nav'])
      .toEqual({ verdict: 'not-measured', detail: 'a report did not arrive' });
  });

  it('popups, refinement (u): a top-navigation write that returned without an error, with nothing at its target, holds and says so', () => {
    expect(verdictsOf({ 'top-write-threw': { hits: 0 }, 'top-write-returned': one })['no-popup-top-nav'])
      .toEqual({ verdict: 'holds', detail: 'top navigation blocked without an error' });
    expect(verdictsOf({ 'top-write-threw': { hits: 0 }, 'top-write-returned': one, 'top-nav': one })['no-popup-top-nav'].verdict)
      .toBe('does-not-hold');
  });

  it('self-navigation: the navigation arriving does not hold; no tried report is not measured', () => {
    expect(verdictsOf({ 'self-nav': one })['no-self-navigate'].verdict).toBe('does-not-hold');
    expect(verdictsOf({ 'self-nav-tried': { hits: 0 } })['no-self-navigate'].verdict).toBe('not-measured');
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: 1 })['no-self-navigate'].verdict, 'the wall is the door\'s silence alone').toBe('holds');
  });

  it('teardown signal: a second load holds; none differs from desktop, a miss E18 reads, never a broken wall; no run is not measured (F7)', () => {
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: 1 })['self-nav-teardown']).toEqual({ verdict: 'differs', detail: 'no second load' });
    expect(verdictsOf({}, { ...LOCAL_OK, selfNavLoads: null })['self-nav-teardown'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'self-nav-tried': { hits: 0 } })['self-nav-teardown'].verdict).toBe('not-measured');
  });

  it('strays: an effect or an address change does not hold; a reader that never became ready is not measured', () => {
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: true, effects: 1, addressChanged: false } })['bridge-strays'].verdict).toBe('does-not-hold');
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: true, effects: 0, addressChanged: true } })['bridge-strays'].verdict).toBe('does-not-hold');
    expect(verdictsOf({}, { ...LOCAL_OK, hostile: { ready: false, effects: 0, addressChanged: false } })['bridge-strays'].verdict).toBe('not-measured');
    expect(verdictsOf({ 'strays-sent': { hits: 0 } })['bridge-strays'].verdict).toBe('not-measured');
  });

  it('busy frame: a fact, never a pass or a fail: a gap over most of the spin is a shared thread, whatever the budget (F2)', () => {
    const shared = verdictsOf({}, { ...LOCAL_OK, busy: { longestGapMs: 3012, timerLateMs: 2489, spinMs: 3000 } })['busy-frame'];
    expect(shared).toEqual({ verdict: 'shared-thread', detail: 'longest gap 3012 ms in a 3000 ms spin; watchdog timer 2489 ms late' });
    expect(verdictsOf({}, { ...LOCAL_OK, busy: { longestGapMs: 30, timerLateMs: 250, spinMs: 3000 } })['busy-frame'].verdict).toBe('own-thread');
    expect(verdictsOf({ 'busy-end': { hits: 0 } })['busy-frame'].verdict).toBe('not-measured');
    expect(verdictsOf({}, { ...LOCAL_OK, busy: null })['busy-frame'].verdict).toBe('not-measured');
  });

  it('mermaid: every figure mount counts, the six together included; the worst gap decides (F3)', () => {
    const slow = LOCAL_OK.mounts.map((m) => (m.label === 'f4' ? { ...m, longestGapMs: 420 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: slow }).mermaid).toEqual({ verdict: 'does-not-hold', detail: 'longest gap 420 ms, figure 4' });
    const heavy = LOCAL_OK.mounts.map((m) => (m.label === 'all' ? { ...m, longestGapMs: 1310 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: heavy }).mermaid)
      .toEqual({ verdict: 'does-not-hold', detail: 'longest gap 1310 ms, all six together; worst single: figure 5, 70 ms' });
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: [] }).mermaid).toEqual({ verdict: 'not-measured', detail: 'not run' });
  });

  it('mermaid: a mount that fell back or timed out still counts its gap; within the budget it is not measured, never holds (F4)', () => {
    const timedOut = LOCAL_OK.mounts.map((m) => (m.label === 'f3' ? { ...m, outcome: 'timeout' as const, longestGapMs: 420 } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: timedOut }).mermaid).toEqual({ verdict: 'does-not-hold', detail: 'longest gap 420 ms, figure 3' });
    const fell = LOCAL_OK.mounts.map((m) => (m.label === 'f2' ? { ...m, outcome: 'fallback' as const } : m));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: fell }).mermaid).toEqual({ verdict: 'not-measured', detail: 'did not draw: f2 fallback' });
    const none = LOCAL_OK.mounts.map((m) => ({ ...m, outcome: 'timeout' as const }));
    expect(verdictsOf({}, { ...LOCAL_OK, mounts: none }).mermaid.verdict).toBe('not-measured');
  });

  it('a forged arrival cannot hide a real broke: held reports added to a broken wall leave it broken (M10.13)', () => {
    const v = verdictsOf({ 'ambient-parent-broke': one, 'ambient-parent-held': { hits: 9 }, 'ambient-local-broke': one, 'ambient-local-held': { hits: 9 } });
    expect([v['opaque-origin'].verdict, v['no-ambient-state'].verdict]).toEqual(['does-not-hold', 'does-not-hold']);
  });

  it('a saturated or unread run makes every count line not measured; mermaid still reads its mounts', () => {
    for (const v of [labVerdicts(runWith(HEALTHY, { saturated: true }), LOCAL_OK, 200), labVerdicts(null, LOCAL_OK, 200)]) {
      for (const k of LAB_CHECKS.filter((c) => c !== 'mermaid')) expect(v[k].verdict, k).toBe('not-measured');
      expect(v.mermaid.verdict).toBe('holds');
    }
  });

  it('the draw-on-open reading: what the busy frame\'s fact and the Mermaid line mean for drawing on open', () => {
    const shared = { ...LOCAL_OK, busy: { longestGapMs: 3012, timerLateMs: 2489, spinMs: 3000 } };
    const read = (local: LabLocal, over: Over = {}): string => drawOnOpenReading(verdictsOf(over, local), local, 200);
    expect(read(LOCAL_OK)).toBe('costs the console nothing here; the change only stops ready waiting for figures');
    expect(read(shared)).toBe('fits the budget here, though the frame shares the thread');
    const heavy = { ...shared, mounts: shared.mounts.map((m) => (m.label === 'all' ? { ...m, longestGapMs: 1310 } : m)) };
    expect(read(heavy)).toBe('needs one figure per task here; every single figure fits the budget');
    const slow = { ...heavy, mounts: heavy.mounts.map((m) => (m.label === 'f4' ? { ...m, longestGapMs: 420 } : m)) };
    expect(read(slow)).toBe('needs one figure per task here, and f4 still exceed the budget: draw those on tap or when scrolled into view');
    expect(read(LOCAL_OK, { 'busy-end': { hits: 0 } })).toBe('not measured');
  });
});

describe('the device line and the result block (reader lab plan, Task 8)', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const ALL: LabFeatures = { worker: true, frameSandbox: true, cspAttribute: true };

  it('deviceOf keeps classes only: engine and major version, OS class, cores, and the three features', () => {
    const cases: readonly (readonly [string, unknown, string, string, number | null])[] = [
      [ANDROID, 8, 'Blink 141', 'Android', 8],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', 6, 'WebKit 19', 'iOS', 6],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1', 6, 'WebKit 19', 'iOS', 6],
      ['Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0', 8, 'Gecko 140', 'Android', 8],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15', 10, 'WebKit 19', 'macOS', 10],
      ['x', 0, 'unknown', 'other', null],
      ['x', 'eight', 'unknown', 'other', null],
    ];
    for (const [ua, cores, engine, os, n] of cases) expect(deviceOf(ua, cores, ALL), ua).toEqual({ engine, os, cores: n, ...ALL });
  });

  it('labFeaturesOf tests presence only: a Worker, the iframe sandbox attribute, and the iframe csp attribute', () => {
    const proto = { sandbox: null };
    expect(labFeaturesOf({ Worker: function W() { /* a constructor */ }, HTMLIFrameElement: { prototype: proto } }))
      .toEqual({ worker: true, frameSandbox: true, cspAttribute: false });
    expect(labFeaturesOf({ HTMLIFrameElement: { prototype: { ...proto, csp: '' } } })).toEqual({ worker: false, frameSandbox: true, cspAttribute: true });
    expect(labFeaturesOf(null)).toEqual({ worker: false, frameSandbox: false, cspAttribute: false });
  });

  it('the block is format 1: fixed keys in order, each line\'s words, the budget, the gaps, the reading and the door line, and no host, nonce or user agent (M10.14)', () => {
    expect(LAB_RESULT_FORMAT).toBe(1);
    const run = runWith(HEALTHY, { counted: 151 });
    const text = formatLabResult(deviceOf(ANDROID, 8, ALL), 'abcdef012345', labVerdicts(run, LOCAL_OK, 200), LOCAL_OK, run, 200, 'read');
    const lines = text.split('\n');
    expect(lines[0]).toBe('reader-lab 1 · Blink 141 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library abcdef012345');
    expect(lines[1]).toBe('E18 walls: 7 of 7 hold; teardown signal holds');
    expect(lines.slice(2, 10).map((l) => l.trim().split(/\s+/)[0])).toEqual([...LAB_E18]);
    for (const l of lines.slice(2, 9)) expect(l).toMatch(/^ {2}[a-z0-9-]+ +(?:holds|does not hold|not measured)(?: \(.+\))?$/);
    expect(lines[9]).toBe('  self-nav-teardown  holds (second load fired)');
    expect(lines[10]).toBe('E17 responsive (mermaid budget 200 ms):');
    expect(lines[11]).toBe('  busy-frame         own thread (longest gap 30 ms in a 3000 ms spin; watchdog timer 5 ms late)');
    expect(lines[12]!.trim().startsWith('mermaid            holds')).toBe(true);
    expect(lines[13]).toBe('    gaps ms          none 40 · trivial 120 · f1 30 · f2 20 · f3 50 · f4 60 · f5 70 · f6 25 · all 150');
    expect(lines[14]).toBe('draw on open: costs the console nothing here; the change only stops ready waiting for figures');
    expect(lines[15]).toBe('door: 151 counted, 0 ignored; session cookie sent');
    for (const leak of ['Mozilla', 'Chrome/', 'box.example', 'AAAAAAAAAAAAAAAAAAAAAA', 'http']) expect(text, leak).not.toContain(leak);
    const broken = labVerdicts(runWith({ ...HEALTHY, 'self-nav': one, 'popup-ran': { hits: 0 } }), { ...LOCAL_OK, selfNavLoads: 1 }, 200);
    expect(formatLabResult(deviceOf(ANDROID, null, ALL), 'abcdef012345', broken, LOCAL_OK, null, 200, 'read').split('\n')[1])
      .toBe('E18 walls: 5 of 7 hold, 1 does not hold, 1 not measured; teardown signal differs from desktop');
  });

  it('the door line names a console request without the cookie, and a final read that found the run gone', () => {
    const run = runWith({ ...HEALTHY, 'cookie-console': { hits: 1, cookie: 0 } }, { counted: 140 });
    const last = formatLabResult(deviceOf('x', null, ALL), 'abcdef012345', labVerdicts(run, LOCAL_OK, 200), LOCAL_OK, run, 200, 'unknown-run')
      .split('\n').pop();
    expect(last).toBe('door: 140 counted, 0 ignored; no session cookie (sign-in gate off?); final read found the run gone, counts as of the hostile step');
  });
});
```

  In the format case's last assertion the verdicts come from a run (one wall broken, one not measured, and no second `load`) and `formatLabResult` is handed `null` only for its door line, which then reads `door: not read`.
- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-verdicts.test.ts )` — Expected (prediction): the file fails to load.
- [ ] **Step 3: Write `pwa/src/readerLab/checks.ts`** with exactly this content:

```ts
// The reader lab's checks, in the result's order (native Docs reader, the reader lab plan of 2026-11-03, Task 8; the
// reader lab design, section 3.2). Ring L1: it imports nothing.

/** The ten lines: the seven walls and the teardown signal (E18), then the two E17 lines. */
export type LabCheckId = 'opaque-origin' | 'no-ambient-state' | 'no-cookie' | 'csp-27' | 'no-popup-top-nav'
  | 'no-self-navigate' | 'bridge-strays' | 'self-nav-teardown' | 'busy-frame' | 'mermaid';

/** The step after which each line has its outcome (the run's step numbers; `csp-27` waits for the hostile page). */
export const LAB_CHECK_STEP: Readonly<Record<LabCheckId, number>> = {
  'opaque-origin': 2, 'no-ambient-state': 2, 'no-cookie': 3, 'csp-27': 7, 'no-popup-top-nav': 1,
  'no-self-navigate': 5, 'bridge-strays': 7, 'self-nav-teardown': 5, 'busy-frame': 6, mermaid: 8,
};
export const LAB_CHECKS = Object.keys(LAB_CHECK_STEP) as LabCheckId[];
/** The seven walls, which E18's summary counts. */
export const LAB_WALLS: readonly LabCheckId[] = LAB_CHECKS.slice(0, 7);
/** E18's lines: the seven walls, then the engine's teardown signal. */
export const LAB_E18: readonly LabCheckId[] = LAB_CHECKS.slice(0, 8);
/** E17's lines: the busy frame's fact and the Mermaid stall. */
export const LAB_E17: readonly LabCheckId[] = LAB_CHECKS.slice(8);

/** A line's outcome. Every line has three, never two: the walls and `mermaid` answer `holds`, `does-not-hold` or
 *  `not-measured`; `self-nav-teardown` answers `holds`, `differs` (from desktop Chromium: a miss E18 investigates, never a
 *  broken wall) or `not-measured`; `busy-frame` is a fact that gates nothing: `shared-thread`, `own-thread` or
 *  `not-measured`. */
export type LabVerdict = 'holds' | 'does-not-hold' | 'not-measured' | 'differs' | 'shared-thread' | 'own-thread';
export interface LabOutcome {
  readonly verdict: LabVerdict;
  /** A short fact for the result line; empty when there is none. */
  readonly detail: string;
}
```

- [ ] **Step 4: Write `pwa/src/readerLab/device.ts`** with exactly this content:

```ts
// The reader lab's device line (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinement (n)). Ring L1:
// pure. Classes only, from the user agent string, the core count and three feature tests: the engine and its major
// version, the OS class, the cores, and whether the browser has what the reader frame relies on; never the user agent
// string itself or a device model, so the result can go into a public ledger as it is.

/** What the reader frame relies on, tested once by presence: a Worker (the parse), the iframe `sandbox` attribute, and the
 *  iframe `csp` attribute (Chromium's alone: where it is missing, the frame document's meta alone carries the frame
 *  policy). That the lab's own sandboxed frames ran at all is the stronger proof, which the check lines carry. */
export interface LabFeatures {
  readonly worker: boolean;
  readonly frameSandbox: boolean;
  readonly cspAttribute: boolean;
}

export interface LabDevice extends LabFeatures {
  /** `Blink 141`, `WebKit 19`, `Gecko 140`, or `unknown`. */
  readonly engine: string;
  /** `Android`, `iOS`, `macOS`, `Windows`, `Linux` or `other`. */
  readonly os: string;
  /** Null: the browser does not say. */
  readonly cores: number | null;
}

/** The features, read from `win` (the page hands it `window`): presence tests, nothing called. */
export function labFeaturesOf(win: unknown): LabFeatures {
  const w = (typeof win === 'object' && win !== null ? win : {}) as { readonly Worker?: unknown; readonly HTMLIFrameElement?: { readonly prototype?: unknown } };
  const proto = w.HTMLIFrameElement?.prototype;
  const has = (k: string): boolean => typeof proto === 'object' && proto !== null && k in proto;
  return { worker: typeof w.Worker === 'function', frameSandbox: has('sandbox'), cspAttribute: has('csp') };
}

/** The device line's facts. Every browser on iOS is WebKit, whatever its name. */
export function deviceOf(ua: string, cores: unknown, features: LabFeatures): LabDevice {
  const first = (re: RegExp): string | null => re.exec(ua)?.[1] ?? null;
  const tagged = (name: string, version: string | null): string => (version === null ? name : `${name} ${version}`);
  const ios = /\b(?:iPhone|iPad|iPod)\b/.test(ua);
  const os = /Android/.test(ua) ? 'Android' : ios ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const engine = ios ? tagged('WebKit', first(/OS (\d+)[_.]/))
    : /Firefox\/\d+/.test(ua) ? tagged('Gecko', first(/Firefox\/(\d+)/))
      : /(?:Chrome|Chromium)\/\d+/.test(ua) ? tagged('Blink', first(/(?:Chrome|Chromium)\/(\d+)/))
        : /AppleWebKit\//.test(ua) ? tagged('WebKit', first(/Version\/(\d+)/))
          : 'unknown';
  return { engine, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };
}

/** The device line, in order: the result block's first line and the page say the same facts. */
export function deviceFacts(d: LabDevice): string[] {
  const yes = (b: boolean): string => (b ? 'yes' : 'no');
  return [d.engine, d.os, ...(d.cores === null ? [] : [`${d.cores} cores`]), `worker ${yes(d.worker)}`,
    `frame sandbox ${yes(d.frameSandbox)}`, `csp attribute ${yes(d.cspAttribute)}`];
}
```

- [ ] **Step 5: Write `pwa/src/readerLab/verdicts.ts`** with exactly this content:

```ts
// The reader lab's verdicts (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinements (l) and (u); the
// reader lab design, section 3.2; the rich-docs spec's row M10.13). Ring L1: pure. Each line answers one of its three
// words and a short detail, from the door's counts for the run and what the page itself observed. "Not measured" never
// folds into "holds": a check holds only once its own positive signal is there (a frame's report, the control and its
// floor, the canary, the tap, a mount that reached ready), and a wall's broken signals are read first, so a forged arrival
// cannot hide a real "broke" or a real arrival at a wall's target. (A forged POSITIVE signal can still turn "not measured"
// into "holds" for a frame that never ran: that defence is the nonce's secrecy, the design's section 4.6, not these
// rules.) An unread or saturated run makes every line that reads counts "not measured". `busy-frame` is a fact that gates
// nothing; `self-nav-teardown` names an engine that differs from desktop Chromium without calling a wall broken.
import { LAB_BATTERY_CHANNELS, type LabBatteryChannel, type LabProbeName, type LabRunView } from '../../../shared/readerLab';
import type { LabCheckId, LabOutcome } from './checks';
import { LAB_STRAYS_POSTED } from './frameScripts';

/** One timed mount of the production reader under the lab profile. */
export interface LabMount {
  /** `none`, `trivial`, `f1` to `f6`, or `all`. */
  readonly label: string;
  readonly outcome: 'ready' | 'fallback' | 'timeout' | 'not-rendered';
  /** The longest gap between animation frames from the mount's start to its outcome. */
  readonly longestGapMs: number;
  /** From the mount's start to its outcome. */
  readonly elapsedMs: number;
}

/** What the page itself observed. Each `null` means that step did not run (the run stopped or failed before it). */
export interface LabLocal {
  /** The `load` events the self-navigating frame fired. */
  readonly selfNavLoads: number | null;
  readonly busy: { readonly longestGapMs: number; readonly timerLateMs: number; readonly spinMs: number } | null;
  /** The figure mounts, in run order; empty when that step did not run. */
  readonly mounts: readonly LabMount[];
  /** The hostile page's mount: whether it became ready, and the host callbacks the stray messages reached. */
  readonly hostile: { readonly ready: boolean; readonly effects: number; readonly addressChanged: boolean } | null;
}

const ORIGIN_KEYS = ['parent', 'origin'] as const;
const STORE_KEYS = ['cookie', 'local', 'session', 'idb', 'caches'] as const;
type AmbientKey = (typeof ORIGIN_KEYS)[number] | (typeof STORE_KEYS)[number];
const COOKIE_CHANNELS = ['cookie-fetch', 'cookie-xhr', 'cookie-beacon', 'cookie-websocket', 'cookie-image'] as const;
const HOSTILE_TARGETS = ['hostile-img', 'hostile-click'] as const;
const POPUP_TARGETS = ['popup-open', 'popup-blank', 'top-nav'] as const;

/** The control frame's floor: the rich-docs spec's M8.B1 ("Without the meta, B is reached on at least 20/27"). Below it,
 *  too few channels are shown to leave a frame on this engine for "0 reached" in the wall frame to mean anything. */
export const LAB_CONTROL_FLOOR = 20;
/** Channels no lab frame can reach by design: a srcdoc frame inherits the console shell's `frame-src 'none'`, so its
 *  `iframe` channel never leaves. They are left out before the floor is compared, and named as not measured. */
const UNREACHABLE: readonly LabBatteryChannel[] = ['iframe'];

const holds = (detail = ''): LabOutcome => ({ verdict: 'holds', detail });
const broken = (detail: string): LabOutcome => ({ verdict: 'does-not-hold', detail });
const unmeasured = (detail: string): LabOutcome => ({ verdict: 'not-measured', detail });
const ms = (n: number): string => String(Math.round(n));
const hits = (r: LabRunView, n: LabProbeName): number => r.probes[n].hits;

/** A self-report: `broke` if any broke report arrived, else `held` if a held one did, else `missing`. */
function report(r: LabRunView, key: AmbientKey): 'held' | 'broke' | 'missing' {
  if (hits(r, `ambient-${key}-broke` as LabProbeName) > 0) return 'broke';
  return hits(r, `ambient-${key}-held` as LabProbeName) > 0 ? 'held' : 'missing';
}

function opaqueOrigin(r: LabRunView): LabOutcome {
  const sameOrigin = [...ORIGIN_KEYS, ...STORE_KEYS]
    .flatMap((k) => [`ambient-${k}-held`, `ambient-${k}-broke`] as LabProbeName[])
    .reduce((n, name) => n + r.probes[name].site['same-origin'], 0);
  const broke = ORIGIN_KEYS.filter((k) => report(r, k) === 'broke');
  if (broke.length > 0 || sameOrigin > 0) {
    return broken([
      ...broke.map((k) => (k === 'parent' ? 'the console page was readable' : "the frame's origin was not null")),
      ...(sameOrigin > 0 ? ['a report arrived as same-origin'] : []),
    ].join('; '));
  }
  const missing = ORIGIN_KEYS.filter((k) => report(r, k) === 'missing');
  return missing.length > 0 ? unmeasured(`no report: ${missing.join(', ')}`) : holds();
}

function ambientState(r: LabRunView): LabOutcome {
  const broke = STORE_KEYS.filter((k) => report(r, k) === 'broke');
  if (broke.length > 0) return broken(`reachable: ${broke.join(', ')}`);
  const missing = STORE_KEYS.filter((k) => report(r, k) === 'missing');
  return missing.length > 0 ? unmeasured(`no report: ${missing.join(', ')}`) : holds();
}

function noCookie(r: LabRunView): LabOutcome {
  const withCookie = COOKIE_CHANNELS.filter((n) => r.probes[n].cookie > 0);
  if (withCookie.length > 0) return broken(`the cookie rode: ${withCookie.join(', ')}`);
  if (hits(r, 'cookie-fetch-marker') > 0) return broken('a request that needs a preflight reached the server');
  const control = r.probes['cookie-console'];
  if (control.hits === 0) return unmeasured("the console's own request did not arrive");
  if (control.cookie === 0) return unmeasured('this console sent no session cookie (is the sign-in gate off?)');
  const arrived = COOKIE_CHANNELS.filter((n) => hits(r, n) > 0);
  if (arrived.length === 0) return unmeasured(hits(r, 'cookie-ran') > 0 ? 'no frame request arrived' : 'the frame did not run');
  return holds(`${arrived.length} arrived, 0 with the cookie; the control carried it`);
}

function csp27(r: LabRunView, local: LabLocal): LabOutcome {
  const reached = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `csp-${c}`) > 0);
  const library = HOSTILE_TARGETS.filter((n) => hits(r, n) > 0);
  if (reached.length > 0 || library.length > 0) {
    return broken([
      ...(reached.length > 0 ? [`${reached.length} of 27 reached: ${reached.join(', ')}`] : []),
      ...(library.length > 0 ? [`the library reached ${library.join(', ')}`] : []),
    ].join('; '));
  }
  if (hits(r, 'csp-canary') === 0) return unmeasured('the wall frame did not run');
  const measured = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `ctl-${c}`) > 0);
  const reachable = LAB_BATTERY_CHANNELS.filter((c) => !UNREACHABLE.includes(c));
  const counted = measured.filter((c) => !UNREACHABLE.includes(c)).length;
  if (counted < LAB_CONTROL_FLOOR) return unmeasured(`the control frame reached ${counted} of ${reachable.length} (floor ${LAB_CONTROL_FLOOR})`);
  if (local.hostile?.ready !== true) return unmeasured('library not measured: the hostile mount never became ready');
  const unseen = LAB_BATTERY_CHANNELS.filter((c) => hits(r, `ctl-${c}`) === 0);
  return holds(`0 of 27 reached; ${measured.length} measured${unseen.length > 0 ? `; not measured: ${unseen.join(', ')}` : ''}; library 0 of 2`);
}

function popups(r: LabRunView): LabOutcome {
  const escaped = POPUP_TARGETS.filter((n) => hits(r, n) > 0);
  const opened = hits(r, 'popup-window') > 0;
  const readTop = hits(r, 'top-read-broke') > 0;
  if (escaped.length > 0 || opened || readTop) {
    return broken([
      ...escaped.map((n) => `${n} reached the server`),
      ...(opened ? ['window.open returned a window'] : []),
      ...(readTop ? ["the frame read the console's address"] : []),
    ].join('; '));
  }
  if (hits(r, 'popup-ran') === 0) return unmeasured('the button in the frame was not tapped');
  const threw = hits(r, 'top-write-threw') > 0;
  if (hits(r, 'popup-null') === 0 || hits(r, 'top-read-held') === 0 || (!threw && hits(r, 'top-write-returned') === 0)) {
    return unmeasured('a report did not arrive');
  }
  // Refinement (u): a top-navigation write that returned without an error, while nothing reached its target, holds. The
  // wall is that the console stayed where it was, which the door's silence shows; the detail names the difference from
  // M8.B4's "throws".
  return holds(threw ? '' : 'top navigation blocked without an error');
}

function selfNavigate(r: LabRunView): LabOutcome {
  if (hits(r, 'self-nav') > 0) return broken('the frame navigated itself to the server');
  return hits(r, 'self-nav-tried') === 0 ? unmeasured('the frame did not run') : holds();
}

/** The engine's teardown signal: a blocked self-navigation fires a second `load`, which is what closes the reader's port
 *  (the rich-docs spec's section 5.1 and M8.B5). No port exists in a lab frame; this is the engine signal it relies on. An
 *  engine without it differs from desktop Chromium: a miss E18 investigates, not a broken wall. */
function selfNavTeardown(r: LabRunView, local: LabLocal): LabOutcome {
  if (hits(r, 'self-nav-tried') === 0 || local.selfNavLoads === null) return unmeasured('the frame did not run');
  return local.selfNavLoads >= 2 ? holds('second load fired') : { verdict: 'differs', detail: 'no second load' };
}

function strays(r: LabRunView, local: LabLocal): LabOutcome {
  const h = local.hostile;
  if (h !== null && (h.effects > 0 || h.addressChanged)) {
    return broken(`${h.effects} effects${h.addressChanged ? '; the address changed' : ''}`);
  }
  if (h === null || !h.ready) return unmeasured('the reader did not become ready');
  if (hits(r, 'strays-sent') === 0) return unmeasured('the stray frame did not run');
  return holds(`${LAB_STRAYS_POSTED} sent, 0 effects`);
}

/** A fact, never a pass or a fail: whether the busy frame shares the console's thread (its spin stops the console's
 *  frames for most of the spin), and how late the console's timer, the reader watchdog's stand-in, fired. It steers the
 *  Mermaid policy and gates nothing: a deliberate spin on a shared thread can meet no budget. */
function busyFrame(r: LabRunView, local: LabLocal): LabOutcome {
  const b = local.busy;
  if (b === null || hits(r, 'busy-start') === 0 || hits(r, 'busy-end') === 0) return unmeasured('the busy frame did not run');
  return {
    verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'shared-thread' : 'own-thread',
    detail: `longest gap ${ms(b.longestGapMs)} ms in a ${ms(b.spinMs)} ms spin; watchdog timer ${ms(b.timerLateMs)} ms late`,
  };
}

const worstOf = (list: readonly LabMount[]): LabMount => list.reduce((a, b) => (b.longestGapMs > a.longestGapMs ? b : a));

/** The Mermaid stall under the lab profile's draw mode, draw on open. Every figure mount counts, the six together (`all`,
 *  the heavy page) included, and so does a mount that fell back or timed out, where a stall is likeliest: the worst gap of
 *  them all decides. Over the budget: does not hold. Within it, a figure mount that did not draw cannot show that it
 *  holds: not measured, naming it. */
function mermaid(local: LabLocal, budgetMs: number): LabOutcome {
  const figures = local.mounts.filter((m) => /^f\d$/.test(m.label) || m.label === 'all');
  if (figures.length === 0) return unmeasured('not run');
  const worst = worstOf(figures);
  const singles = figures.filter((m) => m.label !== 'all');
  const single = singles.length === 0 ? null : worstOf(singles);
  const where = worst.label !== 'all' ? `figure ${worst.label.slice(1)}`
    : `all six together${single === null ? '' : `; worst single: figure ${single.label.slice(1)}, ${ms(single.longestGapMs)} ms`}`;
  const detail = `longest gap ${ms(worst.longestGapMs)} ms, ${where}`;
  if (worst.longestGapMs > budgetMs) return broken(detail);
  const missed = figures.filter((m) => m.outcome !== 'ready').map((m) => `${m.label} ${m.outcome}`);
  return missed.length > 0 ? unmeasured(`did not draw: ${missed.join(', ')}`) : holds(detail);
}

/** What the E17 lines mean for drawing Mermaid on open, the operator's ruling of 2026-11-03 (the reader lab design,
 *  section 8): one reading of the busy frame's fact and the Mermaid line together, for the library change. Not a verdict. */
export function drawOnOpenReading(o: Readonly<Record<LabCheckId, LabOutcome>>, local: LabLocal, budgetMs: number): string {
  const busy = o['busy-frame'].verdict;
  const m = o.mermaid.verdict;
  if (busy === 'not-measured' || m === 'not-measured') return 'not measured';
  if (busy === 'own-thread') {
    return m === 'holds' ? 'costs the console nothing here; the change only stops ready waiting for figures'
      : 'the console stalls though the frame has its own thread; read the gaps';
  }
  if (m === 'holds') return 'fits the budget here, though the frame shares the thread';
  const over = local.mounts.filter((x) => /^f\d$/.test(x.label) && x.longestGapMs > budgetMs).map((x) => x.label);
  return over.length === 0 ? 'needs one figure per task here; every single figure fits the budget'
    : `needs one figure per task here, and ${over.join(', ')} still exceed the budget: draw those on tap or when scrolled into view`;
}

/** Every check's outcome. `run` null: the door could not be read. */
export function labVerdicts(run: LabRunView | null, local: LabLocal, budgetMs: number): Record<LabCheckId, LabOutcome> {
  const fromCounts = (f: (r: LabRunView) => LabOutcome): LabOutcome => {
    if (run === null) return unmeasured('the door could not be read');
    if (run.saturated) return unmeasured('the door counted more than a lab run sends');
    return f(run);
  };
  return {
    'opaque-origin': fromCounts((r) => opaqueOrigin(r)),
    'no-ambient-state': fromCounts((r) => ambientState(r)),
    'no-cookie': fromCounts((r) => noCookie(r)),
    'csp-27': fromCounts((r) => csp27(r, local)),
    'no-popup-top-nav': fromCounts((r) => popups(r)),
    'no-self-navigate': fromCounts((r) => selfNavigate(r)),
    'bridge-strays': fromCounts((r) => strays(r, local)),
    'self-nav-teardown': fromCounts((r) => selfNavTeardown(r, local)),
    'busy-frame': fromCounts((r) => busyFrame(r, local)),
    mermaid: mermaid(local, budgetMs),
  };
}
```

- [ ] **Step 6: Write `pwa/src/readerLab/result.ts`** with exactly this content:

```ts
// The reader lab's result block, format 1 (native Docs reader, the reader lab plan of 2026-11-03, Task 8, refinement (n);
// the reader lab design, section 6; the rich-docs spec's row M10.14). Ring L1: pure. The text the operator selects and
// sends: device classes, fixed keys in a fixed order, each line's own words, the draw-on-open reading, and no host, origin,
// nonce, project, path or user agent, so it can go into a public ledger as it is.
import type { LabRunView } from '../../../shared/readerLab';
import { LAB_E17, LAB_E18, LAB_WALLS, type LabCheckId, type LabOutcome, type LabVerdict } from './checks';
import { deviceFacts, type LabDevice } from './device';
import { drawOnOpenReading, type LabLocal } from './verdicts';

/** The block's format. Adding a line, a key or a parenthesised detail keeps it; changing what a key, a word or a number
 *  means, or removing a line, makes it 2. */
export const LAB_RESULT_FORMAT = 1;

/** The words, the block's and the page's: `labText.ts` shows these. */
export const LAB_VERDICT_WORDS: Readonly<Record<LabVerdict, string>> = {
  holds: 'holds', 'does-not-hold': 'does not hold', 'not-measured': 'not measured', differs: 'differs from desktop',
  'shared-thread': 'shared thread', 'own-thread': 'own thread',
};

/** How the run's final read went. Every verdict's counts were read by the hostile step, so a final read that finds the run
 *  gone or unreadable keeps the last view, and the door line says so. */
export type LabFinalRead = 'read' | 'unknown-run' | 'unreadable';

const lineOf = (key: string, o: LabOutcome): string => `  ${key.padEnd(18)} ${LAB_VERDICT_WORDS[o.verdict]}${o.detail === '' ? '' : ` (${o.detail})`}`;

/** The block. `library` is the library build; `run` null means the door could not be read. */
export function formatLabResult(
  device: LabDevice, library: string, outcomes: Readonly<Record<LabCheckId, LabOutcome>>, local: LabLocal,
  run: LabRunView | null, budgetMs: number, finalRead: LabFinalRead,
): string {
  const head = [`reader-lab ${LAB_RESULT_FORMAT}`, ...deviceFacts(device), `library ${library}`].join(' · ');
  const walls = LAB_WALLS.map((k) => outcomes[k].verdict);
  const summary = [
    `${walls.filter((v) => v === 'holds').length} of ${walls.length} hold`,
    ...(['does-not-hold', 'not-measured'] as const).flatMap((v) => {
      const n = walls.filter((w) => w === v).length;
      return n === 0 ? [] : [`${n} ${LAB_VERDICT_WORDS[v]}`];
    }),
  ].join(', ');
  const gaps = local.mounts.length === 0 ? [] : [`    ${'gaps ms'.padEnd(17)}${local.mounts
    .map((m) => `${m.label} ${m.outcome === 'ready' ? String(Math.round(m.longestGapMs)) : `${Math.round(m.longestGapMs)} ${m.outcome}`}`).join(' · ')}`];
  const cookie = run === null ? '' : run.probes['cookie-console'].cookie > 0 ? '; session cookie sent' : '; no session cookie (sign-in gate off?)';
  const kept = finalRead === 'read' ? '' : `; final read ${finalRead === 'unknown-run' ? 'found the run gone' : 'unreadable'}, counts as of the hostile step`;
  const door = run === null ? 'door: not read'
    : `door: ${run.counted} counted, ${run.ignored} ignored${run.saturated ? ', saturated' : ''}${cookie}${kept}`;
  return [
    head, `E18 walls: ${summary}; teardown signal ${LAB_VERDICT_WORDS[outcomes['self-nav-teardown'].verdict]}`,
    ...LAB_E18.map((k) => lineOf(k, outcomes[k])),
    `E17 responsive (mermaid budget ${budgetMs} ms):`, ...LAB_E17.map((k) => lineOf(k, outcomes[k])),
    ...gaps, `draw on open: ${drawOnOpenReading(outcomes, local, budgetMs)}`, door,
  ].join('\n');
}
```

- [ ] **Step 7: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-verdicts.test.ts )` — Expected (prediction): `Tests  22 passed (22)`. `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts test/rings/totality.test.ts )` — green.
- [ ] **Step 8: Commit.** `git add pwa/src/readerLab/checks.ts pwa/src/readerLab/device.ts pwa/src/readerLab/verdicts.ts pwa/src/readerLab/result.ts pwa/test/reader-lab-verdicts.test.ts` (expect 5), message `pwa: the reader lab's three-outcome verdicts and its versioned result block (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, tests `test/reader-lab-verdicts.test.ts`):

| id | spec | file | old → new | expected red (prediction) |
|---|---|---|---|---|
| RLB-T8-M1 | (l) M10.13 | `src/readerLab/verdicts.ts` | `if (control.cookie === 0) return unmeasured('this console sent no session cookie (is the sign-in gate off?)');` → removed | 1 failed — `'no cookie …'` |
| RLB-T8-M2 | (l) M10.13 | `src/readerLab/verdicts.ts` | `if (hits(r, 'csp-canary') === 0) return unmeasured('the wall frame did not run');` → removed | 1 failed — `'csp-27: a wall channel or a hostile target arriving does not hold …'` |
| RLB-T8-M3 | (l) M10.13 | `src/readerLab/verdicts.ts` | `if (hits(r, 'popup-ran') === 0) return unmeasured('the button in the frame was not tapped');` → removed | 2 failed — `'popups: any target reached …'`, `'the block is format 1 …'` |
| RLB-T8-M4 | (l) M10.13 | `src/readerLab/verdicts.ts` | ``if (hits(r, `ambient-${key}-broke` as LabProbeName) > 0) return 'broke';`` → removed | 3 failed — `'opaque origin …'`, `'ambient state …'`, `'a forged arrival cannot hide a real broke …'` |
| RLB-T8-M5 | (l) M10.13 | `src/readerLab/verdicts.ts` | `const figures = local.mounts.filter((m) => /^f\d$/.test(m.label) \|\| m.label === 'all');` → `const figures = local.mounts.filter((m) => /^f\d$/.test(m.label));` | 3 failed — `'a healthy engine …'`, `'mermaid: every figure mount counts, the six together included …'`, `'the draw-on-open reading …'` |
| RLB-T8-M6 | (n) M10.14 | `src/readerLab/device.ts` | `return { engine, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };` → ``return { engine: `${engine} ${ua}`, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };`` | 2 failed — `'deviceOf keeps classes only …'`, `'the block is format 1 …'` |
| RLB-T8-M7 | (l) M10.13 | `src/readerLab/verdicts.ts` | `const figures = local.mounts.filter((m) => /^f\d$/.test(m.label) \|\| m.label === 'all');` → `const figures = local.mounts.filter((m) => (/^f\d$/.test(m.label) \|\| m.label === 'all') && m.outcome === 'ready');` | 1 failed — `'mermaid: a mount that fell back or timed out still counts its gap …'` |
| RLB-T8-M8 | (l) M10.13 | `src/readerLab/verdicts.ts` | ``return missed.length > 0 ? unmeasured(`did not draw: ${missed.join(', ')}`) : holds(detail);`` → `return holds(detail);` | 1 failed — `'mermaid: a mount that fell back or timed out still counts its gap …'` |
| RLB-T8-M9 | (l) M10.13 | `src/readerLab/verdicts.ts` | ``if (counted < LAB_CONTROL_FLOOR) return unmeasured(`the control frame reached ${counted} of ${reachable.length} (floor ${LAB_CONTROL_FLOOR})`);`` → removed | 1 failed — `'csp-27: under M8.B1\'s control floor …'` |
| RLB-T8-M10 | (l) M10.13 | `src/readerLab/verdicts.ts` | `if (local.hostile?.ready !== true) return unmeasured('library not measured: the hostile mount never became ready');` → removed | 1 failed — `'csp-27: a library mount that never became ready is not measured …'` |
| RLB-T8-M11 | (l) M10.13 | `src/readerLab/verdicts.ts` | `verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'shared-thread' : 'own-thread',` → `verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'does-not-hold' : 'own-thread',` | 1 failed — `'busy frame: a fact, never a pass or a fail …'` |
| RLB-T8-M12 | (l) M10.13 | `src/readerLab/verdicts.ts` | `return local.selfNavLoads >= 2 ? holds('second load fired') : { verdict: 'differs', detail: 'no second load' };` → `return holds(local.selfNavLoads >= 2 ? 'second load fired' : 'no second load');` | 2 failed — `'teardown signal …'`, `'the block is format 1 …'` |
| RLB-T8-M13 | (u) M10.13 | `src/readerLab/verdicts.ts` | `if (hits(r, 'popup-null') === 0 \|\| hits(r, 'top-read-held') === 0 \|\| (!threw && hits(r, 'top-write-returned') === 0)) {` → `if (hits(r, 'popup-null') === 0 \|\| hits(r, 'top-read-held') === 0) {` | 1 failed — `'popups: any target reached …'` |

```json
[
  {"id": "RLB-T8-M1", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (control.cookie === 0) return unmeasured('this console sent no session cookie (is the sign-in gate off?)');", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: no cookie"},
  {"id": "RLB-T8-M2", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (hits(r, 'csp-canary') === 0) return unmeasured('the wall frame did not run');", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: csp-27: a wall channel or a hostile target arriving does not hold"},
  {"id": "RLB-T8-M3", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (hits(r, 'popup-ran') === 0) return unmeasured('the button in the frame was not tapped');", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "2 failed: popups: any target reached; the block is format 1"},
  {"id": "RLB-T8-M4", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (hits(r, `ambient-${key}-broke` as LabProbeName) > 0) return 'broke';", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "3 failed: opaque origin; ambient state; a forged arrival cannot hide a real broke"},
  {"id": "RLB-T8-M5", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "const figures = local.mounts.filter((m) => /^f\\d$/.test(m.label) || m.label === 'all');", "new": "const figures = local.mounts.filter((m) => /^f\\d$/.test(m.label));", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "3 failed: a healthy engine; mermaid: every figure mount counts, the six together included; the draw-on-open reading"},
  {"id": "RLB-T8-M6", "spec": "(n) M10.14", "pkg": "pwa", "file": "src/readerLab/device.ts", "old": "return { engine, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };", "new": "return { engine: `${engine} ${ua}`, os, cores: typeof cores === 'number' && Number.isSafeInteger(cores) && cores > 0 ? cores : null, ...features };", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "2 failed: deviceOf keeps classes only; the block is format 1"},
  {"id": "RLB-T8-M7", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "const figures = local.mounts.filter((m) => /^f\\d$/.test(m.label) || m.label === 'all');", "new": "const figures = local.mounts.filter((m) => (/^f\\d$/.test(m.label) || m.label === 'all') && m.outcome === 'ready');", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: mermaid: a mount that fell back or timed out still counts its gap"},
  {"id": "RLB-T8-M8", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "return missed.length > 0 ? unmeasured(`did not draw: ${missed.join(', ')}`) : holds(detail);", "new": "return holds(detail);", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: mermaid: a mount that fell back or timed out still counts its gap"},
  {"id": "RLB-T8-M9", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (counted < LAB_CONTROL_FLOOR) return unmeasured(`the control frame reached ${counted} of ${reachable.length} (floor ${LAB_CONTROL_FLOOR})`);", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: csp-27: under M8.B1's control floor"},
  {"id": "RLB-T8-M10", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (local.hostile?.ready !== true) return unmeasured('library not measured: the hostile mount never became ready');", "new": "", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: csp-27: a library mount that never became ready is not measured"},
  {"id": "RLB-T8-M11", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'shared-thread' : 'own-thread',", "new": "verdict: b.longestGapMs >= 0.8 * b.spinMs ? 'does-not-hold' : 'own-thread',", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: busy frame: a fact, never a pass or a fail"},
  {"id": "RLB-T8-M12", "spec": "(l) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "return local.selfNavLoads >= 2 ? holds('second load fired') : { verdict: 'differs', detail: 'no second load' };", "new": "return holds(local.selfNavLoads >= 2 ? 'second load fired' : 'no second load');", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "2 failed: teardown signal; the block is format 1"},
  {"id": "RLB-T8-M13", "spec": "(u) M10.13", "pkg": "pwa", "file": "src/readerLab/verdicts.ts", "old": "if (hits(r, 'popup-null') === 0 || hits(r, 'top-read-held') === 0 || (!threw && hits(r, 'top-write-returned') === 0)) {", "new": "if (hits(r, 'popup-null') === 0 || hits(r, 'top-read-held') === 0) {", "tests": ["test/reader-lab-verdicts.test.ts"], "red": "1 failed: popups: any target reached"}
]
```

RLB-T8-M5 and M7 share their `old`; each is applied alone, from the saved copy.

**Verify:** `test/reader-lab-verdicts.test.ts` 22 passed; `TSC-OK`; the rings green.

### Task 9: The pages, the words, the door's read and the run (refinements (l), (o), (s), (t), (v); M10.13, M10.18)

**Run:** RL-b. **Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`.

**Files:**
- Create: `pwa/src/readerLab/fixtures.ts`, `pwa/src/readerLab/labText.ts`, `pwa/src/readerLab/wire.ts`, `pwa/src/readerLab/run.ts`, `pwa/test/reader-lab-run.test.ts`.
- Modify: `pwa/src/lib/api.ts` (one import line; `api.readerLab`, appended to the object `createApi` returns).
- Guards (not edited): `server/test/rings/pwa-one-owner.test.ts` (`isRecord`/`isCount` only from `lib/wire.ts`), `server/test/census-w7/pwa.test.ts` (no `setInterval` beside an `api.*` call: the tap wait is a bounded loop of `sleep`, refinement (t)), `pwa/test/docs-scans.test.ts` (M8.10: `run.ts` reaches the bridge only through `ReaderFrame.tsx`'s `lazyMountReader`; M8.21: `readerRenderJob` is a type import), `server/test/rings/pwa-rings.test.ts`.

**Interfaces:** Consumes Tasks 1 and 6-8 (the run's caps come from `shared/readerLab.ts`, never redeclared here). Produces `LAB_FIGURES`, `LAB_PAGES`, `hostileDoc(base)`; `LAB_TEXT`; `readLabRunView(body)`; `LAB_WATCHDOG_PROBE_MS`, `LAB_TAP_READ_EVERY_MS`, `LAB_STALL_BUDGET_MS`, `LabGapWindow`, `LAB_GAP_WINDOW`, `gapWindowEnd(window, settled, sleep)`, `LabDoor`, `LabDeps` (with `gapWindow`), `LabProgress`, `LabResult` (with `finalRead`), `LabFailure`, `runReaderLab(deps, progress)`, `defaultLabDeps({stage, signal})`, `labResultText(result, device)`; `api.readerLab.{open, read, close, probe}`.

**Decisions:** (1) `api.readerLab` is thin (the funnel, no parsing); the run's own door adapter turns answers into words: `open` → a nonce, `no-door` (404) or `refused` (any other refusal); `read` → a run, `unknown-run` (404) or `unreadable` (`readLabRunView` says no). A 401 still raises the login overlay through the funnel, and the run stops. (2) The first read happens before any frame, so an older door stops the run before anything is mounted. (3) Each step's frame or mount is removed in a `finally`, and the door run is closed in the run's own `finally`. (4) The busy step starts its frame-gap measure and its timer before it mounts the busy frame, so the spin is inside both. (5) Every reader mount is `profile: 'lab-draw'`, `docKey: null`, no images, so it stores nothing and loads nothing beyond its own text. (6) The hostile step is step 7 and the Mermaid mounts step 8: every arrival that decides a verdict is read by step 7, every read up to there fails the run on `unknown-run` or `unreadable`, and the final read (step 9) that finds the run gone or unreadable keeps the last view and says so in `finalRead` (the run's life is derived from the caps, so this is the slow phone's safety net, not the plan). (7) A timed mount's gap window ends where `gapWindowEnd` says: at its outcome under `'ready'` (library 1.0.0, whose `ready` waits for its figures), or `LAB_DRAW_SETTLE_MS` past a `ready` outcome under `'ready-and-settle'`; `elapsedMs` is still measured to the outcome. (8) The run's mounts and steps are `LAB_MOUNTS` and `LAB_STEPS`, the figures the door's life is summed from; the healthy and profile cases pin both.

- [ ] **Step 0: Base.** `test -f pwa/src/readerLab/verdicts.ts && git grep -qF "export type Api = ReturnType<typeof createApi>;" HEAD -- pwa/src/lib/api.ts && ! git grep -qF "readerLab" HEAD -- pwa/src/lib/api.ts && git grep -qF "export const lazyMountReader: ReaderDeps['mount'] = async (el, input) => {" HEAD -- pwa/src/docs/ReaderFrame.tsx && test ! -e pwa/src/readerLab/run.ts && echo T9-BASE-OK` — Expected: `T9-BASE-OK`. Confirm the claim on `pwa/src/lib/api.ts`.
- [ ] **Step 1: Write the failing test,** `pwa/test/reader-lab-run.test.ts`, with exactly this content:

```ts
// The reader lab's run (native Docs reader, the reader lab plan of 2026-11-03, Task 9; the rich-docs spec's row M10.13):
// `readerLab/run.ts` with a fake door, fake frames that report as a healthy engine would, and a fake reader mount. Every
// step mounts at most one frame and removes it before the next; the door run is closed however the run ends; a missing
// report is never a hold; a run lost after its counts are complete keeps them; the run's steps and mounts are the caps the
// door's run life is derived from.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_BATTERY_CHANNELS, LAB_DRAW_SETTLE_MS, LAB_MOUNTS, LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, LAB_STEPS,
  type LabProbeName, type LabProbeTally, type LabRunView,
} from '../../shared/readerLab';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { LAB_CHECKS, LAB_WALLS } from '../src/readerLab/checks';
import { LAB_PAGES } from '../src/readerLab/fixtures';
import {
  AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, COOKIE_SCRIPT, POPUP_SCRIPT, SELF_NAV_SCRIPT, STRAYS_SCRIPT,
} from '../src/readerLab/frameScripts';
import type { LabFrameSpec } from '../src/readerLab/frames';
import {
  LAB_GAP_WINDOW, LabFailure, gapWindowEnd, runReaderLab, type LabDeps, type LabGapWindow, type LabProgress,
} from '../src/readerLab/run';

afterEach(() => {
  document.body.replaceChildren();
});

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};
const AMBIENT = ['parent', 'origin', 'cookie', 'local', 'session', 'idb', 'caches'];

/** What a healthy engine's frame reports, by its script. */
function healthy(spec: LabFrameSpec): string[] {
  switch (spec.script) {
    case POPUP_SCRIPT: return ['popup-null', 'top-read-held', 'top-write-threw', 'popup-ran'];
    case AMBIENT_SCRIPT: return AMBIENT.map((k) => `ambient-${k}-held`);
    case COOKIE_SCRIPT: return ['cookie-fetch', 'cookie-xhr', 'cookie-beacon', 'cookie-image', 'cookie-ran'];
    case BATTERY_SCRIPT: return spec.config['canary'] === true ? ['csp-canary'] : LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe').map((c) => `ctl-${c}`);
    case SELF_NAV_SCRIPT: return ['self-nav-tried'];
    case BUSY_SCRIPT: return ['busy-start', 'busy-end'];
    case STRAYS_SCRIPT: return ['strays-sent'];
    default: return [];
  }
}

interface RigOptions {
  report?: (spec: LabFrameSpec) => string[];
  open?: 'no-door' | 'refused';
  read?: 'unreadable';
  /** The door forgets the run once this many reader mounts have started (a run whose life ran out mid-Mermaid). */
  loseAfterMounts?: number;
  gapWindow?: LabGapWindow;
  onFrame?: (spec: LabFrameSpec, rig: Rig) => void;
}
interface Rig {
  readonly deps: LabDeps;
  readonly door: { opened: number; closed: string[]; probes: number };
  readonly order: string[];
  readonly inputs: ReaderMountInput[];
  /** Every sleep the run asked for, in order. */
  readonly slept: number[];
  readonly stage: HTMLElement;
  readonly abort: AbortController;
  live(): number;
}

function rig(o: RigOptions = {}): Rig {
  const abort = new AbortController();
  const tallies = new Map<string, { hits: number; cookie: number }>();
  const hit = (n: string, cookie = false): void => {
    const t = tallies.get(n) ?? { hits: 0, cookie: 0 };
    t.hits += 1;
    if (cookie) t.cookie += 1;
    tallies.set(n, t);
  };
  const view = (): LabRunView => ({
    openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false,
    probes: Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...ZERO, hits: tallies.get(n)?.hits ?? 0, cookie: tallies.get(n)?.cookie ?? 0 }])) as Record<LabProbeName, LabProbeTally>,
  });
  const door = { opened: 0, closed: [] as string[], probes: 0 };
  const order: string[] = [];
  const inputs: ReaderMountInput[] = [];
  const slept: number[] = [];
  const stage = document.createElement('div');
  document.body.append(stage);
  let live = 0;
  let clock = 0;
  const names = new Map<string, string>([[POPUP_SCRIPT, 'popup'], [AMBIENT_SCRIPT, 'ambient'], [COOKIE_SCRIPT, 'cookie'],
    [BATTERY_SCRIPT, 'battery'], [SELF_NAV_SCRIPT, 'selfNav'], [BUSY_SCRIPT, 'busy'], [STRAYS_SCRIPT, 'strays']]);
  const r: Rig = {
    door, order, inputs, slept, stage, abort, live: () => live,
    deps: {
      door: {
        open: async () => { door.opened += 1; return o.open ?? { nonce: NONCE }; },
        read: async () => (o.loseAfterMounts !== undefined && inputs.length > o.loseAfterMounts ? 'unknown-run' : o.read ?? view()),
        close: async (nonce) => { door.closed.push(nonce); },
        probe: async () => { door.probes += 1; order.push('probe'); hit('cookie-console', true); },
      },
      origin: 'https://box.example',
      stage,
      mountFrame: (s, spec) => {
        expect(live, 'a frame was still mounted when the next one mounted').toBe(0);
        live += 1;
        order.push(names.get(spec.script) ?? 'unknown');
        const el = document.createElement('i');
        s.append(el);
        for (const n of (o.report ?? healthy)(spec)) hit(n);
        o.onFrame?.(spec, r);
        let gone = false;
        return {
          loads: () => (spec.script === SELF_NAV_SCRIPT ? 2 : 1),
          remove: () => { if (!gone) { gone = true; live -= 1; el.remove(); } },
        };
      },
      render: async () => ({
        kind: 'rendered', result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } },
        mermaid: { fences: 1, largestBytes: 10, totalBytes: 10, largestChars: 10, totalChars: 10 }, images: [],
      }) as unknown as ReaderRenderOutcome,
      mountReader: async (_el, input) => {
        inputs.push(input);
        queueMicrotask(() => input.onReady());
        return { destroy: vi.fn(), setPrefs: vi.fn() } satisfies ReaderMount;
      },
      frame: () => Promise.resolve((clock += 16)),
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        return ms >= LAB_MOUNT_WAIT_MS ? new Promise<void>(() => undefined) : ((clock += ms), Promise.resolve());
      },
      address: () => 'https://box.example/settings/reader-lab',
      gapWindow: o.gapWindow ?? 'ready',
      signal: abort.signal,
    },
  };
  return r;
}

describe('the reader lab run (reader lab plan, Task 9)', () => {
  it('a healthy engine: every line holds but the busy frame\'s fact, every step reports, and the door run is closed at the end', async () => {
    const r = rig();
    const steps: number[] = [];
    const result = await runReaderLab(r.deps, (p: LabProgress) => { steps.push(p.step); });
    for (const k of LAB_CHECKS.filter((c) => c !== 'busy-frame')) {
      expect(result.outcomes[k].verdict, `${k}: ${result.outcomes[k].detail}`).toBe('holds');
    }
    expect(result.outcomes['busy-frame'].verdict).toBe('own-thread');
    expect(result.finalRead).toBe('read');
    expect([...new Set(steps)].sort((a, b) => a - b)).toEqual(Array.from({ length: LAB_STEPS }, (_, i) => i + 1));
    expect(r.door.closed).toEqual([NONCE]);
    expect(result.local.mounts.map((m) => m.label)).toEqual(['none', 'trivial', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'all']);
  });

  it('the steps run in order, one frame at a time, and leave the stage empty', async () => {
    const r = rig();
    await runReaderLab(r.deps, () => undefined);
    expect(r.order).toEqual(['popup', 'ambient', 'probe', 'cookie', 'battery', 'battery', 'selfNav', 'busy', 'strays']);
    expect(r.live()).toBe(0);
    expect(r.stage.childElementCount).toBe(0);
  });

  it('every reader mount is the lab profile: lab-draw, no doc key, no images; there are as many as the caps count', async () => {
    const r = rig();
    await runReaderLab(r.deps, () => undefined);
    expect(LAB_PAGES.length + 1, 'the pages and the hostile page').toBe(LAB_MOUNTS);
    expect(r.inputs).toHaveLength(LAB_MOUNTS);
    for (const input of r.inputs) {
      expect(input.profile).toBe('lab-draw');
      expect(input.docKey).toBeNull();
      expect(input.document.images).toEqual({});
    }
  });

  it('the tap wait ends at the tap: one read while it waits, not thirty', async () => {
    let reads = 0;
    let readsAtAmbient = -1;
    const r = rig({ onFrame: (spec) => { if (spec.script === AMBIENT_SCRIPT) readsAtAmbient = reads; } });
    const inner = r.deps.door;
    await runReaderLab({ ...r.deps, door: { ...inner, read: (n) => { reads += 1; return inner.read(n); } } }, () => undefined);
    expect(readsAtAmbient, 'the first read, one read in the wait, and the step\'s own read').toBe(3);
  });

  it('a frame that never reports reads not measured, never holds (M10.13)', async () => {
    const r = rig({ report: (spec) => (spec.script === AMBIENT_SCRIPT ? [] : healthy(spec)) });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['opaque-origin'].verdict).toBe('not-measured');
    expect(result.outcomes['no-ambient-state'].verdict).toBe('not-measured');
  });

  it('no tap within the wait reads not measured for popups, and the run goes on to the end', async () => {
    const r = rig({ report: (spec) => (spec.script === POPUP_SCRIPT ? [] : healthy(spec)) });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['no-popup-top-nav']).toEqual({ verdict: 'not-measured', detail: 'the button in the frame was not tapped' });
    expect(result.outcomes['no-cookie'].verdict).toBe('holds');
  });

  it('a stray message that reached a host callback makes bridge-strays not hold', async () => {
    const r = rig({
      onFrame: (spec, rr) => {
        if (spec.script === STRAYS_SCRIPT) rr.inputs[rr.inputs.length - 1]!.onLink({ kind: 'fragment', id: 'x' });
      },
    });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.outcomes['bridge-strays']).toEqual({ verdict: 'does-not-hold', detail: '1 effects' });
  });

  it('a run lost after the hostile step keeps every count it read: the walls still decide, and the result says the final read failed', async () => {
    const r = rig({ loseAfterMounts: 1 });
    const result = await runReaderLab(r.deps, () => undefined);
    for (const k of LAB_WALLS) expect(result.outcomes[k].verdict, `${k}: ${result.outcomes[k].detail}`).toBe('holds');
    expect(result.finalRead).toBe('unknown-run');
    expect(result.run).not.toBeNull();
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('the gap window ends at ready under the library this build pins, and a settle past ready once the library draws after it', async () => {
    expect(LAB_GAP_WINDOW).toBe('ready');
    const slept: number[] = [];
    const sleep = async (ms: number): Promise<void> => { slept.push(ms); };
    await gapWindowEnd('ready', Promise.resolve('ready'), sleep);
    await gapWindowEnd('ready-and-settle', Promise.resolve('fallback'), sleep);
    expect(slept).toEqual([]);
    await gapWindowEnd('ready-and-settle', Promise.resolve('ready'), sleep);
    expect(slept).toEqual([LAB_DRAW_SETTLE_MS]);
    const after = rig({ gapWindow: 'ready-and-settle' });
    await runReaderLab(after.deps, () => undefined);
    expect(after.slept.filter((ms) => ms === LAB_DRAW_SETTLE_MS), 'one settle per timed page').toHaveLength(LAB_PAGES.length);
    const now = rig();
    await runReaderLab(now.deps, () => undefined);
    expect(now.slept.filter((ms) => ms === LAB_DRAW_SETTLE_MS)).toEqual([]);
  });

  it('no door: the run fails with that word, mounts nothing and has nothing to close', async () => {
    const r = rig({ open: 'no-door' });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toSatisfy((e: unknown) => e instanceof LabFailure && e.word === 'no-door');
    expect([r.order, r.door.closed]).toEqual([[], []]);
  });

  it('an older door: the first read fails the run with unreadable before any frame, and the run is closed', async () => {
    const r = rig({ read: 'unreadable' });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toSatisfy((e: unknown) => e instanceof LabFailure && e.word === 'unreadable');
    expect(r.order).toEqual([]);
    expect(r.door.closed).toEqual([NONCE]);
  });

  it('Stop: an abort mid-run removes what the step mounted and closes the door run', async () => {
    const r = rig({ onFrame: (spec, rr) => { if (spec.script === BUSY_SCRIPT) rr.abort.abort(); } });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toThrow('stopped');
    expect(r.live()).toBe(0);
    expect(r.stage.childElementCount).toBe(0);
    expect(r.door.closed).toEqual([NONCE]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-run.test.ts )` — Expected (prediction): the file fails to load (`../src/readerLab/run`).
- [ ] **Step 3: Write `pwa/src/readerLab/fixtures.ts`** with exactly this content:

```ts
// The reader lab's pages (native Docs reader, the reader lab plan of 2026-11-03, Task 9, refinement (o)). Ring L1: text.
// The six figures have the node and edge counts of the six figures of a real six-figure design in this repository (the
// path-identity design), relabelled with neutral words, so every phone draws the same pages. `hostileDoc` rebuilds the
// desktop leg's two hostile figures with this run's door URLs as their targets.

const fence = (body: string): string => '```mermaid\n' + body + '\n```\n\n';
const lines = (...l: string[]): string => l.join('\n');

/** The six figures, in order. */
export const LAB_FIGURES: readonly string[] = [
  fence(lines('flowchart LR',
    '  A["Source one<br/>any name"] --> S["Composer<br/>id, then three flags"]',
    '  B["Route parameter"] --> S',
    '  C["Run rows<br/>a list read"] --> S',
    '  S --> V1["Release, archive,<br/>restore, stop<br/>bind an id, no token"]',
    '  S --> V2["Reclaim, expire<br/>bind an id and a token,<br/>then a tree path"]',
    '  S --> V3["Collect<br/>binds an id and a token,<br/>then a leaf"]',
    '  W["A switch<br/>marker or setting"] -.-> V3',
    '  V2 --> T1["Remove the tree<br/>the path reaches"]',
    '  V2 --> T2["Remove the leaf<br/>and its clips"]',
    '  V3 --> T2')),
  fence(lines('flowchart LR',
    '  A["Name with a suffix"] --> B["Server: verb, flags<br/>surface, actor"]',
    '  B --> C["Loop: one flag eats the next"]',
    '  C --> D["A word left over<br/>bound as the id"]',
    '  D --> E{"Row with that id exists?"}',
    '  E -- "no, today" --> F["Refused: unknown id"]',
    '  E -- "if ever yes" --> G["Acts on the wrong row"]')),
  fence(lines('flowchart TD',
    '  A["The tail proves it absent"] --> B{"Witness parses?"}',
    '  B -- "no" --> K1["Keep the witness<br/>unmeasured"]',
    '  B -- "yes" --> C{"Device equals<br/>the witness device?"}',
    '  C -- "no or unreadable" --> K2["Keep the witness<br/>unmeasured: device"]',
    '  C -- "yes" --> D{"A slot stands,<br/>or the list is unreadable?"}',
    '  D -- "yes" --> K3["Keep the witness, warn"]',
    '  D -- "no" --> E["Compare and drop<br/>exactly that generation"]',
    '  E -- "same generation dropped" --> F["Witness gone"]',
    '  E -- "changed or unmeasured" --> K4["Restore or keep<br/>the witness"]')),
  fence(lines('flowchart TD',
    '  L["Ladder rows<br/>ancestry, identity,<br/>mount export, link walk,<br/>one batched call with a deadline"] --> W["Bounded wait after a stop<br/>a refusal-only probe"]',
    '  W --> T["Tombstone and row agree"]',
    '  T --> O["Ownership, asked once<br/>main checkout refused;<br/>record the identity"]',
    '  O --> P["Settle pin"]',
    '  P --> N["Nested children, innermost first"]',
    '  N --> NS["Each standing nested tree<br/>mount check before the keep<br/>and again before removal<br/>identity, fresh rows,<br/>mount map and probe at both"]',
    '  NS --> NG["Remove that nested tree"]',
    '  NG --> S4["Step four: link, directory, keep<br/>the same rechecks"]',
    '  S4 --> G["Remove the child tree"]',
    '  G --> S6["Step six: the leaves<br/>device and slot before a drop;<br/>the mount question"]')),
  fence(lines('flowchart TD',
    '  A["Lane job: the final listing returns<br/>after the job\'s last await"] --> B{"Listing ok, epoch unchanged,<br/>and no pause file?"}',
    '  B -- "no" --> S1["Stopped: compose nothing"]',
    '  B -- "yes" --> C{"Both capabilities<br/>present?"}',
    '  C -- "no" --> S2["Not running: compose nothing"]',
    '  C -- "yes" --> D{"Setting row and journal<br/>measurable?"}',
    '  D -- "no" --> S3["Safety-stopped: compose nothing"]',
    '  D -- "yes" --> E{"Exact seed with no journal,<br/>or the generations agree?"}',
    '  E -- "no" --> S3',
    '  E -- "yes" --> F{"Marker stands and<br/>its latch is unset?"}',
    '  F -- "yes" --> LV1["Live: armed by the marker"]',
    '  F -- "no" --> G{"Choice is live,<br/>the node is known,<br/>and the stored node matches?"}',
    '  G -- "yes" --> LV2["Live: armed in a setting"]',
    '  G -- "no" --> SH["Shadowed: record only"]')),
  fence(lines('flowchart LR',
    '  W0["Wave zero, docs"] --> W3',
    '  SW["Switch<br/>after its rulings"] --> DONE["Deployed"]',
    '  W1a["Wave one, server gate<br/>after two reviews"] --> DONE',
    '  M["An earlier change merges"] --> W1b["Wave one, ids"]',
    '  W1b --> W2["Wave two, absences and mounts"]',
    '  W2 --> W3["Wave three, identity"]',
    '  W3 --> W4["Wave four, optional"]')),
];

const prose = (title: string): string =>
  `# ${title}\n\nA page the reader lab draws on this device, so the console's stall while it draws can be timed.\n\n`;

/** The pages the lab mounts one after another: none, a trivial figure, each figure alone, then all six. */
export const LAB_PAGES: readonly { readonly label: string; readonly text: string }[] = [
  { label: 'none', text: `${prose('No figures')}Only prose, so this mount pays for the reader and nothing else.\n` },
  { label: 'trivial', text: prose('One trivial figure') + fence(lines('flowchart LR', '  A[Start] --> B[End]')) },
  ...LAB_FIGURES.map((f, i) => ({ label: `f${i + 1}`, text: prose(`Figure ${i + 1}`) + f })),
  { label: 'all', text: prose('All six figures') + LAB_FIGURES.join('') },
];

/** Two hostile figures (the desktop leg's): a directive that tries to restyle the frame, and one that loosens Mermaid's
 *  security level to load an image and bind a click, both aimed at this run's door through `base`. */
export function hostileDoc(base: string): string {
  return '# Hostile figures\n\nTwo figures whose directives try to restyle the frame and to reach the door.\n\n'
    + fence(lines(
      '%%{init: {"themeCSS": ".node rect { fill: magenta !important; } /* reader-lab-hostile */", "theme": "base"}}%%',
      'flowchart LR', '  H1[Hostile] --> H2[Node]'))
    + fence(lines(
      '%%{init: {"securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%',
      'flowchart LR', `  L1["<img src='${base}hostile-img'>"] --> L2[Link]`, `  click L2 "${base}hostile-click"`));
}
```

- [ ] **Step 4: Write `pwa/src/readerLab/labText.ts`** with exactly this content:

```ts
// The reader lab page's words (native Docs reader, the reader lab plan of 2026-11-03, Task 9). Ring L1: strings. The
// verdict words are the result block's own (`result.ts`), so the page and the block never say two things.
import type { LabCheckId } from './checks';
import { LAB_VERDICT_WORDS } from './result';

export const LAB_TEXT = {
  title: 'Reader lab',
  intro: "Checks the Docs reader's safety walls and responsiveness on this device, once. Keep the screen on and the app in "
    + 'front until it says Done, and tap the button in the box when it asks. Then select the result and copy it, or take a '
    + 'screenshot, and send it on. It saves and sends nothing itself.',
  journal: "On a server with sign-in on, each run leaves one or two lines in the server's journal saying it refused a "
    + 'websocket upgrade from a foreign origin. They are this lab\'s own frames, and expected.',
  start: 'Start',
  stop: 'Stop',
  starting: 'Starting…',
  stopping: 'Stopping…',
  done: 'Done.',
  result: 'Result',
  select: 'Select result',
  stage: "The lab's frames run here",
  wallsGroup: 'Walls (E18)',
  responsiveGroup: 'Stays responsive (E17)',
  notRun: 'not run',
  waiting: 'waiting',
  running: 'running…',
  tapLabel: 'Tap here',
  steps: {
    popup: 'Tap the button in the box below.',
    ambient: 'Checking the opaque origin and stored state…',
    cookie: 'Checking that frame requests carry no cookie…',
    battery: 'Running the 27-channel battery…',
    selfNav: 'Checking that a frame cannot navigate itself…',
    busy: 'Running a busy frame…',
    mermaid: 'Drawing Mermaid:',
    strays: 'Sending stray messages to the reader…',
    done: 'Reading the counts…',
  },
  verdict: LAB_VERDICT_WORDS,
  checks: {
    'opaque-origin': 'Opaque origin',
    'no-ambient-state': 'No ambient state',
    'no-cookie': 'No cookie on frame requests',
    'csp-27': 'Frame CSP, 27 channels',
    'no-popup-top-nav': 'No popup, no top navigation',
    'no-self-navigate': 'Frame cannot navigate itself',
    'bridge-strays': 'Bridge ignores stray messages',
    'self-nav-teardown': 'Teardown signal on a blocked navigation',
    'busy-frame': 'Busy frame',
    mermaid: 'Heavy Mermaid page',
  } satisfies Record<LabCheckId, string>,
  failed: {
    'no-door': 'This server has no reader lab door yet. Update it, then try again.',
    refused: 'The server refused to open a lab run. Sign in again, then try again.',
    'unknown-run': 'The lab run was lost before its counts were read: it expired, another replaced it, or the server '
      + 'restarted. Start again.',
    unreadable: "This server's lab door is older than this page. Update the server, then try again.",
    other: 'The lab stopped: ',
  },
} as const;
```

- [ ] **Step 5: Write `pwa/src/readerLab/wire.ts`** with exactly this content:

```ts
// The reader lab door's read, checked (native Docs reader, the reader lab plan of 2026-11-03, Task 9, refinement (s)).
// Ring L1: pure, over `lib/wire.ts`'s guards. A read is a run only when it names every probe of this page's vocabulary,
// with a count in every class; anything less is an older door, and the run stops with "update the server".
import {
  LAB_ORIGIN_CLASSES, LAB_PROBE_NAMES, LAB_SITE_CLASSES,
  type LabOriginClass, type LabProbeName, type LabProbeTally, type LabRunView, type LabSiteClass,
} from '../../../shared/readerLab';
import { isCount, isRecord } from '../lib/wire';

/** A count for each of `keys` in `v`, or null when one is missing or not a count. */
function countsOf<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isRecord(v)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = v[k];
    if (!isCount(n)) return null;
    out[k] = n;
  }
  return out;
}

/** The run in a `GET /api/reader-lab/runs/:nonce` answer, or null. Null has one meaning: the body is not a whole run of
 *  this page's vocabulary. */
export function readLabRunView(body: unknown): LabRunView | null {
  if (!isRecord(body) || body['ok'] !== true) return null;
  const run = body['run'];
  if (!isRecord(run)) return null;
  const { openedAt, expiresAt, counted, ignored, saturated, probes: given } = run;
  if (!isCount(openedAt) || !isCount(expiresAt) || !isCount(counted) || !isCount(ignored) || typeof saturated !== 'boolean'
    || !isRecord(given)) return null;
  const probes = {} as Record<LabProbeName, LabProbeTally>;
  for (const n of LAB_PROBE_NAMES) {
    const t = Object.hasOwn(given, n) ? given[n] : undefined;
    if (!isRecord(t)) return null;
    const { hits, cookie, upgrade } = t;
    const site = countsOf<LabSiteClass>(t['site'], LAB_SITE_CLASSES);
    const origin = countsOf<LabOriginClass>(t['origin'], LAB_ORIGIN_CLASSES);
    if (!isCount(hits) || !isCount(cookie) || !isCount(upgrade) || site === null || origin === null) return null;
    probes[n] = { hits, cookie, upgrade, site, origin };
  }
  return { openedAt, expiresAt, counted, ignored, saturated, probes };
}
```

- [ ] **Step 6: Write `pwa/src/readerLab/run.ts`** with exactly this content:

```ts
// The reader lab's run (native Docs reader, the reader lab plan of 2026-11-03, Task 9; the reader lab design, sections 3
// and 4). Ring L4: it opens a door run, mounts each lab frame and each timed reader in turn into the page's stage, waits,
// reads the door's counts, and answers the result; the decisions are `verdicts.ts`'s. Every frame and mount a step starts
// is removed when the step ends, however it ends, and the door run is closed when the run ends, however it ends. Every
// arrival that decides a verdict is read by step 7, before the Mermaid mounts, so a final read that finds the run gone
// keeps the last view instead of losing the run. It waits by the lab's own caps (`shared/readerLab.ts`), from which the
// door derives a run's life. The only requests it makes or causes go to this console's own door. `defaultLabDeps` builds
// the real dependencies; the page hands it its stage and its abort signal.
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE } from '../../../shared/docs';
import {
  LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_MOUNT_WAIT_MS, LAB_SETTLE_MS, LAB_STEPS, LAB_TAP_WAIT_MS, isLabNonce,
  readerLabProbeBase, type LabRunView,
} from '../../../shared/readerLab';
import { lazyMountReader } from '../docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../docs/reader/bridge';
import { READER_LIBRARY_BUILD } from '../docs/reader/labPolicy';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiError';
import { longestFrameGap } from '../lib/frameGap';
import { utf8ByteLength } from '../lib/markdownGuard';
import { DOCS_PARSE_BUDGET_MS } from '../lib/markdownLimits';
import { docsRunner } from '../lib/markdownRunner';
import type { ReaderRenderOutcome } from '../lib/readerRenderJob';
import { isRecord } from '../lib/wire';
import type { LabCheckId, LabOutcome } from './checks';
import type { LabDevice } from './device';
import { LAB_PAGES, hostileDoc } from './fixtures';
import {
  AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, COOKIE_SCRIPT, POPUP_SCRIPT, SELF_NAV_SCRIPT, STRAYS_SCRIPT,
} from './frameScripts';
import { mountLabFrame, type LabFrame, type LabFrameSpec } from './frames';
import { LAB_TEXT } from './labText';
import { formatLabResult, type LabFinalRead } from './result';
import { labVerdicts, type LabLocal, type LabMount } from './verdicts';
import { readLabRunView } from './wire';

/** The timer whose lateness stands for the reader's watchdog while the busy frame spins. */
export const LAB_WATCHDOG_PROBE_MS = 500;
/** How often the popup step reads the door while it waits for the operator's tap (`LAB_TAP_WAIT_MS`). */
export const LAB_TAP_READ_EVERY_MS = 1000;
/** The stall the Mermaid line is held to (question Q2). The busy frame is a fact and has no budget. */
export const LAB_STALL_BUDGET_MS = 200;

/** Where a timed mount's frame-gap window ends (the reader lab design, section 8). `ready`: at the mount's outcome, which
 *  holds the draw while the library's `ready` waits for its figures (library 1.0.0). `ready-and-settle`: LAB_DRAW_SETTLE_MS
 *  past `ready`, for a library that draws after `ready`, so the draw stays inside the window. */
export type LabGapWindow = 'ready' | 'ready-and-settle';
/** The window for the library this build pins. The library change that draws after `ready` flips it, in that change. */
export const LAB_GAP_WINDOW: LabGapWindow = 'ready';

/** The end of a timed mount's gap window: its outcome, or a settle past a `ready` outcome. */
export function gapWindowEnd(w: LabGapWindow, settled: Promise<LabMount['outcome']>, sleep: (ms: number) => Promise<void>): Promise<unknown> {
  return w === 'ready' ? settled : settled.then((o) => (o === 'ready' ? sleep(LAB_DRAW_SETTLE_MS) : undefined));
}

/** The door as the run sees it: a word for every server answer; a rejection only for a defect or a lost connection. */
export interface LabDoor {
  open(): Promise<{ readonly nonce: string } | 'no-door' | 'refused'>;
  read(nonce: string): Promise<LabRunView | 'unknown-run' | 'unreadable'>;
  close(nonce: string): Promise<void>;
  /** The console's own request to the probe, with its session: the cookie check's control. */
  probe(nonce: string): Promise<void>;
}

export interface LabDeps {
  readonly door: LabDoor;
  /** The console's own origin. */
  readonly origin: string;
  /** Where frames and mounts go: laid out and visible. */
  readonly stage: HTMLElement;
  readonly mountFrame: (stage: HTMLElement, spec: LabFrameSpec) => LabFrame;
  readonly render: (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome>;
  readonly mountReader: (el: HTMLElement, input: ReaderMountInput) => Promise<ReaderMount>;
  /** The next animation frame's time. */
  readonly frame: () => Promise<number>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** The console's address, read before and after the stray messages. */
  readonly address: () => string;
  /** Where each timed mount's gap window ends (`LAB_GAP_WINDOW` in the real dependencies). */
  readonly gapWindow: LabGapWindow;
  readonly signal: AbortSignal;
}

/** Where the run is, for the page. `outcomes` holds every check's outcome on the counts so far; the page shows a check's
 *  only once the step that decides it has passed (`checks.ts#LAB_CHECK_STEP`). */
export interface LabProgress {
  readonly step: number;
  readonly of: number;
  readonly line: string;
  readonly tap: boolean;
  readonly outcomes: Readonly<Partial<Record<LabCheckId, LabOutcome>>>;
}

export interface LabResult {
  readonly outcomes: Readonly<Record<LabCheckId, LabOutcome>>;
  readonly local: LabLocal;
  /** The last view of the door that was read; null: no read of the door happened. */
  readonly run: LabRunView | null;
  /** How the final read went: a run gone by then keeps the view step 7 read, which holds every verdict's counts. */
  readonly finalRead: LabFinalRead;
}

/** A word the run stops with, which the page says in one sentence. */
export type LabFailureWord = 'no-door' | 'refused' | 'unknown-run' | 'unreadable';
export class LabFailure extends Error {
  readonly word: LabFailureWord;
  constructor(word: LabFailureWord) {
    super(word);
    this.word = word;
  }
}

const noop = (): void => undefined;

/** A timed mount's input: the lab profile, no doc key, no images. */
function mountInput(out: Extract<ReaderRenderOutcome, { kind: 'rendered' }>, bytes: number, cb: {
  readonly onReady: () => void; readonly onFallback: () => void;
  readonly onLink?: () => void; readonly onHash?: () => void; readonly copy?: () => void;
}): ReaderMountInput {
  return {
    document: { result: out.result, scan: { mermaid: out.mermaid }, images: {}, initialHash: null },
    bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' }, profile: 'lab-draw',
    onLink: cb.onLink ?? noop, onHash: cb.onHash ?? noop, copy: cb.copy ?? noop, onReady: cb.onReady, onFallback: cb.onFallback,
  };
}

/** A host element for one mount, at the end of the stage. */
function hostIn(stage: HTMLElement): HTMLElement {
  const host = document.createElement('div');
  host.className = 'reader-lab-mount';
  stage.append(host);
  return host;
}

/** One page mounted under the lab profile, timed from the mount's start to ready, fallback, the cap or a stop. */
async function timedMount(deps: LabDeps, label: string, text: string): Promise<LabMount> {
  const bytes = utf8ByteLength(text);
  const out = await deps.render(text, { budgetMs: DOCS_PARSE_BUDGET_MS(bytes), signal: deps.signal });
  if (out.kind !== 'rendered') return { label, outcome: 'not-rendered', longestGapMs: 0, elapsedMs: 0 };
  const host = hostIn(deps.stage);
  let settle: (o: LabMount['outcome']) => void = noop;
  const settled = new Promise<LabMount['outcome']>((resolve) => { settle = resolve; });
  const onAbort = (): void => settle('timeout');
  deps.signal.addEventListener('abort', onAbort, { once: true });
  void deps.sleep(LAB_MOUNT_WAIT_MS).then(() => settle('timeout'));
  const gap = longestFrameGap(deps.frame, gapWindowEnd(deps.gapWindow, settled, deps.sleep));
  const t0 = deps.now();
  let mount: ReaderMount | null = null;
  try {
    try {
      mount = await deps.mountReader(host, mountInput(out, bytes, { onReady: () => settle('ready'), onFallback: () => settle('fallback') }));
    } catch {
      settle('fallback');
    }
    const outcome = await settled;
    const elapsedMs = deps.now() - t0;
    return { label, outcome, longestGapMs: await gap, elapsedMs };
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    mount?.destroy();
    host.remove();
  }
}

/** The hostile page under the lab profile, and, once it is ready, the stray frame's messages: the host callbacks they
 *  reach are counted as effects, and so is a fallback after ready. */
async function hostileAndStrays(deps: LabDeps, base: string, read: () => Promise<void>): Promise<NonNullable<LabLocal['hostile']>> {
  const text = hostileDoc(base);
  const bytes = utf8ByteLength(text);
  const out = await deps.render(text, { budgetMs: DOCS_PARSE_BUDGET_MS(bytes), signal: deps.signal });
  if (out.kind !== 'rendered') return { ready: false, effects: 0, addressChanged: false };
  const host = hostIn(deps.stage);
  let effects = 0;
  let ready = false;
  let settle: (r: boolean) => void = noop;
  const settled = new Promise<boolean>((resolve) => { settle = resolve; });
  const onAbort = (): void => settle(false);
  deps.signal.addEventListener('abort', onAbort, { once: true });
  void deps.sleep(LAB_MOUNT_WAIT_MS).then(() => settle(false));
  const effect = (): void => { effects += 1; };
  let mount: ReaderMount | null = null;
  try {
    try {
      mount = await deps.mountReader(host, mountInput(out, bytes, {
        onReady: () => { ready = true; settle(true); },
        onFallback: () => { if (ready) effects += 1; settle(false); },
        onLink: effect, onHash: effect, copy: effect,
      }));
    } catch {
      return { ready: false, effects: 0, addressChanged: false };
    }
    if (!(await settled)) return { ready: false, effects, addressChanged: false };
    const before = deps.address();
    const strays = deps.mountFrame(deps.stage, { script: STRAYS_SCRIPT, config: { base } });
    try {
      await deps.sleep(LAB_SETTLE_MS);
    } finally {
      strays.remove();
    }
    await read();
    return { ready: true, effects, addressChanged: deps.address() !== before };
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    mount?.destroy();
    host.remove();
  }
}

/** The run: nine steps, then the verdicts. Rejects with a LabFailure for the door's words up to step 7, and with `stopped`
 *  on an abort. */
export async function runReaderLab(deps: LabDeps, progress: (p: LabProgress) => void): Promise<LabResult> {
  const stop = (): void => {
    if (deps.signal.aborted) throw new Error('stopped');
  };
  const opened = await deps.door.open();
  if (opened === 'no-door' || opened === 'refused') throw new LabFailure(opened);
  const nonce = opened.nonce;
  const base = `${deps.origin}${readerLabProbeBase(nonce)}`;
  const counts: { view: LabRunView | null } = { view: null };
  const local: { selfNavLoads: number | null; busy: LabLocal['busy']; mounts: LabMount[]; hostile: LabLocal['hostile'] } =
    { selfNavLoads: null, busy: null, mounts: [], hostile: null };
  let step = 0;
  const say = (line: string, tap = false): void => {
    progress({ step, of: LAB_STEPS, line, tap, outcomes: counts.view === null ? {} : labVerdicts(counts.view, local, LAB_STALL_BUDGET_MS) });
  };
  const read = async (): Promise<void> => {
    const r = await deps.door.read(nonce);
    if (r === 'unknown-run' || r === 'unreadable') throw new LabFailure(r);
    counts.view = r;
  };
  /** One frame for one step: mounted, given `ms` after `during`, read, and removed however the step ends. */
  const withFrame = async (spec: LabFrameSpec, ms: number, during?: () => Promise<void>): Promise<LabFrame> => {
    stop();
    const f = deps.mountFrame(deps.stage, spec);
    try {
      if (during !== undefined) await during();
      await deps.sleep(ms);
      stop();
      await read();
      return f;
    } finally {
      f.remove();
    }
  };
  try {
    // An older door fails here, before any frame (refinement (s)).
    await read();
    // 1. Popups and top navigation, after the operator's tap (refinements (m), (t)).
    step = 1;
    say(LAB_TEXT.steps.popup, true);
    await withFrame({ script: POPUP_SCRIPT, config: { base, label: LAB_TEXT.tapLabel } }, LAB_SETTLE_MS, async () => {
      const until = deps.now() + LAB_TAP_WAIT_MS;
      while (deps.now() < until) {
        stop();
        await deps.sleep(LAB_TAP_READ_EVERY_MS);
        await read();
        if ((counts.view?.probes['popup-ran'].hits ?? 0) > 0) return;
      }
    });
    // 2. The opaque origin and ambient state.
    step = 2;
    say(LAB_TEXT.steps.ambient);
    await withFrame({ script: AMBIENT_SCRIPT, config: { base } }, LAB_SETTLE_MS);
    // 3. No cookie on frame requests; the console's own request first, as the control.
    step = 3;
    say(LAB_TEXT.steps.cookie);
    stop();
    await deps.door.probe(nonce);
    await withFrame({ script: COOKIE_SCRIPT, config: { base, marker: DOCS_REQUEST_HEADER, markerValue: DOCS_REQUEST_HEADER_VALUE } }, LAB_SETTLE_MS);
    // 4. The battery: the control frame with no policy, then the wall frame under the library's.
    step = 4;
    say(LAB_TEXT.steps.battery);
    await withFrame({ script: BATTERY_SCRIPT, config: { base, prefix: 'ctl-', canary: false } }, LAB_SETTLE_MS);
    await withFrame({ script: BATTERY_SCRIPT, config: { base, prefix: 'csp-', canary: true }, wall: { canary: `${base}csp-canary` } }, LAB_SETTLE_MS);
    // 5. A frame navigating itself.
    step = 5;
    say(LAB_TEXT.steps.selfNav);
    local.selfNavLoads = (await withFrame({ script: SELF_NAV_SCRIPT, config: { base } }, LAB_SETTLE_MS)).loads();
    // 6. A busy frame: the frame gaps and a timer, both started before it mounts.
    step = 6;
    say(LAB_TEXT.steps.busy);
    const spinOver = deps.sleep(LAB_BUSY_SPIN_MS + LAB_SETTLE_MS);
    const gap = longestFrameGap(deps.frame, spinOver);
    const t0 = deps.now();
    const late = deps.sleep(LAB_WATCHDOG_PROBE_MS).then(() => Math.max(0, deps.now() - t0 - LAB_WATCHDOG_PROBE_MS));
    await withFrame({ script: BUSY_SCRIPT, config: { base, spinMs: LAB_BUSY_SPIN_MS } }, 0, () => spinOver);
    local.busy = { longestGapMs: await gap, timerLateMs: await late, spinMs: LAB_BUSY_SPIN_MS };
    // 7. The real library on hostile figures, and stray messages while it is up: the last step whose arrivals decide a
    // verdict, so its read is the last one that must succeed (the reader lab design, section 4.4).
    step = 7;
    stop();
    say(LAB_TEXT.steps.strays);
    local.hostile = await hostileAndStrays(deps, base, read);
    // 8. Mermaid drawn on open, one page at a time. Nothing here sends a probe.
    step = 8;
    for (const page of LAB_PAGES) {
      stop();
      say(`${LAB_TEXT.steps.mermaid} ${page.label}`);
      local.mounts.push(await timedMount(deps, page.label, page.text));
    }
    // 9. The final counts, for a late arrival. A run that is gone by now (its life spent on a slow phone's mounts, or a
    // restart) keeps the view step 7 read, and the result says so.
    step = 9;
    stop();
    say(LAB_TEXT.steps.done);
    const last = await deps.door.read(nonce);
    if (last !== 'unknown-run' && last !== 'unreadable') counts.view = last;
    const finalRead: LabFinalRead = typeof last === 'string' ? last : 'read';
    return { outcomes: labVerdicts(counts.view, local, LAB_STALL_BUDGET_MS), local, run: counts.view, finalRead };
  } finally {
    await deps.door.close(nonce).catch(noop);
  }
}

/** The door through the funnel. */
const apiDoor: LabDoor = {
  async open() {
    try {
      const a = await api.readerLab.open();
      return isRecord(a) && a['ok'] === true && typeof a['nonce'] === 'string' && isLabNonce(a['nonce']) ? { nonce: a['nonce'] } : 'refused';
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return 'no-door';
      if (e instanceof ApiError) return 'refused';
      throw e;
    }
  },
  async read(nonce) {
    try {
      return readLabRunView(await api.readerLab.read(nonce)) ?? 'unreadable';
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return 'unknown-run';
      throw e;
    }
  },
  close: (nonce) => api.readerLab.close(nonce),
  probe: (nonce) => api.readerLab.probe(nonce),
};

/** A wall frame's script nonce: sixteen random bytes as base64. */
function scriptNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, '');
}

/** The real dependencies. */
export function defaultLabDeps(p: { readonly stage: HTMLElement; readonly signal: AbortSignal }): LabDeps {
  return {
    door: apiDoor,
    origin: location.origin,
    stage: p.stage,
    mountFrame: (stage, spec) => mountLabFrame(stage, spec, scriptNonce),
    render: (src, o) => docsRunner.render(src, o),
    mountReader: lazyMountReader,
    frame: () => new Promise((resolve) => { requestAnimationFrame(resolve); }),
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }),
    address: () => location.href,
    gapWindow: LAB_GAP_WINDOW,
    signal: p.signal,
  };
}

/** The result block for this run on this device, with the library build it ran against. */
export function labResultText(r: LabResult, device: LabDevice): string {
  return formatLabResult(device, READER_LIBRARY_BUILD, r.outcomes, r.local, r.run, LAB_STALL_BUDGET_MS, r.finalRead);
}
```

- [ ] **Step 7: `api.readerLab`.** In `pwa/src/lib/api.ts`:
  Find: `import { TOKEN_ROTATE_PATH } from '../../../shared/box-token';`
  Replace:
```ts
import { TOKEN_ROTATE_PATH } from '../../../shared/box-token';
import { READER_LAB_RUNS_PATH, readerLabClosePath, readerLabProbePath, readerLabRunPath } from '../../../shared/readerLab';
```
  Find:
```ts
    })(),
  };
}

export type Api = ReturnType<typeof createApi>;
```
  Replace:
```ts
    })(),
    /**
     * The reader lab's door (the reader lab plan of 2026-11-03, Task 9; the reader lab design, section 4). Through
     * `request`, so a 401 raises the one login overlay and every other refusal rejects with its `ApiError`; the lab's run
     * turns the answers into its words (`readerLab/run.ts`). `open` and `read` resolve the parsed body unchecked, which
     * `readerLab/wire.ts` checks; `probe` is the console's own request to the probe, with its session, the cookie
     * check's control.
     */
    readerLab: {
      open: (): Promise<unknown> => postJson<unknown>(READER_LAB_RUNS_PATH),
      read: (nonce: string): Promise<unknown> => getJson<unknown>(readerLabRunPath(nonce)),
      close: (nonce: string): Promise<void> => post(readerLabClosePath(nonce)),
      probe: async (nonce: string): Promise<void> => {
        await request(readerLabProbePath(nonce, 'cookie-console'));
      },
    },
  };
}

export type Api = ReturnType<typeof createApi>;
```
- [ ] **Step 8: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-run.test.ts )` — Expected (prediction): `Tests  12 passed (12)`. `TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/api.test.ts )` and, after `git fetch -q origin main`, `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-one-owner.test.ts test/census-w7/pwa.test.ts test/rings/pwa-rings.test.ts test/rings/totality.test.ts )`, through `ccrc test` — green (`api.test.ts` only if it exists at BASE; it is a guard, not edited).
- [ ] **Step 9: Commit.** `git add pwa/src/readerLab/fixtures.ts pwa/src/readerLab/labText.ts pwa/src/readerLab/wire.ts pwa/src/readerLab/run.ts pwa/test/reader-lab-run.test.ts pwa/src/lib/api.ts` (expect 6), message `pwa: the reader lab's run: one frame per step, the door read once a step, everything removed (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, file `src/readerLab/run.ts`, tests `test/reader-lab-run.test.ts`):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| RLB-T9-M1 | (l) | `f.remove();` → removed | 10 failed — `'the steps run in order, one frame at a time …'`, `'a healthy engine …'`, and every case after the first frame (the next mount finds a frame still mounted) |
| RLB-T9-M2 | (s) | `await deps.door.close(nonce).catch(noop);` → removed | 4 failed — `'a healthy engine …'`, `'a run lost after the hostile step …'`, `'an older door …'`, `'Stop …'` |
| RLB-T9-M3 | (k) M10.15 | `bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' }, profile: 'lab-draw',` → `bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' },` | 1 failed — `'every reader mount is the lab profile …'` |
| RLB-T9-M4 | (t) | `if ((counts.view?.probes['popup-ran'].hits ?? 0) > 0) return;` → removed | 1 failed — `'the tap wait ends at the tap: one read while it waits, not thirty …'` |
| RLB-T9-M5 | (s) | `// An older door fails here, before any frame (refinement (s)).\n    await read();` → `// An older door fails here, before any frame (refinement (s)).` | 2 failed — `'an older door …'`, `'the tap wait ends at the tap …'` |
| RLB-T9-M6 | (s) M10.18 | `if (last !== 'unknown-run' && last !== 'unreadable') counts.view = last;` → `if (last === 'unknown-run' \|\| last === 'unreadable') throw new LabFailure(last); else counts.view = last;` | 1 failed — `'a run lost after the hostile step keeps every count it read …'` |
| RLB-T9-M7 | (v) | `const gap = longestFrameGap(deps.frame, gapWindowEnd(deps.gapWindow, settled, deps.sleep));` → `const gap = longestFrameGap(deps.frame, settled);` | 1 failed — `'the gap window ends at ready under the library this build pins …'` |
| RLB-T9-M8 | (v) | `return w === 'ready' ? settled : settled.then((o) => (o === 'ready' ? sleep(LAB_DRAW_SETTLE_MS) : undefined));` → `return settled;` | 1 failed — `'the gap window ends at ready under the library this build pins …'` |

```json
[
  {"id": "RLB-T9-M1", "spec": "(l)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "f.remove();", "new": "", "tests": ["test/reader-lab-run.test.ts"], "red": "10 failed: the steps run in order, one frame at a time; a healthy engine; and every case after the first frame (the next mount finds a frame still mounted)"},
  {"id": "RLB-T9-M2", "spec": "(s)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "await deps.door.close(nonce).catch(noop);", "new": "", "tests": ["test/reader-lab-run.test.ts"], "red": "4 failed: a healthy engine; a run lost after the hostile step; an older door; Stop"},
  {"id": "RLB-T9-M3", "spec": "(k) M10.15", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' }, profile: 'lab-draw',", "new": "bytes, docKey: null, title: 'reader-lab.md', prefs: { theme: 'auto' },", "tests": ["test/reader-lab-run.test.ts"], "red": "1 failed: every reader mount is the lab profile"},
  {"id": "RLB-T9-M4", "spec": "(t)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "if ((counts.view?.probes['popup-ran'].hits ?? 0) > 0) return;", "new": "", "tests": ["test/reader-lab-run.test.ts"], "red": "1 failed: the tap wait ends at the tap: one read while it waits, not thirty"},
  {"id": "RLB-T9-M5", "spec": "(s)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "// An older door fails here, before any frame (refinement (s)).\n    await read();", "new": "// An older door fails here, before any frame (refinement (s)).", "tests": ["test/reader-lab-run.test.ts"], "red": "2 failed: an older door; the tap wait ends at the tap"},
  {"id": "RLB-T9-M6", "spec": "(s) M10.18", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "if (last !== 'unknown-run' && last !== 'unreadable') counts.view = last;", "new": "if (last === 'unknown-run' || last === 'unreadable') throw new LabFailure(last); else counts.view = last;", "tests": ["test/reader-lab-run.test.ts"], "red": "1 failed: a run lost after the hostile step keeps every count it read"},
  {"id": "RLB-T9-M7", "spec": "(v)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "const gap = longestFrameGap(deps.frame, gapWindowEnd(deps.gapWindow, settled, deps.sleep));", "new": "const gap = longestFrameGap(deps.frame, settled);", "tests": ["test/reader-lab-run.test.ts"], "red": "1 failed: the gap window ends at ready under the library this build pins"},
  {"id": "RLB-T9-M8", "spec": "(v)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "return w === 'ready' ? settled : settled.then((o) => (o === 'ready' ? sleep(LAB_DRAW_SETTLE_MS) : undefined));", "new": "return settled;", "tests": ["test/reader-lab-run.test.ts"], "red": "1 failed: the gap window ends at ready under the library this build pins"}
]
```

RLB-T9-M1's `old` is the line in `withFrame`'s `finally`; `hostileAndStrays` names its frame `strays`, so `f.remove();` matches once in the file. The step order (the hostile step before the Mermaid mounts) has no one-hunk row; RLB-T9-M6's case is what reds if the order is swapped back, since the hostile step's read would then come after the run was lost.

**Verify:** `test/reader-lab-run.test.ts` 12 passed; `TSC-OK`; the guards green.

### Task 10: The page, its route, its palette door and its stylesheet (refinements (p), (r); M10.12)

**Run:** RL-b. **Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`.

**Files:**
- Create: `pwa/src/screens/ReaderLab.tsx`, `pwa/src/readerLab/readerLab.css`, `pwa/test/reader-lab-page.test.tsx`.
- Modify: `pwa/src/lib/routes.ts` (one row), `pwa/src/app.tsx` (one import, one ladder rung), `pwa/test/app.test.tsx` (one probe, one case), `pwa/test/command-registry.test.ts` (the id list, the rank filter, two rank rows, one title), `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the C9 row's PWA cell gains `screens/ReaderLab.tsx`).
- Guards (not edited): `pwa/test/contrast.test.ts`, `pwa/test/tap-targets.test.tsx`, `pwa/test/highlight-measure.test.tsx`, `server/test/rings/totality.test.ts`, `server/test/census-w7/pwa.test.ts`.

**Interfaces:** Produces `ReaderLab(props: { load?: () => Promise<typeof import('../readerLab/run')> })`, the route row `reader-lab`, and the palette command `go-reader-lab` ("Go to Settings › Reader lab").

**Decisions:** (1) R19's page shape: `PageScaffold`, one Start/Stop button, one live line, the result in one `<pre>` with Select result; no copy control, no storage. (2) The run's module loads on Start through the one literal `import('../readerLab/run')`, so the main bundle holds only the screen, the check list, the device line and the words. (3) A check's row shows its outcome only after the step that decides it has passed (`LAB_CHECK_STEP`), so a partial count never shows as a verdict. (4) The stage is a visible `role="group"` under the lists: the popup frame's button must be tappable. (5) Two groups: E18's eight lines (the walls and the teardown signal) and E17's two. (6) Before Start the page says, in one sentence, that on a server with sign-in on each run leaves one or two foreign-origin lines in the server's journal, from the lab's own frames, and that they are expected; and it shows the device line from `deviceFacts`, the same facts the block's first line carries.

- [ ] **Step 0: Base.** `test -f pwa/src/readerLab/run.ts && git grep -qF "  { id: 'measure-highlighting', pattern:" HEAD -- pwa/src/lib/routes.ts && ! git grep -qF "reader-lab" HEAD -- pwa/src/lib/routes.ts && git grep -qF '| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx`, `readerLab/**` |' HEAD -- docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md && echo T10-BASE-OK` — Expected: `T10-BASE-OK`. Confirm the claims on `routes.ts`, `app.tsx`, `app.test.tsx`, `command-registry.test.ts`. Run `test/app.test.tsx` and `test/command-registry.test.ts` alone and record their counts.
- [ ] **Step 1: Write the failing tests.** Create `pwa/test/reader-lab-page.test.tsx` with exactly this content:

```tsx
// The reader lab page (native Docs reader, the reader lab plan of 2026-11-03, Task 10; the rich-docs spec's row M10.12):
// its states with a fake run module, and `api.readerLab`'s requests. Before, running, stopping, done and failed; the result
// is selected, never copied; leaving the page stops the run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createApi } from '../src/lib/api';
import { LAB_CHECKS } from '../src/readerLab/checks';
import { LAB_TEXT } from '../src/readerLab/labText';
import type { LabDeps, LabProgress, LabResult } from '../src/readerLab/run';
import { ReaderLab } from '../src/screens/ReaderLab';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type RunModule = typeof import('../src/readerLab/run');

class FakeFailure extends Error {
  readonly word: string;
  constructor(word: string) {
    super(word);
    this.word = word;
  }
}

const HOLDS = Object.fromEntries(LAB_CHECKS.map((k) => [k, { verdict: 'holds', detail: '' }])) as unknown as LabResult['outcomes'];
const RESULT = { outcomes: HOLDS, local: { selfNavLoads: 2, busy: null, mounts: [], hostile: null }, run: null, finalRead: 'read' } as LabResult;

/** A run module whose run is `run`; it records the deps it was handed. */
function fakeModule(run: (deps: LabDeps, progress: (p: LabProgress) => void) => Promise<LabResult>): { mod: RunModule; handed: LabDeps[] } {
  const handed: LabDeps[] = [];
  const mod = {
    runReaderLab: vi.fn(async (deps: LabDeps, progress: (p: LabProgress) => void) => { handed.push(deps); return run(deps, progress); }),
    defaultLabDeps: vi.fn((p: { stage: HTMLElement; signal: AbortSignal }) => ({ stage: p.stage, signal: p.signal }) as unknown as LabDeps),
    labResultText: vi.fn(() => 'reader-lab 1 · a fake block'),
    LabFailure: FakeFailure,
  } as unknown as RunModule;
  return { mod, handed };
}

describe('the reader lab page (reader lab plan, Task 10)', () => {
  it('before: the title, the intro, the journal note, the device line, ten lines not run, and Start', () => {
    render(<ReaderLab load={() => Promise.resolve(fakeModule(async () => RESULT).mod)} />);
    expect(screen.getByRole('heading', { level: 1, name: LAB_TEXT.title })).toBeInTheDocument();
    expect(screen.getByText(LAB_TEXT.intro)).toBeInTheDocument();
    expect(screen.getByText(LAB_TEXT.journal)).toBeInTheDocument();
    expect(screen.getByText(/ · worker (?:yes|no) · frame sandbox (?:yes|no) · csp attribute (?:yes|no)$/)).toBeInTheDocument();
    expect(LAB_CHECKS).toHaveLength(10);
    expect(screen.getAllByText(LAB_TEXT.notRun)).toHaveLength(LAB_CHECKS.length);
    for (const id of LAB_CHECKS) expect(screen.getByText(LAB_TEXT.checks[id])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LAB_TEXT.start })).toBeInTheDocument();
  });

  it('Start loads the run once, and Done shows every outcome, the result block and Select result', async () => {
    const f = fakeModule(async () => RESULT);
    const load = vi.fn(() => Promise.resolve(f.mod));
    render(<ReaderLab load={load} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(LAB_TEXT.result));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(LAB_TEXT.verdict.holds)).toHaveLength(LAB_CHECKS.length);
    expect(screen.getByText('reader-lab 1 · a fake block').tagName).toBe('PRE');
    expect(f.handed[0]!.stage).toBe(document.querySelector('.reader-lab-stage'));
  });

  it('Select result selects the whole block, and nothing writes the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ReaderLab load={() => Promise.resolve(fakeModule(async () => RESULT).mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(LAB_TEXT.result));
    const select = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({ selectAllChildren: select } as unknown as Selection);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.select }));
    expect(select).toHaveBeenCalledWith(screen.getByText('reader-lab 1 · a fake block'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('Stop aborts the run and returns to Before; leaving the page aborts it too', async () => {
    const waitForAbort = (deps: LabDeps): Promise<LabResult> => new Promise((_, reject) => {
      deps.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    });
    const f = fakeModule(waitForAbort);
    render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => expect(f.handed).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.stop }));
    await waitFor(() => screen.getByRole('button', { name: LAB_TEXT.start }));
    expect(f.handed[0]!.signal.aborted).toBe(true);
    cleanup();
    const g = fakeModule(waitForAbort);
    const view = render(<ReaderLab load={() => Promise.resolve(g.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => expect(g.handed).toHaveLength(1));
    view.unmount();
    expect(g.handed[0]!.signal.aborted).toBe(true);
  });

  it('a check decided by the current step reads running, not its partial outcome', async () => {
    const f = fakeModule((deps, progress) => new Promise<LabResult>((_, reject) => {
      progress({ step: 1, of: 9, line: 'tap', tap: true, outcomes: { 'no-popup-top-nav': { verdict: 'not-measured', detail: '' } } });
      deps.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    }));
    render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(/^1 of 9/));
    expect(screen.queryByText(LAB_TEXT.verdict['not-measured'])).toBeNull();
    expect(screen.getAllByText(LAB_TEXT.running)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.stop }));
    await waitFor(() => screen.getByRole('button', { name: LAB_TEXT.start }));
  });

  it('a failed run says why in one sentence', async () => {
    for (const word of ['no-door', 'refused', 'unknown-run', 'unreadable'] as const) {
      const f = fakeModule(async () => { throw new FakeFailure(word); });
      render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
      fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
      await waitFor(() => screen.getByText(LAB_TEXT.failed[word]));
      cleanup();
    }
  });
});

describe('api.readerLab (reader lab plan, Task 10)', () => {
  it('opens, reads, closes and probes through the funnel, at the vocabulary\'s paths', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      const body = String(url).includes('/probe/') ? null : JSON.stringify({ ok: true });
      return new Response(body, { status: body === null ? 204 : 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createApi(fetchImpl as unknown as typeof fetch);
    const n = 'AAAAAAAAAAAAAAAAAAAAAA';
    await a.readerLab.open();
    await a.readerLab.read(n);
    await a.readerLab.close(n);
    await a.readerLab.probe(n);
    expect(calls).toEqual([
      { url: '/api/reader-lab/runs', method: 'POST' },
      { url: `/api/reader-lab/runs/${n}`, method: 'GET' },
      { url: `/api/reader-lab/runs/${n}/close`, method: 'POST' },
      { url: `/api/reader-lab/probe/${n}/cookie-console`, method: 'GET' },
    ]);
  });
});
```

  In `pwa/test/app.test.tsx`:
  Find: `    '/settings/security', '/settings/bogus', '/settings/a/b', '/settings/measure-highlighting',`
  Replace:
```ts
    '/settings/security', '/settings/bogus', '/settings/a/b', '/settings/measure-highlighting',
    // The reader lab (the reader lab plan, Task 10).
    '/settings/reader-lab',
```
  Find: ``  it('`/settings/bogus` renders Settings with the not-found line, never ScreenFallback (D-5504)', () => {``
  Replace:
```tsx
  it('`/settings/reader-lab` renders the reader lab, not the Settings frame (the reader lab plan, Task 10)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    try {
      navigate('/settings/reader-lab');
      render(<App />);
      const detail = document.querySelector('.shell-detail')!;
      expect(within(detail as HTMLElement).getByRole('heading', { level: 1, name: 'Reader lab' })).toBeInTheDocument();
      expect(within(detail as HTMLElement).queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('`/settings/bogus` renders Settings with the not-found line, never ScreenFallback (D-5504)', () => {
```
  In `pwa/test/command-registry.test.ts`:
  Find:
```ts
      // Docs W5h-a Task 9: R19's measurement page, a page under Settings; its door is the palette's Go to.
      'go-measure-highlighting',
```
  Replace:
```ts
      // Docs W5h-a Task 9: R19's measurement page, a page under Settings; its door is the palette's Go to.
      'go-measure-highlighting',
      // The reader lab plan, Task 10: the reader lab, a page under Settings beside R19's; its door is the palette's Go to.
      'go-reader-lab',
```
  Find: `    const ranked = (q: string): string[] => rankCommands(q, baseCommands()).map((c) => c.id).filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting');`
  Replace: `    const ranked = (q: string): string[] => rankCommands(q, baseCommands()).map((c) => c.id).filter((id) => id !== 'toggle-inspector' && id !== 'go-measure-highlighting' && id !== 'go-reader-lab');`
  Find: `    expect(empty.indexOf('go-measure-highlighting'), 'after Settings\' five pages').toBe(empty.indexOf('go-settings-security') + 1);`
  Replace:
```ts
    expect(empty.indexOf('go-measure-highlighting'), 'after Settings\' five pages').toBe(empty.indexOf('go-settings-security') + 1);
    // The reader lab plan, Task 10: the one command whose title holds "reader", placed right after R19's page.
    expect(rankCommands('reader', baseCommands()).map((c) => c.id)).toEqual(['go-reader-lab']);
    expect(empty.indexOf('go-reader-lab'), 'after R19\'s page').toBe(empty.indexOf('go-measure-highlighting') + 1);
```
  Find: `    expect(GO_TO.find((g) => g.id === 'go-measure-highlighting')?.title).toBe('Go to Settings › Measure highlighting');`
  Replace:
```ts
    expect(GO_TO.find((g) => g.id === 'go-measure-highlighting')?.title).toBe('Go to Settings › Measure highlighting');
    expect(GO_TO.find((g) => g.id === 'go-reader-lab')?.title).toBe('Go to Settings › Reader lab');
```
- [ ] **Step 2: Run them to see them fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-page.test.tsx test/app.test.tsx test/command-registry.test.ts )` — Expected (prediction): `reader-lab-page` fails to load (`../src/screens/ReaderLab`); `app.test.tsx` 2 failed (the route-and-ladder case finds no row for the new probe, and the new case finds no heading); `command-registry.test.ts` 3 failed (the id list, the rank rows and the title).
- [ ] **Step 3: Write `pwa/src/readerLab/readerLab.css`** with exactly this content:

```css
/* The reader lab page (native Docs reader, the reader lab plan of 2026-11-03, Task 10). Layout only, and no colour of its
   own beyond the ink tokens every palette defines, so every skin and theme draws it. The stage holds the lab's frames
   and its reader mounts while a run is under way; the popup frame's button must be visible to be tapped. */
.reader-lab-group ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
.reader-lab-row { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-1) var(--sp-2); align-items: baseline; }
.reader-lab-word { font: var(--weight-regular) var(--text-sm) / var(--leading-mono) var(--font-mono); }
.reader-lab-detail { grid-column: 1 / -1; color: var(--ink-secondary); overflow-wrap: anywhere; }
.reader-lab-result {
  margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text;
  font: var(--weight-regular) var(--text-sm) / var(--leading-mono) var(--font-mono);
}
.reader-lab-stage { display: grid; gap: var(--sp-2); min-inline-size: 0; }
.reader-lab-stage > iframe { display: block; inline-size: 100%; block-size: 8rem; border: 0; }
.reader-lab-mount { position: relative; inline-size: 100%; block-size: 16rem; }
.reader-lab-mount iframe { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; border: 0; }
```

- [ ] **Step 4: Write `pwa/src/screens/ReaderLab.tsx`** with exactly this content:

```tsx
// The reader lab (native Docs reader, the reader lab plan of 2026-11-03, Task 10; the reader lab design, section 2):
// `/settings/reader-lab`, a page under Settings that the palette offers as "Go to Settings › Reader lab". Start loads the
// run (`readerLab/run.ts`, with the frames and the library's frame policy) through one literal dynamic import, then walks
// the ten lines' checks in the stage below the lists; Stop aborts it, and so does leaving the page. The result is text in one
// `<pre>`, which Select result selects whole, so the page draws no copy control. It stores nothing, uploads no result and
// writes no clipboard; its only requests go to this console's own door (M10.12, `reader-lab-scans.test.ts`).
//
// Ring L4: a screen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, PageScaffold } from '@ccrc/ui';
import { LAB_CHECK_STEP, LAB_E17, LAB_E18, type LabCheckId, type LabOutcome } from '../readerLab/checks';
import { deviceFacts, deviceOf, labFeaturesOf } from '../readerLab/device';
import { LAB_TEXT } from '../readerLab/labText';
import type { LabProgress } from '../readerLab/run';
import '../readerLab/readerLab.css';

type RunModule = typeof import('../readerLab/run');

type State =
  | { readonly s: 'before' }
  | { readonly s: 'running'; readonly p: LabProgress | null }
  | { readonly s: 'stopping' }
  | { readonly s: 'done'; readonly text: string; readonly outcomes: Readonly<Record<LabCheckId, LabOutcome>> }
  | { readonly s: 'failed'; readonly why: string };

/** The run's module, loaded on Start: its one literal dynamic import. */
const loadRun = (): Promise<RunModule> => import('../readerLab/run');

/** What one check's row says now: a verdict only once the step that decides it has passed. */
function rowOf(state: State, id: LabCheckId): { readonly word: string; readonly detail: string } {
  if (state.s === 'done') return { word: LAB_TEXT.verdict[state.outcomes[id].verdict], detail: state.outcomes[id].detail };
  if (state.s !== 'running' || state.p === null) return { word: state.s === 'running' ? LAB_TEXT.waiting : LAB_TEXT.notRun, detail: '' };
  const decidedAt = LAB_CHECK_STEP[id];
  if (state.p.step < decidedAt) return { word: LAB_TEXT.waiting, detail: '' };
  const o = state.p.outcomes[id];
  if (state.p.step === decidedAt || o === undefined) return { word: LAB_TEXT.running, detail: '' };
  return { word: LAB_TEXT.verdict[o.verdict], detail: o.detail };
}

export function ReaderLab(p: { readonly load?: () => Promise<RunModule> }): ReactNode {
  const stage = useRef<HTMLDivElement | null>(null);
  const result = useRef<HTMLPreElement | null>(null);
  const running = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ s: 'before' });
  const device = useMemo(() => deviceOf(navigator.userAgent, navigator.hardwareConcurrency, labFeaturesOf(window)), []);
  useEffect(() => () => { running.current?.abort(); }, []);

  const start = (): void => {
    const ctl = new AbortController();
    running.current = ctl;
    setState({ s: 'running', p: null });
    void (async () => {
      let mod: RunModule | null = null;
      try {
        mod = await (p.load ?? loadRun)();
        const r = await mod.runReaderLab(mod.defaultLabDeps({ stage: stage.current!, signal: ctl.signal }), (pr) => {
          if (!ctl.signal.aborted) setState({ s: 'running', p: pr });
        });
        if (!ctl.signal.aborted) setState({ s: 'done', text: mod.labResultText(r, device), outcomes: r.outcomes });
      } catch (e) {
        if (ctl.signal.aborted) {
          setState({ s: 'before' });
          return;
        }
        const word = mod !== null && e instanceof mod.LabFailure ? e.word : null;
        setState({ s: 'failed', why: word !== null ? LAB_TEXT.failed[word] : `${LAB_TEXT.failed.other}${e instanceof Error ? e.message : String(e)}` });
      }
    })();
  };
  const stop = (): void => {
    running.current?.abort();
    setState({ s: 'stopping' });
  };

  const group = (title: string, ids: readonly LabCheckId[]): ReactNode => (
    <section className="reader-lab-group" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {ids.map((id) => {
          const row = rowOf(state, id);
          return (
            <li key={id} className="reader-lab-row">
              <span>{LAB_TEXT.checks[id]}</span>
              <span className="reader-lab-word">{row.word}</span>
              {row.detail !== '' && <small className="reader-lab-detail">{row.detail}</small>}
            </li>
          );
        })}
      </ul>
    </section>
  );
  const line = state.s === 'running' ? (state.p === null ? LAB_TEXT.starting : `${state.p.step} of ${state.p.of}: ${state.p.line}`)
    : state.s === 'stopping' ? LAB_TEXT.stopping : state.s === 'failed' ? state.why : state.s === 'done' ? LAB_TEXT.done : '';
  return (
    <PageScaffold title={LAB_TEXT.title}>
      <p>{LAB_TEXT.intro}</p>
      <p>{LAB_TEXT.journal}</p>
      <p>{deviceFacts(device).join(' · ')}</p>
      {state.s === 'running'
        ? <Button onClick={stop}>{LAB_TEXT.stop}</Button>
        : state.s === 'stopping'
          ? <Button disabled>{LAB_TEXT.stop}</Button>
          : <Button onClick={start}>{LAB_TEXT.start}</Button>}
      <p aria-live="polite">{line}</p>
      {group(LAB_TEXT.wallsGroup, LAB_E18)}
      {group(LAB_TEXT.responsiveGroup, LAB_E17)}
      {state.s === 'done' && (
        <>
          <Button onClick={() => { if (result.current !== null) window.getSelection()?.selectAllChildren(result.current); }}>{LAB_TEXT.select}</Button>
          <figure>
            <figcaption>{LAB_TEXT.result}</figcaption>
            <pre ref={result} className="reader-lab-result">{state.text}</pre>
          </figure>
        </>
      )}
      <div ref={stage} className="reader-lab-stage" role="group" aria-label={LAB_TEXT.stage} />
    </PageScaffold>
  );
}
```

- [ ] **Step 5: The route, the rung and the context row.** In `pwa/src/lib/routes.ts`:
  Find: `  { id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },`
  Replace:
```ts
  { id: 'measure-highlighting', pattern: /^\/settings\/measure-highlighting\/?$/, title: 'Measure highlighting', top: false, path: '/settings/measure-highlighting' },
  // The reader lab (the reader lab plan of 2026-11-03, Task 10): beside R19's page and of its shape; the palette offers it
  // as "Go to Settings › Reader lab". Its id is not `settings-…`, so the ladder renders the page itself.
  { id: 'reader-lab', pattern: /^\/settings\/reader-lab\/?$/, title: 'Reader lab', top: false, path: '/settings/reader-lab' },
```
  In `pwa/src/app.tsx`:
  Find: `import { RunsScreen } from './screens/RunsScreen';`
  Replace:
```ts
import { RunsScreen } from './screens/RunsScreen';
import { ReaderLab } from './screens/ReaderLab';
```
  Find:
```tsx
  ) : route === 'measure-highlighting' ? (
    <HighlightMeasure />
```
  Replace:
```tsx
  ) : route === 'measure-highlighting' ? (
    <HighlightMeasure />
  ) : route === 'reader-lab' ? (
    <ReaderLab />
```
  In `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (as Task 6 leaves it):
  Find:
```md
| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx`, `readerLab/**` |
```
  Replace:
```md
| C9 Docs | `docs/**`, `readerLab/**` | `docs/**`, `screens/DocsScreen.tsx`, `screens/HighlightMeasure.tsx`, `screens/highlightMeasureRun.tsx`, `readerLab/**`, `screens/ReaderLab.tsx` |
```
- [ ] **Step 6: Run them to see them pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-page.test.tsx test/app.test.tsx test/command-registry.test.ts test/highlight-measure.test.tsx test/contrast.test.ts test/tap-targets.test.tsx )` through `ccrc test` — Expected (prediction): `reader-lab-page` 7 passed; `app.test.tsx` its BASE count plus 1; `command-registry` its BASE count; the rest at their BASE counts. If the "reader" rank row lists another command, record the measured list and report it (the title is the prediction's only input). `TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/totality.test.ts test/rings/pwa-rings.test.ts test/census-w7/pwa.test.ts )` — green.
- [ ] **Step 7: Commit.** `git add pwa/src/screens/ReaderLab.tsx pwa/src/readerLab/readerLab.css pwa/test/reader-lab-page.test.tsx pwa/src/lib/routes.ts pwa/src/app.tsx pwa/test/app.test.tsx pwa/test/command-registry.test.ts docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (expect 8), message `pwa: Settings › Reader lab, its route, its palette door and its page (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| RLB-T10-M1 | (p) | `src/lib/routes.ts` | `{ id: 'reader-lab', pattern: /^\/settings\/reader-lab\/?$/, title: 'Reader lab', top: false, path: '/settings/reader-lab' },` → removed | `test/app.test.tsx`, `test/command-registry.test.ts` | 2+ failed — `'`/settings/reader-lab` renders the reader lab, …'` and the command-registry id list |
| RLB-T10-M2 | (p) M10.12 | `src/screens/ReaderLab.tsx` | `useEffect(() => () => { running.current?.abort(); }, []);` → removed | `test/reader-lab-page.test.tsx` | 1 failed — `'Stop aborts the run and returns to Before; leaving the page aborts it too'` |
| RLB-T10-M3 | (p) | `src/lib/api.ts` | `await request(readerLabProbePath(nonce, 'cookie-console'));` → `await request(readerLabProbePath(nonce, 'cookie-image'));` | `test/reader-lab-page.test.tsx` | 1 failed — `'opens, reads, closes and probes through the funnel, …'` |
| RLB-T10-M4 | (l) | `src/screens/ReaderLab.tsx` | `if (state.p.step === decidedAt \|\| o === undefined) return { word: LAB_TEXT.running, detail: '' };` → `if (o === undefined) return { word: LAB_TEXT.running, detail: '' };` | `test/reader-lab-page.test.tsx` | 1 failed — `'a check decided by the current step reads running, not its partial outcome'` |
| RLB-T10-M5 | (e) | `src/screens/ReaderLab.tsx` | `<p>{LAB_TEXT.journal}</p>` → removed | `test/reader-lab-page.test.tsx` | 1 failed — `'before: the title, the intro, the journal note, the device line, ten lines not run, and Start'` |

```json
[
  {"id": "RLB-T10-M1", "spec": "(p)", "pkg": "pwa", "file": "src/lib/routes.ts", "old": "{ id: 'reader-lab', pattern: /^\\/settings\\/reader-lab\\/?$/, title: 'Reader lab', top: false, path: '/settings/reader-lab' },", "new": "", "tests": ["test/app.test.tsx", "test/command-registry.test.ts"], "red": "2+ failed: /settings/reader-lab renders the reader lab; the command-registry id list"},
  {"id": "RLB-T10-M2", "spec": "(p) M10.12", "pkg": "pwa", "file": "src/screens/ReaderLab.tsx", "old": "useEffect(() => () => { running.current?.abort(); }, []);", "new": "", "tests": ["test/reader-lab-page.test.tsx"], "red": "1 failed: Stop aborts the run and returns to Before; leaving the page aborts it too"},
  {"id": "RLB-T10-M3", "spec": "(p)", "pkg": "pwa", "file": "src/lib/api.ts", "old": "await request(readerLabProbePath(nonce, 'cookie-console'));", "new": "await request(readerLabProbePath(nonce, 'cookie-image'));", "tests": ["test/reader-lab-page.test.tsx"], "red": "1 failed: opens, reads, closes and probes through the funnel"},
  {"id": "RLB-T10-M4", "spec": "(l)", "pkg": "pwa", "file": "src/screens/ReaderLab.tsx", "old": "if (state.p.step === decidedAt || o === undefined) return { word: LAB_TEXT.running, detail: '' };", "new": "if (o === undefined) return { word: LAB_TEXT.running, detail: '' };", "tests": ["test/reader-lab-page.test.tsx"], "red": "1 failed: a check decided by the current step reads running, not its partial outcome"},
  {"id": "RLB-T10-M5", "spec": "(e)", "pkg": "pwa", "file": "src/screens/ReaderLab.tsx", "old": "<p>{LAB_TEXT.journal}</p>", "new": "", "tests": ["test/reader-lab-page.test.tsx"], "red": "1 failed: before: the title, the intro, the journal note, the device line, ten lines not run, and Start"}
]
```

**Verify:** `reader-lab-page` 7 passed; `app.test.tsx` BASE plus 1; `command-registry` at BASE; `TSC-OK`; the rings green.

### Task 11: What the lab never does, scanned; and the page in Chrome (refinements (h), (k), (p); M10.9, M10.12, M10.15, M10.B1)

**Run:** RL-b. **Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the scans' reach and the browser case's controls).

**Files:**
- Create: `pwa/test/reader-lab-scans.test.ts`, `pwa/browser/reader-lab.browser.test.ts`.
- Guards (not edited): `pwa/test/docs-scans.test.ts`, `pwa/test/browser-leg.test.ts` (if it pins the browser files it lists, Step 0 records that and this task adds no edit there without asking), `pwa/browser/reader-frame.browser.test.ts`.

**Decisions:** (1) The scans read TypeScript's parse of each file, so the frame scripts' text, which names `fetch`, `localStorage` and the rest on purpose, is strings and never counts; that text runs only inside opaque frames, and the browser case checks what it does. (2) Each rule has planted controls run on the file's own text plus one planted line, as clause M7.12 does. (3) The browser case is one end-to-end run of the built page in Chrome against a fake door that counts by name, the cookie by name and `Sec-Fetch-Site`, as the server's counter does; it asserts the seven wall lines and the teardown signal, records the E17 lines, and is the target of two rows that rebuild the page with a widened sandbox and with no wall policy. (4) Two things the harness cannot show, said rather than faked. First, `openApp` intercepts requests (`ctx.route('**/api/**', …)`), and while Playwright intercepts it answers a CORS preflight itself, approving it; so the cookie frame's marker request (`cookie-fetch-marker`, which needs a preflight) arrives here although a real server never approves that preflight. The fake door records the marker as harness-limited and does not count it, the case asserts the record, and the refusal itself is pinned at the server (Task 3's `'a CORS preflight to the probe is never approved'`), because `pwa/browser/app.ts` stays byte-identical and its interception covers every `/api` request of the context. Second, Playwright can route WebSocket upgrades (`ctx.routeWebSocket`, which `app.ts` uses for `/ws/`), but its route exposes the URL, not the request's headers, so it cannot say whether an upgrade carried the cookie; the case leaves the probe's WebSocket unrouted (the static server answers it with no upgrade), so `cookie-websocket` reads as not arrived here, and the server's armed upgrade case counts it with its class. (5) Headers are read with `await route.request().allHeaders()`: `request.headers()` leaves out `cookie` and the `sec-fetch-*` headers.

- [ ] **Step 0: Base.** `test -f pwa/src/screens/ReaderLab.tsx && test ! -e pwa/test/reader-lab-scans.test.ts && test ! -e pwa/browser/reader-lab.browser.test.ts && git grep -qF "export async function openApp(browser: Browser, view: AppView, fixture: AppFixture): Promise<OpenedApp> {" HEAD -- pwa/browser/app.ts && echo T11-BASE-OK` — Expected: `T11-BASE-OK`. Read `pwa/test/browser-leg.test.ts` and record whether it lists browser files by name (W8a recorded that it does not).
- [ ] **Step 1: Write the scans,** `pwa/test/reader-lab-scans.test.ts`, with exactly this content:

```ts
// What the reader lab never does (native Docs reader, the reader lab plan of 2026-11-03, Task 11; the rich-docs spec's
// rows M10.9, M10.12, M10.15; the reader lab design, section 7), read with TypeScript's parser, each rule with planted
// controls on a file's own text:
//   1. The lab's modules (`screens/ReaderLab.tsx`, `docs/reader/labPolicy.ts`, every file under `readerLab/`) import no
//      `lib/storage`, name no `localStorage`, `sessionStorage`, `indexedDB` or `caches`, read no `clipboard`, call no
//      `fetch`, `sendBeacon`, `postMessage` or `window.open`, name no `XMLHttpRequest`, `WebSocket`, `EventSource` or
//      `MessageChannel`, read `api` only as `api.readerLab`, and spell no URL but the SVG namespace. The frame scripts'
//      TEXT names several of these on purpose; it runs only inside opaque frames, and a string is not an identifier.
//   2. Outside `pwa/src/docs` (whose own clause W8a holds that tree), an iframe or a srcdoc is built in
//      `readerLab/frames.ts` alone.
//   3. No string in `pwa/src` holds a sandbox token beyond `allow-scripts`, and `frames.ts` sets `sandbox` only from
//      `LAB_SANDBOX`.
//   4. `'lab-draw'` is spelled only in `docs/reader/policy.ts` and `readerLab/run.ts`.
// NOT EXHAUSTIVE. An alias (`const s = localStorage`), a computed member, `globalThis[…]`, `eval` and a name built from
// pieces are not seen; the held-out review reads for them, and the browser case checks what the frames do.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const SRC = path.join(PWA, 'src');
const SVG_NS = 'http://www.w3.org/2000/svg';
const FRAME_HOME = 'src/readerLab/frames.ts';
const LAB_DRAW_HOMES: readonly string[] = ['src/docs/reader/policy.ts', 'src/readerLab/run.ts'];
const FORBIDDEN_SANDBOX = /\ballow-(?:same-origin|popups|top-navigation|forms|modals|downloads|pointer-lock|presentation|orientation-lock|storage-access)/;

/** Every `.ts` and `.tsx` file under `root`, sorted. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const p = path.join(root, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (abs: string): string => path.relative(PWA, abs).split(path.sep).join('/');
const read = (r: string): string => readFileSync(path.join(PWA, ...r.split('/')), 'utf8');
const ALL = (): string[] => sourceFiles(SRC).map(rel);
const LAB_MODULES = (): string[] => ['src/screens/ReaderLab.tsx', 'src/docs/reader/labPolicy.ts', ...sourceFiles(path.join(SRC, 'readerLab')).map(rel)];

const parse = (source: string, file: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function unwrap(n: ts.Expression): ts.Expression {
  let e = n;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)
    || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}
function memberName(n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression))) {
    return n.argumentExpression.text;
  }
  return undefined;
}
const stringText = (n: ts.Node): string | undefined =>
  (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
    ? n.text : undefined;
const walk = (sf: ts.SourceFile, f: (n: ts.Node) => void): void => {
  const visit = (n: ts.Node): void => { f(n); ts.forEachChild(n, visit); };
  visit(sf);
};

/** Rule 1, on one lab module. */
function labFindings(source: string, file: string): string[] {
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)
      && /(?:^|\/)lib\/storage$/.test(n.moduleSpecifier.text)) out.add('storage');
    if (ts.isIdentifier(n) && ['localStorage', 'sessionStorage', 'indexedDB', 'caches'].includes(n.text)) out.add('storage');
    if (ts.isIdentifier(n) && ['XMLHttpRequest', 'WebSocket', 'EventSource', 'MessageChannel'].includes(n.text)) out.add('channel');
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'clipboard') out.add('clipboard');
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = ts.isIdentifier(callee) ? callee.text : memberName(callee);
      if (name === 'fetch' || name === 'sendBeacon') out.add('fetch');
      if (name === 'postMessage') out.add('postMessage');
      if (name === 'open' && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
        const owner = unwrap(callee.expression);
        if (ts.isIdentifier(owner) && owner.text === 'window') out.add('window.open');
      }
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'api' && n.name.text !== 'readerLab') out.add('api');
    const text = stringText(n);
    if (text !== undefined) {
      for (const m of text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)) if (m[0] !== SVG_NS) out.add('url');
    }
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 2, on any file outside `src/docs`; `ignoreHome` reads the frame home too (the anti-vacuity half). */
function frameFindings(source: string, file: string, ignoreHome = false): string[] {
  if (file.startsWith('src/docs/') || (file === FRAME_HOME && !ignoreHome)) return [];
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    if (ts.isIdentifier(n) && n.text.toLowerCase() === 'srcdoc') out.add('srcdoc');
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe') out.add('iframe');
    if (ts.isCallExpression(n) && memberName(unwrap(n.expression)) === 'createElement' && n.arguments[0] !== undefined
      && stringText(n.arguments[0])?.toLowerCase() === 'iframe') out.add('iframe');
    const text = stringText(n);
    if (text !== undefined && /<iframe/i.test(text)) out.add('iframe');
    if (text !== undefined && /srcdoc/i.test(text)) out.add('srcdoc');
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 3, on any file. */
function sandboxFindings(source: string, file: string): string[] {
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    const text = stringText(n);
    if (text !== undefined && FORBIDDEN_SANDBOX.test(text)) out.add('token');
    if (ts.isCallExpression(n) && memberName(unwrap(n.expression)) === 'setAttribute' && n.arguments[0] !== undefined
      && stringText(n.arguments[0]) === 'sandbox') {
      const v = n.arguments[1];
      if (v === undefined || !ts.isIdentifier(v) || v.text !== 'LAB_SANDBOX') out.add('sandbox-value');
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && memberName(unwrap(n.left)) === 'sandbox') out.add('sandbox-value');
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 4, on any file. */
function labDrawFindings(source: string, file: string): string[] {
  let hits = 0;
  walk(parse(source, file), (n) => { if (stringText(n) === 'lab-draw') hits += 1; });
  return hits > 0 && !LAB_DRAW_HOMES.includes(file) ? [`${file} lab-draw`] : [];
}

const planted = (file: string, text: string, f: (s: string, file: string) => string[]): string[] => f(`${read(file)}\n${text}\n`, file);

describe('what the reader lab never does (reader lab plan, Task 11)', () => {
  it('the lab modules exist and are read', () => {
    const files = LAB_MODULES();
    expect(files).toEqual(expect.arrayContaining(['src/screens/ReaderLab.tsx', 'src/docs/reader/labPolicy.ts', 'src/readerLab/run.ts',
      'src/readerLab/frames.ts', 'src/readerLab/frameScripts.ts', 'src/readerLab/battery.ts', 'src/readerLab/verdicts.ts']));
    expect(read('src/readerLab/run.ts')).toContain('api.readerLab');
  });

  it('rule 1: the lab modules store nothing, copy nothing, request nothing of their own, read api only as readerLab, and spell no URL (M10.12)', () => {
    expect(LAB_MODULES().flatMap((f) => labFindings(read(f), f))).toEqual([]);
  });

  it.each([
    ['a storage read', "export const planted = () => localStorage.length;", 'storage'],
    ['the storage owner', "import { pageStorage } from '../lib/storage';\nexport const planted = pageStorage;", 'storage'],
    ['a clipboard write', "export const planted = () => navigator.clipboard.writeText('x');", 'clipboard'],
    ['a fetch of its own', "export const planted = () => fetch('/api/x');", 'fetch'],
    ['a beacon', "export const planted = () => navigator.sendBeacon('/api/x', 'x');", 'fetch'],
    ['a port', 'export const planted = () => new MessageChannel();', 'channel'],
    ['a post', "export const planted = () => window.parent.postMessage('x', '*');", 'postMessage'],
    ['another api read', 'export const planted = () => api.docs;', 'api'],
    ['a URL of its own', "export const planted = 'https://elsewhere.example/x';", 'url'],
    ['a popup', "export const planted = () => window.open('/x');", 'window.open'],
  ])('rule 1 planted: %s in the run module is red', (_name, text, rule) => {
    expect(planted('src/readerLab/run.ts', text, labFindings)).toEqual([`src/readerLab/run.ts ${rule}`]);
  });

  it('rule 2: outside the Docs reader, only readerLab/frames.ts builds an iframe or a srcdoc, and it does (M10.9)', () => {
    expect(ALL().flatMap((f) => frameFindings(read(f), f))).toEqual([]);
    expect(frameFindings(read(FRAME_HOME), FRAME_HOME, true)).toEqual([`${FRAME_HOME} iframe`, `${FRAME_HOME} srcdoc`]);
  });

  it('rule 2 planted: an iframe or a srcdoc anywhere else is red', () => {
    expect(planted('src/lib/router.ts', "export const planted = () => document.createElement('iframe');", frameFindings))
      .toEqual(['src/lib/router.ts iframe']);
    expect(planted('src/screens/ReaderLab.tsx', 'export const Planted = () => <iframe srcDoc="x" />;', frameFindings))
      .toEqual(['src/screens/ReaderLab.tsx iframe', 'src/screens/ReaderLab.tsx srcdoc']);
  });

  it('rule 3: no sandbox token beyond allow-scripts anywhere in pwa/src, and frames.ts sets sandbox only from LAB_SANDBOX (M10.9)', () => {
    expect(ALL().flatMap((f) => sandboxFindings(read(f), f))).toEqual([]);
    expect(read(FRAME_HOME)).toContain("el.setAttribute('sandbox', LAB_SANDBOX);");
  });

  it('rule 3 planted: a widened token or a sandbox set from anything else is red', () => {
    expect(planted('src/lib/router.ts', "export const planted = 'allow-scripts allow-same-origin';", sandboxFindings))
      .toEqual(['src/lib/router.ts token']);
    expect(planted(FRAME_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', 'allow-scripts');", sandboxFindings))
      .toEqual([`${FRAME_HOME} sandbox-value`]);
    expect(planted(FRAME_HOME, "export const planted2 = (el: HTMLIFrameElement) => { (el as unknown as { sandbox: string }).sandbox = 'x'; };", sandboxFindings))
      .toEqual([`${FRAME_HOME} sandbox-value`]);
  });

  it("rule 4: 'lab-draw' is spelled only in policy.ts and run.ts, and both spell it (M10.15)", () => {
    expect(ALL().flatMap((f) => labDrawFindings(read(f), f))).toEqual([]);
    for (const home of LAB_DRAW_HOMES) expect(read(home), home).toContain("'lab-draw'");
  });

  it("rule 4 planted: 'lab-draw' in the Docs reader's own frame is red", () => {
    expect(planted('src/docs/ReaderFrame.tsx', "export const PLANTED = 'lab-draw';", labDrawFindings)).toEqual(['src/docs/ReaderFrame.tsx lab-draw']);
  });
});
```

- [ ] **Step 2: Run the scans.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-scans.test.ts )` — Expected (prediction): `Tests  18 passed (18)` (8 cases and 10 planted rows). The scans guard code that already exists, so their red-first half is the planted rows, each red on its own planted line, and RLB-T11-M3 and M4 below. A red unplanted rule is a finding in Tasks 6-10's code: fix the code, never the scan; a planted row that does not red is a hole in the scan: fix the scan.
- [ ] **Step 3: Write the browser case,** `pwa/browser/reader-lab.browser.test.ts`, from this list (its fixtures are the harness's, so it is specified rather than spelled; the per-task `opus` reviewer checks every listed assertion is in the file):
  - Header: what it measures (the built page's `/settings/reader-lab` in Chrome, end to end, against a fake door; every wall line and the teardown signal must hold on desktop Chrome, the engine every wall was measured on; E17 lines recorded, not asserted; the preflight marker harness-limited and the probe's WebSocket unrouted, each with Decision (4)'s reason), and the run command.
  - Setup, as `reader-frame.browser.test.ts` does: `resolveChrome()` in `beforeAll` (red, never skipped, with no Chrome), `sharedDist()`, `serveDist(dist)`, `chromium.launch({ executablePath, headless: true })`; `openApp(browser, { width: 390, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] })`; `ctx.addCookies([{ name: 'ccrc_session', value: 'lab-session', url: server.origin }])`.
  - The fake door, one `ctx.route((u) => u.pathname.startsWith('/api/reader-lab/'), …)` registered after `openApp` (so it takes precedence over the fixture `/api` route), reading each request's headers with `await route.request().allHeaders()`: `POST /api/reader-lab/runs` answers `{ok: true, nonce: 'BBBBBBBBBBBBBBBBBBBBBB', ttlMs: <READER_LAB_RUN_TTL_MS's figure, 1101000>}`; `GET /api/reader-lab/runs/<nonce>` answers a `LabRunView` naming every `LAB_PROBE_NAMES` entry (zeros included); `POST …/close` answers `{ok: true, closed: true}` and records the close; `GET`/`POST /api/reader-lab/probe/<nonce>/<name>` counts the name (`hits`, `cookie` when the `cookie` header holds `ccrc_session=`, `site` from `sec-fetch-site`, `origin` from `origin`) and answers `204` with no body, except `cookie-fetch-marker`, which it records in a separate `harnessLimited` list, counts nothing for and answers `204` (Decision (4)); an `OPTIONS` that does reach it answers `404` with no CORS header and counts nothing.
  - The case `'the reader lab in Chrome: every wall holds, the door run is closed, and the block names no host or nonce (M10.B1)'`, 240 s timeout:
    1. `goto(server.origin + '/settings/reader-lab')`; click `Start`.
    2. The tap: `page.frameLocator('.reader-lab-stage > iframe').first().getByRole('button', { name: 'Tap here' }).click({ timeout: 30_000 })`.
    3. Wait for the `Result` caption (180 s), read `pre.reader-lab-result`'s text, `console.log('RLB-T11-FIGURES', text)` for the SDD ledger.
    4. Assert: the first line matches `/^reader-lab 1 · Blink \d+ · .* · worker yes · frame sandbox yes · csp attribute yes · library [0-9a-f]{12}$/`; the second line is `E18 walls: 7 of 7 hold; teardown signal holds`; each of the seven wall lines reads `holds`, and the `self-nav-teardown` line reads `holds (second load fired)`; the door line ends `session cookie sent`; the fake door recorded `cookie-console` with the cookie, at least one of `cookie-fetch`, `cookie-xhr`, `cookie-beacon`, `cookie-image` with no cookie, `csp-canary` once, no `csp-*` channel, at least `LAB_CONTROL_FLOOR` (imported from `verdicts.ts`) `ctl-*` channels other than `ctl-iframe`, no `popup-open`, `popup-blank`, `top-nav` or `self-nav`, and one close; its `harnessLimited` list is `['cookie-fetch-marker']` or empty (logged either way: the harness approves the preflight, so the marker may arrive); the text contains neither the server's host nor the nonce.
  - The run command, in the header: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/reader-lab.browser.test.ts )`, through `ccrc test`.
- [ ] **Step 4: Run it.** Through `ccrc test`, the browser case alone — Expected (prediction): `Tests  1 passed (1)`, in under 240 s; record (a) the case file's own measured duration and the `RLB-T11-FIGURES` block (desktop Chrome's own E17 lines) in the SDD ledger. Then the whole browser leg once through `ccrc test`: every other file green at its BASE count; record (b) the leg's total time beside BASE's, as information only (a local whole-leg time is not comparable with CI's per-shard limit). Note (c): CI runs the leg in two shards, each limited to 20 minutes and balanced by `pwa/browser/slowFirst.ts#FILE_MS`, where a file the table does not name is costed at the table's median. If (a) is far above that median (more than about 120 s), do not edit `slowFirst.ts` (Scope freezes it): report the figure to the coordinator in the wave-done, so a separate change adds a `FILE_MS` entry with the matching `pwa/test/browser-leg.test.ts` census.
- [ ] **Step 5: Guards.** `TSC-OK`. `( cd pwa && ./node_modules/.bin/vitest run test/docs-scans.test.ts test/browser-leg.test.ts )` — green.
- [ ] **Step 6: Commit.** `git add pwa/test/reader-lab-scans.test.ts pwa/browser/reader-lab.browser.test.ts` (expect 2), message `pwa: what the reader lab never does, scanned, and the page measured in Chrome (docs reader lab)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`; the two browser rows rebuild the page once each, through `ccrc test`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| RLB-T11-M1 | (h) M10.9 | `src/readerLab/frames.ts` | `export const LAB_SANDBOX = 'allow-scripts';` → `export const LAB_SANDBOX = 'allow-scripts allow-same-origin';` | `browser/reader-lab.browser.test.ts` (browser config), `test/reader-lab-scans.test.ts` | the browser case failed (`opaque-origin` and `no-ambient-state` read `does not hold`; `no-cookie` too if Chrome then sends the Lax cookie from the now same-origin frame); scans `1 failed` — rule 3 |
| RLB-T11-M2 | (i) M10.10 | `src/readerLab/frames.ts` | `if (spec.wall !== undefined) {` → `if (spec.wall !== undefined && spec.script === '') {` | `browser/reader-lab.browser.test.ts` (browser config) | the browser case failed (`csp-27` reads `does not hold`: the wall frame ran with no policy and its channels reached the door) |
| RLB-T11-M3 | (p) M10.12 | `src/screens/ReaderLab.tsx` | `const loadRun = (): Promise<RunModule> => import('../readerLab/run');` → `const loadRun = (): Promise<RunModule> => { void localStorage.length; return import('../readerLab/run'); };` | `test/reader-lab-scans.test.ts` | 1 failed — rule 1 |
| RLB-T11-M4 | (k) M10.15 | `src/docs/ReaderFrame.tsx` | `onFallback: (r) => fallBack(String(r)),` → `onFallback: (r) => fallBack(String(r)), profile: 'lab-draw',` | `test/reader-lab-scans.test.ts` | 1 failed — rule 4 |

```json
[
  {"id": "RLB-T11-M1", "spec": "(h) M10.9", "pkg": "pwa", "file": "src/readerLab/frames.ts", "old": "export const LAB_SANDBOX = 'allow-scripts';", "new": "export const LAB_SANDBOX = 'allow-scripts allow-same-origin';", "tests": ["browser/reader-lab.browser.test.ts", "test/reader-lab-scans.test.ts"], "red": "the browser case failed (opaque-origin and no-ambient-state do not hold); scans 1 failed: rule 3"},
  {"id": "RLB-T11-M2", "spec": "(i) M10.10", "pkg": "pwa", "file": "src/readerLab/frames.ts", "old": "if (spec.wall !== undefined) {", "new": "if (spec.wall !== undefined && spec.script === '') {", "tests": ["browser/reader-lab.browser.test.ts"], "red": "the browser case failed (csp-27 does not hold)"},
  {"id": "RLB-T11-M3", "spec": "(p) M10.12", "pkg": "pwa", "file": "src/screens/ReaderLab.tsx", "old": "const loadRun = (): Promise<RunModule> => import('../readerLab/run');", "new": "const loadRun = (): Promise<RunModule> => { void localStorage.length; return import('../readerLab/run'); };", "tests": ["test/reader-lab-scans.test.ts"], "red": "1 failed: rule 1"},
  {"id": "RLB-T11-M4", "spec": "(k) M10.15", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "onFallback: (r) => fallBack(String(r)),", "new": "onFallback: (r) => fallBack(String(r)), profile: 'lab-draw',", "tests": ["test/reader-lab-scans.test.ts"], "red": "1 failed: rule 4"}
]
```

RLB-T11-M2 keeps the wall frame's canary in its config, so the canary arrives and the check reads its channels: the red is "does not hold", never "not measured". The browser rows' tests run with the browser config; the scans rows' with the default.

**Verify:** the scans 18 passed; the browser case 1 passed and the whole leg green, the case's own time and the leg's recorded, and a case time above about 120 s reported; `TSC-OK`.

### Task 12: Close RL-b — review, suites, the mutation table, results, push and the one PR

**Run:** RL-b. **Model routing:** the main loop (Opus); review lenses as "How this wave runs" names them; `sonnet` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Two `opus` lenses over `BASE..HEAD` against this plan and the design's sections 3, 5 and 7: (1) the frames, the walls and what the lab never does (each frame's sandbox, policy and reach; the scripts' reports and that no value leaves a frame; the wall policy's two added sources; the tap; the stray messages; the scans' reach and their NOT EXHAUSTIVE list; the `lab-draw` profile's reach); (2) the verdicts and their anti-vacuity signals (every line's three outcomes, the order "broken first" and what it does not guarantee against a forged positive signal, saturation, the control floor and the ready library mount, every figure mount and `all` in the Mermaid line, the busy frame as a fact, the teardown signal, refinement (u), the run that keeps its counts after step 7, the gap window, the result block's grammar and what it never names, the page's partial-outcome rule). One `sonnet` lens: the page, the route and palette, `api.readerLab`, the censuses (`totality`, `pwa-rings`, `census-w7`, `docs-scans`, `contrast`, `docs-parity`, `citations`), the browser case's own time against `FILE_MS`'s median, and the public-repo scan. Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix.
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit: the `pwa` suite in pieces, `TSC-OK`; the browser leg whole once, with its time; `git fetch -q origin main`, then the WHOLE `server` suite in pieces (its rings, censuses and docs-parity read `pwa/src`), `typecheck-tests` alone, `SERVER-TSC-OK`; a red census in a file outside this run's Scope is a stop-and-ask; re-run any known load flake alone before calling it broken.
- [ ] **Step 3: The mutation table** of Tasks 6-11 at the end state, in the workspace, sequentially, under the low-disk discipline (the two browser rows rebuild once each); keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 4: Define the deviations.** Replace `## Deviations found`'s RL-b placeholder with the issued numbers for refinements (h), (i), (k), (m) and (u), in that order, then any found while executing, and write the unused ones without their prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green.
- [ ] **Step 5: Draft `## Results` (RL-b)**: the counts per suite; every task's JSON row fence as measured; the browser case's own time and desktop Chrome's own result block; the leg's total time beside BASE's, as information only, and whether the case's time was reported for a `FILE_MS` entry; "Named, without a number"; "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-reader-lab/pr-body-rl-b.md` (gitignored): title `pwa: Settings › Reader lab, the Docs reader's phone checks on one page`; what ships; what the operator does (open, Start, one tap, select, send); what it never does (the design's section 7, short); desktop Chrome's block from Step 4 of Task 11; the expected CI (the PR's selection; `test (pwa)` in full; `browser (pwa)` gates in the merge queue); this plan's and the design's GitHub `blob/main` links; ending with the attribution line the dispatch gives.
- [ ] **Step 6: Public-repo scan** of every file changed since BASE and the drafted PR body, as Task 5 Step 6: rc 0, zero hits. Remove `$HOME/.cc-tmp/rlb-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: the reader lab page's results (docs reader lab)`, trailer. This commit is RL-b's `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open RL-b's ONE pull request with the scanned body.
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

Issued at each run's opening; refinements (a), (b) and (c) take RL-a's first three numbers, and (h), (i), (k), (m) and (u) RL-b's first five. (Task 5 Step 4 replaces RL-a's line, and Task 12 Step 4 RL-b's.)

- RL-a: placeholder.
- RL-b: placeholder.

## Where things stand

### Agreed
- The operator's ruling of 2026-11-03: build the reader lab page, as its own wave; W8b (the version menu and "changes since") stays after W5b.
- The operator's ruling of 2026-11-03: Mermaid draws on open, behind a library change this wave does not make; the lab measures what that change needs (the `busy-frame` fact, the `mermaid` line and the `draw on open:` reading).
- From the base, not a choice: the reader frame runs only the library's hash-pinned scripts, so every phone-side check runs in frames of its shape built by the lab, and the door is the only way to see what left a frame.
- The coordinator's rulings on review round 1 (2026-11-03), applied in rev 2: a run's life derived from its caps and a run that keeps its counts; the gate unchanged, its foreign-origin line documented and asserted; a run bound to its opener by a one-way digest; the door named a permanent surface, with Q5 rewritten; the busy frame a fact that never gates; the two-run split kept.
- The coordinator's proposals that fill silences, for approval with this plan: refinements (d) to (g), (j), (l), (n) to (p), (s), (t) and (v).

### Waiting on you
- **Q1 (refinement (a)): two runs, or one?** Round 1 changed nothing that moves the argument: every door fix (the owner, the life, the gate's text, the new server cases) stays in the server run, and every page fix in the page run. Recommended: two runs, the door first, so its security review stands alone and the page builds on a merged wire. One run changes only Tasks 5 and 12 (one close, one PR).
- **Q2 (refinement (q)): the stall budget.** Round 1 narrowed it: the budget now holds only the Mermaid line, which counts the six figures together and every mount that did not draw; the busy frame became a fact (shared thread or own thread, and how late the watchdog's stand-in timer fired) that gates nothing, since a deliberate 3 s spin on a shared thread can meet no budget. Recommended: 200 ms for the Mermaid line. The numbers are in the block whatever the budget; only the verdict word moves.
- **Q3 (refinement (i)): the CSP check's frame.** Round 1 tightened what "holds" needs: M8.B1's control floor (the control frame reaches at least 20 of the 26 channels a srcdoc frame can reach; `iframe` is left out by design) and the library's hostile mount reaching ready; either missing reads "not measured". Recommended: unchanged, the library's own policy plus the frame's script nonce and one exact canary URL, with the real library checked separately on hostile figures. The alternative is no CSP check on the phone at all, since the reader frame cannot run the battery.
- **Q4 (refinement (c)): the counter before the gate.** Round 1 added a disclosure: on an armed box the gate still writes its foreign-origin journal line for each lab frame's WebSocket upgrade, one or two per run; the gate's alarm is unchanged, Task 3's test asserts the line, and the page tells you these lines are expected. Recommended: yes; it decides nothing, and without it every WebSocket probe reads "not measured".
- **Q5 (refinements (b), (d)): is the door always registered, or only when a box setting is on?** Round 1 named the door for what it is: a permanent surface on every box, its probe pair under a permanent `EXEMPT` reason 8 on publicly reachable boxes too, inert until a signed-in session opens a run. It also bound each run to the session that opened it (a one-way digest of the session cookie), derived a run's life from the lab's own caps (about eighteen minutes at most; a test sums the caps), and made a run keep its counts once they are complete.
  - (a) Always registered, inert until a run opens. Cost: one exempt route pair on every box, reachable wherever the box is; with no run open a probe counts nothing and gets one empty `204`, so a scanner learns only that the path exists. Nothing to switch before a phone run; any updated box can be measured.
  - (b) Registered only when a box setting is on (an off-by-default `CCRC_*` value). Cost: a setting to document, ship, and flip on and back off around each phone run; a "door off" state on the page, since its "no door" sentence would then also mean "switched off"; the route and exemption censuses become conditional, which they do not express today, with a test for each state. With the setting off the surface is gone.
  - Recommended: (a), still held after these fixes: with no run open the door does nothing, and every property it has while a run is open is pinned by a test that goes red without its guard.
- **Q6 (refinements (m), (u)): one tap during the run.** Round 1 did not change the tap; it made the popup check's reading of a quiet block explicit (refinement (u)): a `top.location` write that returned without an error, while nothing reached its target, holds, and the line says "top navigation blocked without an error"; a missing report reads "not measured". Recommended: yes, one tap; without it a browser's popup blocker would answer for the sandbox.
- **Q7 (refinements (r), (l)): how the retirement gate reads the lab, and a Settings index row.** Round 1 changed the reading. E18 passes when the seven walls hold and the teardown signal holds ("differs from desktop" there is a miss to investigate, never a broken wall). E17 passes on the Mermaid line, held to the budget under the ruled draw-on-open mode; the busy frame is a fact and never a condition. A battery channel the control frame never sent counts as met only while the control floor holds and the block names it. The no-cookie row, and the spec's null-origin-write row (the server's own check, outside the lab), count only on a run against an armed box, which the block's door line names (`session cookie sent`); on a box with the gate dark they read "not applicable (READER_CSP is the wall)", and the gate is met from an armed box's run. Recommended: that reading, and no index row (the palette and the URL, as R19).

### Later
- The shared library's change that draws Mermaid after `ready`; it flips `LAB_GAP_WINDOW` to `'ready-and-settle'` (or ends the window at a drawn signal of its own), and the lab re-measures it.
- W8b, after W5b, with W8a's residue; its battery fixes build on the shared channel list.
- A run on every further phone or browser the operator reads on; each block is recorded in the programme ledger as E17 and E18 for that engine.
- A `FILE_MS` entry for the lab's browser file, with its `browser-leg.test.ts` census, if Task 11's measured time calls for one: a separate CI change.
- Playwright WebKit and Firefox as CI proxies for the batteries (the mockup's line): not in this wave. They are desktop builds of those engines, not a phone's, so a green proxy is not E18; they would add two browsers to the CI image and time to a leg CI balances across two 20-minute shards. Worth a separate CI change if an early warning between phone runs is wanted.
- The page stays after the retirement gate, as R19's does, for library bumps and new engines.
