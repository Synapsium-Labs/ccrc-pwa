// The legacy Linear pair's file rules, held at the module level (#1444, the slot store's characterization). The
// routes' test (`linear-connection-routes.test.ts`) measures these rules through HTTP; this file measures them on
// `connection.ts` itself, so the slot store (`store.ts`), which reuses the same helpers for its slots, can be
// checked against exactly what `main` does for the pair: the key written first and removed first, both files at
// 0600, the record's bytes, a check recorded only while the stored key has the digest that was checked, and the
// verdict cleared only for that key. Written green on `main` before the store existed; it never changes after.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { valueDigestHex } from '../src/token/files.js';
import {
  LINEAR_DETAILS_FILE, LINEAR_KEY_FILE, clearLinearVerdict, keyTailOf, markLinearRejected, parseLinearDetails,
  readLinearDetails, readLinearKey, recordLinearCheck, removeLinearConnection, withConnectionLock,
  writeLinearConnection, writeLinearDetails,
} from '../src/linear/connection.js';
import type { LinearDetails } from '../../shared/linear.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
afterEach(() => { vi.restoreAllMocks(); });

const KEY = 'lin_api_fixture_key_one_0001';
const KEY2 = 'lin_api_fixture_key_two_0002';
const NOW = 1_800_000_000_000;

const ccrc = (): string => {
  const dir = path.join(mkTmp('ccrc-linear-rules-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const keyAt = (dir: string): string => path.join(dir, LINEAR_KEY_FILE);
const recAt = (dir: string): string => path.join(dir, LINEAR_DETAILS_FILE);
const details = (key: string, over: Partial<LinearDetails> = {}): LinearDetails => ({
  org: 'org-a', user: 'user-a', keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: NOW, outcome: 'ok', ...over,
});
const connect = (dir: string, key = KEY, over: Partial<LinearDetails> = {}): Promise<void> =>
  withConnectionLock(dir, () => writeLinearConnection(dir, key, details(key, over)));
const record = (dir: string): LinearDetails | null => parseLinearDetails(readFileSync(recAt(dir), 'utf8'));

/** Records the base names `fsp.rename` (the atomic writer's last step) and `fsp.rm` see, in order. */
function watchFiles(): { renamed: string[]; removed: string[] } {
  const seen = { renamed: [] as string[], removed: [] as string[] };
  const rename = fsp.rename.bind(fsp);
  const rm = fsp.rm.bind(fsp);
  vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => { seen.renamed.push(path.basename(String(to))); return rename(from, to); });
  vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => { seen.removed.push(path.basename(String(p))); return rm(p, o); });
  return seen;
}

describe('the pair is written and removed in a fixed order', () => {
  it('writes the key FIRST and the record second, both at 0600, the key as one line', async () => {
    const dir = ccrc();
    const seen = watchFiles();
    await connect(dir);
    expect(seen.renamed).toEqual([LINEAR_KEY_FILE, LINEAR_DETAILS_FILE]);
    expect(readFileSync(keyAt(dir), 'utf8')).toBe(`${KEY}\n`);
    expect(statSync(keyAt(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(recAt(dir)).mode & 0o777).toBe(0o600);
  });

  it('the record is the v1 shape, byte for byte, and never holds the key', async () => {
    const dir = ccrc();
    await connect(dir);
    const d = details(KEY);
    expect(readFileSync(recAt(dir), 'utf8')).toBe(
      `{"v":1,"org":"org-a","user":"user-a","keyTail":"0001","keyDigest":"${d.keyDigest}","checkedAt":${NOW},"outcome":"ok"}\n`,
    );
    expect(readFileSync(recAt(dir), 'utf8')).not.toContain(KEY);
  });

  it('removes the key FIRST and the record second', async () => {
    const dir = ccrc();
    await connect(dir);
    const seen = watchFiles();
    await withConnectionLock(dir, () => removeLinearConnection(dir));
    expect(seen.removed).toEqual([LINEAR_KEY_FILE, LINEAR_DETAILS_FILE]);
    expect(existsSync(keyAt(dir))).toBe(false);
    expect(existsSync(recAt(dir))).toBe(false);
  });

  it('writeLinearDetails rewrites the record and leaves the key file alone', async () => {
    const dir = ccrc();
    await connect(dir);
    const before = statSync(keyAt(dir)).mtimeMs;
    const seen = watchFiles();
    await withConnectionLock(dir, () => writeLinearDetails(dir, details(KEY, { outcome: 'unreachable' })));
    expect(seen.renamed).toEqual([LINEAR_DETAILS_FILE]);
    expect(statSync(keyAt(dir)).mtimeMs).toBe(before);
    expect(record(dir)?.outcome).toBe('unreachable');
  });
});

describe('the reads tell every condition apart', () => {
  it('the key file: key, absent, unusable, placeholder, unreadable', async () => {
    const dir = ccrc();
    expect(await readLinearKey(dir)).toEqual({ kind: 'absent' });
    writeFileSync(keyAt(dir), `${KEY}\n`, { mode: 0o600 });
    expect(await readLinearKey(dir)).toEqual({ kind: 'key', key: KEY });
    writeFileSync(keyAt(dir), '# only a comment\n');
    expect(await readLinearKey(dir)).toEqual({ kind: 'unusable' });
    chmodSync(keyAt(dir), 0o000);
    const r = await readLinearKey(dir);
    chmodSync(keyAt(dir), 0o600);
    // Root reads a 0000 file; everyone else is refused, and that is `unreadable`, never `absent`.
    if (process.getuid?.() !== 0) expect(r).toEqual({ kind: 'unreadable', code: 'EACCES' });
  });

  it('the record: details, absent, malformed', async () => {
    const dir = ccrc();
    expect(await readLinearDetails(dir)).toEqual({ kind: 'absent' });
    writeFileSync(recAt(dir), '{"v":1}\n');
    expect(await readLinearDetails(dir)).toEqual({ kind: 'malformed' });
    await connect(dir);
    expect(await readLinearDetails(dir)).toEqual({ kind: 'details', details: details(KEY) });
  });
});

describe('a check is recorded only for the key that was checked', () => {
  it('records the outcome and the time while the stored key has the checked digest', async () => {
    const dir = ccrc();
    await connect(dir);
    expect(await recordLinearCheck(dir, valueDigestHex(KEY), 'unreachable', null, NOW + 5)).toBe(true);
    expect(record(dir)).toEqual(details(KEY, { outcome: 'unreachable', checkedAt: NOW + 5 }));
  });

  it('an ok check writes the names it learned', async () => {
    const dir = ccrc();
    await connect(dir);
    await recordLinearCheck(dir, valueDigestHex(KEY), 'ok', { org: 'org-b', user: 'user-b' }, NOW + 5);
    expect(record(dir)).toMatchObject({ org: 'org-b', user: 'user-b', outcome: 'ok' });
  });

  it('writes nothing, and answers false, when the stored key has another digest', async () => {
    const dir = ccrc();
    await connect(dir, KEY2);
    const before = readFileSync(recAt(dir), 'utf8');
    expect(await recordLinearCheck(dir, valueDigestHex(KEY), 'rejected', null, NOW + 5)).toBe(false);
    expect(readFileSync(recAt(dir), 'utf8')).toBe(before);
  });

  it('writes nothing, and answers false, when there is no key', async () => {
    const dir = ccrc();
    expect(await recordLinearCheck(dir, valueDigestHex(KEY), 'ok', { org: 'o', user: 'u' }, NOW)).toBe(false);
    expect(existsSync(recAt(dir))).toBe(false);
  });

  it('a failed check keeps the names of a record that describes the same key, and drops a stale record\'s', async () => {
    const dir = ccrc();
    await connect(dir);
    await recordLinearCheck(dir, valueDigestHex(KEY), 'rejected', null, NOW + 5);
    expect(record(dir)).toMatchObject({ org: 'org-a', user: 'user-a', outcome: 'rejected' });
    // The record describes KEY2 while the stored key is KEY: its names are not KEY's.
    await withConnectionLock(dir, () => writeLinearDetails(dir, details(KEY2)));
    await recordLinearCheck(dir, valueDigestHex(KEY), 'rejected', null, NOW + 6);
    expect(record(dir)).toEqual(details(KEY, { org: null, user: null, outcome: 'rejected', checkedAt: NOW + 6 }));
  });

  it('a check with no record beside the key writes a full record', async () => {
    const dir = ccrc();
    writeFileSync(keyAt(dir), `${KEY}\n`, { mode: 0o600 });
    await recordLinearCheck(dir, valueDigestHex(KEY), 'rejected', null, NOW);
    expect(record(dir)).toEqual(details(KEY, { org: null, user: null, outcome: 'rejected' }));
  });

  it('markLinearRejected is the rejected outcome under the same rule', async () => {
    const dir = ccrc();
    await connect(dir);
    expect(await markLinearRejected(dir, valueDigestHex(KEY2), NOW + 1)).toBe(false);
    expect(record(dir)?.outcome).toBe('ok');
    expect(await markLinearRejected(dir, valueDigestHex(KEY), NOW + 1)).toBe(true);
    expect(record(dir)).toEqual(details(KEY, { outcome: 'rejected', checkedAt: NOW + 1 }));
  });
});

describe('a verdict is cleared only for the key that earned it', () => {
  for (const outcome of ['rejected', 'forbidden'] as const) {
    it(`a ${outcome} record of the used key becomes ok, keeping its names`, async () => {
      const dir = ccrc();
      await connect(dir, KEY, { outcome });
      expect(await clearLinearVerdict(dir, valueDigestHex(KEY), NOW + 9)).toBe(true);
      expect(record(dir)).toEqual(details(KEY, { outcome: 'ok', checkedAt: NOW + 9 }));
    });
  }

  it('an ok or unreachable record is not rewritten (no churn per lookup)', async () => {
    for (const outcome of ['ok', 'unreachable'] as const) {
      const dir = ccrc();
      await connect(dir, KEY, { outcome });
      const before = readFileSync(recAt(dir), 'utf8');
      const seen = watchFiles();
      expect(await clearLinearVerdict(dir, valueDigestHex(KEY), NOW + 9)).toBe(false);
      expect(seen.renamed).toEqual([]);
      expect(readFileSync(recAt(dir), 'utf8')).toBe(before);
      vi.restoreAllMocks();
    }
  });

  it('a key replaced since the lookup, or a record that describes another key, is left alone', async () => {
    const dir = ccrc();
    await connect(dir, KEY2, { outcome: 'rejected' });
    expect(await clearLinearVerdict(dir, valueDigestHex(KEY), NOW + 9)).toBe(false);
    // The stored key is KEY, its record still describes KEY2 (a replace caught between its two writes).
    writeFileSync(keyAt(dir), `${KEY}\n`);
    const before = readFileSync(recAt(dir), 'utf8');
    expect(await clearLinearVerdict(dir, valueDigestHex(KEY), NOW + 9)).toBe(false);
    expect(readFileSync(recAt(dir), 'utf8')).toBe(before);
  });
});

describe('the lock', () => {
  it('runs one act at a time per directory, and a failed act does not hold up the next', async () => {
    const dir = ccrc();
    const log: string[] = [];
    let release!: () => void;
    const first = withConnectionLock(dir, async () => {
      log.push('first in');
      await new Promise<void>((r) => { release = r; });
      log.push('first out');
      throw new Error('boom');
    });
    const second = withConnectionLock(dir, async () => { log.push('second'); return 2; });
    await new Promise((r) => setImmediate(r));
    expect(log).toEqual(['first in']);
    release();
    await expect(first).rejects.toThrow('boom');
    expect(await second).toBe(2);
    expect(log).toEqual(['first in', 'first out', 'second']);
  });
});
