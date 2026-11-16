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

/** Task 3: `privateNameHits` answers distinct entry ids in first-hit order, never text, and throws on a list it cannot
 *  trust, so a wiring bug can never pass a known name as clean. */
export function hitsCases(m: PrivateNamesModule): Record<string, SuiteCase> {
  const canary = (key?: string): Entry => m.entryOf(m.CANARY, 'part', key) as Entry;
  const listOf = (key: string, ...more: Entry[]) => ({ key, entries: [canary(key), ...more] });
  const ofMode = (mode: Mode, key: string): Entry[] => m.entriesOf(NAMES[mode].name, mode, key) as Entry[];
  const H8 = /^[0-9a-f]{8}$/;
  const refused = (list: unknown, what: string): void => {
    let err: unknown = null;
    try { m.privateNameHits('see zz-alpha and zed quux', list as never); } catch (e) { err = e; }
    expect(err, what).toBeInstanceOf(m.PrivateNameListInvalid);
    const text = `${(err as Error).name} ${(err as Error).message}`;
    for (const leak of ['zz', 'alpha', 'zed', 'quux', K1, K2, canary(K1).h.slice(0, 8), canary(K2).h.slice(0, 8)]) {
      expect(text.toLowerCase(), `${what}: ${leak}`).not.toContain(leak.toLowerCase());
    }
  };
  return {
    'a keyed list is hit on a line that spells one of its names, for each mode, and answers that entry\'s id': () => {
      for (const mode of MODES) {
        const own = ofMode(mode, K1);
        expect(m.privateNameHits(`a line\n${NAMES[mode].line}\nanother`, listOf(K1, ...own)), mode).toEqual([h8(own[0]!)]);
      }
    },
    'distinct 8-hex ids in first-hit order; [] for clean text and for a list holding only its canary': () => {
      const part = ofMode('part', K1), exact = ofMode('exact', K1), words = ofMode('words', K1);
      const list = listOf(K1, ...part, ...exact, ...words);
      const got = m.privateNameHits('ok zq-bravo-x9 ok\nsee zz-alpha, zz-alpha\nby zed quux and zq-bravo-x9', list);
      expect(got).toEqual([h8(exact[0]!), h8(part[0]!), h8(words[0]!)]);
      for (const id of got) expect(id).toMatch(H8);
      expect(m.privateNameHits('nothing to see\nhere at all', list)).toEqual([]);
      expect(m.privateNameHits('see zz-alpha and zed quux', listOf(K1))).toEqual([]);
      expect(m.privateNameHits('', list)).toEqual([]);
      // A phrase broken across a line starts on the earlier line, so it comes before the later line's own hits.
      expect(m.privateNameHits('by zed\nquux and zz-alpha', list)).toEqual([h8(words[0]!), h8(part[0]!)]);
    },
    'the canary itself is a hit, so a list is never blind to its own first entry': () => {
      expect(m.privateNameHits(`a ${m.CANARY} b`, listOf(K1))).toEqual([h8(canary(K1))]);
    },
    'a words phrase split across two lines is a hit under the key, and split across three is not': () => {
      const words = ofMode('words', K1);
      expect(m.privateNameHits('by zed\nquux today', listOf(K1, ...words))).toEqual([h8(words[0]!)]);
      expect(m.privateNameHits('by zed\n\nquux today', listOf(K1, ...words))).toEqual([]);
      expect(m.privateNameHits('first line\nby zed\nquux today', listOf(K1, ...words))).toEqual([h8(words[0]!)]);
    },
    'no exemption applies: a hit the history documents\' rule would exempt is still a hit': () => {
      // An entry carrying the exempt upstream id, found by its first-token hash (a one-token entry checks no other).
      const upstream: Entry = { h: `4dda1e70${'0'.repeat(24)}`, f: m.hashEntry('zzalpha', K1), n: 1, mode: 'part' };
      expect(m.hitsIn('see zzalpha@abcdef1234 there', 'docs/ccrc-history-x.md', [upstream], K1)).toEqual([]);
      expect(m.privateNameHits('see zzalpha@abcdef1234 there', listOf(K1, upstream))).toEqual(['4dda1e70']);
    },
    'the list check: no key, an empty or non-string key, no entries, a first entry not the canary, a canary under another key': () => {
      const own = ofMode('part', K1);
      refused(undefined, 'no list');
      refused(null, 'a null list');
      refused({ entries: [canary(), ...ofMode('part', m.PRIVATE_NAME_SALT)] }, 'a missing key over a salted list');
      refused({ key: '', entries: [canary(''), ...ofMode('part', '')] }, 'an empty key');
      refused({ key: 42, entries: [canary(K1), ...own] }, 'a non-string key');
      refused({ key: K1 }, 'no entries');
      refused({ key: K1, entries: 'zz' }, 'entries not an array');
      refused({ key: K1, entries: [] }, 'an empty entries array');
      refused({ key: K1, entries: [...own, canary(K1)] }, 'the canary not first');
      refused({ key: K1, entries: [canary(K2), ...own] }, 'a canary built under another key');
    },
    'the canary is compared in all four fields': () => {
      const own = ofMode('part', K1);
      const c = canary(K1);
      refused({ key: K1, entries: [{ ...c, f: canary(K2).f }, ...own] }, 'another first-token hash');
      refused({ key: K1, entries: [{ ...c, n: c.n + 1 }, ...own] }, 'another token count');
      refused({ key: K1, entries: [{ ...c, mode: 'exact' }, ...own] }, 'another mode');
      refused({ key: K1, entries: [{ ...c, h: canary(K2).h }, ...own] }, 'another hash');
    },
  };
}

export const PRIVATE_NAME_HITS_KEY = 'shared/private-names.mjs#privateNameHits';

export const PRIVATE_NAME_HITS_SET: MutantSet<PrivateNamesModule> = {
  modulePath: path.join(ROOT, 'shared/private-names.mjs'),
  mutants: [
    {
      id: 'H1 the list check dropped',
      old: "if (typeof key !== 'string' || key === '' || !Array.isArray(entries) || entries.length === 0) throw new PrivateNameListInvalid();",
      new: '',
    },
    { id: 'H2 an empty key allowed', old: "typeof key !== 'string' || key === '' ||", new: "typeof key !== 'string' ||" },
    {
      id: 'H3 the canary compared on h alone',
      old: 'first.h !== canary.h || first.f !== canary.f || first.n !== canary.n || first.mode !== canary.mode',
      new: 'first.h !== canary.h',
    },
    { id: 'H4 the canary checked under the salt', old: "const canary = entryOf(CANARY, 'part', key);", new: "const canary = entryOf(CANARY, 'part');" },
    { id: 'H5 pairs not scanned', old: "if (i > 0) for (const id of pairHits(lines[i - 1], lines[i], '', entries, key)) ids.add(id);", new: '' },
    { id: 'H6 a duplicate returned', old: 'const ids = new Set();', new: 'const ids = Object.assign([], { add(v) { this.push(v); } });' },
    { id: 'H7 the folded text returned instead of the id', old: 'ids.add(hit.h8)', new: 'ids.add(hit.folded.slice(hit.start, hit.end))' },
    {
      id: 'H8 the exemptions applied',
      old: 'for (const hit of hitsAt(lines[i], entries, key)) ids.add(hit.h8);',
      new: "for (const id of hitsIn(lines[i], 'docs/ccrc-history.md', entries, key)) ids.add(id);",
    },
    {
      id: 'H9 a pair after the later line',
      old: "    if (i > 0) for (const id of pairHits(lines[i - 1], lines[i], '', entries, key)) ids.add(id);\n    for (const hit of hitsAt(lines[i], entries, key)) ids.add(hit.h8);",
      new: "    for (const hit of hitsAt(lines[i], entries, key)) ids.add(hit.h8);\n    if (i > 0) for (const id of pairHits(lines[i - 1], lines[i], '', entries, key)) ids.add(id);",
    },
  ],
  suite: hitsCases,
};

export const PRIVATE_NAMES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PRIVATE_NAMES_KEY_KEY]: PRIVATE_NAMES_KEY_SET as MutantSet<never>,
  [PRIVATE_NAME_HITS_KEY]: PRIVATE_NAME_HITS_SET as MutantSet<never>,
};
