// Every PWA render limit, declared once (native Docs reader, W4 Task 3; design 2026-10-01 section 4.9's table).
// Chat and the Docs screen import them and tests import them; nothing restates a value. `markdown-limits.test.ts`
// pins each value and holds each name to this one declaration across `pwa/src` and `shared`.
// `DOCS_MAX_IMAGES_PER_PAGE` and `DOCS_STALE_MS` live in `shared/docs.ts`, never here.
//
// Imports nothing: the parse worker's closure reaches this file (`markdown-purity.test.ts`).

/** Container markers (`>`, list markers and a footnote definition's `[^label]:`, Task 11's review 2-1) on one
 *  line; real docs and chat reach 2. */
export const MD_MAX_CONTAINER_DEPTH = 32;
/** The longest run of `*` or of `_`; real docs reach 3. */
export const MD_MAX_DELIMITER_RUN = 64;
/** Nodes on the deepest path of a parsed hast tree, below the root; real docs reach 9. */
export const MD_MAX_TREE_DEPTH = 64;
/** Element nodes in a parsed hast tree, both profiles. */
export const DOCS_MAX_RENDER_ELEMENTS = 20000;
/** One code block's characters, at most, that highlight.js is asked to colour. */
export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536;
/** Code characters per Docs page, at most, that highlight.js is asked to colour. */
export const DOCS_HIGHLIGHT_PAGE_MAX_CHARS = 524288;
/** The Docs parse budget for a document of `bytes` UTF-8 bytes: 2 s under 64 KiB, one more second per 64 KiB,
 *  at most 10 s. */
export const DOCS_PARSE_BUDGET_MS = (bytes: number): number => Math.min(10000, 2000 + 1000 * Math.floor(bytes / 65536));
/** The Docs parse budget after "Format anyway". */
export const DOCS_PARSE_BUDGET_LARGE_MS = 30000;
/** A Docs page over this many UTF-8 bytes asks before it formats. */
export const DOCS_RENDER_GATE_BYTES = 524288;
/** A chat message of at most this many UTF-8 bytes renders on the main thread; a longer one parses in the worker. */
export const CHAT_SYNC_MAX_BYTES = 4096;
/** The worker budget for one chat message. */
export const CHAT_PARSE_BUDGET_MS = 2000;
/** The longest run of word units a code block may hold and still be highlighted (W5 bound r10); a word unit is a
 *  UTF-16 code unit in `[A-Za-z0-9_$]` or at `0x7f` or above (highlight.js's PHP grammar takes `\x7f-\xff` as
 *  identifier characters; the class fails closed). One longer run costs highlight.js the square of its length in
 *  `typescript`, `javascript`, `rust`, `bash` and `php` (64 KiB of `_é` in `php` costs about 38 s); at this length a
 *  block's worst case costs what ordinary code of its size costs, so the per-page cap keeps bounding the page. */
export const MD_HIGHLIGHT_MAX_WORD_CHARS = 256;
/** The longest line, in characters, a code block may hold and still be highlighted (the line bound, its own bound
 *  beside r10: the operator's ruling of 2026-10-14); a line ends at `\n` or `\r`. Measured on highlight.js 11.11.1
 *  (Node 24, a loaded box: load average about 30), `hljs.highlight(..., {ignoreIllegals: true})` over 64 KiB filled with one repeated
 *  short unit per line, every registered grammar, 474 units of one and two characters, with and without spaces,
 *  at 4 096 characters a line, then the worst of them at 512 to 16 384 (minimum of 3 to 7 runs). Only two families
 *  grow with the length of a line: `markdown` on runs of `[` (`[`, `[[`, `![`, `[a`, `a[`: 79 ms at 512, 120 at
 *  1 024, 245 at 2 048, 451 at 4 096, 1 772 at 16 384, and one 64 KiB line of `[` 9.6 s) and `yaml` on `x ` units
 *  (`a a a`: 166, 173, 202, 307 ms and one 64 KiB line about 3 s). Over the units that sweep tried, every other
 *  grammar's worst shape sat on a plateau of about 100 to 370 ms that no line length changed (`javascript` on `(` 250 to 300 ms at every length).
 *  At this value the worst line-driven shape (`markdown` on `[`, 245 to 263 ms) costs what that plateau costs, 64 KiB
 *  of ordinary code costs 43 to 81 ms in the slowest grammar (`typescript`, `json`), and 4 096 would cost twice the
 *  plateau (451 to 483 ms). The strict reading, a worst case no dearer than ordinary code, has no value for `yaml`
 *  (166 ms at 512) and would need 512 or 1 024, which would leave 163 or 30 real fences plain. On 2026-10-14, at
 *  this wave's tip, `docs/superpowers` held three registered-language fences over this value among 17 657 (lines of
 *  2 927, 5 041 and 2 843 characters; the last two are this wave's own plan's `json` rows blocks), chat's corpus none.
 *  That sweep put ONE unit on each line; whitespace that spans lines is a different shape, bounded by
 *  `MD_HIGHLIGHT_MAX_BLANK_CHARS`, and multi-character units that make a grammar scan forward are another, bounded by
 *  the per-grammar caps and page budgets below (review 450 F1). */
export const MD_HIGHLIGHT_MAX_LINE_CHARS = 2048;
/** The longest run of blank units a code block may hold and still be highlighted (the whitespace bound, review 439
 *  F1, a fifth bound beside the size, word and line bounds); a blank unit is a UTF-16 code unit of ECMAScript's `\s`:
 *  U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. The
 *  run crosses line breaks, so `\n`, ` \n`, `\t\n` and `\r\n` repeated are one run. Measured on highlight.js 11.11.1
 *  (Node 24, a loaded box: load average 20 to 40), `hljs.highlight(..., {ignoreIllegals: true})`, every registered
 *  grammar (15) over 28 shapes (pure whitespace runs of 11 kinds, and 17 short units followed by a line break) in
 *  blocks of 4 096, 16 384 and 65 536 characters, minimum of 3 runs. Only `typescript` and `javascript` grow with the
 *  length of a blank run (64 KiB of `\n`: 5.2 and 6.3 s; of U+2028: 9.8 to 10.9 s, though a U+2028 or U+2029 run longer than 256
 *  never reaches this bound: those units are word units to r10, which refuses it first; the other 13 grammars stay
 *  under 400 ms on every one of those 28 shapes, `a\n` and `(\n` units included), and a run costs only when it holds a line terminator (`\n`, `\r`,
 *  U+2028, U+2029): 64 KiB of spaces or tabs alone costs 1 ms. A scan of every code unit from 0 to 0xFFFF, each
 *  alternated with `\n`, found exactly the `\s` set above and no other unit that joins a run. A 64 KiB block of runs
 *  of L blank units, each ended by one letter, costs about N x L x c, so the bound caps L. Worst grammar and
 *  separator, `\n` / U+2028 or U+2029 (each alternated with `\n`, the costliest shape that reaches this bound) in ms: 512: 37-43 / 66-80; 1 024: 77-82 / 129-200; 2 048: 146-192 / 225-336 (re-measured 2026-10-14 at load
 *  about 31, three repetitions);
 *  4 096: 301-317 / 576-766; 8 192: 562-676 / 1 088-1 334; 16 384: 1 215-1 302 / 2 833-3 759. The plateau of shapes
 *  whose cost no length changes sat at about 230 to 290 ms per 64 KiB block on this box (`typescript` 284,
 *  `javascript` 261, `markdown` 270, `yaml` 277). At this value the worst blank run that reaches this bound (U+2028
 *  alternated with `\n`, 225 to 336 ms) costs about what that plateau costs, a `\n` run about two thirds of it, and 4 096 would cost twice the plateau; 64 KiB of ordinary code costs 62 ms in
 *  `typescript` and 28 ms in `javascript`. The strict reading, a worst case no dearer than ordinary code, would need
 *  512 or less. Real fences need none of that room: the longest blank run in any registered-language fence of
 *  `docs/superpowers` and in chat's corpus is 104 characters, so this value leaves no real fence plain (a dated snapshot,
 *  2026-10-14). What the bounds together leave is stated under `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`. */
export const MD_HIGHLIGHT_MAX_BLANK_CHARS = 2048;
/** The longest code block, in characters, that is highlighted in `typescript` or `javascript` (every alias highlight.js
 *  resolves to them) and in any grammar whose sub-language chain reaches them (none today: `xml` is registered
 *  without its script and style sub-languages; `HIGHLIGHT_BOUNDED_CAPS` in `markdown.tsx` derives the set from the
 *  registered grammars), smaller than `MD_HIGHLIGHT_BLOCK_MAX_CHARS` because those grammars grow with the square of a
 *  block's size on `<a>` shapes (JSX closing-tag scans) that pass the word, line and whitespace bounds (review 450 F1).
 *  Measured on highlight.js 11.11.1 (Node 24, load average 30 to 80): `'<a>'` repeated in lines of 1 800 characters
 *  costs, per KiB of block, 5.5 to 6.7 ms at 6 to 10 KiB, 10 at 16 KiB, 22 at 32 KiB and 43 at 64 KiB (2.8 s a block).
 *  The per-KiB cost rises with the block's size from the smallest size measured (review 460 F8 re-measured 5.63, 6.65
 *  and 7.97 ms a KiB at 6, 8 and 10 KiB and 9.89 at 16 KiB; this once said it was lowest near 8 KiB, which did not
 *  reproduce). This value and `DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS` are the operator's answer to ask 38; what a page of
 *  such blocks costs is stated under `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS`. Cost,
 *  measured through the Docs pipeline (each page parsed as Docs parses it, then `detachUrls`, `highlightBlockCap` and
 *  the word, line and whitespace scans; 2026-10-15, at this wave's tip): 736 real fences of `docs/superpowers` are
 *  plain, on 78 pages, of 8 508 `typescript`, `javascript` and `rust` fences the 64 KiB cap, the general page budget
 *  and the word, line and whitespace bounds highlighted (532 over this cap, 204 refused by the scan page budget alone). The one page Docs never formats
 *  (refused as too wide) is excluded; review 460 F7 found that the 755 on 79 pages recorded before, counted by fence
 *  pattern, included it, and that the 8 582 beside them counted `typescript` and `javascript` fences only. Chat's
 *  corpus holds one `ts` fence, of 12 characters. */
export const MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS = 8192;
/** The longest code block, in characters, that is highlighted in `rust` (and its aliases, and any grammar that embeds
 *  it: none today), smaller than
 *  `MD_HIGHLIGHT_BLOCK_MAX_CHARS` because an unclosed raw string `r#"` makes that grammar grow with the square of
 *  a block's size (review 450 F1): 75, 294, 728 and 3 791 ms at 8, 16, 32 and 64 KiB, 14 s at 128 KiB; 4.5 ms a KiB at
 *  4 KiB and 7 at 8 KiB, so the smaller cap keeps a page of it under the same budget. No real fence is `rust`. */
export const MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS = 4096;
/** The most code, in characters, of `typescript`, `javascript` and `rust` blocks together that a Docs page highlights,
 *  and of any grammar whose sub-language chain reaches them (none today: `xml` is registered without its script and
 *  style sub-languages): `detachUrls` sums it beside `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` and refuses those grammars from the
 *  block that passes it, while a block of another grammar is never refused by it (review 450 F1). */
export const DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS = 393216;
/** The most `markdown` code (every alias highlight.js resolves to it, `md` among them) in characters that a Docs page
 *  highlights: `detachUrls` sums it beside the other two and refuses a markdown block from the one that passes it,
 *  while a block of another grammar is never refused by it (review 450 F1). `markdown` hands every HTML tag to `xml`, a linear
 *  but high rate, so it has this budget of its own and stays out of the scan set. Measured interleaved (best of 7,
 *  load 57, 64 KiB blocks): `<a>` in lines 652 ms, `</a>` 452, `<a/>` 419, against 242 to 356 for the plateau shapes
 *  of `yaml`, `json`, `typescript` and `javascript`; growth linear from 8 to 128 KiB. The most markdown code on a page
 *  Docs formats is 24 056 characters, its largest markdown block 17 042 (review 460 F7: the 33 KiB recorded before
 *  was on the one page Docs refuses as too wide), so no real fence goes plain (the operator's answer to ask 41).
 *  WHAT THE BOUNDS LEAVE, measured end to end through `detachUrls` and `CodeBlock` on pages that fill each budget
 *  exactly with every block highlighted (2026-10-15: a block of 8 191 or 65 535 characters, as the budgets count the
 *  newline the parse keeps; review 460 F4 and F5 found the earlier pages one block short), each page beside a plateau
 *  page of eight 65 535-character `yaml` or `json` blocks timed in the same run (three interleaved rounds, best of 3,
 *  load 17 to 157): the plateau page 1.7 to 2.2 s; 48 blocks of `<a>` lines 2.3 to 3.1 s in `typescript` or
 *  `javascript`; the markdown budget's two blocks of `<a>` lines 0.78 to 0.94 s (`</a>` 0.60 to 0.75; the reviewer
 *  measured 1.0 to 1.5). Measured on 2026-10-14 and not re-measured: 96 blocks of 4 KiB of `r#"` in `rust` 1.5 s (95 of
 *  them highlighted, the same newline), and xml's `<script>` shapes, eight 64 KiB blocks, under 0.1 s. The three
 *  budgets are summed apart, so the accepted crafted page holds both the scan budget and the markdown budget (48
 *  `typescript` or `javascript` blocks and two `markdown` blocks): 3.2 to 3.5 s here and 3.75 to 4.37 s in the
 *  reviewer's three runs, 1.6 to 1.9 times the plateau page timed beside it, against spec 4.9's 0.25 s for a page; the
 *  coordinator accepted it as residue, and the shapes below cost more. The run here brackets the 3.4 s recorded
 *  before; what it moves is the ratio, because the plateau page beside it measured 1.7 to 2.2 s where it had
 *  measured 2.4 to 2.5, and only the reviewer's runs measured the page itself higher. Chat has no page budget: a
 *  message bounds each block (a 64 KiB markdown block of `<a>` lines about 650 ms, an 8 KiB `typescript` block about 75), never their
 *  sum. What the sweeps tried, as they were run (review 460 F6: this said "about 80 units of two to four
 *  characters", a size class the run did not cover): 474 units of one and two characters, one per line (the line
 *  bound); 28 shapes of whitespace across lines (the whitespace bound); every registered grammar over one fixed list
 *  of 77 units of one to four characters (the tags `<a>`, `<ab>`, `<a `, `</a>`, `<a/>`, `<!--`, `<?`, `?>` and `<%`;
 *  the doubled or reversed brackets `{{`, `}}`, `((`, `[[`, `)(` and `][`; string, comment, template and raw-string
 *  openers; and short operator and identifier units such as `a(`, `a<b`, `=>`, `::` and `0x`), plus up to ten two- or
 *  three-letter keywords of each grammar, each unit repeated alone in lines of 1 800 characters and one per line, at 16
 *  and 64 KiB, each one that grew confirmed on an 8 to 128 KiB curve; then, for the registered `xml` and `markdown`,
 *  90 units: that list less `<a>`, and 14 xml units, 12 of them longer than four characters (`<script>`, `<style>`,
 *  `<script><a>`, `<![CDATA[` and the like) and two of two characters (`<a` and `&#`);
 *  three-character tags in `markdown`; and the `subLanguage` embeddings (`xml`'s `<script>` and `<style>`, removed:
 *  see `markdown.tsx`; `markdown` into `xml`; `dockerfile` into `bash`, linear; `yaml` into `ruby`, not registered).
 *  NOT tried: the empty pairs `[]`, `{}` and `()` and the link opener `[](` (the shapes review 460 found growing,
 *  below), every other unit outside those lists whatever its size, lines of other lengths, mixtures of different
 *  units, nesting, and valid code shaped to defeat a grammar. Review 460's own sweep then tried `typescript`,
 *  `javascript` and `rust` over every two- and three-character unit drawn from `<>/(){}[]"'`, the backtick, `a` and the
 *  space, and about 250 longer units, finding nothing dearer than `<a>`, and ten more grammars over those units,
 *  finding them linear; `markdown` and `yaml` it found growing.
 *  SHAPES PAST EVERY BOUND (review 460 F1 to F3, the reviewer's figures: a block's cost on this highlight.js, best of
 *  3 at load about 25; a page's, end to end through `detachUrls` and `CodeBlock` in its cost lens; the 9 to 11 s for
 *  two markdown blocks is the per-block figure doubled): `markdown` on link openers, `'[]('` or `'[[]('` repeated in lines of 2 048 characters (quadratic in the line,
 *  linear in the block), about 0.5 s per 8 KiB block and 4.5 to 5.5 s per 64 KiB block, so the markdown budget
 *  admits about 9 to 11 s of it on one page; `yaml` flow collections, `[]` or `{}` repeated, quadratic in the block's
 *  size (about 1.1 to 1.4 s per 64 KiB block), only the general budget bounding a page of them (eight blocks about
 *  7.5 s); the worst combined page found, two such markdown blocks and six such yaml blocks, exactly the general
 *  budget with every block highlighted, 10.6 s. Chat has no page budget: one crafted markdown block about 4.5 s, one
 *  yaml block about 1.1 to 1.4 s. Real documents are unaffected: the most markdown code on a page Docs formats is
 *  24 056 characters, its largest markdown block 17 042. Four reviews in a row each found a shape the sweeps before
 *  them had not tried, so more crafted shapes probably exist. The operator ruled the remedy on 2026-10-15: a dedicated
 *  wave moves highlighting off the main thread, into the parse worker with a deadline, before part 2; part 1 adds no
 *  bound and no value for these shapes. */
export const DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS = 131072;
/** The longest inline code span that can be a keystroke chord (W5 bound r11); a longer one is plain inline code,
 *  never trimmed or split. The longest chord of named keys is about 40 characters. */
export const MD_KEYSTROKE_MAX_CHARS = 64;
