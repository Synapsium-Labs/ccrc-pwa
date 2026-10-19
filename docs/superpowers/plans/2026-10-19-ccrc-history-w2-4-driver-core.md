# ccrc history W2-4: the replay driver core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship the core of the W2 replay driver, `deploy/history-replay.mjs`, in ONE PR on `main`. It is the deploy lane's W2-4 (W2 decisions document §2), dispatched now beside fleet-lane wave 5h-1 (and later 5h-2) and deploy-lane W2-3. It gives the later W2 PRs one way to run Claude Code headless and one set of refusals. It runs nothing against a store and spawns no arm with real arm values. Task by task:
- **Task 1.** The entry: `DRIVER_REASONS` (W2-D59's sixteen words, then this PR's nine: five plan-chosen, four by coordinator ruling), `DriverRefusal`, the argument grammar, the `TMUX_PANE` refusal as `main`'s first act (an empty value refuses, W2-D45), one stderr line and exit 2 for every driver word. The new test file joins the node-floor leg in the same commit (W2-D5). A scan pins that no `deploy/history-*.mjs` imports `node:sqlite` (W2-D51).
- **Task 2.** The `--out` rule (W2-D53): created 0700 under umask 077 with its marker, or reused only when it is a real directory, the caller's, mode exactly 0700, marked, and outside any git tree. The `history-replay-out` lifecycle row and the 'W2' key split (W2-D9).
- **Task 3.** Account admission from the roster before any spawn (W2-D52): `upstream`, and `generated` declaring `anthropic`, by allow-list. The launch path and config dir come from the roster, and no `.credentials.json` is ever named.
- **Task 4.** Three small pieces the spawns need: redaction of spawned text with the whole-field order (W2-D54), the stream-json reader (W2-D51), and the spend ledger under `--out` (W2-D55).
- **Task 5.** The spawn contract (W2-D50, W2-D51): the argv per mode (arm, writer, judge, box), a fresh env from the allow-list with the arm values as parameters, the explicit `PATH` with a poisoned `gh`, an empty 0700 cwd outside any git tree, and the batch runner (at most 10 jobs, at most 2 at once, resumable).
- **Task 6.** The limits stop and the spend budget (W2-D55), with a parity test against `readLimits` over the shared rollover fixtures.
- **Task 7.** The preflight mechanisms W2-5a and W2-5b wire: `codeShas()` (W2-D24), the release stamp, the wrapper sha, `--version`, `preflight` in its fixed order (W2-D56), `loadStep0a`, and the recall-off presence check by `lstatSync(recallOffPath(…))` (W2-D78(ii)).
- **Task 8.** The `step0a` subcommand end to end (W2-D57): one writer, one judge and one box-mode spawn under a required `--budget`, recorded in `<out>/step0a.json`, whose sha256 it prints.
- **Task 9.** The `probe` subcommand, a box verb and an early check only (W2-D58), and step 0b's two seam-free mechanics, the turn bound and the persistence check, as exports W2-5b wires (W2-D57).

No session, hook, unit, store or wire changes. The operator runs `step0a` on each named node only after the final W2 release is rolled out (W2 decisions document §5, step 7); that, and every other operator act, is never the worker's.

**Architecture:** One L4 operator script and its tests. Ring membership is a property of a file's imports.

*`deploy/history-replay.mjs`* (L4: it owns `fs`, `child_process`, `process` and the clock) is a standalone ES module with an R1-style entry guard as its last block. Its import block is exactly:
- `node:fs`, `node:path`, `node:os`, `node:url` and `node:child_process` (`spawn` only; never `exec`, `execSync`, `execFileSync` or `shell: true`);
- `../ccd/history/lib.mjs`: `EXIT`, `canonicalJson`, `sha256Hex`, `redactField`, `blobOverDecodeCap`, `recallOffPath`;
- `../shared/roster-json.mjs`: `rosterFromJson`, `RosterInvalid`.

It imports nothing from `server/`, nothing from `deploy/history-gate.mjs` (W2-3's, which may merge after this PR; Task 7 hashes its bytes and never loads it), and never `node:sqlite` (W2-D51: every store read in `deploy/history-*.mjs` goes through `store.mjs openReader`, and this PR opens no store at all).

Inside the one file, the decisions are pure functions over values, and the measuring functions call them. Pure: `parseArgs`, `paneRefusal`, `redactForSpawn`, `cutToolResult`, `toolResultText`, `readStreamJson`, `spendTokens`, `allowedToolSpellings`, `spawnArgv`, `spawnEnv`, `parseLimitsRow`, `decideLimits`, `decideBudget`, `preflight`, `flagsAccepted`, `turnBoundHeld`, `projectSlugOf`. Measuring or acting: `prepareOut`, `insideGitTree`, `readRoster`, `admitAccount`, `recordSpend`, `spentSoFar`, `ensurePoisonBin`, `makeRunCwd`, `launchRun`, `runBatch`, `readLimitsRow`, `batchGate`, `codeShas`, `readReleaseStamp`, `wrapperSha`, `measureClaudeVersion`, `loadStep0a`, `recallOffPresence`, `refuseRecallOff`, `persistenceLeft`, `step0bMechanics`, and the two handlers `step0aCommand` and `probeCommand`. Every refusal is a `DriverRefusal(word, detail)` whose word is in `DRIVER_REASONS`; `main` alone turns one into the stderr line `ccrc history-replay: <word>: <detail>` and `EXIT.REFUSED` (2), and any other throw into `EXIT.INTERNAL` (1).

`main(argv, env)` runs in this order: the pane refusal, `process.umask(0o077)` (Task 2), `parseArgs`, then the handler. `env` is the entry guard's by-name projection `{HOME, TMUX_PANE, LANG}`, and every env value the driver uses comes from it. Each spawning handler then refuses an unset or relative `env.HOME` (`args-invalid 'HOME is unset or not absolute'`, the same check and detail in `step0a` and `probe`), runs `prepareOut`, `readRoster` and `admitAccount`, the required `--budget`, and before every spawn the limits and budget gate, so every refusal lands before the first spawn.

*`server/test/history-replay.test.ts`* imports the module's exports for function-level cases, and drives `main` as a child process (`runDriver`: `spawnSync(process.execPath, [SCRIPT, ...args])` with a fixture `HOME`). `main` sets the process umask, so the one in-process use, Task 1's `withHandler` cases for `main`'s stderr line and exit codes, saves the worker's umask before and restores it after. Spawns reach a recording stub, a node script at `$HOME/.local/bin/<id>`, never a real Claude Code.

*`shared/lifecycle.ts`* (L0, data only) gains one row. *`.github/workflows/ci.yml`* gains one line.

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`): `node:child_process` `spawn` with argv arrays and a kill timeout on the child's own pid; `node:fs` (`lstatSync`, `statSync`, `accessSync(R_OK)`, `mkdirSync` with mode `0o700`, `mkdtempSync`, `appendFileSync`, `renameSync` for the completion marker); `node:url` (`pathToFileURL`, `fileURLToPath`).
- `ccd/history/lib.mjs` (whose only import is `node:crypto`) for `sha256Hex`, `canonicalJson`, `redactField` and `blobOverDecodeCap`.
- vitest 4 in `server/`: in-process for the exported functions, and spawned `node` for the subcommands, with fixture HOMEs, a recording stub, and the real wrapper text from `shared/wrapper.mjs`'s `generateWrapperBody`.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6. Line numbers were measured at `7d01973a2` and are hints only; re-anchor by content.
- §10.2 "Wave 2: the replay eval" (`:2616`): "**Two arms.**" (`:2658`) is the spawn contract (Launch, Environment, cwd, Flags, Tools); "**Account and budget.**" (`:2686`) is admission, the secrets rule and the limits stop.
- The pins this PR builds: RP1 (`:2740`, its contract half), RP2 (`:2741`), RP3 (`:2742`, its admission half), RP4 (`:2743`) and RP9 (`:2748`); O17 (§9.4's lifecycle rows).
- §10.2's "stops at a stated threshold" (`:2697`) is widened by erratum E18 (additive, no D-number). W2-1 amends that sentence in place; this PR never edits the spec.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`, row 6 (W2). The ledger is the coordinator's file; no task edits it.

**Authority:** the W2 decisions document (coordinator's scratch, built from spec rev 3.6). Every W2-D number below is its. Where this plan and that document differ, the document wins and the worker reports the difference.

**Base:** `main` at `7d01973a2`. Every `file:line` below was measured there; the worker re-anchors each by its quoted content on its own base. Measured anchors:
- `ccd/history/lib.mjs`: `EXIT` `:28` (`REFUSED: 2`, `INTERNAL: 1`), `REASONS` `:71`, `canonicalJson` `:454`, `sha256Hex` `:527`, `blobOverDecodeCap` `:178`, `makePairIndex` `:1747`, `redactField` `:2470`, `recallOffPath` `:3933` (it throws `TypeError` unless `idOk`);
- `shared/roster-json.mjs`: `RosterInvalid` `:221`, `rosterFromJson` `:568`; `shared/wrapper.mjs`: `generateWrapperBody` `:80`;
- `server/src/limits.ts`: `readLimits` `:394`; `server/test/fixtures/rollover.ts`: `rolloverCases` `:31`;
- `server/test/historyHelpers.ts`: `scrubbedEnv` `:54`; `server/test/tmpHelpers.ts`: `mkTmp` `:38` (realpath under `os.tmpdir()`);
- `server/test/ci-pipeline.test.ts`: the node-floor derivation `it` (`:1019-1026`, message 'the 22.16.0 leg does not run exactly the history test files'); `.github/workflows/ci.yml`: the node-floor `Test` step's heredoc, whose last listed line is `          test/history-card.test.ts` (`:933`), then `          EOF` (`:934`);
- `shared/lifecycle.ts`: the `history-card-files` row (`:97-100`), and the `history-store-id` row (`:64`) this PR never touches;
- `server/test/lifecycle.test.ts`: `HISTORY_ROWS_BY_PR` (`:1077-1084`, its `W2: [...]` line `:1082`), `HISTORY_LANDED` (`:1086`), the O17 `it` (`:1088-1102`);
- `server/test/single-definition.test.ts`: O13's `ALL_MJS` (`:5053`) and its recall-off case (`:5214`), O14's `VOCABS` (`:5228`) and `DECL_CORPUS` (`:5243`).

**PR:** One PR in the W2 deploy lane, executed in task order. It runs the FULL suite on CI, because it edits `.github/workflows/ci.yml`. Fleet-lane 5h-1 and 5h-2 and deploy-lane W2-3 run beside it; whichever of this PR and 5h-2 lands second merges `main` and keeps both lifecycle edits (W2-D3).

**PR body:** besides the usual summary, the body records these coordinator rulings under a "Choices" heading, so a reviewer reads them as rulings and not as drift:
- **Admission (ruling 4).** An account's provider is the one the roster's own reader answers. A `generated` account with no declared `provider` reads as `anthropic`, the roster's default (`shared/roster.ts` near `:123`; `rosterFromJson` defaults it the same way for its own gates), and is admitted when its secrets file passes. An `external` account with no declared provider stays refused (`kind-external`, RP3). Task 3 carries the rows and mutants.
- **Spend (ruling 3).** The spend ledger is append-only and summed over every line, never de-duplicated by name. A run killed between its ledger line and its `run.json` is spawned again on resume, and its second spend adds to the total. That over-counts, and over-counting is the safe direction for a budget: it can stop a batch early, never let it run past the budget.
- **Environment (ruling 2).** The entry guard passes `main` a by-name projection `{HOME, TMUX_PANE, LANG}` of `process.env`; nothing passes `process.env` whole and the env scan has no exemption. `LANG` reaches a child through `RunJob.lang` and `measureClaudeVersion`'s `lang` parameter.
- **The turn bound (ruling 6, as revised).** `turnBoundHeld` reports `held: true` only when the run's stream-json result event shows that the max-turns limit stopped it (`result.subtype === 'error_max_turns'`, the constant `MAX_TURNS_STOP_SUBTYPE`) AND the run made at most `MAX_TURNS` (12) assistant turns (Task 4's `assistantMessages`). A run past 12 assistant turns is `false`. A run that ended within the bound for any other reason (another subtype, or no result event) is `'unmeasured'`, never true. No tool-call count enters the verdict. The field is `subtype` on the `type: 'result'` event, the spelling Task 4's reader already reads (`result.subtype`); the value `error_max_turns` is Claude Code's headless spelling for this stop (**I**, unmeasured on this fleet). Step 0a's and the probe's streams under `--out` keep their raw result events, which measure the field's spelling (`success` there); the value is measured when step 0b's turn-bound run first reaches the bound, and its record carries the `subtype` it read. A different spelling reads `'unmeasured'`, the safe direction (Task 9).
- **An unmeasured code file (ruling).** `--allow-code-change` covers only a MEASURED change. A `gate_code` file that is absent or unreadable refuses `code-unmeasured`, a new `DRIVER_REASONS` word, with or without the flag (Task 7's `preflight`); step 0a refuses an unmeasured code sha with the same word (Task 8).
- **Step 0a's `--version` (ruling).** A `--version` that cannot be measured refuses `version-unmeasured`, a new `DRIVER_REASONS` word, through `main`'s refusal path (exit 2), never a plain `Error` (Task 8).
- **Each unmeasured preflight input has its own word (ruling, 2026-10-19).** `claude-version-moved`, `tree-moved`, `wrapper-moved` and `code-changed` name a MEASURED mismatch only. An input that cannot be measured refuses with its own word: `version-unmeasured` for a Claude Code `--version` that fails, `tree-unmeasured` (a new `DRIVER_REASONS` word) for a release stamp that cannot be read (absent, unreadable, malformed or untagged), `code-unmeasured` for a code sha, and `wrapper-unmeasured` (a new `DRIVER_REASONS` word, coordinator ruling 2026-10-19) for a generated account's wrapper that cannot be read. Task 7's `preflight` and Task 8's step 0a use the same words. `wrapperSha` refuses `wrapper-unmeasured` itself, before `preflight` is reached: `preflight`'s wrapper input is a sha or upstream's null, so a wrapper it compares was always measured.
- **A recall-off id lib refuses (ruling).** `recallOffPresence` maps `recallOffPath`'s `TypeError` for an id that fails lib's `idOk` to `input-invalid` (exit 2), never exit 1 and never absent (Task 7).
- **Step 0a's output shape (ruling).** Task 8's `Step0aOutput` is authoritative for W2-3: W2-3's open-record validator follows it. Step 0a records no `label` or `store_id`; `open --draft` (W2-5a) binds each step 0a output to its node by adding those two fields (ruling, 2026-10-19). `writer_init` and `judge_init` are always present after a complete step 0a; each is null only when its run could not run, and part 1 refuses that.
- **Accepted as written (ruling):** step 0a's box run reads the scope's "empty question" as `STEP0A_PROMPT` (the belief that print mode refuses an empty stdin stays marked unmeasured until step 0a runs); Task 1's grammar choices; Task 2's three `--out` detail folds; the integration additions (step 0a's HOME check, `launchRun`'s `TypeError` on a missing `lang` key, Task 1's `withHandler` restoring the umask); `--verbose` on every argv (a spec erratum, carried by W2-1's §10.2 amendment); and the placement of Task 2's lifecycle case.
- **Writers' additions accepted as chosen (ruling 5):** `toolResultText` (Task 4); `limits-stale ts-null` and `unreadable <code>` (Task 6); `result_seen` on the probe's records (Task 9).

## Global Constraints

- **The file list is exact.** Create `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`. Modify `.github/workflows/ci.yml` (one heredoc line, Task 1), `shared/lifecycle.ts` (one row, Task 2) and `server/test/lifecycle.test.ts` (the key split, `HISTORY_LANDED`, one `it`, Task 2). Nothing else.
  - **Never edited:** `ccd/**`, the spec, `README.md`, `CLAUDE.md`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, any other file under `shared/`, any other test file (`single-definition.test.ts`, `ci-pipeline.test.ts` and `measure-history.test.ts` are re-run, never edited), and no new helper file. A worker who finds another file unavoidable stops and reports to the coordinator.
- **One new test file (W2-D5).** `server/test/history-replay.test.ts` is created in Task 1's commit together with its heredoc line `          test/history-replay.test.ts` (ten spaces), placed directly before the `          EOF` line. Every later task appends to it.
- **Line-disjoint with 5h-2 (W2-D3).** In `shared/lifecycle.ts` this PR adds one row directly after the `history-card-files` row and touches no other line; in `server/test/lifecycle.test.ts` it edits the `HISTORY_ROWS_BY_PR` 'W2' line, the `HISTORY_LANDED` line and adds one `it` directly after the B3 numbers case (`:1279-1280`, the describe's last case; Task 2). That `it` is beyond W2-D3's literal list (the row, the key split, `HISTORY_LANDED`); it sits far from 5h-2's lines, and the coordinator accepted its placement (ruling). It never touches the `history-store-id` row (`:64`) or its pin, which are 5h-2's Task 4.
- **Never a shell.** Every child process is spawned with an argv array (`spawn`, `spawnSync`, `execFile` or `execFileSync`), never `shell: true`, never `exec`, `execSync` or a command string, in shipped code and in tests alike, and no env value ever reaches a command string. The driver itself uses `spawn` only (Task 5's source scan pins that). CodeQL's `js/shell-command-injection-from-environment` opens a review thread that blocks the merge.
- **The environment.**
  - `main(argv, env)` takes the environment as a parameter. The entry guard is the file's last block, and it passes a by-name projection, never `process.env` whole:

    ```js
    if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
      process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
    }
    ```

    An unset variable stays `undefined` in the projection, so W2-D45 holds. No line anywhere passes `process.env` whole, and no exemption exists. Every other env read goes through `main`'s `env` parameter: `HOME` and `TMUX_PANE` in `main` and the handlers, and `LANG` threaded into `RunJob.lang` (Task 5) and `measureClaudeVersion`'s `lang` (Task 7). Task 5's scan pins that the projection line is the driver's only `process.env` line, with a CONTROL showing that a whole-env line reds.
  - A spawned child's env is a fresh object built by `spawnEnv` (the `env -i` equivalent), never a spread of `process.env` or of `env`. `PATH` is `<out>/poison-bin:<dirname(process.execPath)>:/usr/bin:/bin`, never the caller's.
  - `TMUX_PANE` is set iff it is defined, so `''` refuses (W2-D45). The driver never sets `TMUX`, `TMUX_PANE`, `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` or `CCRC_SESSION_GENERATION` on a child.
- **Words the driver never spells.** It never spells an arm value (W2-5b's scan pins that, W2-D42); the arm values reach `spawnEnv` as parameters. It never names a switch file. O13 (`single-definition.test.ts`) counts any non-comment `.mjs` line under `deploy/` holding `/history-off`, `/history-max-gb`, `/headless-on`, `/steer-on`, `/history-steer-off` or `/history-steer-live` as a holder, so no non-comment line spells one, and the header comment says so in words without the slash. It names recall-off only through `recallOffPath(`, read with `lstatSync` (W2-D29): no line naming `recall-off` (the word `family-recall-off` included) may also carry `writeFile`, `appendFile`, `rename`, `unlink`, `rm`, `rmdir`, `mkdir`, `copyFile`, `cp`, `symlink`, `link`, `truncate` or `open` before a `;`, or O13's writer scan counts it. It never spells `redactDisplayWindow` (W2-D54, Task 4's scan) or `.credentials.json` (W2-D52).
- **Single definition (W2-D12).** `DRIVER_REASONS` is frozen once, in `deploy/history-replay.mjs`, and is disjoint from lib's `REASONS`. No `deploy/*.mjs` declares an O14 `VOCABS` name: never `const EXIT`, `const REASONS`, `const SWITCHES`, `const BACKENDS` or any other name in that list (`DECL_CORPUS` scans `deploy/`). `EXIT` is imported from lib. The departure that makes these words deploy-local is D-5774, cited bare; this plan does not define it.
- **No overloaded null.** Every reader keeps its conditions apart:
  - `insideGitTree` answers `outside`, `inside` or `unmeasured` (an `lstat` failure other than `ENOENT`), and `unmeasured` refuses;
  - `readLimitsRow` answers `row`, `absent`, `not-regular`, `unreadable` or `malformed`;
  - `readReleaseStamp` answers `value`, `absent`, `unreadable`, `malformed` or `untagged`, and every state but `value` refuses `tree-unmeasured`, never `tree-moved` (ruling);
  - `wrapperSha` answers a generated account's sha or upstream's null, and a wrapper it cannot read refuses `wrapper-unmeasured`, never `wrapper-moved` and never null (ruling);
  - `codeShas` answers `measured` or `unmeasured` with the path and cause, never a hash of nothing, and an unmeasured file refuses `code-unmeasured` even under `--allow-code-change` (ruling);
  - `recallOffPresence` keeps `present` and `unmeasured` apart, and both refuse; an id lib's `idOk` refuses is `input-invalid` (ruling), never absent;
  - the stream reader's absent init field is `null`, never `[]`; its usage source is `result`, `assistant` or `none`.
- **Fail closed.** The spend ledger is append-only and summed over every line, never de-duplicated by name: a re-run's spend adds to the total, and over-counting is the safe direction for a budget. An unreadable or malformed spend ledger is `budget-exhausted` (`ledger-unreadable`). A limits row the driver cannot read, or whose 0 was inferred from age, stops the batch. Every refusal lands before the first spawn of its batch.
- **FIXTURE HOMEs only.**
  - Every test builds its `HOME` with `mkTmp` and writes its own `.ccrc/accounts.json`, `.cc-limits/<id>.json`, `.local/bin/<id>` stub and secrets file there. No step, test or scratch command reads or writes the live `~/.ccrc`, `~/.cc-limits`, `~/.cc-sessions`, any account home, or runs a real `claude`, `ccd`, the history shim, `sweep.mjs`, `cli.mjs` or any `ccrc history` verb.
  - `runDriver` passes `{...scrubbedEnv(process.env), HOME: home, ...extraEnv}`, so a suite run from inside tmux does not trip RP2 by accident.
  - A case that needs an unreadable file (mode 000) is skipped when `process.getuid() === 0`.
  - Never kill a process by pattern. `launchRun`'s timeout kills its own child's pid only.
- **Running tests.** From `server/`, `./node_modules/.bin/vitest run test/<file>.test.ts`, in the foreground, with a timeout of at least 600000 ms; never bare `npx vitest`. Re-run CLAUDE.md's known load flakes in isolation before calling a red a break.
- **Filters.** vitest builds a `-t` filter with `new RegExp(pattern)` over the full test name. Every filter in this plan uses no regex metacharacter except a deliberate `|`, `.*` or `(…|…)` group (Task 2's mutant filters use the last two), so describe and `it` titles that a filter selects carry no `(`, `)`, `[`, `.`, `*`, `+`, `?` or `$` in the selected part. Each step names what its filter selects; a run that reports only skipped tests selected nothing, and that step is not green.
- **Red-first.** Every guard is measured red on the unguarded code, then each named mutant is measured red after the guard lands, then green again. Scratch copies go under `.superpowers/sdd/history-w2-4/scratch` (gitignored), never `git stash`.
- **Commits.** One commit per task, in task order (Task 1 first: W2-D5 puts the test file and its heredoc line in one commit). Each subject is `feat(history): W2-4 Task <N> — <task title, lower case>`, and each message ends with the Co-Authored-By line the worker's session's attribution reminder gives. Set it once, `CO_AUTHORED_BY='<that line>'`, and every task's commit step passes it as a second `-m`.
- **Fixtures.** Key-shaped values (the fixture OAuth token, any secret the redaction cases plant) are assembled at runtime from parts, never written whole. Account ids are the synthetic `up-a`, `gen-a`, `gen-o`, `cx-a`, `ext-n`, `ext-a`, `gen-h`, `gen-u`, `gen-s`, `gen-m`, `gen-r` and `gen-d` (Task 3's module-level `FIXTURE_ACCOUNTS`, which Task 8 reuses); model ids are synthetic (`fixture-model-writer` and the like); fixture paths are `mkTmp` paths.
- **Public repo.** No hostnames, user, account, wrapper, lane, pool or home names, session ids, IP addresses, absolute home paths, private ticket ids or docserver URLs, in plan text, fixtures, comments, commits or the PR body.
- **Node floor.** `>=22.16.0` in `server/`, `agent/` and `pwa/`, pinned by `node-floor.test.ts`. No task changes it; if it reds, raise the engines, never lower them.
- **macOS.** The node-floor leg is Linux. `test-macos` runs the selection and is advisory, but the file should pass there: paths come from `mkTmp` (already realpathed), and nothing assumes `/proc`.
- **D-numbers.** This plan defines none: no departure in the W2 decisions document names W2-4 in its "Defined in" entry. It cites D-5774 bare (W2-D12, defined in W2-3's plan). Erratum E18 is additive and takes no number. A departure found during the build takes a number only from a block the coordinator names; otherwise the worker writes `D-TBD-<slug>` and reports it. Never write a range. Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before the first edit of each existing file, the worker reads `GET /api/claims?project=ccrc-pwa`. The shared files are `shared/lifecycle.ts` and `server/test/lifecycle.test.ts` (5h-2's Task 4) and `.github/workflows/ci.yml`.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D3 | **Line-disjoint beside 5h-2.** If 5h-2 is live, W2-4 edits only the history-replay-out row, the 'W2' key split and `HISTORY_LANDED`; 5h-2 edits the history-store-id row and its pin. Whichever lands second merges `main` and keeps both. | coordinator ruling (W2 decisions document) | 2 |
| W2-D5 | **One new test file.** `server/test/history-replay.test.ts` is created here and listed in the node-floor heredoc in the same commit. Only this PR selects the full suite. | coordinator ruling (W2 decisions document) | 1 |
| W2-D6 | **The build freeze's `tree-moved` mechanism.** After part 1 the driver refuses when the installed release stamp differs from `gate_code.release_tag`; this PR ships the comparison, W2-5b wires it into each batch. A stamp that cannot be read is not a measured difference: it refuses `tree-unmeasured` (coordinator ruling), never `tree-moved`. | open-record default: the operator confirms at W2 open | 7 |
| W2-D9 | **Lifecycle keys.** 'W2' splits into `'W2-1': ['history-recall-off']` and `'W2-4': ['history-replay-out']`; `HISTORY_LANDED` gains 'W2-4'; the row is pattern O, creator `deploy/history-replay.mjs`, collector null, with the ruling text. | coordinator ruling (W2 decisions document) | 2 |
| W2-D12 | **Deploy-local words, driver half.** `DRIVER_REASONS` is frozen once in `history-replay.mjs`; no `deploy/*.mjs` declares a `VOCABS` name. D-5774 cited bare. | coordinator ruling (W2 decisions document) | 1 |
| W2-D24 | **`codeShas()`.** The sha256 of the installed bytes of the four `gate_code` files. Step 0a records it and the release stamp; each later consumer PR wires its own re-check; `--allow-code-change` stamps a measured change instead of refusing, and an unmeasured code file still refuses `code-unmeasured` (coordinator ruling). | coordinator ruling (W2 decisions document) | 7, 8 |
| W2-D29 | **The driver's recall-off line reads.** `lstatSync(recallOffPath(…))` matches no write verb in O13's classifier; W2-1 adds that CONTROL. | coordinator ruling (W2 decisions document) | 7 |
| W2-D45 | **`TMUX_PANE` is set iff defined,** so an empty value refuses. | coordinator ruling (W2 decisions document) | 1 |
| W2-D50 | **The child env's exact key set.** `HOME`, the explicit `PATH`, `LANG`, `CLAUDE_CONFIG_DIR`, and in arm mode `CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF` as parameters; writer and judge the same with no `CCRC_RECALL_*`. RP1-contract asserts it with parameter values. | coordinator ruling (W2 decisions document) | 5, 8, 9 |
| W2-D51 | **The spawn contract and the reader.** Launch per kind, `env -i`, the `TMUX_PANE` refusal, an empty 0700 cwd outside any git tree, the flags, `--restricted` with the fallback as a parameter, `--model`, `--tools Bash,Agent` and the three `--allowedTools` spellings, never bypass; writer and judge with `--tools ""` on stdin; at most 2 concurrent; the stream-json reader; no `deploy/history-*.mjs` imports `node:sqlite`. | coordinator ruling (W2 decisions document) | 1, 4, 5 |
| W2-D52 | **Admission.** The roster read once, validated by `rosterFromJson`, `exec.provider` and `hidden` read from the same parsed object; `upstream` and `generated`/`anthropic` admitted, where a `generated` account with no declared provider reads as `anthropic`, the roster's own default (coordinator ruling; `external` with no declared provider stays refused); every other kind, `hidden`, an undeclared, absent or unreadable `secretsFile`, and an upstream config dir other than `$HOME/.claude` refused before any spawn. | coordinator ruling (W2 decisions document) | 3, 8 |
| W2-D53 | **`--out`.** Created 0700 under umask 077 with the marker; reused only as a real, owned, 0700, marked directory outside any git tree; reuse is what resumes a batch. | coordinator ruling (W2 decisions document) | 2, 5 |
| W2-D54 | **Spawned text.** Each field passes whole through `redactField` before any cut; the 4,000-character tool_result cut comes after; an over-cap field is discarded; never `redactDisplayWindow`. | coordinator ruling (W2 decisions document) | 4 |
| W2-D55 | **The limits stop and the budget.** Stop on an absent, non-regular, unreadable or malformed row, a null `five` or `seven`, a 0 inferred from age, a row older than `max_age_ms` (`limits-stale`), `max(five, seven) >= threshold_pct` (`limits-threshold`), and cumulative spend at the budget (`budget-exhausted`). Before part 1 a `--budget` is required and the defaults are `{threshold_pct: 70, max_age_ms: 3600000, batch_max: 10, concurrency: 2}`. A stop exits non-zero and resumes. | open-record default: the operator confirms at W2 open | 4, 5, 6, 8, 9 |
| W2-D56 | **Preflights.** `claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed`, each a measured mismatch, in that order; an input that cannot be measured refuses its own word at its place (coordinator ruling): `version-unmeasured` at the first, `tree-unmeasured` at the second, `wrapper-unmeasured` at the third (refused by `wrapperSha`, before the comparison), `code-unmeasured` at the fourth; against part 1 or, before it, against the step 0a output passed as `--step0a PATH --step0a-sha256 HEX`. This PR ships the mechanism; W2-5b wires it. | coordinator ruling (W2 decisions document) | 7 |
| W2-D57 | **Step 0, split.** Step 0a records the version as launched, the wrapper sha, the flags accepted, the writer and judge init, `codeShas()`, the release stamp, the budget and the spend, under `--out`, and prints its sha256. Step 0b's turn-bound and persistence mechanics ship here without the seam; its arm assertions are W2-5b's. | coordinator ruling (W2 decisions document) | 8, 9 |
| W2-D58 | **The probe** is a box verb needing no identity, an early check only; the treatment-arm pilot assertions are W2-5b's. | coordinator ruling (W2 decisions document) | 9 |
| W2-D59 | **Driver-local words.** `DRIVER_REASONS` holds W2-D59's sixteen words, printed on stderr with a non-zero exit, never lib `REASONS`; this PR appends its own nine: `args-invalid`, `in-pane`, `roster-invalid`, `account-refused`, `input-invalid`, then `code-unmeasured`, `version-unmeasured`, `tree-unmeasured` and `wrapper-unmeasured` (coordinator rulings, used by Tasks 7 and 8). | coordinator ruling (W2 decisions document) | 1, 7, 8 |
| W2-D78(ii) | **The recall-off presence preflight.** Any `recall-off/<id>` entry, whatever its type or content, refuses `family-recall-off`; an `lstat` error other than `ENOENT` is unmeasured and refuses too. This PR ships the function; W2-5b wires it into the arm batches with (i) and (iii). | coordinator ruling (W2 decisions document) | 7 |

## Review Focus

These five inputs follow from the spec and the decisions document, would bite the operator running the driver, and no existing case exercises them. Each names the task that adds its pin.

1. **A shell where `TMUX_PANE` is defined but empty** (an `export TMUX_PANE=` left by a profile, or a shell started from a pane with the value cleared). Expected: refused `in-pane` before argument parsing, exit 2, and the `--out` named in argv is not created (W2-D45). **Task 1**, RP2 with `''` beside `%9`, and the mutant that lets `''` pass.
2. **An `--out` that looks reusable but is not:** one inside a git worktree, where `.git` is a FILE, not a directory; one left at mode 0750 by an earlier umask; a symlink to a good directory; one created by another user (a `sudo` run); one without the marker. Expected: each refused `out-refused` with its own detail, never chmodded, followed or adopted; an ancestor whose `lstat` fails with anything but `ENOENT` refuses as `git-unmeasured`, never reads as outside. **Task 2.**
3. **An account that is almost admissible:** `external` declaring `anthropic`, `external` with no `provider`, a `hidden` one, a `secretsFile` that is a directory or mode 000, and an `upstream` whose config dir is not `.claude`. Expected: each refused `account-refused` with its own detail before any spawn, the stub's log absent and no stream file under `--out`; a `.credentials.json` planted as a FIFO is never opened. And the one that is admissible by ruling: `generated` with no `provider` reads as `anthropic` (the roster's default) and is admitted when its secrets file passes. **Task 3** (function level) and **Task 8** (through `step0a`).
4. **A limits row whose `five` reads 0 because its window lapsed by age, with no `resetAt` fact.** That 0 is not headroom. Expected: `limits-stale` (`inferred-by-age`), even with `max_age_ms` raised past the row's age; a 0 from a lapsed `resetAt` is admitted; `five`, `seven` and both rolled-over flags equal `readLimits`' over every `rolloverCases` row. **Task 6.**
5. **A batch stopped part-way and run again on the same `--out`:** a `limits-*` or `budget-exhausted` stop, or a kill between a run's stream file and its `run.json`. Expected: the re-run spawns only the jobs without a `run.json`; a finished job is never re-spawned and its spend is never recorded twice; a job killed before its `run.json` is spawned again, and its second spend adds to the ledger's total (over-counting, the safe direction for a budget). **Task 5** (resume and the ledger count), **Task 6** (a stopped batch resumes once the row is refreshed) and **Task 8** (a larger `--budget` resumes `step0a` without re-spawning its first run).

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `deploy/history-replay.mjs` | create | **Task 1:** header comment, imports, `DRIVER_REASONS`, `DriverRefusal`, `refuse`, `FLAG_SPECS`, `parseArgs`, `HANDLERS` (empty), `paneRefusal`, `main`, the entry guard. **Task 2:** `OUT_MARKER`, `OUT_KIND`, `insideGitTree`, `prepareOut`, and `main`'s `process.umask(0o077)`. **Task 3:** `readRoster`, `admitAccount`, `LaunchSpec`. **Task 4:** `TOOL_RESULT_CUT`, `redactForSpawn`, `cutToolResult`, `toolResultText`, `readStreamJson`, `spendTokens`, `SPEND_LEDGER`, `recordSpend`, `spentSoFar`. **Task 5:** `SPAWN_MODES`, `SETTINGS_MODES`, `MAX_TURNS`, `BATCH_MAX`, `CONCURRENCY_MAX`, `POISON_BIN_DIR`, `allowedToolSpellings`, `spawnArgv`, `spawnEnv`, `ensurePoisonBin`, `makeRunCwd`, `launchRun`, `runBatch` (and the module-private `runHomeOf`, which Task 7 calls). **Task 6:** `LIMITS_DEFAULTS`, `parseLimitsRow`, `readLimitsRow`, `decideLimits`, `decideBudget`, `batchGate`. **Task 7:** `CODE_SHA_FILES`, `TREE_ROOT`, `STEP0A_KIND`, `STEP0A_FIELDS` (declared here because `loadStep0a` reads them first; Task 8 consumes them and never declares them again), `codeShas`, `readReleaseStamp`, `wrapperSha`, `measureClaudeVersion`, `preflight`, `loadStep0a`, `recallOffPresence`, `refuseRecallOff`. **Task 8:** `STEP0A_FILE`, `STEP0A_PROMPT`, `flagsAccepted(argvs, outcomes)`, `step0aCommand`, registered as `step0a`. **Task 9:** `PROBE_KIND`, `TURN_PROBE_PROMPT`, `turnBoundHeld`, `projectSlugOf`, `persistenceLeft`, `step0bMechanics`, `probeCommand`, registered as `probe`. Every block above the entry guard; no top-level await outside it. | L4 (operator script) | 1–9 |
| `server/test/history-replay.test.ts` | create | **Task 1:** `runDriver`, RP2, the `DRIVER_REASONS` pins, the `node:sqlite` scan with its CONTROL. **Task 2:** RP4 and the reuse refusals. **Task 3:** the module-level `fixtureAccount`, `FIXTURE_ACCOUNTS` (twelve rows) and `writeRoster`, which Tasks 5, 6, 8 and 9 call, then RP3-admission and RP9 at function level. **Task 4:** the redaction order, the reader, the ledger, the `redactDisplayWindow` scan. **Task 5:** `plantStub`, `stubLog`, `STUB_STREAM`, RP1-contract on the stub, concurrency, resume, the env-read scan. **Task 6:** the `readLimits` parity and each stop. **Task 7:** each preflight word, `codeShas`, the recall-off presence cases, `loadStep0a`. **Task 8:** `step0a` end to end. **Task 9:** the probe and the step 0b mechanics. | test | 1–9 |
| `.github/workflows/ci.yml` | modify | One line, `          test/history-replay.test.ts`, directly before the node-floor `Test` step heredoc's `          EOF`. | CI | 1 |
| `shared/lifecycle.ts` | modify | The `history-replay-out` row, directly after the `history-card-files` row. No other line. | L0 (data) | 2 |
| `server/test/lifecycle.test.ts` | modify | `HISTORY_ROWS_BY_PR`'s 'W2' line becomes `'W2-1': ['history-recall-off']` and `'W2-4': ['history-replay-out']`; `HISTORY_LANDED` gains `'W2-4'`; one `it` for the row directly after the B3 numbers case (`:1279-1280`). | test | 2 |

## Not in this plan

- **W2-1 (fleet):** the `recall-off` verb and its generation checks, the presence record, `status --json`'s `recall_off`, RP8 and RP10; the exports for the deploy lane, including `pairIndexOf` (Task 4 takes the index as a parameter until then) and `historyPaths(home).headlessOn`; O13's re-pinned recall-off case with the CONTROL that this PR's `lstatSync` line is not a write (W2-D29); `RECALL_OFF_META`; and the spec errata for W2-1, W2-3 and this PR, E18 included.
- **W2-2a (fleet):** the as-of cut and `asof-invalid`. **W2-2b (fleet):** the headless seam, `RECALL_ARMS`, the `headless-on` marker's grammar, the history-switches row.
- **W2-3 (deploy):** `deploy/history-gate.mjs` (the window builder, the open-record validator that checks step 0a's `code_shas` and `release_stamp` against `gate_code`, `decideGate`, the quiz's pure decisions) and `measure-history.py`'s raw rows and census mode.
- **W2-5a (deploy):** reconstruction, admission of facts, Baseline B, the quiz builder and the writer spawn's real input (RP1-writer, RP3-writer), and the subcommands `pilot-source` (which requires `--step0a` and `--step0a-sha256` and runs `loadStep0a` and `preflight`), `quiz-source`, `freeze`, `power`, `open --draft|--finalize|--template` (`open --draft` binds each step 0a output to its node with `label` and `store_id`, coordinator ruling) and `verify --registry|--section ab`, each with its own `codeShas()` re-check.
- **W2-5b (deploy):** the arm runs with the real `CCRC_RECALL_ARM` values (RP1-arm), the card, the `step0b` subcommand and its treatment-arm assertions, the fidelity and usage pilots, the judge (RP1-judge, RP3-judge), the hand-check, uptake, `marker`, `open --amend`, `report`, the W2-D78 (i) and (iii) preflights and the wiring of (ii) and of W2-D56's preflights into every arm batch, the scan that the driver never spells an arm word, and README's driver paragraph.
- **W2-6 (deploy):** `deploy/history-counters.mjs`.
- **Waves 5h-1 and 5h-2:** their own plans. 5h-2's Task 4 owns the `history-store-id` row and its pin.
- **Operator and coordinator acts, never the worker's:** the final W2 release and its rollout, update intent, running `step0a` or `probe` on any real node or account, the maintenance and build freezes, and every open-record step (W2 decisions document §4 and §5).

---

### Task 1: The driver's entry, its words and the pane refusal; the test file joins the node-floor leg

This task creates the driver as an L4 operator script with nothing behind it yet: its words, its refusal type, its argument grammar, the pane refusal, `main` and the entry guard. `HANDLERS` starts empty, so every subcommand answers `args-invalid` until Tasks 8 and 9 register `step0a` and `probe`. Task 1's own cases spell an unregistered name (`no-such-sub`), never `step0a` or `probe`, so they stay green after those registrations; Task 8 pins `HANDLERS.has('step0a')` and Task 9 pins the final key list. It also creates W2's one new test file and lists that file in ci.yml's node-floor heredoc in the same commit (W2-D5). ci-pipeline.test.ts builds the leg's list from `server/test/`, so a `history-*.test.ts` without its heredoc line reds. Step 5 measures that red. Last, it adds W2-D51's scan that no `deploy/history-*.mjs` loads `node:sqlite`, with a CONTROL.

**Decisions:** W2-D5 (one new test file, listed in the node-floor heredoc in the same commit); W2-D59 (`DRIVER_REASONS`, printed on stderr with a non-zero exit, never lib REASONS); W2-D12's driver half (`DRIVER_REASONS` is frozen once, in history-replay.mjs, and no `deploy/*.mjs` declares a VOCABS name; the departure is D-5774, defined by W2-3 and cited here); W2-D51 (the TMUX_PANE refusal; the `node:sqlite` scan); W2-D45 (TMUX_PANE counts as set whenever it is defined, so an empty value refuses). This task defines no D-number.

**Files:**
- Create: `deploy/history-replay.mjs`.
- Create: `server/test/history-replay.test.ts`.
- Modify: `.github/workflows/ci.yml`. Add one line, `          test/history-replay.test.ts` (ten-space indent), inside the `node-floor` job's `Test` step heredoc, directly before its `          EOF` line. At `7d01973a2` that is after `          test/history-card.test.ts` (`:933`) and before `EOF` (`:934`). Re-anchor by that content.
- Not edited:
  - `shared/lifecycle.ts` and `server/test/lifecycle.test.ts` (Task 2);
  - `server/test/single-definition.test.ts`: O13's `ALL_MJS` (`:5053`) and O14's `DECL_CORPUS` (`:5243`) already walk `deploy/` and are only re-run;
  - `server/test/ci-pipeline.test.ts`: its node-floor derivation case (`:1015-1027`) is the measured red and is only re-run;
  - `ccd/**`, the spec, README.md, CLAUDE.md, `deploy/history-gate.mjs`, `deploy/measure-history.py`.

**Interfaces:**
- Consumes:
  - `ccd/history/lib.mjs`:
    - `EXIT` (`:28`; `EXIT.REFUSED = 2`, `EXIT.INTERNAL = 1`), which the driver imports and never declares (O14);
    - `REASONS` (`:71`), imported by the test only, for the disjointness pin.
    - Both are typed in `lib.d.mts` (`:10`, `:15`).
  - `server/test/historyHelpers.ts`: `REPO` (`:36`) and `scrubbedEnv` (`:54`). scrubbedEnv drops TMUX, TMUX_PANE, CLAUDECODE, CLAUDE_CONFIG_DIR, CCRC_SESSION_GENERATION, CCRC_RECALL_* and NODE_OPTIONS.
  - `server/test/tmpHelpers.ts`: `mkTmp` (`:38`). Its file-scoped `afterAll` removes every fixture HOME.
  - `server/test/ci-pipeline.test.ts:1015-1027`: the node-floor derivation case, used as the measured red.
- Produces (`deploy/history-replay.mjs`, all exported):
  - `DRIVER_REASONS: readonly string[] = Object.freeze([...])`: W2-D59's sixteen words in its order, then W2-4's nine words (five plan-chosen, four by coordinator ruling) `'args-invalid','in-pane','roster-invalid','account-refused','input-invalid','code-unmeasured','version-unmeasured','tree-unmeasured','wrapper-unmeasured'` (the last four are the rulings': Task 7's `preflight` and `wrapperSha`, and Task 8's step 0a, use them);
  - `class DriverRefusal extends Error { word: string; detail: string }`. `constructor(word, detail)` throws `TypeError` when `word` is not in `DRIVER_REASONS`. `name` is `'DriverRefusal'` and `message` is `` `${word}: ${detail}` ``.
  - `refuse(word: string, detail: string): never`;
  - `FLAG_SPECS: Readonly<Record<string, 'string'|'int'|'bool'>>`, frozen: `out`, `account`, `writer-model`, `judge-model`, `arm-model` and `settings-mode` are `'string'`, and `budget` is `'int'`;
  - `HANDLERS: Map<string, (flags: Record<string, string|number|boolean>, env: Record<string, string|undefined>) => Promise<number>>`, empty here;
  - `parseArgs(argv: string[], opts?: {specs?: Readonly<Record<string, FlagKind>>, subs?: Iterable<string>}): {sub: string, flags: Record<string, string|number|boolean>}`. `opts` defaults to `FLAG_SPECS` and `HANDLERS.keys()`, and later tasks call `parseArgs(argv)`. It throws `DriverRefusal('args-invalid', detail)` with one of these details:
    - `no subcommand`;
    - `unknown subcommand "<sub>"`;
    - `unknown flag "<tok>"`;
    - `unexpected argument "<tok>"`;
    - `repeated flag --<name>`;
    - `missing value for --<name>`;
    - `--<name> wants a positive integer, got "<v>"`.
  - `paneRefusal(env: Record<string, string|undefined>): DriverRefusal | null`. It returns a refusal exactly when `env.TMUX_PANE !== undefined`. The refusal is `in-pane` with detail `TMUX_PANE is set; run the driver from a shell outside tmux`.
  - `main(argv: string[], env: Record<string, string|undefined>): Promise<number>`. It runs the pane check first, then `parseArgs`, then the handler.
    - A `DriverRefusal` prints `ccrc history-replay: <word>: <detail>\n` on stderr and returns `EXIT.REFUSED`.
    - Any other throw prints `ccrc history-replay: internal error: <stack>` and returns `EXIT.INTERNAL`.
    - It writes nothing to stdout.
  - The entry guard is the file's last block. It passes `main` a by-name projection of the environment, never `process.env` whole (coordinator ruling; Global Constraints): `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) { process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG }); }`, written over three lines as Step 4 shows.
- Produces (test side, `server/test/history-replay.test.ts`):
  - `SCRIPT`;
  - `runDriver(home: string, args: string[], extraEnv?: Record<string, string>): {code: number|null, stdout: string, stderr: string}`. It calls `spawnSync(process.execPath, [SCRIPT, ...args])` with `cwd: home` and env `{...scrubbedEnv(process.env), HOME: home, ...extraEnv}`.
  - `refusalLine(word, detail)`.
  - Later tasks append their own describes to this file and reuse these helpers.

**Choices this task makes:**
- **`parseArgs` takes an optional second argument.** It adds to the signature in the task list: with `HANDLERS` empty, the grammar can be tested only against a fixture subcommand and a fixture bool flag. The driver itself never passes it.
- **What the grammar accepts** (accepted as written, coordinator ruling):
  - only `--name value` and `--name` (for a bool flag), never `--name=value`, which reads as an unknown flag;
  - a value may not begin with `--`, so `--out --budget 5` refuses `missing value for --out` and never takes `--budget` as a path;
  - an int is plain decimal `[1-9][0-9]*` that is also `Number.isSafeInteger`, so `0`, `-5`, `1.5`, `1e6`, `0x10`, `007` and a 20-digit number are each refused;
  - a bare positional after the subcommand is refused.
- **Echoed tokens are JSON-quoted in the detail**, so a control character in argv cannot forge a second stderr line.
- **The `DriverRefusal` constructor checks its word**, so a typo in a later task's `refuse(...)` is a `TypeError` (a defect, exit 1), never a new word printed at exit 2.
- **The entry guard hands `main` only `HOME`, `TMUX_PANE` and `LANG`, each by name.** An unset variable stays `undefined` in the projection, so `paneRefusal`'s "set iff defined" (W2-D45) reads it exactly as it would read `process.env`. No line passes `process.env` whole, and Task 5's scan has no exemption for this one.
- **The entry guard uses top-level `await` and sets `process.exitCode`, never calling `process.exit()`.** The event loop drains, so the stderr line is never cut. This is safe here because the driver holds no libuv thread that never settles (cli.mjs's reason for `exitDrained`).
- **The scan matches any quoted `node:sqlite` specifier** (`/(['"`])node:sqlite\1/`), so the static, dynamic and `createRequire` forms (`deploy/coordination-snapshot.mjs:77` is a real instance of the last) are all one shape. Its known gap: a specifier assembled from pieces is not seen.
- **What the driver file never spells.** It names neither recall arm word, so it never says the two words the seam reads. It does not contain the headless marker's path, and it never writes a `/<switch>` path, so O13's needles do not match it.

- [ ] **Step 1: Confirm the base before writing.** From the repository root:

```bash
ls deploy/history-*.mjs 2>/dev/null | wc -l
grep -c '^          test/history-card.test.ts$' .github/workflows/ci.yml
grep -c '^export const EXIT = Object.freeze' ccd/history/lib.mjs
grep -c '^export const REASONS = ' ccd/history/lib.mjs
grep -c '^export function scrubbedEnv(' server/test/historyHelpers.ts
test -e server/test/history-replay.test.ts && echo PRESENT || echo absent
node --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); const D = ['family-unlisted','family-recall-off','quiz-unanswerable','quiz-sha-mismatch','claude-version-moved','tree-moved','wrapper-moved','code-changed','limits-threshold','limits-stale','budget-exhausted','record-invalid','record-sha-mismatch','input-sha-mismatch','assignment-mismatch','out-refused','args-invalid','in-pane','roster-invalid','account-refused','input-invalid','code-unmeasured','version-unmeasured','tree-unmeasured','wrapper-unmeasured']; console.log(l.EXIT.REFUSED, l.EXIT.INTERNAL, D.length, new Set(D).size, D.filter((w) => Object.hasOwn(l.REASONS, w)).length, Object.hasOwn(l.REASONS, 'bad-args'))"
```

Expected (measured at `7d01973a2`):
- `0`, which becomes `1` once W2-3's `deploy/history-gate.mjs` has merged. Either is fine.
- `1`, `1`, `1`, `1`;
- `absent`;
- the last line prints `2 1 25 25 0 true` (predicted: measured as `2 1 21 21 0 true` before the coordinator rulings added `code-unmeasured`, `version-unmeasured`, `tree-unmeasured` and `wrapper-unmeasured`; a grep of `ccd/history/lib.mjs` finds none of the four, at `7d01973a2` for the first two and at `d7a4c9408` for `tree-unmeasured` and `wrapper-unmeasured`).

If the third value from the end is non-zero, a lib word now collides with a driver word: stop and report it to the coordinator. The words W2-1, W2-2a and W2-2b add to lib (`generation-malformed`, `generation-mismatch`, `asof-invalid`, `headless-malformed`, `headless-arm-unknown`) do not collide.

- [ ] **Step 2: Write the failing test file.** Create `server/test/history-replay.test.ts`:

```ts
// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
// The ONE test file W2 creates (W2-D5). It is listed in ci.yml's node-floor heredoc, so the 22.16.0 leg runs it on
// every pull request; ci-pipeline.test.ts derives that list from this directory and reds when the line is missing.
//
// ISOLATION: every spawn runs on a mkTmp fixture HOME with historyHelpers' scrubbedEnv, which drops the session's
// own TMUX, TMUX_PANE, CLAUDECODE, CLAUDE_CONFIG_DIR, CCRC_SESSION_GENERATION and CCRC_RECALL_* first. Children are
// spawned with an argv array on process.execPath, never through a shell. Key-shaped fixture values are assembled at
// run time; no fixture names a real account, host or path.
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { REPO, scrubbedEnv } from './historyHelpers.js';
import { EXIT, REASONS } from '../../ccd/history/lib.mjs';
import * as replay from '../../deploy/history-replay.mjs';

const SCRIPT = path.join(REPO, 'deploy', 'history-replay.mjs');

/** One driver run as the operator makes it: node on the script, an argv array, a fixture HOME, the scrubbed env plus
 *  `extraEnv`, and the HOME as cwd so a relative path never lands in the checkout. */
function runDriver(home: string, args: string[], extraEnv: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: home, encoding: 'utf8', timeout: 60_000,
    env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** What a refusal prints: exactly one stderr line. */
const refusalLine = (word: string, detail: string): string => `ccrc history-replay: ${word}: ${detail}\n`;

// ── W2-4 Task 1: the driver's words (W2-D59, W2-D12; D-5774) ──────────────
describe('history-replay W2-4 Task 1: the driver words (W2-D59, W2-D12; D-5774)', () => {
  const W2_D59 = ['family-unlisted', 'family-recall-off', 'quiz-unanswerable', 'quiz-sha-mismatch',
    'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed', 'limits-threshold', 'limits-stale',
    'budget-exhausted', 'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch', 'assignment-mismatch', 'out-refused'];
  const PLAN_CHOSEN = ['args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid', 'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured'];

  it('DRIVER_REASONS is frozen, duplicate-free, and exactly W2-D59\'s sixteen words in order, then W2-4\'s nine', () => {
    expect(W2_D59).toHaveLength(16);
    expect(Object.isFrozen(replay.DRIVER_REASONS)).toBe(true);
    expect(new Set(replay.DRIVER_REASONS).size, 'a word is listed twice').toBe(replay.DRIVER_REASONS.length);
    expect([...replay.DRIVER_REASONS]).toEqual([...W2_D59, ...PLAN_CHOSEN]);
  });

  it('DRIVER_REASONS is disjoint from lib REASONS: no driver word is a CLI word (C-J)', () => {
    const cli = Object.keys(REASONS);
    expect(cli.length, 'lib REASONS read empty: the disjointness would hold vacuously').toBeGreaterThan(40);
    expect(replay.DRIVER_REASONS.filter((w) => cli.includes(w))).toEqual([]);
  });

  it('DriverRefusal carries its word and detail, refuse() throws one, and a word outside DRIVER_REASONS is a TypeError', () => {
    const r = new replay.DriverRefusal('out-refused', 'symlink');
    expect(r).toBeInstanceOf(Error);
    expect([r.name, r.word, r.detail, r.message]).toEqual(['DriverRefusal', 'out-refused', 'symlink', 'out-refused: symlink']);
    expect(() => replay.refuse('in-pane', 'x')).toThrow(replay.DriverRefusal);
    expect(() => new replay.DriverRefusal('bad-args', 'x'), 'a lib word is not a driver word').toThrow(TypeError);
    expect(() => new replay.DriverRefusal('', 'x')).toThrow(TypeError);
  });
});

// ── W2-4 Task 1: the argument grammar ─────────────────────────────────────
describe('history-replay W2-4 Task 1: the argument grammar', () => {
  /** A fixture grammar: one subcommand and one flag of each kind. */
  const OPTS = { specs: { out: 'string', budget: 'int', dry: 'bool' } as const, subs: ['fixture-sub'] };
  const refusalOf = (argv: string[], opts: Parameters<typeof replay.parseArgs>[1] = OPTS): [string, string] | null => {
    try { replay.parseArgs(argv, opts); return null; } catch (e) {
      if (e instanceof replay.DriverRefusal) return [e.word, e.detail];
      throw e;
    }
  };

  it('FLAG_SPECS declares exactly the seven flags W2-4 uses, frozen', () => {
    expect(Object.isFrozen(replay.FLAG_SPECS)).toBe(true);
    expect(replay.FLAG_SPECS).toEqual({ out: 'string', account: 'string', budget: 'int', 'writer-model': 'string',
      'judge-model': 'string', 'arm-model': 'string', 'settings-mode': 'string' });
  });

  it('a subcommand, a string, an int and a bool parse to {sub, flags}', () => {
    expect(replay.parseArgs(['fixture-sub', '--out', '/x/y', '--budget', '3000000', '--dry'], OPTS))
      .toEqual({ sub: 'fixture-sub', flags: { out: '/x/y', budget: 3_000_000, dry: true } });
    expect(replay.parseArgs(['fixture-sub'], OPTS)).toEqual({ sub: 'fixture-sub', flags: {} });
  });

  it.each([
    [[], 'no subcommand'],
    [['--out', '/x'], 'no subcommand'],
    [['other-sub'], 'unknown subcommand "other-sub"'],
    [['fixture-sub', '--nope', 'v'], 'unknown flag "--nope"'],
    [['fixture-sub', '--out=/x'], 'unknown flag "--out=/x"'],
    [['fixture-sub', 'stray'], 'unexpected argument "stray"'],
    [['fixture-sub', '--out', '/a', '--out', '/b'], 'repeated flag --out'],
    [['fixture-sub', '--dry', '--dry'], 'repeated flag --dry'],
    [['fixture-sub', '--out'], 'missing value for --out'],
    [['fixture-sub', '--out', '--budget', '5'], 'missing value for --out'],
    [['fixture-sub', '--budget', '0'], '--budget wants a positive integer, got "0"'],
    [['fixture-sub', '--budget', '-5'], '--budget wants a positive integer, got "-5"'],
    [['fixture-sub', '--budget', '1.5'], '--budget wants a positive integer, got "1.5"'],
    [['fixture-sub', '--budget', '1e6'], '--budget wants a positive integer, got "1e6"'],
    [['fixture-sub', '--budget', '0x10'], '--budget wants a positive integer, got "0x10"'],
    [['fixture-sub', '--budget', '007'], '--budget wants a positive integer, got "007"'],
    [['fixture-sub', '--budget', '99999999999999999999'], '--budget wants a positive integer, got "99999999999999999999"'],
  ])('argv %j is args-invalid: %s', (argv, detail) => {
    expect(refusalOf(argv)).toEqual(['args-invalid', detail]);
  });

  it('under the driver\'s own grammar (no opts: FLAG_SPECS and HANDLERS\' keys) an unregistered subcommand is args-invalid', () => {
    // parseArgs is called with no opts here; refusalOf's default is the fixture grammar. The name is one no task
    // registers, so the case holds after Tasks 8 and 9 register step0a and probe, and those tasks pin their own names.
    const own = (argv: string[]): [string, string] | null => {
      try { replay.parseArgs(argv); return null; } catch (e) {
        if (e instanceof replay.DriverRefusal) return [e.word, e.detail];
        throw e;
      }
    };
    expect(replay.HANDLERS.has('no-such-sub')).toBe(false);
    expect(own(['no-such-sub', '--out', '/x'])).toEqual(['args-invalid', 'unknown subcommand "no-such-sub"']);
    expect(own(['fixture-sub']), 'the fixture grammar is not the default').toEqual(['args-invalid', 'unknown subcommand "fixture-sub"']);
  });
});

// ── W2-4 Task 1: RP2, the pane refusal (W2-D51, W2-D45) ───────────────────
describe('history-replay W2-4 Task 1: RP2, the pane refusal comes first (W2-D51, W2-D45)', () => {
  const PANE = 'TMUX_PANE is set; run the driver from a shell outside tmux';

  it('paneRefusal: undefined answers null; any defined value, the empty string included, answers in-pane', () => {
    expect(replay.paneRefusal({})).toBeNull();
    expect(replay.paneRefusal({ TMUX_PANE: undefined, TMUX: '/tmp/fixture-sock,1,0' })).toBeNull();
    for (const v of ['%9', '']) {
      const r = replay.paneRefusal({ TMUX_PANE: v });
      expect(r, JSON.stringify(v)).toBeInstanceOf(replay.DriverRefusal);
      expect([r?.word, r?.detail]).toEqual(['in-pane', PANE]);
    }
  });

  it.each(['%9', ''])('RP2: TMUX_PANE=%j refuses in-pane, exit 2, before anything: the --out path is not created', (pane) => {
    const home = mkTmp('ccrc-replay-rp2-');
    const out = path.join(home, 'replay-out');
    const r = runDriver(home, ['step0a', '--out', out, '--account', 'up-a', '--budget', '1000'], { TMUX_PANE: pane });
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.stderr).toBe(refusalLine('in-pane', PANE));
    expect(r.stdout).toBe('');
    expect(existsSync(out), 'the --out path was created').toBe(false);
  });

  it('RP2: with TMUX_PANE set, an argv the grammar refuses still answers in-pane: the pane is checked first', () => {
    const home = mkTmp('ccrc-replay-rp2-');
    const r = runDriver(home, ['--no-such-flag'], { TMUX_PANE: '' });
    expect([r.code, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('in-pane', PANE)]);
  });

  it('RP2 CONTROL: without TMUX_PANE the same argv reaches the grammar, so the scrubbed env really lacks it', () => {
    expect(scrubbedEnv({ TMUX_PANE: '%1', HOME: '/h' })).toEqual({ HOME: '/h' });
    const home = mkTmp('ccrc-replay-rp2-');
    const r = runDriver(home, ['--no-such-flag']);
    expect([r.code, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('args-invalid', 'no subcommand')]);
  });
});

// ── W2-4 Task 1: main's stderr line and exit codes, and the entry guard ───
describe('history-replay W2-4 Task 1: main answers one stderr line, exit 2 for a word and 1 for a defect', () => {
  /** Runs `fn` with a handler registered under `sub`, and removes it afterwards (HANDLERS is module state). From Task 2
   *  on, main sets process.umask(0o077) before parseArgs, and these cases call main in this test process (vitest's fork
   *  pool), so the worker's umask is saved first and restored afterwards: no later case inherits 077. */
  const withHandler = async (sub: string, h: (flags: Record<string, string | number | boolean>, env: Record<string, string | undefined>) => Promise<number>,
    fn: () => Promise<void>): Promise<void> => {
    replay.HANDLERS.set(sub, h);
    const umask = process.umask(0o022);
    process.umask(umask);
    try { await fn(); } finally { replay.HANDLERS.delete(sub); process.umask(umask); }
  };
  const stderrOf = async (fn: () => Promise<number>): Promise<{ code: number; err: string }> => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await fn();
      return { code, err: spy.mock.calls.map((c) => String(c[0])).join('') };
    } finally { spy.mockRestore(); }
  };

  it('a registered handler gets the parsed flags and the env, and its code is main\'s', async () => {
    const seen: unknown[] = [];
    await withHandler('fixture-sub', async (flags, env) => { seen.push(flags, env.HOME); return 0; }, async () => {
      const r = await stderrOf(() => replay.main(['fixture-sub', '--out', '/x', '--budget', '7'], { HOME: '/fixture-home' }));
      expect(r).toEqual({ code: 0, err: '' });
    });
    expect(seen).toEqual([{ out: '/x', budget: 7 }, '/fixture-home']);
  });

  it('a handler\'s DriverRefusal is one stderr line and EXIT.REFUSED (2)', async () => {
    await withHandler('fixture-sub', async () => replay.refuse('budget-exhausted', 'spent 10 of 10'), async () => {
      expect(await stderrOf(() => replay.main(['fixture-sub'], {})))
        .toEqual({ code: EXIT.REFUSED, err: refusalLine('budget-exhausted', 'spent 10 of 10') });
    });
    expect(EXIT.REFUSED).toBe(2);
  });

  it('any other throw is a defect: one internal-error report and EXIT.INTERNAL (1)', async () => {
    await withHandler('fixture-sub', async () => { throw new Error('fixture defect'); }, async () => {
      const r = await stderrOf(() => replay.main(['fixture-sub'], {}));
      expect(r.code).toBe(EXIT.INTERNAL);
      expect(r.err).toMatch(/^ccrc history-replay: internal error: Error: fixture defect\n/);
    });
    expect(EXIT.INTERNAL).toBe(1);
  });

  it('spawned with no subcommand: exit 2, the one args-invalid line, nothing on stdout', () => {
    const r = runDriver(mkTmp('ccrc-replay-main-'), []);
    expect(r).toEqual({ code: EXIT.REFUSED, stdout: '', stderr: refusalLine('args-invalid', 'no subcommand') });
  });

  it('the entry guard: run through a symlink, main still runs (realpath), and importing the module ran nothing', () => {
    const home = mkTmp('ccrc-replay-main-');
    mkdirSync(path.join(home, 'bin'));
    const link = path.join(home, 'bin', 'replay.mjs');
    symlinkSync(SCRIPT, link);
    // A name no task registers, so this case still holds once Tasks 8 and 9 register step0a and probe.
    const r = spawnSync(process.execPath, [link, 'no-such-sub'], {
      cwd: home, encoding: 'utf8', timeout: 60_000, env: { ...scrubbedEnv(process.env), HOME: home },
    });
    expect([r.status, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('args-invalid', 'unknown subcommand "no-such-sub"')]);
    expect(process.exitCode ?? 0, 'importing the driver set an exit code').toBe(0);
  });
});

// ── W2-4 Task 1: W2-D51, no deploy/history-*.mjs loads node:sqlite ────────
describe('history-replay W2-4 Task 1: no deploy/history-*.mjs loads node:sqlite (W2-D51)', () => {
  /** Any quoted `node:sqlite` specifier: a static import, a dynamic import() and a createRequire call all quote it.
   *  KNOWN WIDTH: a specifier assembled from pieces is not seen; review is the backstop. A quoted mention inside a
   *  comment reds too, which is the safe side. */
  const SQLITE_LOAD = /(['"`])node:sqlite\1/;
  const DEPLOY = path.join(REPO, 'deploy');
  const historyMjs = (): string[] => readdirSync(DEPLOY).filter((f) => /^history-[\w.-]*\.mjs$/.test(f)).sort();

  it('CONTROL: the pattern sees each load form on a planted line, and not prose; the corpus holds the driver', () => {
    for (const planted of [
      "import { DatabaseSync } from 'node:sqlite';",
      'const { DatabaseSync } = await import("node:sqlite");',
      "const sqlite = createRequire(import.meta.url)('node:sqlite');",
      'const s = require(`node:sqlite`);',
    ]) expect(SQLITE_LOAD.test(planted), planted).toBe(true);
    expect(SQLITE_LOAD.test('// every store read opens through openReader, never node:sqlite directly')).toBe(false);
    expect(SQLITE_LOAD.test("import { DatabaseSync } from 'node:sqlite3';")).toBe(false);
    expect(historyMjs()).toContain('history-replay.mjs');
  });

  it('no deploy/history-*.mjs spells a node:sqlite load: every store read opens through store.mjs openReader', () => {
    const loaders = historyMjs().filter((f) => readFileSync(path.join(DEPLOY, f), 'utf8').split('\n').some((l) => SQLITE_LOAD.test(l)));
    expect(loaders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and see it fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
```

Expected (measured): red, `Test Files  1 failed (1)`, `Tests  no tests`, with `Error: Cannot find module '../../deploy/history-replay.mjs' imported from …/server/test/history-replay.test.ts`.

- [ ] **Step 4: Write the driver.** Create `deploy/history-replay.mjs`:

```js
#!/usr/bin/env node
// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
//
// An L4 operator script. The operator runs it by hand, from a shell OUTSIDE tmux, on a named node. It admits one
// account from the roster, spawns Claude Code headless under one fixed contract, reads the stream-json those spawns
// print, and writes every output under the operator's --out directory. Refusing to run inside a pane is main's first
// act (W2-D51, W2-D45).
//
// Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in
// any form: every store read W2 makes opens through store.mjs's read-only openReader (W2-D51), and
// history-replay.test.ts scans every deploy/history-*.mjs for it.
// Children: spawn with an argv array, never a shell, never a command string, and no env value in one (CodeQL's
// js/shell-command-injection-from-environment opens a review thread that blocks the merge).
// Environment: main gets the entry guard's by-name projection {HOME, TMUX_PANE, LANG}; nothing here passes
// process.env whole, and every other env read goes through main's env parameter.
// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's
// path, which W2-5b reaches through lib's historyPaths.
// Its words: DRIVER_REASONS, frozen once here and nowhere else (W2-D59, W2-D12; D-5774). A refusal prints
// `ccrc history-replay: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits EXIT.INTERNAL (1).
// They are never lib REASONS: §8.7's table and SKILL.md do not list them. EXIT is imported, never declared (O14).
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EXIT } from '../ccd/history/lib.mjs';

// ── the driver's words (W2-D59) ───────────────────────────────────────────
/** Every word the driver refuses with, in one frozen list. The first sixteen are W2-D59's, in its order (each owner
 *  PR raises its own). The last nine are W2-4's nine words (five plan-chosen, four by coordinator ruling), each kept apart from a lib REASONS word by design
 *  (C-J): `args-invalid` (an argv the grammar refuses; lib's is `bad-args`), `in-pane` (TMUX_PANE is set; lib's is
 *  `headless-in-pane`), `roster-invalid` (accounts.json absent, unreadable or refused by rosterFromJson; lib's is
 *  `roster-unreadable`), `account-refused` (W2-D52's admission), `input-invalid` (an input whose shape is wrong: a
 *  step 0a file whose sha matched, or a family id lib's idOk refuses), and, by coordinator ruling, `code-unmeasured`
 *  (a gate_code file that cannot be read; --allow-code-change never stamps it), `version-unmeasured` (a Claude Code
 *  --version that cannot be measured), `tree-unmeasured` (a release stamp that cannot be read; `tree-moved` stays
 *  for a measured mismatch) and `wrapper-unmeasured` (a generated account's wrapper that cannot be read;
 *  `wrapper-moved` stays for a measured mismatch). */
export const DRIVER_REASONS = Object.freeze([
  'family-unlisted', 'family-recall-off',
  'quiz-unanswerable', 'quiz-sha-mismatch',
  'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed',
  'limits-threshold', 'limits-stale', 'budget-exhausted',
  'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch',
  'assignment-mismatch',
  'out-refused',
  'args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid',
  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
]);

/** A refusal: one DRIVER_REASONS word and its detail. Any other throw is a defect (EXIT.INTERNAL). */
export class DriverRefusal extends Error {
  /** @param {string} word a DRIVER_REASONS member  @param {string} detail */
  constructor(word, detail) {
    if (!DRIVER_REASONS.includes(word)) throw new TypeError(`DriverRefusal: ${JSON.stringify(word)} is not a DRIVER_REASONS word`);
    super(`${word}: ${detail}`);
    this.name = 'DriverRefusal';
    /** @type {string} */
    this.word = word;
    /** @type {string} */
    this.detail = detail;
  }
}

/** Throws the refusal; never returns.
 *  @param {string} word  @param {string} detail  @returns {never} */
export function refuse(word, detail) {
  throw new DriverRefusal(word, detail);
}

// ── the argument grammar ──────────────────────────────────────────────────
/** @typedef {'string' | 'int' | 'bool'} FlagKind */
/** @typedef {Record<string, string | number | boolean>} Flags */
/** @typedef {Record<string, string | undefined>} DriverEnv */

/** Every flag the driver knows and its kind. A string or int flag takes the next argv entry as its value; a bool flag
 *  takes none. Each subcommand reads the flags it needs and refuses a missing required one itself. */
export const FLAG_SPECS = Object.freeze(/** @type {Record<string, FlagKind>} */ ({
  out: 'string',
  account: 'string',
  budget: 'int',
  'writer-model': 'string',
  'judge-model': 'string',
  'arm-model': 'string',
  'settings-mode': 'string',
}));

/** The subcommands, by name. Empty until Tasks 8 and 9 register `step0a` and `probe`, so every subcommand is
 *  args-invalid until then.
 *  @type {Map<string, (flags: Flags, env: DriverEnv) => Promise<number>>} */
export const HANDLERS = new Map();

const INT_TEXT = /^[1-9][0-9]*$/;

/** `<sub> [--flag value | --bool]...`: the subcommand first, then flags, each at most once. `--name=value` is not
 *  this grammar (it reads as an unknown flag). A value may not begin with `--`, so a flag left without its value never
 *  swallows the next flag. An int is a positive safe integer written in plain decimal.
 *  @param {string[]} argv
 *  @param {{specs?: Readonly<Record<string, FlagKind>>, subs?: Iterable<string>}} [opts] Tests pass their own sets;
 *    the driver passes none, so FLAG_SPECS and HANDLERS' keys answer.
 *  @returns {{sub: string, flags: Flags}} */
export function parseArgs(argv, opts = {}) {
  const specs = opts.specs ?? FLAG_SPECS;
  const subs = new Set(opts.subs ?? HANDLERS.keys());
  const sub = argv[0];
  if (sub === undefined || sub.startsWith('-')) refuse('args-invalid', 'no subcommand');
  if (!subs.has(sub)) refuse('args-invalid', `unknown subcommand ${JSON.stringify(sub)}`);
  /** @type {Flags} */
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const tok = /** @type {string} */ (argv[i]);
    if (!tok.startsWith('--')) refuse('args-invalid', `unexpected argument ${JSON.stringify(tok)}`);
    const name = tok.slice(2);
    if (!Object.hasOwn(specs, name)) refuse('args-invalid', `unknown flag ${JSON.stringify(tok)}`);
    if (Object.hasOwn(flags, name)) refuse('args-invalid', `repeated flag --${name}`);
    const kind = specs[name];
    if (kind === 'bool') { flags[name] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) refuse('args-invalid', `missing value for --${name}`);
    i += 1;
    if (kind === 'int') {
      const n = Number(value);
      if (!INT_TEXT.test(value) || !Number.isSafeInteger(n)) {
        refuse('args-invalid', `--${name} wants a positive integer, got ${JSON.stringify(value)}`);
      }
      flags[name] = n;
    } else {
      flags[name] = value;
    }
  }
  return { sub, flags };
}

// ── the pane refusal (W2-D51, W2-D45) ─────────────────────────────────────
const PANE_DETAIL = 'TMUX_PANE is set; run the driver from a shell outside tmux';

/** TMUX_PANE is set iff it is defined, so an empty value refuses too (W2-D45).
 *  @param {DriverEnv} env  @returns {DriverRefusal | null} */
export function paneRefusal(env) {
  return env.TMUX_PANE !== undefined ? new DriverRefusal('in-pane', PANE_DETAIL) : null;
}

// ── main ──────────────────────────────────────────────────────────────────
/** The pane first, then the grammar, then the handler. A refusal is one stderr line and EXIT.REFUSED; anything else
 *  thrown is a defect, one stderr line and EXIT.INTERNAL. Nothing is written to stdout here.
 *  @param {string[]} argv  @param {DriverEnv} env  @returns {Promise<number>} */
export async function main(argv, env) {
  try {
    const pane = paneRefusal(env);
    if (pane !== null) throw pane;
    const { sub, flags } = parseArgs(argv);
    const handler = /** @type {(flags: Flags, env: DriverEnv) => Promise<number>} */ (HANDLERS.get(sub));
    return await handler(flags, env);
  } catch (e) {
    if (e instanceof DriverRefusal) {
      process.stderr.write(`ccrc history-replay: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`ccrc history-replay: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
  }
}

// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised
// when main runs. Importing the module (the tests do) runs nothing. The exit code is set, never forced, so stderr drains.
// main gets a by-name projection of the environment, never process.env whole; an unset name stays undefined (W2-D45).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });
}
```

Then run `chmod 0755 deploy/history-replay.mjs`. The shebang is for the operator's direct run; every test runs it as `node <script>`.

- [ ] **Step 5: Run it green, then see the node-floor derivation red.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts -t 'the node-floor leg runs every history test file')
```

Expected (measured):
- `history-replay`: green, `Tests  35 passed (35)`. That is 3 word cases, 20 grammar cases (17 of them from the `it.each`), 5 RP2 cases, 5 `main` cases and 2 scan cases.
- `ci-pipeline`: red, `1 failed | 53 skipped`, with `AssertionError: the 22.16.0 leg does not run exactly the history test files — add the new one to its list: expected [ 'history-card.test.ts', …(17) ] to deeply equal [ 'history-card.test.ts', …(18) ]`. The diff shows `- "history-replay.test.ts"`.

This is W2-D5's red. The test file exists, and the node-floor leg does not run it yet.

- [ ] **Step 6: List the file in the node-floor heredoc.** In `.github/workflows/ci.yml`, inside the `node-floor` job's `Test` step, insert one line directly before the heredoc's closing `          EOF`, so the tail of the list reads:

```yaml
          test/history-card.test.ts
          test/history-replay.test.ts
          EOF
```

Do not edit anything else in the file. Run, in the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts -t 'the node-floor leg runs every history test file')
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
```

Expected (measured):
- the first: `1 passed | 53 skipped`;
- the second: `54 passed (54)`. The node-floor job's own case (`installs through server-deps and runs exactly its list`) also requires every listed file to exist and the list to be duplicate-free, and it holds.

The whole-file run needs a git checkout: its `git ls-files -z` case reds in a copy that is not a git tree.

- [ ] **Step 7: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter, shows it red, and restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/w2-4-t1.XXXXXX")"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/replay.orig"

# M1: the pane check removed from main, so a pane reaches the grammar.
mut deploy/history-replay.mjs '    const pane = paneRefusal(env);
    if (pane !== null) throw pane;
' ''
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'RP2')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 3 failed | 2 passed | 30 skipped: both spawned it.each rows and the "checked first" case,
# expected 'ccrc history-replay: args-invalid: un…' to be 'ccrc history-replay: in-pane: TMUX_PA…'.

# M2: an empty TMUX_PANE read as unset (W2-D45 says it is set).
mut deploy/history-replay.mjs 'return env.TMUX_PANE !== undefined ? new' 'return env.TMUX_PANE ? new'
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'RP2')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 3 failed | 2 passed | 30 skipped: "": expected null to be an instance of DriverRefusal,
# and the TMUX_PANE="" spawn answers args-invalid instead of in-pane.

# M3: a lib word added to the driver's list (C-J keeps them disjoint).
mut deploy/history-replay.mjs "  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
]);" "  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'bad-args',
]);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'disjoint from lib REASONS')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed | 34 skipped, expected [ 'bad-args' ] to deeply equal [].

# M4: a scratch copy of the driver that loads node:sqlite, planted under deploy/ as a history-*.mjs.
{ printf '%s\n' "import { DatabaseSync } from 'node:sqlite';"; cat deploy/history-replay.mjs; } > deploy/history-scratch.mjs
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'spells a node:sqlite load')
rm deploy/history-scratch.mjs
# Expected RED (measured): 1 failed | 34 skipped, expected [ 'history-scratch.mjs' ] to deeply equal [].

cmp deploy/history-replay.mjs "$SCRATCH/replay.orig" && test ! -e deploy/history-scratch.mjs && echo restored
rm -rf "$SCRATCH"
git status --short   # only this task's three paths
```

Then re-run the four filters on the restored tree. Expected green (measured):
- `-t 'RP2'`: `5 passed | 30 skipped`;
- `-t 'disjoint from lib REASONS'`: `1 passed | 34 skipped`;
- `-t 'spells a node:sqlite load|the pattern sees each load form'`: `2 passed | 33 skipped`;
- the whole file: `35 passed (35)`.

- [ ] **Step 8: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `typecheck-tests` is one):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only|every vocabulary is declared once')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts)
```

Expected:
- `single-definition`, O13 and O14 over `ALL_MJS` and `DECL_CORPUS`, which now hold the driver: `78 passed | 678 skipped` (measured). The driver names no switch path and declares no VOCABS name. It imports `EXIT` and never declares it.
- `typecheck-tests`: green (predicted). `server/tsconfig.json` has `allowJs`, so the test sees the driver's JSDoc types. Running `tsc -p test/tsconfig.tests.json` in the measuring copy reported no error in either new file; that copy lacked agent's and pwa's modules, so the case itself was not run.
- `topology-clean`: green (predicted; in the measuring copy, every case but the one that needs a published base on `origin` was green, `54 passed`). The new files name no host, account, lane or home path.
- `ci-pipeline`: `54 passed (54)` (measured).

The full suite runs in CI on this PR because of the `.github/` edit (W2-D5).

- [ ] **Step 9: Commit.** W2-D5 requires the test file and its heredoc line in one commit.

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts .github/workflows/ci.yml
git commit -m "feat(history): W2-4 Task 1 — the driver's entry, its words and the pane refusal; the test file joins the node-floor leg" -m "$CO_AUTHORED_BY"
```

### Task 2: The --out rule and the history-replay-out lifecycle class

Every file the driver writes goes under `--out`. That directory holds one W2 run's transcripts and scores, and they are private: only hashes and counts go public (§4 of the decisions). So `--out` belongs to the operator and the driver and to no one else. This task adds the rule from W2-D53:
- **A missing `--out`** is created mode 0700 under main's umask 077. Its parent must already exist; nothing is created recursively. A marker file `.ccrc-history-replay` holding exactly `ccrc-history-replay-out` is written inside it.
- **An existing `--out`** is reused only when all of these hold: it is a real directory (by lstat, not a symlink), it is owned by the caller's uid, its mode is exactly 0700, it is outside any git tree, and it holds that marker with exactly that content. Reuse is what lets a stopped batch resume (W2-D53, W2-D55).
- **Anything else** is refused with `out-refused` and a detail naming the one rule it broke.

**The git tree check** walks up from the realpath of the nearest ancestor that exists, looking for a `.git` entry of any type. So a worktree's `.git` file counts the same as a repository's `.git` directory. If an lstat fails with anything but ENOENT, the answer is *unmeasured*, and unmeasured refuses. It is never read as "outside", because an ancestor the walk cannot read may be hiding the `.git`.

**The lifecycle class.** The directory is the `history-replay-out` class of spec §9.4:2171, which this task declares under W2-D9. It splits O17's `'W2'` key into `'W2-1'` and `'W2-4'`, and lands `'W2-4'`.

**Line-disjoint with 5h-2 (W2-D3).**
- 5h-2's Task 4 edits only the `history-store-id` row (`shared/lifecycle.ts:64-66`) and its pin (`server/test/lifecycle.test.ts:1137-1152`).
- This task inserts after `shared/lifecycle.ts:100`, and edits `lifecycle.test.ts:1082` and `:1086` and inserts after `:1280`.
- Whichever PR lands second merges main and keeps both sides.

**Files:**
- Modify: `deploy/history-replay.mjs` (Task 1's file).
  - Task 1's single `import { … } from 'node:fs'` line gains any of `lstatSync`, `mkdirSync`, `readFileSync`, `realpathSync`, `statSync` and `writeFileSync` that it lacks. Never add a second `node:fs` import.
  - If Task 1 imports no `path`, add `import path from 'node:path';` next to it.
  - In `main`, add one statement, `process.umask(0o077);`, directly after the statement that acts on `paneRefusal(env)`'s answer and before the `parseArgs` call.
  - Add one section directly above the entry guard block, the one that begins `if (process.argv[1] && import.meta.url ===`. The entry guard stays the file's last block.
- Modify: `server/test/history-replay.test.ts` (Task 1's file).
  - Add eight aliased import lines at the end of Task 1's import block. The `t2` prefix means no name collides with Task 1's imports.
  - Append one describe at the end of the file.
- Modify: `shared/lifecycle.ts`. Add one comment and one row directly after the `history-card-files` row, whose last line is `    bound: 'one prediction per session id, until consumed or withdrawn, or 7 days after its session is purged', tier: '<=512 B per session', ruling: null },` (`:100`). They go before the `// #316:` comment.
- Modify: `server/test/lifecycle.test.ts`:
  - in `HISTORY_ROWS_BY_PR`, replace the line `    W2: ['history-recall-off', 'history-replay-out'],` (`:1082`);
  - replace the `HISTORY_LANDED` line (`:1086`);
  - add one `it()` directly after the B3 numbers case, which ends `    expect(LIFECYCLE.find((x) => x.name === 'history-card-files')!.tier).toBe(\`<=${CARD_LINE_MAX} B per session\`);` / `  });` (`:1279-1280`), and before the describe's closing `});`.
- Not edited: the spec. Its §9.4 row for `history-replay-out` (:2171) already says what this row says, and W2-4 never holds the spec path (W2-D3). The `ci.yml` line is Task 1's.

**Interfaces:**
- Consumes (Task 1, `deploy/history-replay.mjs`):
  - `DRIVER_REASONS`, which includes `'out-refused'`;
  - `class DriverRefusal extends Error { word; detail }` and `refuse(word, detail): never`;
  - `FLAG_SPECS.out === 'string'`;
  - `HANDLERS: Map`;
  - `parseArgs(argv)`, which accepts a subcommand registered in `HANDLERS`;
  - `paneRefusal(env)`;
  - `main(argv, env): Promise<number>`, which returns `EXIT.REFUSED` (2) on a `DriverRefusal`;
  - the entry guard, which does not run `main` when `process.argv[1]` is undefined (as it is under `node -e`).
- Consumes (base):
  - `LIFECYCLE` and `LifecycleClass` (`shared/lifecycle.ts`);
  - `HISTORY_ROWS_BY_PR`, `HISTORY_LANDED` and the O17 case (`server/test/lifecycle.test.ts:1077-1102`);
  - `mkTmp` (`server/test/tmpHelpers.ts:38`);
  - `scrubbedEnv` (`server/test/historyHelpers.ts:54`).
- Produces (`deploy/history-replay.mjs`):
  - `OUT_MARKER = '.ccrc-history-replay'`;
  - `OUT_KIND = 'ccrc-history-replay-out'`;
  - `insideGitTree(p: string): {state:'outside'} | {state:'inside', at: string} | {state:'unmeasured', at: string, code: string}`. `at` is the directory that holds the `.git` entry, or the path whose lstat failed;
  - `prepareOut(out: string, uid: number = process.getuid()): string`. It returns the `--out` realpath, or throws `DriverRefusal('out-refused', detail)` with detail one of `relative`, `parent-absent`, `in-git-tree <at>`, `git-unmeasured <at> <code>`, `symlink`, `not-directory`, `foreign-owner`, `mode <four octal digits>`, `marker-absent`, `marker-mismatch`;
  - module-private: `OUT_MARKER_MAX_BYTES = 64`, `errCode(e)`, `createOut(abs)`, `checkOut(abs, uid)`;
  - `main` calls `process.umask(0o077)` once, before any filesystem act. Task 8's and Task 9's handlers call `prepareOut(flags.out)` as their first filesystem act.
- Produces (`shared/lifecycle.ts`): the row `{ name: 'history-replay-out', root: 'the W2 driver\'s --out directory, operator-chosen outside any git tree, mode 0700, marked by .ccrc-history-replay', pattern: 'O', creators: ['deploy/history-replay.mjs'], collector: null, bound: 'one W2 run, until the W2 decision is recorded', tier: 'one W2 run\'s transcripts and scores', ruling: 'operator-made; removed by hand once the W2 decision is recorded' }`.
- Produces (`server/test/lifecycle.test.ts`):
  - `HISTORY_ROWS_BY_PR` keys `'W2-1': ['history-recall-off']` and `'W2-4': ['history-replay-out']`;
  - `HISTORY_LANDED = ['B1', 'B2', 'B3', 'B4', 'W2-4']`. W2-1 appends `'W2-1'` when it declares its row.

**Spec:**
- §10.2:2626-2627: "It writes only under `--out`, which it creates 0700 under umask 077. It refuses an `--out` inside a git tree."
- RP4 (:2743).
- §9.4's `history-replay-out` row (:2171).

**Decisions:** W2-D53 (the whole rule), W2-D9 (the key split, `HISTORY_LANDED`, the row), W2-D3 (line-disjoint with 5h-2). This task defines no D-number.

**Choices this task makes** (the coordinator accepted the three `--out` detail folds below as written: the `marker-mismatch` fold, the walk that crosses filesystems, and `git-unmeasured … ENOTDIR`):
- **A symlink at `--out` is refused before the git walk.** So a dangling symlink reads `symlink`, not an unmeasured realpath, and nothing is ever created through one. `path.resolve` drops a trailing slash first, so `link/` cannot make lstat follow the link.
- **A newly created `--out` passes through the same check as a reused one (`checkOut`).** There is one rule, and a umask that strips owner bits would show up as `mode …` instead of being trusted.
- **The marker is exactly `OUT_KIND`, with no newline.**
  - It is read once, bounded at 64 B, and only when it is a regular file.
  - A marker that is not a regular file, is longer than 64 B, or cannot be read back is `marker-mismatch`. The detail list has no third marker word, and the driver only ever reads back a marker it wrote itself.
- **The walk goes up to `/` and crosses filesystems.**
  - git stops at a filesystem boundary by default. Refusing more is the safe side.
  - The cost is that a `$HOME` that is itself a git repository refuses every `--out` under it, and the operator picks another root.
  - If the nearest existing ancestor is a regular file, the walk starts from that file's directory.
- **Only ENOENT moves the walk up**, as W2-D53 states. So `--out /some/file/out` is refused as `git-unmeasured /some/file/out ENOTDIR`, which is still a refusal and names its code.
- **`parent-absent` folds a `stat` failure into absence.** It is reached only after `insideGitTree` has lstat-ed every ancestor, and an ancestor it could not lstat was already refused as `git-unmeasured`.
- **`process.umask` acts on the whole process.**
  - Under vitest's fork pool the umask would carry 077 into later cases. Task 1's in-process `main` cases (its `withHandler` helper) save the worker's umask and restore it afterwards; no other test calls `main` in-process past the pane refusal.
  - The umask case runs `main` in a `node -e` child, with argv arrays and never a shell (the `history-lib.test.ts:488` precedent).
  - `prepareOut` itself does not depend on the umask: it passes `mode: 0o700` and `0o600` explicitly. So its cases run in-process.

- [ ] **Step 1: Confirm Task 1's names before using them.** From the repository root:

```bash
grep -c 'process.umask(' deploy/history-replay.mjs
grep -c "from 'node:fs'" deploy/history-replay.mjs
grep -c '^export class DriverRefusal extends Error' deploy/history-replay.mjs
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); d.HANDLERS.set('t2-check', async () => 0); console.log(d.DRIVER_REASONS.includes('out-refused'), d.FLAG_SPECS.out, JSON.stringify(d.parseArgs(['t2-check', '--out', '/x'])), d.paneRefusal({}) === null, typeof d.refuse, typeof d.main)"
```

Expected:
- the counts are 0, 1 and 1;
- the last line prints `true string {"sub":"t2-check","flags":{"out":"/x"}} true function function`.

A different answer is a gap in Task 1, most likely a `parseArgs` that checks subcommands against a fixed list instead of `HANDLERS`. Stop and report it. Never declare any of these names here.

- [ ] **Step 2: Write the failing `--out` tests.** In `server/test/history-replay.test.ts`, add these lines at the end of Task 1's import block:

```ts
// W2-4 Task 2 (the --out rule, W2-D53, RP4): aliased, so no name here collides with an import above.
import * as t2Fs from 'node:fs';
import * as t2Path from 'node:path';
import { spawnSync as t2SpawnSync } from 'node:child_process';
import { pathToFileURL as t2FileUrl } from 'node:url';
import * as t2Drv from '../../deploy/history-replay.mjs';
import { mkTmp as t2MkTmp } from './tmpHelpers.js';
import { scrubbedEnv as t2Scrubbed } from './historyHelpers.js';
```

Then append at the end of the file:

```ts

// ── W2-4 Task 2: the --out rule (W2-D53; spec §10.2 "creates 0700 under umask 077", "refuses an --out inside a git
// tree"; pin RP4) ──────────────────────────────────────────────────────────────────────────────────────────────────
// prepareOut is called in-process: it reads only the paths it is handed and the uid parameter. main's umask is
// measured in a child process, because process.umask would otherwise change this test worker's own.
describe('W2-4 Task 2: the --out rule, created 0700 with its marker, reused only when it is still exactly that (W2-D53, RP4)', () => {
  const T2_SCRIPT = t2Path.resolve(__dirname, '../../deploy/history-replay.mjs');
  const asRoot = process.getuid?.() === 0;
  /** A fresh fixture directory, by its realpath (a darwin TMPDIR is a symlink). */
  const base = (): string => t2Fs.realpathSync(t2MkTmp('ccrc-replay-out-'));
  /** The refusal a call throws, or null when it returns; any other throw fails the case. */
  const refusalOf = (fn: () => unknown): { word: string; detail: string } | null => {
    try { fn(); return null; } catch (e) {
      if (e instanceof t2Drv.DriverRefusal) return { word: e.word, detail: e.detail };
      throw e;
    }
  };
  const out = (word: string): { word: string; detail: string } => ({ word: 'out-refused', detail: word });
  const modeOf = (p: string): string => (t2Fs.lstatSync(p).mode & 0o7777).toString(8).padStart(4, '0');
  /** A valid --out, made by prepareOut itself. */
  const made = (b: string): string => t2Drv.prepareOut(t2Path.join(b, 'out'));

  it('CONTROL: a fresh fixture is outside any git tree, and the walk sees a planted .git directory and a planted .git file above a path that does not exist yet', () => {
    const b = base();
    expect(t2Drv.insideGitTree(b), 'the run temp dir sits inside a git tree: every --out case below would refuse').toEqual({ state: 'outside' });
    t2Fs.mkdirSync(t2Path.join(b, 'repo', '.git'), { recursive: true });
    expect(t2Drv.insideGitTree(t2Path.join(b, 'repo', 'a', 'b'))).toEqual({ state: 'inside', at: t2Path.join(b, 'repo') });
    t2Fs.mkdirSync(t2Path.join(b, 'wt'));
    t2Fs.writeFileSync(t2Path.join(b, 'wt', '.git'), 'gitdir: /nowhere/.git/worktrees/wt\n');
    expect(t2Drv.insideGitTree(t2Path.join(b, 'wt', 'out'))).toEqual({ state: 'inside', at: t2Path.join(b, 'wt') });
  });

  it.each([
    ['a .git directory', (r: string) => t2Fs.mkdirSync(t2Path.join(r, '.git'))],
    ['a .git file (a worktree)', (r: string) => t2Fs.writeFileSync(t2Path.join(r, '.git'), 'gitdir: /nowhere/.git/worktrees/r\n')],
  ])('RP4: an --out under %s is refused in-git-tree and never created', (_what, plant) => {
    const b = base();
    const repo = t2Path.join(b, 'repo');
    t2Fs.mkdirSync(repo);
    plant(repo);
    const o = t2Path.join(repo, 'out');
    expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(`in-git-tree ${repo}`));
    expect(t2Fs.existsSync(o), 'the refused --out was created').toBe(false);
  });

  it('RP4: a created --out is mode 0700 and holds the marker with OUT_KIND, and prepareOut answers its realpath', () => {
    expect(t2Drv.OUT_MARKER).toBe('.ccrc-history-replay');
    expect(t2Drv.OUT_KIND).toBe('ccrc-history-replay-out');
    const b = base();
    const o = t2Path.join(b, 'out');
    expect(t2Drv.prepareOut(o)).toBe(t2Fs.realpathSync(o));
    expect(modeOf(o)).toBe('0700');
    const marker = t2Path.join(o, t2Drv.OUT_MARKER);
    expect(t2Fs.lstatSync(marker).isFile()).toBe(true);
    expect(modeOf(marker)).toBe('0600');
    expect(t2Fs.readFileSync(marker, 'utf8')).toBe(t2Drv.OUT_KIND);
    expect(t2Fs.readdirSync(o)).toEqual([t2Drv.OUT_MARKER]);
  });

  it('a clean reuse is accepted and keeps what is there: an interrupted batch resumes (W2-D53)', () => {
    const b = base();
    const o = made(b);
    t2Fs.writeFileSync(t2Path.join(o, 'finished.run.json'), '{}\n');
    expect(t2Drv.prepareOut(o)).toBe(o);
    expect(t2Drv.prepareOut(`${o}/`), 'a trailing slash names the same directory').toBe(o);
    expect(t2Fs.readdirSync(o).sort()).toEqual([t2Drv.OUT_MARKER, 'finished.run.json'].sort());
  });

  /** Each reuse that W2-D53 refuses, planted beside a fresh base: [what, plant -> the --out to pass, the detail]. */
  const REUSE: ReadonlyArray<readonly [string, (b: string) => string, string]> = [
    ['a symlink to a valid --out', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(made(b), l); return l; }, 'symlink'],
    ['the same symlink named with a trailing slash', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(made(b), l); return `${l}/`; }, 'symlink'],
    ['a dangling symlink', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(t2Path.join(b, 'target'), l); return l; }, 'symlink'],
    ['a regular file', (b) => { const f = t2Path.join(b, 'out'); t2Fs.writeFileSync(f, ''); return f; }, 'not-directory'],
    ['mode 0750', (b) => { const o = made(b); t2Fs.chmodSync(o, 0o750); return o; }, 'mode 0750'],
    ['mode 0700 with the sticky bit', (b) => { const o = made(b); t2Fs.chmodSync(o, 0o1700); return o; }, 'mode 1700'],
    ['an empty 0700 directory with no marker', (b) => { const o = t2Path.join(b, 'out'); t2Fs.mkdirSync(o, { mode: 0o700 }); t2Fs.chmodSync(o, 0o700); return o; }, 'marker-absent'],
    ['a marker holding another word', (b) => { const o = made(b); t2Fs.writeFileSync(t2Path.join(o, t2Drv.OUT_MARKER), 'something-else'); return o; }, 'marker-mismatch'],
    ['a marker holding OUT_KIND and a newline', (b) => { const o = made(b); t2Fs.writeFileSync(t2Path.join(o, t2Drv.OUT_MARKER), `${t2Drv.OUT_KIND}\n`); return o; }, 'marker-mismatch'],
    ['a marker that is a directory', (b) => { const o = made(b); const m = t2Path.join(o, t2Drv.OUT_MARKER); t2Fs.rmSync(m); t2Fs.mkdirSync(m); return o; }, 'marker-mismatch'],
  ];

  it.each(REUSE)('W2-D53: %s is refused, and nothing is created in its place', (_what, plant, detail) => {
    const b = base();
    const o = plant(b);
    const before = t2Fs.readdirSync(b).sort();
    expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(detail));
    expect(t2Fs.readdirSync(b).sort(), 'the refusal created something').toEqual(before);
  });

  it('W2-D53: an --out another uid owns is refused foreign-owner (the uid is a parameter, so no second account is needed)', () => {
    const o = made(base());
    expect(refusalOf(() => t2Drv.prepareOut(o, process.getuid!() + 1))).toEqual(out('foreign-owner'));
    expect(t2Drv.prepareOut(o, process.getuid!()), 'CONTROL: the caller\'s own uid is accepted').toBe(o);
  });

  it('a relative --out is refused, and a missing parent is never created: no recursive create', () => {
    expect(refusalOf(() => t2Drv.prepareOut('rel/out'))).toEqual(out('relative'));
    expect(refusalOf(() => t2Drv.prepareOut(''))).toEqual(out('relative'));
    const b = base();
    expect(refusalOf(() => t2Drv.prepareOut(t2Path.join(b, 'no', 'such', 'out')))).toEqual(out('parent-absent'));
    expect(t2Fs.existsSync(t2Path.join(b, 'no')), 'a missing parent was created').toBe(false);
  });

  it.skipIf(asRoot)('an ancestor the walk cannot lstat is unmeasured, and unmeasured refuses: never read as outside', () => {
    const b = base();
    const locked = t2Path.join(b, 'locked');
    t2Fs.mkdirSync(locked);
    t2Fs.chmodSync(locked, 0o000);
    try {
      const o = t2Path.join(locked, 'out');
      expect(t2Drv.insideGitTree(o)).toEqual({ state: 'unmeasured', at: o, code: 'EACCES' });
      expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(`git-unmeasured ${o} EACCES`));
    } finally {
      t2Fs.chmodSync(locked, 0o700);
    }
    expect(t2Fs.readdirSync(locked), 'the refused --out was created').toEqual([]);
  });

  it('main sets umask 077 before any file act: a file the handler writes with the default mode lands 0600 (child process)', () => {
    const b = base();
    const o = t2Path.join(b, 'out');
    // A handler registered for this case only, in a child that starts under umask 022: only main's own umask can
    // make the probe 0600. Argv arrays, never a shell.
    const code = [
      `const d = await import(${JSON.stringify(t2FileUrl(T2_SCRIPT).href)});`,
      'const fs = await import(\'node:fs\');',
      'process.umask(0o022);',
      'd.HANDLERS.set(\'t2-umask\', async (flags) => { const real = d.prepareOut(flags.out); fs.writeFileSync(real + \'/probe\', \'x\'); return 0; });',
      `process.exitCode = await d.main(['t2-umask', '--out', ${JSON.stringify(o)}], { HOME: ${JSON.stringify(b)} });`,
    ].join('\n');
    const r = t2SpawnSync(process.execPath, ['--input-type=module', '-e', code],
      { encoding: 'utf8', env: { ...t2Scrubbed(process.env), HOME: b }, timeout: 60_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(modeOf(t2Path.join(o, 'probe')), 'main set no umask 077 before the handler').toBe('0600');
    expect(modeOf(o)).toBe('0700');
  });

  it('the driver sets its umask once, to 077', () => {
    const src = t2Fs.readFileSync(T2_SCRIPT, 'utf8');
    expect(src.match(/process\.umask\(/g) ?? []).toHaveLength(1);
    expect(src).toContain('process.umask(0o077);');
  });
});
```

The `node -e` child leaves `process.argv[1]` undefined, so Task 1's entry guard does not run `main` a second time when the child imports the module.

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2')
```

Expected: red, `20 failed` (measured against a stand-in for Task 1's names). The failures read:
- `TypeError: insideGitTree is not a function`;
- `TypeError: prepareOut is not a function`;
- `expected undefined to be '.ccrc-history-replay'`;
- in the umask case, `expected 1 to be 0`, because `main` turns the TypeError into `EXIT.INTERNAL`;
- in the scan, `expected [] to have a length of 1 but got +0`.

- [ ] **Step 4: Write the `--out` rule.** In `deploy/history-replay.mjs`:

(a) Extend Task 1's single `node:fs` import so that it names `lstatSync`, `mkdirSync`, `readFileSync`, `realpathSync`, `statSync` and `writeFileSync`. If the file has no `import path from 'node:path';`, add it next to the `node:fs` import.

(b) In `main`, insert this one line directly after the statement that acts on `paneRefusal(env)`'s answer and before the `parseArgs` call:

```js
    process.umask(0o077);   // W2-D53: before any filesystem act, so every file and directory under --out is the operator's alone
```

Check: `grep -c 'process.umask(' deploy/history-replay.mjs` prints 1.

(c) Insert this section directly above the entry guard block that begins `if (process.argv[1] && import.meta.url ===`:

```js
// ── W2-4 Task 2: the --out directory (W2-D53; spec §10.2 "It writes only under --out, which it creates 0700 under
// umask 077" and "It refuses an --out inside a git tree"; pin RP4) ───────────────────────────────────────────────
// Every file the driver writes lands under --out, and --out holds one W2 run's transcripts and scores, which are
// private (§4 of the W2 decisions: only hashes and counts go public). So the directory is the operator's and the
// driver's alone: created 0700 under main's umask 077, marked with OUT_MARKER holding exactly OUT_KIND, and reused
// only when it is still exactly that. Reuse is what lets a stopped batch resume (W2-D53, W2-D55): finished runs are
// skipped. Nothing in the tree removes it; it is shared/lifecycle.ts's history-replay-out row (O, collector null):
// removed by hand once the W2 decision is recorded (W2-D9).
//   - A git tree is refused wherever it is found, at any depth above --out: a `.git` entry of ANY type, so a
//     worktree's `.git` file counts as a repository's directory does. The walk starts from the realpath of the
//     nearest ancestor that exists, because --out may not exist yet.
//   - An lstat that fails with anything but ENOENT is UNMEASURED, and unmeasured refuses: it is never read as
//     "outside" (an unreadable ancestor may hold the `.git` the walk cannot see).
//   - Never a recursive create: the parent is the operator's to make, so a typo cannot grow a tree.
export const OUT_MARKER = '.ccrc-history-replay';
export const OUT_KIND = 'ccrc-history-replay-out';
/** A marker longer than this is not one the driver wrote: the bound on the one read of it. */
const OUT_MARKER_MAX_BYTES = 64;

const errCode = (e) => String(e?.code ?? 'unknown');

/** Whether `p`, or the nearest of its ancestors that exists, sits inside a git tree. */
export function insideGitTree(p) {
  let cur = path.resolve(p);
  for (;;) {
    try { lstatSync(cur); break; } catch (e) {
      if (e?.code !== 'ENOENT') return { state: 'unmeasured', at: cur, code: errCode(e) };
    }
    const up = path.dirname(cur);
    if (up === cur) return { state: 'unmeasured', at: cur, code: 'ENOENT' };
    cur = up;
  }
  let dir;
  try {
    const real = realpathSync(cur);
    dir = lstatSync(real).isDirectory() ? real : path.dirname(real);   // an existing file: its own directory
  } catch (e) {
    return { state: 'unmeasured', at: cur, code: errCode(e) };
  }
  for (;;) {
    const dotGit = path.join(dir, '.git');
    try { lstatSync(dotGit); return { state: 'inside', at: dir }; } catch (e) {
      if (e?.code !== 'ENOENT') return { state: 'unmeasured', at: dotGit, code: errCode(e) };
    }
    const up = path.dirname(dir);
    if (up === dir) return { state: 'outside' };
    dir = up;
  }
}

/** Make or reuse --out, and answer its realpath; refuse out-refused with a detail naming the one rule it broke. */
export function prepareOut(out, uid = process.getuid()) {
  if (typeof out !== 'string' || !path.isAbsolute(out)) refuse('out-refused', 'relative');
  const abs = path.resolve(out);   // no trailing slash, so lstat never follows a symlink named `link/`
  let pre;
  try { pre = lstatSync(abs).isSymbolicLink() ? 'symlink' : 'present'; } catch (e) {
    pre = e?.code === 'ENOENT' ? 'absent' : 'unmeasured';   // unmeasured: insideGitTree answers it below, at abs
  }
  if (pre === 'symlink') refuse('out-refused', 'symlink');
  const git = insideGitTree(abs);
  if (git.state === 'inside') refuse('out-refused', `in-git-tree ${git.at}`);
  if (git.state === 'unmeasured') refuse('out-refused', `git-unmeasured ${git.at} ${git.code}`);
  if (pre === 'absent') createOut(abs);
  return checkOut(abs, uid);
}

/** A missing --out: its parent must already be a directory. 0700 under main's umask 077, then the marker. */
function createOut(abs) {
  // insideGitTree has measured every ancestor: one it could not lstat refused above, so a failure here is absence.
  let parentIsDir = false;
  try { parentIsDir = statSync(path.dirname(abs)).isDirectory(); } catch { parentIsDir = false; }
  if (!parentIsDir) refuse('out-refused', 'parent-absent');
  mkdirSync(abs, { mode: 0o700 });
  writeFileSync(path.join(abs, OUT_MARKER), OUT_KIND, { mode: 0o600, flag: 'wx' });
}

/** The reuse rule, which a directory just created passes through too: a real directory, the caller's, mode exactly
 *  0700, holding the marker with exactly OUT_KIND. */
function checkOut(abs, uid) {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) refuse('out-refused', 'symlink');
  if (!st.isDirectory()) refuse('out-refused', 'not-directory');
  if (st.uid !== uid) refuse('out-refused', 'foreign-owner');
  const mode = st.mode & 0o7777;
  if (mode !== 0o700) refuse('out-refused', `mode ${mode.toString(8).padStart(4, '0')}`);
  const marker = path.join(abs, OUT_MARKER);
  let ms;
  try { ms = lstatSync(marker); } catch (e) {
    if (e?.code === 'ENOENT') refuse('out-refused', 'marker-absent');
    throw e;
  }
  if (!ms.isFile() || ms.size > OUT_MARKER_MAX_BYTES) refuse('out-refused', 'marker-mismatch');
  let text = null;
  try { text = readFileSync(marker, 'utf8'); } catch { text = null; }   // a marker the driver cannot read back is not one it wrote
  if (text !== OUT_KIND) refuse('out-refused', 'marker-mismatch');
  return realpathSync(abs);
}
```

Check: `node --check deploy/history-replay.mjs` prints nothing.

- [ ] **Step 5: Run them and see them pass.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
```

Expected:
- the first is green, `20 passed` (measured). As root, the unmeasured case is skipped: `19 passed | 1 skipped`;
- the second is green as a whole: Task 1's cases plus these 20.

- [ ] **Step 6: Measure every new driver guard red, then green.** Run this from the repository root. Each block applies an exact replacement and asserts the number of times it matches. It then runs one filter, which must show red, and restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$(mktemp -d)"
mut() {   # mut <file> <old> <new> [count]: exact replacement, asserted to match `count` times (default 1)
  python3 - "$1" "$2" "$3" "${4:-1}" <<'EOF'
import sys
p, old, new, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
s = open(p).read()
assert s.count(old) == n, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
D=deploy/history-replay.mjs
cp "$D" "$SCRATCH/drv.orig"

# M1: accept a symlinked --out (lstat replaced by stat, which follows the link, in both places).
mut "$D" "lstatSync(abs)" "statSync(abs)" 2
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*symlink')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 3 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

# M2: accept mode 0750 (only the owner bits checked).
mut "$D" "  if (mode !== 0o700) refuse(" "  if ((mode & 0o700) !== 0o700) refuse("
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*(mode 0750|sticky bit)')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 2 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

# M3: skip the marker's content check.
mut "$D" "  if (text !== OUT_KIND) refuse('out-refused', 'marker-mismatch');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*a marker holding')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 2 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

# M3b: adopt an unmarked directory (an absent marker accepted).
mut "$D" "    if (e?.code === 'ENOENT') refuse('out-refused', 'marker-absent');" "    if (e?.code === 'ENOENT') return realpathSync(abs);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*with no marker')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

# M4: an unmeasured ancestor read as outside.
mut "$D" "      if (e?.code !== 'ENOENT') return { state: 'unmeasured', at: cur, code: errCode(e) };" "      if (e?.code !== 'ENOENT') return { state: 'outside' };"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*cannot lstat is unmeasured')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured; skipped as root): 1 failed, expected { state: 'outside' } to deeply equal { state: 'unmeasured', …(2) }.

# M5: main sets no umask.
mut "$D" "    process.umask(0o077);   // W2-D53: before any filesystem act, so every file and directory under --out is the operator's alone
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*umask')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 2 failed, main set no umask 077 before the handler: expected '0644' to be '0600', and
# expected [] to have a length of 1 but got +0.

# M6: a recursive create (the parent check dropped and mkdir made recursive).
mut "$D" "  if (!parentIsDir) refuse('out-refused', 'parent-absent');
" ""
mut "$D" "mkdirSync(abs, { mode: 0o700 });" "mkdirSync(abs, { mode: 0o700, recursive: true });"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*no recursive create')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

# M7: only a .git DIRECTORY counts (a worktree's .git file read as absent).
mut "$D" "    try { lstatSync(dotGit); return { state: 'inside', at: dir }; } catch (e) {" "    try { if (!lstatSync(dotGit).isDirectory()) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return { state: 'inside', at: dir }; } catch (e) {"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*RP4: an --out under')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 1 failed | 1 passed (the .git file case reds; the directory case stays green).

# M8: any owner accepted.
mut "$D" "  if (st.uid !== uid) refuse('out-refused', 'foreign-owner');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 2.*foreign-owner')
cp "$SCRATCH/drv.orig" "$D"
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'out-refused', …(1) }.

cmp "$D" "$SCRATCH/drv.orig" && rm -rf "$SCRATCH"
git diff --stat -- deploy/history-replay.mjs   # this task's edits only (and Task 1's, if not yet committed)
```

Then run Step 5's first command once more. It is green.

- [ ] **Step 7: Write the failing lifecycle test.** In `server/test/lifecycle.test.ts`, replace the one line

```ts
    W2: ['history-recall-off', 'history-replay-out'],
```

with

```ts
    'W2-1': ['history-recall-off'],
    'W2-4': ['history-replay-out'],
```

Next, replace the one line

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3', 'B4'];
```

with

```ts
  const HISTORY_LANDED: readonly HistoryPr[] = ['B1', 'B2', 'B3', 'B4', 'W2-4'];
```

Then, directly after the two lines

```ts
    expect(LIFECYCLE.find((x) => x.name === 'history-card-files')!.tier).toBe(`<=${CARD_LINE_MAX} B per session`);
  });
```

(the B3 numbers case's end), insert:

```ts

  // ── ccrc history W2-4 (spec 2026-10-05 §9.4, O17's W2-4 half; W2-D9, W2-D53) ──────────────────────────────────────
  // The replay driver's --out. Operator-made: the operator names the directory and removes it by hand once the W2
  // decision is recorded, so the class has no collector and carries the ruling instead. The marker's name in the
  // row is the code's own: the manifest is L0 and imports nothing, so it is bound here, as the B3 numbers are above.
  it('declares history-replay-out: the W2 driver\'s --out, an O class it creates, with no collector, removed by hand once the W2 decision is recorded', async () => {
    const c = LIFECYCLE.find((x) => x.name === 'history-replay-out');
    expect(c, 'shared/lifecycle.ts declares no history-replay-out class').toBeTruthy();
    expect(c!.pattern).toBe('O');
    expect(c!.creators).toEqual(['deploy/history-replay.mjs']);
    expect(c!.collector).toBeNull();
    expect(c!.ruling).toContain('removed by hand once the W2 decision is recorded');
    expect(c!.bound).toBe('one W2 run, until the W2 decision is recorded');
    expect(c!.root).toContain('outside any git tree');
    expect(c!.root).toContain('mode 0700');
    const { OUT_MARKER } = await import('../../deploy/history-replay.mjs');
    expect(c!.root, 'the row names another marker than the driver writes').toContain(`marked by ${OUT_MARKER}`);
  });
```

The O17 case is not edited. Its thirteen-class count holds: 6 + 1 + 2 + 1 + 1 + 1 + 1.

- [ ] **Step 8: Run it and see it fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'O17|history-replay-out')
```

Expected: red, `2 failed | 78 skipped` (measured). The two failures read:
- `history-replay-out lands in W2-4, which has landed, and shared/lifecycle.ts declares no such class: expected false to be true`;
- `shared/lifecycle.ts declares no history-replay-out class: expected undefined to be truthy`.

- [ ] **Step 9: Declare the row.** In `shared/lifecycle.ts`, directly after the line

```ts
    bound: 'one prediction per session id, until consumed or withdrawn, or 7 days after its session is purged', tier: '<=512 B per session', ruling: null },
```

(the `history-card-files` row's last line, `:100`), insert:

```ts
  // ccrc history, W2-4 (spec 2026-10-05 §9.4, §10.2; W2-D9, W2-D53): the replay driver's --out. The operator names it;
  // the driver creates it 0700 under umask 077 with its marker, or reuses one that still passes every check, so a
  // stopped batch resumes. Nothing in the tree removes it: it holds one W2 run's evidence until the decision is recorded.
  { name: 'history-replay-out', root: 'the W2 driver\'s --out directory, operator-chosen outside any git tree, mode 0700, marked by .ccrc-history-replay', pattern: 'O',
    creators: ['deploy/history-replay.mjs'], collector: null,
    bound: 'one W2 run, until the W2 decision is recorded', tier: 'one W2 run\'s transcripts and scores',
    ruling: 'operator-made; removed by hand once the W2 decision is recorded' },
```

The file stays L0 and imports nothing. The `// #316:` comment and the `server-test-run-dirs` row stay below it, unchanged.

- [ ] **Step 10: Run it and see it pass, then measure the lifecycle guards red.** In the foreground:

```bash
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'O17|history-replay-out')
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
```

Expected:
- `2 passed | 78 skipped` (measured);
- the whole file green, `80 passed` (measured: the base's 79 plus this one). That includes `every history class names its creators and its tier` and `every collector-less class carries a non-empty operator ruling` over the new row.

Then run the three mutants, from the repository root:

```bash
SCRATCH="$(mktemp -d)"
cp shared/lifecycle.ts "$SCRATCH/lc.orig"; cp server/test/lifecycle.test.ts "$SCRATCH/lct.orig"; cp deploy/history-replay.mjs "$SCRATCH/drv.orig"

# M9: the row names another creator.
python3 - shared/lifecycle.ts <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read(); old = "    creators: ['deploy/history-replay.mjs'], collector: null,"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, "    creators: ['deploy/history-replay'], collector: null,"))
EOF
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'O17|history-replay-out')
cp "$SCRATCH/lc.orig" shared/lifecycle.ts
# Expected RED (measured): 1 failed | 1 passed, expected [ 'deploy/history-replay' ] to deeply equal [ 'deploy/history-replay.mjs' ].

# M10: the row declared while W2-4 is not landed.
python3 - server/test/lifecycle.test.ts <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read(); old = "['B1', 'B2', 'B3', 'B4', 'W2-4']"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, "['B1', 'B2', 'B3', 'B4']"))
EOF
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'O17|history-replay-out')
cp "$SCRATCH/lct.orig" server/test/lifecycle.test.ts
# Expected RED (measured): 1 failed | 1 passed, history-replay-out lands in W2-4 and is declared before it: expected true to be false.

# M11: the driver writes another marker than the row names.
python3 - deploy/history-replay.mjs <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read(); old = "export const OUT_MARKER = '.ccrc-history-replay';"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, "export const OUT_MARKER = '.ccrc-replay';"))
EOF
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'history-replay-out')
cp "$SCRATCH/drv.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, the row names another marker than the driver writes: expected 'the W2 driver\'s --out directory, ope…' to contain 'marked by .ccrc-replay'.

cmp shared/lifecycle.ts "$SCRATCH/lc.orig" && cmp server/test/lifecycle.test.ts "$SCRATCH/lct.orig" && cmp deploy/history-replay.mjs "$SCRATCH/drv.orig" && rm -rf "$SCRATCH"
```

Then run the first command of this step once more. It is green.

- [ ] **Step 11: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes).

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `history-replay` and `lifecycle` green, as in Steps 5 and 10.
- `single-definition -t 'ccrc history'`: `92 passed` (measured with this section in `deploy/`). O13's `ALL_MJS` and O14's `DECL_CORPUS` read the driver, which declares no VOCABS name and spells no switch path.
- tsc prints no line naming this task's files. A line naming only a module the worktree did not install (measured: `workflow-yaml-parses.test.ts`'s `yaml`) comes from the install, not this task.

- [ ] **Step 12: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts shared/lifecycle.ts server/test/lifecycle.test.ts
git commit -m "feat(history): W2-4 Task 2 — the --out rule and the history-replay-out lifecycle class" -m "$CO_AUTHORED_BY"
```

### Task 3: Account admission from the roster, before any spawn

The driver must not run Claude Code as just any account. W2-D52 sets the rule: read `$HOME/.ccrc/accounts.json` once, validate it with `shared/roster-json.mjs`'s `rosterFromJson`, and read `exec.kind`, `exec.provider` and `hidden` from that same parsed object. `rosterFromJson` validates `provider` and `hidden` but returns neither, and `shared/` is not edited. Admission is an allow-list (spec §10.2 "Account and budget", :2689). It admits only:
- `upstream`;
- `generated` whose provider is `anthropic`. The provider is the one the roster's own reader answers (coordinator ruling): a `generated` account with no declared `provider` reads as `anthropic`, the default `parseRoster` applies (`shared/roster.ts` near `:123`) and `rosterFromJson` applies for its own gates (`shared/roster-json.mjs:377-383`), so it is admitted when its secrets file passes.

Every other kind is refused, whatever provider it declares; an `external` account with no declared provider stays refused (RP3). The gateway lanes are `external`, so a deny-list keyed on `codex` or `openai` would fail open. A `generated` account is also refused when:
- it declares no `secretsFile`;
- its `secretsFile` is absent, not a regular file, or unreadable (RP9).

A `hidden` account is refused, and so is an `upstream` account whose config dir is not exactly `$HOME/.claude`. The launch path and the config dir come from the roster:
- `generated` launches `$HOME/.local/bin/<id>`, its own ccrc-generated wrapper, which sources the secrets file;
- `upstream` launches `$HOME/.local/bin/<roster upstreamId>`.

This task builds the two functions and pins them at function level. Task 8 pins the "before any spawn" half of RP3 and RP9 through the `step0a` subcommand, where the stub's log must be absent.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) The import block. After this task, the module binds `accessSync`, `constants`, `readFileSync` and `statSync` from `node:fs`, `join` from `node:path`, and `rosterFromJson` and `RosterInvalid` from `../shared/roster-json.mjs`. Each is bound exactly once (Step 4(a)).
  - (b) One section, inserted directly above the first line of Task 1's entry guard, `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. The guard stays the file's last block.
- Modify: `server/test/history-replay.test.ts`.
  - (a) The import block (Step 2(a)).
  - (b) Three module-level declarations (`fixtureAccount`, `FIXTURE_ACCOUNTS`, `writeRoster`), which later tasks call from their own describes, then one `describe`, appended at the end of the file. No top-level name of Task 1 or Task 2 is one of these three; every other helper is scoped to the describe.
- Not edited:
  - `shared/roster-json.mjs`, `shared/roster.ts` and `shared/wrapper.mjs` (W2-D52: `shared/` is not edited);
  - any other test file;
  - `ccd/**`.

**Interfaces:**
- Consumes (Task 1, `deploy/history-replay.mjs`):
  - `class DriverRefusal extends Error { word; detail }`. Its constructor throws `TypeError` for a word outside `DRIVER_REASONS`.
  - `refuse(word, detail): never`.
  - `DRIVER_REASONS`, which already holds `'roster-invalid'` and `'account-refused'` (two of W2-4's nine words: five plan-chosen, four by coordinator ruling).
  - The `realpathSync` binding of the entry guard. Only mutant M5 uses it.
- Consumes (base):
  - `rosterFromJson(json): RosterJson` (`shared/roster-json.mjs:568`). It throws `RosterInvalid` (`:221`, whose `message` is the operator-facing sentence).
  - `RosterJson.accounts[].{id, configDirSuffix, execKind, secretsFile}` and `RosterJson.upstreamId` (`shared/roster-json.d.mts`).
  - Test side: `mkTmp(prefix)` (`server/test/tmpHelpers.ts:38`, a realpath'd fixture dir, removed `afterAll`) and `scrubbedEnv(base)` (`server/test/historyHelpers.ts:54`).
- Produces (`deploy/history-replay.mjs`, exported):
  - `readRoster(home: string): {json: object, roster: RosterJson}`. It throws `DriverRefusal('roster-invalid', detail)`, where `detail` is one of:
    - `'absent'`;
    - `'unreadable <code>'`;
    - `'not-json'`;
    - the `RosterInvalid` message, verbatim.
  - `admitAccount(json: object, roster: RosterJson, id: string, home: string): LaunchSpec`, where `LaunchSpec = {accountId: string, kind: 'upstream'|'generated', launcher: string, configDir: string, wrapperPath: string|null, secretsPath: string|null}`:
    - for `generated`, `wrapperPath === launcher` and `secretsPath` is `join(home, secretsFile)`;
    - for `upstream`, both are `null`.
  - Refusals are `DriverRefusal('account-refused', detail)`, where `detail` is one of `'unknown-id'`, `'hidden'`, `'kind-codex'`, `'kind-external'`, `'provider-<p>'`, `'secrets-undeclared'`, `'secrets-absent'`, `'secrets-not-regular'`, `'secrets-unreadable'` or `'upstream-config-dir'`.
  - If `json` and `roster` disagree about `id`, the caller has a defect. The answer is `TypeError` (exit 1 through `main`), never a refusal.
  - Module-private: `admitUpstream(acct, roster, home)`, `admitGenerated(raw, acct, home)`, `secretsRefusal(p)`.
- Produces (test side):
  - at module level, because Tasks 5, 6, 8 and 9 call them from their own describes: `fixtureAccount(id, exec, extra?)`, `FIXTURE_ACCOUNTS` (the twelve fixture rows `up-a`, `gen-a`, `gen-o`, `cx-a`, `ext-n`, `ext-a`, `gen-h`, `gen-u`, `gen-s`, `gen-m`, `gen-r`, plus `gen-d`, a secretsFile that is a directory) and `writeRoster(home, accounts)`;
  - scoped to the new describe: `admitHome()`, `refusalOf(f)`, `verdict(home, id)`, `plantCredentialFifos(home)`, `ADMIT_CHILD`, `ADMIT_DRIVER`, `IS_ROOT`.

**Decisions:**
- W2-D52: read once with `rosterFromJson`; `exec.provider` and `hidden` from the same parsed object; the admitted set; every refusal; the launch path and config dir from the roster.
- Spec §10.2 "Account and budget" (:2689, :2696).
- RP3 and RP9 (:2742, :2748); the CT4 row (:388).

**Choices this task makes:**
- **An undeclared provider on `generated` reads as `anthropic` and is admitted (coordinator ruling).** An account's provider is the one the roster's single reader answers: `parseRoster` parses an absent provider on `generated` as `anthropic`, with a warning (`shared/roster.ts` near `:123`), and `rosterFromJson` defaults it the same way for its own gates (`shared/roster-json.mjs:377-383`). Admission applies that default to the provider it reads from the parsed object, so `gen-u` is admitted. The default is for `generated` only: an `external` account with no declared provider is refused by kind (`kind-external`, RP3), whatever it declares. The literal reading (refuse `provider-undeclared`) is now mutant M4, which reds the admitted case. The PR body records the ruling.
- **The kinds are checked in a fixed order:**
  - an unknown id first;
  - then `hidden`, whatever the kind;
  - then the kind.
  The refusal's detail for a kind outside the allow-list is `kind-${kind}`. That is `kind-codex` or `kind-external` today, and a kind a later roster adds is refused by the same line, with no edit.
- **The secrets file is checked the way the wrapper reads it, with stricter outcomes.** The wrapper's guard is `[ -r "$HOME/<secretsFile>" ] && . …` (`shared/wrapper.mjs:144`).
  - `statSync` follows a symlink, as `[ -r ]` does.
  - `ENOENT` or `ENOTDIR` reads as `secrets-absent`, so a dangling symlink is absent. Any other stat error reads as `secrets-unreadable`.
  - A non-regular target is refused `secrets-not-regular`. `[ -r ]` is true for a readable directory, whose `.` then fails, so the driver is stricter than the wrapper here.
  - Then `accessSync(R_OK)`. The file is never opened.
- **A config dir's credentials file is never read or named here (RP9).** Two pins hold this:
  - a FIFO test: a read would block the child until its deadline;
  - a source scan: the module never spells the file name.
- **The launcher's existence is not checked here.** A missing launcher is a spawn failure, which Task 5 reports.
- **Extra fixtures:**
  - `gen-d`, so that "a directory: refused" (RP9) has a row of its own;
  - two symlink cases, which pin "follows, as `[ -r ]` does".
- **No fixture holds a key.** Admission never opens a secrets file, so each file holds one comment line.

- [ ] **Step 1: Confirm Task 1's and Task 2's names before using them.** From the repository root:

```bash
grep -c '^export class DriverRefusal extends Error' deploy/history-replay.mjs
grep -cE '^(export )?function refuse\(' deploy/history-replay.mjs
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(d.DRIVER_REASONS.includes('roster-invalid'), d.DRIVER_REASONS.includes('account-refused'), new d.DriverRefusal('account-refused', 'x').word, typeof d.readRoster, typeof d.admitAccount)"
grep -nE "^import .* from '(node:fs|node:path|\.\./shared/roster-json\.mjs)';$" deploy/history-replay.mjs
grep -nE "^import .* from '(vitest|node:child_process|node:fs|node:path|node:url|\./tmpHelpers\.js|\./historyHelpers\.js|\.\./\.\./deploy/history-replay\.mjs)';$" server/test/history-replay.test.ts
```

Expected:
- The first three counts are each 1.
- The `node` line prints `true true account-refused undefined undefined`. With `-e`, `process.argv[1]` is unset, so importing the module never runs `main`.
- The two `grep -n` listings show the import lines that Steps 2(a) and 4(a) extend.

A 0, an exception, or a word that is missing from `DRIVER_REASONS` is a gap in Task 1. Stop and report it. Never declare any of these names here.

- [ ] **Step 2: Write the failing tests.**

(a) The imports of `server/test/history-replay.test.ts`. After this edit, the file binds each of the following names exactly once:

| Specifier | Names |
|---|---|
| `'vitest'` | `describe`, `it`, `expect` |
| `'node:child_process'` | `spawnSync` |
| `'node:fs'` | `chmodSync`, `lstatSync`, `mkdirSync`, `readFileSync`, `symlinkSync`, `writeFileSync` |
| `'node:path'` | `join` |
| `'node:url'` | `fileURLToPath`, `pathToFileURL` |
| `'./tmpHelpers.js'` | `mkTmp` |
| `'./historyHelpers.js'` | `scrubbedEnv` |
| `'../../deploy/history-replay.mjs'` | `DriverRefusal`, `admitAccount`, `readRoster` |

For each name that Step 1's listing does not show:
- if the file already has a named import from that specifier, add the name inside its braces;
- otherwise, add one `import { … } from '<specifier>';` line directly after the file's last import line.

A namespace or default import (`import path from 'node:path'`) does not bind the bare name, so add the named import beside it. Never import a name a second time: a duplicate binding is a SyntaxError.

(b) Append at the end of `server/test/history-replay.test.ts`:

```ts

// ── W2-4 Task 3: account admission from the roster, before any spawn (W2-D52; RP3-admission, RP9) ─────────────────
// Function level, on fixture HOMEs only. The 'before any spawn' half of RP3 and RP9 (the stub's log absent, no stream
// file under --out) is Task 8's, through the step0a subcommand. No fixture holds a key: admission never opens a
// secrets file, so each one holds a comment line.
// The three declarations below are MODULE-LEVEL: Tasks 5, 6, 8 and 9 call writeRoster, and Task 8 rosters
// FIXTURE_ACCOUNTS, from their own describes.

/** One roster account in rosterFromJson's grammar; `extra` overrides the defaults. */
const fixtureAccount = (id: string, exec: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, label: id, configDirSuffix: `.${id}`, exec, homeAble: false, telemetry: 'none', ...extra });
/** The twelve fixture rows. gen-u declares no provider, so it reads as anthropic (the roster's default, ruled). */
const FIXTURE_ACCOUNTS = [
  fixtureAccount('up-a', { kind: 'upstream' }, { configDirSuffix: '.claude', homeAble: true, telemetry: 'anthropic' }),
  fixtureAccount('gen-a', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-a.env' }),
  fixtureAccount('gen-o', { kind: 'generated', provider: 'openai', secretsFile: '.cc-secrets/gen-o.env' }),
  fixtureAccount('cx-a', { kind: 'codex', provider: 'openai', proxyPort: 41001, litellmPort: 41002, authDir: '.cx-a-auth' }),
  fixtureAccount('ext-n', { kind: 'external' }),
  fixtureAccount('ext-a', { kind: 'external', provider: 'anthropic', secretsFile: '.cc-secrets/ext-a.env' }),
  fixtureAccount('gen-h', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-h.env' }, { hidden: true }),
  fixtureAccount('gen-u', { kind: 'generated', secretsFile: '.cc-secrets/gen-u.env' }),
  fixtureAccount('gen-s', { kind: 'generated', provider: 'anthropic' }),
  fixtureAccount('gen-m', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-m.env' }),
  fixtureAccount('gen-r', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-r.env' }),
  fixtureAccount('gen-d', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-d.env' }),
];
/** `$HOME/.ccrc/accounts.json`, as the operator's roster. */
function writeRoster(home: string, accounts: object[]): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`);
}

describe('W2-4 Task 3: account admission from the roster (W2-D52, RP3-admission, RP9)', () => {
  const ADMIT_DRIVER = fileURLToPath(new URL('../../deploy/history-replay.mjs', import.meta.url));
  const IS_ROOT = (process.getuid?.() ?? 1) === 0;
  const SECRETS_TEXT = '# fixture secrets file: admission stats it and never opens it\n';
  const acct = fixtureAccount;
  const ACCOUNTS = FIXTURE_ACCOUNTS;
  /** A fixture HOME with ACCOUNTS rostered. Every declared secrets file is a readable regular file except gen-m's
   *  (never planted), gen-r's (mode 000) and gen-d's (a directory). A secrets file is planted even where the row is
   *  refused for something else, so each refusal below is that row's own and never a missing file's. */
  function admitHome(): string {
    const home = mkTmp('ccrc-replay-admit-');
    writeRoster(home, ACCOUNTS);
    mkdirSync(join(home, '.cc-secrets'), { mode: 0o700 });
    for (const id of ['gen-a', 'gen-o', 'ext-a', 'gen-h', 'gen-u', 'gen-r']) {
      writeFileSync(join(home, '.cc-secrets', `${id}.env`), SECRETS_TEXT, { mode: 0o600 });
    }
    chmodSync(join(home, '.cc-secrets', 'gen-r.env'), 0o000);
    mkdirSync(join(home, '.cc-secrets', 'gen-d.env'));
    return home;
  }
  /** A DriverRefusal as {word, detail}, or 'passed'; anything else is rethrown. */
  function refusalOf(f: () => unknown): { word: string; detail: string } | 'passed' {
    try {
      f();
      return 'passed';
    } catch (e) {
      if (e instanceof DriverRefusal) return { word: e.word, detail: e.detail };
      throw e;
    }
  }
  /** admitAccount's verdict on `id` over one readRoster of `home`. */
  function verdict(home: string, id: string): { word: string; detail: string } | 'passed' {
    const { json, roster } = readRoster(home);
    return refusalOf(() => admitAccount(json, roster, id, home));
  }

  it('readRoster parses the file once and answers the parsed object beside its validation', () => {
    const home = admitHome();
    const { json, roster } = readRoster(home);
    expect((json as { accounts: Array<{ id: string }> }).accounts.map((a) => a.id)).toEqual(ACCOUNTS.map((a) => a['id']));
    expect((json as { accounts: Array<{ hidden?: boolean }> }).accounts[6]!.hidden, 'hidden is read from the parsed object').toBe(true);
    expect(roster.upstreamId).toBe('up-a');
    expect(Object.keys(roster.accounts[6]!), 'rosterFromJson returns no hidden: why admission reads the parsed object').not.toContain('hidden');
  });

  it('readRoster refuses roster-invalid: absent, unreadable with its code, not JSON, and RosterInvalid with its message', () => {
    const absent = mkTmp('ccrc-replay-roster-');
    expect(refusalOf(() => readRoster(absent))).toEqual({ word: 'roster-invalid', detail: 'absent' });
    const dir = mkTmp('ccrc-replay-roster-');
    mkdirSync(join(dir, '.ccrc', 'accounts.json'), { recursive: true });
    expect(refusalOf(() => readRoster(dir))).toEqual({ word: 'roster-invalid', detail: 'unreadable EISDIR' });
    const garbled = mkTmp('ccrc-replay-roster-');
    mkdirSync(join(garbled, '.ccrc'));
    writeFileSync(join(garbled, '.ccrc', 'accounts.json'), '{"version": 1, "accounts": [');
    expect(refusalOf(() => readRoster(garbled))).toEqual({ word: 'roster-invalid', detail: 'not-json' });
    const twoUp = mkTmp('ccrc-replay-roster-');
    writeRoster(twoUp, [ACCOUNTS[0]!, acct('up-b', { kind: 'upstream' })]);
    expect(refusalOf(() => readRoster(twoUp))).toEqual({
      word: 'roster-invalid',
      detail: 'the roster has 2 upstream accounts: exactly one account must have exec.kind "upstream".',
    });
  });

  it('admits upstream and generated/anthropic (RP3), each with its launch path and config dir from the roster; a generated account with no declared provider reads as anthropic', () => {
    const home = admitHome();
    const { json, roster } = readRoster(home);
    expect(admitAccount(json, roster, 'up-a', home)).toEqual({
      accountId: 'up-a', kind: 'upstream', launcher: join(home, '.local', 'bin', 'up-a'),
      configDir: join(home, '.claude'), wrapperPath: null, secretsPath: null,
    });
    expect(admitAccount(json, roster, 'gen-a', home)).toEqual({
      accountId: 'gen-a', kind: 'generated', launcher: join(home, '.local', 'bin', 'gen-a'),
      configDir: join(home, '.gen-a'), wrapperPath: join(home, '.local', 'bin', 'gen-a'),
      secretsPath: join(home, '.cc-secrets', 'gen-a.env'),
    });
    // gen-u declares no provider: the roster's own default reads it as anthropic (coordinator ruling), so it is admitted.
    expect(admitAccount(json, roster, 'gen-u', home)).toEqual({
      accountId: 'gen-u', kind: 'generated', launcher: join(home, '.local', 'bin', 'gen-u'),
      configDir: join(home, '.gen-u'), wrapperPath: join(home, '.local', 'bin', 'gen-u'),
      secretsPath: join(home, '.cc-secrets', 'gen-u.env'),
    });
  });

  const REFUSED: Array<[string, string, string]> = [
    ['cx-a', 'kind-codex', 'a codex account (RP3)'],
    ['ext-n', 'kind-external', 'an external account with no declared provider (RP3)'],
    ['ext-a', 'kind-external', 'an external account declaring anthropic, its secrets file readable (RP3)'],
    ['gen-o', 'provider-openai', 'a generated account declaring openai, its secrets file readable (RP3)'],
    ['gen-h', 'hidden', 'a hidden generated/anthropic account, its secrets file readable'],
    ['gen-s', 'secrets-undeclared', 'a generated/anthropic account with no declared secretsFile'],
    ['gen-m', 'secrets-absent', 'a declared secretsFile that is absent (RP9)'],
    ['gen-d', 'secrets-not-regular', 'a declared secretsFile that is a directory (RP9)'],
    ['nobody', 'unknown-id', 'an id the roster does not hold'],
  ];
  it.each(REFUSED)('%s is refused account-refused %s: %s', (id, detail) => {
    expect(verdict(admitHome(), id)).toEqual({ word: 'account-refused', detail });
  });

  it.skipIf(IS_ROOT)('a declared secretsFile this user cannot read is refused secrets-unreadable (RP9; skipped as root)', () => {
    expect(verdict(admitHome(), 'gen-r')).toEqual({ word: 'account-refused', detail: 'secrets-unreadable' });
  });

  it('the secretsFile is stat\'ed through a symlink, as the wrapper\'s [ -r ] reads it: to a readable file admitted, dangling absent', () => {
    const home = admitHome();
    const real = join(home, 'elsewhere.env');
    writeFileSync(real, SECRETS_TEXT, { mode: 0o600 });
    symlinkSync(real, join(home, '.cc-secrets', 'gen-m.env'));
    expect(verdict(home, 'gen-m')).toBe('passed');
    const dangling = admitHome();
    symlinkSync(join(dangling, 'nowhere.env'), join(dangling, '.cc-secrets', 'gen-m.env'));
    expect(verdict(dangling, 'gen-m')).toEqual({ word: 'account-refused', detail: 'secrets-absent' });
  });

  it('an upstream account whose config dir is not exactly $HOME/.claude is refused upstream-config-dir', () => {
    const home = mkTmp('ccrc-replay-admit-');
    writeRoster(home, [acct('up-b', { kind: 'upstream' }, { homeAble: true, telemetry: 'anthropic' })]);
    expect(verdict(home, 'up-b')).toEqual({ word: 'account-refused', detail: 'upstream-config-dir' });
  });

  // RP9's "no credentials file is read", measured: a FIFO with no writer blocks whoever opens it, so admission run in
  // a child with a deadline returns promptly only if it never opened one. CONTROL: a child that does open it is killed.
  // The driver URL rides the env, never argv: with `-e`, process.argv[1] stays unset, so the entry guard never runs main.
  const ADMIT_CHILD = [
    'const d = await import(process.env.ADMIT_DRIVER_URL);',
    'const home = process.env.HOME;',
    'const { json, roster } = d.readRoster(home);',
    'const out = {};',
    "for (const id of ['gen-m', 'gen-a', 'up-a']) {",
    '  try { out[id] = d.admitAccount(json, roster, id, home).kind; }',
    '  catch (e) { if (!(e instanceof d.DriverRefusal)) throw e; out[id] = e.detail; }',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
  /** A FIFO at `<configDir>/.credentials.json` for gen-m, gen-a and up-a; the name is assembled, never spelled. */
  function plantCredentialFifos(home: string): string[] {
    const fifos = ['.gen-m', '.gen-a', '.claude'].map((dir) => join(home, dir, ['.credentials', 'json'].join('.')));
    for (const f of fifos) {
      mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 });
      const r = spawnSync('mkfifo', [f], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(lstatSync(f).isFIFO()).toBe(true);
    }
    return fifos;
  }

  it('admission never opens a config dir\'s credentials file: planted as FIFOs, admission returns promptly (RP9)', () => {
    const home = admitHome();
    plantCredentialFifos(home);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', ADMIT_CHILD], {
      env: { ...scrubbedEnv(process.env), HOME: home, ADMIT_DRIVER_URL: pathToFileURL(ADMIT_DRIVER).href },
      encoding: 'utf8', timeout: 15_000,
    });
    expect(r.signal, `admission blocked on a FIFO: ${r.stderr}`).toBeNull();
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ 'gen-m': 'secrets-absent', 'gen-a': 'generated', 'up-a': 'upstream' });
  });

  it('CONTROL: a child that opens one of those FIFOs is killed at its deadline, so the probe above can see a read', () => {
    const home = admitHome();
    const [fifo] = plantCredentialFifos(home);
    const r = spawnSync(process.execPath, ['-e', 'require("node:fs").readFileSync(process.argv[1])', fifo!], {
      env: { ...scrubbedEnv(process.env), HOME: home }, encoding: 'utf8', timeout: 2_000,
    });
    expect(r.signal).toBe('SIGTERM');
  });

  it('the driver never spells a credentials file name', () => {
    expect(readFileSync(ADMIT_DRIVER, 'utf8')).not.toMatch(/credentials\.json/);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'account admission')
```

Expected: red, `16 failed | 2 passed (18)` (predicted: measured as `17 failed | 2 passed (19)` before the admission ruling moved `gen-u`'s row from the refused `it.each` into the admitted case). As root it is `15 failed | 2 passed | 1 skipped` (predicted), because the mode-000 case skips. The measurement was against a stand-in for Task 1's `DriverRefusal`, `refuse` and entry guard on the base tree.
- Every function-level case fails with `TypeError: readRoster is not a function`. The tests' named imports from the `.mjs` resolve to `undefined` at call time, not at link time.
- The FIFO case fails with `TypeError: d.readRoster is not a function … expected 1 to be +0`. The child exits 1 promptly.
- The two that pass are the FIFO CONTROL and the source scan. Neither depends on this task's functions.

- [ ] **Step 4: Write the admission.** In `deploy/history-replay.mjs`:

(a) The import block. After this edit, the module binds each of these names exactly once:
- `accessSync`, `constants`, `readFileSync` and `statSync` from `'node:fs'`;
- `join` from `'node:path'`;
- `rosterFromJson` and `RosterInvalid` from `'../shared/roster-json.mjs'`.

For each name that Step 1's listing does not show:
- if the file already has a named import from that specifier, add the name inside its braces;
- otherwise, add one `import { … } from '<specifier>';` line directly after the file's last import line.

`node:path` is the one exception. Task 2 imported it as a default import, `import path from 'node:path';`, which has no braces. Merge `join` into that same statement, `import path, { join } from 'node:path';`, and never add a second `node:path` line: Task 5 counts one import statement per module.

`EXIT` stays imported from `ccd/history/lib.mjs` (Task 1), and nothing here declares a lib vocabulary.

(b) Directly above the first line of the entry guard, `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, insert:

```js
// ── W2-4 Task 3: account admission from the roster, before any spawn (W2-D52; spec §10.2 "Account and budget"; RP3, RP9) ─
// The driver reads $HOME/.ccrc/accounts.json ONCE, validates it with shared/roster-json.mjs's rosterFromJson, and reads
// exec.kind, exec.provider and hidden from that same parsed object: rosterFromJson validates provider and hidden but
// returns neither, and shared/ is not edited for this (W2-D52). Admission is an ALLOW-LIST: `upstream`, and `generated`
// whose provider is 'anthropic'. The provider is the one the roster's own reader answers: a `generated` account with
// no declared provider reads as 'anthropic', the default parseRoster and rosterFromJson apply (coordinator ruling).
// Every other kind is refused whatever it declares (the gateway lanes are `external`, so a deny-list keyed on codex or
// openai would fail open), and an `external` account with no declared provider stays refused by its kind.
// A generated account's token comes only from its declared secretsFile, which its ccrc-generated wrapper sources
// behind `[ -r "$HOME/<secretsFile>" ]`. This code stats that path as the test does (following a symlink), keeps a
// directory apart, checks R_OK, and never opens it. A Claude Code config dir's own OAuth file is never named or read
// here (RP9). The launch path and the config dir come from the roster: generated launches $HOME/.local/bin/<id>, its
// own wrapper; upstream launches $HOME/.local/bin/<roster upstreamId>, and its config dir must be exactly
// $HOME/.claude. Task 8's subcommands call both before any spawn, for the arms, the writer and the judge alike.

/** Reads $HOME/.ccrc/accounts.json once and validates it. Answers the parsed object and its validation; throws
 *  DriverRefusal('roster-invalid', …) with 'absent', 'unreadable <code>', 'not-json' or RosterInvalid's message. */
export function readRoster(home) {
  let text;
  try {
    text = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') refuse('roster-invalid', 'absent');
    refuse('roster-invalid', `unreadable ${e?.code ?? 'unknown'}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    refuse('roster-invalid', 'not-json');
  }
  try {
    return { json, roster: rosterFromJson(json) };
  } catch (e) {
    if (e instanceof RosterInvalid) refuse('roster-invalid', e.message);
    throw e;
  }
}

/** The one account `id` admitted, as a LaunchSpec, or DriverRefusal('account-refused', <detail>). `json` and `roster`
 *  are one readRoster result; an account the two disagree on is a caller defect (TypeError, exit 1). */
export function admitAccount(json, roster, id, home) {
  const acct = roster.accounts.find((a) => a.id === id);
  if (acct === undefined) refuse('account-refused', 'unknown-id');
  const raw = json.accounts.find((a) => a.id === id);
  if (raw === undefined || raw.exec.kind !== acct.execKind) {
    throw new TypeError(`admitAccount: the parsed roster and its validation disagree on account ${JSON.stringify(id)}`);
  }
  if (raw.hidden === true) refuse('account-refused', 'hidden');
  const kind = raw.exec.kind;
  if (kind === 'upstream') return admitUpstream(acct, roster, home);
  if (kind === 'generated') return admitGenerated(raw, acct, home);
  // The allow-list ends here: codex, external, and any kind a later roster adds, whatever provider they declare.
  refuse('account-refused', `kind-${kind}`);
}

/** upstream: the Claude Code binary the roster names, on exactly $HOME/.claude; no wrapper and no secrets file. */
function admitUpstream(acct, roster, home) {
  if (acct.configDirSuffix !== '.claude') refuse('account-refused', 'upstream-config-dir');
  return {
    accountId: acct.id, kind: 'upstream', launcher: join(home, '.local', 'bin', roster.upstreamId),
    configDir: join(home, acct.configDirSuffix), wrapperPath: null, secretsPath: null,
  };
}

/** generated: provider anthropic (declared, or absent and read as the roster's default) and a secretsFile this user
 *  can read; launched through its own wrapper. */
function admitGenerated(raw, acct, home) {
  // shared/roster.ts (parseRoster) and shared/roster-json.mjs (rosterFromJson) both read an absent provider on a
  // generated account as anthropic; admission reads the same provider the roster's reader answers (coordinator ruling).
  const provider = raw.exec.provider ?? 'anthropic';
  if (provider !== 'anthropic') refuse('account-refused', `provider-${provider}`);
  const secretsFile = raw.exec.secretsFile;
  if (secretsFile === undefined) refuse('account-refused', 'secrets-undeclared');
  const secretsPath = join(home, secretsFile);
  const why = secretsRefusal(secretsPath);
  if (why !== null) refuse('account-refused', why);
  const launcher = join(home, '.local', 'bin', acct.id);
  return {
    accountId: acct.id, kind: 'generated', launcher,
    configDir: join(home, acct.configDirSuffix), wrapperPath: launcher, secretsPath,
  };
}

/** What the wrapper's `[ -r … ]` folds into one false, kept apart; null when the file is regular and readable. The
 *  file is stat'ed and access-checked, never opened. */
function secretsRefusal(p) {
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? 'secrets-absent' : 'secrets-unreadable';
  }
  if (!st.isFile()) return 'secrets-not-regular';
  try {
    accessSync(p, constants.R_OK);
  } catch {
    return 'secrets-unreadable';
  }
  return null;
}

```

Check: `node --check deploy/history-replay.mjs` prints nothing. `grep -c 'credentials' deploy/history-replay.mjs` prints 0: the section's comment says "OAuth file", never the name.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'account admission')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The filtered run is green: `18 passed (18)` (predicted; measured as `19 passed (19)` before the admission ruling folded `gen-u`'s row into the admitted case; `17 passed | 1 skipped` as root). The FIFO case takes well under its 15 s deadline, and the CONTROL takes its 2 s.
- The whole file is green: Task 1's and Task 2's cases plus these 18.
- tsc prints no line that names `server/test/history-replay.test.ts` or `deploy/history-replay.mjs` (measured). `server/tsconfig.json` sets `allowJs` without `checkJs`, so the driver's return shapes are inferred and never checked. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement and asserts that it matched once. Then it runs one filter, shows the red, and restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/replay.orig"

# M1: the allow-list turned into a deny-list on codex (spec :2689: a deny-list fails open on the gateway lanes).
mut deploy/history-replay.mjs "  if (kind === 'generated') return admitGenerated(raw, acct, home);" "  if (kind !== 'codex') return admitGenerated(raw, acct, home);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is refused account-refused kind-')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED: 2 failed | 1 passed. ext-a: expected 'passed' to deeply equal { word: 'account-refused', …(1) }
# (admitted through the generated branch; measured); ext-n: the detail reads secrets-undeclared, not kind-external
# (predicted: its absent provider now reads as anthropic, so the generated branch reaches the secrets check). cx-a passes.

# M2: the hidden check dropped.
mut deploy/history-replay.mjs "  if (raw.hidden === true) refuse('account-refused', 'hidden');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'gen-h is refused')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, expected 'passed' to deeply equal { word: 'account-refused', …(1) }.

# M3: the secrets readability check dropped (not measurable as root, where the case skips).
mut deploy/history-replay.mjs "  try {
    accessSync(p, constants.R_OK);
  } catch {
    return 'secrets-unreadable';
  }
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'cannot read')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, expected 'passed' to deeply equal { word: 'account-refused', …(1) }.

# M4: an undeclared provider refused (the literal reading the coordinator ruled against: the roster's default is anthropic).
mut deploy/history-replay.mjs "  const provider = raw.exec.provider ?? 'anthropic';" "  const provider = raw.exec.provider;
  if (provider === undefined) refuse('account-refused', 'provider-undeclared');"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'no declared provider reads as anthropic')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 1 failed, DriverRefusal: account-refused: provider-undeclared, thrown by the gen-u admission.

# M5: the secrets file read without following a symlink (the wrapper's [ -r ] follows). realpathSync is Task 1's.
mut deploy/history-replay.mjs "    st = statSync(p);" "    st = statSync(p);
    if (realpathSync(p) !== p) return 'secrets-not-regular';"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'through a symlink')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, expected { word: 'account-refused', …(1) } to be 'passed'.

# M6 (RP9): a fallback that reads the config dir's credentials file when the secrets file is absent. The name is
# assembled, so the source scan cannot see it: the FIFO probe is what reds.
mut deploy/history-replay.mjs "  if (why !== null) refuse('account-refused', why);" "  if (why === 'secrets-absent') readFileSync(join(home, acct.configDirSuffix, '.credentials' + '.json'));
  if (why !== null) refuse('account-refused', why);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'never opens')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, admission blocked on a FIFO: : expected 'SIGTERM' to be null.

# M7: the provider check turned into a deny-list.
mut deploy/history-replay.mjs "  if (provider !== 'anthropic') refuse(" "  if (provider === 'compatible') refuse("
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'gen-o is refused')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, expected 'passed' to deeply equal { word: 'account-refused', …(1) }.

# M8: the upstream config-dir check dropped.
mut deploy/history-replay.mjs "  if (acct.configDirSuffix !== '.claude') refuse('account-refused', 'upstream-config-dir');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'upstream-config-dir')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed, expected 'passed' to deeply equal { word: 'account-refused', …(1) }.

cmp "$SCRATCH/replay.orig" deploy/history-replay.mjs && echo restored
```

Each red's skipped count depends on how many cases Tasks 1 and 2 put in the file, so only the failed count is stated. Then run Step 5's first two commands once more: both green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts -t 'node-floor|22.16')
```

Expected: green.
- `single-definition -t 'ccrc history'`: `92 passed` (measured with this section in a stand-in driver at the base). The section declares no `VOCABS` name, so O14's `DECL_CORPUS` scan stays green. It writes no switch path, so O13's `ALL_MJS` scan does too.
- `ci-pipeline`: Task 1's node-floor line still lists this file, and this task adds no test file.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 3 — account admission from the roster, before any spawn" -m "$CO_AUTHORED_BY"
```

---

### Task 4: Spawned text, the stream-json reader and the spend ledger

The spawns (Task 5) and the reconstruction (W2-5a) need three small pieces, and this task adds them to `deploy/history-replay.mjs`:
- **Spawned text (W2-D54).** A field whose stored `raw_len` is over `blobOverDecodeCap` is discarded. It is never truncated and never decoded. Any other field goes whole through lib's `redactField`, over a pair index the caller builds once per run. This PR takes the index as a parameter, and the tests build it with `makePairIndex`; W2-5a will pass the CLI's `pairIndexOf` once W2-1 exports it. The 4,000-code-point tool_result cut applies only to text that is already redacted. Lib's display-window redaction is never used, and a scan pins that the driver never names it.
- **The stream-json reader (W2-D51).** It reads the init event's `session_id`, `model`, `tools`, `mcp_servers`, `plugins`, `skills` and `slash_commands`. An absent field reads null, never `[]`. It also reads tool_use/tool_result pairs by id; the result event's `permission_denials`, `subtype`, `is_error`, `num_turns` and result text; the usage; the assistant message count; and a count of malformed lines. It never throws. Usage is the result event's when there is one. Otherwise it is the sum of the assistant messages' `message.usage`, each `message.id` counted once.
- **The spend ledger (W2-D55).** Each finished spawn appends one line under `--out`. The ledger is append-only and summed over every line, never de-duplicated by name (coordinator ruling): a re-run's spend adds to the total. A finished job is never spawned again (Task 5's `run.json`), so a repeated name only ever means money spent twice; and where a kill between a run's ledger line and its `run.json` re-spawns the job, the sum over-counts, which is the safe direction for a budget. A ledger that cannot be read whole fails closed as `budget-exhausted` `ledger-unreadable`.

No D-number is defined here. The departures this task stands on are W2 decisions, not spec departures: W2-D54, W2-D51 and W2-D55, with erratum E18 additive and carrying no number.

**Files:**
- Modify `deploy/history-replay.mjs`:
  - Task 1's one import from `'../ccd/history/lib.mjs'` gains `blobOverDecodeCap`, `canonicalJson` and `redactField`.
  - The driver's one `import { … } from 'node:fs';` gains `appendFileSync`, `lstatSync` and `readFileSync`, each once. A name an earlier task already added stays once.
  - One section goes directly above the entry guard line `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`. That guard is Task 1's and stays the file's last block. The section goes below any section Tasks 2 and 3 placed there, and it has no top-level await.
- Modify `server/test/history-replay.test.ts`:
  - four import lines under `t4` aliases, directly below the last `import` line of the file's top import block (Task 1's block, as Tasks 2 and 3 left it);
  - one describe appended at the end of the file.
- Not edited:
  - `ccd/history/lib.mjs` and `lib.d.mts`: every lib name used here is already exported and declared;
  - `.github/workflows/ci.yml`: Task 1 listed the test file in the node-floor heredoc;
  - `shared/` and every other test file.

**Interfaces:**
- Consumes from Task 1 (`deploy/history-replay.mjs`):
  - `DRIVER_REASONS`, which holds `'budget-exhausted'`;
  - `class DriverRefusal extends Error { word: string; detail: string }`;
  - `refuse(word: string, detail: string): never`;
  - the entry guard line quoted above;
  - the driver's single lib import and its single `node:fs` import.
- Consumes from base `ccd/history/lib.mjs`. Line numbers were measured at `7d01973a2`; re-anchor by name.
  - `redactField(text: string, idx: PairIndex): string` (`:2470`);
  - `blobOverDecodeCap(rawLen: unknown): boolean` (`:178`; true for a non-number or anything over `BLOB_DECODE_MAX`);
  - `canonicalJson(value: unknown): string` (`:454`);
  - `PairIndex` (`lib.d.mts:291`), named in the JSDoc only.
  - Tests only: `makePairIndex(pairs, belt?)` (`:1747`), `sha256Hex` (`:527`), `REDACTED_MARK` (`:1617`) and `BLOB_DECODE_MAX` (`:175`).
- Consumes from tests: `mkTmp(prefix: string): string` (`server/test/tmpHelpers.ts:38`), imported here as `t4MkTmp`. The tmp helpers' file-level `afterAll` removes what it makes.
- Produces (all exported from `deploy/history-replay.mjs`):
  - `TOOL_RESULT_CUT = 4000`.
  - `redactForSpawn(field: {text: string, rawLen: number}, idx: PairIndex): {state:'text', text: string} | {state:'discard', why:'over-decode-cap'}`.
  - `cutToolResult(redacted: string): string`, the first `TOOL_RESULT_CUT` code points. It never splits a surrogate pair.
  - `toolResultText(field: {text: string, rawLen: number}, idx: PairIndex)`, with the same answer type as `redactForSpawn`: `redactForSpawn` first, then `cutToolResult` on a `'text'` answer. This name is added by this task (see "Choices this task makes").
  - `readStreamJson(text: string): StreamFacts`, where `StreamFacts` = `{init: {sessionId: string|null, model: string|null, tools: string[]|null, mcpServers: unknown[]|null, plugins: unknown[]|null, skills: unknown[]|null, slashCommands: string[]|null} | null, usage: {input: number, cacheCreation: number, cacheRead: number, output: number}, usageSource: 'result'|'assistant'|'none', toolPairs: Array<{id: string, name: string, input: unknown, result: string|null, isError: boolean|null}>, permissionDenials: unknown[]|null, result: {subtype: string|null, isError: boolean|null, numTurns: number|null, text: string|null} | null, assistantMessages: number, malformedLines: number}`. It is declared as a JSDoc `@typedef`, so the test file's TypeScript sees the types through `allowJs`.
  - `spendTokens(facts: StreamFacts): number`, which is `input + cacheCreation + cacheRead + output`.
  - `SPEND_LEDGER = 'spend.jsonl'`.
  - `recordSpend(out: string, name: string, tokens: number): void`. It makes one `appendFileSync` of `` `${canonicalJson({name, tokens, ts_ms})}\n` ``, mode `0o600` at creation. A name that is not a non-empty string, or a `tokens` that is not a non-negative safe integer, throws `TypeError('recordSpend: …')` and writes nothing.
  - `spentSoFar(out: string): number`, the sum of `tokens` over every line, a repeated name included. It answers 0 when the ledger is absent. A ledger that is not a regular file (a directory or a symlink), cannot be read, ends in a torn line, or holds any line `recordSpend` would not write throws `DriverRefusal('budget-exhausted', 'ledger-unreadable')`.
  - Module-private: `sjObject`, `sjList`, `sjString`, `sjBool`, `sjCount`, `sjUsage`, `sjResultText`, `SPEND_KEYS` and `spendRow`. The `sj` prefix keeps them clear of Tasks 1–3's private names. None is in O14's `VOCABS`, so `DECL_CORPUS` has nothing to count.
- Consumed later:
  - Task 5: `readStreamJson`, `spendTokens` and `recordSpend`.
  - Task 6: `spentSoFar`.
  - Tasks 8 and 9: `readStreamJson` and `spentSoFar`.
  - W2-5a: `redactForSpawn`, `toolResultText` and `cutToolResult`.

**Spec:**
- §10.2 "Reconstruction" (`:2629`, every field through `redactField`) and its item 2 (`:2631`, `[tool_result] <first 4,000 chars>`).
- §10.2's spawn contract: `--output-format stream-json` (`:2672`).
- §10.2:2697 "stops at a stated threshold". Erratum E18 makes it additive: W2-D55's cumulative spend budget. W2-1 amends the text.

Decisions: W2-D54, W2-D51 (the stream-json reader bullet) and W2-D55 (spend = input + cache_creation + cache_read + output, cumulative under `--out`). No spec text is edited here.

**Choices this task makes:**
- **`toolResultText` is the one place W2-D54's order lives.** The coordinator's interface lists `redactForSpawn` and `cutToolResult`. This task adds their composition so that W2-5a calls one function for a tool_result, and so that the "cut before redact" mutant has shipped code to bite on. Without it, the order would live only in each caller.
- **Usage per message.** For one `message.id`, the last event that carries a usage object wins, and the usage counts once. `assistantMessages` counts distinct ids. An assistant message with no string id counts once per event, because nothing ties two such events together.
- **Odd shapes.**
  - An init field of the wrong type (for example `tools: "Bash"`) reads null, as an absent one does. Neither is ever `[]`.
  - A tool_result whose `tool_use_id` names no tool_use in the stream pairs nothing.
  - A repeated tool_use id keeps its first pair.
  - A tool_result given as a block list is its text blocks joined by `\n`, or null when it holds none.
  - A usage count that is not a non-negative integer reads 0.
- **The ledger's line is exact.** It has exactly the keys `name`, `tokens` and `ts_ms`, a non-empty name, and non-negative integers. Anything else, including a blank line and a torn last line, fails closed. `ts_ms` is informational: it is required, but never compared. The explicit `0o600` holds for a caller that has not set `main`'s umask, such as the tests.
- **The ledger is summed, never de-duplicated (coordinator ruling).** A name that appears twice is two spawns that both spent, so both count. The alternative, last-wins by name, could lose a spend: with Task 5's order (stream, ledger line, `run.json`), a kill between the ledger line and the `run.json` re-spawns the job, and last-wins would drop the first spawn's spend. Summing over-counts in that one case, and over-counting is the safe direction for a budget: it may stop a batch early, never let one run past its budget.
- **The ledger is refused when it is not a regular file** (lstat, so a symlink is refused too). `--out` is the caller's 0700 directory (Task 2), and a link or a directory planted there is not the driver's ledger.

- [ ] **Step 1: Confirm Task 1's names and the anchors before using them.** From the repository root:

```bash
grep -c '^export class DriverRefusal extends Error' deploy/history-replay.mjs
grep -c '^export function refuse(' deploy/history-replay.mjs
grep -c "from '../ccd/history/lib.mjs';" deploy/history-replay.mjs
grep -c "from 'node:fs';" deploy/history-replay.mjs
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs
grep -c 'redactDisplayWindow' deploy/history-replay.mjs
grep -c '\bt4[A-Z]' server/test/history-replay.test.ts
grep -c '^export const \(TOOL_RESULT_CUT\|SPEND_LEDGER\) = \|^export function \(redactForSpawn\|cutToolResult\|toolResultText\|readStreamJson\|spendTokens\|recordSpend\|spentSoFar\)(' deploy/history-replay.mjs
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(d.DRIVER_REASONS.includes('budget-exhausted'), new d.DriverRefusal('budget-exhausted', 'x').word)"
```

Expected:
- The first five counts print 1 each.
- The next three print 0. The driver never names the display-window redaction, the test file holds no `t4` alias yet, and none of this task's names exists yet.
- The last line prints `true budget-exhausted`. The import runs nothing, because `process.argv[1]` is undefined under `-e`, so the entry guard is false.

A different count is a gap in Task 1, or an earlier task already declared one of these names. Stop and report it. Never declare a second `DriverRefusal`, `refuse` or `DRIVER_REASONS`.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`:

(a) Directly below the last `import` line of the file's top import block, insert:

```ts
// ── W2-4 Task 4: imports under t4 aliases, so no binding collides with Tasks 1–3 above ───────────────────────────
import * as t4Fs from 'node:fs';
import * as t4Lib from '../../ccd/history/lib.mjs';
import * as t4Replay from '../../deploy/history-replay.mjs';
import { mkTmp as t4MkTmp } from './tmpHelpers.js';
```

(b) Append at the end of the file:

```ts

// ── W2-4 Task 4: spawned text, the stream-json reader and the spend ledger (W2-D54, W2-D51, W2-D55) ─────────────
// Pure or small: no spawn and no HOME. Redaction runs over a pair index the test builds with makePairIndex, standing
// in for the index W2-5a passes once per run. The secret is assembled at runtime from parts and never written whole.
// A mkTmp directory stands in for --out.
describe('W2-4 Task 4: spawned text, the stream-json reader and the spend ledger', () => {
  const SECRET = ['q7v', 'k2m9', 'x4p8', 'w3n6', 'z5r1', 'h8t2', 'j6y4', 'c9d3', 'b1f7', 'g5s'].join('');
  const IDX = t4Lib.makePairIndex([{ len: SECRET.length, sha256: t4Lib.sha256Hex(SECRET) }]);
  /** A tool_result whose secret starts 20 code points before the cut and ends 18 after it, with text after it, so the
   *  cut bites after redaction too. */
  const STRADDLE = `${'a '.repeat(1990)}${SECRET} ${'b '.repeat(100)}`;
  const field = (text: string, rawLen: number = Buffer.byteLength(text)) => ({ text, rawLen });
  const points = (s: string): number => Array.from(s).length;
  /** The text of a 'text' answer; any other answer fails the case. */
  const textOf = (r: { state: string }): string => {
    expect(r.state).toBe('text');
    return (r as unknown as { text: string }).text;
  };

  it('the fixture straddles the cut: the secret starts before code point 4,000 and ends after it', () => {
    expect(t4Replay.TOOL_RESULT_CUT).toBe(4000);
    const at = STRADDLE.indexOf(SECRET);
    expect(at).toBeLessThan(t4Replay.TOOL_RESULT_CUT);
    expect(at + SECRET.length).toBeGreaterThan(t4Replay.TOOL_RESULT_CUT);
  });

  it('W2-D54 order: a secret straddling code point 4,000 is redacted whole before the cut, and no prefix of it survives', () => {
    const text = textOf(t4Replay.toolResultText(field(STRADDLE), IDX));
    expect(text, "the secret's head survived the cut").not.toContain(SECRET.slice(0, 6));
    expect(text).toContain(t4Lib.REDACTED_MARK);
    expect(points(text)).toBe(t4Replay.TOOL_RESULT_CUT);
    // CONTROL: cut first and redact afterwards, and the head the cut leaves matches no (length, sha256) pair.
    expect(t4Lib.redactField(t4Replay.cutToolResult(STRADDLE), IDX)).toContain(SECRET.slice(0, 20));
  });

  it('redactForSpawn passes the WHOLE field through redactField and never cuts it', () => {
    const long = `${'c '.repeat(4000)}${SECRET} end`;
    const r = t4Replay.redactForSpawn(field(long), IDX);
    expect(r).toEqual({ state: 'text', text: t4Lib.redactField(long, IDX) });
    expect(textOf(r)).not.toContain(SECRET);
    expect(points(textOf(r))).toBeGreaterThan(t4Replay.TOOL_RESULT_CUT);
  });

  it('a field over blobOverDecodeCap is discarded, never truncated or decoded; at the cap it is redacted', () => {
    const over = t4Lib.BLOB_DECODE_MAX + 1;
    const discard = { state: 'discard', why: 'over-decode-cap' };
    expect(t4Replay.redactForSpawn(field(STRADDLE, over), IDX)).toEqual(discard);
    expect(t4Replay.toolResultText(field(STRADDLE, over), IDX)).toEqual(discard);
    expect(t4Replay.redactForSpawn({ text: STRADDLE, rawLen: '12' as unknown as number }, IDX), "a non-numeric raw_len is over the cap, as lib's reader holds")
      .toEqual(discard);
    expect(t4Replay.redactForSpawn(field('ok', t4Lib.BLOB_DECODE_MAX), IDX)).toEqual({ state: 'text', text: 'ok' });
  });

  it('cutToolResult keeps the first 4,000 code points and never splits a surrogate pair', () => {
    const astral = String.fromCodePoint(0x1f600);
    const cut = t4Replay.cutToolResult(astral.repeat(4001));
    expect(points(cut)).toBe(4000);
    expect(cut.length).toBe(8000);
    expect(t4Replay.cutToolResult(`${'a'.repeat(3999)}${astral}tail`)).toBe(`${'a'.repeat(3999)}${astral}`);
    expect(t4Replay.cutToolResult('short')).toBe('short');
  });

  it("the driver never names lib's display-window redaction (CONTROL: the pattern sees a planted line)", () => {
    const NAME = /\bredactDisplayWindow\b/;
    expect(NAME.test("import { redactDisplayWindow } from '../ccd/history/lib.mjs';")).toBe(true);
    expect(t4Fs.readFileSync(new URL('../../deploy/history-replay.mjs', import.meta.url), 'utf8')).not.toMatch(NAME);
  });

  // ── the stream-json reader ──
  const SID = '4d1c9e2a-7b3f-4a6c-9d8e-1f2a3b4c5d6e';
  /** Stream lines: an object is one JSON line, a string is written as it is. */
  const lines = (...events: unknown[]): string => `${events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}\n`;
  const usage = (input: number, cacheCreation: number, cacheRead: number, output: number) =>
    ({ input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output });
  /** An init event with no `plugins` field: absent, so it must read null. `mcp_servers` is present and empty. */
  const INIT = { type: 'system', subtype: 'init', session_id: SID, model: 'model-a', tools: ['Bash', 'Agent'], mcp_servers: [], skills: ['ccrc-history'], slash_commands: ['compact'] };
  /** One assistant message written as two content-block events, each repeating the message's id and usage. */
  const A1_TEXT = { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'running it' }], usage: usage(10, 20, 30, 4) } };
  const A1_TOOL = { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'true' } }], usage: usage(10, 20, 30, 4) } };
  const U1 = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }] } };
  const A2 = { type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: usage(1, 2, 3, 5) } };
  const DENIAL = { tool_name: 'Bash', tool_use_id: 'toolu_9', tool_input: { command: 'cat x' } };
  const RESULT = { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'done', usage: usage(100, 200, 300, 40), permission_denials: [DENIAL] };
  const STREAM = lines(INIT, A1_TEXT, A1_TOOL, U1, 'not json {', A2, RESULT);

  it('the init event: each field as the stream carried it, and a field it did not carry reads null', () => {
    expect(t4Replay.readStreamJson(STREAM).init).toEqual({
      sessionId: SID, model: 'model-a', tools: ['Bash', 'Agent'], mcpServers: [], plugins: null, skills: ['ccrc-history'], slashCommands: ['compact'],
    });
    expect(t4Replay.readStreamJson(lines({ type: 'system', subtype: 'init' })).init)
      .toEqual({ sessionId: null, model: null, tools: null, mcpServers: null, plugins: null, skills: null, slashCommands: null });
  });

  it('the rest of the stream: one tool pair by id, the result event, its permission denial, its usage, the message count and the malformed line', () => {
    const f = t4Replay.readStreamJson(STREAM);
    expect(f.toolPairs).toEqual([{ id: 'toolu_1', name: 'Bash', input: { command: 'true' }, result: 'ok', isError: false }]);
    expect(f.result).toEqual({ subtype: 'success', isError: false, numTurns: 2, text: 'done' });
    expect(f.permissionDenials).toEqual([DENIAL]);
    expect(f.usageSource).toBe('result');
    expect(f.usage).toEqual({ input: 100, cacheCreation: 200, cacheRead: 300, output: 40 });
    expect(f.assistantMessages).toBe(2);
    expect(f.malformedLines).toBe(1);
    expect(t4Replay.spendTokens(f)).toBe(640);
  });

  it("with no result event, usage is the assistant messages' summed once per message.id, and there is no result or denial list", () => {
    const f = t4Replay.readStreamJson(lines(INIT, A1_TEXT, A1_TOOL, U1, A2));
    expect(f.usageSource).toBe('assistant');
    expect(f.usage).toEqual({ input: 11, cacheCreation: 22, cacheRead: 33, output: 9 });
    expect(f.assistantMessages).toBe(2);
    expect(f.result).toBeNull();
    expect(f.permissionDenials).toBeNull();
    expect(t4Replay.spendTokens(f)).toBe(75);
  });

  it('an empty stream is no init, no result and no usage: zeros with usageSource none', () => {
    expect(t4Replay.readStreamJson('')).toEqual({
      init: null, usage: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }, usageSource: 'none', toolPairs: [],
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0,
    });
  });

  it('a line that is not a JSON object is counted, and odd shapes never throw', () => {
    const f = t4Replay.readStreamJson(lines('42', 'null', '[1]', '{"type":',
      { type: 'assistant' }, { type: 'assistant', message: { content: 'text' } },
      { type: 'user', message: { content: [null, 5, { type: 'tool_result' }] } },
      { type: 'system', subtype: 'init', tools: 'Bash' }, { type: 'result', num_turns: '3', usage: null }));
    expect(f.malformedLines).toBe(4);
    expect(f.init?.tools).toBeNull();
    expect(f.result).toEqual({ subtype: null, isError: null, numTurns: null, text: null });
    expect(f.usageSource).toBe('none');
    expect(f.toolPairs).toEqual([]);
  });

  it('a tool_result in content blocks joins its text blocks, an absent is_error reads null, and a result with no tool_use pairs nothing', () => {
    const f = t4Replay.readStreamJson(lines(
      { type: 'assistant', message: { id: 'msg_3', content: [{ type: 'tool_use', id: 'toolu_3', name: 'Agent', input: { prompt: 'look' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_stray', content: 'stray' }] } },
    ));
    expect(f.toolPairs).toEqual([{ id: 'toolu_3', name: 'Agent', input: { prompt: 'look' }, result: 'one\ntwo', isError: null }]);
    expect(f.assistantMessages).toBe(1);
    expect(f.usageSource).toBe('none');
  });

  // ── the spend ledger ──
  const ledger = (out: string): string => `${out}/${t4Replay.SPEND_LEDGER}`;
  /** The word and detail of the DriverRefusal `f` throws, or null when it returns. */
  const refusalOf = (f: () => unknown): { word: string; detail: string } | null => {
    try { f(); } catch (e) {
      expect(e).toBeInstanceOf(t4Replay.DriverRefusal);
      const r = e as { word: string; detail: string };
      return { word: r.word, detail: r.detail };
    }
    return null;
  };
  const CLOSED = { word: 'budget-exhausted', detail: 'ledger-unreadable' };
  const GOOD = '{"name":"a","tokens":1,"ts_ms":1}\n';

  it('the ledger: absent is 0; one canonical line per finished spawn, mode 0600; summed over every line, a repeated name included', () => {
    const out = t4MkTmp('ccrc-replay-t4-ledger-');
    expect(t4Fs.existsSync(ledger(out))).toBe(false);
    expect(t4Replay.spentSoFar(out)).toBe(0);
    t4Replay.recordSpend(out, 'step0a/writer', 100);
    t4Replay.recordSpend(out, 'step0a/judge', 50);
    t4Replay.recordSpend(out, 'step0a/writer', 120);   // a resumed batch re-ran this job: both spawns spent
    expect(t4Replay.spentSoFar(out), 'a re-run adds to the total, never replaces it').toBe(270);
    const rows = t4Fs.readFileSync(ledger(out), 'utf8').split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toBe('');
    expect(rows[0]).toMatch(/^\{"name":"step0a\/writer","tokens":100,"ts_ms":[0-9]+\}$/);
    expect(t4Fs.statSync(ledger(out)).mode & 0o777).toBe(0o600);
  });

  it('recordSpend refuses a name or a count it could not read back, and writes nothing', () => {
    const out = t4MkTmp('ccrc-replay-t4-record-');
    expect(() => t4Replay.recordSpend(out, '', 1)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', -1)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', 1.5)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', Number.NaN)).toThrow(/^recordSpend: /);
    expect(t4Fs.existsSync(ledger(out))).toBe(false);
  });

  it.each([
    ['a torn last line', `${GOOD}{"name":"b","tok`],
    ['a line that is not JSON', `${GOOD}not json\n`],
    ['a blank line', `${GOOD}\n${GOOD}`],
    ['a JSON array', `${GOOD}[1]\n`],
    ['a negative count', `${GOOD}{"name":"b","tokens":-1,"ts_ms":1}\n`],
    ['a fractional count', `${GOOD}{"name":"b","tokens":1.5,"ts_ms":1}\n`],
    ['an extra key', `${GOOD}{"name":"b","tokens":1,"ts_ms":1,"x":0}\n`],
    ['a missing key', `${GOOD}{"name":"b","tokens":1}\n`],
    ['an empty name', `${GOOD}{"name":"","tokens":1,"ts_ms":1}\n`],
  ])('a malformed ledger (%s) fails closed as budget-exhausted, never a count', (_why, body) => {
    const out = t4MkTmp('ccrc-replay-t4-malformed-');
    t4Fs.writeFileSync(ledger(out), body);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(CLOSED);
  });

  it('a ledger that is a directory, or a symlink to a readable ledger, fails closed too', () => {
    const dir = t4MkTmp('ccrc-replay-t4-dir-');
    t4Fs.mkdirSync(ledger(dir));
    expect(refusalOf(() => t4Replay.spentSoFar(dir))).toEqual(CLOSED);
    const link = t4MkTmp('ccrc-replay-t4-link-');
    t4Fs.writeFileSync(`${link}/elsewhere`, GOOD);
    t4Fs.symlinkSync(`${link}/elsewhere`, ledger(link));
    expect(refusalOf(() => t4Replay.spentSoFar(link))).toEqual(CLOSED);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable ledger fails closed (skipped as root, which reads it anyway)', () => {
    const out = t4MkTmp('ccrc-replay-t4-unreadable-');
    t4Fs.writeFileSync(ledger(out), GOOD);
    t4Fs.chmodSync(ledger(out), 0o000);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(CLOSED);
  });
});
```

The describe holds 25 cases: 16 `it` and one nine-row `it.each`. Check what the filter selects: `(cd server && ./node_modules/.bin/vitest list test/history-replay.test.ts -t 'W2-4 Task 4')` lists exactly these 25 and nothing from Tasks 1–3.

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 4')
```

Expected: red, `24 failed | 1 passed`, with Tasks 1–3's cases counted as skipped. This was measured against a stand-in for Task 1's `DRIVER_REASONS`, `DriverRefusal`, `refuse` and entry guard.
- The case that passes is the display-window scan, a pin that is green from the start: the driver does not name the function. Step 6's M10 measures its red.
- The others fail as follows:
  - six reader cases: `TypeError: readStreamJson is not a function`;
  - three ledger cases: `expected TypeError: __vite_ssr_import_4__.spentSoF… to be an instance of DriverRefusal`;
  - `redactForSpawn is not a function`, `toolResultText is not a function`, `cutToolResult is not a function` and `spentSoFar is not a function`;
  - the fixture case: `expected undefined to be 4000`;
  - the recordSpend case: `expected [Function] to throw error matching /^recordSpend: / but got '__vite_ssr_import_4__.recordSpend is …'`.

  The import alias index in those messages depends on how many imports the file has, so it may differ.

- [ ] **Step 4: Write the implementation.** In `deploy/history-replay.mjs`:

(a) Task 1's one import from `'../ccd/history/lib.mjs'` gains `blobOverDecodeCap`, `canonicalJson` and `redactField`. If it still reads `import { EXIT } from '../ccd/history/lib.mjs';`, it becomes:

```js
import { EXIT, blobOverDecodeCap, canonicalJson, redactField } from '../ccd/history/lib.mjs';
```

If an earlier task already extended it, add only the names it lacks. The driver's one `node:fs` import gains `appendFileSync`, `lstatSync` and `readFileSync`, each present exactly once. If it still reads `import { realpathSync } from 'node:fs';`, it becomes `import { appendFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';`. Then check:
- `grep -c "from '../ccd/history/lib.mjs';" deploy/history-replay.mjs` still prints 1;
- `grep -c "from 'node:fs';" deploy/history-replay.mjs` still prints 1.

(b) Directly above the entry guard line `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`, insert:

```js
// ── W2-4 Task 4: spawned text, the stream-json reader and the spend ledger (W2-D54, W2-D51, W2-D55) ─────────────
// Three small pieces the spawns (Task 5) and the reconstruction (W2-5a) need.
// (a) Spawned text (W2-D54). A field whose stored raw_len is over lib's decode cap is DISCARDED: never truncated and
//     never decoded; the caller drops its boundary or candidate. Every other field passes WHOLE through lib's
//     redactField, over the pair index the caller builds once per run (W2-5a passes the CLI's index), and only the
//     redacted text is cut to TOOL_RESULT_CUT code points. A cut first would leave a secret's head, which no
//     (length, sha256) pair matches. Lib's display-window redaction is never called here, and a scan pins that this
//     file never names it.
// (b) The stream-json reader (W2-D51). One pass over the lines of `--output-format stream-json --verbose`, and never a
//     throw: a line that is not a JSON object is counted in malformedLines. An init field the stream did not carry reads
//     null, never [], because absent and empty are two facts. Usage is the result event's when it carries one; otherwise
//     it is the assistant messages' usage, taken once per message.id, because Claude Code repeats a message's id and
//     usage on each content-block event.
// (c) The spend ledger (W2-D55). One canonical-JSON line per finished spawn, appended under --out. It is append-only
//     and summed over EVERY line, never de-duplicated by name: a re-run's spend adds to the total, because both
//     spawns spent. A finished job is never re-spawned, so the only double count is a run killed between its ledger
//     line and its run.json, and over-counting is the safe direction for a budget. A ledger that cannot be read
//     whole fails closed as budget-exhausted 'ledger-unreadable', never as 0.

/** The most code points of a tool_result a spawn's input carries (spec §10.2, reconstruction item 2). */
export const TOOL_RESULT_CUT = 4000;

/** One stored field for a spawn's input (W2-D54): discarded over the decode cap, otherwise redacted whole.
 *  @param {{ text: string, rawLen: number }} field the field's text and its stored raw_len
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx the run's pair index, built once by the caller
 *  @returns {{ state: 'text', text: string } | { state: 'discard', why: 'over-decode-cap' }} */
export function redactForSpawn(field, idx) {
  if (blobOverDecodeCap(field.rawLen)) return { state: 'discard', why: 'over-decode-cap' };
  return { state: 'text', text: redactField(field.text, idx) };
}

/** The first TOOL_RESULT_CUT code points of text that redactForSpawn has already redacted. A surrogate pair is
 *  never split.
 *  @param {string} redacted
 *  @returns {string} */
export function cutToolResult(redacted) {
  let count = 0;
  let end = 0;
  for (const ch of redacted) {
    if (count === TOOL_RESULT_CUT) return redacted.slice(0, end);
    count += 1;
    end += ch.length;
  }
  return redacted;
}

/** A tool_result for a spawn's input, in W2-D54's order: redacted whole first, then cut.
 *  @param {{ text: string, rawLen: number }} field
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx
 *  @returns {{ state: 'text', text: string } | { state: 'discard', why: 'over-decode-cap' }} */
export function toolResultText(field, idx) {
  const r = redactForSpawn(field, idx);
  return r.state === 'text' ? { state: 'text', text: cutToolResult(r.text) } : r;
}

const sjObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sjList = (v) => (Array.isArray(v) ? [...v] : null);
const sjString = (v) => (typeof v === 'string' ? v : null);
const sjBool = (v) => (typeof v === 'boolean' ? v : null);
const sjCount = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** A stream usage object as the four counts spend sums; a count that is not a non-negative integer reads 0. */
function sjUsage(u) {
  return {
    input: sjCount(u.input_tokens),
    cacheCreation: sjCount(u.cache_creation_input_tokens),
    cacheRead: sjCount(u.cache_read_input_tokens),
    output: sjCount(u.output_tokens),
  };
}

/** A tool_result's content as text: a string as it is, a block list as its text blocks joined by newlines, and
 *  null when it holds no text. */
function sjResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => sjObject(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return texts.length === 0 ? null : texts.join('\n');
}

/** @typedef {{ sessionId: string|null, model: string|null, tools: string[]|null, mcpServers: unknown[]|null,
 *    plugins: unknown[]|null, skills: unknown[]|null, slashCommands: string[]|null }} StreamInit */
/** @typedef {{ input: number, cacheCreation: number, cacheRead: number, output: number }} StreamUsage */
/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null }} ToolPair */
/** @typedef {{ init: StreamInit|null, usage: StreamUsage, usageSource: 'result'|'assistant'|'none', toolPairs: ToolPair[],
 *    permissionDenials: unknown[]|null, result: { subtype: string|null, isError: boolean|null, numTurns: number|null,
 *    text: string|null }|null, assistantMessages: number, malformedLines: number }} StreamFacts */

/** What one spawn's stream-json says (W2-D51). Never throws.
 *  @param {string} text the whole stream
 *  @returns {StreamFacts} */
export function readStreamJson(text) {
  let init = null;
  let result = null;
  let resultUsage = null;
  let permissionDenials = null;
  let malformedLines = 0;
  const messages = new Map();   // message.id, or a fresh Symbol for a message with none -> its usage, or null
  const pairs = new Map();      // tool_use id -> its pair, in first-seen order
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    if (!sjObject(ev)) {
      malformedLines += 1;
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (init === null) {
        init = {
          sessionId: sjString(ev.session_id), model: sjString(ev.model), tools: sjList(ev.tools),
          mcpServers: sjList(ev.mcp_servers), plugins: sjList(ev.plugins), skills: sjList(ev.skills),
          slashCommands: sjList(ev.slash_commands),
        };
      }
    } else if (ev.type === 'assistant' && sjObject(ev.message)) {
      const msg = ev.message;
      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');
      if (sjObject(msg.usage)) messages.set(key, sjUsage(msg.usage));
      else if (!messages.has(key)) messages.set(key, null);
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (sjObject(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && !pairs.has(b.id)) {
          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null });
        }
      }
    } else if (ev.type === 'user' && sjObject(ev.message) && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (!sjObject(b) || b.type !== 'tool_result') continue;
        const pair = pairs.get(b.tool_use_id);
        if (pair === undefined) continue;   // a result with no tool_use in this stream pairs nothing
        pair.result = sjResultText(b.content);
        pair.isError = sjBool(b.is_error);
      }
    } else if (ev.type === 'result') {
      result = {
        subtype: sjString(ev.subtype), isError: sjBool(ev.is_error),
        numTurns: Number.isSafeInteger(ev.num_turns) ? ev.num_turns : null, text: sjString(ev.result),
      };
      resultUsage = sjObject(ev.usage) ? sjUsage(ev.usage) : null;
      permissionDenials = sjList(ev.permission_denials);
    }
  }
  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let usageSource = 'none';
  if (resultUsage !== null) {
    usage = resultUsage;
    usageSource = 'result';
  } else {
    for (const u of messages.values()) {
      if (u === null) continue;
      usageSource = 'assistant';
      usage = {
        input: usage.input + u.input, cacheCreation: usage.cacheCreation + u.cacheCreation,
        cacheRead: usage.cacheRead + u.cacheRead, output: usage.output + u.output,
      };
    }
  }
  return {
    init, usage, usageSource, toolPairs: [...pairs.values()], permissionDenials, result,
    assistantMessages: messages.size, malformedLines,
  };
}

/** One spawn's spend in token-equivalents (W2-D55): input + cache_creation + cache_read + output.
 *  @param {StreamFacts} facts
 *  @returns {number} */
export function spendTokens(facts) {
  const u = facts.usage;
  return u.input + u.cacheCreation + u.cacheRead + u.output;
}

/** The spend ledger's file name under --out. */
export const SPEND_LEDGER = 'spend.jsonl';
/** A ledger line's keys, sorted as canonicalJson writes them. */
const SPEND_KEYS = 'name,tokens,ts_ms';

/** Append one finished spawn's spend to the ledger under `out`: one canonical-JSON line, in one write. A name or a
 *  count that spentSoFar could not read back is a defect, so it throws TypeError and writes nothing.
 *  @param {string} out the --out directory (prepareOut's realpath)
 *  @param {string} name the job's name, unique within --out
 *  @param {number} tokens spendTokens of its stream */
export function recordSpend(out, name, tokens) {
  if (typeof name !== 'string' || name === '') throw new TypeError(`recordSpend: a job name is a non-empty string, not ${JSON.stringify(name)}`);
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new TypeError(`recordSpend: a spend is a non-negative integer, not ${String(tokens)}`);
  appendFileSync(`${out}/${SPEND_LEDGER}`, `${canonicalJson({ name, tokens, ts_ms: Date.now() })}\n`, { mode: 0o600 });
}

/** One ledger line as {name, tokens}, or null when it is not one recordSpend writes. */
function spendRow(line) {
  let v;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!sjObject(v) || Object.keys(v).sort().join(',') !== SPEND_KEYS) return null;
  if (typeof v.name !== 'string' || v.name === '') return null;
  if (!Number.isSafeInteger(v.tokens) || v.tokens < 0 || !Number.isSafeInteger(v.ts_ms) || v.ts_ms < 0) return null;
  return { name: v.name, tokens: v.tokens };
}

/** The cumulative spend under `out` (W2-D55): every line summed, a repeated name included (never de-duplicated:
 *  over-counting is the budget's safe direction). 0 when no ledger exists yet. A ledger
 *  that is not a regular file, cannot be read, or holds a line recordSpend would not write (a torn last line
 *  included) throws DriverRefusal('budget-exhausted', 'ledger-unreadable').
 *  @param {string} out
 *  @returns {number} */
export function spentSoFar(out) {
  const file = `${out}/${SPEND_LEDGER}`;
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    if (e?.code === 'ENOENT') return 0;
    refuse('budget-exhausted', 'ledger-unreadable');
  }
  if (!st.isFile()) refuse('budget-exhausted', 'ledger-unreadable');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    refuse('budget-exhausted', 'ledger-unreadable');
  }
  const rows = text.split('\n');
  if (rows.pop() !== '') refuse('budget-exhausted', 'ledger-unreadable');   // the last line was torn
  let sum = 0;
  for (const line of rows) {
    const row = spendRow(line);
    if (row === null) refuse('budget-exhausted', 'ledger-unreadable');
    sum += row.tokens;
  }
  return sum;
}

```

Then check: `grep -c 'redactDisplayWindow' deploy/history-replay.mjs` prints 0, and `grep -c '^if (process.argv\[1\] && import.meta.url' deploy/history-replay.mjs` prints 1, still the file's last block.

- [ ] **Step 5: Run them and see them pass, then run the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 4')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- **The filtered run** is green: `25 passed`, with Tasks 1–3's cases counted as skipped (measured against the stand-in). As root, the unreadable-ledger case is skipped and the count is `24 passed`.
- **The whole file** is green: Tasks 1–3's cases plus these 25.
- **tsc** prints nothing. The test reaches the driver's types through `allowJs` and the JSDoc above. `idx` is typed by lib's own `PairIndex`, so `makePairIndex`'s answer is assignable (measured: a hand-written `{ byLen: Map<…>, belt }` type there gave TS2345 on every call). A line that names only `agent/src/`, or a module that is not installed, comes from the worktree's install, not from this task. A line naming `history-replay` is this task's.

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter, shows it red, and then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/driver.orig"
t4run() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/driver.orig" deploy/history-replay.mjs; }

# M1 (W2-D54 order): cut before redact.
mut deploy/history-replay.mjs "  const r = redactForSpawn(field, idx);" "  const r = redactForSpawn({ text: cutToolResult(field.text), rawLen: field.rawLen }, idx);"
t4run 'W2-D54 order'
# Expected RED (measured): 1 failed, the secret's head survived the cut: expected 'a a a a …' not to contain 'q7vk2m'.

# M2 (W2-D54): truncate an over-cap field instead of discarding it.
mut deploy/history-replay.mjs "  if (blobOverDecodeCap(field.rawLen)) return { state: 'discard', why: 'over-decode-cap' };" "  if (blobOverDecodeCap(field.rawLen)) return { state: 'text', text: redactField(cutToolResult(field.text), idx) };"
t4run 'is discarded, never truncated'
# Expected RED (measured): 1 failed, expected { state: 'text', …(1) } to deeply equal { state: 'discard', …(1) }.

# M3 (W2-D51): a duplicated assistant message counted twice.
mut deploy/history-replay.mjs "      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');" "      const key = Symbol('every event its own message');"
t4run 'summed once per message.id'
# Expected RED (measured): 1 failed, expected { input: 21, cacheCreation: 42, …(2) } to deeply equal { input: 11, cacheCreation: 22, …(2) }.

# M4 (W2-D51): an absent init field folded to [].
mut deploy/history-replay.mjs "const sjList = (v) => (Array.isArray(v) ? [...v] : null);" "const sjList = (v) => (Array.isArray(v) ? [...v] : []);"
t4run 'a field it did not carry reads null'
# Expected RED (measured): 1 failed, expected { …(7) } to deeply equal { …(7) } (plugins [] where null was expected).

# M5 (W2-D55, coordinator ruling): the ledger de-duplicated by name, the last line winning, so a re-run's spend is lost.
mut deploy/history-replay.mjs "    sum += row.tokens;
  }
  return sum;" "    last.set(row.name, row.tokens);
  }
  for (const t of last.values()) sum += t;
  return sum;"
mut deploy/history-replay.mjs "  let sum = 0;
  for (const line of rows) {" "  let sum = 0;
  const last = new Map();
  for (const line of rows) {"
t4run 'a repeated name included'
# Expected RED (predicted): 1 failed, a re-run adds to the total, never replaces it: expected 170 to be 270.

# M6 (W2-D55): a malformed line skipped instead of failing closed.
mut deploy/history-replay.mjs "    if (row === null) refuse('budget-exhausted', 'ledger-unreadable');" "    if (row === null) continue;"
t4run 'a malformed ledger'
# Expected RED (measured): 8 failed | 1 passed, expected null to deeply equal { word: 'budget-exhausted', …(1) }. The torn-line row stays green: M7 measures its own guard.

# M7 (W2-D55): a torn last line dropped instead of failing closed.
mut deploy/history-replay.mjs "  if (rows.pop() !== '') refuse('budget-exhausted', 'ledger-unreadable');   // the last line was torn" "  rows.pop();"
t4run 'a torn last line'
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'budget-exhausted', …(1) }.

# M8 (W2-D55): the regular-file check dropped, so a symlinked ledger is read.
mut deploy/history-replay.mjs "  if (!st.isFile()) refuse('budget-exhausted', 'ledger-unreadable');" ""
t4run 'a ledger that is a directory'
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'budget-exhausted', …(1) } (the symlink half; the directory half still refuses, through EISDIR).

# M9 (W2-D55): an unreadable ledger read as no spend. As root this case is skipped, so the mutant is unmeasured there.
mut deploy/history-replay.mjs "    text = readFileSync(file, 'utf8');
  } catch {
    refuse('budget-exhausted', 'ledger-unreadable');" "    text = readFileSync(file, 'utf8');
  } catch {
    return 0;"
t4run 'an unreadable ledger'
# Expected RED (measured, non-root): 1 failed, expected null to deeply equal { word: 'budget-exhausted', …(1) }.

# M10 (W2-D54): the driver imports lib's display-window redaction.
mut deploy/history-replay.mjs "canonicalJson, redactField } from '../ccd/history/lib.mjs';" "canonicalJson, redactDisplayWindow, redactField } from '../ccd/history/lib.mjs';"
t4run 'display-window'
# Expected RED (measured): 1 failed, expected '#!/usr/bin/env node …' not to match /\bredactDisplayWindow\b/.

# M11 (W2-D51): the result event's usage ignored in favour of the assistant sum.
mut deploy/history-replay.mjs "  if (resultUsage !== null) {" "  if (false) {"
t4run 'the rest of the stream'
# Expected RED (measured): 1 failed, expected 'assistant' to be 'result'.

cmp deploy/history-replay.mjs "$SCRATCH/driver.orig" && echo restored
git diff --stat -- deploy/history-replay.mjs server/test/history-replay.test.ts
```

M10's anchor assumes the lib import's braces end `canonicalJson, redactField }` as Step 4(a) writes them. If an earlier task added a name after `redactField`, insert ` redactDisplayWindow,` before the closing brace instead, with the same assertion that it matches once. Then run Step 5's first two commands once more: green.

- [ ] **Step 7: Run the neighbours that read the driver.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts -t 'node-floor leg')
```

Expected: green.
- **`single-definition`.** O13's switch scan walks `ALL_MJS`, which includes `deploy/`, and this section spells no switch name. O14's declaration scan walks `DECL_CORPUS`, and this section declares no `VOCABS` name. Task 1's no-`node:sqlite` scan sits in `history-replay.test.ts` and ran in Step 5.
- **`ci-pipeline`.** The node-floor list is unchanged, because this task adds no test file.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 4 — spawned text, the stream-json reader and the spend ledger" -m "$CO_AUTHORED_BY"
```

---

### Task 5: The spawn contract and the batch runner

Tasks 1 to 4 leave the driver with its words, an `--out`, an admitted `LaunchSpec`, a stream reader and a spend ledger, but no way to run Claude Code. This task adds the one way it does, which every later spawn uses: step 0a and the probe (Tasks 8 and 9), step 0b's mechanics (Task 9), and W2-5a's writer and W2-5b's arms and judge. It follows spec §10.2 "Two arms" (Launch, Environment, cwd, Flags, Tools) and SE10's "How they run":
- **argv per mode** (`arm`, `writer`, `judge`, `box`). The settings argv comes first (`--restricted`, or W2-D57's fallback pair), then `-p --no-session-persistence --strict-mcp-config --output-format stream-json --verbose --max-turns 12 --model <model>`. `arm` and `box` add `--tools Bash,Agent` and `--allowedTools` with the three taught spellings; `writer` and `judge` add `--tools ""` and no `--allowedTools`. No mode ever carries a bypass flag. Input goes on stdin, never into argv.
- **env** is a fresh object (the `env -i` equivalent, W2-D50), never a copy of the driver's own: `HOME`, `PATH` = `<out>/poison-bin:<node's dir>:/usr/bin:/bin`, `LANG` (the caller's, carried in as `RunJob.lang` from `main`'s `env`, else `C.UTF-8`) and the account's `CLAUDE_CONFIG_DIR`. `arm` mode alone adds `CCRC_RECALL_SESSION`, `CCRC_RECALL_ARM` and `CCRC_RECALL_ASOF`, whose values are parameters: this file spells no arm word. The poisoned `gh` (the `ghContainedEnv` shape: it exits 97) is planted under `--out`.
- **cwd** is a fresh `mkdtemp` under `os.tmpdir()`: 0700, empty, checked to be outside any git tree, and removed after the run.
- **One run** is `spawn(launcher, argv)` with an argv array and no shell, killed on its own pid if it outlives its timeout. It writes `<out>/<name>.jsonl`, then its spend line, then `<out>/<name>.run.json` LAST via tmp + rename. The run.json is the completion marker. From stderr it keeps only the option names reported as unknown.
- **`runBatch`** runs at most `BATCH_MAX` (10) jobs, at most `CONCURRENCY_MAX` (2) at once. It calls a required gate before each spawn (Task 6 supplies `batchGate`; a missing gate is a `TypeError`) and skips a job whose run.json exists, so a stopped batch resumes (W2-D53, W2-D55).

RP1-contract's stub half lands here. Its subcommand half, the writer and judge spawns through `step0a`, is Task 8's. Nothing here spawns a real Claude Code: the tests drive a recording stub.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - The import block: the names listed in Step 4, merged into the existing statements, one statement per module.
  - One section inserted directly above the entry guard (the file's last block), after Task 4's section.
- Modify: `server/test/history-replay.test.ts`.
  - Eight import lines directly after the file's last `import` line. Each binds only new `t5`-prefixed names, so none collides with a binding an earlier task made. ES modules allow a second import declaration of one specifier.
  - One block appended at the end of the file.
- Not edited: every other file (Global Constraints). There is no new helper file: the stub's source is a string constant in the test file.

**Interfaces:**
- Consumes (Task 1): `DriverRefusal`, `refuse(word, detail)`, the words `out-refused` and `budget-exhausted`, and the entry guard's by-name projection line, which the env scan pins as the driver's only `process.env` line (no exemption).
- Consumes (Task 2): `insideGitTree(p)`, which `makeRunCwd` and the tests call, and `prepareOut(out)` in the tests.
- Consumes (Task 3):
  - `readRoster(home)` and `admitAccount(json, roster, id, home)` in the tests;
  - the `LaunchSpec` fields `accountId`, `launcher` and `configDir`;
  - the test helper `writeRoster(home, accounts)`.
- Consumes (Task 4):
  - `readStreamJson(text)`, `spendTokens(facts)` and `recordSpend(out, name, tokens)`;
  - `spentSoFar(out)` in the tests.
  The tests rely on Task 4's reader taking the result event's `usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), so the canned stream spends 65. Step 1 checks this.
- Consumes (base):
  - `canonicalJson` (`lib.mjs:454`) and `sha256Hex` (`:527`);
  - `generateWrapperBody` (`shared/wrapper.mjs:80`), tests only. It writes the generated account's real wrapper, which exports `CLAUDE_CONFIG_DIR`, sources `$HOME/<secretsFile>` when readable, and execs `$HOME/.local/bin/<upstreamId>`;
  - `mkTmp` (`server/test/tmpHelpers.ts:38`).
- Produces (`deploy/history-replay.mjs`):
  - `SPAWN_MODES = Object.freeze(['arm','writer','judge','box'])`, `SETTINGS_MODES = Object.freeze(['restricted','fallback'])`, `MAX_TURNS = 12`, `BATCH_MAX = 10`, `CONCURRENCY_MAX = 2`, `POISON_BIN_DIR = 'poison-bin'`;
  - `allowedToolSpellings(home: string): readonly string[]`, exactly `` [`Bash(${home}/.local/bin/ccrc history:*)`, 'Bash("$HOME/.local/bin/ccrc" history:*)', 'Bash(~/.local/bin/ccrc history:*)'] ``. A relative `home` is a `TypeError`;
  - `spawnArgv({mode, model, settingsMode, home}): string[]`, pure. An unknown mode or settings mode, or a model that is not a model id (one starting with `-` included), is a `TypeError`;
  - `spawnEnv({mode, home, configDir, poisonBin, lang, recall}): Record<string,string>`, pure. In `arm` mode, a missing or empty `recall.session`, `recall.arm` or `recall.asof` is a `TypeError`, and so is a `recall` passed in any other mode;
  - `ensurePoisonBin(out: string): string`. It answers `<out>/poison-bin` and writes `gh` there on every call; a `poison-bin` that is not a directory refuses `out-refused`;
  - `makeRunCwd(): string`. It answers a realpath and refuses `out-refused` with `run-cwd-in-git-tree <at>`, `run-cwd-git-unmeasured <at> <code>`, `run-cwd-mode <octal>` or `run-cwd-not-empty`, removing the directory first;
  - `launchRun(job: RunJob): Promise<RunOutcome>`;
  - `RunJob = {launch: LaunchSpec, mode: string, model: string, settingsMode: string, recall?: {session, arm, asof}, stdin: string, out: string, name: string, lang: string | undefined, timeoutMs?: number}`. `timeoutMs` defaults to `1_800_000`. `lang` is the caller's `LANG`, threaded from `main`'s `env` (Tasks 8 and 9 pass `env.LANG`); the key is required, its value may be `undefined` (then `C.UTF-8`), and a job without the key is a `TypeError`, so a caller that forgets it fails loudly rather than defaulting. `name` is one to four `/`-separated segments of `[a-z0-9][a-z0-9._-]*`, such as `step0a/writer` or `step0b/turn-bound`; the stream and run.json land under `--out` at that relative path;
  - `RunOutcome = {name, skipped: boolean, code: number|null, signal: string|null, ms: number, cwd: string, streamPath: string, facts: StreamFacts, tokens: number, unknownOptions: string[]}`;
  - `<out>/<name>.run.json` holds `canonicalJson({kind: 'ccrc-history-replay-run', v: 1, name, account, mode, model, settings_mode, code, signal, ms, cwd, stream_sha256, tokens, unknown_options}) + '\n'`, mode 0600;
  - `runBatch(jobs: RunJob[], opts: {concurrency?: number, gate: () => void}): Promise<RunOutcome[]>`. `gate` is required: a missing one is a `TypeError` before any spawn, never a batch run ungated (a test that tests the runner passes an explicit no-op). It throws a `TypeError` when `jobs.length > BATCH_MAX`, when `concurrency` is not an integer from 1 to `CONCURRENCY_MAX`, or when two jobs share an `--out` and name. Outcomes come back in job order. The first throw, the gate's included, rejects the batch after the runs already started have finished.
  - Not exported: `RUN_TIMEOUT_MS`, `KILL_GRACE_MS`, `STDERR_KEEP_BYTES`, `RUN_KIND`, `runHomeOf`, `runPaths`, `finishedOutcome`, `runChild`, `unknownOptionsIn`.
- Produces (test side):
  - `plantStub(home: string, id: string): void`, which writes the stub at `$HOME/.local/bin/<id>` (mode 0700) and a default `STUB_STREAM`;
  - `stubLog(home: string): T5Log[] | null`, which is `null` when the stub never ran;
  - `STUB_STREAM = 'stub-stream.jsonl'`, the file under `$HOME` that the stub prints;
  - the stub's controls `stub-sleep-ms`, `stub-stderr.txt` and `stub-exit`;
  - `t5Box(prefix)`: a fixture home with `up-a` (upstream, the stub) and `gen-a` (generated with provider `anthropic`, through its real wrapper and a secrets file), an admitted `LaunchSpec` for each, and a prepared `--out`.

**Spec:** §10.2 "Two arms" (`:2658`): Launch, Environment (`env -i` plus the allowlist; never `TMUX`, `TMUX_PANE`, `CLAUDECODE` or `CLAUDE_CODE_SESSION_ID`), cwd, Flags and Tools. "How they run" (SE10) puts the writer and the judge through this same contract with `--tools ""`. "Account and budget" (`:2686`) says "At most 2 runs are concurrent". The pin is RP1 (`:2740`), its contract half.

**Decisions:** W2-D50 (the exact key set; arm values are parameters; the writer and the judge get the same allow-list with no `CCRC_RECALL_*`), W2-D51 (launch per kind, `env -i`, explicit `PATH`, empty 0700 cwd outside any git tree, the flags, `--restricted` with the fallback as a parameter, `--model`, `--tools Bash,Agent` and the three spellings, never bypass, `--tools ""` on stdin, at most 2 at once), W2-D53 (finished outputs are skipped on reuse) and W2-D55 (a batch is at most 10 spawns, stoppable and resumable). This task defines no D-number: it departs from nothing.

**Choices this task makes:**
- **`HOME` is derived from the launch, never read from the caller.** `launchRun` takes `HOME` as `path.dirname(launch.configDir)`. Admission builds `configDir` as `$HOME/<configDirSuffix>`, and `rosterFromJson` refuses a suffix holding `/`, so the derivation is exact. It also checks that the launcher sits under `<that home>/.local/bin/`, and a `TypeError` says otherwise. A test that calls `launchRun` in-process therefore never hands the suite's own `HOME` to a child.
- **`LANG` is threaded, never read here (coordinator ruling).** `RunJob.lang` carries the caller's `LANG` from `main`'s `env` parameter, which the entry guard filled by name. The driver's only `process.env` line is the entry guard's projection, and the env scan pins exactly that, with no exemption.
- **Spend before the completion marker.** A run's order is stream, ledger line, run.json. If the run is killed between the ledger line and the run.json, it is spawned again on resume, and its second spend line adds to Task 4's summed ledger: an over-count, the safe direction for a budget. The opposite order would lose a finished run's spend for good, so the budget would fail open.
- **The gate is required, so the stop is never opt-in.** `runBatch` refuses an `opts.gate` that is not a function with a `TypeError` before any spawn, so a later consumer that forgets W2-D55's stop fails loudly instead of spawning with no budget and no limits read (M13). `launchRun` stays the one ungated primitive: inside this PR only `runBatch` calls it, and Task 9's `step0bMechanics` goes through `runBatch` too.
- **A run that timed out is finished.** It gets a run.json carrying its `signal` (`SIGTERM`), and resume does not spawn it again. Whether such a run counts as run-failed is W2-5b's classification, not this runner's.
- **Resume re-checks what it builds on.** A run.json that does not parse, or whose `stream_sha256` no longer matches the stream's bytes, refuses `out-refused` (`run-json-invalid <name>`, `run-stream-changed <name>`). It is never silently re-spawned or trusted.
- **Resume reuses a run only for the job that recorded it.** A run.json whose `account`, `mode`, `model` or `settings_mode` differs from the job's refuses `out-refused` `run-json-mismatch <name>` (M14). Without it, re-running `step0a` or `probe` on the same `--out` under another `--account`, model or `--settings-mode` would skip the finished runs and record the new account over another account's init events, unknown options and tokens. An arm run's `recall` values are not in `run.json`, so they are not compared here; W2-5b, which names the arm runs, owns that half.
- **Every argv carries `--verbose`.** It is not in W2-D51's original flag list or spec §10.2's Flags; W2-D57's 2026-10-19 amendment adds it, and W2-D51 now points at that amendment. In print mode (`-p`), Claude Code prints `--output-format stream-json` only with `--verbose`, and the reader (Task 4) needs that stream. RP1-contract pins it with the rest of the argv, and step 0a's `flags_accepted` (Task 8) measures it like every other flag. By coordinator ruling it stays as written: it is spec erratum E26 (decisions §6), carried by W2-1's §10.2 amendment, and this PR never edits the spec.
- **A temp root inside a git tree refuses with an existing word.** It is `out-refused` with a `run-cwd-…` detail, so no word is added to Task 1's `DRIVER_REASONS`.
- **stderr is read to a bound.** Only the first 64 KiB is read, and only unknown-option names leave it (`error: unknown option '--x'`, in single or double quotes). Everything else on stderr is dropped, since it may carry anything a launcher prints.
- **The generated route's key set excludes the shell's own.** bash exports `PWD` and `SHLVL` (and on some builds `_`) to what it execs. The generated case asserts the exact key set after removing those three. The upstream case, which has no shell in between, asserts the exact set.
- **The stub finds its fixture home from its own path,** `<home>/.local/bin/<id>`, never from `$HOME`. A mutant that leaks the caller's env then still logs inside the fixture, never into the `HOME` running the suite. This was measured: under such a mutant, a stub that read `$HOME` wrote its log outside the fixture.

- [ ] **Step 1: Confirm Tasks 1 to 4's names before using them.** From the repository root:

```bash
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); const f = d.readStreamJson(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok', permission_denials: [], usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } }) + '\n'); console.log(d.spendTokens(f), f.usageSource, ['refuse', 'DriverRefusal', 'insideGitTree', 'prepareOut', 'readRoster', 'admitAccount', 'recordSpend', 'spentSoFar'].map((n) => typeof d[n]).join(','), d.DRIVER_REASONS.includes('out-refused'), typeof d.launchRun)"
grep -cE "^import \{[^}]*\bdescribe\b[^}]*\} from 'vitest';" server/test/history-replay.test.ts
grep -cE '\b(function|const) writeRoster\b' server/test/history-replay.test.ts
grep -c '\bt5[A-Za-z]' server/test/history-replay.test.ts
```

Expected:
- the first command prints `65 result function,function,function,function,function,function,function,function true undefined`. Importing the module runs nothing: the entry guard needs `process.argv[1]`, which `-e` leaves undefined;
- the vitest import line that binds `describe` (with `it` and `expect`) counts 1, Task 3's `writeRoster` at least 1, and `t5`-prefixed names 0. A `grep -c` that prints 0 exits 1, which is expected for the last one.

A different first line, or a 0 for either of the next two, is a gap in an earlier task: stop and report it. In particular, a spend other than `65` means Task 4's reader does not take the result event's four usage fields, and every spend figure below would change with it. Never define any of these names here.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, directly after the file's last `import` line, insert:

```ts
import * as t5fs from 'node:fs';
import * as t5os from 'node:os';
import * as t5path from 'node:path';
import { spawnSync as t5spawnSync } from 'node:child_process';
import { afterEach as t5afterEach, vi as t5vi } from 'vitest';
import * as t5drv from '../../deploy/history-replay.mjs';
import { generateWrapperBody as t5WrapperBody } from '../../shared/wrapper.mjs';
import { mkTmp as t5MkTmp } from './tmpHelpers.js';
```

Then append at the end of the file:

```ts
// ── W2-4 Task 5: the spawn contract and the batch runner (W2-D50, W2-D51, W2-D53, W2-D55; RP1-contract) ────────
// Every spawn reaches a recording stub, a node script at `$HOME/.local/bin/up-a` (the fixture upstream), never a
// real Claude Code. The generated account's launcher is the real wrapper text from generateWrapperBody, which
// sources a fixture secrets file and execs the same stub, so the generated case runs through its own wrapper.
// The stub logs one JSON line per run: argv, env key names, every env value except CLAUDE_CODE_OAUTH_TOKEN, cwd,
// the cwd's mode and entries, stdin, and start and end stamps; then it prints STUB_STREAM on stdout. It finds its
// fixture home from its own path (`<home>/.local/bin/<id>`), never from $HOME, so a mutant that leaks the
// caller's env still logs inside the fixture and never writes to the HOME running the suite.

/** The file the stub prints as its stream-json. */
const STUB_STREAM = 'stub-stream.jsonl';
const T5_STUB_LOG = 'stub-log.jsonl';
type T5Launch = ReturnType<typeof t5drv.admitAccount>;
type T5Job = Parameters<typeof t5drv.launchRun>[0];
/** Optional stub controls, each a file under $HOME: sleep before exiting, text for stderr, an exit code. */
const T5_STUB_SLEEP = 'stub-sleep-ms';
const T5_STUB_STDERR = 'stub-stderr.txt';
const T5_STUB_EXIT = 'stub-exit';
const T5_STUB_SOURCE = `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const start = Date.now();
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  const at = (f) => path.join(home, f);
  const opt = (f) => { try { return fs.readFileSync(at(f), 'utf8'); } catch { return null; } };
  const stdin = fs.readFileSync(0, 'utf8');
  const cwd = process.cwd();
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'CLAUDE_CODE_OAUTH_TOKEN') env[k] = v;
  const cwdMode = fs.statSync(cwd).mode & 0o777;
  const cwdEntries = fs.readdirSync(cwd);
  const sleep = Number(opt(${JSON.stringify(T5_STUB_SLEEP)}) ?? '0');
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
  const err = opt(${JSON.stringify(T5_STUB_STDERR)});
  if (err !== null) process.stderr.write(err);
  fs.appendFileSync(at(${JSON.stringify(T5_STUB_LOG)}), JSON.stringify({ argv: process.argv.slice(2),
    envKeys: Object.keys(process.env).sort(), env, cwd, cwdMode, cwdEntries, stdin, start, end: Date.now() }) + '\\n');
  process.stdout.write(opt(${JSON.stringify(STUB_STREAM)}) ?? '');
  process.exitCode = Number(opt(${JSON.stringify(T5_STUB_EXIT)}) ?? '0');
})();
`;

/** A canned stream-json: init, one assistant message, a result whose usage sums to 65. */
const T5_STREAM = [
  { type: 'system', subtype: 'init', session_id: 'fixture-session-id', model: 'fixture-model', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
  { type: 'assistant', message: { id: 'msg-fixture-1', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] } },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok', permission_denials: [],
    usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } },
].map((e) => JSON.stringify(e)).join('\n') + '\n';
const T5_TOKENS = 65;

/** Plant the recording stub at `$HOME/.local/bin/<id>` (mode 0700) and the default STUB_STREAM. */
function plantStub(home: string, id: string): void {
  const bin = t5path.join(home, '.local', 'bin');
  t5fs.mkdirSync(bin, { recursive: true });
  t5fs.writeFileSync(t5path.join(bin, id), T5_STUB_SOURCE, { mode: 0o700 });
  if (!t5fs.existsSync(t5path.join(home, STUB_STREAM))) t5fs.writeFileSync(t5path.join(home, STUB_STREAM), T5_STREAM);
}

type T5Log = { argv: string[]; envKeys: string[]; env: Record<string, string>; cwd: string; cwdMode: number;
  cwdEntries: string[]; stdin: string; start: number; end: number };
/** Every line the stub logged, in order, or null when it never ran. */
function stubLog(home: string): T5Log[] | null {
  const p = t5path.join(home, T5_STUB_LOG);
  if (!t5fs.existsSync(p)) return null;
  return t5fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as T5Log);
}

/** The fixture OAuth token, assembled at runtime so no key-shaped literal sits in the tree. */
const T5_TOKEN = ['sk', 'ant', 'oat01'].join('-') + '-' + ['FIXTURE', 'TASK5', 'x'.repeat(24)].join('');

/** A home with up-a (upstream, the stub) and gen-a (generated/anthropic: its real wrapper, its secrets file),
 *  an admitted LaunchSpec for each, and a prepared --out. */
function t5Box(prefix: string): { home: string; out: string; up: T5Launch; gen: T5Launch } {
  const home = t5MkTmp(prefix);
  writeRoster(home, [
    { id: 'up-a', label: 'Up A', configDirSuffix: '.claude', homeAble: true, telemetry: 'anthropic', exec: { kind: 'upstream' } },
    { id: 'gen-a', label: 'Gen A', configDirSuffix: '.gen-a', homeAble: true, telemetry: 'anthropic',
      exec: { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-a.env' } },
  ]);
  plantStub(home, 'up-a');
  t5fs.writeFileSync(t5path.join(home, '.local', 'bin', 'gen-a'),
    t5WrapperBody({ id: 'gen-a', configDirSuffix: '.gen-a', execKind: 'generated', secretsFile: '.cc-secrets/gen-a.env' }, 'up-a'),
    { mode: 0o700 });
  t5fs.mkdirSync(t5path.join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  t5fs.writeFileSync(t5path.join(home, '.cc-secrets', 'gen-a.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${T5_TOKEN}\n`, { mode: 0o600 });
  const { json, roster: parsed } = t5drv.readRoster(home);
  return {
    home, out: t5drv.prepareOut(t5path.join(home, 'out')),
    up: t5drv.admitAccount(json, parsed, 'up-a', home), gen: t5drv.admitAccount(json, parsed, 'gen-a', home),
  };
}

const T5_RECALL = { session: 'fixture-recall-session', arm: 'fixture-arm-value', asof: 'fixture-asof-uuid' };
/** An explicit no-op gate: runBatch requires one, and these cases test the runner, not Task 6's stop. */
const T5_NO_GATE = (): void => {};
const T5_BASE_KEYS = ['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH'];
const T5_RECALL_KEYS = ['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION'];
/** Keys bash itself exports to what it execs; seen only on the generated route, which runs the wrapper. */
const T5_BASH_KEYS = ['PWD', 'SHLVL', '_'];
const T5_NEVER_KEYS = ['CCRC_SESSION_GENERATION', 'TMUX', 'TMUX_PANE', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID'];
const t5job = (b: { out: string }, launch: T5Launch, mode: string, name: string, extra: Partial<T5Job> = {}): T5Job => ({
  launch, mode, model: `fixture-model-${mode}`, settingsMode: 'restricted', stdin: `fixture input for ${name}\n`,
  out: b.out, name, lang: 'fixture.UTF-8', ...(mode === 'arm' ? { recall: T5_RECALL } : {}), ...extra,
});
/** Plant the ambient state a leaked env would carry, so every absence below can fail. The ambient LANG differs from
 *  the job's, so a child LANG of 'fixture.UTF-8' proves it came through RunJob.lang, never from process.env. */
function t5Ambient(): void {
  t5vi.stubEnv('LANG', 'ambient.UTF-8');
  t5vi.stubEnv('PATH', `/fixture-caller-bin:${process.env['PATH'] ?? ''}`);
  for (const k of T5_NEVER_KEYS) t5vi.stubEnv(k, 'fixture-ambient');
  t5vi.stubEnv('CCRC_RECALL_ARM', 'fixture-ambient');
}

/** The contract's argv, spelled out here rather than taken from spawnArgv, so a stub case is not circular. */
const t5Spellings = (home: string): string[] =>
  [`Bash(${home}/.local/bin/ccrc history:*)`, 'Bash("$HOME/.local/bin/ccrc" history:*)', 'Bash(~/.local/bin/ccrc history:*)'];
const t5Argv = (mode: string, model: string, home: string): string[] => ['--restricted', '-p', '--no-session-persistence',
  '--strict-mcp-config', '--output-format', 'stream-json', '--verbose', '--max-turns', '12', '--model', model,
  ...(mode === 'arm' || mode === 'box' ? ['--tools', 'Bash,Agent', '--allowedTools', ...t5Spellings(home)] : ['--tools', ''])];

describe('W2-4 Task 5: the spawn argv and env, pure (W2-D50, W2-D51)', () => {
  const HOME = '/fixture/home';
  const SPELLINGS = t5Spellings(HOME);
  const FIXED = t5Argv('writer', 'fixture-model', HOME).slice(1, -2);

  it('the words: four modes, two settings modes, 12 turns, 10 a batch, 2 at once', () => {
    expect([...t5drv.SPAWN_MODES]).toEqual(['arm', 'writer', 'judge', 'box']);
    expect([...t5drv.SETTINGS_MODES]).toEqual(['restricted', 'fallback']);
    expect([t5drv.MAX_TURNS, t5drv.BATCH_MAX, t5drv.CONCURRENCY_MAX, t5drv.POISON_BIN_DIR]).toEqual([12, 10, 2, 'poison-bin']);
    expect(Object.isFrozen(t5drv.SPAWN_MODES) && Object.isFrozen(t5drv.SETTINGS_MODES)).toBe(true);
  });

  it('the three taught spellings, exactly', () => {
    expect([...t5drv.allowedToolSpellings(HOME)]).toEqual(SPELLINGS);
    expect(() => t5drv.allowedToolSpellings('relative/home')).toThrow(TypeError);
  });

  it.each(['arm', 'box'])('%s: --restricted, the fixed flags, --model, --tools Bash,Agent and the three spellings', (mode) => {
    expect(t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode: 'restricted', home: HOME }))
      .toEqual(['--restricted', ...FIXED, '--tools', 'Bash,Agent', '--allowedTools', ...SPELLINGS]);
  });

  it.each(['writer', 'judge'])('%s: --tools with an empty value and no --allowedTools', (mode) => {
    expect(t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode: 'restricted', home: HOME }))
      .toEqual(['--restricted', ...FIXED, '--tools', '']);
  });

  it('the fallback settings mode replaces --restricted with the two settings flags, first', () => {
    expect(t5drv.spawnArgv({ mode: 'writer', model: 'fixture-model', settingsMode: 'fallback', home: HOME }))
      .toEqual(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}', ...FIXED, '--tools', '']);
  });

  it('no argv in any mode or settings mode carries a bypass flag; an unknown mode, settings mode or model id is a TypeError', () => {
    for (const mode of t5drv.SPAWN_MODES) for (const settingsMode of t5drv.SETTINGS_MODES) {
      const argv = t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode, home: HOME });
      expect(argv.filter((a) => /dangerously|bypass/i.test(a)), `${mode} ${settingsMode}`).toEqual([]);
    }
    expect(() => t5drv.spawnArgv({ mode: 'other', model: 'm', settingsMode: 'restricted', home: HOME })).toThrow(TypeError);
    expect(() => t5drv.spawnArgv({ mode: 'box', model: 'm', settingsMode: 'none', home: HOME })).toThrow(TypeError);
    expect(() => t5drv.spawnArgv({ mode: 'box', model: '--verbose', settingsMode: 'restricted', home: HOME })).toThrow(TypeError);
  });

  it('the env: the allow-list exactly, PATH built from the poison dir and node, LANG else C.UTF-8, arm values only in arm mode', () => {
    const base = { home: HOME, configDir: `${HOME}/.claude`, poisonBin: '/fixture/out/poison-bin' };
    const PATH = `/fixture/out/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`;
    expect(t5drv.spawnEnv({ ...base, mode: 'writer', lang: 'fixture.UTF-8' }))
      .toEqual({ HOME, PATH, LANG: 'fixture.UTF-8', CLAUDE_CONFIG_DIR: `${HOME}/.claude` });
    expect(t5drv.spawnEnv({ ...base, mode: 'judge', lang: undefined })['LANG']).toBe('C.UTF-8');
    expect(t5drv.spawnEnv({ ...base, mode: 'box', lang: '' })['LANG']).toBe('C.UTF-8');
    expect(t5drv.spawnEnv({ ...base, mode: 'arm', lang: 'fixture.UTF-8', recall: T5_RECALL })).toEqual({
      HOME, PATH, LANG: 'fixture.UTF-8', CLAUDE_CONFIG_DIR: `${HOME}/.claude`,
      CCRC_RECALL_SESSION: T5_RECALL.session, CCRC_RECALL_ARM: T5_RECALL.arm, CCRC_RECALL_ASOF: T5_RECALL.asof,
    });
    expect(() => t5drv.spawnEnv({ ...base, mode: 'arm', lang: undefined })).toThrow(TypeError);
    expect(() => t5drv.spawnEnv({ ...base, mode: 'arm', lang: undefined, recall: { ...T5_RECALL, asof: '' } })).toThrow(TypeError);
    expect(() => t5drv.spawnEnv({ ...base, mode: 'writer', lang: undefined, recall: T5_RECALL })).toThrow(TypeError);
  });
});

describe('W2-4 Task 5: RP1-contract on the stub, launch per kind (W2-D50, W2-D51)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it.each(['arm', 'writer', 'judge', 'box'])('upstream, %s: launched direct; exact argv, exact env keys and values, stdin, an empty 0700 cwd outside any git tree, removed after', async (mode) => {
    const b = t5Box(`ccrc-replay-t5-up-${mode}-`);
    t5Ambient();
    const o = await t5drv.launchRun(t5job(b, b.up, mode, `rp1-${mode}`));
    const log = stubLog(b.home);
    expect(log, 'the stub ran once').toHaveLength(1);
    const l = log![0]!;
    expect(l.argv).toEqual(t5Argv(mode, `fixture-model-${mode}`, b.home));
    expect(l.envKeys).toEqual([...T5_BASE_KEYS, ...(mode === 'arm' ? T5_RECALL_KEYS : [])].sort());
    expect(l.env['HOME']).toBe(b.home);
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`);
    expect(l.env['LANG']).toBe('fixture.UTF-8');
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(t5path.join(b.home, '.claude'));
    if (mode === 'arm') {
      expect([l.env['CCRC_RECALL_SESSION'], l.env['CCRC_RECALL_ARM'], l.env['CCRC_RECALL_ASOF']]).toEqual([T5_RECALL.session, T5_RECALL.arm, T5_RECALL.asof]);
    }
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(l.stdin).toBe(`fixture input for rp1-${mode}\n`);
    expect([l.cwdMode, l.cwdEntries]).toEqual([0o700, []]);
    expect(l.cwd.startsWith(t5fs.realpathSync(t5os.tmpdir()) + t5path.sep)).toBe(true);
    expect(t5drv.insideGitTree(l.cwd).state).toBe('outside');
    expect(o.cwd).toBe(l.cwd);
    expect(t5fs.existsSync(l.cwd), 'the cwd is removed after the run').toBe(false);
    expect([o.skipped, o.code, o.signal, o.tokens]).toEqual([false, 0, null, T5_TOKENS]);
  }, 60_000);

  it('generated: launched through its own wrapper, which sources the declared secrets file: CLAUDE_CODE_OAUTH_TOKEN reaches the stub, by name only', async () => {
    const b = t5Box('ccrc-replay-t5-gen-');
    t5Ambient();
    expect(b.gen.launcher).toBe(t5path.join(b.home, '.local', 'bin', 'gen-a'));
    await t5drv.launchRun(t5job(b, b.gen, 'writer', 'rp1-gen'));
    const l = stubLog(b.home)![0]!;
    expect(l.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(l.envKeys.filter((k) => !T5_BASH_KEYS.includes(k))).toEqual([...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort());
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(t5path.join(b.home, '.gen-a'));
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`);
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(t5fs.readFileSync(t5path.join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it('upstream gets no CLAUDE_CODE_OAUTH_TOKEN from the driver, even when the caller carries one', async () => {
    const b = t5Box('ccrc-replay-t5-uptok-');
    t5vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', T5_TOKEN);
    await t5drv.launchRun(t5job(b, b.up, 'judge', 'rp1-uptok'));
    expect(stubLog(b.home)![0]!.envKeys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  }, 60_000);

  it('the poisoned gh sits first on PATH under --out and exits 97', async () => {
    const b = t5Box('ccrc-replay-t5-gh-');
    await t5drv.launchRun(t5job(b, b.up, 'box', 'rp1-gh'));
    const gh = t5path.join(b.out, 'poison-bin', 'gh');
    expect(t5fs.statSync(gh).mode & 0o777).toBe(0o700);
    const r = t5spawnSync(gh, ['pr', 'merge'], { encoding: 'utf8' });
    expect(r.status).toBe(97);
  }, 60_000);

  it('a run leaves its stream, one ledger line and its run.json, written last with no tmp left, and keeps only the unknown option names from stderr', async () => {
    const b = t5Box('ccrc-replay-t5-files-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_STDERR), "error: unknown option '--fixture-flag'\nfixture-noise that is not kept\n");
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_EXIT), '1');
    const o = await t5drv.launchRun(t5job(b, b.up, 'writer', 'step/files'));
    expect([o.code, o.unknownOptions]).toEqual([1, ['--fixture-flag']]);
    expect(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.jsonl'), 'utf8')).toBe(T5_STREAM);
    expect(o.facts.usageSource).toBe('result');
    const run = JSON.parse(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.run.json'), 'utf8'));
    expect([run.kind, run.name, run.code, run.tokens, run.unknown_options]).toEqual(['ccrc-history-replay-run', 'step/files', 1, T5_TOKENS, ['--fixture-flag']]);
    expect(JSON.stringify(run)).not.toContain('fixture-noise');
    expect(t5fs.readdirSync(t5path.join(b.out, 'step')).sort()).toEqual(['files.jsonl', 'files.run.json']);
    expect(t5drv.spentSoFar(b.out)).toBe(T5_TOKENS);
  }, 60_000);

  it('a run that outlives its timeout is killed on its own pid and recorded with its signal', async () => {
    const b = t5Box('ccrc-replay-t5-timeout-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '8000');
    const o = await t5drv.launchRun(t5job(b, b.up, 'box', 'rp1-timeout', { timeoutMs: 300 }));
    expect([o.code, o.signal]).toEqual([null, 'SIGTERM']);
    expect(o.ms).toBeLessThan(5_000);
    expect(stubLog(b.home), 'killed before it logged').toBeNull();
  }, 6_000);
});

describe('W2-4 Task 5: the batch runner, at most 2 at once, gated, resumable (W2-D51, W2-D53, W2-D55)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it('a batch of more than BATCH_MAX jobs, a concurrency above CONCURRENCY_MAX, a batch with no gate, or a job without its lang key is a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-bounds-');
    const eleven = Array.from({ length: 11 }, (_, i) => t5job(b, b.up, 'box', `bound-${i}`));
    await expect(t5drv.runBatch(eleven, { gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(t5drv.runBatch(eleven.slice(0, 2), { concurrency: 3, gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(t5drv.runBatch(eleven.slice(0, 2), {}), 'a batch with no gate never spawns ungated').rejects.toThrow(TypeError);
    const { lang: _lang, ...noLang } = t5job(b, b.up, 'box', 'no-lang');
    await expect(t5drv.launchRun(noLang as T5Job), 'a caller that forgets lang fails loudly').rejects.toThrow(TypeError);
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('four jobs run two at a time, never three: the stub stamps overlap at most 2 deep', async () => {
    const b = t5Box('ccrc-replay-t5-conc-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const outs = await t5drv.runBatch(Array.from({ length: 4 }, (_, i) => t5job(b, b.up, 'box', `conc-${i}`)), { gate: T5_NO_GATE });
    expect(outs.map((o) => o.skipped)).toEqual([false, false, false, false]);
    const log = stubLog(b.home)!;
    expect(log).toHaveLength(4);
    const depth = Math.max(...log.map((x) => log.filter((y) => y.start <= x.start && x.start < y.end).length));
    expect(depth).toBe(2);
  }, 60_000);

  it('the gate is called before each spawn; a gate that throws stops the batch with its refusal and no further spawn', async () => {
    const b = t5Box('ccrc-replay-t5-gate-');
    let calls = 0;
    const gate = (): void => { calls += 1; if (calls === 2) throw new t5drv.DriverRefusal('budget-exhausted', 'fixture stop'); };
    const jobs = Array.from({ length: 3 }, (_, i) => t5job(b, b.up, 'box', `gate-${i}`));
    await expect(t5drv.runBatch(jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted' });
    expect(stubLog(b.home)).toHaveLength(1);
    expect(t5fs.existsSync(t5path.join(b.out, 'gate-0.run.json'))).toBe(true);
    const again = await t5drv.runBatch(jobs, { concurrency: 1, gate: () => { calls += 1; } });
    expect(again.map((o) => o.skipped)).toEqual([true, false, false]);
    expect(calls, 'the resumed batch gated its two spawns only').toBe(4);
    expect(stubLog(b.home)).toHaveLength(3);
  }, 60_000);

  it('resume: a finished job is never spawned again and the ledger counts it once; a job with no run.json is spawned again and its spend adds to the total', async () => {
    const b = t5Box('ccrc-replay-t5-resume-');
    const jobs = [t5job(b, b.up, 'writer', 'resume-0'), t5job(b, b.up, 'judge', 'resume-1')];
    await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    const again = await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    expect(again.map((o) => [o.skipped, o.tokens, o.facts.usageSource])).toEqual([[true, T5_TOKENS, 'result'], [true, T5_TOKENS, 'result']]);
    expect(stubLog(b.home)).toHaveLength(2);
    expect(t5drv.spentSoFar(b.out)).toBe(2 * T5_TOKENS);
    t5fs.rmSync(t5path.join(b.out, 'resume-1.run.json'));
    const third = await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    expect(third.map((o) => o.skipped)).toEqual([true, false]);
    expect(stubLog(b.home)).toHaveLength(3);
    // A run.json lost after its ledger line (a kill between the two): the re-spawn spends again, and the summed
    // ledger counts both spawns. Over-counting is the budget's safe direction (coordinator ruling).
    expect(t5drv.spentSoFar(b.out), 'the re-spawned job spent twice, and both count').toBe(3 * T5_TOKENS);
  }, 60_000);

  it('resume refuses a stream changed after its run.json, a run.json that does not parse, and one recorded for another account, mode, model or settings mode', async () => {
    const b = t5Box('ccrc-replay-t5-tamper-');
    const job = t5job(b, b.up, 'box', 'tamper-0');
    await t5drv.runBatch([job], { gate: T5_NO_GATE });
    // The same --out and name under another account, mode, model or settings mode is never answered from this run.
    const others = [t5job(b, b.gen, 'box', 'tamper-0'), t5job(b, b.up, 'writer', 'tamper-0'),
      t5job(b, b.up, 'box', 'tamper-0', { model: 'fixture-model-other' }), t5job(b, b.up, 'box', 'tamper-0', { settingsMode: 'fallback' })];
    for (const [i, other] of others.entries()) {
      await expect(t5drv.runBatch([other], { gate: T5_NO_GATE }), `variant ${i}`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-mismatch tamper-0' });
    }
    t5fs.appendFileSync(t5path.join(b.out, 'tamper-0.jsonl'), '{}\n');
    await expect(t5drv.runBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-changed tamper-0' });
    t5fs.writeFileSync(t5path.join(b.out, 'tamper-0.run.json'), 'not json');
    await expect(t5drv.runBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-invalid tamper-0' });
    expect(stubLog(b.home)).toHaveLength(1);
  }, 60_000);
});

describe('W2-4 Task 5: makeRunCwd refuses a temp root inside a git tree (W2-D51)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it('a TMPDIR under a planted git tree refuses out-refused and leaves no directory behind', () => {
    const root = t5MkTmp('ccrc-replay-t5-gitcwd-');
    t5fs.mkdirSync(t5path.join(root, '.git'));
    const tmp = t5path.join(root, 'tmp');
    t5fs.mkdirSync(tmp);
    t5vi.stubEnv('TMPDIR', tmp);
    let err: unknown = null;
    try { t5drv.makeRunCwd(); } catch (e) { err = e; }
    expect(err).toMatchObject({ word: 'out-refused', detail: `run-cwd-in-git-tree ${root}` });
    expect(t5fs.readdirSync(tmp)).toEqual([]);
  });
});

describe('W2-4 Task 5: the driver passes no env whole and reads only HOME, TMUX_PANE and LANG by name', () => {
  const SRC = t5path.resolve(__dirname, '..', '..', 'deploy', 'history-replay.mjs');
  /** The entry guard's by-name projection (Task 1): the driver's ONE process.env line. No line is exempt from the scan. */
  const PROJECTION = 'process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });';
  const isComment = (t: string): boolean => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  /** Non-comment lines that pass an env whole, spread one, or read process.env by any name outside the three. */
  const envViolations = (text: string): string[] => text.split('\n').filter((line) => {
    const t = line.trim();
    if (isComment(t)) return false;
    if (/\.\.\.\s*(?:process\.)?env\b/.test(t) || /\benv\s*:\s*(?:process\.)?env\b/.test(t) || /[{,]\s*env\s*[,}]/.test(t)
      || /Object\.assign\([^)]*\benv\b/.test(t)) return true;
    return [...t.matchAll(/process\.env(\.[A-Za-z_][A-Za-z0-9_]*)?/g)].some((m) => !['.HOME', '.TMUX_PANE', '.LANG'].includes(m[1] ?? ''));
  });

  it('CONTROL: the scan sees a spread, a whole pass (the old entry-guard form included), another name and a computed read, and passes the by-name projection', () => {
    for (const bad of ['const e = { ...process.env, HOME: home };', 'spawn(cmd, argv, { env: process.env });', 'const p = process.env.PATH;',
      'const v = process.env[name];', 'run({ ...env });', 'spawn(cmd, argv, { cwd, env: env });', 'spawn(cmd, argv, { cwd, env });',
      'Object.assign(child, process.env);', 'process.exitCode = await main(process.argv.slice(2), process.env);']) {
      expect(envViolations(bad), bad).toEqual([bad]);
    }
    expect(envViolations([`  ${PROJECTION}`, '// never { ...process.env }', 'spawn(cmd, argv, { cwd, env: childEnv });'].join('\n'))).toEqual([]);
  });

  it('deploy/history-replay.mjs: no violation, and the entry guard\'s by-name projection is its only process.env line', () => {
    const text = t5fs.readFileSync(SRC, 'utf8');
    expect(envViolations(text)).toEqual([]);
    const envLines = text.split('\n').map((l) => l.trim()).filter((t) => !isComment(t) && /\bprocess\.env\b/.test(t));
    expect(envLines, 'every other env read goes through main\'s env parameter').toEqual([PROJECTION]);
  });

  it('deploy/history-replay.mjs spells no bypass flag and spawns through no shell', () => {
    const code = t5fs.readFileSync(SRC, 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
    expect(code.filter((l) => /dangerously-skip-permissions|bypassPermissions/.test(l))).toEqual([]);
    expect(code.filter((l) => /\bshell\s*:|\b(?:exec|execSync|execFile|execFileSync)\s*\(/.test(l))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 5')
```

Expected: red, `24 failed | 3 passed (27)` (measured against stand-ins for Tasks 1 to 4). The errors are `TypeError: spawnArgv is not a function`, `spawnEnv is not a function`, `launchRun is not a function`, `runBatch is not a function`, `allowedToolSpellings is not a function or its return value is not iterable` and `SPAWN_MODES is not iterable`, and the git-tree case shows `makeRunCwd is not a function` in its `toMatchObject` diff. The three that pass are the env scan's CONTROL and the two source scans. Those scans are green before the section exists because Tasks 1 to 4 pass no env whole, spell no bypass flag and use no shell; Step 7's M2 and M3 show them biting.

- [ ] **Step 4: Extend the driver's import block.** Tasks 1 to 3 left one import statement per module: `node:fs`, `node:url`, `../ccd/history/lib.mjs`, `../shared/roster-json.mjs`, and `node:path` as `import path, { join } from 'node:path';` (Task 2's default import with Task 3's `join` merged in). There is no `node:os` or `node:child_process` import yet. Merge into the existing statements any of these names they lack, add a statement only for a module not yet imported, and never add a second statement for a module:
- `node:fs`: `chmodSync`, `closeSync`, `lstatSync`, `mkdirSync`, `mkdtempSync`, `openSync`, `readFileSync`, `readdirSync`, `realpathSync`, `renameSync`, `rmSync`, `writeFileSync`;
- `node:path`: the default import `path`;
- `node:os`: the default import `os`;
- `node:child_process`: `spawn` (the only name from it);
- `../ccd/history/lib.mjs`: `canonicalJson` and `sha256Hex`.

If the `node:path` statement binds named imports only, add the default to that statement, for example `import path, { … } from 'node:path';`.

Check:

```bash
node --check deploy/history-replay.mjs
grep -cE "from 'node:(fs|path|os|child_process)';" deploy/history-replay.mjs
grep -E "from 'node:child_process';" deploy/history-replay.mjs
```

Expected: `node --check` prints nothing. The count is 4: one statement each for `node:fs`, `node:path`, `node:os` and `node:child_process`. The last line is the file's one `node:child_process` import, which this step adds, naming `spawn` and nothing else: no `exec`, no `execSync`, no `execFile`, no `execFileSync`.

- [ ] **Step 5: Write the spawn contract and the batch runner.** In `deploy/history-replay.mjs`, directly above the entry guard (the line that begins `if (process.argv[1] && import.meta.url ===`) and after Task 4's section, insert:

```js
// ── W2-4 Task 5: the spawn contract and the batch runner (W2-D50, W2-D51, W2-D53, W2-D55) ─────────────────────
// The ONE way this driver runs Claude Code (spec §10.2 "Two arms": Launch, Environment, cwd, Flags, Tools; the
// writer and the judge "go through the driver's spawn contract", SE10). Every spawn is `spawn(launcher, argv)`
// with an argv array and no shell, a FRESH env built by spawnEnv from the allow-list (never a copy of the
// driver's own), an empty 0700 cwd made per run outside any git tree and removed after it, and stdin as the only
// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).
// A run's files land under --out in a fixed order: the stream `<name>.jsonl`, then its spend line in the ledger,
// then `<name>.run.json` via tmp + rename. The run.json is the completion marker and comes LAST, so a run killed
// before it is spawned again on resume; if its ledger line had landed, the summed ledger counts both spawns (an
// over-count, the budget's safe direction). A run whose run.json exists is never spawned again (W2-D53, W2-D55).
// The child's LANG arrives as RunJob.lang, threaded from main's env: this section never reads process.env.

/** The four ways a run is spawned: an arm run (with the CCRC_RECALL_* values), the question writer, the judge,
 *  and a box-verb run (an arm's tools, no arm values: step 0a's third spawn and the probe). */
export const SPAWN_MODES = Object.freeze(['arm', 'writer', 'judge', 'box']);
/** `--restricted`, or the fallback the pilot records if `--restricted` drops the skill (W2-D57, spec §10.2 Flags). */
export const SETTINGS_MODES = Object.freeze(['restricted', 'fallback']);
/** The turn bound, `--max-turns 12` (spec §10.2 Flags). */
export const MAX_TURNS = 12;
/** A batch is at most 10 spawns (W2-D55; part 1's `limits.batch_max` default). */
export const BATCH_MAX = 10;
/** At most 2 runs at once (W2-D51; part 1's `limits.concurrency` default). */
export const CONCURRENCY_MAX = 2;
/** The poisoned `gh` lives here under --out, first on every child's PATH (the ghContainedEnv shape). */
export const POISON_BIN_DIR = 'poison-bin';

const RUN_TIMEOUT_MS = 1_800_000;
const KILL_GRACE_MS = 10_000;
const STDERR_KEEP_BYTES = 65_536;
const RUN_KIND = 'ccrc-history-replay-run';
const RUN_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,3}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UNKNOWN_OPTION_RE = /unknown option ['"](-{1,2}[A-Za-z0-9][A-Za-z0-9-]*)['"]/g;
const POISON_GH = '#!/bin/sh\necho "ccrc history-replay: a replay run must never reach gh" >&2\nexit 97\n';
const SETTINGS_ARGV = Object.freeze({
  restricted: Object.freeze(['--restricted']),
  fallback: Object.freeze(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}']),
});

/** The three spellings the arms are taught, exactly (spec §10.2 Tools, SE9): the absolute path, the skill's and
 *  the card's. */
export function allowedToolSpellings(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new TypeError(`allowedToolSpellings: home ${JSON.stringify(home)} is not absolute`);
  return Object.freeze([
    `Bash(${home}/.local/bin/ccrc history:*)`,
    'Bash("$HOME/.local/bin/ccrc" history:*)',
    'Bash(~/.local/bin/ccrc history:*)',
  ]);
}

/** The argv of one spawn: the settings argv, the fixed flags, the model, then the tools by mode. Input is never
 *  an argument: it goes on stdin. Pure.
 *  @param {{mode: string, model: string, settingsMode: string, home: string}} spec
 *  @returns {string[]} */
export function spawnArgv({ mode, model, settingsMode, home }) {
  if (!SPAWN_MODES.includes(mode)) throw new TypeError(`spawnArgv: mode ${JSON.stringify(mode)} is not one of ${SPAWN_MODES.join(', ')}`);
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`spawnArgv: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  if (typeof model !== 'string' || !MODEL_RE.test(model)) throw new TypeError(`spawnArgv: model ${JSON.stringify(model)} is not a model id`);
  const argv = [...SETTINGS_ARGV[settingsMode], '-p', '--no-session-persistence', '--strict-mcp-config',
    '--output-format', 'stream-json', '--verbose', '--max-turns', String(MAX_TURNS), '--model', model];
  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent', '--allowedTools', ...allowedToolSpellings(home));
  else argv.push('--tools', '');
  return argv;
}

/** The child's whole environment, built fresh (the `env -i` equivalent, W2-D50): HOME, the explicit PATH, LANG,
 *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in. Pure.
 *  @param {{mode: string, home: string, configDir: string, poisonBin: string, lang: string | undefined,
 *    recall?: {session: string, arm: string, asof: string}}} spec
 *  @returns {Record<string, string>} */
export function spawnEnv({ mode, home, configDir, poisonBin, lang, recall }) {
  if (!SPAWN_MODES.includes(mode)) throw new TypeError(`spawnEnv: mode ${JSON.stringify(mode)} is not one of ${SPAWN_MODES.join(', ')}`);
  for (const [k, v] of [['home', home], ['configDir', configDir], ['poisonBin', poisonBin]]) {
    if (typeof v !== 'string' || !path.isAbsolute(v) || v.includes(':')) throw new TypeError(`spawnEnv: ${k} ${JSON.stringify(v)} is not an absolute path without ':'`);
  }
  const child = {
    HOME: home,
    PATH: `${poisonBin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: typeof lang === 'string' && lang !== '' ? lang : 'C.UTF-8',
    CLAUDE_CONFIG_DIR: configDir,
  };
  if (mode !== 'arm') {
    if (recall !== undefined) throw new TypeError(`spawnEnv: a ${mode} run carries no CCRC_RECALL_* values`);
    return child;
  }
  const r = recall ?? {};
  for (const k of ['session', 'arm', 'asof']) {
    if (typeof r[k] !== 'string' || r[k] === '') throw new TypeError(`spawnEnv: an arm run needs recall.${k}, a non-empty string`);
  }
  child.CCRC_RECALL_SESSION = r.session;
  child.CCRC_RECALL_ARM = r.arm;
  child.CCRC_RECALL_ASOF = r.asof;
  return child;
}

/** Plant (every call, as ghContainedEnv re-plants) the poisoned gh under --out and answer its directory. */
export function ensurePoisonBin(out) {
  const dir = path.join(out, POISON_BIN_DIR);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const st = lstatSync(dir);
  if (!st.isDirectory()) refuse('out-refused', `${POISON_BIN_DIR} is not a directory`);
  const gh = path.join(dir, 'gh');
  writeFileSync(gh, POISON_GH, { mode: 0o700 });
  chmodSync(gh, 0o700);
  return dir;
}

/** A fresh, empty 0700 directory under os.tmpdir(), outside any git tree: one run's cwd. */
export function makeRunCwd() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccrc-history-replay-')));
  const g = insideGitTree(dir);
  const st = lstatSync(dir);
  const bad = g.state === 'inside' ? `run-cwd-in-git-tree ${g.at}`
    : g.state === 'unmeasured' ? `run-cwd-git-unmeasured ${g.at} ${g.code}`
      : !st.isDirectory() || (st.mode & 0o777) !== 0o700 ? `run-cwd-mode ${(st.mode & 0o777).toString(8)}`
        : readdirSync(dir).length !== 0 ? 'run-cwd-not-empty' : null;
  if (bad !== null) {
    rmSync(dir, { recursive: true, force: true });
    refuse('out-refused', bad);
  }
  return dir;
}

/** HOME for a launch: the directory its config dir sits in. A roster configDirSuffix is one segment (shared/
 *  roster-json.mjs refuses a '/'), so this is exact; the launcher must sit under the same home. */
function runHomeOf(launch) {
  const home = path.dirname(launch.configDir);
  if (!launch.launcher.startsWith(path.join(home, '.local', 'bin') + path.sep)) {
    throw new TypeError(`launchRun: launcher ${launch.launcher} is not under ${home}/.local/bin`);
  }
  return home;
}

function runPaths(out, name) {
  if (typeof name !== 'string' || !RUN_NAME_RE.test(name)) throw new TypeError(`launchRun: run name ${JSON.stringify(name)} is not a run name`);
  return { streamPath: path.join(out, `${name}.jsonl`), runJsonPath: path.join(out, `${name}.run.json`) };
}

/** The outcome of a job whose run.json exists (resume), or null when it has none. A run.json that does not
 *  parse, one recorded for another account, mode, model or settings mode, or a stream whose bytes changed since,
 *  refuses: a resumed batch builds on what was recorded, and only for the job that recorded it. */
function finishedOutcome(job) {
  const { streamPath, runJsonPath } = runPaths(job.out, job.name);
  let text;
  try {
    text = readFileSync(runJsonPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    refuse('out-refused', `run-json-unreadable ${job.name} ${e.code}`);
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    refuse('out-refused', `run-json-invalid ${job.name}`);
  }
  if (rec === null || typeof rec !== 'object' || rec.kind !== RUN_KIND || rec.name !== job.name) refuse('out-refused', `run-json-invalid ${job.name}`);
  // The recorded run must be this job's: another account, mode, model or settings mode on the same --out and name
  // is never reused (a re-run under another --account would otherwise record that account over this run's facts).
  if (rec.account !== job.launch.accountId || rec.mode !== job.mode || rec.model !== job.model || rec.settings_mode !== job.settingsMode) {
    refuse('out-refused', `run-json-mismatch ${job.name}`);
  }
  const stream = readFileSync(streamPath);
  if (sha256Hex(stream) !== rec.stream_sha256) refuse('out-refused', `run-stream-changed ${job.name}`);
  return {
    name: job.name, skipped: true, code: rec.code, signal: rec.signal, ms: rec.ms, cwd: rec.cwd, streamPath,
    facts: readStreamJson(stream.toString('utf8')), tokens: rec.tokens, unknownOptions: rec.unknown_options,
  };
}

/** One child, stdout straight into the stream file, stdin written whole, stderr kept to a bound; killed on its
 *  own pid when it outlives `timeoutMs` (SIGTERM, then SIGKILL after a grace). */
function runChild(launcher, argv, { cwd, childEnv, stdin, streamPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const fd = openSync(streamPath, 'w', 0o600);
    let child;
    try {
      child = spawn(launcher, argv, { cwd, env: childEnv, stdio: ['pipe', fd, 'pipe'] });
    } finally {
      closeSync(fd);
    }
    const errs = [];
    let kept = 0;
    child.stderr.on('data', (b) => {
      if (kept < STDERR_KEEP_BYTES) { errs.push(b.subarray(0, STDERR_KEEP_BYTES - kept)); kept += b.length; }
    });
    child.stdin.on('error', (e) => { if (e.code !== 'EPIPE') reject(e); });
    let killer = null;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); if (killer) clearTimeout(killer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killer) clearTimeout(killer);
      resolve({ code, signal, stderr: Buffer.concat(errs).toString('utf8') });
    });
    child.stdin.end(stdin);
  });
}

/** The option names a run's stderr reports as unknown, in order, once each. Nothing else of stderr is kept. */
function unknownOptionsIn(stderr) {
  const seen = [];
  for (const m of stderr.matchAll(UNKNOWN_OPTION_RE)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Run one job, or answer its recorded outcome when its run.json exists. */
export async function launchRun(job) {
  if (job === null || typeof job !== 'object' || !Object.hasOwn(job, 'lang')) {
    throw new TypeError("launchRun: a RunJob carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const done = finishedOutcome(job);
  if (done !== null) return done;
  const { launch, mode, model, settingsMode, recall, stdin, out, name, lang } = job;
  const timeoutMs = job.timeoutMs ?? RUN_TIMEOUT_MS;
  if (typeof stdin !== 'string') throw new TypeError('launchRun: stdin must be a string');
  const { streamPath, runJsonPath } = runPaths(out, name);
  const home = runHomeOf(launch);
  const argv = spawnArgv({ mode, model, settingsMode, home });
  const childEnv = spawnEnv({ mode, home, configDir: launch.configDir, poisonBin: ensurePoisonBin(out), lang, recall });
  mkdirSync(path.dirname(streamPath), { recursive: true, mode: 0o700 });
  const cwd = makeRunCwd();
  const t0 = Date.now();
  let res;
  try {
    res = await runChild(launch.launcher, argv, { cwd, childEnv, stdin, streamPath, timeoutMs });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const ms = Date.now() - t0;
  const stream = readFileSync(streamPath);
  const facts = readStreamJson(stream.toString('utf8'));
  const tokens = spendTokens(facts);
  const unknownOptions = unknownOptionsIn(res.stderr);
  recordSpend(out, name, tokens);
  const rec = {
    kind: RUN_KIND, v: 1, name, account: launch.accountId, mode, model, settings_mode: settingsMode,
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,
  };
  const tmp = `${runJsonPath}.tmp-${process.pid}`;
  writeFileSync(tmp, canonicalJson(rec) + '\n', { mode: 0o600 });
  renameSync(tmp, runJsonPath);
  return { name, skipped: false, code: res.code, signal: res.signal, ms, cwd, streamPath, facts, tokens, unknownOptions };
}

/** Run up to BATCH_MAX jobs, at most `concurrency` (<= CONCURRENCY_MAX) at once, calling `gate` before each spawn
 *  (Task 6's limits and budget stop). The gate is required: a missing one is a TypeError before any spawn, so the
 *  stop is never opt-in. A finished job is skipped without the gate. The first throw, the gate's
 *  included, stops the batch: no further spawn starts, a run already started finishes and is recorded, and the
 *  throw is rethrown, so a re-run resumes. */
export async function runBatch(jobs, opts = {}) {
  if (typeof opts.gate !== 'function') throw new TypeError('runBatch: opts.gate is required (Task 6\'s batchGate, or a test\'s explicit no-op): no batch spawns ungated');
  if (!Array.isArray(jobs) || jobs.length > BATCH_MAX) throw new TypeError(`runBatch: a batch is at most ${BATCH_MAX} jobs`);
  const concurrency = opts.concurrency ?? CONCURRENCY_MAX;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > CONCURRENCY_MAX) throw new TypeError(`runBatch: concurrency must be 1 to ${CONCURRENCY_MAX}`);
  const names = jobs.map((j) => path.join(j.out, j.name));
  if (new Set(names).size !== names.length) throw new TypeError('runBatch: two jobs share one --out and name');
  const gate = opts.gate;
  const outcomes = new Array(jobs.length);
  let next = 0;
  let stop = null;
  const lane = async () => {
    while (stop === null && next < jobs.length) {
      const i = next++;
      try {
        const done = finishedOutcome(jobs[i]);
        if (done !== null) { outcomes[i] = done; continue; }
        gate();
        outcomes[i] = await launchRun(jobs[i]);
      } catch (e) {
        if (stop === null) stop = { e };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
  if (stop !== null) throw stop.e;
  return outcomes;
}
```

- [ ] **Step 6: Run them and see them pass, then the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 5')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `-t 'W2-4 Task 5'`: `27 passed` (measured against stand-ins for Tasks 1 to 4, about 4.5 s on a loaded box; the concurrency case, with four 1.5 s stubs two at a time, takes about 3.3 s of it). Three runs in a row were green. The case count is unchanged by the coordinator's rulings, but the assertions they changed are predicted: `RunJob.lang` (the job's LANG over a different ambient one, and the missing-key `TypeError`), the resume case's summed ledger (`3 * T5_TOKENS`), and the env scan's projection pin with no exemption.
- The whole file is green: Tasks 1 to 4's cases plus these 27 (predicted).
- `tsc` prints nothing (measured against the stand-ins). The two JSDoc `@param` blocks on `spawnArgv` and `spawnEnv` are what let the TS tests call them with `recall` omitted. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not this task.
- No file named `stub-log.jsonl` exists in the `HOME` of the shell that ran the suite. Check with `ls` only; never print its contents.

- [ ] **Step 7: Measure every new guard red, then green.** From the repository root. Each line applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. M8 leaves its killed-too-late stub sleeping for up to 8 s, and it exits on its own: never kill it by pattern.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
F=deploy/history-replay.mjs
cp "$F" "$SCRATCH/replay.t5.orig"
t5() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t5.orig" "$F"; }

# M1: --strict-mcp-config dropped.
mut "$F" "'-p', '--no-session-persistence', '--strict-mcp-config'," "'-p', '--no-session-persistence',"
t5 'the fixed flags|launched direct|no argv in any mode'
# Expected RED (measured): 6 failed | 1 passed, expected [ '--restricted', '-p', …(14) ] to deeply equal [ '--restricted', '-p', …(15) ].

# M2: the caller's env spread into the child's (HOME still overridden).
mut "$F" "  const child = {" "  const child = { ...process.env,"
t5 'the allow-list exactly|launched direct|own wrapper|passes no env whole'
# Expected RED (measured): 7 failed | 2 passed: the pure env case, the four upstream stub cases and the generated one
# (the caller's keys: expected [ … ] to deeply equal [ 'CLAUDE_CONFIG_DIR', 'HOME', …(2) ]), and the scan
# (expected [ '  const child = { ...process.env,' ] to deeply equal []).

# M3: PATH taken from the caller.
mut "$F" 'PATH: `${poisonBin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,' 'PATH: process.env.PATH,'
t5 'the allow-list exactly|launched direct|own wrapper|passes no env whole'
# Expected RED (measured): 7 failed | 2 passed, expected '/fixture-caller-bin:…' to be '<out>/poison-bin:…', and the
# scan names '    PATH: process.env.PATH,'.

# M4: three at once.
mut "$F" 'export const CONCURRENCY_MAX = 2;' 'export const CONCURRENCY_MAX = 3;'
t5 'never three|above CONCURRENCY_MAX'
# Expected RED (measured): 2 failed, promise resolved "[ … ]" instead of rejecting (concurrency 3 accepted), and expected 3 to be 2.

# M5: the run.json never lands, so resume re-spawns.
mut "$F" '  renameSync(tmp, runJsonPath);' '  void renameSync;'
t5 'resume: a finished job'
# Expected RED (measured): 1 failed, expected [ [ false, 65, 'result' ], …(1) ] to deeply equal [ [ true, 65, 'result' ], …(1) ].

# M6: the run cwd's git-tree check reads every tree as outside.
mut "$F" "g.state === 'inside' ?" "g.state === 'never' ?"
t5 'planted git tree'
# Expected RED (measured): 1 failed, expected null to match object { word: 'out-refused', …(1) }.

# M7: the run cwd is left behind.
mut "$F" "    rmSync(cwd, { recursive: true, force: true });" "    void cwd;"
t5 'launched direct'
# Expected RED (measured): 4 failed, the cwd is removed after the run: expected true to be false.

# M8: no kill on timeout.
mut "$F" "      child.kill('SIGTERM');" "      void 0;"
t5 'outlives its timeout'
# Expected RED (measured): 1 failed, Error: Test timed out in 6000ms.

# M9: resume trusts a stream changed after its run.json.
mut "$F" "  if (sha256Hex(stream) !== rec.stream_sha256) refuse(" "  if (false) refuse("
t5 'resume refuses a stream changed'
# Expected RED (measured): 1 failed, promise resolved "[ { name: 'tamper-0', …(9) } ]" instead of rejecting.

# M10: the gate is never called.
mut "$F" "        gate();" "        void gate;"
t5 'the gate is called before each spawn'
# Expected RED (measured): 1 failed, promise resolved "[ { name: 'gate-0', …(9) }, …(2) ]" instead of rejecting.

# M11: a writer, judge or box run accepts CCRC_RECALL_* values.
mut "$F" "    if (recall !== undefined) throw new TypeError(" "    if (false) throw new TypeError("
t5 'the allow-list exactly'
# Expected RED (measured): 1 failed, expected function to throw an error, but it didn't.

# M12: the writer and the judge get the arm's tools and the allow-list.
mut "$F" "  if (mode === 'arm' || mode === 'box') argv.push(" "  if (true) argv.push("
t5 'with an empty value|launched direct'
# Expected RED (measured): 4 failed | 2 passed, expected [ '--restricted', '-p', …(15) ] to deeply equal [ '--restricted', '-p', …(11) ].

# M13: the gate made optional again (the old `?? (() => {})` default), so a batch with no gate spawns ungated.
mut "$F" "  if (typeof opts.gate !== 'function') throw new TypeError(" "  if (false) throw new TypeError("
mut "$F" "  const gate = opts.gate;" "  const gate = opts.gate ?? (() => {});"
t5 'a batch with no gate'
# Expected RED (predicted): 1 failed, promise resolved "[ … ]" instead of rejecting.

# M14: resume reuses a run recorded for another account, mode, model or settings mode.
mut "$F" "  if (rec.account !== job.launch.accountId ||" "  if (false && rec.account !== job.launch.accountId ||"
t5 'resume refuses a stream changed'
# Expected RED (predicted): 1 failed, variant 0: promise resolved "[ { name: 'tamper-0', …(9) } ]" instead of rejecting.

cmp "$F" "$SCRATCH/replay.t5.orig" && git diff --stat -- deploy/history-replay.mjs
```

Then run Step 6's first command once more: green, `27 passed`.

- [ ] **Step 8: Run the neighbours that read this file.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'O13|O14')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
```

Expected: green.
- `-t 'O13|O14'`: `89 passed`, measured at the base with this section over stand-ins for Tasks 1 to 4. No line of the section names a switch path, `recall-off` or an O14 `VOCABS` name, so neither scan gains a holder.
- `-t 'ccrc history'`: `92 passed`, measured the same way.
- `history-replay.test.ts`: green as a whole (predicted).

- [ ] **Step 9: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 5 — the spawn contract and the batch runner" -m "$CO_AUTHORED_BY"
```

### Task 6: The limits stop and the spend budget

Before each batch and before each spawn, the driver runs one gate (W2-D55). The gate reads one limits row, `$HOME/.cc-limits/<account id>.json`, read-only. This is the only `~/.cc-limits` read in the spec (§5.2, §10.2:2697). The gate also reads the driver's own spend ledger under `--out` (Task 4).

**How the row is read.** lstat runs first, and only a regular file is opened: a symlink, a directory or a FIFO never is. Then one bounded read runs through an `O_NOFOLLOW|O_NONBLOCK` descriptor, and its fstat must still say regular. The row is parsed by `readLimits`' rules (`server/src/limits.ts:394`), term for term:
- a lapsed `resetAt` is a fact, so its 0 counts as a **measured reset**;
- only after that does the age fallback infer a 0 for a value older than its own window.

`readLimits` folds both cases into one `*RolledOver` flag. The driver keeps that flag for parity and also keeps the provenance beside it as `*Inferred`, because here the two cases mean different things: a resetAt 0 may admit a batch, but an age-inferred 0 measured nothing and stops the batch as stale.

**When the gate stops.** It stops with `limits-stale` when the row is absent, not regular, unreadable or malformed, when `five` or `seven` is null or outside 0 to 100, when a 0 was inferred from age, when the row has no `ts`, when its `ts` is more than a minute ahead of the clock, or when it is older than `max_age_ms`. It stops with `limits-threshold` when `max(five, seven) >= threshold_pct`. It stops with `budget-exhausted` when the cumulative ledger is at or over the budget.

A stop throws `DriverRefusal`. Task 1's `main` prints it and exits 2, and a re-run resumes the batch, because Task 5's `runBatch` skips every job whose `run.json` exists. Before part 1 the values are `LIMITS_DEFAULTS`; W2-5a and W2-5b pass part 1's or part 2's values through the same `limits` and `budget` parameters. The spec sentence "stops at a stated threshold" is widened by erratum E18, which is additive and carries no D-number; W2-1 amends the spec text. This task never touches the spec.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) The import block. The file's one `from 'node:fs'` import must name `closeSync`, `constants`, `fstatSync`, `lstatSync`, `openSync` and `readSync`; add only the ones Tasks 1–5 did not import. The file's one `node:path` statement must bind the default `path` (after Task 3 it reads `import path, { join } from 'node:path';`); add the default to that statement if it is absent, and never add a second `node:path` statement.
  - (b) One section, inserted directly above the entry-guard block that Task 1 keeps last (`if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`) and after Task 5's section. `LIMITS_DEFAULTS` reads Task 5's `BATCH_MAX` and `CONCURRENCY_MAX`, so it must come after their declarations.
- Modify: `server/test/history-replay.test.ts`.
  - (a) Nine import lines appended to the file's import block. Every binding they add is spelled `t6…` or `T6_…`, so none of them can collide with a named import that Tasks 1–5 put in the block.
  - (b) Three describes appended at the end of the file.
- Not edited: `server/src/limits.ts`, `server/test/fixtures/rollover.ts`, `server/test/limits.test.ts` and `server/test/ccd-limits.test.ts`. The parity case reads `readLimits` and `rolloverCases` as they are.

**Interfaces:**
- Consumes (Task 1): `DriverRefusal` (exported, with `word` and `detail`), `refuse(word, detail): never`, and `DRIVER_REASONS`, which holds `limits-threshold`, `limits-stale` and `budget-exhausted`. Test side: `mkTmp`, imported from `./tmpHelpers.js` by Task 1.
- Consumes (Task 2): `prepareOut(out, uid = process.getuid()): string`. Tests only.
- Consumes (Task 3): `readRoster(home): {json, roster}` and `admitAccount(json, roster, id, home): LaunchSpec`. Test side: `writeRoster(home, accounts: object[])`. Tests only.
- Consumes (Task 4):
  - `spentSoFar(out: string): number`. It returns 0 when the ledger is absent and throws `DriverRefusal('budget-exhausted', 'ledger-unreadable')` on an unreadable or malformed ledger.
  - `recordSpend(out, name, tokens)`, used by tests only.
  - `spendTokens`, which is input + cache_creation + cache_read + output from the result event's `usage`.
- Consumes (Task 5):
  - `BATCH_MAX = 10` and `CONCURRENCY_MAX = 2`.
  - `RunJob`, whose `lang` key is required (the tests pass `lang: undefined`).
  - `runBatch(jobs, {concurrency, gate})`, whose `gate` is required (a missing one is a `TypeError`). It calls `gate()` before each spawn of a job whose `run.json` is absent, and never for a skipped job. A throw from `gate` rejects the batch with that error once in-flight runs settle, and nothing more is spawned.
  - Test side: `plantStub(home, id)`, `stubLog(home): object[] | null`, and the stub's canned stream at `$HOME/stub-stream.jsonl`.
- Consumes (base, tests only):
  - `readLimits(io, cfg, now)` from `server/src/limits.ts:394`;
  - `loadConfig` from `server/src/config.ts:399`, which needs `$HOME/.ccrc/accounts.json`;
  - `localIO` from `server/src/io.ts:220`;
  - `rolloverCases(now)` from `server/test/fixtures/rollover.ts`;
  - `DEFAULT_TEST_ROSTER` from `server/test/helpers/roster.ts`, a leaf module that imports nothing from `server/src`.
- Produces (`deploy/history-replay.mjs`):
  - `LIMITS_DEFAULTS = Object.freeze({threshold_pct: 70, max_age_ms: 3_600_000, batch_max: BATCH_MAX, concurrency: CONCURRENCY_MAX})`. The last two fields are Task 5's constants, never a second literal.
  - `parseLimitsRow(text: string, nowS: number): LimitsRow`. It throws `SyntaxError` on non-JSON, and `TypeError('a limits row is one JSON object')` on null, an array or a scalar.
  - `LimitsRow = {five: number|null, seven: number|null, ts: number|null, fiveResetAt: number|null, sevenResetAt: number|null, fiveRolledOver: boolean, sevenRolledOver: boolean, fiveInferred: boolean, sevenInferred: boolean}`.
  - `readLimitsRow(home: string, accountId: string, nowS: number): {state:'row', row: LimitsRow} | {state:'absent'} | {state:'not-regular'} | {state:'unreadable', code: string} | {state:'malformed'}`. It throws `TypeError` for an id that is not one path segment. A file over 64 KiB, the module-private `LIMITS_ROW_CAP`, answers `malformed`.
  - `decideLimits(read, {nowMs: number, thresholdPct: number, maxAgeMs: number}): null | {word: 'limits-stale'|'limits-threshold', detail: string}`.
    - The `limits-stale` details, in check order, are: `absent`, `not-regular`, `unreadable <code>`, `malformed`, `five-null`, `seven-null`, `percent-out-of-range`, `inferred-by-age`, `ts-null`, `ts-future <ahead_ms>`, `old <age_ms>`.
    - The `limits-threshold` detail is `five <f> seven <s> at or over <t>`.
  - `decideBudget(spent: number, budget: number): null | {word: 'budget-exhausted', detail: 'spent <spent> of <budget>'}`. It throws `TypeError` on a budget that is not a positive safe integer, or a spend that is not a non-negative one.
  - `batchGate({out, home, accountId, budget, limits, now = Date.now}): () => void`.
    - When it is built, it throws `TypeError` on a malformed budget, a `limits.threshold_pct` outside (0, 100], or a `limits.max_age_ms` that is not a positive safe integer.
    - Each call checks the budget first and then the limits row, and throws `DriverRefusal` on a stop.
  - Module-private: `LIMITS_FIVE_WINDOW_S` (18000) and `LIMITS_SEVEN_WINDOW_S` (604800), which are `readLimits`' `FIVE_WINDOW` and `SEVEN_WINDOW` and are held equal to it by the parity case, not by an import, because a `.mjs` operator script cannot import `server/src/*.ts`; also `LIMITS_ROW_CAP`, `LIMITS_FUTURE_SKEW_MS`, `LIMITS_ID` and `limitsNum`.
- Produces (test file): the module-level namespace bindings `t6Driver`, `t6Fs`, `t6Path`, `t6ExecFile`, `t6ReadLimits`, `t6LoadConfig`, `t6LocalIO`, `t6RolloverCases` and `T6_ROSTER`.

**Spec and decisions:** W2-D55 covers every stop condition, the limits defaults, the budget before part 1 as a required parameter, a stop that exits non-zero and is resumable, and the parity test against `readLimits` on shared fixtures. The spec references are §10.2:2697 (erratum E18, additive, amended by W2-1), §5.2 (the one `~/.cc-limits` read) and open record part 1's `limits` field (§4 of the decisions). This task defines no D-number.

**Choices this task makes:**
- **Provenance is kept beside the fold, never in place of it.** `fiveRolledOver` and `sevenRolledOver` equal `readLimits`' values over the same bytes; that is the parity. `fiveInferred` and `sevenInferred` are true only when the age path wrote the 0. So the resetAt fact still wins over the inference: `readLimits`' `!fiveRolledOver` guards, which are invisible in its values, are visible here (M5).
- **A row with no `ts` stops as `limits-stale ts-null`.** W2-D55 says a row "older than `max_age_ms`" stops, and a row with no `ts` cannot be shown to be younger. The detail is one this task adds to the brief's list.
- **A row from the future or out of range measured nothing.** A `ts` more than `LIMITS_FUTURE_SKEW_MS` (60 s) ahead of the clock stops as `limits-stale ts-future <ahead_ms>`: its negative age would otherwise read as fresh for good. A `five` or `seven` outside 0 to 100 stops as `limits-stale percent-out-of-range`: a negative value would otherwise pass the threshold. Both read W2-D55's "malformed" strictly and fail closed; `parseLimitsRow` is unchanged, so the parity with `readLimits` (which admits both) is untouched, and the two checks live in `decideLimits` alone (M9, M10).
- **`unreadable` carries its errno** (`unreadable EACCES`), so the adapter does not narrow the distinction it received. The word is still `limits-stale`.
- **`five: null` stops even when the row says `fiveWindowMinutes: 0`.** Only `upstream` accounts and `generated` accounts with `provider: anthropic` are admitted (W2-D52), and no Anthropic row carries that field. W2-D55 says "either `five` or `seven` is null" without exception.
- **Budget first, then limits.** Both stop the batch with exit 2. The budget is checked first because it reads only `--out`, which Task 2 already proved is the caller's own.
- **The threshold, the budget and the age compare exactly as W2-D55 states them:**
  - `>=` for the threshold: 70 stops at a threshold of 70;
  - `>=` for the budget: a ledger at the budget stops;
  - `>` for age: a row exactly `max_age_ms` old passes.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
grep -cE '^export class DriverRefusal ' deploy/history-replay.mjs
grep -cE '^export function refuse\(' deploy/history-replay.mjs
grep -cE '^export function spentSoFar\(' deploy/history-replay.mjs
grep -cE '^export function recordSpend\(' deploy/history-replay.mjs
grep -cE '^export const BATCH_MAX = 10;' deploy/history-replay.mjs
grep -cE '^export const CONCURRENCY_MAX = 2;' deploy/history-replay.mjs
grep -cE '^export (async )?function runBatch\(' deploy/history-replay.mjs
grep -cE '^export function (prepareOut|readRoster|admitAccount)\(' deploy/history-replay.mjs
grep -cE "^import \{([^}]*,)?\s*mkTmp\s*(,[^}]*)?\} from './tmpHelpers.js';" server/test/history-replay.test.ts
grep -cE '^(export )?(async )?(function|const) (writeRoster|plantStub|stubLog)\b' server/test/history-replay.test.ts
grep -cE '^(export )?const (LIMITS_DEFAULTS|LIMITS_FIVE_WINDOW_S|LIMITS_SEVEN_WINDOW_S|LIMITS_ROW_CAP)\b' deploy/history-replay.mjs
```

Expected:
- 1 for each of the first seven counts;
- 3 for the eighth (`prepareOut`, `readRoster`, `admitAccount`);
- 1 for the `mkTmp` import: Task 1's unaliased `{ mkTmp }`. The pattern skips the aliased `{ mkTmp as t2MkTmp }`, `{ mkTmp as t4MkTmp }` and `{ mkTmp as t5MkTmp }` lines of Tasks 2, 4 and 5, which bind other names;
- 3 for the three test helpers;
- 0 for the last count, because this task declares those names.

Then read `runBatch` and check its contract:
- it throws a `TypeError` when `opts.gate` is not a function, before any spawn;
- it calls `opts.gate()` before each spawn of a job whose `<out>/<name>.run.json` is absent;
- it never calls `opts.gate()` for a skipped job;
- a throw from `gate` rejects the returned promise with that same error once in-flight runs settle, and spawns nothing more.

A different shape is a gap in Task 5. Stop and report it; never patch `runBatch` from this task.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, append these lines to the import block. They are module-level declarations, so they belong with the file's other imports:

```ts
// W2-4 Task 6 (W2-D55): t6-prefixed bindings, so none collides with a named import Tasks 1–5 put in this block.
import * as t6Driver from '../../deploy/history-replay.mjs';
import * as t6Fs from 'node:fs';
import t6Path from 'node:path';
import { execFileSync as t6ExecFile } from 'node:child_process';
import { readLimits as t6ReadLimits } from '../src/limits.js';
import { loadConfig as t6LoadConfig } from '../src/config.js';
import { localIO as t6LocalIO } from '../src/io.js';
import { rolloverCases as t6RolloverCases } from './fixtures/rollover.js';
import { DEFAULT_TEST_ROSTER as T6_ROSTER } from './helpers/roster.js';
```

Then append at the end of the file:

```ts

// ── W2-4 Task 6: the limits stop and the spend budget (W2-D55; spec §10.2:2697, erratum E18) ─────────────────────
// The driver reads one limits row, read-only, by readLimits' rules, and keeps the provenance readLimits folds: a 0 from
// a lapsed resetAt is a measured reset, a 0 inferred from age measured nothing and stops as stale. The parity case holds
// the driver's reading to readLimits' over rolloverCases' bytes, the fixture limits.test.ts and ccd-limits.test.ts share.
// Fixture HOMEs only; the clock is a parameter.
describe('W2-4 Task 6: the limits row is read by readLimits\' rules, keeping its provenance (W2-D55 parity)', () => {
  const NOW_S = 1_785_231_736;
  const PICK = (r: { five: number | null; seven: number | null; ts: number | null; fiveResetAt: number | null; sevenResetAt: number | null; fiveRolledOver: boolean; sevenRolledOver: boolean }) =>
    ({ five: r.five, seven: r.seven, ts: r.ts, fiveResetAt: r.fiveResetAt, sevenResetAt: r.sevenResetAt, fiveRolledOver: r.fiveRolledOver, sevenRolledOver: r.sevenRolledOver });

  it('over every rolloverCases row, parseLimitsRow and readLimitsRow answer exactly what readLimits answers over the same bytes', async () => {
    const home = mkTmp('ccrc-replay-t6-parity-');
    t6Fs.mkdirSync(t6Path.join(home, '.ccrc'), { recursive: true });
    t6Fs.writeFileSync(t6Path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(T6_ROSTER));
    const dir = t6Path.join(home, '.cc-limits');
    t6Fs.mkdirSync(dir, { recursive: true });
    const cases = t6RolloverCases(NOW_S);
    for (const c of cases) t6Fs.writeFileSync(t6Path.join(dir, c.file), c.content);
    const theirs = await t6ReadLimits(t6LocalIO, t6LoadConfig({ CCRC_HOME: home }), NOW_S);
    expect(cases.length, 'CONTROL: the shared fixture is not empty').toBeGreaterThan(10);
    for (const c of cases) {
      const id = c.file.slice(0, -'.json'.length);
      const want = PICK(theirs[id]!);
      expect(PICK(t6Driver.parseLimitsRow(c.content, NOW_S)), `${c.file}: ${c.why}`).toEqual(want);
      expect(want, `${c.file}: the fixture's own expectation`).toMatchObject(c.expect);
      const read = t6Driver.readLimitsRow(home, id, NOW_S);
      expect(read.state, c.file).toBe('row');
      if (read.state === 'row') expect(PICK(read.row!), c.file).toEqual(want);
    }
  });

  it('only the age path sets *Inferred: a lapsed resetAt is a measured reset, an age-inferred 0 is not', () => {
    const inferred: Record<string, { fiveInferred: boolean; sevenInferred: boolean }> = {
      'no-reset-fields-old.json': { fiveInferred: true, sevenInferred: false },
    };
    for (const c of t6RolloverCases(NOW_S)) {
      const r = t6Driver.parseLimitsRow(c.content, NOW_S);
      expect({ fiveInferred: r.fiveInferred, sevenInferred: r.sevenInferred }, c.file)
        .toEqual(inferred[c.file] ?? { fiveInferred: false, sevenInferred: false });
    }
    const both = t6Driver.parseLimitsRow(JSON.stringify({ five: 5, seven: 50, ts: NOW_S - 700_000 }), NOW_S);
    expect(both).toMatchObject({ five: 0, seven: 0, fiveRolledOver: true, sevenRolledOver: true, fiveInferred: true, sevenInferred: true });
  });

  it('parseLimitsRow throws on text that is not JSON, and on JSON that is not one object', () => {
    expect(() => t6Driver.parseLimitsRow('not json', NOW_S)).toThrow(SyntaxError);
    for (const text of ['null', '[1, 2]', '42', '"row"']) {
      expect(() => t6Driver.parseLimitsRow(text, NOW_S), text).toThrow('a limits row is one JSON object');
    }
  });
});

describe('W2-4 Task 6: the gate stops on every limits and budget condition (W2-D55)', () => {
  const NOW_S = 1_800_000_000;
  const NOW_MS = NOW_S * 1000;
  type Stop = { word: string; detail: string } | null;
  function t6Box(prefix: string): { home: string; out: string; row: string } {
    const base = mkTmp(prefix);
    const home = t6Path.join(base, 'home');
    t6Fs.mkdirSync(t6Path.join(home, '.cc-limits'), { recursive: true });
    const out = t6Path.join(base, 'out');
    t6Fs.mkdirSync(out, { mode: 0o700 });
    return { home, out, row: t6Path.join(home, '.cc-limits', 'up-a.json') };
  }
  const fresh = (five: number | null, seven: number | null, o: Record<string, number> = {}) => JSON.stringify(
    { five, seven, ts: NOW_S - 60, fiveResetAt: NOW_S + 3600, sevenResetAt: NOW_S + 86_400, ...o });
  function stopOf(b: { home: string; out: string }, o: { budget?: number; threshold?: number; maxAge?: number } = {}): Stop {
    const gate = t6Driver.batchGate({
      out: b.out, home: b.home, accountId: 'up-a', budget: o.budget ?? 1_000_000,
      limits: { threshold_pct: o.threshold ?? t6Driver.LIMITS_DEFAULTS.threshold_pct, max_age_ms: o.maxAge ?? t6Driver.LIMITS_DEFAULTS.max_age_ms },
      now: () => NOW_MS,
    });
    try { gate(); return null; } catch (e) {
      expect(e).toBeInstanceOf(t6Driver.DriverRefusal);
      return { word: (e as InstanceType<typeof t6Driver.DriverRefusal>).word, detail: (e as InstanceType<typeof t6Driver.DriverRefusal>).detail };
    }
  }

  it('LIMITS_DEFAULTS is frozen and exactly the open record\'s defaults, its batch fields Task 5\'s constants', () => {
    expect(Object.isFrozen(t6Driver.LIMITS_DEFAULTS)).toBe(true);
    expect(t6Driver.LIMITS_DEFAULTS).toEqual({ threshold_pct: 70, max_age_ms: 3_600_000, batch_max: 10, concurrency: 2 });
    expect(t6Driver.LIMITS_DEFAULTS.batch_max).toBe(t6Driver.BATCH_MAX);
    expect(t6Driver.LIMITS_DEFAULTS.concurrency).toBe(t6Driver.CONCURRENCY_MAX);
  });

  it('CONTROL: a fresh row under the threshold with an empty ledger admits the batch', () => {
    const b = t6Box('ccrc-replay-t6-pass-');
    t6Fs.writeFileSync(b.row, fresh(42, 61));
    expect(stopOf(b)).toBeNull();
  });

  it('absent: limits-stale absent', () => {
    expect(stopOf(t6Box('ccrc-replay-t6-absent-'))).toEqual({ word: 'limits-stale', detail: 'absent' });
  });

  it('a directory, a symlink to a fresh row and a FIFO: limits-stale not-regular, and the FIFO is never opened', () => {
    const b = t6Box('ccrc-replay-t6-notreg-');
    t6Fs.mkdirSync(b.row);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    t6Fs.rmdirSync(b.row);
    const real = t6Path.join(b.home, 'elsewhere.json');
    t6Fs.writeFileSync(real, fresh(1, 1));
    t6Fs.symlinkSync(real, b.row);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    t6Fs.unlinkSync(b.row);
    t6ExecFile('mkfifo', [b.row]);
    const t0 = Date.now();
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    expect(Date.now() - t0, 'a FIFO opened for read would block').toBeLessThan(5000);
  });

  it('unreadable (mode 000): limits-stale unreadable EACCES', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const b = t6Box('ccrc-replay-t6-unread-');
    t6Fs.writeFileSync(b.row, fresh(1, 1));
    t6Fs.chmodSync(b.row, 0o000);
    try { expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'unreadable EACCES' }); }
    finally { t6Fs.chmodSync(b.row, 0o600); }
  });

  it.each([
    ['not json', 'not json'],
    ['a JSON array', '[1, 2]'],
    ['past the 64 KiB read bound', fresh(1, 1).replace('{', `{${' '.repeat(65_536)}`)],
  ])('malformed (%s): limits-stale malformed', (_label, text) => {
    const b = t6Box('ccrc-replay-t6-malformed-');
    t6Fs.writeFileSync(b.row, text);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'malformed' });
  });

  it('five null, seven null, a percent outside 0 to 100, a row with no ts and a ts ahead of the clock: each limits-stale with its own detail', () => {
    const b = t6Box('ccrc-replay-t6-null-');
    t6Fs.writeFileSync(b.row, fresh(null, 10));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'five-null' });
    t6Fs.writeFileSync(b.row, fresh(10, null));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'seven-null' });
    t6Fs.writeFileSync(b.row, fresh(101, 10));
    expect(stopOf(b), 'over 100 is not a percent').toEqual({ word: 'limits-stale', detail: 'percent-out-of-range' });
    t6Fs.writeFileSync(b.row, fresh(10, -1));
    expect(stopOf(b), 'a negative value never passes the threshold').toEqual({ word: 'limits-stale', detail: 'percent-out-of-range' });
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 10, seven: 10 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'ts-null' });
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 60 }));
    expect(stopOf(b), 'a minute ahead is clock skew: admitted').toBeNull();
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 3600 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'ts-future 3600000' });
  });

  it('an age-inferred 0 stops as stale even when max_age_ms is raised past its age, so the inference is what stops', () => {
    const b = t6Box('ccrc-replay-t6-inferred-');
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000 }));
    expect(stopOf(b, { maxAge: 30_000_000 })).toEqual({ word: 'limits-stale', detail: 'inferred-by-age' });
  });

  it('a resetAt-fact 0 beside a fresh seven is a measured reset: admitted', () => {
    const b = t6Box('ccrc-replay-t6-fact-');
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 87, seven: 40, ts: NOW_S - 600, fiveResetAt: NOW_S - 60, sevenResetAt: NOW_S + 200_000 }));
    expect(stopOf(b)).toBeNull();
  });

  it('older than max_age_ms: limits-stale old <age_ms>; exactly max_age_ms old still passes', () => {
    const b = t6Box('ccrc-replay-t6-old-');
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S - 3600 }));
    expect(stopOf(b)).toBeNull();
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S - 3601 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'old 3601000' });
  });

  it('the threshold is inclusive: max(five, seven) 69 passes, 70 stops on either window', () => {
    const b = t6Box('ccrc-replay-t6-threshold-');
    t6Fs.writeFileSync(b.row, fresh(69, 12));
    expect(stopOf(b)).toBeNull();
    t6Fs.writeFileSync(b.row, fresh(70, 12));
    expect(stopOf(b)).toEqual({ word: 'limits-threshold', detail: 'five 70 seven 12 at or over 70' });
    t6Fs.writeFileSync(b.row, fresh(12, 70));
    expect(stopOf(b)).toEqual({ word: 'limits-threshold', detail: 'five 12 seven 70 at or over 70' });
  });

  it('the budget is inclusive: a ledger at budget-1 passes, at budget stops with budget-exhausted', () => {
    const b = t6Box('ccrc-replay-t6-budget-');
    t6Fs.writeFileSync(b.row, fresh(10, 10));
    t6Driver.recordSpend(b.out, 'run-a', 999);
    expect(stopOf(b, { budget: 1000 })).toBeNull();
    t6Driver.recordSpend(b.out, 'run-b', 1);
    expect(stopOf(b, { budget: 1000 })).toEqual({ word: 'budget-exhausted', detail: 'spent 1000 of 1000' });
  });

  it('batchGate refuses a malformed budget or limits at construction, before any read', () => {
    const b = t6Box('ccrc-replay-t6-shape-');
    const mk = (budget: number, limits: { threshold_pct: number; max_age_ms: number }) => () =>
      t6Driver.batchGate({ out: b.out, home: b.home, accountId: 'up-a', budget, limits });
    expect(mk(0, { threshold_pct: 70, max_age_ms: 1 })).toThrow('a budget is a positive integer');
    expect(mk(1.5, { threshold_pct: 70, max_age_ms: 1 })).toThrow('a budget is a positive integer');
    expect(mk(10, { threshold_pct: 0, max_age_ms: 1 })).toThrow('limits.threshold_pct');
    expect(mk(10, { threshold_pct: 101, max_age_ms: 1 })).toThrow('limits.threshold_pct');
    expect(mk(10, { threshold_pct: 70, max_age_ms: 0 })).toThrow('limits.max_age_ms');
    expect(mk(10, { threshold_pct: 70, max_age_ms: 1 })).not.toThrow();
  });
});

describe('W2-4 Task 6: a stop is resumable (W2-D55: a stopped batch spawns nothing more, and a re-run resumes)', () => {
  const NOW_S = 1_800_000_000;
  const LIMITS = { threshold_pct: 70, max_age_ms: 3_600_000 };
  /** One upstream account on the stub (Task 5's plantStub), with a canned stream whose result usage is 150 tokens. */
  const T6_UP_A = { id: 'up-a', label: 'up-a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' };
  const T6_STREAM = [
    { type: 'system', subtype: 'init', session_id: 'sess-t6', model: 'model-w', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok',
      usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const rowAt = (tsS: number): string => JSON.stringify({ five: 10, seven: 20, ts: tsS, fiveResetAt: tsS + 7200, sevenResetAt: tsS + 86_400 });
  function t6Rig(prefix: string) {
    const base = mkTmp(prefix);
    const home = t6Path.join(base, 'home');
    t6Fs.mkdirSync(t6Path.join(home, '.claude'), { recursive: true });
    t6Fs.mkdirSync(t6Path.join(home, '.cc-limits'), { recursive: true });
    writeRoster(home, [T6_UP_A]);
    plantStub(home, 'up-a');
    t6Fs.writeFileSync(t6Path.join(home, 'stub-stream.jsonl'), T6_STREAM);
    const { json, roster } = t6Driver.readRoster(home);
    const launch = t6Driver.admitAccount(json, roster, 'up-a', home);
    const out = t6Driver.prepareOut(t6Path.join(base, 'out'));
    const jobs = ['t6-j1', 't6-j2', 't6-j3'].map((name) =>
      ({ launch, mode: 'writer', model: 'model-w', settingsMode: 'restricted', stdin: 'q', out, name, lang: undefined }));
    return { home, out, jobs, row: t6Path.join(home, '.cc-limits', 'up-a.json') };
  }

  it('a limits stop mid-batch spawns nothing more; refreshed, the re-run spawns only the unfinished jobs and counts spend once', async () => {
    const r = t6Rig('ccrc-replay-t6-resume-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    const late = (NOW_S + 3601) * 1000;
    let calls = 0;
    // The batch's gate and the first spawn's gate see a fresh row; the clock then passes max_age_ms, so the second stops.
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 1_000_000, limits: LIMITS,
      now: () => (++calls <= 2 ? NOW_S * 1000 : late) });
    gate();
    await expect(t6Driver.runBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'limits-stale', detail: 'old 3601000' });
    expect(stubLog(r.home)?.length, 'the first job spawned and nothing after the stop').toBe(1);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j1.run.json'))).toBe(true);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j2.run.json'))).toBe(false);
    // The operator refreshes the row (one interactive statusline render on the account); the same batch runs again.
    t6Fs.writeFileSync(r.row, rowAt(NOW_S + 3601));
    const again = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 1_000_000, limits: LIMITS, now: () => late });
    again();
    const outcomes = await t6Driver.runBatch(r.jobs, { concurrency: 1, gate: again });
    expect(outcomes.map((o) => [o.name, o.skipped]).sort()).toEqual([['t6-j1', true], ['t6-j2', false], ['t6-j3', false]]);
    expect(stubLog(r.home)?.length, 'the finished job is never re-spawned').toBe(3);
    expect(t6Driver.spentSoFar(r.out), 'three spawns of 150 tokens, each counted once: the finished job was never re-spawned').toBe(450);
  }, 60_000);

  it('a budget the first spawn exhausts stops the batch before the second spawn', async () => {
    const r = t6Rig('ccrc-replay-t6-spend-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 150, limits: LIMITS, now: () => NOW_S * 1000 });
    gate();
    await expect(t6Driver.runBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted', detail: 'spent 150 of 150' });
    expect(stubLog(r.home)?.length, 'one spawn, then the stop').toBe(1);
  }, 60_000);
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 6')
```

Expected: red, `20 failed`. 18 of these were measured against a stand-in for Tasks 1, 4 and 5's names at `7d01973a2`; the two resumable cases are predicted. The failures are:
- the eleven gate cases: `TypeError: Cannot read properties of undefined (reading 'threshold_pct')`;
- the two parity cases: `parseLimitsRow is not a function`;
- the throw case: `expected error to be instance of SyntaxError`;
- the defaults case: `expected undefined to deeply equal { threshold_pct: 70, …(3) }`;
- the shape case: `expected [Function] to not throw an error but 'TypeError: __vite_ssr_import_…__.batchGate is not a function' was thrown`;
- the two resumable cases, predicted: `t6Driver.batchGate is not a function`.

Every earlier task's cases in the file stay green.

- [ ] **Step 4: Write the limits stop and the budget.** In `deploy/history-replay.mjs`, first complete the import block as **Files** (a) says. Check from the repository root that both of these print 1:
- `grep -cE "^import \{[^}]*\blstatSync\b[^}]*\} from 'node:fs';" deploy/history-replay.mjs`
- `grep -cE "^import path(, \{[^}]*\})? from 'node:path';" deploy/history-replay.mjs`

Then insert this section directly above the entry-guard block:

```js
// ── W2-4 Task 6: the limits stop and the spend budget (W2-D55; spec §10.2 "stops at a stated threshold", erratum E18) ──
// Before each batch and before each spawn the driver reads ONE limits row, `$HOME/.cc-limits/<account id>.json`,
// read-only: the one `~/.cc-limits` read in the spec (§5.2). lstat first, so a symlink, a directory or a FIFO is never
// opened; then one bounded read through an O_NOFOLLOW|O_NONBLOCK descriptor whose fstat must still say regular. The row
// is parsed by readLimits' rules (server/src/limits.ts), term for term: a lapsed resetAt is a FACT and writes 0; only
// then does the age fallback infer a 0 for a value older than its own window. readLimits folds both into one
// `*RolledOver` flag; the driver keeps the provenance beside it (`*Inferred`), because here the two answer differently:
// a resetAt 0 is a measured reset and may admit a batch, an age-inferred 0 measured nothing and stops it as stale.
// A parity case in history-replay.test.ts holds parseLimitsRow to readLimits over rolloverCases' bytes, so the two
// spellings of these rules cannot drift (a .mjs operator script cannot import server/src/*.ts). The budget is the
// cumulative spend ledger under --out (Task 4); a stop throws DriverRefusal (exit 2), and a re-run resumes, since
// runBatch skips every finished job (Task 5). Before part 1 the values are LIMITS_DEFAULTS and a required --budget;
// W2-5a and W2-5b pass part 1's or part 2's values through the same parameters.

/** The limits values in force before part 1 (W2-D55; part 1's `limits` records them). W2-5a and W2-5b pass part 1's
 *  values through batchGate's `limits` parameter. batch_max and concurrency are Task 5's constants, never a second
 *  literal. */
export const LIMITS_DEFAULTS = Object.freeze({
  threshold_pct: 70, max_age_ms: 3_600_000, batch_max: BATCH_MAX, concurrency: CONCURRENCY_MAX,
});

const LIMITS_FIVE_WINDOW_S = 18000;     // readLimits' FIVE_WINDOW: a five sample older than its own 5h window has rolled over
const LIMITS_SEVEN_WINDOW_S = 604800;   // readLimits' SEVEN_WINDOW, the same for seven
const LIMITS_ROW_CAP = 65536;           // a limits row is about 150 bytes; a file past 64 KiB is not one, and is malformed
const LIMITS_FUTURE_SKEW_MS = 60_000;   // a ts at most a minute ahead of the clock is skew; further ahead measured nothing
const LIMITS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;   // one path segment, never `..`-led or hidden
const limitsNum = (v) => (typeof v === 'number' ? v : null);   // readLimits' numOrNull

/** One limits row's text, by readLimits' rules, keeping the provenance it folds. Throws on non-JSON or a non-object. */
export function parseLimitsRow(text, nowS) {
  const raw = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('a limits row is one JSON object');
  const ts = limitsNum(raw.ts);
  const fiveResetAt = limitsNum(raw.fiveResetAt);
  const sevenResetAt = limitsNum(raw.sevenResetAt);
  let five = limitsNum(raw.five);
  let seven = limitsNum(raw.seven);
  // The FACT first: a lapsed resetAt comes straight from the API, so its 0 is a measured reset.
  let fiveRolledOver = five !== null && fiveResetAt !== null && nowS >= fiveResetAt;
  let sevenRolledOver = seven !== null && sevenResetAt !== null && nowS >= sevenResetAt;
  if (fiveRolledOver) five = 0;
  if (sevenRolledOver) seven = 0;
  // Then the INFERENCE, which may not re-derive what the fact already said (readLimits' `!fiveRolledOver` guards).
  // readLimits sets only *RolledOver here; the driver also says the 0 was inferred, because that 0 measured nothing.
  let fiveInferred = false;
  let sevenInferred = false;
  if (ts !== null) {
    if (!fiveRolledOver && five !== null && nowS - ts > LIMITS_FIVE_WINDOW_S) { five = 0; fiveRolledOver = true; fiveInferred = true; }
    if (!sevenRolledOver && seven !== null && nowS - ts > LIMITS_SEVEN_WINDOW_S) { seven = 0; sevenRolledOver = true; sevenInferred = true; }
  }
  return { five, seven, ts, fiveResetAt, sevenResetAt, fiveRolledOver, sevenRolledOver, fiveInferred, sevenInferred };
}

/** `$HOME/.cc-limits/<accountId>.json`, read-only: lstat first (only a regular file is opened), then one bounded read
 *  through an O_NOFOLLOW|O_NONBLOCK descriptor whose fstat must still say regular. Every outcome is its own state. */
export function readLimitsRow(home, accountId, nowS) {
  if (typeof accountId !== 'string' || !LIMITS_ID.test(accountId)) throw new TypeError(`not an account id: ${JSON.stringify(accountId)}`);
  const p = path.join(home, '.cc-limits', `${accountId}.json`);
  const codeOf = (e) => String(e?.code ?? 'EUNKNOWN');
  let st;
  try { st = lstatSync(p); } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', code: codeOf(e) };
  }
  if (!st.isFile()) return { state: 'not-regular' };
  let fd;
  try { fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (e) {
    if (e?.code === 'ENOENT') return { state: 'absent' };
    if (e?.code === 'ELOOP') return { state: 'not-regular' };
    return { state: 'unreadable', code: codeOf(e) };
  }
  let text;
  try {
    if (!fstatSync(fd).isFile()) return { state: 'not-regular' };   // replaced between the lstat and the open
    const buf = Buffer.alloc(LIMITS_ROW_CAP + 1);
    let n = 0;
    while (n < buf.length) {
      const got = readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
    }
    if (n > LIMITS_ROW_CAP) return { state: 'malformed' };
    text = buf.toString('utf8', 0, n);
  } catch (e) {
    return { state: 'unreadable', code: codeOf(e) };
  } finally {
    closeSync(fd);
  }
  try { return { state: 'row', row: parseLimitsRow(text, nowS) }; } catch { return { state: 'malformed' }; }
}

/** The limits stop (W2-D55): null admits the batch; otherwise the word and detail it stops with. */
export function decideLimits(read, { nowMs, thresholdPct, maxAgeMs }) {
  const stale = (detail) => ({ word: 'limits-stale', detail });
  switch (read.state) {
    case 'absent': return stale('absent');
    case 'not-regular': return stale('not-regular');
    case 'unreadable': return stale(`unreadable ${read.code}`);
    case 'malformed': return stale('malformed');
    case 'row': break;
    default: throw new TypeError(`not a limits read: ${JSON.stringify(read.state)}`);
  }
  const r = read.row;
  if (r.five === null) return stale('five-null');
  if (r.seven === null) return stale('seven-null');
  if (!(r.five >= 0 && r.five <= 100) || !(r.seven >= 0 && r.seven <= 100)) return stale('percent-out-of-range');
  if (r.fiveInferred || r.sevenInferred) return stale('inferred-by-age');
  if (r.ts === null) return stale('ts-null');
  const aheadMs = r.ts * 1000 - nowMs;
  if (aheadMs > LIMITS_FUTURE_SKEW_MS) return stale(`ts-future ${aheadMs}`);
  const ageMs = nowMs - r.ts * 1000;
  if (ageMs > maxAgeMs) return stale(`old ${ageMs}`);
  if (Math.max(r.five, r.seven) >= thresholdPct) {
    return { word: 'limits-threshold', detail: `five ${r.five} seven ${r.seven} at or over ${thresholdPct}` };
  }
  return null;
}

/** The spend budget (W2-D55): the cumulative ledger at or over the budget stops. */
export function decideBudget(spent, budget) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new TypeError(`a budget is a positive integer: ${String(budget)}`);
  if (!Number.isSafeInteger(spent) || spent < 0) throw new TypeError(`a spend is a non-negative integer: ${String(spent)}`);
  return spent >= budget ? { word: 'budget-exhausted', detail: `spent ${spent} of ${budget}` } : null;
}

/** The gate called before each batch and before each spawn: the budget first, then the limits row. Throws DriverRefusal. */
export function batchGate({ out, home, accountId, budget, limits, now = Date.now }) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new TypeError(`a budget is a positive integer: ${String(budget)}`);
  const thresholdPct = limits?.threshold_pct;
  const maxAgeMs = limits?.max_age_ms;
  if (typeof thresholdPct !== 'number' || !(thresholdPct > 0 && thresholdPct <= 100)) throw new TypeError(`limits.threshold_pct is in (0, 100]: ${String(thresholdPct)}`);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new TypeError(`limits.max_age_ms is a positive integer: ${String(maxAgeMs)}`);
  return () => {
    const spent = decideBudget(spentSoFar(out), budget);
    if (spent !== null) refuse(spent.word, spent.detail);
    const nowMs = now();
    const stop = decideLimits(readLimitsRow(home, accountId, Math.floor(nowMs / 1000)), { nowMs, thresholdPct, maxAgeMs });
    if (stop !== null) refuse(stop.word, stop.detail);
  };
}
```

The section reads no environment variable, so Task 5's scan (the entry guard's by-name projection is the driver's only `process.env` line) stays green. It spawns nothing and runs no shell. It does not spell `node:sqlite`, `recall-off` or any history switch name, so Task 1's W2-D51 scan and O13 stay green. None of its names is one of O14's `VOCABS`.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 6')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The filtered run is green, `20 passed`. The 18 cases in the first two describes were measured green against the stand-in. The two resumable cases are predicted, and each spawns the stub one to three times, in well under a second. On a root runner the mode-000 case is skipped (`19 passed | 1 skipped`).
- The whole file is green: every earlier task's cases plus these 20.
- tsc prints nothing; this was measured over the two describes against the stand-in. The `read.row!` assertion is needed: allowJs infers `readLimitsRow`'s union with `row` optional. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/w2-4-t6.XXXXXX")"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
D=deploy/history-replay.mjs
cp "$D" "$SCRATCH/driver.orig"

# M1: admit an age-inferred 0 (the inference read as a measurement).
mut "$D" "  if (r.fiveInferred || r.sevenInferred) return stale('inferred-by-age');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an age-inferred 0 stops as stale')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'limits-stale', …(1) }.

# M2: '>' for the threshold.
mut "$D" "if (Math.max(r.five, r.seven) >= thresholdPct)" "if (Math.max(r.five, r.seven) > thresholdPct)"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'the threshold is inclusive')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (measured): 1 failed, expected null to deeply equal { word: 'limits-threshold', …(1) }.

# M3: '>' for the budget.
mut "$D" "return spent >= budget ?" "return spent > budget ?"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'the budget is inclusive|a budget the first spawn exhausts')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED: measured 1 failed on 'the budget is inclusive' (expected null to deeply equal { word: 'budget-exhausted', …(1) });
# the resumable budget case is predicted red too (the batch runs all three jobs, so the promise resolves).

# M4: ignore the ts age.
mut "$D" "  if (ageMs > maxAgeMs) return stale(\`old \${ageMs}\`);
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'older than max_age_ms|a limits stop mid-batch')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED: measured 1 failed on 'older than max_age_ms' (expected null to deeply equal { word: 'limits-stale', …(1) });
# the mid-batch case is predicted red (no stop, so the promise resolves and the stub runs three times).

# M5: the fact no longer wins over the inference (readLimits' `!fiveRolledOver` guard dropped; invisible in its values).
mut "$D" "if (!fiveRolledOver && five !== null && nowS - ts > LIMITS_FIVE_WINDOW_S)" "if (five !== null && nowS - ts > LIMITS_FIVE_WINDOW_S)"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'only the age path sets')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (measured): rolled-seven.json: expected { fiveInferred: true, …(1) } to deeply equal { fiveInferred: false, …(1) }.

# M6: the type checks dropped, so a directory or a FIFO is opened and read.
mut "$D" "    if (!fstatSync(fd).isFile()) return { state: 'not-regular' };   // replaced between the lstat and the open
" ""
mut "$D" "  if (!st.isFile()) return { state: 'not-regular' };" "  if (false) return { state: 'not-regular' };"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'a directory, a symlink to a fresh row')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (measured): 1 failed, the directory answers limits-stale 'unreadable EISDIR', not 'not-regular'.

# M7: the resetAt fact dropped from the parse (parity with readLimits broken).
mut "$D" "  let fiveRolledOver = five !== null && fiveResetAt !== null && nowS >= fiveResetAt;" "  let fiveRolledOver = false;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'over every rolloverCases row')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (measured): rolled-five-only.json: 5h reset, 7d still running: expected { five: 87, seven: 40, …(5) } to deeply equal { five: +0, seven: 40, …(5) }.

# M8: the gate never reads the ledger.
mut "$D" "    const spent = decideBudget(spentSoFar(out), budget);" "    const spent = decideBudget(0, budget);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'the budget is inclusive|a budget the first spawn exhausts')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED: measured 1 failed on 'the budget is inclusive'; the resumable budget case is predicted red.

# M9: a ts ahead of the clock reads as fresh (its negative age never exceeds max_age_ms).
mut "$D" "  if (aheadMs > LIMITS_FUTURE_SKEW_MS) return" "  if (false) return"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'five null, seven null')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (predicted): 1 failed, expected null to deeply equal { word: 'limits-stale', …(1) }.

# M10: a percent outside 0 to 100 is admitted (a negative one passes the threshold).
mut "$D" "  if (!(r.five >= 0 && r.five <= 100) || !(r.seven >= 0 && r.seven <= 100)) return" "  if (false) return"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'five null, seven null')
cp "$SCRATCH/driver.orig" "$D"
# Expected RED (predicted): 1 failed, over 100 is not a percent: expected { word: 'limits-threshold', …(1) } to deeply equal { word: 'limits-stale', …(1) }.

cmp "$D" "$SCRATCH/driver.orig" && rm -rf "$SCRATCH"
git diff --stat -- deploy/history-replay.mjs   # only this task's section and import names (and earlier tasks', if not yet committed)
```

Then run Step 5's commands again: green.

- [ ] **Step 7: Run the neighbours that read the same rules or the same files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/limits.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
```

Expected: green.
- `limits.test.ts` is unchanged. It is the other half of the parity: its `reads every rollover case exactly` asserts the same fixture rows against `readLimits` that this task's parity case asserts against the driver.
- `single-definition -t 'ccrc history'` is green. O13's `ALL_MJS` and O14's `DECL_CORPUS` scans already read `deploy/*.mjs`, and this section declares no `VOCABS` name and spells no switch.
- `history-replay.test.ts` is green as a whole.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 6 — the limits stop and the spend budget" -m "$CO_AUTHORED_BY"
```

---

### Task 7: Preflights, codeShas, the release stamp and the recall-off presence check

These are the mechanisms that W2-5a and W2-5b wire into their own subcommands. This task gives the driver what it needs to measure "has anything moved since step 0a (or part 1)". It wires none of these functions into a subcommand: each consumer PR wires its own (W2-D24), and step 0a (Task 8) records `codeShas()` and the release stamp without comparing them. What it adds:
- **`codeShas()`** (W2-D24): the sha256 of the installed bytes of the four `gate_code` files, read relative to `TREE_ROOT`. A file that is absent (`deploy/history-gate.mjs` until W2-3 lands) or cannot be read answers `unmeasured` with its path and cause. It never throws and never hashes nothing.
- **`readReleaseStamp`**: the `version` tag of `$HOME/.ccrc/build.json`, keeping `absent`, `unreadable`, `malformed` and `untagged` apart.
- **`wrapperSha`**: the sha256 of a generated account's wrapper bytes, or null for upstream. A wrapper that cannot be read refuses `wrapper-unmeasured` (coordinator ruling, 2026-10-19) and never answers upstream's null; `wrapper-moved` names a measured mismatch only.
- **`measureClaudeVersion`**: runs `<launcher> --version` under `launchRun`'s rules: writer-mode env, the poisoned `PATH`, and a fresh empty 0700 cwd that is removed afterwards. It spends nothing.
- **`preflight`**: W2-D56's four words in a fixed order, `claude-version-moved`, `tree-moved` (W2-D6's mechanism), `wrapper-moved`, then `code-changed`, each a MEASURED mismatch. An input that cannot be measured refuses with its own word at its place (coordinator ruling): `version-unmeasured` at the first, `tree-unmeasured` at the second, `wrapper-unmeasured` at the third (refused by `wrapperSha`, before `preflight` is reached), `code-unmeasured` at the fourth. `allowCodeChange` turns the `code-changed` word, a MEASURED change and only that, into a stamp; it never stamps `code-unmeasured`.
- **`loadStep0a`** (W2-D56, W2-D59): refuses a path inside a git tree. It checks the file's sha256 **before** parsing (`input-sha-mismatch`), then its shape (`input-invalid`).
- **`recallOffPresence` / `refuseRecallOff`** (W2-D78(ii), W2-D29): `lstatSync(recallOffPath(home, id))` on one line, whatever the entry's type or content. `ENOENT` alone means absent; any other `lstat` error is unmeasured; present and unmeasured both refuse `family-recall-off`. An id that fails lib's `idOk` (so `recallOffPath` throws its `TypeError`) refuses `input-invalid` (coordinator ruling).

**Files:**
- Modify: `deploy/history-replay.mjs`. Add one section directly above the entry guard (the file's last block, Task 1), after Task 6's section. Add any import Step 1 finds missing to that module's EXISTING import statement, never as a second import of the same module.
- Modify: `server/test/history-replay.test.ts`. Append one describe at the end of the file, with its own import block (the `t7` prefix, so no name collides with an earlier task's imports).
- Not edited: `server/test/single-definition.test.ts`. O13's recall-off case (`:5214`) and the O14 describe are re-run, never edited. W2-1 re-pins O13 with the needles `recallOffPath`/`recallOffDir` and adds the CONTROL that this task's `lstatSync` line is not a write (W2-D29).

**Interfaces:**
- Consumes (base, `ccd/history/lib.mjs`): `recallOffPath(home, id)` (`:3933`), which runs `idOk` first and throws a plain `TypeError` (no `code`) for an id that fails it, and `sha256Hex` (`:527`).
- Consumes (Task 1): `DriverRefusal`, `refuse(word, detail)`, and the words `claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed`, `version-unmeasured`, `tree-unmeasured`, `code-unmeasured`, `wrapper-unmeasured`, `input-sha-mismatch`, `input-invalid`, `args-invalid`, `family-recall-off`.
- Consumes (Task 2): `insideGitTree(p)`, which answers `{state:'outside'} | {state:'inside', at} | {state:'unmeasured', at, code}` and walks up from a directory.
- Consumes (Task 3): the `LaunchSpec` shape `{accountId, kind:'upstream'|'generated', launcher, configDir, wrapperPath, secretsPath}`.
- Consumes (Task 4): `SPEND_LEDGER`, which the test reads to show `--version` records no spend.
- Consumes (Task 5): `spawnEnv`, `ensurePoisonBin`, `makeRunCwd`, `SETTINGS_MODES`, and the module-private `runHomeOf(launch)`, the HOME `launchRun` gives a child (the config dir's parent, checked against the launcher). `measureClaudeVersion` uses the same function so that its child's HOME can never differ from a run's.
- Produces (`deploy/history-replay.mjs`):
  - `CODE_SHA_FILES = Object.freeze(['deploy/history-gate.mjs','deploy/measure-history.py','deploy/history-replay.mjs','ccd/history/lib.mjs'])`;
  - `TREE_ROOT: string`, equal to `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`;
  - `STEP0A_KIND = 'ccrc-history-w2-step0a'` and `STEP0A_FIELDS` (frozen: `kind, v, measured_ms, account, settings_mode, claude_code_version, wrapper_sha256, flags_accepted, writer_init, judge_init, box_init, code_shas, release_stamp, budget, spend`). `loadStep0a` is the first reader of this shape, so it is declared here; Task 8 writes it and must not declare either name again;
  - `codeShas(root = TREE_ROOT): {state:'measured', files: Record<string,string>} | {state:'unmeasured', path: string, cause:'absent'|'unreadable'}`;
  - `readReleaseStamp(home): {state:'value', tag} | {state:'absent'} | {state:'unreadable', code} | {state:'malformed'} | {state:'untagged'}`;
  - `wrapperSha(launch): string | null`, which throws `DriverRefusal('wrapper-unmeasured', '<path>: <code>')` on a read failure;
  - `measureClaudeVersion(launch, out, lang): Promise<{state:'value', version} | {state:'failed', code: number|null, signal: string|null}>`, where `lang: string | undefined` is the caller's `LANG` from `main`'s `env` (Task 8 passes `env.LANG`), exactly as `RunJob.lang` is;
  - `preflight(expected, measured, opts?): {ok:true, stamps: string[]} | {ok:false, word, detail}` (`word` one of `version-unmeasured`, `claude-version-moved`, `tree-unmeasured`, `tree-moved`, `wrapper-moved`, `code-unmeasured`, `code-changed`, in that order of checking), where `expected` is `{claude_code_version, release_stamp, wrapper_sha256, code_shas}` and `measured` is `{version, stamp, wrapperSha256, codeShas}`, each being what the matching measuring function above answers;
  - `loadStep0a(path, sha256): Step0aOutput`;
  - `recallOffPresence(home, ids): {present: string[], unmeasured: Array<{id, code}>}`, which throws `DriverRefusal('input-invalid', 'family id <json> is not a session id')` for an id lib's `idOk` refuses;
  - `refuseRecallOff(home, ids): void`.
  - Module-private: `SHA256_RE`, `VERSION_TIMEOUT_MS` (60 s, then SIGKILL on the child's own pid), `VERSION_STDOUT_MAX`, `plainObject`, `step0aShapeError`.

**Spec:** §10.2 "Pre-registration" (`:2723`, amended by erratum E23 in W2-5b, not here) and "Account and budget" (`:2686`). W2 decisions document: W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59. This task defines no D-number.

**Choices this task makes:**
- **An unmeasured input is its own word's refusal (coordinator ruling, 2026-10-19).** A `moved` word names a measured mismatch and nothing else. A failed `--version` is `version-unmeasured`, its detail `--version failed (code <c>, signal <s>)` (`preflight` gets no launcher path, so the detail does not name one; Task 8's does). An absent, unreadable, malformed or untagged stamp is `tree-unmeasured`, its detail `the release stamp is <state>` (with ` (<code>)` for `unreadable`). An absent or unreadable code file is `code-unmeasured` (a word of its own, so `--allow-code-change` can never stamp it), its detail `<path> is <cause>`. A generated account's wrapper that cannot be read is `wrapper-unmeasured`, refused by `wrapperSha` before `preflight` is reached, its detail `<path>: <code>`. The word says "unmeasured", so no detail repeats it. An untagged stamp never passes: W2-D6's freeze rests on the stamp naming a tag, and a stamp with no tag measured none.
- **`allowCodeChange` covers only a measured change (coordinator ruling).** It stamps the `code-changed` word and no other: an unmeasured code file (absent or unreadable) still refuses `code-unmeasured` with the flag set, and so does a moved or unmeasured version or stamp, and a moved wrapper.
- **`wrapperSha` refuses rather than answering null on a read failure,** because null is upstream's answer (no overloaded null). It refuses `wrapper-unmeasured` (coordinator ruling, 2026-10-19), never `wrapper-moved`: a read failure measured nothing to compare, and `wrapper-moved` names a measured mismatch only.
- **`readReleaseStamp` reads only the label.** `shared/buildinfo.ts` is the one validator of a stamp's other fields; a `.mjs` under `deploy/` cannot import that `.ts` file, and copying its sha check would trip `single-definition.test.ts`'s `CHECKS_THE_SHA`. Untagged means the `version` field is absent: both stampers omit it for an untagged build (`deploy/deploy.sh` `stamp_build`). The path is built with `path.join(home, '.ccrc', 'build.json')`, never written out as a literal.
- **`loadStep0a` checks the file's directory for a git tree** (Task 2's `insideGitTree` walks directories) before reading a byte. A `--step0a-sha256` that is not 64 lowercase hex is `args-invalid`, because it is an argument error and not a mismatch.
- **`measureClaudeVersion` takes HOME from the LaunchSpec through Task 5's `runHomeOf`**, never from `process.env.HOME`. In a test, a live HOME would point the stub at the live home. It reads no environment at all: `LANG` arrives as its third parameter, threaded from `main`'s `env` exactly as `RunJob.lang` is (coordinator ruling; Task 5's scan pins the entry guard's projection as the driver's only `process.env` line).
- **`recallOffPresence` maps `recallOffPath`'s TypeError to `input-invalid` (coordinator ruling).** An id that fails `idOk` is never read as absent and never as unmeasured, and it is a refusal (exit 2), not a defect (exit 1). lib's TypeError carries no `code`, so the catch tells it from an `lstat` error (which always carries a string `code`; an `ERR_INVALID_ARG_TYPE` from `lstatSync` carries one too and stays unmeasured). The detail never spells the directory, so the structural pin (one `recallOffPath(` code line) and O13 stay as they are.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(['spawnEnv','ensurePoisonBin','makeRunCwd','insideGitTree','refuse','DriverRefusal','SETTINGS_MODES','SPEND_LEDGER'].map((n) => n + ':' + typeof d[n]).join(' '))"
grep -c '^function runHomeOf(launch) {' deploy/history-replay.mjs
grep -c 'recallOffPath(' deploy/history-replay.mjs
grep -n "from 'node:url'\|from 'node:child_process'\|from '../ccd/history/lib.mjs'" deploy/history-replay.mjs
```

Expected:
- the first line prints `spawnEnv:function ensurePoisonBin:function makeRunCwd:function insideGitTree:function refuse:function DriverRefusal:function SETTINGS_MODES:object SPEND_LEDGER:string`. Importing the module acts on nothing, because the entry guard holds `main`;
- `runHomeOf` counts 1, and `recallOffPath(` counts 0: no line calls it yet. The header's lib import names it without a parenthesis.

Then read the file's import block. It must already bring in `readFileSync`, `lstatSync` and `rmSync` from `node:fs`, `fileURLToPath` from `node:url`, `spawn` from `node:child_process`, and `sha256Hex` and `recallOffPath` from `../ccd/history/lib.mjs`. Add any missing name to that module's existing import statement. A missing exported name, or a `runHomeOf` count of 0, is a gap in Tasks 1–5: stop and report it. Never define one of those names here.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`:

```ts

// ── W2-4 Task 7: preflights, codeShas, the release stamp and the recall-off presence check ──────────────────────
// (W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59). Function level, every HOME and tree a mkTmp fixture. The only
// child spawned is a fixture `--version` stub under the fixture HOME, through the driver's own env and cwd rules.
import * as t7fs from 'node:fs';
import * as t7path from 'node:path';
import { fileURLToPath as t7FileURLToPath } from 'node:url';
import { describe as t7describe, expect as t7expect, it as t7it } from 'vitest';
import * as t7drv from '../../deploy/history-replay.mjs';
import { sha256Hex as t7Sha, canonicalJson as t7Canon } from '../../ccd/history/lib.mjs';
import { mkTmp as t7MkTmp } from './tmpHelpers.js';

t7describe('W2-4 Task 7: preflights, codeShas, the release stamp and recall-off presence', () => {
  const REPO = t7path.resolve(t7path.dirname(t7FileURLToPath(import.meta.url)), '..', '..');
  const ROOT_SKIP = typeof process.getuid === 'function' && process.getuid() === 0;
  const H = (s: string): string => t7Sha(s);   // a well-formed sha256 for a fixture value
  /** A fixture tree holding the four gate_code files, each with its own bytes. */
  const plantTree = (): string => {
    const root = t7MkTmp('t7-tree-');
    for (const rel of t7drv.CODE_SHA_FILES) {
      t7fs.mkdirSync(t7path.join(root, t7path.dirname(rel)), { recursive: true });
      t7fs.writeFileSync(t7path.join(root, rel), `fixture bytes of ${rel}\n`);
    }
    return root;
  };
  const shasOf = (root: string): Record<string, string> =>
    Object.fromEntries(t7drv.CODE_SHA_FILES.map((rel: string) => [rel, t7Sha(t7fs.readFileSync(t7path.join(root, rel)))]));
  /** What a later subcommand compares against: step 0a's recorded values. */
  const EXPECTED = (): { claude_code_version: string; release_stamp: string; wrapper_sha256: string | null; code_shas: Record<string, string> } => ({
    claude_code_version: '9.9.9 (Claude Code)', release_stamp: 'v0.0.900', wrapper_sha256: H('wrapper'),
    code_shas: Object.fromEntries(t7drv.CODE_SHA_FILES.map((f: string) => [f, H(f)])),
  });
  /** The same values measured now, unmoved; `o` moves one. */
  const MEASURED = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: { state: 'value', version: '9.9.9 (Claude Code)' }, stamp: { state: 'value', tag: 'v0.0.900' },
    wrapperSha256: H('wrapper'), codeShas: { state: 'measured', files: { ...EXPECTED().code_shas } }, ...o,
  });
  /** The word and detail a DriverRefusal carries, or the throw itself when it is not one. */
  const refusalOf = (fn: () => unknown): { word: string; detail: string } => {
    try {
      fn();
    } catch (e) {
      if (e instanceof t7drv.DriverRefusal) return { word: (e as { word: string }).word, detail: (e as { detail: string }).detail };
      throw e;
    }
    throw new Error('expected a DriverRefusal, and nothing was thrown');
  };

  t7describe('codeShas over the four gate_code files, W2-D24', () => {
    t7it('CODE_SHA_FILES is exactly the four files gate_code pins, frozen, and TREE_ROOT is the tree the driver runs from', () => {
      t7expect([...t7drv.CODE_SHA_FILES]).toEqual(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
      t7expect(Object.isFrozen(t7drv.CODE_SHA_FILES)).toBe(true);
      t7expect(t7drv.TREE_ROOT).toBe(REPO);
    });

    t7it('over a fixture root, each entry is that file\'s sha256 and there are exactly four', () => {
      const root = plantTree();
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'measured', files: shasOf(root) });
    });

    t7it.each(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs'])(
      'one changed byte in %s changes exactly that entry', (rel) => {
        const root = plantTree();
        const before = (t7drv.codeShas(root) as { files: Record<string, string> }).files;
        const p = t7path.join(root, rel);
        const b = t7fs.readFileSync(p);
        b[0] = b[0]! ^ 1;
        t7fs.writeFileSync(p, b);
        const after = (t7drv.codeShas(root) as { files: Record<string, string> }).files;
        t7expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual([rel]);
      });

    t7it('an absent file answers unmeasured absent, never a hash of nothing; an empty file is bytes and is hashed', () => {
      const root = plantTree();
      t7fs.rmSync(t7path.join(root, 'deploy/history-gate.mjs'));
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' });
      const root2 = plantTree();
      t7fs.writeFileSync(t7path.join(root2, 'ccd/history/lib.mjs'), '');
      t7expect((t7drv.codeShas(root2) as { files: Record<string, string> }).files['ccd/history/lib.mjs']).toBe(t7Sha(''));
    });

    t7it('a directory where a file belongs answers unmeasured unreadable', () => {
      const root = plantTree();
      t7fs.rmSync(t7path.join(root, 'deploy/measure-history.py'));
      t7fs.mkdirSync(t7path.join(root, 'deploy/measure-history.py'));
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/measure-history.py', cause: 'unreadable' });
    });

    t7it.skipIf(ROOT_SKIP)('a mode-000 file answers unmeasured unreadable', () => {
      const root = plantTree();
      t7fs.chmodSync(t7path.join(root, 'deploy/history-replay.mjs'), 0o000);
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/history-replay.mjs', cause: 'unreadable' });
    });

    t7it('over the real tree, before or after W2-3 lands: measured when history-gate.mjs exists, else unmeasured absent', () => {
      const r = t7drv.codeShas();
      if (t7fs.existsSync(t7path.join(REPO, 'deploy/history-gate.mjs'))) t7expect(r).toEqual({ state: 'measured', files: shasOf(REPO) });
      else t7expect(r).toEqual({ state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' });
    });
  });

  t7describe('readReleaseStamp keeps absent, unreadable, malformed and untagged apart', () => {
    const stampHome = (text: string | null): string => {
      const home = t7MkTmp('t7-stamp-');
      t7fs.mkdirSync(t7path.join(home, '.ccrc'), { mode: 0o700 });
      if (text !== null) t7fs.writeFileSync(t7path.join(home, '.ccrc', 'build.json'), text);
      return home;
    };
    const STAMP = { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-19T00:00:00Z', dirty: false };

    t7it('a tagged stamp is its version', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(JSON.stringify({ ...STAMP, version: 'v0.0.900' })))).toEqual({ state: 'value', tag: 'v0.0.900' });
    });
    t7it('no build.json is absent', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(null))).toEqual({ state: 'absent' });
    });
    t7it('a stamp with no version field is untagged', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(JSON.stringify(STAMP)))).toEqual({ state: 'untagged' });
    });
    t7it('not JSON, an array, or a version that is not a non-empty string is malformed', () => {
      for (const text of ['{"sha":', '[]', JSON.stringify({ ...STAMP, version: 7 }), JSON.stringify({ ...STAMP, version: '' })]) {
        t7expect(t7drv.readReleaseStamp(stampHome(text)), text).toEqual({ state: 'malformed' });
      }
    });
    t7it('a directory at build.json is unreadable, with its code', () => {
      const home = stampHome(null);
      t7fs.mkdirSync(t7path.join(home, '.ccrc', 'build.json'));
      t7expect(t7drv.readReleaseStamp(home)).toEqual({ state: 'unreadable', code: 'EISDIR' });
    });
  });

  t7describe('wrapperSha and measureClaudeVersion', () => {
    /** A fixture home with one launcher at .local/bin/<id>, a node script that prints `out` and exits `rc`, logging
     *  its argv, env key names, cwd and the cwd's entries to $HOME/version-stub.json. */
    const versionHome = (id: string, out: string, rc = 0): { home: string; launcher: string } => {
      const home = t7MkTmp('t7-ver-');
      t7fs.mkdirSync(t7path.join(home, '.local', 'bin'), { recursive: true });
      t7fs.mkdirSync(t7path.join(home, '.claude'), { mode: 0o700 });
      const launcher = t7path.join(home, '.local', 'bin', id);
      t7fs.writeFileSync(launcher, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `fs.writeFileSync(path.join(process.env.HOME, 'version-stub.json'), JSON.stringify({ argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), cwd: process.cwd(), entries: fs.readdirSync(process.cwd()) }));`,
        `process.stdout.write(${JSON.stringify(out)});`,
        `process.exit(${rc});`,
        '',
      ].join('\n'), { mode: 0o700 });
      return { home, launcher };
    };
    const upstreamLaunch = (home: string, launcher: string) => ({
      accountId: 'up-a', kind: 'upstream', launcher, configDir: t7path.join(home, '.claude'), wrapperPath: null, secretsPath: null,
    });
    const outDir = (): string => { const d = t7MkTmp('t7-out-'); t7fs.chmodSync(d, 0o700); return d; };

    t7it('wrapperSha: a generated account\'s wrapper bytes hashed; null for upstream', () => {
      const home = t7MkTmp('t7-wrap-');
      const w = t7path.join(home, 'gen-a');
      t7fs.writeFileSync(w, '#!/bin/sh\n# fixture wrapper\n');
      t7expect(t7drv.wrapperSha({ accountId: 'gen-a', kind: 'generated', launcher: w, configDir: t7path.join(home, '.claude-gen-a'), wrapperPath: w, secretsPath: t7path.join(home, 's') }))
        .toBe(t7Sha('#!/bin/sh\n# fixture wrapper\n'));
      t7expect(t7drv.wrapperSha({ accountId: 'up-a', kind: 'upstream', launcher: w, configDir: t7path.join(home, '.claude'), wrapperPath: null, secretsPath: null })).toBeNull();
    });

    t7it('wrapperSha: an unreadable wrapper refuses wrapper-unmeasured, never wrapper-moved and never null (coordinator ruling)', () => {
      const home = t7MkTmp('t7-wrap-');
      const w = t7path.join(home, 'gen-a');
      const r = refusalOf(() => t7drv.wrapperSha({ accountId: 'gen-a', kind: 'generated', launcher: w, configDir: t7path.join(home, '.claude-gen-a'), wrapperPath: w, secretsPath: t7path.join(home, 's') }));
      t7expect(r.word).toBe('wrapper-unmeasured');
      t7expect(r.detail).toBe(`${w}: ENOENT`);
    });

    t7it('measureClaudeVersion: the first stdout line, trimmed, from --version alone, under the writer env and a fresh cwd, spending nothing', async () => {
      const { home, launcher } = versionHome('up-a', '  9.9.9 (Claude Code)  \nsecond line\n');
      const out = outDir();
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(home, launcher), out, 'fixture.UTF-8')).toEqual({ state: 'value', version: '9.9.9 (Claude Code)' });
      const log = JSON.parse(t7fs.readFileSync(t7path.join(home, 'version-stub.json'), 'utf8'));
      t7expect(log.argv).toEqual(['--version']);
      t7expect(log.envKeys).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
      t7expect(log.entries).toEqual([]);
      t7expect(log.cwd.startsWith(out)).toBe(false);
      t7expect(t7fs.existsSync(log.cwd), 'the run cwd is removed afterwards').toBe(false);
      t7expect(t7fs.existsSync(t7path.join(out, t7drv.SPEND_LEDGER)), '--version records no spend').toBe(false);
    });

    t7it('measureClaudeVersion: a non-zero exit, or an empty first line, is failed with its code', async () => {
      const a = versionHome('up-a', '9.9.9 (Claude Code)\n', 3);
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(a.home, a.launcher), outDir(), undefined)).toEqual({ state: 'failed', code: 3, signal: null });
      const b = versionHome('up-a', '\n9.9.9\n', 0);
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(b.home, b.launcher), outDir(), undefined)).toEqual({ state: 'failed', code: 0, signal: null });
    });
  });

  t7describe('preflight, W2-D56: four words in a fixed order', () => {
    t7it('nothing moved: ok with no stamps', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED())).toEqual({ ok: true, stamps: [] });
    });
    t7it('a moved version is claude-version-moved', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ version: { state: 'value', version: '9.9.10 (Claude Code)' } })))
        .toEqual({ ok: false, word: 'claude-version-moved', detail: 'recorded 9.9.9 (Claude Code), measured 9.9.10 (Claude Code)' });
    });
    t7it('a failed --version is version-unmeasured, never claude-version-moved (coordinator ruling)', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ version: { state: 'failed', code: 3, signal: null } })))
        .toEqual({ ok: false, word: 'version-unmeasured', detail: '--version failed (code 3, signal null)' });
    });
    t7it('a moved release stamp is tree-moved', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ stamp: { state: 'value', tag: 'v0.0.901' } })))
        .toEqual({ ok: false, word: 'tree-moved', detail: 'recorded v0.0.900, measured v0.0.901' });
    });
    t7it.each([[{ state: 'absent' }], [{ state: 'untagged' }], [{ state: 'malformed' }], [{ state: 'unreadable', code: 'EACCES' }]])(
      'a release stamp read as %j is tree-unmeasured, never tree-moved and never a pass (coordinator ruling)', (stamp) => {
        t7expect(t7drv.preflight(EXPECTED(), MEASURED({ stamp })))
          .toEqual({ ok: false, word: 'tree-unmeasured', detail: `the release stamp is ${stamp.state}${stamp.state === 'unreadable' ? ' (EACCES)' : ''}` });
      });
    t7it('each unmeasured input refuses its own word at its place: version-unmeasured, then tree-unmeasured, then code-unmeasured', () => {
      const all = MEASURED({
        version: { state: 'failed', code: 3, signal: null }, stamp: { state: 'absent' },
        codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' },
      });
      const wordOf = (m: Record<string, unknown>): string => (t7drv.preflight(EXPECTED(), m) as { word: string }).word;
      const back = MEASURED();
      t7expect([
        wordOf(all),
        wordOf({ ...all, version: back.version }),
        wordOf({ ...all, version: back.version, stamp: back.stamp }),
      ]).toEqual(['version-unmeasured', 'tree-unmeasured', 'code-unmeasured']);
    });
    t7it('a moved wrapper is wrapper-moved, and so is a wrapper where none was recorded', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ wrapperSha256: H('other wrapper') }))).toMatchObject({ ok: false, word: 'wrapper-moved' });
      t7expect(t7drv.preflight({ ...EXPECTED(), wrapper_sha256: null }, MEASURED())).toMatchObject({ ok: false, word: 'wrapper-moved' });
      t7expect(t7drv.preflight({ ...EXPECTED(), wrapper_sha256: null }, MEASURED({ wrapperSha256: null }))).toEqual({ ok: true, stamps: [] });
    });
    t7it('one changed code sha is code-changed, naming that file', () => {
      const files = { ...EXPECTED().code_shas, 'ccd/history/lib.mjs': H('one byte moved') };
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'measured', files } })))
        .toEqual({ ok: false, word: 'code-changed', detail: 'changed ccd/history/lib.mjs' });
    });
    t7it('an unmeasured code file is code-unmeasured, never code-changed (coordinator ruling)', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' } })))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/history-gate.mjs is absent' });
    });
    t7it('the order is fixed: with all four moved, each word shows only once those before it are put back', () => {
      const all = MEASURED({
        version: { state: 'value', version: 'moved' }, stamp: { state: 'value', tag: 'moved' }, wrapperSha256: H('moved'),
        codeShas: { state: 'measured', files: { ...EXPECTED().code_shas, 'deploy/history-replay.mjs': H('moved') } },
      });
      const words: string[] = [];
      const m = { ...all };
      for (const [k, back] of Object.entries(MEASURED())) {
        words.push((t7drv.preflight(EXPECTED(), m) as { word: string }).word);
        m[k] = back;
      }
      t7expect(words).toEqual(['claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed']);
    });
    t7it('allowCodeChange stamps code-changed and nothing else: an unmeasured code file still refuses code-unmeasured, a moved or unmeasured stamp still refuses', () => {
      const files = { ...EXPECTED().code_shas, 'deploy/history-gate.mjs': H('moved') };
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'measured', files } }), { allowCodeChange: true })).toEqual({ ok: true, stamps: ['code-changed'] });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' } }), { allowCodeChange: true }))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/history-gate.mjs is absent' });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/measure-history.py', cause: 'unreadable' } }), { allowCodeChange: true }))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/measure-history.py is unreadable' });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED(), { allowCodeChange: true })).toEqual({ ok: true, stamps: [] });
      for (const moved of [{ version: { state: 'value', version: 'moved' } }, { version: { state: 'failed', code: 3, signal: null } },
        { stamp: { state: 'value', tag: 'moved' } }, { stamp: { state: 'untagged' } }, { wrapperSha256: H('moved') }]) {
        t7expect(t7drv.preflight(EXPECTED(), MEASURED(moved), { allowCodeChange: true }).ok, JSON.stringify(moved)).toBe(false);
      }
    });
  });

  t7describe('loadStep0a checks the sha before parsing, then the shape', () => {
    const step0a = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
      kind: t7drv.STEP0A_KIND, v: 1, measured_ms: 1_800_000_000_000, account: 'up-a', settings_mode: 'restricted',
      claude_code_version: '9.9.9 (Claude Code)', wrapper_sha256: null, flags_accepted: { '--restricted': true },
      writer_init: null, judge_init: null, box_init: null, code_shas: Object.fromEntries(t7drv.CODE_SHA_FILES.map((f: string) => [f, H(f)])),
      release_stamp: 'v0.0.900', budget: 100_000, spend: 1_234, ...o,
    });
    const plant = (text: string): string => {
      const dir = t7MkTmp('t7-s0a-');
      const p = t7path.join(dir, 'step0a.json');
      t7fs.writeFileSync(p, text);
      return p;
    };

    t7it('a step 0a output with its own sha loads, whole', () => {
      const text = t7Canon(step0a()) + '\n';
      t7expect(t7drv.loadStep0a(plant(text), t7Sha(text))).toEqual(step0a());
    });
    t7it('a wrong sha refuses input-sha-mismatch, before the bytes are parsed: valid JSON and not-JSON alike', () => {
      const good = t7Canon(step0a()) + '\n';
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(good), t7Sha('other bytes'))).word).toBe('input-sha-mismatch');
      t7expect(refusalOf(() => t7drv.loadStep0a(plant('{"kind":'), t7Sha('other bytes'))).word).toBe('input-sha-mismatch');
    });
    t7it('the right sha over bytes that are not JSON refuses input-invalid not-json', () => {
      t7expect(refusalOf(() => t7drv.loadStep0a(plant('{"kind":'), t7Sha('{"kind":')))).toEqual({ word: 'input-invalid', detail: 'step0a not-json' });
    });
    t7it.each([
      ['an extra field', { extra: 1 }], ['another kind', { kind: 'ccrc-history-w2-probe' }], ['a code sha missing', { code_shas: { 'ccd/history/lib.mjs': H('x') } }],
      ['an unknown settings mode', { settings_mode: 'bypass' }], ['a zero budget', { budget: 0 }], ['an empty release stamp', { release_stamp: '' }],
    ])('the right sha over %s refuses input-invalid', (_name, o) => {
      const text = t7Canon(step0a(o as Record<string, unknown>)) + '\n';
      const r = refusalOf(() => t7drv.loadStep0a(plant(text), t7Sha(text)));
      t7expect(r.word).toBe('input-invalid');
      t7expect(r.detail.startsWith('step0a shape ')).toBe(true);
    });
    t7it('a step 0a file inside a git tree refuses input-invalid, before it is read', () => {
      const text = t7Canon(step0a()) + '\n';
      const p = plant(text);
      t7fs.mkdirSync(t7path.join(t7path.dirname(p), '.git'));
      t7expect(refusalOf(() => t7drv.loadStep0a(p, t7Sha(text)))).toEqual({ word: 'input-invalid', detail: `step0a in-git-tree ${t7path.dirname(p)}` });
    });
    t7it('a --step0a-sha256 that is not 64 lowercase hex refuses args-invalid', () => {
      const text = t7Canon(step0a()) + '\n';
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(text), t7Sha(text).toUpperCase())).word).toBe('args-invalid');
    });
  });

  t7describe('recall-off presence, W2-D78 ii: lstat whatever the entry, ENOENT alone is absent', () => {
    /** Where lib's recallOffPath puts `<id>` under `home` (the CONTROL below holds the two equal). */
    const roPath = (home: string, id: string): string => t7path.join(home, '.ccrc', 'history', 'recall-off', id);
    const roHome = (): { home: string; dir: string } => {
      const home = t7MkTmp('t7-ro-');
      const dir = t7path.dirname(roPath(home, 'fam-a'));
      t7fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { home, dir };
    };

    t7it('CONTROL: the fixture path is lib\'s recallOffPath', async () => {
      const lib = await import('../../ccd/history/lib.mjs');
      const home = t7MkTmp('t7-ro-');
      t7expect(lib.recallOffPath(home, 'fam-a')).toBe(roPath(home, 'fam-a'));
    });
    t7it('absent passes: no recall-off directory at all, and an empty one', () => {
      t7expect(t7drv.recallOffPresence(t7MkTmp('t7-ro-'), ['fam-a', 'fam-b'])).toEqual({ present: [], unmeasured: [] });
      const { home } = roHome();
      t7expect(t7drv.recallOffPresence(home, ['fam-a'])).toEqual({ present: [], unmeasured: [] });
      t7expect(() => t7drv.refuseRecallOff(home, ['fam-a'])).not.toThrow();
    });
    t7it.each([
      ['a regular file', (p: string) => t7fs.writeFileSync(p, 'a-generation\n')],
      ['an empty file', (p: string) => t7fs.writeFileSync(p, '')],
      ['a directory', (p: string) => t7fs.mkdirSync(p)],
      ['a dangling symlink', (p: string) => t7fs.symlinkSync(t7path.join(t7path.dirname(p), 'nowhere'), p)],
    ])('%s is present, and refuses family-recall-off', (_name, plantEntry) => {
      const { home, dir } = roHome();
      plantEntry(t7path.join(dir, 'fam-b'));
      t7expect(t7drv.recallOffPresence(home, ['fam-a', 'fam-b'])).toEqual({ present: ['fam-b'], unmeasured: [] });
      t7expect(refusalOf(() => t7drv.refuseRecallOff(home, ['fam-a', 'fam-b']))).toEqual({ word: 'family-recall-off', detail: 'present fam-b' });
    });
    t7it.skipIf(ROOT_SKIP)('a recall-off directory with mode 000 answers unmeasured, and refuses', () => {
      const { home, dir } = roHome();
      t7fs.chmodSync(dir, 0o000);
      try {
        t7expect(t7drv.recallOffPresence(home, ['fam-a'])).toEqual({ present: [], unmeasured: [{ id: 'fam-a', code: 'EACCES' }] });
        t7expect(refusalOf(() => t7drv.refuseRecallOff(home, ['fam-a']))).toEqual({ word: 'family-recall-off', detail: 'unmeasured fam-a EACCES' });
      } finally {
        t7fs.chmodSync(dir, 0o700);
      }
    });
    t7it('an id lib refuses is input-invalid, never read as absent and never exit 1 (coordinator ruling)', () => {
      t7expect(refusalOf(() => t7drv.recallOffPresence(t7MkTmp('t7-ro-'), ['../escape'])))
        .toEqual({ word: 'input-invalid', detail: 'family id "../escape" is not a session id' });
      t7expect(refusalOf(() => t7drv.refuseRecallOff(t7MkTmp('t7-ro-'), ['fam-a', '../escape'])), 'refuseRecallOff carries the same refusal')
        .toEqual({ word: 'input-invalid', detail: 'family id "../escape" is not a session id' });
    });
    t7it('the driver names recall-off on exactly one code line, an lstatSync of recallOffPath, and never spells the directory', () => {
      const code = t7fs.readFileSync(t7path.join(REPO, 'deploy', 'history-replay.mjs'), 'utf8').split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      const naming = (lines: string[]): string[] => lines.filter((l) => l.includes('recallOffPath(')).map((l) => l.trim());
      const spells = (lines: string[]): string[] => lines.filter((l) => /\/recall-off|'recall-off'|RECALL_OFF_DIR/.test(l));
      t7expect(naming(code)).toEqual(['lstatSync(recallOffPath(home, id));']);
      t7expect(spells(code)).toEqual([]);
      // CONTROL: both needles see a planted line.
      t7expect(naming(['  writeFileSync(recallOffPath(home, id), g);'])).toHaveLength(1);
      t7expect(spells(["  const p = path.join(root, 'recall-off', id);"])).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms. The filter selects this task's describe, 53 tests (predicted: 52 measured, plus the one case the `tree-unmeasured` ruling adds):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 7')
```

Expected: red, `52 failed | 1 passed (53)` when run as a non-root user (predicted after the `code-unmeasured`, `input-invalid` and `tree-unmeasured` rulings; the first two changed this task's code and the cases that pin them but not the case count, and the third adds one case; measured as `51 failed | 1 passed (52)` before them). That measurement was taken against a stand-in driver made of Tasks 1–4's head and Task 5's section, with this task's section absent. The one that passes is the `recallOffPath` CONTROL, which reads lib alone. The failures are (measured before the rulings; predicted after them, and the renamed id case, which now calls `refusalOf`, may report its missing function through that helper):
- `TypeError: Cannot read properties of undefined (reading 'map')` (16 cases, predicted: 15 measured, plus the new unmeasured-order case, which calls `EXPECTED()` too);
- `TypeError: CODE_SHA_FILES is not iterable` (6);
- `readReleaseStamp is not a function` (5);
- `recallOffPresence is not a function` (3);
- `wrapperSha` and `measureClaudeVersion is not a function` (2 each);
- `codeShas` and `loadStep0a is not a function` (1 each);
- the structural pin, `expected [] to deeply equal [ 'lstatSync(recallOffPath(home, id));' ]`.

- [ ] **Step 4: Write the implementation.** In `deploy/history-replay.mjs`, directly above the entry guard and after Task 6's section, insert:

```js

// ── W2-4 Task 7: the preflights W2-5a and W2-5b wire (W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59) ────────
// Mechanisms only: no subcommand here calls them yet. Before part 1 a spawning subcommand compares what step 0a
// recorded (loadStep0a over `--step0a PATH --step0a-sha256 HEX`) with what it measures now; from part 1 it compares
// part 1's values. W2-5a and W2-5b wire each of their own subcommands (W2-D24); step 0a (Task 8) RECORDS
// codeShas() and the release stamp and never compares them.
// Every reader keeps its conditions apart: a file that cannot be measured is never hashed as nothing, a stamp that
// cannot be read is never "no stamp", and a recall-off entry that cannot be lstat'ed is never "absent".

/** The four files whose installed bytes gate_code pins (W2-D24), relative to the tree the driver runs from. The
 *  imports of lib.mjs (recall.mjs, derive.mjs, cli.mjs, store.mjs) are not hashed: the release stamp covers them. */
export const CODE_SHA_FILES = Object.freeze(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
/** The tree this file was loaded from: the installed release on a node, the checkout in a test. */
export const TREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Step 0a's output kind and its exact field set (W2-D57): loadStep0a's shape, and the one Task 8 writes. */
export const STEP0A_KIND = 'ccrc-history-w2-step0a';
export const STEP0A_FIELDS = Object.freeze(['kind', 'v', 'measured_ms', 'account', 'settings_mode', 'claude_code_version',
  'wrapper_sha256', 'flags_accepted', 'writer_init', 'judge_init', 'box_init', 'code_shas', 'release_stamp', 'budget', 'spend']);
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_TIMEOUT_MS = 60_000;
const VERSION_STDOUT_MAX = 65_536;

/** The sha256 of each CODE_SHA_FILES member's bytes under `root`, or the first one that cannot be measured. An
 *  absent file (history-gate.mjs before W2-3 lands) is `absent`; any other read failure is `unreadable`. */
export function codeShas(root = TREE_ROOT) {
  const files = {};
  for (const rel of CODE_SHA_FILES) {
    let bytes;
    try {
      bytes = readFileSync(path.join(root, rel));
    } catch (e) {
      return { state: 'unmeasured', path: rel, cause: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
    }
    files[rel] = sha256Hex(bytes);
  }
  return { state: 'measured', files };
}

/** The installed release tag: `version` in `$HOME/.ccrc/build.json`, which an untagged build omits. Only the label
 *  is read; shared/buildinfo.ts stays the one validator of the stamp's other fields. */
export function readReleaseStamp(home) {
  let text;
  try {
    text = readFileSync(path.join(home, '.ccrc', 'build.json'), 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', code: String(e.code) };
  }
  let stamp;
  try {
    stamp = JSON.parse(text);
  } catch {
    return { state: 'malformed' };
  }
  if (stamp === null || typeof stamp !== 'object' || Array.isArray(stamp)) return { state: 'malformed' };
  if (!Object.hasOwn(stamp, 'version')) return { state: 'untagged' };
  if (typeof stamp.version !== 'string' || stamp.version === '') return { state: 'malformed' };
  return { state: 'value', tag: stamp.version };
}

/** A generated account's wrapper bytes, hashed; null for upstream, which has no wrapper. A wrapper that cannot be
 *  read refuses `wrapper-unmeasured` here (coordinator ruling): null is upstream's answer and never a failed read's,
 *  and `wrapper-moved` names a measured mismatch only. */
export function wrapperSha(launch) {
  if (launch.kind === 'upstream') return null;
  if (launch.kind !== 'generated' || typeof launch.wrapperPath !== 'string') throw new TypeError(`wrapperSha: not a LaunchSpec: ${JSON.stringify(launch)}`);
  let bytes;
  try {
    bytes = readFileSync(launch.wrapperPath);
  } catch (e) {
    refuse('wrapper-unmeasured', `${launch.wrapperPath}: ${e.code}`);
  }
  return sha256Hex(bytes);
}

/** `<launcher> --version` under launchRun's rules: writer-mode env (no CCRC_RECALL_*), the poisoned PATH, a fresh
 *  empty 0700 cwd removed afterwards, no shell, killed on its own pid past VERSION_TIMEOUT_MS. It spends nothing and
 *  records nothing in the ledger. The version is the first stdout line, trimmed. `lang` is the caller's LANG from
 *  main's env (undefined when unset), threaded as RunJob.lang is: this function reads no environment itself. The
 *  child env is named childEnv and passed as `env: childEnv`, as launchRun's is: Task 5's env scan reds on the
 *  shorthand `{ cwd, env }`.
 *  @param {object} launch  @param {string} out  @param {string | undefined} lang */
export async function measureClaudeVersion(launch, out, lang) {
  const home = runHomeOf(launch);
  const childEnv = spawnEnv({ mode: 'writer', home, configDir: launch.configDir, poisonBin: ensurePoisonBin(out), lang });
  const cwd = makeRunCwd();
  let r;
  try {
    r = await new Promise((resolve) => {
      const child = spawn(launch.launcher, ['--version'], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = [];
      let kept = 0;
      child.stdout.on('data', (b) => {
        if (kept < VERSION_STDOUT_MAX) { chunks.push(b.subarray(0, VERSION_STDOUT_MAX - kept)); kept += b.length; }
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), VERSION_TIMEOUT_MS);
      child.on('error', () => { clearTimeout(timer); resolve({ code: null, signal: null, stdout: '' }); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(chunks).toString('utf8') }); });
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const version = r.stdout.split('\n')[0].trim();
  if (r.code !== 0 || r.signal !== null || version === '') return { state: 'failed', code: r.code, signal: r.signal };
  return { state: 'value', version };
}

/** Compare what was recorded with what is measured, in W2-D56's fixed order: the Claude Code version, the release
 *  stamp (W2-D6's tree-moved), the wrapper, the four code shas. A moved word names a MEASURED mismatch only; an
 *  input that cannot be measured refuses its own word at its place (coordinator ruling): version-unmeasured,
 *  tree-unmeasured, code-unmeasured (the wrapper's, wrapper-unmeasured, is wrapperSha's refusal, before this is
 *  reached: measured.wrapperSha256 is a sha or upstream's null). Only the code-changed word, a MEASURED change,
 *  may become a stamp, and only with allowCodeChange (W2-D24's --allow-code-change); no unmeasured word ever
 *  does. Pure. */
export function preflight(expected, measured, opts = {}) {
  const v = measured.version;
  if (v.state !== 'value') return { ok: false, word: 'version-unmeasured', detail: `--version failed (code ${v.code}, signal ${v.signal})` };
  if (v.version !== expected.claude_code_version) return { ok: false, word: 'claude-version-moved', detail: `recorded ${expected.claude_code_version}, measured ${v.version}` };
  const s = measured.stamp;
  if (s.state !== 'value') return { ok: false, word: 'tree-unmeasured', detail: `the release stamp is ${s.state}${s.state === 'unreadable' ? ` (${s.code})` : ''}` };
  if (s.tag !== expected.release_stamp) return { ok: false, word: 'tree-moved', detail: `recorded ${expected.release_stamp}, measured ${s.tag}` };
  if (measured.wrapperSha256 !== expected.wrapper_sha256) return { ok: false, word: 'wrapper-moved', detail: `recorded ${expected.wrapper_sha256 ?? 'no wrapper'}, measured ${measured.wrapperSha256 ?? 'no wrapper'}` };
  const c = measured.codeShas;
  if (c.state !== 'measured') return { ok: false, word: 'code-unmeasured', detail: `${c.path} is ${c.cause}` };
  const names = [...new Set([...CODE_SHA_FILES, ...Object.keys(expected.code_shas)])];
  const moved = names.filter((f) => c.files[f] !== expected.code_shas[f]);
  if (moved.length === 0) return { ok: true, stamps: [] };
  if (opts.allowCodeChange === true) return { ok: true, stamps: ['code-changed'] };
  return { ok: false, word: 'code-changed', detail: `changed ${moved.join(' ')}` };
}

const plainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** The first field of a parsed step 0a output that is not Step0aOutput's shape, or null. */
function step0aShapeError(o) {
  if (!plainObject(o)) return 'not-object';
  const keys = Object.keys(o).sort().join(' ');
  if (keys !== [...STEP0A_FIELDS].sort().join(' ')) return `fields ${keys}`;
  if (o.kind !== STEP0A_KIND) return 'kind';
  if (o.v !== 1) return 'v';
  if (!Number.isSafeInteger(o.measured_ms) || o.measured_ms <= 0) return 'measured_ms';
  if (typeof o.account !== 'string' || o.account === '') return 'account';
  if (!SETTINGS_MODES.includes(o.settings_mode)) return 'settings_mode';
  if (typeof o.claude_code_version !== 'string' || o.claude_code_version === '') return 'claude_code_version';
  if (o.wrapper_sha256 !== null && !(typeof o.wrapper_sha256 === 'string' && SHA256_RE.test(o.wrapper_sha256))) return 'wrapper_sha256';
  if (!plainObject(o.flags_accepted) || !Object.values(o.flags_accepted).every((b) => typeof b === 'boolean')) return 'flags_accepted';
  for (const k of ['writer_init', 'judge_init', 'box_init']) if (o[k] !== null && !plainObject(o[k])) return k;
  if (!plainObject(o.code_shas) || Object.keys(o.code_shas).sort().join(' ') !== [...CODE_SHA_FILES].sort().join(' ')
    || !CODE_SHA_FILES.every((f) => typeof o.code_shas[f] === 'string' && SHA256_RE.test(o.code_shas[f]))) return 'code_shas';
  if (typeof o.release_stamp !== 'string' || o.release_stamp === '') return 'release_stamp';
  if (!Number.isSafeInteger(o.budget) || o.budget <= 0) return 'budget';
  if (!Number.isSafeInteger(o.spend) || o.spend < 0) return 'spend';
  return null;
}

/** Step 0a's output as a later subcommand's input (W2-D56): outside any git tree, its bytes' sha256 checked BEFORE
 *  they are parsed (input-sha-mismatch, W2-D59), then its shape (input-invalid). */
export function loadStep0a(p, sha256) {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', '--step0a-sha256 is not 64 lowercase hex');
  if (typeof p !== 'string' || p === '') refuse('args-invalid', '--step0a names no path');
  const abs = path.resolve(p);
  const g = insideGitTree(path.dirname(abs));
  if (g.state === 'inside') refuse('input-invalid', `step0a in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse('input-invalid', `step0a git-unmeasured ${g.at} ${g.code}`);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (e) {
    refuse('input-invalid', `step0a unreadable ${e.code}`);
  }
  const got = sha256Hex(bytes);
  if (got !== sha256) refuse('input-sha-mismatch', `step0a: expected ${sha256}, measured ${got}`);
  let o;
  try {
    o = JSON.parse(bytes.toString('utf8'));
  } catch {
    refuse('input-invalid', 'step0a not-json');
  }
  const bad = step0aShapeError(o);
  if (bad !== null) refuse('input-invalid', `step0a shape ${bad}`);
  return o;
}

/** Which ids have a recall-off entry (W2-D78(ii)): an lstat of lib's own path, whatever the entry's type or content,
 *  so a directory, an empty file and a dangling symlink are each present. ENOENT alone is absent; any other lstat
 *  error is unmeasured. An id that fails idOk makes recallOffPath throw a TypeError with no code, which refuses
 *  input-invalid (coordinator ruling): never read as absent, never a defect's exit 1.
 *  The driver never opens the entry (W2-D29): this lstat line is its one recall-off line. */
export function recallOffPresence(home, ids) {
  const present = [];
  const unmeasured = [];
  for (const id of ids) {
    try {
      lstatSync(recallOffPath(home, id));
      present.push(id);
    } catch (e) {
      if (e instanceof TypeError && e.code === undefined) refuse('input-invalid', `family id ${JSON.stringify(id)} is not a session id`);
      if (typeof e?.code !== 'string') throw e;
      if (e.code !== 'ENOENT') unmeasured.push({ id, code: e.code });
    }
  }
  return { present, unmeasured };
}

/** Refuse when any id is present or unmeasured: both are the one driver word (W2-D78(ii)). */
export function refuseRecallOff(home, ids) {
  const { present, unmeasured } = recallOffPresence(home, ids);
  if (present.length === 0 && unmeasured.length === 0) return;
  const parts = [];
  if (present.length > 0) parts.push(`present ${present.join(' ')}`);
  if (unmeasured.length > 0) parts.push(`unmeasured ${unmeasured.map((u) => `${u.id} ${u.code}`).join(', ')}`);
  refuse('family-recall-off', parts.join('; '));
}
```

O13's needle rule (Global Constraints): no line here that names `recall-off` (the `refuse('family-recall-off', …)` line) carries a write verb before a `;`. Of the two lines that name `recallOffPath`, one is the import and the other is the `lstatSync` line. Measured against W2-1's future needles (`recall-off`, `recallOffPath`, `recallOffDir`, `RECALL_OFF_DIR`) with O13's own `writes()` regex: zero writer lines.

- [ ] **Step 5: Run them and see them pass.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 7')
```

Expected: green, `53 passed` (predicted after the `code-unmeasured`, `input-invalid` and `tree-unmeasured` rulings; measured as `52 passed` against the stand-in as a non-root user before them). As root, the two mode-000 cases skip, giving `51 passed | 2 skipped` (predicted).

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement (asserted to match once), runs one filter, shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
F=deploy/history-replay.mjs
cp "$F" "$SCRATCH/replay.t7.orig"

# M1: hash only three files (lib.mjs dropped from gate_code).
mut "$F" "'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);" "'deploy/history-replay.mjs']);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'CODE_SHA_FILES is exactly the four files|one changed byte in')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 2 failed | 3 passed. expected [ 'deploy/history-gate.mjs', …(2) ] to deeply equal
# [ 'deploy/history-gate.mjs', …(3) ], and 'one changed byte in ccd/history/lib.mjs' sees no entry move.

# M2: an untagged stamp read as passing (the unmeasured arm skips untagged, the compare skips a stamp with no tag).
mut "$F" "if (s.state !== 'value') return { ok: false, word: 'tree-unmeasured'" "if (s.state !== 'value' && s.state !== 'untagged') return { ok: false, word: 'tree-unmeasured'"
mut "$F" "if (s.tag !== expected.release_stamp) return" "if (s.state === 'value' && s.tag !== expected.release_stamp) return"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is tree-unmeasured, never tree-moved|allowCodeChange stamps code-changed')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted; measured as below before the tree-unmeasured ruling renamed the word and the case, when it read
# "to match object { ok: false, word: 'tree-moved' }"): 2 failed | 3 passed. expected { ok: true, stamps: [] } to deeply equal
# { ok: false, …(2) }, and {"stamp":{"state":"untagged"}}: expected true to be false.

# M3: a dangling symlink treated as absent (stat follows the link).
mut "$F" "      lstatSync(recallOffPath(home, id));" "      statSync(recallOffPath(home, id));"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is present, and refuses family-recall-off|names recall-off on exactly one code line')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 2 failed | 3 passed. 'a dangling symlink is present': expected { present: [], unmeasured: [] } to deeply
# equal { Object (present, unmeasured) }; the structural pin: expected [ Array(1) ] to deeply equal [ Array(1) ].

# M4: EACCES treated as absent.
mut "$F" "if (e.code !== 'ENOENT') unmeasured.push" "if (e.code !== 'ENOENT' && e.code !== 'EACCES') unmeasured.push"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'a recall-off directory with mode 000')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured, non-root): 1 failed. expected { present: [], unmeasured: [] } to deeply equal { present: [], …(1) }.

# M5: the sha check skipped.
mut "$F" "  if (got !== sha256) refuse('input-sha-mismatch', \`step0a: expected \${sha256}, measured \${got}\`);
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'refuses input-sha-mismatch, before the bytes are parsed')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 1 failed. Error: expected a DriverRefusal, and nothing was thrown.

# M5b: the sha checked only after parsing and the shape.
mut "$F" "  if (got !== sha256) refuse('input-sha-mismatch', \`step0a: expected \${sha256}, measured \${got}\`);
" ""
mut "$F" "  if (bad !== null) refuse('input-invalid', \`step0a shape \${bad}\`);
" "  if (bad !== null) refuse('input-invalid', \`step0a shape \${bad}\`);
  if (got !== sha256) refuse('input-sha-mismatch', \`step0a: expected \${sha256}, measured \${got}\`);
"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'refuses input-sha-mismatch, before the bytes are parsed')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 1 failed. expected 'input-invalid' to be 'input-sha-mismatch'.

# M6 (no overloaded null): an unreadable wrapper answers upstream's null.
mut "$F" "    refuse('wrapper-unmeasured', \`\${launch.wrapperPath}: \${e.code}\`);" "    return null;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an unreadable wrapper refuses wrapper-unmeasured')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured before the wrapper-unmeasured ruling renamed the word and the case; the anchor is predicted): 1 failed.
# Error: expected a DriverRefusal, and nothing was thrown.

# M7: an absent code file hashed as nothing.
mut "$F" "      return { state: 'unmeasured', path: rel, cause: e.code === 'ENOENT' ? 'absent' : 'unreadable' };" "      if (e.code !== 'ENOENT') return { state: 'unmeasured', path: rel, cause: 'unreadable' };
      bytes = Buffer.alloc(0);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an absent file answers unmeasured absent')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 1 failed. expected { state: 'measured', files: { …(4) } } to deeply equal { state: 'unmeasured', …(2) }.

# M8: --version run with the caller's env spread in.
mut "$F" "  const childEnv = spawnEnv({ mode: 'writer'," "  const childEnv = { ...process.env, ...spawnEnv({ mode: 'writer',"
mut "$F" "lang });
  const cwd = makeRunCwd();
  let r;" "lang }) };
  const cwd = makeRunCwd();
  let r;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'measureClaudeVersion: the first stdout line')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured, before the lang parameter replaced the process.env.LANG read; the anchor is predicted): 1 failed. expected [ …(61 caller env names) ] to deeply equal [ 'CLAUDE_CONFIG_DIR', 'HOME', …(2) ]
# (the count is the caller's; only key names are printed, never values).

# M9: the --version cwd left behind.
mut "$F" "  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const version = r.stdout" "  } finally {
  }
  const version = r.stdout"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'measureClaudeVersion: the first stdout line')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured): 1 failed. the run cwd is removed afterwards: expected true to be false.

# M10: --allow-code-change ignored.
mut "$F" "  if (opts.allowCodeChange === true) return { ok: true, stamps: ['code-changed'] };
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'allowCodeChange stamps code-changed')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (measured before the code-unmeasured ruling added assertions to the case this filter selects; predicted
# unchanged after it, since the first assertion is still the measured change's stamp): 1 failed. expected { ok: false, …(2) } to deeply equal { Object (ok, stamps) }.

# M11 (coordinator ruling): --allow-code-change stamps an unmeasured code file too.
mut "$F" "  if (c.state !== 'measured') return { ok: false, word: 'code-unmeasured'," "  if (c.state !== 'measured') return opts.allowCodeChange === true ? { ok: true, stamps: ['code-changed'] } : { ok: false, word: 'code-unmeasured',"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'allowCodeChange stamps code-changed')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted): 1 failed. expected { ok: true, stamps: [ 'code-changed' ] } to deeply equal { ok: false, …(2) }.

# M12 (coordinator ruling): an id lib refuses read as absent.
mut "$F" "      if (e instanceof TypeError && e.code === undefined) refuse('input-invalid'," "      if (e instanceof TypeError && e.code === undefined) continue; void ('input-invalid',"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an id lib refuses is input-invalid')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted): 1 failed. Error: expected a DriverRefusal, and nothing was thrown.

# M13 (coordinator ruling): a release stamp that cannot be read folded back into tree-moved.
mut "$F" "return { ok: false, word: 'tree-unmeasured'," "return { ok: false, word: 'tree-moved',"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is tree-unmeasured, never tree-moved|each unmeasured input refuses its own word')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted): 5 failed: each of the four stamp rows, expected { ok: false, word: 'tree-moved', …(1) } to deeply
# equal { ok: false, word: 'tree-unmeasured', …(1) }, and the order case, expected [ 'version-unmeasured', 'tree-moved', …(1) ]
# to deeply equal [ 'version-unmeasured', 'tree-unmeasured', …(1) ].

# M14 (coordinator ruling): a --version that cannot be measured folded back into claude-version-moved.
mut "$F" "return { ok: false, word: 'version-unmeasured'," "return { ok: false, word: 'claude-version-moved',"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is version-unmeasured, never claude-version-moved|each unmeasured input refuses its own word')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted): 2 failed: the failed --version case, expected { ok: false, word: 'claude-version-moved', …(1) } to
# deeply equal { ok: false, word: 'version-unmeasured', …(1) }, and the order case, expected [ 'claude-version-moved', …(2) ]
# to deeply equal [ 'version-unmeasured', …(2) ].

# M15 (coordinator ruling): a wrapper that cannot be read folded back into wrapper-moved.
mut "$F" "    refuse('wrapper-unmeasured'," "    refuse('wrapper-moved',"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an unreadable wrapper refuses wrapper-unmeasured')
cp "$SCRATCH/replay.t7.orig" "$F"
# Expected RED (predicted): 1 failed. expected 'wrapper-moved' to be 'wrapper-unmeasured'.

cmp "$F" "$SCRATCH/replay.t7.orig" && echo restored
```

Then run Step 5's command again: green, `53 passed` (predicted, as in Step 5).

- [ ] **Step 7: Run the neighbours that read this file.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `typecheck-tests` is one of them):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'recall-off')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only|every vocabulary is declared once')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: green, as measured with the stand-in driver placed in a full copy of the base tree:
- `history-replay`: every earlier task's cases, plus this task's 53 (predicted; 52 before the `tree-unmeasured` ruling added one case).
- `single-definition -t 'recall-off'`: `1 passed`. That is O13's recall-off case: no corpus file but `sweep.mjs` writes `recall-off`, and the `refuse('family-recall-off', …)` line and the `lstatSync` line are not writes.
- `single-definition -t 'operator switches have readers only|every vocabulary is declared once'`: `78 passed`. No new name here (`CODE_SHA_FILES`, `TREE_ROOT`, `STEP0A_KIND`, `STEP0A_FIELDS`, `SHA256_RE`, `VERSION_TIMEOUT_MS`, `VERSION_STDOUT_MAX`) is an O14 `VOCABS` name, and no line spells a switch path.
- `typecheck-tests`: green. The test file was measured clean under `test/tsconfig.tests.json`.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 7 — preflights, codeShas, the release stamp and the recall-off presence check" -m "$CO_AUTHORED_BY"
```

---

### Task 8: Step 0a, end to end

Tasks 1 to 7 built the pieces; this task wires them into the one subcommand the operator runs on each named node before pilot sourcing (W2 decisions document §5, act 7): `history-replay.mjs step0a --out <dir> --account <id> --budget <N> --writer-model <id> --judge-model <id> --arm-model <id> [--settings-mode restricted|fallback]`. Step 0a records what part 1 will carry for that node (W2-D57; §4's `step0a` row): the Claude Code version as launched, the wrapper sha, whether every flag the contract uses is accepted, the init event of one writer and one judge spawn (and of the box-mode run), `codeShas()` and the installed release stamp, recorded and never compared (W2-D24), and the budget with the measured spend (W2-D55). It writes `canonicalJson(output) + '\n'` to `<out>/step0a.json`, keeps the three streams under `<out>/step0a/`, and prints `sha256 <hex>` over the file's bytes. That is the value the operator later hands `pilot-source` as `--step0a-sha256`, which W2-5a checks with Task 7's `loadStep0a`. It spends, so every refusal lands before its first spawn, and an interrupted run resumes over the same `--out` without re-spawning a finished run.

**Files:**
- Modify: `deploy/history-replay.mjs`:
  - the import block. This task uses `existsSync`, `mkdirSync`, `readFileSync`, `renameSync` and `writeFileSync` from `node:fs`, `path` (the default binding) from `node:path`, and `EXIT`, `canonicalJson` and `sha256Hex` from `../ccd/history/lib.mjs`. Add any name the block lacks to that module's existing import. Never add a second import statement for a module already imported, and never import `node:sqlite` (Task 1's scan) or anything from `server/` or `deploy/history-gate.mjs`.
  - one section, inserted directly above the entry guard (the file's last block, which starts `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {`) and after Task 7's section. Task 9's section goes after this one.
- Modify: `server/test/history-replay.test.ts`:
  - the import block (Step 2(a));
  - one describe, appended at the end of the file, after Task 7's describe.
- Not edited: every other file. Neither `ci.yml` nor `lifecycle.ts` nor `lifecycle.test.ts` changes here.

**Interfaces:**
- Consumes (Task 1): `refuse`, `DriverRefusal` (mutant M1 only), the words `code-unmeasured`, `version-unmeasured` and `tree-unmeasured` (coordinator rulings), `FLAG_SPECS` (`out`, `account`, `budget` as `int`, `writer-model`, `judge-model`, `arm-model`, `settings-mode`), `HANDLERS`, and `main`. `main` refuses `in-pane` before `parseArgs`, sets `process.umask(0o077)` (Task 2) and turns a `DriverRefusal` into one stderr line and `EXIT.REFUSED`, and any other throw into `EXIT.INTERNAL`. `parseArgs` leaves an absent flag `undefined` and has already refused a non-positive or non-integer `--budget`. Test-side: `SCRIPT` (the driver's path), `runDriver`'s env contract (`{...scrubbedEnv(process.env), HOME: home, ...extraEnv}`), which `t8Run` repeats for a driver copy, and the driver's namespace import, spelled `replay` here.
- Consumes (Task 2): `prepareOut(out)`, which creates a missing `--out` 0700 with only the marker file in it, and `OUT_MARKER`.
- Consumes (Task 3): `readRoster(home)` and `admitAccount(json, roster, id, home)`, which return a `LaunchSpec` or throw `account-refused` with the details listed in Task 3. Test-side: the module-level `writeRoster(home, accounts)` and `FIXTURE_ACCOUNTS`, Task 3's twelve fixture rows (ids `up-a`, `gen-a`, `gen-o`, `cx-a`, `ext-n`, `ext-a`, `gen-h`, `gen-u`, `gen-s`, `gen-m`, `gen-r`, `gen-d`, each row carrying its `id`). `gen-u` declares no provider and reads as `anthropic` by the admission ruling; in this task's HOME its secrets file is not planted, so it is not one of the refusal rows below.
- Consumes (Task 4): `readStreamJson(text)` and `spentSoFar(out)`. Task 5's `launchRun` calls `recordSpend`.
- Consumes (Task 5): `SETTINGS_MODES`, `spawnArgv({mode, model, settingsMode, home})`, `allowedToolSpellings(home)` (tests), `RunJob` (whose `lang` key is required: each job carries `env.LANG`), and `runBatch(jobs, {concurrency, gate})`. This task relies on four of its behaviours, which Step 1 confirms:
  - it returns one `RunOutcome` per job, in job order;
  - with `concurrency: 1`, it calls `gate()` before each spawn and lets a throw from `gate` reject the batch;
  - a job whose `<out>/<name>.run.json` exists is skipped and never spawned, and its outcome carries the `unknownOptions` its `run.json` recorded;
  - a run's stream is `<out>/<name>.jsonl`, so a name `step0a/writer` writes under `<out>/step0a/`, which this task creates.
  Test-side: `plantStub(home, id)`, `stubLog(home)` (null when absent), `STUB_STREAM` (the basename `stub-stream.jsonl`, read from `$HOME`), and the stub's log entry fields `argv`, `envKeys` and `stdin`.
- Consumes (Task 6): `batchGate({out, home, accountId, budget, limits})` and `LIMITS_DEFAULTS`.
- Consumes (Task 7): `STEP0A_KIND` (and `STEP0A_FIELDS`, the field set this task's output must match), declared in Task 7 and never declared again here; `codeShas()` over `TREE_ROOT` (`{state: 'measured', files}` or `{state: 'unmeasured', path, cause}`), `readReleaseStamp(home)` (`value` with `tag`, or `absent`, `unreadable` with `code`, `malformed`, `untagged`), `wrapperSha(launch)` (a sha, upstream's null, or a `wrapper-unmeasured` refusal for a wrapper it cannot read), and `measureClaudeVersion(launch, out, lang)` (`{state: 'value', version}` or `{state: 'failed', code, signal}`), passed `env.LANG`.
- Consumes (base): lib's `EXIT.OK` (0), `canonicalJson` (`:454`) and `sha256Hex` (`:527`). Tests only: `rosterFromJson` (`shared/roster-json.mjs:568`), `generateWrapperBody` (`shared/wrapper.mjs:80`), `mkTmp` (`server/test/tmpHelpers.ts:38`) and `scrubbedEnv` (`server/test/historyHelpers.ts:54`).
- Produces (`deploy/history-replay.mjs`):
  - `STEP0A_FILE = 'step0a.json'` and `STEP0A_PROMPT` (the one prompt all three runs read on stdin). `STEP0A_KIND` is Task 7's.
  - `flagsAccepted(argvs: ReadonlyArray<readonly string[]>, outcomes: ReadonlyArray<{unknownOptions: readonly string[]}>): Record<string, boolean>`. It is pure: every token of the argvs that starts with `-` maps to `true`, unless an outcome reported it as an unknown option.
  - `step0aCommand(flags, env): Promise<number>`, registered with `HANDLERS.set('step0a', step0aCommand)`.
  - Module-private: `STEP0A_RUNS` (writer, judge, box, in that order) and `requireFlag(flags, name)`, which refuses `args-invalid '<name>-required'`.
  - The output, `Step0aOutput`, has exactly fifteen keys: `{kind: STEP0A_KIND, v: 1, measured_ms, account, settings_mode, claude_code_version, wrapper_sha256: string | null, flags_accepted, writer_init, judge_init, box_init, code_shas: Record<string, string>, release_stamp: string, budget, spend}`. The three `*_init` fields are `StreamFacts['init']`.
  - **This shape is authoritative for W2-3 (coordinator ruling).** W2-3's open-record validator follows `Step0aOutput` as written here, not the other way round: `flags_accepted` is the per-flag `Record<string, boolean>` that `flagsAccepted` builds. `label` and `store_id` are not fields step 0a records (it opens no store and cannot measure either): `open --draft` (W2-5a) binds each step 0a output to its node by adding `label` and `store_id` beside the fifteen keys when it copies the output (after `loadStep0a`) into part 1, and W2-3's validator checks the entry as those fifteen keys plus the two (coordinator ruling, 2026-10-19). Nothing in this PR writes either field. `writer_init` and `judge_init` are always present after a complete step 0a: each is the init event of its run, and it is null only when that run could not run (no init event in its stream), which part 1 refuses. `box_init` is recorded the same way.
- Produces (test file): the describe `'W2-4 Task 8: step0a end to end'` and its local helpers. Each helper name is prefixed `t8`, and none is exported.

**Spec and decisions:** §10.2 "How they run" and "Two arms" (`:2656-2685`), and "Account and budget" (`:2686`); W2-D57, W2-D55, W2-D24, W2-D52 and W2-D51 (through Task 5). This task defines no departure.

**Choices this task makes:**
- **Every refusal comes before the first spawn, and each required flag is checked just before its first use.** The order is:
  0. `HOME` from `main`'s `env`: unset or not absolute refuses `args-invalid 'HOME is unset or not absolute'`, the probe's own check and detail (Task 9), so the two subcommands agree;
  1. `--out` (`out-required`), then `prepareOut`;
  2. `--account` (`account-required`), then the roster and admission;
  3. `--budget` (`budget-required`, W2-D55);
  4. the three model ids;
  5. the settings mode (`args-invalid 'settings-mode <value>'`);
  6. `codeShas()`, then the release stamp, then the wrapper sha (`wrapperSha`: a wrapper it cannot read refuses `wrapper-unmeasured`, coordinator ruling);
  7. the gate.
  Only then does the version spawn run; a `--version` that cannot be measured refuses `version-unmeasured` there, before the batch. After it comes the batch. The scope placed `--budget` after admission, so an unadmissible account answers `account-refused` even when the budget is missing too.
- **An unmeasured code sha or release stamp refuses rather than being recorded.** `Step0aOutput` has no spelling for "unmeasured": `code_shas` maps each file to a sha and `release_stamp` is a tag. So step 0a refuses with the word Task 7's preflight uses for the same condition. That is `code-unmeasured '<path> is <cause>'` for a sha (the word and detail Task 7's preflight gives an unmeasured code file, coordinator ruling), and `tree-unmeasured 'stamp <state>[ <code>]'` for a stamp (coordinator ruling, 2026-10-19: `tree-moved` names only a measured mismatch, which step 0a never compares; the word is the preflight's, the detail is step 0a's own shorter one). Recording nothing is better than a sentinel that part 1's validator would read as a value. Step 0a runs only after the final W2 release is rolled out (§5, acts 6 and 7), so an untagged stamp there means the node is not on a release.
- **The wrapper sha is taken before any spawn or spend (coordinator ruling, 2026-10-19).** `wrapperSha(launch)` runs with the other measurements, after the release stamp and before the gate, and its value is held until the record is written. So a generated account's wrapper that cannot be read refuses `wrapper-unmeasured` before the `--version` spawn and before the batch spends, as every other refusal does; taken after `runBatch`, the refusal would have come after the spend. For a generated account the wrapper is also the launcher, so the early refusal names the cause where a later spawn would only have failed.
- **The gate also runs before the `--version` spawn.** That spawn spends nothing, but a node at its limits threshold should not launch Claude Code at all. So "a limits row at the threshold stops before any spawn" holds for every spawn.
- **Step 0a's batch runs one run at a time** (`concurrency: 1`, within Task 5's cap of 2), so the budget gate sees each finished run's spend before the next run starts. Three short runs gain nothing from parallelism.
- **One prompt for all three runs.** The scope calls the box-mode run's input "an empty question". This task reads that as a prompt that asks nothing of history, `STEP0A_PROMPT`, not an empty stdin. Claude Code's print mode refuses empty input before it emits an init event (**I**, unmeasured), which would leave `box_init` null. The coordinator accepted this reading as written (ruling); the belief stays marked unmeasured until step 0a runs.
- **`flagsAccepted` takes the argvs as its first parameter: `flagsAccepted(argvs, outcomes)`, the one signature every task uses (coordinator ruling: whatever carries the argv it needs).** The task list gave it only `outcomes`, but `RunOutcome` carries no argv. The keys are every token that starts with `-` in the three runs' `spawnArgv` (no contract value starts with `-`). A key is `false` only when a run reported that exact token as an unknown option.
- **A finding is recorded; a launcher that cannot answer `--version` is refused.** A run that exits non-zero or rejects a flag is recorded, and step 0a exits 0: the operator reads the record. Step 0a refuses no `false` in `flags_accepted`: it records a rejected flag and exits 0, and W2-3's `validateOpenRecord` (W2-D25's owner) refuses it in part 1 as `flag-rejected`, for any flag and with no exception (coordinator ruling, 2026-10-19). Under the fallback settings mode step 0a writes no `--restricted` key, so that refusal loses nothing; the same ruling has the validator bind each step 0a entry's `settings_mode` to part 1's. A `--version` that cannot be measured stops step 0a before its batch with the driver word `version-unmeasured` (coordinator ruling), through `main`'s refusal path: one stderr line and exit 2, never a plain `Error`. A guessed version must never be recorded.
- **The facts are re-read from the stream files**, `<out>/step0a/<key>.jsonl`, never taken from the outcome. That way a resumed step 0a, whose finished runs Task 5 skips, records the same `*_init` it would have recorded in one pass.
- **`spend` is `spentSoFar(out)`**, the cumulative ledger the budget gate compared against, so the recorded spend and budget are the pair the stop used.
- **The file is written whole:** `<out>/step0a.json.tmp`, mode 0600, then `renameSync`. The printed sha is computed over the bytes read back from `<out>/step0a.json`, never over the in-memory string.
- **The tests run a driver copy** (`t8Tree`). Each copy sits beside fixture bytes for `deploy/history-gate.mjs` and `deploy/measure-history.py`, so `codeShas()` is measured whether or not W2-3 has merged, and the recorded shas are pinned exactly. `lib.mjs` is copied. `ccd/history`'s other entries and `shared/` are symlinked, so a later PR that adds imports from those two directories keeps this describe working.
- **Every fixture id has a stub launcher and a fresh limits row.** Admission is then the only thing that can stop a refused account, and a spawn that slipped past it would show in the stub's log (mutant M1).

- [ ] **Step 1: Confirm Tasks 1 to 7's names and behaviours before using them.** From the repository root:

```bash
node --input-type=module -e "const m = await import('./deploy/history-replay.mjs'); const names = ['refuse', 'prepareOut', 'readRoster', 'admitAccount', 'readStreamJson', 'spentSoFar', 'spawnArgv', 'allowedToolSpellings', 'runBatch', 'batchGate', 'codeShas', 'readReleaseStamp', 'wrapperSha', 'measureClaudeVersion']; console.log(names.filter((n) => typeof m[n] !== 'function').join(',') || 'all functions', JSON.stringify(m.LIMITS_DEFAULTS), m.SETTINGS_MODES.join(','), m.OUT_MARKER, m.HANDLERS.has('step0a'))"
grep -cE "^export const STEP0A_(KIND|FIELDS) = " deploy/history-replay.mjs
grep -cE "^(export )?const (SCRIPT|STUB_STREAM|FIXTURE_ACCOUNTS)\b" server/test/history-replay.test.ts
grep -cE "^(export )?function (runDriver|writeRoster|plantStub|stubLog)\(" server/test/history-replay.test.ts
grep -c "^import \* as replay from '../../deploy/history-replay.mjs';" server/test/history-replay.test.ts
grep -c "STUB_STREAM = 'stub-stream.jsonl'" server/test/history-replay.test.ts
```

Expected (the first line measured against stand-ins for Tasks 1 to 7):
- the node line prints `all functions {"threshold_pct":70,"max_age_ms":3600000,"batch_max":10,"concurrency":2} restricted,fallback .ccrc-history-replay false`. The module is imported, never run: `process.argv[1]` is unset under `-e`, so the entry guard does not fire.
- `2` (Task 7 declared `STEP0A_KIND` and `STEP0A_FIELDS`; this task never declares either again), then `3`, `4`, `1` (Task 1's namespace import `replay`; Tasks 2 to 7 import the same module again under other bindings, `t2Drv`, `t4Replay`, `t5drv`, `t6Driver`, `t7drv` and Task 3's named imports, on lines this pattern skips), and `1`.

Then read Task 5's `plantStub`, `runBatch` and `launchRun` once and confirm:
- the stub's log entry names its fields `argv`, `envKeys` and `stdin`;
- the four `runBatch` behaviours listed under **Interfaces**.

If a name differs (for example Task 3's rows are not `FIXTURE_ACCOUNTS`, or the driver's namespace is not `replay`), use the earlier task's name everywhere this task's code spells it, and report the difference. If a behaviour differs, that is a gap in that task: stop and report it. Never define any of these names here.

- [ ] **Step 2: Write the failing tests.**

(a) The test file's import block must hold these names. Add each missing one to the existing import from its module; add a new import line only when nothing yet imports from that module:
- `chmodSync`, `copyFileSync`, `existsSync`, `mkdirSync`, `readFileSync`, `readdirSync`, `rmSync`, `symlinkSync`, `writeFileSync` from `'node:fs'`;
- `path` (the default binding) from `'node:path'`;
- `spawnSync` from `'node:child_process'`;
- `sha256Hex` from `'../../ccd/history/lib.mjs'`;
- `rosterFromJson` from `'../../shared/roster-json.mjs'`;
- `generateWrapperBody` from `'../../shared/wrapper.mjs'`;
- `mkTmp` from `'./tmpHelpers.js'`;
- `scrubbedEnv` from `'./historyHelpers.js'`;
- `describe`, `expect`, `it` from `'vitest'`.

(b) Append at the end of `server/test/history-replay.test.ts`:

```ts
// ── W2-4 Task 8: step 0a, end to end (W2-D57, W2-D55, W2-D24, W2-D52, W2-D51) ──────────────────────────────────
// The subcommand as the operator runs it: a child process with a fixture HOME (t8Run, runDriver's env contract over
// a driver copy) against Task 5's recording stub. Every rostered id's launcher is a stub and every id has a fresh
// limits row, so a spawn of ANY account, admitted or not, leaves a log line, and only admission can stop it. Each
// run uses a fixture tree (t8Tree): a copy of the driver beside fixture bytes for the two gate_code files this PR
// does not own, so codeShas() is measured whichever of W2-3 and this PR merges first and the recorded shas can be
// pinned exactly; lib.mjs is copied, and ccd/history's other entries and shared/ are symlinks to this checkout.
describe('W2-4 Task 8: step0a end to end', () => {
  const T8_SESSION = '00000000-0000-4000-8000-0000000000a8';
  const T8_USAGE = { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 50 };
  const T8_PER_RUN = 200;   // the sum of T8_USAGE: what one run spends
  const T8_STREAM = [
    { type: 'system', subtype: 'init', session_id: T8_SESSION, model: 'fixture-model-writer', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
    { type: 'assistant', message: { id: 'msg-t8-1', role: 'assistant', content: [{ type: 'text', text: 'ready' }], usage: T8_USAGE } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ready', usage: T8_USAGE, permission_denials: [] },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const T8_STAMP = 'v9.9.9';
  const T8_GATE_BYTES = '// fixture bytes for deploy/history-gate.mjs (W2-4 Task 8)\n';
  const T8_MEASURE_BYTES = '# fixture bytes for deploy/measure-history.py (W2-4 Task 8)\n';
  const T8_CALLER_ENV = {
    TMUX: '/tmp/fixture-tmux,1,0', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'fixture-session', CCRC_SESSION_GENERATION: 'fixture-generation',
    CCRC_RECALL_SESSION: 'fixture-session', CCRC_RECALL_ARM: 'fixture-arm', CCRC_RECALL_ASOF: 'fixture-asof',
  };
  const T8_MODELS = { writer: 'fixture-model-writer', judge: 'fixture-model-judge', box: 'fixture-model-arm' } as const;
  /** Step0aOutput's fifteen keys, sorted. */
  const T8_STEP0A_KEYS = ['account', 'box_init', 'budget', 'claude_code_version', 'code_shas', 'flags_accepted', 'judge_init',
    'kind', 'measured_ms', 'release_stamp', 'settings_mode', 'spend', 'v', 'wrapper_sha256', 'writer_init'];

  /** A limits row read as fresh: `five` and `seven` as given, sampled a minute ago, both windows still running. */
  function t8Limits(home: string, id: string, five: number, seven: number): void {
    const nowS = Math.floor(Date.now() / 1000);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', `${id}.json`),
      JSON.stringify({ five, seven, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  }

  /** A fixture HOME: Task 3's twelve rows (FIXTURE_ACCOUNTS); a stub at every id's launcher; gen-a's real wrapper (over its stub)
   *  and its secrets file, whose token is assembled here; gen-r's secrets file at mode 000; a fresh limits row
   *  for every id, so only admission can stop a refused one; a tagged release stamp; the canned stream every stub prints. */
  function t8Home(prefix: string): string {
    const home = mkTmp(prefix);
    writeRoster(home, FIXTURE_ACCOUNTS);
    for (const a of FIXTURE_ACCOUNTS as Array<{ id: string }>) { plantStub(home, a.id); t8Limits(home, a.id, 10, 20); }
    const flat = rosterFromJson(JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')));
    const byId = new Map(flat.accounts.map((a) => [a.id, a]));
    writeFileSync(path.join(home, '.local', 'bin', 'gen-a'), generateWrapperBody(byId.get('gen-a')!, flat.upstreamId), { mode: 0o755 });
    for (const id of ['gen-a', 'gen-r']) {
      const p = path.join(home, byId.get(id)!.secretsFile!);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, `export CLAUDE_CODE_OAUTH_TOKEN=${['sk', 'ant', 'oat01', 'fixture', 't8'].join('-')}\n`, { mode: 0o600 });
    }
    chmodSync(path.join(home, byId.get('gen-r')!.secretsFile!), 0o000);
    writeFileSync(path.join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-19T00:00:00Z', dirty: false, version: T8_STAMP }));
    writeFileSync(path.join(home, STUB_STREAM), T8_STREAM);
    return home;
  }

  /** A tree the driver runs from: its own bytes copied (so TREE_ROOT is this tree), fixture bytes for the two
   *  gate_code files this PR does not own (`gate: false` leaves deploy/history-gate.mjs out), lib.mjs copied and
   *  ccd/history's other entries and shared/ symlinked to this checkout, so every import resolves. */
  function t8Tree(opts: { gate?: boolean } = {}): string {
    const repo = path.resolve(path.dirname(SCRIPT), '..');
    const tree = mkTmp('ccrc-w2-t8-tree-');
    mkdirSync(path.join(tree, 'deploy'));
    copyFileSync(SCRIPT, path.join(tree, 'deploy', 'history-replay.mjs'));
    if (opts.gate !== false) writeFileSync(path.join(tree, 'deploy', 'history-gate.mjs'), T8_GATE_BYTES);
    writeFileSync(path.join(tree, 'deploy', 'measure-history.py'), T8_MEASURE_BYTES);
    mkdirSync(path.join(tree, 'ccd', 'history'), { recursive: true });
    for (const n of readdirSync(path.join(repo, 'ccd', 'history'))) {
      const from = path.join(repo, 'ccd', 'history', n);
      const to = path.join(tree, 'ccd', 'history', n);
      if (n === 'lib.mjs') copyFileSync(from, to); else symlinkSync(from, to);
    }
    symlinkSync(path.join(repo, 'shared'), path.join(tree, 'shared'));
    return tree;
  }

  /** runDriver's contract, for the driver copy in `tree`. */
  function t8Run(tree: string, home: string, args: string[], extraEnv: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [path.join(tree, 'deploy', 'history-replay.mjs'), ...args],
      { env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** A fresh --out path whose parent exists (Task 2 creates it). */
  const t8Out = (): string => path.join(mkTmp('ccrc-w2-t8-out-'), 'out');

  /** step0a's argv: every flag it requires, `over` replacing a value or (null) leaving the flag out. */
  function t8Argv(out: string, over: Record<string, string | null> = {}): string[] {
    const base: Record<string, string | null> = {
      out, account: 'up-a', budget: '100000', 'writer-model': T8_MODELS.writer, 'judge-model': T8_MODELS.judge,
      'arm-model': T8_MODELS.box, ...over,
    };
    return ['step0a', ...Object.entries(base).flatMap(([k, v]) => (v === null ? [] : [`--${k}`, v]))];
  }

  /** The stub's log lines for the batch's runs (print mode), by the model each was given. */
  function t8Runs(home: string): Array<Record<string, any>> {
    return (stubLog(home) ?? []).filter((e) => (e.argv as string[]).includes('-p'));
  }
  const t8ModelOf = (e: Record<string, any>): string => (e.argv as string[])[(e.argv as string[]).indexOf('--model') + 1]!;

  it('flagsAccepted: every flag the argvs carry, each true unless a run named it an unknown option', () => {
    const argvs = [['--restricted', '-p', '--tools', '', '--model', 'm1'], ['--restricted', '-p', '--tools', 'Bash,Agent', '--allowedTools', 'Bash(x:*)']];
    const ok = { unknownOptions: [] as string[] };
    expect(replay.flagsAccepted(argvs, [ok, ok])).toEqual({ '--restricted': true, '-p': true, '--tools': true, '--model': true, '--allowedTools': true });
    const named: Record<string, boolean> = replay.flagsAccepted(argvs, [ok, { unknownOptions: ['--allowedTools'] }]);
    expect(named['--allowedTools']).toBe(false);
    expect(Object.entries(named).filter(([, v]) => !v).map(([k]) => k)).toEqual(['--allowedTools']);
  });

  it('records the step 0a facts in step0a json under --out and prints the sha256 of its bytes, RP1-contract through the subcommand', async () => {
    const home = t8Home('ccrc-w2-t8-green-');
    const tree = t8Tree();
    const out = t8Out();
    // The caller's own session variables (all but TMUX_PANE, which refuses) must not reach a spawn.
    const r = t8Run(tree, home, t8Argv(out), T8_CALLER_ENV);
    expect(r.code, r.stderr).toBe(0);
    const file = path.join(out, replay.STEP0A_FILE);
    const bytes = readFileSync(file);
    expect(r.stdout).toBe(`sha256 ${sha256Hex(bytes)}\n`);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
    const rec = JSON.parse(text);
    expect(Object.keys(rec).sort()).toEqual(T8_STEP0A_KEYS);
    expect(rec).toMatchObject({ kind: 'ccrc-history-w2-step0a', v: 1, account: 'up-a', settings_mode: 'restricted', wrapper_sha256: null,
      release_stamp: T8_STAMP, budget: 100000, spend: 3 * T8_PER_RUN });
    expect(replay.STEP0A_KIND).toBe('ccrc-history-w2-step0a');
    expect(rec.code_shas).toEqual({
      'deploy/history-gate.mjs': sha256Hex(T8_GATE_BYTES),
      'deploy/measure-history.py': sha256Hex(T8_MEASURE_BYTES),
      'deploy/history-replay.mjs': sha256Hex(readFileSync(SCRIPT)),
      'ccd/history/lib.mjs': sha256Hex(readFileSync(path.join(path.dirname(SCRIPT), '..', 'ccd', 'history', 'lib.mjs'))),
    });
    const init = replay.readStreamJson(T8_STREAM).init;
    expect(init).not.toBeNull();
    expect([rec.writer_init, rec.judge_init, rec.box_init]).toEqual([init, init, init]);
    expect(typeof rec.measured_ms).toBe('number');
    expect(readdirSync(path.join(out, 'step0a')).filter((n) => n.endsWith('.jsonl')).sort()).toEqual(['box.jsonl', 'judge.jsonl', 'writer.jsonl']);

    // RP1-contract through the subcommand: one run per mode, each exactly the contract's argv for its model.
    const runs = t8Runs(home);
    expect(runs.map(t8ModelOf).sort()).toEqual([T8_MODELS.box, T8_MODELS.judge, T8_MODELS.writer]);
    const want = {
      writer: replay.spawnArgv({ mode: 'writer', model: T8_MODELS.writer, settingsMode: 'restricted', home }),
      judge: replay.spawnArgv({ mode: 'judge', model: T8_MODELS.judge, settingsMode: 'restricted', home }),
      box: replay.spawnArgv({ mode: 'box', model: T8_MODELS.box, settingsMode: 'restricted', home }),
    };
    for (const e of runs) {
      const key = (Object.keys(T8_MODELS) as Array<keyof typeof T8_MODELS>).find((k) => T8_MODELS[k] === t8ModelOf(e))!;
      const argv = e.argv as string[];
      expect(argv, key).toEqual(want[key]);
      expect(e.stdin, key).toBe(replay.STEP0A_PROMPT);
      expect(e.envKeys, key).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
      expect(argv.some((t) => /dangerously|bypassPermissions/.test(t)), key).toBe(false);
      if (key === 'box') {
        expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2)).toEqual(['--tools', 'Bash,Agent']);
        for (const s of replay.allowedToolSpellings(home)) expect(argv).toContain(s);
      } else {
        expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2), key).toEqual(['--tools', '']);
        expect(argv, key).not.toContain('--allowedTools');
      }
    }
    // Every flag the three argvs carry is recorded, and the stub rejected none.
    const flags = [...new Set(Object.values(want).flat().filter((t) => t.startsWith('-')))].sort();
    expect(Object.keys(rec.flags_accepted).sort()).toEqual(flags);
    expect(Object.values(rec.flags_accepted).every((v) => v === true)).toBe(true);
    expect(flags).toEqual(expect.arrayContaining(['--restricted', '--no-session-persistence', '--strict-mcp-config', '--verbose', '--max-turns', '--model', '--tools', '--allowedTools']));

    // The version is the one the launcher answers (measured last: it adds a line to the stub's log).
    const { json, roster } = replay.readRoster(home);
    const v = await replay.measureClaudeVersion(replay.admitAccount(json, roster, 'up-a', home), mkTmp('ccrc-w2-t8-version-'), undefined);
    expect(v).toEqual({ state: 'value', version: rec.claude_code_version });
    // Task 1's grammar cases use an unregistered name; this task pins its own registration (has, not the exact
    // key list, which Task 9 extends).
    expect(replay.HANDLERS.has('step0a'), 'step0a is registered').toBe(true);
  }, 120_000);

  it('the fallback settings mode is recorded, and its flags replace --restricted in flags_accepted', () => {
    const home = t8Home('ccrc-w2-t8-fallback-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { 'settings-mode': 'fallback' }));
    expect(r.code, r.stderr).toBe(0);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec.settings_mode).toBe('fallback');
    expect(rec.flags_accepted['--setting-sources']).toBe(true);
    expect(rec.flags_accepted['--settings']).toBe(true);
    expect(rec.flags_accepted).not.toHaveProperty('--restricted');
    for (const e of t8Runs(home)) expect((e.argv as string[]).slice(0, 4)).toEqual(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}']);
  }, 120_000);

  it('a generated account runs through its own wrapper, and step0a records that wrapper sha256', () => {
    const home = t8Home('ccrc-w2-t8-wrapper-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'gen-a' }));
    expect(r.code, r.stderr).toBe(0);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec.account).toBe('gen-a');
    expect(rec.wrapper_sha256).toBe(sha256Hex(readFileSync(path.join(home, '.local', 'bin', 'gen-a'))));
    const runs = t8Runs(home);
    expect(runs).toHaveLength(3);
    for (const e of runs) expect(e.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');   // by name only: the stub never logs its value
  }, 120_000);

  // RP3-admission and RP9 through the subcommand. gen-r's mode-000 file is readable to root, so as root its row is left out.
  // gen-u is not a row: a generated account with no declared provider reads as anthropic (the admission ruling, Task 3).
  const T8_REFUSED: Array<[string, string]> = ([
    ['cx-a', 'kind-codex'], ['ext-n', 'kind-external'], ['ext-a', 'kind-external'], ['gen-o', 'provider-openai'],
    ['gen-h', 'hidden'], ['gen-s', 'secrets-undeclared'], ['gen-m', 'secrets-absent'],
    ['gen-r', 'secrets-unreadable'], ['nobody-a', 'unknown-id'],
  ] as Array<[string, string]>).filter(([id]) => id !== 'gen-r' || process.getuid?.() !== 0);
  it.each(T8_REFUSED)('account %s is refused before any spawn: account-refused %s, no stub line, nothing under --out but its marker', (id, detail) => {
    const home = t8Home('ccrc-w2-t8-refused-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: id }));
    expect(stubLog(home), 'a spawn reached the stub').toBeNull();
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`ccrc history-replay: account-refused: ${detail}\n`);
    expect(readdirSync(out)).toEqual([replay.OUT_MARKER]);
  }, 60_000);

  it.each(['out', 'account', 'budget', 'writer-model', 'judge-model', 'arm-model'])('a missing --%s is refused args-invalid before any spawn', (flag) => {
    const home = t8Home('ccrc-w2-t8-required-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { [flag]: null }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`ccrc history-replay: args-invalid: ${flag}-required\n`);
    expect(stubLog(home)).toBeNull();
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    if (flag === 'out') expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('an empty HOME is refused args-invalid before --out is made, as the probe refuses it', () => {
    const home = t8Home('ccrc-w2-t8-home-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out), { HOME: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: HOME is unset or not absolute\n');
    expect(existsSync(out)).toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('a settings mode outside SETTINGS_MODES is refused args-invalid before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-settings-');
    const r = t8Run(t8Tree(), home, t8Argv(t8Out(), { 'settings-mode': 'open' }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: settings-mode open\n');
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('an unmeasured code sha refuses code-unmeasured, and an untagged stamp tree-unmeasured, before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-unmeasured-');
    const noGate = t8Run(t8Tree({ gate: false }), home, t8Argv(t8Out()));
    expect(noGate.code).toBe(2);
    expect(noGate.stderr).toBe('ccrc history-replay: code-unmeasured: deploy/history-gate.mjs is absent\n');
    writeFileSync(path.join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', dirty: false }));
    const untagged = t8Run(t8Tree(), home, t8Argv(t8Out()));
    expect(untagged.code).toBe(2);
    expect(untagged.stderr).toBe('ccrc history-replay: tree-unmeasured: stamp untagged\n');
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('a generated account whose wrapper cannot be read stops step0a with wrapper-unmeasured before any spawn or spend (coordinator ruling)', () => {
    const home = t8Home('ccrc-w2-t8-wrapper-unread-');
    const wrapper = path.join(home, '.local', 'bin', 'gen-a');
    rmSync(wrapper);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'gen-a' }));
    expect(stubLog(home), 'a spawn reached the stub').toBeNull();
    expect(r.code).toBe(2);
    expect(readdirSync(out), 'no spawn and no spend: nothing under --out but its marker').toEqual([replay.OUT_MARKER]);
    expect(r.stderr).toBe(`ccrc history-replay: wrapper-unmeasured: ${wrapper}: ENOENT\n`);
  }, 60_000);

  it('a budget the first run exhausts stops before the second, and a larger budget resumes without re-spawning the first', () => {
    const home = t8Home('ccrc-w2-t8-budget-');
    const tree = t8Tree();
    const out = t8Out();
    const stopped = t8Run(tree, home, t8Argv(out, { budget: String(T8_PER_RUN) }));
    expect(stopped.code).toBe(2);
    expect(stopped.stderr.startsWith('ccrc history-replay: budget-exhausted: ')).toBe(true);
    expect(t8Runs(home).map(t8ModelOf)).toEqual([T8_MODELS.writer]);
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    const resumed = t8Run(tree, home, t8Argv(out, { budget: String(10 * T8_PER_RUN) }));
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(t8Runs(home).map(t8ModelOf)).toEqual([T8_MODELS.writer, T8_MODELS.judge, T8_MODELS.box]);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec).toMatchObject({ budget: 10 * T8_PER_RUN, spend: 3 * T8_PER_RUN });
    expect(rec.writer_init).toEqual(replay.readStreamJson(T8_STREAM).init);
  }, 120_000);

  it('a limits row at the threshold stops before any spawn, the version spawn included', () => {
    const home = t8Home('ccrc-w2-t8-limits-');
    t8Limits(home, 'up-a', 70, 20);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code).toBe(2);
    expect(r.stderr.startsWith('ccrc history-replay: limits-threshold: ')).toBe(true);
    expect(stubLog(home)).toBeNull();
    expect(readdirSync(out)).toEqual([replay.OUT_MARKER]);
  }, 60_000);

  it('a launcher whose version cannot be measured stops step0a before its batch, refusing version-unmeasured, recording nothing', () => {
    const home = t8Home('ccrc-w2-t8-version-');
    chmodSync(path.join(home, '.local', 'bin', 'up-a'), 0o644);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/^ccrc history-replay: version-unmeasured: \S+ --version failed \(code [^\n]*\)\n$/);
    expect(existsSync(path.join(out, 'step0a'))).toBe(false);
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);
});
```

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 8')
```

Expected: red, `26 failed` (`25 failed` as root, where gen-r's row is left out; predicted: measured as `25`/`24` against stand-ins for Tasks 1 to 7 before the coordinator's wrapper ruling added the unreadable-wrapper case). The integration edits kept the count (the `gen-u` refusal row left, the empty-HOME case came in) but its make-up is predicted. The filter selects this describe alone.
- `flagsAccepted` fails with `TypeError: flagsAccepted is not a function`.
- Every subcommand case meets Task 1's unknown-subcommand refusal, `ccrc history-replay: args-invalid: unknown subcommand "step0a"` (predicted: the stand-in printed another detail; the word and exit 2 were measured):
  - the green cases read `expected 2 to be +0`;
  - the refusal, required-flag and settings-mode cases read `expected 'ccrc history-replay: args-invalid: su…' to be 'ccrc history-replay: account-refused:…'` (or `…: args-invalid: <flag>-required`);
  - the version case reads `expected 'ccrc history-replay: args-invalid: un…' to match /^ccrc history-replay: version-unmeasured: …/` (predicted: before the `version-unmeasured` ruling it read `expected 2 to be 1`, measured);
  - the unreadable-wrapper case reads `ENOENT: no such file or directory, scandir '<out>'`, because the unknown subcommand never makes `--out` (predicted).

- [ ] **Step 4: Write the subcommand.**

In `deploy/history-replay.mjs`:
1. Confirm the import block names from **Files** (`grep -n "^import" deploy/history-replay.mjs`), and add the missing ones as described there.
2. Insert the section below directly above the entry guard. Check that the anchor is unique: `grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs` must print 1.

```js
// ── W2-4 Task 8: step 0a, end to end (W2-D57, W2-D55, W2-D24, W2-D52, W2-D51) ──────────────────────────────────
// `step0a` runs once per named node before pilot sourcing (W2 decisions §5, act 7). It spends, so it takes every
// refusal before its first spawn: the pane and the arguments (main), --out (Task 2), the account (Task 3), then the
// required --budget (W2-D55: no default before part 1), the three model ids, and the settings mode. It then
// measures what it records but never compares: codeShas() over the tree it runs from and the installed release
// stamp (W2-D24; part 1's validator compares them with gate_code). Neither has an "unmeasured" spelling in the
// record, so an unmeasured one refuses here, with the preflight's own word (Task 7's rule): code-unmeasured
// or tree-unmeasured (coordinator rulings), its detail saying what could not be read. The wrapper sha is taken next,
// before any spawn or spend, so a wrapper that cannot be read refuses wrapper-unmeasured here (Task 7's wrapperSha;
// coordinator ruling). Then the limits and budget gate, the launcher's --version
// (a spawn that spends nothing, gated all the same), and one batch of three runs on one prompt, one at a time so
// the budget gate sees each finished run's spend before the next starts: the writer and the judge (--tools "")
// and one box-mode run (--tools Bash,Agent and the three spellings), so every flag the contract uses reaches the
// launcher once. A finished run is skipped on a re-run over the same --out (Task 5's run.json), and its facts are
// re-read from its stream file. A run that fails or rejects a flag is a finding, recorded, not a refusal.
// The record is canonicalJson + '\n' at <out>/step0a.json, written whole (tmp, then rename), and its sha256 is
// printed over the bytes read back from that file, the bytes the operator hands pilot-source as --step0a-sha256.
// STEP0A_KIND and STEP0A_FIELDS are Task 7's (loadStep0a reads them first); this section never declares them again.
// HOME and LANG come from main's env parameter only, LANG threaded into each RunJob and into the --version spawn.
export const STEP0A_FILE = 'step0a.json';
export const STEP0A_PROMPT = 'Reply with the single word: ready. Do not use any tool.';
const STEP0A_RUNS = Object.freeze([
  Object.freeze({ key: 'writer', mode: 'writer', modelFlag: 'writer-model' }),
  Object.freeze({ key: 'judge', mode: 'judge', modelFlag: 'judge-model' }),
  Object.freeze({ key: 'box', mode: 'box', modelFlag: 'arm-model' }),
]);

/** A flag's value, or args-invalid '<flag>-required'. */
function requireFlag(flags, name) {
  if (flags[name] === undefined) refuse('args-invalid', `${name}-required`);
  return flags[name];
}

/** Every flag the runs' argvs carry (a token that starts with '-'; no contract value does), each true unless a
 *  run reported it as an unknown option. Pure.
 *  @param {ReadonlyArray<readonly string[]>} argvs
 *  @param {ReadonlyArray<{ unknownOptions: readonly string[] }>} outcomes
 *  @returns {Record<string, boolean>} */
export function flagsAccepted(argvs, outcomes) {
  const unknown = new Set(outcomes.flatMap((o) => o.unknownOptions));
  const out = {};
  for (const argv of argvs) for (const t of argv) if (t.startsWith('-')) out[t] = !unknown.has(t);
  return out;
}

export async function step0aCommand(flags, env) {
  const home = env.HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) refuse('args-invalid', 'HOME is unset or not absolute');
  const out = prepareOut(requireFlag(flags, 'out'));
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, requireFlag(flags, 'account'), home);
  const budget = requireFlag(flags, 'budget');
  const models = Object.fromEntries(STEP0A_RUNS.map((r) => [r.key, requireFlag(flags, r.modelFlag)]));
  const settingsMode = flags['settings-mode'] ?? 'restricted';
  if (!SETTINGS_MODES.includes(settingsMode)) refuse('args-invalid', `settings-mode ${settingsMode}`);
  const shas = codeShas();
  if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);
  const stamp = readReleaseStamp(home);
  if (stamp.state !== 'value') refuse('tree-unmeasured', `stamp ${stamp.state}${stamp.code === undefined ? '' : ` ${stamp.code}`}`);
  // Before any spawn or spend: an unreadable wrapper refuses wrapper-unmeasured here, never after the batch has spent.
  const wrapperSha256 = wrapperSha(launch);
  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits: LIMITS_DEFAULTS });
  gate();
  const version = await measureClaudeVersion(launch, out, env.LANG);
  // A --version that cannot be measured is a refusal (coordinator ruling), never a guessed or recorded version.
  if (version.state !== 'value') refuse('version-unmeasured', `${launch.launcher} --version failed (code ${version.code}, signal ${version.signal})`);
  const dir = path.join(out, 'step0a');
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
  const jobs = STEP0A_RUNS.map((r) => ({
    launch, mode: r.mode, model: models[r.key], settingsMode, stdin: STEP0A_PROMPT, out, name: `step0a/${r.key}`, lang: env.LANG,
  }));
  const outcomes = await runBatch(jobs, { concurrency: 1, gate });
  const init = Object.fromEntries(jobs.map((j, i) => [
    STEP0A_RUNS[i].key, readStreamJson(readFileSync(path.join(out, `${j.name}.jsonl`), 'utf8')).init,
  ]));
  const output = {
    kind: STEP0A_KIND, v: 1, measured_ms: Date.now(), account: launch.accountId, settings_mode: settingsMode,
    claude_code_version: version.version, wrapper_sha256: wrapperSha256,
    flags_accepted: flagsAccepted(jobs.map((j) => spawnArgv({ mode: j.mode, model: j.model, settingsMode, home })), outcomes),
    writer_init: init.writer, judge_init: init.judge, box_init: init.box,
    code_shas: shas.files, release_stamp: stamp.tag, budget, spend: spentSoFar(out),
  };
  const file = path.join(out, STEP0A_FILE);
  writeFileSync(`${file}.tmp`, canonicalJson(output) + '\n', { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  process.stdout.write(`sha256 ${sha256Hex(readFileSync(file))}\n`);
  return EXIT.OK;
}
HANDLERS.set('step0a', step0aCommand);
```

The section spells no arm word and no switch file, and never `redactDisplayWindow` or the credentials file name. It reads no `process.env` (only the `env` parameter's `HOME` and `LANG`), and none of its lines names `recall-off`. Task 1's, Task 4's and Task 5's scans and O13's writer scan therefore stay green. The section declares `STEP0A_FILE`, `STEP0A_PROMPT` and `STEP0A_RUNS`, none of which is an O14 `VOCABS` name; `STEP0A_KIND` is Task 7's and is never declared a second time (a second `export const` of it would fail the module's load).

- [ ] **Step 5: Run them and see them pass, then the typecheck.**

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 8')
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- `26 passed` (`25` as root), in about 4 s (predicted: measured as `25`/`24` against stand-ins for Tasks 1 to 7, before the integration edits swapped the `gen-u` refusal row for the empty-HOME case, which kept the count, and before the coordinator's wrapper ruling added the unreadable-wrapper case).
- tsc prints no line naming `history-replay`. Measured: before `flagsAccepted` carried its JSDoc `@returns {Record<string, boolean>}`, the test's `named['--allowedTools']` read was `TS7053` on an inferred `{}`. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant applies one exact replacement (M14 two), each asserted to match once, from a table in a quoted heredoc. It runs one filter, which must show red, and then the file is restored with `cp`. Every filter selects at least one case.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
cp deploy/history-replay.mjs "$SCRATCH/replay.orig"
cat > "$SCRATCH/t8mut.py" <<'EOF'
# t8mut.py <id>: applies one W2-4 Task 8 mutant to deploy/history-replay.mjs (exact replacements, each asserted once).
import sys
MUTANTS = {
    'M1': (r"""  const launch = admitAccount(json, roster, requireFlag(flags, 'account'), home);""",
           r"""  let launch; try { launch = admitAccount(json, roster, requireFlag(flags, 'account'), home); } catch (e) { if (!(e instanceof DriverRefusal) || e.word !== 'account-refused') throw e; const a = roster.accounts.find((x) => x.id === flags.account); launch = { accountId: flags.account, kind: a.execKind, launcher: path.join(home, '.local', 'bin', flags.account), configDir: path.join(home, a.configDirSuffix), wrapperPath: null, secretsPath: null }; }"""),
    'M2': (r"""  const budget = requireFlag(flags, 'budget');""",
           r"""  const budget = flags.budget ?? Number.MAX_SAFE_INTEGER;"""),
    'M3': (r"""  process.stdout.write(`sha256 ${sha256Hex(readFileSync(file))}\n`);""",
           r"""  process.stdout.write(`sha256 ${sha256Hex(canonicalJson(output))}\n`);"""),
    'M4': ("  gate();\n  const version = await measureClaudeVersion(launch, out, env.LANG);",
           "  const version = await measureClaudeVersion(launch, out, env.LANG);"),
    'M5': (r"""{ concurrency: 1, gate }""", r"""{ concurrency: 2, gate }"""),
    'M6': (r"""  if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);""" + "\n", ""),
    'M7': (r"""  if (stamp.state !== 'value') refuse('tree-unmeasured', `stamp ${stamp.state}${stamp.code === undefined ? '' : ` ${stamp.code}`}`);""" + "\n", ""),
    'M8': (r"""out[t] = !unknown.has(t);""", r"""out[t] = true;"""),
    'M9': (r"""  if (version.state !== 'value') refuse('version-unmeasured', `${launch.launcher} --version failed (code ${version.code}, signal ${version.signal})`);""",
           r"""  if (version.state !== 'value') version.version = '';"""),
    'M10': (r"""  if (!SETTINGS_MODES.includes(settingsMode)) refuse('args-invalid', `settings-mode ${settingsMode}`);""" + "\n", ""),
    'M11': (r"""[r.key, requireFlag(flags, r.modelFlag)]""", r"""[r.key, flags[r.modelFlag]]"""),
    'M12': ("  const home = env.HOME;\n  if (typeof home !== 'string' || !path.isAbsolute(home)) refuse('args-invalid', 'HOME is unset or not absolute');\n  const out = prepareOut(",
            "  const home = env.HOME;\n  const out = prepareOut("),
    'M13': (r"""refuse('tree-unmeasured', `stamp""", r"""refuse('tree-moved', `stamp"""),
    # M14 (coordinator ruling): the wrapper sha taken back after runBatch, as an earlier draft had it.
    'M14': [("  const wrapperSha256 = wrapperSha(launch);\n", ""),
            (r"""wrapper_sha256: wrapperSha256,""", r"""wrapper_sha256: wrapperSha(launch),""")],
}
p = 'deploy/history-replay.mjs'
mut = MUTANTS[sys.argv[1]]
s = open(p).read()
for old, new in (mut if isinstance(mut, list) else [mut]):
    assert s.count(old) == 1, (sys.argv[1], old[:60], s.count(old))
    s = s.replace(old, new)
open(p, 'w').write(s)
EOF
t8mut() {   # t8mut <id> <filter>: apply one mutant, run its filter, restore
  python3 "$SCRATCH/t8mut.py" "$1" || return 1
  (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$2")
  cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
}
t8mut M1 'is refused before any spawn: account-refused'
t8mut M2 'a missing --budget'
t8mut M3 'prints the sha256 of its bytes'
t8mut M4 'the version spawn included'
t8mut M5 'stops before the second'
t8mut M6 'an unmeasured code sha refuses'
t8mut M7 'an unmeasured code sha refuses'
t8mut M8 'flagsAccepted: every flag'
t8mut M9 'cannot be measured stops step0a'
t8mut M10 'outside SETTINGS_MODES'
t8mut M11 'a missing --writer-model|a missing --judge-model|a missing --arm-model'
t8mut M12 'an empty HOME is refused'
t8mut M13 'an unmeasured code sha refuses'
t8mut M14 'whose wrapper cannot be read stops step0a'
cmp "$SCRATCH/replay.orig" deploy/history-replay.mjs && echo restored
```

Expected: each run is red, and the last line prints `restored`. All measured against stand-ins for Tasks 1 to 7; an exact message from a task's own code is marked predicted.
- **M1** (the admission refusal is caught and the account launched anyway, so the spawn comes before any check that stops it): `9 failed` (`8` as root), predicted (measured as `10`/`9` while `gen-u` was a refused row; the admission ruling removed it). Eight read `a spawn reached the stub: expected [ … ] to be null`, and `nobody-a` reads `expected 1 to be 2`.
- **M2** (a missing `--budget` is accepted with no ceiling): `1 failed`, `expected +0 to be 2`.
- **M3** (the sha is printed over `canonicalJson(output)`, not over the file's bytes): `1 failed`, `expected 'sha256 <hex>' to be 'sha256 <other hex>'`. The file ends in `'\n'`, so the two always differ.
- **M4** (the gate runs only inside the batch): `1 failed`, `expected [ { argv: [ '--version' ], … } ] to be null`.
- **M5** (`concurrency: 2`): `1 failed`, `expected [ 'fixture-model-writer', …(1) ] to deeply equal [ 'fixture-model-writer' ]`. Two runs start before the gate sees the first run's spend.
- **M6** (an unmeasured code sha is not refused) and **M7** (an untagged stamp is not refused): `1 failed` each, `expected +0 to be 2` (M6's anchor is predicted after the `code-unmeasured` ruling, and M7's after the `tree-unmeasured` ruling; each red is the same exit code).
- **M8** (`flagsAccepted` ignores `unknownOptions`): `1 failed`, `expected true to be false`.
- **M9** (a failed `--version` is recorded as `''`): `1 failed` (predicted: the case now pins exit 2 first, so the message is the exit code's, not the measured `expected true to be false` it read when the case pinned exit 1; the batch starts and the run never refuses `version-unmeasured`).
- **M10** (no settings-mode check): `1 failed`, `expected 1 to be 2`. The stand-in `spawnArgv` throws a `TypeError` on the unknown mode, and `main` answers `EXIT.INTERNAL`. This message is predicted for Task 5's own answer, but any answer other than exit 2 with that line is red.
- **M11** (the model ids are not required): `3 failed`, each `expected 1 to be 2`.
- **M12** (no HOME check, added in integration so `step0a` refuses an unusable HOME as the probe does): `1 failed` (predicted). The driver goes on to create `--out` and then refuses `roster-invalid`, so the stderr line and `existsSync(out)` both differ.
- **M13** (coordinator ruling: an untagged stamp folded back into `tree-moved`): `1 failed` (predicted), `expected 'ccrc history-replay: tree-moved: stamp untagged\n' to be 'ccrc history-replay: tree-unmeasured: stamp untagged\n'`.
- **M14** (coordinator ruling: the wrapper sha taken after `runBatch` again): `1 failed` (predicted), `no spawn and no spend: nothing under --out but its marker`. The gate passes and the `--version` spawn starts, so `<out>/poison-bin` sits beside the marker; the spawn of the missing launcher fails, and the run refuses `version-unmeasured` instead of `wrapper-unmeasured`.

Then run Step 5's commands once more: green.

- [ ] **Step 7: Run the neighbours that read this file.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'O13|O14')
```

Expected:
- `history-replay.test.ts` is green as a whole: Tasks 1 to 7's cases plus this task's 26 (predicted). That includes Task 1's `node:sqlite` scan, Task 4's `redactDisplayWindow` scan and Task 5's env-read scan, each over the file as it now stands.
- `single-definition -t 'O13|O14'`: green. Measured as `89 passed` with a stand-in driver in `deploy/`; the count on this plan's tree is predicted. O13's `ALL_MJS` finds no switch spelling and no recall-off writer in the new section. O14's `DECL_CORPUS` finds no `VOCABS` name declared in it.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 8 — step 0a, end to end" -m "$CO_AUTHORED_BY"
```

### Task 9: The probe and step 0b's mechanics

Tasks 1 to 8 give the driver its words, its `--out`, admission, the spawn contract, the gate, the preflights and `step0a`. This task adds the last two things W2-4 ships (W2 decisions document §2, "W2-4 … Ships"):
- **The `probe` subcommand** (W2-D58): a box verb that needs no identity, an early check only. It runs the same entry order as `step0a` (the pane refusal and `parseArgs` in `main`, then `--out`, admission, the required `--budget`, and the gate before every spawn), then one box-mode spawn per taught spelling. Each spawn asks the model to run that spelling with `history status --json`. It records per spelling what the stream shows, writes `<out>/probe.json`, prints `sha256 <hex>`, and **exits 0 whatever it found**: a finding is data, and only a driver word is non-zero. The treatment-arm pilot assertions (the skill and card, the denied `…; cat`, `$(…)` and `rg` shapes, the init's tools) are W2-5b's, at step 0b.
- **Step 0b's two seam-free mechanics** (W2-D57), as exports W2-5b wires into its `step0b` subcommand after part 1:
  - the **turn bound**: a request for twenty separate calls of an allowed spelling, `~/.local/bin/ccrc history status --json` (the third taught spelling, so the calls are admitted and the model keeps going), must be stopped by the `--max-turns` limit within `MAX_TURNS` (12) assistant turns. By coordinator ruling `held` is `true` only when the result event shows that the max-turns limit stopped the run (`result.subtype === 'error_max_turns'`) AND the run made at most 12 assistant turns; a run past 12 assistant turns is `false`; a run that ended within the bound for any other reason is `'unmeasured'`, never `true`;
  - the **persistence check**: no transcript named by the init event's `session_id` anywhere under `<configDir>/projects/`, and no `<configDir>/projects/<slug of the run's cwd>` entry, where the slug replaces every non-alphanumeric character with `-`.

The probe spends, so it takes the required `--budget` and the limits and budget gate (W2-D55). `step0bMechanics` spawns one run through `runBatch` with a required `gate`: W2-5b's subcommand passes its own `batchGate`, so this spawn is gated like every other, and a caller that passes none gets `runBatch`'s `TypeError` before any spawn.

**Files:**
- Modify: `deploy/history-replay.mjs`. Append one section directly after Task 8's section, above the entry guard (the guard stays the file's last block). Its last statement before the next function is `HANDLERS.set('probe', probeCommand);`. It adds no import line: every name it uses is already imported by Tasks 1 to 7. Step 1 checks that the `node:fs` import names `lstatSync`, `readdirSync`, `readFileSync`, `renameSync` and `writeFileSync`. If one is missing, it is added to that same import statement, never as a second import of `node:fs`.
- Modify: `server/test/history-replay.test.ts`:
  - one import block directly after the last task's import block at the top of the file (Task 8's), with every name prefixed `t9`;
  - three module-level helpers (`t9Stream`, `t9Launch`, `t9PlantPersistingStub`) and two `describe`s, appended at the end of the file.
- Not edited: every other file. The spec's step 0b and probe sentences need no erratum (W2-D57 and W2-D58 are build decisions with no D-number), and W2-5b owns the `step0b` subcommand.

**Interfaces:**
- Consumes (Tasks 1 to 8, `deploy/history-replay.mjs`):
  - Task 1: `refuse(word, detail): never`, `DriverRefusal`, `HANDLERS: Map<string, (flags, env) => Promise<number>>`, and `FLAG_SPECS` with `out`, `account`, `budget` (`'int'`), `arm-model` and `settings-mode`. `main` runs `paneRefusal`, then `process.umask(0o077)`, then `parseArgs`, then the handler, and prints a `DriverRefusal` as `ccrc history-replay: <word>: <detail>` with `EXIT.REFUSED` (2). `EXIT` is imported from lib.
  - Task 2: `prepareOut(out: string, uid?: number): string`, which answers the `--out` realpath.
  - Task 3: `readRoster(home): {json, roster}` and `admitAccount(json, roster, id, home): LaunchSpec`, with `LaunchSpec = {accountId, kind, launcher, configDir, wrapperPath, secretsPath}`. A refusal is `account-refused`.
  - Task 4: `readStreamJson(text): StreamFacts`. This task reads `init.sessionId`, `toolPairs[].{id, name, input, isError}`, `permissionDenials`, `result.subtype`, `result.numTurns` and `assistantMessages`. Every message id in this task's fixtures is distinct, so the count is the same whether Task 4 counts events or distinct `message.id`s. Also `spentSoFar(out): number`.
  - Task 5: `SETTINGS_MODES`, `MAX_TURNS = 12`, `CONCURRENCY_MAX = 2`, `allowedToolSpellings(home)` (the three spellings, in the order absolute, `"$HOME/…"`, `~/…`) and `spawnArgv({mode, model, settingsMode, home})`. `RunJob`'s `lang` key is required: the probe's jobs carry `env.LANG`, and `step0bMechanics` passes the `lang` it is given. Also `launchRun(job): Promise<RunOutcome>`, which writes `<out>/<name>.jsonl` and `<out>/<name>.run.json`, creates the name's parent directory under `--out`, and for a job whose `run.json` exists answers the recorded outcome, `cwd` and `facts` included. And `runBatch(jobs, {concurrency, gate}): Promise<RunOutcome[]>`, whose outcomes come in job order and whose gate is called before each spawn. A run name may hold one `/` (`probe/spelling-1`, `step0b/turn-bound`).
  - Task 6: `LIMITS_DEFAULTS` and `batchGate({out, home, accountId, budget, limits}): () => void`.
  - lib: `EXIT`, `canonicalJson`, `sha256Hex`.
- Consumes (the test file): Task 1's `runDriver(home, args, extraEnv?)` and the `mkTmp` import; Task 3's `writeRoster(home, accounts: object[])`, which writes `$HOME/.ccrc/accounts.json` as `{version: 1, accounts}`; Task 5's `plantStub(home, id)`, `stubLog(home): object[] | null` and `STUB_STREAM`, the basename (`'stub-stream.jsonl'`) of the file under `$HOME` that the stub prints. Each `stubLog` entry carries `argv: string[]`, `envKeys: string[]` (the child's env key names) and `stdin: string`. If Task 5 spells any of these differently, the worker uses Task 5's spelling here and says so in the PR body.
- Produces (`deploy/history-replay.mjs`, exported):
  - `PROBE_KIND = 'ccrc-history-w2-probe'`;
  - `probeCommand(flags, env): Promise<number>`, registered as `HANDLERS.set('probe', probeCommand)`;
  - `ProbeOutput = {kind: PROBE_KIND, v: 1, measured_ms: number, account: string, settings_mode: string, model: string, spellings: Array<{spelling: string, denied: boolean, tool_error: boolean | null, ran: boolean, result_seen: boolean}>, budget: number, spend: number}`, written as `canonicalJson(output) + '\n'` to `<out>/probe.json`. Its streams are `<out>/probe/spelling-<1..3>.jsonl`.
  - `TURN_PROBE_PROMPT: string`, which asks for twenty separate Bash calls of exactly `~/.local/bin/ccrc history status --json`, a command the third taught spelling admits, so the model is driven through repeated allowed calls rather than denials;
  - `MAX_TURNS_STOP_SUBTYPE = 'error_max_turns'`: the result event's `subtype` when the `--max-turns` limit stopped the run (**I**: Claude Code's headless spelling, unmeasured on this fleet until step 0b's turn-bound run first reaches the bound; the field name `subtype` is the one Task 4 already reads);
  - `turnBoundHeld(facts: StreamFacts, maxTurns: number = MAX_TURNS): {held: true | false | 'unmeasured', turns: number, num_turns: number | null, subtype: string | null}`. `turns` is the assistant turn count (`facts.assistantMessages`); `num_turns` and `subtype` are the result event's (null without one), recorded so a reader sees why. `held` is `true` only when `subtype === MAX_TURNS_STOP_SUBTYPE` and `turns <= maxTurns`; `false` when `turns > maxTurns`, whatever the result event says; `'unmeasured'` otherwise (another subtype, or no result event, within the bound). No tool-call count enters the verdict;
  - `projectSlugOf(cwd: string): string` (absolute cwd only; `TypeError` otherwise);
  - `persistenceLeft({configDir, sessionId, cwd}: {configDir: string, sessionId: string | null, cwd: string}): {left: boolean, transcripts: string[], projectDir: boolean}`. `transcripts` are paths relative to `<configDir>/projects`, sorted.
  - `step0bMechanics({launch, out, model, settingsMode, lang, gate}): Promise<{turn_bound: {held: true | false | 'unmeasured', turns: number, num_turns: number | null, subtype: string | null}, persistence: {left: boolean, transcripts: string[], project_dir: boolean}}>`, with one box-mode run named `'step0b/turn-bound'`. `lang` is the caller's `LANG` from `main`'s `env` (W2-5b's subcommand passes `env.LANG`), threaded into the `RunJob`. `gate` is required and goes to `runBatch` (W2-5b passes its `batchGate`).
- Module-private: `PROBE_FLAGS`, `PROBE_REQUIRED`, `PROBE_RUN_DIR`, `PROBE_OUTPUT`, `STEP0B_TURN_RUN`, `TAUGHT_SPELLING`, `probeCommandOf`, `probePromptOf`, `bashCommandOf`, `probeFindingOf`, `writeProbeJson` and `entriesNamedBy`. None is an O14 `VOCABS` name.

**Spec:** §10.2 "Two arms" (`:2658`), its Flags (`--no-session-persistence`, `--max-turns 12`) and Tools (the three taught spellings, and "the pilot … asserts from stream-json that each taught spelling is admitted"). The probe is W2-D58's early check, not that pilot. Decisions: W2-D58, W2-D57 (step 0b's turn-bound and `--no-session-persistence` mechanics, without the seam; the arm init assertions stay W2-5b's), W2-D55 (the probe spends, so the required `--budget` and the gate) and W2-D50 (the box env carries no `CCRC_RECALL_*`). D-numbers: none defined here.

**Choices this task makes:**
- **One spawn per spelling, keyed by the command, not by the run.** Each run's stdin names exactly one command: the spelling's prefix (the text between `Bash(` and ` history:*)`) plus `history status --json`. A finding reads only the Bash calls whose `input.command` equals that command. A permission denial counts for it when its `tool_use_id` names one of those calls or its `tool_input.command` equals the command. So a stream that shows other commands, or another spelling's denial, never moves this spelling's finding.
- **`result_seen` is added to each spelling's record**, beyond the brief's `ProbeOutput`. `permission_denials` lives on the result event, so without one `denied: false` measured nothing. Recording that apart keeps "not denied" and "unmeasured" from collapsing to one value (CLAUDE.md, no overloaded null). `tool_error` is `null` when no tool_result for the command came back.
- **A flag the probe never reads is refused** (`args-invalid`, `--<flag> is not a probe flag`), not ignored. `parseArgs` knows every driver flag, so `--writer-model` would otherwise pass silently. `--out`, `--account` and `--arm-model` are required (`<flag>-required`); `--budget` is checked after admission, as `step0a` checks it (`budget-required`). `--settings-mode` defaults to `restricted`.
- **No explicit gate call before the batch.** `runBatch` calls the gate before each spawn, and a job whose `run.json` exists needs no gate. A re-run of a finished probe therefore re-reads its streams and re-prints without spending, and is not refused for a budget it no longer needs.
- **`spend` is the ledger's cumulative total under `--out`** (`spentSoFar`), the figure the budget is checked against, as W2-D55 defines it. A probe sharing `--out` with `step0a` therefore reports both subcommands' spend.
- **The turn bound is held only when the limit stopped the run (coordinator ruling, as revised).** `held` is `true` only when the result event shows that the `--max-turns` limit stopped the run (`subtype` `error_max_turns`, `MAX_TURNS_STOP_SUBTYPE`) and the run made at most `maxTurns` assistant turns (`assistantMessages`, distinct message ids). More than `maxTurns` assistant turns is `false`: the bound did not hold, whatever the result event says, and with no result event too. A run that ended within the bound for any other reason (`success`, another error subtype, or no result event) is `'unmeasured'`, never `true`: the bound never bit. `num_turns` is recorded, not decided on: the ruling counts assistant turns, and the value Claude Code reports at a max-turns stop is unmeasured here. No tool-call count enters the verdict, so a model that makes its calls one per message, as the prompt asks, can hold. **The spelling:** the field is `subtype` on the `type: 'result'` event, the one Task 4's reader reads (`result.subtype`); step 0a's and the probe's streams under `--out` keep their raw result events and show that field (`success`). The value `error_max_turns` is Claude Code's headless spelling for this stop (**I**, unmeasured on this fleet): step 0b's turn-bound run is the first run that reaches the bound, and its `turn_bound` record carries the `subtype` it read, so that run measures the spelling. A different spelling there reads `'unmeasured'`, the safe direction, and W2-5b stops for a ruling rather than recording a pass. The prompt asks for twenty calls of `~/.local/bin/ccrc history status --json`, admitted by the third taught spelling, so the model is driven by repeated allowed calls and not stopped by denials.
- **A null session id never reads as clean.** Without the init event's `session_id`, the transcript half cannot be measured, so `left` is true. An `lstat` or `readdir` failure other than `ENOENT` throws (exit 1 through `main`), never reads as "nothing left". The walk never follows a link (`Dirent.isDirectory()` is false for one).
- **`step0bMechanics` runs its one job through `runBatch`** (`concurrency: 1`, the caller's required `gate`) with the fixed name `step0b/turn-bound`, so the spawn is gated and a missing gate is a `TypeError` before it (M12). A finished run is answered from its `run.json` (Task 5's resume) without the gate, and the persistence check re-measures the config dir with the recorded `cwd`. A resumed finished run is never spawned again, so it records no second spend line.
- **The test persisting stub is Task 9's own** (`t9PlantPersistingStub`). Task 5's stub records and prints; this one also writes the transcript a `--no-session-persistence` run must not leave, under the slug of its own `process.cwd()`. That is the realpath `makeRunCwd` made, which is the `cwd` `launchRun` records.

- [ ] **Step 1: Confirm Tasks 1 to 8's names before using them.** From the repository root:

```bash
grep -c "^export async function step0aCommand(" deploy/history-replay.mjs
grep -c "^HANDLERS.set('step0a', step0aCommand);" deploy/history-replay.mjs
grep -cE "^export (async )?function (prepareOut|readRoster|admitAccount|readStreamJson|spentSoFar|allowedToolSpellings|spawnArgv|launchRun|runBatch|batchGate)\(" deploy/history-replay.mjs
grep -cE "^export const (SETTINGS_MODES|MAX_TURNS|CONCURRENCY_MAX|LIMITS_DEFAULTS) = " deploy/history-replay.mjs
node --input-type=module -e "import { readFileSync } from 'node:fs'; const m = /import\\s*\\{([^}]*)\\}\\s*from 'node:fs'/.exec(readFileSync('deploy/history-replay.mjs', 'utf8')); const have = m ? m[1].split(',').map((s) => s.trim().split(/\\s+as\\s+/)[0]) : []; console.log(['lstatSync', 'readdirSync', 'readFileSync', 'renameSync', 'writeFileSync'].filter((n) => !have.includes(n)).join(',') || 'none missing')"
grep -nE "^import .*(canonicalJson|sha256Hex).* from '../ccd/history/lib.mjs';" deploy/history-replay.mjs
grep -cE "(function|const) (runDriver|writeRoster|plantStub|stubLog|STUB_STREAM)\b" server/test/history-replay.test.ts
grep -c "envKeys" server/test/history-replay.test.ts
grep -cE "PROBE_KIND|MAX_TURNS_STOP_SUBTYPE|turnBoundHeld|persistenceLeft|step0bMechanics|projectSlugOf|TURN_PROBE_PROMPT" deploy/history-replay.mjs server/test/history-replay.test.ts
node --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(d.MAX_TURNS, d.CONCURRENCY_MAX, d.SETTINGS_MODES.join(','), d.allowedToolSpellings('/h').length, [...d.HANDLERS.keys()].join(','))"
```

Expected:
- 1, then 1, then 10 and 4;
- `none missing` for the `node:fs` import (otherwise it prints the missing names: add each to that one import statement), and the lib import line names `canonicalJson` and `sha256Hex`;
- the test file: 5, then a positive count (Task 5's stub log records `envKeys`);
- 0 for each of the two files: no Task 9 name exists yet;
- the last line prints `12 2 restricted,fallback 3 step0a`. Importing the module runs no subcommand: the entry guard only fires when the file is `process.argv[1]`.

A different count or shape is a gap in an earlier task. Stop and report it. Never define one of those names here: each has its one declaration in its own task.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, directly after Task 8's import block, add:

```ts
// ── W2-4 Task 9 imports ──
import * as t9Driver from '../../deploy/history-replay.mjs';
import * as t9Fs from 'node:fs';
import t9Path from 'node:path';
import { createHash as t9CreateHash } from 'node:crypto';
```

Then append at the end of the file:

```ts
// ── W2-4 Task 9: the probe and step 0b's mechanics (W2-D58, W2-D57, W2-D55) ─────────────────────────────────────
// The probe drives the real subcommand through runDriver against Task 5's recording stub at $HOME/.local/bin/up-a.
// Step 0b's mechanics are exports W2-5b wires; they are pinned here at function level and, for the two halves of
// the persistence check, through step0bMechanics on a stub (Task 5's, and a Task 9 stub that writes the transcript
// a --no-session-persistence run must not leave).

/** One stream-json line per event, as `claude -p --output-format stream-json --verbose` prints them: the init
 *  event, an assistant message per tool call (each followed by its tool_result) and per extra text turn, and a
 *  result event unless `result` is null, its subtype `success` unless one is given. Every message id is distinct. */
function t9Stream(o: {
  sessionId: string | null;
  assistants: number;
  result: null | { numTurns: number | null; subtype?: string; denials?: unknown[] };
  calls?: Array<{ id: string; command: string; isError: boolean }>;
}): string {
  const usage = { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 };
  const lines: unknown[] = [{
    type: 'system', subtype: 'init', ...(o.sessionId === null ? {} : { session_id: o.sessionId }), model: 'fixture-model-arm',
    tools: ['Bash', 'Agent'], mcp_servers: [], plugins: [], skills: [], slash_commands: [],
  }];
  let n = 0;
  for (const c of o.calls ?? []) {
    n += 1;
    lines.push({ type: 'assistant', message: { id: `msg-${n}`, role: 'assistant', content: [{ type: 'tool_use', id: c.id, name: 'Bash', input: { command: c.command } }], usage } });
    lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: c.isError ? 'permission denied' : '{}', is_error: c.isError }] } });
  }
  while (n < o.assistants) {
    n += 1;
    lines.push({ type: 'assistant', message: { id: `msg-${n}`, role: 'assistant', content: [{ type: 'text', text: 'DONE' }], usage } });
  }
  if (o.result !== null) {
    lines.push({
      type: 'result', subtype: o.result.subtype ?? 'success', is_error: (o.result.subtype ?? 'success') !== 'success',
      ...(o.result.numTurns === null ? {} : { num_turns: o.result.numTurns }),
      result: 'DONE', usage, permission_denials: o.result.denials ?? [],
    });
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** The LaunchSpec Task 3's admitAccount answers for the upstream fixture up-a. */
function t9Launch(home: string): { accountId: string; kind: 'upstream'; launcher: string; configDir: string; wrapperPath: null; secretsPath: null } {
  return { accountId: 'up-a', kind: 'upstream', launcher: t9Path.join(home, '.local', 'bin', 'up-a'), configDir: t9Path.join(home, '.claude'), wrapperPath: null, secretsPath: null };
}

/** A stub that prints $HOME/<STUB_STREAM> and then does what --no-session-persistence forbids: it writes
 *  `<CLAUDE_CONFIG_DIR>/projects/<slug of its cwd>/<the init session_id>.jsonl`. */
function t9PlantPersistingStub(home: string, id: string): void {
  const bin = t9Path.join(home, '.local', 'bin');
  t9Fs.mkdirSync(bin, { recursive: true });
  t9Fs.writeFileSync(t9Path.join(bin, id), [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'fs.readFileSync(0);',
    `const text = fs.readFileSync(path.join(process.env.HOME, ${JSON.stringify(STUB_STREAM)}), 'utf8');`,
    'process.stdout.write(text);',
    "const sid = JSON.parse(text.split('\\n')[0]).session_id;",
    "const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));",
    'fs.mkdirSync(dir, { recursive: true });',
    "fs.writeFileSync(path.join(dir, sid + '.jsonl'), text);",
    '',
  ].join('\n'), { mode: 0o700 });
}

describe('W2-4 Task 9: the probe, a box verb and an early check only, W2-D58', () => {
  type T9Entry = { argv: string[]; envKeys: string[]; stdin: string };
  const T9_MODEL = 'fixture-model-arm';
  const t9Account = (id: string, configDirSuffix: string, exec: Record<string, unknown>) =>
    ({ id, label: id, configDirSuffix, exec, homeAble: true, hue: 'cyan', telemetry: 'anthropic' });
  /** The command each taught spelling admits, in allowedToolSpellings' order, spelled here independently. */
  const t9Commands = (home: string): string[] => [
    `${home}/.local/bin/ccrc history status --json`,
    '"$HOME/.local/bin/ccrc" history status --json',
    '~/.local/bin/ccrc history status --json',
  ];
  /** A fixture HOME: up-a (upstream, Task 5's recording stub) and ext-n (external, refused), and up-a's limits row
   *  fresh at `pct` percent. --out is a sibling of HOME, not yet created. */
  function t9Box(prefix: string, pct = 10): { home: string; out: string } {
    const base = mkTmp(prefix);
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    writeRoster(home, [t9Account('up-a', '.claude', { kind: 'upstream' }), t9Account('ext-n', '.ext-n', { kind: 'external' })]);
    plantStub(home, 'up-a');
    const now = Math.floor(Date.now() / 1000);
    t9Fs.mkdirSync(t9Path.join(home, '.cc-limits'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: pct, seven: pct, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));
    return { home, out: t9Path.join(base, 'out') };
  }
  const t9Args = (out: string, account = 'up-a'): string[] =>
    ['probe', '--out', out, '--account', account, '--budget', '1000000', '--arm-model', T9_MODEL];

  it('three box-mode spawns, one per taught spelling, and a denial for one spelling is recorded for that one only; exit 0', () => {
    const { home, out } = t9Box('ccrc-replay-t9-probe-');
    const cmds = t9Commands(home);
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({
      sessionId: 'sess-probe', assistants: 4,
      result: { numTurns: 4, denials: [{ tool_name: 'Bash', tool_use_id: 'tu-2', tool_input: { command: cmds[1] } }] },
      calls: [{ id: 'tu-1', command: cmds[0]!, isError: false }, { id: 'tu-2', command: cmds[1]!, isError: true }, { id: 'tu-3', command: cmds[2]!, isError: false }],
    }));
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);

    const log = stubLog(home) as T9Entry[] | null;
    expect(log, 'the stub ran').not.toBeNull();
    expect(log!.length, 'one spawn per taught spelling').toBe(3);
    const boxArgv = t9Driver.spawnArgv({ mode: 'box', model: T9_MODEL, settingsMode: 'restricted', home });
    for (const e of log!) {
      expect(e.argv, 'box mode: the arm tools and the three spellings, no arm values').toEqual(boxArgv);
      expect([...e.envKeys].sort(), 'the box env: no CCRC_RECALL_*').toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
    }
    expect(cmds.map((c) => log!.filter((e) => e.stdin.includes(c)).length), 'each spelling reaches the stub once').toEqual([1, 1, 1]);

    const bytes = t9Fs.readFileSync(t9Path.join(out, 'probe.json'));
    expect(r.stdout).toBe(`sha256 ${t9CreateHash('sha256').update(bytes).digest('hex')}\n`);
    const doc = JSON.parse(bytes.toString('utf8'));
    expect(Object.keys(doc).sort()).toEqual(['account', 'budget', 'kind', 'measured_ms', 'model', 'settings_mode', 'spellings', 'spend', 'v']);
    expect(doc).toMatchObject({ kind: t9Driver.PROBE_KIND, v: 1, account: 'up-a', settings_mode: 'restricted', model: T9_MODEL, budget: 1_000_000 });
    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 5);
    expect(doc.spellings).toEqual([
      { spelling: t9Driver.allowedToolSpellings(home)[0], denied: false, tool_error: false, ran: true, result_seen: true },
      { spelling: t9Driver.allowedToolSpellings(home)[1], denied: true, tool_error: true, ran: true, result_seen: true },
      { spelling: t9Driver.allowedToolSpellings(home)[2], denied: false, tool_error: false, ran: true, result_seen: true },
    ]);
    expect(t9Fs.readdirSync(t9Path.join(out, 'probe')).sort(), 'the streams live under out/probe').toEqual([
      'spelling-1.jsonl', 'spelling-1.run.json', 'spelling-2.jsonl', 'spelling-2.run.json', 'spelling-3.jsonl', 'spelling-3.run.json',
    ]);
    // This PR's whole subcommand set, in registration order (Task 1's grammar cases use an unregistered name).
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe']);
  });

  it('a stream with no result event records ran but result_seen false, so its denied false measured nothing', () => {
    const { home, out } = t9Box('ccrc-replay-t9-noresult-');
    const cmds = t9Commands(home);
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({
      sessionId: 'sess-probe', assistants: 1, result: null, calls: [{ id: 'tu-1', command: cmds[0]!, isError: false }],
    }));
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(t9Fs.readFileSync(t9Path.join(out, 'probe.json'), 'utf8'));
    expect(doc.spellings.map((s: { ran: boolean; denied: boolean; tool_error: boolean | null; result_seen: boolean }) => [s.ran, s.denied, s.tool_error, s.result_seen]))
      .toEqual([[true, false, false, false], [false, false, null, false], [false, false, null, false]]);
  });

  it('refused before any spawn: an external account, a missing budget, a flag the probe never reads, a limits row at the threshold', () => {
    const cases: Array<{ name: string; pct?: number; args: (out: string) => string[]; line: string }> = [
      { name: 'external', args: (out) => t9Args(out, 'ext-n'), line: 'ccrc history-replay: account-refused: ' },
      { name: 'no budget', args: (out) => t9Args(out).filter((_, i, a) => a[i] !== '--budget' && a[i - 1] !== '--budget'), line: 'ccrc history-replay: args-invalid: budget-required\n' },
      { name: 'writer flag', args: (out) => [...t9Args(out), '--writer-model', 'fixture-model-writer'], line: 'ccrc history-replay: args-invalid: --writer-model is not a probe flag\n' },
      { name: 'threshold', pct: 70, args: (out) => t9Args(out), line: 'ccrc history-replay: limits-threshold: ' },
    ];
    for (const c of cases) {
      const { home, out } = t9Box(`ccrc-replay-t9-refuse-${c.name.replace(/ /g, '-')}-`, c.pct);
      t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-probe', assistants: 1, result: { numTurns: 1 } }));
      const r = runDriver(home, c.args(out));
      expect(r.code, `${c.name}: ${r.stderr}`).toBe(2);
      expect(r.stderr.startsWith(c.line), `${c.name}: ${r.stderr}`).toBe(true);
      expect(stubLog(home), `${c.name}: nothing was spawned`).toBeNull();
      expect(t9Fs.existsSync(t9Path.join(out, 'probe.json')), c.name).toBe(false);
      expect(t9Fs.existsSync(t9Path.join(out, 'probe')), `${c.name}: no stream file`).toBe(false);
    }
  });
});

describe('W2-4 Task 9: step 0b mechanics without the seam, W2-D57', () => {
  const T9_MODEL_0B = 'fixture-model-arm';
  const t9Facts = (o: Parameters<typeof t9Stream>[0]) => t9Driver.readStreamJson(t9Stream(o));
  const T9_ALLOWED = '~/.local/bin/ccrc history status --json';
  const T9_STOP = 'error_max_turns';

  it('the turn probe prompt asks for twenty separate Bash calls of an allowed spelling, MAX_TURNS is 12, and the stop it reads is error_max_turns', () => {
    expect(t9Driver.MAX_TURNS).toBe(12);
    expect(t9Driver.TURN_PROBE_PROMPT).toContain('twenty separate Bash tool calls');
    expect(t9Driver.TURN_PROBE_PROMPT).toContain(`exactly the command \`${T9_ALLOWED}\``);
    expect(t9Driver.allowedToolSpellings('/h')[2], 'CONTROL: the third taught spelling admits that command').toBe('Bash(~/.local/bin/ccrc history:*)');
    expect(t9Driver.MAX_TURNS_STOP_SUBTYPE).toBe(T9_STOP);
  });

  it('the bound holds only when the result event shows the max-turns stop within 12 assistant turns; 13 turns does not hold', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: 12, subtype: T9_STOP } })))
      .toEqual({ held: true, turns: 12, num_turns: 12, subtype: T9_STOP });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 13, result: { numTurns: 13, subtype: T9_STOP } })))
      .toEqual({ held: false, turns: 13, num_turns: 13, subtype: T9_STOP });
  });

  it('a run that ended for any other reason within the bound is unmeasured, never held', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: 12 } })))
      .toEqual({ held: 'unmeasured', turns: 12, num_turns: 12, subtype: 'success' });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 3, result: { numTurns: 3, subtype: 'error_during_execution' } })))
      .toEqual({ held: 'unmeasured', turns: 3, num_turns: 3, subtype: 'error_during_execution' });
  });

  it('no result event is unmeasured within the bound and false past it, its subtype and num_turns null', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 5, result: null })))
      .toEqual({ held: 'unmeasured', turns: 5, num_turns: null, subtype: null });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 13, result: null })))
      .toEqual({ held: false, turns: 13, num_turns: null, subtype: null });
  });

  it('a max-turns result without num_turns still holds: num_turns is recorded, the assistant turn count decides', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: null, subtype: T9_STOP } })))
      .toEqual({ held: true, turns: 12, num_turns: null, subtype: T9_STOP });
  });

  it('num_turns within the bound beside more assistant messages than the bound does not hold', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 14, result: { numTurns: 12, subtype: T9_STOP } })))
      .toEqual({ held: false, turns: 14, num_turns: 12, subtype: T9_STOP });
  });

  it('the project slug replaces every non-alphanumeric character with a dash', () => {
    expect(t9Driver.projectSlugOf('/tmp/ccrc-history-replay-Ab9_x.y')).toBe('-tmp-ccrc-history-replay-Ab9-x-y');
    expect(() => t9Driver.projectSlugOf('relative/dir')).toThrow(TypeError);
  });

  it('persistenceLeft over a config dir: nothing under projects is nothing left', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-none-'), '.claude');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' })).toEqual({ left: false, transcripts: [], projectDir: false });
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-other'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(configDir, 'projects', '-tmp-other', 'sess-b.jsonl'), '{}\n');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }), 'another session under another project is not this run')
      .toEqual({ left: false, transcripts: [], projectDir: false });
  });

  it('persistenceLeft: a transcript named by the session id under another project dir is caught by the session id half alone', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-sid-'), '.claude');
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-elsewhere'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(configDir, 'projects', '-tmp-elsewhere', 'sess-a.jsonl'), '{}\n');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }))
      .toEqual({ left: true, transcripts: ['-tmp-elsewhere/sess-a.jsonl'], projectDir: false });
  });

  it('persistenceLeft: a project dir keyed by the run cwd is caught by the slug half alone', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-slug-'), '.claude');
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-run-a'), { recursive: true });
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' })).toEqual({ left: true, transcripts: [], projectDir: true });
  });

  it('persistenceLeft: a null session id never reads as clean', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-null-'), '.claude');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: null, cwd: '/tmp/run-a' })).toEqual({ left: true, transcripts: [], projectDir: false });
  });

  it('step0bMechanics on the stub: a stub that writes its transcript is caught by both halves', async () => {
    const base = mkTmp('ccrc-replay-t9-0b-left-');
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    t9PlantPersistingStub(home, 'up-a');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-left', assistants: 13, result: { numTurns: 13 } }));
    const out = t9Driver.prepareOut(t9Path.join(base, 'out'));
    const got = await t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined, gate: () => {} });
    const projects = t9Fs.readdirSync(t9Path.join(home, '.claude', 'projects'));
    expect(projects.length, 'CONTROL: the stub wrote one project dir').toBe(1);
    expect(got).toEqual({
      turn_bound: { held: false, turns: 13, num_turns: 13, subtype: 'success' },
      persistence: { left: true, transcripts: [`${projects[0]}/sess-left.jsonl`], project_dir: true },
    });
    expect(t9Fs.existsSync(t9Path.join(out, 'step0b', 'turn-bound.run.json')), 'one box-mode run named step0b/turn-bound').toBe(true);
  });

  it('step0bMechanics on the stub: a clean run leaves nothing, and a run that ended without the max-turns stop is unmeasured, never held', async () => {
    const base = mkTmp('ccrc-replay-t9-0b-clean-');
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    plantStub(home, 'up-a');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-clean', assistants: 12, result: { numTurns: 12 } }));
    const out = t9Driver.prepareOut(t9Path.join(base, 'out'));
    await expect(t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined } as never),
      'no gate: a TypeError before any spawn (the stub log below still counts one run)').rejects.toThrow(TypeError);
    const got = await t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined, gate: () => {} });
    expect(got).toEqual({ turn_bound: { held: 'unmeasured', turns: 12, num_turns: 12, subtype: 'success' }, persistence: { left: false, transcripts: [], project_dir: false } });
    const log = stubLog(home) as Array<{ argv: string[]; stdin: string }> | null;
    expect(log?.length).toBe(1);
    expect(log![0]!.argv).toEqual(t9Driver.spawnArgv({ mode: 'box', model: T9_MODEL_0B, settingsMode: 'restricted', home }));
    expect(log![0]!.stdin).toBe(t9Driver.TURN_PROBE_PROMPT);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** From `server/`, in the foreground, with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 9'
```

The filter selects both describes, 16 tests. Expected: red, `16 failed` (predicted: measured as `15 failed` of 15 against stand-ins for Tasks 1 to 8, with Task 5's draft section and Task 6's draft section verbatim, before the turn-bound rulings; the revised ruling rewrote the five turn-bound cases and kept their count):
- the three probe cases: `parseArgs` has no `probe` subcommand, so `main` refuses `args-invalid` and exits 2. The first two fail with `ccrc history-replay: args-invalid: … : expected 2 to be +0`, and the refusal case with `external: ccrc history-replay: args-invalid: …: expected false to be true` (its stderr does not start with `account-refused`);
- the prompt case: `the given combination of arguments (undefined and string) is invalid for this assertion`;
- the other twelve: `TypeError: turnBoundHeld is not a function`, `projectSlugOf is not a function`, `persistenceLeft is not a function` and `step0bMechanics is not a function`.

Task 1's exact detail for an unknown subcommand may differ from the stand-in's; the word `args-invalid` and the exit 2 are the measured part.

- [ ] **Step 4: Write the probe and the step 0b mechanics.** In `deploy/history-replay.mjs`, directly after Task 8's section and above the entry guard, append:

```js
// ── W2-4 Task 9: the probe, and step 0b's seam-free mechanics (W2-D58, W2-D57, W2-D55) ─────────────────────────
// The probe is a box verb, an EARLY CHECK only (W2-D58): it asks a box-mode run (an arm's tools and argv, no
// CCRC_RECALL_* value) to call each taught spelling once with `history status --json`, the one verb that needs
// no identity, and records what the stream shows. A finding is data: the probe exits 0 whatever it found, and
// only a driver word (a refusal before or between spawns) is non-zero. The spec's treatment-arm pilot
// assertions are W2-5b's, at step 0b.
// Step 0b's two mechanics that need no seam (W2-D57) ship here as exports; W2-5b wires them into its `step0b`
// subcommand after part 1, behind its own gate (every spawn is gated, W2-D55):
//   - the turn bound: a twenty-call request (repeated calls of an allowed spelling) must be stopped by the max-turns
//     limit within MAX_TURNS assistant turns. It is held only when the result event's subtype shows that stop AND the
//     assistant turn count is within MAX_TURNS (coordinator ruling); past MAX_TURNS it is false; a run that ended
//     within the bound for any other reason, or with no result event, is 'unmeasured', never held;
//   - the persistence check: no transcript named by the init event's session_id anywhere under
//     `<configDir>/projects/`, and no `<configDir>/projects/<slug of the run's cwd>` entry. A run whose init
//     event carried no session_id cannot be cleared, so it reads as left, never as clean.

/** The kind word of `<out>/probe.json`. */
export const PROBE_KIND = 'ccrc-history-w2-probe';
/** The flags the probe takes. parseArgs knows every driver flag; a flag the probe never reads is refused, not ignored. */
const PROBE_FLAGS = Object.freeze(['out', 'account', 'budget', 'arm-model', 'settings-mode']);
const PROBE_REQUIRED = Object.freeze(['out', 'account', 'arm-model']);
/** The probe's runs and streams live under `<out>/probe/`. */
const PROBE_RUN_DIR = 'probe';
const PROBE_OUTPUT = 'probe.json';
/** The step 0b turn-bound run's name under --out. */
const STEP0B_TURN_RUN = 'step0b/turn-bound';
const TAUGHT_SPELLING = /^Bash\((.+) history:\*\)$/;
/** The result event's `subtype` when the --max-turns limit stopped the run. The field is the one readStreamJson reads
 *  (`result.subtype`; step 0a's and the probe's streams show it as `success`). The value is Claude Code's headless
 *  spelling for this stop, unmeasured on this fleet until step 0b's turn-bound run first reaches the bound; that
 *  run's turn_bound records the subtype it read, and any other spelling reads 'unmeasured', never held. */
export const MAX_TURNS_STOP_SUBTYPE = 'error_max_turns';

/** The step 0b turn-bound request: twenty separate Bash calls of `~/.local/bin/ccrc history status --json`, which the
 *  third taught spelling admits (`Bash(~/.local/bin/ccrc history:*)`), so the model is driven through repeated ALLOWED
 *  calls rather than stopped by denials. Under --max-turns 12 the run must end within 12 turns whatever the model would
 *  have done; turnBoundHeld reads it as held only when the result event shows the max-turns stop within 12 assistant
 *  turns. */
export const TURN_PROBE_PROMPT = [
  'This is a turn-limit check. Make twenty separate Bash tool calls, one after another.',
  'Each call runs exactly the command `~/.local/bin/ccrc history status --json` and nothing else.',
  'Do not combine calls, do not use a loop, and wait for each call\'s result before making the next.',
  'If a call is refused or fails, make the next call anyway. After the twentieth call, reply with the single word DONE.',
].join('\n') + '\n';

/** The command line a taught spelling admits for the probe: the spelling's prefix plus `history status --json`. */
function probeCommandOf(spelling) {
  // String#match, not the RegExp method: Task 5's no-shell scan reds on any non-comment call spelled exec.
  const m = spelling.match(TAUGHT_SPELLING);
  if (m === null) throw new TypeError(`probe: ${JSON.stringify(spelling)} is not a taught spelling`);
  return `${m[1]} history status --json`;
}

/** The probe's prompt for one spelling: run exactly that command once, then stop. */
function probePromptOf(command) {
  return [
    'This is a permission check. Use the Bash tool exactly once, to run exactly this command, with nothing added before or after it:',
    '',
    command,
    '',
    'Do not run any other command. After the one call, reply with the single word DONE.',
  ].join('\n') + '\n';
}

const bashCommandOf = (input) => (input !== null && typeof input === 'object' && typeof input.command === 'string' ? input.command : null);

/** What one probe run's stream shows for its command: the Bash calls asking for exactly it (`ran`), whether a
 *  permission denial names one of them, by tool_use_id or by its input (`denied`), and whether any of their
 *  tool_results is an error (`tool_error`, null when none came back). `result_seen` says whether the stream
 *  holds a result event carrying `permission_denials` at all: without one, `denied: false` measured nothing. */
function probeFindingOf(facts, command) {
  const calls = facts.toolPairs.filter((p) => p.name === 'Bash' && bashCommandOf(p.input) === command);
  const ids = new Set(calls.map((p) => p.id));
  const denials = Array.isArray(facts.permissionDenials) ? facts.permissionDenials : [];
  const denied = denials.some((d) => d !== null && typeof d === 'object'
    && ((typeof d.tool_use_id === 'string' && ids.has(d.tool_use_id)) || bashCommandOf(d.tool_input) === command));
  const errors = calls.map((p) => p.isError).filter((e) => typeof e === 'boolean');
  return {
    denied,
    tool_error: errors.length === 0 ? null : errors.includes(true),
    ran: calls.length > 0,
    result_seen: facts.result !== null && Array.isArray(facts.permissionDenials),
  };
}

/** Write `<out>/probe.json` as canonical JSON plus a newline, through a temp and a rename, and answer the sha256
 *  of the bytes on disk. */
function writeProbeJson(out, value) {
  const bytes = Buffer.from(canonicalJson(value) + '\n', 'utf8');
  const final = path.join(out, PROBE_OUTPUT);
  const tmp = `${final}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, final);
  return sha256Hex(readFileSync(final));
}

/** `probe`: pane and args (main), then --out, admission, the required --budget, and the gate before every spawn,
 *  so every refusal lands before the first spawn. Then one box-mode run per taught spelling (at most two at once),
 *  `<out>/probe.json`, and `sha256 <hex>` on stdout. Exit 0 whatever the runs showed. */
export async function probeCommand(flags, env) {
  for (const k of Object.keys(flags)) if (!PROBE_FLAGS.includes(k)) refuse('args-invalid', `--${k} is not a probe flag`);
  for (const k of PROBE_REQUIRED) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  const settingsMode = flags['settings-mode'] ?? 'restricted';
  if (!SETTINGS_MODES.includes(settingsMode)) refuse('args-invalid', `settings-mode ${settingsMode}`);
  const home = env.HOME;
  if (typeof home !== 'string' || !path.isAbsolute(home)) refuse('args-invalid', 'HOME is unset or not absolute');
  const out = prepareOut(flags.out);
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, flags.account, home);
  if (flags.budget === undefined) refuse('args-invalid', 'budget-required');
  const gate = batchGate({ out, home, accountId: launch.accountId, budget: flags.budget, limits: LIMITS_DEFAULTS });
  const spellings = allowedToolSpellings(home);
  const jobs = spellings.map((spelling, i) => ({
    launch, mode: 'box', model: flags['arm-model'], settingsMode,
    stdin: probePromptOf(probeCommandOf(spelling)), out, name: `${PROBE_RUN_DIR}/spelling-${i + 1}`, lang: env.LANG,
  }));
  const outcomes = await runBatch(jobs, { concurrency: CONCURRENCY_MAX, gate });
  const output = {
    kind: PROBE_KIND, v: 1, measured_ms: Date.now(), account: launch.accountId, settings_mode: settingsMode,
    model: flags['arm-model'],
    spellings: spellings.map((spelling, i) => ({ spelling, ...probeFindingOf(outcomes[i].facts, probeCommandOf(spelling)) })),
    budget: flags.budget, spend: spentSoFar(out),
  };
  const sha = writeProbeJson(out, output);
  process.stdout.write(`sha256 ${sha}\n`);
  return EXIT.OK;
}
HANDLERS.set('probe', probeCommand);

/** Step 0b's turn bound (W2-D57; coordinator ruling, as revised). `held` is true ONLY when the result event shows that
 *  the max-turns limit stopped the run (its subtype is MAX_TURNS_STOP_SUBTYPE) AND the run made at most maxTurns
 *  assistant turns (readStreamJson's assistantMessages). More than maxTurns assistant turns is false: the bound did
 *  not hold, whatever the result event says. A run that ended within the bound for any other reason (another subtype,
 *  or no result event) is 'unmeasured', never true. `turns` is the assistant turn count the verdict read; the result
 *  event's num_turns and subtype (null without one) are recorded beside it, so a reader sees why. No tool-call count
 *  enters the verdict. Pure. */
export function turnBoundHeld(facts, maxTurns = MAX_TURNS) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new TypeError(`turnBoundHeld: maxTurns ${String(maxTurns)} is not a positive integer`);
  const turns = facts.assistantMessages;
  const numTurns = facts.result === null ? null : facts.result.numTurns;
  const subtype = facts.result === null ? null : facts.result.subtype;
  if (turns > maxTurns) return { held: false, turns, num_turns: numTurns, subtype };
  if (subtype !== MAX_TURNS_STOP_SUBTYPE) return { held: 'unmeasured', turns, num_turns: numTurns, subtype };
  return { held: true, turns, num_turns: numTurns, subtype };
}

/** Claude Code's project directory name for a cwd: every non-alphanumeric character becomes '-'. Pure. */
export function projectSlugOf(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new TypeError(`projectSlugOf: cwd ${JSON.stringify(cwd)} is not absolute`);
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** Every entry under `root` (real directories walked, links never followed) whose name is the session id or starts
 *  with it and a dot, as paths relative to `root`, sorted. An absent root is none; any other read failure throws. */
function entriesNamedBy(root, sessionId) {
  const found = [];
  const walk = (rel) => {
    let ents;
    try {
      ents = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (e) {
      if (rel === '' && e.code === 'ENOENT') return;
      throw e;
    }
    for (const d of ents) {
      const r = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.name === sessionId || d.name.startsWith(`${sessionId}.`)) found.push(r);
      else if (d.isDirectory()) walk(r);
    }
  };
  walk('');
  return found.sort();
}

/** Step 0b's persistence check (W2-D57): what a `--no-session-persistence` run left under `<configDir>/projects/`.
 *  `transcripts`: entries named by the init event's session_id anywhere under it; `projectDir`: whether
 *  `projects/<slug of the run's cwd>` exists, whatever its type. A null session id leaves the transcript half
 *  unmeasured, so `left` is true. An lstat or readdir failure other than ENOENT throws, never reads as clean. */
export function persistenceLeft({ configDir, sessionId, cwd }) {
  if (typeof configDir !== 'string' || !path.isAbsolute(configDir)) throw new TypeError(`persistenceLeft: configDir ${JSON.stringify(configDir)} is not absolute`);
  if (sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.includes('/') || sessionId.startsWith('.'))) {
    throw new TypeError(`persistenceLeft: sessionId ${JSON.stringify(sessionId)} is not a session id`);
  }
  const projects = path.join(configDir, 'projects');
  let projectDir = true;
  try {
    lstatSync(path.join(projects, projectSlugOf(cwd)));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    projectDir = false;
  }
  const transcripts = sessionId === null ? [] : entriesNamedBy(projects, sessionId);
  return { left: sessionId === null || projectDir || transcripts.length > 0, transcripts, projectDir };
}

/** Step 0b's mechanics without the seam (W2-D57): one box-mode run of TURN_PROBE_PROMPT named 'step0b/turn-bound'
 *  (resumed from its run.json when it finished before), then the turn bound over its stream and the persistence
 *  check over the account's config dir, keyed by that run's init session_id and its cwd. The run goes through runBatch
 *  with the caller's required `gate` (W2-5b passes its batchGate), so it is gated like every spawn; the caller also
 *  passes `lang`, its LANG from main's env (undefined when unset), into the run's RunJob. */
export async function step0bMechanics({ launch, out, model, settingsMode, lang, gate }) {
  const [run] = await runBatch([{ launch, mode: 'box', model, settingsMode, stdin: TURN_PROBE_PROMPT, out, name: STEP0B_TURN_RUN, lang }], { concurrency: 1, gate });
  const left = persistenceLeft({
    configDir: launch.configDir, sessionId: run.facts.init === null ? null : run.facts.init.sessionId, cwd: run.cwd,
  });
  return {
    turn_bound: turnBoundHeld(run.facts),
    persistence: { left: left.left, transcripts: left.transcripts, project_dir: left.projectDir },
  };
}
```

- [ ] **Step 5: Run them and see them pass.**

```bash
./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-4 Task 9'
```

Expected: green, `16 passed` (predicted after the turn-bound rulings; measured as `15 passed`, about 1 s of test time against the stand-ins, before them). The probe cases spawn the stub three times each. The refusal case's four runs each exit before the first spawn, with the stub's log absent. Both `step0bMechanics` cases run one stub spawn.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-4/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/replay.t9.orig"
t9() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); }

# M1: the turn bound reads num_turns in place of the assistant turn count.
mut deploy/history-replay.mjs "  const turns = facts.assistantMessages;" "  const turns = facts.result?.numTurns ?? facts.assistantMessages;"
t9 'more assistant messages than the bound'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M2 (coordinator ruling): a run that ended for another reason, or with no result event, read as held within the bound.
mut deploy/history-replay.mjs "  if (subtype !== MAX_TURNS_STOP_SUBTYPE) return { held: 'unmeasured', turns, num_turns: numTurns, subtype };
" ""
t9 'ended for any other reason within the bound|no result event is unmeasured'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M11 (coordinator ruling): any subtype but success read as the max-turns stop.
mut deploy/history-replay.mjs "  if (subtype !== MAX_TURNS_STOP_SUBTYPE) return" "  if (subtype === null || subtype === 'success') return"
t9 'ended for any other reason within the bound'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M3: the persistence check reads only the cwd slug, never the session_id.
mut deploy/history-replay.mjs "  const transcripts = sessionId === null ? [] : entriesNamedBy(projects, sessionId);" "  const transcripts = [];"
t9 'caught by the session id half alone|caught by both halves'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M4: the persistence check reads only the session_id, never the cwd slug.
mut deploy/history-replay.mjs "  return { left: sessionId === null || projectDir || transcripts.length > 0, transcripts, projectDir };" "  return { left: sessionId === null || transcripts.length > 0, transcripts, projectDir };"
t9 'caught by the slug half alone'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M5: the probe exits non-zero on a denial (a finding is data, never a refusal).
mut deploy/history-replay.mjs "  return EXIT.OK;
}
HANDLERS.set('probe', probeCommand);" "  return output.spellings.some((s) => s.denied) ? EXIT.REFUSED : EXIT.OK;
}
HANDLERS.set('probe', probeCommand);"
t9 'recorded for that one only'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M6: a null session id reads as clean.
mut deploy/history-replay.mjs "  return { left: sessionId === null || projectDir || transcripts.length > 0, transcripts, projectDir };" "  return { left: projectDir || transcripts.length > 0, transcripts, projectDir };"
t9 'a null session id never reads as clean'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M7: any denial in a stream counts against every spelling.
mut deploy/history-replay.mjs "  const denied = denials.some(" "  const denied = denials.length > 0 || denials.some("
t9 'recorded for that one only'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M8: a flag the probe never reads passes silently.
mut deploy/history-replay.mjs "  for (const k of Object.keys(flags)) if (!PROBE_FLAGS.includes(k)) refuse(" "  for (const k of Object.keys(flags)) if (false) refuse("
t9 'refused before any spawn'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M9: a missing --budget is given a default instead of being refused before any spawn.
mut deploy/history-replay.mjs "  if (flags.budget === undefined) refuse('args-invalid', 'budget-required');" "  if (flags.budget === undefined) flags.budget = 1_000_000_000;"
t9 'refused before any spawn'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M10: result_seen folded to true, so an unmeasured denial reads as "not denied".
mut deploy/history-replay.mjs "    result_seen: facts.result !== null && Array.isArray(facts.permissionDenials)," "    result_seen: true,"
t9 'records ran but result_seen false'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

# M12: step0bMechanics calls launchRun directly, so a caller with no gate spawns ungated.
mut deploy/history-replay.mjs "  const [run] = await runBatch([{ launch," "  const [run] = [await launchRun({ launch,"
mut deploy/history-replay.mjs "lang }], { concurrency: 1, gate });" "lang })];"
t9 'a clean run leaves nothing'
cp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs

cmp "$SCRATCH/replay.t9.orig" deploy/history-replay.mjs && git diff --stat -- deploy/history-replay.mjs
```

Expected, each measured against the stand-ins (Step 3) with this task's code verbatim:
- **M1** (num_turns in place of the assistant turn count): `1 failed | 15 skipped` (predicted after the revised turn-bound ruling; an earlier num_turns-only mutant measured `1 failed | 14 skipped` before the rulings), `expected { held: true, turns: 12, …(2) } to deeply equal { held: false, turns: 14, …(2) }`.
- **M2** (another ending, or no result event, read as held within the bound): `2 failed` (predicted), `expected { held: true, turns: 12, …(2) } to deeply equal { held: 'unmeasured', turns: 12, …(2) }` and `expected { held: true, turns: 5, …(2) } to deeply equal { held: 'unmeasured', turns: 5, …(2) }`.
- **M11** (any subtype but `success` read as the max-turns stop): `1 failed` (predicted), `expected { held: true, turns: 3, …(2) } to deeply equal { held: 'unmeasured', turns: 3, …(2) }`.
- **M3** (the cwd slug only): `2 failed`. The session-id-only case gets `expected { left: false, transcripts: [], …(1) } to deeply equal { left: true, …(2) }`, and the persisting stub case loses its transcript.
- **M4** (the session id only): `1 failed`, `expected { left: false, transcripts: [], …(1) } to deeply equal { left: true, transcripts: [], …(1) }`.
- **M5** (the probe exits non-zero on a denial): `1 failed`, `expected 2 to be +0`.
- **M6** (a null session id reads clean): `1 failed`, `expected { left: false, … } to deeply equal { left: true, … }`.
- **M7** (any denial counts against every spelling): `1 failed`, `expected [ …(3) ] to deeply equal [ { …(5) }, { …(5) }, { …(5) } ]`.
- **M8** (an unread flag passes): `1 failed`, `writer flag: : expected +0 to be 2`.
- **M9** (a missing `--budget` defaulted): `1 failed`, `no budget: : expected +0 to be 2`.
- **M10** (`result_seen` folded to true): `1 failed`, `expected [ [ true, false, false, true ], …(2) ] to deeply equal [ [ true, false, false, false ], …(2) ]`.
- **M12** (`step0bMechanics` ungated): `1 failed` (predicted), `no gate: a TypeError before any spawn …: promise resolved "{ … }" instead of rejecting`.

The final `cmp` prints nothing, and `git diff --stat` shows only this task's section (and earlier tasks' if not yet committed). Then run Step 5's command once more: green, `16 passed` (predicted).

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history')
(cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts -t 'the node-floor leg runs every history test file')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean')
```

Expected: green (predicted; the count depends on Tasks 1 to 8):
- `history-replay`: every task's cases, these 16 included. That covers Task 1's `node:sqlite` scan, Task 4's `redactDisplayWindow` scan and Task 5's env-read scan over the whole file. This section reads `HOME` and `LANG` only through `main`'s `env` parameter (and `step0bMechanics`'s `lang`), never through `process.env`, and spells no switch file, no arm value, no `recall-off` path and no `.credentials.json`.
- `single-definition -t 'ccrc history'`: O13's `ALL_MJS` and O14's `DECL_CORPUS` scans stay green. `PROBE_KIND`, `TURN_PROBE_PROMPT` and the module-private names are not `VOCABS` names, and no line names a switch path. The same filter runs the §10.1 `process.env` allow-list describe, which this section never touches (it reads `env.HOME` from `main`'s parameter).
- `ci-pipeline` (one `it`, the node-floor list derivation): unchanged by this task, because Task 1 added the file's heredoc line.
- `typecheck-tests -t 'server/test/ is clean'` (one `it`): green. The test file typechecks under `server/test/tsconfig.tests.json` (`allowJs`, so the module's exports are typed from its JavaScript). This task's portion was measured clean with `tsc -p` over the test file and `tmpHelpers.ts`.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
git commit -m "feat(history): W2-4 Task 9 — the probe and step 0b's mechanics" -m "$CO_AUTHORED_BY"
```

---

## Deviations found

As written, this plan defined no D-number: no departure in the W2 decisions document names W2-4 in its "Defined in" entry. It cites D-5774 bare (W2-D12, `DRIVER_REASONS` local to the driver, defined in W2-3's plan). Every task stands on the W2 decisions in the Decisions table and on coordinator rulings recorded in the PR body, none of which is a departure; erratum E18 is additive and carries no number.

The entries below are departures found during the build (run 637), each defined here in the commit that lands it, with a number the coordinator issued to the run.

- **D-5801** — `history-w2-4-admission-disagreement-pin` (Task 3): one case beyond Task 3's test block pins `admitAccount`'s json/roster disagreement guard. A parsed object whose row for the account carries another `exec.kind` than the roster's, or no row at all, throws a `TypeError` (a caller defect, which `main` answers with exit 1), never a `DriverRefusal`; a CONTROL shows the undamaged pair admits. Task 3's interface states the guard, but its test block had no case, so deleting the kind half left the suite green (the task review's finding I1). No shipped behaviour changes.
- **D-5802** — `history-w2-4-usage-count-pin` (Task 4): one case beyond Task 4's test block pins `sjCount`, the reader's fold of a usage count. A count that is not a non-negative safe integer (a string, a negative, a fraction) reads 0, and an absent cache key reads 0, so `spendTokens` stays a finite sum and never reaches `recordSpend` as `NaN` or a string. Task 4's odd-shapes list states the behaviour, but no case reddened when the guard was removed (the task review's finding F1). No shipped behaviour changes.
- **D-5803** — `history-w2-4-spend-run-name` (Task 5): `runPaths` refuses, with a `TypeError`, a run name whose stream file would be the spend ledger (`${name}.jsonl` equal to `SPEND_LEDGER`, so the reserved name is derived, never a second literal), and the `RunJob` name contract says so. Task 5's grammar accepts the one-segment name `spend`, whose stream path is Task 4's `<out>/spend.jsonl`, and `openSync(streamPath, 'w')` would truncate the ledger, so the budget would fail open. No W2-4 caller names a run `spend`; the guard is for the later W2 PRs that name runs. One case pins it (the refusal's message, no stream file, a three-line ledger left byte-identical), with its mutant.
- **D-5804** — `history-w2-4-spawn-guard-pins` (Task 5): cases beyond Task 5's test block pin guards its code already has, each with a drop-the-check mutant measured red: the run-name grammar (an invalid name and a `../` name are refused and nothing is written outside `--out`), the launcher-under-home check, a poison-bin path that is not a directory, a duplicated job in one batch, each of `spawnEnv`'s relative-path and `:` checks, and `finishedOutcome`'s kind and name checks on a well-formed `run.json`. The tamper case's mode variant now carries the recorded model, so it differs in its mode alone and pins the mode clause. The plan's Red-first constraint governs over its test text, which left these guards unpinned (the task review's findings I1 and I2). No shipped behaviour changes.
- **D-5805** — `history-w2-4-limits-window-boundaries` (Task 6): one case beyond Task 6's parity case holds `LIMITS_FIVE_WINDOW_S` (18000) and `LIMITS_SEVEN_WINDOW_S` (604800) equal to `readLimits`' windows. Rows with no `resetAt` aged window-1, window and window+1 seconds, for five and for seven, each read the same as `readLimits` reads them, and the inferred flag turns from false to true across each window. Task 6 says the parity case pins the two windows, but `rolloverCases` has no non-fact row aged inside the gap either window could move through, so a changed constant reddened nothing. A mutant on each constant, alone and in each direction, reds this case. No shipped behaviour changes.
- **D-5806** — `history-w2-4-limits-row-cap-fixture` (Task 6): the "past the 64 KiB read bound" row pads after the JSON (`fresh(1, 1) + ' '.repeat(65_536)`), not inside the object after `{`. With the padding inside, the truncated prefix failed `JSON.parse` whether or not `LIMITS_ROW_CAP` was checked, so the row could not see the guard. Mutant M11 deletes the cap line and reds the row. No shipped behaviour changes.
- **D-5807** — `history-w2-4-limits-id-pin` (Task 6): one case pins `readLimitsRow`'s account-id guard, the only thing between an id and a path. `readLimitsRow` and `batchGate` refuse, with a `TypeError`, an id that is not one path segment (`../<id>`, a dot name, `a/b`, empty, and non-strings), with decoy rows planted where each bad id would resolve; a CONTROL reads the plain id. Task 6's interface states the `TypeError`, but its test list had no case (the task review's finding). No shipped behaviour changes.
