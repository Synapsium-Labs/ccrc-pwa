// The pause banner and its toggle (spec §4.2, Task 11) — the coordination
// surface's own honesty check: whether a wave the operator is about to
// dispatch would actually run, or whether the fleet is paused (or the
// registry could not even be read, which `dispatchRun` treats the same way).
//
// FOUR states, only three of them on the wire. `coord === null` (no `coord`
// frame has arrived THIS store instance's lifetime — `coordFrameSeen`,
// `stores/fleet.ts`, the same sticky idiom `runsFrameSeen` already uses) is a
// fourth, CLIENT-SIDE state, and it renders as NOTHING — never as "not
// paused". An absent frame is not evidence of anything; rendering "not
// paused" for it would be a guess wearing the same typeface as a measurement.
//
// The toggle is NOT optimistic (spec §4.2, verbatim): a tap never flips the
// word/glyph above — those keep reading whatever the last confirmed `coord`
// frame said, unchanged, for as long as the tap is outstanding. The button's
// OWN label is the only thing that moves (`pausing…`/`resuming…`), and it
// settles only when a LATER `coord` frame actually reports the value the tap
// asked for — never merely "a frame arrived". `COORD_CONFIRM_MS` names why a
// timeout beats waiting forever: see coordWords.ts's own docstring.
import type { ReactNode } from 'react';
import { MARKER_GLYPH, MARKER_WORD, markerState } from './coordWords';
import { useMarkerToggle } from './useMarkerToggle';
import { ApiError, COORD_UNSUPPORTED_TEXT, api, apiErrorText } from '../lib/api';
import { Button, ControlRow, CONTROL_ROW_NOTE } from '@ccrc/ui';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';


/** The 501/502 refusals render INLINE, in the banner itself — spec §4.2's own
 *  words, held once in `COORD_UNSUPPORTED_TEXT` (`lib/api.ts`, review M2:
 *  this file and `AbandonSheet`'s `ABANDON_COPY.unsupported` used to spell the
 *  identical sentence as two separate literals). NOT `UNSUPPORTED_VERB_TEXT`
 *  — that constant is the *lifecycle routes'* sentence, a deliberately
 *  different third spelling argued for by name in its own docstring.
 *  `bad-request` (400) gets no bespoke string — the spec
 *  says so explicitly ("no `bad-request` path worth a distinct string beyond
 *  the generic toast") — so that one path, and anything that is not even an
 *  `ApiError`, falls through to the ordinary global toast every other write
 *  in this app already uses. */
export function inlinePauseError(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 501) return COORD_UNSUPPORTED_TEXT;
  // Review, M1: this arm used to read `body.stderr` itself and fall back to
  // `apiErrorText(err)` — but `apiErrorText` is ALREADY stderr-first
  // (`lib/api.ts:153-164`, its own docstring: "prefer that"), so the extract-
  // and-fallback was byte-equivalent to this one line and only looked like a
  // second policy. What makes a 502 render INLINE is the status; what it
  // SAYS is `apiErrorText`'s one decision, not a second copy of it.
  // (`AbandonSheet`'s own 502 arm is NOT this shape and stays as it is — its
  // fallback is `ABANDON_COPY['fleet-failed']`, a real second branch.)
  if (err.status === 502) return apiErrorText(err);
  return null;
}

export function CoordBanner({
  store = useFleetStore,
  coordPause = api.coordPause,
}: {
  store?: FleetStore;
  /** Injectable so a test can drive the toggle without a server — same shape
   *  `RunsScreen`'s own `loadRuns` prop uses. Defaults to `api.coordPause`. */
  coordPause?: (paused: boolean) => Promise<void>;
}): ReactNode {
  const coord = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);

  // The switch's whole behaviour — the tap, the settle, the bounded wait and
  // the failure arm — is `useMarkerToggle`'s, shared with the reclaim row.
  // `markerState` reads the frame BEFORE the early return below, because a
  // hook may not be called conditionally; an absent frame reads `unmeasurable`
  // and the row renders nothing anyway.
  const pauseState = markerState(coord?.pause);
  const pause = useMarkerToggle(coord === null ? null : pauseState, coordPause);

  if (!coordFrameSeen || coord === null) return null;

  return (
    <ControlRow className="coord-banner" role="status">
      <span className="coord-glyph" aria-hidden="true">{MARKER_GLYPH[pauseState]}</span>
      <span className="coord-word">{MARKER_WORD[pauseState]}</span>
      <Button variant="quiet" size="fit" className="coord-toggle flex-none"
              disabled={pause.busy} onClick={pause.toggle}>
        {pause.label({ set: 'Resume', clear: 'Pause' })}
      </Button>
      {pause.error !== null && (
        <p className={`coord-error ${CONTROL_ROW_NOTE}`}>{pause.error}</p>
      )}
    </ControlRow>
  );
}
