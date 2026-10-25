// ARCH-77 (#812): the READER of `child-reclaim-disabled`, landed ahead of ARCH-44 by operator need. The switch stops
// child reclaim and nothing else: the sweep and the close hand-off queue no reclaim, and the executor refuses to act
// while it stands. `reclaim-paused` (also read beside this) is the wider switch; expiry, collect, the dead-coordinator
// lane and stop-done never read this one.
import type { FleetIO } from '../io.js';
import type { NotifyLog } from '../notifylog.js';
import type { CoordStore } from './store.js';
import { changeLatch, type ChangeLatch } from '../changeLatch.js';
import { notify } from '../notice.js';
import { CHILD_RECLAIM_DISABLED_MARKER, readSwitches } from '../../../shared/switches.js';
import type { MarkerState } from '../../../shared/api.js';

/** One registry listing's answer for this switch, through `readSwitches` like `childReclaimPauseRead`. A rejecting
 *  `readdir` propagates: each caller's try keeps its own sentence. */
export async function childReclaimDisabledRead(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<MarkerState> {
  return childReclaimDisabledOf(await io.readdir(registryDir));
}

/** The switch off a listing the caller already holds (the sweep's tick). */
export function childReclaimDisabledOf(names: readonly string[] | null): MarkerState {
  return readSwitches(names)[CHILD_RECLAIM_DISABLED_MARKER];
}

/** The executor's deferral detail; `when` is '' or ' at the act'. */
export const childReclaimDisabledSentence = (when: string): string =>
  `${CHILD_RECLAIM_DISABLED_MARKER} is set${when}: child reclaim is switched off`;

/** The executor's deferral detail when the listing did not measure (or threw): like `reclaim-paused`, a registry
 *  that did not list cannot rule the switch out. */
export const CHILD_RECLAIM_DISABLED_UNREAD_SENTENCE =
  `the registry did not list, so a set ${CHILD_RECLAIM_DISABLED_MARKER} cannot be ruled out`;

export const CHILD_RECLAIM_DISABLED_FEED_TITLE = 'child reclaim switched off';
export const CHILD_RECLAIM_DISABLED_FEED_BODY = `${CHILD_RECLAIM_DISABLED_MARKER} is set: no child workspace is reclaimed, `
  + 'by the sweep or at close, until it is removed. Expiry, collect and the dead-coordinator lane keep running.';

/** One latch per coordination store, so the sweep and the close hand-off speak once between them. */
const latches = new WeakMap<object, ChangeLatch<MarkerState>>();

/** Says so on the feed once per standing (`changeLatch`), re-armed when the switch reads anything but set. Returns
 *  whether child reclaim is stopped. A listing that did not measure neither says nor re-arms, and stops nothing here
 *  (`reclaim-paused`'s own read already refuses on an unlisted registry). */
export function childReclaimDisabledStops(deps: { coord?: CoordStore; notifyLog?: NotifyLog }, state: MarkerState): boolean {
  if (state === 'unmeasurable') return false;
  const key = deps.coord ?? deps;
  let latch = latches.get(key);
  if (latch === undefined) { latch = changeLatch<MarkerState>(); latches.set(key, latch); }
  if (state !== 'set') { latch.clear(); return false; }
  if (latch.changed(state)) {
    notify({ notifyLog: deps.notifyLog, coord: deps.coord },
      { kind: 'coord', sessionId: '', runId: null, title: CHILD_RECLAIM_DISABLED_FEED_TITLE, body: CHILD_RECLAIM_DISABLED_FEED_BODY },
      'record-only', { degraded: 'child reclaim switch, feed archive degraded' });
  }
  return true;
}

/** The close hand-off's gate: runs `queue` unless the switch is set. A read that fails queues (the executor re-reads). */
export async function childReclaimUnlessDisabled(
  deps: { io: Pick<FleetIO, 'readdir'>; registryDir: string; coord?: CoordStore; notifyLog?: NotifyLog }, queue: () => Promise<unknown>,
): Promise<void> {
  let state: MarkerState = 'unmeasurable';
  try { state = await childReclaimDisabledRead(deps.io, deps.registryDir); } catch { /* the executor re-reads at the act */ }
  if (childReclaimDisabledStops(deps, state)) return;
  await queue();
}
