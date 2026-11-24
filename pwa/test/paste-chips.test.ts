// Paste chips, the decision (desktop-polish wave 169; Goals modification 90, second half). A long text paste enters
// the draft as a chip: its `[Pasted text #N +L lines]` label wrapped in two invisible markers, with the full text in a
// table beside the draft. This file pins the pure L1 half (`pwa/src/session/pasteChips.ts`): when a paste becomes a
// chip, the label grammar, the parse that is the chips' only identity (the coordinator's ruling on review 3480: the
// value carries it), the one expansion into the send payload byte for byte, the caret and selection kept off a chip's
// inside, the plans that keep an edit from breaking one, the clean-up of one that lands anyway, and the clipboard's
// text. The composer half is `composer-paste-chips.test.tsx`; the browser half is `browser/paste-chips.browser.test.ts`.
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
  emptyChips,
  expandChip,
  expandValue,
  lineCount,
  linesWord,
  liveChips,
  normalizePaste,
  parseChips,
  planEdit,
  planPaste,
  removeChip,
  removeRanges,
  selectionText,
  shouldChip,
  snapSelection,
  strayRanges,
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
    const a = addChip(chips, t);
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
  it('is the console’s, numbered, with the line count; in the field it sits between the two markers', () => {
    expect(chipToken(1, 40)).toBe('[Pasted text #1 +40 lines]');
    expect(chipToken(3, 1)).toBe('[Pasted text #3 +1 line]');
    expect(linesWord(1)).toBe('1 line');
    expect(linesWord(2)).toBe('2 lines');
    expect(chipField(2, 5)).toBe('⁢[Pasted text #2 +5 lines]⁣');
  });

  it('numbers chips per draft from 1 and never reuses a number', () => {
    const a = addChip(emptyChips(), long(900));
    expect(a.n).toBe(1);
    const b = addChip(a.chips, lines(20));
    expect(b.n).toBe(2);
    expect(b.field).toBe(chipField(2, 20));
    // The table keeps every text, so the next number follows the highest held.
    expect(addChip(b.chips, long(1000)).n).toBe(3);
  });
});

describe('the parse is the only identity', () => {
  it('a wrapped label the table holds is a chip, at its span', () => {
    const { chips, fields } = table(lines(14));
    const value = `a${fields[0]}b`;
    expect(parseChips(value, chips)).toEqual([{ n: 1, start: 1, end: 1 + fields[0]!.length }]);
  });

  it('a label without both markers is text, whatever it says', () => {
    const { chips } = table(lines(14));
    const bare = chipToken(1, 14);
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

  it('a number is one chip: a second wrapped copy of the same label is not', () => {
    const { chips, fields } = table(lines(14));
    expect(parseChips(`${fields[0]} ${fields[0]}`, chips).map((s) => s.start)).toEqual([0]);
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

  it('every marker is stripped after the chips are expanded, a pasted text’s own included', () => {
    const text = `a${CHIP_OPEN}b${lines(13)}`;
    const { chips, fields } = table(text);
    expect(expandValue(`${CHIP_CLOSE}${fields[0]}${CHIP_OPEN}`, chips)).toBe(stripMarkers(text));
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
  });

  it('Remove plans the span away; the table keeps the text', () => {
    const { chips, fields } = table(lines(13));
    const value = `a${fields[0]}b`;
    expect(apply(value, removeChip(value, 1, chips)!)).toBe('ab');
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

  it('coverChips widens a range to the chips it touches part of', () => {
    expect(coverChips(value, chips, 0, s + 3)).toEqual({ start: 0, end: e });
    expect(coverChips(value, chips, s + 3, value.length)).toEqual({ start: s, end: value.length });
    expect(coverChips(value, chips, 0, 1)).toEqual({ start: 0, end: 1 });
  });
});

describe('a paste over a selection replaces whole chips and inserts its own (review 3480 F1)', () => {
  it('from plain text into a chip: the chip goes whole and the new chip is the paste', () => {
    const t1 = lines(14, 'one');
    const t2 = lines(20, 'two');
    const { chips, fields } = table(t1);
    const value = `a${fields[0]}b`;
    const p = planPaste(value, chips, 0, 5, t2);
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
    const p = planPaste(value, chips, 5, 1 + fields[0]!.length + 1 + 5, t3);
    const next = apply(value, p.plan!);
    expect(next).toBe(`a${chipField(3, 16)}b`);
    expect(expandValue(next, p.chips)).toBe(`a${t3}b`);
  });

  it('a short paste over part of a chip replaces the whole chip with the text', () => {
    const { chips, fields } = table(lines(14));
    const value = `a${fields[0]}b`;
    expect(apply(value, planPaste(value, chips, 3, 4, 'hi').plan!)).toBe('ahib');
  });

  it('a short paste that touches no chip is the browser’s own', () => {
    const { chips, fields } = table(lines(14));
    expect(planPaste(`a${fields[0]}b`, chips, 0, 1, 'hi').plan).toBeNull();
  });

  it('a short paste holding a marker is a chip, its text untouched in the table', () => {
    const text = `x${CHIP_CLOSE}y`;
    const p = planPaste('', emptyChips(), 0, 0, text);
    expect(p.plan?.text).toBe(chipField(1, 1));
    expect(p.chips.get(1)?.text).toBe(text);
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
    expect(planPaste(value, chips, 1, e, '[short').plan).toBeNull();
  });

  it('typing over a selection ending inside a chip replaces the whole chip', () => {
    expect(apply(value, planEdit(value, chips, 0, 4, 'insertText', '[')!)).toBe('[b');
    expect(apply(value, planEdit(value, chips, 0, 4, 'deleteContentBackward', null)!)).toBe('b');
  });

  it('typed text loses its markers', () => {
    expect(planEdit('ab', emptyChips(), 1, 1, 'insertText', `x${CHIP_OPEN}y`)).toEqual({ start: 1, end: 1, text: 'xy' });
  });

  it('line deletes, undo, redo and keys away from a chip are left to the browser (review 3480 F5)', () => {
    expect(planEdit(value, chips, e, e, 'deleteSoftLineBackward', null)).toBeNull();
    expect(planEdit(value, chips, e, e, 'deleteHardLineBackward', null)).toBeNull();
    expect(planEdit(value, chips, e, e, 'historyUndo', null)).toBeNull();
    expect(planEdit(value, chips, 0, 0, 'insertText', 'x')).toBeNull();
    expect(planEdit(value, chips, 0, 0, 'deleteContentForward', null)).toBeNull();
  });
});

describe('what an unplanned edit leaves behind is cleaned up (rule 7)', () => {
  const t = lines(14);
  const { chips, fields } = table(t);
  const f = fields[0]!;
  const clean = (v: string): string => removeRanges(v, strayRanges(v, chips), 0).value;

  it('a clean value has nothing to clean', () => {
    expect(strayRanges(`a${f}b`, chips)).toEqual([]);
    expect(strayRanges('plain', chips)).toEqual([]);
  });

  it('text dropped inside a label: the broken chip goes, label and markers, and the dropped text stays', () => {
    const v = `a${f.slice(0, 5)}XY${f.slice(5)}b`;
    expect(clean(v)).toBe('aXYb');
    expect(expandValue(clean(v), chips)).toBe('aXYb');
  });

  it('a line delete that took the opening marker and the label’s start: the rest of the label goes', () => {
    expect(clean(`${f.slice(12)}yy`)).toBe('yy');
  });

  it('one that took the end: the start goes', () => {
    expect(clean(`xx${f.slice(0, 9)}`)).toBe('xx');
  });

  it('a lone marker typed by an input method goes alone', () => {
    expect(clean(`ab${CHIP_OPEN}cd${CHIP_CLOSE}`)).toBe('abcd');
  });

  it('a wrapped label the table does not hold goes whole, so no label is sent without its text', () => {
    expect(clean(`x${chipField(7, 3)}y`)).toBe('xy');
    expect(clean(`x${chipField(1, 14)}y`)).toBe(`x${f}y`); // the live one stays
    expect(clean(`${f}${f}`)).toBe(f);
  });

  it('the clean-up never touches a well-formed chip beside the damage', () => {
    expect(clean(`${CHIP_OPEN}[Pas${f}`)).toBe(f);
    expect(clean(`${f}nes]${CHIP_CLOSE}`)).toBe(f);
  });

  it('removeRanges moves a caret with what was removed', () => {
    expect(removeRanges('abcdef', [{ start: 1, end: 3 }], 5)).toEqual({ value: 'adef', caret: 3 });
    expect(removeRanges('abcdef', [{ start: 1, end: 3 }], 2)).toEqual({ value: 'adef', caret: 1 });
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
