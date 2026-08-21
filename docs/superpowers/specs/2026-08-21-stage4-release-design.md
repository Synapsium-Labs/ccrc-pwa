# Stage 4 — release pipeline (design)

Elaborates the parent OSS design's Stage 4 (`2026-08-11-ccrc-oss-single-dev-infra-design.md`
§3 :84-99, §7 :181-198, §8 :205-211, row :233) under the operator rulings of 2026-08-21
(decision brief, PR #80): **R1 granted** (the supervisor-sweep carve-out), **R2 full release
infrastructure**, **R3 the proof is restated**. The six engineering recommendations E1–E6
stand as written in the brief; this spec is their buildable form.

## The restated proof (R3)

Update N→N+1 with one command per box on a two-box (server + fleet) install; **the server's
`/health` and the fleet box's `ccrc version` (and the agent ready frame) all report N+1**;
the server's `/api/fleet/health` build agreement reads `skewed` while one box is stale and
`agreed` after both update; uninstall leaves Claude settings clean; reinstall succeeds.

## 1. Release identity (E1)

- Version = git tag `vX.Y.Z`. The tag rides IN `build.json` as a fifth field `version`,
  written by both stampers (`deploy.sh stamp_build`, `_inst_stamp`) when a tag points at the
  built commit, and by the release job always; absent on untagged dev builds (additive —
  `parseBuildInfo` and the jq/python3 readers tolerate absence, and every reader is
  enumerated and migrated in one task: `parseBuildInfo`, `/health` (emits `version` beside
  `build`, satisfying §3 :87 without breaking the current shape), `AgentReady.build`,
  `ccrc version`, `ccrc status`, `ccd version`'s python3 reader).
- `buildAgreement` continues to compare **sha + dirty only**. A tag-equal/sha-differ pair is
  skew; the sha is the truth, the tag is the label. Pinned.

## 2. The release pipeline (R2 — full)

- **`deploy/build-release.sh`** — the testable core, runnable locally and called by CI:
  from a clean checkout, builds all packages, assembles ONE tarball
  `ccrc-<version>.tar.gz` containing the matched set — `server/dist`, `server/dist-pwa`,
  `agent/dist`, the three `package.json`+`package-lock.json` (for `npm ci --omit=dev` on the
  box), `shared/`, `ccd/` (ccd, ccrc, ccrc-doctor-checks, hooks, both skills, installers),
  `deploy/` units + helper scripts, `install.sh` — plus `SHA256SUMS` (the tarball's own
  digest beside it, `sha256sum -c`-compatible). It **refuses a dirty tree** and refuses an
  untagged HEAD unless `--untagged` (CI never passes it) — this is where `deploy.sh:78`'s
  stage-4 promise lands.
- **`.github/workflows/release.yml`** — thin: on tag push `v*`, checkout, node from the
  engines floor, run `build-release.sh`, upload tarball + `SHA256SUMS` to a GitHub Release
  for that tag. No logic in YAML that the script doesn't own.
- Layout is documented in the tarball's own `MANIFEST` (paths + per-file sha256), which
  `ccrc update` verifies after extraction; the outer checksum guards transport, the manifest
  guards the set.

## 3. `install.sh` — the fetch mode (R2)

Two modes, one script:
- **Checkout mode** (today's, unchanged): run from a clone, build, hand off to
  `ccrc install`.
- **Release mode**: `install.sh --release [vX.Y.Z]` (default: latest release) downloads the
  tarball + `SHA256SUMS` from GitHub Releases, verifies, extracts to a staging dir, and
  hands off to the STAGED `ccrc install` — no build step on the box, prebuilt dists ship in
  the tarball (E2: update/install converge on install's `npm ci --omit=dev` lane).
  Stage 5's "outside developer installs from the public repo using only the README" proof
  runs this mode.

## 4. `ccrc update [--to vX.Y.Z]` (spec §7, E2/E3/E5)

Per box, explicit, never automatic. Steps, each refusing loudly rather than degrading:
1. **Fetch + verify** the release (default: newest; `--to` pins) — checksum, then manifest.
   A box with no network answers with the `curl` failure and changes nothing.
2. **Back up** to `~/ccrc-backups/<ts>/`: coord.db (`VACUUM INTO` via the shipped
   `backup-coord.mjs`), current dists, ccd, units — deploy's backup set, one implementation.
3. **Install atomically** — the `_inst_*` spine re-run from the staged tree (same seed-once
   / REGENERATE classes; `~/ccrc` replaced via rsync from the staging dir).
4. **Restart + verify + sweep**: restart `ccrc.service` (server box) / `ccrc-agent.service`
   (fleet box), `verify-service.sh` window, then the **supervisor sweep** (R1 — §6 below)
   on boxes that run supervisors.
5. **Migrations + report**: coord.db migrations run at next server boot by design (the
   existing machinery); update prints `from → to` versions (build.json old/new, coord.db
   user_version before/after) and finishes with `cmd_doctor`.

- **Two-box ordering (E3):** per box, fleet-box-first by runbook; the server-box run WARNS
  loudly (does not refuse) when `/api/fleet/health` says the fleet host is behind.
- **Rollback (E5):** `--to <previous>` reinstalls the older artifact set and **prints** the
  coord.db restore commands from the newest pre-update backup rather than auto-restoring.
  Migrations stay forward-only; an older server READS a newer coord.db (shipped behavior).
- The registry gets NO version key; spec §7 :191's "registry format" migrations are retracted
  for v1 (E5, brief).

## 5. `ccrc install --role fleet` (E4)

- `--role server|fleet|both` (default `both` = today's single-box shape, so existing
  installs converge unchanged). Role is RECORDED (`CCRC_ROLE` in `ccrc.env`'s first-write
  template; existing boxes: `ccrc update`/`install` re-runs leave the seed-once file alone
  and the role stays inferred-with-a-label as today).
- `--role fleet`: prompts (tty-only) for the agent token and server URL, writes
  `~/.ccrc/agent.env` (0600, seed-once), installs `ccrc-agent.service` (whose REQUIRED
  `EnvironmentFile` is now satisfied — the reasoned exclusion at `ccd/ccrc:2622-2633` keys
  on the role, not disappears), skips `ccrc.service` enable/restart and the coord-adjacent
  steps. D-73 closes.

## 6. The supervisor-sweep carve-out (R1 — granted 2026-08-21)

- `cmd_update` step 4 sweeps `claude-session@*` units onto the new ccd exactly the way
  deploy does: the `KillMode=process` preflight is MANDATORY (refuse the sweep, not the
  update, if the drop-in is absent), then `try-restart` with the `--state=failed` warn loop
  and `--state=active` verify loop. Panes are never touched; tmux is never touched.
- **CLAUDE.md's SAFETY section gains the scoped exception**, stating: the never-touch rule
  stands for every actor EXCEPT `ccrc update`'s step-4 sweep (and deploy.sh's existing
  sweep), both of which carry the preflight; everything else remains forbidden.
- deploy.sh keeps its own sweep for now (it executes over SSH in a context where `ccrc` may
  be mid-replacement); a test pins that BOTH carry the preflight, so the two cannot drift on
  the safety property. Retiring deploy.sh's copy is Stage-5+ work.

## 7. `ccrc uninstall` + `ccrc logs` + `ccrc backup` (E6)

- **`uninstall`**: refuses while live sessions exist (counted via `_box_sessions`) unless
  `--force`. Removes: units (stop, disable, delete incl. both drop-ins and the slice
  escape), settings.json hook entries (the `install-session-hooks.sh:72` predicate, with the
  same per-file backup), marker-verified wrappers only (`shared/mark.mjs`), ccrc's OWN
  artifacts inside `~/.cc-sessions` (hooks, notify, skill trees — file-by-file; the live
  registry rows and operator switches stay), `~/ccrc` (the tree), `~/.local/bin/{ccd,ccrc}`.
  Preserves: `~/.ccrc` whole, registry rows, worktrees, backups; offers `.pre-ccrc-<UTC>`
  keep-asides back by printing the restore commands. `--purge` additionally removes
  `~/.ccrc` and ccrc's backups — never worktrees, never tmux state.
- **`backup`**: runs update's step 2 standalone (same set, same directory shape,
  `CCRC_BACKUP_KEEP` pruning).
- **`logs`**: `journalctl --user -u ccrc.service` (server) / `-u ccrc-agent.service` (fleet)
  with `-f`/`-n` passthrough — thin, discoverable, no parsing.

## 8. Doctor

- `_check_fleet`'s skew remedy strings change from `bash deploy/deploy.sh …` to
  `ccrc update` (fleet-box-first sentence).
- One new check, `build`: compares the RUNNING server's `/health` sha (localhost, D-150
  aware — a 401 is not a fault, and in local/unarmed mode it reads the socket directly)
  against `build.json`'s sha; FAIL names the restart remedy. Closes the hole recorded at
  `ccd/ccrc:2714-2717`.

## 9. Runbook

Step 12: cut a tag on a throwaway version, wait for the release, `install.sh --release` on
the server VM and `ccrc install --role fleet` on a second VM, prove the restated criterion
(§R3), then `ccrc update` both boxes across a second tag, then `ccrc uninstall` + reinstall
on one box. Quoted doctor/transcript lines get `runbook-holds` pins.

## Out of scope

Auto-update (never); down-migrations; registry version keys; retiring deploy.sh;
`you.ccrc.app`; multi-fleet update orchestration; signing beyond sha256 checksums (GPG/SLSA
are later hardening).
