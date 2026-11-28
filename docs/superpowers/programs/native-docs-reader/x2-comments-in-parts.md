# Comments in parts, the conservative rule (wave 64), task note for the ledger

Run 4204, wave 64, the native Docs reader programme, on `main` at `3fd477ee57`. Ticket `x2-fu-comments-in-parts` (the rule, and
P1's own paths), issue #3645 (a timeout), ticket `x6-fu-record-precision` (review 4197's A1 to A3). The full record is the parity
plan's Results section "Follow-up wave, comments in parts (the conservative rule)" under Wave P6.1
(`docs/superpowers/plans/2026-11-18-native-docs-parity.md`); this note is what the ledger should learn.

## What shipped

- **The conservative rule** (the coordinator's ruling, call recorded): the block cutter never cuts inside a unit whose text holds
  a comment opener `<!--`. A top-level unit, a list item, a fence, a quote's own block and the text before the first block that
  alone is larger than a part and holds one is one part, whole, above the part size. Cuts between units stay: a list or a quote is
  still cut between its items. A top-level comment is still closed and reopened (`cutComment`) where it has room; where it has
  none it is whole too, never P1's, and the text after its closer line never starts a part of its own (no front matter).
- **P1's own paths**, measured against the rule: the unread tail, the console with no render job, and the whole-text fallback
  after a cutter failure. One small cure: a tail that starts at a closed top-level comment (where the blocks read stops when such a
  comment is longer than its cap) is a comment unit, closed and reopened, and the tail starts after it. The rest is left.
- **#3645**: the render job's blocks case has its own 30 s timeout, from its measured time.
- **x6-fu-record-precision**: the reader-mode plan's two record lines and the policy case's title and lines.

## Commits, in order

| Commit | Item |
|---|---|
| `d7c39bc28e` | item 3, #3645 |
| `2cbf2897b4` | item 4, `x6-fu-record-precision` |
| `3780c7a430` | item 1, the rule |
| `3731252157` | item 2, P1's paths measured, and the tail comment's cure |
| `18c4d38398` | the records: the parity plan and this note |
| `9f93bc0946` | the gate's lines in the Results |
| `66e9cacdcf` | the coordinator's rulings recorded (the fence, the plain-source Print, the dashes run) |
| `3a579d9dc8` | fix round 1, code: review 4221 F1 (a comment opened in a footnote definition), F2 (the no-opener tail pinned), A4 (the closer-line bound) |
| `29e5703136` | fix round 1, records: the Results "Fix round 1, review 4221", class 10's note, and this note |
| (this one) | fix round 2 (review 4228), tests and records: row W64-R1d corrected, the adjacent-definitions case, the left shape's first lines, the CRLF and lone-CR bound cases, the Results "Fix round 2, review 4228" |

## Choices inside the ruling, for the ledger

- **The rule reads the text, not the parse**: an opener in code, or one with no closer, keeps its unit whole too (a fence larger
  than a part with `<!--` in its code is one part, where it was closed and reopened). The most conservative reading of "holds".
- **The top-level comment keeps its own cut** (`cutComment`, close and reopen): it is a gap the library draws no block for, none of
  the units the ruling names, and that cut was reviewed in P6.1; where it has no room the unit is whole, never P1's.
- **The unread tail stays P1's**, and a unit that runs into it is read by the rule only up to it (review of item 1).
- The coordinator confirmed these three choices on 2026-11-28.
- **Print of a unit kept whole above the gate** (the coordinator's ruling, 2026-11-28: recorded, not built). From a unit above
  the render gate (524 288 bytes) that holds an opener, Print prints the plain source, so it shows every line of the comment where
  `main` showed P1's fragments. A plain-source view shows comments by definition: that is the gate's own answer for any text too
  large to render, and not the leak this wave closes, which is commented text in a rendered part.
- **The dashes run** (a run of blocks each starting with three dashes, joining the unit before it): recorded, not built. Only the
  text bounds it, so in practice the range ceiling (67 108 864 bytes) bounds it; above the gate it gets the gate's answer.

## What is left (class 10 after the rule)

- **A known leak on the block cutter** (fix round 1, review 4221 F1; ticket `x2-fu-footnote-item-block-start`, the
  coordinator's; older than wave 64): a named footnote definition whose first line draws no block (such as an empty one, a closed
  comment, a link reference definition, a `<details>`, `</details>` or `<summary>` line, or an unreferenced nested definition, the
  last measured by review 4228), then any block indented under it (a paragraph, a list, a quote), then an opener. "Named" means named
  in a window, a reference inside the hidden text included (the same shape; then the whole text in one window shows none). The tree
  starts the definition's block at its first drawn line, indented four columns, which is a cut candidate that a part starting there
  reads as code, and where a window's cap lands: every part size measured (400, 700, 2 000 bytes and the gate) shows the comment,
  with the whole text read in one window too. Pinned by the case "md parts footnote: KNOWN LEAK, …". The cure is the block's start
  (`renderTree.ts`), not a second cut rule in the cutter. Closed in the round: a comment opened on a definition's first line, or on
  a later indented line that holds only the opener (`    <!--`) where the definition draws no block before it.
- **For that ticket's wave, the window's bound** (review 4228 F1, measured there): the tip caps a window at the START of the last
  block before an opener it cannot cap at the holding block. The END of that block differs: on adjacent definitions it matches the
  whole read where the start does not (308 of 2 640 runs over 440 two-definition documents, neither showing hidden text; the start
  drops a definition's block when the next window lacks its reference, or reads its indented line as code), and on the known-leak
  form `    - <!--` it stops the read before the definition, so no part shows it, where the start shows all 40. It is not a drop-in
  either (other blocks on `See[^1].` then `[^1]: note`, an indented paragraph and the opener, at windows of 1 024 to 3 000 bytes).
  The case "md parts footnote: adjacent definitions, today's window bound …" pins today's start; which bound is better is that
  wave's to weigh, with the block's start cured.

- P1's own paths: the unread tail (cured only where it starts at a closed top-level comment), the whole-text fallback after the
  cutter throws (P1 alone), and the console with no render job, whose own view shows a comment as text whole or cut, so on screen
  the cut changes nothing; its Print renders P1's parts through the library, so a part there may print what the whole would hide
  (narrow: above 2 MiB, the plain view, the reader's whole cut not held).
- A part kept whole above the render gate gets the gate's answer (the reader's question, Format anyway or Show as text, in the
  console's own view, which shows a comment as text; the render job's `over-limit`; Print's plain text): what any Markdown above
  the gate gets.
- The largest whole part is a blocks window (`READER_BLOCKS_MAX_BYTES`), except a run of blocks that each start with three dashes,
  which joins the unit before it and can carry it past the window.

## Deviation numbers

The run was issued 9178 and 9179. Neither is defined; both are returned unused.
