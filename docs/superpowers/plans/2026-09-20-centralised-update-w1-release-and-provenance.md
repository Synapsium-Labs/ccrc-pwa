# Centralised update management — W1: release side + provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merge to `main` publishes a Sigstore-attested **prerelease** (the `dev` channel); a fast-forward push to `stable` promotes an existing release without rebuilding it; and `ccrc update` refuses any tarball it cannot bind to its tag, verify against the two release workflows' identities, and place at or above the box's floor.

**Architecture:** Two PRs, in order. **Part A (release side)** changes only the release scripts and the workflows and adds `release-stable.sh`; nothing on a box changes, and the first release it cuts is where Part B's fixture bundles come from. **Part B (node side)** adds `deploy/verify-provenance.mjs` (run from the INSTALLED tree, never the downloaded one — decision 12), threads it into `_upd_fetch` between the transport checksum and extraction, binds the resolved tag to the SHA256SUMS name and to the extracted `build.json`, and gives the install spine three new files under `~/.ccrc` — `node-id` (seed-once identity), `ccrc-caps` (what THIS install can do), `floor` (only ever raised). `--allow-unsigned` is the only way past an ABSENT bundle and `--downgrade` the only way below the floor; both are typed by a human.

**Tech Stack:** bash (`ccd/ccrc`, `install.sh`, `deploy/*.sh`); GitHub Actions with `actions/attest-build-provenance` (keyless OIDC, no repo secrets); `@sigstore/verify` + `@sigstore/bundle` + `@sigstore/protobuf-specs` as server production dependencies (the verifier resolves them through `server/node_modules`, which `npm ci --omit=dev` places on every box); `gh` ≥ 2.49 as the fallback backend; vitest under `server/test`.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` — §2 decisions 2, 3, 4, 8, 12, 13; §4; §5; §9 (the floor on every path; `_inst_caps`); §15 row W1; §18 rows 1–16 plus "`_inst_caps` writes each wave's words", "the floor never lowers", "the floor is checked on every path", "`--downgrade` is the only way below the floor".

## Global Constraints

- **The canonical form of a version is the tag** (`v0.0.9`) — in `UPD_VERSION`, `build.json`'s `version`, `~/.ccrc/floor`, every message and every comparison. The `v` is stripped only inside the bash comparator (`_ver_newer`), nowhere else (decision 2).
- **The repo carries no secrets and this wave adds none** (decision 4). The attestation identity is the workflow's OIDC token; the verifier trusts a vendored Sigstore trusted root and exactly two workflow URIs.
- **The verifier that verifies a download is the installed one** — `$CCRC_HERE/../deploy/verify-provenance.mjs`, the same resolution `_upd_backup` uses for `backup-coord.mjs` (`ccd/ccrc:11327` at `7d78b376`) — never `$UPD_TREE/…` (decision 12).
- **`deploy/build-release.sh` and `deploy/deploy.sh` are untouched** (spec §19). `ccd/ccd` is untouched.
- **The exec surface is closed and `gh` has no whitelist entry** — nothing here touches `agent/`.
- **The workflows never name the org** (`single-definition.test.ts:2795` at `7d78b376`): `release-stable.sh` reaches its repo through `gh`'s `{owner}/{repo}` placeholders and the workflows through the checkout.
- **Tests use fixture HOMEs only, never the live `$HOME`**; every network tool is a recording stub or a poison (`curl`, `gh`, `npm`); the one real network act in this plan is Task 1's spike, which runs in the session scratchpad and is what it measures.
- **Mutation-table discipline:** every guard ships with a test that goes red when the guard is removed. Each task's test list says which spec §18 row it pins.
- **Deviation numbers are issued by the allocator** (`ccrc-api ledger allocate`), never looked up; the block below was minted for this plan on 2026-09-20 and is defined here in the same act. A worker that finds a new deviation and cannot reach the allocator writes `D-TBD-<slug>` and reports it — and never commits it: `server/test/dtbd.test.ts` refuses a concrete placeholder from landing, so a plan names a pending departure by its slug alone and mints the number when it fires.
- **No docserver URL, hostname, username or absolute home path in any tracked file** (`topology-clean.test.ts`); the pre-push hook refuses them. Every new file — fixture bundles, the vendored root — is checked before its commit by running `test/topology-clean.test.ts`, which scans the staged tree for the residue classes by pattern (the classes are never spelled outside that file).
- **README edits are line-neutral where `pools-prose.test.ts` holds the count** (its README passage is the pools section, not the release section — measured: `pools-prose.test.ts:107` reads README whole but asserts on the flattened pools passage; still, run it after every README edit).
- **Node floor `>=22.13.0`** unchanged; the verifier uses nothing newer than `node:crypto`, `node:fs`, `node:module`, `node:child_process`.
- **The suites are run in the foreground, one file at a time, from inside `server/`**: `./node_modules/.bin/vitest run test/<file>.test.ts` — never bare `npx vitest`.

## Deviations found

Plan-level departures from the spec's literal text — the ten found while planning against the measured tree, and the ones each task's review found afterwards. Every number below was issued by the allocator (`ccrc-api ledger allocate`) in the same act as its definition: the planning block on 2026-09-20 (floor 3115 before it), then one small block per task as the reviews found departures; the list is the census, so a bullet is added and never a count kept here. One contingency is named but unnumbered — the **no-tag-fixture** deviation — minted from the allocator only if Task 7 Step 5 is declined, and defined below in that same act; it is never written as a placeholder token, which `server/test/dtbd.test.ts` refuses from landing (measured: PR #161's first CI run went red on exactly that).

- **D-3115** — `deploy/release-main.sh` becomes two arms, `prepare` and `publish`, instead of one script. Spec §4 says the script's `gh release create` argv "names the bundle as a third artifact", but the bundle is produced by the attest ACTION, which cannot run inside a bash script; today's single-shot script publishes before any attest step could run. `prepare` derives the next tag, tags **locally only** and builds; the workflow attests; `publish` copies the bundle to its release name, pushes the tag and publishes all three artifacts `--prerelease`. Nothing reaches origin before `publish`'s push, so a failed attest step leaves origin untouched and a re-run derives the same number — the property the original trap protected, kept across the split.
- **D-3116** — `verify-provenance.mjs` accepts `--blob-sha256 <hex>` beside `--blob <file>` on the `sigstore` backend. A release tarball measures 3.2 MB (v0.0.8, measured 2026-09-20), so the checked-in fixtures are bundles plus digests, never tarballs; `ccrc update` always passes `--blob`. The `gh` backend takes `--blob` only — it hashes the file itself.
- **D-3117** — the completed-install marker's second line `unsigned` is written for EVERY install the updater did not verify, not only for `--allow-unsigned` (spec §5): checkout-mode `ccrc install`, `install.sh --release` (trust-on-first-use), an update driven by a pre-W1 `ccrc`, and `--allow-unsigned`. The spine defaults to `unsigned`; `cmd_update` asserts `CCRC_UPDATE_VERIFIED=1` in the staged spine's environment only after a bundle verified. Under the spec's reading, §8's `verified` (caps say `verify`, no line 2) would have been claimed for installs nobody verified — a first W1 install placed by the old updater, every dev box — which is the overloaded value decision 11 bans.
- **D-3118** — `release.yml`'s `gh release create` also gains `--prerelease`. Spec §4 spells the flag for `release-main.sh` only, but decision 2 says a release's channel is a membership every release enters as `dev`; a hand-cut minor born stable would skip the promotion act decision 3 makes deliberate.
- **D-3119** — the vendored trusted root ships at `deploy/sigstore-trusted-root.jsonl` (the spec says "vendored" and no path), and `CCRC_SIGSTORE_TRUSTED_ROOT=<file>` overrides it. This is the by-hand refresh path for a root that has gone stale (Sigstore rotates keys rarely, but a node whose root predates a rotation refuses every newer bundle and `--allow-unsigned` deliberately does not apply to a FAILING bundle — §5); the operator fetches a fresh root with `gh attestation trusted-root` and points the variable at it for one update, which then ships the newer root.
- **D-3120** — the `gh` fallback backend needs `gh` ≥ 2.49 (`gh attestation` was added in 2.49.0); Ubuntu 24.04 ships 2.45.0 (measured on this box 2026-09-20: `gh attestation` is not a subcommand). The fallback's cost is therefore "a NEWER gh than the distribution's on every node", larger than the spec's "a gh on every node".
- **D-3121** — promotion's read-back is `gh api repos/{owner}/{repo}/releases/latest --jq .tag_name`, not `gh release view --json isLatest`: `gh release view` has no `isLatest` field (measured on gh 2.45: "Unknown JSON field") and the REST release object carries none either; "latest" is a property of the `/releases/latest` endpoint's answer.
- **D-3122** — `release-main.yml`'s attest step carries one conditional, `if: hashFiles('release-out/ccrc-*.tar.gz') != ''`: on an already-tagged HEAD `prepare` builds nothing (release.yml owns the tag) and the action refuses an empty subject glob. One expression in YAML, pinned by test; the script still owns every decision that has a second branch.
- **D-3123** — on the `gh` backend the verifier checks the subject NAME only; the digest comparison is `gh attestation verify`'s own (it hashes the file). On the `sigstore` backend the verifier does both. The spec's "the verifier asserts the subject NAME as well as its digest" holds on both; who computes the digest differs.
- **D-3124** — the spike verifies a bundle from a public attested release of another repository (`cli/cli`'s release tarball is the first candidate) because no ccrc release carries a bundle until Part A merges; the ccrc-identity fixtures are taken from Part A's first release afterwards (Task 8). The offline question the spike answers does not depend on whose bundle it is.
- **D-3125** — the attested artifact's bundle carried two signed entries, not one; the brief's SAN-extraction script reads only the first, a centralized GitHub-release-signer identity that no `--repo`/`--cert-identity` check can be scoped to, so the spike used the second (the repo's own reusable-workflow identity) throughout — confirming Task 8's verifier must loop every bundle entry, not just roots.
- **D-3126** — Task 3's Step 1 brief assumed `attest-build-provenance@v4`'s own README documents its permission set and input/output names at the pinned ref; measured instead, the v4 README carries neither — it is a thin wrapper whose README only redirects to `actions/attest`. The real authority is `actions/attest`'s README (its "Provenance Attestation (Default)" example, matching this exact no-registry-push usage, gives `contents: read` + `id-token: write` + `attestations: write`) plus `attest-build-provenance@v4`'s own `action.yml` for the `subject-path`/`bundle-path` names — both confirmed the brief's values unchanged, but if wrong, the next major bump sends its reader to a README that documents nothing, and a stale permission set or input name would go unmeasured rather than flagged.
- **D-3127** — `release.yml`'s "Name the provenance bundle" step gains a guard before the `cp` the brief's Step 5 text specified bare: `[ -f "release-out/ccrc-$GITHUB_REF_NAME.tar.gz" ]`, refusing (`exit 1`) when the tarball `build-release.sh` actually named (from `git tag --points-at HEAD`) disagrees with `$GITHUB_REF_NAME`. A commit carrying two release-shaped tags — a hand-cut `v0.1.0` landing on a commit `release-main` already auto-tagged `v0.0.9` — would otherwise ship a bundle named after the tag that triggered the run beside a tarball named after a different tag, with nothing to catch the mismatch. If this refusal is itself wrong, the cost is a hand-cut tag on a doubly-tagged commit failing its run (a re-runnable, release-less tag, the same shape as any other failed `release.yml` run) instead of publishing — the safe direction, never a silent bad pairing.
- **D-3128** — Task 4's brief had `deploy/release-stable.sh`'s already-stable path (`isPrerelease=false`) print `already stable <tag>` and exit 0 with no read-back at all; it now reads latest there too, and — when latest names another tag — issues the single `--latest` edit and re-reads before returning, converging to stable-and-latest rather than stopping at stable-only. The brief's own "re-run" remedy on a failed `--latest` edit was unreachable: a re-run hits exactly that early return, printing `already stable` and exiting 0 without ever finishing the promotion, so "stable and latest" and "stable but latest still points elsewhere" collapsed into the same exit 0 — and `latest/download` is what a node's update resolves against. Idempotent now means converging to the promoted state, matching D-3127's direction (every mismatch between what a tag names and what governs resolution gets a guard, not a silent pass-through). If this is wrong, the cost is an extra `gh api`/`gh release edit` round-trip on an already-converged release — cheap — traded against the alternative, a `stable` push that reports success while a node's update still resolves the previous release.
- **D-3129** — `deploy/release-stable.sh`'s tag lookup (`git tag --points-at HEAD | grep -E "$SHAPE" | head -n1`) picked the lexicographically first release-shaped tag when HEAD carries more than one, the exact doubly-tagged-commit shape D-3127 names (a hand-cut `v0.1.0` on a commit `release-main` already auto-tagged `v0.0.9`) — silently promoting `v0.0.9` and making it latest, exit 0, with the intended `v0.1.0` release left an un-promoted prerelease. It now collects every release-shaped tag at HEAD and refuses (exit 2, naming all of them) unless there is exactly one; a promotion names one release, and guessing is worse than asking the operator to delete the tag that isn't the release. If this is wrong, the cost is a doubly-tagged `stable` push refusing outright (re-runnable once the extra tag is deleted) instead of promoting a guessed-at release — the safe direction, never a silent wrong promotion.
- **D-3130** — Task 7 Step 4: the ruleset spec §4 and this plan prescribed for `stable` carried `required_linear_history` ("the rule that forbids merge commits"). GitHub evaluates that rule over every commit a push brings to the ref, and a branch creation brings `main`'s whole history, which holds 190 merge commits — the first promotion was refused (`GH013 … This branch must not contain merge commits`, naming `f6fb08f2`), and any later fast-forward carrying a merge-committed PR would be refused the same way. Ruleset 23740920 now carries `non_fast_forward` + `deletion` only, which is what "fast-forward-only" means; the property the rule was meant to buy — nothing but a released `main` commit is ever promoted — is held by `deploy/release-stable.sh` refusing any HEAD without exactly one release tag (a merge commit carries none). README, the script's header and the workflow's comment are corrected in the same commit, and the Task 4–6 snapshots in this plan with them. Cost if wrong: a merge commit pushed straight at `stable` is refused by the script (exit 2, no promotion) instead of by GitHub — the same outcome one hop later.
- **D-3131** — Task 8 pins `@sigstore/verify@^3.1`, `@sigstore/bundle@^4.0` and `@sigstore/protobuf-specs@^0.5` instead of the newest majors this plan named (verify 4.1.2 / bundle 5.0.0 / protobuf-specs 0.5.2): the v4/v5 majors declare `engines.node ^22.22.2 || ^24.15.0`, and the fleet box runs node 24.14.1 (so does the box this plan is executed from); the repo floor stays `>=22.13.0`. The implementer measures v3's export names (`Verifier`, `toSignedEntity`, `toTrustMaterial` were measured on 4.1.2, not on 3.x) instead of trusting this plan's. Cost if wrong: an older major whose API differs from the spike's — measured at Task 8, never assumed.
- **D-3132** — the no-tag-fixture deviation, minted at Task 8's dispatch: the `release-tag.*` fixture is absent because Task 7 Step 5 (the operator's `v0.1.0` atomic push) is undecided — not declined — at the moment Task 8 is written. The two `release.yml`-identity cases are written and wrapped in a `describe` guarded by `existsSync(RELEASE_TAG_META)`; never `it.skip`. The plan's presence case (`expect(present…).toBe(true)`, red-by-design while the fixture is absent) is replaced, because a red case in `test (server)` is a red required check and `main`'s protection enforces it for admins too — PR 2 could never merge: the case now passes trivially when the fixture is present and, when it is absent, asserts that THIS plan's text names `D-3132` beside the fixture's filename, so the absence is green only while it is recorded, and deleting the record reds the tree. When a `release.yml`-signed bundle exists (`v0.1.0` or any later hand-cut tag), the fixture is added and the guard lifts by itself. Cost if wrong: two cases that assert nothing until the fixture lands, visible as a deviation rather than as a red.
- **D-3133** — Task 8 review (Important, plan-mandated): the brief's `gh` arm collected in-toto statements from every entry of the bundle FILE and accepted the tag when any of them named `ccrc-<tag>.tar.gz`, while `gh attestation verify` may have accepted a different entry — a bundle asset carrying an appended, unsigned entry that names the expected subject defeats spec §5 refusal 3 on that arm (the sigstore arm binds its check to the entry that verified and has no such gap). The gh arm now runs `gh attestation verify … --format json` and reads the subject from the statements gh RETURNED — the ones it verified under the pinned identity — asserting the name AND the blob's sha256 there (the digest assertion the automated security review asked for is meaningful only against a verified statement; against the file's own statements it would catch nothing). Measured on gh 2.101.0 offline with the vendored root: `--format json` prints an array with one element per entry verified, each `{attestation, verificationResult: {statement: {subject: [{name, digest: {sha256}}], predicateType, …}, signature: {certificate: {subjectAlternativeName, …}}, verifiedIdentity, …}}`; output that is not such an array is refused with a message naming `--format json` (its presence at the D-3120 floor of gh 2.49 is unmeasured, so the refusal is the honest fallback). Pinned by a case whose recording stub prints a verified statement naming another tag while the bundle file names this one — the arm must refuse — and by one whose statement carries the right name with another digest; reading the file's statements again reds the first. The reviewer recommended leaving the arm and recording the asymmetry for the whole-branch pass; overruled: an arm that prints `verified` must mean it whichever backend an operator selects, and the fix is small and measured. Cost if wrong: the gh arm refuses on a gh that lacks `--format json` instead of verifying weakly — the safe direction; the default backend is untouched.
- **D-3134** — Task 8 review (Important, plan-mandated): the brief's verifier promised "exit 1 with one stderr line", but four unguarded reads — `--bundle`, the JSONL parse, `--blob`, the trusted root — threw a node stack trace on a missing or truncated file, the realistic shape of a half-downloaded bundle in Task 12's `_upd_fetch` (exit 1 by node's uncaught-exception path, so the caller's branch was right and only the operator-facing message was wrong). A top-level catch now funnels any error that is not already a refusal into the same one-line `verify-provenance: <why>` refusal, exit 1; pinned by a missing bundle, a truncated JSONL and a missing trusted-root path. Cost if wrong: an operator-facing line where a stack trace was — nothing else changes.
- **D-3135** — Task 10 review (Important, plan-mandated): the brief's `_inst_installed` lifted the marker's `printf` into an `if/else` whose exit status is discarded and started the `&&` chain at `chmod`, so a write that fails after creating the temp file (ENOSPC is the classic) is placed as the record, and a truncated `"<sha>\nunsigned\n"` loses its trailing token first — a ONE-line record, which spec §6 reads as `verified` on a node whose caps include `verify`, the precise false claim the marker's own comment forbids. The two `printf`s now sit inside one group with a single redirect at the head of the `&&` chain, so any write failure removes the temp file and dies before placement. The spec's one-line-means-verified shape is KEPT (§6's table reads no line 2 as `verified` only beside a `verify` cap and as `unknown` otherwise, which already covers a record placed by an older tree); an explicit `verified` token was considered and rejected as a contradiction of that table and of Task 12's pins. Cost if wrong: a failed marker write dies loudly at the end of an install that otherwise completed — the record is absent, `ccrc version` says `incomplete`, and the next `ccrc update` re-places it.
- **D-3136** — Task 10 review (Important, plan-mandated): the brief's floor block in `_inst_installed` overwrote a MALFORMED `~/.ccrc/floor` with the new version and printed `none before` for it — a present-but-unreadable file rendered as absent, the overloaded-null-at-a-seam ban, and the file's own `_inst_node_id` refuses a non-uuid rather than overwriting it. A floor whose content is not `vX.Y.Z` is now left untouched and named in one transcript line (`install: floor: ~/.ccrc/floor is malformed (got: '<content>') — left untouched; fix it by hand`), the install still completes (the record is already placed; the floor guards the NEXT update, and Task 11's `_upd_floor_check` refuses a malformed floor rather than reading it as none); absent and malformed are two words with two remedies. Cost if wrong: a hand-corrupted floor is not silently healed by the next install — the operator fixes one file.
- **D-3137** — Task 10: the brief's Files list omitted `server/test/single-definition.test.ts`, whose guard `the ccrc CLI spells the path once, and every other site goes through BOX_INSTALLED_FILE` pins the exact array of lines naming `BOX_INSTALLED_FILE`; the brief's own verbatim `cmd_version` rewrite replaced the pinned one-line read with the two-line read of the marker, so the guard could not stay green without a one-for-one re-pin of that entry (eleven entries before and after, `toEqual` unchanged, the sibling `.ccrc/installed`-spelled-once assertion untouched). The re-pin is faithful — reviewed as such — and the file is added to the task's list here. Cost if wrong: none beyond the review that already measured it.
- **D-3138** — Task 11: the brief's "at or above the floor proceeds without a word" case asserted `expect(r.stdout).not.toMatch(/floor/)`, which is ALWAYS red — `mkTmp` puts the fixture prefix `ccrc-update-floor-ok-` in the HOME's own path, `runUpdate` points `CCRC_RELEASE_BASE_URL` at that HOME, and `_upd_resolve`/`_upd_fetch` echo the fetch URLs on stdout, so the substring is present on every run of that fixture; a bare `/floor/` would also red for CORRECT behaviour the moment the case used the full-tree flavour, whose install spine prints `install: floor: …`. The assertion is narrowed to the check's own two voices (`is below this box's floor` on stdout; the refusals are stderr + exit 1, pinned by the exit assertion beside it). Cost if wrong: none — the narrowed pin reds if the check speaks on the ok path, which the bare one could never have measured.
- **D-3139** — Task 11 review (brief gap, applied in Task 12 because that task edits the same argument loop): `ccrc update --check --downgrade` was parsed and silently dropped — the check arm returns before `downgrade` is read — three lines below the comment that refuses `--check --force` for exactly that reason ("measure, and silently drop the flag you also typed"). `--check` now refuses `--downgrade` and `--allow-unsigned` with the same sentence shape as `--force`: an install-intent flag has no meaning on a measurement, and accepting it teaches the operator it did something. Cost if wrong: a typed pair that used to be accepted now exits 2 with one line naming the flag to drop.
- **D-3140** — Task 9 review (m1, applied in Task 12 because that task edits `_upd_fetch`): the extracted-tree `build.json` binding refuses with "unreadable or malformed (rc N)" for four `_box_build_fields` conditions, one of which — rc 5, `jq` absent — is a missing LOCAL tool, not a fault of the release; `cmd_update`'s by-name preflight (`for t in curl tar gzip node awk`) did not list `jq` although the verb's own old-identity read already needs it. `jq` joins that list, so a jq-less box is refused up front by the preflight's own sentence before any download, and the binding's message is true of every condition it can still reach; the malformed arm is pinned by a payload whose `build.json` is `{`. Cost if wrong: a box without `jq` that could previously update on the "unreadable identity" path now cannot until `jq` is installed — which `ccrc version` already demanded.

## Spike record (Task 1 fills this in; nothing below is assumed)

| Backend | Command | Exit | Non-loopback `connect()` calls (strace) | Verdict |
|---|---|---|---|---|
| `sigstore` (`@sigstore/verify` + vendored root) | `node spike-verify.mjs trusted_root.jsonl "$BUNDLE" "$SAN"` | 0 | 0 (0 `AF_INET`/`AF_INET6` connects of any kind — none, not even loopback) | WINS — fully offline |
| `gh attestation verify --bundle --custom-trusted-root` | `gh attestation verify gh_2.101.0_linux_amd64.tar.gz --bundle "$BUNDLE" --repo cli/cli --cert-identity "$SAN" --cert-oidc-issuer https://token.actions.githubusercontent.com --custom-trusted-root trusted_root.jsonl --deny-self-hosted-runners` | 0 | 0 | WINS — fully offline with vendored root |
| `gh attestation verify --bundle` (no custom root) | same command, `--custom-trusted-root` omitted | 0 | 9 by the brief's literal filter (4 of the 9 are `127.0.0.53:53`, the local resolver stub, which the filter's plain-substring exclusion misses as non-loopback); a stricter count leaves 5 IPv4 + 5 IPv6 genuinely off-box — the filter's `grep -v '::1'` also swallows all 5 IPv6 lines, since each of those addresses happens to contain the substring `::1`. Of the 10: one IPv4 and one IPv6 connect on port 443 (TLS) to the same public endpoint, and four IPv4 plus four IPv6 connects on port 53 to another public host — full addresses kept only in the untracked scratch strace logs, never repeated here per `topology-clean`'s public-IPv4 class — fetches the TUF root live | verifies fine, but NOT offline |

**Default backend chosen:** `sigstore` — its row is exit 0 with zero non-loopback connects (in fact zero connects of any kind), satisfying the rule as-written; `gh --custom-trusted-root` also qualifies (exit 0, zero non-loopback) so either backend would be safe offline, but `sigstore` is the primary per the rule's ordering.
**Artifact used:** `cli/cli`'s own release tarball `gh_2.101.0_linux_amd64.tar.gz`, sha256 `9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8` (no fallback repo needed — cli/cli attests its releases). `gh attestation download` wrote a 2-line bundle (`sha256:9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8.jsonl`): line 0's cert SAN is `URI:https://dotcom.releases.github.com` (GitHub's own centralized release-signing identity, issuer chain `O=GitHub, Inc.`/`CN=Fulcio Intermediate l1` — not the repo's own workflow, doesn't match this section's expected shape); line 1's cert SAN is `URI:https://github.com/cli/cli/.github/workflows/deployment.yml@refs/heads/trunk` (issuer `O=sigstore.dev`/`CN=sigstore-intermediate`), matching the brief's expected pattern. The spike used line 1's SAN (`https://github.com/cli/cli/.github/workflows/deployment.yml@refs/heads/trunk`) for both backends' `--cert-identity`/`subjectAlternativeName`, recorded as a deviation from the brief's literal script (which reads only `.filter(Boolean)[0]`, i.e. line 0) — see D-3125 below.
**Import names measured:** `@sigstore/verify@4.1.2`'s exports are exactly `Verifier`, `toSignedEntity`, `toTrustMaterial` (plus `PolicyError`, `VerificationError`) — matching Task 8's draft names verbatim; no correction needed. `@sigstore/bundle@5.0.0` and `@sigstore/protobuf-specs@0.5.2` installed clean (npm warned `EBADENGINE` against the running Node v24.14.1 — the packages want `^22.22.2 || ^24.15.0 || >=26.0.0` — but ran correctly regardless).

**Deviation — bundle carries two attestation entries, not one (D-3125):** `gh attestation download` for `cli/cli`'s release tarball returned a bundle with two signed entries (a centralized GitHub-release-signer entry at index 0, and the repo's own reusable-workflow entry at index 1), where the brief's SAN-extraction script reads only index 0. Index 0's SAN does not match the brief's stated "Expected" shape (`https://github.com/cli/cli/.github/workflows/<file>.yml@refs/heads/<branch>`); index 1's does. The spike used index 1 throughout (SAN extraction, both backends' `--cert-identity`). Allocated 2026-09-20 by the controller through the ledger allocator. If index 1 had been the wrong choice — i.e. a verifier trusted index 0's identity instead — a validly-attested artifact would be rejected as unverified, not falsely accepted: index 0's `dotcom.releases.github.com` identity is never scoped to `cli/cli`'s own workflow, so no backend's `--repo`/`subjectAlternativeName` check can be satisfied by it. This confirms Task 8's verifier does need to loop every bundle entry as drafted, not just roots: re-running the offline sigstore step against every (root, bundle-entry) pair shows entry 0 never verifies under either trusted-root line (`root 0 / bundle 0`: "timestamp could not be verified"; `root 1 / bundle 0`: "expected 1 SCTs, got 0"), while entry 1 verifies cleanly under root line 0 and refuses under root line 1 (`root 1 / bundle 1`: "Failed to verify certificate chain"). Root line 0 of the vendored file (populated `tlogs`/`ctlogs`) is the only line that can ever satisfy `ctlogThreshold: 1, tlogThreshold: 1`; root line 1 (`certificateAuthorities`/`timestampAuthorities` only, no `tlogs`/`ctlogs`) always throws under those same thresholds — a per-root loop must expect that. The drafted thresholds (`ctlogThreshold: 1, tlogThreshold: 1, tsaThreshold: 0`) verified unchanged.
**gh version used:** 2.101.0 (n=101, ≥49 as required); system `gh` remained 2.45.0, untouched, never placed on PATH.

**Provenance-action README note (Task 3, D-3126):** the same "measure the ref, don't assume the docs page" discipline this spike used applies one level up, to the action Task 3 pins. `actions/attest-build-provenance@v4` itself documents no permission set and no input/output names — its README redirects to `actions/attest` — so Task 3 measured the permission set and the `subject-path`/`bundle-path` names from `actions/attest`'s README and from `attest-build-provenance@v4`'s own `action.yml` instead. Both confirmed the values this plan shipped; Task 8's reader pinning a future major should re-measure the same way, not assume the pinned action's README says anything.

---

## Part A — release side (PR 1)

Branch: the current `ws/ccrc-auto-update-mechanism` (the spec is already on it). Rebase onto `origin/main` first: it moved to `b66c73ea` (#160) after the spec commit.

### Task 1: The offline-verify spike (measure, record, vendor the root)

**Files:**
- Create: `deploy/sigstore-trusted-root.jsonl` (the vendored root — the ONLY tracked output of this task)
- Modify: this plan's "Spike record" section
- Scratch: `$SCRATCHPAD/spike/` (never under the repo)

**Interfaces:**
- Produces: `deploy/sigstore-trusted-root.jsonl` — one JSON object per line, each a Sigstore `TrustedRoot` in protobuf-JSON form, as `gh attestation trusted-root` prints it. Task 8's verifier reads it line by line and tries each root.
- Produces: the default backend name Task 8 hard-codes (`sigstore` or `gh`).

- [ ] **Step 1: A gh that knows `attestation`**

The box's `gh` is 2.45 (no `attestation`). Download a current release binary INTO THE SCRATCHPAD, never onto PATH:

```bash
S="$SCRATCHPAD/spike"; mkdir -p "$S" && cd "$S"
gh release download -R cli/cli -p 'gh_*_linux_amd64.tar.gz' -D .
tar -xzf gh_*_linux_amd64.tar.gz
GHNEW="$(ls -d "$S"/gh_*_linux_amd64)/bin/gh"; "$GHNEW" --version
```
Expected: `gh version 2.<n>` with n ≥ 49. Record n in the spike record.

- [ ] **Step 2: The trusted root, fetched once**

```bash
"$GHNEW" attestation trusted-root > "$S/trusted_root.jsonl"
wc -l "$S/trusted_root.jsonl"; head -c 200 "$S/trusted_root.jsonl"
```
Expected: one or more lines, each starting `{"mediaType":"application/vnd.dev.sigstore.trustedroot` … If `trusted-root` prints nothing, fall back to `@sigstore/tuf`: `cd "$S" && npm init -y >/dev/null && npm i @sigstore/tuf && node -e "import('@sigstore/tuf').then(m=>m.getTrustedRoot()).then(r=>console.log(JSON.stringify(r)))" > trusted_root.jsonl`.

- [ ] **Step 3: A real attested artifact and its bundle**

The gh tarball downloaded in Step 1 is itself a candidate (cli/cli attests its releases):

```bash
cd "$S" && "$GHNEW" attestation download gh_*_linux_amd64.tar.gz -R cli/cli
ls sha256:*.jsonl && BUNDLE="$(ls sha256:*.jsonl | head -n1)" && ARTIFACT="$(ls gh_*_linux_amd64.tar.gz)"
```
Expected: one `sha256:<digest>.jsonl` file. If cli/cli answers "no attestations", pick any public release asset for which `attestation download -R <owner/repo>` returns one (`actions/attest-build-provenance`'s own release assets are the second candidate) and record which. Then read the certificate's SAN out of the bundle — it is the identity the spike verifies against:

```bash
node -e '
const l = require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)[0];
const b = JSON.parse(l);
const pem = "-----BEGIN CERTIFICATE-----\n" + (b.verificationMaterial.certificate?.rawBytes ?? b.verificationMaterial.x509CertificateChain.certificates[0].rawBytes) + "\n-----END CERTIFICATE-----";
const c = new (require("crypto").X509Certificate)(pem);
console.log(c.subjectAltName);
' "$BUNDLE"
```
Expected: `URI:https://github.com/cli/cli/.github/workflows/<file>.yml@refs/heads/<branch>` (or `@refs/tags/…`). Keep the URI (without the `URI:` prefix) in a file the later steps read, never retyped:

```bash
node -e '…the same script…' "$BUNDLE" | sed 's/^URI://' > "$S/san.txt"; SAN="$(cat "$S/san.txt")"; echo "$SAN"
```
and copy it into the spike record's "Artifact used" cell.

- [ ] **Step 4: The sigstore-js backend, offline, measured with strace**

```bash
cd "$S" && npm init -y >/dev/null && npm i @sigstore/verify@4 @sigstore/bundle@5 @sigstore/protobuf-specs@0.5 >/dev/null
cat > spike-verify.mjs <<'MJS'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { Verifier, toSignedEntity, toTrustMaterial } = req('@sigstore/verify');
const { bundleFromJSON } = req('@sigstore/bundle');
const { TrustedRoot } = req('@sigstore/protobuf-specs');
const [rootPath, bundlePath, san] = process.argv.slice(2);
const roots = readFileSync(rootPath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => TrustedRoot.fromJSON(JSON.parse(l)));
const bundles = readFileSync(bundlePath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => bundleFromJSON(JSON.parse(l)));
let ok = false, last;
for (const root of roots) {
  const v = new Verifier(toTrustMaterial(root), { ctlogThreshold: 1, tlogThreshold: 1, tsaThreshold: 0 });
  for (const b of bundles) {
    try {
      const signer = v.verify(toSignedEntity(b), { subjectAlternativeName: san, extensions: { issuer: 'https://token.actions.githubusercontent.com' } });
      console.log('verified; signer:', JSON.stringify(signer.identity ?? signer));
      ok = true;
    } catch (e) { last = e; }
  }
}
if (!ok) { console.error('refused:', last?.message ?? last); process.exit(1); }
MJS
strace -f -e trace=connect -o strace-sigstore.log node spike-verify.mjs trusted_root.jsonl "$BUNDLE" "$SAN"; echo "exit $?"
grep -c 'AF_INET' strace-sigstore.log; grep 'AF_INET' strace-sigstore.log | grep -v '127\.0\.0\.1\|::1' | head
```
Expected for the primary backend to WIN: `exit 0`, and the non-loopback grep prints nothing. Record exit, the count, and the exact export names that resolved (if `Verifier`/`toSignedEntity`/`toTrustMaterial` are not the names, `node -e "console.log(Object.keys(require('@sigstore/verify')))"` in `$S` says what they are — write them in the spike record; Task 8 uses the measured names).

If the import names differ, correct the draft and re-run; if verification refuses for a reason naming the tlog/ctlog thresholds, re-run with `tlogThreshold: 0` ONCE to see whether the bundle carries a Rekor entry at all, record it, and restore `1` — a threshold of 0 is not a configuration this plan ships.

- [ ] **Step 5: The gh backend, offline, measured the same way**

```bash
cd "$S"
strace -f -e trace=connect -o strace-gh.log "$GHNEW" attestation verify "$ARTIFACT" --bundle "$BUNDLE" --repo cli/cli \
  --cert-identity "$SAN" --cert-oidc-issuer https://token.actions.githubusercontent.com \
  --custom-trusted-root trusted_root.jsonl --deny-self-hosted-runners; echo "exit $?"
grep 'AF_INET' strace-gh.log | grep -v '127\.0\.0\.1\|::1' | wc -l
strace -f -e trace=connect -o strace-gh-noroot.log "$GHNEW" attestation verify "$ARTIFACT" --bundle "$BUNDLE" --repo cli/cli \
  --cert-identity "$SAN" --cert-oidc-issuer https://token.actions.githubusercontent.com --deny-self-hosted-runners; echo "exit $?"
grep 'AF_INET' strace-gh-noroot.log | grep -v '127\.0\.0\.1\|::1' | wc -l
```
Record both rows. (`--repo cli/cli` is the artifact's repo; for a ccrc bundle Task 8 passes `--repo <owner>/<repo>` from `ccd/ccrc`'s pair.)

- [ ] **Step 6: Vendor the root and fill the record**

```bash
cp "$S/trusted_root.jsonl" /path/to/repo/deploy/sigstore-trusted-root.jsonl
```
Fill every "*filled by Task 1*" cell in this plan's spike record from the measurements above, including the default backend. Then stage the file and run the residue guard: `git add deploy/sigstore-trusted-root.jsonl && (cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)` → green.

- [ ] **Step 7: Commit**

```bash
git add deploy/sigstore-trusted-root.jsonl docs/superpowers/plans/2026-09-20-centralised-update-w1-release-and-provenance.md
git commit -m "chore(provenance): vendor the Sigstore trusted root; W1 spike record — offline verification measured on both backends"
```

### Task 2: `release-main.sh` — two arms, `--prerelease`, the bundle as a third artifact

**Files:**
- Modify: `deploy/release-main.sh` (whole file; today's is 97 lines)
- Test: `server/test/release-main.test.ts` (`run()` at `:112-117`, the derive `it.each` at `:174-197`, the order test `:199-205`, the cleanup test `:207-215`, the source pins `:218-229` — all at `7d78b376`)

**Interfaces:**
- Produces: `bash deploy/release-main.sh prepare --out <dir>` — exit 0; writes `<dir>/release-main.state` with two lines, `built true|false` and `tag vX.Y.Z`; on `built true` the artifacts `ccrc-<tag>.tar.gz` and `SHA256SUMS` are in `<dir>` and the tag exists LOCALLY only.
- Produces: `bash deploy/release-main.sh publish --out <dir>` — reads the state; with `CCRC_BUNDLE_PATH=<file>` set, copies it to `<dir>/ccrc-<tag>.tar.gz.sigstore.json`; requires that file; pushes the tag; `gh release create <tag> <tarball> <sums> <bundle> --verify-tag --prerelease`; deletes the tag from origin if the publish never completes. Exit 2 with no state; exit 0 doing nothing on `built false`.
- Consumed by Task 3's workflow.

- [ ] **Step 1: Write the failing tests**

Replace `run()` and the "derive, push, build, publish" describe in `server/test/release-main.test.ts` with the two-arm shape. `run()` gains an env argument; the derive cases run both arms:

```ts
interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], ghExit = 0,
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const bin = plantBin(home, ghExit);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, ...extraEnv }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** What the attest step leaves behind: any file — the script copies it, never reads it. */
function plantBundle(home: string): string {
  const p = join(home, 'attest-bundle.json');
  writeFileSync(p, '{"fixture":"sigstore bundle"}\n');
  return p;
}
```

```ts
describe('release-main.sh: prepare (tag locally, build) then publish (push, three artifacts, --prerelease)', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],
    [['v0.0.1', 'vnext', 'v1.2', 'v1.2.3-rc1'], 'v0.0.2'],
    [[], 'v0.0.1'],
  ])('highest %j → next %s: prepare tags locally, publish pushes and publishes', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    // Prepared: the tag is local, origin has NOT seen it, nothing was published.
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    expect(originTags(home)).not.toContain(next);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe(`built true\ntag ${next}\n`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz`))).toBe(true);
    const bundle = plantBundle(home);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: bundle });
    expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(readFileSync(join(home, 'origin-pushes'), 'utf8')).toBe(`refs/tags/${next}\n`);
    // All three artifacts NAMED, the flag trailing (the stub records `$*` as one line).
    expect(readFileSync(join(home, 'gh-argv'), 'utf8').trim())
      .toBe(`release create ${next} ${out}/ccrc-${next}.tar.gz ${out}/SHA256SUMS ${out}/ccrc-${next}.tar.gz.sigstore.json --verify-tag --prerelease`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz.sigstore.json`))).toBe(true);
    expect(q.stdout).toMatch(/published v[0-9.]+ as a prerelease/);
  });

  it('publish pushes the tag BEFORE gh runs — --verify-tag needs it on origin', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('publish without a bundle refuses, pushes nothing, keeps the local tag for a retry', () => {
    const home = mkTmp('ccrc-relmain-nobundle-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/no provenance bundle .* refusing to publish an unattested release; nothing was pushed/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    // CCRC_BUNDLE_PATH naming a file that does not exist is the same refusal.
    const q2 = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: join(home, 'missing.json') });
    expect(q2.code).toBe(1);
    expect(q2.stderr).toMatch(/CCRC_BUNDLE_PATH names no file/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('publish without a prepared state is a usage error, exit 2, nothing touched', () => {
    const home = mkTmp('ccrc-relmain-nostate-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const q = run(root, home, ['publish', '--out', join(home, 'out')]);
    expect(q.code).toBe(2);
    expect(q.stderr).toMatch(/run 'release-main.sh prepare' first/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a failed publish deletes the pushed tag from origin, so no release-less tag remains', () => {
    const home = mkTmp('ccrc-relmain-cleanup-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 1, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
  });

  it('an already-tagged HEAD: prepare records built false and publish does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(0);
    expect(p.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built false\ntag v1.0.0\n');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(0);
    expect(q.stdout).toMatch(/nothing to publish — v1\.0\.0 was already tagged at checkout; release\.yml owns it/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('a leftover LOCAL tag from an earlier prepare is named, not mistaken for release.yml\'s', () => {
    const home = mkTmp('ccrc-relmain-leftover-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/HEAD carries v0\.0\.2 which origin does not hold — a previous prepare's local tag/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('an arm is required, and only one', () => {
    const home = mkTmp('ccrc-relmain-arm-');
    const root = fixture(home);
    expect(run(root, home, []).code).toBe(2);
    expect(run(root, home, ['prepare', 'publish']).code).toBe(2);
  });
});
```

Keep the "refusals before anything is written" describe, changing each `run(root, home, …)` to `run(root, home, ['prepare', …])`, and the stale-checkout test to `['prepare', '--out', join(home, 'out')]`. Update the source pins:

```ts
describe('release-main.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('derives with sort -V — plain sort would rank v1.9.10 below v1.9.9', () => { expect(src()).toMatch(/sort -V/); });
  it('builds through build-release.sh and owns no second build path', () => {
    expect(src()).toContain('deploy/build-release.sh" --out "$OUT_DIR"');
    expect(src()).not.toMatch(/npm ci|npm run/);
  });
  it('names all three artifacts to gh rather than globbing, and publishes a PRERELEASE (design §4, §18 rows 1 and 7)', () => {
    expect(src()).toContain('"$tarball" "$sums" "$bundle" --verify-tag --prerelease');
  });
});
```

- [ ] **Step 2: Run the file to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/release-main.test.ts`
Expected: FAIL — `prepare` is "unknown argument: prepare" (exit 2) in every new case.

- [ ] **Step 3: Rewrite `deploy/release-main.sh`**

```bash
#!/usr/bin/env bash
# release-main.sh — every merge to main becomes a PRERELEASE (design 2026-09-20
# §4, decision 2: every release is born on the `dev` channel; `stable` is a
# promotion, release-stable.sh). TWO ARMS, because the provenance bundle is
# produced by the workflow's attest ACTION, which has to run AFTER the build
# and BEFORE the publish, and a bash script cannot run an action:
#
#   prepare  — refuse dirty/tagged, derive the next PATCH tag from the highest
#              release-shaped tag, tag it LOCALLY (never pushed here), build
#              with build-release.sh (the one builder), write
#              $OUT_DIR/release-main.state.
#   publish  — read the state, copy the attest step's bundle
#              ($CCRC_BUNDLE_PATH) to the name every `ccrc update` fetches,
#              refuse without it, push the tag, `gh release create` naming
#              ALL THREE artifacts `--prerelease`, delete the tag again if
#              the publish never completes.
#
# NOTHING REACHES ORIGIN BEFORE publish's push — so a failed attest step, a
# cancelled job between the arms, or a refused publish leaves origin exactly
# as it was and a re-run derives the same number. That is the property the
# one-script version's cleanup trap protected, kept across the split.
#
# WHY ONE WORKFLOW DOES ALL OF IT: a tag pushed with the workflow's own
# GITHUB_TOKEN never fires release.yml (GitHub suppresses workflow-caused
# events), and this repo carries no Actions secret that could push as someone
# else. So the main-push job must tag AND build AND attest AND publish itself.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-main.sh prepare|publish [--out <dir>] — prepare: on a clean, untagged HEAD derive the next vX.Y.Z patch tag, tag LOCALLY, build with build-release.sh; publish: push the tag and publish tarball + SHA256SUMS + provenance bundle (\$CCRC_BUNDLE_PATH) as a prerelease"; }
die() { echo "release-main.sh: $*" >&2; exit 1; }

ARM=""
OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    prepare|publish)
      [ -z "$ARM" ] || { echo "release-main.sh: one arm, not two: $ARM and $1" >&2; usage >&2; exit 2; }
      ARM="$1"; shift ;;
    --out)
      [ $# -ge 2 ] || { echo "release-main.sh: --out needs a directory" >&2; usage >&2; exit 2; }
      OUT_DIR="$2"; shift 2 ;;
    *) echo "release-main.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$ARM" ] || { echo "release-main.sh: an arm is required: prepare or publish" >&2; usage >&2; exit 2; }
[ -n "$OUT_DIR" ] || OUT_DIR="$ROOT/release-out"
STATE="$OUT_DIR/release-main.state"
SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'

# ── prepare ──────────────────────────────────────────────────────────────
prepare() {
  [ -z "$(git -C "$ROOT" status --porcelain)" ] \
    || die "refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty)"

  local at_head
  at_head="$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" || at_head=""
  mkdir -p "$OUT_DIR"
  if [ -n "$at_head" ]; then
    # Origin holds it → a hand-pushed tag, release.yml's. Origin does NOT →
    # a previous prepare's local tag on this checkout: say so, never build a
    # second artifact for it and never let publish mistake it for release.yml's.
    if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$at_head" >/dev/null 2>&1; then
      echo "release-main.sh: already tagged $at_head; release.yml owns it — nothing to do"
      printf 'built false\ntag %s\n' "$at_head" > "$STATE"
      return 0
    fi
    die "HEAD carries $at_head which origin does not hold — a previous prepare's local tag; delete it (git tag -d $at_head) and re-run. Nothing was built or pushed"
  fi

  # Derive: highest release-shaped tag, patch + 1. `sort -V` and not `sort`:
  # v1.9.10 outranks v1.9.9, which a lexical sort gets backwards.
  local highest next major minor patch
  highest="$(git -C "$ROOT" tag --list 'v*' | grep -E "$SHAPE" | sort -V | tail -n1)" || highest=""
  if [ -n "$highest" ]; then
    IFS=. read -r major minor patch <<< "${highest#v}"
    next="v$major.$minor.$((patch + 1))"
  else
    next="v0.0.1"
  fi
  echo "release-main.sh: highest release tag: ${highest:-none}; next: $next"

  # A tag-stale checkout: local tags behind origin would derive a number
  # origin already has. Refuse rather than guess; nothing was tagged.
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$next" >/dev/null 2>&1; then
    die "origin already holds $next — this checkout's tags are behind origin; fetch tags (git fetch --tags origin) and re-run. Nothing was tagged, pushed or deleted"
  fi

  # Tag LOCALLY (build-release.sh names the artifact by the tag at HEAD), build,
  # and drop the local tag again if the build fails so a re-run derives the
  # same number.
  git -C "$ROOT" tag "$next" || die "git tag $next failed"
  if ! bash "$ROOT/deploy/build-release.sh" --out "$OUT_DIR"; then
    git -C "$ROOT" tag -d "$next" >/dev/null 2>&1 || :
    die "build-release.sh failed — the local tag $next was removed; nothing reached origin"
  fi
  printf 'built true\ntag %s\n' "$next" > "$STATE"
  echo "release-main.sh: prepared $next — tagged locally (NOT pushed), artifacts in $OUT_DIR; next: the attest step, then 'release-main.sh publish'"
}

# ── publish ──────────────────────────────────────────────────────────────
PUBLISHED=false
TAG_TO_CLEAN=""
cleanup() {
  [ "$PUBLISHED" = true ] && return 0
  [ -n "$TAG_TO_CLEAN" ] || return 0
  echo "release-main.sh: the publish did not complete — deleting tag $TAG_TO_CLEAN from origin so no release-less tag remains" >&2
  git -C "$ROOT" push origin --delete "refs/tags/$TAG_TO_CLEAN" >/dev/null 2>&1 \
    || echo "release-main.sh: could not delete $TAG_TO_CLEAN from origin — delete it by hand: git push origin --delete $TAG_TO_CLEAN" >&2
  git -C "$ROOT" tag -d "$TAG_TO_CLEAN" >/dev/null 2>&1 || :
}

publish() {
  [ -f "$STATE" ] || { echo "release-main.sh: no $STATE — run 'release-main.sh prepare' first" >&2; exit 2; }
  local built="" tag="" k v
  while read -r k v; do
    case "$k" in built) built="$v" ;; tag) tag="$v" ;; esac
  done < "$STATE"
  if [ "$built" = false ]; then
    echo "release-main.sh: nothing to publish — $tag was already tagged at checkout; release.yml owns it"
    return 0
  fi
  [ "$built" = true ] && [[ "$tag" =~ $SHAPE ]] || die "malformed $STATE — re-run prepare"

  local tarball="$OUT_DIR/ccrc-$tag.tar.gz" sums="$OUT_DIR/SHA256SUMS" bundle="$OUT_DIR/ccrc-$tag.tar.gz.sigstore.json"
  [ -f "$tarball" ] && [ -f "$sums" ] || die "prepare's artifacts are missing from $OUT_DIR — re-run prepare"

  # THE BUNDLE: the attest step's own output file, copied to the name every
  # `ccrc update` fetches (`<tarball>.sigstore.json`, design §5). Absent, the
  # release is unattested and is not published — a release-less tag is
  # recoverable (nothing was pushed), an unattested release is not.
  if [ -n "${CCRC_BUNDLE_PATH:-}" ]; then
    [ -f "$CCRC_BUNDLE_PATH" ] \
      || die "CCRC_BUNDLE_PATH names no file: $CCRC_BUNDLE_PATH — the attest step did not produce a bundle; nothing was pushed"
    cp -- "$CCRC_BUNDLE_PATH" "$bundle"
  fi
  [ -f "$bundle" ] \
    || die "no provenance bundle at $bundle — the attest step must run between prepare and publish (CCRC_BUNDLE_PATH names its output); refusing to publish an unattested release; nothing was pushed"

  [ "$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" = "$tag" ] \
    || die "HEAD no longer carries $tag — re-run prepare"
  if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    git -C "$ROOT" tag -d "$tag" >/dev/null 2>&1 || :
    die "origin already holds $tag — another run published it between prepare and publish; the local tag was removed, nothing was pushed"
  fi

  # Push BEFORE publish (gh --verify-tag checks the remote); from here the
  # cleanup trap owns the tag until the publish completes.
  if ! git -C "$ROOT" push origin "refs/tags/$tag"; then
    git -C "$ROOT" tag -d "$tag" >/dev/null 2>&1 || :
    die "git push origin $tag failed — the local tag was removed; nothing was published"
  fi
  TAG_TO_CLEAN="$tag"
  trap cleanup EXIT

  # All three artifacts NAMED, not globbed: a glob's order follows the
  # locale's collation, and the test pins the argv. `--prerelease` trailing:
  # this release is born on `dev` (decision 2); release-stable.sh promotes it.
  gh release create "$tag" "$tarball" "$sums" "$bundle" --verify-tag --prerelease
  PUBLISHED=true
  echo "release-main.sh: published $tag as a prerelease (dev) — promotion to stable is a fast-forward push of this commit to the stable branch (deploy/release-stable.sh)"
}

case "$ARM" in
  prepare) prepare ;;
  publish) publish ;;
esac
```

- [ ] **Step 4: Run the file to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/release-main.test.ts`
Expected: PASS, every case. Count the cases before and after (the file had 10; it now has 13 — a smaller green is still green only if the count says so).

- [ ] **Step 5: Mutation check (spec §18 rows 1 and 7)**

Delete `--prerelease` from the `gh release create` line → the derive cases and the source pin go red. Restore. Delete `"$bundle"` from the argv → the derive cases go red. Restore. Run the file green again.

- [ ] **Step 6: Commit**

```bash
git add deploy/release-main.sh server/test/release-main.test.ts
git commit -m "feat(release): release-main.sh prepares then publishes — a prerelease with its provenance bundle as a third artifact, the tag on origin only once all three exist"
```

### Task 3: Both build workflows attest; `release-main.yml` runs the two arms; `release.yml` publishes a prerelease

**Files:**
- Modify: `.github/workflows/release-main.yml` (whole file; 56 lines today)
- Modify: `.github/workflows/release.yml` (whole file; 58 lines today)
- Test: `server/test/build-release.test.ts` — the `release.yml` describe (`:421-455`) and the `release-main.yml` describe (`:457-489`) at `7d78b376`

**Interfaces:**
- Consumes: Task 2's two arms and `CCRC_BUNDLE_PATH`.
- Produces: two certificate identities Task 8's verifier accepts — `https://github.com/<owner>/<repo>/.github/workflows/release-main.yml@refs/heads/main` and `…/release.yml@refs/tags/<tag>` — and a release asset named `ccrc-<tag>.tar.gz.sigstore.json` on every release either workflow cuts.

- [ ] **Step 1: Measure the action's documented permission set at the pinned ref**

The newest major of `actions/attest-build-provenance` was `v4` (v4.2.2) on 2026-09-20. Read its README AT THAT REF, not a docs page (the spec records that the two disagree):

```bash
gh api 'repos/actions/attest-build-provenance/contents/README.md?ref=v4' --jq .content | base64 -d | grep -n -B2 -A6 'permissions:' | head -40
gh api 'repos/actions/attest-build-provenance/contents/README.md?ref=v4' --jq .content | base64 -d | grep -n -E 'subject-path|bundle-path' | head
```
Expected: `id-token: write`, `attestations: write`, and `contents: read`; inputs name `subject-path`, outputs name `bundle-path`. The workflows below carry `contents: write` (a superset the release itself needs) plus the two. If the README's set or the input/output names differ, use the README's, and record the difference as a deviation in this plan. If the newest major is no longer `v4`, pin the newest and say so in the same entry.

- [ ] **Step 2: Write the failing tests**

In `server/test/build-release.test.ts`, add a shared helper above the two workflow describes, then rewrite the two describes:

```ts
/** What BOTH build workflows must say to attest (design 2026-09-20 §4): the
 *  pinned action, the tarball glob as subject, and the permission set the
 *  action's README documents at that ref — `contents: write` because the
 *  release itself needs it. `id-token` was FORBIDDEN by the stage-4 pin
 *  (a key nobody asked for); it is now the signing identity, asked for in
 *  the diff. Nothing else. */
function expectAttestingWorkflow(src: string, name: string): void {
  expect(src, `${name}: the attest step, pinned by tag, subject = the tarball glob`)
    .toMatch(/^      - uses: actions\/attest-build-provenance@v4\n        id: attest\n(?:        if: .*\n)?        with:\n          subject-path: release-out\/ccrc-\*\.tar\.gz$/m);
  expect(src, `${name}: exactly the documented permission set`)
    .toMatch(/^    permissions:\n      contents: write\n      id-token: write\n      attestations: write$/m);
  expect(src, `${name}: no other permission`).not.toMatch(/(packages|pull-requests|actions|deployments|issues):/);
}

describe('release.yml: the thin workflow, pinned to the script', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on v* tag pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    tags: \['v\*'\]$/m);
    for (const trigger of ['branches:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('invokes build-release.sh and owns no second build path', () => {
    const src = wf();
    expect(src).toContain('bash deploy/build-release.sh --out release-out');
    expect(src, 'the YAML must not run npm itself').not.toMatch(/npm ci|npm run/);
    expect(src, 'the YAML must not invoke a compiler').not.toMatch(/\btsc\b|\bvite\b/);
  });

  it('attests the tarball after the build and before the publish, names the bundle, publishes a PRERELEASE with all three (design 2026-09-20 §4; D-3118)', () => {
    const src = wf();
    expectAttestingWorkflow(src, 'release.yml');
    expect(src).toContain('cp "$CCRC_BUNDLE_PATH" "release-out/ccrc-$GITHUB_REF_NAME.tar.gz.sigstore.json"');
    expect(src).toContain('CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}');
    expect(src).toContain('gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag --prerelease');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    const build = src.indexOf('bash deploy/build-release.sh');
    const attest = src.indexOf('actions/attest-build-provenance');
    const publish = src.indexOf('gh release create');
    expect(build).toBeGreaterThan(-1);
    expect(attest).toBeGreaterThan(build);
    expect(publish).toBeGreaterThan(attest);
  });
});

describe('release-main.yml: the thin main-push workflow, pinned to its script (spec 2026-09-18 §3, 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-main.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on main pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    branches: \[main\]$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-main.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises: one concurrency group, never cancelling an in-flight release', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-main\n  cancel-in-progress: false$/m);
  });

  it('checks out at full depth — the tags it derives from must be present', () => {
    expect(wf()).toMatch(/fetch-depth: 0/);
  });

  it('runs prepare, attests, then publish — the bundle path handed to the script, the attest step skipped when nothing was built (D-3122)', () => {
    const src = wf();
    expectAttestingWorkflow(src, 'release-main.yml');
    expect(src).toContain('bash deploy/release-main.sh prepare --out release-out');
    expect(src).toContain('bash deploy/release-main.sh publish --out release-out');
    expect(src).toContain("if: hashFiles('release-out/ccrc-*.tar.gz') != ''");
    expect(src).toContain('CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    const prepare = src.indexOf('release-main.sh prepare');
    const attest = src.indexOf('actions/attest-build-provenance');
    const publish = src.indexOf('release-main.sh publish');
    expect(prepare).toBeGreaterThan(-1);
    expect(attest).toBeGreaterThan(prepare);
    expect(publish).toBeGreaterThan(attest);
    expect(src, 'the YAML must not build').not.toMatch(/npm ci|npm run|build-release\.sh/);
    expect(src, 'the YAML must not publish — the script owns the publish and its cleanup').not.toMatch(/gh release/);
  });
});
```

- [ ] **Step 3: Run the file to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts`
Expected: FAIL in the two workflow describes only (no attest step, old permissions, old argv). Every other case in the file stays green — `build-release.sh` is untouched.

- [ ] **Step 4: Write `.github/workflows/release-main.yml`**

```yaml
# Every merge to main becomes a PRERELEASE carrying a provenance bundle
# (designs 2026-09-18 §3 and 2026-09-20 §4). Thin by design, like release.yml:
# deploy/release-main.sh owns the derivation, the local tag, the build, the
# push and the publish — in TWO ARMS, so the attest ACTION can run between
# them — and both arms are tested locally (server/test/release-main.test.ts).
# The one expression this file decides, the attest step's `if:`, is pinned
# in server/test/build-release.test.ts.
#
# Deliberately NOT gated on ci.yml: the PR's required checks are the gate,
# before the merge; main's post-merge matrix is a 45-minute re-check that the
# previous deploy path never waited for either (spec §2, decision 4).
name: release-main

on:
  push:
    branches: [main]

# Two close merges serialise, so the second derives its tag after the first
# has pushed. Never cancel: nothing reaches origin before the publish arm's
# push, but a run cancelled mid-publish is the release-less tag the script's
# trap exists to prevent.
concurrency:
  group: release-main
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    # The job holds an open contents:write token while it runs. 30, like
    # release.yml — the one measured run took 41 s.
    timeout-minutes: 30
    # contents: write — the tag push and the release. id-token: write and
    # attestations: write — actions/attest-build-provenance's documented set
    # at the pinned ref: the OIDC token IS the signing identity, so there is
    # no key to keep and no secret in this repo. Everything else stays
    # read-only; ci.yml's stance is that a writing job asks in the diff —
    # this is that ask.
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v4
        with:
          # The next tag is derived from the highest existing one, and the
          # release script names the artifact by `git tag --points-at HEAD`:
          # both need the tags present, not a shallow single-commit fetch.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version-file: server/package.json
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json

      # Arm 1: refuses dirty/tagged, derives, tags LOCALLY, builds. Nothing
      # reaches origin here.
      - name: Derive the next tag and build the artifact
        run: bash deploy/release-main.sh prepare --out release-out

      # Keyless provenance (design 2026-09-20 §4, §5): THIS workflow's OIDC
      # identity at refs/heads/main signs the tarball's digest; the bundle
      # is published beside the tarball and every `ccrc update` verifies it
      # against exactly this identity (…/release-main.yml@refs/heads/main).
      # Skipped when prepare built nothing — an already-tagged HEAD is
      # release.yml's — because the action refuses an empty subject glob;
      # `hashFiles` is '' when nothing matches.
      - uses: actions/attest-build-provenance@v4
        id: attest
        if: hashFiles('release-out/ccrc-*.tar.gz') != ''
        with:
          subject-path: release-out/ccrc-*.tar.gz

      # Arm 2: copies the bundle to its release name, pushes the tag, publishes
      # all three artifacts as a prerelease, deletes the tag on failure.
      - name: Push the tag and publish the prerelease
        env:
          GH_TOKEN: ${{ github.token }}
          CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}
        run: bash deploy/release-main.sh publish --out release-out
```

- [ ] **Step 5: Write `.github/workflows/release.yml`**

```yaml
# The release pipeline's delivery layer for a HAND-CUT tag, kept THIN by
# design (stage 4 spec §2): everything a release artifact promises — the
# refusals, the layout, the MANIFEST, the checksums — is promised by
# deploy/build-release.sh, which runs and is TESTED locally
# (server/test/build-release.test.ts). This file gives the script a clean
# tagged checkout, attests what it built, and hands the output to a GitHub
# Release. The pins in build-release.test.ts hold it to that.
#
# Design 2026-09-20 §4: the attest step's identity here is
# …/release.yml@refs/tags/<tag> — `on: push: tags` makes the OIDC ref the
# tag, never main — the second of the two identities `ccrc update` accepts;
# and the release is born a PRERELEASE (decision 2): every release enters
# on `dev`, and `stable` is a promotion (deploy/release-stable.sh).
name: release

on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    # The job holds an open contents:write token for as long as it runs. 30.
    timeout-minutes: 30
    # contents: write — `gh release create`. id-token: write and
    # attestations: write — actions/attest-build-provenance's documented set
    # at the pinned ref; the OIDC token is the signing identity, no key kept.
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v4
        with:
          # Full depth: build-release.sh names the artifact by `git tag
          # --points-at HEAD` and refuses an untagged HEAD — the tag ref must
          # actually be present, not a shallow single-commit fetch.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          # The engines floor itself (>=22.13.0, node:sqlite) — read from the
          # one place it is declared (server/test/node-floor.test.ts).
          node-version-file: server/package.json
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            agent/package-lock.json
            pwa/package-lock.json

      # The script owns the build: refuses dirty/untagged (CI never passes
      # --untagged), installs and builds each package itself, assembles
      # ccrc-<tag>.tar.gz + SHA256SUMS under --out.
      - name: Build the release artifact
        run: bash deploy/build-release.sh --out release-out

      # Keyless provenance over the tarball, signed by this workflow's
      # identity at the pushed tag.
      - uses: actions/attest-build-provenance@v4
        id: attest
        with:
          subject-path: release-out/ccrc-*.tar.gz

      # The bundle rides the release under the one name every `ccrc update`
      # fetches (`<tarball>.sigstore.json`), so the publish glob carries it.
      - name: Name the provenance bundle
        env:
          CCRC_BUNDLE_PATH: ${{ steps.attest.outputs.bundle-path }}
        run: cp "$CCRC_BUNDLE_PATH" "release-out/ccrc-$GITHUB_REF_NAME.tar.gz.sigstore.json"

      # All three artifacts ride the glob. --verify-tag: the release is cut
      # only for a tag that exists on the remote. --prerelease: born on dev.
      - name: Publish the GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" release-out/* --verify-tag --prerelease
```

- [ ] **Step 6: Run the file to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts`
Expected: PASS. Also `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'workflows never name the org'` → PASS (neither file spells the org).

- [ ] **Step 7: Mutation check (spec §18 row 6)**

Remove the attest step from `release.yml` → its describe reds. Restore. Change `attestations: write` to `attestations: read` in `release-main.yml` → reds. Restore.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/release-main.yml .github/workflows/release.yml server/test/build-release.test.ts
git commit -m "feat(release): both build workflows attest the tarball (keyless, actions/attest-build-provenance@v4); release-main runs prepare → attest → publish; release.yml publishes a prerelease with the bundle"
```

### Task 4: `deploy/release-stable.sh` — promotion is two flags and a read-back, never a build

**Files:**
- Create: `deploy/release-stable.sh`
- Test: `server/test/release-stable.test.ts` (new)

**Interfaces:**
- Produces: `bash deploy/release-stable.sh` on a checkout whose HEAD carries a `vX.Y.Z` tag with a published GitHub release — exit 0 having run `gh release edit <tag> --prerelease=false` then `gh release edit <tag> --latest`, printing `promoted <tag> to stable (latest: <tag>)`; exit 0 `already stable <tag>` when the release is not a prerelease; exit 2 on an untagged HEAD; exit 1 on no release, a draft, a failed edit, or a read-back naming another tag.
- Consumed by Task 5's workflow.

- [ ] **Step 1: Write the failing tests**

```ts
// deploy/release-stable.sh — design 2026-09-20 §4, decision 3. On the stable
// branch's HEAD: the vX.Y.Z tag at HEAD names the release to promote (none →
// exit 2: a merge commit has no release, and "promote a tree nobody built"
// is unexpressible); read the release's flags; flip prerelease off; make it
// latest (two calls — drafts and prereleases cannot be set latest in one
// PATCH); read latest back. NEVER builds: a rebuild of the same tree is a
// different build.json, a different digest, bytes nobody ran.
//
// Fixture: a real one-commit repo (the `--points-at HEAD` question is git's;
// the script is COPIED into its deploy/ so `${BASH_SOURCE[0]}` resolves
// there), a stub gh that answers `release view` and `api …/releases/latest`
// from fixture files and RECORDS every argv, npm/curl poisons. Never the
// network.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-stable.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** `<home>/repo`, one commit, optionally a tag at HEAD. */
function fixture(home: string, opts: { tagHead?: string } = {}): string {
  const root = join(home, 'repo');
  mkdirSync(join(root, 'deploy'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-stable.sh'));
  chmodSync(join(root, 'deploy', 'release-stable.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'stable');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'released from main');
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  return root;
}

/** The gh stub: `release view` prints `$HOME/gh-view` (the --jq output the
 *  script asked for: "<isPrerelease>\t<isDraft>") unless `$HOME/gh-view-exit`
 *  says otherwise; `release edit` exits `$HOME/gh-edit-exit` or 0; the latest
 *  read-back prints `$HOME/gh-latest`. Every argv is recorded. */
function plantBin(home: string, opts: { view?: string; viewExit?: number; editExit?: number; latest?: string }): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(home, 'gh-view'), `${opts.view ?? 'true\tfalse'}\n`);
  if (opts.viewExit !== undefined) writeFileSync(join(home, 'gh-view-exit'), `${opts.viewExit}\n`);
  if (opts.editExit !== undefined) writeFileSync(join(home, 'gh-edit-exit'), `${opts.editExit}\n`);
  writeFileSync(join(home, 'gh-latest'), `${opts.latest ?? 'v1.2.3'}\n`);
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'case "$1 $2" in',
    '  "release view") if [ -f "$HOME/gh-view-exit" ]; then read -r c < "$HOME/gh-view-exit"; exit "$c"; fi; cat "$HOME/gh-view"; exit 0 ;;',
    '  "release edit") if [ -f "$HOME/gh-edit-exit" ]; then read -r c < "$HOME/gh-edit-exit"; exit "$c"; fi; exit 0 ;;',
    '  "api repos/{owner}/{repo}/releases/latest") cat "$HOME/gh-latest"; exit 0 ;;',
    'esac',
    'echo "fixture gh: unexpected argv: $*" >&2; exit 90',
  ].join('\n') + '\n', { mode: 0o755 });
  for (const p of ['npm', 'curl', 'node']) {
    writeFileSync(join(bin, p), `#!/bin/sh\necho "release-stable tests never build or reach the network (${p})" >&2\nexit 97\n`, { mode: 0o755 });
  }
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [],
  opts: { view?: string; viewExit?: number; editExit?: number; latest?: string } = {}): Result {
  const bin = plantBin(home, opts);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-stable.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const ghArgv = (home: string): string[] => (existsSync(join(home, 'gh-argv'))
  ? readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

describe('release-stable.sh: what it refuses', () => {
  it('an untagged HEAD is exit 2 — a merge commit has no release to promote; gh never runs (§18 row 2)', () => {
    const home = mkTmp('ccrc-relstable-untagged-');
    const root = fixture(home);
    const r = run(root, home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/stable must fast-forward to a commit released from main; a merge commit has no release to promote/);
    expect(ghArgv(home)).toEqual([]);
  });

  it('an unknown argument is exit 2', () => {
    const home = mkTmp('ccrc-relstable-usage-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(ghArgv(home)).toEqual([]);
  });

  it('no release behind the tag: exit 1, says release-main\'s trap should have prevented it, no edit', () => {
    const home = mkTmp('ccrc-relstable-norelease-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { viewExit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no GitHub release at v1\.2\.3/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });

  it('a draft release: exit 1, no edit', () => {
    const home = mkTmp('ccrc-relstable-draft-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'true\ttrue' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v1\.2\.3 is a DRAFT release/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });

  it('a failed first edit: exit 1, says the tag is still a prerelease, no --latest call', () => {
    const home = mkTmp('ccrc-relstable-editfail-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { editExit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh release edit v1\.2\.3 --prerelease=false failed — v1\.2\.3 is still a prerelease/);
    expect(ghArgv(home).filter((l) => l.includes('--latest'))).toEqual([]);
  });

  it('a read-back naming another tag: exit 1 naming both (D-3121)', () => {
    const home = mkTmp('ccrc-relstable-readback-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { latest: 'v1.2.4' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/promoted v1\.2\.3 to stable, but GitHub's latest is v1\.2\.4/);
  });
});

describe('release-stable.sh: the promotion', () => {
  it('prerelease → two edits in order (--prerelease=false, then --latest), then the read-back; exit 0 (§18 row 5)', () => {
    const home = mkTmp('ccrc-relstable-promote-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home);
    expect(r.code, r.stderr).toBe(0);
    expect(ghArgv(home)).toEqual([
      'release view v1.2.3 --json isPrerelease,isDraft --jq [.isPrerelease, .isDraft] | @tsv',
      'release edit v1.2.3 --prerelease=false',
      'release edit v1.2.3 --latest',
      'api repos/{owner}/{repo}/releases/latest --jq .tag_name',
    ]);
    expect(r.stdout.trim()).toBe('release-stable.sh: promoted v1.2.3 to stable (latest: v1.2.3)');
  });

  it('already stable → exit 0, no edit (idempotent; §18 row 3)', () => {
    const home = mkTmp('ccrc-relstable-idem-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'false\tfalse' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already stable v1\.2\.3/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });
});

describe('release-stable.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('never builds and never creates a release (§18 row 4)', () => {
    expect(src()).not.toMatch(/build-release\.sh|npm |gh release create/);
  });
  it('the two edits are two calls, not one PATCH carrying both flags', () => {
    expect(src()).toContain('gh release edit "$TAG" --prerelease=false');
    expect(src()).toContain('gh release edit "$TAG" --latest');
    expect(src()).not.toMatch(/--prerelease=false --latest|--latest --prerelease=false/);
  });
});
```

- [ ] **Step 2: Run the file to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/release-stable.test.ts`
Expected: FAIL — `copyFileSync` throws, `deploy/release-stable.sh` does not exist.

- [ ] **Step 3: Write `deploy/release-stable.sh`**

```bash
#!/usr/bin/env bash
# release-stable.sh — a push to `stable` PROMOTES the release already cut for
# the commit at its HEAD (design 2026-09-20 §4, decision 3). Two flags flip
# and one read-back; NO BUILD — a rebuild of the same tree is a different
# build.json (builtAt), a different MANIFEST, a different digest: two byte
# strings claiming one version, and the promoted one is the one nobody ran.
#
# THE TAG AT HEAD IS THE WHOLE INPUT. `stable` is fast-forward-only (its
# ruleset refuses force pushes and deletion — not merge commits: main's own
# history carries them, D-3130), so what lands here is a commit that was on
# main; a merge commit carries no release tag and is refused here (exit 2) —
# "promote a tree nobody built" is unexpressible. THIS script is that guard.
#
# TWO EDITS, NOT ONE: the REST doc says drafts and prereleases cannot be set
# as latest, and one PATCH carrying both fields would be validated against a
# state this design has not measured. `--latest` is deliberate: GitHub's
# automatic "latest" is the newest non-prerelease by the COMMIT's date, so
# an older commit promoted after a newer one would not win by itself.
# Because `--latest` can therefore point latest/download at an OLDER tag by
# a routine act, every node's floor (design §9) is keyed to the version it
# resolved, not to the presence of --to.
#
# THE READ-BACK is `gh api …/releases/latest`: `gh release view` has no
# isLatest field and neither does the REST release object — "latest" is a
# property of that endpoint's answer. `{owner}/{repo}` are gh's own
# placeholders, filled from the checkout: this file spells no org.
set -euo pipefail

HERE="${BASH_SOURCE[0]}"; [[ "$HERE" == */* ]] || HERE="./$HERE"
ROOT="$(cd "${HERE%/*}/.." && pwd)"

usage() { echo "usage: bash deploy/release-stable.sh — on the stable branch's HEAD: flip the release tagged here from prerelease to stable and make it latest; never builds"; }
die() { echo "release-stable.sh: $*" >&2; exit 1; }

if [ $# -gt 0 ]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "release-stable.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
fi

SHAPE='^v[0-9]+\.[0-9]+\.[0-9]+$'
TAG="$(git -C "$ROOT" tag --points-at HEAD | grep -E "$SHAPE" | head -n1)" || TAG=""
if [ -z "$TAG" ]; then
  echo "release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD $(git -C "$ROOT" rev-parse --short HEAD) carries no vX.Y.Z tag)" >&2
  exit 2
fi

VIEW="$(gh release view "$TAG" --json isPrerelease,isDraft --jq '[.isPrerelease, .isDraft] | @tsv')" \
  || die "no GitHub release at $TAG — release-main.sh's trap exists to prevent a release-less tag, and this one exists anyway; cut the release by hand or move stable to a released commit. Nothing was changed"
IFS=$'\t' read -r PRE DRAFT <<< "$VIEW"
[ "$DRAFT" != true ] || die "$TAG is a DRAFT release — publish it before promoting. Nothing was changed"
if [ "$PRE" = false ]; then
  echo "release-stable.sh: already stable $TAG"
  exit 0
fi
[ "$PRE" = true ] || die "unexpected answer from gh release view for $TAG: '$VIEW'. Nothing was changed"

gh release edit "$TAG" --prerelease=false \
  || die "gh release edit $TAG --prerelease=false failed — $TAG is still a prerelease"
gh release edit "$TAG" --latest \
  || die "gh release edit $TAG --latest failed — $TAG is stable, but latest/download may still serve another tag; re-run"
LATEST="$(gh api 'repos/{owner}/{repo}/releases/latest' --jq .tag_name)" \
  || die "promoted $TAG to stable, but the latest read-back failed — check: gh api repos/{owner}/{repo}/releases/latest"
[ "$LATEST" = "$TAG" ] \
  || die "promoted $TAG to stable, but GitHub's latest is $LATEST — re-run (a second --latest is idempotent), then check the release page"
echo "release-stable.sh: promoted $TAG to stable (latest: $LATEST)"
```

`chmod 755 deploy/release-stable.sh`.

- [ ] **Step 4: Run the file to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/release-stable.test.ts`
Expected: PASS, 11 cases.

- [ ] **Step 5: Mutation check (spec §18 rows 2–5)**

Remove the `--points-at` check (set `TAG=v1.2.3` unconditionally) → the untagged case reds. Remove the `isPrerelease: false` short-circuit → the idempotent case reds. Fold `--latest` into the first edit → the argv-order case and the source pin red. Restore after each.

- [ ] **Step 6: Commit**

```bash
git add deploy/release-stable.sh server/test/release-stable.test.ts
git commit -m "feat(release): release-stable.sh — a push to stable promotes the release at HEAD (two edits, a read-back, never a build)"
```

### Task 5: `.github/workflows/release-stable.yml`

**Files:**
- Create: `.github/workflows/release-stable.yml`
- Test: `server/test/build-release.test.ts` (a new describe beside the two workflow describes)

- [ ] **Step 1: Write the failing test**

```ts
describe('release-stable.yml: the thin promotion workflow (design 2026-09-20 §4)', () => {
  const WORKFLOW = join(REPO, '.github', 'workflows', 'release-stable.yml');
  const wf = (): string => readFileSync(WORKFLOW, 'utf8');

  it('triggers on stable pushes and on NOTHING else', () => {
    const src = wf();
    expect(src).toMatch(/^on:\n  push:\n    branches: \[stable\]$/m);
    for (const trigger of ['tags:', 'pull_request', 'schedule:', 'workflow_dispatch', 'workflow_call']) {
      expect(src, `release-stable.yml must not also trigger on ${trigger}`).not.toContain(trigger);
    }
  });

  it('serialises under its own group, never cancelling', () => {
    expect(wf()).toMatch(/^concurrency:\n  group: release-stable\n  cancel-in-progress: false$/m);
  });

  it('asks for contents: write and nothing else — it flips flags, it signs nothing', () => {
    const src = wf();
    expect(src).toMatch(/^    permissions:\n      contents: write$/m);
    expect(src).not.toMatch(/(id-token|attestations|packages|pull-requests|actions):/);
  });

  it('checks out at full depth and invokes release-stable.sh — no build command, no gh release create', () => {
    const src = wf();
    expect(src).toMatch(/fetch-depth: 0/);
    expect(src).toContain('run: bash deploy/release-stable.sh');
    expect(src).toContain('GH_TOKEN: ${{ github.token }}');
    expect(src).not.toMatch(/npm ci|npm run|build-release\.sh|release-main\.sh|gh release|setup-node|attest/);
    expect(src).toMatch(/timeout-minutes: 10/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts -t 'release-stable.yml'`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Write the workflow**

```yaml
# A push to `stable` promotes the release already cut for its HEAD (design
# 2026-09-20 §4, decision 3). Thin: deploy/release-stable.sh owns the tag
# lookup, the two flag flips and the read-back, and is tested locally
# (server/test/release-stable.test.ts). No build step, no node — nothing
# here can produce bytes. The branch's ruleset (no force push, no deletion;
# D-3130) keeps it fast-forward; the script refuses an untagged merge HEAD.
name: release-stable

on:
  push:
    branches: [stable]

concurrency:
  group: release-stable
  cancel-in-progress: false

jobs:
  promote:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # `gh release edit` writes the release's flags; nothing else.
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          # The script names the release by `git tag --points-at HEAD`; the
          # tag must be present, not a shallow single-commit fetch.
          fetch-depth: 0

      - name: Promote the release tagged at HEAD
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash deploy/release-stable.sh
```

- [ ] **Step 4: Run the tests**

Run: `cd server && ./node_modules/.bin/vitest run test/build-release.test.ts test/single-definition.test.ts`
Expected: PASS (the org-name scan walks every workflow file; this one spells none).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-stable.yml server/test/build-release.test.ts
git commit -m "feat(release): release-stable.yml — a stable push runs the promotion script and nothing else"
```

### Task 6: Documentation for the release rule (README, CLAUDE.md)

**Files:**
- Modify: `README.md` — the "Releases" section: "**The pipeline.**" paragraph (`:424-434` at `7d78b376`)
- Modify: `CLAUDE.md` — the "Deploy = release + rollout" bullet under "Build / test / deploy"

- [ ] **Step 1: README — replace the pipeline paragraph**

Replace the paragraph beginning `**The pipeline.**` (through `Design: \`2026-09-18-release-rollout-design.md\`.`) with:

```markdown
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
that carries the tag as `version`. Designs: `2026-09-18-release-rollout-design.md`,
`2026-09-20-centralised-update-management-design.md`.

**Channels: every release is born `dev`; `stable` is a promotion.** A release's `prerelease` flag IS
its channel — `dev` while set, `stable` once cleared — and its bytes never change. Promotion is a
fast-forward push of a released commit to the `stable` branch (`git push origin <tag>^{commit}:refs/heads/stable`
from any checkout with the tag fetched; the branch's ruleset refuses force pushes and deletion (D-3130) and
the script refuses an untagged merge HEAD), which runs `release-stable.yml` → `deploy/release-stable.sh`:
`gh release edit <tag> --prerelease=false`, then `--latest`, then a read-back of `releases/latest`.
Never a build — a rebuild would be a different `build.json`, a different digest, bytes nobody ran.
Demotion is `gh release edit <tag> --prerelease` by hand, and moves no box: a node keeps what it runs
and its floor keeps it from walking backwards.
```

- [ ] **Step 2: CLAUDE.md — extend the Deploy bullet**

In the bullet beginning `**Deploy = release + rollout**`, replace the sentence `Every merge to \`main\` becomes a GitHub Release within about a minute (\`.github/workflows/release-main.yml\` → \`deploy/release-main.sh\` → \`build-release.sh\`; patch-per-merge, a hand-pushed \`vX.Y.0\` tag for a minor rides \`release.yml\`).` with:

```markdown
Every merge to `main` becomes a GitHub **prerelease** within about a minute (`.github/workflows/release-main.yml` →
`deploy/release-main.sh prepare` → `build-release.sh` → `actions/attest-build-provenance` → `release-main.sh publish`;
patch-per-merge, a hand-pushed `vX.Y.0` tag for a minor rides `release.yml`; both attest the tarball keylessly and
publish the bundle beside it). A prerelease is the `dev` channel; **`stable` is a promotion, never a rebuild**: a
fast-forward push of a released commit to the `stable` branch runs `release-stable.yml` → `deploy/release-stable.sh`,
which flips the existing release's flag and makes it latest (design `2026-09-20-centralised-update-management-design.md`
§4). Demotion is `gh release edit <tag> --prerelease` by hand and moves no box.
```

- [ ] **Step 3: Run the prose pins**

Run: `cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts test/session-hook.test.ts test/topology-clean.test.ts`
Expected: PASS. If `session-hook.test.ts`'s README census reds, a README anchor it audits sits below the edited paragraph: repair it BY CONTENT per the memory rule (find the quoted bytes, take their new line) — never retype a number.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(release): every release is born dev; stable is a fast-forward promotion that never rebuilds"
```

### Task 7: PR 1 gate, merge, and the four operator acts that make the exit criterion measurable

**Files:** none new. This task is measurement and the acts that only the operator can take on the public repo.

- [ ] **Step 1: The gate, in the foreground, one file at a time**

```bash
cd server
git fetch origin main
for t in release-main release-stable build-release single-definition deviation-refs topology-clean oss-metadata pools-prose session-hook; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: every file green. `deviation-refs` compares this plan's D-numbers against `origin/main` without merging.

- [ ] **Step 2: Push and open the PR**

`git push` (the branch tracks `origin/ws/ccrc-auto-update-mechanism`); `gh pr create --title "release: prereleases with keyless provenance; stable is a promotion (W1 part A)" --body-file <a body naming the spec, this plan, and the deviations D-… landed here>`. The body ends with the attribution line from the session's system reminder. The PR body links the spec by its `blob/main` URL, never the docserver.

- [ ] **Step 3: Merge (operator) and watch the first attested prerelease**

The operator merges (`--admin`, per `ccrc-pwa-merge-needs-admin-bypass`). Then:

```bash
gh run list -b main -w release-main --limit 1
gh run watch "$(gh run list -b main -w release-main --limit 1 --json databaseId --jq '.[0].databaseId')"
TAG="$(gh release list --limit 1 --json tagName --jq '.[0].tagName')"; echo "$TAG"
gh release view "$TAG" --json isPrerelease,assets --jq '.isPrerelease, (.assets[] | [.name, .size] | @tsv)'
```
Expected: `true`, and three assets — `ccrc-<tag>.tar.gz`, `SHA256SUMS`, `ccrc-<tag>.tar.gz.sigstore.json`. Record the tag as `MAIN_TAG` — Task 8's `release-main` fixture comes from it. If the run is red, read its log before anything else: an attest-step failure leaves origin untouched (no tag), and a re-run is `gh run rerun`.

- [ ] **Step 4: Create `stable` and its ruleset (operator; admin on the repo)**

The branch must be created at a commit whose tree CONTAINS `release-stable.yml` — the merge commit of PR 1 is the first such commit, and it is also the commit `MAIN_TAG` released, so this first push is also the first promotion. The ruleset carries no `required_linear_history` (D-3130):

```bash
git fetch origin --tags
gh api -X POST 'repos/{owner}/{repo}/rulesets' --input - <<'JSON'
{"name":"stable: no force push, no deletion","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/heads/stable"],"exclude":[]}},
 "rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}
JSON
git push origin "$MAIN_TAG^{commit}:refs/heads/stable"
gh run watch "$(gh run list -b stable -w release-stable --limit 1 --json databaseId --jq '.[0].databaseId')"
gh release view "$MAIN_TAG" --json isPrerelease --jq .isPrerelease
gh api 'repos/{owner}/{repo}/releases/latest' --jq .tag_name
```
Expected: `false`, then `MAIN_TAG`. That is spec §15's W1 exit criterion for the release side: "a release on `main` is a prerelease with a bundle asset; `stable` exists and one promotion has run and `isLatest` read back true".

- [ ] **Step 5: The hand-cut minor — the operator's decision**

Task 8 needs one bundle signed by `release.yml`'s identity. The only way to get one is a tag push `release.yml` builds, and the tag must sit on a commit `release-main.yml` did NOT auto-tag (two release tags on one commit make `build-release.sh` name the artifact by the lower one — `git tag --points-at HEAD | head -n1` — and the release would ship a tarball whose name is not its tag; Task 9's binding would refuse it, correctly). The act that avoids the race is an ATOMIC push of `main` and the tag from a local merge, so `release-main.yml`'s `prepare` sees the tag already at HEAD:

```bash
git fetch origin && git checkout -B main origin/main
git merge --no-ff --no-edit <the next PR's branch>      # or an empty commit: git commit --allow-empty -m "release: v0.1.0"
git tag v0.1.0
git push --atomic origin main v0.1.0
gh run watch "$(gh run list -w release -e push --limit 1 --json databaseId --jq '.[0].databaseId')"
gh release view v0.1.0 --json isPrerelease,assets --jq '.isPrerelease, (.assets[] | .name)'
```
Expected: a prerelease `v0.1.0` with three assets, and `release-main`'s run for that push says "already tagged v0.1.0; release.yml owns it". This is a product decision (the version line goes to 0.1) and a direct push to `main`; it is the operator's, not the worker's. If they decline, Task 8's `release.yml` case is written against a bundle obtained later and the plan records it as the no-tag-fixture deviation — a number minted from the allocator at that moment and defined under Deviations found, never a placeholder token — with the case marked pending; never `it.skip` (a skipped case is not a pin).

---

## Part B — node side (PR 2)

Same branch, after Part A merged; rebase onto `origin/main` first. Every task here changes `ccd/ccrc` or `install.sh` and is measured through `ccrc-update.test.ts`, `ccrc-install.test.ts`, `ccrc-uninstall.test.ts` and `install-sh.test.ts` — fixture HOMEs only.

### Task 8: `deploy/verify-provenance.mjs` — the verifier, both backends, real bundles as fixtures

**Files:**
- Create: `deploy/verify-provenance.mjs`
- Create: `server/test/fixtures/provenance/release-main.sigstore.json`, `release-main.meta.json`, `release-tag.sigstore.json`, `release-tag.meta.json`, `third-workflow.sigstore.jsonl`, `third-workflow.meta.json`
- Modify: `server/package.json`, `server/package-lock.json` (three production dependencies)
- Test: `server/test/verify-provenance.test.ts` (new)

**Interfaces:**
- Produces: `node deploy/verify-provenance.mjs --bundle <file> (--blob <file> | --blob-sha256 <hex>) --tag vX.Y.Z --owner <o> --repo <r> [--backend sigstore|gh] [--trusted-root <file>]` — exit 0 with one stdout line `verified ccrc-<tag>.tar.gz sha256:<hex> as <identity URI> (<backend>)`; exit 1 with one stderr line `verify-provenance: <why>`; exit 2 on usage. Env `CCRC_SIGSTORE_TRUSTED_ROOT` overrides the vendored root.
- Consumes: Task 1's `deploy/sigstore-trusted-root.jsonl` and its measured default backend and import names.
- Consumed by Task 12 (`_upd_fetch`), which always passes `--blob`.

- [ ] **Step 1: Add the dependencies**

```bash
cd server && npm install --save --no-audit --no-fund @sigstore/verify@^4.1.2 @sigstore/bundle@^5.0.0 @sigstore/protobuf-specs@^0.5.2
git diff --stat package.json package-lock.json
./node_modules/.bin/vitest run test/oss-metadata.test.ts test/node-floor.test.ts
```
Expected: three lines added under `dependencies`; both files green. (These are the newest versions on 2026-09-20; if `npm view @sigstore/verify version` says a newer major exists, take the newest and re-run the spike's Step 4 against it before continuing.)

- [ ] **Step 2: Take the fixtures from the real releases**

`MAIN_TAG` is Task 7 Step 3's tag; `TAG_TAG` is `v0.1.0` from Step 5 (or absent — then the `release-tag` files are not created and the two cases that need them are written but their `it` calls wrapped in a `describe` guarded by `existsSync(RELEASE_TAG_META)`, with the guard's ABSENCE recorded as the pending no-tag-fixture deviation under its minted number; never `it.skip`).

```bash
F=server/test/fixtures/provenance; mkdir -p "$F"
gh release download "$MAIN_TAG" -p '*.sigstore.json' -O "$F/release-main.sigstore.json"
gh release download "$MAIN_TAG" -p SHA256SUMS -O "$F/.sums" && SHA="$(awk '{print $1}' "$F/.sums")" && rm "$F/.sums"
printf '{"tag":"%s","sha256":"%s"}\n' "$MAIN_TAG" "$SHA" > "$F/release-main.meta.json"
gh release download "$TAG_TAG" -p '*.sigstore.json' -O "$F/release-tag.sigstore.json"
gh release download "$TAG_TAG" -p SHA256SUMS -O "$F/.sums" && SHA="$(awk '{print $1}' "$F/.sums")" && rm "$F/.sums"
printf '{"tag":"%s","sha256":"%s"}\n' "$TAG_TAG" "$SHA" > "$F/release-tag.meta.json"
# The third-workflow bundle is the spike's (Task 1 Step 3): another repo's workflow identity.
S="$SCRATCHPAD/spike"; cp "$S"/sha256:*.jsonl "$F/third-workflow.sigstore.jsonl"
printf '{"owner":"cli","repo":"cli","sha256":"%s","identity":"%s"}\n' "$(sha256sum "$S"/gh_*_linux_amd64.tar.gz | awk '{print $1}')" "$(cat "$S/san.txt")" > "$F/third-workflow.meta.json"
ls -la "$F"; git add "$F" && (cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
```
Expected: topology-clean green over the staged fixtures; each bundle is a few KB.

- [ ] **Step 3: Write the failing tests**

```ts
// deploy/verify-provenance.mjs — design 2026-09-20 §5. Is this tarball the one
// the release workflow built for this tag? Four checks on either backend:
// signature against the vendored trusted root, subject NAME, OIDC issuer,
// and a SAN in a set of EXACTLY TWO workflow URIs. Fixtures are REAL bundles
// from real releases (release-main.yml's identity at refs/heads/main,
// release.yml's at refs/tags/<tag>) and one from ANOTHER repo's workflow —
// plus the tarballs' DIGESTS, never the 3 MB tarballs (D-3116).
// The sigstore backend runs for real, offline (Task 1 measured it); the gh
// backend runs under a stub that records argv and models gh's identity
// check as an allowlist.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const VERIFIER = join(REPO, 'deploy', 'verify-provenance.mjs');
const FIX = join(here, 'fixtures', 'provenance');

/** The release identity, read from ccd/ccrc's pair — the same pick the
 *  ccrc-update source pin makes; this file spells no org. */
function pick(name: string): string {
  const m = new RegExp(`^${name}="([^"]+)"$`, 'm').exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc does not spell ${name}`);
  return m[1]!;
}
const OWNER = pick('CCRC_RELEASE_OWNER');
const REPO_NAME = pick('CCRC_RELEASE_REPO');
const ISSUER = 'https://token.actions.githubusercontent.com';
const mainMeta = JSON.parse(readFileSync(join(FIX, 'release-main.meta.json'), 'utf8')) as { tag: string; sha256: string };
const thirdMeta = JSON.parse(readFileSync(join(FIX, 'third-workflow.meta.json'), 'utf8')) as { owner: string; repo: string; sha256: string; identity: string };
const RELEASE_TAG_META = join(FIX, 'release-tag.meta.json');

interface Result { code: number; stdout: string; stderr: string }
function verify(args: string[], env: NodeJS.ProcessEnv = {}, pathPrefix = ''): Result {
  const r = spawnSync('node', [VERIFIER, ...args], {
    env: { ...process.env, ...env, PATH: pathPrefix === '' ? process.env.PATH : `${pathPrefix}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const mainArgs = (over: Record<string, string> = {}): string[] => {
  const o = { bundle: join(FIX, 'release-main.sigstore.json'), digest: mainMeta.sha256, tag: mainMeta.tag, owner: OWNER, repo: REPO_NAME, ...over };
  return ['--bundle', o.bundle, '--blob-sha256', o.digest, '--tag', o.tag, '--owner', o.owner, '--repo', o.repo];
};
const flip = (hex: string): string => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

describe('verify-provenance.mjs: the sigstore backend, offline, against real bundles', () => {
  it('release-main.yml\'s bundle verifies under the main identity', () => {
    const r = verify(mainArgs());
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`verified ccrc-${mainMeta.tag}.tar.gz sha256:${mainMeta.sha256} as https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release-main.yml@refs/heads/main (sigstore)`);
  });

  it('offered for a DIFFERENT tag it refuses on the subject name (§5 refusal 3; §18 "the verifier asserts the subject name")', () => {
    const r = verify(mainArgs({ tag: 'v9.9.9' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/subject is ccrc-v[0-9.]+\.tar\.gz, not ccrc-v9\.9\.9\.tar\.gz — a tarball attested under another tag/);
  });

  it('a different --owner refuses — the identity set is built from owner/repo', () => {
    const r = verify(mainArgs({ owner: 'someone-else' }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no bundle verified against the trusted root for either release workflow of someone-else\//);
  });

  it('one flipped digit in the blob\'s digest refuses — the bytes are bound', () => {
    const r = verify(mainArgs({ digest: flip(mainMeta.sha256) }));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/but the blob's is [0-9a-f]{64} — not the bytes the workflow built/);
  });

  it('--blob with a file that is not the tarball refuses the same way', () => {
    const home = mkTmp('ccrc-verify-blob-');
    writeFileSync(join(home, 'blob'), 'not the tarball\n');
    const r = verify(['--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', join(home, 'blob'), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not the bytes the workflow built/);
  });

  it('a bundle whose SAN names a third workflow refuses — the set is exactly two URIs, never owner/repo alone (§18)', () => {
    // cli/cli's own release bundle, with cli/cli as owner/repo: the identity
    // set becomes cli/cli/…/release-main.yml@main and …/release.yml@tag, and
    // the bundle's SAN (deployment workflow) matches neither.
    const r = verify(['--bundle', join(FIX, 'third-workflow.sigstore.jsonl'), '--blob-sha256', thirdMeta.sha256, '--tag', 'v9.9.9', '--owner', thirdMeta.owner, '--repo', thirdMeta.repo]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no bundle verified against the trusted root for either release workflow of cli\/cli/);
    expect(thirdMeta.identity).not.toMatch(/release-main\.yml|\/release\.yml/);
  });

  it('a wrong trusted root refuses; CCRC_SIGSTORE_TRUSTED_ROOT is the override (D-3119)', () => {
    const home = mkTmp('ccrc-verify-root-');
    writeFileSync(join(home, 'empty.jsonl'), '\n');
    const r = verify(mainArgs(), { CCRC_SIGSTORE_TRUSTED_ROOT: join(home, 'empty.jsonl') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/holds no trusted root/);
    const ok = verify(mainArgs(), { CCRC_SIGSTORE_TRUSTED_ROOT: join(REPO, 'deploy', 'sigstore-trusted-root.jsonl') });
    expect(ok.code, ok.stderr).toBe(0);
  });
});

describe('verify-provenance.mjs: release.yml\'s identity (the hand-cut tag)', () => {
  const present = existsSync(RELEASE_TAG_META);
  const tagMeta = present ? JSON.parse(readFileSync(RELEASE_TAG_META, 'utf8')) as { tag: string; sha256: string } : null;
  it('the fixture from a release.yml-cut release is present (Task 7 Step 5)', () => {
    expect(present, 'server/test/fixtures/provenance/release-tag.* missing — see the W1 plan, Deviations found: no-tag-fixture').toBe(true);
  });
  it('verifies under …/release.yml@refs/tags/<tag>, and under no other tag', () => {
    if (tagMeta === null) return;
    const args = ['--bundle', join(FIX, 'release-tag.sigstore.json'), '--blob-sha256', tagMeta.sha256, '--tag', tagMeta.tag, '--owner', OWNER, '--repo', REPO_NAME];
    const r = verify(args);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`as https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release.yml@refs/tags/${tagMeta.tag} (sigstore)`);
    // The tag is inside the identity URI: another tag is another identity.
    const other = verify(['--bundle', join(FIX, 'release-tag.sigstore.json'), '--blob-sha256', tagMeta.sha256, '--tag', 'v9.9.9', '--owner', OWNER, '--repo', REPO_NAME]);
    expect(other.code).toBe(1);
  });
});

describe('verify-provenance.mjs: the gh backend under a recording stub', () => {
  /** Models gh's identity check: exit 0 only when --cert-identity is one of
   *  the two ccrc URIs for the tag (the fixture's allowlist), records argv. */
  function plantGh(home: string, allow: string[], exit = 0): string {
    const bin = join(home, 'bin'); mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, 'gh-allow'), `${allow.join('\n')}\n`);
    writeFileSync(join(bin, 'gh'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
      'id=""; while [ $# -gt 0 ]; do case "$1" in --cert-identity) id="$2"; shift 2 ;; *) shift ;; esac; done',
      `[ ${exit} -eq 0 ] || exit ${exit}`,
      'grep -qxF -- "$id" "$HOME/gh-allow" && exit 0',
      'echo "fixture gh: identity not in the allowlist: $id" >&2; exit 1',
    ].join('\n') + '\n', { mode: 0o755 });
    return bin;
  }
  const ids = (tag: string): string[] => [
    `https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release-main.yml@refs/heads/main`,
    `https://github.com/${OWNER}/${REPO_NAME}/.github/workflows/release.yml@refs/tags/${tag}`,
  ];
  function blobFile(home: string): string { const p = join(home, 'blob'); writeFileSync(p, 'gh hashes this itself\n'); return p; }

  it('the argv carries --cert-identity, --cert-oidc-issuer, --custom-trusted-root, --deny-self-hosted-runners, --bundle and --repo; the first identity tried is release-main\'s', () => {
    const home = mkTmp('ccrc-verify-gh-');
    const bin = plantGh(home, ids(mainMeta.tag));
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv).toEqual([
      `attestation verify ${join(home, 'blob')} --bundle ${join(FIX, 'release-main.sigstore.json')} --repo ${OWNER}/${REPO_NAME} --cert-identity ${ids(mainMeta.tag)[0]} --cert-oidc-issuer ${ISSUER} --custom-trusted-root ${join(REPO, 'deploy', 'sigstore-trusted-root.jsonl')} --deny-self-hosted-runners`,
    ]);
    expect(r.stdout).toContain('(gh)');
  });

  it('the second identity is tried when the first is refused; a third workflow is never sent (§18, both backends)', () => {
    const home = mkTmp('ccrc-verify-gh2-');
    const bin = plantGh(home, [ids(mainMeta.tag)[1]!]);
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv.length).toBe(2);
    expect(argv.map((l) => / --cert-identity (\S+) /.exec(l)![1])).toEqual(ids(mainMeta.tag));
    // cli/cli's bundle: neither of OUR two URIs is its SAN, so nothing gh
    // could accept is ever on the argv — the stub's allowlist is the two.
    const third = verify(['--backend', 'gh', '--bundle', join(FIX, 'third-workflow.sigstore.jsonl'), '--blob', blobFile(home), '--tag', 'v9.9.9', '--owner', thirdMeta.owner, '--repo', thirdMeta.repo], { HOME: home }, bin);
    expect(third.code).toBe(1);
  });

  it('gh refusing both identities refuses; the subject NAME is still checked here (D-3123)', () => {
    const home = mkTmp('ccrc-verify-gh3-');
    const bin = plantGh(home, ids(mainMeta.tag), 1);
    const r = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home), '--tag', mainMeta.tag, '--owner', OWNER, '--repo', REPO_NAME], { HOME: home }, bin);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh attestation verify refused for either release workflow/);
    const home2 = mkTmp('ccrc-verify-gh4-');
    const bin2 = plantGh(home2, ids('v9.9.9'));
    const wrongTag = verify(['--backend', 'gh', '--bundle', join(FIX, 'release-main.sigstore.json'), '--blob', blobFile(home2), '--tag', 'v9.9.9', '--owner', OWNER, '--repo', REPO_NAME], { HOME: home2 }, bin2);
    expect(wrongTag.code).toBe(1);
    expect(wrongTag.stderr).toMatch(/not ccrc-v9\.9\.9\.tar\.gz/);
  });

  it('the gh backend needs the file: --blob-sha256 is a usage error there', () => {
    const r = verify(['--backend', 'gh', ...mainArgs()]);
    expect(r.code).toBe(2);
  });
});

describe('verify-provenance.mjs: usage', () => {
  it('missing arguments, a malformed tag, a malformed digest, both blob forms, an unknown backend — all exit 2 with usage on stderr', () => {
    expect(verify([]).code).toBe(2);
    expect(verify(mainArgs({ tag: '0.0.9' })).code).toBe(2);
    expect(verify(mainArgs({ digest: 'abc' })).code).toBe(2);
    expect(verify([...mainArgs(), '--blob', VERIFIER]).code).toBe(2);
    expect(verify([...mainArgs(), '--backend', 'cosign']).code).toBe(2);
    expect(verify(['-h']).stderr).toMatch(/^usage: node verify-provenance\.mjs/);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/verify-provenance.test.ts`
Expected: FAIL — `Cannot find module …/deploy/verify-provenance.mjs` from every spawn.

- [ ] **Step 5: Write `deploy/verify-provenance.mjs`**

If Task 1's spike record says the default backend is `gh`, set `DEFAULT_BACKEND = 'gh'`; if it recorded different export names for `@sigstore/verify`, use those.

```js
// verify-provenance.mjs — is this tarball the one a release workflow of
// THIS repo built for THIS tag? (design 2026-09-20 §5)
//
// Four checks, on either backend: the bundle's signature over the blob's
// digest against the Sigstore public-good trust root; the in-toto subject's
// NAME against `ccrc-<tag>.tar.gz` (a genuinely attested tarball served
// under another tag's asset path refuses here — §5 refusal 3); the
// certificate's OIDC issuer; and its SAN against EXACTLY TWO workflow URIs
// built from owner/repo/tag. Nothing wider: an identity of `<owner>/<repo>`
// alone would accept an attestation minted by any workflow on any branch.
//
// RUN FROM THE INSTALLED TREE (decision 12): `ccrc update` resolves this
// file beside its own ccrc (`$CCRC_HERE/../deploy/`), never out of the
// tarball it is verifying. Its dependencies are the server package's
// production dependencies, resolved through `../server/node_modules` — placed
// by the same `npm ci --omit=dev` that installs the server on every role — so
// a verifier that shipped is a verifier that runs.
//
// TWO BACKENDS (the spike, plan Task 1, chose the default):
//   sigstore — @sigstore/verify against the VENDORED trusted root beside this
//              file; CCRC_SIGSTORE_TRUSTED_ROOT overrides it (a by-hand
//              refresh for a root that has gone stale). No network.
//   gh       — `gh attestation verify` (gh >= 2.49) with the same constraints
//              spelled on its argv. gh hashes the file itself, so this arm
//              takes --blob only and checks the subject NAME here.
//
// --blob-sha256 exists for callers that already hold the digest (the test
// fixtures are bundles + digests, not 3 MB tarballs); `ccrc update` always
// passes --blob.
//
// exit 0 verified (one stdout line naming the identity); 1 refused (one
// stderr line saying why); 2 usage.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ISSUER = 'https://token.actions.githubusercontent.com';
const DEFAULT_ROOT = path.join(HERE, 'sigstore-trusted-root.jsonl');
const DEFAULT_BACKEND = 'sigstore';
const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

function usage(code) {
  process.stderr.write('usage: node verify-provenance.mjs --bundle <file> (--blob <file> | --blob-sha256 <hex>) --tag vX.Y.Z --owner <owner> --repo <repo> [--backend sigstore|gh] [--trusted-root <file>]\n');
  process.exit(code);
}
function refuse(why) {
  process.stderr.write(`verify-provenance: ${why}\n`);
  process.exit(1);
}

const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const take = () => { if (i + 1 >= argv.length) usage(2); i += 1; return argv[i]; };
  switch (a) {
    case '--bundle': opt.bundle = take(); break;
    case '--blob': opt.blob = take(); break;
    case '--blob-sha256': opt.digest = take(); break;
    case '--tag': opt.tag = take(); break;
    case '--owner': opt.owner = take(); break;
    case '--repo': opt.repo = take(); break;
    case '--backend': opt.backend = take(); break;
    case '--trusted-root': opt.root = take(); break;
    case '-h': case '--help': usage(0); break;
    default: usage(2);
  }
}
if (!opt.bundle || !opt.tag || !opt.owner || !opt.repo) usage(2);
if ((opt.blob ? 1 : 0) + (opt.digest ? 1 : 0) !== 1) usage(2);
if (!TAG.test(opt.tag)) usage(2);
if (opt.digest !== undefined && !/^[0-9a-f]{64}$/.test(opt.digest)) usage(2);
if (!NAME.test(opt.owner) || !NAME.test(opt.repo)) usage(2);
const backend = opt.backend ?? DEFAULT_BACKEND;
if (backend !== 'sigstore' && backend !== 'gh') usage(2);
if (backend === 'gh' && !opt.blob) usage(2);

const rootPath = opt.root ?? process.env.CCRC_SIGSTORE_TRUSTED_ROOT ?? DEFAULT_ROOT;
const expectSubject = `ccrc-${opt.tag}.tar.gz`;
// EXACTLY these two. release-main.yml signs at refs/heads/main on every
// auto-patch; release.yml signs at the tag it was pushed with.
const identities = [
  `https://github.com/${opt.owner}/${opt.repo}/.github/workflows/release-main.yml@refs/heads/main`,
  `https://github.com/${opt.owner}/${opt.repo}/.github/workflows/release.yml@refs/tags/${opt.tag}`,
];

/** One JSON object (a release asset) or JSON lines (what `gh attestation
 *  download` writes). Every bundle in the file is tried. */
function readBundles(file) {
  const text = readFileSync(file, 'utf8');
  try { return [JSON.parse(text)]; } catch { /* JSONL */ }
  const out = text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  if (out.length === 0) refuse(`${file} holds no bundle`);
  return out;
}
/** The in-toto statement inside a DSSE bundle — read from the raw JSON, so
 *  the check does not depend on either backend's object model. */
function statementOf(json) {
  const env = json.dsseEnvelope;
  if (!env || typeof env.payload !== 'string') return null;
  if (env.payloadType !== 'application/vnd.in-toto+json') return null;
  let st;
  try { st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')); } catch { return null; }
  return Array.isArray(st.subject) ? st : null;
}
/** The subject NAME, and — when the caller computed it — the digest. */
function subjectCheck(st, digest) {
  if (st === null) refuse('the bundle carries no in-toto statement — not an attestation');
  const named = st.subject.filter((s) => s && s.name === expectSubject);
  if (named.length === 0) {
    refuse(`the attestation's subject is ${st.subject.map((s) => s?.name ?? '?').join(', ')}, not ${expectSubject} — a tarball attested under another tag`);
  }
  if (digest !== null && !named.some((s) => s.digest && s.digest.sha256 === digest)) {
    refuse(`the attestation names ${expectSubject} with sha256 ${named[0].digest?.sha256 ?? '?'}, but the blob's is ${digest} — not the bytes the workflow built`);
  }
}

const bundles = readBundles(opt.bundle);
const digest = opt.digest ?? createHash('sha256').update(readFileSync(opt.blob)).digest('hex');

if (backend === 'sigstore') {
  const req = createRequire(path.join(HERE, '..', 'server', 'package.json'));
  const { Verifier, toSignedEntity, toTrustMaterial } = req('@sigstore/verify');
  const { bundleFromJSON } = req('@sigstore/bundle');
  const { TrustedRoot } = req('@sigstore/protobuf-specs');
  const roots = readFileSync(rootPath, 'utf8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => TrustedRoot.fromJSON(JSON.parse(l)));
  if (roots.length === 0) refuse(`${rootPath} holds no trusted root`);
  let verified = null;
  let last = null;
  for (const json of bundles) {
    let entity;
    try { entity = toSignedEntity(bundleFromJSON(json)); } catch (e) { last = e; continue; }
    for (const root of roots) {
      const v = new Verifier(toTrustMaterial(root), { ctlogThreshold: 1, tlogThreshold: 1, tsaThreshold: 0 });
      for (const san of identities) {
        try {
          v.verify(entity, { subjectAlternativeName: san, extensions: { issuer: ISSUER } });
          verified = { json, san };
          break;
        } catch (e) { last = e; }
      }
      if (verified) break;
    }
    if (verified) break;
  }
  if (!verified) {
    refuse(`no bundle verified against the trusted root for either release workflow of ${opt.owner}/${opt.repo} (last reason: ${last?.message ?? 'none'})`);
  }
  subjectCheck(statementOf(verified.json), digest);
  process.stdout.write(`verified ${expectSubject} sha256:${digest} as ${verified.san} (sigstore)\n`);
  process.exit(0);
}

// gh backend: one call per identity, the same constraints on the argv. gh
// compares the blob's digest against the statement itself; the NAME is ours.
let accepted = null;
let lastErr = '';
for (const san of identities) {
  const r = spawnSync('gh', ['attestation', 'verify', opt.blob, '--bundle', opt.bundle, '--repo', `${opt.owner}/${opt.repo}`,
    '--cert-identity', san, '--cert-oidc-issuer', ISSUER, '--custom-trusted-root', rootPath, '--deny-self-hosted-runners'],
  { encoding: 'utf8' });
  if (r.error) refuse(`gh could not be run (${r.error.message}) — the gh backend needs gh >= 2.49 on PATH`);
  if (r.status === 0) { accepted = san; break; }
  lastErr = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop() ?? '';
}
if (accepted === null) {
  refuse(`gh attestation verify refused for either release workflow of ${opt.owner}/${opt.repo} (last: ${lastErr})`);
}
const statements = bundles.map(statementOf).filter((s) => s !== null);
if (statements.length === 0) refuse('the bundle carries no in-toto statement — not an attestation');
if (!statements.some((st) => st.subject.some((s) => s && s.name === expectSubject))) {
  subjectCheck(statements[0], null);
}
process.stdout.write(`verified ${expectSubject} sha256:${digest} as ${accepted} (gh)\n`);
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/verify-provenance.test.ts`
Expected: PASS, 16 cases (15 if the release-tag fixture is absent — then exactly one red, the presence case, and the no-tag-fixture deviation is minted and written into this plan's Deviations found before the PR opens). If the sigstore cases refuse with a threshold or trust-material message, compare against the spike's Step 4 output: the code above is the spike's code with the identity loop; a difference between them is the bug.

- [ ] **Step 7: Mutation check (§18 rows 10 and 11)**

Drop the `named.length === 0` refusal → the "different tag" case reds. Widen `identities` to a single `https://github.com/${opt.owner}/${opt.repo}/` prefix match (replace `subjectAlternativeName: san` with `subjectAlternativeName: undefined`) → the third-workflow case reds on the sigstore backend; remove `'--cert-identity', san,` from the gh argv → the gh argv case reds. Restore each.

- [ ] **Step 8: Commit**

```bash
git add deploy/verify-provenance.mjs server/package.json server/package-lock.json server/test/verify-provenance.test.ts server/test/fixtures/provenance
git commit -m "feat(provenance): verify-provenance.mjs — a tarball is the one the release workflow built for its tag, on either backend, offline; real bundles as fixtures"
```

### Task 9: `ccrc update` binds the tag twice — SHA256SUMS to `--to`, and the extracted `build.json` to the resolved version

**Files:**
- Modify: `ccd/ccrc` — `_upd_resolve` (`:11245-11267` at `7d78b376`), `_upd_fetch` (`:11269-11291`)
- Test: `server/test/ccrc-update.test.ts` — the fixture (`packRelease` `:456-486`, `stubTree` `:442-454`, `updateEnv` `:135-260`) and a new describe

**Interfaces:**
- Produces: in `_upd_resolve`, a refusal when `--to` was given and `UPD_VERSION != "$to"` (tag to tag); in `_upd_fetch`, a refusal after the MANIFEST check when the extracted tree's `build.json` `version` is not `UPD_VERSION`.
- Produces (fixture): `packRelease(home, tree, { …, asName?: string, bundle?: boolean })` — `asName` names the tarball differently from the URL directory's tag; `bundle` (default `true`) writes `ccrc-<tag>.tar.gz.sigstore.json` beside it. `stubTree`'s stub records `CCRC_UPDATE_VERIFIED` to `$HOME/staged-ccrc-env`. `updateEnv` plants a `node` shim that answers `verify-provenance.mjs` from `$HOME/fixture-verify-exit` (default 0), records its argv to `$HOME/verify-argv`, and execs the real node for everything else. Tasks 11 and 12 build on these.

- [ ] **Step 1: Fixture groundwork**

In `packRelease`, extend the options and the body:

```ts
function packRelease(home: string, tree: string,
  opts: { tag: string; latest?: boolean; tamper?: boolean; corruptInner?: string; asName?: string; bundle?: boolean } = { tag: 'v9.9.9' }): void {
  if (opts.corruptInner !== undefined) {
    appendFileSync(join(tree, opts.corruptInner), '\n// corrupted after the MANIFEST was written\n');
  }
  const relDir = opts.latest === false
    ? join(home, 'releases', 'download', opts.tag)
    : join(home, 'releases', 'latest', 'download');
  mkdirSync(relDir, { recursive: true });
  // `asName` lets SHA256SUMS under one tag's directory name ANOTHER tag's
  // tarball — the re-served-release shape Task 9's binding refuses.
  const name = opts.asName ?? `ccrc-${opts.tag}.tar.gz`;
  const tarRes = spawnSync('tar', ['-czf', join(relDir, name), '-C', tree, '.'], { encoding: 'utf8' });
  if (tarRes.status !== 0) throw new Error(`fixture tar failed: ${tarRes.stderr}`);
  const sumRes = spawnSync('bash', ['-c',
    'sha=sha256sum; [ "$(uname -s)" = Darwin ] && sha="shasum -a 256";'
    + ` $sha '${name}' > SHA256SUMS`],
  { cwd: relDir, encoding: 'utf8' });
  if (sumRes.status !== 0) throw new Error(`fixture digest failed: ${sumRes.stderr}`);
  if (opts.tamper) appendFileSync(join(relDir, name), 'one appended byte-run after the sums were written');
  // The provenance bundle (design §5): present by default — the `node` shim
  // in updateEnv decides whether it "verifies"; `bundle: false` models a
  // release older than provenance, the one shape --allow-unsigned admits.
  if (opts.bundle !== false) writeFileSync(join(relDir, `${name}.sigstore.json`), `{"fixture":"bundle for ${name}"}\n`);
}
```

In `stubTree`, make the stub record the environment fact Task 12 asserts:

```ts
  writeFileSync(join(tree, 'ccd', 'ccrc'),
    '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$HOME/staged-ccrc-argv"\n'
    + 'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/staged-ccrc-env"\n'
    + `exit ${opts.installExit ?? 0}\n`, { mode: 0o755 });
```

In `updateEnv`, after the `python3` stub, plant the `node` shim (the real node is needed by `backup-coord.mjs` and the staged spine):

```ts
  // The verifier seam (design §5): `ccrc update` runs the INSTALLED tree's
  // `deploy/verify-provenance.mjs` under `node`. This shim answers THAT
  // invocation from a fixture file (exit code; argv recorded) and execs the
  // real node for everything else, so the path the verb resolved is a
  // MEASURED fact — `$CCRC_HERE/../deploy/…` of the ccrc under test, never
  // the staged tree — and the real verifier (verify-provenance.test.ts's
  // subject) is not re-run here.
  plant('node', [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  *verify-provenance.mjs*)',
    '    printf \'%s\\n\' "$*" >> "$HOME/verify-argv"',
    '    code=0; [ -f "$HOME/fixture-verify-exit" ] && IFS= read -r code < "$HOME/fixture-verify-exit"',
    '    [ "$code" = 0 ] && echo "verified fixture (sigstore)" || echo "verify-provenance: fixture refusal" >&2',
    '    exit "$code" ;;',
    'esac',
    `exec ${REAL_NODE} "$@"`,
  ].join('\n') + '\n');
```
with `const REAL_NODE = realPath('node');` beside `RSYNC` at the top of the file.

In `healthyBox`'s combined curl stub, inside the `local://*)` arm and BEFORE its `[ ! -f "$src" ]` check, add a fixture-driven failure for bundle URLs — the stub answers 404 for anything that is not a regular file, so a "download failed for another reason" can only be modelled by an explicit exit code:

```ts
    '    case "$url" in *.sigstore.json)',
    '      if [ -f "$HOME/fixture-curl-exit" ]; then IFS= read -r c < "$HOME/fixture-curl-exit"; echo "curl: ($c) fixture failure for $url" >&2; exit "$c"; fi ;;',
    '    esac',
```

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts`
Expected: still green (the shim execs the real node; the extra bundle file is ignored by today's code; no test writes `fixture-curl-exit` yet).

- [ ] **Step 2: Write the failing tests**

```ts
describe('ccrc update: the tag is bound (design §5, decision 4)', () => {
  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.3.tar.gz refuses BEFORE any backup, tag to tag (§18 "the tag is bound before backup")', () => {
    const home = freshUpdateBox('ccrc-update-bind-sums-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.3' }), { tag: 'v0.0.9', latest: false, asName: 'ccrc-v0.0.3.tar.gz' });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release at v0\.0\.9 names a ccrc-v0\.0\.3\.tar\.gz \(version v0\.0\.3, not v0\.0\.9\) — refusing/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v0.0.9/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.9.tar.gz proceeds — the comparison never strips a side', () => {
    const home = freshUpdateBox('ccrc-update-bind-ok-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.9' }), { tag: 'v0.0.9', latest: false });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });

  it('an extracted build.json whose version is not the resolved one refuses; nothing installed (§18 "the extracted version is bound")', () => {
    const home = freshUpdateBox('ccrc-update-bind-stamp-');
    plantOldBox(home, { version: 'v0.0.1' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.1' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the extracted tree's build\.json says version 'v2\.0\.1' but the release was resolved as v2\.0\.0 — refusing/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'the tag is bound'`
Expected: the first and third cases FAIL (today the mismatch installs).

- [ ] **Step 4: Implement**

In `_upd_resolve`, after `UPD_VERSION="${UPD_VERSION%.tar.gz}"`:

```bash
  # THE TAG IS BOUND (design 2026-09-20 §5, refusal 1). SHA256SUMS is under
  # the publisher's control and is not an attestation subject; whatever it
  # named used to be what got installed. With --to, the name it gives must
  # BE the tag that was asked for — tag to tag, the un-stripped comparison
  # `_upd_converged` already makes; stripping one side would refuse every
  # correct release (§18). Before any backup: nothing is staged yet but the
  # sums file.
  if [ -n "$to" ] && [ "$UPD_VERSION" != "$to" ]; then
    _ccrc_die "the release at $to names a $UPD_TARNAME (version $UPD_VERSION, not $to) — refusing; nothing on this box was changed"
  fi
```

In `_upd_fetch`, after the MANIFEST verification and before its closing `echo`:

```bash
  # THE EXTRACTED VERSION IS BOUND (design §5, refusal 2): the set's own
  # build.json must say the version the release was resolved as. One parser
  # (`_box_build_fields`), pointed at the staged stamp; BOX_BUILD saved and
  # restored around it exactly as `_upd_converged` does, so the caller is
  # never left holding the staged tree's fields.
  local -a keep=(${BOX_BUILD[@]+"${BOX_BUILD[@]}"})
  local staged_version="" prc=0
  _box_build_fields "$UPD_TREE/build.json" || prc=$?
  [ "$prc" -eq 0 ] && staged_version="${BOX_BUILD[4]}"
  BOX_BUILD=(${keep[@]+"${keep[@]}"})
  [ "$prc" -eq 0 ] \
    || _ccrc_die "the extracted tree's build.json is unreadable or malformed (rc $prc) — refusing to install a set that cannot say what it is; nothing outside the staging dir was touched"
  [ "$staged_version" = "$UPD_VERSION" ] \
    || _ccrc_die "the extracted tree's build.json says version '${staged_version:-none}' but the release was resolved as $UPD_VERSION — refusing to install a set that is not what it claims; nothing outside the staging dir was touched"
```

- [ ] **Step 5: Run the whole file**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts`
Expected: PASS. The `--check` cases still pass: `_upd_resolve`'s binding only fires with `--to`, and `--check`'s `--to` fixtures name matching tarballs.

- [ ] **Step 6: Mutation check (§18 rows 8 and 9)**

Change the comparison to `[ "${UPD_VERSION#v}" != "$to" ]` → the "proceeds" case reds (every correct release refused). Restore. Delete the extracted-version block → the third case reds. Restore.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts
git commit -m "feat(ccrc): update binds the tag twice — SHA256SUMS to --to before any backup, the extracted build.json to the resolved version before any install"
```

### Task 10: The node's three files — `node-id`, `ccrc-caps`, `floor` — the `unsigned` marker default, `ccrc version`, uninstall

**Files:**
- Modify: `ccd/ccrc` — constants after `BOX_INSTALLED_FILE` (`:1127`), a comparator beside `_box_build_fields` (`:1673`), new `_inst_node_id` and `_inst_caps`, `_inst_installed` (`:11010-11022`), `cmd_install`'s sequence (`:9100-9123`), `cmd_version` (`:1753-1761`), `_uninst_tree_bins` (`:12299-12303`)
- Test: `server/test/ccrc-install.test.ts` (the sequence pin `:1868-1950`, the installed-LAST test `:3090-3117`, a new describe), `server/test/ccrc-uninstall.test.ts` (the fixture `:206`, the preserve-set test `:539-547`)

**Interfaces:**
- Produces: `BOX_NODE_ID_FILE`, `BOX_CAPS_FILE`, `BOX_FLOOR_FILE`, `CCRC_CAP_WORDS=(verify node-id floor)`; `_ver_newer <a> <b>` → 0 iff `a` is strictly newer (both `vX.Y.Z`); `_inst_node_id` (after `_inst_rc`), `_inst_caps` (after `_inst_stamp`); `_inst_installed` writes line 2 `unsigned` unless `CCRC_UPDATE_VERIFIED=1`, then raises `~/.ccrc/floor`; `cmd_version`'s `install:` line carries ` (unsigned — …)`; uninstall removes the three files.
- Consumed by Task 11 (`_ver_newer`, `BOX_FLOOR_FILE`) and Task 12 (`CCRC_UPDATE_VERIFIED`).

- [ ] **Step 1: Write the failing tests**

`ccrc-install.test.ts` — in the sequence pin's expected array insert `'_inst_node_id',` after `'_inst_rc',` and `'_inst_caps',` after `'_inst_stamp',` (with a one-line comment each: "design 2026-09-20 §3: seed-once identity, with the other seed-once files" / "§9: what THIS install can do, beside the stamp that says what it is"). In the installed-LAST test change the marker assertion and add the verified arm:

```ts
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
    // Line 2 (design §5, D-3117): `unsigned` unless the
    // updater asserted it verified the bundle — a plain `ccrc install` from
    // a checkout verified nothing.
    const verified = freshBox('ccrc-install-installed-verified-');
    const vsha = gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(readFileSync(join(verified, '.ccrc', 'installed'), 'utf8')).toBe(`${vsha}\n`);
```

Add a new describe:

```ts
describe('ccrc install: the node\'s three files (design 2026-09-20 §3, §9)', () => {
  const tagFixture = (home: string, tag: string): void => {
    const r = spawnSync('git', ['-C', treeRoot(home), 'tag', tag],
      { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

  it('node-id: minted once as a lowercase uuid, kept byte-identical by a second run', () => {
    const home = freshBox('ccrc-install-nodeid-');
    gitInit(treeRoot(home));
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    const id = readFileSync(join(home, '.ccrc', 'node-id'), 'utf8');
    expect(id).toMatch(UUID);
    expect(a.stdout).toMatch(/^install: node-id: minted [0-9a-f-]{36} /m);
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe(id);
    expect(b.stdout).toMatch(/^install: node-id: kept /m);
  });

  it('node-id: a file that is not a uuid is refused, never overwritten — it identifies this node to the console', () => {
    const home = freshBox('ccrc-install-nodeid-bad-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'node-id'), 'not-a-uuid\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/node-id exists but is not a uuid/);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe('not-a-uuid\n');
  });

  it('ccrc-caps: line 1 is the os, then W1\'s three words, nothing else (§18 "_inst_caps writes each wave\'s words")', () => {
    const home = freshBox('ccrc-install-caps-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const os = process.platform === 'darwin' ? 'darwin' : 'linux';
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(`os ${os}\nverify\nnode-id\nfloor\n`);
    expect(statSync(join(home, '.ccrc', 'ccrc-caps')).mode & 0o777).toBe(0o644);
  });

  it('floor: written by the LAST step from the stamped tag; only ever raised (§18 "the floor never lowers")', () => {
    const home = freshBox('ccrc-install-floor-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v1.0.0\n');
    expect(a.stdout).toMatch(/^install: floor: v1\.0\.0 \(none before/m);
    // The floor line prints AFTER the installed line — it is part of the last step.
    const lines = a.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: floor:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: installed:')));
    // A higher floor already on the box is KEPT by a lower install (a restore).
    writeFileSync(join(home, '.ccrc', 'floor'), 'v9.9.9\n');
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v9.9.9\n');
    expect(b.stdout).toMatch(/^install: floor: kept at v9\.9\.9 \(v1\.0\.0 is not above it/m);
    // A stamp with no version raises nothing.
    const untagged = freshBox('ccrc-install-floor-untagged-');
    gitInit(treeRoot(untagged));
    const c = runInstall(untagged);
    expect(c.code, c.stderr).toBe(0);
    expect(existsSync(join(untagged, '.ccrc', 'floor'))).toBe(false);
    expect(c.stdout).toMatch(/^install: floor: not raised — this stamp carries no version/m);
  });

  it('_ver_newer agrees with sort -V on a fixture list, and the v is stripped nowhere else', () => {
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_ver_newer\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _ver_newer').not.toBeNull();
    const list = ['v0.0.1', 'v0.0.10', 'v0.0.9', 'v0.1.0', 'v1.0.0', 'v1.9.9', 'v1.9.10', 'v2.0.0', 'v10.0.0'];
    const sorted = spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V', '--', ...list], { encoding: 'utf8' }).stdout.trim().split('\n');
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = 0; j < sorted.length; j += 1) {
        const r = spawnSync('bash', ['-c', `${fn![0]}\n_ver_newer "$1" "$2"`, '--', sorted[i]!, sorted[j]!], { encoding: 'utf8' });
        expect(r.status, `${sorted[i]} newer than ${sorted[j]}?`).toBe(i > j ? 0 : 1);
      }
    }
  });

  it('ccrc version says when the install was placed unsigned', () => {
    const home = freshBox('ccrc-install-version-unsigned-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const r = runInstall(home, ['version']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: complete \(unsigned — placed without a verified provenance bundle/m);
    const verified = freshBox('ccrc-install-version-verified-');
    gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(runInstall(verified, ['version']).stdout).toMatch(/^install: complete$/m);
  });
});
```

`ccrc-uninstall.test.ts` — in the fixture beside the `installed` line (`:206`) plant the three files, and in the preserve-set test add:

```ts
  writeFileSync(join(home, '.ccrc', 'node-id'), '01234567-89ab-cdef-0123-456789abcdef\n');
  writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\nnode-id\nfloor\n');
  writeFileSync(join(home, '.ccrc', 'floor'), 'v1.0.0\n');
```
```ts
    // The node's three files are install-state, not config (design 2026-09-20
    // §3, §9): an uninstalled box has no identity to the console, no
    // capabilities and no floor.
    for (const f of ['node-id', 'ccrc-caps', 'floor']) {
      expect(existsSync(join(home, '.ccrc', f)), `${f} survived`).toBe(false);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'three files|order is stated|installed LAST'` and `./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts`
Expected: FAIL — the sequence pin (two missing steps), the marker (one line), every new case, the uninstall survivors.

- [ ] **Step 3: Implement in `ccd/ccrc`**

After `BOX_INSTALLED_FILE="$HOME/.ccrc/installed"`:

```bash
# ── THE NODE'S THREE FILES (design 2026-09-20 §3, §9) ─────────────────────
#   node-id   — this node's identity to the console: a uuid minted ONCE by
#               `_inst_node_id` when absent, never rewritten, removed by
#               uninstall. Nothing on the box reads it; the server does.
#   ccrc-caps — what THIS install's ccrc can do: `os <linux|darwin>`, then
#               one word per line, rewritten by every install (`_inst_caps`).
#               A version number is never a capability (decision 13).
#   floor     — the highest version this box ever COMPLETED an install of,
#               only ever raised (`_inst_installed`); `cmd_update` refuses to
#               go below it without --downgrade (decision 8).
BOX_NODE_ID_FILE="$HOME/.ccrc/node-id"
BOX_CAPS_FILE="$HOME/.ccrc/ccrc-caps"
BOX_FLOOR_FILE="$HOME/.ccrc/floor"
# W1's words. Each wave's spine ADDS its own here, so the file records what
# this install can do, never what a design intends.
CCRC_CAP_WORDS=(verify node-id floor)
```

Before `_box_build_fields() {`:

```bash
# ── _ver_newer <a> <b> — 0 iff a is strictly newer than b ─────────────────
# Both in the tag form (vX.Y.Z, the canonical spelling everywhere — design
# 2026-09-20 decision 2); the `v` is stripped HERE and nowhere else. Pure
# bash: the report's downgrade sentence uses `sort -V`, and a test pins this
# function to agree with it, but a comparator that runs on every update must
# not hang on a coreutils flag. Callers validate the shape first.
_ver_newer() {
  local a="${1#v}" b="${2#v}" i
  local -a A B
  IFS=. read -r -a A <<< "$a"
  IFS=. read -r -a B <<< "$b"
  for i in 0 1 2; do
    if (( 10#${A[$i]:-0} > 10#${B[$i]:-0} )); then return 0; fi
    if (( 10#${A[$i]:-0} < 10#${B[$i]:-0} )); then return 1; fi
  done
  return 1
}
```

Before `_inst_tree() {` (the spine's seed-once group):

```bash
_inst_node_id() {   # seed-once identity (design 2026-09-20 §3): minted when absent, never rewritten
  local cur="" id tmp
  if [ -f "$BOX_NODE_ID_FILE" ]; then
    IFS= read -r cur < "$BOX_NODE_ID_FILE" || cur=""
    if [[ "$cur" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
      echo "install: node-id: kept ($cur)"
      return 0
    fi
    # Never overwritten: this value keys the node's row on the console, and
    # a re-mint would make the box a stranger to its own history.
    _ccrc_die "$BOX_NODE_ID_FILE exists but is not a uuid (got: '${cur:-empty}') — it identifies this node to the console; fix or remove it by hand. Nothing was changed"
  fi
  id="$(_plat_uuid)" || _ccrc_die "could not mint a node id"
  [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    || _ccrc_die "the platform's uuid source answered something that is not a uuid: '$id'"
  mkdir -p "${BOX_NODE_ID_FILE%/*}" || _ccrc_die "cannot create ${BOX_NODE_ID_FILE%/*}"
  tmp="$BOX_NODE_ID_FILE.tmp.$$"
  printf '%s\n' "$id" > "$tmp" && chmod 644 "$tmp" && mv -f -- "$tmp" "$BOX_NODE_ID_FILE" \
    || { rm -f -- "$tmp"; _ccrc_die "writing $BOX_NODE_ID_FILE failed"; }
  echo "install: node-id: minted $id ($BOX_NODE_ID_FILE — seed-once, never rewritten, removed by uninstall)"
}
```

After `_inst_stamp`'s closing brace (before `_inst_plist_server`):

```bash
_inst_caps() {   # what THIS install's ccrc can do (design 2026-09-20 §9, decision 13)
  # Words, never a version number: the server dispatches by what a node
  # SAYS it can do, and an install that predates a word does not have it.
  # Rewritten on every install so the file describes this tree, not a
  # previous one; self-reported, not a security boundary.
  local tmp="$BOX_CAPS_FILE.tmp.$$"
  mkdir -p "${BOX_CAPS_FILE%/*}" || _ccrc_die "cannot create ${BOX_CAPS_FILE%/*}"
  { printf 'os %s\n' "$CCD_OS"; printf '%s\n' "${CCRC_CAP_WORDS[@]}"; } > "$tmp" \
    && chmod 644 "$tmp" && mv -f -- "$tmp" "$BOX_CAPS_FILE" \
    || { rm -f -- "$tmp"; _ccrc_die "writing $BOX_CAPS_FILE failed"; }
  echo "install: caps: ${CCRC_CAP_WORDS[*]} (os $CCD_OS; $BOX_CAPS_FILE — what this install's ccrc can do, read by the server)"
}
```

Replace `_inst_installed` whole:

```bash
_inst_installed() {
  local rc=0 tmp dest="$BOX_INSTALLED_FILE"
  _box_build_fields || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "install: installed: not recorded — this box has no readable build stamp (ccrc version explains), so 'ccrc update' will never treat it as already installed"
    return 0
  fi
  tmp="$dest.tmp.$$"
  # LINE 2 (design 2026-09-20 §5; plan D-3117): `unsigned`
  # unless the updater that placed this tree VERIFIED its provenance bundle —
  # `cmd_update` asserts CCRC_UPDATE_VERIFIED=1 in this spine's environment
  # only after verify-provenance.mjs exited 0. A checkout-mode install, a
  # first `install.sh --release` (trust-on-first-use), an update driven by a
  # ccrc that predates verification, and --allow-unsigned all leave it
  # unset — and all four are honestly unsigned. The server reads line 2 as
  # the node's provenance; a one-line marker would claim `verified` for a
  # tree nobody verified. Written in ONE mv: a marker is never half-true.
  if [ "${CCRC_UPDATE_VERIFIED:-}" = 1 ]; then
    printf '%s\n' "${BOX_BUILD[0]}" > "$tmp"
  else
    printf '%s\nunsigned\n' "${BOX_BUILD[0]}" > "$tmp"
  fi
  chmod 644 "$tmp" && mv -f "$tmp" "$dest" \
    || { rm -f "$tmp"; _ccrc_die "writing $dest failed"; }
  echo "install: installed: ${BOX_BUILD[0]} (the spine completed under this stamp; ccrc update --check reads it${CCRC_UPDATE_VERIFIED:+; provenance verified})"

  # THE FLOOR (design §9): the stamped tag, when it is above the file's
  # current line; a restore or rollback never lowers it, because nothing
  # here can — it is only ever raised. A stamp with no version raises nothing.
  local ver="${BOX_BUILD[4]}" cur="" ftmp
  if [[ ! "$ver" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "install: floor: not raised — this stamp carries no version"
    return 0
  fi
  if [ -f "$BOX_FLOOR_FILE" ]; then IFS= read -r cur < "$BOX_FLOOR_FILE" || cur=""; fi
  if [[ "$cur" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && ! _ver_newer "$ver" "$cur"; then
    echo "install: floor: kept at $cur ($ver is not above it — the floor only rises)"
    return 0
  fi
  ftmp="$BOX_FLOOR_FILE.tmp.$$"
  printf '%s\n' "$ver" > "$ftmp" && chmod 644 "$ftmp" && mv -f -- "$ftmp" "$BOX_FLOOR_FILE" \
    || { rm -f -- "$ftmp"; _ccrc_die "writing $BOX_FLOOR_FILE failed"; }
  echo "install: floor: $ver (${cur:-none} before; ccrc update refuses to go below it without --downgrade)"
}
```

In `cmd_install`'s sequence add `_inst_node_id` right after `_inst_rc` and `_inst_caps` right after `_inst_stamp`.

In `cmd_version`, replace the block from `local rec=""` to the end of the function:

```bash
  local rec="" prov="" said=""
  if [[ -f "$BOX_INSTALLED_FILE" ]]; then
    { IFS= read -r rec || rec=""; IFS= read -r prov || prov=""; } < "$BOX_INSTALLED_FILE"
    # Line 2 (design 2026-09-20 §5): the tree was placed without a verified
    # provenance bundle. Said on the install line, so the one line an
    # operator reads for "is this box installed" also says how.
    [[ "$prov" == unsigned ]] && said=" (unsigned — placed without a verified provenance bundle; the next verified 'ccrc update' clears this)"
    if [[ "$rec" == "${BOX_BUILD[0]}" ]]; then
      echo "install: complete$said"
    else
      echo "install: incomplete — stamp ${BOX_BUILD[0]}, completed-install record names ${rec:-nothing}$said"
    fi
  else
    echo "install: incomplete — stamp ${BOX_BUILD[0]}, no completed-install record (ccrc install and ccrc update write one last; deploy.sh never does)"
  fi
```

In `_uninst_tree_bins`, right after the `rm -f -- "$BOX_INSTALLED_FILE"` line and its `|| _ccrc_die`:

```bash
  # The node's three files are install-state, not config (design 2026-09-20
  # §3, §9): an uninstalled box has no identity to the console, no
  # capabilities and no floor. `--purge` would take ~/.ccrc whole anyway.
  rm -f -- "$BOX_NODE_ID_FILE" "$BOX_CAPS_FILE" "$BOX_FLOOR_FILE" \
    || _ccrc_die "removing the node's identity, caps and floor files failed"
```

- [ ] **Step 4: Run the three files**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts` then `test/ccrc-uninstall.test.ts` then `test/ccrc-update.test.ts` (foreground, one at a time, timeout ≥ 600000 ms).
Expected: PASS. If `ccrc-update.test.ts`'s FULL-flavour happy path asserts the marker's exact content, it now reads two lines until Task 12 sets the variable — adjust that one assertion there in this task and say so in the commit.

- [ ] **Step 5: Run the citation and single-definition guards**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/session-hook.test.ts`
Expected: PASS. `single-definition` counts `jq -r` parses in `ccd/ccrc` (none added — `_box_build_fields` is the one parser) and the `~/.ccrc/…` path spellings (each new path is spelled once, at its constant). `session-hook.test.ts` audits `ccd/ccd` citations, not `ccd/ccrc`'s — but a README anchor into `ccd/ccrc` would move; if it reds, repair BY CONTENT.

- [ ] **Step 6: Mutation check**

Remove the `! _ver_newer "$ver" "$cur"` guard (always write) → the floor "kept" case reds. Remove `_inst_caps` from the sequence → the caps case and the sequence pin red. Remove the `unsigned` arm → the installed-LAST case reds. Restore each.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccrc server/test/ccrc-install.test.ts server/test/ccrc-uninstall.test.ts server/test/ccrc-update.test.ts
git commit -m "feat(ccrc): the node's three files — node-id (seed-once), ccrc-caps (verify node-id floor), floor (only rises); the marker records unsigned unless the updater verified; version says so; uninstall removes them"
```

### Task 11: The floor is checked on every path; `--downgrade` is the only way below it

**Files:**
- Modify: `ccd/ccrc` — `cmd_update`'s argument loop (`:11070-11082`), the call sequence after `_upd_resolve "$to"` (`:11166`), a new `_upd_floor_check`, `usage()`'s `update` entry (`:1512-1522`)
- Test: `server/test/ccrc-update.test.ts` (new describe)

**Interfaces:**
- Produces: `ccrc update [--downgrade]`; `_upd_floor_check <to> <downgrade>` called between `_upd_resolve` and `_upd_fetch` on the install path (never on `--check`), refusing when the floor is strictly newer than `UPD_VERSION` unless `downgrade=1`; the refusal names which path resolved the target (`--to <tag>` or `latest/download`).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ccrc update: the floor, on every path (design §9, decision 8)', () => {
  const plantFloor = (home: string, v: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), `${v}\n`);
  };

  it('latest/download naming a version below the floor is refused before any backup, with NO --to on the argv (§18 "the floor is checked on every path")', () => {
    const home = freshUpdateBox('ccrc-update-floor-latest-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by latest\/download\) is below this box's floor v3\.0\.0/);
    expect(r.stderr).toMatch(/ccrc update --to v2\.0\.0 --downgrade/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--to below the floor is refused the same way, naming --to', () => {
    const home = freshUpdateBox('ccrc-update-floor-to-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('--downgrade proceeds, warns, and the floor is NOT lowered (§18 "--downgrade is the only way below the floor")', () => {
    const home = freshUpdateBox('ccrc-update-floor-downgrade-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: v2\.0\.0 is below this box's floor v3\.0\.0 .* --downgrade was typed; the floor stays v3\.0\.0/m);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('at or above the floor proceeds without a word; no floor file is unconstrained', () => {
    const home = freshUpdateBox('ccrc-update-floor-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v1.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/floor/);
    const bare = freshUpdateBox('ccrc-update-floor-none-');
    plantOldBox(bare, { version: 'v3.0.0' });
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(bare);
    expect(r.code, r.stderr).toBe(0);
  });

  it('a malformed floor file refuses and names the file — never read as "no floor"', () => {
    const home = freshUpdateBox('ccrc-update-floor-bad-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'three');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/floor is malformed \(got: 'three'\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('--check is a measurement and never consults the floor', () => {
    const home = freshUpdateBox('ccrc-update-floor-check-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.stdout).toMatch(/^check: box=v3\.0\.0 sha=\S+ target=v2\.0\.0 state=behind$/m);
    expect(r.stderr).not.toMatch(/floor/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'the floor'`
Expected: FAIL — the first two install the older tag; `--downgrade` is "unknown argument".

- [ ] **Step 3: Implement**

In `cmd_update`'s loop add `downgrade=0` to the `local` line and the case `--downgrade) downgrade=1 ;;`. Replace the two lines `_upd_resolve "$to"` / `_upd_fetch` on the install path with:

```bash
  _upd_resolve "$to"
  _upd_floor_check "$to" "$downgrade"
  _upd_fetch
```

Add, after `_upd_converged`:

```bash
# ── _upd_floor_check <to> <downgrade> — never below the floor by accident ─
# (design 2026-09-20 §9, decision 8). Checked against the RESOLVED version,
# whichever way it was resolved — `--to`, or `latest/download` — because a
# promotion's `--latest` can point latest/download at an OLDER commit's tag by
# a routine act, and a box on a newer build would otherwise walk down on its
# next bare `ccrc update`. Moving down is a typed act: --downgrade. A floor
# file that is not a tag is refused by name, never read as "no floor".
_upd_floor_check() {
  local to="$1" downgrade="$2" floor="" via="latest/download"
  [ -n "$to" ] && via="--to $to"
  [ -f "$BOX_FLOOR_FILE" ] || return 0
  IFS= read -r floor < "$BOX_FLOOR_FILE" || floor=""
  [[ "$floor" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || _ccrc_die "$BOX_FLOOR_FILE is malformed (got: '${floor:-empty}') — it records the highest version this box completed an install of; fix or remove it by hand. Nothing on this box was changed"
  _ver_newer "$floor" "$UPD_VERSION" || return 0
  if [ "$downgrade" -eq 1 ]; then
    echo "update: WARN: $UPD_VERSION is below this box's floor $floor (resolved by $via) — proceeding because --downgrade was typed; the floor stays $floor"
    return 0
  fi
  _ccrc_die "$UPD_VERSION (resolved by $via) is below this box's floor $floor ($BOX_FLOOR_FILE: the highest version this box completed an install of) — moving down is a typed act: ccrc update --to $UPD_VERSION --downgrade. Nothing on this box was changed"
}
```

In `usage()`'s `update` entry, after the sentence ending `never auto-restores.` add:
`A target below this box's floor (~/.ccrc/floor, the highest version it completed an install of — a promotion can point latest at an older tag) is refused; --downgrade is the typed way below it, and the floor stays.`

- [ ] **Step 4: Run the whole file**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts`
Expected: PASS. The existing `--to` downgrade test (`:717`) plants no floor, so it is unconstrained and still prints the coord.db restore lines.

- [ ] **Step 5: Mutation check**

Key the check to `--to` (`[ -n "$to" ] || return 0` at the top) → the latest/download case reds. Delete the `_ccrc_die` (always return 0) → both refusal cases red. Restore.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts
git commit -m "feat(ccrc): update refuses below the floor on every path; --downgrade is the typed way down and the floor stays"
```

### Task 12: `_upd_fetch` verifies provenance with the INSTALLED verifier; `--allow-unsigned` admits absence only; the spine is told when it verified

**Files:**
- Modify: `ccd/ccrc` — `cmd_update`'s loop, its staged-install invocation (`:11190-11194`), `_upd_fetch`, `usage()`
- Test: `server/test/ccrc-update.test.ts` (a new describe; one assertion in the happy path)

**Interfaces:**
- Produces: `ccrc update [--allow-unsigned]`; `_upd_fetch <allow_unsigned>` fetching `<tarball>.sigstore.json` after the transport checksum and running `node --no-warnings "$CCRC_HERE/../deploy/verify-provenance.mjs" --blob … --bundle … --tag "$UPD_VERSION" --owner "$CCRC_RELEASE_OWNER" --repo "$CCRC_RELEASE_REPO"` BEFORE `tar -x`; sets `UPD_PROVENANCE=verified|unsigned`; the staged spine runs with `CCRC_UPDATE_VERIFIED=1` iff `verified`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ccrc update: provenance (design §5; the verifier is the INSTALLED one, decision 12)', () => {
  const OWNER = ((): string => {
    const m = /^CCRC_RELEASE_OWNER="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const REPO_NAME = ((): string => {
    const m = /^CCRC_RELEASE_REPO="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const verifyArgv = (home: string): string[] => (existsSync(join(home, 'verify-argv'))
    ? readFileSync(join(home, 'verify-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

  it('the bundle is fetched after the tarball and verified by the INSTALLED tree\'s verifier, with --tag, before extraction; the spine is told (§18 "the INSTALLED verifier is used")', () => {
    const home = freshUpdateBox('ccrc-update-prov-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    const argv = verifyArgv(home);
    expect(argv.length).toBe(1);
    const a = argv[0]!.split(' ');
    // `node --no-warnings <verifier> …`: the verifier is resolved beside the
    // ccrc under test (`$CCRC_HERE/../deploy/`), never under the staging dir.
    expect(a[0]).toBe('--no-warnings');
    expect(a[1]).toBe(`${join(REPO, 'ccd')}/../deploy/verify-provenance.mjs`);
    expect(a[1]!.startsWith(join(home, 'tmp'))).toBe(false);
    const flag = (f: string): string => a[a.indexOf(f) + 1]!;
    expect(flag('--blob')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz$/);
    expect(flag('--bundle')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz\.sigstore\.json$/);
    expect(flag('--tag')).toBe('v2.0.0');
    expect(flag('--owner')).toBe(OWNER);
    expect(flag('--repo')).toBe(REPO_NAME);
    expect(r.stdout).toMatch(/^update: verified ccrc-v2\.0\.0\.tar\.gz \(transport checksum, provenance, then the per-file MANIFEST\)$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('1\n');
  });

  it('a FAILING bundle refuses: nothing extracted, no backup, ~/ccrc byte-identical — and --allow-unsigned does not apply (§18 "--allow-unsigned permits absence only")', () => {
    const home = freshUpdateBox('ccrc-update-prov-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '1\n');
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz .* refusing to extract or install/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--allow-unsigned does not apply to a bundle that FAILS/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('an ABSENT bundle refuses without --allow-unsigned, and proceeds with it — recorded as unsigned (§18 "--allow-unsigned is recorded")', () => {
    const home = freshUpdateBox('ccrc-update-prov-absent-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .* installs only with --allow-unsigned \(recorded on the box as unsigned\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(verifyArgv(home)).toEqual([]);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: .*sigstore\.json is absent \(404\) — proceeding on the transport checksum alone because --allow-unsigned was typed; this install will be recorded as unsigned$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('unset\n');
  });

  it('FULL flavour: a verified update writes a one-line marker; an --allow-unsigned one writes `unsigned` on line 2', () => {
    const home = freshUpdateBox('ccrc-update-prov-marker-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const sha = 'newsha0000000000000000000000000000000001';
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\n`);
    const home2 = freshUpdateBox('ccrc-update-prov-marker-unsigned-');
    plantOldBox(home2, { version: 'v1.0.0' });
    plantCoordDb(home2);
    packRelease(home2, fullTree(home2, { version: 'v2.0.0', sha }), { tag: 'v2.0.0', bundle: false });
    r = runUpdate(home2, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home2, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('verification runs AFTER sha256sum -c (a tampered tarball never reaches the verifier) and BEFORE tar -x (§18 "verification precedes extraction")', () => {
    const home = freshUpdateBox('ccrc-update-prov-order-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', tamper: true });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(verifyArgv(home)).toEqual([]);
    // The failing-verifier case above proves the other side: refused before
    // extraction, so no staged tree, no backup, no spine.
  });

  it('a bundle download that fails for a reason other than 404 is not "absent" — refused even with --allow-unsigned', () => {
    const home = freshUpdateBox('ccrc-update-prov-net-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The stub curl exits 22 for a missing file (curl's own 404 shape); the
    // fixture exit models every other failure — here curl's 7, "could not
    // connect" — which is NOT absence and which --allow-unsigned never admits.
    writeFileSync(join(home, 'fixture-curl-exit'), '7\n');
    const r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/download failed: .*sigstore\.json \(curl exit 7, not a 404/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });
});
```

In the existing happy-path test (`:581-607`) add, after its exit assertion: `expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(\`${sha}\\n\`);` where `sha` is the stamp the fixture passed to `fullTree` (read the test to name it).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'provenance'`
Expected: FAIL — no bundle URL fetched, no verifier argv, `--allow-unsigned` unknown.

- [ ] **Step 3: Implement**

`cmd_update`'s loop: add `allow_unsigned=0` to the `local` line and `--allow-unsigned) allow_unsigned=1 ;;`. The call becomes `_upd_fetch "$allow_unsigned"`. Replace the staged-install invocation (`rm -f "$BOX_INSTALLED_FILE"` … `fi` around the two `bash "$UPD_TREE/ccd/ccrc" install` lines) with:

```bash
  rm -f "$BOX_INSTALLED_FILE"
  # THE SPINE IS TOLD WHETHER THIS RUN VERIFIED (design §5; plan
  # D-3117): `_inst_installed` writes the marker's second line
  # `unsigned` unless CCRC_UPDATE_VERIFIED=1 is in its environment, and only
  # a bundle that verify-provenance.mjs accepted puts it there. `env -u`
  # on the other arm, so an ambient export can never claim a verification
  # that did not happen.
  local -a spine_env=(env -u CCRC_UPDATE_VERIFIED)
  [ "$UPD_PROVENANCE" = verified ] && spine_env=(env CCRC_UPDATE_VERIFIED=1)
  local inst_rc=0
  if [ -n "$role" ]; then
    "${spine_env[@]}" bash "$UPD_TREE/ccd/ccrc" install --role "$role" || inst_rc=$?
  else
    "${spine_env[@]}" bash "$UPD_TREE/ccd/ccrc" install || inst_rc=$?
  fi
```

Replace `_upd_fetch` whole:

```bash
# `_upd_fetch <allow_unsigned>` — the tarball, its bundle, verified three
# ways, then extracted. Reads `UPD_URL_DIR`/`UPD_TARNAME`, both set by
# `_upd_resolve`. Order (design 2026-09-20 §5): transport checksum → bundle →
# PROVENANCE → extract → the extracted version is bound → MANIFEST. Nothing
# that fails a step puts a file outside `UPD_STAGE`.
_upd_fetch() {
  local allow_unsigned="${1:-0}" bundle rc=0
  echo "update: fetching $UPD_URL_DIR/$UPD_TARNAME …"
  curl -fsSL -o "$UPD_STAGE/$UPD_TARNAME" "$UPD_URL_DIR/$UPD_TARNAME" \
    || _ccrc_die "download failed: $UPD_URL_DIR/$UPD_TARNAME — nothing on this box was changed"
  # Verify BEFORE extracting: a tarball that fails its checksum never puts a
  # file on disk, let alone runs one (install.sh's rule, same words).
  ( cd "$UPD_STAGE" && _plat_sha256_check SHA256SUMS >/dev/null 2>&1 ) \
    || _ccrc_die "checksum verification FAILED for $UPD_TARNAME — refusing to extract or install; nothing on this box was changed"

  # ── PROVENANCE (design §5). The bundle is fetched from beside the tarball
  # and verified by the INSTALLED tree's verifier — `$CCRC_HERE/../deploy/`,
  # the resolution `_upd_backup` makes for backup-coord.mjs (decision 12):
  # never the tarball's own copy, which would be self-attestation. Three
  # answers, never folded: a 404 is ABSENT (a release older than provenance,
  # a fork with no attest step — the one shape --allow-unsigned admits, and
  # it is RECORDED); any other download failure is a failure; a bundle that
  # FAILS to verify is refused, --allow-unsigned or not.
  bundle="$UPD_STAGE/$UPD_TARNAME.sigstore.json"
  UPD_PROVENANCE=""
  echo "update: fetching $UPD_URL_DIR/$UPD_TARNAME.sigstore.json …"
  curl -fsSL -o "$bundle" "$UPD_URL_DIR/$UPD_TARNAME.sigstore.json" || rc=$?
  if [ "$rc" -eq 0 ]; then
    node --no-warnings "$CCRC_HERE/../deploy/verify-provenance.mjs" \
        --blob "$UPD_STAGE/$UPD_TARNAME" --bundle "$bundle" --tag "$UPD_VERSION" \
        --owner "$CCRC_RELEASE_OWNER" --repo "$CCRC_RELEASE_REPO" \
      || _ccrc_die "provenance verification FAILED for $UPD_TARNAME (read verify-provenance's line above) — refusing to extract or install; --allow-unsigned does not apply to a bundle that FAILS, only to one that is absent; nothing on this box was changed"
    UPD_PROVENANCE=verified
  elif [ "$rc" -eq 22 ]; then
    if [ "$allow_unsigned" -eq 1 ]; then
      echo "update: WARN: $UPD_URL_DIR/$UPD_TARNAME.sigstore.json is absent (404) — proceeding on the transport checksum alone because --allow-unsigned was typed; this install will be recorded as unsigned"
      UPD_PROVENANCE=unsigned
    else
      _ccrc_die "the release ships no provenance bundle ($UPD_URL_DIR/$UPD_TARNAME.sigstore.json answered 404) — refusing; a release older than provenance, or a fork without the attest step, installs only with --allow-unsigned (recorded on the box as unsigned); nothing on this box was changed"
    fi
  else
    _ccrc_die "download failed: $UPD_URL_DIR/$UPD_TARNAME.sigstore.json (curl exit $rc, not a 404 — the tarball came from the same place a moment ago) — nothing on this box was changed"
  fi

  UPD_TREE="$UPD_STAGE/tree"
  mkdir "$UPD_TREE" || _ccrc_die "cannot create $UPD_TREE"
  tar -xzf "$UPD_STAGE/$UPD_TARNAME" -C "$UPD_TREE" \
    || _ccrc_die "extracting $UPD_TARNAME failed — nothing outside the staging dir was touched"
  [ -f "$UPD_TREE/MANIFEST" ] \
    || _ccrc_die "the release ships no MANIFEST — refusing to install a set nothing can verify"
  ( cd "$UPD_TREE" && _plat_sha256_check MANIFEST >/dev/null 2>&1 ) \
    || _ccrc_die "MANIFEST verification FAILED after extraction — a file in the release set does not match its recorded digest; refusing to install"
  # THE EXTRACTED VERSION IS BOUND (design §5, refusal 2): the set's own
  # build.json must say the version the release was resolved as. One parser
  # (`_box_build_fields`), pointed at the staged stamp; BOX_BUILD saved and
  # restored around it exactly as `_upd_converged` does.
  local -a keep=(${BOX_BUILD[@]+"${BOX_BUILD[@]}"})
  local staged_version="" prc=0
  _box_build_fields "$UPD_TREE/build.json" || prc=$?
  [ "$prc" -eq 0 ] && staged_version="${BOX_BUILD[4]}"
  BOX_BUILD=(${keep[@]+"${keep[@]}"})
  [ "$prc" -eq 0 ] \
    || _ccrc_die "the extracted tree's build.json is unreadable or malformed (rc $prc) — refusing to install a set that cannot say what it is; nothing outside the staging dir was touched"
  [ "$staged_version" = "$UPD_VERSION" ] \
    || _ccrc_die "the extracted tree's build.json says version '${staged_version:-none}' but the release was resolved as $UPD_VERSION — refusing to install a set that is not what it claims; nothing outside the staging dir was touched"
  if [ "$UPD_PROVENANCE" = verified ]; then
    echo "update: verified $UPD_TARNAME (transport checksum, provenance, then the per-file MANIFEST)"
  else
    echo "update: verified $UPD_TARNAME (transport checksum, then the per-file MANIFEST — provenance NOT verified, --allow-unsigned)"
  fi
}
```

`usage()`'s `update` entry gains: `Every release since W1 ships a provenance bundle; the installed tree's verifier checks it before extraction. --allow-unsigned admits a release with NO bundle (never one that fails), and the box records the install as unsigned (ccrc version says so).`

- [ ] **Step 4: Run the whole file, then the install suite**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts` then `test/ccrc-install.test.ts`
Expected: PASS. Every earlier update case now fetches three URLs — cases that pinned `localUrls(home)` to two entries (the `--to` case at `:717`, the check cases) must be updated to include the bundle URL where the run reaches it (`--check` fetches SHA256SUMS only, unchanged).

- [ ] **Step 5: Mutation check (§18 rows 12–15)**

Move the verifier call below `tar -xzf` → the FAILING case's "nothing extracted" assertion reds (a staged tree exists under `tmp/`). Change the path to `"$UPD_TREE/deploy/verify-provenance.mjs"` → the argv case reds. Make the 22 arm ignore `allow_unsigned` → the absent case reds. Drop `env CCRC_UPDATE_VERIFIED=1` → the marker case reds. Restore each.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts
git commit -m "feat(ccrc): update verifies the release's provenance bundle with the installed verifier before extraction; --allow-unsigned admits an absent bundle only and is recorded; the spine is told when it verified"
```

### Task 13: `install.sh --release` says it trusts on first use

**Files:**
- Modify: `install.sh` — the line `echo "install.sh: verified $TARNAME — handing off to the staged 'ccrc install'"` (`:100` at `7d78b376`)
- Test: `server/test/install-sh.test.ts` — the `latest:` case (`:399-420`)

- [ ] **Step 1: Write the failing test**

In the `latest:` case, after `expect(r.code…).toBe(0)`:

```ts
    // Trust-on-first-use, said out loud (design 2026-09-20 §5): there is no
    // installed verifier yet, and the one in the tarball must not verify
    // itself. Every update from here is verified by the tree this run placed.
    expect(r.stdout).toMatch(/^install\.sh: first install trusts the release's transport checksum only; every update from here verifies provenance$/m);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/install-sh.test.ts -t 'latest:'`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Implement**

Before the `trap - EXIT` in the release arm:

```bash
  # TRUST ON FIRST USE, said out loud (design 2026-09-20 §5): this bootstrap
  # has no installed verifier to use and must not use the one it just
  # downloaded (self-attestation). The tree it places carries the verifier;
  # every `ccrc update` from here verifies provenance before extracting.
  echo "install.sh: first install trusts the release's transport checksum only; every update from here verifies provenance"
```

- [ ] **Step 4: Run the file**

Run: `cd server && ./node_modules/.bin/vitest run test/install-sh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add install.sh server/test/install-sh.test.ts
git commit -m "feat(install.sh): --release says it trusts on first use"
```

### Task 14: Documentation for the node side, the PR 2 gate, the rollout, and the exit criterion

**Files:**
- Modify: `README.md` — "**Update and rollout.**" paragraph (`:440-456`), "**Install from a release.**" paragraph (`:436-440`)
- Modify: `CLAUDE.md` — the "What is running where" sentence in the Deploy bullet

- [ ] **Step 1: README**

In "**Install from a release.**", after `no build step on the box.` add: `The first install trusts the transport checksum only and says so; every update from then on verifies provenance.`

Replace the "**Update and rollout.**" paragraph's first sentences through `then the from→to report.` with:

```markdown
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
box records the install as unsigned, which `ccrc version` says); extract, bind the extracted `build.json`
to the resolved version, check the per-file `MANIFEST`; back up to `~/ccrc-backups/<ts>/` (coord.db via
`VACUUM INTO`, dists, ccd, units, `~/.ccrc/memory`) before any install write; re-run the install spine from
the staged tree (role-aware, atomic, seed-once files untouched, every rostered home's skills converged; it
mints `~/.ccrc/node-id` once, rewrites `~/.ccrc/ccrc-caps` with what this install can do, and raises the
floor last); the supervisor sweep behind its mandatory `KillMode=process` preflight; then the from→to report.
```

Keep the rest of the paragraph (rollback sentence onward) as it is, but change `Rolling back is \`--to <the older tag>\`` to `Rolling back is \`--to <the older tag> --downgrade\``.

- [ ] **Step 2: CLAUDE.md**

In the Deploy bullet's "**What is running where:**" sentence, after `` `ccrc version` (with its `install:` line) `` add `` — which also says `unsigned` when the tree was placed without a verified bundle — ``. After the sentence about `deploy.sh` being the fallback, add one sentence: `A release since W1 of the update-management design is a PRERELEASE until promoted, so a bare \`ccrc rollout\` (which pins from \`latest/download\`) moves the fleet to the newest STABLE; a dev build is \`rollout --to vX.Y.Z\`.`

- [ ] **Step 3: The gate**

```bash
cd server && git fetch origin main
for t in ccrc-update ccrc-install ccrc-uninstall install-sh verify-provenance release-main release-stable build-release single-definition deviation-refs topology-clean oss-metadata pools-prose session-hook node-floor usage-sweep-deploy-ship deploy-coordinates ccrc-rollout; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: all green. Then the full server suite in foreground shards per the repo's sharding note (`ccrc-server-suite-needs-sharding` in the operator's memory; CI on the quiet box is the arbiter for the known load flakes named in CLAUDE.md). `agent/` and `pwa/` are untouched by this PR; their suites need not run.

- [ ] **Step 4: Push, PR, merge, and the first promotion of a W1 node-side build**

`git push`; `gh pr create` with a body naming the spec, this plan, D-3116, D-3117, D-3123, D-3119 (and the no-tag-fixture deviation's number if it was minted), ending with the session's attribution line. The operator merges. Watch `release-main` cut the prerelease with its bundle (Task 7 Step 3's commands); record the tag as `NODE_TAG`.

- [ ] **Step 5: Roll it out — and read the first result correctly**

The fleet's installed `ccrc` predates this PR, so THIS rollout does not verify (the old updater has no verifier); the new spine records `unsigned`, honestly, and the NEXT update verifies. Both boxes were on a promoted release until now, so `rollout --check` is the measurement first:

```bash
ccrc rollout --check
ccrc rollout --to "$NODE_TAG"          # a prerelease: --to names it; a bare rollout would pin the newest STABLE
ssh <fleet box> 'ccrc version; cat ~/.ccrc/ccrc-caps; cat ~/.ccrc/floor; wc -c ~/.ccrc/node-id'
ssh <server box> 'ccrc version; cat ~/.ccrc/ccrc-caps; cat ~/.ccrc/floor; wc -c ~/.ccrc/node-id'
```
Expected on each box: `version <NODE_TAG>`; `install: complete (unsigned — …)`; caps `os linux` + `verify`/`node-id`/`floor`; floor `<NODE_TAG>`; a 37-byte node-id. Then promote `NODE_TAG` (Task 7 Step 4's push to `stable`, from `NODE_TAG^{commit}`) so `latest/download` serves it and the next bare `rollout` is a no-op that VERIFIES: run `ccrc rollout --force` once and read `update: verified ccrc-<tag>.tar.gz (transport checksum, provenance, then the per-file MANIFEST)` on both boxes, then `ccrc version` → `install: complete` with no `unsigned`.

That last line is spec §15's exit criterion for the node side, measured on the live fleet: the installed verifier accepted a real bundle under the `release-main` identity.

- [ ] **Step 6: Close the loop**

Update the operator's memory file for this programme (`centralised-update-management-programme`: W1 SHIPPED, the tags, the spike's verdict, the deviations) and fill any remaining "*filled by Task 1*" cell in this plan if one was missed. W2 is next: the control plane (`MIGRATIONS[13]`, re-derived at its merge).
