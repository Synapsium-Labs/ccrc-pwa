<div align="center">

# ccrc

**Self-hosted remote control for a fleet of Claude Code sessions.**
Run it on your own box. Drive twenty agents from your phone.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933.svg?logo=node.js&logoColor=white)](#requirements)
[![Self-hosted](https://img.shields.io/badge/self--hosted-one%20box-8b5cf6.svg)](#quickstart)
[![No telemetry](https://img.shields.io/badge/telemetry-none-64748b.svg)](#privacy)
[![PWA](https://img.shields.io/badge/PWA-installable-f59e0b.svg)](#quickstart)

</div>

> Claude Code runs in a terminal, on a box, in a tmux pane. That is fine for one session.
> It stops being fine at twenty — when you are away from the desk, when a session is
> blocked on a question you could answer in four seconds, and when the account it runs on
> hits its limit and the work has to move somewhere else.
>
> **ccrc is the console for that.** One installable web app, served by your own machine,
> that sees every session, answers their questions, and moves a running conversation
> between accounts without losing it.

## Why

The official claude.ai app cannot follow a session across an account swap. ccrc can — and
that is the feature the whole design is bent around.

When a session's account runs out, ccrc relocates the **conversation itself**. The
transcript is found **by uuid**, globally unique, across every project directory under the
source account, rather than by one guessed path. A swap that finds nothing to carry
**refuses** rather than completing and quietly losing your history. The PWA also finds
history that an older, buggier swap stranded on another account — and the chat that had to
look elsewhere says so, under a banner naming where it came from.

Everything else in ccrc exists to serve one loop:

```
spec  →  plan  →  waves of subagents  →  per-PR review lenses  →  whole-branch pass
```

## What you get

| | |
|---|---|
| **Follow a session across accounts** | The swap carries the conversation, located by uuid, and refuses rather than losing it. |
| **Multi-wave programs** | Open a run, dispatch a wave, and the server tracks it — not a human holding state in their head. |
| **Claims are re-measured, never believed** | A worker reporting "wave done" is checked against the workspace branch tip and `.prhistory`, from the git refs on disk. |
| **Mail between sessions** | Delivered only into an idle turn boundary, so a nudge never lands mid-thought. The body lives in a durable store; what arrives is one line. |
| **Hook-first session state** | Each session reports its own state through a Claude Code hook; scraping the tmux pane is the ranked fallback, not the source. |
| **Answer from the lock screen** | A session asks a question; you get a push notification and answer it without opening a terminal. |
| **Workspace holds** | A program declares a claim on a worktree. No timeout, no expiry — the reason string *is* the display, and four separate destructive paths refuse while it stands. |
| **Two-phase workspace destruction** | Nothing irreversible happens on one tap, and every precondition is re-proved at the moment it matters. |
| **Branch names the model already wrote** | The branch takes the name from the work, instead of asking you to invent one. |
| **Accounts are runtime data** | A roster in `~/.ccrc/accounts.json` — usage and placement projected *before* you tap, not discovered after. |
| **An optional session gate** | Passkeys or a passphrase, off by default, and it fails shut on every ambiguity rather than open. |
| **One whitelisted socket** | Split across two boxes, the server never SSHes the fleet host. It drives it through a closed set of exec verbs, and nothing else. |

## Quickstart

One box, no TLS, no exposure — the default install:

```bash
git clone https://github.com/Synapsium-Labs/ccrc-pwa.git && cd ccrc
bash install.sh
```

That builds the PWA and the server, then hands off to `ccrc install`, which seeds
`~/.ccrc`, installs the systemd user units, and registers the session hook in every
account home it finds. The server comes up on `127.0.0.1:7788`.

Then:

```bash
ccrc doctor      # every check in the table: binaries, units, roster, accounts, credentials, pools, hooks, auth posture
ccrc status      # what is running, where
```

Open `http://127.0.0.1:7788/` and add it to your home screen.

> **Reaching it from your phone.** ccrc binds loopback and speaks plain HTTP on purpose —
> a PWA needs a *secure context* to install, so something in front has to terminate TLS.
> Bring your own reverse proxy, or let ccrc configure one:
>
> ```bash
> ccrc expose duckdns   # a dynamic-DNS name + Caddy + an automatic certificate
> ccrc expose byo       # you own the name and the proxy; ccrc just records the origin
> ccrc expose ip        # no name at all: the box's bare IPv4 + a locally-trusted certificate
> ccrc expose status    # what is configured right now
> ```
>
> Exposing the box to the internet without arming the session gate is the one mistake
> worth being loud about. See [The session gate](#the-session-gate-ccrc_auth-off-by-default).

<details>
<summary><b>Installing from a release artifact instead of a checkout</b></summary>

Release mode needs only `curl` — no clone, no toolchain, no build on the box. It fetches
`SHA256SUMS` first, then the tarball, and runs `sha256sum -c` **before extracting a single
file**:

```bash
curl -fsSLO https://raw.githubusercontent.com/Synapsium-Labs/ccrc-pwa/main/install.sh
bash install.sh --release
```

Anything after `--release` passes through to `ccrc install`, which is how `--role` rides:

```bash
bash install.sh --release --role fleet
```

**Status:** no release has been cut yet — there are no tags — so `--release` currently ends
at curl's own 404. Build one locally with
`bash deploy/build-release.sh --untagged --out release-out`.

Note that `curl … | bash` (piping the script into a shell) does **not** work: read from
stdin, `BASH_SOURCE` is unset and the script dies under `set -u` before its argument loop.
Download it, or use `bash <(curl -fsSL …)`.

</details>

## Requirements

- **Node ≥ 22.13.0** — not negotiable, and not a style choice: the coordination database
  is `node:sqlite`, which is flagged below that. All three packages declare the same floor
  and a test pins it.
- **git**, **tmux**, **bash**, **curl**, **rsync**.
- **`gh`** (the GitHub CLI, authenticated with `repo` scope) — PR state, review and merge
  go through it.
- **`jq`**, **`python3`**, **`flock`** — ccrc reads the box's small JSON files with the
  first, the session hook and registry locking are the second and third.
- **Claude Code**, installed and authenticated for at least one account.
- **Linux or macOS.** The session layer is tmux plus the box's service manager — systemd
  on Linux, launchd on macOS.

**On Linux**, additionally:

- **systemd user units**, with `loginctl enable-linger` set — without lingering your
  sessions die with your last login.

**On macOS**, additionally:

```bash
brew install bash tmux flock
```

- **bash ≥ 4.4.** Not optional and not a preference: `ccd` uses associative arrays,
  `[[ -v arr[k] ]]`, `mapfile`, `BASHPID` — and empty-array `"${a[@]}"` expansions under
  `set -u`, which bash treated as fatal until 4.4 — and macOS ships **3.2.57** as `/bin/bash`
  for licensing reasons. Make sure Homebrew's `bin` comes before `/bin` on your `PATH`.
  `install.sh` refuses by version before it builds anything.
- **tmux** and **flock**, neither of which macOS ships. Homebrew's `flock` formula is the
  portable implementation and takes the flags ccd passes.
- **Only if you BUILD a release** (`deploy/build-release.sh`, a maintainer's job — not
  something a box needs to install or update): `brew install gnu-tar`. The artifact is made
  reproducible with `--sort/--mtime/--owner/--group`, BSD tar has none of them, and the
  script refuses rather than emitting a tarball whose digest depends on who built it.

Two things a macOS box does **not** get, both stated by `ccrc doctor` rather than left to
be discovered:

- **No linger.** A LaunchAgent runs in your login session: the server and every session
  stop at logout and start again at login. The only thing on macOS that survives a logout
  is a root-owned LaunchDaemon, which would run your fleet as a different user with a
  different keychain — a posture `ccrc install` will not choose for you. For an always-on
  box, stay logged in and turn off sleep.
- **No memory ceiling.** The per-session and fleet-wide caps are cgroup limits
  (`MemoryHigh`/`MemoryMax` on the session unit, per-pane `MemoryHigh`/`MemoryMax`, and the
  aggregate `MemoryMax` on `app-claude\x2dsession.slice`), and launchd has no equivalent of
  any kind. `ccd-cap-scopes` is not installed there either — it caps cgroup scopes, and
  there are none.

`ccrc doctor` checks all of this and tells you which one is missing, rather than failing
somewhere further in.

## How it works

The default install is **one box**. The server is a single Fastify process that serves the
PWA, reads the fleet's flat files directly, and shells out to `ccd` and `tmux`.

```mermaid
flowchart TB
    B["Browser / installed PWA"]

    subgraph BOX["one box — the default install"]
      P["TLS-terminating reverse proxy<br/>optional; 'ccrc expose' configures Caddy"]
      S["ccrc-server — Fastify, systemd user unit<br/>binds 127.0.0.1:7788, plain HTTP"]
      D[("~/.ccrc/coord.db — node:sqlite, WAL<br/>~/.ccrc/state-cache.json")]
      C["ccd + tmux"]
      U["claude-session@ID.service<br/>ExecStart: ccd supervise ID"]
      T["tmux session cc-ID<br/>Claude Code process"]
      R[("~/.cc-sessions · ~/.cc-limits<br/>.prhistory · ~/.cc-clips")]
    end

    B -->|"HTTPS"| P
    P -->|"HTTP to 127.0.0.1:7788"| S
    B -.->|"plain HTTP on a loopback/dev box"| S
    S -->|"serves the PWA bundle at / ; /api/* ; /ws/fleet, /ws/session, /ws/pty"| B
    S -->|"child_process execFile — local fleet mode"| C
    S -->|"node:fs reads"| R
    S ---|"local disk"| D
    C -->|"systemctl --user"| U
    U -->|"supervises"| T
    T -->|"session-hook.sh writes hookstate.json"| R
```

Sessions are not children of the server. Each one is its own systemd user unit running
`ccd supervise`, which owns a tmux session — so the server can restart, or be replaced
mid-deploy, without touching a running turn.

<details>
<summary><b>The optional two-box split</b></summary>

Set `CCRC_FLEET=remote` and the same seams are backed by a WebSocket to an agent on the
fleet host instead of local `execFile`. The server never SSHes that box.

```mermaid
flowchart LR
    B["Browser / installed PWA"]

    subgraph SH["server host — CCRC_FLEET=remote"]
      S["ccrc-server<br/>127.0.0.1:7788"]
      D[("~/.ccrc/coord.db<br/>~/.ccrc/state-cache.json")]
    end

    subgraph FH["fleet host"]
      A["ccrc-agent<br/>listens on 7789, private iface only"]
      C["ccd · tmux · claude-session@ID units"]
      R[("~/.cc-sessions · ~/.cc-limits<br/>.prhistory · ~/.cc-clips")]
    end

    B -->|"HTTPS via a TLS-terminating proxy"| S
    S ---|"local disk"| D
    S -->|"ONE WebSocket — bearer token in the first frame"| A
    A -->|"exec: only tmux and ccd, by argv prefix"| C
    A -->|"reads whitelisted paths; writes ~/.cc-clips only"| R
    C -->|"writes"| R
```

The agent's exec surface is a closed two-name set — `tmux` and `ccd` — matched on the bare
command name and an argv **prefix**. There is no shell, and no way to add a third name from
the server side.

</details>

### The pieces

| Path | What it is |
|---|---|
| `server/` | Fastify (TS ESM), one systemd user unit. Owns `~/.ccrc/coord.db` — runs, work items, mail and coordinator state — via `node:sqlite` with WAL and migrations that refuse to start rather than open empty. |
| `pwa/` | React + Vite installable PWA. Builds into `server/dist-pwa`, which the server serves at `/`. |
| `agent/` | A small whitelisted exec/file/tail/pty surface over a bearer-token WebSocket. Needed only for the two-box split; local mode never touches it. |
| `ccd/` | The bash session layer that lives on the fleet host: `ccd` itself, the Claude Code hook that reports each session's state, and its idempotent installer. |
| `shared/` | The wire vocabulary — server↔agent and server↔PWA types — imported by both sides. |
| `deploy/` | systemd units, env templates, and a convenience wrapper for pushing a working tree to an already-installed box. |

ccd's flat files stay the fleet's own authority. The database holds only what coordination
adds *on top* of them, and never replaces them — a lost `coord.db` reconstructs.

## Privacy

ccrc has no telemetry, no analytics, and no phone-home. It talks to your box, the Claude
Code processes on it, and — only if you turn them on — the dynamic-DNS provider you chose
for a name and a certificate. Your transcripts never leave the machine you installed it on.

---

The rest of this README is the reference, ordered for an outside reader: install and
expose first, operating the fleet in the middle, and — below a second fold — the
internals, written for someone changing the code: how each mechanism actually works,
what the guarantees are, and where they stop.

## Install (single box)

From a **release artifact** — no build step on the box; the clone is only a
way of having `install.sh`:

```bash
git clone https://github.com/Synapsium-Labs/ccrc-pwa.git ccrc && cd ccrc && bash install.sh --release
```

or from the **checkout** — builds the server and the PWA here, then installs
the same way:

```bash
git clone https://github.com/Synapsium-Labs/ccrc-pwa.git ccrc && cd ccrc
bash install.sh
```

The owner in that URL is `CCRC_RELEASE_OWNER`'s value — defined once in
`install.sh` and matched by `ccd/ccrc`, so `ccrc update` later downloads from
the same place; `CCRC_RELEASE_BASE_URL` is the documented override that points
both lanes at a mirror instead. **Status:** no release has been cut yet — there
are no tags — so `--release` today ends at curl's own 404; build an artifact
locally with `bash deploy/build-release.sh --untagged --out release-out`, or
take the checkout lane.

**What the box needs first.** `install.sh` itself refuses only on `node`;
`rsync` and `diff` are `ccrc install`'s own refusals (below); the rest is
measured, by name, by the `ccrc doctor` run the install ends with:

- **node ≥ 22.13.0** — the `engines.node` floor all three packages agree on
  (`node:sqlite` needs it unflagged, so an older node fails to boot, not
  degrades)
- **rsync** and **diff** — `ccrc install` places the tree with one and
  compares config dirs with the other
- a **systemd user session**, with lingering enabled — the one privileged
  step the installer prints rather than runs
- **tmux**, **git**, **jq**, **python3**, **flock** — the fleet substrate
- **gh**, authenticated, if PR state/review/merge should work
- **curl**, for `--release` mode

`install.sh` refuses first — `node` missing, or below the floor
`server/package.json`'s `engines.node` declares (naming both versions) —
otherwise it builds the server and the PWA (checkout mode; `--release`
skips the build and hands off to the staged tree — "Releases" below) and
hands off to `ccrc install`
(`ccd/ccrc install`), which seeds the roster and `ccrc.env`, places the tree at
`~/ccrc`, installs the systemd user units, converges the wrappers your roster
declares (the seeded default roster declares one `upstream` account, so a
fresh install writes none), and ends by running `ccrc doctor` — the install's
own exit code is doctor's. **Green means the box
is ready**; the PWA answers at `http://127.0.0.1:7788/`. Re-running either
script converges rather than damaging an existing install. `rsync` and `diff`
are hard by-name dependencies of `ccrc install` — `rsync` places the tree, and
`diff` is what both skill installers compare a config dir against — with **no
doctor check for either yet**; absent, each refuses naming the package rather
than failing opaquely mid-copy, and a refused skill install is fatal to the
whole verb. `cmp` is the third of the class and the mildest: its two call sites
— `_inst_atomic` and `_inst_keep_aside` — leave the comparison unguarded on
purpose, so a box without it rewrites identical bytes rather than refusing, the
safe direction. (`_inst_tree_copy` compares with `diff -r -q`, not `cmp`, and
degrades the same way; the refusal on a missing `diff` comes from the two skill
installers it then runs.)

This is the **single-box** shape only: local fleet mode, localhost, no TLS, no
agent (`ccrc-agent.service` is deliberately not installed — local mode never
touches it). The two-box shape — a fleet box installed with `--role fleet`,
the server box flipped to `CCRC_FLEET=remote` — is "Releases" below plus
"Remote fleet mode"; runbook step 12 is its worked, boxed proof.

The steps above are proven hermetically (fixture `$HOME`s, every suite in "Develop" below); the
real-VM proof — an actual fresh box, a stopwatch, RC verifiably off — is the operator's stage gate
and remains pending. `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` is its runbook.

## Exposure: a public name and a real certificate (`ccrc expose`)

A box goes public the same way its session gate arms ("The session gate"
below): dark by default, one operator verb, and nothing privileged ever run
by ccrc. Three arms, one decision — how much of the outside world you want
involved:

| mode | you bring | name | certificate | passkeys | third parties |
|---|---|---|---|---|---|
| `ccrc expose duckdns` | a free DuckDNS account | `<sub>.duckdns.org`, zero-cost — a ccrc timer keeps it pointed here | public ACME (automatic) | yes | DuckDNS + the ACME CA |
| `ccrc expose byo` | your own domain | yours — DNS stays yours by contract | public ACME (automatic) | yes | your DNS host + the ACME CA |
| `ccrc expose ip` | nothing | none — the box's bare global IPv4, measured by the verb itself | caddy's internal CA (`tls internal`) — each device trusts the printed root once | no — passkeys need a domain, so the gate runs on passphrase login only | **none at all** |

`duckdns` prompts for a subdomain and token (tty-only, echo off, never argv);
`byo` prompts for your own origin and passkey rp id; `ip` prompts for nothing
but the caddy bind — the address is measured (`hostname -I`, first global
IPv4), and a NAT'd box is refused rather than certified for an address it
does not carry (a changed box IP is a re-run of the verb). Whichever arm, the
verb writes two ccrc-owned files and prints the rest:

- **`~/.ccrc/exposure.env`** (0600 — the DuckDNS token lives here, and is
  never printed: `ccrc expose status` and doctor report it as SET/NOT SET
  only). It carries `CCRC_ORIGIN` and `CCRC_RP_ID` (plus the DuckDNS trio on
  that arm) and is read by `ccrc.service` as a **second `EnvironmentFile`
  after `ccrc.env`** — systemd's later-file-wins, so exposure keys override a
  hand-set placeholder without touching the seed-once `ccrc.env`. To keep the
  two files from ever disagreeing, the verb refuses to run while `ccrc.env`
  still sets either key itself, naming both files and which would win.
- **`~/.ccrc/Caddyfile`**, regenerated whole on every run: the host and
  `reverse_proxy 127.0.0.1:<CCRC_PORT>`, nothing else. Stock Caddy's automatic
  HTTPS does the certificate through the standard ACME challenges
  (HTTP-01/TLS-ALPN-01) — which is why **a router forwarding ports 80 and 443
  to the box is a prerequisite** the verb states loudly and nothing on the box
  can verify for you. On the `ip` arm the block is
  `https://<ip> { tls internal; reverse_proxy 127.0.0.1:<port> }` instead: no
  ACME and no ports forwarded for issuance — caddy mints the certificate from
  its own root, and the verb prints the **trust ceremony** (`sudo caddy trust`
  on the box; installing
  `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` on each
  phone, iOS and Android steps included). Doctor's `cert` check holds a
  standing WARN on this arm — the chain is not publicly trusted, by design —
  and names that same ceremony as the remedy.

Everything root-side is a printed three-step ceremony — install caddy from the
distro, copy the Caddyfile to `/etc/caddy/Caddyfile` (a copy, never a symlink:
caddy runs as its own user and cannot read inside your home — D-165),
`sudo systemctl enable --now caddy` — that ccrc never executes: the same
degraded-step doctrine as the installer's linger step, at verb scale. On the
DuckDNS arm the verb also installs a user timer (`ccrc-ddns.timer`) that
re-points the record at this box every five minutes, reading the token from
`exposure.env` at run time so the world-readable unit file never carries the
0600 secret. Four doctor checks — `exposure`, `caddy`, `cert`, `name` —
measure each piece, and all four SKIP on a box that never ran the verb:
not-configured is a valid end state, not a fault.

Users with their own proxy skip the Caddy step; the documented contract is
"terminate TLS, forward to `localhost:$CCRC_PORT`" (set in ccrc.env at
install; default 7788). ccrc itself never speaks TLS and
listens on loopback only.

After exposing: restart the server so it reads the new origin, and **re-enrol
every passkey** — passkeys are origin-bound, and a key enrolled at the old
name fails loudly, with the login screen naming the old rp id. (On the `ip`
arm there is nothing to re-enrol: passkeys need a domain — on a bare IP the
gate runs on passphrase login only, and enrolment simply never appears.) Then
add the exposed origin to a phone's home screen — Android Chrome / iOS
Safari — for the standalone, installable app. The full
choreography — prerequisites, the sudo ceremony, the expected doctor
transcript, the phone proof — is step 11 of
[`docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`](docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md).

## Releases — install from an artifact, update, uninstall

Design: `docs/superpowers/specs/2026-08-21-stage4-release-design.md`. Runbook step 12 (same file
as above) is the two-box worked proof of the install and update verbs in this section.

**The pipeline.** Every push to `main` runs `.github/workflows/release-main.yml`, thin like its
siblings: `deploy/release-main.sh prepare` derives the next patch tag from the highest `vX.Y.Z`, tags
it LOCALLY and runs `deploy/build-release.sh` (the one builder — refuses a dirty tree and an untagged
HEAD); `actions/attest-build-provenance` then signs the tarball's digest with the workflow's own OIDC
identity (keyless — the repo holds no signing secret); and `release-main.sh publish` pushes the tag and
publishes the tarball, `SHA256SUMS` and the bundle `ccrc-<tag>.tar.gz.sigstore.json` with `gh release
create --verify-tag --prerelease`, deleting the tag again if the publish never completes (nothing
reaches origin before that push). A hand-pushed `vX.Y.0`/`vX.0.0` tag rides `release.yml` instead —
same attest step, its identity at the tag — and the next merge derives past it. The tarball is the
matched set — prebuilt dists, the three `package.json`+lock pairs, `shared/`, `ccd/`, the deploy units
and helpers, `install.sh` — with a `MANIFEST` of per-file sha256 digests and a shipped `build.json`
that carries the tag as `version` (`ccrc version` prints it; `/health` emits a sibling `version`;
`buildAgreement` still compares sha+dirty only — the sha is the truth, the tag is the label). Designs:
`2026-09-18-release-rollout-design.md`, `2026-09-20-centralised-update-management-design.md`.

**Channels: every release is born `dev`; `stable` is a promotion.** A release's `prerelease` flag IS
its channel — `dev` while set, `stable` once cleared — and its bytes never change. Promotion is a
fast-forward push of a released commit to the `stable` branch (`git push origin <tag>^{commit}:refs/heads/stable`
from any checkout with the tag fetched; the branch's ruleset refuses force pushes and deletion, and
the script refuses a HEAD that carries no release tag or more than one — a merge commit carries none, so
it cannot be promoted; D-3130 says why there is no linear-history rule), which runs `release-stable.yml` → `deploy/release-stable.sh`: `gh release edit <tag>
--prerelease=false`, then `--latest`, then a read-back of `releases/latest` — an already-stable release
still gets that read-back, and one more `--latest`, when latest names another tag. Never a build — a
rebuild would be a different `build.json`, a different digest, bytes nobody ran. Demotion is `gh
release edit <tag> --prerelease` by hand, and moves no box by itself: a node keeps what it runs until
someone runs `ccrc update` — and that update refuses a step backwards on its own, below the per-box
version floor (design §9), unless `--downgrade` is typed.

**Install from a release.** `bash install.sh --release [vX.Y.Z]` (default: the newest stable release —
`latest/download` never serves a prerelease, so a `dev` build needs its tag) downloads the
tarball and `SHA256SUMS`, verifies `sha256sum -c` **before extracting a single file**, extracts to
a staging dir and hands off to the STAGED `ccrc install` — no build step on the box. The first
install trusts the transport checksum only and says so; every update from then on verifies
provenance. Everything after `--release [tag]` passes through to that verb; `--role` rides here. Checkout mode
(`bash install.sh` from a clone, as in "Install" above) is unchanged.

**Roles.** `ccrc install --role server|fleet|both` (default `both` = the single-box shape above;
the role is recorded as `CCRC_ROLE` in `ccrc.env`'s first write). `--role fleet` is the fleet
box's installer path: it prompts — tty-only, the token is never echoed — for the server's WS URL
and the agent bearer token, writes `~/.ccrc/agent.env` (0600, seed-once), and installs and enables
`ccrc-agent.service` instead of `ccrc.service`. Wiring the server box to it (`CCRC_FLEET=remote`,
`CCRC_AGENT_URL`, `CCRC_AGENT_TOKEN`) is "Remote fleet mode" below.

**Update and rollout.** `ccrc update [--to vX.Y.Z] [--check] [--force] [--allow-unsigned] [--downgrade]` —
per box, explicit, never automatic. `--check` prints where this box stands against the published release (a
fixed-shape `check:` line, then a sentence; exit 0 only when current) and writes nothing. A box already
running the target whose install COMPLETED — stamp sha, staged sha and `~/.ccrc/installed` (the spine's
last write) all agreeing — is left alone; `--force` reinstalls. Otherwise the spine, each step refusing
loudly: resolve (`SHA256SUMS`; with `--to`, the tarball it names must BE that tag), the floor
(`~/.ccrc/floor`, the highest version this box ever completed an install of — a target below it is refused
whichever way it was resolved, and `--downgrade` is the typed way down); fetch + verify (transport
checksum, then the release's provenance bundle `ccrc-<tag>.tar.gz.sigstore.json` checked by the INSTALLED
tree's `deploy/verify-provenance.mjs` against the vendored Sigstore root and exactly the two release
workflows' identities — `--allow-unsigned` admits a release with NO bundle, never one that fails, and the
box records the install as unsigned, which `ccrc version` says); extract, check the per-file `MANIFEST`
(the cheaper refusal, so it runs first — D-3149), then bind the extracted `build.json` to the resolved
version; back up to `~/ccrc-backups/<ts>/` (coord.db via
`VACUUM INTO`, dists, ccd, units, `~/.ccrc/memory`) before any install write; re-run the install spine from
the staged tree (role-aware, atomic, seed-once files untouched, every rostered home's skills converged; it
mints `~/.ccrc/node-id` once, rewrites `~/.ccrc/ccrc-caps` with what this install can do, and raises the
floor last); the supervisor sweep behind its mandatory `KillMode=process` preflight; then the from→to report.
Rolling back is `--to <the older tag> --downgrade`, which
prints the coord.db restore commands rather than auto-restoring. **Across a two-box fleet, `ccrc
rollout [--to] [--server-first] [--check] [--force]`** from a machine holding `~/.ccrc/deploy.env`
does it in order — roles preflighted, version pinned once from SHA256SUMS, fleet box then server
box, stop on the first failure, both boxes re-measured. `ccrc doctor`'s `build` check compares the
running server against the stamp, `skills` every home against the shipped tree, `fleet` names `ccrc rollout`.

**Control plane (update-management W2).** The server now measures and records the fleet's update state; nothing
in it moves a node yet. `coord.db` (migration 14) holds a **release catalogue** — the repo's GitHub releases
listing, read every 30 minutes with `If-None-Match` and no token (owner and repo come from the installed tree's
`ccd/ccrc`, or from `CCRC_RELEASE_OWNER` and `CCRC_RELEASE_REPO` when both are set — a pair that is not two
plain names stops the poll rather than falling back); a release that vanishes from the listing is marked
yanked, never deleted — a **node inventory** re-measured every 60 seconds (each node's `~/.ccrc` stamp,
install record, `ccrc-caps`, floor, previous version, `node-id` and update report; every file lstat-gated,
capped at 64 KiB and validated; the fleet node's read through an exact-basename read set on the agent, never a
prefix of `~/.ccrc`), and one **desired-state intent** per scope (`*`, or a node id: channel, pin, auto,
notify), each write journalled to `~/.ccrc/update-intent.log` under a rising epoch. The catalogue and the
inventory keep their cadence when the fleet registry cannot be listed. After every inventory sweep the server
resolves each node's desired tag — the newest eligible release on its channel, never below the node's floor
(the higher of its recorded floor and the version it runs), pinned or not — and on a `server` or `both` box
writes its own projection, `~/.ccrc/update-intent` (whole, by rename; mode 0600; times in unix seconds). The
role is `CCRC_ROLE` from the environment; absent or invalid, it is derived from `CCRC_FLEET` and the boot log
says so. `GET /api/updates` (session-gated) reads all of it; `POST /api/updates/intent`, `/api/updates/refresh`
(once a minute) and `/api/updates/ack` are session-only — the box token never writes intent — and
`GET /api/updates/intent/:nodeId` serves a node its projection as plain text under a session or the box token.
`/api/fleet/health`'s `builds` is now a view of the inventory rows. Not yet: no apply or rollback route, no
fleet-side projection reader, no release notification, no settings screen — and an `auto` other than `off` is
refused (`409`) until every node the intent covers lists `update-gate` in its `ccrc-caps`.

**The maintenance verbs.** `ccrc backup` runs update's backup step standalone (same set, same
directory shape, pruned to the newest `CCRC_BACKUP_KEEP` timestamped dirs, default 10 — hand-made
siblings are never touched). `ccrc logs [-f] [-n N]` is `journalctl --user` against this box's own
unit (`ccrc.service`, or `ccrc-agent.service` when the recorded role is `fleet`). `ccrc uninstall`
takes the box off ccrc and leaves reinstall safe: it refuses while live sessions exist (unless
`--force`), removes the units, ccrc's managed settings.json hook entries (per-file backup;
unmanaged entries survive byte-identically), marker-verified wrappers only, ccrc's own artifacts
inside `~/.cc-sessions` file-by-file, `~/ccrc` and the installed executables — and preserves
`~/.ccrc` whole, the registry rows and operator switches, worktrees and `~/ccrc-backups`, printing
(never running) the keep-aside restore commands. `--purge` additionally removes `~/.ccrc`'s config
(roster, identity, `ccrc.env`, `build.json`, …) and `~/ccrc-backups` — but **preserves
`~/.ccrc/memory`** (every project's durable memory, the sole live copy since `ccrc memory --apply`;
a session's prose is not configuration) unless `--purge-memory` is also given, which extends `--purge`
to remove it too; never worktrees, never tmux state.

## The session gate: `CCRC_AUTH` (off by default)

The PWA and its API can be put behind a **passphrase**, with optional
**passkeys** on top. It is **off in the shipped default**, and that is the whole
deploy story: with the flag off the gate's one `onRequest` hook is a
passthrough, nothing reads a passphrase file, and the box behaves exactly as it
did before the gate existed — so the mechanism ships to a live fleet before
anyone decides to turn it on. A box that never arms it is a box anyone who can
reach it can drive, which is the pre-existing posture, stated rather than
implied.

**A passphrase on its own changes nothing, and so does the flag on its own.**
Arming is one operator act with two halves, and the order is: set the
passphrase, then arm the flag.

```bash
ccrc passwd                       # prompts twice, echo off, 12-char floor,
                                  # writes ~/.ccrc/auth.scrypt at 0600
$EDITOR ~/.ccrc/ccrc.env          # CCRC_AUTH=on  +  CCRC_RP_ID  +  CCRC_ORIGIN
systemctl --user restart ccrc.service
```

> **`CCRC_RP_ID` and `CCRC_ORIGIN` must be set in the same edit that arms
> `CCRC_AUTH`.** Their defaults are `localhost` and `http://localhost:<port>`;
> armed with those on a box actually reached under a real name, **every
> non-exempt write and every `/ws/*` upgrade is refused** — a console that
> loads, reads and cannot act — **and nothing warns at boot.** The pair is
> internally coherent, so the boot check that catches a *disagreeing* pair
> passes it, and a self-check that could catch it is not implementable behind a
> TLS-terminating proxy at all: the server never sees the hostname it was
> reached under, the proxy is the only party that knows it, and a check that
> tried to guess would have to fail shut on correctly-configured boxes too.
> The only signals are one journal line per refusal and a `foreign-origin`
> failure on every write.

`CCRC_RP_ID` is the **registrable domain** the box is reached at — `example.com`
for `ccrc.example.com` — never a bare public suffix, and never derived by
stripping labels off the hostname. The trap is the normal case for a self-hosted
box, not an exotic one: the dynamic-DNS and tunnel providers people reach a home
server through are themselves on the Public Suffix List, so under a name like
`<you>.duckdns.org` the registrable domain is the **whole** name — strip one more
label and you have a suffix shared with every other tenant of that provider,
which browsers refuse outright. Nothing here carries a PSL to know which is
which, so the operator states the value rather than the server deriving it;
`PUBLIC_SUFFIX_TRAPS` (`server/src/auth/webauthn.ts`) rejects the short list of
traps it can actually hit, and that list is not a PSL and must not become one. A credential records the rpId it was enrolled under, so
changing it makes existing passkeys fail **loudly** ("re-enrol"), which is the
intended way for a rename to behave. Full key-by-key documentation, including
the path overrides and the `Secure`-cookie opt-out, is in
[`deploy/ccrc.env.example`](deploy/ccrc.env.example); the step-by-step arming
procedure and the operator runbooks (lost device, corrupt secret, disarming) are
step 10 of
[`docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`](docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md).

<!-- ORDER-PINNED PASSAGE. `server/test/box-token-census.test.ts` reads the number
     words in the paragraph below and asserts them IN SEQUENCE, so this paragraph
     states the TOTAL first and the breakdown second. Rewriting it the other way
     round is a correct sentence and a red suite: move the expectation in that file
     in the same change. It also asserts that every exempt-but-authenticated GET is
     named here, derived from `gate.ts`'s own EXEMPT reasons (D-1233/D-1234). -->

What is gated, and what is not: **everything except** `/health` (deploy's own
liveness gate reads the shipped sha out of it), the twenty-seven machine lanes the
fleet host reaches (twenty-four box-token-consulting coordination routes plus
`/api/notify`, which still tolerates an absent token for one deploy generation,
`/api/pools/epoch` and `/api/updates/intent/:nodeId` — the callers are `curl` inside a
Claude Code session, `ccd-pool-sync.timer` and, from update-management W4, `ccd-update-sync.timer`, none with a cookie jar, though the
exempt-but-authenticated GETs among them (`/api/runs`, `/api/runs/:id/items`,
`/api/runs/:id/signals`, `/api/feed`, `/api/lifecycle`, `/api/peers`, `/api/claims`,
`/api/asks`, `/api/pools/epoch`, `/api/updates/intent/:nodeId`) take a live session
cookie **or** the token, which is how a coordinator reads its own wave ledger from
the fleet host), the login and passkey-assertion doors themselves,
`GET /api/auth/status` (with a minimized anonymous body), and `GET /*`, the
static bundle a browser has to
download before it can show a login screen. Enrolling a passkey is **not**
exempt — it requires already being signed in, which is what makes
`attestation: 'none'` safe.

**Ending a session** is Accounts → **This session** → **Sign out**: it revokes
this browser's session server-side and leaves other devices signed in. Enrolled
passkeys survive it, which is why it is not the lost-device procedure.

**`ccrc passwd` invalidates sessions, not passkeys.** A rotation bumps the
file's generation and every logged-in browser is expired at once with no
restart; every enrolled authenticator keeps working, deliberately. For a lost
device the order is therefore **revoke the passkey in the PWA (Accounts →
Passkeys → Revoke) first, then rotate the passphrase**. `rm ~/.ccrc/passkeys.json`
on a running server revokes nothing — the store is loaded once at boot and
rewritten from memory on the next accepted assertion.

**Two boot warnings worth knowing**, because each catches a misconfiguration
that is otherwise silent: an `rpId`/`origin` pair that disagrees, is malformed,
or is an IP literal (passkeys go 501, the passphrase door keeps working); and a
cookie policy that contradicts the origin's scheme — an `http:` `CCRC_ORIGIN`
with a `Secure` cookie, which produces a login that answers 204 and bounces
straight back to the login screen with nothing failing anywhere, or an `https:`
one with the dev opt-out left on.

**`ccrc doctor`'s `auth` check** reports where a box actually stands: a PASS on
an un-armed box (that is the shipped default, and a doctor that warned about it
would train an operator to skim), a FAIL on an armed box with no passphrase
file, and a FAIL on a passphrase file the server would refuse to boot on. It
prints no byte of the file's contents, and neither does the server's own boot
refusal.

## The box decides `--remote-control`: `~/.ccrc/remote-control`

Per-box runtime config, under the same ownership rule as the account roster
`~/.ccrc/accounts.json` ("Accounts" below): **one line**, `on` or `off`,
created once by whichever lane installed the box and never rewritten after.

| Lane | Seeds | Why that value |
|---|---|---|
| `ccrc install` (`_inst_rc`) | `off` | `--remote-control` publishes a session to claude.ai; a fresh single-box install has made no such claim and must not start because an installer defaulted it |
| `deploy/deploy.sh agent` | `on` | a box that was already running every session with the flag; seeding `on` **describes** that box rather than deciding something new about it |

`ccd`'s `_rc_enabled` is the only reader and the authority: first line,
whitespace stripped, must be exactly `on`; **absent, unreadable, empty or
anything else is off**, because a garbled file must not half-enable a mode. That
strictness includes a missing trailing newline (bash's `read` returns non-zero
at EOF-before-delimiter), so `printf 'on' > ~/.ccrc/remote-control` reads as
**off** — both writers end the line, and `ccrc doctor`'s **`rc`** check names
that case as `PASS rc: off (unparseable …)` rather than reporting it as a
deliberate `off`.

The box decides for **ordinary** sessions only. A dispatched program worker is
declared `--no-rc` at `ws-add` by the server's dispatch path (the 2026-08-13
ruling, orchestrator task #37): `ccd ws-add --no-rc` stamps the per-session
registry field `rc` as `off`, and `_spawn_start`'s consult then strips
`--remote-control` from that session's every spawn — across swap and every
`Restart=always` cycle — no matter what the box flag says. Absent, or anything
but the exact string `off`, follows the box: the field can only ever suppress,
never enable, and it dies with the row at reap. The PWA's ordinary
workspace-add composes no flag and stays box-default, and the doctor's `rc`
check keeps reporting the box flag alone.

The LANE is the third suppressor (2026-09-07): a session that lands on an
account the roster marks `homeAble: false` — an overflow lane such as the
ChatGPT/Codex launcher, which holds no claude.ai OAuth and runs Claude Code in
token mode against a local proxy — spawns without `--remote-control` whatever
the box flag and the row say, because Remote Control needs a claude.ai token
with the inference scope and that lane cannot present one. The flag returns on
the next spawn back on a home-able account. So a session that is not driveable
from the PWA while it sits on the overflow lane is behaving as designed, not
misconfigured.

`rc` is a check of its own, deliberately: it reads the flag file and nothing
else — no `ccrc.env`, no unit files, no box role — so it answers on a **fleet
host**, which has no `ccrc.env` at all and is the one box in the topology that
runs `on`. It is always a PASS: the state is a fact about how the box is
configured, not a defect, and this doctor's rule is that a WARN owes a remedy.

**Ordering, on a fleet host:** the flag must be seeded *before* a new `ccd`
lands, because absent reads off and the gap between the two is a window in which
a respawn strips `--remote-control` from a live session. `deploy.sh` seeds it in
the same run, above its own installs, and `agent/test/deploy-verify.test.ts`
pins that order.

## Accounts: usage, placement and the disabled marker

### The roster is runtime data: `~/.ccrc/accounts.json`

**The account list is not in the code.** It is a JSON file on each box, and
without it neither half of ccrc runs:

| File | Owner | Read by | Missing ⇒ |
|---|---|---|---|
| `~/.ccrc/accounts.json` | **you** — ccrc creates it once and never overwrites it | the server, at boot (`loadConfig` → `loadRoster`, `server/src/config.ts`) | the server **refuses to boot** (`RosterError`, naming the remedy) rather than run against a roster that is not the box's |
| `~/.ccrc/accounts.sh` | **ccrc** — regenerated and replaced wholesale by every agent deploy | `ccd` on **every invocation**, plus `install-session-hooks.sh` and `install-coordinator-skill.sh` | `ccd` dies (`ccd: no account roster at …`) and both installers `exit 1` |

`accounts.sh` is a pure projection of `accounts.json` — `deploy/gen-accounts.mjs`
produces it (`CCRC_ACCOUNTS`, `CCRC_HOME_ABLE`, `CCRC_MEASURED`,
`CCRC_ANTHROPIC_BACKEND`, `CCRC_SUBAGENT_CLASSES`, `CCRC_CODEX_BACKEND`,
`CCRC_UPSTREAM`, `_ccrc_cfg_dir`, `_ccrc_id_wrapper`, `_ccrc_dir_id`,
`_ccrc_label`, `_ccrc_hue`, `_ccrc_pool` — the whole emitted surface, because a
field the projection drops is a field no drift detector can see), and the
deploy generates it from the
roster **read back off the box**, never from the local file, so ccd's routing
can never disagree with what the server serves from that same box's copy.
Nothing hand-edits it; a torn one would take out every live session at once,
which is why it lands via the same atomic scp-to-temp + `mv` as `ccd` itself,
and lands **before** `ccd` and before both installers.

An account entry is `{id, label, configDirSuffix, exec, homeAble, hue, telemetry,
hidden, pool}` — validated by `shared/roster.ts` (`parseRoster`), whose errors all
carry a remedy. `id` is `^[a-z][a-z0-9-]{0,31}$` because it becomes a filename
under `~/.local/bin/`, a bash `case` pattern and a session-id prefix; `label` is
what the PWA renders; `homeAble: false` holds an account out of automatic
placement and out of being any session's default home, while leaving it in the
auto-swap rotation as an **overflow lane** — a LAST RESORT, chosen only when no
home-able account survives the rotation's whole filter, never merely because it
scored better — for as long as it is installed and not kill-switched.
`touch ~/.cc-sessions/<id>-disabled` is the per-lane brake, and a session that
overflowed onto it returns home when home has headroom again *and* home is still
servable for the project's pool;
`telemetry: 'none'` says the account will never report rate limits,
so its permanent unknown is not read as permanent emptiness; `hidden: true`
declares the entry to be roster PLUMBING rather than one of your accounts — the
`upstream` entry naming the binary every generated wrapper `exec`s — so no
surface presents it as an account you hold; and `pool` is an optional pool name
carrying `id`'s own grammar, which is the account half of the rule "Account
pools" below states in full. The two keys this section adds are optional, and
both default to the old behaviour when absent: `hidden` to `false`, `pool` to
untagged, which means unconstrained. (`hue` is the roster's third optional key —
left out, `assignHues` picks one.)

Both clauses above were unconditional until account pools shipped, and neither is
any more (D-1911; the ruled behaviour named below is D-1908, and this file still
owes account pools a section of its own — D-1918). The rotation's filter is the pool rule, then the kill-switch, then
headroom — so the home-able bracket can empty with every account perfectly
healthy, simply because they are in another pool; and the return home is
pool-gated, so a session whose home is in the wrong pool is re-homed rather than
returned. One consequence is worth stating plainly because it looks like a bug:
an account with **no** pool tag is servable for every pool, so an untagged
overflow lane can be chosen while healthy tagged accounts sit refused. That is
ruled behaviour, and such a move is deliberately **not** recorded as a pool
crossing — nothing was overridden, because nothing constrained it.

`exec` says how ccrc reaches the account's binary, and it carries the account's
connection: `{kind: 'upstream' | 'generated' | 'external', secretsFile?,
provider?, baseUrl?, models?}`. `secretsFile` is legal on all three kinds — on a
`generated` account it is the 0600 file ccrc writes and the wrapper sources; on
the other two it is DECLARATIVE, naming the file somebody else's launcher
sources so `ccrc doctor` can say whether it exists without ever opening it.
`provider` is one of `anthropic`, `openrouter`, `compatible`, `openai`
(`shared/providers.ts`, the only file that enumerates them); it is required on
`generated` and defaults to `anthropic` with one warning per parse, optional on
`external` where absent means *undeclared*, and not spelled on `upstream`.
`baseUrl` is the endpoint the lane talks to — `https:`, or `http:` on
`127.0.0.1`, `[::1]` or `localhost`, with no `user:password`, no query string
and no fragment — required when `provider` is `compatible`, which ships no
default. `models` is the api-key lane's four-alias routing map plus an optional
`selectable` allowlist, and is legal only where the provider table says a lane
has one.

**Two validators, one roster, and neither may be laxer.** `shared/roster.ts`'s
`parseRoster` runs in the server, which refuses to boot on a roster it rejects.
`shared/roster-json.mjs`'s `rosterFromJson` runs under a bare `node` in the
deploy path, which cannot import TypeScript — so it re-implements the same
checks, with ONE exception it now imports instead (`BASE_URL_OK`, from
`shared/base-url.mjs`, because a stricter endpoint gate on the deploy side
refuses a roster the server boots on), and its header states the asymmetry the
rest live by: they may be STRICTER, never laxer. A roster it wrongly rejects
fails a deploy loudly; a roster it wrongly accepts regenerates a box's
`accounts.sh` and wrappers and then leaves the server unable to start.
`server/test/gen-accounts.test.ts` is the mechanism: one direction compares the
two implementations' generated bash byte for byte, the other asserts that every
roster `parseRoster` throws on is refused by the CLI too.

#### What the parser and the mirror each check

| field | parser rule | mirror line | `gen-accounts.test.ts` CASES row |
|---|---|---|---|
| `hidden` | `non-boolean hidden` — optional, but a present value must be a boolean | `non-boolean hidden` | “a non-boolean hidden” |
| `exec.secretsFile` | `SECRETS_SAFE_RE`, no leading `/`, no `..`, no trailing `/` — on all three kinds | `SECRETS_SAFE_RE` | “an absolute EXTERNAL secretsFile” |
| `exec.provider` | `isProviderId`, defaulted to `anthropic` on `generated` | `PROVIDER_IDS` | “an unknown exec.provider on a generated account” |
| `exec.baseUrl` | `BASE_URL_OK`, and `base-url-required` where the provider ships no default | imported — `BASE_URL_OK` from `./base-url.mjs`, the one rule this file does not re-spell | “an unparseable exec.baseUrl” |
| `exec.models` | `MODEL_ID_RE` over four required aliases, plus `selectable` containment | `MODEL_ID_RE` | “exec.models missing the subagent alias” |

Each row is resolved against the three files it names by
`server/test/readme-roster-mirror.test.ts`, so a gate deleted from either
validator reds this table as well as the suite that owns it — the same treatment
`readme-holds.test.ts` gives the holds paragraph, and for the reason its header
records: prose that was true when written is the kind an operator acts on after
it stops being true.

**Getting the file onto a box.** The deploy seeds it, create-if-missing, on
both targets:

```bash
bash deploy/deploy.sh agent <host>   # seeds ~/.ccrc/accounts.json if absent, then generates + ships accounts.sh
CCRC_ACCOUNTS_JSON=deploy/accounts.default.json bash deploy/deploy.sh   # seed a fresh, unrelated install instead
bash ccd/ccrc-adopt                  # a HAND-BUILT box: rediscover its accounts from ~/.local/bin and write accounts.json
ccrc wrappers                        # the other direction: roster → ~/.local/bin/<id>, writing only what ccrc marked as its own
```

- `deploy/accounts.default.json` is the roster a fresh install starts from: a
  single account, no generated wrappers. `CCRC_ACCOUNTS_JSON` points the deploy
  at a roster of your own — and the deploy validates that file
  **locally, before seeding it**, because a seeded roster is never overwritten
  again and a bad one would have to be deleted by hand over ssh.
- `ccd/ccrc-adopt` goes the other direction — disk → roster — for a box built
  before this file existed as a concept. It reads `~/.local/bin`, classifies
  each wrapper (`upstream` / `generated` / `external`, every uncertain call
  landing on `external`), and writes `~/.ccrc/accounts.json` only if absent
  (`--force` to overwrite, `--out` to write elsewhere). It writes nothing else:
  no wrappers, no units, no hooks. On a box that has never run `ccrc install`
  there is no installed `ccrc` binary yet, so it runs from the checkout, as
  `bash ccd/ccrc-adopt`; on an installed box it is reachable as `ccrc adopt`.

  **The upstream account may be a launcher script (D-155).** Adopt elects the
  upstream by counting which binary the generated wrappers `exec`, and it used
  to refuse the winner if the file started with `#!`. That was a proxy for the
  hazard it actually meant to catch — electing an *account wrapper*, which would
  leave those wrappers exec'ing a wrapper — and the proxy stopped tracking the
  hazard the day a box's `~/.local/bin/claude` became a version-picking,
  token-injecting launcher instead of the installer's symlink. It now asks the
  real question: the elected upstream is refused if it sets its own
  `CLAUDE_CONFIG_DIR`. This is not one box's quirk — an npm- or mise-installed
  Claude Code lands a `#!` shim at the same path.
- `ccrc wrappers` goes roster → disk, and is the reason `accounts.json` now
  PRODUCES `~/.local/bin/<id>` rather than merely describing it. **It writes
  only the wrappers ccrc marked as its own** (`shared/mark.mjs`'s provenance
  marker) **and refuses everything else, with a remedy** — a hand-edited
  wrapper, somebody's bespoke launcher, a file it could not read. It backs up
  before every overwrite (`<id>.pre-ccrc-<UTC>`, a name no account id can
  match) and writes atomically. `upstream` and `external` accounts are never
  written, backed up, moved or removed, under any flag. `--dry-run` reports
  without touching anything; `--adopt` takes over a hand-written wrapper that
  already says exactly what the roster says; `--force` overwrites ccrc's own
  edited files and, after a backup, any foreign file **that this reader can
  parse as a wrapper** under a generated id. Orphans — a marked wrapper the
  roster no longer names — are reported and never removed.

  **Four things no flag overrides:** `unreadable`; `oversize` (D-81); a foreign
  file this reader cannot parse as a wrapper at all (D-155); and any id that
  another file already on disk `exec`s as its upstream binary (D-156, "lock 5").
  The last two exist because the sentence above about `upstream` accounts is
  conditional on the ROSTER, not on the path: it holds while the roster says
  which id is upstream, and a mis-edited roster is internally consistent, so
  every other lock believes it. Measured on the reference box — where
  `~/.local/bin/claude` is a launcher script rather than the installer's symlink
  — flipping that id to `generated` and running `ccrc wrappers --force`
  overwrote the launcher and exited 0, closing an exec loop across every lane at
  once. And `--force` was never the only route: obeying ccrc's own "move it
  aside and re-run" remedy makes the path `absent`, which the absent arm writes
  with no flag at all. Lock 5 is keyed on the OTHER files precisely so that
  moving the subject file away does not defeat it.
- `CCRC_ACCOUNTS` (in `~/.ccrc/ccrc.env`) overrides where the **server** reads
  the roster from. `ccd` has no such override on purpose: it derives the path
  from `HOME` alone, so a stray `Environment=` cannot run a live box against
  someone else's account list.
- **The two boxes are checked against each other, continuously.** `accounts.json`
  is user-owned and never overwritten, and the boxes are deployed by two
  separate runs of `deploy.sh` — so an account added to one and not the other is
  one hand-edit away, and the symptom (a session attributed to the wrong
  account, a swap target ccd rejects) names nothing. The agent reports a
  fingerprint of its **installed `~/.ccrc/accounts.sh`** on the `ready` frame;
  the server compares it against the fingerprint of the projection its own
  roster produces, and `GET /api/fleet/health` answers
  `roster: 'agreed' | 'divergent' | 'unknown'`. The PWA shows an amber banner on
  `divergent` and nothing on `unknown` — an older agent sends no fingerprint,
  and absence of evidence must not render as evidence of absence.

  It compares the **projections**, not the two JSON files, which catches
  strictly more: a fleet host whose `accounts.json` was hand-edited but never
  redeployed has two files that agree and a `ccd` that behaves like neither,
  because `ccd` sources the generated `accounts.sh` and nothing reads
  `accounts.json` at runtime. Each `deploy.sh` run also prints
  `roster fingerprint on <box>: <sha256>`, which is the same value — that line
  is the only signal in the agent-only and single-box cases, where there is no
  server on the other end of a socket to disagree with.

  Digesting the PROJECTION rather than the JSON also decides, per key, whether a
  cross-box disagreement is visible at all, and the two optional keys fall on
  opposite sides. `pool` is **inside** the digest: `_ccrc_pool` is emitted for
  every tagged account, so two boxes whose pools disagree read `divergent` and
  the banner's existing remedy is the right one. `hidden` is **outside** it:
  nothing in `accounts.sh` carries that key, so two copies that disagree about
  `hidden` project byte-identical bash and report `agreed` — the same gap
  `exec.secretsFile` and a `generated`/`external` `exec.kind` sit in (an
  `upstream` flip is visible, because it moves `CCRC_UPSTREAM`), and the reason `ccrc doctor`'s
  wrapper check rather than the fingerprint is what catches those. Between the
  two lanes of one agent-first deploy that changes pools, `divergent` is
  EXPECTED for the minutes in between, and the deploy says so as it runs.

- **Limit telemetry is roster-driven too**, which is what makes free-form ids
  real rather than half-delivered. `ccd/statusline-command.sh` is a Claude Code
  statusline hook — it is handed a `CLAUDE_CONFIG_DIR` and nothing else — so it
  sources `~/.ccrc/accounts.sh` and asks it four questions: `_ccrc_dir_id`
  (which account owns this config dir), `_ccrc_label` and `_ccrc_hue` (how to
  name and colour it), and `CCRC_MEASURED` (whether it reports rate limits at
  all — `gpt` does not, and a `~/.cc-limits/gpt.json` would be
  indistinguishable from a measured zero). One copy of the script serves every
  account, because `$HOME` is shared and only `CLAUDE_CONFIG_DIR` differs.
  A box with no roster still renders a status bar; it just falls back to the
  config dir's own name and writes no telemetry.

  This was the last hand-written roster copy in the tree, and it mattered:
  an account its four `case` arms did not name was **never measured**, and
  since an unmeasured account ranks below every measured one for placement
  (stage 2a's "unknown is not zero" fix in `projectHome`,
  `server/src/limits.ts` — an account nobody could see used to score 0 and
  beat every real one), such an account would never receive a workspace,
  silently and permanently. `server/test/statusline-script.test.ts` runs the
  real script against a fixture `HOME` with a free-form account and goes red
  if the map ever comes back.

**`/accounts`** (a fourth branch of the route ternary, reached by tapping the
compact `AccountsStrip` mounted in the desktop top bar and the mobile fleet
list) shows every account ccd knows about, not just the ones with headroom.
It rides the existing `GET /api/accounts` pipeline — no new route, no new
whitelist grant — with its own 20 s poller. Per account:

- Both windows (5h / 7d) as bars with the strip's exact `%`/`reset`/`—`
  three-way, never collapsed: `reset` means the window ended and the zero is
  *inferred* from the reset timestamp; a measured `0%` means something ran
  and the account really is empty; `—` means nothing has ever been measured.
- A freshness line, **"last reported *age*"**. Telemetry is a byproduct of a
  session rendering its statusline, so an idle account simply stops
  reporting — the screen reads as "last known", never as live. There is no
  refresh button: there is nothing to refresh until a session runs.
- A disabled lane (`~/.cc-sessions/<wrapper>-disabled` present) renders
  **greyed with "disabled on the fleet host" — shown as switched off, never
  hidden.** The compact strip still hides a disabled lane entirely (right for
  an always-on bar); the screen's whole job is "show me my accounts", so
  hiding one here would be the wrong call in the other direction.
- Live sessions whose `wrapper` matches the account, each tapping through to
  `/s/<id>`.
- A projection line naming ccd's own placement rule ("next workspace lands
  here — least-loaded"), including the all-disabled case below.

Band coloring uses one writer (`limitBand` from `LimitBar.tsx`) everywhere,
including the strip: `crit` is `> 75`, matching `DIRECTION.md`, not `>= 75` —
the strip used to carry its own copy of the threshold and disagreed with the
limits bar at exactly 75.

### Placement honors the disabled marker

`~/.cc-sessions/<wrapper>-disabled` used to be a **UI-only** kill-switch:
`server/src/limits.ts` parsed it for every lane, but ccd itself honored it
for exactly one (`gpt`, via `_gpt_enabled`) — `touch`ing it for any other
wrapper hid the account from every picker and changed nothing about where
ccd actually placed sessions. ccd now generalizes the check:

- `_lane_enabled <w>` — true iff `~/.cc-sessions/<w>-disabled` is absent.
- `_account_ok <w>` — true iff the wrapper is executable **and** its lane is
  enabled. `_gpt_enabled` is now just `_account_ok gpt`, same file, same
  semantics, one definition.

Both of ccd's automatic pickers gate on `_account_ok`: `_ws_least_loaded`
(`ws-add`'s placement rule) skips a disabled or missing lane outright, and
`_swap_target`'s candidate loop does the same, as does its "home recovered,
go back" branch — a session never auto-rotates back onto a home that has
since been disabled. **The two "stay put" branches are unchanged on
purpose**: disabled excludes a lane as a *destination*; it never evacuates a
session already sitting there. Manual placement (`ccd start`, `ccd swap`,
`ccd prefer`) overrides the **disabled** gate — naming a wrapper by hand is an
operator override by construction — but it is not a blanket override of every
placement rule, because all three verbs refuse a target whose pool disagrees
with the project's unless you pass `--cross-pool` (see "Account pools" below).
One correction to that override: `ccd
start` no longer **rewrites** an existing row's account. For an id that
already has a registry entry, the registry's own `wrapper` wins and a
differing argument is only a warning naming the verb that would actually move
it (`ccd swap`); `ccd swap` stays the only verb that moves a session between
accounts. `ccd start <id>` and `ccd enable <id>` also take a one-argument
form now, for exactly the reason this matters: a session keeps the id it was
born with across every swap, so an operator reading the account off the board
and typing it back into the two-argument form used to mint a *second* id for
a session that already existed — the one-argument form takes the existing
row's id whole and starts it under whichever account the registry says it is
actually on.

**Pressure alone still never refuses placement** — a fully pinned account is
still the least-bad choice, and the headroom display is the warning, not a
refusal. Only the declared marker excludes. But if *every* wrapper fails
`_account_ok`, `ws-add` refuses **before creating anything** — no worktree,
no branch, no registry entry — naming each wrapper and why (`disabled` or
`missing`): `die "no account available for placement — …; nothing was
touched"`.

That refusal only covers the *declared* case. The score itself still has the
opposite polarity for the undeclared one, and this rider does not touch it:
`_limit_field` zeroes any sample whose window has run out — a `five` older
than 18000s, a `seven` older than 604800s, or either past its own
`resetAt` — and `_limit_score` returns `""` when a wrapper has no limits
file at all, which `_ws_least_loaded` and `_swap_target` both fold to `0`.
Zero is the *lowest* score either picker compares, so an account nobody has
heard from in a week — no file, or a sample its own window has outlived —
reads as maximum headroom and is placed **first**, not skipped. No
telemetry still reads as free for *pressure*; only the declared marker
excludes. The accounts screen's "last reported *age*" line is the only
signal that the "least-loaded" pick landed there because it is healthy
rather than because it has gone quiet; nothing short of the operator reading
that line and `touch`ing `-disabled` stops it.

The server mirrors only the half it can honestly see. `projectHome` filters
`disabled` lanes before scoring, and returns `null` when every home-able
lane is excluded — `ProjectedHome | null` on the wire (`GET /api/accounts`'s
`projected` field), rather than inventing a target. It cannot see `-x`: the
server has no filesystem authority over `~/.local/bin`, so a projection can
still name an account whose binary is gone. **ccd's refusal at `ws-add` is
the authority; the server's projection is a best-effort forecast of it.**
Kept in lockstep with the bash by the shared fixture harness
(`server/test/fixtures/leastLoaded.ts`, run against both implementations).

There is **no login detection** — no passive filesystem signal reliably
distinguishes a logged-in account from a logged-out one on this box, and a
probe-based check was rejected (spends tokens, races real logins). The
`-disabled` marker is a *declared* fact the operator sets by hand
(`touch`/`rm`), not a detected one.

### Account pools: tagging a project to a set of accounts

**The rule, once.** An account carries an optional pool name; a project carries
an optional pool name; an account may serve a project when either side is
untagged or the two names are equal. That is the whole policy. An account is
tagged in `~/.ccrc/accounts.json` (`"pool": "pool-a"`, carrying `id`'s grammar);
a project is tagged by a one-token file at `~/.cc-sessions/pools/<project>` on
the fleet host. **Untagged means unconstrained** — every account and every
project starts untagged, and tagging only ever tightens, so nothing on the box
behaves differently until you tag something.

**`ccd` decides; the server refuses and forecasts.** Every place ccd chooses an
account applies the rule: `ws-add`'s placement, the 5 s auto-swap tick, and the
manual verbs. The server reads the same file through the agent and uses it for
three things — refusing a swap or a create it can already see is wrong
(`409 pool-mismatch`, or `503` when the tag cannot be read), forecasting where
the next workspace would land, and composing the pool state every PWA surface
renders. It never places a session and it never writes the marker itself — the
phone's tap runs `ccd project-pool` on the fleet box, and the agent's write root
is unchanged.

**Tagging.** From the phone: tap a project card and pick a pool. The list is
derived from the pools your accounts actually carry — inventing a brand-new name
is a shell act, deliberately, because a pool with no account in it is the
shortest path to a stranded session. From a shell on the fleet host:

```bash
ccd project-pool --project demo --pool pool-a   # tag
ccd project-pool --project demo --clear         # untag; always allowed, even for a deleted project
echo pool-a > ~/.cc-sessions/pools/demo         # the 2 am idiom; the trailing newline is stripped
ls ~/.cc-sessions/pools/                        # every tag on the box, in one listing
```

The file holds one token matching `^[a-z][a-z0-9-]{0,31}$`, and the reader
answers one of four words — `named <n>` for a usable tag, `untagged` when there
is no file at all, `malformed` for a file whose contents are not one legal token,
and `unreadable` when the reader cannot decide at all. Read that last one
carefully: four of its six arms are DIRECTORY-level — an unsearchable `$REG`, a
`pools/` that is a dangling symlink, not a directory, or not searchable — and
they fire while the project's own tag file is perfectly good, so `chmod 0600
~/.cc-sessions/pools` reads `unreadable` for every project on the box. The remedy
is on the directory, not on the file.
Anything but that token — two words, an uppercase letter, a directory in its
place, a file the reader cannot open — is `malformed` or `unreadable`, and
**neither is ever quietly downgraded to untagged**: on a tag nobody can read,
nobody decides. Creation refuses naming
the path, the auto-swapper holds where it is, and the server answers 503. A
typo strands one project, which is the point of one file per project.

**Why the tag lives there.** `~/.cc-sessions/pools/<project>` is a dotless
subdirectory of the registry, beside the switches you already touch by hand
(`<wrapper>-disabled`, `coordinator-paused`). Two other homes were designed in
full and rejected. Inside the project's own checkout (`<project>/.ccrc/pool`)
puts policy in the tree every session runs in: one `git clean -fdx` deletes it
and the project silently reverts to unconstrained, and one `git add -A` commits
a pool name into a public repository. One JSON document for every project
(`~/.ccrc/projects.json`) makes a single hand-typed trailing comma unreadable
for *every* project at once — no placement and no rescue anywhere on the box
until somebody fixes it. `$REG/<project>.pool` was not an option either: session
ids are `<wrapper>-<project>`, so tagging a project named `acct-a-demo` would be
writing session `acct-a-demo`'s own registry field.

**What the tag outlives.** Nothing that cleans up a workspace touches it —
`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`/`ws-restore` and `forget` never name
`pools/` — so a project's tag survives every one of its sessions and workspaces.
It is operator intent, not session state. `ccrc uninstall` leaves it too, like
the `-disabled` markers and the rest of the registry's operator switches. And
like every other marker it is **not backed up**: the backup set is ccd, the
units, the served dists, coord.db, `~/.ccrc/memory` and the two `~/.cc-sessions`
scripts — never `~/.cc-sessions` markers. A box rebuilt from a backup comes back
untagged, which is to say unconstrained, and nothing says which: the PWA shows
the same `no pool` chip it shows a project that was never tagged.

**Retagging a running project, and when it takes effect.** A retag is not a
restart. Within one 5 s tick, every session of that project whose *home* account
is out of pool is re-seeded to an in-pool home (a `rehome` line in `swap.log`
and a `rehome` act in the lifecycle journal), and every session whose *current*
account is out of pool becomes a must-leave. When it actually moves is the part
worth knowing: the move goes through the same two gates every auto-swap does —
`SWAP_COOLDOWN`, 900 s since that session's last landed swap, and
`SWAPBLOCK_COOLDOWN`, 1800 s since a refused one — so a session that swapped in
the last quarter hour keeps running on the wrong-pool account until its gate
opens, and then goes with an `auto-pool` line. Two sessions do not wait:
a hard-blocked one takes the rescue arm immediately, and a session under a
program hold does not move *at all* until it is released — a retag never breaks
a hold. The visible waiting state is `data-offpool` on the session row: the
account chip says this session is running in one pool while its project is in
another, which is exactly true, and reads as "queued", not "stuck". Retagging
deliberately does not bypass `SWAP_COOLDOWN`; that gate exists to stop a swap
storm and a retag is not a good reason to reopen one.

**An empty pool strands, loudly.** When a session is hard-blocked and no account
in its pool can take it, ccd **stays in the pool** and makes the state visible
rather than crossing out of it: a `stranded` line in `swap.log` naming each
candidate and the first reason it failed (`pool=…`, `disabled`, `missing`,
`limit`), a marker on the row, one notify banner (`cc swap STRANDED: …`, floored
to one per 1800 s so a scrolling limit banner cannot storm it), a stranded cell
on the session row and an `N stranded` count on the project card. Three
remedies, all yours: enable a lane in that pool (`rm
~/.cc-sessions/<wrapper>-disabled`), tag another account into the pool, or untag
the project (`ccd project-pool --project <p> --clear`). Nothing stamps a
cooldown, so recovery needs no further action — the first tick on which an
in-pool account has room rescues the session and writes `unstranded`. This also
made an **older** silence loud: a hard-blocked session with every account at
ceiling used to retry every 5 s forever with no marker and no log line, and it
does not any more, tagged project or not.

**Crossing on purpose: `--cross-pool`, which is not `--force`.** `--force` means
one thing and still means only that — accept the transcript loss a swap costs. A
crossing is a different decision, so it takes its own flag on `ccd swap`, `ccd
start`, `ccd enable` and `ccd prefer`, and the two compose. From the PWA the
mismatched accounts sit behind a **show other pools** disclosure in the swap
sheet, and picking one there is what sets the flag; a plain pick posts the body
it always did, and a mismatch comes back `409` with the sentence naming both
pools. Every crossing writes a per-session marker, and that marker is what stops
the pool machinery undoing the crossing on the next tick. What each verb ADDS to
that marker differs, which matters if you audit crossings from one record rather
than the other: `swap --cross-pool` writes BOTH a `cross-pool` line in `swap.log`
and a `dec.crosspool` act in the lifecycle journal; `prefer --cross-pool` writes
the journal act and no log line; `start --cross-pool` writes the marker alone. It is deliberately narrow. `swap --cross-pool` moves the session and
leaves its home alone, so when home recovers the session returns home exactly as
it does after any manual swap today — and that return is a move off the crossed
account, which ends the crossing (`crosspool-ended`). To stay crossed through a
home recovery, move the home: `ccd prefer --cross-pool`. **Automatic moves never
cross**, marker or no marker: the candidate loop stays pool-filtered in every
case.

**Deploy order, and what half-deployed looks like.** Pools touch `ccd/`, so the
fleet host goes first — `bash deploy/deploy.sh agent <host>`, then `bash
deploy/deploy.sh`.

| State | What you see |
|---|---|
| New server, old `ccd` | Tags display but nothing on the fleet enforces them: the chips dim, the fleet banner says the fleet host's ccd does not honour project pools yet, the tag route answers `501` and so does a cross-pool tap. The server's own refusal still stands — a mismatched swap gets `409`, so this state produces refusals, never wrong placements. |
| New `ccd`, old server | The fleet enforces everywhere and strands loudly; the PWA has no override yet, so a mismatched swap dies inside ccd and surfaces as a `502` carrying ccd's own sentence. |
| New `ccd`, old `accounts.sh` | Every account reads untagged — today's behaviour, no noise. |
| Mid-deploy, one deploy long | New placements and manual verbs bind the rule at once; each running session's auto-swapper is still the pre-deploy code until its unit restarts, and a refusal inside a dispatch from the NEW ccd marks a strand; one dispatched by a still-running pre-deploy supervisor refuses silently until the `claude-session@*` unit sweep restarts it. |
| The two `accounts.json` copies disagree | `roster: 'divergent'` and the amber banner. ccd obeys the fleet host's copy and the server refuses by its own, so a disagreement is loud in both directions rather than silently permissive. The project tag has one copy and cannot skew at all. |

**Rolling it out.** Nothing changes until something is tagged, and every step is
reversible by untagging.

1. **Ship the code with nothing tagged.** Agent lane first, then the server. Zero
   behaviour change: every account untagged, `pools/` absent. Expect
   `roster: 'divergent'` between the two lanes; it clears on the second deploy.
2. **Tag accounts.** Edit `~/.ccrc/accounts.json` on both boxes and redeploy both
   lanes. Still no behaviour change — no project is tagged yet, so the rule
   permits everything.
3. **Check the pools exist.** `ccrc doctor`'s `pools` check passes,
   `GET /api/accounts` shows a `pool` per account, and the pool sheet lists the
   names you expect.
4. **Tag projects one at a time**, starting with one whose pool has headroom.
   Watch `swap.log` for `rehome`, `auto-pool` and `auto-rescue`, and the cards
   for `N stranded`.
5. **Expect strands where a pool is thin.** A pool of one or two accounts, both
   at ceiling, strands its hard-blocked sessions instead of crossing. That is
   the design working, not a fault; the banner names the three remedies.
6. **Rollback** is `ccd project-pool --project <p> --clear` — nothing moves,
   because untagged is unconstrained. For the account side, remove the `pool`
   keys and redeploy agent-first. The per-session pool fields purge with their
   registry rows and are harmless if left behind.

### Login screens get no keystrokes, and lost auth joins the rescue lane

A session spawned onto a broken account used to spin its full ~15-minute
startup window, return with no diagnostic, and then type `/effort ultracode`
+ Enter **into the login screen** — an unreviewed keystroke into an auth
flow. `_accept_first_run_prompts` now recognizes a login screen (`Select
login method`, `Invalid API key`, `Please run /login`) as its **last**
check, after every ready-marker and startup gate, and returns a distinct
code instead of a silent success; `_spawn` skips the `/effort` injection on
that code, so no synthesized keystroke reaches an auth prompt. Instead it
warns, naming the session **and** the account (`_accept_first_run_prompts`
only ever sees the tmux name, so `_spawn` is what emits this, once it has
both back): `<id> is waiting for login on <wrapper> — attach and run
/login`.

The startup verdict is six-valued now, not the one non-zero code above: `0`
a live marker appeared, `2` a login screen (unchanged, above), `3` the tmux
session vanished mid-poll, `4` the window expired with no marker, `5` a hard block (a limit/spend banner or lost auth), `6` a live pane too narrow to read (or of unreadable width), so the startup gates stood down. `3` ends
the wait **immediately** — a debounced second probe, not the ~15-minute wait
a vanished pane used to cost. Every verdict, success included, is recorded in
`$REG/<id>.spawn` as `<epoch> <rc>`, which is the one channel from a spawn
that happened inside the supervisor unit to a `ccd start` polling from
another process. The unit's `StartLimitIntervalSec`/`StartLimitBurst` turn an
instant-death restart loop into a **failed** unit rather than a silent
crash-loop — a failed unit heartbeats nothing, so it reads as `orphan` on the
row, and `ccd start <id>` (which runs `reset-failed` before it re-enables the
unit) is what revives it.

Mid-session auth loss joins the same rescue lane a 429 uses: the
hard-blocked pane grep that drives `_auto_swap_check`'s emergency swap now
also matches `Invalid API key` and `Please run /login` — a session that
*was* working and lost auth evacuates immediately, exactly like a rate
limit. **`Select login method` deliberately stays out of that grep** — that
screen appears during an intentional operator login, and evacuating a
session out from under someone mid-login would be wrong; that screen is the
one case `_accept_first_run_prompts`'s login check owns instead, by warning
and stopping rather than swapping.

### A restart re-drives the turn it interrupted (D-2226)

A usage-limit rescue is a `ccd swap`: the unit stops, the transcript is carried, the destination
runs `<wrapper> --resume '<uuid>'`. Claude Code's own recovery for a limit — "Usage limit reached ·
continuing automatically at HH:MM" — is an in-memory timer and dies with the old process. On the
resume, Claude Code writes a META "Continue from where you left off." and a synthetic "No response
requested." and submits the prompt **only** when `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is set.
Before 2026-09-09 ccd never set it, so every rescue landed idle until a human typed (spec
`docs/superpowers/specs/2026-09-09-post-swap-redrive-design.md`, four of four sessions measured).

Now, on every spawn, `_spawn_start` exports that flag plus a ccd-authored `CLAUDE_CODE_RESUME_PROMPT`
(`RESUME_PROMPT`, telling the model its previous process and every background task it owned are
gone). Because the flag is a third-party default, `_spawn_settle` **measures** the landing:
`_transcript_stalled_pair` reads the transcript tail, and if the newest real turn is still that
unsubmitted pair after `REDRIVE_WAIT_S`, `_redrive_after_spawn` types the prompt itself and writes
`redrive <id>: …` to `swap.log` (`redrive-skip` when the box holds a draft, the pane is
hard-blocked, or an auto-continue is armed). Hookstate is not the measurement: `working` proves tool
calls, not that the re-drive took.

The one thing ccd must never do is cancel Claude Code's armed auto-continue with a keystroke.
`_pane_auto_continue_armed` ("continuing automatically" / "continuing shortly") gates the compactor
(`compact-skip <id>: auto-continue`), the `/effort` injection, and the fallback re-drive. The rescue
arm is deliberately **not** gated: a swap that re-drives beats waiting out the window. On the PWA the
pair renders as two system lines, the second reading "interrupted turn not re-driven — send a
message to resume"; the server parser keys on the structural markers — `isMeta` for the prompt
line, `message.model === '<synthetic>'` for the padding — each narrowed by the exact sentence
(`RESUME_PROMPT_PREFIX` / `NO_RESPONSE_TEXT`, `shared/api.ts`); ccd's `RESUME_PROMPT` must keep
starting with that prefix, and nothing scans for it.

### A limit is measured on the transcript, and Claude Code's own recovery is left alone (D-2360–D-2370)

The follow-ups to the restart re-drive, measured on 2026-09-10 after 53 landings
(`docs/superpowers/specs/2026-09-10-limit-recovery-followups-design.md`):

- **A stale auto-continue gets its Enter.** When Claude Code slept through its own reset
  (`Your usage limit has reset · press enter to continue`), `_auto_stale_check` presses Enter
  once per `STALE_PRESS_COOLDOWN` — never with a running turn, never over a non-empty box —
  and logs `stale-resume` / `stale-skip` in `swap.log`. An armed auto-continue is never
  touched (D-2229).
- **The transcript is a second limit detector.** `_transcript_limit_banner` reads the row
  Claude Code appends on a 429 (`isApiErrorMessage:true`, `error:"rate_limit"`, `resetsAt`).
  `_session_hard_blocked` always asks the pane first; only its transcript arm stands down for a
  running turn, a non-empty input box, or a fresh `$REG/<id>.stalepress` stamp inside
  `STALE_RESUME_GRACE=30` (D-2443). Its positive or negative transcript verdict is cached in
  `$REG/<id>.tscan` for `TRANSCRIPT_ARM_INTERVAL=30` seconds (D-2444), while the draft guard is
  still re-measured on every positive verdict. The rescue arm and the strand verdict both use
  this classifier; a blank pane no longer blinds the rescue, and the `auto-rescue` line says
  ` via=transcript` when the pane alone would not have fired. The pane regex is deliberately not
  widened (D-2364).
- **The banner is a system line in the PWA** — `usage limit · resets HH:MM` in your clock,
  Claude Code's sentence as the tooltip (`origin: 'limit'`, `resetsAt` in epoch seconds).
- **The mail nudge holds while an auto-continue is armed.** `sendPrompt` refuses
  `auto-continue-armed` for the mail lane only; the sweep holds the delivery five minutes
  without counting an attempt and tells the sender once. Your own send from the PWA is not
  held: typing is Claude Code's documented cancel and the pane is on your screen.
- Both transcript readers pair `-f` with `-r` (D-2370, closing D-2347).
### One memory store per project: `ccrc memory`

**A project's durable memory is per-ACCOUNT, and ccrc exists to move sessions between
accounts.** Claude Code keeps it at `<config dir>/projects/<slug>/memory` — inside the
*account's* home, not the project's — so the swap this whole design is bent around carries
the conversation across and leaves the memory behind. Each home a box carries accumulates its
own copy of what sessions learned about the same repo, and they drift apart.

The answer is one store per **project**, shared by every home on the box:
`~/.ccrc/memory/<slug>`, with each home's `projects/<slug>/memory` a symlink into it.
Nothing has to move on a swap, because nothing was ever the account's to hold.

```bash
ccrc memory            # the census: one line per (home, project) pair, then a count
ccrc memory --apply    # the union — the only step in any of this that moves a byte
```

**The census is read-only.** A pair is a home's `projects/<slug>/memory` that exists at all —
a project a home has never held is not a pair and is not listed — and it reads either
`converged` (the link *resolves* to the store and the store is a directory: resolution, never
the link's spelling) or `forked` (a real directory, or any link that does not resolve to a
store directory — pointing at another home, dangling, or landing on a plain file).
**Homes are enumerated from the FILESYSTEM (`~/.claude*/`), never from the roster** — the
roster describes the accounts ccrc places work on and was never a census of homes, and a box
can carry config dirs no roster entry names. **Scratch slugs are skipped**, because the harness
mints one for every throwaway directory a session was started in — four prefixes, because the OS
scratch root is not spelled alike on the two platforms ccrc ships to: `-tmp*` (Linux `/tmp`),
`-private-tmp*` and `-var-folders*`/`-private-var-folders*` (macOS `/tmp` resolves through
`/private`, and `$TMPDIR` is a per-user `/var/folders/<x>/<y>/T`). `/var/tmp` is **not** scratch by
this rule — POSIX makes it persistent — so a project kept there is censused like any other. The
summary line names what the rule dropped (`N pairs, M forked, K scratch skipped`), counting only
slugs that would otherwise have been pairs, so the three numbers reconcile against one unit.

**`--apply` keeps both sides of a conflict rather than choosing one.** A file unique to one
home is copied across; a byte-identical collision stays one file; a same-named file whose
content *differs* keeps **both** copies, the incoming one suffixed with the home it came
from, for a human to reconcile. `MEMORY.md` is the exception — an index of one line per file,
derived from each file's own `name`/`description` frontmatter where it has one. A file that
does not (measured: a small minority fleet-wide) is dropped from the index — there is nothing
to derive a line from — but never silently: the run counts what it dropped and names the
count and the store in its own `NOTE:` line, the same discipline a suffixed conflict copy
already gets. It is therefore rebuilt rather than merged. Sub-directories and non-`.md` files
are not memory files: they are counted, not copied, and the run names how many stayed behind
and where — a backup path on the plain-directory arm, the resolved source itself on the
symlink arm, whichever ran. Only a **real directory** is backed up — beside itself as
`memory.pre-ccrc-<UTC>`, with the path printed on that pair's line; the symlink arms take no
backup, because a link holds no data. And it **refuses rather than reporting a success it did
not achieve**: a union that cannot read a source or land a copy stops the *whole run* at that
pair — the operator sees the failing pair's own diagnostic (or, on the symlink arm, the
resolved target that could not be read, which names neither home nor project slug), but every
home not yet processed is simply never reached and never mentioned, converged or not. Only the
plain-directory arm's own source is guaranteed left exactly where it stood; nothing else is,
once one pair fails. It also normalises a converged link whose own text is not the store — a
relative spelling, or a *chain* through another home's link, which would quietly make one
account's home load-bearing for every other, reintroducing one level up the very failure this
replaces.

`--apply` is a one-time operator act; two mechanisms keep it honest afterwards. The
SessionStart hook converges one `(home, project)` pair per start and **never merges data** —
it acts only where there is nothing to lose (an absent link, or a plain directory that is
empty, tested by `rmdir`'s own failure so there is no check-then-act window across a live
fleet), leaving a non-empty directory or a link pointing elsewhere exactly as found.
`ccrc doctor`'s `memory` check then reports what the hook declined to touch, in three
conditions it never collapses into one, each its own severity: **forked** pairs are a
**WARN** (remedy: `ccrc memory --apply`) — a fork is the expected state of every multi-home
box before its one-time migration, not a misconfiguration, and FAILing it would hard-die
`ccrc update` before its supervisor sweep ever runs, coercing an unrelated verb into demanding
that migration; homes the hook **cannot reach at all** are a **FAIL**, because
`install-session-hooks.sh` builds its default list from the roster (remedy: add the account to
the roster, or register `session-hook.sh` in that home's `settings.json` by hand) — nothing
repairs that on its own; and a `settings.json` that exists but **cannot be read** earns its own
**WARN** and remedy — "I could not measure it" is not "it is definitely not wired".

## Attention, notifications and answering

- **Unseen watermark** (`pwa/src/lib/seen.ts`): a session is unseen when it
  entered a human-wanting bucket (`attention`, `done`, `cleanup`) after this
  device last acknowledged it. Per-device in `localStorage` on purpose — ccrc
  has no user accounts, so "seen" belongs to the person holding the phone.
- **Push copy discipline** (`server/src/watch.ts`): project context appears in a
  title only when more than one project is active, and nothing fires for a
  session a client reports on screen. The PWA states that claim on every socket
  open and refreshes it every 15 s; the server expires a claim it has not heard
  for 45 s, so a phone that loses signal without a close frame goes back to
  being notified rather than silently muted.
- **Answering from the notification**: an ask push carries the question's first
  two option labels as notification actions, and `pwa/public/push-sw.js` POSTs
  the answer without opening the app. A button is offered *only* where the
  answer route would accept it — an action that can only be refused costs a tap
  and a wait to learn what the server already knew.
- **Catch-up watermark**: `{epoch, seq}` as one atomic JSON value on both sides
  (`server/src/notifylog.ts`, `pwa/src/lib/notifymark.ts`). A seq is meaningless
  without the lifetime of the counter that produced it — written separately, a
  death between the two writes forges a valid-looking pair and silently drops
  real notifications. When the server cannot *prove* the client saw everything
  it says `resync`, and the client then surfaces nothing retroactively.

Three routes can act on a session, each with its own named refusals:

| Route | What it does | Gate |
| --- | --- | --- |
| `POST /api/sessions/:id/dialog` | answers a **pane** menu by walking the `❯` marker | refuses a stale dialog id; never presses Enter unless the re-captured pane proves the marker landed |
| `POST /api/sessions/:id/ask` | answers a **hook-reported** question by option index | re-reads the current envelope and refuses unless a content digest still matches, the pane still shows that exact menu, and the question is single |
| `POST /api/sessions/:id/submit` | presses **one** Enter on a box that already holds text | refuses unless the box matches the text the caller expected; one Enter, never a retry loop |

## Remote fleet mode

By default (`CCRC_FLEET=local`, unset) the server reads ccd's flat files and
shells out to `ccd`/`tmux` directly on its own box. `CCRC_FLEET=remote`
instead drives the fleet through `ccrc-agent` running on a separate fleet
host, over a single authenticated WebSocket — the server never SSHes into
the fleet box at runtime.

**`remote` is not a hypothetical** — the reference deployment runs it as
standing config, and `GET /api/fleet/health` answers `{"mode":"remote"}`
there, not `local`. The consequence this whole build rests on: **the server and the
fleet host are different boxes**, and the link between them is read-only for
files except `.cc-clips` (every other mutation crosses it as a whitelisted
`ccd`/`tmux` verb, never a raw write). The coordinator's dispatch/close
routes and the mail delivery lane all reach ccd through this same seam —
see "Fleet coordination" below.

### Config

| Var | Where | Meaning |
| --- | --- | --- |
| `CCRC_FLEET` | server | `local` (default) or `remote`. |
| `CCRC_AGENT_URL` | server | `ws://`/`wss://` URL of `ccrc-agent` on the fleet host, including its path, e.g. `ws://fleet-host:7789/agent`. |
| `CCRC_AGENT_TOKEN` | server + agent | Bearer token; must match on both sides. Generate with `openssl rand -hex 32`. |
| `CCRC_HETZNER_TOKEN` | server | Hetzner Cloud API token — only used by the degraded-mode reboot action. Unset leaves that route disabled (`501`). |
| `CCRC_FLEET_SERVER_ID` | server | Hetzner Cloud server ID of the fleet host — only used by the reboot action. |
| `CCRC_AGENT_HOST` | agent | Bind interface, default `127.0.0.1`. Never `0.0.0.0` — name the private-network address the server reaches it on, explicitly. |
| `CCRC_AGENT_PORT` | agent | Listen port, default `7789`. |

See `deploy/ccrc.env.example` and `deploy/ccrc-agent.env.example` for
copy-paste templates.

### Agent security model

`ccrc-agent` (`agent/`) is deliberately narrow — it is not a
general remote-shell:

- **Network**: binds a single interface (a private network between the two boxes, by convention; default
  `127.0.0.1`), never `0.0.0.0`. Every connection must send a valid `hello`
  frame with the bearer token within 3 s, or the socket is closed; a wrong
  token closes with code `4401`.
- **Exec whitelist**: only `tmux` (`has-session`, `list-panes`,
  `capture-pane`, `send-keys`, `resize-window`) and `ccd`, matched against the
  exact bare command name (no path components) and an argv **prefix** — most
  `ccd` verbs are still a bare first token (`start`, `enable`, `ensure`,
  `stop`, `swap`, `ws-add`) — a bare-token grant leaves everything after the
  verb unconstrained, which is what lets `ccd stop <id> --surface <word>`
  cross this seam with no widening: `stop`'s validated `--surface` flag is
  the single enrolment the swap-transcript design costs, and it rides as an
  argv flag rather than an env var because the exec seam is `Runner = (cmd,
  args) => …` with no env, and the agent's wire `ExecReq` carries `{cmd,
  args, timeoutMs}` and nothing else — a `CCD_SURFACE` variable would report
  the *server process's own* environment identically for every caller, not
  the caller's identity. The flag records a **declaration, not an
  authentication**: ccd validates it against the closed set (`cli`, `pwa`,
  `agent`, `ccd`) and normalizes anything else to `unknown`, but nothing
  proves the caller is who the flag says. The PWA's own `POST
  /api/sessions/:id/stop` route — the ONE place that route's two argv
  builders are called — passes `--surface pwa` when the deployed ccd is
  known to understand it (the conditional half is below), so a stop the
  operator taps from the PWA records `pwa` in that case, not ccd's own
  `cli` default. That default is
  not exclusive to it, though: `cli` is whatever an ORDINARY flagless
  invocation records, which is also what a session shelling `ccd stop`
  from its own Bash tool gets, among other callers. And `pwa` is not what
  EVERY API-reachable path to a stopped session records — the several OTHER
  routes and lanes that reach `_ws_unsupervise` directly (`ws-rm`, the
  archive/reap verbs, `forget`) pass no surface at all and record
  `_ws_unsupervise`'s own default, `ccd` — an operator archiving a
  workspace from the PWA sees "stopped by ccd" on that row, correctly,
  because ccd itself did the unsupervising there, not the stop route. No
  UNATTENDED lane is on that list any more: `FleetWatcher.archiveMerged`
  was one, and `sweepMerged`, the lane that replaced it, pushes a
  notification and unsupervises nothing — every path left to this seam is
  one a human asked for.
  The capability is also conditional, not assumed — and its no-evidence
  default is the OPPOSITE of every other gated verb's. `stopSurfaceSupported`
  reads the same `ccdVerbs` channel `verbSupported`
  (`pr-state`/`ws-reap`/etc.) already uses — `ccd caps` prints `stop-surface`
  as one more verb-shaped line, so nothing new has to parse, carry or cache
  it — but where no evidence PERMITS an ordinary verb (guessing wrong there
  is loud: ccd's own usage refusal, a 502, never a lie), no evidence REFUSES
  `--surface`, because guessing wrong there is a *silent success*: an old
  ccd parses `stop <id> --surface pwa` as a two-argument stop of a session
  literally named `<id>---surface`, exits 0, and the real session is never
  touched. Evidence comes from measuring the actual deployed ccd on
  whichever box runs it — the remote agent at handshake and every 60s
  thereafter, and, so the inverted default does not simply kill the feature
  in local mode (the documented default, `CCRC_FLEET=local`), the local
  server too, which now execs its own `ccd caps` once at boot — bounded
  (10s, matching the remote agent's own exec ceiling for the identical
  operation) and never on the boot path itself: the server starts
  answering requests immediately, with "not yet known" read as no
  evidence (the same safe default a genuinely absent probe gives) until
  the read resolves in the background. With
  evidence either way, an older ccd still gets a stop it fully understands,
  just recorded under `cli` rather than `pwa` — never a call that silently
  does nothing.
  Two honest edges the inversion narrows but does not close, and they are
  NOT the same size. On the fleet host, a **rollback** to an older
  `~/ccrc-backups/<ts>/ccd` leaves the cached verb list still advertising
  `stop-surface` for up to 60 seconds — bounded, because the SERVER's own
  fleet watcher re-asks on a timer (`CAPS_REFRESH_MS`) regardless of any
  signal from ccd itself; the agent has no timer of its own; it answers
  when asked and re-execs only when ccd's mtime/size on disk has changed.
  **In local mode there is no such timer.** The probe
  runs exactly once, at boot; swapping `~/.local/bin/ccd` for an older
  copy under a still-running server **reopens the exact silent-success
  hazard this work exists to close, with no bound at all**, because
  nothing about a `stop` succeeding tells the server its evidence has gone
  stale — an old ccd exits 0 on the argv it cannot parse, which is the
  same silence that makes the underlying defect possible in the first
  place. It stays open until the server process is restarted; there is no
  other trigger.
  The local probe hangs it might meet are handled — a hung process is
  bounded (10s) and, if it ignores that first SIGTERM (real ccd does
  not), an unmaskable SIGKILL follows two seconds later, to the whole
  process group, not just the direct child. Two narrower residuals of
  that same detached design are stated rather than fixed: a **terminal
  Ctrl-C or a group-directed supervisor stop** kills the server but not
  the (differently-grouped) probe — covered in production regardless,
  since `deploy/ccrc.service` sets no `KillMode` and systemd's own
  default still reaps the whole cgroup on `systemctl stop`; and a server
  that **exits mid-probe** (a crash, not a graceful stop) orphans that one
  probe permanently, since its own timeout timer dies with the parent.
  Both are bounded to one process, once, per server lifetime; neither gets
  a shutdown hook.
  `stop`'s grant stayed a bare one-token
  prefix through this change — nothing widened — because the flag rides
  entirely inside the "everything after the verb" territory that prefix
  already covered.
  Several OTHER verbs, unlike `stop`, require a longer prefix before
  anything after them is unconstrained: `pr-state` needs `--session` or
  `--project`, `pr-open`/`ws-archive`/`ws-restore`/`ws-audit`/`ws-attic`/
  `ws-hold`/`ws-release`/`ws-rename` need `--session`, and `ws-reap` needs
  `--expect` — a load-bearing confirmation token, so an unconfirmed reap can
  never cross the wire at all. `ws-rename`'s flag guards a different hazard:
  the verb destroys nothing, but it is the first whose argv the server builds
  from model output (`FleetWatcher`'s naming sweep) and sends with no human
  anywhere in the path — a bare `['ws-rename']` would still permit the whole
  positional argv surface the verb used to have, so naming the flag is what
  keeps the grant two tokens wide. `clip` and the legacy, unguarded `ws-rm`
  are gone; `ws-gc` (which would permit `--prune`) was never granted. `gh`
  has no entry, deliberately: the host token carries the `repo` write scope
  and there is no read-only credential or cwd sandbox, so any `gh` grant
  would make this list the sole control between the PWA and `gh pr merge` —
  the one PR write goes through a `ccd` verb instead. Anything else comes
  back `{ok:false, err:'forbidden'}`.
- **Path whitelist**: every file op resolves the target through `realpath`
  and checks it's still under an allowed canonical prefix — closing the
  classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
  `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), the
  fleet's projects root, and exactly the eight `$HOME/.ccrc` node files by
  name (`NODE_FILES`, `shared/agent-protocol.ts`) — a live symlink inside
  `$HOME/.ccrc` carrying one is refused, or admitted through another prefix's own arm with `lstat` reporting `symlink`, which the update inventory refuses to read as that file; never `$HOME/.ccrc` itself. Writes: `$HOME/.cc-clips/` only. **This
  list did not widen for the transcript resolver or the supervisor
  heartbeat**: the resolver's uuid search (rungs 5 and 6 of its ladder)
  rides the existing `$HOME/.claude*` grant, and the heartbeat exists so the
  server never asks systemd anything — nothing under `~/.config/systemd`.
- **pty**: `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>`, with
  `sessionId` sanitized to `[A-Za-z0-9_-]+` — never an arbitrary command.

### Degraded mode

While the fleet host is unreachable in remote mode, the server keeps serving
the last-known-good fleet snapshot instead of going blank:

- On every successful full fleet poll, the snapshot is written atomically to
  `~/.ccrc/state-cache.json` on the **server's** box (this file never goes
  through the agent — it's local housekeeping, same as the PWA dist-check).
- When the agent connection drops, `GET /api/fleet` keeps serving that cached
  snapshot with `stale: true` and `downSince: <epoch ms>`; the PWA shows a
  banner ("Fleet host unreachable since …") once it sees `stale`.
- `GET /api/fleet/health` → `{mode, connected, downSince}` — poll this to
  check remote-mode connectivity (`mode: 'local'` always reports
  `connected: true`).
- `POST /api/fleet/reboot` fires a Hetzner Cloud reboot of the fleet host —
  the PWA's confirm dialog names the collateral, because a reboot takes down
  everything else running on that box, not just the fleet. Guards: `409` if
  `mode !== 'remote'`,
  `501` if `CCRC_HETZNER_TOKEN`/`CCRC_FLEET_SERVER_ID` aren't set, `502` on a
  Hetzner API error, `202` on success.

### Verifying a remote-mode deploy

After `deploy.sh agent <host>` and flipping the server to `CCRC_FLEET=remote`:

```bash
# from the server box, where 7788 is loopback-bound:
curl -fsS http://127.0.0.1:7788/api/fleet/health   # {"mode":"remote","connected":true,"downSince":null}
```

Then kill/stop `ccrc-agent` on the fleet host and re-poll — `connected`
should flip to `false`, `/api/fleet` should keep returning the last snapshot
with `stale: true`, and the PWA banner should appear; restart `ccrc-agent`
to restore `connected: true`. `CCRC_FLEET=remote` is not a hypothetical
cutover — `remote` is the two-box shape this section describes, so this drill
exercises the degraded-mode path a real
agent restart or network blip already produces, not a one-time migration.

## Programs, runs and mail — the operator's view

A **program** is a long-horizon effort with a slug and a markdown ledger
(`docs/superpowers/programs/<slug>.md`, in the project's own repo, committed,
and parsed by nothing). A **run** is one wave of it in one workspace. A
**coordinator** is an ordinary fleet session running the `ccrc-coordinator`
skill, placed by `_ws_least_loaded` like any other session, acting through the
server's HTTP API and never raw `ccd`. See "Fleet coordination" below for the
skill's contract, the run lifecycle, the mail bus and its box token, caps and
pause, why `ws-reap` stays human-only, and the honest boundary — this section
covers only what that one does not: the install lane, the PWA surfaces, the
disaster-recovery drill, and the Build 4 dogfood runbook.

**All three skills ship to every rostered account's config dir.** The
coordinator's protocol is now a trio: its worker counterpart is the
`ccrc-worker` skill (`ccd/worker-skill/SKILL.md`, fifteen clauses pinned by
`server/test/worker-skill.test.ts`), and its reviewer counterpart is the
`ccrc-reviewer` skill (`ccd/reviewer-skill/SKILL.md`, ten clauses pinned by
`server/test/reviewer-skill.test.ts`), which reads a finished wave in its own
workspace and reports — it never rules. Neither carries a `references/` of
its own — both point at the coordinator's — so each must land *beside* it,
never instead of it, and never first. Skills resolve per `CLAUDE_CONFIG_DIR`,
and a session's account drifts on swap — so `ccd/install-coordinator-skill.sh`,
`ccd/install-worker-skill.sh` and `ccd/install-reviewer-skill.sh` each install
into *every* config dir the roster names, in that order — coordinator, then
worker, then reviewer — the same list
`install-session-hooks.sh` uses. There is no hooks-able subset — that concept
existed only while the installers carried a hand-typed `homes=(…)` array; all
four now `source` the generated `~/.ccrc/accounts.sh` and `continue` past any
config dir that is absent, which is what makes "every account" the safe answer
rather than a broader one. No list is trusted: `install-session-hooks.test.ts`,
`install-coordinator-skill.test.ts` and `install-worker-skill.test.ts` each RUN
their installer with no
`--homes` argv against a fixture home holding a config dir per rostered
account, and assert every one of them was touched (the older source-text pin in
`wrapper-roster-fixture.test.ts` went away with the array it was reading).
Installation happens on every agent deploy AND inside `ccrc install`'s own
`_inst_skills` step, idempotently, backing up anything it
replaces. That lane is what makes "place the coordinator — or a worker — like
any other session" safe.

**Three surfaces.** `/runs` is the board — runs grouped by program, with their
own status words (a run is a lifecycle position, not an attention state, so it
borrows none of the bucket vocabulary and nothing on it glows). `/mail` is the
durable feed, reached from the ✉ beside the bell. Every session's own
outstanding mail sits above the composer, one row above the task strip.
Records land in the feed whether or not you were watching — only the *push*
is presence-gated; a record of an agent-to-agent message is a fact about the
fleet, and it is kept either way.

**If the database is lost**, a program is reconstructible from its ledger
(committed to the project's own repo) plus the registry and `.prhistory` on
the **fleet host** — `server/test/reconstruction-drill.test.ts` is that
procedure, executed against fixtures, naming by name what it recovers and
what it cannot.

### The board's three controls, and the transcript that stops lying (Build 4)

**Three controls, all on `/runs`, all reached from a phone.**

1. **Pause / resume the fleet.** The banner at the top of `/runs` reads
   `$REG/coordinator-paused` on the **fleet host** — the same file
   `dispatchRun` refuses on — and its toggle writes it through
   `POST /api/coord/pause` → `ccd coord-pause --state on|off`. Four states,
   and it is never optimistic: a tap shows `pausing…`/`resuming…` and settles
   only on the next `{type:'coord'}` frame, rendering `unconfirmed — check
   /runs` if none arrives. Before the first frame it renders **nothing** —
   an unmeasured marker must not read as "running".
2. **Abandon a wedged run.** Two taps, naming the run and its workspace.
   It **releases** the hold; it never archives, and there is no archive
   control anywhere on the sheet. An abandon asserts nothing about PR
   lineage — no fingerprint, no `.prhistory` fold, no `verifyDone` — because
   the case it exists for is a run whose claim can no longer be measured.
3. **Start a program.** Composition over existing routes, not a new one:
   the projected account (`useProjectedHome`, the server's mirror of
   `_ws_least_loaded`) is named *before* the tap, then `POST /api/sessions`
   and one kickoff prompt. It never opens a run — the coordinator does that
   itself — and it refuses outright when a live main checkout of that project
   already exists, because `ccd start` is idempotent and would otherwise
   inject a coordinator brief into a session that may be mid-task.

**Rollout order is forced, and it is Build 7's:** ccd verb + agent whitelist +
coordinator skill (fleet host) **first**, then the server, then the PWA. A PWA
that ships before the verb renders a pause toggle that answers `501` for every
tap. This is the standing "AGENT-FIRST" rule for anything touching `ccd/`.

**The work-item tally is the coordinator's write, and it is made after the
server re-measured.** Items are declared once, at dispatch, on the dispatch
body — the ledger is fixed there and `total` never grows. They are settled
through `POST /api/runs/:id/items`, which the coordinator calls only **after**
`verifyDone` has re-measured the workspace branch and answered ok: done-authority
is a fingerprint, not a claim, and the mail bus never routes on subject text.
A wave whose brief declared no items reads `—`, not `0/0` — an em dash is the
honest rendering of "nothing was declared", and it is not a defect.

**In the transcript.** Agent-to-agent mail now renders as a **mail card**
attributed to its sender (`coordinator → this worker`, kind, subject, run and
wave, artifact paths as paths). What was missing was never the message — it was
always in the JSONL — but the attribution. The card is derived from whichever of
the two lanes put it there: **today** the sweep types only a one-line nudge and
the worker fetches the body with `GET /api/mail/:id`, so the envelope arrives as
that call's `tool_result`; **before `43b2737`** the sweep typed the whole
envelope into the input box, where it landed as a `user` turn and read as if the
operator had typed it. Both render, so older transcripts keep working. A result
the server truncated never becomes a card — a fragment cannot back the claim a
card makes. And the card is a *rendering, never an authorization*: the transcript
is a rank-3 source, so a session can put a fake envelope in front of itself;
authoritative mail rows come from the database. The card offers **no ack and no
reply**:
ack is box-token gated and is the agent's own act. A question the agent is
**blocked on right now** reads as live and carries one control, `Answer`, which
only raises the answer sheet that already exists — it never sends. A question
the session moved past, or died holding, reads *unanswered* rather than
*waiting for you*. And a tool result the server truncated says so, in bytes; a
server too old to report says nothing, which is never the same as saying the
output was complete.

### Dogfood: Build 4 is the first coordinated program

By decision (spec §9), the first program run through the coordinator is Build 4,
the transcript surface. Before starting it:

1. The token is on both boxes: `ls -l ~/.cc-secrets/ccrc-mail.token` on the
   fleet host and `~/.ccrc/mail.token` on the server, each `-rw-------`. Do not
   `cat` either one.
2. `ls ~/.claude*/skills/ccrc-{coordinator,worker}/SKILL.md` lists TWO paths per
   rostered account config dir. Both skills are placed in every
   home, by both lanes (`deploy.sh agent <host>` and `ccrc install`), for the
   same reason: a session is placed with no pinned account, so a swap must
   never land a coordinator — or a worker — on a home without its protocol.
3. `~/.cc-sessions/coordinator-paused` does **not** exist, on the **fleet
   host** — a dispatch reads it there and refuses `409 {refused:'paused'}`
   with no PWA indicator, so checking on the wrong box is a silent no-op.
4. The ledger exists and is committed: copy `docs/superpowers/programs/TEMPLATE.md`
   to `docs/superpowers/programs/build4-transcript-surface.md`, fill the header
   and wave 1, commit.
5. Open the run, then dispatch. Watch `/runs`; read `/mail`.

Success is a program that completes with human pauses only at review points,
and an audit trail that reads true.

### Cross-repo programmes: one home, waves anywhere

A programme is **initiated in one project and stays there**: its current spec,
its plan, its ledger (`docs/superpowers/programs/<slug>.md`) and its coordinator
session all live in that one repo. For cross-repo programmes, the current build
spec is `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`; it
points back to `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`,
whose historical operator rulings stand. That repo is the programme's **home
project**, and it is *declared*, never inferred — the canonical `POST /api/runs`
body takes `homeProject` on every wave and stores it on the programme row at first
insert. It is not guessed from wave 1's project and not derived from the registry
or from whoever claims the run: a fact a programme carries for its whole life
must not depend on a live read that can degrade.

**A wave, though, may run anywhere.** `runs.project` has always been per-row, so
a wave dispatches its run into whatever repo the work is in — that repo's
checkout, that repo's PRs, that repo's git for every re-measurement. A wave whose
`project` differs from its programme's `homeProject` is a **crossing**.

**Two refusals guard the seam, and they are two on purpose.**

- `project-mismatch` — **409**, body
  `{"ok":false,"refused":"project-mismatch","by":"<the project that session belongs to>"}`.
  It fires at two sites: at `POST /api/runs`, when the body reuses a `sessionId`
  whose earlier runs belong to a different project — checked *before* the row is
  opened, so a refusal leaves no `planned` orphan; and at
  `POST /api/runs/:id/dispatch`, when the resume arm finds a registry record
  whose project is not the run's — checked before the hold, the `/clear` and the
  transition, so a mismatch costs nothing. A session no run has ever named
  refuses nothing: absence permits.
- `home-mismatch` — **409**, body
  `{"ok":false,"refused":"home-mismatch","by":"<the stored home>"}`, when a later
  open of the same programme names a different `homeProject`. A stored home that
  is still null is *backfilled* from the body instead — first writer wins.

Two codes rather than one because the caller does different things with them:
the first says "you reused the wrong workspace", the second says "you are
opening someone else's programme".

**A third refusal guards the tree's depth.** `claimant-is-a-worker` — **409**,
`{"ok":false,"refused":"claimant-is-a-worker","by":"<that worker's coordinator>"}`
— fires at `POST /api/runs` when `claimedBy` is itself the worker of an open
run, and `heir-is-a-worker` fires the same way at `POST /api/runs/:id/reclaim`
for a successor. A session that is another coordinator's worker on any open run
may not open or inherit a programme: the board brackets ONE level, and a real
chain would render its middle session detached from the coordinator above it.
EVERY open run naming that session is read, not just the newest one — a session
can be the worker of several at once, because the coordinator protocol opens
wave N+1 before closing wave N. Three admissions, not two. A finished worker is
not a worker; a self-claimed run is admitted (the plan's ruling D-3012; spec
2026-09-16 §12 for the door itself); and at the RECLAIM door only, an heir every
one of whose open runs is claimed by the claimant being replaced may inherit —
the programme's own live worker is the likeliest successor to a dead coordinator,
and the run it takes over is self-claimed, which the board never brackets, so the
one level stays honest. An heir a THIRD coordinator's open run still binds is
refused however new the dying coordinator's own binding is, and a claimant that
measures alive is still refused ahead of any of this. A session so refused is
released by closing or abandoning the run that binds it (`POST
/api/runs/:id/abandon` is one of the ungated operator doors).

**The open response says where the ledger really is.** Beside the relative
`ledgerPath` it has always returned, `POST /api/runs` answers `ledgerRepo` (the
home project) and `ledgerAbsPath` (that project's checkout plus
`docs/superpowers/programs/<slug>.md`). Both are `null` while the stored home is
null. `ledgerAbsPath` names only the programme ledger; it is neither the home
repository root nor a plan path.

**Foreign-repo waves read named Git objects, never mutable files.** Every foreign-plan wave's
brief carries `homeRepoRoot` (the absolute home-repository root), `planRepoPath` (the
tracked repository-relative plan path with no leading slash), and `planSha` (the
full 40-hex plan commit SHA), then the worker reads exactly
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`. Only a consumer that
depends on a producer interface also carries `producerRepoRoot` (the absolute producer-
repository root), `producerSourceRepoPath` (the producer repository-relative source-file
path), `producerSha` (the exact full 40-hex merged producer SHA), and the contract excerpt
inlined verbatim. The worker then reads exactly
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. A foreign-plan
wave with no producer-interface dependency carries no producer tuple and no invented
excerpt. If a required immutable blob cannot be resolved, report and stop: no `HEAD`
substitution, direct mutable-checkout read, fetch, checkout, or repository mutation. When
present, the inline contract excerpt is the dispatched interface-shape authority and the
producer blob proves its provenance; the plan blob at `planSha` is always the requirements
authority for wave scope. The current checkout's plan and source files are not authoritative
for that dispatched wave. When that dependency exists, before dispatch the coordinator
separately and independently proves the producer interface PR merged at that same
`producerSha`; a closed run in `done` proves fingerprint and close, not merge. The worker
commits only on its own workspace branch in its own repository. Paths, not payloads; the
8 KiB body cap stands.

**Mail finds a role, not a session.** `toId: 'worker'` joins `toId: 'coordinator'`
as a recipient, resolved at send time — `worker` to that run's own session. A
`worker` mail **must** carry its `runId`, because a worker is per run and there
is nothing to fall back to; one that resolves to no session is refused
`unknown-recipient`, naming the run. Carry the `runId` on coordinator mail too:
the runId-less form resolves only while exactly one programme is active, and
fails shut the moment a second is. Raw session-id addressing stays for ad-hoc
mail. When a run's session is replaced, the replacement inherits every
outstanding role-addressed (`toId:'worker'`) delivery on that run — queued
*and* delivered-but-unacked — as a **new** delivery row, freshly rendered, and
the predecessor's row is parked — an envelope that names the corpse may
not be replayed.

**Finding a programme's traffic.** `GET /api/mail?program=<slug>` answers the
**outstanding** mail on that programme's runs — queued, delivered-but-unacked,
and any `rejected` delivery this build gave up retrying, unless it was a
deliberate cancel or its run is already `done`/`failed`; add `&all=1` —
exactly `GET /api/mail?program=<slug>&all=1` — for full mail history. `to` and `program`
are mutually exclusive — exactly one, never both and never neither; a request
naming both is refused `400 bad-request`, because a mailbox and a programme
thread are two different questions. `GET /api/feed?program=<slug>` is always the
full feed archive and has no outstanding/history split. An event with no run
behind it is **programless** and appears only unfiltered. `/mail` groups the
feed by programme, with a filter chip; programless rows sit under their own
header.

**The board says which repo.** Every row on `/runs` carries a project badge
(`run-project`), and a row whose project differs from its programme's home gains
a crossing marker — a glyph *and* the word, because nothing on the board is read
out by colour alone, and while a programme's `homeProject` is null the marker
never shows. On the fleet board a coordinated workspace renders on its COORDINATOR's card,
bracketed under it, whatever repo it works in (spec 2026-09-16, restoring the
Aug-11 rule the Sep-08 spec had silently reversed): the placement is a server
decision (`FleetSession.boardProject`, keyed on the newest run naming the
session and walked to the root coordinator, held while the workspace is
held), and the run follows the row so the bracket, the orphan marker and the
held cell's `/runs` door all stay on the card the row is on. A row whose repo
differs from its card's carries the repo slug inside its name; the session
view shows the slug whenever it is known. The project's own card stays on the
board with nothing on it and says `N workspaces under <project>` — text, never
a link. When a coordinator is NOT on the card (archived, or on another
card the placement could not reach), the row stays flat with the marker
`<program> wave n/N`, `· home <project>` appended only when the measured home
differs, and the marker says when the coordinator is measured gone. The home
project's card gains an `abroad` line, one sentence per wave working
elsewhere ("`<program>` wave 2/3 in `<other project>`"), minus any wave whose
worker already renders on that card.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
and no per-programme cap. Running-worker concurrency counts dispatched runs in
an ACTIVE state — `dispatched`, `working`, `unknown` — and not merely
non-terminal ones, so a run parked IDLE at `awaiting-review`, `merging` or
`closing` gives its slot back without closing; it does not count held
workspaces. A terminal producer whose
workspace remains retained uses no running-worker slot, and a planned,
undispatched consumer uses no running-worker slot. Each actual producer or
consumer dispatch still consumes the rolling daily dispatch budget. A
`cap-concurrency` or `cap-daily` refusal remains authoritative when that measured
counter is exhausted; it is not inferred from the number of live workspaces.
`$REG/coordinator-paused` is global but narrow: it refuses every dispatch on
that box and stops nothing else — mail keeps flowing, and `$REG/mail-disabled`
is the mail switch. The hold reason still names programme, wave and run id and
never a project, because the run row is what carries the project.

### Workspace holds & programs

A **hold** is a program's declared claim on a workspace — `ccd ws-hold
--session <id> --reason <text>` writes `$REG/<id>.hold`, and `ccd ws-release
--session <id>` removes it. No timeout, no expiry, ever: the claim lasts as
long as the reason is true, and the reason string *is* the whole display —
verbatim on the fleet chip, the actions sheet, and the held-merged push,
parsed nowhere. Workspace-only (a main checkout has nothing to protect) and an
archived workspace refuses (restore first). An empty *or whitespace-only*
reason refuses in all three layers — the composer and `ccd ws-hold` share one
sentence (`empty reason — say which program holds this`), while the route
answers a bare 400 `bad-request`, which is what a non-PWA client sees.

A hold has more consumers than any one paragraph used to admit: **four rungs in
ccd** — `ws-rm` and `ws-reap` refuse, `ws-release` removes, and `forget` refuses
— plus the merged sweep, which reads the hold to pick which notice it pushes,
plus every place the PWA renders the reason. All four ccd rungs test `-e`, so an
*unreadable* hold refuses too.

`sweepMerged`, the lane that watches for a merged PR, ANNOUNCES and never acts:
nothing in this server archives a workspace unasked. The hold therefore no
longer gates a destruction — it picks the SENTENCE. A workspace that is
*merged **and unheld*** — `held === null` is the conjunct — gets the plain
`PR #N merged; nothing archived.`, while one idle between two waves of the
same program reads as claimed, not finished, and gets `PR #N merged —
<reason>; nothing archived.` instead. One push per (workspace, PR) — the
number is in the latch key, because a workspace survives its own merge now and
can land a second PR. The hold is taken
from the snapshot the sweep opened with, not re-read at the push: the fresh
registry read this used to take was there because the decision was destructive,
and the cost of a stale one is a notice that does not name a hold placed thirty
seconds ago — which the next PR's notice gets right. **An absent hold is still
not the whole question**: since Build 8 the sweep also asks the server's
`coord.db` whether an OPEN RUN still names the session, and names that run as
the reason when one does, so release-then-crash (hold gone, run still open) does
not read as finished — the sweep asks the authoritative question, not a file
that cannot answer it. The reason string is still display-only and parsed back
nowhere; it merely gained a `run:<id>` so a human reading `~/.cc-sessions` can
tell whose claim it is.

Destroying a workspace a program declared mid-flight takes two deliberate acts,
never one — `ws-rm` dies with `held: <reason> — release first`, `ws-reap`
answers `{"refused":"held"}`, and the cleanup sheet renders that as "A program
has this workspace held — it is mid-flight, so nothing was removed." Release
first, then clean up.

Unchanged: the bucket ladder and `ws-archive` itself. **Manual archive still
works, and still means yes** — a merged-but-held workspace can be archived by
hand from the PR sheet, which is why that sheet names the hold instead of
promising a sweep that will never come. What changed is that the route now
answers `409 run-open`, naming the runs, when a run still claims the workspace;
the sheet renders that and offers **Archive anyway**, which sends `force`. The
operator's own hands stay able to do it; they just have to mean it. See
[`docs/superpowers/programs/TEMPLATE.md`](docs/superpowers/programs/TEMPLATE.md)
for the wave-handoff ledger a program keeps beside its hold.

## Fleet coordination

Build 7 turns a program into a live, server-observed thing: `~/.ccrc/coord.db`
holds programs, runs, work items, mail and coordinator state (SQLite, opened
with `node:sqlite`'s `DatabaseSync`, WAL mode, `user_version` migrations that
refuse to start rather than open empty — a bad migration errors loudly
instead of silently starting a program's history over). ccd's flat files —
the registry, the hold, `.prhistory` — stay the fleet's own ground truth; the
database is a server-side re-measurement of what they already say, never a
replacement for them, and a lost `coord.db` reconstructs from them.

**The skill's contract.** A coordinator is an ordinary fleet session running
the `ccrc-coordinator` skill (`ccd/coordinator-skill/SKILL.md`), and its fourteen
clauses are pinned verbatim by `server/test/coordinator-skill.test.ts` — a
softened clause is a red suite, not a silent drift. **A worker is the same
shape:** the `ccrc-worker` skill (`ccd/worker-skill/SKILL.md`), fifteen clauses,
pinned the same way by `server/test/worker-skill.test.ts`, and it is what a
dispatched session is told to run by the kickoff sentence dispatch composes
onto every brief mail. That is why a wave brief is short: the standing
protocol loads mechanically, so the brief carries the wave's own specifics —
plan path, task range, interfaces earlier waves settled, deviations already
ledgered. The one protocol sentence a brief still repeats is the
branch-discipline line ("commit on this workspace's own branch"), said twice
on purpose, because a skill reaches a config dir only once its installer has
run against that home. One of the coordinator's clauses is
that **`ws-reap` stays human-only, by convention plus a speed bump, named as
exactly that**: the skill's contract excludes the verb outright (the same
test asserts it is named only inside the clause that forbids it), the
coordinator holds every workspace it owns so a reap needs a deliberate
release first, and reap consent stays the PWA's own ceremony either way.
Nothing server-side makes reap mechanically impossible for a process with a
shell — see "The honest boundary" below for what a contract does and does not
buy.

**Routing (routing slice 2).** Clause 13 makes every brief name the wave's shape and the routing
`ccd/coordinator-skill/references/routing-matrix.md` (spec §3, verbatim) derives from it, and makes
the coordinator revise routing only on a wave's evidence, recorded in the ledger. Clause 14 names the
held-out panel in `references/review-panel.md` as the review brief's shape, RUN BY the review run's
reviewer (clause 12) — three Opus lenses, a Sonnet refute pass per finding, model and effort literal
in the script — so the quality gate does not move when a worker's class or effort does. Both
references are in `install-coordinator-skill.sh`'s
`REQUIRED_REFS` and pinned by `server/test/routing-references.test.ts`.

The worker's half: clause 14 routes its own subagents by task shape from the same matrix, class
named on every call and effort on every Workflow call, Fable never a fan-out worker; clause 15 opens
every wave-done body with `suite: green|red|unrun` and, on a failed check, `failure:
shallow|ceiling|unclear`, which `GET /api/runs/:id/signals` reads off the mail row as `signals` —
three answers per line (a value, absent, unrecognised) and `null` when no wave-done has arrived.

**Run lifecycle**, three HTTP routes driving six steps, one run row per wave
(D-56, corrected — the version below was checked line-by-line against
`server/src/coord/routes.ts`, not written from the route names alone):

1. `POST /api/runs` opens a run row for one wave — **the ledger is NOT
   written or read here** (the route's own docstring says so verbatim); it
   only names `docs/superpowers/programs/<slug>.md` in the response, so a
   coordinator that forgot to commit it is told once, in the place it would
   notice. A second coordinator on the same program is refused. The body also
   carries `homeProject`, the programme's home repo, stored on the programme
   row at first insert: a later open naming a *different* one is refused
   `home-mismatch` (**409**, `by:` the stored value), while a stored home
   that is still null is backfilled from the body. A `sessionId` whose
   earlier runs belong to another project is refused `project-mismatch`
   (**409**, `by:` that project). Both `-mismatch` refusals are decided
   *before the row is opened*, so neither leaves a `planned` orphan.
   The response names `ledgerRepo` and `ledgerAbsPath` beside the relative
   `ledgerPath`, both null while the stored home is. Wave 1 (no
   `sessionId` in the body) places **no hold yet** — dispatch is what claims
   the workspace. Wave N≥2 (`sessionId` names the workspace being reclaimed)
   holds it immediately (`ccd ws-hold`).
2. `POST /api/runs/:id/dispatch` checks `$REG/coordinator-paused` and both
   caps **before spawning or resuming anything**; wave 1 (`run.sessionId`
   still null) runs `ccd ws-add` and learns the new session id by diffing
   the registry before/after (never ccd's own echoed sentence, and never
   `ccd start` — no ccd verb of that name runs anywhere in this lane). The
   resume arm refuses `project-mismatch` (**409**, `by:` the registry record's
   project) when the record it finds belongs to a different project than the
   run — *before the hold*, before the injected `/clear` and before the
   transition, so a mismatch costs the workspace nothing. Wave
   N≥2 resumes the *same* workspace with `ccd ensure` (the harness resumes
   its own transcript) and then discards that resumed context with an
   injected `/clear` through `sendPrompt`'s full proof discipline, so
   "genuinely fresh context" stays mechanical rather than hoped for. Either
   path ends in `ccd ws-hold` and the transition to `dispatched`; only once
   that commits does the wave brief go out as mail, into a context proven
   empty (wave 1) or proven `/clear`-verified (wave N≥2). The mail body is
   `WORKER_KICKOFF_PREFIX + brief` — the sentence naming the `ccrc-worker`
   skill, then the coordinator's prose — and the byte cap is measured on that
   composed body, so the ceiling a brief actually has is
   `MAIL_BODY_MAX_BYTES` less the prefix's own length.
3. The coordinator watches mail and `pr-state` the way an operator would —
   `GET /api/runs` and the `runs` frame on `/ws/fleet` carry state and
   work-item tallies, nothing new to poll.
4. A worker's done-claim is **re-measured, never believed**: branch tip,
   handoff commit, PR number and phase are all read fresh off git's own ref
   files and `.prhistory`, not trusted off the claim body — a stale tip, a
   regressed PR, or a handoff commit that isn't the claim's own branch tip
   is refused and mailed back with the reason. (An explicit abandon,
   `state:'failed'`, skips this re-measurement entirely — there is no
   worktree left to re-measure an abandon against.)
5. The coordinator **dispatches a review run** (`POST /api/runs` with
   `kind:'review'`, `reviews:<id>`) whose reviewer reads the wave in its own
   worktree at one measured tip and mails one report; the coordinator closes
   that run on the reviewer's `{reviewedTip, report}` — refused
   `stale-review` if the worker pushed meanwhile — and rules: send back
   (`advance` to `working`, cap-checked, refused `review-in-flight` while the
   review is open) or advance to `merging`. Brief *quality* stays discipline,
   not something this server enforces — then must
   **open wave N+1 before it can close wave N**. A programme with zero open runs
   retires permanently, so close-first would break role-addressed coordinator
   mail between the two calls.

   **For a same-project successor**, open the new `POST /api/runs` first with
   the same `sessionId`; that immediately re-holds the producer workspace for
   the new row. Then close the producer with `final:false`, verify the exact
   producer closed row in `runs list --closed 1` is `done` with a full 40-hex
   `handoffCommit`. If the consumer depends on an interface from this
   producer, independently prove the producer PR merged at `producerSha`:
   run `ccd pr-state --session <producer-session>`, select that session's
   merged PR row, require the answer's `phase` to be `merged`, and require
   that row's raw `headRefOid` to equal both that exact producer closed row's
   `handoffCommit` and `producerSha`. Only then dispatch into the
   already-held successor workspace.

   **For a cross-project successor**:
   A cross-project successor opens first without the producer's
   `sessionId`, leaving the new row planned for fresh dispatch in the
   target repository. Then close the producer with `final:true` so
   its now-distinct workspace is released, require `released:true`
   in the close response, then verify the exact producer closed row
   is `done` with a full 40-hex `handoffCommit`. If the consumer depends
   on an interface from this producer, independently prove
   through `ccd pr-state --session <producer-session>` that the
   selected `phase` is `merged` and raw `headRefOid` equals both that
   `handoffCommit` and `producerSha` —
   prove its PR merged at the named producer SHA
   before dispatching the consumer. Only then dispatch the consumer
   fresh in its target project.
   A `done` run proves fingerprint and close, **not merge proof**;
   missing, ambiguous, or mismatched PR evidence means report and do
   not dispatch. Using `final:false` on that crossing would
   strand a synthetic next-wave hold on the producer workspace.
6. `POST /api/runs/:id/close` with `final:true` releases the hold (`ccd
   ws-release`); nothing archives the workspace on its own after that — the
   merged sweep only pushes its notification, so the workspace stays live and
   supervised until a human archives it. An explicit abandon
   (`state:'failed'`) alone still only *releases*, exactly like a normal final
   close — archiving instead needs `archive:true` passed explicitly (the one
   call in this whole lane to `ccd ws-archive`, mirroring the manual archive
   route including its 501).
   **Caution:** `state:'failed'` with `final:false` and no `archive`
   re-holds the workspace under the *next* wave's reason even though this
   run just went terminal — abandoning mid-program needs `final:true` or
   `archive:true` explicitly, or the workspace stays held for a wave that
   is never coming.

**The mail bus and its token.** Sessions send each other mail — `finding |
question | answer | status | artifact` — through `POST /api/mail`, attributed
(`{fromId, fromUuid}` checked against the live registry: freshness, not
forgery-proofness) and capped (an 8 KiB body, typed rejection codes, every
rejection itself recorded, win or lose). A watcher lane (`MAIL_SWEEP_MS`,
10 s) walks queued deliveries and, once a recipient has been idle-quiet for
`MAIL_QUIET_MS` (60 s) with no dialog or ask pending — or `COORD_QUIET_MS`
(15 s) when the recipient is a COORDINATOR, i.e. the `claimedBy` of a
non-terminal run, which its own contract requires to be sitting idle at a wave
boundary — injects the fenced
envelope through `sendPrompt`'s full proof discipline — never re-rendered,
replayed verbatim on later sweeps (after a per-session `MAIL_COOLDOWN_MS`, or
`COORD_COOLDOWN_MS` for a coordinator, and again every `MAIL_REPLAY_MS`) until
the recipient POSTs
`/api/mail/:id/ack`.

`/api/mail` (and its ack route), the gated run routes (`POST /api/runs`,
`/:id/dispatch`, `/:id/close`, `/:id/advance`, `/:id/items`, `/:id/route`) — but **not** the
operator doors `/api/runs/:id/abandon` and `/api/runs/:id/reclaim`, which carry
no box token by design (D-282), any more than `/api/coord/pause` or
`/api/claims/:id/break` do — `GET /api/mail?to=<id>` and
`/api/notify` (ccd's swap hook) all require the same **box token** — one
shared secret per box, read from a file, deliberately never an env var
(`deploy/ccrc.service` ships no `EnvironmentFile=`, and this build does not
add one, to avoid flipping a live unit's environment blind). It lives at
`~/.cc-secrets/ccrc-mail.token` on the **fleet host** (read by
`deploy/notify.sh`) and at `~/.ccrc/mail.token` on the **server**
(`CCRC_MAIL_TOKEN_PATH` to override); both are shipped from one
locally-gitignored `deploy/ccrc-mail.token` (`openssl rand -hex 32` to mint
it, or `cp deploy/ccrc-mail.token.example deploy/ccrc-mail.token && edit`)
by `deploy/deploy.sh`'s secret-shipping lane. **The run routes were
unauthenticated for a stretch of this build's own history** — an earlier
design note argued they were no worse than the pre-existing, also-open
`/api/sessions/*` surface — but a whole-branch review found that posture
inverted the intent (`ccd ws-add`, an injected `/clear` and
`ws-release`/`ws-archive` are strictly more dangerous than inserting a mail
row, which required the token all along) and closed it: every coordinator
write route that is a MACHINE lane now fails the same way the mail pair always
has. None of the lanes enumerated above tolerates a missing token — a request
with none is `401 unauthenticated`, full stop. (The operator doors excepted just
above are the other half of that sentence, and they are not an oversight in it:
they are reachable from a phone precisely because the party a wedge locks out is
the party holding the box token.) `/api/notify` alone accepts a request with
**no** token header for one deploy generation, logged as `legacy` so the
swap hook cannot go dark mid-rollout; that tolerance comes out in the deploy
*after* the one that ships `notify.sh`'s token read — it is a rollout
bridge, not a standing policy. **Minting the token file matters as much as
having one:** `deploy/ccrc-mail.token.example`'s own placeholder value line
must actually be replaced — copying the example verbatim is refused loudly
at server boot (`MailTokenPlaceholderUnedited`), not silently accepted,
because that exact placeholder is committed to this public repo.

**Programme mail at scale.** `toId: 'coordinator'` has a sibling: `toId: 'worker'`,
resolved at send time to that run's own session. `worker` requires a `runId` —
a worker is per run, and there is nothing to fall back to — and one that
resolves to no session is refused `unknown-recipient`, naming the run.
`coordinator` keeps its fallback to the single active programme, which fails
shut the moment a second programme is active, so carry the `runId` on both.
Raw session-id addressing stays for ad-hoc mail. When a run's session is
replaced, every outstanding role-addressed (`toId:'worker'`) delivery on that
run is re-issued to the heir as a **new** row, freshly rendered, and the
predecessor's row is parked — the act a reclaimed coordinator's heir has
always had, generalised by role and funnelled through `bindSession`, the one
writer that re-binds it.
Reading it back by programme: `GET /api/mail?program=<slug>` returns the
**outstanding** mail — queued, delivered-but-unacked, and any `rejected`
delivery this build gave up retrying, unless it was a deliberate cancel or
its run is already `done`/`failed` — and
`GET /api/mail?program=<slug>&all=1` returns full history;
`to` and `program` are mutually exclusive — exactly one, never both and
never neither, and naming both is refused `400 bad-request`. `GET /api/feed?program=<slug>` is
the full event archive, with no outstanding/history split. Both join through the
run row; an event with no run behind it is programless and shows only unfiltered.

**Caps and pause.** The single-row `coordinator_state` table holds
`maxConcurrentWorkers` (default 3 — runs currently dispatched and in an
ACTIVE state, `dispatched` or `working` (and any state token this build
cannot name — the safe direction for a cap, D-2803); a worker at `awaiting-review`,
`merging` or `closing` is idle by contract and holds no slot — design
2026-09-14 §7.1; the one edge back into `working` is cap-checked on
`POST /api/runs/:id/advance`) and `maxSessionsPerDay` (default 12 —
dispatches inside a rolling 24h window, not a calendar day), both checked at
`POST /api/runs/:id/dispatch` before anything else is touched. **Review runs
are dispatches**, so a programme that made N dispatches per wave now makes
about 2N; the seed `maxSessionsPerDay` of 12 covers roughly 6 waves a day,
not 12 — raise the dial through `POST /api/coord/caps` when a programme
runs hot rather than discovering `cap-daily` mid-wave (§7.3). Both are an
operator control: `GET`/`POST /api/coord/caps` reads them beside their current
usage and writes either or both, bounds-checked, and the `/runs` board renders
the dial. (For a stretch of this build's history there was no route at all and
an operator edited the row with `sqlite3` — hence `CoordStore.setCaps` having no
caller in the server for as long as it did.) Like every other same-origin PWA
write the caps route carries **no box token**; unlike the operator doors named
above (`/api/coord/pause`, `/api/runs/:id/abandon`, `/api/claims/:id/break`,
`/api/runs/:id/reclaim`) it is not a release valve, so nothing may rely on it to
open a wedge.
Pause is a
**file**, on ccd's own `*-disabled`-marker convention, read from `$REG`
(the fleet host's session registry, `~/.cc-sessions`) before every dispatch:
`touch $REG/coordinator-paused` refuses every dispatch with `409
refused:paused`; `rm` it to resume. There is no verb or route that can
unpause the coordinator from the API or the PWA — a pause always traces back
to a human at a terminal, on purpose. Mail delivery has the identical
kill-switch on the same pattern: `touch $REG/mail-disabled` stops the sweep
from injecting anything (queued mail waits, nothing is lost); `rm` it to
resume. Dispatch honours this marker too, not only `coordinator-paused` — it
refuses outright (`409 refused:'mail-disabled'`) rather than resuming a
worker and injecting `/clear` into a context whose wave brief would then sit
held by the very kill-switch the operator just raised.

**The honest boundary.** The coordinator acts through this server's HTTP
API — one recorded chokepoint for every irreversible act (dispatch, close,
mail) — and that chokepoint is what makes the caps and the pause file real
controls rather than suggestions. But raw ccd remains physically possible:
every session on the fleet host shares one UNIX user, ccd has no caller
auth, and any session can already run any verb directly. Nothing
server-side stops that. The single recorded chokepoint is a contract the
coordinator's skill honors, not a wall the OS enforces — the same "identity
is attribution, not authentication" stance the mail bus already states for
who a message claims to be from.

### Graph layer (graphify)

**graphify** keeps one AST-derived knowledge graph fresh per git tree on the fleet host.
`ccrc install`/`update` provision it in six role-gated steps (a server box has no rostered wrapper
homes to graph, so all six skip there): an **engine**, a ccrc-owned venv at
`~/.ccrc/graphify-venv` (`pip install graphifyy==$GRAPHIFY_PIN`, the single-definition pin in
`ccd/ccrc`, resolved everywhere by absolute path rather than `command -v` — a shared box's
`/usr/local/bin/graphify` can be a root-owned symlink an unprivileged install can neither update nor
remove); a **skill**, assembled from the *installed package* — unlike the coordinator/worker
skills, it has no vendored tree — into every rostered account's skills directory; the **read-rule
removal** (below), which takes back what D-1243 wrote into each rostered home's `CLAUDE.md`; the
**default noise list**, ccrc's own footprint converged to
`~/.ccrc/graph-noise/_default.list`; **excludes**, `graphify-out/` and `.graphifyignore` converged
into each tree's common-dir `info/exclude`; and **legacy hooks off** — the old per-repo graphify git
hooks are removed if wholly graphify-generated, left in place and reported if they chain other
content. (`server/test/ccrc-install.test.ts` pins that sequence, and
`ccrc-install-graphify.test.ts` pins this paragraph's count against it — the enumeration went stale
for two deviations before that guard existed.)

**Reading the graph, which is a separate problem from keeping it fresh.** Everything above serves
the WRITE path, and for three deviations nothing served the read path at all: measured across the
five rostered homes, the rule "for codebase questions, run `graphify query` first" appeared in
**none** of them. D-1243's answer was graphify's own packaged block, `always_on/claude-md.md`,
appended to every rostered home's config-dir `CLAUDE.md` between ccrc's markers — and **D-1245
retired it**, because it was wrong on two counts. That block is written for a PROJECT file ("This
project has a knowledge graph at graphify-out/"), so account-wide it asserted that of every project
the account opens, including the trees the sweep refuses; and the file is the *operator's*, not
ccrc's, which is the sole reason every one of D-1244's six data-loss classes existed at all.
Measured over the one day since it was deployed (2026-09-01, measured 2026-09-02): 109
`query`/`path`/`explain` calls across 4 corpora, 103 of them in the one repository whose *project*
`CLAUDE.md` had carried graphify's block since July, and zero in ccrc-pwa — the busiest project on
the fleet, with five fresh graphs. (The block's own week-shaped window is a different row of the
spec's table — 265 calls across 11 corpora over the last 7 days, ccrc-pwa **zero** in both.)
`_inst_graph_always_on_off` now takes the block back, reusing D-1244's own hardened census:
whole-line markers, exactly one well-ordered pair or the file is left alone, symlinks resolved (and
SKIPPED when they cannot be), the file's own mode preserved, backed up before every write. Anything
else is *left in place; remove by hand*, counted, and reported as a degraded step. It is
`_inst_graph_hooks_off`'s shape and stays in the tree the same way. What replaced it — starting with
the `SessionStart` card that tells a session to run `graphify query` before it greps — is below.

**What replaced it: four mechanisms, each in an artifact ccrc owns outright.** The rule D-1245 states
is that the read side lives only where ccrc owns the file it is written in, and that its effect is
*measured* rather than asserted.

- **The graph card (R1).** On `SessionStart` — every source, `compact` included, because compaction is
  exactly when a session loses what it knew — `ccd/session-hook.sh` prints one JSON object on stdout:
  `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`. The card is
  measured for *that session's tree* (`cwd` from the payload, `$REG/<id>.workdir` as the fallback):
  node count, the commit the graph was built at, how that commit stands to `HEAD`, and the
  engine/pin pair — sessions were measured querying 0.9.9 graphs with an unversioned July build, and
  that drift is otherwise invisible until a query fails strangely. Every clause is omitted rather than
  guessed when its read does not answer. Freshness is **content first, then ancestry** (D-1368,
  D-1353). CONTENT decides first: a graph whose `built^{tree}` equals `HEAD^{tree}` describes this
  tree exactly, so it is `fresh` however its commit stands to `HEAD` — a squash merge rewrites the
  commit and keeps every byte — and that is printed as `fresh — same content as HEAD` when the
  built commit is not `HEAD` itself, a qualifier on the state rather than a state of its own, so a
  reader can tell "built here" from "built elsewhere, same bytes" while still branching on the one
  word. Only when the trees DIFFER does ancestry decide, and there it is **ancestry, not
  distance**: the card says `fresh`, `N commits behind HEAD`, `not an ancestor of HEAD` — the graph
  was built on a tree this session cannot reach, so it describes code the session does not have —
  or `freshness unmeasured`, which is said out loud rather than left silent, because a card that
  names a sha and then says nothing about it reads as neutral. No `graph.json` prints **nothing**, except that when
  `~/.ccrc/graph-sweep.json` carries a row for the tree the sweep's own refusal reason is printed
  instead, clipped to 400 characters (it is repo-controlled text off an engine's stderr).
  `built_at_commit` is the last key of an 8 MB `graph.json`, so it is read with `tail -c 4096`, never
  by parsing the file; the node count comes off `GRAPH_REPORT.md`'s summary line with `head -c 4096`,
  because neither the census nor `manifest.json` carries one (D-1246); the freshness pair are git ref
  reads. **Stdout is this card on `SessionStart` — with the compaction card appended
  to it on the `compact` source alone (R8, below) — the search gate's deny on a gated `PreToolUse`
  (R5, below) and the Read nudge's `additionalContext` on a nudged one (R6, below) — at most one of
  those two per event, and empty on every other event**, because a stdout JSON on `PreToolUse` is
  read as this hook having something to say about the call, and it says nothing there unless it
  does. All three are pinned in both directions by `server/test/session-hook.test.ts`.
- **Worker clause 12 (R2).** `ccd/worker-skill/SKILL.md` now carries fifteen clauses (thirteen at R2; routing slice 2 added 14 and 15), pinned verbatim: a
  workspace with a `graphify-out/graph.json` takes a codebase question to `graphify query` before
  `grep`, **weighted by the card's freshness word** — only `fresh` licenses taking an answer as read,
  and every other word makes a query answer a lead to verify by opening the file it names — and never
  runs `graphify update` or any build in the workspace, because a session-side build holds the worker
  at `working` for minutes and wedges the next dispatch `worker-busy`.
- **The engine on `PATH` (R3).** `_inst_graphify_engine` converges `~/.local/bin/graphify` onto
  `~/.ccrc/graphify-venv/bin/graphify`: written when absent, left alone when it already resolves into
  the venv, and backed up (`.pre-ccrc-<UTC>`, `cmd_wrappers`' own discipline) and repointed by an
  atomic rename when what is there is a pip console-script shim — matched **by content**, through a
  symlink as readily as directly, so the `pipx` layout is a shim like any other (D-1351). Anything
  else is **refused with a remedy** and counted as a degraded step: a hand-written launcher is the
  operator's, and a link this box cannot resolve is *unmeasured*, never *unequal* (D-1348, D-1352).
  `/usr/local/bin/graphify` is never touched. Doctor's own `graphify-path` check owns the same
  question from the other side and **FAILs** (it does not warn) when nothing on `PATH` answers
  `graphify`, when there is no pinned engine to compare against, or when `command -v graphify`
  resolves anywhere but the venv — the wrong build's answers are indistinguishable from the right
  build's. A box with no usable `realpath` **SKIPs**: the two halves must agree that an unresolvable
  pair is unmeasured, or a box neither of them could measure gets two different verdicts (D-1350).
- **The number (R4).** The hook increments `graphQueries` in the hookstate it already writes, on a
  `PostToolUse` whose `Bash` command runs `graphify query`/`path`/`explain`. Builds do not count — this
  measures reads. It is carried the way `subagents` is, reset on any `SessionStart` that is not a
  `resume` (D-1248) and kept across `resume` and `compact`. `server/src/hookstate.ts` is its one reader
  on the server side and keeps **`null` (no field — an older hook) apart from `0` (measured none)**; it
  rides `FleetSession.graphQueries` additively (no `FLEET_PROTO` bump) and renders as a `graph N` chip
  on the fleet card and on the run board's worker row, both reading it through the single tolerant
  reader `graphReadCount` in `shared/api.ts` — an older server omits the field, and a row that reported
  nothing must not paint as one that reported (D-1251). The server never reads
  `~/.cache/graphify-queries.log`: it is not under the agent whitelist and this design adds no read
  root.

**The search gate (R5).** The `PreToolUse` speed bump — one deny on a session's first `Grep` in a
tree with a fresh graph and a `graphQueries` of 0 — was **declined** on 2026-09-02 and **built** on
2026-09-05 by operator ruling, on R4's own number (**D-1613**). The decline stands as the history
that ruling reversed, and its three grounds were good ones: `PreToolUse` fires for subagents, which
never saw the card; a deny path would be the first thing in the hook that can wedge a turn; and R4
is what makes adoption measurable, so a gate belongs *after* the number says the card and the clause
did not move it, not before there is a number. The number was taken two days after the read side
deployed and recorded as D-1613 in
`docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md`'s `## Deviations found`: 4
graph queries fleet-wide over 3 corpora, and of 18 live sessions 10 carried `graphQueries` 0, two
carried 1, one carried 2 and five carried nothing at all. The card and clause 12 had moved nothing
the counter could see, so the ask became a deny — and each of the three grounds is answered by the
mechanism rather than by prose.

**What it gates:** `Grep`, `Glob`, and a `Bash` command that *heads* with a search — `rg`, `grep`,
`egrep`, `fgrep`, `ugrep`, `ag`, `ack`, `find`, `fd` or `git grep`, after at most one `cd … &&`
prefix and any run of `FOO=bar` assignments. A search at the *tail* of a pipeline
(`vitest run | grep Tests`) filters output this session already produced and is not a codebase
question, so it is not gated; `Read` is not gated either, because a named file is not a question;
and `graphify` itself is never gated — the gate must not stand between a session and the one command
that opens it.

**When it is armed — all five, or the hook prints nothing and the call proceeds:** the operator's
kill-switch `~/.ccrc/graph-gate-off` is absent; the session's tree carries a `graphify-out/graph.json`
whose stamp the card's own `tail` read accepts; that graph reads `fresh`, `fresh — same content as
HEAD`, or at most 10 commits behind `HEAD` (further behind, `not an ancestor of HEAD` and `freshness
unmeasured` do **not** gate — the card has already told that session its graph is stale, and gating
on it would be enforcing a bad answer); `graphQueries` is 0; and `graphGateDenials` is under 3. The
`SessionStart` card says which of the two it will be, and says it only where the gate is really
armed: a card promising a deny that never comes teaches the session to ignore the card.

The deny is the one shape `PreToolUse` defines — a `permissionDecision` of `deny` with a reason —
and the reason is the card's own vocabulary plus the act: this tree has a knowledge graph (node
count and freshness word), this session has not queried it yet, search opens after one
`graphify query` (`path` and `explain` spelled out beside it), and *Denial k of 3; after 3 the gate
opens anyway.* **Everything else fails open, and so does the bound.** An unreadable hookstate, a
missing `jq`, an unresolvable tree, an unparseable stamp, a graph that is not there: no stdout, and
the call proceeds. Three denials without a query and the fourth search passes — a session that
cannot run `Bash` at all is never wedged by a hook it has no way to satisfy — and a denial is
counted only when its JSON could be built, and *said* only once it is counted: the envelope is built
in the arm and printed after the hookstate write lands, because a deny the next event cannot see
reads `Denial 1 of 3` forever on a registry that will not take the write, and the one query that
would open the gate is lost by the same failed write (D-1689, measured before the fix). What the gate
cannot tell is bounded and recorded rather than fixed (D-1690): it measures the tree named by the
call's `cwd`, not the directory a `cd` inside a `Bash` command will land in; `find … -delete` heads
with `find`; and two subagents denied in the same instant can each count the same denial once. All
three stop at three. Nothing but a gated call in an armed session pays for any of it: every other
event, and every other tool call, costs the two integers the hook already had in hand.

`graphGateDenials` rides beside `graphQueries` in the same hookstate and through its own single
tolerant reader (`null`, an older hook, is never folded into `0`), resets with it on any
`SessionStart` that is not a `resume` — so a dispatched worker meets the gate once per wave, and a
`/clear` by hand re-arms it — and reaches the board additively on `FleetSession`: the `graph N` chip
reads `graph N · gated k` when k > 0, and only then, because a measured `gated 0` is the ordinary
state of a session that queried first and a suffix on every healthy row would bury the rows where
the gate actually fired. `ccrc doctor`'s `graphify` line carries `gate on` or `gate off (operator
file $HOME/.ccrc/graph-gate-off)`, whatever else that check has to report. The kill-switch is the
operator's, nothing in this tree writes it, and it needs neither a deploy nor a token:
`touch ~/.ccrc/graph-gate-off` opens every search on the box, `rm` closes them again —
`$REG/coordinator-paused`'s own shape, a convention with a speed bump. The next reading is the
gate's own effect: denials beside queries, on a dated day after this deploys, recorded under D-1613
in the same ledger.

**The Read nudge (R6).** The gate leaves `Read` alone — a named file is not a question — so a session
can navigate file by file and never meet it, and the operator's ruling of 2026-09-06 (**D-1745**)
closes that hole fleet-wide as a **nudge, not a deny**: a `Read` is never denied, in any state the
gate can be in, because `Edit` requires a prior `Read` and denying one would charge every session
told to fix a named file one denial before its first edit. What made the hole worth closing is
D-1746's measurement of what graphify itself ships: its own project hooks nudge on `Read`, and 330 of
the 345 queries in the week before the read side shipped came from the seven projects where someone
had run its installer — four of them in untracked files a fresh clone or worktree does not carry —
while ccrc-pwa, with five fresh graphs and no such file, sat at zero.

**What is nudged:** a `Read` whose `file_path` ends in one of the 28 source and doc extensions
graphify 0.9.9 itself nudges on (`_HOOK_SOURCE_EXTS`, spelled once in the hook as
`GRAPH_NUDGE_READ_RE` and harvested by the suite rather than retyped, end-anchored and dot-prefixed
so `.json` can never match `.js`), and whose path carries no `graphify-out/` segment at any depth —
the card already sends that session to `GRAPH_REPORT.md` by name, and nudging the read it asked for
would have the two halves of one mechanism contradict each other. **When it is armed:** the gate's
own conditions 1–4, shared with it rather than copied — the kill-switch `~/.ccrc/graph-gate-off` is
absent, the tree carries a datable `graphify-out/graph.json`, freshness reads `fresh`, same-content
or at most 10 commits behind, and `graphQueries` is 0 — and *not* the fifth: there is **no bound and
no counter**, because advice spends no denial and stops the moment the session queries, so the
reading that measures it is R4's own, how soon `graphQueries` leaves 0 in a session that reads first.
The envelope is an `additionalContext` with no `permissionDecision`, so the call proceeds, and it
reads: *graphify: this tree has a knowledge graph (N nodes, <freshness>) and this session has not
queried it yet. Before reading files to orient, run: `graphify query "<your question in plain
words>"` (`graphify explain "<concept>"` for one concept). Reading a named file to edit it needs no
query.* It is printed from the deny's own print site, after the hookstate write lands (D-1689), so at
most one line ever leaves a `PreToolUse` — a `Read` is never gated and a `Grep`/`Glob`/`Bash` is
never nudged — and everything the gate fails open on, the nudge fails open on too. The card's armed
sentence now says both halves (*search tools … are gated, and source-file reads are nudged, until
this session's first graph query*), and the off-sentence and the doctor's `gate on` / `gate off` need
no second form, because `graph-gate-off` is one kill-switch for both.

graphify's own hooks are left exactly where they are and **coexist** (D-1746): `graphify hook-guard
search` and `graphify hook-guard read`, written into a project's `.claude/settings.json` by its
installer, nudge on every matching call, never block, never look at freshness, and reach only the
projects where someone ran that installer — vanishing from a fresh clone or worktree wherever that
file is untracked. ccrc's half is the fleet-wide one: it reaches every tree on the box with no
per-project act, it weighs the graph's freshness before it says anything, and it stops the moment the
session queries — until then the nudge rides every matching read and the deny at most three searches,
where graphify's keeps nudging for the life of the session (D-1797 corrected an earlier "once per
session" here that the mechanism never had).

**The two ccrc subjects (R7).** Two more subjects share the same `SessionStart` card, both fleet-registry
reads rather than graph reads: the co-tenant subject and the program subject. Neither narrates — each
says only what it measured — and both sit behind the same kill-switch and the same total clip, described
below.

The **co-tenant subject** counts other rows in `~/.cc-sessions` whose `.project` names this session's own
and whose `.supervised` heartbeat is inside `CCRC_FRESH_S` (120 s — a third copy of `SUPERVISED_FRESH_MS`,
outside every `single-definition` root because `ccd/` is not one of them). The rung is the heartbeat, never
`.archived` — the same ruling `server/src/coord/peers.ts` already made for the peers route (D9): one row
on this box has carried `.archived` for 33 days beside a 4-second-old heartbeat while the server still
calls it `deliverable:"yes"`, and a main checkout can never be archived at all, so an `.archived` filter
would both over- and under-count. It says *"ccrc: 2 other supervised rows name project `alpha`;
`~/.local/bin/ccrc-api peers list --of <id>` names them and returns the five peer rules"* (singular "row
names" at one), and it deliberately never says "live" — `_swap_beat` re-stamps `.supervised` through a
whole `cp -a` swap carry on purpose, and 6 of 16 rows have gone silent for 5 h while the server still reads
them `deliverable:"yes"` — or "share" — the 7 ccrc-pwa rows on this box resolve to 7 distinct workdirs on 6
distinct branches, sharing a registry string and not a byte on disk. A row whose own `.project` could not
be read still counts toward the total (fleet-scoped, not project-scoped: an unmeasurable row could belong
to any project and cannot be ruled out) and turns the count into "at least N" rather than dropping the
row or reporting an exact one; a lone row (`CT_N` of 0) is silence, never a "0 co-tenants" sentence. It
prescribes the client verb `peers list`, never the route — the 200 that route returns carries
`PEER_ETIQUETTE` verbatim, whose rule 0 is "claim before you edit" — so the card points at the authority
instead of paraphrasing it, and `claims-advisory.test.ts`'s FORBIDDEN scan stays green.

The **program subject** quotes `$REG/<id>.hold` bytes verbatim and never narrates: `rundefs.ts` declares
the hold reason is parsed back nowhere in this tree, `wave-lifecycle.md` forbids inferring a wave from it,
and the coordinator skill's own ban on inferring a role is pinned verbatim by its test — one program on
this box revised its own wave count five times (1/5 → 2/6 → 3/6 → 4/6 → 5/7 → 6/7 → 7/8 → 8/9), so "wave 3
of 6" would have been wrong five times over. The shape gate is the sanitiser too: a hold that fails its
own bounded form (`program:<slug> wave:N[/M][ run:R]`, capped at `CCRC_HOLD_MAX` = 127 — one under the
128-byte read cap, so refusing at 127 means every value this subject ever quotes was captured whole and
never a silently truncated prefix that could lose its ` run:` suffix in the cut) is unspeakable and the
subject is silent, same as an absent hold. Five distinct sentences cover what a **present** `.hold` can
mean — the first two are what the file's presence alone can say, the last three what its bytes say:

- **Unreadable** (exists, not a readable file): *"ccrc-program: this workspace is held and the hold's
  reason could not be read — `~/.cc-sessions/<id>.hold` exists but is not a readable file. Every other
  reader on this box treats that as HELD. If a program wave is running here,
  `~/.local/bin/ccrc-api runs list` is the only thing that can say so."*
- **Present and empty** (readable, and carrying no reason — `ccd ws-hold` refuses to write one that way, so
  a `touch` or a hand-edit did; this is the same shape `registry.ts` calls `HOLD_NO_REASON` and renders
  `<hold file is empty — no program named>`, and the same one `ws-rm`/`ws-reap` refuse on without reading a
  byte): *"ccrc-program: this workspace is held and the hold names no program — `~/.cc-sessions/<id>.hold`
  is present, readable, and carries no reason. … Every other reader on this box treats a present `.hold` as
  HELD."* It gets its own sentence rather than the unreadable one, whose "is not a readable file" would
  itself be false here, and rather than the silence it fell to before.
- **Archived but still held** (`cmd_ws_archive` does no registry `rm`, and the failed+archive close path
  releases nothing, so the bytes outlive the workspace): *"ccrc-program: this workspace is stamped ARCHIVED
  and still carries a claim — `~/.cc-sessions/<id>.hold` reads `<h>`. An archive does not clear a hold, so
  those bytes are the residue of a claim, not an assignment. Take that to the operator rather than starting
  a wave on it."*
- **Names no run** (no ` run:` suffix — a close claimed the workspace for its next wave, or a human wrote it
  by hand, no dispatch placed it): quotes the hold, says the bytes *"name a program and a wave — what the
  `ccrc-worker` skill is for"*, says *"It names NO run"*, and sends the session to
  `~/.local/bin/ccrc-api runs list` before acting on it.
- **Names a run**: quotes the hold, recommends the same skill, and adds where a brief would be listed
  (`~/.local/bin/ccrc-api mail list --to <id>`, noting an already-acked brief is not listed again) and the
  caveat that the hold can outlive the run that wrote it — whether that run is still open is answered only
  by `runs list`, never by this file.

  Neither sentence describes the skill's *internals*, and that is deliberate (D-1922): they used to call the
  hold the skill's "declared trigger" and to name the skill's "first read", and both were false — the
  declared trigger is `program:<slug> wave:N/M` **and** "you are not the session that opened the run", while
  the hook's gate accepts the `wave:N` shape `holdReason` writes when `waveOf === null` and cannot measure
  the second condition at all; and the skill's first read is `ccrc-api whoami`, with `mail list` appearing
  nowhere in it. A card that recommends a skill can be honest; one that describes it goes stale the moment
  the skill is edited.

One emitted string, two referents: the graphify subject measures the payload's `cwd`; the program subject
measures the tmux session id. A session that `cd`'d, or a second window opened on the same held id, makes
"this workspace" and "this tree" different subjects with no way for the reader to tell — so on
disagreement, or when the cwd could not be measured at all, the card drops the demonstrative and names the
workspace by path instead: *"the workspace `<id>` (`<workdir>`)"*. That path is gated exactly as the hold
bytes are, and for the same reason: `$REG/<id>.workdir` is registry text landing verbatim in a model's
context, in a file any session on this box can write, so it carries both a path-shaped `case` class
(`CCRC_WD_CLASS`, derived from `CCRC_PROJ_CLASS` with `/` prepended) and a length bound one under the
128-byte read cap (`CCRC_WD_MAX`, derived from `CCRC_ID_MAX` so the off-by-one is a mechanism and not a
number kept in step by hand). A path failing either is **unspeakable**: `wd` becomes empty, which restores
the plain demonstrative rather than asserting a disagreement the hook cannot measure. Without the length
bound a workdir longer than 128 characters that the cwd **equals exactly** came back truncated, compared
unequal, and made the card claim a directory disagreement that did not exist beside a path that did not
exist.

**One emit.** The three builders — `_hook_graph_card`, `_hook_hold_card`, `_hook_ccrc_card` — only set
text; nothing prints until the `SessionStart` arm joins whatever they set with one space
(`${CARD:+$CARD }`, appended only when a prior subject already put text in `$CARD`, so a lone subject
carries no leading or trailing space) and calls `_hook_emit_context` exactly once. A second
`additionalContext` envelope on the same event makes the harness's stdout parser throw — the caller returns
`{answer:{}}`, deleting every card fleet-wide, graphify's included, with a warning that blames a quoting
bug that does not exist. `_hook_emit_context` is also the one site that clips the assembled total:
`CARD_MAX_CHARS` (2400) is a different bound for a different job than the `<600` assertion elsewhere in the
suite, which taints one repo-controlled field alone (the graph sweep's refusal reason) and stays exactly as
it is; `CARD_MAX_CHARS` is the ceiling on graphify + hold + co-tenant + their two one-space joins together.
Since the compaction card landed (R8, below) it is the FIRST of two clips rather than the only one, and the
arithmetic below is untouched by that: `_hook_emit_context` takes an optional SECOND argument, clips the
standing subjects to `CARD_MAX_CHARS` exactly as before, clips that second subject to its own
`COMPACT_CARD_MAX_CHARS` (4000), and bounds the joined envelope by `CARD_TOTAL_MAX_CHARS` — DERIVED as
`CARD_MAX_CHARS + 1 + COMPACT_CARD_MAX_CHARS` (6401) and never a third budget kept in step by hand.
`CARD_MAX_CHARS` is still the only defence the ungated node count has, which is why it does not move.
It is argued from the **structural** worst case, not the live one: the worst combination measured on this
fleet is 593 + 592 + 176 + 2 = 1363, but the worst the code can produce with every gated field at its own
cap, re-measured end-to-end against a fixture HOME rather than hand-counted (2026-09-08, correcting the fix
wave's own arithmetic), is graphify 719 (a 12-digit node count, engine and pin each at their 64-byte
`head -c` cap, the longest freshness phrasing the code can produce — `fresh — same content as HEAD` — and
the armed-gate sentence present) + held case A **860** (a 127-character workdir, a 127-character hold whose
reason names a run — the longer of the two case-A sentences the code can emit — and a 40-character id,
**modelled**: `$id` carries a shape gate but no length bound and appears more than once across these
sentences, so this is an assumption and not a ceiling; the longest id live on this fleet today is 29,
`expoAI-assistant-keen-prairie`) + co-tenant 245 (a 64-character project and a two-digit count — `$CT_N`
is interpolated un-padded and the singular and plural halves are the same length, so the count's digits are
the whole of the difference: 244 / 245 / 246 at one, two and three digits, and the fleet's live shape is
two) + two joins = **1826**, not the fix wave's 1768 — its own 801 for held case A undercounted the true 860
by 59. Against 1800 that is **not** headroom: 1826 exceeds it by **26 characters**, and re-running the same
combination against a copy of this file with `CARD_MAX_CHARS=1800` clips the assembled card mid-word inside
the co-tenant sentence (`… returns the five peer rules.` cut to `… re`) — exactly the mid-word loss the join
order (graphify → hold → ccrc) was already named as risking. 1800 did not comfortably clear its own
structural worst case; it carried **negative** headroom against it, so the raise to 2400 closed a
silent-truncation risk rather than widening a comfortable margin. 2400 clears 1826 by **574 characters**
(about 31%) and is still under 10% of the neighboring `~/.cc-handoff/restore.sh` hook's own 24576-byte
`additionalContext` cap on this same compact event. It is a ceiling and never a budget to spend up to: the
node count is ungated (`grep -oE '[0-9]+ nodes'` is
unbounded repetition inside a 4096-byte head) and can exceed any bound on its own, which is why the clip
exists at all and why the number above only has to cover the fields that **are** gated. It is also what stands between an operator-controlled field and `jq`'s own `MAX_ARG_STRLEN`
(measured 131072 on the fleet host): past it the `jq -cn` exec fails, `|| return 0` swallows it, and the
hook prints nothing at all — deleting the graphify card too.

**The kill-switch.** `~/.ccrc/ccrc-card-off` is the operator's own file, the same shape as
`~/.ccrc/graph-gate-off` and `$REG/coordinator-paused`: touched by hand, in a directory ccrc owns and
nothing in this tree writes, releasable without a deploy and without a token. `_hook_hold_card` and
`_hook_ccrc_card` each check it first and return early; `_hook_graph_card` never consults it, so it
silences the two ccrc subjects only — the graphify card (and its own `graph-gate-off`-governed gate
sentence) is unaffected.

**The two counters.** `ccrcPeerReads` and `ccrcClaims` ride in the same hookstate write the graph counters
use, carried the same way — reset on any `SessionStart` whose source is not `resume`, kept across `resume`
and `compact` — and read back by the same guarded jq fork, each behind its own `^[0-9]+$` degrade. Each
counts an act, not a client: `ccrcPeerReads` increments on a `PostToolUse` `Bash` command matching
`peers[[:space:]]+list`, `ccrcClaims` on one matching `claims[[:space:]]+take`, both anchored on the
**verb pair** and never on `ccrc-api` — both skills set `API="$HOME/.local/bin/ccrc-api"` and then call
`"$API" peers list`, so a counter anchored on the client name would score 0 against the exact spelling
the fleet uses, and the hook reads the unexpanded command text. `ccrcPeerReads` is the proximate act
the co-tenant card prescribes; `ccrcClaims` is the distal one that answer's own rule 0 prescribes next, and the one with
a durable server-side arbiter — counted apart because each answers a different question about adoption.
Unlike `graphQueries`/`graphGateDenials`, neither reaches `FleetSession` or any wire field:
`server/src/hookstate.ts` needs no change, because its reader validates named keys and returns an
object literal built from those names, with no key census — an unknown key is simply never looked at.
Both counters live only in the raw `~/.cc-sessions/<id>.hookstate.json` file on the fleet box:
hookstate-only, no server change, no PWA-visible chip.

**The compaction card and its journal (R8).** Compaction is the one moment a session loses what it knew,
which is why the graph card above is served on the `compact` source like any other. Since
`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` (Plan A) the hook does two more
things at that moment: it builds a SECOND card — the files this context was working in, with their symbols,
community and dependents read out of the same graph — and it MEASURES the compaction, writing one line to a
per-session journal. Three arms of `ccd/session-hook.sh` do it, and **none of them opens a new output
channel**: the card rides the one `additionalContext` envelope `SessionStart` already prints — the compact
arm calls `_hook_emit_context "$CARD" "$CARD_COMPACT"` (`ccd/session-hook.sh:2900`), which appends the second
subject under its own `COMPACT_CARD_MAX_CHARS` ceiling (`:97`) before the single `jq -cn` print (`:103-105`) — and `PreCompact` and
`PostCompact` print nothing at all. `PreCompact` decides whose transcript is compacting and publishes the
working set, `SessionStart(compact)` serves the card once beside the graph card in that one envelope, and
`PostCompact` measures the summary and commits the journal line. No compaction MEASUREMENT reaches the server, the wire or
the PWA: there is no compaction field on `FleetSession`, no chip, and no hookstate cache. The one thing that
does cross is ccd's purge refusal vocabulary — `purge-refused`, `purge-incomplete` and
`purge-mechanism-absent` (`shared/api.ts:7474-7476`), each with an operator sentence of its own at `:7514`,
`:7522` and `:7535`, which the session History tab renders through `lcRefusalWord`
(`pwa/src/session/HistoryTab.tsx:17`, rendered at `pwa/src/session/HistoryTab.tsx:61`). The journal is the whole deliverable, and reading it is a later
plan's job.

- **What lands on the fleet box.** Four dot-free registry files per session id, beside the
  `hookstate.json` above, and one dot-leading mutex: `~/.cc-sessions/<id>.compactset` (the working set
  `PreCompact` publishes, consumed by `PostCompact`), `<id>.compactcard` (the card itself — served ONCE and
  deleted), `<id>.compactions` (the journal `PostCompact` appends — it copies the existing file into a
  private stage, re-validates every line it already held and commits by rename, but it never interprets a
  record or derives state from one), `<id>.generation` (the row's authorization, below) and
  `.<id>.compactions.lock` (one permanent mutex per row, deliberately not slug residue). The helper that
  builds the card is plain node beside the hook,
  `~/.cc-sessions/compact-card.mjs`, installed by `deploy.sh`'s agent lane and by `ccrc install`, backed up
  by `ccrc update` and removed by `ccrc uninstall` — all four doors, so a box an operator believes is off
  ccrc really is.
- **Reading the journal.** It is JSONL: one complete JSON object per physical line, appended in order.
  Each record carries exactly SIXTEEN keys and no ordinal — a reader derives which compaction a line was
  from its physical position in the file, because a persisted counter under concurrent writers is derived
  state with a race of its own. The keys are the measurement (`at`, `chars`, `filesChars`, `fences`,
  `cited`, `setSize`), the verdict (`trigger`, `scope`, `served`, `steered`) and six provenance fields
  (`cwd`, `built`, `agent`, `transcript`, `parentLive`, `liveAgents`). `scope` is `main`, `subagent`,
  `ambiguous` or null: the hook answers `ambiguous` where it cannot tell whose transcript compacted rather
  than guessing, and a record it cannot vouch for carries ALL six provenance fields null rather than some
  of them — a partial list is refused outright and the line is never written. Every field is a fact about
  the transcript, so a journal can be audited offline against the transcripts themselves. Nothing in
  `server/src`, `agent/src`, `pwa/src` or `shared/` reads a `.compactions` file — measured — so `jq` over
  `~/.cc-sessions/<id>.compactions` on the fleet box is the whole reading interface there is today. The
  scope is SHIPPED SOURCE and the narrowing is the measurement, not a hedge: five files under `server/test`
  do read or name the artifact, so the wider claim is false where this one is true.
- **The lock and the generation.** Every compaction-lifecycle mutation runs under that one per-row mutex,
  which is published by a private `mktemp` source plus a POSIX hard link and is NEVER opened at its
  canonical pathname — each holder opens a verified private alias and re-checks the descriptor against the
  canonical inode before it mutates anything. `<id>.generation` is an immutable UUID minted when the row is
  created and exported into the pane's environment as `CCRC_SESSION_GENERATION`; an arm whose copy does not
  match the row's refuses. THREE states leave a pane without that copy — a row created before this shipped
  has no generation at all, a `_spawn_start` that loses the lock fails OPEN and spawns without exporting one
  rather than wedging a swap, and a box where `flock`, `mktemp` or `link` is off `PATH` cannot take the lock
  to read one. Any of the three leaves that pane's compaction lifecycle simply INERT until its next respawn.
  THE FIRST IS NOW REPAIRED BY THAT RESPAWN RATHER THAN MERELY OUTLIVED BY IT: `cmd_ensure` mints a missing generation before it spawns (`_reg_generation_init "$id"`, `ccd/ccd:20970`), best effort and never fatal, because this is the supervisor's path and a verb that dies here leaves the session down. It had to be that verb — the other two minting sites are row CREATION, and the unit runs `ccd supervise`, which calls `cmd_ensure`. Measured before the fix, hours after the card first shipped here: 31 of 34 live rows carried no generation and no automatic path could give them one, so the sentence above promised a repair nothing performed.
  AND ALL THREE NOW SAY SO ON STDERR — the contended arm (`ccd/ccd:19776-19778`, `genrc == 1`) sits between an absent-or-invalid-generation arm and a mechanism-absent one. The silence this file recorded as a deferred `ccd/ccd` change is closed; the absence of the artifacts is still a signal, and no longer the only one.
- **What a purge does now.** `_reg_purge` takes the same mutex, so a row cannot be destroyed underneath a
  hook that is mid-transaction. It answers with THREE distinct statuses rather than a boolean — a pre-emit
  lock refusal (nothing deleted, no purge fact), a mechanism-absent refusal on a row that still holds a
  generation, and a post-emit removal failure, where the row IS destroyed, the purge fact IS journaled and
  the pathname that would not go is named. All four callers — `ws-rm`, `ws-reap`'s tail, `ws-gc --prune`'s
  dead-registry arm and `forget` — branch on the value. In practice: on a box with no usable `flock(1)`,
  `ws-rm`, `forget` and `ws-gc --prune` refuse a row that still holds a generation instead of racing it —
  the remedy is to re-run from a `PATH` where `flock` resolves — while a row with NO generation purges
  exactly as it did before, because no hook on it ever held one. `ws-add`, `ws-restore` and `ws-reap` keep
  the fail-closed refusals they already shipped.
- **Silence, and the kill-switch.** Every arm is silent by contract: a missing `flock`, an absent helper,
  an expired eight-second helper deadline or lock contention is a MISSED MEASUREMENT — no journal line —
  never a failed hook and never a word on stdout or stderr. `PreCompact` and `PostCompact` print nothing at
  all. The operator's off switch is `~/.ccrc/compact-card-off`, the same shape as `~/.ccrc/graph-gate-off`
  and `~/.ccrc/ccrc-card-off`: touched by hand, honoured by all three arms, no deploy and no token.

**The reading's instrument.** `~/.local/bin/graph-gate-snapshot` is the operator's own hourly carrier —
outside every checkout, no repo lane, no vitest — that reads the registry and every session's hookstate
file on the fleet host and rolls them into `~/.ccrc/graph-gate-readings.jsonl`: the graph gate's own
queries/denials, `nullPeerRead` (every row carrying no `ccrcPeerReads` field at all — its fall is what
proves the hook shipped), `heldN` and `coTenantN` among the roll-ups. It is the instrument the R4 and R7
adoption readings are taken from; nothing in this repository writes it, ships it, or tests it.

**The sweep.** `ccd-graph-sweep`, driven by `ccd-graph-sweep.timer` (`OnBootSec=5min`,
`OnUnitActiveSec=15min`), walks every tree under `~/projects` and `~/worktrees`, serialized by its
own flock, and writes a rolling census to `~/.ccrc/graph-sweep.json` (last 10 passes). A pass status
is one of `ok · paused · failed · probed-zero · no-trees-configured · pass-locked`; each tree's row
carries an outcome (`never-built · fresh · stale-rebuilt · restamped · refused-no-exclude ·
skipped-busy · skipped-budget · skipped-locked · refused-by-guard · timed-out · refused-shrink ·
failed`) and a reason. `restamped` is D-1509's: graphify's full rebuild exits 0 without writing
anything when the candidate graph's topology equals the existing one, so a build is re-measured on
`built_at_commit` — advanced, or the engine said "left untouched" and the sweep splices in the stamp
it skipped, or nothing is written and the row reads `failed`. A Claude Code worktree under a repo's
`.claude/worktrees/` is discovered too, but **only while a registered session's workdir names it**
(`~/.cc-sessions/<id>.workdir`, compared by realpath — Claude Code mints `agent-*` and `wf_*`
worktrees for its own isolation, and eight cold builds of throwaways starved the tree the rule was
written for, D-1563); project roots and ccd workspaces are discovered session or not. A tree with a
live, working session on it is deferred (the idle gate, tmux-free — read off the session registry
and its status file) unless it is ≥20 commits or ≥6h stale, the O3 escape hatch.
`touch ~/.ccrc/graph-sweep-paused` short-circuits every pass until removed — the brake for an
operator who needs the fleet host quiet.

**Noise lists.** Two sources, unioned, and they are not the same kind of thing.
`~/.ccrc/graph-noise/_default.list` is **ccrc's own**, converged by `ccrc install` and shipped on
the agent deploy lane; it carries only ccrc's own footprint (`.claude/`, `.remember/`,
`.superpowers/`, `CLAUDE.local.md`), because the artifacts ccrc's skills write into every repo a
session touches were otherwise held against that repo by the corpus guard and refused its build for
ever. `~/.ccrc/graph-noise/<repo>.list` beside it is the **operator's**, and ccrc never writes it.
One path-glob per line; together they become that tree's `.graphifyignore` for the sweep's own
builds.

The distinction between them decides every case where they would act differently: **a `<repo>.list`
is an instruction about one repo; the default is hygiene applied to repos that never asked.** So —

- A `!` (negation) line in **either** refuses the build outright. It would re-include something the
  real `.gitignore` excludes, and the sweep skips the tree rather than silently building past it.
  This one rule is symmetric: a negation is not an instruction anyone is entitled to.
- A tree that **commits its own `.graphifyignore`** refuses only when a `<repo>.list` exists (an
  instruction that cannot be honoured). With just the default in play the sweep stands down and
  measures anyway — otherwise shipping a default to every box would make that refusal universal.
- A **default** pattern is **withheld** when git says it would hide tracked content
  (`git ls-files -c -i -X`), and what was withheld is logged with the remedy named. `.graphifyignore`
  is a pure path filter that knows nothing about git, so without this a repo that commits `.claude/`
  or `.superpowers/` content would lose tracked nodes from its corpus — invisibly to the corpus
  guard, which measures corpus *minus* tracked — and graphify's shrink guard would then refuse the
  write, wedging the tree at `refused-shrink` on every pass. An **operator** pattern is honoured as
  written, tracked content included: that is the escape hatch, and the only one.
- **What git ignores AND the corpus actually picked up is derived into the same generated file**
  (D-1451, narrowed by D-1458). detect() reads `.gitignore` only along the ancestor chain from the
  VCS root **down to** the scan root, so a **nested** `.gitignore` below the root is never applied
  and its build artifacts entered the corpus untracked — refusing that tree for ever, with no remedy
  on the box (measured: synapsium-platform over `frontend/exposynapse-site/.astro/`, swift-harbor
  over `.husky/_/`). So the guard runs in two steps: write the noise patterns, run detect() **once**,
  and compute the breach (corpus ∖ tracked) it would refuse on. Then ask git whether each **breach**
  path is ignored (`git check-ignore --no-index -z --stdin`, one call, NUL-framed so a non-ASCII or
  backslash-bearing name round-trips raw; `--no-index` because git otherwise drops an input the index
  matches **as a pathspec**, i.e. a filename carrying a metacharacter), and derive one entry per
  ignored one — the path itself, anchored at the tree root with a leading `/`, or the **collapsed
  directory** containing it when git's `--directory` census names one, so a whole ignored tree costs
  one line. Only if something was derived is it appended and detect() run a **second** time.
  D-1451..D-1453 derived git's WHOLE ignored census instead, and the cost was measured and then
  accepted rather than removed: 308 entries on custom-tools, of which 22 covered a file detect would
  ingest at all — and on a 2000-file scratch fixture, 300 derived entries cost detect **43.3 s**
  against **1.4 s** with none, which is 1.4 s for a tree with no ignored files at all (D-1458). The
  second detect() is the one cost this shape ADDS, and it is measured too: on a tree that DOES derive
  the first run sees the ignored subtree unfiltered, so a 2000-file tree with a nested `.gitignore`
  over a 5000-file ignored subtree pays **4.4 s + 1.4 s** where the old shape paid one **1.4 s** run.
  That is **~+3 s**, paid exactly on the trees the derivation serves — a tree that derives nothing
  still runs detect() once — and bounded by the size of the nested-ignored subtree, not the corpus
  (the same subtree at 1000 files: 1.9 s).
  Uncapped, with the entry count logged in the pass output; every derived entry goes through the same
  `ls-files -c -i -X` probe as a default pattern, and a tree that owns a foreign `.graphifyignore`
  derives nothing — that file is not the sweep's to write. A filename carrying a glob metacharacter
  reads as a path to git and as a pattern to everyone else, and that seam is **three-way** (D-1453):
  the probe is `git ls-files -X`, i.e. wildmatch, where `*` does not cross a `/`; detect is
  `fnmatch`, where it does. So the probe alone cannot stand in for detect — a derived entry is made
  literal in BOTH dialects first (`*` → `[*]`, `?` → `[?]`, `[` → `[[]`), and the probe is the belt
  behind it; since D-1458 a withheld entry always means the tree is then refused over that path in
  the open, because it is only ever derived from something already in the corpus.

`ccrc doctor`'s `graphify` check (SKIP on a server box) reads the engine version against the pin,
per-home skill drift, per-tree excludes, the census's last pass, and free space on the
graph root (`~/worktrees`, falling back to `~/projects`) — the same 2 GiB FAIL / 10 GiB WARN floors
`disk` uses over `$HOME`.

**Reclaiming space (O7).** A graph is regenerable and disposable: `rm -rf <repo>/graphify-out` loses
nothing durable, and the next sweep pass rebuilds it cold (`shared/lifecycle.ts` carries this as the
project-graph-store class's own ruling).

**Bumping the pin.** Edit `GRAPHIFY_PIN` in `ccd/ccrc`, run `ccrc install` (or `update`) on the fleet
box, and expect every tree to re-stamp stale on the next sweep pass — a full-fleet rebuild over
roughly 8 passes at the sweep's own budget (`CCRC_GRAPH_BUDGET=8` builds/pass). Re-verify the
shrink-refusal literal the build discriminator greps for (the comment at its check in
`ccd/ccd-graph-sweep`) against the new version's installed `watch.py`/`export.py` before shipping —
the message has already moved once between minor versions.

### Temp-dir reaper (ccd-tmp-sweep)

Claude Code keeps each session's scratchpad and background-task output under
`${TMPDIR:-/tmp}/claude-<uid>/<project-slug>/<session-uuid>/`, agents write loose files straight
into that root, and nothing ever collected any of it: on 2026-09-22 the fleet host's
`/tmp/claude-1000` had reached 138G and put `/` at 94%. `ccd-tmp-sweep`, driven by
`ccd-tmp-sweep.timer` (`OnActiveSec=10min`, `OnUnitActiveSec=1h`, idle CPU/IO), removes a session
dir or a loose top-level entry only when **all** of these hold, and re-checks all three immediately
before each `rm`:

- **not live** — no live session id is in its path, read from every config dir's
  `sessions/<pid>.json` whose pid is running (roster config dirs from `~/.ccrc/accounts.sh`, plus
  `~/.claude*/`, plus each running claude's own `CLAUDE_CONFIG_DIR`); if claude is running and no
  sessions dir is readable at all, the pass refuses rather than treat everything as dead;
- **not in use** — no process has its cwd or an open fd at or under it (`/proc/*/cwd`, `/proc/*/fd`);
- **not recent** — nothing at or under it has an mtime newer than `CCD_TMP_SWEEP_MAX_AGE_DAYS`
  (default 7). Every entry is checked, not the dir's own mtime, which was measured to lie.

It never follows a symlink out of the root, never crosses a filesystem, refuses a root that does not
resolve inside `/tmp` or `$TMPDIR` or that another uid owns, and prints one summary line per pass to
the journal (`journalctl --user -u ccd-tmp-sweep.service`). `ccd-tmp-sweep --dry-run` prints what a
pass would remove and removes nothing; `touch ~/.ccrc/tmp-sweep-paused` short-circuits every pass
until removed. `ccrc doctor`'s `services` check warns when the timer is installed and stopped.

---

*Everything below is the internals reference — the architecture and the
mechanisms the operating sections above lean on. Nothing here is a
prerequisite for installing or driving a box; it is where you spelunk when
you need to reason about one.*

## Architecture

- `server/` — Node ≥22.13.0 (`engines.node`; `node:sqlite` needs it unflagged,
  and `server/test/node-floor.test.ts` pins both the declaration and the
  import) + Fastify (TS ESM). One process, systemd user unit
  `ccrc.service`, bound to one interface only (`CCRC_HOST:CCRC_PORT`,
  default `127.0.0.1:7788` — an exposed box keeps loopback and lets its
  proxy front it). One SQLite
  database, `~/.ccrc/coord.db`, opened with `node:sqlite` (`DatabaseSync`,
  WAL, `user_version` migrations that refuse to start rather than open
  empty) — holding runs, work items, mail and coordinator state. This
  repeals "No database," deliberately and in writing: the deferral had an
  owner and a named trigger
  (`docs/superpowers/specs/2026-08-06-attention-ux-design.md:356-357`, "No
  SQLite… belongs to Build 7, not here"), and Build 7 is that trigger
  arriving. ccd's flat files — the registry, the hold, `.prhistory` — stay
  the fleet's own authority; the database holds only what coordination adds
  on top of them, never a replacement for them (see "Fleet coordination"
  above). Everything else still reads ccd's flat files and shells out to
  `ccd`/`tmux` directly through an injected `Runner`/`FleetIO` in **local**
  fleet mode; in **remote** fleet mode the exact same seams are backed by a
  WS client talking to `agent/` on the fleet host instead (see "Remote fleet
  mode" above). Either way the whole thing is unit-testable off-box against
  fixtures.
- `agent/` — Node ≥22.13.0 (same `engines.node` floor as `server/`; the three
  packages must agree — `node-floor.test.ts` — though `node:sqlite` itself is
  server-only) WS service (TS ESM) that runs ON the fleet host and
  exposes a small, whitelisted exec/file/tail/pty surface over a bearer-token
  connection. Only needed for remote fleet mode; local mode never touches it.
- `pwa/` — React + Vite installable PWA ("phosphor & ink" design). Builds into
  `server/dist-pwa`, which the server serves at `/`.
- `shared/` — `agent-protocol.ts` (server↔agent WS message types) and
  `api.ts` (server↔PWA REST/WS types), imported by both `server/` and
  `agent/`.
- `ccd/` — the pieces that live on the **fleet host**: `ccd` itself, plus
  `session-hook.sh` (the Claude Code hook that reports each session's state)
  and `install-session-hooks.sh` (the idempotent installer that registers it
  in every wrapper home). See "How a session's state is known" below.
- `deploy/` — `ccrc.service` / `ccrc-agent.service` (systemd user units),
  `ccrc.env.example` / `ccrc-agent.env.example` (env templates — copy to
  `ccrc.env` / `ccrc-agent.env`, gitignored, to supply real tokens),
  `notify.sh` (ccd swap hook → `/api/notify`, now firing on a swap **refusal**
  as well as a landing), `deploy.sh`. A refusal's durable half is not the
  notice — a banner raised with no socket open is gone, and the operator who
  was not watching is the one who needs to know — it is the registry field
  `$REG/<id>.swapblocked`, read back on every fleet poll and rendered on the
  row until a later swap or a deliberate revive clears it.

HTTPS is whatever fronts the box — `ccrc expose`'s Caddy, a tailnet's own
serving layer, or a proxy you already run (a secure context is required for
the service worker + install-to-home-screen); ccrc itself never speaks TLS.
A proxy shared with co-tenant paths needs the PWA's service worker to leave
those paths alone — that is the builder's `CCRC_SW_DENYLIST` knob, documented
in `deploy/ccrc.env.example`; the built-in denylist covers only ccrc's own
`/api/` and `/ws/`.

## How a session's state is known

**Hooks first, the pane as a ranked fallback.** Claude Code fires hooks on its
own lifecycle, so ccrc no longer has to infer what a session is doing from
terminal text.

`ccd/session-hook.sh` runs on the hot path of every tool call in every fleet
session and writes `~/.cc-sessions/<id>.hookstate.json` atomically. Its contract
is absolute: **exit 0 on every path**, write atomically or not at all, no
network, no locks, no waiting — a hook that can slow or break a session is worse
than no hook. It self-identifies from tmux (`cc-<id>`), so a non-fleet session
exits silently. `install-session-hooks.sh` registers it in every wrapper home
the account roster names — each account's own config dir,
`~/.claude<configDirSuffix>` —
sweeping its own managed entries and leaving anything else in `settings.json`
untouched; every write is `jq`-gated and backed up to `~/ccrc-backups/<ts>/`.

The file carries one of three states — `working`, `waiting`, `done` — plus a
structured **ask envelope** for a waiting session: either
`{questions: [...]}` (an `AskUserQuestion`, copied verbatim from the tool call's
own JSON) or `{approval: {tool, summary}}` (a permission prompt), the
subagents the hooks have seen start and stop, and the two graph counters the
read side keeps — `graphQueries` (R4) and `graphGateDenials` (R5), each reset on
a `SessionStart` that is not a `resume`, and each read back with `null` (no
field, an older hook) kept apart from `0` (measured none).

`server/src/hookstate.ts` reads it and **fails to null** on anything it cannot
vouch for: a missing file, over 64 KB, malformed JSON, an unrecognised state, a
`sessionId` that no longer matches the registry's uuid for that session (so a
restarted session cannot inherit its predecessor's state), or a write older than
30 minutes. `null` therefore means *no fresh hook data* — never a fourth state.

The pane scraper still runs, and still raises a dialog the hook never got a
write for (an older Claude Code, a hook that failed to install). Neither source
suppresses the other; the PWA prefers the envelope and falls back to the scrape.

### The branch takes the name the model already wrote

A workspace is born `ws/soft-prairie` — two words from a random table, fixing
the session id, the directory, the tmux session, the unit, the registry key and
the branch. The name says nothing about the work. Claude Code, meanwhile, has
already written one: every transcript carries an `ai-title` line generated from
the first prompt, and until now nothing read it.

`FleetWatcher`'s naming lane (10 s) renames the branch to that title, slugified:
lowercase, non-alphanumeric runs collapsed to `-`, at most 40 characters cut
back to a word boundary, prefixed `ws/`. It fires only while the branch is still
exactly its born name — that comparison *is* the idempotence marker, so there is
no new registry field and nothing to clean up on reap — and it reads the
transcript behind a size+mtime gate, so a transcript with no title (nine of 609
on this box) is not re-read forever.

**A branch that has been pushed is never renamed — checked two ways against
origin; when origin is unreachable the rename proceeds with a warning.**
`ccd ws-rename` refuses with `has-upstream` for a configured tracking upstream
OR the old name showing up on origin directly, so a branch pushed by hand with
no `-u` (no upstream is configured, but the name is on the remote) is caught
the same as one pushed through `ccd pr-open`'s `--set-upstream`. Both probes
ask only `origin`, and — refusing here would make ws-rename unusable offline
for a branch that has never been pushed — both warn and proceed rather than
refuse when it cannot be reached. `ccd ws-rename` also refuses `registry-branch-drift`
when git's own record for the worktree disagrees with the registry's `branch`
field, so a workspace hand-renamed with a bare `git branch -m` (bypassing this
verb, and so never updating the registry) cannot have some *other* branch
renamed out from under it by a sweep that still believes the registry's stale
name. **It is the last verb that refuses on drift, and that is deliberate**:
`ws-reap` used to refuse the same token and no longer does (it removes the
branch git actually has checked out and reports the registry's as a note, the
rule `ws-rm` has always applied), because drift is the ordinary end state of a
workspace that was archived and then reused — refusing it stranded three
archived workspaces, ~3.6 G, which then had to be removed by hand. A rename is
different in kind: it ACTS ON the name, so renaming git's branch off a stale
registry entry drives the two records further apart rather than reconciling
them. The remedy the refusal names — run `ccd ws-rename` once by hand — is what
puts them back in agreement. It refuses in
JSON on stdout at exit 0 — fourteen named tokens, whose copy lives in
`server/src/wsaudit.ts` — and the one REFUSAL path that keeps a non-zero exit
is `git branch -m` itself failing, a fault rather than a refusal (the only
other non-zero path is the python3-availability probe at the top of the
function, also a fault, not a refusal). A refused workspace keeps its born
name. Five of the fourteen refusals describe a fact about the workspace that a
later title cannot change — `has-upstream`, `not-a-workspace`,
`worktree-unregistered`, `worktree-foreign` and `registry-branch-drift`
(`server/src/watch.ts`'s `PERMANENT_REFUSALS`; the last three ship their own
remedy in the refusal detail — the first two a `git -C $main worktree add …`,
the last a re-run of `ccd ws-rename` once the registry and git agree again —
so "cannot stop being true" holds only in the sense that no title fixes it) —
and those retire the session outright: no further attempt, on any title, until
the server restarts — or until Claude Code rotates that session's own uuid (a
`/clear`, a compaction), which `ccd`'s `_sync_uuid` mirrors into the registry
and which earns a fresh incarnation just as a restart does, since retirement
is keyed on `<id>#<uuid>` (`server/src/watch.ts`'s `attemptedRenames`
docstring has the mechanism). `bad-branch` is a verdict on the *derived branch*, not the
workspace, so it is deliberately not in that set — a title that changes can
change it — even though `deriveBranch` never actually emits a name `ccd` would
reject, so the refusal does not fire in practice. Every other refusal marks
only that one `(session, derived name)` pair attempted, so a title that
changes to a different slug still earns a fresh attempt on the next sweep.

The name types itself into the fleet line and the session header when it lands
(`pwa/src/fleet/TypedLabel.tsx`); `prefers-reduced-motion` swaps it instantly.
The workspace slug itself never changes — the archive list, the PR sheet and the
cleanup confirmation all still name the directory on disk.

### The attention bucket

Every session on the fleet wire carries `bucket` and `bucketSince`, computed
once by `sessionBucket` in **`shared/api.ts`** — not `server/src/bucket.ts`,
which has never existed. It lives in `shared/` because it has TWO producers
that must not be able to disagree: `assembleFleet` (`server/src/fleet.ts`,
which passes all three arguments) and `reviveFleetSession` (same file as the
ladder, which has no `hookEvent` to give and passes two). The fleet screen's
sections, its counts and each row's own state word all read that one field, so
they cannot disagree — before this there were three independent re-derivations
that drifted.

The ladder tests, in order: `archivedAt` **on a row that is also `dead`**
(→ `cleanup` when the PR is merged, else `archived`), then `dead`, then
`attention` (a pending dialog, a waiting hook, or Claude Code's own
`status: 'waiting'`), then `working`, then `done` (which requires hook
evidence — a hookless busy→idle transition never proves a turn *finished*),
then `idle`. **The archived rows come first deliberately**: `ws-archive` stops
the session, so every cleanup candidate is also `dead`, and a dead-first
ladder would leave the cleanup bucket permanently empty.

**That last sentence is the archived rungs' precondition, not just their
excuse** (D-74). `ws-archive` kills the pane before it stamps, but `ccd start`
/ `ccd ensure` clear `.stopped` and `.swapblocked` on a revival and leave
`$REG/<id>.archived` standing — only `ws-restore` removes it. So a workspace
archived on merge and revived for more work carried a marker that outranked
every live rung below it, permanently. Measured on the live fleet 2026-08-17:
5 of the box's 7 archive markers sat on sessions with a live tmux pane, 4
mid-turn — a quarter of the fleet rendering the word `merged` while working,
ranked below idle, counted out of its project's busy total, and with any
pending question unreachable through the attention section. The bucket now
answers *what this session is doing*; `archivedAt` still rides the wire
untouched and still answers *what is staged on disk*, so `/archive`,
`ws-attic` and the reap flow all find the workspace exactly as before.

**Two observers decide `working`, and the fresher one wins** (D-75). `status`
comes from Claude Code's `sessions/<pid>.json`; `hookState` comes from
`session-hook.sh`. Both fail, in opposite directions. The live file *wedges* —
a turn whose last tool call was a Bash ends without Claude Code writing the
transition back, leaving `"status":"shell"` forever (measured twice on one
day; one session held it 1h55m while its hook had written `done` 5.7s after
the file's last write). The live file is also blind to a session waiting on
subagents, and reads `idle` when it is missing, unreadable, or behind an
unknown wrapper. So `sessionBucket` compares `hookUpdatedAt` against
`statusUpdatedAt`: a newer hook `done` unseats a stale `busy` (except
`SessionStart`'s synthetic write, which proves "never started", not
"finished"), and a newer hook `working` raises a stale or absent `idle`.
`status` itself is untouched by this — it stays frozen and hook-blind.

`bucketSince` is *derived* from evidence already on the record — never
remembered by the watcher, which would reset on every deploy and paint the whole
fleet as freshly-unseen several times a day.

A session's **lifecycle** (`running`, `unsupervised`, `stopped`, `restarting`,
`orphan`, `never-started`, `unmeasurable`) is a new optional FIELD and a
qualifier beside the row, not a bucket — **never** a new `SessionBucket`
member and never a change to the ladder above. The live `fleet` frame is cast
from the wire, not revived, so an unknown bucket token would crash an
already-deployed PWA where an unknown lifecycle token simply renders no
qualifier.

`status` itself stays frozen and hook-blind; a test asserts it is identical with
and without hook state present.

### What a row's lifecycle reads off the registry

Four registry fields, each written by a single choke point so a stamp is
never left half-true:

| Field | Shape | Written by |
| --- | --- | --- |
| `$REG/<id>.stopped` | `<epoch> <surface>` | `_ws_unsupervise` — the one choke point every stop path (`cmd_stop`, ws-rm, ws-archive, ws-reap, forget) routes through, so an archived workspace is never left reading `orphan` |
| `$REG/<id>.supervised` | `<epoch>` | `cmd_supervise`, before it ever calls `cmd_ensure` (which can block up to ~15 minutes on a large resume) and again every 30s from the watch loop — and by `cmd_swap` **throughout** its carry, on the same 30s cadence, so a 188MB `cp -a` never leaves the row reading `orphan` mid-swap |
| `$REG/<id>.swapblocked` | `<epoch> <reason>` | `_swap_refuse` — cleared by a completed swap, or by a deliberate `ccd start`/`ccd ensure` revival. **Not** by the refusal's own restart, and **not** by the supervisor re-entering its unit: neither is a human act, and both used to erase the record seconds after it was written |
| `$REG/<id>.spawn` | `<epoch> <rc>` | `_spawn`, on EVERY verdict (0/2/3/4/5/6), success included — the one channel from a spawn inside the supervisor unit to a `ccd start` polling from another process |

A heartbeat inside **120 seconds** is fresh; the supervisor re-stamps every
**30 seconds**, so a live loop never drifts stale under its own steady
state. Those four inputs — pane liveness, heartbeat freshness, the stop
stamp, and whether the row was ever started — decide one of seven
lifecycle states, evaluated in this order: `running` (alive, fresh
heartbeat), `unsupervised` (alive, no fresh heartbeat — what a pre-fix `ccd
start` minted: no auto-swap, no auto-compact, no uuid-sync, nothing to
record its death), `stopped` (dead, a stop stamp present — checked BEFORE
the heartbeat, so a stop taken inside the freshness window reads `stopped`
immediately rather than `restarting`), `restarting` (dead, fresh heartbeat,
no stop stamp — between `Restart=always` cycles, or mid-swap), `orphan`
(dead, stale or absent heartbeat, a start on record — nothing is watching
it), `never-started` (dead, no heartbeat, never started), and
`unmeasurable` — a registry read that failed rather than came back empty,
which wins over every other rung and is never laundered into `orphan`; ccd
itself can never answer this one (it either reads `$REG` off local disk or
the file is genuinely absent), so the bash twin's fixture rows for it are
server-only, exempted by name, and the exemption is itself pinned.

`ccd ls`'s `ALIVE` column is now `STATE`, printing the lifecycle word
instead of the one bit that used to say the same `no` for a deliberate stop,
an unwatched death and a session that never existed.

There is deliberately no reconciler daemon and no `ccd doctor`. The
2026-08-11 incident's stop was itself deliberate — an operator killing a
runaway swap — and an unattended process that tries to "fix" a fleet row is
exactly the kind of component that could have fought that stop. Every
lifecycle state above is read, never repaired automatically; reviving a row
stays a human act (`ccd start <id>`), on purpose.

That human act has to actually work on the row it is offered for. An
`unsupervised` row is a **live** pane, and all three revive verbs used to
return before they could do anything about it — `ccd ensure` early-returns on
"already alive", and `ccd start`/`ccd enable` issued `enable` without `--now`,
which promises a start at next boot and supervises nothing now. So the PWA
rendered "running unsupervised" beside a Restart button that answered success
and changed nothing, on what is D2's entire population the day the fix ships.
All three now adopt such a pane: `systemctl --user reset-failed` then
`enable --now`, whose unit re-enters through `cmd_ensure`, finds the pane
already there, and watches it — no second spawn, and no change at all for a
row that is already `running`, which stays the cheap no-op it has always been.

## The PWA↔server protocol handshake (dormant)

Nothing in the system stamps a version today — no `git` sha ships, no
`package.json` version key is read — and the one real skew window is a
stale client: the service worker checks for updates every 15 minutes, so an
open tab can hold pre-deploy JS against a post-deploy server. A synchronous
`hello` frame closes that gap without doing anything yet:

- `FLEET_PROTO` / `FLEET_PROTO_MIN` live once, in `shared/api.ts` beside
  `PRESENCE_REFRESH_MS` — both currently `1`, with `MIN <= PROTO` pinned by a
  test. **`FLEET_PROTO_MIN` is the kill-switch**: raise it above an old
  build's `FLEET_PROTO` to block that build. It is dormant until then.
- `/ws/fleet`'s first frame, sent synchronously before the async `fleet`
  snapshot, is `{ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN }`.
- **Absence permits.** A connection that never sends `hello` — an older
  server — never blocks the client; every already-deployed PWA already drops
  an unrecognized fleet frame silently, which is the safe direction.
  Blocking requires positive evidence: `hello.min` greater than the client's
  own `FLEET_PROTO`.
- Only the client self-blocks — the server never refuses a client; it has no
  way to know a build is "too new" and nothing here gives it one.
- A **later, compatible** `hello` on the same connection **clears** the
  block — deliberately not a one-way latch, so a reconnect to a fixed server
  unblocks a client that briefly saw a bad frame.
- While blocked, `BlockScreen` renders as a sibling *above* `.app-shell`
  (not inside it — a wire-protocol mismatch has no partial-functionality
  story), copy: *"This app build is too old for the fleet server.
  Updating…"* plus a manual Reload button. Becoming blocked also **acts**:
  it triggers the service worker's update check immediately rather than
  waiting for the 15-minute poll, so most clients self-heal without the
  button ever being needed.
- The session stream's reducer (`applySessionMsg`) gained a `default` arm
  that returns state unchanged — an old client receiving a frame type it
  doesn't know must shrug at it, not corrupt the store.
- `AgentReady.v` (the separate server↔agent pair) stays **deliberately
  unread** — declined, not forgotten: that pair already negotiates by
  *capability* (`ccdVerbs` + `verbSupported`), which is finer-grained than a
  bare generation number. `v` remains reserved for a future breaking
  frame-shape change and gets a consumer only then.

## Develop

```bash
cd server && npm ci && npm run test      # unit tests, hermetic
cd ../agent && npm ci && npm run test     # unit tests, hermetic
cd ../pwa && npm ci && npm run test       # component tests
```

Run the server against a fixture home: `CCRC_HOME=<tree> npm run dev` in `server/`.

## Deploy

```bash
bash deploy/deploy.sh                # server: build PWA here (freshness-gated) → rsync → box npm ci + build → restart unit → health check
bash deploy/deploy.sh agent <host>   # ccrc-agent: rsync → ship ccd + notify.sh (backed up) + session-hook.sh (installs it) → host npm ci + build → restart unit
```

`deploy/deploy.sh` is the FALLBACK — it pushes a working tree onto a box that is **already installed**,
writes no `~/.ccrc/installed` record, and stamps `version` only when a release tag points at the built
commit (auto-tagging makes that the ordinary case on `main`). A box it deploys therefore reports
`install: incomplete` from `ccrc version`, and `incomplete` or `unversioned` from `ccrc update --check`.
Skills ship on its agent arm only; the path is a release and `ccrc rollout` ("Releases" above). Still **no default target** — exit 2.

Put the coordinates in `~/.ccrc/deploy.env` — the deploying machine's own file,
outside every checkout, so it survives worktrees and can never be committed:

```bash
# ~/.ccrc/deploy.env
CCRC_BOX=user@fleet-host            # required
CCRC_SSH_KEY=$HOME/.ssh/id_ed25519  # required
CCRC_SSH_PORT=22                    # optional, default 22
CCRC_AGENT_BOX=user@other-box       # optional: the agent lane's target when
                                    # `deploy.sh agent` names no host
```

```bash
bash deploy/deploy.sh                        # the server box
bash deploy/deploy.sh agent user@other-box   # the fleet host, when they differ
```

Anything set in the environment overrides the file, and `CCRC_DEPLOY_ENV` points
at a different one. The post-deploy health check derives its URL from the box
itself — an exposed box is probed through its public origin, a plain one at
`http://<host>:7788/health` — and `CCRC_HEALTH_URL` overrides both, for a box
fronted by something ccrc did not configure. The agent target takes its box
from the `<host>` argument, or from `CCRC_AGENT_BOX` when that is omitted — it
**never** falls back to `$CCRC_BOX`, which in a two-box fleet is the *server*
box (see "Remote fleet mode" above), and refuses with exit 2 when neither is
set. A single-box install says so explicitly: set `CCRC_AGENT_BOX` to the same
`user@host` as `CCRC_BOX`, or pass the host.

Both targets ship a local, gitignored env file to `~/.ccrc/` on the box first
if one exists (`deploy/ccrc.env` / `ccrc-agent.env` — copy from
the committed `*.env.example` templates and fill in real tokens; the real
files are never committed). The service units use `/usr/bin/env node` (box
node is in `/usr/local/bin`). Every run stamps its backups (previous ccd,
notify.sh, served dist trees) into `~/ccrc-backups/<timestamp>/` on the
target before overwriting anything — and a backup copy that *fails* aborts
the deploy before `rsync --delete` can destroy the state it failed to save.
The agent deploy installs `ccd` BEFORE restarting the agent — the agent
caches `ccd caps` at boot, so the reverse order pins a stale verb set.
Every file either lane replaces on the box lands **atomically** — executables
through `install_atomic` (scp to a temp name, chmod, `mv -f`), the thirteen
systemd units and drop-ins through the box-side `_unit_atomic` that mirrors it.
Neither is tidiness: `cp` opens its destination `O_TRUNC` before it writes, so
a copy killed mid-write (ENOSPC, a dropped ssh) would leave a truncated unit at
its live name — and the dangerous truncation is the one that still *parses*,
because `claude-session@.service` carries `KillMode=process` as the last key of
its `[Service]` section and a unit cut above it kills by control-group instead,
taking the tmux pane on the next restart.

**Ordering between the two targets.** A change that touches `ccd/` — the hook
script in particular — must ship to the fleet host *before or with* the server,
because the server reads what the hook writes. Shipping a server that expects a
newer envelope shape to a fleet still running the old hook is how you get a
confident UI over stale data. A server+PWA-only change has no such constraint.
`ccd ws-rename` is the same rule with a sharper edge: the naming lane calls it
unattended, and `ccd caps` has advertised the verb since long before it took
flags — so a server deployed ahead of its ccd sees the verb gate pass and the
call fail. One attempt per workspace, absorbed by the lane's retry guard, and
zero if the agent ships first. Account pools are the same rule with a *visible*
transient: between the two lanes the two boxes PROJECT different `accounts.sh` —
the fleet host's is regenerated by the new emitter while this server still runs
the old one — so `GET /api/fleet/health` reports `roster: 'divergent'` and the
PWA raises its amber banner until the server lane runs. That is expected, not a fault — the
agent lane prints the same sentence as it goes — and the second deploy clears
it.

**Restore** (manual, from the target box — pick the `<ts>` to roll back to):

```bash
# fleet host (agent target)
cp -a ~/ccrc-backups/<ts>/ccd ~/.local/bin/ccd
cp -a ~/ccrc-backups/<ts>/notify.sh ~/.cc-sessions/notify.sh
cp -a ~/ccrc-backups/<ts>/session-hook.sh ~/.cc-sessions/session-hook.sh
cp -a ~/ccrc-backups/<ts>/agent-dist/. ~/ccrc/agent/dist/
systemctl --user restart ccrc-agent.service
# server box
cp -a ~/ccrc-backups/<ts>/dist-pwa/. ~/ccrc/server/dist-pwa/
systemctl --user restart ccrc.service
```

## Live end-to-end tests

Drive a throwaway `cctest` session through ccrc's public API, run from the
server box:

```bash
CCRC_BASE_URL=http://127.0.0.1:7788 \
  npx vitest run --config vitest.e2e.config.ts        # in server/
```

The suite is `CCRC_BASE_URL`-gated, so a bare `vitest run` stays hermetic. It
needs two accounts in your roster — it starts a session on one and swaps it to
the other. Reset between runs: stop the `claude-session@<wrapper>-cctest` unit
for each wrapper the run touched and `rm ~/.cc-sessions/<wrapper>-cctest.*`.

## Pane-format fragility (re-capture after Claude Code upgrades)

Hooks now carry a session's *state* (above), which removed the worst of this —
but the pane is still scraped, and two jobs genuinely need it: reading the
input-box draft, and proving that the menu on screen is the one an answer is
about. Both drift between Claude Code versions. After any upgrade, re-capture
the fixtures under `server/test/fixtures/panes/` (e.g.
`tmux capture-pane -t cc-<id> -p`) and re-run `test/dialog.test.ts` /
`test/send.test.ts` / `test/ask-route.test.ts`.

Hook *delivery* drifts too, and silently: Claude Code 2.1.222 delivers
`AskUserQuestion` as a `PermissionRequest`, not the `PreToolUse` the mapping was
originally written against. Both arms are kept and both are pinned by tests,
because which one fires is a harness detail this repo cannot predict across
upgrades. After an upgrade, check that a real question still writes
`ask.questions` and not an empty `ask.approval`.

Known real-format subtleties already encoded:

- The **input box** is the LAST `❯` line (history turns render `❯ ` above it),
  and the empty box uses `❯` + a **U+00A0 non-breaking space**, not a plain one.
- A `--remote-control` pane **never renders `esc to interrupt`**, so busy-ness is
  taken from the live status file (`sessions/<pid>.json`), not the pane. Whether
  a box's panes are RC panes at all is per-box config (`~/.ccrc/remote-control`,
  read by `ccd`'s `_rc_enabled`; `ccrc doctor`'s `rc` line names the state it
  measured), so an RC-off box DOES render that marker — the status file is the
  reading that is correct either way, which is why it stays the source.
- **The live status file's vocabulary drifts too, and silently.** It is at least
  four words now, not the three ccrc was written against: `idle`, `busy`,
  `shell`, and — measured in the 2.1.229–2.1.233 bundles — `waiting`, which
  Claude Code writes with `working: false` and a `waitingFor` reason beside it
  (`'sandbox request'`, `'input needed'`, `'dialog open'`, or the top dialog's
  own label). `liveSessionStatus` still collapses everything but `idle` to
  `busy` on purpose — the mail gate, the archive-safety verdict and the session
  socket all need a human-blocked session to read hands-off — and `waiting`
  reaches the attention bucket through `dialogPending` instead. After an
  upgrade, re-grep the bundle for `status:"` and check that no fifth word has
  appeared: a new one costs nothing to read as `busy`, but a new *rest*-like
  word read as work would wedge every affected row in `working`.
- Real **AskUserQuestion** menus put a description line under each option and can
  split the list across a `───` rule — options are not adjacent.

Anything the parser can't handle degrades to `parsed:false` / the terminal
drawer rather than crashing.

## Contributing

The tree is four packages, each `"type": "module"`, with no root runner — `cd` into the one
you are changing:

```bash
cd server && npm ci && npm run test     # vitest, hermetic
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

Run a single suite with `./node_modules/.bin/vitest run test/<name>.test.ts` from inside the
package. A bare `npx vitest` resolves a global copy with no jsdom and will falsely report
that there are no tests.

Two conventions carry more weight here than style:

- **A new guard ships with a test that goes red when the guard is deleted.** Measured before
  and after, not asserted in a comment. A comment is a request; a red suite is a mechanism.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not
  collapse to the same value — that is a defect, not a matter of taste.

Design records live in `docs/superpowers/specs/`; the architecture rules the code is held to
are in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`.

`CONTRIBUTING.md` covers the rest — the layout, the hermetic-test rule, the node floor and
why raising it is the only safe direction. `CODE_OF_CONDUCT.md` and `SECURITY.md` state the
conduct standard and the private channel for a vulnerability; a security problem is not an
issue to open in public.

## License

Copyright (C) 2026 Synapsium Labs.

ccrc is free software: you can redistribute it and/or modify it under the terms of the
**GNU Affero General Public License, version 3**, as published by the Free Software
Foundation. The full text is in [`LICENSE`](LICENSE).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the GNU Affero General Public License for more details.

**Why AGPL, and what §13 means for you.** ccrc is a server you reach over a network, and
that is exactly the case an ordinary GPL does not cover: someone could run a modified ccrc
as a service for others and never publish the changes. AGPL §13 closes that — if you run a
modified version and let other people interact with it remotely, those users are entitled to
the source of *your* version. Running unmodified ccrc for yourself or your own fleet
triggers nothing; you owe source only when you both modify it and expose it to others.

Source files carry no per-file licence headers. Every file in this repository opens with a
comment explaining the reasoning behind its design, and a boilerplate header on top of that
would compete with the thing the reader is actually there for. This section is the notice.
