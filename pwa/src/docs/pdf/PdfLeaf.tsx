// A PDF leaf's view (X2 spec 2026-11-18 section 4.4; plan Task P3.2). Ring L4: it asks the two L0 deciders and draws what
// they answer, deciding nothing itself. Bytes that do not begin as a PDF does are never handed to the frame (the magic
// check, `sniffPdf`); a PDF above the inline ceiling is a Download with its reason (`pdfVerdict`); anything else is drawn
// by the PDF frame. Download itself is the caller's (the leaf's own button, or the range read's), never the frame's.
import type { ReactNode } from 'react';
import { DOCS_PDF_INLINE_MAX_BYTES, pdfVerdict, sniffPdf } from '../../../../shared/docs';
import { fillSentence, mib } from '../docsText';
import { PdfFrame } from './PdfFrame';
import { PDF_TEXT } from './pdfWords';

/** The sentence for a PDF above the inline ceiling, for a caller that never reads its bytes. */
export function pdfOverInlineSentence(size: number): string {
  return fillSentence(PDF_TEXT.overInline, { size: mib(size), limit: mib(DOCS_PDF_INLINE_MAX_BYTES) });
}

export function PdfLeaf(p: { readonly bytes: Uint8Array; readonly name: string }): ReactNode {
  if (sniffPdf(p.bytes) === 'mismatch') return <p className="docs-note" role="alert">{PDF_TEXT.notPdf}</p>;
  if (pdfVerdict(p.bytes.length) === 'download') return <p className="docs-note">{pdfOverInlineSentence(p.bytes.length)}</p>;
  return <PdfFrame bytes={p.bytes} name={p.name} />;
}
