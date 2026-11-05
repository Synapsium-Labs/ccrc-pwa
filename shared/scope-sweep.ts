// D-7993, D-7994 (plan docs/superpowers/plans/2026-11-03-scope-sweep-busy-orphans.md). The wire half of the door over
// `ccd-scope-sweep`'s two switches: the view and its one reader over a registry listing. The sweep reads its markers
// itself, so nothing here decides what it does. L0: the PWA bundles `shared/`, so this file takes no `node:` module. It
// sits outside `shared/api.ts` for `stall-watch.ts`'s reason: other programmes append at that file's foot.
import type { MarkerState } from './api.js';
import { readSwitches, SCOPE_SWEEP_BUSY_LIVE_MARKER, SCOPE_SWEEP_LIVE_MARKER } from './switches.js';

/** What the registry says of the two switches (`GET /api/coord/scope-sweep`). `unmeasurable` is a registry that could
 *  not be listed, and is never read as off. */
export interface ScopeSweepView { readonly stop: MarkerState; readonly busy: MarkerState }

/** The view of one registry listing, through the switch table's one reader. */
export function scopeSweepViewOf(listing: readonly string[] | null): ScopeSweepView {
  const s = readSwitches(listing);
  return { stop: s[SCOPE_SWEEP_LIVE_MARKER], busy: s[SCOPE_SWEEP_BUSY_LIVE_MARKER] };
}

/** `POST /api/coord/scope-sweep`'s body: the busy arm's switch. `scope-sweep-live` has no writer here. */
export interface ScopeSweepBusyRequest { on: boolean }
