// The pasted-text pointer (desktop-polish wave 194; the operator's choice of 2026-11-27, item 719, and the design they
// approved, item 729). L0 vocabulary, context C3 (Session Conversation): it imports only the clip path's shape from
// `shared/api.ts`, and the console bundles it.
//
// A long paste no longer reaches the session's input box as its text. At Send the composer saves each paste chip's text
// as a `.txt` clip in the session's own folder (the existing upload, under the neutral name `PASTE_UPLOAD_NAME`), and
// the sent text carries, in the chip's place and on a line of its own, ONE pointer line naming that file:
//
//   The pasted text (214 lines) is in <path>; read that file as part of this message.
//
// THE ONE GRAMMAR. The composer writes it (`pastePointer`) and the chat reads it (`readPastePointer`,
// `splitPastePointers`); nothing else spells it. A line is a pointer only when it is the whole grammar AND its path is
// a `-paste.txt` clip in THIS session's own clips folder: a look-alike typed by hand, one naming another session or any
// other file, or one sharing its line with other words is text, drawn as text. The chat builds the link from the
// session id and the file name alone (`clipUrl`), so even a hand-typed pointer can open nothing but this session's own
// clips.
//
// THE SENDER. The words never contain `[Pasted text #`, the shape the sender reads as Claude Code's OWN paste label
// (`server/src/inject/send.ts`), and a line stays under `PASTE_POINTER_MAX`, half that file's collapse floor; the
// server case `paste-pointer-send.test.ts` runs the sender's own patterns over pointers.
//
// SECRETS. A paste may hold one: the pointer carries a count and a path, never a character of the paste.
import { CLIP_PATH_RE } from './api.js';

/** The name the composer uploads a pasted text under: the server keeps its stem (`paste`), so the stored name is
 *  `clip-<stamp>-<rand>-paste.txt` and carries no word of the paste. */
export const PASTE_UPLOAD_NAME = 'paste.txt';

/** The longest pointer line the composer sends: the words are under 90 characters, the rest is the path. Half the
 *  sender's collapse floor (`PASTE_COLLAPSE_FLOOR`, 800), so Claude Code never folds a pointer into a paste label. */
export const PASTE_POINTER_MAX = 400;

/** The stored name's tail a pointer must end in: the neutral stem and the `.txt` extension. */
const PASTE_NAME_TAIL = '-paste.txt';

const HEAD = 'The pasted text (';
const TAIL = '; read that file as part of this message.';

/** "1 line", "214 lines". */
const linesWord = (lines: number): string => `${String(lines)} ${lines === 1 ? 'line' : 'lines'}`;

/** The pointer line for a pasted text of `lines` lines saved at `path` (the path the upload answered, as it is). */
export function pastePointer(path: string, lines: number): string {
  return `${HEAD}${linesWord(lines)}) is in ${path}${TAIL}`;
}

/** A pointer the chat may draw: the saved file's path, its name, and the line count the pointer said. */
export interface PastePointer {
  readonly path: string;
  readonly name: string;
  readonly lines: number;
}

const POINTER_RE = /^The pasted text \(([1-9]\d{0,8}) (lines?)\) is in (\S+); read that file as part of this message\.$/;
const WHOLE_CLIP_PATH = new RegExp(`^(?:${CLIP_PATH_RE.source})$`);

/** `line` read as a pointer of session `sessionId`, or null when it is anything else (then it is text). The session
 *  folder is compared as one whole path segment, so an id that is not a plain segment (empty, `.`, `..`, or holding a
 *  `/`) can never match: the path pattern admits no empty segment and no `/` inside one, and the dot segments are
 *  refused below. */
export function readPastePointer(line: string, sessionId: string): PastePointer | null {
  const m = POINTER_RE.exec(line);
  if (m === null) return null;
  const lines = Number(m[1]);
  if ((m[2] === 'line') !== (lines === 1)) return null;
  const path = m[3]!;
  // The whole path is a clip path: it ends `/.cc-clips/<folder>/clip-<name>.<ext>`, so the last three segments are
  // the store, the session's folder and the file.
  if (!WHOLE_CLIP_PATH.test(path)) return null;
  const segs = path.split('/');
  // No `.` or `..` segment anywhere: the clips store is named by plain segments only.
  if (segs.some((s) => s === '.' || s === '..')) return null;
  const name = segs[segs.length - 1]!;
  if (segs[segs.length - 2] !== sessionId) return null;
  if (!name.endsWith(PASTE_NAME_TAIL)) return null;
  return { path, name, lines };
}

/** Whether `line` is a pointer of the session its own path names. For the chat list's row PRICING only, which knows
 *  no session: it never decides what is drawn or linked, which `readPastePointer` with the real session id does. */
export function isPastePointerLine(line: string): boolean {
  const folder = POINTER_RE.exec(line)?.[3]?.split('/').at(-2);
  return folder !== undefined && readPastePointer(line, folder) !== null;
}

/** One part of a user turn, in order: its text, or a pointer the chat draws as a chip in that place. */
export type TurnPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'paste'; readonly pointer: PastePointer };

/** A turn's text split at every line that reads as a pointer of this session. The lines between pointers come back
 *  as one text part, byte for byte; a turn with no pointer is one text part holding the whole text. */
export function splitPastePointers(text: string, sessionId: string): TurnPart[] {
  if (!text.includes(HEAD)) return [{ kind: 'text', text }];
  const out: TurnPart[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push({ kind: 'text', text: run.join('\n') });
    run = [];
  };
  for (const line of text.split('\n')) {
    const pointer = readPastePointer(line, sessionId);
    if (pointer === null) {
      run.push(line);
      continue;
    }
    flush();
    out.push({ kind: 'paste', pointer });
  }
  flush();
  return out;
}
