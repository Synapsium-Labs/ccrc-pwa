// The plan of a send with paste chips (desktop-polish wave 194): which pasted texts still need saving, and the text
// that goes out once each is saved, every chip replaced in its place by the pointer line naming its file. The pure L1
// half (`pwa/src/session/pasteSend.ts`); the grammar is `paste-pointer.test.ts`, the composer flow
// `composer-long-paste.test.tsx`.
import { describe, expect, it } from 'vitest';
import { addChip, emptyChips, expandValue, type PasteChips } from '../src/session/pasteChips';
import { pasteBytes, pastesToSave, pointerSend, type SavedPastes } from '../src/session/pasteSend';
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

const saved = (entries: [number, string][]): SavedPastes => new Map(entries);

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
