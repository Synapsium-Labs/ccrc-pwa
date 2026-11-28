// Single-definition scanners, one area of the guard (see ./helpers.ts for the doctrine and the shared walkers): the act record's one
// shape (Overlord W2, act journal A, last stage; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-journal.md` F7).
//
// Until #3664 landed, the act journal's grammar (`server/src/coord/overlordActRecords.ts`) carried an interim copy of act rows A's
// record type, its three word lists and the store's port with its answer. The last stage replaced that copy with imports, and
// `OverlordActRecord` is now an alias of `ActJournalRecord`, never a second shape. This holds that no copy comes back: each name
// is declared in its one home, and the grammar file declares none of them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL, rel } from './helpers.js';

/** Each name and the one file that may declare it. A declaration is `type X =`, `interface X`, or `const X =` (exported or not). */
const HOMES: readonly (readonly [string, string])[] = [
  ['ActJournalRecord', 'server/src/coord/overlordActs.ts'],
  ['ActRecordBody', 'server/src/coord/overlordActs.ts'],
  ['ActRecordNatural', 'server/src/coord/overlordActs.ts'],
  ['ActJournalPort', 'server/src/coord/overlordActsStore.ts'],
  ['ActJournalAppend', 'server/src/coord/overlordActsStore.ts'],
  ['ACT_STATES', 'shared/overlordActs.ts'],
  ['ACT_TARGET_KINDS', 'shared/overlordActs.ts'],
  ['ACT_TARGET_REF_KINDS', 'shared/overlordActs.ts'],
  ['ActTargetRef', 'shared/overlordActs.ts'],
];
const declares = (name: string): RegExp => new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:type|interface|const)\\s+${name}\\b(?:\\s*[=<{:]|\\s+extends\\b)`);
const GRAMMAR = 'server/src/coord/overlordActRecords.ts';

describe('the act record has one shape: each of its names is declared in its one home', () => {
  const texts = new Map(ALL.map((f) => [rel(f), readFileSync(f, 'utf8')] as const));

  it('CONTROL: the scan visits the grammar and every home, and the pattern matches each original declaration', () => {
    expect(texts.has(GRAMMAR), 'the grammar file is not in the scanned roots').toBe(true);
    for (const [name, home] of HOMES) expect(declares(name).test(texts.get(home) ?? ''), `${name} in ${home}`).toBe(true);
    // A planted copy, in each of the three spellings, is seen.
    expect(declares('ActJournalRecord').test('const x = 1;\ntype ActJournalRecord =\n  | { kind: 1 }')).toBe(true);
    expect(declares('ActJournalPort').test('export interface ActJournalPort {\n}')).toBe(true);
    expect(declares('ACT_STATES').test('  const ACT_STATES = [] as const;')).toBe(true);
    // A use is not a declaration.
    expect(declares('ActJournalRecord').test('import type { ActJournalRecord } from \'./overlordActs.js\';\nexport type OverlordActRecord = ActJournalRecord;')).toBe(false);
  });

  it.each(HOMES)('%s is declared only in %s', (name, home) => {
    const holders = [...texts].filter(([, src]) => declares(name).test(src)).map(([f]) => f);
    expect(holders).toEqual([home]);
  });

  it('the grammar\'s record type is an alias of the act store\'s, never a shape of its own', () => {
    expect(texts.get(GRAMMAR)).toMatch(/export type OverlordActRecord = ActJournalRecord;/);
  });
});
