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

/** Words that turn a status word around when they stand before it in its clause, or behind a colon right after it as
 *  its count ("passed: 0 of 12"): S3 then gives no label (chat reading Task C fix round 1, review 1584 F1; departure
 *  c-s3-negation, amending spec 3.3). Lower case, each a whole word. */
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

/** Where a clause ends: `.`, `!`, `?`, `;`, `,` or `:` followed by a space or the text's end, or a line break. */
const CLAUSE_END = /[.!?;,:](?=\s|$)|\n/g;
/** Where a sentence ends: `.`, `!` or `?` followed by a space or the text's end, or a line break. */
const SENTENCE_END = /[.!?](?=\s|$)|\n/g;
/** A whole word, digits included, for the negator test: `10` is one word, never `0`. */
const NEGATOR_WORD = /[\p{L}\p{M}\p{N}_]+/gu;
/** A colon right after a status word and the word behind it (`passed: 0 of 12`). */
const COUNT_AFTER = /\s*:\s*([\p{L}\p{M}\p{N}_]+)/uy;

const isNegator = (word: string): boolean => STATUS_NEGATORS.includes(word.toLowerCase());

/** Whether S3 withholds the label on the status word at `start`..`end` (c-s3-negation): a negator stands before it in
 *  its clause or is its count behind a colon, or its sentence ends in `?`. The mark before it stays either way. */
function labelWithheld(text: string, start: number, end: number): boolean {
  let clauseFrom = 0;
  for (const m of text.slice(0, start).matchAll(CLAUSE_END)) clauseFrom = (m.index ?? 0) + m[0].length;
  for (const m of text.slice(clauseFrom, start).matchAll(NEGATOR_WORD)) if (isNegator(m[0])) return true;
  const count = stickyAt(COUNT_AFTER, text, end);
  if (count !== null && isNegator(count[1]!)) return true;
  SENTENCE_END.lastIndex = end;
  const close = SENTENCE_END.exec(text);
  return close !== null && close[0] === '?';
}

/** `text` split into runs: names, status words in S3's label position (right after a name or a `STATUS_SUBJECTS`
 *  word, with at most one `STATUS_LINKERS` word between), and the text between. The runs' texts joined are `text`,
 *  and no two text runs are adjacent. Never inside code: the plugin calls it on text nodes only. */
export function markRuns(text: string): readonly MarkRun[] {
  const runs: MarkRun[] = [];
  let plainFrom = 0;
  const plainUpTo = (to: number): void => {
    if (to > plainFrom) runs.push({ kind: 'text', text: text.slice(plainFrom, to) });
  };
  /** After a name or a subject ending at `end`: its status label, if S3 finds one; where the scan goes on. */
  const labelAfter = (end: number): number => {
    const s = statusAfter(text, end);
    if (s === null || labelWithheld(text, s.start, s.end)) return end;
    plainUpTo(s.start);
    runs.push({ kind: 'status', text: text.slice(s.start, s.end), tone: s.tone });
    plainFrom = s.end;
    return s.end;
  };
  let i = 0;
  while (i < text.length) {
    if (wordBefore(text, i)) {
      i += 1;
      continue;
    }
    const name = nameAt(text, i);
    if (name !== null) {
      plainUpTo(i);
      runs.push({ kind: 'mark', mark: name.mark });
      plainFrom = name.end;
      i = labelAfter(name.end);
      continue;
    }
    const subject = stickyAt(SUBJECT, text, i);
    if (subject !== null && STATUS_SUBJECTS.includes(subject[0].toLowerCase())) {
      i = labelAfter(i + subject[0].length);
      continue;
    }
    i += 1;
  }
  plainUpTo(text.length);
  return runs;
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
