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
// THE PAGE VALUE: the last choice is also kept in a module value, so a choice storage refuses (private mode, a full
// quota) still holds for this page, as `theme.ts` keeps `chosen`. Storage wins whenever it holds one of the two words,
// so a choice another tab stored is followed; the page value answers only when storage says nothing readable.
import { useSyncExternalStore } from 'react';

const KEY = 'ccrc-accounts-strip';

/** The last choice made on this page, whether or not storage took it. A reload loses it and storage keeps its own. */
let pageValue = false;
const listeners = new Set<() => void>();

/** Whether the strip shows every lane: storage's word when it holds one, else this page's last choice, else folded. */
function readExpanded(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === 'expanded') return true;
    if (raw === 'folded') return false;
  } catch {
    /* unreadable: the page value below answers */
  }
  return pageValue;
}

/** Remember the choice: the page value always, storage when it takes it. Every mounted strip is told. */
export function setStripExpanded(expanded: boolean): void {
  pageValue = expanded;
  try {
    window.localStorage.setItem(KEY, expanded ? 'expanded' : 'folded');
  } catch {
    /* the page value still holds it for this page */
  }
  for (const notify of [...listeners]) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab's write to the key (a `null` key is a `clear()`), so two open tabs agree without a reload.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === KEY) notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Whether the strip shows every lane, live: re-read when this page chooses or another tab writes the key. */
export function useStripExpanded(): boolean {
  return useSyncExternalStore(subscribe, readExpanded, () => false);
}
