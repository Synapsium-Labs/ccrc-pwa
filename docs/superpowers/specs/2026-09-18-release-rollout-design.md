# Release channel and fleet rollout — design

**Date:** 2026-09-18. **Status:** approved section by section in dialogue with the operator; this document is the
written form for review before a plan is cut. **Builds on:** `2026-08-21-stage4-release-design.md` (the release
pipeline this document puts into service) and `2026-08-15-stage2b-ccrc-cli-and-doctor` (the doctor table it
extends). **Fleet names are ROLES** here — the fleet box, the server box — never hosts; real values live in
`deploy/reference-fleet.md`, gitignored.

## 0. In one paragraph

ccrc already has a complete, tested release pipeline — `deploy/build-release.sh`, `.github/workflows/release.yml`,
`install.sh --release`, `ccrc update` — and has used it exactly once. The fleet is deployed by `deploy/deploy.sh`
from a working checkout, two lanes, in an order the operator re-derives every time, and only the agent lane ships
the three coordinator/worker/reviewer skills — so a skill fix merged to `main` and deployed to the server reached
no reviewer on the box (measured 2026-09-17: eighteen installed copies stale after the merge). This design makes
**every merge to `main` a release**, adds **one verb that moves both boxes to it in order**, makes `ccrc update`
**safe to run twice**, and makes **what is running where visible** on the wire, in the PWA, at the CLI and in the
doctor. `deploy.sh` stays, untouched, as the documented fallback; retiring it is a follow-on.

## 1. The measured problem

| Fact | Measurement (2026-09-17/18, `origin/main` at `ad3d2fbc`) |
|---|---|
| The release pipeline exists and is tested | `build-release.sh` (refuses dirty/untagged; builds three packages; `ccrc-vX.Y.Z.tar.gz` + `MANIFEST` + `SHA256SUMS`; `build.json` with `version`); `release.yml` on `push: tags: v*`; `install.sh --release [tag]`; `ccrc update [--to tag]` (fetch+verify → backup → staged `ccrc install` → supervisor sweep → report). `build-release.test.ts`, `install-sh.test.ts`, `ccrc-update.test.ts`. |
| It has shipped once | `gh release list`: one row, `v0.0.1`, 2026-08-24. No tag since. |
| The fleet has never been moved by it | The fleet box's `~/.ccrc/build.json` reads `{"sha":"bd2bf57a…","ref":"HEAD","builtAt":"2026-09-17T17:16:09Z","dirty":false}` — **no `version`**. `build-release.sh` always writes one; `deploy.sh`'s `stamp_build` never does. |
| `ccrc update` would have converged the skills | Its step 3 re-runs the staged `ccrc install`, whose spine calls `_inst_skills`, which places the three skill trees and runs each installer over every rostered home. |
| `deploy.sh` ships skills on one lane only | The four `install-*-skill.sh` invocations sit inside the agent arm (`if [ "$TARGET" = "agent" ]`); the server arm ships none. "Merged" and "server deployed" are both compatible with every reviewer reading a month-old clause. |
| Build time is not the slow part | The one `release.yml` run took **41 s**. `ci.yml` on `main` takes 42–49 min wall-clock and does not gate releases (nor did `deploy.sh`); it was red on 2 of the last 6 `main` runs, both on the known macOS FIFO-probe flake. |
| Box-side cost is seconds | `npm ci --omit=dev` for `agent/`: 4.6 s measured. `server/`'s depends on `file:../agent`, which the tarball satisfies. |
| Version already crosses the wire | The agent's `readBuildStamp` parses `~/.ccrc/build.json` with `parseBuildInfo`, which keeps `version`; the server holds `deps.build` (own) and `fleetState.build` (fleet). `buildAgreement` compares sha+dirty of those two and nothing else. |
| Nobody can see it | `/api/fleet/health` answers the agreement word and withholds the stamps. `FleetHostBanner` renders roster divergence and never build skew — `skewed` appears nowhere in `pwa/src`. No PWA surface shows any build. |
| The doctor already assumes the release path | `_check_fleet`'s skewed remedy says "run `ccrc update` on the lagging box — fleet box first". |
| `ccrc update` is not idempotent | No "already at this version" gate: it always fetches, backs up, restarts the role's unit and sweeps. On 2026-09-16 two sessions told to deploy the same sha restarted the agent twice in seven seconds and the server twice in five minutes. |
| `_inst_stamp` sits mid-spine, and must | `_inst_tree → _inst_bins → _inst_files → _inst_stamp → _inst_units → _inst_enable → … → _inst_hooks → _inst_skills → _inst_graphify_skill → … → _inst_wrappers`. The server reads the stamp once at boot and `_inst_enable` restarts it, so the stamp cannot move to the end. A run that dies in `_inst_skills` leaves a stamp naming a version whose skills never landed. |
| A workflow's own tag push fires nothing | GitHub suppresses workflow runs for events created with `GITHUB_TOKEN`. An auto-tag job cannot hand off to `release.yml`; it must build and publish itself. This repo carries zero Actions secrets by design, so a PAT is not an option. |
| The coordinates already exist | `~/.ccrc/deploy.env`: `CCRC_BOX` (server), `CCRC_AGENT_BOX` (fleet, never defaulted from `CCRC_BOX`), `CCRC_SSH_KEY`, `CCRC_SSH_PORT`. `deploy.sh` builds `ssh -p $PORT -i $KEY` from them. |
| Replacing a running `ccrc` is safe | `_inst_tree` places the tree with `rsync -a --delete` (temp-then-rename, no `--inplace`), and executables land by `mv` (rename(2)); a running bash keeps the old inode. |

## 2. Decisions

1. **Pains, as named by the operator:** too many steps to remember; no idea what is running where; releases felt
   slow. **Not** rollback — `ccrc update --to <older>` already exists and gets no new ceremony.
2. **Every deploy is a release.** No versionless path is added or improved. `deploy.sh` is left byte-identical
   this phase, as the fallback for the first live rollouts; its retirement (and the tests that pin its arms) is a
   separate follow-on after a few real rollouts.
3. **Version scheme: patch-per-merge, derived, no version file.** The next tag is the highest existing `v[0-9]+.[0-9]+.[0-9]+`
   by `sort -V` with patch + 1; a human pushes a `vX.Y.0` / `vX.0.0` tag by hand when a minor or major is meant, and
   the existing `release.yml` owns those. `package.json` versions stay `0.0.0`; the tag is the version, as
   `build-release.sh`, `install.sh` and `_inst_stamp` already agree.
4. **Not gated on `ci.yml`.** The PR's required checks are the gate, before the merge; `main`'s post-merge CI is a
   45-minute re-check that `deploy.sh` never waited for either. Stated as a decision so nobody reads it as a gap.
5. **Rollout is an operator act from a machine with ssh to both boxes.** Never from the PWA or the coordinator:
   the exec surface is closed to `tmux`/`ccd` by design, and a server updating itself over its own agent link is
   the wrong shape.
6. **A `main`-push job gets `contents: write`.** `ci.yml`'s stated stance is that a job wanting write asks in the
   diff; this is that ask. `release.yml` already holds the same permission for the same act.
7. **Everything except `rollout` is for every box.** `install.sh --release` and `ccrc update` are the contributor's
   path; "latest" now tracks `main` instead of a month-old tag. `rollout` is the only fleet-shaped piece and reads
   whatever coordinates the machine running it has.

## 3. The release channel — merge → tag → release, no hands

### `deploy/release-main.sh` (new; tested like `build-release.sh`)

1. **Refuse a dirty tree** — `git status --porcelain` non-empty dies before anything is written (the same refusal
   `build-release.sh` makes; a release is a commit).
2. **HEAD already carries a `vX.Y.Z` tag → exit 0**, printing `already tagged <tag>; release.yml owns it`. This is
   how a hand-cut minor/major on the merge commit gets no auto-patch twin.
3. **Derive the next tag:** `git tag --list 'v*'` filtered to the release shape, `sort -V | tail -1`, patch + 1.
   No tag at all → `v0.0.1`. (From today's `v0.0.1` the first auto release is `v0.0.2`.)
4. `git tag <next>` then `git push origin <next>` — the push precedes the publish so `gh release create --verify-tag`
   (the existing discipline) can check the remote.
5. `bash deploy/build-release.sh --out release-out` — the **same** builder, which now sees a tagged HEAD and stamps
   `build.json` with `version` exactly as for a hand tag. No second build path.
6. `gh release create <next> release-out/* --verify-tag` as a normal (not pre-) release, so
   `releases/latest/download/…` — what `ccrc update` fetches with no `--to` — resolves to it.
7. **Cleanup on failure:** a trap deletes the tag it pushed (`git push origin --delete <next>`) unless step 6
   succeeded, so the tag namespace never holds a release-less tag that `ccrc update --to` can only fail against. A
   re-run derives the same number.

Argument discipline as its siblings: `-h`, `--out <dir>`, anything else is a refusal at exit 2.

### `.github/workflows/release-main.yml` (new; thin)

`on: push: branches: [main]`; `concurrency: {group: release-main, cancel-in-progress: false}` so two close merges
serialise and the second derives after the first has pushed; `permissions: contents: write`; `timeout-minutes: 30`;
`actions/checkout@v4` with `fetch-depth: 0` (tags must be present to derive from); `actions/setup-node@v4` with
`node-version-file: server/package.json` and the three lockfiles cached, as `release.yml` does; one step:
`bash deploy/release-main.sh --out release-out` with `GH_TOKEN: ${{ github.token }}`. `release.yml` stays
byte-identical.

### Pins

`release-main.yml`: triggers on `main` pushes and nothing else; carries that concurrency group; `contents: write`
and no other permission; invokes `release-main.sh` and no other build or publish command. `release-main.sh`, in a
fixture repo with a stub `gh` and a bare-repo `origin` recording what arrives: dirty tree → die, no tag, no npm;
tagged HEAD → exit 0, no push, no `gh`; `v0.0.1 → v0.0.2`, `v1.9.9 → v1.9.10`, no tags → `v0.0.1`; the tag reaches
`origin` before `gh release create` runs; `--verify-tag` and both artifacts in the `gh` argv; a failing publish
deletes the pushed tag; `set -euo pipefail`.

## 4. `ccrc rollout` — one act, both boxes, in order

New verb in `ccd/ccrc`, run on the deploying machine. **No checkout needed.**

    ccrc rollout [--to vX.Y.Z] [--server-first] [--check] [--force]

**Step 0 — coordinates.** Source `$CCRC_DEPLOY_ENV` (default `~/.ccrc/deploy.env`); refuse at exit 2 naming the
missing key, `deploy.sh`'s `_deploy_need` discipline. `CCRC_AGENT_BOX` is never defaulted from `CCRC_BOX`. The ssh
argv is `deploy.sh`'s: `ssh -p "$CCRC_SSH_PORT" -i "$CCRC_SSH_KEY"`, port defaulting to 22.

**Step 1 — preflight the roles, before touching either box.** Over ssh, read each box's recorded `CCRC_ROLE` —
the one `^CCRC_ROLE=` line of `~/.ccrc/ccrc.env`, never the file (it is the box's live config). Refuse at exit 2 unless the fleet coordinate records `fleet` and the server coordinate records
`server`; a single-box `both` is accepted only when the two coordinates name the same host. Reason: `cmd_update`
passes the recorded role to the staged install, and an absent role runs the install as `both` — which would give the
server box an agent unit.

**Step 2 — pin the version before touching anything.** With `--to`, that tag. Without, fetch
`releases/latest/download/SHA256SUMS` once and read the version out of the tarball name — the read `_upd_fetch`
already makes. Then pass `--to <that>` **explicitly to both boxes**, so a release landing mid-rollout cannot split
the fleet.

**Step 3 — measure, then decide.** Over ssh, `ccrc update --check --to <v>` on each box (section 6). Print the plan:
`fleet: v0.0.3 (bd2bf57a) → v0.0.7` / `server: unversioned (2985b9d1) → v0.0.7`. **`--check` stops here.** Both
already current and no `--force` → `rollout: both boxes at v0.0.7 — nothing to do`, exit 0, no further ssh.

**Step 4 — box one.** `ssh <fleet> 'ccrc update --to <v>'` (plus `--force` when given), output streamed with a
`fleet: ` prefix. Non-zero → **stop**: box two is not touched; exit 1 with the update's own lines above (its backup
path is in them). A half-rolled fleet with the failing box named beats two failures.

**Step 5 — box two.** The same for the server box with a `server: ` prefix. Default order fleet → server (the
doctor's standing order: the server reads what the fleet host's hook writes, and the agent caches `ccd caps` at
boot); `--server-first` inverts it for the reader-widening case the operator's deploy notes record.

**Step 6 — verify by re-measurement, not by the script's own output.** `ssh <fleet> ccrc version` and
`ssh <server> curl -s http://127.0.0.1:7788/health` (loopback-bound and unauthenticated by design; `/api/fleet/health`
sits behind the session gate when armed, so the verb does not lean on it — each box's `ccrc update` already ran the
new tree's `cmd_doctor`, including the cross-box `fleet` check). Both `version` fields equal the target →
`rollout: fleet v0.0.7 (sha) · server v0.0.7 (sha) — agreed`, exit 0. Otherwise exit 1 naming which box disagrees.

**Self-update.** When the deploying machine is the fleet box, box one's update replaces the very `~/ccrc/ccd/ccrc`
the rollout executes from — by rename, so the running verb finishes on the old inode — and the supervisor sweep
try-restarts the deploying session's own supervisor under `KillMode=process`, exactly as `deploy.sh agent` does to
itself today.

**Exit codes.** 2: usage, missing coordinate, failed preflight — nothing touched. 1: a box's update failed, or the
re-measurement disagrees — names which. 0: done, or nothing to do.

### Pins

The `ccrc-update.test.ts` harness (fixture HOME, stub `ssh`/`curl` on PATH recording argv): a missing coordinate
issues no ssh; a box with no recorded role, or the wrong one, issues no `update` argv; the version is pinned from
SHA256SUMS before any `update` argv and both `update` argvs carry the same `--to`; default order and `--server-first`;
box one non-zero → no box-two argv; `--check` issues no `update`; both current → no `update`; verification reads
`version` from `ccrc version` and `/health`, never from update's stdout; `--force` reaches both argvs.

## 5. The "already there" gate in `ccrc update`

**Why a stamp-only gate is wrong here:** section 1's `_inst_stamp` row. A stamp that means both *installed* and
*half-installed* is the overloaded value this codebase bans at a seam.

**The completed-install record.** `~/.ccrc/installed` — one line, the sha — written **last** in `cmd_install`
(after `_inst_wrappers`, before the closing `cmd_doctor`), by temp file and `mv`. One writer: `cmd_install`, which
both `install` and `update` run. `deploy.sh` never writes it, so a `deploy.sh`-stamped box never satisfies the gate
(those stamps carry no version either). `ccrc uninstall` removes it. Absent = no completed install recorded =
proceed. Stale (an older sha, from a run that died late) ≠ stamp sha = proceed.

**The gate, two stages, no writes on the no-op path.** `_upd_fetch` splits into `_upd_resolve` (SHA256SUMS →
`UPD_VERSION`, tarball name) and `_upd_fetch` (tarball, checksum).

1. **Cheap:** `_upd_resolve`. Stamp `version` ≠ target → no gate, proceed as today.
2. **Exact:** versions equal → fetch and verify the tarball *as normal* (sha256 + MANIFEST; nothing on the box
   changed), read the staged `build.json`, and skip iff staged `sha` == stamp `sha` == `~/.ccrc/installed`. Then
   `update: this box already runs v0.0.7 (bd2bf57a…) and that install completed — nothing to do (pass --force to
   reinstall)`, exit 0. **No backup, no restart, no sweep.** A same-version release with a different sha (a moved
   tag) still proceeds.

`--force` skips the gate. `_upd_fleet_warn` still runs first. An unreadable stamp or marker is no evidence, so it
proceeds: the gate only ever skips on three matching shas.

### Pins

Fixture at target with a matching marker → exit 0, no `~/ccrc-backups/` entry, no staged-install argv, no
`try-restart` argv; same stamp, marker absent → proceeds; marker at an older sha → proceeds; `--force` → proceeds;
same version, staged sha differs → proceeds. **The marker is written last:** the existing fault-injection case (which
breaks the install between backup and install to prove ordering) gains a sibling that fails inside `_inst_skills`
and asserts no marker exists afterwards; moving the write earlier reds it. `uninstall` removes it.

## 6. Visibility — the wire, the PWA, the CLI, the doctor

**Wire (additive, absence-permits).** `FleetHealth` gains `builds?: { own: BuildInfo | null; fleet: BuildInfo | null }`
— the evidence beside the existing `build` decision (`agreed | skewed | unknown`, unchanged; `buildAgreement` still
decides). Both values already sit on the server; the route stops withholding them. An older server omits the field
and the PWA renders nothing new — one reader, no `FLEET_PROTO` bump.

**PWA — two things on `FleetScreen`.**
1. `FleetHostBanner` gains the arm it is missing: remote, connected, `build: 'skewed'` → the amber banner naming both
   sides — *The boxes run different builds: fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). Run `ccrc rollout`.*
   A side with no `version` prints as `unversioned (sha)`.
2. `BuildLine` (new, `pwa/src/fleet/BuildLine.tsx`), always visible at the foot of `FleetScreen`: `fleet v0.0.7 ·
   server v0.0.7`. Unversioned or dirty sides render amber; `unknown` renders `—`. It shares the banner's 15 s poll through a
   small `useFleetHealth` hook (one request, not two). This is what makes a `deploy.sh` box *look* second-class
   without a warning that fires when nothing is wrong.

**CLI.**
- `ccrc update --check [--to vX.Y.Z]`: runs `_upd_resolve` only. Its **first line is fixed-shape**, for `rollout`
  to parse: `check: box=<version|unversioned> sha=<sha> target=<version> state=<current|behind|unversioned|incomplete>`
  (`incomplete` = same version, but `~/.ccrc/installed` does not name the stamped sha — §5's record — so
  `rollout` still updates that box). The human sentence follows: `this box: v0.0.7 (bd2bf57a) · latest: v0.0.9 — behind` (exit 1; the label is `target:`
  under `--to`), `— current` (exit 0), or `unversioned (sha) — a release install would be the first on this box`
  (exit 1). **Writes nothing; downloads only SHA256SUMS.** `rollout` runs it on both boxes and composes its plan
  from the first line.
- `ccrc version` adds one line: `install: complete` or `install: incomplete — stamp bd2bf57a, no completed-install
  record`, so the gate's answer is never a surprise.

**Doctor.**
- New `skills` check (`_check_skills`, placed after `wrappers` in the table): for every rostered home, `diff -r -q`
  each of `ccrc-coordinator`, `ccrc-worker`, `ccrc-reviewer` against **the tree** (`~/ccrc/ccd/<name>-skill/`), not
  against the `.cc-sessions` placed copy — on 2026-09-17 both were stale, and the tree is what the stamp names.
  `PASS skills: 18/18 homes carry the shipped skills`, or `FAIL skills: 18 homes differ from the shipped
  ccrc-reviewer` with remedy `ccrc update` (or, when the stamp already matches, the installer by name). Skips on a
  server-only box. `graphify` stays with its own check — its source is the installed package, not the tree.
- `_check_fleet`'s skewed remedy names `ccrc rollout` first and per-box `ccrc update` second.

### Pins

Route test: `builds` present in remote mode, carrying `version` when the stamps do, absent in local mode.
`--check`'s first line parses back to the four fields in all four states. PWA: the
skewed arm renders both sides and the unversioned wording; `BuildLine`'s three renderings; one fetch per poll for
banner + line. `--check`: exits 0/1/1, no tarball fetch, no write under HOME. Doctor `skills`: red on one edited byte
in one home, green after the installer runs; skip on role `server`. The `fleet` remedy names `rollout`.

## 7. Rehearsal, the first live rollout, acceptance

**Rehearsal before the live one.** The update harness (fixture HOME, stub `systemctl`/`tmux` on PATH) pointed at the
**real** `v0.0.2` artifact via `CCRC_RELEASE_BASE_URL`. It proves download, checksums, MANIFEST, extraction, the
box-side `npm ci --omit=dev`, the spine's file work, the stamp, the marker, and skills landing in fixture homes —
everything except the real unit restart and sweep, which are the operations `deploy.sh` performs daily. A
fresh-install pass (`install.sh --release` into a fixture) rides the same rehearsal: the contributor case.

**The live one.** `ccrc rollout --check` first (both boxes print `unversioned (sha)`), then `ccrc rollout`, fleet
first, in a quiet window. Box one fails → box two untouched, box one's backup at `~/ccrc-backups/<ts>/`, and
`deploy.sh` is the known fallback — the strongest reason it is not retired in this phase.

**Acceptance — measured.** `rollout --check` names one version on both boxes; `/api/fleet/health` answers
`build: agreed` with both `builds` versioned; doctor `skills` PASSes on the fleet box; the PWA `BuildLine` shows both
versions; a second `ccrc rollout` prints *nothing to do* and restarts nothing (`systemctl --user show -p
ActiveEnterTimestamp ccrc-agent.service` unchanged across it).

## 8. Documentation that ships in the same PR

- **`CLAUDE.md`** — the operational rules change, so the file changes with them, in the same PR: the Deploy bullet
  (merge → release → `ccrc rollout` on a fleet, `ccrc update` on any box; `deploy.sh` is the fallback and still has
  no default target); the AGENT-FIRST sentence becomes `rollout`'s default order with `--server-first` as the
  inversion; the reviewer/worker/coordinator bullets stop implying an agent-lane deploy is how a skill reaches a home
  (`ccrc update` converges every home); the "how to tell what is deployed" story names `ccrc version`, `ccrc update
  --check`, `/health`'s `version` and the PWA `BuildLine`.
- **`README.md`** — the Deploy and Update sections say the same. **Line-neutral edits only:** `pools-prose.test.ts`
  holds CLAUDE.md's "~3100 lines" within ±100, and the README stands at 3195 today.
- The operator's deploy-topology memory is updated by the operator's session after the first live rollout, not by
  this PR.

## 9. Out of scope

Retiring `deploy.sh` and the tests that pin its arms (follow-on, after a few real rollouts); a PWA- or
coordinator-triggered rollout; changelog or release-notes generation; gating releases on `ci.yml`; macOS-specific
rollout work (`ccrc update` is already per-OS on the box; `rollout`'s ssh is OS-agnostic).

## 10. Files

New: `deploy/release-main.sh`, `.github/workflows/release-main.yml`, `pwa/src/fleet/BuildLine.tsx`,
`pwa/src/fleet/useFleetHealth.ts`, `server/test/release-main.test.ts`, `server/test/ccrc-rollout.test.ts`.
Changed: `ccd/ccrc` (`cmd_rollout`, `cmd_update` gate + `--check` + `--force`, `_upd_resolve`/`_upd_fetch` split,
`cmd_install` marker, `cmd_uninstall`, `cmd_version`, usage), `ccd/ccrc-doctor-checks` (`_check_skills`, `_check_fleet`
wording, the table), `shared/api.ts` (`FleetHealth.builds`), `server/src/server.ts` (the route), `pwa/src/fleet/FleetHostBanner.tsx`,
`pwa/src/screens/FleetScreen.tsx`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-install.test.ts`,
`server/test/ccrc-uninstall.test.ts`, `server/test/build-release.test.ts` (the new workflow's pins beside the old
one's), the fleet-health route test, the doctor test, PWA tests, `CLAUDE.md`, `README.md`.
Untouched: `deploy/deploy.sh`, `deploy/build-release.sh`, `.github/workflows/release.yml`, `install.sh`.

## 11. The mutation table this design owes

Each row is a guard that ships with a case that goes RED when the guard is removed, measured before and after.

| Guard | Red when |
|---|---|
| `release-main.sh` refuses a dirty tree | the `git status --porcelain` check is removed |
| tagged HEAD exits 0 without pushing | the `--points-at HEAD` short-circuit is removed |
| patch derivation | `sort -V` is replaced by plain `sort` (`v1.9.10` sorts below `v1.9.9`) |
| tag pushed before publish | the two lines are swapped |
| failed publish deletes the tag | the trap is removed |
| `release-main.yml` thinness | a second build command or a second trigger is added |
| `rollout` pins the version first | the `--to` is derived per box instead of once |
| `rollout` preflights roles | the role read is removed (a role-less fixture box gets an `update` argv) |
| `rollout` stops on the first failure | the `&&` between boxes becomes `;` |
| `rollout` verifies by re-measurement | verification reads update's stdout instead of `ccrc version` / `/health` |
| the gate skips only on three matching shas | any one of the three comparisons is dropped |
| the marker is written last | the write moves above `_inst_skills` |
| `uninstall` removes the marker | the `rm` is removed |
| `--check` writes nothing | a write under HOME is added |
| `builds` on the wire | the field is dropped from the remote-mode literal |
| the skewed banner arm | the arm is removed |
| doctor `skills` | the `diff -r -q` is replaced by an existence check |
