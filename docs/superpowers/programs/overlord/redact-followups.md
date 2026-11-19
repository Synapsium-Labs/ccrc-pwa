# Two redaction follow-ups left by wave 163 — task note

Programme `overlord` (#2491), wave 168, run 2718. A small PR off `main`, after #3052 (wave 163, task note
`redact-gitleaks-rows.md` beside this one), which left both items open.

## What shipped

- **The response masks mask a PEM private-key block** (`response-masks-miss-pem`). `server/src/accounts/shapes.ts`'s
  `shapeSpans`, which every response mask reads (`SHAPE_MASK.maskDeep`, the keyless and keyed `SecretMasker`, the
  drawer), now adds every block that `shared/redact.mjs#pemBlockSpans` finds. That finder is the egress profiles'
  `pem-block` scanner, taken out of `maskPemBlocks` as a function of its own: `pem-block` masks each block as one mark,
  as before, and the response masks read the same spans. So there is one finder and no second spelling of the block
  (a guard in `single-definition/late-census.test.ts` pins both).
  - **Not a `CREDENTIAL_MASKS` row.** The finder is a scanner, not a regular-expression source, and `shared/api.ts` is
    L0 and imports nothing, so it cannot read the scanner. `shapes.ts` reads it beside `CREDENTIAL_MASKS` instead, and
    its header says so. `shared/api.ts` is not touched.
  - **Split per row.** Each block is masked row by row (`pemRowSpans`): split at every row break, which is kept, and
    each row less its indent, a box's left and right rules and its trailing blanks. `spliceMasked` joins only spans
    that touch, so no row of a block is joined to the next, and in the drawer every row holds its own one-column mark,
    so no row moves.
  - **No run-on.** A block's rows are its own. Nothing runs on past its end, so the row after its END line is never
    read as a wrap.
  - **Text as drawn only.** The blocks are read in the text as drawn, in both views (escapes stripped, and escapes as
    one NUL). They are never read in the joined text, where a wrapped key's rows are glued together.
  - `SHAPE_HINT` gains the BEGIN line's dashes (`-----BEGIN `), so a text with a block and no other shape is read at
    all.
  - **One cursor over the row breaks** (review 2729 F2, fix round 1). `pemRowSpans` reads a text's row breaks with one
    forward-only cursor for all its blocks. Each block used to search on to the next row break, which in a JSON answer
    (every line break escaped) was the end of the text, so many blocks cost the square of the text's length.
- **A key streamed through the drawer stays masked to its END line** (review 2729 F1, fix round 1, the coordinator's
  ruling). The masker reads each chunk with 1 KiB of the text before it as context, and an ordinary RSA key is 1.7 to
  3.2 KB, so the review measured up to 34 of a 50-row key's rows drawn once its BEGIN line had left that context.
  - **The state is the drawer's own.** `DrawerMask` (`server/src/accounts/mask.ts`) keeps the block the text it sent
    last ended inside (`pem`, beside its other per-stream carries). It is no new store, and it only adds spans to the
    ones the masker reads (`ahead`), so it can only mask more.
  - **The bounds are the scanner's.** `shared/redact.mjs#pemStreamSpans` is the same finder over one text of a stream
    (the scanner's walk, shared, not copied): a carried block runs on from the text's start through its END line, or
    with none to the first blank line, never past 64 KB after its BEGIN line, and never into the next BEGIN line. The
    line a text ends in is never taken as blank, even when it is so far, since the next chunk may go on with it.
  - **A cut line is read whole.** `shapes.ts#pemCarrySpans` reads the carried block from the last line start in the
    text already sent (at most 256 characters of it), so an END or BEGIN line a chunk boundary cut is read whole, and the
    rows are split as in a single answer.
- **A known token right after an escaped line break or an ANSI code is masked** (review 2693's F4, which predates
  #3052). Each row group of `KNOWN_TOKEN_PREFIX` used to start with a lookbehind that read the `n` of a JSON-escaped
  `\n` and the `m` of an ANSI colour code as word characters, so every row missed such a token in `linear-egress`,
  which has no segment rule behind it. Each group's left edge is now its old lookbehind or `TOKEN_LEFT_ESCAPE`: a
  JSON-escaped `\n`, `\r` or `\t`, or an ANSI CSI sequence, raw (`ESC [`) or JSON-escaped (`\u001b[`). The CSI's two
  classes are disjoint, so each lookbehind reads back over one run of each at most. The redactor's existing timing
  pin (about 6 MB in eight hostile shapes, both profiles) stays green.
  - `egress` gains too. Its segment rule masked such a token together with the `n` or `m` before it (`line\[REDACTED]`);
    the row now masks the token alone, and the escape is kept.
- History's PEM rule, `PEM_PRIVATE_KEY_SOURCE`, is byte for byte unchanged, so no history index text changes and no
  reindex is needed.

## Deviations found

Named by slug. The allocator issued the number to this programme, and the wave-done mail carries it. It is written
here once a plan that defines it is on `main`.

- **`response-masks-miss-pem`** — defined in `redact-gitleaks-rows.md` and fixed here, as that note's follow-up laid
  out. One departure from that layout: the follow-up said to add `PEM_PRIVATE_KEY_SOURCE` to `CREDENTIAL_MASKS`. The
  brief said to reuse the egress scanner instead, so there is one owner. History's rule masks a block with no END line
  to the end of the text, which would hide the rest of a server answer, so it is not reused. `shared/api.ts` cannot
  import the scanner either (L0), so the scanner is read in `shapes.ts`.

## Residuals

- **The first characters of a BEGIN or END line a chunk cuts.** The drawer draws a chunk's text before the line is
  whole, so the start of the label (`-----BEGIN RSA PR`) can show. It is no key material, and every row after it is
  masked.
- **A blank line inside a streamed block ends it.** A legacy encrypted key's `Proc-Type` and `DEK-Info` headers are
  followed by a blank line. Streamed in chunks, the base64 after that blank line shows, as it does for a truncated
  block in a single answer (by design in the finder). In a single answer with its END line, the whole block is masked.
- **The finder's spelling limits now reach server answers** (review 2729 F4, as egress already had them; none is
  fixed here):
  - a tab or a non-breaking space after `BEGIN`;
  - a lowercase label;
  - escaped dashes (`\u002d`);
  - a cursor-forward escape drawn in place of the space after `BEGIN`.
- **The `docs` profile** still reads no PEM block (unchanged, as in #3052's table).
- **A PGP private key block** stays unmasked in every profile and in the response masks (`pgp-block-residual`,
  #3052's note).
- **Escapes other than these.** `TOKEN_LEFT_ESCAPE` covers JSON's `\n`, `\r` and `\t`, and an ANSI CSI. A token after
  another escape (`\uXXXX` for a letter, `\xXX`, a percent-escape) is still missed by the rows in `linear-egress`. The
  response masks' `BOUNDARY` (`shapes.ts`) reads those, but it is a different reader with its own shapes, so it is
  not shared here.

## Verification

- Red first: `server/test/redact-followups.test.ts`, 181 of 183 cases red on `main`. The 2 green ones are near misses
  that must stay readable: a token glued to a word, or to an `n` or `m` that ends no escape. All 183 are green after.
  The cases cover one token per row family of `KNOWN_TOKEN_PREFIX` (`ghp_` and `gho_` among them, and the generic
  `sk-` shape) after six leads in `linear-egress`, and after an escaped line feed in `egress`. For the PEM block they
  cover a server answer through `SHAPE_MASK.maskDeep`: a closed block, an unclosed one, a JSON-escaped one with and
  without an END line, CR LF rows, nested strings and prose kept on both sides. They also cover the keyless masker in
  both modes, and the drawer's one-column mark row by row: box rules kept, no run-on, and colour codes.
- Mutation, by hand from saved copies of `shared/redact.mjs` and `server/src/accounts/shapes.ts` (the coordinator's
  runner is for Python modules): 13 mutants, all killed. Six in the lookbehind: the escape boundary off each row group,
  no escaped `\n`/`\r`/`\t` arm, no raw ESC arm, no JSON-escaped ESC arm, and no CSI parameters. Seven in the response
  masks: no PEM spans, a block not split per row, PEM read in the joined pass only, no BEGIN hint, no indent skip, no
  trailing trim, and the row break dropped from the walk. Two more on the one-finder guard (a second spelling in
  `shapes.ts`, and `maskPemBlocks` with its own walk) were both killed. Every file was restored byte for byte.
- Suites, one file at a time through `ccrc test`, all green: `redact`, `redact-profiles` (its export-list pin gains
  `pemBlockSpans`), `redact-gitleaks-rows`, `history-redact-profiles`, `docs-parity`, `docs-shared`, `redact-cli`,
  `redact-followups`, `secret-mask`, `drawer-mask-rows`, `drawer-mask-screen`, `push-masker-pin`,
  `unprintable-characterization`, `linear-ops`, `linear-proxy-routes`, every `single-definition/*` file, `anchors`,
  `citations`, `growth-check`, `ownership`, `consolidation-census` and `deviation-refs`. The server typecheck is green.
  - The slice's memory cap (other sessions' runs share it) killed `secret-mask` and `drawer-mask-rows` on their first
    attempts. Both were green on a re-run.
  - `secret-mask`'s "typed slowly" case timed out once, at load 9. It times out on the original sources too, alone at
    the same load: 24.1 s there against 21.8 s with this change. So it is load, not this change, and it was green on
    the re-run.
