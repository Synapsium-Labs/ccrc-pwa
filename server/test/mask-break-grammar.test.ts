// D-8749 — THE MASKER READS A ROW BREAK BACK THE WAY `ROW_BREAK` READS IT FORWARD (desktop polish Task C45).
//
// MEASURED (review 2445 F2; `docs/superpowers/programs/desktop-polish/c45.md`): `breakStartAt` reads a row break back
// from its last byte, and its docstring said it reads every break as `ROW_BREAK` reads it forward; nothing pinned that.
// A brute force over every string of 1 to 8 bytes over x, LF, CR, space and NUL agreed on every forward break but one
// family: a CR LF (or CR CR LF), blanks (or none), then a CR. Forward, the CR LF is one break, the blanks a blank row,
// the CR another break; back from that CR, `breakStartAt` reads LF, blanks, CR as one break starting at the LF. Kept: a reader
// that walks back over breaks steps further back, onto the row before, which can only join more rows to a key's chain
// (fail closed), and the readers that stop there read the LF's CR as text before the run, as forward. This row pins the
// agreement everywhere else and the one difference exactly, so a change to either side is a red suite.
import { describe, it, expect } from 'vitest';
import { ROW_BREAK } from '../src/accounts/shapes.js';
import { breakStartAt } from '../src/accounts/mask.js';

const ALPHABET = ['x', '\n', '\r', ' ', '\0'] as const;
/** Every string of `n` bytes over `ALPHABET`. */
function* stringsOf(n: number): Generator<string> {
  const idx = new Array<number>(n).fill(0);
  for (;;) {
    yield idx.map((i) => ALPHABET[i]).join('');
    let k = n - 1;
    while (k >= 0 && idx[k] === ALPHABET.length - 1) idx[k--] = 0;
    if (k < 0) return;
    idx[k]!++;
  }
}
/** The one family where the readings differ: a forward CR alone at `s` that a CR LF and blanks come before. */
const crAfterCrLfBlanks = (t: string, s: number, e: number): number | null => {
  if (e !== s + 1 || t[s] !== '\r') return null;
  let k = s;
  while (k > 0 && (t[k - 1] === ' ' || t[k - 1] === '\t' || t[k - 1] === '\0')) k--;
  return k >= 2 && t[k - 1] === '\n' && t[k - 2] === '\r' ? k - 1 : null;
};

describe('D-8749 — breakStartAt reads each row break back to where ROW_BREAK reads it from (review 2445 F2)', () => {
  it('every string of 1 to 8 bytes over x, LF, CR, space and NUL: the same start, but for the CR LF, blanks, CR family', () => {
    const forward = new RegExp(ROW_BREAK, 'g');
    let breaks = 0;
    const family: string[] = [];
    const other: string[] = [];
    for (let n = 1; n <= 8; n++) {
      for (const t of stringsOf(n)) {
        forward.lastIndex = 0;
        for (let m = forward.exec(t); m !== null; m = forward.exec(t)) {
          const s = m.index;
          const e = s + m[0].length;
          breaks++;
          const back = breakStartAt(t, e);
          if (back === s) continue;
          const f = crAfterCrLfBlanks(t, s, e);
          if (f !== null && back === f) { if (family.length < 3) family.push(JSON.stringify(t)); continue; }
          if (other.length < 5) other.push(`${JSON.stringify(t)}: forward [${s}, ${e}), back ${back}`);
        }
      }
    }
    expect(breaks).toBeGreaterThan(400_000);
    expect(other).toEqual([]);
    // The difference is real and exactly this family: forward reads CR LF then CR, back reads LF CR as one break.
    expect(family.length).toBeGreaterThan(0);
    expect(breakStartAt('\r\n\r', 3)).toBe(1);
    expect(breakStartAt('\r\n \r', 4)).toBe(1);
    expect(breakStartAt('\r\n\0\r', 4)).toBe(1);
    // and nowhere else: a LF, blanks, then a CR with no CR before the LF is one break forward too.
    expect(breakStartAt('x\n \rx', 4)).toBe(1);
    expect(breakStartAt('x\r\rx', 3)).toBe(2);
    // A CR CR LF is one break, forward and back (review 2445 F4); a LF, blanks, CR is not one when a CR LF follows it.
    const crcrlf = new RegExp(ROW_BREAK, 'g');
    expect([...'x\r\r\nx'.matchAll(crcrlf)].map((m) => [m.index, m[0]])).toEqual([[1, '\r\r\n']]);
    expect([...'\n \r\r\nx'.matchAll(crcrlf)].map((m) => [m.index, m[0]])).toEqual([[0, '\n'], [2, '\r\r\n']]);
    expect(breakStartAt('x\r\r\nx', 4)).toBe(1);
    expect(breakStartAt('\n \r\r\nx', 5)).toBe(2);
    expect(breakStartAt('x\r\r\r\nx', 5)).toBe(2);
  });

  it('no row break ends at a byte that is not a LF or a CR', () => {
    for (const t of ['x', 'x ', 'x\0', '\n ', '\r\0']) expect(breakStartAt(t, t.length), JSON.stringify(t)).toBe(null);
  });
});
