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
// for: `<details>`, reference definitions, comment anchors) belongs to the block before it, EXCEPT a closed comment: a line that
// opens one (up to three spaces, then `<!--`) whose first `-->` closes it inside the same gap, with only white space after it, is
// a cut candidate of its own, as is the line after its closer's line (`gapComments`, `MarkdownCutter.gap`; X2 P6.1 review F3), so
// the greedy cut keeps a comment whole while it fits, and a part starting at one is `continued`. A comment that alone is larger
// than a part is cut like a fence (`cutComment`): each part that ends inside it ends with `-->` on a line of its own (a newline
// first when it ends mid-line), the next begins with `<!--` on a line of its own, at line ends, a line too long at a code point
// boundary (never inside the opener, the closer or a surrogate pair), so no part shows commented text. An opener with no `-->` is
// text, and a closed comment inside a list item or a quote is NOT a candidate (the library draws it inside the container's block);
// the container is kept whole instead, by the rule below. When no block start fits, that unit
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
// When the lines that close and reopen do not fit (a window of a few dozen bytes), the unit falls back to P1 whole, or is kept whole
// when it holds a comment opener (the rule below).
// THE CONSERVATIVE RULE (wave 64, the coordinator's ruling for ticket `x2-fu-comments-in-parts`): the cutter never cuts inside a
// unit whose text holds a comment opener, `<!--`, anywhere (closed or not, in code or not: it reads the text, not the parse). A
// top-level unit, a list item, a fence, a quote's own block, and the text before the first block that alone is larger than a part
// and holds one is one part, whole, above the part size (`holdsOpener`, `whole`, `p1OrWhole`). Cuts between units stay: a list or
// a quote is still cut between its items, each item then read by the same rule. A top-level comment unit is still closed and
// reopened by `cutComment` where it has room, the text after its closer line in its last part; where it has none (its closer line
// beside the reopen line, a window too small, or the text after the closer line that no part holds) it is whole too, never P1's,
// so no part of it starts at dashes. The unread tail (`raw`) is P1's, as it was, but for one that starts at a closed top-level
// comment (the blocks read stops at a comment longer than its cap): that comment is a comment unit, the tail after it; where the blocks stop at a block that starts with
// dashes (no candidate there), the unit that runs into the tail is read by the rule only up to it (`rawFrom`): when that much holds
// an opener it is cut there, by the rule as any unit is, and the tail is P1's, a blank line before its first part (which starts at
// dashes: no front matter); P1's later parts may still start at dashes, as the unread tail's do (its own residual); and when it
// holds none the unit is cut exactly as before. A text with no opener is cut byte for byte as
// before (a case pins a corpus's digest measured on the cutter before the rule). The largest whole part: a unit's two ends are cut
// candidates one window confirmed, so it is at most a blocks window, `READER_BLOCKS_MAX_BYTES` (measured: a list item of
// 2 096 966 bytes, four render gates, is one part; one past the window ends the blocks read there, the unread tail), except a run
// of blocks that each start with three dashes, which joins the unit before it (no part starts at dashes) and can carry it past the
// window. A part above the render gate gets what any Markdown above the gate gets (`ReaderFrame.tsx`'s G2): `DocMarkdown`'s own
// question, Format anyway or Show as text, and the console's own view, which shows a comment as text; the render job refuses it
// `over-limit` (the pre-pass then knows no ids for it), so it never reaches the frame or its caps, and Print prints it as its plain
// text with the over-gate sentence (`printWords.ts`).
// The cut is INCREMENTAL (`MarkdownCutter`): fed each window's confirmed blocks it answers the parts that are final so far (a part
// is final once the units from its start overflow a part, whatever follows), and the rest at the end, which together are
// `splitMarkdownPartsAt` of the same blocks. `cutMarkdownText` drives it for delivery: the render job, each window's budget, what a
// non-`blocks` answer or a throw of the JOB does (ends the blocks there), the parts as they become final. A throw of the cutter
// itself (a feed, or `finish`) is not an end of the blocks but a failure of the cut: the answer is then `splitMarkdownParts` of the
// whole text, told through `onFallback` so the page drops the parts it was streamed (X2 P6.1 review F2). The walk over the fences
// of a list item is a loop, so no depth of recursion grows with the text.
// A window that ends inside a block COMMENT confirms only the blocks before the block that holds the comment's opening line
// (`openComment`): the library reads `<!--` as a comment only when a `-->` follows in the same source.
//
// THE RESIDUAL CLASSES: nine below were measured against P1's line cutter, which is still the fallback, and a tenth is the block
// cutter's own (comments); the block cutter's state:
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
//   10 (a closed comment cut inside, so its text shows: the block cutter's own class, X2 P6.1 review 4116 F3, ruled a residual on
//     2026-11-27): none on the block cutter for the shapes measured, but one footnote shape (below), since wave 64's conservative
//     rule (above): no unit that holds an opener is cut inside but a top-level comment, closed and reopened. That holds where a
//     comment is inside one block of the render that starts where its container does: the library reads a comment opened in a list
//     item or a footnote definition up to the document's first closer (the container then runs on through it), one in a quote up to
//     the quote's end, and a blocks window that ends inside such a comment ends before the block that holds it (`openComment`),
//     never at an opener's line indented four columns or more, which read from there is code (`foldBlockWindow`). Both since wave
//     64's fix round 1 (review 4221 F1), which also reads a footnote definition's label `[^label]:` as a container prefix. Before it,
//     a comment opened on a definition's first line was cut inside across a window's end, and one opened on a later, indented line
//     of a definition, holding only the opener, with no block of the definition before it, was read from that line as code (a named
//     definition with an empty first line: two parts showed all 9 400 hidden lines at the gate). Measured,
//     with the library's render of the whole document as control, each now showing no hidden text and every shown word as often as
//     the whole: a comment in a list item followed by another item, and in a quote, at the gate; a lone item and an item holding a
//     fence then the comment at 200 bytes only (P6.1 at 200 bytes: 4 of 5, 4 of 4, 4 of 4 and 4 of 5 parts showed the four); a
//     footnote definition's comment across the window's end at the gate, the definition alone or in a list item, named by a
//     reference or not, and named with an empty first line and the opener on the next line; the
//     paragraph shapes, text after the first `-->` on its line (the 576 089-byte old table) and text before `<!--` on its line (a
//     `<!--->` or `<!-->` opener there too, every size from 40 to 150); an opener indented four columns, six, or by a tab, that
//     continues a paragraph; a quote's lazy lines (every size from 30 to 120); a list item whose content column is past its marker
//     and one space (60 to 170, and at the gate); a closer line longer than a part; and lines of dashes after a top-level comment
//     whose closer line does not fit beside the reopen line (24 to 200: no part starts at the dashes). Across windows of 1 024 to
//     3 000 bytes, cut at 700, no block starts inside the comment and no part shows it, for every shape the library reads past its
//     container: a footnote definition's first line (its label then the opener directly, a label of other characters or one holding
//     an opener, indented, or holding a list marker), a later indented line of one but for the shape left below (by spaces or a
//     tab; named or not; its first line text, empty, a closed comment or a link reference definition), a list item's first or
//     later line, and an opener after a `<details>` line; and the blocks are the whole read's, but for a definition named from an
//     earlier window, which its own window draws in no block (by the windows, not the comment). The library confines the opener of
//     a quote, a table cell, a link reference definition, a definition-list shape and a heading to that container or line
//     (measured: it shows what follows), so they need none. It REMAINS on the block cutter for one footnote shape, older than wave 64
//     and pinned as a known leak (ticket `x2-fu-footnote-item-block-start`): a named definition whose first line draws no block
//     (empty, a closed comment or a link reference definition), then any block indented under it (a paragraph, a list, a quote),
//     then the opener (`[^1]:` then `    para`, `    - a`, `    > q` or a tab, then `    <!--`; or `    - <!--`). The whole render
//     hides the region; every part size measured (400, 700, 2 000 bytes and the gate) shows all of it, with the whole text read in
//     one window too. The render's tree takes a footnote item's block from its inner blocks, so the definition's block starts at
//     its first drawn line, indented four columns: a cut candidate, and a part that starts there reads it as code; a window's cap
//     lands there too. It
//     REMAINS on P1's own paths:
//     the unread tail (but for a tail that starts at a closed top-level comment, which is where the blocks read stops when such a
//     comment is longer than its cap: since wave 64 that comment is a comment unit, closed and reopened, and the tail starts after
//     it, `commentAt`), the console with no render job (whose own view shows a comment as text whole or cut, so the cut changes
//     nothing on screen; its Print renders P1's parts through the library, so there a part may print what the whole would hide),
//     and the whole-text fallback of a cutter that throws. (The shapes' history: X2 P6.1's fix rounds and wave 62,
//     in the plan's class 10 notes; a `<!-->` or `<!--->` opener at the start of its line with only white space after it hides
//     nothing, review 4131 A2.)
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
  // The blocks are sorted and apart, so the one that holds `off` is found by bisection.
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = blocks[mid]!;
    if (off < b.start) hi = mid - 1;
    else if (off >= b.end) lo = mid + 1;
    else return b.kind === 'fence' || b.kind === 'code' || (b.items !== undefined && inCode(b.items, off));
  }
  return false;
}

/** The longest prefix of a line (its quote marks, white space and list markers) that `openComment` reads; a longer one is not a
 *  container prefix and the line is treated as an open comment (fail closed: the window is shortened). */
const COMMENT_PREFIX_MAX = 256;
/** The most lines holding a `<!--` that `openComment` examines in one window; past it the next such line is treated as open. */
const COMMENT_LINES_MAX = 4096;

/** Whether `s[from, to)` is only a container prefix: quote marks (`>`), spaces and tabs, list markers (`-`, `*`, `+`, or one to
 *  nine digits and `.` or `)`), each marker followed by a space or tab, and footnote-definition labels (`[^label]:`, wave 64 fix
 *  round 1, review 4221 F1). The footnote rule (markdown-it-footnote, which the library uses) reads a definition's lines with the
 *  document's end as theirs, so a comment opened in one hides everything up to its closer, top-level blocks included, as one opened
 *  in a list item does. Its label as that rule reads it: `[^`, then any characters but a space up to the first `]`, at least one,
 *  then `:`, which may be followed by the opener directly. A label that the opener interrupts (no `]:` before it) is read as a
 *  prefix too, fail closed: the line may hold a later opener in that definition, and a prefix read wrongly only shortens a window.
 *  One forward pass, no backtracking. */
function containerPrefix(s: string, from: number, to: number): boolean {
  let i = from;
  while (i < to) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 62) { i += 1; continue; }
    if (c === 91 && s.charCodeAt(i + 1) === 94) {
      let k = i + 2;
      while (k < to && s.charCodeAt(k) !== 93 && s.charCodeAt(k) !== 32) k += 1;
      if (k >= to) return true;
      if (s.charCodeAt(k) === 32 || k === i + 2 || s.charCodeAt(k + 1) !== 58 || k + 1 >= to) return false;
      i = k + 2;
      continue;
    }
    let j = i;
    if (c === 45 || c === 42 || c === 43) j += 1;
    else if (c >= 48 && c <= 57) {
      while (j < to && j - i < 9 && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j += 1;
      if (j < to && (s.charCodeAt(j) === 46 || s.charCodeAt(j) === 41)) j += 1;
      else return false;
    } else return false;
    if (j < to && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) i = j + 1;
    else return false;
  }
  return true;
}

/** The start of the first line of a window that opens a block comment the window does not close, or -1. The library reads a
 *  `<!--` line as a comment only when a `-->` follows it in the same source (`blockComment` in its `allowlist.js` looks from
 *  that line to the source's end), so at a window's end such a line is paragraph text and the comment's inner lines are blocks
 *  that the whole document does not have. A line opens one when, after its quote marks, indentation and list markers, it starts
 *  with `<!--`, outside a block parsed as code, and no `-->` stands at or after it in the window. Linear in the window whatever its
 *  bytes: one forward pass finds the openers and carries the line start along (no walk back), the prefix test is a scan with no
 *  backtracking, only the first opener of a line is examined (a later one has `<!--` in its prefix), a prefix over
 *  `COMMENT_PREFIX_MAX` characters and a window with over `COMMENT_LINES_MAX` such lines are read as an open comment (fail closed:
 *  they shorten the window, which is safe). `probe` counts the characters examined. */
function openComment(slice: string, from: number, all: readonly TextBlock[], probe: Probe | undefined): number {
  if (probe !== undefined) probe.chars += slice.length;
  let i = slice.indexOf('<!--', slice.lastIndexOf('-->') + 1);
  let p = 0; // how far the line start has been carried
  let ls = 0; // the start of the line that holds `p`
  let examined = -1; // the line start of the last line whose opener was examined
  let lines = 0;
  while (i !== -1) {
    for (; p < i; p += 1) {
      const c = slice.charCodeAt(p);
      if (c === 10 || c === 13) ls = p + 1;
    }
    if (probe !== undefined) probe.chars += 1;
    if (ls !== examined) {
      examined = ls;
      lines += 1;
      if (lines > COMMENT_LINES_MAX || i - ls > COMMENT_PREFIX_MAX) return from + ls;
      if (probe !== undefined) probe.chars += i - ls;
      if (containerPrefix(slice, ls, i) && !inCode(all, from + i)) return from + ls;
    }
    i = slice.indexOf('<!--', i + 1);
  }
  return -1;
}

/** Whether the line that starts at `ls` is indented four columns or more (a tab runs to the next multiple of four), as markdown-it
 *  reads indented code at the top level. Reads at most four characters. */
function indentedFour(text: string, ls: number): boolean {
  let col = 0;
  for (let i = ls; col < 4; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 32) col += 1;
    else if (c === 9) col += 4 - (col % 4);
    else return false;
  }
  return true;
}

/** Folds the job's answer for `win` into confirmed blocks in offsets of `text`: the answer's lines (the window's own, one more
 *  than the text's for a `shifted` one) become offsets, and every block but the last is confirmed unless the window reached the
 *  text's end: the last may run past the window, or be cut short by it. A window that ends inside a block comment confirms only
 *  the blocks before the block that holds the comment's opening line, and the next window starts at that block (`openComment`). */
export function foldBlockWindow(text: string, win: BlockWindow, blocks: readonly MdBlock[], probe?: Probe): FoldedBlocks {
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
  const open = openComment(slice, win.from, all, probe);
  if (open >= 0) {
    const holding = all.find((b) => b.start <= open && open < b.end);
    // The next window never starts at an opener's line indented four columns or more: read from there it would be code, and the
    // comment's inner lines blocks. Such a line is a later line of a footnote definition, which may lie in no block (a definition
    // no reference in the window names draws none) or begin the block that holds it (a named one whose first drawn line it is).
    // Then the window is capped at the start of the last block before the opener; else at the block that holds it, as before (wave
    // 64, fix round 1, review 4221 F1). A top-level comment's own line is read the same from there, so its window still ends at it.
    // A named definition's block may also start at an EARLIER indented line (its first line draws no block, content indented under
    // it comes first): that start is the known leak the header records (ticket `x2-fu-footnote-item-block-start`), a cut candidate
    // in the whole read too, so its cure is the block's start, not this cap.
    const before = (): number => all.reduce((s, b) => (b.start < open && b.start > s ? b.start : s), win.from);
    const cap = holding !== undefined && (holding.start < open || !indentedFour(text, open)) ? holding.start : before();
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
interface Unit {
  readonly start: number; readonly end: number; readonly block: TextBlock | undefined; readonly heading: boolean; readonly raw: boolean; readonly comment?: boolean;
  /** Where the unread tail starts inside this unit: the blocks stopped at a block that starts with dashes, where no part starts, so
   *  no `raw` candidate was made there and the unit runs on to the text's end (wave 64). */
  readonly rawFrom?: number;
}

/** Where the rest of a unit starts after a fence in a list item (`fenceStep`), and the UTF-8 bytes from there to the unit's end. */
interface FenceRest { readonly at: number; readonly bytes: number }

/** The lines a part that ends inside a comment closes it with, and the next one reopens it with (a newline first when the part ends
 *  in the middle of a line), as a fence's close and reopen lines are. */
const COMMENT_OPEN = '<!--\n';
const COMMENT_CLOSE = '-->\n';
const COMMENT_CLOSE_MID = '\n-->\n';

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

  /** Whether `text.slice(a, b)` holds a comment opener, `<!--` (the conservative rule, wave 64). It reads the text, not the parse: an
   *  opener in code counts too. A slice of the unit, so a unit is read once at each level it is cut at. */
  private holdsOpener(a: number, b: number): boolean {
    const e = Math.min(b, this.ruleEnd);
    if (this.probe !== undefined) this.probe.chars += Math.max(0, e - a);
    return e - a >= 4 && this.text.slice(a, e).includes('<!--');
  }

  /** The offset past which `holdsOpener` reads nothing: the unread tail's start while a unit that runs into it is cut (`cutUnit`). */
  private ruleEnd = Number.POSITIVE_INFINITY;

  /** `[from, to)` as one part, whatever its size: a unit the conservative rule keeps whole. */
  private whole(from: number, to: number, continued: boolean): MdPart[] {
    return [{ start: from, end: to, continued, reopen: null, close: null }];
  }

  /** P1's cut of `[from, to)` (as `p1`), unless the text holds a comment opener: then `[from, to)` whole (the conservative rule). */
  private p1OrWhole(from: number, to: number, continued: boolean): MdPart[] {
    return this.holdsOpener(from, to) ? this.whole(from, to, continued) : this.p1(from, to, continued, false);
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

  /** The parts of one unit that alone is larger than a part: by its block's own rules (a comment unit as a fence is cut), else P1 on
   *  the unit's slice. A unit whose text holds a comment opener is never cut inside, except a comment unit by `cutComment`: it is one
   *  part (the conservative rule, wave 64). The unread tail (`raw`) is P1's, as it was. A unit that runs into the unread tail
   *  (`rawFrom`) is read by the rule only up to the tail: when that much holds an opener it is cut there as a unit of its own and the
   *  tail is P1's, its first part beginning with a blank line (it starts at dashes, which a part would read as front matter); else the
   *  unit is cut exactly as before, the rule reading nothing of the tail. */
  cutUnit(u: Unit, continued: boolean): MdPart[] {
    if (u.rawFrom !== undefined) {
      if (this.holdsOpener(u.start, u.rawFrom)) {
        // The known part is a unit of its own, cut by the rule as any is (its block ends at or before the tail: the window that
        // confirmed it holds both ends); the tail is P1's.
        const known = this.bytes(u.start, u.rawFrom) <= this.max ? this.whole(u.start, u.rawFrom, continued) : this.cutKnown({ ...u, end: u.rawFrom }, continued);
        const tail = new BlockCutter(this.text, this.max - 1, this.probe).p1(u.rawFrom, u.end, true, true);
        tail[0] = { ...tail[0]!, reopen: '\n' + (tail[0]!.reopen ?? '') };
        return [...known, ...tail];
      }
      const saved = this.ruleEnd;
      this.ruleEnd = u.rawFrom;
      try {
        return this.cutKnown(u, continued);
      } finally {
        this.ruleEnd = saved;
      }
    }
    return this.cutKnown(u, continued);
  }

  /** `cutUnit` of a unit as its blocks say, `rawFrom` aside. */
  private cutKnown(u: Unit, continued: boolean): MdPart[] {
    if (u.comment === true) return this.cutComment(u.start, u.end, continued) ?? this.whole(u.start, u.end, continued);
    if (u.block === undefined) return u.raw ? this.p1(u.start, u.end, continued, true) : this.p1OrWhole(u.start, u.end, continued);
    return this.cutBlock(u.block, u.start, u.end, continued, false) ?? this.p1OrWhole(u.start, u.end, continued);
  }

  /** The parts of `[from, to)`, a block and the text after it up to the next one, cut at the block's own seams; null when it has
   *  none to cut at (the caller falls back to P1, or keeps the unit whole when it holds an opener): a list or quote with two or more items at the items' starts, a fence
   *  closed and reopened (the unit's block, or one a list item or a one-item quote holds). `item`: the block is a list item, which
   *  is always cut (a fence it holds closed and reopened, else P1 with the item's marker reopening each part that starts inside it).
   *  A list item, or a fence, whose `[from, to)` holds a comment opener is one part instead (the conservative rule, wave 64); a list
   *  or a quote is still cut between its items, each item then read by the same rule. */
  private cutBlock(blk: TextBlock, from: number, to: number, continued: boolean, item: boolean): MdPart[] | null {
    const items = blk.items ?? [];
    if ((item || blk.kind === 'fence') && this.holdsOpener(from, to)) return this.whole(from, to, continued);
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
    return this.greedy(units, false, continued, (u, cont) => this.cutBlock(u.block!, u.start, u.end, cont, asItems) ?? this.p1OrWhole(u.start, u.end, cont));
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

  /** Whether the text at `off` is spaces or tabs and then three backticks or three tildes. */
  private startsWithFence(off: number): boolean {
    let i = off;
    while (this.text.charCodeAt(i) === 32 || this.text.charCodeAt(i) === 9) i += 1;
    if (this.probe !== undefined) this.probe.chars += i - off + 1;
    return this.text.startsWith('```', i) || this.text.startsWith('~~~', i);
  }

  /** The parts of `[from, to)` around the fence `F`: what comes before it in its container (a list item's marker line and text),
   *  the fence cut at content line ends, each part that ends inside it closed with a line of its own and the next one reopened,
   *  and what follows it. `li` is the list item that holds it (null: it is the unit's block, or a quote's). `startReopen`: what the
   *  first part begins with when `from` is inside the item, after its first line. What follows the fence is one part with it when
   *  that fits, else the item's next fence cut the same way, or P1 inside the item. Null when the lines that close and reopen do not
   *  fit (a window of a few dozen bytes), or the fence's opener is not read as a fence line.
   *
   *  The walk over an item's fences is a LOOP (X2 P6.1 review F2): each step (`fenceStep`) answers the parts up to what follows its
   *  fence and where the rest starts, and the loop takes the item's next fence from there. It was a recursion through `cutFence` and
   *  a `cutRest` once per fence, whose depth grew with the text: an item of 30 000 fences overflowed the stack. The item's fences are
   *  walked with one moving index (the next fence is never searched from the item's start), and the bytes of what is left are carried
   *  from step to step (`FenceRest.bytes`), so the walk is linear in the unit whatever the number of fences. */
  private cutFence(F: TextBlock, from: number, to: number, continued: boolean, li: TextBlock | null, startReopen: string | null): MdPart[] | null {
    const first = this.fenceStep(F, from, to, continued, li, startReopen, null);
    if (first === null) return null;
    const parts = first.parts;
    let rest = first.rest;
    const items = li === null ? [] : li.items ?? [];
    let ix = 0;
    while (rest !== null) {
      const { at, bytes } = rest;
      if (li === null) {
        for (const p of this.p1(at, to, true, false)) parts.push(p);
        break;
      }
      // What follows a fence in its list item: the item's next fence, cut as a fence with the item's marker alone ahead of it, else
      // P1 inside the item.
      while (ix < items.length && !(items[ix]!.kind === 'fence' && items[ix]!.start >= at)) {
        ix += 1;
        if (this.probe !== undefined) this.probe.chars += 1;
      }
      const next = items[ix];
      const step = next === undefined ? null : this.fenceStep(next, at, to, true, li, this.markerOf(li), bytes);
      if (step === null) {
        for (const p of this.p1InItem(at, to, true, li, true)) parts.push(p);
        break;
      }
      for (const p of step.parts) parts.push(p);
      rest = step.rest;
    }
    return parts;
  }

  /** One step of `cutFence`: the parts of `[from, to)` up to what follows the fence `F`, and `rest`, where what follows starts (null:
   *  the part with the fence took everything to `to`). `known`: the UTF-8 bytes of `[from, to)` when the caller has them (the walk
   *  carries them), else they are measured. */
  private fenceStep(F: TextBlock, from: number, to: number, continued: boolean, li: TextBlock | null, startReopen: string | null, known: number | null): { parts: MdPart[]; rest: FenceRest | null } | null {
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
        while (e > pos && this.startsWithFence(e)) {
          // Inside a run of white space before the marker every cut is as bad: jump to the run's start (one walk back over it, so
          // a long run is not scanned forward once per step), then step back past the character before it.
          let s = e;
          while (s > pos && (text.charCodeAt(s - 1) === 32 || text.charCodeAt(s - 1) === 9)) s -= 1;
          if (this.probe !== undefined) this.probe.chars += e - s;
          e = s < e ? s : e - (e - 2 >= pos && isLowSurrogate(text.charCodeAt(e - 1)) && isHighSurrogate(text.charCodeAt(e - 2)) ? 2 : 1);
        }
        if (e <= pos) return null;
        push(e, '\n' + closeLine);
        restart(e, true);
        pos = e;
      }
    }
    // What follows the fence, in bytes: measured, or (in a walk's later steps) what the walk carries less the fence's own text.
    const after = known === null ? this.bytes(fenceEnd, to) : known - this.bytes(from, fenceEnd);
    let rest: FenceRest | null = null;
    if (used + after <= budget) push(to, null);
    else {
      // This part also takes the blank lines right after the fence that fit: the rest starts with the item's marker alone, and
      // a blank line right after it would end the item (an empty item holds at most one) and turn its indented text into code.
      let cutAt = fenceEnd;
      let blank = 0;
      while (cutAt < to) {
        const le = this.lineEnd(cutAt);
        if (text.slice(cutAt, le).trim() !== '') break;
        const lb = this.bytes(cutAt, le);
        if (used + lb > budget) break;
        used += lb;
        blank += lb;
        cutAt = le;
      }
      push(cutAt, null);
      if (cutAt < to) rest = { at: cutAt, bytes: after - blank };
    }
    return { parts, rest };
  }

  /** The closed comments (`<!-- ... -->`) of a gap of the top level, `[from, to)`: the text between two blocks, before the first or
   *  after the last, which the library draws no block for (X2 P6.1 review F3). Each answers where its opener line starts and where the
   *  line after its closer line starts. A comment is a line that starts, after at most three spaces, with `<!--`, whose first `-->`
   *  (from the opener on, as the library reads it: `<!-->` closes itself) is in the gap and is followed on its line by white space
   *  only (text after it makes the line a paragraph, which is a block and no gap text); an opener with no `-->` in the gap is text. A
   *  gap lies outside every block, so no line of it is code. One slice of the gap and forward searches only: linear in the gap, and a
   *  gap with no room for a comment (under five characters) is not read. */
  gapComments(from: number, to: number): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    if (to - from < 5) return out;
    const g = this.text.slice(from, to);
    if (this.probe !== undefined) this.probe.chars += g.length;
    let i = g.indexOf('<!--');
    while (i !== -1) {
      let s = i;
      while (s > 0 && i - s < 3 && g.charCodeAt(s - 1) === 32) s -= 1;
      const before = s === 0 ? 10 : g.charCodeAt(s - 1);
      if (before !== 10 && before !== 13) { i = g.indexOf('<!--', i + 1); continue; }
      const p = g.indexOf('-->', i);
      if (p === -1) break; // no closer in the gap: this opener and every later one is text
      // The end of the closer's line and where its terminator starts.
      let stop = p;
      while (stop < g.length && g.charCodeAt(stop) !== 10 && g.charCodeAt(stop) !== 13) stop += 1;
      const end = stop >= g.length ? g.length : stop + (g.charCodeAt(stop) === 13 && g.charCodeAt(stop + 1) === 10 ? 2 : 1);
      if (g.slice(p + 3, stop).trim() === '') out.push({ start: from + s, end: from + end });
      i = g.indexOf('<!--', end);
    }
    return out;
  }

  /** The end of a closed top-level comment that starts at `off` (a line start): its opener line (up to three spaces, then `<!--`)
   *  through the line that holds its first `-->`, with only white space after it there (`gapComments`' rule, read from the text alone,
   *  as the library reads a block comment); null when the text at `off` is no such comment. For the unread tail (wave 64, item 2): the
   *  blocks read stops at a comment longer than its cap, which `openComment` grew the window for. Linear in the comment. */
  commentAt(off: number): number | null {
    const t = this.text;
    let o = off;
    while (o - off < 3 && t.charCodeAt(o) === 32) o += 1;
    if (!t.startsWith('<!--', o)) return null;
    const p = t.indexOf('-->', o);
    if (this.probe !== undefined) this.probe.chars += (p < 0 ? t.length : p) - off;
    if (p < 0) return null;
    let stop = p + 3;
    while (stop < t.length && t.charCodeAt(stop) !== 10 && t.charCodeAt(stop) !== 13) stop += 1;
    if (t.slice(p + 3, stop).trim() !== '') return null;
    const end = stop >= t.length ? t.length : stop + (t.charCodeAt(stop) === 13 && t.charCodeAt(stop + 1) === 10 ? 2 : 1);
    // A closer line that does not fit a part beside the reopen line is one `cutComment` cannot cut: such a comment would be one part
    // as long as itself, past a window, so it is left to the unread tail (P1), as before. Measured as `cutComment` measures it, from
    // the closer to its line's end, the terminator counted (review 4221 A4: it counted a byte past the line, or two past the text).
    if (COMMENT_OPEN.length + this.bytesWithin(p, end, this.max) > this.max) return null;
    return end;
  }

  /** The parts of the comment unit `[from, to)`: a closed comment that alone is larger than a part, cut as a fence is (X2 P6.1 review
   *  F3). It starts at the opener line, and ends after the line that holds its first `-->`; what is left of the unit after that line
   *  goes in its last part (below). Each part that ends inside the comment ends with `-->` on a line of its own (a newline first when the part ends in the
   *  middle of a line) and the next begins with `<!--` on a line of its own, so no part holds commented text outside a comment. The
   *  cuts are at line ends, a line too long for a part at a code point boundary (never between a surrogate pair); never inside the
   *  opener (the first part holds `<!--` whole) and never after the first `-->` begins (the part with the closer takes it, and what
   *  follows it on its line, whole). Sizes count the added lines. What the unit holds after the closer's line (it runs on when the
   *  line after the comment is dashes, where no part starts) goes in the last part, as what follows a fence does, the closer in a
   *  part of its own when the open one has no room; never in a part of its own, which may start at dashes (front matter). Null when
   *  it does not fit even so, when the close and reopen lines do not fit (a window of a few dozen bytes), or when the closer's line is
   *  more than a part (white space after it): the caller keeps the unit whole (the conservative rule, wave 64; until then P1 cut it). */
  private cutComment(from: number, to: number, continued: boolean): MdPart[] | null {
    const text = this.text;
    const max = this.max;
    let o = from;
    while (text.charCodeAt(o) === 32) o += 1;
    if (!text.startsWith('<!--', o)) return null;
    const lo = o + 4; // the first part ends at or after this offset: it holds the opener
    const p = text.indexOf('-->', o);
    if (this.probe !== undefined) this.probe.chars += (p < 0 ? text.length : p) - o;
    if (p < lo || p + 3 > to) return null; // no closer, or `<!-->` (a comment that closes on its opener)
    const end = Math.min(this.lineEnd(p), to);
    const finalBytes = this.bytes(p, end); // the closer and the rest of its line: always in the last part, whole
    if (COMMENT_OPEN.length + finalBytes > max) return null;
    const parts: MdPart[] = [];
    let cur = from;
    let reopen: string | null = null;
    let budget = max;
    let used = 0;
    let flag = continued;
    const push = (e: number, close: string | null): void => {
      parts.push({ start: cur, end: e, continued: flag, reopen, close });
      flag = true;
    };
    const restart = (at: number): void => {
      cur = at;
      reopen = COMMENT_OPEN;
      budget = max - COMMENT_OPEN.length;
      used = 0;
    };
    let pos = from;
    while (pos < p) {
      const next = this.lineEnd(pos);
      const le = Math.min(next, p);
      const closer = next > p; // this line holds the closer: the part that takes its end takes the closer too
      for (;;) {
        const room = budget - used - (closer ? finalBytes : COMMENT_CLOSE.length);
        const lb = room < 0 ? 1 : this.bytesWithin(pos, le, room);
        if (lb <= room) { used += lb; pos = le; break; }
        if (pos > cur) {
          // The line does not fit what is left: this part ends before it, with its close line, and the next reopens the comment.
          push(pos, COMMENT_CLOSE);
          restart(pos);
          continue;
        }
        // Not even alone in a part of its own: cut the line at a code point boundary.
        const avail = budget - used - COMMENT_CLOSE_MID.length;
        if (avail < 1) return null;
        const cp = codePointCut(text, pos, le, avail);
        if (this.probe !== undefined) this.probe.chars += cp.off - pos;
        if (cp.bytes > avail || cp.off < lo) return null;
        push(cp.off, COMMENT_CLOSE_MID);
        restart(cp.off);
        pos = cp.off;
      }
    }
    // `pos` is `p`: the closer and the rest of its line go in the part that is open, or in a part of their own.
    if (used + finalBytes > budget) {
      push(pos, COMMENT_CLOSE);
      restart(pos);
    }
    // What the unit holds after the closer's line (the lines before the next block: the unit runs on when the line after the comment
    // is dashes, where no part starts). It goes in the last part, as what follows a fence does (`fenceStep`), never in a part of its
    // own: such a part may start at dashes, which the library reads as front matter (both rules of `---\n---\n` vanish), and P1, which
    // cut it until wave 64, may start a later part there too (measured: the shown line of `--- SHOWNW ---` lost at 129 to 140 bytes).
    // The closer takes a part of its own when the open one has no room for it; when not even that part holds it, the unit is kept
    // whole (null: the conservative rule).
    if (end < to) {
      const fits = (): boolean => {
        const room = budget - used - finalBytes;
        return room >= 0 && this.bytesWithin(end, to, room) <= room;
      };
      if (!fits()) {
        push(pos, COMMENT_CLOSE);
        restart(pos);
        if (!fits()) return null;
      }
    }
    push(to, null);
    return parts;
  }

}

function isHighSurrogate(c: number): boolean { return c >= 0xd800 && c <= 0xdbff; }
function isLowSurrogate(c: number): boolean { return c >= 0xdc00 && c <= 0xdfff; }

/** A cut candidate of the top-level greedy: a block start (the first, offset 0, has no block when the text begins with lines the
 *  library draws no block for), the start of a closed comment's opener line, or of the line after a comment's closer line (neither
 *  has a block: X2 P6.1 review F3), or the unread tail (`raw`). `comment` is set on the opener's: the offset after the closer's line.
 *  A unit is from one candidate to the next. */
interface Cand { readonly start: number; readonly block: TextBlock | undefined; readonly raw: boolean; readonly comment?: number }

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
  private gapFrom = 0; // the offset up to which the gaps between blocks have been read for comments
  private rawAt: number | null = null; // the unread tail's start when it starts at dashes, where no candidate is made
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
      this.gap(b.start); // the comments between the last block and this one
      this.gapFrom = Math.max(this.gapFrom, b.end);
      if (b.start <= this.cand[this.cand.length - 1]!.start) continue;
      if (this.text.startsWith('---', b.start)) continue; // a part that began at dashes would read front matter
      this.cand.push({ start: b.start, block: b, raw: false });
    }
    this.gap(frontier); // and the ones after the last block, up to where the blocks are known
    this.gapFrom = Math.max(this.gapFrom, frontier);
    this.known = Math.max(this.known, frontier);
    return this.step(false);
  }

  /** Reads the gap from `gapFrom` to `to` for closed comments, each a cut candidate at its opener line's start and one at the start
   *  of the line after its closer line (when that is before `to`, and does not start with dashes, which a part would read as front
   *  matter). The library draws no block for a closed comment, so before this a comment was a part of the block before it, and a unit
   *  too large for a part was cut by the line cutter inside the comment (X2 P6.1 review F3). A comment that starts where the last
   *  candidate does (the text's start, or the line after another comment) makes that candidate its opener's. */
  private gap(to: number): void {
    for (const c of this.cutter.gapComments(this.gapFrom, to)) {
      const last = this.cand[this.cand.length - 1]!;
      if (c.start < last.start) continue;
      if (c.start === last.start) this.cand[this.cand.length - 1] = { ...last, comment: c.end };
      else this.cand.push({ start: c.start, block: undefined, raw: false, comment: c.end });
      if (c.end < to && !this.text.startsWith('---', c.end)) this.cand.push({ start: c.end, block: undefined, raw: false });
    }
  }

  /** The end of the blocks: `tailFrom` is the offset from which they are unknown (null: the whole text is covered). Answers the
   *  parts not yet final, the unread tail cut by `splitMarkdownParts`. */
  finish(tailFrom: number | null): MdPart[] {
    this.begin([]);
    const text = this.text;
    if (this.emitted === 0) {
      if (utf8Bytes(text) <= this.max) return [{ start: 0, end: text.length, continued: false, reopen: null, close: null }];
      if (tailFrom === 0 && this.cutter.commentAt(0) === null) return splitMarkdownParts(text, this.max, this.probe).parts;
    }
    this.gap(tailFrom ?? text.length);
    this.gapFrom = Math.max(this.gapFrom, tailFrom ?? text.length);
    const last = this.cand[this.cand.length - 1]!;
    // A tail that starts at a closed top-level comment (the blocks read stopped at a comment longer than its cap) is a comment unit,
    // closed and reopened; the unread tail starts after it (wave 64, item 2).
    const closed = tailFrom !== null && tailFrom >= last.start ? this.cutter.commentAt(tailFrom) : null;
    if (closed !== null && tailFrom === last.start) this.cand[this.cand.length - 1] = { ...last, comment: closed };
    else if (closed !== null) this.cand.push({ start: tailFrom!, block: undefined, raw: false, comment: closed });
    const raw = closed ?? tailFrom;
    if (raw !== null && raw > last.start && raw < text.length) {
      // No part starts at dashes, so a tail that does has no candidate: the last unit runs on into it, and says where it starts.
      if (!text.startsWith('---', raw)) this.cand.push({ start: raw, block: undefined, raw: true });
      else this.rawAt = raw;
    }
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
    const lastFinal = final && i + 1 >= this.cand.length;
    return {
      start: c.start, end: i + 1 < this.cand.length ? this.cand[i + 1]!.start : final ? this.text.length : this.known, block: c.block,
      heading: c.block?.kind === 'heading', raw: c.raw, ...(c.comment === undefined ? {} : { comment: true }),
      ...(lastFinal && this.rawAt !== null && this.rawAt > c.start ? { rawFrom: this.rawAt } : {}),
    };
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
 *  greedy from offset 0, a part ends only at a block start or at the edge of a closed top-level comment (never at offset 0, and
 *  never before a block whose first line is dashes, which a part would read as front matter), at the LATEST heading block start
 *  that fits, else the latest block start or comment edge that fits.
 *  When no block start fits, the unit up to the next block start (or `tailFrom`, or the end) is cut by its block: a list or quote
 *  of two or more items between its items; a fence closed and reopened with its container's prefix (the first fence an item or a
 *  quote holds too); anything else, and a window too small for those, by `splitMarkdownParts` on the unit's slice. From `tailFrom`
 *  (the offset from which the blocks are unknown) the rest is `splitMarkdownParts`'s. `probe` is as for `splitMarkdownParts`.
 *  One shot: `MarkdownCutter` fed all the blocks at once. */
export function splitMarkdownPartsAt(text: string, maxBytes: number, blocks: readonly TextBlock[], tailFrom: number | null, probe?: Probe): { parts: MdPart[] } {
  if (probe !== undefined) probe.chars += text.length;
  if (utf8Bytes(text) <= maxBytes) return { parts: [{ start: 0, end: text.length, continued: false, reopen: null, close: null }] };
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
  /** Told, once, the whole cut of the line cutter when the block cutter itself threw (X2 P6.1 review F2): the parts handed to
   *  `onParts` before are void, and the answer is this cut. Never told for a block read the worker could not answer (that is the
   *  line cutter's tail) or for an abort. */
  readonly onFallback?: (parts: MdPart[]) => void;
}

/** The whole cut of a Markdown text, as delivery drives it: the render job is asked for the blocks window by window (each under
 *  its parse budget), a `blocks` answer is the window's blocks and anything else, or a throw, ends the blocks there, and the
 *  `MarkdownCutter` answers parts as they become final (`onParts`); what the blocks do not cover is the line cutter's. Answers
 *  every part. An abort rejects with the signal's reason. A throw out of the cutter itself (a feed, or `finish`) that is not an
 *  abort is not a part of the cut to trust: the answer is then `splitMarkdownParts` of the WHOLE text, told to `onFallback` first, so
 *  the page can drop what it was shown from the failed cutter and take this cut from its first part. */
export async function cutMarkdownText(text: string, job: BlocksJob, signal: AbortSignal, opts: CutOptions = {}): Promise<MdPart[]> {
  const max = opts.maxBytes ?? DOCS_RENDER_GATE_BYTES;
  const cutter = new MarkdownCutter(text, max);
  const all: MdPart[] = [];
  const fallback = (): MdPart[] => {
    const whole = splitMarkdownParts(text, max).parts;
    opts.onFallback?.(whole);
    return whole;
  };
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
  let cutterThrew = false;
  try {
    const got = await collectMdBlocks(text, ask, signal, {
      ...(opts.windowBytes === undefined ? {} : { windowBytes: opts.windowBytes }),
      ...(opts.onProgress === undefined ? {} : { onProgress: opts.onProgress }),
      onBlocks: (blocks, frontier) => {
        let ready: MdPart[];
        try {
          ready = cutter.feed(blocks, frontier);
        } catch (e) {
          cutterThrew = true;
          throw e;
        }
        emit(ready);
      },
    });
    tailFrom = got.tailFrom;
  } catch {
    if (signal.aborted) throw signal.reason; // the abort's, whatever the cutter or the read threw as it went
    if (cutterThrew) return fallback();
    tailFrom = cutter.covered;
  }
  let rest: MdPart[];
  try {
    rest = cutter.finish(tailFrom);
  } catch {
    if (signal.aborted) throw signal.reason;
    return fallback();
  }
  emit(rest);
  return all;
}
