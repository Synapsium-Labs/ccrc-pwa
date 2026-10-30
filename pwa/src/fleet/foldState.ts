// Which projects the reader has collapsed, persisted per browser. Absent means
// EXPANDED, so a first run, a cleared store and a corrupt store all open
// everything — the failure mode of a layout preference must never be a fleet
// the reader cannot see. lib/offline.ts is the precedent for persisted state.
//
// Per-browser, not per-account: two devices fold independently, which is the
// right default for a layout preference and needs no sync.
import { useCallback, useState } from 'react';
import { readKey, writeKey } from '../lib/storage';
import { NO_ROLLUP_PREFS, type ActivityClass, type RollupPrefs } from './rollup';

// Read and written through the one storage port (`lib/storage.ts`, D-7190).
const KEY = 'ccrc.fleet-folded.v1';

/** The collapsed project names. Empty on an absent, corrupt or unreadable store. */
export function loadFolded(): ReadonlySet<string> {
  try {
    const raw = readKey(KEY);
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
  writeKey(KEY, JSON.stringify([...folded]));
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

// THE ROLLUP PREFERENCES (D-6088): the operator's own ▾ on a project, stored with the activity class it was made in,
// and the coordinators whose worker line is open. `rollup.ts` decides what they mean; this only keeps them, per
// browser, as the set above is kept. An absent, corrupt or unreadable store reads as NO preferences, which is the
// default rule (an active project open, a question never hidden), never a fleet the reader cannot see. The project
// names the set above stored before D-6088 are no longer read; its `::released`/`::archived` sub-folds still are.
const ROLLUP_KEY = 'ccrc.fleet-rollup.v1';

/** The stored rollup preferences, filtered field by field: junk would round-trip back into storage and never wash out. */
export function loadRollupPrefs(): RollupPrefs {
  try {
    const raw = readKey(ROLLUP_KEY);
    if (!raw) return NO_ROLLUP_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return NO_ROLLUP_PREFS;
    const o = parsed as { projects?: unknown; openChildren?: unknown };
    const projects: Record<string, { collapsed: boolean; cls: ActivityClass }> = {};
    if (typeof o.projects === 'object' && o.projects !== null && !Array.isArray(o.projects)) {
      for (const [p, v] of Object.entries(o.projects)) {
        const e = v as { collapsed?: unknown; cls?: unknown } | null;
        if (e !== null && typeof e === 'object' && typeof e.collapsed === 'boolean' && (e.cls === 'active' || e.cls === 'inactive')) {
          projects[p] = { collapsed: e.collapsed, cls: e.cls };
        }
      }
    }
    const openChildren = Array.isArray(o.openChildren)
      ? o.openChildren.filter((id): id is string => typeof id === 'string')
      : [];
    return { projects, openChildren };
  } catch {
    return NO_ROLLUP_PREFS;
  }
}

/** Best-effort persist, as `saveFolded`. */
export function saveRollupPrefs(prefs: RollupPrefs): void {
  writeKey(ROLLUP_KEY, JSON.stringify(prefs));
}

/** The rollup preferences plus an updater that persists. An updater answering its input unchanged writes nothing. */
export function useRollupPrefs(): [RollupPrefs, (next: (prev: RollupPrefs) => RollupPrefs) => void] {
  const [prefs, setPrefs] = useState<RollupPrefs>(loadRollupPrefs);
  const update = useCallback((next: (prev: RollupPrefs) => RollupPrefs): void => {
    setPrefs((prev) => {
      const value = next(prev);
      if (value !== prev) saveRollupPrefs(value);
      return value;
    });
  }, []);
  return [prefs, update];
}
