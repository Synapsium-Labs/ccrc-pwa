// The ladder's two single-definition guards (Overlord W1 ladder, plan `w1-ladder.md` Task 1, question 23 and ruling F15).
// (1) Each rung's `needs` word is a word the server advertises (`SERVER_CAPS`) or one named, shrink-only list says no
//     build carries yet (`RUNG_WORDS_NOT_YET_SHIPPED`), never both and never neither, and each is spelled in the spec's
//     Table 11.1d. Without it a typo leaves a rung unreachable with no red test. It reads a `docs/` file, so it lives
//     where `.github/ci/fast-plan.mjs#GUARD_TESTS` runs it on every fast pull request.
// (2) One home for the rung words and for the rung cells: no `'off' | 'chat' | 'advise' | 'full'` union and no SQL `IN`
//     list of the four words is spelled outside `shared/overlord-ladder.ts` (the tables carry no CHECK on the rung
//     words; the writer validates against `RUNGS`), and `RUNG_MAP` and `RUNG_CELL_MAP` are defined once.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SERVER_CAPS } from '../../../shared/api.js';
import { RUNGS, RUNG_WORDS_NOT_YET_SHIPPED, rungNeeds } from '../../../shared/overlord-ladder.js';
import { ALL, ccrcRoot, rel } from './helpers.js';

const SPEC = path.join(ccrcRoot, 'docs/superpowers/specs/2026-11-09-overlord-design.md');

/** The text of Table 11.1d: the lines from Table 11.1c's caption to Table 11.1d's caption, both found by their italic
 *  caption lines. */
function table11_1d(): string {
  const text = readFileSync(SPEC, 'utf8');
  const start = text.indexOf('*Table 11.1c. Ports, adapters, lanes and processes.*');
  const end = text.indexOf('*Table 11.1d. Capability words, switches and settings.');
  expect(start, 'the caption of Table 11.1c is gone').toBeGreaterThan(-1);
  expect(end, 'the caption of Table 11.1d is gone').toBeGreaterThan(start);
  const body = text.slice(start, end);
  expect(body.length, 'Table 11.1d reads as empty').toBeGreaterThan(1000);
  return body;
}

const NEEDS = RUNGS.map(rungNeeds).filter((w): w is string => w !== null);
const NOT_YET = Object.keys(RUNG_WORDS_NOT_YET_SHIPPED);
const shipped = (w: string): boolean => (SERVER_CAPS as readonly string[]).includes(w);

describe('the rung `needs` words are checked (question 23)', () => {
  it('CONTROL: there are needs words to check, and the spec table was read', () => {
    expect(NEEDS.length).toBeGreaterThan(0);
    expect(table11_1d()).toContain('Capability words');
  });
  it('every needs word is in SERVER_CAPS or in RUNG_WORDS_NOT_YET_SHIPPED, never both and never neither', () => {
    const neither = NEEDS.filter((w) => !shipped(w) && !NOT_YET.includes(w));
    const both = NEEDS.filter((w) => shipped(w) && NOT_YET.includes(w));
    expect({ neither, both }).toEqual({ neither: [], both: [] });
  });
  it('the not-yet-shipped list holds only needs words (it is shrink-only: a shipped word leaves it)', () => {
    expect(NOT_YET.filter((w) => !NEEDS.includes(w))).toEqual([]);
    for (const wave of Object.values(RUNG_WORDS_NOT_YET_SHIPPED)) expect(wave).toMatch(/^W\d$/);
  });
  it('each needs word appears in the spec\'s Table 11.1d text', () => {
    const t = table11_1d();
    expect(NEEDS.filter((w) => !t.includes(`\`${w}\``))).toEqual([]);
  });
});

/** Source with line comments and the text of block comments removed, so prose that spells the four words is not a copy. */
const code = (f: string): string =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(code(f))).map(rel).sort();

const HOME = 'shared/overlord-ladder.ts';
// Scan whole consecutive literal lists, rather than one order or quote style. Extra literals are allowed, but all four
// distinct rung words must be in the same list; separate smaller lists must never be joined into a false positive.
const literalList = (separator: '|' | ','): RegExp => {
  const sep = separator === '|' ? String.raw`\|` : ',';
  const literal = String.raw`(?:'[^'\n]*'|"[^"\n]*")`;
  return new RegExp(`${literal}(?:\\s*${sep}\\s*${literal})+`, 'g');
};
const hasRungList = (text: string, separator: '|' | ','): boolean =>
  [...text.matchAll(literalList(separator))].some(([list]) => {
    const words = [...list.matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]);
    return RUNGS.every((r) => words.includes(r));
  });
const rungListHolders = (separator: '|' | ','): string[] =>
  ALL.filter((f) => hasRungList(code(f), separator)).map(rel).sort();

describe('one home for the rung words and the rung cells (F15)', () => {
  it('CONTROL: the scan sees the home file, and a spelled-out union would be found', () => {
    expect(ALL.map(rel)).toContain(HOME);
    expect(hasRungList(`type R = 'off' |\n  'chat' | 'advise' | 'full';`, '|')).toBe(true);
    expect(hasRungList(`type R = "full" | 'off' | "chat" | 'advise';`, '|')).toBe(true);
    expect(hasRungList(`["full", 'advise', "off", 'chat']`, ',')).toBe(true);
    expect(hasRungList(`['extra', 'chat', 'off', 'full', 'advise']`, ',')).toBe(true);
    expect(hasRungList(`'off' | 'chat' | 'advise'`, '|')).toBe(false);
    expect(hasRungList(`['off', 'chat']; ['advise', 'full']`, ',')).toBe(false);
    expect(hasRungList(`['off', 'off', 'chat', 'advise']`, ',')).toBe(false);
  });
  it('no `\'off\' | \'chat\' | \'advise\' | \'full\'` union is spelled anywhere', () => {
    expect(rungListHolders('|')).toEqual([]);
  });
  it('no SQL `IN (...)` list of the four rung words is spelled anywhere', () => {
    expect(holders(new RegExp(String.raw`\bIN\s*\(\s*'off'\s*,\s*'chat'`, 'i'))).toEqual([]);
  });
  it('the four words are spelled as one list in no file (the authority journal reads RUNGS)', () => {
    expect(rungListHolders(',')).toEqual([]);
  });
  it('RUNG_MAP and RUNG_CELL_MAP are defined in the home file and nowhere else', () => {
    expect(holders(/\bconst RUNG_MAP\b/)).toEqual([HOME]);
    expect(holders(/\bconst RUNG_CELL_MAP\b/)).toEqual([HOME]);
    expect(holders(/\bexport const RUNG_CELLS\b/)).toEqual([HOME]);
    expect(holders(/\bexport const RUNGS\b/)).toEqual([HOME]);
  });
});
