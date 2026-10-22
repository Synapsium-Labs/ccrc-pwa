# Centralised update management, wave 25: a merge that changes nothing that ships cuts no release: Implementation Plan

On 2026-10-22 the operator ruled, verbatim: "Docs only updates with no changes to code (PRs) should not trigger new build versioning". The coordinator cut wave 25 the same day as run 793 and issued a block of twenty deviation numbers starting at D-6390 (see the programme ledger's wave-25 bullets). Every citation below is `path:line` at the pinned base `93f1c459b`, read with `git show 93f1c459b:<path>`. The worker re-reads each one in the landed text before editing it.

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

Each guard this wave adds, the mutation that removes or weakens it, and the row that goes red. The worker measures each one once, before and after (mutate, run the row, see red, restore), and records the result in the as-built note.

| Guard | Mutation | Red row |
|---|---|---|
| `notShipped`'s tree boundary | `p.startsWith(tree)` without the `/` | W25-S1 (`server/testx/a.ts`, `docsx/a.md`) |
| Root rules match the root only | `*.md` matched at any depth | W25-S1 (`ccd/worker-skill/SKILL.md`, `agent/CLAUDE.md`) |
| `--no-renames` | flag dropped | W25-S6 |
| Base is the tag, not the last commit | diff `HEAD^` against `HEAD` | W25-S8, W25-R5 |
| The dash guard | the leading-`-` check deleted | W25-S9 (`--output=` leaves a file and answers `unchanged 0`) |
| The README names exactly the list | a seventh rule added to `NOT_SHIPPED` only | W25-S13 |
| Overlap guard | `shippedViolations` returns `[]` | W25-G3 (every case) |
| tsconfig `paths`/`typeRoots` are inputs | those entries not added | W25-G3 (the two tsconfig cases) |
| Unparsed growth refuses | the count checks deleted | W25-G4 (the `PATHSPEC+=` and `npm run` cases) |
| build-release.sh totality | the `"$ROOT"` line scan deleted | W25-G4 (`cp -a "$ROOT/LICENSE"`, a second `archive`) |
| The package-script model | the `scripts` comparison deleted | W25-G4 (postbuild, `-p`, `prepare` cases) |
| `file:` dependencies are modelled | the `file:` check deleted | W25-G4 (`file:../docs`) |
| vite path keys refuse | the key check deleted | W25-G4 (`publicDir`) |
| Import escape, JS/TS | `importEscapes` returns `[]` | W25-G5 (the two planted escapes) |
| Import escape, CSS, HTML, triple-slash, `file:` names | each extractor deleted | W25-G5 (its own planted case) |
| Symlink escape | `linkEscapes` returns `[]` | W25-G6 |
| Only a positive answer skips | skip on `[ "$CHANGE" != changed ]` | W25-R8, W25-R9 |
| rc is part of the answer | rc ignored | W25-R9 (`exited 3`) |
| The base's helper must agree | the second `scope_ask` deleted | W25-R15 |
| A base with no helper is unmeasured | the `git show` failure read as agreement | W25-R16 |
| Published-base check | `base_published` always returns 0 | W25-R10 |
| Own state word | the skip writes `built false` | W25-R1 (state bytes) |
| publish returns before the bundle refusal | the `unchanged` branch moved after the bundle check | W25-R1 (publish exit 0) |
| `same-as` validated | the SHAPE check dropped | W25-R13 |
| The attest tripwire | `compgen` check deleted | W25-R12 |
| prepare skips only on exactly `same-as <highest>` | skip on any `same-as` line | W25-R17 (the stale `same-as v0.0.9` case) |
| Summary line | the append deleted from `say` | W25-R1, W25-R3 (summary file) |
| A failed append never fails the run | the `|| :` dropped | W25-R18 |
| The cache gate's output | `set_output` deleted | W25-R1 (`build=false`), W25-R3 (`build=true`) |
| The token reaches gh | `unset GH_TOKEN` added to `decide` | W25-R14 |
| The helpers never see the token | the `env -u` prefix dropped from `scope_ask` | W25-R24 |
| Only the decision file is excused from the dirty check | the exclusion widened (`-x` dropped, or every `??` line) | W25-R23 (the straggler case) |
| The in-tree decision is consumed before the build | the `rm -f` deleted | W25-R23 (the shipped case) |
| prepare makes no gh call | prepare calls `base_published` | W25-P4 |
| The list lives only in the helper | a `docs/` literal in the script | W25-P3 |
| No trigger filter | `paths-ignore: ['docs/**']` added | W25-Y1 |
| The token sits on `decide` | the `env:` block removed | W25-Y2 |
| Decide runs before the toolchain, which a skip leaves out | `setup-node` moved above `decide`, or its `if:` dropped | W25-Y3 |
| The prepare step carries no token | `env: GH_TOKEN` added to prepare | W25-Y4 |
| The node floor is checked | the floor check deleted from `measure_change` | W25-R20 |
| An unreadable floor is not a pass | `node_floor_ok` returns 0 when no floor is read | W25-R21 |
| An unreadable node version is not a pass | `node_floor_ok` returns 0 when the version does not parse | W25-R22 |
| release-stable never promotes a contained release | promote `NEWEST` on `unchanged` | W25-T1 (exit 0, `ghArgv` not `[]`) |
| release-stable names a contained tag | `--merged HEAD` dropped | W25-T3 |
| release-stable ranks versions | `sort -V` becomes `sort` | W25-T4 |
| An unmeasured answer reads as changed | the `unmeasured` case worded as `unchanged` | W25-T6 |
| No rewind is printed | `git push origin $NEWEST^{commit}:refs/heads/stable` printed | W25-T7 |
| The channel note | old copy restored | `settings-screen.test.tsx` `'the labels read spec …'` |

## Deviations found

These twenty numbers, starting at D-6390, were issued to run 793. This plan defines the first sixteen, in order: D-6390 to D-6402 from the coordinator's draft, and D-6403 to D-6405 from the worker's reserve (D-6403 for the ruling on Reading 10; D-6404 and D-6405 for what Task 2's reviews found). D-6406 to D-6409 remain the worker's reserve.

- **D-6390.** The rule is "a merge whose shipped build would be unchanged cuts no release". It is implemented as a deny-by-default classifier over changed paths (option (a)). Measuring the artifact (option (b)) is rejected for this wave.
  - (a) answers before the local tag. Nothing is tagged, built or attested, so the attest step's existing `hashFiles` skip covers it with no YAML expression changed. (b) builds first, so its tarball must be moved out of the attest glob before that step runs. A mistake there mints a public transparency-log entry for a digest no release publishes, and that cannot be undone.
  - (b) compares against the previous release's MANIFEST, which exists only inside its tarball. So every merge would download that tarball, which means a token or network call on every merge, not only on would-skip ones. The MANIFEST also has no file modes (`build-release.sh:195-198`), so (b) would need a second listing for the 48 executables, and it must drop `build.json`'s line, whose `builtAt` always differs.
  - (b) depends on dist reproducibility, which is unmeasured at the base (vite, rolldown and the workbox precache). If the dists are not reproducible, (b) never skips. That is safe, but the directive would then go unmet with no signal.
  - (a) is safe in the direction that matters. Only a path on a short, explicit list can skip. Every other path, known or new (`ui/`, `.github/`, a new top-level directory), releases. The one way (a) skips a real change is a build that reads a `NOT_SHIPPED` path. D-6396's guard refuses that for every read it models: build-release.sh's `"$ROOT"` reads, the package scripts npm runs, each tsconfig's `include`, `paths`, `rootDirs` and `typeRoots`, the vite configs' URL targets, `file:` dependencies, tracked symlinks, and the relative paths in input JS/TS, CSS and HTML. Any shape outside that model makes the guard throw. Reads it cannot model are named in the Risk notes.
  - (a) is cheaper: a docs merge spends two `git diff`s and one `gh release view`, not a build. And it is testable hermetically in the existing fixture harness.
- **D-6391.** `NOT_SHIPPED` holds exactly six rules, each with a `why`: the tree `docs`; every root-level `*.md`; the root file `LICENSE`; the trees `server/test`, `server/test-e2e` and `agent/test`.
  - Test trees are included on the coordinator's reading ("test-only merges for the same reason"). Each lies outside its package's `tsconfig.json` `include` (`server/tsconfig.json:7`, `agent/tsconfig.json:7`) and outside `PATHSPEC`. A test-only fix after a red stable gate is not promotable until a release contains it (D-6398, the ruling on Reading 6).
  - `pwa/test` is NOT included: `pwa/tsconfig.json`'s `include` names `test`, so pwa's `tsc --noEmit` reads it. A pwa test change can break the build, and it releases.
  - Nested docs are NOT included (`agent/CLAUDE.md`, `ui/README.md`, `pwa/design/`, `.design-sync/`, `.superpowers/`, `.github/pull_request_template.md`). Each is one more rule, and each is the coordinator's call (Reading 3).
  - `.github/` releases: it carries the build's environment (the Node pin, the job env).
  - A tree rule matches the path itself or a path below `<tree>/`, never a sibling with the same prefix (`server/testx/a.ts`, `docsx/a.md`). A root rule matches only a path with no `/`.
- **D-6392.** The base is the tree of the highest release tag, the same `highest` that `prepare` derives (`release-main.sh:78`), now derived once by `derive_tags` for both arms. The helper runs `git diff --no-renames --no-ext-diff --name-only -z <base>^{commit} HEAD --`. Never `HEAD^`, the push's before and after, or a `paths-ignore` filter.
  - The diff compares trees, so ancestry does not matter. A failed earlier release's change stays inside the range until some release contains it. GitHub's concurrency cancelling a pending code-merge run in favour of a later docs merge loses nothing either: the docs run's range still holds the code.
  - `--no-renames` lists both sides of a rename, so moving a shipped file into `docs/` counts its deleted side as shipped.
  - `--name-only` lists a mode-only change, so a chmod releases.
  - The base must be a published, non-draft release: `gh release view "$tag" --json isDraft --jq .isDraft` must exit 0 and print exactly `false`. A tag with no release behind it (a failed `release.yml` run, a trap whose tag delete failed) would otherwise let a docs merge skip a change nobody ever published. The call runs only when both helpers answered `unchanged`, and only in `decide`.
- **D-6393.** Only a positive answer skips. The helper prints exactly one line and exits 0: `unchanged <n>` (n = every changed path, each not shipped, which may be 0) or `changed <n> <first>` (n = the shipped paths, at least 1; first = the first shipped path in git's order, JSON-quoted). On any failure it exits non-zero with stdout empty.
  - `scope_ask` accepts `unchanged` only on rc 0, one line, first word `unchanged`, an all-digit count and nothing after it.
  - Every other answer releases with the reason in the line: rc non-zero, a second line, another word, a malformed count.
  - No exit code means "unchanged". A crashed `node` exits 1, and that must never read as a skip.
- **D-6394.** The skip has its own state, `built unchanged` then `same-as <tag>`. It never reuses `built false`.
  - `built false` already means "HEAD was tagged at checkout; release.yml owns it" (`release-main.sh:69`). Folding a second condition into the same value at the prepare/publish seam is the overloaded-null defect this repo forbids.
  - `same-as` is a new key, not `tag`, because the tag it names is not this run's.
  - `publish` returns on `built unchanged` before the bundle refusal, after checking that `same-as` matches `SHAPE`, otherwise it reports malformed.
  - Before writing that state, `prepare` refuses (exit 1, no state written) if any `ccrc-*.tar.gz` already sits in `$OUT_DIR`. The attest step would sign it, and no release would publish it.
  - The decision file `decide` leaves, `$OUT_DIR/release-main.decision`, holds exactly `release` or `same-as <tag>`. `prepare` skips only on exactly `same-as <highest>`, with `highest` derived again. An absent, malformed or stale file releases, and its line says which.
- **D-6395.** Every decision prints one line to stdout and appends the same line to `$GITHUB_STEP_SUMMARY` when that is set and non-empty. A failed append never fails the run: the append is wrapped `{ …; } 2>/dev/null || :`, so an unwritable summary prints no shell error either. The lines are fixed in Task 2's Interfaces, one per outcome.
  - The test harness sets `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` by default, and a row that measures either passes its own file. Without that, a CI test job that inherits the variables writes fixture lines into its own summary and outputs.
- **D-6396.** The guard test derives build-release.sh's inputs from the files the build actually runs, and it fails red in four ways.
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
  - Such a filter would be a second, hand-kept list.
  - GitHub evaluates it over the push's own range, which reintroduces the failed-release hazard of D-6392.
  - The existing trigger regex would let one pass unnoticed (`build-release.test.ts:658`, `m` flag, ends at `$`).
- **D-6398.** `release-stable.sh` still promotes only the release tagged at HEAD: design 2026-09-20 decision 3 ("the tag at HEAD is the whole input") stands, by the coordinator's ruling on Reading 6. On a HEAD with no release tag it refuses, exit 2, before any `gh` call, as before. What changes is that the refusal now says what is true.
  - Why the message changes: once docs- and tests-only merges cut no release, `main`'s head often carries none, and the old message's only cause, "a merge commit", is no longer the usual one. The push has already moved `stable` to HEAD when the script runs, and the ruleset refuses the force push a rewind would need (D-3130), so the message names the way forward: the next release cut from a descendant of HEAD, pushed by fast-forward.
  - The arm: when HEAD carries no release tag, take `NEWEST="$(git tag --merged HEAD | grep -E "$SHAPE" | sort -V | tail -n1)"`. With none, the reason is that HEAD contains no release tag. With one, run `bash "$ROOT/deploy/release-main.sh" measure --base "$NEWEST"`, so there is one classifier, one two-helper rule (D-6402) and one node floor (D-6403). The answer only chooses the sentence, never the exit: `unchanged` says HEAD's merges since `NEWEST` changed nothing that ships, so no release was cut for them; `changed` says HEAD changed what ships and the release-main run for its merge should be checked; `unmeasured`, a non-zero exit or any other answer says it could not be measured, reads it as changed, and says the same.
  - The message keeps the existing prefix, names `NEWEST` as the newest release HEAD contains, never as something to push, and prints no rewind or force command. Its only command is the placeholder `git push origin <tag>^{commit}:refs/heads/stable`, where `<tag>` is literal text for a release not yet cut.
  - D-3129's count check on HEAD's own tags is unchanged. `NEWEST`'s commit is never promoted, so no count is taken there.
  - Consequence, stated: a test-only fix after a red stable gate cuts no release (D-6391), so nothing is promotable until a release contains it: the next merge that changes what ships, or a hand-cut `vX.Y.0` tag, which `release.yml` always builds.
  - No network is needed: the promote job checks out at full depth (`release-stable.yml:106`) and runs the helper with the runner's own node, as the gate runs `main-artifact.mjs`.
- **D-6399.** Every text that states "every merge is a release" is corrected in place: README, CLAUDE.md, the two script headers, the workflow headers, the `shared/api.ts` docstring, the PWA channel note with its pin, and the radio story.
  - The three specs get one dated delta note each and keep their sentences. Specs are dated history; a note keeps the decision record honest without rewriting it.
  - The PWA note becomes `Every merge that changes the build, minutes after it lands.` (Reading 5).
  - `NOT_SHIPPED`'s rules are enumerated in exactly one live text, README's pipeline paragraph, and W25-S13 holds it to the helper. CLAUDE.md and the skip line name the list by symbol only. The spec delta notes carry a dated copy as history.
- **D-6400.** Downstream effects that this wave states and does not fix:
  - **Gate evidence.** `ci.yml`'s daily full run tests `main`'s head (`ci.yml:214-229`). `isTrustedFullSuiteRun` (`.github/ci/main-artifact.mjs:85-95`) needs the exact sha. Pushing a release's own tag commit to `stable` while `main`'s head is an unreleased merge therefore runs the gate's `full` mode (about an hour). Pushing `main`'s head instead is refused when that head carries no release (D-6398), so while `main`'s head is an unreleased merge a promotion pays the gate's full run. The README says so.
  - **A push to `stable` that cannot promote.** A tagless HEAD still runs the gate, possibly `full`, before `promote` refuses, and it leaves `stable` past the newest release it contains until a later release contains HEAD. The refusal says so.
  - **Unversioned heads, and the lost update floor.** `deploy.sh`'s `stamp_build` (`deploy/deploy.sh:263`) and `_inst_stamp` (`ccd/ccrc:15811-15814`) stamp `version` only from a tag at HEAD. A checkout of an unreleased head therefore stamps none. The PWA shows that box amber (`ui/src/components/build-line.tsx:20-30`), and a source install of it is named `untagged-<sha12>` (`_inst_version_name`, `ccd/ccrc:14301`). `_inst_floor` raises no floor from it (`ccd/ccrc:17772-17779`), and notify counts it behind every release (`server/src/update/notify.ts:89-93`). So a later bare `ccrc update` can move such a box to an older stable release with no `--downgrade` refusal; only the health gate stands behind it. Before this wave `main`'s head carried a tag within about a minute of nearly every merge. Now a README-quickstart clone taken while the head is a docs merge gets no floor. This wave changes the README (Task 4) to point a checkout install at a release tag or `--release`. Stamping the newest contained release tag when `release-scope.mjs` says nothing that ships changed is a follow-up, because it lifts "`ccd/ccrc` and `deploy.sh` untouched" (Reading 9).
  - **Needless releases (fail toward releasing).** These still mint a release whose shipped tree is identical:
    - a merge that touches only paths outside the six rules that the build does not read either: `agent/CLAUDE.md`, `ui/README.md`, `pwa/design/`, `.design-sync/`, `.superpowers/`, `.github/pull_request_template.md`, root dotfiles such as `.gitignore`, and the vitest configs. Also `pwa/test`, which pwa's `tsc` does read;
    - a docs merge while the highest tag has no published release: an in-flight or failed `release.yml` minor, or an orphan tag left by a failed cleanup;
    - a docs merge while `gh` or the API is down;
    - a docs merge whose base predates the helper. This wave's own merge changes `deploy/`, so it releases, and its release carries `deploy/release-scope.mjs`; so only a docs merge landing while that release run is still in flight or has failed hits this (corrected after the whole-branch review: the first docs-only merge after a successful release here should skip).

    None of these is a classifier miss, and the coordinator should not read one as a miss during the live proof.
  - **Release notes.** The next release's notes list the skipped `docs(…)` commits under "Behind the scenes", within `NOTES_BUDGET_BYTES`. That is correct: the release contains them.
  - **No change.** The update catalogue, the resolver, notify's reading of published releases, the inventory, `ccrc rollout`, `rollback`, `RUNS_ATTRIBUTION_SINCE` (`shared/api.ts:9490-9501`, measured by `git tag --contains`, which still holds) and `landing.ts`.
- **D-6401.** The decision is its own workflow step, `decide`, placed before `setup-node`. It runs with the runner's own node and holds the job's only `GH_TOKEN` before publish.
  - The token: a token on the prepare step would sit in the environment of the step shell that runs `npm ci`. `unset` inside the script cuts inheritance, but every process of the same user can still read the step shell's `/proc/<pid>/environ`. So this wave adds no `GH_TOKEN` to a step that runs `npm ci`. `decide` installs nothing and runs only bash, git, gh, the first-party helper and the base's copy of it, and both helpers run with the token and the workflow-command files removed from their environment (`scope_ask`, W25-R24).
  - What this does not claim (corrected by D-6405): that the `npm ci` step reaches no token. The checkout's persisted credential and the job's OIDC request token reach it, as they did before this wave.
  - The cache: a skipped merge runs no npm. With `setup-node`'s `cache: npm` the post step would then try to save an `~/.npm` that, on a cache miss, does not exist, and it can fail the job. `setup-node` therefore runs only on `if: steps.decide.outputs.build != 'false'`. An absent output (`decide` did not write one) still sets up the toolchain, so the build path is the default.
  - `decide` writes `build=false` to `$GITHUB_OUTPUT` only when it records `same-as`, and `build=true` otherwise. The prepare step reads the decision file, not the output.
  - After the whole-branch review: the `decide` step carries `continue-on-error: true`, so a crashed `decide` fails toward releasing (its output is absent, `setup-node` runs, and `prepare` finds no decision and releases). Pin W25-Y2 holds the line.
- **D-6402.** `unchanged` needs the base's classifier to agree. After HEAD's helper answers `unchanged`, `measure_change` writes `git show <base>:deploy/release-scope.mjs` into a fresh `mktemp -d` directory and asks that copy the same question. It skips only if both answer `unchanged`.
  - A merge that changes the classifier changes `deploy/`, so the old helper answers `changed`, whatever HEAD's copy says. A defect in HEAD's `notShipped` cannot vouch for its own merge. Once that merge has released, its helper is the next base's, so later merges rest on D-6396's guard and on review, not on this rule (corrected after Task 2's security review). Nor does the rule hold against a hostile merge: `release-main.sh` and the workflow run from HEAD, so a merge that edits `decide` can force a skip whatever either helper says. It guards against an accidental classifier defect.
  - A base with no helper (every tag cut before this wave) is unmeasured, and the merge releases.
  - The temporary directory is removed in the same function, and it is never under `$ROOT` or `$OUT_DIR`.
- **D-6403.** The runner's own node is trusted only at or above the repository's engines floor (the coordinator's ruling on Reading 10). `measure_change`, which both `decide` and `measure` run, first calls `node_floor_ok`. Below the floor, or when either version cannot be read, the answer is `unmeasured`, so `decide` releases and `measure` says so.
  - The floor is read from `$ROOT/server/package.json`, never written as a second literal: exactly one match of `"node"` followed by `:` and a `">=X.Y.Z"` value. No match, more than one, or another range shape is unreadable.
  - The version is `node --version`, which must exit 0 and print exactly `vX.Y.Z`. The comparison is numeric, field by field, in bash, so `sort -V` stays spelled once (W25-P5).
  - The reasons, carried into the unmeasured line: `node <version> is below server/package.json's engines floor >=<floor>`, `node --version exited <rc>`, `node --version answered '<first 80 chars>'`, and `server/package.json names no readable engines floor`.
  - It sits in `measure_change` rather than `decide` alone, so `release-stable.sh`'s use of `measure` (D-6398) is held to the same floor, with one check and one place.
- **D-6404.** The workflow's `release-out` lies inside the checkout and is not gitignored, so the decision `decide` writes there is an untracked file. Both `prepare`'s dirty-tree refusal and `build-release.sh`'s would refuse every real run on it. The fixtures keep their out directory outside the repository, so no briefed row could see it (found by Task 2's implementer).
  - `prepare`'s dirty check (`git status --porcelain -uall`) drops exactly one line, `?? <the decision file's path>`, and only when that file lies under the checkout (`decision_in_tree`). A decision directory that is the checkout root itself matches nothing, so it still refuses.
  - On the release path, `prepare` removes the in-tree decision file before `git tag`: it has already read it, and nothing reads it again. So `build-release.sh` sees a clean tree, unchanged.
  - Rejected: gitignoring `release-out/`, which would also relax `build-release.sh`'s refusal of its own leftovers on a local second run, and moving the decision outside the work tree, which would change every row and the README's naming of it. Row W25-R23.
- **D-6405.** Stated, not fixed: the persisted `actions/checkout` credential (the job's `contents: write` token, in `.git/config`) and the job's OIDC request token (`id-token: write` puts `ACTIONS_ID_TOKEN_REQUEST_*` into every run step) reach every step of `release-main.yml`, prepare's `npm ci` included. A hostile install script could push with the first and could mint a signing certificate for `release-main.yml@refs/heads/main`, the identity every box's updater verifies, with the second. Both predate this wave, which neither widens nor narrows them (Task 2's security review).
  - D-6401's text and the decide step's comment now say so.
  - The follow-up, for the coordinator: split the build into its own job (`contents: read`, no `id-token`) that uploads `release-out/`, with `persist-credentials: false` on checkout and publish authenticating its own push. `release.yml` shares the shape and the question.

## File structure

- `deploy/release-scope.mjs` (new, Task 1). It imports only `node:` modules. It has JSDoc types so `typecheck-tests` sees the shapes. Its CLI is guarded by the `process.argv[1]` check that `release-notes.mjs:204` uses.
- `server/test/release-scope.test.ts` (new, Task 1; one row added in Task 4), with four describes:
  - `'release-scope.mjs: what is not shipped (W25-a, D-6391)'`;
  - `'release-scope.mjs: the answer over a real repo (W25-a, D-6392, D-6393)'`;
  - `'NOT_SHIPPED never covers what build-release.sh builds from (W25-a, D-6396)'`;
  - `'README names exactly NOT_SHIPPED (W25-d, D-6399)'`.
- `deploy/release-main.sh` (Task 2): new `say`, `set_output`, `derive_tags`, `scope_ask`, `measure_change`, `base_published`, `decide` and `measure`, plus `prepare`, `publish`, the argument loop, the dispatch and the header.
- `.github/workflows/release-main.yml` (Task 2): the `decide` step, the gated `setup-node`, and the comments.
- `server/test/release-main.test.ts` (Task 2):
  - `fixture()`, `plantBin()` and `run()` change as Task 2 Step 1 says;
  - a new describe after `:328`, `'release-main.sh: a merge that changes nothing that ships cuts no release (W25-b)'`;
  - new pins inside `'release-main.sh: source pins'`.
- `server/test/build-release.test.ts` (Task 2): four rows in the `release-main.yml` describe (`:652`).
- `deploy/release-stable.sh`, `.github/workflows/release-stable.yml`, `server/test/release-stable.test.ts` (Task 3): rows in `'release-stable.sh: what it refuses'` (`:97`).
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

- [ ] **Step 1: Write the failing rows** in `server/test/release-scope.test.ts`. Import `{ NOT_SHIPPED, notShipped, decide }` from `'../../deploy/release-scope.mjs'` (the import style of `history-replay.test.ts`). Repo fixtures use the `GIT_ENV` and `git()` shape of `release-main.test.ts:22-32` under `mkTmp`. The CLI runs through `spawnSync('node', [HELPER, '--repo', root, '--base', base], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' })`, so `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are `/dev/null` and a developer's `diff.renames` cannot change an answer.

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

- [ ] **Step 2: Write the guard rows** in the third describe. These test-local functions are this task's decisions:

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

- [ ] **Step 3: Run the file and confirm red.** `cd server && timeout -s INT 560 ./node_modules/.bin/vitest run test/release-scope.test.ts --pool=forks --maxWorkers=1`. Expected: it fails to import `release-scope.mjs`.

- [ ] **Step 4: Implement `deploy/release-scope.mjs`** to the Interfaces above. The header names D-6390 to D-6393 and D-6402, and says this is the one list (the `#NOT_SHIPPED` symbol), consulted by `release-main.sh#measure_change`. It also says that a base tag's own copy of this file is run by `release-main.sh` and by the runner's own node, so it stays dependency-free. `main(argv)` returns the exit code. Each rule's `why` is one short clause (for example `'tests: outside server/tsconfig.json include; tsc and vite never read it'`).

- [ ] **Step 5: Run until green.** Same command. If W25-G2, W25-G5 or W25-G6 is red at the checkout, a build input really does reach a `NOT_SHIPPED` path. If W25-G1 throws at the checkout, the base has a build shape this plan did not measure. Either way, stop and report it to the coordinator. Never narrow the guard.

- [ ] **Step 6: Commit.** `git add deploy/release-scope.mjs server/test/release-scope.test.ts && git commit -m "feat(release): one list of what never ships, held against build-release.sh's own inputs (D-6391, D-6396)"`.

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

- [ ] **Step 1: Change the harness** (`release-main.test.ts:39-129`), and nothing else in the existing rows' assertions.
  - `fixture()` gains `merge?: (root: string) => void`. It runs before `'the merge under release'` is committed with `git add -A` and without `--allow-empty`. The default writes `ccd/ccrc` as `'#!/usr/bin/env bash\necho the merge\n'` at mode 0755, a shipped change, so every existing release row still releases.
  - `fixture()` writes `server/package.json` into the `'first'` commit, holding the real `server/package.json`'s `engines` object, read at test time and never spelled as a literal (D-6403). It gains `floor?: string | null`: a string replaces `engines.node`; `null` writes `{}`.
  - `fixture()` also gains `after?: (root: string) => void` (commits `'a docs merge after it'` when given), `scope?: false | string` and `headScope?: string`. By default the real helper is copied beside the script, as `NOTES` is (`:62-64`), into the `'first'` commit, so every tag carries it. `false` leaves it out; a string plants that text as the helper in `'first'`. `headScope` writes that text over `deploy/release-scope.mjs` in the merge commit only.
  - `plantBin()`'s `gh` stub still records every argv to `$HOME/gh-argv`. For `release view` it also appends `GH_TOKEN=${GH_TOKEN:-unset}` to `$HOME/gh-env`, and prints `$HOME/gh-view` (default `false`), or exits with `$HOME/gh-view-exit` when present. Everything else exits `ghExit`, as now. `plantBin` gains `GhView = { view?: string; viewExit?: number }`, threaded through `run()`.
  - `run()` spreads `GITHUB_STEP_SUMMARY: ''` and `GITHUB_OUTPUT: ''` after `process.env` and before `extraEnv`.
  - A new `decideThenPrepare(root, home, out, gh?, env?)` runs `decide --out <out>` and then `prepare --out <out>` and returns both results.
  - The derive row (`:197`) runs `decide --out <out>` before its `prepare`, and gains `expect(d.stdout).toContain(…)` of the changed line, with first `"ccd/ccrc"`, n 1 and `highest` = the row's highest release-shaped tag. For `[]` it is the first-release line. Its existing `gh-argv` absence check after prepare stays, because a `changed` answer never calls `gh`.

- [ ] **Step 2: Write the failing rows** in the new describe. Each runs `decideThenPrepare` unless it says otherwise.
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
  - **W25-R24** (the helpers never see the token): a planted helper (`scope`) answers `changed` when `GH_TOKEN` or `GITHUB_OUTPUT` is in its environment and `unchanged 0` otherwise. With `GH_TOKEN` and `GITHUB_OUTPUT` set on decide, the merge skips (`same-as v0.0.1`), and `gh-env` still reads the token.
  - **W25-R19** (the measure arm): `measure --base v0.0.1` on a docs-only `merge` prints exactly `unchanged 2\n`, exit 0, with `gh-argv` and `npm-argv` absent and no `release-main.decision` written. On the default `merge` it prints `changed 1 "ccd/ccrc"\n`. With `scope: false` it prints `unmeasured release-scope.mjs exited 1\n`. `measure --base junk` and `measure` with no `--base` exit 2, and `prepare --base v0.0.1` exits 2.

- [ ] **Step 3: Write the failing pins.**
  - In `'release-main.sh: source pins'`:
    - **W25-P1**: `src()` contains `node "$helper" --repo "$ROOT" --base "$base"`, `git -C "$ROOT" show "$base:deploy/release-scope.mjs"` and `gh release view "$tag" --json isDraft --jq .isDraft`.
    - **W25-P2**: `src()` contains both `printf 'built unchanged\nsame-as %s\n'` and `printf 'built false\ntag %s\n'`.
    - **W25-P3**: `src()` with every `#`-comment line removed does not match `/\bdocs\/|test-e2e|server\/test|agent\/test|\*\.md|['"]LICENSE['"]/`, because the list lives in the helper. The skip line names the list by symbol and spells none of it.
    - **W25-P4**: `prepare`'s body (from `prepare() {` to its closing `^}`) contains neither `gh ` nor `base_published` nor `GH_TOKEN`. The step that runs `npm ci` makes no `gh` call.
    - **W25-P5**: `src()` matches `/sort -V/` exactly once. The derivation is spelled once, in `derive_tags`.
  - In `build-release.test.ts`'s `release-main.yml` describe:
    - **W25-Y1**: `expect(src).not.toMatch(/^\s+paths(-ignore)?:/m)`.
    - **W25-Y2**: `expect(src).toMatch(/^      - name: Decide whether this merge changes what ships\n        id: decide\n        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n        run: bash deploy\/release-main\.sh decide --out release-out$/m)`.
    - **W25-Y3**: `src` contains `      - uses: actions/setup-node@v4\n        if: steps.decide.outputs.build != 'false'\n`, and the index of the decide `run:` is below the setup-node line's, which is below prepare's `run:`.
    - **W25-Y4**: the prepare step's block, from `      - name: Derive the next tag and build the artifact` to the next `\n      - `, contains neither `env:` nor `${{`.

- [ ] **Step 4: Run both files and confirm red.** Run `release-main.test.ts`, then `build-release.test.ts`, one at a time with the Global Constraints command. Expected:
  - the W25-R, P and Y rows fail;
  - every pre-existing row is green, except the derive row, which now runs `decide`, an arm that does not exist yet. Any other red pre-existing row is a harness mistake: fix it before Step 5.

- [ ] **Step 5: Implement.**
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
      # does: does this merge change what ships? The token serves only the
      # published-base check; this step installs nothing, and no later step
      # but the publish holds a token. A merge that changes nothing that ships
      # skips the toolchain and its cache below (D-6401).
      ```
    - `setup-node` gains `if: steps.decide.outputs.build != 'false'` as its first key under `- uses:`, and this comment above it: `# Only when a build follows: a skipped merge installs nothing, and the cache would have nothing to save.`;
    - the prepare step's comment becomes `# Arm 1: refuses dirty/tagged, derives, tags LOCALLY, builds. Nothing reaches origin here. On a merge decide skipped, it records that and builds nothing.`;
    - the attest comment says it is also skipped "when prepare cut no release because nothing that ships changed".

    None of these comments may contain `npm ci`, `npm run`, `build-release.sh` or `gh release` (`build-release.test.ts:686-687`).

- [ ] **Step 6: Run both files until green**, one at a time. Then run `release-notes.test.ts`, `update-states.test.ts`, `oss-metadata.test.ts`, `workflow-yaml-parses.test.ts` and `verify-provenance.test.ts` whole, which are unchanged and run to confirm.

- [ ] **Step 7: Commit.** `git commit -m "feat(release): a merge that changes nothing that ships cuts no tag, build, attestation or release (D-6392..D-6395, D-6397, D-6401..D-6403)"`.

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

- [ ] **Step 1: Change the harness.** `fixture()` gains `scope?: boolean`: when true it copies the real `deploy/release-main.sh` and `deploy/release-scope.mjs` into `deploy/`, and writes `server/package.json` holding the real file's `engines` object (D-6403), before the first commit, so every tag carries them. `plantBin`'s `GhOpts` gains `realNode?: boolean`: when true, `node` is not poisoned. `npm` and `curl` stay poisoned in every row. The `run()` env already carries `GIT_ENV`, which the helper's own git inherits.

- [ ] **Step 2: Write the failing rows** in `'release-stable.sh: what it refuses'`. In each, the row commits on top of `fixture(home, { tagHead: 'v1.2.3', scope: true })` and runs with `realNode: true` unless it says otherwise. Every row expects exit 2, `ghArgv(home)` equal to `[]` and stdout `''`.
  - **W25-T1** (an unreleased docs head is refused, and says nothing that ships changed): commit a `README.md` and `docs/a.md` change. Stderr contains `carries no vX.Y.Z tag; it sits past v1.2.3, the newest release it contains, and its merges since changed nothing that ships (paths changed: 2), so no release was cut for them). stable now sits past v1.2.3 and cannot move back (fast-forward only): the next release cut from a descendant of ` and ends `Nothing was changed\n`. This is the never-promote mutation row.
  - **W25-T2** (a shipped change): commit a `deploy/x.sh` change. Stderr matches the existing untagged row's regex and `/carries no vX\.Y\.Z tag; it sits past v1\.2\.3, the newest release it contains, and it changed what ships \(shipped paths changed: 1; first: "deploy\/x\.sh"\): check the release-main run for its merge/`.
  - **W25-T3** (only a contained tag): as T1, plus a side branch off the tagged commit with a commit tagged `v9.9.9`, which HEAD does not contain. Stderr names `v1.2.3` and not `v9.9.9`. This is the `--merged HEAD` mutation row.
  - **W25-T4** (version order): `fixture(home, { scope: true })`, then two empty commits tagged `v1.9.9` and `v1.9.10` in that order, then a docs commit. Stderr names `it sits past v1.9.10`. This is the `sort -V` mutation row.
  - **W25-T5** (no release anywhere): `fixture(home)` with no tag and no `realNode`. Stderr contains `carries no vX.Y.Z tag, and it contains no release tag). stable now points at`. Node is never run: it stays poisoned and the row passes.
  - **W25-T6** (unmeasured reads as changed): commit a docs change and `git rm deploy/release-scope.mjs`. Stderr contains `whether it changed what ships could not be measured (release-scope.mjs exited 1), so read it as changed`.
  - **W25-T7** (no rewind, no force, no push of a contained tag): over T1's and T2's cases, stderr does not match `/--force|push -f|\+refs|git reset|git push origin v[0-9]/`, and contains `git push origin <tag>^{commit}:refs/heads/stable` exactly once.
  - The existing untagged row (`'an untagged HEAD is exit 2 …'`) and the D-3129 two-tag row stay green unchanged: no tag at HEAD and none contained means no `measure` and no `node`.

- [ ] **Step 3: Run and confirm red.** Run `release-stable.test.ts`. Expected: T1 to T4, T6 and T7 fail; T5 fails on its message. Every pre-existing row is green.

- [ ] **Step 4: Implement** in the zero-tag branch:
  - `SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"`, and one local function that prints the refusal from its varying parts and exits 2, so the prefix and the tail are spelled once;
  - `NEWEST="$(git -C "$ROOT" tag --merged HEAD | grep -E "$SHAPE" | sort -V | tail -n1)" || NEWEST=""`; none → the no-release line;
  - otherwise `ANSWER="$(bash "$ROOT/deploy/release-main.sh" measure --base "$NEWEST")" || RC=$?`, then `case` on the answer to pick `<reason>`; every answer refuses.

  The header (`:1-12`): "a merge commit carries no release tag and is refused here (exit 2)" becomes "a HEAD with no release tag (a merge commit, or a `main` merge that changed nothing that ships, which release-main.sh cuts no release for) is refused here (exit 2), and the refusal names the newest release HEAD contains and whether anything that ships changed since it (D-6398)". `release-stable.yml`'s comments: `:5-6` add "and `promote` runs `deploy/release-scope.mjs` the same way, only to word a refusal"; `:7-8` "the script refuses an untagged merge HEAD" becomes "the script refuses a HEAD that carries no release tag".

- [ ] **Step 5: Run until green.** Run the same file whole.

- [ ] **Step 6: Commit.** `git commit -m "feat(release): release-stable's refusal of an untagged head names the release it contains and says what is true (D-6398)"`.

### Task 4: the texts say what the lane now does (W25-d; D-6399, D-6400)

**Files:**
- Modify: `README.md:66`, `:78-84` (the paragraph after the quickstart block), `:154-157`, `:446`, `:740-748`, `:756-760`, `:6488-6491`; `CLAUDE.md:245-248`, `:292-293`; `shared/api.ts:9342`; `pwa/src/screens/settings/UpdatesSection.tsx:70`; `ui/src/primitives/radio.stories.tsx:65`; the three specs' top (a delta note under each Date/Status block)
- Test: `pwa/test/settings-screen.test.tsx:3207`; `server/test/release-scope.test.ts` (W25-S13)

**Interfaces:**
- Consumes: Task 2's skip line wording and `NOT_SHIPPED`'s six rules; Task 3's refusal.
- Produces: copy, and one row.

- [ ] **Step 1: The pins first.**
  - At `settings-screen.test.tsx:3207`, `dev:` becomes `'Every merge that changes the build, minutes after it lands.'`. Run `cd pwa && timeout -s INT 560 ./node_modules/.bin/vitest run test/settings-screen.test.tsx --pool=forks --maxWorkers=1 -t "the labels read spec"`. Expected: FAIL.
  - **W25-S13** in `release-scope.test.ts`'s fourth describe: read `README.md`, take the parenthesis that follows the text ``on its `NOT_SHIPPED` list (``, extract its backticked tokens, and assert that their sorted set equals `NOT_SHIPPED` spelled as `` `${tree}/` ``, `` `*${rootExt}` `` and `rootName`, sorted. Run it. Expected: FAIL (the sentence is not there yet).
- [ ] **Step 2: The copy.**
  - `UpdatesSection.tsx:70` gets the same string.
  - `radio.stories.tsx:65` becomes `'Dev — every merge that changes the build.'`.
  - `shared/api.ts:9342` becomes "`dev` is every merge that changes what ships, `stable` a promotion".
  - Re-run Step 1's pwa command. Expected: PASS.
- [ ] **Step 3: README**, each edit in place:
  - `:66`: "Every merge to `main` that changes what ships becomes a provenance-attested `dev` release (a docs- or tests-only merge cuts none)".
  - After the quickstart paragraph that begins at `:79`, add: "A checkout of a `main` head that no release names (a merge that changed nothing that ships) installs with no `version` in its stamp, so it raises no update floor, and a later bare `ccrc update` may move it to an older stable release. For a versioned build, check out a release tag before `bash install.sh` (`git checkout vX.Y.Z`), or install with `--release`."
  - `:154`: "Every merge to `main` that changes what ships publishes a release, born a prerelease — the `dev` channel; a merge that touches only docs or tests publishes none, and the next release contains it."
  - After `:446` ("Keep the checkout out of `~/ccrc` …"), add: "Check out a release tag first if the box should carry a version and an update floor (\"Quickstart\", above)."
  - `:740-748`: after "derives the next patch tag from the highest `vX.Y.Z`", insert the README's one enumeration of the list: "A `decide` step first asks `deploy/release-scope.mjs` what changed between that tag's tree and HEAD's, and asks the tag's own copy of the helper too. When every changed path is on its `NOT_SHIPPED` list (`docs/`, the root's `*.md` and `LICENSE`, `server/test/`, `server/test-e2e/`, `agent/test/`), both copies agree, and that tag is a published release, the run stops: no toolchain, no tag, no build, no attestation, and one line in the log and the job summary says so. Anything else, including an answer it cannot read, releases."
  - `:756-760`: "the script refuses a HEAD that carries no release tag or more than one — a merge commit carries none, so it cannot be promoted;" becomes "the script refuses a HEAD that carries no release tag or more than one — a merge commit carries none, and neither does a `main` merge that changed nothing that ships, so neither can be promoted;". After the promotion command's sentence ends, add: "`main`'s head often carries no release now, so push a release's own commit (`git push origin vX.Y.Z^{commit}:refs/heads/stable`), not `main`'s head. When that commit is not the head the daily run tested, the gate runs the full suite on it first. A push of an untagged head is refused after its gate, and the refusal names the newest release it contains and whether anything that ships changed since; `stable` then stays on that head until a release cut from a descendant of it is pushed." (Ruling on Reading 6.)
  - `:6490`: "(auto-tagging makes that the ordinary case on `main`)" becomes "(true of a `main` head whose merge changed what ships; a docs- or tests-only merge leaves the head untagged, and such a box raises no update floor)".
- [ ] **Step 4: CLAUDE.md**, each edit in place, naming the list by symbol only:
  - `:245-248`: "Every merge to `main` that changes what ships becomes a GitHub **prerelease** … (… ; patch per released merge, and a merge whose every changed path `deploy/release-scope.mjs`'s `NOT_SHIPPED` covers, by HEAD's copy and the base tag's, cuts none, so `stable` promotes a release's own commit, never such an untagged head; …)".
  - `:292-293`: "which auto-tagging makes the ordinary case on `main`" becomes "which holds only for a `main` head whose merge changed what ships".
- [ ] **Step 5: Spec delta notes.** One blockquote under each spec's Date/Status block (`2026-09-18-release-rollout-design.md` after `:7`, `2026-09-20-centralised-update-management-design.md` after `:14`, `2026-10-18-settings-redesign-design.md` after `:13`):

  > **Delta, 2026-10-22 (centralised update management wave 25, D-6390, D-6398):** a merge to `main` whose every changed path is outside what ships (`deploy/release-scope.mjs`'s `NOT_SHIPPED`: `docs/`, the root's `*.md` and `LICENSE`, the server and agent test trees) cuts no release: no tag, no build, no attestation. The next merge that changes the build takes the next patch number, and its release contains the skipped merges. Where this document says every merge is a release, read every merge that changes what ships. A push to `stable` still promotes only the release tagged at its HEAD: the tag at HEAD stays the whole input. The refusal of an untagged HEAD now names the newest release HEAD contains and whether anything that ships changed since it.

  For the settings spec, add: "The Dev note reads *Every merge that changes the build, minutes after it lands.*"
- [ ] **Step 6: Run W25-S13 until green**, then `docs-parity` whole, since README changed.
- [ ] **Step 7: Commit.** `git commit -m "docs(release): every merge that changes what ships is a release, not every merge (D-6399)"`.

### Task 5: The gate and the PR

- [ ] **Step 1: Landing tip.** Run `git fetch origin main`, merge it (after the first push; rebase before it), and re-read every anchor named above in the landed text.
- [ ] **Step 2: Touched suites, one file at a time, behind the memory gate.**
  - Whole, in `server/`: `release-scope`, `release-main`, `build-release`, `release-stable`, `release-notes`, `update-states`, `oss-metadata`, `workflow-yaml-parses`, `verify-provenance`.
  - By case, in `pwa/`: `settings-screen` with `-t "the labels read spec"`.
  - **Unmeasured, and so listed:** `settings-screen` beyond that case, and every suite that `shared/api.ts` selects. This PR touches `.github/`, so CI runs the full server suite (`.github/ci/select-tests.mjs`'s full trigger). Read the PR's `select tests` summary to confirm it ran in full.
- [ ] **Step 3: Repo guards.**
  - `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`.
  - `GROWTH_CHECK=1 … test/growth-check.test.ts`. None of this wave's files is a growth file; run it to confirm.
  - After `git fetch origin main`, run `deviation-refs`. Check directly that each of D-6390 to D-6405 is defined exactly once, in this plan: `grep -cE '^- \*\*D-(639[0-9]|640[0-5])\.\*\*'` reads 16, and none of them is defined on `origin/main`. Any reserve number the worker defines is added to that pattern and that count.
- [ ] **Step 4: The wave-done fingerprint.** The `suite:` line follows worker clause 15 (`ccd/worker-skill/SKILL.md:76`): `green` or `red` from the FIRST full suite run after the implementation was complete, red staying red through fix rounds, and `unrun` when no full run happened locally. The per-file runs of Steps 2 and 3, and the CI full run, are listed in the as-built note, not folded into the word.
- [ ] **Step 5: The PR body.**
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
