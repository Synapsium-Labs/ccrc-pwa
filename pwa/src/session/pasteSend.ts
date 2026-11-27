// The plan of a send with paste chips (desktop-polish wave 194). Ring L1, context C3 (Session Conversation): pure
// functions over the draft, the chip table and the paths already saved; no DOM, no React, no request. The composer
// performs what this plans and the save hook (`usePasteSave.ts`) does the uploads.
//
// A long paste goes to the session as a saved `.txt` clip, never as its text (the operator's design, item 729). So at
// Send each chip's pasted text is saved first, ONE file per chip number (the number names one text for the life of the
// draft, `pasteChips.ts`, so the same chip standing twice shares its file and a retry never saves a saved chip again),
// and the text that goes out is the draft with each chip replaced IN PLACE by the pointer line that names its file
// (`shared/pastePointer.ts`, the one grammar). The pointer stands on a line of its own: a line break is added before it
// unless the text so far is empty or ends one, and after it unless the text that follows begins one or nothing does;
// nothing else of the typed text changes, and the ends are trimmed as the send always trimmed them.
//
// It refuses to build a send that would not read back: a chip with no saved file (`unsaved`), or one whose pointer is
// not a pointer of THIS session or is longer than `PASTE_POINTER_MAX` (`unpointable`). Either way nothing is sent.
// "Send as typed text" is the expansion (`expandValue`), unchanged, never this.
import { PASTE_POINTER_MAX, pastePointer, readPastePointer } from '../../../shared/pastePointer';
import { parseChips, stripMarkers, type PasteChips } from './pasteChips';

/** The file each chip number was saved to: the path the upload answered. */
export type SavedPastes = ReadonlyMap<number, string>;

/** What a send with chips comes to: the text to send, or the chip numbers that stop it. */
export type PointerSend =
  | { readonly kind: 'ready'; readonly text: string }
  | { readonly kind: 'unsaved'; readonly numbers: readonly number[] }
  | { readonly kind: 'unpointable'; readonly numbers: readonly number[] };

/** The chip numbers the draft sends, each once, in field order. */
const sentNumbers = (value: string, chips: PasteChips): number[] => {
  const out: number[] = [];
  for (const s of parseChips(value, chips)) if (!out.includes(s.n)) out.push(s.n);
  return out;
};

/** The chips the draft sends that have no saved file yet, each once, in field order. A chip removed from the draft is
 *  not sent, so it is never saved. */
export const pastesToSave = (value: string, chips: PasteChips, saved: SavedPastes): number[] =>
  sentNumbers(value, chips).filter((n) => !saved.has(n));

/** The pointer for chip `n` saved at `path`, or null when it would not read back as this session's own or is too long. */
const pointerOf = (path: string, lines: number, sessionId: string): string | null => {
  const line = pastePointer(path, lines);
  return line.length <= PASTE_POINTER_MAX && readPastePointer(line, sessionId)?.path === path ? line : null;
};

/** The text a send of `value` goes out as, every chip a pointer in its place, or why it cannot be built. */
export function pointerSend(value: string, chips: PasteChips, saved: SavedPastes, sessionId: string): PointerSend {
  const unsaved = pastesToSave(value, chips, saved);
  if (unsaved.length > 0) return { kind: 'unsaved', numbers: unsaved };
  const pointers = new Map<number, string>();
  const bad: number[] = [];
  for (const n of sentNumbers(value, chips)) {
    const line = pointerOf(saved.get(n)!, chips.get(n)!.lines, sessionId);
    if (line === null) bad.push(n);
    else pointers.set(n, line);
  }
  if (bad.length > 0) return { kind: 'unpointable', numbers: bad };
  let out = '';
  let breakNext = false;
  const add = (piece: string, isPointer: boolean): void => {
    if (piece === '') return;
    // At the very start `out` is empty and a break would be added, but the trim below takes it: no case for it.
    const needBefore = (breakNext || isPointer) && !out.endsWith('\n') && !piece.startsWith('\n');
    out += (needBefore ? '\n' : '') + piece;
    breakNext = isPointer;
  };
  let at = 0;
  for (const c of parseChips(value, chips)) {
    add(stripMarkers(value.slice(at, c.start)), false);
    add(pointers.get(c.n)!, true);
    at = c.end;
  }
  add(stripMarkers(value.slice(at)), false);
  return { kind: 'ready', text: out.trim() };
}

/** The size a pasted text is saved at: its UTF-8 bytes, which is what the upload carries and what the limit counts. */
export const pasteBytes = (text: string): number => new TextEncoder().encode(text).length;
