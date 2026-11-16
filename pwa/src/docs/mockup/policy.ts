// The mockup viewer's limits and tables (native Docs reader, completion plan Tasks 5-7; base spec 2026-10-01 section 5.6.2's
// pre-scan, 5.6.3's Budgets and asset MIME). Ring L1: constants and one pure lookup, no I/O, no DOM, no timer; it imports
// only L0 tables from `shared/docs.ts`, so the pre-scan, the planner and the loader all read the same values and nothing
// restates them.
import { DOCS_RASTER_EXT, DOCS_RASTER_TYPES } from '../../../../shared/docs';

/** The deepest stack of open elements the pre-scan admits (base 5.6.2). Fixed; the measurement never raises it. */
export const MOCKUP_MAX_DEPTH = 256;

/** The most start and end tags the pre-scan admits (base 5.6.2). Re-derived by measurement after
 *  `MOCKUP_MAX_OPEN_FORMATTING` was fixed (base 5.6.2, decision 9; completion plan Task 5, C1): at the old 20 000 the
 *  worst admitted shape, misnested formatting (`<b><div></b>` repeated), parsed in a median 430 ms in Chromium 156 on a
 *  loaded box, so the limit is lowered for headroom against the 1 000 ms budget. This repository's committed HTML docs
 *  peak at 5 394 tags (`browser/mockup-parse.browser.test.ts` gates every worst shape). */
export const MOCKUP_MAX_TAGS = 15_000;

/** The most formatting elements the pre-scan admits open at once (base 5.6.2, amended 2026-10-13: a multiset that only
 *  each element's own end tag decrements). Fixed by measurement (completion plan Task 5). */
export const MOCKUP_MAX_OPEN_FORMATTING = 32;

/** The most attributes any one start tag may carry, inclusive (D-8671; the exact attribute tokenizer counts every attribute
 *  TOKEN, a repeated name included, though the parser keeps the first of a duplicated name). The parser copies every attribute of
 *  a formatting element into each clone it makes (reconstruction, adoption agency), so the cost is attributes x clones: a tag with
 *  150 000 attributes and 4 000 paragraphs took 19.1 s in Chromium 156. The most attributes on any start tag in this
 *  repository's committed HTML docs (measured with the exact tokenizer): `design/overlord/reference.html` 7,
 *  `2026-10-07-box-token-lifecycle-design.html` 2, `2026-10-11-design-system-audit.html` 3, `2026-11-04-runs-screen-rebuild-frames.html` 6
 *  (over the 2 MiB cap, so only a download), `2026-11-06-chat-reading-mockup.html` 4 and `2026-11-06-desk-nav-mockup.html` 5; at 64, with 32 open formatting elements each carrying 64
 *  and the tag limit's paragraphs, Chromium 156 parsed in a median 358 ms (the adoption-agency variant 40 ms). */
export const MOCKUP_MAX_ATTRIBUTES = 64;

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
