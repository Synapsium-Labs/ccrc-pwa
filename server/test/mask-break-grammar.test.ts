// D-8749 — THE MASKER READS A ROW BREAK BACK THE WAY `ROW_BREAK` READS IT FORWARD (desktop polish Task C45).
//
// MEASURED (review 2445 F2; `docs/superpowers/programs/desktop-polish/c45.md`): `breakStartAt` reads a row break back
// from its last byte, and its docstring said it reads every break as `ROW_BREAK` reads it forward; nothing pinned that.
// A brute force over every string of 1 to 8 bytes over x, LF, CR, space, NUL and tab (2,015,538 strings, 4,333,419
// forward breaks; the tab since review 2514 F6) agreed on every forward break but one family: a CR LF (or CR CR LF),
// blanks (or none), then a CR (76,511). Forward, the CR LF is one break, the blanks a blank row, the CR another break;
// back from that CR, `breakStartAt` reads LF, blanks, CR as one break starting at the LF. Its second member (507, since
// review 2585 F1): a CR LF, blanks, then a CR CR LF, which back from its LF reads from its second CR, as `main` read every
// CR CR LF, so the cap's step back reads the first CR through the first member and crosses the blank row. Kept:
// a reader that walks back over breaks steps further back, onto the row before, which can only join more rows to a
// key's chain (fail closed), and the readers that stop there read the LF's CR as text before the run, as forward. This
// row pins the agreement everywhere else and the one difference exactly, so a change to either side is a red suite.
// One direction only (review 2514 F7): at indexes where no forward break ends (a LF that a CR may follow, say; 906,983
// of them), `breakStartAt` still answers a start, the start of the break that byte would be in. Harmless:
// each caller passes an index just after a LF or a CR and reads forward from the start it is given, or steps further
// back (review 2585 F8).
import { describe, it, expect } from 'vitest';
import { ROW_BREAK } from '../src/accounts/shapes.js';
import { breakStartAt } from '../src/accounts/mask.js';
import { parsedFile } from './scan/symbols.js';

const ALPHABET = ['x', '\n', '\r', ' ', '\0', '\t'] as const;
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
/** The one family where the readings differ, after a CR LF and blanks: a forward CR alone at `s` (blanks or none), which
 *  `breakStartAt` reads back to the CR LF's LF; or a forward CR CR LF at `s` (one blank or more), which it reads back to
 *  its second CR, as `main` read every CR CR LF (review 2585 F1). The member's name and the start read back, or null. */
const keptFamily = (t: string, s: number, e: number): { member: 'cr' | 'crcrlf'; back: number } | null => {
  let k = s;
  while (k > 0 && (t[k - 1] === ' ' || t[k - 1] === '\t' || t[k - 1] === '\0')) k--;
  if (k < 2 || t[k - 1] !== '\n' || t[k - 2] !== '\r') return null;
  if (e === s + 1 && t[s] === '\r') return { member: 'cr', back: k - 1 };
  if (e === s + 3 && t.startsWith('\r\r\n', s) && k < s) return { member: 'crcrlf', back: s + 1 };
  return null;
};

describe('D-8749 — breakStartAt reads each row break back to where ROW_BREAK reads it from (review 2445 F2)', () => {
  it('every string of 1 to 8 bytes over x, LF, CR, space, NUL and tab: one start, but for the CR LF, blanks, CR or CR CR LF family', () => {
    const forward = new RegExp(ROW_BREAK, 'g');
    let breaks = 0;
    const family = { cr: 0, crcrlf: 0 };
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
          const f = keptFamily(t, s, e);
          if (f !== null && back === f.back) { family[f.member]++; continue; }
          if (other.length < 5) other.push(`${JSON.stringify(t)}: forward [${s}, ${e}), back ${back}`);
        }
      }
    }
    expect(breaks).toBeGreaterThan(4_000_000);
    expect(other).toEqual([]);
    // The difference is real and exactly this family: forward reads CR LF then CR, back reads LF CR as one break; forward
    // reads CR LF, blanks, CR CR LF, back reads the CR CR LF from its second CR.
    expect(family).toEqual({ cr: 76_511, crcrlf: 507 });
    expect(breakStartAt('\r\n\r', 3)).toBe(1);
    expect(breakStartAt('\r\n \r', 4)).toBe(1);
    expect(breakStartAt('\r\n\0\r', 4)).toBe(1);
    // and nowhere else: a LF, blanks, then a CR with no CR before the LF is one break forward too.
    expect(breakStartAt('x\n \rx', 4)).toBe(1);
    expect(breakStartAt('x\r\rx', 3)).toBe(2);
    // A CR CR LF is one break, forward and back (review 2445 F4), unless its first CR ends a LF, blanks, CR break: then
    // that break and a CR LF, two breaks with no row between, which the chain walk steps through (review 2514 F1).
    const crcrlf = new RegExp(ROW_BREAK, 'g');
    expect([...'x\r\r\nx'.matchAll(crcrlf)].map((m) => [m.index, m[0]])).toEqual([[1, '\r\r\n']]);
    expect([...'\n \r\r\nx'.matchAll(crcrlf)].map((m) => [m.index, m[0]])).toEqual([[0, '\n \r'], [3, '\r\n']]);
    expect([...'x\n\t\r\r\nx'.matchAll(crcrlf)].map((m) => [m.index, m[0]])).toEqual([[1, '\n\t\r'], [4, '\r\n']]);
    expect(breakStartAt('x\r\r\nx', 4)).toBe(1);
    expect(breakStartAt('\n \r\r\nx', 5)).toBe(3);
    expect(breakStartAt('x\n\t\r\r\nx', 6)).toBe(4);
    // The LF is the CR LF's, so forward is CR LF, a blank, CR CR LF; back from it, the second CR: the family's second member.
    expect(breakStartAt('\r\n \r\r\nx', 6)).toBe(4);
    expect(breakStartAt('\r\n\r\r\nx', 5)).toBe(2);   // no blank between: one CR CR LF, as forward
    expect(breakStartAt('x\r\r\r\nx', 5)).toBe(2);
    // A tab is a blank to both readers (review 2514 F6: the alphabet had none, so dropping it from the CR arm stayed green).
    expect(breakStartAt('x\n\t\rx', 4)).toBe(1);
  });

  it('the slice lookahead\'s BREAK_REST is built from the grammar\'s LF_BREAK_REST, never a copy of it (review 2585 F3)', () => {
    // A hand-written copy (the 20775879e lookahead, or one without the tab) leaves every row green: this source pin is what
    // reds it. `mask.ts` holds no other expression for the rest of a LF, blanks, CR break.
    const mask = parsedFile('server/src/accounts/mask.ts');
    expect(mask.bindings.filter((b) => b.name === 'BREAK_REST').map((b) => b.init)).toEqual(['new RegExp(`^(?:${LF_BREAK_REST})`)']);
    expect(mask.text.match(/\[ \\t\\0\]\*\\r/g) ?? []).toEqual([]);
  });

  it('no row break ends at a byte that is not a LF or a CR', () => {
    for (const t of ['x', 'x ', 'x\0', '\n ', '\r\0']) expect(breakStartAt(t, t.length), JSON.stringify(t)).toBe(null);
  });
});
