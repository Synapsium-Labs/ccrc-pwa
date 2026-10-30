/**
 * THE CREDENTIAL SHAPES (D-5513, D-5995): the shape half of the egress mask, moved here whole from
 * `accounts/mask.ts#SecretMasker` (D-7513). Every entry of `CREDENTIAL_MASKS` (`shared/api.ts`, the one home) as a
 * matcher with its boundary; the two views of a text (every ECMA-48 escape stripped, and as a delimiter, a row move as
 * a row end in both); and the spans the shapes cover in a text, in rows mode across the TUI's early wraps.
 * `accounts/mask.ts#SecretMasker` reads them for its shape half and for its exact-bytes candidates, so there is one
 * copy of each and one view memo.
 *
 * `SHAPE_MASK` is the shape-only mask of a decoded value, a plain function of it: what the masker's keyless instance
 * answers, read without the masker, so an inner module (the transcript parse) masks with it (D-7513).
 *
 * Ring L1: this module holds no timer, no clock, no database and no route.
 */
import { CREDENTIAL_MASKS, SECRET_MASK, type CredentialMask } from '../../../shared/api.js';

/** A candidate run's byte bounds (a fingerprint row's `len` lies within them). */
export const RUN_MIN_BYTES = 20;
export const RUN_MAX_BYTES = 8192;

// ── the two views of a text ────────────────────────────────────────────────

/** Every ECMA-48 escape: CSI; OSC to BEL or ST; DCS, SOS, PM and APC to ST; ESC + intermediates + final. */
const ESC_SEQ = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[ -/]*[0-~])/g;
/** The most columns of indent a cursor move stands for in a view: a wider move is a screen's, never a wrap's. */
const INDENT_COLUMNS_MAX = 512;
/** `n` columns of indent: one NUL per column, so a row's view length is its width in columns (D-5995). */
const indentOf = (n: number): string => '\0'.repeat(Math.min(Math.max(n, 0), INDENT_COLUMNS_MAX));
/** A row move's stand-in (D-5995): a newline, with a NUL per column of indent when it lands past the first column
 *  (a CUP or HVP's column is known; a move down keeps an unknown column, one NUL). */
function rowMove(e: string): string | null {
  if (e.length === 2) return e === '\x1bE' ? '\n' : e === '\x1bD' ? '\n\0' : null;
  if (e[1] !== '[' || !'HfEFdB'.includes(e[e.length - 1]!)) return null;   // the common escape: no regex (D-5995)
  const m = /^\x1b\[([0-9;]*)([HfEFdB])$/.exec(e);
  if (m !== null) {
    if (m[2] === 'H' || m[2] === 'f') return `\n${indentOf(Number(m[1]!.split(';')[1] || '1') - 1)}`;
    return m[2] === 'E' || m[2] === 'F' ? '\n' : '\n\0';
  }
  if (e === '\x1bE') return '\n';
  if (e === '\x1bD') return '\n\0';
  return null;
}
/** A text's view with every escape stripped (`sep: ''`) or replaced by one NUL (`sep: '\0'`), a row move by its
 *  stand-in in both, and the map from each view index to its index in the original (`map[t.length]` is the
 *  original's length). */
export interface View { readonly t: string; readonly map: Int32Array | null }
/** The last text's two views: one mask reads the same text's views in several passes (D-5995). */
let viewMemo: { s: string; v: [View | null, View | null] } = { s: '', v: [null, null] };
export function viewOf(s: string, sep: '' | '\0'): View {
  if (!s.includes('\x1b')) return { t: s, map: null };   // no escape: the view is the text (the common case)
  if (viewMemo.s !== s) viewMemo = { s, v: [null, null] };
  const k = sep === '' ? 0 : 1;
  return viewMemo.v[k] ??= buildView(s, sep);
}
/** A cursor move forward (CUF) of `n` columns, or null. */
function cursorForward(e: string): number | null {
  if (e[1] !== '[' || e[e.length - 1] !== 'C') return null;
  const m = /^\x1b\[([0-9]*)C$/.exec(e);
  return m === null ? null : Number(m[1] || '1');
}
function buildView(s: string, sep: '' | '\0'): View {
  const parts: string[] = [];
  let map = new Int32Array(s.length + 1);
  let n = 0;
  let from = 0;
  // Whether nothing but escapes lies between the last row break and here: a cursor move forward there is an indent,
  // drawn as one NUL per column in both views, so a wrapped row measures as wide as the terminal drew it (D-5995).
  let rowStart = true;
  const copy = (a: number, b: number): void => {
    if (b <= a) return;
    parts.push(s.slice(a, b));
    for (let i = a; i < b; i++) map[n++] = i;
    rowStart = s[b - 1] === '\n' || s[b - 1] === '\r';
  };
  ESC_SEQ.lastIndex = 0;
  for (let m = ESC_SEQ.exec(s); m !== null; m = ESC_SEQ.exec(s)) {
    copy(from, m.index);
    const move = rowMove(m[0]);
    const cuf = move === null && rowStart ? cursorForward(m[0]) : null;
    const put = move ?? (cuf === null ? sep : indentOf(cuf));
    if (move !== null) rowStart = true;
    if (put !== '') parts.push(put);
    if (n + put.length + s.length - m.index >= map.length) {   // an indent wider than its escape: room for the rest
      const grown = new Int32Array(map.length * 2 + put.length);
      grown.set(map.subarray(0, n));
      map = grown;
    }
    for (let k = 0; k < put.length; k++) map[n++] = m.index;
    from = m.index + m[0].length;
  }
  copy(from, s.length);
  map[n] = s.length;
  return { t: parts.join(''), map: map.subarray(0, n + 1) };
}
/** A view span [a, b) as an original span. */
export const spanIn = (v: View, a: number, b: number): [number, number] =>
  (v.map === null ? [a, b] : [v.map[a]!, v.map[b - 1]! + 1]);
export const origin = (v: View, i: number): number => (v.map === null ? i : v.map[i]!);

// ── shapes ─────────────────────────────────────────────────────────────────

/** A shape's left boundary (D-5995): no letter or digit before it, or a literal JSON escape (`\n` `\r` `\t`, a
 *  `\uXXXX`), a `\xXX` escape, or a percent-escape. */
const BOUNDARY = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrt])|(?<=\\u[0-9A-Fa-f]{4})|(?<=\\x[0-9A-Fa-f]{2})|(?<=%[0-9A-Fa-f]{2}))`;

/** One regular expression per shape, each with its boundary (a lookbehind source keeps its own). */
export function shapeMatchers(masks: readonly CredentialMask[] = CREDENTIAL_MASKS): RegExp[] {
  return masks.map((m) => new RegExp(m.source.startsWith('(?<=') ? m.source : `${BOUNDARY}(?:${m.source})`, 'g'));
}
export const SHAPES = shapeMatchers();

/** The next row's leading token run after a span that ends at its row's end: [start, end) in `t`, or null. A TUI
 *  wrap is INDENTED (Claude Code indents the rows a long line wraps into; tmux may draw that indent as a cursor move,
 *  which both views read as a NUL), so a next row with no indent is a new line, never a wrap. Sticky expressions:
 *  nothing is sliced, so a text with many matches stays linear (D-5995). */
export const ROW_END = /[ \t\0]*(?:[│┃|][ \t\0]*)?(?:\r\n|\r|\n)/y;
/** Where a row's text ends before its row end at `e` (D-5995): back over blanks, a box's right rule (a side-bordered
 *  dialog draws one on every row a key wraps across, mirroring `ROW_INDENT`'s left rule) and the blanks before it. */
export function rowTextEnd(t: string, e: number): number {
  const blank = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\0';
  while (e > 0 && blank(t[e - 1])) e--;
  if (e > 0 && (t[e - 1] === '│' || t[e - 1] === '┃' || t[e - 1] === '|')) {
    e--;
    while (e > 0 && blank(t[e - 1])) e--;
  }
  return e;
}
export const ROW_INDENT = /(?:[ \t\0]|│|┃|\|)+/y;
export const TOKEN_RUN = /[A-Za-z0-9_+/.-]+/y;
const TEXT_END = /[ \t\0]*(?:\r\n|\r|\n)?$/y;
function continuationAfter(t: string, end: number): [number, number] | null {
  ROW_END.lastIndex = end;
  const nl = ROW_END.exec(t);
  return nl === null ? null : leadingRun(t, end + nl[0].length);
}
export function leadingRun(t: string, from: number): [number, number] | null {
  ROW_INDENT.lastIndex = from;
  const indent = ROW_INDENT.exec(t);
  if (indent === null) return null;
  const at = from + indent[0].length;
  TOKEN_RUN.lastIndex = at;
  const run = TOKEN_RUN.exec(t);
  return run === null ? null : [at, at + run[0].length];
}
/** A code point a terminal draws in no column of its own (D-5995): a mark (a variation selector among them), a format
 *  character (a zero-width joiner or space, a tag), an emoji skin-tone modifier, a conjoining jamo vowel or final. */
const ZERO_COLUMN = /^[\p{M}\p{Cf}\u{1F3FB}-\u{1F3FF}\u1160-\u11FF\uD7B0-\uD7FF]$/u;
/** The columns of `t`'s span [a, b), never more than a terminal draws it in (D-5995): a row's UTF-16 length is its
 *  width only in ASCII, and an emoji sequence (a flag, a ZWJ family, a skin tone, a keycap), a combining mark or a
 *  surrogate pair holds more units than columns, so the row before a wrapped key read as fuller than the key's own
 *  rows and its third and later rows were drawn in clear. A pair, and a code point a ZWJ joins, counts once at most;
 *  a wide character counts one, which only reads a row as less full (the join goes on, never stops early). */
function columnsOf(t: string, a: number, b: number): number {
  let n = 0;
  for (let i = a; i < b; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x300) { n++; continue; }   // ASCII, Latin and a NUL indent: one column each (the common case)
    if (c >= 0xdc00 && c <= 0xdfff) continue;   // a pair's second unit
    if (i > a && t.charCodeAt(i - 1) === 0x200d) continue;   // joined to the code point before it
    if (!ZERO_COLUMN.test(String.fromCodePoint(t.codePointAt(i)!))) n++;
  }
  return n;
}
/** The row widths of one text, in columns, from one index of its line breaks (D-5995: built once, in rows mode only;
 *  each row is measured once, on first use). */
class Rows {
  private readonly breaks: number[] = [];
  private readonly widths = new Map<number, number>();
  constructor(private readonly t: string) {
    const re = /[\r\n]/g;
    for (let m = re.exec(t); m !== null; m = re.exec(t)) this.breaks.push(m.index);
  }
  /** The width of the row `i` sits on. */
  length(i: number): number {
    const b = this.breaks;
    let lo = 0; let hi = b.length;   // first break at or after i
    while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid]! < i) lo = mid + 1; else hi = mid; }
    let w = this.widths.get(lo);
    if (w === undefined) {
      const start = lo > 0 ? b[lo - 1]! + 1 : 0;
      const end = lo < b.length ? b[lo]! : this.t.length;
      this.widths.set(lo, (w = columnsOf(this.t, start, end)));
    }
    return w;
  }
}

/** Every shape starts with one of these, so a text holding none of them holds no shape. */
const SHAPE_HINT = /sk-|eyJ|_token"|OPENAI_API_KEY"/;
/** A shape's start at a boundary (D-5995): `sk-` or `eyJ`. */
export const SHAPE_STARTED = new RegExp(`${BOUNDARY}(?:sk-|eyJ)`);
/** A row's trailing token run, read back from its row end. */
const isRunByte = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
  || c === 0x5f || c === 0x2b || c === 0x2f || c === 0x2e || c === 0x2d;

/** A rows-mode view with the TUI's early wraps joined (D-5995): `t` is the view's text with each JOINED row end and
 *  its indent removed, `map` takes a `t` index to a view index, and `seams` are the `t` indices where a removed row
 *  end lay. A row end is joined when the run that ends its row has begun a shape (`sk-` or `eyJ` at a boundary, or
 *  a prefix of one that the next row's leading run completes) and the next row is indented with a leading run; the
 *  join goes on through every further row while the row before was as full as the first and its run filled it. So a
 *  key wrapped before its first row holds enough of it to match is matched whole. Null: nothing to join. */
interface Joined { readonly t: string; readonly map: Int32Array; readonly seams: number[] }
function joinWraps(t: string): Joined | null {
  const cuts: [number, number][] = [];   // view spans [row end, next run start) removed
  LINE_BREAK_ANY.lastIndex = 0;
  for (let b = LINE_BREAK_ANY.exec(t); b !== null; b = LINE_BREAK_ANY.exec(t)) {
    if (cuts.length > 0 && b.index < cuts[cuts.length - 1]![1]) continue;   // inside a join already made
    const e = rowTextEnd(t, b.index);
    let a = e;
    while (a > 0 && e - a < RUN_MAX_BYTES && isRunByte(t.charCodeAt(a - 1))) a--;
    if (a === e) continue;
    const next = continuationAfter(t, e);
    if (next === null) continue;
    const probe = t.slice(a, e) + t.slice(next[0], Math.min(next[1], next[0] + 3));
    const sh = SHAPE_STARTED.exec(probe);
    if (sh === null || sh.index >= e - a) continue;
    if (matchesShape(t.slice(a, e))) continue;   // matched on its own row: the shape's own continuation follows it
    cuts.push([e, next[0]]);
    // On through every row the run fills, while each is as full as the first.
    const rowStart = Math.max(t.lastIndexOf('\n', e - 1), t.lastIndexOf('\r', e - 1)) + 1;
    const full = columnsOf(t, rowStart, e);
    let [from, end] = next;
    for (;;) {
      const nextRowStart = Math.max(t.lastIndexOf('\n', from - 1), t.lastIndexOf('\r', from - 1)) + 1;
      if (columnsOf(t, nextRowStart, end) < full) break;
      const more = continuationAfter(t, end);
      if (more === null) break;
      cuts.push([end, more[0]]);
      [from, end] = more;
    }
    LINE_BREAK_ANY.lastIndex = end;
  }
  if (cuts.length === 0) return null;
  const parts: string[] = [];
  const map = new Int32Array(t.length + 1);
  const seams: number[] = [];
  let n = 0; let at = 0;
  for (const [a, b] of cuts) {
    parts.push(t.slice(at, a));
    for (let i = at; i < a; i++) map[n++] = i;
    seams.push(n);
    at = b;
  }
  parts.push(t.slice(at));
  for (let i = at; i < t.length; i++) map[n++] = i;
  map[n] = t.length;
  return { t: parts.join(''), map: map.subarray(0, n + 1), seams };
}
const LINE_BREAK_ANY = /\r\n|\r|\n/g;
/** Whether a run holds a whole shape on its own. */
export const matchesShape = (run: string): boolean => SHAPES.some((re) => { re.lastIndex = 0; return re.test(run); });
/** Whether a seam lies strictly inside [a, b): one binary search over the sorted seams. */
function seamWithin(seams: readonly number[], a: number, b: number): boolean {
  const k = firstSeamAfter(seams, a);
  return k < seams.length && seams[k]! < b;
}
/** The index of the first seam past `a`. */
function firstSeamAfter(seams: readonly number[], a: number): number {
  let lo = 0; let hi = seams.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (seams[mid]! <= a) lo = mid + 1; else hi = mid; }
  return lo;
}

export function shapeSpans(s: string, rows: boolean, masks: readonly RegExp[]): { spans: [number, number][]; carry: boolean } {
  const spans: [number, number][] = [];
  let carry = false;
  const hasEsc = s.includes('\x1b');
  // In rows mode a shape the TUI wrapped early may hold no hint until its rows are joined.
  if (!rows && !SHAPE_HINT.test(hasEsc ? s.replace(ESC_SEQ, '') : s)) return { spans, carry };
  for (const sep of ['', '\0'] as const) {
    if (sep === '\0' && !hasEsc) break;   // with no escape the two views are one
    const v = viewOf(s, sep);
    const joined = rows ? joinWraps(v.t) : null;
    // The joined text AND the text as drawn (D-5995): a join glues a run that has begun a shape and matches none (a
    // base64 JSON blob's `eyJ…`, a name like `sk-v1.py`) to the next row's leading run, so a key that begins that row
    // loses its left boundary in the joined text; the text as drawn keeps it. The union of both is masked.
    for (const j of joined === null ? [null] : [joined, null]) {
      const t = j === null ? v.t : j.t;
      if (!SHAPE_HINT.test(t)) continue;
      /** A span of `t` as original spans: split at each joined seam, so a row end between its rows is kept. */
      const put = (a: number, b: number): void => {
        if (j === null) { spans.push(spanIn(v, a, b)); return; }
        let p = a;
        for (let k = firstSeamAfter(j.seams, a); k < j.seams.length && j.seams[k]! < b; k++) {
          spans.push(spanIn(v, j.map[p]!, j.map[j.seams[k]! - 1]! + 1));
          p = j.seams[k]!;
        }
        spans.push(spanIn(v, j.map[p]!, j.map[b - 1]! + 1));
      };
      const r = rows ? new Rows(t) : null;
      for (const re of masks) {
        re.lastIndex = 0;
        for (let m = re.exec(t); m !== null; m = re.exec(t)) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          let end = m.index + m[0].length;
          put(m.index, end);
          // A match across a joined row end already ran through every row its run fills: the join chain stopped at the
          // row the value ends on.
          if (r === null || (j !== null && seamWithin(j.seams, m.index, end))) continue;
          // Rows mode: a shape that reaches its row's end runs on into the next row's leading run, and on through every
          // further row while the row before it was as full as the shape's own (a shorter row is the value's last).
          const full = r.length(m.index);
          for (let first = true; ; first = false) {
            if (!first && r.length(end - 1) < full) break;
            const next = continuationAfter(t, end);
            if (next === null) {
              TEXT_END.lastIndex = end;
              if (TEXT_END.test(t)) carry = true;   // the next row is in the next text
              break;
            }
            put(next[0], next[1]);
            end = next[1];
          }
        }
      }
    }
  }
  return { spans, carry };
}

// ── the splice and the walk ────────────────────────────────────────────────

/** `text` up to `limit`, each run of overlapping or touching `spans` (original spans, in any order; sorted here) as one
 *  `SECRET_MASK`: `accounts/mask.ts#SecretMasker`'s splice, and the shape-only mask's (D-7513). */
export function spliceMasked(text: string, spans: [number, number][], limit: number): string {
  spans.sort((x, y) => x[0] - y[0]);
  // Parts joined once (D-5995): appending to a string and testing its end on every span flattens it each time.
  const out: string[] = []; let at = 0; let masked = false;
  for (const [a0, b0] of spans) {
    if (a0 >= limit) break;
    const a = Math.max(a0, at); const b = Math.min(b0, limit);
    if (b <= at) continue;
    if (a > at) { out.push(text.slice(at, a)); masked = false; }
    if (!masked) { out.push(SECRET_MASK); masked = true; }
    at = b;
  }
  if (at < limit) out.push(text.slice(at, limit));
  return out.join('');
}

/** A structured answer or frame with every string replaced by `mask`'s answer, before it is serialized
 *  (`accounts/mask.ts#SecretMasker`'s `maskDeep`, and `SHAPE_MASK`'s; D-7513). A copy: the input (which a caller may
 *  hold or cache) is never mutated. */
export function walkStrings(v: unknown, mask: (s: string) => string): unknown {
  if (typeof v === 'string') return mask(v);
  if (Array.isArray(v)) return v.map((x) => walkStrings(x, mask));
  if (v !== null && typeof v === 'object') {
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Date) return v;   // bytes or a time
    // Anything else serializes through `toJSON` or its own enumerable fields, so those are walked (D-5995): a class
    // instance is never passed through unmasked.
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return walkStrings((toJSON as () => unknown).call(v), mask);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walkStrings(x, mask);
    return out;
  }
  return v;
}

/** One string with its shapes masked: what the masker's keyless, row-less, context-less pass answers (D-7513). */
const maskShapes = (text: string): string =>
  (text === '' ? text : spliceMasked(text, shapeSpans(text, false, SHAPES).spans, text.length));

/** The shape-only mask of a decoded value, every string field masked before it is serialized (D-7513): the same
 *  answer as `accounts/mask.ts#SecretMasker`'s keyless instance, with no timer, clock or database behind it. */
export const SHAPE_MASK: { maskDeep<T>(value: T): T } = {
  maskDeep: <T>(value: T): T => walkStrings(value, maskShapes) as T,
};
