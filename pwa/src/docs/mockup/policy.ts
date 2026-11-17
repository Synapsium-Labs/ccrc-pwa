// The mockup viewer's limits and tables (native Docs reader, completion plan Tasks 5-7; base spec 2026-10-01 section 5.6.2's
// pre-scan, 5.6.3's Budgets and asset MIME). Ring L1: constants and one pure lookup, no I/O, no DOM, no timer; it imports
// only L0 tables from `shared/docs.ts`, so the pre-scan, the planner and the loader all read the same values and nothing
// restates them.
import { DOCS_MAX_DOC_BYTES, DOCS_RASTER_EXT, DOCS_RASTER_TYPES } from '../../../../shared/docs';
import type { HttpsOrigin } from './ports';

/** The deepest stack of open elements the pre-scan admits (base 5.6.2, lowered from 256 by D-8695). The merge queue's hosted
 *  runner read the text-heavy gate (`<b>`, the deepest stack, then text and comment runs to 2 MiB) at a 1 052 ms median
 *  at 256. Alone on the fleet box that shape read 240 ms at 128 and 132 ms at 64, with a floor near 130 ms from the
 *  2 MiB size (local readings). The committed HTML docs peak at depth 17, so 64 keeps 3.8x headroom. The measurement
 *  never raises it. */
export const MOCKUP_MAX_DEPTH = 64;

/** The most start and end tags the pre-scan admits (base 5.6.2). Re-derived by measurement after
 *  `MOCKUP_MAX_OPEN_FORMATTING` was fixed (base 5.6.2, decision 9; completion plan Task 5, C1): at the old 20 000 the
 *  worst admitted shape, misnested formatting (`<b><div></b>` repeated), parsed in a median 430 ms in Chromium 156 on a
 *  loaded box, so the limit is lowered for headroom against the 1 000 ms budget. This repository's committed HTML docs
 *  peak at 5 394 tags (`browser/mockup-parse.browser.test.ts` gates every worst shape). */
export const MOCKUP_MAX_TAGS = 15_000;

/** The most formatting elements the pre-scan admits open at once (base 5.6.2, amended 2026-10-13: a multiset that only
 *  each element's own end tag decrements). Fixed by measurement at 32 (completion plan Task 5, C1: the reconstruction
 *  shape at 32 open and 20 000 tags parsed in a median 119 to 234 ms, 16 in 37 to 78 ms), then lowered to 16 by D-8695
 *  after the merge queue's hosted runner read reconstruction at 32 open with 64 attributes each at a 1 410 ms median.
 *  The committed HTML docs peak at 2 open, so 16 keeps 8x headroom. */
export const MOCKUP_MAX_OPEN_FORMATTING = 16;

/** The most attributes any one start tag may carry, inclusive (D-8671; the exact attribute tokenizer counts every attribute
 *  TOKEN, a repeated name included, though the parser keeps the first of a duplicated name). The parser copies every attribute of
 *  a formatting element into each clone it makes (reconstruction, adoption agency), so the cost is attributes x clones: a tag with
 *  150 000 attributes and 4 000 paragraphs took 19.1 s in Chromium 156. The most attributes on any start tag in this
 *  repository's committed HTML docs (measured with the exact tokenizer): `design/overlord/reference.html` 7,
 *  `2026-10-07-box-token-lifecycle-design.html` 2, `2026-10-11-design-system-audit.html` 3, `2026-11-04-runs-screen-rebuild-frames.html` 6
 *  (over the 2 MiB cap, so only a download), `2026-11-06-chat-reading-mockup.html` 4 and `2026-11-06-desk-nav-mockup.html` 5. Fixed at
 *  64 (32 open formatting elements each carrying 64 and the tag limit's paragraphs parsed in a median 358 ms, local), then
 *  lowered to 32 with D-8695's depth and formatting limits: at 16 open elements each carrying 32 the reconstruction shape
 *  read a 108 ms median alone on the fleet box (local). 32 keeps 4.6x headroom over the docs' 7. */
export const MOCKUP_MAX_ATTRIBUTES = 32;

/** The formatting elements an HTML parser reconstructs (base 5.6.2's list). */
export const MOCKUP_FORMATTING_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u',
]);

/** The void elements: a start tag of one pushes nothing (base 5.6.2). */
export const MOCKUP_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/** The most distinct assets one attempt admits, inclusive (base 5.6.3). */
export const MOCKUP_MAX_ASSETS = 64;

/** The most bytes one attempt reserves for its admitted assets, inclusive (base 5.6.3: 5 MiB in total). */
export const MOCKUP_MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** The deepest a reference found in linked CSS may sit (base 5.6.3): a page-level reference is depth 0, one found in a
 *  stylesheet at depth d is d + 1, and a reference past this is `unsupported:'css-depth'`. */
export const MOCKUP_MAX_CSS_DEPTH = 3;

/** What a mockup reference loads as: the element or rule it was found in decides it (base 5.6.3's table). */
export type MockupAssetKind = 'image' | 'css' | 'script' | 'module' | 'font';

/** One row of the asset MIME table: the kinds an extension may serve, and the `data:` MIME it is inlined with. */
export interface MockupMimeRow {
  readonly kinds: readonly MockupAssetKind[];
  readonly mime: string;
}

const IMAGE: readonly MockupAssetKind[] = ['image'];
const SCRIPT: readonly MockupAssetKind[] = ['script', 'module'];
const FONT: readonly MockupAssetKind[] = ['font'];

/** `MOCKUP_ASSET_MIME` (base 5.6.3), by lowered extension: the raster types from `DOCS_RASTER_TYPES` (never a copy of
 *  that table), `svg`, `css`, `js`/`mjs` and the four font types. The `data:` MIME always comes from here, never from a
 *  response. An extension outside this table, or one whose row does not list the reference's kind, is
 *  `unsupported:'kind'`. */
export const MOCKUP_ASSET_MIME: Readonly<Record<string, MockupMimeRow>> = {
  ...Object.fromEntries(Object.entries(DOCS_RASTER_EXT).map(([ext, type]) => [ext, { kinds: IMAGE, mime: DOCS_RASTER_TYPES[type].mime }])),
  svg: { kinds: IMAGE, mime: 'image/svg+xml' },
  css: { kinds: ['css'], mime: 'text/css' },
  js: { kinds: SCRIPT, mime: 'text/javascript' },
  mjs: { kinds: SCRIPT, mime: 'text/javascript' },
  woff2: { kinds: FONT, mime: 'font/woff2' },
  woff: { kinds: FONT, mime: 'font/woff' },
  ttf: { kinds: FONT, mime: 'font/ttf' },
  otf: { kinds: FONT, mime: 'font/otf' },
};

/** The MIME table's row for `path`'s final extension (the text after its last `.`, lowered `A-Z` only), or null: no
 *  extension, a dotfile, or an extension outside the table. */
export function mockupMimeRow(path: string): MockupMimeRow | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  let ext = '';
  for (const ch of name.slice(dot + 1)) {
    const c = ch.charCodeAt(0);
    ext += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : ch;
  }
  return Object.prototype.hasOwnProperty.call(MOCKUP_ASSET_MIME, ext) ? MOCKUP_ASSET_MIME[ext]! : null;
}

/** The frame's `sandbox` attribute in the static mode: present and empty (base 5.6.5). */
export const MOCKUP_SANDBOX_STATIC = '';

/** The frame's `sandbox` attribute with scripts run: exactly this one token and no other (base 5.6.5). The build's bytes
 *  do not depend on the mode; the sandbox carries it. */
export const MOCKUP_SANDBOX_SCRIPTED = 'allow-scripts';

/** The base policy a mockup's frame is held to (base 5.6.4), verbatim. `connect-src`, `frame-src`, `worker-src`,
 *  `object-src` and `manifest-src` fall back to `default-src 'none'`; `'self'` never appears, because from a srcdoc it
 *  would mean the console's own origin. */
export const MOCKUP_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";

/** The four directives a confirmed origin is appended to, and no other (base 5.6.4; ruling U2). */
const MOCKUP_ORIGIN_DIRECTIVES: ReadonlySet<string> = new Set(['script-src', 'style-src', 'img-src', 'font-src']);

/** The one host grammar (base 5.6.4, hardened in review): lower-case LDH labels, each 1 to 63 characters and neither
 *  starting nor ending with `-`, at least two labels, at most 253 characters in all. A trailing dot is refused: `new URL`
 *  keeps it (`https://a.example.` is its own origin), but a CSP host-source has no such form, so it would break the
 *  directive. `parseMockupOrigin` (the validator) and `mockupCsp` (the policy builder) both ask this ONE function, so an
 *  origin the first accepts can never make the second throw. */
export function isMockupHost(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l));
}

/** Whether `raw` is exactly `https://<host>` or `https://<host>:<port>` with a host `isMockupHost` accepts and a port of
 *  1 to 5 digits. The shape of an origin as a CSP source: nothing here can end or widen a directive. */
export function isMockupOrigin(raw: string): boolean {
  if (!raw.startsWith('https://')) return false;
  const rest = raw.slice('https://'.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return isMockupHost(rest);
  const port = rest.slice(colon + 1);
  return /^\d{1,5}$/.test(port) && Number(port) <= 65535 && isMockupHost(rest.slice(0, colon));
}

/** The policy with each confirmed origin appended to `script-src`, `style-src`, `img-src` and `font-src` only, never to
 *  `connect-src`, `default-src`, `worker-src` or `frame-src`, an origin given twice once. With none it is `MOCKUP_CSP`.
 *  It does not depend on the sandbox mode (base 5.6.4). THROWS on a value `isMockupOrigin` refuses. */
export function mockupCsp(extra: readonly HttpsOrigin[]): string {
  const origins: string[] = [];
  for (const o of extra) {
    if (!isMockupOrigin(o)) throw new RangeError(`mockupCsp: '${o}' is not an exact https origin`);
    if (!origins.includes(o)) origins.push(o);
  }
  if (origins.length === 0) return MOCKUP_CSP;
  return MOCKUP_CSP.split('; ').map((directive) => {
    const name = directive.slice(0, directive.indexOf(' '));
    return MOCKUP_ORIGIN_DIRECTIVES.has(name) ? `${directive} ${origins.join(' ')}` : directive;
  }).join('; ');
}

/** The click guard injected right after the CSP meta (base 5.6.6, E5), verbatim. In scripted mode it keeps the frame
 *  alive and makes fragment links scroll; it is UX, never the wall (the parent's `frame-src 'none'` is). */
export const MOCKUP_CLICK_GUARD = "<script>document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href],area[href]');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.charAt(0)==='#'&&h.length>1){var id=decodeURIComponent(h.slice(1));var t=document.getElementById(id)||document.getElementsByName(id)[0];if(t)t.scrollIntoView();}},true);</script>";

/** The meta tag that carries `csp`, its content attribute escaped (`&`, `"`, `<`, `>`). The build puts it first in the
 *  byte stream, before the author's doctype, so the policy applies before any author byte (base 5.6.2 step 6). */
export function metaFor(csp: string): string {
  const content = csp.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<meta http-equiv="Content-Security-Policy" content="${content}">`;
}

/** The most characters a built mockup page may have (D-8662): the spec's worst case (base 5.6.3's Budgets), which E4 measured
 *  to render at 11.2 M characters and above: a page at its 2 MiB source limit, the 5 MiB asset budget base64-encoded, one
 *  `data:<mime>;base64,` prefix per admitted asset at the longest the MIME table has, the CSP meta, the click guard and the
 *  doctype. Derived from those constants, never a second literal. `buildMockupSrcdoc` never returns more. */
export const MOCKUP_MAX_SRCDOC_CHARS =
  DOCS_MAX_DOC_BYTES
  + 4 * Math.ceil(MOCKUP_MAX_ASSET_BYTES / 3)
  + MOCKUP_MAX_ASSETS * Math.max(...Object.values(MOCKUP_ASSET_MIME).map((r) => `data:${r.mime};base64,`.length))
  + metaFor(MOCKUP_CSP).length
  + MOCKUP_CLICK_GUARD.length
  + '<!doctype html>'.length;
