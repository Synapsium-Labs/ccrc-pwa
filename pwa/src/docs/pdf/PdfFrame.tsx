// The PDF frame (X2 spec 2026-11-18 section 4.4; plan Task P3.2; mutation rows M11.16 and M11.19). Ring L4 delivery: ONE
// `<iframe>` for a PDF's bytes, the only place under `pwa/src/docs/pdf` that draws one or names `srcdoc`
// (`docs-scans.test.ts` clause W8a holds the exact path). It decides nothing: the page is `buildPdfSrcdoc`'s, the walls
// are `pdfPolicy.ts`'s, and what it adds is the attribute set those walls need:
//   - `sandbox` is exactly `PDF_SANDBOX` (`allow-scripts`), always present;
//   - no `src`, `name`, `allow` or `allowfullscreen`; `referrerpolicy="no-referrer"`;
//   - `csp` is read back from the page's own leading meta, so the attribute and the meta are one policy by construction;
//   - the first `load` is the page; any later one means the document navigated, and the frame is torn down at once and
//     its sentence shown. It is never put back by itself: a second open of the page is the reader's own act.
// It holds no message channel, sends nothing to the frame and listens to nothing from it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fillSentence } from '../docsText';
import { base64Of } from '../mockup/load';
import { PDF_SANDBOX } from './pdfPolicy';
import { PDF_TEXT } from './pdfWords';
import type { PdfAssets } from './pdfAssets';
import { buildPdfSrcdoc, pdfCspOfPage, pdfUndrawnImages } from './pdfSrcdoc';

/** The frame's box: the page's width, most of the window's height (the frame scrolls inside itself), no border. Its own
 *  colours are the frame's (`buildPdfSrcdoc`'s style), so it needs no theme token. Inline, as no stylesheet of the
 *  reader's host is this wave's to edit. */
const FRAME_STYLE = { display: 'block', inlineSize: '100%', blockSize: '80dvh', border: 0 } as const;

/** The assets' loader: the literal dynamic `import()` that keeps them out of the main bundle. */
function loadAssets(): Promise<PdfAssets> {
  return import('./pdfAssets').then((m) => m.loadPdfAssets());
}

type FrameState =
  | { readonly s: 'building' }
  | { readonly s: 'ready'; readonly page: string; readonly csp: string }
  | { readonly s: 'failed' }
  | { readonly s: 'gone' };

export function PdfFrame(p: {
  readonly bytes: Uint8Array;
  readonly name: string;
  /** The assets' loader; absent, the bundled one. A test passes its own. */
  readonly loader?: () => Promise<PdfAssets>;
}): ReactNode {
  const [state, setState] = useState<FrameState>({ s: 'building' });
  const loads = useRef(0);
  const loader = p.loader ?? loadAssets;
  const latestLoader = useRef(loader);
  latestLoader.current = loader;
  useEffect(() => {
    let live = true;
    let raf: number | null = null;
    loads.current = 0;
    setState({ s: 'building' });
    latestLoader.current().then((assets) => {
      if (!live) return;
      // The nested callback runs after a paint opportunity for the opening status, even when the asset cache is warm.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          raf = null;
          if (!live) return;
          try {
            const page = buildPdfSrcdoc({
              pdfB64: base64Of(p.bytes), viewer: assets.viewer, worker: assets.worker, fonts: assets.fonts,
              cmaps: assets.cmaps, hashes: assets.hashes, undrawn: pdfUndrawnImages(p.bytes),
            });
            setState({ s: 'ready', page, csp: pdfCspOfPage(page) });
          } catch { setState({ s: 'failed' }); }
        });
      });
    }).catch(() => { if (live) setState({ s: 'failed' }); });
    return () => {
      live = false;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [p.bytes]);
  if (state.s === 'building') return <p className="docs-loading" role="status">{PDF_TEXT.loading}</p>;
  if (state.s === 'failed') return <p className="docs-note" role="alert">{PDF_TEXT.failed}</p>;
  if (state.s === 'gone') return <p className="docs-note" role="alert">{PDF_TEXT.navigated}</p>;
  const onLoad = (): void => {
    loads.current += 1;
    if (loads.current >= 2) setState({ s: 'gone' });
  };
  return (
    <iframe
      className="docs-pdf-frame"
      style={FRAME_STYLE}
      title={fillSentence(PDF_TEXT.frameTitle, { name: p.name })}
      sandbox={PDF_SANDBOX}
      srcDoc={state.page}
      referrerPolicy="no-referrer"
      csp={state.csp}
      onLoad={onLoad}
    />
  );
}
