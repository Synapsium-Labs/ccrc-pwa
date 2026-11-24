// Paste chips — the decision (desktop-polish wave 169; Goals modification 90, second half). Ring L1, context C3
// (Session Conversation): pure functions over strings, no DOM and no React. `Composer.tsx` performs what these plan and
// decides nothing itself.
//
// A text paste of `CHIP_MIN_CHARS` characters or more, or of more than `CHIP_MAX_PLAIN_LINES` lines, enters the draft
// as a chip: its label, `[Pasted text #N +L lines]` written with no-break spaces so it never wraps, between two reserved
// invisible markers (`CHIP_OPEN`, `CHIP_CLOSE`). The full text is kept in a `PasteChips` table keyed by N.
//
// THE VALUE CARRIES THE IDENTITY (the coordinator's ruling on review 3480). A chip is a label between both markers,
// whose number the table holds and whose line count is that text's; anything else is ordinary text, whatever it says,
// so a label typed by hand, pasted from elsewhere or exposed by an Expand is sent as written. The live chips are an
// exact parse of the field's current value (`parseChips`), done after every change, so nothing is tracked between
// changes: an undo or redo is whatever value the browser restored, and its parse is the answer. A chip that comes back
// whole is a chip again, also twice. Numbers are never reused for the life of the composer, so a label an undo brings
// back from before a send names nothing and never expands to another paste's text.
//
// THE COMPOSER NEVER WRITES IN ANSWER TO AN EDIT IT DID NOT PLAN (the ruling on review 3589):
// - A marker that is not part of a chip is inert (`inertMarkers`): never a chip, it draws nothing, the expansion strips
//   it, and the caret steps over it (`snapSelection`). Nothing removes it on its own, so the browser's undo walks back
//   through the break to the intact chip. While one stands the composer shows the break and holds the send; the user
//   undoes it, or dismisses it (`dismissPlan`, one ordinary edit).
// - Markers enter the field from typing only as part of a chip: typed text loses them (`planEdit`), and a paste that
//   holds one is a chip whatever its length, its text in the table untouched. Every other insert lands natively and the
//   parse decides.
// - A chip is one object to the caret and the selection (`snapSelection`): a caret never rests inside one, and a
//   selection that touches part of one covers all of it before an edit applies (`coverChips`, `planEdit`). Backspace
//   right after a chip, or Delete right before one, takes the whole chip; so does a word delete that reaches into one.
// - Sending, retry, both draft-conflict choices, copy and cut all go through one expansion (`expandValue`): each chip
//   becomes its table text, byte for byte, and the field's own text loses every marker.

/** A paste this long (in characters, i.e. code points) becomes a chip: the brief's floor. Claude Code's own input box
 *  measures differently: it took 800 characters as text and chipped from 801 in this repo's own measurement
 *  (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`). */
export const CHIP_MIN_CHARS = 800;
/** A paste of more lines than this becomes a chip, whatever its length. */
export const CHIP_MAX_PLAIN_LINES = 12;

/** The markers around a chip's label in the field: INVISIBLE TIMES and INVISIBLE SEPARATOR, two default-ignorable
 *  characters that draw nothing (measured in Chrome: zero width) and that typed text rarely carries (MathML uses the
 *  first for implicit multiplication: a paste holding one is a chip, see `shouldChip`). The one definition; every
 *  pattern below is derived from these two. */
export const CHIP_OPEN = '⁢';
export const CHIP_CLOSE = '⁣';
/** The label's spaces: no-break, so a label never wraps across lines and a soft line delete takes a whole chip or none. */
const NBSP = ' ';
const MARKER_CLASS = `[${CHIP_OPEN}${CHIP_CLOSE}]`;
const ANY_MARKER = new RegExp(MARKER_CLASS);
const EVERY_MARKER = new RegExp(MARKER_CLASS, 'g');
const WRAPPED = new RegExp(
  `${CHIP_OPEN}\\[Pasted${NBSP}text${NBSP}#(\\d{1,9})${NBSP}\\+\\d{1,9}${NBSP}lines?\\]${CHIP_CLOSE}`, 'g',
);

/** One pasted text the composer holds. `lines` is part of the label, so it is stored, not recounted. */
export interface PastedText {
  readonly n: number;
  readonly text: string;
  readonly lines: number;
}

/** Every pasted text the current draft has held, by number. Append-only within a draft (header). */
export type PasteChips = ReadonlyMap<number, PastedText>;

/** A chip in the field: number `n` at [start, end), markers included, in UTF-16 units as the field's selection reads. */
export interface ChipSpan {
  readonly n: number;
  readonly start: number;
  readonly end: number;
}

/** A replacement of [start, end) by `text`, for the composer to perform as the browser's own edit. */
export interface Plan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export const emptyChips = (): PasteChips => new Map();

/** The text as the field would have held it had the paste gone in as typing: CR LF and a lone CR read as LF. */
export const normalizePaste = (raw: string): string => raw.replace(/\r\n?/g, '\n');

/** Lines as the field shows them: a trailing newline opens a line of its own. This is the composer's count: Claude
 *  Code's own `+M lines` counts newlines, one fewer for the same text. */
export const lineCount = (text: string): number => text.split('\n').length;

const charCount = (text: string): number => {
  let n = 0;
  // A for…of walks code points, so an emoji counts once, as a reader counts it.
  for (const _ of text) n += 1;
  return n;
};

export const hasMarker = (text: string): boolean => ANY_MARKER.test(text);
export const stripMarkers = (text: string): string => text.replace(EVERY_MARKER, '');

/** Whether a (normalized) paste enters the draft as a chip: a long one, or one holding a marker. */
export const shouldChip = (text: string): boolean =>
  lineCount(text) > CHIP_MAX_PLAIN_LINES || charCount(text) >= CHIP_MIN_CHARS || hasMarker(text);

/** "1 line", "14 lines": the one spelling of a line count, for the label and for the chip row. */
export const linesWord = (lines: number): string => `${lines} ${lines === 1 ? 'line' : 'lines'}`;

/** The label grammar: `[Pasted text #N +L lines]`, its spaces no-break. */
export const chipToken = (n: number, lines: number): string =>
  `[Pasted text #${n} +${linesWord(lines)}]`.replace(/ /g, NBSP);

/** What a chip is in the field: its label between the two markers. */
export const chipField = (n: number, lines: number): string => CHIP_OPEN + chipToken(n, lines) + CHIP_CLOSE;

/** Register a pasted text under number `n`, which the composer's counter gives and never gives twice. */
export const addChip = (chips: PasteChips, text: string, n: number): { chips: PasteChips; field: string } => {
  const lines = lineCount(text);
  const next = new Map(chips);
  next.set(n, { n, text, lines });
  return { chips: next, field: chipField(n, lines) };
};

/** The chips in `value`, in order: each wrapped label whose number the table holds, with that text's line count.
 *  Nothing else is one. The same chip twice is two chips (an undo or a native insert can bring one back whole). */
export const parseChips = (value: string, chips: PasteChips): ChipSpan[] => {
  const out: ChipSpan[] = [];
  for (const m of value.matchAll(WRAPPED)) {
    const n = Number(m[1]);
    const chip = chips.get(n);
    if (chip === undefined || m[0] !== chipField(n, chip.lines)) continue;
    out.push({ n, start: m.index, end: m.index + m[0].length });
  }
  return out;
};

/** Where the markers that are not part of a chip stand: inert, never a chip, drawn as nothing. */
export const inertMarkers = (value: string, chips: PasteChips): number[] => {
  if (!hasMarker(value)) return [];
  const spans = parseChips(value, chips);
  const out: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === CHIP_OPEN || ch === CHIP_CLOSE) && !spans.some((s) => s.start <= i && i < s.end)) out.push(i);
  }
  return out;
};

/** The user's Dismiss of a break: one edit over the inert markers' span that takes them out and keeps every other
 *  character, chips included. Null when there is none. */
export const dismissPlan = (value: string, chips: PasteChips): Plan | null => {
  const inert = inertMarkers(value, chips);
  const first = inert[0];
  const last = inert.at(-1);
  if (first === undefined || last === undefined) return null;
  let text = '';
  for (let i = first; i <= last; i += 1) if (!inert.includes(i)) text += value[i];
  return { start: first, end: last + 1, text };
};

/** The text `value` stands for: each chip replaced by its table text, byte for byte (markers of its own included),
 *  and the field's own text without a marker. The one expansion the send, copy and cut use. */
export const expandValue = (value: string, chips: PasteChips): string => {
  let out = '';
  let at = 0;
  for (const c of parseChips(value, chips)) {
    out += stripMarkers(value.slice(at, c.start)) + (chips.get(c.n)?.text ?? '');
    at = c.end;
  }
  return out + stripMarkers(value.slice(at));
};

/** A live chip, as the composer's chip row lists it: `at` is where it starts in the field, which names it in the row's
 *  acts (one number can stand twice). `head` is the first non-blank line, trimmed, for the eye. */
export interface LiveChip extends PastedText {
  readonly at: number;
  readonly head: string;
}

/** The chips the field shows, in field order. */
export const liveChips = (value: string, chips: PasteChips): LiveChip[] =>
  parseChips(value, chips).flatMap((s) => {
    const chip = chips.get(s.n);
    if (chip === undefined) return [];
    const head = chip.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
    return [{ ...chip, at: s.start, head }];
  });

/** Expand the chip at `at` in place: its label becomes its full text (markers removed), ordinary editable text. */
export const expandChip = (value: string, at: number, chips: PasteChips): Plan | null => {
  const s = parseChips(value, chips).find((x) => x.start === at);
  return s === undefined ? null : { start: s.start, end: s.end, text: stripMarkers(chips.get(s.n)?.text ?? '') };
};

/** Remove the chip at `at`: its label goes; its text stays in the table, for an undo. */
export const removeChip = (value: string, at: number, chips: PasteChips): Plan | null => {
  const s = parseChips(value, chips).find((x) => x.start === at);
  return s === undefined ? null : { start: s.start, end: s.end, text: '' };
};

const within = (spans: readonly ChipSpan[], p: number): ChipSpan | undefined => spans.find((s) => s.start < p && p < s.end);

/** [start, end) widened to cover every chip it touches part of. A collapsed caret inside a chip stands at its end. */
export const coverChips = (value: string, chips: PasteChips, start: number, end: number): { start: number; end: number } => {
  const spans = parseChips(value, chips);
  if (start === end) {
    const c = within(spans, start)?.end ?? start;
    return { start: c, end: c };
  }
  return { start: within(spans, start)?.start ?? start, end: within(spans, end)?.end ?? end };
};

/** Where the field's selection may rest. `anchor` is where it began and `focus` where it moves; `prevFocus` is the focus
 *  before this move, so a key that moved the focus into a chip carries it on to the chip's far side, and `pointer` (a
 *  click or a drag) takes the nearer side instead. A selection's anchor inside a chip moves to the side that makes the
 *  selection cover the chip. A key move that crossed only inert markers carries on over the next character, so an
 *  inert marker takes no key press of its own. */
export const snapSelection = (
  value: string,
  chips: PasteChips,
  sel: { readonly anchor: number; readonly focus: number },
  prevFocus: number,
  pointer: boolean,
): { anchor: number; focus: number } => {
  const spans = parseChips(value, chips);
  let { anchor, focus } = sel;
  const collapsed = anchor === focus;
  const f = within(spans, focus);
  if (f !== undefined) {
    const nearer = focus - f.start <= f.end - focus ? f.start : f.end;
    focus = pointer || focus === prevFocus ? nearer : focus > prevFocus ? f.end : f.start;
  } else if (!pointer && focus !== prevFocus && Math.abs(focus - prevFocus) <= 2) {
    const inert = new Set(inertMarkers(value, chips));
    const d = focus > prevFocus ? 1 : -1;
    let only = true;
    for (let i = Math.min(focus, prevFocus); only && i < Math.max(focus, prevFocus); i += 1) only = inert.has(i);
    if (only) {
      const ahead = (p: number): number => (d > 0 ? p : p - 1); // the character a move from p crosses
      const inside = (p: number): boolean => (d > 0 ? p < value.length : p > 0);
      while (inside(focus) && inert.has(ahead(focus))) focus += d;
      if (inside(focus)) focus += d;
      const g = within(spans, focus);
      if (g !== undefined) focus = d > 0 ? g.end : g.start;
    }
  }
  if (collapsed) return { anchor: focus, focus };
  const a = within(spans, anchor);
  if (a !== undefined) anchor = focus >= anchor ? a.start : a.end;
  return { anchor, focus };
};

/** An edit the browser is about to make (a `beforeinput`), planned only where a chip needs it; null leaves it to the
 *  browser, whose result is parsed. `word` is the range a word delete from a collapsed caret would remove, as the
 *  browser measures it, or null when the browser cannot say.
 *  - Any edit over a selection that touches part of a chip applies to the selection covering it whole; a caret inside a
 *    chip (one the snap has not moved yet) stands at its end.
 *  - Backspace right after a chip, or Delete right before one, removes the whole chip; so does a word delete that
 *    reaches into one (the word widened to cover it). With no word range, a word delete beside a chip takes the chip.
 *    A delete from a caret inside a chip takes that chip.
 *  - Typed text (`insertText`, the one kind that can only be typing) goes in without markers.
 *  Line deletes, undo and redo, and every other insert land natively. */
export const planEdit = (
  value: string,
  chips: PasteChips,
  selStart: number,
  selEnd: number,
  inputType: string,
  data: string | null,
  word: { readonly start: number; readonly end: number } | null = null,
): Plan | null => {
  const isDelete = inputType === 'deleteContentBackward' || inputType === 'deleteContentForward'
    || inputType === 'deleteWordBackward' || inputType === 'deleteWordForward' || inputType === 'deleteByCut';
  const insert = inputType === 'insertLineBreak' || inputType === 'insertParagraph'
    ? '\n'
    : inputType === 'insertText' && data !== null ? data : null;
  if (!isDelete && insert === null) return null;
  const text = insert === null ? '' : stripMarkers(insert);
  const r = coverChips(value, chips, selStart, selEnd);
  const moved = r.start !== selStart || r.end !== selEnd;
  if (selStart !== selEnd || !isDelete) {
    return !moved && text === (insert ?? '') ? null : { start: r.start, end: r.end, text };
  }
  const backward = inputType.endsWith('Backward');
  const spans = parseChips(value, chips);
  // A caret inside a chip stands at its end, so any delete from there takes that chip.
  const beside = spans.find((s) => (backward || moved ? s.end === r.start : s.start === r.start));
  if (!moved && inputType.startsWith('deleteWord') && word !== null && word.start < word.end) {
    const w = coverChips(value, chips, word.start, word.end);
    return w.start === word.start && w.end === word.end ? null : { start: w.start, end: w.end, text: '' };
  }
  return beside === undefined ? null : { start: beside.start, end: beside.end, text: '' };
};

/** A paste of `text` (normalized) over [selStart, selEnd), the selection widened to cover the chips it touches. A long
 *  text, or one holding a marker, becomes chip `n`; a short one goes in as it is. Null leaves a short paste that touches
 *  no chip to the browser, as it always was, and a paste with no text plans nothing. `added` says whether `n` was used. */
export const planPaste = (
  value: string,
  chips: PasteChips,
  selStart: number,
  selEnd: number,
  text: string,
  n: number,
): { chips: PasteChips; plan: Plan | null; added: boolean } => {
  if (text === '') return { chips, plan: null, added: false };
  const r = coverChips(value, chips, selStart, selEnd);
  if (!shouldChip(text)) {
    return { chips, plan: r.start === selStart && r.end === selEnd ? null : { ...r, text }, added: false };
  }
  const a = addChip(chips, text, n);
  return { chips: a.chips, plan: { ...r, text: a.field }, added: true };
};

/** The clipboard's text for a copy or cut of [start, end), widened to whole chips, with every chip given as its full
 *  text and no marker of the field's own. Null when the selection holds no chip and no marker, so the browser copies
 *  as it always has. */
export const selectionText = (value: string, chips: PasteChips, start: number, end: number): string | null => {
  if (start === end) return null;
  const r = coverChips(value, chips, start, end);
  const part = value.slice(r.start, r.end);
  return hasMarker(part) ? expandValue(part, chips) : null;
};
