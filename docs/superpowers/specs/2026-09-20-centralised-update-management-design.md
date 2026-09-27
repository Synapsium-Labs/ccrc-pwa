# Centralised update management — design

**Date:** 2026-09-20. **Status:** approved section by section in dialogue with the operator; this document is the
written form for review before a plan is cut. It has been through two bounded adversarial review rounds (round 1:
four judgment lenses, a citation verifier, one skeptic per finding, 42 findings; round 2: a closure check of
round 1 plus security, consistency and citation lenses, 34 findings) — every finding that survived its skeptic is
folded in, and three the skeptics waved through with a one-word verdict were folded anyway (§11's watchdog
predicate, §8's phase mapping, §15's per-wave capability words). The one declined finding is named in §14.
**Builds on:** `2026-09-18-release-rollout-design.md` (the release channel and `ccrc rollout`, which this document
extends and in one decision reverses — §2.1), `2026-09-18-account-pool-membership-design.md` (the
central-authority-to-flat-file projection this document copies), `2026-08-21-stage4-release-design.md` (the
artifact). **Fleet names are ROLES** here — a server node, a fleet node — never hosts; real values live in
`deploy/reference-fleet.md`, gitignored. Every `file:line` below was measured on 2026-09-20 at `origin/main`
`7d78b376`; a line number is a snapshot, the identifier beside it is the anchor.

## 0. In one paragraph

Every merge to `main` is already a release and `ccrc rollout` already moves the two boxes to it — but nothing
tells the operator that a release exists, nothing distinguishes a release that has baked from one cut an hour ago,
a release proves only that its bytes were not corrupted in transit and nothing about who built them, a failed
update is recovered by a human reading `~/ccrc-backups/` over ssh, and every one of those facts is spelled as a
`{own, fleet}` pair that a fleet of N nodes cannot be. This design adds **two channels on one version line**
(`dev` = every merge, `stable` = a fast-forward promotion that rebuilds nothing), **Sigstore keyless provenance**
verified on every node before extraction with no secret anywhere in the repo, a **central control plane in
`coord.db`** — a release catalogue with one poller, a node inventory re-measured on a tick, and a desired-state
intent that nodes converge to by pull, so an offline node catches up when it returns — a **settings screen** with
the channel selector, the release list and the inventory, a **one-tap update** from the PWA that reverses the
rollout design's "never from the PWA", a **health-gated auto-rollback** so a bad update heals itself, **downgrade
as an explicit act** so nothing can walk the fleet backwards silently, and **versioned installs behind an atomic
symlink** so rollback becomes a flip. Five waves; the last is the dangerous one and gets its own rehearsal.

## 1. The measured problem

| Fact | Measurement |
|---|---|
| Every merge is a release, and nothing says so | `release-main.sh:95` — `gh release create "$NEXT" "$OUT_DIR/ccrc-$NEXT.tar.gz" "$OUT_DIR/SHA256SUMS" --verify-tag`, a normal release, pinned verbatim by `release-main.test.ts:191-192` and `:226-228`. No channel token anywhere: `grep -rn 'prerelease\|channel' ccd/ccrc deploy/ .github/workflows/ install.sh` → 0 hits. Nothing in `server/src` or `pwa/src` compares a box against what is published. |
| Two channels do not exist | A bare `ccrc update` fetches `releases/latest/download/…` (`_upd_resolve`, `ccd/ccrc:11245-11251`); `install.sh:50-51` resolves the same way. The fetch layer knows exactly two URL shapes — `latest/download` and `download/<tag>` — and no URL means "newest prerelease". |
| Integrity is verified; authenticity is not; nothing binds bytes to a tag | `_upd_fetch` (`ccd/ccrc:11269-11291`) checks `SHA256SUMS` then `MANIFEST` — both from the same host, over the same connection, as the tarball. `_upd_resolve` takes the tarball NAME from `SHA256SUMS` (`:11256`) and derives `UPD_VERSION` from it (`:11263-11264`, tag-shaped: `v0.0.9`, which `_upd_converged` compares un-stripped against the stamp at `:11296`); `cmd_update` never compares `$to` with `UPD_VERSION` or with the extracted `build.json` (`:11158-11195`). Zero `secrets.` references in `.github/workflows/*` (measured), a stated stance (`ci.yml:1-16`). No key-based signing fits. |
| The install path is not versioned, and nothing restores it | `_inst_tree` places the tree with an in-place `rsync -a --delete … "$dest/"` into the literal `$BOX_TREE_DIR` (`ccd/ccrc:9497-9499`; `BOX_TREE_DIR="$HOME/ccrc"` at `:1265`). `_upd_backup` (`:11315-11376`) copies a SELECTIVE set — `coord.db` by `backup-coord.mjs` VACUUM INTO, the three dists, `~/.local/bin/ccd`, hook files, units — into `~/ccrc-backups/<ts>/`, and nothing restores it: the only "rollback" is a recipe `_upd_report` PRINTS on a downgrade (`:11585-11591`). `cmd_update` has no lock (`:11069-11222`, no flock). A spine death after `_inst_enable`'s restart (`:10377`) but before `_inst_installed` (the spine's last step) leaves a box that MOVED and is running without `~/.ccrc/installed`, and `cmd_update`'s arm for that is `_ccrc_die` (`:11207` → `:1581`, `exit 1`). |
| A node's build is read once, and the fleet node's files are unreadable | `AgentReady.build` is set only in `FleetClient.onReady` (`server/src/remote/client.ts:384-402`), once per connect. `shared/agent-protocol.ts:70-84` records the bug where `observedEpoch` was read at that cadence and corrected to a per-tick reader (`server/src/pools.ts:412-429`) — which works only because `$REG` is `~/.cc-sessions`: the agent's read allowlist (`agent/src/whitelist.ts:83-90`) is `.cc-sessions`, `.cc-limits`, `.cc-clips`, `projectsRoot` and `.claude*`, and **nothing under `~/.ccrc`**; a refused read reaches the server as `unreadable` (`server/src/remote/io.ts:18-19`, `:54-55`). The agent's text read has no size cap (`agent/src/fileops.ts:75-81`; the 12 MB cap is on the b64 op, `:91`). No file under `server/src` reads `~/.ccrc/installed` (measured grep). |
| Everything is a pair | `FleetHealth.builds: {own, fleet}` (`server/src/server.ts:1181`), `buildAgreement(a, b)`, `FleetHostBanner`'s skewed arm, `BuildLine`'s two sides. A third node has no row to occupy. |
| The control plane already exists | `coord.db` (`node:sqlite`, WAL, 13 migrations, `COORD_SCHEMA_VERSION = MIGRATIONS.length`, `schema.ts:977-979`) holds `pool_edges` + `pool_epoch` (`:955-972`), journalled to `~/.ccrc/pool-edges.log` (`coord/pooledgelog.ts:39`), served by `GET /api/pools/epoch` (`server.ts:2689`) and pulled to the fleet box by `ccd-pool-sync.timer` (`OnUnitActiveSec=60s`) into `$REG/pool-epoch` by tmp-then-rename. That timer is installed on the fleet role only (`ccd/ccrc:10211-10212`, `:10316-10317`), Linux only (`_inst_units_darwin`, `:10084-10107`, writes one plist), and its binary is hand-named at six spine sites — `_inst_bins` (`:9772`, whose comment `:9765-9769` records the 203/EXEC-every-60-seconds failure of forgetting it), the two summary echoes (`:9808`, `:9810`), `cmd_uninstall`'s bin and unit lists (`:12090`, `:12105`, `:12335`, `:12337`), the wrapper-sweep `case` (`:12203`) and `deploy/gen-wrappers.mjs:201-202`'s `TOOLCHAIN_EXECUTABLES`. |
| The restart-surviving spawn exists, and an older agent's answer is measured | `_svc_run_detached` (`ccd/ccrc:1016-1028`, byte-identical to `ccd/ccd:957-969`): `systemd-run --user --collect --quiet "$@"` on Linux; `nohup … &` on Darwin, whose own comment (`:1012-1015`) promises only that the caller "is exiting, not being SIGKILLed with its group". `setsid` is NOT enough — it stays in the caller's cgroup (`ccd/ccd:15589-15591`, incident 2026-07-05). Neither `deploy/ccrc.service` nor `ccrc-agent.service` sets `KillMode`. An agent that does not know an op answers `ResErr 'bad-request'` at once (`agent/src/server.ts:775-783`, `validateReq`'s `default: return null`), which `client.ts:210-213` already documents. |
| A PWA-triggered privileged act has a precedent | `POST /api/fleet/reboot` (`server.ts:1207-1224`) reboots the fleet box via Hetzner, gated only by `fleetMode === 'remote'` + configured creds and the global session gate; no box token; pinned by `fleet-health.test.ts:244-305`. |
| The exec surface is closed and stays closed | `EXEC_COMMANDS = ['tmux','ccd']` (`agent/src/whitelist.ts:134`), pinned by `ccrc-api-closed.test.ts:289` and `whitelist-structural.test.ts:475`; `systemctl`, `node`, `curl`, `gh` are in `FORBIDDEN_COMMANDS` (`:145-152`). The server never SSHes the fleet box at runtime. |
| The PWA's own bundle is not the problem | `registerType: 'autoUpdate'` plus `main.tsx`'s 15-minute and visibility-change `registration.update()`. Untouched here. |

## 2. Decisions

1. **The rollout design's decision 5 is reversed.** It read: "Rollout is an operator act from a machine with ssh to
   both boxes. Never from the PWA or the coordinator." The operator reshaped it on 2026-09-20: the PWA gets a
   one-tap update. Two of its reasons survive as constraints: the exec surface stays `tmux`/`ccd`, so the fleet
   node is moved by a **typed op carrying a pinned tag**, never an exec grant; and the server never SSHes the
   fleet node, so the op is the only path. Its third reason — "a server updating itself over its own agent link
   is the wrong shape" — is answered by not doing that: the server updates itself locally (§10), and only the fleet
   node is reached over the link. `ccrc rollout` **stays**: it is the path that works when the console is down.
2. **Two channels, one version line, one spelling.** `dev` is every merge; `stable` is a promotion of an existing
   release. A release's bytes never change and its version string never encodes its channel. **The canonical form
   of a version everywhere in this design is the TAG** — `v0.0.9`, validated by the single `isReleaseTag` guard —
   in `releases.version`, `nodes.currentVersion`, `nodes.highestVersion`, `~/.ccrc/floor`, `UPD_VERSION` and
   `build.json`'s `version` (`shared/buildinfo.ts:31-40` documents the field as the tag); `shared/semver.ts`
   strips the `v` inside the comparator and nowhere else. "Is this node behind?" is that comparator, on every
   node, on either channel.
3. **Promotion is a fast-forward merge to `stable` and flips one boolean.** No rebuild — a rebuild of the same tree
   produces a different `build.json` (`builtAt`, `build-release.sh:153-158`), so a different MANIFEST and a
   different digest: two byte strings claiming one version, and the promoted one is the one nobody ran. A merge
   commit carries no release tag, so the promotion script refuses it — "promote a tree nobody built" is
   unexpressible.
4. **Authenticity by keyless provenance, never by a key; identity names the workflow, and bytes are bound to the
   tag — on both verifier backends.** The repo carries no secrets and this design adds none. A bundle verifies
   only against the two workflow identities that build releases, and only for the tag the caller asked for,
   whether the verifier is `sigstore-js` or the `gh` fallback.
5. **Central authority, flat-file projection, bash reads the projection.** `coord.db` decides; `ccrc` reads a
   file; the pattern is `pool_edges` → `$REG/pool-epoch`, copied discipline for discipline (§9).
6. **Nodes, not a pair.** One row per node keyed by a node id the node itself persists. `builds: {own, fleet}`
   becomes a derived view and retires when nothing reads it (§14).
7. **Desired state, converged by pull; a one-tap is a row, not an event, and a refusal does not consume it.**
   Setting intent pushes nothing. A node whose desired ≠ current moves itself and proves it by re-measurement. An
   offline node keeps its intent. An operator's tap is written to the node's row, survives the dispatch and every
   refusal or drop, and is cleared only by convergence or by the operator — so "Update all" moves the second node
   after the first settles, and a node that dropped mid-dispatch moves when it returns.
8. **Never backwards by accident, on any path.** Convergence, whether automatic, pinned or requested as an
   `update`, moves a node only to a strictly NEWER version than its floor; the node itself refuses to install
   below its floor whichever way the target was resolved — `--to`, the projection, or `latest`. Moving down is
   `rollback` — an explicit verb, an explicit button, an explicit flag on the CLI — never a resolver outcome, and
   a rollback is **sticky**: the floor keeps automatic convergence off the tag you rolled back from until a newer
   release exists. A release that vanishes or is demoted cannot walk the fleet down.
9. **Notify by default; install on consent; unattended as a setting.** Auto-install is off until the operator
   turns it on, and the dispatcher — not only the route — refuses an unattended dispatch to any node that does
   not report the rollback gate.
10. **Multi-tenancy is a documented seam, not code.** `nodes.nodeId` and `update_intent.scope` are the identity
    seam; dispatch blast radius is a second seam (§14). No tenant column, no per-tenant auth, no tenant-aware
    resolver, no dispatch groups in this programme.
11. **No overloaded null at any seam.** "Unversioned" and "never measured" are two columns; "catalogue empty" and
    "GitHub unreachable" are two fields; "reverted" and "never moved" are two states; "a bundle is listed" and "a
    bundle verified" are two words; "no agent by construction" and "an agent too old to say" are NULL and `''`.
    Named per table in §6.
12. **The verifier that verifies a download is the installed one.** Never the downloaded one. Precedent:
    `_upd_backup` resolves `backup-coord.mjs` out of the running tree — "the tool that snapshots the old world ships
    beside the ccrc doing the snapshotting, never fetched" (`ccd/ccrc:11310-11314`).
13. **Capabilities are files, not version numbers — and they are self-reported.** The server cannot run `ccrc
    update --check` on a fleet node (`ccrc` is not an exec command). What a node's `ccrc` can do is read from
    `~/.ccrc/ccrc-caps`, written by the install spine; what its agent can do is read from an additive `ops` list on
    `ready`. Both defend against version skew — a dispatcher sending an op a node cannot answer — and neither is a
    security boundary against a hostile node, which already runs as the same user as everything on its box.
14. **The same verb, the same way, from every caller.** The PWA path, the CLI path and `rollout` all end in
    `ccrc update --to <tag>` on the node. What the PWA adds is `--detach` (§10) and `--from pwa` (attribution).
15. **The box token never writes intent.** It is one shared secret every session on the fleet box reads
    (`ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`), and those sessions process untrusted input; a
    key that can point the fleet at a release is a session credential or nothing.
16. **A node's verdict on a release is the node's, not the fleet's.** A provenance refusal removes a tag from THAT
    node's eligible set and is cleared by the operator's `ack`; it is shown fleet-wide, never enforced fleet-wide.
    One skewed clock or stale trust root on one box cannot freeze every other box out of a security update.
17. **macOS nodes are not centrally managed in this programme.** `ccrc update`/`rollback` work there by hand
    exactly as they do today; the projection timer, the watchdog and the detached self-update have Linux arms
    only, and a Darwin node's row says so (§9, §17). A launchd arm is a named follow-on, not a silent gap.
18. **W5 (versioned installs) is its own wave with its own rehearsal** against a real published artifact, as the
    rollout design's §7 rehearsal was — which found a total failure (D-3105).

## 3. Model and vocabulary

- **Node** — any box running ccrc software: the server node, each fleet node. Identified by `nodeId`: a UUID
  minted once by `cmd_install` into `~/.ccrc/node-id` when absent, never rewritten, removed by `cmd_uninstall`.
  *There is no `{own, fleet}` pair in the new model.*
- **Release** — an immutable published artifact identified by its `vX.Y.Z` tag.
- **Channel** — `stable` | `dev`. A property of a release's *current membership* (GitHub's `prerelease` flag) and of
  a node's *intent*. Never a property of bytes.
- **Intent** — the desired version for a scope (a node, or `*` for the fleet default): a channel, an optional
  pinned tag, an auto-install mode, a notification mode.
- **Request** — an operator's tap, written to a node's row: "move this node to this tag, as an update or a
  rollback". Cleared by convergence or by `ack`, never by a refusal.
- **Report** — what a node writes about its own update in `~/.ccrc/update.json`; the server measures it and
  derives the node's state from it.
- **Convergence** — a node moving from current to desired and proving it by re-measurement.
- **Capability** — a word in `~/.ccrc/ccrc-caps` naming something this node's installed `ccrc` can do, or a word
  in the agent's `ops` naming an op it answers.
- **Floor** — the highest version a node has ever completed an install of (`~/.ccrc/floor`); nothing automatic
  moves a node below it, and the node itself refuses to go below it without `--downgrade`.

## 4. Release side

```
main merge   → release-main.sh: tag vX.Y.Z, build ONCE, gh release create … --prerelease   → dev
             → actions/attest-build-provenance over ccrc-vX.Y.Z.tar.gz
             → the bundle published as a release asset: ccrc-vX.Y.Z.tar.gz.sigstore.json
stable ff    → release-stable.sh: gh release edit vX.Y.Z --prerelease=false; gh release edit vX.Y.Z --latest
             → NO build. Same tag, same commit, same bytes.
```

**`deploy/release-main.sh`.** Line 95's argv gains `--prerelease` and names the bundle as a third artifact —
explicitly, never a glob, for the reason the file states at `:92-94` (glob order follows locale collation).
`release-main.test.ts:192`'s `.toBe(...)` and `:227-228`'s `.toContain(...)` are updated to the new argv (the stub
`gh` at `:101-106` records `$*` as one line, so the flag is a trailing token there). Its refusals, derivation
(`:53-59`) and the already-tagged short-circuit (`:43-48`) are untouched.

**`deploy/release-stable.sh`** (new; argument discipline as its siblings — `-h`, anything else exit 2):

1. `git tag --points-at HEAD | grep -E "$SHAPE" | head -n1` — **no tag → exit 2** with `stable must fast-forward
   to a commit released from main; a merge commit has no release to promote`. This is the code-side enforcement of
   decision 3; the branch ruleset (below) is the other.
2. `gh release view "$TAG" --json isPrerelease,isDraft` — no release → exit 1 (the condition `release-main.sh`'s
   trap exists to prevent; if it happened, say so). `isDraft: true` → exit 1.
3. `isPrerelease: false` → exit 0, `already stable <tag>` — idempotent.
4. `gh release edit "$TAG" --prerelease=false`, then `gh release edit "$TAG" --latest` — **two calls**, because the
   REST doc says drafts and prereleases cannot be set as latest, and one PATCH carrying both fields would be
   validated against a state this design has not measured. Then `gh release view "$TAG" --json isLatest` and print
   it: `promoted <tag> to stable (isLatest: true)`. GitHub's automatic "latest" is the most recent non-prerelease
   by `created_at` — **the commit's date**, not the publish date — so an older commit promoted after a newer one
   would not win automatically; `--latest` is the explicit override (`make_latest: true`) and is why step 4 has a
   second call. **Because `--latest` can point `latest/download` at an OLDER commit's tag by a routine act, every
   node's floor check is keyed to the resolved version, not to the presence of `--to` (§9).**

**`.github/workflows/release-stable.yml`** (new; thin): `on: push: branches: [stable]`; `concurrency:
{group: release-stable, cancel-in-progress: false}`; `permissions: contents: write`; `timeout-minutes: 10`;
`actions/checkout@v4` with `fetch-depth: 0`; one step: `bash deploy/release-stable.sh` with `GH_TOKEN`.

**The `stable` branch** is created by hand once at `main`'s tip and protected by a ruleset with **Require linear
history** (which is the rule that forbids merge commits; *Block force pushes* is a separate control and is also
set). The documented promotion act is `git push origin <tag>^{commit}:refs/heads/stable` from any checkout with the
tag fetched; a PR into `stable` works only with a rebase-merge that reproduces `main`'s commits exactly, so the
README documents the push. Demotion is `gh release edit <tag> --prerelease` by hand, beside it — and §9 says what
demotion does NOT do to a fleet already on that release: nothing.

**Provenance in both build workflows** (`release-main.yml`, `release.yml`). `release.yml` stops being
byte-identical to its stage-4 form and the rollout design's pin on that changes with it — said here so it is not a
silent contradiction. Each gains the attest step after the build step, `actions/attest-build-provenance` **pinned
by tag**, with `subject-path: release-out/ccrc-*.tar.gz`; its `bundle-path` output is copied to
`release-out/ccrc-<version>.tar.gz.sigstore.json`. `release.yml`'s `gh release create … release-out/*` (`:58`)
picks it up by glob; `release-main.sh` names it. **The permission set is taken from the pinned action's own
README at that ref, not from either doc page** — measured 2026-09-20, `actions/attest`'s README and the
docs.github.com guide disagree (`id-token: write` + `attestations: write` in both; `contents: read` in one,
`artifact-metadata: write` in the other). `build-release.test.ts:471-475` pins `release-main.yml`'s permissions as
an exact two-line block and forbids `id-token:` outright; both assertions are rewritten to the new block, in the
same PR. **Two workflows produce two certificate identities** — `release-main.yml@refs/heads/main` for every
auto-patch and `release.yml@refs/tags/<tag>` for a hand-cut minor (`release.yml:11-13` is `on: push: tags:
['v*']`, so its OIDC `ref` is the tag, never `main`) — and §5's verifier accepts exactly those two.

### Pins

`release-main.test.ts`: the argv carries `--prerelease` and the bundle path. `release-stable.test.ts` (new, same
fixture shape — stub `gh` recording argv, a bare-repo origin): untagged HEAD → exit 2, no `gh`; tagged and `view`
says prerelease → two `edit` argvs in order (`--prerelease=false` then `--latest`) and a closing `view`; `view` says
stable → exit 0, no `edit`; `view` fails → exit 1; `set -euo pipefail`. `build-release.test.ts`: a new describe for
`release-stable.yml` (its own file, as `:421-489` do) — triggers on `stable` pushes only, the concurrency group,
`contents: write` and nothing else, invokes `release-stable.sh` and no build command; both build workflows carry the
attest step with `subject-path` naming the tarball glob and the pinned action ref, and the permissions block equal
to the ref's documented set.

## 5. Authenticity

`ccrc update`'s fetch becomes: `SHA256SUMS` → **the tag is bound** → **the floor is checked** (§9) → tarball →
**sha256 (transport)** → `<tarball>.sigstore.json` → **verify provenance** → extract → **the extracted version is
bound** → **MANIFEST**. Nothing that fails a step puts a file outside `UPD_STAGE`; the existing "nothing on this
box was changed" sentences are kept and four are added. `cmd_update` already probes `node` on PATH before it
starts (`ccd/ccrc:11128-11135`), so the verifier's runtime is a stated precondition, not a new one.

**Binding bytes to the tag** (decision 4). Today `SHA256SUMS` — under the publisher's control, not an attestation
subject — names the tarball, and whatever it names is installed. Three refusals close that, all in the canonical
tag form (decision 2): (1) with `--to <tag>`, `cmd_update` refuses before `_upd_backup` when `UPD_VERSION !=
"$to"` — the un-stripped comparison `_upd_converged` already makes at `:11296` — saying "the release at `<tag>`
names a `ccrc-<other>.tar.gz`; refusing"; (2) after extraction it refuses when `$UPD_TREE/build.json`'s `version`
differs from `UPD_VERSION`; (3) the verifier asserts the in-toto statement's subject NAME (`ccrc-<tag>.tar.gz`) as
well as its digest, so a genuinely attested tarball served under another tag's asset path refuses.

**The verifier**: `deploy/verify-provenance.mjs`, shipped in the tarball (tracked under `deploy/`, so
`build-release.sh`'s `git archive` pathspec carries it unchanged), installed in the tree. Invoked as
`node "$BOX_TREE_DIR/deploy/verify-provenance.mjs" --blob <tarball> --bundle <bundle> --tag <tag> --owner <owner>
--repo <repo>`; exit 0 verified, 1 refused with one line saying why, 2 usage. **It is the INSTALLED tree's copy**,
`$BOX_TREE_DIR`, never `$UPD_TREE` (decision 12).

**What "verify" means, on either backend.** The bundle is a Sigstore bundle signed via the workflow's OIDC
identity. Verification is four checks: the bundle's signature over the blob's digest against the Sigstore
public-good trust root; the subject name against `ccrc-<tag>.tar.gz`; the certificate's issuer against
`https://token.actions.githubusercontent.com`; and the certificate's SAN against an **allowed identity set of
exactly two URIs**, built from the owner/repo and the tag:
`https://github.com/<owner>/<repo>/.github/workflows/release-main.yml@refs/heads/main` and
`https://github.com/<owner>/<repo>/.github/workflows/release.yml@refs/tags/<tag>`. Nothing wider — an identity of
`<owner>/<repo>` alone would accept an attestation minted by any workflow on any branch of a public repo.

- **Primary backend**: `sigstore-js` — `verify(bundle)` with `certificateIssuer` / `certificateIdentityURI`
  options (`packages/client/README.md`, measured), run once per allowed URI, against a **vendored trusted root**.
  **That it verifies with zero network calls given that root is INFERRED, not measured** (the readme excerpt
  fetched does not say it in one sentence).
- **Fallback backend**, taken only if the spike below fails: `gh attestation verify <tarball> --bundle <bundle>
  --repo <owner>/<repo> --cert-identity <the exact URI> --cert-oidc-issuer https://token.actions.githubusercontent.com
  --custom-trusted-root <the vendored root> --deny-self-hosted-runners`, once per allowed URI, plus the subject-name
  check done by `verify-provenance.mjs` itself over the bundle's statement. A bare `gh attestation verify --bundle
  --repo` verifies that SOME workflow in the repo signed the blob — the widening the sentence above forbids — so the
  fallback is specified with its constraints attached, and `gh`'s presence is the only thing it adds to a node.
  Offline mode with a bundle on disk is measured (`cli.github.com/manual/gh_attestation_verify`); whether it also
  needs `--custom-trusted-root` to avoid a TUF fetch is part of the spike.

**W1's first task is the spike**: verify a real bundle from a real release with outbound network blocked, on each
backend; record which passes; the fallback's cost (a `gh` on every node) is recorded as a deviation if taken, not
hidden.

**Identity is a deliberate second literal, held equal by a pin.** `CCRC_RELEASE_OWNER`/`CCRC_RELEASE_REPO` are
spelled twice on purpose — `install.sh:19-24` (the header comment: "ONE owner/repo pair, spelled nowhere else"
refers to install.sh's own tree) and `ccd/ccrc:1318-1319`, whose comment at `:1309-1317` explains why `ccd/ccrc`
cannot read install.sh's copy (install.sh runs before any ccrc exists on the box; `ccd/ccrc` runs on boxes
install.sh has long left) and names the mechanism holding them equal: `server/test/ccrc-update.test.ts:971-974`.
The verifier takes them from `ccd/ccrc`'s pair, so a fork that de-brands both files (stage 5's act) verifies
against its own two workflows.

**First install is trust-on-first-use, said out loud.** `install.sh --release` has no installed verifier to use and
must not use the one it just downloaded (self-attestation). It prints `install: first install trusts the release's
transport checksum only; every update from here verifies provenance` and proceeds exactly as today
(`install.sh:66-104`).

**`--allow-unsigned`**: must be typed on the `ccrc update` argv by a human — the one automatic caller that may pass
it is §11's restore arm 2, and only when the node was ALREADY running unsigned code; permits an ABSENT bundle (a
release older than W1, a fork with no attest step), never a FAILING one; prints its warning; and **writes
`unsigned` as the second line of `~/.ccrc/installed`** so the node's row reads `provenance: unverified` (§6). A
silent override is the overloaded null this repo bans. `cmd_version`'s `install:` line (`ccd/ccrc:1732-1761`)
prints it too, and doctor's new `provenance` check WARNs on it (§11).

### Pins

`ccrc-update.test.ts` (its fixture: throwaway `$HOME`, recording stubs on PATH, the real script under `spawnSync`,
`:1-45`): a fixture verifier that exits by argv — failing bundle → exit 1, nothing extracted, no backup dir; absent
bundle → exit 1 without `--allow-unsigned`, proceeds with it and the marker's second line reads `unsigned`; the
verifier argv names `$BOX_TREE_DIR/deploy/…`, never `$UPD_STAGE`, and carries `--tag`; the recording stub proves
verification runs after `sha256sum -c` and before `tar -x`; `--to v0.0.9` against a `SHA256SUMS` naming
`ccrc-v0.0.3.tar.gz` → exit 1 before any backup, and `--to v0.0.9` against one naming `ccrc-v0.0.9.tar.gz`
proceeds (the comparison is tag to tag); an extracted `build.json` whose `version` ≠ `UPD_VERSION` → exit 1,
nothing installed. `verify-provenance.test.ts`, **run against both backends** (the `gh` backend under a stub that
records argv): a checked-in real bundle from `release-main.yml` verifies its blob under the `main` identity; a
checked-in bundle from `release.yml` verifies under its tag identity; either offered for a DIFFERENT tag refuses
(subject name); a bundle whose SAN names a third workflow path refuses on both backends; a different `--owner`
refuses; one flipped byte in the blob refuses; the `gh` argv carries `--cert-identity`, `--cert-oidc-issuer` and
`--custom-trusted-root`. `install-sh.test.ts`: the TOFU sentence prints on `--release`.

## 6. The control plane — `coord.db`, `MIGRATIONS[13]` (banner `14: user_version 13 -> 14`)

Four tables and one singleton. **The file's idiom, not mine**: enumerated columns are `TEXT` with no SQL `CHECK`
— `schema.ts:6-20` states that every enum column has a designated we-do-not-know member on the READ side, so a
token written by a newer build "lands somewhere honest instead of being switched on and rendered as nothing"; the
vocabulary lives once in `shared/api.ts` as a union + runtime array + type guard (`RunState`'s shape,
`api.ts:4017-4035`). Columns are additive-only (`schema.ts:4-5`). `COORD_SCHEMA_VERSION` derives to 14 and the two
literals that pin it (`asks-store.test.ts:25`, `coord-db.test.ts:660-666`, `:721`) move with it. Every version
column holds the tag form (decision 2).

**One writer per COLUMN GROUP**, named in the DDL and pinned by a scan over the named writer methods — because
"one writer per table" is false of this design's own sections, and round 1's column groups still had one group
with three writers.

```sql
-- the CATALOGUE.
CREATE TABLE releases (
  -- catalogue columns: writer = the poller (§7), method upsertRelease
  tag            TEXT PRIMARY KEY,   -- 'v0.0.9'
  version        TEXT NOT NULL,      -- 'v0.0.9' — the same string; a column so the comparator has a name to sort by
  channel        TEXT NOT NULL,      -- UpdateChannel, from GitHub's prerelease flag
  publishedAt    INTEGER NOT NULL,   -- epoch ms
  commitSha      TEXT,               -- NULL = target_commitish was a branch name, not a sha
  tarballUrl     TEXT NOT NULL,
  bundleListed   INTEGER NOT NULL,   -- 1 iff a <tarball>.sigstore.json asset is LISTED. A filename claim,
                                     --   NOT a verification (§7). Nothing renders it as "verified".
  notes          TEXT,               -- the release body, capped at 4096 bytes by the poller, plain text
  yanked         INTEGER NOT NULL DEFAULT 0,  -- 1 = draft, or absent from a later listing
  observedAt     INTEGER NOT NULL,   -- last listing that confirmed this row
  -- notification columns: writer = the notifier (§13), method markReleaseNotified
  notifiedAt     INTEGER             -- NULL = no release push sent for this tag
);
-- a NODE's verdict on a release (decision 16). Writer = the inventory sweep, method refuseRelease;
-- cleared by ack (§12), method clearRefusals. One row per (node, tag); never fleet-wide.
CREATE TABLE node_release_refusals (
  nodeId  TEXT NOT NULL, tag TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL,
  PRIMARY KEY (nodeId, tag)
);
-- the INVENTORY.
CREATE TABLE nodes (
  nodeId           TEXT PRIMARY KEY,
  role             TEXT NOT NULL,    -- 'server' | 'fleet' | 'both'
  label            TEXT NOT NULL,    -- the connection's name today ('server', 'fleet')
  -- measurement columns: writer = the inventory sweep (§8), method upsertNodeMeasurement
  currentVersion   TEXT,             -- NULL = the stamp carries no version (unversioned build)
  currentSha       TEXT,             -- NULL = no stamp could be read or parsed
  currentRef       TEXT,             -- the stamp's ref, builtAt, dirty — so a full BuildInfo round-trips
  currentBuiltAt   TEXT,             --   and buildAgreement keeps its sha+dirty inputs (§14)
  currentDirty     INTEGER,
  stampRead        TEXT NOT NULL,    -- 'ok' | 'absent' | 'unreadable' | 'malformed' — the read, not the value
  installState     TEXT NOT NULL,    -- InstallState
  provenance       TEXT NOT NULL,    -- ProvenanceState
  caps             TEXT NOT NULL,    -- validated words from ~/.ccrc/ccrc-caps; '' = file absent or invalid
  agentOps         TEXT,             -- validated words from the agent's ready.ops; '' = agent connected, ops
                                     --   absent (older agent); NULL = no agent by construction (a server-role row)
  highestVersion   TEXT,             -- ~/.ccrc/floor; NULL = file absent = UNCONSTRAINED (§9)
  previousVersion  TEXT,             -- ~/.ccrc/previous line 1; NULL = file absent (nothing to roll back to)
  os               TEXT NOT NULL,    -- 'linux' | 'darwin' | 'unknown', from ~/.ccrc/ccrc-caps' first line
  measuredAt       INTEGER,          -- NULL = NEVER measured. Distinct from every column above.
  reachable        INTEGER NOT NULL,
  unreachableSince INTEGER,          -- NULL iff reachable
  -- report columns: writer = the inventory sweep, from ~/.ccrc/update.json (§8), method upsertNodeMeasurement
  reportedPhase    TEXT,             -- UpdatePhase; NULL = no report file
  reportedTarget   TEXT,
  reportedStartedAt INTEGER,
  reportedUpdatedAt INTEGER,
  reportedDetail   TEXT,             -- truncated, printable ASCII (§8)
  -- lease columns: writer = dispatchNode (acquire), releaseLease and settleNode (§10) ONLY.
  --   updateState is DERIVED from the report by the sweep's mapping (§8) but WRITTEN only by these three,
  --   which the sweep calls; a report older than updateStartedAt never touches them.
  updateState      TEXT NOT NULL,    -- UpdateState
  updateTarget     TEXT,             -- the tag of the current or last attempt
  updateStartedAt  INTEGER,
  updateDetail     TEXT,             -- the dispatcher's reason for the last state change
  -- resolved columns: writer = the resolver (§9), method resolveNode
  channel          TEXT,             -- RESOLVED; NULL = the intent row's token is out of vocabulary
  desiredTag       TEXT,             -- RESOLVED; NULL = nothing resolvable
  resolveDetail    TEXT,             -- the resolver's reason for NULL, rendered by §13; no other writer
  -- request columns: writer = requestNode (the apply/rollback routes, §12) sets; settleNode (on convergence)
  --   and ack clear. A refusal or a drop NEVER clears them (decision 7).
  requestedTag     TEXT,             -- NULL = no operator request outstanding
  requestedKind    TEXT,             -- RequestKind; NULL iff requestedTag is NULL
  requestedAt      INTEGER,
  -- identity column: writer = rekeyNode (§8)
  supersededBy     TEXT              -- NULL = live; a label-keyed row that a nodeId row replaced
);
-- DESIRED STATE. Writer: the intent route (§12), method setIntent.
CREATE TABLE update_intent (
  scope      TEXT PRIMARY KEY,       -- a nodeId, or '*' (the fleet default). THE IDENTITY SEAM (§14).
  channel    TEXT NOT NULL,          -- UpdateChannel
  pinnedTag  TEXT,                   -- NULL = newest eligible release on `channel` (§9)
  auto       TEXT NOT NULL,          -- AutoMode
  notify     TEXT NOT NULL,          -- NotifyMode (§13); ships here in W2, read by W3
  setAt      INTEGER NOT NULL,
  setBy      TEXT NOT NULL           -- 'pwa' | 'migration'
);
INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');
-- the projection's epoch, pool_epoch's single-row idiom (schema.ts:940-946), seeded so no reader handles absence.
-- Writer: setIntent, in the same transaction as the intent row and the journal append.
CREATE TABLE update_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, issuedAt INTEGER NOT NULL);
INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);
```

**Vocabularies, declared once in `shared/api.ts`:**

```ts
export type UpdateChannel   = 'stable' | 'dev';
export type UpdateState     = 'idle' | 'pending' | 'applying' | 'reverted' | 'failed' | 'unknown';
export type UpdatePhase     = 'queued' | 'resolving' | 'fetching' | 'verifying' | 'backing-up' | 'installing'
                            | 'restarting' | 'checking' | 'restoring' | 'done' | 'reverted' | 'failed' | 'unknown';
export type InstallState    = 'complete' | 'incomplete' | 'unknown';
export type ProvenanceState = 'verified' | 'unverified' | 'unknown';
export type AutoMode        = 'off' | 'stable' | 'channel';
export type NotifyMode      = 'channel' | 'stable' | 'off';
export type RequestKind     = 'update' | 'rollback';
export const UPDATE_STATES: readonly UpdateState[] = ['idle', 'pending', 'applying', 'reverted', 'failed', 'unknown'];
export function isUpdateState(v: unknown): v is UpdateState { return typeof v === 'string' && (UPDATE_STATES as readonly string[]).includes(v); }
export const BUSY_UPDATE_STATES = ['pending', 'applying', 'unknown'] as const;   // unknown is BUSY — the safe direction
export const SETTLED_UPDATE_STATES = ['idle', 'reverted', 'failed'] as const;
export const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
export function isReleaseTag(v: unknown): v is string { return typeof v === 'string' && RELEASE_TAG.test(v); }
export const CAP_WORD = /^[a-z][a-z0-9-]{0,31}$/;   // ccrc-caps and ready.ops words; pool-epoch's NAME grammar
// UpdatePhase, UpdateChannel, InstallState, ProvenanceState, AutoMode, NotifyMode, RequestKind each get the same array + guard pair.
```

`unknown` counts as busy for the same reason `RunState`'s `unknown` counts as active for the cap
(`run-states.test.ts:36-39`): a node whose state cannot be read must not be dispatched to; §10's deadline turns a
stale `unknown` into `failed: deadline`. An out-of-vocabulary `channel` token in an intent row reads as `null` on
the ClaimState stance (no we-do-not-know member; `store.ts:201-208`): `nodes.channel` is nullable, the wire
carries `channel: UpdateChannel | null`, the resolver resolves nothing for that node with the reason in
`resolveDetail`, and the PWA renders the reason and no badge — never the fleet default, which would be fail-open.
`isReleaseTag` is the ONE tag-shape guard: the agent's op handler, the routes, the resolver and `cmd_update`'s bash
twin (`$SHAPE`, `release-main.sh:43`) all agree on it.

**Null discipline, row by row.** `stampRead` says how the read went; `currentVersion`/`currentSha` say what it
held. `stampRead = 'ok'` with `currentVersion NULL` = an unversioned build (a `deploy.sh` push). `stampRead =
'unreadable'` (EACCES, a refused read, or a symlink where a file was expected) is never "unversioned" — D-1396's
lesson at a new seam. `measuredAt NULL` = never measured. `highestVersion NULL` = unconstrained (a pre-W1 node, or
a box `_inst_installed` never stamped, `ccd/ccrc:11012-11016`): the floor comparison then falls back to
`currentVersion`, and both NULL resolves `desiredTag NULL` with `resolveDetail` saying so. `previousVersion NULL`
= nothing to roll back to, which the rollback route says (`409 no-previous`). `agentOps NULL` = no agent by
construction; `''` = an agent too old to say. `desiredTag NULL` carries its reason in `resolveDetail` and the UI
says it, never "up to date". `updateTarget` outlives `updateState` returning to `idle`, so "last moved to v0.0.9,
now idle" is readable. `unreachableSince` is its own column so `reachable = 0` cannot be mistaken for "never
seen". `bundleListed` is a claim about a filename; `provenance` on a node is a measurement; only the second is ever
spelled "verified" (§13). `reportedPhase NULL` = no report file, distinct from `'unknown'` = a file whose phase is
not in the vocabulary.

**Store methods live on `CoordStore` in `coord/store.ts`.** `single-definition.test.ts:738-786`'s coord-ring scan
walks `server/src/coord` ONLY (`:738-741`, `coordFiles = sources(coordDir)`), so a new `server/src/update/`
directory is outside it; W2 extends that describe to scan `server/src/update` with an EMPTY allowlist (none of
`catalogue`, `inventory`, `resolve`, `dispatch`, `routes` may import `node:sqlite` or `./db.js`) and keeps the
file-count floor (`:746-751`) so a moved directory reds rather than disarming the scan. Writes follow the file's
own two rules: the guard is in the `WHERE`, never a read-then-write (`setProgramHome`, `store.ts:2557-2566`); and a
method that can refuse never returns `void` (`SetWorkItemResult`'s docstring, `:174-179`, naming `markDelivered` as
the defect). The writer methods, one group each: `upsertRelease`, `markReleaseNotified`, `refuseRelease`,
`clearRefusals`, `upsertNodeMeasurement` (measurement + report groups), `resolveNode`, `requestNode`,
`dispatchNode` (lease acquire, `WHERE updateState IN settled AND NOT EXISTS (busy row)`), `releaseLease` (a
refusal or drop: `updateState` back to `idle`/`failed`, request columns untouched), `settleNode` (convergence:
`updateState = idle`, request columns cleared), `rekeyNode`, `setIntent` — each returns `{ok:true, …} |
{ok:false, why}`.

**Journal.** `setIntent` appends to `~/.ccrc/update-intent.log` INSIDE the transaction, BEFORE the commit, and the
epoch is `max(db epoch, journal max) + 1` — `PoolEdgeLog`'s discipline verbatim (`store.ts:5310-5364`), so a crash
between append and commit SKIPS an epoch and never reissues one.

**The migration slot is a cross-branch namespace.** `MIGRATIONS[13]` is claimed by W2 and re-measured against
`origin/main` immediately before merge, the way `schema.ts:900-926` records slot 12 losing to #108 and `:950-953`
records slot 13 warning #40. No test detects a double slot; the entry's own closing paragraph carries the
re-measurement. Every column this design needs — including `notify`, which W3 reads — ships in this ONE slot; no
wave claims a second.

### Pins

Schema test: the five `CREATE TABLE`s at `MIGRATIONS[13]`, the two seed rows, `COORD_SCHEMA_VERSION === 14`.
`single-definition.test.ts`: one holder per new `export type` (the `:401-410` shape), a new scan per vocabulary
for a hand-typed SQL tuple of its members (the `:561-583` shape), and the coord-ring scan covering
`server/src/update` with an empty allowlist. `update-states.test.ts`: every `UpdateState` in exactly one of
busy/settled, their union equal to `UPDATE_STATES`, `unknown` busy (`run-states.test.ts:20-39`'s three assertions).
Store: every write's refusal is a distinct return arm; `dispatchNode` under a busy row returns `{ok:false,
why:'busy'}` and writes nothing; `releaseLease` leaves `requestedTag` standing; `settleNode` clears it. **Writer
groups, as a scan over `store.ts`'s SQL**: every `UPDATE releases` outside `upsertRelease` touches only
`notifiedAt`; every `UPDATE nodes` naming a lease column is inside `dispatchNode`/`releaseLease`/`settleNode`;
naming a resolved column, inside `resolveNode`; naming a request column, inside `requestNode`/`settleNode`/the
`ack` path; naming `supersededBy`, inside `rekeyNode`; and `upsertNodeMeasurement` names no column outside the
measurement and report groups.

## 7. The catalogue poller

`server/src/update/catalogue.ts`, driven from `FleetWatcher.tick()` by the file's own sub-cadence idiom — a
`private lastCatalogueAt = 0` field gated by `UPDATE_CATALOGUE_MS = 30 * 60_000` and `void`-dispatched with a
`.catch` (`watch.ts:471`, `:879-884`, the `CAPS_REFRESH_MS` shape), plus on demand from `POST /api/updates/refresh`.
It issues `GET {CCRC_RELEASE_API_URL}/repos/{owner}/{repo}/releases?per_page=30` with `Accept:
application/vnd.github+json` and `If-None-Match` from the last `ETag`, no token. Per release it records §6's
catalogue columns, reads the documented `prerelease` boolean into `channel`, sets `bundleListed` when the `assets`
list names `<tarball>.sigstore.json` — **a filename in an unauthenticated listing, and the column says so; the
verifying happens on the node (§5) and is reported back as `provenance` (§8)** — and stores `notes` as plain text
truncated at 4096 bytes with a `…` marker. A release present last time and absent now is marked `yanked = 1`,
never deleted — a node may be running it.

**Quota, measured.** Unauthenticated: 60 requests/hour per IP, and **a 304 still counts** — the free-304 rule is
documented for authenticated requests only. So the ETag saves bytes, not budget; the budget is 2/hour against 60,
and `refresh` is rate-limited to one call per minute in the route so a tapping thumb cannot spend it.
`CCRC_RELEASE_API_URL` (default `https://api.github.com`) is the sibling of the existing `CCRC_RELEASE_BASE_URL`
(`ccd/ccrc:1315`), so a fixture server stands in for GitHub in tests and a mirror can in life.

**Fail-soft, and the failure is a first-class answer.** `catalogueState` on the wire (§12): `{lastOkAt: number |
null, lastError: {at, reason} | null}`. No egress, a 403 rate limit and a 5xx are three `reason` strings under one
`lastError`; a never-polled catalogue is `{lastOkAt: null, lastError: null}`. **No consumer may render any of these
as "up to date."** Pinned at each surface (§13).

### Pins

A fixture HTTP server: a second poll with the same ETag sends `If-None-Match` and writes no rows on 304; a release
that vanishes is `yanked`, not deleted; `prerelease: true` → `dev`; the `.sigstore.json` asset → `bundleListed =
1`; a 5000-byte body → 4096 bytes plus the marker; a 403 → `lastError.reason = 'rate-limited'`, every prior row
intact, `lastOkAt` unchanged; `refresh` twice in a minute → one request.

## 8. Node measurement

`server/src/update/inventory.ts`, a second sub-cadence sweep in `tick()`: `UPDATE_INVENTORY_MS = 60_000`, plus
immediately after a `ready` frame, after an `update` op is accepted, and after a request write. For each node it
reads, through the measured reads (`readFileMeasured`, `io.ts:113`; `MeasuredRead = {ok:true, content} |
{ok:false, reason: ReadFailure}`, `:46`; `ReadFailure = 'absent' | 'unreadable'`, `shared/agent-protocol.ts:313`,
mapped in ONE place, `io.ts:169-170`), budget-bounded with `deadline.race` exactly as
`readObservedEpochFromRegistry` does (`pools.ts:412-429`), **each read preceded by `lstatMeasured` and taken only
when the name is a regular file** — `limits.ts:417-431` is the precedent ("`regular` is the ONLY kind that may
condemn: a `symlink` is what bash refuses"); a symlink or other kind reads as `unreadable`:

- `~/.ccrc/build.json` → `stampRead` from the read (`absent`/`unreadable`), `malformed` when `parseBuildInfo`
  (`shared/buildinfo.ts:86-105`, the one validator) answers null on content, `ok` otherwise, with the whole
  `BuildInfo` (`buildinfo.ts:29-45`) into the five `current*` columns, so `NodeWire.current` is a real one and
  `buildAgreement` keeps its sha+dirty inputs. `parseBuildInfo` collapses four failures to one null by design; the
  read above it is what keeps absent and unreadable apart.
- `~/.ccrc/installed` → `installState` (`complete` when line 1 equals the stamp's sha; `incomplete` when it differs
  or the file is absent with a stamp present; `unknown` when the stamp is unreadable) and `provenance` (line 2
  `unsigned` → `unverified`; no line 2 on a marker whose `caps` include `verify` → `verified`; otherwise `unknown`).
  **No server code reads this file today** (measured) — this is a net-new read.
- `~/.ccrc/ccrc-caps` → `os` (line 1: `os linux|darwin`) and `caps` (one word per following line; absent → `''`,
  `os = 'unknown'`, an older build).
- `~/.ccrc/floor` → `highestVersion` (absent → NULL); `~/.ccrc/previous` → `previousVersion` (line 1; absent →
  NULL).
- `~/.ccrc/node-id` → the row key.
- `~/.ccrc/update.json` → the five **report** columns, verbatim after validation. Then the **mapping** that derives
  the lease state, applied by the sweep through `releaseLease`/`settleNode` and never by a direct write:

| `reportedPhase` | derived `updateState` |
|---|---|
| `queued`, `resolving`, `fetching`, `verifying`, `backing-up`, `installing`, `restarting`, `checking`, `restoring` | `applying` |
| `done` | `idle` via `settleNode` when the same sweep measures `currentVersion = reportedTarget` (a request for that tag clears); otherwise `failed: stamp-mismatch` via `releaseLease` |
| `reverted`, `failed` | the same word via `releaseLease`; a `failed` whose `reportedDetail` begins `provenance:` also writes `node_release_refusals` for `(nodeId, reportedTarget)` — this node's verdict, once |
| `unknown` (a token outside `UpdatePhase`), or `reportedPhase NULL` while busy | leave the lease columns untouched inside the deadline (§10); `unknown` past it → `failed: deadline` |

  **Precedence**: a report whose `reportedStartedAt` predates the row's `updateStartedAt` belongs to a previous
  run and never moves the lease — the race round 2 found, where a stale `{phase:'done'}` released a lease acquired
  seconds earlier and let a second node dispatch under it.

**Validation, because these seven files are same-user-writable by every session on the box** (decision 13). Every
read is capped at 65536 bytes (above it: `malformed` for the stamp, `''` for caps, `unknown` for the report);
`caps` and `agentOps` words must match `CAP_WORD` with at most 32 words, and one bad word drops the whole file to
`''`; `floor` and `previous` line 1 must pass `isReleaseTag` or read NULL; `node-id` must be a UUID or the row
keys by label; `reportedPhase` goes through `isUpdatePhase`; `reportedTarget` through `isReleaseTag`;
`reportedDetail` is cut to 200 printable-ASCII characters. Nothing read from a node reaches the wire or the
screen un-validated.

**The agent's read allowlist must admit these files, narrowly.** `checkPath` (`agent/src/whitelist.ts:83-90`)
admits nothing under `~/.ccrc` today, and that directory also holds `agent.env` (the agent bearer), `auth.scrypt`,
`coord.db`, `deploy.env` and every other secret-bearing file `ccd/ccrc` writes (measured: `grep -o
'$HOME/\.ccrc/[A-Za-z0-9._-]*' ccd/ccrc`). W2 adds an **exact-basename set** — `build.json`, `installed`,
`ccrc-caps`, `floor`, `previous`, `node-id`, `update.json`, `update-intent` — under `$HOME/.ccrc`, read mode only,
never an `isUnder($HOME/.ccrc)` prefix, and `agent/src/whitelist.ts` moves to the Changed list. The structural pin
(`agent/test/whitelist-structural.test.ts`) gains: each basename readable; `~/.ccrc/agent.env`, `auth.scrypt`,
`coord.db`, `deploy.env` and a sibling `build.json.bak` still refused; write mode still admits none of them.
**`update-intent` is in the set so the server can SHOW what a fleet node last received; it is never read back as
authority** — the projection's authority is `coord.db`, and a fleet-side edit of that file is visible in the
inventory as a mismatch, not honoured.

**Row identity, re-keying, freshness.** The sweep visits every node it can name — every agent connection plus the
server's own row — every tick. A fleet node with no `node-id` yet (a pre-W1 build) is a row keyed by its
connection label with `installState = 'unknown'`, shown as such, never dropped. **When a later sweep measures a
`node-id` on a connection whose label keys a row, `rekeyNode` re-keys that row to the UUID in the same
transaction**, carrying its history; if a UUID row already exists (the node was re-installed), the label row is
marked `supersededBy = <nodeId>` and every reader — the resolver, the auto gate, `apply {all}`, the derived
`builds` view, `GET /api/updates` — excludes superseded rows. A row whose connection is absent on a sweep is
written `reachable = 0` with `unreachableSince` on that sweep, never left at its last value. The server node
measures its own files through the local `FleetIO` and its `agentOps` is NULL (it has no agent — decision 11).

**`agentOps`.** `AgentReady` gains an additive `ops?: string[]` (§10) — one reader in `onReady`, absence permits,
an older agent omits it and the row reads `''`. This is handshake-cadence data, and that is correct here: the set
of ops an agent process answers cannot change without that process restarting, which produces a new `ready`.

**`deps.build` stays read-once at boot** — it is a "what am I" fact for the process (`buildinfo.ts:2`,
`index.ts:26-27`) and this design does not change it; the inventory row is the per-tick measurement, and after a
self-update the process is new anyway.

**Why a tick and not the handshake, for everything else.** `fleetState.build` is set once per connect in
`onReady` (`client.ts:384-402`) and a connection lives for days; `client.ts:314-338` records the identical
`observedEpoch` bug and its fix. This design starts from the fixed shape and never reads `fleetState.build` as the
current build.

### Pins

Fixture nodes: EACCES on the stamp → `stampRead = 'unreadable'`, `currentSha NULL`, `measuredAt` set; a symlinked
`build.json` → `unreadable`, never followed; a parseable stamp with no `version` → `stampRead = 'ok'`,
`currentVersion NULL`; garbage → `malformed`; a 70 KiB stamp → `malformed`; a full stamp → all five `current*`
columns; a `ccrc-caps` containing `agent.env`'s bytes → `caps = ''`, `os = 'unknown'`, nothing of it on the wire;
a `floor` that is not a tag → NULL; missing `node-id` → keyed by label, `installState = 'unknown'`; a `node-id`
appearing on a labelled connection → one row, re-keyed, history intact, `GET /api/updates` answers one node not two;
a UUID row already present → the label row `supersededBy` and excluded from every reader; marker line 1 ≠ stamp sha
→ `incomplete`; `unsigned` line 2 → `unverified`; absent `ccrc-caps` → `''` and `os = 'unknown'`; a `ready` frame
triggers one measurement inside the same second; a connection missing on a sweep → `reachable = 0` and
`unreachableSince` on that sweep; the phase table row by row, including a `done` report older than
`updateStartedAt` leaving a busy lease busy; a `failed` with `provenance:` detail → one `node_release_refusals`
row for that node and tag, and a second node's eligibility unchanged; the server row's `agentOps` NULL.

## 9. Intent, resolution, projection, capabilities

**Resolution.** A node's resolved channel is `update_intent[nodeId].channel` if that row exists, else
`update_intent['*'].channel`. Its **eligible** releases are the `releases` rows with `bundleListed = 1`, `yanked =
0`, **no `node_release_refusals` row for THIS node** (decision 16) and (`stable`: `channel = 'stable'`; `dev`:
either channel — a stable release is also the newest thing on `dev` until the next merge), ordered by
`shared/semver.ts` — a small comparator over the tag form with its own test, no dependency, pinned to agree with
`sort -V` on a fixture list run through a shell. Its **floor** is `highestVersion`, or `currentVersion` when the
floor is NULL (unconstrained), or nothing when both are NULL. The desired tag is:

- the row's `pinnedTag`, if set, eligible **and strictly newer than the floor** — a pinned tag at or below the
  floor resolves NULL with `resolveDetail: 'pinned v0.0.5 is at or below this node's floor v0.0.9 — pin a newer
  tag, or use rollback'`; a pinned tag that is not eligible resolves NULL with its reason;
- else the newest eligible release strictly newer than the floor; when none is, NULL with one of TWO sentences,
  chosen by whether the node's `currentVersion` is below its own floor: at the floor → `'newest eligible v0.0.5 is
  not newer than this node's floor v0.0.9 — a yank or demotion cannot move a node down; a newer release will'`;
  below it → `'this node was rolled back to v0.0.8 and its floor is v0.0.9 — auto stays off this tag until a
  release above v0.0.9 exists (decision 8)'`;
- when both floor inputs are NULL, NULL with `'no floor and no measured version — nothing to compare against'`.

**A demotion or a yank therefore never moves a fleet backwards; it only stops it moving forwards** until a newer
release exists. **A rollback is sticky** by the same rule.

**`auto`.** `off` = notify only; `stable` = converge automatically when the resolved channel is `stable`;
`channel` = converge automatically on whichever channel is resolved. The intent route refuses `auto ≠ off` for a
scope in which ANY node — reachable or not, including one with `measuredAt NULL` or `os ≠ 'linux'` — does not
list `update-gate` in `caps`: `409 {error: 'auto-needs-rollback-gate', nodes: string[]}` naming them. **That
refusal is advisory; the dispatcher is the enforcement** (§10): an auto-driven dispatch to a node whose measured
`caps` lack `update-gate` is refused at dispatch time, whatever the intent row says, so a node that was offline
when `auto` was set cannot converge unattended on its return.

**Projection to a fleet node.** `GET /api/updates/intent/:nodeId` (the dual-credential read, §12) answers a
line-oriented document in `$REG/pool-epoch`'s exact grammar discipline:

```
epoch <n>
issued <unix-seconds>
lease <unix-seconds>
channel <stable|dev>
desired <vX.Y.Z|none>
desired-stable <vX.Y.Z|none>
desired-dev <vX.Y.Z|none>
auto <off|stable|channel>
end
```

`desired` is the resolution for the node's channel; the two `desired-*` lines are the same resolution run for each
channel, so `--channel` (below) can select the other one **without any local network resolution**. **Seconds, not
milliseconds** — `server.ts:2679-2688` records the C1 defect where a ms lease made ccd's `stale` arm unreachable
for ~56,700 years. `lease` is `issued + 15 min`, `pool_epoch`'s lease. `ccd/ccd-update-sync` (new in W4, a sibling
executable exactly as `ccd-pool-sync` is and for its stated reason — `ccd` makes zero network calls,
`ccd-pool-sync` header) pulls it every 60 s from `ccd-update-sync.timer` (installed by `_inst_units` beside
`ccd-pool-sync.timer`, `ccd/ccrc:10211-10212`, `:10316-10317`, **fleet role, Linux only** — decision 17; and, as
§1's row records, a sibling binary must be placed by `_inst_bins`, named in the summary echoes, removed by
`cmd_uninstall`, skipped by the wrapper sweep and listed in `gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES`, or the
timer 203/EXECs every 60 seconds forever), validates the WHOLE document against the grammar in its embedded python
before staging, and installs it by tmp-then-rename to `~/.ccrc/update-intent` — the writer's rule at
`ccd-pool-sync`'s header: WRITE NOTHING UNLESS THE WHOLE ANSWER ARRIVED. The 65536-byte cap and the `end`
terminator are the torn-write detectors and are copied, not reinvented. **On a server-role or `both` node the
server process is the writer**: it writes the same document for its own row, same grammar, same rename, at every
resolution AND on every inventory sweep (60 s), so its `lease` is refreshed on the same cadence the timer gives a
fleet node. **Until W4, a fleet node has no local projection at all** — W2 ships the route and the server-role
writer; a fleet node's `ccrc update` takes the not-configured arm below for one wave, honestly.

**`ccrc update` reads the projection** when no `--to` is given: `channel`/`desired` from the file, printing which.
The reader's vocabulary is `_acct_pool_state`'s five words (`ccd/ccd:2162`), re-derived for this file **and made
role-aware**, because the timer-unit test alone is unconditionally false on exactly the node that is most
centrally managed. `CCRC_ROLE` is read from `~/.ccrc/ccrc.env` (the field `ccrc rollout` already preflights):

| role | "configured" means | absent projection |
|---|---|---|
| `fleet` | `ccd-update-sync.timer`'s unit file is installed (checked the way `_pool_sync_installed` does, `ccd/ccd:2098-2120` — the unit file, never the projection's own absence) | not configured → **fall back to `stable`** printing `update: no control plane on this box — following stable`; configured → `unreadable` → refuse with `systemctl --user start ccd-update-sync.service` |
| `server` / `both` | `CCRC_ROLE` is recorded at all — the server process is the writer | `unreadable` → refuse with `restart ccrc.service (it writes ~/.ccrc/update-intent on every sweep)` |
| any, `os darwin` | never configured (decision 17) | fall back to `stable` printing `update: no control plane on this box (macOS: not centrally managed) — following stable` |

`lease` in the past → `stale` → refuse naming the age; grammar violation → `malformed` → refuse; `desired none` →
refuse, printing the server's reason. **`--channel stable|dev`** selects the matching `desired-*` line of a
resolvable projection for one run, and **refuses off the control plane** — `update: --channel needs the control
plane (no projection resolves on this box); use --to <tag>` — because the fetch layer has no URL that means
"newest prerelease" (§1) and a node never resolves a channel locally. `--to <tag>` remains the only offline way to
name a dev build. `rollout --channel` (§14) reads each node's resolved `desired` from the server and passes `--to`
to the box, never `--channel`.

**The floor, on every path.** `_inst_installed` (the spine's last step) also writes `~/.ccrc/floor` — the stamped
tag — when it is higher than the file's current line (the comparator's `sort -V` twin); a restore or rollback
never lowers it. **`cmd_update` checks the floor against `UPD_VERSION` immediately after `_upd_resolve`, whichever
way the target was resolved** — `--to`, the projection's `desired`, or `latest/download` — and refuses below it
unless `--downgrade` is typed or `--from restore|rollback|watchdog` is the caller, with the sentence naming which
path resolved the target. `cmd_rollback` passes the second. §4 is why this is keyed to the resolved version and
not to the presence of `--to`: `--latest` can point `latest/download` at an older commit's tag by a routine
promotion, and a fallback-arm node would otherwise walk down on its next bare `ccrc update`.

**Capabilities.** `_inst_caps`, a new spine step placed with `_inst_stamp`, writes `~/.ccrc/ccrc-caps` by
`_inst_atomic`: line 1 `os linux|darwin`, then one word per line. **Each wave's spine adds its own words**, so the
file records what THIS install can do, never what the design intends: W1 — `verify`, `node-id`, `floor`; W4 —
`update-json`, `update-gate`, `rollback`, `detach` (Linux only); W5 — `versions`. `cmd_uninstall` removes it. The
server reads it per tick (§8). **Every capability refusal lives in the dispatcher** (`dispatchNode`, §10) — no
`detach` → `{ok:false, why:'no-detach-cap'}`, auto-driven and no `update-gate` → `'no-update-gate'`, a rollback
request and no `rollback` → `'no-rollback-cap'`, and **for a node reached over the agent link only**, `agentOps`
without `update` → `'agent-predates-update-op'` (the server-role row, `agentOps NULL`, is spawned locally and
never checked for it) — and the routes surface the dispatcher's refusal as their `409`. A version number never
stands in for a word here, and a word is self-reported (decision 13).

### Pins

Resolver table: pinned/unpinned × stable/dev × listed/unlisted × yanked × refused-by-this-node/refused-by-another
× below/at/above floor × floor NULL/current NULL; the comparator against a shell `sort -V` of the same list; a
demoted newest resolves NULL with the at-floor sentence; a rolled-back node resolves NULL with the below-floor
sentence; a pinned tag below the floor resolves NULL, never dispatches. Intent route: `auto ≠ off` refused with
the node list while any node (reachable or not) lacks `update-gate`. Projection: the route's own output fed through
`ccd-update-sync`'s real renderer (the `pool-accounts-route.test.ts` cross-side shape, `server.ts:2685-2688`) —
seconds stay seconds; the three `desired*` lines agree with the resolver; a document with no `end` → `malformed`; a
`lease` in the past → `stale`. Reader: fleet + timer unit absent → the `following stable` sentence; fleet + timer
unit present + file absent → `unreadable` and its remedy; `server`/`both` + file absent → `unreadable` and the
restart remedy; `darwin` → the macOS sentence; `--channel dev` with no projection → the refusal naming `--to`;
`--channel dev` with a projection → the `desired-dev` line reaches `--to`. `_inst_caps`: the words present after
install, `os` on line 1, the file gone after uninstall; a W1 fixture writes three words and a W4 fixture seven.
Floor: written by `_inst_installed`, never lowered by a restore fixture; a fixture `SHA256SUMS` under
`latest/download` naming a version below the floor is refused before `_upd_backup` with NO `--to` on the argv; the
same with `--to` refused; `--downgrade` proceeds.

## 10. Convergence

**Trigger.** After every inventory sweep, every intent write **and every request write**,
`server/src/update/dispatch.ts` runs the resolver, then the dispatcher. A node is **eligible** when its
`updateState` is settled, it is not superseded, it is reachable, and EITHER a request is outstanding
(`requestedTag` set — an operator's tap, §12) OR `auto` permits and `desiredTag` is set. For an eligible node
`dispatchNode` checks, in one transaction: the capability set (§9) for the request kind; the **direction** — an
`update` (requested or automatic) must be strictly newer than `currentVersion` by the comparator, **and a node
with `currentVersion NULL` (unversioned) is never "not newer": any eligible release moves it**, with
`updateDetail: 'unversioned box — any eligible release is newer'`; a `rollback` must be a `releases` row (yanked
permitted — rolling back to a yanked release is the point) that this node has not refused; and the lease. It
dispatches **at most one node at a time fleet-wide, fleet-role nodes before server-role nodes** (the standing
order: the server reads what the fleet host's hook writes; the agent caches `ccd caps` at boot), and **continues
down the eligible list on each following sweep until every request is cleared** — decision 7. A `failed` or
`reverted` row **halts further dispatch** until `POST /api/updates/ack` returns it to `idle` — `ccrc rollout`'s
stop-on-first-failure (`ccd/ccrc:11781-11803`), as a row — with one exception, below: a provenance refusal is a
verdict on the release, not a fault of the node, and does not halt.

**Dispatch to a fleet node — the `update` op.** One new member of the existing `req` envelope, not a new top-level
frame: `{t:'req', id, op:'update', tag: string, kind?: 'update'|'rollback'}` → `ResOk {accepted: true}` | `ResErr
{err}`. It rides `FleetClient.request` (`client.ts:176-209`: id correlation, 15 s default timeout, `disconnected`
rejection on drop) and needs exactly what `agent/src/server.ts` demands of every op: a case in `validateReq`
(`:461-523`, the shape gate that stands between untrusted JSON and any syscall), a case in `handleReq`
(`:310-432`), a member of the `AgentReq` union (`shared/agent-protocol.ts:278`, which is what makes the server's
`request()` type-check end-to-end). `validateReq`'s new case answers **`bad-tag`** for a tag that fails
`isReleaseTag` and `bad-kind` for an unknown kind, so that `bad-request` from an `update` op can mean exactly one
thing: **the agent predates the op** — measured, `agent/src/server.ts:775-783` answers `ResErr 'bad-request'` to any
op `validateReq` does not know, at once, never a timeout (`client.ts:210-213` already says so). The handler
refuses when `~/.ccrc/update.json` says an update is in flight (`ResErr 'busy'`) and spawns
`$HOME/.local/bin/ccrc <update --to <tag> | rollback --to <tag>> --detach --from pwa` — the absolute shim path,
**two argv templates and `tag` the only variable token in either** — from the op handler, never through
`isExecAllowed`/the exec op. `EXEC_COMMANDS` and `FORBIDDEN_COMMANDS` are untouched; the whitelist pin tests gain a
case that the `update` op reaches no exec path.

**The agent advertises the op.** `AgentReady` gains `ops?: string[]` (`['update']` from W4's agent), one reader in
`onReady`, absence permits; §8 stores it as `agentOps`; the dispatcher never sends the op to a link-reached node
whose `agentOps` lack `update` (`'agent-predates-update-op'`, a settled, NON-halting refusal shown in
`updateDetail`). A `bad-request` from a node that DID advertise it is `failed: 'agent rejected the update op'` —
distinct from the skew case, distinct from `bad-tag`, and it halts, because it is a bug.

**The server node** is spawned locally — the same absolute argv through its `Runner` (`exec.ts:58-69`, plain
`execFile` — fine, because the child returns immediately and the detached grandchild is the one that lives) —
and `dispatchNode` checks `detach` and the halt predicate for it, never `agentOps` (decision 11: NULL there means
no agent by construction).

**`--detach`.** `cmd_update --detach` (and `cmd_rollback --detach`) re-execs itself through `_svc_run_detached`
(`ccd/ccrc:1016-1028`) — `systemd-run --user --collect --quiet "$HOME/.local/bin/ccrc" update --to <tag> --from
<who>` — writes `update.json {phase: 'queued'}` and returns 0 at once. **The re-exec happens BEFORE the lock is
taken** (below), so the detached run inherits no descriptor. The detached run is in its own cgroup, so
`_inst_enable`'s `systemctl --user restart ccrc.service` / `ccrc-agent.service` (`:10377-10378`, a full restart, no
`KillMode`) does not kill it. **This is the ONLY idiom in the tree proven to survive a unit restart**
(`ccd/ccd:15589-15591`); the Darwin `nohup` arm's own comment promises less (`:1012-1015`), so `--detach` refuses on
Darwin with `--detach is Linux-only (decision 17)` and the `detach` capability is not written there.

**Re-entrancy — the lock, and who may skip it.** `cmd_update` takes `flock` on `~/.ccrc/update.lock` (`exec
{fd}<>`) after the `--detach` re-exec point and after argument parsing (measured: no lock exists today,
`ccd/ccrc:11069-11222`); a second run says `update: another update holds ~/.ccrc/update.lock (pid N, target vX)`
and exits 1. **A bash lock fd is inherited by every child and pins the lock until the LAST inheritor exits**
(measured 2026-09-13, the D-2605 lock design). So §11's restore arm 2 runs as a **synchronous, reaped, direct
child** of the locked run (`bash "$BOX_TREE_DIR/ccd/ccrc" update --to <previous> --no-gate --from restore`), which
inherits the descriptor. **The child skips acquisition only on a measurement, never on the env alone**: it skips
iff `CCRC_UPDATE_LOCK_HELD` equals its own `$PPID` AND a fresh non-blocking `flock -n` on `~/.ccrc/update.lock` in a
subshell FAILS — flock conflicts are per open file description, so a successful `flock -n` from the child proves
nobody holds the lock and the run is refused whatever the env says (no `/dev/fd … -ef` identity test: `-ef` on
`/dev/fd/N` is false on macOS and `cmd_update` runs there). Any other combination acquires normally. A
third-party `ccrc update` during a restore is still refused. `cmd_rollback --detach` takes the lock itself, so a
rollback while an update is in flight is refused with the same sentence. The lock fd is closed (`exec {fd}>&-`)
before `_upd_sweep`'s `try-restart` and before any spawn that could outlive the run.

**The node reports; the server measures.** `cmd_update` writes `~/.ccrc/update.json` by temp-and-rename at each
phase boundary — `{target, phase: UpdatePhase, startedAt, updatedAt, detail, from}` — and §8's sweep reads it into
the report columns and derives the lease state by the table there. **No progress frame exists**: progress is a
file, so it survives the server restart, the agent restart and the WS drop, and it is the same for a CLI-driven
update as for a PWA-driven one. **`cmd_update` writes `~/.ccrc/previous` (tag and sha of what is running) just
before the staged install — except when `--from restore|rollback|watchdog`**, because a restore is a return to a
known-good tag, not a new baseline; without that exception arm 2 would record the FAILED tag as `previous` and the
next bare `ccrc rollback` would roll the box forward onto the release that just reverted.

**Result by re-measurement, never by the reply.** `accepted` means a unit was queued. The row reaches `idle`
only when a sweep measures `currentSha == installed marker` at the target version — the agreement `_upd_converged`
already demands (`ccd/ccrc:11293-11314`) — and only then does `settleNode` clear the request. The `ready` frame
after the agent's own restart triggers that sweep immediately.

**A refusal is an answer, not silence — and it does not consume the request.** `ResErr`, a `disconnected`
rejection or a request timeout releases the lease in the same turn through `releaseLease`, which leaves the request
columns standing: `busy` → `idle` with the detail (another actor is updating; re-measured next sweep, the request
re-eligible); `bad-request` from an advertising agent, `bad-tag`, `bad-kind` → `failed` (halting — a server bug);
`disconnected`/timeout → `idle` with the detail (the node dropped; **re-eligible when it returns, because the
request is still there**). Only `settleNode` — convergence — and `ack` clear a request. The lease never waits for
the deadline on a refusal.

**Offline nodes.** Intent and requests are rows; a `reachable = 0` node is skipped by dispatch and picked up by the
first sweep after its `ready`, where the dispatcher re-checks capabilities, direction and the floor. Nothing is
queued, nothing retries; the row is the queue.

**The lease and the deadline.** A busy `nodes` row is the lease; `dispatchNode` acquires it in one `UPDATE …
WHERE` under `tx` (`db.ts:228-257`, `BEGIN IMMEDIATE`, synchronous), so two sweeps cannot dispatch two nodes. A busy
row is set `failed: deadline` (via `releaseLease`) when `CCRC_UPDATE_DEADLINE_MS` (default 15 min) has passed
since the later of `updateStartedAt` (written by the dispatcher on acquire) and `reportedUpdatedAt` — so a node
that never wrote the file is bounded too. **On the server node the deadline sweep runs inside the process being
restarted**, which is why §11 adds a node-local watchdog for that role.

**Provenance verdicts do not halt.** `failed` with a `provenance:` detail writes this node's refusal (§8), returns
the node to `idle` on the next sweep, and the resolver moves on to the next release eligible FOR THIS NODE; other
nodes' eligibility is untouched (decision 16); the release's row shows who refused it and when; `ack` clears the
refusal.

### Pins

Op: a tag failing `isReleaseTag` → `bad-tag`, nothing spawned; an unknown kind → `bad-kind`; in flight → `busy`;
the two spawn argvs are exactly `$HOME/.local/bin/ccrc update --to <tag> --detach --from pwa` and
`$HOME/.local/bin/ccrc rollback --to <tag> --detach --from pwa` with `tag` the only variable token; the op never
reaches `isExecAllowed`; a `bad-request` from an older agent releases the lease `idle` with the skew detail and
the row is not re-dispatched while `agentOps` lack `update`; the server row is never refused for `agentOps`.
`--detach`: the re-exec goes through `_svc_run_detached` with the absolute path, before the lock, and the parent
returns 0 within the harness timeout; on Darwin it refuses. Lock: a second run exits 1 naming the pid; the real
restore child (env marker = its `$PPID`, lock held by the parent) runs with no second acquire; a fixture that
exports the marker with NO holder is REFUSED; a third-party run during a restore is refused; the fd is closed
before the sweep (a `systemctl` stub that lingers does not pin the lock). `previous`: written before the staged
install; NOT rewritten by a `--from restore` child (after a successful arm-2 restore, a bare `ccrc rollback` still
targets the pre-update tag). Dispatch: two requested nodes → one dispatch per sweep, fleet-role first, the SECOND
dispatched on the next sweep after the first settles with `auto = off`; a request write triggers a dispatch in the
same turn; a `disconnected` during dispatch leaves `requestedTag` standing and the node is dispatched on the sweep
after its `ready`; a `failed` row halts every dispatch until `ack`; a provenance refusal does not halt and leaves a
second node's eligibility intact; unreachable → skipped; deadline from `updateStartedAt` with no `update.json` ever
written → `failed: deadline`; `accepted` alone never settles the row; `ResErr` releases in the same turn; an
auto-driven dispatch to a capless node is refused in the dispatcher with `auto` set on the row; an `update`
(requested OR automatic) for a tag not newer than current is refused; an unversioned node accepts any eligible
tag. `update.json` is written at every phase (the test enumerates `UpdatePhase`) by rename.

## 11. Safety

**Health gate (W4), in `cmd_update` itself.** After the staged install returns (`ccd/ccrc:11190-11211` is where
`inst_rc` is branched today), and before `_upd_sweep`, the detached run — alive, §10 — waits up to
`CCRC_UPDATE_HEALTH_S` (default 90) for the role's signal, **per OS**: **server, Linux**: `systemctl --user
is-active ccrc.service` and `/health` on loopback answers the staged `version`; **server, Darwin**:
`_ccrc_job_stayed_up` (the two-sample pid check `_inst_enable_darwin` already uses, `:10109-10131`) and the same
`/health`; **fleet, Linux**: `systemctl --user is-active ccrc-agent.service` plus `_ccrc_job_stayed_up` (the
`ready` that follows is measured by the server, not locally); **fleet, Darwin**: `_ccrc_job_stayed_up`. Then
`cmd_doctor` runs as today. **Two failures, two exit codes, because they have two remedies**: a doctor FAIL with
the unit up is exit **3** — D-3114's "moved, unhealthy", a warning about the box, no revert; a dead unit or a wrong
`/health` version is exit **4**, new — "reverted", and `_upd_restore` runs first. `cmd_rollout` (`:11781-11803`)
relays 3 and continues; it stops on 4 like any other non-zero.

**A spine death after the tree moved is a failed update, not an exit 1.** Today the `installed`-absent arm of
`cmd_update` is `_ccrc_die` (`:11207`, `exit 1`) — but `_inst_enable` restarts the unit onto the new tree BEFORE
`_inst_skills` runs and long before `_inst_installed` (the spine's last step, `:9106-9123`), so a death in
`_inst_skills` leaves a box that MOVED, is running new code, and has no marker. The staged `ccrc install` writes
`~/.ccrc/install-step` (the spine step it is entering, by `_inst_atomic`) so `cmd_update` can tell, on a non-zero
`inst_rc` with no marker, whether the death was **before `_inst_tree`** (nothing replaced: `update.json failed:
'spine died at <step>'`, exit 1, no restore — as today) or **at or after it** (the tree is replaced: `update.json
failed: 'spine died at <step>'`, then the health gate runs anyway — the unit may well answer on the new version —
and a failed gate runs `_upd_restore` and exits 4). `_inst_installed` removes `install-step`.

**`_upd_restore`, three arms in order**, chosen by what the node has:

1. **W5 present** (a kept version directory for the previous tag): flip the symlink back, restart the unit, run the
   gate once more. No download.
2. **The previous tag is known** (`~/.ccrc/previous`): a synchronous child `ccrc update --to <previous> --no-gate
   --from restore` (under the parent's lock, §10; it does not rewrite `previous`), a re-install of the release
   that was running. It needs egress and a few MB; it does not need the new tree to work, only `curl`, `tar` and
   `node`. **It passes `--allow-unsigned` only when the previous install's marker already read `unsigned` on line
   2** — the node was already running unverified code and restoring it changes nothing about its provenance; a
   previously VERIFIED node whose previous release has no bundle (a release older than W1) is NOT silently
   unsigned: arm 2 refuses, writes `update.json reverted: 'arm2-refused: <previous> ships no bundle — run ccrc
   update --to <previous> --allow-unsigned by hand'`, and falls to arm 3. **`coord.db` is never restored**:
   `openCoordDb` opens a database whose `user_version` is above its own `COORD_SCHEMA_VERSION` read-as-is with a
   warning (`db.ts:176-181`, "a rollback may only refuse to migrate, never to read"), so an older server reads a
   newer db.
3. **Neither** (an unversioned `deploy.sh` node, or arm 2 refused): copy `_upd_backup`'s set back — the three
   dists, the bins, the units — restart, and print that the tree is MIXED (new `shared/`, `ccd/`, `node_modules`
   under old dists) and that `deploy.sh` is the remedy. Best effort, said so.

`update.json` ends `reverted: <which arm>: <reason>`; the row shows it; the fleet halts (§10). **The automatic
restore runs BEFORE `_upd_sweep` ever fired in that run**, so the live `claude-session@*` supervisors were never
moved off their prior in-memory `ccd` and need no sweep.

**`ccrc rollback [--to <tag>] [--detach] [--from <who>]`** — a verb, not a recipe (measured: `rollback` occurs in
the tree only inside `_upd_report`'s printed lines, `:11585-11591`). Default target is `~/.ccrc/previous`; `--to`
names a tag and must pass `$SHAPE`. It takes the lock, runs arm 1 or arm 2 above, then the gate, **then
`_upd_sweep`** — because a standalone rollback runs after a PRIOR update's sweep already moved the supervisors onto
the current build, and leaving them on a `ccd` the box no longer has is the thing the sweep exists to prevent.
That sweep inherits `_upd_sweep`'s mandatory per-unit `KillMode=process` preflight and its DEGRADED sentence
verbatim (`:11529-11543`) — the single SAFETY exception (R1) is inherited, never re-argued. From the PWA: `POST
/api/updates/rollback {nodeId, to?}` → `requestNode(kind: 'rollback')` → the `update` op with `kind: 'rollback'` →
`$HOME/.local/bin/ccrc rollback --to <tag> --detach --from pwa`.

**The server-role watchdog — a re-measurement, never a timestamp alone.** §10's deadline is measured by the
server process — the process a server self-update restarts. If the detached run dies mid-install (OOM, a crash),
nothing measures, nothing reverts, and `ccrc.service`'s `Restart=always` restart-loops a half-replaced tree into
systemd's start limit with no actor left. So `_inst_units` installs, on `server` and `both` roles, Linux only,
`ccrc-update-watchdog.{service,timer}` (`OnUnitActiveSec=60s`). The service reads `~/.ccrc/update.json`; when
`phase` is non-terminal and `updatedAt` is older than `CCRC_UPDATE_DEADLINE_MS` it does NOT roll back on that alone
— a hand-run `ccrc update` over a dropped ssh session leaves exactly that file on a box that finished and is
healthy. It **re-measures**: if the stamp's `version` equals the report's `target` and `~/.ccrc/installed` line 1
equals the stamp's sha and the §11 gate's own two probes pass, it rewrites `update.json` to `failed: 'abandoned by
its updater; box measures converged at <version>'` and exits 0 — never a rollback. Only a stale report **with a
failing health probe** runs `$HOME/.local/bin/ccrc rollback --from watchdog`, which takes the lock. **A held lock
has its own bound**: a live holder → exit 0 and the sentence; a holder whose report has not advanced in 2×
`CCRC_UPDATE_DEADLINE_MS` → the watchdog writes `update.json failed: 'watchdog: updater pid <n> wedged holding
~/.ccrc/update.lock since <t>'` so the inventory and the screen show a wedged box instead of silence. Fleet-role
nodes are covered by the server's deadline; the watchdog is the server's own.

**Doctor's `provenance` check** (W4, `ccd/ccrc-doctor-checks`): WARN when `~/.ccrc/installed` line 2 reads
`unsigned` — "this install was made with `--allow-unsigned`; the next `ccrc update` verifies" — never FAIL (it is
a fact about consent, not a fault), and SKIP on a box with no marker.

**Versioned installs (W5).** Layout, as siblings of the tree the way `~/ccrc-backups` already is
(`BOX_BACKUP_ROOT="$HOME/ccrc-backups"`, `:1307`):

```
~/ccrc-versions/v0.0.9/    the tree
~/ccrc-versions/v0.0.8/    kept
~/ccrc -> ~/ccrc-versions/v0.0.9    the symlink every path contract resolves through
```

`_inst_tree` targets `~/ccrc-versions/<tag>/` (`untagged-<sha>` for a source or `deploy.sh` install), then flips:
`ln -sfn <target> ~/ccrc.new && mv -T ~/ccrc.new ~/ccrc` — a rename, atomic. **The one-time migration** from a real
directory: build the versioned tree fully, `mv ~/ccrc ~/ccrc.migrating && ln -s <target> ~/ccrc` — a window of two
syscalls, once per node — and delete `~/ccrc.migrating` only after the gate passes. A crash inside the window
leaves `~/ccrc.migrating` and no `~/ccrc`; the next `ccrc install`/`update` detects that pair and completes the
link before anything else.

**The audit, measured 2026-09-20 — what a symlink satisfies unchanged, and what it does not:**

| Site | Verdict |
|---|---|
| `_inst_shim` / deploy.sh `install_ccrc_shim`: `CCRC_SHIPPED="$HOME/ccrc/ccd/ccrc"`, `exec` (`ccd/ccrc:9721-9725`, `deploy.sh:319`) | satisfied — `exec` resolves through the link; the two copies stay byte-equal (their pin in `ccrc-install.test.ts` is untouched) |
| `CCRC_HERE` from `BASH_SOURCE` with plain `pwd` (`:1098-1100`); `_dr_pkg_candidates` plain `pwd` (`ccrc-doctor-checks:292-295`) | satisfied — symlink-preserving; **adding `-P` to either would break doctor under a symlink** |
| units: `ExecStart=… %h/ccrc/…` (`ccrc.service:19`, `ccrc-agent.service:7`); `claude-session@.service` runs `%h/.local/bin/ccd` (`:21`) | satisfied — `execve` resolves the link; the session unit never touches the tree |
| `_inst_plist_server` bakes `$HOME/ccrc/server/dist/…` into the plist (`:10050-10054`) | satisfied — the path is unchanged; the plist is regenerated by the spine on every install anyway |
| `findPwaRoot` walks up from `import.meta.url` (`server.ts:298-310`); `ccd-usage-sweep`'s `CCRC_TREE` default (`:16-19`); `ccd/ccd` (zero references, measured) | satisfied — relative walk / plain default / none |
| **`_inst_tree`'s rsync into the literal live name** (`:9497-9499`) | **must change** — it would mutate the live version in place; it targets the versioned dir instead |
| **`_inst_tree`'s self-copy guard** (`pwd -P` both sides, `:9444`, `:9479-9487`) | **must change** — it knows "same tree" vs "rsync over `~/ccrc`", not "source is version A, dest is version B" |
| **`cmd_uninstall`'s `rm -rf -- "$BOX_TREE_DIR"`** (`:12299-12301`) | removes only the link — **gains a sweep of `~/ccrc-versions/`** |
| `deploy.sh`'s `rsync … "$BOX":ccrc/` (`:597-599`, `:1157-1159`) | writes THROUGH the link into the live version, exactly what it does to the live tree today; the node shows `unversioned` (`stampRead ok, currentVersion NULL`), as the rollout design already said of it. Untouched by decision. |
| agent whitelist `canonicalize()` realpaths the existing prefix (`agent/src/whitelist.ts:17-38`) | its prefixes are `home`/`projectsRoot`, not the tree — a flip does not move them; **W5's audit task confirms where they are canonicalised** (open) |
| Node resolves `import.meta.url` to the real path | no code compares it to `~/ccrc` today (measured); a rule for W5: none may |

GC: `ccrc versions` lists; keep the pointed-at version, the previous, and any tag named in an intent's `pinnedTag`
or a node's `requestedTag`; prune the rest, never the pointed-at, and never a version whose tree any running
`ccrc.service`/`ccrc-agent.service` `ExecStart` resolves to at that moment (`systemctl --user show -p ExecStart`
through `readlink -f`). Rollback after W5 is arm 1: a flip and a restart, no download.

**Rehearsal (W5's exit criterion).** The update harness pointed at the real newest release via
`CCRC_RELEASE_BASE_URL`, driven through the migration, a crash inside the window, one flip and one rollback in a
fixture HOME with stub `systemctl`; then the live fleet node, then the live server node, each with `rollout
--check` before and after.

### Pins

Gate: `/health` answering the OLD version past the deadline → `_upd_restore` runs, exit 4, `update.json` says
`reverted`; a doctor FAIL alone → exit 3, no restore; the Darwin fixture takes the `_ccrc_job_stayed_up` arm and
never calls `systemctl`. Spine death: a fixture `_inst_skills` that exits non-zero → `install-step` names it, the
gate runs, a failing gate restores and exits 4; a fixture death before `_inst_tree` → exit 1, no restore. Restore:
arm 2 spawns the synchronous child with `--no-gate --from restore` and no second lock; arm 2 on a previously
VERIFIED node with no bundle refuses with the by-hand sentence and falls to arm 3; arm 2 on a previously `unsigned`
node passes `--allow-unsigned`; arm 3 copies the backup set and prints MIXED; the automatic restore calls no
`_upd_sweep`. `rollback`: refuses an unknown tag at exit 2; `--to` reaches the detached argv; it ends in `_upd_sweep`
behind the KillMode preflight (a fixture unit with `KillMode=control-group` → DEGRADED, no `try-restart`).
Watchdog: installed on `server`/`both` Linux only; a stale non-terminal `update.json` on a box that measures
CONVERGED → rewritten `failed: abandoned…converged`, exit 0, NO rollback; the same with a failing health probe →
`rollback --from watchdog`; a live holder → exit 0 and the sentence; a holder stale past 2× the deadline → the
wedged sentence in `update.json`. Doctor `provenance`: WARN on `unsigned`, SKIP with no marker, never FAIL. W5:
the flip is `mv -T` (argv pinned); the migration never removes `~/ccrc.migrating` before the gate; a
`~/ccrc.migrating` with no `~/ccrc` is completed first on the next run; GC never removes the pointed-at, a pinned, a
requested or a running version; a test walks the audit table's satisfied rows through a fixture symlink; the two
shim heredocs stay byte-equal.

## 12. Wire and routes

`shared/api.ts`, additive, no `FLEET_PROTO` bump, one reader per field, absence permits:

```ts
export interface ReleaseWire { tag; version; channel: UpdateChannel; publishedAt; commitSha: string|null;
  bundleListed: boolean; yanked: boolean;
  refused: { by: string; at: number }[];            // display roll-up of node_release_refusals — never a predicate
  notes: string|null }
export interface NodeWire { nodeId; role; label; os; current: BuildInfo|null; stampRead; installState; provenance;
  caps: string[]; agentOps: string[]|null; highestVersion: string|null; previousVersion: string|null;
  measuredAt: number|null; reachable: boolean; unreachableSince: number|null;
  channel: UpdateChannel|null; desiredTag: string|null; resolveDetail: string|null;
  request: { tag: string; kind: RequestKind; at: number }|null;
  report: { phase: UpdatePhase; target: string|null; startedAt: number|null; updatedAt: number|null; detail: string|null }|null;
  update: { state: UpdateState; target: string|null; startedAt: number|null; detail: string|null } }
export interface UpdateIntentWire { scope; channel: UpdateChannel|null; pinnedTag: string|null; auto: AutoMode;
  notify: NotifyMode; setAt; setBy }
export interface CatalogueState { lastOkAt: number|null; lastError: { at: number; reason: string }|null }
export interface UpdatesView { catalogue: CatalogueState; releases: ReleaseWire[]; nodes: NodeWire[];
  intent: UpdateIntentWire[] }
```

| Route | Body | Answer | Credential | Wave |
|---|---|---|---|---|
| `GET /api/updates` | — | `UpdatesView` | session | W2 |
| `POST /api/updates/intent` | `{scope, channel?, pinnedTag?, auto?, notify?}` | the row; `400 bad-tag`; `409 auto-needs-rollback-gate` | session | W2 |
| `POST /api/updates/refresh` | — | `CatalogueState`; `429` inside the minute | session | W2 |
| `POST /api/updates/ack` | `{nodeId}` | the row, back to `idle`, request cleared, this node's refusals cleared | session | W2 |
| `POST /api/updates/apply` | `{nodeId} \| {all: true}`, `tag?` | `202 {requested: nodeId[]}`; `400 bad-tag`; for a single node `409 unknown-tag` / `not-newer` / `halted` / `busy` / `no-detach-cap` / `agent-predates-update-op` | session | W4 |
| `POST /api/updates/rollback` | `{nodeId, to?}` | `202 {requested}`; `400 bad-tag`; `409 unknown-tag` / `no-previous` / `refused-by-node` / `halted` / `busy` / `no-rollback-cap` | session | W4 |
| `GET /api/updates/intent/:nodeId` | — | the §9 document | session, else box token | W2 |

**`apply` names a tag** — the approved version picker. With `tag`, the route checks `isReleaseTag` (`400`), that
the tag is a `releases` row that is listed, not yanked and not refused by this node (`409 unknown-tag`), and the
direction (`409 not-newer`; an unversioned node is never "not newer" — §10). Without `tag` it requests each node's
resolved `desiredTag`. It writes `requestedTag/requestedKind/requestedAt` on each named node (`{all: true}` =
every live, non-superseded node). **For a single named node the route evaluates the dispatcher's own predicates
synchronously** against the already-measured columns — capabilities, halt, busy — and answers the `409` the
dispatcher would; the request write then triggers a dispatch in the same turn (§10). `{all: true}` always answers
`202` and reports per-node refusals through `updateDetail` as the dispatcher reaches each. The reply is a request,
not a dispatch, and the inventory shows it as `request: {tag, kind, at}` until convergence or `ack` clears it.

**`rollback`'s `to`**: optional, filled from the node's measured `previousVersion` when omitted, `409 no-previous`
when that is NULL; it must be a `releases` row (`409 unknown-tag`; yanked permitted) that this node has not refused
(`409 refused-by-node`), so a forged or mistyped body cannot send a node fetching an arbitrary tag.

**No write route on this surface accepts the box token** (decision 15). `POST /api/updates/intent`, `apply`,
`rollback`, `ack`, `refresh` never call `requireMailToken`/`checkMailToken` (the two regexes both census scanners
key on, `box-token-census.test.ts:75-82`). The one dual-credential read is the projection, in the shape of `GET
/api/pools/epoch` (`server.ts:2690-2701`; listed in `gate.ts:226`'s session-first-box-token-fallback set), because
its caller is a timer on a fleet node holding the box token and no session — it is added to that list with its
reason.

**Gating, measured.** `installGate` is one `onRequest` hook fronting every route (`server.ts:483-486`,
`auth/gate.ts:7-14`); a route is gated because it exists, and only a name in the `EXEMPT` map (`gate.ts:195`)
escapes. So the six session routes need **no gate code at all** — they must simply not be named in `EXEMPT`;
armed, they sit behind the passkey, and being non-GET they get the CSRF origin check for free (`needsOriginCheck`,
`gate.ts:743-747`), exactly as `/api/fleet/reboot` does. **Unarmed, they are open** — `gate.ts:810-815` says it in
its own words: "With `CCRC_AUTH` off there is no credential to forge with — every route and every socket is
already open to anyone who can reach the port."

**The unarmed-exposure doctor check** (W4, `ccd/ccrc-doctor-checks`) measures the two inputs the way the shipped
topology actually sets them, because the obvious pair is wrong twice over: `ccrc expose` writes `CCRC_AUTH=on` into
`$CCRC_EXPOSURE_FILE` (`~/.ccrc/exposure.env`, `ccd/ccrc:4604`, the unit's SECOND `EnvironmentFile`), never into
`~/.ccrc/ccrc.env`, and doctor's existing `_check_auth` reads `ccrc.env` alone by design
(`ccrc-doctor-checks:1227-1233`); and a correctly exposed box keeps `CCRC_HOST` at its loopback default
(`config.ts:317`) because Caddy on 443 proxies `127.0.0.1:7788`. So: **armed** = `CCRC_AUTH=on` read with the
server's own precedence, `ccrc.env` then `$CCRC_EXPOSURE_FILE`, exposure winning; **reachable** = `CCRC_HOST`
non-loopback OR any exposure artifact present — `$CCRC_EXPOSURE_FILE`, `$CCRC_CADDYFILE`, or the `ccrc-ddns` unit
installed. FAIL iff reachable and not armed, naming `POST /api/updates/apply`; §13's screen shows the same
sentence as a red banner when `/health` reports the gate off and the request's origin is not loopback.

**The census.** The routes are registered from `server/src/update/routes.ts`, not `coord/routes.ts`, so two
scanners cannot see them by construction: `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest reads
`coord/routes.ts` alone (`:165`, `:195-214`), and `box-token-census.test.ts`'s `ALL_LANES` is built from
`coord/routes.ts` and `server.ts` only (`:66-67`, `:97-98`) — so a pin that these routes are "absent from every
box-token lane" would be a measured zero over an empty set. W2 therefore (a) adds `UPDATE_SRC =
read('server/src/update/routes.ts')` and folds `lanesIn(UPDATE_SRC)` into `ALL_LANES`, so a `requireMailToken`
added to that file IS seen; (b) keeps a hand-kept `UPDATE_DOORS` literal beside `KICKOFF` (`:121-128`, with its
"cannot be harvested" comment) only for the session-only NAMES; (c) names the six in CLAUDE.md's box-token bullet,
which the census checks in both directions (`:499-573`); (d) updates README's derived lane-count numeral
(`:315-326`, `expectNumerals(…, [word(ALL_LANES.length), …])`); and (e) adds `/api/updates/intent/:nodeId` to
README's auth paragraph under "The session gate", which the census derives from `gate.ts`'s
`EXEMPT-BUT-AUTHENTICATED` entries and requires the prose to name (`:286-313`). All five in one PR.

### Pins

Route tests per row, including `apply` with `tag` older than current → `409 not-newer`, `apply` on an unversioned
node with any eligible tag → `202`, a `tag` failing the shape → `400`, a single-node `apply` on a halted fleet →
`409 halted` in the same request, `{all:true}` on the same fleet → `202`; `rollback` without `to` on a node with
`previousVersion NULL` → `409 no-previous`, with a tag no `releases` row names → `409 unknown-tag`, with a yanked
row → `202`, with a tag this node refused → `409 refused-by-node`. `box-token-census`: `lanesIn(UPDATE_SRC)` in
`ALL_LANES`; `UPDATE_DOORS` named in the bullet and absent from every lane (now a real set); a `requireMailToken`
planted in `update/routes.ts` reds. The projection route: 401 without either credential when armed; the box token
alone suffices; `POST /api/updates/intent` with the box token alone → 401 when armed. `GET /api/updates` in local
mode answers one node (the box itself) — never an empty list. Doctor, four quadrants: armed via `exposure.env` +
reachable → PASS; `ccrc.env` armed + loopback → PASS; unarmed + `CCRC_HOST=0.0.0.0` → FAIL; unarmed + loopback +
a `Caddyfile` present ("expose ran, `exposure.env` deleted") → FAIL naming the route.

## 13. PWA

**`/settings`** — `pwa/src/screens/SettingsScreen.tsx`, in the idiom `app.tsx` uses for every secondary route
(`:64-69` a regex boolean, `:116` the `data-view` chain — **a route left out of that chain is hidden behind the
fleet sidebar on a phone**, pinned per route by `app.test.tsx:72-80`, `:108-113`, `:117-122` — and a branch in the
`.shell-detail` ternary, `:138-146`). It imports the shared `../fleet/fleet.css` like every screen but
`SessionScreen` (measured), with `.settings-screen/-head/-back/-title` classes appended there (`.accounts-*`'s
shape, `fleet.css:2203-2223`). It is reached from a **gear door** in `.fleet-head-right`
(`FleetScreen.tsx:534-569`), the `.accounts-door` pattern — glyph plus a short text label, for the discoverability
argument the comment at `:536-557` makes. The D-161 pane reset (`app.tsx:105-111`) applies to it for free and it
adds no scroll logic of its own. Two sections — the approved scope, no more:

1. **Updates.** The channel selector — two radio rows, one sentence each: *Stable — releases promoted after they've
   baked* / *Dev — every merge, minutes after it lands*. The auto-install choice, disabled with the node list when
   any node lacks `update-gate`. *Check now.* The catalogue line — three renderings, and the amber one is never the
   calm one: `checked 4 min ago` / **`couldn't reach GitHub since 14:02 — rate limited`** / `never checked`. The
   release list: version · date · `dev`/`stable` badge · **`verified` only when some node's measured `provenance`
   is `verified` at that tag — never from `bundleListed`, which renders as `bundle listed`** · `refused by 1 of 2
   nodes` from `refused[]` · notes, **rendered as plain text** (no markdown, no HTML, no link auto-detection; a
   `<pre>`-like block with wrapping) · **Install** (or **Roll back** when every live node runs a newer one), each
   opening a confirm sheet naming the nodes it moves, in order, and sending `apply {tag}` or `rollback {to}` by
   direction. The node inventory: label · role · os · current (amber when unversioned, unverified, incomplete or
   `stampRead ≠ ok`) · desired (or `resolveDetail` when `desiredTag` or `channel` is null — no badge, no arrow) ·
   request · state with the report's `phase` and `detail` · **Update** / **Roll back** / **Ack**. A Darwin row
   reads `macOS: not centrally managed` in place of its desired. **In W3 the Install / Roll back / Update /
   Update all controls render DISABLED with `lands with the next release (W4)`**, because the routes they call are
   W4's; W3's face is the banner, the channel switch, the auto/notify settings, the release list and the
   inventory, and the controls' pins move to W4 (§15).
2. **Notifications.** The same push toggle `NotificationBell` drives (`NotificationBell.tsx:29-47`'s four
   outcomes, reused), plus *Release notifications: on my channel / stable only / off* — `update_intent['*'].notify`,
   the `NotifyMode` column W2 shipped.

**Notification.** `UpdateBanner` on `FleetScreen` beside `FleetHostBanner` (`FleetScreen.tsx:571-575`), the
banner idiom (`FleetHostBanner.tsx:46-136`: injected prop, `null` when silent, `role="status"`, an action button
behind `QuickConfirm`): *v0.0.9 is out on stable — fleet and server are on v0.0.7.* **Update all** (W4) / *See
what's new*. `BuildLine` gains an amber affix: `fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9`. **Web Push, once
per tag, across restarts**: `pushOne` (`watch.ts:1425-1502`) has NO tag-based suppression — the tag is a tray
collapse key, and `push.notify` fires on every call — so the dedup is `releases.notifiedAt`, written in the same
transaction as the send decision and **persisted**, unlike `mergedNotified`'s in-memory `Set` (`:441`), which its
own comment says forgets on restart. A fleet-level push has no session: it bypasses the presence gate (keyed on
`e.sessionId`, `:1458`) by design, carries `tag: 'release-<tag>'`, and `PushPayload` gains an additive `url`
(`push.ts:15-24`) that `push-sw.js`'s `notificationclick` (`:100-113`) prefers over the `/s/<sid>` default, so the
tap lands on `/settings`. `notify` decides which tags push: `channel` = the newest eligible on the fleet's resolved
channel; `stable` = stable promotions only; `off` = none. The copy is pinned in `push-copy.test.ts` the way every
lane is (`:669-737`): a new `it()` reading the exact title, body and tag off `sent[]`.

**Unreachable is not current** (§7), pinned at each of the three surfaces: none renders "up to date" while
`catalogue.lastOkAt` is null, and none renders a node's arrow while its `measuredAt` is null or its `channel` is
null.

**Not this document's problem:** the PWA bundle's own update (§1, last row); a theme/appearance control (§17).

### Pins

`app.test.tsx`: `/settings` → heading, `data-view = 'session'`. `settings-screen.test.tsx` (the
`accounts-screen.test.tsx` idiom: `vi.spyOn(api, 'updates')`, `afterEach` reset, `:1-17`, `:47-50`): the three
catalogue renderings; `auto` disabled with the node list; the `verified` badge appears only with a node at
`provenance: verified` on that tag, never from `bundleListed`; `refused by 1 of 2 nodes` from `refused[]`; notes
containing `<b>` and a URL render as literal text; a node with `stampRead: 'unreadable'` renders amber and no
arrow; a node with `channel: null` renders `resolveDetail` and no badge; a Darwin row renders the macOS sentence;
the unarmed-non-loopback banner; in W3 the four controls are disabled with the sentence. W4 adds: Install's sheet
names nodes fleet-then-server and sends `apply {tag}`; a row where every node is newer sends `rollback {to}`.
`update-banner.test.tsx`: renders on newer, not on equal, not on `lastOkAt: null`, not on an unmeasured node.
Push: a second sweep after `notifiedAt` sends nothing; a restarted fixture sends nothing; `notify: 'stable'` skips a
dev tag; the payload's `url` is `/settings`; `push-sw` opens `url` when present.

## 14. What this supersedes, keeps, and leaves at the seam

- **`FleetHealth.builds: {own, fleet}`** — W2 makes it a derived view of `nodes` (server-role row → `own`, the first
  live fleet-role row → `fleet`, each a full `BuildInfo` from the five `current*` columns), so an older PWA keeps
  its answer; W3 moves `FleetHostBanner`'s skewed arm and `BuildLine` onto `NodeWire[]`; the field is then unread
  by any shipped reader and retires under wire discipline (absence permits; no `FLEET_PROTO` bump).
  `buildAgreement` keeps its three words and its sha+dirty inputs and takes them from the inventory.
- **`ccrc rollout`** (W4) stays as the ssh path and gains `--channel`, which reads each node's resolved `desired`
  from the server and passes `--to` to the box; its `--check` parse tolerates an absent `caps=` field from an
  older box (D-3106's lesson). `ccrc update --check`'s first line gains `caps=<words>` (W4).
- **`deploy.sh`** untouched; still the fallback; a `deploy.sh` node shows unversioned and incomplete exactly as the
  rollout design said it would.
- **CLI parity, with one deliberate asymmetry.** `ccrc update [--to|--channel|--detach|--allow-unsigned|--downgrade]`,
  `ccrc rollback`, `ccrc versions` (W5). **`ccrc channel` (W4) is READ-ONLY**: it prints the projection's
  `channel` and `desired*` lines; `ccrc channel dev` refuses with `set the channel from the console` — a node never
  writes intent, because the only credential a node holds is the box token and decision 15 forbids it.
- **Multi-tenancy, the identity seam.** When tenants arrive: `update_intent.scope` grows a tenant prefix or a
  `tenant` column; `nodes` gains `tenant`; the resolver filters by it; the routes take a tenant from the session.
  Nothing in this programme's shape has to be undone — that is the whole reason for rows over a pair.
- **Blast radius, the second seam — documented, declined for now.** §10's two invariants ("one node at a time"
  and "a failure halts dispatch") are fleet-wide. In an N-node, multi-tenant fleet they become per-group: a
  `nodes.group` column, `CCRC_UPDATE_CONCURRENCY` per group, a halt scoped to its group, server-role nodes always
  their own group and always last. The reviewer who raised it was right about the shape and this programme still
  builds one group, because two nodes need no groups and a column with one value is the speculation decision 10
  forbids. The seam is named so it is not rediscovered.

## 15. Waves

| Wave | Delivers | Files (new / changed) | Exit criterion |
|---|---|---|---|
| **W1** release side + provenance | §4, §5, `node-id`, `ccrc-caps` (`verify`, `node-id`, `floor`), `floor`, tag binding, the floor check on every path (`--downgrade`) | new `deploy/release-stable.sh`, `.github/workflows/release-stable.yml`, `deploy/verify-provenance.mjs`, `server/test/release-stable.test.ts`, `server/test/verify-provenance.test.ts`; changed `deploy/release-main.sh`, both build workflows, `ccd/ccrc` (`_upd_resolve` tag binding + floor check, `_upd_fetch`, `--allow-unsigned`, `--downgrade`, `_inst_caps`, `node-id`, `_inst_installed` (`floor`), marker line 2, `cmd_version`, `cmd_uninstall`), `install.sh`, `ccrc-update.test.ts`, `build-release.test.ts`, `release-main.test.ts`, `install-sh.test.ts`, `ccrc-install.test.ts`, `ccrc-uninstall.test.ts` | the offline-verify spike is measured on both backends and its answer recorded; a release on `main` is a prerelease with a bundle asset; `ccrc update` on a fixture verifies it under both identities and refuses a re-served tarball; `stable` exists and one promotion has run and `isLatest` read back true |
| **W2** control plane + intent, no node moves | §6, §7, §8 (incl. the read allowlist and validation), §9 (resolution; the projection's route and the SERVER-ROLE writer), `GET /api/updates`, `POST intent/refresh/ack`, the derived `builds` | new `server/src/update/{catalogue,inventory,resolve,routes}.ts`, `shared/semver.ts`, tests; changed `coord/schema.ts` (`MIGRATIONS[13]`, every column incl. `notify`), `coord/store.ts`, `shared/api.ts`, `shared/agent-protocol.ts` (`ops`), `agent/src/whitelist.ts` (the exact-basename read set) + `whitelist-structural.test.ts`, `remote/client.ts` (`ops` reader), `watch.ts`, `server.ts`, `fleetstate.ts`, `auth/gate.ts` (the dual-credential list), `single-definition.test.ts` (ring scan over `update/`, writer-group scan), `box-token-census.test.ts` (`UPDATE_SRC`, `UPDATE_DOORS`), the two `COORD_SCHEMA_VERSION` literals, CLAUDE.md's box-token bullet, README (auth paragraph + lane numeral) | `GET /api/updates` on the live fleet answers two nodes with real stamps (`stampRead = ok` on the fleet row), the catalogue, and a `desiredTag` per node; the server node's projection file round-trips through a renderer fixture; switching channel from a `curl` with a session works |
| **W3** settings + notification | §13, with the four move controls disabled | new `pwa/src/screens/SettingsScreen.tsx`, `pwa/src/fleet/UpdateBanner.tsx`, tests; changed `app.tsx`, `FleetScreen.tsx`, `BuildLine.tsx`, `FleetHostBanner.tsx`, `lib/api.ts`, `push.ts`, `watch.ts` (the notifier), `push-sw.js`, `push-copy.test.ts`, `fleet.css`, `coord/store.ts` (`markReleaseNotified`) | the operator sees the banner on the phone within one poll of a merge and switches channel from the screen |
| **W4** convergence + one-tap + gate + watchdog | §9 (`ccd-update-sync` and its six spine sites, the reader in `cmd_update`, dispatcher-side caps, the W4 cap words), §10, §11 (gate, spine-death handling, `_upd_restore` arms 2–3, `cmd_rollback`, the watchdog, doctor `provenance`), `apply`/`rollback` routes and their controls, the unarmed-exposure doctor check, `ccrc channel`, `--check caps=`, `rollout --channel` | new `ccd/ccd-update-sync`, `deploy/systemd/ccd-update-sync.{service,timer}`, `deploy/systemd/ccrc-update-watchdog.{service,timer}`, `server/src/update/dispatch.ts`, tests; changed `ccd/ccrc` (`--detach`, `--from`, `--no-gate`, the lock, `update.json`, `previous` and its `--from` exception, `install-step`, the gate per OS, `_upd_restore`, `cmd_rollback`, `cmd_channel`, `cmd_update --check`, `cmd_rollout`, `_inst_caps` (four words), `_inst_units` (two timer pairs), `_inst_bins` (the puller and both summary echoes), `cmd_uninstall` (bin and unit lists), the wrapper-sweep `case`), `deploy/gen-wrappers.mjs` (`TOOLCHAIN_EXECUTABLES`), `ccd/ccrc-doctor-checks`, `agent/src/server.ts` (the op, `ops` on ready), the whitelist pin tests, `update/routes.ts`, the PWA controls + their pins | one tap moves the live fleet node then the server node and the inventory shows both; a deliberately broken staged tree on the fixture reverts by arm 2; a killed detached updater on a server-role fixture is reverted by the watchdog, and a converged-but-abandoned one is NOT; the fleet node's projection round-trips through the real renderer |
| **W5** versioned installs | §11 (layout, flip, migration + its crash recovery, arm 1, GC, `ccrc versions`, the audit's must-change rows), `_inst_caps` (`versions`) | `ccd/ccrc` (`_inst_tree`, its guard, `_inst_atomic`, `cmd_uninstall`, `cmd_rollback`, `cmd_versions`, `_inst_caps`, `BOX_VERSIONS_ROOT`), tests | the rehearsal (§11) on fixture, then fleet node, then server node |

W1 leads because the channels must exist before the console can read them. W2 ships every table, every intent
route and the notification half's data, so W3 is a face with endpoints under it. W4 is the first wave that moves a
box from the PWA, and the first in which a fleet node has a local projection. W5 is last and separable.
Documentation (CLAUDE.md's Deploy bullet and box-token bullet; README's Update section, auth paragraph and lane
numeral) ships in the wave that changes the rule, line-neutral where `pools-prose.test.ts` holds the count.

## 16. Risks

- **`MIGRATIONS[13]`** is claimed here and re-derived at W2's merge. It carries every column this programme needs.
- **The offline-verify claim is inferred.** W1's spike settles it before anything depends on it; the fallback is
  named with its constraints and its cost is a recorded deviation.
- **W5** restructures the install spine every node runs; the audit above is its first task and the rehearsal its
  last; the two must-change rows are where the work is.
- **The server self-update.** If `--detach` ever fails to escape the cgroup, the update dies with the process that
  spawned it, mid-install; the watchdog (§11) is the actor that reverts it — and only when the box measures
  unhealthy — the deadline names it, and arm 2 is the remedy. The W4 fixture kills the parent after `queued` and
  asserts the grandchild finishes; a second fixture kills the grandchild and asserts the watchdog reverts; a third
  abandons a converged box and asserts the watchdog does not.
- **GitHub egress** is a hard dependency of the *notification* half only; the *install* half is a plain HTTPS
  download that a mirror can serve (`CCRC_RELEASE_BASE_URL`), and the catalogue has its own mirror knob.
- **A `D-N` block** is minted per wave from the allocator; none is written here.

## 17. Out of scope

Retiring `deploy.sh`; per-tenant anything and dispatch groups (§14, two seams); delta/differential updates (the
tarball is a few MB); a custom update server or artifact proxy; gating releases on `ci.yml`; auto-promotion to
`stable` on a timer (promotion is a human merge, decision 3); signing the PWA bundle separately (it is inside the
attested tarball); `KillMode=process` on the two ccrc units (the detach makes it unnecessary and it would change
kill semantics for everything under them); **macOS central management** (decision 17 — the projection timer, the
watchdog and `--detach` have Linux arms; `ccrc update`/`rollback` by hand work on macOS; a launchd arm is a named
follow-on); a theme/appearance control (a separate concern that happens to want the same screen — no plumbing in
this programme); Windows.

## 18. Mutation table

| Guard | Red when |
|---|---|
| `release-main.sh` publishes a prerelease | `--prerelease` is removed from the argv |
| `release-stable.sh` refuses an untagged HEAD | the `--points-at` check is removed (a merge-commit fixture gets an `edit` argv) |
| promotion is idempotent | the `isPrerelease` short-circuit is removed (a stable fixture gets a second `edit`) |
| promotion never builds | a `build-release.sh` invocation is added to `release-stable.sh` |
| promotion is two edits then a read-back | the `--latest` call is folded into the first `edit` |
| both build workflows attest | the attest step or either permission is removed from one |
| the bundle rides the release | the third artifact is removed from `release-main.sh`'s argv |
| the tag is bound before backup, tag to tag | the `UPD_VERSION != "$to"` refusal is removed, or it strips one side (`v0.0.9` vs `0.0.9` refuses every correct release) |
| the extracted version is bound | the `build.json` comparison is removed |
| the verifier asserts the subject name | `--expect-subject` is dropped (a re-served tarball verifies) |
| the identity set is exactly two workflow URIs, on both backends | the check is widened to owner/repo; the `gh` argv loses `--cert-identity` or `--cert-oidc-issuer` (a third-workflow bundle verifies on that backend) |
| verification precedes extraction | the verify call moves below `tar -x` |
| the INSTALLED verifier is used | the argv path becomes `$UPD_TREE/deploy/…` |
| `--allow-unsigned` permits absence only | it is made to permit a failing bundle |
| `--allow-unsigned` is recorded | the marker's second line is not written |
| TOFU is said | the `install.sh` sentence is removed |
| one writer per column group | `upsertNodeMeasurement` names a lease column; a `releases` UPDATE outside `upsertRelease` touches a catalogue column; `resolveDetail` is written outside `resolveNode` (the store scan) |
| vocabularies are declared once | a second `export type UpdateState` appears; a hand-typed SQL tuple appears |
| every `UpdateState` classified once | a state is added to the union and not to busy/settled |
| `unknown` is busy | it is moved to settled (a fixture `unknown` row gets a dispatch) |
| a refusing write never returns void | `dispatchNode` returns `void` |
| the ring scan covers `update/` | the directory is dropped from the scan (a planted `node:sqlite` import stays green) |
| the read allowlist is exact basenames | it becomes a prefix (`~/.ccrc/agent.env` becomes readable) |
| reads refuse a non-regular file | the `lstatMeasured` gate is removed (a symlinked `build.json` is followed) |
| reads are bounded and validated | the 64 KiB cap is removed; a bad `caps` word survives to the wire; an unbounded `detail` reaches the screen |
| a yanked release is kept | the poller deletes instead of marking |
| `bundleListed` is never "verified" | the badge reads the catalogue column |
| notes are capped and plain | the cap is removed; the renderer becomes markdown/HTML |
| errors never move `lastOkAt` | the error branch sets it |
| `refresh` is rate-limited | the minute guard is removed |
| `stampRead` keeps EACCES from unversioned | the inventory folds `unreadable` into `ok` |
| a full `BuildInfo` round-trips | one of the five `current*` columns is dropped (`buildAgreement` loses `dirty`) |
| measurement is a sweep | the sweep is removed and `ready` is the only writer |
| the phase table is applied | a phase maps to a state other than the table's (a `done` with a mismatched stamp reads `idle`) |
| a stale report never moves the lease | the `reportedStartedAt < updateStartedAt` precedence is removed (a previous run's `done` releases a fresh lease) |
| a label row re-keys | the re-key is removed (`GET /api/updates` answers two nodes) |
| a superseded row is invisible | one reader stops filtering `supersededBy` |
| unreachable is written on the sweep it happens | the sweep skips absent connections |
| a provenance failure refuses the release FOR THAT NODE | the write goes to a fleet-wide column; a second node's eligibility changes |
| `ack` clears the node's refusals and its request | either clear is removed |
| the resolver skips unlisted/yanked/refused-by-this-node | one predicate is dropped |
| the resolver never goes below the floor, pinned or not | the floor comparison is removed from either branch (a demoted-newest fixture, or a pin-below fixture, dispatches an older tag) |
| a NULL floor is unconstrained | it is treated as `v0.0.0` or as a refusal |
| the two floor sentences | the below-floor node gets the yank sentence |
| a pinned ineligible tag resolves NULL | it falls through to newest |
| an unknown channel token resolves nothing | it falls back to `*`'s channel |
| `auto` needs the gate cap, at dispatch time | the dispatcher check is removed (a capless auto fixture dispatches with the route 409 still in place) |
| every capability refusal is in the dispatcher | one moves to a route only (the auto path dispatches a capless node) |
| the server row is never refused for `agentOps` | the check is applied to a `NULL` row (the server never converges) |
| the projection is seconds | `issued`/`lease` are emitted in ms (the cross-side renderer test) |
| the projection carries both desireds | one `desired-*` line is dropped (`--channel` cannot select) |
| the projection is whole-or-nothing | the renderer's second-pass validation is removed (a torn fixture is staged) |
| the reader is role-aware | `server`/`both` + absent file falls back to `stable` |
| absent + no timer says so | `ccrc update` reads an absent projection as `stable` silently |
| `--channel` refuses off the control plane | it reaches `latest/download` for `dev` |
| the puller is installed where its timer looks | the `_inst_bins` line is removed (the timer 203/EXECs); `gen-wrappers.mjs` omits it (the orphan sweep removes it) |
| `_inst_caps` writes each wave's words | the step is removed, or a W4 fixture writes W1's three words (`apply` refused) |
| the floor never lowers | a restore fixture lowers it |
| the floor is checked on every path | the check is keyed to `--to` (a `latest/download` fixture below the floor installs) |
| `--downgrade` is the only way below the floor | the refusal is removed |
| the op validates the tag with the one guard | the regex is duplicated or removed (a `; rm` fixture spawns) |
| the op never execs | the `update` case is routed through the exec path |
| the spawn argv is absolute | the first token becomes bare `ccrc` |
| an agent without the op is never sent it | the `agentOps` check is removed (an older-agent fixture gets a frame) |
| `bad-request` from an advertising agent halts | it is folded into the skew case |
| `--detach` escapes the cgroup | the re-exec bypasses `_svc_run_detached` (the parent-kill fixture) |
| `--detach` precedes the lock | the order is swapped (the detached child inherits the fd; a second run is refused after the parent exits) |
| `--detach` refuses on Darwin | the OS check is removed |
| one update at a time | the `flock` is removed |
| the lock exemption is measured | the `flock -n` probe is removed (a fixture exporting the marker with no holder runs) |
| arm 2 runs under the parent's lock | the child re-acquires (the restore fixture exits 1 with the lock message) |
| the lock closes before the sweep | `exec {fd}>&-` is removed (a lingering stub pins the lock) |
| `previous` is written before the install and not by a restore | the write moves after the install; the `--from` exception is removed (a bare `rollback` after arm 2 targets the reverted tag) |
| a one-tap is a row | `requestedTag` is cleared on `accepted` (the second node never moves) |
| a refusal does not consume the request | `releaseLease` clears `requestedTag` (the dropped node never moves when it returns) |
| a request write triggers dispatch | it is removed from the trigger list (the tapped node waits a sweep) |
| `apply` names a tag | `tag` is ignored (the resolved newest dispatches) |
| `apply` refuses an older tag; an unversioned node is never "not newer" | `not-newer` is removed; the NULL arm refuses |
| `rollback` is catalogue-gated and defaults to `previous` | `unknown-tag` is removed; `no-previous` becomes a fetch |
| one dispatch per sweep | the lease acquire leaves the transaction |
| fleet before server | the sort is removed |
| `failed` halts dispatch | the halt predicate is removed |
| a provenance refusal does not halt | it is folded into `failed` |
| a refusal releases in the same turn | the `ResErr` handler is removed (the row waits for the deadline) |
| the deadline bounds a node that never wrote | it is computed from the report alone |
| `update.json` at every phase | one phase's write is removed |
| `accepted` does not settle | the reply handler sets `idle` |
| the gate has per-OS arms | the Darwin fixture reaches `systemctl` |
| the gate restores | `_upd_restore` is removed (the OLD-version `/health` fixture exits 0) |
| doctor FAIL does not restore | exit 3 is folded into exit 4 |
| a spine death after the tree moved reverts | the `install-step` branch is removed (the `_inst_skills` fixture exits 1) |
| arm 2 re-installs the previous tag | `~/.ccrc/previous` is not written before the staged install |
| arm 2 never silently unsigns | the marker-line precondition is removed |
| a standalone rollback sweeps behind the preflight | the `_upd_sweep` call is removed from `cmd_rollback`, or its preflight is bypassed |
| the automatic restore does not sweep | a sweep is added before the gate |
| `rollback` refuses an unknown tag | the existence check is removed |
| the watchdog re-measures before it reverts | the health probes are removed (a converged, abandoned fixture is rolled back) |
| the watchdog reverts a dead updater | the timer is not installed on `server`/`both`; the lock check is removed (it reverts a live updater) |
| the watchdog bounds a wedged holder | the 2× sentence is removed |
| doctor `provenance` WARNs, never FAILs | it FAILs on `unsigned` |
| the flip is a rename | `ln -sfn` targets `~/ccrc` directly |
| the migration keeps the old tree until the gate | the `rm` moves above the gate |
| a crashed migration is completed first | the `.migrating` detection is removed |
| GC never removes a needed version | one of the four guards (pointed-at, pinned, requested, running) is removed |
| six session doors, one dual-credential read | any one is moved (the census, both directions, over a real lane set) |
| no write route takes the box token | `checkMailToken` appears in `update/routes.ts` |
| the projection read takes the box token | it is removed from the dual-credential list (the timer gets 401) |
| the exposure check reads both inputs correctly | it reads `ccrc.env` alone (armed-via-exposure reads FAIL); it reads `CCRC_HOST` alone (a `Caddyfile` box with `exposure.env` deleted reads PASS) |
| unreachable is not current | any of the three PWA surfaces renders on `lastOkAt: null` |
| the move controls are disabled in W3 | one is enabled before its route exists |
| one push per tag, across restarts | `notifiedAt` is not written (a second sweep sends; a restarted fixture sends) |
| `notify` gates the push | `stable` still pushes a dev tag |
| the push lands on settings | `url` is dropped from the payload |
| Install names the order and the direction | the sheet lists nodes unsorted; an older tag is sent as `apply` |

## 19. Files

New: `deploy/release-stable.sh`, `.github/workflows/release-stable.yml`, `deploy/verify-provenance.mjs`,
`server/src/update/{catalogue,inventory,resolve,dispatch,routes}.ts`, `shared/semver.ts`, `ccd/ccd-update-sync`,
`deploy/systemd/ccd-update-sync.{service,timer}`, `deploy/systemd/ccrc-update-watchdog.{service,timer}`,
`pwa/src/screens/SettingsScreen.tsx`, `pwa/src/fleet/UpdateBanner.tsx`, and their tests.
Changed: `deploy/release-main.sh`, `.github/workflows/release-main.yml`, `.github/workflows/release.yml`,
`install.sh`, `ccd/ccrc` (`_upd_resolve`, `_upd_fetch`, `_upd_restore`, `cmd_rollback`, `cmd_versions`, `cmd_channel`
(read-only), `_inst_caps`, `_inst_installed` (`floor`), `_inst_bins`, `cmd_install` (`node-id`, `install-step`,
marker line 2), `cmd_uninstall`, `cmd_version`, `cmd_update` (`--channel`, `--allow-unsigned`, `--downgrade`,
`--detach`, `--from`, `--no-gate`, the lock, the floor check, the gate, `update.json`, `previous`, the spine-death
arm, `--check caps=`), `cmd_rollout` (`--channel`), `_inst_units` (two timer pairs), the wrapper-sweep `case`,
`_inst_tree`/`_inst_atomic` (W5)), `deploy/gen-wrappers.mjs`, `ccd/ccrc-doctor-checks` (the `provenance` check and
the unarmed-exposure check), `shared/api.ts`, `shared/agent-protocol.ts` (`ops`, the `update` op),
`agent/src/server.ts`, `agent/src/whitelist.ts` (the exact-basename read set — and nothing on the exec surface),
`agent/test/whitelist-structural.test.ts`, `server/src/remote/client.ts`, `server/src/coord/schema.ts`,
`server/src/coord/store.ts`, `server/src/watch.ts`, `server/src/server.ts`, `server/src/fleetstate.ts`,
`server/src/auth/gate.ts`, `server/src/push.ts`, `pwa/src/app.tsx`, `pwa/src/screens/FleetScreen.tsx`,
`pwa/src/fleet/{BuildLine,FleetHostBanner}.tsx`, `pwa/src/lib/api.ts`, `pwa/public/push-sw.js`,
`pwa/src/fleet/fleet.css`, `CLAUDE.md`, `README.md`, the tests named per wave.
Untouched: `deploy/deploy.sh`, `deploy/build-release.sh`, the exec surface of `agent/src/whitelist.ts`
(`EXEC_COMMANDS`, `FORBIDDEN_COMMANDS`, `EXEC_WHITELIST`), the PWA service-worker configuration, `ccd/ccd`,
`pwa/src/lib/theme.ts`.
