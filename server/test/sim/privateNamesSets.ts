// The private-name matcher's key cases and their mutant set (Overlord W2 private names, PR A, Tasks 2 and 3; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-private-names.md). Each case is written ONCE here, over a module:
// `private-names-key.test.ts` runs them against the real `shared/private-names.mjs`, and `mutation-floors.test.ts`
// runs them against each named mutant. Every name is SYNTHETIC, the keys are fixture strings, and the canary is
// spelled only through `CANARY`: this file is part of the public tree the hashed class scans.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { mulberry32 } from '../fakeTime.js';
import type { MutantSet, SuiteCase } from './mutate.js';
import * as PRIVATE_NAMES_REAL from '../../../shared/private-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type PrivateNamesModule = typeof import('../../../shared/private-names.mjs');
type Mode = 'part' | 'exact' | 'run' | 'words';
type Entry = { h: string; f: string; n: number; mode: Mode };

/** Two fixture keys, neither the public salt, each past `privateNameHits`' 16-byte floor. */
export const K1 = 'fixture-key-one-0001';
export const K2 = 'fixture-key-two-0002';

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
    'the index rebuilds when its array changes in place: an append or a replaced end is scanned (review 2306 F2)': () => {
      const arr: Entry[] = [m.entryOf(m.CANARY, 'part', K1) as Entry];
      expect(m.hitsAt(NAMES.part.line, arr, K1)).toEqual([]);
      const part = ofMode('part', K1);
      arr.push(...part);
      expect(m.hitsAt(NAMES.part.line, arr, K1).map((x) => x.h8)).toEqual([h8(part[0]!)]);
      const exact = ofMode('exact', K1);
      arr[arr.length - 1] = exact[0]!;
      expect(m.hitsAt(NAMES.exact.line, arr, K1).map((x) => x.h8)).toEqual([h8(exact[0]!)]);
      const words: Entry[] = [m.entryOf(m.CANARY, 'part', K1) as Entry];
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', words, K1)).toEqual([]);
      words.push(...ofMode('words', K1));
      expect(m.pairHits('by zed', 'quux today', 'docs/x.md', words, K1)).toEqual([h8(words[1]!)]);
    },
    'two keys never share a cached token hash, and a keyed index holds none of the salt\'s (review 2306 F3, F4)': () => {
      const arr = ofMode('part', K1);
      const line = 'see zz-alpha and zv-cached-token here';
      m.hitsAt(line, arr, K1);
      m.hitsAt(line, arr, K2);
      m.hitsAt(line, arr);
      const [a, b, c] = [K1, K2, salt].map((k) => new Set(m.cachedTokenHashes(arr, k)));
      for (const set of [a, b, c]) expect(set.size).toBeGreaterThan(3);
      for (const row of a) { expect(b.has(row)).toBe(false); expect(c.has(row)).toBe(false); }
      for (const row of b) expect(c.has(row)).toBe(false);
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
    { id: 'K8 the pair cache ignores its index', old: ' || ix !== lastIx) hitsAt', new: ') hitsAt' },
    { id: 'K9 the previous line read under the salt', old: 'hitsAt(prev, entries, key);', new: 'hitsAt(prev, entries);' },
    { id: 'K10 hitsIn drops the key', old: 'const hits = hitsAt(line, entries, key);', new: 'const hits = hitsAt(line, entries);' },
    {
      id: 'K11 keyed tokens cached',
      old: 'if (key !== PRIVATE_NAME_SALT) return hashEntry(text, key);\n  let v = HASHES.get(text);\n  if (v === undefined) { v = hashEntry(text); HASHES.set(text, v); }',
      new: 'const at = key === PRIVATE_NAME_SALT ? text : `${key}\\0${text}`;\n  let v = HASHES.get(at);\n  if (v === undefined) { v = hashEntry(text, key); HASHES.set(at, v); }',
    },
    {
      id: 'K12 a stale index kept',
      old: 'if (ix && (ix.count !== entries.length || ix.first !== entries[0] || ix.last !== entries[entries.length - 1])) ix = undefined;',
      new: '',
    },
    {
      id: 'K13 the index checks the length alone',
      old: 'ix.count !== entries.length || ix.first !== entries[0] || ix.last !== entries[entries.length - 1]',
      new: 'ix.count !== entries.length',
    },
    { id: 'K14 the token seeds unkeyed', old: 'if (key === PRIVATE_NAME_SALT) return [FNV0, DJB0];', new: 'return [FNV0, DJB0];' },
    { id: 'K15 the seeds not set for the line', old: '[S1, S2] = ix.seeds;\n', new: '' },
  ],
  suite: keyCases,
};

/** Task 3: `privateNameHits` answers distinct entry ids in the order their hits start, never text. The whole text
 *  decides a hit, so no split of a name over lines passes (review 2306 F1). It throws one word on a list or a text it
 *  cannot trust, so a wiring bug can never pass a known name as clean, and it keeps none of the text. */
export function hitsCases(m: PrivateNamesModule): Record<string, SuiteCase> {
  const canary = (key?: string): Entry => m.entryOf(m.CANARY, 'part', key) as Entry;
  const listOf = (key: string, ...more: Entry[]) => ({ key, entries: [canary(key), ...more] });
  const ofMode = (mode: Mode, key: string): Entry[] => m.entriesOf(NAMES[mode].name, mode, key) as Entry[];
  const H8 = /^[0-9a-f]{8}$/;
  const refused = (text: unknown, list: unknown, what: string): void => {
    let err: unknown = null;
    try { m.privateNameHits(text as never, list as never); } catch (e) { err = e; }
    expect(err, what).toBeInstanceOf(m.PrivateNameListInvalid);
    const said = `${(err as Error).name} ${(err as Error).message}`;
    for (const leak of ['zz', 'alpha', 'zed', 'quux', K1, K2, canary(K1).h.slice(0, 8), canary(K2).h.slice(0, 8)]) {
      expect(said.toLowerCase(), `${what}: ${leak}`).not.toContain(leak.toLowerCase());
    }
  };
  const refusedList = (list: unknown, what: string): void => refused('see zz-alpha and zed quux', list, what);
  const THREE = 'zzalpha zzbravo zzcharlie';
  return {
    'a keyed list is hit on a line that spells one of its names, for each mode, and answers that entry\'s id': () => {
      for (const mode of MODES) {
        const own = ofMode(mode, K1);
        expect(m.privateNameHits(`a line\n${NAMES[mode].line}\nanother`, listOf(K1, ...own)), mode).toEqual([h8(own[0]!)]);
      }
    },
    'distinct 8-hex ids in the order their hits start; [] for clean text and for a list holding only its canary': () => {
      const part = ofMode('part', K1), exact = ofMode('exact', K1), words = ofMode('words', K1);
      const list = listOf(K1, ...part, ...exact, ...words);
      const got = m.privateNameHits('ok zq-bravo-x9 ok\nsee zz-alpha, zz-alpha\nby zed quux and zq-bravo-x9', list);
      expect(got).toEqual([h8(exact[0]!), h8(part[0]!), h8(words[0]!)]);
      for (const id of got) expect(id).toMatch(H8);
      expect(m.privateNameHits('nothing to see\nhere at all', list)).toEqual([]);
      expect(m.privateNameHits('see zz-alpha and zed quux', listOf(K1))).toEqual([]);
      expect(m.privateNameHits('', list)).toEqual([]);
      // A phrase broken across a line starts on the earlier line, so it comes before the later line's own hits, and so
      // does one broken across a repeated comment marker, which only the pair reading finds.
      expect(m.privateNameHits('by zed\nquux and zz-alpha', list)).toEqual([h8(words[0]!), h8(part[0]!)]);
      expect(m.privateNameHits('// by zed\n// quux and zz-alpha', list)).toEqual([h8(words[0]!), h8(part[0]!)]);
    },
    'the canary itself is a hit, so a list is never blind to its own first entry': () => {
      expect(m.privateNameHits(`a ${m.CANARY} b`, listOf(K1))).toEqual([h8(canary(K1))]);
    },
    'a words phrase is a hit however the text breaks it: lines, a blank or whitespace-only line, CRLF, a comment marker': () => {
      const words = ofMode('words', K1);
      const three = m.entriesOf(THREE, 'words', K1) as Entry[];
      const list = listOf(K1, ...words, ...three);
      const two = [h8(words[0]!)], three8 = [h8(three[0]!)];
      for (const t of ['by zed\nquux today', 'by zed\n\nquux today', 'by zed\n   \t\nquux today', 'by zed\r\nquux today',
        'by zed\r\n\r\nquux today', 'by zed\n\n\n\nquux', '// by zed\n// quux today', '> by zed\n> quux']) {
        expect(m.privateNameHits(t, list), JSON.stringify(t)).toEqual(two);
      }
      for (const t of ['a zzalpha\nzzbravo\nzzcharlie b', 'a zzalpha\r\nzzbravo\r\nzzcharlie b', 'zzalpha\n\nzzbravo  zzcharlie',
        'zzalpha zzbravo\n \nzzcharlie']) {
        expect(m.privateNameHits(t, list), JSON.stringify(t)).toEqual(three8);
      }
    },
    'never misses what whole-text hitsAt finds, over generated texts (review 2306 F1)': () => {
      const list = listOf(K1, ...(m.entriesOf(THREE, 'words', K1) as Entry[]), ...MODES.flatMap((mode) => ofMode(mode, K1)));
      const pieces = ['zzalpha', 'zzbravo', 'zzcharlie', 'zed', 'quux', 'zz', 'alpha', 'zq', 'bravo', 'x9', 'delta', 'the', 'ok', 'by'];
      const seps = [' ', '  ', '\n', '\r\n', '\n\n', ' \n  \n', '\t', '\n\t', '-', '_', '.', ', ', '\n// ', '\n> ', '\r\n\r\n'];
      const rand = mulberry32(2306);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
      let hit = 0, onlyWhole = 0;
      for (let i = 0; i < 4000; i++) {
        const n = 2 + Math.floor(rand() * 8);
        let text = pick(pieces);
        for (let k = 1; k < n; k++) text += pick(seps) + pick(pieces);
        const whole = [...new Set(m.hitsAt(text, list.entries, K1).map((x) => x.h8))];
        const got = m.privateNameHits(text, list);
        for (const id of whole) expect(got, JSON.stringify(text)).toContain(id);
        if (whole.length > 0) hit++;
        const perLine = new Set(text.split('\n').flatMap((l) => m.hitsAt(l, list.entries, K1).map((x) => x.h8)));
        if (whole.some((id) => !perLine.has(id))) onlyWhole++;
      }
      // The property is not vacuous: many texts hit, and some only across a line break.
      expect(hit).toBeGreaterThan(400);
      expect(onlyWhole).toBeGreaterThan(20);
    },
    'no exemption applies: a hit the history documents\' rule would exempt is still a hit': () => {
      // An entry carrying the exempt upstream id, found by its first-token hash (a one-token entry checks no other).
      const upstream: Entry = { h: `4dda1e70${'0'.repeat(24)}`, f: m.hashEntry('zzalpha', K1), n: 1, mode: 'part' };
      expect(m.hitsIn('see zzalpha@abcdef1234 there', 'docs/ccrc-history-x.md', [upstream], K1)).toEqual([]);
      expect(m.privateNameHits('see zzalpha@abcdef1234 there', listOf(K1, upstream))).toEqual(['4dda1e70']);
    },
    'the list check: no key, the salt, a short or non-string key, no entries, the canary not first or under another key': () => {
      const own = ofMode('part', K1);
      const SHORT = 'fifteen-bytes-k';
      expect(SHORT.length).toBe(15);
      refusedList(undefined, 'no list');
      refusedList(null, 'a null list');
      refusedList({ entries: [canary(), ...ofMode('part', m.PRIVATE_NAME_SALT)] }, 'a missing key over a salted list');
      refusedList({ key: m.PRIVATE_NAME_SALT, entries: [canary(), ...ofMode('part', m.PRIVATE_NAME_SALT)] }, 'the public salt');
      refusedList({ key: '', entries: [canary(''), ...ofMode('part', '')] }, 'an empty key');
      refusedList({ key: SHORT, entries: [canary(SHORT), ...ofMode('part', SHORT)] }, 'a 15-byte key');
      refusedList({ key: 42, entries: [canary(K1), ...own] }, 'a non-string key');
      refusedList({ key: 12345678901234567890, entries: [canary(K1), ...own] }, 'a long numeric key');
      refusedList({ key: K1 }, 'no entries');
      refusedList({ key: K1, entries: 'zz' }, 'entries not an array');
      refusedList({ key: K1, entries: [] }, 'an empty entries array');
      refusedList({ key: K1, entries: [...own, canary(K1)] }, 'the canary not first');
      refusedList({ key: K1, entries: [canary(K2), ...own] }, 'a canary built under another key');
    },
    'the key floor counts UTF-8 bytes: sixteen ASCII bytes pass, and so do nine two-byte characters': () => {
      const own = (key: string) => listOf(key, ...ofMode('part', key));
      for (const key of ['sixteen-bytes-k!', '\u043a'.repeat(9)]) {
        expect(m.privateNameHits(NAMES.part.line, own(key)), key.length.toString()).toEqual([h8(ofMode('part', key)[0]!)]);
      }
    },
    'the canary is compared in all four fields': () => {
      const own = ofMode('part', K1);
      const c = canary(K1);
      refusedList({ key: K1, entries: [{ ...c, f: canary(K2).f }, ...own] }, 'another first-token hash');
      refusedList({ key: K1, entries: [{ ...c, n: c.n + 1 }, ...own] }, 'another token count');
      refusedList({ key: K1, entries: [{ ...c, mode: 'exact' }, ...own] }, 'another mode');
      refusedList({ key: K1, entries: [{ ...c, h: canary(K2).h }, ...own] }, 'another hash');
    },
    'malformed input is the same one word: a non-string text, a null or malformed entry anywhere in the list': () => {
      const own = ofMode('part', K1);
      for (const t of [42, null, undefined, ['see zz-alpha'], { toString: () => 'zz-alpha' }]) refused(t, listOf(K1, ...own), String(t));
      const good = own[0]!;
      for (const [bad, what] of [[null, 'null'], [{}, 'empty'], [{ ...good, n: 0 }, 'n 0'], [{ ...good, n: 1.5 }, 'n 1.5'],
        [{ ...good, mode: 'bogus' }, 'mode'], [{ ...good, h: 'zz' }, 'h'], [{ ...good, f: good.f.toUpperCase() }, 'f']] as const) {
        refusedList({ key: K1, entries: [canary(K1), ...own, bad] }, `a ${what} entry`);
      }
    },
    'nothing of the text is retained after the call, whether it hits or not': () => {
      const list = listOf(K1, ...ofMode('words', K1));
      m.hitsAt('a line read before', list.entries);
      expect(m.retainedLine()).not.toBeNull();
      expect(m.privateNameHits('by zed\nquux today', list)).toEqual([h8(list.entries[1]!)]);
      expect(m.retainedLine()).toBeNull();
      m.hitsAt('a line read before', list.entries);
      expect(m.privateNameHits('nothing here\nat all', list)).toEqual([]);
      expect(m.retainedLine()).toBeNull();
    },
    'the same token under two keys gives no shared cached answer, and neither key keeps the salt\'s hash of it': () => {
      const text = 'see zz-alpha and zv-token-k here\nzed quux';
      const a = listOf(K1, ...ofMode('part', K1), ...ofMode('words', K1));
      const b = listOf(K2, ...ofMode('part', K2), ...ofMode('words', K2));
      const salted = [canary(), ...ofMode('part', m.PRIVATE_NAME_SALT), ...ofMode('words', m.PRIVATE_NAME_SALT)];
      m.privateNameHits(text, a);
      m.privateNameHits(text, b);
      m.hitsAt(text, salted);
      const ka = new Set(m.cachedTokenHashes(a.entries, K1));
      const kb = new Set(m.cachedTokenHashes(b.entries, K2));
      const ks = new Set(m.cachedTokenHashes(salted));
      for (const s of [ka, kb, ks]) expect(s.size).toBeGreaterThan(3);
      for (const row of ka) { expect(kb.has(row)).toBe(false); expect(ks.has(row)).toBe(false); }
      for (const row of kb) expect(ks.has(row)).toBe(false);
    },
  };
}

export const PRIVATE_NAME_HITS_KEY = 'shared/private-names.mjs#privateNameHits';

export const PRIVATE_NAME_HITS_SET: MutantSet<PrivateNamesModule> = {
  modulePath: path.join(ROOT, 'shared/private-names.mjs'),
  mutants: [
    { id: 'H1 a non-string key let through', old: "if (typeof key !== 'string' || key === PRIVATE_NAME_SALT)", new: 'if (key === PRIVATE_NAME_SALT)' },
    { id: 'H2 the salt taken as a key', old: "typeof key !== 'string' || key === PRIVATE_NAME_SALT)", new: "typeof key !== 'string')" },
    {
      id: 'H3 the key floor dropped',
      old: 'if (new TextEncoder().encode(key).length < NAME_LIST_KEY_MIN_BYTES) throw new PrivateNameListInvalid();',
      new: '',
    },
    { id: 'H4 the floor counted in characters', old: 'new TextEncoder().encode(key).length', new: 'key.length' },
    {
      id: 'H5 the canary compared on h alone',
      old: 'first.h !== canary.h || first.f !== canary.f || first.n !== canary.n || first.mode !== canary.mode',
      new: 'first.h !== canary.h',
    },
    { id: 'H6 the canary checked under the salt', old: "const canary = entryOf(CANARY, 'part', key);", new: "const canary = entryOf(CANARY, 'part');" },
    { id: 'H7 pairs not read', old: "      for (const id of pairHits(lines[i - 1], lines[i], '', entries, key)) note(id, end);\n", new: '' },
    {
      id: 'H8 a duplicate returned',
      old: 'const at = new Map();',
      new: 'const at = Object.assign([], { get: () => undefined, set(id, pos) { this.push([id, pos]); } });',
    },
    { id: 'H9 the folded text returned instead of the id', old: 'note(hit.h8, hit.origStart)', new: 'note(hit.folded.slice(hit.start, hit.end), hit.origStart)' },
    {
      id: 'H10 the exemptions applied',
      old: 'for (const hit of hitsAt(text, entries, key)) note',
      new: "for (const hit of hitsAt(text, entries, key).filter((h) => !EXEMPTIONS.some((x) => x.applies('docs/ccrc-history.md', h)))) note",
    },
    { id: 'H11 a pair placed after the later line', old: 'note(id, end)', new: 'note(id, Infinity)' },
    { id: 'H12 not ordered by position', old: 'return [...at].sort((a, b) => a[1] - b[1]).map(([id]) => id);', new: 'return [...at].map(([id]) => id);' },
    {
      id: 'H13 the line gate restored',
      old: "for (const hit of hitsAt(text, entries, key)) note(hit.h8, hit.origStart);\n    const lines = text.split('\\n');",
      new: "const lines = text.split('\\n');\n    lines.forEach((l, i) => { for (const hit of hitsAt(l, entries, key)) note(hit.h8, i); });",
    },
    { id: 'H14 a non-string text let through', old: "if (typeof text !== 'string') throw new PrivateNameListInvalid();\n", new: '' },
    { id: 'H15 the entries not checked', old: 'if (!entries.every(isEntry)) throw new PrivateNameListInvalid();\n', new: '' },
    { id: 'H16 any mode taken', old: '&& MODES.includes(en.mode)', new: '' },
    { id: 'H17 any count taken', old: 'Number.isInteger(en.n) && en.n >= 1', new: 'true' },
    { id: 'H18 the text kept after the call', old: 'lastLine = null; lastIx = null; lastStarts = false;', new: '' },
  ],
  suite: hitsCases,
};

// ── PR B, Task 5: the name list's decider `nameListState` (Table P1, plan question 9) ──────────────────────────────────

export type NameListStateModule = typeof import('../../src/operatorModel/nameListState.js');
type StoreRead = Parameters<NameListStateModule['nameListState']>[0];
type KeyRead = Parameters<NameListStateModule['nameListState']>[1];

/** The decider's cases, over a module: Table P1 row by row, the canary in all four fields, the very entries array, and the
 *  monotonicity property. `private-names-list.test.ts` runs them against the real module. */
export function nameListStateCases(m: NameListStateModule, names: PrivateNamesModule): Record<string, SuiteCase> {
  const listUnder = (key: string): Entry[] =>
    [names.entryOf(names.CANARY, 'part', key) as Entry, ...(names.entriesOf(NAMES.part.name, 'part', key) as Entry[])];
  const L1 = listUnder(K1);
  const L2 = listUnder(K2);
  const list = (entries: Entry[], over: Partial<Extract<StoreRead, { kind: 'list' }>> = {}): StoreRead =>
    ({ kind: 'list', uploadedAt: 1_000, rows: 1, generation: 1, entries, ...over });
  const absent: KeyRead = { kind: 'absent' };
  const unreadable: KeyRead = { kind: 'unreadable' };
  const present: KeyRead = { kind: 'present', key: K1 };
  const decide = m.nameListState;
  const rows: [string, StoreRead, KeyRead, unknown][] = [
    ['no list row, slot absent: none', { kind: 'none' }, absent, { state: 'none' }],
    ['no list row, slot present: list-missing', { kind: 'none' }, present, { state: 'unreadable', reason: 'list-missing' }],
    ['no list row, slot unreadable: key-unreadable', { kind: 'none' }, unreadable, { state: 'unreadable', reason: 'key-unreadable' }],
    ['a list, slot absent: key-missing', list(L1), absent, { state: 'unreadable', reason: 'key-missing' }],
    ['a list, slot unreadable: key-unreadable', list(L1), unreadable, { state: 'unreadable', reason: 'key-unreadable' }],
    ['a list, its canary under another key: key-mismatch', list(L2), present, { state: 'unreadable', reason: 'key-mismatch' }],
    ['the store failed: store, whatever the slot', { kind: 'failed' }, absent, { state: 'unreadable', reason: 'store' }],
    ['the store failed, slot present: store', { kind: 'failed' }, present, { state: 'unreadable', reason: 'store' }],
    ['the store failed, slot unreadable: store', { kind: 'failed' }, unreadable, { state: 'unreadable', reason: 'store' }],
    ['a list with no entry: key-mismatch', list([]), present, { state: 'unreadable', reason: 'key-mismatch' }],
  ];
  const cases: Record<string, SuiteCase> = {};
  for (const [name, store, key, want] of rows) cases[`Table P1: ${name}`] = () => { expect(decide(store, key)).toEqual(want); };
  cases['Table P1: a list under the key answers that key and the very entries array, with rows, time and generation'] = () => {
    const v = decide(list(L1, { rows: 3, uploadedAt: 7, generation: 4 }), present);
    expect(v).toEqual({ state: 'list', list: { key: K1, entries: L1 }, rows: 3, uploadedAt: 7, generation: 4 });
    expect(v.state === 'list' && v.list.entries).toBe(L1);
  };
  cases['the canary is compared in all four fields'] = () => {
    const c = L1[0]!;
    const flip = (hex: string): string => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;
    for (const off of [{ ...c, h: flip(c.h) }, { ...c, f: flip(c.f) }, { ...c, n: c.n + 1 }, { ...c, mode: 'exact' as const }]) {
      expect(decide(list([off, ...L1.slice(1)]), present)).toEqual({ state: 'unreadable', reason: 'key-mismatch' });
    }
  };
  cases['monotone: making any input worse never moves an unreadable answer to list or none'] = () => {
    const stores: StoreRead[] = [{ kind: 'none' }, list(L1), list(L2), { kind: 'failed' }];
    const keys: KeyRead[] = [absent, unreadable, present, { kind: 'present', key: K2 }];
    // A list made worse is one whose canary is under no key a slot holds here (a third fixture key).
    const L3 = listUnder('fixture-key-three-003');
    const worseStores = (st: StoreRead): StoreRead[] => [{ kind: 'failed' }, ...(st.kind === 'list' ? [list(L3)] : [])];
    const worseKeys = (k: KeyRead): KeyRead[] => (k.kind === 'unreadable' ? [] : [unreadable]);
    let checked = 0;
    for (const st of stores) for (const k of keys) {
      if (decide(st, k).state !== 'unreadable') continue;
      for (const w of worseStores(st)) { expect(decide(w, k).state).toBe('unreadable'); checked++; }
      for (const w of worseKeys(k)) { expect(decide(st, w).state).toBe('unreadable'); checked++; }
    }
    expect(checked).toBeGreaterThan(8);
  };
  return cases;
}

export const NAME_LIST_STATE_KEY = 'server/src/operatorModel/nameListState.ts#nameListState';

export const NAME_LIST_STATE_SET: MutantSet<NameListStateModule> = {
  modulePath: path.join(ROOT, 'server/src/operatorModel/nameListState.ts'),
  mutants: [
    {
      id: 'N1 list-missing answered none',
      old: "key.kind === 'absent' ? { state: 'none' } : { state: 'unreadable', reason: 'list-missing' }",
      new: "{ state: 'none' }",
    },
    { id: 'N2 a failed store answered none', old: "if (store.kind === 'failed') return { state: 'unreadable', reason: 'store' };", new: "if (store.kind === 'failed') return { state: 'none' };" },
    { id: 'N3 a failed store not checked', old: "if (store.kind === 'failed') return { state: 'unreadable', reason: 'store' };\n", new: '' },
    { id: 'N4 an unreadable slot read as absent', old: "if (key.kind === 'unreadable') return { state: 'unreadable', reason: 'key-unreadable' };\n", new: '' },
    {
      id: 'N5 an unreadable slot with no list answered none',
      old: "if (key.kind === 'unreadable') return { state: 'unreadable', reason: 'key-unreadable' };",
      new: "if (key.kind === 'unreadable') return store.kind === 'none' ? { state: 'none' } : { state: 'unreadable', reason: 'key-unreadable' };",
    },
    { id: 'N6 key-missing not checked', old: "if (key.kind === 'absent') return { state: 'unreadable', reason: 'key-missing' };\n", new: '' },
    {
      id: 'N7 key-missing answered list',
      old: "if (key.kind === 'absent') return { state: 'unreadable', reason: 'key-missing' };",
      new: "if (key.kind === 'absent') return { state: 'list', list: { key: '', entries: store.entries }, rows: store.rows, uploadedAt: store.uploadedAt, generation: store.generation };",
    },
    { id: 'N8 the canary check skipped', old: "if (!canaryUnder(store.entries, key.key)) return { state: 'unreadable', reason: 'key-mismatch' };\n", new: '' },
    { id: 'N9 the canary compared on h alone', old: 'first.h === c.h && first.f === c.f && first.n === c.n && first.mode === c.mode', new: 'first.h === c.h' },
    { id: 'N10 the canary checked under the salt', old: "entryOf(CANARY, 'part', key)", new: "entryOf(CANARY, 'part')" },
    { id: 'N11 an empty list passes the canary', old: 'if (first === undefined) return false;', new: 'if (first === undefined) return true;' },
    { id: 'N12 the list answers a copy of its entries', old: 'entries: store.entries as NameEntry[] }', new: 'entries: [...store.entries] }' },
  ],
  suite: (mod) => nameListStateCases(mod, PRIVATE_NAMES_REAL),
};

export const PRIVATE_NAMES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PRIVATE_NAMES_KEY_KEY]: PRIVATE_NAMES_KEY_SET as MutantSet<never>,
  [PRIVATE_NAME_HITS_KEY]: PRIVATE_NAME_HITS_SET as MutantSet<never>,
  [NAME_LIST_STATE_KEY]: NAME_LIST_STATE_SET as MutantSet<never>,
};
