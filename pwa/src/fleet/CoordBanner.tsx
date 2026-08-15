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
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MarkerState } from '../../../shared/api';
import { COORD_CONFIRM_MS, MARKER_GLYPH, MARKER_WORD, markerState } from './coordWords';
import { ApiError, COORD_UNSUPPORTED_TEXT, api, apiErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

type Phase = 'idle' | 'pausing' | 'resuming' | 'unconfirmed';

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
function inlinePauseError(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 501) return COORD_UNSUPPORTED_TEXT;
  // Review, M1: this arm used to read `body.stderr` itself and fall back to
  // `apiErrorText(err)` — but `apiErrorText` is ALREADY stderr-first
  // (`lib/api.ts:149-160`, its own docstring: "prefer that"), so the extract-
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

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // The marker value that would CONFIRM the outstanding tap — 'set' for a
  // pause, 'clear' for a resume — or null when nothing is outstanding. A ref,
  // not state: it is read inside the timer callback and the coord-watching
  // effect below, never rendered itself.
  const wantedRef = useRef<MarkerState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Settles the outstanding tap the moment a `coord` frame reports the value
  // it asked for — and ONLY then. A frame that arrives but still disagrees
  // (the marker hasn't moved yet) changes nothing here; the timer below is
  // what eventually gives up on that case. Runs on every `coord` change,
  // including ones that land after `unconfirmed` has already been shown —
  // an operator staring at "unconfirmed" for a genuinely-late frame deserves
  // to see it resolve, not stay stale forever.
  useEffect(() => {
    // Review, M4: an inline refusal describes the tap that produced it, and a
    // NEW `coord` frame is a fresh measurement of the very thing that refusal
    // was about. Cleared only on the next tap, a 501 ("the fleet host needs
    // the newer ccd") sat under a banner that had since flipped to "paused"
    // off a real frame — two statements about one fleet that cannot both be
    // current. Cleared here, the refusal lives exactly as long as the reading
    // it belongs to. (Safe against the failure path itself: `coordPause`'s
    // rejection sets `error` in a microtask; this effect runs only when
    // `coord` actually changes identity, never merely because a tap failed.)
    setError(null);
    if (wantedRef.current !== null && coord?.pause === wantedRef.current) {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coord]);

  useEffect(() => () => clearTimer(), []);

  if (!coordFrameSeen || coord === null) return null;

  const pauseState = markerState(coord.pause);

  const onToggle = (): void => {
    setError(null);
    const wantPause = pauseState !== 'set';
    const wanted: MarkerState = wantPause ? 'set' : 'clear';
    wantedRef.current = wanted;
    setPhase(wantPause ? 'pausing' : 'resuming');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Only fires "unconfirmed" if THIS tap is still the outstanding one —
      // a later tap (or an already-landed confirmation) owns the phase now.
      if (wantedRef.current === wanted) setPhase('unconfirmed');
    }, COORD_CONFIRM_MS);

    coordPause(wantPause).catch((err: unknown) => {
      // The write itself failed — there is nothing left to wait for. Never
      // optimistic about failure either: drop back to idle immediately
      // rather than sitting in "pausing…" until a timeout that was never
      // going to resolve.
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
      const inline = inlinePauseError(err);
      if (inline !== null) { setError(inline); return; }
      toast(apiErrorText(err), 'error');
    });
  };

  const busy = phase === 'pausing' || phase === 'resuming';
  const toggleLabel =
    phase === 'pausing' ? 'pausing…'
    : phase === 'resuming' ? 'resuming…'
    : phase === 'unconfirmed' ? 'unconfirmed — check /runs'
    : pauseState === 'set' ? 'Resume' : 'Pause';

  return (
    <div className="coord-banner" role="status">
      <span className="coord-glyph" aria-hidden="true">{MARKER_GLYPH[pauseState]}</span>
      <span className="coord-word">{MARKER_WORD[pauseState]}</span>
      <button type="button" className="coord-toggle" disabled={busy} onClick={onToggle}>
        {toggleLabel}
      </button>
      {error !== null && <p className="coord-error">{error}</p>}
    </div>
  );
}
