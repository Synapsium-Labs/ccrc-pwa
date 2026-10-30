// The PWA's one storage port (D-7190; W7 Task C7l; ARCH-75 #810): `lib/storage.ts`'s guarded reads, writes and removes.
// A storage that throws (a private window, a preview, blocked storage, a getter that throws on being named) reads null
// and writes nothing; read, write and remove round-trip; and the injectable instance (`memoryStorage`, the one
// `test/setup.ts` installs when the page's storage is unusable) is a working store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage, pageStorage, readKey, removeKey, UNREADABLE, writeKey, type StoragePort } from '../src/lib/storage';

const throwing: StoragePort = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('quota'); },
  removeItem: () => { throw new Error('blocked'); },
};

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

describe('a storage that throws reads null and writes nothing', () => {
  it('a throwing store: read null, write and remove refused, nothing thrown', () => {
    expect(readKey('key-a', () => throwing)).toBeNull();
    expect(writeKey('key-a', 'v', () => throwing)).toBe(false);
    expect(removeKey('key-a', () => throwing)).toBe(false);
  });

  it('a getter that throws on being named reads null and writes nothing', () => {
    const named = (): StoragePort => { throw new Error('SecurityError'); };
    expect(readKey('key-a', named)).toBeNull();
    expect(writeKey('key-a', 'v', named)).toBe(false);
    expect(removeKey('key-a', named)).toBe(false);
  });

  it('no store at all reads null and writes nothing', () => {
    expect(readKey('key-a', () => null)).toBeNull();
    expect(writeKey('key-a', 'v', () => null)).toBe(false);
    expect(removeKey('key-a', () => null)).toBe(false);
  });

  it('the page store refusing (Storage.prototype throws) reads null and leaves the key unwritten', () => {
    window.localStorage.setItem('key-a', 'before');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(readKey('key-a')).toBeNull();
    expect(writeKey('key-a', 'after')).toBe(false);
    vi.restoreAllMocks();
    expect(window.localStorage.getItem('key-a')).toBe('before');
  });

  it('the unreadable arm: a caller that must tell "threw" from "absent" names its own answer', () => {
    expect(readKey('key-a', () => throwing, UNREADABLE)).toBe(UNREADABLE);
    expect(readKey('key-a', () => null, UNREADABLE)).toBe(UNREADABLE);
    expect(readKey('key-a', pageStorage, UNREADABLE)).toBeNull();
  });
});

describe('read, write and remove round-trip', () => {
  it('over the page store (window.localStorage), byte for byte', () => {
    expect(readKey('key-a')).toBeNull();
    expect(writeKey('key-a', '{"a":1}')).toBe(true);
    expect(window.localStorage.getItem('key-a')).toBe('{"a":1}');
    expect(readKey('key-a')).toBe('{"a":1}');
    expect(removeKey('key-a')).toBe(true);
    expect(readKey('key-a')).toBeNull();
    expect(window.localStorage.getItem('key-a')).toBeNull();
  });

  it('pageStorage is window.localStorage', () => {
    expect(pageStorage()).toBe(window.localStorage);
  });
});

describe('the injectable instance', () => {
  it('memoryStorage is a working Storage of its own, apart from the page store', () => {
    const mem = memoryStorage();
    expect(writeKey('key-a', 'v', () => mem)).toBe(true);
    expect(readKey('key-a', () => mem)).toBe('v');
    expect(mem.length).toBe(1);
    expect(mem.key(0)).toBe('key-a');
    expect(window.localStorage.getItem('key-a')).toBeNull();
    expect(removeKey('key-a', () => mem)).toBe(true);
    expect(mem.getItem('key-a')).toBeNull();
    mem.setItem('key-b', 'w');
    mem.clear();
    expect(mem.length).toBe(0);
  });

  it('memoryStorage stores a string, as Storage does', () => {
    const mem = memoryStorage();
    mem.setItem('key-a', 12 as unknown as string);
    expect(mem.getItem('key-a')).toBe('12');
  });
});
