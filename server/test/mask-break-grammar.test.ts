// D-8749 — THE MASKER READS A ROW BREAK BACK THE WAY `ROW_BREAK` READS IT FORWARD (desktop polish Task C45).
//
// MEASURED (review 2445 F2; `docs/superpowers/programs/desktop-polish/c45.md`): `breakStartAt` reads a row break back
// from its last byte, and its docstring said it reads every break as `ROW_BREAK` reads it forward; nothing pinned that.
// A brute force over every string of 1 to 8 bytes over x, LF, CR, space, NUL and tab (2,015,538 strings, 4,333,419
// forward breaks; the tab since review 2514 F6) agreed on every forward break but one family: a CR LF (or CR CR LF),
// blanks (or none), then a CR (76,511 breaks). Forward, the CR LF is one break, the blanks a blank row, the CR another
// break; back from that CR, `breakStartAt` reads LF, blanks, CR as one break starting at the LF. Its second member (507
// breaks, since review 2585 F1): a CR LF, blanks, then a CR CR LF; its third (985 breaks, since review 2644 F1): a CR LF
// right before a CR CR LF. Back from its LF each reads the CR CR LF from its second CR, as `main` read every CR CR LF,
// so the cap's step back reads the first CR through the first member and crosses the blank row. Kept:
// a reader that walks back over breaks steps further back, onto the row before, which can only join more rows to a
// key's chain (fail closed), and the readers that stop there read the LF's CR as text before the run, as forward. This
// row pins the agreement everywhere else and the one difference exactly, so a change to either side is a red suite,
// and the step back's end against `main`'s reading from every LF or CR: never short of it, never further.
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
/** The one family where the readings differ, after a CR LF: a forward CR alone at `s` (blanks or none before it), which
 *  `breakStartAt` reads back to the CR LF's LF; or a forward CR CR LF at `s`, which it reads back to its second CR, as
 *  `main` read every CR CR LF: after blanks (review 2585 F1) or right after the CR LF (review 2644 F1). The member's
 *  name and the start read back, or null. */
const keptFamily = (t: string, s: number, e: number): { member: 'cr' | 'crcrlf' | 'crlfcrcrlf'; back: number } | null => {
  let k = s;
  while (k > 0 && (t[k - 1] === ' ' || t[k - 1] === '\t' || t[k - 1] === '\0')) k--;
  if (k < 2 || t[k - 1] !== '\n' || t[k - 2] !== '\r') return null;
  if (e === s + 1 && t[s] === '\r') return { member: 'cr', back: k - 1 };
  if (e === s + 3 && t.startsWith('\r\r\n', s)) return { member: k < s ? 'crcrlf' : 'crlfcrcrlf', back: s + 1 };
  return null;
};
/** Where the cap's step back (`maskTextSliced`'s lookahead: `for (s = breakStartAt(t, i); s !== null; …) i = s`) ends,
 *  from an index just after a LF or a CR, through `start`. */
const stepBack = (t: string, i: number, start: (t: string, j: number) => number | null): number => {
  for (let s = start(t, i); s !== null; s = start(t, i)) i = s;
  return i;
};
/** `main`'s reading, for the step back's comparison: every LF with a CR before it is a CR LF, read back to that CR; every
 *  other end as `breakStartAt` reads it (its LF-alone and CR arms are `main`'s). */
const mainStartAt = (t: string, j: number): number | null =>
  t[j - 1] === '\n' && j >= 2 && t[j - 2] === '\r' ? j - 2 : breakStartAt(t, j);

describe('D-8749 — breakStartAt reads each row break back to where ROW_BREAK reads it from (review 2445 F2)', () => {
  it('every string of 1 to 8 bytes over x, LF, CR, space, NUL and tab: one start, but for the CR LF, blanks or none, then CR or CR CR LF family', () => {
    const forward = new RegExp(ROW_BREAK, 'g');
    let breaks = 0;
    const family = { cr: 0, crcrlf: 0, crlfcrcrlf: 0 };
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
    // reads CR LF, blanks or none, CR CR LF, back reads the CR CR LF from its second CR. Counts are breaks.
    expect(family).toEqual({ cr: 76_511, crcrlf: 507, crlfcrcrlf: 985 });
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
    // No blank between, the family's third member (review 2644 F1): forward CR LF then one CR CR LF, back from the second CR.
    expect(breakStartAt('\r\n\r\r\nx', 5)).toBe(3);
    expect(breakStartAt('x\n\r\r\nx', 5)).toBe(3);   // a bare LF: LF CR, then CR LF, forward too
    expect(breakStartAt('x\r\r\r\nx', 5)).toBe(2);
    // A tab is a blank to both readers (review 2514 F6: the alphabet had none, so dropping it from the CR arm stayed green).
    expect(breakStartAt('x\n\t\rx', 4)).toBe(1);
  });

  it('the cap\'s step back ends where main\'s does, from every LF or CR of every string of 1 to 8 bytes (review 2644 F1)', () => {
    // The kept family fails closed only if the step back never stops short of `main`'s reading (a blank row read as the
    // key's end: the whole key in pane history, reviews 2585 F1 and 2644 F1) and never goes further than it.
    let points = 0;
    const short: string[] = [];
    const further: string[] = [];
    for (let n = 1; n <= 8; n++) {
      for (const t of stringsOf(n)) {
        for (let i = 1; i <= n; i++) {
          if (t[i - 1] !== '\n' && t[i - 1] !== '\r') continue;
          points++;
          const tip = stepBack(t, i, breakStartAt);
          const main = stepBack(t, i, mainStartAt);
          if (tip > main && short.length < 5) short.push(`${JSON.stringify(t)} from ${i}: ${tip}, main ${main}`);
          if (tip < main && further.length < 5) further.push(`${JSON.stringify(t)} from ${i}: ${tip}, main ${main}`);
        }
      }
    }
    expect(points).toBeGreaterThan(4_000_000);
    expect(short).toEqual([]);
    expect(further).toEqual([]);
    // The two forms the reviews found, end to end: the step back crosses the blank row to the key's run, as `main` did.
    for (const t of ['k\r\n \r\r\n', 'k\r\n \r\n\r\r\n', 'k\r\n \r\n\r\n\r\r\n']) expect(stepBack(t, t.length, breakStartAt), JSON.stringify(t)).toBe(1);
  });

  it('the slice lookahead\'s BREAK_REST is built from the grammar\'s LF_BREAK_REST, never a copy of it (review 2585 F3)', () => {
    // A hand-written copy (the 20775879e lookahead, or one without the tab) leaves every row green: this source pin is what
    // reds it. No binding of `mask.ts` holds another expression for the rest of a LF, blanks, CR break.
    const mask = parsedFile('server/src/accounts/mask.ts');
    expect(mask.bindings.filter((b) => b.name === 'BREAK_REST').map((b) => b.init)).toEqual(['new RegExp(`^(?:${LF_BREAK_REST})`)']);
    // No other binding is built from a copy of the class (review 2644 M1: scoped to initialisers, so a comment may quote it).
    expect(mask.bindings.filter((b) => b.init.includes('[ \\t\\0]*\\r')).map((b) => b.name)).toEqual([]);
  });

  it('no row break ends at a byte that is not a LF or a CR', () => {
    for (const t of ['x', 'x ', 'x\0', '\n ', '\r\0']) expect(breakStartAt(t, t.length), JSON.stringify(t)).toBe(null);
  });
});
