# Native Docs reader, first-load compression — Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 1 (2026-11-03), reviewed by three lenses with a refuter per finding; approved by the operator on 2026-11-03 with every recommendation (see "Where things stand"). Base `ecba5ee6f85b18a4a7d40e9f8f33e1c00b67b9a4` (`origin/main`, 2026-11-03). Every Find block below is quoted from that commit. It replaces nothing.

**Scope:**
- In: a build step that writes a Brotli copy (`<file>.br`) and a gzip copy (`<file>.gz`) beside each script, stylesheet and SVG under the built `assets/` directory, with `node:zlib` only; its wiring into the PWA's Vite build; `preCompressed: true` in `server/src/pwaStatic.ts#pwaStaticOptions`, so the server sends the copy the browser accepts; the tests and mutation rows for all three; one README sentence.
- Out: any Caddy or `ccrc expose` change (it would need a root step on every exposed box); compression at request time; a new npm dependency; the shell files (`index.html`, `sw.js`, the workbox runtime, the web manifest, `push-sw.js`); every `/api/*` and `/ws/*` answer, `/api/docs/*` included; zstd; the phone re-measurement, which is the operator's after rollout.

**Goal:** The first open of the console, and of a Docs page in particular, transfers the PWA's scripts and stylesheets compressed. Measured on the live console on 2026-11-03 (the operator's phone check after W8a): every `/assets/*` file was sent with no `Content-Encoding` although the browser sent `Accept-Encoding: br, gzip`; the main bundle is about 1962 KB, the reader chunks about 760 KB (enhance 191, reader 536, bootstrap 27, guard 4), the reader bridge 42 KB and the Mermaid chunk `mermaid.frame-*.js` 3682 KB. After this wave the same files go out as Brotli to every current browser, with the cache policy, the hashed names and the service worker's precache unchanged.

**Architecture:** `pwa/build/compressAssets.ts` (new, outside `pwa/src`, never bundled) holds one synchronous function, `compressAssets(dir)`, that walks a directory and writes the two copies beside each compressible file, skipping a copy that is not smaller. `pwa/vite.config.ts` gains one build-only plugin, `precompressAssets`, whose `writeBundle` hook calls it on the build's own `assets/` directory, so every lane that runs `vite build` (the release's `npm run build`, `install.sh`, `deploy.sh`, CI's `build-pwa` job, the browser leg and the three hermetic built-output tests) emits the same tree. `pwaStaticOptions` turns on `@fastify/static`'s `preCompressed`, which picks `<file>.br`, else `<file>.gz`, else the file, by the request's `Accept-Encoding`, sets `Content-Encoding` and the file's own `Content-Type`, and adds `Vary: Accept-Encoding`. The release tarball already carries `server/dist-pwa` whole, so the copies ship with no change outside these files.

**Tech Stack:** TypeScript (pwa's own `tsc`, server's own `tsc`), Vite 8 (rolldown; one `Plugin` with `apply: 'build'` and a `writeBundle` hook), vite-plugin-pwa 2 (workbox `generateSW`), `@fastify/static` 10.1.8 (`preCompressed`), `node:zlib` (`brotliCompressSync`, `gzipSync`), vitest 5 (pwa on jsdom, server on node); Node `>=22.16.0` (pwa's and server's `engines`).

**Ruling:** the coordinator's ruling of 2026-11-03 on the operator's phone check: compress at BUILD time and have the server send the precompressed files; no Caddy change, no runtime compression, no new npm dependency. No spec covers how the PWA's static files are served, so every refinement below fills a silence; none departs from a spec sentence.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md` (the W8a row; the coordinator's ledger PR records this follow-up and its ruling).

**Format:** Markdown. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans, and Task 4's tools parse this file's `### Task` headings and the JSON row fences each task records.

**What the base says (each checked at BASE, each handled below):**
- **The PWA builds into `server/dist-pwa`, not `pwa/dist`.** `pwa/vite.config.ts`'s `build` is `{ outDir: '../server/dist-pwa', emptyOutDir: true }`, so the copies land in `server/dist-pwa/assets/`, and a fresh build never finds an old copy beside a new file.
- **Not every lane runs `npm run build`.** The release (`deploy/build-release.sh`), `install.sh` and `deploy/deploy.sh` run `npm run build` (`tsc --noEmit && vite build`); CI's `build-pwa` job runs `./node_modules/.bin/vite build` alone; the browser leg (`pwa/browser/dist.ts#buildDist`) and three hermetic tests (`fonts-built`, `markdown-worker-built`, `reader-built`) call Vite's `build()` with `configFile: 'vite.config.ts'`. Refinement (a).
- **The service worker is generated in vite-plugin-pwa's `closeBundle`** (its build plugin: `enforce: 'post'`, `closeBundle: { sequential: true, … }`, read in an installed 1.3.0 copy while planning; the lock pins 2.0.0, which Task 2's mutation row FLC-T2-M2 measures). Its precache is `globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}']` with `globIgnores: ['**/mermaid.frame-*.js']`. Refinement (g).
- **`@fastify/static` is `^10.1.8` (locked 10.1.8).** Its `preCompressed` was read in an installed 10.1.0 copy while planning (`index.js#pumpSendToReply`, README "preCompressed"): it tries `br`, then `gzip`, then `deflate`, as `@fastify/accept-negotiator` 2.0.1 ranks the request's `Accept-Encoding` (q-values honoured, `*` read as gzip, `br` first among equals); a missing copy falls back to the next and finally to the file; on a file answer it calls `setHeaders(reply, metadata.path, …)` with the path actually sent, adds `Vary: accept-encoding` (to the uncompressed fallback too), and, when it sent a copy, sets `content-type` from the original name and `content-encoding`. `FastifyStaticOptions` declares `preCompressed?: boolean`. Task 3 Step 0 checks the installed 10.1.8. Refinement (e).
- **Every built-output filter in the pwa suite is anchored** (`/^mermaid\.frame-.+\.js$/`, `/^markdownWorker-[\w-]+\.js$/`, `/^readerRenderJob-.+\.js$/`, `endsWith('.js')`, `endsWith('.css')`, the Geist `\.woff2$` patterns), so no existing test collects a `.br` or `.gz`. The browser leg serves its build from its own `node:http` server (`pwa/browser/app.ts#serveDist`), which never sends a copy.
- **The release ships `server/dist-pwa` whole.** `build-release.sh` runs `npm run build` in `pwa/`, `cp -a`s `server/dist-pwa` into the staged tree, hashes every file into `MANIFEST` (which `ccrc update` checks with `sha256sum -c`), and makes the tarball reproducible with GNU tar's `--sort/--mtime/--owner/--group`; no size check exists. `build-release.test.ts` drives a stub `npm`, so it never sees real dist files. `deploy/release-main.sh`'s tree fingerprint hashes every file. Refinement (h).
- **What already pins `pwaStaticOptions`:** `server/test/pwa-static-cache.test.ts` (the headers, and the regex over `server.ts` that finds exactly one `app.register(fastifyStatic, pwaStaticOptions(pwaRoot))`); `server/test/rings/fastify-l4.test.ts` with `fastify-l4.data.ts` (`pwaStatic.ts` may import `@fastify/static`'s option type); `server/test/auth-gate.test.ts` (the static wildcard `GET /*` is one route and one EXEMPT entry; `preCompressed` registers no route); `server/test/ccrc-versioned-audit.test.ts` row 6 (`server.ts#findPwaRoot`'s body, untouched).
- **The README's `ccrc expose` bullet** says the generated Caddyfile holds `reverse_proxy 127.0.0.1:<CCRC_PORT>`, "nothing else". No server or pwa test quotes that bullet (checked: `ccrc-expose.test.ts` reads no README; `ccrc-settings-census.test.ts` reads README for `CCRC_*` keys only; `docs-parity`, `anchors` and `citations` cite by symbol or anchor, and `citations` does not read `.md`). `ccd/ccrc`'s `cmd_expose` header says the same "nothing else", and stays true.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). No test reaches a network or a real server; every server case runs on `app.inject`.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite a task runs drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only (`server/test/ccdWsHelpers.ts`); quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules` beyond the run's own workspace. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); this wave changes no lock and no `package.json`. The only transient directories are the tests' `mkdtemp` trees and Task 2's one measured production build (`vite build` into a `mkdtemp` directory, removed at once). Nothing builds into `server/dist-pwa` in the workspace (`auth-gate.test.ts` changes what it asserts when that bundle exists). Mutation rows are measured **in the workspace itself**, sequentially, never in parallel: save the target file to `$HOME/.cc-tmp/flc-mut/<id>.orig` with its sha256, apply the row's `old` → `new` (the `Edit` tool, exact unique match), run the row's `tests`, record the red line, restore from the saved copy (never `git checkout`), check the sha256 equals the saved one, and check `git status --porcelain` is unchanged from before the row. Each run is bounded: `timeout -k 10 600` and `ulimit -u 4096`. `$HOME/.cc-tmp/flc-mut/` is removed at Task 4.
- **Scope.** This wave creates `pwa/build/compressAssets.ts` and `pwa/test/compress-assets.test.ts`. It edits `pwa/vite.config.ts` (two import lines, one function, one plugin entry), `pwa/test/reader-built.test.ts` (two import lines, one header line, one appended describe), `server/src/pwaStatic.ts` (its doc comment and one option), `server/test/pwa-static-cache.test.ts` (its header, two import lines, the fixture, one appended describe), `README.md` (one sentence in the `~/.ccrc/Caddyfile` bullet), and this plan (Task 4 defines `## Deviations found` and appends `## Results`). Byte-identical: `shared/**`, every other file under `server/src/**` (`server.ts` included), `agent/**`, `ccd/**`, `deploy/**`, `install.sh`, `.github/**`, `ui/**`, `pwa/src/**`, `pwa/browser/**`, `pwa/index.html`, `pwa/package.json`, `pwa/package-lock.json`, `pwa/tsconfig.json`, `pwa/vitest.browser.config.ts`, `server/package.json`, `server/package-lock.json`, every other test file. Any other file is a stop-and-ask. One allowed exception, claimed first: if the CI selection or Task 4's whole server run reds a census in another programme's file that this wave's new words or files trip, the worker stops and asks the coordinator, who rules on that file.
- **Base.** The child workspace is minted from `main` at or after `ecba5ee6f85b18a4a7d40e9f8f33e1c00b67b9a4`. Task 1 Step 0 runs a **content** check, not an ancestry check (`T1-BASE-OK`), and records BASE in the gitignored SDD ledger `.superpowers/sdd/2026-11-03-native-docs-reader-first-load-compression/progress.md`.
- **Rings and seams.** `pwa/build/compressAssets.ts` lives outside `pwa/src`: the PWA bundle never reaches it, so the ring censuses that walk from `pwa/src` (`pwa-rings`, `mjs-node`) and the literal census (`pwa/src`, `ui/src`, `shared`) do not apply. It is in a typecheck program because `vite.config.ts` (in `pwa/tsconfig.json`'s `include`) and its test import it, and `typecheck-tests.test.ts`' coverage gate reads each project's program files (refinement (i)). `server/src/pwaStatic.ts` stays the L4 file `fastify-l4.data.ts` names, with the same imports. No overloaded `null`: `CopyOutcome` is a discriminated union (`written` | `not-smaller`).
- **Exact values.** Declared once, in `pwa/build/compressAssets.ts` (Task 1): `COMPRESSIBLE_EXTENSIONS = ['.js', '.css', '.svg']`, `BROTLI_QUALITY = 11` (9 after refinement (c)'s switch, the one line it edits); Brotli in `BROTLI_MODE_TEXT` with `BROTLI_PARAM_SIZE_HINT` set to the file's length and the default window; gzip at `constants.Z_BEST_COMPRESSION` (9). `PWA_ASSET_CACHE` and `PWA_SHELL_CACHE` are unchanged.
- **Never spelled by this wave:** the shared Markdown library's package name or directory name, anywhere (write "the shared Markdown library"); a `docs/` path literal in `pwa/vite.config.ts` or in any file it imports (`ci-reach-census.test.ts` reads `vite.config.ts`' path literals, so cite this plan by its title, not its path); a six-digit hex colour in any new or edited pwa file (`contrast.test.ts` sweeps the package for copies of token colours); real host, user, project, account or path names (fixtures use `project-a`, `demo`, `/s/project-a`, `http://www.w3.org/2000/svg`); a numeric line citation (`file.ts` + colon + line) in any code or test file (`citations.test.ts`; cite `file#symbol`); a `D-` number outside `## Deviations found`; a placeholder deviation token in any commit (`server/test/dtbd.test.ts`).
- **PUBLIC REPO.** This repository is public: code, docs, commit messages, branch names, the PR body and every comment. Never write host names, home or mount paths, account or lane names, other projects' names, real names, e-mail addresses, private ticket ids or Linear links. Refer to other ccrc work by its GitHub `#n`. Task 4 scans every changed file before the push, and every mail is gated on the same scan (rc 0, zero hits).
- **Locate every edit by content.** Each Find block below is quoted from BASE and must match exactly once; if it is absent or matches twice, stop and ask the coordinator. Cite code by `file#symbol`, never by line number.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured before/after. Each task ends with its rows **as a table** and **one JSON fence** (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`), which the worker records in the SDD ledger at the task's last step as measured; Task 4 copies every fence into `## Results`, runs the whole table at the end state and keeps the LAST occurrence of each id. Ids are `FLC-T<n>-M<k>`; `spec` carries the refinement letter the row guards. A row's `old` and `new` quote the file's own text from its first non-blank character; an empty `new` deletes the line. **Every count in this plan (a row's red, a file's case count, a size, a time) is a prediction.** A row whose measured red differs from its stated red is reported to the coordinator with the extra test names; the coordinator restates it, which takes no number. A row that stays green is a stop-and-ask.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )` and `( cd server && ./node_modules/.bin/vitest run test/<file> )`; never bare `npx vitest`. Every run in the FOREGROUND with Bash timeout 600000 ms; heavy runs (full package suites, typecheck, the three built-output files, mutation runs that build) through `ccrc test` (since #1785). Split large suites into calls that each fit. Re-run a timeout or `Failed to start forks worker` ALONE before calling it broken. Known load flakes: `typecheck-tests`, `session-hook`, `ccd-*`, `contrast.test.ts`' spawned-gate cases. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` and `( cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && echo SERVER-TSC-OK )`.
- **Deviations.** The plan's body and tasks spell no `D-` number; a departure is named by its refinement letter, and none of (a) to (j) departs. Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; Task 4 defines any it uses in `## Deviations found`. An issued number that goes unused is written without its prefix ("Issued and unused: 7xxx to 7yyy"). A session that cannot reach the allocator says so in its report (worker clause 11) and writes no placeholder token in any commit.
- **Commits.** One per task (review fixes one per finding), files staged by name, message `<area>: <what> (docs first-load compression)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Commits go on the workspace branch, never a feature branch. Only Task 4 pushes, and it opens the ONE pull request.

## How this wave runs (coordinator)

- **The plan reaches `main` before the run opens**, through the programme's ledger PR, which records it in the ledger's Plans line with the coordinator's quality ruling of 2026-11-03 (refinement (c)) and the operator's answer to Q1 below.
- **The run row and the issued block.** The coordinator opens one run row (`planned`) and is issued a small contiguous block by `POST /api/ledger/deviations` at run-open (three numbers: no refinement departs, so the block is for departures found while executing and in a fix round). The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main` at or after the base.
- **Claims** are checked at dispatch and again in Step 0 of each task that edits a shared file: `pwa/vite.config.ts`, `pwa/test/reader-built.test.ts`, `server/src/pwaStatic.ts`, `server/test/pwa-static-cache.test.ts`, `README.md`. The Export run (1368) edits one of them: its plan listed `pwa/vite.config.ts` as byte-identical, but its departure numbered 7887 added a `server.fs.allow` entry inside `server:` there, a hunk apart from this wave's two import lines, function and plugin entry, so the two merge cleanly in either order (measured by the coordinator, 2026-11-03). Where a live claim of another run covers a file this wave edits, the brief names the coordinator's scoped agreement for it. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (mail, `WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-4, the base, the issued block, the claim state, `CCRC_CHROME` (Task 4 runs one browser file locally), and the branch-discipline sentence (commit on the workspace branch, never a feature branch). Routing: Opus main loop; `sonnet` implementers at `medium` effort; a `sonnet` per-task reviewer on Tasks 1 and 2 and an `opus` one on Task 3 (what the server sends); Task 4's held-out whole-branch pass on two `opus` lenses and one `sonnet` lens, with a `sonnet` refute pass per finding; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, `pkill`/`killall` and any pattern kill, any `gh` write verb, any token in an argv, and approval-prompting shell forms.
- **Worker flow:** the worker acks, runs Tasks 1-3 with native subagents, puts questions to the operator as structured asks, and lists mail before every push and before its wave-done. Escalation: the build bounds of the coordinator's ruling (refinement (c)), measured in Task 2 Step 6 and Task 4 Step 2: a bound broken at quality 11 is the switch to 9, not a question; a bound broken at 9 is a stop-and-ask to the coordinator; a measured red outside its row's prediction, reported; a row that stays green, a stop-and-ask. Task 4 closes: the review and its fixes, the suites, the whole mutation table, `## Results` (that commit is the `handoffCommit` and the tip), push, the ONE pull request, the fingerprint with that PR's number and `prPhase: 'open'`, and the wave-done.
- **Review:** on a verified wave-done the coordinator dispatches one `ccrc-reviewer` run, reading the branch at one measured tip in its own worktree, naming three lenses: (1) what the server sends (the encoding chosen per `Accept-Encoding`, `Content-Type`, `Content-Encoding`, `Vary`, the cache policy of a copy, the shell and the SPA fallback sent as they are, the API untouched, the compression side channel argued in refinement (f)); (2) what the build writes (names and bytes unchanged, the skip rule, `assets/` only, the precache, the hook's timing against the service worker's generation, determinism and the release path of refinement (h)); (3) the tests and the mutation table, typecheck coverage of the new file, the censuses (`ci-reach-census`, `docs-parity`, `contrast`, `citations`, `topology-clean`), Task 2's measurements, and the public-repo scan.
- **Merge gate:** the operator's approval of this plan; every row red as measured; Task 2 Step 6's and Task 4 Step 2's measurements recorded in `## Results`, within the coordinator's bounds of 2026-11-03 at the quality used (11, or 9 after the switch, with both measurements recorded); the reviewer's report accepted by the coordinator; the PR's required checks green, and `browser (pwa)` green in the merge queue (a fast PR skips it). Rollout order does not matter for this wave: a server without `preCompressed` sends the files as before and ignores the copies, and a server with it finds no copies in an older bundle and sends the files.
- **After the merge, NOT in this wave:** the merge becomes a prerelease (the `dev` channel); the coordinator or operator rolls it out (`ccrc rollout --to vX.Y.Z`). The operator then re-measures through the real front: an `/assets/*` file answers `content-encoding: br` to the phone (the browser's network panel, or `curl -sI -H 'Accept-Encoding: br, gzip' <origin>/assets/<entry>` from any machine). That `ccrc expose`'s Caddy `reverse_proxy` forwards the request's `Accept-Encoding` and the answer's `Content-Encoding` and `Vary` unchanged is a prediction this re-measurement checks.

## Review Focus

| Input | What could go wrong | Pinned by |
|---|---|---|
| A request's `Accept-Encoding` (Chrome on Android's `gzip, deflate, br, zstd`, `br`, `gzip`, `identity`, a coding no copy exists for) | the wrong copy, a copy sent to a browser that did not ask for it, a copy with the wrong type or cache policy, a shared cache mixing encodings | Task 3 (FLC-T3-M1, FLC-T3-M2) |
| The build's output (hashed names, the shell, the Mermaid chunk) | a renamed or rewritten file, a copy that decodes to other bytes, a copy beside a shell file, a copy in the precache | Task 1 (FLC-T1-M1 to M4), Task 2 (FLC-T2-M1 to M3) |
| What a compressed answer may carry | a secret or a request's input compressed together (BREACH) | refinement (f): only hashed public files have copies; `/api/*` untouched; Task 3's shell case |
| The release artefact | copies missing from the tarball, or shipped unverified | refinement (h): `build-release.sh`'s `cp -a` and `MANIFEST` carry and verify them, with no change in `deploy/` |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/build/compressAssets.ts` | 1 | build-time, outside the bundle | `COMPRESSIBLE_EXTENSIONS`, `BROTLI_QUALITY`, `CopyOutcome`, `CompressedFile`, `compressAssets(dir)` |
| `pwa/test/compress-assets.test.ts` | 1 | — | the step on a temporary directory: copies, skip rule, names and bytes, other files, depth, exact encoders, idempotence, a missing directory |
| `pwa/vite.config.ts` | 2 | config | `precompressAssets()`: build only, `writeBundle`, logs one `precompress:` line |
| `pwa/test/reader-built.test.ts` | 2 | — | the real build: copies of the entry, its stylesheet and the Mermaid chunk; copies under `assets/` only; none precached |
| `server/src/pwaStatic.ts` | 3 | L4 | `preCompressed: true`; the doc comment |
| `server/test/pwa-static-cache.test.ts` | 3 | — | br, gzip and identity answers; the fallback chain; the shell sent as it is |
| `README.md` | 3 | — | one sentence in the `~/.ccrc/Caddyfile` bullet |

## Refinements (decided while planning)

Each refinement says What, Why and Cost if wrong. None contradicts a spec sentence (no spec covers static serving), so none takes a number.

- **(a) The step runs in a Vite plugin's `writeBundle` hook inside `vite.config.ts`, not in an npm `postbuild` script.**
  - What: `precompressAssets()` (`apply: 'build'`) calls `compressAssets(path.join(output.dir, config.build.assetsDir))` in `writeBundle`, and logs one line through Vite's logger (`precompress: <n> files under assets/, <k> copies written, <ms> ms`). `pwa/package.json` is unchanged.
  - Why: every lane that builds the PWA runs `vite build`, but only three run `npm run build`. A `postbuild` would never run in CI's `build-pwa` job (`vite build` alone), in the browser leg or in the three built-output tests (`build()` with the config), so CI's only proof that the PWA builds would never exercise the step, and the tests could never read its output; `--ignore-scripts` in a builder's npm config would skip it silently on the release lane too. A plugin gives one output for one config everywhere. `writeBundle`, not `closeBundle`: every chunk is on disk when it runs, and it finishes before any `closeBundle` hook starts, vite-plugin-pwa's service-worker generation among them, so the service worker is always generated with the copies present and refinement (g)'s exclusion rests on `globPatterns` alone, deterministically. No `package.json` change also keeps the PR off CI's full-run trigger list.
  - Cost if wrong: every `vite build` pays the step's time (refinement (c)), the hermetic built-output tests and the browser leg included, and four of those builds run under a fixed ceiling this wave does not touch: `reader-built.test.ts`, `fonts-built.test.ts` and `markdown-worker-built.test.ts` each run the build child in their `beforeAll` with `timeout: 170_000`, and so does `pwa/browser/dist.ts#buildDist`, which the browser leg's global setup runs once per shard. All four stay byte-identical, so a build that grows past 170 s fails those files (and every browser file on that shard) outright; refinement (c)'s 120 s bound keeps 50 s of margin under it. If that cost is ruled too high for the test builds, the step moves to a chained `node` call in `pwa/package.json`'s `build` script plus one line in `ci.yml`'s `build-pwa` job, and `reader-built.test.ts` loses its built-output describe.
- **(b) Only files under the built `assets/` directory, and only `.js`, `.css` and `.svg`.**
  - What: `compressAssets` is handed `<outDir>/assets` and compresses, at any depth below it, exactly the files whose extension is in `COMPRESSIBLE_EXTENSIONS`. It never renames, rewrites or removes a file; it only adds `<file>.br` and `<file>.gz`. The shell (`index.html`, `sw.js`, `workbox-*.js`, `registerSW.js` if emitted, `manifest.webmanifest`, `push-sw.js`, the icons, `licenses/`) is not touched, so the server always sends it as it is.
  - Why: the `assets/` names are content-hashed, so a copy and its file are always from one build: a new file has a new name, and no stale copy can sit beside it. The shell's names stay the same from release to release, so a stale `index.html.br` beside a new `index.html` (a partial copy, a hand restore from `~/ccrc-backups`) would serve the old shell to every browser that takes Brotli; the shell is also small and `no-cache`. `.svg` is text and would compress well if one is ever imported; `.webmanifest` and `.html` live at the root, not under `assets/`; `.woff2` and `.png` are compressed formats already (the skip rule would drop them anyway, but reading them buys nothing); `.json`, `.map` and `.wasm` are not emitted today, and adding one is one list entry.
  - Cost if wrong: the shell's few kilobytes and `sw.js`' update checks stay uncompressed; adding them later needs the stale-copy argument above answered first.
- **(c) Brotli at quality 11 (text mode, the size hint, the default 4 MiB window), or 9 by the coordinator's ruling when 11 breaks the build bounds, and gzip at level 9, synchronously, one file at a time.**
  - What: `brotliCompressSync` with `BROTLI_PARAM_QUALITY: BROTLI_QUALITY` (one named constant, 11), `BROTLI_PARAM_MODE: BROTLI_MODE_TEXT`, `BROTLI_PARAM_SIZE_HINT: <length>`; `gzipSync` at `Z_BEST_COMPRESSION`; files in name order, each read, encoded and written before the next.
  - Why, from the 3.7 MB Mermaid chunk: quality 10 and 11 are Brotli's slow path, roughly 0.5 to 1 MB/s on one core (a prediction from published benchmarks, not measured here), so that chunk alone costs a few seconds and the whole `assets/` set (about 6.5 MB of scripts and stylesheets) about 8 to 20 s per build; quality 9 is about ten times faster and, for minified JavaScript, typically 5 to 10 % larger. The copies are immutable and cached for a year, and the phone downloads them on every cold install, while the build pays once per build, so the slow path is worth it. The default window (4 MiB) holds the whole 3.7 MB chunk, and a larger one would raise the phone's decoder memory for little gain. One file at a time keeps the build's extra memory to one quality-11 encoder's (on the order of a hundred megabytes for that chunk, a prediction), which matters on a box that builds while its live sessions run (`install.sh` builds on the box); running the files in parallel would cut the wall time to the largest file's but hold several encoders at once.
  - The coordinator's ruling (2026-11-03): quality 11 while, measured under `ccrc test`, **the step stays at or under 45 s and the build child's total stays at or under 120 s**, both in Task 2 Step 6's measurement and in Task 4 Step 2's run of the pwa suite. 120 s sits well under the 170 s timeout that wraps the build child in the three built-output tests and in `pwa/browser/dist.ts#buildDist` (refinement (a)'s Cost if wrong). The build child's total is Vite's `built in` time plus the `precompress:` milliseconds (Task 2 Step 6; its `wall` figure is recorded beside it, and the bound applies to the larger), or a built-output file's build time in the suite (Task 4 Step 2).
  - **The switch.** If either bound breaks at quality 11, the worker edits the one line `export const BROTLI_QUALITY = 11;` to `export const BROTLI_QUALITY = 9;` in `pwa/build/compressAssets.ts`, commits it alone (`pwa: Brotli quality 9, by the ruling's build bounds (docs first-load compression)`), re-runs Task 2 Step 6's measurement and the three built-output files alone, records both measurements and the switch in the SDD ledger, then in `## Results` and the PR body, restates FLC-T1-M3's `old` as `= 9`, and goes on. No test pins 11: Task 1's encoder case reads the constant and holds it to the two ruled values, so the switch reds nothing. Only if quality 9 also breaks either bound does the worker stop and ask the coordinator.
  - Cost if wrong: at 9 the copies are predicted 5 to 10 % larger on the phone; past 170 s a build-output file or a browser shard fails outright, which is what the 120 s bound exists to prevent.
- **(d) A copy that is not smaller than its file is not written, each encoding decided alone.** `writeIfSmaller` compares the encoded length with the file's; a one-byte script gets neither copy, and a short run of one letter may get a `.br` but no `.gz` (gzip's 18-byte frame). The server's fallback chain answers any combination (Task 3's skip case). Cost if wrong: none to correctness; a tiny file costs a few bytes more or less.
- **(e) The server turns on `@fastify/static`'s `preCompressed`, in the one registration, with nothing else changed.**
  - What: `pwaStaticOptions` gains `preCompressed: true`. `etag`, `lastModified`, `cacheControl` and `setHeaders` are unchanged, and `server.ts`' one `app.register(fastifyStatic, pwaStaticOptions(pwaRoot))` and its SPA fallback are untouched.
  - Why: the behaviour read in "What the base says": a copy only when the request takes its coding; `Content-Encoding` and the original `Content-Type` set by the plugin; `Vary: accept-encoding` on every file answer (so a shared cache never hands a copy to a browser that cannot decode it, and never hands the uncompressed file where a copy was asked for, which matters for `immutable` files); `setHeaders` sees the copy's own path, which is under `assets/`, so a copy keeps `PWA_ASSET_CACHE`. The shell answers gain `Vary: accept-encoding` too, which is harmless on `no-cache` files. A copy is also reachable at its own URL (`/assets/<file>.br`), sent as the file it is; that is the public bundle either way.
  - Cost if wrong: if a later `@fastify/static` stops varying the fallback or hands `setHeaders` the original path, Task 3's identity case or FLC-T3-M2 shows it.
- **(f) Nothing that carries a secret or reflects a request's input is compressed.** BREACH needs a secret and attacker-influenced input in one compressed body. The only compressed bodies are the hashed public bundle files, which hold neither. Every `/api/*` and `/ws/*` answer (session data, the operator's docs at `/api/docs/*`, drafts included) is untouched by this wave: there is no runtime compression and no `@fastify/compress`. A Docs page URL (`/docs/...`) is an SPA route answered with the shell through the not-found handler, and the shell has no copy, so it is sent as it is (Task 3's shell case). With `preCompressed` on, `@fastify/static` 10.1.8 sends `index.html.br` or `sw.js.br` as Brotli for `/`, `/index.html`, the SPA fallback and `/sw.js` whenever such a copy exists (measured in the fix round of review 1411). So the guarantee that no shell answer is compressed rests on the build alone: the `assets/`-only scope (rows FLC-T1-M2 and FLC-T2-M3) and `emptyOutDir`, which clears every old copy. Any future change that writes a shell copy must add a server guard first. Cost if wrong: none known; compressing an API answer later needs its own argument.
- **(g) The service worker precaches no copy.** vite-plugin-pwa's workbox globs `**/*.{js,css,html,png,svg,webmanifest,woff2}`, which matches a name that ends in one of those extensions, never `<file>.js.br` or `<file>.js.gz`; with refinement (a)'s `writeBundle`, the copies exist when the glob runs, so the exclusion is the pattern's and FLC-T2-M2 measures it. The worker fetches the asset's own URL, the browser decodes the copy, and the Cache API stores the decoded body. `Vary: Accept-Encoding` does not break the precache's match: `Accept-Encoding` is a forbidden request header that a page or worker never sets, so the stored and the queried requests agree on it. Cost if wrong: a precache miss refetches the file; the browser leg in the merge queue loads the app through the service worker's build either way.
- **(h) The release carries the copies with no change.** `build-release.sh`'s `cp -a` takes them, `MANIFEST` hashes and `ccrc update` verifies them, `deploy.sh`'s `rsync --delete` ships them, `install.sh` builds them through `npm run build`. Both encoders are deterministic for a given Node (gzip's header carries no time), but the release runner's Node floats on the open `engines` range (`release-main.yml` reads `node-version-file: server/package.json`, which says `>=22.16.0`), so a runner whose Node bundles different zlib or Brotli encoders writes different copies, and a merge that changes nothing shipped can then cut a prerelease that differs only in its copies, once per such change (a docs-only merge starts no release run at all); every release tarball, kept version and update download carries about 4.2 MB more (measured: 1,870,694 B of `.br` plus 2,307,989 B of `.gz`, already compressed, so the tarball's gzip cannot shrink them); pinning the release runner's Node is outside this wave's scope and is recorded as a Later item in the programme's ledger.
- **(i) The step lives in `pwa/build/compressAssets.ts`, outside `pwa/src`.** It imports `node:fs`, `node:path` and `node:zlib`, which no bundled file may; outside `pwa/src` it is not bundled and not in the PWA ring or literal censuses. It is typechecked through `vite.config.ts`' import and its test's import (Task 1 Step 5 shows it in the program). Cost if wrong: a rename, or one `include` entry in `pwa/tsconfig.json` (a full-CI trigger).
- **(j) One README sentence, in the `~/.ccrc/Caddyfile` bullet.** The bullet's "nothing else" now raises the question whether Caddy should compress; the sentence answers that the server already sends precompressed assets, so the Caddyfile needs no `encode`. Not test-pinned (checked, above). Cost if wrong: one sentence moves.

### Task 1: The compress step, alone (refinements (b), (c), (d), (i))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`.

**Files:**
- Create: `pwa/build/compressAssets.ts`, `pwa/test/compress-assets.test.ts`.
- Guards (not edited): `server/test/typecheck-tests.test.ts`, `server/test/citations.test.ts`, `pwa/test/contrast.test.ts`.

**Interfaces:** Produces `COMPRESSIBLE_EXTENSIONS: readonly string[]`, `BROTLI_QUALITY = 11` (refinement (c)'s one-line switch makes it 9), `type CopyOutcome`, `interface CompressedFile`, `compressAssets(dir: string): CompressedFile[]`.

**Decisions:** (1) Synchronous and sequential (refinement (c)). (2) The walk uses `readdirSync(dir, { recursive: true, withFileTypes: true })` and the entries' own `isFile()`, never a separate `stat` before the read (no check-then-use pattern for CodeQL to flag). (3) The report is in name order, `file` relative to `dir`. (4) A missing `dir` throws `ENOENT`: a build with no `assets/` is a broken build, and the plugin lets it fail the build.

- [ ] **Step 0: Base.** Run:
  `git grep -qF "outDir: '../server/dist-pwa'," HEAD -- pwa/vite.config.ts && git grep -qF "globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}']," HEAD -- pwa/vite.config.ts && git grep -qF '"build": "tsc --noEmit && vite build",' HEAD -- pwa/package.json && git grep -qF '"node": ">=22.16.0"' HEAD -- pwa/package.json && test ! -e pwa/build && test ! -e pwa/test/compress-assets.test.ts && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. If it does not print, stop and ask the coordinator. Record BASE (`git rev-parse HEAD`) in the SDD ledger.
- [ ] **Step 1: Write the failing test,** `pwa/test/compress-assets.test.ts`, with exactly this content:

```ts
// The PWA's precompressed assets, the build step alone (native Docs reader, the first-load compression plan of
// 2026-11-03, Task 1): `build/compressAssets.ts` over a temporary directory. Every script, stylesheet and SVG gets a
// Brotli copy and a gzip copy beside it, each smaller and each decoding to the file's bytes; a copy that would not be
// smaller is not written, each encoding decided alone; every other file is left alone; no file it was given changes
// its name or a byte. What the real build emits is read by reader-built.test.ts.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BROTLI_QUALITY, compressAssets } from '../build/compressAssets';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh directory holding `files` (a relative name to its content). */
function dirWith(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-compress-'));
  made.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

/** Every file under `dir`, by its relative name, to its sha256. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const abs = path.join(d.parentPath, d.name);
    out[path.relative(dir, abs)] = createHash('sha256').update(readFileSync(abs)).digest('hex');
  }
  return out;
}

// The shapes of what the bundle emits: a few kilobytes each, as repetitive as minified output, and no colour value.
const script = (n: number): string => Array.from({ length: n }, (_, i) => `export const value${i % 37}=${i};`).join('');
const styles = (n: number): string => Array.from({ length: n }, (_, i) => `.row-${i % 23}{padding:${i % 7}px}`).join('');
const svg = (n: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: n }, (_, i) => `<path d="M${i} 0L0 ${i}"/>`).join('')}</svg>`;

const BUNDLE: Record<string, string> = {
  'index-AbCd1234.js': script(400),
  'index-EfGh5678.css': styles(300),
  'icon-IjKl9012.svg': svg(200),
};

describe('compressAssets (first-load compression plan, Task 1)', () => {
  it('writes a .br and a .gz beside each script, stylesheet and SVG, each smaller and each decoding to the file', () => {
    const dir = dirWith(BUNDLE);
    const report = compressAssets(dir);
    expect(report.map((r) => r.file)).toEqual(Object.keys(BUNDLE).sort());
    for (const name of Object.keys(BUNDLE)) {
      const bytes = readFileSync(path.join(dir, name));
      const br = readFileSync(path.join(dir, `${name}.br`));
      const gz = readFileSync(path.join(dir, `${name}.gz`));
      expect(br.length, `${name}.br`).toBeLessThan(bytes.length);
      expect(gz.length, `${name}.gz`).toBeLessThan(bytes.length);
      expect(brotliDecompressSync(br).equals(bytes), `${name}.br`).toBe(true);
      expect(gunzipSync(gz).equals(bytes), `${name}.gz`).toBe(true);
    }
    expect(report.every((r) => r.br.kind === 'written' && r.gz.kind === 'written')).toBe(true);
  });

  it('changes no name and no byte of a file it was given, and adds exactly the copies', () => {
    const dir = dirWith(BUNDLE);
    const before = snapshot(dir);
    compressAssets(dir);
    const after = snapshot(dir);
    for (const [name, sha] of Object.entries(before)) expect(after[name], name).toBe(sha);
    expect(Object.keys(after).sort())
      .toEqual([...Object.keys(before), ...Object.keys(before).flatMap((n) => [`${n}.br`, `${n}.gz`])].sort());
  });

  it('writes no copy that is not smaller than its file, deciding each encoding alone', () => {
    // One byte: neither encoding is smaller. Twenty of one letter: Brotli's copy is smaller (about nine bytes), gzip's
    // is not (its frame alone is eighteen).
    const dir = dirWith({ 'tiny-AbCd1234.js': 'x', 'pad-EfGh5678.js': 'a'.repeat(20) });
    const report = compressAssets(dir);
    expect(report.map((r) => [r.file, r.br.kind, r.gz.kind])).toEqual([
      ['pad-EfGh5678.js', 'written', 'not-smaller'],
      ['tiny-AbCd1234.js', 'not-smaller', 'not-smaller'],
    ]);
    expect(Object.keys(snapshot(dir)).sort()).toEqual(['pad-EfGh5678.js', 'pad-EfGh5678.js.br', 'tiny-AbCd1234.js']);
  });

  it('leaves every other file alone: fonts, images, the shell, other text and copies already there', () => {
    const dir = dirWith({
      'Geist-AbCd1234.woff2': randomBytes(4096),
      'icon-EfGh5678.png': randomBytes(4096),
      'index.html': `<!doctype html><script>${script(100)}</script>`,
      'notes.txt': script(100),
      'data-IjKl9012.json': JSON.stringify(Array.from({ length: 300 }, (_, i) => i % 9)),
      'stray-MnOp3456.js.br': script(100),
      'stray-MnOp3456.js.gz': script(100),
    });
    const before = snapshot(dir);
    expect(compressAssets(dir)).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });

  it('reaches a file in a directory below', () => {
    const dir = dirWith({ 'sub/chunk-QrSt7890.js': script(300) });
    expect(compressAssets(dir).map((r) => r.file)).toEqual([path.join('sub', 'chunk-QrSt7890.js')]);
    expect(brotliDecompressSync(readFileSync(path.join(dir, 'sub', 'chunk-QrSt7890.js.br'))).toString()).toBe(script(300));
    expect(gunzipSync(readFileSync(path.join(dir, 'sub', 'chunk-QrSt7890.js.gz'))).toString()).toBe(script(300));
  });

  it('the .br is Brotli at BROTLI_QUALITY, a ruled value, in text mode and the .gz gzip at level 9: the bytes zlib gives', () => {
    // The coordinator's ruling of 2026-11-03: 11, or 9 when 11 breaks the build bounds. The bytes below read the constant,
    // so that switch is one line in build/compressAssets.ts and reds nothing here.
    expect([9, 11], 'BROTLI_QUALITY is one of the two ruled values').toContain(BROTLI_QUALITY);
    const dir = dirWith(BUNDLE);
    compressAssets(dir);
    for (const name of Object.keys(BUNDLE)) {
      const bytes = readFileSync(path.join(dir, name));
      const br = brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      });
      expect(readFileSync(path.join(dir, `${name}.br`)).equals(br), `${name}.br`).toBe(true);
      expect(readFileSync(path.join(dir, `${name}.gz`)).equals(gzipSync(bytes, { level: 9 })), `${name}.gz`).toBe(true);
    }
  });

  it('running it twice changes nothing', () => {
    const dir = dirWith(BUNDLE);
    compressAssets(dir);
    const once = snapshot(dir);
    compressAssets(dir);
    expect(snapshot(dir)).toEqual(once);
  });

  it('throws on a directory that is not there: a build with no assets/ is a broken build', () => {
    const dir = dirWith({});
    expect(() => compressAssets(path.join(dir, 'assets'))).toThrow(/ENOENT/);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/compress-assets.test.ts )` — Expected (prediction): the file fails to load (`Failed to load url ../build/compressAssets` or `Cannot find module`), `Test Files  1 failed (1)`, `Tests  no tests`.
- [ ] **Step 3: Write `pwa/build/compressAssets.ts`** with exactly this content:

```ts
// The PWA's precompressed assets (native Docs reader, the first-load compression plan of 2026-11-03). Once `vite build`
// has written the bundle, every script, stylesheet and SVG under `assets/` gets a Brotli copy (`<file>.br`) and a gzip
// copy (`<file>.gz`) beside it, and the server sends the copy a browser accepts (`server/src/pwaStatic.ts#pwaStaticOptions`,
// @fastify/static's `preCompressed`). `vite.config.ts#precompressAssets` runs it. Node's own `node:zlib`; no dependency.
//
// Only `assets/`: its names are content-hashed, so a copy can never sit beside a newer file of the same name, and its
// files are public and hold no secret and no request's input, so compressing them opens no compression side channel.
// A copy that is not smaller than its file is not written, each encoding decided alone. No file the build wrote changes
// its name or its bytes. One file at a time, synchronously: at quality 11 the encoder's memory is the bound to keep.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** The extensions compressed: the text formats the bundle emits under `assets/`. woff2 and png are compressed already. */
export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg'];

/** Brotli's quality, by the coordinator's ruling of 2026-11-03: 11, its highest (the build pays it once; the hashed file
 *  is served, immutable, for a year), while a build stays within the ruling's bounds (this step at most 45 s, the build
 *  child at most 120 s, under the tests' 170 s timeout); otherwise 9. The switch is this one line. */
export const BROTLI_QUALITY = 11;

/** One encoding of one file: written beside it, or left out because it was not smaller than the file. */
export type CopyOutcome =
  | { readonly kind: 'written'; readonly bytes: number }
  | { readonly kind: 'not-smaller'; readonly bytes: number };

/** One compressible file and what was written beside it; `file` is relative to the directory given. */
export interface CompressedFile {
  readonly file: string;
  readonly bytes: number;
  readonly br: CopyOutcome;
  readonly gz: CopyOutcome;
}

/** Write `copy` to `target` only when it is smaller than the `original` bytes it encodes. */
function writeIfSmaller(target: string, copy: Buffer, original: number): CopyOutcome {
  if (copy.byteLength >= original) return { kind: 'not-smaller', bytes: copy.byteLength };
  writeFileSync(target, copy);
  return { kind: 'written', bytes: copy.byteLength };
}

/** Write `<file>.br` and `<file>.gz` beside every compressible file under `dir`, at any depth, one file at a time, in
 *  name order. A `dir` that is not there throws (ENOENT): a build with no `assets/` is a broken build. */
export function compressAssets(dir: string): CompressedFile[] {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && COMPRESSIBLE_EXTENSIONS.includes(path.extname(d.name)))
    .map((d) => path.join(d.parentPath, d.name))
    .sort();
  const out: CompressedFile[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const br = brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    });
    const gz = gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION });
    out.push({
      file: path.relative(dir, file),
      bytes: bytes.byteLength,
      br: writeIfSmaller(`${file}.br`, br, bytes.byteLength),
      gz: writeIfSmaller(`${file}.gz`, gz, bytes.byteLength),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/compress-assets.test.ts )` — Expected (prediction): `Tests  8 passed (8)`. If the third case's `pad-EfGh5678.js` row reads `written` for gzip or `not-smaller` for Brotli, report the measured sizes to the coordinator before changing the fixture (the case's point is one encoding written and the other not).
- [ ] **Step 5: Typecheck, and the new file is in the program.** `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )` — Expected: `TSC-OK`. `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json --listFilesOnly | grep -c 'pwa/build/compressAssets.ts$' )` — Expected: `1` (reached through the test's import now, and through `vite.config.ts` after Task 2).
- [ ] **Step 6: Guards.** `( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts )` through `ccrc test` — green (no hex colour in the new files). `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/citations.test.ts )` — green. `typecheck-tests.test.ts` runs in Task 4.
- [ ] **Step 7: Commit.** `git add pwa/build/compressAssets.ts pwa/test/compress-assets.test.ts` (expect 2), message `pwa: the build step that writes Brotli and gzip copies of the hashed assets (docs first-load compression)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (file `pwa/build/compressAssets.ts`, tests `test/compress-assets.test.ts`):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| FLC-T1-M1 | (d) | `if (copy.byteLength >= original) return { kind: 'not-smaller', bytes: copy.byteLength };` → removed | 1 failed — `'writes no copy that is not smaller than its file, deciding each encoding alone'` |
| FLC-T1-M2 | (b) | `export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg'];` → `export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg', '.html'];` | 1 failed — `'leaves every other file alone: …'` |
| FLC-T1-M3 | (c) | `export const BROTLI_QUALITY = 11;` → `export const BROTLI_QUALITY = 5;` | 1 failed — `'the .br is Brotli at BROTLI_QUALITY, a ruled value, …'` (the value pinned is the ruling's pair, 9 or 11; after refinement (c)'s switch the row's `old` reads `= 9`) |
| FLC-T1-M4 | (b) | ``br: writeIfSmaller(`${file}.br`, br, bytes.byteLength),`` → `br: writeIfSmaller(file, br, bytes.byteLength),` | 5 failed — `'writes a .br and a .gz beside …'`, `'changes no name and no byte …'`, `'writes no copy that is not smaller …'`, `'reaches a file in a directory below'`, `'the .br is Brotli at BROTLI_QUALITY, a ruled value, …'` (`'running it twice changes nothing'` is predicted green: a second encoding of Brotli bytes is not smaller, so nothing more is written) |

```json
[
  {"id": "FLC-T1-M1", "spec": "(d)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "if (copy.byteLength >= original) return { kind: 'not-smaller', bytes: copy.byteLength };", "new": "", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: writes no copy that is not smaller than its file, deciding each encoding alone"},
  {"id": "FLC-T1-M2", "spec": "(b)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg'];", "new": "export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg', '.html'];", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: leaves every other file alone"},
  {"id": "FLC-T1-M3", "spec": "(c)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "export const BROTLI_QUALITY = 11;", "new": "export const BROTLI_QUALITY = 5;", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: the .br is Brotli at BROTLI_QUALITY, a ruled value"},
  {"id": "FLC-T1-M4", "spec": "(b)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "br: writeIfSmaller(`${file}.br`, br, bytes.byteLength),", "new": "br: writeIfSmaller(file, br, bytes.byteLength),", "tests": ["test/compress-assets.test.ts"], "red": "5 failed: writes a .br and a .gz beside; changes no name and no byte; writes no copy that is not smaller; reaches a file in a directory below; the .br is Brotli at BROTLI_QUALITY, a ruled value"}
]
```

**Verify:** `test/compress-assets.test.ts` 8 passed; `TSC-OK`; the guards green.

### Task 2: The build writes the copies (refinements (a), (g))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`. The measurement (Step 6) is the main loop's to read and judge.

**Files:**
- Modify: `pwa/vite.config.ts` (two import lines, the `precompressAssets` function, one plugin entry), `pwa/test/reader-built.test.ts` (two import lines, one header line, one appended describe).
- Guards (not edited): `pwa/test/fonts-built.test.ts`, `pwa/test/markdown-worker-built.test.ts`, `pwa/test/browser-leg.test.ts`, `pwa/test/sw-denylist.test.ts`, `pwa/test/markdown-runner.test.ts`, `pwa/test/shadcn-alias.test.ts`, `pwa/test/contrast.test.ts` (each reads `vite.config.ts`' text or builds with it), `server/test/ci-reach-census.test.ts`, `server/test/docs-parity.test.ts`.

**Interfaces:** Consumes `compressAssets` (Task 1). Produces the plugin `ccrc-precompress-assets` (`apply: 'build'`).

**Decisions:** (1) `writeBundle`, not `closeBundle` (refinement (a)). (2) The directory is the build's own (`output.dir`, then `config.build.assetsDir`), so a test's or the browser leg's `outDir` override is followed. (3) One log line through Vite's logger, which `logLevel: 'error'` silences in the tests and a plain `vite build` prints (the measurement reads it). (4) The plugin sits after `devWorkerSafeEntries()`; its position does not matter, because every `writeBundle` ends before the first `closeBundle`.

- [ ] **Step 0: Base, claims, the BASE durations and counts.** Run:
  `git grep -qF "import { createRequire } from 'node:module';" HEAD -- pwa/vite.config.ts && git grep -qF "// https://vite.dev/config/" HEAD -- pwa/vite.config.ts && git grep -qF "    devWorkerSafeEntries()," HEAD -- pwa/vite.config.ts && ! git grep -qF "precompress" HEAD -- pwa/vite.config.ts && git grep -qF "import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';" HEAD -- pwa/test/reader-built.test.ts && git grep -qF "// - the Geist pair is still precached." HEAD -- pwa/test/reader-built.test.ts && git grep -qF "const precached = (): string[] => {" HEAD -- pwa/test/reader-built.test.ts && test -f pwa/build/compressAssets.ts && echo T2-BASE-OK`
  Expected: `T2-BASE-OK`. Confirm the claims on `pwa/vite.config.ts` and `pwa/test/reader-built.test.ts`. Then, before any edit, run each of the three built-output files alone through `ccrc test` (on this workspace, so the JSON lands in the SDD directory), with vitest's JSON reporter beside its default one, `<f>` each of `reader-built`, `fonts-built` and `markdown-worker-built` in turn:

```bash
( cd pwa && ./node_modules/.bin/vitest run test/<f>.test.ts --reporter=default --reporter=json \
    --outputFile=../.superpowers/sdd/2026-11-03-native-docs-reader-first-load-compression/base-<f>.json )
```

  and read each file's build time from its JSON (the file's span less its cases' time; what remains is almost all the `beforeAll` build child, which runs under `timeout: 170_000`):

```bash
node -e '
  const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  for (const t of r.testResults) {
    const cases = t.assertionResults.reduce((s, a) => s + (a.duration || 0), 0);
    const span = t.endTime - t.startTime;
    console.log(t.name.split("/").pop(), "span", span, "ms; cases", Math.round(cases), "ms; build", Math.round(span - cases), "ms");
  }' .superpowers/sdd/2026-11-03-native-docs-reader-first-load-compression/base-<f>.json
```

  Record, for each of the three, its count (`reader-built`: `Tests  6 passed (6)`, a prediction; the other two as printed), vitest's `Duration` line and that build time. These are the BASE values Step 4 and Task 4 Step 2 compare against.
- [ ] **Step 1: Write the failing test.** In `pwa/test/reader-built.test.ts`:
  Find: `import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';`
  Replace: `import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';`
  Find: `import { execFileSync } from 'node:child_process';`
  Replace:
```ts
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
```
  Find: `// - the Geist pair is still precached.`
  Replace:
```ts
// - the Geist pair is still precached;
// - the build writes a Brotli and a gzip copy beside each script, stylesheet and SVG under assets/, and the service
//   worker precaches none of them (the first-load compression plan of 2026-11-03, Task 2).
```
  Then append at the end of the file:

```ts
// The first-load compression plan (2026-11-03, Task 2): `precompressAssets` (vite.config.ts) runs
// `build/compressAssets.ts` over the build's assets/ once the bundle is written, and the server sends the copies
// (server/src/pwaStatic.ts). The service worker is generated after them and precaches none.
describe('the built assets carry their precompressed copies, which the service worker does not precache', () => {
  const assets = (): string => path.join(out, 'assets');
  /** The module entry and the stylesheets the built shell loads, as `assets/<name>`. */
  const shellLoads = (): string[] => {
    const doc = new DOMParser().parseFromString(readFileSync(path.join(out, 'index.html'), 'utf8'), 'text/html');
    return [
      ...[...doc.querySelectorAll('script[type="module"][src]')].map((e) => e.getAttribute('src') ?? ''),
      ...[...doc.querySelectorAll('link[rel="stylesheet"][href]')].map((e) => e.getAttribute('href') ?? ''),
    ].filter((u) => u.startsWith('/assets/')).map((u) => u.slice(1));
  };
  /** Every file the build wrote, relative to it, at any depth. */
  const built = (): string[] => readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(out, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .sort();

  it('the entry script, its stylesheet and the Mermaid chunk each have a .br and a .gz, smaller, that decode to their bytes', () => {
    const mermaid = readdirSync(assets()).filter((n) => /^mermaid\.frame-.+\.js$/.test(n)).map((n) => `assets/${n}`);
    const targets = [...shellLoads(), ...mermaid];
    expect(targets.filter((t) => t.endsWith('.js')), 'one module entry and one Mermaid chunk').toHaveLength(2);
    expect(targets.some((t) => t.endsWith('.css')), 'the shell loads a stylesheet').toBe(true);
    for (const t of targets) {
      const bytes = readFileSync(path.join(out, t));
      const br = readFileSync(path.join(out, `${t}.br`));
      const gz = readFileSync(path.join(out, `${t}.gz`));
      expect(br.length, `${t}.br`).toBeLessThan(bytes.length);
      expect(gz.length, `${t}.gz`).toBeLessThan(bytes.length);
      expect(brotliDecompressSync(br).equals(bytes), `${t}.br`).toBe(true);
      expect(gunzipSync(gz).equals(bytes), `${t}.gz`).toBe(true);
    }
  });

  it('every copy sits beside the script, stylesheet or SVG it encodes, under assets/ only; one of 1 KiB or more has both', () => {
    const files = built();
    const copies = files.filter((f) => /\.(?:br|gz)$/.test(f));
    expect(copies.length, 'the build wrote no copy').toBeGreaterThan(0);
    for (const c of copies) {
      expect(c.startsWith('assets/'), c).toBe(true);
      expect(/\.(?:js|css|svg)\.(?:br|gz)$/.test(c), c).toBe(true);
      expect(files, c).toContain(c.slice(0, -3));
    }
    for (const f of files.filter((n) => n.startsWith('assets/') && /\.(?:js|css)$/.test(n))) {
      if (statSync(path.join(out, f)).size < 1024) continue;
      expect(files, f).toContain(`${f}.br`);
      expect(files, f).toContain(`${f}.gz`);
    }
  });

  it('the service worker precaches no copy, and still precaches the entry script', () => {
    const urls = precached();
    expect(urls.filter((u) => /\.(?:br|gz)$/.test(u))).toEqual([]);
    expect(urls).toContain(shellLoads().find((t) => t.endsWith('.js')));
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-built.test.ts )` through `ccrc test` — Expected (prediction): `Tests  2 failed | 7 passed (9)`: the first new case (`ENOENT` reading the entry's `.br`) and the second (`the build wrote no copy`); the third is green before the plugin exists (nothing to precache), and FLC-T2-M2 is what makes it a guard.
- [ ] **Step 3: Wire the plugin.** In `pwa/vite.config.ts`:
  Find: `import { createRequire } from 'node:module';`
  Replace:
```ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { compressAssets } from './build/compressAssets.js';
```
  Find: `// https://vite.dev/config/`
  Replace:
```ts
// Brotli and gzip copies of the scripts, stylesheets and SVGs under assets/, written beside them once the bundle is on
// disk (build/compressAssets.ts); the server sends the copy a browser accepts (server/src/pwaStatic.ts). Build only.
// It runs in `writeBundle`, which ends before any `closeBundle` begins, so the service worker VitePWA generates in its
// `closeBundle` is always made with the copies on disk, and `globPatterns` below, which names no `.br` or `.gz`, is
// what keeps them out of its precache. Pinned by test/compress-assets.test.ts and test/reader-built.test.ts.
function precompressAssets(): Plugin {
  let assetsDir = '';
  let info: (message: string) => void = () => undefined;
  return {
    name: 'ccrc-precompress-assets',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir;
      info = (message) => config.logger.info(message);
    },
    writeBundle(output) {
      if (output.dir === undefined) throw new Error('ccrc-precompress-assets: the build has no output directory');
      const started = performance.now();
      const files = compressAssets(path.join(output.dir, assetsDir));
      const written = files.flatMap((f) => [f.br, f.gz]).filter((c) => c.kind === 'written').length;
      info(`precompress: ${files.length} files under ${assetsDir}/, ${written} copies written, `
        + `${Math.round(performance.now() - started)} ms`);
    },
  };
}

// https://vite.dev/config/
```
  Find: `    devWorkerSafeEntries(),`
  Replace:
```ts
    devWorkerSafeEntries(),
    precompressAssets(),
```
- [ ] **Step 4: Run it to see it pass.** `( cd pwa && ./node_modules/.bin/vitest run test/reader-built.test.ts )` through `ccrc test` — Expected (prediction): `Tests  9 passed (9)`, its `Duration` longer than Step 0's by about the step's time (10 to 30 s, prediction). Then `test/fonts-built.test.ts` and `test/markdown-worker-built.test.ts`, each alone through `ccrc test` — green, their counts equal to the ones Step 0 recorded. Record all three files' `Duration` and build time (Step 0's two commands, `after-<f>.json`) beside Step 0's.
- [ ] **Step 5: The config's readers and typecheck.** `( cd pwa && ./node_modules/.bin/vitest run test/browser-leg.test.ts test/sw-denylist.test.ts test/markdown-runner.test.ts test/shadcn-alias.test.ts )` — green. `TSC-OK`; Task 1 Step 5's `--listFilesOnly` count still `1`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/ci-reach-census.test.ts test/docs-parity.test.ts )` — green.
- [ ] **Step 6: Measure one real build.** In the foreground, through `ccrc test` (as the ruling measures it), into a temporary directory (never `server/dist-pwa`). Save this script as `.superpowers/sdd/2026-11-03-native-docs-reader-first-load-compression/measure-build.sh` (gitignored) and run it from the workspace root with `bash`: the build is bounded by `timeout -k 10 600`, and the clean-up is an `EXIT` trap, which also runs when the build is killed or the script is interrupted:

```bash
set -u
cd pwa || exit 1
OUT="$(mktemp -d)"; LOG="$(mktemp)"
trap 'rm -rf "$OUT" "$LOG"' EXIT
trap 'exit 1' INT TERM HUP
echo "OUT=$OUT"
S0=$SECONDS
timeout -k 10 600 ./node_modules/.bin/vite build --outDir "$OUT" --emptyOutDir >"$LOG" 2>&1
rc=$?
echo "rc=$rc wall=$((SECONDS - S0)) s"
grep -E 'precompress:|built in' "$LOG"
[ "$rc" -eq 0 ] || { tail -n 40 "$LOG"; exit "$rc"; }
node -e '
  const fs = require("node:fs"), p = require("node:path");
  const d = process.argv[1];
  const sz = (f) => { try { return fs.statSync(p.join(d, f)).size; } catch { return 0; } };
  const rows = fs.readdirSync(d).filter((n) => /\.(js|css)$/.test(n))
    .map((n) => [n, sz(n), sz(n + ".br"), sz(n + ".gz")]).sort((a, b) => b[1] - a[1]);
  for (const r of rows.slice(0, 10)) console.log(r.join("\t"));
  const t = (i) => rows.reduce((s, r) => s + (r[i] || r[1]), 0);
  console.log(["total", t(1), t(2), t(3)].join("\t"));
' "$OUT/assets"
```

  Then check the clean-up: `test ! -e "<the OUT= path it printed>" && echo OUT-GONE` — Expected: `OUT-GONE`.
  Record in the SDD ledger, for `## Results`: `rc` and `wall`; the `precompress:` line (files, copies, milliseconds); Vite's `built in` time; **the build child's total, Vite's `built in` plus the `precompress:` milliseconds** (summed even if Vite's figure already includes the step, the safe side), with `wall` beside it; the ten largest scripts and stylesheets with their identity, `.br` and `.gz` sizes, and the totals. Predictions: the entry script (about 1962 KB) to about 450 to 550 KB as Brotli and 600 to 700 KB as gzip; the Mermaid chunk (about 3682 KB) to about 800 to 1000 KB as Brotli; the step 10 to 30 s; the total well under 120 s.
  **The ruling's bounds, here** (refinement (c)): the `precompress:` milliseconds at most 45 000, and the build child's total (or `wall`, if larger) at most 120 s, which is the margin under the `timeout: 170_000` that wraps this same build in `reader-built.test.ts`, `fonts-built.test.ts`, `markdown-worker-built.test.ts` and `pwa/browser/dist.ts#buildDist`. At quality 11, a broken bound is refinement (c)'s switch to 9 (one line, its own commit), then this step again, both runs recorded; at quality 9, a stop-and-ask to the coordinator with both runs' lines and tables.
- [ ] **Step 7: Commit.** `git add pwa/vite.config.ts pwa/test/reader-built.test.ts` (expect 2; a quality switch made in Step 6 is its own commit), message `pwa: the build writes the precompressed copies, and the service worker precaches none (docs first-load compression)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`, file `vite.config.ts`, tests `test/reader-built.test.ts`, run through `ccrc test`; each row builds once):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| FLC-T2-M1 | (a) | `precompressAssets(),` → removed | 2 failed — `'the entry script, its stylesheet and the Mermaid chunk each have a .br and a .gz …'`, `'every copy sits beside …'` |
| FLC-T2-M2 | (g) | `globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],` → `globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2,br,gz}'],` | 2 failed — `'the service worker precaches no copy, …'` and the existing `'sw.js precaches no file that carries the Mermaid asset'` (the Mermaid chunk's copies are named `mermaid.frame-…`, and `globIgnores` names `.js` only). If this row stays green, the copies were not on disk when the service worker was generated: stop and ask (refinement (a)'s timing claim failed) |
| FLC-T2-M3 | (b) | `const files = compressAssets(path.join(output.dir, assetsDir));` → `const files = compressAssets(output.dir);` | 1 failed — `'every copy sits beside the script, stylesheet or SVG it encodes, under assets/ only; one of 1 KiB or more has both'`: Vite copies `public/` into the output before the bundle is written, so `push-sw.js` sits at the root at `writeBundle` time and gets copies. `sw.js` and the workbox runtime get none even under this mutation, because VitePWA writes them later, in `closeBundle`; that is why the guard against a stale copy beside a fixed-name shell file rests on the `assets/` path, not on timing. If this row stays green, no root script existed at `writeBundle` time: stop and ask |

```json
[
  {"id": "FLC-T2-M1", "spec": "(a)", "pkg": "pwa", "file": "vite.config.ts", "old": "precompressAssets(),", "new": "", "tests": ["test/reader-built.test.ts"], "red": "2 failed: the entry script, its stylesheet and the Mermaid chunk each have a .br and a .gz; every copy sits beside"},
  {"id": "FLC-T2-M2", "spec": "(g)", "pkg": "pwa", "file": "vite.config.ts", "old": "globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],", "new": "globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2,br,gz}'],", "tests": ["test/reader-built.test.ts"], "red": "2 failed: the service worker precaches no copy; sw.js precaches no file that carries the Mermaid asset"},
  {"id": "FLC-T2-M3", "spec": "(b)", "pkg": "pwa", "file": "vite.config.ts", "old": "const files = compressAssets(path.join(output.dir, assetsDir));", "new": "const files = compressAssets(output.dir);", "tests": ["test/reader-built.test.ts"], "red": "1 failed: every copy sits beside the script, stylesheet or SVG it encodes, under assets/ only; one of 1 KiB or more has both"}
]
```

**Verify:** `test/reader-built.test.ts` 9 passed; the other two built-output files and the config's readers green; `TSC-OK`; the measurement recorded, `OUT-GONE`, and within the ruling's bounds at the quality used.

### Task 3: The server sends the copies (refinements (e), (f), (j))

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `opus` (what the server sends, and the side-channel argument).

**Files:**
- Modify: `server/src/pwaStatic.ts` (the doc comment, one option), `server/test/pwa-static-cache.test.ts` (its header, two import lines, the fixture, one appended describe), `README.md` (one sentence).
- Guards (not edited): `server/test/rings/fastify-l4.test.ts`, `server/test/auth-gate.test.ts`, `server/test/ccrc-versioned-audit.test.ts`, `server/test/ccrc-settings-census.test.ts`, `server/test/topology-clean.test.ts`.

**Interfaces:** `pwaStaticOptions(root)` gains `preCompressed: true`; its signature, `PWA_ASSET_CACHE` and `PWA_SHELL_CACHE` are unchanged.

**Decisions:** (1) One option, in the one registration; `server.ts` is byte-identical. (2) The test makes its copies with `node:zlib` itself; it never imports `pwa/`. (3) It asserts the media type of a copy's `Content-Type` equal to the file's (the part before `;`), not the whole string, so a `charset` spelling difference between `@fastify/send` and the plugin's own `getContentType` is not a failure. (4) Chrome on Android's real header, `gzip, deflate, br, zstd`, is the br case.

- [ ] **Step 0: Base, claims, the installed plugin.** Run (single quotes where the text holds backticks):

```bash
git grep -qF "    cacheControl: false," HEAD -- server/src/pwaStatic.ts \
  && git grep -qF "reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);" HEAD -- server/src/pwaStatic.ts \
  && ! git grep -qF "preCompressed" HEAD -- server/src \
  && git grep -qF "await app.register(fastifyStatic, pwaStaticOptions(pwaRoot));" HEAD -- server/src/server.ts \
  && git grep -qF "app.setNotFoundHandler((_req, reply) => reply.type('text/html').sendFile('index.html'));" HEAD -- server/test/pwa-static-cache.test.ts \
  && git grep -qF '// content-hashed `/assets/*` files are cached, as `immutable`.' HEAD -- server/test/pwa-static-cache.test.ts \
  && git grep -qF '"@fastify/static": "^10.1.8",' HEAD -- server/package.json \
  && grep -qF '"version": "10.' server/node_modules/@fastify/static/package.json \
  && grep -qF 'preCompressed' server/node_modules/@fastify/static/README.md \
  && grep -qF 'Vary: Accept-Encoding' server/node_modules/@fastify/static/README.md \
  && git grep -qF 'and `reverse_proxy 127.0.0.1:<CCRC_PORT>`, nothing else. Stock Caddy' HEAD -- README.md \
  && echo T3-BASE-OK
grep -qF 'setHeaders?.(reply, metadata.path, metadata.stat)' server/node_modules/@fastify/static/index.js \
  && echo T3-COPY-PATH || echo T3-COPY-PATH-UNREAD
```

  Expected: `T3-BASE-OK`, then `T3-COPY-PATH`. The second check re-derives FLC-T3-M2's prediction rather than stopping the task. On `T3-COPY-PATH-UNREAD`, read the installed `pumpSendToReply`, say in the SDD ledger which path `setHeaders` receives for a copy, and report it to the coordinator before running FLC-T3-M2. Confirm the claims on the three files. Before any edit, run `( cd server && ./node_modules/.bin/vitest run test/pwa-static-cache.test.ts )` and, after `git fetch -q origin main`, Step 6's guard files once through `ccrc test` (`test/rings/fastify-l4.test.ts`, `test/auth-gate.test.ts`, `test/ccrc-versioned-audit.test.ts`, `test/ccrc-settings-census.test.ts`, `test/topology-clean.test.ts`, each alone), and record each file's count at BASE (`pwa-static-cache.test.ts`: `Tests  6 passed (6)`, a prediction; the guards as printed). Step 6 compares against these numbers.
- [ ] **Step 1: Write the failing test.** In `server/test/pwa-static-cache.test.ts`:
  Find:
```ts
// content-hashed `/assets/*` files are cached, as `immutable`.
```
  Replace:
```ts
// content-hashed `/assets/*` files are cached, as `immutable`.
//
// The first-load compression plan (2026-11-03, Task 3): the build writes a Brotli (`<file>.br`) and a gzip
// (`<file>.gz`) copy beside each script, stylesheet and SVG under assets/, and `pwaStaticOptions` turns on
// @fastify/static's `preCompressed`, so a browser gets the copy its Accept-Encoding takes, with the file's own type
// and cache policy, and every file answer varies on Accept-Encoding. The shell has no copy and is sent as it is.
```
  Find: `import { readFileSync } from 'node:fs';`
  Replace:
```ts
import { readFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
```
  Find: `const here = path.dirname(fileURLToPath(import.meta.url));`
  Replace:
```ts
const here = path.dirname(fileURLToPath(import.meta.url));

// The copies a build writes (`pwa/build/compressAssets.ts`), made here with node:zlib: a script with both, a stylesheet
// with its .gz only (the build leaves out a copy that is not smaller, each encoding alone), and the tiny script below
// with none.
const APP = 'assets/app-EfGh5678.js';
const STYLE = 'assets/style-IjKl9012.css';
const appBytes = Buffer.from(Array.from({ length: 400 }, (_, i) => `export const value${i % 37}=${i};`).join(''));
const styleBytes = Buffer.from(Array.from({ length: 300 }, (_, i) => `.row-${i % 23}{padding:${i % 7}px}`).join(''));
```
  Find:
```ts
  writeFileSync(path.join(root, 'assets', 'index-AbCd1234.js'), 'console.log(1)');
  // The release tarball's mtime, as measured: 0 on every file.
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AbCd1234.js']) {
```
  Replace:
```ts
  writeFileSync(path.join(root, 'assets', 'index-AbCd1234.js'), 'console.log(1)');
  writeFileSync(path.join(root, APP), appBytes);
  writeFileSync(path.join(root, `${APP}.br`), brotliCompressSync(appBytes));
  writeFileSync(path.join(root, `${APP}.gz`), gzipSync(appBytes));
  writeFileSync(path.join(root, STYLE), styleBytes);
  writeFileSync(path.join(root, `${STYLE}.gz`), gzipSync(styleBytes));
  // The release tarball's mtime, as measured: 0 on every file.
  for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AbCd1234.js',
    APP, `${APP}.br`, `${APP}.gz`, STYLE, `${STYLE}.gz`]) {
```
  Then append at the end of the file:

```ts
// The first-load compression plan (2026-11-03, Task 3). A file is answered with `<file>.br` when the request's
// Accept-Encoding takes br, else `<file>.gz` when it takes gzip, else the file itself. Chrome on Android sends
// `gzip, deflate, br, zstd`.
describe('the hashed /assets/* files are sent precompressed, chosen by Accept-Encoding', () => {
  const CHROME = 'gzip, deflate, br, zstd';
  const get = (url: string, acceptEncoding?: string) => app.inject({
    method: 'GET', url, headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  });
  const variesOnEncoding = (vary: unknown): boolean =>
    String(vary ?? '').toLowerCase().split(',').map((t) => t.trim()).includes('accept-encoding');
  const mediaType = (type: unknown): string => String(type ?? '').split(';')[0]!.trim().toLowerCase();

  it('pwaStaticOptions turns on preCompressed', () => {
    expect(pwaStaticOptions(root).preCompressed).toBe(true);
  });

  it('a browser that takes br gets the .br: br, varying on Accept-Encoding, the asset cache and type, bytes that decode to the asset', async () => {
    const plain = await get(`/${APP}`);
    expect(mediaType(plain.headers['content-type'])).toMatch(/javascript/);
    for (const ae of [CHROME, 'br']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, ae).toBe(200);
      expect(res.headers['content-encoding'], ae).toBe('br');
      expect(variesOnEncoding(res.headers['vary']), ae).toBe(true);
      expect(res.headers['cache-control'], ae).toBe(PWA_ASSET_CACHE);
      expect(mediaType(res.headers['content-type']), ae).toBe(mediaType(plain.headers['content-type']));
      expect(res.rawPayload.equals(readFileSync(path.join(root, `${APP}.br`))), ae).toBe(true);
      expect(brotliDecompressSync(res.rawPayload).equals(appBytes), ae).toBe(true);
    }
  });

  it('a browser that takes gzip and not br gets the .gz', async () => {
    for (const ae of ['gzip, deflate', 'gzip']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, ae).toBe(200);
      expect(res.headers['content-encoding'], ae).toBe('gzip');
      expect(variesOnEncoding(res.headers['vary']), ae).toBe(true);
      expect(res.headers['cache-control'], ae).toBe(PWA_ASSET_CACHE);
      expect(gunzipSync(res.rawPayload).equals(appBytes), ae).toBe(true);
    }
  });

  it('a browser that takes neither gets the file itself, still immutable and still varying on Accept-Encoding', async () => {
    for (const ae of [undefined, 'identity', 'zstd']) {
      const res = await get(`/${APP}`, ae);
      expect(res.statusCode, String(ae)).toBe(200);
      expect(res.headers['content-encoding'], String(ae)).toBeUndefined();
      expect(variesOnEncoding(res.headers['vary']), String(ae)).toBe(true);
      expect(res.headers['cache-control'], String(ae)).toBe(PWA_ASSET_CACHE);
      expect(res.rawPayload.equals(appBytes), String(ae)).toBe(true);
    }
  });

  it('a copy the build left out is skipped: br falls back to the .gz, and a file with no copy is sent as itself', async () => {
    const style = await get(`/${STYLE}`, CHROME);
    expect(style.headers['content-encoding']).toBe('gzip');
    expect(style.headers['cache-control']).toBe(PWA_ASSET_CACHE);
    expect(gunzipSync(style.rawPayload).equals(styleBytes)).toBe(true);
    const tiny = await get('/assets/index-AbCd1234.js', CHROME);
    expect(tiny.headers['content-encoding']).toBeUndefined();
    expect(tiny.headers['cache-control']).toBe(PWA_ASSET_CACHE);
    expect(tiny.body).toBe('console.log(1)');
  });

  it('no shell answer is compressed: /, index.html, a Docs page and another route through the fallback, sw.js, the manifest', async () => {
    const shell = '<!doctype html><title>fixture</title>';
    const cases: [string, string][] = [
      ['/', shell], ['/index.html', shell], ['/docs/demo/specs/a.md', shell], ['/s/project-a', shell],
      ['/sw.js', 'self.__WB_MANIFEST = [];'], ['/manifest.webmanifest', '{}'],
    ];
    for (const [url, body] of cases) {
      const res = await get(url, CHROME);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-encoding'], url).toBeUndefined();
      expect(res.headers['cache-control'], url).toBe(PWA_SHELL_CACHE);
      expect(res.body, url).toBe(body);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `( cd server && ./node_modules/.bin/vitest run test/pwa-static-cache.test.ts )` — Expected (prediction): `Tests  5 failed | 7 passed (12)`: the first five new cases (`preCompressed` undefined; no `content-encoding` for br, for gzip and for the stylesheet's `.gz`; no `vary` on the identity answer); the six cases at BASE and the shell case green.
- [ ] **Step 3: Turn it on.** In `server/src/pwaStatic.ts`:
  Find:
```ts
 * So no validator is sent; the shell files are `no-cache` and always answered in full (they are
 * small), and only the content-hashed assets are cached.
 */
```
  Replace:
```ts
 * So no validator is sent; the shell files are `no-cache` and always answered in full (they are
 * small), and only the content-hashed assets are cached.
 *
 * The build writes a Brotli (`<file>.br`) and a gzip (`<file>.gz`) copy beside each script,
 * stylesheet and SVG under `assets/` (`pwa/build/compressAssets.ts`), and `preCompressed` sends the
 * one the request's Accept-Encoding takes: br, else gzip, else the file itself. @fastify/static then
 * sets Content-Encoding and the file's own Content-Type, and adds `Vary: Accept-Encoding` to every
 * file it answers, the uncompressed fallback included. `setHeaders` is handed the path it sent,
 * which for a copy is under `assets/` too, so a copy keeps its file's cache policy. The shell has no
 * copies, so it is always sent as it is. Only these public, content-hashed files are compressed:
 * nothing that carries a secret or a request's input is (the first-load compression plan of
 * 2026-11-03, refinement (f)).
 */
```
  Find: `    cacheControl: false,`
  Replace:
```ts
    cacheControl: false,
    preCompressed: true,
```
- [ ] **Step 4: Run it to see it pass.** `( cd server && ./node_modules/.bin/vitest run test/pwa-static-cache.test.ts )` — Expected (prediction): `Tests  12 passed (12)`.
- [ ] **Step 5: The README sentence.** In `README.md`, in the `~/.ccrc/Caddyfile` bullet:
  Find:
```md
  chosen `bind` if any, and `reverse_proxy 127.0.0.1:<CCRC_PORT>`, nothing else. Stock Caddy's automatic
```
  Replace:
```md
  chosen `bind` if any, and `reverse_proxy 127.0.0.1:<CCRC_PORT>`, nothing else. It needs no `encode` line: the
  PWA's build writes a Brotli and a gzip copy beside each script and stylesheet under `/assets/`, and the server
  sends whichever the browser's `Accept-Encoding` takes. Stock Caddy's automatic
```
- [ ] **Step 6: Guards.** `SERVER-TSC-OK`. `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/rings/fastify-l4.test.ts test/auth-gate.test.ts test/ccrc-versioned-audit.test.ts test/ccrc-settings-census.test.ts test/topology-clean.test.ts )` through `ccrc test` — green, each count unchanged from BASE.
- [ ] **Step 7: Commit.** `git add server/src/pwaStatic.ts server/test/pwa-static-cache.test.ts README.md` (expect 3), message `server: send the PWA's precompressed assets by Accept-Encoding (docs first-load compression)`, trailer. Record the task's JSON row fence, as measured, in the SDD ledger.

**Mutation rows this task contributes** (pkg `server`, file `src/pwaStatic.ts`, tests `test/pwa-static-cache.test.ts`):

| id | spec | old → new | expected red (prediction) |
|---|---|---|---|
| FLC-T3-M1 | (e) | `preCompressed: true,` → removed | 5 failed — `'pwaStaticOptions turns on preCompressed'`, `'a browser that takes br gets the .br …'`, `'a browser that takes gzip and not br gets the .gz'`, `'a browser that takes neither gets the file itself …'` (no `vary`), `'a copy the build left out is skipped …'` |
| FLC-T3-M2 | (e) | `reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);` → `reply.header('cache-control', file.startsWith(assets) && !/\.(?:br|gz)$/.test(file) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);` | 3 failed — the br case, the gzip case and the skip case (each copy then answers `no-cache`). Rests on `T3-COPY-PATH` (Step 0) |

```json
[
  {"id": "FLC-T3-M1", "spec": "(e)", "pkg": "server", "file": "src/pwaStatic.ts", "old": "preCompressed: true,", "new": "", "tests": ["test/pwa-static-cache.test.ts"], "red": "5 failed: pwaStaticOptions turns on preCompressed; a browser that takes br gets the .br; a browser that takes gzip and not br gets the .gz; a browser that takes neither gets the file itself; a copy the build left out is skipped"},
  {"id": "FLC-T3-M2", "spec": "(e)", "pkg": "server", "file": "src/pwaStatic.ts", "old": "reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);", "new": "reply.header('cache-control', file.startsWith(assets) && !/\\.(?:br|gz)$/.test(file) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);", "tests": ["test/pwa-static-cache.test.ts"], "red": "3 failed: a browser that takes br gets the .br; a browser that takes gzip and not br gets the .gz; a copy the build left out is skipped"}
]
```

`Vary` on the identity answer is `@fastify/static`'s own; no row mutates `node_modules`. The identity case pins it against an upgrade, and FLC-T3-M1 reds it.

**Verify:** `test/pwa-static-cache.test.ts` 12 passed; `SERVER-TSC-OK`; the guards unchanged.

### Task 4: Close — review, suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus); review lenses as "How this wave runs" names them; `sonnet` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Two `opus` lenses over `BASE..HEAD` against this plan: (1) what the server sends (Task 3, refinements (e) and (f)); (2) what the build writes and ships (Tasks 1 and 2, refinements (a) to (d), (g) to (i)). One `sonnet` lens: the tests and rows, the censuses, the measurement, and the public-repo scan of every changed file. Each finding gets a `sonnet` refute pass; confirmed findings are fixed one commit each, each with a test or a row that goes red without the fix. A fix that moves a row's measured red restates that row (it takes no number).
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit:
  - the `pwa` suite in pieces, and `TSC-OK`; the three built-output files each alone, with Task 2 Step 0's two commands (`final-<f>.json`). For each of the three, record its count, `Duration` and **build time** (the `beforeAll` build child: the file's span less its cases' time) beside Task 2 Step 0's BASE values and Step 4's;
  - one browser file locally, to show the browser leg's one build still builds and serves with the plugin in place: `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/reader-frame.browser.test.ts )`; record its global setup's `browser leg: built the PWA once in <n> ms` line (`pwa/browser/dist.ts#buildDist`, whose child has the same `timeout: 170_000`). A fast PR skips `browser (pwa)`, which first runs in the merge queue;
  - **the ruling's bounds, here** (refinement (c)): each built-output file's build time, and the browser leg's build, at most 120 s (the build child's total, under the 170 s timeout); each built-output file's build time less its BASE build time (Task 2 Step 0; the step's own cost, overstated if this run is the more loaded, which is the safe side) at most 45 s. At quality 11, a broken bound is refinement (c)'s switch to 9, then Task 2 Step 6 and these three files again, both runs recorded, before Step 3; at quality 9, a stop-and-ask to the coordinator;
  - `git fetch -q origin main`, then the WHOLE `server` suite in pieces (not a list: the PR's CI selection runs suites a list misses), `typecheck-tests` alone, `SERVER-TSC-OK`; a red census in a file outside this wave's Scope is a stop-and-ask, never a silent edit;
  - re-run any known load flake alone before calling it broken.
- [ ] **Step 3: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 4: Define the deviations, if any.** If a departure was found while executing, replace `## Deviations found`'s placeholder with the issued numbers in the order found (entry form: `- **D-<n> (<date>)** — <slug>. <what departs from which sentence, and why>. <Task and rows that apply it>.`), and write the unused ones without their prefix; if none, write "None. Issued and unused: <first> to <last>." without the prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green (the guard reads tracked files only).
- [ ] **Step 5: Draft `## Results`** in this plan in the working tree: the counts per suite; every task's JSON row fence as measured; the Brotli quality the branch ships (11, or 9 after the switch); Task 2 Step 6's measurement (`rc`, `wall`, the `precompress:` line, `built in`, the build child's total, the size table and totals), at 11 and, after a switch, at 9 too; the three built-output files' counts, durations and build times at BASE, after Task 2 and at the end, and the browser leg's build time, each against the ruling's bounds; the switch, if made, and which bound made it; "Named, without a number" (choices that filled a silence while executing); "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-03-native-docs-reader-first-load-compression/pr-body.md` (gitignored): title `PWA: send the hashed assets precompressed (Brotli and gzip)`; what ships; the Brotli quality used, and the switch with both measurements if one was made; the measured sizes and build times against the ruling's bounds; refinement (f) in one plain sentence; the expected CI (the PR's selection; `test (pwa)` in full with its three built-output files each longer by the step; no full-run trigger, since no manifest, lock, tsconfig or workflow changes; `browser (pwa)` gates in the merge queue); the post-rollout check from "How this wave runs"; this plan's GitHub `blob/main` link; ending with the attribution line the dispatch gives.
- [ ] **Step 6: Public-repo scan, before the commit that becomes the `handoffCommit`.** Scan every file changed since BASE as it stands in the working tree (`git diff --name-only <BASE>` plus the uncommitted plan) and the drafted PR body with the scan the dispatch names: rc 0, zero hits. A hit is fixed and the scan re-run before Step 7. Remove `$HOME/.cc-tmp/flc-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: first-load compression's results (docs first-load compression)`, trailer. This commit is the `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file` from the SDD directory).
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), list mail, then send the wave-done.

## Deviations found

None. Issued and unused: 7903 to 7905.

## Where things stand

### Agreed
- The coordinator's ruling of 2026-11-03 on the operator's phone check: the PWA's assets are compressed at build time and the server sends the precompressed files; no Caddy or `ccrc expose` change, no runtime compression, no new npm dependency.
- The coordinator's ruling of 2026-11-03 on Brotli's quality (refinement (c)): quality 11 when, measured under `ccrc test`, the step stays at or under 45 s and the build child's total at or under 120 s (well under the 170 s child timeout), both in Task 2 Step 6's measurement and in Task 4 Step 2's run of the pwa suite; otherwise the worker switches to quality 9 (the one constant `BROTLI_QUALITY`), re-measures, records both measurements and the switch in `## Results` and the PR body, and goes on. Only if quality 9 also breaks either bound does the worker stop and ask the coordinator.
- From the base, not a choice: the copies land in `server/dist-pwa/assets/` and ship in the release tarball with no change to `deploy/`, `install.sh` or `ccd/`.
- The operator's approval of 2026-11-03, with Q1 answered by its recommendation: only the hashed `assets/` files (`.js`, `.css`, `.svg`) get copies; the shell stays as it is.

### Waiting on you
- Nothing before dispatch.

### Answered by the operator (2026-11-03)
- The plan was approved, and the question answered with its recommendation ("Approve both with every recommendation", given on the console). The question as asked:
  - **Q1, the scope (refinement (b)).** Recommended: only the hashed `assets/` files (`.js`, `.css`, `.svg`). The alternative adds the shell (`index.html`, `sw.js`, the workbox runtime): a few kilobytes per navigation and per update check, against copies whose names do not change from release to release, so a stale copy could serve an old shell.

### Later
- After rollout: the operator re-opens a Docs page on the phone and checks `content-encoding: br` on `/assets/*` through the real front (the prediction that Caddy's `reverse_proxy` passes the encoding through is checked there).
- zstd: Chrome sends `zstd`, and `@fastify/static` 10 negotiates br, gzip and deflate only.
- `/api/docs/*` file answers stay uncompressed; compressing them needs its own argument (they are authenticated and may carry drafts and a request's path).
- The entry script, at about 1962 KB, is close to workbox's 2 MiB precache ceiling, which is measured on the uncompressed file: the ceiling that made the Mermaid chunk leave the precache would fail the build for the entry too.

## Results

Measured by the worker of run 1400 on 2026-11-03, every run through `ccrc test`. The branch ships **Brotli quality 11**: no bound broke, so refinement (c)'s switch was not made.

### Commits

| Task | Commit | What |
|---|---|---|
| 1 | `4f6388a53` | `pwa/build/compressAssets.ts` and `pwa/test/compress-assets.test.ts` |
| 2 | `0e67a7898` | `precompressAssets` in `pwa/vite.config.ts`; three cases in `pwa/test/reader-built.test.ts` |
| 3 | `7e38ce131` | `preCompressed: true` in `server/src/pwaStatic.ts`; six cases in `server/test/pwa-static-cache.test.ts`; the README sentence |
| 4 | `872819a39` | `## Deviations found`: none, the issued block unused |

Each task had its own reviewer (sonnet on Tasks 1 and 2, opus on Task 3), and each came back clean. Task 4's held-out pass (two opus lenses, what the server sends and what the build writes, and one sonnet lens, the tests, censuses and scan) found no Critical or Important finding, so no fix commit was made and no refute pass was needed.

### Counts

| Suite | Result |
|---|---|
| `pwa/test/compress-assets.test.ts` | RED: failed to load; GREEN: 8 passed (8) |
| `pwa/test/reader-built.test.ts` | BASE 6 passed; RED 2 failed, 7 passed (9); GREEN 9 passed (9) |
| `server/test/pwa-static-cache.test.ts` | BASE 6 passed; RED 5 failed, 7 passed (12); GREEN 12 passed (12); after fix round 1's two cases, 14 passed (14) |
| pwa, the other 412 files, in four pieces | 12 600 passed, 3 skipped, 0 failed |
| `fonts-built`, `markdown-worker-built` (end state) | 4 passed, 9 passed (unchanged from BASE) |
| the config's readers (`browser-leg`, `sw-denylist`, `markdown-runner`, `shadcn-alias`) | 109 passed |
| pwa typecheck | `TSC-OK`; `pwa/build/compressAssets.ts` in the program (`--listFilesOnly`: 1) |
| server guards at BASE and after Task 3 | `rings/fastify-l4` 5, `auth-gate` 249, `ccrc-versioned-audit` 10, `ccrc-settings-census` 22, `topology-clean` 60 (each unchanged) |
| `ci-reach-census`, `docs-parity`, `citations`, `contrast` | green |
| server typecheck | `SERVER-TSC-OK` |
| browser: `browser/reader-frame.browser.test.ts`, locally | 24 passed (24); `browser leg: built the PWA once in 8097 ms` |
| server, the whole suite (1304 files) in pieces of 70 and then 35 | 67 942 passed, 192 skipped, 47 failed in 19 files (5 green when run alone, 14 red alone), every one outside this wave's Scope (below) |
| `deviation-refs`, `dtbd` (after the Deviations commit) | 32 passed (32) |
| `typecheck-tests`, alone | 12 passed (12), once `agent/` had its modules |

The 19 server files that failed in the whole run were each run again alone. They test areas this wave does not touch. Five were green alone:
- `asks-sweep`
- `collect-lane-route`
- `mail-inbox-store`
- `session-hook-approval-deny`
- `typecheck-tests`, which had failed only because `agent/` had no modules in this workspace until it was installed.

Fourteen were red alone too. Each one fails on this box's environment or on a timing bound under the test slice's CPU limits:

| File | Why it fails here |
|---|---|
| `ccd-docs-fetch` | 4 cases: `fetch-failed` where `ref-locked` is expected, against this box's git 2.53. |
| `ccd-tool-adj` | 1 case: this session's own shell already runs at `oom_score_adj` 800. |
| `ccrc-test-wrapper` | 16 cases: they test `ccrc test` from inside its own slice. |
| `ccrc-containment` | 1 case. |
| `child-reclaim-paused-at-server` | 1 case: a NUL-leading `claimedBy` round-trip on this box's Node 24. |
| `delegation-recovery` | 2 cases: 20 s timeouts. |
| `platform-hazards` R14(i) | This box's bash 5.3. |
| `retire-executors-pin` | 5 cases alone: timeouts, plus two timing-shaped assertions in the reclaim executors. This file imports `buildServer`, so the pull request's CI selects it. |
| `secret-mask` | A 250 ms frame bound, measured at 396 ms. |
| `shadow-journal`, `update-store-nodes` | 20 s timeouts. |
| `testbox-box-package`, `testbox-wrapper`, `tmp-sweep` | This box's file modes, test-box routing and live processes. |

The pull request's CI on its own runners is the arbiter for each of them.

The browser file ran with `CCRC_CHROME` set to the box's Playwright Chromium, because `resolveChrome()` threw without it (no `/usr/bin/google-chrome` on this box). A fast pull request skips `browser (pwa)`, which first runs in the merge queue.

### Task 2 Step 6: one real build

Measured at quality 11, into a temporary directory removed afterwards (`OUT-GONE`): `rc=0`, `wall=19 s`; `precompress: 13 files under assets/, 26 copies written, 13163 ms`; Vite's `built in 15.78s`. The build child's total, summed as the plan asks, is 15.78 + 13.16 = 28.9 s. Vite logs `built in` after `writeBundle` returns, so the sum counts the step twice; the build child itself took about 16 s.

| File | Bytes | `.br` | `.gz` |
|---|---|---|---|
| `mermaid.frame-*.js` | 3 770 403 | 764 977 | 1 040 720 |
| `index-*.js` (the entry) | 2 037 731 | 508 489 | 615 644 |
| `reader-*.js` | 548 493 | 329 979 | 337 601 |
| `index-*.css` | 276 428 | 38 429 | 47 209 |
| `readerRenderJob-*.js` | 250 915 | 78 532 | 94 189 |
| `enhance-*.js` | 196 061 | 57 658 | 66 653 |
| `markdownWorker-*.js` | 158 372 | 42 680 | 49 745 |
| `markdownHighlightWorker-*.js` | 78 931 | 23 421 | 26 397 |
| `bridge-*.js` | 42 846 | 13 942 | 15 808 |
| `bootstrap-*.js` | 27 765 | 9 400 | 10 358 |
| **all scripts and stylesheets** | **7 397 794** | **1 870 694** | **2 307 989** |

The entry script goes from 2 037 731 bytes (1.94 MiB) to 508 489 bytes (497 KiB) as Brotli, and the Mermaid chunk from 3 770 403 bytes (3.60 MiB) to 764 977 bytes (747 KiB).

### The built-output files' build times, against the ruling's bounds

Build time is the file's vitest `Duration` times its `tests` share, less its cases' time. The plan's "span less cases" reads about 0 ms here, because vitest 5's JSON report starts a file's span after `beforeAll`. The step's own cost is the plugin's log line in Task 2 Step 6 (`precompress: ... 13163 ms`, 13.2 s, against the 45 s bound). The "End state less BASE" column is the difference between two runs of each file under different fleet load (2.3 to 5.2 s), not a measure of the step, which is why it differs between files that run the same build.

| File | BASE | After Task 2 (implementer's run) | End state | End state less BASE (two runs, different load) |
|---|---|---|---|---|
| `reader-built` | Duration 5.89 s, build ≈ 3.9 s | Duration 22.42 s | Duration 8.98 s, build ≈ 8.5 s | ≈ 4.6 s |
| `fonts-built` | Duration 3.76 s, build ≈ 3.0 s | Duration 20.08 s | Duration 8.64 s, build ≈ 8.2 s | ≈ 5.2 s |
| `markdown-worker-built` | Duration 7.88 s, build ≈ 6.2 s | Duration 14.46 s | Duration 9.25 s, build ≈ 8.5 s | ≈ 2.3 s |
| browser leg `buildDist` | — | — | 8097 ms | — |

Every build is at most 120 s (the largest, 28.9 s, is Step 6's double-counted sum), and the step's own cost (13.2 s, the plugin's log line) is at most 45 s. The Duration after Task 2 was measured under heavier fleet load than either the BASE or the end-state run.

### Mutation table

Measured at the end state, in the workspace, one row at a time. Each row was restored from saved bytes with a sha256 check, and `git status --porcelain` was unchanged after each.

| id | measured red | prediction |
|---|---|---|
| FLC-T1-M1 | 1 failed | as predicted |
| FLC-T1-M2 | 1 failed | as predicted |
| FLC-T1-M3 | 1 failed | as predicted |
| FLC-T1-M4 | 6 failed | **one more than predicted**: `running it twice changes nothing` also reds. Under the mutant, the file holds its Brotli bytes after the first pass, and a second pass encodes those smaller again with both encoders, so the file and its `.gz` change. |
| FLC-T2-M1 | 2 failed | as predicted |
| FLC-T2-M2 | 2 failed | as predicted (the copies were on disk when the service worker was generated) |
| FLC-T2-M3 | 1 failed | as predicted |
| FLC-T3-M1 | 5 failed; 7 after fix round 1 | as predicted at Task 3; the fix round's two cases (q-value order, a refused coding) red too |
| FLC-T3-M2 | 3 failed; 4 after fix round 1 | as predicted at Task 3; the fix round's q-value case asserts a copy's cache policy too |

```json
[
  {"id": "FLC-T1-M1", "spec": "(d)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "if (copy.byteLength >= original) return { kind: 'not-smaller', bytes: copy.byteLength };", "new": "", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: writes no copy that is not smaller than its file, deciding each encoding alone"},
  {"id": "FLC-T1-M2", "spec": "(b)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg'];", "new": "export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg', '.html'];", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: leaves every other file alone"},
  {"id": "FLC-T1-M3", "spec": "(c)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "export const BROTLI_QUALITY = 11;", "new": "export const BROTLI_QUALITY = 5;", "tests": ["test/compress-assets.test.ts"], "red": "1 failed: the .br is Brotli at BROTLI_QUALITY, a ruled value"},
  {"id": "FLC-T1-M4", "spec": "(b)", "pkg": "pwa", "file": "build/compressAssets.ts", "old": "br: writeIfSmaller(`${file}.br`, br, bytes.byteLength),", "new": "br: writeIfSmaller(file, br, bytes.byteLength),", "tests": ["test/compress-assets.test.ts"], "red": "6 failed: writes a .br and a .gz beside; changes no name and no byte; writes no copy that is not smaller; reaches a file in a directory below; the .br is Brotli at BROTLI_QUALITY, a ruled value; running it twice changes nothing"},
  {"id": "FLC-T2-M1", "spec": "(a)", "pkg": "pwa", "file": "vite.config.ts", "old": "precompressAssets(),", "new": "", "tests": ["test/reader-built.test.ts"], "red": "2 failed: the entry script, its stylesheet and the Mermaid chunk each have a .br and a .gz; every copy sits beside"},
  {"id": "FLC-T2-M2", "spec": "(g)", "pkg": "pwa", "file": "vite.config.ts", "old": "globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],", "new": "globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2,br,gz}'],", "tests": ["test/reader-built.test.ts"], "red": "2 failed: the service worker precaches no copy; sw.js precaches no file that carries the Mermaid asset"},
  {"id": "FLC-T2-M3", "spec": "(b)", "pkg": "pwa", "file": "vite.config.ts", "old": "const files = compressAssets(path.join(output.dir, assetsDir));", "new": "const files = compressAssets(output.dir);", "tests": ["test/reader-built.test.ts"], "red": "1 failed: every copy sits beside the script, stylesheet or SVG it encodes, under assets/ only; one of 1 KiB or more has both"},
  {"id": "FLC-T3-M1", "spec": "(e)", "pkg": "server", "file": "src/pwaStatic.ts", "old": "preCompressed: true,", "new": "", "tests": ["test/pwa-static-cache.test.ts"], "red": "7 failed: pwaStaticOptions turns on preCompressed; a browser that takes br gets the .br; a browser that takes gzip and not br gets the .gz; a browser that takes neither gets the file itself; a copy the build left out is skipped; q-values order the codings; a refused coding is never sent"},
  {"id": "FLC-T3-M2", "spec": "(e)", "pkg": "server", "file": "src/pwaStatic.ts", "old": "reply.header('cache-control', file.startsWith(assets) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);", "new": "reply.header('cache-control', file.startsWith(assets) && !/\\.(?:br|gz)$/.test(file) ? PWA_ASSET_CACHE : PWA_SHELL_CACHE);", "tests": ["test/pwa-static-cache.test.ts"], "red": "4 failed: a browser that takes br gets the .br; a browser that takes gzip and not br gets the .gz; a copy the build left out is skipped; q-values order the codings"}
]
```

### Fix round 1 (review 1411)

- F1: Brotli's mode and size hint are tuning, unguarded by design; no mutation row.
- F2: the server comment says how @fastify/static negotiates, the README sentence covers SVGs, two q-value cases are pinned.
- F3: build-side only, by the coordinator's ruling (ask 302). Measured: with `preCompressed` on, `@fastify/static` 10.1.8 sends `index.html.br` or `sw.js.br` as Brotli for `/`, `/index.html`, the SPA fallback and `/sw.js` whenever such a copy exists. So the guarantee that no shell answer is compressed rests on the build alone: the `assets/`-only scope (FLC-T1-M2, FLC-T2-M3) and `emptyOutDir`, which clears every old copy; any future change that writes a shell copy must add a server guard first. The server case is renamed to what it proves, and no test pins that a shell copy is sent.
- F4: refinement (h) states the floating release Node and the 4.2 MB.
- F5: Results counts, units and the build-time reading corrected.
- The re-review of the fix range found every item addressed. Its wording minor on the server comment (a missing copy falls through to the next accepted coding before the file) is fixed in its own commit.

Measured after the fix round, each through `ccrc test`:
- pwa: `TSC-OK`; `compress-assets` 8 passed; `contrast` 314 passed, alone; the other 412 files in four pieces, 12 600 passed and 3 skipped; `reader-built` 9, `fonts-built` 4 and `markdown-worker-built` 9 passed, each alone, with Durations of 10.44 s, 10.22 s and 10.30 s.
- browser: `browser/reader-frame.browser.test.ts`, 24 passed, with `browser leg: built the PWA once in 13217 ms`.
- server: `SERVER-TSC-OK`; `pwa-static-cache` 14, `auth-gate` 249, `rings/fastify-l4` 5, `ccrc-versioned-audit` 10, `ccrc-settings-census` 22 and `topology-clean` 60 passed, each alone; `ci-reach-census`, `docs-parity`, `deviation-refs`, `dtbd`, `citations`, `anchors` and `typecheck-tests` passed, 141 cases.
- Task 3's two rows again, in place, sha-restored: FLC-T3-M1 red 7 and FLC-T3-M2 red 4 (the table and fence above restate them). The other seven rows' files did not change.

### Fix round 2 (review 1414)

- F1 and F2: two stale bullets under "Carried, not fixed" are corrected. The q-value bullet now keeps only the unpinned `*`-as-gzip remark, and the README and comment wording bullet is deleted, because round 1's F2 closed it.
- A1: the header comment of the server test's precompression describe now states the negotiation as `pwaStatic.ts` does: the highest q-value wins, the server's own order breaks ties, and a missing copy falls through to the next accepted coding and then to the file.
- A2: the q-value case now sends `br;q=0.5, gzip;q=1` and expects gzip. In that order it reds both wrong behaviours: a negotiator that takes the first listed coding, and one that ranks by its own order and ignores q. This amends round 1's ruling.
- A3: "below" corrected to "above" in round 1's measured list.
- Not this wave, by the coordinator's ruling: a test that pins `emptyOutDir` on the real config goes on the ledger's Later list. The exact-bytes case's title stays as it is.

Measured after fix round 2, each alone and through `ccrc test`:
- server: `SERVER-TSC-OK`. Passed: `pwa-static-cache` 14, `auth-gate` 249, `rings/fastify-l4` 5, `deviation-refs` 31 (after `git fetch -q origin main`, re-run after this round's commit), `dtbd` 1, `citations` 4, `anchors` 9, `docs-parity` 71 and `ci-reach-census` 13.
- Task 3's two rows, in place and sha-restored: FLC-T3-M1 red 7 and FLC-T3-M2 red 4, both unchanged. Each now includes the reordered q-value case.
- No pwa suite or browser run, because this round changes no pwa file. The two pwa files that read plan Markdown, `plain-words` and `markdown-parse`, passed 104 cases.
### Named, without a number

- **Every build ran with `CCRC_SW_DENYLIST` unset.** The brief asked subagents to set "a `CCRC_SW_DENYLIST` covering /docs", but `swDenylist` throws on an entry that covers `/docs`. Unset gives the default list, which is what the hermetic tests use too.
- **How build time is read.** The plan's "span less cases" formula reads about 0 ms under vitest 5, so build time is `Duration` times its `tests` share, less the cases' time.
- **The plan's own two sections were written in this plan**, as Task 4 says (`## Deviations found`, and `## Results`). The worker skill otherwise keeps task notes in a new file, but this plan names itself in its Scope, and the plan's text governs.
- **`agent/` modules were installed in this workspace** (`npm ci`, no lock change) so that `typecheck-tests` could typecheck `agent/src`. The plan's LOW DISK list named `ui/`, `pwa/` and `server/` only.
- **`CCRC_CHROME` was set for the one browser file** to the box's Playwright Chromium, because `resolveChrome()` threw without it, as the brief allows.

### Carried, not fixed (all Minor, from the per-task and held-out reviews)

- Upstream, `@fastify/static` rewrites `*` to gzip, so `gzip;q=0, *` gets gzip. No case pins that, and no browser sends such a header.
- Brotli's `BROTLI_MODE_TEXT` and `BROTLI_PARAM_SIZE_HINT` are tuning, not guards (they change neither correctness nor safety; dropping either still writes valid Brotli that decodes to the file), so by the coordinator's ruling on review 1411 they are unguarded by design and take no mutation row; on the exact-bytes case's own fixtures the output with and without them was byte-identical (measured by the reviewer on Node 24).
- Refinement (h) now states the floating release Node and the 4.2 MB (corrected by the coordinator's ruling on review 1411); pinning the runner's Node is a Later item in the ledger, outside this wave.
- `writeBundle` runs once per output. The client build has one output, and the worker build never writes.
