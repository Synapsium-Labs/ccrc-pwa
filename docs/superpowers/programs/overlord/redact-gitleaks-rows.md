# More known-token rows in the shared redactor — task note

Programme `overlord` (#2491), wave 163, run 2671. A small independent PR off `main`. It came out of a read of an
outside Apache-2.0 project whose credential rules are adapted from Gitleaks. The rows here were read from Gitleaks
v8.30.0 itself (`config/gitleaks.toml` at tag `v8.30.0`, MIT licence), never from that project's file.

## What shipped

- **Known-token rows** (`shared/redact.mjs#KNOWN_TOKEN_PREFIX`), read by the `egress` and `linear-egress` profiles.
  Every departure from Gitleaks v8.30.0 (review 2693 F6) is listed in the comment beside the rows and here:

  | Row | Gitleaks rule | Shape here | Departure from Gitleaks |
  |---|---|---|---|
  | SendGrid | `sendgrid-api-token` | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_=-])` | the key's own shape, 22 then `.` then 43 base64url, fenced at the end (Gitleaks: `SG.` and 66 of a case-insensitive class with `=` and `.`), so dotted prose is never cut and a glued run leaves no tail |
  | DigitalOcean PAT, access | `digitalocean-pat`, `digitalocean-access-token` | `do[op]_v1_[a-f0-9]{64}`, fenced | fenced at the end, so an over-long run is not cut (egress's segment rule masks it whole) |
  | DigitalOcean refresh | `digitalocean-refresh-token` | `[dD][oO][rR]_[vV]1_[a-fA-F0-9]{64}`, fenced | Gitleaks's `(?i)` spelt with both cases (no inline `(?i:` before Node 23); fenced |
  | age | `age-secret-key` | `AGE-SECRET-KEY-(?:PQ-)?1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}`, fenced | also the post-quantum identity (`PQ-`, age v1.3, review F8); fenced |
  | Vault service | `vault-service-token`, `hvs.` arm | `hvs\.[A-Za-z0-9_-]{90,}` | upper bound (120) dropped, so a longer run is masked whole |
  | Vault batch | `vault-batch-token` | `hvb\.[A-Za-z0-9_-]{138,}` | upper bound (300) dropped, same reason |
  | Mailgun | `mailgun-private-api-token` | `(?<![_-])key-[a-f0-9]{32}(?![A-Za-z0-9_-])` | no `mailgun` keyword needed, lowercase hex only (Gitleaks: any case), fenced on both sides, so `cache-key-<md5>` stays readable |
  | Google OAuth access | none (`ya29-row-is-ccrcs-own`) | `ya29\.(?=(?:\.?[A-Za-z0-9_-]){20})[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*` | ccrc's own: at least 20 base64url characters in dot-joined parts, the dots not counted (review F7), and a trailing full stop is never taken |

  For every row, Gitleaks's left `\b` is the group's lookbehind (no letter or digit before), so a `_` before is allowed.
- **The PEM private-key block: one spelling, two rules.** The BEGIN and END lines are spelt once in `shared/redact.mjs`.
  History's rule, `PEM_PRIVATE_KEY_SOURCE`, is the old `ccd/history/lib.mjs` source byte for byte (lib builds its first
  arm from it, flags `g`), so no history index text changes. The egress profiles run a bounded rule, `pem-block`
  (review F1, the coordinator's ruling; legitimately different, since egress text is shown rather than stored): a
  block closed on its own line, never across another BEGIN line (a JSON-escaped or space-joined block); or the BEGIN
  line, then every base64 line (and an encrypted block's `Proc-Type:` and `DEK-Info:` fields), blank lines between,
  then its END line if one follows. Line breaks are CR LF, LF, or JSON's escaped `\r\n` and `\n`; a base64 line ends at
  a line break, the end of the text or a closing quote. An unclosed header masks itself and the key lines after it, and
  the prose after them is kept.
- **The Anthropic admin key** (`sk-ant-admin01-…`) was already masked: the generic `sk-` shape (`CREDENTIAL_MASKS`'
  `genericSk`) catches it in both egress profiles and in the response masks. A case now pins it for both profiles.
- **The residuals comment** no longer lists `hvs.` and `hvb.`; it names the legacy Vault `s.` form (it also reads as
  code, `s.getElementsByClassName…`) and the PGP private key block (`pgp-block-residual`).
- **No self-hit** (review F5). The comments describe the BEGIN lines in words, and a test runs Gitleaks's own
  `private-key` rule over every file this change wrote and finds nothing.
- **Licence (the coordinator's ruling).** A comment only, no notice file: it cites Gitleaks v8.30.0's
  `config/gitleaks.toml` and its MIT `LICENSE` by URL. The copyright line is not copied, since this public repository
  carries no real names; the rows are short patterns, not substantial portions of the code.

## Which profiles saw a PEM block and missed it (measured on `main`)

| Profile | Saw it? | Before | After |
|---|---|---|---|
| `egress` (approval rows, mail, digests) | yes | unmasked; only body segments of 32+ characters between `/` were masked | masked (`pem-block`, bounded) |
| `linear-egress` (text sent to Linear) | yes | unmasked | masked (`pem-block`, bounded) |
| `docs` (stderr, tracebacks in the Docs reader) | rarely | unmasked | unchanged: not in this brief |
| History shape layer | yes | masked | unchanged, now read from the shared source |
| Response masks (`CREDENTIAL_MASKS`, `accounts/shapes.ts`) | yes (transcripts, pane history, the drawer) | unmasked: `SHAPE_MASK.maskDeep` returned the block unchanged | unchanged here (`response-masks-miss-pem`) |

## Deviations found

Named by slug: the allocator issued their numbers to this run, and the wave-done mail carries them; they are
written here once a plan that defines them is on `main` (a number above the tree's ledger high-water reds
`deviation-refs`).

- **`ya29-row-is-ccrcs-own`** — Gitleaks v8.30.0 has no Google OAuth access-token rule. The brief named `ya29.`, so its row is ccrc's
  own shape, documented beside the rows; it is the only row not read from Gitleaks.
- **`response-masks-miss-pem`** — The response masks miss a PEM block, and this PR does not fix them. `server/src/accounts/shapes.ts`
  and `server/test/secret-mask.test.ts` are claimed by an in-flight masker round (claims 5206 and 5381), and
  `shared/api.ts` by wave 164 (claim 5383). The fix is also more than a row: a match that spans rows would be spliced
  into one mark, which joins the drawer's rows (the drawer's one-column mark exists so no row moves), and in rows mode a
  shape that ends at its row's end runs on into the next indented row. Follow-up: add `PEM_PRIVATE_KEY_SOURCE` to
  `CREDENTIAL_MASKS` (by import, not a copy), add the BEGIN line's dashes to `SHAPE_HINT`, split a match at each row break
  so every row is masked on its own, and take no run-on after a match that already spans rows.
- **`pgp-block-residual`** — The PEM rule keeps history's bytes, not Gitleaks's `private-key` rule. Changing it changes every history
  index text (a `BELT_VERSION` bump and a reindex, the history programme's), so a PGP private key block (its BEGIN
  line names `PGP PRIVATE KEY BLOCK`) stays unmasked in every profile and is listed as a residual. Follow-up for the
  history programme if it wants Gitleaks's `(?: BLOCK)?`.
- A token straight after a JSON-escaped `\n` or an ANSI colour code is missed by every known-token row in
  `linear-egress` (review F4; it predates this change, Gitleaks has the same gap). The coordinator files it with
  `response-masks-miss-pem`.

## Verification

- Red first: `server/test/redact-gitleaks-rows.test.ts`, 20 of 47 cases red on `main`'s redactor, every near miss
  green; 47 of 47 green after.
- Mutation, by hand from a saved copy of `shared/redact.mjs` (the coordinator's mutation runner is for Python modules):
  13 mutants (each row deleted, the Mailgun fences removed one at a time, the `ya29.` row allowed to take a trailing
  full stop, `pem-block` taken out of each profile), all 13 killed, the file restored byte for byte.
- Fix round 1 (review 2693): red first, 13 of 72 cases red before the change, 75 of 75 green after. 13 more mutants,
  one per new fence and per part of the bounded PEM rule (the SendGrid fence; the fixed-length fence; `PQ-`; the old
  `ya29.` lookahead; the egress rule swapped for history's; no same-line part; no stop at the next BEGIN line; no
  header fields; no closing-quote end; no END line; no escaped line breaks; no blank lines inside the body; no indent
  before the END line), all 13 killed (the same-line part and the next-BEGIN stop after one more case each: a
  space-joined block, and 8000 headers on one line), the file restored byte for byte.
- Suites: the redaction suites (`redact`, `redact-profiles`, `redact-gitleaks-rows`, `history-redact-profiles`,
  `docs-parity`, `docs-shared`, `redact-cli`), `single-definition/*`, `late-census`, `linear-ops`,
  `linear-proxy-routes`, `unprintable-characterization`, `growth-check`, `anchors`, `citations`, `ownership` and
  `consolidation-census`. The fleet test slice's memory cap killed `roster-bash` and `history-lib` on every local
  attempt (other sessions' runs share the cap); CI's runs are the arbiter for those two.
