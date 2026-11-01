// The unprintable set, its two strips and the Linear name cleaner have one home each (#1444, the Linear central key,
// spec section 6.5): `shared/unprintable.ts`, L0, which the account audit and the Linear modules import. A private copy
// of the set (the account audit kept one), a second strip, or `cleanName` left in `linear/client.ts` beside the shared
// one is a second definition, and this file reds on it. KNOWN WIDTH: the set is found by its name and by the one range
// only it spells (U+2060 to U+206F, whole); a copy written with other ranges and another name is not seen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, rel, stallCode } from './helpers.js';

const HOME = 'shared/unprintable.ts';
const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b`);
/** The set's U+2060 to U+206F range, spelled as an escape pair in a pattern. */
const SET_RANGE = /\\u2060-\\u206f/i;

describe('the unprintable set and its strips are defined once, in shared/unprintable.ts (#1444)', () => {
  it('CONTROL: the patterns see a declaration and the range, and pass over a use and an import', () => {
    expect(decl('stripLine').test('export function stripLine(s: string): string {')).toBe(true);
    expect(decl('UNPRINTABLE').test('const UNPRINTABLE = /[x]/gu;')).toBe(true);
    expect(decl('cleanName').test("import { cleanName } from '../../../shared/unprintable.js';")).toBe(false);
    expect(decl('stripLine').test('const label = stripLine(device);')).toBe(false);
    expect(SET_RANGE.test(String.raw`/[\u0000-\u001f\u2060-\u206f\p{Cf}]+/gu`)).toBe(true);
    expect(SET_RANGE.test(String.raw`/[\u2060-\u2069]/g`)).toBe(false);
  });
  it('the set, the two strips, cleanName and LINEAR_NAME_MAX_CHARS are each declared once, in the home', () => {
    for (const c of ['UNPRINTABLE', 'stripLine', 'stripMultiline', 'cleanName', 'LINEAR_NAME_MAX_CHARS']) {
      expect(holders(decl(c)), c).toEqual([HOME]);
    }
  });
  it('the set\'s range is spelled in the home alone: the account audit keeps no private copy', () => {
    expect(holders(SET_RANGE)).toEqual([HOME]);
  });
  it('the account audit and the Linear client import the home', () => {
    const imports = (f: string): boolean => /from '\.\.\/\.\.\/\.\.\/shared\/unprintable\.js'/
      .test(readFileSync(path.join(ccrcRoot, f), 'utf8'));
    expect(imports('server/src/accounts/audit.ts'), 'audit.ts').toBe(true);
    expect(imports('server/src/linear/client.ts'), 'client.ts').toBe(true);
  });
});
