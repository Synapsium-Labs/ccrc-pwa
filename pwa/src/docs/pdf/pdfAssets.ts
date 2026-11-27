// The PDF frame's assets (X2 spec 2026-11-18 section 4.4, "What goes in"; plan Task P3.1 Step 0's pin). Ring L3: the
// adapter that hands the frame what it is built from, all taken from the installed `pdfjs-dist` package at build time,
// never from a network address: the viewer (`build/pdf.min.mjs`), the parser (`build/pdf.worker.min.mjs`), the standard
// fonts and the packed CMaps. It also hashes the four scripts the frame runs, for its policy.
// It is loaded only through `PdfFrame`'s literal dynamic `import()`, so these bytes (about 4.4 MB of text) are one chunk
// of their own that only a PDF page asks for; `vite.config.ts` keeps that chunk out of the service worker's precache.
import viewer from 'pdfjs-dist/build/pdf.min.mjs?raw';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { base64Of } from '../mockup/load';
import { PDF_BOOT_JS } from './pdfBoot';
import { PDF_CLICK_GUARD_JS, type PdfScriptHashes } from './pdfPolicy';

const fontFiles = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;
const cmapFiles = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap',
  { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;

/** Everything the frame is built from but the PDF. */
export interface PdfAssets {
  readonly viewer: string;
  readonly worker: string;
  readonly fonts: Readonly<Record<string, string>>;
  readonly cmaps: Readonly<Record<string, string>>;
  readonly hashes: PdfScriptHashes;
}

/** A glob's answer as file name to base64: each value is a `data:` URL whose payload is base64. THROWS on any other
 *  shape, so a build that inlined a file differently fails the first PDF rather than drawing it without that file. */
function byName(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const comma = url.indexOf(',');
    if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) {
      throw new Error(`pdfAssets: ${path} was not inlined as base64`);
    }
    out[path.slice(path.lastIndexOf('/') + 1)] = url.slice(comma + 1);
  }
  return out;
}

async function sha256B64(text: string): Promise<string> {
  return base64Of(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

let loaded: Promise<PdfAssets> | null = null;

/** The frame's assets, read and hashed once per page load. */
export function loadPdfAssets(): Promise<PdfAssets> {
  loaded ??= (async () => {
    const [guard, v, boot, w] = await Promise.all([PDF_CLICK_GUARD_JS, viewer, PDF_BOOT_JS, worker].map(sha256B64));
    return {
      viewer, worker, fonts: byName(fontFiles), cmaps: byName(cmapFiles),
      hashes: { guard: guard!, viewer: v!, boot: boot!, worker: w! },
    };
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}
