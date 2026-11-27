// The ladder's two single-definition guards (Overlord W1 ladder, plan `w1-ladder.md` Task 1, question 23 and ruling F15).
// (1) Each rung's `needs` word is a word the server advertises (`SERVER_CAPS`) or one named, shrink-only list says no
//     build carries yet (`RUNG_WORDS_NOT_YET_SHIPPED`), never both and never neither, and each is spelled in the spec's
//     Table 11.1d. Without it a typo leaves a rung unreachable with no red test. It reads a `docs/` file, so it lives
//     where `.github/ci/fast-plan.mjs#GUARD_TESTS` runs it on every fast pull request.
// (2) One home for the rung words and for the rung cells: no `'off' | 'chat' | 'advise' | 'full'` union and no SQL `IN`
//     list of the four words is spelled outside `shared/overlord-ladder.ts` (the tables carry no CHECK on the rung
//     words; the writer validates against `RUNGS`), and `RUNG_MAP` is defined once. The rung cells moved into the act
//     catalogue (`shared/overlord.ts`, W2 act catalogue A1), which is their one home.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SERVER_CAPS } from '../../../shared/api.js';
import { RUNGS, RUNG_WORDS_NOT_YET_SHIPPED, rungNeeds } from '../../../shared/overlord-ladder.js';
import { OVERLORD_ACT_KIND_LIST } from '../../../shared/overlord.js';
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
const CATALOGUE_HOME = 'shared/overlord.ts';
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
  it('RUNG_MAP is defined in the home file and nowhere else, and the rung cells only in the act catalogue (W2 act catalogue A1)', () => {
    expect(holders(/\bconst RUNG_MAP\b/)).toEqual([HOME]);
    expect(holders(/\bexport const RUNGS\b/)).toEqual([HOME]);
    // The cells moved: the catalogue's map is their one home, and the ladder's old names are gone everywhere, no alias left.
    expect(holders(/\bconst OVERLORD_ACT_KIND_MAP\b/)).toEqual([CATALOGUE_HOME]);
    expect(holders(/\bRUNG_CELL_MAP\b|\bRUNG_CELLS\b|\bLadderActKind\b|\bLADDER_ACT_KINDS\b/)).toEqual([]);
  });
});

// The act catalogue's one home (W2 act catalogue A3, plan §8 "One home"): no other file under the source roots defines a cell
// map, a list of act kinds or a map from class words to covers.
const CELL = String.raw`['"](?:allow|refuse|proposal|armed|by-grant)['"]`;
const CELL_MAP = new RegExp(String.raw`\{\s*chat:\s*${CELL}\s*,\s*advise:\s*${CELL}\s*,\s*full:\s*${CELL}\s*,?\s*\}`);
const CLASS_COVERS_MAP = /\bO[1-6]\s*:\s*\[\s*(?:\]|['"](?:grant|command|operator-request|stated-entry)['"])/;
/** The catalogue's kinds that are not plain words, so a list of three of them is a list of act kinds. */
const DISTINCT_KINDS = new Set<string>(OVERLORD_ACT_KIND_LIST.filter((k) => k.includes('-')));
const hasKindList = (text: string): boolean =>
  [...text.matchAll(literalList(','))].some(([list]) =>
    new Set([...list.matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]).filter((w) => DISTINCT_KINDS.has(w!))).size >= 3);

describe('one home for the act catalogue (W2 act catalogue A3)', () => {
  it('CONTROL: the scans see the catalogue, and a spelled-out copy would be found', () => {
    expect(ALL.map(rel)).toContain(CATALOGUE_HOME);
    expect(DISTINCT_KINDS.size).toBeGreaterThan(10);
    expect(CELL_MAP.test(`const x = { chat: 'refuse', advise: 'proposal', full: 'allow' };`)).toBe(true);
    expect(CELL_MAP.test(`const x = { chat: 'a', advise: 'b', full: 'c' };`)).toBe(false);
    expect(CLASS_COVERS_MAP.test(`const m = { O3: ['grant'], O1: [] };`)).toBe(true);
    expect(hasKindList(`export const K = ['drop-request', 'close-request', 'answer-item'];`)).toBe(true);
    expect(hasKindList(`const K = ['drop-request', 'read', 'acknowledge'];`)).toBe(false);
  });
  it('only the catalogue spells a cell map at chat, advise and full', () => {
    expect(holders(CELL_MAP)).toEqual([CATALOGUE_HOME]);
  });
  it('only the catalogue maps class words to covers', () => {
    expect(holders(CLASS_COVERS_MAP)).toEqual([CATALOGUE_HOME]);
  });
  it('no file spells a list of act kinds (the catalogue derives its list from its map)', () => {
    expect(ALL.filter((f) => hasKindList(code(f))).map(rel).sort()).toEqual([]);
  });
});
