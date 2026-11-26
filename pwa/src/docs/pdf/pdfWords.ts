// The PDF view's sentences (X2 spec 2026-11-18 section 4.4). Ring L1: words only, filled by `fillSentence`.

export const PDF_TEXT = {
  /** The bytes do not begin with `%PDF-` (the magic check, as rasters have under `nosniff`). */
  notPdf: 'This file does not begin as a PDF does, so Docs does not draw it. Download it to open it elsewhere.',
  /** Above `DOCS_PDF_INLINE_MAX_BYTES`: Download only, with the reason. */
  overInline: 'This PDF is {size}. Docs draws PDFs of up to {limit}; this one is offered as a Download.',
  /** While the viewer and the PDF are put together. */
  loading: 'Opening the PDF…',
  /** The viewer could not be put together (its assets did not load). */
  failed: 'The PDF view could not be opened. Download the file to read it.',
  /** A second `load` of the frame: the page tried to go elsewhere, so the frame was closed and is not reopened. */
  navigated: 'The PDF view tried to open another page, so it was closed. Download the file to read it, or open this page again.',
  /** The frame's accessible name. */
  frameTitle: 'PDF: {name}',
} as const;
