// Paste chips — the decision (desktop-polish wave 169; Goals modification 90, second half). Ring L1, context C3
// (Session Conversation): pure functions over strings, no DOM and no React. `Composer.tsx` performs what these plan and
// decides nothing itself.
//
// A text paste of `CHIP_MIN_CHARS` characters or more, or of more than `CHIP_MAX_PLAIN_LINES` lines, enters the draft
// as a label, `[Pasted text #N +L lines]`, at the caret. The full text is kept in a `PasteChips` table keyed by N.
//
// IDENTITY IS THE INSERTED OCCURRENCE, NEVER THE LABEL'S TEXT (review 3457 F4, A1; review 3469 F1-F3). A `Draft` is the
// field's value plus the spans where the composer itself put a label (`Occurrence`); every change keeps, moves or drops
// those spans by position (`applyChange`). Text that merely looks like a label (typed, pasted from another draft, or
// exposed by expanding a chip whose text contains one) is ordinary text and is sent as written. No label's text is ever
// searched for:
// - a chip the composer inserts is placed where its plan put the label (`planPaste`'s `attach`);
// - the browser's own undo and redo bring back a draft the field has already held, with exactly its occurrences: the
//   composer keeps the drafts it has held in the browser's undo order (`DraftLog`), and an undo or redo takes the one
//   whose value the browser restored (`logStep`). When none is held, the composer cancels the step before it lands.
//
// Never lose pasted text silently:
// - The table only grows within a draft, so a chip's text outlives its occurrence (for undo, above). The composer
//   starts a new table only when a send empties the field.
// - An edit that would break a label without removing all of it is planned before it lands (`planInput`): typing or
//   deleting inside a label expands it to its full text instead, and a selection that starts or ends inside one keeps
//   that chip's text. Backspace right after a label, or Delete right before one, removes the whole label and its text.
// - A word delete is planned the same way, over the range the browser itself would delete (`planWordDelete`).
// - An edit that lands anyway (one that cannot be planned: an input method's composition, which cannot be cancelled, a
//   drop, a line delete) is repaired after it lands, with the same result (`applyChange`'s `repair`).
// - Copying or cutting a selection that holds a chip gives the clipboard the chip's full text, never its label
//   (`selectionText`), so no other draft can read a label as its own chip.

/** A paste this long (in characters, i.e. code points) becomes a chip: the brief's floor. Claude Code's own input box
 *  measures differently: it took 800 characters as text and chipped from 801 in this repo's own measurement
 *  (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`). */
export const CHIP_MIN_CHARS = 800;
/** A paste of more lines than this becomes a chip, whatever its length. */
export const CHIP_MAX_PLAIN_LINES = 12;

/** One pasted text the draft holds. `lines` is part of the label, so it is stored, not recounted. */
export interface PastedText {
  readonly n: number;
  readonly text: string;
  readonly lines: number;
}

/** Every pasted text this draft has held, by number. Append-only within a draft (header). */
export type PasteChips = ReadonlyMap<number, PastedText>;

/** A label the composer put in the field: chip `n` at [start, end), in UTF-16 units, as the field's selection reads. */
export interface Occurrence {
  readonly n: number;
  readonly start: number;
  readonly end: number;
}

/** The field's value and the chip occurrences in it, sorted and disjoint. */
export interface Draft {
  readonly value: string;
  readonly occ: readonly Occurrence[];
}

/** A replacement of [start, end) by `text`, for the composer to perform as the browser's own edit. */
export interface Plan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export const emptyChips = (): PasteChips => new Map();
export const emptyDraft = (value = ''): Draft => ({ value, occ: [] });

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

/** Whether a (normalized) paste enters the draft as a chip. */
export const shouldChip = (text: string): boolean =>
  lineCount(text) > CHIP_MAX_PLAIN_LINES || charCount(text) >= CHIP_MIN_CHARS;

/** "1 line", "14 lines": the one spelling of a line count, for the label and for the chip row. */
export const linesWord = (lines: number): string => `${lines} ${lines === 1 ? 'line' : 'lines'}`;

/** The label grammar: `[Pasted text #N +L lines]`. */
export const chipToken = (n: number, lines: number): string => `[Pasted text #${n} +${linesWord(lines)}]`;

/** Register a pasted text: the next number this draft has not used, and its label. Numbers run 1, 2, 3… with no gap,
 *  because the table only grows within a draft. */
export const addChip = (
  chips: PasteChips,
  text: string,
): { chips: PasteChips; n: number; token: string } => {
  const n = chips.size + 1;
  const lines = lineCount(text);
  const next = new Map(chips);
  next.set(n, { n, text, lines });
  return { chips: next, n, token: chipToken(n, lines) };
};

const textOf = (chips: PasteChips, n: number): string => chips.get(n)?.text ?? '';
const labelOf = (chips: PasteChips, n: number): string => {
  const chip = chips.get(n);
  return chip === undefined ? '' : chipToken(n, chip.lines);
};

/** The send payload before the send rules: every occurrence replaced by its chip's full text, in place. Text that only
 *  looks like a label stays as written. */
export const expandDraft = (draft: Draft, chips: PasteChips): string => {
  let out = '';
  let at = 0;
  for (const o of draft.occ) {
    out += draft.value.slice(at, o.start) + textOf(chips, o.n);
    at = o.end;
  }
  return out + draft.value.slice(at);
};

/** A live chip, as the composer's chip row lists it. `head` is the first non-blank line, trimmed, for the eye. */
export interface LiveChip extends PastedText {
  readonly head: string;
}

/** The chips with an occurrence in the draft, in draft order. */
export const liveChips = (draft: Draft, chips: PasteChips): LiveChip[] =>
  draft.occ.flatMap((o) => {
    const chip = chips.get(o.n);
    if (chip === undefined) return [];
    const head = chip.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
    return [{ ...chip, head }];
  });

/** Expand chip `n` in place: its label becomes its full text, ordinary editable text from then on. */
export const expandChip = (draft: Draft, n: number, chips: PasteChips): Plan | null => {
  const o = draft.occ.find((x) => x.n === n);
  return o === undefined ? null : { start: o.start, end: o.end, text: textOf(chips, n) };
};

/** Remove chip `n`: its label goes, with its text. */
export const removeChip = (draft: Draft, n: number): Plan | null => {
  const o = draft.occ.find((x) => x.n === n);
  return o === undefined ? null : { start: o.start, end: o.end, text: '' };
};

/** A paste of `text` (normalized) over [selStart, selEnd): a long text becomes the next chip, and its label is the
 *  insert; the plan is `planInput`'s when the paste touches a label, else the label goes in at the selection. `attach`
 *  is the new chip's occurrence where the plan puts its label: at the plan's end, after any chip text the plan keeps.
 *  A short paste that touches no label has no plan: the browser's own, as it always was. */
export const planPaste = (
  draft: Draft,
  selStart: number,
  selEnd: number,
  text: string,
  chips: PasteChips,
): { chips: PasteChips; plan: Plan | null; attach: Occurrence | null } => {
  if (!shouldChip(text)) {
    return { chips, plan: planInput(draft, selStart, selEnd, 'insertFromPaste', text, chips), attach: null };
  }
  const added = addChip(chips, text);
  const plan = planInput(draft, selStart, selEnd, 'insertFromPaste', added.token, added.chips)
    ?? { start: selStart, end: selEnd, text: added.token };
  const end = plan.start + plan.text.length;
  return { chips: added.chips, plan, attach: { n: added.n, start: end - added.token.length, end } };
};

/** The clipboard's text for a copy or cut of [start, end): the selection with every chip it touches given as that
 *  chip's full text. Null when it touches none, so the browser copies as it always has. */
export const selectionText = (draft: Draft, start: number, end: number, chips: PasteChips): string | null => {
  const touched = draft.occ.filter((o) => o.start < end && o.end > start);
  if (start === end || touched.length === 0) return null;
  let out = '';
  let at = start;
  for (const o of touched) {
    out += draft.value.slice(at, Math.max(at, o.start)) + textOf(chips, o.n);
    at = o.end;
  }
  return out + (at < end ? draft.value.slice(at, end) : '');
};

/** Plan an edit the browser is about to make, before it lands (a `beforeinput`, a paste, a cut). Null leaves it to the
 *  browser: it touches no label, or removes whole labels only. Otherwise the plan replaces the edit:
 *  - typing or pasting inside a label: the label becomes its full text, then what was typed;
 *  - Backspace (any backward delete) with the caret right after a label, or Delete with it right before one: the whole
 *    label goes, with its text; with the caret inside a label, the label becomes its full text and nothing is deleted;
 *  - a selection that starts or ends inside a label: that chip's text stays, the rest of the selection is replaced. */
export const planInput = (
  draft: Draft,
  selStart: number,
  selEnd: number,
  inputType: string,
  data: string | null,
  chips: PasteChips,
): Plan | null => {
  // An undo or redo carries no text and is no delete, so it is left to the browser below, as every insertion whose
  // text the event does not carry is.
  const isDelete = inputType.startsWith('delete');
  const insert = isDelete
    ? ''
    : inputType === 'insertLineBreak' || inputType === 'insertParagraph'
      ? '\n'
      : data;
  if (insert === null) return null; // an insertion whose text the event does not carry: repaired after it lands
  if (selStart !== selEnd) {
    const left = draft.occ.find((o) => o.start < selStart && selStart < o.end);
    const right = draft.occ.find((o) => o !== left && o.start < selEnd && selEnd < o.end);
    if (left === undefined && right === undefined) return null;
    const leftText = left === undefined ? '' : textOf(chips, left.n);
    // One label holding the whole selection: its text, then what was typed.
    if (left !== undefined && selEnd < left.end) return { start: left.start, end: left.end, text: leftText + insert };
    const rightText = right === undefined ? '' : textOf(chips, right.n);
    return { start: left?.start ?? selStart, end: right?.end ?? selEnd, text: leftText + insert + rightText };
  }
  const c = selStart;
  if (!isDelete) {
    const o = draft.occ.find((x) => x.start < c && c < x.end);
    return o === undefined ? null : { start: o.start, end: o.end, text: textOf(chips, o.n) + insert };
  }
  const backward = inputType.includes('Backward');
  const o = draft.occ.find((x) => (backward ? x.start < c && c <= x.end : x.start <= c && c < x.end));
  if (o === undefined) return null;
  const whole = backward ? c === o.end : c === o.start;
  return { start: o.start, end: o.end, text: whole ? '' : textOf(chips, o.n) };
};

/** A word delete (Ctrl+Backspace, Ctrl+Delete; Option on a Mac) with the caret at `caret`. With the caret touching or
 *  inside a label it is Backspace's or Delete's plan (`planInput`). Otherwise `range` is what the browser itself would
 *  delete (the composer asks the browser to extend its selection by a word; a textarea exposes no target range), and
 *  the plan is that of a selection over it: a label it reaches into keeps its text. Null leaves the delete to the
 *  browser: it removes no part of a label, or whole labels only. */
export const planWordDelete = (
  draft: Draft,
  caret: number,
  range: { readonly start: number; readonly end: number } | null,
  backward: boolean,
  chips: PasteChips,
): Plan | null => {
  const touching = planInput(draft, caret, caret, backward ? 'deleteContentBackward' : 'deleteContentForward', null, chips);
  if (touching !== null || range === null || range.start >= range.end) return touching;
  return planInput(draft, range.start, range.end, backward ? 'deleteContentBackward' : 'deleteContentForward', null, chips);
};

/** One edit, as a replacement of prev[start, prevEnd) by next[start, nextEnd). */
export interface Edit {
  readonly start: number;
  readonly prevEnd: number;
  readonly nextEnd: number;
}

const commonPrefix = (a: string, b: string, cap: number): number => {
  let i = 0;
  while (i < cap && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
};

/** Where `prev` became `next`. The caret after the edit marks its end in `next` (typing, a paste, Backspace and Delete
 *  all leave it there, and an undo or redo selects what it brought back), which places a repeated character where it
 *  was typed; when the caret cannot explain the change, the common prefix and suffix do. */
export const locateEdit = (prev: string, next: string, caret: number): Edit => {
  if (caret >= 0 && caret <= next.length) {
    const suffix = next.length - caret;
    if (suffix <= prev.length && prev.endsWith(next.slice(caret))) {
      const prevEnd = prev.length - suffix;
      const start = commonPrefix(prev, next, Math.min(caret, prevEnd));
      return { start, prevEnd, nextEnd: caret };
    }
  }
  const start = commonPrefix(prev, next, Math.min(prev.length, next.length));
  let suffix = 0;
  const room = Math.min(prev.length, next.length) - start;
  while (suffix < room && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) {
    suffix += 1;
  }
  return { start, prevEnd: prev.length - suffix, nextEnd: next.length - suffix };
};

/** How a change arrived: `attach` is the occurrence of the label the composer itself just inserted, where its plan put
 *  it; `edit` is the range the composer itself replaced, when it made the change, which places it exactly where text
 *  that starts like the text it replaces would mislead `locateEdit`; `repair: false` drops an occurrence the change
 *  broke instead of writing its text back (a change the composer cannot place: an undo or redo to a draft it never
 *  held, which the composer cancels before it lands, so this is the defence behind that). */
export interface ChangeHow {
  readonly attach?: Occurrence | null;
  readonly edit?: { readonly start: number; readonly end: number } | null;
  readonly repair?: boolean;
}

/** The edit `how.edit` names, when `next` is exactly `prev` with that range replaced. */
const statedEdit = (prev: string, next: string, how: ChangeHow): Edit | null => {
  const e = how.edit;
  if (e === undefined || e === null || e.start > e.end || e.end > prev.length) return null;
  const nextEnd = next.length - (prev.length - e.end);
  if (nextEnd < e.start) return null;
  if (next.slice(0, e.start) !== prev.slice(0, e.start) || next.slice(nextEnd) !== prev.slice(e.end)) return null;
  return { start: e.start, prevEnd: e.end, nextEnd };
};

/** The draft after the field changed from `prev.value` to `next`. Occurrences before the edit stay, those after it
 *  move with it, and those it removed whole are gone. An edit that broke a label without removing all of it (one
 *  `planInput` could not plan) is repaired: `repair` is the value and caret the composer must put back, with that
 *  label's full text where it stood, what the edit inserted kept beside it, and what it removed elsewhere removed. */
export const applyChange = (
  prev: Draft,
  next: string,
  caret: number,
  chips: PasteChips,
  how: ChangeHow = {},
): { draft: Draft; repair: { value: string; caret: number } | null } => {
  if (prev.value === next) return { draft: prev, repair: null };
  const { start, prevEnd, nextEnd } = statedEdit(prev.value, next, how) ?? locateEdit(prev.value, next, caret);
  const inserted = next.slice(start, nextEnd);
  const left = prev.occ.find((o) => o.start < start && start < o.end);
  const right = prev.occ.find((o) => o !== left && o.start < prevEnd && prevEnd < o.end);
  if ((left !== undefined || right !== undefined) && how.repair !== false) {
    const from = left?.start ?? start;
    const to = right?.end ?? (left !== undefined && prevEnd < left.end ? left.end : prevEnd);
    const head = prev.value.slice(0, from) + (left ? textOf(chips, left.n) : '') + inserted;
    const value = head + (right ? textOf(chips, right.n) : '') + prev.value.slice(to);
    const shift = value.length - prev.value.length;
    const occ = prev.occ
      .filter((o) => o.end <= from || o.start >= to)
      .map((o) => (o.start >= to ? { ...o, start: o.start + shift, end: o.end + shift } : o));
    return { draft: { value, occ }, repair: { value, caret: head.length } };
  }
  const delta = nextEnd - prevEnd;
  const occ: Occurrence[] = [];
  for (const o of prev.occ) {
    if (o.end <= start) occ.push(o);
    else if (o.start >= prevEnd) occ.push({ ...o, start: o.start + delta, end: o.end + delta });
    // else: the edit removed it whole
  }
  // The label the composer just inserted, at the position its plan put it: never found by its text.
  const a = how.attach;
  if (a !== undefined && a !== null && a.start >= start && a.end <= nextEnd && next.slice(a.start, a.end) === labelOf(chips, a.n)
    && !occ.some((o) => o.n === a.n || (o.start < a.end && a.start < o.end))) {
    occ.push(a);
  }
  occ.sort((x, y) => x.start - y.start);
  return { draft: { value: next, occ }, repair: null };
};

/** The drafts the field has held, oldest first, in the browser's undo order: every change the composer sees appends
 *  one, dropping those after `at`, as a new edit drops the browser's redo entries; an undo or redo moves `at`. Each
 *  keystroke is one entry, where the browser's undo takes a run of typing in one step, so a step looks for the nearest
 *  held draft whose value is the one the browser restored. */
export interface DraftLog {
  readonly drafts: readonly Draft[];
  readonly at: number;
}

/** How many drafts the log keeps; an undo past the oldest is cancelled (`canStep`). */
export const DRAFT_LOG_CAP = 1000;

export const startLog = (draft: Draft = emptyDraft()): DraftLog => ({ drafts: [draft], at: 0 });

/** The draft the log stands at. */
export const logDraft = (log: DraftLog): Draft => log.drafts[log.at] ?? emptyDraft();

/** A change that is no undo or redo: `draft` is held next, and nothing after it can be redone. */
export const logChange = (log: DraftLog, draft: Draft): DraftLog => {
  const drafts = [...log.drafts.slice(0, log.at + 1), draft];
  const over = Math.max(0, drafts.length - DRAFT_LOG_CAP);
  return { drafts: drafts.slice(over), at: drafts.length - 1 - over };
};

/** Whether the log holds a draft an undo (`back`) or a redo could bring back. */
export const canStep = (log: DraftLog, back: boolean): boolean => (back ? log.at > 0 : log.at < log.drafts.length - 1);

/** The browser's undo (`back`) or redo restored `value`: the log at the nearest held draft with exactly that value,
 *  before the current one for an undo and after it for a redo; its occurrences are where they were. Null when none
 *  is held. */
export const logStep = (log: DraftLog, value: string, back: boolean): DraftLog | null => {
  for (let j = back ? log.at - 1 : log.at + 1; back ? j >= 0 : j < log.drafts.length; j += back ? -1 : 1) {
    if (log.drafts[j]?.value === value) return { drafts: log.drafts, at: j };
  }
  return null;
};
