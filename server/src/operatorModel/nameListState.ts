// The private-name list's one decider (Overlord W2, private names B, Task 5; plan question 9, Table P1). Ring L1, context
// C11: pure, no I/O, imports L0 only. It decides what the list's reader answers from what the store and the key slot said.
//
// ONLY A LIST NEVER UPLOADED SKIPS THE CHECK (ruled, F9; slug `only-never-uploaded-skips`). The list's row in the private
// store and its key slot in the operator-secrets store are each the other's witness that an upload happened: the slot is
// written at the first upload and removed by nothing. So a key with no list, a list with no key, a slot that cannot be
// read, a list whose canary is not under the slot's key, and a store that could not be read are all `unreadable`, each with
// its reason, and the relay refuses on every one of them. `none` is answered only when BOTH say nothing was ever uploaded.
import { CANARY, entryOf, type NameList } from '../../../shared/private-names.mjs';
import type { NameListUnreadable } from '../../../shared/privateNames.js';

/** One stored entry: the matcher's shape (`entryOf`), keyed hashes and a token count, never a name. */
export type NameEntry = NameList['entries'][number];
/** What the private store said of the list. */
export type NameListStoreRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'list'; readonly uploadedAt: number; readonly rows: number; readonly generation: number; readonly entries: readonly NameEntry[] }
  | { readonly kind: 'failed' };
/** What the key slot said. */
export type NameListKeyRead = { readonly kind: 'absent' } | { readonly kind: 'unreadable' } | { readonly kind: 'present'; readonly key: string };
/** The reader's answer: never uploaded, a list a check can scan with (`list`, `privateNameHits`' `NameList`), or why not. */
export type NameListVerdict =
  | { readonly state: 'none' }
  | { readonly state: 'list'; readonly list: NameList; readonly rows: number; readonly uploadedAt: number; readonly generation: number }
  | { readonly state: 'unreadable'; readonly reason: NameListUnreadable };

/** Whether the list's first entry is the canary under `key`, in all four fields (`the-canary-checks-the-key`). */
function canaryUnder(entries: readonly NameEntry[], key: string): boolean {
  const first = entries[0];
  if (first === undefined) return false;
  const c = entryOf(CANARY, 'part', key);
  return first.h === c.h && first.f === c.f && first.n === c.n && first.mode === c.mode;
}

/** Table P1, whole: the store's read and the key slot's read decide the answer. */
export function nameListState(store: NameListStoreRead, key: NameListKeyRead): NameListVerdict {
  if (store.kind === 'failed') return { state: 'unreadable', reason: 'store' };
  if (key.kind === 'unreadable') return { state: 'unreadable', reason: 'key-unreadable' };
  if (store.kind === 'none') return key.kind === 'absent' ? { state: 'none' } : { state: 'unreadable', reason: 'list-missing' };
  if (key.kind === 'absent') return { state: 'unreadable', reason: 'key-missing' };
  if (!canaryUnder(store.entries, key.key)) return { state: 'unreadable', reason: 'key-mismatch' };
  // The entries array is passed on as it came (the matcher's index is keyed on its identity); `privateNameHits` never writes it.
  return {
    state: 'list', list: { key: key.key, entries: store.entries as NameEntry[] },
    rows: store.rows, uploadedAt: store.uploadedAt, generation: store.generation,
  };
}
