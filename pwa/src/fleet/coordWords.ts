// The pause banner's own small vocabulary — the parallel `Record<MarkerState,
// …>` tables spec §4.2 asks for. Two cues, word and glyph, so no state is read
// out of colour alone (RUN_WORD/RUN_GLYPH's own discipline, `runWords.ts`).
//
// PAUSE-ONLY, despite the `MarkerState` typing: `CoordStatus` carries TWO
// markers (`pause` and `mail`, `shared/api.ts`), and `MarkerState` types both
// — but only `coord.pause` is ever rendered anywhere in Build 4 (`CoordBanner`
// is the one reader). The words below ("paused", "not paused") are written
// for that one marker specifically, not as a marker-generic vocabulary. A
// future surface reading `coord.mail` through these same tables would get
// wording that reads wrong for it (`unmeasurable`'s sentence names
// "dispatch", which is a `pause`-specific consequence) — it would need its
// own table, not a widened reuse of this one.
//
// `unmeasurable`'s WORD is not a euphemism or a bare label: `dispatchRun`
// treats an unlistable registry as a pause it cannot rule out and FAILS SHUT
// (`server/src/coord/dispatch.ts`), so the phone has to say exactly what that
// means for a program the operator might otherwise expect to dispatch — not
// "unknown", and never a blank cell.
import {
  isMarkerState, lifecycleIsDead, substrateFault, type FleetSession, type MarkerState,
} from '../../../shared/api';

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

/** The client's answer to "is the run's coordinator there?" — program-leverage
 *  wave 5, D-1129. */
export type CoordPresence = 'alive' | 'dead' | 'unknown';

/** THREE answers, because the client cannot measure what the server measures.
 *
 *  `assembleFleet` (`server/src/fleet.ts`, D-309) collapses a tmux `unknown`
 *  into `alive = false`, and says so: "a substrate fault reads 'dead' in the
 *  PWA — a false dead". So `status === 'dead'` is not proof of a dead
 *  coordinator, and a door hung on it alone would offer, during a tmux outage,
 *  to hand a live coordinator's program to somebody else. A session MISSING
 *  from the fleet array is weaker still — that is indistinguishable from a
 *  frame that has not landed, which is why `frameSeen` is a parameter rather
 *  than a length check (D-1138).
 *
 *  `unknown` HIDES the door. That is the whole asymmetry: a hidden door costs
 *  the operator one refresh; a door offered over a live coordinator costs a
 *  running program its ledger.
 *
 *  NOT a fourth condition on `statusUnmeasured`: that flag is only ever set
 *  inside `assembleFleet`'s own `if (alive)` block, so a `dead` row
 *  structurally cannot carry it — reading it here would be a guard over a
 *  state this field cannot be in.
 *
 *  Clock-free and store-free, the ladder discipline `lifecycleQualifier`
 *  (`lifecycleWords.ts`) already states: every input is an argument. */
export function coordPresence(
  claimedBy: string | null,
  session: FleetSession | null | undefined,
  frameSeen: boolean,
): CoordPresence {
  if (claimedBy === null) return 'unknown';
  if (!frameSeen) return 'unknown';
  if (session === null || session === undefined) return 'unknown';
  // `?? null`, never the typed field directly — the `fleet` frame is CAST on
  // arrival (`stores/fleet.ts`'s `asFleetMsg` validates only
  // `Array.isArray(sessions)`), so a row from a server that predates this
  // field lacks the key at runtime. `lifecycleQualifier`'s own docstring
  // records what reading one of these directly cost the last time.
  const lifecycle = session.lifecycle ?? null;
  if (lifecycle === null || lifecycle === 'unmeasurable') return 'unknown';
  // The ONE reader for this field (`substrateFault`'s own docstring,
  // `shared/api.ts`): a supervisor that has flagged the substrate has
  // withdrawn its own claim to know anything about this pane.
  if (substrateFault(session) !== null) return 'unknown';
  // BOTH halves. `lifecycleIsDead` is the tree's one answer to "does this
  // state resolve on its own" — `restarting` does, `orphan` does not — and it
  // deliberately answers FALSE for `unmeasurable` ("doubt is not evidence",
  // LIFECYCLE_DEAD's own comment).
  if (session.status === 'dead' && lifecycleIsDead(lifecycle)) return 'dead';
  return 'alive';
}
