# Stage 3b — exposure: name, cert, proxy (design)

Refines the OSS design's Stage 3b row (`2026-08-11-ccrc-oss-single-dev-infra-design.md:232`,
§6 `:142-179`) into buildable decisions. The parent spec names the mechanisms — DuckDNS + BYO
name providers, installer-managed Caddy, certs — but leaves four conflicts unresolved, and the
3a close-out carried two more. This document settles each one along the codebase's own
precedents and is the spec the 3b implementation plan is written from.

**Proof (unchanged from the parent):** PWA installed on a phone over the public internet;
login required. That proof is the operator's, on a real box with a real router.

## D1 — Cert acquisition: stock Caddy, HTTP-01/TLS-ALPN-01. No plugin builds.

The parent spec pairs DuckDNS (name) with Caddy (cert) without naming an ACME challenge type,
and the two readings have different dependency footprints: stock Caddy's automatic HTTPS uses
HTTP-01/TLS-ALPN-01 (inbound `:80`/`:443` required), while DNS-01 for DuckDNS needs the
`caddy-dns/duckdns` module — not in a stock binary, so "install Caddy" becomes "build or fetch
a custom Caddy".

**Decision: stock Caddy, standard challenges.** The stage's own proof criterion decides this:
"PWA on a phone over the public internet" requires inbound `:443` reachability *regardless* of
how the cert is issued. Once `:443` is forwarded, ACME issuance costs nothing extra; DNS-01's
only advantage — issuing for a box that is not publicly reachable — serves a topology 3b's
proof explicitly excludes. A custom Caddy build would also give the installer a second
package-manager problem and doctor a second provenance problem, against zero benefit for the
supported topology.

**Consequence, stated loudly instead of papered over:** inbound `:80` and `:443` reaching this
box (router port-forward on a home NAT) is a **prerequisite**, written in the runbook's
prerequisites section and in the `ccrc expose` landing text. It is not installer-detectable
from inside the box; the doctor detects its *absence* indirectly (D6: cert issuance fails
loudly). BYO-proxy users skip all of this by contract (parent `:160-164`).

## D2 — Privilege boundary: the degraded-step ceremony. The installer still never runs sudo.

Caddy binds privileged ports and runs as a system service; `ccd/ccrc` has never executed
`sudo` and installs only `systemctl --user` units (`_inst_linger`, `ccd/ccrc:2762-2773`, is
the standing template: print the exact commands, push to `INST_DEGRADED`, return 0, let doctor
carry the miss into its exit code).

**Decision: the Caddy step is a degraded-step twin of `_inst_linger`.** `ccrc expose`
generates the complete Caddyfile into `~/.ccrc/Caddyfile` (ccrc-owned, regenerated on re-run),
then prints the exact root ceremony — install caddy from the distro/official repo, symlink or
copy the Caddyfile, `sudo systemctl enable --now caddy` — and records the pending state.
Nothing in ccrc ever runs it. Doctor reports the gap as FAIL-with-remedy while the flag says
exposure is configured but Caddy is not serving (D6).

## D3 — Exposure config lives in its own file: `~/.ccrc/exposure.env`.

`_inst_env` writes `~/.ccrc/ccrc.env` seed-once and never again (`ccd/ccrc:2141-2168`, D-88);
the parent spec's "asks how this box gets its name" at install cannot rewrite it, and the 3a
passphrase precedent already broke the ask-at-install doctrine once (install never prompts —
`curl | bash` stdin is the script).

**Decision:** exposure is a **post-install verb**, `ccrc expose`, not an install question —
the same shape as `ccrc passwd`. It writes `~/.ccrc/exposure.env` (0600), a second
EnvironmentFile consumed by the server unit: the unit template gains
`EnvironmentFile=-%h/.ccrc/exposure.env` **after** the `ccrc.env` line, so exposure keys
(`CCRC_ORIGIN`, `CCRC_RP_ID`, `CCRC_DDNS_PROVIDER`, `CCRC_DDNS_DOMAIN`, `CCRC_DDNS_TOKEN`)
override hand-set placeholders without touching the seed-once file. Precedents: the
`~/.ccrc/remote-control` ccrc-owned file (`_inst_rc`), the units' REGENERATE class (the
template change ships in `_inst_units`' next converge). Re-running `ccrc expose` reconverges —
same idempotency contract as install. Single-definition: the path is spelled once
(`CCRC_EXPOSURE_FILE`), pinned like `CCRC_RC_FILE` (`single-definition.test.ts:850-925`).
Operators who already hand-edited `ccrc.env` (the 3a runbook path) keep working: `expose`
detects the same key set in `ccrc.env` and refuses to shadow it silently — it says which file
wins and asks for one of the two to be cleaned.

## D4 — DuckDNS updater: a user timer, token in `exposure.env`, never printed.

**Decision:** `ccrc expose duckdns` installs `ccrc-ddns.timer` + `ccrc-ddns.service` (user
units — the `ccd-cap-scopes.timer` precedent, `ccd/ccrc:2653-2654`), a curl of the DuckDNS
update endpoint every 5 minutes, reading the token from `exposure.env`. The token is collected
tty-only on stdin (the `cmd_passwd` idiom: `[ -t 0 ]` or die, never argv), stored 0600,
reported by doctor as SET/NOT SET and never printed (`_check_config`'s standing rule). BYO
domains install no timer — DNS is the operator's.

## D5 — trustProxy: settled as **none**, recorded in code.

Measured (survey, 2026-08-21): Fastify is constructed without `trustProxy` and **zero**
consumers of `req.ip`/`req.protocol`/`req.hostname`/`X-Forwarded-*` exist; the rate limiter is
deliberately global (its own docstring names spoofable `X-Forwarded-For` as the reason);
`Secure` and Origin checks are config-driven by design (`auth-routes.test.ts:224-236` pins
that a `req.protocol`-derived `Secure` would break behind every proxy this project runs).

**Decision: no `trustProxy`, no forwarded-header consumer.** 3b converts `config.ts:74-80`'s
"lands properly in 3b" forward-reference into the settled statement: auth decisions are
config-driven; introducing proxy trust would create a spoof surface for whatever reads
`req.ip` next, and nothing reads it. This is a documentation-and-test change, not a feature.

## D6 — Doctor checks: four, each with a D-150 arm.

New checks (array + `_check_*` + bijection test, `ccrc-doctor-checks:160-185`):

1. **`exposure`** — `exposure.env` present/complete/0600; SKIP when never configured (BYO
   proxy or pre-3b box is a valid end state, not a fault).
2. **`caddy`** — the system unit's presence and activity via its own `systemctl` (not
   `_check_services`, which reads only `$CCRC_UNIT_DIR` user units); FAIL-with-remedy when
   exposure is configured but Caddy is absent/inactive (the D2 pending state); SKIP without
   exposure.
3. **`cert`** — validity + days-to-expiry of the served cert for `CCRC_ORIGIN`'s host,
   measured against the local listener (`openssl s_client` to `127.0.0.1:443` with SNI), so it
   works before DNS propagates and never depends on the WAN path.
4. **`name`** — the DDNS name resolves, and to this box's current public IP where
   discoverable; WARN not FAIL on mismatch (propagation lag is normal).

Every probe that can traverse the armed session gate classifies a 401 as the *correct* answer
(D-150 precedent, `_check_fleet`'s rc-classification shape). No check ever prints a token or a
cert's private material.

## D7 — Rename choreography, and the sentence that must stop lying.

The cutover order (runbook step 11): name resolves → Caddy serves → `ccrc expose` wrote
`CCRC_ORIGIN=https://<name>` + `CCRC_RP_ID=<registrable domain>` → `systemctl --user restart
ccrc` → log in with the passphrase → **re-enrol every passkey**. Passkeys are origin-bound;
per-credential rpId binding makes stale ones fail — but today the browser's `NotAllowedError`
surfaces as `'Passkey sign-in was cancelled. Try again, or use the passphrase.'`
(`LoginScreen.tsx:81`) — a false sentence in a reachable state, the exact class 3a's review
fixed four times (D-151/D-152).

**Decision: fix it with one additive wire field.** `GET /api/auth/status` (already exempt)
gains `enrolledRpIds: string[]` — distinct rpIds over stored credentials, no ids, no key
material, no counts; an anonymous caller learns only that *some* passkey exists for *some*
name, which the login screen's passkey button already discloses. When a passkey ceremony fails
and `enrolledRpIds` is non-empty but excludes the current `rpId`, the login screen says what is
true: "Your passkeys were enrolled for a different box name (<old>). Sign in with the
passphrase and re-enrol." Additive field, single reader, no proto bump.

## D8 — Loopback confinement gets its missing guard; the reference box is an operator ceremony.

Fresh installs already bind loopback (`config.ts:297`, `_inst_env`'s literal). Two items:

1. **Close the `CCRC_HOST=` hole now:** `host` uses `??` where every auth key uses `||`
   (`config.ts:333-348` documents the bare-`KEY=` EnvironmentFile hazard, D-130 fixed it for
   `CCRC_PORT`); a blank line yields `''` and `listen({host:''})` binds **all interfaces** —
   the exact opposite of the stage's premise. One-line fix plus a red-first test. This ships
   independently of every other 3b decision.
2. **The reference box** (`CCRC_HOST=203.0.113.7` + out-of-repo `tailscale serve`) migrates
   by operator ceremony, documented in runbook step 11 — a two-sided edit (rebind + re-point
   or retire the serve config) this repo can describe but must not perform.

## Carried discipline

- **D-149 sweep:** every route/exempt-set change in 3b re-reads the out-of-package consumers
  (`ccd/ccrc`, `ccd/coordinator-skill/`, `ccd/worker-skill/`, `deploy/*.sh`) before it lands —
  a named checklist step in every task that touches `EXEMPT`, because the server package
  cannot see its own callers.
- Runbook step 11 rewrites the two now-stale bullets in step 10's "does NOT prove" list
  (`:508-516`), and its quoted transcript lines get `runbook-holds` pins.
- No new npm dependencies in any package. Caddy is a system package, not a node dependency.
- Wire discipline: `enrolledRpIds` is additive; `FLEET_PROTO` stays 1.

## Out of scope

`you.ccrc.app` (parent `:223`); additional DDNS providers; per-user identity; attestation
verification; any change to the agent WS bearer boundary; performing the reference-box
migration or any router configuration.
