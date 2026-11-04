// The UTF-8 byte counter (desktop-polish carry, review 1389 A6, D-7950). CHARACTERIZATION, pinned green on main before the
// counters were folded into one owner: the count is what an encoder writes, a surrogate pair is 4 bytes, and a lone
// surrogate is 3 (an encoder writes U+FFFD for it). Every copy that was folded counted the same way, so this is the
// answer each of them gave.
import { describe, it, expect } from 'vitest';
import { utf8Bytes } from '../../shared/utf8.js';

const CORPUS: readonly string[] = [
  '', 'a', 'plain ascii', '\u007f', '\u0080', 'é', '\u07ff', '\u0800', '€', '\uffff', '日本語',
  '😀', 'a😀b', '\u{10ffff}', '\ud83d', '\ude00', 'x\ud83d', '\ude00x', '\ud83d\ud83d', '\ude00\ud83d', 'mixé€😀\ud800end',
];

describe('the UTF-8 byte counter', () => {
  it('counts what an encoder writes, for every string in the corpus', () => {
    for (const s of CORPUS) expect(utf8Bytes(s), JSON.stringify(s)).toBe(new TextEncoder().encode(s).length);
  });
  it('counts a surrogate pair 4 and a lone surrogate 3', () => {
    expect(utf8Bytes('😀')).toBe(4);
    expect(utf8Bytes('\ud83d')).toBe(3);
    expect(utf8Bytes('\ude00')).toBe(3);
    expect(utf8Bytes('\ude00\ud83d')).toBe(6);
  });
});
