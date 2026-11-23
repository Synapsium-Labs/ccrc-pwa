// Paste chips, the decision (desktop-polish wave 169; Goals modification 90, second half). A long text paste enters
// the draft as a `[Pasted text #N +L lines]` token at the caret, and the full text rides beside the draft. This file
// pins the pure L1 half (`pwa/src/session/pasteChips.ts`): when a paste becomes a chip, the token grammar, expansion
// into the send payload byte for byte, and the recovery of a token the user broke. The composer half is
// `composer-paste-chips.test.tsx`.
import { describe, expect, it } from 'vitest';
import {
  CHIP_MIN_CHARS,
  CHIP_MAX_PLAIN_LINES,
  addChip,
  chipToken,
  emptyChips,
  expandChip,
  expandDraft,
  findTokens,
  lineCount,
  liveChips,
  locateEdit,
  normalizePaste,
  reconcileEdit,
  removeChip,
  shouldChip,
  tokenToRemove,
  type PasteChips,
} from '../src/session/pasteChips';

const long = (n: number, fill = 'a'): string => fill.repeat(n);
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

/** Paste `text` into `value` over [start, end): the composer's own sequence (add the chip, splice the token). */
const paste = (value: string, chips: PasteChips, at: number, text: string, end = at) => {
  const added = addChip(chips, text);
  return {
    value: value.slice(0, at) + added.token + value.slice(end),
    chips: added.chips,
    token: added.token,
    n: added.n,
  };
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

  it('counts lines as the field shows them, so a trailing newline is a line of its own', () => {
    expect(lineCount('a')).toBe(1);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('a\n')).toBe(2);
  });

  it('normalizes CR LF and a lone CR to LF, as the field does with a paste', () => {
    expect(normalizePaste('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    expect(shouldChip(normalizePaste(Array.from({ length: 13 }, () => 'x').join('\r\n')))).toBe(true);
  });
});

describe('the token grammar', () => {
  it('is the console’s, numbered, with the line count', () => {
    expect(chipToken(1, 40)).toBe('[Pasted text #1 +40 lines]');
    expect(chipToken(3, 1)).toBe('[Pasted text #3 +1 line]');
  });

  it('numbers chips per draft, from 1, never reusing a number a removed chip held', () => {
    let chips = emptyChips();
    const a = addChip(chips, long(900));
    chips = a.chips;
    const b = addChip(chips, lines(20));
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    expect(b.token).toBe('[Pasted text #2 +20 lines]');
    // #2 removed from the draft: its text is still held, so the next chip is #3, not a second #2.
    const c = addChip(b.chips, long(1000));
    expect(c.n).toBe(3);
  });

  it('finds only tokens it issued, with the line count it issued', () => {
    const { value, chips } = paste('x ', emptyChips(), 2, long(900));
    expect(findTokens(value, chips)).toEqual([{ n: 1, start: 2, end: 2 + '[Pasted text #1 +1 line]'.length }]);
    // Same shape, a number nobody issued, or a line count that does not match: ordinary text.
    expect(findTokens('[Pasted text #2 +1 line]', chips)).toEqual([]);
    expect(findTokens('[Pasted text #1 +9 lines]', chips)).toEqual([]);
  });
});

describe('expansion into the send payload, byte for byte', () => {
  it('one chip', () => {
    const text = long(900, 'q');
    const { value, chips } = paste('', emptyChips(), 0, text);
    expect(expandDraft(value, chips)).toBe(text);
  });

  it('several chips among typed text, in their places', () => {
    const t1 = lines(20);
    const t2 = long(850, 'z');
    let s = paste('before  middle  after', emptyChips(), 7, t1);
    const at = s.value.indexOf('middle') + 'middle '.length;
    s = paste(s.value, s.chips, at, t2);
    expect(expandDraft(s.value, s.chips)).toBe(`before ${t1} middle ${t2} after`);
  });

  it('a chip at the very start and one at the very end', () => {
    const t1 = long(800, 's');
    const t2 = lines(13);
    let s = paste('typed', emptyChips(), 0, t1);
    s = paste(s.value, s.chips, s.value.length, t2);
    expect(expandDraft(s.value, s.chips)).toBe(`${t1}typed${t2}`);
  });

  it('CR LF content arrives as the LF the field would have held', () => {
    const raw = Array.from({ length: 14 }, (_, i) => `crlf ${i}`).join('\r\n');
    const { value, chips } = paste('', emptyChips(), 0, normalizePaste(raw));
    expect(expandDraft(value, chips)).toBe(raw.replace(/\r\n/g, '\n'));
  });

  it('tabs, inner blank lines, trailing spaces and edge whitespace stay exactly as pasted', () => {
    const text = `\n\n    indented\tand\ttabbed   \n\n\n  - bullet\n   \n${long(800, ' ')}\n\n`;
    const { value, chips } = paste('', emptyChips(), 0, text);
    expect(expandDraft(value, chips)).toBe(text);
  });

  it('a copy of a token the user pasted back expands too', () => {
    const text = lines(15);
    const s = paste('', emptyChips(), 0, text);
    const twice = `${s.value} and ${s.token}`;
    expect(expandDraft(twice, s.chips)).toBe(`${text} and ${text}`);
  });

  it('never expands a token inside a pasted text a second time', () => {
    const inner = paste('', emptyChips(), 0, lines(13));
    // Chip #2's own text contains #1's token literally: the send expands the DRAFT once, not the texts it inserts.
    const outerText = `${inner.token}\n${long(800)}`;
    const outer = paste(inner.value, inner.chips, inner.value.length, outerText);
    expect(expandDraft(outer.value, outer.chips)).toBe(`${lines(13)}${outerText}`);
  });

  it('a draft with no chips is returned unchanged', () => {
    expect(expandDraft('just typed', emptyChips())).toBe('just typed');
  });
});

describe('expand and remove a chip', () => {
  it('expand replaces the token with its full text, editable as ordinary text, caret after it', () => {
    const text = lines(14);
    const s = paste('a  b', emptyChips(), 2, text);
    const r = expandChip(s.value, 1, s.chips);
    expect(r.value).toBe(`a ${text} b`);
    expect(r.caret).toBe(2 + text.length);
    expect(findTokens(r.value, s.chips)).toEqual([]);
  });

  it('remove takes the token and its text together, caret where it stood', () => {
    const s = paste('a  b', emptyChips(), 2, lines(14));
    const r = removeChip(s.value, 1, s.chips);
    expect(r.value).toBe('a  b');
    expect(r.caret).toBe(2);
    expect(expandDraft(r.value, s.chips)).toBe('a  b');
  });

  it('acts on every copy of the token', () => {
    const s = paste('', emptyChips(), 0, lines(14));
    const twice = `${s.value}-${s.token}`;
    expect(removeChip(twice, 1, s.chips).value).toBe('-');
    expect(expandChip(twice, 1, s.chips).value).toBe(`${lines(14)}-${lines(14)}`);
  });

  it('lists the live chips in draft order, each once, with its line count and a head for the eye', () => {
    let s = paste('', emptyChips(), 0, `first line of one\n${lines(20)}`);
    s = paste(s.value, s.chips, 0, `  \n  head of two  \n${long(900)}`);
    expect(liveChips(s.value, s.chips).map(({ n, lines: l, head }) => ({ n, l, head }))).toEqual([
      { n: 2, l: 3, head: 'head of two' },
      { n: 1, l: 21, head: 'first line of one' },
    ]);
    expect(liveChips(removeChip(s.value, 2, s.chips).value, s.chips).map((c) => c.n)).toEqual([1]);
    // A copy of a token is the same chip: listed once.
    expect(liveChips(`${s.value}${s.value}`, s.chips).map((c) => c.n)).toEqual([2, 1]);
  });
});

describe('Backspace and Delete take a whole token', () => {
  it('Backspace right after a token removes all of it', () => {
    const s = paste('ab', emptyChips(), 1, lines(14));
    const end = 1 + s.token.length;
    expect(tokenToRemove(s.value, end, end, 'Backspace', s.chips)).toEqual({ n: 1, start: 1, end });
  });

  it('Delete right before a token removes all of it', () => {
    const s = paste('ab', emptyChips(), 1, lines(14));
    expect(tokenToRemove(s.value, 1, 1, 'Delete', s.chips)).toEqual({ n: 1, start: 1, end: 1 + s.token.length });
  });

  it('leaves ordinary characters, a selection, and the far side of a token to the browser', () => {
    const s = paste('ab', emptyChips(), 1, lines(14));
    const end = 1 + s.token.length;
    expect(tokenToRemove(s.value, 1, 1, 'Backspace', s.chips)).toBeNull();
    expect(tokenToRemove(s.value, end, end, 'Delete', s.chips)).toBeNull();
    expect(tokenToRemove(s.value, 0, 2, 'Backspace', s.chips)).toBeNull();
    // A selection that starts right after a token, or ends right before one, is the selection's to delete.
    expect(tokenToRemove(s.value, end, end + 1, 'Backspace', s.chips)).toBeNull();
    expect(tokenToRemove(s.value, 1, 1 + s.token.length, 'Delete', s.chips)).toBeNull();
    expect(tokenToRemove('[Pasted text #1 +14 lines]', 26, 26, 'Backspace', emptyChips())).toBeNull();
  });
});

describe('locating an edit', () => {
  it('uses the caret to place a repeated character where the user typed it', () => {
    // 'aa' -> 'aaa' with the caret at 1: the user typed at 0, not at the end.
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

describe('a token the user broke is expanded back, never dropped', () => {
  const setup = () => paste('ab', emptyChips(), 1, lines(14));

  it('a character typed inside a token: the full text, then what was typed', () => {
    const s = setup();
    const at = 1 + 5;
    const next = s.value.slice(0, at) + 'X' + s.value.slice(at);
    const r = reconcileEdit(s.value, next, at + 1, s.chips);
    expect(r).toEqual({ value: `a${lines(14)}Xb`, caret: 1 + lines(14).length + 1 });
  });

  it('a character deleted inside a token: the full text, nothing of it lost', () => {
    const s = setup();
    const at = 1 + 5;
    const next = s.value.slice(0, at) + s.value.slice(at + 1);
    expect(reconcileEdit(s.value, next, at, s.chips)?.value).toBe(`a${lines(14)}b`);
  });

  it('a selection from typed text into a token: the typed text goes, the pasted text stays', () => {
    const s = setup();
    // Select 'a' and the first 4 characters of the token, type 'Z'.
    const next = `Z${s.value.slice(5)}`;
    expect(reconcileEdit(s.value, next, 1, s.chips)?.value).toBe(`Z${lines(14)}b`);
  });

  it('a selection from inside one token into another keeps both texts and drops what lay between', () => {
    let s = paste('ab', emptyChips(), 1, lines(14));
    const t1 = s.token;
    s = paste(s.value, s.chips, s.value.length - 1, long(900));
    // value: a + t1 + t2 + b, with 'mid' typed between them.
    const value = `a${t1}mid${s.token}b`;
    const from = 1 + t1.length - 3;
    const to = 1 + t1.length + 3 + 4;
    const next = `${value.slice(0, from)}Q${value.slice(to)}`;
    expect(reconcileEdit(value, next, from + 1, s.chips)?.value).toBe(`a${lines(14)}Q${long(900)}b`);
  });

  it('an edit that removes a whole token, or touches none, is left as the user made it', () => {
    const s = setup();
    expect(reconcileEdit(s.value, 'ab', 1, s.chips)).toBeNull();
    expect(reconcileEdit(s.value, `${s.value}!`, s.value.length + 1, s.chips)).toBeNull();
    // Typing right at a token's edges is outside it.
    expect(reconcileEdit(s.value, `a!${s.value.slice(1)}`, 2, s.chips)).toBeNull();
    const end = 1 + s.token.length;
    expect(reconcileEdit(s.value, `${s.value.slice(0, end)}!b`, end + 1, s.chips)).toBeNull();
  });
});

describe('undo after a chip insertion never leaves a token without its text', () => {
  it('the text of a token undone and redone, or cut and pasted back, is still held', () => {
    const s = paste('', emptyChips(), 0, lines(30));
    // Undo: the field returns to '' (the chip leaves the draft). Redo: the token comes back. Nothing was dropped.
    const undone = '';
    expect(liveChips(undone, s.chips)).toEqual([]);
    expect(expandDraft(s.value, s.chips)).toBe(lines(30));
    // A removed chip's text is kept too, so restoring its token (undo after a remove) still expands it.
    const removed = removeChip(s.value, 1, s.chips);
    expect(expandDraft(removed.value, s.chips)).toBe('');
    expect(expandDraft(s.value, s.chips)).toBe(lines(30));
  });
});
