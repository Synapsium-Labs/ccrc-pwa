// The private-name list's one reader, and its key's one writer (Overlord W2, private names B, Task 5). Ring L3, context C11:
// it reads the private store and the `.server` key slot, asks `nameListState` (L1) for the answer, and keeps the built list
// cached by the list's generation and its key.
//
// EVERY DOOR READS THE LIST THROUGH `readPrivateNameList` (one reader per fact): the status read now, the relay and the
// decision model's hosted screen later. Its answers are the decider's: `none` (never uploaded, the only answer that skips the
// check), `list` (`{ key, entries }`, what `privateNameHits` takes), or `unreadable` with its reason.
//
// THE CACHE (ruled, 2264 F11; slug `name-list-cached-by-generation`). The matcher indexes an entries array by its identity,
// so a fresh array per check would rebuild its slot tables on every call, and a kept one would go stale after an upload. So
// each call reads the list's generation (one row) and the key slot, and rebuilds the entries array only when either changed;
// each upload raises the generation in `replacePrivateNames`' transaction. The cache holds keyed hashes and the key, which
// the answer carries anyway, never a name.
//
// THE KEY (ruled, 2264 F4; slug `name-list-key-in-a-server-slot`): 32 random bytes as hex, minted in memory by
// `mintNameListKey` from the entropy port (spec §11.5: chance comes through the ports), written only by `writeNameListKey` (no tail kept; the masker is told the value), read only by
// `readNameListKey`, and removed by nothing.
import { NAME_LIST_KEY_SLOT } from '../../../shared/privateNames.js';
import {
  readServerSecretValue, writeServerSecret, type OperatorSecretMeta, type RegisterSecret, type ServerSecretRead,
} from '../coord/ledgersSecrets.js';
import type { Entropy } from '../time/ports.js';
import type { OperatorModelStore } from './store.js';
import { nameListState, type NameEntry, type NameListKeyRead, type NameListStoreRead, type NameListVerdict } from './nameListState.js';

/** The two reads of the store the reader makes. */
export type NameListStore = Pick<OperatorModelStore, 'privateNamesRead' | 'privateNamesGeneration'>;

interface Built { readonly generation: number; readonly key: string; readonly rows: number; readonly uploadedAt: number; readonly entries: readonly NameEntry[] }
/** One built list per store, keyed by the store's identity. */
const BUILT = new WeakMap<NameListStore, Built>();

/** What `mintNameListKey` makes: 32 bytes as lowercase hex. */
const MINTED_KEY = /^[0-9a-f]{64}$/;

/** The key slot's value, measured: absent, unreadable or the key. Never logged. A value that is not a minted key (not exactly 64
 *  lowercase hex: a hand edit or a damaged file) reads `unreadable` (review 2344 F2): a short key would pass the canary once an
 *  upload rebuilt the list under it, and the status would read `list` while the matcher refused every check under it. */
export function readNameListKey(ccrcDir: string): ServerSecretRead {
  const r = readServerSecretValue(ccrcDir, NAME_LIST_KEY_SLOT);
  return r.state === 'value' && !MINTED_KEY.test(r.value) ? { state: 'unreadable' } : r;
}

/** A new key, in memory only: 32 random bytes as hex, from the entropy port. The upload door writes it, after building the
 *  list under it. */
export function mintNameListKey(entropy: Entropy): string {
  return entropy.hex(32);
}

/** The one writer of the key slot: the value, with no tail recorded, registered with the egress masker. */
export function writeNameListKey(ccrcDir: string, key: string, now: number, register: RegisterSecret): Promise<OperatorSecretMeta> {
  return writeServerSecret(ccrcDir, NAME_LIST_KEY_SLOT, key, now, register, { tail: 'none' });
}

const keyReadOf = (r: ServerSecretRead): NameListKeyRead =>
  (r.state === 'value' ? { kind: 'present', key: r.value } : r.state === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' });

/** The list, as every door reads it. `store` absent (no private store on this server) reads `unreadable: store`. */
export function readPrivateNameList(store: NameListStore | undefined, ccrcDir: string): NameListVerdict {
  const keyRaw = (() => { try { return readNameListKey(ccrcDir); } catch { return { state: 'unreadable' } as const; } })();
  const key = keyReadOf(keyRaw);
  if (store === undefined) return nameListState({ kind: 'failed' }, key);
  const gen = store.privateNamesGeneration();
  let read: NameListStoreRead;
  if (gen.kind === 'unmeasured') read = { kind: 'failed' };
  else if (gen.value === 'none') read = { kind: 'none' };
  else {
    const built = BUILT.get(store);
    if (built !== undefined && built.generation === gen.value && key.kind === 'present' && built.key === key.key) {
      read = { kind: 'list', ...built };
    } else {
      const r = store.privateNamesRead();
      read = r.kind === 'unmeasured' ? { kind: 'failed' } : r.value.kind === 'none' ? { kind: 'none' } : {
        kind: 'list', uploadedAt: r.value.uploadedAt, rows: r.value.rows, generation: r.value.generation,
        entries: Object.freeze(r.value.entries.map((e) => Object.freeze({ ...e }))),
      };
    }
  }
  const verdict = nameListState(read, key);
  if (verdict.state === 'list') {
    BUILT.set(store, {
      generation: verdict.generation, key: verdict.list.key, rows: verdict.rows, uploadedAt: verdict.uploadedAt, entries: verdict.list.entries,
    });
  } else {
    BUILT.delete(store);
  }
  return verdict;
}
