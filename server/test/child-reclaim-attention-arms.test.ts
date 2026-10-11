// Child-reclamation wave 8 (spec §5.6, §5.9): the L0 words the reclaim server half adds. `leafKeptWord` is the ONE
// classifier of a kept-leaf value, shared with workspace lifecycle, and three arms join `ChildReclaimAttention`:
// `stuck`, `leaf-kept`, and the kept leaves' collapsed line. These are declarations only: each arm is pinned where
// the lane raises it. The union cases are compile-time facts, so `typecheck-tests.test.ts` is half of this file.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAF_KEPT_WORDS, isChildReclaimKeptWord, leafKeptWord,
  type ChildReclaimAttention, type ChildReclaimGeneration, type ChildReclaimGenerationKey,
} from '../../shared/api.js';
import { codeOnly } from './sourceScan.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
const sources = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  if (e.startsWith('__')) return [];
  const p = path.join(dir, e);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.tsx?$/.test(p) ? [p] : [];
});
const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p);

describe('leafKeptWord, the one kept-leaf classifier (spec §5.6)', () => {
  it('ccd’s three words, derived from one table', () => {
    expect([...LEAF_KEPT_WORDS].sort()).toEqual(['in-use', 'refused', 'unmeasured']);
  });

  it.each<readonly [unknown, string]>([
    ['refused', 'refused'], ['unmeasured', 'unmeasured'], ['in-use', 'in-use'],
    [null, 'unmeasured'], // null is each carrier's to read, never the word half's (H8, after 4045)
    ['kept', 'unmeasured'], ['', 'unmeasured'], ['REFUSED', 'unmeasured'], ['toString', 'unmeasured'],
    [3, 'unmeasured'], [true, 'unmeasured'], [{}, 'unmeasured'], [undefined, 'unmeasured'],
  ])('%j -> %j', (v, word) => {
    expect(leafKeptWord(v)).toBe(word);
  });

  it('is declared once, in shared/api.ts, and no other file spells the three words as a set', () => {
    const DECL = /^\s*(?:export\s+)?(?:function|const|let|var)\s+leafKeptWord\b/m;
    expect(ALL.filter((f) => DECL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    // A second copy of the word list is a second classifier waiting to drift: one CODE line naming all three.
    const SET = (l: string): boolean => ["'refused'", "'unmeasured'", "'in-use'"].every((w) => l.includes(w));
    expect(SET("const W = ['refused', 'unmeasured', 'in-use'];"), 'CONTROL').toBe(true);
    const holders = ALL.filter((f) => codeOnly(readFileSync(f, 'utf8')).split('\n').some(SET)).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
    // H8: workspace lifecycle's word half, by NAME (its list, its word type, its reader), so a copy wrapped over
    // two lines is caught, and so is one the move left behind.
    expect(ALL.filter((f) => /\b(?:EXPIRE_LEAF_WORDS|KEPT_LEAF_WORDS|KeptLeafWord|keptLeafWord)\b/
      .test(codeOnly(readFileSync(f, 'utf8')))).map(rel),
      'a reader of the kept words with its own list').toEqual([]);
  });
});

describe('the three new ChildReclaimAttention arms (spec §5.9)', () => {
  it('each is a member of the union, and the collapsed line’s word is no kept word', () => {
    const items: ChildReclaimAttention[] = [
      { kind: 'stuck', sessionId: 'demo-a', runId: null, token: 'containment-refuted', sentence: 's', at: null },
      { kind: 'leaf-kept', sessionId: 'demo-b', runId: 7, sentence: 's', at: 1 },
      { kind: 'kept-many', word: 'leaf-kept', members: [{ sessionId: 'demo-c', runId: 8 }], sentence: 's' },
    ];
    expect(items.map((a) => a.kind)).toEqual(['stuck', 'leaf-kept', 'kept-many']);
    // The PWA keys a collapsed line by its word: a kept word spelled the same would share a key.
    expect(isChildReclaimKeptWord('leaf-kept')).toBe(false);
  });

  it('a generation key is a read minus `unreadable`', () => {
    const key: ChildReclaimGenerationKey = { kind: 'value', v: '0b6f8a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b' };
    const read: ChildReclaimGeneration = key;
    expect(read.kind).toBe('value');
    // @ts-expect-error an unreadable read is never a key
    const notAKey: ChildReclaimGenerationKey = { kind: 'unreadable' };
    expect(notAKey.kind).toBe('unreadable');
  });
});
