// The print view's sentences (X2 P6.1 Step 1; X2 spec section 4.6, "The tree is parsed ahead"; PL3). Ring L1: pure words.
//
// A part the print could not draw as a tree prints as its plain text under one sentence that says why. The sentences for what
// the render job answers mirror the plain view's (`DocMarkdown.tsx#docsPlainNote`: the same facts, the same limits from
// `markdownLimits.ts`, "printed" for "shown"). They are written here, not imported, because that function lives in a component
// module (ring L4) and this one is read by pure deciders and drivers; a change to one reads the other.
import { DOCS_RENDER_GATE_BYTES, MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from '../../lib/markdownLimits';
import type { ReaderRenderOutcome } from '../../lib/readerRenderJob';

/** The sentence of a part that was not ready within `PRINT_WAIT_MS` (spec 4.6: Print waits at most 10 s a part). */
export const PRINT_NOT_READY = 'This part was not ready in time to print.';

/** The one line the print view holds when Print is asked before any part of the page is ready (spec 4.6: Ctrl+P with no tree ready). */
export const PRINT_PREPARING_LINE = 'Docs is preparing this page for print; print again in a moment.';
/** What Print says when the document is too long to print whole (`printPlan.ts#PRINT_WHOLE_MAX_ELEMENTS`): the view holds the part on
 *  screen only, and this sentence is below the Print row and at the top of the printed view. Never a silent short print. */
export const PRINT_TOO_LONG = 'This document is too long to print whole: Print prints the part on screen. To print the rest, open each part and print it.';
/** The one line a PDF prints (PL4): its file prints from the browser's own viewer, the console's window cannot. */
export const PRINT_PDF_LINE = "This PDF prints from its file: download it, then print it from the browser's viewer.";
/** The one line an HTML page prints (PL5), with the warning about opening it. */
export const PRINT_HTML_LINE = "This page prints from its file: download it, then open and print it in the browser. Opening it runs it outside Docs' protections.";

/** The Print row's words in Page details (spec 4.6; PL4 and PL5 for a file that prints from its download). */
export const PRINT_ROW_TEXT = {
  print: 'Print',
  downloadToPrint: 'Download to print',
  /** Shown while Print waits for the parts' trees: k is the part being prepared (1-based), n the parts. */
  preparing: 'Preparing part {k} of {n}…',
  /** Why Download to print is off: the page's own Download is the way, no download is reachable from the head. */
  noDownload: "Use the page's Download, then print the file from the browser.",
} as const;

/** The Print row while it prepares part `k` of `n`. */
export function printPreparing(k: number, n: number): string {
  return PRINT_ROW_TEXT.preparing.replace('{k}', String(k)).replace('{n}', String(n));
}

/** `n` in decimal, its digits grouped by three with a space, as the spec writes its limits ("limit 20 000"). */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The sentence for a render outcome that did not give a print tree: every arm of the render job's answer but `rendered`
 *  (exhaustive, so a new arm is a compile error here), and `rendered` itself with no tree, which a worker of an older build
 *  answers. The caller adds nothing: the sentence says why the text prints plain. */
export function printPlainWhy(o: ReaderRenderOutcome): string {
  switch (o.kind) {
    case 'refused':
      return o.why === 'container-depth'
        ? `Line ${grouped(o.line)} nests ${grouped(o.value)} levels deep (limit ${grouped(MD_MAX_CONTAINER_DEPTH)}); printed as plain text.`
        : `Line ${grouped(o.line)} has a run of ${grouped(o.value)} emphasis marks (limit ${grouped(MD_MAX_DELIMITER_RUN)}); printed as plain text.`;
    case 'not-rendered':
      return o.why === 'over-limit'
        ? `This document is over ${grouped(DOCS_RENDER_GATE_BYTES)} bytes, the most Docs formats at once; printed as plain text.`
        : o.why === 'output-over-limit'
          ? 'This document would draw a page over the size Docs formats; printed as plain text.'
          : 'This document could not be formatted; printed as plain text.';
    case 'threw':
      return `This document could not be formatted (${o.error}); printed as plain text.`;
    case 'timeout':
      return `Formatting took longer than ${o.budgetMs / 1000} s; printed as plain text.`;
    case 'worker-unavailable':
      return 'This browser cannot format long documents in the background; printed as plain text.';
    case 'worker-failed':
      return `The formatter stopped (${o.error}); printed as plain text.`;
    case 'blocks':
    case 'rendered':
      return 'This document could not be prepared for print; printed as plain text.';
  }
}

/** The sentence of a render that threw before it answered (the runner rejects only on an abort, so this is a bug's name). */
export function printThrewWhy(error: string): string {
  return `This document could not be formatted (${error}); printed as plain text.`;
}
