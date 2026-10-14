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
 *  (`a a a`: 166, 173, 202, 307 ms and one 64 KiB line about 3 s). Every other grammar's worst shape sits on a
 *  plateau of about 100 to 370 ms that no line length changes (`javascript` on `(` 250 to 300 ms at every length).
 *  At this value the worst line-driven shape (`markdown` on `[`, 245 to 263 ms) costs what that plateau costs, 64 KiB
 *  of ordinary code costs 43 to 81 ms in the slowest grammar (`typescript`, `json`), and 4 096 would cost twice the
 *  plateau (451 to 483 ms). The strict reading, a worst case no dearer than ordinary code, has no value for `yaml`
 *  (166 ms at 512) and would need 512 or 1 024, which would leave 163 or 30 real fences plain. The docs corpus holds
 *  one registered-language fence over this value (a line of 2 927 characters) among 17 384. That sweep put ONE unit on
 *  each line; whitespace that spans lines is a different shape, bounded by `MD_HIGHLIGHT_MAX_BLANK_CHARS`. */
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
 *  under 400 ms on every shape, `a\n` and `(\n` units included), and a run costs only when it holds a line terminator (`\n`, `\r`,
 *  U+2028, U+2029): 64 KiB of spaces or tabs alone costs 1 ms. A scan of every code unit from 0 to 0xFFFF, each
 *  alternated with `\n`, found exactly the `\s` set above and no other unit that joins a run. A 64 KiB block of runs
 *  of L blank units, each ended by one letter, costs about N x L x c, so the bound caps L. Worst grammar and
 *  separator, `\n` / U+2028 or U+2029 (each alternated with `\n`, the costliest shape that reaches this bound) in ms: 512: 37-43 / 66-80; 1 024: 77-82 / 129-200; 2 048: 146-192 / 268-333;
 *  4 096: 301-317 / 576-766; 8 192: 562-676 / 1 088-1 334; 16 384: 1 215-1 302 / 2 833-3 759. The length-independent
 *  plateau that the other bounds leave sits at about 230 to 290 ms on this box now (`typescript` 284, `javascript`
 *  261, `markdown` 270, `yaml` 277). At this value the worst blank run that reaches this bound (U+2028 alternated
 *  with `\n`, 209 to 333 ms) costs what that plateau costs, a `\n` run about two thirds of it, and 4 096 would cost twice the plateau; 64 KiB of ordinary code costs 62 ms in
 *  `typescript` and 28 ms in `javascript`. The strict reading, a worst case no dearer than ordinary code, would need
 *  512 or less. Real fences need none of that room: the longest blank run in any registered-language fence of
 *  `docs/superpowers` and in chat's corpus is 104 characters, so this value leaves no real fence plain (a dated snapshot,
 *  2026-10-14). */
export const MD_HIGHLIGHT_MAX_BLANK_CHARS = 2048;
/** The longest code block, in characters, that is highlighted in `typescript` or `javascript` (every alias highlight.js
 *  resolves to them) and in any grammar whose sub-language chain reaches them (none today: `xml` is registered
 *  without its script and style sub-languages; `HIGHLIGHT_BOUNDED_CAPS` in `markdown.tsx` derives the set from the
 *  registered grammars), smaller than `MD_HIGHLIGHT_BLOCK_MAX_CHARS` because those grammars grow with the square of a
 *  block's size on `<a>` shapes (JSX closing-tag scans) that pass the word, line and whitespace bounds (D-4928). */
export const MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS = 8192;
/** The longest code block, in characters, that is highlighted in `rust` (and its aliases, and any grammar that embeds
 *  it: none today), smaller than
 *  `MD_HIGHLIGHT_BLOCK_MAX_CHARS` because an unclosed raw string `r#"` makes that grammar grow with the square of
 *  a block's size (D-4928). */
export const MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS = 4096;
/** The most code, in characters, of `typescript`, `javascript` and `rust` blocks together that a Docs page highlights,
 *  and of any grammar whose sub-language chain reaches them (none today: `xml` is registered without its script and
 *  style sub-languages): `detachUrls` sums it beside `DOCS_HIGHLIGHT_PAGE_MAX_CHARS` and refuses those grammars from the
 *  block that passes it, while a block of another grammar is never refused by it (D-4928). */
export const DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS = 393216;
/** The longest inline code span that can be a keystroke chord (W5 bound r11); a longer one is plain inline code,
 *  never trimmed or split. The longest chord of named keys is about 40 characters. */
export const MD_KEYSTROKE_MAX_CHARS = 64;
