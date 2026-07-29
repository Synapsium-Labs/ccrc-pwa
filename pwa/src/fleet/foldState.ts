// Which projects the reader has collapsed, persisted per browser. Absent means
// EXPANDED, so a first run, a cleared store and a corrupt store all open
// everything — the failure mode of a layout preference must never be a fleet
// the reader cannot see. lib/offline.ts is the precedent for persisted state.
//
// Per-browser, not per-account: two devices fold independently, which is the
// right default for a layout preference and needs no sync.
import { useCallback, useState } from 'react';

const KEY = 'ccrc.fleet-folded.v1';

// Always via `window.` — Node 22+ ships an experimental bare `localStorage`
// global that shadows jsdom's working one under vitest (lib/offline.ts).
const storage = (): Storage => window.localStorage;

/** The collapsed project names. Empty on an absent, corrupt or unreadable store. */
export function loadFolded(): ReadonlySet<string> {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    // Filter rather than trust: junk in the set would round-trip back into
    // storage on the next toggle and never wash out.
    return new Set(parsed.filter((p): p is string => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

/** Best-effort persist — quota errors and private-mode walls are swallowed,
 *  exactly as saveFleetSnapshot does. A fold that cannot be saved still folds
 *  for this session. */
export function saveFolded(folded: ReadonlySet<string>): void {
  try {
    storage().setItem(KEY, JSON.stringify([...folded]));
  } catch {
    /* ignore */
  }
}

/** The collapsed set plus a toggle that persists. The initializer is lazy, so
 *  storage is read once per mount rather than on every render. */
export function useFolded(): [ReadonlySet<string>, (project: string) => void] {
  const [folded, setFolded] = useState<ReadonlySet<string>>(loadFolded);
  const toggle = useCallback((project: string): void => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      saveFolded(next);
      return next;
    });
  }, []);
  return [folded, toggle];
}
