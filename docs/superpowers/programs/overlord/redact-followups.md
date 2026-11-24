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
  - **The scanner's walk, with two differences.** `shared/redact.mjs#pemStreamSpans` is the same finder over one text
    of a stream (the scanner's walk, shared, not copied): a carried block runs on from the text's start through its END
    line, or with none to the first blank line. The line a text ends in is never taken as blank, even when it is so
    far, since the next chunk may go on with it. It differs from the scanner on one whole text in two places (review
    2751 F4, cased in `redact-followups.test.ts`):
    - it releases 64 KB after its BEGIN line even with no blank line, where the scanner's walk to a blank line has no
      limit, so a BEGIN mention with no blank line after it masks the next 64 KB of a stream and then stops;
    - it stops at the next BEGIN line, which starts a block of its own, so the prose after that block's END line shows,
      where the scanner's walk of a first block with no END line runs on through the second BEGIN line to the first
      blank line.
  - **A cut line is read whole** (review 2751 F2, fix round 2). The carry keeps the unfinished last line the drawer
    sent (raw, at most its last 4 KB, a bound that only caps the work), and `shapes.ts#pemCarrySpans` reads each text
    after it, so a BEGIN or END line a chunk boundary cut is read whole, however long its label or the escapes in it (a
    link, a colour per character). Round 1 read only the last 256 raw characters of the masker's 1 KiB context.
  - **Read as drawn** (review 2751 F1, fix round 2). The carry looks for a BEGIN line in the text with its escapes
    stripped, so a key a highlighter colours character by character is found. Round 1's pre-check read the raw text,
    and such a key's rows showed from about the eighth.
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
- **A blank line inside a streamed block ends it** (review 2751 F3, accepted by the coordinator). A legacy encrypted key's
  `Proc-Type` and `DEK-Info` headers are followed by a blank line. Streamed in chunks, the base64 after that blank line
  shows, as it does for a truncated block in a single answer (by design in the finder). In a single answer with its END
  line, the whole block is masked. The case this residual covers is that encrypted-key header: the rows it lets show
  are the ciphertext of a passphrase-protected legacy key, and the egress scanner stops at the same blank line when no
  END line is in view.
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

### Fix round 1 (review 2729)

- Red first: 10 new drawer cases red before the drawer carry, every one because key rows were drawn (7 to 840 rows of
  a key). They cover the review's 50-row key at one line per chunk and at 7, 256, 1000, 1024 and 2048-character chunks,
  an unclosed key with the prose after its blank line, an END line a chunk cuts, CR LF rows, and the 64 KB window
  releasing. Two more drawer cases and four direct `pemStreamSpans` cases came from two mutants that first survived
  (below). `redact-followups` is 201 of 201 green.
- F2: `SHAPE_MASK.maskDeep`, best of 5, at load about 11:

  | Input | Round 1's tip | After |
  |---|---|---|
  | JSON-escaped empty blocks, 1 MB | 409.2 ms | 14.4 ms |
  | JSON-escaped empty blocks, 2 MB | 1573.7 ms | 28.2 ms |
  | JSON-escaped closed blocks, 1 MB | 136.1 ms | 5.4 ms |
  | JSON-escaped closed blocks, 2 MB | 556.8 ms | 11.4 ms |

  A case pins 2 MB at less than 9 times 512 KB (linear is about 4; the old search was about 16).
- Mutation, from saved copies, each file restored byte for byte. All 22 mutants were killed:
  - 12 in the carry and the cursor. Two of them first survived: the old line-start offset (a stream whose first chunk
    cuts the BEGIN line, which is now a case) and a line start always false (only a caller with no text before reads
    it, so it now has direct `pemStreamSpans` cases).
  - 7 more of round 1's row mutants, against the new cursor. One of them, the row break dropped from the walk, now
    loops for ever on the same break: the suite never passes, and the run was stopped after 180 s.
- Suites, one file at a time through `ccrc test`, all green:
  - `redact`, `redact-profiles` (its export-list pin gains `pemStreamSpans`), `redact-gitleaks-rows`,
    `history-redact-profiles`, `docs-parity`, `docs-shared`, `redact-cli` and `redact-followups`;
  - `secret-mask`, `drawer-mask-rows`, `drawer-mask-screen`, `push-masker-pin` and `unprintable-characterization`;
  - `linear-ops`, `linear-proxy-routes`, every `single-definition/*` file, `anchors`, `citations`, `growth-check`,
    `ownership`, `consolidation-census`, `deviation-refs` and `topology-clean`;
  - the server typecheck.
  - The slice's memory cap killed `drawer-mask-rows` and `deviation-refs` once each, and both were green on a re-run.
  - `secret-mask`'s "typed slowly" case timed out once at its 20 s default at load 11. At load 6 it takes 21.0 s on
    `main`'s sources and 21.4 s on these, and the whole file is green with a 120 s timeout.
- The masker round that holds `mask.ts` (#3031) asked for its suites to be run: `mask-break-grammar` (4), `drawer-mask-rows`
  (51), `drawer-mask-screen` (13), `secret-mask` (96) and `redact-followups` (201), all green on a merge of the two
  branches (clean, no conflict), with `secret-mask`, `drawer-mask-rows` and `drawer-mask-screen` green on this branch too.

### Fix round 2 (review 2751, the last)

- Red first: 6 new drawer cases were red before the change, every one because key rows were drawn. A key coloured per
  character in 24-bit and 8-bit colour, its BEGIN line cut by a chunk and whole, showed 28 to 39 of 40 rows. A BEGIN
  line with a 300-character label, cut by a chunk, showed 29 rows, and one with an OSC 8 link around its label showed 34.
- One more case pins the stop at the next BEGIN line, both where that line starts a row and where it starts mid-row.
  Only the mid-row case reaches the clamp the review's surviving mutant removed, so that mutant is now killed. The case
  also pins the scanner's other answer on the same whole text.
- Two more cases came from two mutants of the carry's own bookkeeping that first survived. One pins the 64 KB window
  when chunks cut the rows, since the line a chunk ends in is read again and must not be spent twice. The other pins a
  kept line cut at 4 KB, whose start is unknown, so it is never taken as blank.
- Mutation, from saved copies, each file restored byte for byte: 6 mutants, all killed, two after the cases above.
  - the pre-check reading the raw text;
  - the line kept to 256 raw characters;
  - no line carried;
  - the next-BEGIN clamp removed (the review's M1);
  - a carried line always taken from its start;
  - the line not counted in the window.
- Suites, one file at a time through `ccrc test`, all green:
  - the redaction suites, with `redact-followups` at 210;
  - `drawer-mask-rows` (43), `drawer-mask-screen` (13), `secret-mask` (96, with a 120 s timeout), `push-masker-pin`
    and `unprintable-characterization`;
  - `linear-ops`, `linear-proxy-routes` and every `single-definition/*` file;
  - the server typecheck.
