// The pasted-text pointer (desktop-polish wave 194): a long paste goes to the session as a saved `.txt` clip, and the
// sent text carries one line pointing at it in the chip's place. This file pins the one grammar
// (`shared/pastePointer.ts`), written by the composer and read by the chat: its exact words, the line count's word,
// the read that admits only a whole-line pointer to THIS session's own `-paste.txt` clip, the hostile near misses that
// stay text, and the split of a turn into text and pointers in order. What the sender makes of the line is the server
// half, `server/test/paste-pointer-send.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  PASTE_POINTER_MAX, PASTE_UPLOAD_NAME, pastePointer, readPastePointer, splitPastePointers,
} from '../../shared/pastePointer';

const SID = 'acct-a-project-a';
const NAME = 'clip-20261127-153012-1a2b3c4d-paste.txt';
const PATH = `/home/user-a/.cc-clips/${SID}/${NAME}`;

describe('the pointer words', () => {
  it('says the count, the path and that the file is part of the message', () => {
    expect(pastePointer(PATH, 214)).toBe(
      `The pasted text (214 lines) is in ${PATH}; read that file as part of this message.`,
    );
  });

  it('says one line in the singular', () => {
    expect(pastePointer(PATH, 1)).toBe(
      `The pasted text (1 line) is in ${PATH}; read that file as part of this message.`,
    );
  });

  it('uploads under a neutral name that carries no word of the paste', () => {
    expect(PASTE_UPLOAD_NAME).toBe('paste.txt');
  });

  it('states its length bound under the collapse floor the sender reads (800)', () => {
    expect(PASTE_POINTER_MAX).toBe(400);
  });
});

describe('reading a pointer', () => {
  it('reads its own writing back for this session', () => {
    expect(readPastePointer(pastePointer(PATH, 214), SID)).toEqual({ path: PATH, name: NAME, lines: 214 });
    expect(readPastePointer(pastePointer(PATH, 1), SID)).toEqual({ path: PATH, name: NAME, lines: 1 });
  });

  it('reads nothing for another session, even one whose id is a prefix or a suffix of this one', () => {
    const other = `/home/user-a/.cc-clips/acct-b-project-a/${NAME}`;
    expect(readPastePointer(pastePointer(other, 3), SID)).toBeNull();
    expect(readPastePointer(pastePointer(PATH, 3), 'acct-a-project')).toBeNull();
    expect(readPastePointer(pastePointer(PATH, 3), `${SID}-x`)).toBeNull();
  });

  it('reads nothing for a clip that is not a pasted text', () => {
    for (const name of [
      'clip-20261127-153012-1a2b3c4d-notes.txt', 'clip-20261127-153012-1a2b3c4d-paste.md',
      'clip-20261127-153012-1a2b3c4d-paste.png', 'clip-20261127-153012-1a2b3c4d.txt',
    ]) expect(readPastePointer(pastePointer(`/home/user-a/.cc-clips/${SID}/${name}`, 3), SID)).toBeNull();
  });

  it('reads nothing for a path outside the clips store or one that climbs', () => {
    for (const p of [
      `/home/user-a/.ssh/${NAME}`, `/home/user-a/.cc-clips/${SID}/../${SID}/${NAME}`,
      `/home/user-a/.cc-clips/../.cc-clips/${SID}/x/${NAME}`, `.cc-clips/${SID}/${NAME}`,
      `/home/user-a/../.cc-clips/${SID}/${NAME}`, `/home/./user-a/.cc-clips/${SID}/${NAME}`,
      `/home/user-a/.cc-clips/${SID}/${NAME}/`, `https://example.invalid/.cc-clips/${SID}/${NAME}`,
    ]) expect(readPastePointer(pastePointer(p, 3), SID)).toBeNull();
  });

  it('reads nothing for a near miss of the words', () => {
    const near = [
      `The pasted text (1 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (2 line) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (0 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (07 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (1234567890 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (3 lines) is in ${PATH}; read that file as part of this message`,
      ` The pasted text (3 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (3 lines) is in ${PATH}; read that file as part of this message. ok`,
      `the pasted text (3 lines) is in ${PATH}; read that file as part of this message.`,
      `The pasted text (3 lines) is in ${PATH} ; read that file as part of this message.`,
      `The pasted text (3 lines) is in ${PATH} ${PATH}; read that file as part of this message.`,
    ];
    for (const line of near) expect(readPastePointer(line, SID), line).toBeNull();
  });

  it('reads nothing across a line break', () => {
    expect(readPastePointer(`${pastePointer(PATH, 3)}\nmore`, SID)).toBeNull();
  });

  it('reads nothing for a bidi character, a newline or a carriage return in the file name', () => {
    for (const odd of ['‮', '⁦', '\n', '\r']) {
      const name = `clip-20261127-153012-1a2b${odd}3c4d-paste.txt`;
      expect(readPastePointer(pastePointer(`/home/user-a/.cc-clips/${SID}/${name}`, 3), SID), JSON.stringify(odd)).toBeNull();
    }
  });

  it('accepts a bidi character in the path\'s prefix, and the name it answers holds none of the prefix', () => {
    const read = readPastePointer(pastePointer(`/home/user-a‮/.cc-clips/${SID}/${NAME}`, 3), SID);
    expect(read?.name).toBe(NAME);
  });

  it('reads nothing for an empty or unsafe session id', () => {
    expect(readPastePointer(pastePointer(PATH, 3), '')).toBeNull();
    expect(readPastePointer(pastePointer(`/home/user-a/.cc-clips/../${NAME}`, 3), '..')).toBeNull();
  });
});

describe('splitting a turn into text and pointers', () => {
  it('hands a turn with no pointer back whole, as one text part', () => {
    const t = '  indented\n\nsee /home/user-a/.cc-clips/x/clip-1.png\n';
    expect(splitPastePointers(t, SID)).toEqual([{ kind: 'text', text: t }]);
  });

  it('keeps the pointer in its place between the text around it', () => {
    const t = `before\n${pastePointer(PATH, 214)}\nafter\nmore`;
    expect(splitPastePointers(t, SID)).toEqual([
      { kind: 'text', text: 'before' },
      { kind: 'paste', pointer: { path: PATH, name: NAME, lines: 214 } },
      { kind: 'text', text: 'after\nmore' },
    ]);
  });

  it('gives two pointers in order, with nothing invented between them', () => {
    const p2 = PATH.replace('1a2b3c4d', '5e6f7a8b');
    const t = `${pastePointer(PATH, 14)}\n${pastePointer(p2, 1)}`;
    expect(splitPastePointers(t, SID)).toEqual([
      { kind: 'paste', pointer: { path: PATH, name: NAME, lines: 14 } },
      { kind: 'paste', pointer: { path: p2, name: NAME.replace('1a2b3c4d', '5e6f7a8b'), lines: 1 } },
    ]);
  });

  it('leaves a typed look-alike for another session as text', () => {
    const fake = pastePointer(`/home/user-a/.cc-clips/acct-b/${NAME}`, 3);
    expect(splitPastePointers(`hi\n${fake}`, SID)).toEqual([{ kind: 'text', text: `hi\n${fake}` }]);
  });

  it('leaves a pointer that shares its line with other words as text', () => {
    const t = `look: ${pastePointer(PATH, 3)}`;
    expect(splitPastePointers(t, SID)).toEqual([{ kind: 'text', text: t }]);
  });
});
