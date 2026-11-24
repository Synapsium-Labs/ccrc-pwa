// Paste chips, the decision (desktop-polish wave 169; Goals modification 90, second half). A long text paste enters
// the draft as a chip: its `[Pasted text #N +L lines]` label (no-break spaces) wrapped in two invisible markers, with
// the full text in a table beside the draft. This file pins the pure L1 half (`pwa/src/session/pasteChips.ts`): when a
// paste becomes a chip, the label grammar, the parse that is the chips' only identity (the coordinator's ruling on
// review 3480: the value carries it), the one expansion into the send payload byte for byte, the caret and selection
// kept off a chip's inside, the plans that keep an edit from breaking one, the inert markers an unplanned edit leaves
// and the user's Dismiss of them (review 3589: nothing is cleaned up on its own), and the clipboard's text. The composer half is `composer-paste-chips.test.tsx`; the browser half is `browser/paste-chips.browser.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  CHIP_CLOSE,
  CHIP_MAX_PLAIN_LINES,
  CHIP_MIN_CHARS,
  CHIP_OPEN,
  addChip,
  chipField,
  chipToken,
  coverChips,
  dismissPlan,
  emptyChips,
  expandChip,
  expandValue,
  inertMarkers,
  lineCount,
  linesWord,
  liveChips,
  normalizePaste,
  parseChips,
  planEdit,
  planPaste,
  removeChip,
  selectionText,
  shouldChip,
  snapSelection,
  stripMarkers,
  type PasteChips,
  type Plan,
} from '../src/session/pasteChips';

const long = (n: number, fill = 'a'): string => fill.repeat(n);
const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');
const apply = (value: string, p: Plan): string => value.slice(0, p.start) + p.text + value.slice(p.end);

/** A table holding `texts` as chips 1..n, and the field text of each. */
const table = (...texts: string[]): { chips: PasteChips; fields: string[] } => {
  let chips: PasteChips = emptyChips();
  const fields: string[] = [];
  for (const t of texts) {
    const a = addChip(chips, t, fields.length + 1);
    chips = a.chips;
    fields.push(a.field);
  }
  return { chips, fields };
};

describe('when a paste becomes a chip', () => {
  it('the floors are the brief’s: 800 characters, or more than 12 lines', () => {
    expect(CHIP_MIN_CHARS).toBe(800);
    expect(CHIP_MAX_PLAIN_LINES).toBe(12);
  });

  it('799 characters stays text; 800 is a chip', () => {
    expect(shouldChip(long(799))).toBe(false);
    expect(shouldChip(long(800))).toBe(true);
  });

  it('12 lines stays text; 13 lines is a chip', () => {
    expect(shouldChip(lines(12))).toBe(false);
    expect(shouldChip(lines(13))).toBe(true);
  });

  it('counts characters, not UTF-16 units: 799 emoji stay text', () => {
    expect(shouldChip('🙂'.repeat(799))).toBe(false);
    expect(shouldChip('🙂'.repeat(800))).toBe(true);
  });

  it('a paste of any length that holds a marker is a chip, so the marker never reaches the field as text', () => {
    expect(shouldChip(`a${CHIP_OPEN}b`)).toBe(true);
    expect(shouldChip(`${CHIP_CLOSE}`)).toBe(true);
  });

  it('counts lines as the field shows them, so a trailing newline is a line of its own', () => {
    expect(lineCount('a')).toBe(1);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('a\n')).toBe(2);
  });

  it('normalizes CR LF and a lone CR to LF, as the field does with a paste', () => {
    expect(normalizePaste('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});

describe('the label grammar, with one owner for the line count', () => {
  it('is the console’s, numbered, with the line count, its spaces no-break; in the field it sits between the markers', () => {
    expect(chipToken(1, 40)).toBe('[Pasted\u00a0text\u00a0#1\u00a0+40\u00a0lines]');
    expect(chipToken(3, 1).replace(/\u00a0/g, ' ')).toBe('[Pasted text #3 +1 line]');
    expect(chipToken(3, 1)).not.toContain(' ');
    expect(linesWord(1)).toBe('1 line');
    expect(linesWord(2)).toBe('2 lines');
    expect(chipField(2, 5)).toBe(`\u2062${chipToken(2, 5)}\u2063`);
    expect([CHIP_OPEN, CHIP_CLOSE]).toEqual(['\u2062', '\u2063']);
  });

  it('a chip takes the number it is given (the composer’s counter, never reset)', () => {
    const a = addChip(emptyChips(), long(900), 7);
    expect(a.field).toBe(chipField(7, 1));
    expect(a.chips.get(7)?.text).toBe(long(900));
    expect(planPaste('', a.chips, 0, 0, lines(20), 8).plan?.text).toBe(chipField(8, 20));
  });
});

describe('the parse is the only identity', () => {
  it('a wrapped label the table holds is a chip, at its span', () => {
    const { chips, fields } = table(lines(14));
    const value = `a${fields[0]}b`;
    expect(parseChips(value, chips)).toEqual([{ n: 1, start: 1, end: 1 + fields[0]!.length }]);
  });

  it('a label without both markers is text, whatever it says, with ordinary or no-break spaces', () => {
    const { chips } = table(lines(14));
    const bare = chipToken(1, 14);
    expect(parseChips(`${CHIP_OPEN}[Pasted text #1 +14 lines]${CHIP_CLOSE}`, chips)).toEqual([]);
    expect(parseChips(bare, chips)).toEqual([]);
    expect(parseChips(`${CHIP_OPEN}${bare}`, chips)).toEqual([]);
    expect(parseChips(`${bare}${CHIP_CLOSE}`, chips)).toEqual([]);
    expect(expandValue(bare, chips)).toBe(bare);
  });

  it('a wrapped label the table does not hold, or with another line count, is not a chip', () => {
    const { chips } = table(lines(14));
    expect(parseChips(chipField(2, 14), chips)).toEqual([]);
    expect(parseChips(chipField(1, 13), chips)).toEqual([]);
  });

  it('a chip that comes back whole is a chip, twice too: each expands to its text and the row lists both (review 3589 F3)', () => {
    const t = lines(14);
    const { chips, fields } = table(t);
    const value = `${fields[0]} ${fields[0]}`;
    expect(parseChips(value, chips).map((s) => s.start)).toEqual([0, fields[0]!.length + 1]);
    expect(expandValue(value, chips)).toBe(`${t} ${t}`);
    expect(liveChips(value, chips).map((c) => [c.n, c.at])).toEqual([[1, 0], [1, fields[0]!.length + 1]]);
  });

  it('a hand-typed copy of a live label beside the real chip is text (review 3480 F3)', () => {
    const t = lines(14);
    const { chips, fields } = table(t);
    const value = `${fields[0]} ${chipToken(1, 14)}`;
    expect(liveChips(value, chips).map((c) => c.n)).toEqual([1]);
    expect(expandValue(value, chips)).toBe(`${t} ${chipToken(1, 14)}`);
  });

  it('the chip row lists the parsed chips in field order, with each text’s first non-blank line', () => {
    const { chips, fields } = table(`\n  first\nsecond\n${lines(12)}`, lines(20, 'z'));
    expect(liveChips(`${fields[1]}x${fields[0]}`, chips).map((c) => [c.n, c.head])).toEqual([[2, 'z 1'], [1, 'first']]);
  });
});

describe('one expansion into the send payload, byte for byte', () => {
  it('one chip', () => {
    const text = long(900, 'q');
    const { chips, fields } = table(text);
    expect(expandValue(fields[0]!, chips)).toBe(text);
  });

  it('several chips among typed text, in their places', () => {
    const t1 = lines(20);
    const t2 = long(850, 'z');
    const { chips, fields } = table(t1, t2);
    expect(expandValue(`before ${fields[0]} middle ${fields[1]} after`, chips)).toBe(`before ${t1} middle ${t2} after`);
  });

  it('tabs, blank lines and edge whitespace inside a chip are kept: the payload is the text as pasted', () => {
    const text = `\n\t a\t\n\n${lines(13)}  \n`;
    const { chips, fields } = table(text);
    expect(expandValue(`x${fields[0]}y`, chips)).toBe(`x${text}y`);
  });

  it('the field’s own markers are stripped; a pasted text goes out byte for byte, its own markers included (A3)', () => {
    const text = `a${CHIP_OPEN}b${lines(13)}`;
    const { chips, fields } = table(text);
    expect(expandValue(`${CHIP_CLOSE}x${fields[0]}y${CHIP_OPEN}`, chips)).toBe(`x${text}y`);
    expect(stripMarkers(`a${CHIP_OPEN}b${CHIP_CLOSE}`)).toBe('ab');
  });

  it('a label inside a pasted text stays literal', () => {
    const inner = `see ${chipToken(1, 13)} here\n${lines(13)}`;
    const { chips, fields } = table(lines(13), inner);
    expect(expandValue(`${fields[0]}${fields[1]}`, chips)).toBe(`${lines(13)}${inner}`);
  });
});

describe('expand and remove', () => {
  it('Expand plans the chip’s text, without markers, over its span', () => {
    const t = `${lines(13)}${CHIP_OPEN}`;
    const { chips, fields } = table(t);
    const value = `a${fields[0]}b`;
    expect(apply(value, expandChip(value, 1, chips)!)).toBe(`a${lines(13)}b`);
    expect(expandChip(value, 0, chips)).toBeNull(); // named by where it starts
  });

  it('Remove plans the span away; the table keeps the text', () => {
    const { chips, fields } = table(lines(13));
    const value = `a${fields[0]}b`;
    expect(apply(value, removeChip(value, 1, chips)!)).toBe('ab');
    // One number twice: each act takes the one it names.
    const two = `${fields[0]}x${fields[0]}`;
    expect(apply(two, removeChip(two, fields[0]!.length + 1, chips)!)).toBe(`${fields[0]}x`);
    expect(chips.get(1)?.text).toBe(lines(13));
  });

  it('a chip the field does not show has no plan', () => {
    const { chips } = table(lines(13));
    expect(expandChip('ab', 1, chips)).toBeNull();
    expect(removeChip('ab', 1, chips)).toBeNull();
  });
});

describe('a caret never rests inside a chip, and a selection covers it whole', () => {
  const { chips, fields } = table(lines(14));
  const f = fields[0]!;
  const value = `ab${f}cd`;
  const s = 2;
  const e = 2 + f.length;
  const at = (p: number) => ({ anchor: p, focus: p });

  it('a key moving right into a chip carries the caret to its end; moving left, to its start', () => {
    expect(snapSelection(value, chips, at(s + 1), s, false)).toEqual(at(e));
    expect(snapSelection(value, chips, at(e - 1), e, false)).toEqual(at(s));
    expect(snapSelection(value, chips, at(s + 9), s - 5, false)).toEqual(at(e)); // a line move from above
  });

  it('a pointer takes the nearer side', () => {
    expect(snapSelection(value, chips, at(s + 3), 0, true)).toEqual(at(s));
    expect(snapSelection(value, chips, at(e - 3), 0, true)).toEqual(at(e));
  });

  it('a caret at either edge or outside stays', () => {
    for (const p of [0, s, e, value.length]) expect(snapSelection(value, chips, at(p), 0, false)).toEqual(at(p));
  });

  it('shift-arrow from the start covers the chip, and back again collapses to where it began', () => {
    const grown = snapSelection(value, chips, { anchor: s, focus: s + 1 }, s, false);
    expect(grown).toEqual({ anchor: s, focus: e });
    expect(snapSelection(value, chips, { anchor: s, focus: e - 1 }, e, false)).toEqual({ anchor: s, focus: s });
  });

  it('a selection whose anchor is inside a chip covers the chip', () => {
    expect(snapSelection(value, chips, { anchor: s + 4, focus: value.length }, value.length, false)).toEqual({ anchor: s, focus: value.length });
    expect(snapSelection(value, chips, { anchor: s + 4, focus: 0 }, 0, false)).toEqual({ anchor: e, focus: 0 });
  });

  it('coverChips widens a range to the chips it touches part of; a caret inside one stands at its end', () => {
    expect(coverChips(value, chips, 0, s + 3)).toEqual({ start: 0, end: e });
    expect(coverChips(value, chips, s + 3, value.length)).toEqual({ start: s, end: value.length });
    expect(coverChips(value, chips, 0, 1)).toEqual({ start: 0, end: 1 });
    expect(coverChips(value, chips, s + 3, s + 3)).toEqual({ start: e, end: e });
    expect(coverChips(value, chips, s, s)).toEqual({ start: s, end: s });
  });

  it('a key steps over an inert marker as if it were not there; a pointer does not', () => {
    const v = `ab${CHIP_OPEN}cd`; // an inert marker at 2
    expect(snapSelection(v, chips, at(3), 2, false)).toEqual(at(4)); // right across the marker: on over `c`
    expect(snapSelection(v, chips, at(2), 3, false)).toEqual(at(1)); // left across it: on over `b`
    expect(snapSelection(v, chips, at(4), 3, false)).toEqual(at(4)); // an ordinary step stays
    expect(snapSelection(v, chips, at(3), 0, true)).toEqual(at(3));
    const w = `a${CHIP_CLOSE}${CHIP_OPEN}b`; // two in a row
    expect(snapSelection(w, chips, at(2), 1, false)).toEqual(at(4));
  });
});

describe('a paste over a selection replaces whole chips and inserts its own (review 3480 F1)', () => {
  it('from plain text into a chip: the chip goes whole and the new chip is the paste', () => {
    const t1 = lines(14, 'one');
    const t2 = lines(20, 'two');
    const { chips, fields } = table(t1);
    const value = `a${fields[0]}b`;
    const p = planPaste(value, chips, 0, 5, t2, 2);
    const next = apply(value, p.plan!);
    expect(next).toBe(`${chipField(2, 20)}b`);
    expect(expandValue(next, p.chips)).toBe(`${t2}b`);
  });

  it('from one chip into another', () => {
    const t1 = lines(14, 'one');
    const t2 = lines(15, 'two');
    const t3 = lines(16, 'three');
    const { chips, fields } = table(t1, t2);
    const value = `a${fields[0]}m${fields[1]}b`;
    const p = planPaste(value, chips, 5, 1 + fields[0]!.length + 1 + 5, t3, 3);
    const next = apply(value, p.plan!);
    expect(next).toBe(`a${chipField(3, 16)}b`);
    expect(expandValue(next, p.chips)).toBe(`a${t3}b`);
  });

  it('a short paste over part of a chip replaces the whole chip with the text', () => {
    const { chips, fields } = table(lines(14));
    const value = `a${fields[0]}b`;
    expect(apply(value, planPaste(value, chips, 3, 4, 'hi', 2).plan!)).toBe('ahib');
  });

  it('a short paste that touches no chip is the browser’s own', () => {
    const { chips, fields } = table(lines(14));
    expect(planPaste(`a${fields[0]}b`, chips, 0, 1, 'hi', 2).plan).toBeNull();
  });

  it('a paste with no text plans nothing, even over part of a chip (review 3589 A2)', () => {
    const { chips, fields } = table(lines(14));
    const p = planPaste(`a${fields[0]}b`, chips, 0, 4, '', 2);
    expect(p).toEqual({ chips, plan: null, added: false });
  });

  it('a short paste holding a marker is a chip, its text untouched in the table', () => {
    const text = `x${CHIP_CLOSE}y`;
    const p = planPaste('', emptyChips(), 0, 0, text, 1);
    expect(p.plan?.text).toBe(chipField(1, 1));
    expect(p.added).toBe(true);
    expect(p.chips.get(1)?.text).toBe(text);
  });

  it('a long paste with the caret inside a chip goes in after it', () => {
    const { chips, fields } = table(lines(14));
    const value = `a${fields[0]}b`;
    expect(apply(value, planPaste(value, chips, 4, 4, lines(20), 2).plan!)).toBe(`a${fields[0]}${chipField(2, 20)}b`);
  });
});

describe('edits that touch a chip are planned whole (rule 5)', () => {
  const t = lines(14);
  const { chips, fields } = table(t);
  const f = fields[0]!;
  const value = `a${f}b`;
  const e = 1 + f.length;

  it('Backspace right after a chip, and Delete right before one, take the whole chip', () => {
    expect(apply(value, planEdit(value, chips, e, e, 'deleteContentBackward', null)!)).toBe('ab');
    expect(apply(value, planEdit(value, chips, 1, 1, 'deleteContentForward', null)!)).toBe('ab');
  });

  it('a word delete reaching into a chip takes the whole chip; with no word range, one beside a chip does', () => {
    expect(apply(value, planEdit(value, chips, e, e, 'deleteWordBackward', null, { start: e - 7, end: e })!)).toBe('ab');
    expect(apply(value, planEdit(value, chips, 1, 1, 'deleteWordForward', null, { start: 1, end: 9 })!)).toBe('ab');
    expect(apply(value, planEdit(value, chips, e, e, 'deleteWordBackward', null, null)!)).toBe('ab');
  });

  it('a word delete that touches no chip is the browser’s own', () => {
    const v = `${f} two words`;
    expect(planEdit(v, chips, v.length, v.length, 'deleteWordBackward', null, { start: v.length - 5, end: v.length })).toBeNull();
  });

  it('typing `[` over a fully selected chip replaces it with `[`; so does a short paste starting with one (review 3480 F2)', () => {
    // The selection covers the chip whole, so the browser's own edit is the right one: no plan, nothing revived.
    expect(planEdit(value, chips, 1, e, 'insertText', '[')).toBeNull();
    expect(apply(value, { start: 1, end: e, text: '[' })).toBe('a[b');
    expect(expandValue('a[b', chips)).toBe('a[b');
    expect(planPaste(value, chips, 1, e, '[short', 2).plan).toBeNull();
  });

  it('typing over a selection ending inside a chip replaces the whole chip', () => {
    expect(apply(value, planEdit(value, chips, 0, 4, 'insertText', '[')!)).toBe('[b');
    expect(apply(value, planEdit(value, chips, 0, 4, 'deleteContentBackward', null)!)).toBe('b');
  });

  it('typed text loses its markers, at a caret and over a selection', () => {
    expect(planEdit('ab', emptyChips(), 1, 1, 'insertText', `x${CHIP_OPEN}y`)).toEqual({ start: 1, end: 1, text: 'xy' });
    expect(planEdit('ab', emptyChips(), 0, 1, 'insertText', `x${CHIP_OPEN}y`)).toEqual({ start: 0, end: 1, text: 'xy' });
  });

  it('every other insert lands natively, a whole chip in its data included, and the parse decides (review 3589 F3)', () => {
    for (const kind of ['insertFromYank', 'insertFromDrop', 'insertReplacementText', 'insertFromPaste']) {
      expect(planEdit(value, chips, e, e, kind, f), kind).toBeNull();
      expect(planEdit(value, chips, e, e, kind, null), kind).toBeNull();
    }
    expect(parseChips(`${value}${f}`, chips)).toHaveLength(2);
  });

  it('a caret inside a chip (before the snap) stands at its end: a key goes in after it, a delete takes it', () => {
    expect(apply(value, planEdit(value, chips, 4, 4, 'insertText', 'x')!)).toBe(`a${f}xb`);
    expect(apply(value, planEdit(value, chips, 4, 4, 'deleteContentBackward', null)!)).toBe('ab');
    expect(apply(value, planEdit(value, chips, 4, 4, 'deleteContentForward', null)!)).toBe('ab');
    expect(apply(value, planEdit(value, chips, 4, 4, 'deleteWordForward', null, { start: 4, end: 9 })!)).toBe('ab');
  });

  it('line deletes, undo, redo and keys away from a chip are left to the browser (review 3480 F5)', () => {
    expect(planEdit(value, chips, e, e, 'deleteSoftLineBackward', null)).toBeNull();
    expect(planEdit(value, chips, e, e, 'deleteHardLineBackward', null)).toBeNull();
    expect(planEdit(value, chips, e, e, 'historyUndo', null)).toBeNull();
    expect(planEdit(value, chips, 0, 0, 'insertText', 'x')).toBeNull();
    expect(planEdit(value, chips, 0, 0, 'deleteContentForward', null)).toBeNull();
  });
});

describe('what an unplanned edit leaves behind is inert, and only the user’s Dismiss removes it (review 3589)', () => {
  const t = lines(14);
  const { chips, fields } = table(t);
  const f = fields[0]!;

  it('a clean value has no inert marker', () => {
    expect(inertMarkers(`a${f}b`, chips)).toEqual([]);
    expect(inertMarkers('plain', chips)).toEqual([]);
    expect(dismissPlan(`a${f}b`, chips)).toBeNull();
  });

  it('text dropped inside a label: both markers are inert, no chip, and the field’s text goes out as it shows', () => {
    const v = `a${f.slice(0, 5)}XY${f.slice(5)}b`;
    expect(parseChips(v, chips)).toEqual([]);
    expect(inertMarkers(v, chips)).toEqual([1, v.length - 2]);
    expect(expandValue(v, chips)).toBe(stripMarkers(v));
  });

  it('Dismiss takes out the inert markers as one edit and keeps every other character, label-shaped ones too (F4)', () => {
    const v = `a${f.slice(0, 5)}2024 report ${f.slice(5)}b`;
    const plan = dismissPlan(v, chips)!;
    expect(apply(v, plan)).toBe(stripMarkers(v));
    expect(apply(v, plan)).toContain('2024 report ');
  });

  it('Dismiss leaves a whole chip beside the break as it is', () => {
    const v = `${CHIP_OPEN}x${f}y${CHIP_CLOSE}`;
    expect(inertMarkers(v, chips)).toEqual([0, v.length - 1]);
    expect(apply(v, dismissPlan(v, chips)!)).toBe(`x${f}y`);
  });

  it('a wrapped label the table does not hold is inert, and sends as the label it shows', () => {
    const v = `x${chipField(7, 3)}y`;
    expect(inertMarkers(v, chips)).toEqual([1, v.length - 2]);
    expect(expandValue(v, chips)).toBe(`x${chipToken(7, 3)}y`);
  });
});

describe('the clipboard gets the full text, never a label', () => {
  const t = lines(14);
  const { chips, fields } = table(t);
  const value = `a${fields[0]}b`;

  it('a selection holding a chip', () => {
    expect(selectionText(value, chips, 0, value.length)).toBe(`a${t}b`);
  });

  it('a selection holding part of a chip gives the whole chip’s text (review 3480 A1)', () => {
    expect(selectionText(value, chips, 0, 4)).toBe(`a${t}`);
  });

  it('a selection with no chip and no marker is the browser’s own', () => {
    expect(selectionText(value, chips, 0, 1)).toBeNull();
    expect(selectionText(value, chips, 2, 2)).toBeNull();
  });
});
