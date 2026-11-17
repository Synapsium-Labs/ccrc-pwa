// The mockup export's snapshot (native Docs reader, completion plan Task 9, C2; base spec 2026-10-01 5.6.9 Steps 2-6 and
// "What is guaranteed", rows M5.EX1 and M5.EX2, M5.B10). Ring L3: an adapter over a DOM, like `load.ts`'s extractor. It
// decides nothing about admission (the plan did, from its context) and nothing about layout (the builder does): it takes
// the viewer's ALREADY PARSED inert Document and the loaded assets, works on a CLONE, and answers the inner document of
// the saved file as text, the links it removed and the assets it could not inline. `parse.ts` stays the only parser
// (M5.16): this file never constructs one and never builds a node from markup text, and being inside Export's inert
// scope (M4.EX2) it holds no HTML sink and no markup string: the doctype is `EXPORT_PREFIX`, and the CSP meta is made
// with DOM calls.
//
// The steps, in order, on the clone:
//   2. INLINE   each reference whose row is `inline` and whose bytes the result holds becomes `data:<the ROW's MIME>;base64,`
//               (the extension table's, never a response's); a stylesheet is inlined with its own references rewritten
//               first, within `MOCKUP_MAX_CSS_DEPTH` of use, and one it cannot inline is neutralised as in step 4. The
//               inlined data: URLs are bounded by `DOCS_EXPORT_MAX_BYTES` (a file over it could never be saved, and an
//               unbounded repeat of one large sheet would exhaust memory before the builder could measure anything).
//   3. STRIP    template, noscript (unwrapped), script, frames, objects, embed, base, `meta[http-equiv]`, every `link` but a
//               `data:` stylesheet; every `on*` attribute and `srcdoc`, `action`, `formaction`, `ping`, `attributionsrc`;
//               `srcset` and `imagesrcset` unless every candidate is `data:`; every URL attribute of the allowlist unless it
//               is `data:` (a same-document `#` fragment stays on an SVG element other than `a` and `image`); SMIL
//               animations that target `href`.
//   4. CSS      `css.ts`'s two patterns over every style, `style` attribute, attribute holding `url(` and decoded `data:`
//               stylesheet: a `url()` off `data:` becomes `url("data:,")`, such an `@import` is dropped. The forms the scanner
//               misses (`image-set()`, CSS escapes inside `url`) rest on the CSP (M5.B10).
//   5. LINKS    `href` and `xlink:href` off every `a` and `area`, the text kept, the target in `title` and in `links`.
//   6. INNER    the CSP meta first in `<head>`, then the serialised clone.
// A missing asset keeps its element without its URL; an `img` or `input[type=image]` takes the closed missing sentence as
// its `alt`, and every asset none of whose uses was written is listed once, in DOM order.
import { docRepoPath, docsApi, resolveDocRef, type DocSectionSlug } from '../../../../shared/docs';
import { EXPORT_MISSING_SENTENCE } from '../docsText';
import { DOCS_EXPORT_CSP, DOCS_EXPORT_MAX_BYTES, EXPORT_PREFIX, type ExportMissing } from '../export/policy';
import { rewriteCssBytes, scanCssBytes, scanCssBytesRefs, type CssToken } from './css';
import { base64Of, extractMockupRefs, parseSrcset, type MockupExtract } from './load';
import { MOCKUP_MAX_CSS_DEPTH } from './policy';
import type { MockupAssetResult, MockupAssetRow, MockupRef, MockupRefVerdict } from './ports';

/** What the snapshot answers: `html` is the inner document (`EXPORT_PREFIX` and the stripped clone's markup, the CSP meta
 *  first in `<head>`); `links` the removed link targets in DOM order; `omitted` every asset NONE of whose uses was written
 *  into `html` (nested files of a stylesheet included), each once in DOM order, as a resolved repo path or, where the
 *  reference does not resolve to one, as written. A file with one use written and another cut is not omitted: the builder
 *  derives what the file inlined, and how many drafts, from the files it handed in minus `omitted`. */
export interface MockupSnapshot {
  readonly html: string;
  readonly links: readonly string[];
  readonly omitted: readonly string[];
}

type InlineVerdict = Extract<MockupRefVerdict, { readonly v: 'inline' }>;

/** The failure word the builder writes on an admitted row it stopped waiting for (`buildExport`'s mockup arm). */
export const TIMED_OUT = 'timed-out';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------------------------------------------
// URL text, as a browser reads an attribute URL
// ---------------------------------------------------------------------------------------------------------------
/** `value` as a URL parser first sees it: ASCII tab and newlines removed, C0 controls and space trimmed from both ends. */
function urlText(value: string): string {
  const s = value.replace(/[\t\n\r]/g, '');
  let lo = 0;
  let hi = s.length;
  while (lo < hi && s.charCodeAt(lo) <= 0x20) lo += 1;
  while (hi > lo && s.charCodeAt(hi - 1) <= 0x20) hi -= 1;
  return s.slice(lo, hi);
}

const isDataUrl = (value: string): boolean => /^data:/i.test(urlText(value));
const isFragment = (value: string): boolean => urlText(value).startsWith('#');

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;
const isQuote = (c: number): boolean => c === 0x22 || c === 0x27;

/** One character per byte (the byte's own value), for the scans that need a string's positions to be byte offsets. */
function byteString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x2000) out += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return out;
}

/** A `data:` URL's header (everything before its comma) and its payload as bytes, or null when it cannot be decoded: a
 *  bad base64 payload, or a percent-encoding that is not UTF-8. The caller fails closed on null. */
function decodeDataUrl(url: string): { readonly head: string; readonly bytes: Uint8Array<ArrayBuffer> } | null {
  const v = urlText(url);
  const comma = v.indexOf(',');
  if (comma < 0) return null;
  const head = v.slice(0, comma);
  const hash = v.indexOf('#', comma);
  const payload = v.slice(comma + 1, hash < 0 ? v.length : hash);
  try {
    if (/;\s*base64$/i.test(head)) {
      const binary = atob(payload);
      return { head, bytes: Uint8Array.from(binary, (ch) => ch.charCodeAt(0)) };
    }
    return { head, bytes: encoder.encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

/** The `data:` URL of `bytes` under `head`, always base64. */
function encodeDataUrl(head: string, bytes: Uint8Array): string {
  return `${/;\s*base64$/i.test(head) ? head : `${head};base64`},${base64Of(bytes)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4: the CSS strip, over bytes (one implementation for a style's text too)
// ---------------------------------------------------------------------------------------------------------------
interface Edit { readonly start: number; readonly end: number; readonly text: string }

/** The end of the string whose opening quote is at `at`: past its closing quote, at a bare newline or at the end. */
function skipString(s: string, at: number): number {
  const q = s.charCodeAt(at);
  let i = at + 1;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === q) return i + 1;
    if (c === 0x0a || c === 0x0d || c === 0x0c) return i;
    i += c === 0x5c ? 2 : 1;
  }
  return s.length;
}

/** The whole `@import` rule an `@import` token (`css` kind) sits in: from the at-keyword to its `;` (kept inside the span),
 *  or to the end of the block or text. Null when the text before the token is not the `@import url(` or `@import "` shape
 *  the scanner matched, in which case the caller neutralises the argument instead. */
function importRule(s: string, t: CssToken): { readonly start: number; readonly end: number } | null {
  let a = t.start;
  if (isQuote(s.charCodeAt(a - 1))) a -= 1;
  while (a > 0 && isSpace(s.charCodeAt(a - 1))) a -= 1;
  if (s.charCodeAt(a - 1) === 0x28) {
    a -= 1;
    if (s.slice(a - 3, a).toLowerCase() !== 'url') return null;
    a -= 3;
    while (a > 0 && isSpace(s.charCodeAt(a - 1))) a -= 1;
  }
  if (s.slice(a - 7, a).toLowerCase() !== '@import') return null;
  let i = isQuote(s.charCodeAt(t.end)) ? t.end + 1 : t.end;
  let depth = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (isQuote(c)) {
      i = skipString(s, i);
      continue;
    }
    if (c === 0x2f && s.charCodeAt(i + 1) === 0x2a) {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    if (c === 0x28) depth += 1;
    else if (c === 0x29) depth = Math.max(0, depth - 1);
    else if (c === 0x3b && depth === 0) return { start: a - 7, end: i + 1 };
    else if (c === 0x7b || c === 0x7d) return { start: a - 7, end: i };
    i += 1;
  }
  return { start: a - 7, end: s.length };
}

/** `bytes` with the edits applied in one pass. An edit that starts inside the one before it (a reference inside a dropped
 *  rule) is skipped. With no edit it returns `bytes` itself. */
function applyEdits(bytes: Uint8Array<ArrayBuffer>, edits: readonly Edit[]): Uint8Array<ArrayBuffer> {
  const kept: Edit[] = [];
  let at = 0;
  for (const e of edits) {
    if (e.start < at) continue;
    kept.push(e);
    at = e.end;
  }
  const spans: CssToken[] = kept.map((e) => ({ start: e.start, end: e.end, raw: '', kind: 'image' }));
  return rewriteCssBytes(bytes, spans, (i) => kept[i]!.text);
}

/** What one `data:` @import argument becomes: kept as it is, replaced by a stripped stylesheet's URL, or dropped (one past
 *  the depth limit, or one that cannot be decoded). */
type NestedSheet = { readonly kind: 'keep' } | { readonly kind: 'edit'; readonly url: string } | { readonly kind: 'drop' };

function nestedSheet(raw: string, depth: number): NestedSheet {
  if (depth > MOCKUP_MAX_CSS_DEPTH) return { kind: 'drop' };
  const decoded = decodeDataUrl(raw);
  if (decoded === null) return { kind: 'drop' };
  const stripped = stripCssBytes(decoded.bytes, depth);
  return stripped === decoded.bytes ? { kind: 'keep' } : { kind: 'edit', url: encodeDataUrl(decoded.head, stripped) };
}

/** The edits for a stylesheet's tokens: a token `inlined` names is replaced by that URL; a same-document fragment and a
 *  `data:` image or font stay; a `data:` @import is stripped inside; every other reference is neutralised (a `url()`
 *  becomes `url("data:,")`, an @import rule is dropped). `depth` is this sheet's own depth of use. */
function sheetEdits(bytes: Uint8Array<ArrayBuffer>, tokens: readonly CssToken[], inlined: (index: number) => string | null, depth: number): Edit[] {
  const edits: Edit[] = [];
  let text: string | null = null;
  const dropRule = (t: CssToken): Edit => {
    text ??= byteString(bytes);
    const rule = importRule(text, t);
    if (rule !== null) return { start: rule.start, end: rule.end, text: '' };
    return { start: t.start, end: t.end, text: isQuote(text.charCodeAt(t.start - 1)) ? 'data:,' : '"data:,"' };
  };
  tokens.forEach((t, i) => {
    const url = inlined(i);
    if (url !== null) {
      edits.push({ start: t.start, end: t.end, text: url });
    } else if (isFragment(t.raw)) {
      return;
    } else if (isDataUrl(t.raw)) {
      if (t.kind !== 'css') return;
      const nested = nestedSheet(t.raw, depth + 1);
      if (nested.kind === 'edit') edits.push({ start: t.start, end: t.end, text: nested.url });
      else if (nested.kind === 'drop') edits.push(dropRule(t));
    } else if (t.kind === 'css') {
      edits.push(dropRule(t));
    } else {
      text ??= byteString(bytes);
      edits.push({ start: t.start, end: t.end, text: isQuote(text.charCodeAt(t.start - 1)) ? 'data:,' : '"data:,"' });
    }
  });
  return edits;
}

/** A stylesheet's bytes with every reference off `data:` neutralised; `bytes` itself when nothing changed. */
function stripCssBytes(bytes: Uint8Array<ArrayBuffer>, depth: number): Uint8Array<ArrayBuffer> {
  return applyEdits(bytes, sheetEdits(bytes, scanCssBytes(bytes), () => null, depth));
}

/** CSS text (a style element's, a `style` attribute's, an attribute holding `url(`) stripped the same way. */
function stripCssText(text: string): string {
  if (!/url\(|@import/i.test(text)) return text;
  const bytes = encoder.encode(text);
  const out = stripCssBytes(bytes, 0);
  return out === bytes ? text : decoder.decode(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Step 2: inline
// ---------------------------------------------------------------------------------------------------------------
/** The file a reference reads, as `<section>/<path>`, or null when it is not a docs file. */
function fileKeyOf(ref: MockupRef): string | null {
  const slash = ref.basePath.indexOf('/');
  const r = resolveDocRef({ section: ref.basePath.slice(0, slash) as DocSectionSlug, path: ref.basePath.slice(slash + 1) }, ref.raw);
  return r.kind === 'doc' ? `${r.section}/${r.path}` : null;
}

/** How the sheet and the provenance name an asset: its repo path, or the reference as written where it does not resolve. */
function labelOf(ref: MockupRef): string {
  const slash = ref.basePath.indexOf('/');
  const r = resolveDocRef({ section: ref.basePath.slice(0, slash) as DocSectionSlug, path: ref.basePath.slice(slash + 1) }, ref.raw);
  if (r.kind === 'doc') return docRepoPath(r.section, r.path);
  return r.kind === 'repo' ? r.repoPath : ref.raw;
}

/** Why an asset is not in the file, as the closed class `EXPORT_MISSING_SENTENCE` words: a failed read (the failure word
 *  `timed-out`, which the builder gives a row it stopped waiting for, is "still loading"), another site, or the file's
 *  own budget (an admitted file the result does not hold, or the cap kept out); every other verdict is the page not
 *  showing it. */
function missingWhy(verdict: MockupRefVerdict | undefined): ExportMissing {
  switch (verdict?.v) {
    case 'failed': return verdict.failure === TIMED_OUT ? 'timed-out' : 'failed';
    case 'external': return 'external';
    case 'inline':
    case 'skipped': return 'over-size';
    default: return 'refused';
  }
}

/** One built use of a file: its `data:` URL, and the repo path of every file whose bytes that URL holds (the file itself,
 *  and for a stylesheet the files nested inside it that it inlined). */
interface BuiltUse { readonly url: string; readonly files: readonly string[] }

/** Inlines every reference the result holds into `extract`'s Document, and answers what it could not: `omitted`, each
 *  asset NONE of whose uses was written into the Document (repo path, or the reference as written where it does not
 *  resolve), once, in DOM order; a file with one use written and another cut is inlined, not omitted. And `why`, the
 *  reason by the reference as written on the page, for the `alt` of an image. */
function inlineAssets(extract: MockupExtract, assets: MockupAssetResult): { readonly omitted: readonly string[]; readonly why: ReadonlyMap<string, ExportMissing> } {
  const { plan } = assets;
  const project = plan.context.project;
  const rowByKey = new Map<string, MockupAssetRow>(plan.rows.map((r) => [r.ref.key, r]));
  const first = new Map<string, { readonly ref: MockupRef; readonly verdict: InlineVerdict }>();
  for (const row of plan.rows) {
    if (row.verdict.v !== 'inline' || row.size === null) continue;
    const key = fileKeyOf(row.ref);
    if (key !== null && !first.has(key)) first.set(key, { ref: row.ref, verdict: row.verdict });
  }
  const seen = new Set<string>(); // every asset a use of which was cut or could not be built, first seen first
  const written = new Set<string>(); // every asset a use of which was written into the Document
  const why = new Map<string, ExportMissing>();
  const omit = (ref: MockupRef, row: MockupAssetRow | undefined): void => {
    if (ref.kind === 'script' || ref.kind === 'module') return;
    if (row?.verdict.v === 'kept' || ref.raw.trim() === '') return;
    seen.add(labelOf(ref));
    if (ref.depth === 0 && !why.has(ref.raw)) why.set(ref.raw, missingWhy(row?.verdict));
  };

  const built = new Map<string, BuiltUse>();
  /** One use of a file at nesting depth `depth`: its `data:` URL (the row's MIME) and the files that URL holds, or null when
   *  it is not inlined. */
  const build = (row: MockupAssetRow, depth: number): BuiltUse | null => {
    if (row.verdict.v !== 'inline') return null;
    const key = fileKeyOf(row.ref);
    const canon = key === null ? undefined : first.get(key);
    if (key === null || canon === undefined) return null;
    const asset = assets.assets.get(docsApi.file(project, canon.verdict.pin));
    if (asset === undefined) return null;
    const mime = canon.verdict.mime;
    const path = docRepoPath(canon.verdict.pin.section, canon.verdict.pin.path);
    if (canon.verdict.kind !== 'css') {
      const known = built.get(key);
      if (known !== undefined) return known;
      const use = { url: `data:${mime};base64,${base64Of(asset.bytes)}`, files: [path] };
      built.set(key, use);
      return use;
    }
    const at = `${key}@${depth}`;
    const known = built.get(at);
    if (known !== undefined) return known;
    const { tokens, refs } = scanCssBytesRefs(asset.bytes, canon.ref);
    const deep = depth + 1 <= MOCKUP_MAX_CSS_DEPTH;
    const files = new Set<string>([path]);
    const nested = refs.map((r) => {
      const child = rowByKey.get(r.key);
      const use = deep && child !== undefined ? build(child, depth + 1) : null;
      if (use === null) omit(r, child);
      else for (const f of use.files) files.add(f);
      return use?.url ?? null;
    });
    const use = {
      url: `data:${mime};base64,${base64Of(applyEdits(asset.bytes, sheetEdits(asset.bytes, tokens, (i) => nested[i] ?? null, depth)))}`,
      files: [...files],
    };
    built.set(at, use);
    return use;
  };

  const replacements = new Map<string, string>();
  let spent = 0;
  let cut = false; // the first use that does not fit sets this: from then on nothing is inlined
  for (const ref of extract.refs) {
    if (ref.kind === 'script' || ref.kind === 'module') continue;
    const row = rowByKey.get(ref.key);
    let use = cut || row === undefined ? null : build(row, 0);
    if (use !== null && spent + use.url.length > DOCS_EXPORT_MAX_BYTES) {
      cut = true;
      // Nothing of a cut use is written: a stylesheet's nested files go out with it, unless another use wrote them.
      for (const f of use.files) seen.add(f);
      use = null;
    }
    if (use === null) {
      omit(ref, row);
    } else {
      spent += use.url.length;
      replacements.set(ref.key, use.url);
      for (const f of use.files) written.add(f);
    }
  }
  extract.apply(replacements);
  // An admitted file no use of which was reached (a nested file of a stylesheet that was cut before it was built, or whose
  // bytes the result does not hold) is not written either.
  for (const { verdict } of plan.rows) if (verdict.v === 'inline') seen.add(docRepoPath(verdict.pin.section, verdict.pin.path));
  return { omitted: [...seen].filter((label) => !written.has(label)), why };
}

/** An `img` or `input[type=image]` whose `src` is still not `data:` was not inlined: it takes the closed missing sentence
 *  as its `alt` (a placeholder, base 5.6.8). */
function markMissingImages(clone: Document, why: ReadonlyMap<string, ExportMissing>): void {
  for (const el of clone.querySelectorAll('img, input')) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.localName === 'input' && (el.getAttribute('type') ?? '').trim().toLowerCase() !== 'image') continue;
    const src = el.getAttribute('src');
    if (src === null || src.trim() === '' || isDataUrl(src)) continue;
    el.setAttribute('alt', EXPORT_MISSING_SENTENCE[why.get(src) ?? 'refused']);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Step 3: strip
// ---------------------------------------------------------------------------------------------------------------
/** The HTML URL attributes of the allowlist, and `xlink:href`, which is read on an SVG element and dropped on any. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'archive', 'background', 'cite', 'classid', 'codebase', 'data', 'href', 'icon', 'itemid', 'longdesc', 'manifest',
  'poster', 'profile', 'src', 'usemap', 'xlink:href',
]);
/** Attributes that act when the page is opened or submitted, or that ask the browser to report to a URL: always dropped. */
const ACTIVE_ATTRIBUTES: ReadonlySet<string> = new Set(['srcdoc', 'action', 'formaction', 'ping', 'attributionsrc']);
/** The attributes that hold a list of image candidates: `srcset`, and the `link`'s own `imagesrcset`. One rule for both. */
const CANDIDATE_LISTS: ReadonlySet<string> = new Set(['srcset', 'imagesrcset']);
/** The SMIL elements that can set an attribute over time. */
const SMIL_ELEMENTS: ReadonlySet<string> = new Set(['animate', 'set', 'animateMotion', 'animateTransform']);
const HREF_NAMES: ReadonlySet<string> = new Set(['href', 'xlink:href']);

/** Whether every candidate of a `srcset` value is a `data:` URL, read with the extractor's own srcset grammar
 *  (`parseSrcset`, `load.ts`): at least one candidate, every candidate's URL `data:`, and no candidate the grammar
 *  dropped (a dropped candidate's URL is unknown, so the attribute goes). An empty value has no candidate and goes too. */
function srcsetIsAllData(value: string): boolean {
  const { candidates, dropped } = parseSrcset(value);
  return dropped.length === 0 && candidates.length > 0 && candidates.every((c) => isDataUrl(c.url));
}

/** Whether a `link` survives: a stylesheet whose `href` is a decodable `data:` URL, stripped inside (its own references
 *  and any `data:` @import). Every other link is the caller's to drop. */
function keepDataStylesheet(link: Element): boolean {
  const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/);
  const href = link.getAttribute('href');
  if (!rel.includes('stylesheet') || href === null || !isDataUrl(href)) return false;
  const decoded = decodeDataUrl(href);
  if (decoded === null) return false;
  const stripped = stripCssBytes(decoded.bytes, 0);
  if (stripped !== decoded.bytes) link.setAttribute('href', encodeDataUrl(decoded.head, stripped));
  return true;
}

/** The elements the file never carries: template, scripts, frames, objects, embeds, base, `meta[http-equiv]`, SMIL that
 *  targets `href`, and every `link` but a `data:` stylesheet; noscript is unwrapped, its children kept. */
function dropInertElements(clone: Document): void {
  for (const t of [...clone.querySelectorAll('template')]) t.remove();
  for (const n of [...clone.querySelectorAll('noscript')]) n.replaceWith(...n.childNodes);
  for (const el of [...clone.querySelectorAll('script, iframe, frame, object, embed, base, meta[http-equiv]')]) el.remove();
  for (const link of [...clone.querySelectorAll('link')]) if (!keepDataStylesheet(link)) link.remove();
  for (const el of [...clone.querySelectorAll('*')]) {
    if (SMIL_ELEMENTS.has(el.localName) && HREF_NAMES.has((el.getAttribute('attributeName') ?? '').trim())) el.remove();
  }
}

/** Step 5: `href` and `xlink:href` off every `a` and `area` (HTML and SVG), the target into `title` and into the answer. */
function removeLinks(clone: Document): string[] {
  const links: string[] = [];
  for (const el of clone.querySelectorAll('a, area')) {
    const target = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    el.removeAttribute('href');
    el.removeAttribute('xlink:href');
    if (target === null || target.trim() === '') continue;
    links.push(target);
    const title = el.getAttribute('title') ?? '';
    el.setAttribute('title', title === '' ? target : `${title} (${target})`);
  }
  return links;
}

/** Steps 3 and 4 over every attribute: handlers and active attributes out, `srcset` and the URL allowlist checked, CSS in
 *  a `style` attribute (or any attribute holding `url(`) neutralised. */
function stripAttributes(clone: Document): void {
  for (const el of clone.querySelectorAll('*')) {
    const svg = el instanceof SVGElement;
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ACTIVE_ATTRIBUTES.has(name)) {
        el.removeAttributeNode(attr);
      } else if (CANDIDATE_LISTS.has(name)) {
        if (!srcsetIsAllData(attr.value)) el.removeAttributeNode(attr);
      } else if (URL_ATTRIBUTES.has(name)) {
        const local = svg && HREF_NAMES.has(name) && isFragment(attr.value) && el.localName !== 'a' && el.localName !== 'image';
        if (!isDataUrl(attr.value) && !local) el.removeAttributeNode(attr);
      } else if (name === 'style' || /url\(/i.test(attr.value)) {
        attr.value = stripCssText(attr.value);
      }
    }
  }
  for (const style of clone.querySelectorAll('style')) {
    const text = style.textContent ?? '';
    const css = stripCssText(text);
    if (css !== text) style.textContent = css;
  }
}

/** Step 6: the CSP meta as the first child of `<head>`, made with DOM calls. */
function addCspMeta(clone: Document): void {
  const meta = clone.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', DOCS_EXPORT_CSP);
  const head = clone.head as HTMLHeadElement | null;
  const into = head ?? clone.documentElement.insertBefore(clone.createElement('head'), clone.documentElement.firstChild);
  into.insertBefore(meta, into.firstChild);
}

/** The mockup export's snapshot of `doc` (the viewer's parsed inert Document, never changed) with the loaded `assets`. */
export function buildMockupSnapshot(doc: Document, assets: MockupAssetResult): MockupSnapshot {
  const clone = doc.cloneNode(true) as Document;
  const { section, path } = assets.plan.context.pin;
  const { omitted, why } = inlineAssets(extractMockupRefs(clone, `${section}/${path}`), assets);
  markMissingImages(clone, why);
  dropInertElements(clone);
  const links = removeLinks(clone);
  stripAttributes(clone);
  addCspMeta(clone);
  return { html: EXPORT_PREFIX + clone.documentElement.outerHTML, links, omitted };
}
