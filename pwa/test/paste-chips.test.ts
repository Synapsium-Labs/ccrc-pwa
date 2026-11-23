// Paste chips, the decision (desktop-polish wave 169; Goals modification 90, second half). A long text paste enters
// the draft as a `[Pasted text #N +L lines]` label at the caret, and the full text rides beside the draft. This file
// pins the pure L1 half (`pwa/src/session/pasteChips.ts`): when a paste becomes a chip, the label grammar, chip
// identity by inserted occurrence (review 3457 F4, A1), expansion into the send payload byte for byte, the plans that
// keep an edit from breaking a label, the repair of one that lands anyway, the clipboard's text, and the browser's undo
// and redo restoring a held draft by position (review 3469 F1-F3), never by a label's text. The composer half is `composer-paste-chips.test.tsx`; the browser half is `browser/paste-chips.browser.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  CHIP_MIN_CHARS,
  CHIP_MAX_PLAIN_LINES,
  DRAFT_LOG_CAP,
  applyChange,
  canStep,
  chipToken,
  emptyChips,
  emptyDraft,
  expandChip,
  expandDraft,
  lineCount,
  linesWord,
  liveChips,
  locateEdit,
  logChange,
  logDraft,
  logStep,
  normalizePaste,
  planInput,
  planPaste,
  planWordDelete,
  removeChip,
  selectionText,
  shouldChip,
  startLog,
  type Draft,
  type DraftLog,
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

/** Paste a long `text` over [at, end): the composer's own sequence (`planPaste`, then its plan performed with the new
 *  chip's occurrence where the plan put its label). */
const paste = (s: Pick<S, 'draft' | 'chips'>, at: number, text: string, end = at): S => {
  const p = planPaste(s.draft, at, end, text, s.chips);
  const plan = p.plan!;
  const next = s.draft.value.slice(0, plan.start) + plan.text + s.draft.value.slice(plan.end);
  const r = applyChange(s.draft, next, plan.start + plan.text.length, p.chips, { attach: p.attach, edit: { start: plan.start, end: plan.end } });
  const n = p.attach!.n;
  return { draft: r.draft, chips: p.chips, token: chipToken(n, lineCount(text)), n };
};

/** Perform a plan as the browser's own edit, the caret after the inserted text. */
const perform = (s: Pick<S, 'draft' | 'chips'>, plan: Plan): Draft => {
  const next = s.draft.value.slice(0, plan.start) + plan.text + s.draft.value.slice(plan.end);
  return applyChange(s.draft, next, plan.start + plan.text.length, s.chips, { edit: { start: plan.start, end: plan.end } }).draft;
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

  it('a long paste inside a label whose text holds the new label binds the label the paste appended (review 3469 F2)', () => {
    const next = lines(20, 'next');
    const nextToken = chipToken(2, 20);
    const holderText = `holder\n${lines(9, 'h')}\n${nextToken}\n${lines(9, 't')}`;
    const one = paste(start(), 0, holderText);
    const p = planPaste(one.draft, 5, 5, next, one.chips);
    expect(p.plan).toEqual({ start: 0, end: one.token.length, text: `${holderText}${nextToken}` });
    expect(p.attach).toEqual({ n: 2, start: holderText.length, end: holderText.length + nextToken.length });
    const two = paste(one, 5, next);
    expect(two.draft.occ).toEqual([p.attach]);
    expect(expandDraft(two.draft, two.chips)).toBe(`${holderText}${next}`);
  });

  it('a stated occurrence attaches only where its label is (no search elsewhere)', () => {
    const s = paste(start(), 0, lines(14));
    const removed = perform(s, removeChip(s.draft, 1)!);
    const next = `x${s.token}`;
    const wrong = applyChange(removed, next, next.length, s.chips, { attach: { n: 1, start: 0, end: s.token.length }, edit: { start: 0, end: 0 } });
    expect(wrong.draft.occ).toEqual([]);
    const right = applyChange(removed, next, next.length, s.chips, { attach: { n: 1, start: 1, end: 1 + s.token.length }, edit: { start: 0, end: 0 } });
    expect(right.draft.occ).toEqual([{ n: 1, start: 1, end: 1 + s.token.length }]);
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

/** A draft and the composer's log of held drafts (`DraftLog`), as the composer keeps them. */
interface L { draft: Draft; chips: PasteChips; log: DraftLog }
const logged = (s: Pick<S, 'draft' | 'chips'>, log: DraftLog = startLog()): L => ({ draft: s.draft, chips: s.chips, log: logChange(log, s.draft) });
const then = (l: L, draft: Draft, chips = l.chips): L => ({ draft, chips, log: logChange(l.log, draft) });
/** The browser's undo (`back`) or redo restored `value`, and nothing else: no range, no caret. */
const step = (l: L, value: string, back: boolean): L => {
  const log = logStep(l.log, value, back);
  expect(log, `a held draft with value ${JSON.stringify(value.slice(0, 40))}`).not.toBeNull();
  return { ...l, log: log!, draft: logDraft(log!) };
};

describe('the browser’s undo and redo restore a held draft by position, never by a label’s text', () => {
  it('undo and redo of a removal and of an Expand restore the drafts they left', () => {
    const s = paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(30));
    let l = logged(s, startLog(emptyDraft('ab')));
    l = then(l, perform(s, removeChip(s.draft, 1)!));
    l = step(l, s.draft.value, true);
    expect(l.draft).toEqual(s.draft);
    expect(expandDraft(l.draft, l.chips)).toBe(`a${lines(30)}b`);
    l = step(l, 'ab', false);
    expect(l.draft.occ).toEqual([]);
    l = step(l, s.draft.value, true);
    const expanded = perform(l, expandChip(l.draft, 1, l.chips)!);
    l = then(l, expanded);
    l = step(l, s.draft.value, true);
    expect(l.draft).toEqual(s.draft);
    l = step(l, expanded.value, false);
    expect(l.draft).toEqual(expanded);
  });

  it('F1: redo of an Expand whose text starts with [ gives that text once (no repair, no doubling)', () => {
    const text = `[12:00:01] log head\n${lines(20, 'br')}`;
    const s = paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, text);
    let l = logged(s, startLog(emptyDraft('ab')));
    const expanded = perform(l, expandChip(l.draft, 1, l.chips)!);
    expect(expanded.value).toBe(`a${text}b`);
    l = then(l, expanded);
    l = step(l, s.draft.value, true);
    expect(l.draft.occ).toEqual(s.draft.occ);
    l = step(l, `a${text}b`, false);
    expect(l.draft).toEqual({ value: `a${text}b`, occ: [] });
    expect(expandDraft(l.draft, l.chips)).toBe(`a${text}b`);
  });

  it('F3 (a): Expand, delete everything, undo: the live chip returns where it was, not inside the expanded text', () => {
    const nextToken = chipToken(2, 20);
    const holderText = `holder\n${lines(9, 'h')}\n${nextToken}\n${lines(9, 't')}`;
    const one = paste(start(), 0, holderText);
    const two = paste(one, one.draft.value.length, lines(20, 'next'));
    let l = logged(two);
    const expanded = perform(l, expandChip(l.draft, 1, l.chips)!);
    expect(expanded.occ).toEqual([{ n: 2, start: holderText.length, end: holderText.length + nextToken.length }]);
    l = then(l, expanded);
    l = then(l, applyChange(l.draft, '', 0, l.chips).draft);
    l = step(l, expanded.value, true);
    expect(l.draft).toEqual(expanded);
    expect(expandDraft(l.draft, l.chips)).toBe(`${holderText}${lines(20, 'next')}`);
    l = step(l, '', false);
    l = step(l, expanded.value, true);
    expect(l.draft).toEqual(expanded);
  });

  it('F3 (b): a removed chip stays removed through undo and redo of an Expand that exposes its label', () => {
    const nextToken = chipToken(2, 20);
    const holderText = `holder\n${lines(9, 'h')}\n${nextToken}\n${lines(9, 't')}`;
    const one = paste(start(), 0, holderText);
    const two = paste(one, one.draft.value.length, lines(20, 'next'));
    let l = logged(two);
    l = then(l, perform(l, removeChip(l.draft, 2)!));
    const expanded = perform(l, expandChip(l.draft, 1, l.chips)!);
    l = then(l, expanded);
    l = step(l, one.token, true);
    expect(l.draft.occ.map((o) => o.n)).toEqual([1]);
    l = step(l, holderText, false);
    expect(l.draft).toEqual({ value: holderText, occ: [] });
    expect(expandDraft(l.draft, l.chips)).toBe(holderText);
  });

  it('one value held both as a chip and as a typed label: each step returns the draft the browser restored', () => {
    const s = paste(start(), 0, lines(30));
    let l = logged(s);
    l = then(l, applyChange(l.draft, '', 0, l.chips).draft); // select all, Backspace
    for (let i = 1; i <= s.token.length; i += 1) l = then(l, applyChange(l.draft, s.token.slice(0, i), i, l.chips).draft); // typed by hand
    expect(l.draft).toEqual({ value: s.token, occ: [] });
    l = step(l, '', true); // the browser undoes the typing in one step
    l = step(l, s.token, true); // and then the delete: the chip
    expect(l.draft).toEqual(s.draft);
    l = step(l, '', false);
    l = step(l, s.token, false); // redo of the typing: literal again
    expect(l.draft).toEqual({ value: s.token, occ: [] });
    expect(expandDraft(l.draft, l.chips)).toBe(s.token);
    // One more keystroke, then its undo: the nearest held draft with that value is the typed one, not the older chip.
    l = then(l, applyChange(l.draft, `${s.token}!`, s.token.length + 1, l.chips).draft);
    l = step(l, s.token, true);
    expect(l.draft).toEqual({ value: s.token, occ: [] });
  });

  it('a change drops what could be redone; a value never held is no step; the log keeps its newest drafts', () => {
    let log = logChange(logChange(startLog(), emptyDraft('a')), emptyDraft('ab'));
    expect(canStep(log, true)).toBe(true);
    expect(canStep(log, false)).toBe(false);
    log = logStep(log, 'a', true)!;
    expect(canStep(log, false)).toBe(true);
    expect(logStep(log, 'zz', false)).toBeNull();
    log = logChange(log, emptyDraft('ac'));
    expect(log.drafts.map((d) => d.value)).toEqual(['', 'a', 'ac']);
    expect(canStep(log, false)).toBe(false);
    for (let i = 0; i < DRAFT_LOG_CAP + 5; i += 1) log = logChange(log, emptyDraft(String(i)));
    expect(log.drafts).toHaveLength(DRAFT_LOG_CAP);
    expect(log.at).toBe(DRAFT_LOG_CAP - 1);
    expect(logDraft(log).value).toBe(String(DRAFT_LOG_CAP + 4));
  });

  it('no change re-attaches a label by its text: a label typed back after a removal stays literal', () => {
    const s = paste(start(), 0, lines(30));
    const removed = perform(s, removeChip(s.draft, 1)!);
    expect(applyChange(removed, s.token, s.token.length, s.chips).draft.occ).toEqual([]);
  });

  it('a change that cannot be placed drops an occurrence it broke instead of writing its text (repair: false)', () => {
    const s = paste({ draft: emptyDraft('ab'), chips: emptyChips() }, 1, lines(14));
    const next = `${s.draft.value.slice(0, 6)}X${s.draft.value.slice(6)}`;
    expect(applyChange(s.draft, next, 7, s.chips, { repair: false })).toEqual({ draft: { value: next, occ: [] }, repair: null });
  });
});

describe('a word delete reaching into a label is planned over the browser’s own word (review 3469 F5)', () => {
  const s = paste({ draft: emptyDraft('x  yz'), chips: emptyChips() }, 2, lines(14));
  const end = 2 + s.token.length;

  it('with the caret touching a label, it is Backspace’s or Delete’s plan', () => {
    expect(planWordDelete(s.draft, end, { start: end - 6, end }, true, s.chips)).toEqual({ start: 2, end, text: '' });
    expect(planWordDelete(s.draft, 2, { start: 2, end: 3 }, false, s.chips)).toEqual({ start: 2, end, text: '' });
  });

  it('a word range reaching into a label keeps its text and deletes the rest of the range', () => {
    expect(planWordDelete(s.draft, end + 1, { start: end - 1, end: end + 1 }, true, s.chips))
      .toEqual({ start: 2, end: end + 1, text: lines(14) });
    expect(planWordDelete(s.draft, 1, { start: 1, end: 3 }, false, s.chips)).toEqual({ start: 1, end, text: lines(14) });
  });

  it('a word range outside labels, or none measured, is the browser’s own', () => {
    expect(planWordDelete(s.draft, s.draft.value.length, { start: end + 1, end: s.draft.value.length }, true, s.chips)).toBeNull();
    expect(planWordDelete(s.draft, end + 1, null, true, s.chips)).toBeNull();
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
