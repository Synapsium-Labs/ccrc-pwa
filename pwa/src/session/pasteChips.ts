// Paste chips — the decision (desktop-polish wave 169; Goals modification 90, second half). Ring L1, context C3
// (Session Conversation): pure functions over strings, no DOM and no React. `Composer.tsx` renders and acts on what
// these return, and decides nothing itself.
//
// A text paste of `CHIP_MIN_CHARS` characters or more, or of more than `CHIP_MAX_PLAIN_LINES` lines, enters the draft
// as a token, `[Pasted text #N +L lines]`, at the caret, in the style Claude Code's own input box uses. The full text
// is kept beside the draft in a `PasteChips` table keyed by N, and the token's position in the draft IS the text's
// position: there is no second index to drift. Sending expands every token back to its text, byte for byte
// (`expandDraft`), and only then applies the composer's existing send rules (the whole-message trim and the
// whitespace-only guard), unchanged.
//
// Never lose pasted text silently:
// - The table only grows within a draft. A token removed from the field (Backspace, Remove, a cut, the browser's undo)
//   keeps its text, so the same token coming back (redo, undo of a remove, a paste of the cut) still expands. The
//   composer starts a new table only when a send empties the field.
// - An edit that breaks a token without removing all of it (a character typed or deleted inside it, a selection that
//   starts or ends inside it) puts the full text back where the token stood (`reconcileEdit`).
//
// Known limits, by design: a token is recognised by its exact text, so a short paste that happens to be the literal
// text of a live token, or a pasted text that contains one and is later expanded into the draft, reads as that chip.
/** A paste this long (in characters, i.e. code points) becomes a chip: the floor Claude Code's own input box chips at,
 *  which the server meets when it types a long prompt (paste-reliability note §5). */
export const CHIP_MIN_CHARS = 800;
/** A paste of more lines than this becomes a chip, whatever its length. */
export const CHIP_MAX_PLAIN_LINES = 12;

/** One pasted text the draft holds. `lines` is part of the token, so it is stored, not recounted. */
export interface PastedText {
  readonly n: number;
  readonly text: string;
  readonly lines: number;
}

/** Every pasted text this draft has held, by number. Append-only within a draft (header). */
export type PasteChips = ReadonlyMap<number, PastedText>;

/** A token's place in a draft: [start, end) in UTF-16 units, as the field's selection reads. */
export interface TokenSpan {
  readonly n: number;
  readonly start: number;
  readonly end: number;
}

/** A draft value and where the caret goes after a change the composer made. */
export interface DraftEdit {
  readonly value: string;
  readonly caret: number;
}

export const emptyChips = (): PasteChips => new Map();

/** The text as the field would have held it had the paste gone in as typing: CR LF and a lone CR read as LF. */
export const normalizePaste = (raw: string): string => raw.replace(/\r\n?/g, '\n');

/** Lines as the field shows them: a trailing newline opens a line of its own. */
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

/** The token grammar: `[Pasted text #N +L lines]`, with `line` for one. */
export const chipToken = (n: number, lines: number): string =>
  `[Pasted text #${n} +${lines} ${lines === 1 ? 'line' : 'lines'}]`;

const TOKEN_RE = /\[Pasted text #(\d+) \+(\d+) lines?\]/;

/** Register a pasted text: the next number this draft has not used, and its token. */
export const addChip = (
  chips: PasteChips,
  text: string,
): { chips: PasteChips; n: number; token: string } => {
  // Numbers run 1, 2, 3… with no gap, because the table only grows within a draft: the next one is its size plus one.
  const n = chips.size + 1;
  const lines = lineCount(text);
  const next = new Map(chips);
  next.set(n, { n, text, lines });
  return { chips: next, n, token: chipToken(n, lines) };
};

/** Every token in `value` this draft issued, in order. A token-shaped string with a number nobody issued, or with a
 *  line count that is not the issued one, is ordinary text. */
export const findTokens = (value: string, chips: PasteChips): TokenSpan[] => {
  if (chips.size === 0) return [];
  const out: TokenSpan[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  for (let m = re.exec(value); m !== null; m = re.exec(value)) {
    const n = Number(m[1]);
    const chip = chips.get(n);
    if (chip === undefined || m[0] !== chipToken(n, chip.lines)) continue;
    out.push({ n, start: m.index, end: m.index + m[0].length });
  }
  return out;
};

const textOf = (chips: PasteChips, n: number): string => chips.get(n)?.text ?? '';

/** Replace the given spans of `value` (sorted, disjoint) with `by(span)`. */
const replaceSpans = (value: string, spans: readonly TokenSpan[], by: (s: TokenSpan) => string): string => {
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += value.slice(at, s.start) + by(s);
    at = s.end;
  }
  return out + value.slice(at);
};

/** The send payload before the send rules: every token replaced by its full text at its position, in one pass (a
 *  token inside a pasted text is never expanded a second time). */
export const expandDraft = (value: string, chips: PasteChips): string =>
  replaceSpans(value, findTokens(value, chips), (s) => textOf(chips, s.n));

/** Expand chip `n` in place: every copy of its token becomes its full text, ordinary editable text from then on. The
 *  caret goes after the first expansion. */
export const expandChip = (value: string, n: number, chips: PasteChips): DraftEdit => {
  const spans = findTokens(value, chips).filter((s) => s.n === n);
  const first = spans[0];
  if (first === undefined) return { value, caret: value.length };
  const text = textOf(chips, n);
  return { value: replaceSpans(value, spans, () => text), caret: first.start + text.length };
};

/** Remove chip `n`: every copy of its token goes, with its text. The caret goes where the first stood. */
export const removeChip = (value: string, n: number, chips: PasteChips): DraftEdit => {
  const spans = findTokens(value, chips).filter((s) => s.n === n);
  const first = spans[0];
  if (first === undefined) return { value, caret: value.length };
  return { value: replaceSpans(value, spans, () => ''), caret: first.start };
};

/** A live chip, as the composer's chip row lists it. `head` is the first non-blank line, trimmed, for the eye. */
export interface LiveChip extends PastedText {
  readonly head: string;
}

/** The chips whose token stands in `value`, each once, in draft order. */
export const liveChips = (value: string, chips: PasteChips): LiveChip[] => {
  const seen = new Set<number>();
  const out: LiveChip[] = [];
  for (const s of findTokens(value, chips)) {
    if (seen.has(s.n)) continue;
    seen.add(s.n);
    const chip = chips.get(s.n);
    if (chip === undefined) continue;
    const head = chip.text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
    out.push({ ...chip, head });
  }
  return out;
};

/** The whole token a Backspace (caret right after it) or a Delete (caret right before it) takes, or null to leave the
 *  key to the browser: a selection, or a caret not against a token. */
export const tokenToRemove = (
  value: string,
  selStart: number,
  selEnd: number,
  key: 'Backspace' | 'Delete',
  chips: PasteChips,
): TokenSpan | null => {
  if (selStart !== selEnd) return null;
  const spans = findTokens(value, chips);
  return spans.find((s) => (key === 'Backspace' ? s.end === selStart : s.start === selStart)) ?? null;
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
 *  all leave it there), which places a repeated character where it was typed; when the caret cannot explain the
 *  change, the common prefix and suffix do. */
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

/** Recover a token the edit broke. An edit that starts or ends strictly inside a token, or types inside one, gives the
 *  draft the token's full text in its place: what the edit inserted is kept (after the text when the edit began inside
 *  the token, before it when it began outside), what it removed outside tokens stays removed, and the token's own
 *  characters are what is let go. Null when the edit touched no token partially: the composer takes `next` as it is.
 *  A token wholly inside the removed range was removed on purpose and is not recovered here (its text stays in the
 *  table). */
export const reconcileEdit = (
  prev: string,
  next: string,
  caret: number,
  chips: PasteChips,
): DraftEdit | null => {
  const spans = findTokens(prev, chips);
  if (spans.length === 0 || prev === next) return null;
  const { start, prevEnd, nextEnd } = locateEdit(prev, next, caret);
  const inside = (s: TokenSpan, at: number): boolean => s.start < at && at < s.end;
  const left = spans.find((s) => inside(s, start));
  const right = spans.find((s) => s !== left && inside(s, prevEnd));
  if (left === undefined && right === undefined) return null;
  const from = left?.start ?? start;
  const to = right?.end ?? (left !== undefined && prevEnd < left.end ? left.end : prevEnd);
  const head = prev.slice(0, from) + (left ? textOf(chips, left.n) : '') + next.slice(start, nextEnd);
  return { value: head + (right ? textOf(chips, right.n) : '') + prev.slice(to), caret: head.length };
};
