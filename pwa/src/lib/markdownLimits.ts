// Every PWA render limit, declared once (native Docs reader, W4 Task 3; design 2026-10-01 section 4.9's table).
// Chat and the Docs screen import them and tests import them; nothing restates a value. `markdown-limits.test.ts`
// pins each value and holds each name to this one declaration across `pwa/src` and `shared`.
// `DOCS_MAX_IMAGES_PER_PAGE` and `DOCS_STALE_MS` live in `shared/docs.ts`, never here.
//
// Imports nothing: the parse worker's closure reaches this file (`markdown-purity.test.ts`).
// The highlight worker's closure reaches it too (W5h-a; `markdown-purity.test.ts`'s M4.H3 describe).

/** Container markers (`>`, list markers and a footnote definition's `[^label]:`, Task 11's review 2-1) on one
 *  line; real docs and chat reach 2. */
export const MD_MAX_CONTAINER_DEPTH = 32;
/** The longest run of `*` or of `_`; real docs reach 3. */
export const MD_MAX_DELIMITER_RUN = 64;
/** Nodes on the deepest path of a parsed hast tree, below the root; real docs reach 9. */
export const MD_MAX_TREE_DEPTH = 64;
/** Element nodes in a parsed hast tree, both profiles. */
export const DOCS_MAX_RENDER_ELEMENTS = 20000;
/** One code block's characters, at most, that the main thread posts to the highlight worker: it bounds the input one
 *  block clones across the worker boundary, and the main thread checks the length itself (base spec 4.9, re-argued by
 *  W5h-b); the worker's deadline, not this cap, bounds the time a block takes, whatever its shape. */
export const MD_HIGHLIGHT_BLOCK_MAX_CHARS = 65536;
/** Code characters per Docs page, at most, that the main thread admits to the highlight worker (a block is posted at
 *  most twice, the second time for its line retry), summed in document order with every drawn copy counted; a block
 *  past it is never posted and stays plain (base spec 4.9, re-argued by W5h-b). */
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
/** The longest inline code span that can be a keystroke chord (W5 bound r11); a longer one is plain inline code,
 *  never trimmed or split. The longest chord of named keys is about 40 characters. */
export const MD_KEYSTROKE_MAX_CHARS = 64;

// ---------------------------------------------------------------------------------------------------------------
// Highlighting off the main thread (base spec 2026-10-01 section 4.9's W5h rows and "Two more"; W5h-a, W5h-b). The
// first seven are MEASURED: R19 ran once on the operator's phone on 2026-11-03, against W5h-a's build, and W5h-b set
// each from R19 under its section 4.9 rule, except two departures the W5h-b plan numbers: the timeout count and the
// per-block HTML cap (the plan records the result). Every time is the main thread's clock, so
// it holds the main thread's latency as well as the worker's time. A slower or busier device colours fewer blocks; it
// never gives the main thread more to do. Export's longest wait (section 4.10) is HIGHLIGHT_PAGE_WORKER_MS +
// HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) x HIGHLIGHT_BOOT_BUDGET_MS = 18 750 ms.
//
// What the highlight limits leave (base spec 4.9, rewritten by W5h-b when it retired W5 part 1's main-thread highlight
// bounds): no highlight.js runs on the main thread. There, per block, the main thread posts at most
// MD_HIGHLIGHT_BLOCK_MAX_CHARS, receives at most MD_HIGHLIGHT_MAX_HTML_CHARS, checks it in one linear pass and inserts
// it once; per Docs page it admits at most DOCS_HIGHLIGHT_PAGE_MAX_CHARS (a block is posted at most twice, the second
// time for its line retry) and inserts at most DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS; upgrade re-renders are at most one
// per `pre`, so DOCS_MAX_RENDER_ELEMENTS bounds their count. On the phone R19 measured, checking, inserting and laying
// out 2 097 145 characters of highlight HTML in one commit took 276 ms. highlight.js's own time is the worker's,
// bounded per block by HIGHLIGHT_BLOCK_DEADLINE_MS and per store by HIGHLIGHT_PAGE_WORKER_MS and
// HIGHLIGHT_PAGE_MAX_TIMEOUTS, whatever shape a block takes.

/** MEASURED (W5h-b, R19 of 2026-11-03). The time one block may take, from post to answer; its timer starts only after
 *  the worker's ready handshake. An overrun terminates the highlight worker and leaves only that block plain. Basis:
 *  the slowest of 41 871 real blocks took 143.7 ms warm and each grammar's largest at most 96.1 ms cold, so no real
 *  block cold passes about 240 ms (about 280 with the xml and css that typescript and javascript compile on first
 *  use, 515 on the every-grammar reading); 750 is about three times 240, for a slower or busier device and the main
 *  thread's latency, and under the operator's 2 s bound for one block. Every crafted shape that grows ended here,
 *  with the main thread's longest frame gap at most 25 ms. */
export const HIGHLIGHT_BLOCK_DEADLINE_MS = 750;
/** MEASURED (W5h-b, R19 of 2026-11-03). From spawning a highlight worker to its `{ready: true}`; past it the worker is
 *  terminated and the jobs waiting for it answer `worker-failed`, and a second failure in a row is sticky until a
 *  reload. Basis: 32.2 ms for a first boot and at most 74.4 ms for thirteen further spawns, each from the service
 *  worker's precache or from memory, on an idle main thread; about 27 times that, because a long main-thread task when
 *  the worker spawns delays `{ready}` and a page no service worker controls fetches the chunk over the network,
 *  neither measured. */
export const HIGHLIGHT_BOOT_BUDGET_MS = 2000;
/** MEASURED (W5h-b, R19 of 2026-11-03). The summed post-to-answer time of one highlight store's jobs (a Docs page, a
 *  text leaf, a chat message, a tool well); past it, every block not yet answered is skipped. Basis: the real page
 *  with the most code (238 blocks, 323 842 characters) went from its plain first frame to its last block coloured in
 *  9 515.6 ms, about 40 ms a block where the worker's own time is a few: an upper bound on that page's sum, which
 *  counts the main thread's latency between answers. 12 000 is about a quarter more. A page of more, smaller blocks
 *  may take longer (Later). It also bounds Export's wait. */
export const HIGHLIGHT_PAGE_WORKER_MS = 12000;
/** MEASURED (W5h-b, R19 of 2026-11-03). The block timeouts one highlight store may take, each a worker respawn; once
 *  reached, every block not yet answered is skipped. Basis: no real block came near the deadline, so no real page
 *  reaches one timeout; 2 rather than 1 so that one timed-out block's line-by-line retry can still run (at 1 the
 *  first timeout closes the store before the retry is posted). */
export const HIGHLIGHT_PAGE_MAX_TIMEOUTS = 2;
/** MEASURED (W5h-b, R19 of 2026-11-03). The longest HTML one block's answer may carry, an absolute count for every
 *  block, chat's included: the worker refuses a longer one before posting and the main thread re-checks it on receipt.
 *  Basis: on real blocks the HTML ratio was at most 9 at the 95th percentile of any grammar, and 39 only for one-token
 *  `json` blocks; 16 x MD_HIGHLIGHT_BLOCK_MAX_CHARS admits a 64 KiB block at a ratio of 16 (desktop polish C7's dense
 *  JSON ran about 13) and every real block of twelve grammars at their highest ratio, and checking and inserting it
 *  costs the main thread about 140 ms on the phone measured. */
export const MD_HIGHLIGHT_MAX_HTML_CHARS = 1048576;
/** MEASURED (W5h-b, R19 of 2026-11-03). The HTML one Docs page may insert from highlighting, each drawn copy counted;
 *  past it the remaining blocks are skipped. Docs only. Basis: R19 checked (20.6 ms), inserted and laid out (255.7 ms)
 *  2 097 145 characters of real answers in one commit, within the 300 ms the W5h-b plan allows one page; it is twice
 *  MD_HIGHLIGHT_MAX_HTML_CHARS, so two blocks at that cap fit. R19 reports no page's HTML, so the rule's "never less
 *  than the largest real page's HTML" is not measured (Later). */
export const DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS = 2097152;
/** MEASURED (W5h-b, R19 of 2026-11-03). Chat only: a block whose text changed less than this long ago is not
 *  requested yet, so a streaming block asks the worker when it pauses. Basis: a 40-line fence streamed at settles of
 *  50 and 100 ms made 2 requests at 150, as at 250 and 400, and coloured 108 and 90 ms after its fence closed, against
 *  206 and 156 at 250; at 250 ms settles every candidate up to 250 asked once a settle. Chat has no fixed cadence of
 *  its own, so the basis holds as far as its real cadence is one of those. */
export const HIGHLIGHT_STREAM_DEBOUNCE_MS = 150;
/** The line retry's unit (section 4.10 "The line retry", the shared library's C24): a block of at most this many
 *  UTF-16 code units is never retried; a longer one is retried line by line, and one line longer than this answers
 *  `line-too-long`. */
export const HIGHLIGHT_LINE_RETRY_UNITS = 256;
/** The entries one highlight worker's cache holds (desktop polish Task C7's bound, moved here from `markdown.tsx` by
 *  W5h-a): chat's corpus highlights 33 blocks of at most 1 315 characters of markup each, so a long session's fences
 *  fit many times over. */
export const HIGHLIGHT_CACHE_MAX_ENTRIES = 256;
/** The characters of markup one highlight worker's cache holds (C7's bound, moved here by W5h-a): a dense 64 KiB
 *  JSON block comes out as about 858 000 characters, so four or so of those at once. The bound weighs the markup
 *  only; a key is at most its markup plus a mode, a language and two separators, so the cache holds at most twice
 *  this many characters, plus a mode, a language and two characters per entry. */
export const HIGHLIGHT_CACHE_MAX_CHARS = 4000000;
