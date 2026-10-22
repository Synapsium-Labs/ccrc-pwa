// releaseDismissal — the per-device memory of the release the operator hid from the fleet's update line (D-6327,
// part b). ONE value: the highest release tag dismissed, kept in `localStorage` under `ccrc-release-dismissed`. It is
// a HIGH-WATER MARK, not a set: the line shows again when a NEWER release waits (`shownRelease`, releaseWaiting.ts, is
// the rule), and stays hidden for the same tag and for an older one (a release withdrawn after a newer one was seen).
//
// WHAT STORAGE MAY SAY: a value counts only when it is a well-formed release tag (`isReleaseTag`); absent, malformed
// or unreadable storage dismisses nothing, because the failure of a convenience must never hide a release. Every read
// and write is in try/catch, and always via `window.localStorage` (Node 22 ships a bare `localStorage` global that
// shadows jsdom's; foldState.ts has the same idiom).
//
// THE PAGE MARK: a dismissal is recorded on the page too, so it holds for this page when storage refuses the write
// (private mode, a full quota). `readDismissed` answers the higher of the two, so a tab that wrote a newer tag is
// honoured and this page's older one never lowers it. `dismissRelease` re-reads storage first, so two tabs agree.
// This is per device and per browser: nothing is sent to the server, and Settings › Updates never reads it.
import { useSyncExternalStore } from 'react';
import { isReleaseTag } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';

const KEY = 'ccrc-release-dismissed';

/** The highest tag dismissed on this page, whether or not storage took it. */
let pageMark: string | null = null;
const listeners = new Set<() => void>();

/** The higher of two marks (either may be absent). Both are validated tags, so the comparison cannot throw. */
function higher(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return compareReleaseTags(a, b) >= 0 ? a : b;
}

/** What storage holds, counted only when it is a well-formed tag. Never throws. */
function readStored(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return isReleaseTag(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The release tag dismissed on this device (storage and this page together), or `null` when none is. */
export function readDismissed(): string | null {
  return higher(readStored(), pageMark);
}

/** Hide the release `tag` until a newer one waits. A non-tag is refused silently. Never lowers the mark: storage is
 *  re-read first, and a newer or equal tag already there is left as it is. The page mark is always recorded, so the
 *  dismissal holds for this page even when storage refuses the write. */
export function dismissRelease(tag: string): void {
  if (!isReleaseTag(tag)) return;
  const stored = readStored();
  if (stored === null || compareReleaseTags(tag, stored) === 1) {
    try {
      window.localStorage.setItem(KEY, tag);
    } catch {
      /* the page mark below still holds it for this page */
    }
  }
  pageMark = higher(pageMark, tag);
  for (const notify of [...listeners]) notify();
}

/** Forget the page-level mark, as a fresh page load would. For tests only: a reload keeps storage and loses this. */
export function resetDismissalForTests(): void {
  pageMark = null;
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

/** The dismissed release tag, live: re-read when this page dismisses one or another tab writes the key. */
export function useDismissedRelease(): string | null {
  return useSyncExternalStore(subscribe, readDismissed, () => null);
}
