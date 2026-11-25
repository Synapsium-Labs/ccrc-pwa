# Landing order, wave 1d — the merge queue's own CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, as the dispatch specifies. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: decided by the programme's coordinator on 2026-11-25 (call 1018), on three defects measured in the merge queue on 2026-11-24.** No implementation exists yet.

**Goal:** A green pull request is no longer removed from the merge queue, and the groups behind it rebuilt, for one of three causes that are the queue run's own: a shard deadline a minute above its slow case, a superseded group's run still taking runners, and a growth check that measures a stacked group against `main`.

**Why:** each removal rebuilds every group behind the entry, and each rebuild is up to five full runs.
- 2026-11-25 01:13Z: a queue run's server shard passed all 170 of its files in 1771.72 s and was cancelled at its 30-minute deadline one second later; the entry was removed as failed. Queue shards that night took from 15m47 to 29m53 on the same selection size, by runner.
- 2026-11-24, from 19:40Z: two batches of five groups timed out at the queue's hour while runs of groups the queue had already rebuilt or removed still held runners. Coordinators cancelled eleven such runs by hand that evening, and the batch during which the first four were cancelled landed three pull requests.
- 2026-11-24 23:10Z: a documentation pull request's group went red on `growth-check`: `server/src/server.ts` grew by 41 net code lines, limit 40. Two pull requests ahead of it in the stack added 7 and 43 lines to that file; each had passed the check alone.

**Architecture:** One changed number and its comment in `ci.yml`. One small script under `.github/ci/` with a pure decider, run as the first step of the queue run's long jobs. One base resolver in the growth check. No new job, no new required check name, no new permission, no setting.

**Tech Stack:** GitHub Actions YAML, Node ESM scripts under `.github/ci/`, vitest suites under `server/test/`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.2 (the merge queue) and §10 (the targets this serves: fewer wasted CI runs per landing). The spec's text does not change in this wave; the three decisions are this plan's deviations.

**Files (the whole wave):**
- Modify: `.github/workflows/ci.yml` (the `server-shard` deadline and its comment; one first step in each long job; `QUEUE_BASE` in the server shards' environment)
- Create: `.github/ci/queue-live.mjs`
- Create: `server/test/queue-live.test.ts`
- Modify: `server/test/growthCheck.ts` and `server/test/growth-check.test.ts` (the base resolver and its cases)
- Modify: `server/test/oss-metadata.test.ts` (the deadline pin, if its ceiling names 30)
- Modify: whichever suite pins the workflow's step lists, found in Task 2 Step 1
- Modify: `README.md` (the "What CI runs" account of a merge-queue run: three sentences)

## What this does not claim

- **It changes no repository setting.** The queue's own limits (how many groups build at once, the hour a group may take) are the operator's and stay as they are.
- **It does not make the queue faster.** It removes three causes of a rebuild. Runner capacity is unchanged.
- **It cancels nothing.** A superseded run's jobs end themselves when they start; a job already running when its group is superseded runs to its end. Cancelling from inside a run needs a write permission this wave does not add.

## Global Constraints

- **No new permission.** Every `permissions:` block in `ci.yml` is unchanged, and the workflow-level block stays `contents: read`. The suites that pin them (`ci-pipeline.test.ts`, `oss-metadata.test.ts`) stay green without an edit to a permission assertion.
- **Every required check name still reports, over what ran:** `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`. No job is added, renamed or made conditional at the job level.
- **Fail open on an unmeasured read.** A queue-liveness read that fails (network, rate limit, an answer that does not parse) lets the job run. Only two measured facts together end a job early: the queue branch is gone, and the group's commit is not on `main`.
- **A pull request's run is untouched.** Every new step is under `if: github.event_name == 'merge_group'`, and the growth check's base changes only when `GITHUB_EVENT_NAME` is `merge_group`.
- **This pull request changes `.github/`, so it runs the full suite** (the selector's `infraTrigger`). Do not add the `full-ci` label and do not dispatch a full run by hand.
- **Pins move with their text,** in the commit that changes the text.
- **Neutral names only.** The repository is public. Pull request numbers of this repository are fine; session, lane and host names are not.
- **Files other sessions hold.** Read `GET /api/claims?project=ccrc-pwa` before each task. For a held file, send its holder the hunk as a packet first: a unified diff against a named `main` commit, inline, with its size and sha256; the file stays untouched until the answer. `README.md` and `.github/workflows/ci.yml` are the likely ones.
- **Tests.** Every test runs from `server/` as `cd server && ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <files>`, in the foreground, with a timeout of at least 600000 ms. Fixture repositories only, made in the run's temp root; never `gh` or `git push` from a test.
- **Deviation numbers are issued, never chosen.** This plan defines D-9014 to D-9016, the last three of the six numbers (9011 to 9016) issued on 2026-11-24. A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Push once, when the build is complete, with code, tests and notes together. Notes go under `docs/superpowers/programs/landing-order/` as `wave1d-task-<n>.md`.

## Review Focus

1. **A live group is never ended.** A group whose queue branch exists runs every step, whatever the second read answers. Pinned by Task 2's decider table; mutation 1D-03 inverts it.
2. **A landed group is never ended.** After a merge the queue branch is deleted while advisory legs may still start; the group's commit is then on `main`, and the job runs. Pinned by the `landed` row; mutation 1D-04 drops the second read.
3. **An unmeasured read never ends a job.** A failed `git ls-remote`, a failed compare call, or an answer outside the vocabulary is `unmeasured`, and the job runs. Pinned row by row.
4. **The growth check's limit per pull request is unchanged.** A pull request that grows a listed file past the limit alone still fails in the queue, measured against its own parent. Pinned by Task 3's stacked fixture, whose second commit goes over alone.
5. **A waiver or an exemption is read as before.** `armedGrowth` still takes the exemption list from `origin/main` and a waiver only from the measured diff; only the base it is handed changes. Task 3's existing cases stay green unchanged.

---

### Task 1: the server shard's deadline

**Files:**
- Modify: `.github/workflows/ci.yml` (job `server-shard`: `timeout-minutes` and the comment above it)
- Test: `server/test/oss-metadata.test.ts`

**Interfaces:**
- Produces: `timeout-minutes: 45` on `server-shard`, and no other job's deadline changed.

- [ ] **Step 1: Read the pin.** `oss-metadata.test.ts`'s case `every job declares a timeout-minutes, and one that is still a deadline` checks a key and a ceiling. If its ceiling admits 45, the suite needs no edit; if it names 30 for this job, move it to 45 in the same commit, and add nothing else.
- [ ] **Step 2: Change the number and rewrite the comment** so that it says what was measured (D-9014): a full queue shard took from 15m47 to 29m53 on 2026-11-24 depending on its runner, one green shard was cancelled at 30m00, so 45 is a deadline with about half as much again over the slow case and still under the queue's own hour. Delete the sentence that says each shard is packed to about four minutes for every run: that is a fast pull request's packing only, and say so.
- [ ] **Step 3: Run** `oss-metadata`, `ci-pipeline` and every suite `git grep -l "timeout-minutes" server/test` names. Expected: green.
- [ ] **Step 4: Commit.** `fix(ci): a server shard's deadline clears its slow-runner case (wave 1d, D-9014)`

### Task 2: a superseded queue group's jobs end when they start

**Files:**
- Create: `.github/ci/queue-live.mjs`
- Create: `server/test/queue-live.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces, from `.github/ci/queue-live.mjs`:
  - `export function queueGroupFate(read: { branch: 'present' | 'absent' | 'unmeasured'; onMain: 'yes' | 'no' | 'unmeasured' }): 'live' | 'landed' | 'superseded' | 'unmeasured'` — pure. `present` → `live` whatever `onMain` says. `absent` with `yes` → `landed`. `absent` with `no` → `superseded`. Every other pair → `unmeasured`.
  - `export function compareWord(status: unknown): 'yes' | 'no' | 'unmeasured'` — pure. GitHub's compare of `<group sha>...main` answers `ahead` or `identical` when the commit is an ancestor of `main` (`yes`), `diverged` or `behind` when it is not (`no`); any other value is `unmeasured`.
  - The script's main: reads `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_REPOSITORY` and `GITHUB_SERVER_URL`; measures the branch with `git ls-remote --exit-code <server>/<repository> <ref>` (exit 0 `present`, exit 2 `absent`, anything else `unmeasured`); only when `absent`, measures `onMain` with one `gh api repos/<repository>/compare/<sha>...main --jq .status`; prints one line `queue-live: <fate>` with both reads; exits 1 only on `superseded`, and 0 otherwise. Every child process has a 30-second deadline, and a deadline passed is `unmeasured`.

- [ ] **Step 1: Find the pins.** `git grep -l "ci.yml" server/test` names the suites that read the workflow. Note which pin a job's step list or its first step (`ci-pipeline.test.ts`, `oss-metadata.test.ts` and the selector's suites are the likely ones); they move in Step 5.
- [ ] **Step 2: Write the failing test** `server/test/queue-live.test.ts`. It imports the two pure functions from `../../.github/ci/queue-live.mjs` (the way the suites for `select-tests.mjs` and `reach.mjs` import theirs) and holds:

```ts
it('decides a queue group fate from two reads, and only an absent branch off main is superseded', () => {
  const rows: Array<[Branch, OnMain, Fate]> = [
    ['present', 'yes', 'live'], ['present', 'no', 'live'], ['present', 'unmeasured', 'live'],
    ['absent', 'yes', 'landed'], ['absent', 'no', 'superseded'], ['absent', 'unmeasured', 'unmeasured'],
    ['unmeasured', 'yes', 'unmeasured'], ['unmeasured', 'no', 'unmeasured'], ['unmeasured', 'unmeasured', 'unmeasured'],
  ];
  for (const [branch, onMain, fate] of rows) expect(queueGroupFate({ branch, onMain }), `${branch}/${onMain}`).toBe(fate);
});
it('reads the compare status, and an unknown word is unmeasured', () => {
  expect(['ahead', 'identical'].map(compareWord)).toEqual(['yes', 'yes']);
  expect(['diverged', 'behind'].map(compareWord)).toEqual(['no', 'no']);
  expect([undefined, null, '', 'AHEAD', 7, {}].map(compareWord)).toEqual(Array(6).fill('unmeasured'));
});
```

  and one end-to-end case on a fixture: a bare repository made in the run's temp root with a branch `gh-readonly-queue/main/pr-1-<sha>`, the script run as a child process with `GITHUB_SERVER_URL` set to the fixture's parent as a `file://` URL and a stub `gh` first on `PATH` that prints the status the case names. Assert the printed line and the exit status for `live` (branch present; the stub is never run, which the case proves by having it write a marker file), `landed`, `superseded`, and `unmeasured` (the stub exits 1).
- [ ] **Step 3: Run it.** Expected: red, the module does not exist.
- [ ] **Step 4: Write `.github/ci/queue-live.mjs`** to the interface above. No dependency beyond `node:child_process` and `node:process`.
- [ ] **Step 5: Add the step to the workflow** (D-9015), as the FIRST step of each of these jobs: `deps`, `server-shard`, `server-typecheck`, `server-perf`, `mask-perf`, `test`, `pwa-shard`, `pwa-static`, `build-pwa`, `browser-pwa` and `node-floor`. Several of these run even when `deps` failed, so each carries the step itself. The step needs the script before any checkout, so it fetches that one file from the default branch, never from the group's own commit: a superseded group's commit may no longer be served, and that is the very case the step is for. Until this wave has landed the fetch finds nothing and the step reports `unmeasured`, which is the fail-open arm:

```yaml
      - name: queue group still live
        if: github.event_name == 'merge_group'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh api "repos/$GITHUB_REPOSITORY/contents/.github/ci/queue-live.mjs" -H 'Accept: application/vnd.github.raw' > "$RUNNER_TEMP/queue-live.mjs" || { echo 'queue-live: unmeasured (the script could not be fetched)'; exit 0; }
          node "$RUNNER_TEMP/queue-live.mjs"
```

  Then move the pins Step 1 found, and add one case to `queue-live.test.ts` that reads `ci.yml` as text and asserts that every job in that list carries the step first, under that exact `if`, and that no job outside the list carries it.
- [ ] **Step 6: Run** `queue-live`, `ci-pipeline`, `oss-metadata` and the suites Step 1 named. Expected: green.
- [ ] **Step 7: Commit.** `feat(ci): a superseded merge-queue group's jobs end when they start (wave 1d, D-9015)`

### Task 3: the growth check measures a queue entry against its own parent

**Files:**
- Modify: `server/test/growthCheck.ts`
- Modify: `server/test/growth-check.test.ts`
- Modify: `.github/workflows/ci.yml` (`QUEUE_BASE` on the server shards' test step)

**Interfaces:**
- Produces, from `server/test/growthCheck.ts`: `export function growthBase(env: Record<string, string | undefined>, git: (args: readonly string[]) => string): { base: string; from: 'queue-parent' | 'merge-base' }` — when `env.GITHUB_EVENT_NAME` is `merge_group` and `env.QUEUE_BASE` is 40 lower-case hex characters naming a commit that `git merge-base --is-ancestor <QUEUE_BASE> HEAD` accepts, the base is `QUEUE_BASE` and `from` is `queue-parent`; in every other case it is `git merge-base origin/main HEAD` and `from` is `merge-base`, exactly as today. A `git` call that throws inside the first arm falls to the second.
- Consumes: `github.event.merge_group.base_sha`, which the workflow already hands to the selector and to `reach.mjs` as the queue's base.

- [ ] **Step 1: Read how the armed rows find their base** in `growth-check.test.ts` (the `merge-base` read near the rows that call `armedGrowth` with `ROOT` and `process.env`) and every other reader of that base in the file (the waiver rows, the summary).
- [ ] **Step 2: Write the failing cases** in `growth-check.test.ts`, on a fixture repository with `origin/main` at commit M, a first stacked commit A that grows one listed file by 30 net code lines and a second, B, on top of A, that grows it by 30 more:
  - a pull request's environment at B measures against M: the base is M, `from` is `merge-base`, and the file is over the limit (the control: today's behaviour for a branch that holds both);
  - `GITHUB_EVENT_NAME=merge_group` with `QUEUE_BASE` = A at B: the base is A, `from` is `queue-parent`, the delta is 30 and nothing is over;
  - the same with a third commit C on B that grows the file by 41 alone and `QUEUE_BASE` = B: over, by 41;
  - `merge_group` with `QUEUE_BASE` unset, empty, 39 characters, upper-case, or a commit that is not an ancestor of HEAD: the base is M and `from` is `merge-base`.
- [ ] **Step 3: Run them.** Expected: red, `growthBase` is not exported.
- [ ] **Step 4: Write `growthBase`** and make every reader Step 1 found take its base from it (D-9016). One resolver, called once per run; no second `merge-base` read left beside it for the armed rows.
- [ ] **Step 5: Hand the base to the shards.** In `ci.yml`, the server shards' test step gains `QUEUE_BASE: ${{ github.event.merge_group.base_sha }}` in its `env`, as the agent leg's and the browser shards' reach steps already carry it. On any other event the expression is empty, which Step 2's last case covers.
- [ ] **Step 6: Run** `growth-check` armed (`GROWTH_CHECK=1`), `growth-caps`, and the suites that import `growthCheck.ts` (`git grep -l "growthCheck" server/test`). Expected: green.
- [ ] **Step 7: Commit.** `fix(ci): in a merge-queue group the growth check measures an entry against its parent (wave 1d, D-9016)`

### Task 4: the README, the mutation table and the gate

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** In the section that says what a merge-queue run is, add three sentences, one per decision, in the words of the Deviations below. Change nothing else there.
- [ ] **Step 2: The mutation table,** each row measured red and restored from a saved copy with its sha256 checked:

| id | Mutation | Predicted red |
|---|---|---|
| 1D-01 | `server-shard`'s `timeout-minutes` goes back to 30 | the deadline pin, if Task 1 moved one; otherwise record that no suite pins the value and add nothing |
| 1D-02 | the `queue group still live` step is removed from `server-shard` | `queue-live`'s workflow case |
| 1D-03 | `queueGroupFate` answers `superseded` for a `present` branch read with `onMain: 'no'` | `queue-live`'s table case and its `live` end-to-end case |
| 1D-04 | the script skips the compare read and treats every `absent` branch as `superseded` | `queue-live`'s `landed` end-to-end case |
| 1D-05 | the script exits 1 on `unmeasured` | `queue-live`'s `unmeasured` end-to-end case |
| 1D-06 | `growthBase` ignores `QUEUE_BASE` | `growth-check`'s `queue-parent` cases |
| 1D-07 | `growthBase` takes `QUEUE_BASE` without the ancestor check | `growth-check`'s not-an-ancestor case |

- [ ] **Step 3: The gate.** One file per process: `queue-live`, `growth-check` (armed), `growth-caps`, `oss-metadata`, `ci-pipeline`, every suite `git grep -l "ci.yml\|\.github/ci" server/test` names, `citations`, `anchors`, `docs-parity`, `topology-clean`, `typecheck-tests`, `deviation-refs` (after `git fetch origin main`), and `single-definition/` whole. `typecheck-tests` and `deviation-refs` have each failed for the test box's own reasons (memory, a 20-second case): re-run one alone, once with `ccrc test --local`, before calling it a break, and report both results.
- [ ] **Step 4: Commit, push once, wave-done.** `docs(ci): what a merge-queue run does about its deadline, a superseded group and stacked growth (wave 1d)`

## Deviations found

Numbers issued on 2026-11-24 (9011 to 9016); this plan defines the last three.

- **D-9014 (2026-11-25)** — `queue-shard-deadline`: the `server-shard` job's deadline is 45 minutes, not 30. A full merge-queue shard measured from 15m47 to 29m53 on 2026-11-24 by runner, and a green one was cancelled at 30m00 and its entry removed. The earlier comment's "packed to about four minutes" describes a fast pull request's shards only.
- **D-9015 (2026-11-25)** — `queue-group-liveness`: under `merge_group`, each long job first reads whether its group still stands: the queue branch is present (`live`), or absent with the group's commit on `main` (`landed`), or absent with the commit off `main` (`superseded`). Only `superseded` ends the job, with exit 1 on a run nothing reads any more; an unmeasured read lets the job run. It adds no permission and cancels nothing: a job already running when its group is superseded runs to its end, which is the residual.
- **D-9016 (2026-11-25)** — `growth-queue-parent`: under `merge_group` the growth check measures HEAD against the group's parent commit (`merge_group.base_sha`, when it is an ancestor of HEAD), not against the merge base with `origin/main`. A pull request's own run is unchanged, and the limit per pull request is unchanged: what goes is the sum over a stack, which no ruling asked for and which removed green entries.

**As built.** The wave merged on 2026-11-25 as #3365 (merge commit `ba0b0f40`) after two review rounds, and D-9014 to D-9016 are implemented. The slow shard's time in this plan read 29m24 until 2026-11-25; the measured figure is 29m53 (run 45421481370, the fifth server shard), which the workflow comment and the README have carried since the fix round, and this plan says it since. The coordinator issued two more numbers, 9069 and 9070, on 2026-11-25 for the departures the worker reported by slug (`docs/superpowers/programs/landing-order/wave1d-*.md`). Both were read by a review run and accepted.

- **D-9069 (2026-11-25)** — `queue-live-leg-gate`: in the six jobs that carry a leg switch (`test`, `pwa-shard`, `pwa-static`, `build-pwa`, `browser-pwa`, `node-floor`) the liveness step's condition also requires the leg to run. This plan gave one condition, the `merge_group` event. With it the step would have run in a docs-only group's node floor, whose every other step skips, against the pipeline pins that every step of those jobs skips when the leg skips. Under `merge_group` the leg runs except in that node floor, so a live group is unchanged. The other five jobs carry the plan's condition.
- **D-9070 (2026-11-25)** — `queue-live-notice-line`: on a superseded group the script prints a second line, a `::notice::` annotation that shows in the run's summary, where this plan said one line. Both lines are built from fixed words; neither carries a token, a ref or a value read from the environment.

Also as built, without a number: two guards the first review asked for, the exact compare request (mutation row 1D-08) and the base resolution moved into the helper module as `armedBase` (row 1D-09). Seven minor points of the second review stay open and are planned as wave 1f (`docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`).
