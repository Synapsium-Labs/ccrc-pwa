# More known-token rows in the shared redactor — task note

Programme `overlord` (#2491), wave 163, run 2671. A small independent PR off `main`. It came out of a read of an
outside Apache-2.0 project whose credential rules are adapted from Gitleaks. The rows here were read from Gitleaks
v8.30.0 itself (`config/gitleaks.toml` at tag `v8.30.0`, MIT licence), never from that project's file.

## What shipped

- **Known-token rows** (`shared/redact.mjs#KNOWN_TOKEN_PREFIX`), read by the `egress` and `linear-egress` profiles:

  | Row | Gitleaks rule | Shape here | Change from Gitleaks |
  |---|---|---|---|
  | SendGrid | `sendgrid-api-token` | `SG\.[A-Za-z0-9=_.-]{66}` | no closing delimiter: the 66 characters are masked and what follows is kept, as the `AKIA` row does |
  | DigitalOcean PAT, access | `digitalocean-pat`, `digitalocean-access-token` | `do[op]_v1_[a-f0-9]{64}` | none but the delimiter |
  | DigitalOcean refresh | `digitalocean-refresh-token` | `[dD][oO][rR]_[vV]1_[a-fA-F0-9]{64}` | Gitleaks's `(?i)` spelt with both cases (no inline `(?i:` before Node 23) |
  | age | `age-secret-key` | `AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}` | none |
  | Vault service | `vault-service-token`, `hvs.` arm | `hvs\.[A-Za-z0-9_-]{90,}` | upper bound (120) dropped, so a longer run is masked whole and leaves no tail |
  | Vault batch | `vault-batch-token` | `hvb\.[A-Za-z0-9_-]{138,}` | upper bound (300) dropped, same reason |
  | Mailgun | `mailgun-private-api-token` | `(?<![_-])key-[a-f0-9]{32}(?![A-Za-z0-9_-])` | Gitleaks's `mailgun` keyword context dropped; fenced on both sides instead, so `cache-key-<md5>` and a longer hex run stay readable |
  | Google OAuth access | none (D-8776) | `ya29\.(?=[A-Za-z0-9_.-]{20})[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*` | ccrc's own: at least 20 characters of base64url in dot-joined parts, so a trailing full stop is never taken |

- **The PEM private-key block has one home.** Its source moved from `ccd/history/lib.mjs#SECRET_SHAPE_RES` into
  `shared/redact.mjs#PEM_PRIVATE_KEY_SOURCE`, byte for byte; lib builds its first arm from it (flags `g`, as before),
  and both egress profiles run it first, as the rule `pem-block`. A block is masked from its BEGIN line to its END line,
  or to the end of the text when it has none.
- **The Anthropic admin key** (`sk-ant-admin01-…`) was already masked: the generic `sk-` shape (`CREDENTIAL_MASKS`'
  `genericSk`) catches it in both egress profiles and in the response masks. A case now pins it for both profiles.
- **The residuals comment** no longer lists `hvs.` and `hvb.`; it names the legacy Vault `s.` form (it also reads as
  code, `s.getElementsByClassName…`) and the PGP private key block (D-8778).
- **Licence.** The repository has no third-party notice file, so the Gitleaks origin and its MIT licence are named in
  the comment beside the rows. No licence file was added: a handful of patterns, and the copyright line would put a
  person's name in this public repository. The coordinator may rule otherwise.

## Which profiles saw a PEM block and missed it (measured on `main`)

| Profile | Saw it? | Before | After |
|---|---|---|---|
| `egress` (approval rows, mail, digests) | yes | unmasked; only body segments of 32+ characters between `/` were masked | masked whole (`pem-block`) |
| `linear-egress` (text sent to Linear) | yes | unmasked | masked whole (`pem-block`) |
| `docs` (stderr, tracebacks in the Docs reader) | rarely | unmasked | unchanged: not in this brief |
| History shape layer | yes | masked | unchanged, now read from the shared source |
| Response masks (`CREDENTIAL_MASKS`, `accounts/shapes.ts`) | yes (transcripts, pane history, the drawer) | unmasked: `SHAPE_MASK.maskDeep` returned the block unchanged | unchanged here (D-8777) |

## Deviations found

- **D-8776** — Gitleaks v8.30.0 has no Google OAuth access-token rule. The brief named `ya29.`, so its row is ccrc's
  own shape, documented beside the rows; it is the only row not read from Gitleaks.
- **D-8777** — The response masks miss a PEM block, and this PR does not fix them. `server/src/accounts/shapes.ts`
  and `server/test/secret-mask.test.ts` are claimed by an in-flight masker round (claims 5206 and 5381), and
  `shared/api.ts` by wave 164 (claim 5383). The fix is also more than a row: a match that spans rows would be spliced
  into one mark, which joins the drawer's rows (the drawer's one-column mark exists so no row moves), and in rows mode a
  shape that ends at its row's end runs on into the next indented row. Follow-up: add `PEM_PRIVATE_KEY_SOURCE` to
  `CREDENTIAL_MASKS` (by import, not a copy), add `-----BEGIN` to `SHAPE_HINT`, split a match at each row break
  so every row is masked on its own, and take no run-on after a match that already spans rows.
- **D-8778** — The PEM rule keeps history's bytes, not Gitleaks's `private-key` rule. Changing it changes every history
  index text (a `BELT_VERSION` bump and a reindex, the history programme's), so a PGP private key block
  (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) stays unmasked in every profile and is listed as a residual. Follow-up for
  the history programme if it wants Gitleaks's `(?: BLOCK)?`.

## Verification

- Red first: `server/test/redact-gitleaks-rows.test.ts`, 20 of 47 cases red on `main`'s redactor, every near miss
  green; 47 of 47 green after.
- Mutation, by hand from a saved copy of `shared/redact.mjs` (the coordinator's mutation runner is for Python modules):
  13 mutants (each row deleted, the Mailgun fences removed one at a time, the `ya29.` row allowed to take a trailing
  full stop, `pem-block` taken out of each profile), all 13 killed, the file restored byte for byte.
- Suites: the redaction suites (`redact`, `redact-profiles`, `redact-gitleaks-rows`, `history-redact-profiles`,
  `docs-parity`, `docs-shared`, `redact-cli`), `single-definition/*`, `late-census`, `linear-ops`,
  `linear-proxy-routes`, `unprintable-characterization`, `growth-check`, `anchors`, `citations`, `ownership` and
  `consolidation-census`. The fleet test slice's memory cap killed `roster-bash` and `history-lib` on every local
  attempt (other sessions' runs share the cap); CI's runs are the arbiter for those two.
