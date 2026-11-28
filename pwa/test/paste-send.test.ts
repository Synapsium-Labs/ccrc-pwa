// The plan of a send with paste chips (desktop-polish wave 194): which pasted texts still need saving, and the text
// that goes out once each is saved, every chip replaced in its place by the pointer line naming its file. The pure L1
// half (`pwa/src/session/pasteSend.ts`); the grammar is `paste-pointer.test.ts`, the composer flow
// `composer-long-paste.test.tsx`.
import { describe, expect, it } from 'vitest';
import { addChip, emptyChips, expandValue, type PasteChips } from '../src/session/pasteChips';
import { pasteBytes, pastesToSave, pointerSend, sendsAsShellLine, type SavedPastes } from '../src/session/pasteSend';
import { PASTE_POINTER_MAX, pastePointer, readPastePointer } from '../../shared/pastePointer';

const SID = 'acct-a-project-a';
const path = (r: string): string => `/home/user-a/.cc-clips/${SID}/clip-20261127-153012-${r}-paste.txt`;
const P1 = path('11111111');
const P2 = path('22222222');

const LONG = Array.from({ length: 214 }, (_, i) => `row ${String(i)}`).join('\n');
const SHORT_LONG = 'x'.repeat(900);

/** A table with chip 1 (214 lines) and chip 2 (one line of 900), and the two fields. */
function table(): { chips: PasteChips; f1: string; f2: string } {
  const a = addChip(emptyChips(), LONG, 1);
  const b = addChip(a.chips, SHORT_LONG, 2);
  return { chips: b.chips, f1: a.field, f2: b.field };
}

/** The files saved so far, each beside the text it was saved from: chip 1's and chip 2's own unless said otherwise. */
const TEXT: Record<number, string> = { 1: LONG, 2: SHORT_LONG };
const saved = (entries: [number, string, string?][]): SavedPastes =>
  new Map(entries.map(([n, p, text]) => [n, { path: p, text: text ?? TEXT[n]! }]));

describe('which pasted texts still need saving', () => {
  it('names every chip the draft sends that has no file, once each, in field order', () => {
    const { chips, f1, f2 } = table();
    expect(pastesToSave(`${f2} a ${f1} b ${f2}`, chips, saved([]))).toEqual([2, 1]);
  });

  it('skips a chip already saved, so a retry never saves it twice', () => {
    const { chips, f1, f2 } = table();
    expect(pastesToSave(`${f1}\n${f2}`, chips, saved([[1, P1]]))).toEqual([2]);
  });

  it('never names a chip that was removed from the draft', () => {
    const { chips, f2 } = table();
    expect(pastesToSave(`only ${f2}`, chips, saved([]))).toEqual([2]);
  });

  it('names nothing for a draft with no chip', () => {
    expect(pastesToSave('typed text', emptyChips(), saved([]))).toEqual([]);
  });

  it('saves again a chip whose saved file was made from any other text, so no pointer names another text\'s file', () => {
    const { chips, f1, f2 } = table();
    expect(pastesToSave(`${f1} ${f2}`, chips, saved([[1, P1, `${LONG}\n`], [2, P2, SHORT_LONG]]))).toEqual([1]);
    expect(pointerSend(`${f1} ${f2}`, chips, saved([[1, P1, 'other'], [2, P2]]), SID))
      .toEqual({ kind: 'unsaved', numbers: [1] });
  });
});

describe('a shell line', () => {
  it('is a draft whose typed text, as it will be typed, begins with `!`', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(`!ls ${f1}`, chips, 0)).toBe(true);
  });

  it('is one after a leading space or newline too, which the send trims away', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(` !ls ${f1}`, chips, 0)).toBe(true);
    expect(sendsAsShellLine(`\t!ls ${f1}`, chips, 0)).toBe(true);
    expect(sendsAsShellLine(`\n\n!ls ${f1}`, chips, 0)).toBe(true);
  });

  it('is not one when the `!` is typed after a chip or anywhere but the start', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(`${f1}!ls`, chips, 0)).toBe(false);
    expect(sendsAsShellLine(`${f1}\n!ls`, chips, 0)).toBe(false);
    expect(sendsAsShellLine(`x !ls ${f1}`, chips, 0)).toBe(false);
  });

  it('agrees with the pointer text as it will be typed', () => {
    const { chips, f1 } = table();
    for (const v of [`!ls ${f1}`, ` \t\n!ls ${f1}`, `${f1}!ls`, `say ${f1}`]) {
      const r = pointerSend(v, chips, saved([[1, P1]]), SID);
      if (r.kind !== 'ready') throw new Error(r.kind);
      expect(sendsAsShellLine(v, chips, 0), v).toBe(r.text.startsWith('!'));
    }
  });

  it('is not one when a tray attachment leads the composed prompt', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(`!ls ${f1}`, chips, 1)).toBe(false);
  });

  it('is not one when the draft opens with a chip, even a paste that itself begins with `!`', () => {
    const bang = addChip(emptyChips(), `!${LONG}`, 1);
    expect(sendsAsShellLine(`${bang.field} !after`, bang.chips, 0)).toBe(false);
  });

  it('is not one for a slash command or plain text', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(`/review ${f1}`, chips, 0)).toBe(false);
    expect(sendsAsShellLine(`say !hi ${f1}`, chips, 0)).toBe(false);
  });

  it('ignores the field\'s own stray markers before the `!`', () => {
    const { chips, f1 } = table();
    expect(sendsAsShellLine(`⁢!ls ${f1}`, chips, 0)).toBe(true);
  });
});

describe('a slash command with a chip', () => {
  it('takes the pointer like any draft', () => {
    const { chips, f1 } = table();
    expect(pointerSend(`/review ${f1}`, chips, saved([[1, P1]]), SID)).toEqual({
      kind: 'ready', text: `/review \n${pastePointer(P1, 214)}`,
    });
  });
});

describe('the text that goes out', () => {
  it('sends one chip alone as its pointer line', () => {
    const { chips, f1 } = table();
    expect(pointerSend(f1, chips, saved([[1, P1]]), SID)).toEqual({ kind: 'ready', text: pastePointer(P1, 214) });
  });

  it('sends two chips as two pointers, each on its own line, in order', () => {
    const { chips, f1, f2 } = table();
    expect(pointerSend(`${f1}${f2}`, chips, saved([[1, P1], [2, P2]]), SID)).toEqual({
      kind: 'ready', text: `${pastePointer(P1, 214)}\n${pastePointer(P2, 1)}`,
    });
  });

  it('keeps text before a chip before it and text after it after it, adding only the line breaks', () => {
    const { chips, f1 } = table();
    expect(pointerSend(`look at this ${f1} and fix it`, chips, saved([[1, P1]]), SID)).toEqual({
      kind: 'ready', text: `look at this \n${pastePointer(P1, 214)}\n and fix it`,
    });
  });

  it('adds no break where a line already ends or begins', () => {
    const { chips, f1 } = table();
    expect(pointerSend(`intro\n${f1}\noutro`, chips, saved([[1, P1]]), SID)).toEqual({
      kind: 'ready', text: `intro\n${pastePointer(P1, 214)}\noutro`,
    });
  });

  it('points the same chip standing twice at its one file', () => {
    const { chips, f1 } = table();
    expect(pointerSend(`${f1}${f1}`, chips, saved([[1, P1]]), SID)).toEqual({
      kind: 'ready', text: `${pastePointer(P1, 214)}\n${pastePointer(P1, 214)}`,
    });
  });

  it('trims the ends as the send always has', () => {
    const { chips, f1 } = table();
    expect(pointerSend(`  \n${f1}\n\n `, chips, saved([[1, P1]]), SID)).toEqual({
      kind: 'ready', text: pastePointer(P1, 214),
    });
  });

  it('drops the field\'s own stray markers, as the expansion does', () => {
    const { chips, f1 } = table();
    const stray = `a⁢b ${f1}`;
    const r = pointerSend(stray, chips, saved([[1, P1]]), SID);
    expect(r).toEqual({ kind: 'ready', text: `ab \n${pastePointer(P1, 214)}` });
  });

  it('sends a draft with no chip exactly as the expansion would', () => {
    expect(pointerSend('  plain  text\n', emptyChips(), saved([]), SID)).toEqual({
      kind: 'ready', text: expandValue('  plain  text\n', emptyChips()).trim(),
    });
  });

  it('every pointer it sends reads back as this session\'s pointer', () => {
    const { chips, f1, f2 } = table();
    const r = pointerSend(`${f1} x ${f2}`, chips, saved([[1, P1], [2, P2]]), SID);
    if (r.kind !== 'ready') throw new Error(r.kind);
    const lines = r.text.split('\n').filter((l) => l.startsWith('The pasted text'));
    expect(lines.map((l) => readPastePointer(l, SID)?.path)).toEqual([P1, P2]);
  });
});

describe('a send it refuses to build', () => {
  it('names the chips still without a file, and sends nothing', () => {
    const { chips, f1, f2 } = table();
    expect(pointerSend(`${f1} ${f2}`, chips, saved([[1, P1]]), SID)).toEqual({ kind: 'unsaved', numbers: [2] });
  });

  it('refuses a saved path whose pointer would not read back as this session\'s', () => {
    const { chips, f1 } = table();
    const elsewhere = `/home/user-a/.cc-clips/acct-b/clip-20261127-153012-11111111-paste.txt`;
    expect(pointerSend(f1, chips, saved([[1, elsewhere]]), SID)).toEqual({ kind: 'unpointable', numbers: [1] });
    expect(pointerSend(f1, chips, saved([[1, P1.replace('-paste.txt', '-notes.txt')]]), SID))
      .toEqual({ kind: 'unpointable', numbers: [1] });
  });

  it(`refuses a pointer longer than ${String(PASTE_POINTER_MAX)} characters`, () => {
    const { chips, f1 } = table();
    const deep = `/home/${'d'.repeat(330)}/.cc-clips/${SID}/clip-20261127-153012-11111111-paste.txt`;
    expect(pastePointer(deep, 214).length).toBeGreaterThan(PASTE_POINTER_MAX);
    expect(pointerSend(f1, chips, saved([[1, deep]]), SID)).toEqual({ kind: 'unpointable', numbers: [1] });
  });
});

describe('the size a pasted text is saved at', () => {
  it('counts UTF-8 bytes, as the file holds them', () => {
    expect(pasteBytes('a"|')).toBe(3);
    expect(pasteBytes('é')).toBe(2);
    expect(pasteBytes('😀')).toBe(4);
  });
});
