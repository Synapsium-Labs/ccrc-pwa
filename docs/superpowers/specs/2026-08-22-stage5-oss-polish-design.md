# Stage 5 — OSS polish: design

Written 2026-08-22 against main `c39eabc`, from the decision brief
(`2026-08-21-stage5-oss-decision-brief.md`) under the operator rulings recorded there:
**S1** — publish under **Synapsium-Labs** (repo transfer + copyright identity);
**S2** — docs sanitise-and-ship, with the bar **verified by a mechanism, not a read-through**,
and tailnet topology **cleared out, not masked** (it is noise to the public reader, not just
a leak); **S10** — the setup must work with **no third-party DNS dependency**. Two pre-flip
acts are already DONE and are inputs here, not work: the 2026-08-22 sensitive-info scan
(6 finders over HEAD + all history blobs; zero live credentials; per-token file lists below
are its output) and the targeted history rewrite (the box's public IP and a claude.ai
session id scrubbed from all refs; backup at `~/ccrc-backups/20260822-history-rewrite/`).

The stage's shape: **make the tree owner-agnostic and box-agnostic, prove it with a red-bar
suite, add the DNS-free exposure mode, restructure the README for an outside reader — then
hand the operator a short, honest flip checklist.** The flip itself (repo transfer + public
toggle) stays an operator act.

## 1 — Identity: license and owner (S1 + S8)

- Root `LICENSE`: AGPL-3.0 text, copyright line `Copyright (C) 2026 Synapsium Labs`
  (exact legal form confirmed with the operator at PR review; default stands unless they
  supply a registered-company form).
- `"license": "AGPL-3.0-only"` in `server/`, `agent/`, `pwa/` `package.json` (`shared/`
  stays a bare resolver shim — no license field to invent, it publishes under the root
  LICENSE like every non-package file). No per-file headers — they would fight the
  design-rationale comment idiom that opens every file.
- `install.sh`'s `CCRC_RELEASE_OWNER` default flips the employer org → `Synapsium-Labs`
  in the SAME commit the operator transfers the repo (GitHub redirects the old org URL, so
  ordering inside the flip window is forgiving, but the tree must never name two owners).
  Until that commit, the tree keeps working against the current org. README's
  `curl … | bash` one-liner and the release workflow's implicit owner ride the same value —
  the single-definition suite gains the pin: **the owner string is defined once**
  (`install.sh`), everything else derives or quotes it.
- The old employer token's residue, both casings (70 occurrences, 23 files — `ccd/ccd`, `ccd/ccrc`,
  fixture session names in `fleetws`/`registry` tests, `pwa/design/mockup.html`, docs):
  fixture and demo spellings become neutral project names (`acme-platform-ts` class);
  prose mentions in docs follow §8's corpus policy. The `ccd/ccd` commit re-stamps
  provenance, per standing rule.

## 2 — The box-identity sweep: classes and work-lists (S2 + scan)

The scan's exact inventory, by token class — each class gets one treatment, applied
everywhere its list reaches. "Clear out" means **rewrite the passage box-neutrally**
(role names: "the server box", "the fleet box", `<server-host>`, documentation IPs
`203.0.113.x`/`198.51.100.x`, `you@<server-host>`), never a placeholder token swap that
leaves the sentence shaped like a secret.

| Class | Scale at HEAD | Treatment |
|---|---|---|
| The two tailnet IPs (server, fleet; + one fixture neighbour) | 85+18 hits, ~37 files | Shipped defaults DELETED (§4); tests re-fixture to doc IPs; docs per §8 |
| Tailnet DNS name + the server host's name | 42 hits/14 files; 246/47 | Runtime strings → `<your-box>.example.com` worked examples; docs per §8 |
| The operator's username, `/home/<user>`, the volume-id projects root | 72/33 files; 42 files | Code+tests → neutral (`you@`, `/home/you`, `/srv/projects`); docs per §8 |
| SSH reach recipe (port 2222, the two key names) | ~8 plan docs + `deploy.sh`, `ccclip` | Shipped defaults deleted (§4); docs per §8 |
| Account roster labels (the four real ones) | `accounts.migration.json` + 1736 refs | §5 roster de-brand |
| Real GitHub handle, private repo names | fixtures + docs | Fixtures → `example-org/example-repo`; docs per §8 |
| `scratch/2026-08-10-rollout-readiness-synthesis.md` | sharpest single disclosure (pre-auth surface map) | **PRUNE from the tree** (stale since 3a; its value is historical, it stays in private backup) |

`CLAUDE.md` keeps its operational truth but speaks in ROLES; the real addresses, user and
key names move to a **gitignored operator file `deploy/reference-fleet.md`** which
`CLAUDE.md` names as "the reference deployment's concrete values live in …". The operator
(and this session) keep exact reach instructions; the public tree teaches the shape.

## 3 — The verified bar: `topology-clean` suite (S2's mechanism)

A new `server/test/topology-clean.test.ts` — same corpus-scanning idiom as
`single-definition` — walks every git-tracked file and FAILS on reintroduction. The one
subtlety this design settles: **a suite that spells the forbidden tokens verbatim would
itself publish them.** So the suite forbids by CLASS wherever a pattern can say it
without naming anything real: any CGNAT `100.64–127.x.x.x` literal, any `*.ts.net` name,
any `/mnt/HC_Volume_*` path, any public IPv4 outside the RFC 5737 documentation ranges
(and loopback/RFC 1918 fixtures), any `duckdns.org` subdomain outside the documented
placeholders, any `session_01…`-shaped id that is not the committed EXAMPLE one. The
small residue a pattern cannot express — the username, the two SSH key names, the
company org string — rides in the test base64-encoded with a comment saying exactly why:
it breaks casual greppability, while the values themselves are already public-by-ruling
in the retained commit-author history, so this is noise-prevention, not secrecy. No
allowlist entries at ship — an empty allowlist IS the claim; any future exception must
be argued into the file next to the pattern it excuses. This suite is the "ensure it's
sufficiently secure" ruling made mechanical: reintroduction anywhere — code, test, doc,
fixture — is a red build, and the pre-flip checklist's scan re-run (§9) is then
confirmation, not the mechanism.

Mutation-measure at ship: temporarily reintroduce one tailnet IP in a doc → 1 red.

## 4 — Runtime de-brand: shipped executables lose the reference fleet (S5 remainder)

What #89/#90 already did (skills' `$CCRC_API`, deploy health probe) set the pattern:
**config with a refusal, never a compiled-in fallback.**

- `deploy/deploy.sh:8`: `BOX="${CCRC_BOX:-you@<server-host>}"` (the baked default was
  the reference server box) → refuse with
  instructions when `CCRC_BOX` unset (`deploy.sh: set CCRC_BOX=user@host — this script
  deploys to the box YOU name, and no longer carries a default box`). The baked key-name
  default → refuse when `CCRC_SSH_KEY` unset; port default 2222 → standard 22
  (the reference boxes override per-workstation, exactly as they do today).
- `deploy/notify.sh:45`: the legacy-IP third tier is DELETED — resolution becomes
  `CCRC_ADDR` env > `ccrc.env` greps > **silent no-op** (notify is best-effort by
  contract; a notify that cannot resolve an address sends nothing, never guesses).
  `server/test/ccrc-cli.test.ts:642`'s "a REAL address, deliberately" pin and
  `notify-addr.test.ts`'s two fallback tests re-pin to the new two-tier rule.
- `ccd/ccclip:10-12`: hardcoded `BOX`/`SSH_KEY`/`CCD` → read from `~/.ccrc/ccclip.env`
  (grep idiom) with refusal; the three literals were promised gone in Stage 1.
- `server/src/config.ts:323` `mailto:ccrc@<server-host>` → `mailto:ccrc@localhost` (a VAPID
  contact must parse, not resolve).
- `server/src/auth/webauthn.ts:281,294`, `gate.ts`, `config.ts` error-string examples →
  `<your-host>` forms; `ccrc-adopt:350`'s real-first-label example → neutral;
  `ccd/ccd` banner strings neutralised (provenance re-stamped);
  `deploy/ccrc.env.example` + `ccrc-agent.env.example` worked examples → documentation
  addresses; `scripts/extraction-manifest.sh` DELETED with its test suite (its migration
  is long done).

## 5 — Roster de-brand (S4)

`deploy/accounts.migration.json` deleted; `deploy.sh`'s roster default becomes "refuse
without `CCRC_ACCOUNTS_JSON` when the box has no roster yet". `DEFAULT_TEST_ROSTER`'s five
entries RENAME to neutral ids/labels — not shrink: the single-definition scanner requires
≥2 names including `claude`, and one label stays ≠ id for the accounts-route
discriminator. ~28 test files follow mechanically. The shipped install default (single
`claude` account) is already correct.

## 6 — Service-worker denylist (S6)

Built-in list shrinks to `/api/` + `/ws/` (ccrc's own truth). Co-tenant paths (`/docs`,
`/fleet`) move to a build-time `CCRC_SW_DENYLIST` consumed by `vite.config` — a
*builder's* knob, documented as such (the reference box builds its own PWA via deploy; a
release-tarball install gets the clean default). First test for the knob added.

## 7 — DNS-free exposure: `ccrc expose ip` (S10)

The ruling: work without DuckDNS or any DNS service. The default install already does
(loopback + operator's own transport); this adds the REMOTE story:

- New mode `ccrc expose ip`: writes a Caddyfile block for `https://<box-ip>` using
  Caddy's **internal CA** (`tls internal`), same exposure.env/doctor plumbing as
  `duckdns|byo`, same printed sudo ceremony — plus a printed **trust ceremony**: where
  Caddy's root CA cert lands (`caddy trust` locally; the file path for the phone), how to
  install it on iOS/Android, and the sentence saying WHY (self-signed via a local root,
  nothing leaves the box).
- Honest constraints, printed by the verb and stated in the README: **WebAuthn passkeys
  need a domain RP ID — on a bare IP the gate runs passphrase-only** (`enrolledRpIds`
  stays empty; the PWA's passkey enrolment hides, exactly as it does dark); PWA
  install-to-home-screen works once the CA is trusted; a changed box IP is a re-run of
  the verb.
- Doctor: `exposure` recognises the `ip` mode; `cert` already walks the box's addresses
  (#87) and accepts the internal-CA chain by checking the certificate's presence and
  subject, WARN (not FAIL) that the chain is not publicly trusted — the by-hand-WARN arm
  that exists today extends to name the trust ceremony as the remedy.
- `byo` remains the no-third-party path for operators who own a domain; `ip` is the
  no-domain-at-all path. DuckDNS stays the zero-cost-name default. README's exposure
  section presents the three as a decision table.

## 8 — The docs corpus: per-file publish-or-prune (S2)

`docs/superpowers/` (~35 affected of 86), `scratch/` (2), `pwa/design/` — the scan's
per-file lists drive one editorial pass, per file one of: **(a) sanitise** (the passage
rewritten box-neutrally — most specs), **(b) prune** (dropped from the public tree —
`scratch/` both files; any plan whose only content is reference-box operations), or
**(c) keep verbatim** (already neutral). Pasted transcripts with real paths/session names
are sanitised or the block is cut — a transcript's value is its shape, not its hostnames.
The deviation-ledger D-N numbers and plan anchors are PRESERVED — history references stay
meaningful even where a hostname is neutralised. The `topology-clean` suite (§3) is the
acceptance test for the whole corpus; no file ships on a promise.

README (S7): restructure, not rewrite — install first (release one-liner, doctor
prereqs, expose walkthrough with the §7 decision table, update/uninstall), reference-
deployment specifics genericised, internals below the fold, LICENSE + one-paragraph
"what is this" at top, `### Workspace holds & programs` survives verbatim (readme-holds
pins), `CLAUDE.md:8`'s stale "817 lines" corrected against the restructured file.

## 9 — The flip checklist and sequencing (S3)

Build order: §1–§8 land as ordinary PRs (each with its suite; §3's suite lands FIRST
red-listing only the classes already cleared, growing its token list as each sweep PR
lands — the suite is the ratchet). Then, operator acts in order:

1. **Transfer** `ccrc-pwa` → `Synapsium-Labs` org (+ the same-commit owner-string flip,
   §1). Both boxes' remotes re-point (redirects cover the gap).
2. Repo settings: fork-PR workflow approval = "require approval for all outside
   collaborators" (the server suite's bash runs on `pull_request` — never let a fork run
   it unapproved); `required_approving_review_count` stays 0 by explicit choice (single
   maintainer; revisit at first outside contributor); CodeRabbit on public PRs =
   operator's cost call; CONTRIBUTING/SECURITY.md = one-paragraph versions ship (S8's
   PR), SECURITY.md pointing at private disclosure.
3. Re-run the sensitive-info scan (the §3 suite green + a fresh 6-finder pass over the
   final tree) — confirmation, not mechanism.
4. **The flip** (public toggle) — explicit go, per standing agreement.
5. Tag `v0.0.1` → release workflow builds the artifact → **outside-developer proof**:
   install on a clean VM from the public repo using only the README (runbook step 12's
   round-trip, now against the public origin).

## 10 — Out of scope

History is DONE (rewritten 2026-08-22; commit-author emails stay by accepted ruling).
No auth changes beyond §7's stated passphrase-only caveat. No roster-increment work
(the "account = wrapper" single-type item stays open on main). The docserver, FleetView
and other co-tenants of the reference box are untouched — §6's knob is how the reference
box keeps them.
