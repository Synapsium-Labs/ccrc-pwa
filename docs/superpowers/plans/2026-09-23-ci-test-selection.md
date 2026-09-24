# CI Test Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull-request CI runs only the server tests a change could affect, decided from a traced dependency map and
split across parallel runners; the full suite runs daily on `main` and gates every promotion to `stable`.

**Architecture:** One `select` job in `ci.yml` decides a mode from the trigger and, for a pull request, diffs the tree
under test against the commit of the newest dependency map (an artifact of a trusted `main` run — never the
Actions cache, whose pull-request scope a pull request can write) and picks the server test files whose
recorded reads, failed probes, directory listings or whole linked directories the change touches — falling back to
the full suite on any doubt.
The map is produced by running each server test file under `strace -ff -ttt -y` (every descendant process included), rebuilt
in full by the daily run and patched after each merge by re-tracing only the affected tests. Selected files are packed
onto 1–5 Linux runners by measured duration; a summary job keeps the required name `test (server)`. The change lands in
**shadow mode** (selection computed and reported, everything still run) and is enforced by a one-line flip after a
replay of real CI history.

**Tech Stack:** GitHub Actions (`ubuntu-latest`, `macos-latest`; `actions/upload-artifact` / `download-artifact` v4,
`gh run download`, the Actions REST API for artifacts, reusable workflows), Node 22 ESM scripts under `.github/ci/` using `node:` builtins only,
vitest 4.1.10, strace 6.8, git.

**Spec:** `docs/superpowers/specs/2026-09-23-ci-test-selection-design.md` — read it before any task; this plan argues
from it, and the section numbers below (§N) are its sections.

## Global Constraints

- The four required checks are always reported by name: `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`.
- No workflow-level `paths:` / `paths-ignore:` filter; no job-level `if:` on the required `test` matrix or on
  `build-pwa` (they skip by step-level `if:`); `test (server)` is a summary job with `if: always()` that checks every
  `needs` result itself (§4.2).
- Every job in `ci.yml`, `release.yml` and `release-main.yml` declares a first `timeout-minutes` between 1 and 60;
  `ci.yml` keeps top-level `permissions: contents: read`, `pull_request` present, `pull_request_target` absent, and no
  `secrets.` reference (`oss-metadata.test.ts`).
- No organisation name on any code line of a workflow — derive it from `${{ github.repository }}`
  (`single-definition.test.ts`).
- `release-stable.yml` triggers on `push: branches: [stable]` only, keeps concurrency group `release-stable` with
  `cancel-in-progress: false`, `promote` keeps `permissions: contents: write` alone and `timeout-minutes: 10`, it never
  contains `npm ci`, `npm run`, `setup-node`, `gh release` or `attest`, and the text `workflow_call` never appears in
  it (`build-release.test.ts`).
- `fetch-depth: 0` on every job that runs server tests or the selector (`topology-clean`, `deviation-refs` need
  `origin/main`).
- Linux server shards 1–5; macOS shards at most 2 on any pull request (even one that falls back to full) and 4 on a
  scheduled, dispatched or called full run, inside the organisation's 5-job macOS cap; `test-macos` stays non-required; `probe-macos` stays independent of the selector.
- `.github/ci/*.mjs` use `node:` builtins only (the `select` job runs before any `npm ci`). The selector never answers
  "nothing" on an error: it answers `full` and says why.
- `ci.yml` lands with `CCRC_SELECTION: shadow`. The flip to `enforce` is Task 15, only after the operator has seen the
  replay numbers.
- Node floor `>=22.13.0`; CI uses `setup-node` `node-version: '22'`.
- Tests: `./node_modules/.bin/vitest run test/<file>.test.ts` from inside the package, never `npx`; fixture
  directories via `mkTmp` from `./tmpHelpers.js`; never the live `$HOME`, tmux or `ccd` state.
- Commits are authored by the operator's GitHub identity with its noreply address; check `git log --format='%an <%ae>' origin/main..HEAD`
  before every push. No tailnet or docserver URL, IP address or email address in any committed file; no new
  deviation number or placeholder deviation token (numbers are minted by the ledger API only).
- The branch is green only on the FULL server suite run sharded (`--shard=1/6` … `--shard=6/6` — the same `n` in
  every shard, so their union is every file once), plus the agent and pwa suites. A named list of suites is a floor, never the verdict.

## Review Focus

Inputs the spec implies but no rule of §6 names — each has a test in the task that owns the code:

1. **A trace shard that crashes or is cancelled during a refresh.** The tests it was meant to re-trace must become
   `unknown` (always selected), never keep their stale entries — Task 4 (`refresh --traced`), wired in Task 11.
2. **A test file path containing whitespace.** Shard matrices space-join paths; the selector must refuse loudly
   (red `select`, red `test (server)`) rather than run the wrong files — Task 9.
3. **The daily run's "already green" API call failing** (rate limit, network). It must resolve to "not green" and run
   the full suite, never skip — Task 11.
4. **A refresh racing the daily rebuild's publish.** `map-build` must refresh against exactly the map `select`
   used (the `select-inputs` artifact), never a fresh fetch, and publish only if that map is still the newest
   trusted one when checked just before the upload. The check and the upload are two steps, not one atomic act, so
   this narrows the race to the seconds between them rather than closing it: the worst case is that a rebuild's
   corrections wait for the next rebuild, and selection stays safe because every map is a correct map for its own
   commit — Task 11.
5. **A PR that renames a test file.** The new name is selected by rule 1; the old name is no longer a live test and
   its map entry causes no error — Task 5.
6. **A pull request that plants its own map, or edits the selector.** The map and durations come only from
   artifacts of `ci.yml` runs on `main` of this repository triggered by `push`, `schedule` or `workflow_dispatch`
   (Task 11's `main-artifact.mjs`); a pull request that changes `.github/` runs everything, decided in plain bash
   before the selector runs; `verdict.mjs` fails closed and both verdicts sit behind a script-free step; `select`
   refuses to answer `tests: none` for a pull request — Tasks 8, 9, 11.
7. **A test that links a whole repository directory into a fixture home**, then only stats or probes a file through
   the link. No syscall names the file inside the repository, so the directory itself is recorded (`subtree`) and
   any change at or under it selects the test (rule 6) — Tasks 3, 4, 5.
8. **A test that always fails under tracing, and a floor test that loses its breadth.** Neither may stop the map:
   the map is written and published with each as `unknown` (always selected); `map-build` then goes red only for
   news — a traced test that NEWLY fails (exit 3) or a floor violation (exit 4) — Tasks 4, 7, 11.

---

### Task 1: Spike on a hosted runner (temporary workflow; stop-or-go)

Spec §12 step 1. Nothing later in this plan is built until this task's decision says GO. The spike is two
TEMPORARY workflow files that trigger on pushes to `ws/ccrc-ci-runs-optimization` only, gate nothing, and are
deleted in this task's last step.

**Files:**
- Create: `.github/workflows/ci-spike.yml`
- Create: `.github/workflows/ci-spike-callee.yml`
- Modify (Step 6): `docs/superpowers/plans/2026-09-23-ci-test-selection.md` — this plan, its results table filled
- Delete (Step 7): both workflow files

**Interfaces:** Consumes: nothing. Produces: the measured answers recorded in the task's results table (Step 6) —
strace works, the syscall census, the async/realpath probe, the baseline footprint and its process split,
tracing overhead per file, the check-run name of a called job, and what `github.workflow` evaluates to inside a
called workflow. Tasks 3, 6, 7, 11 and 12 read those answers (see the decision rule).
- Changed in integration: the probe, baseline and overhead steps trace with Task 7's exact `traceArgv` flags and
  list (`-ttt`; `readlink`, `symlink`, `symlinkat`, `chdir`, `fchdir`, `clone`, `clone3` in the list), under
  `UV_USE_IO_URING=0`, and the baseline runs through the same `sh -c 'echo $$ > "$0"; exec "$@"'` root-pid wrapper
  and prints `SPIKE-SPLIT`: the root/rest split of Tasks 3, 4 and 7 rebuilds the vitest root process's thread
  group from `clone`/`clone3` lines, so the runner's strace must print them (on the fleet box the include glob's
  walk of `server/test` was measured on a root threadpool thread, never in the root pid's own file). Every line
  now starts with `-ttt`'s `<seconds>.<micros> ` stamp, so the baseline step's line-anchored greps allow it —
  anchored at `^clone3?\(` they matched nothing and printed `clone_thread_lines=0`, a false STOP (measured). The
  probe also makes a symlink (`ln -s`), and the overhead matrix adds `session-hook.test.ts`, the heaviest traced
  file measured on the fleet box.

- [ ] **Step 1: Write the caller workflow** — `.github/workflows/ci-spike.yml`, exactly:

<!-- file: .github/workflows/ci-spike.yml -->
```yaml
# TEMPORARY — the stop-or-go spike of the CI test-selection design (spec
# 2026-09-23 §12 step 1). It measures, on a real ubuntu-latest runner, the
# facts the rest of the plan builds on, and it is DELETED in the commit after
# its results are read. It never gates anything: it triggers on this one
# branch only, and no ruleset requires any of its checks.
name: ci-spike

permissions:
  contents: read

on:
  push:
    branches: [ws/ccrc-ci-runs-optimization]

# The same expression shape the real ci.yml uses. Call `collide` passes the
# suffix `collide`, so if a called workflow evaluates `github.workflow` as
# the CALLER's name, its group equals this one and GitHub must say so.
concurrency:
  group: ci-${{ github.workflow }}-collide
  cancel-in-progress: false

jobs:
  # Q1: does strace -f -ff -ttt -y run here at all, and does it print what the
  # parser needs — a timestamp, an fd shown as its path, a failed probe, a
  # listing, a chdir, a symlink made to a repository file.
  strace-probe:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json
      - name: Install system dependencies
        run: sudo apt-get update && sudo apt-get install -y tmux jq strace
      - name: Install
        run: |
          (cd server && npm ci)
          (cd agent && npm ci)
          (cd pwa && npm ci)
      - name: strace version and the four-shape probe
        run: |
          strace -V | head -1
          p="$RUNNER_TEMP/probe"; mkdir -p "$p/sub"; echo hi > "$p/a.txt"
          cd "$p"
          strace -f -ff -ttt -y -qq \
            -e trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3 \
            -o "$p/t" sh -c 'cd sub && cat ../a.txt; ls .; ln -s ../a.txt lnk; test -e nope' \
            || echo "probe exit $? (expected 1: the last command is the failed probe)"
          echo "--- per-pid files: $(find "$p" -maxdepth 1 -name 't.*' | wc -l)"
          for f in "$p"/t.*; do echo "=== $f"; grep -E 'a\.txt|nope|getdents64|chdir|symlink' "$f" || true; done
      # Node's asynchronous fs goes through libuv, which can submit through
      # io_uring on a new enough kernel — and io_uring ops are not in the
      # trace list. realpathSync.native probes with `readlink`, which is not
      # in it either (measured on the fleet box: a missing path shows ONLY a
      # readlink ENOENT). Both asked here, on the runner's own kernel, with
      # NO syscall filter, so the answer is what the kernel was asked.
      - name: Async fs and realpath.native under an unfiltered trace
        run: |
          uname -r; node -p 'process.versions.uv'
          p="$RUNNER_TEMP/async"; mkdir -p "$p/tr"; echo hi > "$p/b.txt"
          cd "$p"
          strace -f -ff -y -qq -o "$p/tr/t" node -e "const fs=require('fs');fs.promises.readFile('b.txt').then(()=>fs.promises.stat('nope2')).catch(()=>{}).then(()=>fs.promises.readdir('.')).then(()=>{try{fs.realpathSync.native('nope3/x')}catch{}})"
          echo "--- every line naming the probe paths:"
          grep -hE 'b\.txt|nope2|nope3' "$p"/tr/t.* || echo '(none)'
          echo "--- io_uring submissions: $(cat "$p"/tr/t.* | grep -c '^io_uring_enter' || true)"
      # Q2: whether the syscall list above misses a file-shaped family. A
      # count of EVERY syscall one spawning-heavy file makes, all processes.
      - name: Every syscall one ccd test file makes
        working-directory: server
        run: |
          strace -f -qq -c -o "$RUNNER_TEMP/census.txt" ./node_modules/.bin/vitest run test/ccd-ws-audit.test.ts > /dev/null 2>&1 || echo "vitest exit $?"
          cat "$RUNNER_TEMP/census.txt"
          echo "--- file-shaped syscalls NOT in the trace list:"
          awk 'NR>2 && $NF ~ /^[a-z_0-9]+$/ {print $NF}' "$RUNNER_TEMP/census.txt" \
            | grep -E 'open|stat|access|link|dents|exec|chdir|uring|name_to_handle|mknod|rename|unlink|utime|chmod|chown|xattr|truncate|mkdir|rmdir|getcwd' \
            | grep -vxE 'openat|openat2|open|newfstatat|statx|access|faccessat2|readlink|readlinkat|getdents64|execve|execveat|symlink|symlinkat|chdir|fchdir|clone|clone3' || echo '(none)'
      # Q3: vitest's own startup footprint — a trivial test file traced with
      # the same invocation, its repository reads counted. Through the same
      # `sh -c 'echo $$ > "$0"; exec "$@"'` wrapper trace-run.mjs uses, so the
      # vitest root pid is known: the map subtracts the baseline per process
      # (root vs the rest), and rebuilds the root's thread group from the
      # clone/clone3 lines — so those must be in the output (Q3b).
      - name: Baseline footprint of a trivial test file
        working-directory: server
        run: |
          printf "import { it, expect } from 'vitest';\nit('baseline', () => { expect(1).toBe(1); });\n" > test/zz-spike-baseline.test.ts
          t="$RUNNER_TEMP/base"; mkdir -p "$t"
          # shellcheck disable=SC2016 # $$, $0 and $@ are sh's own, expanded by sh
          UV_USE_IO_URING=0 strace -f -ff -ttt -y -qq \
            -e trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3 \
            -o "$t/t" sh -c 'echo $$ > "$0"; exec "$@"' "$RUNNER_TEMP/root.pid" ./node_modules/.bin/vitest run test/zz-spike-baseline.test.ts
          echo "--- pids: $(find "$t" -maxdepth 1 -name 't.*' | wc -l)"
          # Every line starts with -ttt's `<seconds>.<micros> ` stamp.
          echo "SPIKE-SPLIT root_pid=$(cat "$RUNNER_TEMP/root.pid") clone_thread_lines=$(cat "$t"/t.* | grep -cE '^[0-9.]+ clone3?\(.*CLONE_THREAD' || true)"
          echo "--- pid files that list server/test (the root pid's own file, or one of its threads):"
          grep -lE "^[0-9.]+ getdents64\([0-9]+<${GITHUB_WORKSPACE}/server/test>" "$t"/t.* || echo '(none)'
          echo "--- repository paths opened (node_modules excluded):"
          cat "$t"/t.* | grep -oE "\"${GITHUB_WORKSPACE}/[^\"]*\"" | grep -v node_modules | sort -u
          echo "--- repository directories listed:"
          cat "$t"/t.* | grep -E '^[0-9.]+ getdents64' | grep -oE "<${GITHUB_WORKSPACE}[^>]*>" | grep -v node_modules | sort -u

  # Q4: tracing's wall-clock cost on the three heaviest files, untraced then
  # traced, installed exactly as the server leg installs — and on
  # session-hook.test.ts, the heaviest TRACED file measured on the fleet box
  # (about 25,000 trace files; 823 s traced, against trace-run's 900 s
  # per-file timeout).
  overhead:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        file: [test/ccd-ws-audit.test.ts, test/ccrc-doctor.test.ts, test/ccd-ws-reap.test.ts, test/session-hook.test.ts]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json
      - name: Install system dependencies
        run: sudo apt-get update && sudo apt-get install -y tmux jq strace
      - name: Install
        run: |
          (cd server && npm ci)
          (cd agent && npm ci)
          (cd pwa && npm ci)
      - name: Untraced, then traced
        working-directory: server
        env:
          FILE: ${{ matrix.file }}
        run: |
          set +e
          s=$(date +%s%N); ./node_modules/.bin/vitest run "$FILE" > "$RUNNER_TEMP/plain.log" 2>&1; rc1=$?; e=$(date +%s%N)
          plain=$(( (e - s) / 1000000 ))
          t="$RUNNER_TEMP/tr"; mkdir -p "$t"
          s=$(date +%s%N)
          UV_USE_IO_URING=0 strace -f -ff -ttt -y -qq \
            -e trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3 \
            -o "$t/t" ./node_modules/.bin/vitest run "$FILE" > "$RUNNER_TEMP/traced.log" 2>&1; rc2=$?
          e=$(date +%s%N)
          traced=$(( (e - s) / 1000000 ))
          tail -5 "$RUNNER_TEMP/plain.log"; tail -5 "$RUNNER_TEMP/traced.log"
          echo "SPIKE-OVERHEAD file=$FILE untraced_ms=$plain rc=$rc1 traced_ms=$traced rc=$rc2 ratio=$(awk -v a="$traced" -v b="$plain" 'BEGIN{printf "%.2f", a/b}') pids=$(find "$t" -type f | wc -l) trace_bytes=$(du -sb "$t" | cut -f1)"

  # Q5 and Q6: a job inside a called workflow — what its check run is NAMED,
  # and what `github.workflow` (so a concurrency group) evaluates to there.
  # Call `full` cannot collide; call `collide` collides iff the callee sees
  # the caller's workflow name. `names` waits on `full` ONLY: if a collision
  # leaves `collide` pending rather than cancelled, the names still arrive,
  # and the pending job is read (and cancelled) from `gh run view`.
  full:
    uses: ./.github/workflows/ci-spike-callee.yml
    with:
      group: probe
  collide:
    uses: ./.github/workflows/ci-spike-callee.yml
    with:
      group: collide

  names:
    needs: full
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      checks: read
    steps:
      - name: Check-run names on this commit
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          SHA: ${{ github.sha }}
          FULL_RESULT: ${{ needs.full.result }}
        run: |
          echo "SPIKE-CALL full=$FULL_RESULT"
          gh api --paginate "repos/$REPO/commits/$SHA/check-runs?per_page=100" \
            --jq '.check_runs[] | "SPIKE-CHECK name=\(.name) status=\(.status) conclusion=\(.conclusion) app=\(.app.slug)"'
```

- [ ] **Step 2: Write the called workflow** — `.github/workflows/ci-spike-callee.yml`, exactly:

<!-- file: .github/workflows/ci-spike-callee.yml -->
```yaml
# TEMPORARY — the called half of ci-spike.yml (spec 2026-09-23 §12 step 1).
# Deleted with it.
name: ci-spike-callee

permissions:
  contents: read

on:
  workflow_call:
    inputs:
      group:
        type: string
        required: true

concurrency:
  group: ci-${{ github.workflow }}-${{ inputs.group }}
  cancel-in-progress: false

jobs:
  full-suite:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: What the called workflow's context says
        env:
          WF: ${{ github.workflow }}
          EVENT: ${{ github.event_name }}
          REF: ${{ github.ref }}
          GROUP: ci-${{ github.workflow }}-${{ inputs.group }}
          WF_REF: ${{ github.workflow_ref }}
        run: echo "SPIKE-CALLEE workflow=$WF event=$EVENT ref=$REF group=$GROUP workflow_ref=$WF_REF"
```

- [ ] **Step 3: Validate both files with actionlint** (validation only; the binary lives in a scratch dir, never in
  the tree). From the repo root:

```bash
AL=$(mktemp -d)
curl -sfL -o "$AL/al.tgz" https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz
tar xzf "$AL/al.tgz" -C "$AL" actionlint
"$AL/actionlint" .github/workflows/ci-spike.yml .github/workflows/ci-spike-callee.yml; echo "rc=$?"
```

  Expected: no findings, `rc=0` (actionlint runs shellcheck over every `run:` when `shellcheck` is on PATH; it
  was, when this was measured — the baseline step's `# shellcheck disable=SC2016` is for the root-pid wrapper,
  whose `$$`, `$0` and `$@` are deliberately left for `sh` to expand).

  Optional local replay of the probe step (fixture dir only; strace 6.8 on the fleet box printed exactly these
  shapes, each line after its `<seconds>.<micros> ` stamp): the probe's last command `test -e nope` exits 1, which
  is why the step carries `|| echo "probe exit …"` — without it the runner's default `bash -e` fails the step.
  Expected lines across the 4 pid files: `chdir("<abs>/sub") = 0`, `newfstatat(AT_FDCWD</…/sub>, "nope", …) = -1
  ENOENT`, `openat(AT_FDCWD</…/sub>, "../a.txt", O_RDONLY) = 3</…/a.txt>`,
  `getdents64(3</…/sub>, … /* 2 entries */, 32768) = 48`, `symlinkat("../a.txt", AT_FDCWD</…/sub>, "lnk") = 0`.
  The baseline step, replayed locally the same way (`RUNNER_TEMP` and `GITHUB_WORKSPACE` pointed at a scratch dir
  and this checkout, cwd `server/`), printed `--- pids: 60`, `SPIKE-SPLIT root_pid=<n> clone_thread_lines=58`, and
  ONE pid file listing `server/test` — not the root pid's own.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci-spike.yml .github/workflows/ci-spike-callee.yml
git commit -F - <<'EOF'
ci(spike): measure strace, trace overhead and called-workflow naming on a hosted runner

Temporary: spec 2026-09-23 §12 step 1. Deleted in the commit after its
results are read.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Push, wait, and read the results**

```bash
git push origin ws/ccrc-ci-runs-optimization
gh run list --branch ws/ccrc-ci-runs-optimization --workflow ci-spike.yml --limit 1 --json databaseId,status,conclusion
RUN=<databaseId from the line above>
gh run view "$RUN" --json status,conclusion,jobs --jq '.status, .conclusion, (.jobs[] | "\(.name)\t\(.status)\t\(.conclusion)")'
```

  Poll the last command until `status` is `completed` (the four `overhead` legs take the longest: two runs of a
  heavy server file, one of them under strace — under 60 minutes by their deadline). If the `collide` job
  (named `collide / full-suite`) is still `queued`/`waiting` 15 minutes after every other job completed, record
  "pending — no deadlock detection" and cancel it: `gh run cancel "$RUN"`. Then read the answers (if a `step`
  call prints nothing, gh could not attribute that step's lines — it prints `UNKNOWN STEP` then — so read the whole
  job instead: `gh run view "$RUN" --json jobs --jq '.jobs[] | "\(.databaseId) \(.name)"'`, then
  `gh run view --job <databaseId> --log`):

```bash
LOG=$(mktemp)
gh run view "$RUN" --log > "$LOG"
# gh prints `<job>\t<step>\t<timestamp> <line>`; print one step's output by a prefix of its name.
step() { awk -F'\t' -v s="$1" 'index($2, s) == 1 {print $3}' "$LOG"; }
step 'strace version and the four-shape probe'      # Q1
step 'Every syscall one ccd test file makes' | tail -25   # Q2: the census tail and the NOT-in-list lines
step 'Async fs and realpath.native'                  # Q2b: kernel, libuv, probe lines, io_uring count
step 'Baseline footprint of a trivial test file'     # Q3, Q3b
grep -h 'SPIKE-OVERHEAD' "$LOG"                      # Q4
grep -hE 'SPIKE-CALLEE|SPIKE-CALL |SPIKE-CHECK' "$LOG"   # Q5, Q6
gh run view "$RUN" --json jobs --jq '.jobs[] | select(.name | startswith("collide")) | "\(.name)\t\(.status)\t\(.conclusion)"'
```

- [ ] **Step 6: Record the answers and apply the decision rule.** Copy each answer into this table in this plan,
  `docs/superpowers/plans/2026-09-23-ci-test-selection.md` (committed in Step 7; the PR description carries it too):

  | Question | What the log says | Consequence |
  |---|---|---|
  | Q1 strace runs, prints `-ttt` stamps, `-y` paths, a failed probe, a listing, a chdir, a symlinkat | strace -- version 6.8; 4 pid files; every line stamped `<seconds>.<micros>`; `openat(AT_FDCWD</…/sub>, "../a.txt", O_RDONLY) = 3</…/a.txt>`; `newfstatat(AT_FDCWD</…/sub>, "nope", …) = -1 ENOENT`; `getdents64(3</…/sub>, … /* 2 entries */, 32768) = 48`; `chdir("…/sub") = 0`; `symlinkat("../a.txt", AT_FDCWD</…/sub>, "lnk") = 0` | none — STOP rule 1 does not fire |
  | Q2 file-shaped syscalls outside the trace list | outside the list, from the unfiltered census of `ccd-ws-audit`: fd-only `fstat`, `fstatfs`, `ftruncate`, `fchmod`, `fchown`; path-less `getcwd`, `io_uring_setup`; `io_uring_enter`; the mutations `unlink`, `unlinkat`, `mkdir`, `rmdir`, `rename`, `renameat`, `renameat2`, `link`, `chmod`, `utimensat`; and `statfs` | no trace-list change — traced on the fleet box with exactly those families (under `UV_USE_IO_URING=0`), `ccd-ws-audit` made 43,089 such calls and none named a repository path (every dirfd-relative one resolved under a `/tmp` fixture; `statfs` probed selinux mount points and fixture dirs); one row added to spec §9's limits table |
  | Q2b async fs / `realpathSync.native` visible, io_uring submission count | kernel 6.17.0-1022-azure, libuv 1.51.0; unfiltered and WITHOUT `UV_USE_IO_URING=0`: `openat(…, "b.txt", …) = 20</…/b.txt>`, `statx(…, "nope2", …) = -1 ENOENT`, `readlink("…/nope3", …) = -1 ENOENT`; 3 `io_uring_enter` submissions; the step's grep prints no `getdents64` line because its pattern names only the three probe paths | none — async fs is visible; `readdir` under the real trace config is shown by Q3's listing of `server/test`; on the fleet box under `UV_USE_IO_URING=0` every `io_uring_setup` was libuv's 256-entry epoll-ctl ring, never a file-I/O ring |
  | Q3 baseline footprint (repo paths read, dirs listed) | repository paths read: `deno.json`, `deno.jsonc`, `lerna.json`, `package.json`, `pnpm-workspace.yaml` at the root and in `server/`; `server/.env`, `.env.local`, `.env.test`, `.env.test.local`; `server/.postcssrc*` and `server/postcss.config.*`; `server/public`; the test file with vite's extension probes; directory listed: `server/test` | as measured locally — Task 2's baseline reproduces it |
  | Q3b `SPIKE-SPLIT`: root pid, `CLONE_THREAD` clone lines, which pid file lists `server/test` | `SPIKE-SPLIT root_pid=100814 clone_thread_lines=25`; 27 pid files; `server/test` listed by ONE pid file, a root thread — not the root pid's own file | none — STOP rule 4 does not fire; the thread-group split is needed, and works |
  | Q4 untraced ms / traced ms / ratio / rc, per file | `ccd-ws-audit` 228213 / 1020449 / 4.47 / 0,0; `ccrc-doctor` 213434 / 806849 / 3.78 / 0,0; `ccd-ws-reap` 191335 / 840433 / 4.39 / 0,0; `session-hook` 68055 / 391278 / 5.75 / 0,1 — its traced failure is its own `straceRun` case (strace cannot attach under an outer strace: `PTRACE_TRACEME: Operation not permitted`) | Task 6's `PROFILES.trace.scale` 4 → 6 (5.75 rounded up); Task 11's trace-run `--timeout 900` → `--timeout 1560` (1.5 × 1,020,449 ms, rounded up to 26 min, under the trace-shard job's 60); `session-hook` stays `unknown` under trace, as Tasks 4 and 11 already expect |
  | Q5 check-run name of the called job | `full / full-suite` (success) | as expected — the matcher in Tasks 11 and 12 is unchanged |
  | Q6 `github.workflow` inside the callee; `collide` outcome | `SPIKE-CALLEE workflow=ci-spike event=push … group=ci-ci-spike-probe` — the callee sees the CALLER's name; `collide`: no job was ever created, and the run concluded `failure` with no annotation naming it | no change — ci.yml's group, called from release-stable, evaluates to `ci-release-stable-…`, distinct from `release-stable` |

  **Recorded 2026-09-24 (run 35956714840): GO.** STOP rule 3 fires literally on session-hook (untraced rc=0, traced
  rc=1), but its cause is a nested strace in the test's own `straceRun` case — the class Task 7 handles with
  `CCRC_TRACING` for its own file — and Tasks 4 and 11 already carry session-hook as a test that always fails under
  trace (`unknown`, so rule 2 selects it for every change); spec §12 stops only if strace cannot run, and it runs.
  Rules 1, 2 and 4 do not fire. Carried into the later tasks: Task 6 `scale: 6`; Task 11 `--timeout 1560`; spec §9's
  new limits row.

  **STOP** — do not start Task 2; report the table to the operator (spec §12: "If `strace` cannot run there, the
  design stops") — if ANY of:
  1. the probe step failed, printed no `strace -- version` line, or its per-pid files lack any one of: an `openat`
     of `../a.txt` whose return value prints the resolved `<…/a.txt>` path; a stat/access-family call on `nope`
     returning `-1 ENOENT`; a `getdents64(N<…/sub>` line; a `chdir(` line; a `symlinkat(` (or `symlink(`) line
     naming `../a.txt`; or any of these lines lacks its leading `<seconds>.<micros>` stamp — Task 3 orders each
     process's cwd changes by it;
  2. the async probe lacks the `openat` of `b.txt`, the `ENOENT` on `nope2`, or a `getdents64` — the runner's
     kernel serves Node's async fs through io_uring, which strace's syscall list cannot see, so a map would miss
     every async read;
  3. any `SPIKE-OVERHEAD` line shows untraced `rc=0` and traced `rc≠0` — tracing itself breaks a test, so every
     traced record of it would be `unknown`;
  4. `SPIKE-SPLIT` shows `clone_thread_lines=0`, or no pid file lists `server/test` — the root process's thread
     group cannot be rebuilt, so the per-process baseline subtraction (Task 4) cannot tell the include glob's walk
     of `server/test` from a test's own.

  **GO** otherwise, carrying these adjustments into the later tasks BEFORE they are built:
  - Q2/Q2b: every path-taking syscall the census lists outside the trace list is added to Task 7's `traceArgv`
    `-e trace=` list and to Task 3's parser, or written into spec §9's limits table with the operator. Already
    measured on the fleet box (kernel 6.8, libuv 1.51) and already built in: `fs.realpathSync.native('missing/x')`
    emits ONLY `readlink("…/missing", …) = -1 ENOENT`, so `readlink` is in Task 7's list and Task 3 parses it like
    `access`; and Task 7 runs every trace with `UV_USE_IO_URING=0`, which keeps libuv's fs on its threadpool.
  - Q4: if the largest traced/untraced ratio exceeds 4.0, Task 6's `PROFILES.trace.scale` becomes that ratio
    rounded up (the contract's 4 assumes ≤ 4.0). And the heaviest `traced_ms` is checked against the per-file
    deadline Task 11 hands trace-run (`--timeout 900`, i.e. 900000 ms): above 900000 / 1.5 = 600000 ms, raise that
    `--timeout` in Task 11's Trace step to 1.5 × the heaviest `traced_ms`, rounded up to a whole minute and kept
    under the trace-shard job's 60-minute deadline — or, past that, give the file a trace shard of its own. A file
    past its deadline is recorded `unknown` on every rebuild, and turns `map-build` red on the first build that sees
    it (Task 4 exits 3 for a traced test that newly fails or times out). On the
    fleet box `session-hook.test.ts` traced in 823 s without `-ttt` and was killed at the 900 s deadline with it (a
    loaded box); the runner's number decides.
  - Q5: expected `full / full-suite`. Tasks 11 and 12 match `full-suite` or a name ending `/ full-suite`; if the
    measured shape differs, change the jq matcher in BOTH `ci.yml` (select's "already green" step) and
    `release-stable.yml` (`gate`) to the measured shape — `build-release.test.ts` holds the two equal.
  - Q6: `SPIKE-CALLEE workflow=ci-spike` means a called workflow sees the CALLER's name, so ci.yml's group, called
    from release-stable, evaluates to `ci-release-stable-full-push-stable` — distinct from `release-stable` by its
    `ci-` prefix, as Task 11 writes it. `collide` cancelled with a deadlock message confirms the evaluation context;
    `collide` running normally while `workflow=ci-spike` means GitHub does not apply a called workflow's
    workflow-level concurrency — no change needed (no job relies on it for correctness), record it.
  - Q3: the listed repo paths are what Task 2's baseline trace must reproduce; locally a trivial vitest file probed
    `deno.json`, `lerna.json`, `pnpm-workspace.yaml`, `package.json` at the repo root and in `server/`, plus
    `server/.env*`, `server/postcss.config.*` and `server/.postcssrc*` (60 processes).

- [ ] **Step 7: Delete the spike and commit the results table** (a follow-up commit, once the table is filled)

```bash
git rm .github/workflows/ci-spike.yml .github/workflows/ci-spike-callee.yml
git add docs/superpowers/plans/2026-09-23-ci-test-selection.md
```

```bash
git commit -F - <<'EOF'
ci(spike): remove the spike workflows — results recorded in the plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git push origin ws/ccrc-ci-runs-optimization
ls .github/workflows
```

  Expected: `ci.yml  release-main.yml  release-stable.yml  release.yml`, and no new `ci-spike` run for the push
  (`gh run list --branch ws/ccrc-ci-runs-optimization --workflow ci-spike.yml --limit 1` still shows `$RUN`).

  The history guards, measured in the integration clone at both spike commits (each file run alone, from
  `server/`, `./node_modules/.bin/vitest run test/<f>.test.ts --maxWorkers=2`): `topology-clean` 55 passed,
  `source-bytes` 2, `single-definition` 160, `dtbd` 1 — and `deviation-refs` 31 at the first.


### Task 2: Exact-list vitest config + baseline test

**Files:**
- Create: `server/vitest.select.config.ts`
- Create: `server/test/ci-baseline.test.ts`
- Test: `server/test/ci-vitest-select-config.test.ts`

**Interfaces:** Consumes: `vitest.config.ts`'s default export (`UserConfig`), `process.env.CCRC_TEST_LIST` /
Produces: default export `UserConfig` consumed by every `vitest run --config vitest.select.config.ts` invocation
(the shards of Task 11, the per-file traces of Task 7), and the baseline test file Task 7 traces first.

- [ ] **Step 1: Write the failing test**

  Create `server/test/ci-vitest-select-config.test.ts`:

<!-- file: server/test/ci-vitest-select-config.test.ts -->
```ts
// `server/vitest.select.config.ts` (spec §7.2, contract Task 2): CCRC_TEST_LIST unset behaves exactly like
// vitest.config.ts; set, test.include becomes EXACTLY the listed paths (never appended to the base glob —
// mergeConfig concatenates array fields, which this config works around; see its own header comment).
//
// Each scenario spawns a fresh `tsx` process to import the config module, rather than re-importing it in-process
// with a cache-busting query string: vite's `vite:oxc` transform plugin, hit with several concurrent
// differently-queried imports of the SAME underlying path in one process (which is what repeated
// `import('...ts?t=...')` calls in a single vitest worker do), was observed to intermittently mis-parse the file
// it had just transformed correctly moments before — a caching race in the dev transform pipeline, not a defect
// in this repo's code. A fresh process per scenario is also closer to how CI actually loads this file: each
// `vitest run --config vitest.select.config.ts` invocation is its own process.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const tsx = path.join(serverRoot, 'node_modules', '.bin', 'tsx');

/** Runs the select config module in a fresh `tsx` process (optionally with `CCRC_TEST_LIST` set) and returns its
 *  resolved `test` block, or throws with the child's stderr on a non-zero exit. */
function loadSelectConfig(listFile?: string): { test: Record<string, unknown> } {
  const target = path.join(serverRoot, 'vitest.select.config.ts').replace(/\\/g, '/');
  const script = [
    `import mod from '${target}';`,
    'process.stdout.write(JSON.stringify(mod));',
  ].join('\n');
  const dir = mkTmp('ccrc-select-cfg-runner-');
  const scriptFile = path.join(dir, 'run.mts');
  writeFileSync(scriptFile, script, 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (listFile === undefined) delete env.CCRC_TEST_LIST;
  else env.CCRC_TEST_LIST = listFile;
  const out = execFileSync(tsx, [scriptFile], { cwd: serverRoot, env, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

function loadBaseConfig(): { test: Record<string, unknown> } {
  const target = path.join(serverRoot, 'vitest.config.ts').replace(/\\/g, '/');
  const script = [
    `import mod from '${target}';`,
    'process.stdout.write(JSON.stringify(mod));',
  ].join('\n');
  const dir = mkTmp('ccrc-base-cfg-runner-');
  const scriptFile = path.join(dir, 'run.mts');
  writeFileSync(scriptFile, script, 'utf8');
  const out = execFileSync(tsx, [scriptFile], { cwd: serverRoot, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

describe('vitest.select.config.ts', () => {
  it('is identical to vitest.config.ts when CCRC_TEST_LIST is unset', () => {
    const select = loadSelectConfig(undefined);
    const base = loadBaseConfig();
    expect(select.test).toEqual(base.test);
  });

  it('replaces test.include with exactly the listed paths when CCRC_TEST_LIST is set', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/foo.test.ts\ntest/bar.test.ts\n\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).toEqual(['test/foo.test.ts', 'test/bar.test.ts']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('blank lines in CCRC_TEST_LIST are ignored', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, '\ntest/only.test.ts\n\n  \n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).toEqual(['test/only.test.ts']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT append the exact list onto the base glob (the mergeConfig array-concat trap)', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/only.test.ts\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).not.toContain('test/**/*.test.ts');
    expect(cfg.test.include).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws a clear error when CCRC_TEST_LIST points at a missing file', () => {
    expect(() => loadSelectConfig('/nonexistent/does-not-exist.txt')).toThrowError(/CCRC_TEST_LIST/);
  });

  it('throws a clear error when CCRC_TEST_LIST points at an empty file', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'empty.txt');
    writeFileSync(listFile, '\n   \n', 'utf8');
    expect(() => loadSelectConfig(listFile)).toThrowError();
    try {
      loadSelectConfig(listFile);
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr ?? e)).toMatch(/empty/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves non-include fields (testTimeout, maxWorkers) from the base config', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/only.test.ts\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    const base = loadBaseConfig();
    expect(cfg.test.testTimeout).toBe(base.test.testTimeout);
    expect(cfg.test.maxWorkers).toBe(base.test.maxWorkers);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

  Also create `server/test/ci-baseline.test.ts` (the baseline Tasks 4 and 7 subtract):

<!-- file: server/test/ci-baseline.test.ts -->
```ts
// The CI test-selection baseline (spec §5.2 "vitest's own startup is subtracted"). This file is traced with the
// same `vitest run --config vitest.select.config.ts` invocation as every real test, and what its trace records —
// `vitest.config.ts`, `package.json`, `tsconfig.json`, the `server/test/` directory listing the `include` glob
// makes — is subtracted from every other test's record by `.github/ci/testmap.mjs`'s `subtractBaseline`. It does
// no real work on purpose: any read it performed beyond vitest's own startup would be subtracted from every test
// in the repo, hiding a real dependency.
import { describe, it, expect } from 'vitest';

describe('ci baseline', () => {
  it('does nothing beyond vitest startup', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-vitest-select-config.test.ts --maxWorkers=2
```

  Measured (the config module does not exist yet, so every scenario's `tsx` child fails to import it):

```
 Test Files  1 failed (1)
      Tests  7 failed (7)
```

  with `Error: Command failed: …/node_modules/.bin/tsx …/run.mts` as the cause of each.

- [ ] **Step 3: Implement** — create `server/vitest.select.config.ts`:

<!-- file: server/vitest.select.config.ts -->
```ts
// CI test selection (spec `docs/superpowers/specs/2026-09-23-ci-test-selection-design.md` §7.2): vitest's own
// positional file arguments are SUBSTRING filters — `a.test.ts` also runs `xa.test.ts` (measured) — so a shard
// cannot hand vitest a file list on the command line and trust it to run exactly that list. This config is the
// fix: when `CCRC_TEST_LIST` names a file, `test.include` becomes EXACTLY the paths in it (vitest's `include`
// glob patterns match a literal path exactly when the pattern contains no glob metacharacters, which a plain
// repo-relative test path never does).
//
// Every other CI mechanism that runs server tests routes through this file: a sharded PR/full-mode run (§7.2),
// and every per-file traced run in `.github/ci/trace-run.mjs` (§5.1) — one file per `vitest run` invocation, via
// the same `CCRC_TEST_LIST` mechanism (a one-line list file).
//
// Unset `CCRC_TEST_LIST` (a developer running `npm test`, or any job that intentionally runs the full glob):
// this file resolves to something behaviourally IDENTICAL to `vitest.config.ts` — same `include`, same timeouts,
// same `maxWorkers`. `mergeConfig(base, {})` is used to reach that state (rather than re-exporting `base`
// directly) so this file and `vitest.config.ts` are provably the same merge machinery in both branches, not two
// different code paths that happen to agree today.
//
// `mergeConfig` (vite's, re-exported by `vitest/config`) DEEP-MERGES and, for array-valued fields, CONCATENATES
// them — `mergeConfig({test:{include:['a']}}, {test:{include:['b']}})` answers `include:['a','b']`, not `['b']`.
// Passing the exact-list straight into `mergeConfig`'s second argument would therefore APPEND it onto the base
// glob instead of replacing it, silently re-including every test the glob already matched. `test.include` is
// reassigned explicitly, after the merge, to avoid exactly that.
import { defineConfig, mergeConfig } from 'vitest/config';
import type { ViteUserConfig as UserConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import base from './vitest.config.js';

/** Reads `CCRC_TEST_LIST`: one server-relative test path per line, blank lines ignored. Throws a clear error
 *  (never returns an empty list, never falls back to the full glob) when the file is missing or carries no
 *  non-blank line — an empty selection silently running everything is exactly the failure mode §6.3 forbids. */
export function readTestList(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `vitest.select.config.ts: CCRC_TEST_LIST=${file} could not be read: ${msg}`,
    );
  }
  const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`vitest.select.config.ts: CCRC_TEST_LIST=${file} is empty`);
  }
  return lines;
}

const listFile = process.env.CCRC_TEST_LIST;

const merged: UserConfig = mergeConfig(base, defineConfig({}));

if (listFile) {
  merged.test = { ...merged.test, include: readTestList(listFile) };
}

export default merged;
```

  Note: `vitest/config` re-exports vite's `UserConfig` under the name `ViteUserConfig` (not `UserConfig` — that
  name doesn't exist on that module's surface), and NodeNext module resolution requires the explicit `.js`
  specifier for the sibling `.ts` file — both caught by `tsc -p test/tsconfig.tests.json --noEmit`.

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server
./node_modules/.bin/vitest run test/ci-vitest-select-config.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ci-baseline.test.ts --maxWorkers=2
```

  Measured: `Tests  7 passed (7)`, then `Tests  1 passed (1)`.

- [ ] **Step 5: Measure the mutation table.** For each row: apply the edit, run Step 4's first vitest command,
  see the named test(s) red, restore the file byte-for-byte, re-run green.

  | Mutation | Test(s) that go red |
  |---|---|
  | Re-apply the exact list through `mergeConfig`'s 2nd arg instead of the explicit post-merge assignment (reintroduces the array-concat trap) | `replaces test.include with exactly the listed paths…`, `blank lines…`, `does NOT append…` (`Tests  3 failed \| 4 passed (7)`) |
  | Delete the `lines.length === 0` throw | `throws a clear error when CCRC_TEST_LIST points at an empty file` (`1 failed \| 6 passed (7)`) |

  Both re-measured in the integration clone.

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

- [ ] **Step 7: Commit**

```bash
git add server/vitest.select.config.ts server/test/ci-baseline.test.ts server/test/ci-vitest-select-config.test.ts
git commit -F - <<'EOF'
test(ci): exact-list vitest config + baseline test

server/vitest.select.config.ts merges vitest.config.ts and, when
CCRC_TEST_LIST names a file, replaces test.include with exactly the
listed server-relative paths -- vitest's own file arguments are
substring filters, and mergeConfig concatenates array fields, so the
override is applied explicitly after the merge rather than through
mergeConfig's second argument. server/test/ci-baseline.test.ts is the
trivial test whose own trace is the CI map's startup baseline (spec
§5.2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Trace parser `.github/ci/trace-to-deps.mjs`

**Files:**
- Create: `.github/ci/trace-to-deps.mjs`
- Test: `server/test/ci-trace-to-deps.test.ts`

**Interfaces:** Consumes: a `traceDir` of `strace -f -ff -ttt -y -qq` output files — one per THREAD (`t.<tid>`), as
Task 7's `traceArgv` produces — and a `repoRoot` / Produces: `export function parseTraceDir(traceDir, repoRoot):
DepRecord` (the union of every file; the CLI prints it), `export function parseTraceDirDetailed(traceDir,
repoRoot): { record: DepRecord, unresolved: number }`, `export function parseTraceDirSplit(traceDir, repoRoot,
rootPid): { root: DepRecord, rest: DepRecord, unresolved: number }` (what Task 7 uses), and the JSDoc typedef
`DepRecord` (`{ read, probed, listed, subtree, git }`) that Tasks 4, 5 and 7 import.
- Changed in integration (process split): `parseTraceDirSplit` is new. vitest's include glob lists `server/test`
  even with a literal include, so the baseline records that listing; subtracting one merged baseline would also
  erase a test's OWN listing of `server/test` (single-definition's census), so records are split into the vitest
  root process and everything else and the baseline is subtracted per side (Task 4). `root` is the root pid's
  whole THREAD GROUP, rebuilt from `clone`/`clone3` lines carrying `CLONE_THREAD` — not the single file
  `t.<rootPid>` — because `-ff` writes one file per thread and the glob's walk was measured on a root threadpool
  thread (below).
- Changed in integration (readlink): `readlink("path")` is parsed like `access` (no dirfd; cwd-resolved; success →
  `read`, ENOENT → `probed`), because `realpathSync.native` probes with it and nothing else. By the operator's
  ruling its `EINVAL` is `read` too: the path exists, it just is not a symlink, and a test that only realpaths a
  file depends on it existing — so deleting that file must select the test. `EINVAL` from any other syscall is
  still not recorded. The contract's
  `TestRecord` typedef moved to Task 4 (nothing here uses it).
- Changed in integration (symlinks, operator's rulings S1-S2): a file reached THROUGH a symlink is a read. A
  successful fd-returning call's `-y` return annotation (`= 3</repo/ccd/x>`) names where the path really led, and
  that resolved path is recorded as read alongside the argument; and `symlink`/`symlinkat` (both in Task 7's list
  now) record the link's in-repo TARGET as read — absolute, or joined to the LINK's directory, never the cwd.
  Measured on `ccrc-models.test.ts`, which symlinks `ccd/ccrc-models-probe` into a fixture tree and runs it from
  there: each mechanism alone records `ccd/ccrc-models-probe`, and with both removed the record misses it (the
  argument path is outside the repo, `/tmp/…/ccrc/ccd/ccrc-models-probe`). End to end: a map built from that trace,
  and a commit changing `ccd/ccrc-models-probe`, select `ccrc-models.test.ts` by rule 3.
- Changed in integration (directory links, operator's ruling R4): a link whose in-repo target is a DIRECTORY records
  that directory in a new kind, `subtree`, and a file target stays `read`. A fixture home that links `deploy/` or
  `shared/` whole and then only STATS a file through the link — or probes an absent one — leaves nothing else: a
  stat returns no fd, so no `-y` annotation names the repo file, and the argument path is outside the repo
  (measured: `newfstatat("<home>/deploy/present.mjs") = 0` and `… absent.mjs … = -1 ENOENT` recorded nothing but
  the link target). The parser decides file or directory with `statSync` on the target when it PARSES the trace —
  `trace-run.mjs` parses in the checkout it traced, so the tree is the one the test ran against; a target that is
  not there (dangling) stays `read`. Task 5's rule 6 selects the test for any change at or under a `subtree`
  directory. Measured on the kept `ccrc-models.test.ts` trace: `subtree` = `deploy`, `deploy/systemd`, `shared`
  (all on the worker side). End to end, on a scratch fixture test that links `deploy/` into a tmp HOME and only
  stats `deploy/notify.sh` and probes `deploy/not-yet.mjs` through it — traced by `trace-run.mjs`, mapped by
  `testmap.mjs build`, then selected by `select.mjs` on a pull request — a commit modifying `deploy/notify.sh`,
  one adding `deploy/not-yet.mjs` and one deleting `deploy/notify.sh` each selected it: `| 6 SUBTREE |` with that
  path. Its record's `read` holds neither file, which is the gap rule 6 closes.
- Changed in integration (cwd, operator's ruling S3): a dirfd-less relative path (`open`/`access`/`readlink`, and a
  relative `symlink` linkpath) resolves against its process's cwd AT THAT MOMENT, replayed from a timeline:
  `AT_FDCWD<…>` annotations and successful `chdir`/`fchdir` (both in the list now), ordered by `-ttt`'s stamp
  across the process's threads (grouped by `CLONE_THREAD` clones — threads share one cwd). Before the first
  move the cwd is the one the annotations name, unknown if they disagree; a relative `chdir` from an unknown cwd
  stays unknown. The ruling's first form — resolve only when a process's cwd is unambiguous — was measured on the
  eight files it named and left 3 of 8 `unknown` by cwd alone (git `chdir`s to the top level before
  `access(".git/config")`: `worker-skill` 45 unresolved paths, `ccd-account-ok` 318, `session-hook` 8256), past
  its bound of 2, so the time-ordered form was built: 0 of 8 by cwd (`session-hook` stays `unknown` only because
  its timing tests fail under tracing, and its kept trace parses with 0 unresolved). One case the stamp cannot
  order: a relative call in the SAME microsecond as a move of the cwd. It is counted `unresolved` (the record goes
  `unknown`, always selected) unless the move left the cwd where it was — a `<`-for-`<=` mutation of the lookup first
  survived here, which is how the tie was found. Measured on nine kept real traces (the six below,
  `ccrc-models`, `ccd-account-ok`, and `session-hook` up to its 900 s kill): the tie rule made nothing
  unresolved.

- [ ] **Step 1: Capture real strace fixtures, then write the failing test**

  First capture real `strace -ff -ttt -y` output against this repo's own test files, exactly as `trace-run.mjs`'s
  invocation will (from `server/`, with the clone's `node_modules` in place):

```bash
cd server
W=$(mktemp -d); mkdir "$W/trace"; echo test/ci-baseline.test.ts > "$W/list.txt"
CCRC_TRACING=1 CCRC_TEST_LIST="$W/list.txt" CI=true UV_USE_IO_URING=0 strace -f -ff -ttt -y -qq \
  -e trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3 \
  -o "$W/trace/t" sh -c 'echo $$ > "$0"; exec "$@"' "$W/root.pid" \
  ./node_modules/.bin/vitest run --config vitest.select.config.ts --maxWorkers=1
```

  Repeat for `test/bus.test.ts`, `test/ccd-rc-flag.test.ts`, `test/worker-skill.test.ts`,
  `test/oss-metadata.test.ts`, `test/single-definition.test.ts` (and `test/ccrc-models.test.ts`, for the symlink
  shapes). Measured output shapes (used verbatim, prefix-substituted, in the fixtures below; every line starts with
  a `<seconds>.<micros> ` stamp, which the fixtures carry where time order matters): successful `openat(AT_FDCWD<cwd>, "/abs/path", FLAGS) = FD<resolved>`;
  `access(".git/config", R_OK) = 0` / a failing sibling `= -1 ENOENT (No such file or directory)`;
  `getdents64(FD<dir>, buf, N) = bytes` (0 bytes = end, still a real listing); `newfstatat`/`statx` success with
  NO trailing `<resolved>` annotation (only fd-returning calls get one); a real trailing-slash directory open
  (`"…/test/"`) whose OWN `<resolved>` annotation has no trailing slash — a dedup hazard, see Step 3; `readlink`
  with an ENOENT, a symlink target, and `EINVAL` on a regular file; `clone3({flags=…|CLONE_THREAD|…} …) = <tid>`
  in the creating thread's file; `symlink("/repo/ccd/x", "/tmp/…/x") = 0` (node's `fs.symlinkSync`) and
  `symlinkat("../a.txt", AT_FDCWD</…/sub>, "lnk") = 0` (coreutils `ln -s`); `openat(…, "/tmp/…/x", O_RDONLY) =
  3</repo/ccd/x>` through that link; and git's `chdir("/repo") = 0` followed by `access(".git/config", R_OK)`.

  **The process-split measurement** (the reason for `parseTraceDirSplit`), from those captures — which pid file
  holds each `getdents64`, grouped into processes by the `clone`/`clone3` lines:
  - `ci-baseline`: `server/test` is listed in the ROOT process — on a threadpool THREAD (`t.<tid>` created from
    the root with `CLONE_THREAD`), not in the root pid's own file. Split: `root.listed = [server/test]`,
    `rest.listed = []`.
  - `worker-skill`: `ccd/worker-skill` is listed in a NON-root process — the forks-pool worker (its leader's
    `execve` is `/usr/bin/node … --require …`).
  - `single-definition`: `server/test` is listed TWICE — by a root thread (the glob) and by the worker (its own
    census). Subtracting the baseline per side keeps `server/test` in its record; subtracting one merged baseline
    (the contract's format 1) erased it.

  Write `server/test/ci-trace-to-deps.test.ts` (30 cases):

<!-- file: server/test/ci-trace-to-deps.test.ts -->
```ts
// `.github/ci/trace-to-deps.mjs` (spec §5.1-5.2, contract Task 3): parses `strace -f -ff -ttt -y -qq` output — one
// file per pid, as produced by `traceArgv` (Task 7) — into a repo-relative `DepRecord`.
//
// Every fixture below is modelled on REAL `strace 6.8 -ff -y` output, captured by hand against this repo's own
// test files under exactly the invocation `trace-run.mjs` uses (`CCRC_TEST_LIST=<one file> vitest run --config
// vitest.select.config.ts --maxWorkers=1`, wrapped in `strace -f -ff -y -qq -e trace=openat,openat2,open,
// newfstatat,statx,access,faccessat2,readlinkat,getdents64,execve,execveat -o <dir>/t`):
//   - `test/bus.test.ts`, `test/oss-metadata.test.ts`, `test/ccd-rc-flag.test.ts`, `test/worker-skill.test.ts`,
//     `test/ci-baseline.test.ts` each traced individually.
// The `readlink` shapes (a later addition to the trace list) are from a real `strace 6.8 -f -y -e trace=readlink`
// capture of `fs.realpathSync.native` on a missing path, a symlink and a regular file.
// The exact syscall shapes below (argument order, the `-y` dirfd/fd annotations, the ENOENT error text, the
// absence of a `<resolved>` annotation on non-fd-returning success) are copied from those real captures, with
// only the path PREFIXES substituted for a synthetic `/repo` fixture root so the numbers stay small and the
// intent stays legible. A few shapes real fixtures never happened to exercise in the sampled files
// (execveat, openat2, AT_FDCWD-relative ENOENT probe, a numbered-fd relative resolution landing inside the
// repo) are constructed in strace's documented syntax for the same syscalls, following the exact grammar the
// real captures established for their siblings (openat/execve).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { parseTraceDir, parseTraceDirDetailed, parseTraceDirSplit } from '../../.github/ci/trace-to-deps.mjs';

/** Writes one pid's trace file (`t.<pid>`) into a fresh trace dir and returns the dir. */
function traceDirWith(files: Record<string, string>): string {
  const dir = mkTmp('ccrc-trace-fixture-');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

// `parseTraceDir`'s contract realpath's `repoRoot` (Task 3), so the fixture root must be a directory that
// actually exists on disk -- a real (auto-removed) tmp dir stands in for the checkout.
const REPO = mkTmp('ccrc-trace-fixture-repo-');

describe('parseTraceDir', () => {
  it('records a successful openat of a repo file as read, real capture shape', () => {
    // Real capture (test/bus.test.ts), path prefix substituted:
    const dir = traceDirWith({
      't.1001': [
        'execve("./node_modules/.bin/vitest", ["./node_modules/.bin/vitest", "run", "--config", "vitest.select.config.ts", "--maxWorkers=1"], 0x7fff62010030 /* 46 vars */) = 0',
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY|O_CLOEXEC) = 22<${REPO}/server/test/bus.test.ts>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('server/test/bus.test.ts');
    expect(rec.git).toBe(false);
  });

  it('aggregates a read recorded only in a GRANDCHILD pid file (multi-process trace dir)', () => {
    // -ff writes one file per pid regardless of process depth; a grandchild's own reads live in its OWN file,
    // never the parent's. The parser must merge across every file in the dir.
    const dir = traceDirWith({
      't.2000': [ // the top-level vitest process: no repo-file read here
        'execve("/usr/bin/node", ["node", "./node_modules/.bin/vitest", "run"], 0x7ffeb45a0f08 /* 46 vars */) = 0',
      ].join('\n') + '\n',
      't.2001': [ // child: a bash subprocess launched by a test
        'execve("/usr/bin/bash", ["bash", "-c", "ccd status"], 0x7ffeb45a0f08 /* 46 vars */) = 0',
      ].join('\n') + '\n',
      't.2002': [ // grandchild: the ccd script itself, forked from the bash child above
        `openat(AT_FDCWD<${REPO}>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('ccd/ccd');
  });

  it('records an ENOENT probe with an AT_FDCWD-relative path as probed', () => {
    // Real capture shape for a successful AT_FDCWD-relative newfstatat (test/ccd-rc-flag.test.ts):
    //   newfstatat(AT_FDCWD<cwd>, ".cc-sessions", {st_mode=...}, 0) = 0
    // The ENOENT failure shares the same grammar; strace prints no trailing struct on failure.
    const dir = traceDirWith({
      't.3001': [
        `newfstatat(AT_FDCWD<${REPO}/server>, "fixtures.missing", 0x7ffd1234, AT_SYMLINK_NOFOLLOW) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.probed).toContain('server/fixtures.missing');
    expect(rec.read).not.toContain('server/fixtures.missing');
  });

  it('records a getdents64 directory enumeration as listed, real capture shape', () => {
    // Real capture (test/ci-baseline.test.ts): vitest's include glob lists server/test/.
    const dir = traceDirWith({
      't.4001': [
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 0 entries */, 32768) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.listed).toEqual(['server/test']);
  });

  it('records a .git read as the git flag, not in read/probed/listed, real capture shape', () => {
    // Real capture shape (test/worker-skill.test.ts's fixture git repo, path prefix substituted onto the repo
    // root itself so this fixture demonstrates the REPO's OWN .git):
    //   access(".git/config", R_OK) = 0
    // resolved via the AT_FDCWD annotation on a preceding line in the same pid file, exactly as real git
    // subprocesses do when they run at the repo root.
    const dir = traceDirWith({
      't.5001': [
        `openat(AT_FDCWD<${REPO}>, "${REPO}/package.json", O_RDONLY) = -1 ENOENT (No such file or directory)`,
        `access(".git/config", R_OK) = 0`,
        `access(".git/hooks/pre-commit", R_OK) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.git).toBe(true);
    // "package.json" is a genuine ENOENT probe unrelated to .git, kept as evidence the two buckets don't collide.
    expect(rec.probed).toContain('package.json');
    expect(rec.read.some((p) => p === '.git' || p.startsWith('.git/'))).toBe(false);
    expect(rec.probed.some((p) => p === '.git' || p.startsWith('.git/'))).toBe(false);
  });

  it('drops a path under a node_modules segment', () => {
    // Real capture shape (any test file): node's own resolver probing node_modules.
    const dir = traceDirWith({
      't.6001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/node_modules/vitest/dist/index.js", O_RDONLY|O_CLOEXEC) = 25<${REPO}/server/node_modules/vitest/dist/index.js>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.probed).toEqual([]);
  });

  it('drops a path outside the repo, real capture shape (a fixture HOME under /tmp)', () => {
    // Real capture (test/ccd-rc-flag.test.ts): a fixture harness HOME lives under /tmp, well outside the repo.
    const dir = traceDirWith({
      't.7001': [
        `openat(22<${REPO}-unrelated-fixture-home>, ".ccrc", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = -1 ENOENT (No such file or directory)`,
        `openat(AT_FDCWD</tmp/ccrc-ccd-rc-flag-Lb1OUz>, "/tmp/ccrc-ccd-rc-flag-Lb1OUz/.ccrc/accounts.sh", O_RDONLY) = 6</tmp/ccrc-ccd-rc-flag-Lb1OUz/.ccrc/accounts.sh>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.probed).toEqual([]);
  });

  it('records an absolute execve of a repo path as read', () => {
    const dir = traceDirWith({
      't.8001': [
        `execve("${REPO}/ccd/ccd", ["ccd", "status"], 0x45eee880 /* 58 vars */) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('ccd/ccd');
  });

  it('ignores a relative execve (the interpreter\'s own openat of the script records it instead)', () => {
    // Real capture (every test file's top-level vitest launch): execve("./node_modules/.bin/vitest", ...).
    const dir = traceDirWith({
      't.9001': [
        'execve("./node_modules/.bin/vitest", ["./node_modules/.bin/vitest", "run"], 0x7fff62010030 /* 46 vars */) = 0',
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(record.read).toEqual([]);
    expect(record.probed).toEqual([]);
    // A relative execve is IGNORED, not unresolved: it never even attempts cwd resolution.
    expect(unresolved).toBe(0);
  });

  it('resolves a relative access() against the pid\'s last-seen cwd when that cwd is inside the repo', () => {
    const dir = traceDirWith({
      't.10001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `access("tsconfig.json", F_OK) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('server/tsconfig.json');
  });

  it('resolves a relative access() against the pid\'s last-seen cwd when that cwd is OUTSIDE the repo (dropped)', () => {
    // Real capture (test/worker-skill.test.ts's fixture git repo): git commands run with cwd = a fixture
    // producer directory under /tmp, well outside the repo, and their relative .git/* reads resolve there.
    const dir = traceDirWith({
      't.10101': [
        `openat(AT_FDCWD</tmp/ccrc-producer-read-Ubndi0/producer>, "/home/user/.gitconfig", O_RDONLY) = 5</home/user/.gitconfig>`,
        `access(".git/config", R_OK) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual([]);
    expect(rec.git).toBe(false);
  });

  it('counts an unresolvable relative path (no cwd seen anywhere in the pid file) as unresolved', () => {
    const dir = traceDirWith({
      't.11001': [
        `access("some-relative-file", F_OK) = 0`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(1);
    expect(record.read).toEqual([]);
    expect(record.probed).toEqual([]);
  });

  it('falls back to the FIRST cwd seen later in the pid file when none precedes the relative access()', () => {
    const dir = traceDirWith({
      't.11101': [
        `access("tsconfig.json", F_OK) = 0`, // no cwd seen yet at this point
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
    expect(record.read).toContain('server/tsconfig.json');
  });

  it('marks a repo root itself (the exact repo dir) as "."', () => {
    const dir = traceDirWith({
      't.12001': [
        `newfstatat(AT_FDCWD<${REPO}>, "${REPO}", {st_mode=S_IFDIR|0775, st_size=4096, ...}, 0) = 0`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toContain('.');
  });

  it('treats a trailing-slash directory open as the same path as its slash-free sibling (real capture shape)', () => {
    // Real capture (test/ci-baseline.test.ts): Node opens a directory it is about to readdir as `"…/test/"`
    // (trailing slash on the ARGUMENT), while strace's own `<resolved>` fd annotation for the same open never
    // carries one -- so without normalization the two spellings dedupe as two different `read` entries for one
    // directory.
    const dir = traceDirWith({
      't.15001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = 20<${REPO}/server/test>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test", O_RDONLY|O_CLOEXEC) = 21<${REPO}/server/test>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/test']);
  });

  it('deduplicates and sorts every field', () => {
    const dir = traceDirWith({
      't.13001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/oss-metadata.test.ts", O_RDONLY) = 4<${REPO}/server/test/oss-metadata.test.ts>`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/test/bus.test.ts', 'server/test/oss-metadata.test.ts']);
  });
});

describe('parseTraceDir: readlink (the syscall realpathSync.native probes with)', () => {
  // Measured: `fs.realpathSync.native('missing/x')` emits ONLY `readlink("<abs>/missing", …) = -1 ENOENT` — no
  // stat, no open — so without readlink in the trace list that probe is invisible. readlink carries no dirfd:
  // a relative path resolves against the pid's cwd, exactly like access().
  it('an ENOENT readlink is probed, a successful one read (real capture shapes)', () => {
    const dir = traceDirWith({
      't.16001': [
        `readlink("${REPO}/server/missing", 0x7ffc25c72ac0, 1023) = -1 ENOENT (No such file or directory)`,
        `readlink("${REPO}/server/link.txt", "real.txt", 1023) = 8`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.probed).toEqual(['server/missing']);
    expect(rec.read).toEqual(['server/link.txt']);
  });

  it('an EINVAL readlink is read: the path exists, it just is not a symlink (real capture shape)', () => {
    // realpathSync.native walks every component with readlink; a regular file answers EINVAL. A test that only
    // realpaths a file still depends on it existing, so deleting it must select the test (rule 3 reads `read`).
    const dir = traceDirWith({
      't.16201': [
        `readlink("${REPO}/server/real.txt", 0x7ffc25c72ac0, 1023) = -1 EINVAL (Invalid argument)`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `readlink("rel.txt", 0x7ffc25c72ac0, 1023) = -1 EINVAL (Invalid argument)`,
        `access("${REPO}/server/other.txt", F_OK) = -1 EINVAL (Invalid argument)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['server/package.json', 'server/real.txt', 'server/rel.txt']);
    expect(rec.probed).toEqual([]);
  });

  it('a relative readlink resolves against the pid\'s cwd, like access()', () => {
    const dir = traceDirWith({
      't.16101': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`,
        `readlink("gone/x", 0x7ffc25c72ac0, 1023) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
    expect(record.probed).toEqual(['server/gone/x']);
  });
});

describe('reads through a symlink: the resolved path of an opened fd, and a created link\'s target', () => {
  // Real shapes (strace 6.8 -y): opening a symlink prints the fd's RESOLVED path after `=`, and node's
  // fs.symlinkSync emits `symlink(target, linkpath)` while coreutils `ln -s` emits `symlinkat(target, dirfd,
  // linkpath)`. ccrc-models and its siblings build a fixture box by symlinking repo files into a tmp HOME and
  // run them there, so the argument path is outside the repo and only these two record the repo file.
  it('a successful open of a path outside the repo records the repo file its fd resolved to', () => {
    const dir = traceDirWith({
      't.17001': [
        `openat(AT_FDCWD</tmp/box>, "/tmp/box/ccd/ccrc-models-probe", O_RDONLY) = 3<${REPO}/ccd/ccrc-models-probe>`,
        `open("/tmp/box/lib.sh", O_RDONLY|O_CLOEXEC) = 4<${REPO}/ccd/ccrc-wrapper-shape>`,
        `openat(AT_FDCWD</tmp/box>, "/tmp/box/gone", O_RDONLY) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    const rec = parseTraceDir(dir, REPO);
    expect(rec.read).toEqual(['ccd/ccrc-models-probe', 'ccd/ccrc-wrapper-shape']);
    expect(rec.probed).toEqual([]);
  });

  it('a created symlink records its in-repo TARGET as read — absolute, or relative to the link\'s directory', () => {
    const dir = traceDirWith({
      't.17101': [
        `symlink("${REPO}/ccd/ccrc", "box/ccd/ccrc") = 0`,
        `symlinkat("${REPO}/deploy", AT_FDCWD</tmp/box>, "deploy") = 0`,
        `symlinkat("../ccd/x", AT_FDCWD<${REPO}/server>, "lnk") = 0`,
        `symlinkat("${REPO}/ccd/exists", AT_FDCWD</tmp/box>, "dup") = -1 EEXIST (File exists)`,
        `symlink("/usr/bin/env", "box/env") = 0`,
      ].join('\n') + '\n',
    });
    const { record, unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(record.read).toEqual(['ccd/ccrc', 'ccd/x', 'deploy']);
    expect(unresolved).toBe(0);
  });

  it('a symlink to an in-repo DIRECTORY records it as subtree (checked on disk when parsed); a file or dangling target stays read', () => {
    // What is later stat'ed or probed THROUGH a directory link leaves no resolved path of its own (a stat returns
    // no fd), so the whole directory is the record: any change at or under it selects the test (rule 6).
    mkdirSync(path.join(REPO, 'subtree-case', 'deploy', 'nested'), { recursive: true });
    writeFileSync(path.join(REPO, 'subtree-case', 'file.sh'), 'x\n');
    const dir = traceDirWith({
      't.17201': [
        `symlinkat("${REPO}/subtree-case/deploy", AT_FDCWD</tmp/box>, "deploy") = 0`,
        `symlinkat("../subtree-case/deploy/nested", AT_FDCWD<${REPO}/server>, "n") = 0`,
        `symlink("${REPO}/subtree-case/file.sh", "/tmp/box/file.sh") = 0`,
        `symlink("${REPO}/subtree-case/gone", "/tmp/box/gone") = 0`,
        `symlink("${REPO}", "/tmp/box/whole-repo") = 0`,
        `newfstatat(AT_FDCWD</tmp/box>, "/tmp/box/deploy/present.mjs", {st_mode=S_IFREG|0644, st_size=1, ...}, 0) = 0`,
        `newfstatat(AT_FDCWD</tmp/box>, "/tmp/box/deploy/absent.mjs", 0x7ffc, 0) = -1 ENOENT (No such file or directory)`,
      ].join('\n') + '\n',
    });
    expect(parseTraceDir(dir, REPO)).toEqual({
      read: ['subtree-case/file.sh', 'subtree-case/gone'], probed: [], listed: [],
      subtree: ['.', 'subtree-case/deploy', 'subtree-case/deploy/nested'], git: false,
    });
  });
});

describe('the cwd of a dirfd-less relative path, tracked through chdir in time order (-ttt)', () => {
  // open/access/readlink/symlink carry no dirfd, so a relative path needs the process's cwd at that moment. The
  // trace carries `chdir`/`fchdir` and a `-ttt` timestamp on every line, and the process's events — across all
  // its threads' files — are replayed in time order: AT_FDCWD<…> says what the cwd is, chdir/fchdir move it.
  // Measured why this is needed: git chdirs to the work tree before `access(".git/config")`, so every test that
  // runs git would otherwise be unknown (worker-skill 45 unresolved paths, ccd-account-ok 318, session-hook
  // 8256 under a "never chdir'd" rule), and the old per-file "last cwd seen" rule joined the path to the stale
  // cwd (`process.chdir('<repo>/ccd'); fs.existsSync('x')` recorded server/x).
  const t = (s: number, line: string) => `1727000000.${String(s).padStart(6, '0')} ${line}`;

  it('after a chdir, a relative access resolves against the NEW cwd', () => {
    const dir = traceDirWith({
      't.18001': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(2, `chdir("${REPO}/ccd")                     = 0`),
        t(3, `access("nope-rel-probe", F_OK) = -1 ENOENT (No such file or directory)`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['server/package.json'], probed: ['ccd/nope-rel-probe'], listed: [], subtree: [], git: false }, unresolved: 0,
    });
  });

  it('before the chdir the old cwd holds; a relative chdir moves relative to it; fchdir takes its fd\'s path', () => {
    const dir = traceDirWith({
      't.18101': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(2, `access("a", F_OK) = 0`),
        t(3, `chdir("../ccd")                          = 0`),
        t(4, `access("b", F_OK) = 0`),
        t(5, `fchdir(5<${REPO}/deploy>)                = 0`),
        t(6, `access("c", F_OK) = 0`),
        t(7, `chdir("${REPO}/nowhere") = -1 ENOENT (No such file or directory)`),
        t(8, `access("d", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/b', 'deploy/c', 'deploy/d', 'server/a', 'server/package.json'], probed: [], listed: [], subtree: [], git: false },
      unresolved: 0,
    });
  });

  it('threads share one cwd: a chdir in one thread moves the cwd for another thread\'s LATER calls only', () => {
    const clone = `clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0x1, parent_tid=0x1, exit_signal=0, stack=0x1, stack_size=0x1, tls=0x1} => {parent_tid=[18302]}, 88) = 18302`;
    // The leader moves the cwd at t=5; the only annotation is the thread's, at t=2, in a file read AFTER the
    // leader's — so the events must be replayed by time, not by file, and across the thread group.
    const dir = traceDirWith({
      't.18301': [
        t(1, clone),
        t(5, `chdir("${REPO}/ccd") = 0`),
      ].join('\n') + '\n',
      't.18302': [
        t(2, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(3, `access("early", F_OK) = 0`),
        t(7, `access("late", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/late', 'server/early', 'server/package.json'], probed: [], listed: [], subtree: [], git: false }, unresolved: 0,
    });
  });

  it('with no known cwd, a relative path is unresolved — and so is one after a relative chdir from an unknown cwd', () => {
    const dir = traceDirWith({
      't.18401': [t(1, `access("rel", F_OK) = 0`)].join('\n') + '\n',
      't.18402': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "a", O_RDONLY) = 3<${REPO}/server/a>`),
        t(2, `openat(AT_FDCWD<${REPO}/ccd>, "b", O_RDONLY) = 4<${REPO}/ccd/b>`),
        t(3, `chdir("sub") = 0`),
        t(4, `access("rel", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    // t.18402: two cwds before any traced chdir (an untraced move) — its start is unknown, so "sub" is too.
    expect(parseTraceDirDetailed(dir, REPO).unresolved).toBe(2);
  });

  it('a relative call in the SAME microsecond as a move is unresolved: the stamp cannot order the two', () => {
    const dir = traceDirWith({
      't.18501': [
        t(1, `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/package.json", O_RDONLY) = 3<${REPO}/server/package.json>`),
        t(5, `chdir("${REPO}/ccd") = 0`),
        t(5, `access("tie", F_OK) = 0`),
        t(6, `access("after", F_OK) = 0`),
      ].join('\n') + '\n',
    });
    expect(parseTraceDirDetailed(dir, REPO)).toEqual({
      record: { read: ['ccd/after', 'server/package.json'], probed: [], listed: [], subtree: [], git: false }, unresolved: 1,
    });
  });
});

describe('parseTraceDirSplit (the vitest root process apart from every other process)', () => {
  // vitest's own startup — the config, the include glob's walk of `server/test/` — happens in the vitest ROOT
  // process; what a test file itself does happens in its worker and in whatever that spawns. The baseline is
  // subtracted per side, so a test that walks `server/test/` in its own right (single-definition's census) keeps
  // that listing even though the root's glob walk of the same directory is subtracted.
  //
  // `-ff` writes one file per THREAD, not per process, and the glob's walk is measured on a libuv threadpool
  // thread of the root process — never in the root pid's own file. So the root side is the root pid's whole
  // thread group: the root pid plus every task a member of the group created with CLONE_THREAD, transitively
  // (the `clone`/`clone3` lines, real capture shapes from `strace 6.8 -ff` of a vitest run).
  const thread = (tid: number) =>
    `clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0x78544ddfe990, parent_tid=0x78544ddfe990, exit_signal=0, stack=0x78544d5fe000, stack_size=0x7ffe80, tls=0x78544ddfe6c0} => {parent_tid=[${tid}]}, 88) = ${tid}`;
  const child = (pid: number) =>
    `clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x78544e8cdfd0) = ${pid}`;

  it('the root pid and every thread its process creates are root; every other process (and its threads) is rest', () => {
    const dir = traceDirWith({
      't.500': [ // the root process's main thread: the config, one thread, one child process
        thread(1000),
        child(501),
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/vitest.config.ts", O_RDONLY|O_CLOEXEC) = 21<${REPO}/server/vitest.config.ts>`,
      ].join('\n') + '\n',
      // `t.1000` sorts BEFORE `t.500`, so the grandchild thread's edge is seen before its creator joins the group
      // — the closure has to go round again, as it does when real tids cross a digit boundary.
      't.1000': [ // a root threadpool thread: the include glob's walk, and a thread of its own
        thread(1001),
        `getdents64(20<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
      ].join('\n') + '\n',
      't.1001': [ // a thread created BY a root thread: still the root process
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/tsconfig.json", O_RDONLY|O_CLOEXEC) = 22<${REPO}/server/tsconfig.json>`,
      ].join('\n') + '\n',
      't.501': [ // the test's worker process: its own walk of server/test, and a thread
        thread(520),
        `getdents64(22<${REPO}/server/test>, 0x7df18c000ba0 /* 401 entries */, 32768) = 18048`,
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>`,
      ].join('\n') + '\n',
      't.520': [ // the worker's thread: rest, like the worker
        `openat(AT_FDCWD<${REPO}>, "${REPO}/shared/api.ts", O_RDONLY) = 3<${REPO}/shared/api.ts>`,
      ].join('\n') + '\n',
      't.502': [ // a git the test spawned
        `openat(AT_FDCWD<${REPO}>, "${REPO}/package.json", O_RDONLY) = 3<${REPO}/package.json>`,
        `access(".git/config", R_OK) = 0`,
      ].join('\n') + '\n',
    });
    const { root, rest, unresolved } = parseTraceDirSplit(dir, REPO, 500);
    expect(root).toEqual({
      read: ['server/tsconfig.json', 'server/vitest.config.ts'], probed: [], listed: ['server/test'], subtree: [], git: false,
    });
    expect(rest).toEqual({
      read: ['ccd/ccd', 'package.json', 'shared/api.ts'], probed: [], listed: ['server/test'], subtree: [], git: true,
    });
    expect(unresolved).toBe(0);
  });

  it('a root pid with no file leaves root empty, and unresolved counts both sides', () => {
    const dir = traceDirWith({
      't.600': [`access("some-relative-file", F_OK) = 0`].join('\n') + '\n',
      't.601': [`access("another-relative-file", F_OK) = 0`].join('\n') + '\n',
    });
    const split = parseTraceDirSplit(dir, REPO, 600);
    expect(split.unresolved).toBe(2);
    const none = parseTraceDirSplit(dir, REPO, 999);
    expect(none.root).toEqual({ read: [], probed: [], listed: [], subtree: [], git: false });
  });
});

describe('parseTraceDirDetailed', () => {
  it('returns unresolved: 0 for a clean trace', () => {
    const dir = traceDirWith({
      't.14001': [
        `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/test/bus.test.ts", O_RDONLY) = 3<${REPO}/server/test/bus.test.ts>`,
      ].join('\n') + '\n',
    });
    const { unresolved } = parseTraceDirDetailed(dir, REPO);
    expect(unresolved).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-trace-to-deps.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/trace-to-deps.mjs' imported from …/server/test/ci-trace-to-deps.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/trace-to-deps.mjs`:

<!-- file: .github/ci/trace-to-deps.mjs -->
```js
// CI test selection (spec §5.1-5.2, contract Task 3): parses `strace -f -ff -ttt -y -qq` output for one server
// test file — one file per thread, as `trace-run.mjs`'s `traceArgv` produces — into a repo-relative `DepRecord`.
//
// `-y` is what makes this parser possible without tracking file descriptors by hand: it prints, inline on every
// syscall that takes a directory-fd or plain fd argument, that fd's OWN resolved path in `<...>` — `AT_FDCWD<cwd>`
// for the process's current directory, `N<path>` for a numbered fd. A relative path argument on a syscall that
// carries its own dirfd (`openat`, `openat2`, `newfstatat`, `statx`, `faccessat2`, `readlinkat`, `execveat`,
// `getdents64`) is therefore always resolvable from that SAME line — no fd bookkeeping needed. Only the
// syscalls with no dirfd argument at all (`open`, `access`, `readlink`, `symlink`, `execve`) can carry a relative
// path with nothing on the line to resolve it against. Those use the PROCESS's cwd AT THAT MOMENT — the whole
// thread group's, since threads share one. Every line carries a `-ttt` timestamp and `chdir`/`fchdir` are traced,
// so a process's events, across all its threads' files, are replayed in time order: an `AT_FDCWD<...>` annotation
// says what the cwd is, a successful `chdir`/`fchdir` moves it. A relative path with no known cwd at its moment is
// counted `unresolved`, which makes the record `unknown` — and so is one in the SAME microsecond as a move of the
// cwd, which the stamp cannot order (measured on nine real traces: it left nothing unresolved). Measured why the time order is needed: git chdirs to
// the work tree before `access(".git/config")`, so a rule that gave up on any process that chdir'd left
// worker-skill, ccd-account-ok and session-hook unknown (45, 318 and 8256 unresolved paths); and the older
// per-file "last cwd seen" rule joined such a path to the STALE cwd (after `process.chdir('<repo>/ccd')`,
// `fs.existsSync('x')` issues a bare `access` it recorded as `server/x`). `execve` is exempt entirely: a relative
// `execve` is deliberately ignored (never resolved, never counted `unresolved`) because the *interpreter's* own
// `openat` of that same script records the dependency a moment later.
//
// Reads THROUGH a symlink: a successful `open`/`openat`/`openat2` prints the new fd's RESOLVED path after `=`
// (`= 3</repo/ccd/f>`), and that path is recorded as well as the argument — ccrc-models and its siblings symlink
// repo files into a tmp HOME and run them there, where the argument path is outside the repo. And a created
// symlink (`symlink`/`symlinkat`) whose TARGET is in the repo — a relative target resolved against the link's own
// directory — records that target, because what the test later only stats or probes through the link returns no
// fd and so no resolved path: a FILE target is `read`, and a DIRECTORY target is `subtree` (a fixture home that
// links `deploy/` or `shared/` whole, then stats `…/deploy/x` — measured: the stat's argument is outside the repo
// and nothing else names `deploy/x`). Which of the two is decided by `statSync` on the target when the trace is
// PARSED — trace-run parses in the checkout it traced, so the tree is the one the test ran against; a target that
// is not there (dangling) stays `read`. A `subtree` directory selects the test for any change at or under it
// (select-tests.mjs rule 6).
//
// Only a successful call or one that failed with ENOENT is ever recorded. Any other failure (EACCES, ENOTDIR, a
// signal-interrupted call, …) is silently skipped: it is neither "this test's behaviour depends on this path's
// CONTENT" (that needs a successful read) nor "this test's behaviour depends on this path's EXISTENCE" (that is
// what ENOENT — a currently-absent path — means; some other error says nothing about whether adding the path
// would change anything). One exception: `readlink` failing with EINVAL is recorded as `read` — the path EXISTS,
// it just is not a symlink — because a test that only realpaths a file still depends on that file existing.
//
// `readlink` is in the trace list because `fs.realpathSync.native` probes a path with it and nothing else
// (measured: `realpathSync.native('missing/x')` emits ONLY `readlink("…/missing", …) = -1 ENOENT`), so without it
// that probe would be invisible. It is parsed like `access`: success -> read, ENOENT -> probed — and EINVAL ->
// read (see above).
//
// A trace is also read SPLIT BY PROCESS (`parseTraceDirSplit`): the vitest ROOT process — the one that loads the
// config and walks the `include` glob, so lists `server/test/` for every test — apart from every other process
// (the test's worker and whatever it spawns). The baseline is then subtracted per side (`testmap.mjs`), which
// removes the glob's walk of `server/test/` without also erasing a test's OWN walk of the same directory
// (`single-definition`'s census reads every test file). Subtracting a single merged record could not tell those
// two listings apart. `-ff` writes one file per THREAD, and the glob's walk was measured on a libuv threadpool
// thread of the root process, never in the root pid's own file — so the root side is the root pid's whole thread
// group, rebuilt from the `clone`/`clone3` lines (traced for exactly this): every task a member of the group
// created with `CLONE_THREAD` is in the group too.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ read: string[], probed: string[], listed: string[], subtree: string[], git: boolean }} DepRecord */

// The dirfd/fd annotation `-y` prints: `AT_FDCWD<...>` or a bare fd number `<...>`, always present on a syscall
// that takes one, in both success and failure lines.
const FD_ANNOTATION = /^(?:AT_FDCWD|\d+)<([^>]*)>$/;

// Syscalls whose first argument is a dirfd (or AT_FDCWD) and whose second argument is the path: a relative path
// is always resolvable from this same line's dirfd annotation. The last group is the resolved path `-y` prints
// after a successful call's returned fd (`= 3</path>`), for the calls that return one.
const DIRFD_PATH_RE =
  /^(openat|openat2|newfstatat|statx|faccessat2|readlinkat|execveat)\(((?:AT_FDCWD|\d+)<[^>]*>), "((?:[^"\\]|\\.)*)"[^)]*\)\s*=\s*(-1\s+\S+|\d+)(?:<([^>]*)>)?/;

// Syscalls with no dirfd argument at all: the path is either absolute, or relative to the process's cwd
// (`open`/`access`) or ignored entirely when relative (`execve`).
const BARE_PATH_RE = /^(open|access|execve)\("((?:[^"\\]|\\.)*)"[^)]*\)\s*=\s*(-1\s+\S+|\d+)(?:<([^>]*)>)?/;

// `symlink(target, linkpath)` (node's fs.symlinkSync) and `symlinkat(target, newdirfd, linkpath)` (coreutils
// `ln -s`), both measured. Only a successful creation is recorded.
const SYMLINK_RE = /^symlink\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)\s*=\s*(-1\s+\S+|\d+)/;
const SYMLINKAT_RE =
  /^symlinkat\("((?:[^"\\]|\\.)*)", ((?:AT_FDCWD|\d+)<[^>]*>), "((?:[^"\\]|\\.)*)"\)\s*=\s*(-1\s+\S+|\d+)/;

// A successful `chdir("path")` / `fchdir(N<dir>)`: the process's cwd moved.
const CHDIR_RE = /^chdir\("((?:[^"\\]|\\.)*)"\)\s*=\s*0\s*$/;
const FCHDIR_RE = /^fchdir\(\d+<([^>]*)>\)\s*=\s*0\s*$/;

// `-ttt`'s prefix: seconds and microseconds since the epoch.
const TS_RE = /^(\d+)\.(\d{6}) /;

// `readlink(path, buf, size)` — no dirfd either, so a relative path resolves against the pid's cwd exactly like
// `access`. Its second argument is the link's TARGET, printed as a string that may itself contain `)`, so the
// result is matched from the END of the line rather than after the first `)`.
const READLINK_RE = /^readlink\("((?:[^"\\]|\\.)*)", .*\)\s*=\s*(-1\s+\S+|\d+)(?:\s+\([^()]*\))?\s*$/;

// `getdents64(fd<dir>, buf, size) = bytes` — the only syscall in scope with no path argument at all: what is
// enumerated is the fd's own resolved directory.
const GETDENTS_RE = /^getdents64\((\d+<[^>]*>|AT_FDCWD<[^>]*>)/;

// `clone(…) = <tid>` / `clone3({flags=…}, …) = <tid>` in the CREATING task's file. A task created with
// `CLONE_THREAD` is a thread of the creator's process; anything else is a new process.
const CLONE_RE = /^clone3?\((.*)\)\s*=\s*([1-9]\d*)\s*$/;

/** Classifies an absolute, already-normalized path against the repo root: outside the repo or under a
 *  `node_modules` segment -> dropped; under `<root>/.git` (or equal to it) -> `{ kind: 'git' }`; otherwise
 *  `{ kind: 'in', rel }` with `rel` POSIX repo-relative (`'.'` for the root itself). */
function classify(absPath, root) {
  let rel;
  if (absPath === root) rel = '.';
  else if (absPath.startsWith(root + '/')) rel = absPath.slice(root.length + 1);
  else return { kind: 'drop' };
  const segments = rel.split('/');
  if (segments.includes('node_modules')) return { kind: 'drop' };
  if (rel === '.git' || segments[0] === '.git') return { kind: 'git' };
  return { kind: 'in', rel };
}

function isSuccess(result) {
  return /^\d+$/.test(result);
}

function isEinval(result) {
  return /^-1\s+EINVAL\b/.test(result);
}

function isEnoent(result) {
  return /^-1\s+ENOENT\b/.test(result);
}

/** @typedef {{ key: number, line: string }} Entry  one trace line, its `-ttt` prefix stripped into `key` */

/** Parses one pid's trace entries, folding its findings into `sink` (mutable Sets/flag holder). `cwdAt(key)` is
 *  the process's cwd at that moment, or `undefined` when it is not known (see the file header). */
function parsePidFile(entries, root, sink, cwdAt) {
  let entryKey = 0;

  /** A dirfd-less relative path, absolute when the process's cwd at this line is known; else unresolved. */
  const relative = (rawPath) => {
    const cwd = cwdAt(entryKey);
    if (cwd === undefined) {
      sink.unresolved.value += 1;
      return null;
    }
    return path.posix.join(cwd, rawPath);
  };

  const record = (rel, bucket) => {
    if (bucket === 'read') sink.read.add(rel);
    else if (bucket === 'probed') sink.probed.add(rel);
    else if (bucket === 'listed') sink.listed.add(rel);
    else if (bucket === 'subtree') sink.subtree.add(rel);
    else if (bucket === 'git') sink.git.value = true;
  };

  /** A created link's in-repo target: `subtree` when it is a directory on disk now (the checkout this trace ran
   *  in), else `read` — a file, or a target that is not there (dangling). */
  const recordLinkTarget = (absTarget) => {
    const normalized = path.posix.normalize(absTarget).replace(/\/+$/, '') || '/';
    let isDir = false;
    try {
      isDir = statSync(normalized).isDirectory();
    } catch {
      isDir = false;
    }
    classifyAndRecord(normalized, isDir ? 'subtree' : 'read');
  };

  const classifyAndRecord = (absPath, bucket) => {
    // A real argument path can carry a trailing slash (Node opens a directory as `"…/test/"`) while strace's OWN
    // `<resolved>` return annotation for the same fd never does -- left alone, the two spellings of one
    // directory would dedupe as two different record entries (measured against a real trace, `server/test` vs
    // `server/test/`). Stripped here, once, for every path this function ever records.
    const normalized = path.posix.normalize(absPath).replace(/\/+$/, '') || '/';
    const c = classify(normalized, root);
    if (c.kind === 'drop') return;
    if (c.kind === 'git') {
      if (bucket !== 'listed') record(null, 'git'); // any read/probe under .git -> the git flag, never a path
      else record(null, 'git'); // a directory listing under .git counts too
      return;
    }
    record(c.rel, bucket);
  };

  for (const { key, line } of entries) {
    entryKey = key;
    // getdents64 first: its regex is a prefix of no other pattern, cheap to check early.
    const gd = line.match(GETDENTS_RE);
    if (gd) {
      const fdAnnot = gd[1].match(FD_ANNOTATION);
      const resultMatch = line.match(/\)\s*=\s*(-1\s+\S+|\d+)\s*$/);
      if (fdAnnot && resultMatch && isSuccess(resultMatch[1])) {
        classifyAndRecord(fdAnnot[1], 'listed');
      }
      continue;
    }

    const df = line.match(DIRFD_PATH_RE);
    if (df) {
      const [, , dirfdRaw, rawPath, result, resolved] = df;
      const success = isSuccess(result);
      const enoent = isEnoent(result);
      if (success || enoent) {
        let abs;
        if (rawPath.startsWith('/')) {
          abs = rawPath;
        } else {
          const dm = dirfdRaw.match(FD_ANNOTATION);
          abs = dm ? path.posix.join(dm[1], rawPath) : null;
        }
        if (abs !== null) classifyAndRecord(abs, success ? 'read' : 'probed');
        // The fd's resolved path: where a symlinked argument really led.
        if (success && resolved !== undefined && resolved.startsWith('/')) classifyAndRecord(resolved, 'read');
      }
      continue;
    }

    const bp = line.match(BARE_PATH_RE);
    const rl = bp ? null : line.match(READLINK_RE);
    if (bp || rl) {
      const [name, rawPath, result, resolved] = bp ? [bp[1], bp[2], bp[3], bp[4]] : ['readlink', rl[1], rl[2], undefined];
      // readlink's EINVAL: the path exists and is not a symlink — a read, as far as existence goes.
      const success = isSuccess(result) || (name === 'readlink' && isEinval(result));
      const enoent = isEnoent(result);
      if (success || enoent) {
        if (rawPath.startsWith('/')) {
          classifyAndRecord(rawPath, success ? 'read' : 'probed');
        } else if (name === 'execve') {
          // Relative execve: deliberately ignored, never unresolved (see file header).
        } else {
          const abs = relative(rawPath);
          if (abs !== null) classifyAndRecord(abs, success ? 'read' : 'probed');
        }
        if (success && resolved !== undefined && resolved.startsWith('/')) classifyAndRecord(resolved, 'read');
      }
      continue;
    }

    const sl = line.match(SYMLINK_RE);
    const sla = sl ? null : line.match(SYMLINKAT_RE);
    if (sl || sla) {
      const [target, linkDirOf, result] = sl
        // symlink(target, linkpath): the link's directory from the linkpath (dirfd-less when relative).
        ? [sl[1], () => (sl[2].startsWith('/') ? sl[2] : relative(sl[2])), sl[3]]
        // symlinkat(target, newdirfd, linkpath): relative to the dirfd's annotation.
        : [sla[1], () => {
          if (sla[3].startsWith('/')) return sla[3];
          const dm = sla[2].match(FD_ANNOTATION);
          return dm ? path.posix.join(dm[1], sla[3]) : null;
        }, sla[4]];
      if (isSuccess(result)) {
        if (target.startsWith('/')) {
          recordLinkTarget(target);
        } else {
          const link = linkDirOf();
          if (link !== null) recordLinkTarget(path.posix.join(path.posix.dirname(link), target));
        }
      }
      continue;
    }
  }
}

function newSink() {
  return {
    read: new Set(),
    probed: new Set(),
    listed: new Set(),
    subtree: new Set(),
    git: { value: false },
    unresolved: { value: 0 },
  };
}

/** @returns {DepRecord} */
function sinkRecord(sink) {
  return {
    read: [...sink.read].sort(),
    probed: [...sink.probed].sort(),
    listed: [...sink.listed].sort(),
    subtree: [...sink.subtree].sort(),
    git: sink.git.value,
  };
}

/** Every readable pid file in `traceDir`, as `[fileName, entries]`, in name order. An entry's `key` orders it in
 *  time: the `-ttt` stamp in microseconds, or — for a line with none — a sequence number, so lines without
 *  stamps keep file order (file after file, in name order).
 *  @returns {Array<[string, Entry[]]>} */
function readPidFiles(traceDir) {
  /** @type {Array<[string, Entry[]]>} */
  const out = [];
  let seq = 0;
  for (const file of readdirSync(traceDir).sort()) {
    let text;
    try {
      text = readFileSync(path.join(traceDir, file), 'utf8');
    } catch {
      continue;
    }
    out.push([file, text.split('\n').map((raw) => {
      const m = raw.match(TS_RE);
      seq += 1;
      return m ? { key: Number(m[1]) * 1e6 + Number(m[2]), line: raw.slice(m[0].length) } : { key: seq, line: raw };
    })]);
  }
  return out;
}

/** The pid files of `rootPid`'s thread group: `t.<rootPid>` plus the file of every task a member created with
 *  `CLONE_THREAD`, transitively (a thread of a thread is still a thread of the process).
 *  @param {Array<[string, string]>} pidFiles @param {number|string} rootPid @returns {Set<string>} */
function threadGroupFiles(pidFiles, rootPid) {
  /** @type {Array<[string, string]>} */
  const threadEdges = [];
  for (const [file, entries] of pidFiles) {
    for (const { line } of entries) {
      const m = line.match(CLONE_RE);
      if (m && /\bCLONE_THREAD\b/.test(m[1])) threadEdges.push([file, `t.${m[2]}`]);
    }
  }
  const group = new Set([`t.${rootPid}`]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [creator, created] of threadEdges) {
      if (group.has(creator) && !group.has(created)) {
        group.add(created);
        grew = true;
      }
    }
  }
  return group;
}

/** For every pid file, `cwdAt(key)`: its process's cwd at that moment, or `undefined` when unknown. The files are
 *  grouped into processes by their `CLONE_THREAD` clones (threads share one cwd); a process's cwd events —
 *  `AT_FDCWD<…>` annotations, successful `chdir`/`fchdir` — are replayed in time order. Before its first move the
 *  cwd is the one its annotations name (unknown if they disagree: the cwd moved untraced); after a move it is
 *  wherever the moves and later annotations put it.
 *  @param {Array<[string, Entry[]]>} pidFiles @returns {Map<string, (key: number) => string | undefined>} */
function processCwds(pidFiles) {
  /** @type {Map<string, string>} */
  const parent = new Map(pidFiles.map(([file]) => [file, file]));
  const find = (f) => {
    while (parent.get(f) !== f) f = /** @type {string} */ (parent.get(f));
    return f;
  };
  for (const [file, entries] of pidFiles) {
    for (const { line } of entries) {
      const m = line.match(CLONE_RE);
      if (m && /\bCLONE_THREAD\b/.test(m[1])) {
        const created = `t.${m[2]}`;
        if (parent.has(created)) parent.set(find(created), find(file));
      }
    }
  }
  /** @type {Map<string, Array<{ key: number, kind: 'at'|'chdir'|'fchdir', dir: string }>>} */
  const events = new Map();
  for (const [file, entries] of pidFiles) {
    const g = find(file);
    if (!events.has(g)) events.set(g, []);
    const list = /** @type {Array<{ key: number, kind: 'at'|'chdir'|'fchdir', dir: string }>} */ (events.get(g));
    for (const { key, line } of entries) {
      const cd = line.match(CHDIR_RE);
      const fcd = cd ? null : line.match(FCHDIR_RE);
      if (cd) list.push({ key, kind: 'chdir', dir: cd[1] });
      else if (fcd) list.push({ key, kind: 'fchdir', dir: fcd[1] });
      else for (const a of line.matchAll(/AT_FDCWD<([^>]*)>/g)) list.push({ key, kind: 'at', dir: a[1] });
    }
  }
  /** @type {Map<string, (key: number) => string | undefined>} */
  const byGroup = new Map();
  for (const [g, list] of events) {
    list.sort((a, b) => a.key - b.key);
    const firstMove = list.findIndex((e) => e.kind !== 'at');
    const before = new Set(list.slice(0, firstMove === -1 ? list.length : firstMove).map((e) => e.dir));
    const initial = before.size === 1 ? [...before][0] : undefined;
    /** @type {Array<{ key: number, cwd: string | undefined }>} */
    const after = [];
    let cwd = initial;
    for (const e of firstMove === -1 ? [] : list.slice(firstMove)) {
      if (e.kind === 'at' || e.kind === 'fchdir') cwd = e.dir;
      else cwd = e.dir.startsWith('/') ? path.posix.normalize(e.dir) : cwd === undefined ? undefined : path.posix.join(cwd, e.dir);
      after.push({ key: e.key, cwd });
    }
    /** The cwd after every event stamped at or before `key`. */
    const at = (key) => {
      let lo = 0;
      let hi = after.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (after[mid].key <= key) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? initial : after[lo - 1].cwd;
    };
    // A call stamped in the same microsecond as a move cannot be ordered against it: unknown, unless the move
    // left the cwd where it was. (A line with no stamp has a unique sequence key, so it never ties.)
    byGroup.set(g, (key) => {
      const now = at(key);
      return at(key - 1) === now ? now : undefined;
    });
  }
  /** @type {Map<string, (key: number) => string | undefined>} */
  const out = new Map();
  for (const [file] of pidFiles) out.set(file, /** @type {(key: number) => string | undefined} */ (byGroup.get(find(file))));
  return out;
}

/**
 * Parses every trace file in `traceDir` (one per pid, `strace -ff` output) and merges them into one `DepRecord`,
 * plus the count of relative paths that could not be resolved to any cwd (a test with `unresolved > 0` should be
 * marked `unknown` by the caller — see `trace-run.mjs`).
 * @param {string} traceDir
 * @param {string} repoRoot
 * @returns {{ record: DepRecord, unresolved: number }}
 */
export function parseTraceDirDetailed(traceDir, repoRoot) {
  const root = realpathSync(repoRoot).replace(/\/+$/, '');
  const sink = newSink();
  const pidFiles = readPidFiles(traceDir);
  const cwds = processCwds(pidFiles);
  for (const [file, entries] of pidFiles) parsePidFile(entries, root, sink, /** @type {(key: number) => string | undefined} */ (cwds.get(file)));
  return { record: sinkRecord(sink), unresolved: sink.unresolved.value };
}

/**
 * The same parse, split by process: `root` is the vitest root process — `rootPid`, which `trace-run.mjs`
 * captures, and every thread of it (see the file header) — and `rest` is every other process. A root pid with no
 * file leaves `root` empty; the caller checks that the file exists before trusting the split.
 * @param {string} traceDir
 * @param {string} repoRoot
 * @param {number|string} rootPid
 * @returns {{ root: DepRecord, rest: DepRecord, unresolved: number }}
 */
export function parseTraceDirSplit(traceDir, repoRoot, rootPid) {
  const root = realpathSync(repoRoot).replace(/\/+$/, '');
  const pidFiles = readPidFiles(traceDir);
  const group = threadGroupFiles(pidFiles, rootPid);
  const cwds = processCwds(pidFiles);
  const rootSink = newSink();
  const restSink = newSink();
  for (const [file, entries] of pidFiles) {
    parsePidFile(entries, root, group.has(file) ? rootSink : restSink, /** @type {(key: number) => string | undefined} */ (cwds.get(file)));
  }
  return {
    root: sinkRecord(rootSink),
    rest: sinkRecord(restSink),
    unresolved: rootSink.unresolved.value + restSink.unresolved.value,
  };
}

/**
 * @param {string} traceDir
 * @param {string} repoRoot
 * @returns {DepRecord}
 */
export function parseTraceDir(traceDir, repoRoot) {
  return parseTraceDirDetailed(traceDir, repoRoot).record;
}

function main() {
  const [traceDir, repoRoot] = process.argv.slice(2);
  if (!traceDir || !repoRoot) {
    process.stderr.write('usage: node trace-to-deps.mjs <traceDir> <repoRoot>\n');
    process.exit(2);
  }
  const rec = parseTraceDir(traceDir, repoRoot);
  process.stdout.write(JSON.stringify(rec) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-trace-to-deps.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  30 passed (30)`.

  Cross-check against REAL captures (not fixtures) — `node .github/ci/trace-to-deps.mjs <traceDir> <repoRoot>`
  prints the union record, and `parseTraceDirSplit(<traceDir>, <repoRoot>, <root.pid>)` the split (re-captured with
  Step 1's exact command, `-ttt` and the full list: every figure below as measured, `unresolved` 0 for all six):
  - `oss-metadata`'s `read` contains `.github/workflows/ci.yml`; `ccd-rc-flag`'s `read` contains `ccd/ccd`;
    `worker-skill`'s `listed` contains `ccd/worker-skill` (its `rest` side).
  - `ci-baseline`, split: `root.listed = ["server/test"]`, `rest.listed = []`; `root.read` = `.`, `server`,
    `server/package.json`, `server/test`, `server/test/ci-baseline.test.ts`, `server/tsconfig.json`,
    `server/vitest.config.ts`, `server/vitest.select.config.ts`; `rest.read = ["server/package.json"]`;
    `root.probed` 43 entries, `rest.probed = ["server/test/__snapshots__/ci-baseline.test.ts.snap"]`;
    `unresolved` 0. A test's import graph lands in `root` (the root process transforms it) and its runtime reads
    in `rest` (`worker-skill`: `root.read` holds `server/src/…`, `rest.read` holds `ccd/worker-skill/SKILL.md`).
  - `single-definition`, split, then each side minus the baseline's same side: `listed` still holds
    `server/test` (46 listed dirs in all); with the merged subtraction it did not.

- [ ] **Step 5: Measure the mutation table.** For each row: apply the edit to `.github/ci/trace-to-deps.mjs`, run
  Step 4's command, see exactly the named test(s) red, restore byte-for-byte, re-run green. All re-measured in the
  integration clone (30 cases each):

  | Mutation | Test(s) that go red |
  |---|---|
  | Delete the `node_modules` segment check in `classify` | `drops a path under a node_modules segment` (1) |
  | Delete the `.git` detection branch in `classify` | `records a .git read as the git flag…`, `the root pid and every thread its process creates are root…` (2) |
  | Remove the trailing-slash strip before `classify` | `treats a trailing-slash directory open as the same path…` (1) |
  | `isEnoent` always returns `false` | `records an ENOENT probe…`, `records a .git read…`, both `readlink` cases, `after a chdir, a relative access resolves against the NEW cwd` (5) |
  | Remove the `execve`-relative special case (resolve it like `access`) | `ignores a relative execve…` (1) |
  | Remove the outside-repo containment check in `classify` | `drops a path outside the repo…`, `resolves a relative access()… OUTSIDE the repo…`, and all three symlink cases (5) |
  | `READLINK_RE` never matches | `an ENOENT readlink is probed, a successful one read…`, `an EINVAL readlink is read…`, `a relative readlink resolves…` (3) |
  | Treat a relative `readlink` like a relative `execve` (ignored) | `a relative readlink resolves against the pid's cwd…`, `an EINVAL readlink is read…` (2) |
  | Drop the `readlink` EINVAL clause (only success reads) | `an EINVAL readlink is read: the path exists, it just is not a symlink…` (1) |
  | EINVAL is a read for EVERY dirfd-less syscall, not just `readlink` | `an EINVAL readlink is read…` (1 — its fixture's `access(…) = -1 EINVAL` must stay unrecorded) |
  | `readlink`'s EINVAL recorded as `probed` instead of `read` | `an EINVAL readlink is read…` (1) |
  | Root = the single file `t.<rootPid>` (no thread group) | `the root pid and every thread its process creates are root…` (1) |
  | Every `clone` counts as a thread (drop the `CLONE_THREAD` test) | `the root pid and every thread its process creates are root…` (1) |
  | Thread-group closure not transitive (one pass only) | `the root pid and every thread its process creates are root…` (1 — the fixture's `t.1000` sorts before `t.500`, so a single pass misses the thread `t.1000` created) |
  | `unresolved` counts the root side only | `a root pid with no file leaves root empty, and unresolved counts both sides` (1) |
  | Drop the resolved-fd read for the dirfd calls (`openat`…) | `a successful open of a path outside the repo records the repo file its fd resolved to` (1) |
  | Drop the resolved-fd read for `open` | the same (1) |
  | `symlink`/`symlinkat` targets ignored | `a created symlink records its in-repo TARGET as read — absolute, or relative to the link's directory`, `a symlink to an in-repo DIRECTORY records it as subtree…` (2) |
  | A relative target joined to the cwd instead of the link's directory | the same two (2) |
  | `SYMLINKAT_RE` never matches | the same two (2) |
  | A FAILED `symlink` recorded too | `a created symlink records its in-repo TARGET as read…` (1) |
  | `chdir` ignored | `after a chdir, a relative access resolves against the NEW cwd`, `before the chdir the old cwd holds…`, `threads share one cwd…`, `a relative call in the SAME microsecond as a move is unresolved…` (4) |
  | `fchdir` ignored | `before the chdir the old cwd holds; a relative chdir moves relative to it; fchdir takes its fd's path` (1) |
  | The cwd events not put in time order | `threads share one cwd: a chdir in one thread moves the cwd for another thread's LATER calls only` (1) |
  | A relative `chdir` taken as absolute from `/` | `before the chdir the old cwd holds…`, `with no known cwd, a relative path is unresolved…` (2) |
  | Disagreeing pre-move cwds taken as the first one | `with no known cwd, a relative path is unresolved…` (1) |
  | No thread grouping for the cwd (each file its own events) | `threads share one cwd…` (1) |
  | The `-ttt` stamp not stripped from the line | the four cwd cases above and the same-microsecond case (5) |
  | The cwd lookup with `<` for `<=` (a call sees the cwd from BEFORE a move stamped at or before it) | `a relative call in the SAME microsecond as a move is unresolved…`, `after a chdir…`, `before the chdir the old cwd holds…` (3) |
  | The same-microsecond rule removed (a tied call takes the new cwd) | `a relative call in the SAME microsecond as a move is unresolved: the stamp cannot order the two` (1) |
  | A link target is always `read` (no directory check) | `a symlink to an in-repo DIRECTORY records it as subtree (checked on disk when parsed); a file or dangling target stays read` (1) |
  | A link target is always `subtree` | the same, and `a created symlink records its in-repo TARGET as read…` (2) |
  | A dangling target throws (`statSync` without its `catch`) | the same two (2) |
  | The `subtree` bucket lands in `read` | `a symlink to an in-repo DIRECTORY records it as subtree…` (1) |
  | The record carries no `subtree` | the same (1) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

- [ ] **Step 7: Commit**

```bash
git add .github/ci/trace-to-deps.mjs server/test/ci-trace-to-deps.test.ts
git commit -F - <<'EOF'
feat(ci): strace trace parser, split by process

.github/ci/trace-to-deps.mjs parses `strace -f -ff -ttt -y -qq` output
(one file per thread) into a repo-relative DepRecord (read/probed/
listed/git), using the -y dirfd/fd annotations to resolve relative paths
without tracking file descriptors by hand. The four dirfd-less syscalls
(open/access/readlink/execve) resolve against the thread group's cwd AT
THAT MOMENT, from a -ttt-ordered timeline of AT_FDCWD annotations and
chdir/fchdir (git chdirs before it reads .git/config). A file reached
through a symlink is read: the -y return annotation of a successful
open names where it really led, and symlink/symlinkat into the
repository records the target — as read for a file, and as subtree for
a directory (checked on disk when parsed), because a stat or probe
through a linked directory names no repository path at all. readlink is parsed because
realpathSync.native probes a path with it and nothing else (measured);
its EINVAL (the path exists, not a symlink) counts as a read.

parseTraceDirSplit reads the same trace split by process: the vitest
root process's whole thread group (rebuilt from clone/clone3 lines with
CLONE_THREAD) apart from every other process. The include glob's walk of
server/test was measured on a root threadpool thread, so a split by pid
FILE would not separate it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


### Task 4: Test map `.github/ci/testmap.mjs`

**Files:**
- Create: `.github/ci/testmap.mjs`
- Test: `server/test/ci-testmap.test.ts`

**Interfaces:** Consumes: the JSDoc `DepRecord` typedef from Task 3 (type only; `node:fs`/`node:path` at runtime) and
Task 7's `Records` JSON (format 2). Produces: `MAP_FORMAT` (1), `RECORDS_FORMAT` (2), `TRACE_MISSING`,
`subtractBaseline(rec, baseline): DepRecord`, `buildMap(sha, records): TestMap`,
`refreshMap(old, sha, records, liveTests, traced): TestMap`, `GIT_FLOOR`, `WALK_FLOOR`, `FLOOR_GIT`, `FLOOR_WALK`,
`FAILED_UNDER_TRACE`, `traceVerdict(map, records, old): { floor, newlyFailed, stillFailing }`,
`readMap(file): {ok:true,map}|{ok:false,reason}`,
`writeMap(file, map): void`, `readRecordsDir(dir): Records`, the typedefs `DepRecord`, `TestRecord`, `SplitDeps`,
`SplitTestRecord`, `Records`, `TestMap`, and the CLI (`build --sha S --records DIR --out FILE [--old FILE]`;
`refresh --sha S --old FILE --records DIR --live FILE --traced FILE --out FILE`) — consumed by Tasks 5, 9 and 10 and
by Task 11's `map-build`. The CLI always writes the map first, then exits 4 when a floor test lost its breadth, 3
when a traced test newly failed or timed out under trace, else 0 — annotations naming each.
- Changed in integration (process split): records are format 2 — `{ format: 2, baseline: { root, rest }, tests:
  { [file]: { root, rest, unknown, why? } } }`. `buildMap`/`refreshMap` flatten each test as
  `union(subtractBaseline(t.root, baseline.root), subtractBaseline(t.rest, baseline.rest))` plus `unknown`/`why`;
  the map's `baseline` is `union(baseline.root, baseline.rest)` (what Task 5's `fullTrigger` reads);
  `readRecordsDir` accepts format 2 only, and refuses format 1 by name. The map itself stays `MAP_FORMAT` 1:
  its shape is unchanged. Why: see Task 3 — the include glob's walk of `server/test` is the ROOT's, a test's own
  walk of it is the REST's, and only a per-side subtraction keeps the second.
- Changed in integration (a lost trace): `refreshMap` takes `traced` — the tests select MEANT to re-trace (the CLI's
  `--traced FILE`, from Task 9's `--trace-list`) — and writes every live one that left no record
  `unknown: true, why: TRACE_MISSING` ('trace missing (shard failed or cancelled)') instead of carrying its old
  entry: those are exactly the tests whose dependencies the merge changed. A `build` simply leaves such a test out,
  and Task 5's rule 1 selects a test absent from the map. The CLI refuses a refresh without `--traced`.
- Changed in integration (the floor, operator's rulings M2 and R6 — spec §5.2's floor, now enforced): every
  `GIT_FLOOR` test (`source-bytes`, `topology-clean`, `deviation-refs`, `dtbd`, `providers`,
  `modelenv-single-writer`, `install-census`, `gitignore-secrets`) must come out `git: true` or `unknown`, and every
  `WALK_FLOOR` test (`single-definition`, `typecheck-tests`) must list something or be `unknown` — an `unknown` test
  is always selected, so it cannot shrink a selection. `buildMap`, and `refreshMap` for its freshly traced entries
  (a carried entry was judged when it was traced), do NOT refuse the map when one falls short: the violator is
  written `unknown` with why `FLOOR_GIT` ('floor: git is false') or `FLOOR_WALK` ('floor: lists nothing') — rule 2
  then selects it for every change, the very breadth the floor protects — and the CLI exits 4 after writing, naming
  it. Refusing the map (the M2 form) would let one legitimate refactor of a floor test — `install-census` walking
  the tree with `fs` instead of `git ls-files` — freeze the map on every merge until it expired. Measured on real
  traces in the integration clone: the eight `GIT_FLOOR` tests all `git: true`, `single-definition` 46 listed dirs,
  `typecheck-tests` 42 (it failed in a tree without `agent/`/`pwa/` modules, and passed once they were installed —
  CI installs all three).
- Changed in integration (news, operator's ruling R5): the CLI, not the trace runner, decides what is red, and only
  for news. After writing the map it compares each freshly traced test with `old` — the map this run started from:
  refresh's `--old`, and for a build an optional `--old` (the map `select` fetched, if any). A test that failed or
  timed out under trace (`FAILED_UNDER_TRACE`: why `vitest exited …` or `timeout after …`) and was NOT unknown in
  `old` is news: `::error::`, exit 3. One already unknown there is a `::warning::` only. With no `old` (a first
  build), every failure counts once. So a test that always fails under tracing — `session-hook`'s timing budgets —
  reds the first build that sees it and not every refresh after (it is unknown, so rule 2 re-traces it on every
  merge). An unreadable build `--old` is a `::warning::` and counts every failure (the loud direction).
- Changed in integration (directory links, operator's ruling R4): every `DepRecord` carries `subtree` (Task 3),
  subtracted per side like the other lists, joined by `unionDeps`, written by `writeMap` (key order `read, probed,
  listed, subtree, git`), and REQUIRED by `readMap` — a map record without it is malformed, so a full run. No
  format bump: no map of either format has been published anywhere yet (the first is Task 15's first refresh), so
  `MAP_FORMAT` 1 and `RECORDS_FORMAT` 2 now simply include the field.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-testmap.test.ts`:

<!-- file: server/test/ci-testmap.test.ts -->
```ts
// Task 4 (spec §5, CONTRACT.md `.github/ci/testmap.mjs`): the test map's
// shape, its build/refresh transitions and its on-disk read/write. Mutation
// table at the bottom of this file records, for every guard here, which case
// goes red when the guard is deleted.
//
// Records arrive SPLIT BY PROCESS (format 2, `trace-run.mjs`): `root` is the
// vitest root process, `rest` the worker and everything it spawns. The
// baseline is subtracted per side, then the two sides are joined — which is
// what removes the include glob's walk of `server/test/` (the root's) without
// erasing a test's own walk of the same directory (the rest's).
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  MAP_FORMAT, RECORDS_FORMAT, TRACE_MISSING, GIT_FLOOR, WALK_FLOOR, FLOOR_GIT, FLOOR_WALK, subtractBaseline, buildMap, refreshMap, readMap, writeMap, readRecordsDir,
} from '../../.github/ci/testmap.mjs';
import type { DepRecord, Records, SplitTestRecord, TestMap } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const emptyDep = (): DepRecord => ({ read: [], probed: [], listed: [], subtree: [], git: false });
const dep = (d: Partial<DepRecord> = {}): DepRecord => ({ ...emptyDep(), ...d });
/** A raw (format 2) test record: `root`/`rest` sides, plus unknown/why. */
const split = (root: Partial<DepRecord> = {}, rest: Partial<DepRecord> = {}, extra: { unknown?: boolean, why?: string } = {}): SplitTestRecord =>
  ({ root: dep(root), rest: dep(rest), unknown: !!extra.unknown, ...(extra.why !== undefined ? { why: extra.why } : {}) });
const records = (baseline: { root?: Partial<DepRecord>, rest?: Partial<DepRecord> }, tests: Record<string, SplitTestRecord>): Records =>
  ({ format: RECORDS_FORMAT, baseline: { root: dep(baseline.root), rest: dep(baseline.rest) }, tests });

describe('subtractBaseline', () => {
  it('removes baseline members from read/probed/listed/subtree, keeps sorted+unique', () => {
    const rec = {
      read: ['server/vitest.config.ts', 'server/src/a.ts', 'server/src/a.ts'],
      probed: ['server/test/x.ts'],
      listed: ['server/test'],
      subtree: ['deploy', 'shared'],
      git: false,
    };
    const baseline = {
      read: ['server/vitest.config.ts'], probed: [], listed: ['server/test'], subtree: ['shared'], git: false,
    };
    expect(subtractBaseline(rec, baseline)).toEqual({
      read: ['server/src/a.ts'], probed: ['server/test/x.ts'], listed: [], subtree: ['deploy'], git: false,
    });
  });

  it('keeps the git flag as-is regardless of the baseline (mutation: dropping this line collapses git to the baseline\'s own flag)', () => {
    const rec = { ...emptyDep(), git: true };
    const baseline = { ...emptyDep(), git: false };
    expect(subtractBaseline(rec, baseline).git).toBe(true);
  });
});

describe('buildMap', () => {
  it('subtracts each side\'s baseline from the same side, joins the sides, and carries unknown/why', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'] } }, {
      'server/test/a.test.ts': split({ read: ['server/vitest.config.ts', 'server/src/a.ts'], subtree: ['shared'] }, { read: ['ccd/ccd'], subtree: ['deploy'] }),
      'server/test/b.test.ts': split({}, {}, { unknown: true, why: 'timeout' }),
    });
    const map = buildMap(SHA_A, r);
    expect(map).toEqual({
      format: MAP_FORMAT,
      sha: SHA_A,
      baseline: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      tests: {
        'server/test/a.test.ts': { read: ['ccd/ccd', 'server/src/a.ts'], probed: [], listed: [], subtree: ['deploy', 'shared'], git: false, unknown: false },
        'server/test/b.test.ts': { ...emptyDep(), unknown: true, why: 'timeout' },
      },
    });
  });

  it('a test\'s OWN listing of server/test survives, the include glob\'s is subtracted (the reason records are split)', () => {
    // Measured: the glob's walk of server/test is in the baseline's ROOT side;
    // single-definition's census walks it again in its worker (REST).
    const r = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test', 'ccd'] }),
      'server/test/plain.test.ts': split({ listed: ['server/test'] }, {}),
    });
    const map = buildMap(SHA_A, r);
    expect(map.tests['server/test/single-definition.test.ts'].listed).toEqual(['ccd', 'server/test']);
    expect(map.tests['server/test/plain.test.ts'].listed).toEqual([]);
  });

  it('the map\'s baseline is the union of both sides (what fullTrigger reads), git ORed', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'], listed: ['server/test'] }, rest: { probed: ['server/test/__snapshots__/ci-baseline.test.ts.snap'], subtree: ['shared'], git: true } }, {});
    expect(buildMap(SHA_A, r).baseline).toEqual({
      read: ['server/vitest.config.ts'],
      probed: ['server/test/__snapshots__/ci-baseline.test.ts.snap'],
      listed: ['server/test'],
      subtree: ['shared'],
      git: true,
    });
  });

  it('omits `why` when the raw record carries none', () => {
    const r = records({}, { 't.test.ts': split() });
    expect(buildMap(SHA_A, r).tests['t.test.ts']).not.toHaveProperty('why');
  });

  it('a live test with no record at all is simply absent from a built map (the selector\'s rule 1 then selects it)', () => {
    const r = records({}, { 'server/test/traced.test.ts': split() });
    expect(Object.keys(buildMap(SHA_A, r).tests)).toEqual(['server/test/traced.test.ts']);
  });
});

describe('refreshMap', () => {
  const old: TestMap = {
    format: MAP_FORMAT,
    sha: SHA_A,
    baseline: emptyDep(),
    tests: {
      'server/test/kept.test.ts': { read: ['server/src/kept.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
      'server/test/gone.test.ts': { ...emptyDep(), unknown: false },
      'server/test/retraced.test.ts': { read: ['server/src/old.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
    },
  };

  it('fresh entries replace old ones; old entries for live-but-not-retraced tests are carried; dead tests dropped', () => {
    const r = records({}, { 'server/test/retraced.test.ts': split({ read: ['server/src/new.ts'] }) });
    const liveTests = ['server/test/kept.test.ts', 'server/test/retraced.test.ts'];
    const map = refreshMap(old, SHA_B, r, liveTests, ['server/test/retraced.test.ts']);
    expect(map.sha).toBe(SHA_B);
    expect(map.tests).toEqual({
      'server/test/kept.test.ts': old.tests['server/test/kept.test.ts'],
      'server/test/retraced.test.ts': { read: ['server/src/new.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
    });
    // gone.test.ts dropped — not in liveTests
    expect(map.tests).not.toHaveProperty('server/test/gone.test.ts');
  });

  it('a test MEANT to be traced whose record never arrived is unknown — never its stale old entry', () => {
    // The tests a refresh re-traces are exactly the ones whose dependencies
    // changed; a shard that crashed or was cancelled leaves them with no
    // record, and carrying the old entry forward would stop selecting them.
    const r = records({}, { 'server/test/retraced.test.ts': split({ read: ['server/src/new.ts'] }) });
    const liveTests = ['server/test/kept.test.ts', 'server/test/retraced.test.ts'];
    const map = refreshMap(old, SHA_B, r, liveTests, ['server/test/kept.test.ts', 'server/test/retraced.test.ts']);
    expect(map.tests['server/test/kept.test.ts']).toEqual({ ...emptyDep(), unknown: true, why: TRACE_MISSING });
    expect(map.tests['server/test/retraced.test.ts'].unknown).toBe(false);
  });

  it('a traced-list test that is no longer live is dropped, not written unknown', () => {
    const map = refreshMap(old, SHA_B, records({}, {}), ['server/test/kept.test.ts'], ['server/test/gone.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/kept.test.ts']);
  });

  it('a fresh record for a test NOT in liveTests is dropped (deleted mid-refresh)', () => {
    const r = records({}, {
      'server/test/kept.test.ts': split({ read: ['server/src/kept.ts'] }),
      'server/test/deleted-but-traced.test.ts': split(),
    });
    const map = refreshMap(old, SHA_B, r, ['server/test/kept.test.ts'], ['server/test/kept.test.ts', 'server/test/deleted-but-traced.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/kept.test.ts']);
  });

  it('a fresh record for a test with no old entry (new test) is still included', () => {
    const r = records({}, { 'server/test/new.test.ts': split() });
    const map = refreshMap(old, SHA_B, r, ['server/test/new.test.ts'], ['server/test/new.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/new.test.ts']);
  });

  it('baseline is the fresh records\' baseline (both sides joined), not the old map\'s', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'] }, rest: { read: ['server/package.json'] } }, {});
    const map = refreshMap(old, SHA_B, r, [], []);
    expect(map.baseline).toEqual({ read: ['server/package.json', 'server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false });
  });
});

describe('readMap / writeMap round-trip', () => {
  it('round-trips a map through disk', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    const map: TestMap = {
      format: MAP_FORMAT, sha: SHA_A,
      baseline: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      tests: {
        'server/test/b.test.ts': { read: [], probed: [], listed: [], subtree: ['deploy'], git: true, unknown: false },
        'server/test/a.test.ts': { read: ['x'], probed: [], listed: [], subtree: [], git: false, unknown: true, why: 'timeout' },
      },
    };
    writeMap(file, map);
    const result = readMap(file);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.map).toEqual(map);
  });

  it('writeMap sorts test keys and record fields (stable key order)', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeMap(file, {
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'z.test.ts': { ...emptyDep(), unknown: false },
        'a.test.ts': { ...emptyDep(), unknown: false },
      },
    });
    const raw = readFileSync(file, 'utf8');
    expect(raw.indexOf('"a.test.ts"')).toBeLessThan(raw.indexOf('"z.test.ts"'));
    // compact: no pretty-printed newlines
    expect(raw).not.toContain('\n');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(['format', 'sha', 'baseline', 'tests']);
  });
});

describe('readMap validation (never throws; the selector\'s full-suite fallback depends on this)', () => {
  it('unreadable file -> ok:false', () => {
    const result = readMap(path.join(mkTmp('ccrc-ci-testmap-'), 'nope.json'));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('unreadable') });
  });

  it('invalid JSON -> ok:false, does not throw', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    expect(() => readMap(file)).not.toThrow();
    expect(readMap(file).ok).toBe(false);
  });

  it('wrong format -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: 2, sha: SHA_A, baseline: emptyDep(), tests: {} }));
    const result = readMap(file);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('format') });
  });

  it('malformed sha (not 40-hex) -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: MAP_FORMAT, sha: 'not-a-sha', baseline: emptyDep(), tests: {} }));
    expect(readMap(file).ok).toBe(false);
  });

  it('malformed baseline record -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: MAP_FORMAT, sha: SHA_A, baseline: { read: 'not-an-array' }, tests: {} }));
    expect(readMap(file).ok).toBe(false);
  });

  it('a record without subtree -> ok:false (a map from before directory links were recorded is not trusted)', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 't.test.ts': { read: [], probed: [], listed: [], git: false, unknown: false } },
    }));
    expect(readMap(file)).toEqual({ ok: false, reason: 'malformed record for t.test.ts' });
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: { read: [], probed: [], listed: [], git: false }, tests: {},
    }));
    expect(readMap(file)).toEqual({ ok: false, reason: 'malformed baseline record' });
  });

  it('malformed test record (missing unknown) -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 't.test.ts': { read: [], probed: [], listed: [], subtree: [], git: false } },
    }));
    expect(readMap(file).ok).toBe(false);
  });
});

describe('readRecordsDir', () => {
  it('merges records*.json shards under a dir', () => {
    const dir = mkTmp('ccrc-ci-records-');
    const baseline = { root: { read: ['server/vitest.config.ts'] }, rest: { read: ['server/package.json'] } };
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify(records(baseline, { 'server/test/a.test.ts': split() })));
    writeFileSync(path.join(dir, 'records-2.json'), JSON.stringify(records(baseline, { 'server/test/b.test.ts': split() })));
    const merged = readRecordsDir(dir);
    expect(Object.keys(merged.tests).sort()).toEqual(['server/test/a.test.ts', 'server/test/b.test.ts']);
    expect(merged.baseline).toEqual({ root: dep(baseline.root), rest: dep(baseline.rest) });
  });

  it('throws when no records*.json files exist under the dir', () => {
    const dir = mkTmp('ccrc-ci-records-empty-');
    mkdirSync(dir, { recursive: true });
    expect(() => readRecordsDir(dir)).toThrow(/no records/);
  });

  it('refuses format-1 records (one merged record per test, from before the root/rest split)', () => {
    const dir = mkTmp('ccrc-ci-records-v1-');
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify({
      format: 1, baseline: emptyDep(), tests: { 'server/test/a.test.ts': { ...emptyDep(), unknown: false } },
    }));
    expect(() => readRecordsDir(dir)).toThrow(/records format 1.*expected 2/);
  });

  it('throws when two shards disagree on baseline — either side (mutation: deleting this check silently merges divergent baselines)', () => {
    const dir = mkTmp('ccrc-ci-records-mismatch-');
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify(records({ rest: { read: ['a'] } }, {})));
    writeFileSync(path.join(dir, 'records-2.json'), JSON.stringify(records({ rest: { read: ['b'] } }, {})));
    expect(() => readRecordsDir(dir)).toThrow(/baseline/);
  });
});

describe('the refresh CLI (what ci.yml\'s map-build runs)', () => {
  const TESTMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'testmap.mjs');
  const oldMap: TestMap = {
    format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
    tests: { 'server/test/kept.test.ts': { ...emptyDep(), read: ['server/src/kept.ts'], unknown: false } },
  };
  function run(extra: string[]): { status: number, stderr: string, dir: string } {
    const dir = mkTmp('ccrc-ci-testmap-cli-');
    mkdirSync(path.join(dir, 'records'));
    writeFileSync(path.join(dir, 'records', 'records-1.json'), JSON.stringify(records({}, {})));
    writeFileSync(path.join(dir, 'old.json'), JSON.stringify(oldMap));
    writeFileSync(path.join(dir, 'live.txt'), 'server/test/kept.test.ts\n');
    writeFileSync(path.join(dir, 'traced.txt'), 'server/test/kept.test.ts\n');
    const args = [TESTMAP, 'refresh', '--sha', SHA_B, '--old', path.join(dir, 'old.json'), '--records', path.join(dir, 'records'),
      '--live', path.join(dir, 'live.txt'), '--out', path.join(dir, 'new.json'), ...extra.map((a) => a.replace('DIR', dir))];
    try {
      execFileSync(process.execPath, args, { stdio: 'pipe' });
      return { status: 0, stderr: '', dir };
    } catch (e) {
      return { status: (e as { status: number }).status, stderr: String((e as { stderr: Buffer }).stderr), dir };
    }
  }

  it('refuses to refresh without --traced', () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refresh needs --traced FILE');
  });

  it('with --traced, a traced test that left no record comes out unknown', () => {
    const r = run(['--traced', 'DIR/traced.txt']);
    expect(r.status).toBe(0);
    const out = readMap(path.join(r.dir, 'new.json'));
    if (!out.ok) throw new Error(out.reason);
    expect(out.map.tests['server/test/kept.test.ts']).toEqual({ ...emptyDep(), unknown: true, why: TRACE_MISSING });
  });
});

describe('the CLI: the map is always written; the exit code says what newly broke (spec §5.4)', () => {
  // A traced test that fails under strace is recorded unknown and the map is published regardless. What goes red
  // is map-build, and only for news: exit 3 names each traced test that newly failed or timed out — unknown now,
  // not unknown in the map this run started from — and a failure that was already unknown is a ::warning::, so a
  // test that always fails under tracing (session-hook's timing budgets) reds the first build that sees it, not
  // every refresh after. Exit 4 names a floor violator (marked unknown above), and outranks 3.
  const TESTMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'testmap.mjs');
  const FAILS = 'server/test/fails.test.ts';
  const SLOW = 'server/test/slow.test.ts';
  const UNRESOLVED = 'server/test/unresolved.test.ts';
  const CLEAN = 'server/test/clean.test.ts';
  const traced = {
    [FAILS]: split({}, {}, { unknown: true, why: 'vitest exited 1' }),
    [SLOW]: split({}, {}, { unknown: true, why: 'timeout after 900s' }),
    [UNRESOLVED]: split({}, {}, { unknown: true, why: '2 unresolved relative path(s)' }),
    [CLEAN]: split({ read: ['server/src/clean.ts'] }),
  };
  function cli(cmd: 'build' | 'refresh', tests: Record<string, SplitTestRecord>, oldMap: TestMap | 'garbage' | null) {
    const dir = mkTmp('ccrc-ci-testmap-cli-');
    mkdirSync(path.join(dir, 'records'));
    writeFileSync(path.join(dir, 'records', 'records-1.json'), JSON.stringify(records({}, tests)));
    const names = Object.keys(tests);
    writeFileSync(path.join(dir, 'live.txt'), names.join('\n') + '\n');
    writeFileSync(path.join(dir, 'traced.txt'), names.join('\n') + '\n');
    const args = [TESTMAP, cmd, '--sha', SHA_B, '--records', path.join(dir, 'records'), '--out', path.join(dir, 'new.json')];
    if (oldMap !== null) {
      writeFileSync(path.join(dir, 'old.json'), oldMap === 'garbage' ? '{not json' : JSON.stringify(oldMap));
      args.push('--old', path.join(dir, 'old.json'));
    }
    if (cmd === 'refresh') args.push('--live', path.join(dir, 'live.txt'), '--traced', path.join(dir, 'traced.txt'));
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const written = readMap(path.join(dir, 'new.json'));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, written };
  }
  const oldWith = (unknownTests: string[]): TestMap => ({
    format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
    tests: Object.fromEntries([FAILS, SLOW, UNRESOLVED, CLEAN].map((n) => [n,
      unknownTests.includes(n) ? { ...emptyDep(), unknown: true, why: 'vitest exited 1' } : { ...emptyDep(), unknown: false }])),
  });

  it('build with no --old (a first build): every failure and timeout counts once — the map is written, then exit 3', () => {
    const r = cli('build', traced, null);
    expect(r.written.ok).toBe(true);
    if (!r.written.ok) throw new Error(r.written.reason);
    expect(r.written.map.tests[FAILS]).toMatchObject({ unknown: true, why: 'vitest exited 1' });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace (vitest exited 1)`);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace (timeout after 900s)`);
    // Unknown for another reason is not a failure.
    expect(r.stdout).not.toContain(UNRESOLVED);
  });

  it('build --old: a failure that was already unknown is a ::warning:: only; a new one is exit 3', () => {
    const r = cli('build', traced, oldWith([FAILS]));
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(`::warning::testmap: ${FAILS} still fails under trace (vitest exited 1)`);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace (timeout after 900s)`);
    expect(r.stdout).not.toContain(`::error::testmap: ${FAILS}`);
    const quiet = cli('build', traced, oldWith([FAILS, SLOW]));
    expect(quiet.status).toBe(0);
    expect(quiet.written.ok).toBe(true);
  });

  it('build --old that cannot be read: a ::warning::, and every failure counts (the loud direction)', () => {
    const r = cli('build', traced, 'garbage');
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('::warning::testmap: cannot read --old');
    expect(r.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace`);
  });

  it('refresh --old: the same rule — an already-unknown failure is a warning, a new one exit 3', () => {
    expect(cli('refresh', traced, oldWith([FAILS, SLOW])).status).toBe(0);
    const r = cli('refresh', traced, oldWith([FAILS]));
    expect(r.status).toBe(3);
    expect(r.written.ok).toBe(true);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace`);
  });

  it('a floor violator: the map is written with it unknown (always selected), then exit 4 naming it — over 3', () => {
    const r = cli('build', { 'server/test/dtbd.test.ts': split({ read: ['x'] }), [CLEAN]: traced[CLEAN] }, null);
    expect(r.written.ok).toBe(true);
    if (!r.written.ok) throw new Error(r.written.reason);
    expect(r.written.map.tests['server/test/dtbd.test.ts']).toMatchObject({ unknown: true, why: FLOOR_GIT });
    expect(r.status).toBe(4);
    expect(r.stdout).toContain(`::error::testmap: server/test/dtbd.test.ts ${FLOOR_GIT}`);
    const both = cli('build', { 'server/test/dtbd.test.ts': split({ read: ['x'] }), [FAILS]: traced[FAILS] }, null);
    expect(both.status).toBe(4);
    expect(both.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace`);
  });
});

describe('the floor: repo-wide guards must come out repo-wide (spec §5.2)', () => {
  // A tracer regression that stops seeing .git reads would silently narrow the repo-wide guards (rule 2 selects
  // a test only if it read .git); one that stops seeing directory walks would narrow single-definition and
  // typecheck-tests. So a freshly traced floor test that lacks its breadth is written UNKNOWN (rule 2 then always
  // selects it — the breadth the floor protects), the map is still written, and the CLI exits 4 naming it. The
  // map is never refused: one legitimate refactor of a floor test must not freeze the map until it expires.
  // `unknown` already passes: an unknown test is always selected.
  it('names the floor exactly as the spec does', () => {
    expect(GIT_FLOOR).toEqual(['source-bytes', 'topology-clean', 'deviation-refs', 'dtbd', 'providers',
      'modelenv-single-writer', 'install-census', 'gitignore-secrets'].map((n) => `server/test/${n}.test.ts`));
    expect(WALK_FLOOR).toEqual(['single-definition', 'typecheck-tests'].map((n) => `server/test/${n}.test.ts`));
  });

  it('a build writes a git-floor test with git false as unknown, why FLOOR_GIT, and keeps its record and every other entry', () => {
    const r = records({}, {
      'server/test/dtbd.test.ts': split({ read: ['x'] }),
      'server/test/plain.test.ts': split({ read: ['y'] }),
    });
    const map = buildMap(SHA_A, r);
    expect(FLOOR_GIT).toBe('floor: git is false');
    expect(map.tests['server/test/dtbd.test.ts']).toEqual({ ...emptyDep(), read: ['x'], unknown: true, why: FLOOR_GIT });
    expect(map.tests['server/test/plain.test.ts']).toEqual({ ...emptyDep(), read: ['y'], unknown: false });
  });

  it('a build accepts git true, or unknown', () => {
    const r = records({}, {
      'server/test/dtbd.test.ts': split({}, { git: true }),
      'server/test/providers.test.ts': split({}, {}, { unknown: true, why: 'vitest exited 1' }),
    });
    const map = buildMap(SHA_A, r);
    expect(map.tests['server/test/dtbd.test.ts']).toEqual({ ...emptyDep(), git: true, unknown: false });
    expect(map.tests['server/test/providers.test.ts'].why).toBe('vitest exited 1');
  });

  it('a build writes a walk-floor test that lists nothing (once the baseline is subtracted) as unknown, why FLOOR_WALK', () => {
    const r = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, {}),
    });
    expect(FLOOR_WALK).toBe('floor: lists nothing');
    expect(buildMap(SHA_A, r).tests['server/test/single-definition.test.ts']).toMatchObject({ unknown: true, why: FLOOR_WALK });
    const ok = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test'] }),
    });
    expect(buildMap(SHA_A, ok).tests['server/test/single-definition.test.ts'].listed).toEqual(['server/test']);
  });

  it('a refresh marks a freshly traced floor violation unknown, and does not re-judge a carried entry', () => {
    const old: TestMap = {
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/install-census.test.ts': { ...emptyDep(), unknown: false } },
    };
    const bad = records({}, { 'server/test/dtbd.test.ts': split() });
    const marked = refreshMap(old, SHA_B, bad, ['server/test/dtbd.test.ts', 'server/test/install-census.test.ts'], ['server/test/dtbd.test.ts']);
    expect(marked.tests['server/test/dtbd.test.ts']).toMatchObject({ unknown: true, why: FLOOR_GIT });
    expect(marked.tests['server/test/install-census.test.ts']).toEqual(old.tests['server/test/install-census.test.ts']);
    const good = records({}, { 'server/test/dtbd.test.ts': split({}, { git: true }) });
    const map = refreshMap(old, SHA_B, good, ['server/test/dtbd.test.ts', 'server/test/install-census.test.ts'], ['server/test/dtbd.test.ts']);
    expect(map.tests['server/test/install-census.test.ts']).toEqual(old.tests['server/test/install-census.test.ts']);
  });
});

/*
 * Mutation table (measured — see the plan's Task 4 for the transcript):
 *
 * mutation                                                    -> test that goes red
 * ---------------------------------------------------------------------------------
 * subtractBaseline: drop `git: rec.git` (fold to baseline's)   -> 'keeps the git flag as-is...'
 * buildMap: subtract the JOINED baseline from each side         -> 'a test's OWN listing of server/test survives...'
 * buildMap: map.baseline = the root side only                   -> 'the map's baseline is the union of both sides...'
 * readMap: drop the `format !== MAP_FORMAT` check               -> 'wrong format -> ok:false'
 * readMap: drop the sha-shape check                             -> 'malformed sha (not 40-hex) -> ok:false'
 * readMap: drop the baseline-shape check                        -> 'malformed baseline record -> ok:false'
 * readMap: drop the per-test shape check                        -> 'malformed test record (missing unknown) -> ok:false'
 * readRecordsDir: drop the RECORDS_FORMAT check                  -> 'refuses format-1 records...'
 * readRecordsDir: drop the baseline-agreement check              -> 'throws when two shards disagree on baseline'
 * refreshMap: drop the `!live.has(name) continue` filter on fresh -> 'a fresh record for a test NOT in liveTests is dropped (deleted mid-refresh)'
 * refreshMap: drop the traced-but-missing -> unknown loop        -> 'a test MEANT to be traced whose record never arrived is unknown...'
 * testmap CLI: drop the `--traced` requirement                  -> 'refuses to refresh without --traced'
 * refreshMap: drop the old-entry carry-forward loop               -> 'fresh entries replace old ones; old entries for live-but-not-retraced...' (kept.test.ts would vanish)
 */
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-testmap.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/testmap.mjs' imported from …/server/test/ci-testmap.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/testmap.mjs`:

<!-- file: .github/ci/testmap.mjs -->
```js
// The test map: the measured record of what each server test file reads,
// probes, lists and links whole (`subtree`) (spec §5.2), baseline-subtracted so an unrelated new test
// file doesn't drag `server/test/`'s own listing into every record (§5.2's
// last bullet). This module owns the map's shape, its build/refresh
// transitions (§5.3, §5.4) and its on-disk read/write — nothing here decides
// selection (that is `select-tests.mjs`, Task 5).
//
// The records it builds from arrive SPLIT BY PROCESS (format 2, from
// `trace-run.mjs`): `root` is the vitest root process — its config, its
// include glob's walk of `server/test/`, the transforms of the test's imports
// — and `rest` is the worker and everything the test spawns. The baseline is
// subtracted per side and the two sides are then joined into the map's one
// record per test. Subtracting a single merged baseline would also erase a
// test's OWN walk of `server/test/` (single-definition's census), because the
// glob walks the same directory; per side, only the glob's walk goes.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {import('./trace-to-deps.mjs').DepRecord} DepRecord */
/** @typedef {DepRecord & { unknown: boolean, why?: string }} TestRecord */
/** @typedef {{ root: DepRecord, rest: DepRecord }} SplitDeps */
/** @typedef {SplitDeps & { unknown: boolean, why?: string }} SplitTestRecord */
/** @typedef {{ format: 2, baseline: SplitDeps, tests: Record<string, SplitTestRecord> }} Records */
/** @typedef {{ format: 1, sha: string, baseline: DepRecord, tests: Record<string, TestRecord> }} TestMap */

export const MAP_FORMAT = 1;
export const RECORDS_FORMAT = 2;

/** The `why` of a test a refresh meant to re-trace but got no record for. */
export const TRACE_MISSING = 'trace missing (shard failed or cancelled)';

// THE FLOOR (spec §5.2). The repo-wide guards reach every change only through their breadth in the map: the
// git-reading ones through `git: true` (rule 2), the walking ones through what they list. A tracer regression
// that stops seeing `.git` reads or directory walks would narrow them silently, so a freshly traced floor test
// that lacks that breadth is written UNKNOWN, with why `FLOOR_GIT` / `FLOOR_WALK`: rule 2 then selects it for
// every change — exactly the breadth the floor protects. The map is still written (and published), and the CLI
// exits 4 naming it, so the break is loud while selection keeps working; refusing the whole map instead would
// let one legitimate refactor of a floor test freeze the map until it expired. `unknown` already passes: an
// unknown test is always selected. Checked on the REAL traces every map-build makes, which is what catches a
// strace-side regression as well as a parser one.
export const GIT_FLOOR = ['source-bytes', 'topology-clean', 'deviation-refs', 'dtbd', 'providers',
  'modelenv-single-writer', 'install-census', 'gitignore-secrets'].map((n) => `server/test/${n}.test.ts`);
export const WALK_FLOOR = ['single-definition', 'typecheck-tests'].map((n) => `server/test/${n}.test.ts`);
export const FLOOR_GIT = 'floor: git is false';
export const FLOOR_WALK = 'floor: lists nothing';

/** Rewrites every floor test among `tests` that lacks its breadth as unknown, with the floor's `why`.
 *  @param {Record<string, TestRecord>} tests */
function markFloor(tests) {
  for (const f of GIT_FLOOR) {
    const r = tests[f];
    if (r && !r.unknown && !r.git) tests[f] = { ...r, unknown: true, why: FLOOR_GIT };
  }
  for (const f of WALK_FLOOR) {
    const r = tests[f];
    if (r && !r.unknown && r.listed.length === 0) tests[f] = { ...r, unknown: true, why: FLOOR_WALK };
  }
}

/** A `why` trace-run writes for a test that FAILED under trace: vitest exited non-zero, or the per-file deadline
 *  killed it — as opposed to unknown for any other reason (an unresolved path, a missing trace, the floor). */
export const FAILED_UNDER_TRACE = /^(vitest exited|timeout after)/;

const SHA_RE = /^[0-9a-f]{40}$/;

/** Sort + dedupe a string array. Every `DepRecord` array is kept in this
 *  shape by construction — callers never see an unsorted or duplicated list. */
function sortedUnique(arr) {
  return [...new Set(arr)].sort();
}

/** `arr` with every member of `remove` taken out, staying sorted+unique. */
function subtractArr(arr, remove) {
  const drop = new Set(remove);
  return sortedUnique(arr.filter((x) => !drop.has(x)));
}

/** @param {DepRecord} rec @param {DepRecord} baseline @returns {DepRecord} */
export function subtractBaseline(rec, baseline) {
  return {
    read: subtractArr(rec.read, baseline.read),
    probed: subtractArr(rec.probed, baseline.probed),
    listed: subtractArr(rec.listed, baseline.listed),
    subtree: subtractArr(rec.subtree, baseline.subtree),
    // The baseline's own git flag never suppresses a test's git flag: a test
    // that reads `.git` still needs the ALWAYS rule (spec §6.2 rule 2) even
    // though vitest's own startup does not touch `.git`. "kept as is" (the
    // contract's words) — this is not an oversight, it is the only baseline
    // field that isn't a set.
    git: rec.git,
  };
}

/** Both records joined: every list's union (sorted, unique), `git` ORed.
 *  @param {DepRecord} a @param {DepRecord} b @returns {DepRecord} */
function unionDeps(a, b) {
  return {
    read: sortedUnique([...a.read, ...b.read]),
    probed: sortedUnique([...a.probed, ...b.probed]),
    listed: sortedUnique([...a.listed, ...b.listed]),
    subtree: sortedUnique([...a.subtree, ...b.subtree]),
    git: a.git || b.git,
  };
}

/** A map entry: each side minus the SAME side of the baseline, the two sides
 *  joined, plus the `unknown`/`why` fields carried through untouched.
 *  @param {SplitTestRecord} rec @param {SplitDeps} baseline @returns {TestRecord} */
function flattenTestRecord(rec, baseline) {
  /** @type {TestRecord} */
  const out = {
    ...unionDeps(subtractBaseline(rec.root, baseline.root), subtractBaseline(rec.rest, baseline.rest)),
    unknown: !!rec.unknown,
  };
  if (rec.why !== undefined) out.why = rec.why;
  return out;
}

/** @param {string} sha @param {Records} records @returns {TestMap} */
export function buildMap(sha, records) {
  /** @type {Record<string, TestRecord>} */
  const tests = {};
  for (const name of Object.keys(records.tests)) {
    tests[name] = flattenTestRecord(records.tests[name], records.baseline);
  }
  markFloor(tests);
  return { format: MAP_FORMAT, sha, baseline: unionDeps(records.baseline.root, records.baseline.rest), tests };
}

/**
 * @param {TestMap} old
 * @param {string} sha
 * @param {Records} records fresh traces for the tests this refresh retraced
 * @param {string[]} liveTests every test file that still exists in the tree
 * @param {string[]} traced every test this refresh MEANT to re-trace (select's
 *   trace list, not what arrived)
 * @returns {TestMap}
 */
export function refreshMap(old, sha, records, liveTests, traced) {
  const live = new Set(liveTests);
  /** @type {Record<string, TestRecord>} */
  const tests = {};
  for (const name of Object.keys(records.tests)) {
    if (!live.has(name)) continue;
    tests[name] = flattenTestRecord(records.tests[name], records.baseline);
  }
  // Only the freshly traced entries are judged; a carried entry was judged when it was traced.
  markFloor(tests);
  for (const name of traced) {
    if (!live.has(name) || name in tests) continue;
    // Meant to be re-traced, and no record arrived (a trace shard crashed or
    // was cancelled). These are exactly the tests whose dependencies this
    // merge changed, so their old entries are the one thing that must NOT be
    // carried: unknown selects them (rule 2) until a clean trace replaces it.
    tests[name] = { read: [], probed: [], listed: [], subtree: [], git: false, unknown: true, why: TRACE_MISSING };
  }
  for (const name of liveTests) {
    if (name in tests) continue;
    // Not freshly traced this refresh: carry the old entry verbatim (spec
    // §5.4 — sound because a test that read none of the changed paths
    // executed identically, so its record is unchanged).
    if (old && old.tests && Object.prototype.hasOwnProperty.call(old.tests, name)) {
      tests[name] = old.tests[name];
    }
  }
  return { format: MAP_FORMAT, sha, baseline: unionDeps(records.baseline.root, records.baseline.rest), tests };
}

/** @param {unknown} v @returns {v is string[]} */
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** @param {unknown} v @returns {v is DepRecord} */
function isDepRecordShape(v) {
  return !!v && typeof v === 'object'
    && isStringArray(/** @type {any} */ (v).read)
    && isStringArray(/** @type {any} */ (v).probed)
    && isStringArray(/** @type {any} */ (v).listed)
    && isStringArray(/** @type {any} */ (v).subtree)
    && typeof (/** @type {any} */ (v).git) === 'boolean';
}

/** @param {unknown} v @returns {v is TestRecord} */
function isTestRecordShape(v) {
  if (!isDepRecordShape(v)) return false;
  const t = /** @type {any} */ (v);
  if (typeof t.unknown !== 'boolean') return false;
  if ('why' in t && typeof t.why !== 'string') return false;
  return true;
}

/**
 * Never throws. A malformed, unreadable or wrong-format map answers
 * `{ ok: false, reason }` — the caller (the selector) falls back to a full
 * run on this (spec §6.3's first bullet), so this function's job is to
 * catch every way a map can be untrustworthy, not to explain why to a human.
 * @param {string} file
 * @returns {{ ok: true, map: TestMap } | { ok: false, reason: string }}
 */
export function readMap(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, reason: `unreadable: ${/** @type {Error} */ (e).message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `invalid JSON: ${/** @type {Error} */ (e).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'not an object' };
  }
  if (parsed.format !== MAP_FORMAT) {
    return { ok: false, reason: `unknown format ${JSON.stringify(parsed.format)}` };
  }
  if (typeof parsed.sha !== 'string' || !SHA_RE.test(parsed.sha)) {
    return { ok: false, reason: 'malformed sha' };
  }
  if (!isDepRecordShape(parsed.baseline)) {
    return { ok: false, reason: 'malformed baseline record' };
  }
  if (!parsed.tests || typeof parsed.tests !== 'object' || Array.isArray(parsed.tests)) {
    return { ok: false, reason: 'malformed tests map' };
  }
  for (const name of Object.keys(parsed.tests)) {
    if (!isTestRecordShape(parsed.tests[name])) {
      return { ok: false, reason: `malformed record for ${name}` };
    }
  }
  return { ok: true, map: /** @type {TestMap} */ (parsed) };
}

function sortedDepRecord(rec) {
  const out = {
    read: [...rec.read].sort(),
    probed: [...rec.probed].sort(),
    listed: [...rec.listed].sort(),
    subtree: [...rec.subtree].sort(),
    git: !!rec.git,
  };
  if ('unknown' in rec) out.unknown = !!rec.unknown;
  if (rec.why !== undefined) out.why = rec.why;
  return out;
}

/** Stable key order (`format`, `sha`, `baseline`, `tests`, tests sorted by
 *  name; each record's own keys in `read, probed, listed, subtree, git[,
 *  unknown, why]` order), compact (no indentation) — a rebuild of an unchanged map
 *  therefore diffs as no-op instead of reordering JSON keys.
 *  @param {string} file @param {TestMap} map */
export function writeMap(file, map) {
  const tests = {};
  for (const name of Object.keys(map.tests).sort()) {
    tests[name] = sortedDepRecord(map.tests[name]);
  }
  const canonical = {
    format: map.format,
    sha: map.sha,
    baseline: sortedDepRecord(map.baseline),
    tests,
  };
  writeFileSync(file, JSON.stringify(canonical));
}

/** Merge every `records*.json` under `dir` (one per trace shard) into one
 *  `Records`. Only format 2 (split by process) is accepted: a format-1 file
 *  holds one merged record per test, which cannot be subtracted per side.
 *  Baselines must agree (identical after sort, both sides) — a divergent
 *  baseline between shards means the baseline test itself behaved
 *  differently on two runners, which would corrupt every subtraction
 *  silently if merged anyway, so this throws rather than picking one.
 *  @param {string} dir @returns {Records} */
export function readRecordsDir(dir) {
  const files = readdirSync(dir).filter((f) => /^records.*\.json$/.test(f)).sort();
  if (files.length === 0) {
    throw new Error(`no records*.json under ${dir}`);
  }
  /** @type {SplitDeps | null} */
  let baseline = null;
  /** @type {Record<string, SplitTestRecord>} */
  const tests = {};
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    if (parsed.format !== RECORDS_FORMAT) {
      throw new Error(`${f}: records format ${JSON.stringify(parsed.format)}, expected ${RECORDS_FORMAT} `
        + '(split by process) — re-trace with this tree\'s trace-run.mjs');
    }
    const thisBaseline = { root: sortedDepRecord(parsed.baseline.root), rest: sortedDepRecord(parsed.baseline.rest) };
    if (baseline === null) {
      baseline = thisBaseline;
    } else if (JSON.stringify(thisBaseline) !== JSON.stringify(baseline)) {
      throw new Error(`${f}: baseline disagrees with an earlier shard`);
    }
    for (const name of Object.keys(parsed.tests)) {
      tests[name] = parsed.tests[name];
    }
  }
  return { format: RECORDS_FORMAT, baseline: /** @type {SplitDeps} */ (baseline), tests };
}

function readLines(file) {
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

/**
 * What the traced run says, for the map just written: the floor violators (exit 4), the traced tests that NEWLY
 * failed under trace — failed or timed out now, and not unknown in `old`, the map this run started from — (exit 3),
 * and the failures that were already unknown there (a warning: a test that always fails under tracing reds the
 * first build that sees it, not every run after). With no `old`, every failure is new.
 * @param {TestMap} map @param {Records} records @param {TestMap | null} old
 * @returns {{ floor: string[], newlyFailed: string[], stillFailing: string[] }}
 */
export function traceVerdict(map, records, old) {
  const floor = [];
  const newlyFailed = [];
  const stillFailing = [];
  for (const name of Object.keys(records.tests).sort()) {
    const rec = map.tests[name];
    if (!rec || !rec.unknown) continue;
    if (rec.why === FLOOR_GIT || rec.why === FLOOR_WALK) floor.push(name);
    else if (FAILED_UNDER_TRACE.test(rec.why ?? '')) {
      if (old && old.tests && old.tests[name] && old.tests[name].unknown) stillFailing.push(name);
      else newlyFailed.push(name);
    }
  }
  return { floor, newlyFailed, stillFailing };
}

/** Prints the verdict as annotations and returns the exit code: 4 for a floor violator, else 3 for a newly failing
 *  test, else 0. Called only AFTER the map is written, so a red run still publishes. */
function report(map, verdict) {
  for (const name of verdict.floor) {
    process.stdout.write(`::error::testmap: ${name} ${map.tests[name].why} — written unknown (always selected); `
      + 'fix the test, or GIT_FLOOR/WALK_FLOOR in .github/ci/testmap.mjs\n');
  }
  for (const name of verdict.newlyFailed) {
    process.stdout.write(`::error::testmap: ${name} newly fails under trace (${map.tests[name].why})\n`);
  }
  for (const name of verdict.stillFailing) {
    process.stdout.write(`::warning::testmap: ${name} still fails under trace (${map.tests[name].why}) — unknown before this run too\n`);
  }
  if (verdict.floor.length > 0) return 4;
  if (verdict.newlyFailed.length > 0) return 3;
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'build') {
    // --old is optional here: the map select fetched, if any — only to tell a new failure from an old one.
    /** @type {TestMap | null} */
    let old = null;
    if (args.old) {
      const oldResult = readMap(args.old);
      if (oldResult.ok) old = oldResult.map;
      else process.stdout.write(`::warning::testmap: cannot read --old (${oldResult.reason}); every failure counts as new\n`);
    }
    const records = readRecordsDir(args.records);
    const map = buildMap(args.sha, records);
    writeMap(args.out, map);
    process.exitCode = report(map, traceVerdict(map, records, old));
    return;
  }
  if (cmd === 'refresh') {
    const oldResult = readMap(args.old);
    if (!oldResult.ok) {
      throw new Error(`cannot read --old map: ${oldResult.reason}`);
    }
    if (!args.traced) {
      throw new Error('refresh needs --traced FILE: the tests select meant to trace, one per line');
    }
    const records = readRecordsDir(args.records);
    const liveTests = readLines(args.live);
    const traced = readLines(args.traced);
    const map = refreshMap(oldResult.map, args.sha, records, liveTests, traced);
    writeMap(args.out, map);
    process.exitCode = report(map, traceVerdict(map, records, oldResult.map));
    return;
  }
  throw new Error(`unknown command ${JSON.stringify(cmd)} (expected "build" or "refresh")`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-testmap.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  38 passed (38)`.

- [ ] **Step 5: Measure the mutation table.** For each row, apply the mutation to `.github/ci/testmap.mjs`, run
  Step 4's command, confirm exactly the named test(s) go red, then restore the file byte-for-byte and re-run green
  before the next row. All re-measured in the integration clone (38 cases each):

  | mutation | test(s) that go red |
  |---|---|
  | `subtractBaseline`: fold `git: rec.git` to `git: baseline.git` | `keeps the git flag as-is...`, and the floor's `a build accepts git true, or unknown` (2) |
  | `buildMap`: subtract the JOINED baseline from the joined record (no per-side subtraction) | `a test's OWN listing of server/test survives, the include glob's is subtracted...`, `a build writes a walk-floor test that lists nothing (once the baseline is subtracted) as unknown, why FLOOR_WALK` (2) |
  | `buildMap`: `map.baseline` = the root side only | `the map's baseline is the union of both sides...` (1) |
  | `readMap`: drop the `format !== MAP_FORMAT` check | `wrong format -> ok:false` (1) |
  | `readMap`: drop the sha-shape check | `malformed sha (not 40-hex) -> ok:false` (1) |
  | `readMap`: drop the baseline-shape check | `malformed baseline record -> ok:false`, `a record without subtree -> ok:false…` (2) |
  | `readMap`: drop the per-test shape check | `malformed test record (missing unknown) -> ok:false`, `a record without subtree -> ok:false…` (2) |
  | `readRecordsDir`: drop the `RECORDS_FORMAT` check | `refuses format-1 records...` (1) |
  | `readRecordsDir`: drop the baseline-agreement `else if` branch | `throws when two shards disagree on baseline — either side` (1) |
  | `refreshMap`: drop the `if (!live.has(name)) continue;` filter on fresh entries | `a fresh record for a test NOT in liveTests is dropped (deleted mid-refresh)` (1) |
  | `refreshMap`: drop the traced-but-missing → unknown loop | `a test MEANT to be traced whose record never arrived is unknown...`, `with --traced, a traced test that left no record comes out unknown` (2) |
  | `refreshMap`: drop the old-entry carry-forward | `fresh entries replace old ones; old entries for live-but-not-retraced tests are carried...`, `a traced-list test that is no longer live is dropped...`, `a refresh marks a freshly traced floor violation unknown, and does not re-judge a carried entry` (3) |
  | CLI: drop the `--traced` requirement | `refuses to refresh without --traced` (1) |
  | `buildMap`: skip the floor | `a build writes a git-floor test with git false as unknown…`, `a build writes a walk-floor test that lists nothing … as unknown…`, `a floor violator: the map is written with it unknown (always selected), then exit 4 naming it — over 3` (3) |
  | `refreshMap`: skip the floor | `a refresh marks a freshly traced floor violation unknown, and does not re-judge a carried entry` (1) |
  | `refreshMap`: judge the floor at the END (carried entries too) | the same (1) |
  | The git floor violator not marked | the same, `a build writes a git-floor test with git false as unknown…` and `a floor violator: … exit 4…` (3) |
  | The walk floor violator not marked | `a build writes a walk-floor test that lists nothing … as unknown, why FLOOR_WALK` (1) |
  | The floor throws again (the whole map refused — the M2 form) | the same three as the git floor row (3) |
  | An `unknown` floor test re-marked too | `a build accepts git true, or unknown` (1) |
  | `GIT_FLOOR` loses `gitignore-secrets` | `names the floor exactly as the spec does` (1) |
  | A floor violator exits 3, or 0, instead of 4 | `a floor violator: the map is written with it unknown (always selected), then exit 4 naming it — over 3` (1 each) |
  | Every failure counts (the old map ignored) | `build --old: a failure that was already unknown is a ::warning:: only; a new one is exit 3`, `refresh --old: the same rule…` (2) |
  | Any unknown counts as a failure (not only `vitest exited`/`timeout after`) | the same two, and `build with no --old (a first build): every failure and timeout counts once…` (3) |
  | A newly failing test exits 0 | the four exit-3 cases (4) |
  | `build` ignores `--old` | `build --old: a failure that was already unknown is a ::warning:: only…` (1) |
  | `build`: an unreadable `--old` throws | `build --old that cannot be read: a ::warning::, and every failure counts (the loud direction)` (1) |
  | `build` writes the map only on a clean exit | `a floor violator: the map is written…`, `build with no --old (a first build)…` (2) |
  | `refresh` ignores its old map for news | `refresh --old: the same rule — an already-unknown failure is a warning, a new one exit 3` (1) |
  | `subtractBaseline` keeps the baseline's `subtree` | `removes baseline members from read/probed/listed/subtree, keeps sorted+unique` (1) |
  | `unionDeps` takes one side's `subtree` | `subtracts each side's baseline from the same side, joins the sides…`, `the map's baseline is the union of both sides…` (2) |
  | `readMap` accepts a record without `subtree` | `a record without subtree -> ok:false (a map from before directory links were recorded is not trusted)` (1) |
  | `writeMap` drops `subtree` | `round-trips a map through disk` (1 — first measured SURVIVING: no fixture carried a non-empty `subtree` through the round trip; the fixture now does) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

  (`grep -ln 'testmap' server/test/*.ts` at this commit returns only `ci-testmap.test.ts`; Tasks 5, 9 and 10 add
  the rest.)

- [ ] **Step 7: Commit**

```bash
git add .github/ci/testmap.mjs server/test/ci-testmap.test.ts
git commit -F - <<'EOF'
feat(ci): the test map module (build/refresh/read/write)

.github/ci/testmap.mjs owns the TestMap shape (spec §5.2), baseline
subtraction, the build (§5.3) and refresh (§5.4) transitions, and
never-throw validated reads so the selector can fall back to a full run
on any malformed map (§6.3). Records arrive split by process (format 2);
the baseline is subtracted per side, so the include glob's walk of
server/test goes while a test's own walk of it stays. A refresh is told
which tests it meant to re-trace, and writes any of them that left no
record as unknown instead of carrying its stale entry. Every record
carries subtree. A floor test that lost its breadth (a git-reading guard
with git false, a tree walker that lists nothing) is written unknown —
always selected — and the map is still written; the CLI then exits 4
naming it, or 3 naming each traced test that newly failed under trace
(failing now, not unknown in the map the run started from).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Selector `.github/ci/select-tests.mjs`

**Files:**
- Create: `.github/ci/select-tests.mjs`
- Test: `server/test/ci-select-tests.test.ts`

**Interfaces:** Consumes: the `DepRecord`/`TestMap` typedefs from Task 4 (type only — `testmap.mjs`'s `readMap` is
dynamically imported only inside this module's own CLI `main()`, so the exported functions are pure and only need a
`TestMap`-shaped object; the test file imports `buildMap`/`refreshMap` to pin the two modules end to end).
Produces: `readChanges(repoDir, fromSha, toRef?): Change[]`, `liveTestFiles(repoDir, ref?): string[]`,
`gitExistsAt(repoDir): (ref,p)=>boolean`, `fullTrigger(changes, baseline): string|null`,
`selectTests({map, changes, liveTests, existsAt}): Selection` (each selected test carries `rule: 1|2|3|4|5|6`),
`RULE_NAMES` (`{ 1: 'NEW', 2: 'ALWAYS', 3: 'READ', 4: 'PROBED', 5: 'LISTED', 6: 'SUBTREE' }`, what Task 9's reason
table prints), and the typedefs `Change`, `Selection` — consumed by Task 9 (`select.mjs`) and Task 10
(`replay.mjs`).
- Changed in integration (process split): `fullTrigger` no longer fires on a path "directly in a `baseline.listed`
  dir". The baseline lists `server/test` (the include glob walks it, with a literal include too), and 29 of the
  last 60 merged PRs added or deleted a file there — every one of them would have run the full suite. Dropping the
  clause is safe only because of Task 4's per-side subtraction: a test that walks `server/test` itself keeps that
  listing and is selected by rule 5, the added test by rule 1 — pinned end to end below. `baseline.read` and
  `baseline.probed` stay triggers.
- Changed in integration (operator's rulings P1-P2): `.gitattributes` and `.npmrc` at ANY depth, and any path under
  `server/scripts/`, are full-run triggers — each is consumed by a setup step before any traced process runs (git
  applies `.gitattributes` at checkout, `npm ci` reads `.npmrc`, the install lifecycle runs `server/scripts/`), so
  no trace can see it. And `readChanges` strips the leading `:` of `git diff --raw`'s old mode, so a symlink turned
  into a file (`:120000 100644`) is still seen as a symlink change.
- Changed in integration (directory links, operator's ruling R4 — spec §6.2 rule 6): rule 6, SUBTREE, selects a test
  when ANY changed path — added, modified or deleted — sits at or under a directory in its `subtree` (Task 3: a
  directory it linked whole into a fixture home, then stat'ed or probed through). "At or under" is the directory
  itself or a path below `dir/` — `deploy2/x` is not under `deploy` — and `'.'` (a link to the whole repository)
  holds everything. It runs after rules 1-5, so a test they already select keeps its earlier reason. A directory
  in the BASELINE's `subtree` is a full-run trigger (`baseline links this directory: <path>`), like its reads: the
  baseline is subtracted from every test, so nothing else would select for it.
- Changed in integration: the JSDoc typedefs moved from `//` comments into `/** */` blocks — in a `//` comment
  they were invisible, and `@returns {Selection}` resolved to the DOM's `Selection` type, which failed
  `tsc -p test/tsconfig.tests.json` (the project `typecheck-tests.test.ts` runs in CI). New end-to-end cases pin a
  renamed test file (D old + A new) and the two lost-trace paths of Task 4.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-select-tests.test.ts`:

<!-- file: server/test/ci-select-tests.test.ts -->
```ts
// Task 5 (spec §6, CONTRACT.md `.github/ci/select-tests.mjs`): the selector.
// Mocked-`existsAt` unit tests cover every rule and every `fullTrigger`
// clause in isolation; the `--- git-backed integration ---` block builds real
// fixture repos (this repo's fixture-identity idiom: `GIT_AUTHOR_EMAIL
// fixture@example.invalid`, matching `buildinfo.test.ts`/`build-release.test.ts`)
// for `readChanges`/`liveTestFiles`/`gitExistsAt` themselves and for the
// Review Focus scenarios, which are about real ancestor existence on a real
// tree. Mutation table at the bottom.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  readChanges, liveTestFiles, gitExistsAt, fullTrigger, selectTests, RULE_NAMES,
} from '../../.github/ci/select-tests.mjs';
import { buildMap, refreshMap, RECORDS_FORMAT } from '../../.github/ci/testmap.mjs';
import type { DepRecord, TestMap, TestRecord } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);

function emptyDep(): DepRecord {
  return { read: [], probed: [], listed: [], subtree: [], git: false };
}

function rec(overrides: Partial<TestRecord> = {}): TestRecord {
  return { ...emptyDep(), unknown: false, ...overrides };
}

// ─── fullTrigger ────────────────────────────────────────────────────────

describe('fullTrigger', () => {
  const baseline = { read: ['shared/mark.mjs'], probed: ['server/probed-only.ts'], listed: ['server/test'], subtree: ['deploy/linked'], git: false };

  it('package.json anywhere', () => {
    const reason = fullTrigger([{ status: 'M', path: 'server/package.json', symlink: false }], baseline);
    expect(reason).toMatch(/package manifest/);
  });

  it('package-lock.json anywhere', () => {
    const reason = fullTrigger([{ status: 'M', path: 'server/package-lock.json', symlink: false }], baseline);
    expect(reason).toMatch(/package manifest/);
  });

  it('vitest config, including the exact-list config', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/vitest.config.ts', symlink: false }], baseline))
      .toMatch(/vitest config/);
    expect(fullTrigger([{ status: 'A', path: 'server/vitest.select.config.ts', symlink: false }], baseline))
      .toMatch(/vitest config/);
  });

  it('tsconfig*.json', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/tsconfig.json', symlink: false }], baseline))
      .toMatch(/tsconfig/);
  });

  it('anything under .github/', () => {
    expect(fullTrigger([{ status: 'M', path: '.github/workflows/ci.yml', symlink: false }], baseline))
      .toMatch(/pipeline path/);
  });

  it('.gitattributes at any depth (checkout applies it outside any traced process)', () => {
    expect(fullTrigger([{ status: 'A', path: '.gitattributes', symlink: false }], baseline)).toMatch(/checkout attributes/);
    expect(fullTrigger([{ status: 'M', path: 'ccd/.gitattributes', symlink: false }], baseline)).toMatch(/checkout attributes/);
  });

  it('.npmrc at any depth (npm ci reads it before any test runs)', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/.npmrc', symlink: false }], baseline)).toMatch(/npm config/);
  });

  it('anything under server/scripts/ (the install lifecycle scripts)', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/scripts/fix-node-pty-helper.mjs', symlink: false }], baseline))
      .toMatch(/install script/);
  });

  it('a symlinked path', () => {
    expect(fullTrigger([{ status: 'A', path: 'server/src/link.ts', symlink: true }], baseline))
      .toMatch(/symlink/);
  });

  it('a path in baseline.read', () => {
    expect(fullTrigger([{ status: 'M', path: 'shared/mark.mjs', symlink: false }], baseline))
      .toMatch(/baseline reads/);
  });

  it('a path in baseline.probed', () => {
    expect(fullTrigger([{ status: 'A', path: 'server/probed-only.ts', symlink: false }], baseline))
      .toMatch(/baseline probed/);
  });

  it('a path at or under a baseline.subtree directory (every test\'s startup linked it whole)', () => {
    expect(fullTrigger([{ status: 'M', path: 'deploy/linked/x.sh', symlink: false }], baseline))
      .toBe('baseline links this directory: deploy/linked/x.sh');
    expect(fullTrigger([{ status: 'A', path: 'deploy/linked-not/x.sh', symlink: false }], baseline)).toBeNull();
  });

  it('a file added directly in a baseline.listed dir is NOT a trigger (server/test/new.test.ts)', () => {
    // The baseline lists server/test because vitest's include glob walks it —
    // with a literal include too (measured). Were that listing a trigger,
    // every PR that adds or deletes a test file (29 of the last 60 merged)
    // would run the full suite. A test that walks server/test in its OWN
    // right keeps that listing in its record (records are split by process,
    // testmap.mjs) and is selected by rule 5 instead.
    expect(fullTrigger([{ status: 'A', path: 'server/test/new.test.ts', symlink: false }], baseline)).toBeNull();
    expect(fullTrigger([{ status: 'D', path: 'server/test/old.test.ts', symlink: false }], baseline)).toBeNull();
  });

  it('no trigger -> null', () => {
    expect(fullTrigger([{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }], baseline)).toBeNull();
    expect(fullTrigger([], baseline)).toBeNull();
  });
});

// ─── selectTests: rule-by-rule (mocked existsAt) ───────────────────────────

describe('selectTests rule 1 (NEW)', () => {
  it('selects a test file absent from the map', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/test/new.test.ts', symlink: false }],
      liveTests: ['server/test/new.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/new.test.ts', rule: 1, path: 'server/test/new.test.ts' }] });
  });

  it('selects a test file absent from the map even with NO changes at all (isolates the absent-from-map clause from the own-change clause)', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const sel = selectTests({
      map, changes: [], liveTests: ['server/test/never-traced.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/never-traced.test.ts', rule: 1, path: 'server/test/never-traced.test.ts' }] });
  });

  it('selects a test file that is itself modified, even though it has a map entry', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec() },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/test/known.test.ts', symlink: false }],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/known.test.ts', rule: 1, path: 'server/test/known.test.ts' }] });
  });
});

describe('selectTests rule 2 (ALWAYS: unknown or git)', () => {
  it('selects an unknown-trace test on an unrelated change', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/flaky.test.ts': rec({ unknown: true, why: 'timeout' }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/flaky.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/flaky.test.ts', rule: 2, path: 'server/test/flaky.test.ts' }] });
  });

  it('selects a test that reads .git on an unrelated change', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/topology-clean.test.ts': rec({ git: true }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/topology-clean.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/topology-clean.test.ts', rule: 2, path: 'server/test/topology-clean.test.ts' }] });
  });
});

describe('selectTests rule 3 (READ)', () => {
  it('fires on a direct M match', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/dep.ts', symlink: false }],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/known.test.ts', rule: 3, path: 'server/src/dep.ts' }] });
  });

  it('fires via the gone-ancestor rule: a whole directory deleted, a test only read (stat\'ed) the directory (Review Focus a, mocked)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/stats-dir.test.ts': rec({ read: ['server/src/gonedir'] }) },
    };
    // server/src/gonedir/inner/file.ts deleted; at HEAD neither
    // server/src/gonedir/inner nor server/src/gonedir exist any more, but
    // server/src still does.
    const existsAt = (ref: string, p: string) => {
      if (ref !== 'HEAD') return true;
      if (p === 'server/src/gonedir/inner' || p === 'server/src/gonedir') return false;
      return true;
    };
    const sel = selectTests({
      map, changes: [{ status: 'D', path: 'server/src/gonedir/inner/file.ts', symlink: false }],
      liveTests: ['server/test/stats-dir.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/stats-dir.test.ts', rule: 3, path: 'server/src/gonedir/inner/file.ts' }] });
  });
});

describe('selectTests rule 4 (PROBED, added paths only)', () => {
  it('fires on an added path the test probed and found absent', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/maybe.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/maybe.ts', symlink: false }],
      liveTests: ['server/test/probes.test.ts'], existsAt: () => true, // parent pre-existed -> Pa = [path]
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/probes.test.ts', rule: 4, path: 'server/src/maybe.ts' }] });
  });

  it('does NOT fire for a deleted path in probed (spec: probed selects on ADD only)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/maybe.ts'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'D', path: 'server/src/maybe.ts', symlink: false }],
      liveTests: ['server/test/probes.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [] });
  });
});

describe('selectTests rule 5 (LISTED, added/deleted only)', () => {
  it('fires when a file lands directly inside a listed directory', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/listed-dir/direct.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt: () => true, // dir already existed -> Pa = [path], E = the dir
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lister.test.ts', rule: 5, path: 'server/src/listed-dir/direct.ts' }] });
  });

  it('fires when a brand-new subdirectory appears under a listed dir (Review Focus c, mocked)', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const existsAt = (ref: string, p: string) => {
      if (ref !== SHA_A) return true;
      if (p === 'server/src/listed-dir/newsub') return false; // new subdirectory
      return true; // server/src/listed-dir itself already existed
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/src/listed-dir/newsub/x.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lister.test.ts', rule: 5, path: 'server/src/listed-dir/newsub/x.ts' }] });
  });

  it('does NOT fire for a modified path', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/lister.test.ts': rec({ listed: ['server/src/listed-dir'] }) },
    };
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'server/src/listed-dir/direct.ts', symlink: false }],
      liveTests: ['server/test/lister.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [] });
  });

  it('handles a root-level entry directory (E = "." ) without crashing', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/root-lister.test.ts': rec({ listed: ['.'] }) },
    };
    const existsAt = (ref: string, p: string) => {
      if (ref !== SHA_A) return true;
      if (p === 'newroot') return false; // brand-new top-level directory
      return true;
    };
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'newroot/file.ts', symlink: false }],
      liveTests: ['server/test/root-lister.test.ts'], existsAt,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/root-lister.test.ts', rule: 5, path: 'newroot/file.ts' }] });
  });
});

describe('selectTests rule 6 (SUBTREE: a directory the test linked whole)', () => {
  // A test that symlinks a repo directory into a fixture home and then only stats or probes a file through the
  // link records the directory itself (trace-to-deps.mjs): no resolved path names the file. So ANY change at or
  // under that directory selects it — added, modified or deleted.
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: {
      'server/test/linker.test.ts': rec({ subtree: ['deploy'] }),
      'server/test/root-linker.test.ts': rec({ subtree: ['.'] }),
      'server/test/other.test.ts': rec({ read: ['server/src/other.ts'] }),
    },
  };
  const live = ['server/test/linker.test.ts', 'server/test/other.test.ts'];

  it('an added, a modified and a deleted path under the directory each select it, naming the path', () => {
    for (const status of ['A', 'M', 'D'] as const) {
      const sel = selectTests({ map, changes: [{ status, path: 'deploy/nested/x.mjs', symlink: false }], liveTests: live, existsAt: () => true });
      expect(sel, status).toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy/nested/x.mjs' }] });
    }
  });

  it('the directory path itself counts; a sibling that only shares its prefix does not', () => {
    expect(selectTests({ map, changes: [{ status: 'M', path: 'deploy', symlink: false }], liveTests: live, existsAt: () => true }))
      .toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy' }] });
    expect(selectTests({ map, changes: [{ status: 'M', path: 'deploy2/x.mjs', symlink: false }], liveTests: live, existsAt: () => true }))
      .toEqual({ mode: 'selected', tests: [] });
  });

  it('the rules are named for the reason table, 1 to 6', () => {
    expect(RULE_NAMES).toEqual({ 1: 'NEW', 2: 'ALWAYS', 3: 'READ', 4: 'PROBED', 5: 'LISTED', 6: 'SUBTREE' });
  });

  it('a link to the repository root (".") takes every change', () => {
    const sel = selectTests({ map, changes: [{ status: 'M', path: 'pwa/src/x.ts', symlink: false }], liveTests: ['server/test/root-linker.test.ts'], existsAt: () => true });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/root-linker.test.ts', rule: 6, path: 'pwa/src/x.ts' }] });
  });
});

describe('selectTests: fullTrigger takes precedence over everything', () => {
  it('a package.json change forces full even when another change would have selected a specific test via READ', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/known.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const sel = selectTests({
      map,
      changes: [
        { status: 'M', path: 'server/package.json', symlink: false },
        { status: 'M', path: 'server/src/dep.ts', symlink: false },
      ],
      liveTests: ['server/test/known.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'full', reason: expect.stringMatching(/package manifest/) });
  });
});

describe('selectTests: unchanged tree (Review Focus e)', () => {
  it('selects only ALWAYS (unknown/git) tests when there are no changes', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/flaky.test.ts': rec({ unknown: true }),
        'server/test/git-scan.test.ts': rec({ git: true }),
        'server/test/quiet.test.ts': rec({ read: ['server/src/whatever.ts'] }),
      },
    };
    const sel = selectTests({
      map, changes: [],
      liveTests: ['server/test/flaky.test.ts', 'server/test/git-scan.test.ts', 'server/test/quiet.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [
        { file: 'server/test/flaky.test.ts', rule: 2, path: 'server/test/flaky.test.ts' },
        { file: 'server/test/git-scan.test.ts', rule: 2, path: 'server/test/git-scan.test.ts' },
      ],
    });
  });
});

describe('selectTests: deterministic output order', () => {
  it('sorts the selection by file, independent of rule or input order', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/z-read.test.ts': rec({ read: ['server/src/dep.ts'] }),
        'server/test/a-git.test.ts': rec({ git: true }),
        'server/test/m-new.test.ts': rec(),
      },
    };
    const sel = selectTests({
      map,
      changes: [
        { status: 'A', path: 'server/test/m-new.test.ts', symlink: false },
        { status: 'M', path: 'server/src/dep.ts', symlink: false },
        { status: 'M', path: 'server/src/unrelated.ts', symlink: false },
      ],
      liveTests: ['server/test/z-read.test.ts', 'server/test/a-git.test.ts', 'server/test/m-new.test.ts'],
      existsAt: () => true,
    });
    if (sel.mode !== 'selected') throw new Error(`expected a selection, got full: ${sel.reason}`);
    expect(sel.tests.map((t) => t.file)).toEqual([
      'server/test/a-git.test.ts', 'server/test/m-new.test.ts', 'server/test/z-read.test.ts',
    ]);
  });
});

// ─── end to end with the map module (Tasks 4 + 5) ───────────────────────────

describe('end-to-end with testmap.mjs: what a real map selects', () => {
  const dep = (d: Partial<DepRecord> = {}): DepRecord => ({ ...emptyDep(), ...d });
  const split = (root: Partial<DepRecord> = {}, rest: Partial<DepRecord> = {}) => ({ root: dep(root), rest: dep(rest), unknown: false });
  // The baseline as measured: the include glob's walk of server/test is in
  // the ROOT process, so every test's root side lists it too.
  const baseline = { root: dep({ listed: ['server/test'], read: ['server/vitest.config.ts'] }), rest: dep() };

  it('a test that walks server/test itself is selected by LISTED when a test file is added — no full run', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: {
        'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test'] }),
        'server/test/plain.test.ts': split({ listed: ['server/test'] }, { read: ['server/src/plain.ts'] }),
      },
    });
    const sel = selectTests({
      map, changes: [{ status: 'A', path: 'server/test/new.test.ts', symlink: false }],
      liveTests: ['server/test/new.test.ts', 'server/test/plain.test.ts', 'server/test/single-definition.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [
        { file: 'server/test/new.test.ts', rule: 1, path: 'server/test/new.test.ts' },
        { file: 'server/test/single-definition.test.ts', rule: 5, path: 'server/test/new.test.ts' },
      ],
    });
  });

  it('a directory a test linked whole (records split by side) reaches the map, and a change under it selects the test (rule 6)', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: { 'server/test/linker.test.ts': split({}, { subtree: ['deploy'] }) },
    });
    expect(map.tests['server/test/linker.test.ts'].subtree).toEqual(['deploy']);
    const sel = selectTests({
      map, changes: [{ status: 'M', path: 'deploy/present.mjs', symlink: false }],
      liveTests: ['server/test/linker.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/linker.test.ts', rule: 6, path: 'deploy/present.mjs' }] });
  });

  it('a refresh whose trace for a changed test never arrived leaves it ALWAYS selected (rule 2)', () => {
    const old = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: { 'server/test/dep.test.ts': split({}, { read: ['server/src/dep.ts'] }) },
    });
    // The merge changed server/src/dep.ts, select meant to re-trace dep.test.ts,
    // and its shard left no record.
    const fresh = refreshMap(old, 'b'.repeat(40), { format: RECORDS_FORMAT, baseline, tests: {} },
      ['server/test/dep.test.ts'], ['server/test/dep.test.ts']);
    const sel = selectTests({
      map: fresh, changes: [{ status: 'M', path: 'server/src/unrelated.ts', symlink: false }],
      liveTests: ['server/test/dep.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/dep.test.ts', rule: 2, path: 'server/test/dep.test.ts' }] });
  });

  it('a rebuild whose trace for a test never arrived leaves it out of the map, and rule 1 selects it', () => {
    const map = buildMap(SHA_A, { format: RECORDS_FORMAT, baseline, tests: { 'server/test/traced.test.ts': split() } });
    const sel = selectTests({
      map, changes: [], liveTests: ['server/test/traced.test.ts', 'server/test/lost.test.ts'], existsAt: () => true,
    });
    expect(sel).toEqual({ mode: 'selected', tests: [{ file: 'server/test/lost.test.ts', rule: 1, path: 'server/test/lost.test.ts' }] });
  });

  it('a renamed test file (D old + A new): the new name is selected by rule 1, the old map entry is ignored', () => {
    const map = buildMap(SHA_A, {
      format: RECORDS_FORMAT, baseline,
      tests: {
        'server/test/old-name.test.ts': split({}, { read: ['server/src/x.ts'] }),
        'server/test/other.test.ts': split({}, { read: ['server/src/y.ts'] }),
      },
    });
    const sel = selectTests({
      map,
      changes: [
        { status: 'D', path: 'server/test/old-name.test.ts', symlink: false },
        { status: 'A', path: 'server/test/new-name.test.ts', symlink: false },
      ],
      // live tests come from HEAD, where the old name no longer exists
      liveTests: ['server/test/new-name.test.ts', 'server/test/other.test.ts'],
      existsAt: () => true,
    });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [{ file: 'server/test/new-name.test.ts', rule: 1, path: 'server/test/new-name.test.ts' }],
    });
  });
});

// ─── git-backed integration: readChanges / liveTestFiles / gitExistsAt ────

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
}
function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: gitEnv(), encoding: 'utf8' });
}
function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
}
function commitAll(dir: string, msg: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}
function writeIn(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('readChanges (git-backed)', () => {
  it('reports A, M, D with --no-renames (a rename is D+A)', () => {
    const dir = mkTmp('ccrc-ci-select-changes-');
    initRepo(dir);
    writeIn(dir, 'server/src/keep.ts', 'export const keep = 1;\n');
    writeIn(dir, 'server/src/mod.ts', 'export const v = 1;\n');
    writeIn(dir, 'server/src/gone.ts', 'export const g = 1;\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/src/mod.ts', 'export const v = 2;\n');
    writeIn(dir, 'server/src/added.ts', 'export const a = 1;\n');
    execFileSync('git', ['rm', '-q', 'server/src/gone.ts'], { cwd: dir, env: gitEnv() });
    const head = commitAll(dir, 'change');
    const changes = readChanges(dir, base, head);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(byPath['server/src/mod.ts'].status).toBe('M');
    expect(byPath['server/src/added.ts'].status).toBe('A');
    expect(byPath['server/src/gone.ts'].status).toBe('D');
    expect(changes.every((c) => c.symlink === false)).toBe(true);
  });

  it('parses a path containing a space, via -z (Review Focus d)', () => {
    const dir = mkTmp('ccrc-ci-select-space-');
    initRepo(dir);
    writeIn(dir, 'server/src/seed.ts', 'export const seed = 1;\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/src/has space.ts', 'export const s = 1;\n');
    const head = commitAll(dir, 'add spaced file');
    const changes = readChanges(dir, base, head);
    expect(changes).toEqual([{ status: 'A', path: 'server/src/has space.ts', symlink: false }]);
  });

  it('marks a symlink on the OLD side too: a deleted symlink, and a symlink turned into a file', () => {
    const dir = mkTmp('ccrc-ci-select-oldlink-');
    initRepo(dir);
    writeIn(dir, 'server/src/target.ts', 'export const t = 1;\n');
    symlinkSync('target.ts', path.join(dir, 'server/src/gone-link.ts'));
    symlinkSync('target.ts', path.join(dir, 'server/src/was-link.ts'));
    const base = commitAll(dir, 'two symlinks');
    execFileSync('git', ['rm', '-q', 'server/src/gone-link.ts'], { cwd: dir, env: gitEnv() });
    rmSync(path.join(dir, 'server/src/was-link.ts'));
    writeIn(dir, 'server/src/was-link.ts', 'export const now = 1;\n');
    const head = commitAll(dir, 'delete one, retype the other');
    const byPath = Object.fromEntries(readChanges(dir, base, head).map((c) => [c.path, c]));
    expect(byPath['server/src/gone-link.ts']).toEqual({ status: 'D', path: 'server/src/gone-link.ts', symlink: true });
    expect(byPath['server/src/was-link.ts']).toEqual({ status: 'M', path: 'server/src/was-link.ts', symlink: true });
  });

  it('marks a symlinked path', () => {
    const dir = mkTmp('ccrc-ci-select-symlink-');
    initRepo(dir);
    writeIn(dir, 'server/src/target.ts', 'export const t = 1;\n');
    const base = commitAll(dir, 'base');
    symlinkSync('target.ts', path.join(dir, 'server/src/link.ts'));
    const head = commitAll(dir, 'add symlink');
    const changes = readChanges(dir, base, head);
    const link = changes.find((c) => c.path === 'server/src/link.ts');
    expect(link).toEqual({ status: 'A', path: 'server/src/link.ts', symlink: true });
  });
});

describe('liveTestFiles (git-backed)', () => {
  it('finds test files recursively, including a brand-new subdirectory (Review Focus b), excludes non-test files', () => {
    const dir = mkTmp('ccrc-ci-select-live-');
    initRepo(dir);
    writeIn(dir, 'server/test/a.test.ts', '// a\n');
    writeIn(dir, 'server/test/tmpHelpers.ts', '// not a test\n');
    writeIn(dir, 'server/test/sub/x.test.ts', '// nested\n');
    writeIn(dir, 'server/src/not-a-test.test.ts.txt', '// outside server/test\n');
    commitAll(dir, 'seed');
    const live = liveTestFiles(dir);
    expect(live).toEqual(['server/test/a.test.ts', 'server/test/sub/x.test.ts']);
  });
});

describe('gitExistsAt (git-backed)', () => {
  it('answers true for a file and a directory that exist at a ref, false once removed', () => {
    const dir = mkTmp('ccrc-ci-select-exists-');
    initRepo(dir);
    writeIn(dir, 'server/src/sub/inner.ts', '// x\n');
    const base = commitAll(dir, 'base');
    const existsAt = gitExistsAt(dir);
    expect(existsAt(base, 'server/src/sub/inner.ts')).toBe(true);
    expect(existsAt(base, 'server/src/sub')).toBe(true);
    expect(existsAt(base, 'server/src/nope')).toBe(false);

    execFileSync('git', ['rm', '-rq', 'server/src/sub'], { cwd: dir, env: gitEnv() });
    const head = commitAll(dir, 'remove sub');
    expect(existsAt(head, 'server/src/sub')).toBe(false);
  });
});

// ─── Review Focus (b): a new test file in a brand-new subdirectory, end to end ──

describe('end-to-end: new test file in a brand-new subdirectory (Review Focus b)', () => {
  it('liveTestFiles finds it and selectTests rule 1 selects it', () => {
    const dir = mkTmp('ccrc-ci-select-e2e-newdir-');
    initRepo(dir);
    writeIn(dir, 'server/test/existing.test.ts', '// existing\n');
    const base = commitAll(dir, 'base');
    writeIn(dir, 'server/test/sub/x.test.ts', '// new, nested\n');
    const head = commitAll(dir, 'add nested test');

    const changes = readChanges(dir, base, head);
    const live = liveTestFiles(dir, head);
    expect(live).toEqual(['server/test/existing.test.ts', 'server/test/sub/x.test.ts']);

    const map: TestMap = {
      format: 1, sha: base, baseline: emptyDep(),
      tests: { 'server/test/existing.test.ts': rec() },
    };
    const sel = selectTests({ map, changes, liveTests: live, existsAt: gitExistsAt(dir) });
    expect(sel).toEqual({
      mode: 'selected',
      tests: [{ file: 'server/test/sub/x.test.ts', rule: 1, path: 'server/test/sub/x.test.ts' }],
    });
  });
});

/*
 * Mutation table (measured — see PLAN.md Task 5 Step 5 for the transcript;
 * every row below was actually deleted/mutated, run, observed red, and
 * reverted). "N reds" lists every case a mutation touched, not just the
 * first, when a mutation legitimately shares behaviour with another case.
 *
 * mutation                                                           -> reds observed
 * ----------------------------------------------------------------------------------
 * fullTrigger: drop PACKAGE_FILE_RE check                              -> 'package.json anywhere', 'package-lock.json anywhere', 'a package.json change forces full even when...' (3 — package.json/-lock share the regex, and the precedence test also uses a package.json change)
 * fullTrigger: drop VITEST_CONFIG_RE check                             -> 'vitest config, including the exact-list config' (1)
 * fullTrigger: drop TSCONFIG_RE check                                  -> 'tsconfig*.json' (1)
 * fullTrigger: drop the .github/ prefix check                          -> 'anything under .github/' (1)
 * fullTrigger: drop the c.symlink check                                -> 'a symlinked path' (1)
 * fullTrigger: drop the baseline.read membership check                 -> 'a path in baseline.read' (1)
 * fullTrigger: drop the baseline.probed membership check               -> 'a path in baseline.probed' (1)
 * fullTrigger: RESTORE a baseline.listed/parentOf trigger              -> 'a file added directly in a baseline.listed dir is NOT a trigger...', 'a test that walks server/test itself is selected by LISTED...' (2)
 * selectTests: drop rule 1's "absent from map" clause                  -> 'selects a test file absent from the map even with NO changes at all...' (1; this case has no accompanying change, isolating the clause from the own-change one below)
 * selectTests: drop rule 1's "own change A/M" clause                   -> 'selects a test file that is itself modified...', 'sorts the selection by file...' (2)
 * selectTests: drop rule 2's unknown check                             -> 'selects an unknown-trace test...', 'selects only ALWAYS (unknown/git) tests...' (2)
 * selectTests: drop rule 2's git check                                 -> 'selects a test that reads .git...', 'selects only ALWAYS...', 'sorts the selection by file...' (3)
 * selectTests: drop rule 3's M-direct branch                           -> 'fires on a direct M match', 'sorts the selection by file...' (2)
 * selectTests: drop rule 3's A/D ancestor (Pa) branch                  -> 'fires via the gone-ancestor rule...' (1)
 * selectTests: drop rule 4's `status !== 'A'` guard                    -> 'does NOT fire for a deleted path in probed...' (1)
 * selectTests: drop rule 4 entirely                                    -> 'fires on an added path the test probed...' (1)
 * selectTests: drop rule 5 entirely (Pa/E-driven; no separate M guard   -> 'fires when a file lands directly inside a listed directory',
 *   needed — `affectedSet` gives every M change `E: null`, so rule 5's      'fires when a brand-new subdirectory appears under a listed dir...',
 *   loop already excludes M changes without an extra status check)         'handles a root-level entry directory...' (3)
 * selectTests: drop the `fullTrigger` call at the top                  -> 'a package.json change forces full even when...' (1)
 * selectTests: drop the final `.sort()` on liveTests                   -> 'sorts the selection by file, independent of rule or input order' (1)
 * affectedSet: drop the ancestor-walk loop (Pa = [p], E = parentOf(p)  -> 'fires via the gone-ancestor rule...', 'fires when a brand-new subdirectory
 *   always)                                                               appears under a listed dir...', 'handles a root-level entry directory...' (3)
 */
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-select-tests.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/select-tests.mjs' imported from …/server/test/ci-select-tests.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/select-tests.mjs`:

<!-- file: .github/ci/select-tests.mjs -->
```js
// The selector (spec §6, Task 5): decides which server test files a change
// must run, from the measured `TestMap` (Task 4) and the changed-path set
// between the map's commit and the tree under test. This module answers ONE
// question — "given this map and this diff, what runs, and why" — and never
// decides the mode itself (that lives in `select.mjs`, Task 9, which is what
// falls back to `full` when the map is missing/unreadable, spec §6.3's first
// bullet).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {import('./testmap.mjs').DepRecord} DepRecord */
/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {{ status: 'A'|'M'|'D', path: string, symlink: boolean }} Change */
/** @typedef {{ mode: 'selected', tests: Array<{ file: string, rule: 1|2|3|4|5|6, path: string }> } | { mode: 'full', reason: string }} Selection */

/** Each rule's name, as the reason table prints it (spec §6.2's numbering). */
export const RULE_NAMES = { 1: 'NEW', 2: 'ALWAYS', 3: 'READ', 4: 'PROBED', 5: 'LISTED', 6: 'SUBTREE' };

/** Whether repo-relative `p` is the directory `dir` or sits anywhere under it (`'.'` holds everything).
 *  @param {string} p @param {string} dir */
function atOrUnder(p, dir) {
  return dir === '.' || p === dir || p.startsWith(`${dir}/`);
}

/** Every path this module produces is a repo-relative POSIX string
 *  (CONTRACT.md's path convention), regardless of the host OS. */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** `git diff --raw -z --no-renames <fromSha> <toRef>`, parsed into `Change[]`.
 *  `-z` NUL-delimits both the record separator and the path, which is the
 *  only safe way to read a path containing a space or a newline — the
 *  human-readable form quotes such paths and this parser would otherwise have
 *  to un-quote it. `--no-renames` is load-bearing: CONTRACT.md defines a
 *  rename as arriving as one `D` and one `A`, which is what the affected-set
 *  logic in `selectTests` is built around; with rename detection on, git
 *  would instead emit a single `R###` record this parser does not expect.
 *  @param {string} repoDir @param {string} fromSha @param {string} [toRef]
 *  @returns {Change[]} */
export function readChanges(repoDir, fromSha, toRef = 'HEAD') {
  const raw = execFileSync('git', ['diff', '--raw', '-z', '--no-renames', fromSha, toRef], {
    cwd: repoDir, maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  // Each record is `:<oldmode> <newmode> <oldsha> <newsha> <status>` then a
  // NUL, then the path, then a NUL. Splitting the whole buffer on NUL and
  // walking pairs is simpler and just as exact, since neither field can
  // itself contain a NUL.
  const parts = raw.split('\0');
  /** @type {Change[]} */
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const header = parts[i];
    const p = parts[i + 1];
    if (!header || !p) continue;
    const fields = header.trim().split(/\s+/);
    if (fields.length < 5) continue;
    // The header starts with git's ':' — `:120000 000000 …` — which is stripped before the old mode is read, or an
    // old-side symlink (a deleted one, or one turned into a file) would never be flagged.
    const [oldModeRaw, newMode, , , statusRaw] = fields;
    const oldMode = oldModeRaw.replace(/^:/, '');
    const letter = statusRaw[0];
    /** @type {'A'|'M'|'D'} */
    const status = letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M';
    const symlink = oldMode === '120000' || newMode === '120000';
    changes.push({ status, path: toPosix(p), symlink });
  }
  return changes;
}

/** Every `*.test.ts` file tracked under `server/test` at `ref`, repo-relative
 *  POSIX paths, recursive (matches vitest's own `test/**\/*.test.ts` include).
 *  @param {string} repoDir @param {string} [ref] @returns {string[]} */
export function liveTestFiles(repoDir, ref = 'HEAD') {
  const raw = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'server/test'], {
    cwd: repoDir, maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  return raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.endsWith('.test.ts'))
    .map(toPosix)
    .sort();
}

/** Curried `git cat-file -e <ref>:<path>` — true iff SOMETHING (blob or tree)
 *  exists at that path at that ref. Used on directory paths too: a directory
 *  is a tree object, and `cat-file -e` answers it exactly like a file, which
 *  is what lets the affected-set walk (below) ask "did this ancestor
 *  directory exist before/after" with the same primitive it uses for files.
 *  @param {string} repoDir @returns {(ref: string, p: string) => boolean} */
export function gitExistsAt(repoDir) {
  return (ref, p) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}:${p}`], { cwd: repoDir, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
}

const PACKAGE_FILE_RE = /^(package\.json|package-lock\.json)$/;
const VITEST_CONFIG_RE = /^vitest\..*config\.[cm]?[jt]s$/;
const TSCONFIG_RE = /^tsconfig.*\.json$/;
// Consumed by the setup steps before any traced process: git applies `.gitattributes` at checkout (an `eol`
// attribute rewrites a script's line endings), `npm ci` reads `.npmrc`, and the packages' install lifecycle
// runs server/scripts/.
const GITATTRIBUTES_RE = /^\.gitattributes$/;
const NPMRC_RE = /^\.npmrc$/;

/** Parent directory of a repo-relative POSIX path, `'.'` at the root — the
 *  same "root is `.`" convention CONTRACT.md states for every path in this
 *  module. */
function parentOf(p) {
  const dir = path.posix.dirname(p);
  return dir === '' ? '.' : dir;
}

/** The full-run trigger (spec §6.3's changed-set bullet): a reason string
 *  when ANY changed path is infrastructure the map cannot safely reason
 *  about, else `null`. Checked before any per-test rule — a match here means
 *  the whole selection question is moot.
 *
 *  What the baseline READ or PROBED is a trigger: that is vitest's own
 *  startup, which every test shares. What it LISTED is not. The baseline
 *  lists `server/test/` because the include glob walks it (with a literal
 *  include too, measured), so as a trigger it would make every PR that adds
 *  or deletes a test file run the full suite — 29 of the last 60 merged PRs.
 *  Dropping it loses nothing: records are split by process (`testmap.mjs`),
 *  so a test that walks `server/test/` in its OWN right keeps that listing
 *  and is selected by rule 5, and the added test itself by rule 1. A
 *  directory the baseline linked whole (`subtree`) IS a trigger, for the same
 *  reason its reads are: it is subtracted from every test.
 *  @param {Change[]} changes @param {DepRecord} baseline @returns {string | null} */
export function fullTrigger(changes, baseline) {
  const readSet = new Set(baseline.read);
  const probedSet = new Set(baseline.probed);
  for (const c of [...changes].sort((a, b) => a.path.localeCompare(b.path))) {
    const base = path.posix.basename(c.path);
    if (PACKAGE_FILE_RE.test(base)) return `package manifest changed: ${c.path}`;
    if (VITEST_CONFIG_RE.test(base)) return `vitest config changed: ${c.path}`;
    if (TSCONFIG_RE.test(base)) return `tsconfig changed: ${c.path}`;
    if (GITATTRIBUTES_RE.test(base)) return `checkout attributes changed: ${c.path}`;
    if (NPMRC_RE.test(base)) return `npm config changed: ${c.path}`;
    if (c.path.startsWith('server/scripts/')) return `install script changed: ${c.path}`;
    if (c.path === '.github' || c.path.startsWith('.github/')) return `pipeline path changed: ${c.path}`;
    if (c.symlink) return `symlink changed: ${c.path}`;
    if (readSet.has(c.path)) return `baseline reads this path: ${c.path}`;
    if (probedSet.has(c.path)) return `baseline probed this path: ${c.path}`;
    if (baseline.subtree.some((dir) => atOrUnder(c.path, dir))) return `baseline links this directory: ${c.path}`;
  }
  return null;
}

/** Ancestor directories of `p`, immediate parent first, ending at `'.'`
 *  (exclusive of `p` itself, inclusive of `'.'`). */
function ancestors(p) {
  const out = [];
  let cur = parentOf(p);
  while (true) {
    out.push(cur);
    if (cur === '.') break;
    cur = parentOf(cur);
  }
  return out;
}

/** The affected set `Pa` and entry directory `E` for one A/D change (spec
 *  §6.2's rule text, restated in CONTRACT.md Task 5): starting at `p`'s
 *  immediate parent, walk ancestors while each one is ABSENT at the other
 *  side of the change (before the add, or after the delete) — those
 *  ancestors are themselves newly-created-or-removed, so they belong in `Pa`
 *  alongside `p`. `E`, the entry directory, is the parent of the highest
 *  (most-ancestral) member of `Pa` — the directory that existed on both
 *  sides and whose LISTING changed.
 *  @param {Change} change @param {(ref: string, p: string) => boolean} existsAt
 *  @param {string} mapSha @returns {{ Pa: string[], E: string }} */
function affectedSet(change, existsAt, mapSha) {
  const otherRef = change.status === 'A' ? mapSha : 'HEAD';
  const chain = [change.path];
  for (const anc of ancestors(change.path)) {
    if (existsAt(otherRef, anc)) break;
    chain.push(anc);
    if (anc === '.') break;
  }
  const topMost = chain[chain.length - 1];
  const E = topMost === '.' ? '.' : parentOf(topMost);
  return { Pa: chain, E };
}

/**
 * @param {{ map: TestMap, changes: Change[], liveTests: string[], existsAt: (ref: string, p: string) => boolean }} args
 * @returns {Selection}
 */
export function selectTests({ map, changes, liveTests, existsAt }) {
  const full = fullTrigger(changes, map.baseline);
  if (full) return { mode: 'full', reason: full };

  // Precompute once per change, not once per test x change.
  const changed = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const changedByPath = new Map(changed.map((c) => [c.path, c]));
  const analyses = changed.map((c) => {
    if (c.status === 'M') return { change: c, Pa: [c.path], E: null };
    const { Pa, E } = affectedSet(c, existsAt, map.sha);
    return { change: c, Pa, E };
  });

  /** @type {Array<{ file: string, rule: 1|2|3|4|5|6, path: string }>} */
  const selected = [];

  for (const file of [...liveTests].sort()) {
    const changedHere = changedByPath.get(file);
    const inMap = Object.prototype.hasOwnProperty.call(map.tests, file);

    // Rule 1 — NEW: the test file itself is new/modified, or the map has no
    // entry for it at all (never traced, so nothing else here is safe to trust).
    if (!inMap || (changedHere && (changedHere.status === 'A' || changedHere.status === 'M'))) {
      selected.push({ file, rule: 1, path: file });
      continue;
    }

    const rec = map.tests[file];

    // Rule 2 — ALWAYS: an unknown trace, or a test that reads `.git` (spec
    // §5.2: it reads the whole tracked tree or its history, so every change
    // is potentially relevant to it).
    if (rec.unknown || rec.git) {
      selected.push({ file, rule: 2, path: file });
      continue;
    }

    const readSet = new Set(rec.read);
    const probedSet = new Set(rec.probed);
    const listedSet = new Set(rec.listed);

    // Rule 3 — READ: a modified/deleted/renamed path (or, for A/D, any
    // ancestor in its affected set) sits in this test's `read`.
    let hit = null;
    for (const a of analyses) {
      if (a.change.status === 'M') {
        if (readSet.has(a.change.path)) { hit = a; break; }
      } else if (a.Pa.some((x) => readSet.has(x))) {
        hit = a; break;
      }
    }
    if (hit) {
      selected.push({ file, rule: 3, path: hit.change.path });
      continue;
    }

    // Rule 4 — PROBED: an added path (or an ancestor newly created with it)
    // sits in this test's `probed` (a path it checked for and found absent).
    hit = null;
    for (const a of analyses) {
      if (a.change.status !== 'A') continue;
      if (a.Pa.some((x) => probedSet.has(x))) { hit = a; break; }
    }
    if (hit) {
      selected.push({ file, rule: 4, path: hit.change.path });
      continue;
    }

    // Rule 5 — LISTED: an added/deleted path's entry directory sits in this
    // test's `listed` (it enumerated that directory). `a.E` is `null` for
    // every `M` change (an unchanged path can't have a new/gone entry
    // directory), which already excludes them here without a separate status
    // check.
    hit = null;
    for (const a of analyses) {
      if (a.E !== null && listedSet.has(a.E)) { hit = a; break; }
    }
    if (hit) {
      selected.push({ file, rule: 5, path: hit.change.path });
      continue;
    }

    // Rule 6 — SUBTREE: any changed path (added, modified or deleted) at or
    // under a directory this test linked whole into a fixture home: what it
    // stat'ed or probed through the link left no path of its own to match.
    const through = changed.find((c) => rec.subtree.some((dir) => atOrUnder(c.path, dir)));
    if (through) {
      selected.push({ file, rule: 6, path: through.path });
    }
  }

  return { mode: 'selected', tests: selected };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) opt[args[i].slice(2)] = args[i + 1];
  }
  const repoDir = opt.repo ?? process.cwd();
  const { readMap } = await import('./testmap.mjs');
  const mapResult = readMap(opt.map);
  if (!mapResult.ok) {
    console.log(JSON.stringify({ mode: 'full', reason: `map unreadable: ${mapResult.reason}` }));
    return;
  }
  const changes = readChanges(repoDir, mapResult.map.sha, opt.to ?? 'HEAD');
  const liveTests = liveTestFiles(repoDir, opt.to ?? 'HEAD');
  const selection = selectTests({
    map: mapResult.map, changes, liveTests, existsAt: gitExistsAt(repoDir),
  });
  console.log(JSON.stringify(selection));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-select-tests.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  46 passed (46)`.

- [ ] **Step 5: Measure the mutation table.** Same discipline as Task 4 Step 5 (apply, run, confirm the named
  reds, restore, confirm green). All re-measured in the integration clone (46 cases each):

  | mutation | reds observed |
  |---|---|
  | `fullTrigger`: drop `PACKAGE_FILE_RE` check | `package.json anywhere`, `package-lock.json anywhere`, `a package.json change forces full even when...` (3) |
  | `fullTrigger`: drop `VITEST_CONFIG_RE` check | `vitest config, including the exact-list config` (1) |
  | `fullTrigger`: drop `TSCONFIG_RE` check | `tsconfig*.json` (1) |
  | `fullTrigger`: drop the `.github/` prefix check | `anything under .github/` (1) |
  | `fullTrigger`: drop the `c.symlink` check | `a symlinked path` (1) |
  | `fullTrigger`: drop the `baseline.read` membership check | `a path in baseline.read` (1) |
  | `fullTrigger`: drop the `baseline.probed` membership check | `a path in baseline.probed` (1) |
  | `fullTrigger`: RESTORE a "directly in a `baseline.listed` dir" trigger | `a file added directly in a baseline.listed dir is NOT a trigger...`, `a test that walks server/test itself is selected by LISTED...`, `a renamed test file (D old + A new)...` (3) |
  | `selectTests`: drop rule 1's "absent from map" clause | `selects a test file absent from the map even with NO changes at all...`, `a rebuild whose trace for a test never arrived leaves it out of the map, and rule 1 selects it` (2) |
  | `selectTests`: drop rule 1's "own change A/M" clause | `selects a test file that is itself modified...`, `sorts the selection by file...` (2) |
  | `selectTests`: drop rule 2's `unknown` check | `selects an unknown-trace test...`, `selects only ALWAYS (unknown/git) tests...`, `a refresh whose trace for a changed test never arrived leaves it ALWAYS selected (rule 2)` (3) |
  | `selectTests`: drop rule 2's `git` check | `selects a test that reads .git...`, `selects only ALWAYS...`, `sorts the selection by file...` (3) |
  | `selectTests`: drop rule 3's M-direct branch | `fires on a direct M match`, `sorts the selection by file...` (2) |
  | `selectTests`: drop rule 3's A/D ancestor (`Pa`) branch | `fires via the gone-ancestor rule...` (1) |
  | `selectTests`: drop rule 4's `status !== 'A'` guard | `does NOT fire for a deleted path in probed...` (1) |
  | `selectTests`: drop rule 4 entirely | `fires on an added path the test probed...` (1) |
  | `selectTests`: drop rule 5 entirely | `fires when a file lands directly inside a listed directory`, `fires when a brand-new subdirectory appears under a listed dir...`, `handles a root-level entry directory...`, `a test that walks server/test itself is selected by LISTED...` (4) |
  | `selectTests`: drop the `fullTrigger` call at the top | `a package.json change forces full even when...` (1) |
  | `selectTests`: drop the final `.sort()` on `liveTests` | `sorts the selection by file, independent of rule or input order` (1) |
  | `affectedSet`: drop the ancestor-walk (`Pa = [p]`, `E = parentOf(p)` always) | `fires via the gone-ancestor rule...`, `fires when a brand-new subdirectory appears under a listed dir...`, `handles a root-level entry directory...` (3) |
  | `fullTrigger`: `.gitattributes` not a trigger | `.gitattributes at any depth (checkout applies it outside any traced process)` (1) |
  | `fullTrigger`: `.gitattributes` matched at the root only (the full path, not the basename) | the same (1) |
  | `fullTrigger`: `.npmrc` not a trigger | `.npmrc at any depth (npm ci reads it before any test runs)` (1) |
  | `fullTrigger`: `server/scripts/` not a trigger | `anything under server/scripts/ (the install lifecycle scripts)` (1) |
  | `readChanges`: keep the `:` on the old mode | `marks a symlink on the OLD side too: a deleted symlink, and a symlink turned into a file` (1) |
  | Rule 6 removed | the three rule-6 cases and `a directory a test linked whole (records split by side) reaches the map, and a change under it selects the test (rule 6)` (4) |
  | "At or under" without the `/` boundary (`deploy2/x` counts as under `deploy`) | `the directory path itself counts; a sibling that only shares its prefix does not`, `a path at or under a baseline.subtree directory…` (2) |
  | "At or under" without `'.'` | `a link to the repository root (".") takes every change` (1) |
  | "At or under" without the directory itself | `the directory path itself counts…` (1) |
  | The baseline's `subtree` not a trigger | `a path at or under a baseline.subtree directory (every test's startup linked it whole)` (1) |
  | `RULE_NAMES` renames rule 6 | `the rules are named for the reason table, 1 to 6` (1) |

  Note: rule 5 needs no separate `status === 'M'` guard — `affectedSet` gives every `M` change `E: null`, which
  already excludes it from rule 5's `a.E !== null` check. And rule 1 is what makes a rename safe: the new name is
  `A` and live, the old name is not live at `HEAD`, so its map entry is never consulted.

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

  Plus `./node_modules/.bin/vitest run test/ci-testmap.test.ts --maxWorkers=2` — `Tests  38 passed (38)`.

- [ ] **Step 7: Commit**

```bash
git add .github/ci/select-tests.mjs server/test/ci-select-tests.test.ts
git commit -F - <<'EOF'
feat(ci): the test selector (spec §6, rules 1-5 and full-run triggers)

.github/ci/select-tests.mjs decides, for a changed set against a
TestMap, which server test files run and why — the five selection rules
of spec §6.2 (NEW, ALWAYS, READ, PROBED, LISTED, with the A/D
affected-set/entry-directory walk), the full-run triggers of §6.3's
changed-set bullet, and the three git-backed primitives (readChanges,
liveTestFiles, gitExistsAt). What the baseline read or probed is a
trigger; what it listed is not (the include glob lists server/test for
every test — a trigger there would run the full suite for half of all
PRs). .gitattributes and .npmrc at any depth and server/scripts/ are
full-run triggers. Rule 6, SUBTREE: any change at or under a directory
a test linked whole selects it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


### Task 6: Shard planner `.github/ci/shards.mjs`

**Files:**
- Create: `.github/ci/shards.mjs`
- Test: `server/test/ci-shards.test.ts`

**Interfaces:**
- Consumes: a vitest JSON-reporter report object (`{ testResults: Array<{ name, startTime, endTime }> }`, vitest's
  own shape — `name` absolute, `startTime`/`endTime` ms-epoch, possibly fractional — measured live, see the test);
  repo-relative test file lists produced by Task 5's `selectTests`/`liveTestFiles`; the `testtimes` artifact JSON
  this module's own `times` CLI produces (Task 11 publishes it from trusted main runs).
- Produces: `durationsFromVitestJson(report, repoRoot) : Record<string, number>`, `PROFILES` (the four
  `ShardProfile` constants), `planShards(files, durations, profile) : ShardPlan`, `toMatrix(plan) : { include: [...] }`,
  and the `times` CLI (`node .github/ci/shards.mjs times --out FILE <report.json>...`, run from the repository
  root) — consumed by Task 9 (`planShards`/`toMatrix` for `server_matrix`/`macos_matrix`/`trace_matrix`) and by
  Task 11's `times-build` job.
- Changed in integration: an EMPTY durations object is "durations present" — LPT at `defaultMs`, never the
  `vitestShard` fallback — and a test pins it, because Task 9 now plans the TRACE matrix with `times ?? {}`
  (trace-run takes an exact list and has no `--shard`). The `times` CLI makes keys relative to its cwd (vitest's
  JSON names are absolute), which is now said in the code and CHECKED: a key outside `server/` means it ran from the
  wrong directory, and it refuses rather than write durations no file will ever match.
- Changed in integration (operator's ruling P4, spec §7.1): a file missing from a non-empty durations table is
  packed at the table's MEDIAN duration (the mean of the two middle values for an even count), not `defaultMs` —
  a new test is more like a typical test than a 5-second one. `defaultMs` remains for an empty table.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-shards.test.ts`:

<!-- file: server/test/ci-shards.test.ts -->
```ts
// Task 6 (contract) — the shard planner, `.github/ci/shards.mjs` (spec §7).
//
// `durationsFromVitestJson` is tested against BOTH a static fixture captured
// verbatim from a real run (`./node_modules/.bin/vitest run test/bus.test.ts
// --reporter=json --outputFile.json=<tmp>`, run by hand while drafting this
// plan — the shape below is that report's `testResults[0]` with only the
// numbers changed) and a report this file generates itself by spawning a
// real vitest subprocess, so the field names (`name`/`startTime`/`endTime`)
// are pinned against the real reporter, not an assumption about it.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  durationsFromVitestJson,
  planShards,
  toMatrix,
  PROFILES,
} from '../../.github/ci/shards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverRoot = path.resolve(here, '..');

describe('durationsFromVitestJson', () => {
  it('converts an absolute testResults name to a repo-relative key and adds 500ms', () => {
    // Captured shape (field names, nesting) from a real
    // `--reporter=json` run against test/bus.test.ts; only startTime/endTime
    // are changed here to a round number for a legible assertion.
    const report = {
      testResults: [
        {
          name: path.join(repoRoot, 'server', 'test', 'bus.test.ts'),
          startTime: 1_000_000,
          endTime: 1_000_042.75,
        },
      ],
    };
    const out = durationsFromVitestJson(report, repoRoot);
    expect(out).toEqual({ 'server/test/bus.test.ts': 542.75 });
  });

  it('handles multiple files, each independently', () => {
    const report = {
      testResults: [
        { name: path.join(repoRoot, 'server', 'test', 'a.test.ts'), startTime: 0, endTime: 100 },
        { name: path.join(repoRoot, 'server', 'test', 'b.test.ts'), startTime: 50, endTime: 60 },
      ],
    };
    const out = durationsFromVitestJson(report, repoRoot);
    expect(out).toEqual({
      'server/test/a.test.ts': 600,
      'server/test/b.test.ts': 510,
    });
  });

  it('against a REAL vitest JSON report (spawned live)', () => {
    const dir = mkTmp('ci-shards-realreport-');
    const outFile = path.join(dir, 'report.json');
    execFileSync(
      process.argv0,
      [
        path.join(serverRoot, 'node_modules', '.bin', 'vitest'),
        'run', 'test/bus.test.ts',
        '--reporter=json', `--outputFile.json=${outFile}`,
      ],
      { cwd: serverRoot },
    );
    const report = JSON.parse(readFileSync(outFile, 'utf8'));
    const out = durationsFromVitestJson(report, repoRoot);
    expect(Object.keys(out)).toEqual(['server/test/bus.test.ts']);
    // The real wall-clock delta is small and >0; +500 for collection makes
    // it >= 500 always, and comfortably under a minute for a one-file run.
    expect(out['server/test/bus.test.ts']).toBeGreaterThanOrEqual(500);
    expect(out['server/test/bus.test.ts']).toBeLessThan(60_000);
  });
});

describe('PROFILES', () => {
  it('matches the contract exactly', () => {
    expect(PROFILES).toEqual({
      linux: { targetMs: 240_000, min: 1, max: 5, workers: 2, defaultMs: 5000 },
      macosSelected: { targetMs: 900_000, min: 1, max: 2, workers: 1, defaultMs: 5000, scale: 1.5 },
      macosFull: { targetMs: 900_000, min: 1, max: 4, workers: 1, defaultMs: 5000, scale: 1.5 },
      trace: { targetMs: 900_000, min: 1, max: 8, workers: 2, defaultMs: 5000, scale: 6 },
    });
  });
});

describe('planShards — durations known (LPT)', () => {
  it('empty file list -> []', () => {
    expect(planShards([], {}, PROFILES.linux)).toEqual([]);
    expect(planShards([], null, PROFILES.linux)).toEqual([]);
  });

  it('a single file far longer than the target gets a shard of its own', () => {
    // total = 1,200,000 + 3*5,000 = 1,215,000ms; workers 2, targetMs 240,000
    // -> raw = ceil(1,215,000/2/240,000) = ceil(2.53) = 3, clamped [1,5] -> 3.
    const files = ['server/test/huge.test.ts', 'server/test/s1.test.ts', 'server/test/s2.test.ts', 'server/test/s3.test.ts'];
    const durations = {
      'server/test/huge.test.ts': 1_200_000,
      'server/test/s1.test.ts': 5_000,
      'server/test/s2.test.ts': 5_000,
      'server/test/s3.test.ts': 5_000,
    };
    const plan = planShards(files, durations, PROFILES.linux);
    expect(plan).toHaveLength(3);
    const withHuge = plan.find((s) => s.files.includes('server/test/huge.test.ts'));
    expect(withHuge!.files).toEqual(['server/test/huge.test.ts']);
    expect(withHuge!.vitestShard).toBeNull();
    // the other two shards split the three 5s files between them (LPT:
    // longest-first onto least-loaded — after the 1.2M-file starts its own
    // shard as the least-loaded target, the three 5000ms files go one to
    // the second shard, two to the third, or similarly balanced).
    const rest = plan.filter((s) => s !== withHuge);
    const restFiles = rest.flatMap((s) => s.files).sort();
    expect(restFiles).toEqual(['server/test/s1.test.ts', 'server/test/s2.test.ts', 'server/test/s3.test.ts']);
    // no file duplicated or dropped
    expect(plan.flatMap((s) => s.files).sort()).toEqual([...files].sort());
  });

  it('never produces more shards than files, even when the budget asks for more', () => {
    // Two files, each far bigger than target -> raw count would clamp to 5
    // (max), but there are only 2 files to shard.
    const files = ['server/test/a.test.ts', 'server/test/b.test.ts'];
    const durations = { 'server/test/a.test.ts': 5_000_000, 'server/test/b.test.ts': 5_000_000 };
    const plan = planShards(files, durations, PROFILES.linux);
    expect(plan).toHaveLength(2);
    expect(plan.map((s) => s.total)).toEqual([2, 2]);
  });

  it('clamps the shard count to [min, max] regardless of total', () => {
    // 20 tiny files, well under one target-worth of work -> raw = ceil(small
    // number) likely 1, but min forces at least profile.min. Use a profile
    // with min=3 to prove the clamp floor is honoured.
    const files = Array.from({ length: 20 }, (_, i) => `server/test/f${i}.test.ts`);
    const durations = Object.fromEntries(files.map((f) => [f, 100]));
    const profile = { targetMs: 240_000, min: 3, max: 5, workers: 2, defaultMs: 5000 };
    const plan = planShards(files, durations, profile);
    expect(plan).toHaveLength(3);

    // And the ceiling: durations huge enough that raw would exceed max.
    const bigDurations = Object.fromEntries(files.map((f) => [f, 10_000_000]));
    const capped = planShards(files, bigDurations, { ...profile, max: 4 });
    expect(capped).toHaveLength(4);
  });

  it('a file missing from a NON-empty table is given the MEDIAN of the known durations (spec §7.1)', () => {
    // median of 1000, 2000, 9000 is 2000: total 14000 → 2 shards, d packed as 2000 (after b by path).
    // At defaultMs (5000) the total would be 17000 → 3 shards.
    const plan = planShards(['a', 'b', 'c', 'd'], { a: 1000, b: 2000, c: 9000 },
      { targetMs: 7000, min: 1, max: 5, workers: 1, defaultMs: 5000 });
    expect(plan.map((s) => s.files)).toEqual([['c'], ['b', 'd', 'a']]);
    // An even count takes the mean of the middle two: 1000, 3000 → 2000, so three unknown files make the total
    // 10000 → 4 shards (the lower middle would give 7000 → 3, the upper 13000 → 5, defaultMs 31000 → 5).
    const even = planShards(['a', 'b', 'x', 'y', 'z'], { a: 1000, b: 3000 }, { targetMs: 3000, min: 1, max: 5, workers: 1, defaultMs: 9000 });
    expect(even.length).toBe(4);
  });

  it('a file missing from durations is still planned (one shard holds both)', () => {
    const files = ['server/test/known.test.ts', 'server/test/unknown.test.ts'];
    const durations = { 'server/test/known.test.ts': 1000 };
    const profile = { targetMs: 240_000, min: 1, max: 1, workers: 2, defaultMs: 5000 };
    const plan = planShards(files, durations, profile);
    expect(plan).toHaveLength(1);
    expect(plan[0].files.sort()).toEqual(files.sort());
  });

  it('ties in duration are broken by path, deterministically', () => {
    const files = ['server/test/z.test.ts', 'server/test/a.test.ts', 'server/test/m.test.ts'];
    const durations = Object.fromEntries(files.map((f) => [f, 1000]));
    // 3 equal-duration files onto 3 shards, one each; order of assignment
    // by path ascending means a.test.ts -> shard1, m -> shard2, z -> shard3.
    const profile = { targetMs: 1, min: 3, max: 3, workers: 1, defaultMs: 1000 };
    const plan = planShards(files, durations, profile);
    expect(plan.map((s) => s.files[0])).toEqual([
      'server/test/a.test.ts', 'server/test/m.test.ts', 'server/test/z.test.ts',
    ]);
  });
});

describe('planShards — an EMPTY durations object is "durations present"', () => {
  it('packs by LPT at defaultMs, every file exactly once, and never hands out a vitest --shard', () => {
    // select.mjs plans the TRACE matrix with `times ?? {}`: trace-run.mjs takes
    // an exact list and has no --shard, so the trace plan must never be the
    // every-shard-gets-everything fallback, even before any durations exist.
    const files = Array.from({ length: 12 }, (_, i) => `server/test/f${String(i).padStart(2, '0')}.test.ts`);
    const plan = planShards(files, {}, { ...PROFILES.trace, targetMs: 30_000 });
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.every((s) => s.vitestShard === null)).toBe(true);
    expect(plan.flatMap((s) => s.files).sort()).toEqual(files);
  });
});

describe('planShards — durations === null (vitest hash-shard fallback)', () => {
  it('every shard gets ALL files, with a vitestShard "i/n" string', () => {
    const files = ['server/test/a.test.ts', 'server/test/b.test.ts', 'server/test/c.test.ts'];
    // Force count = 3 via a tiny target relative to defaultMs*files*workers.
    const profile = { targetMs: 1, min: 1, max: 5, workers: 1, defaultMs: 100_000 };
    const plan = planShards(files, null, profile);
    expect(plan).toHaveLength(3);
    for (const [i, shard] of plan.entries()) {
      expect(shard.index).toBe(i + 1);
      expect(shard.total).toBe(3);
      expect(shard.files).toEqual(files);
      expect(shard.vitestShard).toBe(`${i + 1}/3`);
    }
  });

  it('with a single computed shard, vitestShard is "1/1"', () => {
    const files = ['server/test/a.test.ts'];
    const plan = planShards(files, null, PROFILES.linux);
    expect(plan).toEqual([
      { index: 1, total: 1, files: ['server/test/a.test.ts'], vitestShard: '1/1' },
    ]);
  });
});

describe('toMatrix', () => {
  it('converts repo-relative paths to server-relative, space-joined', () => {
    const plan = [
      { index: 1, total: 2, files: ['server/test/a.test.ts', 'server/test/b.test.ts'], vitestShard: null },
      { index: 2, total: 2, files: ['server/test/c.test.ts'], vitestShard: '2/2' },
    ];
    expect(toMatrix(plan)).toEqual({
      include: [
        { shard: 1, total: 2, files: 'test/a.test.ts test/b.test.ts', vitest_shard: '' },
        { shard: 2, total: 2, files: 'test/c.test.ts', vitest_shard: '2/2' },
      ],
    });
  });

  it('empty plan -> empty include', () => {
    expect(toMatrix([])).toEqual({ include: [] });
  });
});

describe('the `times` CLI', () => {
  it('merges vitest JSON reports from repo root into one durations file', () => {
    const dir = mkTmp('ci-shards-times-cli-');
    const reportFile = path.join(dir, 'report.json');
    execFileSync(
      process.argv0,
      [
        path.join(serverRoot, 'node_modules', '.bin', 'vitest'),
        'run', 'test/bus.test.ts', 'test/dtbd.test.ts',
        '--reporter=json', `--outputFile.json=${reportFile}`,
      ],
      { cwd: serverRoot },
    );
    const outFile = path.join(dir, 'times.json');
    execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'),
      'times', '--out', outFile, reportFile,
    ], { cwd: repoRoot });
    const merged = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(Object.keys(merged).sort()).toEqual(['server/test/bus.test.ts', 'server/test/dtbd.test.ts']);
    for (const v of Object.values(merged)) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(500);
    }
  });

  it('merges TWO separate report files (as two shards would each produce)', () => {
    const dir = mkTmp('ci-shards-times-cli-multi-');
    const r1 = path.join(dir, 'r1.json');
    const r2 = path.join(dir, 'r2.json');
    execFileSync(process.argv0, [
      path.join(serverRoot, 'node_modules', '.bin', 'vitest'), 'run', 'test/bus.test.ts',
      '--reporter=json', `--outputFile.json=${r1}`,
    ], { cwd: serverRoot });
    execFileSync(process.argv0, [
      path.join(serverRoot, 'node_modules', '.bin', 'vitest'), 'run', 'test/dtbd.test.ts',
      '--reporter=json', `--outputFile.json=${r2}`,
    ], { cwd: serverRoot });
    const outFile = path.join(dir, 'times.json');
    execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, r1, r2,
    ], { cwd: repoRoot });
    const merged = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(Object.keys(merged).sort()).toEqual(['server/test/bus.test.ts', 'server/test/dtbd.test.ts']);
  });

  // vitest's JSON names each file by its ABSOLUTE path; the CLI makes them
  // relative to the directory it runs in, so it must run from the repository
  // root (ci.yml's times-build step sets no working-directory —
  // ci-pipeline.test.ts pins that). Run from anywhere else, it refuses rather
  // than write keys no file will ever match.
  function syntheticReport(root: string): string {
    const file = path.join(mkTmp('ci-shards-times-synth-'), 'report.json');
    writeFileSync(file, JSON.stringify({
      testResults: [{ name: path.join(root, 'server', 'test', 'x.test.ts'), startTime: 0, endTime: 1000 }],
    }));
    return file;
  }

  it('run from the repository root: the keys are repo-relative', () => {
    const root = mkTmp('ci-shards-times-root-');
    const outFile = path.join(root, 'times.json');
    execFileSync(process.argv0, [path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, syntheticReport(root)], { cwd: root });
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({ 'server/test/x.test.ts': 1500 });
  });

  it('run from anywhere else (server/): refuses, and writes nothing', () => {
    const root = mkTmp('ci-shards-times-root-');
    mkdirSync(path.join(root, 'server'));
    const outFile = path.join(root, 'times.json');
    let stderr = '';
    expect(() => {
      try {
        execFileSync(process.argv0, [path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, syntheticReport(root)],
          { cwd: path.join(root, 'server'), stdio: 'pipe' });
      } catch (e) {
        stderr = String((e as { stderr: Buffer }).stderr);
        throw e;
      }
    }).toThrow();
    expect(stderr).toContain('run it from the repository root');
    expect(() => readFileSync(outFile)).toThrow();
  });

  it('with no report files, exits non-zero and writes nothing', () => {
    const dir = mkTmp('ci-shards-times-cli-empty-');
    const outFile = path.join(dir, 'times.json');
    expect(() => execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile,
    ], { cwd: repoRoot, stdio: 'pipe' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-shards.test.ts --maxWorkers=2
```

  Measured (module doesn't exist yet — the right reason):

```
Error: Cannot find module '../../.github/ci/shards.mjs' imported from …/server/test/ci-shards.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/shards.mjs` with exactly this content:

<!-- file: .github/ci/shards.mjs -->
```js
// The shard planner (spec §7, contract Task 6).
//
// Packs the selected server test files across a bounded number of CI
// runners: LPT (longest-processing-time-first) bin-packing when real
// per-file durations are known (from the `testtimes` artifact of a trusted
// main run), or an equal vitest hash-shard fallback (`--shard=i/n`, each
// shard given every file) when none are (spec §7.1: with no durations at
// all, sharding falls back to vitest's own `--shard=i/n`).
//
// Paths in `files` / the keys of `durations` are REPO-RELATIVE POSIX
// strings, matching every other module in `.github/ci/` (contract
// "Conventions"); `toMatrix` is where the plan crosses into
// SERVER-RELATIVE, because that is the one boundary the workflow reads
// (`CCRC_TEST_LIST`, `vitest run <files>`).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ index: number, total: number, files: string[], vitestShard: string|null }} Shard
 * @typedef {Shard[]} ShardPlan
 * @typedef {{ targetMs: number, min: number, max: number, workers: number, defaultMs: number, scale?: number }} ShardProfile
 */

/**
 * Per-file durations from a vitest JSON reporter report (`vitest run
 * --reporter=json --outputFile.json=…`). `testResults[].name` is an
 * ABSOLUTE path; `endTime - startTime` (both ms-epoch, possibly
 * fractional) is the file's wall time. A flat 500ms is added per file for
 * vitest's own collection overhead (spec §7.1's planner budget), added
 * once here so every caller of the resulting map already carries it.
 *
 * @param {{ testResults: Array<{ name: string, startTime: number, endTime: number }> }} report
 * @param {string} repoRoot
 * @returns {Record<string, number>}
 */
export function durationsFromVitestJson(report, repoRoot) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const result of report.testResults ?? []) {
    const rel = path.relative(repoRoot, result.name).split(path.sep).join('/');
    out[rel] = (result.endTime - result.startTime) + 500;
  }
  return out;
}

/** @type {Record<string, ShardProfile>} */
export const PROFILES = {
  linux: { targetMs: 240_000, min: 1, max: 5, workers: 2, defaultMs: 5000 },
  macosSelected: { targetMs: 900_000, min: 1, max: 2, workers: 1, defaultMs: 5000, scale: 1.5 },
  macosFull: { targetMs: 900_000, min: 1, max: 4, workers: 1, defaultMs: 5000, scale: 1.5 },
  trace: { targetMs: 900_000, min: 1, max: 8, workers: 2, defaultMs: 5000, scale: 6 },
};

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Pack `files` into a `ShardPlan` (spec §7.1).
 *
 * total = Σ(duration ?? the median of the known durations, or defaultMs
 * when none are known)·scale; count = clamp(ceil(total /
 * workers / targetMs), min, max), never more than `files.length`. With
 * `durations`: LPT — sort files longest-duration-first (ties by path
 * ascending), assign each to the currently least-loaded shard;
 * `vitestShard: null`. With `durations === null`: every shard gets ALL
 * files and `vitestShard: "i/n"` (vitest's own hash-partitioned
 * `--shard`). Empty `files` -> `[]`.
 *
 * @param {string[]} files repo-relative test file paths
 * @param {Record<string, number>|null} durations repo-relative path -> ms, or null when none are known
 * @param {ShardProfile} profile
 * @returns {ShardPlan}
 */
export function planShards(files, durations, { targetMs, min, max, workers, defaultMs, scale = 1 }) {
  if (files.length === 0) return [];

  // A file with no duration is given the MEDIAN of the known ones (spec §7.1); `defaultMs` only when none are
  // known — an empty table, or none at all.
  const known = durations != null ? Object.values(durations).sort((a, b) => a - b) : [];
  const mid = known.length >> 1;
  const fallback = known.length === 0 ? defaultMs : known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const durationOf = (f) => (durations != null ? (durations[f] ?? fallback) : defaultMs);
  const total = files.reduce((sum, f) => sum + durationOf(f), 0) * scale;
  const raw = Math.ceil(total / workers / targetMs);
  const count = Math.min(clamp(raw, min, max), files.length);

  if (durations === null) {
    return Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      total: count,
      files: [...files],
      vitestShard: `${i + 1}/${count}`,
    }));
  }

  const sorted = [...files].sort((a, b) => {
    const da = durationOf(a);
    const db = durationOf(b);
    if (db !== da) return db - da;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const loads = new Array(count).fill(0);
  /** @type {string[][]} */
  const buckets = Array.from({ length: count }, () => []);
  for (const f of sorted) {
    let idx = 0;
    for (let i = 1; i < count; i++) if (loads[i] < loads[idx]) idx = i;
    buckets[idx].push(f);
    loads[idx] += durationOf(f);
  }

  return buckets.map((bucketFiles, i) => ({
    index: i + 1,
    total: count,
    files: bucketFiles,
    vitestShard: null,
  }));
}

function toServerRelative(repoRelPath) {
  return repoRelPath.startsWith('server/') ? repoRelPath.slice('server/'.length) : repoRelPath;
}

/**
 * The GitHub Actions matrix shape `ci.yml`'s `server-shard` / `test-macos`
 * jobs read. Paths cross the repo-relative -> server-relative boundary
 * here (contract "Conventions" — convert only at the two stated
 * boundaries).
 *
 * @param {ShardPlan} plan
 * @returns {{ include: Array<{ shard: number, total: number, files: string, vitest_shard: string }> }}
 */
export function toMatrix(plan) {
  return {
    include: plan.map((s) => ({
      shard: s.index,
      total: s.total,
      files: s.files.map(toServerRelative).join(' '),
      vitest_shard: s.vitestShard ?? '',
    })),
  };
}

function usage() {
  process.stderr.write('usage: node shards.mjs times --out FILE <report.json>...\n');
  process.exitCode = 2;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'times') return usage();
  const outIdx = rest.indexOf('--out');
  if (outIdx === -1 || !rest[outIdx + 1]) return usage();
  const outFile = rest[outIdx + 1];
  const reportFiles = rest.filter((_, i) => i !== outIdx && i !== outIdx + 1);
  if (reportFiles.length === 0) return usage();

  // vitest's JSON names every file by its ABSOLUTE path, and the keys must
  // be repo-relative (`server/test/…`, what select.mjs plans with), so the
  // root they are made relative to is the directory this runs in: the
  // repository root. ci.yml's times-build runs it with no working-directory.
  // Run from anywhere else, a key would come out `test/…` or `../…` and match
  // no file — every duration silently lost — so that refuses instead.
  const repoRoot = process.cwd();
  /** @type {Record<string, number>} */
  const merged = {};
  for (const rf of reportFiles) {
    const report = JSON.parse(readFileSync(rf, 'utf8'));
    Object.assign(merged, durationsFromVitestJson(report, repoRoot));
  }
  const stray = Object.keys(merged).filter((k) => !k.startsWith('server/'));
  if (stray.length > 0) {
    process.stderr.write(`shards.mjs times: ${stray[0]} is not under server/ relative to ${repoRoot} — run it from the repository root\n`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(outFile, JSON.stringify(merged, Object.keys(merged).sort(), 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-shards.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

- [ ] **Step 5: Measure the mutation table** (mutate → run Step 4's command → restore; every row re-measured red in
  the integration clone, then reverted and reconfirmed green at 21/21):

  | # | Mutation | Test(s) that go RED |
  |---|---|---|
  | 1 | Reverse the LPT sort (`db - da` → `da - db`) | `a single file far longer than the target gets a shard of its own`, `a file missing from a NON-empty table is given the MEDIAN…` (2) |
  | 2 | Drop the `files.length` cap on the shard count | `never produces more shards than files…`, `every shard gets ALL files, with a vitestShard "i/n" string` (2) |
  | 3 | Drop the `clamp` (`Math.min(raw, files.length)`) | `clamps the shard count to [min, max] regardless of total` (1) |
  | 4 | Remove the `durations === null` branch entirely (always LPT) | `every shard gets ALL files, with a vitestShard "i/n" string`, `with a single computed shard, vitestShard is "1/1"` (2) |
  | 5 | `toMatrix` stops stripping the `server/` prefix | `converts repo-relative paths to server-relative, space-joined` (1) |
  | 6 | Treat an EMPTY durations object as null (`durations === null \|\| Object.keys(durations).length === 0`) | `packs by LPT at defaultMs, every file exactly once, and never hands out a vitest --shard` (1) |
  | 7 | `times` CLI: drop the repository-root check | `run from anywhere else (server/): refuses, and writes nothing` (1) |
  | 8 | A file missing from a non-empty table packed at `defaultMs`, not the median | `a file missing from a NON-empty table is given the MEDIAN of the known durations (spec §7.1)` (1) |
  | 9 | An even count's median taken as the lower middle, not the mean of the two | the same (1) |

  One mutation was tried and found NOT load-bearing, measured rather than assumed: removing the
  `if (files.length === 0) return [];` early-return left every test green, because `Math.min(clamp(raw, min, max),
  files.length)` already forces `count = 0` for an empty list — the guard for the empty-list rule is the
  `files.length` term (row 2).

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

  (`grep -ln 'shards.mjs\|ci-shards' test/*.ts` → only `test/ci-shards.test.ts` at this commit.)

- [ ] **Step 7: Commit**

```bash
git add .github/ci/shards.mjs server/test/ci-shards.test.ts
git commit -F - <<'EOF'
feat(ci): shard planner (spec §7)

LPT bin-packing of selected server test files onto a bounded shard count
when per-file durations are known (a file missing from the table is
packed at the table's median; an empty table at the default), falling back to vitest's own hash-shard (--shard=i/n,
every shard given every file) when they are null. Includes the four
shard profiles, the repo-relative -> server-relative toMatrix boundary,
and the `times` CLI that merges per-shard vitest JSON reports into one
durations file — run from the repository root, which it checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Trace runner `.github/ci/trace-run.mjs`

**Files:**
- Create: `.github/ci/trace-run.mjs`
- Test: `server/test/ci-trace-run.test.ts`

**Interfaces:** Consumes: `parseTraceDirSplit` from Task 3, `server/vitest.select.config.ts` and
`server/test/ci-baseline.test.ts` from Task 2 / Produces: `export function traceArgv(traceDir): string[]` (the
exact strace invocation, pinned), `export function tracedCommand(traceDir, pidFile): string[]`,
`export function tracedEnv(env, listFile)`, `export function runTraced(argv, opts)`,
`export function recordOf(workDir, repoRoot, exit, timeoutSec)`, `export async function runPool(items, concurrency,
worker)`, `export async function traceAll(repoRoot, serverRelPaths, {jobs?, timeoutSec?, baselineTimeoutSec?,
killAfterSec?}): Promise<Records>` (format 2, repo-relative test keys, NOT baseline-subtracted — consumed by Task 4),
and the CLI (`node .github/ci/trace-run.mjs --repo ROOT --files LISTFILE --out FILE [--jobs N] [--timeout SEC]
[--kill-after SEC]`) that Task 11's `trace-shard` invokes. The CLI always writes the records and exits 0 — a
traced test that failed or timed out is recorded `unknown` and named on stdout — and only a crash of the runner
itself is non-zero. What is red is Task 4's to say, after it writes the map.
- Changed in integration (process split): vitest runs as `sh -c 'echo $$ > "$0"; exec "$@"' <workDir>/root.pid
  ./node_modules/.bin/vitest run …` under strace — sh writes its own pid, then execs vitest as that same pid — so
  every record is `{ root, rest, unknown, why? }` and `Records` is format 2 (Task 4). A run whose root pid was not
  recorded, or has no trace file, is `unknown`: the split could not be trusted. The trace directory now holds
  strace's files alone (the list and pid files sit beside it).
- Changed in integration (syscalls): `traceArgv` adds `readlink` (measured: `fs.realpathSync.native('missing/x')`
  emits only a `readlink` ENOENT) and `clone,clone3` (they record nothing; they say which thread belongs to which
  process, for the split); the traced child's environment sets `UV_USE_IO_URING=0`, which keeps libuv's fs on its
  threadpool, where every fs op is a visible syscall. The traced fixture asserts that variable from INSIDE the
  traced process, so the environment the call site really passes is what is pinned.
- Changed in integration (operator's rulings S1-S3, M1): `traceArgv` is `strace -f -ff -ttt -y -qq` with `symlink`,
  `symlinkat`, `chdir` and `fchdir` added (Task 3 reads them); `tracedEnv` sets `CCRC_TRACING=1`, which this very
  test file reads to skip its own nested-strace cases when a map rebuild traces it (strace cannot attach under an
  outer strace — without the skip it would be `unknown` in every map).
- Changed in integration (operator's ruling R5, replacing M1's exit 3): the CLI no longer decides red. A traced test
  that failed or timed out is recorded `unknown` and named on stdout, and the CLI exits 0 once the records are
  written. M1 made it exit 3, which turned the trace shard red on every rebuild and on every refresh that
  re-traced a test that always fails under tracing (`session-hook`'s timing budgets; rule 2 re-traces an unknown
  test on every merge), so the red said nothing. Task 4's CLI now compares each failure with the map the run
  started from and exits 3 only for news; Task 11 publishes the map first and then turns `map-build` red.
- Changed in integration (operator's rulings X1-X5): the fixtures live in a per-run DOT directory under `server/`
  (`server/.ci-tracerun-<pid>-<ms>`), never `server/test/` — a concurrent vitest collected them there and
  `typecheck-tests`' census raced them; vitest's include glob does not match a dot directory and a literal include
  there runs (measured). The leak fixture's detached process is killed by the pid it wrote (`process.kill(-pid)`),
  never by a command-line pattern that could hit another run's. `traceAll` takes a separate `baselineTimeoutSec`
  and a configurable `killAfterSec` (the CLI's `--kill-after`, default 30), so a test can give the baseline a
  generous deadline and the leak case a 2-second grace. The case that runs the baseline plus two files runs them at
  `jobs: 2`, so `runPool`'s concurrency is exercised by a real run.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-trace-run.test.ts` (real, non-mocked
  `strace`/`timeout`/`vitest` runs against fixture files written into a per-run dot directory under this repo's own
  `server/`, because `vitest.select.config.ts` resolves `CCRC_TEST_LIST` relative to `server/`; the pure half needs
  no strace):

<!-- file: server/test/ci-trace-run.test.ts -->
```ts
// `.github/ci/trace-run.mjs` (spec §5.1/§5.3/§5.4, contract Task 7): runs a real `strace`d `vitest` process per
// server test file. These are REAL integration tests -- they shell out to real `strace`, `timeout` and `vitest`
// against fixture test files written into this repo's OWN `server/`, because `vitest.select.config.ts` resolves
// `CCRC_TEST_LIST` entries relative to `server/`, and a synthetic standalone repo would need its own
// `node_modules` to run real `vitest` under real `strace` at all. The fixtures live in a per-run DOT directory
// under `server/` — never `server/test/`, where a concurrent vitest would collect them and typecheck-tests'
// census would race them; vitest's include glob does not match it, the census skips dot directories, and a
// literal include there runs (measured).
//
// When this file is itself being traced (a map rebuild traces every server test; `CCRC_TRACING=1` comes from
// trace-run's own environment), its nested-strace cases skip: strace cannot attach under an outer strace, so
// they would fail and leave this file `unknown` in every map.
//
// Platform gating (per the plan): `strace` does not exist on Darwin, so this whole suite is a structural no-op
// there -- `describe.skip`. On Linux, `strace` is a required tool for real CI (the daily map rebuild and every
// per-merge refresh depend on it); a Linux box that lacks it while `CI` is set must FAIL loudly, never silently
// skip -- §6.3's "loud, never silent" applies to the tracer's own preconditions as much as to the selector's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceArgv, traceAll, tracedCommand, tracedEnv, recordOf, runTraced, runPool } from '../../.github/ci/trace-run.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..');

// The pure half — the command, the environment and the reading of one finished run — needs no strace, so it
// runs on every platform.
describe('trace-run.mjs: the traced command and how a finished run is read', () => {
  it('tracedCommand: strace, then a sh that writes its own pid and execs vitest (exec keeps the pid)', () => {
    expect(tracedCommand('/w/trace', '/w/root.pid')).toEqual([
      ...traceArgv('/w/trace'),
      'sh', '-c', 'echo $$ > "$0"; exec "$@"', '/w/root.pid',
      './node_modules/.bin/vitest', 'run', '--config', 'vitest.select.config.ts', '--maxWorkers=1',
    ]);
  });

  it('tracedEnv: the exact list, CI, libuv kept off io_uring, and CCRC_TRACING marking a traced run', () => {
    expect(tracedEnv({ PATH: '/bin', UV_USE_IO_URING: '1' }, '/w/list.txt')).toEqual({
      PATH: '/bin', CCRC_TEST_LIST: '/w/list.txt', CI: 'true', UV_USE_IO_URING: '0', CCRC_TRACING: '1',
    });
  });

  it('runTraced resolves when the process EXITS, even while a backgrounded descendant still holds its stdio', async () => {
    // The guard for a trace shard hanging to its deadline: `stdio: 'ignore'` + the 'exit' event. With a piped
    // stdio and 'close', this waits the sleeper's full 30s (measured: 4ms against 7007ms for a 7s sleeper).
    const dir = mkTmp('ccrc-trace-run-bg-');
    const pidFile = path.join(dir, 'bg.pid');
    const start = Date.now();
    const exit = await runTraced(['sh', '-c', `sleep 30 & echo $! > "${pidFile}"; exit 0`], {});
    const elapsed = Date.now() - start;
    try {
      expect(exit).toEqual({ code: 0, signal: null, error: null });
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('runPool visits every item once and never runs more than `concurrency` at a time', async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5], 2, async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  /** A finished run's work dir: `trace/t.<pid>` files and, unless `pid` is null, `root.pid`. */
  function workDir(pid: string | null, files: Record<string, string>): string {
    const dir = mkTmp('ccrc-trace-run-work-');
    mkdirSync(path.join(dir, 'trace'));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'trace', name), text);
    if (pid !== null) writeFileSync(path.join(dir, 'root.pid'), pid + '\n');
    return dir;
  }
  const REPO = mkTmp('ccrc-trace-run-repo-');
  const ok = { code: 0, signal: null, error: null };
  const cfg = `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/vitest.config.ts", O_RDONLY) = 3<${REPO}/server/vitest.config.ts>\n`;
  const own = `openat(AT_FDCWD<${REPO}/server>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>\n`;

  it('a clean run: the root pid\'s process is root, everything else rest, not unknown', () => {
    const rec = recordOf(workDir('700', { 't.700': cfg, 't.701': own }), REPO, ok, 60);
    expect(rec).toEqual({
      root: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      rest: { read: ['ccd/ccd'], probed: [], listed: [], subtree: [], git: false },
      unknown: false,
    });
  });

  it('no root.pid, or a root pid with no trace file -> unknown (the split cannot be trusted)', () => {
    const noPid = recordOf(workDir(null, { 't.700': cfg }), REPO, ok, 60);
    expect(noPid.unknown).toBe(true);
    expect(noPid.why).toMatch(/root process/);
    const noFile = recordOf(workDir('999', { 't.700': cfg }), REPO, ok, 60);
    expect(noFile.unknown).toBe(true);
    expect(noFile.why).toMatch(/root process/);
  });

  it('a non-zero exit, a timeout, or an unresolved path -> unknown with the reason', () => {
    expect(recordOf(workDir('700', { 't.700': cfg }), REPO, { code: 1, signal: null, error: null }, 60).why)
      .toBe('vitest exited 1');
    expect(recordOf(workDir('700', { 't.700': cfg }), REPO, { code: 124, signal: null, error: null }, 60).why)
      .toBe('timeout after 60s');
    const unresolved = recordOf(workDir('700', { 't.700': 'access("rel", F_OK) = 0\n' }), REPO, ok, 60);
    expect(unresolved.unknown).toBe(true);
    expect(unresolved.why).toMatch(/unresolved/);
  });
});

const isDarwin = process.platform === 'darwin';
const hasStrace = (() => {
  try {
    return spawnSync('strace', ['-V']).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(isDarwin)('trace-run.mjs', () => {
  if (!isDarwin && !hasStrace) {
    // Linux, no strace: CI must go red, never quietly skip (§6.3's "loud, never silent"); a local dev box
    // without strace gets a clear failure too, rather than a suite that silently ran zero assertions.
    it('FAILS loudly when strace is required but missing (linux)', () => {
      throw new Error(
        'trace-run.mjs test suite requires `strace` on Linux and none was found on PATH -- ' +
        'install it rather than skip this suite (CI test selection cannot trace without it).',
      );
    });
    return;
  }

  it('traceArgv is exactly the pinned strace invocation', () => {
    expect(traceArgv('/some/dir')).toEqual([
      'strace', '-f', '-ff', '-ttt', '-y', '-qq',
      '-e', 'trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3',
      '-o', '/some/dir/t',
    ]);
  });

  const nested = process.env.CCRC_TRACING === '1';

  describe.skipIf(nested)('real traced runs', () => {
    // A per-run dot directory under server/: see the file header.
    const fixtureRel = `.ci-tracerun-${process.pid}-${Date.now()}`;
    const fixtureDir = path.join(serverRoot, fixtureRel);
    const tiny = `${fixtureRel}/tiny.test.ts`;
    const linked = `${fixtureRel}/linked.test.ts`;
    const failing = `${fixtureRel}/failing.test.ts`;
    const slow = `${fixtureRel}/slow.test.ts`;
    const leak = `${fixtureRel}/leak.test.ts`;
    const leakPidFile = path.join(fixtureDir, 'leak.pid');
    const cli = path.join(repoRoot, '.github', 'ci', 'trace-run.mjs');

    beforeAll(() => {
      mkdirSync(fixtureDir);
      writeFileSync(path.join(serverRoot, tiny),
        "import { describe, it, expect } from 'vitest';\n" +
        "describe('ci-tracerun tiny fixture', () => {\n" +
        // Asserted INSIDE the traced process, so the environment traceOne really passes is what is checked
        // (a red here makes the run exit 1, which the record reports as unknown).
        "  it('runs with libuv off io_uring', () => { expect(process.env.UV_USE_IO_URING).toBe('0'); });\n" +
        '});\n');
      // Reads two repo files only THROUGH symlinks in a tmp dir, the way ccrc-models builds its fixture box: one
      // opened (its fd resolves to the repo file), one only stat'ed (only the link's creation names it) — and
      // stats a file through a link to a whole repo DIRECTORY, which leaves only the directory to record.
      writeFileSync(path.join(serverRoot, linked),
        "import { it, expect } from 'vitest';\n" +
        "import { mkdtempSync, symlinkSync, readFileSync, statSync } from 'node:fs';\n" +
        "import { tmpdir } from 'node:os';\n" +
        "import path from 'node:path';\n" +
        "it('reads through tmp symlinks', () => {\n" +
        "  const box = mkdtempSync(path.join(tmpdir(), 'ccrc-tracerun-box-'));\n" +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'ccd', 'worker-skill', 'SKILL.md'))}, path.join(box, 'skill'));\n` +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'ccd', 'ccrc-models-probe'))}, path.join(box, 'probe'));\n` +
        "  expect(readFileSync(path.join(box, 'skill'), 'utf8').length).toBeGreaterThan(0);\n" +
        "  expect(statSync(path.join(box, 'probe')).isFile()).toBe(true);\n" +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'shared'))}, path.join(box, 'shared'));\n` +
        "  expect(statSync(path.join(box, 'shared', 'api.ts')).isFile()).toBe(true);\n" +
        '});\n');
      writeFileSync(path.join(serverRoot, failing),
        "import { it, expect } from 'vitest';\n" +
        "it('fails', () => { expect(1).toBe(2); });\n");
      writeFileSync(path.join(serverRoot, slow),
        "import { it } from 'vitest';\n" +
        "it('outlives the trace timeout', async () => { await new Promise((r) => setTimeout(r, 20_000)); }, 30_000);\n");
      writeFileSync(path.join(serverRoot, leak),
        "import { describe, it } from 'vitest';\n" +
        "import { spawn } from 'node:child_process';\n" +
        "import { writeFileSync } from 'node:fs';\n" +
        "describe('ci-tracerun leak fixture', () => {\n" +
        // `stdio: 'inherit'` (not 'ignore') is the part that matters: it shares this grandchild's stdout/
        // stderr fds with the process that spawned it. Its pid goes to a file, so afterAll kills exactly it.
        "  it('spawns a detached long-running process, inheriting stdio, and returns immediately', () => {\n" +
        "    const child = spawn('sleep', ['300'], { detached: true, stdio: 'inherit' });\n" +
        `    writeFileSync(${JSON.stringify(leakPidFile)}, String(child.pid));\n` +
        '    child.unref();\n' +
        '  });\n' +
        '});\n');
    });

    afterAll(() => {
      // Exactly the leaked sleeper, never a pattern: it is the leader of its own process group (detached).
      if (existsSync(leakPidFile)) {
        const pid = Number(readFileSync(leakPidFile, 'utf8'));
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('traces the baseline plus two files at jobs:2: the tiny one reads itself, the linked one reads through symlinks', async () => {
      const records = await traceAll(repoRoot, [tiny, linked], { jobs: 2, timeoutSec: 120 });
      expect(records.format).toBe(2);
      expect(records.baseline.root.git).toBe(false);
      expect(records.baseline.rest.git).toBe(false);
      expect(records.baseline.root.read).toContain('server/test/ci-baseline.test.ts');
      // The include glob's walk of server/test is the ROOT process's (measured on one of its threadpool
      // threads), never the worker's — which is what lets a test's own walk of it survive the subtraction.
      expect(records.baseline.root.listed).toContain('server/test');
      expect(records.baseline.rest.listed).not.toContain('server/test');

      expect(Object.keys(records.tests).sort()).toEqual([`server/${linked}`, `server/${tiny}`]);
      const t = records.tests[`server/${tiny}`];
      expect(t.unknown).toBe(false);
      expect(t.root.read).toContain(`server/${tiny}`);
      const l = records.tests[`server/${linked}`];
      expect(l.unknown).toBe(false);
      expect(l.rest.read).toContain('ccd/worker-skill/SKILL.md');
      expect(l.rest.read).toContain('ccd/ccrc-models-probe');
      expect(l.rest.subtree).toEqual(['shared']);
    }, 180_000);

    it('a baseline that fails to trace is a hard stop for the whole run', async () => {
      await expect(traceAll(repoRoot, [], { baselineTimeoutSec: 0.05, killAfterSec: 1 }))
        .rejects.toThrow(/trace-run: baseline trace failed: timeout after 0\.05s/);
    }, 60_000);

    it('records a leaked detached background process as unknown, and the runner returns', async () => {
      // The baseline gets its own ordinary timeout (a loaded box once took the 3s for itself); the leak fixture
      // gets 3s and a 2s kill-after grace, so this case does not idle on the default 30.
      const start = Date.now();
      const records = await traceAll(repoRoot, [leak], { jobs: 1, timeoutSec: 3, baselineTimeoutSec: 120, killAfterSec: 2 });
      const elapsedMs = Date.now() - start;
      const rec = records.tests[`server/${leak}`];
      expect(rec.unknown).toBe(true);
      expect(rec.why).toMatch(/timeout/i);
      // The leaked grandchild must not hang the job: back well inside its 300s — and inside the default 30s
      // kill-after grace too, which is what shows `killAfterSec` reached `timeout` (measured ~10s here).
      expect(elapsedMs).toBeLessThan(25_000);
    }, 150_000);

    it('the CLI records a traced test that FAILED or TIMED OUT as unknown and still exits 0 — map-build decides what is red', () => {
      const dir = mkTmp('ccrc-trace-run-cli-');
      writeFileSync(path.join(dir, 'red.txt'), `${failing}\n${slow}\n`);
      writeFileSync(path.join(dir, 'none.txt'), '');
      const red = spawnSync(process.execPath, [cli, '--repo', repoRoot, '--files', path.join(dir, 'red.txt'),
        '--out', path.join(dir, 'red.json'), '--timeout', '8', '--kill-after', '2'], { encoding: 'utf8' });
      expect(red.status).toBe(0);
      expect(red.stdout).toContain(`trace-run: server/${failing}: vitest exited 1`);
      expect(red.stdout).toContain(`trace-run: server/${slow}: timeout after 8s`);
      expect(red.stdout).not.toContain('::error::');
      const records = JSON.parse(readFileSync(path.join(dir, 'red.json'), 'utf8'));
      expect(records.tests[`server/${failing}`]).toMatchObject({ unknown: true, why: 'vitest exited 1' });
      expect(records.tests[`server/${slow}`]).toMatchObject({ unknown: true, why: 'timeout after 8s' });
      const green = spawnSync(process.execPath, [cli, '--repo', repoRoot, '--files', path.join(dir, 'none.txt'),
        '--out', path.join(dir, 'green.json'), '--timeout', '120'], { encoding: 'utf8' });
      expect(green.status).toBe(0);
    }, 180_000);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-trace-run.test.ts --maxWorkers=1
```

  Measured:

```
Error: Cannot find module '../../.github/ci/trace-run.mjs' imported from …/server/test/ci-trace-run.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/trace-run.mjs`:

<!-- file: .github/ci/trace-run.mjs -->
```js
// CI test selection (spec §5.1, §5.3, §5.4, contract Task 7): runs one or more server test files, each in its
// own `strace`d `vitest` process, and folds the parsed dependencies into a `Records` JSON (`.github/ci/testmap.mjs`
// then subtracts the baseline and builds/refreshes a `TestMap` from it -- this module's own output is RAW).
//
// The baseline (`test/ci-baseline.test.ts`) always traces FIRST, sequentially, never inside the concurrent pool:
// every other test's record is meaningless without it (the map-build step subtracts it from everything), so a
// baseline that fails to trace is a hard stop for the whole run, not one more `unknown: true` entry.
//
// Every record is kept SPLIT BY PROCESS — `root` (the vitest root process: its config, its include glob's walk of
// `server/test/`, the transforms of the test's imports) and `rest` (the worker and everything the test spawns) —
// because the baseline is subtracted per side (see `trace-to-deps.mjs`'s header for why). The root pid is
// captured by running vitest through `sh -c 'echo $$ > "$0"; exec "$@"'`: sh writes its own pid, then execs
// vitest as that same pid.
//
// The CLI does not decide what is red: it always writes the records and exits 0 (a crash of the runner itself is
// still non-zero). A traced test that failed or timed out is recorded `unknown` and named on stdout; whether that
// is NEWS — failing now and not unknown in the map this run started from — is `testmap.mjs`'s to say, after it
// has written the map (spec §5.4). A test that always fails under tracing (session-hook's timing budgets) would
// otherwise turn every refresh that re-traces it red.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTraceDirSplit } from './trace-to-deps.mjs';

/** @typedef {import('./trace-to-deps.mjs').DepRecord} DepRecord */
/** @typedef {{ root: DepRecord, rest: DepRecord, unknown: boolean, why?: string }} SplitRecord */
/** @typedef {{ format: 2, baseline: { root: DepRecord, rest: DepRecord }, tests: Record<string, SplitRecord> }} Records */

const DEFAULT_JOBS = 2;
const DEFAULT_TIMEOUT_SEC = 900;
const KILL_AFTER_SEC = 30;
const BASELINE_SERVER_REL = 'test/ci-baseline.test.ts';
const ROOT_PID_SH = 'echo $$ > "$0"; exec "$@"';

/**
 * The exact `strace` invocation this module wraps every traced `vitest run` in (spec §5.1): per-thread output
 * files (`-ff`), fd-to-path annotations (`-y`) so a relative path is always resolvable from the same line
 * (see `trace-to-deps.mjs`'s header), quiet (`-qq`), restricted to the file-shaped syscalls the map records —
 * plus `readlink` (`realpathSync.native` probes with it and nothing else) and `clone`/`clone3`, which record
 * nothing themselves but say which thread belongs to which process, for the root/rest split.
 * @param {string} traceDir
 * @returns {string[]}
 */
export function traceArgv(traceDir) {
  return [
    'strace', '-f', '-ff', '-ttt', '-y', '-qq',
    '-e', 'trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3',
    '-o', path.join(traceDir, 't'),
  ];
}

/**
 * The whole traced command for one test file, run from `server/`: strace, then a `sh` that writes its OWN pid to
 * `pidFile` and `exec`s vitest — so the pid in `pidFile` IS the vitest root process (exec keeps the pid).
 * @param {string} traceDir
 * @param {string} pidFile
 * @returns {string[]}
 */
export function tracedCommand(traceDir, pidFile) {
  return [
    ...traceArgv(traceDir),
    'sh', '-c', ROOT_PID_SH, pidFile,
    './node_modules/.bin/vitest', 'run', '--config', 'vitest.select.config.ts', '--maxWorkers=1',
  ];
}

/**
 * The traced child's environment. `UV_USE_IO_URING=0` keeps libuv on its threadpool: with io_uring, Node's
 * asynchronous fs can be submitted through the ring, and none of it would appear as a syscall strace can see.
 * `CCRC_TRACING=1` tells a test it is being traced — this module's own suite skips its nested-strace cases then,
 * since strace cannot attach under an outer strace.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} listFile
 * @returns {NodeJS.ProcessEnv}
 */
export function tracedEnv(env, listFile) {
  return { ...env, CCRC_TEST_LIST: listFile, CI: 'true', UV_USE_IO_URING: '0', CCRC_TRACING: '1' };
}

/** Runs `argv[0]` with the rest as args, under a `timeout --kill-after` wrapper, WITHOUT inheriting stdio.
 *
 *  `stdio: 'ignore'` (rather than piping and draining) and listening for `'exit'` rather than `'close'` guard
 *  against the same class of hang, belt and braces: a test that leaks a DETACHED grandchild (`spawn(...,
 *  {detached: true})`, e.g. a stray `sleep 300`) that inherited a copy of this process's own stdout/stderr pipe
 *  would keep that pipe's write end open long after `timeout` has correctly killed the traced `vitest` process --
 *  and Node's `'close'` event waits for every stream fd to close, not just for the process to exit, so
 *  `trace-run.mjs` could hang on a job `timeout` had already ended. `'exit'` fires the moment the traced process
 *  itself terminates, independent of any fd a descendant still holds open; `stdio: 'ignore'` removes the pipe a
 *  descendant could hold open in the first place, for the direct child at least.
 *
 *  Measured (this module's own suite): a unit case spawns a shell that backgrounds a `sleep` holding the
 *  shell's stdio and exits; `runTraced` must resolve on that exit. Mutating BOTH halves (`'pipe'` and
 *  `'close'`) hangs it until the case's own timeout; either half alone still passes, because either one
 *  suffices. Through `traceAll`, the leak fixture (a detached `sleep 300` with `stdio: 'inherit'`) returns
 *  inside its bound either way on this repo's `forks` pool, which gives the grandchild its worker's own stdio
 *  pipe rather than this function's. */
export function runTraced(argv, opts) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { ...opts, stdio: 'ignore' });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on('error', (err) => finish({ code: null, signal: null, error: String(err) }));
    child.on('exit', (code, signal) => finish({ code, signal, error: null }));
  });
}

/**
 * Reads one finished traced run: `workDir` holds `trace/` (strace's per-thread files) and `root.pid`. A failed
 * spawn, a timeout, a non-zero exit, a missing root pid (or no trace file for it — the split could not be
 * trusted), or an unresolved relative path each make the record `unknown`, with the reason.
 * @param {string} workDir
 * @param {string} repoRoot
 * @param {{ code: number|null, signal: string|null, error: string|null }} exit
 * @param {number} timeoutSec
 * @returns {SplitRecord}
 */
export function recordOf(workDir, repoRoot, exit, timeoutSec) {
  const traceDir = path.join(workDir, 'trace');
  let why;
  if (exit.error) why = `spawn error: ${exit.error}`;
  else if (exit.code === 124 || exit.signal) why = `timeout after ${timeoutSec}s`;
  else if (exit.code !== 0) why = `vitest exited ${exit.code}`;

  let rootPid = '';
  try {
    rootPid = readFileSync(path.join(workDir, 'root.pid'), 'utf8').trim();
  } catch {
    rootPid = '';
  }
  const rootTraced = /^[1-9]\d*$/.test(rootPid) && existsSync(path.join(traceDir, `t.${rootPid}`));
  if (!why && !rootTraced) why = `no trace of the vitest root process (root.pid: ${JSON.stringify(rootPid)})`;

  const { root, rest, unresolved } = parseTraceDirSplit(traceDir, repoRoot, rootTraced ? rootPid : 0);
  if (!why && unresolved > 0) why = `${unresolved} unresolved relative path(s)`;

  return why ? { root, rest, unknown: true, why } : { root, rest, unknown: false };
}

/**
 * Traces one server-relative test file (or the baseline) and returns its split record.
 * @param {string} repoRoot
 * @param {string} serverRelPath
 * @param {number} timeoutSec
 * @returns {Promise<SplitRecord>}
 */
async function traceOne(repoRoot, serverRelPath, timeoutSec, killAfterSec) {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ccrc-trace-'));
  const traceDir = path.join(workDir, 'trace');
  mkdirSync(traceDir);
  const listFile = path.join(workDir, 'list.txt');
  writeFileSync(listFile, serverRelPath + '\n', 'utf8');

  const argv = [
    'timeout', `--kill-after=${killAfterSec}`, String(timeoutSec),
    ...tracedCommand(traceDir, path.join(workDir, 'root.pid')),
  ];
  const exit = await runTraced(argv, {
    cwd: path.join(repoRoot, 'server'),
    env: tracedEnv(process.env, listFile),
  });

  const record = recordOf(workDir, repoRoot, exit, timeoutSec);
  rmSync(workDir, { recursive: true, force: true });
  return record;
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once.
 *  @template T @param {T[]} items @param {number} concurrency @param {(item: T) => Promise<void>} worker */
export async function runPool(items, concurrency, worker) {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane);
  await Promise.all(lanes);
}

/**
 * Traces the baseline plus every file in `serverRelPaths`, `jobs` at a time, and returns the raw `Records`
 * (format 2: repo-relative test keys, each record split root/rest, NOT baseline-subtracted -- `testmap.mjs`
 * does that).
 * @param {string} repoRoot
 * @param {string[]} serverRelPaths server-relative paths, e.g. `test/bus.test.ts`
 * `baselineTimeoutSec` (default `timeoutSec`) bounds the baseline alone; `killAfterSec` (default 30) is the
 * `timeout --kill-after` grace.
 * @param {{ jobs?: number, timeoutSec?: number, baselineTimeoutSec?: number, killAfterSec?: number }} [options]
 * @returns {Promise<Records>}
 */
export async function traceAll(repoRoot, serverRelPaths, options = {}) {
  const root = realpathSync(repoRoot);
  const jobs = options.jobs ?? DEFAULT_JOBS;
  const timeoutSec = options.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const baselineTimeoutSec = options.baselineTimeoutSec ?? timeoutSec;
  const killAfterSec = options.killAfterSec ?? KILL_AFTER_SEC;

  const baselineResult = await traceOne(root, BASELINE_SERVER_REL, baselineTimeoutSec, killAfterSec);
  if (baselineResult.unknown) {
    throw new Error(`trace-run: baseline trace failed: ${baselineResult.why}`);
  }
  const baseline = { root: baselineResult.root, rest: baselineResult.rest };

  /** @type {Record<string, SplitRecord>} */
  const tests = {};
  await runPool(serverRelPaths, jobs, async (serverRelPath) => {
    const repoRelKey = path.posix.join('server', serverRelPath);
    tests[repoRelKey] = await traceOne(root, serverRelPath, timeoutSec, killAfterSec);
  });

  return { format: 2, baseline, tests };
}

function parseCliArgs(argv) {
  const opts = { jobs: DEFAULT_JOBS, timeout: DEFAULT_TIMEOUT_SEC, killAfter: KILL_AFTER_SEC };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--files') opts.files = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--jobs') opts.jobs = Number(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--kill-after') opts.killAfter = Number(argv[++i]);
    else throw new Error(`trace-run.mjs: unrecognized argument ${a}`);
  }
  for (const req of ['repo', 'files', 'out']) {
    if (!opts[req]) throw new Error(`trace-run.mjs: --${req} is required`);
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const serverRelPaths = readFileSync(opts.files, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const records = await traceAll(opts.repo, serverRelPaths, { jobs: opts.jobs, timeoutSec: opts.timeout, killAfterSec: opts.killAfter });
  writeFileSync(opts.out, JSON.stringify(records));
  // Named for the log only; map-build decides whether a failure is news (see the header).
  for (const [file, r] of Object.entries(records.tests)) {
    if (r.unknown) process.stdout.write(`trace-run: ${file}: ${r.why}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`trace-run.mjs: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-trace-run.test.ts --maxWorkers=1
```

  Measured: `Test Files  1 passed (1)` / `Tests  12 passed (12)`, about 22 s. Post-run: no `server/.ci-tracerun-*`
  left on disk, no leftover `sleep 300` (`pgrep -af '^sleep 300$'` → nothing).

  `runTraced`'s `'exit'`/`'ignore'` choice is now pinned directly (operator's ruling X5): a unit case spawns a
  shell that backgrounds a `sleep` holding the shell's stdio and exits, and `runTraced` must resolve on the exit.
  Only BOTH halves mutated together (`stdio: 'pipe'` AND `'close'`) go red; either half alone stays green, because
  either one suffices — measured, and kept as belt and braces.

  Wall-time overhead, measured while drafting (`test/ccd-rc-flag.test.ts`, untraced vs traced with the pre-
  integration syscall list, no baseline): untraced `real 0m4.210s` (repeat `0m3.939s`), traced `real 0m7.563s` —
  ≈1.80–1.92x, inside spec §5.3's measured 1.7–4.3x.

- [ ] **Step 5: Measure the mutation table.** Each row re-measured in the integration clone (12 cases each; the
  real-run rows are bounded by the suite's own `it` timeouts):

  | Mutation | Test(s) that go red |
  |---|---|
  | Change `traceArgv`'s syscall list (drop `readlink`) | `traceArgv is exactly the pinned strace invocation` (1) |
  | `recordOf`: a non-zero exit no longer sets `why` | `a non-zero exit, a timeout, or an unresolved path -> unknown with the reason`, `the CLI records a traced test that FAILED or TIMED OUT as unknown and still exits 0…` (2) |
  | `recordOf`: a timeout no longer sets `why` | the same two, plus `records a leaked detached background process as unknown, and the runner returns` and `a baseline that fails to trace is a hard stop…` (4) |
  | `tracedEnv` without `UV_USE_IO_URING: '0'` | `tracedEnv: the exact list, CI, libuv kept off io_uring, and CCRC_TRACING marking a traced run`, `traces the baseline plus two files at jobs:2…` (2) |
  | The call site bypasses `tracedEnv` (builds the env inline, without the variable) | `traces the baseline plus two files at jobs:2…` (1 — the fixture's own assertion fails inside the traced process) |
  | `recordOf`: drop the root-trace check | `no root.pid, or a root pid with no trace file -> unknown…` (1) |
  | `tracedCommand` without the `sh -c` root-pid wrapper | `tracedCommand: strace, then a sh…`, `traces the baseline plus two files at jobs:2…`, `records a leaked detached background process…`, `the CLI records a traced test that FAILED or TIMED OUT…` (4) |
  | Drop the baseline-first hard stop (`if (baselineResult.unknown) throw`) | `a baseline that fails to trace is a hard stop for the whole run` (1 — a 0.05 s `baselineTimeoutSec` makes the baseline fail) |
  | `traceArgv` without `-ttt` / without `chdir,fchdir` | `traceArgv is exactly the pinned strace invocation` (1 each) |
  | `traceArgv` without `symlink,symlinkat` | the same, plus `traces the baseline plus two files at jobs:2: … the linked one reads through symlinks` (2) |
  | `tracedEnv` without `CCRC_TRACING: '1'` | `tracedEnv: the exact list, CI, libuv kept off io_uring, and CCRC_TRACING marking a traced run` (1) |
  | `runTraced` with `stdio: 'pipe'` AND `'close'` | `runTraced resolves when the process EXITS, even while a backgrounded descendant still holds its stdio` (1) |
  | `runTraced` with only one of the two (`'pipe'`, or `'close'`) | none — either half alone suffices; measured, kept as belt and braces |
  | `runPool` runs one lane / ignores its bound | `runPool visits every item once and never runs more than \`concurrency\` at a time` (1 each) |
  | The baseline ignores `baselineTimeoutSec` | `a baseline that fails to trace is a hard stop for the whole run` (1) |
  | `killAfterSec` ignored (always 30) | `records a leaked detached background process as unknown, and the runner returns` (1) |
  | The CLI drops `--kill-after` at its `traceAll` call | none — measured green: `killAfterSec` itself is pinned through `traceAll` (row above); the CLI flag's pass-through is not |
  | The CLI exits 3 on a failed traced test again (the M1 form) | `the CLI records a traced test that FAILED or TIMED OUT as unknown and still exits 0 — map-build decides what is red` (1) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

- [ ] **Step 7: Commit**

```bash
git add .github/ci/trace-run.mjs server/test/ci-trace-run.test.ts
git commit -F - <<'EOF'
feat(ci): per-file trace runner

.github/ci/trace-run.mjs runs the baseline test then every listed server
test file, each under its own `timeout --kill-after`-wrapped
strace/vitest invocation, with bounded concurrency (--jobs) and
CCRC_TRACING=1 in the traced environment. It always writes the records
and exits 0; a traced test that failed is recorded unknown, and whether
that is news is testmap.mjs's to say. vitest runs
through `sh -c 'echo $$ > "$0"; exec "$@"'`, so the root pid is known and
every record is split root/rest (records format 2). UV_USE_IO_URING=0
keeps Node's async fs visible to strace. A non-zero exit, timeout, a
missing root-process trace, or any unresolved relative path marks that
test's record unknown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Verdicts `.github/ci/verdict.mjs`

**Files:**
- Create: `.github/ci/verdict.mjs`
- Test: `server/test/ci-verdict.test.ts`

**Interfaces:**
- Consumes: GitHub Actions job-result strings for `select`/`server-typecheck`/`server-shard`
  (`success|failure|cancelled|skipped|''`, env `SELECT_RESULT`/`TYPECHECK_RESULT`/`SHARDS_RESULT` in `ci.yml`'s
  `test (server)` job) plus the `select` job's own `tests`/`count` outputs (Task 9, env `TESTS`/`COUNT`) and the
  triggering event (env `EVENT`); for `fullVerdict`, one `name=result` pair per job `full-suite` needs (env
  `RESULTS`, e.g. `select=success server=success …`, spec §8).
- Produces: `serverVerdict({ select, typecheck, shards, tests, count, event }) : { ok, reason }`,
  `fullVerdict(needs) : { ok, reason }`, the typedefs `JobResult`/`TestsMode`, and the CLI
  (`node .github/ci/verdict.mjs server|full`, exit 0 iff `ok`) — consumed by Task 11's `test (server)` and
  `full-suite` jobs.
- Changed in integration: the test's result tables are typed with `JobResult`/`TestsMode` (they were `string`,
  which failed the tests-inclusive typecheck).
- Changed in integration (operator's rulings T1, T2, P5): the module FAILS CLOSED — `process.exitCode = 1` at load,
  and only a `main()` that reaches an ok verdict sets 0, so a slip in the entry guard is red, not node's default 0
  (Task 11 also fronts both verdicts with a script-free step). `serverVerdict` takes `event`: `tests: 'none'` on a
  `pull_request` is red — a pull request always runs server tests. `fullVerdict` of no legs at all is red. The
  `full` CLI reads `RESULTS` pairs instead of `toJSON(needs)` (which carries every select matrix and outgrows an
  environment variable as the suite grows); an empty or malformed `RESULTS` is red.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-verdict.test.ts`:

<!-- file: server/test/ci-verdict.test.ts -->
```ts
// Task 8 (contract) — verdicts, `.github/ci/verdict.mjs` (spec §4.2's
// "the summary job is the whole safety of the required check").
//
// `serverVerdict`'s rule, in the contract's own order:
//   select ≠ success -> fail
//   tests = none -> ok
//   typecheck ≠ success -> fail
//   count = '0' -> shards must be skipped
//   count > 0 -> shards must be success
//   anything else -> fail
//
// The table below is EXHAUSTIVE over every GitHub job-result value crossed
// with every `tests`/`count` value the select job can emit, and the
// expected `ok` for each combination is computed by an ORACLE written
// independently of `serverVerdict`'s own source (transcribed straight from
// the six-line rule above, not by importing or calling the function under
// test) — a control derived from the same measurement it checks would be
// tautological.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { serverVerdict, fullVerdict } from '../../.github/ci/verdict.mjs';
import type { JobResult, TestsMode } from '../../.github/ci/verdict.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const RESULTS: JobResult[] = ['success', 'failure', 'cancelled', 'skipped', ''];
const TESTS: TestsMode[] = ['selected', 'full', 'none', ''];
const COUNTS: Array<'0' | '3' | ''> = ['0', '3', ''];
const EVENTS = ['pull_request', 'push'];

/** Independent oracle, transcribed from the contract's own prose (not from
 *  verdict.mjs), plus the operator's ruling that a pull request always runs
 *  server tests. Returns only the boolean the table asserts. */
function expectedOk({ select, typecheck, shards, tests, count, event }: {
  select: string; typecheck: string; shards: string; tests: string; count: string; event: string;
}): boolean {
  if (select !== 'success') return false;
  if (tests === 'none') return event !== 'pull_request';
  if (typecheck !== 'success') return false;
  if (count === '0') return shards === 'skipped';
  if (count === '3') return shards === 'success'; // "count > 0"
  return false; // anything else (count === '') -> fail
}

describe('serverVerdict — exhaustive table', () => {
  const cases: Array<{ select: JobResult; typecheck: JobResult; shards: JobResult; tests: TestsMode; count: string; event: string }> = [];
  for (const select of RESULTS) {
    for (const typecheck of RESULTS) {
      for (const shards of RESULTS) {
        for (const tests of TESTS) {
          for (const count of COUNTS) {
            for (const event of EVENTS) cases.push({ select, typecheck, shards, tests, count, event });
          }
        }
      }
    }
  }

  it(`covers every combination (${RESULTS.length}^3 x ${TESTS.length} x ${COUNTS.length} x ${EVENTS.length} = ${cases.length})`, () => {
    expect(cases.length).toBe(RESULTS.length ** 3 * TESTS.length * COUNTS.length * EVENTS.length);
  });

  it.each(cases)(
    'select=$select typecheck=$typecheck shards=$shards tests=$tests count=$count event=$event',
    (c) => {
      const want = expectedOk(c);
      const got = serverVerdict(c);
      expect(got.ok, `reason: ${got.reason}`).toBe(want);
      expect(typeof got.reason).toBe('string');
      expect(got.reason.length).toBeGreaterThan(0);
    },
  );
});

describe('serverVerdict — the named scenarios from the plan brief', () => {
  it('select cancelled -> red, no matter what else is green', () => {
    const v = serverVerdict({
      select: 'cancelled', typecheck: 'success', shards: 'success', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(false);
  });

  it('shards skipped with count > 0 -> red (the silent-green trap)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(false);
  });

  it('tests none -> green, even if typecheck/shards never ran (a refresh, a skipped daily run)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'push',
    });
    expect(v.ok).toBe(true);
  });

  it('tests none on a pull_request -> red: a pull request always runs server tests (ruling T2)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'pull_request',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('pull_request') });
  });

  it('the ordinary green path: count 3, shards success', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'success', tests: 'selected', count: '3',
    });
    expect(v.ok).toBe(true);
  });

  it('the ordinary empty-selection green path: count 0, shards skipped', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'skipped', tests: 'full', count: '0',
    });
    expect(v.ok).toBe(true);
  });

  it('count 0 but shards actually ran (success) -> red, not a bonus green', () => {
    const v = serverVerdict({
      select: 'success', typecheck: 'success', shards: 'success', tests: 'selected', count: '0',
    });
    expect(v.ok).toBe(false);
  });
});

describe('fullVerdict', () => {
  it('every result success -> ok', () => {
    const v = fullVerdict({
      'server-shard-1': { result: 'success' },
      'server-typecheck': { result: 'success' },
      'test-agent': { result: 'success' },
      'test-pwa': { result: 'success' },
      'build-pwa': { result: 'success' },
      'test-macos-1': { result: 'success' },
    });
    expect(v.ok).toBe(true);
  });

  it('one skipped -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' },
      b: { result: 'skipped' },
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('b');
  });

  it('one cancelled -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' },
      b: { result: 'cancelled' },
    });
    expect(v.ok).toBe(false);
  });

  it('one failure among many successes -> red', () => {
    const v = fullVerdict({
      a: { result: 'success' }, b: { result: 'success' }, c: { result: 'failure' },
    });
    expect(v.ok).toBe(false);
  });

  it('no legs at all -> red: a verdict over nothing proves nothing', () => {
    const v = fullVerdict({});
    expect(v.ok).toBe(false);
  });
});

describe('the CLI', () => {
  const cliPath = path.join(repoRoot, '.github', 'ci', 'verdict.mjs');

  function runServer(env: Record<string, string>) {
    try {
      const out = execFileSync(process.argv0, [cliPath, 'server'], {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { status: err.status, out: err.stdout };
    }
  }

  it('exits 0 and prints the reason on a green server verdict', () => {
    const { status, out } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'success',
      TESTS: 'selected', COUNT: '3', EVENT: 'pull_request',
    });
    expect(status).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it('reads EVENT: tests none on a pull_request exits non-zero', () => {
    const { status } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: '', SHARDS_RESULT: '', TESTS: 'none', COUNT: '', EVENT: 'pull_request',
    });
    expect(status).not.toBe(0);
    expect(runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: '', SHARDS_RESULT: '', TESTS: 'none', COUNT: '', EVENT: 'push',
    }).status).toBe(0);
  });

  it('fails CLOSED: loaded without its entry guard matching (main never runs), it exits 1, not 0', () => {
    // A slip in the entry guard would make `node verdict.mjs server` do nothing; the exit code must not then
    // be node's default 0, which every required check would read as green.
    const dir = mkTmp('ccrc-verdict-noop-');
    const wrapper = path.join(dir, 'wrapper.mjs');
    writeFileSync(wrapper, `import ${JSON.stringify(pathToFileURL(cliPath).href)};\n`);
    const r = spawnSync(process.execPath, [wrapper], { encoding: 'utf8' });
    expect(r.stdout).toBe('');
    expect(r.status).toBe(1);
  });

  it('exits non-zero on a red server verdict (select cancelled)', () => {
    const { status } = runServer({
      SELECT_RESULT: 'cancelled', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'success',
      TESTS: 'selected', COUNT: '3',
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero on the silent-green trap (shards skipped, count 3)', () => {
    const { status } = runServer({
      SELECT_RESULT: 'success', TYPECHECK_RESULT: 'success', SHARDS_RESULT: 'skipped',
      TESTS: 'selected', COUNT: '3',
    });
    expect(status).not.toBe(0);
  });

  // `full` reads RESULTS, `name=result` pairs — not toJSON(needs), which carries every select matrix and
  // outgrows an environment string's 128 KB as the suite grows (measured 110 KB with no durations).
  function runFull(results: string | undefined) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.RESULTS;
    if (results !== undefined) env.RESULTS = results;
    return spawnSync(process.argv0, [cliPath, 'full'], { cwd: repoRoot, env, encoding: 'utf8' });
  }

  it('full subcommand: exits 0 when every RESULTS pair is success', () => {
    const r = runFull('select=success server=success test-macos=success');
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it('full subcommand: exits non-zero when one result is not success, when RESULTS is empty or absent, or malformed', () => {
    expect(runFull('select=success test-macos=failure').status).not.toBe(0);
    expect(runFull('').status).not.toBe(0);
    expect(runFull(undefined).status).not.toBe(0);
    expect(runFull('select=success nonsense').status).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-verdict.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/verdict.mjs' imported from …/server/test/ci-verdict.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/verdict.mjs` with exactly this content:

<!-- file: .github/ci/verdict.mjs -->
```js
// Verdicts (spec §4.2, contract Task 8).
//
// GitHub reports a job SKIPPED BY A CONDITIONAL as Success, and a job whose
// `needs:` failed is itself skipped — so a required "summary" job written
// the obvious way (just checking its own steps) turns a crashed selector or
// a silently-skipped shard run into a green required check. `serverVerdict`
// is the one place `test (server)` (spec §4.2) computes whether that
// actually happened; `fullVerdict` is `full-suite` (spec §8)'s equivalent
// for the daily/stable-gate run, where every leg must have actually
// succeeded.
//
// FAILS CLOSED: the exit code is 1 from the moment this module loads, and
// only a `main()` that reaches an ok verdict sets 0 — so a slip that stops
// `main()` running at all (the entry guard, say) is red, not node's default
// 0, which every required check would have read as green. ci.yml also puts
// a script-free guard step in front of both verdicts that can only add red.

import { pathToFileURL } from 'node:url';

process.exitCode = 1;

/**
 * @typedef {'success'|'failure'|'cancelled'|'skipped'|''} JobResult
 * @typedef {'selected'|'full'|'none'|''} TestsMode
 */

/**
 * `test (server)`'s verdict (spec §4.2). Order matters — it is the order
 * the contract states the rule in, and `tests === 'none'` deliberately
 * short-circuits BEFORE the typecheck check: a `none` selection (the daily
 * schedule's "already green" short-circuit, spec §3) skips typecheck too,
 * so checking it there would read a `skipped` as a failure. A pull request
 * can never answer `none` (it always runs server tests — ruling T2), so
 * `none` with `event === 'pull_request'` is red; the event comes from the
 * workflow's own context, not from select's outputs.
 *
 * Rules:
 *   1. `select` did not succeed -> fail.
 *   2. `tests === 'none'` -> ok (nothing was supposed to run) — except on a
 *      `pull_request`, which fails.
 *   3. `typecheck` did not succeed -> fail.
 *   4. `count === '0'` -> ok iff `shards` is `skipped` (nothing was
 *      supposed to run there either — anything else, including `success`,
 *      is a discrepancy between what `select` promised and what ran).
 *   5. any other `count` (an actual file count, e.g. `'3'`) -> ok iff
 *      `shards` is `success`. This is the "silent-green trap" spec §4.2
 *      names: a `skipped` shard run with a non-zero count must NOT read
 *      as ok, or a crashed/never-scheduled `server-shard` job would pass
 *      silently.
 *   6. anything else (an unrecognised `count`, e.g. `''`) -> fail.
 *
 * @param {{ select: JobResult, typecheck: JobResult, shards: JobResult, tests: TestsMode, count: string, event?: string }} inputs
 * @returns {{ ok: boolean, reason: string }}
 */
export function serverVerdict({ select, typecheck, shards, tests, count, event }) {
  if (select !== 'success') {
    return { ok: false, reason: `select: ${select || '(did not run)'}` };
  }
  if (tests === 'none') {
    return event === 'pull_request'
      ? { ok: false, reason: 'tests: none on a pull_request — a pull request always runs server tests' }
      : { ok: true, reason: 'tests: none — nothing was selected to run' };
  }
  if (typecheck !== 'success') {
    return { ok: false, reason: `typecheck: ${typecheck || '(did not run)'}` };
  }
  if (count === '0') {
    return shards === 'skipped'
      ? { ok: true, reason: 'count: 0, shards: skipped — nothing selected' }
      : { ok: false, reason: `count: 0 but shards: ${shards || '(did not run)'} (expected skipped)` };
  }
  const n = Number(count);
  if (count !== '' && Number.isInteger(n) && n > 0) {
    return shards === 'success'
      ? { ok: true, reason: `count: ${count}, shards: success` }
      : { ok: false, reason: `count: ${count} but shards: ${shards || '(did not run)'} (expected success)` };
  }
  return { ok: false, reason: `unrecognised count: ${JSON.stringify(count)}` };
}

/**
 * `full-suite`'s verdict (spec §8): green iff every leg is green.
 *
 * @param {Record<string, { result: string }>} needs
 * @returns {{ ok: boolean, reason: string }}
 */
export function fullVerdict(needs) {
  if (Object.keys(needs).length === 0) return { ok: false, reason: 'no legs to judge — a verdict over nothing proves nothing' };
  const notOk = Object.entries(needs).filter(([, v]) => v.result !== 'success');
  if (notOk.length === 0) return { ok: true, reason: 'every leg succeeded' };
  return {
    ok: false,
    reason: `not green: ${notOk.map(([name, v]) => `${name}=${v.result}`).join(', ')}`,
  };
}

function main() {
  const [sub] = process.argv.slice(2);
  let verdict;
  if (sub === 'server') {
    verdict = serverVerdict({
      select: /** @type {JobResult} */ (process.env.SELECT_RESULT ?? ''),
      typecheck: /** @type {JobResult} */ (process.env.TYPECHECK_RESULT ?? ''),
      shards: /** @type {JobResult} */ (process.env.SHARDS_RESULT ?? ''),
      tests: /** @type {TestsMode} */ (process.env.TESTS ?? ''),
      count: process.env.COUNT ?? '',
      event: process.env.EVENT ?? '',
    });
  } else if (sub === 'full') {
    // RESULTS: `name=result` pairs, one per job full-suite needs — only the
    // results, never toJSON(needs), which carries every select matrix.
    /** @type {Record<string, { result: string }>} */
    const needs = {};
    let malformed = '';
    for (const pair of (process.env.RESULTS ?? '').split(/\s+/).filter(Boolean)) {
      const m = /^([\w-]+)=(\w*)$/.exec(pair);
      if (m) needs[m[1]] = { result: m[2] };
      else malformed = pair;
    }
    verdict = malformed ? { ok: false, reason: `RESULTS has a malformed pair: ${malformed}` } : fullVerdict(needs);
  } else {
    process.stderr.write('usage: node verdict.mjs server|full\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(verdict.reason + '\n');
  process.exitCode = verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-verdict.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  3020 passed (3020)` (3000 exhaustive-table cases — 5 results ×
  5 × 5 × 4 `tests` × 3 counts × 2 events — + 1 coverage count + 7 named scenarios + 5 `fullVerdict` cases + 7 CLI
  cases).

- [ ] **Step 5: Measure the mutation table** (mutate → run Step 4's command → restore; re-measured red in the
  integration clone, reverted and reconfirmed green at 3020/3020):

  | # | Mutation | Test(s) that go RED |
  |---|---|---|
  | A | Drop the `select !== 'success'` check entirely | 350: 348 exhaustive cases whose `select` is not `success`, `select cancelled -> red…` and the CLI's `exits non-zero on a red server verdict (select cancelled)` |
  | B | Move the `tests === 'none'` short-circuit to AFTER the `typecheck` check | 63: the 60 exhaustive non-pull-request `tests === 'none'` cases whose `select` succeeded and whose `typecheck` did not, plus `tests none -> green, even if typecheck/shards never ran`, `tests none on a pull_request -> red…` and the CLI's `reads EVENT…` |
  | C | The silent-green trap itself: accept `shards === 'skipped'` as ok in the `count > 0` branch | 8, incl. `shards skipped with count > 0 -> red (the silent-green trap)` and `exits non-zero on the silent-green trap` (CLI) |
  | D | The `count === '0'` branch accepts `shards === 'success'` too | 7, incl. `count 0 but shards actually ran (success) -> red, not a bonus green` |
  | E | `fullVerdict` treats `'skipped'` as success | `one skipped -> red` (1) |
  | F | Break the entry guard (`.href` → `.pathname`: `main()` never runs) | 3 CLI cases that expect exit 0 or a printed reason — and the fail-closed default keeps every red one red |
  | G | Drop the fail-closed default (`process.exitCode = 1` at load) | `fails CLOSED: loaded without its entry guard matching (main never runs), it exits 1, not 0` (1) |
  | H | `tests: 'none'` green on a `pull_request` too | 77: the 75 exhaustive `pull_request` + `tests none` cases whose select succeeded, the named `tests none on a pull_request -> red…`, and the CLI's `reads EVENT…` |
  | I | The CLI does not pass `EVENT` | `reads EVENT: tests none on a pull_request exits non-zero` (1) |
  | J | `fullVerdict` of no legs is ok | `no legs at all -> red…`, and the CLI's empty-`RESULTS` case (2) |
  | K | A malformed `RESULTS` pair ignored | `full subcommand: exits non-zero when one result is not success, when RESULTS is empty or absent, or malformed` (1) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

- [ ] **Step 7: Commit**

```bash
git add .github/ci/verdict.mjs server/test/ci-verdict.test.ts
git commit -F - <<'EOF'
feat(ci): required-check verdicts (spec §4.2, §8)

serverVerdict computes test (server)'s actual pass/fail from its needs'
job results plus the select job's tests/count outputs, closing the
"skipped reads as success" and "shards skipped with a nonzero count"
holes spec §4.2 names. fullVerdict is full-suite's green-iff-everything-
succeeded check (spec §8). Both ship a CLI reading GitHub Actions env
vars (full-suite's as one name=result pair per need), exit 0 iff ok,
and fail closed: the CLI sets exit code 1 before it decides anything. A
pull request whose select answered tests=none is red. Exhaustive table test over every
select/typecheck/shards job-result x tests x count combination, checked
against an oracle transcribed independently from the contract's rule.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


### Task 9: Select CLI `.github/ci/select.mjs`

**Files:**
- Create: `.github/ci/select.mjs`
- Test: `server/test/ci-select-cli.test.ts`

**Interfaces:**
- Consumes: `readMap(file)` from Task 4; `readChanges(repoDir, fromSha, toRef)`, `liveTestFiles(repoDir, ref)`,
  `gitExistsAt(repoDir)`, `selectTests({map, changes, liveTests, existsAt})` from Task 5;
  `planShards(files, durations, profile)`, `toMatrix(plan)`, `PROFILES` from Task 6.
- Produces: `export function decideMode({ event, inputMode, fullGreen }) : { tests: 'selected'|'full'|'none',
  trace: 'none'|'refresh'|'rebuild', skip: boolean }` (the contract's exact truth table). CLI
  `node .github/ci/select.mjs --repo DIR --event E [--input-mode M] --selection shadow|enforce --full-green
  true|false [--map FILE] [--times FILE] [--trace-list FILE]`, writing to `$GITHUB_OUTPUT` (stdout when unset):
  `tests`, `trace`, `shadow`, `count`, `macos_count`, `server_matrix`, `macos_matrix`, `trace_matrix` (each
  one-line `toMatrix` JSON), `trace_count`, `map_sha`, `fallback`; the trace list to `--trace-list` (repo-relative,
  one per line, parent directory created); and a markdown reason table to `$GITHUB_STEP_SUMMARY` when set.
- Changed in integration (the trace plan): the TRACE matrix is planned with `times ?? {}` — an empty table is
  "durations present" (Task 6), so it is always LPT, a real partition with no `vitest_shard` — because
  `trace-run.mjs` takes an exact list and has no `--shard`; before, with no durations every trace shard got EVERY
  file plus an `i/n`, and Task 11 split it with `awk`. New output `trace_count` (files across the trace matrix),
  which Task 11 guards `trace-shard` and `map-build` on instead of comparing the matrix string.
- Changed in integration (a lost trace): `--trace-list FILE` writes the list this run MEANT to trace, which Task
  11 hands to `testmap.mjs refresh --traced` (Task 4).
- Changed in integration (refusals): a live-test list that cannot be read, that is EMPTY, or that holds a path with
  whitespace is refused — exit non-zero, no outputs, so the `select` job fails and `test (server)` goes red.
  Before, an unreadable list folded to `[]`: `tests: full, count: 0` skipped every shard, and Task 8's verdict
  reads a skip with count 0 as a pass — a green `test (server)` that ran nothing (the test that pinned this called
  it "never silent"). A spaced path would have been split by the space-joined matrix into two filters that match
  nothing.
- Changed in integration (no map): by the operator's ruling, the fallback when no map was restored says so and
  names the path it looked at — `map: no map restored at <path>` (`--map` given, file absent; Task 11 always passes
  `.ci-cache/testmap.json`) or `map: no map restored (select.mjs was given no --map)` — instead of
  `map: unreadable: ENOENT: …, open ''`. A map file that exists but cannot be read keeps readMap's reason; that
  path lost its only pin when the missing-file case stopped reaching `readMap` (measured: the forged-success
  mutation went green), so a corrupt-map case now pins it.
- Changed in integration (release-stable's call): `decideMode` for `push` WITH `inputMode: 'full'` (a called
  ci.yml sees the caller's event, a push to `stable`) is pinned to `full`/`none`, directly and through the CLI;
  the CLI with `--input-mode` omitted on a push is the refresh case.
- Changed in integration (operator's rulings T2-T4, P3): `decideMode` answers `full` for a `pull_request` given
  `--input-mode full` — Task 11's plain-bash step passes it when the pull request changes `.github/`. Before
  writing anything the CLI asserts the mode invariants (`export function modeInvariantViolation(event, inputMode,
  tests)`): a `pull_request` never answers `tests: none`, and a `schedule`, a plain `push` or a `rebuild` never
  answers `tests: selected` — a violation throws, so `select` fails and every verdict goes red. That call site is
  shown only by a PAIRED mutation (make `decideMode` answer `none` for a pull request: with the check, exit 1;
  without it, exit 0 with `tests=none count=0`), since no correct `decideMode` can reach it. A map is used only if
  its commit is an ancestor of `HEAD` (`git merge-base --is-ancestor`) — `map: <sha> is not an ancestor of HEAD`
  otherwise, a full run. The macOS budget follows the EVENT: a `pull_request` always plans with `macosSelected`
  (at most 2 shards), even when it fell back to `full`, since the organisation's macOS slots are shared with every
  other pull request; 4 only for a scheduled, dispatched or called full run. (A pull request's full fallback on 2
  macOS shards may run long; `test-macos` is advisory on pull requests.)
- Changed in integration (operator's ruling R4): the reason table names each rule beside its number (Task 5's
  `RULE_NAMES`): `| 3 READ | … |`, and `| 6 SUBTREE | … |` for a test selected because a change sits under a
  directory it linked whole.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-select-cli.test.ts`:

<!-- file: server/test/ci-select-cli.test.ts -->
```ts
// The select job's CLI (`.github/ci/select.mjs`, spec §3-§4 and §6, CONTRACT.md
// Task 9). Every scenario here runs the CLI as a real child process against a
// fixture git repo, a fixture `TestMap`, and (for `decideMode` alone) a direct
// import — matching every OTHER `.github/ci/*.mjs` module's test convention of
// importing relatively with `allowJs` (CONTRACT.md "Conventions"). `GITHUB_OUTPUT`
// and `GITHUB_STEP_SUMMARY` point at temp files per CONTRACT.md's own wiring
// section, never at the real Actions environment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideMode, modeInvariantViolation } from '../../.github/ci/select.mjs';
import { mkTmp } from './tmpHelpers.js';

const SELECT_MJS = path.resolve(__dirname, '../../.github/ci/select.mjs');

// Same fixture-git-identity idiom as build-release.test.ts / release-main.test.ts
// / ccrc-install.test.ts (grep 'GIT_AUTHOR_EMAIL' server/test/*.ts): an
// `@example.invalid` address, never a real one — topology-clean forbids a real
// `user@host` token in committed text, and this file's own literals are read by
// that guard too.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
}

function writeFile(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(repo: string, message: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function initRepo(): string {
  const repo = mkTmp('ccrc-ci-select-repo-');
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  return repo;
}

type DepRecordFixture = { read?: string[]; probed?: string[]; listed?: string[]; subtree?: string[]; git?: boolean };

function depRecord(opts: DepRecordFixture = {}) {
  return { read: opts.read ?? [], probed: opts.probed ?? [], listed: opts.listed ?? [], subtree: opts.subtree ?? [], git: !!opts.git };
}

function testRecord(opts: DepRecordFixture & { unknown?: boolean } = {}) {
  return { ...depRecord(opts), unknown: !!opts.unknown };
}

function writeMapFile(repo: string, map: unknown): string {
  const file = path.join(repo, 'testmap.json');
  writeFileSync(file, JSON.stringify(map));
  return file;
}

/** Base commit: package.json, two src files, four server test files. Map
 *  records: `a` READS `src/foo.ts` (rule 3), `b` PROBES `src/newfile.ts`
 *  (rule 4), `c` is `git: true` (rule 2, always), `d` reads/probes/lists
 *  nothing (never selected — the file that makes shadow vs. enforce
 *  observable). HEAD then modifies `foo.ts` and adds `newfile.ts`, touching
 *  neither `package.json` nor anything under `.github/`, so no full trigger
 *  fires — the selection below is a real per-rule one, not a fallback. */
function buildMainFixture() {
  const repo = initRepo();
  writeFile(repo, 'package.json', '{"name":"x"}\n');
  writeFile(repo, 'src/foo.ts', 'export const foo = 1;\n');
  writeFile(repo, 'src/bar.ts', 'export const bar = 1;\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  writeFile(repo, 'server/test/b.test.ts', "it('b', () => {});\n");
  writeFile(repo, 'server/test/c.test.ts', "it('c', () => {});\n");
  writeFile(repo, 'server/test/d.test.ts', "it('d', () => {});\n");
  const baseSha = commitAll(repo, 'base');

  const map = {
    format: 1,
    sha: baseSha,
    baseline: depRecord(),
    tests: {
      'server/test/a.test.ts': testRecord({ read: ['src/foo.ts'] }),
      'server/test/b.test.ts': testRecord({ probed: ['src/newfile.ts'] }),
      'server/test/c.test.ts': testRecord({ git: true }),
      'server/test/d.test.ts': testRecord({}),
    },
  };
  const mapFile = writeMapFile(repo, map);

  writeFile(repo, 'src/foo.ts', 'export const foo = 2;\n');
  writeFile(repo, 'src/newfile.ts', 'export const n = 1;\n');
  const headSha = commitAll(repo, 'head');

  return { repo, mapFile, baseSha, headSha };
}

/** A second base commit whose HEAD instead bumps `package.json` — the full
 *  trigger of spec §6.3 / CONTRACT.md's `fullTrigger`, which must fire before
 *  any per-file rule is even consulted. */
function buildFullTriggerFixture() {
  const repo = initRepo();
  writeFile(repo, 'package.json', '{"name":"x"}\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  const baseSha = commitAll(repo, 'base');
  const map = {
    format: 1,
    sha: baseSha,
    baseline: depRecord(),
    tests: { 'server/test/a.test.ts': testRecord({}) },
  };
  const mapFile = writeMapFile(repo, map);
  writeFile(repo, 'package.json', '{"name":"x","version":"2"}\n');
  commitAll(repo, 'bump package.json');
  return { repo, mapFile };
}

/** Parses the `name<<DELIM` / value-lines / `DELIM` records `select.mjs`
 *  writes to `$GITHUB_OUTPUT` (GitHub Actions' own multiline-safe format —
 *  load-bearing here because the JSON matrices and free-text fallback
 *  reasons this CLI writes are exactly the values that format exists for). */
function parseGithubOutput(text: string): Record<string, string> {
  const lines = text.split('\n');
  const out: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const m = /^([A-Za-z0-9_]+)<<(.+)$/.exec(lines[i]);
    if (!m) { i++; continue; }
    const [, key, delim] = m;
    i++;
    const valueLines: string[] = [];
    while (i < lines.length && lines[i] !== delim) { valueLines.push(lines[i]); i++; }
    out[key] = valueLines.join('\n');
    i++;
  }
  return out;
}

type RunOpts = { event: string; inputMode?: string; selection?: 'shadow' | 'enforce'; fullGreen?: 'true' | 'false'; mapFile?: string; timesFile?: string; traceList?: string };

function runSelect(repo: string, opts: RunOpts) {
  const io = mkTmp('ccrc-ci-select-io-');
  const outputFile = path.join(io, 'output.txt');
  const summaryFile = path.join(io, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');

  const args = [
    SELECT_MJS,
    '--repo', repo,
    '--event', opts.event,
    '--selection', opts.selection ?? 'enforce',
    '--full-green', opts.fullGreen ?? 'false',
  ];
  if (opts.inputMode) args.push('--input-mode', opts.inputMode);
  if (opts.mapFile) args.push('--map', opts.mapFile);
  if (opts.timesFile) args.push('--times', opts.timesFile);
  if (opts.traceList) args.push('--trace-list', opts.traceList);

  let status = 0;
  let stderr = '';
  try {
    execFileSync('node', args, {
      env: { ...process.env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile },
      encoding: 'utf8',
    });
  } catch (e) {
    status = (e as { status?: number }).status ?? 1;
    stderr = String((e as { stderr?: Buffer | string }).stderr ?? '');
  }

  const outputs = parseGithubOutput(readFileSync(outputFile, 'utf8'));
  const summary = readFileSync(summaryFile, 'utf8');
  return { status, stderr, outputs, summary };
}

/** The distinct SERVER-relative files named across a `toMatrix` JSON string's
 *  `include[].files` (space-joined) — used to check `count`/`macos_count`
 *  against what the matrix actually carries, independent of how many shards
 *  repeat a file (the `durations === null` hash-shard fallback gives every
 *  shard ALL files, so summing shard sizes would over-count). */
function uniqueFilesInMatrix(matrixJson: string): Set<string> {
  const parsed = JSON.parse(matrixJson) as { include: Array<{ files: string }> };
  const set = new Set<string>();
  for (const row of parsed.include) {
    for (const f of row.files.split(' ').filter(Boolean)) set.add(f);
  }
  return set;
}

function expectValidMatrix(matrixJson: string): void {
  expect(matrixJson.includes('\n')).toBe(false);
  const parsed = JSON.parse(matrixJson);
  expect(Array.isArray(parsed.include)).toBe(true);
}

describe('decideMode', () => {
  it('pull_request -> selected/none', () => {
    expect(decideMode({ event: 'pull_request', fullGreen: false })).toEqual({ tests: 'selected', trace: 'none', skip: false });
  });

  it('push with no inputMode -> none/refresh', () => {
    expect(decideMode({ event: 'push', fullGreen: false })).toEqual({ tests: 'none', trace: 'refresh', skip: false });
  });

  it('push WITH an inputMode does not take the refresh branch (falls through to the inputMode rules)', () => {
    expect(decideMode({ event: 'push', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('schedule, full-green true -> none/none/skip', () => {
    expect(decideMode({ event: 'schedule', fullGreen: true })).toEqual({ tests: 'none', trace: 'none', skip: true });
  });

  it('schedule, full-green false -> full/rebuild', () => {
    expect(decideMode({ event: 'schedule', fullGreen: false })).toEqual({ tests: 'full', trace: 'rebuild', skip: false });
  });

  it("inputMode 'full' -> full/none", () => {
    expect(decideMode({ event: 'workflow_dispatch', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it("inputMode 'rebuild' -> none/rebuild", () => {
    expect(decideMode({ event: 'workflow_dispatch', inputMode: 'rebuild', fullGreen: false }))
      .toEqual({ tests: 'none', trace: 'rebuild', skip: false });
  });

  it("push WITH inputMode 'full' (release-stable's workflow_call: the caller's event is a push to stable) -> full/none", () => {
    expect(decideMode({ event: 'push', inputMode: 'full', fullGreen: true }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('workflow_call with mode full -> full/none, same as workflow_dispatch', () => {
    expect(decideMode({ event: 'workflow_call', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it("pull_request WITH inputMode 'full' (its own pipeline changed — ci.yml's plain-bash check) -> full/none", () => {
    expect(decideMode({ event: 'pull_request', inputMode: 'full', fullGreen: false }))
      .toEqual({ tests: 'full', trace: 'none', skip: false });
  });

  it('anything else (no matching event, no inputMode) -> full/none', () => {
    expect(decideMode({ event: 'workflow_dispatch', fullGreen: false })).toEqual({ tests: 'full', trace: 'none', skip: false });
  });
});

describe('modeInvariantViolation: what a trigger can never answer (ruling T2)', () => {
  it('a pull_request never answers tests none', () => {
    expect(modeInvariantViolation('pull_request', undefined, 'none')).toMatch(/pull_request/);
    expect(modeInvariantViolation('pull_request', undefined, 'selected')).toBeNull();
    expect(modeInvariantViolation('pull_request', 'full', 'full')).toBeNull();
  });

  it('a schedule, a refresh push and a rebuild never answer tests selected', () => {
    expect(modeInvariantViolation('schedule', undefined, 'selected')).toMatch(/schedule/);
    expect(modeInvariantViolation('push', undefined, 'selected')).toMatch(/push/);
    expect(modeInvariantViolation('workflow_dispatch', 'rebuild', 'selected')).toMatch(/rebuild/);
    expect(modeInvariantViolation('schedule', undefined, 'full')).toBeNull();
    expect(modeInvariantViolation('push', undefined, 'none')).toBeNull();
    expect(modeInvariantViolation('push', 'full', 'full')).toBeNull();
  });
});

describe('select.mjs CLI — pull_request', () => {
  it('enforce: selects exactly the rule-3/4/2 files, table carries the reasons, matrices carry only the selection', () => {
    const { repo, mapFile, baseSha } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'enforce', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(outputs.trace).toBe('none');
    expect(outputs.shadow).toBe('false');
    expect(outputs.fallback).toBe('');
    expect(outputs.map_sha).toBe(baseSha);

    expectValidMatrix(outputs.server_matrix);
    expectValidMatrix(outputs.macos_matrix);
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts']));
    expect(outputs.count).toBe('3');
    expect(outputs.macos_count).toBe('3');
    expect(uniqueFilesInMatrix(outputs.macos_matrix).size).toBe(Number(outputs.macos_count));

    expect(summary).toContain('| rule | test | changed path |');
    expect(summary).toContain('| 3 READ | `server/test/a.test.ts` | `src/foo.ts` |');
    expect(summary).toContain('| 4 PROBED | `server/test/b.test.ts` | `src/newfile.ts` |');
    expect(summary).toContain('| 2 ALWAYS | `server/test/c.test.ts` |');
    expect(summary).not.toContain('server/test/d.test.ts');
  });

  it('a directory a test linked whole: a change under it selects the test, and the table names rule 6 SUBTREE', () => {
    const repo = initRepo();
    writeFile(repo, 'lib/linked.sh', 'echo 1\n');
    writeFile(repo, 'server/test/linker.test.ts', "it('l', () => {});\n");
    writeFile(repo, 'server/test/other.test.ts', "it('o', () => {});\n");
    const baseSha = commitAll(repo, 'base');
    const mapFile = writeMapFile(repo, {
      format: 1, sha: baseSha, baseline: depRecord(),
      tests: {
        'server/test/linker.test.ts': testRecord({ subtree: ['lib'] }),
        'server/test/other.test.ts': testRecord({ read: ['src/other.ts'] }),
      },
    });
    writeFile(repo, 'lib/linked.sh', 'echo 2\n');
    commitAll(repo, 'change a file under the linked directory');
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'enforce', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(uniqueFilesInMatrix(outputs.server_matrix)).toEqual(new Set(['test/linker.test.ts']));
    expect(summary).toContain('| 6 SUBTREE | `server/test/linker.test.ts` | `lib/linked.sh` |');
  });

  it('shadow: table shows the SAME would-be selection, but the matrices carry ALL live tests and shadow=true', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', selection: 'shadow', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('selected');
    expect(outputs.shadow).toBe('true');

    // The reason table is still the real, narrow selection (would-be), not
    // the broadened shadow file list.
    expect(summary).toContain('server/test/a.test.ts');
    expect(summary).toContain('server/test/b.test.ts');
    expect(summary).toContain('server/test/c.test.ts');

    // But the matrices — what actually runs in shadow mode — carry every
    // live test, including `d`, which no rule selected.
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
    expect(outputs.count).toBe('4');
    expect(outputs.macos_count).toBe('4');
  });

  it('missing map -> full, non-empty fallback, matrices carry every live test', () => {
    const { repo } = buildMainFixture();
    const missingMap = path.join(repo, 'does-not-exist.json');
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile: missingMap });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    // Says what happened and where it looked — ci.yml always passes the fetch
    // path, so "no map restored" is the ordinary first-run answer, not an error.
    expect(outputs.fallback).toBe(`map: no map restored at ${missingMap}`);
    expect(outputs.map_sha).toBe('');
    const files = uniqueFilesInMatrix(outputs.server_matrix);
    expect(files).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
    expect(outputs.count).toBe('4');
  });

  it('a map file that exists but cannot be read (invalid JSON) -> full, the fallback names the read error', () => {
    // The file-exists path reaches readMap; a corrupt map must fall back to
    // full, never be taken as an empty selection.
    const { repo } = buildMainFixture();
    const corrupt = path.join(repo, 'corrupt-map.json');
    writeFileSync(corrupt, '{not json');
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile: corrupt });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toMatch(/^map: invalid JSON: /);
    expect(outputs.count).toBe('4');
  });

  it('no --map at all -> full, and the fallback says no map was given', () => {
    const { repo } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'pull_request' });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toBe('map: no map restored (select.mjs was given no --map)');
  });

  it('map whose commit is not in the checkout -> full, non-empty fallback', () => {
    const { repo } = buildMainFixture();
    const fakeSha = 'a'.repeat(40);
    const mapFile = writeMapFile(repo, { format: 1, sha: fakeSha, baseline: depRecord(), tests: {} });
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback.length).toBeGreaterThan(0);
    expect(outputs.map_sha).toBe('');
  });

  it('live tests that cannot be listed (a broken --repo) -> exits non-zero and writes no outputs', () => {
    // Not `full` with an empty list: `tests: full, count: 0` skips every
    // shard, and verdict.mjs reads a skip with count 0 as a pass — a green
    // `test (server)` that ran nothing. A select that fails makes it red.
    const { mapFile } = buildMainFixture();
    const badRepoHolder = mkTmp('ccrc-ci-select-badrepo-');
    const notADirectory = path.join(badRepoHolder, 'this-is-a-file.txt');
    writeFileSync(notADirectory, 'not a directory\n');

    const { status, stderr, outputs } = runSelect(notADirectory, { event: 'pull_request', mapFile });

    expect(status).not.toBe(0);
    expect(stderr).toContain('cannot list the live server tests');
    expect(outputs).toEqual({});
  });

  it('a tree with no server test files at all -> exits non-zero (never a zero-test full run)', () => {
    const repo = initRepo();
    writeFile(repo, 'package.json', '{"name":"x"}\n');
    commitAll(repo, 'no tests');
    const { status, stderr, outputs } = runSelect(repo, { event: 'schedule' });
    expect(status).not.toBe(0);
    expect(stderr).toContain('no live server test files');
    expect(outputs).toEqual({});
  });

  it('a live test path with whitespace -> exits non-zero: a space-joined matrix would split it into two wrong filters', () => {
    const repo = initRepo();
    writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
    writeFile(repo, 'server/test/has space.test.ts', "it('s', () => {});\n");
    commitAll(repo, 'a spaced test file');
    const { status, stderr, outputs } = runSelect(repo, { event: 'pull_request' });
    expect(status).not.toBe(0);
    expect(stderr).toContain('server/test/has space.test.ts');
    expect(stderr).toContain('whitespace');
    expect(outputs).toEqual({});
  });

  it("--input-mode full on a pull_request (its pipeline changed) -> tests full, no map consulted", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs, summary } = runSelect(repo, { event: 'pull_request', inputMode: 'full', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('none');
    expect(outputs.count).toBe('4');
    expect(summary).toContain('input mode: `full`');
  });

  it('a map whose commit is not an ancestor of HEAD -> full: a map from another line of history is not trusted', () => {
    const repo = initRepo();
    writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
    commitAll(repo, 'base');
    git(repo, ['checkout', '-q', '-b', 'side']);
    writeFile(repo, 'side.txt', 'x\n');
    const sideSha = commitAll(repo, 'side');
    git(repo, ['checkout', '-q', 'main']);
    writeFile(repo, 'main.txt', 'y\n');
    commitAll(repo, 'main moves on');
    const mapFile = writeMapFile(repo, {
      format: 1, sha: sideSha, baseline: depRecord(), tests: { 'server/test/a.test.ts': testRecord({}) },
    });
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toBe(`map: ${sideSha} is not an ancestor of HEAD`);
  });

  it('macOS budget follows the EVENT: a pull request that fell back to full still gets at most 2 macOS shards', () => {
    const { repo } = buildMainFixture();
    const times = path.join(mkTmp('ccrc-ci-select-times-'), 'times.json');
    writeFileSync(times, JSON.stringify(Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [`server/test/${n}.test.ts`, 10_000_000]))));
    const pr = runSelect(repo, { event: 'pull_request', timesFile: times });
    expect(pr.outputs.tests).toBe('full');
    expect(JSON.parse(pr.outputs.macos_matrix).include).toHaveLength(2);
    const daily = runSelect(repo, { event: 'schedule', timesFile: times });
    expect(daily.outputs.tests).toBe('full');
    expect(JSON.parse(daily.outputs.macos_matrix).include).toHaveLength(4);
  });

  it('a full trigger (package.json changed) -> full, fallback names the file', () => {
    const { repo, mapFile } = buildFullTriggerFixture();
    const { status, outputs } = runSelect(repo, { event: 'pull_request', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.fallback).toContain('package.json');
  });
});

/** Every `files` entry across a matrix, repeats kept — to prove each file is in exactly one shard. */
function allFilesInMatrix(matrixJson: string): string[] {
  const parsed = JSON.parse(matrixJson) as { include: Array<{ files: string }> };
  return parsed.include.flatMap((row) => row.files.split(' ').filter(Boolean)).sort();
}

describe('select.mjs CLI — push (refresh)', () => {
  it('tests: none; trace: refresh with the affected list, not the whole tree', () => {
    const { repo, mapFile, baseSha } = buildMainFixture();
    // --input-mode omitted, as ci.yml omits it on a push to main.
    const { status, outputs } = runSelect(repo, { event: 'push', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('refresh');
    expect(outputs.count).toBe('0');
    expect(outputs.macos_count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);
    expect(outputs.map_sha).toBe(baseSha);

    const traced = uniqueFilesInMatrix(outputs.trace_matrix);
    expect(traced).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts']));
    expect(outputs.trace_count).toBe('3');
  });

  it('the trace matrix is an exact partition even with no durations: each file once, no vitest --shard', () => {
    // trace-run.mjs takes an exact list and has no --shard, so the trace plan
    // must never be the every-shard-gets-everything fallback the test legs use.
    const { repo, mapFile } = buildMainFixture();
    const { outputs } = runSelect(repo, { event: 'workflow_dispatch', inputMode: 'rebuild', mapFile });
    const rows = JSON.parse(outputs.trace_matrix).include as Array<{ vitest_shard: string }>;
    expect(rows.every((r) => r.vitest_shard === '')).toBe(true);
    expect(allFilesInMatrix(outputs.trace_matrix)).toEqual(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']);
    expect(outputs.trace_count).toBe('4');
  });

  it('--trace-list writes the trace list select MEANT to trace, repo-relative — what map-build refreshes against', () => {
    const { repo, mapFile } = buildMainFixture();
    const traceList = path.join(mkTmp('ccrc-ci-select-tl-'), 'sub', 'traced.txt');
    const { status } = runSelect(repo, { event: 'push', mapFile, traceList });
    expect(status).toBe(0);
    expect(readFileSync(traceList, 'utf8')).toBe('server/test/a.test.ts\nserver/test/b.test.ts\nserver/test/c.test.ts\n');
  });

  it("push WITH --input-mode full (release-stable's call) -> tests full, trace none, nothing to trace", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'push', inputMode: 'full', mapFile });
    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('none');
    expect(outputs.trace_count).toBe('0');
    expect(outputs.count).toBe('4');
  });
});

describe('select.mjs CLI — schedule', () => {
  it('full-green true -> skip: everything none/empty', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'schedule', fullGreen: 'true', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('none');
    expect(outputs.shadow).toBe('false');
    expect(outputs.count).toBe('0');
    expect(outputs.macos_count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);
    expect(JSON.parse(outputs.macos_matrix).include).toEqual([]);
    expect(JSON.parse(outputs.trace_matrix).include).toEqual([]);
    expect(outputs.trace_count).toBe('0');
    expect(outputs.map_sha).toBe('');
    expect(outputs.fallback).toBe('');
  });

  it('full-green false -> full + rebuild, every live test in both the test and trace matrices', () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'schedule', fullGreen: 'false', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('full');
    expect(outputs.trace).toBe('rebuild');
    expect(outputs.map_sha).toBe('');

    const all = new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']);
    expect(uniqueFilesInMatrix(outputs.server_matrix)).toEqual(all);
    expect(uniqueFilesInMatrix(outputs.trace_matrix)).toEqual(all);
    expect(outputs.count).toBe('4');
  });
});

describe('select.mjs CLI — workflow_dispatch', () => {
  it("input mode 'rebuild' -> tests none, trace rebuild traces every live test", () => {
    const { repo, mapFile } = buildMainFixture();
    const { status, outputs } = runSelect(repo, { event: 'workflow_dispatch', inputMode: 'rebuild', mapFile });

    expect(status).toBe(0);
    expect(outputs.tests).toBe('none');
    expect(outputs.trace).toBe('rebuild');
    expect(outputs.count).toBe('0');
    expect(JSON.parse(outputs.server_matrix).include).toEqual([]);

    const traced = uniqueFilesInMatrix(outputs.trace_matrix);
    expect(traced).toEqual(new Set(['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/d.test.ts']));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-select-cli.test.ts --maxWorkers=2
```

  Measured (module resolution, not an assertion — the right reason):

```
Error: Cannot find module '../../.github/ci/select.mjs' imported from …/server/test/ci-select-cli.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/select.mjs`:

<!-- file: .github/ci/select.mjs -->
```js
// The `select` job's entry point (spec §3-§4, §6, contract Task 9). This is
// the ONE place that turns a GitHub Actions trigger into what the rest of the
// pipeline runs: it decides the mode from the event (`decideMode`), and for
// any mode that needs a real per-file answer (`selected`, or a `refresh`
// trace list) it calls Task 5's `selectTests` against Task 4's `TestMap` and
// Task 6's `planShards`/`toMatrix` — no selection rule is duplicated here.
// It is deliberately the only module in `.github/ci/` that touches
// `$GITHUB_OUTPUT`/`$GITHUB_STEP_SUMMARY`, so every other module stays a pure
// library callable from a test without an Actions runner.
//
// Two conditions are refused outright — the process exits non-zero with no
// output written, so the `select` job fails and `test (server)` goes red —
// because each would otherwise produce a GREEN run that tested nothing, or the
// wrong thing: a live-test list that cannot be read or is empty (`full` with
// zero files skips every shard, and a skip with count 0 is a pass), and a
// live test path containing whitespace (every matrix joins its files with
// spaces, so such a path would split into two filters that match nothing).
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMap } from './testmap.mjs';
import { readChanges, liveTestFiles, gitExistsAt, selectTests, RULE_NAMES } from './select-tests.mjs';
import { planShards, toMatrix, PROFILES } from './shards.mjs';

/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {import('./select-tests.mjs').Selection} Selection */

/**
 * @typedef {{ tests: 'selected'|'full'|'none', trace: 'none'|'refresh'|'rebuild', skip: boolean }} ModeDecision
 */

/**
 * Maps a trigger to a mode (spec §3's table, restated exactly by
 * CONTRACT.md Task 9). Pure and total — every unrecognised combination
 * falls through to the same `full/none` the manual escape hatch uses, so a
 * misconfigured caller gets the SAFE answer, never a silent no-op.
 *
 * Order is significant, and matches the contract's own listing:
 *   1. `pull_request`                          -> selected / none — or full / none with `inputMode === 'full'`,
 *                                                 which ci.yml passes when the PR changes `.github/` (a plain-bash
 *                                                 check, so a PR cannot talk its own selector out of a full run)
 *   2. `push` with no `inputMode`               -> none / refresh
 *   3. `schedule`                                -> fullGreen ? none/none/skip : full/rebuild
 *   4. `inputMode === 'full'`                    -> full / none
 *   5. `inputMode === 'rebuild'`                  -> none / rebuild
 *   6. anything else                              -> full / none
 *
 * @param {{ event: string, inputMode?: string, fullGreen: boolean }} args
 * @returns {ModeDecision}
 */
export function decideMode({ event, inputMode, fullGreen }) {
  if (event === 'pull_request') {
    return inputMode === 'full'
      ? { tests: 'full', trace: 'none', skip: false }
      : { tests: 'selected', trace: 'none', skip: false };
  }
  if (event === 'push' && !inputMode) {
    return { tests: 'none', trace: 'refresh', skip: false };
  }
  if (event === 'schedule') {
    return fullGreen
      ? { tests: 'none', trace: 'none', skip: true }
      : { tests: 'full', trace: 'rebuild', skip: false };
  }
  if (inputMode === 'full') {
    return { tests: 'full', trace: 'none', skip: false };
  }
  if (inputMode === 'rebuild') {
    return { tests: 'none', trace: 'rebuild', skip: false };
  }
  return { tests: 'full', trace: 'none', skip: false };
}

/**
 * What a trigger can never answer (ruling T2), checked on decideMode's answer before anything runs: a pull
 * request always runs server tests (never `none`), and a schedule, a refresh push or a rebuild never runs a
 * per-file SELECTION (they run everything or nothing). A violation is a bug in this module; the CLI refuses it.
 * @param {string} event @param {string | undefined} inputMode @param {'selected'|'full'|'none'} tests
 * @returns {string | null}
 */
export function modeInvariantViolation(event, inputMode, tests) {
  if (event === 'pull_request' && tests === 'none') return 'a pull_request answered tests: none';
  if (tests === 'selected' && (event === 'schedule' || (event === 'push' && !inputMode) || inputMode === 'rebuild')) {
    return `a ${inputMode === 'rebuild' ? 'rebuild' : event} answered tests: selected`;
  }
  return null;
}

/** Every live server test file, or a thrown `Error` saying why there is no
 *  usable list — see the file header for why these refuse rather than fall
 *  back: every mode's matrices are built from this list, so there is no
 *  `full` to fall back TO without it.
 *  @param {string} repoDir @returns {string[]} */
function liveTestsOrRefuse(repoDir) {
  let live;
  try {
    live = liveTestFiles(repoDir);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    throw new Error(`select.mjs: cannot list the live server tests in ${repoDir}: ${msg}`);
  }
  if (live.length === 0) {
    throw new Error(`select.mjs: no live server test files under server/test in ${repoDir}`);
  }
  const spaced = live.filter((f) => /\s/.test(f));
  if (spaced.length > 0) {
    throw new Error(`select.mjs: a live test path contains whitespace, which the space-joined shard lists cannot carry: ${spaced.join(', ')}`);
  }
  return live;
}

/**
 * The real, per-file answer (spec §6): read the map, diff it against `HEAD`,
 * and run `selectTests`. Every failure along the way — an unreadable/
 * malformed map, a `map.sha` no longer reachable from this checkout, a git
 * command that fails for any other reason — is caught HERE and turned into
 * `{ mode: 'full', reason }` (spec §6.3's "the selector itself hits any
 * internal error ... emits mode full with the reason — it never answers
 * nothing"), so nothing above this function needs its own try/catch.
 *
 * @param {string} repoDir
 * @param {string | undefined} mapFile
 * @param {string[]} liveTests every live server test file (already computed
 *   by the caller, so this never re-reads it)
 * @returns {{ selection: Selection, map: TestMap | null }}
 */
function computeRealSelection(repoDir, mapFile, liveTests) {
  try {
    // No map is the ordinary first-run state (no trusted main artifact yet),
    // not a read error: say so, and say where it looked.
    if (!mapFile) {
      return { selection: { mode: 'full', reason: 'map: no map restored (select.mjs was given no --map)' }, map: null };
    }
    if (!existsSync(mapFile)) {
      return { selection: { mode: 'full', reason: `map: no map restored at ${mapFile}` }, map: null };
    }
    const mapResult = readMap(mapFile);
    if (!mapResult.ok) {
      return { selection: { mode: 'full', reason: `map: ${mapResult.reason}` }, map: null };
    }
    const map = mapResult.map;
    // Only a map from this tree's own history: its commit must be an ancestor of HEAD (exit 1 = it is not;
    // anything else — an unknown commit — throws and falls back below).
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', map.sha, 'HEAD'], { cwd: repoDir, stdio: 'pipe' });
    } catch (e) {
      if (e && /** @type {{ status?: number }} */ (e).status === 1) {
        return { selection: { mode: 'full', reason: `map: ${map.sha} is not an ancestor of HEAD` }, map: null };
      }
      throw e;
    }
    const changes = readChanges(repoDir, map.sha, 'HEAD');
    const existsAt = gitExistsAt(repoDir);
    const selection = selectTests({ map, changes, liveTests, existsAt });
    return { selection, map };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { selection: { mode: 'full', reason: `selector error: ${msg || 'unknown error'}` }, map: null };
  }
}

/** Markdown for `$GITHUB_STEP_SUMMARY` (spec §6.4's reason table, plus the
 *  mode/trace/fallback context a human needs to diagnose a later miss from
 *  this table alone). In shadow mode `selection` is still the REAL,
 *  would-be selection — only the matrices differ (contract: "the table is
 *  the would-be selection and the matrices carry ALL live tests").
 *  @param {{ event: string, inputMode: string|undefined, decide: ModeDecision, testsOut: string, shadowFlag: boolean, fallback: string, selection: Selection|null, mapSha: string, fileCount: number }} args
 *  @returns {string} */
function renderSummary({ event, inputMode, decide, testsOut, shadowFlag, fallback, selection, mapSha, fileCount }) {
  const lines = ['## CI test selection', ''];
  lines.push(`- event: \`${event}\`${inputMode ? ` (input mode: \`${inputMode}\`)` : ''}`);
  lines.push(`- tests: \`${testsOut}\`${shadowFlag ? ' — shadow: matrices below carry ALL live tests' : ''}`);
  lines.push(`- trace: \`${decide.trace}\``);
  if (mapSha) lines.push(`- map: \`${mapSha}\``);
  if (fallback) lines.push(`- fallback reason: ${fallback}`);
  lines.push('');
  if (selection && selection.mode === 'selected') {
    if (selection.tests.length === 0) {
      lines.push('_no server test file is affected by this change_');
    } else {
      lines.push('| rule | test | changed path |', '|---|---|---|');
      for (const t of selection.tests) {
        lines.push(`| ${t.rule} ${RULE_NAMES[t.rule]} | \`${t.file}\` | \`${t.path}\` |`);
      }
    }
  } else if (testsOut === 'none') {
    lines.push('_nothing to run — mode \`none\`_');
  } else if (testsOut === 'full') {
    lines.push(`_full run — ${fileCount} server test file(s)_`);
  }
  return lines.join('\n') + '\n';
}

/** Appends every `[name, value]` pair to `$GITHUB_OUTPUT` in the delimited
 *  form GitHub Actions requires for a value that may contain a newline (every
 *  matrix here is JSON on one line, but the reason strings are free text) —
 *  or, when unset (a local/test invocation), prints the same to stdout so
 *  the CLI is still inspectable without a runner.
 *  @param {Record<string, string>} outputs */
function writeOutputs(outputs) {
  const lines = [];
  for (const [name, value] of Object.entries(outputs)) {
    const delim = `ghadelim_${randomBytes(8).toString('hex')}`;
    lines.push(`${name}<<${delim}`, String(value), delim);
  }
  const text = lines.join('\n') + '\n';
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, text);
  } else {
    process.stdout.write(text);
  }
}

/** @param {string} md */
function writeSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repoDir = opt.repo ?? process.cwd();
  const event = opt.event ?? '';
  const inputMode = opt['input-mode'];
  const selectionMode = opt.selection ?? 'enforce';
  const fullGreen = opt['full-green'] === 'true';
  const mapFile = opt.map;
  const timesFile = opt.times;
  const traceListFile = opt['trace-list'];

  let durations = null;
  if (timesFile) {
    try {
      durations = JSON.parse(readFileSync(timesFile, 'utf8'));
    } catch {
      durations = null;
    }
  }

  const decide = decideMode({ event, inputMode, fullGreen });
  const violation = modeInvariantViolation(event, inputMode, decide.tests);
  if (violation) throw new Error(`select.mjs: ${violation} — refusing (ruling T2)`);
  const liveTestsAll = liveTestsOrRefuse(repoDir);

  const needsRealSelection = decide.tests === 'selected' || decide.trace === 'refresh';
  const realSel = needsRealSelection ? computeRealSelection(repoDir, mapFile, liveTestsAll) : null;

  let testsOut = decide.tests;
  let fallback = '';
  let mapSha = '';
  /** @type {Selection | null} */
  let selectionResult = null;

  if (decide.tests === 'selected') {
    if (realSel.selection.mode === 'full') {
      testsOut = 'full';
      fallback = realSel.selection.reason;
    } else {
      mapSha = realSel.map.sha;
      selectionResult = realSel.selection;
    }
  } else if (decide.trace === 'refresh') {
    if (realSel.selection.mode === 'full') {
      fallback = realSel.selection.reason;
    } else {
      mapSha = realSel.map.sha;
      selectionResult = realSel.selection;
    }
  }

  const shadowFlag = testsOut === 'selected' && selectionMode === 'shadow';

  /** @type {string[]} */
  let testFileList;
  if (testsOut === 'none') {
    testFileList = [];
  } else if (testsOut === 'selected') {
    testFileList = shadowFlag ? [...liveTestsAll] : selectionResult.tests.map((t) => t.file);
  } else {
    testFileList = [...liveTestsAll];
  }

  /** @type {string[]} */
  let traceList;
  if (decide.trace === 'none') {
    traceList = [];
  } else if (decide.trace === 'refresh') {
    traceList = realSel.selection.mode === 'full'
      ? [...liveTestsAll]
      : realSel.selection.tests.map((t) => t.file);
  } else {
    // rebuild: trace every live test (spec §5.3 / contract Task 9).
    traceList = [...liveTestsAll];
  }

  // The macOS budget follows the EVENT: a pull request keeps to 2 shards even when it fell back to full (the
  // organisation's 5 macOS slots are shared with every other PR); 4 only for the daily, dispatched or called
  // full run.
  const macosProfile = event !== 'pull_request' && testsOut === 'full' ? PROFILES.macosFull : PROFILES.macosSelected;

  const serverPlan = planShards(testFileList, durations, PROFILES.linux);
  const macosPlan = planShards(testFileList, durations, macosProfile);
  // `durations ?? {}`, never null: trace-run.mjs takes an exact list and has
  // no --shard, so the trace plan must always be a real partition (LPT at
  // defaultMs when no duration is known), never the fallback that hands every
  // shard every file plus a vitest `i/n`.
  const tracePlan = planShards(traceList, durations ?? {}, PROFILES.trace);

  // What this run MEANT to trace, for map-build: a refresh writes every one of
  // these that left no record as unknown instead of carrying its old entry.
  if (traceListFile) {
    mkdirSync(path.dirname(traceListFile), { recursive: true });
    writeFileSync(traceListFile, traceList.map((f) => `${f}\n`).join(''));
  }

  writeOutputs({
    tests: testsOut,
    trace: decide.trace,
    shadow: String(shadowFlag),
    count: String(testFileList.length),
    macos_count: String(testFileList.length),
    server_matrix: JSON.stringify(toMatrix(serverPlan)),
    macos_matrix: JSON.stringify(toMatrix(macosPlan)),
    trace_matrix: JSON.stringify(toMatrix(tracePlan)),
    trace_count: String(traceList.length),
    map_sha: mapSha,
    fallback,
  });

  writeSummary(renderSummary({
    event, inputMode, decide, testsOut, shadowFlag, fallback,
    selection: selectionResult, mapSha, fileCount: testFileList.length,
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-select-cli.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  34 passed (34)`. (A `fatal: bad object aaaa…` line in the run's
  stderr is `git`'s own message from inside the deliberately unreachable-sha case; that case passes.)

- [ ] **Step 5: Measure the mutation table** (mutate → run Step 4's command → see red → restore → confirm green;
  re-measured in the integration clone, 34 cases each):

  | # | Mutation | Test(s) that go red |
  |---|---|---|
  | 1 | `computeRealSelection`'s `if (!mapResult.ok)` branch returns a forged empty selection instead of `full` | `a map file that exists but cannot be read (invalid JSON) -> full…` (1) |
  | 2 | `shadowFlag = false` (shadow never widens the matrices) | `shadow: table shows the SAME would-be selection, but the matrices carry ALL live tests and shadow=true` (1) |
  | 3 | Drop the whitespace refusal | `a live test path with whitespace -> exits non-zero…` (1) |
  | 4 | Drop the empty-list refusal | `a tree with no server test files at all -> exits non-zero…` (1) |
  | 5 | Swallow a failed live-test listing (`return []`) | `live tests that cannot be listed (a broken --repo) -> exits non-zero and writes no outputs` (1) |
  | 6 | Plan the trace matrix with `durations` (null when no times) instead of `durations ?? {}` | `the trace matrix is an exact partition even with no durations…` (1) |
  | 7 | Drop the `trace_count` output | `tests: none; trace: refresh…`, `the trace matrix is an exact partition…`, `push WITH --input-mode full…`, `full-green true -> skip…` (4) |
  | 8 | `--trace-list` writes the TEST list instead of the trace list | `--trace-list writes the trace list select MEANT to trace…` (1) |
  | 9 | `decideMode`: a push takes the refresh branch whatever its `inputMode` | `push WITH an inputMode does not take the refresh branch…`, `push WITH inputMode 'full' (release-stable's workflow_call…)`, `push WITH --input-mode full (release-stable's call)…` (3) |
  | 10 | Drop the "no map restored at <path>" branch (a missing file goes to readMap again) | `missing map -> full, non-empty fallback, matrices carry every live test` (1) |
  | 11 | Drop the "no `--map` given" branch | `no --map at all -> full, and the fallback says no map was given` (1) |
  | 12 | `decideMode`: a `pull_request` ignores `--input-mode full` | `pull_request WITH inputMode 'full' (its own pipeline changed…) -> full/none`, `--input-mode full on a pull_request (its pipeline changed) -> tests full, no map consulted` (2) |
  | 13 | `modeInvariantViolation` lets a `pull_request` answer `none` | `a pull_request never answers tests none` (1) |
  | 14 | … lets a `schedule` answer `selected` | `a schedule, a refresh push and a rebuild never answer tests selected` (1) |
  | 15 | The CLI does not act on a violation | none — no correct `decideMode` reaches it; the PAIRED mutation shows the call site matters: with `decideMode` answering `none` for a pull request, the CLI exits 1 (`select.mjs: a pull_request answered tests: none — refusing`); remove the call too and it exits 0 with `tests=none`, `count=0` (measured on a copy) |
  | 16 | No ancestry check / a non-ancestor map used anyway | `a map whose commit is not an ancestor of HEAD -> full: a map from another line of history is not trusted` (1 each) |
  | 17 | The macOS profile by mode (a pull request's full fallback gets 4) | `macOS budget follows the EVENT: a pull request that fell back to full still gets at most 2 macOS shards` (1) |
  | 18 | The macOS profile by event alone (`event !== 'pull_request'`) | none — equivalent: every other event answers `full` or `none`, and `none` plans no macOS shard |
  | 19 | The reason table without rule names | `enforce: selects exactly the rule-3/4/2 files…`, `a directory a test linked whole: a change under it selects the test, and the table names rule 6 SUBTREE` (2) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

  (`grep -ln 'select.mjs' server/test/*.ts` → only `ci-select-cli.test.ts` at this commit.)

- [ ] **Step 7: Commit**

```bash
git add .github/ci/select.mjs server/test/ci-select-cli.test.ts
git commit -F - <<'EOF'
feat(ci): the select job's entry point

decideMode() turns a GitHub Actions trigger into {tests, trace, skip}
per spec §3; the CLI wires it to selectTests, readMap and
planShards/toMatrix to write GITHUB_OUTPUT (tests, trace, shadow, count,
macos_count, server_matrix, macos_matrix, trace_matrix, trace_count,
map_sha, fallback), the trace list (--trace-list) and a job-summary
reason table. Any map/git failure degrades to mode full with a reason
("no map restored at <path>" on a first run, or a map whose commit is
not an ancestor of HEAD). The mode invariants are asserted before
anything is written: a pull request never answers tests=none, and a
schedule, push or rebuild never answers tests=selected. The reason
table names each rule.
A live-test list that cannot be read, is empty, or holds a path with
whitespace is refused outright — each would otherwise be a green run
that tested nothing or the wrong thing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: History replay `.github/ci/replay.mjs`

**Files:**
- Create: `.github/ci/replay.mjs`
- Test: `server/test/ci-replay.test.ts`

**Interfaces:** Consumes: Task 5's `selectTests` (imported, called directly — no rule logic duplicated), Task 4's
`readMap` (used only in the CLI's `main()`), and — in its test — the frozen study set
`docs/superpowers/specs/2026-09-23-ci-test-selection-replay-dataset.json`, committed beside the spec before this
plan starts (it is the spec's companion file, not this plan's). Produces: `replayCase({map, changedFiles, failingTestFiles, existsAt}):
{selected, missed, notProven, mode}` (the contract's signature plus `notProven`), this module's own
`summarizeReplay(outcomes)` aggregation, `liveCountFor(map, selected)`, `runtimeShare({map, changedFiles, existsAt,
durations}): number`, `summarizeShares(shares)`, `describeDataset(dataset): { real, runs, synthetic,
inheritedSuspect }`, `datasetLine(d)` and the `ReplayOutcome` typedef, and the CLI
`node .github/ci/replay.mjs --repo DIR --map FILE [--dataset FILE] [--prs FILE --times FILE]`, whose dataset is a
JSON ARRAY of `{ id, changedFiles, failingTestFiles, inheritedSuspect? }` — any other field ignored (the frozen set
also carries `event` and `job`) — and whose `--prs` file is `gh pr list --json number,files`'s own array. Its
report opens with `dataset: N real cases from M runs, K synthetic, J inheritedSuspect`.
- Changed in integration: the JSDoc typedefs moved from `//` comments into `/** */` blocks, and the test fixtures
  are typed (`TestMap`, `ReplayOutcome`), for the tests-inclusive typecheck. The dataset schema above is now the one
  contract between this CLI and Task 14's builder (the builder used to write `{builtAt, repo, cases}`, which this
  CLI rejects: `TypeError: dataset.map is not a function`, measured).
- Changed in integration (the selected fraction): by the operator's ruling a case's fraction divides by its LIVE
  server tests — the dataset carries no tree to list, so `liveCountFor` takes the union of the map's tests and the
  selected ones — and can never exceed 100%. Dividing by the map's count alone did: a case selecting a failing test
  the map never traced read `max 200.0%` on a one-test map (measured before the change; `max 100.0%` after), and
  233.3% on Task 11's three-test composition map.
- Changed in integration (operator's ruling M3): a failing test the map holds no record for is NOT PROVEN —
  rule 1 selects it for being unmapped, not because the map predicted it — so it is reported on its own line and
  kept out of recall, never counted as caught; a case with no proven failure is not scored. And the CLI adds
  spec §11.3's runtime-share report: `--prs FILE --times FILE` prints, over the listed merged pull requests, the
  share of the full suite's runtime (durations from `--times`, a missing file weighed at the median) each would
  have run against today's map — min, median, max and mean; a full trigger counts as 1.
- Changed in integration (the acceptance dataset, operator's ruling R1): the study's dataset — 114 real CI test
  failures across 64 runs, plus the 6 documented misses — is FROZEN beside the spec as
  `docs/superpowers/specs/2026-09-23-ci-test-selection-replay-dataset.json` (GitHub job logs expire, so it could
  not be rebuilt later): an array of `{ id, event, job, changedFiles, failingTestFiles, inheritedSuspect }`, real
  ids `<run>:<job>`, synthetic ids `synthetic:<slug>`. The CLI replays it as-is (`event`/`job` ignored, pinned by a
  case that carries them) and every report opens with the set's size (`describeDataset`): a case is REAL when its
  id starts with a run id — `<run>` from Task 14's builder, `<run>:<job>` in the frozen set — counted per distinct
  run, and synthetic otherwise. The frozen file is pinned too: `dataset: 114 real cases from 64 runs, 6 synthetic,
  59 inheritedSuspect`. Its 17 `test (pwa)` cases name `pwa/test/…` files, which no server map holds, so the replay
  reports them NOT PROVEN — the pwa leg runs in full on every pull request anyway.
- Changed in integration (found rehearsing R1): with no proven failure a set's recall was printed `100.0%` — a
  vacuous score (replayed against a three-test map, the frozen set scores 0 of its 120 cases). Both recall lines
  now read `n/a (no proven failure — nothing to score)` then, and Task 15's rule treats `n/a` as not 100%.

- [ ] **Step 1: Write the failing test** — create `server/test/ci-replay.test.ts`:

<!-- file: server/test/ci-replay.test.ts -->
```ts
// Task 10 (spec §11.3, CONTRACT.md `.github/ci/replay.mjs`): the history
// replay's core function (`replayCase`, exact contract signature) and the
// report aggregation (`summarizeReplay`, this module's own design — see the
// file's top comment on what the contract leaves open, restated in this
// plan's `contract_issues`). A tiny fixture dataset and map, per CONTRACT.md.
// Mutation table at the bottom.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { replayCase, summarizeReplay, liveCountFor, runtimeShare, summarizeShares, describeDataset, datasetLine } from '../../.github/ci/replay.mjs';
import type { ReplayOutcome } from '../../.github/ci/replay.mjs';
import type { DepRecord, TestMap, TestRecord } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);
const emptyDep = (): DepRecord => ({ read: [], probed: [], listed: [], subtree: [], git: false });
const rec = (overrides: Partial<TestRecord> = {}): TestRecord => ({ ...emptyDep(), unknown: false, ...overrides });

describe('replayCase', () => {
  it('a genuine hit: the failing test\'s recorded read intersects a changed file', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const result = replayCase({
      map, changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'],
      existsAt: () => true, // the changed file existed at map.sha -> status M
    });
    expect(result).toEqual({ selected: ['server/test/dep.test.ts'], missed: [], notProven: [], mode: 'selected' });
  });

  it('a genuine miss: the failing test has no recorded dependency on anything changed', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/unrelated.test.ts': rec({ read: ['server/src/other.ts'] }),
        'server/test/failed.test.ts': rec({ read: ['server/src/other.ts'] }),
      },
    };
    const result = replayCase({
      map, changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/failed.test.ts'],
      existsAt: () => true,
    });
    expect(result.mode).toBe('selected');
    expect(result.missed).toEqual(['server/test/failed.test.ts']);
    expect(result.selected).not.toContain('server/test/failed.test.ts');
  });

  it('infers status A (absent at map.sha) vs M (present) from existsAt, and PROBED (rule 4) only fires for A', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/new.ts'] }) },
    };
    const asAdded = replayCase({
      map, changedFiles: ['server/src/new.ts'], failingTestFiles: ['server/test/probes.test.ts'],
      existsAt: () => false, // absent at map.sha -> status A
    });
    expect(asAdded.missed).toEqual([]);
    expect(asAdded.selected).toEqual(['server/test/probes.test.ts']);

    const asModified = replayCase({
      map, changedFiles: ['server/src/new.ts'], failingTestFiles: ['server/test/probes.test.ts'],
      existsAt: () => true, // present at map.sha -> status M, PROBED does not apply
    });
    expect(asModified.missed).toEqual(['server/test/probes.test.ts']);
  });

  it('a failing test absent from the map is NOT PROVEN — never counted as caught', () => {
    // Rule 1 selects it for being unmapped, not for any recorded dependency, so the case proves nothing about
    // the map: it is reported apart and kept out of recall.
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const result = replayCase({
      map, changedFiles: ['server/src/unrelated.ts'], failingTestFiles: ['server/test/never-traced.test.ts'],
      existsAt: () => true,
    });
    expect(result).toEqual({
      selected: ['server/test/never-traced.test.ts'], missed: [], notProven: ['server/test/never-traced.test.ts'], mode: 'selected',
    });
  });

  it('a brand-new test file among changedFiles (not in failingTestFiles) is live and selected', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const result = replayCase({
      map, changedFiles: ['server/test/new-feature.test.ts'], failingTestFiles: [],
      existsAt: () => false,
    });
    expect(result.selected).toEqual(['server/test/new-feature.test.ts']);
  });

  it('a full-trigger change selects everything live and reports zero misses regardless of what failed', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/a.test.ts': rec(),
        'server/test/b.test.ts': rec(),
      },
    };
    const result = replayCase({
      map, changedFiles: ['server/package.json'], failingTestFiles: ['server/test/a.test.ts', 'server/test/b.test.ts'],
      existsAt: () => true,
    });
    expect(result).toEqual({
      mode: 'full', missed: [], notProven: [], selected: ['server/test/a.test.ts', 'server/test/b.test.ts'],
    });
  });
});

describe('summarizeReplay', () => {
  const outcome = (id: string, o: Partial<ReplayOutcome> = {}): ReplayOutcome => (
    { id, mode: 'selected', selected: [], missed: [], notProven: [], failingTestFiles: [], liveCount: 10, inheritedSuspect: false, ...o }
  );

  it('recall (micro) pools failing-test instances across cases; recall (by case) is the zero-miss fraction', () => {
    const outcomes = [
      outcome('case-1', { failingTestFiles: ['a', 'b'], missed: [] }), // 2/2 caught, clean
      outcome('case-2', { failingTestFiles: ['c', 'd'], missed: ['d'] }), // 1/2 caught, not clean
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.recallMicro).toBeCloseTo(3 / 4);
    expect(summary.recallByCase).toBeCloseTo(1 / 2);
    expect(summary.misses).toEqual([{ id: 'case-2', missed: ['d'] }]);
  });

  it('excludes inheritedSuspect cases from the headline recall, still counts them', () => {
    const outcomes = [
      outcome('clean', { failingTestFiles: ['a'], missed: [] }),
      outcome('suspect-miss', { failingTestFiles: ['x'], missed: ['x'], inheritedSuspect: true }),
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.recallMicro).toBe(1); // the suspect miss does not drag it down
    expect(summary.recallByCase).toBe(1);
    expect(summary.casesConsidered).toBe(1);
    expect(summary.casesExcludedInheritedSuspect).toBe(1);
    expect(summary.misses).toEqual([]); // suspect's miss is not reported in the headline list
  });

  it('selected-fraction distribution: min/median/max over the headline cases', () => {
    const outcomes = [
      outcome('small', { selected: ['a'], liveCount: 10 }), // 0.1
      outcome('half', { selected: ['a', 'b', 'c', 'd', 'e'], liveCount: 10 }), // 0.5
      outcome('all', { selected: Array.from({ length: 10 }, (_, i) => `t${i}`), liveCount: 10 }), // 1.0
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.selectedFraction.min).toBeCloseTo(0.1);
    expect(summary.selectedFraction.max).toBeCloseTo(1.0);
    expect(summary.selectedFraction.median).toBeCloseTo(0.5);
  });
});

describe('summarizeReplay: not-proven failures stay out of recall', () => {
  const outcome = (id: string, o: Partial<ReplayOutcome> = {}): ReplayOutcome => (
    { id, mode: 'selected', selected: [], missed: [], notProven: [], failingTestFiles: [], liveCount: 10, inheritedSuspect: false, ...o }
  );
  it('a case whose only failure is unmapped is not scored; a mixed case is scored on its proven failures only', () => {
    const summary = summarizeReplay([
      outcome('unmapped-only', { failingTestFiles: ['x'], notProven: ['x'] }),
      outcome('mixed', { failingTestFiles: ['a', 'y'], notProven: ['y'], missed: ['a'] }),
      outcome('clean', { failingTestFiles: ['b'] }),
    ]);
    expect(summary.recallMicro).toBeCloseTo(1 / 2); // a missed, b caught; x and y not proven
    expect(summary.casesConsidered).toBe(2);
    expect(summary.recallByCase).toBeCloseTo(1 / 2);
    expect(summary.notProven).toEqual([{ id: 'unmapped-only', files: ['x'] }, { id: 'mixed', files: ['y'] }]);
  });
});

describe('runtimeShare: the selected share of server RUNTIME (spec §11.3), not of file count', () => {
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: {
      'server/test/a.test.ts': rec({ read: ['server/src/a.ts'] }),
      'server/test/b.test.ts': rec({ read: ['server/src/b.ts'] }),
      'server/test/c.test.ts': rec({ read: ['ccd/ccd'] }),
    },
  };
  const durations = { 'server/test/a.test.ts': 100, 'server/test/b.test.ts': 300, 'server/test/c.test.ts': 600 };

  it('weights the selected files by their durations', () => {
    expect(runtimeShare({ map, changedFiles: ['ccd/ccd'], existsAt: () => true, durations })).toBeCloseTo(0.6);
    expect(runtimeShare({ map, changedFiles: ['server/src/a.ts'], existsAt: () => true, durations })).toBeCloseTo(0.1);
    expect(runtimeShare({ map, changedFiles: ['README.md'], existsAt: () => true, durations })).toBe(0);
  });

  it('a full trigger is the whole runtime; a file with no duration gets the median of the known ones', () => {
    expect(runtimeShare({ map, changedFiles: ['server/package.json'], existsAt: () => true, durations })).toBe(1);
    // c unknown: median(100, 300) = 200 → c's share is 200 / 600.
    const partial = { 'server/test/a.test.ts': 100, 'server/test/b.test.ts': 300 };
    expect(runtimeShare({ map, changedFiles: ['ccd/ccd'], existsAt: () => true, durations: partial })).toBeCloseTo(200 / 600);
  });

  it('summarizeShares: min, median, max and mean', () => {
    const s = summarizeShares([0.1, 0.6, 1, 0.3]);
    expect(s).toMatchObject({ count: 4, min: 0.1, max: 1 });
    expect(s.median).toBeCloseTo(0.45);
    expect(s.mean).toBeCloseTo(0.5);
  });
});

describe('the selected fraction never exceeds 100%', () => {
  // A selected test can be absent from the map (a failing test the map never
  // traced is live by replayCase's union, and rule 1 selects it). Dividing by
  // the map's test count alone put such a case above 100%. The dataset carries
  // no tree to list, so the live count is the union of the map's tests and the
  // selected ones — every selected test is live by definition.
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
  };

  it('liveCountFor: the map\'s tests plus any selected test the map lacks', () => {
    expect(liveCountFor(map, ['server/test/dep.test.ts', 'server/test/new.test.ts'])).toBe(2);
    expect(liveCountFor(map, [])).toBe(1);
  });

  it('the CLI reports at most 100% for a case whose selection includes a test absent from the map', () => {
    const dir = mkTmp('ccrc-ci-replay-cli-');
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: 'c1', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/new.test.ts'] },
    ]));
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'replay.mjs');
    // --repo is not a git repository, so every changed path reads as added (status A) — rule 3 still fires on it.
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out).toContain('selected fraction of live server tests — min 100.0%, median 100.0%, max 100.0%');
    // new.test.ts is not in the map: selected, but not proven — so there is nothing to score, and recall says so
    // rather than a vacuous 100%.
    expect(out).toContain('not proven (failing tests absent from the map, kept out of recall): 1 in 1 case(s)');
    expect(out).toContain('recall (micro, pooled over failing-test instances): n/a (no proven failure — nothing to score)');
    expect(out).toContain('recall (by case, zero-miss cases / scored cases):   n/a (no proven failure — nothing to score)');
  });

  it('the CLI reports the runtime share over --prs weighed by --times', () => {
    const dir = mkTmp('ccrc-ci-replay-share-');
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
    writeFileSync(path.join(dir, 'prs.json'), JSON.stringify([
      { number: 1, files: [{ path: 'server/src/dep.ts', additions: 1, deletions: 0 }] },
      { number: 2, files: [{ path: 'README.md', additions: 1, deletions: 0 }] },
    ]));
    writeFileSync(path.join(dir, 'times.json'), JSON.stringify({ 'server/test/dep.test.ts': 1000 }));
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'replay.mjs');
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--prs', path.join(dir, 'prs.json'), '--times', path.join(dir, 'times.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out).toContain('selected share of server runtime over 2 PRs — min 0.0%, median 50.0%, max 100.0%, mean 50.0%');
  });
});

describe('the acceptance datasets: the frozen study set and a fresh collection (spec §11.3)', () => {
  // The study's set is frozen beside the spec (job logs expire, so it cannot be rebuilt); a fresh builder run adds
  // newer failures. The report names each set's size, so a thin set is never mistaken for the study's window. A
  // case is REAL when its id starts with a run id (`<run>` from the builder, `<run>:<job>` in the frozen set);
  // anything else is synthetic.
  const FROZEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..',
    'docs', 'superpowers', 'specs', '2026-09-23-ci-test-selection-replay-dataset.json');

  it('the frozen set is the study\'s window: 114 real cases from 64 runs, 6 synthetic, 59 inheritedSuspect', () => {
    const frozen = JSON.parse(readFileSync(FROZEN, 'utf8'));
    expect(describeDataset(frozen)).toEqual({ real: 114, runs: 64, synthetic: 6, inheritedSuspect: 59 });
    expect(datasetLine(describeDataset(frozen))).toBe('dataset: 114 real cases from 64 runs, 6 synthetic, 59 inheritedSuspect');
  });

  it('the builder\'s shape counts the same way: a bare run id is real, a slug is synthetic', () => {
    expect(describeDataset([
      { id: '555', changedFiles: [], failingTestFiles: [], inheritedSuspect: true },
      { id: '556', changedFiles: [], failingTestFiles: [], inheritedSuspect: false },
      { id: 'nul-byte-source-bytes', changedFiles: [], failingTestFiles: [], inheritedSuspect: false },
    ])).toEqual({ real: 2, runs: 2, synthetic: 1, inheritedSuspect: 1 });
  });

  it('the CLI replays the frozen shape as-is — event and job ignored — and prints the dataset line first', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const dir = mkTmp('ccrc-ci-replay-frozen-');
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: '101:test (server)', event: 'pull_request', job: 'test (server)', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: false },
      { id: '101:test-macos', event: 'pull_request', job: 'test-macos', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: true },
      { id: 'synthetic:dep', event: 'synthetic', job: 'test (server)', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: false },
    ]));
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'replay.mjs');
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out.split('\n')[0]).toBe('dataset: 2 real cases from 1 runs, 1 synthetic, 1 inheritedSuspect');
    expect(out).toContain('cases: 3 (2 scored, 1 excluded as inheritedSuspect)');
    expect(out).toContain('recall (micro, pooled over failing-test instances): 100.0%');
    expect(out).toContain('misses: none');
  });
});

/*
 * Mutation table (measured — see PLAN.md Task 10 Step 5 for the transcript):
 *
 * mutation                                                            -> test that goes red
 * -----------------------------------------------------------------------------------------
 * replayCase: flip the A/M inference (`existsAt(...) ? 'A' : 'M'`)      -> 'infers status A (absent at map.sha) vs M (present)...'
 * replayCase: drop `failingTestFiles` from the liveTests union          -> 'a failing test absent from the map is still live...'
 * replayCase: drop the changed-test-file liveTests union clause         -> 'a brand-new test file among changedFiles...'
 * replayCase: drop the `mode === 'full'` short-circuit (falls through   -> 'a full-trigger change selects everything live...'
 *   to treating it as a `selected` result with real misses)
 * summarizeReplay: drop the inheritedSuspect filter on `headline`       -> 'excludes inheritedSuspect cases from the headline recall...'
 * summarizeReplay: break `recallMicro`/`casesClean` accumulation        -> 'recall (micro) pools failing-test instances...'
 * liveCountFor: the map's tests only (no union with selected)          -> 'liveCountFor: the map's tests plus any selected test the map lacks'
 * CLI main: divide by the map's test count again                       -> 'the CLI reports at most 100% for a case whose selection includes...'
 */
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-replay.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/replay.mjs' imported from …/server/test/ci-replay.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/replay.mjs`:

<!-- file: .github/ci/replay.mjs -->
```js
// The history replay (spec §11.3, Task 10): the acceptance measurement for
// the selector. Given one real historical case — the files a real merge
// changed, and the server test files that actually failed for it — this
// module answers whether the selector, run against a given `TestMap`, would
// have selected every one of those failing tests. It is built entirely on
// Task 5's `selectTests`/`fullTrigger` (no rule logic is duplicated here),
// the way CONTRACT.md's Task 9 (`select.mjs`) is also meant to be built on
// them — this is the second, independent caller that proves the rule engine
// composes rather than needing its own copy.
//
// CONTRACT.md's `replayCase` signature and CLI are exact; the dataset file
// shape and the `summarizeReplay` aggregation are this module's own design —
// the contract does not pin either, and both are called out in this plan's
// `contract_issues`. A dataset is a JSON array of `{ id, changedFiles,
// failingTestFiles, inheritedSuspect }`; any other field a case carries —
// the frozen study set beside the spec also has `event` and `job` — is
// ignored. The report opens with the set's size (`describeDataset`), so a
// thin collection is never read as the study's window.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectTests } from './select-tests.mjs';
import { readMap } from './testmap.mjs';

/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {import('./select-tests.mjs').Change} Change */

/**
 * @param {{ map: TestMap, changedFiles: string[], failingTestFiles: string[], existsAt: (ref: string, p: string) => boolean }} args
 * `notProven`: the failing tests absent from the map. Rule 1 selects such a test for being unmapped, not for
 * any recorded dependency, so it proves nothing about the map — it is reported apart and kept out of recall,
 * never counted as caught.
 * @returns {{ selected: string[], missed: string[], notProven: string[], mode: 'selected' | 'full' }}
 */
export function replayCase({ map, changedFiles, failingTestFiles, existsAt }) {
  /** @type {Change[]} */
  const changes = changedFiles.map((p) => ({
    // The dataset records WHICH files changed, not their git status letter —
    // a real replay case comes from a merge's file list, which carries no
    // A/M/D tag of its own. A changed path this map's commit never saw is
    // necessarily new (A); everything else is treated as a modification.
    // Deletions are outside what this signature can express (CONTRACT.md's
    // note: "a changed file absent at map.sha is A, else M" names only
    // these two), which under-approximates the A/D affected-set logic for a
    // replayed deletion — recorded in this plan's `contract_issues`.
    status: existsAt(map.sha, p) ? 'M' : 'A',
    path: p,
    symlink: false,
  }));

  // Live tests, for a historical case, are every test this function can be
  // sure existed in that tree: everything the map already knows about, every
  // test that is recorded as having failed (it ran, so it existed), and any
  // changed path that is itself shaped like a server test file (covers a
  // brand-new test added by the same change, mirroring `selectTests` rule 1).
  const liveTests = new Set(Object.keys(map.tests));
  for (const f of failingTestFiles) liveTests.add(f);
  for (const p of changedFiles) {
    if (p.startsWith('server/test/') && p.endsWith('.test.ts')) liveTests.add(p);
  }

  const selection = selectTests({ map, changes, liveTests: [...liveTests], existsAt });
  const notProven = failingTestFiles.filter((f) => !Object.prototype.hasOwnProperty.call(map.tests, f)).sort();

  if (selection.mode === 'full') {
    return { selected: [...liveTests].sort(), missed: [], notProven, mode: 'full' };
  }
  const selected = selection.tests.map((t) => t.file).sort();
  const selectedSet = new Set(selected);
  const missed = failingTestFiles.filter((f) => !selectedSet.has(f)).sort();
  return { selected, missed, notProven, mode: 'selected' };
}

/**
 * How many server tests were live for a case, the denominator of its selected fraction. The dataset carries no
 * tree to list them from, so this is the union of the map's tests and the selected ones: a selected test is live
 * by definition (a failing test the map never traced is live by `replayCase`'s union), so the fraction can never
 * exceed 1. Dividing by the map's count alone did — 233% on a three-test map.
 * @param {TestMap} map
 * @param {string[]} selected
 * @returns {number}
 */
export function liveCountFor(map, selected) {
  return new Set([...Object.keys(map.tests), ...selected]).size;
}

/**
 * One dataset case's outcome plus the identifying fields a report needs.
 * @typedef {{ id: string, mode: 'selected'|'full', selected: string[], missed: string[], notProven: string[], failingTestFiles: string[], liveCount: number, inheritedSuspect: boolean }} ReplayOutcome
 */

/**
 * Aggregates a set of `ReplayOutcome`s into the report `select.mjs`'s CLI
 * prints (Task 10's own design — CONTRACT.md leaves the report shape open).
 * "Micro" recall pools every failing-test instance across every case;
 * "by-case" recall is the fraction of cases with zero misses. Both exclude
 * `inheritedSuspect` cases from the headline (spec §11.3 restated in
 * CONTRACT.md Task 10: those failures may not belong to the case's own
 * change at all, so scoring them against it would understate recall for a
 * reason that has nothing to do with the selector).
 * @param {ReplayOutcome[]} outcomes
 */
export function summarizeReplay(outcomes) {
  const headline = outcomes.filter((o) => !o.inheritedSuspect);
  const excluded = outcomes.filter((o) => o.inheritedSuspect);

  // Recall counts only PROVEN failures — those the map has a record for (see replayCase's `notProven`). A case
  // is scored only when it has at least one.
  let totalFailing = 0;
  let totalCaught = 0;
  let casesScored = 0;
  let casesClean = 0;
  for (const o of headline) {
    const proven = o.failingTestFiles.length - o.notProven.length;
    if (proven === 0) continue;
    casesScored += 1;
    totalFailing += proven;
    totalCaught += proven - o.missed.length;
    if (o.missed.length === 0) casesClean += 1;
  }
  const recallMicro = totalFailing === 0 ? 1 : totalCaught / totalFailing;
  const recallByCase = casesScored === 0 ? 1 : casesClean / casesScored;

  const fractions = headline
    .map((o) => (o.liveCount === 0 ? 0 : o.selected.length / o.liveCount))
    .sort((a, b) => a - b);
  const pick = (q) => (fractions.length === 0 ? 0 : fractions[Math.min(
    fractions.length - 1, Math.floor(q * (fractions.length - 1)),
  )]);

  const misses = headline
    .filter((o) => o.missed.length > 0)
    .map((o) => ({ id: o.id, missed: o.missed }));

  const notProven = headline
    .filter((o) => o.notProven.length > 0)
    .map((o) => ({ id: o.id, files: o.notProven }));

  return {
    recallMicro,
    recallByCase,
    casesConsidered: casesScored,
    notProven,
    casesExcludedInheritedSuspect: excluded.length,
    selectedFraction: {
      min: fractions[0] ?? 0, median: pick(0.5), max: fractions[fractions.length - 1] ?? 0,
    },
    misses,
  };
}

/**
 * The selected share of server RUNTIME for one change (spec §11.3's "selected share of server runtime across
 * the last 100 merged PRs"): the durations of the files `selectTests` picks against today's map, over the
 * durations of every test in it. Historical per-commit durations do not exist, so today's table weighs every
 * change; a file with no duration gets the median of the known ones (spec §7.1). A full trigger is 1.
 * @param {{ map: TestMap, changedFiles: string[], existsAt: (ref: string, p: string) => boolean, durations: Record<string, number> }} args
 * @returns {number}
 */
export function runtimeShare({ map, changedFiles, existsAt, durations }) {
  const live = Object.keys(map.tests).sort();
  /** @type {Change[]} */
  const changes = changedFiles.map((p) => ({ status: existsAt(map.sha, p) ? 'M' : 'A', path: p, symlink: false }));
  const selection = selectTests({ map, changes, liveTests: live, existsAt });
  if (selection.mode === 'full') return 1;
  const known = Object.values(durations).sort((a, b) => a - b);
  const mid = known.length >> 1;
  const median = known.length === 0 ? 1 : known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const weight = (f) => durations[f] ?? median;
  const total = live.reduce((s, f) => s + weight(f), 0);
  const chosen = selection.tests.reduce((s, t) => s + weight(t.file), 0);
  return total === 0 ? 0 : chosen / total;
}

/**
 * The size of a replay dataset, for the report: how many cases are REAL (their id starts with a CI run id — `<run>`
 * from the dataset builder, `<run>:<job>` in the frozen study set), from how many distinct runs, how many are
 * synthetic (any other id), and how many carry `inheritedSuspect`. Any other field a case carries (`event`, `job`)
 * is ignored here and everywhere else.
 * @param {Array<Record<string, unknown> & { id: string, inheritedSuspect?: boolean }>} dataset
 * @returns {{ real: number, runs: number, synthetic: number, inheritedSuspect: number }}
 */
export function describeDataset(dataset) {
  const runs = new Set();
  let real = 0;
  for (const c of dataset) {
    const m = /^(\d+)(?::|$)/.exec(String(c.id));
    if (m) {
      real += 1;
      runs.add(m[1]);
    }
  }
  return { real, runs: runs.size, synthetic: dataset.length - real, inheritedSuspect: dataset.filter((c) => !!c.inheritedSuspect).length };
}

/** @param {{ real: number, runs: number, synthetic: number, inheritedSuspect: number }} d */
export function datasetLine(d) {
  return `dataset: ${d.real} real cases from ${d.runs} runs, ${d.synthetic} synthetic, ${d.inheritedSuspect} inheritedSuspect`;
}

/** @param {number[]} shares @returns {{ count: number, min: number, median: number, max: number, mean: number }} */
export function summarizeShares(shares) {
  const s = [...shares].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { count: 0, min: 0, median: 0, max: 0, mean: 0 };
  const mid = n >> 1;
  return {
    count: n,
    min: s[0],
    median: n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    max: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const { gitExistsAt } = await import('./select-tests.mjs');
  const repoDir = opt.repo ?? process.cwd();

  const mapResult = readMap(opt.map);
  if (!mapResult.ok) {
    console.error(`cannot read --map: ${mapResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const map = mapResult.map;
  const existsAt = gitExistsAt(repoDir);

  // The runtime-share report: --prs FILE (a JSON array of { number, files }, `files` paths or { path }, as
  // `gh pr list --json number,files` gives them) weighed by --times FILE (a durations table).
  if (opt.prs) {
    if (!opt.times) throw new Error('--prs needs --times FILE (a durations table)');
    const prs = JSON.parse(readFileSync(opt.prs, 'utf8'));
    const durations = JSON.parse(readFileSync(opt.times, 'utf8'));
    const shares = prs.map((pr) => runtimeShare({
      map, existsAt, durations,
      changedFiles: (pr.files ?? []).map((f) => (typeof f === 'string' ? f : f.path)),
    }));
    const s = summarizeShares(shares);
    console.log(`selected share of server runtime over ${s.count} PRs — min ${formatPct(s.min)}, median ${formatPct(s.median)}, max ${formatPct(s.max)}, mean ${formatPct(s.mean)}`);
  }
  if (!opt.dataset) return;

  const dataset = JSON.parse(readFileSync(opt.dataset, 'utf8'));
  /** @type {ReplayOutcome[]} */
  const outcomes = dataset.map((c) => {
    const { selected, missed, notProven, mode } = replayCase({
      map, changedFiles: c.changedFiles, failingTestFiles: c.failingTestFiles, existsAt,
    });
    const liveCount = liveCountFor(map, selected);
    return {
      id: c.id, mode, selected, missed, notProven, failingTestFiles: c.failingTestFiles,
      liveCount, inheritedSuspect: !!c.inheritedSuspect,
    };
  });

  const summary = summarizeReplay(outcomes);

  console.log(datasetLine(describeDataset(dataset)));
  console.log(`cases: ${outcomes.length} (${summary.casesConsidered} scored, ${summary.casesExcludedInheritedSuspect} excluded as inheritedSuspect)`);
  // With no proven failure there is nothing to score: say so, never a vacuous 100% (a map too thin for the set).
  const nothing = summary.casesConsidered === 0 ? 'n/a (no proven failure — nothing to score)' : null;
  console.log(`recall (micro, pooled over failing-test instances): ${nothing ?? formatPct(summary.recallMicro)}`);
  console.log(`recall (by case, zero-miss cases / scored cases):   ${nothing ?? formatPct(summary.recallByCase)}`);
  console.log(`selected fraction of live server tests — min ${formatPct(summary.selectedFraction.min)}, median ${formatPct(summary.selectedFraction.median)}, max ${formatPct(summary.selectedFraction.max)}`);
  const unproven = summary.notProven.reduce((n, c) => n + c.files.length, 0);
  console.log(`not proven (failing tests absent from the map, kept out of recall): ${unproven} in ${summary.notProven.length} case(s)`);
  for (const c of summary.notProven) console.log(`  ${c.id}: ${c.files.join(', ')}`);
  if (summary.misses.length === 0) {
    console.log('misses: none');
  } else {
    console.log(`misses (${summary.misses.length} case(s)):`);
    for (const m of summary.misses) {
      console.log(`  ${m.id}: ${m.missed.join(', ')}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-replay.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  19 passed (19)`.

- [ ] **Step 5: Measure the mutation table.** Same discipline as Task 4. Re-measured in the integration clone
  (19 cases each):

  | mutation | test that goes red |
  |---|---|
  | `replayCase`: flip the A/M inference (`existsAt(...) ? 'A' : 'M'`) | `infers status A (absent at map.sha) vs M (present)...` (1) |
  | `replayCase`: drop `failingTestFiles` from the `liveTests` union | `a failing test absent from the map is NOT PROVEN — never counted as caught` (1) |
  | `replayCase`: drop the changed-test-file `liveTests` union clause | `a brand-new test file among changedFiles...` (1) |
  | `replayCase`: drop the `mode === 'full'` short-circuit | `a full-trigger change selects everything live...` (1) |
  | `summarizeReplay`: drop the `inheritedSuspect` filter on `headline` | `excludes inheritedSuspect cases from the headline recall...`, `the CLI replays the frozen shape as-is…` (2) |
  | `summarizeReplay`: count every proven failing test as caught (`totalCaught += proven`) | `recall (micro) pools failing-test instances across cases…`, `a case whose only failure is unmapped is not scored…` (2) |
  | `liveCountFor`: the map's tests only (no union with the selected) | `liveCountFor: the map's tests plus any selected test the map lacks`, `the CLI reports at most 100%…` (2) |
  | CLI `main()` divides by the map's count again (bypasses `liveCountFor`) | `the CLI reports at most 100% for a case whose selection includes a test absent from the map` (1) |
  | `summarizeReplay`: an unmapped failing test counted as caught | `a case whose only failure is unmapped is not scored; a mixed case is scored on its proven failures only` (1) |
  | `replayCase`: `notProven` never computed | `a failing test absent from the map is NOT PROVEN — never counted as caught`, `the CLI reports at most 100%…` (2) |
  | `runtimeShare`: a full trigger counts 0 / an unknown duration weighs 0 | `a full trigger is the whole runtime; a file with no duration gets the median of the known ones` (1 each) |
  | `summarizeShares`: the lower middle for an even count | `summarizeShares: min, median, max and mean`, `the CLI reports the runtime share over --prs weighed by --times` (2) |
  | `describeDataset`: synthetic only by `event` (the builder's slugs count as real) | `the builder's shape counts the same way: a bare run id is real, a slug is synthetic` (1) |
  | `describeDataset`: runs counted per case | `the frozen set is the study's window…`, `the CLI replays the frozen shape as-is…` (2) |
  | `describeDataset`: a bare run id only (the frozen `run:job` ids count as synthetic) | the same two (2) |
  | `describeDataset`: `inheritedSuspect` not counted | all three dataset cases (3) |
  | The CLI does not print the dataset line | `the CLI replays the frozen shape as-is — event and job ignored — and prints the dataset line first` (1) |
  | Recall printed as 100% when nothing is proven (no `n/a`) | `the CLI reports at most 100% for a case whose selection includes a test absent from the map` (1) |

- [ ] **Step 6: Run the neighbouring guards** (each file alone, from `server/`):

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

  Measured at this task's commit: `Tests  55 passed (55)`, `Tests  2 passed (2)`, `Tests  160 passed (160)`,
  `Tests  1 passed (1)`; `tsc` prints nothing (it needs `agent/node_modules`, which `typecheck-tests.test.ts` also
  needs).

- [ ] **Step 7: Commit**

```bash
git add .github/ci/replay.mjs server/test/ci-replay.test.ts
git commit -F - <<'EOF'
feat(ci): the history replay tool (spec §11.3)

.github/ci/replay.mjs's replayCase scores one historical (changed files,
failing tests) case against a TestMap using selectTests directly (no
rule logic duplicated), inferring A/M status from the map's commit.
summarizeReplay and the CLI report are this module's own design; the
dataset is a JSON array of { id, changedFiles, failingTestFiles,
inheritedSuspect? }. A case's selected fraction divides by the union of
the map's tests and the selected ones, so it never exceeds 100%. A
failing test the map does not hold is reported NOT PROVEN, never
counted as caught. --prs/--times adds a runtime-share report: the share
of the full suite's runtime each merged pull request would have run.
Every report opens with the dataset's size — real cases, runs,
synthetic, inheritedSuspect — and replays the frozen study set beside
the spec as-is; a recall with no proven failure reads n/a.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---


### Task 11: Composite action + `ci.yml` pipeline + pipeline pins

Spec §3–§4, §7, §10, §14 and the contract's *Workflow names and wiring*. Built after Tasks 2–10: `ci.yml` calls
`.github/ci/select.mjs`, `verdict.mjs`, `shards.mjs`, `trace-run.mjs`, `testmap.mjs`, this task's own
`main-artifact.mjs` and `server/vitest.select.config.ts`. Most pins in this task read only the workflow text;
several run a step's own script (the "already green?" question, the pipeline-change check, the artifact fetch,
the check before a refresh publishes, the map build's exit handling) with fake binaries on `PATH` or against a
fixture repository. The pipeline first runs for
real in Task 14.

**Files:**
- Create: `.github/ci/main-artifact.mjs`
- Test: `server/test/ci-main-artifact.test.ts` (new)
- Create: `.github/actions/server-deps/action.yml`
- Modify (full rewrite): `.github/workflows/ci.yml`
- Test: `server/test/ci-pipeline.test.ts` (new)

**Interfaces:**
- Consumes: `node .github/ci/select.mjs --repo DIR --event E [--input-mode M] --selection shadow|enforce
  --full-green true|false [--map FILE] [--times FILE] [--trace-list FILE]` and its `$GITHUB_OUTPUT` keys
  `tests trace shadow count macos_count server_matrix macos_matrix trace_matrix trace_count map_sha fallback`
  (Task 9); `node .github/ci/verdict.mjs server` with env `SELECT_RESULT TYPECHECK_RESULT SHARDS_RESULT TESTS COUNT
  EVENT` and `node .github/ci/verdict.mjs full` with env `RESULTS` (Task 8); `toMatrix` rows
  `{ shard, total, files /*space-joined SERVER-relative*/, vitest_shard }` (Task 6);
  `node .github/ci/shards.mjs times --out FILE <report.json>...` (Task 6, run from the repo root);
  `node .github/ci/trace-run.mjs --repo ROOT --files LISTFILE --out FILE --jobs 2 --timeout 1560` (Task 7);
  `node .github/ci/testmap.mjs build --sha S [--old FILE] --records DIR --out FILE` and `… refresh --sha S --old
  FILE --records DIR --live FILE --traced FILE --out FILE` (Task 4: the map written first, then exit 0, 3 for a
  traced test that newly fails under trace, 4 for a floor violator); `server/vitest.select.config.ts` +
  `CCRC_TEST_LIST` (Task 2).
- Produces: `.github/ci/main-artifact.mjs` — `TRUSTED_EVENTS`, `CI_WORKFLOW_PATH`, `artifactCandidates(artifacts,
  name, repoId)`, `isTrustedRun(run, repoId)`, `pickArtifact({artifacts, runs, name, repoId}): {artifactId, runId,
  headSha, createdAt} | null`, and the CLI `node .github/ci/main-artifact.mjs --repo OWNER/NAME --repo-id ID --name
  ARTIFACT` (REST API with `$GITHUB_TOKEN`; prints `artifact_id=`, `run_id=`, `head_sha=` — empty for none, and on
  any API failure — to stdout and to `$GITHUB_OUTPUT` when set; exit 0). Jobs `select` (`select tests`),
  `server-shard` (`server i/n`), `server-typecheck` (`typecheck (server)`), `server` (`test (server)`), `test`
  (`test (agent)`, `test (pwa)`), `probe-macos`, `build-pwa`, `test-macos` (`test-macos i/n`), `trace-shard`
  (`trace i/n`), `map-build`, `times-build`, `full-suite`; top-level `env: CCRC_SELECTION: shadow` (Task 15 flips
  it); artifacts `select-inputs` (`testmap.json`, `traced.txt`, `testmap.artifact`), `records-<shard>`
  (`records.json`), `times-<shard>` (`times.json`), `testmap` (the published map, 14 days) and `testtimes` (the
  published durations, 14 days); the `workflow_call` input `mode` and output `verdict` (`green` iff `full-suite`
  ran green) that Task 12 reads.
- Changed in integration (trace sharding): `trace-shard` and `map-build` are guarded on
  `needs.select.outputs.trace_count != '0'` (Task 9's new output) instead of comparing the matrix string, and the
  `awk` every-n-th-file split is gone — the trace matrix is always an exact partition (Tasks 6, 9).
- Changed in integration (a lost trace, and which map): `select` passes `--trace-list .ci-cache/traced.txt` and
  hands `map-build` both files in `select-inputs`; the refresh passes `--traced` from that artifact (Task 4 writes a
  traced-but-missing test `unknown`). Pinned: `map-build` refreshes against the map `select` diffed from and never
  fetches one of its own — a refresh racing the daily rebuild's publish would otherwise mix two maps.
- Changed in integration (found by executing the run blocks): `full-suite`'s `verdict` output was never set. The
  draft wrote `verdict=green` from a later step, but a step's `$GITHUB_OUTPUT` is its own and the job output reads
  `steps.verdict.outputs.verdict` — so `release-stable.yml` could never promote on a called full run. The `Verdict`
  step now writes it once `verdict.mjs full` exits 0, and a pin holds the write inside that step.
- Changed in integration (no map): `select` always passes `--map .ci-cache/testmap.json` — the conditional
  `if [ -f … ]` is gone — so when no map was fetched `select.mjs` can say `map: no map restored at
  .ci-cache/testmap.json` (Task 9, operator's ruling); the args line is pinned exactly.
- Changed in integration (pins): the daily "already green?" step answers `full_green=false` — never a skip — when
  `gh` fails (executed with a failing fake `gh`); `times-build` runs the `times` CLI from the workspace root; every
  `needs.select.outputs.X` any job reads is declared by `select`; `map-build` keeps the map as artifact `testmap`
  (how Tasks 14 and 15 fetch a map to replay against).
- Changed in integration (trust, operator's ruling T4): no `actions/cache` step anywhere (`setup-node`'s
  `cache: npm` stays: it holds npm's download cache, not a decision). A pull request's run reads and writes its own
  cache scope first, so a pull request could plant a map that selects nothing — and a manual rebuild on a feature
  branch would become that branch's pull requests' baseline. The map and the durations are artifacts of
  trusted runs only: `select`'s fetch step asks `main-artifact.mjs` for the newest non-expired `testmap` and
  `testtimes` whose run is `.github/workflows/ci.yml` on branch `main` of THIS repository (head repository id
  equal to the repository id — a fork can name a branch `main`), triggered by `push`, `schedule` or
  `workflow_dispatch`, and downloads each with `gh run download`; nothing found, or a failed download, is no map —
  a full run. `select` needs `actions: read`. Task 9 refuses a map whose commit is not an ancestor of `HEAD`.
  `map-build` uploads `testmap` and `times-build` uploads `testtimes` (main only). A refresh publishes only if the
  map it was built on is still the newest trusted one when checked just before the upload — compared by the
  artifact id `select` recorded (`testmap.artifact` in `select-inputs`); a rebuild, or a refresh that had no map,
  always publishes. The check and the upload are two steps, not one atomic act (operator's ruling R3: no
  `actions: write` to delete a loser afterwards): a map published in the seconds between them is not seen, and the
  refresh's map then becomes the newest. The worst case is that a rebuild's corrections wait for the next
  rebuild; selection stays safe, because every map is a correct map for its own commit.
- Changed in integration (the verdicts, operator's rulings T1, T2, P5): `test (server)` and `full-suite` each open
  with a script-free step that can only ADD red — `if:` over the needed jobs' results, `run: exit 1` — so a
  no-op `verdict.mjs` cannot turn a red leg green; `test (server)` passes `EVENT` (a pull request answering
  `tests: none` is red); `full-suite` passes `RESULTS`, one `name=result` pair per need, pinned to name every
  `needs:` entry — not `toJSON(needs)`, which carries every `select` matrix and outgrows an environment string.
- Changed in integration (a pipeline change, operator's ruling T3): on a pull request a plain-bash step computes
  `git diff --name-only "$(git merge-base "origin/$BASE_REF" HEAD)" HEAD -- .github/` and, when it is non-empty
  (or the base cannot be diffed), `Select` runs with `--input-mode full`: the full run is decided before, and
  without, the selector the pull request may be changing. The step's own script is executed against a fixture
  repository in the pins (changed, unchanged, undiffable, and a `.github/` change `main` made after the branch
  point, which a two-dot diff would wrongly count).
- Changed in integration (operator's ruling P6): `probe-macos` runs only on `pull_request` and `schedule`, never
  gating a called or dispatched full run. Pinned. `trace-shard` keeps its records `if: always()`, so a Trace step
  that fails for any reason still hands over what it wrote.
- Changed in integration (red only for news, operator's rulings R5-R6): `trace-run` exits 0 (Task 7), so a trace
  shard is red only when the runner itself failed. `map-build` passes Task 4 the map the run started from — the
  refresh's `--old` as before, and for a build `--old` the map `select` fetched, if any: `select` now hands
  `select-inputs` over whenever anything is traced (`traced.txt` is always there), and `map-build` always fetches
  it. The Build step records `testmap.mjs`'s exit code as its `rc` output and carries on for 0, 3 and 4 — both of
  the latter come after the map is written — so the pre-upload check and the upload run as usual and the map is
  PUBLISHED; the job's last step, `Red if the map build reported news`, then fails when `rc` is not `0`. Any other
  exit (a crash, no map) stops the Build step. So the daily rebuild is red only when something newly breaks under
  trace, a floor violator is red while still selected (rule 2), and a test that always fails under tracing reds
  the first build that sees it, not every merge. Pinned by running the Build step's own script with a fake `node`
  (exits 0/3/4 succeed with that `rc`, 1 fails; `--old` passed only when a map was handed over) and by the step
  order.

- [ ] **Step 1: Write the trusted-artifact picker's failing test** — `server/test/ci-main-artifact.test.ts`:

<!-- file: server/test/ci-main-artifact.test.ts -->
```ts
// `.github/ci/main-artifact.mjs` (design 2026-09-23 §5.5, operator's ruling T4): the map and the duration table
// come ONLY from an artifact of a trusted `ci.yml` run on `main`. The picker is pure and is tested here on
// fixture listings shaped like the REST API's (`GET /repos/{r}/actions/artifacts`, `GET …/actions/runs/{id}`);
// the CLI is run once against a local fake of that API, so the fetch-and-pick path is exercised as shipped.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { artifactCandidates, isTrustedRun, pickArtifact } from '../../.github/ci/main-artifact.mjs';
import type { Artifact, Run } from '../../.github/ci/main-artifact.mjs';

const REPO_ID = 1001;
const FORK_ID = 2002;

function artifact(id: number, runId: number, over: Partial<Artifact> & { branch?: string, headRepo?: number } = {}): Artifact {
  return {
    id, name: over.name ?? 'testmap', expired: over.expired ?? false, created_at: over.created_at ?? `2026-09-${String(10 + id).padStart(2, '0')}T00:00:00Z`,
    workflow_run: { id: runId, repository_id: REPO_ID, head_repository_id: over.headRepo ?? REPO_ID, head_branch: over.branch ?? 'main', head_sha: `${runId}`.padStart(40, '0') },
  };
}
function run(id: number, over: Partial<Run> & { headRepo?: number } = {}): Run {
  return {
    id, path: over.path ?? '.github/workflows/ci.yml', event: over.event ?? 'push', head_branch: over.head_branch ?? 'main',
    repository: { id: REPO_ID }, head_repository: { id: over.headRepo ?? REPO_ID },
  };
}

describe('pickArtifact: the newest artifact of a trusted main run', () => {
  it('picks the newest candidate whose run is trusted', () => {
    const artifacts = [artifact(1, 11), artifact(2, 12), artifact(3, 13)];
    const runs = { 11: run(11), 12: run(12, { event: 'schedule' }), 13: run(13, { event: 'workflow_dispatch' }) };
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })).toEqual({
      artifactId: 3, runId: 13, headSha: '13'.padStart(40, '0'), createdAt: '2026-09-13T00:00:00Z',
    });
  });

  it('skips a run from a pull request, even one whose branch is named main', () => {
    const artifacts = [artifact(1, 11), artifact(2, 12)];
    const runs = { 11: run(11), 12: run(12, { event: 'pull_request' }) };
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })?.artifactId).toBe(1);
  });

  it('skips a fork (another head repository), another branch, another workflow, an expired artifact, another name', () => {
    const runs = { 11: run(11), 12: run(12, { headRepo: FORK_ID }), 13: run(13, { head_branch: 'feature' }), 14: run(14, { path: '.github/workflows/other.yml' }), 15: run(15), 16: run(16) };
    const artifacts = [
      artifact(1, 11),
      artifact(2, 12, { headRepo: FORK_ID }),
      artifact(3, 13, { branch: 'feature' }),
      artifact(4, 14),
      artifact(5, 15, { expired: true }),
      artifact(6, 16, { name: 'testtimes' }),
    ];
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })?.artifactId).toBe(1);
    // A forked run can name its branch `main`; the head repository is what tells it apart. And the run's own
    // fields are checked, not only the artifact's copy of them.
    expect(isTrustedRun(run(12, { headRepo: FORK_ID }), REPO_ID)).toBe(false);
    expect(isTrustedRun(run(13, { head_branch: 'feature' }), REPO_ID)).toBe(false);
    expect(isTrustedRun(run(11), REPO_ID)).toBe(true);
    expect(artifactCandidates(artifacts, 'testmap', REPO_ID).map((a) => a.id)).toEqual([4, 1]);
  });

  it('answers null when nothing is trusted, or the run is unknown', () => {
    expect(pickArtifact({ artifacts: [artifact(1, 11)], runs: {}, name: 'testmap', repoId: REPO_ID })).toBeNull();
    expect(pickArtifact({ artifacts: [], runs: {}, name: 'testmap', repoId: REPO_ID })).toBeNull();
  });
});

describe('the CLI, against a local fake of the REST API', () => {
  const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'main-artifact.mjs');

  async function withApi(routes: Record<string, unknown>, fn: (base: string) => Promise<void>): Promise<void> {
    const server = createServer((req, res) => {
      const body = routes[req.url ?? ''];
      if (req.headers.authorization !== 'Bearer t0ken' || body === undefined) { res.statusCode = 404; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
    }
  }

  const cli = (base: string) => promisify(execFile)(process.execPath, [CLI, '--repo', 'o/r', '--repo-id', String(REPO_ID), '--name', 'testmap'], {
    env: { ...process.env, GITHUB_API_URL: base, GITHUB_TOKEN: 't0ken', GITHUB_OUTPUT: '' },
  });

  it('prints the picked artifact, run and sha', async () => {
    await withApi({
      '/repos/o/r/actions/artifacts?name=testmap&per_page=100': { artifacts: [artifact(2, 12), artifact(1, 11)] },
      '/repos/o/r/actions/runs/12': run(12, { event: 'pull_request' }),
      '/repos/o/r/actions/runs/11': run(11),
    }, async (base) => {
      const { stdout } = await cli(base);
      expect(stdout).toContain(`artifact_id=1\nrun_id=11\nhead_sha=${'11'.padStart(40, '0')}\n`);
    });
  });

  it('an API failure answers none (no map means a full run), and exits 0', async () => {
    await withApi({}, async (base) => {
      const { stdout } = await cli(base);
      expect(stdout).toContain('artifact_id=\nrun_id=\nhead_sha=\n');
      expect(stdout).toContain('::warning::');
    });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-main-artifact.test.ts --maxWorkers=2
```

  Measured:

```
Error: Cannot find module '../../.github/ci/main-artifact.mjs' imported from …/server/test/ci-main-artifact.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Implement** — create `.github/ci/main-artifact.mjs` (no dependencies: node's own `fetch`):

<!-- file: .github/ci/main-artifact.mjs -->
```js
// Where the test map and the duration table come from (design 2026-09-23 §5.5, operator's ruling T4): ONLY
// from an artifact a trusted run of `ci.yml` on `main` uploaded. Not from the Actions cache — a pull request's
// run reads its own cache scope first, so a PR could plant a map that selects nothing, and a manual rebuild on
// a feature branch would become that branch's PRs' baseline. An artifact is picked only when its run is on
// branch `main`, of this repository (not a fork that names a branch `main`), of `.github/workflows/ci.yml`, and
// triggered by `push`, `schedule` or `workflow_dispatch` — events only a merge or a maintainer can cause.
//
// The filtering is pure (`pickArtifact`, unit-tested); the CLI only fetches the two listings it needs from the
// REST API with the job's own token and writes the answer to `$GITHUB_OUTPUT`. Any API failure answers "none":
// no map means a full run, and a refresh that cannot confirm its base is still the newest does not publish —
// both the safe direction.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TRUSTED_EVENTS = ['push', 'schedule', 'workflow_dispatch'];
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

/**
 * @typedef {{ id: number, name: string, expired: boolean, created_at: string,
 *   workflow_run?: { id: number, repository_id: number, head_repository_id: number, head_branch: string, head_sha: string } }} Artifact
 * @typedef {{ id: number, path: string, event: string, head_branch: string,
 *   repository?: { id: number }, head_repository?: { id: number } }} Run
 * @typedef {{ artifactId: number, runId: number, headSha: string, createdAt: string }} Picked
 */

/** The artifacts that could be trusted, judged on the artifact's own fields, newest first.
 *  @param {Artifact[]} artifacts @param {string} name @param {number} repoId @returns {Artifact[]} */
export function artifactCandidates(artifacts, name, repoId) {
  return artifacts
    .filter((a) => a.name === name && !a.expired && a.workflow_run
      && a.workflow_run.head_branch === 'main'
      && a.workflow_run.repository_id === repoId
      && a.workflow_run.head_repository_id === repoId)
    .sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id));
}

/** Whether a run is one of this repository's own `ci.yml` runs on `main`, from a trusted event.
 *  @param {Run | undefined} run @param {number} repoId @returns {boolean} */
export function isTrustedRun(run, repoId) {
  return !!run
    && run.path === CI_WORKFLOW_PATH
    && run.head_branch === 'main'
    && TRUSTED_EVENTS.includes(run.event)
    && run.repository?.id === repoId
    && run.head_repository?.id === repoId;
}

/** The newest artifact named `name` whose run is trusted, or null.
 *  @param {{ artifacts: Artifact[], runs: Record<string, Run>, name: string, repoId: number }} args
 *  @returns {Picked | null} */
export function pickArtifact({ artifacts, runs, name, repoId }) {
  for (const a of artifactCandidates(artifacts, name, repoId)) {
    const run = runs[String(/** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id)];
    if (isTrustedRun(run, repoId)) {
      return {
        artifactId: a.id,
        runId: /** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id,
        headSha: /** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).head_sha,
        createdAt: a.created_at,
      };
    }
  }
  return null;
}

async function api(route) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${route}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GET ${route}: HTTP ${res.status}`);
  return res.json();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repo = opt.repo;
  const repoId = Number(opt['repo-id']);
  const name = opt.name;
  if (!repo || !name || !Number.isInteger(repoId)) {
    throw new Error('usage: node main-artifact.mjs --repo OWNER/NAME --repo-id ID --name ARTIFACT');
  }
  /** @type {Picked | null} */
  let picked = null;
  try {
    const listed = await api(`/repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
    /** @type {Record<string, Run>} */
    const runs = {};
    for (const a of artifactCandidates(listed.artifacts ?? [], name, repoId)) {
      const id = String(/** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id);
      if (!(id in runs)) runs[id] = await api(`/repos/${repo}/actions/runs/${id}`);
      picked = pickArtifact({ artifacts: [a], runs, name, repoId });
      if (picked) break;
    }
  } catch (e) {
    process.stdout.write(`::warning::main-artifact: no ${name} artifact read (${e instanceof Error ? e.message : e}); answering none\n`);
    picked = null;
  }
  const lines = [
    `artifact_id=${picked ? picked.artifactId : ''}`,
    `run_id=${picked ? picked.runId : ''}`,
    `head_sha=${picked ? picked.headSha : ''}`,
  ];
  // The answer goes to stdout always (map-build's check before it publishes reads it there) and to $GITHUB_OUTPUT when
  // the step has one.
  process.stdout.write(picked ? `${name}: artifact ${picked.artifactId} of run ${picked.runId} (${picked.headSha})\n` : `${name}: none\n`);
  process.stdout.write(lines.join('\n') + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    process.stderr.write(`main-artifact.mjs: ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 2;
  });
}
```

- [ ] **Step 4: Run it, expect PASS, and measure its mutation table**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-main-artifact.test.ts --maxWorkers=2
```

  Measured: `Test Files  1 passed (1)` / `Tests  6 passed (6)`. Then each row: apply the edit to
  `.github/ci/main-artifact.mjs`, re-run, see red, restore byte-for-byte, re-run green (re-measured in the
  integration clone):

  | Mutation (in `main-artifact.mjs`) | Test(s) that go red |
  |---|---|
  | `artifactCandidates` keeps another branch | `skips a fork (another head repository), another branch, another workflow, an expired artifact, another name` (1) |
  | … keeps another head repository (a fork) | the same (1) |
  | … keeps an expired artifact | the same (1) |
  | `isTrustedRun` accepts any event | `skips a run from a pull request, even one whose branch is named main`, `prints the picked artifact, run and sha` (2) |
  | … `TRUSTED_EVENTS` admits `pull_request` | the same two (2) |
  | … accepts any workflow file | `skips a fork …` (1) |
  | … accepts any branch | `skips a fork …` (1 — its direct `isTrustedRun` assertion on a `feature` run) |
  | … accepts any head repository | `skips a fork …` (1) |
  | Candidates sorted oldest first | `picks the newest candidate whose run is trusted`, `skips a fork …` (2) |
  | An API failure thrown out of the CLI instead of answering none | `an API failure answers none (no map means a full run), and exits 0` (1) |

- [ ] **Step 5: Write the pipeline's failing test** — `server/test/ci-pipeline.test.ts`:

<!-- file: server/test/ci-pipeline.test.ts -->
```ts
// ── ci.yml's SHAPE — the part of the pipeline no run of it can check ─────────
//
// Design 2026-09-23 §4.2: GitHub reports a job skipped by a conditional as
// SUCCESS, a job whose `needs:` failed is skipped, a workflow skipped by a
// `paths:` filter leaves its required checks PENDING forever, and a matrix
// skipped by a job-level `if:` never expands, so its `test (agent)` name
// never appears. Every one of those turns a broken pipeline into a green or
// a stuck required check, and none of them is visible from inside a run —
// the run that would notice is the run that did not happen. So the shape is
// pinned here, as text, the way build-release.test.ts pins the release
// workflows: line-anchored, per job block, never a bare substring a comment
// could satisfy.
//
// The reader is deliberately small (no YAML dependency — the select job
// runs before any `npm ci`, and this file should read the workflow the same
// way oss-metadata.test.ts's `jobBlocks` does). It goes red if it parses no
// jobs at all, so a layout change cannot make every assertion vacuous.

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
const CI = '.github/workflows/ci.yml';
const DEPS = '.github/actions/server-deps/action.yml';

/** A top-level section — `key:` at column 0 through the line before the next
 *  column-0 key. Comments at column 0 end nothing. */
function section(yml: string, key: string): string {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
  expect(start, `${key}: not found at column 0`).toBeGreaterThan(-1);
  const out = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

/** job id → the raw text of its block (every line after its header up to the
 *  next two-space key). */
function jobs(yml: string): Map<string, string> {
  const body = section(yml, 'jobs').split('\n').slice(1);
  const acc = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of body) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
    if (head) {
      expect(acc.has(head[1]), `job id ${head[1]} appears twice`).toBe(false);
      cur = [];
      acc.set(head[1], cur);
      continue;
    }
    cur?.push(l);
  }
  const out = new Map([...acc].map(([id, block]) => [id, block.join('\n')]));
  expect(out.size, 'parsed no jobs at all').toBeGreaterThan(0);
  return out;
}

/** A job-level scalar key (four-space indent), or null when absent. */
function jobKey(block: string, key: string): string | null {
  const m = new RegExp(`^ {4}${key}: (.*)$`, 'm').exec(block);
  return m ? m[1] : null;
}

/** The ids a job `needs:`, from either the flow-list or the bare-scalar form. */
function needs(block: string): string[] {
  const v = jobKey(block, 'needs');
  if (v === null) return [];
  return v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean).sort();
}

/** Each step of a job, as the text from its `      - ` line to the next. */
function steps(block: string): string[] {
  const parts = block.split(/^(?= {6}- )/m);
  return parts.filter((p) => /^ {6}- /.test(p));
}

function job(id: string): string {
  const b = jobs(read(CI)).get(id);
  expect(b, `ci.yml has no job \`${id}\``).toBeDefined();
  return b!;
}

/** The one step of `block` whose `name:` is `name`. */
function step(block: string, name: string): string {
  const found = steps(block).filter((st) => st.includes(`name: ${name}\n`));
  expect(found, `no step named "${name}"`).toHaveLength(1);
  return found[0];
}

/** A step's `run: |` script, dedented — the bytes the runner hands to bash. */
function runScript(st: string): string {
  const lines = st.split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  expect(at, 'the step has no `run: |` block').toBeGreaterThan(-1);
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l !== '' && !l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n').trimEnd() + '\n';
}

describe('ci.yml: the required checks cannot go missing (design 2026-09-23 §4.2)', () => {
  it('produces all four required names — test (server), test (agent), test (pwa), build-pwa', () => {
    const all = jobs(read(CI));
    // `test (server)` is a NAMED summary job now; the matrix keeps the other two.
    expect(jobKey(job('server'), 'name')).toBe('test (server)');
    expect(job('test'), 'the matrix must stay exactly [agent, pwa] — a new axis renames both checks')
      .toMatch(/^ {8}package: \[agent, pwa\]$/m);
    expect(jobKey(job('test'), 'name'), 'a name: on the matrix renames `test (agent)` and `test (pwa)`').toBeNull();
    expect(all.has('build-pwa')).toBe(true);
    expect(jobKey(job('build-pwa'), 'name'), 'a name: on build-pwa renames the required check').toBeNull();
    // No second producer of a required name — two jobs reporting
    // `test (server)` would let the green one answer for the red one.
    const named = [...all.values()].map((b) => jobKey(b, 'name')).filter((n) => n !== null);
    for (const req of ['test (server)', 'test (agent)', 'test (pwa)', 'build-pwa']) {
      expect(named.filter((n) => n === req).length, `${req} is produced by more than one job`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('the required matrix and build-pwa carry no job-level if: and no needs:', () => {
    // A job-level `if:` that skips the matrix means it never expands: no
    // `test (agent)` check exists, and the PR waits on it forever. A failed
    // `needs:` skips the job the same way.
    for (const id of ['test', 'build-pwa']) {
      expect(jobKey(job(id), 'if'), `${id} has a job-level if:`).toBeNull();
      expect(needs(job(id)), `${id} needs another job — its failure would skip a required check`).toEqual([]);
    }
  });

  it('the required legs skip by STEP, only on a refresh or a rebuild', () => {
    const leg = "${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild') && 'skip' || 'run' }}";
    for (const id of ['test', 'build-pwa']) {
      expect(job(id), `${id}: the job-level leg switch`).toContain(`\n    env:\n      CCRC_LEG: ${leg}\n`);
      const s = steps(job(id));
      expect(s.length, `${id} parsed no steps`).toBeGreaterThan(0);
      for (const st of s) {
        // `if:` either on the step's own dash line or as its first-level key.
        expect(st, `${id}: a step runs even on a refresh:\n${st}`).toMatch(/^(?: {6}- | {8})if: env\.CCRC_LEG == 'run'$/m);
      }
    }
  });

  it('test (server) is a summary that fails closed: always() over select, the shards and the typecheck', () => {
    const b = job('server');
    expect(jobKey(b, 'if')).toBe('always()');
    expect(needs(b)).toEqual(['select', 'server-shard', 'server-typecheck']);
    expect(b).toMatch(/^ {8}run: node \.github\/ci\/verdict\.mjs server$/m);
    // The verdict reads these six and nothing else; a swapped pair (the
    // typecheck's result passed as the shards') would be green on a red shard.
    // EVENT comes from the workflow's own context: a pull request never
    // answers tests none (ruling T2).
    for (const line of [
      'SELECT_RESULT: ${{ needs.select.result }}',
      'TYPECHECK_RESULT: ${{ needs.server-typecheck.result }}',
      'SHARDS_RESULT: ${{ needs.server-shard.result }}',
      'TESTS: ${{ needs.select.outputs.tests }}',
      'COUNT: ${{ needs.select.outputs.count }}',
      'EVENT: ${{ github.event_name }}',
    ]) {
      expect(b, `test (server) no longer passes ${line}`).toMatch(new RegExp(`^ {10}${line.replace(/[$.{}()|]/g, '\\$&')}$`, 'm'));
    }
  });

  it('both verdicts are fronted by a script-free step that can only ADD red (ruling T1)', () => {
    // A no-op verdict.mjs (a slip in its entry guard) must not be able to turn
    // a red leg green: these steps read the job results directly and fail.
    const s = steps(job('server'))[0];
    expect(s).toBe(
      "      - name: Refuse a prerequisite that did not succeed (no script involved)\n"
      + "        if: needs.select.result != 'success' || contains(fromJSON('[\"failure\",\"cancelled\"]'), needs.server-shard.result) || contains(fromJSON('[\"failure\",\"cancelled\"]'), needs.server-typecheck.result)\n"
      + "        run: exit 1\n");
    const f = steps(job('full-suite'))[0];
    expect(f).toBe(
      "      - name: Refuse any leg that did not succeed (no script involved)\n"
      + "        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')\n"
      + "        run: exit 1\n");
  });

  it('no workflow-level paths: or paths-ignore: filter', () => {
    const on = section(read(CI), 'on');
    expect(on, 'a paths filter leaves the required checks Pending forever').not.toMatch(/^\s+paths(-ignore)?:/m);
  });

  it('no matrix built from select can be empty when its job runs', () => {
    // An empty `include` is a hard error ("Matrix vector does not contain any
    // values"), which would turn a docs-only PR's `count: 0` into a red shard.
    expect(jobKey(job('server-shard'), 'if')).toContain("needs.select.outputs.count != '0'");
    expect(jobKey(job('test-macos'), 'if')).toContain("needs.select.outputs.macos_count != '0'");
    expect(jobKey(job('trace-shard'), 'if')).toContain("needs.select.outputs.trace_count != '0'");
    expect(jobKey(job('map-build'), 'if')).toContain("needs.select.outputs.trace_count != '0'");
  });
});

describe('ci.yml: modes, concurrency and the selection switch (design 2026-09-23 §3, §4.3)', () => {
  it('triggers: pull_request, main pushes, a daily schedule, dispatch and call — both with a mode', () => {
    const on = section(read(CI), 'on');
    expect(on).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(on).toMatch(/^ {2}pull_request:$/m);
    expect(on).toMatch(/^ {2}schedule:\n {4}- cron: '17 3 \* \* \*'$/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:\n {4}inputs:\n {6}mode:\n(?: {8}.*\n)*? {8}type: choice\n {8}options: \[full, rebuild\]\n {8}default: full$/m);
    expect(on).toMatch(/^ {2}workflow_call:\n {4}inputs:\n {6}mode:\n(?: {8}.*\n)*? {8}type: string$/m);
    expect(on, 'the stable gate reads this output').toMatch(/^ {8}value: \$\{\{ jobs\.full-suite\.outputs\.verdict \}\}$/m);
  });

  it('cancels superseded runs for pull requests only, in groups that carry the mode', () => {
    const c = section(read(CI), 'concurrency');
    expect(c).toMatch(/^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m);
    const g = /^ {2}group: (.*)$/m.exec(c)?.[1] ?? '';
    // `ci-` first: when release-stable calls this file, the group is evaluated
    // in the CALLER's context, and a bare `${{ github.workflow }}` would be
    // `release-stable` — the caller's own group, a deadlock.
    expect(g).toMatch(/^ci-\$\{\{ github\.workflow \}\}-/);
    for (const part of ["format('pr-{0}', github.event.pull_request.number)", "'refresh'", 'inputs.mode']) {
      expect(g, `the group no longer carries ${part}`).toContain(part);
    }
  });

  it('CCRC_SELECTION is defined exactly once, at the top level, and select reads it', () => {
    const src = read(CI);
    const defs = src.match(/^\s*CCRC_SELECTION:.*$/gm) ?? [];
    expect(defs, 'one line flips shadow to enforce — a second definition would shadow it').toHaveLength(1);
    expect(section(src, 'env')).toMatch(/^ {2}CCRC_SELECTION: (shadow|enforce)$/m);
    expect(job('select')).toContain('--selection "$CCRC_SELECTION"');
  });

  it('select asks for contents: read, checks: read and actions: read, and nothing else', () => {
    // actions: read — to list and download the trusted main artifacts the map and durations come from.
    expect(job('select')).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}checks: read\n {6}actions: read\n(?! {6}[a-z-]+:)/m);
  });

  it('probe-macos runs on pull requests and the daily schedule only — never gating a called or dispatched full run', () => {
    expect(jobKey(job('probe-macos'), 'if')).toBe("github.event_name == 'pull_request' || github.event_name == 'schedule'");
  });

  it('every job declares a deadline between 1 and 60 minutes', () => {
    for (const [id, b] of jobs(read(CI))) {
      const m = /^ {4}timeout-minutes: (\d+)$/m.exec(b);
      expect(m, `job ${id} has no timeout-minutes`).not.toBeNull();
      expect(Number(m![1]), `job ${id}`).toBeGreaterThan(0);
      expect(Number(m![1]), `job ${id}`).toBeLessThanOrEqual(60);
    }
  });
});

describe('ci.yml: every select output a job reads is one select declares (design 2026-09-23 §4.1)', () => {
  it('each needs.select.outputs.X is declared in select\'s outputs, as steps.select.outputs.X', () => {
    const src = read(CI);
    const used = [...new Set([...src.matchAll(/needs\.select\.outputs\.([a-z_]+)/g)].map((m) => m[1]))].sort();
    const outputs = /^ {4}outputs:\n((?: {6}.*\n)+)/m.exec(job('select'));
    expect(outputs, 'select declares no outputs').not.toBeNull();
    const declared = new Map([...outputs![1].matchAll(/^ {6}([a-z_]+): \$\{\{ steps\.select\.outputs\.([a-z_]+) \}\}$/gm)].map((m) => [m[1], m[2]]));
    for (const [name, from] of declared) expect(from, `select output ${name} reads another step output`).toBe(name);
    for (const name of used) expect(declared.has(name), `needs.select.outputs.${name} is read but select does not declare it`).toBe(true);
    expect(used).toContain('trace_count');
  });
});

describe('ci.yml: the map\'s inputs and outputs (design 2026-09-23 §5.3-§5.5)', () => {
  it('map-build refreshes against the map select diffed from (its select-inputs artifact), never a fresh fetch', () => {
    // A refresh racing the daily rebuild's publish would otherwise diff one
    // map and carry entries from another.
    const b = job('map-build');
    expect(b, 'map-build must not fetch a map of its own').not.toContain('main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name testmap\n            run_id');
    expect(step(b, 'Fetch what select handed over')).not.toMatch(/^ {8}if:/m);
    expect(step(b, 'Fetch what select handed over')).toMatch(/^ {10}name: select-inputs\n {10}path: \$\{\{ runner\.temp \}\}\/select-inputs$/m);
    const build = runScript(step(b, 'Build the map'));
    expect(build).toContain('--old "$RUNNER_TEMP/select-inputs/testmap.json"');
    // The refresh is told what select MEANT to trace, not what arrived: a test
    // whose trace went missing is written unknown, never carried stale.
    expect(build).toContain('--traced "$RUNNER_TEMP/select-inputs/traced.txt"');
    // --map always names the fetch path, so select.mjs can say "no map restored at <path>" when none was fetched.
    expect(job('select')).toContain('args=(--repo "$GITHUB_WORKSPACE" --event "$EVENT" --selection "$CCRC_SELECTION" --full-green "$FULL_GREEN" --map .ci-cache/testmap.json --trace-list .ci-cache/traced.txt)');
    expect(step(job('select'), 'Hand the map to map-build')).toMatch(/^ {10}path: \|\n {12}\.ci-cache\/testmap\.json\n {12}\.ci-cache\/traced\.txt\n {12}\.ci-cache\/testmap\.artifact$/m);
    // Handed over whenever anything is traced: a build needs the fetched map too, to tell news from old failures.
    expect(step(job('select'), 'Hand the map to map-build')).toMatch(/^ {8}if: steps\.select\.outputs\.trace != 'none'$/m);
  });

  it('map-build runs after a FAILED trace shard too, and the shard keeps whatever records it wrote', () => {
    expect(jobKey(job('map-build'), 'if')).toContain("(needs.trace-shard.result == 'success' || needs.trace-shard.result == 'failure')");
    expect(jobKey(job('map-build'), 'if')).toMatch(/^always\(\) && /);
    // A failed Trace step (a crashed trace-run, a runner problem) must still upload what it wrote, or map-build
    // counts a missing shard and writes no map at all.
    expect(step(job('trace-shard'), 'Keep the records')).toMatch(/^ {8}if: always\(\)$/m);
  });

  it('a trace shard hands trace-run exactly its matrix row\'s files — no --shard split of its own', () => {
    const t = runScript(step(job('trace-shard'), 'Trace'));
    expect(t).toBe('echo "$FILES" | tr \' \' \'\\n\' > "$RUNNER_TEMP/trace.txt"\n'
      + 'node .github/ci/trace-run.mjs --repo "$GITHUB_WORKSPACE" --files "$RUNNER_TEMP/trace.txt" --out "$RUNNER_TEMP/records.json" --jobs 2 --timeout 1560\n');
  });

  it('map-build keeps the map it built as an artifact, so a replay can fetch it (gh run download -n testmap)', () => {
    expect(step(job('map-build'), 'Keep the map as an artifact')).toMatch(/^ {10}name: testmap\n {10}path: \.ci-cache\/testmap\.json\n/m);
  });

  it('times-build merges the durations from the workspace root — the times CLI makes keys relative to its cwd', () => {
    const st = step(job('times-build'), 'Merge the durations');
    expect(st, 'a working-directory would make every key server-relative').not.toMatch(/working-directory:/);
    expect(runScript(st)).toContain('node .github/ci/shards.mjs times --out .ci-cache/testtimes.json "$RUNNER_TEMP"/times/*/times.json');
  });
});

/** A scratch dir holding fake binaries, put first on PATH for a step's script. */
function fakeBin(bins: Record<string, string>): string {
  const dir = mkTmp('ccrc-ci-fakebin-');
  for (const [name, body] of Object.entries(bins)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** Runs a step's own script under the runner's default shell, in `cwd`, with `env`. */
function runStep(st: string, cwd: string, env: Record<string, string>): { status: number | null, output: string, stdout: string } {
  const dir = mkTmp('ccrc-ci-step-');
  const script = join(dir, 'step.sh');
  writeFileSync(script, runScript(st));
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd, env: { PATH: process.env.PATH ?? '', ...env, GITHUB_OUTPUT: out }, encoding: 'utf8',
  });
  return { status: r.status, output: readFileSync(out, 'utf8'), stdout: r.stdout };
}

describe('ci.yml: maps and durations come ONLY from trusted main artifacts (ruling T4)', () => {
  it('no Actions cache anywhere — a pull request can write its own cache scope', () => {
    expect(read(CI)).not.toMatch(/actions\/cache/);
  });

  it('select fetches the newest trusted testmap and testtimes (main-artifact.mjs) and downloads them', () => {
    const st = step(job('select'), 'Fetch the newest trusted map and durations');
    const s = runScript(st);
    expect(s).toContain('for name in testmap testtimes; do');
    expect(s).toContain('node .github/ci/main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name "$name"');
    expect(s).toContain('gh run download "$run_id" --repo "$REPO" -n "$name" -D .ci-cache');
    // Run it with fakes: node answers run 77 / artifact 5 for testmap and nothing for testtimes; gh "downloads".
    const ws = mkTmp('ccrc-ci-fetch-');
    const bin = fakeBin({
      node: 'case "$*" in *"--name testmap"*) printf "testmap: artifact 5\\nartifact_id=5\\nrun_id=77\\nhead_sha=%s\\n" "$(printf a%.0s $(seq 40))";; *) printf "testtimes: none\\nartifact_id=\\nrun_id=\\nhead_sha=\\n";; esac',
      gh: 'echo "gh $*" >> "$GH_LOG"; for d; do :; done; echo "{}" > "$d/testmap.json"',
    });
    const r = runStep(st, ws, { PATH: `${bin}:${process.env.PATH}`, REPO: 'o/r', REPO_ID: '1', GH_LOG: join(ws, 'gh.log') });
    expect(r.status).toBe(0);
    expect(readFileSync(join(ws, '.ci-cache', 'testmap.artifact'), 'utf8')).toBe('5\n');
    expect(existsSync(join(ws, '.ci-cache', 'testtimes.artifact'))).toBe(false);
    expect(readFileSync(join(ws, 'gh.log'), 'utf8')).toBe('gh run download 77 --repo o/r -n testmap -D .ci-cache\n');
    // A failed download is no map (a full run), never a failed select — and records no artifact id.
    const ws2 = mkTmp('ccrc-ci-fetch-');
    const failing = fakeBin({
      node: 'printf "artifact_id=5\\nrun_id=77\\nhead_sha=x\\n"',
      gh: 'echo "HTTP 410: artifact expired" >&2; exit 1',
    });
    const r2 = runStep(st, ws2, { PATH: `${failing}:${process.env.PATH}`, REPO: 'o/r', REPO_ID: '1' });
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('::warning::could not download testmap from run 77');
    expect(existsSync(join(ws2, '.ci-cache', 'testmap.artifact'))).toBe(false);
    expect(existsSync(join(ws2, '.ci-cache', 'testmap.json'))).toBe(false);
  });

  function casStep(): string { return step(job('map-build'), 'Is the map this refresh was built on still the newest?'); }

  it('a refresh publishes only if, checked just before the upload, its base map is still the newest trusted one', () => {
    const ws = mkTmp('ccrc-ci-cas-');
    mkdirSync(join(ws, 'rt', 'select-inputs'), { recursive: true });
    writeFileSync(join(ws, 'rt', 'select-inputs', 'testmap.artifact'), '5\n');
    const answer = (id: string) => fakeBin({ node: `printf "testmap\\nartifact_id=${id}\\nrun_id=9\\nhead_sha=x\\n"` });
    const same = runStep(casStep(), ws, { PATH: `${answer('5')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(same.output).toBe('publish=true\n');
    const moved = runStep(casStep(), ws, { PATH: `${answer('6')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(moved.output).toBe('publish=false\n');
    expect(moved.stdout).toContain('::notice::');
    const none = runStep(casStep(), ws, { PATH: `${answer('')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(none.output).toBe('publish=false\n');
    // No recorded base and no newest map are not "the same map": an empty id never matches.
    writeFileSync(join(ws, 'rt', 'select-inputs', 'testmap.artifact'), '\n');
    const blank = runStep(casStep(), ws, { PATH: `${answer('')}:${process.env.PATH}`, RUNNER_TEMP: join(ws, 'rt'), REPO: 'o/r', REPO_ID: '1' });
    expect(blank.output).toBe('publish=false\n');
  });

  it('map-build publishes testmap unless that check said no; times-build publishes testtimes', () => {
    const b = job('map-build');
    expect(b).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n(?! {6}[a-z-]+:)/m);
    expect(jobKey(b, 'if')).not.toBeNull();
    expect(casStep()).toMatch(/^ {8}if: needs\.select\.outputs\.trace == 'refresh' && needs\.select\.outputs\.map_sha != ''$/m);
    expect(step(b, 'Keep the map as an artifact')).toMatch(/^ {8}if: steps\.cas\.outputs\.publish != 'false'$/m);
    expect(step(job('times-build'), 'Keep the durations as an artifact')).toMatch(/^ {10}name: testtimes\n {10}path: \.ci-cache\/testtimes\.json\n/m);
  });
});

describe('ci.yml: map-build publishes the map it wrote, then goes red on news (spec §5.4, rulings R5-R6)', () => {
  // testmap.mjs exits 3 (a traced test newly fails under trace) or 4 (a floor test written unknown) only AFTER it
  // has written the map. The Build step records the code and carries on, so the map is published; the job's last
  // step turns it red. Any other exit (a crash: no map) stops the step there.
  function buildRepo(): { ws: string, rt: string } {
    const ws = mkTmp('ccrc-ci-mapbuild-');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: ws, env: { ...process.env,
      GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
    g('init', '-q');
    mkdirSync(join(ws, 'server', 'test'), { recursive: true });
    writeFileSync(join(ws, 'server', 'test', 'a.test.ts'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'fixture');
    const rt = join(ws, 'rt');
    mkdirSync(join(rt, 'records', 'records-1'), { recursive: true });
    writeFileSync(join(rt, 'records', 'records-1', 'records.json'), '{}');
    return { ws, rt };
  }
  // node: `-e` answers the matrix length (1); the testmap call logs its arguments and exits $FAKE_RC.
  const fakeNode = () => fakeBin({ node: 'if [ "$1" = "-e" ]; then echo 1; exit 0; fi\necho "$*" >> "$NODE_LOG"\nexit "$FAKE_RC"' });
  function build(rc: number, opts: { trace?: string, mapSha?: string, handedMap?: boolean } = {}) {
    const { ws, rt } = buildRepo();
    if (opts.handedMap) {
      mkdirSync(join(rt, 'select-inputs'), { recursive: true });
      writeFileSync(join(rt, 'select-inputs', 'testmap.json'), '{}');
    }
    const r = runStep(step(job('map-build'), 'Build the map'), ws, {
      PATH: `${fakeNode()}:${process.env.PATH}`, RUNNER_TEMP: rt, TRACE: opts.trace ?? 'rebuild', MAP_SHA: opts.mapSha ?? '',
      TRACE_MATRIX: '{"include":[{}]}', GITHUB_SHA: 'f'.repeat(40), FAKE_RC: String(rc), NODE_LOG: join(ws, 'node.log'),
    });
    return { ...r, log: existsSync(join(ws, 'node.log')) ? readFileSync(join(ws, 'node.log'), 'utf8') : '' };
  }

  it('exit 0, 3 or 4 from testmap.mjs: the step succeeds and says which; any other exit fails it', () => {
    expect(build(0)).toMatchObject({ status: 0, output: 'rc=0\n' });
    expect(build(3)).toMatchObject({ status: 0, output: 'rc=3\n' });
    expect(build(4)).toMatchObject({ status: 0, output: 'rc=4\n' });
    expect(build(1).status).toBe(1);
  });

  it('a build is handed the map select fetched as --old, when there was one; a refresh always is', () => {
    expect(build(0).log).toMatch(/^\.github\/ci\/testmap\.mjs build --sha f{40} --records \S+ --out \.ci-cache\/testmap\.json$/m);
    expect(build(0, { handedMap: true }).log).toMatch(/^\.github\/ci\/testmap\.mjs build --sha f{40} --old \S+\/select-inputs\/testmap\.json --records /m);
    expect(build(0, { trace: 'refresh', mapSha: 'a'.repeat(40), handedMap: true }).log).toMatch(/^\.github\/ci\/testmap\.mjs refresh --sha f{40} --old \S+\/select-inputs\/testmap\.json /m);
  });

  it('the map is uploaded whatever the build said, and a last step turns the job red when it said 3 or 4', () => {
    const b = job('map-build');
    const names = steps(b).map((st) => /^ {6}- (?:name: (.*)|uses: .*)$/m.exec(st)?.[1] ?? '');
    const upload = names.indexOf('Keep the map as an artifact');
    const red = names.indexOf('Red if the map build reported news');
    expect(upload).toBeGreaterThan(-1);
    expect(red).toBe(names.length - 1);
    expect(red).toBeGreaterThan(upload);
    expect(step(b, 'Build the map')).toMatch(/^ {8}id: build$/m);
    const last = step(b, 'Red if the map build reported news');
    expect(last).toMatch(/^ {8}if: steps\.build\.outputs\.rc != '0'$/m);
    expect(runScript(last)).toMatch(/\nexit 1\n$/);
    // The upload is gated by the pre-upload check only — never by the build's code.
    expect(step(b, 'Keep the map as an artifact')).not.toContain('steps.build');
  });
});

describe('ci.yml: a pull request that changes the pipeline runs everything, decided in plain bash (ruling T3)', () => {
  function pipelineStep(): string { return step(job('select'), 'Does this pull request change the pipeline?'); }
  const gitEnv = {
    GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  /** A repo whose origin/main is its first commit, and whose HEAD changes `changed`. */
  function prRepo(changed: string): string {
    const dir = mkTmp('ccrc-ci-pipeline-change-');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, ...gitEnv } });
    g('init', '-q'); g('checkout', '-q', '-b', 'main');
    mkdirSync(join(dir, 'server'), { recursive: true });
    writeFileSync(join(dir, 'server', 'x.ts'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(path.dirname(join(dir, changed)), { recursive: true });
    writeFileSync(join(dir, changed), '2\n');
    g('add', '-A'); g('commit', '-qm', 'the pull request');
    return dir;
  }

  it('runs only on pull_request, and hands select --input-mode full when it answers changed=true', () => {
    expect(pipelineStep()).toMatch(/^ {8}if: github\.event_name == 'pull_request'$/m);
    const sel = step(job('select'), 'Select');
    expect(sel).toMatch(/^ {10}PIPELINE_CHANGED: \$\{\{ steps\.pipeline\.outputs\.changed \}\}$/m);
    expect(runScript(sel)).toContain('elif [ "$PIPELINE_CHANGED" = true ]; then args+=(--input-mode full); fi');
  });

  it('a change under .github/ -> changed=true; anything else -> false; a base it cannot diff against -> true', () => {
    expect(runStep(pipelineStep(), prRepo('.github/ci/select-tests.mjs'), { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=true\n' });
    expect(runStep(pipelineStep(), prRepo('server/y.ts'), { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=false\n' });
    expect(runStep(pipelineStep(), prRepo('server/y.ts'), { BASE_REF: 'nope' })).toMatchObject({ status: 0, output: 'changed=true\n' });
  });

  it('diffs from the merge base, so a pipeline change main made since the branch point is not this pull request\'s', () => {
    const dir = prRepo('server/y.ts');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, ...gitEnv } });
    // main moves on with a .github/ change of its own, after the pull request branched.
    g('checkout', '-q', '-b', 'later-main', 'origin/main');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'x.yml'), '1\n');
    g('add', '-A'); g('commit', '-qm', 'main moves on');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    g('checkout', '-q', 'main');
    expect(runStep(pipelineStep(), dir, { BASE_REF: 'main' })).toMatchObject({ status: 0, output: 'changed=false\n' });
  });
});

describe('ci.yml: the daily run\'s "already green?" question fails SAFE (design 2026-09-23 §3)', () => {
  // Run the step's own script, with a fake `gh` on PATH, under the runner's
  // default shell (`bash --noprofile --norc -eo pipefail`). A gh that fails —
  // rate limit, network — must answer `full_green=false`, which runs the full
  // suite; anything else would turn an API hiccup into a skipped daily run.
  function ask(gh: string): { status: number | null, output: string } {
    const dir = mkTmp('ccrc-ci-green-');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'gh'), `#!/bin/sh\n${gh}\n`);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    const script = join(dir, 'step.sh');
    writeFileSync(script, runScript(step(job('select'), 'Does this commit already carry a green full-suite?')));
    const out = join(dir, 'out');
    writeFileSync(out, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GITHUB_OUTPUT: out, GH_TOKEN: 'x', REPO: 'o/r', SHA: 'f'.repeat(40) },
      encoding: 'utf8',
    });
    return { status: r.status, output: readFileSync(out, 'utf8') };
  }

  it('gh fails -> full_green=false, and the step itself succeeds', () => {
    expect(ask('echo "API rate limit exceeded" >&2; exit 1')).toEqual({ status: 0, output: 'full_green=false\n' });
  });

  it('gh finds a green full-suite -> full_green=true; finds none -> false', () => {
    expect(ask('echo 123')).toEqual({ status: 0, output: 'full_green=true\n' });
    expect(ask('exit 0')).toEqual({ status: 0, output: 'full_green=false\n' });
  });
});

describe('ci.yml: the full-suite verdict and the legs it runs (design 2026-09-23 §7, §8)', () => {
  it('full-suite needs every leg — Linux shards, typecheck, agent, pwa, build, macOS — and asks verdict.mjs full', () => {
    const b = job('full-suite');
    expect(needs(b)).toEqual(['build-pwa', 'select', 'server', 'server-shard', 'server-typecheck', 'test', 'test-macos']);
    expect(jobKey(b, 'if')).toBe("always() && needs.select.outputs.tests == 'full'");
    // RESULTS carries exactly one `name=result` pair per need — never toJSON(needs), which carries every select
    // matrix and outgrows an environment string's 128 KB as the suite grows.
    expect(b).not.toContain('toJSON(needs)');
    const results = /^ {10}RESULTS: (.*)$/m.exec(b)?.[1] ?? '';
    // A pair's expression holds spaces of its own; a pair starts where a space is followed by `name=`.
    expect(results.split(/ (?=[\w-]+=)/).sort()).toEqual(needs(b).map((n) => `${n}=\${{ needs.${n}.result }}`).sort());
    expect(b).toMatch(/^ {6}verdict: \$\{\{ steps\.verdict\.outputs\.verdict \}\}$/m);
    // The output is written BY the step whose id the job output reads, and
    // only after verdict.mjs exits 0: a step's GITHUB_OUTPUT is its own, so a
    // later step writing `verdict=green` would leave `steps.verdict.outputs`
    // empty — and release-stable would never promote on a called run.
    const v = steps(b).filter((st) => /^ {8}id: verdict$/m.test(st));
    expect(v, 'exactly one step has id: verdict').toHaveLength(1);
    expect(runScript(v[0])).toBe('node .github/ci/verdict.mjs full\necho "verdict=green" >> "$GITHUB_OUTPUT"\n');
    expect(b.match(/verdict=green/g), 'verdict=green is written in one place').toHaveLength(1);
  });

  it('a shard runs exactly its list, through vitest.select.config.ts', () => {
    const run = 'CCRC_TEST_LIST="$RUNNER_TEMP/tests.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts ${VITEST_SHARD:+--shard=$VITEST_SHARD}';
    for (const id of ['server-shard', 'test-macos']) {
      expect(job(id), `${id}: the list file`).toContain(`echo "$FILES" | tr ' ' '\\n' > "$RUNNER_TEMP/tests.txt"`);
      expect(job(id), `${id}: the exact-list run`).toContain(run);
    }
  });

  it('every server-running job installs through server-deps, and the Linux arm installs strace', () => {
    for (const [id, platform] of [['server-shard', 'linux'], ['trace-shard', 'linux'], ['test-macos', 'macos']] as const) {
      expect(job(id), `${id} must install what any server file needs`)
        .toMatch(new RegExp(`^ {6}- uses: \\./\\.github/actions/server-deps\\n {8}with:\\n {10}platform: ${platform}$`, 'm'));
    }
    const a = read(DEPS);
    expect(a).toMatch(/^ {4}- name: Install system dependencies \(linux\)\n {6}if: inputs\.platform == 'linux'\n {6}shell: bash\n {6}run: sudo apt-get update && sudo apt-get install -y tmux jq strace python3$/m);
    expect(a).toMatch(/^ {4}- name: Install system dependencies \(macos\)\n {6}if: inputs\.platform == 'macos'\n {6}shell: bash\n {6}run: brew install bash tmux flock jq coreutils$/m);
    for (const pkg of ['server', 'agent', 'pwa']) {
      expect(a, `server-deps no longer installs ${pkg}/`).toMatch(new RegExp(`^ {6}working-directory: ${pkg}\\n {6}run: npm ci$`, 'm'));
    }
  });
});
```

- [ ] **Step 6: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts --maxWorkers=2
```

  Measured against today's `ci.yml`: `Tests  30 failed | 4 passed (34)`. The failures name the missing jobs —
  ``ci.yml has no job `select` `` (8), `` `map-build` `` (8), `` `server-shard` `` (3), `` `server` `` (3),
  `` `trace-shard` ``, `` `times-build` ``, `` `full-suite` `` — plus the missing `CCRC_LEG` switch,
  `concurrency: not found at column 0`, and `CCRC_SELECTION` (a second definition would shadow it). The four
  that pass already hold on today's file and are regression pins: no `paths:` filter, no job-level
  `if:`/`needs:` on `test`/`build-pwa`, every job has a deadline ≤ 60, no Actions cache.

- [ ] **Step 7: Implement the composite action** — `.github/actions/server-deps/action.yml`:

<!-- file: .github/actions/server-deps/action.yml -->
```yaml
# Everything a server test file needs before it can run, on either platform.
# ONE definition because every server job — each Linux shard, each trace
# shard, each macOS shard — can receive ANY server test file (design
# 2026-09-23 §10), so each must install what the whole suite needs. Before
# this action the list lived in two hand-kept copies (the `test` matrix's
# server leg and `test-macos`), and a dependency added to one was a red on
# the other.
#
# setup-node is NOT in here: it stays in each job, beside the comment that
# says which suite pins its node-version (see ci.yml's `server-shard`).
name: server-deps
description: System packages plus npm ci in server/, agent/ and pwa/ — what any server test file may need.

inputs:
  platform:
    description: linux or macos
    required: true

runs:
  using: composite
  steps:
    - name: Refuse an unknown platform
      if: inputs.platform != 'linux' && inputs.platform != 'macos'
      shell: bash
      env:
        PLATFORM: ${{ inputs.platform }}
      run: |
        echo "server-deps: platform must be linux or macos, got '$PLATFORM'" >&2
        exit 1

    # tmux, git and jq are real dependencies of the server suite: the ccd and
    # statusline tests execute the real bash scripts against fixture HOMEs.
    # They are contained, never reaching a real tmux server or a real remote,
    # but the binaries must exist. jq ships in the ubuntu-latest image today
    # and is named here anyway — `statusline-command.sh` degrades to a bare
    # `claude-code` line WITHOUT it, which is a pass for some assertions and
    # a silent hole for the ones that matter.
    #
    # strace, on EVERY Linux server job and not only the trace shards: the
    # trace runner's own suite (server/test/ci-trace-run.test.ts) runs the
    # real strace, and any shard may be handed that file. python3 is in the
    # image already and named for the same reason as jq — the `ccgpt-*`
    # suites assert it is present whenever `CI` is set.
    - name: Install system dependencies (linux)
      if: inputs.platform == 'linux'
      shell: bash
      run: sudo apt-get update && sudo apt-get install -y tmux jq strace python3

    # bash ≥ 4.2 (macOS ships 3.2 as /bin/bash; ccd's shebang is `env
    # bash`, so PATH decides and Homebrew's 5.x wins), tmux (the
    # substrate), flock (three call sites die by name without it), jq
    # (statusline-command.sh silently degrades without it).
    #
    # coreutils is g-PREFIXED (gtimeout, gsha256sum, …) and no gnubin ever
    # joins PATH, so the BSD userland stays honest: bare `timeout`,
    # `sha256sum`, `stat -c` are still absent and every Darwin arm still
    # runs. What coreutils buys is `gtimeout` — `_plat_timeout`'s own
    # documented Darwin fallback — without which the shim degrades to NO
    # deadline and every wedge-shaped fixture (a tmux that never answers,
    # a stall-budget probe) hangs to the test clock instead of being cut:
    # the first leg run measured exactly that, 40 tests shed at 20s.
    - name: Install system dependencies (macos)
      if: inputs.platform == 'macos'
      shell: bash
      run: brew install bash tmux flock jq coreutils

    - name: Install server
      shell: bash
      working-directory: server
      run: npm ci

    # server/test/typecheck-tests.test.ts spawns tsc against agent/'s own
    # tests-inclusive project too (`agentRoot` resolved two levels up) — a
    # deliberate cross-package check, so it needs agent/node_modules present
    # even though the job under test is the server's.
    - name: Install agent dependencies (needed by server's cross-package typecheck test)
      shell: bash
      working-directory: agent
      run: npm ci

    # Same cross-package need, for pwa: typecheck-tests.test.ts also spawns
    # tsc against `pwa/tsconfig.json` (pwaRoot, resolved the same way as
    # agentRoot) to close the "pwa's own `vitest run` never asks tsc
    # anything" gap. Without pwa/node_modules here, that spawn fails on
    # unresolvable imports (react, zustand, vite/client, …) — a dependency
    # error, not a type error — and the assertion would report pwa "has
    # type errors" for the wrong reason.
    - name: Install pwa dependencies (needed by server's cross-package typecheck test)
      shell: bash
      working-directory: pwa
      run: npm ci
```

- [ ] **Step 8: Implement the pipeline** — replace `.github/workflows/ci.yml` entirely with:

<!-- file: .github/workflows/ci.yml -->
```yaml
# The monorepo had no CI at all — these suites have only ever been run by hand,
# which is how an installed ccd sat 4,258 lines behind main without anyone
# noticing. This is the mechanism that keeps the extraction honest after the
# day it lands.
#
# ONE pipeline, several MODES (design 2026-09-23 §3). The trigger decides the
# mode, the `select` job computes what that mode runs, and every other job
# reads select's outputs:
#   pull_request        selected — the server tests the change can affect
#                       (a measured dependency map, .github/ci/select-tests.mjs),
#                       sharded; agent, pwa, build-pwa and probe-macos in full.
#   push to main        refresh  — re-trace the tests the merge affected and
#                       update the map. No test legs.
#   schedule (daily)    full     — every leg, macOS included, plus a traced
#                       rebuild of the map. Skipped when main's head already
#                       carries a green `full-suite`.
#   workflow_dispatch   full (default) or rebuild.
#   workflow_call       the mode the caller passes — release-stable.yml's
#                       gate runs `full` here before it promotes.
# While CCRC_SELECTION (below) says `shadow`, `selected` mode computes and
# reports its selection but still runs every server test.
name: ci

# Least privilege, stated rather than inherited (2026-08-23). The default for
# this repo already computes to read-only, and no job here needs more — CI only
# reads the tree and runs suites. Declaring it means a later job that DOES want
# write has to ask in the diff, where a reviewer sees it, instead of silently
# receiving whatever the org default happens to be that week. Especially worth
# fixing before the repo is public: `pull_request` (not `pull_request_target`)
# already gives a fork's run a read-only token and no secrets, and this keeps
# that true if the org default is ever loosened. The one job that asks for
# more is `select`, and what it asks for is `checks: read` — in the diff.
permissions:
  contents: read

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '17 3 * * *'
  # Manual re-run for the day the webhooks don't come: during the 2026-08-06
  # Actions incident GitHub processed ~15% of webhooks, so pushes and PR
  # events silently created NO run. `gh workflow run ci.yml --ref <branch>`
  # starts one; it uses the workflow file from the ref it is dispatched on.
  # Whether its checks then satisfy a PR's required checks is NOT settled:
  # GitHub's "Troubleshooting required status checks" says checks from a
  # `workflow_dispatch` run do not satisfy a RULESET's required checks, and
  # `main` is guarded by classic branch protection, against which this has
  # never been tested. Treat it as the way to get the suites' answer, not as
  # a way to unblock a merge.
  workflow_dispatch:
    inputs:
      mode:
        description: 'full: every leg, a verdict (no trace). rebuild: trace every server test and rebuild the map.'
        type: choice
        options: [full, rebuild]
        default: full
  workflow_call:
    inputs:
      mode:
        description: The mode to run; release-stable.yml passes full.
        type: string
        default: full
    outputs:
      verdict:
        description: "`green` iff this run's full-suite job ran and every leg it needs succeeded; empty otherwise."
        value: ${{ jobs.full-suite.outputs.verdict }}

# The switch that turns selection on (design 2026-09-23 §12 step 5). In
# `shadow`, `select` computes and reports everything, but the shards
# still run every server test; `enforce` makes a pull request run only what
# was selected. One line, defined once — server/test/ci-pipeline.test.ts.
env:
  CCRC_SELECTION: shadow

# Pull requests: one group per PR, and a newer push cancels the older run.
# Everything else never cancels, and each mode has its own group, so a merge's
# refresh can never cancel the daily run. `ci-` first because when
# release-stable.yml CALLS this file the group is evaluated in the caller's
# context, where `github.workflow` is `release-stable` — without the prefix the
# called run would wait on the caller's own group.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || (github.event_name == 'push' && !inputs.mode) && 'refresh' || format('{0}-{1}-{2}', inputs.mode || 'full', github.event_name, github.ref_name) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  # What this run runs (design 2026-09-23 §4.1, §6). Dependency-free Node, so
  # it runs before any `npm ci`. Every uncertainty — no map, an unreadable one,
  # a change under .github/ or to a lockfile, any internal error — answers
  # `full` with the reason; it never answers "nothing". If this job itself
  # dies, `test (server)` below goes red.
  select:
    name: select tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # checks: read — the daily run asks whether main's head already carries a
    # green `full-suite` check before it spends an hour proving it again.
    # actions: read — the map and the durations are artifacts of trusted
    # main runs, listed and downloaded here.
    permissions:
      contents: read
      checks: read
      actions: read
    outputs:
      tests: ${{ steps.select.outputs.tests }}
      trace: ${{ steps.select.outputs.trace }}
      shadow: ${{ steps.select.outputs.shadow }}
      count: ${{ steps.select.outputs.count }}
      macos_count: ${{ steps.select.outputs.macos_count }}
      server_matrix: ${{ steps.select.outputs.server_matrix }}
      macos_matrix: ${{ steps.select.outputs.macos_matrix }}
      trace_matrix: ${{ steps.select.outputs.trace_matrix }}
      trace_count: ${{ steps.select.outputs.trace_count }}
      map_sha: ${{ steps.select.outputs.map_sha }}
      fallback: ${{ steps.select.outputs.fallback }}
    steps:
      # Full depth: the changed set is `git diff <map-sha> HEAD`, and the map's
      # commit must be present to be diffed against.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # A pull request that changes the pipeline runs the full suite — decided
      # HERE, in plain bash, not by the selector the pull request may be
      # changing (select-tests.mjs's own `.github/` trigger is a second line).
      # A base it cannot diff against answers "changed": the safe direction.
      - name: Does this pull request change the pipeline?
        id: pipeline
        if: github.event_name == 'pull_request'
        env:
          BASE_REF: ${{ github.base_ref }}
        run: |
          if base=$(git merge-base "origin/$BASE_REF" HEAD) && changed=$(git diff --name-only "$base" HEAD -- .github/); then
            if [ -n "$changed" ]; then
              echo "changed=true" >> "$GITHUB_OUTPUT"
              printf 'this pull request changes the pipeline:\n%s\n' "$changed"
            else
              echo "changed=false" >> "$GITHUB_OUTPUT"
            fi
          else
            echo "::warning::could not diff this pull request against origin/$BASE_REF; treating its pipeline as changed"
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi
      # The newest map and duration table come ONLY from artifacts of trusted
      # ci.yml runs on main (main-artifact.mjs: branch main, this repository,
      # a push, schedule or dispatch) — never from the Actions cache, whose PR
      # scope a pull request can write. Nothing found, or a failed download,
      # means no map: a full run. The artifact id is kept for map-build's
      # check, just before it publishes, that this map is still the newest.
      - name: Fetch the newest trusted map and durations
        env:
          GITHUB_TOKEN: ${{ github.token }}
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          REPO_ID: ${{ github.repository_id }}
        run: |
          mkdir -p .ci-cache
          for name in testmap testtimes; do
            out=$(GITHUB_OUTPUT='' node .github/ci/main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name "$name")
            printf '%s\n' "$out"
            run_id=$(printf '%s\n' "$out" | sed -n 's/^run_id=//p')
            artifact_id=$(printf '%s\n' "$out" | sed -n 's/^artifact_id=//p')
            if [ -n "$run_id" ]; then
              if gh run download "$run_id" --repo "$REPO" -n "$name" -D .ci-cache; then
                echo "$artifact_id" > ".ci-cache/$name.artifact"
              else
                echo "::warning::could not download $name from run $run_id; going without it"
              fi
            fi
          done
      # Any failure to read the checks answers "not green", which runs the
      # suite — the safe direction.
      - name: Does this commit already carry a green full-suite?
        id: green
        if: github.event_name == 'schedule'
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          SHA: ${{ github.sha }}
        run: |
          if ids=$(gh api --paginate "repos/$REPO/commits/$SHA/check-runs?per_page=100" \
              --jq '.check_runs[] | select(.conclusion == "success" and .app.slug == "github-actions" and (.name == "full-suite" or (.name | endswith("/ full-suite")))) | .id'); then
            if [ -n "$ids" ]; then echo "full_green=true" >> "$GITHUB_OUTPUT"; else echo "full_green=false" >> "$GITHUB_OUTPUT"; fi
          else
            echo "::warning::could not read this commit's check runs; running the full suite rather than skipping it"
            echo "full_green=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Select
        id: select
        env:
          EVENT: ${{ github.event_name }}
          INPUT_MODE: ${{ inputs.mode }}
          FULL_GREEN: ${{ steps.green.outputs.full_green || 'false' }}
          PIPELINE_CHANGED: ${{ steps.pipeline.outputs.changed }}
        run: |
          args=(--repo "$GITHUB_WORKSPACE" --event "$EVENT" --selection "$CCRC_SELECTION" --full-green "$FULL_GREEN" --map .ci-cache/testmap.json --trace-list .ci-cache/traced.txt)
          if [ -n "$INPUT_MODE" ]; then args+=(--input-mode "$INPUT_MODE"); elif [ "$PIPELINE_CHANGED" = true ]; then args+=(--input-mode full); fi
          if [ -f .ci-cache/testtimes.json ]; then args+=(--times .ci-cache/testtimes.json); fi
          node .github/ci/select.mjs "${args[@]}"
      # map-build refreshes against EXACTLY the map this job diffed from, not
      # whatever is newest by the time it runs, and is told which tests this
      # job MEANT to trace — a test whose trace never arrived is written
      # unknown instead of keeping its stale entry — and which artifact the
      # map was, for its check before it publishes. A build (a rebuild, or a
      # refresh that had no map) gets the fetched map too, if there was one:
      # only to tell a test that NEWLY fails under trace from one that already
      # did. traced.txt is always there, so the upload never finds nothing.
      # Hidden directory, so upload-artifact must be told to include it.
      - name: Hand the map to map-build
        if: steps.select.outputs.trace != 'none'
        uses: actions/upload-artifact@v4
        with:
          name: select-inputs
          path: |
            .ci-cache/testmap.json
            .ci-cache/traced.txt
            .ci-cache/testmap.artifact
          include-hidden-files: true
          if-no-files-found: error
          retention-days: 3

  # The selected server tests, split across runners (design 2026-09-23 §7).
  # Skipped when nothing is selected — `test (server)` checks that the skip
  # was for that reason and no other.
  server-shard:
    name: server ${{ matrix.shard }}/${{ matrix.total }}
    needs: select
    if: needs.select.outputs.count != '0' && (needs.select.outputs.tests == 'selected' || needs.select.outputs.tests == 'full')
    runs-on: ubuntu-latest
    # A deadline, not the default. Without this key a wedged job runs for
    # GitHub's 360 minutes before anyone learns it wedged. Each shard is
    # packed to about four minutes (a file longer than that gets a shard of
    # its own), and the whole unsharded server leg measured 18.5 min at the
    # median (21.5 max, 2026-09-23) — so 30 is a deadline even for a shard
    # that received the entire suite. Pinned — key AND ceiling — by
    # server/test/oss-metadata.test.ts.
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.select.outputs.server_matrix) }}
    steps:
      # `fetch-depth: 0`, not the default 1, because topology-clean.test.ts
      # scans the commit RANGE this branch adds — not only the tip — and it
      # needs `origin/main` present to resolve a base. At depth 1 that ref does
      # not exist; the suite is written to go RED on a missing base rather than
      # quietly measure nothing, so removing this line breaks CI loudly instead
      # of disarming the history guard in silence.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          # Above the engines floor in server/agent/pwa package.json
          # (>=22.13.0, where node:sqlite stopped needing --experimental-sqlite).
          # server/test/node-floor.test.ts runs THREE assertions on whichever
          # server shard receives it, and they are not symmetric. (An edit to
          # this line is an edit under .github/, which always selects the full
          # suite — so node-floor always runs against a changed node-version.)
          # Assertion 2 is RELATIVE and ONE-DIRECTIONAL: it asserts THIS
          # interpreter satisfies the declared `engines.node`. It catches this
          # node-version being lowered below the floor; it does NOT catch the
          # floor itself being lowered to meet a low node-version — a floor at
          # or below whatever interpreter is running stays green on assertion 2
          # alone. Measured, not assumed: mirroring all three package.jsons to
          # `>=22.0.0` left assertions 1-2 green under this box's 24.x
          # interpreter, well ABOVE the real node:sqlite flag boundary — so
          # that experiment says nothing about assertion 3. (Not independently
          # re-measured under a 22.x interpreter: this box has no other `node`
          # binary and no nvm/fnm/volta/n to fetch one, and this branch has
          # never been pushed, so CI's own 22.x leg has never run it either —
          # the 24.x result alone is enough to support the point above.)
          # Assertion 3 is ABSOLUTE: it `import()`s node:sqlite and round-trips
          # a DatabaseSync, reading no package.json at all, so it fails on any
          # interpreter below 22.13.0 no matter what `engines.node` says. It is
          # what catches BOTH sides — this node-version AND every
          # `engines.node` — being lowered together (e.g. to appease a pinned
          # 22.10 runner), which is exactly the case assertion 2 cannot see.
          # Nothing anywhere pins this node-version string against
          # `engines.node`'s number directly; that gap is closed only by
          # assertion 3 actually exercising node:sqlite.
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json

      - uses: ./.github/actions/server-deps
        with:
          platform: linux

      # Local binary, never npx: `npx vitest` resolves to a global cache copy
      # with no jsdom and falsely reports "no tests" alongside 39 errors.
      # Positional file arguments are SUBSTRING filters (`a.test.ts` also runs
      # `xa.test.ts`), so the shard's list goes through vitest.select.config.ts,
      # whose include is exactly the listed paths. The JSON report is the
      # per-file durations the daily run publishes for the next plan.
      - name: Test
        working-directory: server
        env:
          FILES: ${{ matrix.files }}
          VITEST_SHARD: ${{ matrix.vitest_shard }}
        run: |
          echo "$FILES" | tr ' ' '\n' > "$RUNNER_TEMP/tests.txt"
          CCRC_TEST_LIST="$RUNNER_TEMP/tests.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts ${VITEST_SHARD:+--shard=$VITEST_SHARD} --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/times.json"

      - name: Keep the durations
        if: always() && needs.select.outputs.tests == 'full'
        uses: actions/upload-artifact@v4
        with:
          name: times-${{ matrix.shard }}
          path: ${{ runner.temp }}/times.json
          if-no-files-found: warn
          retention-days: 3

  server-typecheck:
    name: typecheck (server)
    needs: select
    if: needs.select.outputs.tests == 'selected' || needs.select.outputs.tests == 'full'
    runs-on: ubuntu-latest
    # tsc over server/src alone; about a minute. 15 carries a cold npm cache.
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: server/package-lock.json
      - name: Install
        working-directory: server
        run: npm ci
      - name: Typecheck
        working-directory: server
        run: ./node_modules/.bin/tsc --noEmit

  # THE REQUIRED `test (server)` CHECK (design 2026-09-23 §4.2). A summary,
  # because the server tests now run as a variable number of shards and a
  # required check needs one fixed name. `if: always()` because a job whose
  # `needs:` failed is SKIPPED, and GitHub reports a skipped job as SUCCESS
  # — written the obvious way, a crashed selector would be a green check.
  # verdict.mjs is red unless select succeeded, the typecheck succeeded, and
  # the shards succeeded or were skipped because select counted zero — and a
  # pull request that answered tests none is red too (EVENT, from the
  # workflow's own context). The first step reads the job results with no
  # script at all and can only ADD red: a no-op verdict.mjs cannot turn a
  # failed prerequisite green.
  server:
    name: test (server)
    needs: [select, server-shard, server-typecheck]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Refuse a prerequisite that did not succeed (no script involved)
        if: needs.select.result != 'success' || contains(fromJSON('["failure","cancelled"]'), needs.server-shard.result) || contains(fromJSON('["failure","cancelled"]'), needs.server-typecheck.result)
        run: exit 1
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Verdict
        env:
          SELECT_RESULT: ${{ needs.select.result }}
          TYPECHECK_RESULT: ${{ needs.server-typecheck.result }}
          SHARDS_RESULT: ${{ needs.server-shard.result }}
          TESTS: ${{ needs.select.outputs.tests }}
          COUNT: ${{ needs.select.outputs.count }}
          EVENT: ${{ github.event_name }}
        run: node .github/ci/verdict.mjs server

  # `test (agent)` and `test (pwa)` — required BY NAME, so this matrix keeps
  # its id, its axis and its values, and carries no job-level `if:` or
  # `needs:`: a skipped matrix never expands, and the two checks would never
  # appear (design 2026-09-23 §4.2). On a refresh or a rebuild every STEP is
  # skipped instead, which reports the checks green without running them.
  # Not selected: together they take under three minutes (§3).
  test:
    runs-on: ubuntu-latest
    # A deadline, not the default. Without this key a wedged job runs for
    # GitHub's 360 minutes before anyone learns it wedged; the slowest leg
    # here is `pwa` at about 2.5 minutes (measured 2026-09-23), so 30 is a
    # deadline with room for a cold npm cache, not a guess at the real thing.
    # Pinned — key AND ceiling — by server/test/oss-metadata.test.ts.
    timeout-minutes: 30
    env:
      CCRC_LEG: ${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild') && 'skip' || 'run' }}
    strategy:
      fail-fast: false
      matrix:
        package: [agent, pwa]
    steps:
      # Full depth, as when this matrix also carried the server leg (whose
      # topology-clean needs `origin/main` — see server-shard): unchanged, so
      # the agent and pwa suites meet the tree exactly as before.
      - uses: actions/checkout@v4
        if: env.CCRC_LEG == 'run'
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        if: env.CCRC_LEG == 'run'
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: ${{ matrix.package }}/package-lock.json

      - name: Install
        if: env.CCRC_LEG == 'run'
        working-directory: ${{ matrix.package }}
        run: npm ci

      # Local binary, never npx: `npx vitest` resolves to a global cache copy
      # with no jsdom and falsely reports "no tests" alongside 39 errors.
      - name: Test
        if: env.CCRC_LEG == 'run'
        working-directory: ${{ matrix.package }}
        run: ./node_modules/.bin/vitest run

      - name: Typecheck
        if: env.CCRC_LEG == 'run'
        working-directory: ${{ matrix.package }}
        run: ./node_modules/.bin/tsc --noEmit

  # The Darwin arms' standing mechanism (the macOS port's review, finding 3):
  # every `describe.skipIf(!IS_DARWIN)` block and `itDarwin` case in the
  # server suite skips on every ubuntu leg above, so without this job the
  # port's launchd/BSD paths are verified exactly once — on the author's own
  # box, unreproducibly — and never again after merge. This leg is what
  # turns those tests from prose into a mechanism.
  #
  # A SEPARATE JOB, not a matrix `os` dimension, deliberately: branch
  # protection requires the checks `test (server)` / `test (agent)` /
  # `test (pwa)` / `build-pwa` BY NAME, and adding a matrix axis to `test`
  # renames two of them. `test-macos` is additive and non-required — a red
  # here blocks no pull request, which is the right cost while the leg earns
  # trust, and the PR page still shows it. It DOES gate a promotion:
  # `full-suite` below needs it green (design 2026-09-23 ruling 6).
  #
  # Server package only: it owns the ccd/ccrc/doctor/expose/update suites and
  # every Darwin test in the tree. No tsc step — types have no platform.
  #
  # Sharded across machines, never across workers: the unsharded leg had
  # outgrown its deadline (the last 13 completed legs to 2026-09-23 were all
  # cut at 55 minutes), and it runs ONE vitest worker, because `maxWorkers:
  # '40%'` rounds to 1 on the 3-CPU runner — a setting vitest.config.ts argues
  # for on flake grounds. At most 2 shards on a pull request and 4 in full, so
  # the organisation's 5-job macOS cap still leaves room for `probe-macos`.
  test-macos:
    name: test-macos ${{ matrix.shard }}/${{ matrix.total }}
    needs: select
    if: needs.select.outputs.macos_count != '0' && (needs.select.outputs.tests == 'selected' || needs.select.outputs.tests == 'full')
    runs-on: macos-latest
    # 55, not the 30 of a Linux shard, and the number is the measurement
    # rather than a round multiple of one run. Six green unsharded legs
    # (2026-08-27): 18.6, 21.1, 21.9, 23.3, 24.7, 28.1 minutes — brew, then the
    # whole server suite on a slower runner, with real spread. 45 was picked
    # from the first two of those and was 1.6x the max once all six were in;
    # 55 is ~2x, which is the headroom a runner this variable needs before a
    # slow-but-healthy leg starts reading as a wedge. A shard carries a
    # fraction of that suite, so 55 is now generous rather than tight.
    #
    # It is also the leg that most needs a deadline at all: this suite has
    # already hung here once, on its first run, when a missing `gtimeout` left
    # `_plat_timeout` with no deadline of its own. A wedge is unbounded;
    # nothing near 55 is. The cost of a wedge here is not money — standard
    # hosted runners, macOS included, are free on a public repository — but
    # wall-clock, and one of the organisation's five concurrent macOS slots
    # (queue waits of 13-18 minutes measured, 2026-09-23).
    timeout-minutes: 55
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.select.outputs.macos_matrix) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json
      # bash, tmux, flock, jq and coreutils from Homebrew — the reasons are
      # in the action, beside the install line.
      - uses: ./.github/actions/server-deps
        with:
          platform: macos
      - name: Test
        working-directory: server
        env:
          FILES: ${{ matrix.files }}
          VITEST_SHARD: ${{ matrix.vitest_shard }}
        run: |
          echo "$FILES" | tr ' ' '\n' > "$RUNNER_TEMP/tests.txt"
          CCRC_TEST_LIST="$RUNNER_TEMP/tests.txt" ./node_modules/.bin/vitest run --config vitest.select.config.ts ${VITEST_SHARD:+--shard=$VITEST_SHARD}

  # THE PROBE LEG — a platform CONTRACT check that is not hostage to the suite.
  #
  # `test-macos` above is a 303-file run, and it has stopped being able to
  # report: of its three runs on 2026-09-12 one completed at 39 min and TWO
  # were cut at the 55-minute deadline mid-`Test`, answering nothing. A leg
  # that cannot finish cannot be iterated against, and D-2614 — a credential
  # path that fails on macOS and only macOS — can only be settled by asking a
  # real Mac a question and reading the answer.
  #
  # So this job asks exactly one file's worth of questions about what
  # `script(1)` does on this userland, in about two minutes. It is deliberately
  # NOT folded into `test-macos`: the whole point is that its answer survives
  # whatever the big suite does, including being cut. Same reason it is not
  # required — it reports, it does not gate. (Sharding `test-macos` changes
  # none of this: the probe still must not wait on, or share a fate with, the
  # selector; so it reads no select output, and `full-suite` does not need it.)
  #
  # `--reporter=verbose` because the answer travels in the assertion MESSAGE
  # (each case carries `script`'s rc and stderr), and the default reporter
  # elides those for passing cases.
  probe-macos:
    # Pull requests and the daily run only: an advisory probe must not gate a
    # dispatched full run, or release-stable's called one.
    if: github.event_name == 'pull_request' || github.event_name == 'schedule'
    runs-on: macos-latest
    # 25, not 10. The first run was cut at 10 with the auth suite still going,
    # and the reason is D-2661 rather than the suite being big: several cases
    # ran to the fixture's 60_000 ms `execFileSync` cap against deadlines of 6
    # to 25 seconds, because `_plat_timeout`'s deadline intermittently does not
    # fire on this runner. One of them (`runs the UPSTREAM launcher…`) still
    # PASSED at 60078 ms, since its assertions read files rather than `rc` — so
    # the symptom is silent cost, not a red.
    #
    # 25 is ~2x the observed worst case with several such stalls, and stays well
    # under `oss-metadata.test.ts`'s 60-minute ceiling. It is a budget for a
    # KNOWN defect, not headroom for an unknown one: when D-2661 closes this
    # should come back down.
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: server/package-lock.json
      # The same set as `test-macos`, and for the same reasons — this leg now
      # runs the auth helper's own suite too, which drives `_plat_timeout`
      # (whose Darwin fallback is `gtimeout`, from coreutils), plants tmux and
      # flock stubs, and reads jq.
      #
      # An earlier revision of this job installed `bash` alone, reasoning that
      # `gtimeout`'s absence is what D-2661 suspects and the leg should meet the
      # userland bare. That conflated two things: the `script(1)` probe never
      # calls `timeout`, so coreutils cannot colour its measurement, while the
      # auth suite would have hung for D-2661's reason and reported nothing
      # about the darwin arm. Measuring the deadline shim bare is a DIFFERENT
      # probe and needs its own job, not this one's omission.
      - name: Install system dependencies
        run: brew install bash tmux flock jq coreutils
      - name: Install
        working-directory: server
        run: npm ci
      - name: Probe
        working-directory: server
        run: ./node_modules/.bin/vitest run test/script-shim-platform.test.ts test/compact-lock-darwin-probe.test.ts --reporter=verbose
      # THE TWO PANE-BOUND DESCRIBES ONLY, and the narrowing is the point.
      #
      # This step began as the whole `ccd-account-auth.test.ts` file and was cut
      # at 10 minutes, then again at 25 — not because the file is big (~40s on
      # linux) but because D-2661 makes individual cases run to the fixture's
      # 60_000 ms cap instead of their 6-to-25-second deadlines. Most of that
      # cost is in describes that have nothing to do with D-2614.
      #
      # `setup-token` and `openai-login` are the two methods that go through
      # `script(1)`, so they are the two D-2673 changes the shape of, and they
      # are the whole question this leg exists to answer. Everything else about
      # the helper is already answered on linux and by `test-macos` when it
      # manages to finish.
      #
      # Measured on 52934a2e, the run this replaces: `the mint exited 1`
      # appeared ZERO times, against NINE before the fix, with the setup-token
      # describe demonstrably reached. That is what says D-2673 works; this
      # narrowing is what lets a run say it without being cut first.
      # The spawn must TERMINATE — the D-2734 property, asked on the platform
      # whose arm it is. These cases force `CCD_OS` themselves, so they are red
      # on Linux too; running them here checks the real userland agrees.
      # THE TWO QUESTIONS D-2614's work left open, and neither can be asked on
      # Linux. Placed FIRST because they are pure measurement: they change no
      # shipped code, and if a later step reds we still get their answer.
      - name: Platform hazards — the deadline, and grep over a FIFO (D-2661, D-2739)
        working-directory: server
        run: ./node_modules/.bin/vitest run test/platform-hazards.test.ts --reporter=verbose
      - name: The pane-bound spawn terminates (D-2734..D-2737)
        working-directory: server
        run: ./node_modules/.bin/vitest run test/ccd-account-auth.test.ts --reporter=verbose -t 'spawn has to END'
      - name: The two pane-bound methods (what D-2673 changes)
        working-directory: server
        run: ./node_modules/.bin/vitest run test/ccd-account-auth.test.ts --reporter=verbose -t 'setup-token|openai-login'

  build-pwa:
    runs-on: ubuntu-latest
    # Under a minute in practice; 15 is headroom for a cold npm cache.
    timeout-minutes: 15
    # Required by name, like `test`: no job-level `if:`, steps skip instead.
    env:
      CCRC_LEG: ${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild') && 'skip' || 'run' }}
    steps:
      - uses: actions/checkout@v4
        if: env.CCRC_LEG == 'run'
      - uses: actions/setup-node@v4
        if: env.CCRC_LEG == 'run'
        with:
          # '22' here for consistency with the server shards, not because
          # anything checks it. This job runs `npm run build` in pwa/ and
          # never invokes vitest, so server/test/node-floor.test.ts — which
          # only exists as a `server` package test — does NOT execute on this
          # leg. Lowering node-version here, alone, is caught by nothing in
          # this workflow; only the `server-shard` job's node-version is
          # gated, and only against the interpreter falling below the
          # declared floor (see the comment on that job's setup-node step).
          node-version: '22'
          cache: npm
          cache-dependency-path: pwa/package-lock.json
      - if: env.CCRC_LEG == 'run'
        working-directory: pwa
        run: npm ci && npm run build
      # The build is only proven by its output existing. A green build step with
      # no artifact is the failure this repo has already shipped once.
      - if: env.CCRC_LEG == 'run'
        run: test -f server/dist-pwa/index.html

  # The traced runs that build the dependency map (design 2026-09-23 §5): each
  # listed server test in its own vitest process under strace. Scheduled
  # runs and manual rebuilds trace every file; a refresh traces what the
  # merge affected. Its test results are NOT a verdict — tracing perturbs
  # the timing-budget tests: a traced test that fails is recorded `unknown`,
  # so the map selects it until a clean trace replaces it, and trace-run.mjs
  # still exits 0. What goes red is map-build, and only for a test that
  # NEWLY fails under trace (spec §5.4). The records are kept even when the
  # Trace step itself fails.
  trace-shard:
    name: trace ${{ matrix.shard }}/${{ matrix.total }}
    needs: select
    if: needs.select.outputs.trace != 'none' && needs.select.outputs.trace_count != '0'
    runs-on: ubuntu-latest
    # Tracing costs 1.7-4.3x wall-clock (measured on the fleet box), and the
    # shard planner packs trace shards to about 15 minutes at that cost; 60 is
    # oss-metadata.test.ts's ceiling and the most any job here may take.
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.select.outputs.trace_matrix) }}
    steps:
      # Full depth for the same reason as server-shard: the traced tests are
      # the real tests, topology-clean included.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json
      - uses: ./.github/actions/server-deps
        with:
          platform: linux
      # Exactly this row's files. The trace plan is always a real partition —
      # select.mjs packs it by duration, or at a default per file when none is
      # known yet — so there is no vitest `i/n` to split here.
      - name: Trace
        env:
          FILES: ${{ matrix.files }}
        run: |
          echo "$FILES" | tr ' ' '\n' > "$RUNNER_TEMP/trace.txt"
          node .github/ci/trace-run.mjs --repo "$GITHUB_WORKSPACE" --files "$RUNNER_TEMP/trace.txt" --out "$RUNNER_TEMP/records.json" --jobs 2 --timeout 1560
      - name: Keep the records
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: records-${{ matrix.shard }}
          path: ${{ runner.temp }}/records.json
          if-no-files-found: error
          retention-days: 3

  # Merges the trace shards into a map for this commit and publishes it
  # (design 2026-09-23 §5.3-§5.5). Runs after a failed trace shard too (a
  # crashed trace-run — a traced test that fails is only recorded `unknown`),
  # but refuses when a shard left NO records file at all. A refresh is also
  # told what select MEANT to trace (`--traced`), so a test missing from the
  # records that did arrive is written `unknown` rather than keeping its old
  # entry: those are exactly the tests the merge affected. The map is
  # published as the `testmap` artifact — what select fetches next time, and
  # what a replay (spec §11.3) fetches. testmap.mjs exits 3 when a traced test
  # NEWLY fails under trace (failing now, not unknown in the map this run
  # started from) and 4 when a floor test lost its breadth — both only AFTER
  # the map is written, so the map is published anyway and the job's last
  # step turns it red. A test that always fails under tracing reds the first
  # build that sees it, not every run after (spec §5.4).
  map-build:
    needs: [select, trace-shard]
    if: always() && needs.select.result == 'success' && needs.select.outputs.trace_count != '0' && (needs.trace-shard.result == 'success' || needs.trace-shard.result == 'failure')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # actions: read — the check before a refresh publishes asks which trusted
    # map is newest.
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/download-artifact@v4
        with:
          pattern: records-*
          path: ${{ runner.temp }}/records
      - name: Fetch what select handed over
        uses: actions/download-artifact@v4
        with:
          name: select-inputs
          path: ${{ runner.temp }}/select-inputs
      - name: Build the map
        id: build
        env:
          TRACE: ${{ needs.select.outputs.trace }}
          MAP_SHA: ${{ needs.select.outputs.map_sha }}
          TRACE_MATRIX: ${{ needs.select.outputs.trace_matrix }}
        run: |
          want=$(node -e 'console.log(JSON.parse(process.env.TRACE_MATRIX).include.length)')
          mkdir -p "$RUNNER_TEMP/flat" .ci-cache
          got=0
          for d in "$RUNNER_TEMP"/records/records-*; do
            if [ -f "$d/records.json" ]; then cp "$d/records.json" "$RUNNER_TEMP/flat/$(basename "$d").json"; got=$((got + 1)); fi
          done
          if [ "$got" -ne "$want" ]; then
            echo "::error::$got of $want trace shards left records; no map is written for this commit"
            exit 1
          fi
          git ls-tree -r --name-only HEAD -- server/test | grep '\.test\.ts$' > "$RUNNER_TEMP/live.txt"
          old=()
          if [ -f "$RUNNER_TEMP/select-inputs/testmap.json" ]; then old=(--old "$RUNNER_TEMP/select-inputs/testmap.json"); fi
          rc=0
          if [ "$TRACE" = refresh ] && [ -n "$MAP_SHA" ]; then
            node .github/ci/testmap.mjs refresh --sha "$GITHUB_SHA" --old "$RUNNER_TEMP/select-inputs/testmap.json" \
              --records "$RUNNER_TEMP/flat" --live "$RUNNER_TEMP/live.txt" --traced "$RUNNER_TEMP/select-inputs/traced.txt" \
              --out .ci-cache/testmap.json || rc=$?
          else
            node .github/ci/testmap.mjs build --sha "$GITHUB_SHA" "${old[@]}" --records "$RUNNER_TEMP/flat" --out .ci-cache/testmap.json || rc=$?
          fi
          echo "rc=$rc" >> "$GITHUB_OUTPUT"
          # 3 and 4 come after the map is written: publish it, go red at the end.
          if [ "$rc" != 0 ] && [ "$rc" != 3 ] && [ "$rc" != 4 ]; then exit "$rc"; fi
      # A refresh publishes only if, when checked just before the upload, the
      # map it was built on is still the newest trusted map (a daily rebuild,
      # or another refresh, may have published since select fetched it). The
      # check and the upload are two steps, not one atomic act: a map
      # published in the seconds between them is not seen, and this refresh's
      # map then becomes the newest. The worst case is that a rebuild's
      # corrections wait for the next rebuild; selection stays safe, because
      # every map is a correct map for its own commit. A rebuild, or a
      # refresh that had no map and traced everything, always publishes.
      - name: Is the map this refresh was built on still the newest?
        id: cas
        if: needs.select.outputs.trace == 'refresh' && needs.select.outputs.map_sha != ''
        env:
          GITHUB_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          REPO_ID: ${{ github.repository_id }}
        run: |
          base=$(cat "$RUNNER_TEMP/select-inputs/testmap.artifact")
          newest=$(GITHUB_OUTPUT='' node .github/ci/main-artifact.mjs --repo "$REPO" --repo-id "$REPO_ID" --name testmap | sed -n 's/^artifact_id=//p')
          if [ -n "$base" ] && [ "$newest" = "$base" ]; then
            echo "publish=true" >> "$GITHUB_OUTPUT"
          else
            echo "::notice::the map this refresh was built on (artifact $base) is no longer the newest trusted map (${newest:-none}); not publishing — the next refresh diffs from the newer one"
            echo "publish=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Keep the map as an artifact
        if: steps.cas.outputs.publish != 'false'
        uses: actions/upload-artifact@v4
        with:
          name: testmap
          path: .ci-cache/testmap.json
          include-hidden-files: true
          if-no-files-found: error
          retention-days: 14
      # Last, so the map above is published first: the Build step's
      # annotations name each test (3: newly fails under trace; 4: a floor test
      # written unknown). Both stay selected — an unknown test always runs.
      - name: Red if the map build reported news
        if: steps.build.outputs.rc != '0'
        env:
          RC: ${{ steps.build.outputs.rc }}
        run: |
          echo "::error::the map was published, but testmap.mjs exited $RC — read the Build the map step's annotations"
          exit 1

  # The per-file durations the shard planner packs by, from the untraced
  # full run's JSON reports, published as the `testtimes` artifact. Only on
  # main: select reads durations only from trusted main runs anyway.
  times-build:
    needs: [select, server-shard]
    if: always() && needs.select.outputs.tests == 'full' && github.ref == 'refs/heads/main' && (needs.server-shard.result == 'success' || needs.server-shard.result == 'failure')
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: actions/download-artifact@v4
        with:
          pattern: times-*
          path: ${{ runner.temp }}/times
      - name: Merge the durations
        run: |
          mkdir -p .ci-cache
          node .github/ci/shards.mjs times --out .ci-cache/testtimes.json "$RUNNER_TEMP"/times/*/times.json
      - name: Keep the durations as an artifact
        uses: actions/upload-artifact@v4
        with:
          name: testtimes
          path: .ci-cache/testtimes.json
          include-hidden-files: true
          if-no-files-found: error
          retention-days: 14

  # THE STABLE GATE'S EVIDENCE (design 2026-09-23 §8). Exists only in `full`
  # mode, and is green iff every leg is — the Linux shards through their
  # summary, the typecheck, agent, pwa, the build, and the macOS shards.
  # release-stable.yml looks for a successful check run with this name on the
  # commit it promotes (`<caller job> / full-suite` when this file was called),
  # and reads the `verdict` output when it called this file itself.
  full-suite:
    needs: [select, server, server-shard, server-typecheck, test, build-pwa, test-macos]
    if: always() && needs.select.outputs.tests == 'full'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      verdict: ${{ steps.verdict.outputs.verdict }}
    steps:
      # Script-free, and can only ADD red: any leg that did not succeed fails
      # this job before verdict.mjs is even checked out.
      - name: Refuse any leg that did not succeed (no script involved)
        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')
        run: exit 1
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # The `verdict` output is written by THIS step, once verdict.mjs exits 0:
      # a step's GITHUB_OUTPUT is its own, and the job output reads this step's.
      # RESULTS is one `name=result` pair per need — not the whole needs context, which
      # carries every select matrix and outgrows an environment string's 128 KB.
      - name: Verdict
        id: verdict
        env:
          RESULTS: select=${{ needs.select.result }} server=${{ needs.server.result }} server-shard=${{ needs.server-shard.result }} server-typecheck=${{ needs.server-typecheck.result }} test=${{ needs.test.result }} build-pwa=${{ needs.build-pwa.result }} test-macos=${{ needs.test-macos.result }}
        run: |
          node .github/ci/verdict.mjs full
          echo "verdict=green" >> "$GITHUB_OUTPUT"
```

  **Comment ledger** — every comment block of the old `ci.yml` (line numbers at `3a8a93a5`) and its fate:

  | Old lines | Block | Fate |
  |---|---|---|
  | 1–4 | "The monorepo had no CI at all" | Kept verbatim; a paragraph listing the modes is appended. |
  | 7–14 | least privilege | Kept; one sentence added naming `select`'s `checks: read` as the diff's one ask. |
  | 22–27 | `workflow_dispatch` escape hatch | Corrected (spec §14): the run still gets the suites' answer, but GitHub documents that `workflow_dispatch` checks do not satisfy a ruleset's required checks, and against classic protection it is untested — the comment says both. |
  | 33–36 | deadline, "slowest leg … `server` at 9 minutes" | Corrected (spec §14) and split: on `test` it says `pwa` ≈ 2.5 min (measured 2026-09-23); on `server-shard` it states the ~4-minute shard target and the unsharded 18.5-min median / 21.5 max. "Pinned — key AND ceiling — by oss-metadata" kept on both. |
  | 43–48 | `fetch-depth: 0` for topology-clean | Moved verbatim to `server-shard`'s checkout; `test` keeps depth 0 with a one-line pointer; `trace-shard` and `select` carry their own reasons. |
  | 55–80 | setup-node / node-floor's three assertions | Moved to `server-shard`'s setup-node; "on the `server` leg of this matrix" → "on whichever server shard receives it", plus one sentence that a node-version edit is under `.github/` and so always selects the full suite. |
  | 85–91 | tmux, git and jq | Moved verbatim into the action's linux arm, with a paragraph added for `strace` and `python3`. |
  | 100–103 | agent deps for typecheck-tests | Moved into the action; "this job only ran `npm ci` in server/" → "the job under test is the server's". |
  | 109–115 | pwa deps for typecheck-tests | Moved verbatim into the action. |
  | 121–122 | never `npx` | Kept on `test`'s Test step and on `server-shard`'s Test step (extended with the substring-filter reason for `vitest.select.config.ts`). |
  | 131–146 | Darwin arms' mechanism; separate job; server only | Kept; the three-name list corrected to the four required names (spec §14); a sentence added that it gates promotion via `full-suite`; a paragraph added on sharding across machines. |
  | 149–160 | 55-minute deadline; "macOS minutes bill at 10x Linux" | Kept, with "unsharded" added to the measurement; the billing clause corrected (spec §14): hosted runners are free on a public repository, and the real cost is wall-clock plus one of five concurrent macOS slots (13–18 min queue waits measured). |
  | 171–183 | brew set (bash ≥ 4.2, coreutils g-prefixed) | Moved verbatim into the action's macOS arm; `test-macos` keeps a one-line pointer. |
  | 199–216 | THE PROBE LEG | Kept verbatim; one parenthesis added: sharding changes none of it, and the probe reads no select output and is not needed by `full-suite`. |
  | 219–230 | probe 25-minute deadline | Kept verbatim. |
  | 239–250 | probe brew set | Kept verbatim (probe-macos is unchanged and does not use the action: it installs server only). |
  | 259–282 | pane-bound describes | Kept verbatim. |
  | 295 | build-pwa 15 minutes | Kept verbatim. |
  | 301–308 | build-pwa node '22' | Kept; "for consistency with the `test` job" → "with the server shards", and "only the `test` job's `server` matrix leg is gated" → "only the `server-shard` job's node-version is gated". |
  | 314–315 | build proven by its output | Kept verbatim. |

  New comments written in integration (not in the old file): `select`'s upload now says it also hands over the
  traced list and the artifact id, and to a build too; `select`'s pipeline-change and fetch steps say why they
  exist and which way each failure falls; `trace-shard`'s Trace step explains why there is no `i/n` split, and its
  header that a failing traced test is recorded `unknown` while only `map-build` goes red, for news;
  `map-build`'s header adds the `--traced` safety, the published `testmap` and the exit codes 3 and 4, its
  pre-upload check says what it narrows and what it cannot close, and its last step why it is last; both verdict
  jobs' script-free first steps; `full-suite`'s Verdict step says why the output is written there and why
  `RESULTS`.

- [ ] **Step 9: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts --maxWorkers=2
```

  Measured: `Tests  34 passed (34)`.

- [ ] **Step 10: Measure the mutation table.** Stage the three files first
  (`git add .github/actions/server-deps/action.yml .github/workflows/ci.yml server/test/ci-pipeline.test.ts`);
  then for each row: apply the one edit, run Step 9's command, see the named test red, and restore with
  `git checkout -- <file>` (which restores the staged version). Re-measured in the integration clone:

  | Mutation (in `ci.yml` unless noted) | Test that goes red |
  |---|---|
  | delete `if: always()` from job `server` | test (server) is a summary that fails closed |
  | `needs: [select, server-shard]` on `server` (typecheck dropped) | test (server) is a summary that fails closed |
  | `SHARDS_RESULT: ${{ needs.server-typecheck.result }}` | test (server) is a summary that fails closed |
  | `name: test-server` on `server` | produces all four required names |
  | job-level `if: github.event_name != 'push'` on `test` | the required matrix and build-pwa carry no job-level if: and no needs: |
  | `needs: select` on `build-pwa` | the required matrix and build-pwa carry no job-level if: and no needs: |
  | drop `if: env.CCRC_LEG == 'run'` from `test`'s Typecheck step | the required legs skip by STEP |
  | `paths: ['server/**']` under `pull_request:` | no workflow-level paths: or paths-ignore: filter |
  | `cancel-in-progress: true` | cancels superseded runs for pull requests only |
  | group without the `ci-` prefix | cancels superseded runs for pull requests only |
  | a second `CCRC_SELECTION: enforce` in select's step env | CCRC_SELECTION is defined exactly once |
  | drop `checks: read` from select / make its `actions: read` a `write` | select asks for contents: read, checks: read and actions: read (both measured) |
  | `timeout-minutes: 90` on `trace-shard` | every job declares a deadline between 1 and 60 minutes |
  | drop `test-macos` from `full-suite`'s needs | full-suite needs every leg |
  | `if: needs.select.outputs.tests == 'full'` on `full-suite` (no `always()`) | full-suite needs every leg |
  | `verdict=green` written by a separate later step (the draft's shape) | full-suite needs every leg |
  | drop `needs.select.outputs.count != '0' && ` from `server-shard` | no matrix built from select can be empty |
  | `trace-shard` guarded on the matrix string instead of `trace_count` | no matrix built from select can be empty |
  | `test-macos` Test step runs `vitest run $(cat "$RUNNER_TEMP/tests.txt")` | a shard runs exactly its list |
  | workflow_call output `value: green` | triggers: … both with a mode |
  | delete the `schedule:` trigger | triggers: … both with a mode |
  | `platform: linux` on `test-macos` | every server-running job installs through server-deps |
  | (action.yml) `install -y tmux jq python3` (strace dropped) | every server-running job installs through server-deps |
  | drop `trace_count` from select's outputs | each needs.select.outputs.X is declared in select's outputs |
  | an `actions/cache/restore` step in `map-build` | no Actions cache anywhere |
  | refresh `--old .ci-cache/testmap.json` | map-build refreshes against the map select diffed from… |
  | refresh without `--traced` | map-build refreshes against the map select diffed from… |
  | `select-inputs` uploads the map only | map-build refreshes against the map select diffed from… |
  | `--map` passed only when the file exists (the draft's conditional) | map-build refreshes against the map select diffed from… |
  | the Trace step filters its list (`\| awk NF`) | a trace shard hands trace-run exactly its matrix row's files |
  | the `testmap` artifact renamed | map-build keeps the map it built as an artifact… |
  | `working-directory: server` on times-build's merge step | times-build merges the durations from the workspace root |
  | the "already green?" step's failure branch writes `full_green=true` | gh fails -> full_green=false, and the step itself succeeds |
  | its `gh api` call not guarded by `if` (a failure aborts the step) | gh fails -> full_green=false…, gh finds a green full-suite… (2) |
  | delete `server`'s script-free first step / drop its `needs.select.result != 'success' \|\| ` clause | both verdicts are fronted by a script-free step that can only ADD red (1 each) |
  | delete `full-suite`'s script-free first step / drop its `skipped` clause | both verdicts are fronted by a script-free step … (1 each) |
  | drop `EVENT: ${{ github.event_name }}` from `test (server)` | test (server) is a summary that fails closed |
  | `RESULTS` without the `test-macos` pair / `NEEDS_JSON: ${{ toJSON(needs) }}` back | full-suite needs every leg (1 each) |
  | drop `actions: read` from `select` | select asks for contents: read, checks: read and actions: read |
  | an `actions/cache/restore` step in `select` | no Actions cache anywhere |
  | the fetch step records no artifact id / records it even when the download failed / lets a failed download fail `select` / fetches `testmap` only | select fetches the newest trusted testmap and testtimes … (1 each) |
  | `select-inputs` without `testmap.artifact` | map-build refreshes against the map select diffed from… |
  | the pre-upload check always publishes / drops its empty-base guard | a refresh publishes only if, checked just before the upload, its base map is still the newest trusted one (1 each) |
  | the pre-upload check also runs on a rebuild / the `testmap` upload ignores it / uploads only on `publish == 'true'` (a rebuild would never publish) / `map-build` without `actions: read` / the `testtimes` artifact renamed | map-build publishes testmap unless that check said no; times-build publishes testtimes (1 each) |
  | the pipeline step on every event / `Select` ignores `PIPELINE_CHANGED` | runs only on pull_request, and hands select --input-mode full … (1 each) |
  | the pipeline diff over the whole tree / an undiffable base answering `false` | a change under .github/ -> changed=true; anything else -> false; … (1 each) |
  | the pipeline diff two-dot against `origin/$BASE_REF` | diffs from the merge base, so a pipeline change main made since the branch point is not this pull request's |
  | `probe-macos` on every event | probe-macos runs on pull requests and the daily schedule only … |
  | `trace-shard`'s records kept only on success | map-build runs after a FAILED trace shard too, and the shard keeps whatever records it wrote |
  | `select-inputs` handed over on a refresh only / `map-build` fetching it on a refresh only | map-build refreshes against the map select diffed from… (1 each) |
  | the Build step does not capture the exit code (3 fails the step) / accepts any exit / writes no `rc` | exit 0, 3 or 4 from testmap.mjs: the step succeeds and says which; any other exit fails it (1 each) |
  | a build never handed `--old` | a build is handed the map select fetched as --old, when there was one; a refresh always is |
  | the last red step removed / never firing | the map is uploaded whatever the build said, and a last step turns the job red when it said 3 or 4 (1 each) |
  | the upload skipped when the build said 3 or 4 | the same, and map-build publishes testmap unless that check said no… (2) |

  Every row measured red — one failing test each (`Tests  1 failed | 33 passed (34)`) except where noted — and
  green again after restore.

- [ ] **Step 11: Validate YAML and expressions with actionlint** (Task 1 Step 3's binary, or download it the same way)

```bash
"$AL/actionlint"; echo "rc=$?"
```

  Expected: no findings, `rc=0` (measured) — this checks every workflow in `.github/workflows/`, every `${{ }}`
  expression against its context, the `needs.*.outputs.*` references, and (with shellcheck on PATH) every `run:`.

- [ ] **Step 12: Run the neighbouring guards** — every suite that reads a workflow or the action, each alone:

```bash
cd server
for f in oss-metadata node-floor build-release single-definition verify-provenance release-main ccd-bounded-reads; do
  ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '
done
```

  Measured at this task's commit: `oss-metadata` 22 passed, `node-floor` 3, `build-release` 25, `single-definition`
  160, `verify-provenance` 24, `release-main` 19; `ccd-bounded-reads` 46 (measured at the tip, where every file it
  reads is byte-identical to this commit's). No existing assertion changes in this
  task: `oss-metadata`'s `jobBlocks` census parses every new job and each declares a first `timeout-minutes` ≤ 60;
  its trigger-key scan still finds `pull_request` and no `pull_request_target`; no `secrets.` anywhere;
  `single-definition`'s org scan finds no org name (the repository is always `${{ github.repository }}`).
  `node-floor.test.ts:12` points at "ci.yml's setup-node comment", which now lives on `server-shard` — still in
  ci.yml. `ccd-bounded-reads.test.ts:96-100` mentions `test-macos`'s `brew install … coreutils` in prose only; the
  job still installs coreutils (through the action), so the prose stays true.

- [ ] **Step 13: Execute the pipeline's own `run:` blocks, composed** — the check no text pin can make: that the
  steps' real commands, fed each other's real outputs, compose. This scratch script (it lives outside the
  checkout and is never committed) reads `ci.yml` with PyYAML, runs each step's `run:` exactly as the runner does
  (`bash --noprofile --norc -eo pipefail`, the step's and job's `env:` with every `${{ }}` supplied by the
  scenario — an unsupplied one stops it), plays the upload/download actions by their documented layout, and stands
  in for GitHub's artifact store with a local fake of the two REST routes `main-artifact.mjs` reads plus a fake
  `gh` whose `run download` copies from that store:

<!-- scratch-file: compose.py -->
```python
#!/usr/bin/env python3
"""Execute ci.yml's own `run:` blocks (extracted from the YAML, not retyped) that invoke a .github/ci script,
against a fixture workspace, chaining their real outputs:
  A   push, no map           fetch -> select -> trace-shard (x N rows) -> map-build (build) -> publish testmap
  B   pull_request (enforce)  pipeline? -> fetch (a newer UNTRUSTED testmap planted) -> select(--map)
                              -> server-shard (x N) -> test (server) verdict                    (red: caught)
  B2  the PR, fixed           pipeline? -> fetch -> select -> server-shard -> test (server) verdict (green)
  B3  a PR touching .github/  pipeline? says changed -> select --input-mode full                 (full)
  C   push after B2 merged    fetch -> select(refresh) -> trace-shard -> map-build (refresh --traced)
                              -> compare-and-swap (publish) ; the same CAS after a newer map lands (no publish)
  D   schedule                times-build (B2's times.json) -> publish testtimes -> fetch -> select(--times)
                              -> full-suite verdict
  E   dispatch rebuild        a test that fails under trace is added: trace -> map-build (build --old the fetched
                              map) exits 3 AFTER writing -> published anyway -> the last step goes red
  F   push (refresh)          the failing test is unknown, so re-traced; it fails again, but was already unknown:
                              a ::warning::, exit 0 -> published, green
Artifacts live in a local store behind a fake of the two REST routes main-artifact.mjs reads, and a fake `gh`
whose `run download` copies from that store.
Every expression a step's env uses must be supplied by the scenario, or the script stops.
Usage: CCRC_COMPOSE_SRC=<checkout with server/node_modules> CCRC_COMPOSE_DIR=<scratch dir> python3 compose.py
Scratch tooling: it lives outside the checkout and is never committed."""
import json, os, re, shutil, subprocess, sys, pathlib
import yaml

SRC = pathlib.Path(os.environ['CCRC_COMPOSE_SRC'])
D = pathlib.Path(os.environ['CCRC_COMPOSE_DIR'])
W = D / 'compose'
WS = W / 'ws'
LOG = []

def log(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    LOG.append(line)

def sh(cmd, cwd, env=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, env=env, shell=isinstance(cmd, str), capture_output=True, text=True)
    if check and r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit(f'FAILED: {cmd}')
    return r

CI = yaml.safe_load((SRC / '.github/workflows/ci.yml').read_text())
WF_ENV = CI.get('env', {})

def the_step(job, name):
    steps = [s for s in CI['jobs'][job]['steps'] if s.get('name') == name]
    assert len(steps) == 1, (job, name)
    return steps[0]

def run_step(job, name, exprs, cwd_base, extra_env, runner_temp):
    """Run one step's `run:` exactly as the runner would: bash --noprofile --norc -eo pipefail."""
    st = the_step(job, name)
    env = dict(os.environ)
    env.update({k: str(v) for k, v in WF_ENV.items()})
    for k, v in {**CI['jobs'][job].get('env', {}), **st.get('env', {})}.items():
        def sub(m):
            assert m.group(1) in exprs, f'{job}/{name}: no value for expression {m.group(1)!r}'
            return exprs[m.group(1)]
        env[k] = re.sub(r'\$\{\{ (.*?) \}\}', sub, str(v))
    env.update(extra_env)
    env['RUNNER_TEMP'] = str(runner_temp)
    out = runner_temp / 'GITHUB_OUTPUT'
    summ = runner_temp / 'GITHUB_STEP_SUMMARY'
    out.write_text('')
    summ.write_text('')
    env['GITHUB_OUTPUT'] = str(out)
    env['GITHUB_STEP_SUMMARY'] = str(summ)
    env['GITHUB_WORKSPACE'] = str(WS)
    env['PATH'] = f"{FAKEBIN}:{env['PATH']}"
    env['GITHUB_API_URL'] = API
    env['COMPOSE_STORE'] = str(STORE_FILE)
    script = runner_temp / 'step.sh'
    script.write_text(st['run'])
    cwd = WS / st['working-directory'] if 'working-directory' in st else WS
    r = subprocess.run(['bash', '--noprofile', '--norc', '-eo', 'pipefail', str(script)], cwd=cwd, env=env,
                       capture_output=True, text=True)
    return r, parse_output(out.read_text()), summ.read_text()

def parse_output(text):
    out, lines, i = {}, text.split('\n'), 0
    while i < len(lines):
        m = re.fullmatch(r'([A-Za-z0-9_]+)<<(.+)', lines[i])
        if m:
            key, delim, vals = m.group(1), m.group(2), []
            i += 1
            while lines[i] != delim:
                vals.append(lines[i]); i += 1
            out[key] = '\n'.join(vals)
        elif '=' in lines[i]:
            k, v = lines[i].split('=', 1); out[k] = v
        i += 1
    return out

def fresh(name):
    p = W / 'tmp' / name
    shutil.rmtree(p, ignore_errors=True)
    p.mkdir(parents=True)
    return p

def git(*a):
    return sh(['git', *a], WS).stdout.strip()

GIT_ID = ['-c', 'user.name=ccrc fixture', '-c', 'user.email=fixture@example.invalid']

# ── the fixture workspace: this tree, trimmed to three live server test files ──
shutil.rmtree(W, ignore_errors=True)
W.mkdir(parents=True)
sh(['git', 'clone', '-q', str(SRC), str(WS)], W)
os.symlink(SRC / 'server' / 'node_modules', WS / 'server' / 'node_modules')
keep = {'server/test/ci-baseline.test.ts', 'server/test/bus.test.ts', 'server/test/worker-skill.test.ts'}
for f in git('ls-files', 'server/test').split('\n'):
    if f.endswith('.test.ts') and f not in keep:
        (WS / f).unlink()
sh(['git', *GIT_ID, 'commit', '-qam', 'fixture: three live server test files'], WS)
log('workspace:', WS, 'HEAD', git('rev-parse', 'HEAD')[:12], '| live tests:',
    ' '.join(sorted(x for x in git('ls-files', 'server/test').split('\n') if x.endswith('.test.ts'))))
REPO, REPO_ID = 'o/r', 1001
STORE = []                       # every uploaded artifact: what the REST API would list
STORE_DIR = W / 'artifacts'
STORE_DIR.mkdir()
STORE_FILE = W / 'artifacts.json'
RUNS = {}
_tick = [0]

def publish(name, src, event, branch='main', head_repo=REPO_ID, path='.github/workflows/ci.yml'):
    """upload-artifact in a run of `path` for `event` on `branch`: a new run, a new artifact id, a newer time."""
    _tick[0] += 1
    aid, run_id = 100 + _tick[0], 9000 + _tick[0]
    f = STORE_DIR / f'{aid}-{name}'
    f.mkdir()
    shutil.copy(src, f / pathlib.Path(src).name)
    head = git('rev-parse', 'HEAD')
    STORE.append({'id': aid, 'name': name, 'expired': False, 'created_at': f'2026-09-23T00:00:{_tick[0]:02d}Z',
                  'workflow_run': {'id': run_id, 'repository_id': REPO_ID, 'head_repository_id': head_repo,
                                   'head_branch': branch, 'head_sha': head}, '_dir': str(f)})
    RUNS[run_id] = {'id': run_id, 'path': path, 'event': event, 'head_branch': branch,
                    'repository': {'id': REPO_ID}, 'head_repository': {'id': head_repo}}
    STORE_FILE.write_text(json.dumps(STORE))
    log(f'    published {name}: artifact {aid} of run {run_id} ({event}, {branch}{", FORK" if head_repo != REPO_ID else ""}) at {head[:12]}')
    return aid

import http.server, threading, urllib.parse
class FakeApi(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        body = None
        if u.path == f'/repos/{REPO}/actions/artifacts':
            name = q.get('name', [''])[0]
            arts = [{k: v for k, v in a.items() if k != '_dir'} for a in STORE if a['name'] == name]
            body = {'total_count': len(arts), 'artifacts': list(reversed(arts))}
        m = re.fullmatch(rf'/repos/{REPO}/actions/runs/(\d+)', u.path)
        if m and int(m.group(1)) in RUNS:
            body = RUNS[int(m.group(1))]
        self.send_response(200 if body is not None else 404)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(body if body is not None else {'message': 'Not Found'}).encode())
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeApi)
threading.Thread(target=srv.serve_forever, daemon=True).start()
API = f'http://127.0.0.1:{srv.server_address[1]}'
FAKEBIN = W / 'fakebin'
FAKEBIN.mkdir()
(FAKEBIN / 'gh').write_text("""#!/usr/bin/env python3
import json, os, shutil, sys
a = sys.argv[1:]
assert a[:2] == ['run', 'download'], a
run_id, name, dest = int(a[2]), a[a.index('-n') + 1], a[a.index('-D') + 1]
hits = [x for x in json.load(open(os.environ['COMPOSE_STORE'])) if x['workflow_run']['id'] == run_id and x['name'] == name]
if not hits:
    sys.exit('no artifact %s in run %d' % (name, run_id))
os.makedirs(dest, exist_ok=True)
for f in os.listdir(hits[0]['_dir']):
    shutil.copy(os.path.join(hits[0]['_dir'], f), os.path.join(dest, f))
""")
(FAKEBIN / 'gh').chmod(0o755)
GH_EXPRS = {'github.token': 't0ken', 'github.repository': REPO, 'github.repository_id': str(REPO_ID)}

def fetch(label):
    """`Fetch the newest trusted map and durations`, run as shipped against the store. The workspace starts with
    no .ci-cache, as a fresh checkout does."""
    shutil.rmtree(WS / '.ci-cache', ignore_errors=True)
    r, _, _ = run_step('select', 'Fetch the newest trusted map and durations', GH_EXPRS, WS, {}, fresh(f'fetch-{label}'))
    log(f'[{label}] fetch rc={r.returncode}:', ' / '.join(l for l in r.stdout.split('\n') if l.endswith(')') or l.endswith('none') or l.startswith('::')))
    assert r.returncode == 0
    have = sorted(os.listdir(WS / '.ci-cache'))
    log(f'    .ci-cache: {have}', '| testmap.artifact =', (WS / '.ci-cache/testmap.artifact').read_text().strip() if (WS / '.ci-cache/testmap.artifact').exists() else None)

def pipeline(label):
    r, out, _ = run_step('select', 'Does this pull request change the pipeline?', {'github.base_ref': 'main'}, WS, {}, fresh(f'pipeline-{label}'))
    log(f'[{label}] pipeline step rc={r.returncode} changed={out.get("changed")!r}', r.stdout.strip().replace('\n', ' / ')[:200])
    assert r.returncode == 0
    return out.get('changed', '')

def select(event, input_mode='', full_green='false', label='', do_fetch=True):
    changed = pipeline(label) if event == 'pull_request' else ''
    if do_fetch:
        fetch(label)
    rt = fresh(f'select-{label}')
    r, out, summ = run_step('select', 'Select', {
        'github.event_name': event, 'inputs.mode': input_mode, "steps.green.outputs.full_green || 'false'": full_green,
        'steps.pipeline.outputs.changed': changed,
    }, WS, {}, rt)
    log(f'[{label}] select.mjs rc={r.returncode}', r.stderr.strip()[-300:])
    assert r.returncode == 0, r.stderr
    for k in ['tests', 'trace', 'shadow', 'count', 'macos_count', 'trace_count', 'map_sha', 'fallback']:
        log(f'    {k}={out.get(k)!r}')
    for k in ['server_matrix', 'macos_matrix', 'trace_matrix']:
        log(f'    {k}={out.get(k)}')
    declared = set(CI['jobs']['select']['outputs'])
    assert set(out) == declared, ('select.mjs writes', sorted(set(out) ^ declared))
    log('    summary:', ' / '.join(l for l in summ.split('\n') if l.startswith('|') or l.startswith('- ') or l.startswith('_'))[:600])
    return out, rt

def select_inputs_artifact(out, rt):
    """`Hand the map to map-build`, under its `if:` (anything traced): upload-artifact of the listed .ci-cache files
    that exist (their LCA is .ci-cache, so they land at the artifact root); `if-no-files-found: error` fires only
    when none does, and traced.txt always does."""
    st = the_step('select', 'Hand the map to map-build')
    assert st['if'] == "steps.select.outputs.trace != 'none'", st['if']
    if out['trace'] == 'none':
        return None
    art = fresh('artifact-select-inputs')
    found = [p for p in st['with']['path'].split() if (WS / p).exists()]
    assert found, 'select-inputs: no file found'
    for p in found:
        shutil.copy(WS / p, art / pathlib.Path(p).name)
    log('    select-inputs artifact:', sorted(os.listdir(art)))
    return art

def trace_shards(out, label):
    arts = []
    for row in json.loads(out['trace_matrix'])['include']:
        rt = fresh(f'trace-{label}-{row["shard"]}')
        r, _, _ = run_step('trace-shard', 'Trace', {'matrix.files': row['files']}, WS, {}, rt)
        log(f'[{label}] trace {row["shard"]}/{row["total"]} files={row["files"]!r} rc={r.returncode}', r.stderr.strip()[-300:])
        assert r.returncode == 0
        rec = json.loads((rt / 'records.json').read_text())
        log(f'    records.json: format={rec["format"]} tests={sorted(rec["tests"])} baseline.root.listed={rec["baseline"]["root"]["listed"]} baseline.rest.listed={rec["baseline"]["rest"]["listed"]}')
        for t, v in sorted(rec['tests'].items()):
            log(f'      {t}: unknown={v["unknown"]}{" why=" + v["why"] if v.get("why") else ""} rest.subtree={v["rest"]["subtree"]} root.listed={v["root"]["listed"]} rest.listed={v["rest"]["listed"]} rest.read has ccd/worker-skill/SKILL.md={"ccd/worker-skill/SKILL.md" in v["rest"]["read"]} root.read has server/src/bus.ts={"server/src/bus.ts" in v["root"]["read"]}')
        # upload-artifact name records-<shard> path $RUNNER_TEMP/records.json
        arts.append((f'records-{row["shard"]}', rt / 'records.json'))
    return arts

def map_build(out, arts, select_inputs, label):
    rt = fresh(f'mapbuild-{label}')
    # download-artifact pattern records-* -> $RUNNER_TEMP/records/<artifact>/records.json
    for name, f in arts:
        (rt / 'records' / name).mkdir(parents=True)
        shutil.copy(f, rt / 'records' / name / 'records.json')
    if select_inputs is not None:
        shutil.copytree(select_inputs, rt / 'select-inputs')
    head = git('rev-parse', 'HEAD')
    r, o, _ = run_step('map-build', 'Build the map', {
        'needs.select.outputs.trace': out['trace'], 'needs.select.outputs.map_sha': out['map_sha'],
        'needs.select.outputs.trace_matrix': out['trace_matrix'],
    }, WS, {'GITHUB_SHA': head}, rt)
    log(f'[{label}] Build the map: step rc={r.returncode}, testmap.mjs rc={o.get("rc")!r}', ' / '.join(l for l in r.stdout.split('\n') if l.startswith('::')))
    assert r.returncode == 0, r.stderr
    rt.joinpath('build-rc').write_text(o.get('rc', ''))
    m = json.loads((WS / '.ci-cache/testmap.json').read_text())
    log(f'    testmap.json: format={m["format"]} sha={m["sha"][:12]} (HEAD {head[:12]}) baseline.listed={m["baseline"]["listed"]} tests:')
    for t, v in sorted(m['tests'].items()):
        log(f'      {t}: unknown={v["unknown"]}{" why=" + v["why"] if "why" in v else ""} listed={v["listed"]} subtree={v["subtree"]} git={v["git"]} read∋bus.ts={"server/src/bus.ts" in v["read"]} read∋SKILL.md={"ccd/worker-skill/SKILL.md" in v["read"]}')
    return m, rt

def cas_and_publish(out, rt, label, event='push'):
    """`Is the map this refresh was built on still the newest?` then `Keep the map as an artifact` under its if."""
    publish_out = ''
    if out['trace'] == 'refresh' and out['map_sha'] != '':
        r, o, _ = run_step('map-build', 'Is the map this refresh was built on still the newest?', GH_EXPRS, WS, {}, rt)
        assert r.returncode == 0, r.stderr
        publish_out = o.get('publish', '')
        log(f'[{label}] pre-upload check: publish={publish_out!r}', ' / '.join(l for l in r.stdout.split('\n') if l.startswith('::')))
    if publish_out != 'false':
        publish('testmap', WS / '.ci-cache/testmap.json', event)
    else:
        log(f'[{label}] testmap NOT published')
    # `Red if the map build reported news`, under its if (steps.build.outputs.rc != '0').
    rc = rt.joinpath('build-rc').read_text()
    if rc != '0':
        r, _, _ = run_step('map-build', 'Red if the map build reported news', {'steps.build.outputs.rc': rc}, WS, {}, rt)
        log(f'[{label}] last step: exit {r.returncode}:', r.stdout.strip())
        assert r.returncode == 1
    else:
        log(f'[{label}] last step skipped (testmap.mjs rc=0): map-build green')
    return publish_out

def server_shards(out, label):
    times = []
    for row in json.loads(out['server_matrix'])['include']:
        rt = fresh(f'server-{label}-{row["shard"]}')
        r, _, _ = run_step('server-shard', 'Test', {'matrix.files': row['files'], 'matrix.vitest_shard': row['vitest_shard']}, WS, {}, rt)
        tail = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout)
        summ = ' | '.join(l.strip() for l in tail.split('\n') if re.match(r'\s+(Test Files|Tests)\s', l))
        fails = sorted(set(l.strip() for l in tail.split('\n') if l.strip().startswith('FAIL ')))
        log(f'[{label}] server {row["shard"]}/{row["total"]} files={row["files"]!r} vitest_shard={row["vitest_shard"]!r} rc={r.returncode} {summ}')
        for f in fails:
            log(f'      {f}')
        times.append((f'times-{row["shard"]}', rt / 'times.json', r.returncode))
    return times

def verdict_server(out, label, shards):
    rt = fresh(f'verdict-{label}')
    r, _, _ = run_step('server', 'Verdict', {
        'needs.select.result': 'success', 'needs.server-typecheck.result': 'success',
        'needs.server-shard.result': shards,
        'needs.select.outputs.tests': out['tests'], 'needs.select.outputs.count': out['count'],
        'github.event_name': 'pull_request',
    }, WS, {}, rt)
    log(f'[{label}] test (server) verdict rc={r.returncode}: {r.stdout.strip()}')
    return r.returncode

# ── A: the first push to main — no map yet ──
log('\n== A: push to main, no map ==')
outA, rtA = select('push', label='A')
assert outA['fallback'] == 'map: no map restored at .ci-cache/testmap.json', outA['fallback']
artsA = trace_shards(outA, 'A')
mapA, rtAm = map_build(outA, artsA, select_inputs_artifact(outA, rtA), 'A')
cas_and_publish(outA, rtAm, 'A')
git('update-ref', 'refs/remotes/origin/main', 'HEAD')

# ── B: a pull request touching server/src/bus.ts and adding a file to ccd/worker-skill ──
log('\n== B: pull_request: M server/src/bus.ts, A ccd/worker-skill/NOTES.md ==')
with open(WS / 'server/src/bus.ts', 'a') as fh:
    fh.write('\n// composition probe\n')
(WS / 'ccd/worker-skill/NOTES.md').write_text('probe\n')
sh(['git', *GIT_ID, 'add', '-A'], WS)
sh(['git', *GIT_ID, 'commit', '-qm', 'PR: touch bus.ts, add a file to ccd/worker-skill'], WS)
# Planted by pull-request runs, NEWER than main's map, and selecting nothing: never picked.
empty = W / 'planted' / 'testmap.json'
empty.parent.mkdir()
empty.write_text(json.dumps({**mapA, 'tests': {}}))
publish('testmap', empty, 'pull_request')
publish('testmap', empty, 'push', head_repo=2002)
publish('testmap', empty, 'workflow_dispatch', branch='feature')
WF_ENV['CCRC_SELECTION'] = 'enforce'
outB, _ = select('pull_request', label='B-enforce')
assert (WS / '.ci-cache/testmap.artifact').read_text().strip() == str(STORE[0]['id']), 'fetched an untrusted map'
WF_ENV['CCRC_SELECTION'] = 'shadow'
outBs, _ = select('pull_request', label='B-shadow')
timesB1 = server_shards(outB, 'B')
vB = verdict_server(outB, 'B', 'failure' if any(rc for _, _, rc in timesB1) else 'success')
assert vB != 0, 'the selected worker-skill shard should have caught the added file'
log('\n== B2: the PR drops ccd/worker-skill/NOTES.md (bus.ts change only) ==')
sh(['git', 'rm', '-q', 'ccd/worker-skill/NOTES.md'], WS)
sh(['git', *GIT_ID, 'commit', '-qm', 'PR: drop the added file'], WS)
WF_ENV['CCRC_SELECTION'] = 'enforce'
outB2, _ = select('pull_request', label='B2-enforce')
WF_ENV['CCRC_SELECTION'] = 'shadow'
timesB = server_shards(outB2, 'B2')
assert all(rc == 0 for _, _, rc in timesB)
assert verdict_server(outB2, 'B2', 'success') == 0

log('\n== B3: a pull request that also touches .github/ (checked, then dropped) ==')
(WS / '.github/ci/NOTE.md').write_text('probe\n')
sh(['git', *GIT_ID, 'add', '-A'], WS)
sh(['git', *GIT_ID, 'commit', '-qm', 'PR: touch the pipeline'], WS)
WF_ENV['CCRC_SELECTION'] = 'enforce'
outB3, _ = select('pull_request', label='B3-enforce')
assert outB3['tests'] == 'full', outB3['tests']
WF_ENV['CCRC_SELECTION'] = 'shadow'
sh(['git', *GIT_ID, 'reset', '-q', '--hard', 'HEAD~1'], WS)

# ── C: that PR merged — the refresh ──
log('\n== C: push to main after B merged (refresh) ==')
outC, rtC = select('push', label='C')
sel_inputs = select_inputs_artifact(outC, rtC)
artsC = trace_shards(outC, 'C')
mapC, rtCm = map_build(outC, artsC, sel_inputs, 'C')
assert cas_and_publish(outC, rtCm, 'C') == 'true'
log('\n== C2: the same refresh, had a newer trusted map landed after its select ==')
shutil.copytree(sel_inputs, rtCm / 'select-inputs-C2')
(rtCm / 'select-inputs').rename(rtCm / 'select-inputs-used')
(rtCm / 'select-inputs-C2').rename(rtCm / 'select-inputs')
(rtCm / 'select-inputs' / 'testmap.artifact').write_text(f"{STORE[0]['id']}\n")
assert cas_and_publish(outC, rtCm, 'C2') == 'false'
git('update-ref', 'refs/remotes/origin/main', 'HEAD')

# ── D: the daily run — durations, then a select that packs by them, then full-suite ──
log('\n== D: schedule: times-build, select --times, full-suite ==')
rt = fresh('times-build')
for name, f, _ in timesB:
    (rt / 'times' / name).mkdir(parents=True)
    shutil.copy(f, rt / 'times' / name / 'times.json')
r, _, _ = run_step('times-build', 'Merge the durations', {}, WS, {}, rt)
log(f'[D] times-build rc={r.returncode}', r.stderr.strip()[-300:], '->', (WS / '.ci-cache/testtimes.json').read_text().replace('\n', ' '))
assert r.returncode == 0
publish('testtimes', WS / '.ci-cache/testtimes.json', 'schedule')
outD, _ = select('schedule', label='D')
assert (WS / '.ci-cache/testtimes.json').exists()
RES = ['select', 'server', 'server-shard', 'server-typecheck', 'test', 'build-pwa', 'test-macos']
def full_suite(label, results):
    guard = CI['jobs']['full-suite']['steps'][0]
    fires = any(v in ('failure', 'cancelled', 'skipped') for v in results.values())
    log(f'[{label}] full-suite guard step ({guard["name"]}): {"exit 1" if fires else "skipped"}')
    r, o, _ = run_step('full-suite', 'Verdict', {f'needs.{k}.result': v for k, v in results.items()}, WS, {}, fresh(f'full-suite-{label}'))
    log(f'[{label}] full-suite verdict rc={r.returncode}: {r.stdout.strip()} | step outputs={o}')
    return r.returncode
assert full_suite('D', {k: 'success' for k in RES}) == 0
assert full_suite('D-red', {**{k: 'success' for k in RES}, 'test-macos': 'failure'}) != 0

# ── E: a rebuild after a test that fails under trace was added ──
log('\n== E: workflow_dispatch rebuild, with a test that fails under trace ==')
(WS / 'server/test/zz-fails.test.ts').write_text("import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n")
sh(['git', *GIT_ID, 'add', '-A'], WS)
sh(['git', *GIT_ID, 'commit', '-qm', 'a test that fails'], WS)
outE, rtE = select('workflow_dispatch', input_mode='rebuild', label='E')
assert outE['trace'] == 'rebuild'
selE = select_inputs_artifact(outE, rtE)
artsE = trace_shards(outE, 'E')
mapE, rtEm = map_build(outE, artsE, selE, 'E')
assert mapE['tests']['server/test/zz-fails.test.ts']['why'] == 'vitest exited 1'
assert rtEm.joinpath('build-rc').read_text() == '3'
cas_and_publish(outE, rtEm, 'E', event='workflow_dispatch')
git('update-ref', 'refs/remotes/origin/main', 'HEAD')

# ── F: the next merge — the failing test is unknown, so it is re-traced, and fails again ──
log('\n== F: push (refresh): the unknown test is re-traced and fails again — already unknown, so no red ==')
(WS / 'docs').mkdir(exist_ok=True)
(WS / 'docs/NOTE-F.md').write_text('docs only\n')
sh(['git', *GIT_ID, 'add', '-A'], WS)
sh(['git', *GIT_ID, 'commit', '-qm', 'docs only'], WS)
outF, rtF = select('push', label='F')
selF = select_inputs_artifact(outF, rtF)
artsF = trace_shards(outF, 'F')
mapF, rtFm = map_build(outF, artsF, selF, 'F')
assert rtFm.joinpath('build-rc').read_text() == '0'
assert cas_and_publish(outF, rtFm, 'F') == 'true'
(D / 'compose.transcript').write_text('\n'.join(LOG) + '\n')
```

```bash
CCRC_COMPOSE_SRC="$PWD" CCRC_COMPOSE_DIR="$(mktemp -d)" python3 <scratch>/compose.py
```

  Measured (this tree, trimmed to three live server test files — `bus`, `ci-baseline`, `worker-skill`):
  - **A** (push, no map): the fetch step → `testmap: none`, `testtimes: none`, an empty `.ci-cache`; `select` →
    `tests='none' trace='refresh' trace_count='3' map_sha=''`, fallback `map: no map restored at
    .ci-cache/testmap.json`, one trace row with `vitest_shard: ''`; `trace-run` → `records.json` format 2,
    `baseline.root.listed=['server/test']`, `baseline.rest.listed=[]`, `worker-skill` `rest.listed=['ccd/worker-skill']`;
    `map-build` (the build path) → a map at `HEAD` whose `bus.test.ts` reads `server/src/bus.ts` and whose
    `worker-skill.test.ts` lists `ccd/worker-skill` and reads `ccd/worker-skill/SKILL.md` (its `select-inputs` held
    `traced.txt` alone, so no `--old`; `testmap.mjs` exit 0), published as `testmap` (no pre-upload check: there
    was no base map), the last step skipped; and the set of keys `select.mjs` wrote equals the outputs `select`
    declares.
  - **B** (a PR modifying `server/src/bus.ts` and adding `ccd/worker-skill/NOTES.md`; three NEWER `testmap`
    artifacts that select nothing are planted first — from a `pull_request` run, from a fork's `push` to a branch
    named `main`, and from a `workflow_dispatch` on a feature branch): the pipeline step → `changed=false`; the
    fetch step picks A's map (artifact id recorded), never a planted one; enforce selects `bus` (rule 3,
    `server/src/bus.ts`) and `worker-skill` (rule 5, `ccd/worker-skill/NOTES.md`), `count='2'`; shadow widens the
    matrices to all 3 with the same reason table; the shard runs them — `worker-skill` FAILS (`carries no
    references of its own`: the added file), and `verdict.mjs server` says `count: 2 but shards: failure (expected
    success)`, exit 1. The listed-directory rule caught a real break.
  - **B2** (the PR drops the file): `count='1'` (`bus` only), shard green, `count: 1, shards: success`.
  - **B3** (the PR also touches `.github/ci/`): the pipeline step → `changed=true` and prints the path; `Select`
    runs with `--input-mode full` → `tests='full'`, `fallback=''`.
  - **C** (push after B2 merged): the fetch step picks A's map; refresh `trace_count='1'`; `select-inputs` =
    `testmap.artifact`, `testmap.json`, `traced.txt`; `map-build` takes the refresh path with `--traced` → a map
    at the new `HEAD`, other entries carried; the pre-upload check → `publish='true'` (A's map is still the
    newest trusted one) and the map is published. **C2**: the same check once a newer trusted map has landed →
    `publish='false'`, a `::notice::` naming both artifact ids, nothing published.
  - **D** (schedule): `times-build` → `.ci-cache/testtimes.json` keyed `server/test/bus.test.ts` (from the root),
    published as `testtimes`; the fetch step now finds both (C's map, D's durations); `select --times` →
    `tests='full' trace='rebuild'`, LPT rows with `vitest_shard: ''`; `full-suite`'s script-free guard is skipped
    and its Verdict step (`RESULTS` built from the seven results) → `every leg succeeded`, step output
    `verdict=green`; with `test-macos` failed → the guard's `exit 1` fires, and the Verdict step alone exits 1
    with `not green: test-macos=failure` and no output.
  - **E** (a dispatched `rebuild`, after a commit adds `server/test/zz-fails.test.ts`, which fails): `select` →
    `trace='rebuild'`, `select-inputs` = `testmap.artifact`, `testmap.json`, `traced.txt` (C's map); `trace-run`
    exits 0 with `zz-fails` recorded `unknown` (`vitest exited 1`); the Build step succeeds with `rc=3` —
    `::error::testmap: server/test/zz-fails.test.ts newly fails under trace (vitest exited 1)` — the map is
    PUBLISHED, and the last step exits 1: `the map was published, but testmap.mjs exited 3`.
  - **F** (a docs-only push after E): `select` diffs from E's map; rule 2 re-traces the unknown `zz-fails`, which
    fails again — `::warning::testmap: server/test/zz-fails.test.ts still fails under trace (vitest exited 1) —
    unknown before this run too`, `rc=0`; the pre-upload check → `publish='true'`, published, the last step skipped:
    `map-build` green. A test that always fails under tracing reds one build, not every merge.

- [ ] **Step 14: Commit**, then run the history guards (they read committed ranges):

```bash
git add .github/ci/main-artifact.mjs server/test/ci-main-artifact.test.ts .github/actions/server-deps/action.yml .github/workflows/ci.yml server/test/ci-pipeline.test.ts
git commit -F - <<'EOF'
ci: one pipeline, several modes — select, sharded server tests, a summary test (server), daily full run

The trigger decides a mode (spec 2026-09-23 §3); a select job computes what
it runs; server tests run as shards behind a fail-closed `test (server)`
summary (§4.2); the daily schedule runs every leg including macOS and
rebuilds the traced map; merges refresh the map against exactly the map
select diffed from; `full-suite` is the stable gate's evidence (§8).
The map and the durations come ONLY from artifacts of trusted ci.yml runs
on main (.github/ci/main-artifact.mjs), never the Actions cache, whose PR
scope a pull request can write; a refresh publishes only if its base map
is still the newest when checked just before the upload. A pull request
that changes .github/ runs everything, decided in plain bash. Both
verdicts are fronted by a script-free step. map-build publishes the map
it wrote even when testmap.mjs reports news (3: a traced test newly
fails; 4: a floor violator), then goes red in its last step.
CCRC_SELECTION starts at shadow. Install steps move to the server-deps
composite action. server/test/ci-pipeline.test.ts pins the shape.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git fetch origin main
cd server
for f in topology-clean source-bytes dtbd release-main; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
```

  Measured at this task's commit: 55, 2, 1 and 19 passed.

---


### Task 12: Stable gate in `release-stable.yml`

Spec §8. A push to `stable` promotes only a commit the full suite passed on.

**Files:**
- Modify: `.github/workflows/release-stable.yml`
- Test: `server/test/build-release.test.ts` (the `release-stable.yml` describe block)

**Interfaces:**
- Consumes: `ci.yml`'s `workflow_call` (input `mode`, output `verdict`) and the check-run name `full-suite` /
  `<caller job> / full-suite` (Task 11; the name shape confirmed by Task 1 Q5).
- Produces: jobs `gate` (output `found`: `true|false`), `full` (calls `./.github/workflows/ci.yml` with
  `mode: full`), `promote` (unchanged steps, now gated).
- Changed in integration: what it depends on changed in Task 11: the called run's `verdict` output is now
  actually written (the draft's `full-suite` never set it, so `promote` could never run on the called path —
  `needs.full.outputs.verdict == 'green'` was always false).
- Changed in integration (operator's ruling T4): `full` grants `actions: read` as well. A called workflow's jobs can
  never hold more than the calling job grants — a job asking for more fails the run before it starts — and
  Task 11's `select` now needs `actions: read` to list and download the trusted main artifacts the map and the
  durations come from. The forbidden-key scan drops `actions` and gains its own pin: `actions:` appears in `full`
  and nowhere else in the file.

- [ ] **Step 1: Write the failing test** — in `server/test/build-release.test.ts`, replace the whole
  `describe('release-stable.yml: the thin promotion workflow (design 2026-09-20 §4)', …)` block (from that line up
  to, not including, `describe('build-release.sh: source pins', …)`, keeping the one blank line between them) with:

<!-- excerpt: server/test/build-release.test.ts -->
```ts
describe('release-stable.yml: the thin promotion workflow (design 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-stable.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');
  /** One job's block: its two-space header through the line before the next. */
  const stableJob = (id: string): string => {
    const m = new RegExp(`^  ${id}:\\n((?:(?!  [A-Za-z][\\w-]*:\\n).*\\n?)*)`, 'm').exec(wf().split(/^jobs:$/m)[1] ?? '');
    expect(m, `release-stable.yml has no job \`${id}\``).not.toBeNull();
    return m![1];
  };

  it('triggers on stable pushes and on NOTHING else', () => {
    const src = wf();
    // Anchored to the block's own terminator (`concurrency:`), not just the
    // `branches:` line — a `repository_dispatch:`/`merge_group:` key added
    // after `branches: [stable]`, or a `paths:` filter under `push:`, would
    // stay green against a shorter pin.
    expect(src).toMatch(/^on:\n  push:\n    branches: \[stable\]\n\nconcurrency:$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-stable.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises under its own group, never cancelling', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-stable\n  cancel-in-progress: false$/m);
  });

  it('promote asks for contents: write and nothing else — it flips flags, it signs nothing; the gate reads checks only', () => {
    const src = wf();
    // The lookahead (as `expectAttestingWorkflow` above uses) forbids ANY
    // further permission line, not just the five named below — a
    // `deployments: write` added here would stay green against a bare
    // substring pin.
    expect(stableJob('promote')).toMatch(/^    permissions:\n      contents: write(?!\n      [a-z-]+:)$/m);
    expect(src).not.toMatch(/(id-token|attestations|packages|pull-requests):/);
    // design 2026-09-23 §8: the gate READS check runs and nothing else, and
    // the called ci.yml gets what its select job asks for — a called
    // workflow's jobs can never hold more than the calling job grants, and
    // select reads the trusted main artifacts (`actions: read`, ruling T4).
    // `actions:` appears in `full` and nowhere else in this file.
    expect(stableJob('gate')).toMatch(/^    permissions:\n      checks: read(?!\n      [a-z-]+:)$/m);
    expect(stableJob('full')).toMatch(/^    permissions:\n      contents: read\n      checks: read\n      actions: read(?!\n      [a-z-]+:)$/m);
    expect(src.replace(stableJob('full'), ''), 'actions: outside full').not.toMatch(/actions:/);
    expect(src.match(/: write$/gm), 'one write grant in the whole file — promote\'s').toHaveLength(1);
  });

  it('checks out at full depth and invokes release-stable.sh — no build command, no gh release create', () => {
    const src = wf();
    // Line-anchored, not bare substrings: `release-stable.sh --force` (the
    // script refuses any argument) would satisfy a `.toContain`, and
    // `fetch-depth: 0`/`timeout-minutes: 10` could sit anywhere, including a
    // comment, without a line anchor.
    expect(src).toMatch(/^          fetch-depth: 0$/m);
    expect(src).toMatch(/^        run: bash deploy\/release-stable\.sh$/m);
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    expect(src).not.toMatch(/npm ci|npm run|build-release\.sh|release-main\.sh|gh release|setup-node|attest/);
    expect(stableJob('promote')).toMatch(/^    timeout-minutes: 10$/m);
  });

  // ── the stable gate (design 2026-09-23 §8) ────────────────────────────────
  // A push to `stable` promotes only a commit the FULL suite passed on: either
  // a green `full-suite` check run already on it (the daily run, a manual full
  // run, an earlier gate), or a full run this workflow starts by calling
  // ci.yml. The gate cannot live in a ruleset — checks from scheduled and
  // manually dispatched runs do not satisfy one.
  it('has exactly three jobs, in order: gate, full, promote', () => {
    const ids = [...(wf().split(/^jobs:$/m)[1] ?? '').matchAll(/^  ([A-Za-z][\w-]*):$/gm)].map((m) => m[1]);
    expect(ids).toEqual(['gate', 'full', 'promote']);
  });

  it('gate looks for a successful full-suite check run on the pushed commit, exactly as ci.yml\'s daily skip does', () => {
    const g = stableJob('gate');
    expect(g).toMatch(/^    timeout-minutes: 5$/m);
    expect(g).toMatch(/^      found: \$\{\{ steps\.look\.outputs\.found \}\}$/m);
    expect(g).toContain('SHA: ${{ github.sha }}');
    expect(g).toContain('REPO: ${{ github.repository }}');
    // ONE matcher, two copies that must agree: the daily run skips itself on
    // it, and the gate promotes on it. `/ full-suite` is how a job inside a
    // called workflow is named (`<caller job> / <called job>`).
    const jq = (src: string): string => {
      const m = /--jq '(\.check_runs\[\] \| select\(.*\) \| \.id)'/.exec(src);
      expect(m, 'no check-run matcher found').not.toBeNull();
      return m![1];
    };
    const mine = jq(g);
    expect(mine).toContain('.conclusion == "success"');
    expect(mine).toContain('.name == "full-suite"');
    expect(mine).toContain('.name | endswith("/ full-suite")');
    expect(mine).toContain('.app.slug == "github-actions"');
    expect(jq(readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8'))).toBe(mine);
  });

  it('full runs only when the gate found nothing, and runs ci.yml itself in full mode', () => {
    const f = stableJob('full');
    expect(f).toMatch(/^    needs: gate$/m);
    expect(f).toMatch(/^    if: needs\.gate\.outputs\.found == 'false'$/m);
    expect(f).toMatch(/^    uses: \.\/\.github\/workflows\/ci\.yml\n    with:\n      mode: full$/m);
    // The callee's side of the contract: ci.yml is callable, and says green.
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^  workflow_call:$/m);
    expect(ci).toMatch(/^ {6}verdict:\n(?: {8}.*\n)*? {8}value: \$\{\{ jobs\.full-suite\.outputs\.verdict \}\}$/m);
  });

  it('promote cannot run unless the gate found a green full-suite or the called full run said green', () => {
    const p = stableJob('promote');
    expect(p).toMatch(/^    needs: \[gate, full\]$/m);
    // `always()` because `full` is SKIPPED on the found path, and a skipped
    // need skips its dependants — then the result checks are what gate it.
    // `verdict == 'green'`, not just `result == 'success'`: a called run in
    // which full-suite never ran (select answered anything but `full`) is a
    // SUCCESSFUL run that proved nothing.
    expect(p).toMatch(/^    if: always\(\) && needs\.gate\.result == 'success' && \(needs\.gate\.outputs\.found == 'true' \|\| \(needs\.full\.result == 'success' && needs\.full\.outputs\.verdict == 'green'\)\)$/m);
  });
});
```

  What changed in the existing assertions, and why:
  - *asks for contents: write and nothing else* → *promote asks for contents: write and nothing else …; the gate
    reads checks only*. The file-wide regex matched the first `permissions:` block that starts with
    `contents: write`; now there are three jobs with three permission blocks, so each is pinned in its own job
    (`promote`: `contents: write` alone — unchanged intent; `gate`: `checks: read` alone; `full`:
    `contents: read` + `checks: read` + `actions: read`), plus "exactly one `: write` in the file". The
    forbidden-key scan (`id-token|attestations|packages|pull-requests`) is kept file-wide, and `actions:` is
    pinned to `full` alone.
  - *checks out at full depth …*: `timeout-minutes: 10` is now read from `promote`'s block (the gate has its own 5);
    every other line of it is unchanged, including the forbidden-command scan.
  - *triggers on stable pushes and on NOTHING else* and *serialises under its own group*: unchanged. The
    `workflow_call` ban still holds — the caller says `uses:`; only the callee (`ci.yml`) declares `workflow_call`.
  - New: the job order; the gate's matcher equal to ci.yml's; `full`'s condition and call; `promote`'s condition.

- [ ] **Step 2: Run it, expect FAIL**

```bash
cd server && ./node_modules/.bin/vitest run test/build-release.test.ts --maxWorkers=2 -t 'release-stable'
```

  Measured: `Tests  5 failed | 3 passed | 21 skipped (29)`, the first failure
  ``AssertionError: release-stable.yml has no job `gate`: expected null not to be null``, and
  `expected [ 'promote' ] to deeply equal [ 'gate', 'full', 'promote' ]`.

- [ ] **Step 3: Implement** — replace `.github/workflows/release-stable.yml` entirely with:

<!-- file: .github/workflows/release-stable.yml -->
```yaml
# A push to `stable` promotes the release already cut for its HEAD (design
# 2026-09-20 §4, decision 3). Thin: deploy/release-stable.sh owns the tag
# lookup, the two flag flips and the read-back, and is tested locally
# (server/test/release-stable.test.ts). No build step, no node — nothing
# here can produce bytes. The branch's ruleset (no force push, no deletion;
# D-3130) keeps it fast-forward; the script refuses an untagged merge HEAD.
#
# GATED ON THE FULL SUITE (design 2026-09-23 §8). Pull requests run only the
# server tests their change can affect, so a promotion is where a selector
# miss must be caught. `gate` asks whether the pushed commit already carries
# a successful `full-suite` check run — from the daily full run, a manual
# full run, or an earlier gate; if not, `full` runs ci.yml in full mode, and
# `promote` runs only on one of those two answers. The gate is here and not
# in the branch's ruleset because a ruleset's required check refuses the
# daily run's evidence (GitHub counts only a few events toward one, and the
# daily and manual runs are not among them). The cost, accepted: the branch
# moves before the gate answers, so a red gate leaves `stable` pointing past
# the newest promoted release with no flag flipped — `ccrc rollout` follows
# the flags, not the branch, so it moves nothing, and the next promotion
# fast-forwards past it.
name: release-stable

on:
  push:
    branches: [stable]

concurrency:
  group: release-stable
  cancel-in-progress: false

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # Reads check runs; nothing else.
    permissions:
      checks: read
    outputs:
      found: ${{ steps.look.outputs.found }}
    steps:
      # The same matcher as ci.yml's daily skip (server/test/build-release.test.ts
      # holds the two copies equal). A job inside a called workflow is named
      # `<caller job> / <called job>`, hence the suffix form. A failed API call
      # fails this job, and a failed gate promotes nothing.
      - name: Look for a green full-suite check on this commit
        id: look
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          SHA: ${{ github.sha }}
        run: |
          ids=$(gh api --paginate "repos/$REPO/commits/$SHA/check-runs?per_page=100" \
            --jq '.check_runs[] | select(.conclusion == "success" and .app.slug == "github-actions" and (.name == "full-suite" or (.name | endswith("/ full-suite")))) | .id')
          if [ -n "$ids" ]; then
            echo "found=true" >> "$GITHUB_OUTPUT"
            echo "full-suite is already green on $SHA — promoting without a second run"
          else
            echo "found=false" >> "$GITHUB_OUTPUT"
            echo "no green full-suite on $SHA — running the full suite first"
          fi

  # A job that calls another workflow cannot declare timeout-minutes; the
  # called ci.yml's own jobs carry their deadlines. Its permissions are the
  # ceiling for every job in the called run, so they are what ci.yml's
  # select job asks for — read access to Actions included, which select needs to
  # find the newest trusted map and durations (main-artifact.mjs); a called
  # job asking for more than this grants fails the run before it starts.
  full:
    needs: gate
    if: needs.gate.outputs.found == 'false'
    permissions:
      contents: read
      checks: read
      actions: read
    uses: ./.github/workflows/ci.yml
    with:
      mode: full

  promote:
    needs: [gate, full]
    # `always()` because `full` is skipped whenever the gate found a green
    # check, and a skipped need would otherwise skip this job too. The result
    # checks are then the whole gate: the called run's `verdict` output is
    # read, not only its result, because a called run in which `full-suite`
    # never ran is a successful run that proved nothing.
    if: always() && needs.gate.result == 'success' && (needs.gate.outputs.found == 'true' || (needs.full.result == 'success' && needs.full.outputs.verdict == 'green'))
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # The script's own `gh` call edits the release's flags; nothing else.
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          # The script names the release by `git tag --points-at HEAD`; the
          # tag must be present, not a shallow single-commit fetch.
          fetch-depth: 0

      - name: Promote the release tagged at HEAD
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash deploy/release-stable.sh
```

- [ ] **Step 4: Run it, expect PASS**

```bash
cd server && ./node_modules/.bin/vitest run test/build-release.test.ts --maxWorkers=2
"$AL/actionlint"; echo "rc=$?"
```

  Measured: `Tests  29 passed (29)`; actionlint no findings, `rc=0` (it checks `with: mode:` against ci.yml's
  declared `workflow_call` input and `needs.full.outputs.verdict` against its declared output).

- [ ] **Step 5: Measure the mutation table.** Stage first
  (`git add .github/workflows/release-stable.yml server/test/build-release.test.ts`), then for each row: edit, run
  Step 4's vitest command, see red, restore with `git checkout -- <file>`:

  | Mutation (in `release-stable.yml` unless noted) | Test that goes red |
  |---|---|
  | `promote`'s `if:` without `always() && ` | promote cannot run unless … |
  | `promote`'s `if:` without `&& needs.full.outputs.verdict == 'green'` | promote cannot run unless … |
  | `promote`'s `if:` without `needs.gate.result == 'success' && ` | promote cannot run unless … |
  | `needs: full` on `promote` | promote cannot run unless … |
  | `full`'s `if: always()` | full runs only when the gate found nothing … |
  | `mode: rebuild` | full runs only when the gate found nothing … |
  | (`ci.yml`) workflow_call output `value: ${{ jobs.full-suite.result }}` | full runs only when the gate found nothing … |
  | the gate's jq without `.app.slug == "github-actions" and ` | gate looks for a successful full-suite … exactly as ci.yml's |
  | gate's `timeout-minutes: 5` deleted | gate looks for a successful full-suite … |
  | `contents: write` added to `gate`'s permissions | promote asks for contents: write and nothing else …; the gate reads checks only |
  | `full` without `actions: read` | promote asks for contents: write and nothing else …; the gate reads checks only |
  | `actions: read` added to `gate` too | promote asks for contents: write and nothing else …; the gate reads checks only |
  | `full`'s `actions: write` instead of `read` | promote asks for contents: write and nothing else …; the gate reads checks only |

  Every row re-measured in the integration clone: `Tests  1 failed | 28 passed (29)`.

- [ ] **Step 6: Run the neighbouring guards** (each alone):

```bash
cd server
for f in build-release ci-pipeline oss-metadata single-definition release-stable verify-provenance; do
  ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '
done
```

  Measured: `build-release` 29 passed, `ci-pipeline` 34, `oss-metadata` 22, `single-definition` 160,
  `release-stable` 15, `verify-provenance` 24 (`release-stable.test.ts` tests the script, not the YAML; it is run
  because it names the file). `oss-metadata`'s timeout census does not cover `release-stable.yml`
  (`oss-metadata.test.ts:173`), which is what lets `full` — a job that calls a workflow and so may not declare
  `timeout-minutes` — exist.

- [ ] **Step 7: Commit**, then the history guards

```bash
git add .github/workflows/release-stable.yml server/test/build-release.test.ts
git commit -F - <<'EOF'
ci(release-stable): promote only on a green full suite — found on the commit, or run first

A `gate` job looks for a successful `full-suite` check run on the pushed
commit; when there is none, `full` calls ci.yml in full mode, and `promote`
runs only on a found check or a called run whose verdict output is green
(spec 2026-09-23 §8). `full` grants the called run actions: read, which
its select job needs to read the trusted main artifacts. build-release.test.ts's release-stable pins now read
per job, and pin the gate ordering and the shared check-run matcher.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
cd server
for f in topology-clean source-bytes dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
```

  Measured at this task's commit: 55, 2 and 1 passed.

---

### Task 13: Docs — `release-main.yml` comment, `CLAUDE.md` CI paragraph

Spec §14. Prose only: no guard is added, so there is no red-first test; the check is every suite that reads these
two files.

**Files:**
- Modify: `.github/workflows/release-main.yml` (the comment at lines 9–11)
- Modify: `CLAUDE.md` (*Build / test / deploy*: a new *What CI runs* bullet; one clause in *Deploy = release + rollout*)

**Interfaces:** Consumes: the modes, job names and gate of Tasks 11–12. Produces: prose only.
- Changed in integration: `release-main.yml` is byte-identical to the draft's; the `CLAUDE.md` bullet also names
  the full-run triggers Task 5 gained (`server/scripts/`, `.gitattributes`, `.npmrc` — operator's ruling P1).

- [ ] **Step 1: Apply the edit** — from the repo root, run exactly this (three exact-text replacements; each refuses
  unless its old text is present exactly once; neither file is touched by any other task). Run on Task 12's tree it
  produces files byte-identical to this task's commit (`cmp`, checked by the plan's own checker):

<!-- script: task13-edit -->
```bash
python3 - <<'EOF'
import pathlib

def swap(path, old, new):
    p = pathlib.Path(path)
    s = p.read_text()
    assert s.count(old) == 1, f'{path}: the text to replace is not there exactly once'
    p.write_text(s.replace(old, new))

swap('.github/workflows/release-main.yml',
'''# Deliberately NOT gated on ci.yml: the PR's required checks are the gate,
# before the merge; main's post-merge matrix is a 45-minute re-check that the
# previous deploy path never waited for either (spec §2, decision 4).
''',
'''# Deliberately NOT gated on ci.yml: the PR's required checks are the gate,
# before the merge (spec §2, decision 4). There is no post-merge test run to
# wait for: a push to main runs ci.yml's `refresh` mode, which re-traces the
# tests the merge affected to keep the dependency map current and gates
# nothing (design 2026-09-23 §3, §5.4). The full suite runs daily on main and
# before any promotion to `stable` — release-stable.yml's gate — so what is
# cut here is a `dev` prerelease, and `stable` is where the full suite is
# required.
''')

swap('CLAUDE.md',
'''- **Node floor `>=22.13.0`, identical across the three engines**''',
'''- **What CI runs** (design `docs/superpowers/specs/2026-09-23-ci-test-selection-design.md`; one pipeline,
  `ci.yml`, whose trigger picks a mode). **A pull request** runs the server tests its change can affect, chosen
  from a traced dependency map (`.github/ci/select-tests.mjs`) and sharded across runners behind the required
  summary `test (server)`; `test (agent)`, `test (pwa)`, `build-pwa` and `probe-macos` run in full, and
  `test-macos` runs the same selection, advisory. A change under `.github/` or `server/scripts/`, to any
  `package.json` or lockfile, `vitest.config.*`, `tsconfig*.json`, `.gitattributes` or `.npmrc`, or a missing
  map, runs the full suite instead — and **while
  `CCRC_SELECTION` in `ci.yml` reads `shadow`, the selection is only reported and every server test still
  runs.** **A merge to `main`** runs no test legs: it re-traces the tests the merge affected and updates the map.
  **Daily**, on `main`, every leg runs in full, macOS included, and the map is rebuilt — skipped when `main`'s
  head already carries a green `full-suite` check. **A promotion to `stable`** needs a green `full-suite` on the
  commit: `release-stable.yml`'s `gate` finds one or runs `ci.yml` in full mode first. So a green PR proves its
  selection, not the whole suite; the daily run and the stable gate are where a miss is caught.
- **Node floor `>=22.13.0`, identical across the three engines**''')

swap('CLAUDE.md',
'''  fast-forward push of a released commit to the `stable` branch runs `release-stable.yml` → `deploy/release-stable.sh`,
  which flips the existing release's flag and makes it latest (design `2026-09-20-centralised-update-management-design.md`
  §4). Demotion is `gh release edit <tag> --prerelease` by hand and moves no box. Moving the fleet
''',
'''  fast-forward push of a released commit to the `stable` branch runs `release-stable.yml` → `deploy/release-stable.sh`
  (only once the commit has a green `full-suite`, above), which flips the existing release's flag and makes it
  latest (design `2026-09-20-centralised-update-management-design.md` §4). Demotion is `gh release edit <tag>
  --prerelease` by hand and moves no box. Moving the fleet
''')
print('applied')
EOF
git diff --stat
```

  Expected: `applied`, then

  `.github/workflows/release-main.yml |  9 +++++++--`, `CLAUDE.md | 20 +++++++++++++++++---`,
  `2 files changed, 24 insertions(+), 5 deletions(-)`.

- [ ] **Step 2: Run the suites that read `CLAUDE.md` or `release-main.yml`**, each alone, plus the text guards
  (foreground; `grep -ln 'CLAUDE.md' test/*.ts` lists 32 files, including heavy ccd/ccrc suites — allow up to 50
  minutes on a loaded box):

```bash
cd server
for f in $(grep -ln 'CLAUDE.md' test/*.ts) test/build-release.test.ts test/release-main.test.ts test/dtbd.test.ts test/source-bytes.test.ts; do
  echo "$f: $(./node_modules/.bin/vitest run "$f" --maxWorkers=2 | grep -E '^ +Tests ')"
done
```

  Expected: every file passes. Measured in the integration clone at this task's commit: the CLAUDE.md prose pins
  `box-token-census` 14 passed, `pools-prose` 27, `ledger-instruction` 4, `mail-hardening` 18,
  `coord-pause-route` 20; `oss-metadata` 22, `single-definition` 160, `topology-clean` 55, `ccd-bounded-reads` 46;
  `build-release` 29, `release-main` 19, `dtbd` 1, `source-bytes` 2. The whole list was measured on the draft
  tree, where these two files are byte-identical: 36 files, `Tests  2178 passed | 29 skipped (2207)`.
  The CLAUDE.md pins this touches are prose pins over OTHER bullets (`pools-prose`, `box-token-census`,
  `ledger-instruction`, `mail-hardening`, `coord-pause-route`, the README-size claim in `oss-metadata` and
  `pools-prose`); the new bullet adds no number they measure. `build-release.test.ts`'s release-main pins forbid
  `schedule:`, `workflow_dispatch`, `workflow_call`, `pull_request`, `npm ci`/`npm run`/`build-release.sh` and
  `gh release` anywhere in release-main.yml — the new comment names none of them.

- [ ] **Step 3: Commit**, then the history guards

```bash
git add CLAUDE.md .github/workflows/release-main.yml
git commit -F - <<'EOF'
docs: say what CI runs on a PR, on a merge, daily and at promotion

release-main.yml's "main's post-merge matrix is a 45-minute re-check" no
longer exists — a merge now runs ci.yml's refresh mode. CLAUDE.md's
Build / test / deploy section gains the pipeline's modes and the stable
gate (spec 2026-09-23 §14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git fetch origin main
cd server
for f in deviation-refs topology-clean; do ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '; done
```

  Measured at this task's commit: 31 and 55 passed.

---


### Task 14: Pre-merge verification, PR, branch-scoped map, history replay report

`$SCRATCH` below is a scratch directory OUTSIDE the checkout (`SCRATCH=$(mktemp -d)`); every command runs from the
repository root unless it says otherwise.

**Files:**
- Create (scratch only, never committed): `build-replay-dataset.mjs` in `$SCRATCH`, OUTSIDE the checkout —
  the read-only GitHub-history dataset builder for the replay (spec §11.3). It imports nothing from the tree, is not
  one of Task 10's shipped modules, and is never added to the PR branch (a file under `.github/` in the checkout
  would be one `git add -A` away from shipping).
- Consumes (from Tasks 1–13, committed on `ws/ccrc-ci-runs-optimization`): `.github/workflows/ci.yml`,
  `.github/ci/*.mjs`, `server/vitest.select.config.ts`, `.github/workflows/release-stable.yml`.

**Interfaces:**
- Consumes: `replayCase({ map, changedFiles, failingTestFiles, existsAt })` and the `replay.mjs` CLI
  (`node .github/ci/replay.mjs --repo DIR --map FILE [--dataset FILE] [--prs FILE --times FILE]`) from Task 10;
  `ci.yml`'s `workflow_dispatch` input `mode`, `map-build`'s `testmap` artifact and `server-shard`'s `times-<shard>`
  artifacts (Task 11); the `times` CLI (Task 6).
- Produces: nothing shipped — a PR (title, body, base `main`, head `ws/ccrc-ci-runs-optimization`) and a report to
  the operator — for EACH of the two datasets, its size line, recall over proven failures, the not-proven list,
  misses and the selected-fraction distribution, plus the runtime share over the last 100 merged PRs — that gates
  Task 15's enforce flip.
- Changed in integration (the dataset): the builder emits EXACTLY `replay.mjs`'s dataset — a JSON array of
  `{ id, changedFiles, failingTestFiles, inheritedSuspect }`, `id` the run's database id as a string or, for the
  six documented misses, a slug. The draft emitted `{builtAt, repo, cases: [...]}` with `runId`/`slug`, which
  `replay.mjs` rejects (`TypeError: dataset.map is not a function`, measured).
- Changed in integration (the branch map): no local full-suite trace — tracing all 376 files on the loaded fleet box
  is not acceptable. The branch-scoped map comes from the branch's own pipeline (`gh workflow run ci.yml --ref
  ws/ccrc-ci-runs-optimization -f mode=rebuild`), fetched from its `testmap` artifact; if GitHub refuses that
  dispatch, the replay happens post-merge in Task 15 against `main`'s first map — spec §12's own order. That map
  is an artifact of a run on a feature branch, so `select` never picks it (Task 11's trust filter wants `main`); it
  serves this replay only.
- Changed in integration (operator's ruling M3): the report adds the runtime share — `gh pr list --state merged
  --limit 100 --json number,files` and the durations this PR's own full run measured, through `replay.mjs --prs
  --times` — and a failing test the map holds no record for is reported NOT PROVEN, outside recall.
- Changed in integration (two datasets, operator's ruling R1): the replay runs over BOTH the frozen study set —
  `docs/superpowers/specs/2026-09-23-ci-test-selection-replay-dataset.json`, spec §11.3's acceptance set: 114 real
  failures across 64 runs plus the 6 documented misses — and a fresh builder run, which adds failures newer than
  the study. The study set is frozen because GitHub job logs expire: the builder reads failures from job logs, and
  a fresh run over the same window now finds about a third of it (36 real cases from 150 runs, measured). Each
  replay's report opens with `dataset: N real cases from M runs, K synthetic, J inheritedSuspect`, so the
  operator sees each set's size beside its recall.
- Changed in integration (the map build's red, operator's ruling R2): with trace-run exiting 0 (Task 7), a trace
  shard is `success` unless trace-run itself crashed. What must be `success` is `map-build`; when it is red, its map
  was still published, and the Build step's annotations say why — read below (Step 6).

- [ ] **Step 1: Confirm the branch is ready and git identity is clean**

```bash
git status --porcelain          # expect: empty (nothing uncommitted)
git log --format='%an <%ae>' origin/main..HEAD | sort -u
```

  Expected: one line — the operator's GitHub noreply identity (the git-identity rule in the operator's memory:
  noreply everywhere) — for every commit ahead of `origin/main`. If any other author or address appears, stop and
  re-author before going further: a foreign identity fails the pre-push hook.

- [ ] **Step 2: Run the repo-wide guards, plus every suite that reads a touched file** — each file alone:

```bash
cd server
for f in topology-clean source-bytes single-definition dtbd deviation-refs; do
  ./node_modules/.bin/vitest run test/$f.test.ts --maxWorkers=2 | grep -E '^ +Tests '
done
```

  Measured on the integrated branch (Tasks 1–13 applied): 55, 2, 160, 1 and 31 passed. A red here is the plan's
  own guardrail firing, not noise — read the failure before assuming it is a repo-wide flake.

  Then find every suite that reads a file this branch touched, and run each singly:

```bash
git diff --name-only origin/main...HEAD | while read -r f; do
  grep -l "$(basename "$f")" server/test/*.ts 2>/dev/null
done | sort -u > "$SCRATCH/ci-touched-suites.txt"
cd server
while read -r f; do
  echo "=== $f: $(./node_modules/.bin/vitest run "${f#server/}" --maxWorkers=2 | grep -E '^ +Tests ')"
done < "$SCRATCH/ci-touched-suites.txt"
```

  Record pass/fail per file. A file on this list that a load flake ever touches (`ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run **in isolation** before it
  is called a real break (`CLAUDE.md`'s Known load flakes list). `typecheck-tests` needs `agent/` and `pwa/`
  `node_modules`; measured in the integration clone: `tsc -p test/tsconfig.tests.json --noEmit` clean at every task
  commit, and `tsc --noEmit` clean at the tip.

- [ ] **Step 3: The full server suite, sharded** — spec §14: "the change's own verification is the full suite,
  sharded, before merge". This PR touches `.github/`, so its own CI run (Step 5) IS the full suite, sharded, on
  hosted runners — that run is the gate. If a local run is wanted as well, run an exact partition, one shard at a
  time, in the foreground (timeout ≥ 600000 ms each; vitest's `--shard=i/n` slices one hash-sorted list into `n`
  contiguous pieces, so `1/6` … `6/6` covers every file exactly once):

```bash
cd server
for i in 1 2 3 4 5 6; do ./node_modules/.bin/vitest run --shard=$i/6 --maxWorkers=2 | grep -E '^ +(Test Files|Tests) '; done
git ls-tree -r --name-only HEAD -- test | grep -c '\.test\.ts$'
```

  Sum the six "Test Files" counts and compare with the last line, so a shard silently dropping files is visible.
  Then `cd agent && npm ci && npm run test` and `cd pwa && npm ci && npm run test` (pwa alone on the box — it is
  timing-sensitive).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin ws/ccrc-ci-runs-optimization
```

  Body file (written once, referenced by `gh pr create --body-file`):

```markdown
## Summary
- PR-only CI selection from a measured strace dependency map (file-level, sharded); full suite moves to a daily
  `main` job and gates `stable` promotion; ships in shadow mode (select-and-report, still runs everything) until
  the history replay says it is safe to enforce.

## Spec and plan
- Spec: https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/specs/2026-09-23-ci-test-selection-design.md
- Plan: https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/plans/2026-09-23-ci-test-selection.md
- Until this PR merges those two links resolve only on `main`; read the plan in this PR's Files tab.

## Test plan
- [ ] `topology-clean`, `source-bytes`, `single-definition`, `dtbd`, `deviation-refs` green
- [ ] Every suite touching a changed file green (Task 14 Step 2 list, pasted below)
- [ ] This PR's own CI (full pipeline — it touches `.github/`, so `select`'s pipeline-change step runs it with
      `--input-mode full`) green on all 4 required checks plus `probe-macos`
- [ ] agent + pwa suites green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
gh pr create --repo Synapsium-Labs/ccrc-pwa --base main --head ws/ccrc-ci-runs-optimization \
  --title "CI: measured test selection, sharding, daily full run, stable gate" \
  --body-file "$SCRATCH/ci-pr-body.md"
```

  **Never** put a docserver (tailnet-only) link in this body — this repo is public and most readers cannot open it.

- [ ] **Step 5: Read this PR's own CI — the first live exercise of sharding, the summary job and the macOS shards**

```bash
PRN=<the PR number gh pr create printed>
gh run list --repo Synapsium-Labs/ccrc-pwa --branch ws/ccrc-ci-runs-optimization --json databaseId,headSha,status,conclusion,event -L 5
```

  Confirm a run exists for the PR's **head sha** specifically (`strict: false` means `main` can carry its own runs
  too), then read **each job's** conclusion (never trust `gh pr checks`' collapsed exit code as the verdict — a
  `cancelled` job is not a failure, and the exit code conflates them):

```bash
gh run view <databaseId> --repo Synapsium-Labs/ccrc-pwa --json jobs -q '.jobs[] | {name,conclusion}'
```

  For any `failure`, fetch its log and read the actual assertion — don't guess from the job name:

```bash
gh api repos/Synapsium-Labs/ccrc-pwa/actions/jobs/<jobDatabaseId>/logs
```

  **Decision rule:** this PR's CI must show all four required checks (`test (server)`, `test (agent)`,
  `test (pwa)`, `build-pwa`) green plus `probe-macos`; `test-macos` is read but is advisory (spec §3/§10) — a
  `test-macos` failure does not block. Because this PR touches `.github/`, its **own** run is full, decided before
  the selector runs: the `select tests` job's step *Does this pull request change the pipeline?* must print
  `this pull request changes the pipeline:` followed by `.github/` paths, and `Select` then runs with
  `--input-mode full` — so the job summary reads `tests: full` with an EMPTY `fallback` (a full run by input mode,
  not a map fallback). Confirm both there rather than assuming them.

- [ ] **Step 6: Build a branch-scoped map on the branch's own pipeline, and fetch it** — once the PR's pipeline is
  on the branch (Step 5 green):

```bash
gh workflow run ci.yml --repo Synapsium-Labs/ccrc-pwa --ref ws/ccrc-ci-runs-optimization -f mode=rebuild
gh run list --repo Synapsium-Labs/ccrc-pwa --branch ws/ccrc-ci-runs-optimization --workflow ci.yml \
  --json databaseId,event,status,conclusion -L 3          # the workflow_dispatch run
gh run view <databaseId> --repo Synapsium-Labs/ccrc-pwa --json jobs -q '.jobs[] | {name,conclusion}'
gh run download <databaseId> --repo Synapsium-Labs/ccrc-pwa -n testmap -D "$SCRATCH/branch-map"
```

  In `rebuild` mode `select` answers `tests: none, trace: rebuild`. Every `trace i/n` is `success` unless
  trace-run itself crashed (read that shard's log). `map-build` publishes the map as the `testmap` artifact in
  every case below, and the last command fetches it to `$SCRATCH/branch-map/testmap.json`; `map-build` itself is
  `success`, or red with a reason its Build step's annotations name:
  - `::error::testmap: <file> newly fails under trace (<why>)` (exit 3) — a traced test failed or timed out, and
    was not unknown in the map this run started from. This branch rebuild starts from no trusted map (none exists
    before the merge), so EVERY failure counts once here. Expected: `session-hook` (spec §15.12 — its timing
    budgets fail under tracing, so it stays `unknown` and always selected) and possibly the other timing-budget
    tests §5.3 names (`boot`). Every other file named is read in its trace shard's log and explained in the report.
    Each stays `unknown` in the map — selected on every change — so none of this narrows selection.
  - `::error::testmap: <file> floor: git is false` or `… floor: lists nothing` (exit 4) — a floor test lost its
    breadth: a tracer or parser regression, or a refactor that moved the test off `.git` reads or directory walks.
    It is `unknown` (always selected) in the published map; stop and report it before the replay — the fix is the
    tracer, or `GIT_FLOOR`/`WALK_FLOOR` in `.github/ci/testmap.mjs` with its pin.
  - A `::warning::testmap: … still fails under trace` is a failure that was already unknown: expected, not news.

  **Decision rule.** If GitHub refuses the dispatch — whatever its message (for instance a complaint about the
  `mode` input, if it validates inputs against a copy of `ci.yml` that does not declare it) — do NOT build a map any
  other way: the replay simply happens post-merge in Task 15 against `main`'s first map, which is spec §12's own
  order (build the map, then replay, then enforce). Record which of the two paths was taken in the report.

- [ ] **Step 7: Build the dataset (read-only `gh`) and run the replay**

  The scratch dataset builder, full content (in `$SCRATCH`, outside the checkout):

<!-- scratch-file: build-replay-dataset.mjs -->
```javascript
#!/usr/bin/env node
// Scratch, read-only dataset builder for the history replay (spec §11.3).
// Not shipped: it lives OUTSIDE the checkout (a scratch directory), is never committed, and imports nothing
// from the tree. Usage: node build-replay-dataset.mjs --repo Synapsium-Labs/ccrc-pwa --limit 150 --out dataset.json
//
// Output: exactly the dataset `.github/ci/replay.mjs` reads — a JSON ARRAY of
//   { id, changedFiles, failingTestFiles, inheritedSuspect }
// where `id` is the CI run's database id (as a string) or, for the six documented misses, a slug.
//
// Reads GitHub only through `gh` (read-only: run list/view, api). Requires `gh auth status` to
// already be logged in.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
}
const REPO = opt('repo', 'Synapsium-Labs/ccrc-pwa');
const LIMIT = Number(opt('limit', '150'));
const OUT = opt('out', 'dataset.json');

// Job names that carry server-test failures, across pre- and post-sharding shapes.
const SERVER_JOB_RE = /^(test \(server\)|test-macos|server \d+\/\d+|test-macos \d+\/\d+)$/;

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
function stripTimestamp(line) {
  // GitHub Actions log lines are prefixed "2026-09-23T11:24:54.5224740Z "
  return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '');
}

// vitest prints two shapes we care about:
//   " FAIL  test/x.test.ts"                       (per-file failure banner)
//   " ❯ test/x.test.ts (N tests | M failed)"       (summary tree line, only when M > 0)
const FAIL_BANNER_RE = /^\s*FAIL\s+(\S+\.test\.ts)/;
const SUMMARY_LINE_RE = /^\s*❯\s+(\S+\.test\.ts)\s+\(\d+ tests? \| (\d+) failed\)/;

function parseFailingTestFiles(logText) {
  const files = new Set();
  for (const raw of logText.split('\n')) {
    const line = stripTimestamp(stripAnsi(raw));
    const m1 = line.match(FAIL_BANNER_RE);
    if (m1) files.add(m1[1]);
    const m2 = line.match(SUMMARY_LINE_RE);
    if (m2 && Number(m2[2]) > 0) files.add(m2[1]);
  }
  return [...files].sort();
}

function toRepoRelative(p) {
  // vitest prints paths relative to its cwd (server/), or occasionally already
  // "server/test/...". Normalize to the repo-relative form the map uses.
  if (p.startsWith('server/')) return p;
  if (p.startsWith('test/')) return `server/${p}`;
  return p;
}

function runsForWorkflow() {
  return ghJson([
    'run', 'list',
    '--repo', REPO,
    '--workflow', 'ci.yml',
    '--limit', String(LIMIT),
    '--json', 'databaseId,headSha,event,conclusion,createdAt,headBranch',
  ]);
}

function jobsFor(runId) {
  return ghJson(['run', 'view', String(runId), '--repo', REPO, '--json', 'jobs']).jobs;
}

function jobLog(jobId) {
  try {
    return gh(['api', `repos/${REPO}/actions/jobs/${jobId}/logs`]);
  } catch {
    return '';
  }
}

function changedFilesForRun(run) {
  try {
    if (run.event === 'pull_request') {
      const out = ghJson(['api', `repos/${REPO}/compare/main...${run.headSha}`]);
      return (out.files ?? []).map((f) => f.filename);
    }
    const out = ghJson(['api', `repos/${REPO}/commits/${run.headSha}`]);
    return (out.files ?? []).map((f) => f.filename);
  } catch {
    return null; // unresolvable; case is dropped, not silently zeroed
  }
}

function main() {
  const runs = runsForWorkflow();
  const cases = [];
  // Index push-to-main runs by createdAt so we can find "main's own push run near
  // the PR's base" for inheritedSuspect.
  const mainPushRuns = runs
    .filter((r) => r.event === 'push' && r.headBranch === 'main')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const run of runs) {
    if (run.conclusion !== 'failure') continue; // cancelled/success carry no failing case
    let jobs;
    try {
      jobs = jobsFor(run.databaseId);
    } catch {
      continue;
    }
    const failingServerJobs = jobs.filter(
      (j) => SERVER_JOB_RE.test(j.name) && j.conclusion === 'failure',
    );
    if (failingServerJobs.length === 0) continue;

    const failingTestFiles = new Set();
    for (const job of failingServerJobs) {
      const log = jobLog(job.databaseId);
      for (const f of parseFailingTestFiles(log)) failingTestFiles.add(toRepoRelative(f));
    }
    if (failingTestFiles.size === 0) continue; // failure wasn't a test-file failure (e.g. install)

    const changedFiles = changedFilesForRun(run);
    if (changedFiles === null) continue; // couldn't resolve the diff; drop rather than fabricate

    // inheritedSuspect: is there an earlier push-to-main run, close to this one, that
    // failed on one of the same test files? ("near the PR's base" — approximated here
    // by "most recent main push strictly before this run's createdAt".)
    let inheritedSuspect = false;
    const priorMain = mainPushRuns.filter((r) => new Date(r.createdAt) < new Date(run.createdAt)).pop();
    if (priorMain && priorMain.conclusion === 'failure' && priorMain.databaseId !== run.databaseId) {
      try {
        const priorJobs = jobsFor(priorMain.databaseId).filter(
          (j) => SERVER_JOB_RE.test(j.name) && j.conclusion === 'failure',
        );
        const priorFailing = new Set();
        for (const job of priorJobs) {
          const log = jobLog(job.databaseId);
          for (const f of parseFailingTestFiles(log)) priorFailing.add(toRepoRelative(f));
        }
        inheritedSuspect = [...failingTestFiles].some((f) => priorFailing.has(f));
      } catch {
        inheritedSuspect = false;
      }
    }

    cases.push({
      id: String(run.databaseId),
      changedFiles,
      failingTestFiles: [...failingTestFiles].sort(),
      inheritedSuspect,
    });
  }

  // The 6 documented misses (spec §11.3) — not present as ordinary CI failures because
  // they were caught by other means (a human, a later run) rather than a red required
  // check on their own PR. Recorded here as synthetic cases so the replay's recall
  // number covers them too.
  const synthetic = [
    {
      id: 'build-release-compact-card-ship',
      changedFiles: ['deploy/build-release.sh'],
      failingTestFiles: ['server/test/compact-card-ship.test.ts'],
    },
    {
      id: 'ccrc-doctor-checks-install-pool-parity',
      changedFiles: ['ccd/ccrc-doctor-checks'],
      failingTestFiles: ['server/test/ccrc-install.test.ts', 'server/test/pool-name-parity.test.ts'],
    },
    {
      id: 'coord-schema-version-asks-store',
      changedFiles: ['server/src/coord/schema.ts'],
      failingTestFiles: ['server/test/asks-store.test.ts'],
    },
    {
      id: 'close-review-run-sweepdec-unattended-actor',
      changedFiles: ['server/src/coord/watch.ts'],
      failingTestFiles: ['server/test/unattended-actor.test.ts'],
    },
    {
      id: 'dispatch-cap-concurrency-coordinator-skill',
      changedFiles: ['server/src/coord/dispatch.ts'],
      failingTestFiles: ['server/test/coordinator-skill.test.ts'],
    },
    {
      id: 'nul-byte-source-bytes',
      changedFiles: ['ccd/ccd'],
      failingTestFiles: ['server/test/source-bytes.test.ts'],
    },
  ].map((c) => ({ ...c, inheritedSuspect: false }));

  writeFileSync(OUT, JSON.stringify([...cases, ...synthetic], null, 2));
  console.log(
    `wrote ${OUT}: ${cases.length} real cases (from ${runs.length} ci.yml runs scanned) + ${synthetic.length} synthetic`,
  );
}

main();
```

  The durations come from this PR's own full run (Step 5's `<databaseId>`: `server-shard` keeps each shard's vitest
  JSON report as `times-<shard>` in full mode). The reports name each file by the RUNNER's absolute path, and the
  `times` CLI refuses keys outside `server/` relative to where it runs, so each report is re-rooted at this checkout
  first:

```bash
node "$SCRATCH/build-replay-dataset.mjs" --repo Synapsium-Labs/ccrc-pwa --limit 150 --out "$SCRATCH/dataset.json"
gh pr list --repo Synapsium-Labs/ccrc-pwa --state merged --limit 100 --json number,files > "$SCRATCH/prs.json"
gh run download <databaseId> --repo Synapsium-Labs/ccrc-pwa -p 'times-*' -D "$SCRATCH/times"
for f in "$SCRATCH"/times/*/times.json; do
  node -e 'const fs=require("fs");const [f,root]=process.argv.slice(1);const r=JSON.parse(fs.readFileSync(f,"utf8"));for(const t of r.testResults)t.name=t.name.replace(/^.*?\/server\/test\//,root+"/server/test/");fs.writeFileSync(f,JSON.stringify(r))' "$f" "$PWD"
done
node .github/ci/shards.mjs times --out "$SCRATCH/testtimes.json" "$SCRATCH"/times/*/times.json
# The acceptance set (spec §11.3), frozen beside the spec — plus the runtime share over the last 100 merged PRs:
node .github/ci/replay.mjs --repo "$PWD" --map "$SCRATCH/branch-map/testmap.json" \
  --dataset docs/superpowers/specs/2026-09-23-ci-test-selection-replay-dataset.json \
  --prs "$SCRATCH/prs.json" --times "$SCRATCH/testtimes.json" | tee "$SCRATCH/replay-frozen.txt"
# The fresh collection (failures newer than the study):
node .github/ci/replay.mjs --repo "$PWD" --map "$SCRATCH/branch-map/testmap.json" --dataset "$SCRATCH/dataset.json" \
  | tee "$SCRATCH/replay-fresh.txt"
```

  Rehearsed against Task 11 Step 13's three-test composition map (a schema check, not a result): the frozen set
  replays as-is in 18 s — `dataset: 114 real cases from 64 runs, 6 synthetic, 59 inheritedSuspect`, `cases: 120 (0
  scored, 59 excluded as inheritedSuspect)`, `not proven (…): 220 in 61 case(s)` (its 17 `test (pwa)` cases name
  `pwa/test/…` files no server map holds, and on a three-test map every failure is unmapped), and each recall line
  reads `n/a (no proven failure — nothing to score)`, never a vacuous 100%.

  Measured while integrating (read-only, this session): `--limit 12` → `0 real cases (from 12 ci.yml runs scanned)
  + 6 synthetic`; `--limit 40` (38 s) → `6 real cases (from 40 ci.yml runs scanned) + 6 synthetic`, every element
  exactly `["id","changedFiles","failingTestFiles","inheritedSuspect"]`. `replay.mjs` accepts that file
  (against a small real map from the pipeline composition of Task 11 Step 13 — a schema check, not a recall
  number): `cases: 12 (12 scored, 0 excluded as inheritedSuspect)`, `selected fraction of live server tests —
  min 25.0%, median 50.0%, max 100.0%`, `misses: none`, exit 0; the draft's
  `{builtAt, repo, cases}` file fails with `TypeError: dataset.map is not a function`. The draft's own full run
  (`--limit 150`, 5m40s) found `36 real cases (from 150 ci.yml runs scanned) + 6 synthetic` — 31 `pull_request`,
  5 `push`, 12 flagged `inheritedSuspect`; smaller than the spec's 114-failure/64-run study window, whose failure
  classifier was broader than this regex parser. The executing engineer reproduces it fresh (`--limit 150`), so its
  numbers are current for the map that actually ships. The selected fraction divides by the live tests (Task 10's
  `liveCountFor`: the map's tests plus the selected ones), so it never exceeds 100% — before that fix the same run
  read `max 233.3%`. Rehearsed with the runtime share (read-only `gh pr list … --limit 100` → 100 PRs; two shard
  reports from Task 11 Step 13's composition, re-rooted and merged by the `times` CLI) against that three-test
  map: `selected share of server runtime over 100 PRs — min 0.0%, median 36.1%, max 100.0%, mean 28.3%`, then the
  replay — `cases: 12 (0 scored, …)` and `not proven (…): 15 in 12 case(s)`: on a three-test map every failing
  test is unmapped, so nothing is scored rather than everything counted caught. Schema checks, not results.

  **Decision rule** (spec §11.3's acceptance target, applied mechanically, to EACH dataset): every PROVEN failing
  test of a case whose `inheritedSuspect` is `false` must appear in `replayCase`'s `selected`, not its `missed`,
  and a recall line reading `n/a` has judged nothing — a map too thin for that set. A case in
  `missed` is either (a) fixed by correcting the tracer/selector and re-running Steps 6–7, or (b) recorded as a
  known limitation under spec §9's table with the row it falls under — never silently dropped from the report. A
  NOT PROVEN test (absent from the map: rule 1 selected it for being unmapped) proves nothing either way; a
  not-proven list that holds most failing tests means the map is too thin to judge, and the replay is re-run
  against a fuller map. Report to the operator, verbatim, for each set: its `dataset:` line, the recall lines, the
  not-proven list, every miss with its explanation and the selected-fraction distribution; then the runtime-share
  line over the last 100 merged PRs, and which map was replayed (the branch rebuild's, or `main`'s first).
  This report is what Task 15's enforce flip is conditioned on — it does not happen until the operator has seen
  these numbers.

**Mutation table:** Task 14 adds no new guard (it is verification of guards Tasks 1–13 shipped), so no mutation
row is owed here — the mutation tables for §6.2's five selection rules, §6.3's fallbacks, and the workflow-shape
pins belong to Tasks 5, 9 and 11.

---

### Task 15: Post-merge — first refresh, first daily run, the enforce flip

**Files:**
- Modify: `.github/workflows/ci.yml` (Task 15's own change: `CCRC_SELECTION: shadow` → `CCRC_SELECTION: enforce`,
  one line, per the contract's "Workflow names and wiring") — **its own PR, separate from Task 14's PR**.
- Test: none new — this task re-runs the Task 11 workflow-shape pins and Task 14's guard/suite list against the
  post-merge tree as its verification, and adds nothing besides the one-line flip.

**Interfaces:**
- Consumes: the merged `main`'s `ci.yml` (`refresh` mode on push, `full` mode on `schedule` or dispatch, the
  `testmap` artifact), `release-stable.yml`'s `gate` job (Task 12), and Task 14's replay report — or, when Task 14
  Step 6 fell back, the replay this task runs itself (Step 2).
- Produces: a green `full-suite` check on `main` (the first full run) and the `enforce` flip merged in its own PR.
- Changed in integration: Step 2 fetches the first refresh's map (`gh run download … -n testmap`) and, when Task 14
  Step 6 fell back, runs Task 14 Step 7's dataset + replay against it and reports before anything else here — the
  spec §12 order.

- [ ] **Step 1: Merge only after the operator approves in chat, with a hand-written body, never `--auto`, never
      `--delete-branch`**

```bash
gh pr merge <n> --repo Synapsium-Labs/ccrc-pwa --squash --admin --subject "<title>" --body-file "$SCRATCH/ci-merge-body.md"
```

  `--admin` is required because this repo's ruleset wants an approval nobody but the operator can give; this PR's
  own green run already satisfied the required checks. A merge-body correction after the fact goes through
  `gh api --method PATCH repos/Synapsium-Labs/ccrc-pwa/pulls/<n> -F body=@"$SCRATCH/ci-merge-body.md"`, not
  `gh pr edit` (which fails silently on this repo).

- [ ] **Step 2: Watch and read the first `refresh` run on `main`, and fetch its map**

```bash
gh run list --repo Synapsium-Labs/ccrc-pwa --branch main --json databaseId,headSha,event,status,conclusion -L 3
gh run view <databaseId> --repo Synapsium-Labs/ccrc-pwa --json jobs -q '.jobs[] | {name,conclusion}'
gh run download <databaseId> --repo Synapsium-Labs/ccrc-pwa -n testmap -D "$SCRATCH/main-map"
```

  Expect one `event: push` run at the merge commit. Per spec §5.4/§12.3 this refresh finds **no map** — no
  trusted `testmap` artifact exists yet (`select`'s fetch step prints `testmap: none`) — and traces every live
  server test file: a full traced rebuild wearing the `refresh` job set (`select`, `trace-shard`, `map-build`; no
  agent/pwa/build/macOS legs), whose `map-build` publishes the first `testmap`. **Decision rule:** every `trace i/n`
  is `success` unless trace-run crashed; `map-build` publishes its map either way, and is read exactly as in Task
  14 Step 6 — with no map before it, every traced test that fails under tracing is named once (`exit 3`:
  `session-hook` expected, spec §15.12), and each other file named is read in its trace shard's log
  (`gh api repos/Synapsium-Labs/ccrc-pwa/actions/jobs/<id>/logs`) for why: "either a real semantic merge conflict
  among the affected tests, or a timing test perturbed by tracing" (§5.4). A `floor:` line (exit 4) is stopped on
  and reported. It gates nothing; the next refresh re-traces those tests (they are `unknown`) and, failing again,
  warns rather than reds.

  **If Task 14 Step 6 fell back**, run Task 14 Step 7 now against `$SCRATCH/main-map/testmap.json` (with `--repo`
  a checkout of `main`), apply its decision rule, and report to the operator before Step 5.

- [ ] **Step 3: Produce the first `full-suite`** — `full-suite` only exists in `full` mode (spec §8). Do not wait
  passively across turns for the daily schedule; dispatch it:

```bash
gh workflow run ci.yml --repo Synapsium-Labs/ccrc-pwa --ref main -f mode=full
gh run list --repo Synapsium-Labs/ccrc-pwa --workflow ci.yml --json databaseId,event,status,conclusion -L 3
gh run view <databaseId> --repo Synapsium-Labs/ccrc-pwa --json jobs -q '.jobs[] | select(.name=="full-suite")'
```

  `mode` is on `main`'s own `ci.yml` now, so this dispatch validates against the file that declares it. This run is
  on `main` from a dispatch, so its `times-build` publishes the first `testtimes`. Confirm the next `select` will
  find both, with the same picker it runs (read-only; the token is `gh`'s own, never printed):

```bash
REPO_ID=$(gh api repos/Synapsium-Labs/ccrc-pwa -q .id)
for name in testmap testtimes; do
  GITHUB_TOKEN=$(gh auth token) GITHUB_OUTPUT='' node .github/ci/main-artifact.mjs --repo Synapsium-Labs/ccrc-pwa --repo-id "$REPO_ID" --name "$name"
done
```

  Expected: each prints `artifact_id=<n>`, `run_id=<the run that published it>` and `head_sha=<its commit>`.
  **Decision rule:** `full-suite` must read `conclusion: success` — every leg, Linux shards, typechecks, agent,
  pwa, build **and the macOS shards**, green (spec §8). A red `full-suite` here is the safety net doing its job for
  the first time: don't flip enforce (Step 5); diagnose the leg with Task 14 Step 5's log read.

- [ ] **Step 4: Confirm the stable gate reads this evidence, without promoting anything** (do **not** push to
  `stable` — that is a promotion decision outside this task):

```bash
DISPATCH_SHA=$(gh run view <databaseId> --repo Synapsium-Labs/ccrc-pwa --json headSha -q .headSha)   # Step 3's run
gh api "repos/Synapsium-Labs/ccrc-pwa/commits/$DISPATCH_SHA/check-runs" --jq '.check_runs[] | select(.name=="full-suite") | {name,conclusion}'
```

  The dispatch ran on `main`'s head AT DISPATCH TIME, which is the merge commit only if nothing merged since — so
  the check is read on the commit that run actually tested. Expected: one entry, `conclusion: success` (absent
  while Step 3's run is still in flight — re-check after it completes). This is the exact query `gate` performs,
  so the gate is exercised rather than assumed.

- [ ] **Step 5: The enforce flip — its own PR, merged only on the operator's approval**

```bash
git clone -q https://github.com/Synapsium-Labs/ccrc-pwa.git "$SCRATCH/enforce" && cd "$SCRATCH/enforce"
git checkout -q -b ws/ccrc-ci-enforce-selection origin/main
git config user.name; git config user.email     # expect: the operator's GitHub noreply identity (Task 14 Step 1)
(cd server && npm ci) && (cd agent && npm ci) && (cd pwa && npm ci)   # Task 14 Step 2's suites need all three
sed -i 's/^  CCRC_SELECTION: shadow$/  CCRC_SELECTION: enforce/' .github/workflows/ci.yml
git diff .github/workflows/ci.yml   # expect: exactly one changed line, shadow -> enforce
git add .github/workflows/ci.yml
git commit -F - <<'EOF'
ci: flip test selection from shadow to enforce

The replay in the CI-selection history-replay report showed full recall
over non-inherited failures; the daily full-suite run and the stable gate
remain the safety net this flip is trusted against.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --format='%an <%ae>' origin/main..HEAD | sort -u   # expect: one line, that same identity
git push -u origin ws/ccrc-ci-enforce-selection
gh pr create --repo Synapsium-Labs/ccrc-pwa --base main --head ws/ccrc-ci-enforce-selection \
  --title "ci: enforce measured test selection (was shadow)" --body-file "$SCRATCH/enforce-pr-body.md"
```

  The body names the replay report (as the operator received it) and links the first `full-suite` run of Step 3,
  and ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line. Run the same
  pre-merge checklist as Task 14 (Steps 2 and 5 — this PR touches `.github/`, so its own CI is `full` regardless
  of the flip), report to the operator, and merge only on explicit approval:

```bash
gh pr merge <n2> --repo Synapsium-Labs/ccrc-pwa --squash --admin --subject "<title>" --body-file "$SCRATCH/enforce-merge-body.md"
```

  **Decision rule for going ahead with this step at all:** only if the replay's recall was 100% over the PROVEN
  failures of every non-`inheritedSuspect` case in BOTH datasets — the frozen study set (spec §11.3's acceptance
  set) and the fresh collection — each with at least one proven case (a recall line reading `n/a` is not 100%), or
  every miss was individually explained and either fixed (re-measured back to 100%) or accepted by the operator as
  a known limitation under spec §9's table. A partial, unexplained recall
  number is not a green light — report it and stop, per spec §12 ("Replay … and report the numbers to the
  operator" strictly before "Enforce").

**Mutation table:** none new here either — Step 5's one-line flip changes a value the workflow-shape pins (Task 11)
already assert on both sides (`CCRC_SELECTION: (shadow|enforce)`); no new assertion is introduced by this task.

---

## Deviations found

None at planning time. The departures from the spec's first text that planning and its two review rounds measured —
the process-side split of traces, the baseline's directory listings not being full-run triggers, the refresh never
carrying an entry it meant to replace, trusted-artifact maps instead of the Actions cache, the pipeline-change check
that does not trust the selector, fail-closed verdicts, symlink, directory-link and working-directory tracing, the
floors that mark rather than refuse, the frozen acceptance dataset, and the rest — are written into the spec itself as
§15, so this plan implements the spec as amended. A departure found while EXECUTING a task is recorded here under a
number minted by the ledger API (`POST /api/ledger/deviations`), allocated and defined in the same act.
