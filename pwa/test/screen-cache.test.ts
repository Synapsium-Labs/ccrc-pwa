// Console speed, task C2 ("the last view kept"): the one bounded in-memory cache of query answers
// (`src/lib/screenCache.ts`). It keeps the last raw answer per key, at most SCREEN_CACHE_MAX keys, oldest dropped first,
// and writes no browser storage.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCREEN_CACHE_MAX, clearScreenCache, digestKey, forget, peek, put, settingsKey,
} from '../src/lib/screenCache';

beforeEach(() => clearScreenCache());

describe('screenCache', () => {
  it('put then peek answers the raw and its time', () => {
    const raw = { ok: true, n: 1 };
    put('k', raw, 1234);
    expect(peek('k')).toEqual({ raw, at: 1234 });
    expect(peek('k')?.raw).toBe(raw);
    expect(peek('absent')).toBeUndefined();
  });

  it('a second put replaces the answer and its time', () => {
    put('k', 'one', 1);
    put('k', 'two', 2);
    expect(peek('k')).toEqual({ raw: 'two', at: 2 });
  });

  it('the 65th key drops the oldest', () => {
    expect(SCREEN_CACHE_MAX).toBe(64);
    for (let i = 0; i < SCREEN_CACHE_MAX; i += 1) put(`k${i}`, i, i);
    expect(peek('k0')).toEqual({ raw: 0, at: 0 });
    put('k64', 64, 64);
    expect(peek('k0')).toBeUndefined();
    expect(peek('k1')).toEqual({ raw: 1, at: 1 });
    expect(peek('k64')).toEqual({ raw: 64, at: 64 });
  });

  it('peek moves nothing, put moves the key to newest', () => {
    for (let i = 0; i < SCREEN_CACHE_MAX; i += 1) put(`k${i}`, i, i);
    // peek on the oldest does not save it
    expect(peek('k0')?.raw).toBe(0);
    put('extra-a', 'a', 100);
    expect(peek('k0')).toBeUndefined();
    // put on the (now) oldest moves it to newest, so the next drop takes k2
    put('k1', 'again', 101);
    put('extra-b', 'b', 102);
    expect(peek('k1')).toEqual({ raw: 'again', at: 101 });
    expect(peek('k2')).toBeUndefined();
    expect(peek('k3')?.raw).toBe(3);
  });

  it('forget removes one key', () => {
    put('a', 1, 1);
    put('b', 2, 2);
    forget('a');
    expect(peek('a')).toBeUndefined();
    expect(peek('b')?.raw).toBe(2);
    forget('never-put');   // a no-op, never a throw
  });

  it('clearScreenCache empties it', () => {
    put('a', 1, 1);
    clearScreenCache();
    expect(peek('a')).toBeUndefined();
  });

  it('the key builders keep every name and every day apart', () => {
    const names = ['updates', 'stall-watch', 'collect-lane', 'dispatch-abandon', 'testbox', 'linear-workspaces', 'auth',
      'passkeys'] as const;
    const keys = [...names.map((n) => settingsKey(n)), digestKey(null), digestKey('2026-11-03'), digestKey('2026-11-04')];
    expect(new Set(keys).size).toBe(keys.length);
    expect(digestKey('2026-11-04')).toBe(digestKey('2026-11-04'));
  });

  it('the module imports no storage API', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'screenCache.ts'), 'utf8');
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', "from './storage'"]) expect(src).not.toContain(api);
  });
});
