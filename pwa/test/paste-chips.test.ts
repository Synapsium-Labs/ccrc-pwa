// Paste chips, the decision (desktop-polish wave 169; Goals modification 90, second half). A long text paste enters
// the draft as a `[Pasted text #N +L lines]` label at the caret, and the full text rides beside the draft. This file
// pins the pure L1 half (`pwa/src/session/pasteChips.ts`): when a paste becomes a chip, the label grammar, chip
// identity by inserted occurrence (review 3457 F4, A1), expansion into the send payload byte for byte, the plans that
// keep an edit from breaking a label, the repair of one that lands anyway, the clipboard's text, and undo's return of a
// label. The composer half is `composer-paste-chips.test.tsx`; the browser half is `browser/paste-chips.browser.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  CHIP_MIN_CHARS,
  CHIP_MAX_PLAIN_LINES,
  addChip,
  applyChange,
  chipToken,
  emptyChips,
  emptyDraft,
  expandChip,
  expandDraft,
  lineCount,
  linesWord,
  liveChips,
  locateEdit,
  normalizePaste,
  planInput,
  removeChip,
  selectionText,
  shouldChip,
  type Draft,
  type PasteChips,
  type Plan,
} from '../src/session/pasteChips';

const long = (n: number, fill = 'a'): string => fill.repeat(n);
const lines = (n: number, tag = 'line'): string => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n');

interface S { draft: Draft; chips: PasteChips; token: string; n: number }

/** Type `text` at `at` as the browser would (no chip). */
const type = (s: Pick<S, 'draft' | 'chips'>, at: number, text: string, end = at): Draft => {
  const next = s.draft.value.slice(0, at) + text + s.draft.value.slice(end);
  return applyChange(s.draft, next, at + text.length, s.chips).draft;
};

/** Paste `text` as a chip at [at, end): the composer's own sequence (register the chip, insert its label, attach). */
const paste = (s: Pick<S, 'draft' | 'chips'>, at: number, text: string, end = at): S => {
  const added = addChip(s.chips, text);
  const next = s.draft.value.slice(0, at) + added.token + s.draft.value.slice(end);
  const r = applyChange(s.draft, next, at + added.token.length, added.chips, { attach: added.n, edit: { start: at, end } });
  return { draft: r.draft, chips: added.chips, token: added.token, n: added.n };
};

/** Perform a plan as the browser's own edit, the caret after the inserted text. */
const perform = (s: Pick<S, 'draft' | 'chips'>, plan: Plan, history = false): Draft => {
  const next = s.draft.value.slice(0, plan.start) + plan.text + s.draft.value.slice(plan.end);
  return applyChange(s.draft, next, plan.start + plan.text.length, s.chips, { history, edit: { start: plan.start, end: plan.end } }).draft;
};

const start = (): Pick<S, 'draft' | 'chips'> => ({ draft: emptyDraft(), chips: emptyChips() });

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
  it('is the console’s, numbered, with the line count', () => {
    expect(chipToken(1, 40)).toBe('[Pasted text #1 +40 lines]');
    expect(chipToken(3, 1)).toBe('[Pasted text #3 +1 line]');
    expect(linesWord(1)).toBe('1 line');
    expect(linesWord(2)).toBe('2 lines');
  });

  it('numbers chips per draft from 1, never reusing a number a removed chip held', () => {
    let s: Pick<S, 'draft' | 'chips'> = start();
    const a = paste(s, 0, long(900));
    expect(a.n).toBe(1);
    const b = paste(a, a.draft.value.length, lines(20));
    expect(b.n).toBe(2);
    expect(b.token).toBe('[Pasted text #2 +20 lines]');
    s = { draft: perform(b, removeChip(b.draft, 2)!), chips: b.chips };
    expect(paste(s, 0, long(1000)).n).toBe(3);
  });
});

describe('expansion into the send payload, byte for byte', () => {
  it('one chip', () => {
    const text = long(900, 'q');
    const s = paste(start(), 0, text);
    expect(s.draft.value).toBe('[Pasted text #1 +1 line]');
    expect(expandDraft(s.draft, s.chips)).toBe(text);
  });

  it('several chips among typed text, in their places', () => {
    const t1 = lines(20);
    const t2 = long(850, 'z');
    let s: Pick<S, 'draft' | 'chips'> = { draft: emptyDraft('before  middle  after'), chips: emptyChips() };
    s = paste(s, 7, t1);
    s = paste(s, s.draft.value.indexOf('middle') + 'middle '.length, t2);
    expect(expandDraft(s.draft, s.chips)).toBe(`before ${t1} middle ${t2} after`);
  });

  it('a chip at the very start and one at the very end', () => {
    const t1 = long(800, 's');
    const t2 = lines(13);
    let s: Pick<S, 'draft' | 'chips'> = { draft: emptyDraft('typed'), chips: emptyChips() };
    s = paste(s, 0, t1);
    s = paste(s, s.draft.value.length, t2);
    expect(expandDraft(s.draft, s.chips)).toBe(`${t1}typed${t2}`);
  });

  it('CR LF content arrives as the LF the field would have held', () => {
    const raw = Array.from({ length: 14 }, (_, i) => `crlf ${i}`).join('\r\n');
    const s = paste(start(), 0, normalizePaste(raw));
    expect(expandDraft(s.draft, s.chips)).toBe(raw.replace(/\r\n/g, '\n'));
  });

  it('tabs, inner blank lines, trailing spaces and edge whitespace stay exactly as pasted', () => {
    const text = `\n\n    indented\tand\ttabbed   \n\n\n  - bullet\n   \n${long(800, ' ')}\n\n`;
    const s = paste(start(), 0, text);
    expect(expandDraft(s.draft, s.chips)).toBe(text);
  });

  it('typing before and after a chip moves it with the text', () => {
    let s: Pick<S, 'draft' | 'chips'> = paste(start(), 0, lines(14));
    s = { ...s, draft: type(s, 0, 'see: ') };
    s = { ...s, draft: type(s, s.draft.value.length, ' thanks') };
    expect(expandDraft(s.draft, s.chips)).toBe(`see: ${lines(14)} thanks`);
    expect(s.draft.occ).toEqual([{ n: 1, start: 5, end: 5 + '[Pasted text #1 +14 lines]'.length }]);
  });
});

describe('identity is the inserted occurrence, never the label’s text (F4, A1)', () => {
  it('a label copied from another draft stays literal, even where this draft’s chip has the same label', () => {
    const old = paste(start(), 0, lines(14, 'old'));
    // A new draft: its own chip #1 has 14 lines too, so the two labels are identical.
    const fresh = paste(start(), 0, lines(14, 'new'));
    expect(fresh.token).toBe(old.token);
    const draft = type(fresh, fresh.draft.value.length, ` ${old.token}`);
    expect(expandDraft(draft, fresh.chips)).toBe(`${lines(14, 'new')} ${old.token}`);
  });

  it('a label typed beside a live occurrence stays literal, and the chip is sent once', () => {
    const s = paste(start(), 0, lines(14));
    const draft = type(s, 0, `${s.token} `);
    expect(draft.value).toBe(`${s.token} ${s.token}`);
    expect(expandDraft(draft, s.chips)).toBe(`${s.token} ${lines(14)}`);
    expect(liveChips(draft, s.chips).map((c) => c.n)).toEqual([1]);
  });

  it('a label inside a pasted text stays literal before and after Expand (no doubled text)', () => {
    const one = paste(start(), 0, lines(13, 'one'));
    const innerText = `${one.token}\n${long(800, 'w')}`;
    const two = paste(one, one.draft.value.length, innerText);
    const sent = `${lines(13, 'one')}${innerText}`;
    expect(expandDraft(two.draft, two.chips)).toBe(sent);
    const expanded = perform(two, expandChip(two.draft, 2, two.chips)!);
    expect(expanded.value).toBe(`${one.token}${innerText}`);
    expect(expandDraft(expanded, two.chips)).toBe(sent);
    expect(liveChips(expanded, two.chips).map((c) => c.n)).toEqual([1]);
  });

  it('a label inside a pasted text stays literal after a repair exposes it', () => {
    const one = paste(start(), 0, lines(13, 'one'));
    const innerText = `${one.token}\n${long(800, 'w')}`;
    const two = paste(one, one.draft.value.length, innerText);
    // A key typed inside #2's label, landing unplanned: the repair writes #2's text, with #1's label inside it.
    const at = one.token.length + 4;
    const next = `${two.draft.value.slice(0, at)}X${two.draft.value.slice(at)}`;
    const r = applyChange(two.draft, next, at + 1, two.chips);
    expect(r.repair?.value).toBe(`${one.token}${innerText}X`);
    expect(expandDraft(r.draft, two.chips)).toBe(`${lines(13, 'one')}${innerText}X`);
  });
});

describe('Expand and remove plan a replacement of the occurrence', () => {
  it('expand: the label becomes the full text', () => {
    const s = paste({ draft: emptyDraft('a  b'), chips: emptyChips() }, 2, lines(14));
    const plan = expandChip(s.draft, 1, s.chips)!;
    expect(plan).toEqual({ start: 2, end: 2 + s.token.length, text: lines(14) });
    const after = perform(s, plan);
    expect(after.value).toBe(`a ${lines(14)} b`);
    expect(after.occ).toEqual([]);
  });

  it('remove: the label goes, with its text', () => {
    const s = paste({ draft: emptyDraft('a  b'), chips: emptyChips() }, 2, lines(14));
    const after = perform(s, removeChip(s.draft, 1)!);
    expect(after.value).toBe('a  b');
    expect(expandDraft(after, s.chips)).toBe('a  b');
  });

  it('a chip with no occurrence has nothing to plan', () => {
    expect(expandChip(emptyDraft(), 1, emptyChips())).toBeNull();
    expect(removeChip(emptyDraft(), 1)).toBeNull();
  });

  it('lists the live chips in draft order, with their line count and a head for the eye', () => {
    let s = paste(start(), 0, `first line of one\n${lines(20)}`);
    s = paste(s, 0, `  \n  head of two  \n${long(900)}`);
    expect(liveChips(s.draft, s.chips).map(({ n, lines: l, head }) => ({ n, l, head }))).toEqual([
      { n: 2, l: 3, head: 'head of two' },
      { n: 1, l: 21, head: 'first line of one' },
    ]);
  });
});

describe('planInput keeps an edit from breaking a label', () => {
  // a + label + b, the label at [1, 1 + len).
  const setup = () => paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(14));

  it('Backspace right after a label removes all of it, with typed text on both sides kept', () => {
    const s = setup();
    const end = 1 + s.token.length;
    const plan = planInput(s.draft, end, end, 'deleteContentBackward', null, s.chips)!;
    expect(plan).toEqual({ start: 1, end, text: '' });
    expect(perform(s, plan).value).toBe('ab');
    // A word or line delete backward from there takes the whole label too, never more.
    expect(planInput(s.draft, end, end, 'deleteWordBackward', null, s.chips)).toEqual(plan);
  });

  it('Delete right before a label removes all of it', () => {
    const s = setup();
    const plan = planInput(s.draft, 1, 1, 'deleteContentForward', null, s.chips)!;
    expect(plan).toEqual({ start: 1, end: 1 + s.token.length, text: '' });
    expect(perform(s, plan).value).toBe('ab');
  });

  it('Backspace or Delete with the caret inside a label expands it and deletes nothing', () => {
    const s = setup();
    for (const t of ['deleteContentBackward', 'deleteContentForward']) {
      const plan = planInput(s.draft, 6, 6, t, null, s.chips)!;
      expect(plan).toEqual({ start: 1, end: 1 + s.token.length, text: lines(14) });
    }
  });

  it('a key typed inside a label: the full text, then the key', () => {
    const s = setup();
    expect(planInput(s.draft, 6, 6, 'insertText', 'X', s.chips))
      .toEqual({ start: 1, end: 1 + s.token.length, text: `${lines(14)}X` });
    expect(planInput(s.draft, 6, 6, 'insertLineBreak', null, s.chips))
      .toEqual({ start: 1, end: 1 + s.token.length, text: `${lines(14)}\n` });
  });

  it('a selection from typed text into a label: the typed text goes, the pasted text stays', () => {
    const s = setup();
    expect(planInput(s.draft, 0, 5, 'insertText', 'Z', s.chips)).toEqual({ start: 0, end: 1 + s.token.length, text: `Z${lines(14)}` });
  });

  it('a selection from inside one label into another keeps both texts and drops what lay between', () => {
    let s = setup();
    s = { ...s, draft: type(s, 1 + s.token.length, 'mid') };
    const t2 = paste(s, 1 + s.token.length + 3, long(900));
    const from = 1 + s.token.length - 3;
    const to = 1 + s.token.length + 3 + 4;
    expect(planInput(t2.draft, from, to, 'deleteContentBackward', null, t2.chips))
      .toEqual({ start: 1, end: 1 + s.token.length + 3 + t2.token.length, text: `${lines(14)}${long(900)}` });
  });

  it('a selection inside one label: its text, then what was typed', () => {
    const s = setup();
    expect(planInput(s.draft, 3, 6, 'insertText', 'Q', s.chips)).toEqual({ start: 1, end: 1 + s.token.length, text: `${lines(14)}Q` });
  });

  it('leaves to the browser: edits outside labels, whole-label removals, undo and redo, and insertions without text', () => {
    const s = setup();
    const end = 1 + s.token.length;
    expect(planInput(s.draft, 0, 0, 'insertText', 'x', s.chips)).toBeNull();
    expect(planInput(s.draft, end, end, 'insertText', 'x', s.chips)).toBeNull();
    expect(planInput(s.draft, 1, 1, 'insertText', 'x', s.chips)).toBeNull();
    expect(planInput(s.draft, 1, 1, 'deleteContentBackward', null, s.chips)).toBeNull();
    expect(planInput(s.draft, end, end, 'deleteContentForward', null, s.chips)).toBeNull();
    expect(planInput(s.draft, 0, end + 1, 'deleteContentBackward', null, s.chips)).toBeNull();
    expect(planInput(s.draft, 6, 6, 'historyUndo', null, s.chips)).toBeNull();
    expect(planInput(s.draft, 6, 6, 'insertFromDrop', null, s.chips)).toBeNull();
  });
});

describe('an edit that lands inside a label anyway is repaired', () => {
  const setup = () => paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(14));

  it('a character typed inside: the full text, then what was typed, caret after it', () => {
    const s = setup();
    const next = `${s.draft.value.slice(0, 6)}X${s.draft.value.slice(6)}`;
    const r = applyChange(s.draft, next, 7, s.chips);
    expect(r.repair).toEqual({ value: `a${lines(14)}Xb`, caret: 1 + lines(14).length + 1 });
    expect(r.draft.occ).toEqual([]);
  });

  it('a character deleted inside: the full text, nothing of it lost', () => {
    const s = setup();
    const next = s.draft.value.slice(0, 6) + s.draft.value.slice(7);
    expect(applyChange(s.draft, next, 6, s.chips).repair?.value).toBe(`a${lines(14)}b`);
  });

  it('a chip after the repaired one keeps its place', () => {
    let s = setup();
    s = paste(s, s.draft.value.length, long(900));
    const next = `${s.draft.value.slice(0, 6)}X${s.draft.value.slice(6)}`;
    const r = applyChange(s.draft, next, 7, s.chips);
    expect(expandDraft(r.draft, s.chips)).toBe(`a${lines(14)}Xb${long(900)}`);
    expect(r.draft.occ.map((o) => o.n)).toEqual([2]);
  });

  it('an edit that removes a whole label, or touches none, needs no repair', () => {
    const s = setup();
    expect(applyChange(s.draft, 'ab', 1, s.chips)).toEqual({ draft: { value: 'ab', occ: [] }, repair: null });
    expect(applyChange(s.draft, `${s.draft.value}!`, s.draft.value.length + 1, s.chips).repair).toBeNull();
  });
});

describe('the browser’s undo and redo bring a chip back with its text', () => {
  it('undo of a removal, an Expand or a repair re-attaches the label it brings back', () => {
    const s = paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(30));
    const removed: S = { ...s, draft: perform(s, removeChip(s.draft, 1)!) };
    // Undo: the browser puts the label back and selects it.
    const undone = applyChange(removed.draft, s.draft.value, 1 + s.token.length, s.chips, { history: true }).draft;
    expect(undone.occ).toEqual(s.draft.occ);
    expect(expandDraft(undone, s.chips)).toBe(`a${lines(30)}b`);
    const expanded = perform(s, expandChip(s.draft, 1, s.chips)!);
    const back = applyChange(expanded, s.draft.value, 1 + s.token.length, s.chips, { history: true }).draft;
    expect(back.occ).toEqual(s.draft.occ);
  });

  it('undo of an Expand re-attaches even where the chip’s text begins like its label', () => {
    const one = paste(start(), 0, lines(13, 'one'));
    const two = paste(one, one.draft.value.length, `${one.token}\n${long(800, 'w')}`);
    const expanded = perform(two, expandChip(two.draft, 2, two.chips)!);
    // Undo: the browser restores #2's label and selects it, so the caret is at its end.
    const back = applyChange(expanded, two.draft.value, two.draft.value.length, two.chips, { history: true }).draft;
    expect(back.occ).toEqual(two.draft.occ);
    // Without the stated range, Expand's own change would read as an edit inside #2's label.
    const next = `${one.token}${one.token}\n${long(800, 'w')}`;
    expect(applyChange(two.draft, next, next.length, two.chips).repair).not.toBeNull();
    expect(applyChange(two.draft, next, next.length, two.chips, { edit: { start: one.token.length, end: two.draft.value.length } }).repair).toBeNull();
  });

  it('only the browser’s history re-attaches: a typed label stays literal, and a live chip is never doubled', () => {
    const s = paste(start(), 0, lines(30));
    const removed = perform(s, removeChip(s.draft, 1)!);
    expect(applyChange(removed, s.token, s.token.length, s.chips).draft.occ).toEqual([]);
    const twice = applyChange(s.draft, `${s.token}${s.token}`, 2 * s.token.length, s.chips, { history: true }).draft;
    expect(twice.occ).toHaveLength(1);
  });
});

describe('the clipboard gets a chip’s full text, never its label', () => {
  const setup = () => paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(14));

  it('a selection holding a chip', () => {
    const s = setup();
    expect(selectionText(s.draft, 0, s.draft.value.length, s.chips)).toBe(`a${lines(14)}b`);
  });

  it('a selection touching part of a label gives that chip’s whole text', () => {
    const s = setup();
    expect(selectionText(s.draft, 0, 4, s.chips)).toBe(`a${lines(14)}`);
    expect(selectionText(s.draft, 4, s.draft.value.length, s.chips)).toBe(`${lines(14)}b`);
  });

  it('a selection touching no chip is the browser’s own', () => {
    const s = setup();
    expect(selectionText(s.draft, 0, 1, s.chips)).toBeNull();
    expect(selectionText(s.draft, 3, 3, s.chips)).toBeNull();
  });
});

describe('locating an edit', () => {
  it('uses the caret to place a repeated character where the user typed it', () => {
    expect(locateEdit('aa', 'aaa', 1)).toEqual({ start: 0, prevEnd: 0, nextEnd: 1 });
  });

  it('places a forward delete and a backspace', () => {
    expect(locateEdit('abcd', 'abd', 2)).toEqual({ start: 2, prevEnd: 3, nextEnd: 2 });
    expect(locateEdit('abcd', 'acd', 1)).toEqual({ start: 1, prevEnd: 2, nextEnd: 1 });
  });

  it('falls back to the common prefix and suffix when the caret cannot explain the change', () => {
    expect(locateEdit('hello world', 'hello there world', 999)).toEqual({ start: 6, prevEnd: 6, nextEnd: 12 });
  });
});
