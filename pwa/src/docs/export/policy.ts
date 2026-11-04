// Export's limits, its policy and its closed words (spec 2026-10-01 4.17; native Docs reader W5, Export). These are
// limits on a saved file, not render limits, so they live here and not in `lib/markdownLimits.ts`; a PWA policy lives
// in the PWA (spec 4.17 "CSP"). Each value is declared once here and imported wherever it is read. The sentences for
// the two word types are `docsText.ts`'s (`EXPORT_MISSING_SENTENCE`, `EXPORT_PLAIN_SENTENCE`).
//
// Ring L1: constants and types only.

/** The export's Content-Security-Policy (spec 4.17 "CSP"): no `script-src`, so scripts fall back to `'none'`; images,
 *  styles and fonts only from the file itself; no `<base>`, no form target. It is the first `<head>` child after
 *  `meta charset` (M4.EX1). `font-src data:` is for W6's mockup export; a Markdown export carries no font. */
export const DOCS_EXPORT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'";

/** The largest file Export saves (decision 4): 10 MiB of output. Images are inlined in document order while the file
 *  fits; the body is never cut (spec 4.17 "Size"). */
export const DOCS_EXPORT_MAX_BYTES = 10485760;

/** How long Export waits for an image the page is still loading before that image becomes a placeholder (decision 3). */
export const DOCS_EXPORT_IMAGE_WAIT_MS = 10000;

/** The one doctype (spec 4.17 "The doctype"), joined to the rendered markup in exactly one place, `buildExport`. */
export const EXPORT_PREFIX = '<!doctype html>';

/** The `generator` meta's content: the export format and its version (spec 4.13: it versions the format). */
export const EXPORT_GENERATOR = 'ccrc-docs-export/1';

/** The longest file name Export gives (spec 4.17 "Filename"). */
export const EXPORT_FILENAME_MAX = 150;

/** Why an image of the page is a placeholder in the file (spec 4.17 "Placeholders"; refinement (t)): the page does not
 *  show it (`refused`), it is on another site (`external`), it waits for Load image (`deferred`), its load failed
 *  (`failed`), it was still loading after `DOCS_EXPORT_IMAGE_WAIT_MS` (`timed-out`), or the file had no room left for it
 *  (`over-size`). A class, never an instance. */
export type ExportMissing = 'refused' | 'external' | 'deferred' | 'failed' | 'timed-out' | 'over-size';

/** Why a code block of the page is plain in the file (spec 4.17 "Said in the provenance"; M4.EX18; refinement (t)):
 *  over the block cap; past a page ceiling; timed out; output too large; failed (the worker's failures and the check's
 *  structural refusals); no highlight worker; and, until W5h-b, refused by W5 part 1's bounds. */
export type ExportPlain = 'over-cap' | 'page-ceiling' | 'timeout' | 'too-large' | 'failed' | 'no-worker' | 'part1-bounds';

/** Why Export is shown but disabled (spec 4.17's "When it is offered"; refinement (j)): the parse has not settled or
 *  answers another text, the page's highlight store has not settled, the render gate waits, or a raster leaf's own image
 *  did not load. */
export type ExportWait = 'formatting' | 'highlighting' | 'gate' | 'image-failed';
