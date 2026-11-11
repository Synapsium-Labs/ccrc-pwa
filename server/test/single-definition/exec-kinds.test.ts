// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXEC_KINDS } from '../../../shared/roster.js';
import { ALL, ALL_MJS, ccrcRoot, here, rel, sources } from './helpers.js';


// — D-8192: `exec.kind`'s closed set, spelled once —
// How ccrc reaches an account's binary (`upstream`, `generated`, `external`, `codex`) was spelled as a list in the
// parser, in its bare-Node mirror, in three refusal messages and in three test files, and only the two parser sets
// were compared. `EXEC_KINDS` in `shared/roster.ts` is now the one definition; TypeScript imports it, the refusals
// are built from it, and `shared/roster-json.mjs` keeps the one mirror a runtime that cannot import TypeScript needs,
// pinned equal in order by `roster-exec-parity.test.ts`. This scan is what stops a fourth copy written the ordinary
// way: three or more kinds, quoted, joined only by commas or `|` (an array, a Set, a union, a refusal's list).
describe('exec kinds — one definition in shared/roster.ts, one bare-Node mirror (D-8192)', () => {
  const kinds = EXEC_KINDS.join('|');
  const LISTED = (quote: string): RegExp =>
    new RegExp(`([${quote}])(?:${kinds})\\1(?:\\s*[,|]\\s*([${quote}])(?:${kinds})\\2){2,}`);
  const lists = (f: string, quote: string): boolean => LISTED(quote).test(readFileSync(f, 'utf8'));

  it('the scan has something to find: the definition itself matches it', () => {
    expect(lists(path.join(ccrcRoot, 'shared', 'roster.ts'), `'"`)).toBe(true);
  });

  it('under the TypeScript roots and every .mjs, only the definition and its mirror list the kinds', () => {
    const holders = [...ALL, ...ALL_MJS].filter((f) => lists(f, `'"`)).map(rel).sort();
    expect(holders).toEqual(['shared/roster-json.mjs', 'shared/roster.ts']);
  });

  it('each of those two files lists the kinds exactly once: its declaration, and every refusal is built from it', () => {
    for (const f of ['shared/roster.ts', 'shared/roster-json.mjs']) {
      const src = readFileSync(path.join(ccrcRoot, f), 'utf8');
      const all = new RegExp(LISTED(`'"`).source, 'g');
      expect([...src.matchAll(all)].map((m) => m[0]), f).toHaveLength(1);
    }
  });

  it('no server test declares its own list of the kinds; tests import EXEC_KINDS or ExecKind', () => {
    // Single quotes only: a test may still pin a refusal's exact words (`"upstream", "generated", ...` inside a
    // regex), which is behaviour, not a second definition.
    const holders = sources(here).filter((f) => lists(f, `'`)).map(rel);
    expect(holders).toEqual([]);
  });
});
