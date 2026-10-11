# Native Docs reader, wave 4 — PWA foundation Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the PWA the foundation the Docs screen (W5) builds on, and harden chat with it, with no visible change beyond crash resilience. A golden test of today's chat output is committed BEFORE anything moves; `lib/markdown.tsx` is extracted from `MessageBubble.tsx` with chat byte-identical; `remarkAlerts` becomes iterative; the pure parse pipeline (pre-scan, `parseMarkdown`, its eight-arm `ParseOutcome`, the depth and element caps), a module worker and its runner (budget, terminate, respawn, two singletons), `renderHast` and `useParsedMarkdown` land; `CodeBlock` gains the 64 Ki-char highlight cap; chat is hardened per ruling U3 (the pre-scan in front of the sync path, the worker for messages over 4 KiB, the refusal of root-relative and protocol-relative image sources); `RenderBoundary` guards the root, the detail pane and each chat item; the router gains `useLocation` and `navigate(href, {replace})`; the build refuses a `CCRC_SW_DENYLIST` entry covering `/docs`, with its prose and tests; and `ccrc doctor` gains `docs-sw`, the measurement of the installed service worker.

**Architecture:** Nine new PWA files under `pwa/src/lib/` and one under `pwa/src/components/`. The worker side is pure and React-free: `markdownLimits.ts` (every PWA render limit, declared once), `markdownGuard.ts` (`prescanMarkdown`, `utf8ByteLength`), `remarkAlerts.ts` (iterative, explicit stack) and `markdownParse.ts` (`parseMarkdown(src, profile?)`: pre-scan, react-markdown's own processor called stage by stage, raw-to-text, one iterative walk that drops `position` and counts depth and elements; the worker protocol types and `answerMarkdownJob`). `markdownWorker.ts` is the module-worker entry over `answerMarkdownJob`. The main-thread side: `markdownRunner.ts` (`createMarkdownRunner({spawn, setTimer, clearTimer})`, one worker, a FIFO, a budget timer from post, terminate and lazy respawn, a sticky `worker-unavailable`, the two module singletons `docsRunner` and `chatRunner`), `renderHast.tsx` (react-markdown's `post()` minus the raw step, iterative, never mutating its tree), `useParsedMarkdown.ts` (one running and one queued job per hook, the queued one replaced, the last good tree kept) and `markdown.tsx` (the code moved out of `MessageBubble.tsx`, `CHAT_COMPONENTS`, `ChatMarkdown`, the chat image predicate and the chat note sentences). `components/RenderBoundary.tsx` is the one error-boundary class with its two screen fallbacks; `main.tsx` wraps `<App/>`, `app.tsx` wraps the detail ladder and moves to `useLocation` (scroll reset on `[path, search]`), `ChatList.tsx`'s `ChatItemView` wraps each item. `lib/sw-denylist.ts` imports L0's `DOCS_PAGE_PREFIX` and throws at config load on an entry covering it. `ccd/ccrc-doctor-checks` gains `_check_docs-sw` at its end and one table name in place, measured through fixture HOMEs whose box trees plant one shared default `sw.js`. W4 consumes exactly one W1 export (`DOCS_PAGE_PREFIX`) and edits nothing in `shared/`, `server/src/` or `agent/`. One W4 run: one worker, one reviewer.

**Tech Stack:** TypeScript 6 (pwa's own `tsc`: lib ES2023 + DOM with no WebWorker lib, `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`/`Parameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`), React 19, Vite 8.1 (`worker: { format: 'es' }`), vite-plugin-pwa 1.3 / workbox-build 7.4, vitest 4.1 on jsdom 28 (no `Worker` global, so every runner test injects `spawn`), react-markdown 10.1.0, remark-gfm 4.0.1, highlight.js 11.11.1. Five new DIRECT dependencies, already in the lockfile and pinned exactly: `unified` 11.0.5, `remark-parse` 11.0.0, `remark-rehype` 11.1.2, `hast-util-to-jsx-runtime` 2.3.6, `html-url-attributes` 3.0.1 (each MIT). Bash builtins and `jq` for the doctor check; server vitest for the doctor and parity tests.

**Spec:** `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` — §0 defect 3 and the U3 and `rollout` rows of the decision log; §1's two PWA units; §3.3; §3.10; §4.1's W4 file rows; §4.2 (the W4 half: `useLocation`, `usePath`, `navigate`, the scroll reset); §4.9; §4.10 (the pre-scan, the parse, the worker and runner, `renderHast`, the block highlight cap; not `DocMarkdown`); §4.12 (the root, detail and chat-item mounts and the chat clauses); §4.14 (the CSS rules that reach W4's own chrome); §4.15's M4.R1, M4.R3, M4.M1, M4.M2, M4.P1-P8, M4.P10-P12, M4.H1, M4.B1, M4.B3, M4.B4, M4.C1-C3; §7.2's `docs-sw` and fixtures paragraphs; §7.3; §7.7's W4 row; §7.9's every-wave and W4 suites; §7.10's M7.2, M7.3 (doctor half), M7.5, M7.6 (`docs-sw`), M7.9.

**Format:** Markdown, by the operator's ruling of 2026-10-07: plans stay Markdown in this programme and every other. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 12's scratch tools parse this file's `### Task` headings and its JSON fences.

## Global Constraints

- SAFETY: fixture HOMEs only. The doctor tests run `ccd/ccrc-doctor-checks` under `server/test/ccrc-doctor.test.ts`'s `healthy()` and the install/update fixtures, never against the live HOME. Never run `ccd` against the live HOME, never run a destructive ccd verb, never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units, never call the live ccrc server, never print a secret file's contents. Mutations and the build gate run in a scratch COPY of the tree (`git archive HEAD | tar -x -C <copy>`, `git -C <copy> init -q`, `pwa/node_modules` and `server/node_modules` linked in), never in the worktree.
- Scope. W4 creates `pwa/src/lib/{markdown.tsx,markdownLimits.ts,markdownGuard.ts,markdownParse.ts,markdownWorker.ts,markdownRunner.ts,renderHast.tsx,useParsedMarkdown.ts,remarkAlerts.ts}`, `pwa/src/components/RenderBoundary.tsx`, the PWA tests and fixtures in the File Structure table and `server/test/swFixtures.ts`; edits `pwa/src/session/MessageBubble.tsx`, `pwa/src/session/ChatList.tsx`, `pwa/src/session/chat.css`, `pwa/src/lib/router.ts`, `pwa/src/app.tsx`, `pwa/src/main.tsx`, `pwa/src/styles/shell.css`, `pwa/src/lib/sw-denylist.ts`, `pwa/vite.config.ts`, `pwa/package.json`, `pwa/package-lock.json` (root dependency list only), `pwa/design/audit.mjs`, `pwa/test/sw-denylist.test.ts`, `pwa/test/app-pane-reset-timing.test.tsx`, `pwa/test/tap-targets.test.tsx`, `deploy/deploy.sh` (two header comment lines, in place), `ccd/ccrc-doctor-checks` (one table line in place, one end-of-file append), `server/test/ccrc-doctor.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-install.test.ts` (`BASE_LIVE_SHAPE`'s three doctor maps and its docstring, inserted lines only), `server/test/docs-parity.test.ts` (end-of-file appends only) and this plan (Task 10 appends `## Deviations found`, Task 12 appends `## Wave 4 results`). It makes NO edit to `shared/` (W1's `shared/docs.ts` is consumed, never amended), `server/src/`, `agent/`, `ccd/ccd`, `ccd/ccrc`, `.github/`, `README.md`, `CLAUDE.md`, `server/test/single-definition.test.ts`, `pwa/test/message-links.test.tsx` (it must pass UNMODIFIED, §7.9) or `pwa/src/lib/api.ts`. No new stylesheet (`contrast.test.ts` pins the sheet list), no new package directory, no `ccd` verb, no unit, no `bin`.
- Base. The workspace branch is minted from `main` and must contain W1 and this plan; it need not contain W2 or W3 (§7.7: W4 depends only on W1). Task 1 Step 0 checks content, not ancestry: `grep -q "^export const DOCS_PAGE_PREFIX = '/docs';" shared/docs.ts && grep -q 'const mdComponents: Components' pwa/src/session/MessageBubble.tsx && test ! -e pwa/src/lib/markdown.tsx && test ! -e pwa/src/components/RenderBoundary.tsx && ! grep -q 'docs-sw' ccd/ccrc-doctor-checks && test -f docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`, and prints `git rev-parse HEAD` into the SDD ledger as the wave's base (`BASE`; the plan was written at `6fc7ef115d83d7a1b51009b9b12f70e68d2f8ca0`). If any check fails, stop and put an ask to the coordinator; never merge, rebase or pull inside a task.
- Order (§4.9): the golden test (Task 1) is committed against the UNCHANGED `MessageBubble.tsx` before any extraction; the extraction (Task 2) leaves every golden file byte-identical; chat hardening (§4.9's "commit 3") is Tasks 3-6, in that order. From Task 1's commit to the tip, no golden file changes (Task 12's invariant).
- Rings, by imports. `markdownLimits.ts`, `markdownGuard.ts`, `remarkAlerts.ts`, `markdownParse.ts` and `markdownWorker.ts` (the worker's import closure) import no `react`, no `react-dom`, no `highlight.js`, no `../session/*`, no `./api`, no stylesheet and no DOM global; their allowed specifiers are each other, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and type-only `hast`/`mdast`. Task 3's purity test pins it through TypeScript's own `ts.preProcessFile` over the closure (not a regex). `renderHast.tsx` is a pure function: no hook, no DOM access, no module state, and it never mutates its input tree (W5's Export reuses it). No overloaded `null` at a seam: every `null` or optional in a W4 signature has exactly one stated meaning.
- Exact values, copied from the spec (§4.9's table; tests import them, nothing restates them):
  - `MD_MAX_CONTAINER_DEPTH` = 32; `MD_MAX_DELIMITER_RUN` = 64; `MD_MAX_TREE_DEPTH` = 64; `DOCS_MAX_RENDER_ELEMENTS` = 20 000 (element nodes in a parsed tree, both profiles); `MD_HIGHLIGHT_BLOCK_MAX_CHARS` = 65 536; `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` = 524 288; `DOCS_PARSE_BUDGET_MS` = `min(10 000, 2 000 + 1 000 x floor(bytes / 65 536))` (bytes are UTF-8 bytes); `DOCS_PARSE_BUDGET_LARGE_MS` = 30 000; `DOCS_RENDER_GATE_BYTES` = 524 288; `CHAT_SYNC_MAX_BYTES` = 4 096; `CHAT_PARSE_BUDGET_MS` = 2 000. `DOCS_MAX_IMAGES_PER_PAGE` and `DOCS_STALE_MS` stay in `shared/docs.ts` and W4 does not import them (`single-definition.test.ts` holds both to that file).
  - Pre-scan (§4.10): `prescanMarkdown(src): {ok:true} | {ok:false; why:'container-depth' | 'delimiter-run'; line; value}`; one iterative pass over lines, skipping fenced blocks (a fence of 3+ backticks or tildes at up to 3 spaces, closed by the same character at least as long); container depth per line: repeatedly skip up to 3 spaces, then consume `>` (plus one optional space) or a list marker (`-`, `+`, `*`, or 1-9 digits then `.` or `)`, followed by space or tab); over 32 refuses; the longest run of `*` or of `_` over 64 refuses.
  - `ParseOutcome`, verbatim: `{ kind: 'tree'; tree: HastRoot; depth: number } | { kind: 'refused'; why: 'container-depth' | 'delimiter-run'; line: number; value: number } | { kind: 'too-deep'; depth: number } | { kind: 'too-wide'; elements: number } | { kind: 'threw'; error: string } | { kind: 'timeout'; budgetMs: number } | { kind: 'worker-unavailable' } | { kind: 'worker-failed'; error: string }` (`threw` carries `error.name` only; the last three come from the runner only).
  - Parse steps: (1) pre-scan, `refused` ends here; (2) `unified().use(remarkParse).use([remarkGfm, remarkAlerts]).use(remarkRehype, {allowDangerousHtml: true})`, then `runSync(parse(src))`; (3) each `raw` node becomes a `text` node, iteratively (raw HTML renders as literal text; `skipHtml` is not used); (4) drop `position`, compute depth and element count in one iterative walk: over `MD_MAX_TREE_DEPTH` gives `too-deep`, over `DOCS_MAX_RENDER_ELEMENTS` gives `too-wide`; (5) any exception gives `threw`.
  - Worker protocol `{id, src, profile}` in, `{id, outcome}` out; the worker wraps both the parse and the post (a `DataCloneError` becomes `threw`). `defaultSpawn = () => new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' })`, spelled literally so Vite's static analysis emits the chunk; no `Worker`, or a throw from `spawn`, is a sticky `worker-unavailable`; one worker, one job posted at a time, FIFO behind it; the budget timer starts at post; on the timer: `terminate()`, resolve `timeout`, respawn lazily; an `error`/`messageerror` event: `worker-failed`, drop, respawn on the next job; an abort while queued removes the job, while running terminates and respawns; a result whose `id` is not the running job's is ignored; two module singletons, `docsRunner` and `chatRunner`.
  - `renderHast(tree, {components, urlTransform?})`: when `urlTransform` is given (chat passes react-markdown's `defaultUrlTransform`) it is applied to each `html-url-attributes` key as `post()` does; then `toJsxRuntime(tree, {Fragment, jsx, jsxs, components, ignoreInvalidStyle: true, passKeys: true, passNode: true})`.
  - Highlighting: `CodeBlock` highlights only when the language is registered, `highlight !== false`, and the block is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`; an over-cap block labels itself `{label} · not highlighted ({KiB} KiB)`.
  - Chat (U3 = (b), §4.12): (1) `prescanMarkdown` in front of the synchronous path, a refusal renders `<pre className="msg-plain">`; (2) messages at most `CHAT_SYNC_MAX_BYTES` (UTF-8) render exactly as today, `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>`; (3) longer messages parse through `chatRunner` with a 2 s budget: `msg-plain` until the first outcome, then the last good tree while newer streaming text parses (at most one running and one queued job per hook, the queued one replaced); a tree renders through `renderHast(tree, {components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform})`, byte-identical to the sync path; any other outcome renders `msg-plain` with a one-line note; no Format-anyway in chat; the streaming caret stays after the body; (4) chat `img`, and the image-URL auto-embed in chat `a`, refuse a root-relative or protocol-relative `src` and render the URL as a plain link; everything else `message-links.test.tsx` pins is unchanged.
  - `RenderBoundary` (§4.12): a class with `getDerivedStateFromError`, a `resetKey` prop reset through `getDerivedStateFromProps`, `componentDidCatch` logging `console.warn('ccrc: render error in ' + where, error)`, and a `fallback(error)` prop. Mounts: `main.tsx` around `<App/>`, constant key, "ccrc could not draw this screen." + Reload; `app.tsx` around the detail ladder, key `path + search`, "This screen could not be shown." + Back to the fleet (sidebar, login overlay and toasts survive); `ChatItemView` per item, key the message text (a message) or the item key (any other kind), a message falls back to `<pre className="msg-plain">` + "could not render", any other item to "This item could not be shown.".
  - Router (§4.2): `export interface Loc { readonly path: string; readonly search: string }` (search includes `?`, or `''`); `useLocation()` exactly as §4.2 writes it (`useState` + `popstate`, never `useSyncExternalStore`); `usePath()` is `useLocation().path`; `navigate(href, opts?: { replace?: boolean })`, where replace uses `replaceState`; the scroll reset's dependencies become `[path, search]`.
  - Service worker (§7.3): `swDenylist(extra)` imports `DOCS_PAGE_PREFIX` from `'../../../shared/docs'` and throws on any NORMALISED entry equal to it or under it, with exactly "CCRC_SW_DENYLIST entry <p> covers /docs, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again." (`<p>` is the normalised entry). Only the Docs prefix is refused; `/docs` is never added to the worker's own list (C5). `vite.config.ts`'s `navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST']),` line stays byte-identical (`sw-denylist.test.ts` pins it).
  - `docs-sw` (§7.2, server half): role `fleet` SKIP; the worker at `$BOX_TREE_DIR/server/dist-pwa/sw.js`, absent or unreadable FAIL with remedy `ccrc update --force`; the shape check (exactly one `denylist:[`) else WARN "this check knows the shape workbox emits" with the remedy to hard-reload `/docs/` in a browser and check that the Docs screen renders; an entry equal to or under the prefix FAILs "the installed service worker refuses the app shell to /docs; Docs pages break on a hard load and offline", remedy "remove /docs from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update"; `/docsy` passes; otherwise PASS. Verdicts only through `_dr_pass/_dr_warn/_dr_fail/_dr_skip`; the prefix is the file's ONE `CCRC_DOCS_PAGE_PREFIX='/docs'`, interpolated into every message (so the file holds one such literal); `HEALTHY_SKIPS` does not move.
  - The five dependencies (§4.1): `"unified": "11.0.5"`, `"remark-parse": "11.0.0"`, `"remark-rehype": "11.1.2"`, `"hast-util-to-jsx-runtime": "2.3.6"`, `"html-url-attributes": "3.0.1"`, exact strings (no caret), in `pwa/package.json`'s `dependencies`; `pwa/package-lock.json` changes ONLY in `packages[""].dependencies`, judged NET against `BASE` (refinement (p)).
- Never spelled by W4 (each is held by an existing scan or a later wave's row): a second declaration of any `shared/docs.ts` name (import `DOCS_PAGE_PREFIX`, never redeclare: `docs-parity.test.ts`'s M7.3 TS half); a seven-day literal (`single-definition.test.ts`); `URL.createObjectURL(` (W6's M5.16 allows it only in two other files); `addEventListener('message'` in any `lib/markdown*` file (the runner and worker assign `onmessage`; refinement (w)); the standalone docs server's name or its directory name in any new text (M7.9; the needles in Task 9's scan are built from parts); a real host, user, project, pool or account name (`topology-clean` reads every blob since `origin/main`, so EVERY W4 commit must be clean: fixtures use `example.com`, `example-org/example-repo`, `203.0.113.x`, projects `demo`, `a`, `b`, branches `main`, `ws/a`); a raw NUL or control byte in any fixture (`source-bytes`; write `\u0000`-style escapes and inspect a written fixture with `od -c`, because an agent write decodes backslash-u escapes); a GNU-only spelling in the doctor file (`macos-platform.test.ts`: no bare `timeout N`, `stat -c`, `date -d`, `sha256sum`, even inside a message); a `D-` number anywhere but `## Deviations found`.
- Locate every edit by content. Line numbers in this plan are hints measured at `BASE`; every Find block must match the tree as the PREVIOUS task left it and be unique in it. If a Find block is absent or not unique, stop and put an ask to the coordinator, never guess. When a later task re-spells code that an earlier task's mutation row anchors on, the later task re-anchors that row in its own rows block (same id, new `old`) and says so; Task 12's extractor keeps an id's LAST occurrence in task order.
- File-shape invariants are judged NET against `BASE`, never commit by commit (W2's lesson): `server/test/docs-parity.test.ts` changes only by end-of-file appends (its header says "W4 appends M7.3's doctor half. APPEND ONLY."); `ccd/ccrc-doctor-checks` by exactly one in-place line (the table's last line gains `docs-sw`) plus one end-of-file append; `server/test/ccrc-doctor.test.ts` by edits inside `healthy()`, one import (with its two-line comment) after `import { PRELOADS, preloadOptions } from './historyHelpers.js';` in the file's mid-file import block, in-place numeral edits on re-derived count lines and one end-of-file append, with no line above `healthy()`'s first line changed (other files cite it by line); `server/test/ccrc-install.test.ts` and `server/test/ccrc-update.test.ts` by inserted lines only, none removed or changed (Task 12's `insert-only`); `deploy/deploy.sh` by two in-place lines, same line count, its `export CCRC_SW_DENYLIST=` line byte-identical; `pwa/src/lib/sw-denylist.ts`'s header comment and docstring, and `pwa/vite.config.ts`'s co-tenant comment, keep their line counts (§7.3: "edited in place, with its line count unchanged").
- Counts are re-derived, never copied (lesson 7): every count this plan quotes from another file (`HEALTHY_SKIPS`-based summary pins, the doctor's fleet-role skip counts, the number of registered hljs grammars, test totals, the precache entry count, the ten largest docs) is measured at the step that relies on it. Other programmes move them; what binds is that each case this plan adds is red before its code and green after, and every pre-existing case in a touched file stays as green as it was at `BASE`.
- Text-scan guards (lesson 8): a W4 scan is either built on a real parser (the worker-closure purity scan uses `ts.preProcessFile`; the limits-declared-once scan uses `ts.createSourceFile`) or it lists its known evasions in its own comment as "not exhaustive" (the M7.3 doctor-half line count and the M7.9 name scan, which read raw text on purpose: a name in a comment counts).
- Test hygiene: `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`, in the FOREGROUND, Bash timeout 600000 ms; never background, never bare `npx vitest`; split `ccrc-doctor.test.ts`, `ccrc-install.test.ts`, `ccrc-install-graphify.test.ts` and `ccrc-update.test.ts` with `-t` (each can exceed one 600 s call alone under load). Run `git fetch -q origin main` before `deviation-refs` and `topology-clean`. Known load flakes (`typecheck-tests` among them, and `contrast.test.ts`'s spawned-gate cases, which time out at 5 s on a loaded box) are re-run in isolation before being called broken. Never run the PWA suite with `CCRC_SW_DENYLIST` covering `/docs` in the environment: after Task 9 the vite config, which vitest also loads, refuses it and every PWA test file dies at config load.
- Mutation-table discipline (binding, lesson 9): every guard a task adds (a limit, a refusal, a fence rule, a timer, an id check, a boundary mount, a dependency in an effect, a predicate clause, a doctor arm, a scan) ships with a case that goes red when the guard is deleted or mutated, measured in the scratch copy at that task's state. Each task lists its rows (`W4-T<n>-M<k>`: `pkg`, `file`, `old`, `new`, `tests`, `red`) in one JSON fence after a `**Mutation rows this task contributes**` line; Task 12 runs the whole table at the wave's end state. Where no fixture can reach a branch, record `D-TBD-<slug>` in the task's report and say so; no such placeholder lands in a commit (`dtbd.test.ts`).
- Deviations. Four of the refinements below depart from the binding spec's TEXT rather than fill a silence, so each is a deviation with an allocator-issued number: (a) the W4 rows written against W5 artefacts are proved by their W4 half, on W4 stand-ins, and their W5 half moves to W5's brief; (b) M4.M1's "change plugin order" is an equivalent mutant and is replaced by two that go red; (c) `docs-sw` counts `denylist:[` occurrences with bash builtins, not `grep -c`; (d) `docs-sw` SKIPs on either of `update-exposure`'s two fleet evidences, not the recorded role alone. The coordinator mints a block of at least four numbers at run-open (`POST /api/ledger/deviations`) and names it in the brief. Task 10 Step 8 (the ONE step that defines them) writes `## Deviations found` at the end of this plan with the block's first four numbers, in that order. The rest of the block serves departures found while executing or in a fix round; a departure found before Task 10 Step 8 waits in the SDD ledger until that step, and one found after it is defined where it is found, each reported to the coordinator first when it changes behaviour the spec states. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports. This plan's text spells no `D-` number, and no task types one it was not issued. The plan's own departures are four, and wherever this plan or its brief states that count, it is four. A departure the operator rules before dispatch (for example, an answer to the open question on chat image sources, refinement (k)) is not one of them: the brief names the ruling, and Task 10 Step 8's `<n5>` paragraph defines it after the four from the block's next number, like a departure the SDD ledger holds, so no count sentence in this plan changes for it.
- Open PRs that touch W4's files (measured at planning; re-check at dispatch): #111 edits the hljs registration W4 moves (it would make the grammar count 15); #152 edits `MessageBubble.tsx`'s import block and `ClipThumbs`, and appends to `message-links.test.tsx`; #191 edits `ChatList.tsx` below `ChatItemView`; #189 inserts a doctor table line and a check mid-file. None is merged into the branch by a task; if one lands on `main` before Task 12, the PR-time conflict is the coordinator's ruling, and the golden corpus's language list, re-derived from `hljs.listLanguages()`, is never hand-edited to match.
- Commits: one per task (Task 11's fix wave may make one per finding), files staged by name, message `<area>: <what> (docs W4)` (Task 11's review-fix commits end `(docs W4 review)` instead, as W3's did; Task 12's base detection keys on the first `(docs W4)` subject and its commit count accepts both endings), ending with the `Co-Authored-By:` trailer the dispatch names (the model that wrote the commit; the commit blocks below spell the implementers' `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, which is used unless the dispatch names another, for example Opus 5.5 for a commit the main loop writes itself). Commits go on the workspace branch, never a separate feature branch (a feature branch wedges the close with `stale-tip`). Only Task 12 pushes, and it opens the wave's ONE pull request.
- Carried into W4, each handled or deferred here:
  - Ledger: "Its `ccd/ccrc-doctor-checks` edit waits on whichever claim holds that file (claim 1072, run 302)": run 302 merged as #315; the claim state is re-measured at dispatch and again in Task 10 Step 0 (How this wave runs).
  - Ledger: "`GithubTarget` cannot express `resolveDocRef`'s `repo` kind": no W4 code consumes either; DEFERRED to W5 with `DocLink`, its consumer. Chat's image predicate does not call `resolveDocRef` (it needs a `{section, path}` origin that chat does not have).
  - Spec §4.14 lists `.msg-plain` among the registrations of the W5 pass; W4 renders it, so W4 styles it (refinement (n)) and W5's M4.S1 registers only the docs chrome.
  - W6's M5.16 ("no `postMessage(` and no `'message'` listener in `pwa/src/docs` or `lib/markdown*`") is red against `markdownWorker.ts` and `markdownRunner.ts` the day it lands: CARRIED to W6 and to the Share/Export spec amendment, which already edits M5.16 (refinement (w)); W4 does not edit spec text.
  - W7 prose residue gains: `pwa/src/lib/api.ts`'s comment naming `MessageBubble`'s `absolute()`; `server/test/sourceScan.ts`'s header counts measured on `MessageBubble.tsx`; README's doctor table and server-role SKIP sentence, which name neither `docs` nor `docs-sw`; README's two `CCRC_SW_DENYLIST` paragraphs and CLAUDE.md's knob mention; the spec's stale citations listed under refinement (s).

## How this wave runs (coordinator)

- This plan reaches `main` BEFORE the run opens, through the programme's ledger PR (as W2's and W3's did), so the child workspace minted from `main` holds it: Tasks 10, 11 and 12 read and append to it on the branch, and Task 12's PR body links its `blob/main` path. Task 1 Step 0 checks `test -f` on it.
- One run row for W4, opened by the programme's coordinator (`ccrc-coordinator` skill) through `POST /api/runs`, with no `sessionId`, so a fresh child workspace is minted from `main` at or after `6fc7ef115d83d7a1b51009b9b12f70e68d2f8ca0`. W4 depends only on W1 (§7.7), and W3 has merged, so the two waves share no open work. At run-open the coordinator mints the deviation block (`POST /api/ledger/deviations`, at least four numbers for refinements (a), (b), (c), (d), plus a reserve) and names it in the brief; Task 10 Step 8 is the one step that defines the first four.
- Claims are checked at dispatch and again before each task that edits a shared file. W4's shared files: `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/docs-parity.test.ts`, `deploy/deploy.sh`, `pwa/src/session/MessageBubble.tsx`, `pwa/src/session/ChatList.tsx`, `pwa/src/session/chat.css`, `pwa/src/app.tsx`, `pwa/src/main.tsx`, `pwa/src/lib/router.ts`, `pwa/src/styles/shell.css`, `pwa/design/audit.mjs`, `pwa/test/tap-targets.test.tsx`, `pwa/test/app-pane-reset-timing.test.tsx`, `pwa/package.json`, `pwa/package-lock.json`, `pwa/vite.config.ts`, `pwa/src/lib/sw-denylist.ts` and `pwa/test/sw-denylist.test.ts`. The coordinator lists open claims on them before dispatch; the worker claims each again in the Step 0 of the task that edits it, and edits a file another run holds only after that claim ends or the two coordinators confirm a scoped agreement by mail (each side edits only its own lines; the second to merge takes `main` and keeps both). The ledger's note on claim 1072 is re-measured, not assumed ended.
- Dispatch: one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-12, the base, the issued block, the claim state, and the branch-discipline sentence. Routing: Opus main loop, `sonnet` implementers, an `opus` per-task reviewer, the whole-branch panel on `opus` (Task 11), workflows off.
- The worker acks, runs the tasks with native subagents (never Fable), puts questions to the operator as structured asks, and lists mail before its wave-done. Task 11 is the held-out whole-branch review and its fix wave: it runs after the last implementation task (Task 10) and BEFORE the close. Task 12 closes: it runs the suites, the census-free invariants, the build gate and the whole mutation table, appends `## Wave 4 results` (that commit is the `handoffCommit` and the tip), pushes the workspace branch, opens the wave's ONE pull request, measures the fingerprint with that PR's number and `prPhase: 'open'`, and sends the wave-done. CI runs while the review reads; the `package.json` change makes PR CI run the full server suite by design (§7.9).
- Review: on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run reading the branch at one measured tip in its own worktree. Its brief names the panel's Lenses line: (1) chat unchanged by the extraction (the golden, `M4.P10`'s parity, the worker closure's purity, `message-links` unmodified); (2) untrusted Markdown (the pre-scan, the depth and element caps, raw HTML as text, the highlight cap, the chat image predicate); (3) the worker and runner (budget, terminate, respawn, stale ids, abort, the two singletons, the hook's one-running-one-queued); (4) boundaries and the router (each mount, `resetKey`, the fallbacks, the scroll reset, replace); (5) build, deploy and doctor (the refusal and its prose, `docs-sw` and its fixtures, the lockfile's net diff) plus mutation-table discipline and spec conformance (every W4 row and M-case in Task 12's table). Copy the wave-done and the review report into `.superpowers/` on receipt. Open a review run only when its dispatch can follow at once (the ledger's 2026-10-09 lesson). The coordinator rules; a fix round is a scoped re-review; the merge is the coordinator's after the review rules clean.
- After the merge, NOT in this wave: the merge becomes a prerelease. Rollout is optional (§7.7's W4 row): phones update with no visible change beyond crash resilience. When the boxes next move through ccrc's own update mechanism (the operator's act, fleet first), the server box's closing doctor runs `docs-sw` for the first time; on a release-lane box it PASSes on the default bundle. On a box built by `deploy.sh` with `/docs` in `CCRC_SW_DENYLIST`, the build now refuses: the operator's one act is removing `/docs` from their own `~/.ccrc/deploy.env` (§7.3); ccrc never edits it. W5's brief inherits the W5 halves Task 12 records (refinement (a)), the M5.16 carry goes to W6 and the Share/Export amendment, and the W7 residue above to W7.

## Review Focus

The five inputs a person using this will meet first, each pinned in the task that owns it:

1. **An assistant message built to crash or freeze the renderer.** 10 000 nested `>` and 4 000 in chat, a 4 096-run of `*`, nested emphasis 100 deep, 90 000 `hr`s or autolinks under 512 KiB, `<img src=x onerror=alert(1)>` and `<script>x</script>`, a 70 000-char `ts` block, a streaming answer crossing 4 KiB. Each gives `refused`, `too-deep`, `too-wide`, literal text or an unhighlighted block, never a stack overflow, a frozen tab or live markup, and chat shows `msg-plain` with its note. Pinned by T3 (M4.P1-P4, M4.P12), T4 (M4.P5, M4.H1) and T6 (M4.C1, M4.C2).
2. **A message whose image points back at ccrc's own origin.** `![](/api/example/x)`, `![](//h.example/x.png)`, `![](\\h.example/x.png)`, a tab- or space-prefixed `//`, and a bare `/x.png` link the auto-embed would draw; each renders as a plain link with no `<img>`, while every `https` image and link case `message-links.test.tsx` pins stays green unmodified. Pinned by T6 (M4.C3).
3. **A worker that is missing, slow, crashed or stale.** No `Worker` global, a `spawn` that throws, a job that never answers, an `error` or `messageerror` event, a result for an older job, an abort while queued or running, a 30 s docs job beside a chat job. Each gives its own outcome (`worker-unavailable`, `timeout` at the budget with one `terminate`, `worker-failed` then a respawn), never a hang, and chat is never delayed by docs. Pinned by T5 (M4.P6-P8, M4.P11) and T6.
4. **A screen, a message or the whole app that throws while rendering, and a URL that changes only its query.** A throwing detail screen keeps `.shell-nav` with "This screen could not be shown." until the route changes; a throwing middle message shows its raw text between two good ones; a throwing `App` shows Reload; `?ref=a` to `?ref=b` on one path re-renders and resets the pane's scroll. Pinned by T7 (M4.R1, M4.R3) and T8 (M4.B1, M4.B3, M4.B4).
5. **An operator's build or installed bundle that would break Docs.** `CCRC_SW_DENYLIST` of `/docs`, `docs`, ` /docs/ `, `/docs/x` or `/wiki,/docs` fails the build with the §7.3 sentence while `/docsy` and `/docs-archive` build; an installed `sw.js` that denies `/docs` or `/docs/x` FAILs `docs-sw`, an unexpected shape WARNs, a missing bundle FAILs, a fleet box SKIPs. Pinned by T9 (M7.2, M7.9) and T10 (M7.3, M7.5, M7.6).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `pwa/test/markdownCorpus.ts` | T1 | The chat corpus, one named case per entry, each at most 4 096 UTF-8 bytes and carrying no root- or protocol-relative image; shared by the golden (T1) and the parity row (T4). |
| `pwa/test/markdown-golden.test.tsx`, `pwa/test/golden/markdown/*.html` | T1 | M4.M1: `renderToStaticMarkup(<MessageBubble/>)` per case, plus the opened `FoldedCard` recap through RTL, against stored file snapshots generated at `BASE`. Never edited after T1. |
| `pwa/src/lib/remarkAlerts.ts`, `pwa/test/remark-alerts.test.ts` | T2 | The iterative plugin; M4.M2 against the recursive walk kept in the test as the oracle. |
| `pwa/src/lib/markdown.tsx` | T2, T4, T6 | T2: the code moved out of `MessageBubble.tsx` (`IMG_EXT`, `isImageUrl`, `absolute`, `openExternal`, hljs registration, `LANG_LABEL`, `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, `SHARED_COMPONENTS`, `CHAT_COMPONENTS`, a sync `ChatMarkdown`). T4: `CodeBlock`'s `highlight` prop and cap. T6: the hardened `ChatMarkdown`, `isRefusedChatImageSrc`, `chatPlainNote`, the image refusal in `CHAT_COMPONENTS`. |
| `pwa/src/session/MessageBubble.tsx` | T2 | Imports from `lib/markdown.tsx`; both Markdown sites become `<ChatMarkdown text={...} />`; keeps `linkify`, `timeOf`, `MessageEvent`, `FoldedCard`, `ClipThumbs`. |
| `pwa/src/lib/markdownLimits.ts`, `pwa/test/markdown-limits.test.ts` | T3 | Every PWA render limit, declared once (TS-AST scan over `pwa/src` and `shared`). |
| `pwa/src/lib/markdownGuard.ts`, `pwa/test/markdown-guard.test.ts` | T3 | `prescanMarkdown`, `utf8ByteLength`; M4.P1 (refusal), M4.P2, M4.P3. |
| `pwa/src/lib/markdownParse.ts`, `pwa/test/markdown-parse.test.ts` | T3, T5 | T3: `parseMarkdown`, `parseWithoutPrescan`, `ParseOutcome`, `MarkdownProfile`; M4.P1's control, M4.P4, M4.P12. T5: the worker protocol types and `answerMarkdownJob`. |
| `pwa/test/markdown-purity.test.ts` | T3, T5 | The worker closure imports nothing React, DOM or hljs (`ts.preProcessFile`); T5 adds `markdownWorker.ts` to its roots. |
| `pwa/package.json`, `pwa/package-lock.json` | T3 | The five exact direct dependencies; the lock's `packages[""].dependencies` only. |
| `pwa/src/lib/renderHast.tsx`, `pwa/test/render-hast.test.tsx` | T4 | `renderHast`; M4.P5, M4.P10. |
| `pwa/test/markdown-highlight.test.tsx` | T4 | M4.H1 and the cap's boundary. (Not `code-block.test.tsx`, which open PR #111 creates.) |
| `pwa/src/lib/markdownWorker.ts`, `pwa/src/lib/markdownRunner.ts`, `pwa/test/markdown-worker.test.ts`, `pwa/test/markdown-runner.test.ts` | T5 | The worker entry and the runner; M4.P6, M4.P7, M4.P8, M4.P11. |
| `pwa/vite.config.ts` | T5, T9 | T5: `worker: { format: 'es' }`. T9: the co-tenant comment in place. |
| `pwa/src/lib/useParsedMarkdown.ts`, `pwa/test/use-parsed-markdown.test.tsx` | T6 | The shared async hook. |
| `pwa/test/chat-hardening.test.tsx` | T6 | M4.C1, M4.C2, M4.C3, the chat notes, the crossing at 4 096 / 4 097 bytes. |
| `pwa/src/session/chat.css`, `pwa/design/audit.mjs` | T2, T6 | T2: two comments re-pointed to `lib/markdown.tsx` by symbol. T6: `.msg-plain` (no colour) and `.msg-plain-note` (registered in `INHERITED_GROUNDS`). |
| `pwa/src/lib/router.ts`, `pwa/test/router-location.test.tsx` | T7 | `Loc`, `useLocation`, `usePath`, `navigate(href, {replace})`; M4.R1's W4 half. |
| `pwa/src/app.tsx` | T7, T8 | T7: `useLocation`, the scroll reset on `[path, search]`. T8: the detail-ladder boundary. |
| `pwa/test/app-pane-reset-timing.test.tsx` | T7 | M4.R3 appended. |
| `pwa/src/components/RenderBoundary.tsx`, `pwa/test/render-boundary.test.tsx` | T8 | The boundary class, `RootFallback`, `ScreenFallback`. |
| `pwa/src/main.tsx`, `pwa/test/root-boundary.test.tsx` | T8 | The root mount; M4.B4 through `main.tsx` itself. |
| `pwa/test/app-detail-boundary.test.tsx` | T8 | M4.B1 on a mocked throwing `RunsScreen`. |
| `pwa/src/session/ChatList.tsx`, `pwa/test/chat-item-boundary.test.tsx` | T8 | The per-item boundary in `ChatItemView`; M4.B3. |
| `pwa/src/styles/shell.css`, `pwa/test/tap-targets.test.tsx` | T8 | `.render-fallback` (self-grounded, beside `.block-screen`); the fallback buttons' two tap-target halves. |
| `pwa/src/lib/sw-denylist.ts`, `pwa/test/sw-denylist.test.ts` | T9 | The refusal and the in-place prose; M7.2; the `/docs` examples become `/wiki`. |
| `deploy/deploy.sh` | T9 | Header lines 28 and 41, in place. |
| `server/test/docs-parity.test.ts` | T9, T10 | End-of-file appends: T9 M7.9; T10 M7.3's doctor half. |
| `ccd/ccrc-doctor-checks` | T10 | `docs-sw` on the table's last line, in place; `CCRC_DOCS_PAGE_PREFIX` and `_check_docs-sw` appended at the end. |
| `server/test/swFixtures.ts`, `server/test/ccrc-doctor.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-install.test.ts` | T10 | One default `sw.js` text, planted by `healthy()`, `TREE_STUBS` and the update test's tree; the `docs-sw` describe appended (M7.5, M7.6); the fleet-role pins re-derived in place; `ccrc-install.test.ts`'s `BASE_LIVE_SHAPE` re-measured in place (each of its three doctor maps gains `"docs-sw": "SKIP"`). |
| `docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md` | T10, T12 | T10 Step 8: `## Deviations found`. T12: `## Wave 4 results`. |

## Spec refinements (decided while planning)

These refine the spec where it is silent, stale, or could be built two ways. Each is applied in the task named; W7's prose pass carries the spec text into line with them. Four of them, (a), (b), (c) and (d), contradict the spec's TEXT rather than fill a silence: they are deviations, which Task 10 Step 8 defines with issued numbers (Global Constraints, "Deviations"), and the text here is the rationale those entries carry.

- **(a) Rows written against W5 artefacts are proved by their W4 half** (T3, T5, T7, T8). Six W4 rows name a W5 component in their Test column. W4 proves each guard on a W4 stand-in and Task 12 records the remaining half, verbatim, for W5's brief: M4.R1 (W4: a probe on `useLocation` re-renders for `navigate('/docs/p?ref=a')` then `?ref=b`; W5: "injected `loaders.tree` called with ref `b`"); M4.B1 (W4: a mocked throwing `RunsScreen` at `/runs` keeps `.shell-nav` with the fallback, and navigating resets it; W5: the same at `/docs` with `DocsScreen`); M4.P1 (W4: the refusal, its control, and chat's note; W5: `DocMarkdown`'s note); M4.P6 (W4: the runner honours a 30 000 `budgetMs`; W5: "Format anyway posts a 30 000 job"); M4.P7 (W4: `spawn` throws gives a sticky `worker-unavailable`, and chat's 4 KiB sync and 5 KiB note; W5: `DocMarkdown`'s in-thread 4 KiB and 5 KiB note); M4.P12 (W4: `parseMarkdown` gives `too-wide` for both fixtures and a tree for a real 500 KiB prose doc; W5: "the `renderHast` spy has 0 calls" and the doc "still renders"). Stubbing `DocsScreen` or `DocMarkdown` in W4 would pre-empt W5. **A deviation** from §7.7's W4 row and §4.15's Test column for those six rows: Task 10 Step 8 defines it.
- **(b) M4.M1's "change plugin order" is an equivalent mutant** (T1, T2). `remark-gfm` 4.0.1 registers only micromark and mdast extensions and returns no transformer (measured in the installed `remark-gfm/lib/index.js`), so `[remarkAlerts, remarkGfm]` renders byte-identically to `[remarkGfm, remarkAlerts]` and can never go red. M4.M1's rows use "drop `remarkAlerts` from the list" and "drop `remarkGfm` from the list" in its place, beside the spec's other two mutations (drop an alias; edit `CHAT_COMPONENTS.a`); Task 1 measures the swap once and records it as equivalent. **A deviation** from §4.15's M4.M1 mutation column: Task 10 Step 8 defines it.
- **(c) `docs-sw` counts occurrences, with bash builtins** (T10). §7.2 step 3's `grep -c 'denylist:\['` counts LINES, and workbox emits `sw.js` as one minified line, so "two denylists: WARN" (M7.5) could never fire; and the doctor's test PATH holds no `grep` (the file uses builtins and `jq` only, `_check_docs`'s own comment). The check reads the file with `$(<"$sw")`, counts occurrences by parameter-expansion length arithmetic, extracts the list between `denylist:[` and the next `]}`, and tests each entry with bash's own ERE (`[[ =~ ]]`) built from `CCRC_DOCS_PAGE_PREFIX`. Every verdict §7.2 and M7.5 state holds. **A deviation** from §7.2 step 3's text: Task 10 Step 8 defines it.
- **(d) `docs-sw`'s fleet SKIP uses both fleet evidences** (T10). §7.2 takes the role from `_box_env_value "$BOX_ENV_FILE" CCRC_ROLE` alone; a fleet host with no `ccrc.env` (one carrying `agent.env`, as `ccrc-doctor.test.ts`'s env-less fleet fixture models) would then run the check and FAIL on a bundle it never had. `_check_docs-sw` SKIPs on either of `_check_update-exposure`'s two evidences: a recorded `CCRC_ROLE=fleet`, or `ccrc-agent.service` present with no `ccrc.service` in `$CCRC_UNIT_DIR`. A `server` or `both` box, and a box with no evidence, runs the check. **A deviation** from §7.2's role sentence: Task 10 Step 8 defines it.
- **(e) The golden mechanism** (T1). The PWA has no snapshot or fixture convention (measured: no `toMatchSnapshot`, no `__snapshots__`). Task 1 uses vitest's `toMatchFileSnapshot` into `pwa/test/golden/markdown/<case>.html` (a missing file is written only outside CI, so CI cannot pass vacuously), generated by the first run against the UNCHANGED `MessageBubble.tsx` and committed with the test. `renderToStaticMarkup(<MessageBubble/>)` is deterministic under jsdom (measured: two renders equal). The corpus covers every grammar `hljs.listLanguages()` returns at `BASE` (re-derived, 14 at planning) plus the `registerAliases` names (`zsh`, `shell`, `tsx`, `html`, `svg`) and the grammars' own aliases (`sh`, `ts`, `js`, `jsx`, `mjs`, `py`, `yml`, `md`, `docker`, `golang`, `rs`, `jsonc`), an unregistered tag (`text`, `mermaid`, `console`) and no tag, callouts of all five kinds including nested and an emptied lead paragraph, kbd chips, inline code, a GFM table, a task list, strikethrough, a footnote, `https` images, `https`, scheme-less and `mailto` links, bare URLs, raw HTML (`<img src=x onerror=alert(1)>`, `<script>x</script>`, `<server-host>`) and the streaming caret. `FoldedCard`'s Markdown body renders only when open, so its case uses RTL, a click, and the container's `innerHTML`. Every case is at most 4 096 UTF-8 bytes and has no root- or protocol-relative image, so Tasks 2-8 may not move a golden file.
- **(f) `profile` labels, it does not branch** (T3, T5). §4.10 passes `profile` through the parse, the protocol and the runner but gives it no behaviour, and every limit applies to "both profiles". `export type MarkdownProfile = 'chat' | 'docs'`; `parseMarkdown(src, profile = 'chat')` (M4.P10 calls it with one argument); the pipeline is identical for both, pinned by a case that deep-equals the two profiles' outcomes over the corpus, so a later divergence is deliberate.
- **(g) Names the spec uses and never defines** (T3, T5, T6). `DOCS_PARSE_BUDGET_MS` keeps its name as an exported arrow `(bytes: number) => number`; `utf8ByteLength(s)` counts UTF-8 bytes without allocating (lone surrogates count 3, as `TextEncoder` encodes U+FFFD) and lives in `markdownGuard.ts`; `parseWithoutPrescan(src)` runs steps 2-5 for M4.P1's control; the worker protocol (`MarkdownJob`, `MarkdownReply`) and `answerMarkdownJob(data, post)` live in `markdownParse.ts` so tests never import the worker entry, whose top level assigns `self.onmessage`; `MarkdownParser` is the type of `runner.parse`; `useParsedMarkdown(text, parser, {profile, budgetMs, attempt?})` returns `{outcome, lastGood, pending}`, and a changed `budgetMs` or `attempt` parses again (W5's Format anyway and Retry need nothing more).
- **(h) An aborted or disposed job rejects with an `AbortError`** (T5). §4.10 says what abort does to the queue and the worker, not what the caller receives. The caller's promise rejects with the signal's reason (or a `DOMException('disposed', 'AbortError')` from `dispose()`), so `ParseOutcome` keeps exactly its eight arms and no arm is overloaded with "nobody is waiting".
- **(i) Chat's sync/async split** (T6). Bytes are `utf8ByteLength(text)`; at most 4 096 is sync, 4 097 and up goes to `chatRunner`. `ChatMarkdown` chooses between two inner components so each calls its hooks unconditionally; crossing the threshold while streaming remounts the async one (no hysteresis, no cache across remounts: the one-frame `msg-plain` at the crossing and on a virtualised remount is accepted and recorded). Render order for the async arm: the latest settled `tree`; else, while a job is pending, the last good tree; else, after a non-tree outcome for the current text, `msg-plain` with its note; else (nothing settled yet) `msg-plain` alone. `FoldedCard`'s recap goes through `ChatMarkdown` too (§4.9), so an opened recap over 4 KiB takes the worker. `ChatMarkdown` takes no `streaming` prop: the caret stays a sibling after it inside `.msg-assist`. Its `parser` prop defaults to a call that reads `chatRunner.parse` at call time, so a test spies it with `vi.spyOn(chatRunner, 'parse')`.
- **(j) Chat's notes** (T6). §4.12 says "a one-line note" and gives no sentence; `chatPlainNote(outcome)` is exhaustive over the seven non-tree kinds plus the pre-scan refusal: `Shown as plain text: line {line} nests {value} levels deep (limit 32).`; `Shown as plain text: line {line} has a run of {value} emphasis marks (limit 64).`; `Shown as plain text: this message nests {depth} levels deep (limit 64).`; `Shown as plain text: this message would draw {elements} elements (limit 20000).`; `Shown as plain text: it could not be formatted ({error}).`; `Shown as plain text: formatting took longer than {s} s.`; `Shown as plain text: this browser cannot format long messages in the background.`; `Shown as plain text: the formatter stopped ({error}).` (limits interpolated from `markdownLimits.ts`). The item boundary's message note is `This message could not render; shown as plain text.`. DOM order is the `<pre className="msg-plain">` first, then `<p className="msg-plain-note">`.
- **(k) The chat image predicate is the URL parser's own reading** (T6). One function, `isRefusedChatImageSrc(src)`, used by both `img` and the auto-embed in `a`: strip leading and trailing ASCII whitespace and C0 controls (as a browser does for an attribute URL), then refuse when the remainder starts with `/` or `\`; a browser's URL parser reads `\` as `/`, so this is exactly "root-relative or protocol-relative" as the browser resolves it (`/api/x`, `//h/x`, `\\h/x`, `/\h/x`, a tab before `//`). It runs on the value after react-markdown's `defaultUrlTransform`. A refused `img` renders the chat's ordinary external link (`<a href target="_blank" rel="noopener noreferrer">` through `openExternal`) whose text is the URL as written; a refused auto-embed renders the `a` branch's ordinary link. A path-relative `src` such as `../api/x`, which resolves to `/api/x` from `/s/<id>`, is NOT refused here: widening (for example to absolute http(s) sources only) is an open operator question. No task asks it or applies it, Task 12 carries it under "Carried, not fixed", and a ruling changes `isRefusedChatImageSrc` alone (plus its table cases in `chat-hardening.test.tsx`).
- **(l) The highlight label** (T4). The cap compares `raw.length` (characters, after the existing trailing-newline strip) with 65 536: 65 536 is highlighted, 65 537 is not. `{KiB}` is `Math.ceil(raw.length / 1024)`, so 70 000 characters reads `TypeScript · not highlighted (69 KiB)`, with U+00B7 as the separator. `highlight?: boolean` defaults to highlighting; W4 never passes `false` (the page budget that does is W5's `detachUrls`).
- **(m) The boundary's shape** (T8). Props `{ where: string; resetKey: string | number; fallback: (error: unknown) => ReactNode; children?: ReactNode }`; state `{ failed: boolean; error: unknown; key: string | number }`, so a thrown `undefined` still shows the fallback (no overloaded null). `RootFallback({reload = () => location.reload()})` and `ScreenFallback()` (Back to the fleet is `navigate('/')`) are exported beside the class; the chat item's fallbacks stay in `ChatList.tsx`. `where` is `'root'`, `'detail'` or `'chat item'`. The detail boundary wraps the ladder's ternary INSIDE `<section className="shell-detail">`, so W5 adds its arm inside it. M4.B4 runs `main.tsx` itself: the test plants `#root`, mocks `virtual:pwa-register` and `../src/app`, and imports `../src/main`.
- **(n) CSS for W4's own chrome** (T6, T8). §4.14 says the new chrome is registered in `design/audit.mjs` "GROUNDS ... following `.settings-*`"; those entries live in `INHERITED_GROUNDS`, so that is the map. `.msg-plain` (in `session/chat.css`) sets no colour: it sits in `.msg-assist pre`'s already measured well and only resets `max-height`, `white-space` and `overflow-wrap`. `.msg-plain-note` sets `color: var(--ink-secondary)` and is registered in `INHERITED_GROUNDS` on `var(--bg-page)` with a `why`, as `.settings-back` is. `.render-fallback` lives in `styles/shell.css` beside `.block-screen` and paints its own `background: var(--bg-page)` and `color: var(--ink-primary)`, so it is self-grounded; its buttons are `.btn-primary` (already `min-height: var(--tap-min)`), and `tap-targets.test.tsx` gains both halves for them. No new stylesheet. W5's M4.S1 registers only the docs chrome.
- **(o) Router details** (T7). A replace rides the same view-transition and `flushSync` path as a push; only the history call differs. An `href` carrying `#` is outside `navigate`'s contract (§4.11's fragment links make no history entry).
- **(p) The lockfile edit is the root list alone** (T3). Regenerating the lock adds the five entries AND two fields the lock's root lacks today, `license` and `engines` (measured). The task edits `packages[""].dependencies` only (the five keys, exact versions, in the file's order) and proves it twice in a scratch copy: a JSON diff against `BASE` that names exactly those five keys, and a clean `npm ci`. Licence census: there is no third-party allowlist in the tree; each of the five is MIT in the lock and the task records that; `license.test.ts`, `oss-metadata.test.ts` and `node-floor.test.ts` run unchanged.
- **(q) Hast types** (T3). `import type { Root as HastRoot } from 'hast'` resolves through `@types/hast`, a declared dependency of `hast-util-to-jsx-runtime` (a direct dependency from T3); the five-dependency list stays as the spec gives it, and `tsc` proves the import.
- **(r) The build gate is a measured step** (T5, T12). §7.7's gate ("the worker chunk is emitted and precached") is run in Task 12 on a scratch build: the emitted `server/dist-pwa/assets/markdownWorker-<hash>.js`, its `url:"assets/markdownWorker-..."` entry in `server/dist-pwa/sw.js` (§4.10 says `dist-pwa/sw.js`; the build's `outDir` is `../server/dist-pwa`), exactly one `denylist:[`, and the precache entry count up by the new chunks. No CI step is added (a `.github/` edit is outside W4's box); Task 5's source pin keeps the `new Worker(new URL(...))` expression literal so the build can see it.
- **(s) Doctor placement and stale citations** (T10). §7.2's "appended ... after `models`" predates `codex`, `docs` and `history`: the table's last line is `models codex docs history`, whose comment says every later line is cited by number, so `docs-sw` joins that line in place (its comment's count word updated) and `CCRC_DOCS_PAGE_PREFIX='/docs'` plus `_check_docs-sw` are appended at the end of the file, the convention `_check_model-default` follows. §7.2's citations of the two ruling comments (`ccd/ccrc:3412-3421`, `ccd/ccrc-doctor-checks:4612-4627`) have drifted; M7.9 locates them by anchor sentence. §4.10's `react-markdown/lib/index.js:123` is the options constant (the processor is at `:262-276`, `post` at `:313`).
- **(t) Every fixture that runs the closing doctor plants the bundle** (T10). §7.2 names `healthy()`; `installTreeFixture.ts`'s `TREE_STUBS` and `ccrc-update.test.ts`'s own tree also run the real table (measured: without a `sw.js`, 28 cases of `ccrc-install-graphify` and about 19 of `ccrc-install` red). One helper, `server/test/swFixtures.ts`, holds the default text in the single-line shape a real build emits (`denylist:[/^\/api\//,/^\/ws\//]`), and all three import it. The fleet-role summary pins that gain a SKIP are re-derived in place, and so is `ccrc-install.test.ts`'s live-shape golden `BASE_LIVE_SHAPE`, which names every table check: each of its three doctor maps gains `docs-sw`'s verdict.
- **(u) `deploy.sh`'s second `/docs` sentence** (T9). §7.3 lists the header examples (line 28); line 41's "their co-tenant at /docs starts answering ..." also names `/docs` as a co-tenant and is rewritten in place too (both above the cited `:508-648` corpus).
- **(v) M7.9's two needles** (T9). The directory-name needle may appear only inside the two ruling comments (located by their anchor sentences); the generic name the old `sw-denylist.ts` comment uses may appear nowhere in `pwa/src` and, beyond §7.10's text, nowhere in `pwa/vite.config.ts` either (its comment carried the same word). Both needles are built from parts in the test, so the test never spells them whole.
- **(w) The worker files and W6's M5.16** (T5). `markdownWorker.ts` and `markdownRunner.ts` must contain `postMessage(`, and receive messages by assigning `onmessage` (never `addEventListener('message'`); no other `lib/markdown*` file contains either. M5.16's text is not edited here; the conflict is carried.
- **(x) Where W4's scans live** (T3, T9, T10). The worker-closure purity scan and the limits-declared-once scan are PWA tests on TypeScript's parser; M7.3's doctor half and M7.9 append to `docs-parity.test.ts`, whose header reserves them. `single-definition.test.ts` is not edited.
- **(y) Not in W4** (pre-empting W5 and W6, or the operator's open Share and Export decisions, is out of scope): `DocsScreen`, `DocMarkdown`, `DocLink`, `DocImage`, `detachUrls`, `DOC_COMPONENTS`, the page highlight budget, the `docs` route arm and `data-view` entry, `api.docs.*`, `docs.css`, any `markdown.css` split, any Share or Export code, type or wording, and any edit to `shared/docs.ts`.
- **(z) §4.9's "commit 3" is several commits** (T3-T6). The order holds (golden, then extraction, then hardening); one commit per task.

### Task 1: The golden test of chat's output, committed against today's MessageBubble before anything moves

**Model routing:** `sonnet`, effort `high` — a test-only task, but the one every later task is measured against: the golden files must be generated against the UNCHANGED `MessageBubble.tsx`, the corpus must stay inside the two bounds that keep every file still through the wave, and a CI run must never be able to pass by writing a missing file. Measured on the shared scratch tree at `BASE` (no earlier W4 task).

**Spec rows:** M4.M1 ("Chat unchanged by extraction": `markdown-golden.test.tsx`, committed before the extraction, `renderToStaticMarkup(MessageBubble)` over a corpus of callouts incl. nested, code in every registered language and alias, kbd, tables, task lists, images, links, bare URLs and raw HTML, equal to stored snapshots), with refinement (e) (the mechanism, the corpus, the FoldedCard site through RTL) and the measurement refinement (b) asks of this task (the plugin-order swap is an equivalent mutant). Section 4.9's order: this is commit 1; Task 2's extraction is commit 2 and must leave every file this task writes byte-identical, and so must Tasks 3-8.

**Files:**
- Create: `pwa/test/markdownCorpus.ts` — 290 lines: `CorpusCase`, `CHAT_ALIAS_TAGS`, `CHAT_UNREGISTERED_TAGS`, `languageCases`, `CHAT_CORPUS` (20 cases), `RECAP_CASE`, and the module-private `padToBytes`. Task 4's parity row imports it; nothing else declares a case.
- Create: `pwa/test/markdown-golden.test.tsx` — 110 lines: the golden (one case per corpus entry and per fence tag, plus the opened recap), four vacuity cases, and the two corpus bounds per case. Never edited after this task.
- Create (generated by Step 3, never hand-written): `pwa/test/golden/markdown/<name>.html`, one per case. At planning (`hljs.listLanguages()` = 14 grammars) that is 55 files: `at-sync-limit`, `callout-emptied-lead`, `callout-nested`, `callouts-all-kinds`, `code-no-tag`, `emphasis-runs`, `empty`, `entities-and-escapes`, `gfm-footnote`, `gfm-strikethrough`, `gfm-table`, `gfm-task-list`, `images-https`, `inline-code`, `kbd-chips`, `lang-bash`, `lang-console`, `lang-css`, `lang-diff`, `lang-docker`, `lang-dockerfile`, `lang-go`, `lang-golang`, `lang-html`, `lang-javascript`, `lang-js`, `lang-json`, `lang-jsonc`, `lang-jsx`, `lang-markdown`, `lang-md`, `lang-mermaid`, `lang-mjs`, `lang-py`, `lang-python`, `lang-rs`, `lang-rust`, `lang-sh`, `lang-shell`, `lang-sql`, `lang-svg`, `lang-text`, `lang-ts`, `lang-tsx`, `lang-typescript`, `lang-xml`, `lang-yaml`, `lang-yml`, `lang-zsh`, `links`, `prose-inline`, `raw-html`, `recap-opened`, `streaming-caret`, `unicode`. The count is `G + 41` for `G` registered grammars (20 corpus cases, 17 alias tags, 3 unregistered tags, the recap), re-derived by Step 3's own output, never copied.
- Test: `pwa/test/markdown-golden.test.tsx`; guards `pwa/test/message-links.test.tsx` and `pwa/test/chat.test.tsx` (unmodified, the chat neighbours), the PWA `tsc`, `server/test/typecheck-tests.test.ts`, `server/test/source-bytes.test.ts`, `server/test/topology-clean.test.ts` (both read every tracked file, the golden files included) and `server/test/single-definition.test.ts`.

This task edits no existing file, so it has no Find block and claims nothing (no shared file is touched).

**Interfaces:**
- Consumes (all unchanged at `BASE`): `MessageBubble` from `../src/session/MessageBubble` (`{ event: MessageEvent; id: string; streaming?: boolean }`; importing it registers the hljs grammars and aliases as a module side effect); `renderToStaticMarkup` from `react-dom/server`; `render`, `fireEvent`, `screen`, `cleanup` from `@testing-library/react`; `hljs` from `highlight.js/lib/core` (the same module instance `MessageBubble` registers on: `listLanguages()`, `getLanguage(tag)`); `node:fs`'s `existsSync`/`readdirSync` and `node:path` with `import.meta.dirname` (the PWA tests' own idiom; `fileURLToPath(new URL(..., import.meta.url))` throws "The URL must be of scheme file" under jsdom, measured).
- Produces, in `pwa/test/markdownCorpus.ts`:
  - `export interface CorpusCase { readonly name: string; readonly text: string; readonly streaming?: boolean }` — `name` is a file-safe slug (`/^[a-z0-9-]+$/`) and the golden file's basename; `streaming` absent means no caret.
  - `export const CHAT_ALIAS_TAGS: readonly string[]` — the 17 fence tags refinement (e) names that resolve through an alias: `zsh`, `shell`, `tsx`, `html`, `svg`, `sh`, `ts`, `js`, `jsx`, `mjs`, `py`, `yml`, `md`, `docker`, `golang`, `rs`, `jsonc`.
  - `export const CHAT_UNREGISTERED_TAGS: readonly string[]` — `text`, `mermaid`, `console`.
  - `export function languageCases(langs: readonly string[]): CorpusCase[]` — one case `lang-<tag>` per tag: a lead line and one fenced block over a fixed multi-token body.
  - `export const CHAT_CORPUS: readonly CorpusCase[]` — the 20 named cases: `empty`, `prose-inline`, `emphasis-runs`, `entities-and-escapes`, `unicode`, `callouts-all-kinds`, `callout-nested`, `callout-emptied-lead`, `kbd-chips`, `inline-code`, `code-no-tag`, `gfm-table`, `gfm-task-list`, `gfm-strikethrough`, `gfm-footnote`, `images-https`, `links`, `raw-html`, `streaming-caret` (`streaming: true`), `at-sync-limit` (exactly 4 096 UTF-8 bytes).
  - `export const RECAP_CASE: CorpusCase` — `recap-opened`, a text `COMPACTION_RE` matches, whose body carries a callout, a GFM table with strikethrough and a `ts` fence, so both plugins and the components reach the FoldedCard site.
- The golden test composes the language tags as `[...new Set([...hljs.listLanguages().sort(), ...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS])]`. Task 4's parity row reuses exactly that composition.

**Decisions this task makes (refinement (e) applied; none departs from the spec's text):**
1. **File snapshots, written only outside CI.** `toMatchFileSnapshot('./golden/markdown/<name>.html')`, one file per case, compared byte for byte. vitest writes a missing file snapshot only when it is not in CI (`CI` set means update mode `none`), so a CI run with a file missing fails instead of passing vacuously (Measured 1). Nobody runs this file with `-u`; a golden file that must change is a reviewer's ruling, not a flag.
2. **The language list is measured, the alias lists are declared.** The grammar names come from `hljs.listLanguages()` after `MessageBubble` registered them (14 at planning; open PR #111 would make it 15, and the golden then gains `lang-php` by measurement, never by a hand edit). The alias and unregistered tags are this file's declared corpus, checked against hljs both ways: every grammar and alias tag must resolve, every unregistered tag must not.
3. **A dropped grammar reds by its orphaned file.** `toMatchFileSnapshot` never notices a case that disappears, so `every stored golden file belongs to a case` lists `test/golden/markdown/*.html` and requires each basename to be a case. vitest writes new file snapshots when the test FILE ends, after every `it` ran (Measured 2), so on the one run that generates them the directory does not exist yet: the check then reads no files, and under CI every snapshot case has already failed for its missing file.
4. **The image bound reads the rendered DOM, not the Markdown.** For each case the rendered markup is parsed by jsdom and every `img`'s `src` is checked after trimming leading code units up to U+0020 (as a browser trims an attribute URL) for a leading `/` or `\`. No Markdown spelling (inline, reference, angle-bracket destination, a bare image URL the `a` component embeds) can hide a source from it, so it needs no list of evasions. The byte bound uses `TextEncoder`, the literal `4096` (CHAT_SYNC_MAX_BYTES, which Task 3 declares; this file imports nothing W4 creates).
5. **The recap goes through the DOM.** FoldedCard renders its Markdown body only once opened, which `renderToStaticMarkup` cannot reach, so the recap case renders with RTL, clicks `Context compacted`, asserts `.compaction-body.msg-assist` exists and stores `container.innerHTML` (the whole opened card).
6. **Placeholders only.** `example.com`, `h.example`, `203.0.113.7`, `someone@example.com`, `<server-host>`; no raw control byte anywhere (the trim in Decision 4 is a `charCodeAt` loop, so the source spells no escape an agent write could decode, Measured 5).

**Measured while planning** (the shared scratch tree at `BASE`; the mutations in a separate copy):
1. **RED is the CI run with no golden file**: `Snapshots  55 failed`, `Tests  55 failed | 114 passed (169)`, each failure reading `Snapshot` + the case's full name + `mismatched`. The 114 that pass are the four vacuity cases (the orphan check reads no directory) and the 110 bound cases.
2. **Generation, outside CI**: `Snapshots  55 written`, `Tests  169 passed (169)`; the files appear when the test file ends. **GREEN under CI** afterwards: `Tests  169 passed (169)` with no `Snapshots` line, and nothing written. Two renders of the corpus are byte-identical (`two renders of the corpus are byte-identical`).
3. **Equivalent mutants, recorded and not rows.** (i) Refinement (b): swapping `[remarkGfm, remarkAlerts]` to `[remarkAlerts, remarkGfm]` at BOTH sites leaves `Tests  169 passed (169)`: `remark-gfm` 4.0.1's `remarkGfm` (`node_modules/remark-gfm/lib/index.js`) registers micromark and mdast extensions and returns no transformer, so the order cannot change a byte. (ii) The architecture's "drop the `tsx` alias" is equivalent too, and so are dropping `html`/`svg` and dropping `zsh`: hljs 11.11.1's own grammars already declare them (`typescript` aliases `ts`, `tsx`, `mts`, `cts`; `xml` aliases include `html` and `svg`; `bash` aliases `sh`, `zsh`), so each of those `registerAliases` entries is redundant and its removal leaves `169 passed (169)`. The one alias only `MessageBubble` provides is `shell`, so W4-T1-M3 drops it.
4. **A backslash written in a Markdown destination never reaches `src` as a backslash**: micromark percent-encodes it (`![i](\\\\h.example/x.png)` renders `src="%5C%5Ch.example/x.png"`), while `//h.example/x.png` and `</x.png>` reach `src` as written. Decision 4's DOM check is therefore exact for what chat can draw today; W4-T1-M11 and W4-T1-M12 plant the two shapes that do reach it.
5. **Escapes.** An agent write decoded a backslash-u escape for U+0020 inside a regex into a literal space on the first draft; the trim is written as a `charCodeAt` loop instead. `od -c` of `raw-html.html` and `at-sync-limit.html` shows only printable bytes and `\n`; a scan for bytes 0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f over the two sources and the 55 files finds none.
6. **Guards**: PWA `tsc` clean; `message-links` + `chat` `Tests  69 passed (69)`; `source-bytes` + `topology-clean` `Tests  57 passed (57)` (with `CCRC_HISTORY_BASE` at the base in the scratch tree, which has no `origin/main`; a worktree runs `git fetch -q origin main` instead); `single-definition` `Tests  523 passed (523)` (its roots do not include `pwa/test`; the count is re-measured at `BASE`, never copied); `typecheck-tests` green on its three PWA cases (`pwa/ is clean under tsconfig.json` compiles both new files), with `server/test/ is clean` and `agent/test/ is clean` red ONLY because the scratch tree had no `agent/node_modules` (`Cannot find module 'ws'`), an environment red a worktree with installed modules does not have. A worktree must show `Tests  12 passed (12)`; there, any red is not environmental.
7. **Mutations**: twelve, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, `git -C <copy> init -q`, `pwa/node_modules` linked in), run WITHOUT `CI` like any other suite, restored after each; `git status --porcelain` in the copy was empty after every one (no mutant wrote a golden file: each changes an existing case's output or removes a case, none adds a name). M1-M9 are anchored on `MessageBubble.tsx` at `BASE`; Task 2 moves that code into `lib/markdown.tsx` and re-anchors M1-M9 under the same ids. M10-M12 are anchored on the corpus, which no later task edits.

| id | mutation | red (G = 14) |
|---|---|---|
| W4-T1-M1 | the assistant site's plugin list drops `remarkAlerts` | 3 failed | 166 passed (169), Snapshots 3 failed |
| W4-T1-M2 | the assistant site's plugin list drops `remarkGfm` | 5 failed | 164 passed (169), Snapshots 5 failed |
| W4-T1-M3 | the bash alias line drops `shell` (an alias no grammar declares) | 2 failed | 167 passed (169), Snapshots 1 failed |
| W4-T1-M4 | `bash` dropped from the registration | 5 failed | 161 passed (166), Snapshots 3 failed |
| W4-T1-M5 | `mdComponents.a`'s plain link loses `noreferrer` | 2 failed | 167 passed (169), Snapshots 2 failed |
| W4-T1-M6 | the `img` component loses `loading="lazy"` | 1 failed | 168 passed (169), Snapshots 1 failed |
| W4-T1-M7 | the `a` component's image auto-embed loses `loading="lazy"` | 1 failed | 168 passed (169), Snapshots 1 failed |
| W4-T1-M8 | the streaming caret removed | 1 failed | 168 passed (169), Snapshots 1 failed |
| W4-T1-M9 | the FoldedCard site's plugin list drops `remarkAlerts` | 1 failed | 168 passed (169), Snapshots 1 failed |
| W4-T1-M10 | the corpus's `at-sync-limit` case padded to 4 097 bytes | 2 failed | 167 passed (169), Snapshots 1 failed |
| W4-T1-M11 | a corpus image becomes root-relative (`/api/example/chart.png`) | 2 failed | 167 passed (169), Snapshots 1 failed |
| W4-T1-M12 | a corpus image becomes protocol-relative (`//h.example/icon.webp`) | 2 failed | 167 passed (169), Snapshots 1 failed |

- [ ] **Step 0: Check the base.** Foreground.

Run: `for p in server pwa agent; do if [ -L "$p/node_modules" ]; then rm -- "$p/node_modules"; fi; [ -d "$p/node_modules" ] || ( cd "$p" && npm ci --no-audit --no-fund ) || echo "install failed: $p"; done` (foreground, Bash timeout 600000 ms).
Expected: no `install failed` line. `typecheck-tests` compiles `agent/` and the PWA suites need `pwa/node_modules`, and a child workspace may have installed `server/` alone. A linked `node_modules` is unlinked first (a plain `rm` of the link, never `-r`), because `npm ci` empties the directory it finds, which through a link is another tree's.

Run: `grep -q "^export const DOCS_PAGE_PREFIX = '/docs';" shared/docs.ts && grep -q 'const mdComponents: Components' pwa/src/session/MessageBubble.tsx && test ! -e pwa/src/lib/markdown.tsx && test ! -e pwa/src/components/RenderBoundary.tsx && ! grep -q 'docs-sw' ccd/ccrc-doctor-checks && test -f docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md && test ! -e pwa/test/markdownCorpus.ts && test ! -e pwa/test/markdown-golden.test.tsx && test ! -e pwa/test/golden && git diff --quiet HEAD -- pwa/src/session/MessageBubble.tsx && echo T1-BASE-OK && git rev-parse HEAD`
Expected: `T1-BASE-OK`, then a 40-hex sha. Record that sha in this run's SDD ledger as `BASE`: every later task's "net against `BASE`" invariant and Task 12's lockfile and golden checks diff against it. If `T1-BASE-OK` does not print, stop and put an ask to the coordinator (a missing W1, an extraction already started, a doctor check already present, or the plan not on the branch); never merge, rebase or pull to make it pass.

Run: `env | grep -E '^(CI|GITHUB_ACTIONS)=' || echo NO-CI-ENV`
Expected: `NO-CI-ENV`. Step 3 forces the variable off with `env -u CI -u GITHUB_ACTIONS` anyway; this only tells you which mode a bare run is in.

- [ ] **Step 1: Write the corpus and the failing golden.** Create `pwa/test/markdownCorpus.ts` with exactly this content:

````ts
// The chat Markdown corpus (native Docs reader, W4 Task 1; design 2026-10-01 section 4.9 and section 4.15's M4.M1,
// the W4 plan's refinement (e)). One named case per entry. `markdown-golden.test.tsx` renders every case through
// today's `MessageBubble` and holds the output to a stored file under `test/golden/markdown/<name>.html`; Task 4's
// parity row renders the same cases through the pipeline. Both read this file, and nothing else declares a case.
//
// Two bounds keep every golden file still through the whole wave, and the golden test asserts both on each case:
//   - every `text` is at most 4 096 UTF-8 bytes (CHAT_SYNC_MAX_BYTES, which Task 3 declares), so Task 6's split
//     keeps every case on the synchronous path that renders exactly as today;
//   - no case draws an `<img>` whose source is root-relative or protocol-relative, which Task 6 refuses.
// Placeholders only: example.com, 203.0.113.7, `<server-host>`. No raw control byte (source-bytes.test.ts).

export interface CorpusCase {
  /** A file-safe slug: the golden file is `test/golden/markdown/<name>.html`. */
  readonly name: string;
  readonly text: string;
  /** Renders the assistant turn with the streaming caret after its body. */
  readonly streaming?: boolean;
}

/** Fence tags that `MessageBubble` resolves through an alias rather than a grammar's own name: the three
 *  `registerAliases` calls (`zsh`, `shell`, `tsx`, `html`, `svg`) and the grammars' built-in aliases. The grammar
 *  names themselves are not listed here: the golden measures them with `hljs.listLanguages()`. */
export const CHAT_ALIAS_TAGS: readonly string[] = [
  'zsh', 'shell', 'tsx', 'html', 'svg',
  'sh', 'ts', 'js', 'jsx', 'mjs', 'py', 'yml', 'md', 'docker', 'golang', 'rs', 'jsonc',
];

/** Fence tags no registered grammar answers: the block renders unhighlighted, labelled with the raw tag. */
export const CHAT_UNREGISTERED_TAGS: readonly string[] = ['text', 'mermaid', 'console'];

/** One fenced block for each tag, over a body with a keyword, a string, a number, a comment, markup and a query,
 *  so every grammar emits some tokens. */
export function languageCases(langs: readonly string[]): CorpusCase[] {
  return langs.map((lang) => ({
    name: `lang-${lang}`,
    text: [
      `A ${lang} block:`,
      '',
      '```' + lang,
      'const greeting = "hello"; // say it',
      'if (count > 1) { return [1, 2, 3]; }',
      '<div class="note">text &amp; more</div>',
      'SELECT id FROM t WHERE n = 2;',
      '- item: true',
      '```',
      '',
    ].join('\n'),
  }));
}

/** `text` padded with ASCII to exactly `bytes` UTF-8 bytes (it must not already exceed them). */
function padToBytes(text: string, bytes: number): string {
  const have = new TextEncoder().encode(text).length;
  return have >= bytes ? text : text + 'x'.repeat(bytes - have);
}

export const CHAT_CORPUS: readonly CorpusCase[] = [
  {
    name: 'empty',
    text: '',
  },
  {
    name: 'prose-inline',
    text: [
      '# Heading one',
      '## Heading two',
      '### Heading three',
      '',
      'Plain prose with **bold**, *italic*, ***both***, `inline code` and a line  ',
      'break, then a soft',
      'wrap.',
      '',
      '---',
      '',
      '1. first',
      '2. second',
      '   - nested bullet',
      '   - another',
      '',
      '* star list',
      '+ plus list',
      '',
      '> a plain quote, not an alert',
      '',
    ].join('\n'),
  },
  {
    name: 'emphasis-runs',
    text: '**strong** __also strong__ *em* _em_ ***strong em*** ********** a run of ten, and \\*escaped\\* stars.',
  },
  {
    name: 'entities-and-escapes',
    text: 'Ampersand &amp; copyright &copy; numeric &#169; hex &#xA9; and a literal \\# hash, \\[bracket\\], \\`tick\\`.',
  },
  {
    name: 'unicode',
    text: 'Accents: café, naïve. CJK: 漢字かな. Emoji: 🚀✅. Arrows: ← → ↑ ↓. Math: ≤ ≥ ≠ ∞.',
  },
  {
    name: 'callouts-all-kinds',
    text: [
      '> [!NOTE]',
      '> A note with **bold**.',
      '',
      '> [!TIP]',
      '> A tip.',
      '',
      '> [!IMPORTANT]',
      '> Important text.',
      '',
      '> [!WARNING]',
      '> A warning.',
      '',
      '> [!CAUTION]',
      '> Caution, with `code`.',
      '',
      '> [!note]',
      '> Lower case still tags.',
      '',
      '> [!FOO]',
      '> Not an alert kind: a plain quote.',
      '',
    ].join('\n'),
  },
  {
    name: 'callout-nested',
    text: [
      '> [!NOTE]',
      '> Outer note.',
      '>',
      '> > [!WARNING]',
      '> > Inner warning.',
      '> >',
      '> > > [!TIP]',
      '> > > Innermost tip.',
      '',
      '> Plain outer quote.',
      '>',
      '> > [!CAUTION]',
      '> > An alert inside a plain quote.',
      '',
      '- a list item',
      '',
      '  > [!IMPORTANT]',
      '  > An alert inside a list item.',
      '',
    ].join('\n'),
  },
  {
    name: 'callout-emptied-lead',
    text: [
      '> [!TIP]',
      '>',
      '> The marker paragraph empties and is dropped; this paragraph stays.',
      '',
      '> [!WARNING] **bold right after the marker**',
      '',
      '> [!CAUTION]',
      '',
      '> [!NOTE]   ',
      '> trailing spaces after the marker',
      '',
    ].join('\n'),
  },
  {
    name: 'kbd-chips',
    text: 'Press `Cmd+K`, then `Esc`, or `Ctrl + Shift + P`, or `⌘+K`, or `F5`, or `Alt+F4`. A lone `a` stays a chip; `Ctrl+Foo` and `npm ci` are code.',
  },
  {
    name: 'inline-code',
    text: 'Run `npm ci` in `pwa/`, then `` a `tick` inside `` and `<b>not bold</b>`.',
  },
  {
    name: 'code-no-tag',
    text: [
      'A fence with no tag:',
      '',
      '```',
      'plain text block',
      '  keeps its indent',
      '```',
      '',
      'A tilde fence:',
      '',
      '~~~',
      'tilde fenced',
      '~~~',
      '',
      'An indented block:',
      '',
      '    indented code',
      '    second line',
      '',
    ].join('\n'),
  },
  {
    name: 'gfm-table',
    text: [
      '| left | centre | right |',
      '|:-----|:------:|------:|',
      '| a | **b** | `c` |',
      '| 1 | 2 | 3 |',
      '',
    ].join('\n'),
  },
  {
    name: 'gfm-task-list',
    text: ['- [ ] open task', '- [x] done task', '- plain item', ''].join('\n'),
  },
  {
    name: 'gfm-strikethrough',
    text: 'This is ~~gone~~ and ~single~ tilde.',
  },
  {
    name: 'gfm-footnote',
    text: ['A claim with a footnote.[^1]', '', '[^1]: The footnote text.', ''].join('\n'),
  },
  {
    name: 'images-https',
    text: [
      '![a chart](https://example.com/chart.png)',
      '',
      '![](https://example.com/plain.svg "a title")',
      '',
      'Inline ![icon](https://example.com/icon.webp) in prose.',
      '',
    ].join('\n'),
  },
  {
    name: 'links',
    text: [
      '[docs](https://example.com/docs) and [guide](example.com/guide) and [mail](mailto:someone@example.com).',
      '',
      'A link to an image file: [the render](https://example.com/render.jpg?size=2).',
      '',
      'Bare URLs: https://example.com/page and www.example.com and http://203.0.113.7/status.',
      '',
      'A bare image URL: https://example.com/shot.png',
      '',
      'An angle autolink: <https://example.com/angle>.',
      '',
    ].join('\n'),
  },
  {
    name: 'raw-html',
    text: [
      '<img src=x onerror=alert(1)>',
      '',
      '<script>x</script>',
      '',
      'Inline <b>bold?</b> and <server-host> and a <kbd>K</kbd> tag.',
      '',
      '<div class="callout">a raw div</div>',
      '',
    ].join('\n'),
  },
  {
    name: 'streaming-caret',
    text: 'Still writing this **answer**',
    streaming: true,
  },
  {
    name: 'at-sync-limit',
    text: padToBytes(
      ['# A long message', '', 'Exactly 4 096 UTF-8 bytes, with a multi-byte é so bytes and characters differ.', '', ''].join('\n'),
      4096,
    ),
  },
];

/** A recap that `MessageBubble` folds into the compaction card (it matches `COMPACTION_RE`). Its Markdown body is
 *  the second Markdown site, which renders only once the card is opened. */
export const RECAP_CASE: CorpusCase = {
  name: 'recap-opened',
  text: [
    'This session is being continued from a previous conversation that ran out of context.',
    '',
    '> [!NOTE]',
    '> The summary follows.',
    '',
    '| step | state |',
    '|------|-------|',
    '| plan | ~~open~~ done |',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
  ].join('\n'),
};
````

Then create `pwa/test/markdown-golden.test.tsx` with exactly this content:

````tsx
// M4.M1 (native Docs reader, W4 Task 1; design 2026-10-01 section 4.9 and section 4.15, the W4 plan's
// refinement (e)): chat's Markdown output, held to stored files generated against the UNCHANGED `MessageBubble`
// before anything moves. Task 2 extracts `lib/markdown.tsx` and Tasks 3-8 harden chat; none of them may move a
// golden file. A changed byte reds the case that names it.
//
// Mechanism: vitest's `toMatchFileSnapshot`, one file per case under `test/golden/markdown/`. A missing file is
// written only outside CI, so CI cannot pass vacuously; never run this file with `-u`. This file imports nothing
// W4 creates: only `MessageBubble`, the corpus, React's server renderer, RTL and highlight.js's core (the same
// instance `MessageBubble` registers its grammars on).
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import hljs from 'highlight.js/lib/core';
import { MessageBubble } from '../src/session/MessageBubble';
import {
  CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, languageCases, type CorpusCase,
} from './markdownCorpus';

afterEach(cleanup);

const GOLDEN_DIR = path.join(import.meta.dirname, 'golden', 'markdown');
const TS = '2026-10-09T00:00:00Z';

/** The grammars `MessageBubble` registers, MEASURED (importing it registers them as a side effect). */
const REGISTERED: readonly string[] = [...hljs.listLanguages()].sort();
const TAGS: readonly string[] = [...new Set([...REGISTERED, ...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS])];
const CASES: readonly CorpusCase[] = [...CHAT_CORPUS, ...languageCases(TAGS)];
const ALL: readonly CorpusCase[] = [...CASES, RECAP_CASE];

const html = (c: CorpusCase): string =>
  renderToStaticMarkup(
    <MessageBubble id="s" event={{ kind: 'assistant', uuid: `g-${c.name}`, ts: TS, text: c.text }} streaming={c.streaming} />,
  );

/** The recap's Markdown body renders only once the card is opened, so it goes through the DOM and a click. */
function openedRecap(): string {
  const { container } = render(
    <MessageBubble id="s" event={{ kind: 'assistant', uuid: 'g-recap', ts: TS, text: RECAP_CASE.text }} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Context compacted/ }));
  expect(container.querySelector('.compaction-body.msg-assist')).not.toBeNull();
  return container.innerHTML;
}

describe('M4.M1: chat Markdown output is held to its golden files', () => {
  it.each(CASES)('$name', async (c) => {
    await expect(html(c)).toMatchFileSnapshot(`./golden/markdown/${c.name}.html`);
  });

  it('recap-opened: the compaction card opened, its Markdown body rendered', async () => {
    await expect(openedRecap()).toMatchFileSnapshot(`./golden/markdown/${RECAP_CASE.name}.html`);
  });
});

describe('the golden is not vacuous', () => {
  it('measures a non-empty grammar list, every listed alias resolves and no unregistered tag does', () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    for (const tag of [...REGISTERED, ...CHAT_ALIAS_TAGS]) expect(hljs.getLanguage(tag), tag).toBeDefined();
    for (const tag of CHAT_UNREGISTERED_TAGS) expect(hljs.getLanguage(tag), tag).toBeUndefined();
  });

  it('every case name is a unique file-safe slug', () => {
    const names = ALL.map((c) => c.name);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(names).size).toBe(names.length);
  });

  // A dropped grammar or alias removes its case; the stored file it leaves behind is what reds here.
  it('every stored golden file belongs to a case', () => {
    const names = new Set(ALL.map((c) => c.name));
    // vitest writes new file snapshots when the file ends, so on the one run that generates them the directory is
    // not there yet; under CI every case above has already failed for its missing file.
    const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR) : [];
    const stored = files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length));
    expect(stored.filter((n) => !names.has(n))).toEqual([]);
  });

  it('two renders of the corpus are byte-identical', () => {
    expect(CASES.map(html)).toEqual(CASES.map(html));
  });
});

/** `s` without its leading ASCII whitespace and C0 controls (every code unit up to U+0020), as a browser trims an
 *  attribute URL before parsing it. */
function trimC0(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 0x20) i += 1;
  return s.slice(i);
}

// The two bounds that keep every golden file still through the wave (markdownCorpus.ts's header).
describe('every case stays inside the bounds the later tasks rely on', () => {
  // 4096 is CHAT_SYNC_MAX_BYTES (Task 3's markdownLimits.ts); spelled here because this file imports nothing W4
  // creates. A case over it would take Task 6's worker path and could legitimately move.
  it.each(ALL)('$name is at most 4096 UTF-8 bytes', (c) => {
    expect(new TextEncoder().encode(c.text).length).toBeLessThanOrEqual(4096);
  });

  // Read from the rendered DOM, not from the Markdown text, so no Markdown spelling (inline, reference, angle
  // brackets, auto-embed) can hide a source: the browser trims ASCII whitespace and C0 controls from an attribute
  // URL and reads `\` as `/`, so this is root- or protocol-relative as the browser resolves it.
  it.each(ALL)('$name draws no image with a root- or protocol-relative source', (c) => {
    const host = document.createElement('div');
    host.innerHTML = c === RECAP_CASE ? openedRecap() : html(c);
    const srcs = [...host.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(srcs.filter((s) => /^[/\\]/.test(trimC0(s)))).toEqual([]);
  });
});
````

Check that the write kept every byte: `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx` prints `0` for each file, and `grep -c 'charCodeAt(i) <= 0x20' pwa/test/markdown-golden.test.tsx` prints `1`.

- [ ] **Step 2: Run it under CI to verify it fails.** Foreground, Bash timeout 600000 ms. No golden file exists yet, and in CI a missing file is a failure, never a write.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx )`
Expected: `Snapshots  55 failed`, `Test Files  1 failed (1)`, `Tests  55 failed | 114 passed (169)` (at G = 14; in general `G + 41` failed of `3G + 127`), each failure `Snapshot ... mismatched`, and `ls pwa/test/golden` answers `No such file or directory`. A `Cannot find module` or a type error means a file was not pasted exactly: stop. Any failure among the vacuity or bound cases means the corpus or `MessageBubble.tsx` is not what this plan measured: stop and ask.

- [ ] **Step 3: Generate the golden files against the unchanged `MessageBubble.tsx`.** Foreground, Bash timeout 600000 ms. This is the ONE run that writes them.

Run: `( cd pwa && env -u CI -u GITHUB_ACTIONS ./node_modules/.bin/vitest run test/markdown-golden.test.tsx )`
Expected: `Snapshots  55 written`, `Test Files  1 passed (1)`, `Tests  169 passed (169)`, and `ls pwa/test/golden/markdown | wc -l` prints `55` (`G + 41`). Then `git diff --quiet HEAD -- pwa/src && echo SRC-UNCHANGED` prints `SRC-UNCHANGED`: the files were generated against `BASE`'s source.

Spot-check two files against what this plan measured: `cat pwa/test/golden/markdown/streaming-caret.html` prints exactly

```html
<div class="msg-assist"><p>Still writing this <strong>answer</strong></p><span class="stream-caret" aria-hidden="true"></span></div>
```

and `cat pwa/test/golden/markdown/empty.html` prints exactly `<div class="msg-assist"></div>` (neither file ends in a newline). Inspect bytes: `od -c pwa/test/golden/markdown/raw-html.html | head -5` shows the raw HTML escaped as `&lt;img src=x onerror=alert(1)&gt;` and only printable bytes and `\n`; `LC_ALL=C grep -l -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/golden/markdown/*.html` prints nothing.

- [ ] **Step 4: Run it under CI to verify it passes and writes nothing.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx )`
Expected: `Test Files  1 passed (1)`, `Tests  169 passed (169)`, no `Snapshots` line; then `git status --porcelain pwa/test/golden | wc -l` still prints `1` (the one untracked directory, unchanged by this run).

- [ ] **Step 5: Measure refinement (b)'s equivalent mutant once, in a scratch copy.** Never in the worktree. Build the copy from the worktree's files as they stand (`C=$(mktemp -d)`, `git ls-files -co --exclude-standard | tar -cf - -T - | tar -xf - -C "$C"`, `ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules"`), then in `$C/pwa/src/session/MessageBubble.tsx` replace both occurrences of `remarkPlugins={[remarkGfm, remarkAlerts]}` with `remarkPlugins={[remarkAlerts, remarkGfm]}` (`grep -c` finds 2 before and 2 swapped after) and run `( cd "$C/pwa" && ./node_modules/.bin/vitest run test/markdown-golden.test.tsx )`.
Expected: `Tests  169 passed (169)`: the swap is equivalent (Measured 3), which is why W4-T1-M1 and W4-T1-M2 drop a plugin instead. Record the result in the SDD ledger for Task 10's deviation step (refinement (b)), then `rm -rf "$C"`.

- [ ] **Step 6: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests` is a known load flake: a red there is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (`tsconfig.json` includes `test`, so both new files compile under `strict` and `noUncheckedIndexedAccess`).

Run: `( cd pwa && ./node_modules/.bin/vitest run test/message-links.test.tsx test/chat.test.tsx )`
Expected: `Test Files  2 passed (2)`, `Tests  69 passed (69)` (re-derived at `BASE`; neither file is edited).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` and `pwa: EVERY .ts file in the package is in some typecheck project` cases cover the two new files.

Run: `git add pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx pwa/test/golden/markdown && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (re-derived at `BASE`). Both read `git ls-files`, so the files are staged first: every golden file carries only the corpus's placeholders.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (the count measured at `BASE`; this task adds nothing to its four roots).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 7: Commit.**

```bash
git add pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx pwa/test/golden/markdown
git status --porcelain | grep -v '^A  pwa/test/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: golden of chat Markdown, generated against the unchanged MessageBubble (docs W4)" \
  -m "markdown-golden.test.tsx holds MessageBubble's output for every case of markdownCorpus.ts to a stored file under test/golden/markdown (toMatchFileSnapshot; a missing file is written only outside CI): callouts of every kind, nested and with an emptied lead, a fence for every grammar hljs.listLanguages() measures plus every alias and three unregistered tags, kbd chips, inline code, a GFM table, task list, strikethrough and footnote, https images, links and bare URLs, raw HTML as text, the streaming caret, a case at exactly 4096 bytes, and the opened compaction recap through RTL. Vacuity: every alias resolves, no unregistered tag does, and no stored file is orphaned. Every case stays at most 4096 UTF-8 bytes and draws no root- or protocol-relative image, read from the rendered DOM, so no later W4 task may move a file." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions under `pwa/test/` are staged) and the count is `57` (`G + 43`: the two sources and the `G + 41` golden files).

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in the file at this task's state; Task 2 re-anchors W4-T1-M1 through W4-T1-M9 on `lib/markdown.tsx` and `MessageBubble.tsx`'s new text under the same ids):

```json
[
 {
  "id": "W4-T1-M1",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "      <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{event.text}</Markdown>",
  "new": "      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{event.text}</Markdown>",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 3 failed | 166 passed (169), Snapshots 3 failed — callout-emptied-lead, callout-nested, callouts-all-kinds (the recap, at the other site, stays green)"
 },
 {
  "id": "W4-T1-M2",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "      <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{event.text}</Markdown>",
  "new": "      <Markdown remarkPlugins={[remarkAlerts]} components={mdComponents}>{event.text}</Markdown>",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 5 failed | 164 passed (169), Snapshots 5 failed — gfm-footnote, gfm-strikethrough, gfm-table, gfm-task-list, links (the www. autolink literal)"
 },
 {
  "id": "W4-T1-M3",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });",
  "new": "hljs.registerAliases(['zsh'], { languageName: 'bash' });",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 1 failed — lang-shell; 'measures a non-empty grammar list, every listed alias resolves and no unregistered tag does' (shell no longer resolves)"
 },
 {
  "id": "W4-T1-M4",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "  bash, typescript, javascript, json, python, css, xml,\n",
  "new": "  typescript, javascript, json, python, css, xml,\n",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 5 failed | 161 passed (166), Snapshots 3 failed — lang-sh, lang-shell, lang-zsh; 'every stored golden file belongs to a case' (lang-bash.html is orphaned); 'measures a non-empty grammar list, every listed alias resolves and no unregistered tag does' (the lang-bash case and its two bounds are gone, hence 166)"
 },
 {
  "id": "W4-T1-M5",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "      <a href={href} target=\"_blank\" rel=\"noopener noreferrer\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "new": "      <a href={href} target=\"_blank\" rel=\"noopener\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 2 failed — gfm-footnote, links"
 },
 {
  "id": "W4-T1-M6",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "<img src={src} alt={alt ?? ''} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={src} alt={alt ?? ''} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — images-https"
 },
 {
  "id": "W4-T1-M7",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "<img src={href} alt={name} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={href} alt={name} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — links (the auto-embedded image-file link and bare image URL)"
 },
 {
  "id": "W4-T1-M8",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "      {streaming && <span className=\"stream-caret\" aria-hidden=\"true\" />}\n",
  "new": "",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — streaming-caret"
 },
 {
  "id": "W4-T1-M9",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "            <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{text}</Markdown>",
  "new": "            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</Markdown>",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — recap-opened alone (the FoldedCard site; every assistant-site case stays green)"
 },
 {
  "id": "W4-T1-M10",
  "pkg": "pwa",
  "file": "pwa/test/markdownCorpus.ts",
  "old": "      4096,\n    ),",
  "new": "      4097,\n    ),",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 1 failed — at-sync-limit; 'at-sync-limit' is at most 4096 UTF-8 bytes"
 },
 {
  "id": "W4-T1-M11",
  "pkg": "pwa",
  "file": "pwa/test/markdownCorpus.ts",
  "old": "      '![a chart](https://example.com/chart.png)',",
  "new": "      '![a chart](/api/example/chart.png)',",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 1 failed — images-https; 'images-https' draws no image with a root- or protocol-relative source"
 },
 {
  "id": "W4-T1-M12",
  "pkg": "pwa",
  "file": "pwa/test/markdownCorpus.ts",
  "old": "      'Inline ![icon](https://example.com/icon.webp) in prose.',",
  "new": "      'Inline ![icon](//h.example/icon.webp) in prose.',",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 1 failed — images-https; 'images-https' draws no image with a root- or protocol-relative source"
 }
]
```

---

### Task 2: Extract lib/markdown.tsx and an iterative lib/remarkAlerts.ts; MessageBubble's two sites become ChatMarkdown; every golden file unchanged

**Model routing:** `sonnet`, effort `high` — a move, not a rewrite: every moved line keeps its text (only `export` is added), the one behavioural change is `remarkAlerts`'s walk, which must keep the recursive walk's exact visiting order (pre-order, document order, `tag()` before the node's children are read), and the golden files Task 1 committed must not move by a byte. Measured on the shared scratch tree at Task 1's state.

**Spec rows:** M4.M2 ("Iterative `remarkAlerts`": `remark-alerts.test.ts`, differential against the old recursive walk kept as the oracle, 1-40 deep; a synthetic depth-50 000 mdast completes, control: the oracle throws `RangeError`; mutation: revert to recursion). Section 4.9's extraction (`lib/markdown.tsx` takes `IMG_EXT`, `isImageUrl`, `absolute`, `openExternal`, the hljs registration, `LANG_LABEL`, `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, `SHARED_COMPONENTS`, `CHAT_COMPONENTS`; `MessageBubble`'s two sites become `<ChatMarkdown text={...} />`, preserving the plugin order) under M4.M1, whose golden (Task 1) is this task's proof that chat did not change. Section 4.9's order: this is commit 2. `CodeBlock`'s `highlight` prop is Task 4's, not this task's.

**Files:**
- Create: `pwa/src/lib/remarkAlerts.ts` — 38 lines: `remarkAlerts` (the module-private `ALERT_RE` moves with it). React-free and DOM-free; Task 3's purity test adds it to the worker closure.
- Create: `pwa/src/lib/markdown.tsx` — 189 lines: the code moved out of `MessageBubble.tsx`, `SHARED_COMPONENTS`, `CHAT_COMPONENTS`, `ChatMarkdown`. Tasks 4 and 6 edit it.
- Create: `pwa/test/remark-alerts.test.ts` — 242 lines, 6 cases: the oracle (BASE's plugin, verbatim), the differential, the emptied-lead case, the visiting order twice (oracle and new), the 50 000-deep control and case.
- Modify: `pwa/src/session/MessageBubble.tsx` — four Find/Replace edits (the import block at lines 5-28; the moved region at lines 32-211; the FoldedCard site at line 288; the assistant site at line 409; hints at Task 1's state). 413 lines become 217.
- Modify: `pwa/src/session/chat.css` — one comment, in place, line count unchanged (line 1185 hint): `[data-copied]`'s holder becomes `CodeBlock (lib/markdown.tsx)`.
- Modify: `pwa/design/audit.mjs` — three `why` strings re-pointed by symbol, in place, line count unchanged (lines 491, 608, 616 hints): `.code-block-copy`'s and `.code-block-lang`'s name `CodeBlock (lib/markdown.tsx)`, and `.compaction-raw`'s `MessageBubble.tsx:285` becomes `FoldedCard, MessageBubble.tsx` (Decision 6).
- Test: `pwa/test/remark-alerts.test.ts`; `pwa/test/markdown-golden.test.tsx` (unchanged; every golden file stays byte-identical); guards `pwa/test/message-links.test.tsx` and `pwa/test/chat.test.tsx` (unmodified), `pwa/test/contrast.test.ts` and `pwa/test/tap-targets.test.tsx` (they read `chat.css` and `audit.mjs`), the PWA `tsc`, `server/test/single-definition.test.ts` (not edited), `server/test/typecheck-tests.test.ts`, `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`.

Every Find block below is quoted from the file as Task 1 left it (which is `BASE` for all three files: Task 1 edits no existing file) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes (unchanged from `BASE`): `react-markdown`'s default `Markdown` and `type Components`; `remark-gfm`'s default; `highlight.js/lib/core` and the fourteen per-language grammar modules `MessageBubble.tsx` imports at `BASE` (the import lines move verbatim; the count is whatever the import block holds, and the golden's `hljs.listLanguages()` measures it); `react`'s default `React`, `useCallback`, `useState`, `type ReactNode`. From Task 1, for tests only: `pwa/test/markdown-golden.test.tsx` and `pwa/test/golden/markdown/*.html`, run unmodified.
- `MessageBubble.tsx` keeps `type MessageEvent`, `linkify`, `timeOf`, `FoldedCard`, `ClipThumbs` and `MessageBubble`; `ChatList.tsx` keeps importing `{ MessageBubble, timeOf, type MessageEvent }` from `./MessageBubble` (no edit there).
- Produces, in `pwa/src/lib/remarkAlerts.ts`:
  - `export function remarkAlerts(): (tree: unknown) => void` — the remark plugin factory (unified calls it with no options); the transformer mutates the mdast in place: each `blockquote` whose first child is a paragraph led by a text node matching `/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i` gets `data = {hName:'div', hProperties:{className:['callout'], 'data-callout': <kind, lower case>}}`, its marker stripped, an emptied lead text removed and an emptied lead paragraph removed. A transformer typed `(tree: unknown) => void` is assignable where unified expects one over `Root` (parameter contravariance; `tsc` proves it at the `remarkPlugins` site).
- Produces, in `pwa/src/lib/markdown.tsx` (module side effects: the hljs registration and its three `registerAliases` calls, and `import '../session/chat.css'`):
  - `export const IMG_EXT: RegExp`
  - `export const isImageUrl: (href: string | undefined) => href is string`
  - `export function absolute(href: string): string`
  - `export function openExternal(e: React.MouseEvent, href: string | undefined): void`
  - `export const LANG_LABEL: Readonly<Record<string, string>>`
  - `export function nodeText(n: ReactNode): string`
  - `export function keystrokeParts(raw: string): string[] | null` (`null`: the text is not keystroke-shaped and renders as inline code; one meaning). `NAMED_KEY` and `SINGLE` stay module-private.
  - `export function CodeBlock({ children }: { children?: ReactNode }): ReactNode`
  - `export function TableWrap({ children }: { children?: ReactNode }): ReactNode`
  - `export const SHARED_COMPONENTS: Components` — `{ code, pre, table }`, today's three, text unchanged.
  - `export const CHAT_COMPONENTS: Components` — `{ ...SHARED_COMPONENTS, a, img }`, today's `mdComponents` (same five members, `a` and `img` text unchanged).
  - `export function ChatMarkdown({ text }: { text: string }): ReactNode` — `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>`, synchronous; Task 6 hardens it behind the same signature. It takes no `streaming` prop: the caret stays the caller's sibling after it.

**Decisions this task makes (none departs from the spec's text):**
1. **`tag()` moves byte for byte; only the walk changes.** `remarkAlerts.ts` carries `ALERT_RE`, its doc comment and `tag` exactly as `MessageBubble.tsx` had them (the `any` and its `eslint-disable` comments included). The recursive `walk` becomes an explicit stack: pop a node, `tag()` it if it is a `blockquote`, THEN read its `children` and push them last to first, so they pop in document order. Reading `children` after `tag()` is what keeps an emptied lead paragraph unvisited, as the recursive `for ... of` did.
2. **The move is text-identical, and Step 4 proves it with a diff.** `markdown.tsx` holds the moved lines verbatim with `export` added, except four things the diff names: `LANG_LABEL`'s type gains `Readonly<...>` (the architecture's interface; no caller writes it); `remarkAlerts` is imported instead of declared; `mdComponents` is split into `SHARED_COMPONENTS` (`code`, `pre`, `table`, their text unchanged and in their old order) and `CHAT_COMPONENTS` (`...SHARED_COMPONENTS`, then `a` and `img`, unchanged), whose key order cannot change react-markdown's output (it looks components up by tag name); and `ChatMarkdown` is new. `markdown.tsx` imports `'../session/chat.css'` (section 4.9) and `MessageBubble.tsx` keeps its own `import './chat.css'`; Vite and vitest load a stylesheet once however many modules import it.
3. **Two properties, two kinds of case.** Output equality is a differential over generated mdast: for each depth 1-40, twelve trees (each of ten lead shapes in a nested chain, quotes inside list items inside quotes, and a level with sibling quotes on both sides), cloned and run through both, `toEqual`. Visiting order cannot change the output (each `tag()` touches only its own node and its first paragraph), so it gets its own observable: a small tree whose every `type` property is a getter that logs its node's id. The log records every visit and every `tag()` lead read, so the oracle's log is pinned to a hand-written sequence and the new walk must produce the same one.
4. **The 50 000-deep chain is built iteratively and checked iteratively.** A recursive builder, `JSON.stringify` or `toEqual` on it would overflow the test itself; `census()` follows the chain with a loop and counts the levels tagged with their own kind and stripped lead. The control (the oracle throws `RangeError` on the same tree) was measured at 50 000 in vitest's worker, so no smaller depth is needed (section 4.9: the recursive walk throws near 10 000).
5. **`MessageBubble.tsx` keeps what is not Markdown.** `linkify` and `ClipThumbs` still call `openExternal`, now imported; `isImageUrl`, `absolute`, `Markdown`, `remarkGfm`, `Components`, `React`, `useCallback` and the grammar imports leave its import block (under `noUnusedLocals` an unused import is a compile error). The caret stays where it was, after `<ChatMarkdown text={event.text} />` inside `.msg-assist`.
6. **Prose re-pointed by symbol, never by line.** `chat.css`'s comment and two `audit.mjs` `why` strings named `MessageBubble.tsx` as `CodeBlock`'s home; they now say `CodeBlock (lib/markdown.tsx)`. A third `why` string, `.compaction-raw`'s, cites `MessageBubble.tsx:285` for `FoldedCard`'s raw `<pre>`, which this task moves to line 89; it becomes `(FoldedCard, MessageBubble.tsx)`. (The architecture named two strings; the third is a citation this task's own move makes stale, so it is fixed here.) Each edit is inside one line or replaces two lines with two, so every `chat.css:<n>` citation in `audit.mjs` (`:1223`, `:1286`, ...) still points where it did. Left for W7's prose pass, as the header records: `pwa/src/lib/api.ts`'s comment naming `MessageBubble`'s `absolute()` (api.ts is outside W4's box), and `server/test/sourceScan.ts`'s header counts measured on `MessageBubble.tsx`.

**Measured while planning** (the shared scratch tree at Task 1's state; the mutations in a separate copy):
1. **RED**: `Error: Failed to resolve import "../src/lib/remarkAlerts" from "test/remark-alerts.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.
2. **GREEN after `remarkAlerts.ts`**: `Tests  6 passed (6)`. The oracle throws `RangeError` at 50 000 (the control case passes).
3. **GREEN after the extraction**, under `CI=1` so no snapshot can be written: `remark-alerts` + `markdown-golden` + `message-links` + `chat` give `Test Files  4 passed (4)`, `Tests  244 passed (244)` (6 + 169 + 69); `git status --porcelain pwa/test/golden` prints nothing.
4. **Guards**: PWA `tsc` clean; `contrast` + `tap-targets` `Tests  297 passed (297)` (the same 297 at Task 1's state); `single-definition` `Tests  523 passed (523)` (unchanged from Task 1); each of `remarkAlerts`, `CodeBlock`, `TableWrap`, `isImageUrl`, `openExternal`, `absolute` is declared in exactly one file of `pwa/src`, `server/src`, `shared`, `agent/src`; `source-bytes` + `topology-clean` `Tests  57 passed (57)`; `typecheck-tests` 10 of 12 in the scratch tree, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules` (`Cannot find module 'ws'`), as at Task 1; a worktree with installed modules runs `12 passed (12)`.
5. **Mutations**: twelve rows, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, `git -C <copy> init -q`, `pwa/node_modules` linked in), run without `CI`, restored after each; `git status --porcelain` in the copy was empty after every one. W4-T2-M1..M3 are this task's guards. W4-T1-M1..M9 are Task 1's rows RE-ANCHORED on the moved code under the same ids (Task 12 keeps an id's last occurrence): M1 and M2 now sit on `ChatMarkdown`'s one plugin list, so they also red the recap (it renders through the same list); M9, "the FoldedCard site's plugin list drops `remarkAlerts`", cannot be spelled any more (the site has no list of its own), so it becomes "the FoldedCard site stops rendering through `ChatMarkdown`", which reds the recap alone as before. W4-T1-M10..M12 anchor on the corpus, which this task does not touch, and are not repeated.
6. **One equivalent mutant, recorded and not a row**: moving `const children = node.children;` above `tag(node)` WITHOUT copying the array leaves `175 passed (175)` over `remark-alerts` and `markdown-golden`: `tag()` shifts that same array in place, so the loop still sees the shifted list. W4-T2-M3 copies the array before `tag()`, which is the mutant that changes behaviour, and it reds.

- [ ] **Step 0: Confirm the state, claim, and measure the neighbours before any edit.** From the worktree root, foreground.

Run: `grep -q 'const mdComponents: Components' pwa/src/session/MessageBubble.tsx && test -e pwa/test/markdown-golden.test.tsx && test -e pwa/test/markdownCorpus.ts && test -d pwa/test/golden/markdown && git diff --quiet HEAD -- pwa/src pwa/test/golden && test -z "$(git ls-files --others --exclude-standard pwa/test/golden)" && test ! -e pwa/src/lib/markdown.tsx && test ! -e pwa/src/lib/remarkAlerts.ts && test ! -e pwa/test/remark-alerts.test.ts && echo T2-STATE-OK && git ls-files pwa/test/golden/markdown | wc -l && ls pwa/test/golden/markdown | wc -l`
Expected: `T2-STATE-OK`, then the same number twice (`G + 41`; 55 at planning): Task 1 is committed, every golden file is tracked and unchanged, and none of this task's files exists. If `T2-STATE-OK` does not print, stop and put an ask to the coordinator.

Then take the claims on `pwa/src/session/MessageBubble.tsx`, `pwa/src/session/chat.css` and `pwa/design/audit.mjs` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`). A 409 names the holder: mail it through the response's `mailHint` and edit none of the three until that claim ends or the two coordinators confirm a scoped agreement.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/message-links.test.tsx test/chat.test.tsx )`
Expected: `Test Files  3 passed (3)`, `Tests  238 passed (238)` (169 + 69 at G = 14; whatever it prints, Step 5 must print the same plus this task's 6).

- [ ] **Step 1: Write the failing test.** Create `pwa/test/remark-alerts.test.ts` with exactly this content:

```ts
// M4.M2 (native Docs reader, W4 Task 2; design 2026-10-01 section 4.9 and section 4.15): the iterative
// `remarkAlerts` in `lib/remarkAlerts.ts` against the recursive walk it replaces. `oracleRemarkAlerts` below is the
// plugin `session/MessageBubble.tsx` carried before Task 2, kept VERBATIM (its `tag()` and its recursive `walk`) as
// the oracle, here and nowhere in `src`. Three properties, each with its own case:
//   1. the same output: a differential over generated mdast trees 1 to 40 containers deep;
//   2. the same visiting order: pre-order, children in document order, `tag()` run BEFORE the node's children are
//      read (it may shift the emptied lead paragraph out of them), observed through every `type` read;
//   3. no recursion: a 50 000-deep blockquote chain completes, where the oracle throws `RangeError`.
import { describe, expect, it } from 'vitest';
import { remarkAlerts } from '../src/lib/remarkAlerts';

// ---- the oracle: BASE's MessageBubble.tsx plugin, verbatim ----

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function oracleRemarkAlerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = (node: any): void => {
    const p = node.children?.[0];
    if (!p || p.type !== 'paragraph') return;
    const lead = p.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = ALERT_RE.exec(lead.value);
    if (!m) return;
    lead.value = lead.value.slice(m[0].length).replace(/^[^\S\n]*\n?/, '');
    if (lead.value === '') {
      p.children.shift();
      if (p.children.length === 0) node.children.shift();
    }
    node.data = { hName: 'div', hProperties: { className: ['callout'], 'data-callout': m[1]!.toLowerCase() } };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): void => {
    if (node.type === 'blockquote') tag(node);
    if (node.children) for (const c of node.children) walk(c);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => walk(tree);
}

// ---- generated mdast ----

interface MdNode {
  type: string;
  value?: string;
  ordered?: boolean;
  children?: MdNode[];
  data?: unknown;
}

const KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
const kind = (k: number): string => KINDS[k % KINDS.length]!;

const text = (value: string): MdNode => ({ type: 'text', value });
const para = (...children: MdNode[]): MdNode => ({ type: 'paragraph', children });
const quote = (...children: MdNode[]): MdNode => ({ type: 'blockquote', children });
const list = (...items: MdNode[]): MdNode => ({
  type: 'list',
  ordered: false,
  children: items.map((c) => ({ type: 'listItem', children: [c] })),
});
const root = (...children: MdNode[]): MdNode => ({ type: 'root', children });

/** The first child a blockquote can open with: every branch `tag()` takes. */
const LEADS: readonly ((k: number) => MdNode)[] = [
  (k) => para(text(`[!${kind(k)}]\nbody ${k}`)), // marker, then the body on the next line
  (k) => para(text(`[!${kind(k).toLowerCase()}] same line ${k}`)), // lower case, body on the marker's line
  () => para(text('[!TIP]')), // the lead empties and so does the paragraph: it is dropped
  () => para(text('[!WARNING]   \n'), { type: 'strong', children: [text('bold')] }), // the lead empties, the paragraph stays
  () => para(text('[!NOTE]   ')), // trailing spaces only: the lead empties
  () => para(text('[!FOO] not an alert kind')),
  () => para(text('a plain quote')),
  () => para({ type: 'emphasis', children: [text('[!NOTE] the lead is not a text node')] }),
  () => ({ type: 'code', value: '[!NOTE]' }), // the first child is not a paragraph
  () => para(), // a paragraph with no children
];
const lead = (i: number, k: number): MdNode => LEADS[i % LEADS.length]!(k);

/** `depth` blockquotes, each opening with lead `i`, the next one inside the previous. */
function chain(depth: number, i: number): MdNode {
  let inner = quote(lead(i, depth));
  for (let d = depth - 1; d >= 1; d -= 1) inner = quote(lead(i, d), inner);
  return root(inner, para(text('after')));
}

/** Quotes inside list items inside quotes, the lead rotating per level. */
function listChain(depth: number): MdNode {
  let inner = quote(lead(depth, depth));
  for (let d = depth - 1; d >= 1; d -= 1) inner = quote(lead(d, d), list(inner, para(text(`item ${d}`))));
  return root(inner);
}

/** At every level an alert, a plain sibling quote, the next level, and a trailing alert sibling. */
function siblings(depth: number): MdNode {
  let inner = quote(lead(0, depth));
  for (let d = depth - 1; d >= 1; d -= 1) {
    inner = quote(lead(d + 2, d), quote(lead(6, d)), inner, quote(lead(1, d + 1)));
  }
  return root(quote(lead(2, 0)), inner, quote(lead(3, 0)));
}

/** Every tree in the family at one depth. */
function family(depth: number): MdNode[] {
  return [...LEADS.map((_, i) => chain(depth, i)), listChain(depth), siblings(depth)];
}

const clone = (t: MdNode): MdNode => JSON.parse(JSON.stringify(t)) as MdNode;

describe('M4.M2: the iterative remarkAlerts matches the recursive walk', () => {
  it('gives the same tree as the oracle for every generated tree 1 to 40 deep', () => {
    let trees = 0;
    let tagged = 0;
    for (let depth = 1; depth <= 40; depth += 1) {
      for (const t of family(depth)) {
        const want = clone(t);
        oracleRemarkAlerts()(want);
        const got = clone(t);
        remarkAlerts()(got);
        expect(got, `depth ${depth}: ${JSON.stringify(t).slice(0, 120)}`).toEqual(want);
        trees += 1;
        tagged += (JSON.stringify(want).match(/"callout"/g) ?? []).length;
      }
    }
    // Not vacuous: the family is 12 trees per depth, and most of them carry alerts.
    expect(trees).toBe(40 * (LEADS.length + 2));
    expect(tagged).toBeGreaterThan(1000);
  });

  it('drops an emptied lead paragraph and keeps a lead paragraph that still has content', () => {
    const t = root(quote(lead(2, 0), para(text('kept'))), quote(lead(3, 0)));
    remarkAlerts()(t);
    expect(t).toEqual(root(
      { ...quote(para(text('kept'))), data: { hName: 'div', hProperties: { className: ['callout'], 'data-callout': 'tip' } } },
      {
        ...quote(para({ type: 'strong', children: [text('bold')] })),
        data: { hName: 'div', hProperties: { className: ['callout'], 'data-callout': 'warning' } },
      },
    ));
  });
});

/** A node whose every `type` read is logged under `id`, so the visiting order is observable. */
function seen(log: string[], id: string, type: string, rest: Omit<MdNode, 'type'> = {}): MdNode {
  const node = { ...rest } as MdNode;
  Object.defineProperty(node, 'type', {
    enumerable: true,
    get: () => {
      log.push(id);
      return type;
    },
  });
  return node;
}

/** root > [A: alert whose lead paragraph empties, holding B: an alert; C: a plain quote]. */
function orderTree(log: string[]): MdNode {
  const s = (id: string, type: string, rest?: Omit<MdNode, 'type'>): MdNode => seen(log, id, type, rest);
  return s('root', 'root', {
    children: [
      s('A', 'blockquote', {
        children: [
          s('A.p', 'paragraph', { children: [s('A.p.t', 'text', { value: '[!TIP]' })] }),
          s('B', 'blockquote', {
            children: [s('B.p', 'paragraph', { children: [s('B.p.t', 'text', { value: '[!NOTE] inner' })] })],
          }),
        ],
      }),
      s('C', 'blockquote', {
        children: [s('C.p', 'paragraph', { children: [s('C.p.t', 'text', { value: 'plain' })] })],
      }),
    ],
  });
}

describe('M4.M2: the visiting order is the recursive walk\'s', () => {
  // Every `type` read, in order: the walk reads a node's type when it visits it, and `tag()` reads its lead
  // paragraph's and lead text's. A's emptied paragraph is shifted out by `tag(A)` BEFORE A's children are read,
  // so `A.p` is never visited after `A.p.t`; children are visited in document order, so C comes last.
  const ORDER = [
    'root',
    'A', 'A.p', 'A.p.t',
    'B', 'B.p', 'B.p.t', 'B.p', 'B.p.t',
    'C', 'C.p', 'C.p.t', 'C.p', 'C.p.t',
  ];

  it('the oracle reads types in exactly this order', () => {
    const log: string[] = [];
    oracleRemarkAlerts()(orderTree(log));
    expect(log).toEqual(ORDER);
  });

  it('remarkAlerts reads types in the same order: pre-order, document order, tag before children', () => {
    const log: string[] = [];
    remarkAlerts()(orderTree(log));
    expect(log).toEqual(ORDER);
  });
});

// ---- depth: the iterative walk has no recursion limit ----

const DEEP = 50_000;

/** `depth` nested alert blockquotes, built iteratively (a recursive builder would overflow first). */
function deepQuotes(depth: number): MdNode {
  const tree = root();
  let parent = tree;
  for (let i = 0; i < depth; i += 1) {
    const q = quote(para(text(`[!${kind(i)}] level ${i}`)));
    parent.children!.push(q);
    parent = q;
  }
  return tree;
}

/** Walks the chain iteratively: how many blockquotes, how many tagged with their own kind and stripped lead. */
function census(tree: MdNode): { quotes: number; tagged: number } {
  let quotes = 0;
  let tagged = 0;
  let node: MdNode | undefined = tree.children?.[0];
  while (node !== undefined) {
    const lvl = quotes;
    quotes += 1;
    const data = node.data as { hProperties?: { 'data-callout'?: string } } | undefined;
    const leadText = node.children?.[0]?.children?.[0]?.value;
    if (data?.hProperties?.['data-callout'] === kind(lvl).toLowerCase() && leadText === `level ${lvl}`) tagged += 1;
    node = node.children?.[1];
  }
  return { quotes, tagged };
}

describe('M4.M2: a 50 000-deep blockquote chain', () => {
  it('control: the recursive oracle throws RangeError on it', () => {
    expect(() => oracleRemarkAlerts()(deepQuotes(DEEP))).toThrow(RangeError);
  });

  it('remarkAlerts completes and tags every level', () => {
    const tree = deepQuotes(DEEP);
    expect(() => remarkAlerts()(tree)).not.toThrow();
    expect(census(tree)).toEqual({ quotes: DEEP, tagged: DEEP });
  });
});
```

Check that the write kept every byte: `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/remark-alerts.test.ts` prints `0`, and `grep -cF 'const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;' pwa/test/remark-alerts.test.ts` prints `1` (the regex's backslashes survived).

- [ ] **Step 2: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/remark-alerts.test.ts )`
Expected: `Error: Failed to resolve import "../src/lib/remarkAlerts" from "test/remark-alerts.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Write `remarkAlerts.ts`.** Create `pwa/src/lib/remarkAlerts.ts` with exactly this content:

```ts
// GitHub-style alert blockquotes (`> [!NOTE]`) as callouts: the remark plugin chat's renderer runs after
// remark-gfm (native Docs reader, W4 Task 2; design 2026-10-01 section 4.9). Moved out of
// `session/MessageBubble.tsx`: `tag()` is byte-identical, and the recursive `walk` became an explicit stack, so a
// deeply nested quote cannot overflow the call stack. The order is the recursive walk's: pre-order, children in
// document order (pushed in reverse), and `tag()` runs BEFORE a node's children are read, because it may shift
// the emptied lead paragraph out of them. `remark-alerts.test.ts` holds it to the old walk as its oracle.
//
// React-free and DOM-free: the parse worker imports it (Task 3's purity test pins the closure).

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
export function remarkAlerts(): (tree: unknown) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = (node: any): void => {
    const p = node.children?.[0];
    if (!p || p.type !== 'paragraph') return;
    const lead = p.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = ALERT_RE.exec(lead.value);
    if (!m) return;
    lead.value = lead.value.slice(m[0].length).replace(/^[^\S\n]*\n?/, '');
    if (lead.value === '') {
      p.children.shift();
      if (p.children.length === 0) node.children.shift();
    }
    node.data = { hName: 'div', hProperties: { className: ['callout'], 'data-callout': m[1]!.toLowerCase() } };
  };
  return (tree: unknown): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack: any[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.type === 'blockquote') tag(node);
      const children = node.children;
      if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  };
}
```

Run: `( cd pwa && ./node_modules/.bin/vitest run test/remark-alerts.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`. If the control case `the recursive oracle throws RangeError on it` fails (the oracle completed at 50 000 on this box), measure the depth at which the oracle first throws (double from 50 000 until it does), record it in the SDD ledger, set `DEEP` to twice that depth, and re-run; never lower `DEEP`.

- [ ] **Step 4: Move the code.** (a) Create `pwa/src/lib/markdown.tsx` with exactly this content:

```tsx
// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { useCallback, useState, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // html / svg
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import { remarkAlerts } from './remarkAlerts';
import '../session/chat.css';

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Absolute, scheme-qualified URL — a bare "example.com" would otherwise resolve
 *  same-origin and get swallowed by the PWA's navigation fallback. */
export function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][\w+.-]*:/i.test(href)) return href; // mailto:, tel:, …
  return `https://${href}`;
}

/** Open in a real new browser tab/instance. A plain target=_blank in a
 *  standalone PWA is unreliable (the app window itself can navigate, and the
 *  service worker's navigateFallback then serves index.html — the "back to the
 *  landing page" symptom), so force a fresh context via window.open. */
export function openExternal(e: React.MouseEvent, href: string | undefined): void {
  if (!href) return;
  e.preventDefault();
  window.open(absolute(href), '_blank', 'noopener,noreferrer');
}

for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml,
  yaml, markdown, diff, sql, dockerfile, rust, go,
})) hljs.registerLanguage(name, def);
hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });

export const LANG_LABEL: Readonly<Record<string, string>> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
export function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** Keystroke-shaped inline code → real <kbd> caps (`Cmd+K`, `Esc`). */
const NAMED_KEY =
  /^(?:Ctrl|Control|Cmd|Command|⌘|Alt|Option|⌥|Opt|Shift|⇧|Win|Super|Meta|Fn|Esc|Escape|Enter|Return|↵|⏎|Tab|⇥|Space|Spacebar|Backspace|⌫|Delete|Del|Insert|Ins|Home|End|PageUp|PgUp|PageDown|PgDn|Up|Down|Left|Right|↑|↓|←|→|F(?:[1-9]|1[0-2]))$/;
const SINGLE = /^[\p{L}\p{N}`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/u;
export function keystrokeParts(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*\+\s*/);
  const ok = (p: string): boolean => NAMED_KEY.test(p) || SINGLE.test(p);
  if (parts.length > 1) return parts.every(ok) ? parts : null;
  return NAMED_KEY.test(parts[0]!) ? parts : null; // bare single chars stay chips
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay. */
export function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const html = lang && hljs.getLanguage(lang)
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [raw]);
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{label}</span>
        <button type="button" className="code-block-copy" onClick={onCopy}
                aria-label="Copy code" data-copied={copied || undefined}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        {html != null
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code className="hljs">{raw}</code>}
      </pre>
    </div>
  );
}

/** Wrap tables so the scroller is a div (enables the edge-fade affordance). */
export function TableWrap({ children }: { children?: ReactNode }): ReactNode {
  return <div className="md-table-wrap"><table>{children}</table></div>;
}

/** The components chat and the Docs screen share: inline code (kbd chips), fenced code, tables. */
export const SHARED_COMPONENTS: Components = {
  code({ className, children }) {
    const text = String(children ?? '');
    if (/language-/.test(className ?? '') || text.includes('\n')) {
      return <code className={className}>{children}</code>; // block code → left to CodeBlock
    }
    const keys = keystrokeParts(text);
    if (keys) {
      return (
        <span className="kbd-combo">
          {keys.map((k, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="kbd-plus">+</span>}
              <kbd>{k}</kbd>
            </React.Fragment>
          ))}
        </span>
      );
    }
    return <code className="md-code">{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <TableWrap>{children}</TableWrap>,
};

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images. */
export const CHAT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  a({ href, children }) {
    if (isImageUrl(href)) {
      const name = href.split('/').pop()?.split(/[?#]/)[0] || 'image';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
          <img src={href} alt={name} loading="lazy" className="msg-img" />
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
        <img src={src} alt={alt ?? ''} loading="lazy" className="msg-img" />
      </a>
    );
  },
};

/** One chat message body (an assistant turn, an opened compaction recap) as Markdown: GFM, then the alert
 *  callouts, through chat's components. The streaming caret is the caller's sibling after it. */
export function ChatMarkdown({ text }: { text: string }): ReactNode {
  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;
}
```

(b) In `pwa/src/session/MessageBubble.tsx`, replace the import block (lines 5-28). Find:

```tsx
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import React, { useCallback, useState, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // html / svg
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import type { ChatEvent } from '../../../shared/api';
import { splitClipPaths } from '../../../shared/api';
import { clipUrl } from '../lib/api';
import { resetClock } from '../lib/clock';
import './chat.css';
```

Replace with:

```tsx
import { useState, type ReactNode } from 'react';
import type { ChatEvent } from '../../../shared/api';
import { splitClipPaths } from '../../../shared/api';
import { clipUrl } from '../lib/api';
import { resetClock } from '../lib/clock';
import { ChatMarkdown, openExternal } from '../lib/markdown';
import './chat.css';
```

(c) In the same file, remove the moved region (lines 32-209, from `const IMG_EXT` to the `};` that closes `mdComponents`) together with the blank line after it. Find (lines 32-211; it ends with the `const URL_SPLIT` line, which stays):

```tsx
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Absolute, scheme-qualified URL — a bare "example.com" would otherwise resolve
 *  same-origin and get swallowed by the PWA's navigation fallback. */
function absolute(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][\w+.-]*:/i.test(href)) return href; // mailto:, tel:, …
  return `https://${href}`;
}

/** Open in a real new browser tab/instance. A plain target=_blank in a
 *  standalone PWA is unreliable (the app window itself can navigate, and the
 *  service worker's navigateFallback then serves index.html — the "back to the
 *  landing page" symptom), so force a fresh context via window.open. */
function openExternal(e: React.MouseEvent, href: string | undefined): void {
  if (!href) return;
  e.preventDefault();
  window.open(absolute(href), '_blank', 'noopener,noreferrer');
}

for (const [name, def] of Object.entries({
  bash, typescript, javascript, json, python, css, xml,
  yaml, markdown, diff, sql, dockerfile, rust, go,
})) hljs.registerLanguage(name, def);
hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });
hljs.registerAliases(['tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });

const LANG_LABEL: Record<string, string> = {
  bash: 'bash', sh: 'shell', shell: 'shell', zsh: 'zsh',
  typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
  javascript: 'JavaScript', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', python: 'Python', py: 'Python', css: 'CSS',
  xml: 'XML', html: 'HTML', yaml: 'YAML', yml: 'YAML',
  markdown: 'Markdown', md: 'Markdown', diff: 'diff', sql: 'SQL',
  dockerfile: 'Dockerfile', rust: 'Rust', go: 'Go',
};

/** Flatten a react-markdown child tree to source text (for copy + highlight). */
function nodeText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return '';
}

/** GitHub-style alert blockquotes → callout divs. remark-gfm does NOT do this. */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkAlerts() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tag = (node: any): void => {
    const p = node.children?.[0];
    if (!p || p.type !== 'paragraph') return;
    const lead = p.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = ALERT_RE.exec(lead.value);
    if (!m) return;
    lead.value = lead.value.slice(m[0].length).replace(/^[^\S\n]*\n?/, '');
    if (lead.value === '') {
      p.children.shift();
      if (p.children.length === 0) node.children.shift();
    }
    node.data = { hName: 'div', hProperties: { className: ['callout'], 'data-callout': m[1]!.toLowerCase() } };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): void => {
    if (node.type === 'blockquote') tag(node);
    if (node.children) for (const c of node.children) walk(c);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any): void => walk(tree);
}

/** Keystroke-shaped inline code → real <kbd> caps (`Cmd+K`, `Esc`). */
const NAMED_KEY =
  /^(?:Ctrl|Control|Cmd|Command|⌘|Alt|Option|⌥|Opt|Shift|⇧|Win|Super|Meta|Fn|Esc|Escape|Enter|Return|↵|⏎|Tab|⇥|Space|Spacebar|Backspace|⌫|Delete|Del|Insert|Ins|Home|End|PageUp|PgUp|PageDown|PgDn|Up|Down|Left|Right|↑|↓|←|→|F(?:[1-9]|1[0-2]))$/;
const SINGLE = /^[\p{L}\p{N}`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/u;
function keystrokeParts(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*\+\s*/);
  const ok = (p: string): boolean => NAMED_KEY.test(p) || SINGLE.test(p);
  if (parts.length > 1) return parts.every(ok) ? parts : null;
  return NAMED_KEY.test(parts[0]!) ? parts : null; // bare single chars stay chips
}

/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay. */
function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const html = lang && hljs.getLanguage(lang)
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [raw]);
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{label}</span>
        <button type="button" className="code-block-copy" onClick={onCopy}
                aria-label="Copy code" data-copied={copied || undefined}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        {html != null
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code className="hljs">{raw}</code>}
      </pre>
    </div>
  );
}

/** Wrap tables so the scroller is a div (enables the edge-fade affordance). */
function TableWrap({ children }: { children?: ReactNode }): ReactNode {
  return <div className="md-table-wrap"><table>{children}</table></div>;
}

/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images. */
const mdComponents: Components = {
  a({ href, children }) {
    if (isImageUrl(href)) {
      const name = href.split('/').pop()?.split(/[?#]/)[0] || 'image';
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
          <img src={href} alt={name} loading="lazy" className="msg-img" />
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="msg-img-link" onClick={(e) => openExternal(e, href)}>
        <img src={src} alt={alt ?? ''} loading="lazy" className="msg-img" />
      </a>
    );
  },
  code({ className, children }) {
    const text = String(children ?? '');
    if (/language-/.test(className ?? '') || text.includes('\n')) {
      return <code className={className}>{children}</code>; // block code → left to CodeBlock
    }
    const keys = keystrokeParts(text);
    if (keys) {
      return (
        <span className="kbd-combo">
          {keys.map((k, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="kbd-plus">+</span>}
              <kbd>{k}</kbd>
            </React.Fragment>
          ))}
        </span>
      );
    }
    return <code className="md-code">{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <TableWrap>{children}</TableWrap>,
};

const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
```

Replace with:

```tsx
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
```

(d) The FoldedCard site (line 288 at Task 1's state, about line 92 after (b) and (c)). Find:

```tsx
            <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{text}</Markdown>
```

Replace with:

```tsx
            <ChatMarkdown text={text} />
```

(e) The assistant site (line 409 at Task 1's state, about line 213 after). Find:

```tsx
      <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={mdComponents}>{event.text}</Markdown>
```

Replace with:

```tsx
      <ChatMarkdown text={event.text} />
```

The line after it, `      {streaming && <span className="stream-caret" aria-hidden="true" />}`, stays.

Check the edit: `wc -l < pwa/src/session/MessageBubble.tsx` prints `217`; `grep -c 'ChatMarkdown' pwa/src/session/MessageBubble.tsx` prints `3` (the import and the two sites); `grep -cE 'mdComponents|remarkAlerts|hljs|<Markdown' pwa/src/session/MessageBubble.tsx` prints `0`.

Prove the move is text-identical (Decision 2): `diff <(git show HEAD:pwa/src/session/MessageBubble.tsx | sed -n '5,23p;32,209p') <(sed -n '7,200p' pwa/src/lib/markdown.tsx | sed 's/^export //') | grep -E '^[0-9]'`
Expected exactly these seven hunk headers, and no other:

```
19a20,22
49c52
68,95d70
148a124,149
151c152,153
175,196d176
197a178,183
```

They are, in order: the `./remarkAlerts` and `../session/chat.css` imports; `LANG_LABEL`'s `Readonly<...>`; the `remarkAlerts` block that moved to its own file; `SHARED_COMPONENTS` opening with the three shared members; `mdComponents` renamed `CHAT_COMPONENTS` with its spread; the three shared members leaving `CHAT_COMPONENTS`; `ChatMarkdown`. Any other hunk is a changed line: stop and diff by hand.

- [ ] **Step 5: Run the chat suites to verify they pass and that no golden file moved.** Foreground, Bash timeout 600000 ms. `CI=1` makes a mismatched or missing golden file a failure, never a write.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/remark-alerts.test.ts test/markdown-golden.test.tsx test/message-links.test.tsx test/chat.test.tsx )`
Expected: `Test Files  4 passed (4)`, `Tests  244 passed (244)` (Step 0's count plus 6), no `Snapshots` line. Then `git status --porcelain pwa/test/golden pwa/test/markdown-golden.test.tsx pwa/test/markdownCorpus.ts pwa/test/message-links.test.tsx pwa/test/chat.test.tsx` prints nothing. A golden failure means a moved line changed: fix the move, never the golden file.

- [ ] **Step 6: Re-point the prose by symbol.** Each edit is in place and keeps the file's line count (`wc -l` before and after: `chat.css` and `audit.mjs` unchanged).

(a) `pwa/src/session/chat.css` (lines 1185-1186). Find:

```css
   text needs. [data-copied] is not a hover-only state: MessageBubble.tsx holds
   it for 1600ms after every copy, and it is the state that renders "Copied". */
```

Replace with:

```css
   text needs. [data-copied] is not a hover-only state: CodeBlock (lib/markdown.tsx)
   holds it for 1600ms after every copy; it is the state that renders "Copied". */
```

(b) `pwa/design/audit.mjs`, three substrings, each unique in the file and each inside one line's `why` string; replace the substring only, leaving the rest of its line as it is.

Line 491 (`'chat.css .code-block-copy'`). Find: `not on the bare well: MessageBubble.tsx renders it inside that div.` Replace with: `not on the bare well: CodeBlock (lib/markdown.tsx) renders it inside that div.`

Line 608 (`'chat.css .code-block-lang'`). Find: `sibling inside .code-block-bar (MessageBubble.tsx) and takes` Replace with: `sibling inside .code-block-bar (CodeBlock, lib/markdown.tsx) and takes`

Line 616 (`'chat.css .compaction-raw'`). Find: `INSIDE the card (MessageBubble.tsx:285), and .compaction-body paints nothing` Replace with: `INSIDE the card (FoldedCard, MessageBubble.tsx), and .compaction-body paints nothing`

Check: `grep -c 'MessageBubble' pwa/src/session/chat.css` prints `0`; `grep -c 'MessageBubble' pwa/design/audit.mjs` prints `1` (the `.compaction-raw` line, which now names the symbol); `grep -c 'CodeBlock (lib/markdown.tsx)\|CodeBlock, lib/markdown.tsx' pwa/design/audit.mjs` prints `2`.

- [ ] **Step 7: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests` is a known load flake, and `contrast.test.ts`'s spawned-gate cases can time out at 5 s on a loaded box: a red there is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (the `remarkPlugins` site type-checks `remarkAlerts`'s transformer; `MessageBubble.tsx` has no unused import).

Run: `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts test/tap-targets.test.tsx )`
Expected: `Test Files  2 passed (2)`, `Tests  297 passed (297)` (the same count as before Step 6; re-derive it with this command at Step 0's state if it differs on your box).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (the count Task 1 measured; this task adds no case to it). The file is not edited.

Run: `for n in remarkAlerts CodeBlock TableWrap isImageUrl openExternal absolute; do printf '%s: ' $n; grep -rlE "(function|const) $n\b" pwa/src server/src shared agent/src | tr '\n' ' '; echo; done`
Expected: `remarkAlerts: pwa/src/lib/remarkAlerts.ts`, and `pwa/src/lib/markdown.tsx` as the one holder of each of the other five: the move left exactly one declaration of each.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the three new files.

Run: `git add pwa/src/lib/markdown.tsx pwa/src/lib/remarkAlerts.ts pwa/test/remark-alerts.test.ts pwa/src/session/MessageBubble.tsx pwa/src/session/chat.css pwa/design/audit.mjs && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 8: Commit.**

```bash
git add pwa/src/lib/markdown.tsx pwa/src/lib/remarkAlerts.ts pwa/test/remark-alerts.test.ts pwa/src/session/MessageBubble.tsx pwa/src/session/chat.css pwa/design/audit.mjs
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: extract lib/markdown.tsx and an iterative remarkAlerts; chat renders through ChatMarkdown (docs W4)" \
  -m "MessageBubble's Markdown code moves to lib/markdown.tsx with its text unchanged (IMG_EXT, isImageUrl, absolute, openExternal, the hljs registration, LANG_LABEL, nodeText, keystrokeParts, CodeBlock, TableWrap), mdComponents splits into SHARED_COMPONENTS (code, pre, table) and CHAT_COMPONENTS (those plus a and img), and both Markdown sites render through ChatMarkdown with the plugin order kept; every golden file is byte-identical. remarkAlerts moves to lib/remarkAlerts.ts, React-free, with tag() unchanged and the recursive walk replaced by an explicit stack in the same pre-order, tag() before children: remark-alerts.test.ts holds it to the old walk as an oracle over generated trees 1-40 deep and over the order of every type read, and a 50 000-deep chain completes where the oracle throws RangeError. chat.css and audit.mjs name CodeBlock and FoldedCard by symbol." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `6`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in the file at this task's state; W4-T1-M1 through W4-T1-M9 RE-ANCHOR Task 1's rows of the same ids on the moved code, and Task 12 keeps these, the last occurrence; W4-T1-M10..M12 stand as Task 1 wrote them):

```json
[
 {
  "id": "W4-T2-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/remarkAlerts.ts",
  "old": "  return (tree: unknown): void => {\n    // eslint-disable-next-line @typescript-eslint/no-explicit-any\n    const stack: any[] = [tree];\n    while (stack.length > 0) {\n      const node = stack.pop();\n      if (node.type === 'blockquote') tag(node);\n      const children = node.children;\n      if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);\n    }\n  };\n",
  "new": "  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  const walk = (node: any): void => {\n    if (node.type === 'blockquote') tag(node);\n    if (node.children) for (const c of node.children) walk(c);\n  };\n  return (tree: unknown): void => walk(tree);\n",
  "tests": [
   "test/remark-alerts.test.ts"
  ],
  "red": "pwa remark-alerts: 1 failed | 5 passed (6) — 'remarkAlerts completes and tags every level' (expected [Function] to not throw an error but 'RangeError: Maximum call stack size exceeded' was thrown); the differential, the order cases and the control stay green"
 },
 {
  "id": "W4-T2-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/remarkAlerts.ts",
  "old": "      if (children) for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);",
  "new": "      if (children) for (let i = 0; i < children.length; i += 1) stack.push(children[i]);",
  "tests": [
   "test/remark-alerts.test.ts"
  ],
  "red": "pwa remark-alerts: 1 failed | 5 passed (6) — 'remarkAlerts reads types in the same order: pre-order, document order, tag before children' (C is visited before A; the differential stays green: order never changes the output)"
 },
 {
  "id": "W4-T2-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/remarkAlerts.ts",
  "old": "      if (node.type === 'blockquote') tag(node);\n      const children = node.children;\n",
  "new": "      const children = node.children ? [...node.children] : undefined;\n      if (node.type === 'blockquote') tag(node);\n",
  "tests": [
   "test/remark-alerts.test.ts"
  ],
  "red": "pwa remark-alerts: 1 failed | 5 passed (6) — 'remarkAlerts reads types in the same order: pre-order, document order, tag before children' (the emptied lead paragraph A.p is visited after tag(A) dropped it)"
 },
 {
  "id": "W4-T1-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkGfm]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 4 failed | 165 passed (169), Snapshots 4 failed — callout-emptied-lead, callout-nested, callouts-all-kinds, recap-opened (both sites now share ChatMarkdown's list)"
 },
 {
  "id": "W4-T1-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 6 failed | 163 passed (169), Snapshots 6 failed — gfm-footnote, gfm-strikethrough, gfm-table, gfm-task-list, links (the www. autolink literal), recap-opened (its table and strikethrough)"
 },
 {
  "id": "W4-T1-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "hljs.registerAliases(['zsh', 'shell'], { languageName: 'bash' });",
  "new": "hljs.registerAliases(['zsh'], { languageName: 'bash' });",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 1 failed — lang-shell; 'measures a non-empty grammar list, every listed alias resolves and no unregistered tag does' (shell no longer resolves)"
 },
 {
  "id": "W4-T1-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  bash, typescript, javascript, json, python, css, xml,\n",
  "new": "  typescript, javascript, json, python, css, xml,\n",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 5 failed | 161 passed (166), Snapshots 3 failed — lang-sh, lang-shell, lang-zsh; 'every stored golden file belongs to a case' (lang-bash.html is orphaned); 'measures a non-empty grammar list, every listed alias resolves and no unregistered tag does' (the lang-bash case and its two bounds are gone, hence 166)"
 },
 {
  "id": "W4-T1-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "      <a href={href} target=\"_blank\" rel=\"noopener noreferrer\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "new": "      <a href={href} target=\"_blank\" rel=\"noopener\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 2 failed — gfm-footnote, links"
 },
 {
  "id": "W4-T1-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "<img src={src} alt={alt ?? ''} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={src} alt={alt ?? ''} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — images-https"
 },
 {
  "id": "W4-T1-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "<img src={href} alt={name} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={href} alt={name} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — links (the auto-embedded image-file link and bare image URL)"
 },
 {
  "id": "W4-T1-M8",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "      {streaming && <span className=\"stream-caret\" aria-hidden=\"true\" />}\n",
  "new": "",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — streaming-caret"
 },
 {
  "id": "W4-T1-M9",
  "pkg": "pwa",
  "file": "pwa/src/session/MessageBubble.tsx",
  "old": "            <ChatMarkdown text={text} />",
  "new": "            {text}",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — recap-opened alone (the FoldedCard site; every assistant-site case stays green)"
 }
]
```

---

### Task 3: The pure pipeline: markdownLimits, the pre-scan, parseMarkdown and its outcomes, and the five direct dependencies

**Model routing:** `sonnet`, effort `high` — new, pure, React-free code with exact spec shapes (the eight-arm `ParseOutcome`, the pre-scan's fence and marker rules, two explicit-stack walks) and a dependency edit whose lockfile diff must stay inside one JSON object. Every number below was measured on the shared scratch tree at Task 2's state, the mutations in a separate copy.

**Spec rows:** M4.P1 (`'>'.repeat(10000) + ' x'` gives `refused/container-depth`; control: the pipeline without the pre-scan gives `threw RangeError`; mutation: delete the pre-scan), M4.P2 (a 4 096-run of `*` gives `refused/delimiter-run`; mutation: delete the run check), M4.P3 (the ten largest docs under `docs/superpowers` pre-scan ok; mutation: lower either limit to 2), M4.P4 (nested emphasis 100 deep passes the pre-scan and gives `too-deep`; mutation: delete the check), M4.P12's W4 half (an `hr` x 90 000 fixture and an autolink fixture, each under 512 KiB, give `too-wide`; a real 500 KiB prose doc gives a tree; mutations: delete the count, count only one element kind). Refinements (f) (`profile` labels and does not branch), (g) (`DOCS_PARSE_BUDGET_MS` as an arrow, `utf8ByteLength` in `markdownGuard.ts`, `parseWithoutPrescan`), (p) (the lock's root list alone), (q) (hast types through `@types/hast`) and (x) (the purity and declared-once scans are PWA tests on TypeScript's parser). M4.P1's note and M4.P7's chat half are Task 6's; M4.P6's budget points are Task 5's; M4.P12's `renderHast` spy and the "still renders" half are W5's (refinement (a)).

**Files:**
- Create: `pwa/src/lib/markdownLimits.ts` — 30 lines: the eleven limits of section 4.9's table, imports nothing.
- Create: `pwa/src/lib/markdownGuard.ts` — 152 lines: `PrescanResult`, `PrescanLimits`, `prescanWithin`, `prescanMarkdown`, `utf8ByteLength`; imports only `markdownLimits.ts`.
- Create: `pwa/src/lib/markdownParse.ts` — 132 lines: `MarkdownProfile`, `ParseOutcome`, `settleHast`, `parseMarkdown`, `parseWithoutPrescan`. Task 5 appends the worker protocol and `answerMarkdownJob` to it.
- Create: `pwa/test/markdown-limits.test.ts` — 108 lines, 24 cases: every value, and each name declared once across `pwa/src` and `shared` (TS AST).
- Create: `pwa/test/markdown-guard.test.ts` — 164 lines, 46 cases: M4.P1, M4.P2, the fence and marker rules, `utf8ByteLength`, M4.P3.
- Create: `pwa/test/markdown-parse.test.ts` — 173 lines, 13 cases: M4.P1's control, M4.P4, M4.P12, raw HTML, `position`, profiles, the iterative walks.
- Create: `pwa/test/markdown-purity.test.ts` — 86 lines, 7 cases: the worker closure (`ts.preProcessFile`) and the five exact pins. Task 5 adds `markdownWorker.ts` to its `ROOTS`.
- Modify: `pwa/package.json` — the `dependencies` object (lines 15-25 at Task 2's state, a hint): five exact entries inserted in alphabetical order. 11 entries become 16.
- Modify: `pwa/package-lock.json` — `packages[""].dependencies` only (lines 11-21, a hint): the same five entries. No other byte of the lock changes (refinement (p)).
- Test: the four new files; guards `pwa/test/markdown-golden.test.tsx` and `pwa/test/message-links.test.tsx` (unmodified), the PWA `tsc`, `server/test/license.test.ts`, `server/test/oss-metadata.test.ts`, `server/test/node-floor.test.ts`, `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts` (not edited), `server/test/build-release.test.ts`, `server/test/ci-pipeline.test.ts`, `server/test/ci-select-tests.test.ts`, `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`.

Every Find block below is quoted from the file as Task 2 left it (Tasks 1 and 2 edit neither `package.json` nor the lock, so this is `BASE` for both) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes: `unified` (`unified`, `type PluggableList`), `remark-parse` (default), `remark-gfm` (default), `remark-rehype` (default, options `{ allowDangerousHtml: true }`), `remarkAlerts` from Task 2's `./remarkAlerts`; `import type { Root as HastRoot } from 'hast'` (refinement (q)); in tests only, `typescript` (pwa's own devDependency: `ts.preProcessFile`, `ts.createSourceFile`), `node:fs`, `node:path`, and Task 1's `CHAT_CORPUS` and `RECAP_CASE` from `./markdownCorpus`.
- Produces, in `pwa/src/lib/markdownLimits.ts` (imports nothing):
  - `export const MD_MAX_CONTAINER_DEPTH = 32;` `export const MD_MAX_DELIMITER_RUN = 64;` `export const MD_MAX_TREE_DEPTH = 64;` `export const DOCS_MAX_RENDER_ELEMENTS = 20000;` `export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536;` `export const DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524288;` `export const DOCS_PARSE_BUDGET_MS = (bytes: number): number => Math.min(10000, 2000 + 1000 * Math.floor(bytes / 65536));` `export const DOCS_PARSE_BUDGET_LARGE_MS = 30000;` `export const DOCS_RENDER_GATE_BYTES = 524288;` `export const CHAT_SYNC_MAX_BYTES = 4096;` `export const CHAT_PARSE_BUDGET_MS = 2000;`
- Produces, in `pwa/src/lib/markdownGuard.ts`:
  - `export type PrescanResult = { ok: true } | { ok: false; why: 'container-depth' | 'delimiter-run'; line: number; value: number };` — `line` is 1-based (LF, CRLF and CR each end a line); `value` is the refusing line's whole container depth or its longest run.
  - `export interface PrescanLimits { readonly containerDepth: number; readonly delimiterRun: number }`
  - `export function prescanWithin(src: string, limits: PrescanLimits): PrescanResult` — the scan at the given limits. Production calls it only through `prescanMarkdown`; M4.P3's vacuity case calls it with lower limits to measure the real set with the real scanner.
  - `export function prescanMarkdown(src: string): PrescanResult` — `prescanWithin` at `MD_MAX_CONTAINER_DEPTH` and `MD_MAX_DELIMITER_RUN`.
  - `export function utf8ByteLength(s: string): number` — `TextEncoder`'s byte count without allocating (a lone surrogate is 3).
- Produces, in `pwa/src/lib/markdownParse.ts`:
  - `export type MarkdownProfile = 'chat' | 'docs';`
  - `export type ParseOutcome = { kind: 'tree'; tree: HastRoot; depth: number } | { kind: 'refused'; why: 'container-depth' | 'delimiter-run'; line: number; value: number } | { kind: 'too-deep'; depth: number } | { kind: 'too-wide'; elements: number } | { kind: 'threw'; error: string } | { kind: 'timeout'; budgetMs: number } | { kind: 'worker-unavailable' } | { kind: 'worker-failed'; error: string };` — verbatim from section 4.10; the last three are produced by Task 5's runner, never here. `depth` counts nodes below the root on the deepest path (root 0; `# hi` is 2: root > h1 > text).
  - `export function settleHast(tree: HastRoot): ParseOutcome` — steps 3 and 4 over a hast tree, in place (raw to text, drop `position`, depth and element count; `too-deep` before `too-wide`). Exported so a test can hand it a 100 000-deep tree no Markdown source can produce.
  - `export function parseMarkdown(src: string, profile: MarkdownProfile = 'chat'): ParseOutcome` — the five steps; never throws.
  - `export function parseWithoutPrescan(src: string): ParseOutcome` — steps 2-5 with the `'chat'` profile; M4.P1's control, never a production path.

**Decisions this task makes (none departs from the spec's text):**
1. **Two test seams beyond the architecture's list, each with one stated purpose.** `settleHast` (steps 3 and 4 alone) exists because the parser itself overflows near 3 000 levels, so no Markdown input can carry a 100 000-deep tree into the walks the spec requires to be iterative. `prescanWithin`/`PrescanLimits` exist because M4.P3's vacuity case must measure how deep and how long the real set goes with the scanner that ships, not with a second copy of it in a test. `prescanMarkdown`'s signature is the spec's.
2. **The pre-scan's silences, each filled by CommonMark's own rule and pinned by a case.** A fence opens at up to 3 spaces with 3 or more backticks or tildes; a backtick fence whose info string holds a backtick opens nothing (CommonMark: such a line is inline code, so treating it as a fence would let a deep line after it reach the parser unscanned); a fence closes on the same character, at least as long, followed only by spaces or tabs (a "```js" line inside a fence does not close it); an unclosed fence runs to the end. Fences are recognised at line start only, so a fence inside a container is scanned, never skipped (conservative). A list marker consumes the one space or tab it requires; a marker at the end of the line, `1.x`, and a 10-digit number are not markers. Both checks skip fenced lines. The first line over either limit refuses, depth checked before run.
3. **`profile` is a label held by one list.** `PLUGINS_BY_PROFILE` maps both profiles to the same `REMARK_PLUGINS` constant (`[remarkGfm, remarkAlerts]`, chat's order). The profiles case deep-equals the two profiles' outcomes, and a one-argument call, over the whole corpus, so a divergence is a deliberate edit that reds it first (refinement (f)).
4. **Step 2 is react-markdown's processor, called as react-markdown calls it:** `unified().use(remarkParse).use(PLUGINS_BY_PROFILE[profile]).use(remarkRehype, { allowDangerousHtml: true })`, then `processor.runSync(processor.parse(src), src)`, built per call as `Markdown` builds it per render (no module state). Task 4's parity row (M4.P10) holds the output to `<Markdown>`'s.
5. **`threw` carries a name, never a message:** `error.name` for anything with a string `name` (an `Error`, a `DOMException`), else the thrown value's `typeof`. M4.P1's control pins `'RangeError'` exactly, so carrying the message reds it.
6. **The dependency edit is two Find/Replace blocks, proved by a JSON diff and `npm ci`.** The five entries are exact strings (no caret) in alphabetical order in both files. `npm ci` runs in the worktree's own `pwa/`, the package's standard install (`cd pwa && npm ci`), because it is the command that refuses a `package.json` the lock does not satisfy; it never writes the lock, which the JSON diff re-run after it shows. Licence census: there is no third-party allowlist in the tree; the lock records each of the five as MIT and the commit message names them.
7. **M4.P3 keeps the spec's two mutations and adds one.** Measured over the ten largest docs: the deepest line holds 2 containers (three of the ten), the longest run is 3 (one of the ten), matching section 4.9's "real max 2" and "real max 3". So "lower the run limit to 2" reds an M4.P3 case, while "lower the container limit to 2" reds the file only through the edge cases that put 32 containers before their tail: on this set, the M4.P3 cases cannot see a container limit of 2. W4-T3-M13 lowers it to 1, which reds the three docs' cases; the vacuity case asserts both measured maxima every run, so a set that stops reaching them is a red, never a silent pass.
8. **The purity scan reads imports only.** `ts.preProcessFile` lists static imports, re-exports, `import()` and `require`; `hast` and `mdast` are allowed because their only packages are `@types/*` (a runtime import of either cannot resolve). A DOM global used without an import is not seen by it (the worker, which has no DOM, is where it would fail), and the file says so. The same file pins the five exact versions in `package.json`, the lock's root and the installed lock entry, which is the five-pin guard's red.
9. **The declared-once scan is a real parser with its evasions listed.** `ts.createSourceFile` over every `.ts`/`.tsx` under `pwa/src` and `shared` counts variable declarations (destructured and `declare const` included), functions, classes, enums, interfaces and type aliases; its header lists what it cannot see (an object property or enum member with the name, a parameter, a renamed import, the value under another name) as not exhaustive.

**Measured while planning** (the shared scratch tree at Task 2's state; the mutations in a separate copy):
1. **Dependencies**: the JSON diff prints exactly the five `packages,"",dependencies,<name>` lines; `npm ci --no-audit --no-fund` exits 0 (`added 576 packages`) and leaves the diff unchanged; each of the five is MIT in the lock; all five are already installed at their pinned versions (the lock held them as transitive dependencies of `react-markdown`).
2. **RED** (sources absent): three `Error: Failed to resolve import "../src/lib/markdown{Limits,Guard,Parse}" ...` and `Error: ENOENT: no such file or directory, open '.../pwa/src/lib/markdownParse.ts'` from the purity file, `Test Files  4 failed (4)`, `Tests  no tests`.
3. **GREEN**: `Test Files  4 passed (4)`, `Tests  90 passed (90)` (24 + 46 + 13 + 7), `Type Errors  no errors`; the parse file takes about 9 s (the 90 000 `hr` fixture 3.7 s, the 22 000 autolinks 3.3 s), so those cases carry a 60 s timeout.
4. **Controls and fixtures**: without the pre-scan the parser returns `too-deep` at 2 000 levels of `>` and throws `RangeError` at 3 000 and at 10 000; nested emphasis of 62 levels is a tree of depth 64, 63 levels is `too-deep` 65, 100 levels is `too-deep` 102, and each passes the pre-scan (no run over 1); `'---\n'` x 20 000 is a tree and x 20 001 is `too-wide` 20 001; the largest `.md` under `docs/superpowers` is `plans/2026-10-05-ccrc-history-w1-capture.md` (1 731 126 bytes), and its cut at the last newline before 500 KiB (511 992 bytes) is a tree 8 deep with 3 947 elements, parsed in about 1.1 s; over all 298 `.md` files the deepest container line is 2 and the longest run 3.
5. **Guards**: PWA `tsc` clean; `markdown-golden` + `message-links` under `CI=1` `Tests  175 passed (175)` with no golden file moved; the whole PWA suite `Test Files  115 passed (115)`, `Tests  3720 passed (3720)`; `license` + `oss-metadata` + `node-floor` `Tests  50 passed (50)`; `build-release` + `ci-pipeline` + `ci-select-tests` `Tests  127 passed (127)`; `single-definition` `Tests  523 passed (523)` (unchanged: no name W4 adds collides with a scanned one); `typecheck-tests` 10 of 12 in the scratch tree, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules` (`Cannot find module 'ws'`), as at Tasks 1 and 2, with `pwa/ is clean under tsconfig.json` green over the seven new files; `source-bytes` + `topology-clean` `Tests  57 passed (57)` (the scratch tree, which has no `origin`, ran it with `CCRC_HISTORY_BASE` at its base commit).
6. **Mutations**: 35 rows, each measured red in a separate copy (`git archive HEAD | tar -x -C <copy>`, `git -C <copy> init -q`, `pwa/node_modules` linked in), restored after each with `git checkout -- <file>`; `git status --porcelain` in the copy was empty after every one.

- [ ] **Step 0: Confirm the state and claim the two package files.** From the worktree root, foreground.

Run: `test -e pwa/src/lib/markdown.tsx && test -e pwa/src/lib/remarkAlerts.ts && test -e pwa/test/markdownCorpus.ts && test ! -e pwa/src/lib/markdownLimits.ts && test ! -e pwa/src/lib/markdownGuard.ts && test ! -e pwa/src/lib/markdownParse.ts && test ! -e pwa/test/markdown-purity.test.ts && git diff --quiet HEAD -- pwa && ! grep -q '"unified"' pwa/package.json && echo T3-STATE-OK`
Expected: `T3-STATE-OK` (Task 2 is committed, the tree is clean under `pwa/`, and none of this task's files or dependencies exists). If it does not print, stop and put an ask to the coordinator.

Run: `( cd pwa && node -e 'const l=require("./package-lock.json");for(const n of ["hast-util-to-jsx-runtime","html-url-attributes","remark-parse","remark-rehype","unified"]){const p=l.packages["node_modules/"+n]||{};console.log(n+" "+p.version+" "+p.license+(p.dev?" dev":"")+(p.peer?" peer":""))}' )`
Expected exactly:

```
hast-util-to-jsx-runtime 2.3.6 MIT
html-url-attributes 3.0.1 MIT
remark-parse 11.0.0 MIT
remark-rehype 11.1.2 MIT
unified 11.0.5 MIT
```

The lock already holds each at the version section 4.1 pins, as a production (neither `dev` nor `peer`) transitive dependency, so the edit below adds no package and flips no flag. Any other line: stop and ask.

Then take the claims on `pwa/package.json` and `pwa/package-lock.json` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`). A 409 names the holder: mail it through the response's `mailHint` and edit neither file until that claim ends or the two coordinators confirm a scoped agreement.

- [ ] **Step 1: The five direct dependencies, first, so the red below is a test red and not a resolve failure.**

(a) In `pwa/package.json` (lines 15-25). Find:

```json
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "framer-motion": "^12.0.0",
    "highlight.js": "^11.11.1",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-markdown": "^10.1.0",
    "react-virtuoso": "^4.15.0",
    "remark-gfm": "^4.0.0",
    "vaul": "^1.1.2",
    "zustand": "^5.0.0"
```

Replace with:

```json
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "framer-motion": "^12.0.0",
    "hast-util-to-jsx-runtime": "2.3.6",
    "highlight.js": "^11.11.1",
    "html-url-attributes": "3.0.1",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-markdown": "^10.1.0",
    "react-virtuoso": "^4.15.0",
    "remark-gfm": "^4.0.0",
    "remark-parse": "11.0.0",
    "remark-rehype": "11.1.2",
    "unified": "11.0.5",
    "vaul": "^1.1.2",
    "zustand": "^5.0.0"
```

(b) In `pwa/package-lock.json`, inside `packages[""]` (lines 11-21). Find:

```json
        "@xterm/addon-fit": "^0.11.0",
        "@xterm/xterm": "^6.0.0",
        "framer-motion": "^12.0.0",
        "highlight.js": "^11.11.1",
        "react": "^19.2.7",
        "react-dom": "^19.2.7",
        "react-markdown": "^10.1.0",
        "react-virtuoso": "^4.15.0",
        "remark-gfm": "^4.0.0",
        "vaul": "^1.1.2",
        "zustand": "^5.0.0"
```

Replace with:

```json
        "@xterm/addon-fit": "^0.11.0",
        "@xterm/xterm": "^6.0.0",
        "framer-motion": "^12.0.0",
        "hast-util-to-jsx-runtime": "2.3.6",
        "highlight.js": "^11.11.1",
        "html-url-attributes": "3.0.1",
        "react": "^19.2.7",
        "react-dom": "^19.2.7",
        "react-markdown": "^10.1.0",
        "react-virtuoso": "^4.15.0",
        "remark-gfm": "^4.0.0",
        "remark-parse": "11.0.0",
        "remark-rehype": "11.1.2",
        "unified": "11.0.5",
        "vaul": "^1.1.2",
        "zustand": "^5.0.0"
```

(c) Prove the lock edit is the root list alone (refinement (p)), against the committed lock (Task 2's commit, whose lock is `BASE`'s):

Run: `( cd pwa && node -e 'const {execFileSync}=require("node:child_process");const fs=require("node:fs");const a=JSON.parse(execFileSync("git",["show","HEAD:pwa/package-lock.json"],{encoding:"utf8",maxBuffer:1<<26}));const b=JSON.parse(fs.readFileSync("package-lock.json","utf8"));const out=[];const walk=(x,y,p)=>{if(JSON.stringify(x)===JSON.stringify(y))return;if(x&&y&&typeof x==="object"&&typeof y==="object"){for(const k of new Set([...Object.keys(x),...Object.keys(y)]))walk(x[k],y[k],p.concat(k));return}out.push(JSON.stringify(p)+": "+JSON.stringify(x)+" -> "+JSON.stringify(y))};walk(a,b,[]);console.log(out.join("\n"))' )`
Expected exactly:

```
["packages","","dependencies","hast-util-to-jsx-runtime"]: undefined -> "2.3.6"
["packages","","dependencies","html-url-attributes"]: undefined -> "3.0.1"
["packages","","dependencies","remark-parse"]: undefined -> "11.0.0"
["packages","","dependencies","remark-rehype"]: undefined -> "11.1.2"
["packages","","dependencies","unified"]: undefined -> "11.0.5"
```

(d) Install from the lock. Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && npm ci --no-audit --no-fund ); echo "rc=$?"`
Expected: `added <N> packages` (576 at planning; npm may print deprecation warnings) and `rc=0`. A non-zero rc means `package.json` and the lock disagree: fix the edit, never regenerate the lock (a regenerated lock also adds `license` and `engines` to its root, refinement (p)). Then re-run (c): the same five lines (`npm ci` never writes the lock), and `git status --porcelain pwa` prints exactly ` M pwa/package-lock.json` and ` M pwa/package.json`.

(e) `git diff --numstat pwa/package.json pwa/package-lock.json` prints `5	0	pwa/package-lock.json` and `5	0	pwa/package.json`.

- [ ] **Step 2: Write the failing tests.** Create the four files with exactly this content.

`pwa/test/markdown-limits.test.ts`:

```ts
// Every PWA render limit (native Docs reader, W4 Task 3; design 2026-10-01 section 4.9's table): each value pinned,
// and each name declared exactly once, in `src/lib/markdownLimits.ts`, across `pwa/src` and `shared`.
// `DOCS_PARSE_BUDGET_MS` is a formula of a byte count; its points are M4.P6's, in `markdown-runner.test.ts`.
//
// The declared-once scan reads declarations through TypeScript's own parser: a `const`/`let`/`var` (a destructured
// binding and a `declare const` included), a function, a class, an enum, an interface or a type alias named like a
// limit counts as a declaration. Known evasions, NOT EXHAUSTIVE: an object property or enum member with the name,
// a parameter, an import renamed to it, and the value spelled under any other name (a bare `4096`) are not
// declarations of the name and are not seen here.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as limits from '../src/lib/markdownLimits';

const VALUES: Readonly<Record<string, number>> = {
  MD_MAX_CONTAINER_DEPTH: 32,
  MD_MAX_DELIMITER_RUN: 64,
  MD_MAX_TREE_DEPTH: 64,
  DOCS_MAX_RENDER_ELEMENTS: 20000,
  MD_HIGHLIGHT_BLOCK_MAX_CHARS: 65536,
  DOCS_HIGHLIGHT_PAGE_MAX_CHARS: 524288,
  DOCS_PARSE_BUDGET_LARGE_MS: 30000,
  DOCS_RENDER_GATE_BYTES: 524288,
  CHAT_SYNC_MAX_BYTES: 4096,
  CHAT_PARSE_BUDGET_MS: 2000,
};
const NAMES: readonly string[] = [...Object.keys(VALUES), 'DOCS_PARSE_BUDGET_MS'].sort();

describe('markdownLimits: the values of section 4.9', () => {
  it.each(Object.entries(VALUES))('%s is %d', (name, value) => {
    expect((limits as Record<string, unknown>)[name]).toBe(value);
  });

  it('DOCS_PARSE_BUDGET_MS is a function of a byte count', () => {
    expect(typeof limits.DOCS_PARSE_BUDGET_MS).toBe('function');
  });

  it('exports exactly the eleven limits', () => {
    expect(Object.keys(limits).sort()).toEqual(NAMES);
  });
});

const PWA = path.join(import.meta.dirname, '..');
const REPO = path.join(PWA, '..');
const SCAN_ROOTS = [path.join(PWA, 'src'), path.join(REPO, 'shared')];

/** Every `.ts`/`.tsx` file under `dir`, by an explicit-stack walk. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') dirs.push(p);
      } else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

/** The names a binding declares: an identifier, or every identifier inside a destructuring pattern. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const el of name.elements) if (!ts.isOmittedExpression(el)) out.push(...boundNames(el.name));
  return out;
}

/** Every name `file` declares at any depth, through TypeScript's parser. */
function declaredNames(file: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (ts.isVariableDeclaration(node)) out.push(...boundNames(node.name));
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)
        || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && node.name !== undefined
    ) out.push(node.name.text);
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return out;
}

describe('markdownLimits: each limit is declared once, in lib/markdownLimits.ts', () => {
  const files = SCAN_ROOTS.flatMap(sourceFiles);
  const holders = new Map<string, string[]>(NAMES.map((n) => [n, []]));
  for (const file of files) {
    for (const name of declaredNames(file)) holders.get(name)?.push(path.relative(REPO, file).split(path.sep).join('/'));
  }

  it('reads both roots', () => {
    expect(files.some((f) => f.includes(`${path.sep}shared${path.sep}`))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(NAMES)('%s has exactly one declaration, in pwa/src/lib/markdownLimits.ts', (name) => {
    expect(holders.get(name)).toEqual(['pwa/src/lib/markdownLimits.ts']);
  });
});
```

`pwa/test/markdown-guard.test.ts`:

```ts
// The Markdown pre-scan and the UTF-8 byte count (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and
// section 4.15's M4.P1, M4.P2, M4.P3). `prescanMarkdown` refuses a line with more than 32 container markers or a run
// of more than 64 `*` or `_`, skips fenced blocks for both checks, and reports the FIRST refusing line (1-based)
// with that line's whole count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prescanMarkdown, prescanWithin, utf8ByteLength } from '../src/lib/markdownGuard';
import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from '../src/lib/markdownLimits';

const deepQuote = (n: number): string => '> '.repeat(n) + 'x';
const ok = { ok: true };

describe('M4.P1: container depth', () => {
  it("'>'.repeat(10000) + ' x' is refused on line 1 with its whole depth", () => {
    expect(prescanMarkdown('>'.repeat(10000) + ' x')).toEqual({
      ok: false, why: 'container-depth', line: 1, value: 10000,
    });
  });

  it('32 levels pass and 33 are refused', () => {
    expect(prescanMarkdown(deepQuote(32))).toEqual(ok);
    expect(prescanMarkdown(deepQuote(33))).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it.each([
    ['-', '- '], ['+', '+ '], ['*', '* '], ['1.', '1. '], ['9)', '9) '], ['- then a tab', '-\t'], ['123456789.', '123456789. '],
  ])('the list marker %s counts as a container', (_label, marker) => {
    expect(prescanMarkdown(marker.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it.each([
    ['1.x (no space after the marker)', '1.x'],
    ['a ten-digit marker', '1234567890. x'],
    ['a marker at the end of the line', '-'],
    ['a marker followed by text', '-x'],
  ])('%s is not a container', (_label, tail) => {
    expect(prescanMarkdown('> '.repeat(32) + tail)).toEqual(ok);
  });

  it('skips up to three spaces before a marker, never four', () => {
    expect(prescanMarkdown('   > '.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    expect(prescanMarkdown('> ' + '    >'.repeat(40))).toEqual(ok);
  });

  it('numbers lines across LF, CRLF and CR, and reports the first refusing line', () => {
    expect(prescanMarkdown(`a\nb\n${deepQuote(40)}\n${deepQuote(50)}`)).toEqual({
      ok: false, why: 'container-depth', line: 3, value: 40,
    });
    expect(prescanMarkdown(`a\r\nb\r\n${deepQuote(40)}`)).toMatchObject({ line: 3 });
    expect(prescanMarkdown(`a\rb\r${deepQuote(40)}`)).toMatchObject({ line: 3 });
    expect(prescanMarkdown(`a\r\n\rb\n${deepQuote(40)}`)).toMatchObject({ line: 4 });
  });
});

describe('M4.P2: delimiter runs', () => {
  it.each(['*', '_'])('a 4 096-run of %s is refused with its length', (ch) => {
    expect(prescanMarkdown(ch.repeat(4096))).toEqual({ ok: false, why: 'delimiter-run', line: 1, value: 4096 });
  });

  it('a 64-run passes and a 65-run is refused', () => {
    expect(prescanMarkdown(`a${'*'.repeat(64)}a`)).toEqual(ok);
    expect(prescanMarkdown(`a\nb${'_'.repeat(65)}b`)).toEqual({ ok: false, why: 'delimiter-run', line: 2, value: 65 });
  });

  it('a run is one character repeated: alternating marks never make one', () => {
    expect(prescanMarkdown('*_'.repeat(4096))).toEqual(ok);
  });
});

describe('fenced blocks are skipped for both checks', () => {
  const deep = '>'.repeat(100);
  const run = '*'.repeat(100);

  it('a backtick fence and a longer tilde fence hide deep lines and long runs', () => {
    expect(prescanMarkdown(`\`\`\`\n${deep}\n${run}\n\`\`\`\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`~~~~ text\n${deep}\n~~~~\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`   \`\`\`\n${deep}\n   \`\`\``)).toEqual(ok);
  });

  it('after the closing fence, lines are scanned again', () => {
    expect(prescanMarkdown(`\`\`\`\nx\n\`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 4, value: 100 });
  });

  it('an unclosed fence runs to the end', () => {
    expect(prescanMarkdown(`\`\`\`\n${deep}\n${run}\n${deep}`)).toEqual(ok);
  });

  it('a shorter fence, the other character, or a fence with text after it does not close', () => {
    expect(prescanMarkdown(`\`\`\`\`\n\`\`\`\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n~~~\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\` js\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\`  \t\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 3, value: 100 });
  });

  it('four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick', () => {
    expect(prescanMarkdown(`    \`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`\`\`\`a\`b\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`~~~a\`b\n${deep}`)).toEqual(ok);
  });
});

describe('utf8ByteLength counts what TextEncoder writes', () => {
  const ch = (...codes: number[]): string => String.fromCharCode(...codes);
  it.each([
    ['empty', ''],
    ['ASCII', 'plain text, 123'],
    ['two-byte', String.fromCodePoint(0xe9, 0x3b1)],
    ['three-byte', String.fromCodePoint(0x20ac, 0x2318)],
    ['four-byte', String.fromCodePoint(0x1f600, 0x10ffff)],
    ['a lone high surrogate', ch(0x61, 0xd800, 0x62)],
    ['a lone low surrogate', ch(0xdc00)],
    ['a high surrogate at the end', ch(0x61, 0xd83d)],
    ['a reversed pair', ch(0xde00, 0xd83d)],
    ['mixed', `a${String.fromCodePoint(0xe9, 0x20ac, 0x1f600)}${ch(0xd800)}z`.repeat(50)],
  ])('%s', (_label, s) => {
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

// M4.P3: no false positives on this repo's own largest documents. A directory walk (no git), every `.md` under
// docs/superpowers, sorted by size descending and then by path; the set moves as programmes merge, so the vacuity
// case measures it each run.
const DOCS = path.join(import.meta.dirname, '..', '..', 'docs', 'superpowers');

function markdownFiles(dir: string): { file: string; size: number }[] {
  const out: { file: string; size: number }[] = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) dirs.push(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push({ file: p, size: statSync(p).size });
    }
  }
  return out.sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

const LARGEST = markdownFiles(DOCS).slice(0, 10).map(({ file }) => ({
  name: path.relative(DOCS, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

describe('M4.P3: the ten largest docs under docs/superpowers pre-scan ok', () => {
  it('there are ten', () => {
    expect(LARGEST).toHaveLength(10);
  });

  it.each(LARGEST)('$name', ({ text }) => {
    expect(prescanMarkdown(text)).toEqual(ok);
  });

  // Not vacuous: the set really nests and really runs, so a limit lowered to the set's own maximum minus one reds
  // the cases above. Measured at planning: the deepest line holds 2 containers, the longest run is 3. If either
  // fails, the set has changed shape: stop and ask the coordinator, never lower the bar here.
  it('the set reaches a container depth of 2 and a delimiter run of 3', () => {
    const refusedAt = (containerDepth: number, delimiterRun: number): number =>
      LARGEST.filter(({ text }) => !prescanWithin(text, { containerDepth, delimiterRun }).ok).length;
    expect(refusedAt(1, MD_MAX_DELIMITER_RUN)).toBeGreaterThan(0);
    expect(refusedAt(MD_MAX_CONTAINER_DEPTH, 2)).toBeGreaterThan(0);
  });
});
```

`pwa/test/markdown-parse.test.ts`:

```ts
// The parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and section 4.15's M4.P1's
// control, M4.P4 and M4.P12's W4 half). `parseMarkdown` pre-scans, runs react-markdown's own processor stage by
// stage, turns raw HTML into text, drops `position`, measures depth and elements, and never throws.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Root as HastRoot } from 'hast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseWithoutPrescan, settleHast, type ParseOutcome } from '../src/lib/markdownParse';
import { prescanMarkdown, utf8ByteLength } from '../src/lib/markdownGuard';
import { CHAT_CORPUS, RECAP_CASE } from './markdownCorpus';

interface AnyNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: AnyNode[];
}

/** Every node of `tree`, by an explicit-stack walk (a recursive walk could not visit a deep tree). */
function nodes(tree: unknown): AnyNode[] {
  const out: AnyNode[] = [];
  const stack = [tree as AnyNode];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (const c of n.children ?? []) stack.push(c);
  }
  return out;
}

const treeOf = (o: ParseOutcome): HastRoot => {
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${JSON.stringify(o)}`);
  return o.tree;
};

describe('the outcome for ordinary Markdown', () => {
  it('a heading is a tree with no position, depth 2 (root > h1 > text)', () => {
    expect(parseMarkdown('# hi')).toEqual({
      kind: 'tree',
      depth: 2,
      tree: { type: 'root', children: [{ type: 'element', tagName: 'h1', properties: {}, children: [{ type: 'text', value: 'hi' }] }] },
    });
  });

  it('no node of any corpus tree keeps a position', () => {
    for (const c of [...CHAT_CORPUS, RECAP_CASE]) {
      for (const n of nodes(treeOf(parseMarkdown(c.text)))) expect(Object.hasOwn(n, 'position'), c.name).toBe(false);
    }
  });

  it("the 'chat' and 'docs' profiles give equal outcomes over the corpus; one argument means 'chat'", () => {
    for (const c of [...CHAT_CORPUS, RECAP_CASE]) {
      const chat = parseMarkdown(c.text, 'chat');
      expect(parseMarkdown(c.text, 'docs'), c.name).toEqual(chat);
      expect(parseMarkdown(c.text), c.name).toEqual(chat);
    }
  });
});

describe('M4.P1: the pre-scan stands in front of the parser', () => {
  const src = '>'.repeat(10000) + ' x';

  it('parseMarkdown refuses it', () => {
    expect(parseMarkdown(src)).toEqual({ kind: 'refused', why: 'container-depth', line: 1, value: 10000 });
  });

  // Control (measured at planning: the parser overflows at 3 000 levels and at 10 000 in vitest's worker): the
  // same input without the pre-scan throws inside the pipeline, which reports the error's name and nothing else.
  it('control: without the pre-scan the pipeline throws RangeError, reported by name only', () => {
    expect(parseWithoutPrescan(src)).toEqual({ kind: 'threw', error: 'RangeError' });
  });
});

/** `levels` nested emphasis spans, alternating `*` and `_`, each opened as `*a ` and closed as ` a*`: no run of one
 *  mark is longer than 1, and every level is a real `em` (root > p > em x levels > text). */
function nestedEmphasis(levels: number): string {
  let open = '';
  let close = '';
  for (let i = 0; i < levels; i += 1) {
    const mark = i % 2 === 0 ? '*' : '_';
    open += `${mark}a `;
    close = ` a${mark}${close}`;
  }
  return `${open}x${close}`;
}

describe('M4.P4: tree depth', () => {
  it('nested emphasis 100 deep passes the pre-scan and is too-deep with its depth', () => {
    const src = nestedEmphasis(100);
    expect(prescanMarkdown(src)).toEqual({ ok: true });
    expect(parseMarkdown(src)).toEqual({ kind: 'too-deep', depth: 102 });
  });

  it('a tree 64 deep is a tree and 65 is too-deep', () => {
    const at = parseMarkdown(nestedEmphasis(62));
    expect(at.kind).toBe('tree');
    expect(at).toMatchObject({ depth: 64 });
    expect(parseMarkdown(nestedEmphasis(63))).toEqual({ kind: 'too-deep', depth: 65 });
  });
});

const KIB = 1024;

describe('M4.P12: the element cap (W4 half)', () => {
  it('90 000 thematic breaks under 512 KiB are too-wide with the count', () => {
    const src = '---\n'.repeat(90000);
    expect(utf8ByteLength(src)).toBeLessThan(512 * KIB);
    expect(parseMarkdown(src)).toEqual({ kind: 'too-wide', elements: 90000 });
  }, 60000);

  it('22 000 autolinks under 512 KiB are too-wide with the count (22 000 links and their paragraph)', () => {
    const src = '<https://example.com>\n'.repeat(22000);
    expect(utf8ByteLength(src)).toBeLessThan(512 * KIB);
    expect(parseMarkdown(src)).toEqual({ kind: 'too-wide', elements: 22001 });
  }, 60000);

  it('20 000 elements are a tree and 20 001 are too-wide', () => {
    expect(parseMarkdown('---\n'.repeat(20000)).kind).toBe('tree');
    expect(parseMarkdown('---\n'.repeat(20001))).toEqual({ kind: 'too-wide', elements: 20001 });
  }, 60000);

  // The largest `.md` under docs/superpowers (a directory walk, by size then path), cut at its last newline before
  // 500 KiB. At planning: plans/2026-10-05-ccrc-history-w1-capture.md, a tree 8 deep with 3 947 elements.
  it('a real 500 KiB prose doc is a tree', () => {
    const docs = path.join(import.meta.dirname, '..', '..', 'docs', 'superpowers');
    const files: { file: string; size: number }[] = [];
    const dirs = [docs];
    while (dirs.length > 0) {
      const d = dirs.pop()!;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) dirs.push(p);
        else if (e.isFile() && e.name.endsWith('.md')) files.push({ file: p, size: statSync(p).size });
      }
    }
    files.sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const bytes = readFileSync(files[0]!.file);
    expect(bytes.length).toBeGreaterThan(500 * KIB);
    const src = new TextDecoder().decode(bytes.subarray(0, bytes.lastIndexOf(0x0a, 500 * KIB) + 1));
    expect(utf8ByteLength(src)).toBeGreaterThan(450 * KIB);
    expect(parseMarkdown(src, 'docs').kind).toBe('tree');
  }, 60000);
});

describe('raw HTML renders as literal text', () => {
  it('img, script and an angle-bracket placeholder become text nodes, and no raw node is left', () => {
    const src = '<img src=x onerror=alert(1)>\n\n<script>x</script>\n\nreach <server-host> on port 22';
    const all = nodes(treeOf(parseMarkdown(src)));
    expect(all.filter((n) => n.type === 'raw')).toEqual([]);
    expect(all.filter((n) => n.type === 'element').map((n) => n.tagName)).toEqual(['p']);
    const text = all.filter((n) => n.type === 'text').map((n) => n.value).join('');
    for (const raw of ['<img src=x onerror=alert(1)>', '<script>x</script>', '<server-host>']) {
      expect(text, raw).toContain(raw);
    }
  });
});

describe('the raw step and the measuring walk keep no recursion', () => {
  it('a hand-built hast 100 000 elements deep settles as too-deep, its innermost raw node turned to text', () => {
    const DEEP = 100000;
    const root = { type: 'root', children: [] as unknown[] };
    let parent: { children: unknown[] } = root;
    for (let i = 0; i < DEEP; i += 1) {
      const el = { type: 'element', tagName: 'div', properties: {}, children: [] as unknown[], position: { start: i } };
      parent.children.push(el);
      parent = el;
    }
    parent.children.push({ type: 'raw', value: '<b>deep</b>' });
    expect(settleHast(root as unknown as HastRoot)).toEqual({ kind: 'too-deep', depth: DEEP + 1 });
    expect(parent.children[0]).toEqual({ type: 'text', value: '<b>deep</b>' });
    expect(Object.hasOwn(parent, 'position')).toBe(false);
  });
});
```

`pwa/test/markdown-purity.test.ts`:

```ts
// The parse worker's import closure stays pure (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and
// the W4 plan's ring rule): starting from the worker-side roots, every file the closure reaches imports only other
// closure files, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and the types-only `hast` and `mdast`.
// So no React, no react-dom, no highlight.js, no `../session/*`, no `./api` and no stylesheet can reach the worker.
// Specifiers are read by TypeScript's own `ts.preProcessFile` (static imports, re-exports, `import()` and
// `require`), not by a regex. `hast` and `mdast` have no runtime module (their only package is `@types/*`), so
// naming them can only ever be a type import. Task 5 adds `markdownWorker.ts` to ROOTS. It reads imports only: a DOM
// global used without an import (`window`, `document`) is not seen here, and the worker, which has no DOM, is
// where such a use would fail.
//
// The five direct dependencies the closure rests on are pinned exactly, in `package.json` and in the lock's root.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const LIB = path.join(PWA, 'src', 'lib');
const ROOTS: readonly string[] = ['markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts'];
const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  'unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'hast', 'mdast',
]);

/** The file a relative specifier names, or `undefined` when no `.ts`/`.tsx` file answers it. */
function resolveRelative(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, base, path.join(base, 'index.ts')]
    .find((p) => /\.tsx?$/.test(p) && existsSync(p));
}

/** Walks the closure from ROOTS: the files reached, and every specifier that is neither a closure file nor allowed. */
function closure(): { files: string[]; refused: string[] } {
  const seen = new Set<string>();
  const refused: string[] = [];
  const todo = ROOTS.map((r) => path.join(LIB, r));
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(PWA, file).split(path.sep).join('/');
    const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName: spec } of info.importedFiles) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target === undefined) refused.push(`${rel}: ${spec}`);
        else todo.push(target);
      } else if (!ALLOWED_PACKAGES.has(spec)) refused.push(`${rel}: ${spec}`);
    }
  }
  return { files: [...seen].map((f) => path.relative(PWA, f).split(path.sep).join('/')).sort(), refused };
}

describe('the parse worker closure', () => {
  const { files, refused } = closure();

  it('is exactly the worker-side lib files', () => {
    expect(files).toEqual(ROOTS.map((r) => `src/lib/${r}`).sort());
  });

  it('imports nothing outside the closure but unified, the three remark plugins and the hast/mdast types', () => {
    expect(refused).toEqual([]);
  });
});

const PINS: Readonly<Record<string, string>> = {
  'hast-util-to-jsx-runtime': '2.3.6',
  'html-url-attributes': '3.0.1',
  'remark-parse': '11.0.0',
  'remark-rehype': '11.1.2',
  unified: '11.0.5',
};

describe('the five direct dependencies are pinned exactly', () => {
  const pkg = JSON.parse(readFileSync(path.join(PWA, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(PWA, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };

  it.each(Object.entries(PINS))('%s is %s in package.json, in the lock root, and installed at it', (name, version) => {
    expect(pkg.dependencies[name]).toBe(version);
    expect(lock.packages['']?.dependencies?.[name]).toBe(version);
    expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
  });
});
```

Check that the writes kept every byte (an agent write can decode an escape): `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/markdown-limits.test.ts pwa/test/markdown-guard.test.ts pwa/test/markdown-parse.test.ts pwa/test/markdown-purity.test.ts` prints `0` for each file; `grep -cF "['- then a tab', '-\t']" pwa/test/markdown-guard.test.ts` prints `1`; `grep -cF '<https://example.com>\n' pwa/test/markdown-parse.test.ts` prints `1`; `grep -c 'String.fromCharCode\|String.fromCodePoint' pwa/test/markdown-guard.test.ts` prints `5` (the surrogate cases are built from code units, never typed as escapes).

- [ ] **Step 3: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts test/markdown-guard.test.ts test/markdown-parse.test.ts test/markdown-purity.test.ts )`
Expected: `FAIL  test/markdown-limits.test.ts`, `Error: Failed to resolve import "../src/lib/markdownLimits" from "test/markdown-limits.test.ts". Does the file exist?`; the same for `markdown-guard` (`../src/lib/markdownGuard`) and `markdown-parse` (`../src/lib/markdownParse`); `FAIL  test/markdown-purity.test.ts`, `Error: ENOENT: no such file or directory, open '<worktree>/pwa/src/lib/markdownParse.ts'`; then `Test Files  4 failed (4)`, `Tests  no tests`.

- [ ] **Step 4: Implement.** Create the three files with exactly this content.

`pwa/src/lib/markdownLimits.ts`:

```ts
// Every PWA render limit, declared once (native Docs reader, W4 Task 3; design 2026-10-01 section 4.9's table).
// Chat and the Docs screen import them and tests import them; nothing restates a value. `markdown-limits.test.ts`
// pins each value and holds each name to this one declaration across `pwa/src` and `shared`.
// `DOCS_MAX_IMAGES_PER_PAGE` and `DOCS_STALE_MS` live in `shared/docs.ts`, never here.
//
// Imports nothing: the parse worker's closure reaches this file (`markdown-purity.test.ts`).

/** Container markers (`>` and list markers) on one line; real docs and chat reach 2. */
export const MD_MAX_CONTAINER_DEPTH = 32;
/** The longest run of `*` or of `_`; real docs reach 3. */
export const MD_MAX_DELIMITER_RUN = 64;
/** Nodes on the deepest path of a parsed hast tree, below the root; real docs reach 9. */
export const MD_MAX_TREE_DEPTH = 64;
/** Element nodes in a parsed hast tree, both profiles. */
export const DOCS_MAX_RENDER_ELEMENTS = 20000;
/** One code block's characters, at most, that highlight.js is asked to colour. */
export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536;
/** Code characters per Docs page, at most, that highlight.js is asked to colour. */
export const DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524288;
/** The Docs parse budget for a document of `bytes` UTF-8 bytes: 2 s under 64 KiB, one more second per 64 KiB,
 *  at most 10 s. */
export const DOCS_PARSE_BUDGET_MS = (bytes: number): number => Math.min(10000, 2000 + 1000 * Math.floor(bytes / 65536));
/** The Docs parse budget after "Format anyway". */
export const DOCS_PARSE_BUDGET_LARGE_MS = 30000;
/** A Docs page over this many UTF-8 bytes asks before it formats. */
export const DOCS_RENDER_GATE_BYTES = 524288;
/** A chat message of at most this many UTF-8 bytes renders on the main thread; a longer one parses in the worker. */
export const CHAT_SYNC_MAX_BYTES = 4096;
/** The worker budget for one chat message. */
export const CHAT_PARSE_BUDGET_MS = 2000;
```

`pwa/src/lib/markdownGuard.ts`:

````ts
// The Markdown pre-scan and the UTF-8 byte count (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10).
// `prescanMarkdown` runs before any parse, in chat's synchronous path and in the parse worker: one iterative pass
// over the lines that refuses the two shapes that overflow the parser's stack, deep containers on one line and a
// long run of one emphasis delimiter. It bounds depth, not time; the worker's budget is the only time bound.
//
// Imports only `markdownLimits.ts`: the parse worker's closure reaches this file (`markdown-purity.test.ts`).
import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from './markdownLimits';

export type PrescanResult =
  | { ok: true }
  | { ok: false; why: 'container-depth' | 'delimiter-run'; line: number; value: number };

/** The open fence a line starts (up to 3 spaces, then 3 or more backticks or tildes), or `undefined`. A backtick
 *  fence's info string may not contain a backtick (CommonMark), so "```a`b" opens nothing. */
function fenceOpen(line: string): { ch: string; len: number } | undefined {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
  const ch = line[i];
  if (ch !== '`' && ch !== '~') return undefined;
  let j = i;
  while (line[j] === ch) j += 1;
  if (j - i < 3) return undefined;
  if (ch === '`' && line.indexOf('`', j) !== -1) return undefined;
  return { ch, len: j - i };
}

/** Whether `line` closes a fence of `ch` at least `len` long: up to 3 spaces, the run, then only spaces or tabs. */
function fenceCloses(line: string, ch: string, len: number): boolean {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
  let j = i;
  while (line[j] === ch) j += 1;
  if (j - i < len) return false;
  for (; j < line.length; j += 1) {
    const c = line.charCodeAt(j);
    if (c !== 0x20 && c !== 0x09) return false;
  }
  return true;
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isBlank = (c: number): boolean => c === 0x20 || c === 0x09;

/** The container depth of one line: repeatedly skip up to 3 spaces, then consume `>` (and one optional space) or
 *  a list marker (`-`, `+`, `*`, or 1-9 digits then `.` or `)`) together with the space or tab it needs. The count
 *  runs to the end of the markers, so a refusal reports the line's whole depth. */
function containerDepth(line: string): number {
  let depth = 0;
  let i = 0;
  for (;;) {
    let s = 0;
    while (s < 3 && line.charCodeAt(i) === 0x20) {
      i += 1;
      s += 1;
    }
    const c = line.charCodeAt(i);
    if (c === 0x3e /* > */) {
      i += 1;
      if (line.charCodeAt(i) === 0x20) i += 1;
      depth += 1;
      continue;
    }
    if ((c === 0x2d /* - */ || c === 0x2b /* + */ || c === 0x2a /* * */) && isBlank(line.charCodeAt(i + 1))) {
      i += 2;
      depth += 1;
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (isDigit(line.charCodeAt(j))) j += 1;
      const d = line.charCodeAt(j);
      if (j - i <= 9 && (d === 0x2e /* . */ || d === 0x29 /* ) */) && isBlank(line.charCodeAt(j + 1))) {
        i = j + 2;
        depth += 1;
        continue;
      }
    }
    return depth;
  }
}

/** The longest run of `*` or of `_` on one line (a run is one character repeated). */
function longestRun(line: string): number {
  let best = 0;
  let run = 0;
  let prev = -1;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c === 0x2a || c === 0x5f) {
      run = c === prev ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prev = c;
  }
  return best;
}

/** The two limits a pre-scan applies: the most container markers on one line and the longest delimiter run. */
export interface PrescanLimits {
  readonly containerDepth: number;
  readonly delimiterRun: number;
}

/** One pass over the lines (LF, CRLF and CR each end one), skipping fenced blocks for both checks: the first line
 *  whose container depth is over `limits.containerDepth`, or whose longest delimiter run is over
 *  `limits.delimiterRun`, refuses, with its 1-based number and its measured value. An unclosed fence runs to the
 *  end, as it does for the parser. Production calls it only through `prescanMarkdown`; tests call it with lower
 *  limits to measure how deep a real document goes. */
export function prescanWithin(src: string, limits: PrescanLimits): PrescanResult {
  const lines = src.split(/\r\n|\r|\n/);
  let fence: { ch: string; len: number } | undefined;
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n]!;
    if (fence !== undefined) {
      if (fenceCloses(line, fence.ch, fence.len)) fence = undefined;
      continue;
    }
    fence = fenceOpen(line);
    if (fence !== undefined) continue;
    const depth = containerDepth(line);
    if (depth > limits.containerDepth) return { ok: false, why: 'container-depth', line: n + 1, value: depth };
    const run = longestRun(line);
    if (run > limits.delimiterRun) return { ok: false, why: 'delimiter-run', line: n + 1, value: run };
  }
  return { ok: true };
}

/** The pre-scan at `MD_MAX_CONTAINER_DEPTH` and `MD_MAX_DELIMITER_RUN`: what runs before every parse. */
export function prescanMarkdown(src: string): PrescanResult {
  return prescanWithin(src, { containerDepth: MD_MAX_CONTAINER_DEPTH, delimiterRun: MD_MAX_DELIMITER_RUN });
}

/** The UTF-8 byte length of `s`, counted without allocating: a surrogate pair is 4 bytes, and a lone surrogate is
 *  3 (`TextEncoder` writes it as U+FFFD). */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
````

`pwa/src/lib/markdownParse.ts`:

```ts
// The Markdown parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10). `parseMarkdown` is
// pure: it runs in the parse worker and in tests, and it never throws. In order:
//   1. the pre-scan (`markdownGuard.ts`); a refusal ends here;
//   2. react-markdown's own processor, called stage by stage: remark-parse, then remark-gfm and the alert
//      callouts, then remark-rehype with raw HTML kept as `raw` nodes; `runSync(parse(src), src)`;
//   3. every `raw` node becomes a `text` node, so raw HTML renders as literal text, never as markup;
//   4. one walk drops `position` and measures the tree: deeper than `MD_MAX_TREE_DEPTH` is `too-deep`, more than
//      `DOCS_MAX_RENDER_ELEMENTS` elements is `too-wide`;
//   5. any exception is `threw`, carrying the error's name only.
// Steps 3 and 4 are explicit-stack walks: a tree that reached them is not yet known to be shallow.
//
// The worker's import closure: no React, no DOM, no highlight.js, no stylesheet (`markdown-purity.test.ts`).
import type { Root as HastRoot } from 'hast';
import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { remarkAlerts } from './remarkAlerts';
import { prescanMarkdown } from './markdownGuard';
import { DOCS_MAX_RENDER_ELEMENTS, MD_MAX_TREE_DEPTH } from './markdownLimits';

/** Who asked: a label carried through the worker protocol and the runner. The pipeline is the same for both. */
export type MarkdownProfile = 'chat' | 'docs';

export type ParseOutcome =
  | { kind: 'tree'; tree: HastRoot; depth: number }
  | { kind: 'refused'; why: 'container-depth' | 'delimiter-run'; line: number; value: number }
  | { kind: 'too-deep'; depth: number }
  | { kind: 'too-wide'; elements: number } // over DOCS_MAX_RENDER_ELEMENTS
  | { kind: 'threw'; error: string } // error.name only
  | { kind: 'timeout'; budgetMs: number } // runner only
  | { kind: 'worker-unavailable' } // runner only
  | { kind: 'worker-failed'; error: string }; // runner only

/** Chat's plugin order (`ChatMarkdown`'s list): GFM, then the alert callouts. */
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkAlerts];

/** The remark plugins by profile: one list for both. `markdown-parse.test.ts` holds the two profiles' outcomes
 *  equal, so a divergence here is a deliberate change that reds it first. */
const PLUGINS_BY_PROFILE: Readonly<Record<MarkdownProfile, PluggableList>> = {
  chat: REMARK_PLUGINS,
  docs: REMARK_PLUGINS,
};

/** A hast node as the two walks see it. */
interface WalkNode {
  type: string;
  value?: string;
  children?: WalkNode[];
  position?: unknown;
}

/** The name of whatever was thrown: `error.name` for an error (a `DOMException` included), else its `typeof`. */
function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** Step 3: every `raw` node becomes a `text` node with the same value, in place, with an explicit stack. */
function rawToText(tree: WalkNode): void {
  const stack: WalkNode[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const children = node.children;
    if (!children) continue;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };
      else if (child.children) stack.push(child);
    }
  }
}

/** Step 4: drops `position` from every node and measures the deepest node below the root (the root is 0) and
 *  the element count, in one walk with an explicit stack. */
function measure(tree: WalkNode): { depth: number; elements: number } {
  const nodes: WalkNode[] = [tree];
  const depths: number[] = [0];
  let depth = 0;
  let elements = 0;
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    const d = depths.pop()!;
    delete node.position;
    if (node.type === 'element') elements += 1;
    if (d > depth) depth = d;
    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        nodes.push(children[i]!);
        depths.push(d + 1);
      }
    }
  }
  return { depth, elements };
}

/** Steps 3 and 4 over a hast tree, in place: the outcome the pipeline gives for it. Exported so tests can hand it
 *  a tree no Markdown source could produce (a 10 000-deep one) and prove both walks keep no recursion. */
export function settleHast(tree: HastRoot): ParseOutcome {
  const node = tree as unknown as WalkNode;
  rawToText(node);
  const { depth, elements } = measure(node);
  if (depth > MD_MAX_TREE_DEPTH) return { kind: 'too-deep', depth };
  if (elements > DOCS_MAX_RENDER_ELEMENTS) return { kind: 'too-wide', elements };
  return { kind: 'tree', tree, depth };
}

/** Steps 2 to 5 for one profile. */
function run(src: string, profile: MarkdownProfile): ParseOutcome {
  try {
    const processor = unified()
      .use(remarkParse)
      .use(PLUGINS_BY_PROFILE[profile])
      .use(remarkRehype, { allowDangerousHtml: true });
    return settleHast(processor.runSync(processor.parse(src), src));
  } catch (e) {
    return { kind: 'threw', error: errorName(e) };
  }
}

/** The whole pipeline, pre-scan first. Never throws. */
export function parseMarkdown(src: string, profile: MarkdownProfile = 'chat'): ParseOutcome {
  const scan = prescanMarkdown(src);
  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };
  return run(src, profile);
}

/** Steps 2 to 5 without the pre-scan: the control for the pre-scan's refusals (M4.P1), never a production path. */
export function parseWithoutPrescan(src: string): ParseOutcome {
  return run(src, 'chat');
}
```

Check the bytes: `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/src/lib/markdownLimits.ts pwa/src/lib/markdownGuard.ts pwa/src/lib/markdownParse.ts` prints `0` for each; `grep -cF 'src.split(/\r\n|\r|\n/)' pwa/src/lib/markdownGuard.ts` prints `1`.

- [ ] **Step 5: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-limits.test.ts test/markdown-guard.test.ts test/markdown-parse.test.ts test/markdown-purity.test.ts )`
Expected: `Test Files  4 passed (4)`, `Tests  90 passed (90)` (24 + 46 + 13 + 7), `Type Errors  no errors`.

If `control: without the pre-scan the pipeline throws RangeError, reported by name only` fails because the parser survived 10 000 levels on this box, measure the depth at which `parseWithoutPrescan` first returns `threw` (double from 10 000 until it does), record it in the SDD ledger, and change that case's input (and only it) to twice that depth with `parseMarkdown`'s expected `value` to match; never lower it. If the M4.P3 vacuity case (`the set reaches a container depth of 2 and a delimiter run of 3`) fails, the set of ten has changed shape since planning: stop and put an ask to the coordinator; never lower its bar. If `a real 500 KiB prose doc is a tree` fails, record the outcome it printed and ask: a real document over `DOCS_MAX_RENDER_ELEMENTS` is a spec question, not a fixture to swap.

- [ ] **Step 6: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests` is a known load flake: a red there is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (the `hast` type import resolves through `@types/hast`, refinement (q); `PLUGINS_BY_PROFILE[profile]` and the `remarkRehype` options type-check).

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/message-links.test.tsx )` then `git status --porcelain pwa/test/golden pwa/test/message-links.test.tsx`
Expected: `Test Files  2 passed (2)`, `Tests  175 passed (175)` (the count Task 2 left; re-derive it at Step 0's state with this command if it differs on your box), then nothing from `git status`: this task changes no chat output.

Run: `( cd server && ./node_modules/.bin/vitest run test/license.test.ts test/oss-metadata.test.ts test/node-floor.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  50 passed (50)`: the package's own licence and engines are untouched, and the five MIT dependencies need no allowlist entry (there is none).

Run: `( cd server && ./node_modules/.bin/vitest run test/build-release.test.ts test/ci-pipeline.test.ts test/ci-select-tests.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  127 passed (127)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (the count Tasks 1 and 2 measured; this task adds no case to it and edits it not at all).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the seven new files.

Run: `git add pwa/package.json pwa/package-lock.json pwa/src/lib/markdownLimits.ts pwa/src/lib/markdownGuard.ts pwa/src/lib/markdownParse.ts pwa/test/markdown-limits.test.ts pwa/test/markdown-guard.test.ts pwa/test/markdown-parse.test.ts pwa/test/markdown-purity.test.ts && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; every fixture is a placeholder: `example.com`, `<server-host>`).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 7: Commit.**

```bash
git add pwa/package.json pwa/package-lock.json pwa/src/lib/markdownLimits.ts pwa/src/lib/markdownGuard.ts pwa/src/lib/markdownParse.ts pwa/test/markdown-limits.test.ts pwa/test/markdown-guard.test.ts pwa/test/markdown-parse.test.ts pwa/test/markdown-purity.test.ts
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: markdown limits, pre-scan, parse pipeline and five direct dependencies (docs W4)" \
  -m "lib/markdownLimits.ts declares every PWA render limit once; lib/markdownGuard.ts adds prescanMarkdown (container depth over 32 or a delimiter run over 64 refuses, fenced blocks skipped, the first refusing line reported) and utf8ByteLength; lib/markdownParse.ts adds parseMarkdown and its eight-arm ParseOutcome: the pre-scan, react-markdown's own processor stage by stage, raw HTML as text, position dropped, and the depth (64) and element (20 000) caps in one explicit-stack walk, with threw carrying the error's name only. The worker closure is pinned pure through ts.preProcessFile, and each limit name to its one declaration through ts.createSourceFile." \
  -m "Five direct dependencies, exact, already in the lock as transitive ones (only packages[\"\"].dependencies changes): unified 11.0.5 (MIT), remark-parse 11.0.0 (MIT), remark-rehype 11.1.2 (MIT), hast-util-to-jsx-runtime 2.3.6 (MIT), html-url-attributes 3.0.1 (MIT)." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `9`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; Task 5 appends to `markdownParse.ts` and adds a root to `markdown-purity.test.ts` without touching any `old` below, and re-anchors a row here only if it re-spells that text):

```json
[
 {
  "id": "W4-T3-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  const scan = prescanMarkdown(src);\n  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };\n",
  "new": "",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — 'parseMarkdown refuses it' (the 10 000-deep input reaches the parser and throws)"
 },
 {
  "id": "W4-T3-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "    if (depth > limits.containerDepth) return { ok: false, why: 'container-depth', line: n + 1, value: depth };\n",
  "new": "",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 15 failed | 31 passed (46) — eleven M4.P1 cases (the 10 000-deep line, the 32/33 edge, the seven markers, the three-space rule, the line numbering), the three fence cases that expect a refusal after or outside a fence, and the M4.P3 vacuity case"
 },
 {
  "id": "W4-T3-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "    if (run > limits.delimiterRun) return { ok: false, why: 'delimiter-run', line: n + 1, value: run };\n",
  "new": "",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 4 failed | 42 passed (46) — 'a 4 096-run of * is refused with its length', the same for _, 'a 64-run passes and a 65-run is refused', and the M4.P3 vacuity case"
 },
 {
  "id": "W4-T3-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "    fence = fenceOpen(line);\n    if (fence !== undefined) continue;\n",
  "new": "",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 4 failed | 42 passed (46) — 'a backtick fence and a longer tilde fence hide deep lines and long runs', 'a shorter fence, the other character, or a fence with text after it does not close', 'an unclosed fence runs to the end', 'four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick' (its tilde fence)"
 },
 {
  "id": "W4-T3-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "  while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;\n  const ch = line[i];\n",
  "new": "  while (line.charCodeAt(i) === 0x20) i += 1;\n  const ch = line[i];\n",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 1 failed | 45 passed (46) — 'four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick'"
 },
 {
  "id": "W4-T3-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "  if (ch === '`' && line.indexOf('`', j) !== -1) return undefined;\n",
  "new": "",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 1 failed | 45 passed (46) — 'four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick' (the ```a`b line)"
 },
 {
  "id": "W4-T3-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "    if (c !== 0x20 && c !== 0x09) return false;\n",
  "new": "    if (c !== 0x20 && c !== 0x09) return true;\n",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 1 failed | 45 passed (46) — 'a shorter fence, the other character, or a fence with text after it does not close' (the ``` js line)"
 },
 {
  "id": "W4-T3-M8",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "j - i <= 9",
  "new": "j - i <= 10",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 1 failed | 45 passed (46) — 'a ten-digit marker is not a container'"
 },
 {
  "id": "W4-T3-M9",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "    while (s < 3 && line.charCodeAt(i) === 0x20) {\n",
  "new": "    while (line.charCodeAt(i) === 0x20) {\n",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 1 failed | 45 passed (46) — 'skips up to three spaces before a marker, never four'"
 },
 {
  "id": "W4-T3-M10",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "        bytes += 4;\n        i += 1;\n",
  "new": "        bytes += 3;\n",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 2 failed | 44 passed (46) — utf8ByteLength 'four-byte' and 'mixed'"
 },
 {
  "id": "W4-T3-M11",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_CONTAINER_DEPTH = 32;",
  "new": "export const MD_MAX_CONTAINER_DEPTH = 2;",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 5 failed | 41 passed (46) — '32 levels pass and 33 are refused' and the four 'is not a container' cases (each puts 32 containers before its tail); no M4.P3 case, because the set's deepest line holds exactly 2 (W4-T3-M13 is the row that reaches them)"
 },
 {
  "id": "W4-T3-M12",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_DELIMITER_RUN = 64;",
  "new": "export const MD_MAX_DELIMITER_RUN = 2;",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 2 failed | 44 passed (46) — 'a 64-run passes and a 65-run is refused' and the M4.P3 case of plans/2026-10-01-native-docs-reader-w1-ccd-reads-docs.md (its run of 3)"
 },
 {
  "id": "W4-T3-M13",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_CONTAINER_DEPTH = 32;",
  "new": "export const MD_MAX_CONTAINER_DEPTH = 1;",
  "tests": [
   "test/markdown-guard.test.ts"
  ],
  "red": "pwa markdown-guard: 8 failed | 38 passed (46) — the five cases W4-T3-M11 reds plus the M4.P3 cases of the three docs whose deepest line holds 2 containers (plans/2026-09-23-gpt-lane-ownership-2b2-the-lane-runs.md, plans/2026-09-30-worker-stall-watch-w2.md, plans/2026-10-08-child-reclamation-wave7-temp-root-collector.md)"
 },
 {
  "id": "W4-T3-M14",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  if (depth > MD_MAX_TREE_DEPTH) return { kind: 'too-deep', depth };\n",
  "new": "",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 3 failed | 10 passed (13) — 'nested emphasis 100 deep passes the pre-scan and is too-deep with its depth', 'a tree 64 deep is a tree and 65 is too-deep', and the hand-built 100 000-deep case"
 },
 {
  "id": "W4-T3-M15",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    if (node.type === 'element') elements += 1;\n",
  "new": "",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 3 failed | 10 passed (13) — the three M4.P12 cases (90 000 thematic breaks, 22 000 autolinks, the 20 000/20 001 edge)"
 },
 {
  "id": "W4-T3-M16",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    if (node.type === 'element') elements += 1;\n",
  "new": "    if (node.type === 'element' && (node as { tagName?: string }).tagName === 'hr') elements += 1;\n",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — '22 000 autolinks under 512 KiB are too-wide with the count (22 000 links and their paragraph)'; the hr cases stay green"
 },
 {
  "id": "W4-T3-M17",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };\n      else if (child.children) stack.push(child);\n",
  "new": "      if (child.children) stack.push(child);\n",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 2 failed | 11 passed (13) — 'img, script and an angle-bracket placeholder become text nodes, and no raw node is left' and the hand-built case (its innermost raw node stays raw)"
 },
 {
  "id": "W4-T3-M18",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    delete node.position;\n",
  "new": "",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 3 failed | 10 passed (13) — 'a heading is a tree with no position, depth 2 (root > h1 > text)', 'no node of any corpus tree keeps a position', and the hand-built case"
 },
 {
  "id": "W4-T3-M19",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    return { kind: 'threw', error: errorName(e) };",
  "new": "    return { kind: 'threw', error: String(e) };",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — 'control: without the pre-scan the pipeline throws RangeError, reported by name only' (it carries 'RangeError: Maximum call stack size exceeded')"
 },
 {
  "id": "W4-T3-M20",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  docs: REMARK_PLUGINS,\n",
  "new": "  docs: [remarkGfm],\n",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — the 'chat' and 'docs' profiles case (the callout cases differ)"
 },
 {
  "id": "W4-T3-M21",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "function rawToText(tree: WalkNode): void {\n  const stack: WalkNode[] = [tree];\n  while (stack.length > 0) {\n    const node = stack.pop()!;\n    const children = node.children;\n    if (!children) continue;\n    for (let i = 0; i < children.length; i += 1) {\n      const child = children[i]!;\n      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };\n      else if (child.children) stack.push(child);\n    }\n  }\n}\n",
  "new": "function rawToText(tree: WalkNode): void {\n  const children = tree.children;\n  if (!children) return;\n  for (let i = 0; i < children.length; i += 1) {\n    const child = children[i]!;\n    if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };\n    else rawToText(child);\n  }\n}\n",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — the hand-built 100 000-deep case (RangeError: Maximum call stack size exceeded)"
 },
 {
  "id": "W4-T3-M22",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "function measure(tree: WalkNode): { depth: number; elements: number } {\n  const nodes: WalkNode[] = [tree];\n  const depths: number[] = [0];\n  let depth = 0;\n  let elements = 0;\n  while (nodes.length > 0) {\n    const node = nodes.pop()!;\n    const d = depths.pop()!;\n    delete node.position;\n    if (node.type === 'element') elements += 1;\n    if (d > depth) depth = d;\n    const children = node.children;\n    if (children) {\n      for (let i = children.length - 1; i >= 0; i -= 1) {\n        nodes.push(children[i]!);\n        depths.push(d + 1);\n      }\n    }\n  }\n  return { depth, elements };\n}\n",
  "new": "function measure(tree: WalkNode, d = 0): { depth: number; elements: number } {\n  delete tree.position;\n  let depth = d;\n  let elements = tree.type === 'element' ? 1 : 0;\n  for (const c of tree.children ?? []) {\n    const m = measure(c, d + 1);\n    if (m.depth > depth) depth = m.depth;\n    elements += m.elements;\n  }\n  return { depth, elements };\n}\n",
  "tests": [
   "test/markdown-parse.test.ts"
  ],
  "red": "pwa markdown-parse: 1 failed | 12 passed (13) — the hand-built 100 000-deep case (RangeError: Maximum call stack size exceeded)"
 },
 {
  "id": "W4-T3-M23",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "import { remarkAlerts } from './remarkAlerts';\n",
  "new": "import { remarkAlerts } from './remarkAlerts';\nimport 'react';\n",
  "tests": [
   "test/markdown-purity.test.ts"
  ],
  "red": "pwa markdown-purity: 1 failed | 6 passed (7) — 'imports nothing outside the closure but unified, the three remark plugins and the hast/mdast types' (refused: 'src/lib/markdownParse.ts: react')"
 },
 {
  "id": "W4-T3-M24",
  "pkg": "pwa",
  "file": "pwa/src/lib/clock.ts",
  "old": "export function resetClock(epochSeconds: number, now: Date = new Date()): string | null {",
  "new": "export const CHAT_SYNC_MAX_BYTES = 4096;\nexport function resetClock(epochSeconds: number, now: Date = new Date()): string | null {",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'CHAT_SYNC_MAX_BYTES has exactly one declaration, in pwa/src/lib/markdownLimits.ts' (holders: lib/clock.ts and lib/markdownLimits.ts)"
 },
 {
  "id": "W4-T3-M25",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_CONTAINER_DEPTH = 32;",
  "new": "export const MD_MAX_CONTAINER_DEPTH = 33;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'MD_MAX_CONTAINER_DEPTH is 32'"
 },
 {
  "id": "W4-T3-M26",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_DELIMITER_RUN = 64;",
  "new": "export const MD_MAX_DELIMITER_RUN = 65;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'MD_MAX_DELIMITER_RUN is 64'"
 },
 {
  "id": "W4-T3-M27",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_MAX_TREE_DEPTH = 64;",
  "new": "export const MD_MAX_TREE_DEPTH = 63;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'MD_MAX_TREE_DEPTH is 64'"
 },
 {
  "id": "W4-T3-M28",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const DOCS_MAX_RENDER_ELEMENTS = 20000;",
  "new": "export const DOCS_MAX_RENDER_ELEMENTS = 20001;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'DOCS_MAX_RENDER_ELEMENTS is 20000'"
 },
 {
  "id": "W4-T3-M29",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536;",
  "new": "export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65535;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'MD_HIGHLIGHT_BLOCK_MAX_CHARS is 65536'"
 },
 {
  "id": "W4-T3-M30",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524288;",
  "new": "export const DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524287;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'DOCS_HIGHLIGHT_PAGE_MAX_CHARS is 524288'"
 },
 {
  "id": "W4-T3-M31",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const DOCS_PARSE_BUDGET_LARGE_MS = 30000;",
  "new": "export const DOCS_PARSE_BUDGET_LARGE_MS = 29999;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'DOCS_PARSE_BUDGET_LARGE_MS is 30000'"
 },
 {
  "id": "W4-T3-M32",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const DOCS_RENDER_GATE_BYTES = 524288;",
  "new": "export const DOCS_RENDER_GATE_BYTES = 524287;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'DOCS_RENDER_GATE_BYTES is 524288'"
 },
 {
  "id": "W4-T3-M33",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const CHAT_SYNC_MAX_BYTES = 4096;",
  "new": "export const CHAT_SYNC_MAX_BYTES = 4097;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'CHAT_SYNC_MAX_BYTES is 4096'"
 },
 {
  "id": "W4-T3-M34",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "export const CHAT_PARSE_BUDGET_MS = 2000;",
  "new": "export const CHAT_PARSE_BUDGET_MS = 1999;",
  "tests": [
   "test/markdown-limits.test.ts"
  ],
  "red": "pwa markdown-limits: 1 failed | 23 passed (24) — 'CHAT_PARSE_BUDGET_MS is 2000'"
 },
 {
  "id": "W4-T3-M35",
  "pkg": "pwa",
  "file": "pwa/package.json",
  "old": "    \"unified\": \"11.0.5\",\n",
  "new": "    \"unified\": \"^11.0.5\",\n",
  "tests": [
   "test/markdown-purity.test.ts"
  ],
  "red": "pwa markdown-purity: 1 failed | 6 passed (7) — 'unified is 11.0.5 in package.json, in the lock root, and installed at it'"
 }
]
```

---

### Task 4: renderHast, pipeline parity with react-markdown, raw HTML as visible text, and CodeBlock's highlight cap

**Model routing:** `sonnet`, effort `high` — one new pure function that must stay byte-for-byte with react-markdown 10.1.0's `post()` over a whole corpus while never writing its input, and one re-spelled component whose 64 Ki-char boundary, label and opt-out are each pinned at their edge. Every number below was measured on the shared scratch tree at Task 3's state, the mutations in a separate copy.

**Spec rows:** M4.P10 (`renderHast(parseMarkdown(src).tree, {components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform})` equals `<Markdown ...>` over M4.M1's corpus; mutations: change the `remarkRehype` options, drop raw-to-text), M4.P5 (`<img src=x onerror=alert(1)>`, `<script>x</script>` and `<server-host>` render as visible text with 0 `img` and 0 `script`; mutations: add `rehype-raw`, use `skipHtml`), M4.H1 (a 70 000-char `ts` block has no `.hljs-keyword` and says "not highlighted"; 1 000 chars has spans; mutation: delete the cap). Refinement (l) (the cap compares characters after the trailing-newline strip, inclusive at 65 536; the label's KiB is rounded up; U+00B7 separates). Section 4.10's `renderHast` paragraph and its "Highlighting" paragraph (the block cap only; the page budget is W5's `detachUrls`, refinement (y)).

**Files:**
- Create: `pwa/src/lib/renderHast.tsx` — 70 lines: `RenderHastOptions`, `renderHast`, and the module-private `transformUrls`. Imports `react` (type only), `react/jsx-runtime`, `hast` (types only), `hast-util-to-jsx-runtime`, `html-url-attributes` and `react-markdown` (types only). It is NOT in the worker closure (`markdown-purity.test.ts`'s `ROOTS` do not reach it, and nothing in the closure imports it).
- Create: `pwa/test/render-hast.test.tsx` — 202 lines, 72 cases: M4.P10 over the corpus (61 parity cases, a coverage case and a blanking case), M4.P5 on both paths, the url clause (five cases), the no-write case, the depth-cap case.
- Create: `pwa/test/markdown-highlight.test.tsx` — 96 lines, 8 cases: M4.H1, the boundary, the strip, the pipeline path, the `highlight` prop, an unregistered language. (Not `code-block.test.tsx`, which open PR #111 creates.)
- Modify: `pwa/src/lib/markdown.tsx` — three Find/Replace edits: the import block (line 26, a hint), `CodeBlock`'s doc comment, signature and highlight decision (lines 88-100), and its label span (line 110). 189 lines become 197.
- Test: the two new files; guards `pwa/test/markdown-golden.test.tsx` and `pwa/test/message-links.test.tsx` (unmodified; every golden file stays byte-identical, because no corpus block reaches the cap), `pwa/test/markdown-purity.test.ts`, `pwa/test/markdown-parse.test.ts`, `pwa/test/chat.test.tsx`, the PWA `tsc`, `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts` (not edited), `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`.

Every Find block below is quoted from `pwa/src/lib/markdown.tsx` as Task 3 left it (Task 3 does not edit it, so this is Task 2's text) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes: `toJsxRuntime` from `hast-util-to-jsx-runtime` and `urlAttributes` (`Record<string, Array<string> | null>`) from `html-url-attributes` (Task 3's direct dependencies); `Fragment`, `jsx`, `jsxs` from `react/jsx-runtime`; `type Components`, `type UrlTransform` (`(url: string, key: string, node: Readonly<Element>) => string | null | undefined`) and, in tests, `defaultUrlTransform` and the default `Markdown` from `react-markdown`; `type Element`, `type Root as HastRoot`, `type RootContent` from `hast`. From Task 3: `parseMarkdown`, `type ParseOutcome` (`pwa/src/lib/markdownParse.ts`), `MD_HIGHLIGHT_BLOCK_MAX_CHARS` (`pwa/src/lib/markdownLimits.ts`). From Task 2: `CHAT_COMPONENTS`, `ChatMarkdown`, `CodeBlock` (`pwa/src/lib/markdown.tsx`), `remarkAlerts` (`pwa/src/lib/remarkAlerts.ts`). From Task 1, tests only: `CHAT_CORPUS`, `RECAP_CASE`, `CHAT_ALIAS_TAGS`, `CHAT_UNREGISTERED_TAGS`, `languageCases`, `type CorpusCase` (`pwa/test/markdownCorpus.ts`).
- Produces, in `pwa/src/lib/renderHast.tsx`:
  - `export interface RenderHastOptions { readonly components: Components; readonly urlTransform?: UrlTransform }` — `urlTransform` absent has one meaning: the URLs are left as they are (the caller decides; W5's `detachUrls` moves them out first).
  - `export function renderHast(tree: HastRoot, opts: RenderHastOptions): ReactElement` — pure: no hook, no DOM access, no module state, and it never writes `tree`. With a `urlTransform` it renders a copy (root and every element copied, with their `properties`; text and comment nodes shared) whose url attributes were transformed, built with an explicit stack; without one it renders `tree` as given. Then `toJsxRuntime(tree, {Fragment, jsx, jsxs, components, ignoreInvalidStyle: true, passKeys: true, passNode: true})`.
- Produces, in `pwa/src/lib/markdown.tsx` (re-spelled in place):
  - `export function CodeBlock({ children, highlight }: { children?: ReactNode; highlight?: boolean }): ReactNode` — `highlight` absent or `true` highlights; `false` never does (one meaning: the caller's page budget said no). A block is coloured only when its language is registered, `highlight !== false`, and `raw.length` (after the existing trailing-newline strip) is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`. A registered, not-opted-out block over the cap labels itself `` `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)` ``; every other block keeps its label. `SHARED_COMPONENTS.pre` still renders `<CodeBlock>{children}</CodeBlock>`, so chat never passes `highlight` and W4 never passes `false`.

**Decisions this task makes (none departs from the spec's text):**
1. **`renderHast` is post() with exactly what chat does not use taken out.** post() (react-markdown 10.1.0, `lib/index.js`, `function post`) does four things before `toJsxRuntime`: refuses deprecated props, turns each `raw` into `text` (or deletes it under `skipHtml`), applies `urlTransform` to url attributes, and drops elements under `allowedElements`/`disallowedElements`/`allowElement`. Chat passes none of the props the first and last read, and `parseMarkdown` has already done the second (section 4.10 step 3). What stays is the url clause, spelled as post() spells it: for each own key of `urlAttributes` that the element's own `properties` carry, when the key's tag list is `null` or names the element, `urlTransform(String(value || ''), key, element)`. Then `toJsxRuntime` with post()'s seven options.
2. **The transform writes a copy, never the tree.** post() transforms in place; `renderHast` builds a new root and a new element (spread, with `properties` spread) for every element, with an explicit stack, and passes the copy as `node` to components; text and comment nodes are shared because nothing writes them. Without a transform it renders `tree` itself. The call ORDER differs from post()'s pre-order walk (siblings' subtrees are visited last-pushed first); `defaultUrlTransform` is pure and runs before any component, so no output can see it, and the spy case compares calls as a sorted list.
3. **The explicit stack is a property of the code, not a guard.** `toJsxRuntime` itself recurses, and `parseMarkdown` caps a tree at 64 levels before `renderHast` sees it, so a recursive copy cannot be told apart from the iterative one through `renderHast` (measured: the recursive mutant is green, recorded below as equivalent and not a row). The depth-cap case proves the cap's deepest tree (64) renders.
4. **Three analogues for the spec's mutations, each measured red, none installing a package.** "Add `rehype-raw`" (raw HTML becomes live markup) is W4-T4-M3: the raw step builds a `span` whose `dangerouslySetInnerHTML` carries the raw text; `toJsxRuntime` passes that property straight to React (measured), so the `<img>` and `<script>` become elements. "Drop raw-to-text", which is also "leave `raw` nodes for the runtime", is W4-T4-M2: `toJsxRuntime` silently drops a `raw` node (measured), so the placeholder text vanishes. "Use `skipHtml`" is W4-T4-M4 on the worker path (the raw step deletes instead of converting) and W4-T4-M5 on the sync path (`skipHtml` on `ChatMarkdown`'s `<Markdown>`).
5. **M4.P5's sync half renders `ChatMarkdown` itself**, the component chat mounts, with a 96-byte message that stays on the synchronous path through Task 6. W4-T4-M5 anchors on `ChatMarkdown`'s one `<Markdown>` line, as W4-T1-M1 and W4-T1-M2 do; Task 6 re-spells `ChatMarkdown`, so Task 6 re-anchors all three rows on its synchronous component's line in its own rows block.
6. **The highlight test renders `CodeBlock` directly**, with the `<code className="language-…">` child react-markdown hands the `pre` component, plus one case through `parseMarkdown` and `renderHast`. It never goes through `ChatMarkdown`: a 70 000-character message crosses `CHAT_SYNC_MAX_BYTES` and takes Task 6's worker path, which jsdom cannot run.
7. **The label names the cap only when the cap is the reason.** An unregistered language over the cap keeps its own label (it was never going to be coloured); a block with `highlight={false}` keeps its plain label (W5's page budget writes its own note, refinement (y)). The label stays one expression in the same `<span className="code-block-lang">`, so a block under the cap renders the same markup as before: the golden does not move.
8. **Not guards, recorded so nobody adds a row that cannot go red.** `passKeys: true` (keys never reach markup, and `toJsxRuntime` passes several children through `jsxs`, so no key warning fires either way: the mutant is green), `ignoreInvalidStyle: true` (no `style` attribute can reach a tree from Markdown: raw HTML is text by then) and `String(value || '')` (every url value a Markdown tree carries is already a string). Each is copied from post() for parity, not for behaviour.

**Measured while planning** (the shared scratch tree at Task 3's state; the mutations in a separate copy):
1. **RED** (render-hast, `renderHast.tsx` absent): `Error: Failed to resolve import "../src/lib/renderHast" from "test/render-hast.test.tsx". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`. **GREEN**: `Tests  72 passed (72)` (61 parity cases: 20 corpus cases, 34 language tags, the recap, 6 extra).
2. **RED** (highlight, `renderHast.tsx` present, `CodeBlock` unchanged): `Tests  4 failed | 4 passed (8)`; e.g. `AssertionError: expected 5385 to be +0` for the 70 000-char block's keyword count. **GREEN**: `Tests  8 passed (8)`.
3. **Guards**: PWA `tsc` clean (the `Components` type of `react-markdown` is accepted by `toJsxRuntime`'s `components` without a cast, and its return type is `ReactElement`); under `CI=1`, render-hast + highlight + golden + message-links + purity `Test Files  5 passed (5)`, `Tests  262 passed (262)` with no golden file moved; markdown-parse + remark-alerts + chat `Tests  82 passed (82)`; the whole PWA suite `Test Files  117`, `Tests  3800`, all green but for `contrast.test.ts`'s spawned-gate cases and `session-pickers.test.tsx`'s first case, which failed only in the whole-suite run at load average 25 and passed three times in a row alone (`Tests  287 passed (287)`), the known load flake; `single-definition` + `source-bytes` + `topology-clean` `Tests  580 passed (580)` (523 + 57, unchanged); `typecheck-tests` 10 of 12 in the scratch tree, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules` (`Cannot find module 'ws'`, `'vitest'`, `'node-pty'`), as at Tasks 1-3, with `pwa/ is clean under tsconfig.json` green over the three new files.
4. **Mutations**: 16 rows, each measured red in a separate copy (`git archive` of the staged tree, `git init`, `pwa/node_modules` and `server/node_modules` linked in), restored after each with `git checkout -- <file>`; `git status --porcelain` in the copy was empty after every one. Two further mutants are green and are recorded as equivalent, not rows: `passKeys: false`, and the copy made recursive (`copy.children = transformUrls({ type: 'root', children: child.children }, urlTransform).children`). No row of Tasks 1-3 anchors on the re-spelled `CodeBlock` text (their `markdown.tsx` rows sit on the hljs registration, `CHAT_COMPONENTS.a`/`img` and `ChatMarkdown`'s line, none of which this task touches), so none is re-anchored here.

- [ ] **Step 0: Confirm the state.** From the worktree root, foreground. Every file this task edits is W4's own (`lib/markdown.tsx` was created by Task 2 on this branch), so no claim is taken.

Run: `test -e pwa/src/lib/markdownParse.ts && test -e pwa/src/lib/markdown.tsx && test ! -e pwa/src/lib/renderHast.tsx && test ! -e pwa/test/render-hast.test.tsx && test ! -e pwa/test/markdown-highlight.test.tsx && git diff --quiet HEAD -- pwa && grep -q '"html-url-attributes": "3.0.1"' pwa/package.json && grep -qF 'export function CodeBlock({ children }: { children?: ReactNode }): ReactNode {' pwa/src/lib/markdown.tsx && echo T4-STATE-OK`
Expected: `T4-STATE-OK` (Task 3 is committed, the tree is clean under `pwa/`, the two dependencies `renderHast` imports are direct, and `CodeBlock` is as Task 2 moved it). If it does not print, stop and put an ask to the coordinator.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/message-links.test.tsx test/markdown-purity.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  182 passed (182)` (169 + 6 + 7 at planning; whatever it prints, Step 8's run of the same three plus this task's two files must print it plus 80).

- [ ] **Step 1: Write the failing parity test.** Create `pwa/test/render-hast.test.tsx` with exactly this content:

```tsx
// `renderHast` (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10 and section 4.15's M4.P10 and M4.P5).
// M4.P10: a tree from `parseMarkdown`, rendered through `renderHast` with chat's components and react-markdown's
// `defaultUrlTransform`, is byte-identical to `<Markdown remarkPlugins={[remarkGfm, remarkAlerts]}
// components={CHAT_COMPONENTS}>` over the whole chat corpus (Task 1's `markdownCorpus.ts`, its language cases
// re-derived from the grammars `lib/markdown.tsx` registers) and a few cases the corpus does not carry. M4.P5: raw
// HTML is visible text on both paths, never an element. Then renderHast's own contract: the url clause runs only
// when a transform is given, only on url attributes, and never writes the caller's tree.
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import Markdown, { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import type { Root as HastRoot } from 'hast';
import { CHAT_COMPONENTS, ChatMarkdown } from '../src/lib/markdown';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import {
  CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, languageCases, type CorpusCase,
} from './markdownCorpus';

afterEach(cleanup);

const treeOf = (o: ParseOutcome): HastRoot => {
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${JSON.stringify(o)}`);
  return o.tree;
};

/** The sync path: what chat renders for a message of at most 4 KiB, react-markdown end to end. */
const viaMarkdown = (src: string): string =>
  renderToStaticMarkup(
    <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{src}</Markdown>,
  );

/** The worker path: `parseMarkdown`'s tree through `renderHast`, as chat renders a longer message. */
const viaRenderHast = (src: string): string =>
  renderToStaticMarkup(
    renderHast(treeOf(parseMarkdown(src)), { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
  );

// The language cases exactly as the golden builds them: every registered grammar (measured, importing
// lib/markdown.tsx registers them), every alias, every unregistered tag.
const TAGS: readonly string[] = [
  ...new Set([...[...hljs.listLanguages()].sort(), ...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS]),
];

// Parity cases the corpus does not carry, each about a clause post() applies or a shape the parse could split.
const EXTRA: readonly CorpusCase[] = [
  { name: 'javascript-link-and-image', text: '[go](javascript:alert(1)) and ![pic](javascript:alert(1))' },
  { name: 'data-image', text: '![dot](data:image/png;base64,AAAA)' },
  { name: 'nested-lists', text: '- a\n  - b\n    1. c\n    2. d\n       - e\n- f' },
  { name: 'footnote', text: 'Claim.[^n]\n\n[^n]: The note, with [a link](https://example.com/n).' },
  { name: 'colon-in-a-fence-info', text: '```a:b\nx\n```' },
  { name: 'link-title-with-a-colon', text: '[t](https://example.com/t "note: javascript:x")' },
];

describe('M4.P10: renderHast over parseMarkdown equals <Markdown> with chat components', () => {
  const cases: readonly CorpusCase[] = [...CHAT_CORPUS, ...languageCases(TAGS), RECAP_CASE, ...EXTRA];

  it('covers the corpus, every language tag and the extra cases', () => {
    expect(TAGS.length).toBeGreaterThan(CHAT_ALIAS_TAGS.length + CHAT_UNREGISTERED_TAGS.length);
    expect(cases.length).toBe(CHAT_CORPUS.length + TAGS.length + 1 + EXTRA.length);
  });

  it.each(cases)('$name', (c) => {
    expect(viaRenderHast(c.text)).toBe(viaMarkdown(c.text));
  });

  it('the javascript: link and image are blanked on both paths, not just equal', () => {
    const out = viaRenderHast(EXTRA[0]!.text);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href=""');
  });
});

const RAW = '<img src=x onerror=alert(1)>\n\n<script>x</script>\n\nreach <server-host> on port 22';
const RAW_TEXTS: readonly string[] = ['<img src=x onerror=alert(1)>', '<script>x</script>', '<server-host>'];

describe('M4.P5: raw HTML renders as visible text, never as markup', () => {
  const check = (container: HTMLElement): void => {
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
    for (const t of RAW_TEXTS) expect(container.textContent, t).toContain(t);
  };

  it('through renderHast (the worker path)', () => {
    const tree = treeOf(parseMarkdown(RAW));
    check(render(renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform })).container);
  });

  it('through ChatMarkdown (the sync path)', () => {
    check(render(<ChatMarkdown text={RAW} />).container);
  });
});

describe("renderHast's url clause", () => {
  /** Components that print what they were given, so React's own handling of a URL cannot hide it. */
  const PROBE: Components = {
    a: ({ href, title, children }) => <span data-href={href} data-title={title}>{children}</span>,
    img: ({ src }) => <span data-src={typeof src === 'string' ? src : ''} />,
  };
  const src = '[go](javascript:alert(1) "note: javascript:x") ![pic](javascript:alert(2))';

  it('without urlTransform, every URL reaches the components as written (the caller decides)', () => {
    const out = renderToStaticMarkup(renderHast(treeOf(parseMarkdown(src)), { components: PROBE }));
    expect(out).toContain('data-href="javascript:alert(1)"');
    expect(out).toContain('data-src="javascript:alert(2)"');
  });

  it('with defaultUrlTransform, url attributes are blanked and other attributes are untouched', () => {
    const out = renderToStaticMarkup(
      renderHast(treeOf(parseMarkdown(src)), { components: PROBE, urlTransform: defaultUrlTransform }),
    );
    expect(out).toContain('data-href=""');
    expect(out).toContain('data-src=""');
    expect(out).toContain('data-title="note: javascript:x"');
  });

  it('calls the transform once per url attribute, with the key and the element, as post() does', () => {
    const calls: string[] = [];
    const spy: UrlTransform = (url, key, node) => {
      calls.push(`${node.tagName} ${key} ${url}`);
      return url;
    };
    const md = '[a](https://example.com/a "t: x") ![b](https://example.com/b.png "u: y")\n\n```ts\nx\n```';
    renderToStaticMarkup(renderHast(treeOf(parseMarkdown(md)), { components: CHAT_COMPONENTS, urlTransform: spy }));
    expect(calls.sort()).toEqual(['a href https://example.com/a', 'img src https://example.com/b.png']);
  });

  it('applies a url key only to the elements html-url-attributes lists it for', () => {
    // `cite` is a url attribute of blockquote, del, ins and q only. Markdown never puts one on a div, so the tree is
    // built by hand; the components print what they receive through `node`.
    const tree: HastRoot = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'blockquote', properties: { cite: 'javascript:a' }, children: [] },
        { type: 'element', tagName: 'div', properties: { cite: 'javascript:b' }, children: [] },
      ],
    };
    const PRINT: Components = {
      blockquote: ({ node }) => <span data-cite={String(node?.properties['cite'])} />,
      div: ({ node }) => <span data-cite={String(node?.properties['cite'])} />,
    };
    expect(renderToStaticMarkup(renderHast(tree, { components: PRINT, urlTransform: defaultUrlTransform }))).toBe(
      '<span data-cite=""></span><span data-cite="javascript:b"></span>',
    );
  });

  it('passes each element to the components as `node`', () => {
    const NODE: Components = { p: ({ node, children }) => <p data-tag={node?.tagName}>{children}</p> };
    expect(renderToStaticMarkup(renderHast(treeOf(parseMarkdown('hi')), { components: NODE }))).toBe(
      '<p data-tag="p">hi</p>',
    );
  });
});

describe('renderHast never writes the tree it is given', () => {
  it('a tree rendered with a transform deep-equals its clone from before, and renders the same twice', () => {
    const md = [
      '[go](javascript:alert(1)) ![pic](https://example.com/p.png) <https://example.com/auto>',
      '',
      '> [!NOTE]',
      '> A callout with a footnote.[^f]',
      '',
      '[^f]: The note.',
    ].join('\n');
    const tree = treeOf(parseMarkdown(md));
    const before = structuredClone(tree);
    const first = renderToStaticMarkup(
      renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
    );
    expect(tree).toEqual(before);
    expect(
      renderToStaticMarkup(renderHast(tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform })),
    ).toBe(first);
    expect(renderToStaticMarkup(renderHast(tree, { components: CHAT_COMPONENTS }))).toContain('javascript:');
  });
});

/** `levels` nested emphasis spans (root > p > em x levels > text), as `markdown-parse.test.ts` builds them. */
function nestedEmphasis(levels: number): string {
  let open = '';
  let close = '';
  for (let i = 0; i < levels; i += 1) {
    const mark = i % 2 === 0 ? '*' : '_';
    open += `${mark}a `;
    close = ` a${mark}${close}`;
  }
  return `${open}x${close}`;
}

describe('a tree at the depth cap renders', () => {
  it('62 nested emphasis spans, a tree 64 deep, render 62 em elements', () => {
    const outcome = parseMarkdown(nestedEmphasis(62));
    expect(outcome).toMatchObject({ kind: 'tree', depth: 64 });
    const out = renderToStaticMarkup(
      renderHast(treeOf(outcome), { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }),
    );
    expect(out.match(/<em>/g)).toHaveLength(62);
  });
});
```

Check the bytes: `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/render-hast.test.tsx` prints `0`; `grep -cF "text: '\`\`\`a:b\nx\n\`\`\`'" pwa/test/render-hast.test.tsx` prints `1` (the `\n` escapes are two characters each, never newlines).

- [ ] **Step 2: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/render-hast.test.tsx )`
Expected: `FAIL  test/render-hast.test.tsx [ test/render-hast.test.tsx ]`, `Error: Failed to resolve import "../src/lib/renderHast" from "test/render-hast.test.tsx". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Implement `renderHast`.** Create `pwa/src/lib/renderHast.tsx` with exactly this content:

```tsx
// A parsed hast tree to React (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10). `renderHast` is
// react-markdown 10.1.0's `post()` (`react-markdown/lib/index.js`, `function post`) minus its raw step, which
// `parseMarkdown` has already taken (every `raw` node is a `text` node by the time a tree reaches here), and minus
// the element filters chat never passes (`allowedElements`, `disallowedElements`, `allowElement`, `skipHtml`).
// What is left, in post()'s order: when `urlTransform` is given, it runs over each `html-url-attributes` key an
// element carries, exactly as post() calls it; then `toJsxRuntime` with post()'s options. Chat passes
// react-markdown's own `defaultUrlTransform`, so a tree from the worker renders byte-identical to `<Markdown>`
// (`render-hast.test.tsx`, M4.P10).
//
// Pure: no hook, no DOM access, no module state, and the input tree is never written. post() transforms its tree
// in place; here the transform builds a copy of the root and of every element (text and comment nodes are
// shared, untouched), with an explicit stack, so a caller can keep and re-render a tree (W5's Export does).
// Without a `urlTransform` the tree is rendered as given and every URL reaches the components unchanged: the
// caller decides (W5's `detachUrls` moves them out first).
import type { ReactElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Element, Root as HastRoot, RootContent } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import type { Components, UrlTransform } from 'react-markdown';

export interface RenderHastOptions {
  /** The tag-to-component map, as react-markdown's `components` prop (chat passes `CHAT_COMPONENTS`). */
  readonly components: Components;
  /** Applied to every url attribute as react-markdown applies it; absent means the URLs are left as they are. */
  readonly urlTransform?: UrlTransform;
}

/** A copy of `tree` whose url attributes went through `urlTransform`: post()'s url clause, on copies. For each
 *  element, each key of `urlAttributes` present in its own `properties` whose tag list is `null` (every element)
 *  or names the element's tag becomes `urlTransform(String(value || ''), key, element)`. */
function transformUrls(tree: HastRoot, urlTransform: UrlTransform): HastRoot {
  const root: HastRoot = { ...tree, children: [] };
  const stack: { from: readonly RootContent[]; to: RootContent[] }[] = [{ from: tree.children, to: root.children }];
  while (stack.length > 0) {
    const { from, to } = stack.pop()!;
    for (const child of from) {
      if (child.type !== 'element') {
        to.push(child);
        continue;
      }
      const copy: Element = { ...child, properties: { ...child.properties }, children: [] };
      for (const key in urlAttributes) {
        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(copy.properties, key)) {
          const test = urlAttributes[key];
          if (test === null || test?.includes(copy.tagName)) {
            copy.properties[key] = urlTransform(String(copy.properties[key] || ''), key, copy);
          }
        }
      }
      to.push(copy);
      stack.push({ from: child.children, to: copy.children });
    }
  }
  return root;
}

/** `tree` as React elements, through `components`, with post()'s `toJsxRuntime` options. */
export function renderHast(tree: HastRoot, opts: RenderHastOptions): ReactElement {
  const input = opts.urlTransform === undefined ? tree : transformUrls(tree, opts.urlTransform);
  return toJsxRuntime(input, {
    Fragment,
    jsx,
    jsxs,
    components: opts.components,
    ignoreInvalidStyle: true,
    passKeys: true,
    passNode: true,
  });
}
```

- [ ] **Step 4: Run it to verify it passes.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/render-hast.test.tsx )`
Expected: `Test Files  1 passed (1)`, `Tests  72 passed (72)`, `Type Errors  no errors`. The parity cases are `CHAT_CORPUS` (20 at planning), one per language tag (`hljs.listLanguages()` plus the alias and unregistered tags, 34 at planning), the recap and the six extra cases, and the coverage case re-derives that sum from the corpus each run, so a grammar Task 2's registration gains or loses moves the count, never a hand-kept number. If a parity case fails, the pipeline has drifted from react-markdown: stop and ask; never adjust the corpus or the expected string.

- [ ] **Step 5: Write the failing highlight test.** Create `pwa/test/markdown-highlight.test.tsx` with exactly this content:

```tsx
// The block highlight cap (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10's "Highlighting" and
// section 4.15's M4.H1, the W4 plan's refinement (l)). `CodeBlock` asks highlight.js to colour a block only when its
// language is registered, its `highlight` prop is not `false`, and it is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`
// characters after the trailing-newline strip. A registered block over the cap renders as plain text and labels
// itself "{label} · not highlighted ({KiB} KiB)", KiB being its characters / 1024 rounded up. (Not
// `code-block.test.tsx`: open PR #111 creates that file.)
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { defaultUrlTransform } from 'react-markdown';
import { CHAT_COMPONENTS, CodeBlock } from '../src/lib/markdown';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';

afterEach(cleanup);

/** A TypeScript body of exactly `chars` characters, every line a keyword, ending in `x` (never a newline, which
 *  the strip would take). */
const tsBody = (chars: number): string => 'const a = 1;\n'.repeat(Math.ceil(chars / 13)).slice(0, chars - 1) + 'x';

/** One fenced block, as react-markdown hands it to the `pre` component. */
function block(lang: string, body: string, highlight?: boolean): HTMLElement {
  return render(
    <CodeBlock highlight={highlight}>
      <code className={`language-${lang}`}>{`${body}\n`}</code>
    </CodeBlock>,
  ).container;
}

const keywords = (c: HTMLElement): number => c.querySelectorAll('.hljs-keyword').length;
const label = (c: HTMLElement): string | null | undefined => c.querySelector('.code-block-lang')?.textContent;
const code = (c: HTMLElement): string | null | undefined => c.querySelector('pre > code.hljs')?.textContent;

describe('M4.H1: the block highlight cap', () => {
  it('a 70 000-char ts block has no .hljs-keyword and says it is not highlighted', () => {
    const body = tsBody(70000);
    const c = block('ts', body);
    expect(keywords(c)).toBe(0);
    expect(label(c)).toBe('TypeScript · not highlighted (69 KiB)');
    expect(code(c)).toBe(body);
  });

  it('a 1 000-char ts block has keyword spans and its plain label', () => {
    const c = block('ts', tsBody(1000));
    expect(keywords(c)).toBeGreaterThan(0);
    expect(label(c)).toBe('TypeScript');
  });

  it('the cap is inclusive: 65 536 characters are highlighted, 65 537 are not', () => {
    expect(MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
    const at = block('ts', tsBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS));
    expect(keywords(at)).toBeGreaterThan(0);
    expect(label(at)).toBe('TypeScript');
    cleanup();
    const over = block('ts', tsBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1));
    expect(keywords(over)).toBe(0);
    expect(label(over)).toBe('TypeScript · not highlighted (65 KiB)');
  });

  it('counts the block after the trailing-newline strip, as the copy button does', () => {
    // tsBody(65 536) plus the newline `block` appends is 65 537 characters before the strip.
    expect(keywords(block('ts', tsBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS)))).toBeGreaterThan(0);
  });

  it('a 70 000-char block from the parse pipeline is capped too', () => {
    const outcome = parseMarkdown('```ts\n' + tsBody(70000) + '\n```');
    if (outcome.kind !== 'tree') throw new Error(`expected a tree, got ${outcome.kind}`);
    const c = render(renderHast(outcome.tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }))
      .container;
    expect(keywords(c)).toBe(0);
    expect(label(c)).toBe('TypeScript · not highlighted (69 KiB)');
  });
});

describe('the highlight prop and the other two conditions', () => {
  it('highlight={false} renders a small registered block as plain <code class="hljs"> with its plain label', () => {
    const body = tsBody(1000);
    const c = block('ts', body, false);
    expect(keywords(c)).toBe(0);
    expect(c.querySelector('pre > code.hljs')?.children).toHaveLength(0);
    expect(code(c)).toBe(body);
    expect(label(c)).toBe('TypeScript');
  });

  it('highlight={true} is the default', () => {
    expect(keywords(block('ts', tsBody(1000), true))).toBeGreaterThan(0);
  });

  it('an unregistered language is unchanged by the cap: no spans either way, its own label', () => {
    const big = block('mermaid', tsBody(70000));
    expect(keywords(big)).toBe(0);
    expect(label(big)).toBe('mermaid');
    cleanup();
    expect(label(block('mermaid', tsBody(1000)))).toBe('mermaid');
  });
});
```

Check the bytes: `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/test/markdown-highlight.test.tsx` prints `0`; `grep -c '·' pwa/test/markdown-highlight.test.tsx` prints `4` (the header comment and three expected labels carry U+00B7 itself, written as the character: an agent write decodes a backslash-u escape, so write the character and check it here).

- [ ] **Step 6: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-highlight.test.tsx )`
Expected: `Test Files  1 failed (1)`, `Tests  4 failed | 4 passed (8)`; the four reds are `a 70 000-char ts block has no .hljs-keyword and says it is not highlighted` (`AssertionError: expected 5385 to be +0`), `the cap is inclusive: 65 536 characters are highlighted, 65 537 are not` (`expected 5041 to be +0`), `a 70 000-char block from the parse pipeline is capped too` and `highlight={false} renders a small registered block as plain <code class="hljs"> with its plain label` (`expected 77 to be +0`). The four that pass already hold at Task 3's state (spans under the cap, the strip, `highlight={true}`, an unregistered language), and are there for the mutations.

- [ ] **Step 7: Implement the cap.** Three edits in `pwa/src/lib/markdown.tsx`.

(a) The import block (line 26, a hint). Find:

```tsx
import { remarkAlerts } from './remarkAlerts';
import '../session/chat.css';
```

Replace with:

```tsx
import { remarkAlerts } from './remarkAlerts';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from './markdownLimits';
import '../session/chat.css';
```

(b) `CodeBlock`'s doc comment, signature and highlight decision (lines 88-100, a hint). Find:

```tsx
/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay. */
export function CodeBlock({ children }: { children?: ReactNode }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const html = lang && hljs.getLanguage(lang)
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
```

Replace with:

```tsx
/** Fenced code: language label + copy bar over a syntax-highlighted well.
 *  The bar is a SIBLING above the scrolling <pre>, never an overlay.
 *  Highlighted only when the language is registered, `highlight` is not `false`, and the block is at most
 *  `MD_HIGHLIGHT_BLOCK_MAX_CHARS` characters (after the trailing-newline strip); a registered block over the cap
 *  renders as plain text and says so in its label, its size in whole KiB of characters, rounded up. */
export function CodeBlock({ children, highlight }: { children?: ReactNode; highlight?: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const lang = (/language-([\w-]+)/.exec(codeEl?.props.className ?? '')?.[1] ?? '').toLowerCase();
  const label = LANG_LABEL[lang] ?? (lang || 'text');
  const raw = nodeText(children).replace(/\n$/, '');
  const wanted = highlight !== false && Boolean(lang && hljs.getLanguage(lang));
  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;
  const html = wanted && !overCap
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value // sync, never throws
    : null;
```

(c) The label (line 110, a hint). Find:

```tsx
        <span className="code-block-lang">{label}</span>
```

Replace with:

```tsx
        <span className="code-block-lang">
          {overCap ? `${label} · not highlighted (${Math.ceil(raw.length / 1024)} KiB)` : label}
        </span>
```

JSX drops the whitespace-only lines around the expression, so a label under the cap renders exactly the markup it did. Check the bytes: `grep -c '·' pwa/src/lib/markdown.tsx` prints `1`; `LC_ALL=C grep -c -P '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' pwa/src/lib/markdown.tsx pwa/src/lib/renderHast.tsx` prints `0` for each; `wc -l < pwa/src/lib/markdown.tsx` prints `197`.

- [ ] **Step 8: Run them to verify they pass, and that chat did not move.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-highlight.test.tsx )`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/render-hast.test.tsx test/markdown-highlight.test.tsx test/markdown-golden.test.tsx test/message-links.test.tsx test/markdown-purity.test.ts )` then `git status --porcelain pwa/test/golden pwa/test/message-links.test.tsx`
Expected: `Test Files  5 passed (5)`, `Tests  262 passed (262)` (Step 0's count plus 72 + 8), `Type Errors  no errors`, then nothing from `git status`: no golden file moved (no corpus block is near 65 536 characters) and `message-links.test.tsx` is unmodified.

- [ ] **Step 9: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests`, `contrast.test.ts`'s spawned-gate cases and `session-pickers.test.tsx` are known load flakes: a red in one of them is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK`.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-parse.test.ts test/remark-alerts.test.ts test/chat.test.tsx )`
Expected: `Test Files  3 passed (3)`, `Tests  82 passed (82)` (unchanged from Task 3's state: this task edits neither the parse nor the plugin).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  117 passed (117)`, `Tests  3800 passed (3800)` at planning (Task 3's 115 files and 3 720 tests, plus this task's 2 files and 80 cases; re-derive the base at Step 0's state if another programme moved it). A red in `contrast.test.ts` or `session-pickers.test.tsx` is re-run alone: `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts test/session-pickers.test.tsx )` gives `Tests  287 passed (287)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; `renderHast` and `RenderHastOptions` collide with no scanned name).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the three new files.

Run: `git add pwa/src/lib/markdown.tsx pwa/src/lib/renderHast.tsx pwa/test/render-hast.test.tsx pwa/test/markdown-highlight.test.tsx && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; every fixture is a placeholder: `example.com`, `<server-host>`).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 10: Commit.**

```bash
git add pwa/src/lib/markdown.tsx pwa/src/lib/renderHast.tsx pwa/test/render-hast.test.tsx pwa/test/markdown-highlight.test.tsx
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: renderHast, pipeline parity, raw HTML as text and the block highlight cap (docs W4)" \
  -m "lib/renderHast.tsx is react-markdown's post() minus the raw step and the element filters chat never uses: with a urlTransform it applies it to each html-url-attributes key on a copy of the tree (explicit stack, the input never written), then toJsxRuntime with post()'s options. A parseMarkdown tree rendered through it with CHAT_COMPONENTS and defaultUrlTransform equals <Markdown> over the whole chat corpus (M4.P10), and raw HTML is visible text with no img or script on both paths (M4.P5)." \
  -m "CodeBlock gains highlight?: boolean and the block cap: a registered block over MD_HIGHLIGHT_BLOCK_MAX_CHARS characters (65 536, inclusive, after the trailing-newline strip) is not highlighted and labels itself '{label} · not highlighted ({KiB} KiB)', KiB rounded up (M4.H1). No golden file moves." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `4`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; Task 6 re-spells `ChatMarkdown` and so re-anchors W4-T4-M5, with W4-T1-M1 and W4-T1-M2, on its synchronous component's `<Markdown>` line in its own rows block):

```json
[
 {
  "id": "W4-T4-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "      .use(remarkRehype, { allowDangerousHtml: true });",
  "new": "      .use(remarkRehype, { allowDangerousHtml: false });",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 2 failed | 70 passed (72) — M4.P10 'raw-html' (remark-rehype drops the raw nodes, react-markdown keeps them as text) and M4.P5 'through renderHast (the worker path)' (the three raw strings are gone from the text)"
 },
 {
  "id": "W4-T4-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  rawToText(node);\n",
  "new": "",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 2 failed | 70 passed (72) — M4.P10 'raw-html' and M4.P5 'through renderHast (the worker path)' (the raw nodes reach toJsxRuntime, which drops them, so the placeholder text vanishes)"
 },
 {
  "id": "W4-T4-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };",
  "new": "      if (child.type === 'raw') children[i] = { type: 'element', tagName: 'span', properties: { dangerouslySetInnerHTML: { __html: child.value ?? '' } }, children: [] } as WalkNode;",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 2 failed | 70 passed (72) — M4.P10 'raw-html' and M4.P5 'through renderHast (the worker path)' (the rehype-raw analogue: the img and script become live elements)"
 },
 {
  "id": "W4-T4-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "      if (child.type === 'raw') children[i] = { type: 'text', value: child.value ?? '' };",
  "new": "      if (child.type === 'raw') { children.splice(i, 1); i -= 1; }",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 2 failed | 70 passed (72) — M4.P10 'raw-html' and M4.P5 'through renderHast (the worker path)' (the skipHtml analogue on the worker path: the <server-host> placeholder vanishes)"
 },
 {
  "id": "W4-T4-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS} skipHtml>{text}</Markdown>;",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 1 failed | 71 passed (72) — M4.P5 'through ChatMarkdown (the sync path)' (skipHtml deletes the raw text)"
 },
 {
  "id": "W4-T4-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/renderHast.tsx",
  "old": "  const input = opts.urlTransform === undefined ? tree : transformUrls(tree, opts.urlTransform);",
  "new": "  const input = tree;",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 6 failed | 66 passed (72) — M4.P10 'javascript-link-and-image', 'data-image', 'the javascript: link and image are blanked on both paths, not just equal', and the url-clause cases 'with defaultUrlTransform, url attributes are blanked and other attributes are untouched', 'applies a url key only to the elements html-url-attributes lists it for', 'calls the transform once per url attribute, with the key and the element, as post() does'"
 },
 {
  "id": "W4-T4-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/renderHast.tsx",
  "old": "      for (const key in urlAttributes) {\n        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(copy.properties, key)) {\n          const test = urlAttributes[key];\n",
  "new": "      for (const key in copy.properties) {\n        if (Object.hasOwn(copy.properties, key)) {\n          const test = null;\n",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 4 failed | 68 passed (72) — M4.P10 'colon-in-a-fence-info' (the code's className is blanked), 'with defaultUrlTransform, url attributes are blanked and other attributes are untouched' (the title is blanked), 'applies a url key only to the elements html-url-attributes lists it for', 'calls the transform once per url attribute, with the key and the element, as post() does'"
 },
 {
  "id": "W4-T4-M8",
  "pkg": "pwa",
  "file": "pwa/src/lib/renderHast.tsx",
  "old": "          if (test === null || test?.includes(copy.tagName)) {",
  "new": "          if (test !== undefined) {",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 1 failed | 71 passed (72) — 'applies a url key only to the elements html-url-attributes lists it for' (the div's cite is blanked)"
 },
 {
  "id": "W4-T4-M9",
  "pkg": "pwa",
  "file": "pwa/src/lib/renderHast.tsx",
  "old": "      const copy: Element = { ...child, properties: { ...child.properties }, children: [] };",
  "new": "      const copy: Element = { ...child, properties: child.properties, children: [] };",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 1 failed | 71 passed (72) — 'a tree rendered with a transform deep-equals its clone from before, and renders the same twice' (the caller's javascript: href is blanked in place)"
 },
 {
  "id": "W4-T4-M10",
  "pkg": "pwa",
  "file": "pwa/src/lib/renderHast.tsx",
  "old": "    passNode: true,",
  "new": "    passNode: false,",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 2 failed | 70 passed (72) — 'passes each element to the components as `node`' and 'applies a url key only to the elements html-url-attributes lists it for' (both read `node`)"
 },
 {
  "id": "W4-T4-M11",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "new": "  const overCap = false;",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 3 failed | 5 passed (8) — 'a 70 000-char ts block has no .hljs-keyword and says it is not highlighted', 'the cap is inclusive: 65 536 characters are highlighted, 65 537 are not', 'a 70 000-char block from the parse pipeline is capped too'"
 },
 {
  "id": "W4-T4-M12",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "new": "  const overCap = wanted && raw.length >= MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 2 failed | 6 passed (8) — 'the cap is inclusive: 65 536 characters are highlighted, 65 537 are not' and 'counts the block after the trailing-newline strip, as the copy button does' (65 536 is no longer highlighted)"
 },
 {
  "id": "W4-T4-M13",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "Math.ceil(raw.length / 1024)",
  "new": "Math.floor(raw.length / 1024)",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 3 failed | 5 passed (8) — the two 70 000-char cases (68 KiB) and 'the cap is inclusive: 65 536 characters are highlighted, 65 537 are not' (64 KiB)"
 },
 {
  "id": "W4-T4-M14",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const wanted = highlight !== false && Boolean(lang && hljs.getLanguage(lang));",
  "new": "  const wanted = Boolean(lang && hljs.getLanguage(lang));",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 1 failed | 7 passed (8) — 'highlight={false} renders a small registered block as plain <code class=\"hljs\"> with its plain label'"
 },
 {
  "id": "W4-T4-M15",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "new": "  const overCap = raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 1 failed | 7 passed (8) — 'an unregistered language is unchanged by the cap: no spans either way, its own label' (mermaid reads 'mermaid · not highlighted (69 KiB)')"
 },
 {
  "id": "W4-T4-M16",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const overCap = wanted && raw.length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "new": "  const overCap = wanted && nodeText(children).length > MD_HIGHLIGHT_BLOCK_MAX_CHARS;",
  "tests": [
   "test/markdown-highlight.test.tsx"
  ],
  "red": "pwa markdown-highlight: 2 failed | 6 passed (8) — 'the cap is inclusive: 65 536 characters are highlighted, 65 537 are not' and 'counts the block after the trailing-newline strip, as the copy button does' (65 536 characters plus the newline is 65 537 before the strip)"
 }
]
```

---

### Task 5: The worker and its runner: protocol, budget, terminate and respawn, stale ids, abort, two singletons; vite's worker format

**Model routing:** `sonnet`, effort `high` — a small state machine (one worker, a FIFO, a timer per posted job, a sticky failure, two kinds of abort) whose every transition is pinned by a fake worker and a fake clock, plus a worker entry that must type `self` without the WebWorker lib. Every number below was measured on the shared scratch tree at Task 4's state, the mutations in a separate copy.

**Spec rows:** M4.P6 (a fake spawn that never answers, fake timers: `timeout` at the budget, `terminate` once; the budget formula table, 1 KiB 2 s, 128 KiB 4 s, 1 MiB 10 s; mutations: drop the timer, drop terminate, a fixed budget), M4.P7's runner half (spawn throws: `worker-unavailable`, distinct from `timeout`; mutation: fold it into `timeout`), M4.P8 (a fake `error`: `worker-failed`, and the next parse respawns; mutation: reuse the dead worker), M4.P11 (v1 answering after v2 shows v2; mutation: drop the id check). Section 4.10's "Worker and runner" paragraph whole; section 4.1's `vite.config.ts` row. Refinements (a) (M4.P6's "Format anyway posts a 30 000 job" is W5's half: here the runner honours a 30 000 `budgetMs`; M4.P7's chat half, 4 KiB in-thread and 5 KiB's note, is Task 6's), (f) (`profile` is carried, never branched on), (g) (`MarkdownParser`, the protocol in `markdownParse.ts`), (h) (abort and `dispose()` reject with an `AbortError`, so `ParseOutcome` keeps its eight arms), (r) (Task 12 runs the build gate; this task looks at the chunk once) and (w) (the two worker files assign `onmessage` and call `postMessage(`; no other `lib/markdown*` file does, and none adds a `'message'` listener or calls `URL.createObjectURL(`).

**Files:**
- Create: `pwa/src/lib/markdownRunner.ts` — 235 lines: `MarkdownParser`, `WorkerLike`, `MarkdownRunnerDeps`, `MarkdownRunner`, `defaultSpawn`, `createMarkdownRunner`, `docsRunner`, `chatRunner`. Imports only types, from `./markdownParse`, so the main bundle never reaches the parse closure through it.
- Create: `pwa/src/lib/markdownWorker.ts` — 16 lines, no exports: assigns `self.onmessage` to `answerMarkdownJob`.
- Create: `pwa/test/markdown-worker.test.ts` — 104 lines, 18 cases: `answerMarkdownJob` (the echo, a `'docs'` job, a refusal, five malformed jobs, seven id-less messages, the post guard twice) and the worker entry under a stubbed `self`.
- Create: `pwa/test/markdown-runner.test.ts` — 478 lines, 34 cases: M4.P6 (12, the formula table among them), M4.P7 (2), M4.P8 (5), M4.P11 (2), the queue (6), the two runners (2), five source pins.
- Modify: `pwa/src/lib/markdownParse.ts` — one Find/Replace on its last function (lines 129-132, a hint) that appends `MarkdownJob`, `MarkdownReply` and `answerMarkdownJob`. 132 lines become 171. Nothing above the last function changes, so no Task 3 or Task 4 row anchored in this file is re-anchored.
- Modify: `pwa/test/markdown-purity.test.ts` — two Find/Replace edits: the header comment's Task 5 sentence (line 7, a hint) and `ROOTS` (line 19, a hint), which gains `markdownWorker.ts`. 86 lines become 88.
- Modify: `pwa/vite.config.ts` — one Find/Replace before `build:` (lines 71-73, a hint): `worker: { format: 'es' }` and a two-line comment. 93 lines become 96. Its co-tenant comment and its `navigateFallbackDenylist:` line are not touched (Task 9 owns the first; `sw-denylist.test.ts` pins the second).
- Test: the two new files and `pwa/test/markdown-purity.test.ts`; guards `pwa/test/markdown-parse.test.ts`, `pwa/test/markdown-golden.test.tsx`, `pwa/test/message-links.test.tsx` (unmodified), `pwa/test/render-hast.test.tsx`, `pwa/test/sw-denylist.test.ts`, the whole PWA suite, the PWA `tsc`, `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts` (not edited), `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`.

Every Find block below is quoted from its file as Task 4 left it (Task 4 edits none of the three, so `markdownParse.ts` and `markdown-purity.test.ts` are Task 3's text and `vite.config.ts` is `BASE`'s) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from Task 3: `parseMarkdown(src: string, profile?: MarkdownProfile): ParseOutcome`, `type ParseOutcome`, `type MarkdownProfile` and the module-private `errorName(e: unknown): string` (`pwa/src/lib/markdownParse.ts`); `DOCS_PARSE_BUDGET_MS: (bytes: number) => number`, `DOCS_PARSE_BUDGET_LARGE_MS` (30 000) and `CHAT_PARSE_BUDGET_MS` (2 000) (`pwa/src/lib/markdownLimits.ts`, tests only).
- Produces, appended to `pwa/src/lib/markdownParse.ts` (in the worker closure):
  - `export interface MarkdownJob { readonly id: number; readonly src: string; readonly profile: MarkdownProfile }`
  - `export interface MarkdownReply { readonly id: number; readonly outcome: ParseOutcome }`
  - `export function answerMarkdownJob(data: unknown, post: (reply: MarkdownReply) => void): void` — a message that is not an object, or whose `id` is not a finite number, is dropped (nothing is posted: there is no id to answer to). A non-string `src`, or a `profile` other than `'chat'` and `'docs'`, answers `{kind: 'threw', error: 'TypeError'}` under the job's `id`. Otherwise it posts `{id, outcome: parseMarkdown(src, profile)}`. A `post` that throws is answered once more with `{kind: 'threw', error: <the thrown name>}` (a structured clone's `DataCloneError` included); a throw from that second post is swallowed, and the runner's budget answers the job.
- Produces, `pwa/src/lib/markdownWorker.ts`: no exports. `worker.onmessage = (e) => answerMarkdownJob(e.data, (reply) => worker.postMessage(reply));`, where `worker` is `self` cast to `{ onmessage: ((e: { data: unknown }) => void) | null; postMessage(reply: MarkdownReply): void }` (the tsconfig has no WebWorker lib).
- Produces, in `pwa/src/lib/markdownRunner.ts`:
  - `export type MarkdownParser = (src: string, opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal }) => Promise<ParseOutcome>;` — resolves with the job's outcome (any of the eight arms; the runner itself adds only `timeout`, `worker-unavailable` and `worker-failed`); rejects only when the job is aborted (with `signal.reason`) or the runner is disposed (with `new DOMException('disposed', 'AbortError')`). `signal` absent has one meaning: the caller cannot abort.
  - `export interface WorkerLike { postMessage(job: MarkdownJob): void; terminate(): void; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onmessageerror: ((e: unknown) => void) | null }`
  - `export interface MarkdownRunnerDeps { spawn: () => WorkerLike; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (handle: unknown) => void }` — a throw from `spawn` means no worker can be had here, for good.
  - `export interface MarkdownRunner { readonly parse: MarkdownParser; prewarm(): void; dispose(): void }` — `parse` is an own, writable property of a plain object, so Task 6 spies it with `vi.spyOn(chatRunner, 'parse')` (measured: `tsc` accepts it on the `readonly` field and the spy replaces it).
  - `export function defaultSpawn(): WorkerLike` — body exactly `return new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;`; throws where there is no `Worker` (jsdom: `ReferenceError`).
  - `export function createMarkdownRunner(deps?: Partial<MarkdownRunnerDeps>): MarkdownRunner` — each absent dep defaults (`defaultSpawn`, `setTimeout`, `clearTimeout`).
  - `export const docsRunner: MarkdownRunner` and `export const chatRunner: MarkdownRunner` — two calls of `createMarkdownRunner()`; neither spawns anything until first used.

**Decisions this task makes (none departs from the spec's text):**
1. **One mechanism per hazard.** A reply is accepted only when it is an object with an `outcome` and its `id` is the running job's (M4.P11). A dropped worker (timed out, failed, aborted under, disposed) has its three handlers set to `null` before `terminate()`, so nothing it sends afterwards is heard; there is no second identity check. `expire(job)` keeps a `running?.job !== job` check, which no public call can reach because every exit from "running" clears the job's timer first: measured equivalent (the mutant deleting it is green, 34 of 34) and recorded here, not as a row.
2. **A `postMessage` that throws is `worker-failed`** with the thrown name (section 4.10 names only the `error` and `messageerror` events): the job's timer is cleared, the worker dropped, and the next job respawns. The main thread posts a `{id, src, profile}` of a number and two strings, so this cannot happen with a real `Worker`; it keeps the runner from sticking in "running" if a host ever throws.
3. **`answerMarkdownJob` also refuses an unknown `profile`.** The arch names a non-string `src`; an unknown profile is the same kind of malformed job, and without the check `PLUGINS_BY_PROFILE[profile]` reaches `Object.prototype` (`'toString'`), measured to parse with a different plugin list. It answers `threw` `TypeError`, as a bad `src` does.
4. **The worker entry is imported once, under a stub.** Refinement (g) puts the protocol in `markdownParse.ts` so tests never NEED the entry; one case still imports it with `vi.stubGlobal('self', fake)` and `vi.resetModules()` after, to prove the wiring (assign `onmessage`, answer through the worker's own `postMessage`). Every other case drives `answerMarkdownJob` directly.
5. **`dispose()` leaves the runner usable**: a later job spawns a fresh worker. The sticky `worker-unavailable` is never cleared, by `dispose()` or anything else.
6. **The runner imports types only** (`import type` from `./markdownParse`) and keeps a local `thrownName`, the same rule as `markdownParse.ts`'s private `errorName`, rather than importing a value: a value import would pull `unified` and the remark plugins into the main bundle through the runner. `single-definition.test.ts` scans neither name (523 green, unchanged).
7. **The build emits no worker chunk at this task's state, by design.** Nothing imports `markdownRunner.ts` until Task 6's `ChatMarkdown`, so Rollup drops it: a plain `npm run build` here measured `precache  16 entries (1549.86 KiB)` and no `markdownWorker-*.js`. Step 9 adds a one-line probe import in a throwaway copy only, to see the chunk once: `assets/markdownWorker-<hash>.js` 127.49 kB, an ES module that imports no other chunk, listed once in `sw.js`, `precache  17 entries (1676.30 KiB)`. Without `worker: { format: 'es' }` the same build emits an IIFE (measured, `(function(){...`), so the key is observable, and a source pin holds it (W4-T5-M36). Task 12 runs the real gate on the wave's end state (refinement (r)).
8. **The scans read raw text and say so.** The source pins in `markdown-runner.test.ts` list their known evasions in their own comment as not exhaustive: bracket access (`self['addEventListener']`, `URL['createObjectURL']`), an alias (`const u = URL; u.createObjectURL(...)`), an event name held in a variable; and a comment counts.

**Measured while planning** (the shared scratch tree at Task 4's state; the mutations in a separate copy):
1. **RED**: worker test `Error: Failed to resolve import "../src/lib/markdownWorker" from "test/markdown-worker.test.ts". Does the file exist?`, `Tests  no tests`; runner test the same for `../src/lib/markdownRunner`; purity test, after its `ROOTS` edit, `Error: ENOENT: no such file or directory, open '<worktree>/pwa/src/lib/markdownWorker.ts'`, `Tests  no tests`.
2. **GREEN**: worker + runner + purity + parse `Test Files  4 passed (4)`, `Tests  72 passed (72)` (18 + 34 + 7 + 13), `Type Errors  no errors`.
3. **Guards**: PWA `tsc` clean; under `CI=1`, sw-denylist + golden + message-links + render-hast `Tests  258 passed (258)` with no golden file moved; the whole PWA suite `Test Files  119 passed (119)`, `Tests  3852 passed (3852)` (Task 4's 117 and 3 800, plus 2 files and 52 cases; at load average 28 one whole-suite run showed 7 reds in `contrast.test.ts`'s spawned-gate cases, `fleet-screen`, `session-pickers` and `start-program`, which passed alone, `Tests  491 passed (491)`, and in the next whole run); `single-definition` + `source-bytes` + `topology-clean` `Tests  580 passed (580)`; `typecheck-tests` 10 of 12 in the scratch tree, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules` (`Cannot find module 'vitest'`, `'ws'`, `'node-pty'`), as at Tasks 1-4, with `pwa/ is clean under tsconfig.json` green over the four new files.
4. **Mutations**: 36 rows, each measured red in a separate copy (`git archive` of the staged tree, `git init`, `pwa/node_modules` and `server/node_modules` linked in), restored after each with `git checkout -- <file>`; `git status --porcelain` in the copy was empty after every one. One mutant is green and recorded as equivalent (decision 1).

- [ ] **Step 0: Confirm the state and claim `pwa/vite.config.ts`.** From the worktree root, foreground.

Run: `test -e pwa/src/lib/renderHast.tsx && test -e pwa/src/lib/markdownParse.ts && test ! -e pwa/src/lib/markdownWorker.ts && test ! -e pwa/src/lib/markdownRunner.ts && test ! -e pwa/test/markdown-worker.test.ts && test ! -e pwa/test/markdown-runner.test.ts && git diff --quiet HEAD -- pwa && ! grep -q 'answerMarkdownJob' pwa/src/lib/markdownParse.ts && ! grep -q '^  worker:' pwa/vite.config.ts && grep -qF "const ROOTS: readonly string[] = ['markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts'];" pwa/test/markdown-purity.test.ts && echo T5-STATE-OK`
Expected: `T5-STATE-OK` (Task 4 is committed, the tree is clean under `pwa/`, none of this task's files exists, and the vite config has no `worker` key). If it does not print, stop and put an ask to the coordinator.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-purity.test.ts test/markdown-parse.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  20 passed (20)` (7 + 13 at planning; whatever it prints, Step 7's run of these two plus this task's two new files must print it plus 52).

Then take the claim on `pwa/vite.config.ts` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`); Task 9 edits the same file later in this wave. A 409 names the holder: mail it through the response's `mailHint` and do not edit the file until that claim ends or the two coordinators confirm a scoped agreement (this task edits only the lines before `build:`). The other files this task edits are W4's own (created in Tasks 3 and 4 on this branch), so no other claim is taken.

- [ ] **Step 1: Write the failing protocol test.** Create `pwa/test/markdown-worker.test.ts` with exactly this content:

```ts
// The parse worker's protocol (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and runner").
// `answerMarkdownJob` is everything the worker does with one message: `{id, src, profile}` in, `{id, outcome}` out,
// with both the parse and the post wrapped, so a reply the structured clone refuses (a `DataCloneError`) answers
// `threw` instead of leaving the runner to wait out its budget. The worker entry itself is imported once, under a
// stubbed `self`, to prove it assigns `onmessage` to `answerMarkdownJob` and answers through the worker's own post.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerMarkdownJob, parseMarkdown, type MarkdownReply } from '../src/lib/markdownParse';

/** A `post` that records every reply it is given. */
function recorder(): { replies: MarkdownReply[]; post: (reply: MarkdownReply) => void } {
  const replies: MarkdownReply[] = [];
  return { replies, post: (reply) => { replies.push(reply); } };
}

describe('answerMarkdownJob', () => {
  it('answers with the job id and the outcome parseMarkdown gives for its src', () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 7, src: '# hi', profile: 'chat' }, post);
    expect(replies).toEqual([{ id: 7, outcome: parseMarkdown('# hi', 'chat') }]);
    expect(replies[0]?.outcome.kind).toBe('tree');
  });

  it("answers a 'docs' job the same way", () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 8, src: '> [!NOTE]\n> a', profile: 'docs' }, post);
    expect(replies).toEqual([{ id: 8, outcome: parseMarkdown('> [!NOTE]\n> a', 'docs') }]);
  });

  it('answers a pre-scan refusal like any other outcome', () => {
    const { replies, post } = recorder();
    answerMarkdownJob({ id: 9, src: '>'.repeat(10000) + ' x', profile: 'chat' }, post);
    expect(replies).toEqual([{ id: 9, outcome: { kind: 'refused', why: 'container-depth', line: 1, value: 10000 } }]);
  });

  it.each([
    ['a missing src', { id: 1, profile: 'chat' }],
    ['a numeric src', { id: 1, src: 42, profile: 'chat' }],
    ['a missing profile', { id: 1, src: 'x' }],
    ['an unknown profile', { id: 1, src: 'x', profile: 'wiki' }],
    ['an inherited name as the profile', { id: 1, src: 'x', profile: 'toString' }],
  ])('%s answers threw TypeError under the job id', (_name, job) => {
    const { replies, post } = recorder();
    answerMarkdownJob(job, post);
    expect(replies).toEqual([{ id: 1, outcome: { kind: 'threw', error: 'TypeError' } }]);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 1],
    ['an object with no id', { src: 'x', profile: 'chat' }],
    ['a string id', { id: '1', src: 'x', profile: 'chat' }],
    ['a NaN id', { id: Number.NaN, src: 'x', profile: 'chat' }],
    ['an infinite id', { id: Number.POSITIVE_INFINITY, src: 'x', profile: 'chat' }],
  ])('a message with %s is dropped: there is no id to answer to', (_name, data) => {
    const { replies, post } = recorder();
    answerMarkdownJob(data, post);
    expect(replies).toEqual([]);
  });

  it('a post that throws a DataCloneError answers once more, threw DataCloneError, under the same id', () => {
    const replies: MarkdownReply[] = [];
    let calls = 0;
    answerMarkdownJob({ id: 3, src: 'x', profile: 'chat' }, (reply) => {
      calls += 1;
      if (calls === 1) throw new DOMException('could not be cloned', 'DataCloneError');
      replies.push(reply);
    });
    expect(calls).toBe(2);
    expect(replies).toEqual([{ id: 3, outcome: { kind: 'threw', error: 'DataCloneError' } }]);
  });

  it("a post that throws twice is swallowed: the runner's budget answers that job", () => {
    const post = vi.fn((_reply: MarkdownReply): void => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    });
    expect(() => answerMarkdownJob({ id: 4, src: 'x', profile: 'chat' }, post)).not.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('the worker entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('assigns self.onmessage, which answers each job through self.postMessage', async () => {
    const posted: unknown[] = [];
    const fakeSelf: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = {
      onmessage: null,
      postMessage: (m) => { posted.push(m); },
    };
    vi.stubGlobal('self', fakeSelf);
    await import('../src/lib/markdownWorker');
    expect(fakeSelf.onmessage).toBeTypeOf('function');
    fakeSelf.onmessage?.({ data: { id: 1, src: '# hi', profile: 'docs' } });
    fakeSelf.onmessage?.({ data: { id: 2, src: 42, profile: 'chat' } });
    expect(posted).toEqual([
      { id: 1, outcome: parseMarkdown('# hi', 'docs') },
      { id: 2, outcome: { kind: 'threw', error: 'TypeError' } },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker.test.ts )`
Expected: `FAIL  test/markdown-worker.test.ts [ test/markdown-worker.test.ts ]`, `Error: Failed to resolve import "../src/lib/markdownWorker" from "test/markdown-worker.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Write the failing runner test.** Create `pwa/test/markdown-runner.test.ts` with exactly this content:

```ts
// The parse worker's main-thread runner (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and
// runner" and section 4.15's M4.P6, M4.P7, M4.P8 and M4.P11). jsdom has no `Worker`, so every case but the default
// one injects a fake `spawn` (each call a new FakeWorker that records its posts and lets the test emit `message`,
// `error` and `messageerror`) and a fake clock (`setTimer`/`clearTimer` that fire only when the test advances).
// M4.P6's "Format anyway posts a 30 000 job" is W5's half; here the runner honours a 30 000 budget (the W4 plan's
// refinement (a)). M4.P7's chat half (4 KiB in-thread, 5 KiB's note) is Task 6's.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MarkdownJob, ParseOutcome } from '../src/lib/markdownParse';
import {
  chatRunner, createMarkdownRunner, defaultSpawn, docsRunner, type MarkdownRunner, type WorkerLike,
} from '../src/lib/markdownRunner';
import { CHAT_PARSE_BUDGET_MS, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_PARSE_BUDGET_MS } from '../src/lib/markdownLimits';

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  readonly posts: MarkdownJob[] = [];
  terminated = 0;
  /** When set, `postMessage` throws it instead of recording the job. */
  throwOnPost: unknown = undefined;

  postMessage(job: MarkdownJob): void {
    if (this.throwOnPost !== undefined) throw this.throwOnPost;
    this.posts.push(job);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** The worker answers: whatever handler the runner left on this worker hears it. */
  send(data: unknown): void {
    this.onmessage?.({ data });
  }

  reply(id: number, outcome: ParseOutcome): void {
    this.send({ id, outcome });
  }

  fail(kind: 'error' | 'messageerror'): void {
    (kind === 'error' ? this.onerror : this.onmessageerror)?.({ type: kind });
  }
}

/** Timers that fire only when the test advances the clock, in due order. */
class FakeClock {
  now = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  readonly setTimer = (fn: () => void, ms: number): unknown => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.now + ms, fn });
    return handle;
  };

  readonly clearTimer = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

/** A promise's state, readable synchronously once `flush()` has run. */
interface Tracked {
  state: 'pending' | 'resolved' | 'rejected';
  value?: ParseOutcome;
  reason?: unknown;
}

function track(p: Promise<ParseOutcome>): Tracked {
  const t: Tracked = { state: 'pending' };
  p.then(
    (value) => { t.state = 'resolved'; t.value = value; },
    (reason: unknown) => { t.state = 'rejected'; t.reason = reason; },
  );
  return t;
}

/** Lets every settled promise's callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function harness(): { runner: MarkdownRunner; clock: FakeClock; workers: FakeWorker[]; spawn: () => WorkerLike } {
  const clock = new FakeClock();
  const workers: FakeWorker[] = [];
  const spawn = vi.fn((): WorkerLike => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  const runner = createMarkdownRunner({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { runner, clock, workers, spawn };
}

const CHAT = { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS } as const;
/** An outcome tagged by `n`, so a test can tell which reply resolved a promise. */
const answer = (n: number): ParseOutcome => ({ kind: 'too-deep', depth: n });

describe('M4.P6: the budget, terminate and respawn', () => {
  it('a job that never answers is a timeout exactly at its budget, after one terminate', async () => {
    const { runner, clock, workers, spawn } = harness();
    const job = track(runner.parse('x', CHAT));
    clock.advance(CHAT_PARSE_BUDGET_MS - 1);
    await flush();
    expect(job.state).toBe('pending');
    expect(workers[0]?.terminated).toBe(0);
    clock.advance(1);
    await flush();
    expect(job).toEqual({ state: 'resolved', value: { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS } });
    expect(workers[0]?.terminated).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('the next job after a timeout spawns a fresh worker and is answered by it', async () => {
    const { runner, clock, workers, spawn } = harness();
    void runner.parse('x', CHAT);
    clock.advance(CHAT_PARSE_BUDGET_MS);
    const next = track(runner.parse('y', CHAT));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['x']);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['y']);
    workers[1]?.reply(workers[1].posts[0]!.id, answer(1));
    await flush();
    expect(next).toEqual({ state: 'resolved', value: answer(1) });
  });

  it("honours each job's own budget: 30 000 ms (Format anyway's) times out at 30 000, not before", async () => {
    const { runner, clock } = harness();
    const job = track(runner.parse('x', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    clock.advance(DOCS_PARSE_BUDGET_LARGE_MS - 1);
    await flush();
    expect(job.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(job.value).toEqual({ kind: 'timeout', budgetMs: 30000 });
  });

  it.each([
    [0, 2000],
    [1024, 2000],
    [65535, 2000],
    [65536, 3000],
    [131072, 4000],
    [1048576, 10000],
    [10485760, 10000],
  ])('DOCS_PARSE_BUDGET_MS(%i) is %i', (bytes, ms) => {
    expect(DOCS_PARSE_BUDGET_MS(bytes)).toBe(ms);
  });

  it('the timer starts when a job is posted, not when it is queued', async () => {
    const { runner, clock, workers } = harness();
    const first = track(runner.parse('a', CHAT));
    const second = track(runner.parse('b', CHAT));
    clock.advance(1500);
    workers[0]?.reply(workers[0].posts[0]!.id, answer(1));
    await flush();
    expect(first.value).toEqual(answer(1));
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['a', 'b']);
    clock.advance(CHAT_PARSE_BUDGET_MS - 1); // 3 499 ms after both were queued, 1 999 after 'b' was posted
    await flush();
    expect(second.state).toBe('pending');
    clock.advance(1);
    await flush();
    expect(second.value).toEqual({ kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
  });

  it('a reply, an error and an abort each cancel the job timer', async () => {
    const { runner, clock, workers } = harness();
    void runner.parse('a', CHAT);
    workers[0]?.reply(workers[0].posts[0]!.id, answer(1));
    expect(clock.pending).toBe(0);
    void runner.parse('b', CHAT);
    workers[0]?.fail('error');
    expect(clock.pending).toBe(0);
    const ac = new AbortController();
    runner.parse('c', { ...CHAT, signal: ac.signal }).catch(() => undefined);
    expect(clock.pending).toBe(1);
    ac.abort();
    expect(clock.pending).toBe(0);
    await flush();
  });
});

describe('M4.P7: worker-unavailable is its own outcome, and sticky', () => {
  it('a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried', async () => {
    const clock = new FakeClock();
    const spawn = vi.fn((): WorkerLike => {
      throw new Error('no worker here');
    });
    const runner = createMarkdownRunner({ spawn, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const first = track(runner.parse('a', CHAT));
    const queued = track(runner.parse('b', CHAT));
    await flush();
    expect(first).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
    expect(queued).toEqual({ state: 'resolved', value: { kind: 'worker-unavailable' } });
    expect(clock.pending).toBe(0);
    runner.prewarm();
    const later = track(runner.parse('c', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    await flush();
    expect(later.value).toEqual({ kind: 'worker-unavailable' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('with no Worker global, defaultSpawn throws and a runner with no deps answers worker-unavailable', async () => {
    expect(typeof globalThis.Worker).toBe('undefined');
    expect(() => defaultSpawn()).toThrow();
    await expect(createMarkdownRunner().parse('# hi', CHAT)).resolves.toEqual({ kind: 'worker-unavailable' });
  });
});

describe('M4.P8: a worker that fails', () => {
  it.each(['error', 'messageerror'] as const)(
    '%s: the event answers worker-failed with its name, terminates, and the next job respawns',
    async (kind) => {
      const { runner, workers, spawn } = harness();
      const job = track(runner.parse('a', CHAT));
      workers[0]?.fail(kind);
      await flush();
      expect(job).toEqual({ state: 'resolved', value: { kind: 'worker-failed', error: kind } });
      expect(workers[0]?.terminated).toBe(1);
      const next = track(runner.parse('b', CHAT));
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
      workers[1]?.reply(workers[1].posts[0]!.id, answer(2));
      await flush();
      expect(next.value).toEqual(answer(2));
    },
  );

  it('an error while no job runs drops the worker too; the next job respawns', () => {
    const { runner, workers, spawn } = harness();
    runner.prewarm();
    workers[0]?.fail('error');
    expect(workers[0]?.terminated).toBe(1);
    void runner.parse('a', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[0]?.posts).toEqual([]);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['a']);
  });

  it('a postMessage that throws answers worker-failed with the thrown name, and the next job respawns', async () => {
    const { runner, workers, spawn, clock } = harness();
    runner.prewarm();
    workers[0]!.throwOnPost = new DOMException('could not be cloned', 'DataCloneError');
    const job = track(runner.parse('a', CHAT));
    await flush();
    expect(job.value).toEqual({ kind: 'worker-failed', error: 'DataCloneError' });
    expect(workers[0]?.terminated).toBe(1);
    expect(clock.pending).toBe(0);
    void runner.parse('b', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
  });

  it('a dropped worker is no longer heard: its late reply and its error reach nobody', async () => {
    const { runner, clock, workers } = harness();
    void runner.parse('a', CHAT);
    clock.advance(CHAT_PARSE_BUDGET_MS);
    const next = track(runner.parse('b', CHAT));
    const id = workers[1]!.posts[0]!.id;
    workers[0]?.reply(id, answer(1));
    workers[0]?.fail('error');
    await flush();
    expect(next.state).toBe('pending');
    expect(workers[1]?.terminated).toBe(0);
    workers[1]?.reply(id, answer(2));
    await flush();
    expect(next.value).toEqual(answer(2));
  });
});

describe('M4.P11: stale results are ignored by id', () => {
  it("v1 answering after v2 was posted resolves only v2's promise, with v2's outcome", async () => {
    const { runner, workers } = harness();
    const ac = new AbortController();
    const v1 = track(runner.parse('v1', { ...CHAT, signal: ac.signal }));
    const v2 = track(runner.parse('v2', CHAT));
    const v1Id = workers[0]!.posts[0]!.id;
    ac.abort();
    const w = workers[1]!;
    expect(w.posts.map((j) => j.src)).toEqual(['v2']);
    w.reply(v1Id, answer(1));
    await flush();
    expect(v1.state).toBe('rejected');
    expect(v2.state).toBe('pending');
    w.reply(w.posts[0]!.id, answer(2));
    await flush();
    expect(v2.value).toEqual(answer(2));
  });

  it("a reply for an id never posted, or with no outcome, is ignored; the running job's own id answers", async () => {
    const { runner, workers } = harness();
    const job = track(runner.parse('a', CHAT));
    const w = workers[0]!;
    const id = w.posts[0]!.id;
    w.reply(id + 1000, answer(9));
    w.send({ id });
    w.send(null);
    w.send('a string');
    await flush();
    expect(job.state).toBe('pending');
    w.reply(id, answer(1));
    await flush();
    expect(job.value).toEqual(answer(1));
  });
});

describe('the queue: FIFO, abort, prewarm, dispose', () => {
  it('posts one job at a time, in order, each with its own id, src and profile', async () => {
    const { runner, workers } = harness();
    const a = track(runner.parse('a', CHAT));
    const b = track(runner.parse('b', { profile: 'docs', budgetMs: 4000 }));
    const c = track(runner.parse('c', CHAT));
    const w = workers[0]!;
    expect(w.posts).toEqual([{ id: expect.any(Number), src: 'a', profile: 'chat' }]);
    w.reply(w.posts[0]!.id, answer(1));
    expect(w.posts.map((j) => [j.src, j.profile])).toEqual([['a', 'chat'], ['b', 'docs']]);
    w.reply(w.posts[1]!.id, answer(2));
    w.reply(w.posts[2]!.id, answer(3));
    await flush();
    expect(new Set(w.posts.map((j) => j.id)).size).toBe(3);
    expect([a.value, b.value, c.value]).toEqual([answer(1), answer(2), answer(3)]);
  });

  it("an abort while queued removes the job: it is never posted, and rejects with the signal's reason", async () => {
    const { runner, workers } = harness();
    const ac = new AbortController();
    void runner.parse('a', CHAT);
    const b = track(runner.parse('b', { ...CHAT, signal: ac.signal }));
    void runner.parse('c', CHAT);
    const reason = new DOMException('superseded', 'AbortError');
    ac.abort(reason);
    await flush();
    expect(b).toEqual({ state: 'rejected', reason });
    const w = workers[0]!;
    w.reply(w.posts[0]!.id, answer(1));
    expect(w.posts.map((j) => j.src)).toEqual(['a', 'c']);
    expect(w.terminated).toBe(0);
  });

  it('an abort while running terminates the worker, rejects, and the next job respawns', async () => {
    const { runner, workers, spawn } = harness();
    const ac = new AbortController();
    const a = track(runner.parse('a', { ...CHAT, signal: ac.signal }));
    void runner.parse('b', CHAT);
    ac.abort();
    await flush();
    expect(a.state).toBe('rejected');
    expect((a.reason as DOMException).name).toBe('AbortError');
    expect(workers[0]?.terminated).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['b']);
  });

  it('an already-aborted signal rejects at once, spawning and posting nothing', async () => {
    const { runner, spawn, clock } = harness();
    const ac = new AbortController();
    ac.abort('gone');
    const a = track(runner.parse('a', { ...CHAT, signal: ac.signal }));
    await flush();
    expect(a).toEqual({ state: 'rejected', reason: 'gone' });
    expect(spawn).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
  });

  it('prewarm spawns once and is idempotent; the next job uses that worker', () => {
    const { runner, workers, spawn } = harness();
    runner.prewarm();
    runner.prewarm();
    expect(spawn).toHaveBeenCalledTimes(1);
    void runner.parse('a', CHAT);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(workers[0]?.posts.map((j) => j.src)).toEqual(['a']);
  });

  it('dispose terminates, rejects every pending job with an AbortError, and a later job respawns', async () => {
    const { runner, workers, spawn, clock } = harness();
    const a = track(runner.parse('a', CHAT));
    const b = track(runner.parse('b', CHAT));
    runner.dispose();
    await flush();
    for (const t of [a, b]) {
      expect(t.state).toBe('rejected');
      expect((t.reason as DOMException).name).toBe('AbortError');
    }
    expect(workers[0]?.terminated).toBe(1);
    expect(clock.pending).toBe(0);
    void runner.parse('c', CHAT);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[1]?.posts.map((j) => j.src)).toEqual(['c']);
  });
});

describe('two runners', () => {
  it('docsRunner and chatRunner are two runners, not one', () => {
    expect(chatRunner).not.toBe(docsRunner);
    expect(chatRunner.parse).not.toBe(docsRunner.parse);
  });

  it('a docs job blocked for 30 s does not delay a chat job', async () => {
    const docs = harness();
    const chat = harness();
    const slow = track(docs.runner.parse('a long doc', { profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS }));
    const quick = track(chat.runner.parse('a message', CHAT));
    const w = chat.workers[0]!;
    expect(w.posts.map((j) => j.src)).toEqual(['a message']);
    w.reply(w.posts[0]!.id, answer(1));
    await flush();
    expect(quick.value).toEqual(answer(1));
    expect(slow.state).toBe('pending');
  });
});

// Source pins, on raw text. The worker URL must stay one literal expression, or Vite's static analysis cannot see
// the worker and emits no chunk; `vite.config.ts` bundles it as an ES module (without the key, Vite emits an IIFE,
// measured). Messages are received by assigning `onmessage` and sent with `postMessage(`, in the
// two worker files only (the W4 plan's refinement (w)); no `lib/markdown*` file adds a message listener or makes an
// object URL. The scans are NOT exhaustive: they read text, so a comment counts, and they miss a listener or an
// object URL reached through bracket access (`self['addEventListener']`, `URL['createObjectURL']`), through an alias
// (`const u = URL; u.createObjectURL(...)`), or through an event name held in a variable.
describe('source pins', () => {
  const LIB = path.join(import.meta.dirname, '..', 'src', 'lib');
  const read = (f: string): string => readFileSync(path.join(LIB, f), 'utf8');
  const MARKDOWN_FILES = readdirSync(LIB).filter((f) => /^markdown.*\.tsx?$/.test(f)).sort();
  const WORKER_FILES = ['markdownRunner.ts', 'markdownWorker.ts'];

  it('markdownRunner.ts spells the worker URL as one literal expression, once', () => {
    const literal = "new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' })";
    expect(read('markdownRunner.ts').split(literal)).toHaveLength(2);
  });

  it("vite.config.ts bundles the worker as an ES module: worker: { format: 'es' }", () => {
    const config = readFileSync(path.join(import.meta.dirname, '..', 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/^ {2}worker: \{ format: 'es' \},$/m);
  });

  it('the two worker files receive by assigning onmessage and send with postMessage(', () => {
    for (const f of WORKER_FILES) {
      expect(read(f), f).toMatch(/\.onmessage\s*=\s*\(/);
      expect(read(f), f).toContain('postMessage(');
    }
  });

  it('no other lib/markdown* file posts or receives messages', () => {
    expect(MARKDOWN_FILES).toEqual(expect.arrayContaining([...WORKER_FILES, 'markdownParse.ts', 'markdown.tsx']));
    for (const f of MARKDOWN_FILES.filter((m) => !WORKER_FILES.includes(m))) {
      expect(read(f), f).not.toMatch(/postMessage\s*\(|onmessage/);
    }
  });

  it('no lib/markdown* file adds a message listener or makes an object URL', () => {
    for (const f of MARKDOWN_FILES) {
      expect(read(f), f).not.toMatch(/addEventListener\s*\(\s*['"`]message/);
      expect(read(f), f).not.toMatch(/URL\s*\.\s*createObjectURL\s*\(/);
    }
  });
});
```

Check the bytes: `LC_ALL=C grep -c -P '[^\x09\x0a\x20-\x7e]' pwa/test/markdown-runner.test.ts pwa/test/markdown-worker.test.ts` prints `0` for each (plain ASCII: no control byte, no escape decoded by the write); `grep -c "\['\"\`\]message" pwa/test/markdown-runner.test.ts` prints `1` (the listener regex's character class, with its backtick, written as typed).

- [ ] **Step 4: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-runner.test.ts )`
Expected: `FAIL  test/markdown-runner.test.ts [ test/markdown-runner.test.ts ]`, `Error: Failed to resolve import "../src/lib/markdownRunner" from "test/markdown-runner.test.ts". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 5: Add the worker entry to the purity scan's roots, and see it fail.** Two edits in `pwa/test/markdown-purity.test.ts`.

(a) The header comment (line 7, a hint). Find:

```ts
// naming them can only ever be a type import. Task 5 adds `markdownWorker.ts` to ROOTS. It reads imports only: a DOM
```

Replace with:

```ts
// naming them can only ever be a type import. ROOTS end at `markdownWorker.ts`, the entry. It reads imports only: a DOM
```

(b) `ROOTS` (line 19, a hint). Find:

```ts
const ROOTS: readonly string[] = ['markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts'];
```

Replace with:

```ts
const ROOTS: readonly string[] = [
  'markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts', 'markdownWorker.ts',
];
```

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-purity.test.ts )`
Expected: `FAIL  test/markdown-purity.test.ts [ test/markdown-purity.test.ts ]`, `Error: ENOENT: no such file or directory, open '<worktree>/pwa/src/lib/markdownWorker.ts'`, `Test Files  1 failed (1)`, `Tests  no tests`. The closure walk reads each root at collection time, so the missing entry fails the file, not a case. The case `is exactly the worker-side lib files` derives its expected list from `ROOTS`, so it needs no edit.

- [ ] **Step 6: Implement.** Four edits.

(a) Append the protocol to `pwa/src/lib/markdownParse.ts`: its last function (lines 129-132, a hint). Find:

```ts
/** Steps 2 to 5 without the pre-scan: the control for the pre-scan's refusals (M4.P1), never a production path. */
export function parseWithoutPrescan(src: string): ParseOutcome {
  return run(src, 'chat');
}
```

Replace with:

```ts
/** Steps 2 to 5 without the pre-scan: the control for the pre-scan's refusals (M4.P1), never a production path. */
export function parseWithoutPrescan(src: string): ParseOutcome {
  return run(src, 'chat');
}

/** One job for the parse worker, as the runner posts it. */
export interface MarkdownJob {
  readonly id: number;
  readonly src: string;
  readonly profile: MarkdownProfile;
}

/** The worker's answer to the job with the same `id`. */
export interface MarkdownReply {
  readonly id: number;
  readonly outcome: ParseOutcome;
}

/** Everything the parse worker does with one message (`markdownWorker.ts` is only the wiring), here so tests never
 *  import the worker entry. A message with no finite numeric `id` is dropped: there is nothing to answer to. A
 *  non-string `src`, or a `profile` other than `'chat'` and `'docs'`, answers `threw` `TypeError`. Otherwise the
 *  answer is `parseMarkdown`'s outcome. Both the parse and the post are wrapped: a `post` that throws (a structured
 *  clone's `DataCloneError`) is answered once more with `threw` and the thrown name, and a throw from that second
 *  post is swallowed, so the runner's budget answers the job. */
export function answerMarkdownJob(data: unknown, post: (reply: MarkdownReply) => void): void {
  if (typeof data !== 'object' || data === null) return;
  const job = data as { readonly id?: unknown; readonly src?: unknown; readonly profile?: unknown };
  const id = job.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  const outcome: ParseOutcome =
    typeof job.src === 'string' && (job.profile === 'chat' || job.profile === 'docs')
      ? parseMarkdown(job.src, job.profile)
      : { kind: 'threw', error: 'TypeError' };
  try {
    post({ id, outcome });
  } catch (e) {
    try {
      post({ id, outcome: { kind: 'threw', error: errorName(e) } });
    } catch {
      // Nothing more can be said from here: the runner's budget timer answers this job.
    }
  }
}
```

`errorName` is the file's own private helper (Task 3); the appended text spells neither `postMessage` nor `onmessage` (refinement (w): only the two worker files may).

(b) Create `pwa/src/lib/markdownWorker.ts` with exactly this content:

```ts
// The parse worker's entry (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and runner").
// `markdownRunner.ts` spawns it as a module worker; Vite emits it as its own chunk (`worker: { format: 'es' }`), which
// the service worker precaches with the rest of the shell. It is only the wiring: each message goes to
// `answerMarkdownJob` (`markdownParse.ts`), whose answer is posted back to the runner. Messages are received by
// assigning `onmessage`, never by adding a listener (the W4 plan's refinement (w)).
//
// Its import closure is the parse's own: no React, no DOM, no highlight.js (`markdown-purity.test.ts`). The PWA's
// tsconfig has no WebWorker lib (it conflicts with DOM), so the worker global is typed here by what is used of it.
import { answerMarkdownJob, type MarkdownReply } from './markdownParse';

const worker = self as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(reply: MarkdownReply): void;
};

worker.onmessage = (e) => answerMarkdownJob(e.data, (reply) => worker.postMessage(reply));
```

(c) Create `pwa/src/lib/markdownRunner.ts` with exactly this content:

```ts
// The main-thread side of the parse worker (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker
// and runner"). A runner owns at most one worker and posts it one job at a time; the others wait in a FIFO.
//   - The worker is spawned lazily, by the first job or by `prewarm()`. A spawn that throws (no `Worker` global, a
//     refused script) makes the runner `worker-unavailable` for good: every job, queued or later, answers that at
//     once, and `spawn` is never called again.
//   - A job's budget timer starts when the job is POSTED, never when it is queued, so no job pays for the one ahead
//     of it. When it fires: `terminate()`, the job answers `timeout`, and the next job spawns a fresh worker.
//   - An `error` or `messageerror` event answers the running job `worker-failed` with the event's name, and drops the
//     worker; the next job spawns a fresh one. A `postMessage` that throws does the same, with the thrown name.
//   - A reply whose `id` is not the running job's is ignored, and a dropped worker's handlers are cleared, so
//     nothing it sends afterwards is heard.
//   - An abort removes a queued job, or terminates the worker under a running one (the next job respawns); the
//     caller's promise rejects with the signal's reason, and an already-aborted signal rejects at once. `dispose()`
//     terminates the worker and rejects every pending job with an `AbortError`. So `ParseOutcome` keeps its eight
//     arms and none of them means "nobody is waiting" (the W4 plan's refinement (h)).
// Messages are received by ASSIGNING `onmessage`, never by adding a listener (refinement (w)).
//
// Two module singletons, `docsRunner` and `chatRunner`: a 30 s docs job never delays a chat message. Neither spawns
// anything until it is first used. The worker URL is one literal expression, so Vite's static analysis sees it and
// emits the worker as its own chunk (`markdown-runner.test.ts` pins the text).
import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';

/** The type of `runner.parse`. Resolves with the job's outcome; rejects only on an abort or `dispose()`. */
export type MarkdownParser = (
  src: string,
  opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal },
) => Promise<ParseOutcome>;

/** The part of a `Worker` a runner uses; a test hands in a fake. */
export interface WorkerLike {
  postMessage(job: MarkdownJob): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface MarkdownRunnerDeps {
  /** Starts a worker. A throw means no worker can be had here, for good. */
  spawn: () => WorkerLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface MarkdownRunner {
  readonly parse: MarkdownParser;
  /** Spawns the worker now, when there is none, so the first job does not wait for it to start. */
  prewarm(): void;
  /** Terminates the worker and rejects every pending job with an `AbortError`. A later job spawns again. */
  dispose(): void;
}

/** A module worker over `markdownWorker.ts`. Throws where there is no `Worker` (jsdom, an old browser). */
export function defaultSpawn(): WorkerLike {
  return new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

interface Job {
  readonly id: number;
  readonly src: string;
  readonly profile: MarkdownProfile;
  readonly budgetMs: number;
  /** The caller's signal; absent when the caller gave none. */
  readonly signal?: AbortSignal;
  readonly resolve: (outcome: ParseOutcome) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
}

/** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
function thrownName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

export function createMarkdownRunner(deps: Partial<MarkdownRunnerDeps> = {}): MarkdownRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  /** The live worker; absent before the first spawn and after a drop. */
  let worker: WorkerLike | undefined;
  /** Set by a spawn that threw; never cleared. */
  let unavailable = false;
  let nextId = 1;
  const queue: Job[] = [];
  /** The posted job and its budget timer; absent while no job is posted. */
  let running: { readonly job: Job; readonly timer: unknown } | undefined;

  /** Forgets the live worker: its handlers are cleared, then it is terminated. */
  function drop(): void {
    const w = worker;
    worker = undefined;
    if (w === undefined) return;
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
  }

  /** The live worker, spawned when there is none; absent when no worker can be had. */
  function live(): WorkerLike | undefined {
    if (unavailable) return undefined;
    if (worker !== undefined) return worker;
    let w: WorkerLike;
    try {
      w = spawn();
    } catch {
      unavailable = true;
      return undefined;
    }
    w.onmessage = (e) => {
      const reply = e.data as { readonly id?: unknown; readonly outcome?: ParseOutcome } | null;
      if (typeof reply !== 'object' || reply === null || reply.outcome === undefined) return;
      if (running !== undefined && reply.id === running.job.id) finish(reply.outcome);
    };
    w.onerror = () => fail('error');
    w.onmessageerror = () => fail('messageerror');
    worker = w;
    return w;
  }

  /** The running job answers `outcome`; the next queued job is posted. */
  function finish(outcome: ParseOutcome): void {
    const r = running;
    if (r === undefined) return;
    running = undefined;
    clearTimer(r.timer);
    r.job.signal?.removeEventListener('abort', r.job.onAbort);
    r.job.resolve(outcome);
    pump();
  }

  /** The worker failed: it is dropped, and the running job, if any, answers `worker-failed`. */
  function fail(error: string): void {
    drop();
    finish({ kind: 'worker-failed', error });
  }

  /** The budget of `job` ran out. */
  function expire(job: Job): void {
    if (running?.job !== job) return;
    drop();
    finish({ kind: 'timeout', budgetMs: job.budgetMs });
  }

  /** Posts the next queued job when none is running; with no worker to be had, answers each queued job at once. */
  function pump(): void {
    while (running === undefined) {
      const job = queue.shift();
      if (job === undefined) return;
      const w = live();
      if (w === undefined) {
        job.signal?.removeEventListener('abort', job.onAbort);
        job.resolve({ kind: 'worker-unavailable' });
        continue;
      }
      running = { job, timer: setTimer(() => expire(job), job.budgetMs) };
      try {
        w.postMessage({ id: job.id, src: job.src, profile: job.profile });
      } catch (e) {
        fail(thrownName(e));
      }
    }
  }

  function abort(job: Job): void {
    const reason: unknown = job.signal?.reason;
    if (running?.job === job) {
      clearTimer(running.timer);
      running = undefined;
      drop();
      job.reject(reason);
      pump();
      return;
    }
    const at = queue.indexOf(job);
    if (at !== -1) {
      queue.splice(at, 1);
      job.reject(reason);
    }
  }

  const parse: MarkdownParser = (src, opts) =>
    new Promise<ParseOutcome>((resolve, reject) => {
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = nextId;
      nextId += 1;
      const job: Job = {
        id,
        src,
        profile: opts.profile,
        budgetMs: opts.budgetMs,
        signal,
        resolve,
        reject,
        onAbort: () => abort(job),
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      queue.push(job);
      pump();
    });

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
      pending.unshift(r.job);
    }
    drop();
    for (const job of pending) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(reason);
    }
  }

  return { parse, prewarm, dispose };
}

/** The Docs screen's runner (W5 passes `docsRunner.parse` as its default parser). */
export const docsRunner: MarkdownRunner = createMarkdownRunner();
/** Chat's runner, for messages over `CHAT_SYNC_MAX_BYTES` (Task 6). */
export const chatRunner: MarkdownRunner = createMarkdownRunner();
```

(d) `pwa/vite.config.ts`, the key before `build:` (lines 71-73, a hint). Find:

```ts
  // The built shell lands inside the server package: ccrc-server statically
  // serves dist-pwa/ at / with SPA fallback (server.ts findPwaRoot).
  build: {
```

Replace with:

```ts
  // The Markdown parse worker (src/lib/markdownWorker.ts, spawned by
  // src/lib/markdownRunner.ts) is bundled as an ES module worker.
  worker: { format: 'es' },
  // The built shell lands inside the server package: ccrc-server statically
  // serves dist-pwa/ at / with SPA fallback (server.ts findPwaRoot).
  build: {
```

Check the shape: `wc -l < pwa/src/lib/markdownParse.ts` prints `171`; `wc -l < pwa/vite.config.ts` prints `96`; `wc -l < pwa/test/markdown-purity.test.ts` prints `88`; `grep -c "navigateFallbackDenylist: swDenylist(process.env\['CCRC_SW_DENYLIST'\])," pwa/vite.config.ts` prints `1`; `LC_ALL=C grep -c -P '[^\x09\x0a\x20-\x7e]' pwa/src/lib/markdownRunner.ts pwa/src/lib/markdownWorker.ts pwa/src/lib/markdownParse.ts` prints `0` for each; `grep -lE 'postMessage|onmessage' pwa/src/lib/markdown*` prints exactly `pwa/src/lib/markdownRunner.ts` and `pwa/src/lib/markdownWorker.ts`.

- [ ] **Step 7: Run them to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/markdown-worker.test.ts test/markdown-runner.test.ts test/markdown-purity.test.ts test/markdown-parse.test.ts )`
Expected: `Test Files  4 passed (4)`, `Tests  72 passed (72)` (Step 0's 20 plus 18 + 34), `Type Errors  no errors`. If a runner case fails, the state machine has drifted from section 4.10: stop and ask; never loosen an expected outcome or a clock step.

- [ ] **Step 8: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests`, `contrast.test.ts`'s spawned-gate cases, `session-pickers.test.tsx`, `fleet-screen.test.tsx` and `start-program.test.tsx` are known load flakes: a red in one of them is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (`self` is cast, not typed by a WebWorker lib; `new Worker(...)` and `AbortSignal` come from the DOM lib).

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/sw-denylist.test.ts test/markdown-golden.test.tsx test/message-links.test.tsx test/render-hast.test.tsx )` then `git status --porcelain pwa/test/golden pwa/test/message-links.test.tsx`
Expected: `Test Files  4 passed (4)`, `Tests  258 passed (258)` at planning, `Type Errors  no errors`, then nothing from `git status` (the vite config still consumes the knob on its pinned line; chat does not reach the runner until Task 6).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  119 passed (119)`, `Tests  3852 passed (3852)` at planning (Task 4's 117 files and 3 800 tests, plus this task's 2 files and 52 cases; re-derive the base at Step 0's state if another programme moved it). A red in a load-flaky file is re-run alone: `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts test/fleet-screen.test.tsx test/session-pickers.test.tsx test/start-program.test.tsx )` gives `Tests  491 passed (491)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; none of the new names collides with a scanned one).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the four new files and `vite.config.ts`.

Run: `git add pwa/src/lib/markdownParse.ts pwa/src/lib/markdownRunner.ts pwa/src/lib/markdownWorker.ts pwa/test/markdown-runner.test.ts pwa/test/markdown-worker.test.ts pwa/test/markdown-purity.test.ts pwa/vite.config.ts && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; no fixture names a host, a user or a project).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 9: See the worker chunk once, in a throwaway copy.** Foreground, Bash timeout 600000 ms. Never in the worktree: the probe line below must not reach a commit.

Run: `C=$(mktemp -d) && git archive "$(git write-tree)" | tar -x -C "$C" && ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules" && printf "import './lib/markdownRunner';\n" >> "$C/pwa/src/main.tsx" && ( cd "$C/pwa" && env -u CCRC_SW_DENYLIST npm run build 2>&1 | grep -E 'markdownWorker|precache' ) ; ls "$C/server/dist-pwa/assets/" | grep -c '^markdownWorker-' ; grep -oE 'url:"assets/markdownWorker-[A-Za-z0-9_-]+\.js"' "$C/server/dist-pwa/sw.js" | wc -l ; cat "$C"/server/dist-pwa/assets/markdownWorker-*.js | grep -cE 'from"\./|import\("\./' ; rm -rf "$C"`
Expected: a `../server/dist-pwa/assets/markdownWorker-<hash>.js` line (127.49 kB at planning) and `precache  17 entries (...)` (17 entries, 1676.30 KiB at planning), then `1` (one chunk), `1` (listed once in the precache) and `0` (the ES-module worker imports no other chunk). Without the probe line the build emits no chunk at this task's state (16 entries): nothing imports the runner until Task 6 (decision 7). Task 12 runs the real gate.

- [ ] **Step 10: Commit.**

```bash
git add pwa/src/lib/markdownParse.ts pwa/src/lib/markdownRunner.ts pwa/src/lib/markdownWorker.ts pwa/test/markdown-runner.test.ts pwa/test/markdown-worker.test.ts pwa/test/markdown-purity.test.ts pwa/vite.config.ts
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: the parse worker and its runner (docs W4)" \
  -m "markdownParse.ts gains the worker protocol: MarkdownJob {id, src, profile}, MarkdownReply {id, outcome} and answerMarkdownJob, which drops a message with no finite id, answers threw TypeError for a bad src or profile, and wraps the post, so a DataCloneError answers threw. markdownWorker.ts assigns self.onmessage to it; the purity scan's roots now end at the entry." \
  -m "markdownRunner.ts: createMarkdownRunner({spawn, setTimer, clearTimer}) owns one lazily spawned worker and a FIFO, posts one job at a time with a budget timer from post (timeout: terminate, respawn on the next job, M4.P6), makes a throwing spawn a sticky worker-unavailable (M4.P7), answers error and messageerror with worker-failed and drops the worker (M4.P8), ignores a reply whose id is not the running job's (M4.P11), and rejects an aborted or disposed job with its AbortError. docsRunner and chatRunner are two singletons; the Worker URL is one literal expression, and vite.config.ts bundles the worker as an ES module." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `7`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; no earlier row is re-anchored, because this task re-spells no text a Task 1-4 row anchors on: W4-T5-M25 inserts after the `markdownLimits` import line of `markdownGuard.ts` and W4-T5-M26 after that of `markdownParse.ts`, neither of which a Task 3 row uses, and W4-T5-M28 mutates the budget formula's own text, which no Task 3 row touches):

```json
[
 {
  "id": "W4-T5-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      running = { job, timer: setTimer(() => expire(job), job.budgetMs) };",
  "new": "      running = { job, timer: undefined };",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 6 failed | 28 passed (34) — drop the timer (M4.P6): 'a job that never answers is a timeout exactly at its budget, after one terminate', 'a reply, an error and an abort each cancel the job timer', 'honours each job's own budget: 30 000 ms (Format anyway's) times out at 30 000, not before', 'the next job after a timeout spawns a fresh worker and is answered by it', 'the timer starts when a job is posted, not when it is queued', 'a dropped worker is no longer heard: its late reply and its error reach nobody'"
 },
 {
  "id": "W4-T5-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    if (running?.job !== job) return;\n    drop();\n",
  "new": "    if (running?.job !== job) return;\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 3 failed | 31 passed (34) — drop terminate on timeout: 'a job that never answers is a timeout exactly at its budget, after one terminate', 'the next job after a timeout spawns a fresh worker and is answered by it', 'a dropped worker is no longer heard: its late reply and its error reach nobody'"
 },
 {
  "id": "W4-T5-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "setTimer(() => expire(job), job.budgetMs)",
  "new": "setTimer(() => expire(job), 2000)",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — a fixed budget: 'honours each job's own budget: 30 000 ms (Format anyway's) times out at 30 000, not before'"
 },
 {
  "id": "W4-T5-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "        job.resolve({ kind: 'worker-unavailable' });",
  "new": "        job.resolve({ kind: 'timeout', budgetMs: job.budgetMs });",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 2 failed | 32 passed (34) — fold worker-unavailable into timeout (M4.P7): 'a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried', 'with no Worker global, defaultSpawn throws and a runner with no deps answers worker-unavailable'"
 },
 {
  "id": "W4-T5-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    if (unavailable) return undefined;\n",
  "new": "",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — retry spawn every job: 'a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried'"
 },
 {
  "id": "W4-T5-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "  function fail(error: string): void {\n    drop();\n",
  "new": "  function fail(error: string): void {\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 4 failed | 30 passed (34) — reuse the dead worker after error (M4.P8): 'a postMessage that throws answers worker-failed with the thrown name, and the next job respawns', 'an error while no job runs drops the worker too; the next job respawns', 'error: the event answers worker-failed with its name, terminates, and the next job respawns', 'messageerror: the event answers worker-failed with its name, terminates, and the next job respawns'"
 },
 {
  "id": "W4-T5-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    w.onmessageerror = () => fail('messageerror');",
  "new": "    w.onmessageerror = () => fail('error');",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — report messageerror as error: 'messageerror: the event answers worker-failed with its name, terminates, and the next job respawns'"
 },
 {
  "id": "W4-T5-M8",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      if (running !== undefined && reply.id === running.job.id) finish(reply.outcome);",
  "new": "      if (running !== undefined) finish(reply.outcome);",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 2 failed | 32 passed (34) — drop the id check (M4.P11): 'a reply for an id never posted, or with no outcome, is ignored; the running job's own id answers', 'v1 answering after v2 was posted resolves only v2's promise, with v2's outcome'"
 },
 {
  "id": "W4-T5-M9",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      if (typeof reply !== 'object' || reply === null || reply.outcome === undefined) return;",
  "new": "      if (typeof reply !== 'object' || reply === null) return;",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — accept a reply with no outcome: 'a reply for an id never posted, or with no outcome, is ignored; the running job's own id answers'"
 },
 {
  "id": "W4-T5-M10",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    w.onmessage = null;\n    w.onerror = null;\n    w.onmessageerror = null;\n",
  "new": "",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — keep listening to a dropped worker: 'a dropped worker is no longer heard: its late reply and its error reach nobody'"
 },
 {
  "id": "W4-T5-M11",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      queue.push(job);\n",
  "new": "      queue.push(job);\n      setTimer(() => expire(job), job.budgetMs);\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 5 failed | 29 passed (34) — start the timer at enqueue: 'a reply, an error and an abort each cancel the job timer', 'the timer starts when a job is posted, not when it is queued', 'a spawn that throws answers worker-unavailable at once, never a timeout, and is never retried', 'a postMessage that throws answers worker-failed with the thrown name, and the next job respawns', 'dispose terminates, rejects every pending job with an AbortError, and a later job respawns'"
 },
 {
  "id": "W4-T5-M12",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    running = undefined;\n    clearTimer(r.timer);\n    r.job.signal",
  "new": "    running = undefined;\n    r.job.signal",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 2 failed | 32 passed (34) — leave the timer after a reply: 'a reply, an error and an abort each cancel the job timer', 'a postMessage that throws answers worker-failed with the thrown name, and the next job respawns'"
 },
 {
  "id": "W4-T5-M13",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    while (running === undefined) {",
  "new": "    for (;;) {",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 6 failed | 28 passed (34) — post every job at once (no FIFO): 'v1 answering after v2 was posted resolves only v2's promise, with v2's outcome', 'the timer starts when a job is posted, not when it is queued', 'an abort while queued removes the job: it is never posted, and rejects with the signal's reason', 'an abort while running terminates the worker, rejects, and the next job respawns', 'dispose terminates, rejects every pending job with an AbortError, and a later job respawns', 'posts one job at a time, in order, each with its own id, src and profile'"
 },
 {
  "id": "W4-T5-M14",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "w.postMessage({ id: job.id, src: job.src, profile: job.profile });",
  "new": "w.postMessage({ id: job.id, src: job.src, profile: 'chat' });",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — post a fixed profile: 'posts one job at a time, in order, each with its own id, src and profile'"
 },
 {
  "id": "W4-T5-M15",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      try {\n        w.postMessage({ id: job.id, src: job.src, profile: job.profile });\n      } catch (e) {\n        fail(thrownName(e));\n      }\n",
  "new": "      w.postMessage({ id: job.id, src: job.src, profile: job.profile });\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — an unguarded postMessage: 'a postMessage that throws answers worker-failed with the thrown name, and the next job respawns'"
 },
 {
  "id": "W4-T5-M16",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      queue.splice(at, 1);\n",
  "new": "",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — leave an aborted queued job in the queue: 'an abort while queued removes the job: it is never posted, and rejects with the signal's reason'"
 },
 {
  "id": "W4-T5-M17",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      running = undefined;\n      drop();\n      job.reject(reason);",
  "new": "      running = undefined;\n      job.reject(reason);",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 2 failed | 32 passed (34) — do not respawn after an abort while running: 'v1 answering after v2 was posted resolves only v2's promise, with v2's outcome', 'an abort while running terminates the worker, rejects, and the next job respawns'"
 },
 {
  "id": "W4-T5-M18",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    if (running?.job === job) {\n      clearTimer(running.timer);\n",
  "new": "    if (running?.job === job) {\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — keep the timer after an abort while running: 'a reply, an error and an abort each cancel the job timer'"
 },
 {
  "id": "W4-T5-M19",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "      if (signal?.aborted) {\n        reject(signal.reason);\n        return;\n      }\n",
  "new": "",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — post an already-aborted job: 'an already-aborted signal rejects at once, spawning and posting nothing'"
 },
 {
  "id": "W4-T5-M20",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "  function prewarm(): void {\n    live();\n  }",
  "new": "  function prewarm(): void {\n    drop();\n    live();\n  }",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — prewarm respawns each call: 'prewarm spawns once and is idempotent; the next job uses that worker'"
 },
 {
  "id": "W4-T5-M21",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "    const pending = queue.splice(0);",
  "new": "    const pending: Job[] = [];",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — dispose leaves queued jobs: 'dispose terminates, rejects every pending job with an AbortError, and a later job respawns'"
 },
 {
  "id": "W4-T5-M22",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "export const chatRunner: MarkdownRunner = createMarkdownRunner();",
  "new": "export const chatRunner: MarkdownRunner = docsRunner;",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — share one runner: 'docsRunner and chatRunner are two runners, not one'"
 },
 {
  "id": "W4-T5-M23",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "{ type: 'module' }) as unknown as WorkerLike;",
  "new": "{ type: 'module', name: 'markdown' }) as unknown as WorkerLike;",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — the Worker URL is not the literal: 'markdownRunner.ts spells the worker URL as one literal expression, once'"
 },
 {
  "id": "W4-T5-M24",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownRunner.ts",
  "old": "import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';\n",
  "new": "import type { MarkdownJob, MarkdownProfile, ParseOutcome } from './markdownParse';\n// self.addEventListener('message', handler)\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — a message listener in a lib/markdown file: 'no lib/markdown* file adds a message listener or makes an object URL'"
 },
 {
  "id": "W4-T5-M25",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownGuard.ts",
  "old": "import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from './markdownLimits';\n",
  "new": "import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from './markdownLimits';\n// URL.createObjectURL(blob)\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — an object URL in a lib/markdown file: 'no lib/markdown* file adds a message listener or makes an object URL'"
 },
 {
  "id": "W4-T5-M26",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "import { DOCS_MAX_RENDER_ELEMENTS, MD_MAX_TREE_DEPTH } from './markdownLimits';\n",
  "new": "import { DOCS_MAX_RENDER_ELEMENTS, MD_MAX_TREE_DEPTH } from './markdownLimits';\n// postMessage(reply)\n",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — a post outside the two worker files: 'no other lib/markdown* file posts or receives messages'"
 },
 {
  "id": "W4-T5-M27",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownWorker.ts",
  "old": "worker.onmessage = (e) =>",
  "new": "worker['onmessage'] = (e) =>",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — the worker receives other than by assigning onmessage: 'the two worker files receive by assigning onmessage and send with postMessage('"
 },
 {
  "id": "W4-T5-M28",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownLimits.ts",
  "old": "Math.floor(bytes / 65536)",
  "new": "Math.ceil(bytes / 65536)",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 2 failed | 32 passed (34) — the budget formula rounds up: 'DOCS_PARSE_BUDGET_MS(1024) is 2000', 'DOCS_PARSE_BUDGET_MS(65535) is 2000'"
 },
 {
  "id": "W4-T5-M29",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  try {\n    post({ id, outcome });\n  } catch (e) {\n    try {\n      post({ id, outcome: { kind: 'threw', error: errorName(e) } });\n    } catch {\n      // Nothing more can be said from here: the runner's budget timer answers this job.\n    }\n  }\n",
  "new": "  post({ id, outcome });\n",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 2 failed | 16 passed (18) — answerMarkdownJob without the post guard: 'a post that throws a DataCloneError answers once more, threw DataCloneError, under the same id', 'a post that throws twice is swallowed: the runner's budget answers that job'"
 },
 {
  "id": "W4-T5-M30",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    try {\n      post({ id, outcome: { kind: 'threw', error: errorName(e) } });\n    } catch {\n      // Nothing more can be said from here: the runner's budget timer answers this job.\n    }\n",
  "new": "    post({ id, outcome: { kind: 'threw', error: errorName(e) } });\n",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 1 failed | 17 passed (18) — the second post's throw escapes: 'a post that throws twice is swallowed: the runner's budget answers that job'"
 },
 {
  "id": "W4-T5-M31",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "  if (typeof id !== 'number' || !Number.isFinite(id)) return;",
  "new": "  if (typeof id !== 'number') return;",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 2 failed | 16 passed (18) — a non-finite id is answered: 'a message with a NaN id is dropped: there is no id to answer to', 'a message with an infinite id is dropped: there is no id to answer to'"
 },
 {
  "id": "W4-T5-M32",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    typeof job.src === 'string' && (job.profile === 'chat' || job.profile === 'docs')",
  "new": "    typeof job.src === 'string'",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 3 failed | 15 passed (18) — any profile is parsed: 'a missing profile answers threw TypeError under the job id', 'an inherited name as the profile answers threw TypeError under the job id', 'an unknown profile answers threw TypeError under the job id'"
 },
 {
  "id": "W4-T5-M33",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownParse.ts",
  "old": "    typeof job.src === 'string' && (job.profile === 'chat' || job.profile === 'docs')\n      ? parseMarkdown(job.src, job.profile)",
  "new": "    (job.profile === 'chat' || job.profile === 'docs')\n      ? parseMarkdown(job.src as string, job.profile)",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 3 failed | 15 passed (18) — any src is parsed: 'a missing src answers threw TypeError under the job id', 'a numeric src answers threw TypeError under the job id', 'assigns self.onmessage, which answers each job through self.postMessage'"
 },
 {
  "id": "W4-T5-M34",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownWorker.ts",
  "old": "(reply) => worker.postMessage(reply)",
  "new": "() => undefined",
  "tests": [
   "test/markdown-worker.test.ts"
  ],
  "red": "pwa markdown-worker: 1 failed | 17 passed (18) — the worker entry posts nowhere: 'assigns self.onmessage, which answers each job through self.postMessage'"
 },
 {
  "id": "W4-T5-M35",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdownWorker.ts",
  "old": "import { answerMarkdownJob, type MarkdownReply } from './markdownParse';\n",
  "new": "import { answerMarkdownJob, type MarkdownReply } from './markdownParse';\nimport 'react';\n",
  "tests": [
   "test/markdown-purity.test.ts"
  ],
  "red": "pwa markdown-purity: 1 failed | 6 passed (7) — the worker entry imports react: 'imports nothing outside the closure but unified, the three remark plugins and the hast/mdast types'"
 },
 {
  "id": "W4-T5-M36",
  "pkg": "pwa",
  "file": "pwa/vite.config.ts",
  "old": "  worker: { format: 'es' },\n",
  "new": "",
  "tests": [
   "test/markdown-runner.test.ts"
  ],
  "red": "pwa markdown-runner: 1 failed | 33 passed (34) — drop vite's worker format: 'vite.config.ts bundles the worker as an ES module: worker: { format: 'es' }'"
 }
]
```

---

### Task 6: Chat hardening (U3): useParsedMarkdown, the sync/async ChatMarkdown with the pre-scan and the notes, and the refusal of root- and protocol-relative images

**Model routing:** `sonnet`, effort `high` — one small hook whose every transition (one running, one queued and replaced, the job-number check, the last good tree, the unmount abort) is pinned by a deferred fake parser, and one component split whose two paths must stay byte-identical to today's chat; plus a pure predicate and a sentence table. Every number below was measured on the shared scratch tree at Task 5's state, the mutations in a separate copy.

**Spec rows:** M4.C1 (an assistant `'>'.repeat(4000)` renders `.msg-plain`; mutation: delete the pre-scan), M4.C2 (the runner spy is called for 5 000 B and not for 4 000 B; mutation: always sync), M4.C3 (`![](/api/example/x)` gives no `img[src^="/api"]`, and `message-links.test.tsx`'s `https` image case stays green; mutation: delete the clause), and M4.P7's chat half (with no `Worker`, a 4 KiB message formats on the main thread and a 5 KiB one shows its note). Section 4.12's chat clauses 1-4 under ruling U3 = (b). Refinements (a) (M4.P7's W4 chat half is here; `DocMarkdown`'s in-thread 4 KiB and 5 KiB note is W5's), (g) (`useParsedMarkdown(text, parser, {profile, budgetMs, attempt?})` returns `{outcome, lastGood, pending}`; a changed `budgetMs` or `attempt` parses again), (i) (the sync/async split by `utf8ByteLength`, its render order, `FoldedCard`'s recap through `ChatMarkdown`, no `streaming` prop, the `parser` prop read at call time), (j) (the eight note sentences and their DOM order), (k) (the one image predicate, written to the spec's rule) and (n) (`.msg-plain` sets no colour; `.msg-plain-note` is registered in `INHERITED_GROUNDS`).

**Files:**
- Create: `pwa/src/lib/useParsedMarkdown.ts` — 122 lines: `ParsedMarkdown`, `useParsedMarkdown`. Imports React and types only (`hast`, `./markdownParse`, `./markdownRunner`).
- Create: `pwa/test/use-parsed-markdown.test.tsx` — 176 lines, 9 cases, driven by a deferred fake parser that ignores its signal.
- Create: `pwa/test/chat-hardening.test.tsx` — 308 lines, 48 cases: M4.C1 (3), M4.C2 with M4.P7's chat half (6), `chatPlainNote` (10: the seven kinds, then one case per sentence, nine), M4.C3 (10), `isRefusedChatImageSrc`'s table (19).
- Modify: `pwa/src/lib/markdown.tsx` — seven Find/Replace edits: the header comment (lines 1-6, a hint), the `react-markdown` import (line 7), the `markdownLimits` import (line 27), after `isImageUrl` (line 31), `CHAT_COMPONENTS`' docstring and `a` (lines 164-169), `img` (lines 183-185) and `ChatMarkdown` (lines 193-197). 197 lines become 298.
- Modify: `pwa/src/session/chat.css` — one Find/Replace after `.msg-assist pre code` (line 1076, a hint): a comment and three rules. 2 791 lines become 2 799.
- Modify: `pwa/design/audit.mjs` — one Find/Replace before `'fleet.css .build-line'` in `INHERITED_GROUNDS` (line 750, a hint): the `chat.css .msg-plain-note` entry. 1 347 lines become 1 352.
- Test: the two new files; guards `pwa/test/message-links.test.tsx` (UNMODIFIED, green), `pwa/test/markdown-golden.test.tsx` (no golden file moves), `pwa/test/chat.test.tsx`, `pwa/test/render-hast.test.tsx`, `pwa/test/markdown-runner.test.ts` (its source pins read `lib/markdown*`), `pwa/test/markdown-limits.test.ts` (its declared-once scan reads `pwa/src`), `pwa/test/markdown-purity.test.ts`, `pwa/test/markdown-highlight.test.tsx`, `pwa/test/contrast.test.ts`, `pwa/test/tap-targets.test.tsx`, the whole PWA suite, the PWA `tsc`, `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts` (not edited), `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`.

Every Find block below is quoted from its file as Task 5 left it (Task 5 edits none of the three, so `markdown.tsx` is Task 4's text, and `chat.css` and `audit.mjs` are Task 2's and `BASE`'s) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes, from Task 5 (`pwa/src/lib/markdownRunner.ts`): `type MarkdownParser = (src: string, opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly signal?: AbortSignal }) => Promise<ParseOutcome>` (rejects only on an abort or a `dispose()`); `chatRunner: MarkdownRunner`, whose `parse` is an own writable property (`vi.spyOn(chatRunner, 'parse')`).
- Consumes, from Task 3: `prescanMarkdown(src: string): PrescanResult` and `utf8ByteLength(s: string): number` (`pwa/src/lib/markdownGuard.ts`); `CHAT_SYNC_MAX_BYTES` (4 096), `CHAT_PARSE_BUDGET_MS` (2 000), `MD_MAX_CONTAINER_DEPTH` (32), `MD_MAX_DELIMITER_RUN` (64), `MD_MAX_TREE_DEPTH` (64), `DOCS_MAX_RENDER_ELEMENTS` (20 000) (`pwa/src/lib/markdownLimits.ts`); `type ParseOutcome`, `type MarkdownProfile`, and `parseMarkdown(src, profile?)` in tests only (`pwa/src/lib/markdownParse.ts`).
- Consumes, from Task 4: `renderHast(tree: HastRoot, opts: RenderHastOptions): ReactElement` and `interface RenderHastOptions { readonly components: Components; readonly urlTransform?: UrlTransform }` (`pwa/src/lib/renderHast.tsx`). From Task 2: `CHAT_COMPONENTS`, `isImageUrl`, `openExternal`, `remarkAlerts`. From Task 1: `CHAT_CORPUS` (tests only). From `react-markdown` 10.1.0: `defaultUrlTransform`.
- Produces, `pwa/src/lib/useParsedMarkdown.ts`:
  - `export interface ParsedMarkdown { readonly outcome: ParseOutcome | null; readonly lastGood: HastRoot | null; readonly pending: boolean }` — `outcome` null = nothing has settled yet for any request; `lastGood` null = no tree has settled yet; `pending` = no outcome has settled yet for the CURRENT text, profile, budget and attempt.
  - `export function useParsedMarkdown(text: string, parser: MarkdownParser, opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly attempt?: number }): ParsedMarkdown` — `attempt` absent = 0. `parser` is read when a request is made and is not an effect dependency.
- Produces, in `pwa/src/lib/markdown.tsx`:
  - `export function isRefusedChatImageSrc(src: string | undefined): boolean` — skip leading code units at or below U+0020 (ASCII whitespace and C0 controls), then true iff the next character is `/` or `\`; `undefined` (no source) and `''` are false. THE refusal predicate: `img` and `a`'s auto-embed both call it, and nothing else decides.
  - `export function chatPlainNote(o: Exclude<ParseOutcome, { kind: 'tree' }>): string` — refinement (j)'s sentence for each kind, an exhaustive `switch` (a new kind is a `tsc` error).
  - `export function MsgPlain({ text, note }: { text: string; note?: string }): ReactNode` — `<pre className="msg-plain">{text}</pre>`, then `<p className="msg-plain-note">{note}</p>` when `note` is given (absent = no note line). Task 8's chat-item fallback reuses it.
  - `export function ChatMarkdown({ text, parser }: { text: string; parser?: MarkdownParser }): ReactNode` — `parser` absent = `chatRunner.parse`, read at call time. Module-private: `SyncChatMarkdown`, `AsyncChatMarkdown`, `CHAT_RENDER`, `chatParse`.
- Produces, in `pwa/src/session/chat.css`: `.msg-plain`, `.msg-assist .msg-plain`, `.msg-plain-note`.

**Decisions this task makes (none departs from the spec's text):**
1. **The image predicate is written to the spec's rule, in ONE function.** U3 clause 4 refuses root-relative and protocol-relative sources; `isRefusedChatImageSrc` reads them as a browser's URL parser does (leading whitespace and C0 controls skipped, `\` read as `/`), refinement (k). A path-relative source (`x.png`, `../api/x`, `example.com/x.png`) is kept, and the predicate's table says so in its own "keeps" rows. The operator's open question (chat embeds only absolute `http(s)` URLs?) is not pre-empted: a stricter ruling changes this one function's body and moves the table's path-relative "keeps" rows to "refuses"; neither component, no golden file and no `message-links.test.tsx` case changes (every image they draw is `https`).
2. **Markdown cannot deliver a backslash- or whitespace-led source; the predicate's arms are reached through its table.** `remark-rehype` percent-encodes a URL's characters (measured on react-markdown 10.1.0: `![](\\h.example/x.png)` reaches `img` as `src="%5Ch.example/x.png"`, `![](<TAB//h.example/x.png>)` as `%09//h.example/x.png`, `![](/\h.example/x.png)` as `/%5Ch.example/x.png`). So from chat text only a leading `/` survives to the component; the C0/whitespace skip and the backslash arm are defence for the predicate's own contract, pinned by its table, and the M4.C3 cases pin what the parser actually hands over (the two encoded forms are path-relative and kept, per decision 1).
3. **A refused `img` is chat's ordinary external link with the URL as its text** (`<a href target="_blank" rel="noopener noreferrer">` through `openExternal`, no `msg-img-link` class; the alt text is dropped). A refused auto-embed in `a` falls through to the `a` branch's ordinary link, with its own children. The `a` branch's two existing returns are untouched, so Task 1's anchors on them stay unique.
4. **The hook's one guard against a late answer is the job number.** A result or rejection is applied only while its job is still `jobs.running` (`current()`); unmount clears `running`, aborts its signal and clears `queued`. Clearing `queued` on unmount is measured equivalent (the mutant deleting it is green, 57 of 57, because no job can reach `runNext()` once `running` is cleared) and is kept for the reader, not as a row. A rejection ends its job with nothing applied and starts the queued one; the runner rejects only on an abort or a `dispose()`. `parser` is not an effect dependency, so a caller passing a new function each render does not restart a parse.
5. **`pending` compares the settled request with the current one**, field by field (text, profile, budget, attempt), computed during render; it needs no extra state, and a changed budget or attempt is pending until its own outcome settles.
6. **`ChatMarkdown` is two inner components**, `SyncChatMarkdown` and `AsyncChatMarkdown`, so each calls its hooks unconditionally; crossing 4 096 bytes remounts (refinement (i): no hysteresis, no cache; the one-frame `msg-plain` at the crossing and on a virtualised remount is accepted). `SyncChatMarkdown` keeps the `<Markdown>` line byte-identical, so Task 1's and Task 4's rows anchored on it keep their `old` (decision 10). `AsyncChatMarkdown` renders, in order: the latest settled tree; else, while pending, the last good tree; else, a non-tree outcome for the current text, `MsgPlain` with its note; else `MsgPlain` alone (nothing settled yet, or no tree yet while the current text parses: an older text's note is never shown under a newer text).
7. **CSS specificity.** `.msg-assist pre` (0,1,1) sets `max-height: var(--well-max)` and beats a bare `.msg-plain` (0,1,0), so the reset is spelled `.msg-assist .msg-plain { max-height: none; }` (0,2,0); the wrap rule stays a bare `.msg-plain`, so Task 8's item fallback, outside `.msg-assist`, wraps too. Neither sets a colour: inside `.msg-assist` the plain text sits in the well that rule paints and measures. `.msg-plain-note`'s ground is `.chat`'s `--bg-page` (`chat.css`'s `.chat` rule); an opened recap puts it on `.compaction`'s `--bg-surface`, where `--ink-secondary` measures higher (`tokens.css`: 8.67:1 dark, 7.41:1 light).
8. **StrictMode in the hook test is `renderHook`'s `reactStrictMode: true`.** Measured on `@testing-library/react` 16.3.2 and React 19.2.7: a `wrapper` that renders `<StrictMode>` does not double-invoke the hook's effects; the option does (mount, cleanup, mount).
9. **No `\u` escape in any file this task writes** (an agent's write decodes them into raw characters): the tests build a tab, NUL, US, LF and `é` with `String.fromCharCode`. Step 3 checks the bytes.
10. **Re-anchored rows.** `SyncChatMarkdown`'s `<Markdown>` line is the old `ChatMarkdown` line verbatim, and `CHAT_COMPONENTS`' `a` and `img` keep their existing returns, so W4-T1-M1, W4-T1-M2, W4-T4-M5, W4-T1-M5, W4-T1-M6 and W4-T1-M7 keep their `old` text, each still unique (measured). This task re-emits all six under the same ids with reds re-measured at its state, so Task 12's last-occurrence rule reads them here. Every other Task 1-5 row's `old` is unique at this task's state (measured: 102 ids, 0 not unique).

**Measured while planning** (the shared scratch tree at Task 5's state; the mutations in a separate copy):
1. **Step 0's probe**: with `ChatMarkdown` made to throw on any text over 4 096 UTF-8 bytes, the whole PWA suite printed no `OVER-4096` (`Test Files  119`, `Tests  3852`; at load average 31 the run showed 10 reds in `contrast.test.ts`'s spawned-gate cases and `markdown-highlight.test.tsx`'s two 65 536-character cases, each a 5 s timeout, all green alone). No existing test renders a chat text over 4 096 bytes, so the split changes no existing case.
2. **RED**: hook test `Error: Failed to resolve import "../src/lib/useParsedMarkdown" from "test/use-parsed-markdown.test.tsx". Does the file exist?`, `Tests  no tests`; chat-hardening `Tests  45 failed | 3 passed (48)` (green before the code: 'nesting at the limit still formats', 'an https image still embeds', 'covers the seven kinds'); contrast after the CSS and before the registration `Tests  1 failed | 256 passed (257)`.
3. **GREEN**: hook + chat-hardening `Tests  57 passed (57)` (9 + 48), `Type Errors  no errors`.
4. **Guards**: PWA `tsc` clean; under `CI=1`, use-parsed-markdown + chat-hardening + message-links + golden + chat `Tests  295 passed (295)` (Task 5's 238 for the last three, plus 57) with no golden file moved; contrast + tap-targets `Tests  297 passed (297)` (as at Task 5: the registration adds no case); render-hast + markdown-runner + markdown-limits + markdown-purity + markdown-highlight `Tests  145 passed (145)` (unchanged); the whole PWA suite `Test Files  121 passed (121)`, `Tests  3909 passed (3909)` (Task 5's 119 and 3 852, plus 2 files and 57 cases) at load average 31; `single-definition` + `source-bytes` + `topology-clean` `Tests  580 passed (580)` (the scratch tree has no `origin`, so it ran with `CCRC_HISTORY_BASE` at the scratch base commit); `typecheck-tests` 10 of 12 in the scratch tree, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules`, as at Tasks 1-5, with `pwa/ is clean under tsconfig.json` green.
5. **The worker chunk is now emitted by the real import** (Task 5's decision 7): a build of the staged tree printed `../server/dist-pwa/assets/markdownWorker-<hash>.js  127.49 kB` and `precache  17 entries (1681.47 KiB)`; one chunk, listed once in `sw.js`, one `denylist:[`. Task 12 runs the gate.
6. **Mutations**: 32 rows (26 new, 6 re-emitted), each red in a separate copy (`git archive` of the staged tree, `git init`, `pwa/node_modules` and `server/node_modules` linked in), restored with `git checkout -- <file>` after each; `git status --porcelain` in the copy was empty after every one. One mutant is green and recorded as equivalent (decision 4).

- [ ] **Step 0: Confirm the state, claim the two shared files, and measure that no existing test renders a chat text over 4 096 bytes.** From the worktree root, foreground.

Run: `test -e pwa/src/lib/markdownRunner.ts && test -e pwa/src/lib/renderHast.tsx && test ! -e pwa/src/lib/useParsedMarkdown.ts && test ! -e pwa/test/use-parsed-markdown.test.tsx && test ! -e pwa/test/chat-hardening.test.tsx && git diff --quiet HEAD -- pwa && grep -qF 'export function ChatMarkdown({ text }: { text: string }): ReactNode {' pwa/src/lib/markdown.tsx && grep -qF 'export const chatRunner: MarkdownRunner = createMarkdownRunner();' pwa/src/lib/markdownRunner.ts && ! grep -q 'msg-plain' pwa/src/session/chat.css && ! grep -q 'msg-plain' pwa/design/audit.mjs && echo T6-STATE-OK`
Expected: `T6-STATE-OK` (Task 5 is committed, the tree is clean under `pwa/`, none of this task's files exists, `ChatMarkdown` is Task 2's one-line component, and neither shared file names `msg-plain`). If it does not print, stop and put an ask to the coordinator.

Take the claims on `pwa/src/session/chat.css` and `pwa/design/audit.mjs` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`); both are shared beyond this programme (Task 2 already re-pointed two comments in `chat.css` on this branch), so another run may hold either. A 409 names the holder: mail it through the response's `mailHint` and do not edit the file until that claim ends or the two coordinators confirm a scoped agreement (this task appends one block after `.msg-assist pre code` and one `INHERITED_GROUNDS` entry). `markdown.tsx` is W4's own file (Task 2), so no claim is taken on it.

Run (a throwaway copy; never the worktree, the probe line must not reach a commit): `C=$(mktemp -d) && git archive HEAD | tar -x -C "$C" && ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules" && sed -i "/^export function ChatMarkdown({ text }: { text: string }): ReactNode {\$/a\\  if (new TextEncoder().encode(text).length > 4096) throw new Error('OVER-4096');" "$C/pwa/src/lib/markdown.tsx" && grep -c 'OVER-4096' "$C/pwa/src/lib/markdown.tsx" && ( cd "$C/pwa" && ./node_modules/.bin/vitest run 2>&1 | grep -E 'OVER-4096|Test Files|Tests ' ) ; rm -rf "$C"`
Expected: `1` (the probe is in), then no `OVER-4096` line, then `Test Files  119 passed (119)` and `Tests  3852 passed (3852)` at planning. A red in a load-flaky file (`contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `fleet-screen`, `session-pickers`, `start-program`) that does not print `OVER-4096` is load, not a long chat text; any `OVER-4096` names a test whose message this task moves to the worker path: stop and ask.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/message-links.test.tsx test/markdown-golden.test.tsx test/chat.test.tsx )`
Expected: `Test Files  3 passed (3)`, `Tests  238 passed (238)` at planning (whatever it prints, Step 8's run of these three plus this task's two files must print it plus 57).

- [ ] **Step 1: Write the failing hook test.** Create `pwa/test/use-parsed-markdown.test.tsx` with exactly this content:

```tsx
// `useParsedMarkdown` (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). The hook keeps at most one job running and one queued, the queued one replaced; applies
// a result only while its job is still the hook's running job; keeps the last good tree through any later outcome;
// aborts the running job and drops the queued one on unmount; parses again on a changed budget or attempt; and
// swallows a rejection. Every case drives a deferred fake parser that IGNORES its signal, so a job settles only
// when the test says so, even after the hook has aborted it (a parser that answers late).
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Root as HastRoot } from 'hast';
import type { ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { useParsedMarkdown } from '../src/lib/useParsedMarkdown';

afterEach(cleanup);

interface Call {
  readonly src: string;
  readonly opts: Parameters<MarkdownParser>[1];
  readonly resolve: (o: ParseOutcome) => void;
  readonly reject: (e: unknown) => void;
}

/** A parser whose every call waits for the test: `calls[i].resolve(...)` or `.reject(...)`. */
function deferredParser(): { parser: MarkdownParser; calls: Call[] } {
  const calls: Call[] = [];
  const parser: MarkdownParser = (src, opts) =>
    new Promise<ParseOutcome>((resolve, reject) => {
      calls.push({ src, opts, resolve, reject });
    });
  return { parser, calls };
}

/** A one-paragraph tree whose only text is `label`, so two trees are told apart by identity and by content. */
const treeOf = (label: string): HastRoot => ({
  type: 'root',
  children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: label }] }],
});
const tree = (t: HastRoot): ParseOutcome => ({ kind: 'tree', tree: t, depth: 2 });
const TIMEOUT: ParseOutcome = { kind: 'timeout', budgetMs: 2000 };

interface Props {
  readonly text: string;
  readonly budgetMs?: number;
  readonly attempt?: number;
}

function mount(parser: MarkdownParser, initialProps: Props, strict = false) {
  return renderHook(
    (p: Props) => useParsedMarkdown(p.text, parser, { profile: 'chat', budgetMs: p.budgetMs ?? 2000, attempt: p.attempt }),
    { initialProps, reactStrictMode: strict },
  );
}

/** Settles a call inside `act`, so the hook's state update and the next job's start are flushed. */
async function settle(call: Call | undefined, outcome: ParseOutcome): Promise<void> {
  if (call === undefined) throw new Error('no such call');
  await act(async () => {
    call.resolve(outcome);
  });
}

describe('useParsedMarkdown', () => {
  it('starts one job for the first text, with its profile, budget and a live signal; nothing has settled yet', () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.src).toBe('a');
    expect(calls[0]!.opts.profile).toBe('chat');
    expect(calls[0]!.opts.budgetMs).toBe(2000);
    expect(calls[0]!.opts.signal?.aborted).toBe(false);
    expect(result.current).toEqual({ outcome: null, lastGood: null, pending: true });
  });

  it('a settled tree is the outcome and the last good tree, and nothing is pending', async () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    expect(result.current.outcome).toEqual(tree(a));
    expect(result.current.lastGood).toBe(a);
    expect(result.current.pending).toBe(false);
  });

  it('three changes while one job runs leave one queued, the last: the parser sees 2 calls, not 4', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    rerender({ text: 'abc' });
    rerender({ text: 'abcd' });
    expect(calls.map((c) => c.src)).toEqual(['a']);
    await settle(calls[0], tree(treeOf('a')));
    expect(calls.map((c) => c.src)).toEqual(['a', 'abcd']);
    expect(result.current.pending).toBe(true);
    const abcd = treeOf('abcd');
    await settle(calls[1], tree(abcd));
    expect(calls).toHaveLength(2);
    expect(result.current.lastGood).toBe(abcd);
    expect(result.current.pending).toBe(false);
  });

  it('keeps the last good tree, and the settled outcome, while a newer text parses', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    rerender({ text: 'ab' });
    expect(calls).toHaveLength(2);
    expect(result.current).toEqual({ outcome: tree(a), lastGood: a, pending: true });
  });

  it('reports a non-tree latest outcome while the last good tree stays', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    const a = treeOf('a');
    await settle(calls[0], tree(a));
    rerender({ text: 'ab' });
    await settle(calls[1], TIMEOUT);
    expect(result.current.outcome).toEqual(TIMEOUT);
    expect(result.current.lastGood).toBe(a);
    expect(result.current.pending).toBe(false);
  });

  it('a result for a job the hook no longer runs never overwrites a newer one (StrictMode remount)', async () => {
    const { parser, calls } = deferredParser();
    const { result } = mount(parser, { text: 'a' }, true);
    // StrictMode mounts, unmounts and mounts again: the first job is aborted, the second runs.
    expect(calls.map((c) => c.src)).toEqual(['a', 'a']);
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
    expect(calls[1]!.opts.signal?.aborted).toBe(false);
    const second = treeOf('second');
    await settle(calls[1], tree(second));
    await settle(calls[0], tree(treeOf('first')));
    expect(result.current.outcome).toEqual(tree(second));
    expect(result.current.lastGood).toBe(second);
    expect(calls).toHaveLength(2);
  });

  it('unmount aborts the running job and drops the queued one', async () => {
    const { parser, calls } = deferredParser();
    const { rerender, unmount } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    unmount();
    expect(calls[0]!.opts.signal?.aborted).toBe(true);
    await settle(calls[0], tree(treeOf('a')));
    expect(calls).toHaveLength(1);
  });

  it('the same request again starts nothing; a changed budget parses again, and so does a changed attempt', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    await settle(calls[0], TIMEOUT);
    rerender({ text: 'a' });
    expect(calls).toHaveLength(1);
    expect(result.current.pending).toBe(false);
    rerender({ text: 'a', budgetMs: 30000 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.opts.budgetMs).toBe(30000);
    expect(result.current.pending).toBe(true);
    await settle(calls[1], TIMEOUT);
    expect(result.current.pending).toBe(false);
    rerender({ text: 'a', budgetMs: 30000, attempt: 1 });
    expect(calls).toHaveLength(3);
    expect(result.current.pending).toBe(true);
  });

  it('swallows an AbortError rejection, applies nothing, and runs the queued job next', async () => {
    const { parser, calls } = deferredParser();
    const { result, rerender } = mount(parser, { text: 'a' });
    rerender({ text: 'ab' });
    await act(async () => {
      calls[0]!.reject(new DOMException('disposed', 'AbortError'));
    });
    expect(result.current.outcome).toBeNull();
    expect(calls.map((c) => c.src)).toEqual(['a', 'ab']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/use-parsed-markdown.test.tsx )`
Expected: `FAIL  test/use-parsed-markdown.test.tsx [ test/use-parsed-markdown.test.tsx ]`, `Error: Failed to resolve import "../src/lib/useParsedMarkdown" from "test/use-parsed-markdown.test.tsx". Does the file exist?`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Write the failing chat test.** Create `pwa/test/chat-hardening.test.tsx` with exactly this content:

```tsx
// Chat hardening (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clauses 1-4 under ruling U3
// = (b), section 4.15's M4.C1, M4.C2 and M4.C3, and M4.P7's chat half; the W4 plan's refinements (i), (j) and (k)).
// Every case renders `MessageBubble`, the component chat mounts, except the two pure functions' tables. jsdom has no
// `Worker`, so the real `chatRunner` answers `worker-unavailable`; a case that needs a tree from the worker path
// spies `chatRunner.parse` (ChatMarkdown's default parser reads it at call time) and answers with `parseMarkdown`,
// the function the worker runs. `message-links.test.tsx` runs beside this file, UNMODIFIED.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageBubble } from '../src/session/MessageBubble';
import { CHAT_COMPONENTS, chatPlainNote, isRefusedChatImageSrc } from '../src/lib/markdown';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { chatRunner } from '../src/lib/markdownRunner';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import {
  CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN,
  MD_MAX_TREE_DEPTH,
} from '../src/lib/markdownLimits';
import { CHAT_CORPUS } from './markdownCorpus';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bubble = (text: string, streaming = false) => (
  <MessageBubble id="s" event={{ kind: 'assistant', uuid: 'a1', ts: '2026-07-21T20:00:00Z', text }} streaming={streaming} />
);

/** An assistant message of `text`; `rerender` takes the next text of the same message. */
function assistant(text: string, streaming = false) {
  const r = render(bubble(text, streaming));
  return { ...r, next: (t: string) => r.rerender(bubble(t, streaming)) };
}

/** Spies the chat runner with a parser that never settles: it only counts calls. */
const countChatParses = () =>
  vi.spyOn(chatRunner, 'parse').mockImplementation(() => new Promise<ParseOutcome>(() => undefined));

/** Spies the chat runner with a parser each of whose calls waits for the test. */
function deferChatParses() {
  const calls: { readonly src: string; readonly resolve: (o: ParseOutcome) => void }[] = [];
  vi.spyOn(chatRunner, 'parse').mockImplementation(
    (src) => new Promise<ParseOutcome>((resolve) => {
      calls.push({ src, resolve });
    }),
  );
  return calls;
}

/** Answers call `i` inside `act`: with the outcome given, else with what the worker would answer. */
async function answer(calls: ReturnType<typeof deferChatParses>, i: number, outcome?: ParseOutcome): Promise<void> {
  const call = calls[i];
  if (call === undefined) throw new Error(`no call ${i}`);
  await act(async () => {
    call.resolve(outcome ?? parseMarkdown(call.src));
  });
}

const plainOf = (c: HTMLElement): Element | null => c.querySelector('.msg-assist > pre.msg-plain');
const noteOf = (c: HTMLElement): string | null => c.querySelector('.msg-assist > p.msg-plain-note')?.textContent ?? null;

/** A paragraph of `n` ASCII bytes after `head`. */
const longText = (head: string, n = 5000): string => `${head}\n\n${'a'.repeat(n)}`;

const UNAVAILABLE = 'Shown as plain text: this browser cannot format long messages in the background.';

describe('M4.C1: the pre-scan in front of the synchronous path', () => {
  it("an assistant '>'.repeat(4000) renders .msg-plain with its container-depth note, and never reaches the runner", () => {
    const spy = countChatParses();
    const text = '>'.repeat(4000);
    const { container } = assistant(text);
    const pre = plainOf(container);
    expect(pre?.textContent).toBe(text);
    expect(pre?.nextElementSibling?.className).toBe('msg-plain-note');
    expect(noteOf(container)).toBe(`Shown as plain text: line 1 nests 4000 levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`);
    expect(container.querySelector('blockquote')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a 4 096-run of * renders .msg-plain with its delimiter-run note', () => {
    const text = '*'.repeat(4096);
    const { container } = assistant(text);
    expect(plainOf(container)?.textContent).toBe(text);
    expect(noteOf(container)).toBe(`Shown as plain text: line 1 has a run of 4096 emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`);
  });

  it('nesting at the limit still formats', () => {
    const { container } = assistant(`${'>'.repeat(MD_MAX_CONTAINER_DEPTH)} deep`);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelectorAll('blockquote')).toHaveLength(MD_MAX_CONTAINER_DEPTH);
  });
});

describe('M4.C2: messages over CHAT_SYNC_MAX_BYTES parse through chatRunner', () => {
  it('the runner is called for a 5 000-byte message, with the chat profile and budget, and not for a 4 000-byte one', () => {
    const spy = countChatParses();
    assistant('a'.repeat(4000));
    expect(spy).not.toHaveBeenCalled();
    cleanup();
    const text = 'a'.repeat(5000);
    assistant(text);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(text);
    expect(spy.mock.calls[0]![1]).toMatchObject({ profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });
  });

  it('bytes decide, not characters: 4 096 UTF-8 bytes stay synchronous, 4 097 go to the runner', () => {
    const atLimit = String.fromCharCode(0xe9).repeat(CHAT_SYNC_MAX_BYTES / 2);
    const overLimit = `${atLimit}a`;
    expect([utf8ByteLength(atLimit), atLimit.length]).toEqual([CHAT_SYNC_MAX_BYTES, CHAT_SYNC_MAX_BYTES / 2]);
    expect(utf8ByteLength(overLimit)).toBe(CHAT_SYNC_MAX_BYTES + 1);
    const spy = countChatParses();
    const { container, next } = assistant(atLimit);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.msg-assist > p')?.textContent).toBe(atLimit);
    next(overLimit);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(plainOf(container)?.textContent).toBe(overLimit);
  });

  it('with no Worker, a 5 KiB message shows .msg-plain and the worker-unavailable note (M4.P7, chat half)', async () => {
    expect((globalThis as { Worker?: unknown }).Worker).toBeUndefined();
    const text = longText('# Title');
    const { container } = assistant(text);
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(plainOf(container)?.textContent).toBe(text);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('a tree from the worker path renders the same HTML as the synchronous path would', async () => {
    const text = [...CHAT_CORPUS.map((c) => c.text), '[go](javascript:alert(1))'].join('\n\n');
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const calls = deferChatParses();
    const viaWorker = assistant(text).container;
    await answer(calls, 0);
    expect(plainOf(viaWorker)).toBeNull();
    const sync = render(
      <div className="msg-assist">
        <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>
      </div>,
    ).container;
    expect(viaWorker.querySelector('.msg-assist')!.innerHTML).toBe(sync.querySelector('.msg-assist')!.innerHTML);
    expect(viaWorker.innerHTML).not.toContain('javascript:');
  });

  it('.msg-plain until the first outcome, then the last good tree while newer text parses, then the note', async () => {
    const calls = deferChatParses();
    const first = longText('# First');
    const { container, next } = assistant(first);
    expect(plainOf(container)?.textContent).toBe(first);
    expect(noteOf(container)).toBeNull();
    await answer(calls, 0);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(plainOf(container)).toBeNull();

    const second = `${first}\n\n## Second`;
    next(second);
    expect(calls).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Second' })).toBeNull();
    expect(plainOf(container)).toBeNull();
    await answer(calls, 1);
    expect(screen.getByRole('heading', { name: 'Second' })).toBeTruthy();

    const third = `${second} more`;
    next(third);
    await answer(calls, 2, { kind: 'timeout', budgetMs: CHAT_PARSE_BUDGET_MS });
    expect(plainOf(container)?.textContent).toBe(third);
    expect(noteOf(container)).toBe('Shown as plain text: formatting took longer than 2 s.');
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.queryByText(/format anyway/i)).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('the streaming caret stays after the body on the worker path, before and after the tree', async () => {
    const calls = deferChatParses();
    const { container } = assistant(longText('# Streaming'), true);
    const assist = container.querySelector('.msg-assist')!;
    expect(assist.lastElementChild?.className).toBe('stream-caret');
    expect(assist.lastElementChild?.previousElementSibling?.className).toBe('msg-plain');
    await answer(calls, 0);
    expect(assist.lastElementChild?.className).toBe('stream-caret');
    expect(assist.firstElementChild?.tagName).toBe('H1');
  });
});

describe("chatPlainNote: one sentence per outcome chat does not format (the W4 plan's refinement (j))", () => {
  type NonTree = Exclude<ParseOutcome, { kind: 'tree' }>;
  // Keyed on every kind: a new ParseOutcome arm is a compile error here until it has a sentence.
  const NOTES: { readonly [K in NonTree['kind']]: readonly (readonly [Extract<NonTree, { kind: K }>, string])[] } = {
    refused: [
      [{ kind: 'refused', why: 'container-depth', line: 3, value: 40 },
        `Shown as plain text: line 3 nests 40 levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`],
      [{ kind: 'refused', why: 'delimiter-run', line: 2, value: 65 },
        `Shown as plain text: line 2 has a run of 65 emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`],
    ],
    'too-deep': [[{ kind: 'too-deep', depth: 70 },
      `Shown as plain text: this message nests 70 levels deep (limit ${MD_MAX_TREE_DEPTH}).`]],
    'too-wide': [[{ kind: 'too-wide', elements: 20001 },
      `Shown as plain text: this message would draw 20001 elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`]],
    threw: [[{ kind: 'threw', error: 'RangeError' }, 'Shown as plain text: it could not be formatted (RangeError).']],
    timeout: [
      [{ kind: 'timeout', budgetMs: 2000 }, 'Shown as plain text: formatting took longer than 2 s.'],
      [{ kind: 'timeout', budgetMs: 30000 }, 'Shown as plain text: formatting took longer than 30 s.'],
    ],
    'worker-unavailable': [[{ kind: 'worker-unavailable' }, UNAVAILABLE]],
    'worker-failed': [[{ kind: 'worker-failed', error: 'messageerror' },
      'Shown as plain text: the formatter stopped (messageerror).']],
  };

  it('covers the seven kinds', () => {
    expect(Object.keys(NOTES).sort()).toEqual(
      ['refused', 'threw', 'timeout', 'too-deep', 'too-wide', 'worker-failed', 'worker-unavailable'],
    );
  });

  it.each(Object.values(NOTES).flat().map(([o, s]) => [JSON.stringify(o), o, s] as const))('%s', (_name, o, sentence) => {
    expect(chatPlainNote(o)).toBe(sentence);
  });
});

const TAB = String.fromCharCode(9);

describe('M4.C3: chat refuses a root-relative or protocol-relative image source', () => {
  it('![](/api/example/x) draws no image and renders the URL as a plain link', () => {
    const { container } = assistant('![](/api/example/x)');
    expect(container.querySelector('img[src^="/api"]')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const link = screen.getByRole('link', { name: '/api/example/x' });
    expect(link.getAttribute('href')).toBe('/api/example/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toBe('');
  });

  it.each([
    ['protocol-relative', '![](//h.example/x.png)', '//h.example/x.png'],
    ['slash then backslash', '![](/\\h.example/x.png)', '/%5Ch.example/x.png'],
    ['root-relative with alt text', '![a chart](/x.png)', '/x.png'],
  ])('an image, %s, draws no image: %s', (_name, text, href) => {
    const { container } = assistant(text);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByRole('link', { name: href }).getAttribute('href')).toBe(href);
  });

  it.each([
    ['root-relative', '[x](/files/a.png)', '/files/a.png'],
    ['protocol-relative', '[x](//h.example/a.png)', '//h.example/a.png'],
  ])('a link to an image file, %s, is not auto-embedded: %s', (_name, text, href) => {
    const { container } = assistant(text);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const link = screen.getByRole('link', { name: 'x' });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.className).toBe('');
  });

  it.each([
    ['a backslash', '![](\\\\h.example/x.png)', '%5Ch.example/x.png'],
    ['a leading tab', `![](<${TAB}//h.example/x.png>)`, '%09//h.example/x.png'],
  ])('the parser percent-encodes %s, so the image source is path-relative, never root- or protocol-relative', (_name, text, src) => {
    const { container } = assistant(text);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([src]);
    expect(isRefusedChatImageSrc(src)).toBe(false);
  });

  it('an https image still embeds', () => {
    assistant('![ok](https://example.com/c.png)');
    expect(screen.getByRole('img', { name: 'ok' }).getAttribute('src')).toBe('https://example.com/c.png');
  });

  it('the worker path refuses too', async () => {
    const calls = deferChatParses();
    const { container } = assistant(longText('![](/api/example/x)\n\n![ok](https://example.com/c.png)'));
    await answer(calls, 0);
    expect(plainOf(container)).toBeNull();
    expect(container.querySelector('img[src^="/"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'ok' }).getAttribute('src')).toBe('https://example.com/c.png');
    expect(screen.getByRole('link', { name: '/api/example/x' })).toBeTruthy();
  });
});

describe('isRefusedChatImageSrc: the URL parser\'s own reading of "root-relative or protocol-relative"', () => {
  const NUL = String.fromCharCode(0);
  const US = String.fromCharCode(0x1f);
  const LF = String.fromCharCode(10);
  it.each([
    '/api/example/x', '//h.example/x.png', '\\\\h.example/x.png', '/\\h.example/x.png', '\\/h.example/x.png',
    `${TAB}//h.example/x.png`, ' /api/x', `${NUL}/api/x`, `${US}${LF}//h.example/x`, '/',
  ])('refuses %j', (src) => {
    expect(isRefusedChatImageSrc(src)).toBe(true);
  });

  // Path-relative sources are NOT refused (refinement (k); widening is the operator's open question).
  it.each([
    'https://example.com/c.png', 'http://example.com/c.png', 'mailto:a@example.com', 'example.com/x.png', '../api/x',
    'x.png', '%5Ch.example/x.png', '',
  ])('keeps %j', (src) => {
    expect(isRefusedChatImageSrc(src)).toBe(false);
  });

  it('keeps an absent source', () => {
    expect(isRefusedChatImageSrc(undefined)).toBe(false);
  });
});
```

Check the bytes: `LC_ALL=C grep -c -P '[^\x09\x0a\x20-\x7e]' pwa/test/chat-hardening.test.tsx pwa/test/use-parsed-markdown.test.tsx` prints `0` for each (plain ASCII: no raw tab, NUL or `é` decoded by the write); `grep -c 'fromCharCode' pwa/test/chat-hardening.test.tsx` prints `5`; `grep -cF "'![](\\\\\\\\h.example/x.png)'" pwa/test/chat-hardening.test.tsx` prints `1` (four backslashes in the source, so the Markdown text holds two and the parser one).

- [ ] **Step 4: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/chat-hardening.test.tsx )`
Expected: `Test Files  1 failed (1)`, `Tests  45 failed | 3 passed (48)`. The three that pass before the code are 'nesting at the limit still formats', 'an https image still embeds' and 'covers the seven kinds'; the rest fail because `chatPlainNote` and `isRefusedChatImageSrc` are not exported yet (`TypeError: chatPlainNote is not a function`), no `.msg-plain` exists (`expected undefined to be ...`), the runner is never called (`expected "parse" to be called 1 times, but got 0 times`, `Error: no call 0`), and every refused source still draws an `<img>`.

- [ ] **Step 5: Implement the hook.** Create `pwa/src/lib/useParsedMarkdown.ts` with exactly this content:

```ts
// The async parse hook (native Docs reader, W4 Task 6; design 2026-10-01 section 4.12's chat clause 3, the W4 plan's
// refinements (g) and (i)). Chat's long messages parse through it; W5's DocMarkdown will too. Per hook:
//   - At most one job runs and at most one waits. A new request (a changed text, profile, budget or attempt) starts
//     a job when none runs, and otherwise REPLACES the waiting one, so a message that streams in faster than it
//     parses costs one job per settle, never one per token.
//   - A job's result is applied only while that job is still the hook's running job. Unmount aborts the running
//     job's signal and drops the waiting one, so a parser that answers after that is not heard.
//   - `lastGood` is the last tree that settled, kept through any later outcome, so a caller can show it while a
//     newer text parses.
//   - A rejection ends the job with nothing applied, and the waiting job, if any, runs next. The runner rejects
//     only on an abort (this hook's own, on unmount) or a `dispose()`.
// `parser` is read when a request is made: a new function alone starts nothing.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Root as HastRoot } from 'hast';
import type { MarkdownProfile, ParseOutcome } from './markdownParse';
import type { MarkdownParser } from './markdownRunner';

export interface ParsedMarkdown {
  /** The latest settled outcome, for the current request or an earlier one; null = nothing has settled yet. */
  readonly outcome: ParseOutcome | null;
  /** The last tree that settled; null = no tree has settled yet. */
  readonly lastGood: HastRoot | null;
  /** No outcome has settled yet for the current text, profile, budget and attempt. */
  readonly pending: boolean;
}

interface Request {
  readonly text: string;
  readonly profile: MarkdownProfile;
  readonly budgetMs: number;
  readonly attempt: number;
}

const sameRequest = (a: Request, b: Request): boolean =>
  a.text === b.text && a.profile === b.profile && a.budgetMs === b.budgetMs && a.attempt === b.attempt;

interface Settled {
  readonly outcome: ParseOutcome | null;
  readonly lastGood: HastRoot | null;
  /** The request `outcome` answers; absent until the first outcome settles. */
  readonly answers?: Request;
}

interface Waiting {
  readonly req: Request;
  readonly parser: MarkdownParser;
}

interface Jobs {
  /** Jobs started so far; a job's number tells it apart from every later one. */
  started: number;
  /** The job in flight; absent while none runs. */
  running: { readonly n: number; readonly ctrl: AbortController } | undefined;
  /** The one request waiting behind it; absent when none waits. */
  queued: Waiting | undefined;
}

function start(jobs: Jobs, next: Waiting, setSettled: Dispatch<SetStateAction<Settled>>): void {
  jobs.started += 1;
  const n = jobs.started;
  const ctrl = new AbortController();
  jobs.running = { n, ctrl };
  const { req, parser } = next;
  const current = (): boolean => jobs.running?.n === n;
  const runNext = (): void => {
    jobs.running = undefined;
    const q = jobs.queued;
    jobs.queued = undefined;
    if (q !== undefined) start(jobs, q, setSettled);
  };
  parser(req.text, { profile: req.profile, budgetMs: req.budgetMs, signal: ctrl.signal }).then(
    (outcome) => {
      if (!current()) return;
      setSettled((prev) => ({
        outcome,
        lastGood: outcome.kind === 'tree' ? outcome.tree : prev.lastGood,
        answers: req,
      }));
      runNext();
    },
    () => {
      if (!current()) return;
      runNext();
    },
  );
}

export function useParsedMarkdown(
  text: string,
  parser: MarkdownParser,
  opts: { readonly profile: MarkdownProfile; readonly budgetMs: number; readonly attempt?: number },
): ParsedMarkdown {
  const { profile, budgetMs } = opts;
  const attempt = opts.attempt ?? 0;
  const [settled, setSettled] = useState<Settled>({ outcome: null, lastGood: null });
  const jobs = useRef<Jobs>({ started: 0, running: undefined, queued: undefined });

  useEffect(() => {
    const j = jobs.current;
    return () => {
      const r = j.running;
      j.running = undefined;
      j.queued = undefined;
      r?.ctrl.abort();
    };
  }, []);

  // `parser` is deliberately not a dependency: it is read when a request is made.
  useEffect(() => {
    const next: Waiting = { req: { text, profile, budgetMs, attempt }, parser };
    const j = jobs.current;
    if (j.running !== undefined) {
      j.queued = next;
      return;
    }
    start(j, next, setSettled);
  }, [text, profile, budgetMs, attempt]);

  const current: Request = { text, profile, budgetMs, attempt };
  const pending = settled.answers === undefined || !sameRequest(settled.answers, current);
  return { outcome: settled.outcome, lastGood: settled.lastGood, pending };
}
```

Run: `( cd pwa && ./node_modules/.bin/vitest run test/use-parsed-markdown.test.tsx )`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 6: Harden `ChatMarkdown`.** Seven edits in `pwa/src/lib/markdown.tsx`.

(a) the header comment (lines 1-6, a hint): the comment gains its Task 6 sentence. Find:

```tsx
// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
```

Replace with:

```tsx
// Chat's Markdown renderer, extracted from `session/MessageBubble.tsx` (native Docs reader, W4 Task 2; design
// 2026-10-01 section 4.9) so chat and the Docs screen share one set of components. Moved unchanged: the image
// test, `absolute`, `openExternal`, the highlight.js registration (a module side effect), `LANG_LABEL`,
// `nodeText`, `keystrokeParts`, `CodeBlock`, `TableWrap`, and today's `mdComponents` split into
// `SHARED_COMPONENTS` (code, pre, table) and `CHAT_COMPONENTS` (those plus chat's `a` and `img`). `ChatMarkdown`
// is both of `MessageBubble`'s Markdown sites. `markdown-golden.test.tsx` holds chat's output byte for byte.
// Hardened per ruling U3 (W4 Task 6; section 4.12): a message of at most `CHAT_SYNC_MAX_BYTES` UTF-8 bytes is
// pre-scanned, then rendered as before; a longer one parses in `chatRunner`'s worker; whatever is not formatted
// shows as `MsgPlain` with `chatPlainNote`'s sentence; and `isRefusedChatImageSrc` keeps chat from drawing an
// image whose source is root-relative or protocol-relative (`chat-hardening.test.tsx`).
```

(b) the `react-markdown` import (line 7, a hint): adds `defaultUrlTransform`. Find:

```tsx
import Markdown from 'react-markdown';
```

Replace with:

```tsx
import Markdown, { defaultUrlTransform } from 'react-markdown';
```

(c) the `markdownLimits` import (line 27, a hint): imports the limits the notes and the split use, the guard, the parse types, the runner, `renderHast` and the hook. Find:

```tsx
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from './markdownLimits';
```

Replace with:

```tsx
import {
  CHAT_PARSE_BUDGET_MS, CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_BLOCK_MAX_CHARS,
  MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN, MD_MAX_TREE_DEPTH,
} from './markdownLimits';
import { prescanMarkdown, utf8ByteLength } from './markdownGuard';
import type { ParseOutcome } from './markdownParse';
import { chatRunner, type MarkdownParser } from './markdownRunner';
import { renderHast, type RenderHastOptions } from './renderHast';
import { useParsedMarkdown } from './useParsedMarkdown';
```

(d) `isImageUrl` (line 31, a hint): the one image predicate follows it. Find:

```tsx
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);
```

Replace with:

```tsx
export const isImageUrl = (href: string | undefined): href is string => href !== undefined && IMG_EXT.test(href);

/** Whether chat refuses `src` as an image source: true when it is root-relative or protocol-relative as a browser's
 *  URL parser reads it. Leading ASCII whitespace and C0 controls are skipped, as a browser strips them from an
 *  attribute URL, and a leading backslash counts as a slash, as the parser reads it (`\\h/x` is `//h/x`). A refused
 *  source would be fetched from ccrc's own origin, or from a host the message names, carrying the operator's
 *  cookie. A path-relative source (`x.png`, `../x`) is not refused; absent (`undefined`) is not refused either.
 *  Takes the value after react-markdown's `defaultUrlTransform`. The ONE predicate: `img` and the auto-embed in `a`
 *  both call it. */
export function isRefusedChatImageSrc(src: string | undefined): boolean {
  if (src === undefined) return false;
  let i = 0;
  while (i < src.length && src.charCodeAt(i) <= 0x20) i += 1;
  const lead = src.charAt(i);
  return lead === '/' || lead === '\\';
}
```

(e) `CHAT_COMPONENTS`' docstring and the head of `a` (lines 164-169, a hint): the auto-embed asks the predicate; the `a` branch's two returns below are untouched. Find:

```tsx
/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images. */
export const CHAT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  a({ href, children }) {
    if (isImageUrl(href)) {
```

Replace with:

```tsx
/** Open in the external browser (a bare `<a>` in a standalone PWA would try to
 *  navigate the app itself), and render image URLs inline as tap-to-open images,
 *  except a source `isRefusedChatImageSrc` refuses, which stays a plain link. */
export const CHAT_COMPONENTS: Components = {
  ...SHARED_COMPONENTS,
  a({ href, children }) {
    if (isImageUrl(href) && !isRefusedChatImageSrc(href)) {
```

(f) the head of `img` (lines 183-185, a hint): a refused source returns the plain link before the image. Find:

```tsx
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    return (
```

Replace with:

```tsx
  img({ src, alt }) {
    const href = typeof src === 'string' ? src : undefined;
    if (isRefusedChatImageSrc(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
          {href}
        </a>
      );
    }
    return (
```

(g) `ChatMarkdown` (lines 193-197, a hint), the end of the file: the notes, `MsgPlain`, the two paths and the new `ChatMarkdown`. Find:

```tsx
/** One chat message body (an assistant turn, an opened compaction recap) as Markdown: GFM, then the alert
 *  callouts, through chat's components. The streaming caret is the caller's sibling after it. */
export function ChatMarkdown({ text }: { text: string }): ReactNode {
  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;
}
```

Replace with:

```tsx
/** The one-line note under a message chat shows as plain text: why it was not formatted. Exhaustive over every
 *  outcome but `tree` (a new kind is a compile error here); the limits are interpolated from `markdownLimits.ts`. */
export function chatPlainNote(o: Exclude<ParseOutcome, { kind: 'tree' }>): string {
  switch (o.kind) {
    case 'refused':
      return o.why === 'container-depth'
        ? `Shown as plain text: line ${o.line} nests ${o.value} levels deep (limit ${MD_MAX_CONTAINER_DEPTH}).`
        : `Shown as plain text: line ${o.line} has a run of ${o.value} emphasis marks (limit ${MD_MAX_DELIMITER_RUN}).`;
    case 'too-deep':
      return `Shown as plain text: this message nests ${o.depth} levels deep (limit ${MD_MAX_TREE_DEPTH}).`;
    case 'too-wide':
      return `Shown as plain text: this message would draw ${o.elements} elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`;
    case 'threw':
      return `Shown as plain text: it could not be formatted (${o.error}).`;
    case 'timeout':
      return `Shown as plain text: formatting took longer than ${o.budgetMs / 1000} s.`;
    case 'worker-unavailable':
      return 'Shown as plain text: this browser cannot format long messages in the background.';
    case 'worker-failed':
      return `Shown as plain text: the formatter stopped (${o.error}).`;
  }
}

/** A message shown as plain text: the text verbatim in `<pre className="msg-plain">`, then, when `note` is given,
 *  `<p className="msg-plain-note">`. `note` absent = no note line. */
export function MsgPlain({ text, note }: { text: string; note?: string }): ReactNode {
  return (
    <>
      <pre className="msg-plain">{text}</pre>
      {note !== undefined && <p className="msg-plain-note">{note}</p>}
    </>
  );
}

/** At most `CHAT_SYNC_MAX_BYTES`: the pre-scan, then react-markdown on the main thread, exactly as before. */
function SyncChatMarkdown({ text }: { text: string }): ReactNode {
  const scan = prescanMarkdown(text);
  if (!scan.ok) {
    return <MsgPlain text={text} note={chatPlainNote({ kind: 'refused', why: scan.why, line: scan.line, value: scan.value })} />;
  }
  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;
}

/** How a tree from the worker renders in chat: chat's components and react-markdown's own url transform, so it is
 *  byte-identical to the synchronous path (M4.P10). */
const CHAT_RENDER: RenderHastOptions = { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform };

/** Over `CHAT_SYNC_MAX_BYTES`: the worker. The latest settled tree; else, while the current text parses, the last
 *  good tree; else, after an outcome that is not a tree for the current text, plain text with its note; else
 *  (nothing settled yet, or no tree yet while the current text parses) plain text alone. No Format anyway. */
function AsyncChatMarkdown({ text, parser }: { text: string; parser: MarkdownParser }): ReactNode {
  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });
  if (outcome?.kind === 'tree') return renderHast(outcome.tree, CHAT_RENDER);
  if (pending && lastGood !== null) return renderHast(lastGood, CHAT_RENDER);
  if (outcome !== null && !pending) return <MsgPlain text={text} note={chatPlainNote(outcome)} />;
  return <MsgPlain text={text} />;
}

/** Chat's parser: `chatRunner.parse`, read at call time, so a test spies it with `vi.spyOn(chatRunner, 'parse')`. */
const chatParse: MarkdownParser = (src, opts) => chatRunner.parse(src, opts);

/** One chat message body (an assistant turn, an opened compaction recap) as Markdown: GFM, then the alert
 *  callouts, through chat's components. A text of at most `CHAT_SYNC_MAX_BYTES` UTF-8 bytes renders on the main
 *  thread behind the pre-scan; a longer one parses through `parser` (absent = `chatRunner`'s), with a
 *  `CHAT_PARSE_BUDGET_MS` budget. The two paths are two components, so crossing the threshold remounts. The
 *  streaming caret is the caller's sibling after it. */
export function ChatMarkdown({ text, parser = chatParse }: { text: string; parser?: MarkdownParser }): ReactNode {
  return utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES
    ? <SyncChatMarkdown text={text} />
    : <AsyncChatMarkdown text={text} parser={parser} />;
}
```

Check the shape: `wc -l < pwa/src/lib/markdown.tsx` prints `298`; `grep -c "lead === '/' || lead === '\\\\\\\\';" pwa/src/lib/markdown.tsx` prints `1` (one backslash escaped in the source); `grep -c 'isRefusedChatImageSrc(' pwa/src/lib/markdown.tsx` prints `3` (the declaration and its two callers); `grep -cF '  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;' pwa/src/lib/markdown.tsx` prints `1` (the line Task 1's and Task 4's rows anchor on, unchanged); `grep -cE 'postMessage|onmessage' pwa/src/lib/markdown.tsx` prints `0` (refinement (w)); `LC_ALL=C grep -c -P '[^\x09\x0a\x20-\x7e]' pwa/src/lib/markdown.tsx pwa/src/lib/useParsedMarkdown.ts` prints `0` for each.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/chat-hardening.test.tsx test/use-parsed-markdown.test.tsx )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)`, `Type Errors  no errors`.

- [ ] **Step 7: The plain-text styles, and the contrast census they move.** Two edits, the census run between them.

(a) `pwa/src/session/chat.css`, after `.msg-assist pre code` (line 1076, a hint). Find:

```css
.msg-assist pre code { background: none; border-radius: 0; padding: 0; color: inherit; font: inherit; }
```

Replace with:

```css
.msg-assist pre code { background: none; border-radius: 0; padding: 0; color: inherit; font: inherit; }

/* PLAIN TEXT — a message chat did not format (lib/markdown.tsx's MsgPlain: the pre-scan refused it, or the worker
   path answered something other than a tree). It sits in the .msg-assist pre well above, which paints its ground
   and ink, so no colour here: it only grows to the whole message and wraps instead of scrolling. The note under
   it is one quiet line; its ground is .chat's --bg-page (registered in design/audit.mjs INHERITED_GROUNDS). */
.msg-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.msg-assist .msg-plain { max-height: none; }
.msg-plain-note { color: var(--ink-secondary); font-size: var(--text-xs); }
```

Run: `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  1 failed | 256 passed (257)`: `every stylesheet under src/ is audited > the uncovered census > contains no identities beyond the grandfathered blind spots`, naming `chat.css .msg-plain-note` (a rule that sets a colour, paints no ground and names no painted ancestor is a new uncovered identity; `.msg-plain` and `.msg-assist .msg-plain` set no colour and are not counted).

(b) `pwa/design/audit.mjs`, in `INHERITED_GROUNDS`, before `'fleet.css .build-line'` (line 750, a hint). Find:

```js
  'fleet.css .build-line': {
    under: ['var(--bg-surface)'],
```

Replace with:

```js
  // ── native Docs reader W4, Task 6: chat's plain-text note ─────────────
  'chat.css .msg-plain-note': {
    under: ['var(--bg-page)'],
    why: "the one-line note under a chat message shown as plain text (lib/markdown.tsx's MsgPlain, a <p> after the <pre className=\"msg-plain\">). It is a child of .msg-assist, which paints no background, inside .chat, which paints --bg-page (chat.css's .chat rule), so --bg-page is behind it: the .settings-back reasoning. Its selector names no painted ancestor, so no route could ground it. An opened compaction recap puts the same note on .compaction's --bg-surface, where --ink-secondary measures higher still (tokens.css: 8.67:1 dark, 7.41:1 light); the auditor takes one ground per rule",
  },
  'fleet.css .build-line': {
    under: ['var(--bg-surface)'],
```

Check the shape: `wc -l < pwa/src/session/chat.css` prints `2799`; `wc -l < pwa/design/audit.mjs` prints `1352`; `grep -c 'msg-plain' pwa/src/session/chat.css` prints `3`.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts test/tap-targets.test.tsx )`
Expected: `Test Files  2 passed (2)`, `Tests  297 passed (297)` at planning (as at Step 0's state: the entry is measured by the existing cases, it adds none). `contrast.test.ts`'s spawned-gate cases time out at 5 s on a loaded box: re-run the file alone before calling a red real.

- [ ] **Step 8: Run the task's suites to verify they pass, with chat unchanged.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/use-parsed-markdown.test.tsx test/chat-hardening.test.tsx test/message-links.test.tsx test/markdown-golden.test.tsx test/chat.test.tsx )` then `git status --porcelain pwa/test/golden pwa/test/message-links.test.tsx`
Expected: `Test Files  5 passed (5)`, `Tests  295 passed (295)` at planning (Step 0's 238 plus 57), `Type Errors  no errors`, then nothing from `git status` (`CI=1` makes a missing or different golden file a failure, never a write; `message-links.test.tsx` is untouched and green, its `https` image case being M4.C3's named neighbour). If a golden case fails, the synchronous path has drifted: stop and ask; never update a golden file.

- [ ] **Step 9: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests`, `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `session-pickers.test.tsx`, `fleet-screen.test.tsx` and `start-program.test.tsx` are known load flakes: a red in one of them is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (`chatPlainNote`'s `switch` is exhaustive, and the test's `NOTES` table is keyed on every non-tree kind).

Run: `( cd pwa && ./node_modules/.bin/vitest run test/render-hast.test.tsx test/markdown-runner.test.ts test/markdown-limits.test.ts test/markdown-purity.test.ts test/markdown-highlight.test.tsx )`
Expected: `Test Files  5 passed (5)`, `Tests  145 passed (145)` at planning, unchanged by this task: M4.P5's sync half still renders through `ChatMarkdown` (a 96-byte message), the runner's source pins find no `postMessage` or `onmessage` in `markdown.tsx`, the limits scan finds no second declaration, and the worker closure is unchanged (`markdown.tsx` and `useParsedMarkdown.ts` are main-thread files, outside it).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  121 passed (121)`, `Tests  3909 passed (3909)` at planning (Task 5's 119 files and 3 852 tests, plus this task's 2 files and 57 cases; re-derive the base at Step 0's state if another programme moved it).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; none of the new names collides with a scanned one).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the three new files.

Run: `git add pwa/src/lib/markdown.tsx pwa/src/lib/useParsedMarkdown.ts pwa/src/session/chat.css pwa/design/audit.mjs pwa/test/use-parsed-markdown.test.tsx pwa/test/chat-hardening.test.tsx && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; the fixtures name `example.com`, `h.example` and `s` only).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 10: See the worker chunk emitted by the real import, once, in a throwaway copy.** Foreground, Bash timeout 600000 ms.

Run: `C=$(mktemp -d) && git archive "$(git write-tree)" | tar -x -C "$C" && ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules" && ( cd "$C/pwa" && env -u CCRC_SW_DENYLIST npm run build 2>&1 | grep -E 'markdownWorker|precache' ) ; ls "$C/server/dist-pwa/assets/" | grep -c '^markdownWorker-' ; grep -oE 'url:"assets/markdownWorker-[A-Za-z0-9_-]+\.js"' "$C/server/dist-pwa/sw.js" | wc -l ; grep -o 'denylist:\[' "$C/server/dist-pwa/sw.js" | wc -l ; rm -rf "$C"`
Expected: a `../server/dist-pwa/assets/markdownWorker-<hash>.js` line (127.49 kB at planning) and `precache  17 entries (...)` (1681.47 KiB at planning), then `1`, `1` and `1`. Task 5 needed a probe import to see this chunk; `ChatMarkdown` now imports the runner, so the shipped build carries it. Task 12 runs the gate.

- [ ] **Step 11: Commit.**

```bash
git add pwa/src/lib/markdown.tsx pwa/src/lib/useParsedMarkdown.ts pwa/src/session/chat.css pwa/design/audit.mjs pwa/test/use-parsed-markdown.test.tsx pwa/test/chat-hardening.test.tsx
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: chat hardening per ruling U3 (docs W4)" \
  -m "useParsedMarkdown keeps one parse running and one queued per hook (the queued one replaced), applies a result only while its job is still the running one, keeps the last good tree, aborts on unmount and parses again on a changed budget or attempt." \
  -m "ChatMarkdown splits on utf8ByteLength: at most CHAT_SYNC_MAX_BYTES renders on the main thread behind prescanMarkdown, exactly as before; a longer message parses through chatRunner with a 2 s budget and renders the tree through renderHast with chat's components and defaultUrlTransform. A refusal or any outcome that is not a tree shows MsgPlain with chatPlainNote's sentence; there is no Format anyway in chat. isRefusedChatImageSrc, the one predicate img and the auto-embed in a share, keeps chat from drawing a root-relative or protocol-relative image source and renders the URL as a plain link. chat.css styles .msg-plain and .msg-plain-note; the note is registered in INHERITED_GROUNDS." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `6`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; W4-T1-M1, W4-T1-M2, W4-T4-M5, W4-T1-M5, W4-T1-M6 and W4-T1-M7 RE-ANCHOR the rows of the same ids on this task's `SyncChatMarkdown` and re-spelled `CHAT_COMPONENTS` (their `old` text is unchanged and still unique; decision 10), and Task 12 keeps these, the last occurrence):

```json
[
 {
  "id": "W4-T6-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const scan = prescanMarkdown(text);\n  if (!scan.ok) {\n    return <MsgPlain text={text} note={chatPlainNote({ kind: 'refused', why: scan.why, line: scan.line, value: scan.value })} />;\n  }\n",
  "new": "",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — M4.C1's '>'.repeat(4000) case and the 4 096-run of * case (no .msg-plain, no note)"
 },
 {
  "id": "W4-T6-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES\n",
  "new": "  return true || utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES\n",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 7 failed | 41 passed (48) — the six M4.C2 worker-path cases (the runner spy, bytes not characters, no Worker, parity, last good tree, caret) and 'the worker path refuses too'"
 },
 {
  "id": "W4-T6-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES\n",
  "new": "  return utf8ByteLength(text) < CHAT_SYNC_MAX_BYTES\n",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — 'bytes decide, not characters' (4 096 bytes went to the runner) and 'a 4 096-run of *' (now async: no delimiter-run note)"
 },
 {
  "id": "W4-T6-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return utf8ByteLength(text) <= CHAT_SYNC_MAX_BYTES\n",
  "new": "  return text.length <= CHAT_SYNC_MAX_BYTES\n",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — 'bytes decide, not characters: 4 096 UTF-8 bytes stay synchronous, 4 097 go to the runner'"
 },
 {
  "id": "W4-T6-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "    if (isRefusedChatImageSrc(href)) {\n      return (\n        <a href={href} target=\"_blank\" rel=\"noopener noreferrer\" onClick={(e) => openExternal(e, href)}>\n          {href}\n        </a>\n      );\n    }\n",
  "new": "",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 5 failed | 43 passed (48) — '![](/api/example/x) draws no image ...', the three 'an image, ..., draws no image' cases and 'the worker path refuses too'"
 },
 {
  "id": "W4-T6-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "    if (isImageUrl(href) && !isRefusedChatImageSrc(href)) {",
  "new": "    if (isImageUrl(href)) {",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — both 'a link to an image file, ..., is not auto-embedded' cases"
 },
 {
  "id": "W4-T6-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  while (i < src.length && src.charCodeAt(i) <= 0x20) i += 1;\n",
  "new": "",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 4 failed | 44 passed (48) — the four whitespace- and C0-led refusals in the isRefusedChatImageSrc table (tab, space, NUL, US+LF)"
 },
 {
  "id": "W4-T6-M8",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return lead === '/' || lead === '\\\\';",
  "new": "  return lead === '/';",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — the two backslash-led refusals in the isRefusedChatImageSrc table"
 },
 {
  "id": "W4-T6-M9",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  if (src === undefined) return false;\n",
  "new": "  if (src === undefined) return true;\n",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — 'keeps an absent source'"
 },
 {
  "id": "W4-T6-M10",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });",
  "new": "  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS * 15 });",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — 'the runner is called for a 5 000-byte message, with the chat profile and budget, and not for a 4 000-byte one'"
 },
 {
  "id": "W4-T6-M11",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  if (pending && lastGood !== null) return renderHast(lastGood, CHAT_RENDER);",
  "new": "  if (lastGood !== null) return renderHast(lastGood, CHAT_RENDER);",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — '.msg-plain until the first outcome, then the last good tree while newer text parses, then the note' (the stale tree renders after the timeout)"
 },
 {
  "id": "W4-T6-M12",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  if (outcome !== null && !pending) return <MsgPlain text={text} note={chatPlainNote(outcome)} />;",
  "new": "  if (outcome !== null && !pending) return <MsgPlain text={text} />;",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — 'with no Worker, a 5 KiB message shows .msg-plain and the worker-unavailable note' and '.msg-plain until the first outcome, ...'"
 },
 {
  "id": "W4-T6-M13",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "const CHAT_RENDER: RenderHastOptions = { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform };",
  "new": "const CHAT_RENDER: RenderHastOptions = { components: CHAT_COMPONENTS };",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — 'a tree from the worker path renders the same HTML as the synchronous path would' (the javascript: href survives)"
 },
 {
  "id": "W4-T6-M14",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "nests ${o.value} levels deep (limit ${MD_MAX_CONTAINER_DEPTH})",
  "new": "nests ${o.value} levels deep (limit ${MD_MAX_TREE_DEPTH})",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — M4.C1's '>'.repeat(4000) case and the refused container-depth sentence"
 },
 {
  "id": "W4-T6-M15",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "formatting took longer than ${o.budgetMs / 1000} s.",
  "new": "formatting took longer than ${o.budgetMs} ms.",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 3 failed | 45 passed (48) — '.msg-plain until the first outcome, ...' and both timeout sentences"
 },
 {
  "id": "W4-T6-M16",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "      return 'Shown as plain text: this browser cannot format long messages in the background.';",
  "new": "      return 'Shown as plain text: the formatter stopped (worker-unavailable).';",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 2 failed | 46 passed (48) — 'with no Worker, ...' and the worker-unavailable sentence"
 },
 {
  "id": "W4-T6-M17",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "      {note !== undefined && <p className=\"msg-plain-note\">{note}</p>}\n",
  "new": "",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 4 failed | 44 passed (48) — both M4.C1 cases, 'with no Worker, ...' and '.msg-plain until the first outcome, ...'"
 },
 {
  "id": "W4-T6-M18",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "    if (j.running !== undefined) {\n      j.queued = next;\n      return;\n    }\n",
  "new": "",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 2 failed | 7 passed (9) — 'three changes while one job runs leave one queued, the last: the parser sees 2 calls, not 4' and 'unmount aborts the running job and drops the queued one'"
 },
 {
  "id": "W4-T6-M19",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "      if (!current()) return;\n      setSettled(",
  "new": "      setSettled(",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 1 failed | 8 passed (9) — 'a result for a job the hook no longer runs never overwrites a newer one (StrictMode remount)'"
 },
 {
  "id": "W4-T6-M20",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "        lastGood: outcome.kind === 'tree' ? outcome.tree : prev.lastGood,",
  "new": "        lastGood: outcome.kind === 'tree' ? outcome.tree : null,",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 1 failed | 8 passed (9) — 'reports a non-tree latest outcome while the last good tree stays'"
 },
 {
  "id": "W4-T6-M21",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "      r?.ctrl.abort();\n",
  "new": "",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 2 failed | 7 passed (9) — the StrictMode case (the first job's signal is not aborted) and 'unmount aborts the running job and drops the queued one'"
 },
 {
  "id": "W4-T6-M22",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "  a.text === b.text && a.profile === b.profile && a.budgetMs === b.budgetMs && a.attempt === b.attempt;",
  "new": "  a.text === b.text && a.profile === b.profile;",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 1 failed | 8 passed (9) — 'the same request again starts nothing; a changed budget parses again, and so does a changed attempt' (pending stays false)"
 },
 {
  "id": "W4-T6-M23",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "    () => {\n      if (!current()) return;\n      runNext();\n    },\n",
  "new": "    () => undefined,\n",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 1 failed | 8 passed (9) — 'swallows an AbortError rejection, applies nothing, and runs the queued job next' (the queued job never starts)"
 },
 {
  "id": "W4-T6-M24",
  "pkg": "pwa",
  "file": "pwa/src/lib/useParsedMarkdown.ts",
  "old": "  }, [text, profile, budgetMs, attempt]);",
  "new": "  }, [text, profile]);",
  "tests": [
   "test/use-parsed-markdown.test.tsx"
  ],
  "red": "pwa use-parsed-markdown: 1 failed | 8 passed (9) — 'the same request again starts nothing; a changed budget parses again, and so does a changed attempt' (no second call)"
 },
 {
  "id": "W4-T6-M25",
  "pkg": "pwa",
  "file": "pwa/design/audit.mjs",
  "old": "  // ── native Docs reader W4, Task 6: chat's plain-text note ─────────────\n  'chat.css .msg-plain-note': {\n    under: ['var(--bg-page)'],\n    why: \"the one-line note under a chat message shown as plain text (lib/markdown.tsx's MsgPlain, a <p> after the <pre className=\\\"msg-plain\\\">). It is a child of .msg-assist, which paints no background, inside .chat, which paints --bg-page (chat.css's .chat rule), so --bg-page is behind it: the .settings-back reasoning. Its selector names no painted ancestor, so no route could ground it. An opened compaction recap puts the same note on .compaction's --bg-surface, where --ink-secondary measures higher still (tokens.css: 8.67:1 dark, 7.41:1 light); the auditor takes one ground per rule\",\n  },\n",
  "new": "",
  "tests": [
   "test/contrast.test.ts"
  ],
  "red": "pwa contrast: 1 failed | 256 passed (257) — 'every stylesheet under src/ is audited > the uncovered census > contains no identities beyond the grandfathered blind spots' (chat.css .msg-plain-note is a new uncovered identity)"
 },
 {
  "id": "W4-T6-M26",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'chat', budgetMs: CHAT_PARSE_BUDGET_MS });",
  "new": "  const { outcome, lastGood, pending } = useParsedMarkdown(text, parser, { profile: 'docs', budgetMs: CHAT_PARSE_BUDGET_MS });",
  "tests": [
   "test/chat-hardening.test.tsx"
  ],
  "red": "pwa chat-hardening: 1 failed | 47 passed (48) — 'the runner is called for a 5 000-byte message, with the chat profile and budget, and not for a 4 000-byte one'"
 },
 {
  "id": "W4-T1-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkGfm]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 4 failed | 165 passed (169), Snapshots 4 failed — callouts-all-kinds, callout-nested, callout-emptied-lead, recap-opened (re-measured at Task 6's state; unchanged from Task 2's)"
 },
 {
  "id": "W4-T1-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 6 failed | 163 passed (169), Snapshots 6 failed — gfm-table, gfm-task-list, gfm-strikethrough, gfm-footnote, links, recap-opened (re-measured at Task 6's state)"
 },
 {
  "id": "W4-T4-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS}>{text}</Markdown>;",
  "new": "  return <Markdown remarkPlugins={[remarkGfm, remarkAlerts]} components={CHAT_COMPONENTS} skipHtml>{text}</Markdown>;",
  "tests": [
   "test/render-hast.test.tsx"
  ],
  "red": "pwa render-hast: 1 failed | 71 passed (72) — M4.P5 'through ChatMarkdown (the sync path)' (re-measured at Task 6's state: the 96-byte message stays on SyncChatMarkdown)"
 },
 {
  "id": "W4-T1-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "      <a href={href} target=\"_blank\" rel=\"noopener noreferrer\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "new": "      <a href={href} target=\"_blank\" rel=\"noopener\" onClick={(e) => openExternal(e, href)}>\n        {children}",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 2 failed | 167 passed (169), Snapshots 2 failed — gfm-footnote, links (re-measured at Task 6's state)"
 },
 {
  "id": "W4-T1-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "<img src={src} alt={alt ?? ''} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={src} alt={alt ?? ''} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — images-https (re-measured at Task 6's state)"
 },
 {
  "id": "W4-T1-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/markdown.tsx",
  "old": "<img src={href} alt={name} loading=\"lazy\" className=\"msg-img\" />",
  "new": "<img src={href} alt={name} className=\"msg-img\" />",
  "tests": [
   "test/markdown-golden.test.tsx"
  ],
  "red": "pwa markdown-golden: 1 failed | 168 passed (169), Snapshots 1 failed — links (re-measured at Task 6's state)"
 }
]
```

---

### Task 7: The router's search channel: useLocation, usePath as its wrapper, navigate(href, {replace}); app.tsx reads both and resets the pane on a search change

**Model routing:** `sonnet`, effort `high` — a small hook replaced by its spec'd twin and one optional argument on `navigate`, but every property is a timing property (a re-render on a search-only change, a reset that lands inside `flushSync`, a listener removed on unmount), and two of the seven mutants are invisible to every existing case. Every number below was measured on the shared scratch tree at Task 6's state, the mutations in a separate copy.

**Spec rows:** M4.R1's W4 half (`router-location.test.tsx`: `navigate('/docs/p?ref=a')` then `?ref=b` re-renders a probe on `useLocation()` with the new search; mutation: snapshot only `pathname`) and M4.R3 (`app-pane-reset-timing.test.tsx`: a scrolled pane resets when only the search changes; mutation: dependencies `[path]`). Section 4.2 (`Loc`, `useLocation` verbatim, `usePath` as its wrapper, `navigate(href, {replace})`, the scroll reset on `[path, search]`). Refinements (a) (M4.R1's W5 half, "injected `loaders.tree` called with ref `b`", is W5's; Task 12 records it for W5's brief) and (o) (a replace rides the same view transition and `flushSync` path as a push; an `href` carrying `#` is outside the contract).

**Files:**
- Create: `pwa/test/router-location.test.tsx` — 156 lines, 11 cases: the search channel (5), `usePath` as a wrapper (2), `navigate`'s push and replace (4). Three probe components; no module mock.
- Modify: `pwa/src/lib/router.ts` — three Find/Replace edits: the `react` import (line 3, a hint), `navigate`'s docstring, signature and history call (lines 11-19), and `usePath` (lines 33-42), which becomes `Loc`, `read`, `useLocation` and the one-line `usePath`. 42 lines become 68.
- Modify: `pwa/src/app.tsx` — four Find/Replace edits, each one line or two, in place: the router import (line 18), the `usePath()` call (line 33), the reset comment's two `usePath` lines (lines 99-100) and the layout effect's dependencies (line 113). 163 lines stay 163; nothing else moves (the `docs` arm and `data-view` entry are W5's; the detail boundary is Task 8's).
- Modify: `pwa/test/app-pane-reset-timing.test.tsx` — one Find/Replace at the end of the file (lines 105-113, a hint): M4.R3's describe appended after the existing one, which is untouched. 113 lines become 162.
- Test: `pwa/test/router-location.test.tsx`, `pwa/test/app-pane-reset-timing.test.tsx` (its two existing cases stay green), `pwa/test/app.test.tsx` (unmodified, green); guards: the PWA `tsc`, the whole PWA suite, `server/test/typecheck-tests.test.ts`, `server/test/single-definition.test.ts` (not edited), `server/test/source-bytes.test.ts` and `server/test/topology-clean.test.ts`. No census reads `router.ts` or `app.tsx`'s changed lines (measured: `shell-css.test.ts` reads `app.tsx` for its `useMediaQuery` literal only, and `docs-parity.test.ts`'s declaration scan finds no `DOCS_PAGE_PREFIX` declaration in either file).

Every Find block below is quoted from its file as Task 6 left it (Tasks 1-6 edit none of the three, so each is `BASE`'s text) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes: `flushSync` from `react-dom`; `useEffect`, `useMemo`, `useState` from `react`. Nothing from Tasks 1-6.
- Produces, `pwa/src/lib/router.ts`:
  - `export interface Loc { readonly path: string; readonly search: string }` — `path` is `location.pathname`; `search` is `location.search`, which includes its leading `?`, or is `''` when the URL has no query (one meaning: there is no "absent" search distinct from an empty one, because the URL parser itself has none).
  - `export function useLocation(): Loc` — verbatim from section 4.2: one `raw = pathname + search` string in `useState`, a `popstate` listener added in a mount effect and removed in its cleanup, split at the FIRST `?` in a `useMemo` on `raw` (one object per location).
  - `export function usePath(): string` — `return useLocation().path;` (its one consumer, `app.tsx`, moves to `useLocation` in this task; `usePath` stays exported for any later caller that needs the path alone).
  - `export function navigate(href: string, opts?: { replace?: boolean }): void` — `opts` absent or `replace` absent or `false`: `history.pushState`; `replace: true`: `history.replaceState`. Either then dispatches `popstate` inside `flushSync`, inside the same view-transition wrapper as today. Every existing caller passes one argument and is unchanged.
- Produces, `pwa/src/app.tsx`: `const { path, search } = useLocation();` in `App`, and the detail pane's layout-effect reset on `[path, search]`. Task 8 keys the detail boundary on `path + search` from these two names.

**Decisions this task makes (none departs from the spec's text):**
1. **`useLocation` is section 4.2's code, character for character in its statements**; only docstrings are added. The mechanism stays `useState` + `popstate` (never `useSyncExternalStore`), because `navigate`'s `flushSync`, the view transition and `app-pane-reset-timing.test.tsx` rely on a state update dispatched from a `popstate` listener.
2. **A replace changes the history call and nothing else** (refinement (o)): `go()` picks `replaceState` or `pushState`, then the one `flushSync` dispatch both share. `opts?.replace === true` is the only test, so `{}`, `{ replace: false }` and no argument are all a push, pinned by 'replace: false is a push too'.
3. **M4.R3's third case runs outside `act()`, with `IS_REACT_ACT_ENVIRONMENT` off for its one call.** Measured: with `flushSync` removed from `navigate`, `router-location.test.tsx` and `app.test.tsx` stay green (28 of 28) and so do the timing file's two existing cases, because every one of them wraps `navigate` in `act()` (or reads after `waitFor`), and `act` flushes what `flushSync` would have. A browser has no `act`, so the case does what a browser does: calls `navigate('/runs?x=2', { replace: true })` bare and reads the pane's offset before anything else runs. With `flushSync` it is 0; without it, 900 (the update waits for React's own scheduling). The flag is restored in a `finally`.
4. **The unsubscribe guard is a listener census, not a warning.** React 19 no longer warns on a `setState` after unmount, so "no setState after unmount" is observable only as the listener's removal: the case spies on `window.addEventListener` and `removeEventListener` (a bare `addEventListener(...)` call resolves to `window`'s, measured: jsdom's `window === globalThis`) and asserts the one `popstate` handler added on mount is the one removed on unmount.
5. **Back is jsdom's own traversal.** Measured: jsdom's `history.back()` moves `location` and fires `popstate` asynchronously (one popstate, after a task), so the back cases call `history.back()` and `await waitFor(...)`; they dispatch nothing themselves.
6. **The reset comment in `app.tsx` is edited in place** (two lines, same count): it named `usePath` as the route `popstate` takes, which this task removes from `app.tsx`; it now names `useLocation` and says a change of the search alone is a new page. The rest of the block, its counts included, is untouched.
7. **The M4.R3 cases assert the screen did not remount** (`probe.seen` stays `[0]`, the one mount before the scroll was planted): the reset comes from the effect's dependency, not from a remount that a later keyed boundary (Task 8's `path + search`) would also cause. Task 8's boundary sits inside `.shell-detail` and keys its own subtree, never the pane, so the pane's offset is still the shell's to write and these cases stay meaningful after it.

**Measured while planning** (the shared scratch tree at Task 6's state; the mutations in a separate copy):
1. **RED** (both test edits in, no code): `router-location` `Tests  8 failed | 3 passed (11)` (`TypeError: useLocation is not a function` for the seven cases that call it; 'back after a replace skips the replaced entry' times out at `waitFor`'s 1 000 ms on `'/runs?x=1'`, because the extra argument is ignored and the replace pushes), green before the code: 'a component that reads only usePath() re-renders on a path change', 'a push (no options) adds one history entry ...' and 'replace: false is a push too'; `app-pane-reset-timing` `Tests  3 failed | 2 passed (5)` (`expected 2517 to be +0`, `expected 1200 to be +0`, `expected 900 to be +0`), its two existing cases green.
2. **GREEN**: router-location + app-pane-reset-timing + app `Test Files  3 passed (3)`, `Tests  33 passed (33)` (11 + 5 + 17), `Type Errors  no errors`, no `act(...)` warning on stderr; PWA `tsc` clean.
3. **Guards**: the whole PWA suite `Test Files  122`, `Tests  3923` (Task 6's 121 and 3 909, plus 1 file and 14 cases); at load average 45 it showed 3 reds (2 in `contrast.test.ts`'s spawned-gate cases, 1 in `lifecycle-ui.test.tsx`), all green when re-run alone (`contrast`, `dialog-sheet`, `fleet-screen`, `lifecycle-ui`: `Tests  446 passed (446)`); `single-definition` + `source-bytes` + `topology-clean` `Tests  580 passed (580)` (the scratch tree has no `origin`, so it ran with `CCRC_HISTORY_BASE` at the scratch base commit); `typecheck-tests` 10 of 12, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules`, as at Tasks 1-6, with `pwa/ is clean under tsconfig.json` green.
4. **Mutations**: 7 rows, each red in a separate copy (`git archive` of the staged tree, `git init`, `pwa/node_modules` and `server/node_modules` linked in), restored with `git checkout -- <file>` after each; `git status --porcelain` in the copy was empty after every one. No earlier task's row anchors on `router.ts`, `app.tsx` or `app-pane-reset-timing.test.tsx` (measured over Tasks 1-6's 143 rows), so none is re-anchored.

- [ ] **Step 0: Confirm the state and claim the three shared files.** From the worktree root, foreground.

Run: `test -e pwa/src/lib/useParsedMarkdown.ts && test ! -e pwa/test/router-location.test.tsx && git diff --quiet HEAD -- pwa && grep -qF 'export function navigate(path: string): void {' pwa/src/lib/router.ts && grep -qF 'export function usePath(): string {' pwa/src/lib/router.ts && ! grep -q 'useLocation' pwa/src/lib/router.ts pwa/src/app.tsx && grep -qF '  const path = usePath();' pwa/src/app.tsx && grep -qF '  }, [path]);' pwa/src/app.tsx && echo T7-STATE-OK`
Expected: `T7-STATE-OK` (Task 6 is committed, the tree is clean under `pwa/`, the test file does not exist, and `router.ts` and `app.tsx` are `BASE`'s). If it does not print, stop and put an ask to the coordinator.

Take the claims on `pwa/src/lib/router.ts`, `pwa/src/app.tsx` and `pwa/test/app-pane-reset-timing.test.tsx` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`); all three are shared beyond this programme, so another run may hold any of them. A 409 names the holder: mail it through the response's `mailHint` and do not edit the file until that claim ends or the two coordinators confirm a scoped agreement (this task changes `navigate`'s signature compatibly, replaces `usePath`'s body, edits four lines of `app.tsx` in place and appends one describe to the timing file). Task 8 edits `app.tsx` again; keep that claim until Task 8 commits.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/app-pane-reset-timing.test.tsx test/app.test.tsx )`
Expected: `Test Files  2 passed (2)`, `Tests  19 passed (19)` at planning (2 + 17; whatever it prints, Step 5's run of these two plus the new file must print it plus 14).

- [ ] **Step 1: Write the failing router test.** Create `pwa/test/router-location.test.tsx` with exactly this content:

```tsx
// The router's search channel (native Docs reader, W4 Task 7; design 2026-10-01 section 4.2, row M4.R1's W4 half,
// the W4 plan's refinements (a) and (o)). `useLocation()` re-renders on a change of the search alone, splits at the
// FIRST '?', follows back/forward, and removes its listener on unmount; `usePath()` is its wrapper and still
// re-renders a component that reads nothing else; `navigate(href, {replace: true})` rewrites the current history
// entry instead of adding one. M4.R1's W5 half ("injected `loaders.tree` called with ref `b`") is W5's: this file
// proves the channel on probes, never on a Docs screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { navigate, useLocation, usePath } from '../src/lib/router';
import type { Loc } from '../src/lib/router';

afterEach(() => {
  cleanup();
  navigate('/');
});

/** Records every value `useLocation()` hands a render, in render order. */
function LocProbe({ seen }: { seen: Loc[] }): ReactNode {
  seen.push(useLocation());
  return null;
}

/** Records `usePath()` beside `useLocation().path`, both read in the same render. */
function PairProbe({ seen }: { seen: (readonly [string, string])[] }): ReactNode {
  const viaPath = usePath();
  const viaLocation = useLocation().path;
  seen.push([viaPath, viaLocation]);
  return null;
}

/** Reads ONLY `usePath()`: it re-renders on a path change only if `usePath` subscribes through `useLocation`. */
function PathProbe({ seen }: { seen: string[] }): ReactNode {
  seen.push(usePath());
  return null;
}

/** The last recorded value; a missing one fails here rather than reading as `undefined`. */
function last<T>(xs: readonly T[]): T {
  expect(xs.length, 'the probe rendered at least once').toBeGreaterThan(0);
  return xs[xs.length - 1] as T;
}

describe('useLocation: the search channel (M4.R1, W4 half)', () => {
  it('a change of the search alone re-renders: ?ref=a then ?ref=b, one render each after the first', () => {
    navigate('/');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    act(() => { navigate('/docs/p?ref=a'); });
    act(() => { navigate('/docs/p?ref=b'); });
    expect(seen).toEqual([
      { path: '/', search: '' },
      { path: '/docs/p', search: '?ref=a' },
      { path: '/docs/p', search: '?ref=b' },
    ]);
  });

  it("a path with no '?' has an empty search", () => {
    navigate('/runs');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    expect(last(seen)).toEqual({ path: '/runs', search: '' });
  });

  it("splits at the FIRST '?': a later '?' belongs to the search, as the URL parser reads it", () => {
    navigate('/docs/p?ref=a?b');
    // The platform's own reading, so the case states the parser's answer rather than assuming it.
    expect([location.pathname, location.search]).toEqual(['/docs/p', '?ref=a?b']);
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=a?b' });
  });

  it('back restores the previous search (jsdom fires popstate on the traversal)', async () => {
    navigate('/docs/p?ref=a');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    act(() => { navigate('/docs/p?ref=b'); });
    expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=b' });
    history.back();
    await waitFor(() => expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=a' }));
  });

  it('removes on unmount exactly the popstate listener it added on mount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = render(<LocProbe seen={[]} />);
      const added = add.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(added, 'one listener per mounted hook').toHaveLength(1);
      unmount();
      const removed = remove.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(removed).toEqual(added);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

describe('usePath is a wrapper over useLocation', () => {
  it('usePath() equals useLocation().path in every render, across search and path changes', () => {
    navigate('/runs?x=1');
    const seen: (readonly [string, string])[] = [];
    render(<PairProbe seen={seen} />);
    act(() => { navigate('/runs?x=2'); });
    act(() => { navigate('/mail'); });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const [viaPath, viaLocation] of seen) expect(viaPath).toBe(viaLocation);
    expect(last(seen)).toEqual(['/mail', '/mail']);
  });

  it('a component that reads only usePath() re-renders on a path change', () => {
    navigate('/mail');
    const seen: string[] = [];
    render(<PathProbe seen={seen} />);
    act(() => { navigate('/runs'); });
    expect(last(seen)).toBe('/runs');
  });
});

describe('navigate(href, {replace})', () => {
  it('a push (no options) adds one history entry and moves location', () => {
    navigate('/runs?x=1');
    const before = history.length;
    navigate('/runs?x=2');
    expect(history.length).toBe(before + 1);
    expect(location.pathname + location.search).toBe('/runs?x=2');
  });

  it('replace: false is a push too', () => {
    navigate('/runs?x=1');
    const before = history.length;
    navigate('/runs?x=2', { replace: false });
    expect(history.length).toBe(before + 1);
  });

  it('replace: true rewrites the current entry: history.length unchanged, location moved, the hook re-rendered', () => {
    navigate('/runs?x=1');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    const before = history.length;
    act(() => { navigate('/runs?x=2', { replace: true }); });
    expect(history.length).toBe(before);
    expect(location.pathname + location.search).toBe('/runs?x=2');
    expect(last(seen)).toEqual({ path: '/runs', search: '?x=2' });
  });

  it('back after a replace skips the replaced entry', async () => {
    navigate('/mail');
    navigate('/runs?x=1');
    navigate('/runs?x=2', { replace: true });
    history.back();
    await waitFor(() => expect(location.pathname + location.search).toBe('/mail'));
  });
});
```

- [ ] **Step 2: Append M4.R3 to the timing test.** One edit in `pwa/test/app-pane-reset-timing.test.tsx`, at the end of the file; the existing describe is unchanged.

Edit 1 (the end of the back/forward case and of the file, lines 105-113 at Task 6's state). Find:

```tsx
    navigate('/mail');
    render(<App />);
    track(pane(), 1200);
    act(() => {
      history.pushState(null, '', '/runs');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(probe.seen).toEqual([0]);
  });
});
```

Replace with:

```tsx
    navigate('/mail');
    render(<App />);
    track(pane(), 1200);
    act(() => {
      history.pushState(null, '', '/runs');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(probe.seen).toEqual([0]);
  });
});

// ── M4.R3 (native Docs reader, W4 Task 7): a change of the search alone resets the pane ──
//
// A changed `?ref=` (or any search) on one path is a different page (design 2026-10-01 section 4.2), so app.tsx's
// reset depends on `[path, search]`. RunsScreen does not remount on a search change, so the probe above records only
// its first mount; these cases read the offset the shell WROTE through `track`'s accessor, and the probe's single
// entry says the reset came from the dependency, not from a remount.
describe('a change of the search alone resets the pane too (M4.R3)', () => {
  const offset = (): number => (pane() as HTMLElement).scrollTop;

  it('by navigate', () => {
    navigate('/runs?x=1');
    render(<App />);
    track(pane(), 2517);
    act(() => { navigate('/runs?x=2'); });
    expect(offset()).toBe(0);
    expect(probe.seen, 'the screen stayed mounted: one mount, before the scroll').toEqual([0]);
  });

  it('by back/forward (popstate)', () => {
    navigate('/runs?x=1');
    render(<App />);
    track(pane(), 1200);
    act(() => {
      history.pushState(null, '', '/runs?x=2');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(offset()).toBe(0);
    expect(probe.seen).toEqual([0]);
  });

  it('by a replace, and the reset has landed when navigate returns (outside act, as in a browser)', () => {
    navigate('/runs?x=1');
    render(<App />);
    track(pane(), 900);
    // A browser has no act(): only navigate's flushSync commits the new location, and the layout effect with it,
    // before navigate returns. With the act environment on, React would batch the update until act's end instead.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const was = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      navigate('/runs?x=2', { replace: true });
      expect(offset()).toBe(0);
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = was;
    }
    expect(probe.seen).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run both to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/router-location.test.tsx test/app-pane-reset-timing.test.tsx )`
Expected: `Test Files  2 failed (2)`, `Tests  11 failed | 5 passed (16)`: in `router-location` 8, seven with `TypeError: useLocation is not a function` (the five search-channel cases, 'usePath() equals useLocation().path ...' and 'replace: true rewrites the current entry ...', every case that calls the hook) and 'back after a replace skips the replaced entry' timing out in `waitFor` with `expected '/runs?x=1' to be '/mail'`; in the timing file the three new cases, `expected 2517 to be +0`, `expected 1200 to be +0` and `expected 900 to be +0`. Green before the code, and correctly so: the two existing timing cases, 'a component that reads only usePath() re-renders on a path change' (today's `usePath` subscribes), 'a push (no options) ...' and 'replace: false is a push too' (today's `navigate` pushes and ignores a second argument). Any other failure (an import error, a type error at transform) means the files were not transcribed exactly: fix the transcription, never the expectations.

- [ ] **Step 4: Implement the search channel, then move `app.tsx` onto it.** Three edits in `pwa/src/lib/router.ts`, then four in `pwa/src/app.tsx`.

Edit 1 (`router.ts`, the `react` import, line 3). Find:

```ts
import { useEffect, useState } from 'react';
```

Replace with:

```ts
import { useEffect, useMemo, useState } from 'react';
```

Edit 2 (`router.ts`, `navigate`'s docstring, signature and history call, lines 11-19; the `flushSync` block and the view-transition lines below it are unchanged). Find:

```ts
/** Programmatic navigation for screens/cards: pushState + notify the router.
 *  Route changes ride a view transition when the platform supports it — the
 *  card→chat shared-element morph (the tapped card title carries
 *  `view-transition-name: session-title` into the chat header; timing lives
 *  in base.css on the ::view-transition pseudos). Reduced motion and older
 *  engines get the plain instant swap. */
export function navigate(path: string): void {
  const go = (): void => {
    history.pushState(null, '', path);
```

Replace with:

```ts
/** Programmatic navigation for screens/cards: pushState + notify the router.
 *  Route changes ride a view transition when the platform supports it — the
 *  card→chat shared-element morph (the tapped card title carries
 *  `view-transition-name: session-title` into the chat header; timing lives
 *  in base.css on the ::view-transition pseudos). Reduced motion and older
 *  engines get the plain instant swap.
 *
 *  `href` is a path with an optional search (`/docs/p?ref=b`); a `#` fragment
 *  is outside this contract. `opts.replace: true` rewrites the current history
 *  entry (`replaceState`), so Back skips it; absent or `false` pushes a new
 *  one. Both ride the same view transition and the same `flushSync` dispatch
 *  of `popstate`: only the history call differs. */
export function navigate(href: string, opts?: { replace?: boolean }): void {
  const go = (): void => {
    if (opts?.replace === true) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
```

Edit 3 (`router.ts`, `usePath`, lines 33-42, the end of the file). Find:

```ts
/** Current location.pathname, live across pushState/back/forward. */
export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return path;
}
```

Replace with:

```ts
/** Where the app is. `path` is `location.pathname`; `search` is
 *  `location.search`: it includes its leading `?`, or is `''` when the URL has
 *  no query. */
export interface Loc { readonly path: string; readonly search: string }  // search includes '?', or ''
const read = (): string => location.pathname + location.search;

/** The current path and search, live across push, replace, back and forward
 *  (design 2026-10-01 section 4.2). One string in state, so a change of the
 *  search alone (`?ref=a` to `?ref=b`) re-renders; the memo hands out one
 *  object per location. `useState` + `popstate`, never
 *  `useSyncExternalStore`: `navigate`'s `flushSync` and view-transition
 *  timing, and app-pane-reset-timing.test.tsx, rely on this mechanism. */
export function useLocation(): Loc {
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    const on = (): void => setRaw(read());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return useMemo(() => {
    const q = raw.indexOf('?');          // a pathname cannot contain '?'
    return q < 0 ? { path: raw, search: '' } : { path: raw.slice(0, q), search: raw.slice(q) };
  }, [raw]);
}

/** Current location.pathname, live across push, replace, back and forward:
 *  the path half of `useLocation()`, so a search-only change re-renders its
 *  caller too. */
export function usePath(): string { return useLocation().path; }
```

Edit 4 (`app.tsx`, the router import, line 18; `navigate` stays imported for the re-export below it). Find:

```ts
import { navigate, usePath } from './lib/router';
```

Replace with:

```ts
import { navigate, useLocation } from './lib/router';
```

Edit 5 (`app.tsx`, the first line of `App`, line 33). Find:

```ts
  const path = usePath();
```

Replace with:

```ts
  const { path, search } = useLocation();
```

Edit 6 (`app.tsx`, two lines of the reset comment, lines 99-100, in place). Find:

```ts
  // `popstate` (back/forward) goes through `usePath`, so it is covered by the
  // same dependency.
```

Replace with:

```ts
  // `popstate` (back/forward) goes through `useLocation`, so it is covered by
  // the same dependencies; a change of the search alone is a new page too.
```

Edit 7 (`app.tsx`, the layout effect's dependencies, line 113). Find:

```ts
  }, [path]);
```

Replace with:

```ts
  }, [path, search]);
```

Run: `wc -l pwa/src/lib/router.ts pwa/src/app.tsx pwa/test/app-pane-reset-timing.test.tsx pwa/test/router-location.test.tsx && grep -c 'usePath' pwa/src/app.tsx`
Expected: `68`, `163`, `162` and `156` lines, then `0` (`app.tsx` no longer names `usePath`, so `noUnusedLocals` has nothing to flag).

- [ ] **Step 5: Run the task's suites to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/router-location.test.tsx test/app-pane-reset-timing.test.tsx test/app.test.tsx )`
Expected: `Test Files  3 passed (3)`, `Tests  33 passed (33)` at planning (11 + 5 + 17: Step 0's 19 plus 14), `Type Errors  no errors`, and no `not wrapped in act(...)` warning on stderr.

- [ ] **Step 6: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests`, `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `lifecycle-ui.test.tsx`, `dialog-sheet.test.tsx`, `session-pickers.test.tsx`, `fleet-screen.test.tsx` and `start-program.test.tsx` are known load flakes: a red in one of them is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (every existing one-argument `navigate` call still type-checks; `search` is read by the effect's dependency list).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  122 passed (122)`, `Tests  3923 passed (3923)` at planning (Task 6's 121 files and 3 909 tests, plus this task's 1 file and 14 cases; re-derive the base at Step 0's state if another programme moved it).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; `Loc`, `useLocation` and `read` collide with no scanned name).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the new test file and both edited sources.

Run: `git add pwa/src/lib/router.ts pwa/src/app.tsx pwa/test/router-location.test.tsx pwa/test/app-pane-reset-timing.test.tsx && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; the fixtures name the paths `/`, `/runs`, `/mail` and `/docs/p` and the searches `?x=1`, `?x=2`, `?ref=a`, `?ref=b` only).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 7: Commit.**

```bash
git add pwa/src/lib/router.ts pwa/src/app.tsx pwa/test/router-location.test.tsx pwa/test/app-pane-reset-timing.test.tsx
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: the router's search channel, useLocation and navigate's replace (docs W4)" \
  -m "useLocation keeps pathname plus search in one state string, split at the first ?, so a change of the search alone re-renders; usePath is its path half. navigate takes {replace}: a replace rewrites the current history entry and rides the same view transition and flushSync dispatch as a push." \
  -m "app.tsx reads path and search from useLocation and resets the detail pane's scroll on [path, search], so ?ref=a to ?ref=b on one path lands at the top. router-location.test.tsx pins the channel, the wrapper, the first-? split, the listener's removal and replace's history length; app-pane-reset-timing.test.tsx gains the search-only reset by navigate, by popstate, and by a replace measured outside act." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `4`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; no earlier row is re-anchored):

```json
[
 {
  "id": "W4-T7-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "const read = (): string => location.pathname + location.search;",
  "new": "const read = (): string => location.pathname;",
  "tests": [
   "test/router-location.test.tsx",
   "test/app-pane-reset-timing.test.tsx"
  ],
  "red": "pwa router-location + app-pane-reset-timing: 8 failed | 8 passed (16) — the search channel ('a change of the search alone re-renders ...', 'splits at the FIRST ?', 'back restores the previous search', 'usePath() equals useLocation().path ...', 'replace: true rewrites the current entry ...') and all three M4.R3 cases"
 },
 {
  "id": "W4-T7-M2",
  "pkg": "pwa",
  "file": "pwa/src/app.tsx",
  "old": "  }, [path, search]);\n",
  "new": "  }, [path]);\n",
  "tests": [
   "test/app-pane-reset-timing.test.tsx",
   "test/app.test.tsx"
  ],
  "red": "pwa app-pane-reset-timing + app: 3 failed | 19 passed (22) — the three M4.R3 cases ('by navigate', 'by back/forward (popstate)', 'by a replace, ...'); app.test.tsx's 17 stay green, so this row is the timing file's alone"
 },
 {
  "id": "W4-T7-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "    if (opts?.replace === true) history.replaceState(null, '', href);",
  "new": "    if (opts?.replace === true) history.pushState(null, '', href);",
  "tests": [
   "test/router-location.test.tsx"
  ],
  "red": "pwa router-location: 2 failed | 9 passed (11) — 'replace: true rewrites the current entry: history.length unchanged, ...' and 'back after a replace skips the replaced entry'"
 },
 {
  "id": "W4-T7-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "    flushSync(() => {\n      dispatchEvent(new PopStateEvent('popstate'));\n    });\n",
  "new": "    dispatchEvent(new PopStateEvent('popstate'));\n",
  "tests": [
   "test/app-pane-reset-timing.test.tsx"
  ],
  "red": "pwa app-pane-reset-timing: 1 failed | 4 passed (5) — 'by a replace, and the reset has landed when navigate returns (outside act, as in a browser)' (900, not 0); router-location and app.test.tsx stay green under this mutant (28 of 28), because act() flushes what flushSync would have"
 },
 {
  "id": "W4-T7-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "export function usePath(): string { return useLocation().path; }",
  "new": "export function usePath(): string { return location.pathname; }",
  "tests": [
   "test/router-location.test.tsx"
  ],
  "red": "pwa router-location: 1 failed | 10 passed (11) — 'a component that reads only usePath() re-renders on a path change' (it stays at /mail)"
 },
 {
  "id": "W4-T7-M6",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "    const q = raw.indexOf('?');          // a pathname cannot contain '?'",
  "new": "    const q = raw.lastIndexOf('?');          // a pathname cannot contain '?'",
  "tests": [
   "test/router-location.test.tsx"
  ],
  "red": "pwa router-location: 1 failed | 10 passed (11) — 'splits at the FIRST ?: a later ? belongs to the search, as the URL parser reads it'"
 },
 {
  "id": "W4-T7-M7",
  "pkg": "pwa",
  "file": "pwa/src/lib/router.ts",
  "old": "    return () => removeEventListener('popstate', on);\n",
  "new": "",
  "tests": [
   "test/router-location.test.tsx"
  ],
  "red": "pwa router-location: 1 failed | 10 passed (11) — 'removes on unmount exactly the popstate listener it added on mount' (removed is [])"
 }
]
```

---

### Task 8: RenderBoundary at the root, the detail ladder and each chat item, with its fallbacks, styles and tap targets

**Model routing:** `sonnet`, effort `high` — one small class and three mounts, but each mount's value is WHERE it sits and WHAT it is keyed by (inside `.shell-detail`, `path + search`; per item, the message text), and four of the twelve mutants are invisible to a test that only checks "a fallback appears". Every number below was measured on the shared scratch tree at Task 7's state, the mutations in a separate copy.

**Spec rows:** M4.B1's W4 half (`app-detail-boundary.test.tsx`: a mocked throwing `RunsScreen` at `/runs` keeps `.shell-nav` with "This screen could not be shown." and a navigation resets it; mutation: remove it), M4.B3 (`chat-item-boundary.test.tsx`: the middle of three messages throws, items 1 and 3 render, item 2 shows its raw text; mutation: remove it) and M4.B4 (`root-boundary.test.tsx`: `App` throwing shows Reload, through `main.tsx` itself; mutation: remove it). Section 4.12 (the class, its three W4 mounts, their keys and fallbacks; it fixes section 0's defect 3) and section 4.14's tap-target clause for the two new buttons. Refinements (a) (M4.B1's W5 half, "a mocked throwing `DocsScreen` at `/docs`", is W5's; Task 12 records it for W5's brief), (j) (the item boundary's message note and the pre-then-note order), (m) (the props, the state, the two exported fallbacks, the mount inside `.shell-detail`, M4.B4 through `main.tsx`) and (n) (`.render-fallback` in `styles/shell.css` beside `.block-screen`, self-grounded; the buttons are `.btn-primary`; `tap-targets.test.tsx` gains both halves).

**Files:**
- Create: `pwa/src/components/RenderBoundary.tsx` — 92 lines: `RenderBoundaryProps`, the `RenderBoundary` class, `RootFallback`, `ScreenFallback`.
- Create: `pwa/test/render-boundary.test.tsx` — 145 lines, 11 cases: the fallback and the log line (6), `resetKey` (3), the two screen fallbacks (2). No module mock.
- Create: `pwa/test/root-boundary.test.tsx` — 62 lines, 2 cases (M4.B4): plants `#root`, mocks `virtual:pwa-register` and `../src/app`, imports `../src/main`.
- Create: `pwa/test/app-detail-boundary.test.tsx` — 108 lines, 6 cases (M4.B1's W4 half): a mocked `RunsScreen` that throws while a hoisted flag is on.
- Create: `pwa/test/chat-item-boundary.test.tsx` — 120 lines, 4 cases (M4.B3): `MessageBubble` real except for a marked text, `ToolCard` always throwing.
- Modify: `pwa/src/main.tsx` — two Find/Replace edits: one import after `./app`'s (line 5, a hint) and the render call (lines 13-17). 47 lines become 54.
- Modify: `pwa/src/app.tsx` — three Find/Replace edits: one import after `LoginScreen`'s (line 14), the ladder moved into `const ladder` between the pane-reset effect and `return (` (lines 113-114), and the detail section (lines 135-158), whose ternary becomes `<RenderBoundary ...>{ladder}</RenderBoundary>`. 163 lines become 172.
- Modify: `pwa/src/session/ChatList.tsx` — three Find/Replace edits: two imports after `toast`'s (line 14), `function ChatItemView({` renamed `ChatItemBody` (line 395; its body is unchanged), and the new `ChatItemView` wrapper plus `ITEM_MESSAGE_NOTE` after the switch's end (lines 426-429). 539 lines become 564. `ChatListInner` and `ChatList` still call `ChatItemView` with the same props, unedited.
- Modify: `pwa/src/styles/shell.css` — one Find/Replace edit after `.block-screen .btn-primary` (lines 286-289): `.render-fallback`, `.render-fallback--root`, `.render-fallback-copy`, `.render-fallback .btn-primary`. 351 lines become 385. No new stylesheet (`contrast.test.ts` pins the sheet list).
- Modify: `pwa/test/tap-targets.test.tsx` — two Find/Replace edits: one import after `ReapSheet`'s (line 37) and one describe appended at the end (lines 490-492). 492 lines become 523.
- Test: the four new files and `pwa/test/tap-targets.test.tsx`; guards: the PWA `tsc`, `contrast.test.ts` (no new census identity: `.render-fallback` sets `--ink-primary` on `--bg-page`, the pair `.block-screen` already ships, so it is self-grounded and needs no `INHERITED_GROUNDS` entry; the copy, the root variant and the button override set no colour), `shell-css.test.ts`, `chat.test.tsx`, `app.test.tsx`, `app-pane-reset-timing.test.tsx`, `message-links.test.tsx` (unmodified) and `markdown-golden.test.tsx` (no golden file moves), the whole PWA suite, `server/test/single-definition.test.ts` (not edited), `typecheck-tests`, `source-bytes` and `topology-clean`.

Every Find block below is quoted from its file as Task 7 left it (Tasks 1-7 edit none of `main.tsx`, `ChatList.tsx`, `shell.css` or `tap-targets.test.tsx`, so those are `BASE`'s text; `app.tsx` is Task 7's) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes: `Component` and `type ReactNode` from `react`; from Task 7, `navigate(href: string, opts?: { replace?: boolean }): void` (`pwa/src/lib/router.ts`) and the `path` and `search` names `App` reads from `useLocation()` (`pwa/src/app.tsx`); from Task 6, `MsgPlain({ text, note }: { text: string; note?: string }): ReactNode` (`pwa/src/lib/markdown.tsx`: `<pre className="msg-plain">{text}</pre>`, then `<p className="msg-plain-note">{note}</p>` when `note` is given) and the `.msg-plain-note` rule already registered in `design/audit.mjs`'s `INHERITED_GROUNDS` on `--bg-page`. Tests only: `raiseAuthLost`, `clearAuthLost` (`pwa/src/lib/auth.ts`), `toast` (`pwa/src/components/Toast.tsx`), `useFleetStore` (`pwa/src/stores/fleet.ts`), `ChatListInner` (`pwa/src/session/ChatList.tsx`), `declValue`, `ruleIn` (`pwa/test/cssRule.ts`).
- Produces, `pwa/src/components/RenderBoundary.tsx` (module side effects: `import './primitives.css'` and `import '../styles/shell.css'`, so the root fallback, which replaces the whole app, never depends on another module having loaded them):
  - `export interface RenderBoundaryProps { readonly where: string; readonly resetKey: string | number; readonly fallback: (error: unknown) => ReactNode; readonly children?: ReactNode }` — `where` names the mount in the log line (`'root'`, `'detail'`, `'chat item'`); `resetKey` compared with `===`; `children` absent renders nothing.
  - `export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState>` — module-private `interface RenderBoundaryState { readonly failed: boolean; readonly error: unknown; readonly key: string | number }`; a declared field `state` initialised from `this.props.resetKey` (no constructor, no parameter properties: `erasableSyntaxOnly`); `static getDerivedStateFromError(error: unknown): Partial<RenderBoundaryState>` (`{failed: true, error}`); `static getDerivedStateFromProps(props: RenderBoundaryProps, state: RenderBoundaryState): Partial<RenderBoundaryState> | null` (`null` = the key is unchanged, nothing to derive; a changed key returns `{failed: false, error: undefined, key}`); `componentDidCatch(error: unknown): void` (`console.warn('ccrc: render error in ' + this.props.where, error)`); `render()` draws `fallback(error)` while `failed`, else `children`. `failed` is the one test: `error` may itself be `undefined` or `null` when that is what was thrown (no overloaded null).
  - `export function RootFallback({ reload = () => location.reload() }: { reload?: () => void }): ReactNode` — `<div className="render-fallback render-fallback--root" role="alert">` with "ccrc could not draw this screen." and a `.btn-primary` Reload button; `reload` absent = reload the page.
  - `export function ScreenFallback(): ReactNode` — `<div className="render-fallback" role="alert">` with "This screen could not be shown." and a `.btn-primary` "Back to the fleet" button calling `navigate('/')`.
- Produces, `pwa/src/main.tsx`: `<StrictMode><RenderBoundary where="root" resetKey="root" fallback={() => <RootFallback />}><App /></RenderBoundary></StrictMode>`.
- Produces, `pwa/src/app.tsx`: `const ladder = <the route ternary, unchanged>;` and `<section className="shell-detail" ref={detail}><RenderBoundary where="detail" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary></section>`. W5 adds its `docs` arm to the `ladder` ternary, inside the boundary.
- Produces, `pwa/src/session/ChatList.tsx` (all module-private): `function ChatItemBody(...)` (the old `ChatItemView`, unchanged), `const ITEM_MESSAGE_NOTE = 'This message could not render; shown as plain text.'`, and `function ChatItemView(props: Parameters<typeof ChatItemBody>[0]): ReactNode` — `<RenderBoundary where="chat item" resetKey={item.kind === 'message' ? item.event.text : item.key} fallback={...}>`, the fallback `<MsgPlain text={item.event.text} note={ITEM_MESSAGE_NOTE} />` for a message and `<p className="msg-plain-note">This item could not be shown.</p>` for any other kind.
- Produces, `pwa/src/styles/shell.css`: `.render-fallback` (layout, `background: var(--bg-page)`, `color: var(--ink-primary)`), `.render-fallback--root` (`position: fixed; inset: 0`), `.render-fallback-copy` (no colour), `.render-fallback .btn-primary` (`width: auto; min-width: 180px`, no height).

**Decisions this task makes (none departs from the spec's text):**
1. **The ladder moves into `const ladder`, and the boundary wraps it on one line inside `.shell-detail`.** The ternary's text is unchanged (re-indented only); it is rendered where it was, inside the persistent section, so the pane-reset comment's "the ternary below is inside it" still holds. One line is what lets the mutation table say "remove the boundary" (`{ladder}` alone) and "move it outside `.shell-detail`" each as one replacement.
2. **The reset key is a prop, never a React `key`.** `getDerivedStateFromProps` clears `failed` on a new `resetKey`; nothing remounts. So Task 7's M4.R3 cases (which assert the screen did not remount, `probe.seen` stays `[0]`) and the pane reset stay the shell's (measured: `app-pane-reset-timing` 5 of 5 and Task 7's W4-T7-M2 still red at this task's state).
3. **The fallback is asserted INSIDE `.shell-detail`, not merely beside `.shell-nav`.** A boundary moved to wrap the section keeps `.shell-nav` and still shows the sentence; only "the fallback's ancestor is `.shell-detail`" goes red for it (W4-T8-M3). A boundary around the whole shell would fail the same case and the `.shell-nav` assertion beside it.
4. **M4.B4 runs `main.tsx` itself** (refinement (m)): `vi.mock('virtual:pwa-register')` keeps the service-worker registration inert, `vi.mock('../src/app')` supplies the throwing `App`, the file plants `#root` and imports `../src/main` inside `act`. Without the boundary React rethrows the App's error out of `act`; `beforeAll` keeps that throw (`importThrew`) so each case fails on its own assertion rather than the file failing in its setup with both cases skipped (measured: the first draft's mutant read `Tests  2 skipped (2)`).
5. **The chat item key is the message TEXT for a message and the item key otherwise** (section 4.12). A message item is already keyed by its uuid one level up (`ChatListInner`'s `<div key={item.key}>`), so the text key adds exactly one behaviour: a message that threw is tried again when its text changes (the next streaming chunk, or an edit). Pinned by 'a new text for the failed item resets it' (W4-T8-M6).
6. **The non-message fallback reuses `.msg-plain-note`**, which Task 6 registered in `INHERITED_GROUNDS` on `--bg-page` (the `.chat` ground every chat item sits on), so no new colour-bearing rule enters the census. `.render-fallback` is self-grounded on `.block-screen`'s pair; `contrast.test.ts` stays at Task 7's 257 cases, all green.
7. **The tap-target halves are the `.btn-primary` rule and the rendered class.** The buttons carry no class of their own: the CSS half asserts `primitives.css`'s `.btn-primary` keeps `min-height: var(--tap-min)` and that `.render-fallback .btn-primary` declares no `min-height`, `height` or `max-height`; the render half asserts both rendered buttons carry `btn-primary` inside `.render-fallback`. The describe is its own rather than a new entry in 'keeps every floored rule on the token', because the floor here is not in a rule this file owns.
8. **React's caught-error `console.error` is silenced per file** with a scoped spy restored in `afterEach`/`afterAll`; `console.warn` is spied the same way and asserted. No global setup is touched.

**Measured while planning** (the shared scratch tree at Task 7's state; the mutations in a separate copy):
1. **Step 0**: `T8-STATE-OK`; tap-targets + chat + app `Test Files  3 passed (3)`, `Tests  120 passed (120)` (40 + 63 + 17).
2. **RED** (the four test files and the tap-targets edits in, no code): `Test Files  5 failed (5)`, `Tests  12 failed (12)` — `render-boundary` and `tap-targets` fail at import (`Failed to resolve import "../src/components/RenderBoundary"`), so their cases are not counted; `root-boundary` 2 (`expected { error: Error: boom } to be null`), `app-detail-boundary` 6 (`Error: runs screen broke`), `chat-item-boundary` 4 (`Error: bubble broke`, `Error: tool card broke`).
3. **GREEN**: the four files + tap-targets `Test Files  5 passed (5)`, `Tests  65 passed (65)` (11 + 2 + 6 + 4 + 42), `Type Errors  no errors`, nothing on stderr.
4. **Guards**: PWA `tsc` clean; under `CI=1`, tap-targets + contrast + shell-css + chat + app + app-pane-reset-timing + message-links + golden `Tests  564 passed (564)` (42 + 257 + 5 + 63 + 17 + 5 + 6 + 169); the whole PWA suite `Test Files  126 passed (126)`, `Tests  3948 passed (3948)` (Task 7's 122 and 3 923, plus 4 files and 25 cases); `single-definition` + `source-bytes` + `topology-clean` `Tests  580 passed (580)` (the scratch tree has no `origin`, so it ran with `CCRC_HISTORY_BASE` at the scratch base commit); `typecheck-tests` 10 of 12, the two reds (`server/test/` and `agent/test/ is clean`) being the scratch tree's missing `agent/node_modules`, as at Tasks 1-7, with `pwa/ is clean under tsconfig.json` green.
5. **Mutations**: 12 rows, each red in a separate copy (`git archive` of the staged tree, `git init`, `pwa/node_modules` and `server/node_modules` linked in), restored with `git checkout -- <file>` after each; `git status --porcelain` in the copy was empty after every one. Earlier rows: all 135 ids of Tasks 1-7 keep a unique `old` at this task's state (measured); the one that anchors on a file this task edits, W4-T7-M2 (`  }, [path, search]);` in `app.tsx`), keeps its `old` and its red (`app-pane-reset-timing` 3 failed, the three M4.R3 cases), so none is re-anchored.

- [ ] **Step 0: Confirm the state and claim the five shared files.** From the worktree root, foreground.

Run: `test -e pwa/src/lib/useParsedMarkdown.ts && test -e pwa/test/router-location.test.tsx && test ! -e pwa/src/components/RenderBoundary.tsx && test ! -e pwa/test/render-boundary.test.tsx && git diff --quiet HEAD -- pwa && grep -qF 'export function MsgPlain({ text, note }: { text: string; note?: string }): ReactNode {' pwa/src/lib/markdown.tsx && grep -qF '  const { path, search } = useLocation();' pwa/src/app.tsx && grep -qF 'function ChatItemView({' pwa/src/session/ChatList.tsx && ! grep -q 'RenderBoundary' pwa/src/main.tsx pwa/src/app.tsx pwa/src/session/ChatList.tsx pwa/src/styles/shell.css pwa/test/tap-targets.test.tsx && echo T8-STATE-OK`
Expected: `T8-STATE-OK` (Task 7 is committed, the tree is clean under `pwa/`, `MsgPlain` and `useLocation` exist, and no file names the boundary yet). If it does not print, stop and put an ask to the coordinator.

Take the claims on `pwa/src/main.tsx`, `pwa/src/app.tsx` (held since Task 7), `pwa/src/session/ChatList.tsx`, `pwa/src/styles/shell.css` and `pwa/test/tap-targets.test.tsx` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`). Open PR #191 edits `ChatList.tsx` below `ChatItemView`; a 409 names any holder: mail it through the response's `mailHint` and do not edit the file until that claim ends or the two coordinators confirm a scoped agreement (this task renames one function, adds a wrapper and two imports in `ChatList.tsx`; wraps the render in `main.tsx`; moves the ladder into a const and wraps it in `app.tsx`; appends rules after `.block-screen .btn-primary` in `shell.css`; adds one import and one describe in `tap-targets.test.tsx`). Release the `app.tsx` claim after this task commits.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx test/chat.test.tsx test/app.test.tsx )`
Expected: `Test Files  3 passed (3)`, `Tests  120 passed (120)` at planning (40 + 63 + 17; whatever it prints, Step 7's tap-targets count must be its tap-targets share plus 2, and Step 8's chat and app counts unchanged).

- [ ] **Step 1: Write the failing boundary test.** Create `pwa/test/render-boundary.test.tsx` with exactly this content:

```tsx
// The one error boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's refinement (m)).
// A throwing child shows `fallback(error)` with the thrown value, whatever it was (an Error, a string, `undefined`);
// `componentDidCatch` logs exactly `('ccrc: render error in ' + where, error)`; a changed `resetKey` renders the
// children again and an unchanged one keeps the fallback. The two screen fallbacks' buttons do what they say.
// The three mounts are pinned in root-boundary, app-detail-boundary and chat-item-boundary.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RenderBoundary, RootFallback, ScreenFallback } from '../src/components/RenderBoundary';
import { navigate } from '../src/lib/router';

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
  error.mockRestore();
  navigate('/');
});

/** Throws `what` while `boom.on` is true; renders a marker otherwise. */
const boom = { on: true, what: undefined as unknown };
function Thrower(): ReactNode {
  if (boom.on) throw boom.what;
  return <p>child drawn</p>;
}

/** A fallback that shows what it was handed, so a case can assert the thrown value reached it. */
const show = (e: unknown): ReactNode => (
  <p>
    fallback: {e === undefined ? 'undefined' : e === null ? 'null' : e instanceof Error ? e.message : String(e)}
  </p>
);

function arm(what: unknown): void {
  boom.on = true;
  boom.what = what;
}

describe('RenderBoundary: the fallback and the log line', () => {
  it('a throwing child shows fallback(error) with the thrown Error', () => {
    const err = new Error('kaboom');
    arm(err);
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('logs exactly (\'ccrc: render error in \' + where, error) through console.warn, once per catch', () => {
    const err = new Error('kaboom');
    arm(err);
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', err);
  });

  it('a thrown string reaches the fallback as that string', () => {
    arm('a plain string');
    render(<RenderBoundary where="chat item" resetKey={1} fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: a plain string')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', 'a plain string');
  });

  it('a thrown undefined still shows the fallback: failure is a flag, not a non-empty error (no overloaded null)', () => {
    arm(undefined);
    render(<RenderBoundary where="root" resetKey="root" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: undefined')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('a thrown null still shows the fallback', () => {
    arm(null);
    render(<RenderBoundary where="root" resetKey="root" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: null')).toBeInTheDocument();
  });

  it('children that do not throw render as they are, and nothing is logged', () => {
    boom.on = false;
    render(<RenderBoundary where="detail" resetKey="k" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('child drawn')).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('RenderBoundary: resetKey', () => {
  it('a changed resetKey renders the children again', () => {
    arm(new Error('kaboom'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>,
    );
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    boom.on = false;
    rerender(<RenderBoundary where="detail" resetKey="/settings" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('child drawn')).toBeInTheDocument();
    expect(screen.queryByText('fallback: kaboom')).toBeNull();
  });

  it('an unchanged resetKey keeps the fallback, even once the child would draw', () => {
    arm(new Error('kaboom'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>,
    );
    boom.on = false;
    rerender(<RenderBoundary where="detail" resetKey="/runs" fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument();
    expect(screen.queryByText('child drawn')).toBeNull();
  });

  it('a child that throws again under the new key shows the fallback again, with the new error', () => {
    arm(new Error('first'));
    const { rerender } = render(
      <RenderBoundary where="detail" resetKey={1} fallback={show}><Thrower /></RenderBoundary>,
    );
    arm(new Error('second'));
    rerender(<RenderBoundary where="detail" resetKey={2} fallback={show}><Thrower /></RenderBoundary>);
    expect(screen.getByText('fallback: second')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('the two screen fallbacks', () => {
  it("RootFallback says the app could not draw, and its Reload button calls the injected reload", () => {
    const reload = vi.fn();
    render(<RootFallback reload={reload} />);
    expect(screen.getByText('ccrc could not draw this screen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ScreenFallback says the screen could not be shown, and Back to the fleet navigates to '/'", () => {
    navigate('/runs?x=1');
    render(<ScreenFallback />);
    expect(screen.getByText('This screen could not be shown.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(location.pathname + location.search).toBe('/');
  });
});
```
- [ ] **Step 2: Write the three mount tests.** Create `pwa/test/root-boundary.test.tsx` with exactly this content:

```tsx
// M4.B4, the root boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's refinement
// (m)). Runs `main.tsx` ITSELF, not a copy of what it renders: the file plants `#root`, mocks the two modules whose
// import has effects this test does not want (`virtual:pwa-register`, the service-worker registration) or whose
// output it replaces (`../src/app`, an `App` that throws while rendering), then imports `../src/main`, which renders
// into `#root` exactly as the browser's entry does. Before the boundary, the throw unmounted the whole root and left
// a blank page (section 0, defect 3); with it, the page says so and offers Reload.
//
// Its own file because both mocks are per-file, and because importing `main.tsx` mounts a root that nothing
// unmounts: vitest isolates each test file, so that root ends with this file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, screen } from '@testing-library/react';

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));
vi.mock('../src/app', () => ({
  App: (): never => {
    throw new Error('boom');
  },
}));

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
/** What importing main.tsx threw, if anything. Without the boundary, React rethrows the App's error out of `act`;
 *  it is kept here so each case fails on its own assertion rather than the whole file failing in its setup. */
let importThrew: { error: unknown } | null = null;

beforeAll(async () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports the error the boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  try {
    await act(async () => {
      await import('../src/main');
    });
  } catch (e) {
    importThrew = { error: e };
  }
});

afterAll(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('main.tsx wraps <App/> in the root boundary (M4.B4)', () => {
  it('an App that throws while rendering shows "ccrc could not draw this screen." and a Reload button, inside #root', () => {
    expect(importThrew, 'the throw stayed inside the root boundary').toBeNull();
    const root = document.getElementById('root') as HTMLElement;
    expect(root).toContainElement(screen.getByText('ccrc could not draw this screen.'));
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(root).toContainElement(reload);
    expect(reload).toHaveClass('btn-primary');
  });

  it("the boundary logged the throw as the root's", () => {
    expect(importThrew, 'the throw stayed inside the root boundary').toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in root', expect.objectContaining({ message: 'boom' }));
  });
});
```
Create `pwa/test/app-detail-boundary.test.tsx` with exactly this content:

```tsx
// M4.B1's W4 half, the detail boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's
// refinements (a) and (m)). `app.tsx` wraps the detail ladder in a `RenderBoundary` INSIDE `<section
// className="shell-detail">`, keyed `path + search`: a screen that throws while rendering shows "This screen could
// not be shown." in the pane, while `.shell-nav`, the login overlay and the toasts, all outside it, stay mounted;
// any navigation (Back to the fleet, another route, the same path with another search) renders the ladder again.
//
// The thrower is a mocked `RunsScreen` at `/runs`, a W4 stand-in: M4.B1's own fixture is "a mocked throwing
// `DocsScreen` at `/docs`", and that screen and route arm are W5's (refinement (a); Task 12 records the W5 half for
// W5's brief). Its own file because the module mock is per-file (app-pane-reset-timing.test.tsx's reason).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { toast } from '../src/components/Toast';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

/** `vi.hoisted`: the mock factory runs while app.tsx is being evaluated, before this file's body. */
const boom = vi.hoisted(() => ({ on: true }));

vi.mock('../src/screens/RunsScreen', () => ({
  RunsScreen: (): ReactNode => {
    if (boom.on) throw new Error('runs screen broke');
    return <h1>runs (stand-in)</h1>;
  },
}));

const { App } = await import('../src/app');

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  boom.on = true;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  act(() => clearAuthLost());
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  warn.mockRestore();
  error.mockRestore();
});

const FALLBACK = 'This screen could not be shown.';
const detail = (): HTMLElement => document.querySelector('.shell-detail') as HTMLElement;

describe('a throwing detail screen keeps the shell (M4.B1, W4 half)', () => {
  it('draws the fallback inside .shell-detail while .shell-nav stays mounted', () => {
    navigate('/runs');
    render(<App />);
    expect(document.querySelector('.shell-nav')).not.toBeNull();
    expect(detail()).not.toBeNull();
    expect(detail()).toContainElement(screen.getByText(FALLBACK));
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.objectContaining({ message: 'runs screen broke' }));
  });

  it('Back to the fleet navigates to / and the pane shows the placeholder again', () => {
    navigate('/runs');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(location.pathname).toBe('/');
    expect(screen.getByText('Select a session')).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });

  it('navigating to another route resets the boundary too', () => {
    navigate('/runs');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    act(() => { navigate('/settings'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
  });

  it('the same path with another search resets it: the key is path + search', () => {
    navigate('/runs?x=1');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    boom.on = false;
    act(() => { navigate('/runs?x=2'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: 'runs (stand-in)' })).toBeInTheDocument();
  });

  it('the same path and search keeps the fallback, even once the screen would draw', () => {
    navigate('/runs?x=1');
    render(<App />);
    boom.on = false;
    act(() => { navigate('/runs?x=1'); });
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });

  it('the toasts and the login overlay, outside the boundary, still mount while the fallback shows', () => {
    navigate('/runs');
    render(<App />);
    act(() => { toast('still here'); });
    expect(screen.getByText('still here')).toBeInTheDocument();
    act(() => raiseAuthLost('expired'));
    expect(document.querySelector('.login-screen')).not.toBeNull();
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });
});
```
Create `pwa/test/chat-item-boundary.test.tsx` with exactly this content:

```tsx
// M4.B3, the per-item chat boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's
// refinements (j) and (m)). `ChatList.tsx`'s `ChatItemView` wraps every item in a `RenderBoundary`, so one item that
// throws while rendering costs that item alone: a message falls back to its raw text in `<pre className="msg-plain">`
// followed by "This message could not render; shown as plain text.", any other item to "This item could not be
// shown.". The key is the message text for a message (a streaming message that throws on one chunk is tried again on
// the next) and the item key for every other kind. `ChatListInner` and the virtualised `ChatList` share
// `ChatItemView`, so this one mount covers both; the cases render `ChatListInner` (Virtuoso cannot measure in jsdom).
//
// `MessageBubble` is the real one except for a text carrying THROW_MARK; `ToolCard` always throws. Both mocks are
// per-file, which is why this is its own file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';

const THROW_MARK = 'THROW';

vi.mock('../src/session/MessageBubble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session/MessageBubble')>();
  return {
    ...actual,
    MessageBubble: (props: ComponentProps<typeof actual.MessageBubble>): ReactNode => {
      if (props.event.text.includes('THROW')) throw new Error('bubble broke');
      return <actual.MessageBubble {...props} />;
    },
  };
});

vi.mock('../src/session/ToolCard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session/ToolCard')>();
  return {
    ...actual,
    ToolCard: (): never => {
      throw new Error('tool card broke');
    },
  };
});

const { ChatListInner } = await import('../src/session/ChatList');

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
  error.mockRestore();
});

const TS = '2026-07-20T10:00:00.000Z';
const assistant = (uuid: string, text: string): ChatEvent => ({ kind: 'assistant', uuid, ts: TS, text });
const toolUse = (uuid: string, toolId: string): ChatEvent =>
  ({ kind: 'tool_use', uuid, ts: TS, toolId, name: 'Bash', input: 'ls' });

const MIDDLE = `${THROW_MARK} in the middle **of** three`;
const NOTE = 'This message could not render; shown as plain text.';

const three = (middle: string): ChatEvent[] => [
  assistant('a1', 'first answer'),
  assistant('a2', middle),
  assistant('a3', 'third answer'),
];

describe('the per-item chat boundary (M4.B3)', () => {
  it('the middle of three messages throws: items 1 and 3 render, item 2 shows its raw text and the note', () => {
    render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    const first = screen.getByText('first answer');
    const third = screen.getByText('third answer');
    const plain = document.querySelector('pre.msg-plain') as HTMLElement;
    expect(plain).not.toBeNull();
    expect(plain.textContent).toBe(MIDDLE);
    const note = screen.getByText(NOTE);
    expect(note).toHaveClass('msg-plain-note');
    // Document order: item 1, then the raw text, then its note, then item 3.
    expect(first.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plain.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', expect.objectContaining({ message: 'bubble broke' }));
  });

  it('the fallback sits in the failed item, not in place of the list', () => {
    render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    const items = [...document.querySelectorAll('.chat-item')];
    const holder = items.find((el) => el.querySelector('pre.msg-plain') !== null);
    expect(holder).toBeDefined();
    expect(holder?.textContent).not.toContain('first answer');
    expect(holder?.textContent).not.toContain('third answer');
  });

  it('a new text for the failed item resets it: the key is the message text', () => {
    const { rerender } = render(<ChatListInner id="demo" events={three(MIDDLE)} pending={[]} />);
    expect(document.querySelector('pre.msg-plain')).not.toBeNull();
    rerender(<ChatListInner id="demo" events={three('second answer, streamed on')} pending={[]} />);
    expect(screen.getByText('second answer, streamed on')).toBeInTheDocument();
    expect(document.querySelector('pre.msg-plain')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('any other kind of item that throws shows "This item could not be shown." and the messages beside it still render', () => {
    render(
      <ChatListInner
        id="demo"
        events={[assistant('a1', 'first answer'), toolUse('a2', 't1'), assistant('a3', 'third answer')]}
        pending={[]}
      />,
    );
    expect(screen.getByText('This item could not be shown.')).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('third answer')).toBeInTheDocument();
    expect(document.querySelector('pre.msg-plain')).toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in chat item', expect.objectContaining({ message: 'tool card broke' }));
  });
});
```
- [ ] **Step 3: Add both tap-target halves for the fallback buttons.** Two edits in `pwa/test/tap-targets.test.tsx`; every existing describe is unchanged.

Edit 1 (`pwa/test/tap-targets.test.tsx`, the last import, line 37). Find:

```tsx
import { ReapSheet } from '../src/session/ReapSheet';
```

Replace with:

```tsx
import { ReapSheet } from '../src/session/ReapSheet';
import { RootFallback, ScreenFallback } from '../src/components/RenderBoundary';
```

Edit 2 (`pwa/test/tap-targets.test.tsx`, the end of the file, lines 490-492). Find:

```tsx
    expect(await screen.findByRole('button', { name: /^start/i })).toHaveClass('program-start-go');
  });
});
```

Replace with:

```tsx
    expect(await screen.findByRole('button', { name: /^start/i })).toHaveClass('program-start-go');
  });
});

// — native Docs reader, W4 Task 8: the two RenderBoundary fallbacks' buttons (Reload, Back to the fleet) —
//
// Both are `.btn-primary`, whose own rule (components/primitives.css) carries the floor; `.render-fallback
// .btn-primary` (styles/shell.css) gives the width back and must not lower the height.

describe('.render-fallback .btn-primary — the boundary fallbacks’ Reload and Back to the fleet', () => {
  const primitivesCss = read('components', 'primitives.css');
  const shellCss = read('styles', 'shell.css');

  it('is at least one tap tall, off the shared token, and the fallback rule does not lower it', () => {
    expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
    const local = ruleIn(shellCss, '.render-fallback .btn-primary');
    expect(declValue(local, 'min-height')).toBeNull();
    expect(declValue(local, 'height')).toBeNull();
    expect(declValue(local, 'max-height')).toBeNull();
  });

  it('is the class both rendered fallback buttons actually carry, inside .render-fallback', () => {
    render(<RootFallback reload={() => {}} />);
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(reload).toHaveClass('btn-primary');
    expect(reload.closest('.render-fallback')).not.toBeNull();
    cleanup();
    render(<ScreenFallback />);
    const back = screen.getByRole('button', { name: 'Back to the fleet' });
    expect(back).toHaveClass('btn-primary');
    expect(back.closest('.render-fallback')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run them to verify they fail.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/render-boundary.test.tsx test/root-boundary.test.tsx test/app-detail-boundary.test.tsx test/chat-item-boundary.test.tsx test/tap-targets.test.tsx )`
Expected: `Test Files  5 failed (5)`, `Tests  12 failed (12)`: `render-boundary.test.tsx` and `tap-targets.test.tsx` fail at import with `Error: Failed to resolve import "../src/components/RenderBoundary" ... Does the file exist?` (their cases are not counted); `root-boundary` 2 failed, each `the throw stayed inside the root boundary: expected { error: Error: boom } to be null`; `app-detail-boundary` 6 failed, each on `Error: runs screen broke`; `chat-item-boundary` 4 failed, three on `Error: bubble broke` and one on `Error: tool card broke`. Any other failure (a type error at transform, a missing export other than the boundary module) means a file was not transcribed exactly: fix the transcription, never the expectations.

- [ ] **Step 5: Create the boundary.** Create `pwa/src/components/RenderBoundary.tsx` with exactly this content:

```tsx
// The one error boundary (native Docs reader, design 2026-10-01 section 4.12; it fixes section 0's defect 3: before
// it, a throw while rendering unmounted the whole root and left a blank page). Three mounts in W4, each with its own
// reset key and fallback: `main.tsx` around `<App/>` (a constant key, so it never resets; `RootFallback`), `app.tsx`
// around the detail ladder INSIDE `.shell-detail` (key `path + search`, so any navigation resets it; `ScreenFallback`;
// the sidebar, the login overlay and the toasts are outside it and survive), and `session/ChatList.tsx`'s
// `ChatItemView` per chat item (key the message text or the item key; its two fallbacks live there). W5 adds a
// fourth around the Docs body.
//
// A class because React offers error boundaries only as classes. Declared fields only: the tsconfig's
// `erasableSyntaxOnly` forbids constructor parameter properties.
//
// No overloaded null: `failed` says whether the subtree threw, and `error` is whatever was thrown, which may itself
// be `undefined` or `null` (a `throw undefined` still shows the fallback). `key` is the `resetKey` the state was
// derived for; a different one clears `failed`.
//
// Styles: `.render-fallback` in styles/shell.css, beside `.block-screen`; the buttons are `.btn-primary`
// (components/primitives.css, `min-height: var(--tap-min)`). Both sheets are imported here so the root fallback,
// which replaces the whole app, never depends on another module having loaded them.
import { Component } from 'react';
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import './primitives.css';
import '../styles/shell.css';

export interface RenderBoundaryProps {
  /** Names the mount in the log line: `'root'`, `'detail'` or `'chat item'` in W4. */
  readonly where: string;
  /** A change of this value clears a caught failure and renders the children again; an unchanged one keeps the
   *  fallback. Compared with `===`. */
  readonly resetKey: string | number;
  /** What to draw instead of the children once they threw; called with the thrown value, whatever it was. */
  readonly fallback: (error: unknown) => ReactNode;
  readonly children?: ReactNode;
}

interface RenderBoundaryState {
  /** The children threw while rendering under the current `key`. */
  readonly failed: boolean;
  /** The thrown value. Meaningful only while `failed`; it may be `undefined` or `null` when that is what was thrown. */
  readonly error: unknown;
  /** The `resetKey` this state belongs to. */
  readonly key: string | number;
}

export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { failed: false, error: undefined, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<RenderBoundaryState> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(
    props: RenderBoundaryProps,
    state: RenderBoundaryState,
  ): Partial<RenderBoundaryState> | null {
    if (props.resetKey === state.key) return null;
    return { failed: false, error: undefined, key: props.resetKey };
  }

  componentDidCatch(error: unknown): void {
    console.warn('ccrc: render error in ' + this.props.where, error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/** The root mount's fallback: the whole app could not draw. `reload` defaults to reloading the page; tests inject
 *  it, because jsdom implements no navigation. */
export function RootFallback({ reload = () => location.reload() }: { reload?: () => void }): ReactNode {
  return (
    <div className="render-fallback render-fallback--root" role="alert">
      <p className="render-fallback-copy">ccrc could not draw this screen.</p>
      <button type="button" className="btn-primary" onClick={() => reload()}>
        Reload
      </button>
    </div>
  );
}

/** The detail pane's fallback: one screen could not draw; the sidebar beside it still works. */
export function ScreenFallback(): ReactNode {
  return (
    <div className="render-fallback" role="alert">
      <p className="render-fallback-copy">This screen could not be shown.</p>
      <button type="button" className="btn-primary" onClick={() => navigate('/')}>
        Back to the fleet
      </button>
    </div>
  );
}
```
- [ ] **Step 6: Mount it three times and style the fallbacks.** Two edits in `pwa/src/main.tsx`, three in `pwa/src/app.tsx`, three in `pwa/src/session/ChatList.tsx`, one in `pwa/src/styles/shell.css`.

Edit 1 (`pwa/src/main.tsx`, the `./app` import, line 5). Find:

```tsx
import { App } from './app';
```

Replace with:

```tsx
import { App } from './app';
import { RenderBoundary, RootFallback } from './components/RenderBoundary';
```

Edit 2 (`pwa/src/main.tsx`, the render call, lines 13-17). Find:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Replace with:

```tsx
// The root boundary (design 2026-10-01 section 4.12): a throw anywhere in the
// app while rendering shows "ccrc could not draw this screen." and Reload
// instead of unmounting the root into a blank page. Its key is a constant, so
// it never resets: Reload is the way back.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RenderBoundary where="root" resetKey="root" fallback={() => <RootFallback />}>
      <App />
    </RenderBoundary>
  </StrictMode>,
);
```

Edit 3 (`pwa/src/app.tsx`, the `LoginScreen` import, line 14). Find:

```tsx
import { LoginScreen } from './components/LoginScreen';
```

Replace with:

```tsx
import { LoginScreen } from './components/LoginScreen';
import { RenderBoundary, ScreenFallback } from './components/RenderBoundary';
```

Edit 4 (`pwa/src/app.tsx`, the end of the pane-reset effect and the `return (` line, lines 113-114). Find:

```tsx
  }, [path, search]);
  return (
```

Replace with:

```tsx
  }, [path, search]);
  // THE DETAIL LADDER, behind its own RenderBoundary (design 2026-10-01
  // section 4.12). Rendered INSIDE `.shell-detail` below, so a screen that
  // throws while rendering shows "This screen could not be shown." in the pane
  // while `.shell-nav`, the login overlay, the block screen and the toasts,
  // all outside it, stay mounted. Its reset key is `path + search`, so any
  // navigation draws the ladder again; it is not a React `key`, so it never
  // remounts a screen and the pane reset above stays the shell's.
  const ladder = sessionId ? (
    // key remounts per session so per-session UI state (terminal drawer,
    // pickers) never leaks across a sidebar switch.
    <SessionScreen key={sessionId} id={sessionId} />
  ) : archive ? (
    <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(`/s/${id}`)} />
  ) : accounts ? (
    <AccountsScreen />
  ) : mail ? (
    <MailScreen />
  ) : runs ? (
    <RunsScreen />
  ) : settings ? (
    <SettingsScreen />
  ) : (
    <div className="shell-placeholder">
      <p className="shell-placeholder-mark" aria-hidden="true">
        ❯
      </p>
      <p className="shell-placeholder-copy">Select a session</p>
    </div>
  );
  return (
```

Edit 5 (`pwa/src/app.tsx`, the detail pane and its ladder, lines 135-158). Find:

```tsx
        <section className="shell-detail" ref={detail}>
          {sessionId ? (
            // key remounts per session so per-session UI state (terminal drawer,
            // pickers) never leaks across a sidebar switch.
            <SessionScreen key={sessionId} id={sessionId} />
          ) : archive ? (
            <ArchiveScreen sessions={sessions} onOpen={(id) => navigate(`/s/${id}`)} />
          ) : accounts ? (
            <AccountsScreen />
          ) : mail ? (
            <MailScreen />
          ) : runs ? (
            <RunsScreen />
          ) : settings ? (
            <SettingsScreen />
          ) : (
            <div className="shell-placeholder">
              <p className="shell-placeholder-mark" aria-hidden="true">
                ❯
              </p>
              <p className="shell-placeholder-copy">Select a session</p>
            </div>
          )}
        </section>
```

Replace with:

```tsx
        <section className="shell-detail" ref={detail}>
          <RenderBoundary where="detail" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary>
        </section>
```

Edit 6 (`pwa/src/session/ChatList.tsx`, the `toast` import, line 14). Find:

```tsx
import { toast } from '../components/Toast';
```

Replace with:

```tsx
import { toast } from '../components/Toast';
import { RenderBoundary } from '../components/RenderBoundary';
import { MsgPlain } from '../lib/markdown';
```

Edit 7 (`pwa/src/session/ChatList.tsx`, `ChatItemView`'s first three lines, lines 395-397; the rest of the function is unchanged and becomes `ChatItemBody`). Find:

```tsx
function ChatItemView({
  item,
  id,
```

Replace with:

```tsx
function ChatItemBody({
  item,
  id,
```

Edit 8 (`pwa/src/session/ChatList.tsx`, the end of that switch, lines 426-429, just above `export interface ChatListProps {`). Find:

```tsx
    case 'working':
      return <WorkingIndicator />;
  }
}
```

Replace with:

```tsx
    case 'working':
      return <WorkingIndicator />;
  }
}

/** The note under a message whose bubble threw while rendering (design 2026-10-01 section 4.12). */
const ITEM_MESSAGE_NOTE = 'This message could not render; shown as plain text.';

/** One chat item behind its own RenderBoundary (design 2026-10-01 section 4.12), so an item that throws while
 *  rendering costs that item alone. A message falls back to its raw text (`MsgPlain`: `<pre className="msg-plain">`,
 *  then the note) and is keyed by its text, so a streaming message that threw on one chunk is tried again on the
 *  next; every other kind says "This item could not be shown." and is keyed by its item key. `ChatListInner` and the
 *  virtualised `ChatList` both render through here. */
function ChatItemView(props: Parameters<typeof ChatItemBody>[0]): ReactNode {
  const { item } = props;
  return (
    <RenderBoundary
      where="chat item"
      resetKey={item.kind === 'message' ? item.event.text : item.key}
      fallback={() => item.kind === 'message'
        ? <MsgPlain text={item.event.text} note={ITEM_MESSAGE_NOTE} />
        : <p className="msg-plain-note">This item could not be shown.</p>}
    >
      <ChatItemBody {...props} />
    </RenderBoundary>
  );
}
```

Edit 9 (`pwa/src/styles/shell.css`, `.block-screen .btn-primary`, lines 286-289, just above the LoginScreen section). Find:

```css
.block-screen .btn-primary {
  width: auto;
  min-width: 180px;
}
```

Replace with:

```css
.block-screen .btn-primary {
  width: auto;
  min-width: 180px;
}

/* ---- RenderBoundary's fallbacks (native Docs reader, W4) ------------- */
/* components/RenderBoundary.tsx: RootFallback replaces the whole app when it
   throws while rendering; ScreenFallback replaces one screen inside
   .shell-detail, beside a sidebar that still works. Self-grounded on the
   pair .block-screen already ships (--ink-primary on --bg-page), so the
   contrast gate measures no new pair; the copy sets no colour and inherits
   it. The root variant covers the viewport as .block-screen does; the screen
   one fills the pane. The buttons are .btn-primary (primitives.css carries
   the --tap-min floor); this file only gives them their width back. */
.render-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-5);
  min-height: 100%;
  padding: var(--sp-6);
  background: var(--bg-page);
  color: var(--ink-primary);
  text-align: center;
}
.render-fallback--root {
  position: fixed;
  inset: 0;
}
.render-fallback-copy {
  max-width: 40ch;
  font: var(--weight-medium) var(--text-base) / var(--leading-normal) var(--font-ui);
}
.render-fallback .btn-primary {
  width: auto;
  min-width: 180px;
}
```

Run: `wc -l pwa/src/components/RenderBoundary.tsx pwa/src/main.tsx pwa/src/app.tsx pwa/src/session/ChatList.tsx pwa/src/styles/shell.css pwa/test/tap-targets.test.tsx pwa/test/render-boundary.test.tsx pwa/test/root-boundary.test.tsx pwa/test/app-detail-boundary.test.tsx pwa/test/chat-item-boundary.test.tsx && grep -c 'ChatItemView' pwa/src/session/ChatList.tsx`
Expected: `92`, `54`, `172`, `564`, `385`, `523`, `145`, `62`, `108` and `120` lines, then `3` (the wrapper's own declaration and the two existing call sites in `ChatListInner` and `ChatList`, which are unedited).

- [ ] **Step 7: Run the task's tests to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/render-boundary.test.tsx test/root-boundary.test.tsx test/app-detail-boundary.test.tsx test/chat-item-boundary.test.tsx test/tap-targets.test.tsx )`
Expected: `Test Files  5 passed (5)`, `Tests  65 passed (65)` at planning (11 + 2 + 6 + 4 + 42: Step 0's 40 tap-target cases plus 2, and the four new files' 23), `Type Errors  no errors`, and nothing on stderr (React's caught-error report and the boundary's warn line are spied in each file).

- [ ] **Step 8: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests`, `contrast.test.ts`'s spawned-gate cases, `markdown-highlight.test.tsx`'s 65 536-character cases, `lifecycle-ui.test.tsx`, `dialog-sheet.test.tsx`, `session-pickers.test.tsx`, `fleet-screen.test.tsx` and `start-program.test.tsx` are known load flakes: a red in one of them is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (the class declares `state` as a field, so `erasableSyntaxOnly` has nothing to refuse; `ChatItemView`'s props type is derived from `ChatItemBody`'s, so the two cannot drift).

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/tap-targets.test.tsx test/contrast.test.ts test/shell-css.test.ts test/chat.test.tsx test/app.test.tsx test/app-pane-reset-timing.test.tsx test/message-links.test.tsx test/markdown-golden.test.tsx )`
Expected: `Test Files  8 passed (8)`, `Tests  564 passed (564)` at planning (42 + 257 + 5 + 63 + 17 + 5 + 6 + 169): `contrast` at Task 7's 257 (no census identity added), `chat` and `app` at Step 0's counts, the pane reset's five cases (the boundary never remounts a screen), `message-links` unmodified and green, and no golden file written (`CI=1` makes a missing snapshot a failure).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  126 passed (126)`, `Tests  3948 passed (3948)` at planning (Task 7's 122 files and 3 923 tests, plus this task's 4 files and 25 cases; re-derive the base at Step 0's state if another programme moved it).

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; `RenderBoundary`, `RootFallback`, `ScreenFallback`, `ChatItemBody` and `ITEM_MESSAGE_NOTE` collide with no scanned name).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the four new test files and the five edited sources.

Run: `git add pwa/src/components/RenderBoundary.tsx pwa/src/main.tsx pwa/src/app.tsx pwa/src/session/ChatList.tsx pwa/src/styles/shell.css pwa/test/tap-targets.test.tsx pwa/test/render-boundary.test.tsx pwa/test/root-boundary.test.tsx pwa/test/app-detail-boundary.test.tsx pwa/test/chat-item-boundary.test.tsx && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; the fixtures name the session `demo`, the paths `/`, `/runs`, `/settings`, the searches `?x=1`, `?x=2`, and no host, user or project; the `❯` the ladder carries is the same character `app.tsx` already held).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 9: Commit.**

```bash
git add pwa/src/components/RenderBoundary.tsx pwa/src/main.tsx pwa/src/app.tsx pwa/src/session/ChatList.tsx pwa/src/styles/shell.css pwa/test/tap-targets.test.tsx pwa/test/render-boundary.test.tsx pwa/test/root-boundary.test.tsx pwa/test/app-detail-boundary.test.tsx pwa/test/chat-item-boundary.test.tsx
git status --porcelain | grep -v '^[AM]  pwa/' ; git diff --cached --name-only | wc -l
git commit -m "pwa: RenderBoundary at the root, the detail ladder and each chat item (docs W4)" \
  -m "components/RenderBoundary.tsx is the one error boundary: getDerivedStateFromError, a resetKey that clears a caught failure through getDerivedStateFromProps, componentDidCatch logging 'ccrc: render error in <where>', and a fallback(error) prop; a failed flag, so a thrown undefined still shows the fallback. RootFallback offers Reload, ScreenFallback Back to the fleet; both buttons are .btn-primary, styled by .render-fallback in shell.css on the pair .block-screen already ships." \
  -m "main.tsx wraps App with a constant key; app.tsx wraps the detail ladder inside .shell-detail keyed path + search, so the sidebar, the login overlay and the toasts survive a throwing screen and any navigation resets it; ChatList's ChatItemView wraps each item keyed by the message text or the item key, a message falling back to its raw text in msg-plain with a note and any other item to one line. root-boundary.test.tsx runs main.tsx itself (M4.B4), app-detail-boundary.test.tsx a throwing RunsScreen stand-in (M4.B1's W4 half), chat-item-boundary.test.tsx the middle of three messages (M4.B3); tap-targets.test.tsx gains both halves for the two buttons." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only additions and modifications under `pwa/` are staged) and the count is `10`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in; `old` is unique in its file at this task's state; no earlier row is re-anchored):

```json
[
 {
  "id": "W4-T8-M1",
  "pkg": "pwa",
  "file": "pwa/src/main.tsx",
  "old": "    <RenderBoundary where=\"root\" resetKey=\"root\" fallback={() => <RootFallback />}>\n      <App />\n    </RenderBoundary>\n",
  "new": "    <App />\n",
  "tests": [
   "test/root-boundary.test.tsx"
  ],
  "red": "pwa root-boundary: 2 failed (2) — both cases: `the throw stayed inside the root boundary: expected { error: Error: boom } to be null` (React rethrows the App's error out of `act`, and #root is left empty)"
 },
 {
  "id": "W4-T8-M2",
  "pkg": "pwa",
  "file": "pwa/src/app.tsx",
  "old": "          <RenderBoundary where=\"detail\" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary>\n",
  "new": "          {ladder}\n",
  "tests": [
   "test/app-detail-boundary.test.tsx"
  ],
  "red": "pwa app-detail-boundary: 6 failed (6) — every case: the RunsScreen stand-in's throw reaches the test (`Error: runs screen broke`), no fallback, no shell"
 },
 {
  "id": "W4-T8-M3",
  "pkg": "pwa",
  "file": "pwa/src/app.tsx",
  "old": "        <section className=\"shell-detail\" ref={detail}>\n          <RenderBoundary where=\"detail\" resetKey={path + search} fallback={() => <ScreenFallback />}>{ladder}</RenderBoundary>\n        </section>\n",
  "new": "        <RenderBoundary where=\"detail\" resetKey={path + search} fallback={() => <ScreenFallback />}>\n          <section className=\"shell-detail\" ref={detail}>{ladder}</section>\n        </RenderBoundary>\n",
  "tests": [
   "test/app-detail-boundary.test.tsx"
  ],
  "red": "pwa app-detail-boundary: 1 failed | 5 passed (6) — 'draws the fallback inside .shell-detail while .shell-nav stays mounted' (the fallback replaces the section, so there is no `.shell-detail` to hold it)"
 },
 {
  "id": "W4-T8-M4",
  "pkg": "pwa",
  "file": "pwa/src/app.tsx",
  "old": "resetKey={path + search}",
  "new": "resetKey={path}",
  "tests": [
   "test/app-detail-boundary.test.tsx"
  ],
  "red": "pwa app-detail-boundary: 1 failed | 5 passed (6) — 'the same path with another search resets it: the key is path + search'"
 },
 {
  "id": "W4-T8-M5",
  "pkg": "pwa",
  "file": "pwa/src/session/ChatList.tsx",
  "old": "function ChatItemView(props: Parameters<typeof ChatItemBody>[0]): ReactNode {\n  const { item } = props;\n",
  "new": "function ChatItemView(props: Parameters<typeof ChatItemBody>[0]): ReactNode {\n  return <ChatItemBody {...props} />;\n  const { item } = props;\n",
  "tests": [
   "test/chat-item-boundary.test.tsx"
  ],
  "red": "pwa chat-item-boundary: 4 failed (4) — every case: `Error: bubble broke` / `Error: tool card broke` escape the list"
 },
 {
  "id": "W4-T8-M6",
  "pkg": "pwa",
  "file": "pwa/src/session/ChatList.tsx",
  "old": "      resetKey={item.kind === 'message' ? item.event.text : item.key}\n",
  "new": "      resetKey={item.key}\n",
  "tests": [
   "test/chat-item-boundary.test.tsx"
  ],
  "red": "pwa chat-item-boundary: 1 failed | 3 passed (4) — 'a new text for the failed item resets it: the key is the message text' (the item key does not change, so `pre.msg-plain` stays)"
 },
 {
  "id": "W4-T8-M7",
  "pkg": "pwa",
  "file": "pwa/src/session/ChatList.tsx",
  "old": "        ? <MsgPlain text={item.event.text} note={ITEM_MESSAGE_NOTE} />\n",
  "new": "        ? <p className=\"msg-plain-note\">This item could not be shown.</p>\n",
  "tests": [
   "test/chat-item-boundary.test.tsx"
  ],
  "red": "pwa chat-item-boundary: 3 failed | 1 passed (4) — 'the middle of three messages throws: ...', 'the fallback sits in the failed item, ...' and 'a new text for the failed item resets it: ...' (no `pre.msg-plain`, no message note)"
 },
 {
  "id": "W4-T8-M8",
  "pkg": "pwa",
  "file": "pwa/src/components/RenderBoundary.tsx",
  "old": "  static getDerivedStateFromProps(\n    props: RenderBoundaryProps,\n    state: RenderBoundaryState,\n  ): Partial<RenderBoundaryState> | null {\n    if (props.resetKey === state.key) return null;\n    return { failed: false, error: undefined, key: props.resetKey };\n  }\n\n",
  "new": "",
  "tests": [
   "test/render-boundary.test.tsx",
   "test/app-detail-boundary.test.tsx",
   "test/chat-item-boundary.test.tsx"
  ],
  "red": "pwa render-boundary + app-detail-boundary + chat-item-boundary: 6 failed | 15 passed (21) — render-boundary 'a changed resetKey renders the children again' and 'a child that throws again under the new key ...'; app-detail-boundary 'Back to the fleet navigates to / ...', 'navigating to another route resets the boundary too' and 'the same path with another search resets it ...'; chat-item-boundary 'a new text for the failed item resets it ...'"
 },
 {
  "id": "W4-T8-M9",
  "pkg": "pwa",
  "file": "pwa/src/components/RenderBoundary.tsx",
  "old": "    console.warn('ccrc: render error in ' + this.props.where, error);",
  "new": "    console.warn('render error in ' + this.props.where, error);",
  "tests": [
   "test/render-boundary.test.tsx",
   "test/root-boundary.test.tsx",
   "test/app-detail-boundary.test.tsx",
   "test/chat-item-boundary.test.tsx"
  ],
  "red": "pwa render-boundary + root-boundary + app-detail-boundary + chat-item-boundary: 6 failed | 17 passed (23) — every case that asserts the warn line: render-boundary 'logs exactly (...)' and 'a thrown string reaches the fallback as that string', root-boundary 'the boundary logged the throw as the root's', app-detail-boundary 'draws the fallback inside .shell-detail ...', chat-item-boundary 'the middle of three messages throws: ...' and 'any other kind of item that throws ...'"
 },
 {
  "id": "W4-T8-M10",
  "pkg": "pwa",
  "file": "pwa/src/components/RenderBoundary.tsx",
  "old": "    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;",
  "new": "    return this.state.error !== undefined ? this.props.fallback(this.state.error) : this.props.children;",
  "tests": [
   "test/render-boundary.test.tsx"
  ],
  "red": "pwa render-boundary: 1 failed | 10 passed (11) — 'a thrown undefined still shows the fallback: failure is a flag, not a non-empty error (no overloaded null)'"
 },
 {
  "id": "W4-T8-M11",
  "pkg": "pwa",
  "file": "pwa/src/components/RenderBoundary.tsx",
  "old": "      <button type=\"button\" className=\"btn-primary\" onClick={() => navigate('/')}>",
  "new": "      <button type=\"button\" onClick={() => navigate('/')}>",
  "tests": [
   "test/tap-targets.test.tsx"
  ],
  "red": "pwa tap-targets: 1 failed | 41 passed (42) — 'is the class both rendered fallback buttons actually carry, inside .render-fallback' (`expect(element).toHaveClass(\"btn-primary\")`)"
 },
 {
  "id": "W4-T8-M12",
  "pkg": "pwa",
  "file": "pwa/src/styles/shell.css",
  "old": ".render-fallback .btn-primary {\n  width: auto;\n",
  "new": ".render-fallback .btn-primary {\n  min-height: 32px;\n  width: auto;\n",
  "tests": [
   "test/tap-targets.test.tsx"
  ],
  "red": "pwa tap-targets: 1 failed | 41 passed (42) — 'is at least one tap tall, off the shared token, and the fallback rule does not lower it' (`expected '32px' to be null`)"
 }
]
```

---

### Task 9: The service worker: swDenylist refuses an entry covering /docs at build time; the prose and tests that move with it; M7.9

**Model routing:** `sonnet`, effort `high`. The code is twelve lines; the value is in WHERE the verdict is taken (on the normalised entry, with the `/` boundary) and in four prose blocks that must keep their line counts. Every number below was measured on the shared scratch tree at Task 8's state, the build gate and the mutations in a separate copy.

**Spec rows:** M7.2 (`sw-denylist.test.ts`: throws, naming the entry and `CCRC_SW_DENYLIST`, for `/docs`, `docs`, ` /docs/ `, `/docs/x`, `/wiki,/docs`; `/docsy` and `/docs-archive` do not throw; the default does not deny `/docs/p/specs/a.md` and does deny `/api/docs/p/tree`; mutations: delete the throw, compare unnormalised, add `/docs` to the worker's own list) and M7.9 (`docs-parity.test.ts`: the standalone server's directory name only inside the two ruling comments in `ccd/ccrc` and `ccd/ccrc-doctor-checks`, located by anchor sentence; its name nowhere in `pwa/src`; mutations: add a path naming it, keep the old `sw-denylist` comment). Section 7.3 (the build-time refusal, its exact sentence, "Only the Docs prefix is refused", and the four prose edits, each in place with its line count unchanged), C5 (the default never denies `/docs`) and X1 (re-measured in Step 10). Refinements (u) (`deploy.sh` line 41's co-tenant sentence is rewritten too), (v) (M7.9's two needles, built from parts; the name needle also covers `pwa/vite.config.ts`) and (x) (M7.9 appends to `docs-parity.test.ts`; `single-definition.test.ts` is not edited).

**Files:**
- Modify: `pwa/src/lib/sw-denylist.ts` — four Find/Replace edits: the header's co-tenant paragraph (lines 9-14, a hint; same six lines), the import after the header (after line 18), the docstring's `@param` and examples (lines 28-37; the docstring stays 14 lines), and the refusal after the normalisation (lines 44-45). 46 lines become 56.
- Modify: `pwa/test/sw-denylist.test.ts` — one Find/Replace edit (lines 52-85: every `/docs` example becomes `/wiki`, the four cases the throw would red) and one describe appended at the end (after line 122); lines 96-122, the `vite.config` describe with the `:113-121` assertions, are not touched. 122 lines become 206.
- Modify: `pwa/vite.config.ts` — one Find/Replace edit of the co-tenant comment (lines 54-60; same seven lines). The `navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST']),` line stays byte-identical. 96 lines stay 96.
- Modify: `deploy/deploy.sh` — two one-line Find/Replace edits in the header (lines 28 and 41), in place. 1290 lines stay 1290; the `export CCRC_SW_DENYLIST=` line (45) is byte-identical.
- Modify: `server/test/docs-parity.test.ts` — one end-of-file append (after line 447, `});`'s last line): the M7.9 block. 447 lines become 591. Nothing above line 447 changes (the file's header: "APPEND ONLY").
- Test: `pwa/test/sw-denylist.test.ts`, `server/test/docs-parity.test.ts`; guards: `server/test/deploy-coordinates.test.ts` (pins the export line), `server/test/session-hook.test.ts`'s citation audit (it cites `deploy/deploy.sh` by line below line 508; both edits are above it and keep the line count), the PWA `tsc`, the whole PWA suite (`vite.config.ts` is the vitest config too), `single-definition`, `typecheck-tests`, `source-bytes`, `topology-clean`.

Every Find block below is quoted from its file as Task 8 left it (Tasks 1-8 edit none of `sw-denylist.ts`, its test, `deploy/deploy.sh` or `docs-parity.test.ts`, so those are `BASE`'s text; `vite.config.ts` is Task 5's, whose only edit is the `worker` key below the block) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator.

The two old comment lines this task removes are the only places this task's Find blocks spell the standalone server's generic name, and mutation rows M6-M8 plant the names on purpose; no Replace block, test, source or commit message spells either name whole, in any case (the M7.9 needles and the CONTROLs' planted lines are built from parts).

**Interfaces:**
- Consumes: `export const DOCS_PAGE_PREFIX = '/docs';` from `shared/docs.ts`, imported as `import { DOCS_PAGE_PREFIX } from '../../../shared/docs';` (the house form, as `pwa/src/lib/feed.ts` imports `../../../shared/api`). It is the one W1 export W4 consumes; `shared/docs.ts` is not edited. Tests only: `ccrcRoot` (module scope of `server/test/docs-parity.test.ts`, the repo root).
- Produces, `pwa/src/lib/sw-denylist.ts`: `export function swDenylist(extra: string | undefined): RegExp[]` — the same signature and the same list for every knob it accepts; it now throws `Error` with exactly `CCRC_SW_DENYLIST entry <p> covers /docs, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again.` when the first NORMALISED entry `p` satisfies `p === DOCS_PAGE_PREFIX || p.startsWith(DOCS_PAGE_PREFIX + '/')` (the `/docs` in the sentence is `${DOCS_PAGE_PREFIX}`). The built-in list stays `[/^\/api\//, /^\/ws\//]`.
- Produces, tests (module-private): in `pwa/test/sw-denylist.test.ts`, `refusal(p: string): string` (spec 7.3's sentence restated, so a changed message reds) and `attempt(extra: string): { threw: false } | { threw: true; error: unknown }`; in `server/test/docs-parity.test.ts`, `m79Scan(files: ReadonlyArray<readonly [string, string]>): string[]` (one violation string per line; `[]` is clean), `m79Files(): Array<readonly [string, string]>`, and the constants `M79_DIR`, `M79_NAME`, `M79_RULINGS: ReadonlyMap<string, string>`, `M79_ROOTS`, `M79_PWA_CONFIG`.

- [ ] **Step 0: Confirm the state, claim the five files, record the counts.** From the worktree root, foreground.

Run: `git diff --quiet HEAD -- pwa deploy server/test && test -e pwa/src/components/RenderBoundary.tsx && grep -qF "export const DOCS_PAGE_PREFIX = '/docs';" shared/docs.ts && ! grep -q 'DOCS_PAGE_PREFIX' pwa/src/lib/sw-denylist.ts && grep -qF "  worker: { format: 'es' }," pwa/vite.config.ts && grep -qF "navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST'])," pwa/vite.config.ts && ! grep -q 'M7.9' server/test/docs-parity.test.ts && grep -qF '#     CCRC_SW_DENYLIST=/docs,/fleet      # optional' deploy/deploy.sh && echo T9-STATE-OK`
Expected: `T9-STATE-OK` (Task 8 is committed, the tree is clean, the prefix exists in L0, nothing imports it here yet, Task 5's `worker` key is in the config, and neither the refusal nor M7.9 exists). If it does not print, stop and put an ask to the coordinator.

Take the claims on `pwa/src/lib/sw-denylist.ts`, `pwa/test/sw-denylist.test.ts`, `pwa/vite.config.ts` (held since Task 5, or take it again), `deploy/deploy.sh` and `server/test/docs-parity.test.ts` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`). A 409 names any holder: mail it through the response's `mailHint` and do not edit that file until the claim ends or the two coordinators confirm a scoped agreement (this task edits four comment blocks and adds twelve lines of code in the PWA, two header comment lines in `deploy.sh`, and appends one block to `docs-parity.test.ts`). Release all five after this task commits.

Run: `wc -l pwa/src/lib/sw-denylist.ts pwa/test/sw-denylist.test.ts pwa/vite.config.ts deploy/deploy.sh server/test/docs-parity.test.ts && awk 'NR<=19 && /^\/\//' pwa/src/lib/sw-denylist.ts | wc -l && awk '/^\/\*\*$/{f=1;n=0} f{n++} /^ \*\/$/{if(f){print n; f=0}}' pwa/src/lib/sw-denylist.ts && awk '/CO-TENANTS ARE A BUILD-TIME KNOB/{f=1} /globPatterns:/{f=0} f' pwa/vite.config.ts | wc -l`
Expected: `46`, `122`, `96`, `1290` and `447` lines, then `18` (the header comment), `14` (the docstring) and `7` (the vite co-tenant comment). Steps 5, 6 and 8 hold the last three and the `deploy.sh` and `vite.config.ts` totals to these numbers.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/sw-denylist.test.ts ) && ( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/deploy-coordinates.test.ts )`
Expected: `Tests  11 passed (11)`, then `Test Files  2 passed (2)`, `Tests  58 passed (58)` (45 + 13). Whatever it prints, Step 7's counts are these plus 5 and plus 5.

**Never run the PWA suite with `CCRC_SW_DENYLIST` covering `/docs` in the environment** from Step 5 on: `vite.config.ts` is also vitest's config, so every PWA test file would die at config load with the refusal. Check with `printenv CCRC_SW_DENYLIST` (it should print nothing, or no `/docs` entry).

- [ ] **Step 1: Write the failing M7.2 tests.** In `pwa/test/sw-denylist.test.ts`, first switch the four co-tenant cases' examples from `/docs` to `/wiki` (the throw would red each of them; spec 7.3: "switches every `/docs` example to `/wiki` (`:52-85`), keeping `:113-121`"):

Find (lines 52-85):

```ts
  it('appends co-tenant prefixes after the built-ins', () => {
    expect(swDenylist('/docs,/fleet').map(String)).toEqual(
      [/^\/api\//, /^\/ws\//, /^\/docs(\/|$)/, /^\/fleet(\/|$)/].map(String),
    );
  });

  it('an appended prefix matches the path and its subtree, never a sibling', () => {
    const list = swDenylist('/docs,/fleet');
    for (const under of ['/docs', '/docs/', '/docs/guide/intro', '/fleet', '/fleet/x']) {
      expect(denies(list, under), under).toBe(true);
    }
    // /docsy is a DIFFERENT route — a prefix knob that swallowed it would
    // take unrelated SPA routes dark, which is why (\/|$) anchors the end.
    // A naive startsWith would hand these to the network and the route would
    // 404 from a server that has never heard of them.
    for (const sibling of ['/docsy', '/docs-archive', '/fleet-view']) {
      expect(denies(list, sibling), `${sibling} merely shares a prefix`).toBe(false);
    }
  });

  it('tolerates spaces and empty segments — an env file is typed by hand', () => {
    expect(swDenylist(' /docs , ,/fleet ,').map(String)).toEqual(
      swDenylist('/docs,/fleet').map(String),
    );
  });

  it('accepts what a person actually types — slashes are normalized, not required', () => {
    // No leading slash, a trailing or doubled one. A knob that silently does
    // nothing for `docs` is worse than no knob, because the operator sees a
    // config line and believes it.
    for (const spelling of ['/docs', 'docs', '/docs/', '//docs', ' docs , ', '/docs,']) {
      expect(denies(swDenylist(spelling), '/docs/x'), JSON.stringify(spelling)).toBe(true);
    }
  });
```

Replace with:

```ts
  it('appends co-tenant prefixes after the built-ins', () => {
    expect(swDenylist('/wiki,/fleet').map(String)).toEqual(
      [/^\/api\//, /^\/ws\//, /^\/wiki(\/|$)/, /^\/fleet(\/|$)/].map(String),
    );
  });

  it('an appended prefix matches the path and its subtree, never a sibling', () => {
    const list = swDenylist('/wiki,/fleet');
    for (const under of ['/wiki', '/wiki/', '/wiki/guide/intro', '/fleet', '/fleet/x']) {
      expect(denies(list, under), under).toBe(true);
    }
    // /wikis is a DIFFERENT route — a prefix knob that swallowed it would
    // take unrelated SPA routes dark, which is why (\/|$) anchors the end.
    // A naive startsWith would hand these to the network and the route would
    // 404 from a server that has never heard of them.
    for (const sibling of ['/wikis', '/wiki-archive', '/fleet-view']) {
      expect(denies(list, sibling), `${sibling} merely shares a prefix`).toBe(false);
    }
  });

  it('tolerates spaces and empty segments — an env file is typed by hand', () => {
    expect(swDenylist(' /wiki , ,/fleet ,').map(String)).toEqual(
      swDenylist('/wiki,/fleet').map(String),
    );
  });

  it('accepts what a person actually types — slashes are normalized, not required', () => {
    // No leading slash, a trailing or doubled one. A knob that silently does
    // nothing for `wiki` is worse than no knob, because the operator sees a
    // config line and believes it.
    for (const spelling of ['/wiki', 'wiki', '/wiki/', '//wiki', ' wiki , ', '/wiki,']) {
      expect(denies(swDenylist(spelling), '/wiki/x'), JSON.stringify(spelling)).toBe(true);
    }
  });
```

Then append this block (it starts with one blank line) at the end of the file, after the final `});` of the `vite.config consumes the knob rather than restating the list` describe (line 122), so lines 96-122 do not move:

```ts

// ── M7.2: an entry covering ccrc's own Docs pages fails the build (spec 7.3) ──
//
// `/docs/*` is ccrc's own: the server's not-found handler and the worker's
// navigateFallback both hand those pages the app shell. A knob entry equal to
// the Docs prefix, or under it, would send every Docs navigation past the
// shell, so swDenylist THROWS; vite.config calls it at config load, so the
// build stops before anything ships. The verdict is on the NORMALISED entry,
// the same trim and slash rules every other knob path gets, and the message
// names that normalised form.

/** Spec 7.3's sentence, with the normalised entry in place of `<p>`. */
const refusal = (p: string): string =>
  `CCRC_SW_DENYLIST entry ${p} covers /docs, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again.`;

/** What `swDenylist(extra)` threw; `{ threw: false }` when it returned a list. */
function attempt(extra: string): { threw: false } | { threw: true; error: unknown } {
  try {
    swDenylist(extra);
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}

describe('M7.2: the build refuses an entry covering /docs; the default never denies it', () => {
  it('throws, naming the normalised entry and CCRC_SW_DENYLIST, for every spelling of the Docs prefix', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['/docs', '/docs'],
      ['docs', '/docs'],
      [' /docs/ ', '/docs'],
      ['//docs', '/docs'],
      ['/docs/x', '/docs/x'],
      ['/wiki,/docs', '/docs'],
      ['/wiki, docs/ ,/fleet', '/docs'],
    ];
    for (const [extra, normalised] of cases) {
      const got = attempt(extra);
      expect(got.threw, JSON.stringify(extra)).toBe(true);
      if (!got.threw) continue;
      expect(got.error, JSON.stringify(extra)).toBeInstanceOf(Error);
      const message = (got.error as Error).message;
      expect(message, JSON.stringify(extra)).toBe(refusal(normalised));
      expect(message).toContain('CCRC_SW_DENYLIST');
      expect(message).toContain(`entry ${normalised} covers`);
    }
  });

  it('refuses only the Docs prefix: a sibling that merely starts the same way builds', () => {
    for (const sibling of ['/docsy', '/docs-archive', 'docsearch/']) {
      expect(attempt(sibling).threw, `${sibling} is not under /docs`).toBe(false);
    }
    // And it is still a co-tenant: the knob denies it like any other path.
    const list = swDenylist('/docsy,/docs-archive');
    expect(denies(list, '/docsy/a')).toBe(true);
    expect(denies(list, '/docs-archive')).toBe(true);
    expect(denies(list, '/docs/p/specs/a.md'), 'a sibling entry claimed a Docs page').toBe(false);
  });

  it('the default does not deny a Docs page, and does deny the Docs API', () => {
    const list = swDenylist(undefined);
    for (const page of ['/docs', '/docs/', '/docs/p', '/docs/p/specs/a.md']) {
      expect(denies(list, page), `${page} is ccrc's own Docs page`).toBe(false);
    }
    expect(denies(list, '/api/docs/p/tree')).toBe(true);
  });

  it('/docs is never on the worker\'s own list (C5): every list leads with exactly the two built-ins', () => {
    for (const extra of [undefined, '', '/wiki', '/wiki,/fleet']) {
      const list = swDenylist(extra);
      expect(list.slice(0, 2).map(String), JSON.stringify(extra)).toEqual([/^\/api\//, /^\/ws\//].map(String));
      expect(denies(list, '/docs/p/specs/a.md'), JSON.stringify(extra)).toBe(false);
    }
  });

  it('reads the prefix from shared/docs.ts rather than spelling it', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'sw-denylist.ts'),
      'utf8',
    );
    expect(src).toContain("import { DOCS_PAGE_PREFIX } from '../../../shared/docs';");
    expect(src, 'a quoted /docs literal: the prefix has one home').not.toMatch(/['"]\/docs/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/sw-denylist.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  2 failed | 14 passed (16)`, `Type Errors  no errors`. The two reds: `throws, naming the normalised entry and CCRC_SW_DENYLIST, for every spelling of the Docs prefix` (`"/docs": expected false to be true`) and `reads the prefix from shared/docs.ts rather than spelling it` (`expected '// Which navigations the service work…' to contain 'import { DOCS_PAGE_PREFIX } from \'..…'`). The `/wiki` cases, the sibling case, the default case and the C5 case are green already: they pin behaviour the refusal must not move.

- [ ] **Step 3: Write the failing M7.9 scan.** Append this block (it starts with one blank line) at the end of `server/test/docs-parity.test.ts`, after its last line (`});`, line 447, which closes `M3.12: slug_from_url gives _gh_repo_slug's verdict on every origin URL`). The block reuses the module scope's `ccrcRoot` and imports everything else under names of its own:

```ts

// ---- Docs W4 Task 9: M7.9, ccrc does not know a standalone docs server (spec 2026-10-01 sections 1 and 7.3) ----
// Two needles, both built from parts so this file never spells either whole. The DIRECTORY needle may appear in the
// shipped source (ccd/, deploy/, server/src, pwa/src, agent/src, shared/) only inside the two existing ruling
// comments that explain why it is NOT special-cased, one in ccd/ccrc and one in ccd/ccrc-doctor-checks, each
// located by its anchor sentence and taken as the paragraph around it (contiguous comment lines with text; a bare
// `#` or a code line ends it), never by a line number. The NAME needle, case-insensitive, appears nowhere in
// pwa/src or in pwa/vite.config.ts. The file list is git's: tracked files plus untracked ones git would not ignore
// (so a scratch copy with a fresh `git init` scans the same set, and a gitignored secret is never read); a file
// holding a NUL byte is skipped as binary.
// Raw text on purpose: a needle in a comment counts. NOT EXHAUSTIVE. Known evasions: a name split across two
// lines; a name built from parts in code (as this block builds its own); the directory needle in another case;
// either needle in an excluded tree (server/test, docs/, README.md, CLAUDE.md, a gitignored file); and the name
// needle anywhere outside pwa/src and pwa/vite.config.ts.
// Imports under names of its own (this block is appended below others that bind theirs).
import * as m79Vitest from 'vitest';
import * as m79Fs from 'node:fs';
import * as m79Path from 'node:path';
import * as m79Cp from 'node:child_process';

const M79_DIR = ['claude', 'doc' + 'server'].join('-');
const M79_NAME = ['doc', 'server'].join('');
/** The two ruling comments: file -> the anchor sentence that locates the paragraph. */
const M79_RULINGS: ReadonlyMap<string, string> = new Map([
  ['ccd/ccrc', 'A named `.' + M79_DIR + '` skip used to sit here.'],
  ['ccd/ccrc-doctor-checks', 'NO `.' + M79_DIR + '` SPECIAL CASE, DELIBERATELY'],
]);
const M79_ROOTS = ['ccd', 'deploy', 'server/src', 'pwa/src', 'agent/src', 'shared'];
const M79_PWA_CONFIG = 'pwa/vite.config.ts';

/** Every violation in `files` ([repo-relative path, text]), one line each; empty means clean. */
function m79Scan(files: ReadonlyArray<readonly [string, string]>): string[] {
  const out: string[] = [];
  const names = new Set(files.map(([name]) => name));
  for (const ruled of M79_RULINGS.keys()) if (!names.has(ruled)) out.push(`${ruled}: not scanned`);
  for (const [name, text] of files) {
    const lines = text.split('\n');
    const allowed = new Set<number>();
    const anchor = M79_RULINGS.get(name);
    if (anchor !== undefined) {
      const at = lines.flatMap((l, i) => (l.includes(anchor) ? [i] : []));
      if (at.length !== 1) out.push(`${name}: the ruling comment's anchor sentence appears ${at.length} times, want 1`);
      else {
        const prose = (i: number): boolean => /^\s*#\s*\S/.test(lines[i] ?? '');
        let lo = at[0] ?? 0;
        let hi = lo;
        while (lo > 0 && prose(lo - 1)) lo--;
        while (hi + 1 < lines.length && prose(hi + 1)) hi++;
        for (let i = lo; i <= hi; i++) allowed.add(i);
      }
    }
    const pwa = name.startsWith('pwa/src/') || name === M79_PWA_CONFIG;
    lines.forEach((line, i) => {
      if (line.includes(M79_DIR) && !allowed.has(i)) {
        out.push(`${name}:${i + 1}: the directory name outside the two ruling comments`);
      }
      if (pwa && line.toLowerCase().includes(M79_NAME)) {
        out.push(`${name}:${i + 1}: the standalone server's name in the PWA`);
      }
    });
  }
  return out;
}

/** The scanned files as git lists them (tracked, plus untracked and not ignored), text only. */
function m79Files(): Array<readonly [string, string]> {
  const listed = m79Cp.execFileSync(
    'git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...M79_ROOTS, M79_PWA_CONFIG],
    { cwd: ccrcRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const out: Array<readonly [string, string]> = [];
  for (const name of new Set(listed.split('\0').filter((n) => n !== ''))) {
    const abs = m79Path.join(ccrcRoot, name);
    if (!m79Fs.existsSync(abs) || !m79Fs.statSync(abs).isFile()) continue;
    const bytes = m79Fs.readFileSync(abs);
    if (bytes.includes(0)) continue;
    out.push([name, bytes.toString('utf8')]);
  }
  return out;
}

m79Vitest.describe('M7.9: the tree does not know a standalone docs server', () => {
  const files = m79Files();
  const textOf = (name: string): string => files.find(([n]) => n === name)?.[1] ?? '';
  const swapped = (name: string, text: string): Array<readonly [string, string]> =>
    files.map(([n, t]) => [n, n === name ? text : t] as const);
  /** The violations a planted copy adds over the real tree's own, so each CONTROL proves the scanner alone. */
  const added = (planted: ReadonlyArray<readonly [string, string]>): string[] => {
    const base = new Set(m79Scan(files));
    return m79Scan(planted).filter((v) => !base.has(v));
  };

  m79Vitest.it('reaches every root, and both ruling comments carry the directory needle', () => {
    const names = files.map(([n]) => n);
    for (const want of [
      'ccd/ccrc', 'ccd/ccrc-doctor-checks', 'deploy/deploy.sh', 'server/src/index.ts', 'pwa/src/app.tsx',
      'pwa/src/lib/sw-denylist.ts', 'agent/src/server.ts', 'shared/docs.ts', M79_PWA_CONFIG,
    ]) m79Vitest.expect(names, want).toContain(want);
    for (const ruled of M79_RULINGS.keys()) m79Vitest.expect(textOf(ruled), ruled).toContain(M79_DIR);
  });

  m79Vitest.it('the shipped source is clean', () => {
    m79Vitest.expect(m79Scan(files)).toEqual([]);
  });

  m79Vitest.it('CONTROL: the old sw-denylist comment line, planted in a copy of the scanned text, is a hit', () => {
    const swFile = 'pwa/src/lib/sw-denylist.ts';
    const old = '// a ' + M79_NAME + ' at `/docs` and a preview at `/fleet` behind the same';
    const n = textOf(swFile).split('\n').length;
    m79Vitest.expect(added(swapped(swFile, textOf(swFile) + '\n' + old)))
      .toEqual([`${swFile}:${n + 1}: the standalone server's name in the PWA`]);
    const cfgN = textOf(M79_PWA_CONFIG).split('\n').length;
    m79Vitest.expect(added(swapped(M79_PWA_CONFIG, textOf(M79_PWA_CONFIG) + '\n// a Doc' + 'Server')))
      .toEqual([`${M79_PWA_CONFIG}:${cfgN + 1}: the standalone server's name in the PWA`]);
  });

  m79Vitest.it('CONTROL: the directory needle outside the ruling paragraph is a hit, inside it is not', () => {
    const dep = 'deploy/deploy.sh';
    const depN = textOf(dep).split('\n').length;
    m79Vitest.expect(added(swapped(dep, textOf(dep) + '\nSKIP="$HOME/.' + M79_DIR + '"')))
      .toEqual([`${dep}:${depN + 1}: the directory name outside the two ruling comments`]);
    const ccrc = 'ccd/ccrc';
    const lines = textOf(ccrc).split('\n');
    const at = lines.findIndex((l) => l.includes(M79_RULINGS.get(ccrc) ?? '\0'));
    m79Vitest.expect(at, 'the anchor sentence is in ccd/ccrc').toBeGreaterThanOrEqual(0);
    // One more line of the same paragraph is still inside it.
    const inside = [...lines.slice(0, at + 1), '    # see ~/.' + M79_DIR, ...lines.slice(at + 1)].join('\n');
    m79Vitest.expect(added(swapped(ccrc, inside))).toEqual([]);
    // The same line split off by a bare `#` is a paragraph of its own, so it is outside.
    const past = [...lines.slice(0, at), '    # see ~/.' + M79_DIR, '    #', ...lines.slice(at)].join('\n');
    m79Vitest.expect(added(swapped(ccrc, past)))
      .toContain(`${ccrc}:${at + 1}: the directory name outside the two ruling comments`);
  });

  m79Vitest.it('CONTROL: a ruling comment whose anchor sentence moved or doubled is a hit, never a silent pass', () => {
    const doctor = 'ccd/ccrc-doctor-checks';
    const anchor = M79_RULINGS.get(doctor) ?? '\0';
    m79Vitest.expect(added(swapped(doctor, textOf(doctor).replace(anchor, 'NO SPECIAL CASE'))))
      .toContain(`${doctor}: the ruling comment's anchor sentence appears 0 times, want 1`);
    m79Vitest.expect(added(swapped(doctor, textOf(doctor) + '\n# ' + anchor)))
      .toContain(`${doctor}: the ruling comment's anchor sentence appears 2 times, want 1`);
    m79Vitest.expect(added(files.filter(([n]) => n !== doctor))).toEqual([`${doctor}: not scanned`]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails.** Foreground, Bash timeout 600000 ms.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  1 failed | 49 passed (50)`. The red is `M7.9: the tree does not know a standalone docs server > the shipped source is clean`, received exactly:

```text
+   "pwa/src/lib/sw-denylist.ts:10: the standalone server's name in the PWA",
+   "pwa/vite.config.ts:55: the standalone server's name in the PWA",
```

The four other M7.9 cases are green already: the vacuity case (every root reached, both ruling comments carry the directory needle) and the three CONTROLs, which compare a planted copy against the real tree's own violations and so prove the scanner whatever the tree holds. No hit in `ccd/`, `deploy/`, `server/src`, `agent/src` or `shared/`: the directory needle's only occurrences are inside the two ruling paragraphs (measured at planning: `ccd/ccrc` lines 4564-4573 and `ccd/ccrc-doctor-checks` lines 5121-5137, both located by anchor sentence, never by number).

- [ ] **Step 5: Implement the refusal and the in-place prose in `pwa/src/lib/sw-denylist.ts`.** Four Find/Replace edits.

Edit 1, the header's co-tenant paragraph (six lines stay six; the reference box's server sentence and its proxy go):

Find (lines 9-14):

```ts
// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. The reference box happens to put
// a docserver at `/docs` and a preview at `/fleet` behind the same
// `tailscale serve`; a release tarball installed by a stranger has neither, and
// shipping their paths as a built-in would be one operator's reverse-proxy
// layout compiled into everybody's service worker. So they move to a
// BUILD-TIME knob: whoever builds the bundle knows what else is on that origin.
```

Replace with:

```ts
// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. A box may put a wiki at `/wiki`
// and a preview at `/fleet` behind the same reverse proxy; a release tarball
// installed by a stranger has neither, and shipping their paths as a built-in
// would be one operator's reverse-proxy layout compiled into everybody's
// service worker. So they move to a BUILD-TIME knob: whoever builds the bundle
// knows what else is on that origin.
```

Edit 2, the import (after the header comment, before `escapePath`):

Find (lines 18-20):

```ts
// is installed — so it looks like an intermittent fault in the OTHER app.

/** Escape a literal path segment for embedding in a RegExp. */
```

Replace with:

```ts
// is installed — so it looks like an intermittent fault in the OTHER app.

import { DOCS_PAGE_PREFIX } from '../../../shared/docs';

/** Escape a literal path segment for embedding in a RegExp. */
```

Edit 3, the docstring's examples become `/wiki` forms plus one sentence that `/docs` is ccrc's own and refused (the docstring stays 14 lines):

Find (lines 28-37):

```ts
 * @param extra comma-separated absolute paths that belong to something else on
 *   this origin (`CCRC_SW_DENYLIST`, e.g. `"/docs,/fleet"`). Empty, absent, or
 *   all-blank yields just ccrc's own two — which is the correct default for an
 *   origin ccrc has to itself.
 *
 * Each extra path matches the path itself and everything under it (`/docs`,
 * `/docs/`, `/docs/a/b`), and NOT a sibling that merely starts the same way
 * (`/docsearch` stays ccrc's). Entries are accepted with or without a leading
 * slash and trailing slashes are ignored, because a knob that silently does
 * nothing when you write `docs` instead of `/docs` is worse than no knob.
```

Replace with:

```ts
 * @param extra comma-separated absolute paths that belong to something else on
 *   this origin (`CCRC_SW_DENYLIST`, e.g. `"/wiki,/fleet"`). Empty, absent, or
 *   all-blank yields just ccrc's own two, the default for an origin ccrc has to
 *   itself. `/docs` is ccrc's own (its Docs pages): an entry covering it throws.
 *
 * Each extra path matches the path itself and everything under it (`/wiki`,
 * `/wiki/`, `/wiki/a/b`), and NOT a sibling that merely starts the same way
 * (`/wikis` stays ccrc's). Entries are accepted with or without a leading
 * slash and trailing slashes are ignored, because a knob that silently does
 * nothing when you write `wiki` instead of `/wiki` is worse than no knob.
```

Edit 4, the refusal, after the existing normalisation and before the return:

Find (lines 44-45):

```ts
    .filter((s) => s !== '/');
  return [...own, ...paths.map((p) => new RegExp(`^${escapePath(p)}(/|$)`))];
```

Replace with:

```ts
    .filter((s) => s !== '/');
  // Judged on the NORMALISED entry, so ` /docs/ `, `docs` and `//docs` are all
  // refused; `/docsy` is a sibling, not under the prefix, and builds.
  const docs = paths.find((p) => p === DOCS_PAGE_PREFIX || p.startsWith(`${DOCS_PAGE_PREFIX}/`));
  if (docs !== undefined) {
    throw new Error(
      `CCRC_SW_DENYLIST entry ${docs} covers ${DOCS_PAGE_PREFIX}, ccrc's own Docs pages; a service worker that refuses them the app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from ~/.ccrc/deploy.env on the deploying machine) and build again.`,
    );
  }
  return [...own, ...paths.map((p) => new RegExp(`^${escapePath(p)}(/|$)`))];
```

`paths` is the normalised list (trimmed, trailing slashes stripped, leading slashes collapsed to one, `/` dropped), so the verdict is the normalised entry's and the message names it. The `/` after the prefix is what keeps `/docsy` and `/docs-archive` buildable ("Only the Docs prefix is refused"). `/docs` is never added to `own` (C5).

Run: `( cd pwa && ./node_modules/.bin/vitest run test/sw-denylist.test.ts ) && wc -l pwa/src/lib/sw-denylist.ts && awk 'NR<=19 && /^\/\//' pwa/src/lib/sw-denylist.ts | wc -l && awk '/^\/\*\*$/{f=1;n=0} f{n++} /^ \*\/$/{if(f){print n; f=0}}' pwa/src/lib/sw-denylist.ts`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed (16)`, `Type Errors  no errors`; then `56`, `18`, `14` (the header and the docstring keep Step 0's line counts).

- [ ] **Step 6: The prose that moves with it: `pwa/vite.config.ts` and `deploy/deploy.sh`, in place.**

In `pwa/vite.config.ts` (seven lines stay seven; it now points at `deploy/deploy.sh`'s header instead of `deploy/ccrc.env.example`, which never mentions the knob, and spells no `^\/docs`, which `sw-denylist.test.ts`'s `hardcodes no co-tenant path of its own` refuses):

Find (lines 54-60):

```ts
        // CO-TENANTS ARE A BUILD-TIME KNOB, not a built-in list. `/docs` (a
        // docserver) and `/fleet` (a preview) are what the REFERENCE box puts
        // behind the same proxy; a stranger's install has neither, and baking
        // those paths in would ship one operator's reverse-proxy layout inside
        // everybody's service worker. The box that has co-tenants sets
        // CCRC_SW_DENYLIST in its own (gitignored) env — see
        // deploy/ccrc.env.example.
```

Replace with:

```ts
        // CO-TENANTS ARE A BUILD-TIME KNOB, not a built-in list. A box may put
        // a wiki at `/wiki` and a preview at `/fleet` behind the same proxy; a
        // stranger's install has neither, and baking those paths in would ship
        // one operator's reverse-proxy layout inside everybody's service worker.
        // The box that has co-tenants sets CCRC_SW_DENYLIST on the deploying
        // machine — see deploy/deploy.sh's header. An entry covering `/docs`,
        // ccrc's own Docs pages, fails the build (src/lib/sw-denylist.ts).
```

In `deploy/deploy.sh`, the header example (line 28; `wiki` is as long as `docs`, so the column of `# optional` does not move):

Find (line 28):

```bash
#     CCRC_SW_DENYLIST=/docs,/fleet      # optional: paths on the box's origin
```

Replace with:

```bash
#     CCRC_SW_DENYLIST=/wiki,/fleet      # optional: paths on the box's origin
```

And the co-tenant sentence (line 41, refinement (u)):

Find (line 41):

```bash
# it, and their co-tenant at /docs starts answering with the ccrc shell on
```

Replace with:

```bash
# it, and their co-tenant at /wiki starts answering with the ccrc shell on
```

Both `deploy.sh` edits sit above the `:508-648` region the spec and plans cite by line, and keep the line count, so no cited anchor shifts. `export CCRC_SW_DENYLIST="${CCRC_SW_DENYLIST:-}"` (line 45) is not touched.

- [ ] **Step 7: Run the task's tests to verify they pass.** Foreground, Bash timeout 600000 ms.

Run: `( cd pwa && ./node_modules/.bin/vitest run test/sw-denylist.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed (16)`, `Type Errors  no errors` (Step 0's 11 plus 5).

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/deploy-coordinates.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  63 passed (63)` (50 + 13; Step 0's 58 plus 5).

Run: `( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'citation' )`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed | 437 skipped (450)` at planning (the citation audit's census, `deploy/deploy.sh` among it, unchanged: no cited line moved).

- [ ] **Step 8: The prose invariants, judged net against `BASE`.** From the worktree root (`BASE` is the commit Task 1 Step 0 recorded in the SDD ledger).

Run: `for rev in "$BASE" HEAD-WORKTREE; do show() { if [ "$rev" = HEAD-WORKTREE ]; then cat "$1"; else git show "$rev:$1"; fi; }; echo "$(show pwa/src/lib/sw-denylist.ts | awk 'NR<=19 && /^\/\//' | wc -l) $(show pwa/src/lib/sw-denylist.ts | awk '/^\/\*\*$/{f=1;n=0} f{n++} /^ \*\/$/{if(f){print n; f=0}}') $(show pwa/vite.config.ts | awk '/CO-TENANTS ARE A BUILD-TIME KNOB/{f=1} /globPatterns:/{f=0} f' | wc -l) $(show deploy/deploy.sh | wc -l)"; done; git diff --numstat "$BASE" -- deploy/deploy.sh; git diff "$BASE" -- deploy/deploy.sh | grep -c '^[-+]export' || true; git diff "$BASE" -- server/test/docs-parity.test.ts | grep -c '^-[^-]' || true; git diff "$BASE" -- pwa/vite.config.ts | grep -c "^[-+].*navigateFallbackDenylist" || true`
Expected: `18 14 7 1290` twice (the header, the docstring, the vite comment and `deploy.sh` keep their line counts), then `2	2	deploy/deploy.sh` (two lines, in place), `0` (the export line is byte-identical), `0` (`docs-parity.test.ts` lost no line: append only) and `0` (the `navigateFallbackDenylist` line is byte-identical).

- [ ] **Step 9: The guard suites.** Foreground, Bash timeout 600000 ms each. `typecheck-tests` and `contrast.test.ts`'s spawned-gate cases are known load flakes: a red in one is re-run alone before it is called broken.

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK` (the `../../../shared/docs` import resolves under the PWA's own `tsc`; `shared/docs.ts` imports nothing, so no host global enters the config bundle).

Run: `( cd pwa && ./node_modules/.bin/vitest run )`
Expected: `Test Files  126 passed (126)`, `Tests  3953 passed (3953)` at planning (Task 8's 126 files and 3 948 tests, plus this task's 5 cases; re-derive the base at Step 0's state if another programme moved it). Every file loads `vite.config.ts`, so this run is also the proof that the config still loads with the knob unset.

Run: `( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  523 passed (523)` (not edited; the import is a use, not a second declaration, and M7.3's TS half in `docs-parity.test.ts` still counts one `DOCS_PAGE_PREFIX =`).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)`; its `pwa/ is clean under tsconfig.json` case compiles the edited test and source, and `server/test/ is clean` compiles the appended block.

Run: `git add pwa/src/lib/sw-denylist.ts pwa/test/sw-denylist.test.ts pwa/vite.config.ts deploy/deploy.sh server/test/docs-parity.test.ts && git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/source-bytes.test.ts test/topology-clean.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  57 passed (57)` (both read `git ls-files`, so the files are staged first; the fixtures name only `/wiki`, `/fleet`, `/docs`, `/docsy`, `/docs-archive`, `docsearch/`, `/api/docs/p/tree`, `/docs/p/specs/a.md`, the knob's own name and the needle parts; no host, user or project).

No `ccd/ccd` edit, so no restamp.

- [ ] **Step 10: The build gate (X1 re-measured), in a scratch COPY, never in the worktree.** The build writes `../server/dist-pwa`, so it runs in a copy of the staged tree:

```bash
C=$(mktemp -d) && git archive "$(git write-tree)" | tar -x -C "$C" && git -C "$C" init -q \
  && ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules" && ln -s "$PWD/server/node_modules" "$C/server/node_modules"
( cd "$C/pwa" && CCRC_SW_DENYLIST='/wiki,/docs' npm run build > "$C/refused.out" 2> "$C/refused.err"; echo rc=$? )
grep -c "CCRC_SW_DENYLIST entry /docs covers /docs, ccrc's own Docs pages" "$C/refused.err"
( cd "$C/pwa" && CCRC_SW_DENYLIST='/wiki,/docsy' npm run build > "$C/built.out" 2>&1; echo rc=$? )
grep -o 'denylist:\[[^]]*\]' "$C/server/dist-pwa/sw.js"
rm -rf "$C"
```

Expected: `rc=1`, then `1` (the refusal's sentence, naming the normalised `/docs`, on stderr: `vite.config.ts` calls `swDenylist` at config load, so `vite build` never starts), then `rc=0` and `denylist:[/^\/api\//,/^\/ws\//,/^\/wiki(\/|$)/,/^\/docsy(\/|$)/]` (a sibling builds and is denied like any co-tenant; one list). Record both rcs in the SDD ledger as X1's re-measurement on the real change. `deploy.sh` runs under `set -euo pipefail` and builds before it ships, so a refused build ships nothing.

- [ ] **Step 11: Commit.**

```bash
git add pwa/src/lib/sw-denylist.ts pwa/test/sw-denylist.test.ts pwa/vite.config.ts deploy/deploy.sh server/test/docs-parity.test.ts
git status --porcelain | grep -v '^M  ' ; git diff --cached --name-only | wc -l
git commit -m "pwa: the build refuses a CCRC_SW_DENYLIST entry covering /docs (docs W4)" \
  -m "swDenylist imports DOCS_PAGE_PREFIX from shared/docs.ts and throws spec 7.3's sentence on the first normalised entry equal to it or under it, so vite.config fails at config load and deploy.sh ships nothing; /docsy and /docs-archive still build, and /docs is never on the worker's own list. sw-denylist.test.ts moves its co-tenant examples to /wiki and pins M7.2 (seven spellings, the siblings, the default, C5, and the import)." \
  -m "The prose moves with it, each block in place with its line count: sw-denylist.ts's header and docstring, vite.config.ts's co-tenant comment (now pointing at deploy.sh's header) and deploy.sh's two header lines. docs-parity.test.ts appends M7.9: the standalone server's directory name only inside the two ruling comments, located by anchor sentence, and its name nowhere in the PWA, with three controls and its known evasions listed." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing (only modifications are staged) and the count is `5`.

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree; `pkg` is the package the `tests` run in, so rows M6-M8 mutate a PWA or deploy file and run the SERVER test that scans it; `old` is unique in its file at this task's state; no earlier row is re-anchored, since no earlier task's row anchors on these five files):

```json
[
 {
  "id": "W4-T9-M1",
  "pkg": "pwa",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "  if (docs !== undefined) {\n    throw new Error(\n",
  "new": "  if (docs !== undefined) {\n    void new Error(\n",
  "tests": [
   "test/sw-denylist.test.ts"
  ],
  "red": "pwa sw-denylist: 1 failed | 15 passed (16) — 'throws, naming the normalised entry and CCRC_SW_DENYLIST, for every spelling of the Docs prefix' (`\"/docs\": expected false to be true`)"
 },
 {
  "id": "W4-T9-M2",
  "pkg": "pwa",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "  const docs = paths.find(",
  "new": "  const docs = (extra ?? '').split(',').find(",
  "tests": [
   "test/sw-denylist.test.ts"
  ],
  "red": "pwa sw-denylist: 1 failed | 15 passed (16) — 'throws, naming the normalised entry and CCRC_SW_DENYLIST, for every spelling of the Docs prefix' (`\"docs\": expected false to be true`: the raw entry escapes the comparison)"
 },
 {
  "id": "W4-T9-M3",
  "pkg": "pwa",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "p.startsWith(`${DOCS_PAGE_PREFIX}/`)",
  "new": "p.startsWith(DOCS_PAGE_PREFIX)",
  "tests": [
   "test/sw-denylist.test.ts"
  ],
  "red": "pwa sw-denylist: 1 failed | 15 passed (16) — 'refuses only the Docs prefix: a sibling that merely starts the same way builds' (`/docsy is not under /docs: expected true to be false`)"
 },
 {
  "id": "W4-T9-M4",
  "pkg": "pwa",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "  const own = [/^\\/api\\//, /^\\/ws\\//];\n",
  "new": "  const own = [/^\\/api\\//, /^\\/ws\\//, /^\\/docs\\//];\n",
  "tests": [
   "test/sw-denylist.test.ts"
  ],
  "red": "pwa sw-denylist: 5 failed | 11 passed (16) — 'default: ccrc’s own truth only — /api/ and /ws/', 'appends co-tenant prefixes after the built-ins', 'refuses only the Docs prefix: ...' (`a sibling entry claimed a Docs page`), 'the default does not deny a Docs page, and does deny the Docs API' (`/docs/ is ccrc's own Docs page: expected true to be false`) and '/docs is never on the worker's own list (C5): ...'"
 },
 {
  "id": "W4-T9-M5",
  "pkg": "pwa",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "(p) => p === DOCS_PAGE_PREFIX || p.startsWith(`${DOCS_PAGE_PREFIX}/`)",
  "new": "(p) => p === '/docs' || p.startsWith(`${DOCS_PAGE_PREFIX}/`)",
  "tests": [
   "test/sw-denylist.test.ts"
  ],
  "red": "pwa sw-denylist: 1 failed | 15 passed (16) — 'reads the prefix from shared/docs.ts rather than spelling it' (`a quoted /docs literal: the prefix has one home`)"
 },
 {
  "id": "W4-T9-M6",
  "pkg": "server",
  "file": "pwa/src/lib/sw-denylist.ts",
  "old": "// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. A box may put a wiki at `/wiki`\n// and a preview at `/fleet` behind the same reverse proxy; a release tarball\n",
  "new": "// CO-TENANTS ARE NOT CCRC'S BUSINESS TO KNOW. The reference box happens to put\n// a docserver at `/docs` and a preview at `/fleet` behind the same\n",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 1 failed | 49 passed (50) — M7.9 'the shipped source is clean' (received `[\"pwa/src/lib/sw-denylist.ts:10: the standalone server's name in the PWA\"]`)"
 },
 {
  "id": "W4-T9-M7",
  "pkg": "server",
  "file": "deploy/deploy.sh",
  "old": "export CCRC_SW_DENYLIST=\"${CCRC_SW_DENYLIST:-}\"\n",
  "new": "export CCRC_SW_DENYLIST=\"${CCRC_SW_DENYLIST:-}\"\nDOCS_SKIP=\"$HOME/.claude\u002ddocserver\"\n",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 1 failed | 49 passed (50) — M7.9 'the shipped source is clean' (received `[\"deploy/deploy.sh:46: the directory name outside the two ruling comments\"]`)"
 },
 {
  "id": "W4-T9-M8",
  "pkg": "server",
  "file": "pwa/vite.config.ts",
  "old": "        // a wiki at `/wiki` and a preview at `/fleet` behind the same proxy; a\n",
  "new": "        // a wiki at `/wiki` (a docserver) and a preview at `/fleet` behind the same proxy; a\n",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 1 failed | 49 passed (50) — M7.9 'the shipped source is clean' (received `[\"pwa/vite.config.ts:55: the standalone server's name in the PWA\"]`)"
 }
]
```

---

### Task 10: ccrc doctor's docs-sw: the check, its one prefix, the fixtures that plant the bundle, the re-derived pins, M7.3's doctor half; then the Deviations found step

**Model routing:** `sonnet`, effort `high`. The check is one bash function with builtins only; the value is in the two fleet evidences, the occurrence count, the ERE's four alternatives, and in every fixture that runs the closing doctor carrying the same `sw.js`. Every count below was measured on the shared scratch tree at Task 9's state (BEFORE this task) and at this task's end state; the mutations in a separate copy.

**Spec rows:** M7.3 (doctor half: one `CCRC_DOCS_PAGE_PREFIX=` in `ccd/ccrc-doctor-checks`, equal to `DOCS_PAGE_PREFIX`), M7.5 (`docs-sw`: a `/docs` entry FAIL, `/docs/x` FAIL, `/docsy` PASS, the default PASS, two denylists WARN, absent FAIL, role `fleet` SKIP; mutations: delete the match, anchor it so `/docs/x` escapes, widen it so `/docsy` fails) and M7.6 (`docs-sw` in the table and as a function; `HEALTHY_SKIPS` unchanged). Section 7.2's `docs-sw` and fixtures paragraphs. Refinements (c) (occurrences counted with builtins, ERE through `[[ =~ ]]`), (d) (either fleet evidence SKIPs), (s) (`docs-sw` joins the table's last line in place; the prefix and the function are appended at the end of the file) and (t) (every fixture that runs the closing doctor plants the bundle; the pins that gain a SKIP are re-derived in place). Step 8 is the ONE step of this plan that defines deviations: refinements (a), (b), (c) and (d).

**Files:**
- Create: `server/test/swFixtures.ts` (24 lines): `SW_DENYLIST_DEFAULT` and `swJs(denylist?)`, imports nothing.
- Modify: `ccd/ccrc-doctor-checks` — one in-place line (the table's last data line, line 213, a hint: `models codex docs history` gains `docs-sw` and its comment's count word becomes `five`) and one end-of-file append after `_check_history`'s closing `}` (line 7376): the header comment, `CCRC_DOCS_PAGE_PREFIX='/docs'` and `_check_docs-sw`. 7376 lines become 7497. The file stays mode 100755.
- Modify: `server/test/ccrc-doctor.test.ts` — no line above `healthy()`'s first line (`function healthy(prefix: string): string {`, line 1040) moves: (1) inside `healthy()`, after the `docs` stub (lines 1227-1228), the `sw.js` plant (5 lines); (2) after `import { PRELOADS, preloadOptions } from './historyHelpers.js';` (line 1250, the file's mid-file import block, below every line another file cites) one import with its two-line comment; (3) the env-less fleet-role case's summary pin (line 3343), its numeral `5` becomes `6` in place, measured in Step 4; (4) the `docs-sw` describe appended after the last line (13681). 13681 lines become 13912.
- Modify: `server/test/installTreeFixture.ts` — the header's import sentence (lines 11-13, three lines become four), the import comment's `ONE` (line 24, in place), one import after `containedTools.js`'s (line 26) and one `TREE_STUBS` entry after `'server/dist-pwa/index.html'` (line 253). 364 lines become 371.
- Modify: `server/test/ccrc-update.test.ts` — one import after `docsIndexFixtures.js`'s (line 61) and the `sw.js` write in `fullTree` after the `index.html` write (lines 842-844). 12969 lines become 12972.
- Modify: `server/test/ccrc-install.test.ts` — `BASE_LIVE_SHAPE` (lines 8292-8520): each of its three doctor maps gains `"docs-sw": "SKIP"` after `"docs": "PASS"` (lines 8306, 8356, 8476), and its docstring gains the four-line re-measurement record after line 8279. 8924 lines become 8931. (Step 4 measured that the live-shape golden names every table check, so a new check moves it, as `docs`, `history` and `model-default` each did.)
- Modify: `server/test/docs-parity.test.ts` — one end-of-file append after line 591 (Task 9's M7.9 block): M7.3's doctor half. 591 lines become 659. Nothing above line 591 changes (the file's header: "APPEND ONLY").
- Modify (Step 8 only): `docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`, this plan — `## Deviations found` appended after its last line.
- Test: `server/test/ccrc-doctor.test.ts`, `server/test/docs-parity.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-install-graphify.test.ts`, `server/test/ccrc-update.test.ts`; guards: `docs-budget`, `macos-platform`, `pools-existence-pairing`, `runbook-holds`, `routing-env-census`, `single-definition`, `auth-passkey`, `node-floor`, `pool-name-parity`, `pool-tag-parity`, `source-bytes`, `ccrc-containment` (it reads `installTreeFixture.ts`'s import list), `typecheck-tests`, `topology-clean`, then `deviation-refs` and `dtbd` in Step 8.

Every Find block below is quoted from its file as Task 9 left it (Tasks 1-9 edit none of these files except `docs-parity.test.ts`, whose Task 9 block this task appends below) and is unique in it; line numbers are hints. If a Find block is absent or not unique, stop and put an ask to the coordinator. No Find or Replace block spells a `D-` number: the blocks are chosen around the lines that carry one.

**Interfaces:**
- Consumes (bash, `ccd/ccrc` and the doctor file at `BASE`): `_dr_pass`, `_dr_warn`, `_dr_fail`, `_dr_skip` (verdict helpers: return 0, 2, 1, 3; WARN and FAIL print the `  remedy:` line themselves), `_box_env_value <file> <key>`, `_dr_unit_file <unit>`, `$BOX_ENV_FILE`, `$BOX_TREE_DIR` (`$HOME/ccrc`, `ccd/ccrc`), `$CCRC_UNIT_DIR`. TypeScript: `DOCS_PAGE_PREFIX` (`shared/docs.ts`), already imported at `docs-parity.test.ts`'s module scope with `describe`, `it`, `expect`, `readFileSync`, `path` and `ccrcRoot`; in `ccrc-doctor.test.ts`: `healthy`, `runDoctor`, `doctorEnv`, `tableNames`, `lineFor`, `writeCcrcEnv`, `writeUnitFile`, `removeUnitFile`, `shq`, `BASH`, `CHECKS_SRC`, `HEALTHY_SKIPS`, `Result`.
- Produces, `ccd/ccrc-doctor-checks`: `CCRC_DOCS_PAGE_PREFIX='/docs'` (one top-level line near the end of the file) and `_check_docs-sw()` (closes with a bare `}` at column 0; prints exactly one verdict line, plus its remedy for WARN and FAIL, and returns the helper's code: PASS 0, FAIL 1, WARN 2, SKIP 3).
- Produces, `server/test/swFixtures.ts`: `export const SW_DENYLIST_DEFAULT: string` (= `denylist:[/^\/api\//,/^\/ws\//]`) and `export function swJs(denylist?: string): string` (a one-line workbox-shaped `sw.js` ending in `\n` whose navigation route carries `{<denylist>}`; `SW_DENYLIST_DEFAULT` when omitted).
- Produces, tests (module-private): in `server/test/docs-parity.test.ts`, `m73Doctor(text: string, prefix: string): { values: string[]; quoted: number; body: string }` and the constants `M73_DOCTOR`, `M73_ASSIGN`; in `server/test/ccrc-doctor.test.ts`, inside the `docs-sw` describe, `knob`, `list`, `swPath`, `plant`, `runDocsSw` and `lines`.

The verdict lines `_check_docs-sw` prints (`<sw>` is `$BOX_TREE_DIR/server/dist-pwa/sw.js`, `<p>` the prefix):
- `SKIP docs-sw: this box records CCRC_ROLE=fleet, so it serves no PWA bundle and no service worker of its own`
- `SKIP docs-sw: this box runs no ccrc server (its units are ccrc-agent.service and no ccrc.service), so it serves no PWA bundle and no service worker of its own`
- `FAIL docs-sw: no service worker at <sw>, so this box serves its PWA bundle without the file every browser installs` / `  remedy: ccrc update --force`
- `FAIL docs-sw: <sw> is there but is not a file this check can read, so what it refuses was not measured` / `  remedy: ccrc update --force`
- `WARN docs-sw: <sw> carries <n> denylists, and this check knows the shape workbox emits (exactly one, closed by ]}), so whether it refuses <p> was not measured` (or `carries 1 denylist that never closes`) / `  remedy: hard-reload <p>/ in a browser and check that the Docs screen renders`
- `FAIL docs-sw: the installed service worker refuses the app shell to <p>; Docs pages break on a hard load and offline (<sw> denies <entries, joined by ", ">)` / `  remedy: remove <p> from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update`
- `PASS docs-sw: <sw> keeps <p> on the app shell: its one denylist holds <k> entries (<list>), none of them <p> or under it`

No SKIP names a path; every other line names exactly one, the worker it read.

- [ ] **Step 0: Confirm the state, claim the files, record the counts.** From the worktree root, foreground.

Run: `git diff --quiet HEAD -- ccd server/test docs && grep -qF '  models codex docs history   # four entries on one line: every line below is cited by number elsewhere' ccd/ccrc-doctor-checks && ! grep -q 'docs-sw\|CCRC_DOCS_PAGE_PREFIX' ccd/ccrc-doctor-checks && test ! -e server/test/swFixtures.ts && grep -q 'M7.9: the tree does not know a standalone docs server' server/test/docs-parity.test.ts && ! grep -q 'M7.3 (doctor half)' server/test/docs-parity.test.ts && test "$(grep -c '^## Deviations found$' docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md)" -eq 1 && echo T10-STATE-OK`
Expected: `T10-STATE-OK` (Task 9 is committed, the tree is clean, the table holds four names on its last line, nothing of this task exists yet, and the plan has no deviation section: its one `## Deviations found` line is the one inside Step 8's template below). If it does not print, stop and put an ask to the coordinator.

Take the claims on `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-install.test.ts` and `server/test/docs-parity.test.ts` (worker skill clause 11, `~/.local/bin/ccrc-api claims take`). The ledger's note on claim 1072 (run 302, on `ccd/ccrc-doctor-checks`) is RE-MEASURED here, not assumed ended: a 409 names the holder; mail it through the response's `mailHint` and do not edit that file until the claim ends or the two coordinators confirm a scoped agreement (this task edits one table line in place and appends at the end of the doctor file; in the test files it edits `healthy()`, one pin numeral, one golden and appends). Release all six after Step 7's commit (Step 8 edits only the plan).

Run: `wc -l ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/installTreeFixture.ts server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/docs-parity.test.ts && grep -n '5 + HEALTHY_SKIPS\|const HEALTHY_SKIPS' server/test/ccrc-doctor.test.ts && grep -c '"docs": "PASS",$' server/test/ccrc-install.test.ts`
Expected: `7376`, `13681`, `364`, `12969`, `8924` and `591` lines; then `1500:const HEALTHY_SKIPS = (process.platform === 'darwin' ? 2 : 0) + 5;` and `3343:      new RegExp(...${5 + HEALTHY_SKIPS} skipped...)`, the env-less fleet-role case's pin, the one fleet-role summary pin that reads `HEALTHY_SKIPS` and builds a box with fleet evidence (every other `HEALTHY_SKIPS` pin reads `healthy()`, a server box, where `docs-sw` PASSes); then `3` (the live-shape golden's three doctor maps). If another programme has moved any of these, re-derive: Step 4 measures what each pin must become, and nothing here is copied.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/docs-budget.test.ts ) && ( cd server && ./node_modules/.bin/vitest list test/ccrc-doctor.test.ts | wc -l )`
Expected: `Test Files  2 passed (2)`, `Tests  69 passed (69)` (50 + 19), then `873` (the doctor file's non-skipped cases on Linux; 15 more are platform- or root-skipped, 888 in all). Step 4's counts are these plus 4 and plus 16.

- [ ] **Step 1: Write the failing tests.** Four edits, then the red run.

(a) Create `server/test/swFixtures.ts` with exactly this content:

```ts
// swFixtures.ts — the ONE fixture text for the PWA bundle's service worker, `server/dist-pwa/sw.js` (native Docs
// reader W4, spec 2026-10-01 section 7.2). `ccrc doctor`'s `docs-sw` check measures the installed worker, and every
// fixture that runs the closing doctor plants one: `ccrc-doctor.test.ts`'s `healthy()`, `installTreeFixture.ts`'s
// `TREE_STUBS` (the install suites) and `ccrc-update.test.ts`'s staged tree. One text, so the three cannot drift
// apart or away from what a build emits.
//
// THE SHAPE IS A REAL BUILD'S: workbox emits `sw.js` as ONE minified line, and the navigation route carries the list
// as `{denylist:[...]}` with each entry printed as a RegExp literal. `SW_DENYLIST_DEFAULT` is that list with no
// `CCRC_SW_DENYLIST` set (`pwa/src/lib/sw-denylist.ts`'s two built-ins); W4 Task 10 Step 5 compared it with a
// scratch `vite build` and recorded the result.
//
// Imports nothing, so `installTreeFixture.ts` stays vitest-free (its header) when it imports this file.

/** The denylist a build with no `CCRC_SW_DENYLIST` prints into `sw.js`: `/api/` and `/ws/`, nothing else. */
export const SW_DENYLIST_DEFAULT = 'denylist:[/^\\/api\\//,/^\\/ws\\//]';

/** A one-line, workbox-shaped `sw.js` whose navigation route carries `denylist` verbatim (the `denylist:[...]`
 *  text, or any text a test wants in that slot); `SW_DENYLIST_DEFAULT` when omitted. */
export function swJs(denylist: string = SW_DENYLIST_DEFAULT): string {
  return 'define(["./workbox-fixture"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),'
    + 'e.precacheAndRoute([{url:"index.html",revision:"fixture"}],{}),e.cleanupOutdatedCaches(),'
    + `e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html"),{${denylist}})),`
    + 'e.registerRoute(/\\/(?:api|ws)\\//,new e.NetworkOnly,"GET")}));\n';
}
```

(b) In `server/test/ccrc-doctor.test.ts`, the import, placed in the file's mid-file import block (its comment there explains why imports sit below the cited lines):

Find (line 1250):

```ts
import { PRELOADS, preloadOptions } from './historyHelpers.js';
```

Replace with:

```ts
import { PRELOADS, preloadOptions } from './historyHelpers.js';
// The PWA bundle's one fixture worker (Docs W4): `healthy()` plants it and the `docs-sw` describe at the end of
// this file measures it. Imported here, below every line another file cites, for the block comment above's reason.
import { SW_DENYLIST_DEFAULT, swJs } from './swFixtures.js';
```

(c) Append this block (it starts with one blank line) at the end of `server/test/ccrc-doctor.test.ts`, after its last line (`});`, line 13681, which closes `ccrc doctor: history — the relay ...`):

```ts

// ── Docs W4 Task 10: `docs-sw`, the installed service worker (spec 2026-10-01 §7.2, M7.5, M7.6) ──────────────
// The server half of the Docs pair: `$BOX_TREE_DIR/server/dist-pwa/sw.js`, the worker both lanes install, must not
// refuse the app shell to `/docs`. The build already refuses such a knob (`pwa/src/lib/sw-denylist.ts`, §7.3); this
// check is the one measurement of the bundle actually installed. Every body below is `swJs()`'s one-line,
// workbox-shaped text, the same text `healthy()`, `TREE_STUBS` and `ccrc-update.test.ts`'s tree plant, so a verdict
// here is a verdict on the shape a real build emits. Each knob entry is printed by `String(new RegExp(...))`, which
// is how a RegExp reaches `sw.js` (`/^\/wiki(\/|$)/`), built as `sw-denylist.ts` builds it.
// The check SKIPs on either fleet evidence `_check_update-exposure` uses, a recorded `CCRC_ROLE=fleet` or a unit
// directory holding `ccrc-agent.service` and no `ccrc.service` (refinement (d)), and counts `denylist:[`
// OCCURRENCES with bash builtins, never lines (refinement (c): workbox's whole worker is one line).
describe('ccrc doctor: docs-sw', () => {
  const knob = (p: string): string => String(new RegExp(`^${p}(/|$)`));
  const list = (...extra: string[]): string =>
    `denylist:[${['/^\\/api\\//', '/^\\/ws\\//', ...extra].join(',')}]`;
  const swPath = (home: string): string => join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js');
  const plant = (home: string, body: string): void => { writeFileSync(swPath(home), body); };
  /** `_check_docs-sw` alone, as `cmd_doctor` runs it: `ccrc` sourced first (its `BOX_TREE_DIR`, `BOX_ENV_FILE`,
   *  `_box_env_value`), then the table, both through the fixture's `<home>/ccrc/ccd` links. */
  const runDocsSw = (home: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_docs-sw`],
    { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const lines = (out: string): string[] => out.split('\n').filter((l) => l !== '');
  const REFUSES = 'the installed service worker refuses the app shell to /docs; Docs pages break on a hard load and offline';
  const REMEDY = "  remedy: remove /docs from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update";
  const SHAPE = 'this check knows the shape workbox emits';
  const SHAPE_REMEDY = '  remedy: hard-reload /docs/ in a browser and check that the Docs screen renders';

  it('the shared fixture text is the one-line, one-denylist shape a build emits', () => {
    expect(SW_DENYLIST_DEFAULT).toBe(list());
    expect(swJs().split('\n')).toEqual([expect.stringContaining(`{${SW_DENYLIST_DEFAULT}}`), '']);
    expect(swJs().split('denylist:[')).toHaveLength(2);
    expect(knob('/docs')).toBe('/^\\/docs(\\/|$)/');
  });

  it('PASSes the default bundle healthy() plants, naming the worker it read and what its list holds', () => {
    const home = healthy('ccrc-doctor-docs-sw-default-');
    expect(readFileSync(swPath(home), 'utf8')).toBe(swJs());
    const r = runDocsSw(home);
    expect(lines(r.stdout), r.stderr).toEqual([
      `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 2 entries (/^\\/api\\//,/^\\/ws\\//), none of them /docs or under it`,
    ]);
    expect(r.code).toBe(0);
  });

  it('FAILs a /docs entry with the spec\'s sentence and remedy, naming the entry', () => {
    const home = healthy('ccrc-doctor-docs-sw-docs-');
    plant(home, swJs(list(knob('/wiki'), knob('/docs'))));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${REFUSES} (${swPath(home)} denies ${knob('/docs')})`,
      REMEDY,
    ]);
    expect(r.code).toBe(1);
  });

  it('FAILs an entry under /docs, and a hand-built one with no end anchor; names every covering entry', () => {
    const home = healthy('ccrc-doctor-docs-sw-under-');
    plant(home, swJs(list(knob('/docs/x'))));
    expect(lines(runDocsSw(home).stdout)[0]).toBe(`FAIL docs-sw: ${REFUSES} (${swPath(home)} denies ${knob('/docs/x')})`);
    plant(home, swJs(list('/^\\/docs\\//', '/^\\/docs/')));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${REFUSES} (${swPath(home)} denies /^\\/docs\\//, /^\\/docs/)`,
      REMEDY,
    ]);
    expect(r.code).toBe(1);
  });

  it('PASSes /docsy and /docs-archive: a sibling that merely starts the same way is not under /docs', () => {
    const home = healthy('ccrc-doctor-docs-sw-sibling-');
    for (const sibling of ['/docsy', '/docs-archive']) {
      plant(home, swJs(list(knob('/wiki'), knob(sibling))));
      const r = runDocsSw(home);
      expect(lines(r.stdout), sibling).toEqual([
        `PASS docs-sw: ${swPath(home)} keeps /docs on the app shell: its one denylist holds 4 entries (/^\\/api\\//,/^\\/ws\\//,${knob('/wiki')},${knob(sibling)}), none of them /docs or under it`,
      ]);
      expect(r.code, sibling).toBe(0);
    }
  });

  it('WARNs on two denylists on ONE line: occurrences are counted, not lines (refinement (c))', () => {
    const home = healthy('ccrc-doctor-docs-sw-two-');
    plant(home, swJs(`${list()}},{${list(knob('/docs'))}`));
    expect(readFileSync(swPath(home), 'utf8').split('\n')).toHaveLength(2);
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 2 denylists, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    expect(r.code).toBe(2);
  });

  it('WARNs on no denylist at all, and on one that never closes: neither is the shape it knows', () => {
    const home = healthy('ccrc-doctor-docs-sw-none-');
    plant(home, swJs('allowlist:[/./]'));
    expect(lines(runDocsSw(home).stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 0 denylists, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    plant(home, `self.x={denylist:[/^\\/api\\//,${knob('/docs')}\n`);
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `WARN docs-sw: ${swPath(home)} carries 1 denylist that never closes, and ${SHAPE} (exactly one, closed by ]}), so whether it refuses /docs was not measured`,
      SHAPE_REMEDY,
    ]);
    expect(r.code).toBe(2);
  });

  it('FAILs an absent worker with ccrc update --force', () => {
    const home = healthy('ccrc-doctor-docs-sw-absent-');
    rmSync(swPath(home));
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: no service worker at ${swPath(home)}, so this box serves its PWA bundle without the file every browser installs`,
      '  remedy: ccrc update --force',
    ]);
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)('FAILs a worker it cannot read with ccrc update --force, never a WARN', () => {
    const home = healthy('ccrc-doctor-docs-sw-unreadable-');
    chmodSync(swPath(home), 0o000);
    const r = runDocsSw(home);
    chmodSync(swPath(home), 0o644);
    expect(lines(r.stdout)).toEqual([
      `FAIL docs-sw: ${swPath(home)} is there but is not a file this check can read, so what it refuses was not measured`,
      '  remedy: ccrc update --force',
    ]);
    expect(r.code).toBe(1);
  });

  it('SKIPs a box that records CCRC_ROLE=fleet, with no remedy, even with no bundle at all', () => {
    const home = healthy('ccrc-doctor-docs-sw-fleet-role-');
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\nCCRC_FLEET=local\n');
    rmSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true, force: true });
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      'SKIP docs-sw: this box records CCRC_ROLE=fleet, so it serves no PWA bundle and no service worker of its own',
    ]);
    expect(r.code).toBe(3);
  });

  it('SKIPs an env-less box whose units are the fleet role\'s, never FAILs it for a bundle it never had (refinement (d))', () => {
    const home = healthy('ccrc-doctor-docs-sw-fleet-units-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    rmSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true, force: true });
    const r = runDocsSw(home);
    expect(lines(r.stdout)).toEqual([
      'SKIP docs-sw: this box runs no ccrc server (its units are ccrc-agent.service and no ccrc.service), so it serves no PWA bundle and no service worker of its own',
    ]);
    expect(r.code).toBe(3);
  });

  it('runs on a server and on a both box: the role does not excuse either', () => {
    for (const role of ['server', 'both']) {
      const home = healthy(`ccrc-doctor-docs-sw-role-${role}-`);
      writeCcrcEnv(home, `CCRC_ROLE=${role}\nCCRC_FLEET=local\n`);
      expect(lines(runDocsSw(home).stdout)[0], role).toMatch(/^PASS docs-sw: /);
      plant(home, swJs(list(knob('/docs'))));
      expect(lines(runDocsSw(home).stdout)[0], role).toMatch(/^FAIL docs-sw: the installed service worker refuses/);
    }
  });

  it('names no path but the worker it reads, on every arm: a SKIP names none at all', () => {
    const home = healthy('ccrc-doctor-docs-sw-paths-');
    const measured: string[] = [runDocsSw(home).stdout];
    plant(home, swJs(list(knob('/docs'))));
    measured.push(runDocsSw(home).stdout);
    plant(home, swJs('allowlist:[/./]'));
    measured.push(runDocsSw(home).stdout);
    rmSync(swPath(home));
    measured.push(runDocsSw(home).stdout);
    for (const out of measured) {
      const at = out.split(home).slice(1);
      expect(at.length, out).toBe(1);
      expect(at[0]?.startsWith('/ccrc/server/dist-pwa/sw.js'), out).toBe(true);
    }
    writeCcrcEnv(home, 'CCRC_ROLE=fleet\n');
    const byRole = runDocsSw(home).stdout;
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    const byUnits = runDocsSw(home).stdout;
    for (const out of [byRole, byUnits]) {
      expect(out, out).toMatch(/^SKIP docs-sw: /);
      expect(out.includes(home), out).toBe(false);
    }
  });

  it('a whole healthy doctor run PASSes docs-sw, and the healthy skip count does not move (M7.6)', () => {
    const home = healthy('ccrc-doctor-docs-sw-whole-');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'docs-sw'), r.stdout).toMatch(/^PASS docs-sw: /);
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(${HEALTHY_SKIPS} skipped\\), \\d+ verdicts — \\d+ passed, 0 warned, 0 failed$`, 'm'));
    expect(r.code).toBe(0);
  });

  it('says so, rather than guessing, when ccrc\'s own tree path and config reader are not loaded', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-docs-sw');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_docs-sw`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL docs-sw: ccrc's own tree path and config reader are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  it('docs-sw is the table\'s last name and _check_docs-sw is declared (M7.6)', () => {
    const names = tableNames();
    expect(names[names.length - 1]).toBe('docs-sw');
    expect(names.filter((n) => n === 'docs-sw')).toHaveLength(1);
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; declare -F _check_docs-sw`],
      { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('_check_docs-sw');
  });
});
```

(d) Append this block (it starts with one blank line) at the end of `server/test/docs-parity.test.ts`, after its last line (`});`, line 591, which closes Task 9's `M7.9: the tree does not know a standalone docs server`):

```ts

// ---- Docs W4 Task 10: M7.3's doctor half, one prefix in ccd/ccrc-doctor-checks (spec 2026-10-01 sections 7.2 and 7.10) ----
// `docs-sw` builds its ERE and every message from ONE assignment, `CCRC_DOCS_PAGE_PREFIX='/docs'`, at the end of the
// doctor file. This block holds that assignment to exactly one line, its value equal to the `DOCS_PAGE_PREFIX` the TS
// half above reads (the module scope's import), the quoted prefix to one occurrence in the whole file, and the
// check's own body to the variable: it spells the prefix nowhere and reads `$CCRC_DOCS_PAGE_PREFIX`.
// Raw text on purpose: a quoted prefix in a comment counts. NOT EXHAUSTIVE. Known evasions: a second prefix set
// through `declare`, `export`, `readonly`, `local`, `printf -v` or `read`, or on a line that starts with something
// else (`x=1; CCRC_DOCS_PAGE_PREFIX=...`); the prefix built from parts or spelled unquoted outside the check's body;
// and any spelling in a file other than ccd/ccrc-doctor-checks.
// It reuses the module scope's `describe`, `it`, `expect`, `readFileSync`, `path`, `ccrcRoot` and `DOCS_PAGE_PREFIX`.
const M73_DOCTOR = 'ccd/ccrc-doctor-checks';
const M73_ASSIGN = /^\s*CCRC_DOCS_PAGE_PREFIX=(.*)$/;

/** What the doctor file says about the prefix: each assignment line's value with one pair of surrounding quotes
 *  removed, how many times the quoted prefix appears anywhere, and the body of `_check_docs-sw` ('' when absent). */
function m73Doctor(text: string, prefix: string): { values: string[]; quoted: number; body: string } {
  const lines = text.split('\n');
  const values = lines.flatMap((l) => {
    const m = M73_ASSIGN.exec(l);
    if (m === null) return [];
    const raw = (m[1] ?? '').trim();
    const q = /^'([^']*)'$/.exec(raw) ?? /^"([^"]*)"$/.exec(raw);
    return [q === null ? raw : (q[1] ?? '')];
  });
  const quoted = text.split(`'${prefix}'`).length - 1 + text.split(`"${prefix}"`).length - 1;
  const start = lines.findIndex((l) => l.startsWith('_check_docs-sw() {'));
  const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && l === '}');
  const body = start < 0 || end < 0 ? '' : lines.slice(start + 1, end).join('\n');
  return { values, quoted, body };
}

describe("M7.3 (doctor half): one CCRC_DOCS_PAGE_PREFIX in the doctor file, equal to shared/docs.ts's", () => {
  const text = readFileSync(path.join(ccrcRoot, M73_DOCTOR), 'utf8');
  const got = m73Doctor(text, DOCS_PAGE_PREFIX);

  it('CONTROL: the scan reads every assignment line and quote form, counts quoted literals, and finds the body', () => {
    const planted = [
      "CCRC_DOCS_PAGE_PREFIX='/docs'",
      '  CCRC_DOCS_PAGE_PREFIX="/doc"',
      'CCRC_DOCS_PAGE_PREFIX=/x',
      "declare CCRC_DOCS_PAGE_PREFIX='/y'",
      "# a comment naming '/docs' counts as a literal",
      '_check_docs-sw() {',
      '  echo "$CCRC_DOCS_PAGE_PREFIX"',
      '}',
    ].join('\n');
    expect(m73Doctor(planted, '/docs')).toEqual({
      values: ['/docs', '/doc', '/x'], quoted: 2, body: '  echo "$CCRC_DOCS_PAGE_PREFIX"',
    });
    expect(m73Doctor('', '/docs')).toEqual({ values: [], quoted: 0, body: '' });
  });

  it('is assigned on exactly one line, and its value is DOCS_PAGE_PREFIX', () => {
    expect(got.values).toEqual([DOCS_PAGE_PREFIX]);
    expect(text).toMatch(new RegExp(`^CCRC_DOCS_PAGE_PREFIX='${DOCS_PAGE_PREFIX}'$`, 'm'));
  });

  it('the quoted prefix appears once in the whole file: the assignment', () => {
    expect(got.quoted).toBe(1);
  });

  it("_check_docs-sw reads the variable and never spells the prefix", () => {
    expect(got.body, '_check_docs-sw() not found, or not closed by a bare } at column 0').not.toBe('');
    expect(got.body).toContain('$CCRC_DOCS_PAGE_PREFIX');
    expect(got.body.includes(DOCS_PAGE_PREFIX), 'a spelled prefix in the check: interpolate the variable').toBe(false);
  });
});
```

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'docs-sw' )`
Expected: `Test Files  1 failed (1)`, `Tests  15 failed | 1 passed | 888 skipped (904)`. The one green is `the shared fixture text is the one-line, one-denylist shape a build emits` (it reads `swFixtures.ts` only). The fifteen reds: every case that reads `sw.js` from `healthy()` (`ENOENT`, not planted yet) or runs `_check_docs-sw` (`_check_docs-sw: command not found`, rc 127; the not-loaded case therefore sees no verdict line), and `docs-sw is the table's last name and _check_docs-sw is declared (M7.6)` (`expected 'history' to be 'docs-sw'`). As root the unreadable case is skipped and the count is `14 failed | 1 passed | 889 skipped`.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )`
Expected: `Test Files  1 failed (1)`, `Tests  3 failed | 51 passed (54)`. The reds: `is assigned on exactly one line, and its value is DOCS_PAGE_PREFIX` (`expected [] to deeply equal [ '/docs' ]`), `the quoted prefix appears once in the whole file: the assignment` (`expected +0 to be 1`) and `_check_docs-sw reads the variable and never spells the prefix` (`_check_docs-sw() not found, or not closed by a bare } at column 0`). The CONTROL is green: it proves the scanner on planted text.

- [ ] **Step 2: Every fixture that runs the closing doctor plants the bundle (refinement (t)).** Three files, one text.

In `server/test/ccrc-doctor.test.ts`, inside `healthy()`, after the `docs` stub:

Find (lines 1227-1230):

```ts
  writeFileSync(join(home, '.local', 'bin', 'ccd'),
    docsIndexStubScript(JSON.stringify(DOCS_INDEX_READY)), { mode: 0o755 });
  return home;
}
```

Replace with:

```ts
  writeFileSync(join(home, '.local', 'bin', 'ccd'),
    docsIndexStubScript(JSON.stringify(DOCS_INDEX_READY)), { mode: 0o755 });
  // …and its PWA bundle carries the service worker every browser installs (spec 2026-10-01 §7.2): `docs-sw` is a
  // check, and healthy()'s contract is that every check PASSES. `swJs()` is the default-denylist worker in the
  // one-line shape a build emits, the same text `TREE_STUBS` and `ccrc-update.test.ts`'s tree plant.
  mkdirSync(join(home, 'ccrc', 'server', 'dist-pwa'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js'), swJs());
  return home;
}
```

In `server/test/installTreeFixture.ts`, three edits. The header's import sentence:

Find (lines 11-13):

```ts
// vitest and registers no tests, so both suites can import it directly. Its one
// non-`node:` import is `containedTools.ts` (itself `node:*` only), for
// `keepDigestEnv`; it never imports `ccrcContainment.ts`, which reaches vitest.
```

Replace with:

```ts
// vitest and registers no tests, so both suites can import it directly. Its
// non-`node:` imports are `containedTools.ts` (itself `node:*` only), for
// `keepDigestEnv`, and `swFixtures.ts` (no imports at all), for the bundle's
// `sw.js`; it never imports `ccrcContainment.ts`, which reaches vitest.
```

The import (after the one non-`node:` import there is today):

Find (lines 24-26):

```ts
// The ONE non-`node:` import, and it imports only `node:*` itself — which is what keeps this file vitest-free
// (wave 9 R9-F8). It may never import `ccrcContainment.ts`, which reaches vitest through `ccdWsHelpers.ts`.
import { CONTAINED_TOOLS, plantPoison } from './containedTools.js';
```

Replace with:

```ts
// The first non-`node:` import, and it imports only `node:*` itself — which is what keeps this file vitest-free
// (wave 9 R9-F8). It may never import `ccrcContainment.ts`, which reaches vitest through `ccdWsHelpers.ts`.
import { CONTAINED_TOOLS, plantPoison } from './containedTools.js';
// The second, and it imports nothing at all (Docs W4): the PWA bundle's one fixture worker, so the closing doctor's
// `docs-sw` check reads the same text `ccrc-doctor.test.ts`'s `healthy()` plants.
import { swJs } from './swFixtures.js';
```

The stub (one entry after the bundle's `index.html`):

Find (lines 252-253):

```ts
  'server/dist/server/src/index.js': '// fixture: stands in for the built server\n',
  'server/dist-pwa/index.html': '<!doctype html><title>fixture PWA</title>\n',
```

Replace with:

```ts
  'server/dist/server/src/index.js': '// fixture: stands in for the built server\n',
  'server/dist-pwa/index.html': '<!doctype html><title>fixture PWA</title>\n',
  // Docs W4: the service worker the bundle ships. The closing doctor's `docs-sw` FAILs a tree without one, so every
  // fixture that ends in `ccrc doctor` places it; `swJs()` is the default-denylist text a build emits.
  'server/dist-pwa/sw.js': swJs(),
```

In `server/test/ccrc-update.test.ts`, two edits:

Find (line 61):

```ts
import { DOCS_INDEX_READY } from './docsIndexFixtures.js';
```

Replace with:

```ts
import { DOCS_INDEX_READY } from './docsIndexFixtures.js';
import { swJs } from './swFixtures.js';
```

Find (lines 842-844):

```ts
  mkdirSync(join(tree, 'server', 'dist-pwa'), { recursive: true });
  writeFileSync(join(tree, 'server', 'dist-pwa', 'index.html'),
    '<!doctype html><title>fixture PWA</title>\n');
```

Replace with:

```ts
  mkdirSync(join(tree, 'server', 'dist-pwa'), { recursive: true });
  writeFileSync(join(tree, 'server', 'dist-pwa', 'index.html'),
    '<!doctype html><title>fixture PWA</title>\n');
  // Docs W4: the bundle's service worker, which the closing doctor's `docs-sw` measures (`swFixtures.ts`).
  writeFileSync(join(tree, 'server', 'dist-pwa', 'sw.js'), swJs());
```

No other fixture builds a box tree that runs the closing doctor: `grep -rn "dist-pwa" server/test --include=*.ts` names, besides these three, only `build-release.test.ts` and `release-main.test.ts` (which plant a build's output for the tarball, and run no doctor), `install-sh.test.ts` and `auth-gate.test.ts` (comments and a checkout probe), and `ccrc-install.test.ts`'s own `TREE_STUBS` reads.

- [ ] **Step 3: Implement `docs-sw` in `ccd/ccrc-doctor-checks`.** Two edits (use Edit, which keeps the file's 0755 mode).

The table (one line, in place: refinement (s); every line below the table is cited by number elsewhere, so no line is added there):

Find (line 213):

```bash
  models codex docs history   # four entries on one line: every line below is cited by number elsewhere
```

Replace with:

```bash
  models codex docs history docs-sw   # five entries on one line: every line below is cited by number elsewhere
```

Then append this block (it starts with one blank line) at the end of the file, after `_check_history`'s closing `}` (line 7376, the file's last line):

```bash

# ── docs-sw: the installed service worker keeps the Docs pages on the app shell ──
# The server half of the Docs pair (spec 2026-10-01 §7.2; native Docs reader
# W4). Every page under the Docs prefix is the app shell: the server's
# not-found handler and the worker's navigateFallback both hand it
# `index.html`. A worker whose navigation denylist covers the prefix sends
# every hard load of a Docs page past the shell, so the page breaks on reload
# and offline. The build already refuses such a `CCRC_SW_DENYLIST` entry
# (`pwa/src/lib/sw-denylist.ts`); this check is the one measurement of the
# bundle actually INSTALLED, which catches a hand-built bundle, a pre-Docs
# checkout and a regression in the built-ins. It probes nothing else: not a
# unit, not a port, not a proxy mapping.
#
# THE PREFIX IS ONE ASSIGNMENT, the line below, and every message and the ERE
# interpolate it; `docs-parity.test.ts` (M7.3's doctor half) holds it to one
# line, equal to `DOCS_PAGE_PREFIX` in `shared/docs.ts`, and holds the check's
# body to the variable.
#
# 1. A FLEET BOX SKIPs, on either piece of evidence `_check_update-exposure`
#    uses: a recorded `CCRC_ROLE=fleet`, or a unit directory holding
#    `ccrc-agent.service` and no `ccrc.service` (the env-less fleet host this
#    file's header describes). A `server` or `both` box, and a box with no
#    evidence either way, is measured. Neither SKIP names a path: a SKIP has
#    nothing to fix.
# 2. THE WORKER is `$BOX_TREE_DIR/server/dist-pwa/sw.js`, where both lanes put
#    the bundle (`~/ccrc`, through its version symlink on a release-lane box).
#    Absent, or there and not a readable file: FAIL, `ccrc update --force`.
# 3. THE SHAPE: workbox emits the whole worker as ONE minified line, so the
#    `denylist:[` OCCURRENCES are counted, never lines, by parameter-expansion
#    length arithmetic; a line count could never see two lists. Exactly one,
#    closed by the next `]}`, or WARN: this check knows that shape and no
#    other, and a verdict on a shape it does not know would be a guess.
# 4. THE PREFIX: each comma-separated entry of that list, as the worker prints
#    it (a RegExp literal, every `/` escaped: the knob's `/wiki` is
#    `/^\/wiki(\/|$)/`), is matched with bash's own ERE, built from the prefix,
#    for an entry equal to the prefix or under it: the knob form, a bare `$`
#    anchor, no end anchor at all, or `\/` and anything after. A sibling that
#    merely starts the same way (`/docsy`, `/docs-archive`) is not. FAIL names
#    every entry that covers it.
#
# BUILTINS ONLY: `$(<file)`, `${var//pattern/}`, `${#var}` and `[[ =~ ]]`. No
# grep, sed, awk, tr, head or cut: this file reaches for none of them, and the
# doctor suite's PATH holds no system directory (`_check_docs`' note).
CCRC_DOCS_PAGE_PREFIX='/docs'

_check_docs-sw() {
  if [ -z "${BOX_TREE_DIR:-}" ] || ! declare -F _box_env_value >/dev/null 2>&1; then
    _dr_fail docs-sw "ccrc's own tree path and config reader are not loaded, so the installed service worker was not measured" \
      "this is a bug in ccrc, not a fact about your box — _check_docs-sw reads BOX_TREE_DIR and this box's recorded CCRC_ROLE through _box_env_value, both declared in ccrc itself, and this check table was sourced by something that is not ccrc"
    return 1
  fi
  local role=""
  # -f BEFORE -r: `_check_skills`' guard order, for its reason (a directory answers -r too).
  [ -f "${BOX_ENV_FILE:-}" ] && [ -r "${BOX_ENV_FILE:-}" ] && role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  if [ "$role" = fleet ]; then
    _dr_skip docs-sw "this box records CCRC_ROLE=fleet, so it serves no PWA bundle and no service worker of its own"
    return 3
  fi
  if [ ! -f "$CCRC_UNIT_DIR/$(_dr_unit_file ccrc.service)" ] && [ -f "$CCRC_UNIT_DIR/$(_dr_unit_file ccrc-agent.service)" ]; then
    _dr_skip docs-sw "this box runs no ccrc server (its units are ccrc-agent.service and no ccrc.service), so it serves no PWA bundle and no service worker of its own"
    return 3
  fi

  local p="$CCRC_DOCS_PAGE_PREFIX" sw="$BOX_TREE_DIR/server/dist-pwa/sw.js"
  if [ ! -e "$sw" ] && [ ! -L "$sw" ]; then
    _dr_fail docs-sw "no service worker at $sw, so this box serves its PWA bundle without the file every browser installs" \
      "ccrc update --force"
    return 1
  fi
  if [ ! -f "$sw" ] || [ ! -r "$sw" ]; then
    _dr_fail docs-sw "$sw is there but is not a file this check can read, so what it refuses was not measured" \
      "ccrc update --force"
    return 1
  fi

  local body open='denylist:[' close=']}' without n after shape=""
  body="$(<"$sw")"
  without="${body//"$open"/}"
  n=$(( (${#body} - ${#without}) / ${#open} ))
  after="${body#*"$open"}"
  if [ "$n" -ne 1 ]; then
    shape="carries $n denylists"
  elif [[ "$after" != *"$close"* ]]; then
    shape="carries 1 denylist that never closes"
  fi
  if [ -n "$shape" ]; then
    _dr_warn docs-sw "$sw $shape, and this check knows the shape workbox emits (exactly one, closed by $close), so whether it refuses $p was not measured" \
      "hard-reload $p/ in a browser and check that the Docs screen renders"
    return 2
  fi

  # The prefix as the worker prints it, as ERE text: each `/` is `\/` in the
  # RegExp literal, matched by the ERE `\\/`; a letter, digit, `_` or `-` is
  # itself; anything else is bracketed so it matches only itself.
  local list="${after%%"$close"*}" ere="" c i
  for (( i = 0; i < ${#p}; i++ )); do
    c="${p:i:1}"
    case "$c" in
      /) ere+='\\/' ;;
      [A-Za-z0-9_-]) ere+="$c" ;;
      *) ere+="[$c]" ;;
    esac
  done
  # After `/^` and the prefix: the literal's end (no end anchor), `$/`, the
  # knob's `(\/|$)/`, or `\/` and anything (an entry under the prefix).
  local head='^/\^' tail='(/|\$/|\(\\/\|\$\)/|\\/.*)$'
  local re="$head$ere$tail" rest="$list," e k=0 found=""
  while [ -n "$rest" ]; do
    e="${rest%%,*}"
    rest="${rest#*,}"
    [ -n "$e" ] || continue
    k=$((k + 1))
    if [[ $e =~ $re ]]; then found+="${found:+, }$e"; fi
  done
  if [ -n "$found" ]; then
    _dr_fail docs-sw "the installed service worker refuses the app shell to $p; Docs pages break on a hard load and offline ($sw denies $found)" \
      "remove $p from CCRC_SW_DENYLIST in the deploying machine's ~/.ccrc/deploy.env and deploy again, or move to the release lane: ccrc update"
    return 1
  fi
  _dr_pass docs-sw "$sw keeps $p on the app shell: its one denylist holds $k entries ($list), none of them $p or under it"
}
```

What the block does that the spec words differently is refinement (c), defined in Step 8: §7.2 step 3's `grep -c 'denylist:\['` counts LINES, the worker is one line, and the doctor suite's PATH holds no `grep` (measured: the file's executable code calls none of `grep`, `sed`, `awk`, `tr`, `head`, `cut`), so the count is `${body//"$open"/}` length arithmetic and the match is `[[ $e =~ $re ]]`. The ERE is built character by character from the prefix, so nothing in the function spells it; its four alternatives after `/^` and the prefix are the literal's end (`/^\/docs/`), `$/` (`/^\/docs$/`), the knob's form `(\/|$)/` (`/^\/docs(\/|$)/`) and `\/` with anything after (`/^\/docs\/x(\/|$)/`, `/^\/docs\//`); `/^\/docsy(\/|$)/` and `/^\/docs-archive(\/|$)/` match none. The SKIP on unit evidence is refinement (d).

Run: `bash -n ccd/ccrc-doctor-checks && echo SYNTAX-OK && ls -l ccd/ccrc-doctor-checks && git diff --numstat -- ccd/ccrc-doctor-checks`
Expected: `SYNTAX-OK`, mode `-rwxrwxr-x` (or the checkout's own `x` bits, unchanged), and `122	1	ccd/ccrc-doctor-checks` (one line replaced in place, 121 appended).

- [ ] **Step 4: Run the tests green, then re-derive the pins.** Foreground, Bash timeout 600000 ms for every run.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'docs-sw' )`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed | 888 skipped (904)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'the check list is data' )`
Expected: `Tests  2 passed | 902 skipped (904)` (M7.6: `docs-sw` is in the table and `_check_docs-sw` is a function, neither an ORPHAN nor MISSING).

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/docs-budget.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  73 passed (73)` (54 + 19; Step 0's 69 plus 4).

Now the whole doctor file, in three calls (one call took 666 s on the planning box, over the 600 s bound). Each `-t` pattern is a regexp over the case's full name; the three partition the file's 889 cases (measured with `vitest list`: 318, 222 and 349).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^ccrc doctor: [a-f]' )`
Expected, the FIRST time: `Tests  1 failed | 317 passed | 586 skipped (904)`. The one red is the pin Step 0 found, `ccrc doctor: config > SKIPS an env-less FLEET-ROLE box rather than advising it to install a server`: `expected 'PASS node: v22.20.0 satisfies >=1.0.0…' to match /^summary: \d+ checks \(10 skipped\)/m`, because that box (no `ccrc.env`, `ccrc-agent.service` and no `ccrc.service`) now prints `SKIP docs-sw: this box runs no ccrc server (its units are ...)` too: refinement (d), measured at `11 skipped` on Linux. Re-derive it in place, the numeral only (its comment's count sentence is not edited: the file-shape invariant allows numeral edits on count lines alone, and this describe's own SKIP case states the sixth):

Find (line 3343):

```ts
      new RegExp(`^summary: \\d+ checks \\(${5 + HEALTHY_SKIPS} skipped\\)`, 'm'));
```

Replace with:

```ts
      new RegExp(`^summary: \\d+ checks \\(${6 + HEALTHY_SKIPS} skipped\\)`, 'm'));
```

Run it again: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^ccrc doctor: [a-f]' )`
Expected: `Test Files  1 passed (1)`, `Tests  318 passed | 586 skipped (904)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^ccrc doctor: [g-o]' )`
Expected: `Tests  222 passed | 682 skipped (904)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^(ccrc doctor: [^a-o]|ccrc doctor --fix|ccrc status|ccrc-doctor-checks|stubLaunchctl)' )`
Expected: `Tests  349 passed | 555 skipped (904)` (planning: 301 s). `HEALTHY_SKIPS` (line 1500) is unchanged, and every pin that reads it on `healthy()` is green: `docs-sw` PASSes there (M7.6).

Then the install suite, whose live-shape golden names every check. Three calls (they partition its 298 non-skipped cases: 69, 128 and 101):

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t '^(ccrc install(?!: the )|ccrcEnv|install\.sh|Plan 3a|runInstall|the rsync)' )`
Expected, the FIRST time: `Tests  3 failed | 66 passed | 249 skipped (318)`, all three in `Plan 3a Task 10 — the cutover rehearsal`: `the base tree: BASE_LIVE_SHAPE is its measured answer ...` (`BASE_LIVE_SHAPE is not Step 3's measurement of this table`, the received key list lacking `"docs-sw"`), `live shape: two installs ...` and `the flip, in Plan 3b's order ...` (each `+   "docs-sw": "SKIP",`: the `--role fleet` live box records `CCRC_ROLE=fleet`, so the measured class is SKIP). The golden's own docstring says how it moves: re-measured by the live case, each map gaining the new check's measured class and nothing else, as `timeout`, `docs`, `model-default`, `scope-sweep` and `history` did. Record that measurement in place. The three map lines are not unique as text (two sit at eight spaces, one at six, and the six-space line is a substring of the eight-space ones), so this edit is a line-anchored script that refuses unless it hits exactly three:

```bash
python3 - <<'EOF'
import re
p = 'server/test/ccrc-install.test.ts'
s = open(p).read()
s, n = re.subn(r'(?m)^( +)"docs": "PASS",\n', lambda m: m.group(0) + m.group(1) + '"docs-sw": "SKIP",\n', s)
assert n == 3, n
old = """ *  the shim landed seconds before, and no sweep has ticked) and nothing else
 *  moved.
"""
assert s.count(old) == 1
s = s.replace(old, old + """ *  RE-MEASURED again when doctor gained its `docs-sw` check (native Docs reader
 *  W4, spec 2026-10-01 §7.2), by the live-shape case on the W4 tree: the three
 *  maps each gained `"docs-sw": "SKIP"` (the `--role fleet` box records
 *  `CCRC_ROLE=fleet` and serves no PWA bundle) and nothing else moved.
""")
open(p, 'w').write(s)
EOF
git diff -U0 -- server/test/ccrc-install.test.ts | grep '^@@'
```

Expected: four hunk headers, `@@ -8279,0 +8280,4 @@`, `@@ -8306,0 +8311 @@`, `@@ -8356,0 +8362 @@` and `@@ -8476,0 +8483 @@` (the docstring's four lines, then one line after each map's `"docs": "PASS",`).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t '^(ccrc install(?!: the )|ccrcEnv|install\.sh|Plan 3a|runInstall|the rsync)' )`
Expected: `Test Files  1 passed (1)`, `Tests  69 passed | 249 skipped (318)` (planning: 208 s).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t '^ccrc install: the [a-m]' )`
Expected: `Tests  128 passed | 190 skipped (318)` (planning: 326 s; `ends with doctor, and a box that passes every check exits 0` among them: its closing doctor PASSes `docs-sw` on the planted `sw.js`).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t '^ccrc install: the [n-z]' )`
Expected: `Tests  101 passed | 217 skipped (318)` (planning: 343 s).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts )`
Expected: `Test Files  1 passed (1)`, `Tests  58 passed (58)` (planning: 163 s; the ground measured 28 reds here with a `docs-sw` in the table and no `sw.js` in `TREE_STUBS`).

Then the update suite, in three calls (they partition its 502 non-skipped cases: 191, 127 and 184):

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t '^(ccrc update(: [^t]| --| an)|ccrc channel|ccrc: one EXIT)' )`
Expected: `Tests  191 passed | 323 skipped (514)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t '^ccrc update: t' )`
Expected: `Tests  127 passed | 387 skipped (514)`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t '^(ccrc rollback|ccrc versions|`ccrc versions|ccrc watchdog|"kept"|Plan 3a|the Darwin|the killed|updateEnv|_upd_restore)' )`
Expected: `Tests  184 passed | 330 skipped (514)`.

If a split's count differs, re-derive the partition with `( cd server && ./node_modules/.bin/vitest list test/<file> -t '<pattern>' | wc -l )` before calling it a red; a red that is not one of the three named above is a finding, never a pin to move.

- [ ] **Step 5: The fixture text against a real build (recorded, not a test).** In a scratch COPY, never in the worktree (the build writes `../server/dist-pwa`):

```bash
C=$(mktemp -d) && git archive "$(git write-tree)" | tar -x -C "$C" && git -C "$C" init -q \
  && ln -s "$PWD/pwa/node_modules" "$C/pwa/node_modules" && ln -s "$PWD/server/node_modules" "$C/server/node_modules"
( cd "$C/pwa" && env -u CCRC_SW_DENYLIST npm run build > "$C/build.out" 2>&1; echo rc=$? )
wc -l < "$C/server/dist-pwa/sw.js"
grep -o 'denylist:\[[^]]*\]' "$C/server/dist-pwa/sw.js"
grep -o 'denylist:\[[^]]*\]}' "$C/server/dist-pwa/sw.js" | wc -l
grep -o "'denylist:\[[^']*\]'" server/test/swFixtures.ts
rm -rf "$C"
```

Expected: `rc=0`; `1` (the worker is one line); `denylist:[/^\/api\//,/^\/ws\//]` (the build's list); `1` (closed by `]}`, the shape the check extracts); and the fixture's source literal `'denylist:[/^\\/api\\//,/^\\/ws\\//]'`, which is the same string once its TS escapes are read (the describe's first case asserts `SW_DENYLIST_DEFAULT` equals the list it builds). Record both texts and `rc=0` in the SDD ledger as Step 5's comparison. Measured at planning on a scratch build of Task 9's tree: `precache 17 entries (1683.62 KiB)`, `sw.js` 2090 bytes, one line, `...createHandlerBoundToURL("/index.html"),{denylist:[/^\/api\//,/^\/ws\//]})),e.registerRoute(...)`.

- [ ] **Step 6: The guard suites.** Foreground, Bash timeout 600000 ms each. Stage first, so the `git ls-files` scans see the new file:

Run: `git add server/test/swFixtures.ts ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/installTreeFixture.ts server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/docs-parity.test.ts && git status --short`
Expected: exactly `A  server/test/swFixtures.ts` and `M ` for the six others.

Run: `( cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts test/pools-existence-pairing.test.ts test/runbook-holds.test.ts test/routing-env-census.test.ts test/auth-passkey.test.ts test/node-floor.test.ts test/pool-name-parity.test.ts test/pool-tag-parity.test.ts test/source-bytes.test.ts test/single-definition.test.ts test/ccrc-containment.test.ts )`
Expected: `Test Files  11 passed (11)`, `Tests  1054 passed | 11 skipped (1065)` at planning. What each holds here: `macos-platform` scans the doctor file for GNU-only spellings (the block has none, its messages included); `pools-existence-pairing` finds every function by `^name() {` and its bare column-0 `}`; `runbook-holds`, `routing-env-census`, `auth-passkey`, `node-floor`, `pool-name-parity` and `pool-tag-parity` read other parts of the doctor file, unchanged; `source-bytes` reads the new file's bytes; `single-definition`'s `TREE_STUBS` holder scan still finds one definition, and nothing redeclares a `shared/docs.ts` name (the doctor's prefix is bash; M7.3 holds the two equal); `ccrc-containment` reads `installTreeFixture.ts`'s imports (no vitest, no `ccrcContainment`, `containedTools.js` still among them).

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)` (its `server/test/ is clean under a tests-inclusive project` compiles `swFixtures.ts`, the appended describes and the three imports). A known load flake: re-run alone before calling a red broken. On a tree whose `agent/node_modules` is absent, two cases red on `../agent/src/server.ts` (`Cannot find module 'ws'`), with and without this task: an environment red, not this task's.

Run: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts )`
Expected: `Tests  55 passed (55)`. The new text names only placeholders: the paths `/wiki`, `/docs`, `/docs/x`, `/docsy`, `/docs-archive`, `/api/`, `/ws/`, the fixture HOMEs' `mkTmp` prefixes `ccrc-doctor-docs-sw-*`, and no host, user, project, pool or account.

No `ccd/ccd` edit, so no restamp; `ccd/ccrc-doctor-checks` is not generated and carries no provenance marker.

- [ ] **Step 7: Commit.**

```bash
git add server/test/swFixtures.ts ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/installTreeFixture.ts \
  server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/docs-parity.test.ts
git status --porcelain | grep -v '^[MA]  ' ; git diff --cached --name-only | wc -l
git commit -m "doctor: docs-sw measures the installed service worker (docs W4)" \
  -m "ccrc doctor gains docs-sw, appended at the end of ccd/ccrc-doctor-checks with its one CCRC_DOCS_PAGE_PREFIX and named in place on the table's last line: it SKIPs a fleet box on either evidence update-exposure uses, FAILs an absent or unreadable server/dist-pwa/sw.js with ccrc update --force, WARNs unless exactly one denylist:[ closed by ]} appears (occurrences, counted with builtins: workbox emits one line), and FAILs an entry equal to or under the prefix with spec 7.2's sentence while /docsy and /docs-archive pass." \
  -m "server/test/swFixtures.ts holds the one default worker text, which healthy(), TREE_STUBS and ccrc-update.test.ts's tree now plant, so every closing doctor PASSes it; the env-less fleet-role pin and the live-shape golden are re-measured in place (docs-sw SKIPs there). docs-parity.test.ts appends M7.3's doctor half: one assignment, equal to DOCS_PAGE_PREFIX, the quoted prefix once, and a check body that reads the variable." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected before the commit: the `grep -v` prints nothing and the count is `7`. Release the six claims after it.

- [ ] **Step 8: Define the four spec deviations (the ONE deviation-defining step of this plan), then commit the plan alone.**

This step defines the plan's four departures from the binding spec's TEXT (Global Constraints, "Deviations"): refinements (a), (b), (c) and (d), with the FIRST FOUR numbers of the block the brief issued for this run, in that order, then any operator ruling the brief names that departs from the spec's text, and any departure the SDD ledger holds from Tasks 1-9 (in the order found), with the block's next numbers. `<n1>`..`<n4>` (and `<n5>`.. for those departures) are those issued numbers, never one looked up, guessed or read off `GET /api/ledger`'s `floor`; `<date>` is `date -u +%F`. If the brief names no block, or fewer numbers than this step needs, stop and put an ask to the coordinator: write no `D-` number that was not issued (a session that cannot reach the allocator writes `D-TBD-<slug>` in its REPORT only, never in a commit: `dtbd.test.ts`).

Append exactly this at the end of this plan (after its last line, whatever it is; nothing above it changes), with the placeholders filled:

```markdown

## Deviations found

- **D-<n1> (<date>)** — the six W4 rows the spec writes against W5 artefacts are proved by their W4 half, on W4 stand-ins, and their W5 half moves to W5's brief (spec §7.7's W4 row and §4.15's Test column for M4.R1, M4.B1, M4.P1, M4.P6, M4.P7 and M4.P12). W4 has no `DocsScreen`, `DocMarkdown`, `loaders.tree` or Format-anyway, and stubbing them would pre-empt W5: M4.R1 is proved by a probe on `useLocation` that re-renders for `navigate('/docs/p?ref=a')` then `?ref=b` (W5: the injected `loaders.tree` called with ref `b`); M4.B1 by a mocked throwing `RunsScreen` at `/runs` that keeps `.shell-nav` with the fallback until a navigation resets it (W5: the same at `/docs` with `DocsScreen`); M4.P1 by the refusal, its control and chat's note (W5: `DocMarkdown`'s note); M4.P6 by the runner honouring a 30 000 `budgetMs` (W5: Format anyway posts a 30 000 job); M4.P7 by a throwing `spawn` giving a sticky `worker-unavailable` and chat's 4 KiB sync and 5 KiB note (W5: `DocMarkdown`'s in-thread 4 KiB and 5 KiB note); M4.P12 by `parseMarkdown` giving `too-wide` for both fixtures and a tree for a real 500 KiB prose doc (W5: the `renderHast` spy has 0 calls and the doc still renders). Task 12's results record each W5 half verbatim for W5's brief. Refinement (a); Tasks 3, 5, 6, 7 and 8.
- **D-<n2> (<date>)** — M4.M1's mutation "change plugin order" is replaced by "drop `remarkAlerts` from the list" and "drop `remarkGfm` from the list" (spec §4.15's M4.M1 mutation column). `remark-gfm` 4.0.1 registers micromark and mdast extensions only and returns no transformer (measured in the installed `remark-gfm/lib/index.js`), so `[remarkAlerts, remarkGfm]` renders byte-identically to `[remarkGfm, remarkAlerts]`: an equivalent mutant that can never go red. Task 1 measured the swap once, every golden case green (recorded in the SDD ledger), and its rows W4-T1-M1 and W4-T1-M2 drop a plugin instead, beside the spec's other two mutations (drop an alias; edit `CHAT_COMPONENTS.a`). Refinement (b); Tasks 1 and 2.
- **D-<n3> (<date>)** — `docs-sw` counts `denylist:[` OCCURRENCES with bash builtins (`${body//"$open"/}` length arithmetic over `$(<"$sw")`) and matches each entry with bash's own ERE (`[[ $e =~ $re ]]`), not `grep -c 'denylist:\['` and an external ERE tool (spec §7.2 step 3). `grep -c` counts LINES, and workbox emits the whole worker as one minified line (measured: a real build's `sw.js` is one line), so M7.5's "two denylists: WARN" could never fire; and the doctor suite's PATH holds no `grep` (the file's executable code calls none of `grep`, `sed`, `awk`, `tr`, `head` or `cut`). Every verdict §7.2 and M7.5 state holds, pinned by the `ccrc doctor: docs-sw` describe and rows W4-T10-M1 to W4-T10-M4. Refinement (c); Task 10.
- **D-<n4> (<date>)** — `docs-sw` SKIPs on either of `_check_update-exposure`'s two fleet evidences, a recorded `CCRC_ROLE=fleet` or a unit directory holding `ccrc-agent.service` and no `ccrc.service`, not on the role `_box_env_value "$BOX_ENV_FILE" CCRC_ROLE` reads alone (spec §7.2: "the role comes from `_box_env_value`"). A fleet host with no `ccrc.env`, the shape `ccrc-doctor.test.ts`'s env-less fleet-role case models, would otherwise run the check and FAIL on a bundle it never had. A `server` or `both` box, and a box with no evidence either way, is measured. The env-less case's summary pin moved from `5 + HEALTHY_SKIPS` to `6 + HEALTHY_SKIPS` skipped (measured); `HEALTHY_SKIPS` itself did not move. Pinned by rows W4-T10-M5 and W4-T10-M6. Refinement (d); Task 10.
```

Then, only if the brief names an operator ruling that departs from the spec's text, or the SDD ledger holds a departure recorded by Tasks 1-9 that changes behaviour or text the spec states (and that the coordinator was told of when it was found), append one entry per departure, the brief's rulings first and then the ledger's in the order found, from `<n5>` on: `- **D-<n> (<date>)** — <what departs from which spec sentence, and why, as the ruling or the ledger records it>. <Task and rows that apply it>.` A measurement recorded in the ledger (a control depth, a fixture choice, the equivalent mutant's run, a build's rcs) is not a departure and gets no entry; Task 12's results carry those.

Then prove the numbers collide with nothing and no placeholder lands, and read the result BEFORE committing:

```bash
git fetch -q origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )
grep -c '^- \*\*D-[0-9][0-9]* (' docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
grep -c '^## Deviations found$' docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
awk '/^## Deviations found$/{buf=""; f=1} f{buf=buf $0 "\n"} END{printf "%s", buf}' docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md | grep -c 'D-<n\|<date>'
```

Expected: `Test Files  2 passed (2)`; then `4` (plus one per ruling or ledger departure appended); then `2` (this step's template and the appended section); then `0` (the appended section, the file's last `## Deviations found`, carries no unfilled placeholder). A red `deviation-refs` names a number defined in two plans: stop and report it to the coordinator, never renumber by hand.

```bash
git add docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
git commit -m "docs: W4 deviations found (docs W4)" \
  -m "Defines the issued numbers for the plan's departures from the spec's text: refinement (a), the six rows proved by their W4 half with the W5 half carried to W5's brief; (b), M4.M1's equivalent plugin-order mutant replaced by two drops; (c), docs-sw counting denylist occurrences with builtins and matching with [[ =~ ]]; (d), docs-sw skipping on either fleet evidence." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**Mutation rows this task contributes** (each measured red in a separate copy, never in the worktree: `git archive HEAD | tar -x -C <copy>` at this task's Step 7 commit, `git -C <copy> init -q`, `pwa/node_modules` and `server/node_modules` linked to the worktree's; `pkg` is the package the `tests` run in, and `tests` is the argv after `vitest run`, so a `-t` pattern rides in it: one row on `ccrc-doctor.test.ts` without `-t` would run the whole 889-case file, over the 600 s bound; `old` is unique in its file at this task's state). M1-M3 are M7.5's three spec mutations (delete the match, anchor it so `/docs/x` escapes, widen it so `/docsy` fails); M4 is refinement (c)'s (count lines); M5 and M6 are refinement (d)'s two evidences; M7 the absent arm; M8 and M9 are M7.6's (omit a table entry, omit the function); M10-M12 are M7.3's doctor half (a second assignment, a different value, a prefix spelled in the check); M13-M15 are refinement (t)'s three planted fixtures; M16 is the check's not-loaded arm (sourced without `ccrc`, it says so rather than guessing). No earlier task's row anchors on these files, so none is re-anchored.

```json
[
 {
  "id": "W4-T10-M1",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "    if [[ $e =~ $re ]]; then found+=\"${found:+, }$e\"; fi\n",
  "new": "    :\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 3 failed | 13 passed | 888 skipped (904) — 'FAILs a /docs entry with the spec's sentence and remedy, naming the entry', 'FAILs an entry under /docs, and a hand-built one with no end anchor; names every covering entry', 'runs on a server and on a both box: the role does not excuse either' (each PASSes instead of FAILing)"
 },
 {
  "id": "W4-T10-M2",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  local head='^/\\^' tail='(/|\\$/|\\(\\\\/\\|\\$\\)/|\\\\/.*)$'\n",
  "new": "  local head='^/\\^' tail='(/|\\$/|\\(\\\\/\\|\\$\\)/)$'\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 1 failed | 15 passed | 888 skipped (904) — 'FAILs an entry under /docs, and a hand-built one with no end anchor; names every covering entry' (/^\\/docs\\/x(\\/|$)/ escapes the anchored ERE and PASSes)"
 },
 {
  "id": "W4-T10-M3",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  local head='^/\\^' tail='(/|\\$/|\\(\\\\/\\|\\$\\)/|\\\\/.*)$'\n",
  "new": "  local head='^/\\^' tail='.*$'\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 1 failed | 15 passed | 888 skipped (904) — 'PASSes /docsy and /docs-archive: a sibling that merely starts the same way is not under /docs' (/docsy FAILs)"
 },
 {
  "id": "W4-T10-M4",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  without=\"${body//\"$open\"/}\"\n  n=$(( (${#body} - ${#without}) / ${#open} ))\n",
  "new": "  n=0\n  while IFS= read -r without; do [[ $without == *\"$open\"* ]] && n=$((n + 1)); done <<< \"$body\"\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 1 failed | 15 passed | 888 skipped (904) — 'WARNs on two denylists on ONE line: occurrences are counted, not lines (refinement (c))' (one line counts 1, and the first list PASSes)"
 },
 {
  "id": "W4-T10-M5",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  if [ \"$role\" = fleet ]; then\n    _dr_skip docs-sw",
  "new": "  if false; then\n    _dr_skip docs-sw",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 2 failed | 14 passed | 888 skipped (904) — 'SKIPs a box that records CCRC_ROLE=fleet, with no remedy, even with no bundle at all' (FAILs absent instead) and 'names no path but the worker it reads, on every arm: a SKIP names none at all'"
 },
 {
  "id": "W4-T10-M6",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  if [ ! -f \"$CCRC_UNIT_DIR/$(_dr_unit_file ccrc.service)\" ] && [ -f \"$CCRC_UNIT_DIR/$(_dr_unit_file ccrc-agent.service)\" ]; then\n    _dr_skip docs-sw",
  "new": "  if false; then\n    _dr_skip docs-sw",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw|SKIPS an env-less FLEET-ROLE box"
  ],
  "red": "server ccrc-doctor -t 'docs-sw|SKIPS an env-less FLEET-ROLE box': 3 failed | 14 passed | 887 skipped (904) — 'ccrc doctor: config > SKIPS an env-less FLEET-ROLE box rather than advising it to install a server' (the re-derived 6 + HEALTHY_SKIPS pin sees one skip fewer), 'SKIPs an env-less box whose units are the fleet role's, never FAILs it for a bundle it never had (refinement (d))', 'names no path but the worker it reads, on every arm: a SKIP names none at all'"
 },
 {
  "id": "W4-T10-M7",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  if [ ! -e \"$sw\" ] && [ ! -L \"$sw\" ]; then\n",
  "new": "  if false; then\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 1 failed | 15 passed | 888 skipped (904) — 'FAILs an absent worker with ccrc update --force' (the absent worker reaches the unreadable arm's sentence)"
 },
 {
  "id": "W4-T10-M8",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  models codex docs history docs-sw   #",
  "new": "  models codex docs history   #",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "check list is data|docs-sw"
  ],
  "red": "server ccrc-doctor -t 'check list is data|docs-sw': 3 failed | 15 passed | 886 skipped (904) — 'every name in the table has a _check_<name> function, and vice versa' (ORPHAN _check_docs-sw), 'a whole healthy doctor run PASSes docs-sw, and the healthy skip count does not move (M7.6)', 'docs-sw is the table's last name and _check_docs-sw is declared (M7.6)'"
 },
 {
  "id": "W4-T10-M9",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "_check_docs-sw() {\n",
  "new": "_check_docs_sw() {\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "check list is data|docs-sw"
  ],
  "red": "server ccrc-doctor -t 'check list is data|docs-sw': 16 failed | 2 passed | 886 skipped (904) — 'every name in the table has a _check_<name> function, and vice versa' (MISSING _check_docs-sw, ORPHAN _check_docs_sw) and every docs-sw case that runs the check (command not found)"
 },
 {
  "id": "W4-T10-M10",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "CCRC_DOCS_PAGE_PREFIX='/docs'\n",
  "new": "CCRC_DOCS_PAGE_PREFIX='/docs'\nCCRC_DOCS_PAGE_PREFIX='/docs'\n",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 2 failed | 52 passed (54) — 'is assigned on exactly one line, and its value is DOCS_PAGE_PREFIX' (['/docs', '/docs']) and 'the quoted prefix appears once in the whole file: the assignment' (2)"
 },
 {
  "id": "W4-T10-M11",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "CCRC_DOCS_PAGE_PREFIX='/docs'\n",
  "new": "CCRC_DOCS_PAGE_PREFIX='/doc'\n",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 2 failed | 52 passed (54) — 'is assigned on exactly one line, and its value is DOCS_PAGE_PREFIX' (['/doc']) and 'the quoted prefix appears once in the whole file: the assignment' (0)"
 },
 {
  "id": "W4-T10-M12",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  local p=\"$CCRC_DOCS_PAGE_PREFIX\" sw=",
  "new": "  local p='/docs' sw=",
  "tests": [
   "test/docs-parity.test.ts"
  ],
  "red": "server docs-parity: 2 failed | 52 passed (54) — 'the quoted prefix appears once in the whole file: the assignment' (2) and '_check_docs-sw reads the variable and never spells the prefix'"
 },
 {
  "id": "W4-T10-M13",
  "pkg": "server",
  "file": "server/test/installTreeFixture.ts",
  "old": "  'server/dist-pwa/sw.js': swJs(),\n",
  "new": "",
  "tests": [
   "test/ccrc-install.test.ts",
   "-t",
   "ends with doctor, and a box that passes every check exits 0"
  ],
  "red": "server ccrc-install -t 'ends with doctor, ...': 1 failed | 317 skipped (318) — 'ccrc install: the landing block, and doctor as the last word > ends with doctor, and a box that passes every check exits 0' (the closing doctor FAILs docs-sw: no service worker at $HOME/ccrc/server/dist-pwa/sw.js)"
 },
 {
  "id": "W4-T10-M14",
  "pkg": "server",
  "file": "server/test/ccrc-doctor.test.ts",
  "old": "  writeFileSync(join(home, 'ccrc', 'server', 'dist-pwa', 'sw.js'), swJs());\n  return home;\n",
  "new": "  return home;\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 5 failed | 11 passed | 888 skipped (904) — 'PASSes the default bundle healthy() plants, ...', 'FAILs an absent worker with ccrc update --force', 'FAILs a worker it cannot read with ccrc update --force, never a WARN', 'runs on a server and on a both box: the role does not excuse either', 'a whole healthy doctor run PASSes docs-sw, and the healthy skip count does not move (M7.6)' (healthy() itself FAILs docs-sw)"
 },
 {
  "id": "W4-T10-M15",
  "pkg": "server",
  "file": "server/test/ccrc-update.test.ts",
  "old": "  writeFileSync(join(tree, 'server', 'dist-pwa', 'sw.js'), swJs());\n",
  "new": "",
  "tests": [
   "test/ccrc-update.test.ts",
   "-t",
   "^ccrc update: t"
  ],
  "red": "server ccrc-update -t '^ccrc update: t': 4 failed | 123 passed | 387 skipped (514) — 'the floor, on every path ... > END TO END: a real update whose gate failed and restored ...', 'the migration keeps the old tree until the gate ... > a pre-W6 box migrates inside the staged spine ...' and '--no-gate measured nothing ...', 'the codex steps ride the staged spine ... > an update re-runs both codex steps ...' (each closing doctor FAILs docs-sw: no service worker at $HOME/ccrc/server/dist-pwa/sw.js)"
 },
 {
  "id": "W4-T10-M16",
  "pkg": "server",
  "file": "ccd/ccrc-doctor-checks",
  "old": "  if [ -z \"${BOX_TREE_DIR:-}\" ] || ! declare -F _box_env_value >/dev/null 2>&1; then\n",
  "new": "  if false; then\n",
  "tests": [
   "test/ccrc-doctor.test.ts",
   "-t",
   "docs-sw"
  ],
  "red": "server ccrc-doctor -t docs-sw: 1 failed | 15 passed | 888 skipped (904) — 'says so, rather than guessing, when ccrc's own tree path and config reader are not loaded' (no verdict line: the check runs on without ccrc, and set -u stops it on BOX_TREE_DIR)"
 }
]
```

---

### Task 11: Whole-branch review and its fix wave, held out, before the close

**Model routing:** `sonnet`, effort `high`, for every fix implementer; the five lens reviewers and the conformance pass on `opus`, effort `high`; one refute pass per finding on `sonnet`; the main loop (Opus) rules every finding and never delegates a ruling. Every subagent's `model` is passed explicitly (never inherited, never Fable), no workflow. This task carries no code of its own: the panel reads the tree exactly as Tasks 1-10 left it, and a file changes here only for a CONFIRMED in-scope finding. Every count below was measured on the shared scratch tree at Task 10's state, on node v24.14.1, under a load average between 40 and 86 (the fleet box's ordinary load while other sessions run their suites).

**Spec rows:** none of its own. The panel reads the wave against every row the earlier tasks pin (§4.15's M4.R1, M4.R3, M4.M1, M4.M2, M4.P1-P8, M4.P10-P12, M4.H1, M4.B1, M4.B3, M4.B4, M4.C1-C3; §7.10's M7.2, M7.3 (doctor half), M7.5, M7.6 (`docs-sw`), M7.9) and the refinements (a)-(z).

**Files:**
- Create (gitignored, never committed: `.superpowers/` is in `.gitignore`): `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review.md`, the review record, and `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review/` (the reviewers' reports, the refute verdicts and the row measurements, copied out of scratch because the fleet box's `/tmp` reaper deletes files older than 12 h, and `$HOME/.cc-tmp` is not backed up).
- Create (scratch only, under `$HOME/.cc-tmp/docs-w4-t11`, never in the worktree and never `/tmp`): the tools `tools/w4rows.py`, `tools/anchors.py`, `tools/rows.py`, the copy `copy/`, and the reviewers' outputs under `review/`.
- Modify (Step 5, only for a CONFIRMED in-scope finding of the live panel): the W4 file it names, within Global Constraints' scope list; the test file that owns its area (Step 5's table), appended at its END; this plan's Task 11 rows block (the JSON array at the end of this task); and, only for a coordinator-ruled spec departure, this plan's `## Deviations found` (the next unspent number of the issued block).
- Test (guards, Step 0 and Step 6): every W4 PWA test file (the 21 of Step 0), the whole PWA suite, the PWA `tsc`, `server/test/docs-parity.test.ts`, `server/test/deploy-coordinates.test.ts`, `server/test/ccrc-doctor.test.ts -t docs-sw`, `macos-platform`, `source-bytes`, `single-definition`, `session-hook.test.ts`'s citation audit, `topology-clean`, `typecheck-tests`, `deviation-refs`, `dtbd`; and, only when a fix touches `ccd/ccrc-doctor-checks` or a fixture that plants `sw.js`, the `ccrc-install` and `ccrc-update` slices of Step 6.

A fix's Find blocks are written by the fix itself, quoted from the file as the previous commit left it and unique in it, located by content. If one is absent or not unique, stop and put an ask to the coordinator.

**Interfaces:**
- Consumes:
  - The branch at Task 10's tip (Step 8's commit, the plan's `## Deviations found`); `BASE`, the wave's base sha recorded in the SDD ledger at Task 1 Step 0; this plan (`docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`) with the mutation rows block of each of Tasks 1-10 (186 row objects, 171 distinct ids: a later task's re-anchor repeats an id and supersedes it); the spec (`docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`), the sections in this plan's Spec line; the five lenses of "How this wave runs".
  - The names the panel reads: `pwa/src/lib/markdown.tsx` (`IMG_EXT`, `isImageUrl`, `isRefusedChatImageSrc(src: string | undefined): boolean`, `absolute`, `openExternal`, `LANG_LABEL`, `nodeText`, `keystrokeParts`, `CodeBlock({children, highlight})`, `TableWrap`, `SHARED_COMPONENTS`, `CHAT_COMPONENTS`, `chatPlainNote(o: Exclude<ParseOutcome, {kind: 'tree'}>): string`, `MsgPlain({text, note})`, `ChatMarkdown({text, parser})`); `markdownLimits.ts` (the eleven limits); `markdownGuard.ts` (`PrescanResult`, `PrescanLimits`, `prescanWithin`, `prescanMarkdown`, `utf8ByteLength`); `markdownParse.ts` (`MarkdownProfile`, `ParseOutcome`, `settleHast`, `parseMarkdown`, `parseWithoutPrescan`, `MarkdownJob`, `MarkdownReply`, `answerMarkdownJob`); `markdownRunner.ts` (`MarkdownParser`, `WorkerLike`, `MarkdownRunnerDeps`, `MarkdownRunner`, `defaultSpawn`, `createMarkdownRunner`, `docsRunner`, `chatRunner`); `markdownWorker.ts`; `renderHast.tsx` (`RenderHastOptions`, `renderHast`); `useParsedMarkdown.ts` (`ParsedMarkdown`, `useParsedMarkdown`); `remarkAlerts.ts` (`remarkAlerts`); `components/RenderBoundary.tsx` (`RenderBoundaryProps`, `RenderBoundary`, `RootFallback`, `ScreenFallback`); `router.ts` (`navigate(href, opts?: {replace?: boolean})`, `Loc`, `useLocation`, `usePath`); `sw-denylist.ts` (`swDenylist`); `ccd/ccrc-doctor-checks` (`CCRC_DOCS_PAGE_PREFIX`, `_check_docs-sw`); `server/test/swFixtures.ts` (`SW_DENYLIST_DEFAULT`, `swJs(denylist?)`).
  - Test helpers a fix's appended case may use, each at its file's module scope: `markdown-runner.test.ts`'s `FakeWorker`, `FakeClock`, `track(p)`, `flush()`, `harness()`, `CHAT`, `answer(n)`; `chat-hardening.test.tsx`'s `bubble(text, streaming?)`, `assistant(text, streaming?)`, `countChatParses()`, `deferChatParses()`, `answer(calls, i, outcome?)`, `plainOf(c)`, `noteOf(c)`, `longText(head, n?)`, `UNAVAILABLE`, `TAB`; `use-parsed-markdown.test.tsx`'s `deferredParser()`, `treeOf(label)`, `tree(t)`, `TIMEOUT`, `mount(parser, props, strict?)`, `settle(call, outcome)`; `markdown-guard.test.ts`'s `deepQuote(n)`, `ok`; `markdown-parse.test.ts`'s `nodes(tree)`, `treeOf(o)`, `nestedEmphasis(levels)`, `KIB`; `render-hast.test.tsx`'s `treeOf(o)`, `viaMarkdown(src)`, `viaRenderHast(src)`; `render-boundary.test.tsx`'s `boom`, `Thrower`, `show(e)`, `arm(what)`; `router-location.test.tsx`'s `LocProbe`, `PairProbe`, `PathProbe`, `last(xs)`; `sw-denylist.test.ts`'s `denies(list, url)`, `refusal(p)`, `attempt(extra)`; `chat-item-boundary.test.tsx`'s `ChatListInner`, `assistant(uuid, text)`, `toolUse(uuid, toolId)`, `three(middle)`, `THROW_MARK`, `NOTE`; `app-detail-boundary.test.tsx`'s `App`, `boom`, `FALLBACK`, `detail()`; `ccrc-doctor.test.ts`'s `healthy(prefix)`, `runDoctor(home, args?, extraEnv?)`, `doctorEnv(home)`, `writeCcrcEnv(home, text)`, `writeUnitFile(home, unit)`, `swJs`, `SW_DENYLIST_DEFAULT`.
- Produces:
  - The review record and its evidence directory (gitignored); the fix commits, each `<area>: <what> (docs W4 review)`; and, only for a fixed finding, this task's rows `W4-T11-M<k>` (from M1) and any re-anchored earlier row (same id, superseding the earlier block's: Task 12's extractor keys rows by id and keeps the LAST occurrence, in task order).
  - Three scratch tools Task 12 may reuse: `w4rows.py`'s `read_rows(plan_path, tasks) -> dict[str, dict]`, `anchors.py <plan> <root>` (prints `<n> rows; <k> not exactly once`) and `rows.py <plan> <copy> <task> [id ...]`.

- [ ] **Step 0: Preconditions, the baseline, and the record.** From the worktree root, foreground, Bash timeout 600000 ms.

```bash
P=docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
test -z "$(git status --porcelain)" && grep -q '^_check_docs-sw() {$' ccd/ccrc-doctor-checks && grep -q "^CCRC_DOCS_PAGE_PREFIX='/docs'$" ccd/ccrc-doctor-checks && test -f server/test/swFixtures.ts && test -f pwa/src/components/RenderBoundary.tsx && ! grep -rqF 'T11 review' pwa/test server/test && test "$(grep '^## ' "$P" | tail -1)" = '## Deviations found' && test "$(awk '/^## Deviations found$/{buf=""; f=1} f{buf=buf $0 "\n"} END{printf "%s", buf}' "$P" | grep -c '^- \*\*D-[0-9][0-9]* (')" -ge 4 && echo T11-BASE-OK
git rev-parse HEAD
```

Expected: `T11-BASE-OK` (Task 10's `docs-sw` and its prefix are in, no review case exists yet, the plan's last `## ` heading is the `## Deviations found` Task 10 Step 8 appended, and it holds at least the four issued entries), then Task 10's Step 8 commit sha: record it in the SDD ledger as `T10_TIP`. If `T11-BASE-OK` does not print, stop and put an ask to the coordinator. A fix that edits a claimed file (How this wave runs) re-takes its claim first (worker skill clause 11, `~/.local/bin/ccrc-api claims take`; a claim lapses at its hard cap, so an earlier task's may have ended): a 409 names the holder, and the file is not edited until that claim ends or the two coordinators confirm a scoped agreement.

Prove the two frozen inputs before anyone reads (`BASE` typed from the SDD ledger):

```bash
BASE=<BASE>
T1=$(git log --format=%H --diff-filter=A -- pwa/test/markdown-golden.test.tsx | tail -1); echo "$T1"
git diff --quiet "$T1" HEAD -- pwa/test/golden/ pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx && echo GOLDEN-FROZEN
git diff --quiet "$BASE" HEAD -- pwa/test/message-links.test.tsx && echo LINKS-UNMODIFIED
git diff --name-only "$BASE" HEAD -- shared server/src agent .github ccd/ccd ccd/ccrc README.md CLAUDE.md server/test/single-definition.test.ts pwa/src/lib/api.ts | wc -l
```

Expected: Task 1's commit sha, `GOLDEN-FROZEN`, `LINKS-UNMODIFIED`, `0`. Any other answer is a finding against Tasks 2-10: write it into the record as `A-<k>` (Step 1) and rule it in Step 4 like any other.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/remark-alerts.test.ts test/markdown-limits.test.ts test/markdown-guard.test.ts test/markdown-parse.test.ts test/markdown-purity.test.ts test/render-hast.test.tsx test/markdown-highlight.test.tsx test/markdown-worker.test.ts test/markdown-runner.test.ts test/use-parsed-markdown.test.tsx test/chat-hardening.test.tsx test/router-location.test.tsx test/app-pane-reset-timing.test.tsx test/render-boundary.test.tsx test/root-boundary.test.tsx test/app-detail-boundary.test.tsx test/chat-item-boundary.test.tsx test/tap-targets.test.tsx test/sw-denylist.test.ts test/message-links.test.tsx )`
Expected: `Test Files  21 passed (21)`, `Tests  557 passed (557)`: markdown-golden 169, remark-alerts 6, markdown-limits 24, markdown-guard 46, markdown-parse 13, markdown-purity 7, render-hast 72, markdown-highlight 8, markdown-worker 18, markdown-runner 34, use-parsed-markdown 9, chat-hardening 48, router-location 11, app-pane-reset-timing 5, render-boundary 11, root-boundary 2, app-detail-boundary 6, chat-item-boundary 4, tap-targets 42, sw-denylist 16, message-links 6. `CI=1` makes the golden test compare and never write a missing snapshot file. If `main` moved a count in a file W4 did not create (`tap-targets`, `sw-denylist`, `message-links`, `app-pane-reset-timing`), what binds is that each Step 5 case adds to its own file's count and nothing else moves.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/deploy-coordinates.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  67 passed (67)` (docs-parity 54, deploy-coordinates 13).

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'docs-sw' )`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed | 888 skipped (904)`.

Create the record, `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review.md`, with exactly this content (`<T10_TIP>` and `<BASE>` are the two shas above, typed from the ledger):

```markdown
# W4 Task 11 — whole-branch review record

Base: <BASE>. Task 10's tip: <T10_TIP>. Panel tip: (Step 1 fills this).

| id | lens | file:line | claim | refute verdict | ruling | outcome | rows |
|---|---|---|---|---|---|---|---|
| R1 | 2 untrusted Markdown | pwa/src/lib/markdown.tsx:52 | a path-relative image source (`../api/x`, which resolves to `/api/x` from `/s/<id>`) is not refused by `isRefusedChatImageSrc` | — (planning) | NOT A DEFECT in this wave: refinement (k) applies the spec's U3 clause as written (root-relative and protocol-relative). Widening it, or narrowing chat to absolute http(s) sources only, is the operator's open question; `isRefusedChatImageSrc` is the one function a ruling changes | none | none |
| R2 | 3 worker and runner | pwa/src/lib/markdown.tsx:294 | a streaming message crossing 4 096 UTF-8 bytes, and a message Virtuoso remounts, shows `.msg-plain` for one frame | — (planning) | NOT A DEFECT: refinement (i) chose two components with no cache across remounts and recorded the frame | none | none |
| R3 | 5 build and mutation table | pwa/src/lib/markdownWorker.ts:16, pwa/src/lib/markdownRunner.ts:161 | both files call `postMessage(` and assign `onmessage`, which W6's M5.16 reds the day it lands | — (planning) | CARRIED: refinement (w); to W6 and the Share/Export spec amendment, which edits M5.16 | none | none |
| R4 | 1 chat unchanged | pwa/src/lib/markdown.tsx:268 | swapping `[remarkGfm, remarkAlerts]` to `[remarkAlerts, remarkGfm]` reddens no case | — (planning) | NOT A DEFECT: an equivalent mutant (`remark-gfm` 4.0.1 returns no transformer), refinement (b), defined in `## Deviations found` | none | none |
```

- [ ] **Step 1: Record the panel tip, make the copy, and write the three row tools.** Never in the worktree. `<SCRATCH>` is `$HOME/.cc-tmp/docs-w4-t11` (not `/tmp`: the fleet box reaps it after 12 h); the tools live in `<SCRATCH>/tools`, outside the copy. From the worktree root; an agent's shell keeps no variable between calls, so every later call that names `$SCRATCH` sets `SCRATCH="$HOME/.cc-tmp/docs-w4-t11"` first.

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t11"; mkdir -p "$SCRATCH/tools" "$SCRATCH/review" && rm -rf "$SCRATCH/copy" && mkdir "$SCRATCH/copy"
TIP=$(git rev-parse HEAD); echo "$TIP"
git archive HEAD | tar -x -C "$SCRATCH/copy" && git -C "$SCRATCH/copy" init -q
ln -s "$PWD/pwa/node_modules" "$SCRATCH/copy/pwa/node_modules"
ln -s "$PWD/server/node_modules" "$SCRATCH/copy/server/node_modules"
```

Fill the record's `Panel tip` with `$TIP`: Task 10's tip, the tree the panel reads. Then write the three tools. `<SCRATCH>/tools/w4rows.py` is the one reader of the plan's rows blocks. It decodes each block with `raw_decode` from the character after the opening fence and never searches for the closing fence, because Task 3's rows W4-T3-M6 and W4-T3-M7 carry a code fence inside their `old`/`new` strings (measured: a reader that cuts at the next fence fails on Task 3 with `JSONDecodeError: Unterminated string`):

```python
import json, re
# The rows marker and the code fence are built from parts, so this file never spells either one whole and no
# parser of the plan can mistake this file's text for a task's rows.
MARK = '**Mutation rows' + ' this task contributes**'
FENCE = '`' * 3


def read_rows(plan_path, tasks):
    """The rows blocks of the given task numbers, in task order; a repeated id keeps its LAST occurrence.

    Each array is read with raw_decode from the first character after its opening fence, never by searching for
    the closing fence: a row whose old or new text spells a code fence (Task 3's fence rows do) would cut the
    array short.
    """
    wanted = set(tasks)
    text = open(plan_path, encoding='utf-8').read()
    heads = [(m.start(), int(m.group(1))) for m in re.finditer(r'^### Task (\d+): ', text, re.M)]
    rows = {}
    for i, (start, n) in enumerate(heads):
        if n not in wanted:
            continue
        section = text[start:heads[i + 1][0] if i + 1 < len(heads) else len(text)]
        if MARK not in section:
            continue
        marker = section.index(MARK)
        body = section.index(FENCE + 'json', marker) + len(FENCE + 'json')
        decoded, _ = json.JSONDecoder().raw_decode(section[body:].lstrip())
        for row in decoded:
            rows[row['id']] = row
    return rows
```

`<SCRATCH>/tools/anchors.py` (the conformance pass, lens 5 and Step 6 run it) checks every row of Tasks 1-11 against a tree:

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from w4rows import read_rows
# usage: anchors.py <plan> <root>. Tasks 1-11 only: Task 12 adds no guard, and its prose is not read.
plan, root = sys.argv[1], sys.argv[2]
rows = read_rows(plan, range(1, 12))
bad = 0
for rid, row in rows.items():
    path = os.path.join(root, row['file'])
    count = open(path, encoding='utf-8').read().count(row['old']) if os.path.exists(path) and row['old'] else -1
    if count != 1:
        bad += 1
        print(f'{rid} {row["file"]} count={count} old={row["old"][:100]!r}')
print(f'{len(rows)} rows; {bad} not exactly once')
```

`<SCRATCH>/tools/rows.py` runs rows of one task alone in a copy and restores each file byte for byte, its mode included (`ccd/ccrc-doctor-checks` is 100755):

```python
import os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from w4rows import read_rows
# usage: rows.py <plan> <copy> <task-number> [id ...]   (no ids: every row of that task's block)
plan, copy, task = sys.argv[1], sys.argv[2], int(sys.argv[3])
only = set(sys.argv[4:])
for rid, row in read_rows(plan, [task]).items():
    if only and rid not in only:
        continue
    target = os.path.join(copy, row['file'])
    original = open(target, encoding='utf-8').read()
    if original.count(row['old']) != 1:
        print(rid, 'ANCHOR', original.count(row['old']))
        continue
    mode = os.stat(target).st_mode
    open(target, 'w', encoding='utf-8').write(original.replace(row['old'], row['new']))
    # CI=1 for the PWA only: the golden test writes a MISSING snapshot file outside CI, and a row must never
    # write one into the copy. The server suites read CI for other things, so they run with the caller's env.
    env = dict(os.environ, CI='1') if row['pkg'] == 'pwa' else dict(os.environ)
    try:
        out = subprocess.run(['./node_modules/.bin/vitest', 'run', *row['tests']], cwd=os.path.join(copy, row['pkg']),
                             capture_output=True, text=True, timeout=540, env=env).stdout
    except subprocess.TimeoutExpired:
        out = 'TIMEOUT after 540 s'
    finally:
        open(target, 'w', encoding='utf-8').write(original)
        os.chmod(target, mode)
    out = re.sub(r'\x1b\[[0-9;]*m', '', out)
    summary = [l.strip() for l in out.splitlines() if re.match(r'\s+Tests\s', l)] or [l for l in [out] if l.startswith('TIMEOUT')]
    failed = [l.strip() for l in out.splitlines() if l.strip().startswith('×')]
    print(rid, summary, *failed, sep='\n    ')
```

Run at most one server row per Bash call, except rows on `docs-parity.test.ts`, which take seconds (the pair below). A `TIMEOUT` row is re-run alone once; if it repeats, it is a finding.

Prove the tools on the tree before anyone relies on them:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t11"; P=docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
python3 "$SCRATCH/tools/anchors.py" "$P" .
python3 "$SCRATCH/tools/rows.py" "$P" "$SCRATCH/copy" 10 W4-T10-M10 W4-T10-M11
python3 "$SCRATCH/tools/rows.py" "$P" "$SCRATCH/copy" 6 W4-T6-M1
cmp "$SCRATCH/copy/ccd/ccrc-doctor-checks" ccd/ccrc-doctor-checks && cmp "$SCRATCH/copy/pwa/src/lib/markdown.tsx" pwa/src/lib/markdown.tsx && echo RESTORED
```

Expected: `171 rows; 0 not exactly once` (Tasks 1-10's 186 row objects, 171 distinct ids; this task's block is empty until a Step 5 fix appends a row). Then `W4-T10-M10` and `W4-T10-M11` each `['Tests  2 failed | 52 passed (54)']` with `× is assigned on exactly one line, and its value is DOCS_PAGE_PREFIX` and `× the quoted prefix appears once in the whole file: the assignment`; `W4-T6-M1` `['Tests  2 failed | 46 passed (48)']` with `× an assistant '>'.repeat(4000) renders .msg-plain with its container-depth note, and never reaches the runner` and `× a 4 096-run of * renders .msg-plain with its delimiter-run note` (the reds Tasks 10 and 6 recorded); then `RESTORED`. A non-zero `not exactly once` count, or a red that differs from its recorded `red`, is a finding against the plan: put it in the record as `A-<k>` and rule it in Step 4 like any other.

- [ ] **Step 2: Dispatch the panel: five lens reviewers and one conformance pass, `opus`, effort `high`.** Six native subagents in ONE message (they are independent), each READ-ONLY on the worktree. Each prompt is the shared preamble below followed by its block, with `<WT>` (this worktree's absolute path), `<BASE>`, `<TIP>` (Step 1) and `<SCRATCH>` (the absolute path `$SCRATCH` expands to) replaced by their measured values. Say in the dispatching message: "6 reviewers on opus, effort high".

Shared preamble (verbatim):

```text
You are one reviewer of a six-reviewer panel reading ONE finished wave of the ccrc repository before it closes.
Worktree: <WT> (read only: never edit, stage, commit, checkout, stash or reset there). Wave base: <BASE>. Tip you
review: <TIP>. The change: `git -C <WT> diff <BASE> <TIP>` and `git -C <WT> log --oneline <BASE>..<TIP>`.
The plan: <WT>/docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md (read its Global
Constraints, Spec refinements (a)-(z) and Review Focus first; Tasks 1-10 built the wave, Task 11 adds no code of
its own). The binding spec: <WT>/docs/superpowers/specs/2026-10-01-native-docs-reader-design.md (the sections named
in the plan's Spec line). Repository rules: <WT>/CLAUDE.md (rings are a property of a file's imports, no
overloaded null at a seam, single-source values, a guard ships with a case that reds when it is deleted).
Rules: never run `ccd` against any real HOME, never call a running ccrc server, never touch tmux or ~/.cc-sessions,
never print a secret file. You may run a single test file in the FOREGROUND from <WT>/pwa with
`CI=1 ./node_modules/.bin/vitest run test/<file>` (CI=1 so the golden test never writes a snapshot file) or from
<WT>/server with `./node_modules/.bin/vitest run test/<file>` (never bare npx; split ccrc-doctor.test.ts with -t).
Never put a CCRC_SW_DENYLIST covering /docs in a PWA test run's environment: the vite config, which vitest also
loads, refuses it and every file dies at config load. To prove a defect, write a throwaway case in a COPY:
`mkdir -p <SCRATCH>/review-<lens>; git -C <WT> archive <TIP> | tar -x -C <SCRATCH>/review-<lens>; ln -s
<WT>/pwa/node_modules <SCRATCH>/review-<lens>/pwa/node_modules; ln -s <WT>/server/node_modules
<SCRATCH>/review-<lens>/server/node_modules`, never in <WT>. Fixtures use placeholders only (demo, a, b, main,
ws/a, example.com, example-org/example-repo), never a real host, user or project.
Already ruled (do not re-report unless you have a NEW failure scenario): R1, a path-relative image source
(`../api/x`) is not refused by isRefusedChatImageSrc, which applies the spec's U3 clause as written; widening it,
or narrowing chat to absolute http(s) sources only, is an OPEN operator question, so report a new spelling only as
a scenario and never propose either change as a fix. R2, the one-frame .msg-plain when a streaming message crosses
4 096 bytes or Virtuoso remounts a message (refinement (i)). R3, markdownWorker.ts and markdownRunner.ts call
postMessage( and assign onmessage, which W6's M5.16 will red (refinement (w), carried). R4, swapping remarkGfm and
remarkAlerts is an equivalent mutant (refinement (b)). The four spec departures the plan's `## Deviations found`
defines (refinements (a), (b), (c), (d)), and every item under Global Constraints' "Carried into W4".
Report ONLY defects: behaviour that is wrong for a concrete input, a guard that a concrete mutation would not
redden, a ring or census rule broken, a spec row the wave claims but does not deliver. No style notes, no
suggestions without a failure. Return ONE JSON array, nothing else, each element:
{"id": "<lens>-<k>", "lens": <n>, "file": "<repo-relative path>", "line": <n>, "claim": "<one sentence>",
 "scenario": "<concrete input or interleaving -> the wrong HTML, outcome, verdict, build result or crash>",
 "spec": "<section or row, or 'none'>", "evidence": "<the command you ran and what it printed, or 'reasoning'>",
 "severity": "high" | "medium" | "low"}
An empty array is a valid answer.
```

Lens 1 block (verbatim): `Lens 1, chat unchanged by the extraction. First prove the frozen inputs: the commit that added pwa/test/markdown-golden.test.tsx (git -C <WT> log --format=%H --diff-filter=A -- pwa/test/markdown-golden.test.tsx) and <TIP> must agree on every pwa/test/golden/markdown/*.html, on pwa/test/markdownCorpus.ts and on the golden test itself (git -C <WT> diff --stat <that sha> <TIP> -- pwa/test/golden pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx prints nothing), and pwa/test/message-links.test.tsx must be byte-equal to <BASE>'s. Then read pwa/src/lib/markdown.tsx against <BASE>'s pwa/src/session/MessageBubble.tsx: every moved symbol (IMG_EXT, isImageUrl, absolute, openExternal, the hljs registrations and registerAliases, LANG_LABEL, nodeText, keystrokeParts, CodeBlock, TableWrap, the components) must behave as before for inputs the corpus does NOT cover, not only the ones it does; both Markdown sites in MessageBubble.tsx (the assistant body and FoldedCard's opened recap) must render through ChatMarkdown with nothing else changed around them. Check M4.P10 (render-hast.test.tsx): renderHast(tree, {components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform}) must equal react-markdown's own output for inputs outside the corpus too: a javascript: and a vbscript: link, a data: image, an autolink, a footnote reference and its back-reference, a table with alignment, an empty link, a link with a title. Check the worker closure's purity (markdown-purity.test.ts): it must read the whole import closure of markdownLimits, markdownGuard, remarkAlerts, markdownParse and markdownWorker through ts.preProcessFile; find a spelling it misses (a dynamic import(), an export ... from, an import type that is not erased under verbatimModuleSyntax, a require). Check remarkAlerts.ts is iterative (no recursion reachable from its transformer) and agrees with remark-alerts.test.ts's recursive oracle on nested and emptied callouts.`

Lens 2 block (verbatim): `Lens 2, untrusted Markdown. Treat every chat message as hostile. The pre-scan (pwa/src/lib/markdownGuard.ts, section 4.10): fences opened by 3 or more backticks or tildes at up to 3 spaces and closed by the same character at least as long; an unclosed fence; a fence opened inside a list item or a quote; tabs as indentation; CRLF and lone CR line ends; ordered markers of 1 to 9 digits and of 10 or more; '>' with and without its optional space; runs of '*' and '_' interleaved or split by a backslash. Find any input over MD_MAX_CONTAINER_DEPTH or MD_MAX_DELIMITER_RUN that passes the pre-scan and then overflows the stack, runs the synchronous chat path past a frame, or reaches react-markdown in SyncChatMarkdown. The parse (markdownParse.ts): every raw node becomes text (no live element from <img src=x onerror=alert(1)>, <script>, <iframe>, <svg onload=...>, <a href=javascript:...>, an HTML comment, a CDATA section); the depth and element caps (MD_MAX_TREE_DEPTH, DOCS_MAX_RENDER_ELEMENTS) count what renders and refuse before any renderHast call; threw carries error.name only, never a message that could echo input. The highlight cap (CodeBlock): MD_HIGHLIGHT_BLOCK_MAX_CHARS inclusive, the label of refinement (l), and no highlight of an over-cap block on either chat path. The image predicate (isRefusedChatImageSrc, CHAT_COMPONENTS.img and CHAT_COMPONENTS.a): find any source a browser resolves root-relative or protocol-relative that chat still draws as an <img>: leading ASCII whitespace or C0 controls, a mix of '/' and '\', a reference-style image ![x][r] with [r]: //h.example/x.png, an autolink <//h.example/x.png>, a bare /x.png link the auto-embed reaches, an image inside a link, and each of these on the worker path as well as the synchronous one, judged on the value after defaultUrlTransform. Also find any https image or link case message-links.test.tsx pins that now renders differently.`

Lens 3 block (verbatim): `Lens 3, the worker and the runner. Read pwa/src/lib/markdownRunner.ts, markdownWorker.ts, markdownParse.ts's answerMarkdownJob and useParsedMarkdown.ts. For each pair of events among post, reply, a reply with a stale id, the budget timer, error, messageerror, an abort while queued, an abort while running, dispose and a spawn that throws, find an interleaving that resolves or rejects a job twice, never settles one, posts two jobs to one worker at once, lets a stale id settle the running job, leaves a timer armed after its job settled, leaves a dropped worker's handlers live, or makes worker-unavailable anything but sticky. Check the budget timer starts at post, not at enqueue (a chat job queued behind another is not charged its wait); that docsRunner and chatRunner are two independent runners with their own workers (chat is never delayed by a 30 000 ms docs job); that a DataCloneError on the worker's post becomes threw (section 4.10) and a postMessage that throws on the main thread becomes worker-failed; and that defaultSpawn keeps the literal new Worker(new URL('./markdownWorker.ts', import.meta.url), { type: 'module' }) Vite's static analysis needs. The hook (useParsedMarkdown): at most one running and one queued job per hook, the queued one replaced by newer text, the last good tree kept, no state update after unmount, StrictMode's double effects not doubling a job or leaking one, a changed budgetMs or attempt parsing again, and an aborted job's AbortError never surfacing as an outcome. Then ChatMarkdown's render order (refinement (i)) under a streaming message whose text changes faster than the worker answers.`

Lens 4 block (verbatim): `Lens 4, boundaries and the router. pwa/src/components/RenderBoundary.tsx: getDerivedStateFromError; the resetKey reset through getDerivedStateFromProps (the fallback stays until the key changes and clears when it does, under StrictMode's double render, and shows again when the child throws on the new key); a thrown undefined or null still shows the fallback (no overloaded null); componentDidCatch logs console.warn('ccrc: render error in ' + where, error). The three mounts: main.tsx around <App/> with a constant key and RootFallback's Reload; app.tsx around the detail ladder INSIDE <section className="shell-detail">, keyed path + search, so .shell-nav, the login overlay and the toasts survive a throwing screen and ScreenFallback's Back to the fleet navigates to '/'; ChatList.tsx's ChatItemView per item, keyed by the message text (a message) or the item key (any other kind), inside Virtuoso (a recycled row, a remount, a streaming message that throws on one chunk and renders on the next, a non-message item that throws). The router (pwa/src/lib/router.ts, section 4.2): useLocation is useState plus a popstate listener, never useSyncExternalStore; a navigate that changes only the search re-renders every useLocation consumer; replace uses history.replaceState and adds no history entry; push and replace take the same view-transition and flushSync path; usePath callers see no change; app.tsx's scroll reset runs on [path, search]. Find any consumer in pwa/src that still reads location.pathname or location.search directly and so misses a search-only navigation, and any boundary whose fallback hides the control that would leave it. The fallback buttons must keep the tap-target floor (tap-targets.test.tsx) and .render-fallback must paint its own ground (refinement (n)).`

Lens 5 block (verbatim): `Lens 5, build, deploy, doctor and the mutation table. pwa/src/lib/sw-denylist.ts: swDenylist must throw the section 7.3 sentence for every NORMALISED entry equal to or under DOCS_PAGE_PREFIX (try /docs, docs, ' /docs/ ', /docs/x, '/wiki,/docs', //docs, /docs//x, /docs?x) and accept /docsy and /docs-archive; it imports DOCS_PAGE_PREFIX from shared/docs and declares no second copy. Its header comment and docstring, and vite.config.ts's co-tenant comment, keep their line counts against <BASE>; vite.config.ts's navigateFallbackDenylist line is byte-equal to <BASE>'s; deploy/deploy.sh differs from <BASE> by exactly two in-place lines, same line count, its export CCRC_SW_DENYLIST= line byte-equal. pwa/package.json gains exactly the five exact versions of section 4.1, and pwa/package-lock.json differs from <BASE> only in packages[""].dependencies (compare the parsed JSON with python3, not the text). docs-sw, at the end of ccd/ccrc-doctor-checks, measured against a REAL build: in your copy run `( cd <SCRATCH>/review-5/pwa && env -u CCRC_SW_DENYLIST npm run build )` (it writes <SCRATCH>/review-5/server/dist-pwa; expect one assets/markdownWorker-<hash>.js and a url:"assets/markdownWorker-<hash>.js" entry in sw.js), copy that dist-pwa to <SCRATCH>/fixhome/ccrc/server/dist-pwa, and run the check on it with `cd <SCRATCH>/review-5 && env -i PATH=/usr/bin:/bin HOME=<SCRATCH>/fixhome bash -c 'source ccd/ccrc-doctor-checks >/dev/null 2>&1; _box_env_value() { :; }; BOX_TREE_DIR="$HOME/ccrc"; BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"; CCRC_UNIT_DIR="$HOME/units"; _check_docs-sw; echo "rc=$?"'`, which must print a PASS line and rc=0 on the default build. Confirm server/test/swFixtures.ts's SW_DENYLIST_DEFAULT is byte-equal to the denylist:[...] text the real build emits. Then rebuild with CCRC_SW_DENYLIST=/wiki (the check still PASSes, now naming three entries, the third /^\/wiki(\/|$)/) and with CCRC_SW_DENYLIST='/wiki,/docs' (the build must fail rc 1 with the section 7.3 sentence), and hand-edit the planted sw.js into every shape workbox could emit for a covering entry and every shape the check calls unexpected; find any that PASSes while covering /docs, or FAILs /docsy. The table: run `python3 <SCRATCH>/tools/anchors.py <WT>/docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md <WT>` and include its output; then reproduce at least six rows' reds across Tasks 1-10 (one per package at least, and every row of one task that adds a text scan: Task 3's markdown-limits or markdown-purity rows, or Task 9's M7.9 rows) with `python3 <SCRATCH>/tools/rows.py <plan> <SCRATCH>/review-5 <task number> <id>` in YOUR copy; report any row whose red you cannot reproduce, whose old is not unique, or whose guard a different concrete mutation of the same line removes without a red.`

Conformance block (verbatim): `Pass 6, spec conformance and mutation discipline. Build a table with one line per row this wave claims (section 4.15's M4.R1, M4.R3, M4.M1, M4.M2, M4.P1, M4.P2, M4.P3, M4.P4, M4.P5, M4.P6, M4.P7, M4.P8, M4.P10, M4.P11, M4.P12, M4.H1, M4.B1, M4.B3, M4.B4, M4.C1, M4.C2, M4.C3; section 7.10's M7.2, M7.3 doctor half, M7.5, M7.6 for docs-sw, M7.9): the spec's required case and mutation, the test file and case title that pins it (grep it), and the plan's mutation row id(s) whose 'red' names that case. For the six rows refinement (a) splits (M4.R1, M4.B1, M4.P1, M4.P6, M4.P7, M4.P12), check that the W4 half is pinned on its W4 stand-in and that the plan writes the W5 half out verbatim for Task 12 to carry. Every row of the plan's rows blocks (Tasks 1-11, as anchors.py reads them; for a repeated id the LAST occurrence wins) must have an 'old' found exactly once in its 'file' at <TIP>: run `python3 <SCRATCH>/tools/anchors.py <WT>/docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md <WT>` and include its output. Report as a finding: a claimed row with no pinning case, a spec mutation with no plan row (other than refinement (b)'s equivalent mutant), a row whose red names no case of that row's tests, an anchor that is not unique, a guard a task's Guards line names with no row, any exact value of the plan's Global Constraints that the code restates instead of importing from markdownLimits.ts or shared/docs.ts, and every refinement (a)-(z) not applied where the plan says. Put the table in the 'evidence' of a finding with id 'conformance-table' and severity 'low' even when it shows no gap.`

Save each reviewer's JSON verbatim to `<SCRATCH>/review/lens-<n>.json` (`lens-6.json` for the conformance pass) and copy the directory into `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review/` on receipt.

- [ ] **Step 3: One refute pass per finding, `sonnet`.** For every element except `conformance-table`, dispatch one native subagent (`model: 'sonnet'`; independent findings in one message, at most eight at a time; say the count and model in the message). Prompt (verbatim, with the finding's JSON pasted where shown and the same `<WT>`, `<TIP>`, `<SCRATCH>`):

```text
You are a refuter. Your job is to show the finding below FALSE on the ccrc tree at <TIP> (worktree <WT>, read
only). Read the code it names and everything that calls it. Then try to reproduce it: copy the tree with
`mkdir -p <SCRATCH>/refute-<id>; git -C <WT> archive <TIP> | tar -x -C <SCRATCH>/refute-<id>; ln -s
<WT>/pwa/node_modules <SCRATCH>/refute-<id>/pwa/node_modules; ln -s <WT>/server/node_modules
<SCRATCH>/refute-<id>/server/node_modules`, write the smallest vitest case that would fail if the finding is true,
and run it in the FOREGROUND from <SCRATCH>/refute-<id>/pwa with `CI=1 ./node_modules/.bin/vitest run
test/<file>` or from <SCRATCH>/refute-<id>/server with `./node_modules/.bin/vitest run test/<file>` (split
ccrc-doctor.test.ts with -t). Never edit <WT>; never run ccd against a real HOME; never call a running server;
fixtures use placeholders only (demo, a, b, main, ws/a, example.com). Answer ONE JSON object, nothing else:
{"id": "<the finding's id>", "verdict": "CONFIRMED" | "PLAUSIBLE" | "REFUTED",
 "evidence": "<the case you wrote (full code) and the summary line it printed, or the exact code that makes the
 scenario impossible, with file:line>", "scope": "W4" | "outside-W4", "spec_behaviour_change": true | false,
 "operator_question": true | false}
CONFIRMED: your case fails on <TIP> as the finding says. REFUTED: you can name the code that prevents the scenario,
or your case passes and you show why it is the scenario. PLAUSIBLE: neither. scope is outside-W4 when the only fix
edits a file the plan's Global Constraints forbid this wave to edit (shared/, server/src/, agent/, ccd/ccd,
ccd/ccrc, .github/, README.md, CLAUDE.md, server/test/single-definition.test.ts, pwa/src/lib/api.ts,
pwa/test/message-links.test.tsx), a frozen golden input (pwa/test/golden/markdown/*, pwa/test/markdownCorpus.ts,
pwa/test/markdown-golden.test.tsx), or any file not on the plan's scope list. spec_behaviour_change is true when the
only fix changes a behaviour the spec's TEXT states (a limit, a sentence, an outcome, an order, a verdict it
spells), false when it fills a silence or restores the stated behaviour. operator_question is true when the fix
would decide which image sources chat refuses beyond root-relative and protocol-relative (the open question R1
names), or any other choice the plan's refinements leave to the operator.

The finding:
<paste the finding's JSON>
```

Save each answer to `<SCRATCH>/review/refute-<id>.json` and copy it into the evidence directory.

- [ ] **Step 4: Rule every finding (the main loop, never a subagent).** Add one table line per finding to the record (`id`, `lens`, `file:line`, `claim`, `refute verdict`, `ruling`, `outcome`, `rows`), ruled by the first line of this table that applies:

| Refute answer | Ruling | Next |
|---|---|---|
| `REFUTED`, and the main loop agrees after reading the evidence | NOT A DEFECT, the refuter's evidence in one sentence | none |
| any verdict, `operator_question: true` | an ASK to the operator (a structured ask, as the `ccrc-worker` skill puts every operator question: the finding, the refutation and the options, the spec's rule first); no edit in this wave until it is answered. A ruling that arrives before Task 12 is applied as a Step 5 fix in `isRefusedChatImageSrc` alone (the one predicate `img` and the auto-embed share); one that has not arrived is CARRIED and Task 12's results list it | Step 5 on a ruling; none otherwise |
| any verdict, `scope: outside-W4` | CARRIED: no edit (Global Constraints forbid it); the record names the file and the scenario, and Task 12's results list it under Carried with an owner wave (W5 for a Docs-screen half, W6 for M5.16, W7 for prose) | none |
| `CONFIRMED` or `PLAUSIBLE`, `spec_behaviour_change: true` | a QUESTION to the coordinator first: mail it (`~/.local/bin/ccrc-api mail send`, subject `docs W4 review <id>: spec departure?`, the finding, the refutation and the proposed fix); wait for the ruling; list mail before acting | if ruled a departure: Step 5 with a deviation entry; if ruled out: CARRIED or NOT A DEFECT as the coordinator says |
| `PLAUSIBLE`, W4, no spec change | the main loop writes the refuter's missing case itself in a copy; red: treat as CONFIRMED; green: NOT A DEFECT, with that case as evidence | Step 5 or none |
| `CONFIRMED`, W4, no spec change | FIX | Step 5 |

A finding whose fix would move a golden file, edit the corpus or `message-links.test.tsx`, add a stylesheet, add a `ccd` verb or a unit, change `HEALTHY_SKIPS`, edit `docs-parity.test.ts` above its last line, change a line of `ccrc-doctor.test.ts` above `healthy()`'s first line, or move a `ccd/ccrc-doctor-checks` line another file cites by number is CARRIED, never fixed here: Task 12's invariants would fail.

- [ ] **Step 5: The fix loop, one commit per confirmed finding.** For each FIX ruling, in severity order, dispatch one `sonnet` implementer (effort `high`) with the finding, the refutation and these rules, then review its diff in the main loop before the commit:

1. Red first. Append the case that pins the finding at the END of the test file that owns its area, in a describe titled `T11 review <id>: <claim>` (for the doctor, `T11 review <id>: docs-sw <claim>`, so `-t docs-sw` selects it):

   | Area | Test file |
   |---|---|
   | `markdownGuard.ts`, the pre-scan | `pwa/test/markdown-guard.test.ts` |
   | `markdownLimits.ts`, a limit's value or its single declaration | `pwa/test/markdown-limits.test.ts` |
   | `markdownParse.ts`'s parse, raw-to-text, the caps, `threw` | `pwa/test/markdown-parse.test.ts` |
   | `answerMarkdownJob`, `markdownWorker.ts` | `pwa/test/markdown-worker.test.ts` |
   | the worker closure's imports | `pwa/test/markdown-purity.test.ts` |
   | `remarkAlerts.ts` | `pwa/test/remark-alerts.test.ts` |
   | `renderHast.tsx`, M4.P10's parity | `pwa/test/render-hast.test.tsx` |
   | `CodeBlock`'s cap and label | `pwa/test/markdown-highlight.test.tsx` |
   | `markdownRunner.ts` | `pwa/test/markdown-runner.test.ts` |
   | `useParsedMarkdown.ts` | `pwa/test/use-parsed-markdown.test.tsx` |
   | `ChatMarkdown`, `isRefusedChatImageSrc`, `chatPlainNote`, `CHAT_COMPONENTS` | `pwa/test/chat-hardening.test.tsx` (never `message-links.test.tsx`, never the golden) |
   | `router.ts` | `pwa/test/router-location.test.tsx` |
   | `app.tsx`'s scroll reset | `pwa/test/app-pane-reset-timing.test.tsx` |
   | `RenderBoundary.tsx` | `pwa/test/render-boundary.test.tsx` |
   | `main.tsx` | `pwa/test/root-boundary.test.tsx` |
   | `app.tsx`'s detail boundary | `pwa/test/app-detail-boundary.test.tsx` |
   | `ChatList.tsx`'s item boundary | `pwa/test/chat-item-boundary.test.tsx` |
   | `.render-fallback`, `.msg-plain`, `.msg-plain-note`, `audit.mjs` | `pwa/test/tap-targets.test.tsx` for a tap target; `contrast.test.ts` is not on the scope list, so a contrast defect is fixed only when that file, unedited, already reds on it |
   | `sw-denylist.ts`, `vite.config.ts` | `pwa/test/sw-denylist.test.ts` |
   | `deploy/deploy.sh`'s two lines, M7.9 | `server/test/docs-parity.test.ts`, appended at its end |
   | `_check_docs-sw`, `CCRC_DOCS_PAGE_PREFIX`, `swFixtures.ts`, a fixture that plants `sw.js` | `server/test/ccrc-doctor.test.ts`, appended at its end (after the `ccrc doctor: docs-sw` describe); M7.3's text half in `server/test/docs-parity.test.ts`, appended at its end |

   Run that file alone in the foreground (PWA files with `CI=1`; the doctor file with `-t docs-sw`) and write its RED summary and the failing case into the record.
2. The fix is the smallest change in the W4 file the finding names. It keeps the rings (the worker closure imports only each other, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and type-only `hast`/`mdast`; `renderHast` stays pure and never mutates its tree), imports every limit from `markdownLimits.ts` and `DOCS_PAGE_PREFIX` from `shared/docs.ts` (never a second declaration), adds no `addEventListener('message'` to a `lib/markdown*` file and no `URL.createObjectURL(`, keeps `ParseOutcome`'s eight arms, keeps the doctor's verdicts behind `_dr_pass/_dr_warn/_dr_fail/_dr_skip` with builtins only and no GNU-only spelling, and writes no raw control byte into a fixture. No `D-` number in code, comments or test titles.
3. GREEN: the file's suite, then the suites of every file the fix touched (Step 6's list), in the foreground.
4. A mutation row: the guard the fix adds, deleted or inverted, as `W4-T11-M<k>`, `k` counting from 1 (M1, M2, ...). Commit the fix first (sub-step 6), then measure the row in a FRESH copy of that commit (`SCRATCH="$HOME/.cc-tmp/docs-w4-t11"; rm -rf "$SCRATCH/copy" && mkdir "$SCRATCH/copy" && git archive HEAD | tar -x -C "$SCRATCH/copy" && git -C "$SCRATCH/copy" init -q && ln -s "$PWD/pwa/node_modules" "$SCRATCH/copy/pwa/node_modules" && ln -s "$PWD/server/node_modules" "$SCRATCH/copy/server/node_modules"`), after appending the row to this task's array (sub-step 5), with `python3 "$SCRATCH/tools/rows.py" docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md "$SCRATCH/copy" 11 W4-T11-M<k>`; its `red` is that run's summary and failed case titles, verbatim. `tests` is the argv after `vitest run`, so a `-t` pattern rides in it (a row on `ccrc-doctor.test.ts` always carries `"-t", "docs-sw"` or a narrower pattern: the whole file is over 900 cases). If the fix re-spells text an earlier row's `old` anchors on, re-anchor that row here: a row with the SAME id and the new `old`, measured red the same way (`rows.py` with that row's task number reads the earlier block, so measure the re-anchor with `11` once it is appended here), and say so in the sentence above the rows block.
5. Append the row object(s) to this task's JSON array below (it starts empty, `[]` on one line: replace it with `[`, the objects separated by `,`, and `]`; once it holds rows, add `,` after the last element's closing `}` and the new objects before the line holding only `]`), and, only for a coordinator-ruled spec departure, one entry at the end of `## Deviations found` with the next unspent number of the issued block, never a typed or looked-up one: `- **D-<n> (<date>)** — <what departs from which spec sentence, and why>. Task 11 review <id>.` with `<date>` from `date -u +%F`. Then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` must print `Test Files  2 passed (2)` before the next commit.
6. Commit the fix and its case together, then (after the row is measured) the plan edit alone, each in its own call after a green read, files by name:

```bash
git add <the fixed file> <the test file>
git commit -m "<area>: <what the fix makes true> (docs W4 review)" -m "Whole-branch review <id>: <the scenario, and what now happens instead>." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
git commit -m "docs: W4 Task 11 row for review <id> (docs W4 review)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

`<area>` is `pwa` for a PWA source or test fix, `doctor` for `ccd/ccrc-doctor-checks` and its tests, `deploy` for `deploy/deploy.sh`, `server` for a server test or fixture alone, `docs` for the plan. Fill the finding's record line (`outcome`: both shas; `rows`: the ids). A fix round never pushes: Task 12 pushes.

- [ ] **Step 6: Close the fix wave: the suites, the anchors, the record.** Foreground, Bash timeout 600000 ms each. A known load flake (`typecheck-tests`, `contrast.test.ts`'s spawned-gate cases, the `ccrc-install-graphify` cases, any PWA case that times out) is re-run ALONE before it is called broken: at planning, the whole PWA suite under a load average of 44 to 86 reddened 17 to 20 files per run, a different set each time, every red a timeout and every such file green alone, W4's own included (`markdown-highlight`'s cap case at 5 000 ms, `markdown-parse`'s 90 000-break case at 60 000 ms).

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run test/markdown-golden.test.tsx test/remark-alerts.test.ts test/markdown-limits.test.ts test/markdown-guard.test.ts test/markdown-parse.test.ts test/markdown-purity.test.ts test/render-hast.test.tsx test/markdown-highlight.test.tsx test/markdown-worker.test.ts test/markdown-runner.test.ts test/use-parsed-markdown.test.tsx test/chat-hardening.test.tsx test/router-location.test.tsx test/app-pane-reset-timing.test.tsx test/render-boundary.test.tsx test/root-boundary.test.tsx test/app-detail-boundary.test.tsx test/chat-item-boundary.test.tsx test/tap-targets.test.tsx test/sw-denylist.test.ts test/message-links.test.tsx )`
Expected with no Step 5 fix: `Test Files  21 passed (21)`, `Tests  557 passed (557)` (Step 0's per-file counts), plus each Step 5 case in its own file; `git diff --quiet "$T1" HEAD -- pwa/test/golden/ pwa/test/markdownCorpus.ts pwa/test/markdown-golden.test.tsx && echo GOLDEN-FROZEN` still prints `GOLDEN-FROZEN` (`T1` as in Step 0).

Run: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`
Expected: `TSC-OK`.

Run: `( cd pwa && CI=1 ./node_modules/.bin/vitest run )`
Expected: `Test Files  126 passed (126)`, `Tests  3953 passed (3953)` at Task 10's state, plus each Step 5 case (the counts at the tree's state; `main` moves them, and what binds is that every red is a measured load flake green alone). Never with a `CCRC_SW_DENYLIST` covering `/docs` in the environment.

Run: `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/deploy-coordinates.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  67 passed (67)` (54 + 13), plus each Step 5 case appended to `docs-parity`.

Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'docs-sw' )`
Expected: `Tests  16 passed | 888 skipped (904)`, plus each Step 5 doctor case (its describe title carries `docs-sw`).

Run: `( cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts test/source-bytes.test.ts test/single-definition.test.ts )`
Expected: `Test Files  3 passed (3)`, `Tests  624 passed | 11 skipped (635)` (macos-platform and source-bytes 101 passed and 11 skipped, single-definition 523): no GNU-only spelling in the doctor file, no raw control byte in a fixture, and no second declaration of a single-source value.

Run: `( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'citation' )`
Expected: `Tests  13 passed | 437 skipped (450)` (no cited line of `deploy/deploy.sh` or `ccd/ccrc-doctor-checks` moved: a doctor fix edits only the appended block at the file's end).

Only when a Step 5 fix touched `ccd/ccrc-doctor-checks`, `server/test/swFixtures.ts`, `server/test/installTreeFixture.ts` or `server/test/ccrc-update.test.ts`:
Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'ends with doctor, and a box that passes every check exits 0|live shape' )`
Expected: `Tests  3 passed | 315 skipped (318)`.
Run: `( cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t '^ccrc update: t' )`
Expected: `Tests  127 passed | 387 skipped (514)`.

Run: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts )`
Expected: `Tests  55 passed (55)`: every new case uses the placeholders `demo`, `a`, `b`, `main`, `ws/a`, `example.com` and `example-org/example-repo` only.

Run: `( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts )`
Expected: `Tests  12 passed (12)` with real `pwa/node_modules` and `agent/node_modules`; on a tree with no `agent/node_modules`, `server/test/ is clean under a tests-inclusive project` and `agent/test/ is clean under a tests-inclusive project` red on `Cannot find module 'ws'` with or without a Step 5 fix (measured at Task 10's state): an environment red, not this task's.

Run: `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )`
Expected: `Test Files  2 passed (2)`, `Tests  32 passed (32)`.

Run: `SCRATCH="$HOME/.cc-tmp/docs-w4-t11"; python3 "$SCRATCH/tools/anchors.py" docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md .`
Expected: `<n> rows; 0 not exactly once`, `<n>` being 171 plus the new ids Step 5 added (a re-anchor adds none). Any other line is a row Task 12 could not run: re-anchor it (Step 5.4) before closing.

Close the record: fill every `outcome` and `rows`, add a last line `Findings: raised <n>, survived <m>, fixed <f>, carried <c>, not a defect <d>, asked <a>, ruled departures <r>. Commits: <list of shas>. Panel tip <TIP>; fix-wave tip $(git rev-parse HEAD).` (`survived` = the findings not ruled NOT A DEFECT), and copy `<SCRATCH>/review` and every Step 5 row measurement into `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review/`. Task 12's results cite the record's last line, its Carried list takes every CARRIED line, and an unanswered ask is listed there too. No push and no pull request here: Task 12 is the close, and its results commit must be the tip.

**Mutation rows this task contributes** (none until a Step 5 fix adds one: this task carries no code of its own. Each row a fix adds is measured red in a separate copy, never in the worktree: `git archive HEAD | tar -x -C <copy>` at the fix's commit, then `git -C <copy> init -q`, `pwa/node_modules` and `server/node_modules` linked in; `pkg` is the package the `tests` run in; `old` is unique in `file` at that commit; `red` is the measured summary and the cases that went red. A fix that re-spells an earlier row's anchor repeats that row here with the same id and the new `old`, and says so above this block; Task 12's extractor keeps the last occurrence of an id). Rows that Step 5 adds are appended to this array by the fix that adds them.

```json
[]
```

---

### Task 12: Close the wave: the suites, the census-free invariants, the build gate, the mutation table, the results, the push, the ONE pull request, the fingerprint and the wave-done

**Model routing:** `sonnet`, effort `high`. The eight scratch tools are complete below; the work is running them and reading what they print. Any red that is not a measured load flake or a measured environment red, any `FAIL` invariant or gate check, and any mutation row that does not come back `red` is a FINDING: it is reported to the coordinator (Step 4's `finding` mail, or an ask when it needs the operator), never fixed silently and never weakened. No subagent: every step is a command and a read.

This task adds no guard and edits no source or test file, so it has no red-first step of its own: what it proves red is Tasks 1-11's guards (Step 4 runs every row at the wave's end state), and each of its own tools was proved able to fail while this plan was written (Measured while planning, items 3-6). Its one commit is Step 5's, the results section alone.

**Spec rows:** none of its own. Section 7.9's every-wave and W4 suites; section 7.7's W4 gate ("the worker chunk is emitted and precached"), run in Step 3 (refinement (r)); every M4 and M7 row Tasks 1-11 carry, through their mutation rows (Step 4); section 7.7's W4 rollout, which this task DOCUMENTS and does not run.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`, this plan. `## Wave 4 results` is APPENDED after the file's last line, which is the end of `## Deviations found` (Task 10 Step 8's four entries and any Task 11 added). `w4-results.py` is its only writer: it refuses while the file has uncommitted edits, and on a re-run (a fix round) it replaces the section it wrote, which is the file's last `## ` section by construction. No line above it changes.
- No other tracked file. Scratch only, never committed, all under `<SCRATCH>` = `$HOME/.cc-tmp/docs-w4-t12` (not `/tmp`: the fleet box's reaper deletes `/tmp` entries older than 12 h): the eight tools in `<SCRATCH>/tools/` (`w4-suites.py`, `w4-invariants.py`, `w4-gate.py`, `w4-rows.py`, `mutate.py`, `w4-results.py`, `w4-pr-body.py`, `w4-wave-done.py`); `w4-base`, `w4-run`, `w4-block`, `w4-pr`; every `w4-suite-*.log` (and each split piece's `.json`), `w4-split.txt`, `w4-invariants.txt`; the gate's `gate-base/` and `gate-tip/` copies, `gate-head`, `gate-*.json`, `gate-*-build.log` and `w4-gate.txt`; `w4-rows.json`, the `w4-mut/` copy with its `w4-mut.*` state files, `w4-mutation-table.md`; `w4-notes.md` when anything needed a note; `w4-pr-body.md` and `w4-wave-done.json`.
- Gitignored, never committed (`.superpowers/` is in `.gitignore`): `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-12-evidence/` (Steps 5 and 8 copy the evidence there, because the coordinator and the reviewer read it after this session ends) and `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-12-first-run.txt` (the wave's first complete-run verdict, written once by `w4-results.py`).
- Read, never edited: `.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review.md`, Task 11's closed record (its `Base:` line, its last `Findings:` line and every row it ruled `CARRIED`).

Shell state does not survive between Bash calls, so every block below opens with `SCRATCH="$HOME/.cc-tmp/docs-w4-t12"`, and every tool is written to that absolute path. Every command runs from the worktree root, in the FOREGROUND, with a Bash timeout of 600000 ms; nothing is backgrounded, and no tool call is planned to run longer than 570 s. Never put a `CCRC_SW_DENYLIST` covering `/docs` in the environment of a PWA run: every tool that runs vitest or a build removes the variable itself.

**Interfaces:**
- Consumes (no TypeScript: this task imports nothing and declares nothing):
  - this plan's `### Task <n>: ` sections 1-12, each ending in a `**Mutation rows this task contributes**` line and one JSON block of rows `{id, pkg, file, old, new, tests, red}` (ids `W4-T<n>-M<k>`; `tests` is the argv after `vitest run`, so a `-t` pattern rides in it). Measured at Task 10's state: 186 row objects in Tasks 1-10's blocks (T1 12, T2 12, T3 35, T4 16, T5 36, T6 32, T7 7, T8 12, T9 8, T10 16), 171 distinct ids after 15 re-anchors (Tasks 2 and 6 repeat nine Task 1 ids and one Task 4 id with new `old` text); Task 11's block holds only what its Step 5 appended, and this task's block is empty. The extractor keeps an id's LAST occurrence in task order, and decodes each block with `raw_decode` (Task 3's W4-T3-M6 and W4-T3-M7 spell a code fence inside their strings);
  - the wave's base: the parent of the first first-parent commit whose subject ends `(docs W4)`, which must equal the `Base:` sha Task 1 Step 0 recorded and Task 11's record repeats;
  - from the brief: the run id and the issued deviation block (`<LO>-<HI>`), written once into `<SCRATCH>/w4-run` and `<SCRATCH>/w4-block` at Step 0;
  - the test files Tasks 1-11 created or extended, and the existing suites section 7.9 names (Step 1's table);
  - `server/test/swFixtures.ts`'s `SW_DENYLIST_DEFAULT` (Task 10), read as text by the gate;
  - `$HOME/.local/bin/ccrc-api` (`whoami`, `mail list`, `mail fetch`, `mail ack`, `mail send`), as the `ccrc-worker` skill uses it; `git push`; `gh pr list`, `gh pr create` and `gh pr view` (never `gh pr merge`, `gh pr edit` or any update-branch).
- Produces:
  - `## Wave 4 results` at the end of this plan: the measurement time, the measured tree's sha, the base, the W4 commit count and the count of deviation numbers spent (named by count and block, never spelled: Step 2's `no-d-number` invariant); a Suites table (one line per suite and piece: command, `Test Files`, `Tests`, seconds, rc, and a re-run's rc where one was needed), the split check and the wave's FIRST complete-run verdict; the Invariants block verbatim; the Build gate block verbatim; the Mutation table (one line per row: id, task, file, measured verdict, first failed case) with its `<n> rows; <n> measured as expected.` line and refinement (b)'s equivalent mutant measured green; Measured values (the grammar count, the M4.P1 and M4.M2 control depths, the 500 KiB fixture, the five licences); the W5 halves of refinement (a), for W5's brief; Notes (Task 11's `Findings:` line, then every note this task recorded); Carried, not fixed (Global Constraints' carried items, the open image-source question, refinement (i)'s one frame, every row Task 11 ruled `CARRIED`); and After the merge, not this wave;
  - one commit, `docs: W4 results (docs W4)`: the wave's `handoffCommit` and the branch tip;
  - the workspace branch pushed to `origin`, and ONE pull request against `main`, titled `docs W4: PWA foundation`;
  - one `wave-done` mail to the coordinator whose body opens with `suite: <the wave's first complete run>` (plus `failure: unclear` when that word is `red`) and then the fingerprint `{"branchTip":<the tip>,"prNumber":<the PR's number>,"prPhase":"open","handoffCommit":<the tip>}`.
  - The tools' command lines: `python3 w4-suites.py SCRATCH --list | --next | ID [ID ...] | --rerun ID`; `python3 w4-invariants.py BASE BLOCK`; `python3 w4-gate.py SCRATCH BASE copy [--link] | build base|tip | refuse | check`; `python3 w4-rows.py PLAN OUT [EXTRA]`; `python3 mutate.py ROWS MUT setup|baseline|run [ID ...]|equivalent|final|report`; `python3 w4-results.py SCRATCH BASE BLOCK [--record-reds] [--review RECORD]`; `python3 w4-pr-body.py SCRATCH BLOCK OUT`; `python3 w4-wave-done.py SCRATCH RUN PR BLOCK FROM_ID FROM_UUID [--dry-run]`. All run from the worktree root.

**Measured while planning** (in a clone of the shared scratch tree at Task 11's state, which is Task 10's code: Task 11 adds a commit only for a confirmed finding. The clone's history was laid out as the branch will be: the base, then this plan committed and pushed to a local bare `origin` as its `main`, then Tasks 1-10's commits with `(docs W4)` subjects, then a stand-in `## Deviations found` defining the first four numbers of a stand-in block, and a closed stand-in Task 11 record; `pwa/node_modules` and `server/node_modules` linked to the scratch tree's, no `agent/node_modules`. Node v24.14.1, a 16-core box under a load average between 14 and 25; separate copies for every planted or mutated check):
1. **The suites fit, and four files do not fit one call.** `--list` printed `30 suites: 9 named and 21 pieces of 4 split file(s); 126 PWA test files`. Each suite took under 210 s (Step 1's per-suite figures), so one invocation of `--next`, which starts a suite only within its first 25 s, always ends inside a 600 s call. The split check printed four `OK` lines: `ccrc-doctor` 889 tests ran once each and 15 were skipped in every piece, of 904; `ccrc-install` 298 and 20, of 318; `ccrc-update` 502 and 12, of 514; `session-hook` 450 and 0, of 450. A `--rerun 06` against a stand-in first log naming two failed files ran exactly those two with `--no-file-parallelism`.
2. **Two reds a planning tree shows and a real checkout does not.** Suite 03: `deviation-refs`' two PR-incident cases under `the cross-tree collision scan` (they replay the repository's own history, which a clone of the scratch tree lacks), red on the first run and on `--rerun`. Suite 04: `typecheck-tests`' `server/test/ is clean under a tests-inclusive project` and `agent/test/ is clean under a tests-inclusive project` (`Cannot find module 'ws'`: no `agent/node_modules`) and `PWA_TSC really is pwa's own installed compiler, not the server-resolved one` (a symlinked `pwa/node_modules`). Task 11 measured all three green with real `node_modules`. Everything else was green on its first run, the full PWA suite included (`126 passed (126)`, `3953 passed (3953)`, 109 s), with this plan (Tasks 1-12 and the stand-in deviation section) in `docs/superpowers`: M4.P12's walk still picks the larger `plans/2026-10-05-ccrc-history-w1-capture.md`.
3. **The invariants can fail, and they read a merge of main correctly.** On the clone: `16 invariants, 16 PASS`. In a clone with one planted commit (a `shared/docs.ts` line, a `message-links.test.tsx` line, a golden file edited, a sixth dependency in `pwa/package.json`, a line inserted mid-file in `docs-parity.test.ts` and in `ccd/ccrc-doctor-checks`, a line carrying a new `D-` number above `healthy()` in `ccrc-doctor.test.ts`, a line changed in `ccrc-install.test.ts`, a line added to `deploy.sh`, a header line added to `sw-denylist.ts`, the `navigateFallbackDenylist` line re-spelled, a new stylesheet, and `## Deviations found` defining the block's second number twice), it printed fifteen `FAIL` lines and `16 invariants, 1 PASS`, rc 1; a second planted commit adding a `license` field to the lock's root turned `lock` to `FAIL` too. In a clone where a branch from the base standing in for `main` edited `README.md` and inserted lines mid-file in `ccrc-doctor.test.ts` (above `healthy()`) and `docs-parity.test.ts`, merged into the tip, every invariant passed (`ref` is that merge's second parent): judged against the base alone, `untouched`, `parity-append` and `doctor-test` would have failed on main's own edits.
4. **The gate can fail.** On the clone (copies with `--link`; the worker runs `npm ci` in each): the base built in about 20 s with 16 precache entries, the tip with 17 (`assets/markdownWorker-<hash>.js` added, nothing removed), one `denylist:[` in a one-line `sw.js`, its text equal to `SW_DENYLIST_DEFAULT` at both; the refused build exited 1 with the section 7.3 sentence on stderr; `8 gate checks, 8 PASS`. In a second scratch whose tip copy spelled the worker URL as `new URL('./markdown' + 'Worker.ts', import.meta.url)`, the build still exited 0 but emitted no worker chunk, and `check` printed `FAIL worker-chunk`, `FAIL precached` and `FAIL precache` (16 entries at both).
5. **The table is whole and every row bites at the wave's END state.** `w4-rows.py` printed `186 rows in 12 blocks (T1 12, T2 12, T3 35, T4 16, T5 36, T6 32, T7 7, T8 12, T9 8, T10 16, T11 0, T12 0); 171 ids after 15 re-anchor(s): …`; `mutate.py setup` printed `27 files under mutation, 171 rows, 31 test commands`; `baseline` needed two invocations (31 `GREEN`); `run` needed three and ended `ALL ROWS MEASURED: 171 ok, 0 not ok`; `equivalent` printed `EQUIVALENT GREEN`; `final` printed `ALL COMMANDS GREEN (final)`; and the report ended `171 rows; 171 measured as expected.`. A first draft that called a row red only when a failed case's title appeared verbatim in the row's `red` text marked 26 genuine reds NOT OK (the recorded `red` strings abbreviate and paraphrase titles), so the runner instead refuses exactly the false red a loaded box produces: a run whose every failure is vitest's own `Test timed out in <n>ms` is `red-timeout`, never `red` (checked on stand-in outputs: a timeout-only failure gives `red-timeout`, a timeout beside an assertion failure gives `red`).
6. **The writers.** `w4-results.py` refused with `not all green, so nothing is written` naming `suite 03` and `suite 04` (item 2), then, under `--record-reds`, wrote a 317-line section that spells no `D-<n>` token (deviation-refs' own case titles in the quoted FAIL lines are written as `D-<n>`); suite 09 then printed `Test Files 1 failed | 2 passed (3)`, `Tests 2 failed | 85 passed (87)` (item 2's two history cases; `topology-clean` and `dtbd` green on the section), and the invariants still printed `16 invariants, 16 PASS` with the section committed. `w4-pr-body.py` (49 lines, every link under a placeholder `https://github.com/example-org/example-repo` origin, ending with the attribution line) and `w4-wave-done.py --dry-run` (the `suite:` and `failure:` lines, then the fingerprint) ran on the results commit; on a later commit the builder refused with `the tip is not the results commit; nothing sent`. Neither the push, the PR nor the mail can run in a planning tree, so Steps 6-8's live answers are the worker's to read.

- [ ] **Step 0: Preconditions, and the inputs the brief names.** One Bash call:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/tools"
PLAN=docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
REC=.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-11-review.md
first=$(git log --first-parent --reverse --format='%H %s' HEAD | awk '/ \(docs W4\)$/ {print $1; exit}')
BASE=$(git rev-parse "$first^"); echo "$BASE" > "$SCRATCH/w4-base"; echo "base $BASE"
grep -q "^Base: $BASE\. " "$REC" && echo base-agrees-with-task-11 || echo BASE-DISAGREES
test -z "$(git status --porcelain)" && echo clean || echo NOT-CLEAN
git merge-base --is-ancestor "$BASE" HEAD && echo base-is-ancestor
git cat-file -e "$BASE:$PLAN" 2>/dev/null && echo plan-on-base || echo PLAN-NOT-ON-BASE
git cat-file -e "$BASE:pwa/src/lib/markdown.tsx" 2>/dev/null && echo base-has-markdown || echo base-has-no-markdown
git log --first-parent --no-merges --format=%s "$BASE"..HEAD | grep -cE '\(docs W4( review)?\)$'
for p in server pwa agent; do { [ -d "$p/node_modules" ] && [ ! -L "$p/node_modules" ]; } || echo "not installed: $p"; done
grep -c '^### Task [0-9]*: ' "$PLAN"; grep '^## ' "$PLAN" | tail -n 1
grep -c '^Findings: ' "$REC"
```

Expected: `base <40 hex>`; `base-agrees-with-task-11`; `clean`; `base-is-ancestor`; `plan-on-base` (the plan reached `main` before the run opened); `base-has-no-markdown`; at least `11` (one commit per task 1-9, Task 10's two, plus Task 11's review commits, which end `(docs W4 review)`); no `not installed` line (else `( cd <pkg> && npm ci )` for that package, foreground: `typecheck-tests` compiles `agent/` and needs its `node_modules`, and a child workspace may have installed `server/` alone); `12`; `## Deviations found` (or `## Wave 4 results` when a fix round re-runs this task); `1` (Task 11 Step 6 closed its record). Any other answer: stop and put an ask to the coordinator; never merge, rebase or pull here.

Then record the two values the brief names, exactly as the brief spells them (the run id is digits; the block is the issued range, two numbers joined by `-`), one Bash call:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; printf '%s\n' '<the runId the brief names>' > "$SCRATCH/w4-run"; printf '%s\n' '<the issued block, LO-HI>' > "$SCRATCH/w4-block"
grep -Eqx '[0-9]+' "$SCRATCH/w4-run" && grep -Eqx '[0-9]+-[0-9]+' "$SCRATCH/w4-block" && echo inputs-ok
```

Expected: `inputs-ok`. These two files, `w4-base` and the tools are the only inputs every later step reads; no later block types a sha, a run id or a number.

- [ ] **Step 1: The suites (section 7.9).** Write the suite runner to `<SCRATCH>/tools/w4-suites.py`:

````python
#!/usr/bin/env python3
"""The W4 suites (the plan's Task 12, Steps 1 and 5). Scratch only: never committed.

  python3 w4-suites.py SCRATCH --list           print the table: every suite, its command, and the split pieces
  python3 w4-suites.py SCRATCH --next           run the next suites that have no log yet (the closing one excepted)
  python3 w4-suites.py SCRATCH ID [ID ...]      run those suites, in the foreground, one after another
  python3 w4-suites.py SCRATCH --rerun ID       run a red suite again, ALONE, into its .rerun.log

Run from the worktree root. Suites 01-08 are named; S01 onward are the pieces of the files one 600 s call cannot be
trusted to hold (SPLIT): each piece is a `-t` pattern over a run of the file's top-level describe titles (a title
that begins a longer title never claims the longer one's tests), plus one remainder piece that excludes them all.
Suite 09 (plan-pins-after) runs only by its ID, after the results section is written. A suite with an expected
file count is wrong (rc=125) when it is green and vitest's `Test Files` total differs from that count.

`--next` starts the first suite with no log, then another only while it has run at most NEXT_START_S seconds, so one
invocation ends inside a 600 s tool call; repeat it until it prints `SUITES: <n> of <n> run`, after which it writes
SCRATCH/w4-split.txt: one line per SPLIT file saying whether every test ran in exactly one piece (read from each
piece's JSON report: a test either runs in one piece, or is skipped in every piece because the file skips it). A
suite's FIRST log is its first run, which the wave-done's `suite:` line reads. `--rerun` of the PWA suite runs only
the files its first log names in a FAIL line (all of them after a timeout or a count mismatch), one file at a time
(`--no-file-parallelism`), in one vitest call; of any other suite, the same command again.

Each run writes SCRATCH/w4-suite-<ID>-<name>.log: the command on its first line, the output with colour codes
stripped, then `files=<n>` where a count is expected, `seconds=<n>` and `rc=<n>`; it prints vitest's `Test Files` and
`Tests` lines, every FAIL line, the seconds and the rc. Every PWA run sets CI=1 (the golden test never writes a
missing snapshot file under CI) and removes CCRC_SW_DENYLIST from the environment (the vite config, which vitest
loads, refuses an entry covering /docs, and every PWA file would die at config load). A suite marked `fetch` runs
`git fetch -q origin main` once first. A suite that outlives SUITE_TIMEOUT_S is killed with its process group and
recorded as rc=124. Exit 0 only when every suite run is rc 0.
"""
import glob, json, os, re, signal, subprocess, sys, time

SUITE_TIMEOUT_S = 540
NEXT_START_S = 25
VITEST = ['./node_modules/.bin/vitest', 'run']
TSC = ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']
# (id, name, package, argv after the package's runner, expected file count or None, fetch first)
NAMED = [
    ('01', 'topology-clean', 'server', VITEST + ['test/topology-clean.test.ts'], 1, True),
    ('02', 'single-definition', 'server', VITEST + ['test/single-definition.test.ts'], 1, False),
    ('03', 'plan-pins', 'server', VITEST + ['test/deviation-refs.test.ts', 'test/dtbd.test.ts'], 2, True),
    ('04', 'typecheck-tests', 'server', VITEST + ['test/typecheck-tests.test.ts'], 1, False),
    ('05', 'pwa-tsc', 'pwa', TSC, None, False),
    ('06', 'pwa-full', 'pwa', VITEST, 'pwa', False),
    ('07', 'w4-server', 'server', VITEST + [
        'test/docs-parity.test.ts', 'test/deploy-coordinates.test.ts', 'test/docs-budget.test.ts',
        'test/license.test.ts', 'test/oss-metadata.test.ts', 'test/node-floor.test.ts', 'test/build-release.test.ts',
        'test/macos-platform.test.ts', 'test/source-bytes.test.ts', 'test/install-census.test.ts'], 10, False),
    ('08', 'ccrc-install-graphify', 'server', VITEST + ['test/ccrc-install-graphify.test.ts'], 1, False),
    ('09', 'plan-pins-after', 'server', VITEST + ['test/topology-clean.test.ts', 'test/deviation-refs.test.ts',
                                                  'test/dtbd.test.ts'], 3, True),
]
AFTER = '09'
# Files one call cannot be trusted to hold, and how many describe-run pieces each becomes (the remainder piece is
# added after them). Measured while this plan was written, on the 16-core box under a load average of 20 to 60.
SPLIT = {
    'test/ccrc-doctor.test.ts': 6,
    'test/ccrc-install.test.ts': 4,
    'test/ccrc-update.test.ts': 4,
    'test/session-hook.test.ts': 3,
}
TOP = re.compile(r"^(?:describe\w*|describe\.skipIf\([^)\n]*\))\('((?:[^'\\\n]|\\.)*)'", re.M)
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
FAIL_FILE = re.compile(r'^\s*FAIL\s+(test/\S+?\.test(?:-d)?\.tsx?)\b', re.M)


def js_escape(s):
    return re.sub(r'[.*+?^${}()|\[\]\\/]', lambda m: '\\' + m.group(0), s)


def pieces(f, k):
    """[(name, -t pattern)]: k runs of the file's top-level describes, cut by source lines, then the remainder."""
    text = open(os.path.join('server', f), encoding='utf-8').read()
    found = [(m.start(), m.group(1).replace("\\'", "'")) for m in TOP.finditer(text)]
    titles = [t for _at, t in found]
    if len(titles) < k or len(set(titles)) != len(titles):
        sys.exit('w4-suites.py: %s has %d top-level describe titles (%d distinct); stop and report'
                 % (f, len(titles), len(set(titles))))
    total = len(text)
    groups, cur = [], []
    for i, (_at, t) in enumerate(found):
        cur.append(t)
        end = found[i + 1][0] if i + 1 < len(found) else total
        if end >= total * (len(groups) + 1) / k and len(groups) < k - 1:
            groups.append(cur)
            cur = []
    groups.append(cur)

    def one(t):
        # A title that begins another title plus a space ('a b' and 'a b c') must not claim the longer one's tests.
        longer = [b[len(t) + 1:] for b in titles if b != t and b.startswith(t + ' ')]
        return js_escape(t) + ' ' + ('(?!(?:%s) )' % '|'.join(js_escape(x) for x in longer) if longer else '')
    alt = lambda ts: '(?:%s)' % '|'.join(one(t) for t in ts)
    out = [('part%d' % (i + 1), '^' + alt(g)) for i, g in enumerate(groups) if g]
    out.append(('rest', '^(?!%s)' % alt(titles)))
    return out


def pwa_files():
    """The PWA test files vitest's include reaches (`*.test.*`, and the typecheck `*.test-d.*`), outside node_modules."""
    found = set()
    for pat in ('pwa/**/*.test.ts', 'pwa/**/*.test.tsx', 'pwa/**/*.test-d.ts', 'pwa/**/*.test-d.tsx'):
        found |= set(p for p in glob.glob(pat, recursive=True) if '/node_modules/' not in p)
    return len(found)


def suites():
    """id -> (id, name, pkg, argv, fetch, expected file count or None, shown command, piece of)."""
    table = {}
    for i, name, pkg, argv, want, fetch in NAMED:
        n = pwa_files() if want == 'pwa' else want
        shown = '( cd %s && %s%s )' % (pkg, 'CI=1 ' if pkg == 'pwa' else '',
                                     ' '.join(("'%s'" % a) if ' ' in a else a for a in argv))
        table[i] = (i, name, pkg, argv, fetch, n, shown, None)
    n = 0
    for f, k in SPLIT.items():
        stem = os.path.basename(f)[:-len('.test.ts')]
        for pname, pat in pieces(f, k):
            n += 1
            sid = 'S%02d' % n
            shown = "( cd server && ./node_modules/.bin/vitest run -t '<%s: %s>' %s )" % (
                stem, pname if pname == 'rest' else pname + ' of its top-level describes', f)
            table[sid] = (sid, '%s-%s' % (stem, pname), 'server', VITEST + ['-t', pat, f], False, 1, shown, f)
    return table


def log_path(scratch, s, rerun, ext='log'):
    return os.path.join(scratch, 'w4-suite-%s-%s%s.%s' % (s[0], s[1], '.rerun' if rerun else '', ext))


FETCHED = []


def fetch_once():
    if FETCHED:
        return
    f = subprocess.run(['git', 'fetch', '-q', 'origin', 'main'], capture_output=True, text=True)
    if f.returncode != 0:
        sys.exit('w4-suites.py: git fetch origin main failed: %s' % f.stderr.strip())
    FETCHED.append(True)


def env_for(pkg):
    env = dict(os.environ)
    env.pop('CCRC_SW_DENYLIST', None)
    if pkg == 'pwa':
        env['CI'] = '1'
    return env


def run(scratch, s, rerun):
    sid, name, pkg, argv, fetch, want_files, shown, piece_of = s
    if rerun and sid == '06':
        p = log_path(scratch, s, False)
        if not os.path.exists(p):
            sys.exit('w4-suites.py: %s has no first run to re-run' % sid)
        first = open(p, encoding='utf-8').read()
        only = sorted(set(FAIL_FILE.findall(first)))
        if only and re.search(r'^rc=1$', first, re.M):
            argv = VITEST + ['--no-file-parallelism'] + only
            want_files = len(only)
        else:
            argv = VITEST + ['--no-file-parallelism']
        shown = '( cd pwa && CI=1 %s )' % ' '.join(argv)
    if piece_of is not None:
        argv = argv[:2] + ['--reporter=default', '--reporter=json',
                           '--outputFile.json=' + os.path.abspath(log_path(scratch, s, rerun, 'json'))] + argv[2:]
    if fetch:
        fetch_once()
    t0 = time.monotonic()
    p = subprocess.Popen(argv, cwd=pkg, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env_for(pkg),
                         start_new_session=True)
    try:
        raw, _ = p.communicate(timeout=SUITE_TIMEOUT_S)
        rc = p.returncode
    except subprocess.TimeoutExpired:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(p.pid, sig)
            except OSError:
                break
            time.sleep(3)
        raw, _ = p.communicate()
        rc = 124
    secs = int(time.monotonic() - t0)
    out = ANSI.sub('', raw.decode('utf-8', 'replace'))
    if want_files is not None and rc == 0:
        got = re.findall(r'^\s*Test Files\s+.*\((\d+)\)\s*$', out, re.M)
        if not got or int(got[-1]) != want_files:
            out += '\nw4-suites.py: vitest ran %s files, the suite holds %d\n' % (got[-1] if got else 'no',
                                                                                 want_files)
            rc = 125
    with open(log_path(scratch, s, rerun), 'w', encoding='utf-8') as fh:
        fh.write('$ %s\n%s\n%sseconds=%d\nrc=%d\n' % (shown, out.rstrip('\n'),
                 ('files=%d\n' % want_files) if want_files is not None else '', secs, rc))
    print('== %s %s%s: %s' % (sid, name, ' (re-run alone)' if rerun else '', shown))
    ts = [l.strip() for l in out.splitlines() if re.match(r'^\S+\(\d+,\d+\): error TS\d+', l)]
    for line in out.splitlines():
        if re.match(r'^\s*(Test Files|Tests)\s', line) or re.match(r'^\s*FAIL\s', line) or \
                line.startswith('w4-suites.py:'):
            print('   ' + line.strip()[:300])
    for line in ts[:5]:
        print('   ' + line[:300])
    if len(ts) > 5:
        print('   (%d more compiler errors in the log)' % (len(ts) - 5))
    print('   %ds rc=%d' % (secs, rc))
    return rc


def split_check(scratch, table):
    """One line per SPLIT file: did every test run in exactly one piece (each piece's last run)?"""
    lines = []
    for f in SPLIT:
        runs, skips, totals, unread = {}, None, set(), []
        for s in table.values():
            if s[7] != f:
                continue
            p = log_path(scratch, s, True, 'json')
            p = p if os.path.exists(p) else log_path(scratch, s, False, 'json')
            try:
                tests = [a for r in json.load(open(p, encoding='utf-8'))['testResults']
                         for a in r['assertionResults']]
            except (OSError, ValueError, KeyError):
                unread.append(s[0])
                continue
            seen, keys = {}, []
            for a in tests:
                seen[a['fullName']] = seen.get(a['fullName'], 0) + 1
                keys.append(((a['fullName'], seen[a['fullName']]), a['status']))
            totals.add(len(keys))
            for k, st in keys:
                if st in ('passed', 'failed'):
                    runs[k] = runs.get(k, 0) + 1
            skipped = set(k for k, st in keys if st not in ('passed', 'failed'))
            skips = skipped if skips is None else skips & skipped
        twice = sorted(k[0] for k, n in runs.items() if n > 1)
        total = next(iter(totals)) if len(totals) == 1 else None
        ok = not unread and total is not None and not twice and len(runs) + len(skips or ()) == total
        lines.append('%s %s: %d tests ran once each across its pieces, %d skipped in every piece, of %s%s%s' % (
            'OK' if ok else 'MISMATCH', f, len(runs) - len(twice), len(skips or ()), total if total is not None
            else sorted(totals), ('; ran twice: %s' % twice[:3]) if twice else '',
            ('; no JSON report: %s' % unread) if unread else ''))
    open(os.path.join(scratch, 'w4-split.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return lines


if len(sys.argv) < 3:
    sys.exit(__doc__)
SCRATCH = sys.argv[1]
if not os.path.isdir(SCRATCH):
    sys.exit('w4-suites.py: %s is not a directory' % SCRATCH)
if not os.path.isdir('server/test') or not os.path.isdir('pwa/test'):
    sys.exit('w4-suites.py: run me from the worktree root')
TABLE = suites()
ORDER = [i for i in TABLE if i != AFTER]
if sys.argv[2] == '--list':
    for s in TABLE.values():
        print('%-3s %-34s %s%s' % (s[0], s[1], s[6], '   [fetch]' if s[4] else ''))
    print('%d suites: %d named and %d pieces of %d split file(s); %d PWA test files'
          % (len(TABLE), len(NAMED), len(TABLE) - len(NAMED), len(SPLIT), pwa_files()))
    sys.exit(0)
if sys.argv[2] == '--next':
    t0 = time.monotonic()
    rcs = []
    for sid in ORDER:
        if os.path.exists(log_path(SCRATCH, TABLE[sid], False)):
            continue
        if rcs and time.monotonic() - t0 > NEXT_START_S:
            break
        rcs.append(run(SCRATCH, TABLE[sid], False))
    done = [i for i in ORDER if os.path.exists(log_path(SCRATCH, TABLE[i], False))]
    print('SUITES: %d of %d run' % (len(done), len(ORDER)))
    if len(done) == len(ORDER):
        for line in split_check(SCRATCH, TABLE):
            print(line)
    sys.exit(0 if all(rc == 0 for rc in rcs) else 1)
rerun = sys.argv[2] == '--rerun'
ids = sys.argv[3:] if rerun else sys.argv[2:]
if rerun and len(ids) != 1:
    sys.exit('w4-suites.py: --rerun takes exactly one ID')
for i in ids:
    if i not in TABLE:
        sys.exit('w4-suites.py: no suite %s (try --list)' % i)
rcs = [run(SCRATCH, TABLE[i], rerun) for i in ids]
if rerun and TABLE[ids[0]][7] is not None and all(os.path.exists(log_path(SCRATCH, TABLE[i], False)) for i in ORDER):
    for line in split_check(SCRATCH, TABLE):
        print(line)
sys.exit(0 if all(rc == 0 for rc in rcs) else 1)
````

Then, one Bash call per line; repeat the second until it prints `SUITES: 29 of 29 run` and the four split lines:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-suites.py" "$SCRATCH" --list | tail -n 1
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-suites.py" "$SCRATCH" --next
```

Expected (counts and seconds measured while planning at Task 10's state; a later `main` moves the counts, and what binds is rc 0 and the four `OK` lines):
- `--list`: `30 suites: 9 named and 21 pieces of 4 split file(s); 126 PWA test files`. A refusal (`top-level describe titles`) is a finding.
- `01 topology-clean` (after `git fetch -q origin main`): `Test Files  1 passed (1)`, `Tests  55 passed (55)`, 11 s.
- `02 single-definition`: `1 passed (1)`, `523 passed (523)`, 15 s.
- `03 plan-pins` (`deviation-refs`, `dtbd`, after the fetch): `2 passed (2)`, `32 passed (32)`. Green means no allocator-era number this plan defines is defined in another plan on this branch or `origin/main`, and no concrete placeholder landed.
- `04 typecheck-tests`: `1 passed (1)`, `12 passed (12)`, about 50 s.
- `05 pwa-tsc`: no vitest lines, `rc=0`, about 12 s.
- `06 pwa-full` (`CI=1`): `Test Files  126 passed (126)`, `Tests  3953 passed (3953)`, about 110 s. The file count is checked against the PWA test files on disk: a green run that ran fewer is `rc=125`.
- `07 w4-server` (`docs-parity`, `deploy-coordinates`, `docs-budget`, `license`, `oss-metadata`, `node-floor`, `build-release`, `macos-platform`, `source-bytes`, `install-census`): `10 passed (10)`, `291 passed | 11 skipped (302)`.
- `08 ccrc-install-graphify`: `1 passed (1)`, `58 passed (58)`, about 150 s (refinement (t): its tree plants `sw.js` through `TREE_STUBS`).
- `S01`-`S07 ccrc-doctor`: 77, 125, 164, 154, 155 and 214 passed, then the remainder piece `904 skipped (904)`; 57-170 s each.
- `S08`-`S12 ccrc-install`: 61, 81, 68 and 88 passed, then `318 skipped (318)`; 140-205 s each.
- `S13`-`S17 ccrc-update`: 99, 156, 94 and 153 passed, then `514 skipped (514)`; 73-176 s each.
- `S18`-`S21 session-hook`: 219, 94 and 137 passed, then `450 skipped (450)` (its line-citation audit is among them: no cited line of `deploy/deploy.sh` or `ccd/ccrc-doctor-checks` moved).
- At the end:

```text
SUITES: 29 of 29 run
OK test/ccrc-doctor.test.ts: 889 tests ran once each across its pieces, 15 skipped in every piece, of 904
OK test/ccrc-install.test.ts: 298 tests ran once each across its pieces, 20 skipped in every piece, of 318
OK test/ccrc-update.test.ts: 502 tests ran once each across its pieces, 12 skipped in every piece, of 514
OK test/session-hook.test.ts: 450 tests ran once each across its pieces, 0 skipped in every piece, of 450
```

The full server suite is not run here: `pwa/package.json` changed, so this PR's CI runs it in full (section 7.9), and the review reads while it runs.

**A red suite or piece.** Re-run it ALONE once, `SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-suites.py" "$SCRATCH" --rerun <ID>` (a red `06` re-runs only the files its log names in a `FAIL` line, one file at a time; it writes the `.rerun.log` beside the first, and the results table shows both rcs). Then:
- **Green alone:** a load flake (`CLAUDE.md`'s list, `contrast.test.ts`'s spawned-gate cases and any PWA case that timed out among them: at Task 11's planning, the whole PWA suite under a load average of 44 to 86 reddened 17 to 20 files per run, every red a timeout and every such file green alone). Add one line to `<SCRATCH>/w4-notes.md`: `- suite <ID> <name>: red on the first run (<the FAIL line>), green re-run alone; a load flake.` It still counts as a red FIRST run: the wave-done's `suite:` line says what the first complete run said (worker skill clause 15).
- **Red alone, in a file W4 touched** (any file in Global Constraints' scope list): a finding (Step 4's last paragraph), and this task stops there.
- **Red alone, in a file W4 did not touch:** run the same file at the BASE, in a copy (one Bash call; `<pkg>` is `server` or `pwa`, `<file>` the `test/<name>` the `FAIL` line names):

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; rm -rf "$SCRATCH/base-copy" && mkdir "$SCRATCH/base-copy" && git archive "$(cat "$SCRATCH/w4-base")" | tar -x -C "$SCRATCH/base-copy" && for p in server agent pwa; do ln -s "$PWD/$p/node_modules" "$SCRATCH/base-copy/$p/node_modules"; done && ( cd "$SCRATCH/base-copy/<pkg>" && env -u CCRC_SW_DENYLIST CI=1 ./node_modules/.bin/vitest run <file> )
```

  Red there too: it is `main-red`, not W4's (worker skill clause 16: reported once and left alone). Add `- suite <ID>: <file> red alone and red at the base (<the FAIL line>); main-red, reported once, not W4's.` to `w4-notes.md` and report it once as a finding whose subject begins `main-red:`; Step 5 writes the record only after the coordinator rules it may be recorded. Green at the base: a finding against W4.

- [ ] **Step 2: The census-free invariants.** Write the checker to `<SCRATCH>/tools/w4-invariants.py`:

````python
#!/usr/bin/env python3
"""The W4 census-free invariants (the plan's Task 12, Step 2). Scratch only: never committed. Read-only.

  python3 w4-invariants.py BASE BLOCK      from the worktree root; BLOCK is the issued deviation block, LO-HI

W4's OWN edits are the union of its own commits, `git log --first-parent --no-merges BASE..HEAD` (scope). A file's
NET change is judged against REF: BASE, or, when the first-parent line merged origin/main in (a fix round may),
the second parent of the LAST such merge, so main's own edits never count as W4's. Every shape below is NET (W2's
lesson): a review fix that inserted lines inside an appended block is still one append. Prints one PASS/FAIL line
per invariant and `<n> invariants, <n> PASS`; exit 0 only when all PASS.
"""
import json, os, re, subprocess, sys

if len(sys.argv) != 3 or not re.fullmatch(r'\d+-\d+', sys.argv[2]):
    sys.exit(__doc__)
BASE = sys.argv[1]
LO, HI = (int(x) for x in sys.argv[2].split('-'))
PLAN = 'docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md'
LIB = ['markdown.tsx', 'markdownGuard.ts', 'markdownLimits.ts', 'markdownParse.ts', 'markdownRunner.ts',
       'markdownWorker.ts', 'remarkAlerts.ts', 'renderHast.tsx', 'router.ts', 'sw-denylist.ts', 'useParsedMarkdown.ts']
PWA_TESTS = ['app-detail-boundary.test.tsx', 'app-pane-reset-timing.test.tsx', 'chat-hardening.test.tsx',
             'chat-item-boundary.test.tsx', 'markdown-golden.test.tsx', 'markdown-guard.test.ts',
             'markdown-highlight.test.tsx', 'markdown-limits.test.ts', 'markdown-parse.test.ts',
             'markdown-purity.test.ts', 'markdown-runner.test.ts', 'markdown-worker.test.ts', 'markdownCorpus.ts',
             'remark-alerts.test.ts', 'render-boundary.test.tsx', 'render-hast.test.tsx', 'root-boundary.test.tsx',
             'router-location.test.tsx', 'sw-denylist.test.ts', 'tap-targets.test.tsx', 'use-parsed-markdown.test.tsx']
SCOPE = set(['ccd/ccrc-doctor-checks', 'deploy/deploy.sh', 'pwa/design/audit.mjs', 'pwa/package-lock.json',
             'pwa/package.json', 'pwa/src/app.tsx', 'pwa/src/components/RenderBoundary.tsx', 'pwa/src/main.tsx',
             'pwa/src/session/ChatList.tsx', 'pwa/src/session/MessageBubble.tsx', 'pwa/src/session/chat.css',
             'pwa/src/styles/shell.css', 'pwa/vite.config.ts', 'server/test/ccrc-doctor.test.ts',
             'server/test/ccrc-install.test.ts', 'server/test/ccrc-update.test.ts', 'server/test/docs-parity.test.ts',
             'server/test/installTreeFixture.ts', 'server/test/swFixtures.ts']
            + ['pwa/src/lib/' + f for f in LIB] + ['pwa/test/' + f for f in PWA_TESTS])
GOLDEN = re.compile(r'^pwa/test/golden/markdown/[a-z0-9-]+\.html$')
FROZEN = ['pwa/test/golden', 'pwa/test/markdownCorpus.ts', 'pwa/test/markdown-golden.test.tsx']
FORBIDDEN = ['shared', 'server/src', 'agent', '.github', 'ccd/ccd', 'ccd/ccrc', 'README.md', 'CLAUDE.md',
             'server/test/single-definition.test.ts', 'pwa/src/lib/api.ts']
LINKS = 'pwa/test/message-links.test.tsx'
FIVE = {'unified': '11.0.5', 'remark-parse': '11.0.0', 'remark-rehype': '11.1.2',
        'hast-util-to-jsx-runtime': '2.3.6', 'html-url-attributes': '3.0.1'}
DOCTOR = 'ccd/ccrc-doctor-checks'
DOCTOR_TEST = 'server/test/ccrc-doctor.test.ts'
PARITY = 'server/test/docs-parity.test.ts'
INSERT_ONLY = ['server/test/ccrc-install.test.ts', 'server/test/ccrc-update.test.ts']
DEPLOY = 'deploy/deploy.sh'
SWD = 'pwa/src/lib/sw-denylist.ts'
VITE = 'pwa/vite.config.ts'


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout


def show(rev, path):
    """The file's text at rev, or None when rev has no such file."""
    p = subprocess.run(['git', 'show', '%s:%s' % (rev, path)], capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None


def head(path):
    return open(path, encoding='utf-8').read()


results = []


def check(name, ok, answer):
    results.append(ok)
    print('%s %-16s %s' % ('PASS' if ok else 'FAIL', name, answer))


def hunks(path):
    """[(a, b, c, d, minus lines, plus lines)] of `git diff -U0 REF HEAD -- path`."""
    out = []
    patch = git('diff', '-U0', REF, 'HEAD', '--', path)
    parts = re.split(r'^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@.*)$', patch, flags=re.M)
    for i in range(1, len(parts), 2):
        m = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', parts[i])
        body = parts[i + 1].splitlines()
        out.append((int(m.group(1)), int(m.group(2) or 1), int(m.group(3)), int(m.group(4) or 1),
                    [l[1:] for l in body if l.startswith('-')], [l[1:] for l in body if l.startswith('+')]))
    return out


def spans(hs):
    return ['-%d,%d +%d,%d' % h[:4] for h in hs] or 'none'


def headings(text):
    """(offset, heading) of every `## ` line OUTSIDE a fenced block: Task 10's text quotes a `## Deviations found`
    heading inside its template fence, and Task 12's tools spell headings inside theirs."""
    out, fence, at = [], None, 0
    for line in text.splitlines(keepends=True):
        m = re.match(r'^(`{3,}|~{3,})', line)
        if m:
            if fence is None:
                fence = m.group(1)
            elif m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and line.strip() == m.group(1):
                fence = None
        elif fence is None and line.startswith('## '):
            out.append((at, line.rstrip('\n')))
        at += len(line)
    return out


def section(text, name):
    """The text of the one `## <name>` section outside fences (to the next such heading), or None."""
    marks = headings(text)
    found = [i for i, (_at, h) in enumerate(marks) if h == '## ' + name]
    if len(found) != 1:
        return None
    i = found[0]
    return text[marks[i][0]:marks[i + 1][0] if i + 1 < len(marks) else len(text)]


merges = git('rev-list', '--first-parent', '--merges', '%s..HEAD' % BASE).split()
REF = git('rev-parse', merges[0] + '^2').strip() if merges else git('rev-parse', BASE).strip()
commits = git('rev-list', '--first-parent', '--no-merges', '%s..HEAD' % BASE).split()
touched = set(l for l in git('log', '--first-parent', '--no-merges', '--format=', '--name-only',
                                '%s..HEAD' % BASE).splitlines() if l)
print('base %s, ref %s, tip %s, %d W4 commits, %d merges of main' % (
    git('rev-parse', '--short=12', BASE).strip(), REF[:12], git('rev-parse', '--short=12', 'HEAD').strip(),
    len(commits), len(merges)))

golden_touched = sorted(f for f in touched if f.startswith('pwa/test/golden/'))
extra = sorted(f for f in touched - SCOPE - {PLAN} if not GOLDEN.match(f))
missing = sorted(SCOPE - touched)
check('scope', not extra and not missing,
      '%d files touched by W4 commits (%d of them golden files); outside the scope: %s; scope files untouched: %s'
      % (len(touched), len(golden_touched), extra or 'none', missing or 'none'))

moved = sorted(set(git('diff', '--name-only', REF, 'HEAD', '--', *FORBIDDEN).split()))
check('untouched', not moved, 'shared/, server/src/, agent/, .github/, ccd/ccd, ccd/ccrc, README.md, CLAUDE.md, '
      'single-definition.test.ts, pwa/src/lib/api.ts changed vs ref: %s' % (moved or 'none'))

check('links', show(REF, LINKS) == head(LINKS), '%s byte-equal to ref: %s' % (LINKS, show(REF, LINKS) == head(LINKS)))

added_by = git('log', '--format=%H', '--diff-filter=A', '--', 'pwa/test/markdown-golden.test.tsx').split()
t1 = added_by[-1] if added_by else ''
t1_ok = bool(t1) and t1 in commits
after_t1 = git('diff', '--name-status', t1, 'HEAD', '--', *FROZEN).split('\n') if t1_ok else ['no Task 1 commit']
after_t1 = [l for l in after_t1 if l]
n_golden = len([f for f in git('ls-tree', '-r', '--name-only', 'HEAD', 'pwa/test/golden/markdown').split()
                if GOLDEN.match(f)])
added_later = sorted(f for f in golden_touched
                     if git('log', '--format=%H', '--diff-filter=A', '%s..HEAD' % t1, '--', f).strip()) if t1_ok else []
check('golden', t1_ok and not after_t1 and not added_later and n_golden == len(golden_touched),
      'Task 1 commit %s; %d golden files at the tip, all added by it; changed since: %s; added after it: %s'
      % (t1[:12] or 'none', n_golden, after_t1 or 'none', added_later or 'none'))


def json_paths(a, b, at=()):
    """Every path where two parsed JSON values differ."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(at + (k,))
            else:
                out += json_paths(a[k], b[k], at + (k,))
        return out
    return [] if a == b else [at]


ref_lock, tip_lock = json.loads(show(REF, 'pwa/package-lock.json')), json.loads(head('pwa/package-lock.json'))
lock_diff = json_paths(ref_lock, tip_lock)
want_lock = sorted(('packages', '', 'dependencies', k) for k in FIVE)
lock_ok = sorted(lock_diff) == want_lock and all(
    tip_lock['packages']['']['dependencies'][k] == v for k, v in FIVE.items()) and not any(
    k in ref_lock['packages']['']['dependencies'] for k in FIVE)
check('lock', lock_ok, 'pwa/package-lock.json differs from ref at %s' % (
    ['/'.join(k or '""' for k in p) for p in lock_diff] or 'nothing'))

ref_pkg, tip_pkg = json.loads(show(REF, 'pwa/package.json')), json.loads(head('pwa/package.json'))
pkg_diff = json_paths(ref_pkg, tip_pkg)
ph = hunks('pwa/package.json')
plus = [l.strip() for h in ph for l in h[5]]
minus = [l for h in ph for l in h[4]]
pkg_ok = (sorted(pkg_diff) == sorted(('dependencies', k) for k in FIVE) and not minus
          and sorted(plus) == sorted('"%s": "%s",' % kv for kv in FIVE.items()))
check('manifest', pkg_ok, 'pwa/package.json differs at %s; %d lines added, %d removed' % (
    ['/'.join(p) for p in pkg_diff] or 'nothing', len(plus), len(minus)))

ref_par = show(REF, PARITY)
check('parity-append', head(PARITY).startswith(ref_par) and len(head(PARITY)) > len(ref_par),
      '%s at ref (%d lines) is a prefix of the tip (%d lines)' % (
          PARITY, ref_par.count('\n'), head(PARITY).count('\n')))

dh = hunks(DOCTOR)
ref_doc_lines = show(REF, DOCTOR).count('\n')
words = lambda s: s.split('#')[0].split()
in_place = [h for h in dh if h[1] == 1 and h[3] == 1 and len(h[4]) == 1 and len(h[5]) == 1
            and words(h[5][0]) == words(h[4][0]) + ['docs-sw']]
append = [h for h in dh if h[1] == 0 and h[0] == ref_doc_lines]
other = [h for h in dh if h not in in_place and h not in append]
mode = lambda rev: git('ls-tree', rev, '--', DOCTOR).split()[0]
check('doctor-shape', len(in_place) == 1 and len(append) == 1 and not other and mode(REF) == mode('HEAD'),
      '%s vs ref (%d lines, mode %s): %d table line gained docs-sw in place, %d EOF append (%s lines), other '
      'hunks: %s' % (DOCTOR, ref_doc_lines, mode('HEAD'), len(in_place), len(append),
                     append[0][3] if append else 0, spans(other)))

ref_dt = show(REF, DOCTOR_TEST).splitlines()
first = next((i + 1 for i, l in enumerate(ref_dt) if l.startswith('function healthy(')), None)
th = hunks(DOCTOR_TEST)
above = [h for h in th if first is None or h[0] < first]
eof = [h for h in th if h[1] == 0 and h[0] == len(ref_dt)]
check('doctor-test', first is not None and not above and len(eof) == 1,
      '%s: healthy() opens at line %s at ref; hunks above it: %s; EOF appends: %d; all hunks: %s'
      % (DOCTOR_TEST, first, spans(above), len(eof), spans(th)))

io = [(f, [h for h in hunks(f) if h[1] > 0 and h[4]]) for f in INSERT_ONLY]
check('insert-only', all(not bad for _f, bad in io), '; '.join(
    '%s: %d insertion hunk(s), lines removed or changed at %s' % (f, len(hunks(f)), spans(bad)) for f, bad in io))

deph = hunks(DEPLOY)
exp_ref = [l for l in show(REF, DEPLOY).splitlines() if l.startswith('export CCRC_SW_DENYLIST=')]
exp_tip = [l for l in head(DEPLOY).splitlines() if l.startswith('export CCRC_SW_DENYLIST=')]
dep_ok = (show(REF, DEPLOY).count('\n') == head(DEPLOY).count('\n') and sum(h[1] for h in deph) == 2
          and all(h[1] == h[3] for h in deph) and len(exp_ref) == 1 and exp_ref == exp_tip)
check('deploy', dep_ok, '%s: %d lines at ref, %d at the tip; changed in place: %s; export line byte-equal: %s'
      % (DEPLOY, show(REF, DEPLOY).count('\n'), head(DEPLOY).count('\n'), spans(deph),
         len(exp_ref) == 1 and exp_ref == exp_tip))


def blocks(swd, vite):
    """(header, docstring, co-tenant comment) line counts, measured the way Task 9 Step 8 measures them."""
    lines = swd.splitlines()
    header = len([l for l in lines[:19] if l.startswith('//')])
    doc, n, f = None, 0, False
    for l in lines:
        if l == '/**':
            f, n = True, 0
        if f:
            n += 1
        if l == ' */' and f:
            doc, f = n, False
            break
    cot, f = 0, False
    for l in vite.splitlines():
        if 'CO-TENANTS ARE A BUILD-TIME KNOB' in l:
            f = True
        if 'globPatterns:' in l:
            f = False
        if f:
            cot += 1
    return header, doc, cot


b_ref, b_tip = blocks(show(REF, SWD), show(REF, VITE)), blocks(head(SWD), head(VITE))
check('comment-lines', b_ref == b_tip and None not in b_tip,
      'sw-denylist.ts header, its docstring, vite.config.ts co-tenant comment: %s at ref, %s at the tip'
      % (list(b_ref), list(b_tip)))

nav = lambda t: [l for l in t.splitlines() if 'navigateFallbackDenylist' in l]
check('vite-line', len(nav(head(VITE))) == 1 and nav(show(REF, VITE)) == nav(head(VITE)),
      "the navigateFallbackDenylist line, byte-equal to ref: %s" % (nav(head(VITE)) or 'absent'))

css = lambda rev: sorted(f for f in git('ls-tree', '-r', '--name-only', rev, 'pwa').split() if f.endswith('.css'))
check('stylesheets', css(REF) == css('HEAD'), 'pwa/**/*.css: %d at ref, %d at the tip, added %s, removed %s' % (
    len(css(REF)), len(css('HEAD')), sorted(set(css('HEAD')) - set(css(REF))) or 'none',
    sorted(set(css(REF)) - set(css('HEAD'))) or 'none'))

plan = head(PLAN) if os.path.isfile(PLAN) else ''
dev = section(plan, 'Deviations found')
heads = [h for _at, h in headings(plan) if h == '## Deviations found']
defs = [int(n) for n in re.findall(r'^- \*\*D-(\d+) \(\d{4}-\d{2}-\d{2}\)\*\* — ', dev or '', re.M)]
loose = [l for l in (dev or '').splitlines() if re.match(r'^- \*\*D-', l)
         and not re.match(r'^- \*\*D-\d+ \(\d{4}-\d{2}-\d{2}\)\*\* — ', l)]
dev_ok = (len(heads) == 1 and len(defs) >= 4 and not loose and defs == list(range(LO, LO + len(defs)))
          and defs[-1] <= HI)
check('deviations', dev_ok, '## Deviations found x%d; defined %s (issued %d-%d; the first %d expected in order); '
      'malformed definition lines: %d' % (len(heads), ['D-%d' % n for n in defs] or 'none', LO, HI, len(defs),
                                          len(loose)))

TOKEN = re.compile(r'(?<![A-Za-z0-9_])D-\d+')
new_tokens = {}
for f in sorted(set(git('diff', '--name-only', REF, 'HEAD').split()) - {PLAN}):
    before = show(REF, f) or ''
    if not os.path.isfile(f):
        continue
    for h in hunks(f):
        for line in h[5]:
            for tok in TOKEN.findall(line):
                if tok not in before:
                    new_tokens.setdefault(f, set()).add(tok)
outside = plan.replace(dev, '') if dev else plan
plan_tokens = sorted(set(TOKEN.findall(outside)))
check('no-d-number', not new_tokens and not plan_tokens,
      'D-<n> tokens new in W4 files: %s; in this plan outside ## Deviations found: %s' % (
          dict((k, sorted(v)) for k, v in new_tokens.items()) or 'none', plan_tokens or 'none'))

print('%d invariants, %d PASS' % (len(results), sum(results)))
sys.exit(0 if all(results) else 1)
````

Then, one Bash call:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-invariants.py" "$(cat "$SCRATCH/w4-base")" "$(cat "$SCRATCH/w4-block")" | tee "$SCRATCH/w4-invariants.txt"; echo "rc=${PIPESTATUS[0]}"
```

Expected: the `base … ref … tip … <n> W4 commits, 0 merges of main` line, then sixteen `PASS` lines and `16 invariants, 16 PASS`, `rc=0`:
- `scope`: `<n> files touched by W4 commits (55 of them golden files); outside the scope: none; scope files untouched: none` (Global Constraints' scope list, `server/test/ccrc-install.test.ts` included, every one touched; the 55 golden files; and this plan, which Tasks 10 and 11 appended to). Measured: 107 with the plan.
- `untouched`: `… changed vs ref: none` (no `shared/` edit, so no `FLEET_PROTO` bump; no `server/src/`, `agent/`, `.github/`, `ccd/ccd`, `ccd/ccrc`, `README.md`, `CLAUDE.md`, `single-definition.test.ts` or `pwa/src/lib/api.ts` edit).
- `links`: `pwa/test/message-links.test.tsx byte-equal to ref: True` (section 7.9: it passes UNMODIFIED).
- `golden`: `Task 1 commit <12 hex>; 55 golden files at the tip, all added by it; changed since: none; added after it: none` (also `markdownCorpus.ts` and `markdown-golden.test.tsx` unchanged since Task 1).
- `lock`: the five paths `packages/""/dependencies/<name>`, and nothing else (refinement (p), judged on the parsed JSON).
- `manifest`: the five `dependencies/<name>` paths; `5 lines added, 0 removed`.
- `parity-append`: `server/test/docs-parity.test.ts at ref (447 lines) is a prefix of the tip (<n> lines)` (659 at Task 10's state).
- `doctor-shape`: `ccd/ccrc-doctor-checks vs ref (7376 lines, mode 100755): 1 table line gained docs-sw in place, 1 EOF append (<n> lines), other hunks: none` (121 at Task 10's state).
- `doctor-test`: `healthy() opens at line 1040 at ref; hunks above it: none; EOF appends: 1; …`.
- `insert-only`: `ccrc-install.test.ts: 4 insertion hunk(s), lines removed or changed at none; ccrc-update.test.ts: 2 insertion hunk(s), …` (Task 10 only ever inserted lines in either).
- `deploy`: `1290 lines at ref, 1290 at the tip; changed in place: ['-28,1 +28,1', '-41,1 +41,1']; export line byte-equal: True`.
- `comment-lines`: `[18, 14, 7] at ref, [18, 14, 7] at the tip` (section 7.3: edited in place, line counts unchanged).
- `vite-line`: the one `navigateFallbackDenylist: swDenylist(process.env['CCRC_SW_DENYLIST']),` line, byte-equal.
- `stylesheets`: `6 at ref, 6 at the tip, added none, removed none` (`contrast.test.ts` pins the sheet list; no new stylesheet).
- `deviations`: `## Deviations found x1; defined [the block's first <k> numbers] (issued <LO>-<HI>; the first <k> expected in order); malformed definition lines: 0`, `<k>` at least 4 (Task 10 Step 8's four, plus any reserve number a fix round spent).
- `no-d-number`: `D-<n> tokens new in W4 files: none; in this plan outside ## Deviations found: none`.

A `FAIL` line is a finding (Step 4's last paragraph); never edit the checker to make it pass.

- [ ] **Step 3: The build gate (section 7.7), in scratch copies, never in the worktree.** `npm run build` writes `../server/dist-pwa`, so it only ever runs in a `git archive` copy. Write the gate to `<SCRATCH>/tools/w4-gate.py`:

````python
#!/usr/bin/env python3
"""The build gate (spec section 7.7; the plan's Task 12, Step 3). Scratch only: never committed.

  python3 w4-gate.py SCRATCH BASE copy [--link]   two `git archive` copies, SCRATCH/gate-base and SCRATCH/gate-tip,
                                                   each with its own `npm ci` in pwa/ (--link: the worktree's
                                                   pwa/node_modules linked instead; planning only)
  python3 w4-gate.py SCRATCH BASE build base|tip   `npm run build` in that copy's pwa/, CCRC_SW_DENYLIST unset
  python3 w4-gate.py SCRATCH BASE refuse           the tip copy's build with CCRC_SW_DENYLIST='/wiki,/docs'
  python3 w4-gate.py SCRATCH BASE check            the verdicts, into SCRATCH/w4-gate.txt

Run from the worktree root; nothing is built or installed inside it (`npm run build` writes ../server/dist-pwa,
so it only ever runs in a copy). `build` records, right after the build, what the bundle holds into
SCRATCH/gate-<which>.json: the rc, the emitted `assets/markdownWorker-*.js`, the number of `denylist:[` in sw.js and
the list's text, and the precache entries (`{url:"...",revision:...}`), each with its content hash stripped for the
comparison. `refuse` leaves the built bundle alone: the vite config throws at load, before vite empties its outDir.
`copy` records HEAD in SCRATCH/gate-head, and `check` fails `measured-at` when HEAD has moved since. `check` prints one
PASS/FAIL line per gate item and `<n> gate checks, <n> PASS`; exit 0 only when all PASS.
"""
import json, os, re, shutil, subprocess, sys

SENTENCE = ("CCRC_SW_DENYLIST entry /docs covers /docs, ccrc's own Docs pages; a service worker that refuses them the "
            "app shell breaks them on every hard load. Remove it from CCRC_SW_DENYLIST (deploy.sh reads it from "
            "~/.ccrc/deploy.env on the deploying machine) and build again.")
TIMEOUT_S = 540


def die(msg):
    print('w4-gate.py: ' + msg, file=sys.stderr)
    sys.exit(2)


if len(sys.argv) < 4:
    die(__doc__)
S, BASE, CMD = sys.argv[1], sys.argv[2], sys.argv[3]
if not os.path.isdir('pwa') or not os.path.isdir('server/test'):
    die('run me from the worktree root')
COPY = {'base': os.path.join(S, 'gate-base'), 'tip': os.path.join(S, 'gate-tip')}


def env(denylist=None):
    e = dict(os.environ)
    e.pop('CCRC_SW_DENYLIST', None)
    if denylist is not None:
        e['CCRC_SW_DENYLIST'] = denylist
    return e


def sh(argv, cwd, e=None, timeout=TIMEOUT_S):
    try:
        p = subprocess.run(argv, cwd=cwd, env=e or env(), capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as t:
        return 124, t.stdout or '', t.stderr or ''


def strip_hash(u):
    return re.sub(r'-[A-Za-z0-9_-]{8}(\.[a-z]+)$', r'\1', u)


def measure(which):
    dist = os.path.join(COPY[which], 'server', 'dist-pwa')
    workers = sorted('assets/' + f for f in os.listdir(os.path.join(dist, 'assets'))
                     if re.fullmatch(r'markdownWorker-[A-Za-z0-9_-]+\.js', f)) \
        if os.path.isdir(os.path.join(dist, 'assets')) else []
    sw = open(os.path.join(dist, 'sw.js'), encoding='utf-8').read() if os.path.isfile(os.path.join(dist, 'sw.js')) \
        else ''
    lists = re.findall(r'denylist:\[.*?\]\}', sw)
    urls = re.findall(r'\{url:"([^"]+)",revision:', sw)
    return {'workers': workers, 'swLines': sw.count('\n'), 'denylists': sw.count('denylist:['),
            'denylist': lists[0][:-1] if lists else None, 'precache': urls,
            'precacheNames': sorted(strip_hash(u) for u in urls)}


if CMD == 'copy':
    link = '--link' in sys.argv[4:]
    head_now = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout
    open(os.path.join(S, 'gate-head'), 'w').write(head_now)
    for which, rev in (('base', BASE), ('tip', 'HEAD')):
        d = COPY[which]
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d)
        tar = subprocess.run(['git', 'archive', '--format=tar', rev], capture_output=True, check=True).stdout
        subprocess.run(['tar', '-x', '-C', d], input=tar, check=True)
        subprocess.run(['git', '-C', d, 'init', '-q'], check=True)
        if link:
            os.symlink(os.path.realpath('pwa/node_modules'), os.path.join(d, 'pwa', 'node_modules'))
            print('%s: %s, pwa/node_modules linked (planning only)' % (which, rev[:12]))
        else:
            rc, out, err = sh(['npm', 'ci', '--no-audit', '--no-fund'], os.path.join(d, 'pwa'))
            print('%s: %s, npm ci rc=%d %s' % (which, rev[:12], rc, (out + err).strip().splitlines()[-1:]))
            if rc != 0:
                die('npm ci failed in the %s copy; stop and report' % which)
    sys.exit(0)

if CMD == 'build':
    which = sys.argv[4] if len(sys.argv) > 4 else ''
    if which not in COPY or not os.path.isdir(COPY[which]):
        die('build takes base or tip, after copy')
    rc, out, err = sh(['npm', 'run', 'build'], os.path.join(COPY[which], 'pwa'))
    open(os.path.join(S, 'gate-%s-build.log' % which), 'w', encoding='utf-8').write(out + err + '\nrc=%d\n' % rc)
    m = dict(measure(which), rc=rc)
    json.dump(m, open(os.path.join(S, 'gate-%s.json' % which), 'w'), indent=1)
    print('%s build rc=%d; workers %s; sw.js %d denylist:[ (%s); %d precache entries' % (
        which, rc, m['workers'] or 'none', m['denylists'], m['denylist'], len(m['precache'])))
    sys.exit(0 if rc == 0 else 1)

if CMD == 'refuse':
    rc, out, err = sh(['npm', 'run', 'build'], os.path.join(COPY['tip'], 'pwa'), env('/wiki,/docs'))
    json.dump({'rc': rc, 'sentence': SENTENCE in err, 'stderr': err[-2000:]},
              open(os.path.join(S, 'gate-refuse.json'), 'w'), indent=1)
    print('refused build rc=%d; the section 7.3 sentence on stderr: %s' % (rc, SENTENCE in err))
    sys.exit(0)

if CMD == 'check':
    lines, oks = [], []

    def check(name, ok, answer):
        ok = bool(ok)
        oks.append(ok)
        lines.append('%s %-14s %s' % ('PASS' if ok else 'FAIL', name, answer))

    try:
        b, t = (json.load(open(os.path.join(S, 'gate-%s.json' % w))) for w in ('base', 'tip'))
        r = json.load(open(os.path.join(S, 'gate-refuse.json')))
    except OSError as e:
        die('a gate step has not run (%s)' % e)
    src = open('server/test/swFixtures.ts', encoding='utf-8').read()
    lit = re.search(r"^export const SW_DENYLIST_DEFAULT = '((?:[^'\\]|\\.)*)';$", src, re.M)
    default = re.sub(r'\\(.)', r'\1', lit.group(1)) if lit else None
    at = open(os.path.join(S, 'gate-head')).read().strip()
    now = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    check('measured-at', at == now, 'the tip copy is HEAD %s; HEAD is %s' % (at[:12], now[:12]))
    check('builds', b['rc'] == 0 and t['rc'] == 0, 'npm run build rc: base %d, tip %d' % (b['rc'], t['rc']))
    w = t['workers']
    check('worker-chunk', len(w) == 1 and not b['workers'], 'markdownWorker chunks: tip %s, base %s' % (
        w or 'none', b['workers'] or 'none'))
    check('precached', len(w) == 1 and w[0] in t['precache'], 'sw.js precaches %s: %s' % (
        w[0] if w else 'no worker', bool(w) and w[0] in t['precache']))
    check('one-denylist', t['denylists'] == 1 and t['swLines'] <= 1, 'tip sw.js: %d line(s), %d denylist:[' % (
        t['swLines'], t['denylists']))
    check('default-list', default is not None and t['denylist'] == default and b['denylist'] == default,
          'tip %s; base %s; swFixtures.ts SW_DENYLIST_DEFAULT %s' % (t['denylist'], b['denylist'], default))
    added = sorted(set(t['precacheNames']) - set(b['precacheNames']))
    removed = sorted(set(b['precacheNames']) - set(t['precacheNames']))
    check('precache', not removed and added and all(a.startswith('assets/') and a.endswith('.js') for a in added)
          and 'assets/markdownWorker.js' in added and len(t['precache']) == len(b['precache']) + len(added),
          '%d entries at the base, %d at the tip; added %s; removed %s' % (
              len(b['precache']), len(t['precache']), added or 'none', removed or 'none'))
    check('refusal', r['rc'] == 1 and r['sentence'], "CCRC_SW_DENYLIST='/wiki,/docs': rc=%d, sentence on stderr: %s"
          % (r['rc'], r['sentence']))
    lines.append('%d gate checks, %d PASS' % (len(oks), sum(oks)))
    open(os.path.join(S, 'w4-gate.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    sys.exit(0 if all(oks) else 1)

die('unknown command %r' % CMD)
````

Then, one Bash call per line (each `npm ci` and each build fits one call; `copy` runs both `npm ci`s, so split it per copy only if it nears 570 s):

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-gate.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" copy
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-gate.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" build base
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-gate.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" build tip
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-gate.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" refuse
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-gate.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" check; echo "rc=$?"; git status --short
```

Expected: `base: <12 hex>, npm ci rc=0 …` and `tip: HEAD, npm ci rc=0 …` (the tip's clean `npm ci` is refinement (p)'s second proof, re-run on the wave's end state); `base build rc=0; workers none; sw.js 1 denylist:[ (denylist:[/^\/api\//,/^\/ws\//]); 16 precache entries`; `tip build rc=0; workers ['assets/markdownWorker-<hash>.js']; sw.js 1 denylist:[ (denylist:[/^\/api\//,/^\/ws\//]); 17 precache entries`; `refused build rc=1; the section 7.3 sentence on stderr: True`; then eight `PASS` lines (`measured-at`, `builds`, `worker-chunk`, `precached`, `one-denylist`, `default-list`, `precache` with `added ['assets/markdownWorker.js']; removed none`, `refusal`), `8 gate checks, 8 PASS`, `rc=0`; and no status line. The entry counts are measured, not bound: `main` moving the shell's chunks moves both builds alike, and what binds is that the tip adds the worker chunk and removes nothing. A `FAIL` line is a finding.

- [ ] **Step 4: The mutation table.** Mutations never run in the worktree. Write the row extractor to `<SCRATCH>/tools/w4-rows.py`:

````python
#!/usr/bin/env python3
"""Build the W4 mutation table from the plan itself (the plan's Task 12, Step 4). Scratch only: never committed.

  python3 w4-rows.py PLAN OUT [EXTRA]

Reads every `### Task <n>: ` section of PLAN (a section ends at the next `### Task` heading, or at the end of the
file: `## Deviations found` and `## Wave 4 results` follow Task 12, and Task 10's text quotes a `## ` heading inside
a fence, so a `## ` line is no boundary), takes the LAST line in it that starts with the rows marker, and decodes
the JSON array that follows the first json fence after that line with `raw_decode`, never by searching for the
closing fence: Task 3's rows W4-T3-M6 and W4-T3-M7 spell a code fence inside their `old`/`new` strings, and a reader
that cuts at the next fence fails on them. Tasks 1-10 must each contribute at least one row; Task 11's block holds
only the rows its fix loop appended, so it may be empty; Task 12's is empty. A row's id is `W4-T<m>-M<k>`: m is its
own task, or an EARLIER task that already contributed that id (a re-anchor: a later task, or a Task 11 fix, that
re-spells code an earlier row anchors on repeats the row with a new `old`), and then the LAST occurrence in task
order supersedes the first and keeps its place in the table. EXTRA, when given, is a JSON list of rows in the same
shape that a per-task review measured red but no rows block carries (its ids must be new); they are appended and
marked. Each row keeps its fields verbatim (id, pkg, file, old, new, tests, red) and gains `task` (its id's task)
and `from` (the task whose block carried the row that counts). `tests` is the argv after `vitest run`, so a `-t`
pattern rides in it.
"""
import json, re, sys

if len(sys.argv) not in (3, 4):
    sys.exit(__doc__)
PLAN, OUT = sys.argv[1], sys.argv[2]
EXTRA_PATH = sys.argv[3] if len(sys.argv) == 4 else None
# The marker and the fence are built from parts, so this file never spells either one whole.
MARK = '**Mutation rows' + ' this task contributes**'
FENCE = '`' * 3 + 'json'
FIELDS = ('id', 'pkg', 'file', 'old', 'new', 'tests', 'red')
text = open(PLAN, encoding='utf-8').read()
heads = list(re.finditer(r'^### Task (\d+): ', text, re.M))
nums = [int(h.group(1)) for h in heads]
if nums != list(range(1, 13)):
    sys.exit('w4-rows.py: the plan has Task headings %r, not 1..12 in order; stop and report' % nums)
rows, order, per, reanchored = {}, [], [], []
for i, h in enumerate(heads):
    n = nums[i]
    sec = text[h.start():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
    leads = [m.start() for m in re.finditer(r'^' + re.escape(MARK), sec, re.M)]
    if not leads:
        sys.exit('w4-rows.py: Task %d has no rows line; stop and report' % n)
    at = sec.find('\n' + FENCE + '\n', leads[-1])
    if at < 0:
        sys.exit('w4-rows.py: Task %d has no json fence after its rows line; stop and report' % n)
    try:
        got, _end = json.JSONDecoder().raw_decode(sec, at + len(FENCE) + 2)
    except ValueError as e:
        sys.exit('w4-rows.py: Task %d rows block does not decode (%s); stop and report' % (n, e))
    if not isinstance(got, list) or (n <= 10 and not got) or (n == 12 and got):
        sys.exit('w4-rows.py: Task %d contributes %r rows; Tasks 1-10 need some, Task 11 may hold none, Task 12 none'
                 % (n, len(got) if isinstance(got, list) else got))
    seen = set()
    for r in got:
        missing = [k for k in FIELDS if k not in r]
        m = re.fullmatch(r'W4-T(\d+)-M(\d+)', r.get('id', ''))
        if missing or not m or r['id'] in seen or r.get('pkg') not in ('pwa', 'server') \
                or not isinstance(r.get('tests'), list) or not r['tests']:
            sys.exit('w4-rows.py: row %r of Task %d: missing %r, a malformed id, pkg or tests, or a repeat in one block'
                     % (r.get('id'), n, missing))
        owner = int(m.group(1))
        if owner != n and not (owner < n and r['id'] in rows):
            sys.exit('w4-rows.py: row %s of Task %d names Task %d, which never contributed it; stop and report'
                     % (r['id'], n, owner))
        seen.add(r['id'])
        if r['id'] in rows:
            reanchored.append('%s (by T%d)' % (r['id'], n))
        else:
            order.append(r['id'])
        rows[r['id']] = dict(r, task='T%d' % owner, **{'from': 'T%d' % n})
    per.append('T%d %d' % (n, len(got)))
extra = []
if EXTRA_PATH:
    for r in json.load(open(EXTRA_PATH, encoding='utf-8')):
        missing = [k for k in FIELDS if k not in r]
        if missing or r['id'] in rows or not re.fullmatch(r'W4-T\d+-M\d+', r['id']):
            sys.exit('w4-rows.py: extra row %r: missing %r, a malformed id, or an id the plan already has'
                     % (r.get('id'), missing))
        rows[r['id']] = dict(r, task='T' + r['id'].split('-')[1][1:], **{'from': 'review'})
        order.append(r['id'])
        extra.append(r['id'])
json.dump([rows[i] for i in order], open(OUT, 'w', encoding='utf-8'), indent=1)
print('%d rows in 12 blocks (%s); %d ids after %d re-anchor(s)%s%s' % (
    sum(int(p.split()[1]) for p in per), ', '.join(per), len(order), len(reanchored),
    (': ' + ', '.join(reanchored)) if reanchored else '',
    ('; %d extra review rows: %s' % (len(extra), ', '.join(extra))) if extra else ''))
````

Write the runner to `<SCRATCH>/tools/mutate.py`:

````python
#!/usr/bin/env python3
"""Mutation runner for the native Docs reader, wave 4 (the plan's Task 12, Step 4). Scratch only: never committed.

Run from the WORKTREE root. It reads HEAD with git, and it never writes inside the worktree:

  python3 mutate.py ROWS MUT setup             build MUT, a `git archive` copy of HEAD, and its manifest
  python3 mutate.py ROWS MUT baseline          every distinct test command the rows name, unmutated: all green
  python3 mutate.py ROWS MUT run [ID ...]      measure the rows not measured yet (all of them, or the IDs given)
  python3 mutate.py ROWS MUT final             MUT is byte-equal to HEAD again, and every test command is green
  python3 mutate.py ROWS MUT equivalent        refinement (b)'s plugin-order swap, measured: it must stay GREEN
  python3 mutate.py ROWS MUT report            the measured table, as markdown, for the results section

ROWS is the list w4-rows.py writes: {id, task, from, pkg, file, old, new, tests, red}. A row replaces exactly one
occurrence of `old` with `new` in MUT/<file>; an `old` that is absent or not unique SKIPS the row and touches
nothing. A row runs `vitest run --bail=1 <tests>` in MUT/<pkg> (`tests` is the argv after `vitest run`, so a `-t`
pattern rides in it). A PWA command runs with CI=1 (the golden test never writes a missing snapshot file under CI,
so a row can never plant one in the copy); every command runs with CCRC_SW_DENYLIST removed from its environment
(the vite config refuses an entry covering /docs at load). A row is RED only when a test FAILED on something other
than vitest's own per-test timeout: a run whose every failure is `Test timed out in <n>ms` is `red-timeout`, the
shape a loaded box gives an unmutated file, and never counts as red. The report names the first failed case, for
the reader to set beside the row's recorded `red`.

Each row backs its file up under a sentinel of its own (MUT.bak/<id>.orig), writes MUT.pending.json BEFORE it
mutates, and restores the file byte for byte afterwards, its mode untouched (ccd/ccrc-doctor-checks is 100755),
asserting the sha256 the manifest recorded. A run killed mid-row leaves MUT.pending.json behind, and the next
invocation restores from it before anything else.

One invocation starts a row or a command only while it has run at most BUDGET_S seconds AND that piece's own bound
still ends before CEILING_S, so every invocation ends inside a 600 s tool call; a piece that does not fit waits for
the next invocation, where it starts first. Run it again until it prints ALL ROWS MEASURED (or ALL COMMANDS GREEN).
"""
import hashlib, json, os, re, shutil, signal, subprocess, sys, time

BUDGET_S = 390
# Refinement (b): remark-gfm 4.0.1 returns no transformer, so swapping the chat plugin list renders byte-identically
# and no case can redden. Not a row (it never goes red); measured once at the wave's end state and recorded.
EQUIVALENT = {'id': 'equivalent-plugin-order', 'pkg': 'pwa', 'file': 'pwa/src/lib/markdown.tsx',
              'old': 'remarkPlugins={[remarkGfm, remarkAlerts]}', 'new': 'remarkPlugins={[remarkAlerts, remarkGfm]}',
              'tests': ['test/markdown-golden.test.tsx']}
CEILING_S = 570
TIMEOUT_S = {'pwa': 180, 'server': 420}
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')


def die(msg):
    print('mutate.py: ' + msg, file=sys.stderr)
    sys.exit(2)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def on_signal(signum, _frame):
    raise SystemExit(128 + signum)


for _s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(_s, on_signal)

if len(sys.argv) < 4:
    die(__doc__)
ROWS_PATH, MUT, CMD = sys.argv[1], os.path.abspath(sys.argv[2]), sys.argv[3]
ROOT = os.getcwd()
top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
if top.returncode != 0 or os.path.realpath(top.stdout.strip()) != os.path.realpath(ROOT):
    die('run me from the worktree root')
real_mut, real_root = os.path.realpath(MUT), os.path.realpath(ROOT)
if real_mut == real_root or real_mut.startswith(real_root + os.sep):
    die('MUT must lie OUTSIDE the worktree: mutations never run in it')
ROWS = json.load(open(ROWS_PATH, encoding='utf-8'))
BY_ID = dict((r['id'], r) for r in ROWS)
if len(BY_ID) != len(ROWS):
    die('duplicate row ids')
MANIFEST, RESULTS, PENDING, BAK = MUT + '.manifest.json', MUT + '.results.jsonl', MUT + '.pending.json', MUT + '.bak'
BASE_DONE, FINAL_DONE = MUT + '.baseline.json', MUT + '.final.json'
T0 = time.monotonic()


def head_sha():
    return subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()


def head_bytes(f):
    """The file's bytes at HEAD, or None when HEAD has no such file."""
    p = subprocess.run(['git', 'cat-file', 'blob', 'HEAD:' + f], capture_output=True)
    return p.stdout if p.returncode == 0 else None


def load_manifest():
    if not os.path.exists(MANIFEST):
        die('no manifest: run setup first')
    m = json.load(open(MANIFEST))
    if m['head'] != head_sha():
        die('HEAD moved since setup: run setup, then baseline, again')
    return m


def matches(m, f):
    p = os.path.join(MUT, f)
    return os.path.isfile(p) and sha(open(p, 'rb').read()) == m['files'][f]


def put_back(m, f, bak):
    p = os.path.join(MUT, f)
    shutil.copyfile(bak, p)
    os.remove(bak)
    if not matches(m, f):
        die('%s was not restored to the manifest state (backup %s)' % (f, bak))


def kill_group(pgid):
    """SIGTERM to vitest's whole process group (its workers and anything they spawned), then SIGKILL."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except OSError:
            return
        if sig == signal.SIGTERM:
            time.sleep(5)


def ours(pid):
    """True only while pid is still a vitest leader running in MUT: a recorded pid can be reused once its process
    has gone, and this runner never signals a group it cannot prove is its own."""
    try:
        cwd = os.path.realpath('/proc/%d/cwd' % pid)
    except OSError:
        return False
    return cwd == real_mut or cwd.startswith(real_mut + os.sep)


def restore_pending(m):
    if not os.path.exists(PENDING):
        return
    p = json.load(open(PENDING))
    if p.get('pgid') and ours(p['pgid']):
        kill_group(p['pgid'])
    put_back(m, p['file'], p['bak'])
    os.remove(PENDING)
    print('restored %s, left mutated by an interrupted row %s' % (p['file'], p['id']))


def assert_pristine(m):
    for f in sorted(m['files']):
        if not matches(m, f):
            die('%s in MUT is not its HEAD state: run setup again' % f)


def unit_of(r):
    return (r['pkg'], tuple(r['tests']))


def units():
    seen = []
    for r in ROWS:
        u = unit_of(r)
        if u not in seen:
            seen.append(u)
    return seen


def unit_key(u):
    return '%s: %s' % (u[0], ' '.join(("'%s'" % a) if ' ' in a else a for a in u[1]))


def env_for(pkg):
    env = dict(os.environ)
    env.pop('CCRC_SW_DENYLIST', None)
    if pkg == 'pwa':
        env['CI'] = '1'
    return env


def vitest(unit, timeout_s, bail, on_start=None):
    pkg, tests = unit
    argv = ['./node_modules/.bin/vitest', 'run'] + (['--bail=1'] if bail else []) + list(tests)
    p = subprocess.Popen(argv, cwd=os.path.join(MUT, pkg), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         env=env_for(pkg), start_new_session=True)
    if on_start is not None:
        on_start(p.pid)
    try:
        out, _ = p.communicate(timeout=timeout_s)
        return p.returncode, ANSI.sub('', out.decode('utf-8', 'replace')), False
    except subprocess.TimeoutExpired:
        kill_group(p.pid)
        out, _ = p.communicate()
        return None, ANSI.sub('', out.decode('utf-8', 'replace')), True
    except BaseException:
        kill_group(p.pid)
        raise


def failed_titles(out):
    """The own title (the last ` > ` segment) of every test vitest reports as failed, in the order printed."""
    got = []
    for line in out.splitlines():
        m = re.match(r'^\s*(?:FAIL|\u00d7|\u2717)\s+(.*?)\s*(?:\d+ms)?\s*$', line)
        if m:
            t = m.group(1).split(' > ')[-1].strip()
            if t and t not in got:
                got.append(t)
    return got


def classify(rc, out, timed_out):
    """green | red | red-timeout | timeout | error. Red needs a FAILED TEST whose failure is not vitest's own
    per-test timeout; anything else that is not green (a config error, 'no test files', a load failure) is error."""
    if timed_out:
        return 'timeout', out.strip()[-600:]
    if rc == 0:
        return 'green', ''
    counted = re.findall(r'^\s*Tests\s+(\d+) failed', out, re.M)
    if counted and int(counted[-1]) > 0:
        titles = failed_titles(out)
        blocks = len(re.findall(r'^\s*FAIL\s+\S+.* > ', out, re.M))
        timeouts = len(re.findall(r'Test timed out in \d+ms', out))
        first = (titles[0] if titles else 'Tests %s failed' % counted[-1])[:240]
        if blocks and timeouts >= blocks:
            return 'red-timeout', first
        return 'red', first
    return 'error', out.strip()[-1200:]


def results():
    got = {}
    if os.path.exists(RESULTS):
        for line in open(RESULTS, encoding='utf-8'):
            if line.strip():
                o = json.loads(line)
                got[o['id']] = o
    return got


def cmd_setup():
    for p in (MUT, BAK):
        if os.path.exists(p):
            shutil.rmtree(p)
    for p in (MANIFEST, RESULTS, PENDING, BASE_DONE, FINAL_DONE):
        if os.path.exists(p):
            os.remove(p)
    os.makedirs(MUT)
    os.makedirs(BAK)
    tar = subprocess.run(['git', 'archive', '--format=tar', 'HEAD'], capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', MUT], input=tar, check=True)
    subprocess.run(['git', '-C', MUT, 'init', '-q'], check=True)
    for pkg in ('server', 'pwa', 'agent'):
        src = os.path.join(ROOT, pkg, 'node_modules')
        if os.path.isdir(src):
            os.symlink(os.path.realpath(src), os.path.join(MUT, pkg, 'node_modules'))
        elif pkg != 'agent':
            die('%s has no node_modules: run npm ci there first' % pkg)
    files = {}
    for r in ROWS:
        f = r['file']
        want = head_bytes(f)
        if want is None or r['old'] == '':
            die('row %s mutates %s, which HEAD does not have, or anchors on an empty `old`' % (r['id'], f))
        data = open(os.path.join(MUT, f), 'rb').read()
        if data != want:
            die('%s in the archive differs from HEAD' % f)
        files[f] = sha(data)
    json.dump({'head': head_sha(), 'files': files}, open(MANIFEST, 'w'), indent=1)
    print('MUT ready at HEAD %s: %d files under mutation, %d rows, %d test commands'
          % (head_sha()[:12], len(files), len(ROWS), len(units())))


def fits(tmo):
    """May a piece bounded by tmo seconds start now?"""
    elapsed = time.monotonic() - T0
    return elapsed <= BUDGET_S and elapsed + tmo <= CEILING_S


def run_units(done_path, label):
    m = load_manifest()
    restore_pending(m)
    assert_pristine(m)
    done = json.load(open(done_path)) if os.path.exists(done_path) else {}
    for u in units():
        key = unit_key(u)
        if done.get(key) == 'green':
            continue
        if not fits(TIMEOUT_S[u[0]]):
            print('%d of %d commands green; run `%s` again' % (len(done), len(units()), label))
            return 3
        rc, out, timed_out = vitest(u, TIMEOUT_S[u[0]], False)
        verdict, detail = classify(rc, out, timed_out)
        print('%-8s %s %s' % (verdict.upper(), key[:200], detail[:300]))
        if verdict != 'green':
            print(out.strip()[-2000:])
            die('%s is not green unmutated: every red row would be meaningless; stop and report' % key)
        done[key] = 'green'
        json.dump(done, open(done_path, 'w'), indent=1)
    print('ALL COMMANDS GREEN (%s)' % label)
    return 0


def mutate_one(m, r):
    f = r['file']
    path = os.path.join(MUT, f)
    text = open(path, 'rb').read().decode('utf-8')
    n = text.count(r['old'])
    if n != 1:
        return 'skipped', '`old` occurs %d times in %s: %r' % (n, f, r['old'][:80])
    text = text.replace(r['old'], r['new'], 1)
    bak = os.path.join(BAK, r['id'] + '.orig')
    shutil.copyfile(path, bak)
    pending = {'id': r['id'], 'file': f, 'bak': bak}
    json.dump(pending, open(PENDING, 'w'))

    def started(pid):
        pending['pgid'] = pid
        json.dump(pending, open(PENDING, 'w'))

    try:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)
        rc, out, timed_out = vitest(unit_of(r), TIMEOUT_S[r['pkg']], True, started)
        return classify(rc, out, timed_out)
    finally:
        put_back(m, f, bak)
        os.remove(PENDING)


def cmd_run(ids):
    m = load_manifest()
    restore_pending(m)
    assert_pristine(m)
    for i in ids:
        if i not in BY_ID:
            die('no row %s' % i)
    got = results()
    queue = [r for r in ROWS if r['id'] in ids] if ids else [r for r in ROWS if r['id'] not in got]
    bad = 0
    for r in queue:
        if not fits(TIMEOUT_S[r['pkg']]):
            continue
        t = time.monotonic()
        verdict, detail = mutate_one(m, r)
        ok = verdict == 'red'
        rec = {'id': r['id'], 'verdict': verdict, 'ok': ok, 'detail': detail, 'seconds': int(time.monotonic() - t)}
        with open(RESULTS, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(rec) + '\n')
        bad += 0 if ok else 1
        print('== %-10s [%s] %-9s %s  %ss  %s' % (r['id'], r['task'], verdict.upper(), 'ok' if ok else 'NOT OK',
              rec['seconds'], detail[:200]))
    assert_pristine(m)
    left = [x['id'] for x in ROWS if x['id'] not in results()]
    if left:
        print('%d rows left (%s...): run `run` again' % (len(left), ', '.join(left[:6])))
        return 3
    nok = [x for x in results().values() if not x['ok']]
    print('ALL ROWS MEASURED: %d ok, %d not ok%s' % (len(ROWS) - len(nok), len(nok),
          (' -> ' + ', '.join(x['id'] for x in nok)) if nok else ''))
    return 1 if (nok or bad) else 0


def cmd_final():
    m = load_manifest()
    restore_pending(m)
    for f in sorted(m['files']):
        if not matches(m, f) or open(os.path.join(MUT, f), 'rb').read() != head_bytes(f):
            die('%s in MUT is not byte-equal to HEAD' % f)
    print('MUT byte-equal to HEAD for all %d files under mutation' % len(m['files']))
    return run_units(FINAL_DONE, 'final')


def cmd_report():
    got = results()
    cell = lambda s: s.replace('|', '\\|').replace('\n', ' ')
    out = ['| Row | Task | File | Result | First red case (measured) |', '|---|---|---|---|---|']
    for r in ROWS:
        g = got.get(r['id'])
        if g is None:
            res, case = 'NOT MEASURED', ''
        else:
            res = g['verdict'] + ('' if g['ok'] else ' (NOT OK)')
            # Only a red detail is a test's own name; any other detail can carry a scratch path, and stays in
            # MUT.results.jsonl for the report to the coordinator.
            case = g['detail'] if g['verdict'] in ('red', 'red-timeout') else '(detail in w4-mut.results.jsonl)'
        task = r['task'] if r.get('from', r['task']) == r['task'] else '%s (re-anchored in %s)' % (r['task'],
                                                                                                 r['from'])
        out.append('| %s | %s | `%s` | %s | %s |' % (r['id'], task, r['file'], res, cell(case[:160])))
    nok = [r['id'] for r in ROWS if r['id'] not in got or not got[r['id']]['ok']]
    out.append('')
    out.append('%d rows; %d measured as expected%s.' % (len(ROWS), len(ROWS) - len(nok),
               ('; not as expected or not measured: ' + ', '.join(nok)) if nok else ''))
    print('\n'.join(out))
    return 0


if CMD == 'setup':
    cmd_setup()
    sys.exit(0)
if CMD == 'baseline':
    sys.exit(run_units(BASE_DONE, 'baseline'))
if CMD == 'run':
    if not os.path.exists(BASE_DONE) or len(json.load(open(BASE_DONE))) != len(units()):
        die('run `baseline` to ALL COMMANDS GREEN first')
    sys.exit(cmd_run(sys.argv[4:]))
if CMD == 'final':
    sys.exit(cmd_final())
if CMD == 'report':
    sys.exit(cmd_report())
if CMD == 'equivalent':
    m = load_manifest()
    restore_pending(m)
    assert_pristine(m)
    if EQUIVALENT['file'] not in m['files']:
        die('%s is not under mutation; stop and report' % EQUIVALENT['file'])
    verdict, detail = mutate_one(m, EQUIVALENT)
    assert_pristine(m)
    json.dump({'verdict': verdict, 'detail': detail, 'old': EQUIVALENT['old'], 'new': EQUIVALENT['new'],
               'tests': EQUIVALENT['tests']}, open(MUT + '.equivalent.json', 'w'), indent=1)
    print('EQUIVALENT %s: %s -> %s, %s %s' % (verdict.upper(), EQUIVALENT['old'], EQUIVALENT['new'],
                                            ' '.join(EQUIVALENT['tests']), detail[:200]))
    sys.exit(0 if verdict == 'green' else 1)
die('unknown command %r' % CMD)
````

Extract the rows from this plan, build the copy and prove every test command green in it, one Bash call per line, repeating `baseline` until it prints `ALL COMMANDS GREEN (baseline)`:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-rows.py" docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md "$SCRATCH/w4-rows.json"
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" setup
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" baseline
```

Expected: `186 rows in 12 blocks (T1 12, T2 12, T3 35, T4 16, T5 36, T6 32, T7 7, T8 12, T9 8, T10 16, T11 0, T12 0); 171 ids after 15 re-anchor(s): W4-T1-M1 (by T2), …` (Task 11 Step 5's rows, if any, add to T11's count and to the ids, and a row one of its fixes re-anchored is named after `re-anchor(s):`); then `MUT ready at HEAD <12 hex>: 27 files under mutation, 171 rows, 31 test commands`; then thirty-one `GREEN` lines across about two invocations and `ALL COMMANDS GREEN (baseline)`. If the SDD ledger holds rows a per-task review measured red that no rows block carries, write them as a JSON list in the rows' shape to `<SCRATCH>/w4-extra-rows.json`, pass that path as the extractor's third argument, and add `- Extra review rows <ids>: measured red by their task's review, carried in no rows block.` to `w4-notes.md`. A command that is not green unmutated stops the runner: run the same command in the worktree (`( cd <pkg> && env -u CCRC_SW_DENYLIST CI=1 ./node_modules/.bin/vitest run <tests> )`). Green there means the copy differs from the tree: stop and report. Red there too: re-run it alone once, and report it if it stays red. Never run a row against a red baseline. If the extractor stops (a heading count, a missing rows line, an empty block, a foreign id), the plan was edited after it was written: report it, never hand-write `w4-rows.json`.

Then measure, one Bash call per invocation, repeating `run` (exit 3 means rows are left) until it prints `ALL ROWS MEASURED`:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" run
```

Each row prints `== <id> [T<n>] <VERDICT> ok|NOT OK <seconds>s <first failed case>` and is appended to `w4-mut.results.jsonl`, so an interrupted invocation loses at most the row in flight. Expected: `ALL ROWS MEASURED: 171 ok, 0 not ok` after about three invocations, every row `RED`. Read each printed case against the row's recorded `red` (the report repeats both): the case must be one the `red` text names or describes. A row that is `NOT OK`:
- **SKIPPED**: its `old` is not in the file exactly once. Find the guard the row's `red` names in the shipped file. If it is there with another spelling (a fix round changed the code after the row was written, and its task did not re-anchor it), rewrite that row's `old`/`new` in `w4-rows.json` as the SAME mutation of the shipped text, re-measure it alone (`… run <ID>`), and add `- <ID>: re-anchored to the shipped text; same mutation.` to `w4-notes.md`. If the guard is gone, it is a finding.
- **GREEN** where red was expected: a guard nothing pins. Re-measure it alone once; if it stays green, it is a finding. Closing it is a test change in the owning task's file, and the coordinator orders that round; never weaken or drop the row.
- **RED-TIMEOUT**, **ERROR** or **TIMEOUT**: re-measure it alone once (`… run <ID>`, which appends a newer record the table reads); if it repeats, it is a finding, with the detail `w4-mut.results.jsonl` holds. It is unmeasured, never red.

Then measure refinement (b)'s equivalent mutant, prove the copy restored and green again (repeating `final` until it prints `ALL COMMANDS GREEN (final)`), prove the worktree untouched, and write the table:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" equivalent
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" final
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; git status --short; python3 "$SCRATCH/tools/mutate.py" "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut" report > "$SCRATCH/w4-mutation-table.md"; tail -n 1 "$SCRATCH/w4-mutation-table.md"
```

Expected: `EQUIVALENT GREEN: remarkPlugins={[remarkGfm, remarkAlerts]} -> remarkPlugins={[remarkAlerts, remarkGfm]}, test/markdown-golden.test.tsx` (anything else is a finding: refinement (b) rests on it); `MUT byte-equal to HEAD for all 27 files under mutation`, thirty-one `GREEN` lines, `ALL COMMANDS GREEN (final)`; no status line; `171 rows; 171 measured as expected.`.

**Reporting a finding** (any step). The coordinator rules on it; this worker never fixes it in this task. Send ONE `finding` mail per finding, then wait for the ruling (it arrives as mail; list it as Step 7 does). `<SUBJECT>` names the step and the id (`W4 Task 12: mutation row W4-T6-M12 stays green`, `W4 Task 12: suite S03 red alone`, `main-red: <file> red at the W4 base`, `W4 Task 12: invariant doctor-shape FAIL`, `W4 Task 12: gate check precache FAIL`), and `<BODY>` quotes the printed line and the file that holds the detail:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
python3 - "$id" "$uuid" "$(cat "$SCRATCH/w4-run")" '<SUBJECT>' '<BODY>' <<'PY' | "$API" mail send --json -
import json, sys
i, u, run, subject, body = sys.argv[1:6]
print(json.dumps({'fromId': i, 'fromUuid': u, 'toId': 'coordinator', 'runId': int(run), 'kind': 'finding',
                  'subject': subject, 'body': body, 'artifacts': []}))
PY
```

Expected: a JSON answer with `"ok":true`. A `stale-uuid` means the identity was cached; re-run the whole block. When the coordinator rules that a red is to be RECORDED as it stands (a `main-red`, or a red it accepts), Step 5 runs `w4-results.py` with `--record-reds` and the ruling is quoted in `w4-notes.md` as `- Coordinator ruling (mail <n>, <date>) on <finding>: <the ruling, verbatim>.`.

- [ ] **Step 5: The results record, its pins, and its commit.** Write the section writer to `<SCRATCH>/tools/w4-results.py`:

````python
#!/usr/bin/env python3
"""Write `## Wave 4 results` at the end of the plan (the plan's Task 12, Step 5). Scratch only: never committed.

  python3 w4-results.py SCRATCH BASE BLOCK [--record-reds] [--review RECORD]

Run from the worktree root, after Steps 1-4. It reads only what those steps wrote into SCRATCH (every w4-suite log
of suites 01-08 and S01 onward, each with any .rerun.log, and w4-split.txt; w4-invariants.txt; w4-gate.txt;
w4-mut.manifest.json, w4-mut.equivalent.json and w4-mutation-table.md; w4-notes.md when it exists), the plan's own
`## Deviations found`, Task 11's review record (RECORD, by default the SDD ledger's task-11-review.md: its last
`Findings:` line and every row it ruled CARRIED), and five measurements it takes itself from the tree (the grammar
count, the M4.P1 and M4.M2 control depths, the 500 KiB fixture, the five licences). It refuses (exit 2, plan
untouched) when the plan is untracked or has uncommitted edits, the mutation table was measured at another HEAD, a
suite's LAST run is not rc 0, a split file's pieces did not run every test exactly once, an invariant or a gate
check is not PASS, the plan-order swap was not measured green, or the mutation table's last line does not say every
row measured as expected, unless --record-reds is given, which is used ONLY when the coordinator has ruled that the
reds be recorded as they stand. A section already present is replaced (it is the plan's last `## ` section by
construction); nothing above it is touched. The `suite:` word the wave-done carries is the wave's FIRST complete run
of Step 1's suites (worker skill clause 15: red stays red whatever a fix round does): `green` when every suite's
first run was rc 0, else `red`. It is recorded in FIRST, in the SDD ledger, the first time this script reads a
complete run (before any refusal), and never rewritten: a fix round's re-run reports its own run beside it. The
section spells no number after `D-` (Step 2's no-d-number invariant): the spent numbers are named by their count
and the issued block, and quoted output writes any such token as `D-<n>`.
"""
import datetime, json, os, re, subprocess, sys

PLAN = 'docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md'
SDD = '.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation'
RECORD = SDD + '/task-11-review.md'
FIRST = SDD + '/task-12-first-run.txt'
HEAD = '## Wave 4 results'
FIVE = ['unified', 'remark-parse', 'remark-rehype', 'hast-util-to-jsx-runtime', 'html-url-attributes']
W5_HALVES = [
    ('M4.R1', 'a probe on `useLocation` re-renders for `navigate(\'/docs/p?ref=a\')` then `?ref=b`',
     'injected `loaders.tree` called with ref `b`'),
    ('M4.B1', 'a mocked throwing `RunsScreen` at `/runs` keeps `.shell-nav` with the fallback, and navigating '
     'resets it', 'the same at `/docs` with `DocsScreen`'),
    ('M4.P1', 'the refusal, its control, and chat\'s note', '`DocMarkdown`\'s note'),
    ('M4.P6', 'the runner honours a 30 000 `budgetMs`', 'Format anyway posts a 30 000 job'),
    ('M4.P7', '`spawn` throws gives a sticky `worker-unavailable`, and chat\'s 4 KiB sync and 5 KiB note',
     '`DocMarkdown`\'s in-thread 4 KiB and 5 KiB note'),
    ('M4.P12', '`parseMarkdown` gives `too-wide` for both fixtures and a tree for a real 500 KiB prose doc',
     'the `renderHast` spy has 0 calls, and the doc still renders'),
]
CARRIED = [
    '`GithubTarget` cannot express `resolveDocRef`\'s `repo` kind (the programme ledger). No W4 code consumes either; '
    'DEFERRED to W5 with `DocLink`, its consumer. Chat\'s image predicate does not call `resolveDocRef`.',
    'Spec section 4.14 lists `.msg-plain` among the W5 registrations; W4 renders and styles it (refinement (n)), so '
    'W5\'s M4.S1 registers only the docs chrome. CARRIED to W5\'s brief.',
    'W6\'s M5.16 ("no `postMessage(` and no `\'message\'` listener in `pwa/src/docs` or `lib/markdown*`") is red '
    'against `markdownWorker.ts` and `markdownRunner.ts` the day it lands, which the spec itself requires (refinement '
    '(w)). CARRIED to W6 and to the Share/Export spec amendment, which already edits M5.16; W4 edits no spec text.',
    'W7 prose residue: `pwa/src/lib/api.ts`\'s comment naming `MessageBubble`\'s `absolute()`; '
    '`server/test/sourceScan.ts`\'s header counts measured on `MessageBubble.tsx`; README\'s doctor table and its '
    'server-role SKIP sentence, which name neither `docs` nor `docs-sw`; README\'s two `CCRC_SW_DENYLIST` paragraphs '
    'and CLAUDE.md\'s knob mention; the spec\'s stale citations of refinement (s) (section 7.2\'s "after `models`" and '
    'its two ruling-comment line citations; section 4.10\'s `react-markdown/lib/index.js:123`). CARRIED to W7.',
    'The chat image predicate applies the spec\'s U3 clause as written (root-relative and protocol-relative sources '
    'are refused, read as the browser\'s URL parser reads them). Whether chat should draw an `<img>` only for an '
    'absolute http(s) URL (a path-relative `../api/x` resolves same-origin from `/s/<id>`) is an OPEN operator '
    'question unless Task 11 applied a ruling; a stricter ruling is a change to `isRefusedChatImageSrc` alone.',
    'A streaming chat message crossing 4 096 UTF-8 bytes, and a message Virtuoso remounts, shows `.msg-plain` for '
    'one frame (refinement (i): two components, no cache across remounts). Accepted and recorded.',
]
POST_MERGE = [
    'The merge becomes a prerelease (`release-main.yml`), the `dev` channel. Rollout is optional (spec section '
    '7.7\'s W4 row): phones update with no visible change beyond crash resilience.',
    'When the coordinator next moves the boxes (`ccrc rollout`, fleet box first), the server box\'s closing doctor '
    'runs `docs-sw` for the first time; on a release-lane box it PASSes on the default bundle, and a fleet box '
    'SKIPs it.',
    'On a box built by `deploy.sh` with `/docs` in `CCRC_SW_DENYLIST`, the build now refuses (spec section 7.3). The '
    'operator\'s one act is removing `/docs` from their own `~/.ccrc/deploy.env`; ccrc never edits it.',
    'W5\'s brief inherits the W5 halves above; the M5.16 carry goes to W6 and the Share/Export amendment; the prose '
    'residue goes to W7.',
]


def die(msg):
    print('w4-results.py: ' + msg, file=sys.stderr)
    sys.exit(2)


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout.strip()


def summary(path):
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()
    cmd = lines[0][2:] if lines and lines[0].startswith('$ ') else '?'
    rc = int(re.findall(r'^rc=(\d+)$', text, re.M)[-1])
    secs = re.findall(r'^seconds=(\d+)$', text, re.M)
    pick = lambda label: next((re.sub(r'\s+', ' ', l.strip())[len(label):].strip()
                               for l in reversed(lines) if l.strip().startswith(label + ' ')), '-')
    fails = [l.strip()[len('FAIL'):].strip() for l in lines if re.match(r'^\s*FAIL\s', l)]
    return cmd, pick('Test Files'), pick('Tests'), rc, fails, (secs[-1] if secs else '?')


def measured(tree_root='.'):
    """The five recorded measurements, re-taken from the tree (each printed by this command, never copied)."""
    out = []
    md = open(os.path.join(tree_root, 'pwa/src/lib/markdown.tsx'), encoding='utf-8').read()
    loop = re.search(r'for \(const \[name, def\] of Object\.entries\(\{(.*?)\}\)\) hljs\.registerLanguage', md, re.S)
    grammars = re.findall(r'[A-Za-z_]\w*', loop.group(1)) if loop else []
    aliases = re.findall(r'hljs\.registerAliases\(\[([^\]]*)\]', md)
    names = [a.strip().strip("'") for group in aliases for a in group.split(',') if a.strip()]
    out.append('Grammars registered in `pwa/src/lib/markdown.tsx`: %d (%s); aliases: %s.' % (
        len(grammars), ', '.join(grammars) or 'none found', ', '.join(names) or 'none found'))
    parse = open(os.path.join(tree_root, 'pwa/test/markdown-parse.test.ts'), encoding='utf-8').read()
    p1 = re.search(r"describe\('M4\.P1[^\n]*\n\s*const src = '>'\.repeat\((\d+)\)", parse)
    out.append('M4.P1 control depth (`markdown-parse.test.ts`, `parseWithoutPrescan` throws `RangeError`): %s.' % (
        p1.group(1) if p1 else 'NOT FOUND'))
    alerts = open(os.path.join(tree_root, 'pwa/test/remark-alerts.test.ts'), encoding='utf-8').read()
    m2 = re.search(r'^const DEEP = ([\d_]+);$', alerts, re.M)
    out.append('M4.M2 control depth (`remark-alerts.test.ts`, the recursive oracle throws `RangeError`): %s.' % (
        m2.group(1).replace('_', '') if m2 else 'NOT FOUND'))
    docs = os.path.join(tree_root, 'docs', 'superpowers')
    files = []
    for d, _dirs, fs in os.walk(docs):
        for f in fs:
            if f.endswith('.md'):
                p = os.path.join(d, f)
                files.append((-os.path.getsize(p), p))
    files.sort()
    if files:
        out.append('M4.P12\'s real 500 KiB prose doc (the largest `.md` under `docs/superpowers`, cut at its last '
                   'newline before 500 KiB): `%s`, %d bytes.' % (os.path.relpath(files[0][1], tree_root),
                                                                 -files[0][0]))
    lock = json.load(open(os.path.join(tree_root, 'pwa/package-lock.json'), encoding='utf-8'))
    lic = ['%s %s %s' % (k, lock['packages'].get('node_modules/' + k, {}).get('version', '?'),
                         lock['packages'].get('node_modules/' + k, {}).get('license', '?')) for k in FIVE]
    out.append('The five direct dependencies, version and licence as `pwa/package-lock.json` records them: %s.'
               % '; '.join(lic))
    return out


args = [a for a in sys.argv[1:]]
record = '--record-reds' in args
if record:
    args.remove('--record-reds')
if '--review' in args:
    i = args.index('--review')
    RECORD = args[i + 1]
    del args[i:i + 2]
if len(args) != 3 or not re.fullmatch(r'\d+-\d+', args[2]):
    die(__doc__)
S, BASE, BLOCK = args
if not os.path.isfile(PLAN):
    die('no %s: run me from the worktree root' % PLAN)
if subprocess.run(['git', 'ls-files', '--error-unmatch', PLAN], capture_output=True).returncode != 0:
    die('%s is not tracked: this is not the wave\'s plan' % PLAN)
if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', PLAN]).returncode != 0:
    die('%s has uncommitted edits; this script must be the only writer' % PLAN)

reds, rows, first_red = [], [], []
# Quoted output (a test title, a FAIL line, a note) may carry a `D-<n>` token, such as deviation-refs' own case
# titles; it is written as `D-<n>` so the section defines and cites no number.
quote = lambda s: re.sub(r'(?<![A-Za-z0-9_])D-\d+', 'D-<n>', s)
esc = lambda s: quote(s).replace('|', '\\|')
logs = sorted(f for f in os.listdir(S) if re.match(r'^w4-suite-(0[1-8]|S\d\d)-[a-z0-9-]+\.log$', f))
ids = [f.split('-')[2] for f in logs]
if not any(i.startswith('S') for i in ids) or [i for i in ids if not i.startswith('S')] != \
        ['%02d' % n for n in range(1, 9)]:
    die('the suite logs are %r: run `w4-suites.py --next` until it prints every suite' % ids)
for f in logs:
    sid = f.split('-')[2]
    cmd, files, tests, rc, fails, secs = summary(os.path.join(S, f))
    cell, final_rc = '%d' % rc, rc
    rerun = os.path.join(S, f[:-len('.log')] + '.rerun.log')
    if os.path.exists(rerun):
        _c, files, tests, final_rc, fails2, _s = summary(rerun)
        cell = '%d; re-run alone: %d' % (rc, final_rc)
        fails = fails2 if final_rc else fails
    if rc != 0:
        first_red.append(sid)
    if final_rc != 0:
        reds.append('suite %s' % sid)
    rows.append('| %s | `%s` | %s | %s | %s | %s |' % (sid, esc(cmd), esc(files), esc(tests), secs, cell))
    rows += ['|  | FAIL: %s |  |  |  |  |' % esc(x)[:200] for x in (fails if final_rc else [])]
split_path = os.path.join(S, 'w4-split.txt')
if not os.path.exists(split_path):
    die('no w4-split.txt: `w4-suites.py --next` has not run every suite')
split = open(split_path, encoding='utf-8').read().rstrip('\n').splitlines()
reds += ['split: ' + l for l in split if not l.startswith('OK ')]
suite_word = 'red' if first_red else 'green'
when = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
if not os.path.exists(FIRST):
    os.makedirs(os.path.dirname(FIRST), exist_ok=True)
    open(FIRST, 'w', encoding='utf-8').write('%s %s %s\n' % (suite_word, git('rev-parse', 'HEAD'), when))
first_word, first_tip = open(FIRST, encoding='utf-8').read().split()[:2]

inv = open(os.path.join(S, 'w4-invariants.txt'), encoding='utf-8').read().rstrip('\n')
reds += ['invariant: ' + l for l in inv.splitlines() if l.startswith('FAIL ')]
if not re.search(r'^\d+ invariants, \d+ PASS$', inv, re.M):
    die('w4-invariants.txt has no summary line: run Step 2 again')
inv_tip = re.search(r'^base \w+, ref \w+, tip (\w+),', inv, re.M)
if not inv_tip or not git('rev-parse', 'HEAD').startswith(inv_tip.group(1)):
    die('w4-invariants.txt was measured at another tip: run Step 2 again')
gate = open(os.path.join(S, 'w4-gate.txt'), encoding='utf-8').read().rstrip('\n')
reds += ['gate: ' + l for l in gate.splitlines() if l.startswith('FAIL ')]
if not re.search(r'^\d+ gate checks, \d+ PASS$', gate, re.M):
    die('w4-gate.txt has no summary line: run Step 3 again')
mut_head = json.load(open(os.path.join(S, 'w4-mut.manifest.json'), encoding='utf-8'))['head']
if mut_head != git('rev-parse', 'HEAD'):
    die('the mutation table was measured at %s and HEAD is %s: run Step 4 again' % (mut_head[:12],
                                                                                git('rev-parse', 'HEAD')[:12]))
table = open(os.path.join(S, 'w4-mutation-table.md'), encoding='utf-8').read().rstrip('\n')
m = re.match(r'^(\d+) rows; (\d+) measured as expected', table.splitlines()[-1])
if not m:
    die('w4-mutation-table.md does not end with the runner\'s count line: run Step 4\'s report again')
if m.group(1) != m.group(2):
    reds.append('mutation table: ' + table.splitlines()[-1])
eq_path = os.path.join(S, 'w4-mut.equivalent.json')
if not os.path.exists(eq_path):
    die('no w4-mut.equivalent.json: run Step 4\'s `equivalent` first')
eq = json.load(open(eq_path, encoding='utf-8'))
if eq['verdict'] != 'green':
    reds.append('equivalent mutant: %s (%s)' % (eq['verdict'], eq['detail'][:120]))
if not os.path.exists(RECORD):
    die('no Task 11 review record at %s: Task 11 closes before Task 12' % RECORD)
rec = open(RECORD, encoding='utf-8').read().splitlines()
findings = [l for l in rec if l.startswith('Findings: ')]
if not findings:
    die('the Task 11 record has no `Findings:` line: Task 11 Step 6 closes the record first')
carried_t11 = []
for l in rec:
    cells = [c.strip() for c in re.split(r'(?<!\\)\|', l)[1:-1]] if l.startswith('| ') else []
    if len(cells) == 8 and cells[5].startswith('CARRIED'):
        carried_t11.append('Task 11 review %s (%s): %s. %s' % (cells[0], cells[2], cells[3].rstrip('.'), cells[5]))
if reds and not record:
    die('not all green, so nothing is written; report these to the coordinator:\n  ' + '\n  '.join(reds))

plan = open(PLAN, encoding='utf-8').read()
spent = re.findall(r'^- \*\*D-(\d+) \(\d{4}-\d{2}-\d{2}\)\*\* ', plan, re.M)
notes_path = os.path.join(S, 'w4-notes.md')
notes = open(notes_path, encoding='utf-8').read().strip() if os.path.exists(notes_path) else ''
tip = git('rev-parse', '--short=12', 'HEAD')
base = git('rev-parse', '--short=12', BASE)
n = len(git('rev-list', '--first-parent', '--no-merges', '%s..HEAD' % BASE).split())
out = [HEAD, '',
       'Measured %s on the tree at `%s` (base `%s`, %d W4 commits on the first-parent line). Every number below '
       'was printed by a Task 12 command; none is a forecast. The commit that adds this section changes only this '
       'file, and it is the wave-done `handoffCommit`.' % (when, tip, base, n), '',
       'Deviation entries: %d, the first %d numbers of the issued block %s, in order, defined in `## Deviations '
       'found` above.' % (len(spent), len(spent), BLOCK), '',
       '### Suites', '',
       'The every-wave and W4 suites of spec section 7.9, the PWA `tsc`, and the four files one call cannot hold, '
       'run as `-t` pieces of their top-level describes, each proved below to run every test exactly once; all in '
       'the foreground. The full server suite runs in PR CI (`pwa/package.json` changed). First complete run of '
       'these suites in this wave: **%s** (at `%s`)%s.' % (
           first_word, first_tip[:12], ('; this run\'s first pass was red in %s' % ', '.join(first_red))
           if first_red else ''), '',
       '| # | Command | Test Files | Tests | s | rc |', '|---|---|---|---|---|---|'] + rows + [
       '', '```text'] + [quote(l) for l in split] + ['```', '',
       '### Invariants', '',
       'From `w4-invariants.py` (scope from W4\'s own commits; net shapes against the base, or the last merge of '
       'main):', '', '```text', quote(inv), '```', '',
       '### Build gate', '',
       'From `w4-gate.py` (spec section 7.7), on `git archive` copies of the base and the tip:', '',
       '```text', quote(gate), '```', '',
       '### Mutation table', '',
       'Every `W4-T<n>-M<k>` row of Tasks 1-11, extracted from this plan (a re-anchored id counts once, at its last '
       'occurrence) and run by `mutate.py` in a `git archive` copy of the tree at `%s`, one row at a time, each file '
       'restored byte for byte after its row.' % tip, '',
       quote(table), '',
       'Refinement (b)\'s equivalent mutant, measured in the same copy: `%s` to `%s` in `pwa/src/lib/markdown.tsx` '
       'leaves `%s` **%s**, which is why M4.M1\'s rows drop a plugin instead.' % (
           eq['old'], eq['new'], ' '.join(eq['tests']), eq['verdict']), '',
       '### Measured values', ''] + ['- ' + x for x in measured()] + [
       '', '### For W5\'s brief: the W5 halves of refinement (a)', '',
       '| Row | Proved in W4 by | W5 proves |', '|---|---|---|'] + [
       '| %s | %s | %s |' % h for h in W5_HALVES] + [
       '', '### Notes', '',
       '- Task 11: ' + quote(findings[-1])] + (quote(notes).splitlines() if notes else [
       '- No suite needed a re-run, and no row was re-anchored or reported.']) + [
       '', '### Carried, not fixed', ''] + ['- ' + quote(c) for c in CARRIED + carried_t11] + [
       '', '### After the merge, not this wave', ''] + ['%d. %s' % (i + 1, p) for i, p in enumerate(POST_MERGE)] + ['']
section = '\n'.join(out)
if re.search(r'(?<![A-Za-z0-9_])D-\d', section):
    die('the section would spell a D-<n> token; stop and report')
at = plan.find('\n' + HEAD + '\n')
if at >= 0:
    if re.search(r'^## ', plan[at + len(HEAD) + 2:], re.M):
        die('%s is not the plan\'s last ## section; stop and report' % HEAD)
    plan = plan[:at + 1]
elif not plan.endswith('\n'):
    plan += '\n'
open(PLAN, 'w', encoding='utf-8').write(plan + ('' if plan.endswith('\n\n') else '\n') + section)
print('wrote %s (%d lines) to %s%s' % (HEAD, section.count('\n'), PLAN,
                                       '; WITH REDS, on the coordinator\'s ruling' if reds else ''))
print('suite: %s (the wave\'s first complete run, at %s)' % (first_word, first_tip[:12]))
````

Then, one Bash call per line:

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-results.py" "$SCRATCH" "$(cat "$SCRATCH/w4-base")" "$(cat "$SCRATCH/w4-block")"
git status --short; git diff --stat
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; python3 "$SCRATCH/tools/w4-suites.py" "$SCRATCH" 09
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; E=.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-12-evidence; rm -rf "$E" && mkdir -p "$E" && cp "$SCRATCH"/w4-suite-* "$SCRATCH/w4-split.txt" "$SCRATCH/w4-invariants.txt" "$SCRATCH/w4-gate.txt" "$SCRATCH"/gate-*.json "$SCRATCH"/gate-*-build.log "$SCRATCH/w4-rows.json" "$SCRATCH/w4-mut.results.jsonl" "$SCRATCH/w4-mut.equivalent.json" "$SCRATCH/w4-mutation-table.md" "$E"/ && { [ ! -f "$SCRATCH/w4-notes.md" ] || cp "$SCRATCH/w4-notes.md" "$E"/; } && ls "$E" | wc -l && git status --short
```

Expected: `wrote ## Wave 4 results (<n> lines) to docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md` (317 lines while planning: the mutation table is 171 of them, the suites 29) and `suite: green (the wave's first complete run, at <12 hex>)`; then ` M docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md` alone and its `1 file changed` stat; then `09 plan-pins-after` (`topology-clean`, `deviation-refs`, `dtbd`, re-run because the plan changed): `Test Files  3 passed (3)`, `Tests  87 passed (87)`, `rc=0` (the section names no real host, project, user or account; it DEFINES no number and spells none: the spent numbers are a count and the block, and quoted output writes any such token as `D-<n>`; and it carries no concrete placeholder); then the evidence count (each suite's log, each piece's `.json`, every `.rerun.log`, the gate's files and the rest) and the same single status line. If `w4-results.py` refuses with its `not all green` list, every item on it is a finding still open: report it (Step 4's last paragraph) and stop. If it refuses with `the mutation table was measured at …`, `w4-invariants.txt was measured at another tip` or the gate's `measured-at` failed, HEAD moved after that step: run it again. Then read the section once, top to bottom, with `sed -n '/^## Wave 4 results$/,$p' docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md`: every number in it was printed by a command above, and nothing in it is a forecast.

Then commit, in its own Bash call, only after the `09 plan-pins-after` line read `rc=0` and the section was read:

```bash
git add docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md
git commit -m "docs: W4 results (docs W4)" \
  -m "Task 12's measured record: the every-wave and W4 suites of spec 7.9 with their counts, the PWA tsc and the whole PWA suite, and ccrc-doctor, ccrc-install, ccrc-update and session-hook as -t pieces of their top-level describes, each proved to run every test exactly once, with the wave's first complete-run verdict; sixteen census-free invariants judged net against the base (W4's own commits touch exactly the scope list; nothing under shared/, server/src/, agent/ or .github/; message-links and every golden file unchanged; the lock and the manifest differ by the five exact dependencies alone; docs-parity append-only; ccrc-doctor-checks one table line in place plus an end-of-file append; ccrc-doctor.test.ts untouched above healthy(); ccrc-install and ccrc-update tests insert-only; deploy.sh two lines in place; the three comment blocks and the navigateFallbackDenylist line kept; no new stylesheet; the deviation section holds exactly the issued numbers it spent, and no other text spells one); the build gate on base and tip copies (the worker chunk emitted and precached, one default denylist, the /docs refusal); and the 171-id mutation table run at the wave's end state in a git-archive copy, every row restored byte for byte, with refinement (b)'s equivalent mutant measured green. The W5 halves, the carried items and the post-merge acts are recorded, not run." \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log -1 --format='%H %s'; git status --short
```

Expected: the new sha and `docs: W4 results (docs W4)`; no status line. This commit is the `handoffCommit` and the branch tip: nothing is committed after it in this task.

- [ ] **Step 6: Push the workspace branch and open the wave's ONE pull request.** Write the body writer to `<SCRATCH>/tools/w4-pr-body.py`:

````python
#!/usr/bin/env python3
"""Write the W4 pull request's body (the plan's Task 12, Step 6). Scratch only: never committed.

  python3 w4-pr-body.py SCRATCH BLOCK OUT

Run from the worktree root AFTER the results commit. It reads the plan as committed at HEAD (its Task headings,
`## Deviations found` and `## Wave 4 results`), and builds every link from `git remote get-url origin`, so the body
names only GitHub URLs: the plan's blob on main (the plan merged before dispatch; this PR appends its last two
sections, readable in this pull request's Files changed view until it merges) and the spec's. No tailnet docs
link, no scratch path, no box name. The body ends with the attribution line.
"""
import re, subprocess, sys

if len(sys.argv) != 4 or not re.fullmatch(r'\d+-\d+', sys.argv[2]):
    sys.exit(__doc__)
SCRATCH, BLOCK, OUT = sys.argv[1:4]
PLAN = 'docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md'
SPEC = 'docs/superpowers/specs/2026-10-01-native-docs-reader-design.md'
ATTRIBUTION = chr(0x1F916) + ' Generated with [Claude Code](https://claude.com/claude-code)'
LETTERS = ['(a), the six rows proved by their W4 half, the W5 half carried to W5\'s brief',
           '(b), M4.M1\'s equivalent plugin-order mutant replaced by two drops',
           '(c), `docs-sw` counting `denylist:[` occurrences with bash builtins',
           '(d), `docs-sw` skipping on either fleet evidence']


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout


url = git('remote', 'get-url', 'origin').strip()
m = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+)/([\w.-]+?)(?:\.git)?/?',
                 url)
if not m:
    sys.exit('w4-pr-body.py: origin is not a GitHub remote (%s); stop and report' % url)
repo = 'https://github.com/%s/%s' % (m.group(1), m.group(2))
plan = git('show', 'HEAD:' + PLAN)
tasks = re.findall(r'^### Task (\d+): (.+)$', plan, re.M)
if [int(n) for n, _t in tasks] != list(range(1, 13)):
    sys.exit('w4-pr-body.py: the plan at HEAD has Task headings %r; stop and report' % [n for n, _t in tasks])
at = plan.find('\n## Wave 4 results\n')
if at < 0:
    sys.exit('w4-pr-body.py: the plan at HEAD has no `## Wave 4 results`: commit Step 5 first')
results = plan[at:]
spent = re.findall(r'^- \*\*D-(\d+) \(\d{4}-\d{2}-\d{2}\)\*\* ', plan, re.M)
if len(spent) < 4:
    sys.exit('w4-pr-body.py: `## Deviations found` defines %d numbers, not at least 4; stop and report' % len(spent))
first_run = re.search(r'First complete run of these suites in this wave: \*\*(\w+)\*\*', results).group(1)
inv = re.search(r'^\d+ invariants, \d+ PASS$', results, re.M).group(0)
gate = re.search(r'^\d+ gate checks, \d+ PASS$', results, re.M).group(0)
worker = re.search(r'^PASS worker-chunk .*$', results, re.M)
table = re.search(r'^\d+ rows; \d+ measured as expected.*$', results, re.M).group(0)
carried = re.search(r'^### Carried, not fixed\n\n(.*?)\n\n###', results, re.S | re.M).group(1)
halves = re.search(r'^### For W5\'s brief: the W5 halves of refinement \(a\)\n\n(.*?)\n\n###', results,
                   re.S | re.M).group(1)
devs = ['- D-%s: refinement %s.' % (n, LETTERS[i]) if i < len(LETTERS) else
        '- D-%s: see `## Deviations found`.' % n for i, n in enumerate(spent)]
body = ['Native Docs reader, wave 4 of 7: the PWA foundation. A golden test of chat\'s output, committed before '
        'anything moved; `lib/markdown.tsx` extracted from `MessageBubble.tsx` with chat byte-identical; an '
        'iterative `remarkAlerts`; the pure parse pipeline (pre-scan, `parseMarkdown` and its eight outcomes, the '
        'depth and element caps), a module worker and its runner, `renderHast` and `useParsedMarkdown`; '
        '`CodeBlock`\'s 64 Ki-char highlight cap; chat hardened per ruling U3; `RenderBoundary` at the root, the '
        'detail pane and each chat item; the router\'s search channel; a build that refuses a `CCRC_SW_DENYLIST` '
        'entry covering `/docs`; and `ccrc doctor`\'s `docs-sw`. No visible change beyond crash resilience.', '',
        '- Plan: %s/blob/main/%s (on `main` since dispatch; this PR appends its `## Deviations found` and `## Wave 4 '
        'results`, readable in this pull request\'s Files changed view until it merges)' % (repo, PLAN),
        '- Spec: %s/blob/main/%s (section 7.7, the W4 row)' % (repo, SPEC), '',
        '## Tasks', ''] + ['%s. %s' % (n, t) for n, t in tasks] + [
        '', '## Deviations', '',
        'Spent from the issued block %s, in order:' % BLOCK, ''] + devs + [
        '', '## Measured (see the plan\'s Wave 4 results)', '',
        '- Step 1\'s suites, first complete run: %s. The full server suite runs in this PR\'s CI (a package '
        'manifest changed).' % first_run,
        '- Invariants: %s.' % inv,
        '- Build gate: %s%s.' % (gate, ('; ' + worker.group(0)[len('PASS worker-chunk'):].strip()) if worker else ''),
        '- Mutation table: %s' % table, '',
        '## For W5\'s brief', '', halves, '',
        '## Carried, not fixed', '', carried, '',
        '## After the merge, not this PR', '',
        'The merge becomes a prerelease. Rollout is optional; when the boxes next move (fleet first), the server '
        'box\'s closing doctor runs `docs-sw` for the first time. A box built by `deploy.sh` with `/docs` in '
        '`CCRC_SW_DENYLIST` now refuses to build until the operator removes it from their own '
        '`~/.ccrc/deploy.env`.', '',
        ATTRIBUTION]
open(OUT, 'w', encoding='utf-8').write('\n'.join(body) + '\n')
print('wrote %s: %d lines, %d tasks, %d deviation(s), links under %s' % (OUT, len(body), len(tasks), len(spent),
                                                                       repo))
````

Push, in its own Bash call (the branch is this workspace's own `ws/<slug>`, never a feature branch; a pre-push hook refusal is a finding, never `--no-verify`):

```bash
git push -u origin HEAD 2>&1 | tail -n 3; git ls-remote origin "refs/heads/$(git branch --show-current)"; git rev-parse HEAD
```

Expected: the push summary, then the remote line naming the same 40-hex sha as `git rev-parse HEAD`.

Then the pull request, one Bash call. On a fix round's re-run the PR already exists and the push above updated it: the block reuses an OPEN one and refuses a merged or closed one.

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; br=$(git branch --show-current)
python3 "$SCRATCH/tools/w4-pr-body.py" "$SCRATCH" "$(cat "$SCRATCH/w4-block")" "$SCRATCH/w4-pr-body.md" || exit 1
prs=$(gh pr list --head "$br" --state all --json number,state); echo "prs=$prs"
if [ "$prs" = '[]' ]; then
  gh pr create --base main --head "$br" --title 'docs W4: PWA foundation' --body-file "$SCRATCH/w4-pr-body.md"
elif ! printf '%s' "$prs" | grep -q '"state":"OPEN"'; then
  echo 'a merged or closed PR holds this branch: stop and report'; exit 1
fi
gh pr view "$br" --json number -q .number | tee "$SCRATCH/w4-pr"
```

Expected: `wrote <SCRATCH>/w4-pr-body.md: <n> lines, 12 tasks, <k> deviation(s), links under https://github.com/<owner>/<repo>` (49 lines with four deviations while planning); `prs=[]` on the first run; the new PR's URL; then its number. The body lists each spent number with its refinement letter, the gate and invariant summaries, the row count and the W5 halves, and links only `blob/main` GitHub URLs (no tailnet link: a PR is read by people off the tailnet). Never `gh pr merge`, `gh pr edit` or any update-branch: the merge is the coordinator's, after the review rules clean. CI starts on its own, the full server suite among it; this task does not wait for it (a worker that sleeps on CI never wakes): the review reads while CI runs.

- [ ] **Step 7: The fingerprint, read fresh, and the mail list.** Write the wave-done builder to `<SCRATCH>/tools/w4-wave-done.py`:

````python
#!/usr/bin/env python3
"""Measure the W4 fingerprint ONCE and print the wave-done mail (the plan's Task 12, Steps 7 and 8).

  python3 w4-wave-done.py SCRATCH RUN PR BLOCK FROM_ID FROM_UUID [--dry-run]

Run from the worktree root after the push and the pull request. It measures, fresh and in this order: the tip
(`git rev-parse HEAD`), that the tip's subject is the results commit's, a clean status, the remote branch
(`git ls-remote origin refs/heads/<branch>` must name the tip), and the pull request (`gh pr view PR --json
number,state,headRefOid,baseRefName`: OPEN, its head the tip, its base main). Any mismatch exits 1 and prints
nothing on stdout, so nothing is sent. Otherwise it prints ONE JSON object for `ccrc-api mail send --json -`: a
status mail to the coordinator, subject exactly `wave-done`, whose body opens with the `suite:` line (and a
`failure:` line only when the first complete run was red), then the fingerprint {branchTip, prNumber,
prPhase:'open', handoffCommit}, then the spent deviation numbers, the summary lines and the evidence paths.
--dry-run skips the remote and pull-request reads (planning only; never for a mail that is sent).
"""
import json, os, re, subprocess, sys

PLAN = 'docs/superpowers/plans/2026-10-09-native-docs-reader-w4-pwa-foundation.md'
EVIDENCE = '.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-12-evidence'
SUBJECT = 'docs: W4 results (docs W4)'
args = sys.argv[1:]
dry = '--dry-run' in args
if dry:
    args.remove('--dry-run')
if len(args) != 6 or not args[1].isdigit() or not args[2].isdigit() or not re.fullmatch(r'\d+-\d+', args[3]):
    sys.exit(__doc__)
SCRATCH, RUN, PR, BLOCK, FROM_ID, FROM_UUID = args


def git(*a):
    return subprocess.run(['git'] + list(a), capture_output=True, text=True, check=True).stdout.strip()


def refuse(why):
    print('w4-wave-done.py: %s; nothing sent' % why, file=sys.stderr)
    sys.exit(1)


tip = git('rev-parse', 'HEAD')
if git('log', '-1', '--format=%s') != SUBJECT:
    refuse('the tip is not the results commit')
if git('status', '--porcelain'):
    refuse('the worktree is not clean')
branch = git('branch', '--show-current')
if not dry:
    remote = git('ls-remote', 'origin', 'refs/heads/' + branch).split()
    if not remote or remote[0] != tip:
        refuse('origin/%s is %s, not the tip %s: push first' % (branch, remote[0] if remote else 'absent', tip))
    pr = json.loads(subprocess.run(['gh', 'pr', 'view', PR, '--json', 'number,state,headRefOid,baseRefName'],
                                   capture_output=True, text=True, check=True).stdout)
    if pr.get('number') != int(PR) or pr.get('state') != 'OPEN' or pr.get('headRefOid') != tip \
            or pr.get('baseRefName') != 'main':
        refuse('pull request %s reads %r' % (PR, pr))
plan = git('show', 'HEAD:' + PLAN)
results = plan[plan.find('\n## Wave 4 results\n'):]
first = re.search(r'First complete run of these suites in this wave: \*\*(green|red)\*\*', results)
if first is None:
    refuse('the results section names no first complete run')
spent = re.findall(r'^- \*\*D-(\d+) \(\d{4}-\d{2}-\d{2}\)\*\* ', plan, re.M)
table = re.search(r'^\d+ rows; \d+ measured as expected.*$', results, re.M).group(0)
inv = re.search(r'^\d+ invariants, \d+ PASS$', results, re.M).group(0)
gate = re.search(r'^\d+ gate checks, \d+ PASS$', results, re.M).group(0)
ev = os.path.abspath(EVIDENCE)
fp = json.dumps({'branchTip': tip, 'prNumber': int(PR), 'prPhase': 'open', 'handoffCommit': tip},
                separators=(',', ':'))
signal = ['suite: %s' % first.group(1)] + (['failure: unclear'] if first.group(1) == 'red' else [])
body = '\n'.join(signal + [
    fp,
    'W4 (PWA foundation), Tasks 1-12 done on this workspace branch; PR #%s open against main, CI running (the full '
    'server suite included: a package manifest changed).' % PR,
    'Results: %s, section Wave 4 results.' % PLAN,
    'Deviations spent from %s: %s.' % (BLOCK, ', '.join('D-' + n for n in spent) or 'none'),
    'Mutation table: ' + table,
    'Invariants: ' + inv,
    'Build gate: ' + gate,
    'For W5\'s brief: the W5 halves of refinement (a), and the carried items (M5.16 to W6, prose to W7): the '
    'results section.',
    'Evidence (logs, rows, gate, results): ' + ev,
])
print(json.dumps({'fromId': FROM_ID, 'fromUuid': FROM_UUID, 'toId': 'coordinator', 'runId': int(RUN),
                  'kind': 'status', 'subject': 'wave-done', 'body': body,
                  'artifacts': [os.path.join(ev, 'w4-mutation-table.md'), os.path.join(ev, 'w4-invariants.txt'),
                                os.path.join(ev, 'w4-gate.txt')]}))
````

First list mail, so nothing the coordinator sent while the suites ran sits unread under a wave-done (a hold once sat three hours that way). One Bash call:

```bash
API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"}; id=${id%%\"*}
[[ -n "$id" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
"$API" mail list --to "$id"
```

For every row not yet acked, read and ack it BEFORE acting on it, one Bash call per row, with `D` set to the row's `deliveryId` (never the row's own `id`, which is a different sequence):

```bash
API="$HOME/.local/bin/ccrc-api"; D=<the row's deliveryId>
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
"$API" mail fetch "$D"
printf '{"fromId":"%s","fromUuid":"%s"}' "$id" "$uuid" | "$API" mail ack "$D" --json -
```

A mail that changes the wave (a hold, a ruling, a fix-round order) is obeyed first, and this task resumes at the step it names.

- [ ] **Step 8: Send the wave-done, ONCE, and copy the last evidence.** The fingerprint is measured and sent in ONE Bash call, after the push and the pull request: `w4-wave-done.py` reads the tip, the remote branch and the PR fresh and prints nothing unless all four fields agree (`branchTip` = `handoffCommit` = the results commit = `origin/<branch>` = the PR's `headRefOid`; the PR `OPEN` against `main`; `prPhase` `open`):

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
python3 "$SCRATCH/tools/w4-wave-done.py" "$SCRATCH" "$(cat "$SCRATCH/w4-run")" "$(cat "$SCRATCH/w4-pr")" "$(cat "$SCRATCH/w4-block")" "$id" "$uuid" > "$SCRATCH/w4-wave-done.json" || exit 1
python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['body'])" "$SCRATCH/w4-wave-done.json" | head -n 3
"$API" mail send --json - < "$SCRATCH/w4-wave-done.json"
```

Expected: the body's first lines, `suite: green` (or `suite: red` and `failure: unclear` when the wave's first complete run was red, a load flake's included) and `{"branchTip":"<40 hex>","prNumber":<n>,"prPhase":"open","handoffCommit":"<the same 40 hex>"}`; then a JSON answer with `"ok":true`. A refusal from the builder (`the tip is not the results commit`, `push first`, `pull request … reads …`) sends nothing: fix the cause and run this step again. A `stale-uuid` means the identity was cached; re-run the whole block.

Then, one Bash call, copy what the mail named into the evidence directory (gitignored, so the status stays clean):

```bash
SCRATCH="$HOME/.cc-tmp/docs-w4-t12"; E=.superpowers/sdd/2026-10-09-native-docs-reader-w4-pwa-foundation/task-12-evidence; cp "$SCRATCH/w4-pr-body.md" "$SCRATCH/w4-wave-done.json" "$SCRATCH/w4-pr" "$E"/ && git status --short && git rev-parse HEAD
```

Expected: no status line, and the tip the fingerprint named. Then stop: no commit and no push after `wave-done` (worker skill clause 9). The review run reads this tip; a fix round, if the coordinator orders one, arrives as mail and re-runs this task from Step 0 after its own commits (the wave's first complete-run verdict stays recorded, and the new run is reported beside it).

No commit in this task but Step 5's: everything else it writes is scratch or gitignored evidence.

**Mutation rows this task contributes** (none: Task 12 adds no guard; it runs Tasks 1-11's 171 rows at the wave's end state and records what they measured):

```json
[]
```

## Design

**Posture:** none

**Why:** this wave's own Goal says it: "no visible change beyond crash resilience". It
is the parse pipeline, the module worker and its runner, `renderHast`, the extraction of
`lib/markdown.tsx` out of `MessageBubble.tsx` with chat BYTE-IDENTICAL (a golden test of
today's output is committed before anything moves), the three `RenderBoundary` mounts and
a router gaining `useLocation`. A design canvas would depict a screen this wave is
measured not to have changed.

The Docs screen itself is W5. That is where the question has an answer worth drawing,
and W5's plan is where it gets asked.

**Answered on the merge, not when this plan was written.** `server/test/design-declaration.test.ts`
landed on the design-system branch after this plan was filed, and its scope boundary is a
filename date (`2026-09-29`) rather than a list — so merging the two trees asked this plan
a question that did not exist at the time. Appended at the end of the file on purpose: it
shifts no line above it, so every citation anchor into this document is untouched.
