// L1 policy (X2 P1 Task P1.5; X2 spec section 4.3, "Markdown in parts", amended by the coordinator's render-gate
// carry of 2026-11-19): Markdown above the render gate is read in parts no larger than the gate, each part mounting rich
// in the reader frame as its own mount. Pure: it cuts a text, it reads and writes nothing.
//
// The cut, in this order of preference, taking the latest cut of the best kind that keeps the part within `maxBytes`:
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
// THE FIVE RESIDUAL CLASSES: this cutter is a line heuristic, not a parser, and a cut can still fall inside a fence or leave
// a part that starts oddly. Each class below is recorded with its input in the plan's Results. P6.1 Step 0b2's
// parser-backed cutter replaces them all.
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
