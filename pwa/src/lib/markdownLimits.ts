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
/** The longest line, in characters, a code block may hold and still be highlighted (W5 bound r10, the operator's
 *  ruling of 2026-10-14); a line ends at `\n` or `\r`. Measured on highlight.js 11.11.1 (Node 24, a loaded box:
 *  load average about 30), `hljs.highlight(..., {ignoreIllegals: true})` over 64 KiB filled with one repeated
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
 *  one registered-language fence over this value (a line of 2 927 characters) among 17 384. */
export const MD_HIGHLIGHT_MAX_LINE_CHARS = 2048;
/** The longest inline code span that can be a keystroke chord (W5 bound r11); a longer one is plain inline code,
 *  never trimmed or split. The longest chord of named keys is about 40 characters. */
export const MD_KEYSTROKE_MAX_CHARS = 64;
