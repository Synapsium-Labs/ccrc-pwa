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
  arm from it, flags `g`), so no history index text changes. The egress profiles run `pem-block`, a small linear
  scanner (`maskPemBlocks`; reviews 2693 F1 and 2704 F1 and F2, the coordinator's rulings). It is legitimately
  different from history's rule, since egress text is shown rather than stored, and it is a scanner, not a second
  redactor: one step of the same table, written as a function because no single regular expression walks lines
  without recursing once per line (the regex it replaces overflowed the stack at about 1.3 million short lines). From
  each BEGIN line it masks through the first END line within 64 KB, unless another BEGIN line comes first, whatever
  the lines between look like: a prefix (`> `, `# `, `// `, `| `), a quote, a trailing space, CR CR LF, string
  concatenation, a JSON-escaped or space-joined block. With no such END line it masks the rest of the BEGIN line and
  every line after it up to the first blank line, whatever its shape, and keeps the blank line and what follows. A
  line ends at a line feed or JSON's escaped `\n`; a blank line holds only spaces, tabs and carriage returns, raw or
  escaped.
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
| `egress` (approval rows, mail, digests) | yes | unmasked; only body segments of 32+ characters between `/` were masked | masked (`pem-block`, the scanner) |
| `linear-egress` (text sent to Linear) | yes | unmasked | masked (`pem-block`, the scanner) |
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
## Accepted costs (review 2704 F3 and F4, the coordinator's ruling)

- **A glued over-long run in `linear-egress`.** The fixed-length rows are fenced at the end, so a real token glued to
  more characters (`dop_v1_<64 hex>a`, `SG.<22>.<43>Z`) is not read as a row, and `linear-egress` has no segment rule
  to mask the run. Such a run is never a real token's length; `egress` masks it through the segment rule.
- **Over-masking.** A dotted name after `ya29.` with 20 or more characters (`ya29.something_long_filename.txt`) is masked
  whole, and with no END line every line before the first blank line is masked, prose included. Both fail safe.

## Follow-ups

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
- Fix round 2 (review 2704): red first, 21 of 91 cases red before the scanner, 91 of 91 green after (one more case
  added during the round: a JSON-escaped CR LF block with no END line). 13 mutants, one per arm of the scanner (the END
  arm; the 64 KB window; the next-BEGIN check; the line walk; the blank-line stop; escaped line ends; the raw and the
  escaped carriage-return trim; the blank line's escaped `\r`, tab and carriage return; `pem-block` out of each
  profile), all 13 killed, the file restored byte for byte.
- Timing (review 2704 F2), whole `redact`, best of 3, on hostile input in 14 shapes (short, blank, CR LF blank and
  escaped lines; headers on one line and one per line; END near misses; END lines alone; an END past the window;
  alternating blocks; a chain of unclosed blocks; 64-column lines; `PRIVATE KEY` words with no header), both profiles,
  at load 10.5: worst 57.6 ms at 1 MB and 631.8 ms at 10 MB (both CR LF blank lines through `egress`, whose other rules
  cost that: `linear-egress` takes 3.1 ms and 29.1 ms on the same input), about 11 times for 10 times the input. No
  shape threw. The scanner's own worst, a chain of unclosed blocks, took 14.4 ms and 149.5 ms. A test pins no throw and
  no super-linear time on eight shapes of about 6 MB in both profiles.
- Suites: the redaction suites (`redact`, `redact-profiles`, `redact-gitleaks-rows`, `history-redact-profiles`,
  `docs-parity`, `docs-shared`, `redact-cli`), `single-definition/*`, `late-census`, `linear-ops`,
  `linear-proxy-routes`, `unprintable-characterization`, `growth-check`, `anchors`, `citations`, `ownership` and
  `consolidation-census`. The fleet test slice's memory cap killed `roster-bash` and `history-lib` on every local
  attempt (other sessions' runs share the cap); CI's runs are the arbiter for those two.
