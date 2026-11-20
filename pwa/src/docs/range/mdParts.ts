// L1 policy (X2 P1 Task P1.5; X2 spec section 4.3, "Markdown in parts", amended by the coordinator's render-gate
// carry of 2026-11-19): Markdown above the render gate is read in parts no larger than the gate, each part mounting rich
// in the reader frame as its own mount. Pure: it cuts a text, it reads and writes nothing.
//
// The cut, in this order of preference, taking the latest cut of the best kind that keeps the part within `maxBytes`:
//   1. before a top-level heading (an ATX `#` or `##` line) outside a fence;
//   2. after a blank line outside a fence (the next part is "continued");
//   3. after any line outside a fence (continued);
//   4. after a line inside a top-level fence: the part ends with the fence's closing line and the next part reopens it
//      (its marker and the first word of its info string), so a fence longer than the gate still renders as code in
//      every part (continued);
//   5. after a line inside a container fence (below), with no reopen (continued);
//   6. inside a line longer than the gate, at a code point boundary, never between a surrogate pair (continued).
// A top-level fence is one a line opens at 0 to 3 columns of indentation, closed by a line of the same marker, at least
// as long, at 0 to 3 columns. Its content is literal: nothing inside it is read as anything else.
// A container fence is any other fence opener, outside a top-level fence: after blockquote marks (`>`), list markers or
// four or more columns of indentation. It starts an exclusion zone, and no cut of kinds 1 to 3 falls inside a zone, so a
// fence in a list item or a quote is never cut while any other cut fits. The zone ends at a closer (the same marker,
// at least as long, the same `>` count), or when its container provably ends: a non-blank line with fewer `>` marks, or
// a non-blank line indented less than the opener's own indentation (a fence has no lazy continuation). A line the
// detector cannot place stays in the zone: a mistake can only remove cut choices, never move a cut into a fence.
// THE ONE RESIDUAL: a container fence longer than a whole window has no allowed cut, so it is cut inside, at a line end,
// with no reopen and no close (a reopen would have to rebuild its list or quote prefix, and a wrong prefix changes what
// the rest of the document means). Its tail then reads as plain text in the next part.
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
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** The longest fence marker a part may reopen. A longer marker (a pathological document) is still tracked, so no
 *  heading inside it is a cut, but no cut is made inside it: its fence is not reopenable. */
const REOPEN_MARKER_MAX = 64;
/** The most bytes of the info string's first word a reopened fence carries (its language, for highlighting). */
const REOPEN_INFO_MAX = 64;

/** An open top-level fence: its marker, and the lines a part reopens and closes it with (null when it is not reopenable). */
interface Fence { mark: string; reopen: string | null; close: string | null }

// A container fence's line prefix: any run of blockquote marks (`>`) and list markers (`-`, `*`, `+`, `1.`, `1)`) with
// the spaces around them. Group 1 is the prefix.
const PREFIX_SRC = '((?:[ \\t]*(?:>|(?:[-*+]|\\d{1,9}[.)])(?=[ \\t])))*[ \\t]*)';
const PREFIX_RE = new RegExp('^' + PREFIX_SRC);
const ANY_OPEN_RE = new RegExp('^' + PREFIX_SRC + '(`{3,}|~{3,})([^\\n]*)$');
const FENCE_REST_RE = /^(`{3,}|~{3,})[ \t]*$/;

/** What a prefix says: `bq` its blockquote marks, `col` the column its content starts at, `base` the column the
 *  innermost quote's content starts at (a quote mark takes one following space or tab with it). */
function readPrefix(p: string): { bq: number; col: number; base: number } {
  let col = 0;
  let base = 0;
  let bq = 0;
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === ' ') { col += 1; i += 1; }
    else if (c === '\t') { col += 4 - (col % 4); i += 1; }
    else if (c === '>') {
      bq += 1; col += 1; i += 1;
      if (p[i] === ' ' || p[i] === '\t') { col += 1; i += 1; }
      base = col;
    } else {
      let j = i; // a list marker
      while (j < p.length && p[j] !== ' ' && p[j] !== '\t') j += 1;
      col += j - i; i = j;
    }
  }
  return { bq, col, base };
}

/** A container fence's exclusion zone: its marker character and length, its quote depth, and its own indentation (the
 *  columns past its quote marks that its opener sits at). */
interface Zone { ch: string; len: number; bq: number; indent: number }

/** The zone a line opens, when it is a container fence opener (outside a top-level fence, and not itself a top-level one). */
function zoneOpened(line: string): Zone | null {
  const m = ANY_OPEN_RE.exec(line);
  if (m === null) return null;
  const mark = m[2]!;
  if (mark[0] === '`' && m[3]!.includes('`')) return null;
  const pr = readPrefix(m[1]!);
  return { ch: mark[0]!, len: mark.length, bq: pr.bq, indent: pr.col - pr.base };
}

/** What a line does to a zone: it closes it, leaves it (its container is provably over), or stays inside it. */
function zoneVerdict(zone: Zone, line: string): 'close' | 'end' | 'stay' {
  if (BLANK_RE.test(line)) return 'stay';
  const m = PREFIX_RE.exec(line)!;
  const pr = readPrefix(m[1]!);
  if (pr.bq < zone.bq) return 'end';
  const rest = line.slice(m[1]!.length);
  const f = FENCE_REST_RE.exec(rest);
  if (f !== null && pr.bq === zone.bq && f[1]![0] === zone.ch && f[1]!.length >= zone.len) return 'close';
  if (BLANK_RE.test(rest)) return 'stay';
  return pr.bq === zone.bq && pr.col - pr.base < zone.indent ? 'end' : 'stay';
}

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

/** The fence state after `line`, given the state before it. */
function fenceAfter(fence: Fence | null, line: string): Fence | null {
  if (fence === null) {
    const m = FENCE_OPEN_RE.exec(line);
    if (m === null) return null;
    const mark = m[1]!;
    const info = m[2]!;
    if (mark[0] === '`' && info.includes('`')) return null;
    if (mark.length > REOPEN_MARKER_MAX) return { mark, reopen: null, close: null };
    const word = info.trim().split(/[ \t]/)[0] ?? '';
    const keep = word !== '' && utf8Bytes(word) <= REOPEN_INFO_MAX ? word : '';
    return { mark, reopen: mark + (keep === '' ? '' : ' ' + keep) + '\n', close: mark + '\n' };
  }
  const m = FENCE_CLOSE_RE.exec(line);
  return m !== null && m[1]![0] === fence.mark[0] && m[1]!.length >= fence.mark.length ? null : fence;
}

/** The fence and zone states after `line`, given the states before it (at most one of them is not null). */
function stateAfter(fence: Fence | null, zone: Zone | null, line: string): { fence: Fence | null; zone: Zone | null } {
  if (fence !== null) return { fence: fenceAfter(fence, line), zone: null };
  if (zone !== null) {
    const v = zoneVerdict(zone, line);
    if (v === 'stay') return { fence: null, zone };
    if (v === 'close') return { fence: null, zone: null };
  }
  const f = fenceAfter(null, line);
  return f !== null ? { fence: f, zone: null } : { fence: null, zone: zoneOpened(line) };
}

/** The fence a part starting at a cut is inside, for reopening: only a reopenable one. */
const reopenable = (f: Fence | null): Fence | null => (f !== null && f.reopen !== null ? f : null);

/** A test-only counter: `chars` grows by every character the cutter examines (searched, sliced or measured). It changes
 *  nothing the cutter answers; it lets a test bound the work by an operation count, never by wall time. */
export interface Probe { chars: number }

interface Cut { off: number; bytes: number; fence: Fence | null; zone: Zone | null }

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
  let state: Fence | null = null; // the top-level fence state at `start`, reopenable or not
  let zoneState: Zone | null = null; // the container fence zone at `start`
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
    let prevRank = RANK_LINE;
    let firstLineEnd = -1;
    let atEnd = false;
    while (off < text.length) {
      const { end, line, bytes: lineBytes } = lineAt(win, start, off, probe);
      if (firstLineEnd < 0) firstLineEnd = end;
      if (off > start) {
        // A boundary inside a zone is a cut of the lowest rank; a line that ends the zone by its container's end is
        // already outside it, so the cut before it is not inside.
        const zoneHere = zone !== null && zoneVerdict(zone, line) !== 'end' ? zone : null;
        const rank = zoneHere !== null ? RANK_ZONE : fence === null && HEADING_RE.test(line) ? RANK_HEADING : prevRank;
        const tail = fence !== null && fence.close !== null ? utf8Bytes(fence.close) : 0;
        if (rank !== RANK_FENCE || fence?.reopen != null) {
          if (head + bytes + tail <= maxBytes) best[rank] = { off, bytes, fence, zone: zoneHere };
        }
      }
      const blank = fence === null && BLANK_RE.test(line);
      ({ fence, zone } = stateAfter(fence, zone, line));
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
    const pick = best[RANK_HEADING] ?? best[RANK_BLANK] ?? best[RANK_LINE] ?? best[RANK_FENCE] ?? best[RANK_ZONE];
    if (pick !== undefined) {
      const atFence = pick.fence !== null && pick.fence.close !== null ? pick.fence : null;
      parts.push({ start, end: pick.off, continued, reopen, close: atFence === null ? null : atFence.close });
      continued = best[RANK_HEADING] !== pick;
      start = pick.off;
      state = pick.fence;
      zoneState = pick.zone;
      inside = reopenable(pick.fence);
      continue;
    }
    // No line boundary fits: the first line is longer than what is left. Cut it at a code point boundary. Inside a
    // reopenable fence, the part closes it on a line of its own and the next part reopens it; when even that leaves no
    // room, the fence is not reopened (a pathological document), so every part still fits and the cut still moves.
    let closeText = inside === null ? null : '\n' + inside.close!;
    let budget = maxBytes - head - (closeText === null ? 0 : utf8Bytes(closeText));
    if (closeText !== null && budget < 4) { closeText = null; budget = maxBytes - head; }
    const cut = codePointCut(text, start, firstLineEnd, budget);
    parts.push({ start, end: cut.off, continued, reopen, close: closeText });
    if (cut.off >= firstLineEnd) {
      // The whole first line went: the fence state moves past it.
      ({ fence: state, zone: zoneState } = stateAfter(state, zoneState, lineAt(win, start, start, probe).line));
      inside = reopenable(state);
    } else if (closeText === null) {
      inside = null;
    }
    start = cut.off;
    continued = true;
  }
  return { parts };
}
