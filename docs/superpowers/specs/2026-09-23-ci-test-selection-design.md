# CI test selection — design

**Date:** 2026-09-23. **Status:** approved section by section in dialogue with the operator (§2 lists the rulings);
this document is the written form for review before a plan is cut. §15 records the refinements measured while the
plan was being written; the sections they touch say so. **Builds on:**
`2026-09-18-release-rollout-design.md` and `2026-09-20-centralised-update-management-design.md` (the release channel
and the `stable` promotion this design gates). Every `file:line` below was measured at `origin/main` `3a8a93a5`; a
line number is a snapshot, the identifier beside it is the anchor. Numbers marked *measured* come from a read-only
study run the same day: the GitHub API over the last 100–150 `ci.yml` runs (per-job and per-step timings, parsed job
logs), a replay of real CI failures against candidate selectors, and `strace` runs of sample server test files.

## 0. In one paragraph

Every pull request runs every test — 376 server test files, 18.5 minutes at the median on Linux, and the whole
server suite again on macOS, where it has outgrown its 55-minute deadline and now answers nothing. This design makes a
pull request run **only the server tests its change could affect**, decided from a **measured dependency map**: each
test file is run under `strace`, and the map records every repository file it or any process it spawns read, probed
for, or listed — which is what catches the text-scan pins and the bash-sourced `ccd/ccd` that a module-import graph
cannot see. The map is rebuilt in full once a day and patched after every merge by re-tracing only the tests that
merge affected. What is selected is **split across parallel runners** so even a near-full selection finishes in
minutes. The **full suite runs daily on `main` and gates every promotion to `stable`**, which is where a selector miss
is caught before it can reach production. The four required checks keep their names, every uncertainty falls back to
the full suite, and the change lands in **shadow mode** first — selecting and reporting, while still running
everything — until a replay of real CI history against the first real map says it is safe to enforce.

## 1. The measured problem

| Fact | Measurement |
|---|---|
| The server leg sets time-to-green | `test (server)`: success median **18.5 min** over 82 legs (max 21.5), its `Test` step ~96% of the job (*measured*). 17 single-run PRs went from first run to all-required-green in 15.6–20.8 min, median 18.1 — the server leg. `test (pwa)` 2.5 min, `test (agent)` 0.5, `build-pwa` 0.4, `probe-macos` 1.1. `ci.yml:34-36` still says the slowest leg is "9 minutes". |
| Every leg runs every test | `ci.yml:30-129`: one matrix `package: [server, agent, pwa]`, each leg `./node_modules/.bin/vitest run` then `tsc --noEmit`. No `concurrency:` block, no path filters. |
| `test-macos` answers nothing | 98 legs: 59 success, 19 failure, 19 cancelled — every cancellation at 55.1–56.0 min, the `timeout-minutes: 55` deadline (`ci.yml:161`). The last 13 completed legs in a row (since 2026-09-21 18:45 UTC) were cut. It runs on **one** vitest worker: `maxWorkers: '40%'` (`server/vitest.config.ts:92`) rounds to 1 on the 3-CPU macOS runner (test-time/wall ratio 0.97, against 1.9 on Linux). It is non-required, so a cut blocks nothing and says nothing. |
| Superseded runs are never cancelled | 12 PR runs kept running after a newer push to the same branch, burning 371 runner-minutes, 339 of them macOS (*measured*, 100-run window). |
| The per-merge `main` run mostly repeats the PR's run | For 20 of 25 checkable merges, `main`'s post-merge run re-tested the exact tree the PR's merge ref had tested. The other 5 ran first on `main` because `strict: false` lets `main` move under an open PR; one of them (`ecbb8b22`) caught a real semantic merge conflict. `release-main.yml:9-11` cuts a release without waiting for it. |
| vitest's own selection misses a third of real failures | `vitest --changed` walks the Vite module graph only (static and dynamic `import`); a file read with `readFileSync`, a script a test spawns, and a new file in a directory a test lists select nothing (*measured* in a lab repo). Replayed against 61 real CI failures not inherited from `main`: **57.3%** of failing test files selected. It also selects **nothing, exit 0**, when there is no `.git` or the ref is bad (git errors are swallowed), and for an edit to `vitest.config.ts` alone. |
| Static analysis of the tests cannot be made both safe and useful | A static analyzer of every test's reads, walks, spawns and git use reached **82.3%** recall on the same replay; reaching **96.8%** required always running the tests it could not resolve — 91% of the server suite — so a median PR would still select 88% of it. |
| Runtime is concentrated on `ccd/ccd` | `ccd/ccd` is one 23,148-line bash file. The tests that run it hold **88–92%** of server test runtime (four CI logs); 35 of the last 100 merged PRs touched it. The ten slowest files are ~60–70% of runtime. Any file-level selector runs most of the suite for those PRs — which is why §7's sharding is part of this design, not an extra. |
| Required checks are reported by name | Classic protection on `main` requires `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa` (four — the comment at `ci.yml:139-141` names three), `enforce_admins: true`, `strict: false`. |
| Hosted runners are free here | The repository is public; standard GitHub-hosted runners, macOS included, cost nothing. The "macOS bills at 10x" comments (`ci.yml:157-158`, `oss-metadata.test.ts:163`) no longer describe a cost. Waste here means wall-clock to merge, the organisation's 5-job macOS concurrency cap (queue waits of 13–18 min measured), and noise. |

## 2. Rulings

Made by the operator in this session, and binding on the plan:

1. **Pull-request CI runs only the tests relevant to the change**, not the full suite.
2. **No full run after every merge.** The full suite runs **as a daily job on `main`** instead.
3. **Promotion to `stable` runs the full suite** and promotes only on green.
4. **Approach A + C:** file-level selection from a measured dependency map, plus sharding what is selected. Function-level
   selection inside `ccd/ccd` (approach B) is deferred (§13).
5. **The per-merge refresh (§5.4) is approved** — it re-runs, under trace, only the tests a merge affected, to keep the
   map current. It is not a full run.
6. **macOS is part of the full suite** that the daily run and the stable gate require.

## 3. Modes and triggers

`ci.yml` remains the single definition of the pipeline. The trigger decides a **mode**; one `select` job computes
what the mode runs, and every other job reads its output.

| Trigger | Mode | Runs |
|---|---|---|
| `pull_request` | `selected` | Server tests chosen by §6, sharded on Linux (§7); `test (agent)`, `test (pwa)`, `build-pwa` and `probe-macos` in full, as today; `test-macos` on the same selection, advisory. |
| `push` to `main` (a merge) | `refresh` | Linux only: re-trace the tests the merge affected and update the map (§5.4). No agent, pwa, build or macOS legs. |
| `schedule`, daily | `full` | Every leg in full, Linux and macOS, sharded; plus a separate traced full run that rebuilds the map from scratch (§5.3). When `main`'s head already carries a green `full-suite` check (§8), the selector-driven legs are skipped (§15.4). |
| `workflow_dispatch` | input `mode`, default `full` | The manual escape hatch. |
| `workflow_call` | input `mode` | How `release-stable.yml` runs the full suite (§8). |

`agent` and `pwa` are not selected: together they take under three minutes and never sit on the critical path once
the server leg is sharded, so selecting them buys nothing worth their risk.

## 4. Job graph and the required checks

### 4.1 Jobs

- **`select`** — checks out at `fetch-depth: 0`, downloads the newest map and duration table from artifacts of trusted
  `main` runs (§5.5, §15.7), runs `.github/ci/select-tests.mjs`, and outputs: the mode actually taken (a `selected` run can fall back
  to `full`, §6.3), the selected file count, the Linux and macOS shard matrices, and a per-test reason table written to
  the job summary. Dependency-free Node, so it runs before any `npm ci`.
- **`server-shard`** — matrix from `select`'s output. Each shard installs as the server leg does today (tmux, jq,
  python3, the three packages' `npm ci`) and runs exactly its listed files (§7.2). Skipped when the selection is empty.
- **`server-typecheck`** — `tsc --noEmit` in `server/`, always, in every mode that runs server tests.
- **`test (server)`** — the summary job that carries the required name. See §4.2.
- **`test`** matrix `package: [agent, pwa]` — unchanged, so `test (agent)` and `test (pwa)` keep their names.
  `server` leaves this matrix.
- **`build-pwa`** — unchanged. **`probe-macos`** — unchanged, but runs only on pull requests and the daily schedule, so
  an advisory probe never gates a called full run (§15.10).
- **`test-macos`** — sharded from `select`'s macOS matrix; advisory in `selected` mode.
- **`trace-shard`**, **`map-build`** — `full` (scheduled) and `refresh` modes only: run the chosen tests under trace and
  merge the result into a new map (§5).
- **`full-suite`** — `full` mode only: green iff every leg, macOS included, is green (§8).

Per mode: `selected` and `full` run everything above except `trace-shard` and `map-build`; `full` adds
`full-suite`. The traced rebuild (`trace-shard` + `map-build` over every file) runs on `schedule` and on a manual dispatch with
`mode: rebuild` (§15.11), never on a manual or called `full` run, which is a verdict only. `refresh` runs `select`, `trace-shard` and `map-build` and
nothing else.

### 4.2 The summary job is the whole safety of the required check

GitHub reports a job **skipped by a conditional as Success**, and a job whose `needs:` failed is skipped — so a
summary job written the obvious way turns a crashed selector into a green required check. And a workflow skipped by a
`paths:` filter leaves its required checks **Pending** forever; a matrix job skipped by a job-level `if:` never
expands, so `test (server)` would never appear. (All three are documented in GitHub's "Troubleshooting required status
checks"; the matrix expansion order is documented in the workflow syntax reference.) Therefore:

- `test (server)` declares `if: always()` and `needs: [select, server-shard, server-typecheck]`, and **fails unless**
  `select` succeeded, `server-typecheck` succeeded, and `server-shard` either succeeded or was skipped **with
  `select`'s count equal to 0**. Any other combination — cancelled, failed, skipped with a non-zero count — is red,
  and so is `tests: none` on a pull request. A first step that reads only job results, and runs no repository script,
  can only add red to that verdict (§15.8).
- No workflow-level `paths:` / `paths-ignore:` filter, ever. No job-level `if:` on a matrix that carries a required name.
- Selection happens inside the pipeline, never by not running it.

### 4.3 Concurrency

- Pull requests: group `ci-<workflow>-pr-<number>`, `cancel-in-progress: true` — a newer push cancels the older run.
- `refresh` on `main`: group `ci-<workflow>-refresh`, `cancel-in-progress: false`. GitHub keeps at most one *pending* run
  per group, so a burst of merges can drop an intermediate refresh; that is harmless by construction, because each
  refresh diffs from the map's own commit, not from the previous merge (§5.4).
- `schedule` / `workflow_dispatch`: their own group, so a merge can never cancel the daily run.
- The group names must include the mode and must not collide with `release-main` or `release-stable` — including
  when `ci.yml` runs as a called workflow, where the group is evaluated in the caller's context (a spike item, §12).

## 5. The dependency map

### 5.1 What is traced

Each server test file runs in **its own** vitest process under
`strace -f -ff -ttt -y -qq` (per-thread output files, microsecond timestamps; file descriptors printed as their paths),
restricted to the file-shaped syscalls: `openat`, `openat2`, `open`, `newfstatat`, `statx`, `access`, `faccessat2`,
`readlink`, `readlinkat`, `getdents64`, `execve`, `execveat`, `symlink`, `symlinkat`, `chdir`, `fchdir`, plus
`clone`/`clone3` to rebuild thread groups (§15.1). `-y` prints the current directory on every `*at` call; the
timestamps order a thread group's files so a relative path in a call without a directory argument resolves against
the right directory (§15.9). One vitest process per file makes attribution exact. Per-thread output removes the split `<unfinished …>` / `<… resumed>` lines, and `-y` removes fd-to-path bookkeeping — the two
defects the prototype's post-processor had (it dropped successful opens and misattributed a reused fd, *measured*).

### 5.2 What is recorded

Per test file, **repository paths only** (anything outside the checkout, and `node_modules/`, is dropped):

| Kind | Recorded when | Selects the test when |
|---|---|---|
| `read` | a file is opened or executed, by the test or any descendant (bash, git, tmux, node) — under the path the kernel resolved as well as the path asked for, so a read through a symlink planted outside the repo counts — or is the in-repo target of a symlink the test creates (§15.9) | that path is modified, deleted or renamed |
| `probed` | a stat/access/open of a path fails with `ENOENT` | that path is added |
| `listed` | a directory is enumerated (`getdents64`) | a file directly inside it is added, deleted or renamed |
| `subtree` | the test creates a symlink whose target is an in-repo DIRECTORY (a fixture home that links `deploy/` or `shared/` whole) — what it later stats or probes through the link has no resolved path to record (§15.13) | any path at or under it is added, modified, deleted or renamed |
| `git` | any path under the repository's `.git/` is opened | **always** — the test reads the whole tracked tree or its history (`git ls-files`, `git grep`, a range scan) |
| `unknown` | the traced run failed, timed out, or was killed, a relative path could not be resolved, a floor test lost its breadth, or the test is on `SKIPS_UNDER_TRACE` — it skips some of its own cases when traced, so its record misses what they read (§15.16) | **always**, until a clean trace replaces it (never, for a test on `SKIPS_UNDER_TRACE`) |

- **Recursive walks** enumerate every subdirectory they descend into, so each is recorded in `listed` on its own.
- **`git` is derived, not hand-kept.** It is expected to contain at least `source-bytes`, `topology-clean`,
  `deviation-refs`, `dtbd`, `providers`, `modelenv-single-writer`, `install-census` and `gitignore-secrets` — the
  repo-wide guards the study found, about 2% of runtime together with the two below. `map-build` goes red when that floor is broken — after publishing the map with each violator marked `unknown`, so a
  tracer regression that stops seeing `.git` reads is loud and the violators are still always selected (§15.13). `single-definition` and `typecheck-tests` are repo-wide too, but
  through directory walks and `tsc` project reads rather than `.git`; their breadth arrives through `listed` and
  `read`, and the same pin names them.
- **`unknown` exists because a test that dies early reads less.** Its record would be too small, which is the one
  direction that is unsafe. So does a test that skips cases under trace (`CCRC_TRACING=1`): `trace-run.mjs`'s
  `SKIPS_UNDER_TRACE` names each such file, and a scan keeps it equal to the test files that read the variable.
- **vitest's own startup is subtracted, per process side** (§15.1). A trivial baseline test file is traced with the
  same invocation, and each trace is split into the vitest main process and everything else (the worker running the
  test, and its children). The baseline's main-process record — the config, `package.json`, `tsconfig.json`, the
  `server/test/` listing the include glob makes — is removed from every test's main-process record, and its
  worker-side record from every worker-side record. Without that, every test would "list `server/test/`" and any added
  test file would select everything. Splitting by side is what keeps a test's OWN listing of `server/test/` (a census,
  such as `single-definition`'s) from being erased with vitest's. The baseline's `read` and `probed` files are full-run
  triggers (§6.3); its `listed` directories are not. The baseline is written into the map so the subtraction is
  visible.

### 5.3 The daily rebuild

The scheduled run's `trace-shard` jobs trace **every** server test file, sharded (tracing costs 1.7–4.3x wall-clock,
*measured* locally; every shard stays under `oss-metadata.test.ts`'s 60-minute job ceiling). `map-build` merges them
into a fresh map for the run's commit. The **untraced** full run in the same schedule is the verdict and the source of
per-file durations; the traced run's results are not a verdict, because tracing perturbs the timing-budget tests
(`boot`, `session-hook`'s p95, the pwa `contrast` timeouts).

### 5.4 The per-merge refresh

On a push to `main` (a merge): take the newest trusted map (commit `c`, §5.5); compute the changed set from `c` to the new head;
select exactly as §6 would; trace those tests on the new head; write a map for the new head whose entries are the fresh
traces for the traced tests and **the old entries for every other test**. Tests deleted from the tree are dropped; new
test files are, by §6.2, selected and so traced.

Carrying the old entries is sound for the same reason selection is (§9): a test that read none of the changed paths
executed identically, so its record is unchanged. If there is no map yet, or a full-run trigger fired, the refresh
traces everything. A test the refresh meant to trace but got no record for — its trace shard crashed or was
cancelled — is written `unknown`, never carried: carrying is sound only for tests that read none of the changed paths
(§15.3). A test that fails or times out under tracing is recorded `unknown` — always selected — and the
map is published regardless. `map-build` then goes red, after publishing, only for news: a traced test that newly
fails (failing now, not unknown in the map the run started from) — a real semantic merge conflict among the affected
tests, or a test newly perturbed by tracing. A failure that was already unknown is a warning, so a test that always
fails under tracing (§15.12) reds the first build that sees it, not every merge that re-traces it; with no map to start
from, every failure counts once. It gates nothing. A refresh publishes its map only if, when checked just before the upload, the map it started from is still the
newest trusted one (§15.7); a rebuild always publishes.

### 5.5 Storage

The map is JSON: its commit sha, a format version, the baseline set, and the per-test records. It is published as an
artifact named `testmap` by `map-build`, and the daily untraced run publishes per-file durations as `testtimes`.
`select` takes the newest non-expired artifact of that name whose run is `ci.yml` on `main` **of this repository**
(not a fork's branch of the same name), triggered by `push`, `schedule` or `workflow_dispatch` — and nothing else.
It deliberately does not use the Actions cache: a pull request's runs read their own cache scope before `main`'s, so
a pull request (or a rebuild dispatched on a feature branch) could plant the map its own selection is computed from
(§15.7). Reading artifacts needs `actions: read` on the jobs that fetch them. A map whose commit is not an ancestor of
the tree under test, or no map at all, falls back to full (§6.3).

## 6. Selection

### 6.1 The changed set

**Changed = the files that differ between the map's commit and the tree under test** — for a pull request, its merge
ref (`git diff --name-status <map-sha> HEAD`, with the checkout at `fetch-depth: 0`). This deliberately includes
whatever `main` merged since the map was built: a test whose record touches one of those files has unknown
dependencies at the PR's base, so it must run. A rename contributes both paths; status letters distinguish added,
modified and deleted, which §5.2's table needs.

### 6.2 A server test file runs if any of these hold

1. It is new, modified, or renamed, or it is absent from the map.
2. Its record is `unknown`, or it is in `git`.
3. A modified, deleted or renamed path is in its `read`.
4. An added path is in its `probed`.
5. An added, deleted or renamed path sits directly inside a directory in its `listed`.
6. Any changed path sits at or under a directory in its `subtree`.

### 6.3 The full suite runs instead when

- the map is missing, unreadable, of an unknown format version, or its commit is not an ancestor of the tree under
  test;
- on a pull request, anything under `.github/` changed — decided by a plain `git diff` against the merge base BEFORE the
  selector runs, so a pull request that edits the selector is never judged by it (§15.8);
- the changed set touches any `package.json` or `package-lock.json`, any `vitest.config.*`, any `tsconfig*.json`,
  anything under `.github/` (the pipeline, the selector and the tracer live there), or `shared/package.json`'s module
  marker (already covered by the `package.json` rule — named because `CLAUDE.md` calls it load-bearing), a symlink,
  any `.gitattributes` or `.npmrc`, anything under `server/scripts/` (consumed by checkout and `npm ci`, outside any
  trace), or any path in the map baseline's `read` or `probed` (the files every test's startup reads);
- the selector itself hits any internal error. It then **emits mode `full` with the reason** — it never answers
  "nothing". Only if the `select` job dies outright does `test (server)` go red (§4.2) — loud, never silent. Two
  conditions deliberately make it die rather than fall back, because "full" would run the wrong thing too: a live test
  path containing whitespace (shard lists are space-joined), and a live test list that is empty or unreadable (§15.5).

### 6.4 The reason table

Every run writes one line per selected test to the job summary — the rule (§6.2's number) and the path that fired
it — or, on a fallback, the single reason. A miss found later by the daily run or the stable gate is diagnosed from
this table, not reconstructed.

## 7. Sharding

### 7.1 How many, and what goes where

- Durations come from the newest trusted `testtimes` artifact (§5.5); a file with no duration is given the median.
- Files are packed longest-first onto the least-loaded shard (LPT). A single file longer than the target gets a shard
  of its own; the file itself is never split.
- Linux shard count = the selected total divided by a per-shard target of about four minutes of wall-clock at two
  workers, clamped to **1–5**.
- macOS: at most **2** shards on any pull request — even one that fell back to full — and **4** on a scheduled,
  dispatched or called full run, so the organisation's 5-job macOS cap still leaves room for `probe-macos` and a
  second pull request (§15.10). Each macOS shard still runs one vitest worker — sharding across machines is the lever,
  and `maxWorkers: '40%'` is left alone.
- If there are no durations at all, test shards fall back to vitest's own `--shard=i/n` (hash-partitioned by path);
  trace shards, which run an exact list, are packed with the default weight instead.

### 7.2 Running an exact list

vitest's positional file arguments are **substring** filters — `a.test.ts` also runs `xa.test.ts` (*measured*). Each
shard therefore runs through a thin config, `server/vitest.select.config.ts`, which merges the normal
`server/vitest.config.ts` and replaces `test.include` with the literal paths from a list file named by an environment
variable. Literal include patterns match exactly (*measured*). The same config serves the per-file traced runs.

## 8. The stable gate

- A `full`-mode run ends with a job named **`full-suite`**, green iff every leg — Linux shards, typechecks, agent, pwa,
  build, **and the macOS shards** — is green. It exists only in `full` mode. Like `test (server)`, it starts with a step
  that reads only job results and can only add red, and its verdict script fails closed (§15.8).
- `release-stable.yml`, on a push to `stable`, gains a first job, `gate`, that asks the checks API whether the pushed
  commit carries a successful `full-suite` check run (named `full-suite`, or `<caller> / full-suite` when it came from a
  called workflow).
  - **Found** — from the daily run, a manual full run, or an earlier gate: the existing `promote` job runs at once. The
    usual path, if the operator promotes the commit the daily run tested.
  - **Not found** — a second job calls `ci.yml` with `mode: full` (`uses: ./.github/workflows/ci.yml`, granting the
    called run `actions: read` for its artifact fetches), and `promote`
    runs only if it succeeded AND its `full-suite` job reported `verdict: green` — a called run that succeeded without
    ever reaching `full-suite` must not promote (§15.4).
- **Why the gate is in the workflow and not in the `stable` ruleset.** GitHub does not let checks from `schedule` or
  `workflow_dispatch` runs satisfy a ruleset's required status check — only `push`, `pull_request` and a few other
  events count (GitHub's "Troubleshooting required status checks"). A ruleset gate would therefore refuse the daily
  run's evidence.
- **The consequence the operator accepted:** a push to `stable` moves the branch before the gate runs. If the gate
  fails, the branch points past the newest promoted release, the release's flags are not flipped, and `ccrc rollout` —
  which follows the release flags, not the branch — moves nothing. The next promotion fast-forwards past it.
- `release-stable.yml`'s text is pinned exactly by `build-release.test.ts:525-567`; those pins are updated
  deliberately in the same change. Two of them already fit the design: the file may not contain `workflow_call`
  (calling a workflow uses `uses:`, the callee declares `workflow_call`), and `promote` keeps `contents: write` alone.
  A job that calls a reusable workflow cannot declare `timeout-minutes`; release-stable is not in
  `oss-metadata.test.ts`'s timeout census (`:173`), and the called `ci.yml`'s own jobs carry their deadlines.

## 9. Why selection is safe, and where it is not

The argument is the one behind dynamic file-level regression test selection (Gligoric, Eloussi and Marinov, "Practical
Regression Test Selection with Dynamic File Dependencies", ISSTA 2015): **a test's behaviour can change only if
something it read changed.** If a test read none of the changed paths, never probed a path that now exists, and never
listed a directory whose entries changed, it executes the same way and reaches the same verdict. Recording reads from
every descendant process is what extends the argument across bash, git and tmux. It is also why the refresh can carry
old entries forward, and why an intermediate refresh can be dropped.

It holds only as far as its assumptions do. The known limits, each with what catches it:

| Limit | Caught by |
|---|---|
| The map is recorded on Linux; a read that only happens on Darwin is not in it, so a PR changing a Darwin-only file can skip a test on macOS | the daily full run and the stable gate; the macOS PR leg is advisory |
| Reads outside the repository — system tools, the runner image — are not tracked | the lockfile rule covers `node_modules`; the daily run catches runner-image drift |
| A test whose reads vary between runs (time, randomness, load) can be under-recorded | each daily rebuild re-traces everything; a miss surfaces at the daily run |
| A syscall family the trace list omits (e.g. `io_uring` file ops) would hide reads | the plan's spike checks the list against a full trace; the history replay (§11.3) is the recall measurement |
| A test that touches a repository path only by mutating it (`unlink`, `mkdir`, `rmdir`, `rename`, `link`, `chmod`, `utimensat`) or by `statfs` — never opening, stating or listing it — is not recorded: those families are outside the trace list | tests write only under fixture HOMEs: traced with exactly those families, `ccd-ws-audit` (the spike's census file) made 43,089 such calls and none named a repository path; the daily full run and the stable gate |
| `strict: false` lets `main` move under a PR, so a PR's green covers its merge ref at the time it ran | the per-merge refresh runs the affected tests on the real merged tree; the daily run covers the rest |

## 10. Constraints the change must honour

- `oss-metadata.test.ts:109-183` — every job in `ci.yml` (and `release.yml`, `release-main.yml`) declares a first
  `timeout-minutes` between 1 and 60; the top-level `permissions: contents: read`; `pull_request` present and
  `pull_request_target` absent; no `secrets.` reference. `jobBlocks` treats every two-space key after `jobs:` as a job.
- `single-definition.test.ts:2798-2810` — no organisation name on any code line of a workflow.
- `build-release.test.ts:525-567` — `release-stable.yml`'s triggers, concurrency, permissions, commands and timeout
  (§8).
- `verify-provenance.test.ts` pins `release-main.yml` and `release.yml` by file name as signer identities: neither is
  renamed.
- `topology-clean` and `deviation-refs` need `origin/main` present — `fetch-depth: 0` on every job that runs them.
  `typecheck-tests` needs `agent/` and `pwa/` `node_modules`; the `ccgpt-*` suites need `python3` when `CI` is set; the
  `ccd` suites need tmux and jq (plus bash, flock and coreutils on macOS). Every shard installs what the server leg
  installs today, because any shard can receive any file.
- `test-macos` stays non-required; `probe-macos` stays independent of it.

## 11. Testing the machinery

### 11.1 Unit tests, red-first

The selector (`.github/ci/select-tests.mjs`), the trace post-processor (`.github/ci/trace-to-deps.mjs`) and the map
merge are tested from `server/test/`, on fixture `strace -ff` logs and fixture maps. Every selection rule in §6.2 and
every fallback in §6.3 gets a case that goes **red when the rule is deleted** — measured by deleting it, per the
repo's mutation-table discipline. The post-processor gets cases for: a read by a grandchild process, a failed probe, a
directory listing, a `.git` read, a relative path after `chdir`, an `execve`, and baseline subtraction.

### 11.2 Workflow-shape pins

New assertions over `ci.yml`: the four required names are always produced; `test (server)` carries `if: always()` and
checks each `needs` result as §4.2 states; the concurrency groups of §4.3; no `paths:` filter; every job keeps its
deadline. A pin that `release-stable.yml`'s `promote` cannot run unless `gate` found a `full-suite` check or the called
full run succeeded.

### 11.3 The history replay — the acceptance measurement

Before enforcing, the selector runs over the study's dataset — **114 real CI test failures across 64 runs, plus the 6
documented misses**, frozen as `2026-09-23-ci-test-selection-replay-dataset.json` beside this spec because GitHub job
logs expire and the set could not be rebuilt later — (the `deploy/build-release.sh` → `compact-card-ship`, `ccd/ccrc-doctor-checks` →
`ccrc-install` + `pool-name-parity`, `COORD_SCHEMA_VERSION` → `asks-store`, `closeReviewRun`'s `sweepDec(` sites →
`unattended-actor`, `dispatch.ts`'s `cap-concurrency` frame → `coordinator-skill`, and the NUL byte → `source-bytes`
cases) — against the first real traced map. Target: **every failure not inherited from `main`, whose test is in the
map, is selected**; a failing test absent from today's map proves nothing either way and is reported separately, never
counted as caught. Each miss is explained and either fixed in the tracer or recorded as a known limit (§9). A set with no proven
case reports recall `n/a`, which does not count as 100%. Reported
alongside: the selected share of server runtime across the last 100 merged PRs.

## 12. Rollout

1. **Spike, stop-or-go.** The branch's first CI run checks, on a real `ubuntu-latest` runner: that `strace -f` works
   there, its overhead on the heaviest files (`ccd-ws-audit`, `ccrc-doctor`, `ccd-ws-reap`, `session-hook`) against the
   runner's per-file trace timeout, that `clone` lines and the process-side split come out as measured locally, vitest's startup footprint
   for the baseline, the check-run name a called workflow's job gets, and how a concurrency group evaluates inside a
   called workflow. If `strace` cannot run there, the design stops and comes back to the operator.
2. **Land in shadow mode.** `select` computes and reports everything, but `selected` mode still runs the full
   suite. This PR touches `.github/`, so §6.3 would force a full run on it anyway. The daily run, the refresh, the
   stable gate, the concurrency groups and the macOS sharding go live at once — none of them depends on selection
   being trusted.
3. **Build the map.** The first refresh after merge finds no map and traces everything.
4. **Replay (§11.3)** against that map, and report the numbers to the operator.
5. **Enforce** — one line flips `selected` mode from shadow to real.

## 13. Out of scope, and alternatives rejected

- **Function-level selection inside `ccd/ccd`** (approach B, deferred by ruling). It is the only lever on the 88–92%
  of runtime that `ccd/ccd`'s tests hold; whether it pays depends on how widely ccd's helper functions are shared,
  which is not measured. The per-file traced runs of §5 are where that measurement would attach.
- **vitest `--changed` / `related`** — module graph only; 57.3% recall; silent empty selection without `.git` (§1).
- **Static analysis of test sources** — 82.3% recall, or 96.8% at an 88% median selection (§1).
- **Workflow-level `paths:` filters, and job-level `if:` on the required matrix** — Pending forever, or a matrix that
  never expands (§4.2).
- **Selecting `agent` and `pwa`** — under three minutes together; not worth the risk (§3).
- **A `stable` ruleset required check** — refuses `schedule` and `workflow_dispatch` evidence (§8).
- **Raising macOS `maxWorkers`** — the vitest config argues against it for flake reasons; machine-level sharding is
  used instead (§7.1).
- **Sharding alone** — shortens wall-clock but cuts no compute; ruling 4 asked for both.

## 14. Documentation corrected in the same change

- `ci.yml`: the "slowest leg … 9 minutes" comment (`:34-36`); the three-name required-check comment (`:139-141`); the
  "10x Linux" billing comments (`:157-158`); the `workflow_dispatch` escape-hatch comment (`:22-27`), which GitHub's
  docs contradict for rulesets (untested against classic protection — the comment will say so).
- `release-main.yml:9-11` — "main's post-merge matrix is a 45-minute re-check" no longer exists.
- `CLAUDE.md`'s *Build / test / deploy* section — what CI runs on a PR, daily, and at promotion.
- Comments inside test files that restate billing (`oss-metadata.test.ts:163`) are corrected where they are touched.

Several of these files are read as text by server tests, so the change's own verification is the full suite, sharded,
before merge — not a list of the suites it obviously touches.

## 15. Refinements measured while writing the plan

Found by running the plan's code against real traces and the real history of this repository on 2026-09-23. Each
tightens the design above in the direction of safety or of the saving it exists for; none reverses a ruling.

1. **Traces are split by process side, and a process is a thread group.** `strace -ff` writes one file per THREAD,
   not per process: the baseline's `getdents64` of `server/test` was measured on a threadpool thread's file, not the
   vitest main pid's. The runner records the main pid (a `sh -c 'echo $$ …; exec vitest …'` wrapper), and the parser
   rebuilds its thread group from `clone`/`clone3` lines carrying `CLONE_THREAD`; everything else is the worker side.
   Measured: vitest's glob lands on the main side; `worker-skill`'s walk of `ccd/worker-skill` and `single-definition`'s
   census of `server/test` land on the worker side, so the census survives subtraction.
2. **Why the baseline's directory listings are not full-run triggers.** 29 of the last 60 merged PRs added or deleted a
   file under `server/test`. With the listing as a trigger, half of all PRs would run the full suite; with the split of
   item 1, dropping the trigger loses nothing, because a test that lists `server/test` itself keeps that listing.
3. **A refresh never carries an entry it meant to replace** — see §5.4.
4. **Two stricter behaviours in the pipeline.** On a scheduled day whose head already has a green `full-suite`, the
   selector-driven legs (server shards, typecheck, macOS shards, traces, `full-suite`) are skipped, while the required
   `test (agent)`, `test (pwa)`, `build-pwa` and `probe-macos` still run (about four runner-minutes): they cannot read
   the selector's answer without a `needs:` that §4.2 forbids. And `promote` requires the called run's `verdict` output,
   not only its success (§8).
5. **Two inputs fail loudly instead of falling back** — see §6.3.
6. **Syscalls added:** `readlink` (Node's `fs.realpathSync.native` of a missing path emits only `readlink`, measured),
   recorded like `access`; `EINVAL` from `readlink` means the path exists and records a read. Traced runs set
   `UV_USE_IO_URING=0` so libuv performs every file operation as a visible syscall.

The adversarial review of the written plan (four lenses, each finding reproduced by an independent refuter; 43
confirmed, none refuted) added the following.

7. **The map and durations come only from trusted `main` artifacts, never the Actions cache** (§5.5). A pull request's
   runs read their own cache scope first, so a planted cache entry — or a rebuild dispatched on the pull request's own
   branch — would have become that pull request's selection baseline, with a final diff that shows nothing. The
   artifact picker accepts only `ci.yml` runs on this repository's `main`, triggered by `push`, `schedule` or
   `workflow_dispatch`; `select` also refuses a map whose commit is not an ancestor of the tree under test. A refresh
   publishes only if, when checked just before its upload, its starting map is still the newest trusted one. The check
   and the upload are two steps, not one atomic act, so this narrows a refresh racing the daily rebuild to the seconds
   between them rather than closing it: the worst case is that the rebuild's corrections wait for the next rebuild, and
   selection stays safe because every map is a correct map for its own commit.
8. **A pull request is never judged only by the code it changes.** A plain-bash `git diff` against the merge base
   forces the full suite when `.github/` changed, before the selector runs. `verdict.mjs` exits 1 unless it reaches a
   successful verdict, and both `test (server)` and `full-suite` start with a script-free step over the job results that
   can only add red. `select` refuses to answer `tests: none` for a pull request, and the server verdict independently
   rejects it.
9. **Symlinks and working directories.** Test fixtures reach repository scripts through symlinks planted in temporary
   homes (the `ccrc` suites); the tracer records the path the kernel resolved for every successful open, and the
   in-repo target of every symlink a test creates — measured: without it, a change to `ccd/ccrc-models-probe` skipped a
   suite in which 28 cases fail. `chdir`/`fchdir` and `-ttt` timestamps are traced so relative paths in calls without a
   directory argument resolve against the directory in force at that moment (git changes directory before reading
   `.git/config`; resolving only when a process never changed directory left 3 of 8 measured files permanently
   `unknown`). Two calls in the same microsecond as a directory change cannot be ordered and count as unresolved.
10. **Smaller corrections.** `.gitattributes`, `.npmrc` and `server/scripts/` are full-run triggers; a refresh's traced
    failures make its trace shard red on `main`, as §5.4 says; `map-build` refuses a map whose `git` floor or walk floor
    is broken; macOS shards are capped by event, not by mode; `probe-macos` runs only on pull requests and the schedule.
11. **A dispatched `mode: rebuild`** runs the traced rebuild on demand — used to build a branch-scoped map for the
    pre-merge replay, which the artifact picker never serves to anyone else.
12. **Known trace-time pressure.** `session-hook` traced in 823 s on the loaded development box against a 900 s per-file
    budget; its tests also fail under tracing (timing budgets), so it stays `unknown` and always selected. The spike
    measures the heaviest traced times on a real runner and the plan raises the budget or isolates the file if needed.

The bounded second review round (closure of the 43, plus a fresh pass over the new surface) added:

13. **Directory symlinks and the floors.** A test that links a whole repository directory into a fixture home and then
    only stats or probes a file through the link leaves no resolved path for that file; the directory is recorded as a
    `subtree`, and any change under it selects the test (rule 6). A broken `git` or walk floor no longer stops the map:
    the violators are published as `unknown` (always selected) and `map-build` goes red afterwards, so one legitimate
    refactor of a floor test cannot freeze the map until it expires.
14. **The acceptance dataset is frozen.** The replay runs over the study's frozen set (§11.3) and over a fresh collection
    of newer failures, and reports each set's size, because a fresh collection from live job logs finds only about a
    third of the study's window.
15. **The hosted-runner spike (2026-09-24, run 35956714840).** strace 6.8 on the runner's kernel 6.17 prints every
    shape the parser needs, and the thread-group split holds (25 `CLONE_THREAD` clones; `server/test` listed on a
    root thread). Tracing cost 3.8–5.75× on the four heaviest files; the heaviest, `ccd-ws-audit`, traced in
    1,020 s, so the per-file trace deadline is 1,560 s and the trace profile's scale is 6 — superseding item 12's
    estimate. `session-hook` fails under trace in its own nested-strace case and stays `unknown`. The syscall
    families outside the trace list are mutations, fd-only calls and libuv's epoll-ctl ring, and none named a
    repository path (§9's new row).
