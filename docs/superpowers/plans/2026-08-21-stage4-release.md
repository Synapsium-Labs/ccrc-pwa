# Stage 4 — release pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box installs from a checksummed, CI-built release artifact and updates N→N+1
with one command — backup first, atomic install, verified restart, the supervisor sweep
under its mandatory preflight — and uninstalls to a state where reinstall is safe.

**Architecture:** Spec `docs/superpowers/specs/2026-08-21-stage4-release-design.md` (§1–§9)
under the 2026-08-21 rulings (R1 granted, R2 full, R3 restated). Read the spec AND the
Stage 4 survey citations it rests on before any task. Version rides additively in
`build.json`; the release tarball is built by a local, testable script that CI merely
invokes; `ccrc update` re-runs the install spine from a verified staged tree.

**Tech Stack:** bash (`ccd/ccrc`), GitHub Actions (thin), TypeScript ESM (server/agent/
shared readers), tar+sha256sum, systemd user units.

## Global Constraints

- No new npm dependencies in any package. `FLEET_PROTO` stays 1 — `build.json`'s `version`
  and every wire surface carrying it are ADDITIVE (absent field tolerated by one reader per
  surface).
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package, FOREGROUND, never
  bare `npx vitest`. Known load-flaky suites re-run in isolation before concluding.
- ccrc/ccd tests: fixture HOMEs only (`ccrc-install.test.ts` harness — real contained git,
  poisoned curl, fixture PATH). NEVER against the live `$HOME`; never touch live tmux,
  `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*` units. The sweep task tests its
  preflight/refusal logic against RECORDING systemd stubs — it never runs a real sweep.
- TDD red-first; every guard mutation-measured, counts recorded in `## Deviations found`
  (D-139 onward — the 3b plan's ledger is separate; if 3b merges first and claims numbers,
  renumber at branch-review time).
- Bash single-definition: new path/name constants (`CCRC_RELEASE_*`, backup dir, unit
  names) spelled once, pinned like `CCRC_RC_FILE`. No secret/env value ever printed.
- `ccd/ccd` is NOT touched. If a task must touch it: stop, record a deviation, re-stamp
  provenance in that commit.
- CLAUDE.md is touched by exactly ONE task (Task 7, the R1 carve-out) with the operator's
  ruling cited; no other task edits it.
- This branch will conflict with `feat/stage3b-exposure` (PR #78) only in `ccd/ccrc`'s
  usage table + dispatch rows and possibly the doctor array — keep those hunks minimal.

## File structure

- `shared/buildinfo.ts`, `server/src/buildinfo.ts`, `agent/src/server.ts`,
  `server/src/server.ts` (/health), `ccd/ccrc` (jq reader, `cmd_version`, `cmd_status`),
  `ccd/ccd` — NO (its python3 `version` reader is `ccd version`; that verb lives in
  `ccd/ccd`… **check first**: if the python3 reader is in `ccd/ccd`, Task 1 marks that one
  reader OUT of scope with a deviation instead of touching `ccd/ccd`, and `ccd version`
  simply omits the tag — additive absence, correct by the same rule).
- `deploy/build-release.sh` (new), `.github/workflows/release.yml` (new), `install.sh`
  (fetch mode), `deploy/deploy.sh` (stamp_build gains `version`).
- `ccd/ccrc`: `cmd_update`, `cmd_uninstall`, `cmd_backup`, `cmd_logs`, `--role` in
  `cmd_install`, `_upd_*`/`_uninst_*` helpers, usage + dispatch.
- `ccd/ccrc-doctor-checks`: `build` check + `_check_fleet` remedy strings.
- `CLAUDE.md` (Task 7 only), `README.md`, `deploy/ccrc.env.example`, runbook step 12.
- Tests: `server/test/build-release.test.ts` (new), `server/test/ccrc-update.test.ts` (new),
  `server/test/ccrc-uninstall.test.ts` (new), extend `install-sh.test.ts`,
  `ccrc-install.test.ts`, `ccrc-cli.test.ts`, `ccrc-doctor.test.ts`, `buildinfo` tests in
  server/agent, `single-definition.test.ts`, `runbook-holds.test.ts`.

---

### Task 1: Version identity — `version` in build.json, every reader additively

**Files:** `shared/buildinfo.ts`, `server/src/buildinfo.ts` + `/health` emit
(`server/src/server.ts`), `agent/src/server.ts` (ready frame passthrough), `deploy/deploy.sh`
`stamp_build`, `ccd/ccrc` `_inst_stamp` + `_box_build_fields` + `cmd_version`/`cmd_status`.
**Interfaces — Produces:** `BuildInfo.version?: string` (present iff a tag `v*` points at the
built sha, or always from the release job); `/health` body gains sibling `version` when
known; `ccrc version` prints it when present. `buildAgreement` UNCHANGED (sha+dirty) with a
new pin: two stamps differing only in `version` still compare `agreed`.

- [ ] RED: `parseBuildInfo` keeps a valid `version` and tolerates absence; `/health` emits
  it only when present; `ccrc version` prints `version vX.Y.Z` line iff present (fixture
  build.json both ways); stampers: fixture repo WITH a tag at HEAD stamps it, without omits
  it (`git tag --points-at HEAD` in both stampers); the buildAgreement pin above.
- [ ] GREEN across every reader listed. If `ccd version`'s python3 reader lives in
  `ccd/ccd`, leave it and record the deviation (it omits the tag; additive absence).
- [ ] Mutations: drop the absence-tolerance (red); make buildAgreement compare version
  (the version-only-differ pin reds). Suites: buildinfo + config + single-definition +
  ccrc-cli. Commit `feat(release): the tag rides in build.json, additively, everywhere`.

### Task 2: `deploy/build-release.sh`

**Files:** create `deploy/build-release.sh`; test `server/test/build-release.test.ts`.
**Interfaces — Produces:** `build-release.sh [--untagged] [--out <dir>]` run at repo root:
refuses a dirty tree (`git status --porcelain` non-empty → die, nothing written); refuses an
untagged HEAD without `--untagged`; builds server+pwa (`npm ci && npm run build` — the
RELEASE machine builds, boxes don't), assembles `ccrc-<version>.tar.gz` (layout per spec §2:
dists, three package.json+locks, shared/, ccd/, deploy units+helpers, install.sh, MANIFEST
with per-file sha256) and `SHA256SUMS` beside it. `<version>` = the tag, or
`untagged-<shortsha>` under `--untagged`.

- [ ] RED (harness: fixture git repo via the `gitInit` idiom, PATH-contained; npm stubbed by
  a recording stub that fabricates `dist/` — the test pins orchestration, not tsc): dirty
  tree refused with nothing written; untagged refused; tagged run produces tarball whose
  listing contains the layout's every top-level entry; `sha256sum -c SHA256SUMS` passes;
  MANIFEST names every file in the tarball with a correct digest (spot-verify two).
- [ ] GREEN. `set -euo pipefail`; staging under `mktemp -d`; tar with `--sort=name
  --mtime=@0 --owner=0 --group=0` (reproducible-ish; pin the flags in a test so a casual
  edit doesn't silently make artifacts unstable).
- [ ] Mutations: drop the dirty refusal (red); corrupt one file post-MANIFEST (the
  spot-verify reds). Commit `feat(release): build-release.sh — the matched set, checksummed`.

### Task 3: `.github/workflows/release.yml`

**Files:** create the workflow; extend `server/test/build-release.test.ts` with source pins.
- [ ] The workflow: `on: push: tags: ['v*']`; single job: checkout (full depth for the tag),
  node from `server/package.json` engines (the ci.yml idiom), `bash deploy/build-release.sh
  --out release-out`, `gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag`
  (via `GH_TOKEN: ${{ github.token }}`).
- [ ] Pins (source-scan, the runbook-holds idiom): the workflow invokes `build-release.sh`
  and never a second build path; it triggers only on `v*` tags; it uploads both artifacts.
  Commit `feat(release): the release workflow is thin — the script owns the build`.

### Task 4: `install.sh --release`

**Files:** `install.sh`; extend `server/test/install-sh.test.ts`.
**Interfaces — Produces:** `install.sh --release [vX.Y.Z]` downloads
`https://github.com/<owner>/<repo>/releases/{latest/download,download/<tag>}/…` (owner/repo
from ONE variable pair at the top — Stage 5 de-brands it), verifies `sha256sum -c`, extracts
to `mktemp -d`, `exec bash <staging>/ccd/ccrc install "$@"`. Checkout mode untouched.
`CCRC_RELEASE_BASE_URL` env override — the test seam (points at a `file://`-style local dir
via a stub `curl`; the harness's poisoned curl stays for every other test).

- [ ] RED: `--release` with stubbed curl serving a fixture tarball+SHA256SUMS installs from
  the staging tree (assert the handoff argv via a recording `bash`/`ccrc` stub); checksum
  mismatch refuses with nothing extracted; absent release answers curl's own failure; plain
  run (no flag) still takes checkout mode (existing tests keep passing untouched).
- [ ] GREEN; mutations: skip the checksum verify (red). Commit
  `feat(release): install.sh fetches and verifies a release`.

### Task 5: `ccrc install --role server|fleet|both`

**Files:** `ccd/ccrc` (`cmd_install` arg parse, `_inst_env` template gains `CCRC_ROLE`,
`_inst_agent_env` new, `_inst_units`/`_inst_enable` role-aware); extend
`ccrc-install.test.ts`.
**Interfaces — Produces:** default `both` = today's exact behavior (existing suites prove
it by staying green). `fleet`: tty prompts for server WS URL + agent token (the
`cmd_passwd` stdin idiom), writes `~/.ccrc/agent.env` 0600 seed-once, installs
`ccrc-agent.service` (satisfying its REQUIRED EnvironmentFile — update the reasoned
exclusion comment at `ccd/ccrc:2622-2633` to say the role gate replaced the blanket
refusal), enables it, SKIPS `ccrc.service` + coord/auth/skills steps that presuppose a
server. `server`: today's spine minus nothing (documented as both-without-fleet-extras;
the difference from `both` is reserved for later stages — one sentence in the help text).

- [ ] RED: `--role fleet` writes agent.env 0600 with both keys (values SET, never echoed),
  installs+enables the agent unit and NOT ccrc.service; re-run keeps agent.env (seed-once);
  piped stdin refused; `--role both` byte-identical to today on a fresh box (compare the
  installed unit set against the existing test's expectations); unknown role → usage die.
- [ ] GREEN; mutations: drop the agent-unit install on fleet (red); echo the token (red).
  Commit `feat(ccrc): install --role — a fleet box has an installer path (D-73 closes)`.

### Task 6: `cmd_update` — fetch, verify, back up, install, report

**Files:** `ccd/ccrc` (`cmd_update`, `_upd_fetch`, `_upd_backup`, `_upd_report`); new
`server/test/ccrc-update.test.ts`.
**Interfaces — Produces:** `ccrc update [--to vX.Y.Z]`: fetch+verify (Task 4's machinery,
shared helpers — single-definition: ONE fetch/verify implementation used by install.sh's
release mode and update; extract it to `ccd/ccrc` and have install.sh `--release` route
through the staged ccrc's helper, or vice versa — the plan's choice is: the helper lives in
`ccd/ccrc`, install.sh keeps only download+checksum of the OUTER tarball); backup step =
`cmd_backup` (Task 8's verb, called as a function); re-run the `_inst_*` spine from the
staged tree (role-aware per the recorded role); print the from→to report; finish with
`cmd_doctor`. Server-box run warns when `/api/fleet/health` (via `_box_health`) says the
fleet is behind — WARN text names fleet-box-first; a 401/unreachable answer skips the
comparison silently (D-150). NO sweep in this task (Task 7).

- [ ] RED (fixture box from `freshBox` + a fixture release tarball): happy path replaces
  `~/ccrc` and reports both build.json versions; checksum mismatch changes NOTHING
  (byte-compare `~/ccrc` before/after); backup dir contains coord.db snapshot + old ccd +
  units before any install write (ordering pin: a fault injected between backup and install
  leaves the backup complete); `--to` fetches the named tag's URL (recording curl stub
  argv); rollback prints the coord.db restore lines and does NOT copy the db itself.
- [ ] GREEN; mutations: reorder backup after install (the ordering pin reds); skip manifest
  verify (red). Commit `feat(ccrc): update — verified artifact in, backup first, atomic`.

### Task 7: The sweep + the CLAUDE.md carve-out (R1)

**Files:** `ccd/ccrc` (`_upd_sweep` called as update step 4), `CLAUDE.md`, extend
`ccrc-update.test.ts` + a both-copies pin in `server/test/single-definition.test.ts` or
`build-release.test.ts`.
- [ ] RED (recording `systemctl` stub): with the `KillMode=process` drop-in present in the
  fixture unit dir, the sweep issues `try-restart` per `claude-session@*` unit, then the
  failed-state warn query and the active-state verify query (argv order pinned); with the
  drop-in ABSENT, the sweep REFUSES (loud, names the drop-in) and the update still exits 0
  with a degraded line (the sweep is refused, not the update); panes/tmux never appear in
  any argv (pin: no `tmux` in the recording log).
- [ ] GREEN. Then CLAUDE.md: inside the SAFETY section's never-touch bullet, add the scoped
  exception sentence citing the 2026-08-21 ruling and the mandatory preflight; a source pin
  asserts BOTH sweep implementations (deploy.sh's and ccrc's) contain the preflight grep
  (`KillMode=process`) so neither can drop it silently.
- [ ] Mutations: delete the preflight from `_upd_sweep` (both the refusal test AND the
  both-copies pin red). Commit `feat(ccrc): the supervisor sweep, under its preflight —
  the sacred rule gains its one scoped exception (ruling 2026-08-21)`.

### Task 8: `cmd_uninstall`, `cmd_backup`, `cmd_logs`

**Files:** `ccd/ccrc` (three verbs + usage/dispatch); new `server/test/ccrc-uninstall.test.ts`;
extend `ccrc-cli.test.ts`.
- [ ] RED per spec §7's exact remove/preserve/refuse sets — the load-bearing cases:
  refuses with live sessions unless `--force` (fixture registry rows); removes ONLY
  marker-verified wrappers (a marker-less file with a wrapper's name survives); settings.json
  hook entries removed via the existing predicate WITH per-file backup, unmanaged hooks
  survive byte-identically; `~/.cc-sessions` keeps registry rows + operator switches while
  ccrc's own artifacts go; `~/.ccrc` survives; `--purge` removes `~/.ccrc` and backups but
  NEVER worktrees (fixture worktree survives); keep-aside restore commands printed, files
  untouched. `backup` = update's step 2 standalone with `CCRC_BACKUP_KEEP` pruning. `logs`
  passes `-f`/`-n` through to journalctl (recording stub argv), role-aware unit name.
- [ ] GREEN; mutations: drop the marker check on wrapper removal (red); drop the live-session
  refusal (red). Commit `feat(ccrc): uninstall makes reinstall safe; backup and logs join`.

### Task 9: Doctor — the `build` check + retargeted remedies

**Files:** `ccd/ccrc-doctor-checks`; extend `ccrc-doctor.test.ts`.
- [ ] RED: `build` (new array entry + `_check_*`): running server's `/health` sha ==
  build.json sha → PASS naming the short sha; mismatch → FAIL, remedy names
  `systemctl --user restart ccrc.service`; no server/local-unreachable → SKIP; a 401 →
  SKIP whose text says the gate answered, not the build (D-150). `_check_fleet`'s two skew
  remedies now say `ccrc update` fleet-box-first (update the strings + their pins).
- [ ] GREEN; bijection stays green; mutation: flip the sha comparison (red). Commit
  `feat(doctor): the running build is compared to the stamp; remedies name ccrc update`.

### Task 10: Runbook step 12 + docs

**Files:** runbook, `README.md`, `deploy/ccrc.env.example`; extend `runbook-holds.test.ts`.
- [ ] Step 12 per spec §9 (tag → release → `--release` install on VM1 → `--role fleet` on
  VM2 → restated proof → update across a second tag → uninstall+reinstall), with
  `runbook-holds` pins for quoted transcript lines; README gains the release/update/uninstall
  section and retires the "full multi-box guide is Stage 5" sentence if it now tells enough;
  `ccrc.env.example` documents `CCRC_ROLE`. Commit `docs(runbook): step 12 — the release
  round-trip on two boxes`.

### Task 11: Whole-branch review + close-out

- [ ] Whole-branch adversarial review (lenses: bash correctness of update/uninstall failure
  paths; the preflight cannot be bypassed; checksum/manifest verification order; remove/
  preserve sets vs spec §7 exactly; additive wire discipline of `version`; no secret
  printed; conflict-surface hygiene vs PR #78's hunks). Fix round; deviations ledgered; PR;
  CI green.

## Deviations found

(D-139 onward; recorded during execution — renumber against 3b's ledger at review time if
it merges first.)
