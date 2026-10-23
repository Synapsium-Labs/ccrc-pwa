# Centralised update management, wave 25: a merge that changes nothing that ships cuts no release: Implementation Plan

On 2026-10-22 the operator ruled, verbatim: "Docs only updates with no changes to code (PRs) should not trigger new build versioning". The coordinator cut wave 25 the same day as run 793 and issued a block of twenty deviation numbers starting at D-6390 (see the programme ledger's wave-25 bullets). Every citation below is `path:line` at the pinned base `93f1c459b`, read with `git show 93f1c459b:<path>`. The worker re-reads each one in the landed text before editing it.

> **Fix round 2 (review 818) redesigned the decision.** A merge now always builds, and a release is skipped only when the build's fingerprint exactly equals the newest contained release's (D-6390, D-6408). Task 1's classifier and guard, and the `decide` and `measure` arms, are retired. The section "Fix round 2: the release decision moves to the built artifact" at the end governs over every earlier section it contradicts; the earlier text stays as the record of what was built and reviewed first.

**What was measured.**
- `release-main.yml` runs on every push to `main` with no path filter (`.github/workflows/release-main.yml:19-21`). So every merge mints a patch tag, a build, an attestation and a prerelease. The ledger records four releases in a row today that were docs- or plan-only merges.
- What a release is built from, and what it is not:

| Read by the build (`deploy/build-release.sh`) | Never read by the build |
|---|---|
| `git archive` of `PATHSPEC` (`build-release.sh:117-120`): `install.sh shared ccd deploy` and the three `package.json`+lock pairs | `docs/` |
| each package's tracked `scripts/` (`:127-129`) | the root's `*.md` and `LICENSE` |
| `npm ci` in `server ui pwa agent` (`:97-100`), each package's `package*.json`, and each package's own install-time scripts (server's `postinstall`, `node scripts/fix-node-pty-helper.mjs`) | `server/test/`, `server/test-e2e/`, `agent/test/` (outside both `tsconfig.json` `include` lists: `server/tsconfig.json:7`, `agent/tsconfig.json:7`) |
| `server`/`agent`: `npm run build` = `tsc` over `src/**/*.ts` and `../shared/**` | |
| `pwa`: `npm run build` = `tsc --noEmit && vite build`; `tsc` over `src test browser spike vite.config.ts vitest.browser.config.ts ../shared` (`pwa/tsconfig.json:24`), then `vite build` over `index.html`, `public/`, `src/`, the CSS it imports (Tailwind `@source` globs, `pwa/src/styles/base.css:26`, `ui/src/styles/theme.css:70`), and `ui/src` through the `@` alias (`pwa/vite.config.ts:99`) and the `file:../ui` dependency | |

- Twelve shipped files are Markdown: the role skills under `ccd/` (`ccd/*-skill/SKILL.md`, `ccd/coordinator-skill/references/*.md`). Two shipped source trees are named `docs`: `pwa/src/docs/` and `server/src/docs/`. So neither "only `*.md` changed" nor "a path segment named docs" means "nothing ships changed".
- `ui/` is a build input (vite reads `ui/src`; `npm ci` reads `ui/package*.json`) and is not in `PATHSPEC`. A positive list of shipped paths copied from `PATHSPEC` would miss it.
- Two `file:` dependencies link packages into each other's `node_modules`: `pwa` → `../ui` and `server` (dev) → `../agent`. No tracked symlink exists anywhere in the tree, and no CSS, HTML or import at the base reaches `docs/` or a test tree.
- No test at the base measures that two real builds of one tree give identical dists. `build.json` (`build-release.sh:169-173`) always differs (`builtAt`), so the tarball digest and `SHA256SUMS` always differ too.

**What already holds.**
- The attest step is skipped when prepare leaves no tarball: `if: hashFiles('release-out/ccrc-*.tar.gz') != ''` (`release-main.yml:81`, pinned at `server/test/build-release.test.ts:677`). Its `bundle-path` output is then empty.
- `publish` (`deploy/release-main.sh:117`) reads the state file before the bundle refusal (`:123-126` before `:141`). So a state that says "nothing built" returns before it refuses a missing bundle.
- The tag derivation (`prepare`, `:77-84`) is the highest release-shaped tag plus one patch. A merge that cuts no tag consumes no number, so nothing renumbers.
- `release-notes.mjs` (`previousReleaseTag`, `deploy/release-notes.mjs:137`) lists first-parent commits from the previous release tag to the new one. The next release's notes therefore cover every merge skipped before it.
- `deploy/release-stable.sh:60-64` already refuses a `stable` HEAD that carries no release tag: exit 2, and `gh` never runs (`server/test/release-stable.test.ts:98-105`). Its message names only "a merge commit" as the cause. `release-stable.yml` runs on the push to `stable` (`:25-27`), so by the time the script refuses, the branch has already moved (`:19-22`), and the ruleset refuses the force push a rewind would need (`release-stable.sh:8-10`, D-3130).
- `release-stable.yml`'s gate already runs a dependency-free module with the runner's own node, with no `setup-node` (`:5-6`, `:56-64`).
- No runtime reader expects one release per merge. The update catalogue (`server/src/update/catalogue.ts`), the resolver (`resolve.ts`), `notify.ts`, the inventory, `ccrc update`/`rollout`/`rollback` (`_upd_resolve`, `ccd/ccrc:20534`), the PWA `BuildLine` and the skew banner (`buildAgreement`, `server/src/fleetstate.ts:244`) all read published releases or measured shas.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this plan's path, the task range, the claim groups and the deviation block.

**Goal:** a merge to `main` whose changed paths, measured from the highest release tag's tree to HEAD's, all lie outside what ships pushes no tag, builds nothing, leaves no attestation and publishes no release. The run says so in one plain line in its log and in the job summary, and its job ends green. Any other merge releases exactly as today. When the decision cannot be measured, or the runner's node is below the repository's engines floor (D-6403), the merge releases and the line says why. A `stable` push of such an unreleased head is still refused, as before (the coordinator's ruling on Reading 6), and the refusal now says what is true: the newest release HEAD contains, that `stable` cannot move back past it, and that the next release cut from a descendant of HEAD promotes by a fast-forward push.

**Spec:** the operator's directive above; `docs/superpowers/specs/2026-09-18-release-rollout-design.md` (decisions 2 and 3) and `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (§4, decisions 2 and 3), both amended by a delta note in this wave.

**Architecture:** a classifier over changed paths (option (a)), deny-by-default, decided in its own workflow step before any toolchain is set up. D-6390 gives the reason for choosing it over measuring the artifact.
- New `deploy/release-scope.mjs`, a dependency-free helper beside `release-notes.mjs`:
  - `NOT_SHIPPED`, the one list of what the build never reads (D-6391);
  - `notShipped(path)`;
  - a CLI that diffs `<base>^{commit}` against `HEAD` with `--no-renames` and answers one line: `unchanged <n>` or `changed <n> <first>` (D-6392, D-6393).
- `deploy/release-main.sh` gains two arms and keeps two:
  - `decide` asks the helper about the highest release tag. Only when the runner's node meets `server/package.json`'s engines floor (D-6403), HEAD's helper AND the base tag's own copy of it both answer `unchanged` (D-6402), and that tag is a published, non-draft release (`gh release view`, D-6392), does it record `same-as <tag>` and write `build=false` to `$GITHUB_OUTPUT`. Anything else records `release`;
  - `measure --base <tag>` prints the same two-helper answer and nothing else, for `release-stable.sh` (D-6398);
  - `prepare` reads the decision after its existing refusals. On exactly `same-as <highest>` it writes a new state word, `built unchanged` / `same-as <tag>` (D-6394), and returns without tagging or building. On anything else it releases as today;
  - `publish` returns on that word before the bundle refusal;
  - every decision prints one line and appends it to `$GITHUB_STEP_SUMMARY` (D-6395).
- `release-main.yml`: a new `decide` step, which holds the job's only `GH_TOKEN` before publish, runs first with the runner's own node. `setup-node` and its npm cache run only when a build follows. The prepare step carries no token. There is no trigger filter (D-6397, D-6401).
- `deploy/release-stable.sh`: a HEAD with no release tag is still refused, exit 2, before any `gh` call. The refusal names the newest release tag HEAD contains, says `stable` now sits past it and cannot move back, and says the next release cut from a descendant of HEAD promotes by a fast-forward push. `release-main.sh measure` only chooses the sentence: nothing that ships changed, or HEAD changed what ships and its release run should be checked (D-6398).
- A guard test derives build-release.sh's inputs from its own text, the package scripts it runs and the configs those read. It goes red when any input would fall under `NOT_SHIPPED`, or when the build grows a shape the derivation does not model (D-6396).
- Prose and copy that say "every merge is a release" are corrected (D-6399).
- `deploy/build-release.sh`, `release.yml`, `deploy/deploy.sh`, `ccd/ccrc`, `ci.yml` and every server, agent and wire file are untouched.

**Deploy class:** release lane and CI only. `release-main.yml` runs the scripts and the workflow of the commit it was pushed for, so the merge that lands this wave is the first decided under the new rule. That merge changes shipped paths (`deploy/`, `shared/`, `pwa/src/`), so it releases, and its log line reads `releasing … what ships changed`. The live proof is the first docs-only merge after it, and the coordinator watches it, not the worker:
- that run's summary shows the skip line;
- no new tag or release appears;
- the run's job conclusion is green, post steps included (`setup-node` is skipped, so nothing has an npm cache to save).

`release-stable.sh` also runs from the checkout, so its new arm is live once this merges. The PWA channel note reaches a box with its next `ccrc update`. No box ordering is needed.

**Landing order, as dependencies:**
- Task 1 (the helper and the guard) depends on nothing.
- Task 2 (the release lane) needs Task 1's helper.
- Task 3 (release-stable) needs Task 2's `measure` arm.
- Task 4 (prose and copy) needs the wording of Tasks 2 and 3.
- Task 5 is the gate and the PR.

One PR, from this workspace's own branch.

## Not in this wave

- Measuring the artifact (option (b)), and measuring whether two builds of one tree give identical dists (D-6390). A later wave may add it as a second check only if that measurement comes out identical.
- Any change to `release.yml`. A hand-cut `vX.Y.0` tag always builds and releases, docs-only or not.
- `ci.yml`'s daily full run and the stable gate's evidence rule (D-6400).
- Moving release-stable's no-tag check into the `gate` job, so an unpromotable push fails before a full run. It is a job change in `release-stable.yml`, not a comment, and a follow-up candidate now that D-6398 keeps refusing every untagged head.
- Filtering skipped `docs(…)` commits out of the next release's notes (D-6400).
- `deploy/deploy.sh`'s `stamp_build` and `ccd/ccrc`'s `_inst_stamp`, `_inst_version_name` and `_inst_floor`. They stay as they are, and only the prose about them changes. Stamping the newest contained release tag when nothing that ships changed is a follow-up candidate (D-6400, Reading 9).
- The `build-release.sh:94` comment "every merge's prerelease would stall". `build-release.sh` stays untouched because `release.yml` shares it, and the sentence still describes what a failing build does to every release.
- Extending `NOT_SHIPPED` beyond D-6391's set (Readings 2 and 3).
- Dated specs that mention the old rule in passing (`2026-09-23-landing-order-and-main-churn-design.md`, `2026-09-20-gpt-lane-ownership-design.md`, `2026-10-01-native-docs-reader-design.md`). They are history and keep their text.

## Global Constraints

- **Files:**
  - Source: `deploy/release-scope.mjs` (new), `deploy/release-main.sh`, `deploy/release-stable.sh`, `.github/workflows/release-main.yml`, `.github/workflows/release-stable.yml` (comments only), `pwa/src/screens/settings/UpdatesSection.tsx`, `ui/src/primitives/radio.stories.tsx`, `shared/api.ts` (one docstring).
  - Docs: `README.md`, `CLAUDE.md`, and delta notes in `docs/superpowers/specs/2026-09-18-release-rollout-design.md`, `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` and `docs/superpowers/specs/2026-10-18-settings-redesign-design.md`.
  - Tests: `server/test/release-scope.test.ts` (new), `server/test/release-main.test.ts`, `server/test/build-release.test.ts`, `server/test/release-stable.test.ts`, `pwa/test/settings-screen.test.tsx`.
  - This plan.
  - NOT touched: `deploy/build-release.sh` (`release.yml` shares it, and a hand-cut tag must always build), `release.yml`, `ci.yml`, `deploy/deploy.sh`, `ccd/`, `.github/ci/`.
- **Functions this wave edits** (the consent list, by file):
  - `deploy/release-main.sh`: the header (`:1-27`), `usage` (`:33`), the argument loop and its checks (`:36-53`), `prepare` (`:56-103`), `publish` (`:117-178`) including the notes comment (`:151-155`), and the arm dispatch (`:180-183`). New `say`, `set_output`, `derive_tags`, `scope_ask`, `node_floor_ok` (D-6403), `measure_change`, `base_published`, `decide`, `measure` and `decision_in_tree` (D-6404), placed between the `SHAPE=` line (`:53`) and `prepare`.
  - `deploy/release-stable.sh`: the header (`:1-12`), the zero-tag refusal (`:59-64`), whose message names the newest contained release (D-6398).
  - `.github/workflows/release-main.yml`: the header (`:1-16`), the steps from `setup-node` to prepare (`:57-70`), and the attest step's comment (`:72-78`).
  - `.github/workflows/release-stable.yml`: the header sentences "the gate runs one dependency-free module with the runner's own node" (`:5-6`) and "the script refuses an untagged merge HEAD" (`:7-8`), comments only.
  - `deploy/release-scope.mjs` (new): `NOT_SHIPPED`, `notShipped`, `changedPaths`, `decide`, `main`.
  - `shared/api.ts`: the `UpdateChannel` docstring (`:9342`), comment only.
  - `pwa/src/screens/settings/UpdatesSection.tsx`: `CHANNEL_NOTES.dev` (`:70`).
  - `ui/src/primitives/radio.stories.tsx`: the `dev` option label (`:65`).
- **Claims, in groups, each taken all-or-nothing when its group frees.** Re-read the live claims before each group with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A, now: `deploy/release-scope.mjs`, `deploy/release-main.sh`, `.github/workflows/release-main.yml`, `server/test/release-scope.test.ts`, `server/test/release-main.test.ts`, `server/test/build-release.test.ts`.
  - Group B, now: `deploy/release-stable.sh`, `.github/workflows/release-stable.yml`, `server/test/release-stable.test.ts`.
  - Group C, after Tasks 2 and 3: `README.md`, `CLAUDE.md`, the three specs above, `pwa/src/screens/settings/UpdatesSection.tsx`, `pwa/test/settings-screen.test.tsx`, `ui/src/primitives/radio.stories.tsx`, `shared/api.ts`. Task 4's README row in `server/test/release-scope.test.ts` rides Group A's claim, which this run still holds.

  If another run's live claim covers `README.md`, `CLAUDE.md` or `shared/api.ts`, Group C waits for that claim to end, or for that run's consent through the coordinator. Every Group C edit is a local in-place rewording, listed in Task 4.
- **The shell pins `release-main.test.ts` already holds stay green** (`:330-347`): `set -euo pipefail`; `sort -V`; the literal `deploy/build-release.sh" --out "$OUT_DIR"`; no `npm ci`/`npm run`; the named argv `"$tarball" "$sums" "$bundle" --verify-tag --prerelease --notes-file "$notes"`; and no `git … log` anywhere in the script. The helper uses `git diff`, and the script uses `git show` for the base's helper, never `git log`.
- **The release-stable pins stay green** (`release-stable.test.ts:217-228`): no `build-release.sh`, no `npm ` and no `gh release create` in `release-stable.sh`; the two edits stay two calls on `"$TAG"`.
- **The workflow pins stay green** (`build-release.test.ts:626-716`):
  - no `${{` and no `github.event` inside any `run:` body;
  - the trigger regex;
  - the order prepare, then attest, then publish;
  - the literal attest `if:`;
  - **`release-main.yml`, comments included, never contains `npm ci`, `npm run`, `build-release.sh` or `gh release`** (`:686-687`). Every new comment is written to that rule; Task 2 Step 5 gives their exact wording;
  - `GH_TOKEN: ${{ github.token }}` is still present;
  - the first multi-line `cache-dependency-path` block names exactly the four lockfiles (`:691-716`).

  Each new `env:` block goes above its step's `run:`, never inside it. `oss-metadata.test.ts:150` (no `secrets.` in `release-main.yml`) holds, since the token is `github.token`, and so does its timeout rule. `verify-provenance.test.ts`' signing identity `release-main.yml@refs/heads/main` holds: the file is not renamed.
- **The helper runs on two nodes.** The `decide` step and `release-stable.yml`'s `promote` job run it with the runner's own node, as the gate's `main-artifact.mjs` already runs (`release-stable.yml:5-6`). So `release-scope.mjs` imports only `node:child_process`, `node:path`, `node:url` and `node:process`, and uses no syntax newer than ES2022. If that node is missing or too old, the run reads as unmeasured and releases (D-6393).
- **One tag shape.** The helper never spells a tag regex. It receives the base tag from the script, which already checked it against `SHAPE` (`release-main.sh:53`, held equal to `isReleaseTag` by `update-states.test.ts:125-128`, and spelled once per `single-definition.test.ts:3766`).
- **No numeric citation in any added code or test line** (`citations.test.ts`; its corpus is every file outside `docs/`). Cite `release-main.sh#decide` or a describe name. This plan's `path:line` anchors are for reading only.
- **Hermetic tests.** Fixture repos under `mkTmp` with a bare `origin`, the poisoned `curl`, and the recording `gh` and `npm` stubs (`release-main.test.ts:98-120`). No network, no real `gh`. `run()` sets `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` before `extraEnv`. Without that, a CI test job would append fixture lines to its own real job summary and outputs (D-6395). Every spawn of the helper or of git carries `GIT_ENV`, so a developer's global git config never changes an answer.
- **Memory and vitest.** Run ONE file at a time, in the foreground, from inside the package, with `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, wrapped in `timeout -s INT 560`. Use a short real TMPDIR (`mkdir -p ~/.cc-tmp/w25`). Never use bare `npx vitest`. Read the session slice's `anon` in `memory.stat` first, and run nothing above the programme's gate.
- **The absorb step.** Before each task's first edit, run `git fetch origin main` and re-read every anchor that task names in the landed text. Absorb `origin/main` only on worker clause 16's triggers, with `git merge`, never a rebase or a force-push. The coordinator lands the PR.
- **Public repo.** Commits use the noreply identity. No hosts, IPs, home paths, lane, account or session names in code, comments, commits or the PR body. Write "the server box" and "the fleet box".
- **Routing.** Execute natively, inside the subscription, with no handoff. Pass the model explicitly on every subagent:
  - implementer subagents run on `sonnet`, one per task;
  - the per-task reviewer and the whole-branch reviewer run on `opus`, with a security lens on Task 2 (a token in a workflow step);
  - scouts and transcription-grade edits (Task 4's copy) run on `haiku`.

  The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip. The `suite:` line follows worker clause 15 (Task 5 Step 4).

## Review Focus

- **A shipped Markdown file or a shipped tree named `docs`.** A change to `ccd/worker-skill/SKILL.md`, `pwa/src/docs/*` or `server/src/docs/*` must release. Rows W25-S1 and W25-R3.
- **A rename across the boundary.** Moving `deploy/x.sh` to `docs/x.sh` removes a shipped file. With git's rename detection, `--name-only` lists only the new path, and the merge would look docs-only. It must release. Row W25-S6.
- **A failed release followed by a docs-only push.** A code merge whose release run failed, followed by a docs-only merge, must release. The diff runs from the highest tag to HEAD, never over the push's own range. Row W25-R5.
- **A merge that changes the classifier.** HEAD's helper may be the defect. The base tag's own copy of the helper must agree before anything skips. Rows W25-R15 and W25-R16.
- **The token.** `GH_TOKEN` sits only in the `decide` step's environment and in publish's, as before. `decide` runs bash, git, gh and the first-party helper, and installs nothing. No step that runs `npm ci` holds it. Rows W25-Y2, W25-Y4 and W25-R14.
- **A mode-only change to a shipped executable.** 48 shipped files are mode 100755. A chmod changes no content but must release. Rows W25-S7 and W25-R6.
- **The untagged-HEAD refusal.** `release-stable.sh` never promotes a tag that is not at HEAD. Its refusal names the newest contained release, never as a push target, prints no rewind or force command, and makes no `gh` call whatever `measure` answers. Rows W25-T1 to W25-T7.
- **The node floor.** `decide` and `measure` never trust the runner's node below `server/package.json`'s engines floor, or when either version cannot be read. Rows W25-R20 to W25-R22.
- **The guard's model of the build.** Every read build-release.sh spells through `"$ROOT"`, every package script npm runs, and every CSS, HTML, triple-slash and `file:`-dependency path is either modelled or refused. Rows W25-G3 to W25-G6.

## Risk notes

- **Toolchain drift is invisible to a skip.** Node is resolved from `server/package.json`'s engines range (`release-main.yml:59`), so it can drift with no commit. A skipped merge never rebuilds. That is accepted: the published release is a build of a byte-identical shipped tree, and a drifted rebuild of the same source is not a change the operator asked to release.
- **A build input the guard cannot see.** The guard models build-release.sh's reads spelled through `"$ROOT"`, the package scripts npm runs for each package it installs, each package's `tsconfig.json` (`include`, `paths`, `rootDirs`, `typeRoots`), the vite configs' `new URL(…)` targets, `file:` dependencies, tracked symlinks, and the relative paths in every input JS/TS, CSS and HTML file. It does not see a read through a computed path, a read in build-release.sh not spelled through `"$ROOT"`, or a third-party dependency's own install script. Deny-by-default keeps this narrow: only `NOT_SHIPPED` can skip, and none of it is a build input at the base (W25-G2, W25-G5, W25-G6).
- **Needless releases remain, by design.** These fail toward releasing (D-6400 lists them): nested docs, root dotfiles, `pwa/test`, the vitest configs, a docs merge while the highest tag has no published release, and a docs merge during a `gh` or API outage.
- **A hand-cut minor whose `release.yml` run is in flight or failed.** `gh release view` answers no release, so release-main releases the next patch of the same tree. That is what it does today.
- **A yanked highest release.** A docs-only merge after it releases nothing new. Today it would re-release the same code under a new number, so nothing is lost.
- **The checkout token in `.git/config`, and the OIDC request token (D-6405).** `actions/checkout` persists its token in the local git config, so `npm ci` lifecycle scripts can already read one today. This wave adds no token to any step that runs `npm ci`. The new `GH_TOKEN` lives in the `decide` step, which runs only first-party code plus git and gh (D-6401).
- **A test-only fix after a red stable gate.** A release whose gate goes red on a broken test is fixed by a test-only merge, which cuts no release. Under the ruling on Reading 6 nothing is promotable until a release contains that fix: the next merge that changes what ships, or a hand-cut `vX.Y.0` tag, which `release.yml` always builds. Pushing the fix's own commit to `stable` is refused, and the refusal says so (D-6398).
- **Paths in the job summary.** The first shipped path is printed JSON-quoted into the log and the summary. `JSON.stringify` escapes quotes and control characters, not Markdown, so a merged path shaped like a Markdown link or image renders as one in the summary. Paths come from merged commits (write access), every line starts `release-main.sh:` so no workflow command can be smuggled, and GitHub sanitises summaries.

## Mutation table

> Fix round 2 (review 818, ruling 8) re-measured this table whole for the artifact comparison and the docs trigger; fix round 3 (review 842, F8) added its rows and corrected its count. The first design's rows are in git history at `4ca88f61e`.

Each guard, the mutation that removes or weakens it, and the rows that went red. Each mutation was applied alone, its whole test file was run once, and the file was restored byte-identical. The runs were sequential, because the release fixtures copy `deploy/` at test time.

**When each row was measured:**
- `release-main.test.ts`: the M rows at `cfa826d92`; the X rows (review 842) at `48828c125` plus the round's rows.
- `build-release.test.ts`: the W, A and F1 rows at `cfa826d92`; the F7 rows (review 842, the thirteen mutations of the behavioural W25-F2) at `48828c125` plus the round's rows.
- `release-stable.test.ts`: the S and Y rows at `a4ab632fa`.
- `settings-screen.test.tsx`: P1 at `a5498cb54`.
- Neither the targets nor the rows of an earlier measurement changed after it was taken.

**The count.** This table has 75 rows, and none survived.
- The fix-round-2 table had 46 rows, not the 50 its wave-done gave.
- "No survivors" speaks for the listed rows only. Three guards still have no row, below.

**Measured, then strengthened.** Y6 (an empty diff counted as docs) survived its first run, and W25-T1d was added for it. M22 was an equivalent mutant, so the redundant top-level gate it targeted was removed, and M22′ is its measurable form.

**Readable rows** (review 818, F11 and F13): the `say` and `set_output` mutations are M15 and M16, and P1 restores the channel note's row.

**Builder rows that also red.** Under F7 (c), (e), (f), (h), (j), (k), (l) and (m), nine other builder rows also red, only because their fixtures lack the added path. W25-F2 is the row that pins the property.

**Guards with no row** (review 842, F8), each named with the reason it has none:
- **(ii) The two extraction-failure arms in `judge`.** The outcome is unchanged without them: an empty tree is an empty fingerprint, which releases. Only the reason in the line differs.
- **(iv) publish's HEAD check on `built true`.** It is backstopped by publish's tag-at-HEAD check, which refuses any HEAD that no longer carries the tag.
- **(v) prepare's `git tag -d` after a failed build, and prepare's own dirty-tree refusal.** Both predate this wave. `build-release.sh`'s identical refusal masks the second.

| File run | Mutation | Red rows, as measured |
|---|---|---|
| `release-main.test.ts` | M1 compare forced equal | W25-C2 (content change), W25-C3 (mode-only), W25-C4 (symlink target), W25-C5 (added entry), W25-C6 (removed entry), W25-C7 (build.json other key), W25-C13 (revert merge), W25-C22 (--out inside checkout, shipped merge), W25-C23 (monotonic), W25-C24 (directory mode), W25-C25 (nested build.json), W25-P1 (spellings) |
| `release-main.test.ts` | M2 wider exclusion (build.json key list + ref) | W25-C7 |
| `release-main.test.ts` | M3 wider exclusion (MANIFEST body emptied) | W25-C2, W25-C5, W25-C6, W25-C13, W25-C23, W25-C25 (nested build.json) |
| `release-main.test.ts` | M4 mode dropped | W25-C3, W25-C24 |
| `release-main.test.ts` | M5 link target dropped | W25-C4 |
| `release-main.test.ts` | M6 the two empty-fingerprint checks deleted | W25-C8 (both sides), W25-C8 (candidate only) |
| `release-main.test.ts` | M7 base not limited to contained tags | W25-C11 (side-branch tag), W25-P1 |
| `release-main.test.ts` | M8 draft check removed | W25-C10 ({"view":"true"}) |
| `release-main.test.ts` | M9 checksum check removed | W25-C12 (checksum mismatch) |
| `release-main.test.ts` | M10 self-approval guard removed | W25-C14, W25-C14b |
| `release-main.test.ts` | M11 the skip keeps the local tag | W25-C1, W25-C23 |
| `release-main.test.ts` | M12 publish's head check on the unchanged branch removed, anchored on the unchanged branch's `die` line | W25-C16 (state bound to its HEAD) |
| `release-main.test.ts` | M13 publish accepts an undecided build | W25-C17 |
| `release-main.test.ts` | M14 the attest tripwire removed | W25-C18 |
| `release-main.test.ts` | M15 say's guard removed | W25-C19 |
| `release-main.test.ts` | M16 set_output's guard removed | W25-C19 |
| `release-main.test.ts` | M17 a skip leaves the candidate in the attest glob | W25-C1 |
| `release-main.test.ts` | M18 the first-path rule reverted | W25-C2, W25-C5, W25-C6, W25-C13, W25-C23, W25-C25 |
| `release-main.test.ts` | M19 compare's head check removed | W25-C16 |
| `release-main.test.ts` | M20 a skip says release | W25-C1 |
| `release-main.test.ts` | M21 the provisional tag not excluded from the base | 38 rows red: W25-C1 to W25-C14, W25-C14b, W25-C16, W25-C19, W25-C20 (x5), W25-C22, W25-C23, W25-C24, W25-C25, W25-C26, W25-C27 (x2), W25-P1 |
| `release-main.test.ts` | M22′ nested normalisation (`path.basename(rel) === 'build.json'`) | W25-C25 (nested build.json whose sha differs) |
| `release-main.test.ts` | M23 directory mode dropped (`'755'`) | W25-C24 |
| `release-main.test.ts` | M24 the no-top-level build.json and MANIFEST throw deleted | W25-C26 |
| `release-main.test.ts` | M25 `at.length !== 1` to `> 1` | W25-C27 (base MANIFEST with no build.json line) |
| `release-main.test.ts` | M26 D-6502 never fires (`contained=""`) | W25-C28 |
| `release-main.test.ts` | M27 publish's contained branch without its head check | W25-C28 |
| `release-main.test.ts` | X1 (F2): `fs.lstatSync(full)` to `fs.statSync(full)` | W25-C29 (1 of 87) |
| `release-main.test.ts` | X2 (F3): `st.mode & 0o7777` to `st.mode & 0o777` | W25-C30 setuid file, W25-C30 sticky directory (2 of 87) |
| `release-main.test.ts` | X3 (F4): skip names starting with `.` in the walk | W25-C31 (1 of 87) |
| `release-main.test.ts` | X4 (F5): delete the `git diff against $base failed` line | W25-C32 (1 of 87) |
| `release-main.test.ts` | X5 (F5): guard diff `"$base" HEAD --` to `HEAD~1 HEAD --` | W25-C33, W25-P1 (2 of 87) |
| `release-main.test.ts` | X6 (F6): `tag --contains HEAD \| newest` to `\| tail -n1` | W25-C34 x4 (vnext and v1.2.3-rc1, each on HEAD and on a descendant) (4 of 87) |
| `release-main.test.ts` | X7 (F8 i): delete the listing-failure block after comm/awk | W25-C35 (1 of 87) |
| `release-main.test.ts` | X8 (F8 iii): `!= false` to `= true` | W25-C36 x3 (empty, null, garbage) (3 of 87) |
| `release-main.test.ts` | X9: delete the gh release download exit check | W25-C12 (the failed-download case) (1 of 87) |
| `release-main.test.ts` | X10: delete the `-z "$BASE"` check | W25-C9, W25-C11 (2 of 87) |
| `release-main.test.ts` | X11: delete the gh release view exit check | W25-C10 (the viewExit 1 case) (1 of 87) |
| `release-main.test.ts` | X12: delete publish's `merge-base --is-ancestor` check on `built unchanged` | W25-C16b (1 of 87) |
| `build-release.test.ts` | W1 attest `if:` deleted | "runs prepare, compare, attests, then publish ... (D-3122, D-6499)" (no W25 id) |
| `build-release.test.ts` | W2 GH_TOKEN env on prepare | W25-Y4 |
| `build-release.test.ts` | W3 setup-node gated by an `if:` | W25-Y3 |
| `build-release.test.ts` | W4 `continue-on-error: true` on compare | W25-Y2, W25-Y4 |
| `build-release.test.ts` | A1 attest `if:` gets `\|\| always()` | "runs prepare, compare, attests, then publish ... (D-3122, D-6499)" (no W25 id) |
| `build-release.test.ts` | F1a paths-ignore line dropped | W25-F1 |
| `build-release.test.ts` | F1b `'*.md'` to `'**/*.md'` (on the paths-ignore line) | W25-F1 |
| `build-release.test.ts` | F1c `'docs/**'` to `'**/docs/**'` (on the paths-ignore line) | W25-F1 |
| `build-release.test.ts` | F1d `workflow_dispatch:` added under `on:` | W25-F1 |
| `build-release.test.ts` | F1e `paths: ['ccd/**']` added under `push:` | W25-F1 |
| `build-release.test.ts` | F7 (a) PATHSPEC literal gains `"d*"` | W25-F2 only |
| `build-release.test.ts` | F7 (b) PATHSPEC literal gains `d*` | W25-F2 only |
| `build-release.test.ts` | F7 (c) PATHSPEC literal gains `'*.md'` | W25-F2, plus 9 builder rows whose fixtures lack a root Markdown file (git archive fails) |
| `build-release.test.ts` | F7 (d) PATHSPEC literal gains `.` | W25-F2, "assembles ccrc-<tag>.tar.gz holding the layout" |
| `build-release.test.ts` | F7 (e) PATHSPEC literal gains `./docs` | W25-F2, plus 9 builder rows (fixtures lack docs) |
| `build-release.test.ts` | F7 (f) PATHSPEC literal gains `"README.md"` | W25-F2 (a root Markdown entry), plus 9 builder rows |
| `build-release.test.ts` | F7 (g) `PATHSPEC+=("d*")` after the scripts loop | W25-F2 only |
| `build-release.test.ts` | F7 (h) `PATHSPEC+=('*.md')` after the loop | W25-F2, plus 9 builder rows |
| `build-release.test.ts` | F7 (i) `PATHSPEC+=(.)` after the loop | W25-F2, "assembles ccrc-<tag>.tar.gz holding the layout" |
| `build-release.test.ts` | F7 (j) `PATHSPEC+=(./docs)` after the loop | W25-F2, plus 9 builder rows |
| `build-release.test.ts` | F7 (k) `PATHSPEC+=(docs)` after the loop | W25-F2, plus 9 builder rows |
| `build-release.test.ts` | F7 (l) `cp -a "$ROOT/README.md" "$TOP/README.md"` after the archive line | W25-F2, plus 9 builder rows (the copy fails where the fixture has no README.md) |
| `build-release.test.ts` | F7 (m) `cp -a "$ROOT/docs" "$TOP/docs"` after the archive line | W25-F2 (an entry under docs/), plus 9 builder rows |
| `release-stable.test.ts` | S1 a side-branch tag named (`tag --list` for `tag --merged HEAD`) | W25-T3 |
| `release-stable.test.ts` | S2 lexical sort | W25-T4 |
| `release-stable.test.ts` | S3 a gh call before the refusal | an untagged HEAD is exit 2 — a merge commit has no release to promote; gh never runs (§18 row 2), W25-T1, W25-T1b, W25-T1c, W25-T1d, W25-T3, W25-T4, W25-T5, W25-T7 |
| `release-stable.test.ts` | S4 a push command in the refusal | W25-T1, W25-T1b, W25-T5, W25-T7 |
| `release-stable.test.ts` | S5 the run pointer loses its sha | W25-T1, W25-T1c, W25-T1d, W25-T5 |
| `release-stable.test.ts` | S6 a measurement reintroduced (`node -e 0`) | pin: the code (comments aside) calls neither release-main.sh nor node, and measures nothing |
| `release-stable.test.ts` | Y1 docs branch never taken (`if [ "$n" -gt 0 ]` becomes `if false`) | W25-T1b |
| `release-stable.test.ts` | Y2 root anchor widened (`docs/*\|*/docs/*\|*.md` count as docs, no `*/*` arm) | W25-T1c |
| `release-stable.test.ts` | Y3 unreadable note dropped | W25-T5 |
| `release-stable.test.ts` | Y4 any root path counts as docs (`*) ;;`) | W25-T1c |
| `release-stable.test.ts` | Y5 a non-docs path below the root no longer stops the walk | W25-T1, W25-T1c |
| `release-stable.test.ts` | Y6 an empty diff counts as docs (`-gt 0` to `-ge 0`) | W25-T1d |
| `settings-screen.test.tsx` | P1 the old channel note | the labels read spec §11.2's words: auto-install, announce, channel and the macOS row |

## Deviations found

These twenty numbers, starting at D-6390, were issued to run 793. This plan defines all twenty, in order: D-6390 to D-6402 from the coordinator's draft, and D-6403 to D-6409 from the worker's reserve (D-6403 for the ruling on Reading 10; D-6404 and D-6405 for what Task 2's reviews found; D-6406 and D-6407 for review 812's fix round; D-6408 and D-6409 for review 818's). Fix round 2 also defines D-6499 to D-6501, from the block D-6499 to D-6510 issued to this wave for it (D-6502 for the round's review; D-6503 to D-6510 each have an `unused` entry below), and D-6511 to D-6513, the block issued with the operator's docs-trigger amendment. Fix round 2 rewrote D-6390, D-6392, D-6393, D-6398, D-6400, D-6401 and D-6405, and marked D-6391, D-6396, D-6399 (in part), D-6402, D-6403, D-6404, D-6406 and D-6407 superseded where they no longer apply; the amendment marked D-6397 superseded; none was removed.

- **D-6390.** The rule is "a merge whose shipped build would be unchanged cuts no release". It is implemented by measuring the artifact (option (b)): every merge builds, and a release is skipped only when the build's fingerprint (D-6408) exactly equals that of the newest release HEAD contains (D-6392). The path classifier (option (a)) is retired. This inverts the first text, which chose (a).
  - Why: two review rounds (812, 818) found eleven families of build inputs that the static guard (D-6396) passed silently, and the last one put `server/test` into the tarball with the guard green. A model of every way the builder, npm, tsc, vite and Tailwind can read a file has no end.
  - The measurement that decides it: the coordinator compared the tarballs of v0.0.565, v0.0.566 and v0.0.567, three consecutive docs-only merges built by separate CI runs. Across 489 files they differ only in `build.json` (`sha`, `builtAt`, `version`) and in MANIFEST's line for `build.json`. The build is reproducible, which the first text called unmeasured.
  - What the first text weighed against (b), and where each cost now stands:
    - every merge builds (CI minutes, accepted);
    - a merge with a base downloads one tarball with the job token (D-6401);
    - a skipped build is never attested (D-6499);
    - modes come from the extracted tree, not from MANIFEST (D-6408).
  - It fails toward releasing: any outcome but a positive, exact, non-empty match releases (D-6393).
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.
- **D-6391.** `NOT_SHIPPED` holds exactly six rules, each with a `why`: the tree `docs`; every root-level `*.md`; the root file `LICENSE`; the trees `server/test`, `server/test-e2e` and `agent/test`.
  - **Superseded by fix round 2 (review 818):** the path list `NOT_SHIPPED` and `deploy/release-scope.mjs` are retired; the artifact comparison decides (D-6390).
  - Test trees are included on the coordinator's reading ("test-only merges for the same reason"). Each lies outside its package's `tsconfig.json` `include` (`server/tsconfig.json:7`, `agent/tsconfig.json:7`) and outside `PATHSPEC`. A test-only fix after a red stable gate is not promotable until a release contains it (D-6398, the ruling on Reading 6).
  - `pwa/test` is NOT included: `pwa/tsconfig.json`'s `include` names `test`, so pwa's `tsc --noEmit` reads it. A pwa test change can break the build, and it releases.
  - Nested docs are NOT included (`agent/CLAUDE.md`, `ui/README.md`, `pwa/design/`, `.design-sync/`, `.superpowers/`, `.github/pull_request_template.md`). Each is one more rule, and each is the coordinator's call (Reading 3).
  - `.github/` releases: it carries the build's environment (the Node pin, the job env).
  - A tree rule matches the path itself or a path below `<tree>/`, never a sibling with the same prefix (`server/testx/a.ts`, `docsx/a.md`). A root rule matches only a path with no `/`.
- **D-6392.** The base is the newest release-shaped tag HEAD contains: `git tag --merged HEAD`, leaving out the provisional tag `prepare` put on HEAD, through `newest` (the one `SHAPE`, `sort -V`, `tail -n1`).
  - Its release must be published and not a draft: `gh release view <tag> --json isDraft --jq .isDraft` exits 0 and prints exactly `false`.
  - It must carry `ccrc-<tag>.tar.gz` and `SHA256SUMS`. Both are downloaded with `gh release download` into a `mktemp -d` directory outside the checkout.
  - The tarball must match the one line of its own `SHA256SUMS` (`<64 hex>  ccrc-<tag>.tar.gz`).
  - Only the newest contained tag is the base. When it fails a check the merge releases, and an older tag is never tried in its place. So a revert to an older release's content releases too.
  - A tag HEAD does not contain (a hand-cut tag on a side branch) is never a base, whatever its content.
  - Each of these releases, and the line says which: no contained tag, an unpublished or draft release, a missing asset, a failed download, a malformed `SHA256SUMS`, or a checksum mismatch.
  - The highest tag overall still numbers the next release (`derive_tags`, unchanged).
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.
- **D-6393.** Only a positive, exact, non-empty match skips: both fingerprints computed (rc 0), neither empty, and byte-equal. Every other outcome releases, with its reason in the line: a fingerprint that fails, an empty one, an unequal one, an extraction that fails, or any check of D-6392 or D-6409.
  - No exit code means "unchanged". A crashed `node` or `tar` exits non-zero, and that must never read as a skip.
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.
- **D-6394.** The skip has its own state, `built unchanged` then `same-as <tag>`. It never reuses `built false`.
  - **Extended in fix round 2 (review 818):** the state words gain `built candidate` (D-6499) and the `head` key (D-6500). The decision file and its sub-bullet are retired (D-6404).
  - `built false` already means "HEAD was tagged at checkout; release.yml owns it" (`release-main.sh:69`). Folding a second condition into the same value at the prepare/publish seam is the overloaded-null defect this repo forbids.
  - `same-as` is a new key, not `tag`, because the tag it names is not this run's.
  - `publish` returns on `built unchanged` before the bundle refusal, after checking that `same-as` matches `SHAPE`, otherwise it reports malformed.
  - Before writing that state, `prepare` refuses (exit 1, no state written) if any `ccrc-*.tar.gz` already sits in `$OUT_DIR`. The attest step would sign it, and no release would publish it.
  - The decision file `decide` leaves, `$OUT_DIR/release-main.decision`, holds exactly `release` or `same-as <tag>`. `prepare` skips only on exactly `same-as <highest>`, with `highest` derived again. An absent, malformed or stale file releases, and its line says which.
- **D-6395.** Every decision prints one line to stdout and appends the same line to `$GITHUB_STEP_SUMMARY` when that is set and non-empty. A failed append never fails the run: the append is wrapped `{ …; } 2>/dev/null || :`, so an unwritable summary prints no shell error either. The lines are fixed in Task 2's Interfaces, one per outcome.
  - The test harness sets `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` by default, and a row that measures either passes its own file. Without that, a CI test job that inherits the variables writes fixture lines into its own summary and outputs.
- **D-6396.** The guard test derives build-release.sh's inputs from the files the build actually runs, and it fails red in four ways.
  - **Superseded by fix round 2 (review 818):** the static guard and `server/test/release-scope.test.ts` are retired. Its findings in reviews 812 and 818 are moot by deletion (the coordinator's ruling on review 818, item 8).
  - **Overlap.** Every tracked file under a derived input, and every derived input itself, must answer `notShipped === false`.
  - **Unparsed growth.** It throws, and the guard is red, when the build grows a read this derivation does not model:
    - a non-comment line of build-release.sh that contains `$ROOT` and matches none of the modelled shapes (Task 1 Step 2 lists them), or a second `git -C "$ROOT" archive` line;
    - a `PATHSPEC+=` outside the `for pkg in …` scripts loop;
    - a `( cd "$ROOT/` line that is not `… && npm ci …`;
    - a package whose `package.json` `scripts` npm would run differs from the modelled table: the install-time keys (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`) for every installed package, and `prebuild`, `build`, `postbuild` for each one whose line runs `npm run build`;
    - a `file:` or `link:` dependency in an installed package that resolves to anything but another installed package;
    - a `tsconfig.json` with `extends`, `files` or `references`;
    - a vite config with a `publicDir`, `root`, `envDir` or `input` key.
  - **Import escape.** tsc, vite and Tailwind follow paths past `include`. Every relative path in an input source file is resolved, its `?query` stripped, and checked against `notShipped`: JS/TS imports, requires, globs, `new URL(`, `/// <reference path=`; CSS `@import`, `@source` and `url(`; HTML `src=` and `href=`; and a bare specifier naming a `file:` dependency, resolved into that package's directory.
  - **Link escape.** A tracked symlink at or under a derived input whose target resolves to a `notShipped` path.
  - The derivation lives in the test file. The matcher it checks against is the helper's own `notShipped`, so there is one list and one matcher.
- **D-6397.** `release-main.yml` gets no `paths:` or `paths-ignore:` filter, and a pin asserts that.
  - **Superseded by the operator's docs-trigger amendment (2026-10-22):** the trigger carries `paths-ignore: ['docs/**', '*.md']` (D-6511). D-6512 answers each of the three reasons below, and its pin W25-Y1 and the regex trigger row are retired (D-6513).
  - Such a filter would be a second, hand-kept list.
  - GitHub evaluates it over the push's own range, which reintroduces the failed-release hazard of D-6392.
  - The existing trigger regex would let one pass unnoticed (`build-release.test.ts:658`, `m` flag, ends at `$`).
- **D-6398.** `release-stable.sh` still promotes only the release tagged at HEAD (design 2026-09-20 decision 3; the coordinator's ruling on Reading 6). On a HEAD with no release tag it refuses, exit 2, before any `gh` call.
  - The refusal names the newest release HEAD contains (`git tag --merged HEAD`, `SHAPE`, `sort -V`), or says it contains none.
  - It points at release-main's run for HEAD's sha, which printed `built unchanged` or what differed.
  - It claims no measurement. It runs no build, npm, node or `release-main.sh`; the first text's `measure` arm is retired with the classifier.
  - It prints no push, rewind or force command. It says `stable` now sits past that release and cannot move back (fast-forward only), and that the next release cut from a descendant of HEAD is the next commit it can promote.
  - D-3129's count check on HEAD's own tags is unchanged.
  - Consequence, stated: a test-only fix after a red stable gate builds an unchanged artifact and cuts no release. So nothing is promotable until a release contains that fix: the next merge whose build differs, or a hand-cut `vX.Y.0` tag, which `release.yml` always builds.
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.
  - **Amended on review 842:** the refusal tells a head with no release-main run from one with a run. It measures `git diff --name-only HEAD^ HEAD` under the trigger's own root-anchored rule (`docs/**`, and a root `*.md` with no `/`). When every path matches, it says HEAD's merge changed only `docs/` or the root's Markdown, so no release-main run started for it, and it names the newest release HEAD contains. Otherwise it points at release-main's run for HEAD's sha, as before. When HEAD has no parent, or the diff fails, it takes the pointer form and says HEAD's changed paths could not be read. Exit 2, no gh call, and no push or rewind command, as before. W25-T1 is pinned for the pointer case, W25-T1b for the docs case, and W25-T5 (a one-commit HEAD) for the unreadable case (F1).
- **D-6399.** Every text that states "every merge is a release" is corrected in place: README, CLAUDE.md, the two script headers, the workflow headers, the `shared/api.ts` docstring, the PWA channel note with its pin, and the radio story.
  - The three specs get one dated delta note each and keep their sentences. Specs are dated history; a note keeps the decision record honest without rewriting it.
  - The PWA note becomes `Every merge that changes the build, minutes after it lands.` (Reading 5).
  - `NOT_SHIPPED`'s rules are enumerated in exactly one live text, README's pipeline paragraph, and W25-S13 holds it to the helper. CLAUDE.md and the skip line name the list by symbol only. The spec delta notes carry a dated copy as history.
  - **Superseded by fix round 2 (review 818), this sub-bullet only:** with `NOT_SHIPPED` retired, no text enumerates it. The README, CLAUDE.md and the delta notes name the fingerprint comparison instead, and W25-S13 is deleted with its file.
- **D-6400.** Downstream effects that this wave states and does not fix (rewritten in fix round 2 for the artifact comparison; the first text is in git history at `4ca88f61e`):
  - **Gate evidence.** `ci.yml`'s daily full run tests `main`'s head (`ci.yml:214-229`). `isTrustedFullSuiteRun` (`.github/ci/main-artifact.mjs:85-95`) needs the exact sha. Pushing a release's own tag commit to `stable` while `main`'s head is an unreleased merge therefore runs the gate's `full` mode (about an hour). Pushing `main`'s head instead is refused when that head carries no release (D-6398), so while `main`'s head is an unreleased merge a promotion pays the gate's full run. The README says so.
  - **A push to `stable` that cannot promote.** A tagless HEAD still runs the gate, possibly `full`, before `promote` refuses, and it leaves `stable` past the newest release it contains until a later release contains HEAD. The refusal says so.
  - **Unversioned heads, and the lost update floor.** `deploy.sh`'s `stamp_build` (`deploy/deploy.sh:263`) and `_inst_stamp` (`ccd/ccrc:15811-15814`) stamp `version` only from a tag at HEAD. A checkout of an unreleased head therefore stamps none. The PWA shows that box amber (`ui/src/components/build-line.tsx:20-30`), and a source install of it is named `untagged-<sha12>` (`_inst_version_name`, `ccd/ccrc:14301`). `_inst_floor` raises no floor from it (`ccd/ccrc:17772-17779`), and notify counts it behind every release (`server/src/update/notify.ts:89-93`). So a later bare `ccrc update` can move such a box to an older stable release with no `--downgrade` refusal; only the health gate stands behind it. Before this wave `main`'s head carried a tag within about a minute of nearly every merge. Now a README-quickstart clone taken while the head is a docs merge gets no floor. This wave changes the README (Task 4) to point a checkout install at a release tag or `--release`. Stamping the newest contained release tag when compare says `built unchanged` is a follow-up, because it lifts "`ccd/ccrc` and `deploy.sh` untouched" (Reading 9).
  - **Needless releases (fail toward releasing).** These still mint a release whose shipped tree may be identical:
    - a docs merge while the newest contained release is unpublished, a draft, missing an asset, or failing its checksum, or while gh or the API is down;
    - a merge that touches `.github/workflows/release-main.yml` (D-6409);
    - this round's own landing merge, which changes `deploy/` and `.github/`.
    - the first docs merge after a hand-cut `vX.Y.0` minor: `release.yml` builds from a tag checkout, so that release's `build.json` holds `"ref":"HEAD"`, not `"main"`, and `ref` is compared (D-6408). The next main-built release is a valid base again.

    None of these is a comparer miss, and the coordinator should not read one as a miss during the live proof. A docs merge whose base was built by an older builder or toolchain whose output differs (a builder change, a dependency resolved differently, a Node or npm version that changed the dists) also releases. That difference is real: the bytes differ, and the line names the first entry.
  - **Every merge outside the trigger's two patterns builds** (D-6511). A merge that changes only `docs/` or the root's Markdown starts no run at all. Any other merge whose tarball comes out identical, a tests-only merge for one, spends the build's minutes and one tarball download, and attests and publishes nothing.
  - **A failed release followed only by docs merges stays unreleased** until the next merge outside the two patterns, or until someone re-runs the failed run (D-6512). There is no other door: the operator ruled out a manual release button.
  - **Release notes.** The next release's notes list the skipped `docs(…)` commits under "Behind the scenes", within `NOTES_BUDGET_BYTES`. That is correct: the release contains them.
  - **No change.** The update catalogue, the resolver, notify's reading of published releases, the inventory, `ccrc rollout`, `rollback`, `RUNS_ATTRIBUTION_SINCE` (`shared/api.ts:9490-9501`, measured by `git tag --contains`, which still holds) and `landing.ts`.
- **D-6401.** The workflow always builds.
  - **The steps, in order:**
    - `setup-node` runs on every merge; its `if:` is gone;
    - `prepare` (no token) tags locally and builds the candidate;
    - a `compare` step holds `GH_TOKEN` for the published-base check and the download;
    - the attest step runs only on `steps.compare.outputs.release == 'true'`;
    - `publish` holds `GH_TOKEN`, as before.
  - **The token.** `GH_TOKEN` goes only to `compare` and `publish`, never to `prepare`, whose step runs `npm ci`. W25-Y4 pins it, with its mutation row.
  - **Not a boundary.** `compare` runs after `npm ci` in the same job, so it does not stop a hostile dependency. An install script can already reach the checkout credential and the OIDC request token (D-6405), and it could rewrite the files `compare` later runs. The build/release job split is the operator's open follow-up.
  - **No `continue-on-error`.** A `compare` that crashes fails the job before the attest step, and nothing was pushed (D-6499).
  - **The trigger filter** is D-6511's two root-anchored patterns. D-6397 is superseded.
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.
- **D-6402.** `unchanged` needs the base's classifier to agree. After HEAD's helper answers `unchanged`, `measure_change` writes `git show <base>:deploy/release-scope.mjs` into a fresh `mktemp -d` directory and asks that copy the same question. It skips only if both answer `unchanged`.
  - **Superseded by fix round 2 (review 818):** there is no classifier to copy; a comparer changing itself releases unconditionally instead (D-6409).
  - A merge that changes the classifier changes `deploy/`, so the old helper answers `changed`, whatever HEAD's copy says. A defect in HEAD's `notShipped` cannot vouch for its own merge. Once that merge has released, its helper is the next base's, so later merges rest on D-6396's guard and on review, not on this rule (corrected after Task 2's security review). Nor does the rule hold against a hostile merge: `release-main.sh` and the workflow run from HEAD, so a merge that edits `decide` can force a skip whatever either helper says. It guards against an accidental classifier defect.
  - A base with no helper (every tag cut before this wave) is unmeasured, and the merge releases.
  - The temporary directory is removed in the same function, and it is never under `$ROOT` or `$OUT_DIR`.
- **D-6403.** The runner's own node is trusted only at or above the repository's engines floor (the coordinator's ruling on Reading 10). `measure_change`, which both `decide` and `measure` run, first calls `node_floor_ok`. Below the floor, or when either version cannot be read, the answer is `unmeasured`, so `decide` releases and `measure` says so.
  - **Superseded by fix round 2 (review 818):** no step runs the runner's own node any more; `setup-node` always runs, so the floor check is retired with `decide`.
  - The floor is read from `$ROOT/server/package.json`, never written as a second literal: exactly one match of `"node"` followed by `:` and a `">=X.Y.Z"` value. No match, more than one, or another range shape is unreadable.
  - The version is `node --version`, which must exit 0 and print exactly `vX.Y.Z`. The comparison is numeric, field by field, in bash, so `sort -V` stays spelled once (W25-P5).
  - The reasons, carried into the unmeasured line: `node <version> is below server/package.json's engines floor >=<floor>`, `node --version exited <rc>`, `node --version answered '<first 80 chars>'`, and `server/package.json names no readable engines floor`.
  - It sits in `measure_change` rather than `decide` alone, so `release-stable.sh`'s use of `measure` (D-6398) is held to the same floor, with one check and one place.
- **D-6404.** The workflow's `release-out` lies inside the checkout and is not gitignored, so the decision `decide` writes there is an untracked file. Both `prepare`'s dirty-tree refusal and `build-release.sh`'s would refuse every real run on it. The fixtures keep their out directory outside the repository, so no briefed row could see it (found by Task 2's implementer).
  - **Superseded by fix round 2 (review 818):** no decision file is written; `prepare`'s dirty check is the base's `git status --porcelain` again, and the candidate is built under `$OUT_DIR/candidate` (D-6499).
  - `prepare`'s dirty check (`git status --porcelain -uall`) drops exactly one line, `?? <the decision file's path>`, and only when that file lies under the checkout (`decision_in_tree`). A decision directory that is the checkout root itself matches nothing, so it still refuses.
  - On the release path, `prepare` removes the in-tree decision file before `git tag`: it has already read it, and nothing reads it again. So `build-release.sh` sees a clean tree, unchanged.
  - Rejected: gitignoring `release-out/`, which would also relax `build-release.sh`'s refusal of its own leftovers on a local second run, and moving the decision outside the work tree, which would change every row and the README's naming of it. Row W25-R23.
- **D-6405.** Stated, not fixed: two credentials reach every step of `release-main.yml`, prepare's `npm ci` included. Both predate this wave, which neither widens nor narrows them.
  - **The two credentials.** The persisted `actions/checkout` credential (`contents: write`, in `.git/config`): a hostile install script could push with it. The job's OIDC request token (`ACTIONS_ID_TOKEN_REQUEST_*`, in every run step): with it, the script could mint a signing certificate for `release-main.yml@refs/heads/main`, the identity every box's updater verifies.
  - **A third route, stated:** an install script in prepare's `npm ci` can append to `$GITHUB_ENV` or `$GITHUB_PATH` (a `NODE_OPTIONS`, or a `gh`, `tar` or `node` that shadows the real one), and that code then runs inside `compare` and `publish` with `GH_TOKEN`, the fingerprint's `node -e` included. It gains no privilege the persisted checkout credential, the same `github.token`, does not already give it.
  - **Fix round 2 adds a reason to split:** the `compare` step that decides whether to attest runs in the same job after `npm ci`, from files an install script could rewrite (D-6401).
  - **The follow-up** is the operator's open call (the coordinator's ruling on review 818, item 6): a build job with `contents: read`, no `id-token` and `persist-credentials: false` that uploads `release-out/`, then a release job that compares, attests and publishes. `release.yml` shares the shape and the question.
  - Rewritten in fix round 2 (review 818). The first text is in git history at `4ca88f61e`.

- **D-6406.** Three texts this plan dictated word for word are amended to what landed (review 812, F15). Each landed text was chosen in a reviewed fix round, and the plan now says what the tree says:
  - **Superseded by fix round 2 (review 818):** the README copy, the decide comment and W25-Y2's regex it amended are replaced by fix round 2's texts and rows.
  - Task 4 Step 3's README copy: "docs- or tests-only" and "only docs or tests" became "a merge that touches only docs or the server and agent tests", because `pwa/test` and `ui/` changes still release (D-6391); and "the run stops" became "the run builds nothing".
  - Task 2 Step 5's decide comment: the comment that landed says what `GH_TOKEN` serves, that the variables are not passed to the helpers' environment, that the checkout's persisted credential and the job's OIDC request token still reach every step (D-6405), why a failed decide releases, and why the base tag's helper runs HEAD's bytes (D-6402).
  - W25-Y2's regex: it holds the `continue-on-error: true` line between `id: decide` and `env:`.
- **D-6407.** `release-scope.mjs`'s CLI guard compares basenames, `basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))`, not the full-path check `release-notes.mjs` uses (review 812, F10).
  - **Superseded by fix round 2 (review 818):** `release-scope.mjs`, whose CLI guard it described, is deleted.
  - Why: `process.argv[1]` is resolved but not realpath'd, while `import.meta.url` is the realpath. Run through a symlinked path, the full-path form answers rc 0 with empty stdout, the third state D-6393 rules out. The base tag's copy runs from a `mktemp -d` directory, which on macOS sits under the `/var` symlink, so the macOS CI leg would read every base answer as silence.
  - A realpath comparison needs `node:fs`, which the helper does not import (it runs on the runner's own node with the four modules the Global Constraints name).
  - Cost: a script of the same basename that imports the module would run its CLI. No caller has that name. Row W25-S14 runs the helper through a symlinked directory.
- **D-6408.** The fingerprint. One function, `fingerprint` in `release-main.sh`, is applied to both extracted tarballs, and never to the base's embedded MANIFEST.
  - **One line per entry** below the extraction root (the root itself is not an entry): the JSON-quoted path, the type (`f`, `d` or `l`), the octal permission bits, the size, the sha256 of a regular file's bytes, and a link's JSON-quoted target. Any other entry type fails the fingerprint.
  - **Exactly two normalisations,** both at the tarball's top level:
    - `build.json` is parsed as a JSON object and must hold `sha`, `builtAt` and `version`. It loses exactly those three keys and is hashed in a canonical form, keys sorted recursively;
    - `MANIFEST` must hold exactly one line naming `build.json`, and it is hashed without that line.

    For these two, the size is the normalised content's.
  - **Nothing else is normalised:** `ref` and `dirty` in `build.json`, every mode, every link target and every other byte.
  - **Representation, not normalisation** (recorded after the round's review): the extraction root `./` is not an entry; a directory's size is written as 0, since its on-disk size is the filesystem's, not the archive's; a link's size is its target's length; the normalised `build.json` is written as canonical JSON (keys sorted, no whitespace) plus a newline; and a tree with entries but no top-level `build.json` and `MANIFEST` fails the fingerprint, while an empty tree prints nothing, which the caller reads as no match.
  - **Extraction** is `tar -xpzf` into a fresh `mktemp -d` directory outside the checkout. `-p` makes the modes the archive's, not the umask's.
  - **The program.** The function runs under the script's `set -euo pipefail`, and its inline node program reads only `node:fs`, `node:path` and `node:crypto`.
  - **Measured basis:** the v0.0.565/566/567 comparison (D-6390).
  - **Amended on review 842:** three properties the walk already had are now pinned by rows. A link is read with `lstat` and never followed, so a link retargeted between two byte-identical files releases (W25-C29). The mode is the full `0o7777`, setuid, setgid and sticky bits included, which `tar -xpzf` keeps (W25-C30). Dot-named entries are walked like any other (W25-C31) (F2, F3, F4).
- **D-6409.** A comparer never approves its own change. When `git diff --name-only <base> HEAD -- .github/workflows/release-main.yml deploy/release-main.sh` lists anything, or fails, the merge releases unconditionally and the line names the first path.
  - `deploy/release-main.sh` is the compare script: it holds the fingerprint and the decision.
  - `deploy/` ships, so a change there also changes the artifact. This rule covers a comparer broken in a way that would hide that.
  - **Amended on review 842:** the `git diff against <base> failed` arm has a row, W25-C32. And W25-C33 judges a change to `release-main.yml` that is older than `HEAD~1`, so narrowing the guard's range to `HEAD~1 HEAD` reds a behaviour row, not only the spelling pin (F5).
- **D-6499.** The skip is decided after the build, and a skipped build is never attested.
  - **prepare** builds into `$OUT_DIR/candidate/`, outside the attest step's `release-out/ccrc-*.tar.gz` glob, with the provisional tag local only, and records `built candidate` / `tag` / `head`.
  - **compare, on a skip,** deletes the local tag, leaves the candidate where it is, writes `release=false`, and records `built unchanged` / `same-as <base>` / `head`.
  - **compare, on a release,** moves the candidate tarball and `SHA256SUMS` into `$OUT_DIR`, writes `release=true`, and records `built true` / `tag` / `head`.
  - **The attest step** runs only on `steps.compare.outputs.release == 'true'`, an explicit release decision. Its old `hashFiles` condition is gone.
  - **publish** refuses `built candidate` (compare never decided). On `built unchanged` it exits 0 with no push, no gh call and no attestation, so the job ends green on a skip. On `built true` it publishes as before.
  - **A crash between steps releases or fails loudly.** A failed `prepare` or `compare` fails the job before the attest step, and nothing was pushed. `prepare` still refuses an `$OUT_DIR` that already holds a `ccrc-*.tar.gz`, which the attest glob would sign.
  - **Not claimed:** an attested release whose `publish` then fails leaves an attestation with no release, as before this wave. The attest action must run before the publish that carries its bundle.
- **D-6500.** Each state is bound to the HEAD it was measured for (review 818, F10).
  - `prepare` and `compare` record `head <sha>`.
  - `compare` and `publish` refuse a state whose `head` is not `git rev-parse HEAD`.
  - `publish` also checks that `same-as` names a release-shaped tag HEAD contains.
- **D-6501.** The decision prints exactly one line, to the log and appended to the job summary (D-6395's `say`), in one of three forms:
  - `built unchanged: <N> entries identical to <base>`;
  - `differs from <base>: <K> entries, first <path>; releasing <next>`;
  - `could not compare (<reason>); releasing <next>`.

  `<path>` is JSON-quoted, so no line can carry a newline or start a workflow command. These lines carry no `release-main.sh:` prefix, as the coordinator wrote them; the script's other messages keep it.
  - **The first path.** `<K>` counts every differing path, MANIFEST included. `<path>` is the first differing path in the C locale other than `MANIFEST`, and `MANIFEST` only when nothing else differs. MANIFEST's digest lines move with every content change and it sorts first, so without this rule the line would name `MANIFEST` for every content, added or removed entry (found by fix round 2's implementer). Rows W25-C2, C5 and C6 pin it.
- **D-6502.** A HEAD that a release already contains is not released again (found by the round's review).
  - **The hazard.** "Re-run all jobs" on an old run whose merge was skipped derives the next number from the highest tag. Its base is still that merge's own newest contained tag. If the comparison then fails (an outage, a base release since edited or deleted) or the toolchain has drifted, it would release the old content under a number above every newer release.
  - **The rule.** After its already-tagged check, `prepare` asks `git tag --contains HEAD`. When that lists a release-shaped tag, it builds nothing and records `built contained` / `contained-by <newest such tag>` / `head <sha>`. `compare` then writes `release=false` and decides nothing, and `publish` does nothing; both exit 0.
  - **A state word of its own,** not `built false`, which means "HEAD was tagged at checkout; release.yml owns it" (D-6394's rule against an overloaded value).
  - **Amended on review 842:** the shape-only contained check stands, as the review's refuters argued: the lane never leaves a release-shaped tag without its release. A publish that fails deletes its pushed tag, a pushed `v*` tag runs `release.yml`, and nothing makes drafts. W25-C34 pins the shape filter: a tag that is not release-shaped (`vnext`, `v1.2.3-rc1`) and contains HEAD leaves the decision to compare (F6).
- **D-6511.** The trigger. `release-main.yml` runs on exactly `push`, `branches: [main]`, `paths-ignore: ['docs/**', '*.md']`, with no `paths:` key and no other event (the operator's docs-trigger amendment).
  - **What the patterns match.** GitHub's `*` does not cross `/`. So `'*.md'` matches only the root's Markdown, and `'docs/**'` only the root `docs/` tree. The shipped skills under `ccd/` and everything under `pwa/src/docs/` still start the run.
  - **What a match does.** A push in which every changed file matches starts no run: no runner, no build, no release. Any other file in the push starts the normal flow.
  - **GitHub's documented limits.** A push of more than 1,000 commits, or one whose diff times out, always runs. A diff of more than 3,000 files runs only if a non-ignored file is among the first 3,000 the filter returns, so that case can skip a real change. D-6512 shows it is delayed, never lost.
  - **No `workflow_dispatch`:** there is no manual force-release button (the operator's answer 2).
  - **Stated in the workflow.** The comment above the trigger says all of this, and says the list is two root-anchored patterns that are never widened without a ledger entry.
- **D-6512.** Why the filter is safe now, when D-6397 refused it. Each of D-6397's three reasons is answered in turn.
  - **"A second, hand-kept list."** The list is two patterns, and neither decides a release: the fingerprint still decides every run that starts (D-6393). Row F2 pins the patterns disjoint from what the build archives.
  - **"GitHub evaluates it over the push's own range"** (D-6392's hazard). The base is the newest published release HEAD contains, not the push's before. So a push the filter skips, the 3,000-file case included, can only delay a change to the next run that starts. That run's build includes the change and releases it, so nothing is lost or mislabelled.
  - **Said plainly:** a failed release followed only by docs merges stays unreleased until the next merge outside the two patterns, or until someone re-runs the failed run. There is no other door (the operator's answer 2).
  - **"The trigger pin would miss one"** (the old regex row, which stopped at `$`). It is replaced by an exact pin, row F1 (D-6513).
  - **Amended on review 842:** W25-F2 now checks behaviour, not the script's text. It builds the fixture's tarball with the real `build-release.sh`, in a fixture repository that carries `docs/x.md` and a root `README.md`, and asserts that `tar -t` lists no entry under `docs/` and no root `.md`. So it catches every form review 842 listed (array entries in any quoting, a `PATHSPEC+=` after the loop, globs, `.`, `./docs`, and a `cp -a "$ROOT/…"` copy), and the review's thirteen mutations each red it. The workflow comment says the same (F7).
- **D-6513.** The rows, each measured red under its mutation before landing:
  - **W25-F1** (`build-release.test.ts`, `release-main.yml` describe). The `on:` block, read as an exact text block, is exactly the push trigger of D-6511. It goes red if paths-ignore is dropped, if a pattern is widened to `'**/*.md'` or `'**/docs/**'`, if `workflow_dispatch` is added, or if a `paths:` key is added.
  - **W25-F2.** No PATHSPEC entry of `deploy/build-release.sh` is `docs`, sits under `docs/`, or is a root `*.md` file. The entries are parsed from the file, the per-package `scripts/` arm included. It goes red if `README.md` or `docs` is added to PATHSPEC.
  - **Retired:** W25-Y1 (no trigger filter) and the row `'triggers on main pushes and on NOTHING else'`, whose regex stopped at `$`. W25-F1 replaces both.
- **D-6503** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6504** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6505** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6506** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6507** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6508** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6509** — `unused` (run 793): issued to this wave; no departure took it.
- **D-6510** — `unused` (run 793): issued to this wave; no departure took it.


## File structure

- `deploy/release-scope.mjs` (new, Task 1). It imports only `node:` modules. It has JSDoc types so `typecheck-tests` sees the shapes. Its CLI is guarded by comparing the basename of `process.argv[1]` with its own file's (D-6407), not by the full-path check `release-notes.mjs` uses.
- `server/test/release-scope.test.ts` (new, Task 1; one row added in Task 4), with four describes, named as landed (the drafted names are in brackets):
  - `'W25 the rule table'` (drafted `'release-scope.mjs: what is not shipped (W25-a, D-6391)'`);
  - `'W25 the CLI over fixture repositories'` (drafted `'release-scope.mjs: the answer over a real repo (W25-a, D-6392, D-6393)'`);
  - `'W25 the guard: no build input is on the NOT_SHIPPED list'` (drafted `'NOT_SHIPPED never covers what build-release.sh builds from (W25-a, D-6396)'`);
  - `'README names exactly NOT_SHIPPED (W25-d, D-6399)'`.
- `deploy/release-main.sh` (Task 2): new `say`, `set_output`, `derive_tags`, `scope_ask`, `node_floor_ok` (D-6403), `measure_change`, `base_published`, `decide`, `measure` and `decision_in_tree` (D-6404), plus `prepare`, `publish`, the argument loop, the dispatch and the header.
- `.github/workflows/release-main.yml` (Task 2): the `decide` step, the gated `setup-node`, and the comments.
- `server/test/release-main.test.ts` (Task 2):
  - `fixture()`, `plantBin()` and `run()` change as Task 2 Step 1 says;
  - a new describe after `:328`, landed as `'release-main.sh: decide — a merge that changes nothing that ships cuts no release (W25)'` (drafted `'… (W25-b)'`);
  - new pins inside `'release-main.sh: source pins'`.
- `server/test/build-release.test.ts` (Task 2): four rows in the `release-main.yml` describe (`:652`).
- `deploy/release-stable.sh`, `.github/workflows/release-stable.yml`, `server/test/release-stable.test.ts` (Task 3): rows W25-T1 to T7 in a describe of their own, landed as `'release-stable.sh: the refusal of a HEAD with no release tag says what is true (W25, D-6398)'` (drafted: inside `'release-stable.sh: what it refuses'`).
- Task 4: in-place edits, plus the README row.

## Tasks

Tasks 1 and 2 are claim group A. Task 3 is group B. Task 4 is group C. Every test row is a vitest row in the named file.

### Task 1: one list of what never ships, and a guard that holds it against the build (W25-a; D-6390, D-6391, D-6392, D-6393, D-6396)

**Files:**
- Create: `deploy/release-scope.mjs`
- Test: `server/test/release-scope.test.ts` (new)

**Interfaces:**
- Produces:
  - `export const NOT_SHIPPED: ReadonlyArray<{ tree: string, why: string } | { rootExt: '.md', why: string } | { rootName: string, why: string }>`, frozen, holding exactly D-6391's six rules.
  - `export function notShipped(path: string): boolean`: true iff some rule matches a repo-relative POSIX path.
  - `export function changedPaths(repo: string, base: string): string[]`: runs `execFileSync('git', ['-C', repo, 'diff', '--no-renames', '--no-ext-diff', '--name-only', '-z', `${base}^{commit}`, 'HEAD', '--'])`, splits on NUL and drops the empty tail. It throws on a non-zero git exit, and throws before running git when `base` is empty or starts with `-`.
  - `export function decide(paths: string[]): { word: 'unchanged', count: number } | { word: 'changed', count: number, first: string }`.
  - CLI: `node deploy/release-scope.mjs --repo <dir> --base <tag>`. It prints `unchanged <n>` or `changed <n> <JSON.stringify(first)>` plus `\n`, and exits 0. Any thrown error goes to stderr with exit 1 and empty stdout. An unknown or missing argument exits 2 with empty stdout.
- Consumes: nothing.

- [x] **Step 1: Write the failing rows** in `server/test/release-scope.test.ts`. Import `{ NOT_SHIPPED, notShipped, decide }` from `'../../deploy/release-scope.mjs'` (the import style of `history-replay.test.ts`). Repo fixtures use the `GIT_ENV` and `git()` shape of `release-main.test.ts:22-32` under `mkTmp`. The CLI runs through `spawnSync('node', [HELPER, '--repo', root, '--base', base], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' })`, so `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are `/dev/null` and a developer's `diff.renames` cannot change an answer.

```ts
it.each([
  ['docs/a.md', true], ['docs/superpowers/plans/x.md', true], ['README.md', true], ['CLAUDE.md', true],
  ['SECURITY.md', true], ['LICENSE', true], ['server/test/a.test.ts', true], ['server/test/fixtures/x/y.json', true],
  ['server/test-e2e/a.ts', true], ['agent/test/a.test.ts', true],
  ['ccd/worker-skill/SKILL.md', false], ['ccd/coordinator-skill/references/resume.md', false],
  ['agent/CLAUDE.md', false], ['ui/README.md', false], ['pwa/src/docs/DocsLeaf.tsx', false],
  ['server/src/docs/x.ts', false], ['pwa/test/a.test.tsx', false], ['server/testx/a.ts', false],
  ['docsx/a.md', false], ['LICENSE.txt', false], ['server/vitest.config.ts', false],
  ['.github/workflows/release-main.yml', false], ['install.sh', false], ['ui/src/index.ts', false],
])('W25-S1: notShipped(%j) is %s', (p, want) => { expect(notShipped(p)).toBe(want); });

it('W25-S2: six rules, each with a reason, trees bare (no slash at either end, no glob)', () => {
  expect(NOT_SHIPPED).toHaveLength(6);
  expect(Object.isFrozen(NOT_SHIPPED)).toBe(true);
  for (const r of NOT_SHIPPED) {
    expect(r.why.length).toBeGreaterThan(0);
    if ('tree' in r) expect(r.tree).toMatch(/^[a-z][a-z0-9/-]*[a-z0-9]$/);
  }
});
```

  The repo rows build one fixture with tag `v0.0.1` on a commit holding `install.sh` (mode 0755), `deploy/x.sh` (0755, content `'#!/usr/bin/env bash\necho x\n'`, non-empty so git's default rename detection would pair it under the S6 mutation), `ccd/worker-skill/SKILL.md`, `docs/a.md` and `README.md`. Then each row commits its own change and runs the CLI with `--base v0.0.1`:
  - W25-S3: an `--allow-empty` commit gives stdout `unchanged 0\n`, exit 0.
  - W25-S4: a commit changing `docs/a.md`, `README.md` and adding `server/test/x.test.ts` gives `unchanged 3\n`.
  - W25-S5: a commit changing `ccd/worker-skill/SKILL.md` gives `changed 1 "ccd/worker-skill/SKILL.md"\n`.
  - W25-S6: `git mv deploy/x.sh docs/x.sh` gives `changed 1 "deploy/x.sh"\n`. This is the `--no-renames` mutation row: without the flag, stdout reads `unchanged 1`.
  - W25-S7: `chmodSync('install.sh', 0o644)` and commit gives `changed 1 "install.sh"\n`.
  - W25-S8: a commit changing `deploy/x.sh`, then a commit changing `docs/a.md`, gives `changed 1 "deploy/x.sh"\n`. The base is the tag, not `HEAD^`.
  - W25-S9: `--base v9.9.9` (no such ref) gives exit 1 with stdout `''`. `--base --output=<home>/leak` gives a non-zero exit, stdout `''`, and no file in `<home>` whose name starts with `leak`. This is the dash-guard mutation row: without the guard git accepts the option, writes the diff to a file, exits 0, and the CLI answers `unchanged 0`.
  - W25-S10: `--bogus` gives exit 2 with stdout `''`. A missing `--base` gives exit 2.
  - W25-S11: adding `docs/a b.md` gives `unchanged 1\n`. Adding `ccd/a b` gives `changed 1 "ccd/a b"\n`.
  - W25-S12: `decide(['docs/a.md', 'ccd/b', 'agent/test/c', 'deploy/d'])` equals `{ word: 'changed', count: 2, first: 'ccd/b' }`, and `decide([])` equals `{ word: 'unchanged', count: 0 }`.

- [x] **Step 2: Write the guard rows** in the third describe. These test-local functions are this task's decisions:

```ts
type Read = (rel: string) => string | null;
interface Derived { inputs: string[]; fileDeps: Map<string, string> } // package name -> repo-relative package dir
/** build-release.sh's inputs, from its own text, the package scripts npm runs and the configs those read; throws on any shape it does not model. */
function deriveReleaseInputs(read: Read): Derived;
/** Every tracked file at or under a derived input that notShipped claims, plus every input notShipped claims. */
function shippedViolations(inputs: string[], files: string[]): string[];
/** `<file> -> <resolved>` for every path in an input source file that resolves to a notShipped path. */
function importEscapes(d: Derived, files: string[], read: Read): string[];
/** `<link> -> <resolved>` for every tracked symlink at or under an input whose target resolves to a notShipped path. */
function linkEscapes(inputs: string[], links: Map<string, string>): string[];
```

  `deriveReleaseInputs` reads `deploy/build-release.sh` and collects:
  - the `PATHSPEC=( … )` tokens;
  - `<pkg>/<x>` for each `PATHSPEC+=("$pkg/<x>")` inside a `for pkg in <list>; do` loop, for each listed pkg;
  - for each package in `^\( cd "\$ROOT\/([a-z]+)"\s*&& npm ci\b` (the regex at `build-release.test.ts:701`): `<pkg>/package.json`, `<pkg>/package-lock.json` and `<pkg>/tsconfig.json`, plus each `include` entry of that tsconfig. Strip the tsconfig's comments with `stripTs` from `./growthCheck.js` before `JSON.parse`. It is string-aware, and a naive `/*` regex eats `ui/tsconfig.json` from its `"@/*"` key to the end of the file. Each entry is resolved from the package directory, cut at its first glob segment, and normalised (`../shared/**/*.ts` becomes `shared`). Every `compilerOptions.paths` target (resolved from `baseUrl`, else the tsconfig's directory), every `rootDirs` entry and every `typeRoots` entry is resolved, cut at its first glob segment, and added the same way;
  - for each such package, the `scripts` npm runs, checked against this modelled table, which is the test's model and not a second list of what ships:

    | Package | Line runs `npm run build` | Scripts npm runs, exactly |
    |---|---|---|
    | `server` | yes | `build: 'tsc'`, `postinstall: 'node scripts/fix-node-pty-helper.mjs'` |
    | `ui` | no | none |
    | `pwa` | yes | `build: 'tsc --noEmit && vite build'` |
    | `agent` | yes | `build: 'tsc'` |

    The keys checked are `preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`, and also `prebuild`, `build`, `postbuild` when the line runs `npm run build`. Any extra key or other value throws. A `node <file>` script adds `<pkg>/<file>` as an input;
  - for each such package, every `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` spec starting `file:` or `link:`. Its resolved directory must be another installed package (`pwa`→`ui`, `server`→`agent` at the base), recorded in `fileDeps` as name → directory;
  - when `<pkg>/vite.config.ts` exists: that file, `<pkg>/index.html`, `<pkg>/public`, and each `new URL('<rel>', import.meta.url)` target resolved from `<pkg>`.

  It throws when:
  - a non-comment line of build-release.sh contains `$ROOT` and matches none of these shapes: the `ROOT="$(cd …` definition; `git -C "$ROOT"` followed by `status`, `tag`, `rev-parse`, `ls-tree` or `archive`; `( cd "$ROOT/<pkg>" && npm ci …` with an optional `&& npm run build )`; `[ -f "$ROOT/<pkg>/dist…" ]` or `[ -d "$ROOT/<pkg>/dist…" ]` and their `|| die "…"` continuation; `cp -a "$ROOT/<pkg>/dist<suffix>" "$TOP/…"`; and `[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"`;
  - the count of `git -C "$ROOT" archive` lines is not exactly one;
  - the count of `PATHSPEC+=` occurrences differs from the count the loop parse matched;
  - the count of `( cd "$ROOT/` lines differs from the `npm ci` matches;
  - a package's scripts differ from the table, or a `file:`/`link:` dependency resolves outside the installed packages;
  - a parsed tsconfig has `extends`, `files` or `references`;
  - a vite config, with comments stripped, matches `/\b(publicDir|root|envDir|input)\s*:/`.

  `files` is `git ls-files` at the checkout. `links` maps each tracked file of mode `120000` (from `git ls-files -s`) to its target (`readlinkSync`). At the base it is empty.

  `importEscapes` scans each file in `files` that lies at or under a derived input:
  - `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`: specifiers after `from`, a bare `import`, `import(`, `require(`, `import.meta.glob(` or `new URL(`, and `/// <reference path="…" />`;
  - `.css`: `@import '…'`/`@import "…"`/`@import url(…)`, `@source '…'` (also `@source not '…'`) and `url(…)`;
  - `.html`: `src="…"` and `href="…"`. A value starting `/` resolves from the package directory and, separately, from `<pkg>/public`. `http:`, `https:` and `data:` values are skipped.

  Each value beginning `./` or `../` resolves with `path.posix` from the file's directory. A value beginning with a `fileDeps` name followed by `/` resolves into that package's directory. Each is cut at `?` and at the first `*` or `{`, and is reported when `notShipped` answers true.

  - W25-G1: `deriveReleaseInputs(read).inputs` over the checkout contains `install.sh`, `shared`, `ccd`, `deploy`, `server/package.json`, `server/scripts`, `server/scripts/fix-node-pty-helper.mjs`, `server/src`, `agent/src`, `pwa/src`, `pwa/test`, `pwa/index.html`, `pwa/public`, `ui/src` and `ui/package.json`, and `fileDeps` maps `@ccrc/ui` to `ui` and `ccrc-agent` to `agent`. This is the non-vacuous row.
  - W25-G2: `shippedViolations(inputs, files)` equals `[]` at the checkout.
  - W25-G3 (mutations, each a reader that returns mutated text for one file and the real text otherwise, checked against the real `files`): `it.each`:
    - `PATHSPEC=(install.sh shared ccd deploy docs` reports a `docs/…` file;
    - adding `server` to `PATHSPEC` reports a `server/test/…` file;
    - adding `README.md` reports `README.md`;
    - `server/tsconfig.json` `include` gaining `"test/**/*.ts"` reports a `server/test/…` file;
    - `pwa/tsconfig.json` `compilerOptions.paths` gaining `"#d/*": ["../docs/*"]` reports a `docs/…` file;
    - `pwa/tsconfig.json` `compilerOptions.typeRoots` set to `["../server/test"]` reports a `server/test/…` file;
    - `pwa/vite.config.ts` gaining `new URL('../docs', import.meta.url)` reports a `docs/…` file.

    Each expects `.length > 0`.
  - W25-G4 (unparsed growth throws): `it.each`:
    - a `PATHSPEC+=(extra)` line outside the loop;
    - a `( cd "$ROOT/x" && npm run build )` line;
    - a `cp -a "$ROOT/LICENSE" "$TOP/LICENSE"` line in build-release.sh;
    - a second `git -C "$ROOT" archive --format=tar HEAD -- docs | tar -x -C "$TOP"` line;
    - `pwa/package.json` gaining `"postbuild": "node scripts/embed-changelog.mjs ../docs/changelog.md"`;
    - `pwa/package.json` with `"build": "tsc --noEmit -p tsconfig.app.json && vite build"`;
    - `ui/package.json` gaining `"prepare": "node x.mjs"`;
    - `server/package.json` gaining the devDependency `"x": "file:../docs"`;
    - `server/tsconfig.json` with `"extends": "./base.json"`;
    - `pwa/vite.config.ts` gaining `publicDir: '../docs',`.

    Each expects `deriveReleaseInputs` to throw a message naming the shape.
  - W25-G5: `importEscapes(derived, files, read)` at the checkout equals `[]`. With planted files (added to `files` and served by the reader):
    - `server/src/w25.ts` holding `import { h } from '../test/helpers.js';` reports it;
    - `pwa/src/w25.ts` holding `import md from '../../docs/a.md?raw';` reports it;
    - `server/src/w25.ts` holding `/// <reference path="../test/x.d.ts" />` reports it;
    - `server/src/w25.ts` holding `import 'ccrc-agent/test/x.js';` reports it;
    - `pwa/src/styles/w25.css` holding `@source '../../../docs/**/*.md';` reports it;
    - `pwa/src/styles/w25.css` holding `@import '../../../docs/a.css';` reports it;
    - `pwa/index.html` with `<link rel="stylesheet" href="../docs/a.css">` added reports it;
    - `pwa/src/screens/w25.ts` holding `import { DocsLeaf } from '../docs/DocsLeaf';` reports nothing, because `pwa/src/docs` ships.
  - W25-G6: `linkEscapes(inputs, links)` at the checkout equals `[]`. With `links` holding `pwa/src/w25 -> ../../docs/a.md` it reports it.

- [x] **Step 3: Run the file and confirm red.** `cd server && timeout -s INT 560 ./node_modules/.bin/vitest run test/release-scope.test.ts --pool=forks --maxWorkers=1`. Expected: it fails to import `release-scope.mjs`.

- [x] **Step 4: Implement `deploy/release-scope.mjs`** to the Interfaces above. The header names D-6390 to D-6393 and D-6402, and says this is the one list (the `#NOT_SHIPPED` symbol), consulted by `release-main.sh#measure_change`. It also says that a base tag's own copy of this file is run by `release-main.sh` and by the runner's own node, so it stays dependency-free. `main(argv)` returns the exit code. Each rule's `why` is one short clause (for example `'tests: outside server/tsconfig.json include; tsc and vite never read it'`).

- [x] **Step 5: Run until green.** Same command. If W25-G2, W25-G5 or W25-G6 is red at the checkout, a build input really does reach a `NOT_SHIPPED` path. If W25-G1 throws at the checkout, the base has a build shape this plan did not measure. Either way, stop and report it to the coordinator. Never narrow the guard.

- [x] **Step 6: Commit.** `git add deploy/release-scope.mjs server/test/release-scope.test.ts && git commit -m "feat(release): one list of what never ships, held against build-release.sh's own inputs (D-6391, D-6396)"`.

### Task 2: decide cuts no release when nothing that ships changed, and says so (W25-b; D-6392, D-6393, D-6394, D-6395, D-6397, D-6401, D-6402, D-6403)

**Files:**
- Modify: `deploy/release-main.sh` (header `:1-27`, `usage` `:33`, arguments `:36-53`, `prepare` `:56-103`, `publish` `:117-178`, dispatch `:180-183`)
- Modify: `.github/workflows/release-main.yml` (`:1-16`, `:57-78`)
- Test: `server/test/release-main.test.ts`, `server/test/build-release.test.ts`

**Interfaces:**
- Consumes: Task 1's CLI contract, exactly. Only a lone `unchanged <n>` line at rc 0 counts as unchanged.
- Produces, in `deploy/release-main.sh`:
  - Arms: `decide|prepare|publish|measure`, one per call. `--out <dir>` as now. `--base <tag>` only with `measure`, where it is required and must match `$SHAPE`; anything else is a usage error, exit 2.
  - `say <line>`: prints the line, and appends it to `$GITHUB_STEP_SUMMARY` when that is non-empty, as `{ printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; } 2>/dev/null || :`.
  - `set_output <true|false>`: appends `build=<word>` to `$GITHUB_OUTPUT` when that is non-empty, wrapped the same way.
  - `derive_tags`: sets `HIGHEST` and `NEXT` exactly as `prepare`'s `:77-84` does today. `prepare` and `decide` both call it, so `sort -V` stays spelled once.
  - `scope_ask <helper> <base> <label>`: always returns 0. It runs `out="$(node "$helper" --repo "$ROOT" --base "$base")" || rc=$?` and sets `CHANGE` to `unchanged`, `changed` or `unmeasured`, `CHANGE_N`, `CHANGE_FIRST` and `CHANGE_WHY`. The why is `<label> exited <rc>`, `<label> answered more than one line`, or `<label> answered '<first 80 chars>'`.
  - `node_floor_ok`: returns 0 iff `node --version` is at or above the engines floor read from `$ROOT/server/package.json`; otherwise sets `FLOOR_WHY` to one of D-6403's four reasons and returns 1. It never calls `sort`.
  - `measure_change <base>`: always returns 0. It first runs `node_floor_ok`; on 1 it sets `CHANGE=unmeasured` and `CHANGE_WHY="$FLOOR_WHY"` and returns, running no helper. Otherwise it runs `scope_ask "$ROOT/deploy/release-scope.mjs" "$base" release-scope.mjs`. On `unchanged` it makes `d="$(mktemp -d)"`. If `git -C "$ROOT" show "$base:deploy/release-scope.mjs" > "$d/release-scope.mjs"` fails, it sets `unmeasured` with why `<base> carries no deploy/release-scope.mjs to confirm the answer`. Otherwise it runs `scope_ask "$d/release-scope.mjs" "$base" "<base>'s release-scope.mjs"` and, on `changed`, sets `CHANGE_BY_BASE=1`. It removes `$d` before returning.
  - `base_published <tag>`: returns 0 iff `gh release view "$tag" --json isDraft --jq .isDraft`, run in `$ROOT`, exits 0 and prints exactly `false`. Otherwise it sets `BASE_WHY` (`gh release view exited <rc>` or `gh release view answered '<first 80 chars>'`) and returns 1. Only `decide` calls it.
  - `decide`: `mkdir -p "$OUT_DIR"`, `rm -f "$DECISION"` (`DECISION="$OUT_DIR/release-main.decision"`), `derive_tags`, then:
    - no `HIGHEST`: `say` the first-release line, record `release`;
    - otherwise `measure_change "$HIGHEST"`. On `unchanged` and `base_published "$HIGHEST"`: write `same-as <HIGHEST>\n`, `set_output false`, `say` the skip line, return 0. On `unchanged` with an unpublished base: `say` the unpublished-base line. On `changed`: `say` the changed line, or the changed-by-base line when `CHANGE_BY_BASE` is set. On `unmeasured`: `say` the unmeasured line;
    - every path but the skip writes `release\n` and calls `set_output true`.

    `decide` never checks a dirty tree or a tag at HEAD: it reads only committed trees, and `prepare` keeps those refusals ahead of the decision.
  - `measure`: `measure_change "$BASE"`, then prints exactly one line, `unchanged <n>`, `changed <n> <first>` or `unmeasured <why>`, and exits 0. No `gh`, no file written.
  - `prepare` reads `$DECISION` after the stale-checkout refusal (`:89-91`):
    - exactly `same-as <HIGHEST>` (with a `HIGHEST`): the D-6394 tripwire (`compgen -G "$OUT_DIR/ccrc-*.tar.gz"`), then the state `built unchanged\nsame-as <HIGHEST>\n`, then the log-only `echo` of the prepare-skip line, and `return 0`;
    - exactly `release`: fall through to the existing `git tag` (`:96`);
    - absent: `say` the no-decision line and fall through;
    - anything else: `say` the malformed-decision line and fall through.
  - The decision lines are exact copy (`—` is U+2014, as the script's other messages use):
    - skip: `release-main.sh: no release for this merge — nothing that ships changed since <highest> (paths changed: <n>, each on release-scope.mjs's NOT_SHIPPED list); nothing was tagged or built, and the next merge that changes the build takes <next>`
    - changed: `release-main.sh: releasing <next> — what ships changed since <highest> (shipped paths changed: <n>; first: <json-path>)`
    - changed by the base's helper: `release-main.sh: releasing <next> — what ships changed since <highest>, by <highest>'s own release-scope.mjs; HEAD's answered unchanged (shipped paths changed: <n>; first: <json-path>)`
    - unmeasured: `release-main.sh: releasing <next> — could not measure what changed since <highest> (<why>); a merge whose change cannot be measured is released`
    - first release: `release-main.sh: releasing <next> — no earlier release tag to compare against`
    - unpublished base: `release-main.sh: releasing <next> — <highest> is not a published release (<why>), so nothing is measured against it`
    - no decision (prepare): `release-main.sh: releasing <next> — no decision was recorded in <decision-file> (release-main.sh decide did not run); a merge whose change cannot be measured is released`
    - malformed decision (prepare): `release-main.sh: releasing <next> — <decision-file> records neither 'release' nor 'same-as <highest>'; a merge whose change cannot be measured is released`
    - prepare skip (log only): `release-main.sh: decide recorded no release for this merge (same as <highest>) — nothing tagged or built`
    - publish, on `built unchanged`: `release-main.sh: no release for this merge — nothing that ships changed since <same-as>; nothing to push, attest or publish`
- Produces, in `release-main.yml`, steps in this order: checkout (unchanged); `decide`; `setup-node` (unchanged inputs, gated); prepare (no `env:`); attest; publish (unchanged).

- [x] **Step 1: Change the harness** (`release-main.test.ts:39-129`), and nothing else in the existing rows' assertions.
  - `fixture()` gains `merge?: (root: string) => void`. It runs before `'the merge under release'` is committed with `git add -A` and without `--allow-empty`. The default writes `ccd/ccrc` as `'#!/usr/bin/env bash\necho the merge\n'` at mode 0755, a shipped change, so every existing release row still releases.
  - `fixture()` writes `server/package.json` into the `'first'` commit, holding the real `server/package.json`'s `engines` object, read at test time and never spelled as a literal (D-6403). It gains `floor?: string | null`: a string replaces `engines.node`; `null` writes `{}`.
  - `fixture()` also gains `after?: (root: string) => void` (commits `'a docs merge after it'` when given), `scope?: false | string` and `headScope?: string`. By default the real helper is copied beside the script, as `NOTES` is (`:62-64`), into the `'first'` commit, so every tag carries it. `false` leaves it out; a string plants that text as the helper in `'first'`. `headScope` writes that text over `deploy/release-scope.mjs` in the merge commit only.
  - `plantBin()`'s `gh` stub still records every argv to `$HOME/gh-argv`. For `release view` it also appends `GH_TOKEN=${GH_TOKEN:-unset}` to `$HOME/gh-env`, and prints `$HOME/gh-view` (default `false`), or exits with `$HOME/gh-view-exit` when present. Everything else exits `ghExit`, as now. `plantBin` gains `GhView = { view?: string; viewExit?: number }`, threaded through `run()`.
  - `run()` spreads `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` after `process.env` and before `extraEnv`.
  - A new `decideThenPrepare(root, home, out, gh?, env?)` runs `decide --out <out>` and then `prepare --out <out>` and returns both results.
  - The derive row (`:197`) runs `decide --out <out>` before its `prepare`, and gains `expect(d.stdout).toContain(…)` of the changed line, with first `"ccd/ccrc"`, n 1 and `highest` = the row's highest release-shaped tag. For `[]` it is the first-release line. Its existing `gh-argv` absence check after prepare stays, because a `changed` answer never calls `gh`.

- [x] **Step 2: Write the failing rows** in the new describe. Each runs `decideThenPrepare` unless it says otherwise.
  - **W25-R1** (docs-only skips): `merge` writes `docs/a.md` and `README.md`; tags `['v0.0.1']`; `GITHUB_STEP_SUMMARY` = `<home>/summary.md`, `GITHUB_OUTPUT` = `<home>/output`.

```ts
const skipLine = "release-main.sh: no release for this merge — nothing that ships changed since v0.0.1 (paths changed: 2, each on release-scope.mjs's NOT_SHIPPED list); nothing was tagged or built, and the next merge that changes the build takes v0.0.2";
expect(d.code, d.stderr).toBe(0);
expect(d.stdout).toContain(skipLine);
expect(readFileSync(join(out, 'release-main.decision'), 'utf8')).toBe('same-as v0.0.1\n');
expect(readFileSync(join(home, 'output'), 'utf8')).toBe('build=false\n');
expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${skipLine}\n`);
expect(readFileSync(join(home, 'gh-argv'), 'utf8')).toBe('release view v0.0.1 --json isDraft --jq .isDraft\n');
expect(p.code, p.stderr).toBe(0);
expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built unchanged\nsame-as v0.0.1\n');
expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
expect(existsSync(join(home, 'npm-argv'))).toBe(false);
expect(readdirSync(out).filter((f) => f.endsWith('.tar.gz'))).toEqual([]);
expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${skipLine}\n`); // prepare's skip line is log-only
// publish, as the workflow runs it after a skipped attest: CCRC_BUNDLE_PATH empty
const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: '' });
expect(q.code, q.stderr).toBe(0);
expect(q.stdout).toContain('release-main.sh: no release for this merge — nothing that ships changed since v0.0.1; nothing to push, attest or publish');
expect(readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
expect(originTags(home)).toEqual(['v0.0.1']);
```

  - **W25-R2** (test-only skips): `merge` writes `server/test/x.test.ts`, `server/test-e2e/y.ts` and `agent/test/z.test.ts`. The state is `built unchanged\nsame-as v0.0.1\n` and the line says `paths changed: 3`.
  - **W25-R3** (a shipped skill releases): `merge` writes `ccd/worker-skill/SKILL.md`. The decision is `release\n`, the output file holds `build=true\n`, the state is `built true\ntag v0.0.2\n`, the changed line names `"ccd/worker-skill/SKILL.md"`, and the summary file holds exactly the changed line.
  - **W25-R4** (deny-by-default): `it.each` over `agent/CLAUDE.md`, `.github/workflows/x.yml`, `.github/pull_request_template.md`, `ui/src/x.ts` and `pwa/test/x.test.tsx`. Each releases `v0.0.2`.
  - **W25-R5** (a failed release, then docs): `merge` is the default `ccd/ccrc` change and `after` writes `docs/a.md`. Tags `['v0.0.1']`, so no release exists for the code merge. It releases `v0.0.2`, and the line's first path is `"ccd/ccrc"`.
  - **W25-R6** (mode only): `merge` does `chmodSync(join(root, 'ccd/ccrc'), 0o644)`. It releases.
  - **W25-R7** (no earlier tag): tags `[]` and a docs-only `merge`. It releases `v0.0.1` with the first-release line, and `gh-argv` is absent.
  - **W25-R8** (helper absent): `scope: false`, docs-only. It releases `v0.0.2`, and stdout contains `could not measure what changed since v0.0.1 (release-scope.mjs exited 1)`.
  - **W25-R9** (only a positive answer skips): `it.each` over planted helpers (`scope`, so base and HEAD carry the same text), each docs-only, each releasing `v0.0.2` with the unmeasured line:
    - `process.stdout.write('unchanged 0\n'); process.exit(3);` gives `release-scope.mjs exited 3`;
    - `process.stdout.write('Unchanged 0\n');` gives `release-scope.mjs answered 'Unchanged 0'`;
    - `process.stdout.write('unchanged 0\nunchanged 0\n');` gives `release-scope.mjs answered more than one line`;
    - `process.stdout.write('unchanged x\n');` gives `release-scope.mjs answered 'unchanged x'`.
  - **W25-R10** (an unpublished base releases): docs-only, `it.each` over `{ viewExit: 1 }` (`gh release view exited 1`) and `{ view: 'true' }` (`gh release view answered 'true'`). Each releases `v0.0.2` with the unpublished-base line.
  - **W25-R11** (monotonic): a docs-only decide and prepare skip into `out1`. Then the row writes and commits `ccd/ccrc` (`'the code merge after'`), runs decide and prepare into `out2`, and gets tag `v0.0.2`. Publish with a bundle succeeds. `release-notes.txt` contains both `- The code merge after` and `- The merge under release`.
  - **W25-R12** (the attest tripwire): docs-only, and `out/ccrc-v0.0.1.tar.gz` is planted after decide and before prepare. Prepare exits 1, stderr matches `/a tarball is already in .* — the attest step would sign an artifact no release publishes/`, and `release-main.state` is absent.
  - **W25-R13** (a malformed skip state): a hand-written `built unchanged\nsame-as junk\n`. Publish exits 1 with `/malformed .*release-main\.state/`.
  - **W25-R14** (the token reaches gh): docs-only with `extraEnv` `{ GH_TOKEN: 'fixture-token' }` on decide. `gh-env` reads exactly `GH_TOKEN=fixture-token\n`. This is the row that proves `base_published` runs with the step's token.
  - **W25-R15** (HEAD's helper cannot vouch for itself): docs-only `merge`, `headScope` = `process.stdout.write('unchanged 0\n');`. The base carries the real helper, which sees `deploy/release-scope.mjs` changed. It releases `v0.0.2` with the changed-by-base line naming `"deploy/release-scope.mjs"`, and `gh-argv` is absent.
  - **W25-R16** (a base with no helper): `scope: false` and the same `headScope`, docs-only. It releases `v0.0.2` with `could not measure what changed since v0.0.1 (v0.0.1 carries no deploy/release-scope.mjs to confirm the answer)`.
  - **W25-R17** (prepare consumes only an exact decision): the default shipped `merge`, prepare only (no decide). It releases `v0.0.2`, and stdout contains the no-decision line. Then, on a fresh docs-only fixture, `release-main.decision` is hand-written as `same-as v0.0.9\n` before prepare. It releases `v0.0.2` with the malformed-decision line.
  - **W25-R18** (an unwritable summary never fails the run): docs-only, `GITHUB_STEP_SUMMARY` = `home` (a directory). Decide exits 0, writes `same-as v0.0.1\n`, prints the skip line on stdout, and its stderr is empty.
  - **W25-R20** (below the floor releases): docs-only, `floor: '>=999.0.0'`. It releases `v0.0.2`, stdout contains `could not measure what changed since v0.0.1 (node v` and `is below server/package.json's engines floor >=999.0.0)`, and `gh-argv` is absent.
  - **W25-R21** (an unreadable floor releases): docs-only, `floor: null`. It releases `v0.0.2` with `(server/package.json names no readable engines floor)`.
  - **W25-R22** (an unreadable node version releases): docs-only, with a `node` shim first on `PATH` that prints `garbage` for `--version` and otherwise `exec`s the real node (its absolute path, `process.execPath`). It releases `v0.0.2` with `(node --version answered 'garbage')`.
  - **W25-R23** (an in-tree decision, D-6404): the out directory is `<root>/release-out`. On the default shipped `merge`, decide then prepare release `v0.0.2`, and the in-tree decision file is absent afterwards. With an untracked straggler planted beside it, prepare refuses the dirty tree.
  - **W25-R24** (the token is not passed to the helpers' environment): a planted helper (`scope`) answers `changed` when `GH_TOKEN` or `GITHUB_OUTPUT` is in its environment and `unchanged 0` otherwise. With `GH_TOKEN` and `GITHUB_OUTPUT` set on decide, the merge skips (`same-as v0.0.1`), and `gh-env` still reads the token.
  - **W25-R19** (the measure arm): `measure --base v0.0.1` on a docs-only `merge` prints exactly `unchanged 2\n`, exit 0, with `gh-argv` and `npm-argv` absent and no `release-main.decision` written. On the default `merge` it prints `changed 1 "ccd/ccrc"\n`. With `scope: false` it prints `unmeasured release-scope.mjs exited 1\n`. `measure --base junk` and `measure` with no `--base` exit 2, and `prepare --base v0.0.1` exits 2.

- [x] **Step 3: Write the failing pins.**
  - In `'release-main.sh: source pins'`:
    - **W25-P1**: `src()` contains `node "$helper" --repo "$ROOT" --base "$base"`, `git -C "$ROOT" show "$base:deploy/release-scope.mjs"` and `gh release view "$tag" --json isDraft --jq .isDraft`.
    - **W25-P2**: `src()` contains both `printf 'built unchanged\nsame-as %s\n'` and `printf 'built false\ntag %s\n'`.
    - **W25-P3**: `src()` with every `#`-comment line removed does not match `/\bdocs\/|test-e2e|server\/test|agent\/test|\*\.md|['"]LICENSE['"]/`, because the list lives in the helper. The skip line names the list by symbol and spells none of it.
    - **W25-P4**: `prepare`'s body (from `prepare() {` to its closing `^}`) contains neither `gh ` nor `base_published` nor `GH_TOKEN`. The step that runs `npm ci` makes no `gh` call.
    - **W25-P5**: `src()` matches `/sort -V/` exactly once. The derivation is spelled once, in `derive_tags`.
  - In `build-release.test.ts`'s `release-main.yml` describe:
    - **W25-Y1**: `expect(src).not.toMatch(/^\s+paths(-ignore)?:/m)`.
    - **W25-Y2** (as landed, D-6406): `expect(src).toMatch(/^      - name: Decide whether this merge changes what ships\n        id: decide\n        continue-on-error: true\n        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n        run: bash deploy\/release-main\.sh decide --out release-out$/m)`.
    - **W25-Y3**: `src` contains `      - uses: actions/setup-node@v4\n        if: steps.decide.outputs.build != 'false'\n`, and the index of the decide `run:` is below the setup-node line's, which is below prepare's `run:`.
    - **W25-Y4**: the prepare step's block, from `      - name: Derive the next tag and build the artifact` to the next `\n      - `, contains neither `env:` nor `${{`.

- [x] **Step 4: Run both files and confirm red.** Run `release-main.test.ts`, then `build-release.test.ts`, one at a time with the Global Constraints command. Expected:
  - the W25-R, P and Y rows fail;
  - every pre-existing row is green, except the derive row, which now runs `decide`, an arm that does not exist yet. Any other red pre-existing row is a harness mistake: fix it before Step 5.

- [x] **Step 5: Implement.**
  - `release-main.sh`:
    - the argument loop accepts the four arms and `--base`, and `[ -n "$ARM" ]`'s message names all four;
    - the new functions, as in the Interfaces;
    - `prepare`: `derive_tags` replaces `:77-84`; the decision read sits after the stale-checkout refusal and before `git tag`;
    - `publish`: read the `same-as` key beside `built` and `tag`; before `if [ "$built" = false ]`, on `built = unchanged`, check `same-as` against `$SHAPE` (else the existing malformed die), print the publish skip line, and `return 0`;
    - the header's first sentence becomes "every merge to main that changes what ships becomes a PRERELEASE; a merge whose every changed path `deploy/release-scope.mjs` calls not shipped, by HEAD's copy and by the base tag's own, cuts none (D-6390, D-6402)". The arm summary gains `decide` and `measure`. The notes comment's "patch-per-merge must not stall on a sentence" becomes "a release must not stall on a sentence". `usage` names the four arms and says decide runs first.
  - `release-main.yml`:
    - the header's first line becomes "Every merge to main that changes what ships becomes a PRERELEASE", and "The one expression this file decides, the attest step's `if:`, is pinned" becomes "The two expressions this file decides, setup-node's `if:` and the attest step's `if:`, are pinned";
    - insert, between checkout and `setup-node`, this comment and the step pinned by W25-Y2:

      ```
      # Decide first, with the runner's own node, as release-stable.yml's gate
      # does: does this merge change what ships? GH_TOKEN serves only the
      # published-base check, and it is not passed to the helpers'
      # environment. This step installs nothing. A merge that changes
      # nothing that ships skips the toolchain and its cache below (D-6401).
      # The base tag's own classifier runs only after HEAD's answered
      # unchanged against that tag, and since deploy/ ships, its bytes then
      # equal HEAD's (D-6402). The checkout's persisted credential and the
      # job's OIDC request token still reach every step, as before this wave
      # (D-6405). The step continues on error: a decide that crashes must not
      # block a code merge's release, so its output is then absent, the
      # toolchain step below still runs, and prepare, finding no decision
      # recorded, releases as it always did.
      ```
      (As landed, D-6406; the step itself carries `continue-on-error: true` between `id: decide` and `env:`.)
    - `setup-node` gains `if: steps.decide.outputs.build != 'false'` as its first key under `- uses:`, and this comment above it: `# Only when a build follows: a skipped merge installs nothing, and the cache would have nothing to save.`;
    - the prepare step's comment becomes `# Arm 1: refuses dirty/tagged, derives, tags LOCALLY, builds. Nothing reaches origin here. On a merge decide skipped, it records that and builds nothing.`;
    - the attest comment says it is also skipped "when prepare cut no release because nothing that ships changed".

    None of these comments may contain `npm ci`, `npm run`, `build-release.sh` or `gh release` (`build-release.test.ts:686-687`).

- [x] **Step 6: Run both files until green**, one at a time. Then run `release-notes.test.ts`, `update-states.test.ts`, `oss-metadata.test.ts`, `workflow-yaml-parses.test.ts` and `verify-provenance.test.ts` whole, which are unchanged and run to confirm.

- [x] **Step 7: Commit.** `git commit -m "feat(release): a merge that changes nothing that ships cuts no tag, build, attestation or release (D-6392..D-6395, D-6397, D-6401..D-6403)"`.

### Task 3: release-stable's untagged-HEAD refusal says what is true (W25-c; D-6398, the ruling on Reading 6)

Rewritten to the coordinator's ruling on Reading 6: `release-stable.sh` never promotes a release HEAD only contains. The tag at HEAD stays the whole input to a promotion.

**Files:**
- Modify: `deploy/release-stable.sh` (`:1-12`, `:59-64`); `.github/workflows/release-stable.yml` (`:5-8`, comments only)
- Test: `server/test/release-stable.test.ts`

**Interfaces:**
- Consumes: `release-main.sh measure --base <tag>` (Task 2), exactly: rc 0 and one line `unchanged <n>`, `changed <n> <first>` or `unmeasured <why>`.
- Produces: when HEAD carries one or more release tags, nothing changes. When it carries none, exit 2, no `gh` call, empty stdout, and stderr is exactly one of two lines:
  - HEAD contains no release tag: `release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD <short> carries no vX.Y.Z tag, and it contains no release tag). stable now points at <short> and cannot move back (fast-forward only): the first release cut from a descendant of <short> promotes by a fast-forward push of that release's commit (git push origin <tag>^{commit}:refs/heads/stable). Nothing was changed`
  - HEAD contains `<t>`: `release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD <short> carries no vX.Y.Z tag; it sits past <t>, the newest release it contains, and <reason>). stable now sits past <t> and cannot move back (fast-forward only): the next release cut from a descendant of <short> promotes by a fast-forward push of that release's commit (git push origin <tag>^{commit}:refs/heads/stable). Nothing was changed`, where `<reason>` is one of:
    - on `unchanged <n>`: `its merges since changed nothing that ships (paths changed: <n>), so no release was cut for them`;
    - on `changed <n> <first>`: `it changed what ships (shipped paths changed: <n>; first: <first>): check the release-main run for its merge, which should have cut a release`;
    - otherwise: `whether it changed what ships could not be measured (<why>), so read it as changed: check the release-main run for its merge`, where `<why>` is the `unmeasured` answer's text, `release-main.sh measure exited <rc>`, or `release-main.sh measure answered '<first 80 chars>'`.

  `<tag>` in the tail is literal text, a placeholder for a release not yet cut. The message never names `<t>` as something to push, and prints no rewind or force command.

- [x] **Step 1: Change the harness.** `fixture()` gains `scope?: boolean`: when true it copies the real `deploy/release-main.sh` and `deploy/release-scope.mjs` into `deploy/`, and writes `server/package.json` holding the real file's `engines` object (D-6403), before the first commit, so every tag carries them. `plantBin`'s `GhOpts` gains `realNode?: boolean`: when true, `node` is not poisoned. `npm` and `curl` stay poisoned in every row. The `run()` env already carries `GIT_ENV`, which the helper's own git inherits.

- [x] **Step 2: Write the failing rows** in `'release-stable.sh: what it refuses'`. In each, the row commits on top of `fixture(home, { tagHead: 'v1.2.3', scope: true })` and runs with `realNode: true` unless it says otherwise. Every row expects exit 2, `ghArgv(home)` equal to `[]` and stdout `''`.
  - **W25-T1** (an unreleased docs head is refused, and says nothing that ships changed): commit a `README.md` and `docs/a.md` change. Stderr contains `carries no vX.Y.Z tag; it sits past v1.2.3, the newest release it contains, and its merges since changed nothing that ships (paths changed: 2), so no release was cut for them). stable now sits past v1.2.3 and cannot move back (fast-forward only): the next release cut from a descendant of ` and ends `Nothing was changed\n`. This is the never-promote mutation row.
  - **W25-T2** (a shipped change): commit a `deploy/x.sh` change. Stderr matches the existing untagged row's regex and `/carries no vX\.Y\.Z tag; it sits past v1\.2\.3, the newest release it contains, and it changed what ships \(shipped paths changed: 1; first: "deploy\/x\.sh"\): check the release-main run for its merge/`.
  - **W25-T3** (only a contained tag): as T1, plus a side branch off the tagged commit with a commit tagged `v9.9.9`, which HEAD does not contain. Stderr names `v1.2.3` and not `v9.9.9`. This is the `--merged HEAD` mutation row.
  - **W25-T4** (version order): `fixture(home, { scope: true })`, then two empty commits tagged `v1.9.9` and `v1.9.10` in that order, then a docs commit. Stderr names `it sits past v1.9.10`. This is the `sort -V` mutation row.
  - **W25-T5** (no release anywhere): `fixture(home)` with no tag and no `realNode`. Stderr contains `carries no vX.Y.Z tag, and it contains no release tag). stable now points at`. Node is never run: it stays poisoned and the row passes.
  - **W25-T6** (unmeasured reads as changed): commit a docs change and `git rm deploy/release-scope.mjs`. Stderr contains `whether it changed what ships could not be measured (release-scope.mjs exited 1), so read it as changed`.
  - **W25-T7** (no rewind, no force, no push of a contained tag): over T1's and T2's cases, stderr does not match `/--force|push -f|\+refs|git reset|git push origin v[0-9]/`, and contains `git push origin <tag>^{commit}:refs/heads/stable` exactly once.
  - The existing untagged row (`'an untagged HEAD is exit 2 …'`) and the D-3129 two-tag row stay green unchanged: no tag at HEAD and none contained means no `measure` and no `node`.

- [x] **Step 3: Run and confirm red.** Run `release-stable.test.ts`. Expected: T1 to T4, T6 and T7 fail; T5 fails on its message. Every pre-existing row is green.

- [x] **Step 4: Implement** in the zero-tag branch:
  - `SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"`, and one local function that prints the refusal from its varying parts and exits 2, so the prefix and the tail are spelled once;
  - `NEWEST="$(git -C "$ROOT" tag --merged HEAD | grep -E "$SHAPE" | sort -V | tail -n1)" || NEWEST=""`; none → the no-release line;
  - otherwise `ANSWER="$(bash "$ROOT/deploy/release-main.sh" measure --base "$NEWEST")" || RC=$?`, then `case` on the answer to pick `<reason>`; every answer refuses.

  The header (`:1-12`): "a merge commit carries no release tag and is refused here (exit 2)" becomes "a HEAD with no release tag (a merge commit, or a `main` merge that changed nothing that ships, which release-main.sh cuts no release for) is refused here (exit 2), and the refusal names the newest release HEAD contains and whether anything that ships changed since it (D-6398)". `release-stable.yml`'s comments: `:5-6` add "and `promote` runs `deploy/release-scope.mjs` the same way, only to word a refusal"; `:7-8` "the script refuses an untagged merge HEAD" becomes "the script refuses a HEAD that carries no release tag".

- [x] **Step 5: Run until green.** Run the same file whole.

- [x] **Step 6: Commit.** `git commit -m "feat(release): release-stable's refusal of an untagged head names the release it contains and says what is true (D-6398)"`.

### Task 4: the texts say what the lane now does (W25-d; D-6399, D-6400)

**Files:**
- Modify: `README.md:66`, `:78-84` (the paragraph after the quickstart block), `:154-157`, `:446`, `:740-748`, `:756-760`, `:6488-6491`; `CLAUDE.md:245-248`, `:292-293`; `shared/api.ts:9342`; `pwa/src/screens/settings/UpdatesSection.tsx:70`; `ui/src/primitives/radio.stories.tsx:65`; the three specs' top (a delta note under each Date/Status block)
- Test: `pwa/test/settings-screen.test.tsx:3207`; `server/test/release-scope.test.ts` (W25-S13)

**Interfaces:**
- Consumes: Task 2's skip line wording and `NOT_SHIPPED`'s six rules; Task 3's refusal.
- Produces: copy, and one row.

- [x] **Step 1: The pins first.**
  - At `settings-screen.test.tsx:3207`, `dev:` becomes `'Every merge that changes the build, minutes after it lands.'`. Run `cd pwa && timeout -s INT 560 ./node_modules/.bin/vitest run test/settings-screen.test.tsx --pool=forks --maxWorkers=1 -t "the labels read spec"`. Expected: FAIL.
  - **W25-S13** in `release-scope.test.ts`'s fourth describe: read `README.md`, take the parenthesis that follows the text ``on its `NOT_SHIPPED` list (``, extract its backticked tokens, and assert that their sorted set equals `NOT_SHIPPED` spelled as `` `${tree}/` ``, `` `*${rootExt}` `` and `rootName`, sorted. Run it. Expected: FAIL (the sentence is not there yet).
- [x] **Step 2: The copy.**
  - `UpdatesSection.tsx:70` gets the same string.
  - `radio.stories.tsx:65` becomes `'Dev — every merge that changes the build.'`.
  - `shared/api.ts:9342` becomes "`dev` is every merge that changes what ships, `stable` a promotion".
  - Re-run Step 1's pwa command. Expected: PASS.
- [x] **Step 3: README**, each edit in place:
  - `:66`: "Every merge to `main` that changes what ships becomes a provenance-attested `dev` release (a merge that touches only docs or the server and agent tests cuts none)".
  - After the quickstart paragraph that begins at `:79`, add: "A checkout of a `main` head that no release names (a merge that changed nothing that ships) installs with no `version` in its stamp, so it raises no update floor, and a later bare `ccrc update` may move it to an older stable release. For a versioned build, check out a release tag before `bash install.sh` (`git checkout vX.Y.Z`), or install with `--release`."
  - `:154`: "Every merge to `main` that changes what ships publishes a release, born a prerelease — the `dev` channel; a merge that touches only docs or the server and agent tests publishes none, and the next release contains it."
  - After `:446` ("Keep the checkout out of `~/ccrc` …"), add: "Check out a release tag first if the box should carry a version and an update floor (\"Quickstart\", above)."
  - `:740-748`: after "derives the next patch tag from the highest `vX.Y.Z`", insert the README's one enumeration of the list: "A `decide` step first asks `deploy/release-scope.mjs` what changed between that tag's tree and HEAD's, and asks the tag's own copy of the helper too. When every changed path is on its `NOT_SHIPPED` list (`docs/`, the root's `*.md` and `LICENSE`, `server/test/`, `server/test-e2e/`, `agent/test/`), both copies agree, and that tag is a published release, the run builds nothing: no toolchain, no tag, no build, no attestation, and one line in the log and the job summary says so. Anything else, including an answer it cannot read, releases."
  - `:756-760`: "the script refuses a HEAD that carries no release tag or more than one — a merge commit carries none, so it cannot be promoted;" becomes "the script refuses a HEAD that carries no release tag or more than one — a merge commit carries none, and neither does a `main` merge that changed nothing that ships, so neither can be promoted;". After the promotion command's sentence ends, add: "`main`'s head often carries no release now, so push a release's own commit (`git push origin vX.Y.Z^{commit}:refs/heads/stable`), not `main`'s head. When that commit is not the head the daily run tested, the gate runs the full suite on it first. A push of an untagged head is refused after its gate, and the refusal names the newest release it contains and whether anything that ships changed since; `stable` then stays on that head until a release cut from a descendant of it is pushed." (Ruling on Reading 6.)
  - `:6490`: "(auto-tagging makes that the ordinary case on `main`)" becomes "(true of a `main` head whose merge changed what ships; a merge that touches only docs or the server and agent tests leaves the head untagged, and such a box raises no update floor)".
- [x] **Step 4: CLAUDE.md**, each edit in place, naming the list by symbol only:
  - `:245-248`: "Every merge to `main` that changes what ships becomes a GitHub **prerelease** … (… ; patch per released merge, and a merge whose every changed path `deploy/release-scope.mjs`'s `NOT_SHIPPED` covers, by HEAD's copy and the base tag's, cuts none, so `stable` promotes a release's own commit, never such an untagged head; …)".
  - `:292-293`: "which auto-tagging makes the ordinary case on `main`" becomes "which holds only for a `main` head whose merge changed what ships".
- [x] **Step 5: Spec delta notes.** One blockquote under each spec's Date/Status block (`2026-09-18-release-rollout-design.md` after `:7`, `2026-09-20-centralised-update-management-design.md` after `:14`, `2026-10-18-settings-redesign-design.md` after `:13`):

  > **Delta, 2026-10-22 (centralised update management wave 25, D-6390, D-6398):** a merge to `main` whose every changed path is outside what ships (`deploy/release-scope.mjs`'s `NOT_SHIPPED`: `docs/`, the root's `*.md` and `LICENSE`, the server and agent test trees) cuts no release: no tag, no build, no attestation. The next merge that changes the build takes the next patch number, and its release contains the skipped merges. Where this document says every merge is a release, read every merge that changes what ships. A push to `stable` still promotes only the release tagged at its HEAD: the tag at HEAD stays the whole input. The refusal of an untagged HEAD now names the newest release HEAD contains and whether anything that ships changed since it.

  For the settings spec, add: "The Dev note reads *Every merge that changes the build, minutes after it lands.*"
- [x] **Step 6: Run W25-S13 until green**, then `docs-parity` whole, since README changed.
- [x] **Step 7: Commit.** `git commit -m "docs(release): every merge that changes what ships is a release, not every merge (D-6399)"`.

### Task 5: The gate and the PR

- [x] **Step 1: Landing tip.** Run `git fetch origin main`, merge it (after the first push; rebase before it), and re-read every anchor named above in the landed text.
- [x] **Step 2: Touched suites, one file at a time, behind the memory gate.**
  - Whole, in `server/`: `release-scope`, `release-main`, `build-release`, `release-stable`, `release-notes`, `update-states`, `oss-metadata`, `workflow-yaml-parses`, `verify-provenance`.
  - By case, in `pwa/`: `settings-screen` with `-t "the labels read spec"`.
  - **Unmeasured, and so listed:** `settings-screen` beyond that case, and every suite that `shared/api.ts` selects. This PR touches `.github/`, so CI runs the full server suite (`.github/ci/select-tests.mjs`'s full trigger). Read the PR's `select tests` summary to confirm it ran in full.
- [x] **Step 3: Repo guards.**
  - `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`.
  - `GROWTH_CHECK=1 … test/growth-check.test.ts`. None of this wave's files is a growth file; run it to confirm.
  - After `git fetch origin main`, run `deviation-refs`. Check directly that each of D-6390 to D-6407 is defined exactly once, in this plan: `grep -cE '^- \*\*D-(639[0-9]|640[0-7])\.\*\*'` reads 18, and none of them is defined on `origin/main`. Any reserve number the worker defines is added to that pattern and that count.
- [x] **Step 4: The wave-done fingerprint.** The `suite:` line follows worker clause 15 (`ccd/worker-skill/SKILL.md:76`): `green` or `red` from the FIRST full suite run after the implementation was complete, red staying red through fix rounds, and `unrun` when no full run happened locally. The per-file runs of Steps 2 and 3, and the CI full run, are listed in the as-built note, not folded into the word.
- [x] **Step 5: The PR body.**
  - The rule, D-6390's argument for (a) over (b), and D-6391's six rules (the body may enumerate them; it is a dated record).
  - The decision lines.
  - The token and cache handling (D-6401): the `decide` step before `setup-node`, rows Y2 to Y4 and R14. State it honestly: the token sits in `decide`'s environment, which runs only first-party code plus git and gh; no step that runs `npm ci` holds a token beyond the one `actions/checkout` already persists.
  - The two-helper rule (D-6402), the node floor (D-6403), and release-stable's truthful refusal (D-6398), which keeps design decision 3 by the ruling on Reading 6.
  - The live proof the coordinator watches after landing: the first docs-only merge's run shows the skip line, no tag appears, and its job concludes green with its post steps.
  - D-6400's downstream effects, including the needless-release list and the lost update floor of a checkout install, so a needless release is not read as a classifier miss.
  - Every pin it changed, named: the harness default merge, the derive row's decide run and new line, and the settings note pin.
  - The function list of Global Constraints.
  - The PR body ends with the attribution line this session's reminder gives.

## Readings (for the coordinator to rule; each chosen where no ruling decided it)

1. **(a) over (b).** Chosen: the deny-by-default classifier (D-6390). The alternative is measuring the artifact. It is rejected for this wave because it needs a build and a download on every merge, it leaves an attestation hazard, and it depends on dist reproducibility that nobody has measured. A later wave could add (b) as a confirming second check once two builds are measured identical.
2. **Test trees skip.** Chosen: `server/test`, `server/test-e2e` and `agent/test` skip, on the coordinator's reading. `pwa/test` releases because pwa's `tsc` reads it. A test-only fix after a red stable gate stays promotable through Reading 6. The alternative is docs only, the directive's literal scope: drop three rules, and W25-R2 then expects a release.
3. **Nested docs release.** Chosen: `agent/CLAUDE.md`, `ui/README.md`, `pwa/design/`, `.design-sync/`, `.superpowers/` and `.github/pull_request_template.md` still release. The alternative adds each as a rule, and W25-G2 would hold each against the build.
4. **The published-base check.** Chosen: `gh release view` in `decide` (D-6392, D-6401). The alternative skips against any tag, which can skip a change that was never published.
5. **The PWA note.** Chosen: "Every merge that changes the build, minutes after it lands." The alternative is "Every code change, minutes after it lands."
6. **release-stable promotes the contained release.** Chosen: a tagless HEAD whose shipped tree is still the newest release it contains promotes that release (D-6398). This amends design 2026-09-20 decision 3. The alternative keeps "the tag at HEAD is the whole input" and only rewords the refusal truthfully; Reading 2 should then drop the test-tree rules, or a test-only fix after a red gate leaves nothing promotable.
7. **Gate evidence on an unreleased head.** Chosen: stated, and mostly answered by Reading 6, because pushing `main`'s head uses its daily evidence. Pushing a release's own tag commit still needs evidence on that sha (D-6400).
8. **Spec delta notes.** Chosen: one note per spec, with the sentences kept. The alternative rewrites the sentences.
9. **The update floor of a checkout install.** Chosen: stated, and the README points a checkout install at a release tag or `--release` (D-6400). The alternative, a follow-up wave, has `_inst_stamp` and `stamp_build` stamp the newest contained release tag when `release-main.sh measure` answers `unchanged`, which lifts "`ccd/ccrc` untouched" (`ccd/ccrc` is generated and restamped).
10. **Decide with the runner's own node, before `setup-node`.** Chosen: a separate `decide` step (D-6401), as release-stable's gate already runs. The alternatives are a token on the prepare step with an honest claim and no fix for the skip's cache, or a second `setup-node`.
11. **The base's helper must agree.** Chosen: yes (D-6402). The first one or two docs merges after landing release needlessly, while the highest tag predates the helper. The alternative trusts HEAD's helper alone and relies on the PR's tests.

## Review notes (fix round 1)

Every blocker and major was taken. The lines below record the findings, or the parts of findings, that this revision did not take as proposed, and why.

- downstream-readers, the optional zero-tag check in `gate` before `full`: not in this wave. It is a job change in `release-stable.yml`, which this wave keeps to comments. With D-6398's promote arm, an unpromotable push is rare; it is listed under Not in this wave.
- downstream-readers, the preferred fix of stamping the contained tag in `_inst_stamp`/`stamp_build`: not taken here. It lifts `ccd/ccrc` (a generated file) and `deploy.sh` into a release-lane wave. The minimum was taken (D-6400, the README notes), and the follow-up is Reading 9.
- tests-docs, naming the hand-cut `vX.Y.0` path in the refusal: not taken. The promote arm covers the unchanged case, and the refusal's "next release that contains HEAD" covers the rest without inviting a release the rule exists to avoid.
- tests-docs, the planted helper that reports `process.env` matches for the token: not taken. The token now sits in `decide`'s environment by design (D-6401), so the claim is narrowed to "no step that runs `npm ci` holds it", which W25-Y4 measures structurally. W25-R14 proves the token reaches `gh`. With no token in the prepare step, the "exported under another name" mutation has nothing to export.
- tests-docs, the `build-release.sh:94` comment: not reworded. `build-release.sh` stays untouched because `release.yml` shares it, and the sentence still holds of a failing build. It is listed under Not in this wave.
- skip-correctness, the cache fix by `mkdir -p "$(npm config get cache)"`: not taken. An empty directory would let the post step save an empty cache under the unchanged lockfile key, and every later build would then restore it and download everything. Gating `setup-node` behind `decide` (D-6401) leaves the cache untouched on a skip.
- tests-docs, throwing on tsconfig `paths`/`rootDirs`/`typeRoots` outside the package: taken in its other form. Those entries become derived inputs, checked like `include` (W25-G3), because ui's `paths` is in-package and a throw would add nothing.

## Coordinator rulings on this plan's readings (2026-10-22)

- **Readings 1, 2, 3, 4, 5, 7, 8, 9 and 11: as chosen.**
  - (a), the classifier, over (b).
  - Test trees skip, as well as docs: their build is identical, so a release would be a new version of the same artifact.
  - Nested docs still release.
  - The published-release check costs a token in the `decide` step.
  - The PWA copy as written.
  - The gate-evidence cost stated in D-6400 and not fixed.
  - Delta notes in the specs, not rewritten sentences.
  - The update-floor follow-up (the unversioned stamp of an unreleased checkout) is not this wave's.
  - The base tag's own helper must agree, accepting a needless release or two just after landing.
- **Reading 6 is NOT as chosen.** The tag at HEAD stays the whole input to a promotion: design 2026-09-20 decision 3 is not amended in this wave.
  - `release-stable.sh` never promotes a release HEAD only contains. On a HEAD with no release tag it refuses, exit 2, before any `gh` call, as today.
  - The message must be true. It names the newest release tag `<t>` that HEAD contains. It says that `stable` now sits past `<t>` and cannot be rewound, and that the next release cut from a descendant of HEAD promotes by a fast-forward push of that release's commit.
  - It prints no rewind or force command.
  - When `release-main.sh measure` answers `unchanged` between `<t>` and HEAD, it may say HEAD's merges changed nothing that ships. When it answers `changed`, or cannot be measured, it says HEAD changed what ships and its release run should be checked.
  - Task 3, D-6398, its rows W25-T1 to T7, README's `:756-760` sentence and the spec delta are written to this ruling, not to the promote arm.
- **Reading 10 is as chosen, with one guard.** The `decide` step runs on the runner's own node only after checking that `node --version` meets the repo's engines floor (read from `server/package.json`, never a second literal). Below the floor, or unreadable, it decides "release", because the check cannot be trusted. Add a row for each arm.
- **Claims at dispatch.**
  - Claim 2212 (run 774) holds `README.md`; this wave's lines (:66, :78-84, :154-157, :446, :740-748, :756-760, :6488-6491 at the base) are disjoint from its 4791-4792.
  - Claim 2226 (run 722) holds `CLAUDE.md`.
  - Group C takes those two files only with that run's consent through the coordinator, or once the claim has ended.
  - Wave 23's PR #1137 also edits README in disjoint lines. The second to land measures `git merge-tree` and absorbs only on a conflict.

## Worker revision for the rulings (2026-10-22)

After the whole-branch review (ready to merge, no Critical or Important finding), one fix wave took two of its minors: the guard's `importEscapes` and `linkEscapes` now also report a read that resolves to the repository root or to an ancestor of a `NOT_SHIPPED` tree (D-6396; new W25-G5 and W25-G6 cases), and `decide` fails toward releasing (D-6401's last bullet). D-6400's first-merges bullet was corrected.

The worker applied the rulings above to the body before Task 1. Readings 2 and 6 and the review notes keep their drafted text as history.
- Reading 6: D-6398, Task 3 (its interfaces, rows W25-T1 to T7 and the mutation rows), the Goal, the Architecture, the Review Focus, the Risk notes, D-6391's test-tree bullet, D-6400's gate-evidence bullets, Task 4's README `:756-760` and CLAUDE.md wording, and the spec delta note now say that `release-stable.sh` refuses every untagged HEAD and never promotes a contained release.
- Reading 10: D-6403 (the first reserve number) defines the node-floor guard. It sits in `measure_change`, so `decide` and `release-stable.sh`'s `measure` share it. Task 2 gains `node_floor_ok`, the fixture's `server/package.json` and rows W25-R20 to R22.
- The absorb step follows worker clause 16 (merge only), replacing the drafted rebase-before-push.

## Coordinator rulings on review 812 (2026-10-22)

Review 812 read the tip a8c72ff9f; its F- and R-numbers refer to the review's report. Recorded verbatim, with one substitution for this public repository: an external CI check's name is written as "an external per-PR review check".

The two answers that decide the landing are settled, and they stand:
- (a) At this tip no merge that changes what ships can decide "no release". This was measured by a build diff in a scratch clone: Tailwind's scan roots at pwa/ and reaches no NOT_SHIPPED path.
- (b) The exposure is unchanged in effect, by byte-identity.
Everything below makes the guard hold those answers against FUTURE edits, which is D-6396's whole job. So the guard gaps are fixed in this wave, not parked.

The guard: no shape it does not model may pass silently (D-6396, plan:217, "any shape outside that model makes the guard throw").
- F1 (fix): a `..` segment anywhere in a modelled cp/test source path throws, or the source is resolved into the inputs and checked. Choose one, and say which. Pin the three measured shapes, each red with the fix removed:
  - `cp -a "$ROOT/server/dist/../../docs" "$TOP/docs"`
  - `cp -a "$ROOT/server/dist/../test" "$TOP/t"`
  - `cp -a "$ROOT/docs/dist" "$TOP/x"`
- F2 (fix): in an input CSS file these must throw unless the guard extracts their target and checks it:
  - a `source(` anywhere;
  - `@plugin`, `@config` and `@reference`.
  If one of these forms already exists in the tree at the tip, extract and check that one instead of throwing, and name it in the as-built note. Pin one red row per form.
- F4 (fix): an alias specifier (`@/…`, per pwa/vite.config.ts and ui/tsconfig.json) is resolved through the alias the configs name and then checked, or it throws. Either way, `@/../../docs/a.md?raw` must red G5. Pin it.
- F11 (fix, same family): an exact `.` or `..` specifier, and a bare relative CSS path, are resolved or throw. Pin a future-shaped `@source '..'` case.
- Each fix gets a mutation row, measured red, then restored byte-identical.

R2 and R3, ruled as fixes, though the panel killed them as findings: the byte-identity argument is the reason (b) is safe, and nothing writes it down. So a later edit could break it unseen.
- Say it in decide's comment and in D-6401/D-6405's text, one or two sentences each. The base tag's release-scope.mjs runs only after HEAD's own classifier answered `unchanged` against that tag, so its bytes equal HEAD's.
- Add one fixture row. An off-main tag with a higher version carries a release-scope.mjs that differs and writes a canary file when run. decide answers changed, and the canary is never written. Mutation: run the base copy before HEAD's answer, and it reds.
- Do NOT add a `--merged HEAD` filter. It changes which tag is the base and buys no reach.

F3 (fix before landing): correct PR #1149's body to D-6400 as corrected at plan:278.
- The landing merge releases.
- The first docs-only merge after a successful landing release SKIPS.
- A release there is a finding to chase, never "expected".
gh pr edit fails on this box, so patch the body over REST. Scan the body for private names before you send it.

F14 (fix): rewrite the comment strip at release-scope.test.ts:424 so CodeQL accepts it. For example, repeat the replace until the text stops changing, or match comment spans without replacing. Alert #172 must clear on the PR's own CodeQL run. Nobody dismisses it, and nobody resolves a thread by hand.

Text fixes:
- F12: the four texts say "not passed to the helper's environment", never that the helper cannot see the token.
- F13: add GITHUB_STATE to the env -u list.
- F5: narrow W25-P4's title to "no gh call, no token".
- F6: prepare's reason for an absent decision names both ways (decide did not run, or it crashed after removing the file).
- F7: add the at-the-floor row. Use a stub node on PATH reporting exactly the floor, whatever the box runs. Mutation: `return 0` → `return 1`, and it reds.
- F8: the mutation table names the rows that actually red under each mutation. Re-measure each row before you write it.
- F9: write the as-built note: the mutation results, the per-file runs, and the CI full run beside the suite word. Tick the task steps.
- F10: conform to the File structure's CLI guard, `resolve(argv[1]) === fileURLToPath(import.meta.url)` as release-notes.mjs does. Keep W25-S14 if it still applies. If you had a reason for basenames, ledger it instead, from the reserve.
- F15: amend the plan's dictated text to what landed:
  - Task 4 Step 3's README copy;
  - Task 2 Step 5's decide comment;
  - W25-Y2's regex.
  Record that change as ONE deviation from the reserve (D-6406), naming the three. Add node_floor_ok and decision_in_tree to the File structure.
- F16: update the File structure's describe names to the landed ones. Traceability only; do not rename tests.

Consents, checked by me:
- README: all seven hunks sit in consent 8085's regions at base 93f1c459b. The paragraph inserted after the install paragraph is the one Task 4 specifies at plan:661, so it is covered.
- CLAUDE.md: both hunks are in the "Deploy = release + rollout" bullet, outside "Known load flakes" (8081).
- No new consent is needed unless this round moves a hunk.

The red from an external per-PR review check is a per-PR gate on this PR's .github/ and test edits; main does not share it. It is not this round's to fix. main's rules are a pull request and a merge queue, with no required status checks (read at 18:10Z), so it does not gate the merge. Report its state in the wave-done.

Routing is unchanged. The first full run was unrun, not red, and CI's full run is green.
Reserve: D-6406 to D-6409, as before.

Landing:
- First-ready against runs 775 (PR #1137, now in its fix round 2), 722 and 774.
- Measure merge-tree against origin/main and #1137's head before pushing. Absorb only on a conflict or a red, with git merge; never rebase or force-push.
- Claims 2241 and 2246 hold.
Mail wave-done with the fingerprint when done. A review run follows.

## As built, fix round 1 (2026-10-22)

**Suite.** `suite: unrun`: no full local run happened after the implementation was complete, because the box sat at a load average of 35 to 70 throughout. CI's full run on the first PR head (`a8c72ff9f`) was green: the PR touches `.github/`, so `select tests` ran in full mode, all twelve server shards and the `test (server)` summary passed, and `test (agent)`, `test (pwa)`, `build-pwa`, `browser (pwa)`, `node floor (22.16.0)`, `probe-macos`, `storybook-a11y` and `typecheck (server)` passed. On that head CodeQL was red on one alert this wave introduced (the guard's HTML comment strip); fix round 1 rewrote both multi-character comment strips as loops (F14), so the alert should clear on the PR's own CodeQL run. An external per-PR review check was red on that head for this PR's `.github/` and test edits; it does not run on `main` and `main` requires no status checks.

**Per-file runs at the fix round's tip,** one file at a time from `server/`, `--pool=forks --maxWorkers=1`:
- release-scope 96, release-main 63, build-release 45, release-stable 22, release-notes 44, update-states 32, oss-metadata 29, verify-provenance 25, workflow-yaml-parses 17.
- citations 4, private-names 47, topology-clean 60, single-definition 836, dtbd 1, growth-check 45 (`GROWTH_CHECK=1`), deviation-refs (after `git fetch origin main`), docs-parity 54 (Task 4).
- typecheck-tests: one row timed out in a batch run under load, then 12 of 12 passed alone, which is the known load flake.
- pwa `settings-screen.test.tsx`: the `the labels read spec` case (Task 4), and 240 of 240 in review 812's run.

**Mutations.** Every row in the Mutation table above was measured: mutate alone, run the whole file, record the red rows, restore byte-identical. Two mutations survived a first pass and their rows were tightened before the table was written: dropping `set_output`'s `|| :` (W25-R18 now makes the output file unwritable) and dropping `-u GITHUB_STATE` (W25-R24 now sets every listed name).

**Known limits of the guard (D-6396),** found by the re-review of fix round 1 and not modelled. None of these shapes exists at the tip:
- an HTML `<!-->` comment that the spec closes at once is read as running to the next `-->`;
- a CSS string left unclosed before a `/*` on the same line can hide a following line;
- a vite alias written in a form other than `fileURLToPath(new URL(...))` is neither followed nor refused, unless it is the `@` alias, which must have that form;
- an absolute filesystem path in `@source` or an import, and a `%2e` in a CSS `url()`.

**Commits.** Tasks 1 to 4 and the final-review fix wave as in the ledger; fix round 1 (review 812): `0fc2f38d1`, `38010008b`, `73adb54a0`, `dbb83809a`, `02c1d47e8`, and this plan's own commit.

## Coordinator rulings on review 818 (2026-10-22)

Verbatim, as received; the review's report is the brief's companion.

Why: two review rounds found eleven families of silent passes in the static build-input guard, and the last one put server/test into the tarball with the guard green. The model has no end. I measured the alternative today. The tarballs of v0.0.565, v0.0.566 and v0.0.567 (consecutive docs-only merges, separate CI runs) differ, across 489 files, ONLY in build.json (sha, builtAt, version) and MANIFEST's line for build.json. The build is reproducible, so the decision moves to the artifact. A three-judge panel chose this unanimously.

1. Authority. A release is skipped only on a positive, exact, non-empty match between the new build's fingerprint and the base release's. Every other outcome releases, as today. The path classifier and the static guard leave the decision.

2. Base. The newest release-shaped tag contained in HEAD (`git tag --merged HEAD`, the one SHAPE, sort -V) whose release is published, not a draft, and carries its tarball and SHA256SUMS. Download it with gh, outside the checkout, and check it against its own SHA256SUMS. No base, or a failed download or check, releases.

3. Fingerprint. One function computes both sides from the extracted tarballs, never from the base's embedded MANIFEST:
- each entry's type, mode, size, link target and path;
- every regular file's sha256;
- build.json compared as JSON with exactly sha, builtAt and version removed;
- MANIFEST without its build.json line.
Nothing else is normalised. Run it under set -euo pipefail. An empty, malformed or unequal set releases.

4. A broken comparer must not approve itself: if base..HEAD touches .github/workflows/release-main.yml or the compare script, release unconditionally, and say so.

5. Flow.
- Always build: setup-node is no longer conditional. Build outside the attest glob on release-out, with the provisional tag local only.
- Compare, then:
  - on a skip, delete the local tag; no push, no attestation, no publish;
  - attestation runs only on an explicit release decision.
- Print exactly one line in the log and the summary:
  - "built unchanged: N entries identical to vX";
  - "differs from vX: K entries, first <path>; releasing vY";
  - "could not compare (<reason>); releasing vY".
- The state stays "built unchanged" / "same-as <tag>" (D-6394). It records the HEAD sha and the base tag, and publish checks both. The job ends green on a skip.
- A crash between steps either releases or fails loudly. It never attests a digest that no release publishes.

6. Credentials. GH_TOKEN goes only to the compare step and to publish, never to prepare (npm ci). The build/release job split (D-6405) is NOT in this wave: it is the operator's open call as a follow-up. No paths filter on the trigger (D-6397).

7. Retire:
- deploy/release-scope.mjs and server/test/release-scope.test.ts (deleting it also clears CodeQL alert #175, which must read fixed on the PR's own run; nobody dismisses it);
- the decide step, with its continue-on-error and env -u list;
- the `if:` on setup-node;
- scope_ask, node_floor_ok, measure_change, measure and decision_in_tree;
- the base-helper copy.
release-stable.sh drops measure. An untagged HEAD still exits 2 before any gh call, names the newest release HEAD contains, and points at release-main's run for that sha. It claims no measurement, runs no build and no npm, and prints no push or rewind command.

8. Review 818.
- Moot with the guard: F1 to F10, F12, F14, F15, F16 (by deletion) and F17, and R3.
- Still owed:
  - F11: make the say and set_output rows readable;
  - F13: restore the channel-note row;
  - re-measure the whole Mutation table for the new design.

9. Pins, each with a mutation row measured red.
- An equal build skips: no tag push, no attestation, no publish.
- Each of these releases:
  - a content, mode-only, symlink, added or removed entry;
  - a build.json key change other than the three removed;
  - an empty fingerprint on both sides;
  - a base that is missing, a draft, or not contained;
  - a failed download or checksum check;
  - a revert merge (content equal to an older release than the newest contained one);
  - a changed release-main.yml.
- Each of these mutations reds a row: compare forced to equal, a wider exclusion, the attestation gate removed, GH_TOKEN given to prepare.
- release-stable: an untagged HEAD still exits 2.
- Tests stay hermetic: a planted gh, fixture tarballs, no network.

10. Ledger.
- Invert D-6390, citing the 565/566/567 measurement.
- Rewrite D-6392, D-6393, D-6398, D-6400, D-6401 and D-6405.
- Mark D-6391, D-6396, D-6402, D-6403, D-6404 and D-6406/D-6407 where they no longer apply as superseded; never remove one.
- New numbers: D-6408 and D-6409 first, then the block issued to this wave, D-6499 to D-6510. Define each in the same commit that first names it.

11. Docs and consents.
- README and CLAUDE.md stay inside the regions already consented (8085, now against claim 2259; 8081). The user-facing rule can stay "a merge that changes nothing that ships (docs, the server and agent tests) cuts no release". Only the mechanism sentence changes.
- If a hunk must move outside a consented region, stop and tell me; I will ask its owner.
- The PR body's live proof:
  - the landing merge releases, since deploy/ and .github/ change;
  - the next docs-only merge prints "built unchanged";
  - the next code merge prints "differs" and releases;
  - a docs merge that releases with "differs" names its first path, and that is a finding.

Routing is unchanged: class opus, effort high, subagents sonnet. The redesign mostly deletes code. If its first full run is red and shallow, the effort rises then.
Growth: report the net lines per file. Landing is first-ready against runs 775 (PR #1137, in fix round 3), 722 and 774, with merge-tree measured before pushing. Claims 2241 and 2246 hold.
Mail wave-done with the fingerprint when done. A review run follows.

## Operator answers and the docs-trigger amendment (2026-10-22)

Verbatim, as received from the coordinator.

Run 793, wave 25, fix round 2: an amendment from the operator. Fold it into this round; it does not restart it. Record it verbatim in the plan, after the rulings on review 818, as "Operator answers and the docs-trigger amendment (2026-10-22)". New block: D-6511, D-6512, D-6513.

The operator's answers to the four questions I raised after ruling on review 818:
1. A docs-only merge must not spend CI budget. I had asked whether it was fine that, under the fingerprint design, a docs merge still builds. The answer is no.
2. No manual force-release button. Add no workflow_dispatch to release-main.yml.
3. The build/release job split (D-6405) is wave 26, after this wave lands. Do not split jobs here.
4. The agent-link handshake fix is its own wave. Nothing for you.

This amendment supersedes the last sentence of item 6 in my rulings mail ("No paths filter on the trigger") and supersedes D-6397.

A. D-6511, the trigger. release-main.yml's push trigger becomes exactly:
    on:
      push:
        branches: [main]
        paths-ignore: ['docs/**', '*.md']
What that means:
- GitHub's `*` does not cross `/`. So '*.md' matches only the root's Markdown files, and 'docs/**' only the root docs/ tree. The shipped skills under ccd/ and anything under pwa/src/docs/ still start the run.
- A push in which every changed file matches is not run at all: no runner, no build, no release. Any other file in the push starts the normal flow, within the limits below.
- GitHub's documented limits (workflow syntax page, "paths" and its cheat sheet):
  - a push of more than 1,000 commits, or a diff that times out, always runs;
  - a diff of more than 3,000 files runs only if a non-ignored file is among the first 3,000 the filter returns.
  The 3,000-file case can skip a real change. D-6512 covers it: that change is delayed, never lost.
The comment above the trigger states these facts. It also says the list is two root-anchored patterns, never widened without a ledger entry.

B. D-6512, why this is safe now when D-6397 refused it. Mark D-6397's entry superseded, and answer each of its three reasons:
- "A second hand-kept list." It is two patterns, and neither decides a release: the fingerprint still decides every run that starts. Row F2 below pins the patterns disjoint from what the build archives.
- "GitHub evaluates it over the push's own range" (D-6392's hazard). The base is the newest published release that HEAD contains, not the push's before. So a push the filter skips, including the 3,000-file case, can only delay a change to the next run that starts. That run's build includes the change and releases it, so nothing is lost or mislabelled. Say plainly in the plan: a failed release followed only by docs merges stays unreleased until the next merge outside the two patterns, or until someone re-runs the failed run. Answer 2 means there is no other door.
- "The trigger pin would miss one" (build-release.test.ts:658's regex). Replace that pin with an exact one: row F1.

C. D-6513, the rows. Measure each before and after: it must go red when its mutation is applied.
- F1: the trigger is exactly push, branches [main], paths-ignore ['docs/**', '*.md'], with no `paths:` key and no other event. Read the `on:` block structurally or as an exact text block, never with a regex that stops at `$`. Each of these mutations must turn the row red:
  - drop paths-ignore;
  - widen a pattern to '**/*.md';
  - widen a pattern to '**/docs/**';
  - add workflow_dispatch;
  - add a `paths:` key.
- F2: no PATHSPEC entry in deploy/build-release.sh is docs/, sits under docs/, or is a root *.md file. Parse the entries from the file, including the per-package scripts/ arm. Mutation: add README.md, or docs, to PATHSPEC; the row goes red.
- Retire the pin that asserted no filter (D-6397's row), and name it in the plan as retired.

D. The docs. Where this wave already rewords "every merge to main becomes a prerelease", say instead:
- a merge that changes only docs/ or the root's Markdown starts no release run;
- any other merge builds, and it releases unless its tarball matches the newest published release it contains.
Edit only inside the consented regions: the list in README claim 2240, and CLAUDE.md's two rewordings. If the change needs a region outside them, ask me first.

E. The post-landing check changes:
- The landing merge itself releases, because it changes .github/.
- The next docs-only merge should start no release-main run at all. Check the Actions list, not a log line.
- The next tests-only merge should print "built unchanged".
- The next code merge should print "differs" and release.

Send the wave-done as before, and include the rows' before and after readings in it.

## Fix round 2: the release decision moves to the built artifact (2026-10-22)

The coordinator's rulings on review 818 (above) redesign the decision. This section is the brief for that round, and where it and an earlier section disagree, this one governs. The operator's docs-trigger amendment (above) adds the trigger filter (D-6511 to D-6513) and governs over this section's "no trigger filter" and over W25-Y1. Task 1, the `decide` and `measure` arms, and Task 3's measured sentences are retired. Task 4's copy keeps its user-facing rule and changes its mechanism sentence. The deviations are D-6390, D-6392, D-6393, D-6398, D-6400, D-6401 and D-6405 as rewritten, D-6408, D-6409 and D-6499 to D-6501 as new, and D-6391, D-6396, D-6402 to D-6404, D-6406 and D-6407 as superseded.

### Interfaces

**`deploy/release-main.sh`**, three arms: `prepare | compare | publish`, each with `[--out <dir>]` (default `$ROOT/release-out`). `decide`, `measure` and `--base` are gone, and passing one is a usage error (exit 2).

- **Helpers kept:** `say` and `set_output` (D-6395), now writing `release=<true|false>`, and `derive_tags`. One new helper, `newest`, reads tag names on stdin and prints the highest release-shaped one: `grep -E "$SHAPE" | sort -V | tail -n1`. It is the script's only `sort -V`. `derive_tags` uses it over every tag for `HIGHEST`/`NEXT`, and `compare` uses it over `git tag --merged HEAD` minus the provisional tag for the base.
- **Helpers removed:** `scope_ask`, `node_floor_ok`, `measure_change`, `base_published`, `decide`, `measure` and `decision_in_tree`.
- **`prepare`** (no token, no gh):
  1. Refuse a dirty tree with the base's own check, `git status --porcelain`, and the base's message.
  2. Handle an already-tagged HEAD as before: `built false`, or the leftover-local-tag refusal.
  3. Derive the next tag, and refuse when origin already holds it, as before.
  4. Refuse when `$OUT_DIR` already holds a `ccrc-*.tar.gz` (the attest glob would sign it).
  5. Tag locally and run `bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR/candidate"`. On a failure, delete the local tag and die, as before.
  6. Write the state `built candidate` / `tag <next>` / `head <sha>`, and print `release-main.sh: built <next> as a candidate in $OUT_DIR/candidate — tagged locally (NOT pushed); next: compare`.
- **`compare`** (`GH_TOKEN`):
  1. With no state file, exit 2, as `publish` does (as built). Read the state. On `built false`, print `release-main.sh: nothing to compare — HEAD was already tagged; release.yml owns it`; on `built contained` (D-6502), print `release-main.sh: nothing to compare — HEAD is already contained in <tag>`; either way write `release=false` and exit 0 (as built, review 842 F9). Otherwise the state must read `built candidate`, with `tag` matching `SHAPE` and `head` equal to `git rev-parse HEAD`; anything else dies (exit 1). The candidate `$OUT_DIR/candidate/ccrc-<tag>.tar.gz` must exist, or it dies.
  2. Choose, in order. The first failing check releases with `could not compare (<reason>); releasing <tag>`:
     - the base: `git tag --merged HEAD`, leaving out `<tag>`, through `newest`. Reason when there is none: `HEAD contains no earlier release tag`;
     - the self-approval guard (D-6409), `git diff --name-only "$base" HEAD -- .github/workflows/release-main.yml deploy/release-main.sh`. Reasons: `git diff against <base> failed`, and `<base>..HEAD changes <first path>, which judges this comparison`;
     - published: `gh release view "$base" --json isDraft --jq .isDraft` exits 0 and prints exactly `false`. Reasons: `gh release view <base> exited <rc>`, and `<base> is not a published release (gh answered '<first 80>')`;
     - downloaded: `gh release download "$base" --pattern "ccrc-$base.tar.gz" --pattern SHA256SUMS --dir "$d/asset"`, where `d="$(mktemp -d)"`. Reasons: `gh release download <base> exited <rc>`, and `<base> carries no ccrc-<base>.tar.gz and SHA256SUMS`;
     - checksum: `SHA256SUMS` is exactly one line, `<64 lower hex>  ccrc-<base>.tar.gz`, and the tarball's digest equals it (`sha256sum`, or `shasum -a 256` on Darwin, as build-release.sh switches). Reasons: `<base>'s SHA256SUMS is malformed`, and `<base>'s tarball does not match its SHA256SUMS`;
     - extract both tarballs with `tar -xpzf <tarball> -C <dir>` into `$d/base` and `$d/head`. Reason: `could not extract <base>'s tarball` or `… the candidate`;
     - fingerprint both (D-6408). Reasons: `the fingerprint of <base> failed` or `… of the candidate failed`, and `the fingerprint of <base> is empty` or `… of the candidate is empty`;
     - listing the difference: when `comm` or `awk` fails, the reason is `the fingerprints differ, and listing how failed` (as built, after the round's review);
     - equal, compared with `cmp -s`. Equal gives `built unchanged: <N> entries identical to <base>`, where N is the line count. Unequal gives `differs from <base>: <K> entries, first <path>; releasing <tag>`. K counts the distinct paths among the lines `LC_ALL=C comm -3` prints, and `<path>` is the first of them in that order other than `MANIFEST` (`MANIFEST` only when nothing else differs, D-6501), already JSON-quoted in the line.
  3. Act on the choice:
     - **Skip:** `git tag -d <tag>`; write the state `built unchanged` / `same-as <base>` / `head <sha>`; `set_output false`; `say` the line.
     - **Release:** move `$OUT_DIR/candidate/ccrc-<tag>.tar.gz` and `$OUT_DIR/candidate/SHA256SUMS` into `$OUT_DIR`; write the state `built true` / `tag <tag>` / `head <sha>`; `set_output true`; `say` the line.
     - Remove the temp directory before returning.
- **`publish`**:
  - `built unchanged`: `same-as` must match `SHAPE` and be contained in HEAD (`git merge-base --is-ancestor`), and `head` must equal HEAD, or it dies. Then it prints `release-main.sh: no release for this merge — built unchanged, the same as <base>; nothing to push, attest or publish` and exits 0.
  - `built false`: as before.
  - `built candidate`: dies with `release-main.sh: compare never decided on <tag> — refusing to publish an undecided build; nothing was pushed`.
  - `built true`: `head` must equal HEAD, or it dies; then as before.
- **`fingerprint <dir>`** prints one line per entry, `LC_ALL=C sort`ed. Each line is `<JSON path>\t<type>\t<octal mode>\t<size>\t<sha256 or empty>\t<JSON link target or "">`. It is computed by one inline `node -e` program over `node:fs`, `node:path` and `node:crypto`, under the script's `set -euo pipefail`; D-6408 has the rules.

**`.github/workflows/release-main.yml`**, steps in order:
1. checkout (full depth, as before);
2. `setup-node` with no `if:` (cache as before);
3. `name: Derive the next tag and build the candidate`, `run: bash deploy/release-main.sh prepare --out release-out`, with no `env:`;
4. `name: Compare the build with the newest release it contains`, `id: compare`, `env: GH_TOKEN: ${{ github.token }}`, `run: bash deploy/release-main.sh compare --out release-out`;
5. attest, with `if: steps.compare.outputs.release == 'true'` and `subject-path: release-out/ccrc-*.tar.gz`;
6. publish, as before.

No `continue-on-error` anywhere. The comments obey the existing pins: no `npm ci`, `npm run`, `build-release.sh` or `gh release` in the file.

**`deploy/release-stable.sh`**: the zero-tag refusal (D-6398, rewritten) takes `NEWEST` as before and prints one line:

`release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD <short> carries no vX.Y.Z tag<tail>). <why> <where> and cannot move back (fast-forward only); the <first|next> release cut from a descendant of <short> is the next commit it can promote. Nothing was changed`

- `<why>` (amended on review 842, D-6398), chosen by `git diff --name-only HEAD^ HEAD` under the trigger's rule:
  - every path is under `docs/` or is root Markdown: `HEAD's merge changed only docs/ or the root's Markdown, so no release-main run started for it.`;
  - otherwise: `A main merge whose build came out unchanged cuts no release either: the release-main run for <full sha> printed "built unchanged" or what differed.`;
  - no parent, or the diff fails: the pointer form, with `(HEAD's changed paths could not be read)` before its full stop.

- `<tail>` is `; the newest release it contains is <NEWEST>`, or `, and it contains no release tag`.
- `<where>` is `stable now sits past <NEWEST>`, or `stable now points at <short>`.
- The script has no `measure` call and no `node`, `npm` or push command.

**`.github/workflows/release-stable.yml`**: the header comment drops the `release-scope.mjs` sentence. Comments only.

### Rows (each new guard with a mutation measured red; the Mutation table is re-measured whole)

`server/test/release-main.test.ts`:
- **Fixture.**
  - The `scope`, `headScope` and `floor` options go, and so do the copies of `release-scope.mjs`.
  - A new `assets: string[]` option builds each named tag's release asset with the real `build-release.sh` and the stub npm. It clones the fixture into `<home>/asset-build/<tag>`, runs `git checkout -q -B main <tag>` there (or `-B <branch>` when `assetBranch` names one), and copies the tarball and `SHA256SUMS` into `<home>/assets/<tag>/`.
  - `FILES` gains `.github/workflows/release-main.yml`.
  - The gh stub answers `release download <tag> --pattern … --dir <d>` by copying `$HOME/assets/<tag>/*` into `<d>`, and exits `$HOME/gh-download-exit` when that file exists.
  - `release view` keeps its `gh-view` and `gh-view-exit` files. The stub records `GH_TOKEN` for every call.
  - A helper `pipeline(root, home, out, gh)` runs prepare, then compare, then publish, the workflow's order.
- **Rows kept, with `compare` run between prepare and publish:** the refusals, the prepare-then-publish rows, notes, ordering, the missing bundle, the failed publish, the already-tagged HEAD and the leftover local tag. Each has no earlier tag, so compare says `could not compare (HEAD contains no earlier release tag)` and asks gh nothing.
- **New describe** `'release-main.sh: compare — a build identical to the newest release HEAD contains cuts no release (W25 fix round 2)'`:
  - **W25-C1, a docs-only merge skips.**
    - prepare, compare and publish all exit 0. compare's stdout and the summary file read `built unchanged: <N> entries identical to v0.0.1`.
    - The output file reads `release=false`, the local tag `v0.0.2` is gone, and origin received no push.
    - No tarball is at `$OUT_DIR/ccrc-*.tar.gz`, and no `release create` is in the gh argv.
    - publish prints the no-release line.
  - **W25-C2 to C6** each release. The line reads `differs from v0.0.1: <K> entries, first "<path>"; releasing v0.0.2`, the output file reads `release=true`, and the tarball sits in `$OUT_DIR`. The cases:
    - C2: a content change to `ccd/ccrc`;
    - C3: a mode-only change (`ccd/ccrc` to 0644);
    - C4: a symlink's target change;
    - C5: an added entry;
    - C6: a removed entry.
  - **W25-C7:** a `build.json` key other than the three differs. The base is built on another branch, so `ref` differs, and the line names `"build.json"`.
  - **W25-C8:** empty fingerprints on both sides, planted as an empty candidate tarball and an empty base asset. It releases with `could not compare (the fingerprint of v0.0.1 is empty)`.
  - **W25-C9:** no earlier release tag. It releases, and gh is never asked.
  - **W25-C10:** the base release is a draft (`gh-view` true), or its view exits 1. It releases with the reason.
  - **W25-C11:** a base that HEAD does not contain. An equal-content tag on a side branch is the only other tag, so it releases with `HEAD contains no earlier release tag`.
  - **W25-C12:** a failed download (rc 1), a missing `SHA256SUMS`, a malformed `SHA256SUMS`, or a checksum mismatch. Each releases with its reason.
  - **W25-C13:** a revert merge. HEAD's content equals v0.0.1's, and the newest contained release is v0.0.2, so it releases with `differs from v0.0.2`.
  - **W25-C14:** a changed `.github/workflows/release-main.yml` with an otherwise unchanged build. It releases with `v0.0.1..HEAD changes ".github/workflows/release-main.yml", which judges this comparison`, and gh is never asked.
  - **W25-C15:** compare's gh calls carry `GH_TOKEN`. prepare runs no gh.
  - **W25-C16:** each state is bound to its HEAD (D-6500). A commit after prepare makes compare die. A commit after a skipping compare makes publish die. Neither pushes anything.
  - **W25-C17:** publish refuses `built candidate` (compare never ran): exit 1, no push, no gh.
  - **W25-C18:** the attest tripwire. A `ccrc-*.tar.gz` already in `$OUT_DIR` refuses prepare: no tag, no build.
  - **W25-C19:** an unwritable summary or output file never fails compare and prints no shell error (was W25-R18).
  - **W25-C20:** a `build.json` that is not an object releases with `the fingerprint of the candidate failed`.
  - **W25-C21:** the retired arms are usage errors: `decide`, `measure` and `--base` exit 2.
- **Source pins** (`'release-main.sh: source pins'`):
  - P1, the gh spellings above;
  - P2, the five state words: `candidate`, `unchanged`, `contained`, `true` and `false` (as built, review 842 F9);
  - P3, prepare's build literal `deploy/build-release.sh" --out "$OUT_DIR/candidate"`, and no gh in prepare;
  - P4, the guard's two paths, spelled once;
  - P5, `sort -V` spelled once, in `newest`;
  - kept: `set -euo pipefail`, no npm, no `git log`, the named publish argv and the notes file.

`server/test/build-release.test.ts` (`release-main.yml` describe):
- **W25-Y2:** the compare step's exact five lines.
- **W25-Y3:** the step order is checkout, setup-node, prepare, compare, attest, publish, and `setup-node` carries no `if:`.
- **W25-Y4:** exactly two `GH_TOKEN` lines, in compare and publish. The prepare step has no `env:`, and no `continue-on-error` appears.
- The existing attest row asserts `if: steps.compare.outputs.release == 'true'`.

`server/test/release-stable.test.ts`, the W25 describe:
- **W25-T1:** a HEAD past a release refuses with exit 2. The stderr is the one line above: it names `NEWEST`, the full sha and `built unchanged`. There is no gh argv and no node call; the node stub stays poisoned.
- **W25-T3:** a side-branch tag is never named (kept).
- **W25-T4:** sort -V (kept).
- **W25-T5:** no release contained (kept, reworded).
- **W25-T7:** no `git push`, `--force`, `reset` or `<tag>^{commit}` in the stderr.
- **Pin:** release-stable.sh contains no `release-main.sh`, `node ` or `measure`.
- **Removed:** W25-T2 and W25-T6, the measured sentences, and the fixture's `scope` option.

Deleted: `deploy/release-scope.mjs` and `server/test/release-scope.test.ts`. CodeQL alert #175 must read fixed on the PR's own run, and nobody dismisses it.

### Docs, within the consented regions

- **README.md** (consent 8085, now against claim 2259): the pipeline paragraph's `decide` sentences become the build-then-compare mechanism. The promotion paragraph's "and whether anything that ships changed since" becomes the run pointer. The user-facing rule stays.
- **CLAUDE.md** (consent 8081): the "Deploy = release + rollout" bullet's mechanism clause names the fingerprint comparison, not `release-scope.mjs`.
- **The three spec delta notes:** their parenthesis naming `release-scope.mjs`'s `NOT_SHIPPED` becomes the fingerprint comparison, and their last sentence about the refusal drops "and whether anything that ships changed since it".
- **The PR body:** the live proof is ruling 11's four lines.

## As built, fix round 2 (2026-10-22)

**Suite.** `suite: unrun`: no full local run happened after this round's implementation was complete. The PR touches `.github/`, so CI's `select tests` runs the full server suite on the pushed head, and that run is the arbiter.

**Per-file runs at `cfa826d92`,** one file at a time, `--pool=forks --maxWorkers=1`.

| File | Tests |
|---|---|
| release-main | 73 |
| build-release | 47 |
| release-stable | 21 |
| release-notes | 44 |
| update-states | 32 |
| oss-metadata | 29 |
| verify-provenance | 25 |
| workflow-yaml-parses | 17 |
| citations | 4 |
| private-names | 47 |
| topology-clean | 60 |
| dtbd | 1 |
| docs-parity | 54 |
| deviation-refs | 31 (after `git fetch origin main`) |
| single-definition | 836 |
| growth-check | 45 (`GROWTH_CHECK=1`) |
| typecheck-tests | 12 |
| pwa settings-screen | 240 |

**The rows the operator's amendment asked for, before and after.**
- **Before:** W25-F1 and W25-F2 are green on the unmutated tree.
- **After:** W25-F1 goes red, alone, under each of its five mutations: paths-ignore dropped; `'**/*.md'`; `'**/docs/**'`; `workflow_dispatch` added; a `paths:` key added. W25-F2 goes red with `README.md`, and again with `docs`, added to PATHSPEC.

**The round's review (an Opus correctness and security lens)** found no path to a wrong skip and no new attestation hazard. Its fixes:
- the mutation table measured (above);
- rows for a directory's mode, a nested `build.json`, a tree without its top-level files and a MANIFEST without its `build.json` line (W25-C24 to C27);
- the attest gate pinned as a whole line;
- D-6502 and its row W25-C28;
- the `GITHUB_ENV` route recorded in D-6405;
- the interfaces as built recorded in D-6408 and the round's section;
- per-test fixture removal in `release-main.test.ts`, so its end-of-file sweep cannot overrun the hook timeout under load.

**Commits:**
- `fbfdbb244`, `c187760e1`, `2826cdc59`, `834023b4c` and `a5498cb54` (the redesign);
- `af4a8e9c1` (the operator's amendment: plan and docs);
- `dc600cd36` (the review: plan);
- `cfa826d92` (the trigger, D-6502 and the rows);
- this plan's own commit.

## Coordinator rulings on review 842 (2026-10-23)

Verbatim, as received.

Run 793, wave 25: fix round 3, ruled on review 842 (the review's report; read it whole). Record this verbatim in the plan as "Coordinator rulings on review 842 (2026-10-23)", and write the report's path as "the review's report".

The review found no path to a wrong skip, and no attestation of an undecided build. CI ran in full (920 files) and is green, and CodeQL #175 reads fixed. Every finding is a guard that no row reds, or a text the amendment made false. All eleven are fixed in this round.

Deviations: amend D-6398, D-6408, D-6409, D-6502 and D-6512 in place, each saying "amended on review 842". D-6503 upward are your reserve for this round, spent in order. Before wave-done, give each unspent number its own entry in the house form: the number, an em-dash, `unused` (run 793): issued to this wave; no departure took it. That replaces the prose line at plan:219.

1. F1, release-stable on a docs-only head (amends D-6398).
- Whether a release-main run exists for HEAD depends on HEAD's own merge, not on the range since the release. So measure git diff --name-only HEAD^ HEAD, under the same root-anchored rule as the trigger ('docs/**', root '*.md').
- When every path matches, the refusal says HEAD's merge changed only docs/ or the root's Markdown, so no release-main run started for it, and names the newest release HEAD contains.
- Otherwise it points at the run for HEAD's sha, as now.
- If HEAD has no parent, or the diff fails, take the pointer form and say the paths could not be read.
- Keep exit 2, no gh call, and no push or rewind command.
- Re-pin W25-T1 for both cases. Fix the same pointer in the script header, README:781-782, the plan's interface text and the three spec delta notes.
2. F2, F3 and F4, the fingerprint walk (amends D-6408). Each gets a row whose mutation turns a real shipped change into "built unchanged":
- F2: a link retargeted between two byte-identical files; mutation lstatSync to statSync.
- F3: a setuid file and a sticky directory; mutation 0o7777 to 0o777.
- F4: a mode change on a dot-named entry; mutation: skip names starting with '.'.
3. F5 (amends D-6409): a row in which git diff against the base fails, expecting `could not compare (git diff against … failed)`. Also add a behaviour row where the judged change is older than HEAD~1, so narrowing the range to HEAD~1 HEAD reds a behaviour row, not only the spelling pin.
4. F6 (amends D-6502): a row in which a tag that is not release-shaped (vnext, v1.2.3-rc1) contains HEAD. The release is decided by compare. Mutation: newest to tail -n1.
- The shape-only contained check stands, as the refuters argued: the lane never leaves a release-shaped tag without its release.
5. F7, the docs pin, by behaviour (amends D-6512).
- W25-F2 builds the fixture tarball with build-release.sh, in a fixture repo that carries docs/x.md and a root README.md. It asserts that tar -t lists no entry matching ^docs/ or a root .md.
- So it catches every form the review listed: array literals, PATHSPEC+= after the loop, globs, '.', './docs', and cp -a "$ROOT/…".
- Measure all thirteen of the review's mutations red, one at a time. The workflow comment and D-6512 then say what the row checks.
6. F8, the mutation table.
- Rows for (i), the listing-failure check behind "the line is never empty", and (iii), `!= false` loosened to `= true`, with an empty, null or garbage gh answer at exit 0.
- Add the four real rows the table misses: the failed download, the missing base, the gh-view exit check, and publish's contained-in-HEAD check.
- Name (ii), (iv) and (v) in the table as guards with no row, each with its reason (the outcome is unchanged; backstopped by :460; it predates this wave).
- Correct the count: the table had 46 rows, not the wave-done's 50, and "Survivors: none" holds only for the listed rows.
7. F9, F10 and F11, and the stale texts.
- F9: the plan's interface prints `… HEAD is already contained in <tag>` for contained, and "P2, the five state words".
- F10: CLAUDE.md:297-298 reads "which holds for a main head whose merge released".
- F11: README:66 reads "a merge that changes only docs/ or the root's Markdown starts no release run".
- Remove the stale "W25-Y1: no trigger filter (kept)" bullet at plan:1228.
- The dated child-reclamation record that says "no paths filter" stays as history.
All of these sit inside the consented README and CLAUDE.md regions (8085, 8081; owner claim 2278 replaced 2259). Re-read ownership before Task 4.

Gates as before, one file at a time. Measure every new row red, then green, and give the before and after in the wave-done. Landing as before: first-ready, measuring merge-tree against main and #1137's head. Send wave-done in the same turn as the push.

## As built, fix round 3 (2026-10-23)

**Suite.** The round's first full run is CI's on the pushed head: the PR touches `.github/`, so `select tests` runs the whole server suite. Review 842 read CI's full run at `d1754c19c` green, with 920 of the 920 server files. No full local run happened.

**The eleven findings, each fixed:**
- F1: release-stable tells a docs-only head from one with a run (D-6398 amended). Rows: W25-T1, T1b, T1c, T1d and T5.
- F2, F3 and F4: rows W25-C29, C30 and C31 (D-6408 amended).
- F5: W25-C32 and C33 (D-6409 amended).
- F6: W25-C34 (D-6502 amended).
- F7: W25-F2 builds the tarball and lists it, and all thirteen of the review's mutations red it (D-6512 amended).
- F8: W25-C35 and C36, the four missing real rows (X9 to X12), the guards with no row named, and the count corrected.
- F9: the interface texts as built.
- F10: CLAUDE.md's stamp sentence.
- F11: README's feature row names the trigger's patterns.
- The stale W25-Y1 bullet is removed.

**Rows, before and after** (the Mutation table holds every after):
- Before: every new row was green on the round's code. W25-T1b and W25-T5 were red on the previous release-stable script (Y0), and green after its fix.
- After: each new row reds under its mutation, X1 to X12, Y1 to Y6, and F7 (a) to (m).

**Per-file runs at `e99d426a8`,** one file at a time, `--pool=forks --maxWorkers=1`:

| File | Tests |
|---|---|
| release-main | 87 |
| build-release | 46 |
| release-stable | 24 |
| release-notes | 44 |
| update-states | 32 |
| oss-metadata | 29 |
| verify-provenance | 25 |
| workflow-yaml-parses | 17 |
| citations | 4 |
| private-names | 47 |
| topology-clean | 60 |
| dtbd | 1 |
| docs-parity | 54 |
| deviation-refs | 31 |
| single-definition | 836 |
| growth-check | 45 |
| typecheck-tests | 12 |
| pwa settings-screen | 240 |

**Commits:** `48828c125`, `b6173945e`, `a53127cab`, `a4ab632fa` and `e99d426a8`, and this note's own.
