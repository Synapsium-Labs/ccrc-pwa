// Changes since on the current part of a Markdown text read in parts (X2 P6.1 Step 0c (b); native Docs reader spec 4.3,
// "Markdown in parts": Export and Changes since act on the whole text when the file was read whole, up to 2 MiB, and above 2 MiB
// on the current part, and say so). Ring L1 policy: a pure function of two texts and one part, no I/O, no DOM, no timer, no
// React; it imports only the line diff (`diff.ts`), the part cutter's `partText` and the part's type.
//
// `partChangeTexts(before, afterWhole, part, rendered)` answers the frame's marks (`ranges`, `removedAfter`, in the numbering of
// the part's rendered `data-line`) for ONE part, or `null` for unavailable. The frame renders `rendered`, which is
// `partText(afterWhole, part)`: a reopen line, the part's slice of the whole text, a close line. The marks are keyed to those
// bytes, so any other `rendered` is not this part's and answers `null`, as `readerChangesTexts` refuses a head that is not the
// rendered text.
//
// Two forms, by how the head was read (spec 4.3):
// - A head of at most `DOCS_MAX_DOC_BYTES` was read whole: the whole diff, `readerDiff(before, afterWhole)`, its ranges and
//   removals clipped to the part's lines and shifted into the rendered text's lines. That is spec 4.3's "act on the whole text
//   when read whole", and the whole diff's own refusal stands: `bytes` (a base above 2 MiB), `lines` (the 20 000-line cap),
//   `work` and `output` all answer `null`, as a body not in parts does.
// - A head above `DOCS_MAX_DOC_BYTES` was read by range (up to 64 MiB): the part's own region. The two texts are aligned by their
//   common prefix and common suffix, found by a linear scan over the strings themselves (no array of lines, so a 64 MiB text
//   costs no memory beyond the text) and cut back to whole lines, and the part's slice of the whole text is diffed against the
//   slice of the base the alignment maps it to. A part wholly inside the unchanged prefix or suffix has no marks and no diff.
//   A part's start inside the changed middle maps to the middle's start in the base, and a part's end inside it to the middle's
//   end, so a changed middle bigger than the diff's bounds answers `null`: never a partial answer.
//
// Where a removal belongs. The whole form marks a removal after the line before the gap, so the part that holds that line owns it
// (and the first part owns one before its first line). The region form keeps that rule at the point where the texts first differ
// (`head`): a part that ends exactly there owns the removal there, after its last line (decided on the changed middle's own diff,
// so a pure deletion always has one), a part that starts there does not, and the first part owns one at the top of the text.
//
// What the region form cannot tell, stated: a change that straddles a part's edge may mark lines at that edge that the part beside
// it also shows, and a part that begins inside a changed middle, or ends inside it, is compared with the whole of the base's middle,
// so it can mark a removal at its edge (`removedAfter` 0, or its last line) that belongs to the change above or below it.
import { DOCS_MAX_DOC_BYTES } from '../../../../shared/docs';
import { utf8Bytes } from '../../../../shared/utf8';
import { partText, type MdPart } from '../range/mdParts';
import { readerDiff } from './diff';

/** The marks of the changes since a base, in the frame's shape (`readerHistory.ts`'s `ReaderChangeMarks` is this shape). */
export interface PartChangeMarks {
  readonly ranges: readonly (readonly [number, number])[];
  readonly removedAfter: readonly number[];
}

const NO_MARKS: PartChangeMarks = { ranges: [], removedAfter: [] };
const LF = 10;
const CR = 13;

/** The line endings (`\r\n`, a lone `\r`, `\n`: the Markdown parser's line model) of `t` between `from` and `to`. */
function endings(t: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i += 1) {
    const c = t.charCodeAt(i);
    if (c === LF) n += 1;
    else if (c === CR && !(i + 1 < to && t.charCodeAt(i + 1) === LF)) n += 1;
  }
  return n;
}

/** Whether `t` has a line start at `i`: the start of the text, or right after a line ending that is whole. */
function lineStartAt(t: string, i: number): boolean {
  if (i === 0) return true;
  const c = t.charCodeAt(i - 1);
  return c === LF || (c === CR && t.charCodeAt(i) !== LF);
}

/** Where a part's lines sit: `first`, the whole text's line the part's slice starts on (1-based); `count`, the lines its slice
 *  holds; `shift`, the lines its reopen text adds before the slice (a reopened fence's opening line is the rendered text's first). */
interface Geometry { readonly first: number; readonly count: number; readonly shift: number }

function geometry(whole: string, part: MdPart): Geometry {
  const { start, end } = part;
  const closed = end > start && (whole.charCodeAt(end - 1) === LF || whole.charCodeAt(end - 1) === CR);
  const count = endings(whole, start, end) + (end > start && !closed ? 1 : 0);
  const reopen = part.reopen ?? '';
  return { first: 1 + endings(whole, 0, start), count, shift: endings(reopen, 0, reopen.length) };
}

/** The whole diff's marks that fall in the part, in the rendered text's lines. A removal after a line the part holds is the
 *  part's; one after the line before its first is the previous part's (the first part owns a removal before its first line). */
function clip(d: { ranges: readonly (readonly [number, number])[]; removedAfter: readonly number[] }, g: Geometry): PartChangeMarks {
  const last = g.first + g.count - 1;
  const at = (n: number): number => n - g.first + 1 + g.shift;
  const ranges: (readonly [number, number])[] = [];
  for (const [a, b] of d.ranges) {
    const lo = Math.max(a, g.first);
    const hi = Math.min(b, last);
    if (lo <= hi) ranges.push([at(lo), at(hi)]);
  }
  const removedAfter = d.removedAfter.filter((r) => (r >= g.first && r <= last) || (r === 0 && g.first === 1)).map(at);
  return { ranges, removedAfter };
}

/** The common prefix of two texts, cut back to a whole line in both, as an offset (the same in both). */
function commonHead(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let p = 0;
  while (p < limit && before.charCodeAt(p) === after.charCodeAt(p)) p += 1;
  // A prefix that ends right after a `\r` may split a `\r\n` in one of the texts: step back over it.
  if (p > 0 && after.charCodeAt(p - 1) === CR) p -= 1;
  while (p > 0) {
    const c = after.charCodeAt(p - 1);
    if (c === LF || (c === CR && after.charCodeAt(p) !== LF)) break;
    p -= 1;
  }
  return p;
}

/** The common suffix of two texts past `head`, as a length, cut forward to a line start in both texts. */
function commonTail(before: string, after: string, head: number): number {
  const room = Math.min(before.length, after.length) - head;
  let s = 0;
  while (s < room && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s += 1;
  while (s > 0 && !(lineStartAt(after, after.length - s) && lineStartAt(before, before.length - s))) s -= 1;
  return s;
}

/** Whether the whole diff has a removal at the point where the texts first differ (`head`, after the line before the changed
 *  middle): the base's middle is not empty, and either the head's middle is empty (a pure deletion) or the middle's own diff
 *  removes before its first line. A middle past the diff's bounds is not a removal this part can mark. */
function removalAtHead(before: string, after: string, head: number, beforeTail: number, afterTail: number): boolean {
  if (beforeTail <= head) return false;
  if (afterTail <= head) return true;
  const d = readerDiff(before.slice(head, beforeTail), after.slice(head, afterTail));
  return d.kind === 'available' && d.removedAfter.includes(0);
}

/** The part's own region: the part's slice of `after` against the slice of `before` the common head and tail map it to. */
function regionMarks(before: string, after: string, part: MdPart, g: Geometry): PartChangeMarks | null {
  const { start, end } = part;
  const head = commonHead(before, after);
  const tail = commonTail(before, after, head);
  const afterTail = after.length - tail;
  const beforeTail = before.length - tail;
  // Wholly in the unchanged prefix: no marks, except that a part ending exactly at the first difference owns the removal there.
  if (end <= head) {
    return end === head && head > 0 && removalAtHead(before, after, head, beforeTail, afterTail)
      ? { ranges: [], removedAfter: [g.count + g.shift] }
      : NO_MARKS;
  }
  // Wholly in the unchanged suffix: no marks. A part that starts at 0 is not: a removal at the top of the text is the first part's.
  if (start >= afterTail && start > 0) return NO_MARKS;
  const from = start <= head ? start : head;
  const to = end >= afterTail ? end - after.length + before.length : beforeTail;
  const d = readerDiff(before.slice(from, to), after.slice(start, end));
  if (d.kind !== 'available') return null;
  // A part that starts at the first difference does not own the removal before its first line: the part before it does.
  const own = start === head && head > 0 ? d.removedAfter.filter((r) => r !== 0) : d.removedAfter;
  return {
    ranges: d.ranges.map(([a, b]) => [a + g.shift, b + g.shift] as const),
    removedAfter: own.map((r) => r + g.shift),
  };
}

/** Whether `s` is above the documents' byte cap, without walking a text that is over it by its length alone. */
const overDocument = (s: string): boolean => s.length > DOCS_MAX_DOC_BYTES || utf8Bytes(s) > DOCS_MAX_DOC_BYTES;

/** The marks of the changes since `before` for the part `part` of `afterWhole`, whose rendered text is `rendered`; `null` when
 *  `rendered` is not this part's or when the diff that the form needs is past its bounds. */
export function partChangeTexts(before: string, afterWhole: string, part: MdPart, rendered: string): PartChangeMarks | null {
  if (rendered !== partText(afterWhole, part)) return null;
  const g = geometry(afterWhole, part);
  if (overDocument(afterWhole)) return regionMarks(before, afterWhole, part, g);
  const whole = readerDiff(before, afterWhole);
  return whole.kind === 'available' ? clip(whole, g) : null;
}
