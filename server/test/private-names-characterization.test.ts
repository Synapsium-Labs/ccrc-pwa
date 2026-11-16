// The private-name matcher's answers as they stand before the key argument (Overlord W2 private names, PR A, Task 1;
// plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-private-names.md). Written green on `main` against the matcher
// with no key, and never edited by the change that threads the key through every hash: with the public salt as every
// default, each export must answer exactly as it did. Every literal below was measured, not derived.
//
// Every name here is SYNTHETIC (`zz-alpha`, `zq-bravo-x9`, `zzDelta-x`, `zed quux`), and the canary is spelled only
// through `CANARY`, never as one run: this file is part of the public tree the hashed class scans.
import { describe, expect, it } from 'vitest';
import {
  CANARY, PRIVATE_NAMES, PRIVATE_NAMES_DIGEST, entriesDigest, entriesOf, entryOf, hashEntry, hitsAt, hitsIn, maskText,
  matchLine, pairHits,
} from './private-names.mjs';
import { publicTextClassesFor } from '../src/linking/publicTextClasses.js';

type Mode = 'part' | 'exact' | 'run' | 'words';
const NAMES: Readonly<Record<Mode, string>> = { part: 'zz-alpha', exact: 'zq-bravo-x9', run: 'zzDelta-x', words: 'zed quux' };
const MODES = Object.keys(NAMES) as Mode[];
const LIST = [entryOf(CANARY, 'part'), ...MODES.flatMap((m) => entriesOf(NAMES[m], m))];
const FILE = 'docs/x.md';
const CANARY_H8 = '66b0e293';

describe('the hash and the entries, under the public salt', () => {
  it('hashEntry answers these literals', () => {
    expect(hashEntry('zz-alpha')).toBe('a84992251d25b6c739e7145a9c4dc038');
    expect(hashEntry('zq-bravo-x9')).toBe('86c7e793d1951ee1376ef8a2fc809bce');
    expect(hashEntry('zed-quux')).toBe('a3c1afd369cffdb6b3924c1be4ac0849');
    expect(hashEntry(CANARY)).toBe('66b0e293ddb1c22e53d2a326842aeea7');
  });

  it('entryOf answers these literals, one per mode', () => {
    expect(MODES.map((m) => entryOf(NAMES[m], m))).toEqual([
      { h: 'a84992251d25b6c739e7145a9c4dc038', f: 'db2b0f050d43bc8eadb98c31760c0276', n: 2, mode: 'part' },
      { h: '86c7e793d1951ee1376ef8a2fc809bce', f: '23d2560aa6396e4e500363a1d62da163', n: 3, mode: 'exact' },
      { h: '443433ee4f8aaa320e2ce68e23059bec', f: 'db2b0f050d43bc8eadb98c31760c0276', n: 3, mode: 'run' },
      { h: 'a3c1afd369cffdb6b3924c1be4ac0849', f: 'cc433f4b05bba4b7c2786695649a4c3e', n: 2, mode: 'words' },
    ]);
  });

  it('entriesOf answers these literals, one list per mode', () => {
    expect(Object.fromEntries(MODES.map((m) => [m, entriesOf(NAMES[m], m)]))).toEqual({
      part: [
        { h: 'a84992251d25b6c739e7145a9c4dc038', f: 'db2b0f050d43bc8eadb98c31760c0276', n: 2, mode: 'part' },
        { h: '413fd81682f3ff8c2c4afb6a0b265e48', f: '413fd81682f3ff8c2c4afb6a0b265e48', n: 1, mode: 'part' },
      ],
      exact: [
        { h: '86c7e793d1951ee1376ef8a2fc809bce', f: '23d2560aa6396e4e500363a1d62da163', n: 3, mode: 'exact' },
        { h: 'a230fe8e7c2ffb6b4b40ce8f98453a0d', f: 'a230fe8e7c2ffb6b4b40ce8f98453a0d', n: 1, mode: 'part' },
      ],
      run: [
        { h: '443433ee4f8aaa320e2ce68e23059bec', f: 'db2b0f050d43bc8eadb98c31760c0276', n: 3, mode: 'run' },
        { h: '443433ee4f8aaa320e2ce68e23059bec', f: 'f8db9bb630e04377d5fd24e7f6f6a713', n: 2, mode: 'run' },
        { h: '98cd368f4a0f1bf82e66390baf3e58cc', f: '98cd368f4a0f1bf82e66390baf3e58cc', n: 1, mode: 'run' },
      ],
      words: [
        { h: 'a3c1afd369cffdb6b3924c1be4ac0849', f: 'cc433f4b05bba4b7c2786695649a4c3e', n: 2, mode: 'words' },
        { h: '2964654404fd2a9833954d9c60c1c6dc', f: '2964654404fd2a9833954d9c60c1c6dc', n: 1, mode: 'part' },
      ],
    });
  });
});

/** A line, then hitsAt as [h8, start, end, origStart, origEnd], matchLine, hitsIn and maskText. */
type Row = readonly [string, readonly (readonly [string, number, number, number, number])[], readonly string[],
  readonly string[], string];
const ROWS: readonly Row[] = [
  ['see zz-alpha here', [['a8499225', 4, 12, 4, 12]], ['a8499225'], ['a8499225'], 'see #a8499225 here'],
  ['const zzAlphaRow = 1', [['a8499225', 6, 13, 6, 13]], ['a8499225'], ['a8499225'], 'const #a8499225Row = 1'],
  ['ZZ_ALPHA', [['a8499225', 0, 8, 0, 8]], ['a8499225'], ['a8499225'], '#a8499225'],
  ['zz‑alpha', [['a8499225', 0, 8, 0, 8]], ['a8499225'], ['a8499225'], '#a8499225'],
  ['zz​alpha', [['413fd816', 0, 7, 0, 8]], ['413fd816'], ['413fd816'], '#413fd816'],
  ['zq-bravo-x9 ok', [['86c7e793', 0, 11, 0, 11]], ['86c7e793'], ['86c7e793'], '#86c7e793 ok'],
  ['zq.bravo.x9', [], [], [], 'zq.bravo.x9'],
  ['host zzDelta-x.', [['443433ee', 5, 14, 5, 14]], ['443433ee'], ['443433ee'], 'host #443433ee.'],
  ['zzDelta-x-design.md', [], [], [], 'zzDelta-x-design.md'],
  ['x-zzDelta-x', [], [], [], 'x-zzDelta-x'],
  ['by zed quux today', [['a3c1afd3', 3, 11, 3, 11]], ['a3c1afd3'], ['a3c1afd3'], 'by #a3c1afd3 today'],
  ['Zed   Quux', [['a3c1afd3', 0, 10, 0, 10]], ['a3c1afd3'], ['a3c1afd3'], '#a3c1afd3'],
  ['useZzAlpha()', [['a8499225', 3, 10, 3, 10]], ['a8499225'], ['a8499225'], 'use#a8499225()'],
  ['zz-alphabet', [], [], [], 'zz-alphabet'],
  ['nothing here', [], [], [], 'nothing here'],
  ['ｚｚ-alpha', [['a8499225', 0, 8, 0, 8]], ['a8499225'], ['a8499225'], '#a8499225'],
  ['zz-alpha and zq-bravo-x9 and zed quux',
    [['a8499225', 0, 8, 0, 8], ['86c7e793', 13, 24, 13, 24], ['a3c1afd3', 29, 37, 29, 37]],
    ['a8499225', '86c7e793', 'a3c1afd3'], ['a8499225', '86c7e793', 'a3c1afd3'], '#a8499225 and #86c7e793 and #a3c1afd3'],
  ['zz­alpha', [['413fd816', 0, 7, 0, 8]], ['413fd816'], ['413fd816'], '#413fd816'],
  ['`zzDelta-x`', [['443433ee', 1, 10, 1, 10]], ['443433ee'], ['443433ee'], '`#443433ee`'],
  ['zedquux', [['29646544', 0, 7, 0, 7]], ['29646544'], ['29646544'], '#29646544'],
];

describe('the scan, over twenty synthetic lines', () => {
  it.each(ROWS.map((r, i) => [i, r] as const))('line %i: hitsAt, matchLine, hitsIn and maskText answer as measured', (_i, row) => {
    const [line, hits, matched, inFile, masked] = row;
    expect(hitsAt(line, LIST).map((h) => [h.h8, h.start, h.end, h.origStart, h.origEnd])).toEqual(hits);
    expect(matchLine(line, LIST)).toEqual(matched);
    expect(hitsIn(line, FILE, LIST)).toEqual(inFile);
    expect(maskText(line, LIST)).toBe(masked);
  });

  it('pairHits finds a phrase broken across a line, and nothing else', () => {
    const pairs: [string, string][] = [['by zed', 'quux today'], ['// zed', '// quux'], ['zed', 'nothing'], ['zed quux', 'x'],
      ['see zz', 'alpha']];
    expect(pairs.map(([a, b]) => pairHits(a, b, FILE, LIST))).toEqual([['a3c1afd3'], ['a3c1afd3'], [], [], []]);
  });
});

describe('the committed list and its consumer', () => {
  it('matchLine on a line that spells the canary hits its h8, and the digest is unchanged', () => {
    expect(matchLine(`a ${CANARY} b`, PRIVATE_NAMES)).toEqual([CANARY_H8]);
    expect(PRIVATE_NAMES_DIGEST).toBe('ebfc36e51ca156f9c5dde591e2fcf235');
    expect(entriesDigest(PRIVATE_NAMES)).toBe(PRIVATE_NAMES_DIGEST);
  });

  it('the public-text class `private name (hashed)` answers the canary\'s h8 for a line that spells it', () => {
    const cls = publicTextClassesFor([]).find((c) => c.name === 'private name (hashed)');
    expect(cls).toBeDefined();
    expect(cls!.match(`a ${CANARY} b`, FILE)).toEqual([CANARY_H8]);
  });
});
