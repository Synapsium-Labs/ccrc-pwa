// The PWA's ONE storage port (D-7190; W7 Task C7l; ARCH-75 #810, spec K14): every per-device value the PWA keeps (the
// skin, the theme, the fleet's folds, the seen acks, the notify watermark, the drawer's view, the strip's fold, the
// inspector's choice, …) is read, written and removed here and nowhere else. A lib adapter by `pwaRing` (L3: it names
// the browser's storage). It moves WHERE the access lives, never what is stored: each owner keeps its own key and its
// own value, byte for byte, so a device keeps every remembered choice across the deploy.
//
// EVERY ACCESS IS GUARDED. Storage throws in a private window, in previews and thumbnail capture, under a full quota
// and when a policy blocks it, sometimes on merely being named. A guarded read that fails answers `null` ("nothing
// stored"), and a guarded write or remove that fails changes nothing and answers `false`, so an owner that must tell
// a refused write apart (the page then holds the choice) can. An owner that must tell "the read threw" from "nothing
// is stored" passes its own answer for the first (`readKey(key, from, UNREADABLE)`).
//
// ALWAYS VIA `window.` — Node 22+ ships an experimental bare `localStorage` global that shadows jsdom's working one
// under vitest (the idiom `fleet/foldState.ts` and `fleet/stripExpanded.ts` carried before this port).
//
// INJECTABLE: every function takes the store as a getter (`from`), so a test can hand it one that throws, or the
// in-memory instance below; production passes nothing and gets the page's.

/** The slice of `Storage` the PWA uses: the one storage type. The DOM's `Storage` is one, and so is `memoryStorage`. */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Where a value is kept: a getter, so naming the store happens inside the guard. `null` is "no storage here". */
export type StorageSource = () => StoragePort | null;

/** The page's store, `window.localStorage`, or `null` where there is none (no window) or naming it throws. */
export const pageStorage: StorageSource = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The answer a caller passes to tell "the read threw, or there is no store" from "nothing is stored". */
export const UNREADABLE: unique symbol = Symbol('unreadable');

/** The value stored under `key`, or `null`: for nothing stored, and for a store that throws or is absent. */
export function readKey(key: string, from?: StorageSource): string | null;
/** The value stored under `key`, `null` when nothing is, and `unreadable` when the store throws or is absent. */
export function readKey<U>(key: string, from: StorageSource, unreadable: U): string | null | U;
export function readKey<U>(key: string, from: StorageSource = pageStorage, unreadable: U | null = null): string | null | U {
  try {
    const s = from();
    return s === null ? unreadable : s.getItem(key);
  } catch {
    return unreadable;
  }
}

/** Store `value` under `key`. `true` when the store took it; `false` when it threw or there is none (nothing changed). */
export function writeKey(key: string, value: string, from: StorageSource = pageStorage): boolean {
  try {
    const s = from();
    if (s === null) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Forget `key`. `true` when the store did; `false` when it threw or there is none. */
export function removeKey(key: string, from: StorageSource = pageStorage): boolean {
  try {
    const s = from();
    if (s === null) return false;
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** A working in-memory `Storage` of its own: the injectable instance. `test/setup.ts` installs one as the page's store
 *  where the environment's is unusable; a suite can hand one to any function above as `() => memoryStorage()`'s
 *  result. Never used by production code. */
export function memoryStorage(): Storage {
  const backing = new Map<string, string>();
  return {
    get length(): number {
      return backing.size;
    },
    clear: (): void => backing.clear(),
    getItem: (k: string): string | null => backing.get(k) ?? null,
    key: (i: number): string | null => [...backing.keys()][i] ?? null,
    removeItem: (k: string): void => void backing.delete(k),
    setItem: (k: string, v: string): void => void backing.set(k, String(v)),
  };
}
