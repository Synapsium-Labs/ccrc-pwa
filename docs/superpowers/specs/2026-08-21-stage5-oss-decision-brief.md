# Stage 5 (OSS polish) — decision brief

Not a spec. The 2026-08-21 survey of Stage 5's surface found the stage row partly stale
("account labels out of `shared/api.ts`" was discharged by Stage 2a), one large unsettled
question the parent spec never asks (does `docs/` ship publicly?), and a handful of rulings
that are the operator's, not engineering's. This brief asks for those rulings; the Stage 5
spec is written from the answers, **against the post-merge tree** — both #78 (3b) and #83
(stage 4) rewrite the README this stage restructures, so they merge first.

## The operator rulings

**S1 — Org identity and copyright holder.** The AGPL notice needs a name, and the parent
spec says "AGPL-3.0, **sole copyright holder**" — which sits oddly with the repo living
under the `example-org` org. This decides three literals at once: the LICENSE
copyright line, `install.sh`/`ccrc`'s `CCRC_RELEASE_OWNER` pair (the release-fetch URL),
and the README's `curl … | bash` one-liner. Options: stay under example-org (copyright
the company), move to your personal account, or a new org. **No recommendation — this is a
business/ownership call.**

**S2 — Does `docs/superpowers/` ship in the public tree?** 35 of 86 files carry the tailnet
name, both node IPs, and the SSH username — no credentials, but the full topology of a live
tailnet. Options: (a) ship as-is (the design record is genuinely valuable to outsiders);
(b) sanitise the 35 files (mechanical — four tokens); (c) keep docs/ in a private mirror.
Same ruling covers `scratch/` (the spec cites it twice as its evidence base), `CLAUDE.md`
(names both boxes and the `gh` token posture), and `pwa/design/`.
**Recommendation: (b) — sanitise and ship; the record is the project's best documentation,
and the four tokens are find-and-replace.**

**S3 — The repo-public flip itself** stays gated on your explicit go after everything else
lands, per the standing agreement. Before it, the checklist (engineering, but listed here
so the go/no-go is informed): full-history secret scan (never run — 88 branches); fork-PR
CI approval policy + a fork-threat-model pass over the server suite's bash;
`required_approving_review_count` is 0 today; CodeRabbit's behavior/cost on public PRs;
CONTRIBUTING/SECURITY templates (or the explicit decision to skip them for v1).

## Engineering decisions (recommendations I take unless overruled)

**S4 — Roster de-branding:** delete `deploy/accounts.migration.json` (its migration is long
done; `deploy.sh`'s default at `:209` becomes "refuse without `CCRC_ACCOUNTS_JSON` when the
box has no roster yet"), and RENAME `DEFAULT_TEST_ROSTER`'s five entries to neutral
ids/labels — not shrink (the single-definition scanner requires ≥2 names incl. `claude`,
and one label must stay ≠ id for the accounts-route discriminator). ~28 mechanical test
files follow. The shipped install default (single `claude` account) is already correct.

**S5 — Runtime de-branding sweep:** `ccd/ccclip`'s three unconditional literals (promised
in Stage 1, never done); `deploy/notify.sh:45`'s IP fallback (the exact default
`ccd/ccrc:378-389` refuses to copy, with reasons); the three skill files' hardcoded server
address (becomes derived/config); `config.ts:323`'s `mailto:ccrc@server-box`;
`ccd/ccd`'s "server-box" banner strings (one commit, provenance re-stamped);
`ccrc-adopt:350`'s `team·max` example string; `scripts/extraction-manifest.sh` deleted;
`ccrc.env.example`'s worked examples get generic placeholders.

**S6 — Service-worker denylist:** `/docs` and `/fleet` are one operator's co-tenants and
nothing pins the line. v1 shape: the built-in list shrinks to `/api/` + `/ws/` (ccrc's own
truth); co-tenant paths ride a build-time `CCRC_SW_DENYLIST` consumed by vite.config —
documented as a *builder's* knob (the reference box builds its own PWA via deploy; a
release-tarball install gets the clean default, which is correct for a fresh box). First
test added.

**S7 — README:** restructure, not rewrite. Install (with the `--release` one-liner,
prereqs from doctor's list, expose walkthrough, update/uninstall) moves to the top;
reference-deployment specifics (`:17`'s tailnet install URL, `:1194`'s IP curl, the
personal config-dir enumerations) are removed or genericised; the internals reference stays
below the fold. `### Workspace holds & programs` survives verbatim (readme-holds pins).
LICENSE section + a one-paragraph "what is this" land at the top. `CLAUDE.md:8`'s stale
"817 lines" corrected.

**S8 — License mechanics:** root `LICENSE` (AGPL-3.0), `license` fields in
server/agent/pwa `package.json` (shared/ stays a bare resolver shim), README section, no
per-file headers (they'd fight the design-rationale comment idiom that opens every file).

**S9 — Doctor gap from the survey:** `rsync`/`diff`/`cmp` are hard by-name install deps
with no doctor check — one small check joins the sweep.

## Rulings received (2026-08-22)

**S1 — RULED:** transfer the repo to **Synapsium-Labs** (the org exists; the operator is a
member) and publish under that company. Copyright identity: Synapsium Labs. The transfer
itself is an operator act sequenced with the flip; the code side parameterises the owner
first (`CCRC_RELEASE_OWNER`, README one-liner, LICENSE line) so the tree is owner-agnostic
before either happens. Exact legal copyright string to confirm at LICENSE-writing time
(default "Synapsium Labs" unless the operator supplies a registered-company form).

**S2 — RULED:** option (b), sanitise and ship — with two operator qualifications: the
sanitisation bar is **verified, not asserted** ("ensure it's sufficiently secure" — the
flip checklist's secret/topology scan becomes a mechanism, not a read-through), and tailnet
topology is **cleared out, not merely masked** — it is noise to the average user, not just
a leak (so the sweep rewrites the affected passages to be box-neutral rather than
substituting placeholder tokens four times).

**S10 (new, operator 2026-08-22) — DNS-free exposure:** the setup must be able to work
**without DuckDNS or any third-party DNS service**. The default install already is
(loopback, no exposure, operator's own transport); what Stage 5 adds is a designed story
for remote HTTPS access with no DNS dependency — candidate: an `ccrc expose ip`-class mode
(Caddy internal CA, self-signed on the box's address, printed trust ceremony for the
phone). Known constraint to state honestly in the spec: WebAuthn requires a domain RP ID,
so passkeys need a name; on a bare IP the gate runs on passphrase login only. The spec
weighs that against a tunnel-documented path and picks one primary recommendation.

## Ordering

1. Merge #78 and #83 (your review) → resolve the `ccrc` verb-table conflict → deploy.
2. Rulings S1–S2 → Stage 5 spec + plan → build (S4–S9) → your public-flip checklist run
   (S3) → **your explicit go** → flip → the outside-developer proof (install from the
   public repo using only the README, via a real tag).
