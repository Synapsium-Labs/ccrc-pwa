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
| `actions/checkout` | v7 (`v7.0.1`, `3d3c42e5aac5`) | Since v6 a persisted credential is a separate git config file under `$RUNNER_TEMP`, which `.git/config` includes by `includeIf "gitdir:…"`; the token is no longer in `.git/config`. With `persist-credentials: false` the token is still written for the checkout's own fetch and removed in the step's `finally`, so nothing is left after the step unless that removal fails, which the action reports only as a warning, as at v4 (where the token sat in `.git/config` itself). With the default, a later `git push` from the workspace authenticates through the include, and the post step removes it at the job's end. v7 also refuses fork-PR checkouts under `pull_request_target`/`workflow_run`, which no workflow here uses. |
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

Each mutation was applied alone to the committed file. Its test file was run once in a subshell, under the process cap and `timeout -k 10 600`. The file was then restored and checked byte-identical with `cmp`. Runs were sequential. Every new or changed row is red under at least one mutant.

| File run | Mutation | Measured red rows |
|---|---|---|
| `release-job-boundary.test.ts` | S1: the step-group key check guarded by `false &&` | measured at `cf403776f`: both `parallel:` rows (publish and build) and the `background:`, `wait:`, `wait-all:` and `cancel:` rows (6 of 119), exit 1 |
| `release-job-boundary.test.ts` | S2: the neither-`run:`-nor-`uses:` check guarded by `false &&` | measured at `cf403776f`: the name-only step row (1 of 119), exit 1 |
| `release-job-boundary.test.ts` | S3: the not-a-mapping step check guarded by `false &&` | measured at `cf403776f`: the plain-scalar step row (1 of 119), exit 1 |
| `release-job-boundary.test.ts` | S4: the not-a-list `steps:` check guarded by `false &&` | measured at `cf403776f`: the row where the publish job's `steps:` is a scalar (1 of 119), exit 1 |
| `release-job-boundary.test.ts` | S5: the job-level non-mapping check skips a null value (review 886's F2 mutant) | measured at `cf403776f`: the build job's null `env:` row (1 of 119), exit 1. At wave 26's tip the same mutant survived (106 of 106 green) |
| `release-job-boundary.test.ts` | S6: the job-level non-mapping check reads `env` only | measured at `cf403776f`: the row where a called-workflow job's `with:` is an expression (1 of 119), exit 1 |
| `release-job-boundary.test.ts` | S7: the job-level non-mapping check guarded by `false &&` | measured at `cf403776f`: the build job's `env:` rows (wave 26's expression row, and the null, list and scalar rows) and the called-workflow `with:` row (5 of 119), exit 1 |
| `release-job-boundary.test.ts` | S8: the job-level check skips a list | measured at `cf403776f`: the build job's list `env:` row (1 of 119), exit 1 |
| `release-job-boundary.test.ts` | S9: the job-level check skips a string | measured at `cf403776f`: the build job's scalar `env:` row, wave 26's `env:` expression row and the called-workflow `with:` row (3 of 119), exit 1 |
| `release-main.test.ts` | P1: `npm --version >/dev/null` added as the first line of `cleanup()`, which runs only through `trap cleanup EXIT` | measured at `bb5025b5e`: W26-P1, the publish case (1 of 114), exit 1 |
| `release-main.test.ts` | P2: `tar --version >/dev/null` added inside `derive_tags()` | measured at `bb5025b5e`: W26-P1, the receive case (1 of 114), exit 1 |
| `build-release.test.ts` | Y1: the decision check's `name:` set back to the old one | measured at `ece9015c8`, once the bump's pins were green: W26-Y6 and W25-Y3's order (2 of 66), exit 1 |
| `build-release.test.ts` | Y2: the decision check's line set back to the old one | measured at `bb5025b5e`: W26-Y6 turned red; five rows were red already, the bump rows not yet pinned to the new majors (6 of 66), exit 1 |
| `build-release.test.ts` | V1: release-main's publish download set back to `@v7` | measured at `ece9015c8`: W25-Y3, and W26-Y8 for release-main.yml (2 of 66), exit 1 |
| `build-release.test.ts` | V2: release.yml's publish checkout set back to `@v4` | measured at `ece9015c8`: W26-Y8 for release.yml (1 of 66), exit 1 |
| `build-release.test.ts` | V3: release-main's build upload set back to `@v4` | measured at `ece9015c8`: W25-Y3 (1 of 66), exit 1 |
| `build-release.test.ts` | V4: release-main's build setup-node set back to `@v4` | measured at `ece9015c8`: W25-Y3 (1 of 66), exit 1 |
| `ci-pipeline.test.ts` | V5: the browser leg's checkout set back to `@v4` | measured at `ece9015c8`: the browser-leg row (1 of 54), exit 1 |
| `ci-pipeline.test.ts` | V6: storybook-a11y's checkout set back to `@v4` | measured at `ece9015c8`: the storybook-a11y row (1 of 54), exit 1 |
| `build-release.test.ts` | V7: release-stable's gate checkout set back to `@v4` | measured at `ece9015c8`: the gate row (1 of 66), exit 1 |
| `build-release.test.ts` | V8: release.yml's build upload set back to `@v4` | measured at `ece9015c8`: release.yml's attest-and-publish row (1 of 66), exit 1 |
| `ci-pipeline.test.ts` | M1: map-build's collection set back to the loop that reads only per-artifact directories | measured at `1e03038b6`: the single-artifact row and the exact-count row (2 of 62), exit 1; re-measured at `1cecb6768` after the final round removed a dead branch from that step: the same two rows (2 of 62), exit 1 |
| `ci-pipeline.test.ts` | M2: times-build set back to the `times/*/times.json` glob alone | measured at `1e03038b6`: the text pin, the single-artifact row and the no-file row (3 of 62), exit 1 |
| `ci-pipeline.test.ts` | M3: map-build's single-layout fallback made unconditional | measured at `1e03038b6`: the no-double-count row (1 of 62), exit 1 |

## Deviations found

D-6736 to D-6743 are issued to this wave, spent in order on real departures; each unspent one has its own `unused` entry.

- **D-6736** — Review 886's report was not readable when this wave started: the reviewing workspace had been reclaimed, and its clips directory with it. This wave works from the brief's F1 to F7, which carry each finding's fix direction, and from the review-done mail's own summary (mail 8813).
- **D-6737** — F1's refusal also covers a `steps:` that is present and not a list, and a step item that is not a mapping. The brief names a step item without `run`/`uses` and the five group keys.
  - Why: `readJob` folds a `steps:` that is not a list to no steps, and `readStep` folds a non-mapping item to an empty step, so both read as a job with nothing in it. The review said a non-mapping `steps:` fails GitHub's own parse, so this costs nothing on a valid file and closes the fold the guard itself makes.
- **D-6738** — F5 renames the decision check's step and also rewrites its one line, not only the comment and the name the brief names: the line said "did not reach the job output" too, and it is what the run log shows.
- **D-6739** — Every pin that names an action's major moves with the bump, and says beside it that a version pin is a deliberate edit, so a future bump reds it again. The publish jobs' exact action sets stay as they are, and D-6726's floor stays at `@v7`. Only the majors named in the pins change, to checkout `@v7`, setup-node `@v7`, upload-artifact `@v7` and download-artifact `@v8`.
  - Why: the brief asks for this. The departure is that the floor's comment and wave 26's D-6726 now cite v8 too. v8 bundles the same extractor, and this wave measured it (As built). It adds a raw write of one non-zip file, and it fails a digest mismatch by default.
- **D-6740** — Since download-artifact v5, a `pattern:` download that matches exactly ONE artifact is extracted straight into `path`, with no `<artifact-name>/` directory: `artifacts.length === 1` picks `resolvedPath` (`src/download-artifact.ts` at `v8.0.2`). At `@v4` every pattern match got its own directory. `ci.yml`'s `map-build` (`pattern: records-*`, then a loop over `records/records-*/records.json`) and `times-build` (`pattern: times-*`, then `times/*/times.json`) read only the per-artifact layout. So a run with a single trace shard would fail `map-build` with "0 of 1 trace shards left records", and a single timing shard would hand `shards.mjs` an unmatched glob. Both steps now accept either layout, and `ci-pipeline.test.ts` holds that.
  - Why here: the brief asks this wave to read what each new major changes for this repository. These two `run:` steps are what changes, and #364 cannot land without them. The brief named only pin edits for `ci.yml`, so this is a departure.
- **D-6741** — README.md's release paragraph is edited inside one parenthesis, outside this wave's claims. It named `actions/download-artifact@v7` and said the download action unzips the hand-over. Both publish jobs now run `@v8`, which extracts the hand-over with the same confinement and writes a non-zip hand-over as one file in that directory (As built). It now names `@v8` and both forms, and keeps `verify` refusing any extra entry and every word outside the parenthesis. The guard's floor (`@v7` or later) is unchanged.
  - Consent: README is under run 774's live claim 2372, re-measured live just before the edit. The edit was made under that run coordinator's scoped physical-coexistence consent 8922, which answered request 8920, made through this programme's coordinator (asked in 8919, forwarded whole in 8924). The grant covers this branch only and that parenthesis only. It certifies no security claim: the accuracy is this wave's, measured in As built.
- **D-6742** — `unused` (run 897): issued to this wave; no departure took it.
- **D-6743** — `unused` (run 897): issued to this wave; no departure took it.

## As built (run 897)

- **Claims and consents.** One claim covered the wave's files: 2373, extended with 2374 (`oss-metadata.test.ts`) and 2375 (`.github/dependabot.yml`) when the final review sent comment fixes there. README.md is under run 774's live claim 2372. Its one stale parenthesis was edited under consent 8922 (request 8920; D-6741), after the claim was re-measured live.
- **The bump.** #364's workflow edits (`ebf19f3e7`) were taken onto this branch as `015a2c920`, a commit of their own. Only version strings changed (50 lines in four files). Dependabot's branch was never merged or pushed to. When this PR lands, #364 has nothing left to change, and closing it is left to Dependabot.
- **What each new major changes, read from its source.** Each action was read at the tag its floating major named on 2026-10-24, from a read-only clone:
  - `actions/checkout@v7`: `v7.0.1`, `3d3c42e5aac5`.
  - `actions/setup-node@v7`: `v7.1.0`, `949feb2413d6`.
  - `actions/upload-artifact@v7`: `v7.0.2`, `cf430e030ddb`.
  - `actions/download-artifact@v8`: `v8.0.2`, `9000827ccba6`.

  Citations are by file at those commits. checkout: `src/git-auth-helper.ts` (the credentials file, `includeIf`, removal), `src/git-source-provider.ts` (`configureAuth` before the fetch, removal in `finally`, cleanup in the post step). setup-node: `src/main.ts` (an explicit `cache:` restores as at v4) and `src/util.ts` (the `node-version-file` fields). upload-artifact: `src/` (the `archive` input, default `true`). download-artifact: `src/download-artifact.ts` (one match lands at `resolvedPath`; the digest check) and `dist/index.js` (zip or raw, the sanitiser). The step-group schema is at `workflow-parser/src/workflow-v1.0.json` in `actions/languageservices` at `4043eda158e1`. GitHub's syntax reference, `workflow-syntax.md` in `github/docs` at `02c25d16369f` (`steps[*].background`, `.wait`, `.wait-all`, `.cancel`, `.parallel`), says the same. The Task 3 table states what each major changes. In short:
  - Since checkout v6 a persisted token lives in `$RUNNER_TEMP/git-credentials-<uuid>.config`, which `.git/config` includes. So wave 26's measured sentence, "the job's write token sits in `.git/config`", is true of checkout@v4 at that base and is amended in place there.
  - `persist-credentials: false` still writes the token for the checkout's own fetch and removes it in the step's `finally`. A failed removal is only a warning, as at v4.
  - The publish job's `git push` of the tag authenticates through the include, and the post step removes the token at the job's end.
- **The hand-over at download-artifact v8, measured.** Method: the action's own `dist/index.js` at `v8.0.2` (sha256 `7834b909df0fd656…`), with only its entry call removed and its bundled module loader exported, so that its bundled extractor (module 5700, unzip-stream 0.3.4) could be run on a zip in a scratch directory under node 24. The zip held the two expected files plus `x/../../../escaped-a.txt`, `../../escaped-b.txt`, `..\..\escaped-c.txt`, `/abs-escaped-d.txt` and `y/..../escaped-e.txt`.
  - Every one of the seven entries landed under `release-in`.
  - `release-artifact.sh verify` refused the listing (exit 1) and wrote nothing to its out directory.
  - The raw path, for a blob whose type is not a zip, writes ONE file named by the basename of the blob's download filename. This was read from the source, not run. That file lands in the same directory, where verify's exact file set refuses it.
  - v8 fails a digest mismatch by default. That digest is the one the upload recorded, which the build job controls, so it proves the transfer and not the build.
  - D-6726's floor, `@v7` or later, holds at v8.
- **The security lens on Part B's credential reading** (an Opus reviewer, the brief's ask) found no Critical and no Important finding. It answered six questions:
  - In the build jobs, the checkout leaves no credential behind on the normal path. On a failed removal it leaves no more than at v4.
  - Nothing the build job controls reaches the publish job's credentials file or its include.
  - The comments say what holds; three overclaims were fixed in the final round.
  - checkout v7's fork-PR refusal touches no workflow here.
  - No setup-node cache reaches a write job. There is no root `package.json`, so no automatic cache.
  - v8's digest check changes no guarantee.
- **D-6740, found in the reading:** a `pattern:` download with one match has no directory since v5, and `map-build` and `times-build` read only the directory layout. Both now read either layout. `ci-pipeline.test.ts` runs each step's own script from `ci.yml` in bash against both layouts.
- **Review 886's findings:**
  - F1 and F2: Task 1 (`cf403776f`).
  - F3 to F7, and F2's text: Task 2 (`bb5025b5e`).
  - The final review's comment fixes: `1cecb6768`.

  The review's report itself was gone (D-6736). The brief's fix directions were the requirement.
- **Reviews.** Each task had a task review on Opus, and Task 3 also had the security lens. The whole branch had a final review on Opus. Its findings went to one fix commit and one scoped re-review. Minors that were left, with their reasons:
  - Outside write jobs the step-key check is a deny-list of the five group keys, not an allowlist. A future nesting key beside `run:`/`uses:` in a build job would pass, but a write job's step keys are an allowlist already.
  - W26-P1's lexer does not follow a quoted `trap`, `eval` or `bash -c` string, and an unmatched apostrophe hides later calls. None occurs in the bodies today, and the comment now says what it follows.
  - `release-main.sh`'s top-level lines are outside the closure.
  - The `ci-pipeline` harness runs with `-eo pipefail`, not the runner's `bash -e`. This predates the wave.
  - The download floor admits any later major unread. This is inherited from D-6726 and was not touched.
- **Not edited, and stale only as history.** The wave-25 plan's two sentences on the checkout token in `.git/config`, and the two design specs that name `checkout@v4` (`2026-09-18-release-rollout-design.md`, `2026-09-20-centralised-update-management-design.md`). They are outside this wave's claims and brief. Each was true when written.
- **Not run before merge.** No workflow ran. After landing, the coordinator measures the first release run against D-6659 again, since the actions changed.
