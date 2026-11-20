// L1 policy (X2 P1 Task P1.5; X2 spec section 4.3, "Markdown in parts", amended by the coordinator's render-gate
// carry of 2026-11-19): Markdown above the render gate is read in parts no larger than the gate, each part mounting rich
// in the reader frame as its own mount. Pure: it cuts a text, it reads and writes nothing.
//
// The cut, in this order of preference, taking the latest cut of the best kind that keeps the part within `maxBytes`:
//   1. before a top-level heading (an ATX `#` or `##` line) outside a fence;
//   2. after a blank line outside a fence (the next part is "continued");
//   3. after any line outside a fence (continued);
//   4. after a line inside a fence: the part ends with the fence's closing line and the next part reopens it (its
//      marker and the first word of its info string), so a fence longer than the gate still renders as code in every
//      part (continued);
//   5. inside a line longer than the gate, at a code point boundary, never between a surrogate pair (continued).
// Sizes are UTF-8 bytes, counted by `shared/utf8.ts` as the gate counts them; `start` and `end` are string offsets.
// Every part, its added fence lines counted, is at most `maxBytes`. A line ends at `\n`; a `\r` before it is not part
// of what the line is tested as, so a CRLF file cuts as an LF one does. The scan holds O(1) state: one window of at most
// `maxBytes` is scanned per part, never a table of every line, so a 64 MiB text costs no memory beyond the text.
import { utf8Bytes, utf8CodePointBytes } from '../../../../shared/utf8';

/** One part of a text: `text.slice(start, end)`, after `reopen` (a fence's opening line, for a part that starts inside
 *  that fence) and before `close` (the fence's closing line, for a part that ends inside it). `continued` is true for a
 *  part that does not begin at a top-level heading. */
export interface MdPart { start: number; end: number; continued: boolean; reopen: string | null; close: string | null }

/** A part's text as the reader mounts it. */
export function partText(text: string, p: MdPart): string {
  return (p.reopen ?? '') + text.slice(p.start, p.end) + (p.close ?? '');
}

/** Which part a fragment opens (spec 4.3): the first part whose heading ids hold it, as the whole document would name
 *  the first. `ids[k]` is part k's ids from the pre-pass render, or `null` when the budget refused that part (its ids
 *  stay unknown). A fragment no known part holds opens part 0; `note` says whether a part with unknown ids might hold it,
 *  so the page can say why it opened the first part. */
export function partForFragment(ids: readonly (ReadonlySet<string> | null)[], fragment: string): { part: number; note: boolean } {
  for (let k = 0; k < ids.length; k += 1) {
    if (partHolds(ids[k] ?? null, fragment)) return { part: k, note: false };
  }
  return { part: 0, note: ids.some((s) => s === null) };
}

/** Whether a part's ids hold `fragment`, as written or percent-decoded once: `DocLink.tsx#fragmentTarget`'s rule, so a
 *  fragment that finds its heading on the page finds its part. */
export function partHolds(ids: ReadonlySet<string> | null, fragment: string): boolean {
  if (ids === null || fragment === '') return false;
  if (ids.has(fragment)) return true;
  try {
    return ids.has(decodeURIComponent(fragment));
  } catch {
    return false;
  }
}

const HEADING_RE = /^ {0,3}#{1,2}(?:[ \t]|$)/;
const BLANK_RE = /^[ \t]*$/;
// A fence is seen after any run of blockquote marks (`>`) and list markers (`-`, `*`, `+`, `1.`, `1)`), so a fence in a
// list item or a blockquote is tracked and never cut. The prefix is group 1. Its indentation is judged by `readPrefix`:
// an opener is indented at most three columns past its container's content column (so four columns at the top level is
// an indented code block, not a fence), a closer at most three past its opener's.
const PREFIX_SRC = '((?:[ \\t]*(?:>|(?:[-*+]|\\d{1,9}[.)])(?=[ \\t])))*[ \\t]*)';
const PREFIX_RE = new RegExp('^' + PREFIX_SRC);
const FENCE_OPEN_RE = new RegExp('^' + PREFIX_SRC + '(`{3,}|~{3,})([^\\n]*)$');
const FENCE_CLOSE_RE = new RegExp('^' + PREFIX_SRC + '(`{3,}|~{3,})[ \\t]*$');
const LIST_MARKER_RE = /(?:[-*+]|\d{1,9}[.)])(?=[ \t])/g;

/** What a line's prefix says: `bq` blockquote marks; `col` the column the content starts at; `base` the column the
 *  innermost quote's content starts at; `lcol` the content column of a list marker on this line (-1 for none). */
interface Prefix { bq: number; col: number; base: number; lcol: number }

function readPrefix(p: string): Prefix {
  let col = 0;
  let base = 0;
  let bq = 0;
  let lcol = -1;
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') { col += 4 - (col % 4); i += 1; }
    else if (c === '>') {
      bq += 1; col += 1; i += 1;
      if (p[i] === ' ') { col += 1; i += 1; }
      base = col; lcol = -1;
    } else {
      let j = i;
      while (j < p.length && p[j] !== ' ' && p[j] !== '\t') j += 1;
      col += j - i; i = j;
      let s = 0;
      for (let k = i; k < p.length && (p[k] === ' ' || p[k] === '\t'); k += 1) s += p[k] === ' ' ? 1 : 4 - ((col + s) % 4);
      lcol = col + (s >= 1 && s <= 4 ? s : 1);
    }
  }
  return { bq, col, base, lcol };
}

/** The column a line's container content starts at, given the list column `list` carried from the lines above (-1 for
 *  none): this line's own list marker, else the open list item's when the line is inside it, else the quote's. */
const containerCol = (pr: Prefix, list: number): number =>
  pr.lcol >= 0 ? pr.lcol : list >= pr.base && pr.col >= list ? list : pr.base;

/** The list column after a line outside any fence: a marker sets it, a non-blank line indented less than it ends it. */
function listAfter(list: number, line: string): number {
  const m = PREFIX_RE.exec(line)!;
  const pr = readPrefix(m[1]!);
  if (pr.lcol >= 0) return pr.lcol;
  return list >= 0 && !BLANK_RE.test(line) && pr.col < list ? -1 : list;
}
/** The longest prefix a fence may be reopened under; a longer one (a pathological document) is tracked, not reopened. */
const REOPEN_PREFIX_MAX = 64;
/** The longest fence marker a part may reopen. A longer marker (a pathological document) is still tracked, so no
 *  heading inside it is a cut, but no cut is made inside it: its fence is not reopenable. */
const REOPEN_MARKER_MAX = 64;
/** The most bytes of the info string's first word a reopened fence carries (its language, for highlighting). */
const REOPEN_INFO_MAX = 64;

/** An open fence: its marker, and the lines a part reopens and closes it with (null when it is not reopenable).
 *  The rule for a fence in a blockquote or a list item, the simplest that renders right:
 *   - `close` ends a part that OPENED the fence: the opener's own prefix with each list marker turned into spaces of the
 *     same width, so the closer stays inside the same list item and quote and opens no new item;
 *   - `reopen` and `closeFlat` serve every part that starts inside the fence: the blockquote marks alone (`> ` once per
 *     `>`), at column 0. A list marker would open a new item, and an indent of four columns would make an indented code
 *     block, so the list nesting is dropped there; the code still renders as code, under the same quote.
 *  A list fence's original closer is indented, so read at column 0 it would open a fence of its own: `flatCut` marks a
 *  fence whose container is a list item, and a part that starts inside it ends just before the original closer, which
 *  starts a part of its own with no reopen (the closer then renders as a stray indented line, and nothing after it is code).
 *  `bq` and `ec` (the container's content column) are what a closer is judged against. */
interface Fence { mark: string; reopen: string | null; close: string | null; closeFlat: string | null; bq: number; ec: number; flatCut: boolean }

/** The closing line a part ends a fence with: `fence` is the fence the part started inside (`inside`) or opened itself. */
const closeFor = (fence: Fence, startedInside: Fence | null): string | null => (fence === startedInside ? fence.closeFlat : fence.close);

const RANK_HEADING = 4;
const RANK_BLANK = 3;
const RANK_LINE = 2;
const RANK_FENCE = 1;

/** A line's text as tested: without its `\n` and without one `\r` before it. */
function lineAt(win: string, base: number, off: number, probe?: Probe): { end: number; line: string; bytes: number } {
  // `win` is the part's window, `text.slice(base, limit)`, cut once per part. Only it is looked at, never the rest of a
  // long line: a line that does not end inside it ends at its end here (longer than the window; its tail is never read).
  const rel = off - base;
  const i = win.indexOf('\n', rel);
  const stop = i < 0 ? win.length : i;
  const end = i < 0 ? win.length : i + 1;
  const line = win.slice(rel, stop > rel && win.charCodeAt(stop - 1) === 13 ? stop - 1 : stop);
  const bytes = utf8Bytes(win.slice(rel, end));
  if (probe !== undefined) probe.chars += (end - rel) + line.length + (end - rel);
  return { end: base + end, line, bytes };
}

/** How far past a window's end a line is read: enough for a heading test, which needs six characters of a line. */
const LINE_SLACK = 8;

/** The fence state after `line`, given the state before it and the list column `list` above it. */
function fenceAfter(fence: Fence | null, line: string, list: number): Fence | null {
  if (fence === null) {
    const m = FENCE_OPEN_RE.exec(line);
    if (m === null) return null;
    const prefix = m[1]!;
    const mark = m[2]!;
    const info = m[3]!;
    const pr = readPrefix(prefix);
    const ec = containerCol(pr, list);
    if (pr.col - ec > 3) return null; // indented code, not a fence
    if (mark[0] === '`' && info.includes('`')) return null;
    const own = { bq: pr.bq, ec, flatCut: ec > pr.base };
    if (mark.length > REOPEN_MARKER_MAX || prefix.length > REOPEN_PREFIX_MAX) return { mark, reopen: null, close: null, closeFlat: null, ...own };
    const word = info.trim().split(/[ \t]/)[0] ?? '';
    const keep = word !== '' && utf8Bytes(word) <= REOPEN_INFO_MAX ? word : '';
    const flat = '> '.repeat(pr.bq);
    return {
      mark,
      reopen: flat + mark + (keep === '' ? '' : ' ' + keep) + '\n',
      close: prefix.replace(LIST_MARKER_RE, (s) => ' '.repeat(s.length)) + mark + '\n',
      closeFlat: flat + mark + '\n',
      ...own,
    };
  }
  const m = FENCE_CLOSE_RE.exec(line);
  if (m === null || m[2]![0] !== fence.mark[0] || m[2]!.length < fence.mark.length) return fence;
  // CommonMark: a closer sits in the opener's quote depth, carries no list marker, and is indented at most three columns
  // past the container's content column. Any other line of that shape is content, so a fence inside a fence stays inside.
  const pr = readPrefix(m[1]!);
  return pr.bq === fence.bq && pr.lcol < 0 && pr.col <= fence.ec + 3 ? null : fence;
}

/** The fence a part starting at a cut is inside, for reopening: only a reopenable one. */
const reopenable = (f: Fence | null): Fence | null => (f !== null && f.reopen !== null ? f : null);

/** A test-only counter: `chars` grows by every character the cutter examines (searched, sliced or measured). It changes
 *  nothing the cutter answers; it lets a test bound the work by an operation count, never by wall time. */
export interface Probe { chars: number }

/** A cut candidate: its offset, the bytes before it, the fence and list state there, and whether the line after it is the
 *  closer of that fence. */
interface Cut { off: number; bytes: number; fence: Fence | null; list: number; closerNext: boolean }

/** The largest offset in `[from, to)` whose prefix `text.slice(from, off)` is at most `budget` UTF-8 bytes, at a code
 *  point boundary, and at least one code point past `from`, so a cut always makes progress. */
function codePointCut(text: string, from: number, to: number, budget: number): { off: number; bytes: number } {
  let off = from;
  let bytes = 0;
  while (off < to) {
    const c = text.codePointAt(off)!;
    const w = utf8CodePointBytes(c);
    if (bytes + w > budget && off > from) break;
    bytes += w;
    off += c > 0xffff ? 2 : 1;
  }
  return { off, bytes };
}

/** Cuts `text` into parts of at most `maxBytes` UTF-8 bytes each (above). A text at or below `maxBytes` is one part. */
export function splitMarkdownParts(text: string, maxBytes: number, probe?: Probe): { parts: MdPart[] } {
  if (probe !== undefined) probe.chars += text.length;
  if (utf8Bytes(text) <= maxBytes) return { parts: [{ start: 0, end: text.length, continued: false, reopen: null, close: null }] };
  const parts: MdPart[] = [];
  let start = 0;
  let inside: Fence | null = null; // the reopenable fence this part starts inside
  let state: Fence | null = null; // the fence state at `start`, reopenable or not
  let listState = -1; // the list column at `start`
  let continued = false;
  while (start < text.length) {
    const reopen = inside === null ? null : inside.reopen;
    const head = reopen === null ? 0 : utf8Bytes(reopen);
    // A part holds at most `maxBytes` bytes, so at most `maxBytes` characters: no line is read past this limit.
    const limit = Math.min(text.length, start + maxBytes + LINE_SLACK);
    const win = text.slice(start, limit);
    if (probe !== undefined) probe.chars += win.length;
    // One window: scan lines from `start` while the part still fits, keeping the latest cut of each rank.
    const best: (Cut | undefined)[] = [];
    let off = start;
    let bytes = 0;
    let fence = state;
    let list = listState;
    let prevRank = RANK_LINE;
    let firstLineEnd = -1;
    let atEnd = false;
    while (off < text.length) {
      const { end, line, bytes: lineBytes } = lineAt(win, start, off, probe);
      if (firstLineEnd < 0) firstLineEnd = end;
      const next = fenceAfter(fence, line, list);
      const closerNext = fence !== null && next === null;
      if (off > start) {
        const rank = fence === null && HEADING_RE.test(line) ? RANK_HEADING : prevRank;
        const tailText = fence === null ? null : closeFor(fence, inside);
        const tail = tailText === null ? 0 : utf8Bytes(tailText);
        if (rank !== RANK_FENCE || fence?.reopen != null) {
          if (head + bytes + tail <= maxBytes) best[rank] = { off, bytes, fence, list, closerNext };
        }
        // A reopened list fence ends before its original closer (see `Fence`): nothing after it is scanned.
        if (closerNext && fence === inside && fence!.flatCut) break;
      }
      const blank = fence === null && BLANK_RE.test(line);
      if (fence === null) list = listAfter(list, line);
      fence = next;
      if (head + bytes + lineBytes > maxBytes) break;
      bytes += lineBytes;
      off = end;
      prevRank = fence !== null ? RANK_FENCE : blank ? RANK_BLANK : RANK_LINE;
      if (off >= text.length) atEnd = true;
    }
    if (atEnd) {
      parts.push({ start, end: text.length, continued, reopen, close: null });
      break;
    }
    const pick = best[RANK_HEADING] ?? best[RANK_BLANK] ?? best[RANK_LINE] ?? best[RANK_FENCE];
    if (pick !== undefined) {
      const atClose = pick.fence === null ? null : closeFor(pick.fence, inside);
      parts.push({ start, end: pick.off, continued, reopen, close: atClose });
      continued = best[RANK_HEADING] !== pick;
      start = pick.off;
      state = pick.fence;
      listState = pick.list;
      // The closer of a list fence that starts the next part is not reopened over: it closes the fence (the scan) and
      // renders as the stray line it is, outside any fence.
      inside = pick.closerNext && pick.fence!.flatCut ? null : reopenable(pick.fence);
      continue;
    }
    // No line boundary fits: the first line is longer than what is left. Cut it at a code point boundary. Inside a
    // reopenable fence, the part closes it on a line of its own and the next part reopens it; when even that leaves no
    // room, the fence is not reopened (a pathological document), so every part still fits and the cut still moves.
    let closeText = inside === null ? null : '\n' + closeFor(inside, inside)!;
    let budget = maxBytes - head - (closeText === null ? 0 : utf8Bytes(closeText));
    if (closeText !== null && budget < 4) { closeText = null; budget = maxBytes - head; }
    const cut = codePointCut(text, start, firstLineEnd, budget);
    parts.push({ start, end: cut.off, continued, reopen, close: closeText });
    if (cut.off >= firstLineEnd) {
      // The whole first line went: the fence state moves past it.
      const first = lineAt(win, start, start, probe).line;
      const after = fenceAfter(state, first, listState);
      if (state === null) listState = listAfter(listState, first);
      state = after;
      inside = reopenable(state);
    } else if (closeText === null) {
      inside = null;
    }
    start = cut.off;
    continued = true;
  }
  return { parts };
}
