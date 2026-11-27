// L1 policy (X2 P1 Task P1.5; X2 spec section 4.3, "Markdown in parts", amended by the coordinator's render-gate
// carry of 2026-11-19): Markdown above the render gate is read in parts no larger than the gate, each part mounting rich
// in the reader frame as its own mount. Pure: it cuts a text, it reads and writes nothing.
//
// TWO CUTTERS. `splitMarkdownPartsAt` (X2 P6.1 Step 0b2, the block cutter, at the end of this file) cuts at the block boundaries
// of the shared library's own parse, which the render job reads window by window (`collectMdBlocks`, `blockWindow`,
// `foldBlockWindow`; the blocks are `renderTree.ts`'s, imported here as a TYPE only, so the main bundle never loads the parser).
// `splitMarkdownParts` (P1's line cutter, below) is the fallback, byte for byte as P1 left it: the block cutter hands it a unit it
// has no seam in, and the rest of a text whose blocks it could not read (`tailFrom`: a window the worker refused, timed out on or
// failed, or one block longer than `READER_BLOCKS_MAX_BYTES`), and the console uses it alone when there is no render job.
//
// THE BLOCK CUTTER. A text at or below `maxBytes` is one part. Otherwise, greedy from offset 0, a part ends only at a top-level
// block start (never at offset 0, and never before a block whose first line starts with three dashes, which a part would read as
// front matter), at the LATEST heading block (`h1`, `h2`) start that fits, else the latest block start that fits; it is `continued`
// unless it starts at a heading block. The text between two block starts (the blank lines and the lines the library draws no block
// for: `<details>`, reference definitions, comment anchors) belongs to the block before it. When no block start fits, that unit
// is cut by its block, in sizes counted in UTF-8 bytes with the reopen and close lines included:
//   - a list or quote of two or more items: between its items, each part starting at one (greedy again, one level); an item that
//     alone is too large is cut as a unit of its own;
//   - a fence (the unit's block, a quote's, or the first fence of a list item): closed with a line of its own and reopened, at
//     content line ends. The close line is the opener's own prefix (its list markers as spaces of the same width, its quote marks)
//     and the marker; the reopen is the opener's own prefix, the marker and the first word of its info string (at most 64 bytes),
//     and for a fence on a later line of its list item the item's marker alone on a line before it. A content line longer than what
//     is left is cut at a code point boundary, never between a surrogate pair and never so that the tail begins with three or more
//     backticks or tildes; a part cut mid-line reopens with the container's prefix so the tail is still content of the item or
//     quote. What follows the fence in its list item is one part with it when that fits, else it starts a part with the item's
//     marker alone (a blank line right after the fence goes with the fence's part: an empty item holds one at most), the item's next
//     fence cut the same way, or P1 inside the item;
//   - the text of a list item with no fence, and anything else (a paragraph, a table, indented code, a merged block): P1 on the
//     unit's slice, its offsets moved by the unit's start, the first part keeping the current `continued` and the rest continued
//     (inside a list item every part that starts in it, P1's own reopen apart, begins with the item's marker alone, so indented
//     text is the item's, not code).
// When the lines that close and reopen do not fit (a window of a few dozen bytes), the unit falls back to P1 whole.
// The cut is INCREMENTAL (`MarkdownCutter`): fed each window's confirmed blocks it answers the parts that are final so far (a part
// is final once the units from its start overflow a part, whatever follows), and the rest at the end, which together are
// `splitMarkdownPartsAt` of the same blocks. `cutMarkdownText` drives it for delivery: the render job, each window's budget, what a
// non-`blocks` answer or a throw does (ends the blocks there), the parts as they become final.
// A window that ends inside a block COMMENT confirms only the blocks before the block that holds the comment's opening line
// (`openComment`): the library reads `<!--` as a comment only when a `-->` follows in the same source.
//
// THE NINE RESIDUAL CLASSES below were measured against P1's line cutter, which is still the fallback; the block cutter's state:
//   1, 6, 7, 8, 9 (the list tracker's and the zone detector's over-reads): none, on every recorded input; the cutter reads no
//     list state, the library's blocks say where a fence is. They remain in P1 wherever P1 still cuts (below).
//   2 (a zone longer than a part): none for a top-level fence of any marker length, a fence a list item holds directly (on its marker
//     line or a later one) and a fence a quote holds directly; it REMAINS (the fence is cut by P1 inside its item, with no close and
//     no reopen) for a fence nested a level deeper in an item (a quote or a list inside a list item: the blocks name one level, and
//     the item's own blocks are not walked further; measured on `- item` then an indented `> ```py` block of 30 lines and on a
//     nested list's `    ```sh` block of 40 lines, at 100 bytes: 22 and 29 violating lines), for a list item whose text between
//     or after its fences is itself longer than a part (P1 cuts it, and a line indented four columns past the item's marker still
//     reads as code), and where the header (the text before the fence in its item, its opener and its close line) is larger than
//     a part.
//   3 (windows under about 60 bytes): the recorded input is cut right at every size from 11 to 140 bytes (measured; the case asserts
//     51 to 54, and only the fit at 11 to 14). In general a window too small for a fence's close and reopen lines and one code
//     point (about 20 bytes, more with a long marker or a long prefix) hands that unit to P1, so a part may be cut inside a fence.
//   4 (a code-point tail that starts with a fence marker): none in a fence the block cutter cuts; it remains in a fence P1 cuts.
//   5 (a cut that starts a part with indented text, which reads as code): none for a cut between a list's items or a quote's blocks
//     (the recorded input), and a list item's text is reopened with its marker; it REMAINS for a paragraph, a quote's paragraph, or a
//     list item's lazy line, larger than a part, with a continuation line indented four columns or more (P1 cuts before it), and a
//     line indented six columns or more in an item. The fuzz's library judge counts it: 36 lines in 27 of 8 000 documents.
//   And the unread tail (`tailFrom`): all nine, as P1 has them, for the rest of a text whose blocks were not read.
// The line cutter's own description follows.
//
// THE LINE CUTTER (P1). The cut, in this order of preference, taking the latest cut of the best kind that keeps the part within `maxBytes`:
//   0. the forced cut of a part that starts inside a zone (below): right after the zone's closer, or right before the
//      line that ends it, whichever comes first;
//   1. before a top-level heading (an ATX `#` or `##` line) outside a fence and a zone;
//   2. after a blank line outside a fence and a zone (the next part is "continued");
//   3. after any line outside a fence and a zone (continued);
//   4. after a line inside a top-level fence: the part ends with the fence's closing line and the next part reopens it
//      (its marker and the first word of its info string) at column 0, so a fence longer than the gate still renders as
//      code in every part (continued);
//   5. after a line inside a zone, with no reopen and no close (continued);
//   6. inside a line longer than the gate, at a code point boundary, never between a surrogate pair (continued).
// A top-level fence is one a line opens at 0 to 3 columns of indentation with a marker of at most 64 characters, closed by
// a line of the same marker, at least as long, at 0 to 3 columns. Its content is literal: nothing inside it is read as
// anything else. A top-level fence opened at or right of the content column of an open list item (the item's marker
// line, then indented or lazy lines, tracked in O(1) state) that meets a non-blank line indented less than its opener
// stops being reopenable: its list item is over, the rest of it is a zone, and a reopened part ends before that line.
// A fence at column 1 to 3 that no list item holds keeps its column-0 content and stays reopenable, as one at column 0 does.
// A zone is an exclusion zone for cuts of kinds 1 to 3, so a fence is never cut while any other cut fits. A zone is
// opened by any fence opener outside a top-level fence and a zone that is not a top-level one: after blockquote marks
// (`>`), list markers or four or more columns of indentation, or with a marker of more than 64 characters. It ends at
// a closer: only `>` marks and spaces before it, the same marker character and `>` count, at least as long, indented at
// most three columns past the zone's content column. It also ends when its container provably ends, and that is tried
// first: a non-blank line with fewer `>` marks, or one indented less than the zone's content column. The content column
// is 0 when only `>` marks come before the opener, the opener's own column when it carries a list marker, else the
// larger of 2 and its column less 3. A line the detector cannot place stays in the zone.
// THE NINE RESIDUAL CLASSES OF THE LINE CUTTER: it is a line heuristic, not a parser, and a cut can still fall inside a fence or
// leave a part that starts oddly. Each class below has its recorded input in the plan's Results and a case in
// `pwa/test/docs-md-parts-blocks.test.ts`, which the block cutter passes (1, 6 and 7 were pinned in `docs-md-parts.test.ts` as
// P1's wrong parts, and are flipped there to the block cutter's).
//   1. A fence that its list item ended, followed by a later fence at column 0: the zone takes that opener for its closer,
//      so a cut falls inside the real fence, with no close and no reopen.
//   2. A zone longer than a whole part (a container fence, a fence with a marker over 64 characters): it is cut inside at
//      a line end, with no reopen and no close, so the part cut inside it shows code as plain text.
//   3. Windows under about 60 bytes: a window that small cannot hold a fence, its added lines and a cut choice, so a cut
//      can fall inside a fence or a zone.
//   4. A code-point tail that starts with a fence marker: a line longer than a part is cut mid-line, and the part that
//      starts there reads the cut-off tail as a fence line.
//   5. A cut inside a list item, outside any fence, that starts a part with indented text: the part reads it as indented
//      code, not as the item's paragraph.
//   6. Indented fence-looking code followed by an indented real fence opener: the line indented four columns is code, but
//      the zone detector reads it as a container fence, and the opener right after it, which carries an info string, is
//      swallowed, so a cut falls inside the real fence with no close.
//   7. An empty list marker, a plain line, then a fence at the marker's content column: the list state reads the plain
//      line as lazy, holds the fence in the item, and the next column-0 line ends it, so the rest of the fence is a zone.
// Sizes are UTF-8 bytes, counted by `shared/utf8.ts` as the gate counts them; `start` and `end` are string offsets.
// Every part, its added fence lines counted, is at most `maxBytes`. A line ends at `\n`; a `\r` before it is not part
// of what the line is tested as, so a CRLF file cuts as an LF one does. The scan holds O(1) state: one window of at most
// `maxBytes` is scanned per part, never a table of every line, so a 64 MiB text costs no memory beyond the text.
import { utf8Bytes, utf8CodePointBytes } from '../../../../shared/utf8';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../../lib/markdownLimits';
import { READER_BLOCKS_MAX_BYTES } from '../../lib/readerLimits';
import type { ReaderRenderOutcome } from '../../lib/readerRenderJob';
import type { MdBlock, MdBlockKind } from '../../lib/renderTree';

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
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** The longest fence marker a top-level fence may have and be reopened. A longer one (a pathological document) is a zone. */
const REOPEN_MARKER_MAX = 64;
/** The most bytes of the info string's first word a reopened fence carries (its language, for highlighting). */
const REOPEN_INFO_MAX = 64;

/** An open top-level fence: its marker, the lines a part reopens and closes it with, the column (0 to 3) it opened at, and
 *  whether a list item held it (a list item was open at its opener and it sits at the item's content column or right of it).
 *  The marker of an item that has a fence of its own on its line makes a zone instead (`zoneOpened`). */
interface Fence { mark: string; reopen: string; close: string; col: number; list: boolean }

/** Whether a list item is open at a line, outside every fence and zone, as one number: 0 for none; the item's content
 *  column when it is open (after its marker line or a line of the item); the content column negated after a blank line
 *  (a `gap`: only a line indented to the column still belongs to the item). A nested item keeps its outer item's column. */
type ListState = number;
const LIST_MARKER_RE = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)|\t|$)/;
const NEW_BLOCK_RE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>)/;

/** The list state after one line that is outside every fence and zone (or that closes one). A line that is none of the
 *  below and sits left of the content column ends the item, except a lazy continuation (a plain line, not the start of
 *  a block, right after an item's text). */
function listAfter(list: ListState, line: string): ListState {
  if (BLANK_RE.test(line)) return list > 0 ? -list : list;
  const col = Math.abs(list);
  const m = LIST_MARKER_RE.exec(line);
  if (m !== null) {
    const spaces = (m[3] ?? '').length;
    const cc = m[1]!.length + m[2]!.length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
    return list === 0 || m[1]!.length < col ? cc : col;
  }
  if (list === 0) return 0;
  if (indentOf(line) >= col) return col;
  return list > 0 && !NEW_BLOCK_RE.test(line) && !FENCE_OPEN_RE.test(line) ? list : 0;
}

/** An exclusion zone: its marker character and length, its quote depth, and its content column (see the header). */
interface Zone { ch: string; len: number; bq: number; cc: number }

/** A line read as quote marks, indentation and the rest: `bq` its `>` marks (each takes one space or tab after it), `indent`
 *  the columns of white space after the last mark (a tab goes to the next multiple of four), `rest` what follows. */
function readLine(line: string): { bq: number; indent: number; rest: string } {
  let i = 0;
  let bq = 0;
  for (;;) {
    let ws = 0;
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) { ws += line[i] === ' ' ? 1 : 4 - (ws % 4); i += 1; }
    if (line[i] !== '>') return { bq, indent: ws, rest: line.slice(i) };
    bq += 1;
    i += 1;
    if (line[i] === ' ' || line[i] === '\t') i += 1;
  }
}

/** The columns of leading white space of a line. */
function indentOf(line: string): number {
  let ws = 0;
  for (let i = 0; i < line.length && (line[i] === ' ' || line[i] === '\t'); i += 1) ws += line[i] === ' ' ? 1 : 4 - (ws % 4);
  return ws;
}

const OPEN_REST_RE = /^((?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})([^\n]*)$/;
const FENCE_REST_RE = /^(`{3,}|~{3,})[ \t]*$/;

/** The zone a line opens, when it is a container fence opener (the top-level kinds are tried first by the caller). */
function zoneOpened(line: string): Zone | null {
  const r = readLine(line);
  const m = OPEN_REST_RE.exec(r.rest);
  if (m === null) return null;
  const mark = m[2]!;
  if (mark[0] === '`' && m[3]!.includes('`')) return null;
  const cc = m[1]!.length > 0 ? r.indent + m[1]!.length : r.bq > 0 ? 0 : Math.max(2, r.indent - 3);
  return { ch: mark[0]!, len: mark.length, bq: r.bq, cc };
}

/** What a line does to a zone: its container ends, it closes the zone, or it stays inside. The container's end is tried
 *  first, so a line left of the zone is never taken for its closer. */
function zoneVerdict(zone: Zone, line: string): 'end' | 'close' | 'stay' {
  if (BLANK_RE.test(line)) return 'stay';
  const r = readLine(line);
  if (r.bq < zone.bq) return 'end';
  if (r.rest === '') return 'stay';
  if (r.bq === zone.bq) {
    if (r.indent < zone.cc) return 'end';
    const f = FENCE_REST_RE.exec(r.rest);
    if (f !== null && f[1]![0] === zone.ch && f[1]!.length >= zone.len && r.indent <= zone.cc + 3) return 'close';
  }
  return 'stay';
}

/** The zone that the rest of a top-level fence held by a list item becomes, when `line` (non-blank) sits left of its
 *  opener: the list item that held it is over. Null for any other case, a fence in no list item included (review 2915 F4:
 *  a top-level fence at column 1 to 3 with column-0 content is still open). */
function converted(fence: Fence | null, line: string): Zone | null {
  if (fence === null || !fence.list || BLANK_RE.test(line) || indentOf(line) >= fence.col) return null;
  return { ch: fence.mark[0]!, len: fence.mark.length, bq: 0, cc: 0 };
}

const RANK_FORCE = 5;
const RANK_HEADING = 4;
const RANK_BLANK = 3;
const RANK_LINE = 2;
const RANK_FENCE = 1;
const RANK_ZONE = 0;

/** A line's text as tested, read from the part's window `win` (`text.slice(base, limit)`, cut once per part). Only the
 *  window is looked at, never the rest of a long line: a line that does not end inside it ends at its end here (it is
 *  longer than the window, and its tail is never read). `end` is an offset in the text; `bytes` the line's UTF-8 bytes,
 *  its `\n` included. Without its `\n` and without one `\r` before it, the line is what `line` holds. */
function lineAt(win: string, base: number, off: number, probe?: Probe): { end: number; line: string; bytes: number } {
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

/** The fence a line closes, given the fence open before it: null when it closes it. */
function fenceClosed(fence: Fence, line: string): Fence | null {
  const m = FENCE_CLOSE_RE.exec(line);
  return m !== null && m[1]![0] === fence.mark[0] && m[1]!.length >= fence.mark.length ? null : fence;
}

type States = { fence: Fence | null; zone: Zone | null };
const NONE: States = { fence: null, zone: null };

/** What a line opens, outside a fence and a zone: a top-level fence, or a zone (a container fence, or a long marker).
 *  `list` is the list state before the line: a fence at column 2 or more while an item is open is held by it. */
function opened(line: string, list: ListState): States {
  const m = FENCE_OPEN_RE.exec(line);
  if (m === null) return { fence: null, zone: zoneOpened(line) };
  const mark = m[2]!;
  const info = m[3]!;
  if (mark[0] === '`' && info.includes('`')) return NONE;
  if (mark.length > REOPEN_MARKER_MAX) return { fence: null, zone: { ch: mark[0]!, len: mark.length, bq: 0, cc: 0 } };
  const word = info.trim().split(/[ \t]/)[0] ?? '';
  const keep = word !== '' && utf8Bytes(word) <= REOPEN_INFO_MAX ? word : '';
  const col = m[1]!.length;
  return { fence: { mark, reopen: mark + (keep === '' ? '' : ' ' + keep) + '\n', close: mark + '\n', col, list: list !== 0 && col >= Math.abs(list) }, zone: null };
}

/** The list state after `line`, given the one before it and the states `next` after it. `outside` is whether the line began
 *  outside every fence and zone: a fence it opens that no item holds ends the item, a zone it opens or a line that closes
 *  a fence or zone is read as a plain line, and a line inside a fence or zone that stays changes nothing. */
function listNext(list: ListState, outside: boolean, next: States, line: string): ListState {
  if (next.fence !== null) return outside && !next.fence.list ? 0 : list;
  if (next.zone !== null) return outside ? listAfter(list, line) : list;
  return listAfter(list, line);
}

/** The fence and zone states after `line`, given the states before it (at most one of them is not null). */
function stateAfter(fence: Fence | null, zone: Zone | null, line: string, list: ListState): States {
  if (fence !== null) return { fence: fenceClosed(fence, line), zone: null };
  if (zone !== null) {
    const v = zoneVerdict(zone, line);
    if (v === 'stay') return { fence: null, zone };
    if (v === 'close') return NONE;
  }
  return opened(line, list);
}

/** A test-only counter: `chars` grows by every character the cutter examines (searched, sliced or measured). It changes
 *  nothing the cutter answers; it lets a test bound the work by an operation count, never by wall time. */
export interface Probe { chars: number }

/** A cut candidate: its offset, the bytes before it, the fence whose closing line ends the part (null for none), and the
 *  fence, zone and list states the next part starts in. */
interface Cut { off: number; bytes: number; closeWith: Fence | null; fence: Fence | null; zone: Zone | null; list: ListState }

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
  let inside: Fence | null = null; // the top-level fence this part starts inside (it reopens it)
  let state: Fence | null = null; // the top-level fence state at `start`
  let zoneState: Zone | null = null; // the zone at `start`
  let listState: ListState = 0; // the list state at `start`
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
    let zone = zoneState;
    let list = listState;
    let prevRank = RANK_LINE;
    let firstLineEnd = -1;
    let atEnd = false;
    while (off < text.length) {
      const { end, line, bytes: lineBytes } = lineAt(win, start, off, probe);
      if (firstLineEnd < 0) firstLineEnd = end;
      const conv = converted(fence, line);
      const verdict = zone === null ? null : zoneVerdict(zone, line);
      const fromZone = zone !== null && zone === zoneState; // this part started inside the zone it is still in
      if (off > start) {
        if (conv !== null && fence === inside) {
          // A reopened fence meets the line that ends its list item: the part ends before it, with the fence closed.
          if (head + bytes + utf8Bytes(fence!.close) <= maxBytes) best[RANK_FORCE] = { off, bytes, closeWith: fence, fence: null, zone: conv, list };
          break;
        }
        if (conv !== null) {
          if (head + bytes <= maxBytes) best[RANK_ZONE] = { off, bytes, closeWith: null, fence: null, zone: conv, list };
        } else if (fromZone && verdict === 'end') {
          // The zone this part started in is over: the part ends before the line that ends it.
          if (head + bytes <= maxBytes) best[RANK_FORCE] = { off, bytes, closeWith: null, fence: null, zone: null, list };
          break;
        } else {
          // A boundary inside a zone is a cut of the lowest rank; a line that ends the zone by its container's end is
          // already outside it, so the cut before it is not inside.
          const zoneHere = zone !== null && verdict !== 'end' ? zone : null;
          const rank = zoneHere !== null ? RANK_ZONE : fence === null && HEADING_RE.test(line) ? RANK_HEADING : prevRank;
          const tail = fence !== null ? utf8Bytes(fence.close) : 0;
          if (head + bytes + tail <= maxBytes) best[rank] = { off, bytes, closeWith: fence, fence, zone: zoneHere, list };
        }
      }
      if (fromZone && verdict === 'close') {
        // The zone this part started in is closed by this line: the part ends right after it, so the closer, which on its
        // own would open a fence, stays at the end of this part, and nothing after it is read with it.
        if (head + bytes + lineBytes <= maxBytes) best[RANK_FORCE] = { off: end, bytes: bytes + lineBytes, closeWith: null, fence: null, zone: null, list: listAfter(list, line) };
        break;
      }
      if (conv !== null) { fence = null; zone = conv; }
      const blank = fence === null && BLANK_RE.test(line);
      const outside = fence === null && zone === null;
      ({ fence, zone } = stateAfter(fence, zone, line, list));
      list = listNext(list, outside, { fence, zone }, line);
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
    const pick = best[RANK_FORCE] ?? best[RANK_HEADING] ?? best[RANK_BLANK] ?? best[RANK_LINE] ?? best[RANK_FENCE] ?? best[RANK_ZONE];
    if (pick !== undefined) {
      parts.push({ start, end: pick.off, continued, reopen, close: pick.closeWith === null ? null : pick.closeWith.close });
      continued = best[RANK_HEADING] !== pick;
      start = pick.off;
      state = pick.fence;
      zoneState = pick.zone;
      listState = pick.list;
      inside = pick.fence;
      continue;
    }
    // No line boundary fits: the first line is longer than what is left. Cut it at a code point boundary. Inside a
    // top-level fence, the part closes it on a line of its own and the next part reopens it; when even that leaves no
    // room, the fence is not reopened (a pathological document), so every part still fits and the cut still moves.
    let closeText = inside === null ? null : '\n' + inside.close;
    let budget = maxBytes - head - (closeText === null ? 0 : utf8Bytes(closeText));
    if (closeText !== null && budget < 4) { closeText = null; budget = maxBytes - head; }
    const cut = codePointCut(text, start, firstLineEnd, budget);
    parts.push({ start, end: cut.off, continued, reopen, close: closeText });
    if (cut.off >= firstLineEnd) {
      // The whole first line went: the states move past it.
      const first = lineAt(win, start, start, probe).line;
      const conv = converted(state, first);
      if (conv !== null) { state = null; zoneState = conv; }
      const outside = state === null && zoneState === null;
      ({ fence: state, zone: zoneState } = stateAfter(state, zoneState, first, listState));
      listState = listNext(listState, outside, { fence: state, zone: zoneState }, first);
      inside = state;
    } else if (closeText === null) {
      inside = null;
    }
    start = cut.off;
    continued = true;
  }
  return { parts };
}

// ---- The block cutter (X2 P6.1 Step 0b2) ------------------------------------------------------------------------------------

/** One block of the text in string offsets: `text.slice(start, end)`. `items` as for `MdBlock`: a list's items, or the own
 *  outermost blocks of a quote or of an item. */
export interface TextBlock { readonly start: number; readonly end: number; readonly kind: MdBlockKind; readonly items?: readonly TextBlock[] }

/** The text one blocks job reads: from a block start `from` to a line end (or the text's end). `src` is what the job is sent:
 *  the text behind one newline when `from` is above 0 (`shifted`), so a window that starts at `---` is never front matter, which
 *  the library reads only when its first line is dashes. `toEnd`: the window reaches the end of the text. */
export interface BlockWindow { readonly from: number; readonly end: number; readonly src: string; readonly shifted: boolean; readonly toEnd: boolean }

/** Whether a line starts at `off` by markdown-it's rule (`\r\n`, a lone `\r` and `\n` end a line): the offset follows a `\n`, or
 *  a `\r` that no `\n` follows. */
function lineStartAt(text: string, off: number): boolean {
  const c = text.charCodeAt(off - 1);
  return c === 10 || (c === 13 && text.charCodeAt(off) !== 10);
}

/** The window of `text` to ask the worker for from `from` (a confirmed block start): at most `bytes` UTF-8 bytes counting the
 *  newline put in front when `from` is above 0, ended at a line end, or at the end of the text (`toEnd`). A first line longer
 *  than `bytes` is taken whole when it fits `READER_BLOCKS_MAX_BYTES`, else the window is refused (null). Linear in the window. */
export function blockWindow(text: string, from: number, bytes: number): BlockWindow | null {
  const shifted = from > 0;
  const pre = shifted ? 1 : 0;
  const hard = READER_BLOCKS_MAX_BYTES - pre;
  const budget = Math.min(bytes, READER_BLOCKS_MAX_BYTES) - pre;
  let off = from;
  let used = 0;
  let ls = -1; // the last line start inside the window
  while (off < text.length) {
    const c = text.codePointAt(off)!;
    const w = utf8CodePointBytes(c);
    // Past the budget only while no line has ended yet (the first line is taken whole), never past the cap.
    if (used + w > hard || (ls >= 0 && used + w > budget)) break;
    used += w;
    off += c > 0xffff ? 2 : 1;
    if (lineStartAt(text, off)) ls = off;
  }
  const toEnd = off >= text.length;
  const end = toEnd ? text.length : ls;
  if (end < 0) return null;
  return { from, end, src: (shifted ? '\n' : '') + text.slice(from, end), shifted, toEnd };
}

/** The offsets (in `s`) at which each line of `s` starts, by markdown-it's rule, a start at the end of `s` left out. */
function lineStartsIn(s: string): number[] {
  const a = [0];
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 10) i += 1;
    else if (c === 13) i += s.charCodeAt(i + 1) === 10 ? 2 : 1;
    else { i += 1; continue; }
    if (i < s.length) a.push(i);
  }
  return a;
}

/** What a window's answer confirms: `blocks` (in string offsets), the `next` window's start (the last block's start; null when
 *  the window reached the end), and `grow` when nothing was confirmed (one block, or none, runs past the window). */
export interface FoldedBlocks { readonly blocks: TextBlock[]; readonly next: number | null; readonly grow: boolean }

/** Whether the offset `off` is inside a block the library parsed as code (a fence, indented code), at any depth. */
function inCode(blocks: readonly TextBlock[], off: number): boolean {
  for (const b of blocks) {
    if (off < b.start || off >= b.end) continue;
    if (b.kind === 'fence' || b.kind === 'code') return true;
    if (b.items !== undefined && inCode(b.items, off)) return true;
  }
  return false;
}

/** The start of the first line of a window that opens a block comment the window does not close, or -1. The library reads a
 *  `<!--` line as a comment only when a `-->` follows it in the same source (`blockComment` in its `allowlist.js` looks from
 *  that line to the source's end), so at a window's end such a line is paragraph text and the comment's inner lines are blocks
 *  that the whole document does not have. A line opens one when, after its quote marks, indentation and list markers, it starts
 *  with `<!--`, outside a block parsed as code, and no `-->` stands at or after it in the window. */
function openComment(text: string, win: BlockWindow, all: readonly TextBlock[]): number {
  const slice = text.slice(win.from, win.end);
  let i = slice.indexOf('<!--', slice.lastIndexOf('-->') + 1);
  while (i !== -1) {
    let ls = i;
    while (ls > 0 && slice.charCodeAt(ls - 1) !== 10 && slice.charCodeAt(ls - 1) !== 13) ls -= 1;
    if (/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+[ \t>]*)*$/.test(slice.slice(ls, i)) && !inCode(all, win.from + i)) return win.from + ls;
    i = slice.indexOf('<!--', i + 1);
  }
  return -1;
}

/** Folds the job's answer for `win` into confirmed blocks in offsets of `text`: the answer's lines (the window's own, one more
 *  than the text's for a `shifted` one) become offsets, and every block but the last is confirmed unless the window reached the
 *  text's end: the last may run past the window, or be cut short by it. A window that ends inside a block comment confirms only
 *  the blocks before the block that holds the comment's opening line, and the next window starts at that block (`openComment`). */
export function foldBlockWindow(text: string, win: BlockWindow, blocks: readonly MdBlock[]): FoldedBlocks {
  const slice = text.slice(win.from, win.end);
  const starts = lineStartsIn(slice);
  const shift = win.shifted ? 1 : 0;
  const at = (line: number): number => {
    const l = Math.max(0, line - shift);
    return win.from + (l < starts.length ? starts[l]! : slice.length);
  };
  const conv = (b: MdBlock): TextBlock => ({ start: at(b.from), end: at(b.to), kind: b.kind, ...(b.items === undefined ? {} : { items: b.items.map(conv) }) });
  const all = blocks.map(conv);
  if (win.toEnd) return { blocks: all, next: null, grow: false };
  // The last block is never confirmed (it may run past the window); neither is a block from the one that holds an open comment.
  let limit = all.length > 0 ? all[all.length - 1]!.start : -1;
  const open = openComment(text, win, all);
  if (open >= 0) {
    const holding = all.find((b) => b.start <= open && open < b.end);
    const cap = holding !== undefined ? holding.start : open;
    limit = limit < 0 ? cap : Math.min(limit, cap);
  }
  const confirmed = limit < 0 ? [] : all.filter((b) => b.end <= limit);
  if (confirmed.length === 0) return { blocks: [], next: null, grow: true };
  return { blocks: confirmed, next: limit, grow: false };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

export interface CollectOptions {
  /** Told the bytes covered so far and the text's total after each window. */
  readonly onProgress?: (coveredBytes: number, totalBytes: number) => void;
  /** Told each window's confirmed blocks and the offset up to which the blocks are now known (the next window's start, or the
   *  text's end after the last), before the next window is asked: what feeds a `MarkdownCutter`. */
  readonly onBlocks?: (blocks: readonly TextBlock[], frontier: number) => void;
  /** The window, in UTF-8 bytes: the render gate by default (a test shrinks it). */
  readonly windowBytes?: number;
}

/** The blocks of the whole text, asked of the worker window by window (`ask` answers the blocks of one source, or null when the
 *  worker refused, timed out or failed). Each window is a gate of text from a confirmed block start; one block that runs past it
 *  (or a block comment it does not close, `openComment`) doubles the window up to `READER_BLOCKS_MAX_BYTES`, and past that, or on a
 *  null answer or a refused window, the blocks stop: `tailFrom` is the confirmed offset from which they are unknown (null: the
 *  whole text is covered). An abort rejects with the signal's reason. */
export async function collectMdBlocks(
  text: string,
  ask: (src: string) => Promise<MdBlock[] | null>,
  signal: AbortSignal,
  opts: CollectOptions = {},
): Promise<{ blocks: TextBlock[]; tailFrom: number | null }> {
  const blocks: TextBlock[] = [];
  const total = utf8Bytes(text);
  const base = opts.windowBytes ?? DOCS_RENDER_GATE_BYTES;
  let from = 0;
  let covered = 0;
  let bytes = base;
  for (;;) {
    throwIfAborted(signal);
    const win = blockWindow(text, from, bytes);
    if (win === null) return { blocks, tailFrom: from };
    const answer = await ask(win.src);
    throwIfAborted(signal);
    if (answer === null) return { blocks, tailFrom: from };
    const fold = foldBlockWindow(text, win, answer);
    if (fold.grow) {
      if (bytes >= READER_BLOCKS_MAX_BYTES) return { blocks, tailFrom: from };
      bytes = Math.min(READER_BLOCKS_MAX_BYTES, bytes * 2);
      continue;
    }
    if (fold.next !== null && fold.next <= from) return { blocks, tailFrom: from };
    for (const b of fold.blocks) blocks.push(b);
    opts.onBlocks?.(fold.blocks, fold.next ?? text.length);
    if (fold.next === null) return { blocks, tailFrom: null };
    covered += utf8Bytes(text.slice(from, fold.next));
    from = fold.next;
    bytes = base;
    opts.onProgress?.(covered, total);
  }
}

/** A stretch of the text the greedy cut works on: from one cut candidate to the next. `block` is the block that starts at its
 *  start (none for text before the first block, and none for the unread tail, `raw`). */
interface Unit { readonly start: number; readonly end: number; readonly block: TextBlock | undefined; readonly heading: boolean; readonly raw: boolean }

const MARKER_ALONE_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])/;
const FENCE_RUN_RE = /(`{3,}|~{3,})/;
const FENCE_PREFIX_RE = /^[ \t>\-*+.)\d]*$/;
const LIST_MARKER_G = /[-*+]|\d{1,9}[.)]/g;

/** The cutter that `splitMarkdownPartsAt` runs: one per call, holding the text, the size and the probe. */
class BlockCutter {
  private readonly text: string;
  private readonly max: number;
  private readonly probe: Probe | undefined;

  constructor(text: string, max: number, probe: Probe | undefined) {
    this.text = text;
    this.max = max;
    this.probe = probe;
  }

  /** The UTF-8 bytes of `text.slice(a, b)`. */
  bytes(a: number, b: number): number {
    if (this.probe !== undefined) this.probe.chars += b - a;
    return utf8Bytes(this.text.slice(a, b));
  }

  /** The UTF-8 bytes of `text.slice(a, b)`, or `cap + 1` as soon as they pass `cap`: a long line is not measured to its end
   *  each time a part of it is cut. */
  private bytesWithin(a: number, b: number, cap: number): number {
    let n = 0;
    let i = a;
    while (i < b) {
      const c = this.text.codePointAt(i)!;
      n += utf8CodePointBytes(c);
      i += c > 0xffff ? 2 : 1;
      if (n > cap) break;
    }
    if (this.probe !== undefined) this.probe.chars += i - a;
    return n > cap ? cap + 1 : n;
  }

  /** The offset after the line terminator of the line that holds `off` (the text's end for the last line). */
  private lineEnd(off: number): number {
    const t = this.text;
    let i = off;
    while (i < t.length) {
      const c = t.charCodeAt(i);
      if (c === 10) { if (this.probe !== undefined) this.probe.chars += i + 1 - off; return i + 1; }
      if (c === 13) { if (this.probe !== undefined) this.probe.chars += i + 1 - off; return i + (t.charCodeAt(i + 1) === 10 ? 2 : 1); }
      i += 1;
    }
    if (this.probe !== undefined) this.probe.chars += i - off;
    return t.length;
  }

  /** The line at `off` (a line start): its text without the terminator, and the offset after it. */
  private lineAt(off: number): { content: string; next: number } {
    const next = this.lineEnd(off);
    let stop = next;
    while (stop > off && (this.text.charCodeAt(stop - 1) === 10 || this.text.charCodeAt(stop - 1) === 13)) stop -= 1;
    return { content: this.text.slice(off, stop), next };
  }

  /** P1's cut of `text.slice(from, to)`, its offsets moved back. The first part keeps `continued`; the rest are continued, or keep
   *  P1's own flags (`keep`: the unread tail, whose parts start at a heading line as P1 reads one). */
  private p1(from: number, to: number, continued: boolean, keep: boolean): MdPart[] {
    const { parts } = splitMarkdownParts(this.text.slice(from, to), this.max, this.probe);
    return parts.map((p, i) => ({
      start: p.start + from, end: p.end + from, continued: i === 0 ? continued : keep ? p.continued : true, reopen: p.reopen, close: p.close,
    }));
  }

  /** Greedy parts over `units`, cutting only at unit starts: the latest start that fits (at the top level, the latest heading's
   *  first), and a unit that alone is larger than a part is cut by `cutUnit`. The parts cover the units. At the top level a part
   *  is continued unless it starts at a heading; inside a unit every part but the first is. */
  private greedy(units: readonly Unit[], top: boolean, continued0: boolean, cutUnit: (u: Unit, continued: boolean) => MdPart[]): MdPart[] {
    const out: MdPart[] = [];
    const size: number[] = new Array<number>(units.length).fill(-1);
    const sizeOf = (j: number): number => (size[j]! >= 0 ? size[j]! : (size[j] = this.bytes(units[j]!.start, units[j]!.end)));
    const startedBy = (k: number): boolean => (top ? !(k < units.length && units[k]!.heading) : true);
    let k = 0;
    let continued = continued0;
    while (k < units.length) {
      let sum = 0;
      let j = k;
      let any = -1;
      let head = -1;
      while (j < units.length) {
        if (this.probe !== undefined) this.probe.chars += 1;
        sum += sizeOf(j);
        if (sum > this.max) break;
        j += 1;
        if (j < units.length) {
          any = j;
          if (top && units[j]!.heading) head = j;
        }
      }
      if (j === units.length) {
        out.push({ start: units[k]!.start, end: units[units.length - 1]!.end, continued, reopen: null, close: null });
        break;
      }
      const pick = head >= 0 ? head : any;
      if (pick > k) {
        out.push({ start: units[k]!.start, end: units[pick]!.start, continued, reopen: null, close: null });
        k = pick;
        continued = startedBy(k);
        continue;
      }
      for (const p of cutUnit(units[k]!, continued)) out.push(p);
      k += 1;
      continued = startedBy(k);
    }
    return out;
  }

  /** The parts of one unit that alone is larger than a part: by its block's own rules, else P1 on the unit's slice. */
  cutUnit(u: Unit, continued: boolean): MdPart[] {
    if (u.block === undefined) return this.p1(u.start, u.end, continued, u.raw);
    return this.cutBlock(u.block, u.start, u.end, continued, false) ?? this.p1(u.start, u.end, continued, false);
  }

  /** The parts of `[from, to)`, a block and the text after it up to the next one, cut at the block's own seams; null when it has
   *  none to cut at (the caller falls back to P1): a list or quote with two or more items at the items' starts, a fence
   *  closed and reopened (the unit's block, or one a list item or a one-item quote holds). `item`: the block is a list item, which
   *  is always cut (a fence it holds closed and reopened, else P1 with the item's marker reopening each part that starts inside it). */
  private cutBlock(blk: TextBlock, from: number, to: number, continued: boolean, item: boolean): MdPart[] | null {
    const items = blk.items ?? [];
    if (item) {
      const fence = items.find((i) => i.kind === 'fence');
      return (fence === undefined ? null : this.cutFence(fence, from, to, continued, blk, null)) ?? this.p1InItem(from, to, continued, blk, false);
    }
    if (blk.kind === 'list' || blk.kind === 'quote') {
      const asItems = blk.kind === 'list';
      if (items.length >= 2) return this.cutItems(items, from, to, continued, asItems);
      if (items.length === 1) return this.cutBlock(items[0]!, from, to, continued, asItems);
      return null;
    }
    if (blk.kind === 'fence') return this.cutFence(blk, from, to, continued, null, null);
    return null;
  }

  /** The parts of a list's or quote's items, cut at the items' starts (one level). */
  private cutItems(items: readonly TextBlock[], from: number, to: number, continued: boolean, asItems: boolean): MdPart[] {
    const cand: { start: number; block: TextBlock }[] = [{ start: from, block: items[0]! }];
    for (const it of items.slice(1)) {
      if (it.start <= cand[cand.length - 1]!.start || it.start >= to) continue;
      cand.push({ start: it.start, block: it });
    }
    const units: Unit[] = cand.map((c, i) => ({ start: c.start, end: i + 1 < cand.length ? cand[i + 1]!.start : to, block: c.block, heading: false, raw: false }));
    return this.greedy(units, false, continued, (u, cont) => this.cutBlock(u.block!, u.start, u.end, cont, asItems) ?? this.p1(u.start, u.end, cont, false));
  }

  /** A list item's marker alone on a line (`-\n`, `1.\n`): what a part that starts inside the item begins with, so the text after
   *  it is the item's own and an indented paragraph is not read as indented code. Null when the item's first line shows none. */
  private markerOf(li: TextBlock): string | null {
    const mk = MARKER_ALONE_RE.exec(this.lineAt(li.start).content);
    return mk === null ? null : mk[0] + '\n';
  }

  /** P1's cut of `[from, to)`, text of the list item `li`, in parts that are `max` less the marker's bytes: every part that starts
   *  inside the item (all but the first, which starts at its marker line, unless `firstMid`) and has no reopen of P1's own begins
   *  with the item's marker alone. */
  private p1InItem(from: number, to: number, continued: boolean, li: TextBlock, firstMid: boolean): MdPart[] {
    const mk = this.markerOf(li);
    const extra = mk === null ? 0 : utf8Bytes(mk);
    if (mk === null || this.max - extra < 16) return this.p1(from, to, continued, false);
    const parts = new BlockCutter(this.text, this.max - extra, this.probe).p1(from, to, continued, false);
    return parts.map((p, i) => (p.reopen === null && (i > 0 || firstMid) ? { ...p, reopen: mk } : p));
  }

  /** The parts of `[from, to)`, what follows a fence inside the list item `li` (null: no item holds it): the item's next fence, cut
   *  as a fence with the item's marker alone ahead of it, else P1 inside the item. */
  private cutRest(li: TextBlock | null, from: number, to: number): MdPart[] {
    if (li === null) return this.p1(from, to, true, false);
    const next = (li.items ?? []).find((i) => i.kind === 'fence' && i.start >= from);
    return (next === undefined ? null : this.cutFence(next, from, to, true, li, this.markerOf(li))) ?? this.p1InItem(from, to, true, li, true);
  }

  /** Whether the text at `off` is spaces or tabs and then three backticks or three tildes. */
  private startsWithFence(off: number): boolean {
    let i = off;
    while (this.text.charCodeAt(i) === 32 || this.text.charCodeAt(i) === 9) i += 1;
    return this.text.startsWith('```', i) || this.text.startsWith('~~~', i);
  }

  /** The parts of `[from, to)` around the fence `F`: what comes before it in its container (a list item's marker line and text),
   *  the fence cut at content line ends, each part that ends inside it closed with a line of its own and the next one reopened,
   *  and what follows it. `li` is the list item that holds it (null: it is the unit's block, or a quote's). `startReopen`: what the
   *  first part begins with when `from` is inside the item, after its first line. What follows the fence is one part with it when
   *  that fits, else the item's next fence cut the same way, or P1 inside the item (`cutRest`). Null when the lines that close and
   *  reopen do not fit (a window of a few dozen bytes), or the fence's opener is not read as a fence line. */
  private cutFence(F: TextBlock, from: number, to: number, continued: boolean, li: TextBlock | null, startReopen: string | null): MdPart[] | null {
    const text = this.text;
    const max = this.max;
    const open = this.lineAt(F.start);
    const run = FENCE_RUN_RE.exec(open.content);
    if (run === null) return null;
    let prefix = open.content.slice(0, run.index);
    if (!FENCE_PREFIX_RE.test(prefix)) return null;
    const marker = run[1]!;
    const word = (open.content.slice(run.index + marker.length).trim().split(/[ \t]/)[0] ?? '');
    const info = word !== '' && utf8Bytes(word) <= REOPEN_INFO_MAX ? ' ' + word : '';
    // The fence is on a later line of its item: the item's marker alone on a line, then the opener. The marker alone puts the
    // item's content column at the marker's width plus one, so an opener indented past that column by four or more (the item's
    // own column was further right: `-    text`) would read as indented code there: its indent is cut to three past the column.
    const mk = li !== null && F.start > li.start ? this.markerOf(li) : null;
    if (li !== null && F.start > li.start) {
      if (mk === null) return null;
      if (/^ +$/.test(prefix) && prefix.length > mk.length + 3) prefix = ' '.repeat(mk.length + 3);
    }
    // The prefix of a content line: the opener's own, its list markers as spaces of the same width, so the closing line sits at the
    // item's content column and the quote marks stay.
    const cont = prefix.replace(LIST_MARKER_G, (s) => ' '.repeat(s.length));
    const reopenLine = (mk ?? '') + prefix + marker + info + '\n';
    const closeLine = cont + marker + '\n';
    const closeBytes = utf8Bytes(closeLine);
    const fenceEnd = Math.min(Math.max(F.end, open.next), to);
    let reopen: string | null = startReopen;
    let budget = max - (reopen === null ? 0 : utf8Bytes(reopen));
    let used = this.bytes(from, open.next);
    if (used > budget || (fenceEnd > open.next && used + closeBytes > budget)) return null;
    const parts: MdPart[] = [];
    let cur = from;
    let pos = open.next;
    let flag = continued;
    const push = (end: number, close: string | null): void => {
      parts.push({ start: cur, end, continued: flag, reopen, close });
      flag = true;
    };
    const restart = (at: number, midLine: boolean): void => {
      cur = at;
      reopen = reopenLine + (midLine ? cont : '');
      budget = max - utf8Bytes(reopen);
      used = 0;
    };
    while (pos < fenceEnd) {
      const le = Math.min(this.lineEnd(pos), fenceEnd);
      const last = le >= fenceEnd;
      for (;;) {
        // A line is measured only as far as the room that is left: a long line cut into many parts is not measured whole each time.
        const room = budget - used - (last ? 0 : closeBytes);
        const lb = room < 0 ? 1 : this.bytesWithin(pos, le, room);
        if (lb <= room) { used += lb; pos = le; break; }
        if (pos > cur) {
          // The line does not fit what is left: this part ends before it, inside the fence, and the next reopens it.
          push(pos, closeLine);
          restart(pos, false);
          continue;
        }
        // Not even alone in a part of its own: cut the line at a code point boundary.
        const avail = budget - used - (closeBytes + 1);
        if (avail < 1) return null;
        const cp = codePointCut(text, pos, le, avail);
        if (this.probe !== undefined) this.probe.chars += cp.off - pos;
        if (cp.bytes > avail) return null;
        let e = cp.off;
        // The tail must not read as a fence line: never start it with spaces or tabs and then three or more backticks or tildes (the
        // reopen's own prefix and these make a closing line), never split a surrogate pair.
        while (e > pos && this.startsWithFence(e)) e -= e - 2 >= pos && isLowSurrogate(text.charCodeAt(e - 1)) && isHighSurrogate(text.charCodeAt(e - 2)) ? 2 : 1;
        if (e <= pos) return null;
        push(e, '\n' + closeLine);
        restart(e, true);
        pos = e;
      }
    }
    const after = this.bytes(fenceEnd, to);
    if (used + after <= budget) push(to, null);
    else {
      // This part also takes the blank lines right after the fence that fit: the rest starts with the item's marker alone, and
      // a blank line right after it would end the item (an empty item holds at most one) and turn its indented text into code.
      let cutAt = fenceEnd;
      while (cutAt < to) {
        const le = this.lineEnd(cutAt);
        if (text.slice(cutAt, le).trim() !== '') break;
        const lb = this.bytes(cutAt, le);
        if (used + lb > budget) break;
        used += lb;
        cutAt = le;
      }
      push(cutAt, null);
      if (cutAt < to) for (const p of this.cutRest(li, cutAt, to)) parts.push(p);
    }
    return parts;
  }

}

function isHighSurrogate(c: number): boolean { return c >= 0xd800 && c <= 0xdbff; }
function isLowSurrogate(c: number): boolean { return c >= 0xdc00 && c <= 0xdfff; }

/** A cut candidate of the top-level greedy: a block start (the first, offset 0, has no block when the text begins with lines the
 *  library draws no block for), or the unread tail (`raw`). A unit is from one candidate to the next. */
interface Cand { readonly start: number; readonly block: TextBlock | undefined; readonly raw: boolean }

/** The block cutter, incremental: fed the confirmed blocks of each window (`feed`), it answers the parts that are FINAL so far,
 *  and at the end (`finish`) the rest, which together are `splitMarkdownPartsAt` of the same blocks (a case asserts it on the
 *  fuzz documents and the fixtures). The cut is greedy from the left, so a part is final as soon as the units from its start
 *  overflow a part: the blocks known so far (the last unit's known text counted as a lower bound of its size) say where it
 *  ends, whatever follows. A unit that alone is larger than a part waits for its end. */
export class MarkdownCutter {
  private readonly text: string;
  private readonly max: number;
  private readonly probe: Probe | undefined;
  private readonly cutter: BlockCutter;
  private readonly cand: Cand[] = [];
  private readonly sizes: number[] = [];
  private known = 0;
  private at = 0;
  private continued = false;
  private begun = false;
  private emitted = 0;

  constructor(text: string, maxBytes: number, probe?: Probe) {
    this.text = text;
    this.max = maxBytes;
    this.probe = probe;
    this.cutter = new BlockCutter(text, maxBytes, probe);
  }

  /** The offset up to which the blocks are known: the start of the next window, or of the unread tail. */
  get covered(): number { return this.known; }

  /** Takes a window's confirmed blocks (in order, after the ones fed before) and `frontier`, the offset up to which the blocks are
   *  now known; answers the parts that became final. */
  feed(blocks: readonly TextBlock[], frontier: number): MdPart[] {
    this.begin(blocks);
    for (const b of blocks) {
      if (b.start <= this.cand[this.cand.length - 1]!.start) continue;
      if (this.text.startsWith('---', b.start)) continue; // a part that began at dashes would read front matter
      this.cand.push({ start: b.start, block: b, raw: false });
    }
    this.known = Math.max(this.known, frontier);
    return this.step(false);
  }

  /** The end of the blocks: `tailFrom` is the offset from which they are unknown (null: the whole text is covered). Answers the
   *  parts not yet final, the unread tail cut by `splitMarkdownParts`. */
  finish(tailFrom: number | null): MdPart[] {
    this.begin([]);
    const text = this.text;
    if (this.emitted === 0) {
      if (utf8Bytes(text) <= this.max) return [{ start: 0, end: text.length, continued: false, reopen: null, close: null }];
      if (tailFrom === 0) return splitMarkdownParts(text, this.max, this.probe).parts;
    }
    const last = this.cand[this.cand.length - 1]!;
    if (tailFrom !== null && tailFrom > last.start && !text.startsWith('---', tailFrom)) this.cand.push({ start: tailFrom, block: undefined, raw: true });
    this.known = text.length;
    return this.step(true);
  }

  private begin(blocks: readonly TextBlock[]): void {
    if (this.begun) return;
    this.begun = true;
    this.cand.push({ start: 0, block: blocks[0]?.start === 0 ? blocks[0] : undefined, raw: false });
  }

  /** The unit that starts at candidate `i`, its end known (the next candidate, or the text's end once `final`). */
  private unitAt(i: number, final: boolean): Unit {
    const c = this.cand[i]!;
    return { start: c.start, end: i + 1 < this.cand.length ? this.cand[i + 1]!.start : final ? this.text.length : this.known, block: c.block, heading: c.block?.kind === 'heading', raw: c.raw };
  }

  /** The greedy cut as far as it is decided: the parts, in order, from the unit the cut stopped at. */
  private step(final: boolean): MdPart[] {
    const out: MdPart[] = [];
    const { cand, max } = this;
    for (;;) {
      const n = cand.length;
      const k = this.at;
      if (k >= n) break;
      let sum = 0;
      let j = k;
      let any = -1;
      let head = -1;
      let over = false;
      for (; j < n; j += 1) {
        if (this.probe !== undefined) this.probe.chars += 1;
        // A unit whose end is known is measured once; the last one is only as long as the known text says, a lower bound.
        if (j + 1 < n || final) {
          if (this.sizes[j] === undefined) this.sizes[j] = this.cutter.bytes(cand[j]!.start, j + 1 < n ? cand[j + 1]!.start : this.text.length);
          sum += this.sizes[j]!;
        } else sum += this.cutter.bytes(cand[j]!.start, this.known);
        if (sum > max) { over = true; break; }
        if (j + 1 < n) {
          any = j + 1;
          if (cand[j + 1]!.block?.kind === 'heading') head = j + 1;
        }
      }
      if (!over) {
        if (!final) break;
        out.push({ start: cand[k]!.start, end: this.text.length, continued: this.continued, reopen: null, close: null });
        this.at = n;
        break;
      }
      const pick = head >= 0 ? head : any;
      if (pick > k) {
        out.push({ start: cand[k]!.start, end: cand[pick]!.start, continued: this.continued, reopen: null, close: null });
        this.at = pick;
        this.continued = cand[pick]!.block?.kind !== 'heading';
        continue;
      }
      if (k + 1 >= n && !final) break; // the unit that is larger than a part has no end yet
      for (const p of this.cutter.cutUnit(this.unitAt(k, final), this.continued)) out.push(p);
      this.at = k + 1;
      this.continued = this.at < n ? cand[this.at]!.block?.kind !== 'heading' : true;
    }
    this.emitted += out.length;
    return out;
  }
}

/** The Markdown parts of `text`, cut at the block boundaries of the shared library's own parse (`collectMdBlocks`), in parts of at
 *  most `maxBytes` UTF-8 bytes, the same `{ parts }` as `splitMarkdownParts`. A text at or below `maxBytes` is one part. Otherwise,
 *  greedy from offset 0, a part ends only at a block start (never at offset 0, and never before a block whose first line is dashes,
 *  which a part would read as front matter), at the LATEST heading block start that fits, else the latest block start that fits.
 *  When no block start fits, the unit up to the next block start (or `tailFrom`, or the end) is cut by its block: a list or quote
 *  of two or more items between its items; a fence closed and reopened with its container's prefix (the first fence an item or a
 *  quote holds too); anything else, and a window too small for those, by `splitMarkdownParts` on the unit's slice. From `tailFrom`
 *  (the offset from which the blocks are unknown) the rest is `splitMarkdownParts`'s. `probe` is as for `splitMarkdownParts`.
 *  One shot: `MarkdownCutter` fed all the blocks at once. */
export function splitMarkdownPartsAt(text: string, maxBytes: number, blocks: readonly TextBlock[], tailFrom: number | null, probe?: Probe): { parts: MdPart[] } {
  if (probe !== undefined) probe.chars += text.length;
  if (utf8Bytes(text) <= maxBytes) return { parts: [{ start: 0, end: text.length, continued: false, reopen: null, close: null }] };
  if (tailFrom === 0) return splitMarkdownParts(text, maxBytes, probe);
  const cutter = new MarkdownCutter(text, maxBytes, probe);
  const known = tailFrom === null ? blocks : blocks.filter((b) => b.start < tailFrom);
  const parts = cutter.feed(known, tailFrom ?? text.length);
  for (const p of cutter.finish(tailFrom)) parts.push(p);
  return { parts };
}

/** What `cutMarkdownText` asks of the render job: the reader's (`ReaderDeps['render']`) with `blocks: true`. */
export type BlocksJob = (src: string, o: { budgetMs: number; signal: AbortSignal; blocks: true }) => Promise<ReaderRenderOutcome>;

export interface CutOptions {
  /** The part size (the render gate by default). */
  readonly maxBytes?: number;
  /** The window of the blocks read (the render gate by default; a test shrinks it). */
  readonly windowBytes?: number;
  /** Told each batch of parts as it becomes final, in order, while the rest is read. */
  readonly onParts?: (parts: MdPart[]) => void;
  /** Told the bytes of the text the blocks cover and its total, after each window. */
  readonly onProgress?: (coveredBytes: number, totalBytes: number) => void;
}

/** The whole cut of a Markdown text, as delivery drives it: the render job is asked for the blocks window by window (each under
 *  its parse budget), a `blocks` answer is the window's blocks and anything else, or a throw, ends the blocks there, and the
 *  `MarkdownCutter` answers parts as they become final (`onParts`); what the blocks do not cover is the line cutter's. Answers
 *  every part. An abort rejects with the signal's reason. */
export async function cutMarkdownText(text: string, job: BlocksJob, signal: AbortSignal, opts: CutOptions = {}): Promise<MdPart[]> {
  const cutter = new MarkdownCutter(text, opts.maxBytes ?? DOCS_RENDER_GATE_BYTES);
  const all: MdPart[] = [];
  const emit = (parts: MdPart[]): void => {
    if (parts.length === 0) return;
    for (const p of parts) all.push(p);
    opts.onParts?.(parts);
  };
  const ask = async (src: string): Promise<MdBlock[] | null> => {
    try {
      const out = await job(src, { budgetMs: DOCS_PARSE_BUDGET_MS(utf8Bytes(src)), signal, blocks: true });
      return out.kind === 'blocks' ? [...out.blocks] : null;
    } catch {
      return null;
    }
  };
  let tailFrom: number | null;
  try {
    const got = await collectMdBlocks(text, ask, signal, {
      ...(opts.windowBytes === undefined ? {} : { windowBytes: opts.windowBytes }),
      ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
      onBlocks: (blocks, frontier) => { emit(cutter.feed(blocks, frontier)); },
    });
    tailFrom = got.tailFrom;
  } catch (e) {
    if (signal.aborted) throw e;
    tailFrom = cutter.covered;
  }
  emit(cutter.finish(tailFrom));
  return all;
}
