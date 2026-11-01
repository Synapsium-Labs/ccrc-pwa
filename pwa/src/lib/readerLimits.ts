// The reader frame's caps, declared once (native Docs reader, W8a Task 4; the 2026-10-31 reader-frame spec's A6 and
// section 4.3's "Rendered HTML" row, refinement (m)). Ring L1: this file imports nothing, so the render job in the
// parse worker's lazy chunk and the main thread's reader files can both read it.
// The caps: `READER_HTML_MAX_BYTES`, `READER_IMAGE_BUDGET_BYTES`, `READER_STORE_PREFIX`, `READER_COPY_WRITE_MAX_BYTES`
// (M8.19: the most text the reader writes to the clipboard without asking) and `READER_DOC_KEY_MAX_UNITS` (A15/G7:
// the longest per-doc key).
// `READER_IMAGE_BUDGET_BYTES` equals the shared Markdown library's own image budget and section 4.3's 5 MiB; Task 10
// may lower it by measurement. Nothing else restates these values.

/** The most UTF-8 bytes of rendered html the reader accepts for one page (4 MiB). The render job passes it as the
 *  library's `maxHtmlBytes`; a page past it is `not-rendered` `output-over-limit`. */
export const READER_HTML_MAX_BYTES = 4194304;

/** The most bytes of image data the reader holds for one page (5 MiB). */
export const READER_IMAGE_BUDGET_BYTES = 5242880;

/** The prefix of every storage key the reader frame owns. */
export const READER_STORE_PREFIX = 'ccrc:reader:v1:';

/** The most UTF-8 bytes of text the reader writes to the clipboard without asking (64 KiB, M8.19). It is the shared
 *  Markdown library's own copy cap (`BRIDGE_LIMITS.copyMaxBytes`, pinned equal by `reader-policy.test.ts`), and the
 *  library refuses an over-cap copy before the adapter is asked, so ccrc's arm for more (the copy sheet) is a backstop
 *  and not a path a live frame takes. */
export const READER_COPY_WRITE_MAX_BYTES = 65536;

/** The most UTF-16 code units a per-doc key (`project:section:path`) may have (A15/G7); a longer one has no per-doc state. */
export const READER_DOC_KEY_MAX_UNITS = 1024;
