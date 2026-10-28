// stripExpanded — the per-device memory of whether the lanes strip shows every lane or folds to the freest few (desktop
// polish S5b, D-6530; the operator's rulings Q10 and Q13). ONE value in `localStorage` under `ccrc-accounts-strip`:
// `'expanded'` or `'folded'`. It names `window.localStorage` and exports a hook, so it is L4 by `pwaRing`, as
// `foldState.ts` is; the fold's arithmetic is `stripFold.ts`'s.
//
// WHAT STORAGE MAY SAY: only `'expanded'` expands. Absent, malformed or unreadable storage reads folded: unlike
// `foldState.ts`, where absent means expanded ("never a fleet the reader cannot see"), the fold is the default here,
// because its "+n more" words keep every hidden lane that needs the operator on screen and the full strip is one tap
// away. Every read and write is in try/catch and goes through `window.localStorage` (Node 22 ships a bare
// `localStorage` global that shadows jsdom's; `foldState.ts` has the same idiom).
//
// THE PHONE NEVER READS IT: `useStripExpanded(enabled)` answers `false` and touches nothing (no storage read, no
// subscription, no `storage` listener) when `enabled` is false. Below 900 px the strip passes false
// (phone-strip-tap-panel: a phone is always folded, with the panel one tap away), so this per-device key keeps its desk
// meaning only, and a phone neither reads nor writes it.
//
// THE PAGE VALUE: the last choice made on this page is also kept in a module value, as `theme.ts` keeps `chosen`.
// It answers in two cases only. (1) Storage is unreadable: the strip reads folded until this page chooses, and then the
// page's choice holds. (2) A write was REFUSED (private mode, a full quota, a policy error, with reads still working):
// storage then holds a stale word, so the page's choice is authoritative over it until another tab's write to the key
// arrives (a `storage` event) or a later write of this page succeeds. Otherwise storage wins whenever it holds one of
// the two words, so a choice another tab stored is followed; absent or malformed storage reads folded.
import { useSyncExternalStore } from 'react';

const KEY = 'ccrc-accounts-strip';

/** The last choice made on this page, whether or not storage took it. A reload loses it and storage keeps its own. */
let pageValue = false;
/** The last write of this page was refused, so storage may hold a stale word that `pageValue` must override. */
let writeRefused = false;
const listeners = new Set<() => void>();

/** Whether the strip shows every lane: this page's choice after a refused write, else storage's word, else folded
 *  (absent or malformed storage); over unreadable storage, this page's choice if it made one, else folded. */
function readExpanded(): boolean {
  if (writeRefused) return pageValue;
  try {
    return window.localStorage.getItem(KEY) === 'expanded';
  } catch {
    return pageValue;
  }
}

/** Remember the choice: the page value always, storage when it takes it. Every mounted strip is told. */
export function setStripExpanded(expanded: boolean): void {
  pageValue = expanded;
  try {
    window.localStorage.setItem(KEY, expanded ? 'expanded' : 'folded');
    writeRefused = false;
  } catch {
    // The page value now overrides whatever storage still holds, until another tab writes the key.
    writeRefused = true;
  }
  for (const notify of [...listeners]) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab's write to the key (a `null` key is a `clear()`), so two open tabs agree without a reload.
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== KEY) return;
    // Storage speaks again, so a refused choice of this page no longer overrides it.
    writeRefused = false;
    notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** The disabled hook's whole machinery: no subscription to make, and one answer. Module-level, so each branch hands
 *  `useSyncExternalStore` the same function identities on every render. */
const subscribeNothing = (): (() => void) => () => {};
const readFolded = (): boolean => false;

/** Whether the strip shows every lane, live: re-read when this page chooses or another tab writes the key. With
 *  `enabled` false (a phone) it answers `false` and touches nothing: no storage read, no subscription, no listener. */
export function useStripExpanded(enabled: boolean): boolean {
  return useSyncExternalStore(enabled ? subscribe : subscribeNothing, enabled ? readExpanded : readFolded, readFolded);
}
