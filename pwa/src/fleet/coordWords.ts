// The pause banner's own small vocabulary — the parallel `Record<MarkerState,
// …>` tables spec §4.2 asks for. Two cues, word and glyph, so no state is read
// out of colour alone (RUN_WORD/RUN_GLYPH's own discipline, `runWords.ts`).
//
// `unmeasurable`'s WORD is not a euphemism or a bare label: `dispatchRun`
// treats an unlistable registry as a pause it cannot rule out and FAILS SHUT
// (`server/src/coord/dispatch.ts`), so the phone has to say exactly what that
// means for a program the operator might otherwise expect to dispatch — not
// "unknown", and never a blank cell.
import { isMarkerState, type MarkerState } from '../../../shared/api';

export const MARKER_WORD: Record<MarkerState, string> = {
  clear: 'not paused',
  set: 'paused',
  unmeasurable: 'the registry could not be read — dispatch would refuse',
};

export const MARKER_GLYPH: Record<MarkerState, string> = {
  clear: '·',
  set: '⏸',
  unmeasurable: '?',
};

/** The total door into `MARKER_WORD`/`MARKER_GLYPH` — `runState`'s own idiom
 *  (`runWords.ts`) applied to the wire's other shape-tolerant frame: `coord`
 *  is shape-validated only at the FRAME level (`asFleetMsg`'s bare
 *  `typeof … === 'object'` check), so `coord.pause`/`coord.mail` reach this
 *  renderer as a raw string wearing the `MarkerState` type — a member a newer
 *  server minted that this build has never heard of is real traffic, not a
 *  test fixture. Degrades to `unmeasurable`, never `clear`: "not known to be a
 *  state we understand" is exactly the same fail-shut posture `dispatchRun`
 *  itself takes on an unlistable registry — not knowing is not `clear`. */
export const markerState = (v: unknown): MarkerState => (isMarkerState(v) ? v : 'unmeasurable');

/** How long the toggle waits for the NEXT `coord` frame to confirm the tap
 *  before giving up and rendering `unconfirmed — check /runs`. Tied to the
 *  fleet poll's own 2 s tick (`server/src/watch.ts`'s `intervalMs`) plus a
 *  generous margin — room for a handful of missed ticks, a slow box, one
 *  retry — not a timeout chasing the happy path.
 *
 *  A silent flip would be worse than an honest "unconfirmed": the operator
 *  would believe a pause took effect that the server never actually
 *  confirmed, and could dispatch a wave into a fleet that was never actually
 *  paused. "We don't know yet" is a state this banner can render truthfully;
 *  a guessed state is not. */
export const COORD_CONFIRM_MS = 15_000;
