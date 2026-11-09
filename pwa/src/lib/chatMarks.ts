// The chat recogniser table (chat reading at a desk, Task M, D-8060; spec 2026-11-06 sections 3.1, 3.3 and 4.1): the
// one place that says which words in the assistant's prose are names of objects, which are status words in a label
// position, and which bold openings are lead-ins. Each list is written once here; `remarkChatMarks` (the plugin in
// chat's two plugin lists) and `linkify` (Task L, the operator's own text) both read it.
//
// L1 and context-free: no React, no DOM, no store, and it imports nothing, because the parse worker loads it
// (`markdown-purity.test.ts` holds the closure). It recognises only. Which address a mark resolves to, and whether a
// small id the console does not hold stays text, is `chatRefs.ts`'s `refHref` (Task L), asked at render time.

/** The kinds of object a name in chat can point at. */
export type MarkKind = 'pr' | 'run' | 'item' | 'doc' | 'commit';
const MARK_KINDS: readonly MarkKind[] = ['pr', 'run', 'item', 'doc', 'commit'];

/** One recognised name. `id` is the digits, the path or the SHA; `text` is the name as written (`run 1527`). */
export interface Mark {
  readonly kind: MarkKind;
  readonly id: string;
  readonly text: string;
}

export function isMarkKind(s: string): s is MarkKind {
  return (MARK_KINDS as readonly string[]).includes(s);
}

/** The four tones of a status label, each one of the callouts' pairs (spec 3.1's table). */
export type StatusTone = 'ok' | 'merged' | 'wait' | 'fail';

/** The status words, by tone. Matched case-insensitively, as a whole word. */
export const STATUS_WORDS: Readonly<Record<StatusTone, readonly string[]>> = {
  ok: ['passed', 'green', 'accepted', 'approved', 'done'],
  merged: ['merged', 'landed'],
  wait: ['blocked', 'waiting', 'held', 'pending', 'stalled'],
  fail: ['failed', 'red', 'refused', 'rejected', 'broken'],
};

/** The words after which a status word is a label (S3), besides a recognised name. Lower case. */
export const STATUS_SUBJECTS: readonly string[] = ['ci', 'checks', 'tests', 'suite', 'build', 'review'];

/** At most one of these may stand between a subject and its status word (S3). Lower case. */
export const STATUS_LINKERS: readonly string[] = ['is', 'was', 'now'];

/** Words that turn a status word around when they stand before it in its clause: S3 then gives no label (chat reading
 *  Task C fix rounds 1 and 2, reviews 1584 F1 and 1592; departure c-s3-negation, amending spec 3.3). Lower case, each a
 *  whole word, read with any `.`, `-` or `/` joining it to more word characters. Behind a colon right after the status
 *  word only a count of zero does it: `ZERO_COUNT_AFTER`. */
export const STATUS_NEGATORS: readonly string[] = ['no', 'none', 'not', 'never', 'nothing', '0', 'zero'];

/** Bold openings that ask the operator to act (C1). Lower case; `leadKind` reads them. */
export const ACTION_LEADS: readonly string[] = [
  'what to do', 'to do', 'your call', 'decision needed', 'what i need from you', 'action',
];

/** The data attributes the plugin writes, and the only ones: a mark carries a kind and an id, never a URL. */
export const MARK_ATTR = {
  kind: 'data-mark-kind',
  id: 'data-mark-id',
  status: 'data-status',
  lead: 'data-lead',
  afterLead: 'data-after-lead',
} as const;

/** The tone of `word`, compared in lower case as a whole; `null` when it is not a status word. */
export function statusTone(word: string): StatusTone | null {
  const w = word.toLowerCase();
  for (const tone of Object.keys(STATUS_WORDS) as StatusTone[]) {
    if (STATUS_WORDS[tone].includes(w)) return tone;
  }
  return null;
}

/** What a bold lead-in asks. */
export type LeadKind = 'action' | 'info';

/** `action` when the lower-cased, trimmed text starts with an `ACTION_LEADS` entry that is followed by the text's
 *  end, a space, `(`, `.` or `:`; else `info` when it ends in `.` or `:`; else `null` (bold, not a lead-in). */
export function leadKind(boldText: string): LeadKind | null {
  const t = boldText.trim().toLowerCase();
  for (const lead of ACTION_LEADS) {
    if (!t.startsWith(lead)) continue;
    const next = t.charAt(lead.length);
    if (next === '' || next === ' ' || next === '(' || next === '.' || next === ':') return 'action';
  }
  return t.endsWith('.') || t.endsWith(':') ? 'info' : null;
}

/** One piece of a text: plain text, a recognised name, or a status word in a label position. */
export type MarkRun =
  | { kind: 'text'; text: string }
  | { kind: 'mark'; mark: Mark }
  | { kind: 'status'; text: string; tone: StatusTone };

/** A word character, in any script: a letter, a combining mark, a digit or `_`. A name never starts or ends against
 *  one, so `C#1`, `item3` and a hex run straight after `é` are not names. Read by whole code point, so a letter
 *  outside the BMP (`𝐀`, `𠀀`) bounds a name like any other (fix round 1, review 1574 F-A). */
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const isWordPoint = (cp: number | undefined): boolean => cp !== undefined && WORD.test(String.fromCodePoint(cp));

/** Whether the character starting at `at` is a word character; `false` at the end. */
function wordAfter(text: string, at: number): boolean {
  return isWordPoint(text.codePointAt(at));
}

/** Whether the character ending just before `at` is a word character, a surrogate pair read whole; `false` at the
 *  start. */
function wordBefore(text: string, at: number): boolean {
  if (at <= 0) return false;
  const pair = at >= 2 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(at - 2, at));
  return isWordPoint(text.codePointAt(pair ? at - 2 : at - 1));
}

/** Whether a name ending at `end` runs on as a file name or a longer token: `.` and then a word character
 *  (`abc1234.ts`, `docs/plan.md.bak`). A `.` that ends a sentence does not (fix round 1, ruling 4). */
const runsOnAfterDot = (text: string, end: number): boolean => text.charAt(end) === '.' && wordAfter(text, end + 1);

/** What may not stand right before a document path or a commit, besides a word character. */
const PATHISH = new Set(['.', '/', '-']);

/** What may not stand right before a commit besides those: `#`, so an 8-digit colour (`#ff00aa80`) is plain text
 *  (fix round 2, review 1575 F2). */
const NOT_BEFORE_COMMIT = '#';

// The grammar, one sticky pattern per kind, tried in this priority order at each position. A match is a name only
// when the boundary checks in `nameAt` hold.
const DOC = /docs\/[A-Za-z0-9._/-]*\.md/y;
const PR = /#(\d{1,6})/y;
const RUN = /(?:run|review)\s+(\d+)/iy;
const ITEM = /item\s+(\d+)/iy;
const COMMIT = /[0-9a-f]{7,40}/y;
const SUBJECT = /[A-Za-z]+/y;
const SPACED_WORD = /\s+([A-Za-z]+)/y;
const KEYWORDS: readonly (readonly [RegExp, MarkKind])[] = [[PR, 'pr'], [RUN, 'run'], [ITEM, 'item']];

function stickyAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

/** The name starting at `at`, with where it ends; `null` when none starts there. The caller has checked that the
 *  character before `at` is not a word character. */
function nameAt(text: string, at: number): { mark: Mark; end: number } | null {
  const pathOk = !PATHISH.has(text.charAt(at - 1));
  let m = pathOk ? stickyAt(DOC, text, at) : null;
  if (m) {
    const end = at + m[0].length;
    const after = text.charAt(end);
    if (!wordAfter(text, end) && after !== '/' && after !== '-' && !runsOnAfterDot(text, end) && !m[0].split('/').includes('..')) {
      return { mark: { kind: 'doc', id: m[0], text: m[0] }, end };
    }
  }
  for (const [re, kind] of KEYWORDS) {
    m = stickyAt(re, text, at);
    if (m && !wordAfter(text, at + m[0].length)) {
      return { mark: { kind, id: m[1]!, text: m[0] }, end: at + m[0].length };
    }
  }
  m = pathOk && text.charAt(at - 1) !== NOT_BEFORE_COMMIT ? stickyAt(COMMIT, text, at) : null;
  if (m === null) return null;
  const end = at + m[0].length;
  // No exponent rule (fix round 2, review 1575 F1): digits, one `e` and digits is a real short SHA about 1 time in 43,
  // so `1e10000` reads as a commit too, and only Task L's repository rule can tell them apart.
  const shaShape = /\d/.test(m[0]) && /[a-f]/.test(m[0]);
  if (shaShape && !wordAfter(text, end) && text.charAt(end) !== '-' && !runsOnAfterDot(text, end)) {
    return { mark: { kind: 'commit', id: m[0], text: m[0] }, end };
  }
  return null;
}

/** The word after whitespace at `at`, with where it ends, when no word character follows it; else `null`. */
function spacedWord(text: string, at: number): { word: string; end: number } | null {
  const m = stickyAt(SPACED_WORD, text, at);
  if (m === null) return null;
  const end = at + m[0].length;
  return wordAfter(text, end) ? null : { word: m[1]!, end };
}

/** S3's tail after a name or a subject ending at `at`: whitespace, at most one `STATUS_LINKERS` word and more
 *  whitespace, then a status word. Its word's span and tone, or `null`. */
function statusAfter(text: string, at: number): { start: number; end: number; tone: StatusTone } | null {
  let next = spacedWord(text, at);
  if (next !== null && statusTone(next.word) === null && STATUS_LINKERS.includes(next.word.toLowerCase())) {
    next = spacedWord(text, next.end);
  }
  if (next === null) return null;
  const tone = statusTone(next.word);
  return tone === null ? null : { start: next.end - next.word.length, end: next.end, tone };
}

/** What may follow a sentence's last mark before the space: closing brackets and quotes (`?)`, `?"`). */
const CLOSERS = ')]"\'\u2019\u201D';
const isSpace = (c: string): boolean => c !== '' && /\s/.test(c);

/** For each offset of `text`, whether the sentence that a label ending there belongs to ends in `?` (review 1592 F5).
 *  A sentence ends at a run of `.`, `!` and `?`, with any closers after it, followed by a space or the text's end; at a
 *  `)` or `]` followed by at least one space and a capital letter ("(#651 merged) Is it out?"; glued to the capital
 *  it ends nothing); at a spaced dash; or at a line break. It is a question when its run holds a `?` ("Is #651
 *  merged?!", "(Has #651 merged?)"). Brackets nest: an end inside a `(` or `[` that opens after the label is the
 *  aside's own, not the label's ("#651 merged (why?) and shipped."); an aside left open does not hide a following
 *  question. A line break ends every aside. One pass forward to find the marks and one back to answer every offset,
 *  so a block of many labels costs one pass.
 *
 *  The costs of the heuristic (review 1689 A7), each pinned by a row in `chat-marks-negation.test.ts`: a `)` before a
 *  capital word ends the sentence even when the sentence goes on, so "Is CI green (on main) OK?" keeps its green
 *  label; a spaced dash splits a question the same way ("Is CI green — or red?"); and the zero-count rule (below)
 *  reads any joined token of zeros as a count, so "Bound to 0.0.0.0 and CI green" gives no label. Text that is not
 *  prose is masked as letters, so a full stop in it ends nothing ("#651 merged `step 1.` Is it out?" is one question,
 *  A5), but a capital in it still opens a sentence after a closer ("(#651 merged) `Main` is red?", A6). */
function sentenceQuestions(prose: string, quiet: readonly Span[]): Uint8Array {
  // Text that is not prose (inline code, link text, raw html; review 1601 F3) holds no mark: it reads as letters.
  let text = '';
  let from = 0;
  for (const q of quiet) {
    text += prose.slice(from, q.start) + 'a'.repeat(q.end - q.start);
    from = q.end;
  }
  text += prose.slice(from);
  const n = text.length;
  /** Per offset: 0 nothing, 1 an end, 2 a question's end, 3 an opening bracket, 4 a closing one, 5 one that also
   *  ends the sentence around it, 6 a line break. */
  const mark = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = text.charAt(i);
    if (c === '\n') mark[i] = 6;
    else if (c === '(' || c === '[') mark[i] = 3;
    else if (c === ')' || c === ']') {
      let k = i + 1;
      while (k < n && isSpace(text.charAt(k))) k += 1;
      // The capital is read off the prose, not the masked text: masking hides sentence ends, not letters.
      mark[i] = k > i + 1 && /\p{Lu}/u.test(prose.charAt(k)) ? 5 : 4;
    } else if (c === '.' || c === '!' || c === '?') {
      let j = i;
      while (j < n && '.!?'.includes(text.charAt(j))) j += 1;
      let k = j;
      while (k < n && CLOSERS.includes(text.charAt(k))) k += 1;
      if (k === n || isSpace(text.charAt(k))) mark[i] = text.slice(i, j).includes('?') ? 2 : 1;
      i = j - 1;
    } else if ((c === '\u2014' || c === '\u2013') && isSpace(text.charAt(i - 1)) && isSpace(text.charAt(i + 1))) {
      mark[i] = 1;
    }
  }
  const asks = new Uint8Array(n + 1);
  const after: number[] = [];
  let ask = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = mark[i]!;
    if (m === 1 || m === 2) ask = m === 2 ? 1 : 0;
    else if (m === 6) { after.length = 0; ask = 0; }
    else if (m === 4 || m === 5) { if (m === 5) ask = 0; after.push(ask); }
    else if (m === 3) ask = after.length ? after.pop()! : ask;
    asks[i] = ask;
  }
  return asks;
}
/** One step of the negator scan: a clause end (group 1: `.`, `!`, `?`, `;`, `,` or `:` followed by a space or the
 *  text's end, or a line break), or a whole word, digits included, with any `.`, `-` or `/` joining it to more word
 *  characters (`10`, `v0.0.1003`, `no-op`, `docs/no.md` are each one word; review 1592 F3). */
const NEGATION_TOKEN = /([.!?;,:](?=\s|$)|\n)|[\p{L}\p{M}\p{N}_]+(?:[.\-/][\p{L}\p{M}\p{N}_]+)*/gu;
/** The number words a count of zero may be "of" ("passed: 0 of twelve"; review 1601 F2), the plurals of a hundred and a
 *  thousand among them ("failed: 0 of hundreds"; review 1722 F5). */
const NUMBER_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands',
];
/** A colon right after a status word and a count of zero behind it: `0`, `zero` or `none`, followed by "of N" or
 *  "out of N" (N in digits or a number word), "(of N)", "/N" with or without spaces, `%`, a dash clause, or the
 *  clause's end ("passed: 0 of 12", "failed: none.", "passed: 0 / 12", "failed: 0 — all good"; reviews 1592 F2 and
 *  1601 F2). */
const ZERO_COUNT_AFTER = new RegExp(
  '\\s*:\\s*(?:0|zero|none)(?:'
    // A number word ends at a word end: "ten" is not the start of "tenants".
    + `\\s+(?:out\\s+)?of\\s+(?:\\p{N}|(?:${NUMBER_WORDS.join('|')})(?![\\p{L}\\p{N}_]))`
    + '|[^\\S\\n]*\\(\\s*(?:out\\s+)?of\\s+\\p{N}'
    + '|[^\\S\\n]*\\/[^\\S\\n]*\\p{N}'
    + '|%'
    + '|(?=[^\\S\\n]*(?:[.!?;,:](?=\\s|$)|\\n|$)|[^\\S\\n]*[\u2014\u2013]|[^\\S\\n]+-[^\\S\\n]))',
  'iuy',
);

/** The zero words a joined zero count over a total starts with ("0/12"; review 1601 F1). */
const ZERO_WORDS: readonly string[] = ['0', 'zero', 'none'];
/** Whether one scanned word is a negator: one of `STATUS_NEGATORS`, or a joined token that is a zero count, its parts
 *  all negators ("0-0", "0.0", "no/none") or a zero word over a number ("0/12", "Zero/12"). Any other joined token is
 *  one word that is not a negator, so `0.5%`, `v0.0.1003`, `docs/no.md` and `no-op` keep their labels (review 1592 F3;
 *  review 1601 F1). */
const isNegator = (word: string): boolean => {
  const w = word.toLowerCase();
  if (STATUS_NEGATORS.includes(w)) return true;
  const parts = w.split(/[.\-/]/);
  if (parts.length < 2) return false;
  if (parts.every((p) => STATUS_NEGATORS.includes(p))) return true;
  const [count, total] = parts;
  return parts.length === 2 && ZERO_WORDS.includes(count!) && w.charAt(count!.length) === '/'
    && /^\p{N}+$/u.test(total!);
};

/** A stretch of the scanned text, by offsets: where a recognised name stands, or text that is not prose. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** S3's withholding over one text (c-s3-negation): a text node's own, or, through the plugin, the flattened text of its
 *  whole block, so a negator or a `?` in a neighbouring text node counts (review 1592 F4). It reads, for each label,
 *  only the label's clause before it and its sentence after it. Labels are asked in order, so the scan only moves
 *  forward: one pass over the text, however many labels and text nodes it holds (review 1592 F1). Names are
 *  registered in order, as the plugin and `markRuns` find them; labels may be asked in any order. A label asked before
 *  the last one restarts the scan, so for names registered in order the answer never depends on the order in which
 *  labels are asked, only the cost does (review 1601 F5). */
export class LabelScan {
  private readonly names: Span[] = [];
  private tokens = new RegExp(NEGATION_TOKEN.source, NEGATION_TOKEN.flags);
  private pending: RegExpExecArray | null | undefined;
  private skip = 0;
  private clauseFrom = 0;
  private negatorAt = -1;
  private questions: Uint8Array | undefined;
  private lastStart = 0;
  private readonly text: string;
  private readonly quiet: readonly Span[];

  /** `quiet`: the stretches, in order, that are not prose (inline code, link text, raw html), which hold no sentence
   *  end; a negator in them still counts ("`0` tests failed"). */
  constructor(text: string, quiet: readonly Span[] = []) {
    this.text = text;
    this.quiet = quiet;
  }

  /** A recognised name at `start`..`end`: its own words are not negators (`run 0`, `#0`). */
  name(start: number, end: number): void {
    this.names.push({ start, end });
  }

  /** Whether the label on the status word at `start`..`end` is withheld: a negator stands before it in its clause,
   *  its count behind a colon is zero, or its sentence ends in `?`. */
  withheld(start: number, end: number): boolean {
    if (start < this.lastStart) this.restart();
    this.lastStart = start;
    for (;;) {
      if (this.pending === undefined) this.pending = this.tokens.exec(this.text);
      const m = this.pending;
      if (m === null || m.index >= start) break;
      this.pending = undefined;
      if (m[1] !== undefined) {
        this.clauseFrom = m.index + m[0].length;
        continue;
      }
      while (this.skip < this.names.length && this.names[this.skip]!.end <= m.index) this.skip += 1;
      const inName = this.skip < this.names.length && this.names[this.skip]!.start <= m.index;
      if (!inName && isNegator(m[0])) this.negatorAt = m.index;
    }
    if (this.negatorAt >= this.clauseFrom) return true;
    if (stickyAt(ZERO_COUNT_AFTER, this.text, end) !== null) return true;
    this.questions ??= sentenceQuestions(this.text, this.quiet);
    return this.questions[end] === 1;
  }

  private restart(): void {
    this.names.sort((x, y) => x.start - y.start);
    this.tokens = new RegExp(NEGATION_TOKEN.source, NEGATION_TOKEN.flags);
    this.pending = undefined;
    this.skip = 0;
    this.clauseFrom = 0;
    this.negatorAt = -1;
  }
}

/** Where a text node stands in its block, for S3's label check only: the block's `LabelScan` and the node's offset in
 *  the block's flattened text. The plugin asks a block's text nodes in document order. */
export interface LabelContext {
  readonly scan: LabelScan;
  readonly offset: number;
}

/** The one walk over `text` for names, shared by `markRuns` and `nameSpans`: at each position that no word character
 *  precedes, a recognised name is handed to `onName` with its start; its answer is where the walk goes on. Where no
 *  name starts, `onOther` (when given) may take the position over, answering where to go on or `null` to step one
 *  place. */
function walkNames(
  text: string,
  onName: (at: number, name: { mark: Mark; end: number }) => number,
  onOther?: (at: number) => number | null,
): void {
  let i = 0;
  while (i < text.length) {
    if (wordBefore(text, i)) {
      i += 1;
      continue;
    }
    const name = nameAt(text, i);
    if (name !== null) {
      i = onName(i, name);
      continue;
    }
    i = onOther?.(i) ?? i + 1;
  }
}

/** `text` split into runs: names, status words in S3's label position (right after a name or a `STATUS_SUBJECTS`
 *  word, with at most one `STATUS_LINKERS` word between), and the text between. The runs' texts joined are `text`,
 *  and no two text runs are adjacent. Never inside code: the plugin calls it on text nodes only. `context`, the node's
 *  place in its block, is read by S3's withholding only: it never makes or moves a name or a label. */
export function markRuns(text: string, context?: LabelContext): readonly MarkRun[] {
  const runs: MarkRun[] = [];
  const offset = context?.offset ?? 0;
  let own: LabelScan | undefined;
  const scan = (): LabelScan => context?.scan ?? (own ??= new LabelScan(text));
  let plainFrom = 0;
  const plainUpTo = (to: number): void => {
    if (to > plainFrom) runs.push({ kind: 'text', text: text.slice(plainFrom, to) });
  };
  /** After a name or a subject ending at `end`: its status label, if S3 finds one; where the scan goes on. */
  const labelAfter = (end: number): number => {
    const s = statusAfter(text, end);
    if (s === null || scan().withheld(s.start + offset, s.end + offset)) return end;
    plainUpTo(s.start);
    runs.push({ kind: 'status', text: text.slice(s.start, s.end), tone: s.tone });
    plainFrom = s.end;
    return s.end;
  };
  walkNames(text, (at, name) => {
    plainUpTo(at);
    runs.push({ kind: 'mark', mark: name.mark });
    scan().name(at + offset, name.end + offset);
    plainFrom = name.end;
    return labelAfter(name.end);
  }, (at) => {
    const subject = stickyAt(SUBJECT, text, at);
    return subject !== null && STATUS_SUBJECTS.includes(subject[0].toLowerCase())
      ? labelAfter(at + subject[0].length)
      : null;
  });
  plainUpTo(text.length);
  return runs;
}

/** Where `text`'s recognised names stand, in order: the names `markRuns` would mark, for text the plugin draws no marks
 *  in (link text), so that the block's scan knows a name's own words are not negators (review 1601 F3). */
export function nameSpans(text: string): Span[] {
  const out: Span[] = [];
  walkNames(text, (at, name) => {
    out.push({ start: at, end: name.end });
    return name.end;
  });
  return out;
}

/** The mark when `text` is exactly one name and nothing else (R13: a whole inline code span); else `null`. */
export function wholeMark(text: string): Mark | null {
  const runs = markRuns(text);
  const only = runs.length === 1 ? runs[0]! : null;
  return only !== null && only.kind === 'mark' ? only.mark : null;
}

/** S1: the status word a table cell's text starts with, as written, and its tone; `null` when its first word is not
 *  one (or is longer than one: `Failure`). */
export function leadingStatus(text: string): { word: string; tone: StatusTone } | null {
  const m = /^[A-Za-z]+/.exec(text);
  if (m === null || wordAfter(text, m[0].length)) return null;
  const tone = statusTone(m[0]);
  return tone === null ? null : { word: m[0], tone };
}
