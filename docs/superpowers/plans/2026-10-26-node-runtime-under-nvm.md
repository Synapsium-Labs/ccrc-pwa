# Node runtime under nvm — plan

**Spec:** `docs/superpowers/specs/2026-10-26-node-runtime-under-nvm-design.md` (binding).
**Branch:** `fix/install-node-under-nvm`.

## Global Constraints

- **Tests run against FIXTURE HOMEs only** (`freshBox`, `runInstall`, `ccrcEnv` in
  `server/test/ccrc-installFixture.ts`; `makeCcdHarness` where ccd is involved). Never run `ccrc`, `ccd`, `nvm`,
  `systemctl` against the real `$HOME`. A stub `systemctl` is already on the fixture PATH (`FIXTURE_BINS`).
- **TDD, red first.** Every guard ships with a test that goes RED when the guard is deleted or mutated; measure it
  (break the guard, see red, restore) and say so in the report.
- **The floor is read, never re-typed.** No version number (`22`, `22.16.0`, `24`) appears in shipped code; the floor
  comes from `engines.node` of the shipped `server/package.json` (fallback `agent/package.json`, as
  `_dr_pkg_candidates` in `ccd/ccrc-doctor-checks` does). Only the single `>=x.y.z` form is understood (doctor's
  `floor_re` rule); anything else refuses loudly.
- **Exact names:** link directory `$HOME/.local/libexec/ccrc/node-bin` holding exactly `node`, `npm`, `npx`
  symlinks; fragment `$HOME/.config/environment.d/50-ccrc-node.conf` whose one non-comment line is
  `PATH=<absolute $HOME>/.local/libexec/ccrc/node-bin:${PATH}`; new doctor check name `node-path`; new spine step
  `_inst_node`; new sourced library `ccd/ccrc-node`.
- **Interactive = stdin is a TTY** (`[ -t 0 ]`, the gate this file already uses). Only an interactive run may run
  `nvm install --lts`. nvm's `default` alias is never changed (no `nvm alias`, no `nvm use --default`).
- **nvm discovery:** `${NVM_DIR:-$HOME/.nvm}` with `nvm.sh` present. Installed versions = the directory names under
  `$NVM_DIR/versions/node/` whose `bin/node` is executable. The `default` alias is resolved by nvm itself, in a
  subshell: `. "$NVM_DIR/nvm.sh" --no-use && nvm version default` (prints `vX.Y.Z` or `N/A`).
- **Unit files stay byte-identical to the tree; `ExecStart` keeps `/usr/bin/env node`.** Only
  `deploy/ccrc-models.service`'s `Environment=PATH=` gains `%h/.local/libexec/ccrc/node-bin:` at its front.
- **Linux only.** On darwin `_inst_node` publishes nothing and says so in one line (plists bake PATH).
- **Overloaded-null ban:** "no node qualifies", "nvm present but unreadable", "floor unreadable" and "install refused
  because unattended" are distinct outcomes with distinct messages.
- Match `ccd/ccrc`'s idiom: `_ccrc_die` for refusals, `install: <step>: …` progress lines, `_tmp_guard` +
  atomic rename for writes (`_inst_atomic`, `_plat_mv_notdir`), comments that say why.
- Single test runs: `cd server && ./node_modules/.bin/vitest run test/<file>` in the FOREGROUND, timeout ≥ 600000 ms.
  Never bare `npx vitest`.
- This repo is PUBLIC: no hostnames, real home paths, account names in code, fixtures, comments or commits.
- Deviation refs are `D-TBD-node-runtime-under-nvm` (no issued number).
- Commit on this branch; messages end with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Task 1: the selection library `ccd/ccrc-node`

Create `ccd/ccrc-node`, a bash library of functions only (sourced; no top-level side effects; `# shellcheck shell=bash`).
It must work with NO node on PATH (it runs before one is chosen), so it reads the floor without node: bash regex over
the package.json text for the `"node"` key inside `engines` (server's is multi-line, see `server/package.json:6-8`).

Functions (names exact; outputs through globals, as `ccd/ccrc` does, e.g. `CCRC_ENTRY_PY`):
- `_node_floor <pkg.json>` → rc 0, `NODE_FLOOR=x.y.z`; rc 1 with `NODE_WHY` when unreadable / no engines.node /
  not a single `>=x.y.z`.
- `_node_ver_ge <x.y.z|vx.y.z> <x.y.z>` → rc 0 iff first ≥ second. Pure.
- `_node_pick <floor> <default-or-empty> <ver>...` → pure decider: prints the default if it qualifies, else the
  highest qualifying version (numeric compare, not lexical: `v9` < `v22`), rc 1 when none qualifies.
- `_node_select <floor>` → the IO step. Sets `NODE_BIN_DIR` (absolute dir holding the chosen `node`, `npm`, `npx`)
  and `NODE_VERSION`, and prepends `NODE_BIN_DIR` to this process's PATH. Order: (1) nvm present → list installed,
  resolve default, `_node_pick`; none qualifies and `[ -t 0 ]` → `nvm install --lts` in a subshell that sourced
  `nvm.sh`, re-list, re-pick; none and not interactive → rc 1, `NODE_WHY` saying no installed nvm node meets the
  floor and that an interactive `ccrc install` would install one; (2) no nvm → `command -v node`, resolved with
  `realpath`/`readlink -f` to its directory, `node --version` checked against the floor; rc 1 with `NODE_WHY` when
  missing or below.
- `_node_publish` → the ONE writer of the box-side artefacts (spec decision 6): atomically (temp + rename) publish
  the three symlinks into `$HOME/.local/libexec/ccrc/node-bin/` pointing at `$NODE_BIN_DIR/{node,npm,npx}`, write
  the fragment (atomic, mode 644, a comment line saying ccrc writes it and why), then
  `systemctl --user daemon-reload` when a user manager answers (a box without one: skip, `NODE_WHY`-style note, rc
  0). On darwin: publish nothing, rc 0. Idempotent. `_inst_node` (Task 2), `_fix_node-path` (Task 3) and deploy.sh
  (Task 5) all call it; none copies it.

Tests: new `server/test/ccrc-node.test.ts`, sourcing the library in `bash -c` with a fixture HOME and a stub nvm
tree (`$NVM_DIR/versions/node/vA.B.C/bin/{node,npm,npx}` as tiny scripts printing their version; a stub `nvm.sh`
defining an `nvm` function that answers `version default` from a fixture file and implements `install --lts` by
creating a version dir and logging the call). Cover: default qualifies → chosen; default below floor → newest
qualifying; numeric ordering; none qualifies + TTY → install called once, alias untouched; none + no TTY → rc 1, no
install call; no nvm + PATH node qualifies → its realpath dir; no nvm + below floor → rc 1; malformed floor → rc 1.
For the TTY case use `script -qc` or an injectable test seam — say which in the report. Also make the library ship:
find the list(s) of shipped `ccd/` files (`deploy/build-release.sh`, `server/test/build-release.test.ts:224`,
`_inst_tree`) and add it the way `ccd/ccrc-doctor-checks` is listed.

## Task 2: wire selection into install, update and the units

In `ccd/ccrc` (source `"$CCRC_HERE/ccrc-node"` where `ccrc-doctor-checks` is sourced, or at top if that is lazy —
choose and justify):
- `cmd_install`: before the existing `command -v node` probe (~line 14871), read the floor from the tree's
  `server/package.json` (agent's fallback) and run `_node_select`; on rc 1 `_ccrc_die` with `NODE_WHY` and "nothing
  on this box was written or changed". The existing probe then sees the chosen node.
- New spine step `_inst_node` in `CCRC_INST_SPINE`, immediately BEFORE `_inst_units`: calls Task 1's
  `_node_publish` (never re-implements it). Prints `install: node: <version> at <dir> (links in …/node-bin; manager PATH via
  ~/.config/environment.d/50-ccrc-node.conf)`. Idempotent: re-running with the same choice rewrites nothing visible.
  Update every test that pins the spine's order/census (search for `CCRC_INST_SPINE` / `_inst_units` in
  `server/test`).
- `cmd_update`: call `_node_select` (never interactive-installs: an update's stdin is not a TTY, but guard
  explicitly — pass a flag or set an env so `_node_select` refuses install under update even with a TTY) before its
  dependency preflight (`for t in curl tar gzip node awk jq` ~line 19509), so a box whose manager PATH lacks node can
  still update.
- `deploy/ccrc-models.service`: prepend `%h/.local/libexec/ccrc/node-bin:` to `Environment=PATH=`.
- `deploy/ccrc.service` / `deploy/ccrc-agent.service`: unchanged.

Tests in the install family (`ccrc-install-units.test.ts` is the natural home): links exist and resolve to the stub
nvm node; fragment content exact; `daemon-reload` recorded by the stub systemctl AFTER the fragment is written and
BEFORE `_inst_enable`'s restart; a box whose shell PATH has NO node but has an nvm tree installs and its
`gen-accounts` step runs on the chosen node; an unattended update with no qualifying node refuses with the
`NODE_WHY` line and does not call the stub `nvm install`; ccrc-models unit PATH line.

## Task 3: doctor `node-path` and uninstall

- `ccd/ccrc-doctor-checks`: add `node-path` to `CCRC_DOCTOR_CHECKS` on the `node` line (`node node-path   # one
  line, as …` — keep every other line's number stable; several are cited by number) and `_check_node-path`. FAIL
  cases (each its own detail + remedy): link dir or a link missing; a link dangling; the linked node below the floor
  (reuse the floor reading `_check_node` does, or the library's `_node_floor` — one reader, not a third); fragment
  missing or its PATH line not naming the dir; `systemctl --user show-environment`'s PATH lacking the dir (when the
  manager answers; SKIP-equivalent when there is no user manager, following how `services` handles that). On darwin
  `_dr_skip`. PASS names the version and target.
- `_fix_node-path` (follow `_fix_wrappers`/`_fix_skills` and how `--fix` dispatches): run the same `_node_select`
  in never-install mode, then `_node_publish` (call it, never copy it).
- `cmd_uninstall`: remove `~/.local/libexec/ccrc/node-bin/` and the fragment, then `daemon-reload`; only those two
  paths (never another `environment.d` file).
Tests: `ccrc-doctor.test.ts` (or a new `ccrc-doctor-node-path.test.ts`) for each verdict and `--fix`; the
existing check-table/function parity case must stay green; uninstall test in the family that tests uninstall.

## Task 4: `install.sh` and docs

- `install.sh` checkout mode: replace the `command -v node` + inline floor check (lines ~153-166) with sourcing
  `"$ROOT/ccd/ccrc-node"`, `_node_floor "$ROOT/server/package.json"`, `_node_select`, refusing with `NODE_WHY`. The
  build that follows then runs on the chosen node. Release mode: unchanged (the staged `ccrc install` selects).
  Test in whichever suite already exercises `install.sh` (search `install.sh` in `server/test`).
- README: rewrite the Linux "Node on the user manager's PATH" bullet (~line 211) to say `ccrc install` chooses the
  node (nvm-aware), links it into `~/.local/libexec/ccrc/node-bin` and writes the environment.d fragment itself;
  `ccrc doctor`'s `node-path` check measures it.
- Spec is already written; no further doc.

## Task 5: `deploy/deploy.sh` runs the selection on the box

`deploy.sh` builds and places units on the BOX over ssh (`AGENT_BUILD_CMD` ~line 820 for the agent lane; find the
server lane's equivalent remote build). In each lane's remote command: source `~/ccrc/ccd/ccrc-node`, read the floor
from the lane's own shipped `package.json` (`~/ccrc/agent/package.json` / `~/ccrc/server/package.json`), run
`_node_select` BEFORE `npm ci` (so the box's build runs on the chosen node — a non-interactive ssh never installs),
and `_node_publish` AFTER the last unit is placed and before the lane's `daemon-reload`/restart. A failed selection
fails the deploy with `NODE_WHY` printed. Constraints the file states about itself and that bind this edit: the
`AGENT_BUILD_CMD` block is read by deploy-verify split on `&&` (no `&&` inside helper bodies); lines above a
documented point are cited BY NUMBER elsewhere — insert where the file says inserts are safe, and run the citation
tests. The local `require_node` (~line 428) stays: it is about the DEPLOYING machine and is correct. Tests: the suites
that already pin deploy.sh's remote command text (search `AGENT_BUILD_CMD`, `deploy.sh` in `server/test`), extended to
pin select-before-`npm ci` and publish-after-units in both lanes. README (Task 4's bullet) mentions that deploy.sh
does the same.
