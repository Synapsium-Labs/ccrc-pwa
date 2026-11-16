// The private-name matcher's key cases and their mutant set (Overlord W2 private names, PR A, Tasks 2 and 3; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-private-names.md). Each case is written ONCE here, over a module:
// `private-names-key.test.ts` runs them against the real `shared/private-names.mjs`, and `mutation-floors.test.ts`
// runs them against each named mutant. Every name is SYNTHETIC, the keys are fixture strings, and the canary is
// spelled only through `CANARY`: this file is part of the public tree the hashed class scans.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type PrivateNamesModule = typeof import('../../../shared/private-names.mjs');
type Mode = 'part' | 'exact' | 'run' | 'words';
type Entry = { h: string; f: string; n: number; mode: Mode };

/** Two fixture keys, neither the public salt. */
export const K1 = 'fixture-key-one';
export const K2 = 'fixture-key-two';

/** A synthetic name per mode, each of two or more tokens so the scan's window hash is asked, and a line that spells it. */
const NAMES: Readonly<Record<Mode, { name: string; line: string }>> = {
  part: { name: 'zz-alpha', line: 'see ZZ_Alpha here' },
  exact: { name: 'zq-bravo-x9', line: 'ok zq-bravo-x9 ok' },
  run: { name: 'zz-delta', line: 'host zz-delta.' },
  words: { name: 'zed quux', line: 'by zed quux today' },
};
const MODES = Object.keys(NAMES) as Mode[];
const h8 = (e: Entry): string => e.h.slice(0, 8);

/** Task 2: the key reaches every hash on the build path and the scan path, and no keyed token is cached. */
export function keyCases(m: PrivateNamesModule): Record<string, SuiteCase> {
  const salt = m.PRIVATE_NAME_SALT;
  const ofMode = (mode: Mode, key?: string): Entry[] => m.entriesOf(NAMES[mode].name, mode, key) as Entry[];
  return {
    'hashEntry under the salt by default, and under each key another hash': () => {
      for (const t of ['zz-alpha', 'zed-quux', m.CANARY]) {
        expect(m.hashEntry(t)).toBe(m.hashEntry(t, salt));
        const all = [m.hashEntry(t), m.hashEntry(t, K1), m.hashEntry(t, K2)];
        expect(new Set(all).size).toBe(3);
        for (const h of all) expect(h).toMatch(/^[0-9a-f]{32}$/);
      }
    },
    'entryOf hashes both of its fields under the key, through the stream, for each mode': () => {
      expect(m.entryOf('zz-alpha', 'part', K1)).toEqual({ h: m.hashEntry('zz-alpha', K1), f: m.hashEntry('zz', K1), n: 2, mode: 'part' });
      expect(m.entryOf('zq-bravo-x9', 'exact', K1)).toEqual({ h: m.hashEntry('zq-bravo-x9', K1), f: m.hashEntry('zq', K1), n: 3, mode: 'exact' });
      for (const mode of MODES) {
        const keyed = m.entryOf(NAMES[mode].name, mode, K1);
        const plain = m.entryOf(NAMES[mode].name, mode);
        expect(keyed.h, mode).not.toBe(plain.h);
        expect(keyed.f, mode).not.toBe(plain.f);
        expect([keyed.n, keyed.mode], mode).toEqual([plain.n, plain.mode]);
      }
    },
    'entriesOf hashes every field of every form under the key, the merged and run-together forms included': () => {
      for (const mode of MODES) {
        const keyed = ofMode(mode, K1);
        const plain = ofMode(mode);
        expect(keyed.length, mode).toBe(plain.length);
        const plainHashes = new Set(plain.flatMap((e) => [e.h, e.f]));
        for (const e of keyed) {
          expect(plainHashes.has(e.h), `${mode} h`).toBe(false);
          expect(plainHashes.has(e.f), `${mode} f`).toBe(false);
        }
      }
      const camel = m.entriesOf('zzAlpha-qq', 'part', K1) as Entry[];
      expect(camel).toContainEqual({ h: m.hashEntry('zzalpha-qq', K1), f: m.hashEntry('zzalpha', K1), n: 2, mode: 'part' });
      expect(camel).toContainEqual({ h: m.hashEntry('zzalphaqq', K1), f: m.hashEntry('zzalphaqq', K1), n: 1, mode: 'part' });
    },
    'hitsAt finds a list built under a key, under that key only, for each mode': () => {
      for (const mode of MODES) {
        const list = ofMode(mode, K1);
        const { line } = NAMES[mode];
        expect(m.hitsAt(line, list, K1).map((x) => x.h8), mode).toEqual([h8(list[0]!)]);
        expect(m.hitsAt(line, list, K2), mode).toEqual([]);
        expect(m.hitsAt(line, list), mode).toEqual([]);
      }
      const single = m.entriesOf('zzalpha', 'part', K1) as Entry[];
      expect(m.hitsAt('const useZzAlpha = 1', single, K1).map((x) => x.h8)).toEqual([h8(single[0]!)]);
      expect(m.hitsIn('see zz-alpha', 'docs/x.md', ofMode('part', K1), K1)).toEqual([h8(ofMode('part', K1)[0]!)]);
    },
    'pairHits finds a phrase broken across a line under the key, through the words sub-index, and not under the salt': () => {
      const list = ofMode('words', K1);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', list, K1)).toEqual([h8(list[0]!)]);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', list)).toEqual([]);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', list, K2)).toEqual([]);
    },
    'interleaved keys on the same lines and the same arrays each answer right: the index is per key': () => {
      const list = ofMode('part', K1);
      const salted = ofMode('part');
      const line = NAMES.part.line;
      for (let round = 0; round < 2; round++) {
        expect(m.hitsAt(line, list).map((x) => x.h8)).toEqual([]);
        expect(m.hitsAt(line, list, K1).map((x) => x.h8)).toEqual([h8(list[0]!)]);
        expect(m.hitsAt(line, list, K2).map((x) => x.h8)).toEqual([]);
        expect(m.hitsAt(line, salted).map((x) => x.h8)).toEqual([h8(salted[0]!)]);
        expect(m.hitsAt(line, salted, K1).map((x) => x.h8)).toEqual([]);
      }
    },
    'the pair cache is per key: a salt read of the previous line is not reused for a keyed pair, nor the reverse': () => {
      const list = ofMode('words', K1);
      const salted = ofMode('words');
      m.hitsAt('by zed', list);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', list, K1)).toEqual([h8(list[0]!)]);
      m.hitsAt('by zed', salted, K1);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', salted)).toEqual([h8(salted[0]!)]);
      m.hitsAt('by zed', list, K1);
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', list, K2)).toEqual([]);
    },
    'no keyed token is cached; a salt scan still is': () => {
      const list = m.entriesOf('zv-keyed-q', 'part', K1) as Entry[];
      const before = m.hashCacheSize();
      expect(m.hitsAt('see zv-keyed-q now', list, K1).map((x) => x.h8)).toEqual([h8(list[0]!)]);
      expect(m.hashCacheSize()).toBe(before);
      const salted = m.entriesOf('zv-salted-q', 'part') as Entry[];
      expect(m.hitsAt('see zv-salted-q now', salted).map((x) => x.h8)).toEqual([h8(salted[0]!)]);
      expect(m.hashCacheSize()).toBeGreaterThan(before);
    },
  };
}

export const PRIVATE_NAMES_KEY_KEY = 'shared/private-names.mjs#hashEntry';

/** Each mutant drops the key from one hash of the build or the scan path, or caches what must not be. */
export const PRIVATE_NAMES_KEY_SET: MutantSet<PrivateNamesModule> = {
  modulePath: path.join(ROOT, 'shared/private-names.mjs'),
  mutants: [
    { id: 'K1 entryFromStream drops the key', old: 'return entryFrom(ts, mode, seps, key);', new: 'return entryFrom(ts, mode, seps);' },
    { id: 'K2 the first token hashed under the salt', old: 'f: hashEntry(ts[0], key)', new: 'f: hashEntry(ts[0])' },
    { id: 'K3 the run-together form under the salt', old: "[''], key));", new: "['']));" },
    { id: 'K4 lookup hashes with the salt', old: 'hashEntry(text(), ix.key)', new: 'hashEntry(text())' },
    { id: 'K5 windows checks with the salt', old: 'if (hashOf(text, ix.key) !== en.h)', new: 'if (hashOf(text, PRIVATE_NAME_SALT) !== en.h)' },
    { id: 'K6 the index shared across keys', old: 'let ix = perKey.get(key);', new: 'let ix = perKey.values().next().value;' },
    { id: 'K7 the words sub-index under the salt', old: 'return hitsIn(`${tail}\\n${head}`, file, words, key)', new: 'return hitsIn(`${tail}\\n${head}`, file, words)' },
    { id: 'K8 the pair cache ignores its key', old: ' || key !== lastKey) hitsAt', new: ') hitsAt' },
    { id: 'K9 the previous line read under the salt', old: 'hitsAt(prev, entries, key);', new: 'hitsAt(prev, entries);' },
    { id: 'K10 hitsIn drops the key', old: 'const hits = hitsAt(line, entries, key);', new: 'const hits = hitsAt(line, entries);' },
    {
      id: 'K11 keyed tokens cached',
      old: 'if (key !== PRIVATE_NAME_SALT) return hashEntry(text, key);\n  let v = HASHES.get(text);\n  if (v === undefined) { v = hashEntry(text); HASHES.set(text, v); }',
      new: 'const at = key === PRIVATE_NAME_SALT ? text : `${key}\\0${text}`;\n  let v = HASHES.get(at);\n  if (v === undefined) { v = hashEntry(text, key); HASHES.set(at, v); }',
    },
  ],
  suite: keyCases,
};

export const PRIVATE_NAMES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PRIVATE_NAMES_KEY_KEY]: PRIVATE_NAMES_KEY_SET as MutantSet<never>,
};
