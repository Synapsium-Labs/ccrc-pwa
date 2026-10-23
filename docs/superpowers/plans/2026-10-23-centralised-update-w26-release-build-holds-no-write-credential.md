# Centralised update management, wave 26: the release build holds no write credential: Implementation Plan

On 2026-10-22 the operator answered "Sure" in chat to ledger row 26: the release build runs in a job that holds no write token, and a second job, holding the tag, release and attestation permissions, takes the built tarball, checks it, attests it and publishes it, so no step that runs the install (or any other step that executes code from the dependency tree or the repo's build scripts) can reach a write credential. The coordinator cut wave 26 as run 858 and issued a block of twenty deviation numbers starting at D-6647. Every citation below is `path:line` at the pinned base `a802c7669` (main after wave 25, PR #1149), read with `git show a802c7669:<path>`. The worker re-reads each one in the landed text before editing it.

**What was measured.**
- `release-main.yml` is one job, `release` (`.github/workflows/release-main.yml:61-143`), holding `contents: write`, `id-token: write` and `attestations: write` (`:75-78`) for every step. Its checkout (`:80-86`) does not set `persist-credentials`, so the job's write token sits in `.git/config` as an `http.extraheader` from the first step to the post step.
- The prepare step (`:105-106`, `deploy/release-main.sh` `prepare`, `:213-272`) runs `deploy/build-release.sh`, which runs the install and the build in four packages (`deploy/build-release.sh:97-100`), lifecycle scripts included. That code can read the persisted write credential, and, because the job holds `id-token: write`, it can request an OIDC token for `release-main.yml@refs/heads/main`, one of the two identities every box's verifier accepts (`deploy/verify-provenance.mjs:102-107`). So a hostile dependency can today sign any bytes as a release, push any tag or branch the token reaches, and edit or delete releases.
- Wave 25 kept `GH_TOKEN` to the compare and publish steps' env (`release-main.yml:117-121`, `:139-143`; D-6401, D-6405 in the wave-25 plan). Step env is not a boundary: the persisted credential, the OIDC request variables and `$GITHUB_ENV`/`$GITHUB_PATH` all cross steps. GitHub enforces `GITHUB_TOKEN` permissions per JOB, and each job of a GitHub-hosted run gets a fresh machine.
- `release.yml` has the same shape: one job (`.github/workflows/release.yml:20-103`) holding the same three permissions (`:31-34`), its checkout persisting the credential (`:36-41`), the build (`:58-59`) and the attest (`:63-66`) in one job, and the OIDC identity `release.yml@refs/tags/<tag>`.
- `release-stable.yml` already has the target shape. Its `gate` job (`.github/workflows/release-stable.yml:34-69`) and its `full` job (`:77-85`, `uses: ./.github/workflows/ci.yml`, which runs the install) hold `contents: read` and `actions: read` only; its one write job, `promote` (`:87-111`, `contents: write` alone), runs `bash deploy/release-stable.sh`, which installs and builds nothing (`server/test/build-release.test.ts:863-872` pins that).
- The base's own release run took about 72 s: checkout 12 s, prepare 49 s, compare under 1 s, attest 1 s, publish 5 s.

**What already holds.**
- Nothing reaches origin before publish's push (`release-main.sh:478-485`), and each state names the HEAD it was measured for (`:270`, `:374-375`, `:442-443`). A failed job anywhere before that push leaves origin as it was, and a re-run derives the same number (`derive_tags`, `:112-121`).
- The compare step is a pure function of the candidate, the base release and git history, and its verdict is one output, `release=<true|false>` (`set_output`, `:98-102`).
- The attest action works by file digest, and the subject name is the file's basename (`subject-path: release-out/ccrc-*.tar.gz`, `release-main.yml:133-134`). So it can run in any job that holds the verified file. The certificate's identity is the workflow file and ref, not the job, so a second job in the same file keeps it.
- `release-notes.mjs` imports only node built-ins (`server/test/release-notes.test.ts:276`).
- `ci.yml` already drops the checkout credential in a job that runs third-party code (`.github/workflows/ci.yml:555-557`, pinned at `server/test/ci-pipeline.test.ts:181-182`), and already hands files between jobs with `actions/upload-artifact@v4` and `actions/download-artifact@v4` (`ci.yml:252`, `:1026`).
- `.github/ci/select-tests.mjs:168` sends any change under `.github/` to the full suite, so this wave's PR runs every server test.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this plan's path, the task range, the claim groups, the consents and the deviation block.

**Goal:** in `release-main.yml` and `release.yml`, every step that runs the install, the build or anything else that executes dependency or build-script code runs in a `build` job whose token can only read, whose checkout keeps no credential and which cannot mint an OIDC token. The tag push, the attestation and the release are made by a `publish` job that installs nothing, runs no build script, re-derives the tag itself, never decompresses or parses the build's tarball, and refuses any artifact that does not match what the build job recorded. A merge whose build is unchanged never starts the `publish` job, so no write token is minted for it; a release decision that is lost on its way to the `publish` job fails the run instead of skipping it. Wave 25's release decision, local-tag and skip semantics are unchanged. A guard test fails if any job that installs or builds holds a write permission, a persisted credential or the OIDC permission, or if a job that holds one runs anything outside its allowlist.

**Spec:** the operator's answer above and ledger row 26; `docs/superpowers/specs/2026-09-18-release-rollout-design.md` (§3 and decision 6) and `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (§4), the first amended by a delta note in this wave. The wave-25 plan's D-6405 names this exact follow-up.

**Architecture:** two jobs per release workflow, in the same file, so the signing identity is unchanged (D-6647).

`release-main.yml`:

| Job | Step | Why it is in this job |
|---|---|---|
| `build` (`contents: read`; 30 min) | `actions/checkout@v4`, `fetch-depth: 0`, `persist-credentials: false` | the derivation and the base need tags and history; nothing in this job pushes |
| `build` | `actions/setup-node@v4` with the npm cache keyed on the four lockfiles | the build needs node; the cache is restored only into read jobs (D-6652) |
| `build` | "Derive the next tag and build the candidate", `release-main.sh prepare` (unchanged) | it runs the install and the build |
| `build` | "Compare the build with the newest release it contains", `release-main.sh compare`, `GH_TOKEN` = this job's READ token (unchanged step text) | it needs the base release (a read) and it extracts bytes the install produced, so it stays beside them and away from the write token (D-6648) |
| `build` | "Fail when the release decision did not reach the job output", `if: steps.compare.outputs.release != 'true' && steps.compare.outputs.release != 'false'`, prints one line and exits 1 | a decision that is lost on its way to the job output fails the run rather than skipping the publish job silently (D-6658) |
| `build` | "Record the release files' digest", `id: record`, `release-artifact.sh record`, `if:` the compare output | it fails early on a misnamed tarball, a `SHA256SUMS` that is not its one line, or a `build.json` that names another tag or commit, and gives the publish job the digest to check (D-6650) |
| `build` | `actions/upload-artifact@v4`, `if:` the compare output: artifact `release-<tag>`, exactly the tarball and `SHA256SUMS` | the hand-over (D-6657) |
| `publish` (`needs: build`, `if: needs.build.outputs.release == 'true'`; `contents: write`, `id-token: write`, `attestations: write`; 10 min) | `actions/checkout@v4`, `fetch-depth: 0`, credential persisted, no other `with:` key | its own copy of HEAD's scripts; `git push` of the tag uses the persisted credential, as today |
| `publish` | `actions/download-artifact@v4` into `$RUNNER_TEMP/release-in`, outside the checkout | the hand-over |
| `publish` | "Check the build's artifact and tag it for this commit", `release-main.sh receive` (new arm) | the tag is re-derived here and must equal the build's; the artifact must be exactly the two regular files, hash to the recorded digest, and carry exactly that one `SHA256SUMS` line. Nothing in this job decompresses or parses the tarball (D-6648, D-6649, D-6656) |
| `publish` | `actions/attest-build-provenance@v4`, no `if:` (the job's `if:` carries the decision) | the signing identity; only a verified file is in `release-out/` |
| `publish` | "Push the tag and publish the prerelease", `release-main.sh publish` (unchanged arm) | the write |

`release.yml` gets the same split (D-6653): `build` runs checkout (`persist-credentials: false`), setup-node with the cache, `build-release.sh`, `release-artifact.sh record --tag "$GITHUB_REF_NAME"` (`id: record`) and the upload; `publish` (`needs: build`) runs checkout (`persist-credentials: false`, because nothing there pushes), the download, `release-artifact.sh verify`, the attest step, the existing "Name the provenance bundle", "Write the release notes" and "Publish the GitHub Release" steps unchanged.

- New `deploy/release-artifact.sh`, bash only, no node, two verbs: `record` (build side) and `verify` (publish side). Only `record` reads inside the tarball, in the build job: `./build.json` with `tar -xzOf`, never extracting to disk. `verify` treats the tarball as opaque bytes: a file-set check, `sha256sum` and a `cmp` of one line, with no `tar`, `gzip` or other decoder (D-6650).
- `deploy/release-main.sh`: compare also writes `tag=<tag>` on a release, in the same `printf` as `release=true`; a new `record_release` holds the one `built true` printf; a new fourth arm, `receive`, runs in the publish job: refusals, re-derivation, `release-artifact.sh verify`, a local tag, and the `built true` state, so the existing `publish` arm runs unchanged (D-6656, D-6658).
- `release-stable.yml` is not split: it already runs no install under a write token (D-6654). The guard reads it too.
- A new guard, `server/test/release-job-boundary.test.ts`, over parsed YAML (`server/test/workflowJobs.ts`), holds all three release workflows to the boundary: permissions, credentials, allowed actions and run bodies, the exact `with:` keys and environment a write job may carry, and every `steps.<id>.outputs` and `needs.<job>.outputs` reference resolving to a declared id or output (D-6655).

**Deploy class:** release lane and CI only; nothing ships to a box differently. The release workflows run from the commit they were pushed for, so the merge that lands this wave is the first run of the split. That merge changes `release-main.yml` and `release-main.sh`, both judges of the comparison (`JUDGES`, `release-main.sh:84`; D-6409), so it releases without comparing: its build job prints `could not compare (… changes ".github/workflows/release-main.yml", which judges this comparison); releasing vX.Y.Z`. That run is the live proof, and the coordinator measures it, not the worker (D-6659). `release.yml`'s split is first exercised by the next hand-cut minor.

**Landing order, as dependencies:**
- Task 1 (the carried items from review 854) depends on nothing.
- Task 2 (`release-artifact.sh`) depends on nothing.
- Task 3 (`release-main.sh`'s `receive` arm and compare's tag output) needs Task 2's `verify`.
- Task 4 (the two workflows and the guard) needs Tasks 2 and 3.
- Task 5 (docs) needs Task 4's names.
- Task 6 is the gate and the PR.

One PR, from this workspace's own branch. The open Dependabot actions-bump branch (`checkout`, `setup-node`, `upload-artifact`, `download-artifact` past `@v4` in all four workflows) overlaps every workflow this wave edits, and its own bumps already red the `@v4` pins in `build-release.test.ts`. So this wave lands first, keeps `@v4`, and its guard matches actions by name, never by version. The bump is re-created against the landed text afterwards, with its pin edits. That is not this wave's work.

## Not in this wave

- A third, read-only `compare` job between build and publish, giving a verdict computed by code no install touched (Reading 2).
- `release-stable.yml`: no job, permission or step changes. In particular, `promote`'s checkout keeps its persisted credential although it pushes nothing (Reading 3).
- A concurrency group for `release.yml` (Reading 4). A hand-pushed tag that lands between release-main's two jobs makes `receive` refuse (D-6662).
- Making the build bytes trustworthy. The build job is untrusted by premise; this wave takes the credentials away from it and does not make its output honest (D-6650).
- `deploy/build-release.sh`, `deploy/release-stable.sh`, `deploy/release-notes.mjs`, `deploy/verify-provenance.mjs`, `ci.yml`, `.github/ci/`. None changes.
- Any trigger change: no new trigger, no `workflow_dispatch`, `paths-ignore` exactly as wave 25 left it (pinned by W25-F1, `build-release.test.ts:698-718`).
- The `centralised-update-management` spec's §4 provenance text (`:186-198`). It names the permission set both build workflows hold, which stays true of their `publish` jobs, and the two identities, which do not change.

## Global Constraints

- **Files:**
  - Source: `deploy/release-artifact.sh` (new), `deploy/release-main.sh`, `.github/workflows/release-main.yml`, `.github/workflows/release.yml`.
  - Tests: `server/test/release-artifact.test.ts` (new), `server/test/release-job-boundary.test.ts` (new), `server/test/workflowJobs.ts` (new), `server/test/release-main.test.ts`, `server/test/build-release.test.ts`.
  - Docs: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-18-release-rollout-design.md` (a delta note), the wave-25 plan `docs/superpowers/plans/2026-10-22-centralised-update-w25-no-release-without-a-build-change.md` (Task 1's table edits and Task 5's two closure notes), and this plan.
  - NOT touched: `release-stable.yml`, `ci.yml`, `deploy/build-release.sh`, `deploy/release-stable.sh`, `deploy/release-notes.mjs`, `deploy/verify-provenance.mjs`, `.github/ci/`, `server/test/oss-metadata.test.ts` (its per-job timeout rule, `:156-184`, reads every job of both files and holds the new ones as written), `server/test/workflow-yaml-parses.test.ts`.
- **Functions and regions this wave edits** (the consent list, by file):
  - `deploy/release-main.sh`: the header (`:1-55`), `usage` (`:61`), the argument loop (`:64-79`), `set_output` (`:98-102`), `compare`'s two `set_output` calls on its release and skip paths (`:385-396`), the arm dispatch (`:496-500`). New `record_release` (beside `read_state`, `:125-131`) and `receive` (after `compare`, before the `publish` section at `:400`). `prepare`, `judge` and `publish` are not edited.
  - `deploy/release-artifact.sh` (new): `usage`, `die`, `put_output`, `digest_of`, `record`, `verify`.
  - `.github/workflows/release-main.yml`: the header (`:1-9`), and the `jobs:` block (`:61-143`), replaced whole by the two jobs. Lines `:10-59` (the gate note, the trigger and its rationale, concurrency) are not edited.
  - `.github/workflows/release.yml`: the header (`:1-13`) and the `jobs:` block (`:20-103`). The trigger (`:16-18`) is not edited. The bodies of "Name the provenance bundle" (`:82-87`), "Write the release notes" (`:94-96`) and "Publish the GitHub Release" (`:100-103`) move into the `publish` job byte for byte.
  - `README.md`: the "**The pipeline.**" paragraph, the sentence from "Where it releases" to "the next merge derives past it." (`:760-765`); the "**Two trust roots, both named.**" paragraph, one sentence added after "never installed from the tarball's bytes directly." (`:1027-1028`).
  - `CLAUDE.md`: the "Deploy = release + rollout" bullet, the clause "both attest the tarball keylessly and publish the bundle beside it)" (`:253-254`).
  - `docs/superpowers/specs/2026-09-18-release-rollout-design.md`: one new delta blockquote after the wave-25 delta (`:9`).
  - The wave-25 plan: the "When each row was measured" last bullet (`:168`) and one new bullet after it (Task 5), "The count" (`:170`), rows M16 (`:201`), X2 (`:214`), X7 (`:219`), X15 (`:227`), W1 (`:228`) and A1 (`:232`), one new row after X15, and one closure sub-bullet each under D-6401 (`:360-368`) and D-6405 (`:388-394`).
- **Claims, in groups, each taken all-or-nothing when its group frees.** Re-read the live claims before each group with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A, now: `deploy/release-main.sh`, `deploy/release-artifact.sh`, `.github/workflows/release-main.yml`, `.github/workflows/release.yml`, `server/test/release-main.test.ts`, `server/test/build-release.test.ts`, `server/test/release-artifact.test.ts`, `server/test/release-job-boundary.test.ts`, `server/test/workflowJobs.ts`, the wave-25 plan.
  - Group B, after Task 4: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-18-release-rollout-design.md`.

  `README.md` and `CLAUDE.md` have owners: the coordinator asks for consent to the regions above before Task 5, and Task 5 waits for it. The open branch of PR #1132 adds lines inside CLAUDE.md's "Known load flakes" bullet, above the Deploy bullet: disjoint, but it shifts these line numbers. Re-find each region by its text.
- **The pins that stay green, unedited:**
  - `build-release.test.ts`: `expectAttestingWorkflow` (`:516-531`), the exact four-space permission block of the publish job, and no `actions:`/`packages:`/… key anywhere (download-artifact inside one run needs no `actions: read`); the release.yml trigger row (`:537-543`): **`release.yml`, comments included, never contains `branches:`, `pull_request`, `schedule:`, `workflow_dispatch` or `workflow_call`**; `:545-550`: **`release.yml` never contains `npm ci`, `npm run`, `tsc` or `vite`**; the D-3127 lines (`:564-568`); the notes rows (`:585-604`); the run-line scan (`:627-651`); concurrency (`:657-659`); W25-F1, W25-F2, W25-Y2 (the compare step block, byte for byte), W25-Y4 (exactly two `GH_TOKEN:` lines in `release-main.yml`: compare's and publish's); the cache-key rows (`:786-811`), which read the FIRST multi-line `cache-dependency-path` of each file, so the build job comes first and the publish job has no setup-node at all.
  - **`release-main.yml`, comments included, never contains `npm ci`, `npm run`, `build-release.sh` or `gh release`** (`:683-684`). Every new comment says "the install", "the builder" and "the publish arm".
  - `release-main.test.ts`: W25-P2 (`:1173-1183`, each `built <w>` printf spelled once, so compare and receive share `record_release`); W25-P3 (`prepare` unchanged); **W25-P4 (`:1192-1196`): `.github/workflows/release-main.yml` is spelled exactly once in `release-main.sh`**, so the rewritten header names it as "the main-push workflow"; W25-P7 (exactly one `node -e`); `:1149-1151`: **no `npm ci` or `npm run` anywhere in `release-main.sh`**, comments included.
  - `oss-metadata.test.ts`: every job has `timeout-minutes` at four-space indent, 0 < N <= 60 (`:156-184`); no `secrets.` (`:149-154`). `single-definition.test.ts:3118-3130`: no workflow code line names the org.
  - `verify-provenance.test.ts`: the two identities. The workflow files keep their names and the attest step stays in them, never in a called workflow.
- **No numeric citation in any added code or test line** (`citations.test.ts`). Cite `release-main.sh#receive` or a describe name. This plan's `path:line` anchors are for reading only.
- **Hermetic tests.** Fixture repos under `mkTmp` with a bare `origin`, the poisoned `curl`, and the recording `gh` and `npm` stubs (`release-main.test.ts:149-193`). No network, no real `gh`, no real release, no workflow run. `run()` keeps `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` before `extraEnv` (`:202`); a row that reads an output file passes its own path through `extraEnv`. Every git spawn carries `GIT_ENV`.
- **Memory and vitest.** Run ONE file at a time, in the foreground, from inside `server/`, with `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, wrapped in `timeout -s INT 560`. Use a short real TMPDIR (`mkdir -p ~/.cc-tmp/w26`). Never bare `npx vitest`. Read the session slice's `anon` in `memory.stat` first, and run nothing above the programme's gate. Mutation runs are sequential: the release fixtures copy `deploy/` at test time.
- **The absorb step.** Before each task's first edit, run `git fetch origin main` and re-read every anchor that task names in the landed text. Absorb `origin/main` only on worker clause 16's triggers, with `git merge`, never a rebase or a force-push. The coordinator lands the PR.
- **Public repo.** Commits use the noreply identity. No hosts, IPs, home paths, lane, account or session names in code, comments, commits, rows or the PR body. Write "the server box" and "the fleet box".
- **Routing.** Execute natively, inside the subscription, with no handoff. Pass the model explicitly on every subagent:
  - implementer subagents run on `sonnet`, one per task;
  - the per-task reviewer and the whole-branch reviewer run on `opus`, with a security lens on Tasks 2, 3 and 4 (an untrusted artifact crossing into a job that holds a write token);
  - scouts and transcription-grade edits (Task 1's table edits, Task 5's copy) run on `haiku`.

  The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip. The `suite:` line follows worker clause 15 (Task 6 Step 4).

## Review Focus

- **A release tag that reaches origin between the two jobs.** A hand-pushed `vX.Y.0` (`release.yml` has no concurrency group), or a tag left by an earlier run, makes the publish job's derivation differ from the build's. `receive` must refuse, tag nothing and push nothing, and the line must say to re-run all jobs. Rows W26-R2 and W26-R4.
- **Re-running only the failed publish job.** After a publish whose `gh` call failed (the trap deletes the pushed tag), "re-run failed jobs" downloads the same artifact into a fresh checkout and must publish the same tag. Row W26-R9. Past the artifact's retention, only a full re-run works, and it rebuilds the same number (D-6657).
- **An artifact shaped to attack the write job.** A symlink in place of the tarball, a third file, a dot file, a directory. `verify` must refuse each with nothing written to `release-out/`, and nothing in the write job may decompress or parse the tarball: `verify` hashes it and compares one line, and `receive` has no `tar`. The write job's whole exposure to the build's bytes is `actions/download-artifact`'s unzip of the hand-over, `sha256sum`, `cmp`, and the attest action's digest. Rows W26-V4, W26-V5, W26-A6 and W26-P1, and mutant K14.
- **A decision that never reaches the job output.** `set_output` swallows a failed append by design, so a lost `release=` would skip the publish job with a green run. The build job's decision check fails the run instead. Row W26-Y6 and mutant B10.
- **Job-output wiring nothing ran before merge.** A missing `id: record` or a misspelt `steps.compare.outputs.tag` evaluates to an empty string with no parse error. Row W26-G5 resolves every `steps.<id>.outputs` and `needs.<job>.outputs` reference; W26-Y4 pins `id: record`. Mutant B9.
- **What a write job's code is chosen by.** A publish checkout `ref:` taken from a build output, or a job-level `BASH_ENV`, would run build-controlled code with the token before any check. W26-G1 refuses any `with:` key outside each action's set, any job- or workflow-level `env:` or `defaults:` in a file with a write job, any step-level loader or path variable, and `${{ needs.` outside the hand-over's three values. Planted in W26-G4.
- **`build.json`'s `ref` stays what it was.** The fingerprint keeps `ref` (`release-main.sh:161-164`), so a build job whose checkout detaches HEAD (a `ref:` input) would release every merge with `ref` reading `HEAD`. The build job's checkout has no `ref:`. Row W26-Y2.
- **A skip mints no write token.** On `built unchanged`, `built false` or `built contained`, the publish job is skipped, so no write token or OIDC token exists in the run. Rows W26-C1 and W26-Y5, and mutants B1 and B2.

## Risk notes

- **The verdict is the build job's, and so is untrusted (D-6648).** A hostile install can rewrite `release-main.sh` on that runner, or inject env into compare through `$GITHUB_ENV`. It can then force `release=true`, which releases the build's own bytes under the next number (the same bytes a forced difference would release anyway), or force `release=false`, which skips a release silently where a failed build would be loud. Both are availability effects it already has by failing the build. Neither reaches a credential. A forced skip shows on the run as `built unchanged`, and a `stable` push of that head is refused with a pointer to that run (`deploy/release-stable.sh:97`).
- **The build job's `ls-remote` is now anonymous.** With `persist-credentials: false`, prepare's two `git ls-remote --exit-code` calls (`release-main.sh:224`, `:251`) reach origin with no credential. On this public repository that is an ordinary read. The script reads any non-zero exit as "origin does not hold it", so on a private fork the failed calls would be misread. Stated in the workflow comment; this repository is public by ruling.
- **The runner's own node writes the notes (D-6651).** The publish job has no setup-node. `release-notes.mjs` uses built-ins only. A runner node too old for its syntax costs the release its body (the existing warning and empty-body fallback), never the release. `verify` uses no node.
- **The npm cache crosses runs, not jobs (D-6652).** setup-node saves the build job's npm cache on a key miss, and a hostile install could write into it. `npm ci` checks every package against the lockfile's `integrity`, the cache is restored only into jobs that hold no write token, and the publish job restores none.
- **GitHub-hosted runners only (D-6660).** The boundary assumes each job gets a fresh machine. A self-hosted runner shared between the two jobs would void it. The guard pins `runs-on: ubuntu-latest` for every release job.
- **`release.yml` is proven statically until the next hand-cut minor.** No release workflow can run on a PR. The guard rows and the fixture rows hold its shape; the coordinator measures its first real run (D-6659).
- **Run time and storage.** The publish job adds a full-depth checkout (about 12 s) and a download. The artifact (one tarball and one line) is kept seven days.

## Mutation table

Each guard, the mutation that removes or weakens it, and the rows expected to go red. Each mutation is applied alone, its whole test file run once, and the file restored byte-identical; runs are sequential. The worker records the measured red rows and the file's case count as "(n of N)", with the commit each group was measured at, and adds a row for every guard it adds. "Expected" is this plan's prediction, never a measurement.

**A measurement names a commit that holds what was measured.** Each task commits its code and rows first, measures against that commit, and only then writes the counts, naming that sha, in a later commit (into this plan, or for Task 1 into the wave-25 plan). A table never names its own commit.

| File run | Mutation | Expected red rows |
|---|---|---|
| `release-main.test.ts` | X15rc (carried, Task 1): delete `[ "$rc" -ne 0 ] \|\| ` from `judge`'s listing check | W25-C35, comm prints a well-formed line and exits 1 (1 of N) |
| `release-main.test.ts` | X2, X7, X15 re-measured (Task 1) | X2: W25-C30 x2; X7: W25-C35 x3; X15: W25-C35 exits 0 and prints nothing |
| `release-artifact.test.ts` | K1: `record` skips the named-tarball check | W26-A2 — measured at `30380fcf4`: W26-A2 (1 of 48), exit 1 |
| `release-artifact.test.ts` | K2: `record` skips the `SHA256SUMS` line check | W26-A3 — measured at `30380fcf4`: W26-A3 x3, all three cases (3 of 48), exit 1 |
| `release-artifact.test.ts` | K3: `put_output`'s guard removed | W26-A5 — measured at `30380fcf4` (the `{ …; } 2>/dev/null \|\| :` wrapper dropped): W26-A5 (1 of 48), exit 1 |
| `release-artifact.test.ts` | K4: `verify` skips the digest comparison | W26-V2 — measured at `30380fcf4`: W26-V2 (1 of 48), exit 1 |
| `release-artifact.test.ts` | K5: `verify` accepts a `SHA256SUMS` that merely starts with the expected line | W26-V3 (the two-line case) — measured at `30380fcf4` (`cmp -s -n <length of the expected line>`): W26-V3 two-line case (1 of 48), exit 1 |
| `release-artifact.test.ts` | K6: `verify` skips the exact-file-set check | W26-V4 x3 — measured at `30380fcf4`: W26-V4 x3 and W26-V6 x2 (5 of 48), exit 1. DIFFERS from the expectation: with the file-set check gone a missing file falls to the regular-file refusal, so W26-V6's "holds" reason goes red too |
| `release-artifact.test.ts` | K7: `verify`'s `-L` refusals deleted | W26-V5 x2 — measured at `30380fcf4`: W26-V5 x2 (2 of 48), exit 1 |
| `release-artifact.test.ts` | K8: `record` skips the `version` comparison | W26-A7 — measured at `30380fcf4`: W26-A7 (1 of 48), exit 1 |
| `release-artifact.test.ts` | K9: `record` skips the `sha` comparison | W26-A8 — measured at `30380fcf4`: W26-A8 (1 of 48), exit 1 |
| `release-artifact.test.ts` | K10: `record`'s shape refusal deleted (the `[[ =~ ]]` failure branch) | W26-A9, the reordered-keys case (it then refuses with the version reason, not the shape reason) — measured at `30380fcf4` (the failure branch replaced by `[[ "$json" =~ $re ]] \|\| :`): W26-A9 reordered-keys case (1 of 48), exit 1. The reason DIFFERS from the parenthesis: under `set -u` the unmatched captures abort the script with bash's `BASH_REMATCH[1]: unbound variable` (exit 1) before the version comparison runs |
| `release-artifact.test.ts` | K11: `verify`'s tag and digest shape checks deleted | W26-A4 (verify cases) — measured at `30380fcf4`: W26-A4 verify `--tag` x2 and `--digest` x3 (5 of 48), exit 1 |
| `release-artifact.test.ts` | K12: `verify`'s out-directory tripwire deleted | W26-V10 — measured at `30380fcf4`: W26-V10 the out-holds-a-tarball case (1 of 48), exit 1; the `--out` equal to `--in` case stays green, refused by the `-ef` line |
| `release-artifact.test.ts` | K13: `verify` copies before it checks | W26-V11 (nothing written on refusal) — measured at `30380fcf4`, two placements. (a) the three writes moved to just after the shape checks: 15 of 48 red, exit 1 — W26-V1, W26-V2, W26-V3 x3, W26-V4 x3, W26-V5 x2, W26-V6 x2, W26-V12, W26-V10 x2; the out tripwire then refuses the copy just made, so most rows red on the reason, and only the W26-V10 out-holds-a-tarball row on the V11 helper. (b) the writes moved to just after the out-directory checks, before the artifact checks: 11 of 48 red, exit 1 — W26-V2, W26-V3 x3, W26-V4 x3, W26-V5 x2, W26-V6 x2; ten on the V11 helper ("must not exist or be empty"), W26-V6's missing-tarball case on `cp`'s own error |
| `release-artifact.test.ts` | K14: a `tar -tzf "$tarball" >/dev/null` line added to `verify`'s body | W26-A6 (the write side parses nothing), W26-V12 (tar refuses the non-gzip bytes) — measured at `30380fcf4` (spelled `tar -tzf "$in/$name" >/dev/null`, verify having no `$tarball`): W26-A6 x2 (the one-tar-call pin and the no-decoder pin) and W26-V12 (3 of 48), exit 1 |
| `release-main.test.ts` | M16 (wave-25 row, re-measured in Task 3): `set_output`'s guard removed | W25-C19 |
| `release-main.test.ts` | J1: `set_output` drops the `tag=` line | W26-C1 (release case) |
| `release-main.test.ts` | J2: compare's skip passes a tag to `set_output` | W26-C1 (skip case) |
| `release-main.test.ts` | J3: `receive`'s derivation check deleted | W26-R2 |
| `release-main.test.ts` | J4: `receive` never calls `verify` | W26-R3 |
| `release-main.test.ts` | J5: `receive`'s tagged-HEAD refusal deleted | W26-R4 |
| `release-main.test.ts` | J6: `receive`'s contained refusal deleted | W26-R5 |
| `release-main.test.ts` | J7: `receive`'s dirty-tree check deleted | W26-R6 (the dirty clone and the in-clone out directory) |
| `release-main.test.ts` | J8: `receive`'s state and tarball tripwire deleted | W26-R6 (the two out-of-clone cases) |
| `release-main.test.ts` | J9: `receive` does not tag locally | W26-R1, W26-R9 (publish refuses "HEAD no longer carries") |
| `release-main.test.ts` | J10: `receive` accepted with `--tag` alone (the three-flag check deleted) | W26-R7 |
| `build-release.test.ts` | B1: the publish job's `if:` deleted | the amended attest-gate row |
| `build-release.test.ts` | B2: `\|\| always()` appended to the publish job's `if:` | the amended attest-gate row |
| `build-release.test.ts` | B3: `ref: ${{ github.sha }}` added to the build job's checkout | W26-Y2 |
| `build-release.test.ts` | B4: `fetch-depth: 0` deleted from the publish job's checkout | W26-Y2 |
| `build-release.test.ts` | B5: the upload's `path` becomes `release-out/*` | W26-Y3 |
| `build-release.test.ts` | B6: the download's `path` becomes `release-out` | W26-Y3 |
| `build-release.test.ts` | B7: the receive step's env drops `CCRC_BUILD_DIGEST` | W26-Y4 |
| `build-release.test.ts` | B8: the record step moved after the upload | W25-Y3 (amended order) |
| `build-release.test.ts` | B9: `id: record` deleted from release-main's record step | W26-Y4; and, in `release-job-boundary.test.ts`, W26-G1 and W26-G5 (release-main.yml) |
| `build-release.test.ts` | B10: the decision check step deleted | W26-Y6, W25-Y3 (amended order) |
| `build-release.test.ts` | B11: `ref: ${{ needs.build.outputs.tag }}` added to release-main's publish checkout | W26-Y2; and W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-a: release-main's build job gets `contents: write` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-b: release-main's build job gets `id-token: write` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-c: release-main's build checkout loses `persist-credentials: false` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-d: release-main's publish job gets a `run: cd server && npm ci` step | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-e: release-main's publish job runs `bash deploy/release-main.sh prepare --out release-out` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-f: release-main's publish job gets `actions/setup-node@v4` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-g: release-main's publish job gets `run: node server/scripts/fix-node-pty-helper.mjs` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-h: top-level `permissions: write-all` in release-main.yml | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-i: release-main's publish job loses `needs: build` | W26-G3 |
| `release-job-boundary.test.ts` | G-j: the attest step moved into release-main's build job | W26-G1, W26-G3 |
| `release-job-boundary.test.ts` | G-k: release-main's build job `runs-on: self-hosted` | W26-G1 (release-main.yml) |
| `release-job-boundary.test.ts` | G-l: release.yml's build job gets `contents: write` | W26-G1 (release.yml) |
| `release-job-boundary.test.ts` | G-m: release.yml's publish job gets a `run: bash deploy/build-release.sh --out release-out` step | W26-G1 (release.yml) |
| `release-job-boundary.test.ts` | G-n: release-stable's `full` job gets `contents: write` | W26-G1 (release-stable.yml) |
| `release-job-boundary.test.ts` | G-o: the marker list loses `npm` | W26-G4 (the three npm cases, each expecting the marker phrase); W26-G6 (the `npm` case) |
| `release-job-boundary.test.ts` | G-p: `boundaryFindings` skips the job-level `env:` check | W26-G4 (the job-level `BASH_ENV` case) |
| `release-job-boundary.test.ts` | G-q: `boundaryFindings` skips the `with:` key check | W26-G4 (the publish checkout `ref:` case) |
| `release-job-boundary.test.ts` | G-r: the reference check skips `needs.<job>.outputs` | W26-G4 (the undeclared-output case) |

Every planted case in W26-G4 is itself a kept mutation row, re-proved on every run (the pattern of `workflow-yaml-parses.test.ts`).

B9 and B11 are applied to the workflow file, so each is run against both `build-release.test.ts` and `release-job-boundary.test.ts`, one after the other, and both files' red rows are recorded.

## Deviations found

The coordinator issued a block of twenty numbers, starting at D-6647, to this wave. This plan defines D-6647 to D-6662 below. The block's last four are the worker's reserve and are left unnamed here; at Task 6 each one the wave did not use gets its own `unused` entry, so all twenty are accounted for. Every entry opens `- **D-<n>** — `, the form the ledger's definition reader sees (`DEFINITION`, `server/src/coord/ledger.ts:184`); the `- **D-<n>.**` form is invisible to it.

- **D-6647** — Each release workflow becomes two jobs, `build` and `publish`, in the same file; the attest step stays in that file's `publish` job and never moves into a called workflow.
  - Why: GitHub enforces `GITHUB_TOKEN` permissions and OIDC access per job, and a hosted job is a fresh machine; nothing narrower than a job is a boundary against code the install runs (the wave-25 plan's D-6401 "Not a boundary" and D-6405, both closed by this entry).
  - The certificate identity is the workflow file at its ref (`verify-provenance.mjs:102-107`). A called workflow would sign as the called file, and every box would refuse the release; `build-release.test.ts:540` already forbids `workflow_call` in `release.yml`.
- **D-6648** — The comparison runs in the build job, under that job's read token, and its verdict crosses to the publish job as a job output; nothing in the publish job decompresses or parses the build's bytes.
  - The other placement, compare in the publish job, gives a verdict computed by code no install touched, but it untars a tarball the install produced, and walks it with node, inside the job that holds the write token and the OIDC permission. That leans on GNU tar's gzip and header parser, its refusal of `..` members and its deferral of dangerous symlinks, which is exactly the kind of parser this boundary exists not to trust. The same reasoning keeps the `build.json` check out of `verify` (D-6650).
  - What a forged verdict can do is stated in Risk notes: a spurious release of the build's own bytes, or a silent skip. A hostile build already has both effects (by changing a byte, or by failing). A forged verdict reaches no credential.
  - So the write job's whole exposure to the build's output is: `actions/download-artifact`'s unzip of the hand-over (the action's own code, writing two files under `$RUNNER_TEMP/release-in`), a listing of that directory, `sha256sum` over the tarball, `cmp` of `SHA256SUMS` against the one line it computed, a copy, the attest action's digest of the copy, and `gh release create`'s upload. No `tar`, `gzip`, node or other decoder reads those bytes there (W26-A6, W26-P1). A skip never starts the publish job, so it mints no write token at all.
  - A middle read-only `compare` job is Reading 2.
- **D-6649** — The tag is derived twice and must agree, and the build's files must be named for it: the build job's `prepare` derives it; the publish job's `receive` re-derives it with the same `derive_tags` from its own full-depth checkout and refuses unless it equals the build's `tag` output; the artifact is named `release-<tag>` and must hold exactly `ccrc-<tag>.tar.gz` and `SHA256SUMS`.
  - Why: the build job's state file, outputs and `SHA256SUMS` are all untrusted, and the publish job's fresh checkout carries no local tag (`publish` refuses without one at `release-main.sh:460-461`). Re-deriving, rather than trusting, closes both.
  - The publish job writes its own `SHA256SUMS` from the digest it computed, and refuses unless the received one is byte-identical.
  - `build.json`'s `version` and `sha` are checked in the build job, by `record` (D-6650), not here: that check catches an honest builder's mistake, and a hostile build writes a consistent `build.json` anyway.
- **D-6650** — The digest the build job records is a consistency check between the two jobs, not a trust anchor; and every check that reads inside the tarball runs in the build job.
  - It catches a hand-over that changed between upload and download, and two jobs that disagree. It cannot make the bytes honest: the build job made them and recorded their digest.
  - What the split buys: no code the install runs can push a tag or branch, create, edit or delete a release, or mint a signing certificate for either release identity. What it does not buy: the attested bytes are still the build job's. The bundle says which run of which commit built them, as it does today.
  - `record` reads `./build.json` with `tar -xzOf` and refuses unless it is in the builder's one-line shape (`build-release.sh:169-173`), its `version` equals `--tag` and its `sha` equals the build checkout's HEAD. `build-release.sh` names the tarball and writes `version` from the same `VERSION` (`:68-70`, `:169-173`), so for an honest build these refusals catch D-3127's case (a tarball named after another tag at HEAD) and nothing the digest check would not. They run where parsing the build's output costs nothing.
  - `verify`, in the publish job, never reads inside the tarball. Rejected: keeping the `build.json` read in `verify`. `head -c` would bound only its output; GNU tar without `--occurrence` gunzips and parses every header to the end of the archive, beside the persisted credential and the OIDC request variables, to prove something a hostile build forges for free.
- **D-6651** — The publish job has no setup-node and no npm cache; its one node program is `release-notes.mjs` on the runner's own node, as `release-stable.yml`'s gate already runs a dependency-free module (`release-stable.yml:5-6`).
  - No `node_modules` exists on its path: its checkout is fresh, nothing installs, `release-notes.mjs` imports only built-ins (`release-notes.test.ts:276`), and `verify` uses no node.
  - Rejected: setup-node without `cache:`. It pins the node version, but a later setup-node major can turn its package-manager cache on by default when `package.json` names a package manager, which would restore a cache the build job may have written into the write job. With no setup-node in the job, that cannot happen. The guard forbids setup-node in a write job.
- **D-6652** — The build job keeps setup-node's npm cache keyed on the four lockfiles, unchanged.
  - Why: `npm ci` verifies every package against the lockfile's `integrity` hash, so a poisoned cache entry fails the install rather than running; the cache is restored only into jobs that hold no write token; the cache-key rows (`build-release.test.ts:786-811`) stay as they are.
- **D-6653** — `release.yml` is split the same way, and its `publish` job's checkout also sets `persist-credentials: false`, because nothing in that job pushes (`gh release create` uses `GH_TOKEN`).
  - The build job's `record --tag "$GITHUB_REF_NAME"` refuses a tarball named after another tag at HEAD, so D-3127's case now fails before the upload. The publish job's "Name the provenance bundle" refusal stays byte for byte, as its pinned literal (`build-release.test.ts:564-568`) requires.
  - Its notes and publish steps move unchanged; the notes step now runs on the runner's node (D-6651).
  - It has no release decision, so it has no decision check (D-6658): its publish job runs whenever its build job succeeds.
- **D-6654** — `release-stable.yml` is not split.
  - Today its write job, `promote`, runs only `bash deploy/release-stable.sh`, repository shell that installs and builds nothing; the job that runs the install (`full`, ci.yml) and the gate hold read tokens only. That is already the target shape, and the new guard reads this file and holds it there.
  - `promote`'s checkout still persists a credential it never uses. Dropping it is a tightening with no install to protect against, and it would touch a third workflow and its own pins (`build-release.test.ts:813-1007`); Reading 3.
- **D-6655** — The guard reads the parsed YAML and classifies jobs, rather than matching text.
  - A **build job** is one with a job-level `uses:` (a called workflow), or a step whose `run:` matches the build markers: `npm`, `npx`, `pnpm`, `yarn`, `tsc`, `vite`, `build-release.sh`, `release-main.sh prepare`, `release-main.sh compare`. Every build job must declare a job-level permissions mapping whose values are all `read` or `none`, must have no `id-token` key, and every `actions/checkout` step in it must set `persist-credentials: false`.
  - A **write job** is one whose permissions grant any `write`, or `write-all`. Its steps may `uses:` only `actions/checkout`, `actions/download-artifact` and `actions/attest-build-provenance`, and each `run:` body must equal one entry of that file's allowlist for that job, byte for byte after trimming. A new step in a write job therefore asks for itself in the diff, in the test.
  - **What chooses a write job's code is held too**, because a step's `uses:` and `run:` are not all of it:
    - each allowed action's `with:` keys are an exact set: `actions/checkout` ⊆ {`fetch-depth`, `persist-credentials`}, `actions/download-artifact` = {`name`, `path`}, `actions/attest-build-provenance` = {`subject-path`}. So no `ref:`, `repository:` or `path:` on the publish checkout;
    - a write job's own keys are within {`runs-on`, `timeout-minutes`, `permissions`, `needs`, `if`, `steps`}: no job-level `env:`, `defaults:`, `container:`, `services:`, `strategy:` or `outputs:`; a step's keys are within {`name`, `id`, `if`, `uses`, `with`, `env`, `run`}: no `shell:` or `working-directory:`;
    - a file that holds a write job has no workflow-level `env:` or `defaults:` (none of the three files has either at the base);
    - no step `env:` key in a write job is `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `PATH` or `GIT_*`;
    - `${{ needs.` appears in a write job's `with:` and `env:` values only as the download's `name` and the receive or verify step's `CCRC_BUILD_TAG` and `CCRC_BUILD_DIGEST`.
  - **References resolve.** In every job of the three files, each `steps.<id>.outputs.<k>` in the job's `outputs:` or in a step's `if:`, `with:` or `env:` names a step `id` declared earlier in the same job (the `outputs:` map may name any step of the job); each `needs.<j>.outputs.<k>` names a job `<j>` in this job's `needs` that declares `<k>` in its `outputs:`, or, for a called-workflow job, whose called file declares `<k>` under `on.workflow_call.outputs` (`release-stable.yml`'s `needs.full.outputs.verdict`, declared at `ci.yml:84-85`). A missing id is an empty string at run time with no parse error, and no release workflow runs before merge (D-6659), so this is the only pre-merge proof of the wiring.
  - Every job in the three files declares its own permissions, none at workflow level grants write, and every job that has steps runs on `ubuntu-latest` (D-6660); a called-workflow job has no `runs-on` of its own.
  - Its limit: a build job is found by its markers. A step that runs build-script code under a name the list does not know is not classified, so the allowlist on the write job, not the marker list, is what keeps such a step out of the job that holds the token.
- **D-6656** — `release-main.sh` gains a fourth arm, `receive`, run only in the publish job; it re-proves what prepare and compare proved, then leaves exactly the state compare would have left, so `publish` runs unchanged.
  - `receive` refuses a dirty tree, an out directory that already holds a state file or a tarball, a HEAD carrying any release-shaped tag, a HEAD a release tag contains, and a derivation that differs from `--tag`; then `release-artifact.sh verify` must pass; then it tags locally and calls `record_release`.
  - The dirty check comes first, and the workflow's `release-out` lies inside the checkout and is not gitignored (the wave-25 plan's D-6404, `:383`). So in the workflow it is the dirty check that catches a pre-filled in-tree `release-out`; the out-directory check catches an out directory outside the tree. W26-R6 holds both.
  - `record_release` holds the one `printf 'built true\ntag %s\nhead %s\n'`, called by compare and by receive, so W25-P2 still finds the word spelled once.
  - `JUDGES` is unchanged. `release-artifact.sh` does not decide whether a merge releases, and it ships under `deploy/`, so a change to it changes the fingerprint and releases anyway.
- **D-6657** — The hand-over is one artifact per release, `release-<tag>`, holding exactly `ccrc-<tag>.tar.gz` and `SHA256SUMS`, uploaded with `if-no-files-found: error`, `retention-days: 7` and `compression-level: 0` (the tarball is already compressed), and downloaded into `$RUNNER_TEMP/release-in`, outside the checkout.
  - A re-run of the failed publish job alone downloads the same artifact while it is retained; `receive` derives the same tag because nothing reached origin, or the trap removed it. After seven days, "re-run all jobs" rebuilds and derives the same number.
- **D-6658** — The release decision moves from the attest step's `if:` to the publish job's `if: needs.build.outputs.release == 'true'`, compare's output gains `tag=<tag>` on a release, and a decision that does not reach the job output fails the run.
  - `set_output` becomes `set_output <true|false> [<tag>]`; only compare's release path passes the tag, and it writes `release=true\ntag=<tag>\n` in one `printf`, so a skip writes `release=false` and nothing else.
  - The build job's `outputs:` are exactly `release` and `tag` from compare and `digest` from record.
  - **A lost decision fails, never skips.** `set_output` swallows a failed append by design (`release-main.sh:98-102`, pinned by W25-C19 and M16). In the one-job base a lost `release=true` still failed loudly, at publish's bundle refusal (`release-main.sh:457-458`). Split, the decision lives only in the job output, and an empty one would skip `publish` with a green run, reversing D-6393's rule that everything but an exact match releases. So the build job's step after compare, `if: steps.compare.outputs.release != 'true' && steps.compare.outputs.release != 'false'`, prints `release-main.yml: the release decision did not reach the job output; failing rather than skipping a release; re-run all jobs` and exits 1. Every exit-0 path of compare writes one of the two words (`release-main.sh:362`, `:368`, `:390`, `:395`), so the step runs only on a lost write, a skip's included. Row W26-Y6, mutant B10.
  - Rejected: gating the publish job on `!= 'false'`. A lost `release=false` would then start the write job and mint a write token for a merge that releases nothing, to be refused by `receive`; the build-side check keeps "a skip mints no write token" true.
  - An empty `tag` or `digest` with `release=true` reaches the publish job, where `receive` and `verify` refuse it loudly.
  - The wave-25 row "runs prepare, compare, attests, then publish" (`build-release.test.ts:665-685`) pinned the attest step's `if:` line; that line would now match the record and upload steps and pass vacuously, so the row is rewritten (Task 4), and W25-Y3's order gains the new steps. W25's W1 and A1 mutants are re-targeted as B1 and B2.
- **D-6659** — The split is proven before merge by static and fixture rows only; the first real run after landing is measured by the coordinator.
  - No release workflow can run on a pull request, and no local runner is used: `act` cannot mint the OIDC token or run the attest action, and installing it would be a new dependency for one proof. The two-job emulation is W26-R1: a build clone runs prepare, compare and record, the two files are copied as the hand-over, and a fresh clone of origin runs receive and publish.
  - The coordinator measures the landing merge's run with read-only calls (`gh run view <id> --json jobs`, the job logs, `gh release view`, `gh api repos/{owner}/{repo}/attestations/sha256:<digest>`):
    1. two jobs, `build` then `publish`, both green, post steps included; the build job's decision check reads `skipped`;
    2. the build job's "Set up job" log lists `Contents: read` and `Metadata: read` only, and the publish job's lists `Attestations: write`, `Contents: write`, `IdToken: write` and `Metadata: read`;
    3. the build job's compare line is the judges line naming `.github/workflows/release-main.yml`;
    4. the record line's digest equals the publish job's receive line, the release's `SHA256SUMS` and the attestation's subject digest; the publish job's `CCRC_BUILD_TAG` and `CCRC_BUILD_DIGEST` are non-empty in its log;
    5. the release carries the three assets, and the attestation's signer workflow is `release-main.yml@refs/heads/main`;
    6. the next merge whose build is unchanged prints `built unchanged`, its decision check and its publish job read `skipped`, and no tag or release appears.
  - `release.yml`'s first split run is the next hand-cut minor; the coordinator measures it the same way, with the identity at `refs/tags/<tag>`.
- **D-6660** — Every job of the three release workflows that has steps runs on `ubuntu-latest`, and the guard pins it.
  - Why: the boundary assumes a fresh machine per job. A self-hosted runner reused across the two jobs would let the build job leave code for the publish job.
- **D-6661** — Review 854's two carried items amend the wave-25 plan in place: its mutation rows X2, X7 and X15 are re-measured, X15rc is added, and the sentence "Neither the targets nor the rows of an earlier measurement changed after it was taken" is replaced by one that says which rows were re-measured, when, and against how many cases. Task 5 adds what this wave itself changes there: the attest `if:` that W1 and A1 mutated is gone, and `set_output`, M16's target, is reshaped.
  - Why in place: those rows are the wave-25 record, and a reader of that plan must find the corrected counts there, not in a later plan.
- **D-6662** — A release tag that reaches origin between release-main's two jobs makes `receive` refuse, and the run fails with nothing tagged or pushed; `release.yml` gets no concurrency group.
  - Why: the workflow-level concurrency group (`release-main.yml:57-59`) serialises release-main runs across both jobs, but a hand-pushed `v*` tag runs `release.yml` outside it. Refusing is fail-closed and the remedy is a full re-run, which derives past the new tag. Sharing a group with `release.yml` would change that workflow's queueing for a race that has not been seen; Reading 4.

## File structure

- `deploy/release-artifact.sh` (new, Task 2): bash, `set -euo pipefail`, its own `SHAPE` line byte-identical to `release-main.sh`'s, `digest_of` using `sha256sum` or, on Darwin, `shasum -a 256` (the switch `judge` uses at `release-main.sh:281-282`).
- `server/test/release-artifact.test.ts` (new, Task 2): describes `'release-artifact.sh record (W26, D-6649, D-6650)'`, `'release-artifact.sh verify (W26, D-6649, D-6650)'` and `'release-artifact.sh: source pins (W26)'`.
- `deploy/release-main.sh` (Task 3): `set_output`, `record_release`, `receive`, the argument loop, `usage`, the dispatch and the header.
- `server/test/release-main.test.ts` (Tasks 1 and 3): the C35 case; `fixture()` copies `release-artifact.sh`; new helpers `publishClone` and `handOver`; a new describe `'release-main.sh: receive — the publish job re-proves the build job's artifact (W26)'`; W26-C1 in the compare describe; W26-P1 in the source pins.
- `.github/workflows/release-main.yml`, `.github/workflows/release.yml` (Task 4).
- `server/test/workflowJobs.ts` (new, Task 4), `server/test/release-job-boundary.test.ts` (new, Task 4).
- `server/test/build-release.test.ts` (Task 4): the rows named in Task 4.
- Task 5: in-place edits only.

## Tasks

Tasks 1 to 4 are claim group A; Task 5 is group B. Every test row is a vitest row in the named file.

### Task 1: the carried items from review 854 (D-6661)

**Files:**
- Modify: `server/test/release-main.test.ts:1092-1107` (W25-C35)
- Modify: the wave-25 plan, `:168`, `:170`, `:214`, `:219`, `:227`

**Interfaces:**
- Consumes: `judge`'s listing check (`release-main.sh:348-352`), the existing `stubbed()` (`release-main.test.ts:968-973`) and `L.cant` (`:474-478`).
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the third case to W25-C35's `it.each`** (`:1094-1096`), and widen the comment above it to name three shapes:

```ts
['comm prints one well-formed line and exits 1', "printf '\"ccd/ccrc\"\\tx\\n'; exit 1"],
```

The fixture's default merge changes `ccd/ccrc`, so the fingerprints differ and `judge` reaches the listing; awk turns the stub's line into `1<TAB>"ccd/ccrc"`, which the shape half accepts, so only the rc half can refuse it. The expected stdout and state are the other two cases': `L.cant('the fingerprints differ, and listing how failed', 'v0.0.2')` and `built true`. The case's name cites `release-main.sh#judge`, never a line number.
- [ ] **Step 2: Run the file.** `timeout -s INT 560 ./node_modules/.bin/vitest run test/release-main.test.ts --pool=forks --maxWorkers=1`. Expected: green, one case more than the base's 90.
- [ ] **Step 3: Commit the case alone.** `git commit -m "test(release-main): the listing check's rc half has its own row (D-6661)"`. Record its sha as `<c35>`; the measurements below are taken against exactly that commit, which holds the 91 cases they count.
- [ ] **Step 4: Measure X15rc, then X2, X7 and X15, each alone, sequentially, at `<c35>`** (a clean tree at that commit). X15rc deletes `[ "$rc" -ne 0 ] || ` from the `if` in `judge`'s listing check; expected red: the new case only. X2, X7 and X15 are the wave-25 table's own mutations; expected: X2 reds both W25-C30 cases, X7 all three W25-C35 cases, X15 the "exits 0 and prints nothing" case. Restore the file byte-identical after each (`git diff --exit-code deploy/release-main.sh`).
- [ ] **Step 5: Edit the wave-25 plan's table** with the measured counts:
  - X2 (`:214`): its red rows with `(n of N)` as measured, and "re-measured in wave 26, Task 1, at `<c35>`".
  - X7 (`:219`): all three W25-C35 cases, named, with the measured count.
  - X15 (`:227`): its count against the new N.
  - A new row after X15: `| release-main.test.ts | X15rc (review 854): delete the listing check's rc half | W25-C35, comm prints one well-formed line and exits 1 (n of N) |`.
  - `:168` becomes: "- Rows were re-measured where a later round changed their targets or their rows: X2 and X7 at `0317c47e0` (2 of 90 each), and X2, X7, X15 and X15rc in wave 26 Task 1 at `<c35>` (counts in their rows). Every other row's count is the case count of its own measurement, named in its group above."
  - `:170`: "This table has 83 rows", and the sub-bullet that review 854 added X15rc.
- [ ] **Step 6: Commit the table alone.** `git commit -m "docs(plan): wave 25's listing-check rows re-measured at <c35> (D-6661)"`, with `<c35>` the real sha.

### Task 2: `release-artifact.sh`, the hand-over's two ends (D-6649, D-6650, D-6657)

**Files:**
- Create: `deploy/release-artifact.sh` (mode 0755)
- Test: `server/test/release-artifact.test.ts` (new)

**Interfaces:**
- Produces:
  - `bash deploy/release-artifact.sh record --tag <tag> --dir <dir>` (build job): checks, in this order, that `<tag>` matches `SHAPE`; that `<dir>` holds a regular file `ccrc-<tag>.tar.gz` and no other `ccrc-*.tar.gz`; that `SHA256SUMS` is a regular file and byte-exactly `<digest>  ccrc-<tag>.tar.gz\n`, where `<digest>` is the tarball's sha256; that `tar -xzOf <tarball> ./build.json` exits 0 and its output (bash strips the trailing newline) matches the builder's shape `{"sha":"<40 hex>","ref":"…","builtAt":"…","dirty":false,"version":"…"}` (`build-release.sh:169-173`); that `version` equals `<tag>`; and that `sha` equals `git -C "$ROOT" rev-parse HEAD`, where `ROOT` is the script's checkout, derived as `release-main.sh:58-59` does. Then it prints `release-artifact.sh: recorded ccrc-<tag>.tar.gz, sha256 <digest> (build.json: version <tag>, sha <head>)` and appends `digest=<digest>\n` to `$GITHUB_OUTPUT` when that is set, a write that can never fail the run (the `set_output` pattern, `release-main.sh:98-102`); a lost `digest` is caught downstream, where `verify` refuses an empty one. Exit 1 with `release-artifact.sh: <reason>` on stderr otherwise; exit 2 for a missing or unknown flag. This is the only verb that reads inside the tarball, and it runs where the build already ran (D-6650).
  - `bash deploy/release-artifact.sh verify --tag <tag> --digest <hex> --in <dir> --out <dir>` (publish job): checks, in this order, that `<tag>` matches `SHAPE` and `<hex>` is 64 lowercase hex; that `<out>` holds no `ccrc-*.tar.gz` and `<out>` is not `<in>`; that `<in>` holds exactly the two names, each a regular file and not a symlink; that the tarball's sha256 (`digest_of`) equals `<hex>`; and that `SHA256SUMS` is byte-identical to the one line it computes, by `cmp -s` against that line written to a temporary file outside `<in>` and `<out>`. It runs no `tar`, `gzip`, `zcat`, node or other decoder on either file. Only then does it `mkdir -p <out>`, copy the tarball in and write `<out>/SHA256SUMS` from the computed digest. Prints `release-artifact.sh: verified ccrc-<tag>.tar.gz (sha256 <digest>): the build's record and its SHA256SUMS agree; the tarball was not opened`.
  - Refusal reasons, exact text the rows match. Both verbs: `<tag> is not a release tag`; `SHA256SUMS is not exactly one line for ccrc-<tag>.tar.gz at <hex>`. `verify`'s: `<hex> is not a sha256 digest`; `<out> already holds a tarball — the attest step would sign an artifact no release publishes`; `the build's artifact holds <names, space-separated, sorted> — expected exactly ccrc-<tag>.tar.gz and SHA256SUMS`; `<name> in the build's artifact is not a regular file`; `ccrc-<tag>.tar.gz hashes to <actual>, not the <hex> the build job recorded`. `record`'s: `no ccrc-<tag>.tar.gz in <dir> (it holds <names>) — the builder named the tarball after another release tag at HEAD`; `could not read build.json from ccrc-<tag>.tar.gz, or it is not the builder's one-line shape`; `build.json says version <v>, not <tag>`; `build.json was built from <sha>, not HEAD <head>`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing rows.** The fixture is a one-commit git repo under `mkTmp` with `deploy/release-artifact.sh` copied in (the `GIT_ENV` and `git()` shape of `release-main.test.ts:30-40`), and a tarball made by `tar -czf <t> -C <dir> .` from a directory holding `build.json` in the builder's shape (HEAD's sha, the tag) and a `MANIFEST`. Rows:
  - **W26-A1:** `record` on a good pair exits 0, prints the line, and the `GITHUB_OUTPUT` file it was given reads exactly `digest=<sha256>\n`.
  - **W26-A2:** a dir holding `ccrc-v0.1.0.tar.gz` and its sums, recorded with `--tag v0.0.9`, exits 1 with the "another release tag" reason, and the output file stays empty.
  - **W26-A3:** `it.each` over a sums line for another digest, two lines, and no trailing newline: exit 1, the sums reason.
  - **W26-A4:** `it.each` over both verbs with `--tag vnext`, `--tag v1.2`, and (verify) `--digest` of 63 hex, of uppercase hex, and empty: exit 1, the matching reason; every flag missing in turn: exit 2.
  - **W26-A5:** `GITHUB_OUTPUT` pointing into a read-only directory: `record` exits 0 and prints no shell error.
  - **W26-A7:** a consistent pair whose `build.json` says `v0.0.8`, recorded with `--tag v0.0.9`: exit 1, the version reason; the output file stays empty.
  - **W26-A8:** a consistent pair whose `build.json` names another commit's sha: exit 1, the sha reason.
  - **W26-A9:** `it.each` over a tarball with no `./build.json` and a `build.json` with its keys reordered (right sha and version): exit 1, the build.json reason.
  - **W26-V1:** `verify` on a good artifact exits 0; `<out>` holds exactly the tarball, byte-identical, and `SHA256SUMS` equal to `` `${digest}  ccrc-${tag}.tar.gz\n` ``.
  - **W26-V2:** the right files, `--digest` of another file: exit 1, the hash reason naming both digests.
  - **W26-V3:** `it.each` as W26-A3, through `verify`.
  - **W26-V4:** `it.each` over a third file `x`, a dot file `.x`, and a directory `d`: exit 1, the "holds" reason listing all three names.
  - **W26-V5:** `it.each` over the tarball as a symlink to a good tarball elsewhere, and `SHA256SUMS` as a symlink: exit 1, the "not a regular file" reason.
  - **W26-V6:** `it.each` over a missing tarball and a missing `SHA256SUMS`: exit 1, the "holds" reason.
  - **W26-V12:** the write side does not open the tarball: a "tarball" that is 64 KiB of random bytes, not gzip at all, with a matching `--digest` and `SHA256SUMS`, verifies (exit 0) and is copied byte-identical. (The first draft's W26-V7 to W26-V9, the `build.json` checks, moved to `record` as W26-A7 to W26-A9; those three ids are retired, not reused.)
  - **W26-V10:** `it.each` over an `<out>` that already holds a `ccrc-*.tar.gz` and `--out` equal to `--in`: exit 1.
  - **W26-V11:** every refusal row above also asserts that `<out>` does not exist or is empty (folded into each row as a shared helper).
  - **W26-A6 (source pins):** the file's `SHAPE=` line equals `release-main.sh`'s byte for byte; it holds no `node`, `npm`, `gh `, `git push`, `curl` or `GH_TOKEN`; the file has exactly one `tar` call, inside `record`'s body, and it carries `-xzOf`; `verify`'s body (from its `verify() {` line to the next top-level `}`) contains none of `tar`, `gzip`, `gunzip`, `zcat`, `unzip`, `bsdtar` or `node`, word-bounded; `set -euo pipefail`.
- [ ] **Step 2: Run the file; expect every row red** ("no such file" for the script).
- [ ] **Step 3: Implement `deploy/release-artifact.sh`** to the Interfaces block. The file-set check lists `<in>` with a `nullglob`/`dotglob` glob, so dot files count; `record`'s `build.json` read takes its exit status (`rc=0; json="$(tar -xzOf …)" || rc=$?`) and refuses on non-zero rc; the shape is one `[[ =~ ]]` with captures for `sha` and `version`, and its failure branch refuses before the captures are read.
- [ ] **Step 4: Run the file until green.**
- [ ] **Step 5: Commit.** `git commit -m "feat(release): release-artifact.sh records the build's artifact and verifies it in the publish job (D-6649, D-6650)"`. Record its sha as `<t2>`.
- [ ] **Step 6: Measure K1 to K14 at `<t2>`,** then write the counts into this plan's Mutation table naming `<t2>`, and commit that alone: `git commit -m "docs(plan): wave 26 Task 2's mutation counts at <t2>"`.

### Task 3: `release-main.sh` — compare names its tag; `receive` re-proves the artifact (D-6649, D-6656, D-6658, D-6662)

**Files:**
- Modify: `deploy/release-main.sh:1-55`, `:61`, `:64-79`, `:98-102`, `:385-396`, `:496-500`; new `record_release` and `receive`
- Test: `server/test/release-main.test.ts`

**Interfaces:**
- Consumes: Task 2's `verify`, invoked as `bash "$ROOT/deploy/release-artifact.sh" verify --tag "$tag" --digest "$digest" --in "$IN_DIR" --out "$OUT_DIR"`.
- Produces:
  - `set_output <true|false> [<tag>]`: appends `release=<v>\n`, or, when a tag is given, `release=<v>\ntag=<tag>\n` in ONE `printf`, so the two lines land together or not at all; guarded as today (a failed append never fails the run; the build job's decision check, Task 4, turns a lost one into a failed run, D-6658).
  - `record_release <tag> <head>`: writes `$STATE` as `built true\ntag <tag>\nhead <head>\n`; compare's release path and `receive` call it.
  - `bash deploy/release-main.sh receive --in <dir> --tag <tag> --digest <hex> [--out <dir>]`. `--in`, `--tag` and `--digest` are usage errors (exit 2) with any other arm, and each is required with `receive` (exit 2). Success prints `release-main.sh: received <tag> from the build job (sha256 <hex>) — tagged locally (NOT pushed); next: attest, then publish`, exit 0. Refusals, exit 1, each ending "nothing was tagged or pushed":
    - `refusing a dirty tree …` (the prepare text); first, so an out directory inside the checkout that is already filled refuses here (D-6656);
    - `$OUT_DIR already holds a state or a tarball — receive runs once, into an empty out directory` (reachable for an out directory outside the checkout);
    - `HEAD already carries <t> — it was published already, or release.yml owns it`;
    - `HEAD is already contained in <t> — a re-run of an older merge`;
    - `the build job derived <tag>; this checkout derives <next> — a release tag reached origin between the two jobs; re-run all jobs`;
    - `the build's artifact did not verify` (after `verify`'s own reason on stderr).
  - The workflow invokes it as `bash deploy/release-main.sh receive --in "$RUNNER_TEMP/release-in" --tag "$CCRC_BUILD_TAG" --digest "$CCRC_BUILD_DIGEST" --out release-out`.

- [ ] **Step 1: Harness.** `FILES`/`fixture()` (`:47-146`) also copy `deploy/release-artifact.sh` (mode 0755). New helpers beside `pipeline()` (`:207-212`):
  - `publishClone(home: string): string`: `git clone -q <home>/origin.git <home>/publish` with `GIT_ENV`, so it sees origin's tags, has `main` checked out at origin's tip, and carries no local candidate tag (the publish job's checkout).
  - `handOver(out: string, dir: string, tag: string): string`: copies `ccrc-<tag>.tar.gz` and `SHA256SUMS` from `out` into a fresh `dir` and returns their tarball's sha256 (the upload and the download).
- [ ] **Step 2: Write the failing rows.**
  - **W26-C1** (compare describe): `it.each` over release, skip (W25-C1's docs-only fixture), already-tagged and contained, each run with `GITHUB_OUTPUT` set to a fixture file: the file reads exactly `release=true\ntag=v0.0.2\n` for the release and `release=false\n` for the other three.
  - **W26-R1:** the two-job pipeline. In the fixture repo: prepare, compare, then `release-artifact.sh record`. `handOver` into `<home>/handed`. In `publishClone(home)`: `receive` with that tag and digest, then `publish` with a planted bundle. Assert: before receive, origin lacks the tag and `origin-pushes` is absent; after receive, the clone's `git tag --points-at HEAD` is the tag, its state is `built true\ntag <t>\nhead <sha>\n`, `gh-argv` is absent; after publish, origin holds the tag, `origin-pushes` is exactly `refs/tags/<t>\n`, and the one `release create` names the publish clone's out files in the order of `release-main.test.ts:333-335`, with the notes as in the derive row.
  - **W26-R2:** after the build half, push a release-shaped tag one patch above to origin on an earlier commit, clear `origin-pushes`, then `publishClone` and `receive`: exit 1, the derivation reason naming both tags; no local tag; nothing pushed; no gh call; `release-out` holds no tarball.
  - **W26-R3:** `receive` with a digest of another file: exit 1, `verify`'s hash reason and the "did not verify" line; nothing tagged.
  - **W26-R4:** a fixture whose HEAD carries a release tag on origin (`tagHead`): `receive` in the publish clone exits 1 with the "already carries" reason.
  - **W26-R5:** a HEAD that a later release tag contains (W25-C28's shape): exit 1, the "contained" reason.
  - **W26-R6:** `it.each` over four cases, each exit 1 with nothing tagged: a dirty publish clone (an untracked file at its root, `--out <home>/out`), the dirty reason; `--out <home>/out`, OUTSIDE the clone, holding `release-main.state`, the out-directory reason; the same outside directory holding a `ccrc-*.tar.gz`, the out-directory reason; and `--out <clone>/release-out`, inside the clone as the workflow has it, holding `release-main.state`, the dirty reason (D-6656: in the workflow the dirty check is what catches a pre-filled `release-out`).
  - **W26-R7:** `it.each` over `prepare --tag v0.0.2`, `publish --in x`, `compare --digest <hex>`, and `receive` missing each of its three flags in turn: exit 2.
  - **W26-R9:** the build half, then a publish clone whose `receive` passes and whose `publish` runs with `gh` exiting 1 (the trap deletes the pushed tag); then a second fresh publish clone, `receive` with the same tag and digest from the same hand-over, and `publish` with `gh` exiting 0: green, origin holds the tag once.
  - **W26-P1** (source pins): `receive`'s body has no `gh `, no `GH_TOKEN`, no `build-release`, no `npm` and no `tar `, and calls `release-artifact.sh" verify` exactly once; the `built true` printf lives in `record_release`'s body; compare's body and receive's body each call `record_release`; W25-P2 and W25-P4 stay green unedited.
- [ ] **Step 3: Run the file; expect the new rows red** (unknown arm `receive`, no `tag=` line, no `release-artifact.sh` in the fixture's script calls).
- [ ] **Step 4: Implement** `set_output`, `record_release` and `receive` to the Interfaces block, `receive`'s checks in the order listed (all before any write), then `git -C "$ROOT" tag "$tag"`, then `record_release`. Compare's release path calls `set_output true "$tag"` and `record_release "$tag" "$head"`. Rewrite the header (`:1-55`) for four arms and two jobs: which arm runs in which job, that the build job holds a read token only, and that the publish job re-proves the artifact before any write. Name the workflow as "the main-push workflow" (W25-P4), and write "the install", never the npm verbs (`:1149-1151`). The "WHY ONE WORKFLOW" paragraph (`:52-55`) keeps its reason (a tag pushed with the job's token fires no other workflow) and says the run is two jobs of that one workflow. Update `usage`.
- [ ] **Step 5: Run the file until green.**
- [ ] **Step 6: Commit.** `git commit -m "feat(release-main): a receive arm re-derives the tag and verifies the build's artifact before any write (D-6656)"`. Record its sha as `<t3>`.
- [ ] **Step 7: Measure J1 to J10, and the wave-25 row M16 against the reshaped `set_output`, at `<t3>`;** write the counts into this plan's Mutation table naming `<t3>`, and commit that alone: `git commit -m "docs(plan): wave 26 Task 3's mutation counts at <t3>"`. Task 5 cites `<t3>` for M16 in the wave-25 plan.

### Task 4: two jobs per workflow, and the guard that holds them (D-6647, D-6648, D-6651 to D-6655, D-6657, D-6658, D-6660)

**Files:**
- Create: `server/test/workflowJobs.ts`, `server/test/release-job-boundary.test.ts`
- Modify: `.github/workflows/release-main.yml:1-9`, `:61-143`; `.github/workflows/release.yml:1-13`, `:20-103`
- Modify: `server/test/build-release.test.ts:552-579`, `:665-685`, `:748-764`; new rows in the two workflow describes

**Interfaces:**
- Consumes: Task 3's `receive` line, Task 2's `record` and `verify` lines.
- Produces (`server/test/workflowJobs.ts`, parsing with `yaml`'s `parse` and `{ uniqueKeys: true }`):
  - `export interface WorkflowStep { keys: string[]; name: string | null; id: string | null; uses: string | null; run: string | null; with: Record<string, unknown>; env: Record<string, unknown>; if: string | null }` — `keys` is every key the step carries, as written.
  - `export interface WorkflowJob { id: string; keys: string[]; permissions: unknown; needs: string[]; if: string | null; runsOn: unknown; uses: string | null; with: Record<string, unknown>; outputs: Record<string, unknown>; env: unknown; defaults: unknown; steps: WorkflowStep[] }` — `env` and `defaults` are `undefined` when absent.
  - `export interface WorkflowFile { permissions: unknown; env: unknown; defaults: unknown; callOutputs: string[]; jobs: WorkflowJob[] }` — the workflow-level keys, the names under `on.workflow_call.outputs` (empty when none), and the jobs in file order.
  - `export function workflowFile(src: string): WorkflowFile` and `export function workflowJobs(src: string): WorkflowJob[]` (its `jobs`); `needs` normalised to an array.
  - `export const BUILD_MARKERS: RegExp`, D-6655's list, word-bounded.
  - `export function isBuildJob(job: WorkflowJob): boolean` and `export function isWriteJob(job: WorkflowJob): boolean`.
  - `export interface WriteAllowance { uses: readonly string[]; runs: readonly string[]; needsIn: readonly string[] }`: the action names without `@version`; the exact trimmed run bodies; and the places a `${{ needs.` expression may appear, written `with.name` (the download's) or `env.<KEY>`.
  - `export const WITH_KEYS: Readonly<Record<string, readonly string[]>>`: D-6655's exact `with:` key sets per allowed action.
  - `export function boundaryFindings(src: string, allow: Readonly<Record<string, WriteAllowance>>, readCalled: (uses: string) => string | null): string[]`: one plain sentence per breach, naming the job, empty when the file holds. `readCalled` returns a called workflow's source for a local `./.github/workflows/<f>.yml`, or null. The sentences start with `job <id>` or `the workflow`, and contain these phrases, which the planted cases match:
    - classification: `runs the install or the build and holds <key>: <value>`; `can mint an OIDC token`; `declares no permissions of its own`; `runs the install or the build and its checkout keeps its credential`; `grants write at workflow level`; `runs on <value>, not ubuntu-latest`; `holds a write permission and is not on the allowlist`;
    - a write job's steps: `holds a write permission and uses <action>`; `holds a write permission and runs a step outside its allowlist: <first 80 chars>`; `holds a write permission and calls a workflow`;
    - what chooses a write job's code: `gives <action> the with: key <key>, outside its set`; `holds a write permission and carries the job key <key>`; `holds a write permission and step <n> carries the key <key>`; `holds a write permission and step <n> sets <KEY>`; `the workflow carries <env|defaults> beside a write job`; `passes a build output into <with.<k>|env.<K>> of step <n>`;
    - references: `refers to steps.<id>, which no earlier step of this job declares`; `refers to needs.<j>, which is not in its needs`; `refers to needs.<j>.outputs.<k>, which job <j> does not declare`; `calls <uses>, which this guard cannot read`.

- [ ] **Step 1: Write the guard and its rows** in `release-job-boundary.test.ts`. `readCalled` reads the named file from the repository's `.github/workflows/` and returns null for anything else. `ALLOW` is keyed by file then job:
  - `release-main.yml` → `publish`: uses `actions/checkout`, `actions/download-artifact`, `actions/attest-build-provenance`; runs exactly the receive line (Task 3's Produces) and `bash deploy/release-main.sh publish --out release-out`; `needsIn` is `with.name`, `env.CCRC_BUILD_TAG` and `env.CCRC_BUILD_DIGEST`.
  - `release.yml` → `publish`: the same three uses; runs the `verify` line (`bash deploy/release-artifact.sh verify --tag "$GITHUB_REF_NAME" --digest "$CCRC_BUILD_DIGEST" --in "$RUNNER_TEMP/release-in" --out release-out`), and the three moved bodies byte for byte (`release.yml:86-87`, `:96`, `:103`); `needsIn` is `env.CCRC_BUILD_DIGEST`.
  - `release-stable.yml` → `promote`: uses `actions/checkout`; runs `bash deploy/release-stable.sh`; `needsIn` is empty (its job `if:` reads `needs.*` as a condition, not as a value, `release-stable.yml:95`).

  Rows:
  - **W26-G1:** `it.each` over the three files: `boundaryFindings(src, ALLOW[file], readCalled)` equals `[]`.
  - **W26-G2:** non-vacuity: in `release-main.yml` and `release.yml`, `build` is the only build job and `publish` the only write job; in `release-stable.yml`, `full` is a build job and `promote` the only write job; every file parses to at least two jobs; `release-stable.yml`'s `needs.full.outputs.verdict` resolves through `ci.yml`'s `callOutputs` (`ci.yml:84-85`).
  - **W26-G3:** in `release-main.yml` and `release.yml`, the job ids are exactly `['build', 'publish']` in that order; `publish.needs` is `['build']`; `actions/attest-build-provenance` and `actions/download-artifact` appear in `publish` only, and `actions/upload-artifact` in `build` only.
  - **W26-G4:** the planted cases, `it.each` of `[name, yaml, phrase]`, each a two-job workflow differing from a clean base (a `build` job and a `publish` job in the release-main shape, with an `ALLOW` of its own) in one place, each expecting a finding that contains its `phrase`, and the clean base itself expecting `[]`. Case, then the phrase it must match:
    - build job with `contents: write` → `runs the install or the build and holds contents: write`; with `id-token: write` → `can mint an OIDC token`; with no `permissions` → `declares no permissions of its own`; with `permissions: write-all` → `runs the install or the build and holds`;
    - build checkout with no `persist-credentials`, and with `persist-credentials: true` → `its checkout keeps its credential`;
    - a called-workflow job with `contents: write` → `holds a write permission and calls a workflow`;
    - publish running each marker: `cd server && npm ci`, `npm install`, `npm run build`, `npx tsc`, `pnpm i`, `yarn`, `bash deploy/build-release.sh --out o`, `bash deploy/release-main.sh prepare --out o` → every one `runs the install or the build and holds` (never the allowlist phrase, so G-o is measurable);
    - publish using `actions/setup-node@v4`, and `actions/cache@v4` → `holds a write permission and uses`; running `node server/scripts/fix-node-pty-helper.mjs` → `outside its allowlist`;
    - the publish checkout with `ref: ${{ needs.build.outputs.tag }}` → `gives actions/checkout the with: key ref, outside its set` (a second finding, `passes a build output into with.ref`, is allowed); with `repository: x/y` → `outside its set`; the download with `github-token: x` → `outside its set`;
    - publish with a job-level `env:` mapping `BASH_ENV: x` → `carries the job key env`; with `defaults:` → `run:` → `shell: bash --rcfile x {0}` → `carries the job key defaults`; with `container: node:22` → `carries the job key container`;
    - a workflow-level `env:` mapping `NODE_OPTIONS: x`, and a workflow-level `defaults:` → `run:` → `shell: sh` → `the workflow carries`;
    - a publish step whose `env:` sets `BASH_ENV`, `PATH`, `GIT_CONFIG_GLOBAL` or `LD_PRELOAD` → `sets`; a publish step with `shell: bash` → `carries the key shell`;
    - a publish step `env:` value `${{ needs.build.outputs.tag }}` under a key `needsIn` does not list → `passes a build output into env.`;
    - the build job's `outputs:` naming `steps.recrod.outputs.digest` (no such id), and the record step without its `id` → `which no earlier step of this job declares`; a publish `env:` value reading `needs.build.outputs.digests` → `which job build does not declare`; reading `needs.other.outputs.x` → `which is not in its needs`;
    - a workflow-level `permissions: write-all` → `grants write at workflow level`; a job with `runs-on: self-hosted` → `not ubuntu-latest`; a write job named `release` that the allowlist does not know → `is not on the allowlist`.
  - **W26-G5:** references resolve, over the three files: every `steps.<id>.outputs.<k>` and every `needs.<j>.outputs.<k>` in a job's `outputs:`, its `if:`, and its steps' `if:`, `with:` and `env:` values is resolved as D-6655 states, and `boundaryFindings` reports none of the reference phrases. Non-vacuity: the scan finds at least three references in each of `release-main.yml` and `release.yml` and at least two in `release-stable.yml`.
  - **W26-G6:** `isBuildJob` classifies by marker alone: `it.each` over every marker in D-6655's list, a job holding `contents: read` and one `run:` step of that marker is a build job; a job whose only step runs `bash deploy/release-stable.sh` is not.
- [ ] **Step 2: Run it; expect W26-G1 red for `release-main.yml` and `release.yml`** (findings: `job release runs the install or the build and holds contents: write`, `… can mint an OIDC token`, `… its checkout keeps its credential`), W26-G2 and W26-G3 red for those two files, W26-G1 green for `release-stable.yml`, and W26-G4, W26-G5 and W26-G6 green (the base's references, `steps.compare` and `steps.attest`, resolve).
- [ ] **Step 3: Write the workflow rows in `build-release.test.ts`, failing.** Rows that pin a step's whole shape read it through `workflowJobs`, comparing the parsed step to an exact object, so comments stay free and a key added or dropped is red.
  - **The attest-gate row** (`:665-685`, rewritten; D-6658): it keeps `expectAttestingWorkflow`, the three arm lines and their order, the bundle-path and token lines, no `hashFiles`, and the two `not.toMatch` lines; it drops the attest-`if:` pin and asserts instead: the attest step carries no `if:`; the `publish` job's `if:` is exactly `    if: needs.build.outputs.release == 'true'` with nothing appended; the record and upload steps each carry exactly `        if: steps.compare.outputs.release == 'true'`.
  - **W25-Y3** (`:748-764`, amended order): checkout, setup-node, prepare, compare, the decision check, record (`run: bash deploy/release-artifact.sh record `), upload (`uses: actions/upload-artifact@v4`), download (`uses: actions/download-artifact@v4`), receive, attest, publish. Its setup-node check stays on the first setup-node.
  - **W26-Y1** (both workflows): the `build` job's permission block is exactly `contents: read`, at four-space indent, with nothing after it; `build` has `timeout-minutes: 30` and `publish` `timeout-minutes: 10`.
  - **W26-Y2** (both workflows): each checkout's parsed `with:` is exactly: the build job's `{ 'fetch-depth': 0, 'persist-credentials': false }` (so no `ref:`); `release-main.yml`'s publish job's `{ 'fetch-depth': 0 }` (the push needs the persisted credential; D-6647); `release.yml`'s publish job's `{ 'fetch-depth': 0, 'persist-credentials': false }` (D-6653).
  - **W26-Y3:** the upload's `with:` is exactly `name: release-${{ steps.compare.outputs.tag }}` (`release.yml`: `release-${{ github.ref_name }}`), `path:` the two lines `release-out/ccrc-<same expression>.tar.gz` and `release-out/SHA256SUMS`, `if-no-files-found: error`, `retention-days: 7`, `compression-level: 0`; the download's is exactly `name: release-${{ needs.build.outputs.tag }}` (`release.yml`: the upload's name) and `path: ${{ runner.temp }}/release-in`.
  - **W26-Y4:** the receive step is exactly `{ name: "Check the build's artifact and tag it for this commit", env: { CCRC_BUILD_TAG: '${{ needs.build.outputs.tag }}', CCRC_BUILD_DIGEST: '${{ needs.build.outputs.digest }}' }, run: <the receive line> }`; `release.yml`'s verify step likewise with `CCRC_BUILD_DIGEST` alone. The record step is exactly `{ name: "Record the release files' digest", id: 'record', if: "steps.compare.outputs.release == 'true'", env: { CCRC_TAG: '${{ steps.compare.outputs.tag }}' }, run: 'bash deploy/release-artifact.sh record --tag "$CCRC_TAG" --dir release-out' }`; `release.yml`'s is exactly `{ name: "Record the release files' digest", id: 'record', run: 'bash deploy/release-artifact.sh record --tag "$GITHUB_REF_NAME" --dir release-out' }`. Each file has exactly one step with `id: record`, in `build`.
  - **W26-Y5:** `release-main.yml`'s build job `outputs:` is exactly `release: ${{ steps.compare.outputs.release }}`, `tag: ${{ steps.compare.outputs.tag }}`, `digest: ${{ steps.record.outputs.digest }}`; `release.yml`'s is exactly `digest: ${{ steps.record.outputs.digest }}`.
  - **W26-Y6** (D-6658): `release-main.yml`'s build job, at the step immediately after compare, has exactly `{ name: 'Fail when the release decision did not reach the job output', if: "steps.compare.outputs.release != 'true' && steps.compare.outputs.release != 'false'", run: <its one line> }`, where the line is `echo "release-main.yml: the release decision did not reach the job output; failing rather than skipping a release; re-run all jobs" >&2; exit 1`; the file holds that `if:` text exactly once; `release.yml` has no such step.
  - **`release.yml`'s order row** (`:552-579`): build, record, upload, download, verify, attest, "Name the provenance bundle", notes, publish.
- [ ] **Step 4: Run `build-release.test.ts`; expect the new and amended rows red.**
- [ ] **Step 5: Rewrite the two `jobs:` blocks** to the Architecture tables, steps in the order of W25-Y3 and the `release.yml` row, each new `env:` above its step's `run:`, every value a `run:` line needs through `env:` (the run-line scan, `build-release.test.ts:627-651`). Comments:
  - `release-main.yml`'s header (`:1-9`): two jobs, four arms, which arm runs where; the `build` job holds a read token only and cannot mint the signing identity; the `publish` job installs nothing, never opens the tarball, and re-proves the artifact before any write (D-6647, D-6648).
  - Above `build`: why `contents: read` and `persist-credentials: false`, and that prepare's `ls-remote` is anonymous on this public repository.
  - Above the compare step: replace the "not a boundary" sentences (`:113-116`) with: the step runs beside the install and its verdict is untrusted, and the job boundary keeps that from mattering (D-6648).
  - Above the decision check: why a lost decision fails rather than skips (D-6658).
  - Above `publish`: the permission rationale moved from `:67-74`, that the job installs nothing and has no setup-node (D-6651), and that its checkout keeps its credential for the tag push.
  - Above the attest step: the identity sentence kept; "Runs only on an explicit release decision" now refers to the job's `if:`.
  - `release.yml`'s header and job comments to the same effect, keeping D-3127's comment with its step.
  - Words banned in comments: the two files' `not.toMatch`/`not.toContain` lists in Global Constraints (`release-main.yml` never says `build-release.sh`, `release.yml` never says `npm run`, `tsc` or `vite`).
- [ ] **Step 6: Run `release-job-boundary`, `build-release`, `release-main`, `release-artifact`, `oss-metadata`, `workflow-yaml-parses`, `release-stable` and `verify-provenance`, one at a time, until green.**
- [ ] **Step 7: Commit.** `git commit -m "ci(release): the build runs in a read-only job; a publish job that installs nothing attests and publishes (D-6647, D-6648)"`. Record its sha as `<t4>`.
- [ ] **Step 8: Measure B1 to B11 and G-a to G-r at `<t4>`** (B9 and B11 against both files), write the counts into this plan's Mutation table naming `<t4>`, and commit that alone: `git commit -m "docs(plan): wave 26 Task 4's mutation counts at <t4>"`.

### Task 5: what the docs say (D-6647, D-6650, D-6653)

**Files:** `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-18-release-rollout-design.md`, the wave-25 plan. Only after the coordinator relays consent for the README and CLAUDE.md regions.

- [ ] **Step 1: README "The pipeline."** Replace the sentence from "Where it releases" to "the next merge derives past it." (`README.md:760-765`) with:

> The run is two jobs, and only the second holds a write credential. Everything above runs in a `build` job whose token can only read, whose checkout keeps no credential and which cannot mint the workflow's signing identity; where compare releases, it checks that the tarball's `build.json` names this tag and this commit, then hands the tarball and `SHA256SUMS` on as an artifact, with the tarball's digest; a release decision that does not reach the next job fails the run rather than skipping the release. A `publish` job that installs nothing, runs no build script and never opens the tarball then re-derives the tag from its own checkout and refuses unless it matches the build's, the handed-over files are exactly those two, the tarball hashes to the recorded digest, and `SHA256SUMS` is exactly that one line (`release-main.sh receive`). Only then does `actions/attest-build-provenance` sign the tarball's digest with the workflow's own OIDC identity (keyless — the repo holds no signing secret), and `release-main.sh publish` push the tag and publish the tarball, `SHA256SUMS` and the bundle `ccrc-<tag>.tar.gz.sigstore.json` with `gh release create --verify-tag --prerelease`, deleting the tag again if the publish never completes (nothing reaches origin before that push). A merge whose build is unchanged never starts the `publish` job. A hand-pushed `vX.Y.0`/`vX.0.0` tag rides `release.yml` instead — the same two jobs and the same attest step, its identity at the tag — and the next merge derives past it.

- [ ] **Step 2: README "Two trust roots, both named."** After "never installed from the tarball's bytes directly." (`:1027-1028`), add:

> Nor is the release build a root: the jobs that install dependencies and build hold a read-only token and cannot mint the signing identity, and the jobs that hold those install nothing (`server/test/release-job-boundary.test.ts`). The attested bytes are still the build's — the bundle says which run of which commit made them, not that every dependency was benign.

- [ ] **Step 3: CLAUDE.md's Deploy bullet.** Replace "both attest the tarball keylessly and publish the bundle beside it)" (`CLAUDE.md:253-254`) with:

> both attest the tarball keylessly and publish the bundle beside it, each as two jobs: a `build` job with a read-only token and no persisted checkout credential runs every install and build, and a `publish` job that installs nothing and never opens the tarball re-derives the tag, checks the handed-over tarball's digest, and alone holds the write token and the signing identity, which `release-job-boundary.test.ts` holds)

- [ ] **Step 4: The release-rollout spec.** After the wave-25 delta (`:9`), add:

> **Delta, 2026-10-23 (centralised update management wave 26, D-6647, D-6648, D-6653):** `release-main.yml` and `release.yml` each run as two jobs. A `build` job (`permissions: contents: read`, `persist-credentials: false`, no `id-token`) installs and builds and, in `release-main.yml`, compares; on a release it hands the tarball and `SHA256SUMS` on as an artifact with the tarball's digest. A `publish` job (`needs: build`; `contents: write`, `id-token: write`, `attestations: write`) installs nothing and runs no build script: it re-derives the tag, refuses an artifact that disagrees with the recorded digest or its `SHA256SUMS`, without decompressing or parsing it, then attests and publishes. The `build.json` check (version and commit) runs in the `build` job, before the upload. A merge whose build is unchanged never starts it. Where this document gives the main-push job `contents: write` in one job, read the `publish` job. The signing identities are unchanged, because both jobs stay in their workflow file.

- [ ] **Step 5: The wave-25 plan's closure notes and the rows this wave moved.**
  - Under D-6401's "Not a boundary" bullet and under D-6405, one sub-bullet each: `**Closed by wave 26 (D-6647, D-6648):** the install now runs in a job whose token can only read and which cannot mint an OIDC token; the publish job installs nothing.`
  - In "When each row was measured", after the bullet Task 1 wrote, one bullet: "- Wave 26 then changed three targets after their measurement. It removed the attest step's `if:`, the whole target of W1 and A1; their successors are B1 and B2 in the wave-26 plan's Mutation table, measured there at `<t4>`. It reshaped `set_output`, M16's target, which was re-measured in wave 26 Task 3 at `<t3>` (count in the wave-26 table)."
  - Rows W1 (`:228`) and A1 (`:232`): append "(target removed in wave 26; see B1/B2 there)". Row M16 (`:201`): append "(re-measured at `<t3>` in wave 26)".
- [ ] **Step 6: Scan every changed document** with the private-names and topology-clean guards, then commit: `git commit -m "docs(release): the release build holds no write credential (D-6647)"`.

### Task 6: the gate and the PR

- [ ] **Step 1: Landing tip.** `git fetch origin main`. Absorb `origin/main` only on a worker clause 16 trigger, and then only by `git merge`, never a rebase or a force-push (Global Constraints, "The absorb step"); with no trigger the tip stays where it is. Then re-read every anchor named above in the landed text.
- [ ] **Step 2: Touched suites, one file at a time, behind the memory gate.** In `server/`: `release-artifact`, `release-main`, `build-release`, `release-job-boundary`, `release-stable`, `release-notes`, `update-states`, `oss-metadata`, `workflow-yaml-parses`, `verify-provenance`, `ci-pipeline`. This PR touches `.github/`, so CI runs the full server suite (`.github/ci/select-tests.mjs:168`); read the PR's `select tests` summary to confirm.
- [ ] **Step 3: Repo guards.** `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests` (it covers `workflowJobs.ts`), and `GROWTH_CHECK=1 … test/growth-check.test.ts`. First account for the reserve: give each of the block's last four numbers that the wave did not use its own entry, `- **D-<n>** — `unused` (run 858): issued to this wave; no departure took it.` (the wave-25 plan's form, `:465-476`). Then, after `git fetch origin main`, run `deviation-refs`, and check the twenty numbers by the form the ledger's reader sees (`DEFINITION`, `ledger.ts:184`):
  - `grep -cE '^- \*\*D-66(4[7-9]|5[0-9]|6[0-6])\*\* — ' <this plan>` reads 20, and `grep -cE '^- \*\*D-66(4[7-9]|5[0-9]|6[0-6])\.\*\*' <this plan>` reads 0 (no entry in the form the reader cannot see);
  - `git grep -nE '^(- )?\*\*D-66(4[7-9]|5[0-9]|6[0-6])\b' origin/main -- docs/superpowers` prints nothing: no plan or spec on `origin/main` defines any of the twenty, in either form.
- [ ] **Step 4: The wave-done fingerprint.** The `suite:` line follows worker clause 15: `green` or `red` from the FIRST full suite run after the implementation was complete, `unrun` when none ran locally. Per-file runs and CI's full run go in the as-built note.
- [ ] **Step 5: The PR body.**
  - The boundary in one paragraph, and the two job tables.
  - D-6648's choice and what a forged verdict can and cannot do; D-6650's statement of what the split buys and does not.
  - How it was proven before merge (D-6659): the guard, the planted cases, the two-clone fixture, the workflow rows; and that no release workflow ran.
  - The list the coordinator measures on the first release run after the merge (D-6659), and that the landing merge releases by the judges rule.
  - Every pin it changed, named: the attest-gate row, W25-Y3, the `release.yml` order row, W25-C35's third case; and the wave-25 plan's rows it re-measured or re-pointed (X2, X7, X15, X15rc, M16, W1, A1).
  - That the write job never opens the tarball, and the `build.json` check runs in the build job (D-6650).
  - The function and region list of Global Constraints.
  - The Dependabot bump's sequencing.
  - The attribution line this session's reminder gives.

## Readings (for the coordinator to rule; each chosen where no ruling decided it)

1. **Where the comparison runs.** Chosen: the build job, with its read token (D-6648). The alternative, the publish job, gives a trusted verdict at the cost of extracting the build's bytes beside the write token.
2. **A third job.** Not chosen: a `compare` job (`contents: read`, `needs: build`, no install) between build and publish, which downloads the artifact, runs compare from a checkout no install touched, and passes a trusted verdict. It costs one more full-depth checkout (about 12 s) and moves `compare`'s inputs (the candidate) across the artifact boundary, which changes every compare row's harness. The brief asked for two jobs; the third is a follow-up candidate if the coordinator wants the verdict trusted too.
3. **`release-stable.yml`'s `promote` checkout.** Left persisting a credential it never uses (D-6654). Setting `persist-credentials: false` there is a one-line tightening with its own pin changes; a follow-up candidate.
4. **A concurrency group for `release.yml`.** None (D-6662). Joining `release-main`'s group would serialise a hand-cut minor behind a merge's run; today the race refuses safely.
5. **The publish job's node.** The runner's own (D-6651), rather than setup-node without a cache.
6. **`release-notes.mjs` in the write job.** Chosen: it runs there, as it does today in both workflows. It is repository code at HEAD with built-in imports only, not dependency or build-script code, so it is outside the goal's exclusion; moving it to the build job would make the release body the build job's untrusted output.

## Review notes

The first draft of this plan had a review of fifteen findings (two lenses on credential reach, three on release correctness, ten on tests and landing). Each is resolved in the text above. Where a finding offered options, or this plan took only part of its fix, the reason is one line here:
- **The `build.json` read in `verify` (four findings, two lenses).** Fixed by moving it to `record` in the build job, with no 4 KiB cap. Reading 2's read-only compare job could also host the check, but it is not chosen (Reading 2), and the check proves nothing against a hostile build wherever it runs.
- **K10 as an equivalent mutant.** Moot as written: the cap it removed is gone with the read's move. K10 now names `record`'s shape refusal, and W26-A9's reordered-keys case, with the right sha and version, is the one case only that refusal turns away.
- **A lost release decision.** Option 1 taken, a build-side check. Option 2 (`!= 'false'` on the publish job) rejected: a lost `release=false` would then start the write job and mint a token for a merge that releases nothing.
- **What chooses a write job's code.** Fixed, and made stricter than the finding asked: a write job may not carry job-level `env:` or `defaults:` at all, rather than only the named loader keys. Neither publish job needs them.
- **Unresolved `steps.<id>` references (two findings).** Fixed once, as W26-G5 plus planted cases, rather than as two separate rows in two files.
- **The ledger-blind `- **D-<n>.**` form.** Fixed here. At `a802c7669` the same form is used in seven other plans (the wave-25 plan among them) and two specs. That is reported to the coordinator and not edited in this wave, whose region list does not include those files.


## Coordinator rulings on this plan's readings (2026-10-23)

The coordinator read the plan whole and rules as follows. Where a ruling changes a count, a row list or a section,
the worker updates every place the plan states it, in the first task that touches it.

1. **The comparison runs in the build job, with its read token**, as chosen (D-6648). The verdict is untrusted, and
   forging it gives a hostile build only a release of its own bytes or a skip, which it already has.
2. **No third job**, as chosen. A trusted-verdict `compare` job is a follow-up candidate, not this wave.
3. **`release-stable.yml`'s `promote` checkout is left as it is**, as chosen. The stable path has not been rehearsed
   since its last change, so this wave changes nothing there that only a real promotion could test. The guard reads
   it anyway.
4. **No concurrency group for `release.yml`**, as chosen (D-6662).
5. **The publish job uses the runner's own node**, as chosen (D-6651), on one condition: the wave-done names that
   node's version, read from a recent run's log, and says whether `release-notes.mjs` runs on it, measured.
6. **`release-notes.mjs` stays in the write job**, as chosen. It is repository code at HEAD with built-in imports only.
7. **Claims.** Group A has no live claim at the base. Group B waits for consents: README from run 774 (requested in
   mail 8558) and CLAUDE.md from run 722 (mail 8559). The coordinator forwards each answer. If one is refused, or has
   not come when Tasks 1 to 4 are done, that file's edit is split out and the wave-done says so.
8. **Landing.** Wave 24 also edits README, in other regions. First ready lands. The Dependabot branch that bumps the
   workflow actions waits for this wave; it is redone after this wave lands, never merged into it.
9. **The first release run after landing** is the coordinator's to measure, against D-6659's checklist, read-only.
   The worker asks for nothing on a live run and triggers no workflow.
