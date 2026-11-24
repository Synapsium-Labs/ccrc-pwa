// Paste chips — the decision (desktop-polish wave 169; Goals modification 90, second half). Ring L1, context C3
// (Session Conversation): pure functions over strings, no DOM and no React. `Composer.tsx` performs what these plan and
// decides nothing itself.
//
// A text paste of `CHIP_MIN_CHARS` characters or more, or of more than `CHIP_MAX_PLAIN_LINES` lines, enters the draft
// as a chip: its label, `[Pasted text #N +L lines]`, wrapped in two reserved invisible markers (`CHIP_OPEN`,
// `CHIP_CLOSE`). The full text is kept in a `PasteChips` table keyed by N.
//
// THE VALUE CARRIES THE IDENTITY (the coordinator's ruling on review 3480). A chip is a label wrapped in both markers,
// whose number the table holds and whose line count is that text's; anything else is ordinary text, whatever it says,
// so a label typed by hand, pasted from elsewhere or exposed by an Expand is sent as written. The live chips are an
// exact parse of the field's current value (`parseChips`), done after every change, so nothing is tracked between
// changes: an undo or redo is whatever value the browser restored, and its parse is the answer. Numbers are never reused
// while the draft lives, and the table keeps every pasted text until the draft is sent or replaced, whether or not the
// field still shows its chip, so an undo that brings a chip back finds its text.
//
// Never lose pasted text silently:
// - The markers enter the field only as part of a chip: `stripMarkers` takes them out of typed and short pasted text,
//   and a paste that holds one is a chip whatever its length, so its text sits in the table untouched.
// - A chip is one object to the caret and the selection (`snapSelection`): a caret never rests inside one, and a
//   selection that touches part of one covers all of it before an edit applies (`coverChips`, `planEdit`). Backspace
//   right after a chip, or Delete right before one, takes the whole chip; so does a word delete that reaches into one.
// - What still breaks a chip (an input method's composition, a drop, a line delete, which land as the browser makes
//   them) is cleaned up after it lands (`strayRanges`): a marker that is not part of a chip is removed with the piece
//   of label beside it, so the field never shows a label that sends without its text, and nothing the user removed
//   comes back. The chip's text stays in the table, so an undo can bring the chip back.
// - Sending, retry, both draft-conflict choices, copy and cut all go through one expansion (`expandValue`): each chip
//   becomes its table text, then every marker is stripped.

/** A paste this long (in characters, i.e. code points) becomes a chip: the brief's floor. Claude Code's own input box
 *  measures differently: it took 800 characters as text and chipped from 801 in this repo's own measurement
 *  (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`). */
export const CHIP_MIN_CHARS = 800;
/** A paste of more lines than this becomes a chip, whatever its length. */
export const CHIP_MAX_PLAIN_LINES = 12;

/** The markers around a chip's label in the field: INVISIBLE TIMES and INVISIBLE SEPARATOR, two default-ignorable
 *  characters that draw nothing (measured in Chrome: zero width) and that ordinary text does not carry. */
export const CHIP_OPEN = '⁢';
export const CHIP_CLOSE = '⁣';
const MARKERS = /[⁢⁣]/g;

/** One pasted text the draft holds. `lines` is part of the label, so it is stored, not recounted. */
export interface PastedText {
  readonly n: number;
  readonly text: string;
  readonly lines: number;
}

/** Every pasted text this draft has held, by number. Append-only within a draft (header). */
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

export const hasMarker = (text: string): boolean => /[⁢⁣]/.test(text);
export const stripMarkers = (text: string): string => text.replace(MARKERS, '');

/** Whether a (normalized) paste enters the draft as a chip: a long one, or one holding a marker. */
export const shouldChip = (text: string): boolean =>
  lineCount(text) > CHIP_MAX_PLAIN_LINES || charCount(text) >= CHIP_MIN_CHARS || hasMarker(text);

/** "1 line", "14 lines": the one spelling of a line count, for the label and for the chip row. */
export const linesWord = (lines: number): string => `${lines} ${lines === 1 ? 'line' : 'lines'}`;

/** The visible label grammar: `[Pasted text #N +L lines]`. */
export const chipToken = (n: number, lines: number): string => `[Pasted text #${n} +${linesWord(lines)}]`;

/** What a chip is in the field: its label between the two markers. */
export const chipField = (n: number, lines: number): string => CHIP_OPEN + chipToken(n, lines) + CHIP_CLOSE;

/** Register a pasted text under the next number this draft has not used. `field` is what goes into the field. */
export const addChip = (chips: PasteChips, text: string): { chips: PasteChips; n: number; field: string } => {
  const n = Math.max(0, ...chips.keys()) + 1;
  const lines = lineCount(text);
  const next = new Map(chips);
  next.set(n, { n, text, lines });
  return { chips: next, n, field: chipField(n, lines) };
};

const WRAPPED = /⁢\[Pasted text #(\d{1,9}) \+\d{1,9} lines?\]⁣/g;

/** The chips in `value`, in order: each wrapped label whose number the table holds, with that text's line count, and
 *  only its first occurrence (a number is one chip). Nothing else is one. */
export const parseChips = (value: string, chips: PasteChips): ChipSpan[] => {
  const out: ChipSpan[] = [];
  const seen = new Set<number>();
  for (const m of value.matchAll(WRAPPED)) {
    const n = Number(m[1]);
    const chip = chips.get(n);
    if (chip === undefined || seen.has(n) || m[0] !== chipField(n, chip.lines)) continue;
    seen.add(n);
    out.push({ n, start: m.index, end: m.index + m[0].length });
  }
  return out;
};

/** The text `value` stands for: each chip replaced by its table text, then every marker removed. The one expansion
 *  that the send, copy and cut use. */
export const expandValue = (value: string, chips: PasteChips): string => {
  let out = '';
  let at = 0;
  for (const c of parseChips(value, chips)) {
    out += value.slice(at, c.start) + (chips.get(c.n)?.text ?? '');
    at = c.end;
  }
  return stripMarkers(out + value.slice(at));
};

/** A live chip, as the composer's chip row lists it. `head` is the first non-blank line, trimmed, for the eye. */
export interface LiveChip extends PastedText {
  readonly head: string;
}

/** The chips the field shows, in field order. */
export const liveChips = (value: string, chips: PasteChips): LiveChip[] =>
  parseChips(value, chips).flatMap((s) => {
    const chip = chips.get(s.n);
    if (chip === undefined) return [];
    const head = chip.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
    return [{ ...chip, head }];
  });

/** Expand chip `n` in place: its label becomes its full text (markers removed), ordinary editable text from then on. */
export const expandChip = (value: string, n: number, chips: PasteChips): Plan | null => {
  const s = parseChips(value, chips).find((x) => x.n === n);
  return s === undefined ? null : { start: s.start, end: s.end, text: stripMarkers(chips.get(n)?.text ?? '') };
};

/** Remove chip `n`: its label goes; its text stays in the table, for an undo. */
export const removeChip = (value: string, n: number, chips: PasteChips): Plan | null => {
  const s = parseChips(value, chips).find((x) => x.n === n);
  return s === undefined ? null : { start: s.start, end: s.end, text: '' };
};

const within = (spans: readonly ChipSpan[], p: number): ChipSpan | undefined => spans.find((s) => s.start < p && p < s.end);

/** [start, end) widened to cover every chip it touches part of. A collapsed caret inside a chip is not widened. */
export const coverChips = (value: string, chips: PasteChips, start: number, end: number): { start: number; end: number } => {
  if (start === end) return { start, end };
  const spans = parseChips(value, chips);
  return { start: within(spans, start)?.start ?? start, end: within(spans, end)?.end ?? end };
};

/** Where the field's selection may rest. `anchor` is where it began and `focus` where it moves; `prevFocus` is the focus
 *  before this move, so a key that moved the focus into a chip carries it on to the chip's far side, and `pointer` (a
 *  click or a drag) takes the nearer side instead. A selection's anchor inside a chip moves to the side that makes the
 *  selection cover the chip. */
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
  }
  if (collapsed) return { anchor: focus, focus };
  const a = within(spans, anchor);
  if (a !== undefined) anchor = focus >= anchor ? a.start : a.end;
  return { anchor, focus };
};

/** An edit the browser is about to make (a `beforeinput`), planned only where a chip needs it; null leaves it to the
 *  browser, whose result is parsed. `word` is the range a word delete from a collapsed caret would remove, as the
 *  browser measures it, or null when the browser cannot say.
 *  - Any edit over a selection that touches part of a chip applies to the selection covering it whole.
 *  - Backspace right after a chip, or Delete right before one, removes the whole chip; so does a word delete that
 *    reaches into one (the word widened to cover it). With no word range, a word delete beside a chip takes the chip.
 *  - Text that holds a marker goes in without it.
 *  Line deletes and every other kind land natively. */
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
    : inputType.startsWith('insert') && data !== null ? data : null;
  if (!isDelete && insert === null) return null;
  const text = insert === null ? '' : stripMarkers(insert);
  if (selStart !== selEnd) {
    const r = coverChips(value, chips, selStart, selEnd);
    if (r.start === selStart && r.end === selEnd && text === (insert ?? '')) return null;
    return { start: r.start, end: r.end, text };
  }
  if (!isDelete) return text === insert ? null : { start: selStart, end: selStart, text };
  const backward = inputType.endsWith('Backward');
  const spans = parseChips(value, chips);
  const beside = spans.find((s) => (backward ? s.end === selStart : s.start === selStart));
  if (inputType.startsWith('deleteWord') && word !== null && word.start < word.end) {
    const r = coverChips(value, chips, word.start, word.end);
    return r.start === word.start && r.end === word.end ? null : { start: r.start, end: r.end, text: '' };
  }
  return beside === undefined ? null : { start: beside.start, end: beside.end, text: '' };
};

/** A paste of `text` (normalized) over [selStart, selEnd), the selection widened to cover the chips it touches. A long
 *  text, or one holding a marker, becomes the next chip; a short one goes in as it is. Null leaves a short paste that
 *  touches no chip to the browser, as it always was. */
export const planPaste = (
  value: string,
  chips: PasteChips,
  selStart: number,
  selEnd: number,
  text: string,
): { chips: PasteChips; plan: Plan | null } => {
  const r = coverChips(value, chips, selStart, selEnd);
  if (!shouldChip(text)) {
    return { chips, plan: r.start === selStart && r.end === selEnd ? null : { ...r, text } };
  }
  const added = addChip(chips, text);
  return { chips: added.chips, plan: { ...r, text: added.field } };
};

/** The clipboard's text for a copy or cut of [start, end), widened to whole chips, with every chip given as its full
 *  text and no marker. Null when the selection holds no chip and no marker, so the browser copies as it always has. */
export const selectionText = (value: string, chips: PasteChips, start: number, end: number): string | null => {
  if (start === end) return null;
  const r = coverChips(value, chips, start, end);
  const part = value.slice(r.start, r.end);
  return hasMarker(part) ? expandValue(part, chips) : null;
};

// The label grammar as pieces, to read the piece of a label beside a stray marker.
const GRAMMAR: readonly string[] = ['[Pasted text #', '#digits', ' +', '#digits', ' line', '#s?', ']'];
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/** How many characters of `value` from `at` on (before `limit`) read as the start of a label. */
const labelHead = (value: string, at: number, limit: number): number => {
  let j = at;
  for (const p of GRAMMAR) {
    if (p === '#digits') {
      const from = j;
      while (j < limit && isDigit(value[j])) j += 1;
      if (j === from) return j - at;
    } else if (p === '#s?') {
      if (j < limit && value[j] === 's') j += 1;
    } else {
      for (const ch of p) {
        if (j >= limit || value[j] !== ch) return j - at;
        j += 1;
      }
    }
  }
  return j - at;
};

/** How many characters of `value` before `end` (from `floor` on) read as the end of a label. */
const labelTail = (value: string, end: number, floor: number): number => {
  let j = end;
  for (const p of [...GRAMMAR].reverse()) {
    if (p === '#digits') {
      const from = j;
      while (j > floor && isDigit(value[j - 1])) j -= 1;
      if (j === from) return end - j;
    } else if (p === '#s?') {
      if (j > floor && value[j - 1] === 's') j -= 1;
    } else {
      for (const ch of [...p].reverse()) {
        if (j <= floor || value[j - 1] !== ch) return end - j;
        j -= 1;
      }
    }
  }
  return end - j;
};

/** What a change the composer did not plan left behind: every marker that is not part of a chip, with the piece of
 *  label beside it (after a lone opening marker, the longest start of a label; before a lone closing one, the longest
 *  end of one). The composer removes these ranges, so the field never shows a label that would send without its text,
 *  and nothing that was removed comes back. The chip's text stays in the table. Empty when the value is clean. */
export const strayRanges = (value: string, chips: PasteChips): { start: number; end: number }[] => {
  if (!hasMarker(value)) return [];
  const spans = parseChips(value, chips);
  const out: { start: number; end: number }[] = [];
  let k = 0;
  let floor = 0; // a closing marker's piece of label never reaches back into an opening marker's (a marker stops it too)
  for (let i = 0; i < value.length; i += 1) {
    const span = spans[k];
    if (span !== undefined && i === span.start) {
      i = span.end - 1;
      k += 1;
      continue;
    }
    const ch = value[i];
    if (ch === CHIP_OPEN) {
      const len = labelHead(value, i + 1, span?.start ?? value.length);
      out.push({ start: i, end: i + 1 + len });
      i += len;
      floor = i + 1;
    } else if (ch === CHIP_CLOSE) {
      const len = labelTail(value, i, floor);
      out.push({ start: i - len, end: i + 1 });
    }
  }
  return out;
};

/** `value` with `ranges` (sorted, disjoint) removed, and where a caret at `caret` lands. For the composer's fallback
 *  where the browser cannot perform the removals itself. */
export const removeRanges = (
  value: string,
  ranges: readonly { start: number; end: number }[],
  caret: number,
): { value: string; caret: number } => {
  let out = '';
  let at = 0;
  let c = caret;
  for (const r of ranges) {
    out += value.slice(at, r.start);
    at = r.end;
    if (caret >= r.end) c -= r.end - r.start;
    else if (caret > r.start) c -= caret - r.start;
  }
  return { value: out + value.slice(at), caret: c };
};
