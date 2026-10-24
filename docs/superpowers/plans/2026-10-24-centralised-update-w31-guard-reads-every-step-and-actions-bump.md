# Centralised update management, wave 31: the release guard reads every step, and the workflow actions move to their current majors: Implementation Plan

Run 897. Two parts, both CI-only. Part A closes review 886's seven findings on wave 26 (landed as #1211). Part B adopts Dependabot's actions bump (#364), which wave 26's ruling 8 held until after that landing. Base: `main` at `bee31076a` (wave 26 is in it at `a7a747b4e`). Every `path:line` below is read at that base and is for reading only. No numeric citation goes into an added code or test line (`citations.test.ts`).

The review's report (`review-886-baf09f32.md`, sent with mail 8813) was gone when this wave started: the reviewing workspace had been reclaimed with its clips directory. This plan works from the brief's F1 to F7 and the review-done mail's own summary of them (D-6736).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. The dispatched worker runs it under the `ccrc-worker` skill.

**Goal:** the release guard (`server/test/workflowJobs.ts`) refuses any step it cannot read, in every job, rather than reading only a job's top-level `steps`; D-6728's job-level arm has a planted row per shape; four texts that claimed more than wave 26 measured say only what holds; and the four workflows run `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7` and `actions/download-artifact@v8`, with every pin that names a major moved deliberately and every wave-26 claim about where the checkout keeps its credential re-read against the new majors.

**Spec:** the brief (mail 8903), review 886's findings as the brief states them, and wave 26's plan as landed, `docs/superpowers/plans/2026-10-23-centralised-update-w26-release-build-holds-no-write-credential.md` (its rulings, D-6647 to D-6666 and D-6726 to D-6731).

## Part A: review 886's findings

| Finding | What the brief rules | Where |
|---|---|---|
| F1 | The guard reads only a job's top-level `steps`, while GitHub's schema admits nested step groups. In every job, refuse a step item that carries none of `run`/`uses`, or that carries `parallel`, `background`, `wait`, `wait-all` or `cancel`. Refuse rather than recurse: no release job needs a group. A planted row per shape, red by its own message. | `workflowJobs.ts` `boundaryFindings`; W26-G4 |
| F2 | D-6728's job-level arm gets a planted row per shape (null, list, plain scalar, expression; and a job-level `with:`), and G-ap's row text and As built say only what is measured. | W26-G4; wave 26's plan |
| F3 | `release-artifact.sh`'s verify header says the write side decodes nothing; say the only decoder on the write side is the download action's extractor, confined by D-6726. | `deploy/release-artifact.sh` header |
| F4 | D-6648's headline and the plan's Goal say what holds after D-6726 and ruling 2. | wave 26's plan |
| F5 | `release-main.yml`'s comment and step name above the decision check say what the check holds: a step output lost fails; a value dropped at the job boundary skips. | `release-main.yml`; W26-Y6 and its neighbours in `build-release.test.ts` |
| F6 | The plan's Task 4 W25-Y3 line names `@v7` for the download. | wave 26's plan |
| F7 | W26-P1's publish case either scans the helpers `publish` calls, or its comment stops saying "reaches". Chosen: scan them. | `release-main.test.ts` |

### Task 1: the guard reads every step (F1, F2)

**Files:** `server/test/workflowJobs.ts`, `server/test/release-job-boundary.test.ts`.

- [ ] In every job, each item of `steps:` must be a mapping that carries `run:` or `uses:`, and none of the step-group keys `parallel`, `background`, `wait`, `wait-all`, `cancel`. A breach is one finding per step, naming the job, the step's number and the shape: not a mapping; neither `run:` nor `uses:`; the group key it carries. A job whose `steps:` is present and not a list is a finding too (D-6737).
- [ ] Planted W26-G4 rows, one per shape, each red by its own message: a `parallel:` group in the publish job holding a run the allowance does not name; a `parallel:` group in the build job holding a checkout that keeps its credential; `background:`, `wait:`, `wait-all:` and `cancel:` each on a step; a step with only a `name:`; a step that is a plain scalar; a `steps:` that is not a list.
- [ ] F2: planted W26-G4 rows for the job-level arm: `env:` present and null, `env:` as a list, `env:` as a plain scalar, and a called-workflow job's `with:` as a whole-value expression (the `env:` expression row exists).
- [ ] Commit; then measure each mutant (table below) on a scratch copy, and write the counts in a later commit.

### Task 2: the texts say what holds (F3 to F7)

**Files:** `deploy/release-artifact.sh` (header only), `.github/workflows/release-main.yml` (the decision check's comment, name and line), `server/test/build-release.test.ts` (the rows that quote the decision check), `server/test/release-main.test.ts` (W26-P1), wave 26's plan (D-6648's headline, the Goal, D-6658's quoted line, the Architecture row, W26-Y6's quoted step, Task 4's W25-Y3 line, G-ap's row and As built's last bullet).

- [ ] F3: the header says verify never opens the tarball; the only decoder on the write side is the download action's extractor of the hand-over, whose major confines every entry under `--in` (D-6726), and verify reads the tarball as opaque bytes. The whole-file no-decoder pin (W26-A6) reads comments too, so the header names no decoder by its command name.
- [ ] F4: D-6648's headline says nothing in the publish job decompresses or parses the tarball, and the download action's extractor is the one decoder of the hand-over there (D-6726). The Goal says a decision lost before compare's step output fails the build job, and one dropped at the job boundary skips the publish job (ruling 2).
- [ ] F5: the step is named `Fail when the release decision did not reach compare's step output` and its line says the same; the comment says what it holds and what it does not (a value dropped at the job boundary skips the publish job, an availability effect a hostile build already has; D-6658 as narrowed). Every pin of the name and the line moves with it (D-6738).
- [ ] F6: Task 4's W25-Y3 line names `actions/download-artifact@v7`, as landed.
- [ ] F7: W26-P1's two cases scan the arm's body and the body of every function of `release-main.sh` it calls, transitively, the `trap` handler included; the comment says so.
- [ ] Commit; measure the mutants.

## Part B: the actions bump (#364)

### Task 3: the new majors, read and pinned

**Files:** `.github/workflows/ci.yml`, `release-main.yml`, `release.yml`, `release-stable.yml` (the bump, then comments only), `server/test/build-release.test.ts`, `server/test/ci-pipeline.test.ts`, `server/test/workflowJobs.ts` and `release-job-boundary.test.ts` (D-6726's floor text), wave 26's plan (claims the new majors change).

- [ ] Take #364's workflow edits onto this branch as a commit of its own (`checkout` 4 to 7, `setup-node` 4 to 7, `upload-artifact` 4 to 7, `download-artifact` 4 and 7 to 8). Never merge or push to its branch.
- [ ] Read each new major's release notes and source at the pinned tag, cited (findings in As built).
- [ ] Move the seven pins the bump reds to the new majors: `build-release.test.ts`'s W25-Y3, both W26-Y8 rows, the release-stable gate row and `release.yml`'s attest row; `ci-pipeline.test.ts`'s browser-leg and storybook-a11y rows. Keep D-6726's floor (download at `@v7` or later) and the publish jobs' exact action sets. Each pin's comment says a version pin is a deliberate edit, so a future bump reds it again.
- [ ] Amend every comment or plan claim the new majors falsify.
- [ ] Commit; measure the mutants.

What the new majors change for this repository, read from each action's source at the tag its floating major names on 2026-10-24 (cited in As built):

| Action | Major (tag, commit) | What changes here |
|---|---|---|
| `actions/checkout` | v7 (`v7.0.1`, `3d3c42e5aac5`) | Since v6 a persisted credential is a separate git config file under `$RUNNER_TEMP`, which `.git/config` includes by `includeIf "gitdir:…"`; the token is no longer in `.git/config`. With `persist-credentials: false` the token is still written for the checkout's own fetch and removed in the step's `finally`, so nothing is left after the step. With the default, a later `git push` from the workspace authenticates through the include, and the post step removes it at the job's end. v7 also refuses fork-PR checkouts under `pull_request_target`/`workflow_run`, which no workflow here uses. |
| `actions/setup-node` | v7 (`v7.1.0`, `949feb2413d6`) | An explicit `cache: npm` with `cache-dependency-path` restores exactly as at v4. The automatic cache (v5, narrowed in v6) reads only the root `package.json`'s package-manager fields, and this repository has no root `package.json`. `node-version-file: server/package.json` reads `engines.node`, as before: the file has no `volta` or `devEngines`. |
| `actions/upload-artifact` | v7 (`v7.0.2`, `cf430e030ddb`) | Every input this repository passes keeps its meaning; the new `archive` input defaults to `true`, so the hand-over is still one zip. |
| `actions/download-artifact` | v8 (`v8.0.2`, `9000827ccba6`) | Same extractor as v7 (unzip-stream 0.3.4, the same per-segment sanitiser), so every zip entry is still confined under `path`. A digest mismatch now fails the step by default. New: a blob whose content type is not a zip is written raw, as ONE file named by its basename, directly into `path`. Either way the files land in `release-in`, where verify's exact file set refuses anything but the two expected files. The new inputs (`digest-mismatch`, `skip-decompress`) are outside the guard's exact `with:` set, so a write job cannot pass them. |

### Task 4: the gate and the PR

- [ ] The brief's gates, from `server/`, one at a time, foreground.
- [ ] The mutation table's counts, the deviations and As built.
- [ ] One PR from this workspace's branch; its body names review 886 and #364. Push once; wave-done in the same turn.

## Global Constraints

- Public repository: no host, path, lane, account or session name in code, comments, commits, rows or the PR body.
- Trigger no workflow and touch no release. GitHub Actions semantics are read from GitHub's docs or the actions' source, cited.
- Fixture HOMEs only. Run each suite alone, from `server/`, in the foreground: `timeout -s INT 560 ./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`.
- Mutation rule: each mutant on a scratch copy, in a subshell, `n=$(ps -L -u "$(id -u)" --no-headers | wc -l); ulimit -u $((n + 1500)); timeout -k 10 600 ./node_modules/.bin/vitest run ...`, the file restored and checked with `cmp`. Sequential.
- The release fixtures copy `deploy/`: `release-artifact.sh` changes the build fingerprint, so the landing merge releases.
- Pins that stay as they are: `release-main.yml`, comments included, never says `npm ci`, `npm run`, `build-release.sh` or `gh release`; `release-artifact.sh` names no decoder, comments included (W26-A6).

## Mutation table

Each mutation applied alone to a scratch copy, its file run once, restored byte-identical. "Expected" is a prediction; the measurement, with its commit, replaces it.

| File run | Mutation | Expected red rows |
|---|---|---|
| `release-job-boundary.test.ts` | S1: the step-group key check deleted | the four group-key rows and both `parallel:` rows |
| `release-job-boundary.test.ts` | S2: the no-`run`/no-`uses` check deleted | the name-only row (the scalar row stays red on S3) |
| `release-job-boundary.test.ts` | S3: the not-a-mapping step check deleted | the scalar-step row |
| `release-job-boundary.test.ts` | S4: the not-a-list `steps:` check deleted | the not-a-list row |
| `release-job-boundary.test.ts` | S5: the job-level non-mapping check skips null | the job-level null-`env:` row |
| `release-job-boundary.test.ts` | S6: the job-level non-mapping check reads `env` only | the job-level `with:` row |
| `release-main.test.ts` | P1: `release-main.sh`'s `cleanup` gains `npm --version >/dev/null` | W26-P1 publish case |
| `release-main.test.ts` | P2: `derive_tags` gains `tar --version >/dev/null` | W26-P1 receive case |
| `build-release.test.ts` | Y1: the decision check's step name reverted | W26-Y6 |
| `build-release.test.ts` | V1 to V4: each publish job's download back to `@v7`, its checkout back to `@v4`; the build job's upload and setup-node back to `@v4` | W26-Y8, W25-Y3 |
| `ci-pipeline.test.ts` | V5, V6: the browser leg's and storybook-a11y's checkout back to `@v4` | the browser-leg and storybook-a11y rows |

## Deviations found

D-6736 to D-6743 are issued to this wave, spent in order on real departures; each unspent one has its own `unused` entry.

- **D-6736** — Review 886's report was not readable when this wave started: the reviewing workspace had been reclaimed, and its clips directory with it. This wave works from the brief's F1 to F7, which carry each finding's fix direction, and from the review-done mail's own summary (mail 8813).
- **D-6737** — F1's refusal also covers a `steps:` that is present and not a list, and a step item that is not a mapping. The brief names a step item without `run`/`uses` and the five group keys.
  - Why: `readJob` folds a `steps:` that is not a list to no steps, and `readStep` folds a non-mapping item to an empty step, so both read as a job with nothing in it. The review said a non-mapping `steps:` fails GitHub's own parse, so this costs nothing on a valid file and closes the fold the guard itself makes.
- **D-6738** — F5 renames the decision check's step and also rewrites its one line, not only the comment and the name the brief names: the line said "did not reach the job output" too, and it is what the run log shows.

## As built (run 897)

To be written at the end of Task 4.
