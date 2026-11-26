// The PDF frame's document (X2 spec 2026-11-18 section 4.4; plan Task P3.2; mutation row M11.17's policy reaches it here).
// Ring L1: pure string building, no I/O, no DOM, no crypto. The caller (the assets loader) hashes the four scripts; this
// builds the one page the frame draws, in a fixed order:
//   1. the policy meta, FIRST in the bytes, so it applies before anything else is parsed;
//   2. the click guard, SECOND (the mockup frames' order);
//   3. the frame's own style and its few elements (a bar with Smaller, Fit width and Larger; the link line; a note);
//   4. the seed: the PDF as base64, the parser's text, the standard fonts and the CMaps, as one JSON data block with
//      every `<` escaped, which no engine runs;
//   5. the viewer (pdf.js's display layer), then the bootstrap, both module scripts named by hash.
// Everything the frame uses is inline: nothing is fetched. The parser's text is in the seed, never a script of the page:
// the bootstrap starts it as a `blob:` worker, or, where the engine will not start that worker, as an inline script
// whose hash is the fourth one in the policy.
import { PDF_BOOT_JS } from './pdfBoot';
import { PDF_CLICK_GUARD_JS, pdfCsp, pdfMeta, type PdfScriptHashes } from './pdfPolicy';

/** What the frame is built from, all from the installed package (the assets loader's answer) but the PDF. */
export interface PdfDocumentInput {
  /** The PDF's bytes as base64 (`base64Of`, the one encoder under `src/docs`). */
  readonly pdfB64: string;
  /** pdf.js's display layer, `build/pdf.min.mjs`, verbatim. */
  readonly viewer: string;
  /** pdf.js's parser, `build/pdf.worker.min.mjs`, verbatim. */
  readonly worker: string;
  /** The standard fonts, by file name, as base64. */
  readonly fonts: Readonly<Record<string, string>>;
  /** The packed CMaps, by file name, as base64. */
  readonly cmaps: Readonly<Record<string, string>>;
  readonly hashes: PdfScriptHashes;
  /** The kinds of image the frame cannot draw that the PDF holds (`pdfUndrawnImages`), named in the frame's note. */
  readonly undrawn: readonly string[];
}

/** Whether `text` can sit inside a `<script>` element and be read back byte for byte: the HTML parser ends the element
 *  at `</script`, changes its state at `<!--`, and turns CR and NUL into other code points before any hash is checked. */
export function inlineSafe(text: string): boolean {
  return !/<\/script|<!--/i.test(text) && !/[\r\0]/.test(text);
}

/** The scripts the page holds, each refused when it cannot be inlined as is. */
function checked(name: string, text: string): string {
  if (!inlineSafe(text)) throw new RangeError(`the PDF frame's page: the ${name} cannot be inlined byte for byte`);
  return text;
}

/** The frame's own look: a neutral grey a PDF viewer has in either theme, one column, the bar kept in view. */
const PDF_FRAME_STYLE = 'html,body{margin:0;background:#3c3f43;color:#f2f2f2;font:14px/1.4 system-ui,sans-serif}'
  + 'html{overflow-y:scroll;overflow-anchor:none}'
  + '#pdf-head{position:sticky;top:0;left:0;z-index:2;background:#2a2c2f}'
  + '#pdf-bar{display:flex;gap:6px;align-items:center;padding:6px 8px}'
  + '#pdf-bar button{min-width:44px;min-height:36px;border:1px solid #6b6f75;border-radius:6px;background:#3c3f43;color:inherit;font:inherit}'
  + '#pdf-zoom{min-width:3.5em;text-align:center}'
  + '#pdf-link,#pdf-note{margin:0;padding:6px 10px;background:#2a2c2f;overflow-wrap:anywhere;user-select:text}'
  + '#pdf-link{max-height:min(6em,20vh);overflow:auto}'
  + '#pdf-pages{padding:8px;touch-action:pan-x pan-y}'
  + '.pdf-page{position:relative;margin:0 auto 8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}'
  + '.pdf-page canvas{display:block}'
  + '.pdf-link{position:absolute;cursor:help;border-radius:2px}'
  + '.pdf-link:hover,.pdf-link:focus{outline:2px solid #4a90d9;background:rgba(74,144,217,.15)}';

/** The frame's elements, between the guard and the seed. */
const PDF_FRAME_BODY = '<div id="pdf-head"><div id="pdf-bar" role="toolbar" aria-label="PDF view">'
  + '<button id="pdf-smaller" type="button" aria-label="Smaller">−</button>'
  + '<button id="pdf-fit" type="button">Fit width</button>'
  + '<button id="pdf-larger" type="button" aria-label="Larger">+</button>'
  + '<span id="pdf-zoom">100%</span></div>'
  + '<p id="pdf-link" role="status" hidden></p></div><p id="pdf-note" role="status" hidden></p>'
  + '<main id="pdf-pages" aria-label="PDF pages"></main>';

/** The page the PDF frame draws (spec 4.4): the policy meta first, the click guard second, then the frame's elements,
 *  the seed, the viewer and the bootstrap. The policy names the guard, the viewer, the bootstrap and the parser by the
 *  hashes given, and nothing else. THROWS when a script cannot be inlined byte for byte (`inlineSafe`), or when a hash
 *  is not a SHA-256 digest (`pdfCsp`). */
export function buildPdfSrcdoc(input: PdfDocumentInput): string {
  const viewer = checked('viewer', input.viewer);
  const worker = checked('parser', input.worker);
  const csp = pdfCsp([input.hashes.guard, input.hashes.viewer, input.hashes.boot, input.hashes.worker]);
  const seed = JSON.stringify({
    pdf: input.pdfB64, worker, fonts: input.fonts, cmaps: input.cmaps, undrawn: [...input.undrawn],
  }).replace(/</g, '\\u003c');
  return pdfMeta(csp)
    + `<script>${checked('click guard', PDF_CLICK_GUARD_JS)}</script>`
    + `<style>${PDF_FRAME_STYLE}</style>`
    + PDF_FRAME_BODY
    + `<script type="application/json" id="pdf-seed">${seed}</script>`
    + `<script type="module">${viewer}</script>`
    + `<script type="module">${checked('bootstrap', PDF_BOOT_JS)}</script>`;
}

/** The leading meta `pdfMeta` writes: its `content` holds no `"` (it is escaped), so the first one ends it. */
const LEADING_META = /^<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;
const UNESCAPED: Readonly<Record<string, string>> = { amp: '&', quot: '"', lt: '<', gt: '>' };

/** The policy a built page's leading meta carries, unescaped, for the frame's `csp` attribute: the attribute and the meta
 *  are one policy by construction. THROWS when the page does not begin with that meta. */
export function pdfCspOfPage(page: string): string {
  const m = LEADING_META.exec(page);
  if (m === null) throw new Error('PdfFrame: the page does not begin with the Content-Security-Policy meta');
  return (m[1] ?? '').replace(/&(amp|quot|lt|gt);/g, (all, name: string) => UNESCAPED[name] ?? all);
}

/** The image filters pdf.js draws only with WebAssembly, which the frame keeps off, each with the name the note uses.
 *  A stream's filter is a name in its dictionary, and a stream is never inside an object stream, so the name's bytes
 *  are in the file as written; a name spelled with a `#` escape is not found (the note is a courtesy, not a wall). */
const UNDRAWN_FILTERS: ReadonlyArray<readonly [string, string]> = [['/JPXDecode', 'JPEG 2000'], ['/JBIG2Decode', 'JBIG2']];

/** The kinds of image in `bytes` this frame cannot draw, in the table's order, each once. */
export function pdfUndrawnImages(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (const [filter, name] of UNDRAWN_FILTERS) {
    if (indexOfAscii(bytes, filter) >= 0) out.push(name);
  }
  return out;
}

/** The first index of the ASCII `needle` in `bytes`, or -1. */
function indexOfAscii(bytes: Uint8Array, needle: string): number {
  const first = needle.charCodeAt(0);
  const last = bytes.length - needle.length;
  outer: for (let i = 0; i <= last; i += 1) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
