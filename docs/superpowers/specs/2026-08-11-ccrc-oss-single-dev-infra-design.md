# ccrc OSS single-dev edition — infrastructure workstream

**Date:** 2026-08-11
**Status:** Approved design, pending implementation plan
**Owner workstream:** infrastructure / distribution / packaging / operations.
A parallel workstream owns product FEATURES; this document deliberately does not
design any user-facing capability beyond the auth surfaces (login page, passkey
enrollment) and version surfaces.

## Goal

Turn ccrc from a single-operator system grown in place on two specific machines
into **an installable, updatable, standalone product a solo developer anywhere
can run** — the best solo-dev experience possible — and open-source it. A
separate, later product (the org/team edition, where an org deploys the stack
and its engineers share it) is explicitly out of scope; decisions here must not
wall it off, and one (the auth seam) is chosen specifically to serve it later.

The evidence base for this design is the 2026-08-10 installability survey
(six investigation angles + two adversarial critics + synthesis; 47 blockers
catalogued): `scratch/2026-08-10-rollout-readiness-synthesis.md`. Its headline:
ccrc is not a program that gets installed — it is a running machine whose repo
is a partial description of it. This workstream closes that gap.

## Decisions (locked with the owner, 2026-08-11)

| Decision | Choice | Why |
|---|---|---|
| Approach | Productise the core — no rebuild | Survey: nothing in the single-user product needs structural re-architecture; the battle-tested core (ccd, supervision, reap discipline) survives untouched |
| Topology | Single box by default; the current server-box + fleet-host split stays first-class | `FleetMode = 'local' \| 'remote'` already exists and local is already the code's default; the split is config, not architecture |
| Platform | Linux servers only at launch | systemd --user, linger, tmux are load-bearing; macOS is a per-release tax with no v1 payoff |
| Security boundary | Real auth on the server; Tailscale demoted to optional reachability | "Standalone shippable" — the tailnet ACL cannot be the product's security model |
| Exposure | HTTPS on a real name; PWA requires a secure context | Service workers, install prompts, push — the PWA is the product surface |
| Naming | Pluggable name+cert acquisition: free dynamic-DNS subdomain as the zero-homework default, bring-your-own domain as the same code path; a ccrc-operated subdomain service (`you.ccrc.app`) is a LATER third provider and the natural business feature | v1 ships no central infrastructure this project must keep alive; the provider seam is where the paid tier slots in without redesign |
| TLS termination | Installer-managed Caddy in front; ccrc stays plain HTTP on localhost | ACME issuance/renewal is Caddy's core competency, not surface we should own; bring-your-own-proxy users skip it |
| Auth mechanism | Passphrase set by `ccrc passwd` immediately after install — install itself writes none, since under `curl \| bash` stdin is the script (shipped 3a deviation) — scrypt-hashed, server-side sessions, rate-limited + optional WebAuthn passkey enrolled after first login | The PWA lives on a phone; passkeys are the right ergonomics there. Recovery = `ccrc passwd` run locally on the box (i.e. over SSH) — see §6 |
| Remote control | `--remote-control` becomes per-install config (`CCRC_REMOTE_CONTROL`); default **off** for OSS installs | Nothing in ccrc's data/control path uses it (prompts go via tmux send-keys, chat via transcripts); it exists to make sessions discoverable on claude.ai — a second UI the ccrc PWA supersedes — and it costs render workarounds (fleet.ts:93, inject/send.ts:559). CAVEAT: ccd's pane-parsing heuristics were calibrated against RC-mode rendering, so the off-mode needs validation, not just a flag (Stage 2) |
| License | AGPL-3.0, sole copyright holder | Protects the future team edition from hosted-fork competition; dual licensing stays available for the commercial edition |
| Lifecycle CLI | New thin `ccrc` command (install/update/doctor/status/logs/backup/uninstall) | ccd is versioned BY the thing the updater replaces — the updater must live outside it (the in-place-overwrite bug class PR #28 just fixed, one level up). ccd remains the session tool |
| Updates | `ccrc update` — explicit, human-invoked, per box; opt-in newer-version notice; never auto-update | Consent temperament: the system that gates its own destructive verbs on confirmation does not change running software unasked |
| Distribution | CI-built matched-set tarball on GitHub Releases + checksums; `curl … install.sh \| bash` bootstrap | No npm (file: deps, no workspace root, node-pty compiles anyway), no Docker (the server's job is host manipulation) — survey YAGNI findings |

## Design

### 1. Topology

Default install: one machine runs server (+PWA bundle), agent, ccd, and the
sessions — the server's existing `local` fleet mode. The current production
shape (server on one box, fleet host(s) on others, `remote` mode) is selected
by config at install time and is exercised by the same installer, updater and
doctor: multi-box operation must remain as robust as — or more robust than —
today, because the owner's own deployment is the reference installation.
Role is per box: `server`, `fleet`, or `both` (single-box).

### 2. Configuration — one file per box, read by everything

`~/.ccrc/ccrc.env` becomes the single source of machine configuration:

- `ccrc.service` gains `EnvironmentFile=-%h/.ccrc/ccrc.env` and loses its baked
  `Environment=` literals (`CCRC_HOST=203.0.113.7`, `CCRC_PORT=7788` — today
  deploy.sh ships ccrc.env to `~/.ccrc/` but the unit reads NOTHING; survey
  blocker #1 by depth). `ccrc-agent.service` already carries an
  `EnvironmentFile=` line and is the precedent being followed.
- ccd sources it; the agent reads it; deploy-era scripts derive their targets
  from it: `ccclip` loses its unconditional hardcoded `BOX=you@…`, and
  `notify.sh`'s existing `${CCRC_ADDR:-…}` seam gets its default from the
  config file instead of a baked fallback IP.
- `CCRC_PORT` (default 7788, today's value) and `CCRC_REMOTE_CONTROL`
  (default off for fresh installs; §6 of the decisions table) live here too.
- The three disagreeing projects-root definitions (`$HOME/projects`,
  `/data/projects`, `/srv/projects`) reconcile to one
  configured `CCRC_PROJECTS_ROOT`; the agent's literal Hetzner volume id
  whitelist root becomes this variable.
- The Claude account roster moves from a compile-time literal in
  `shared/api.ts` (one person's five accounts, pinned by a cross-language
  fixture test) to `~/.ccrc/accounts.json`. Shipped default: a single
  `claude` account. The fixture test guards the LOADER, not the literals.
  Wrapper executables in `~/.local/bin` are GENERATED from this file at
  install/update — today they are in no repo and installed by nothing.
- Format is env, not TOML/YAML: systemd parses it natively, ccd is bash,
  node reads process.env — no component gains a parser dependency.

### 3. Build identity and releases

- Version = git tag `vX.Y.Z`; build stamp = tag + commit sha + build time,
  embedded at build time.
- Surfaces: `/health` (`{ok, version, sha}`), `ccd version`, the agent ready
  frame, the PWA about/status surface, `ccrc status`.
- Releases are CI-built from tags: ONE tarball per release containing the
  matched set — server dist, agent dist, prebuilt PWA bundle, ccd, unit files,
  installer — plus a checksums file. GitHub Releases is the distribution
  channel. An update ships a *ref*, never someone's working tree (today's
  deploy rsyncs whatever is on the operator's disk, dirty or not).
- Version-skew visibility: the server compares its build identity against
  each fleet host's agent/ccd (carried on the existing `ccd caps` handshake
  and agent ready frame) and surfaces mismatch in `/health`, `ccrc status`
  and the PWA. Today NOTHING knows the three artifacts are a matched set —
  the class of bug that cost the 2026-08-10 afternoon (merged fix, stale
  binaries, no surface anywhere saying so).

### 4. Install

`curl -fsSL <release-url>/install.sh | bash` → downloads the latest release
tarball, verifies its checksum, unpacks, and hands off to `ccrc install`:

1. Asks the minimum: box role (both/server/fleet), how this box gets its name
   (§6), projects root (default `$HOME/projects`). The passphrase is NOT asked
   here: install never prompts for it (`curl | bash` stdin is the script — 3a's
   shipped deviation); `ccrc passwd` right after install is the step (§6, Auth).
   (This is the stage-3 end state; the stage-2 installer skips the
   naming/exposure step entirely and configures localhost-only exposure.)
2. Writes `~/.ccrc/ccrc.env` + `~/.ccrc/accounts.json` (single `claude`
   account default).
3. Generates account wrappers; installs ccd, units, session hooks; enables
   `loginctl` linger (never run or documented today); installs and configures
   Caddy when the exposure step needs it.
4. Ends with `ccrc doctor` and prints the URL + next steps.

Idempotent: re-running converges an existing install rather than damaging it.

First-run spawn correctness is in scope for this workstream (it is the new
user's literal first command): `_accept_first_run_prompts`'s missing terminal
return (exhaustion exits 0 via `sleep`'s status and `/effort` is typed into
whatever dialog is on screen), and the started-after-spawn registry race that
consumes a uuid the registry then re-spawns against.

### 5. Doctor

`ccrc doctor` — the loud preflight and the standing health check. Checks, each
with a named remedy: node satisfies the repo's `engines` pin (currently
`>=22.13.0`, the node:sqlite flag boundary — doctor reads the pin from the
shipped package.json rather than hardcoding a second copy);
tmux/git/gh/jq/python3/flock present;
`gh auth status` + repo scope; `git config user.email`; linger enabled;
wrappers present and executable for every roster account; config completeness;
name resolves to this box + cert validity/expiry; services active; disk
headroom (including the backup dir); version matched-set across configured
fleet hosts. Runs at the end of install and update; runnable any time.
Temperament rule made mechanism: today the entire prerequisite set is
instructions that were never even written.

### 6. Exposure: name, certs, auth

**Name acquisition is a pluggable installer step** — "how does this box get a
name and a certificate?" — with two v1 providers:

- **Free dynamic-DNS (default, zero homework):** one concrete provider —
  DuckDNS. The installer walks the user through the free token, registers the
  subdomain, points it at the box, keeps it updated. The seam is pluggable
  but v1 implements exactly this one provider plus BYO domain; additional
  DDNS providers are later work, not v1.
- **Bring-your-own domain:** user points DNS at the box; same code path with
  a different name.

A ccrc-operated subdomain service (`you.ccrc.app`) is a deliberate LATER third
provider — it is central infrastructure someone must run and the natural
business/product feature (provided URL by default, custom domains as a
team-edition capability); v1 ships nothing the project must keep alive.

**TLS:** installer-managed Caddy terminates HTTPS for the chosen name and
reverse-proxies to ccrc on localhost. Users with their own proxy skip the
Caddy step; the documented contract is "terminate TLS, forward to
`localhost:$CCRC_PORT`" (set in ccrc.env at install; default 7788, today's
value). ccrc itself never speaks TLS and listens on loopback only.

**Auth:** server-side sessions (HttpOnly cookie), a login page, a passphrase
created by `ccrc passwd` right after install (install itself never prompts —
under `curl | bash` stdin is the script; scrypt-hashed, stored in `~/.ccrc`),
rate-limited login,
optional WebAuthn passkey enrollment after first login. Recovery:
`ccrc passwd`, run locally on the box (i.e. over SSH), rewrites the scrypt
hash, invalidates all server-side sessions, and leaves enrolled passkeys
intact. EVERY HTTP route and
websocket sits behind the session gate except `/health` and the existing
machine-token routes (`/api/notify`, coordination lanes — the box token stays
for machine-to-machine). Today ~40 routes, including a raw pty websocket and
spawn-a-session-in-any-directory, have zero gates; the tailnet ACL is the only
boundary and it lives outside the repo. This single-identity session layer is
deliberately the seam the team edition later extends with per-user identity.

### 7. Update

`ccrc update [--to vX.Y.Z]`, per box:

1. Fetch release, verify checksum (refuse dirty/unverifiable artifacts).
2. Back up: coord.db snapshot (`VACUUM INTO`, shipped in PR #28), current
   dists, ccd — the Stage-0 backup/retention discipline carries over.
3. Install atomically (temp + rename — PR #28's `install_atomic` discipline).
4. Restart and verify services (`verify-service.sh` window discipline);
   sweep `claude-session@*` supervisors onto the new ccd (PR #28).
5. Run versioned migrations (registry format, coord.db schema — hang on the
   existing `CoordDbUnmigratable` machinery); print `from → to`.

No auto-update, ever. Doctor/PWA may show "vX.Y.Z available" via an opt-in
check. Rollback: `ccrc update --to <previous>` reinstalls the older artifact
set; coord.db and the registry are restored from the step-2 backup taken
before the forward update. Migrations are forward-only — there are no
down-migrations.

### 8. Day-to-day operations

- `ccrc status` — services, versions (all boxes), session counts, disk.
- `ccrc logs [server|agent|session <id>]` — journalctl wrappers.
- `ccrc backup` — manual snapshot with the same tooling; documented restore.
- `ccrc uninstall` — stops/disables units, removes session hooks from Claude
  settings.json (the inverse that has never existed — today a declined trial
  leaves every Claude session shelling to a deleted script), removes
  generated wrappers; preserves `~/.ccrc` (config, accounts, passphrase
  hash), `~/.cc-sessions`, worktrees and backups unless `--purge`. A
  subsequent install detects the existing `~/.ccrc` and converges instead of
  re-asking. An uninstall is what makes a second install safe to try.
- `ccrc passwd` — the auth recovery path (§6).

### 9. Out of scope for this workstream

- Multi-user identity/ownership (team edition; the auth seam is its hook).
- Docker/OCI, npm publishing, macOS (survey YAGNI — each adds surface with no
  v1 payoff; the server's job is host manipulation, containers fight it).
- The shared-repo `ws/*` slug-namespace collision (a two-person problem; solo
  dev never draws from a shared pool — team edition concern).
- Config/settings UI, account-management UI (features workstream).
- Auto-update, subpath hosting, PWA↔server protocol negotiation build-out.
- The `ccrc.app` subdomain service (later provider; business decision).

### Stages — each ends demonstrably working

| Stage | Ships | Proof |
|---|---|---|
| 1 | Repo can rebuild a box: EnvironmentFile cutover; ship the unshipped artifacts (claude-session@.service, statusline, tmux.conf, drop-ins, cap-scopes timer); de-hardcode agent root; build identity in /health + ccd version | Scratch VM, deploy, `/health` build id equals what was shipped — an assertion that today cannot even be phrased |
| 2 | Config file + accounts.json + wrapper generation + `ccrc` CLI skeleton + doctor + single-box installer (localhost, no TLS yet) + first-run spawn fixes + `CCRC_REMOTE_CONTROL` config with pane-heuristic validation in BOTH modes | Fresh VM → install.sh → doctor green → real session runs (RC off) → PWA on localhost, under 15 minutes |
| 3a | Auth: `onRequest` session gate behind a config flag, login page, passphrase, `ccrc passwd`, passkey enrollment | On localhost (a secure context for WebAuthn): anonymous requests rejected on every route and websocket; passkey login works |
| 3b | Exposure: name providers (DuckDNS + BYO) + Caddy setup + certs | PWA installed on a phone over the public internet; login required |
| 4 | Release pipeline (tag → CI tarball) + `ccrc update` + migrations + uninstall | Update N→N+1 with one command on a TWO-BOX (server + fleet) install; `/health` reports N+1 on both; doctor's matched-set check goes red when one box is stale and green after both update; uninstall leaves Claude settings clean; reinstall succeeds |
| 5 | OSS polish: AGPL-3.0 LICENSE, README-as-install-guide, de-branded defaults (account labels out of shared/api.ts, service-worker denylist de-hardcoded), repo public | An outside developer installs from the public repo using only the README |

Stage ordering note: stages 1–2 are pure de-hardcoding and packaging and can
overlap with the features workstream freely; stage 3a touches server routing
(the auth hook) and is deliberately its own stage so the session-gate seam
lands EARLY — features build behind it rather than migrating later. 3b is
independent of the features workstream entirely.

## Risks and mitigations

- **Two workstreams, one server codebase.** The auth gate (stage 3a) is the
  main collision surface. Mitigation: land the gate as one `onRequest` hook +
  helper as its own early stage, behind a config flag until cutover.
- **DDNS provider dependence.** DuckDNS et al. are free services with no SLA.
  Mitigation: provider step is pluggable by design; BYO domain always works;
  failure mode is degraded (cert renewal fails loudly in doctor) not fatal.
- **Caddy as a dependency.** One more moving part per install. Mitigation:
  it is optional by contract (BYO proxy documented); installer owns its
  config end-to-end; doctor checks it.
- **AGPL friction for adopters.** Accepted consciously — the protection for
  the future team edition outweighs adoption friction for a solo-dev tool.

## References

- Survey + synthesis: `scratch/2026-08-10-rollout-readiness-synthesis.md`
- Stage 0 (shipped): PR #28 — atomic installs, supervisor sweep, coord.db
  backup, backup retention. Its mechanisms are load-bearing for §7.
- Deploy-automation forensics (2026-08-10): CI is verification-only; deploy
  practice is agent-chained merge→deploy; the "operator gate" lives in prose.
