// The mockup's CSS scan (native Docs reader, completion plan Task 7, C1; base spec 2026-10-01 5.6.3's CSS scanning and
// Asset MIME, row M5.12). Ring L1: pure functions over text, no DOM, no I/O, no timer. ONE linear scan of a stylesheet
// finds the two patterns the spec names and nothing else: `url(...)` with an unquoted, single-quoted or double-quoted
// argument, and `@import` followed by a quoted string (`@import url(...)` is the url pattern, classed as an import). The
// scan returns tokens in TEXT order, which is the only order anything downstream may use (never sorted by kind), and
// leaves every other form (an escape, a comment inside a name, an `image-set` string) unmatched and untouched: the
// rewriter is a convenience and the CSP is the wall, so a form it misses fails closed with no request made.
//
// Linear time: every character is passed once, a comment or string is skipped in one step, and the one lookahead (the
// argument of a `url(`) can only run to the next delimiter, which the scan then passes again at most once more. There is
// no backtracking pattern anywhere, so a 2 MiB adversarial text scans in time proportional to its length.
import { resolveDocRef, type DocSectionSlug } from '../../../../shared/docs';
import type { MockupAssetKind } from './policy';
import type { MockupBase, MockupRef } from './ports';

/** One reference found in CSS text: `raw` is the argument as written (without quotes), `start..end` its span in the text
 *  (what a rewrite replaces), `kind` what the rule loads it as. */
export interface CssToken {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly kind: Extract<MockupAssetKind, 'css' | 'font' | 'image'>;
}

const BACKSLASH = 0x5c;
const isCssSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;
const isQuote = (c: number): boolean => c === 0x22 || c === 0x27;
const isNameChar = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2d || c === 0x5f || c > 0x7f || c === BACKSLASH;

/** Whether `word` (lower-case ASCII) stands at `at`, in any case, and is not the start of a longer name. */
function wordAt(text: string, at: number, word: string): boolean {
  if (at + word.length > text.length) return false;
  for (let k = 0; k < word.length; k += 1) {
    let c = text.charCodeAt(at + k);
    if (c >= 0x41 && c <= 0x5a) c += 0x20;
    if (c !== word.charCodeAt(k)) return false;
  }
  return at + word.length === text.length || !isNameChar(text.charCodeAt(at + word.length));
}

/** `url(` in any case at `at`, not the tail of a longer name (`myurl(`, `src-url(`). */
function urlOpensAt(text: string, at: number): boolean {
  if (at > 0 && isNameChar(text.charCodeAt(at - 1))) return false;
  if (at + 4 > text.length || text.charCodeAt(at + 3) !== 0x28) return false;
  return wordAt(text, at, 'url');
}

function skipSpace(text: string, at: number): number {
  let i = at;
  while (i < text.length && isCssSpace(text.charCodeAt(i))) i += 1;
  return i;
}

/** The end of the string whose opening quote is at `at`: past its closing quote, at a bare newline (CSS ends a string
 *  there) or at the end of the text. A backslash skips the next character. */
function skipString(text: string, at: number): number {
  const q = text.charCodeAt(at);
  let i = at + 1;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === q) return i + 1;
    if (c === 0x0a || c === 0x0d || c === 0x0c) return i;
    i += c === BACKSLASH ? 2 : 1;
  }
  return text.length;
}

interface Arg { readonly start: number; readonly end: number; readonly after: number }

/** A quoted string argument whose opening quote is at `at`: its content span, with no escape and no newline inside, and
 *  `after` the index past the closing quote. Null when the string is not that. */
function quotedAt(text: string, at: number): Arg | null {
  const q = text.charCodeAt(at);
  for (let i = at + 1; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === q) return i === at + 1 ? null : { start: at + 1, end: i, after: i + 1 };
    if (c === BACKSLASH || c === 0x0a || c === 0x0d || c === 0x0c) return null;
  }
  return null;
}

/** The argument of a `url(` whose opening parenthesis ends at `at`: quoted or unquoted, then optional space, then `)`.
 *  Null for an empty argument, an escape, an unquoted argument holding a space, quote or parenthesis, or a missing `)`;
 *  `after` is the index past the `)`. */
function urlArgAt(text: string, at: number): Arg | null {
  const j = skipSpace(text, at);
  if (j >= text.length) return null;
  let arg: Arg | null;
  if (isQuote(text.charCodeAt(j))) {
    arg = quotedAt(text, j);
    if (arg === null) return null;
    const close = skipSpace(text, arg.after);
    return text.charCodeAt(close) === 0x29 ? { start: arg.start, end: arg.end, after: close + 1 } : null;
  }
  let k = j;
  while (k < text.length) {
    const c = text.charCodeAt(k);
    if (c === 0x29 || isCssSpace(c)) break;
    if (isQuote(c) || c === 0x28 || c === BACKSLASH || c < 0x20 || c === 0x7f) return null;
    k += 1;
  }
  if (k === j) return null;
  const close = skipSpace(text, k);
  return text.charCodeAt(close) === 0x29 ? { start: j, end: k, after: close + 1 } : null;
}

/** The two patterns, once, in text order (base 5.6.3). A comment and a string are skipped whole, so a `url(` written in
 *  either is not a reference and a quote in a comment starts no string. */
export function scanCss(text: string): CssToken[] {
  const out: CssToken[] = [];
  const n = text.length;
  let i = 0;
  let braces = 0;
  let fontAt = -1; // the brace depth of the open @font-face block, or -1
  let fontPending = false; // `@font-face` seen, its `{` not yet
  let namespacePending = false; // `@namespace` seen, its `;` not yet: a url() there names a namespace, not an asset
  const push = (arg: Arg, kind: CssToken['kind']): void => {
    out.push({ start: arg.start, end: arg.end, raw: text.slice(arg.start, arg.end), kind });
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x2f && text.charCodeAt(i + 1) === 0x2a) {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (isQuote(c)) {
      i = skipString(text, i);
    } else if (c === 0x7b) {
      namespacePending = false;
      braces += 1;
      if (fontPending) {
        fontAt = braces;
        fontPending = false;
      }
      i += 1;
    } else if (c === 0x7d) {
      if (braces > 0) {
        if (fontAt === braces) fontAt = -1;
        braces -= 1;
      }
      i += 1;
    } else if (c === 0x3b) {
      fontPending = false;
      namespacePending = false;
      i += 1;
    } else if (c === 0x40) {
      if (wordAt(text, i + 1, 'font-face')) {
        fontPending = true;
        i += 10;
      } else if (wordAt(text, i + 1, 'namespace')) {
        namespacePending = true;
        i += 10;
      } else if (wordAt(text, i + 1, 'import')) {
        i = scanImport(text, i + 7, push);
      } else {
        i += 1;
      }
    } else if ((c === 0x75 || c === 0x55) && urlOpensAt(text, i)) {
      const arg = urlArgAt(text, i + 4);
      if (arg === null) {
        i += 4;
      } else {
        if (!namespacePending) push(arg, fontAt >= 0 ? 'font' : 'image');
        i = arg.after;
      }
    } else {
      i += 1;
    }
  }
  return out;
}

/** After `@import` (its index `at`): a quoted string, or a `url(...)`, is a css token; anything else is none. Returns the
 *  index the scan resumes at. */
function scanImport(text: string, at: number, push: (arg: Arg, kind: 'css') => void): number {
  const j = skipSpace(text, at);
  const c = text.charCodeAt(j);
  if (isQuote(c)) {
    const arg = quotedAt(text, j);
    if (arg === null) return j;
    push(arg, 'css');
    return arg.after;
  }
  if ((c === 0x75 || c === 0x55) && urlOpensAt(text, j)) {
    const arg = urlArgAt(text, j + 4);
    if (arg === null) return j + 4;
    push(arg, 'css');
    return arg.after;
  }
  return j;
}

/** `text` with the span of each token `replacement(index)` names (a `data:` URL) replaced, in one pass; a null answer
 *  leaves that token as written. `tokens` must be `scanCss(text)`'s, in text order. Nothing outside the spans changes. */
export function rewriteCss(text: string, tokens: readonly CssToken[], replacement: (index: number) => string | null): string {
  let out = '';
  let at = 0;
  tokens.forEach((t, i) => {
    const r = replacement(i);
    if (r === null) return;
    out += text.slice(at, t.start) + r;
    at = t.end;
  });
  return out + text.slice(at);
}

/** The references of `tokens` as `MockupRef`s in the same order, each keyed by `keyOf(index)`, all resolved from `base`
 *  at `depth`. Never sorted: the order is the text's. */
export function refsFromTokens(
  tokens: readonly CssToken[], base: MockupBase, depth: number, keyOf: (index: number) => string,
): MockupRef[] {
  return tokens.map((t, i) => ({ key: keyOf(i), raw: t.raw, basePath: base, kind: t.kind, depth }));
}

/** `tokens` (a linked stylesheet's) and their references: `parent` is the reference that loaded it. Keys are
 *  `${parent.key}>${index}` (deterministic, in text order), `depth` is the parent's plus one, and `basePath` is the
 *  stylesheet's own `<section>/<path>`, resolved from `parent` by the one reference grammar (`resolveDocRef`), so every
 *  reference in it resolves relative to the css file, not to the page. THROWS when `parent` does not resolve to a docs
 *  file: the loader only asks for a stylesheet it was admitted to read. `refs[i]` is `tokens[i]`'s reference. */
function sheetRefs(tokens: CssToken[], parent: MockupRef): { tokens: CssToken[]; refs: MockupRef[] } {
  const slash = parent.basePath.indexOf('/');
  const r = resolveDocRef({ section: parent.basePath.slice(0, slash) as DocSectionSlug, path: parent.basePath.slice(slash + 1) }, parent.raw);
  if (r.kind !== 'doc') throw new Error(`scanCssRefs: '${parent.raw}' is not a docs file`);
  return { tokens, refs: refsFromTokens(tokens, `${r.section}/${r.path}`, parent.depth + 1, (i) => `${parent.key}>${i}`) };
}

/** A linked stylesheet's text scanned, with its references (see `sheetRefs`). */
export function scanCssRefs(text: string, parent: MockupRef): { tokens: CssToken[]; refs: MockupRef[] } {
  return sheetRefs(scanCss(text), parent);
}

/** The references a linked stylesheet's text holds (`scanCssRefs`'s second half). */
export function extractCssRefs(text: string, parent: MockupRef): MockupRef[] {
  return scanCssRefs(text, parent).refs;
}

// ---------------------------------------------------------------------------------------------------------------
// The same scan over BYTES: what the loader and the build use, so a stylesheet keeps its bytes. A sheet is not always
// UTF-8 (a `@charset "iso-8859-1"` sheet, a stray invalid byte), and decoding then re-encoding it would replace such
// bytes. The scan reads each byte as one character (the pattern characters are all ASCII, and every byte above 0x7f is a
// name character either way), so a token's span is a byte offset, and the reference's text is decoded from its own bytes.
// ---------------------------------------------------------------------------------------------------------------
const rawDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** One character per byte (the byte's own value), in chunks small enough to spread. */
function byteString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x2000) out += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return out;
}

/** `scanCss` over bytes: spans are byte offsets, `raw` is the argument's own bytes decoded as UTF-8. */
export function scanCssBytes(bytes: Uint8Array): CssToken[] {
  return scanCss(byteString(bytes)).map((t) => ({ ...t, raw: rawDecoder.decode(bytes.subarray(t.start, t.end)) }));
}

/** `scanCssRefs` over bytes. */
export function scanCssBytesRefs(bytes: Uint8Array, parent: MockupRef): { tokens: CssToken[]; refs: MockupRef[] } {
  return sheetRefs(scanCssBytes(bytes), parent);
}

/** `bytes` with the span of each token `replacement(index)` names replaced by that (ASCII) text and every other byte
 *  copied as it stands. With no token chosen it returns `bytes` itself. `tokens` must be `scanCssBytes(bytes)`'s. */
export function rewriteCssBytes(
  bytes: Uint8Array<ArrayBuffer>, tokens: readonly CssToken[], replacement: (index: number) => string | null,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [];
  let at = 0;
  tokens.forEach((t, i) => {
    const r = replacement(i);
    if (r === null) return;
    pieces.push(bytes.subarray(at, t.start), encoder.encode(r));
    at = t.end;
  });
  if (pieces.length === 0) return bytes;
  pieces.push(bytes.subarray(at));
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
