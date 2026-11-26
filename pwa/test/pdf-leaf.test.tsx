// A PDF leaf's view (X2 spec 2026-11-18 section 4.4; plan Task P3.2): the magic check before the frame, the inline ceiling
// before the frame, and the frame for everything else. The assets module is replaced, so no test loads the package.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DOCS_PDF_INLINE_MAX_BYTES } from '../../shared/docs';
import { PdfLeaf, pdfOverInlineSentence } from '../src/docs/pdf/PdfLeaf';
import { PDF_TEXT } from '../src/docs/pdf/pdfWords';

vi.mock('../src/docs/pdf/pdfAssets', () => ({ loadPdfAssets: () => new Promise(() => undefined) }));

afterEach(() => {
  cleanup();
});

const pdfOf = (size: number): Uint8Array => {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return b;
};

describe('PdfLeaf', () => {
  it('bytes that do not begin with %PDF- are never handed to the frame', () => {
    render(<PdfLeaf bytes={Uint8Array.from('<html>', (c) => c.charCodeAt(0))} name="a.pdf" />);
    expect(screen.getByRole('alert').textContent).toBe(PDF_TEXT.notPdf);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a PDF above the inline ceiling is a Download with its reason, and no frame', () => {
    render(<PdfLeaf bytes={pdfOf(DOCS_PDF_INLINE_MAX_BYTES + 1)} name="a.pdf" />);
    expect(screen.getByText(pdfOverInlineSentence(DOCS_PDF_INLINE_MAX_BYTES + 1))).toBeInTheDocument();
    expect(pdfOverInlineSentence(DOCS_PDF_INLINE_MAX_BYTES + 1)).toBe(
      'This PDF is 4.1 MiB. Docs draws PDFs of up to 4 MiB; this one is offered as a Download.');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a PDF at the ceiling opens the frame (its assets are loading here)', () => {
    render(<PdfLeaf bytes={pdfOf(DOCS_PDF_INLINE_MAX_BYTES)} name="a.pdf" />);
    expect(screen.getByRole('status').textContent).toBe(PDF_TEXT.loading);
  });
});
