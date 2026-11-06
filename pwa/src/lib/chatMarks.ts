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
 *  one, so `C#1`, `item3` and a hex run straight after `é` are not names. */
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const isWord = (c: string): boolean => c !== '' && WORD.test(c);

/** What may not stand right before a document path or a commit, besides a word character. */
const PATHISH = new Set(['.', '/', '-']);

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
    if (!isWord(after) && after !== '/' && after !== '-' && !m[0].split('/').includes('..')) {
      return { mark: { kind: 'doc', id: m[0], text: m[0] }, end };
    }
  }
  for (const [re, kind] of KEYWORDS) {
    m = stickyAt(re, text, at);
    if (m && !isWord(text.charAt(at + m[0].length))) {
      return { mark: { kind, id: m[1]!, text: m[0] }, end: at + m[0].length };
    }
  }
  m = pathOk ? stickyAt(COMMIT, text, at) : null;
  if (m && !isWord(text.charAt(at + m[0].length)) && /\d/.test(m[0]) && /[a-f]/.test(m[0])) {
    return { mark: { kind: 'commit', id: m[0], text: m[0] }, end: at + m[0].length };
  }
  return null;
}

/** The word after whitespace at `at`, with where it ends, when no word character follows it; else `null`. */
function spacedWord(text: string, at: number): { word: string; end: number } | null {
  const m = stickyAt(SPACED_WORD, text, at);
  if (m === null) return null;
  const end = at + m[0].length;
  return isWord(text.charAt(end)) ? null : { word: m[1]!, end };
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
    if (s === null) return end;
    plainUpTo(s.start);
    runs.push({ kind: 'status', text: text.slice(s.start, s.end), tone: s.tone });
    plainFrom = s.end;
    return s.end;
  };
  let i = 0;
  while (i < text.length) {
    if (isWord(text.charAt(i - 1))) {
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
  if (m === null || isWord(text.charAt(m[0].length))) return null;
  const tone = statusTone(m[0]);
  return tone === null ? null : { word: m[0], tone };
}
