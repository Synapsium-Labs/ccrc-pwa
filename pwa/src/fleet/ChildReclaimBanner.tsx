// The reclaim row on /runs (child-reclamation spec §5.8, §5.9): the switch on
// AUTOMATIC reclamation of child workspaces, and the one fleet-level attention
// list — the children a terminal refusal left standing, and those whose reclaim
// has kept failing past the defer ceiling, each with the server's sentence.
// `CoordBanner`'s shape, deliberately, because an operator reading two
// switches in one place must not have to learn two behaviours:
//
//   • NOTHING renders until a `coord` frame has arrived (`coordFrameSeen`), and
//     nothing renders for a frame from a server that predates the field
//     (`childReclaimMarker` → null). An absent reading is not "running".
//   • The toggle is NOT optimistic: a tap moves only the button's own label, and
//     it settles only when a LATER frame reports the value the tap asked for;
//     `COORD_CONFIRM_MS` bounds the wait with an honest "unconfirmed".
//   • A 501 or 502 renders inline (`inlinePauseError`, shared with the pause
//     banner); anything else goes to the ordinary toast.
//
// The attention list is a REPORT, not a tap: no button, no link, no remedy
// offered. Rule 4 says the human does not tend sub-workspaces; this tells them
// what is costing disk, and asks nothing. The sentences are the SERVER's — the
// PWA renders them and maps no token.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MarkerState } from '../../../shared/api';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  CHILD_RECLAIM_MARKER_GLYPH, CHILD_RECLAIM_MARKER_WORD, childReclaimAttentionOf, childReclaimMarker,
} from './childReclaimWords';
import { inlinePauseError } from './CoordBanner';
import { api, apiErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

type Phase = 'idle' | 'pausing' | 'resuming' | 'unconfirmed';

export function ChildReclaimBanner({
  store = useFleetStore,
  childReclaimPause = api.childReclaimPause,
}: {
  store?: FleetStore;
  /** Injectable so a test drives the toggle without a server — `CoordBanner`'s
   *  `coordPause` seam. Defaults to `api.childReclaimPause`. */
  childReclaimPause?: (state: 'on' | 'off') => Promise<void>;
}): ReactNode {
  const coord = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const wantedRef = useRef<MarkerState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marker = childReclaimMarker(coord);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // A NEW value for THIS row's own marker is a fresh measurement: it retires
  // an inline refusal about the old one (the same guarantee CoordBanner's
  // own settle effect keeps), and it settles the outstanding tap ONLY when
  // it reports the value the tap asked for.
  //
  // Keyed on `marker`, not on `coord` itself: one frame now carries
  // both rows' facts — `pause`/`mail` for the sibling banner, `reclaim`/
  // `childReclaimAttention` for this one. Keying on the whole `coord` object
  // meant a `pause` flip, or merely a fresh 60s sweep tick changing nothing
  // this row renders but the attention list, gave `coord` a new identity and
  // cleared THIS row's refusal though `reclaim` itself never moved — a
  // refusal disappearing while nothing it was about changed. Keying on
  // `marker` (`childReclaimMarker(coord)`, already computed above from this
  // same `coord`) keeps that same guarantee: this effect now runs only when
  // the RECLAIM switch's own reading changes.
  useEffect(() => {
    setError(null);
    if (wantedRef.current !== null && marker === wantedRef.current) {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  useEffect(() => () => clearTimer(), []);

  if (!coordFrameSeen || coord === null || marker === null) return null;
  const attention = childReclaimAttentionOf(coord);

  const onToggle = (): void => {
    setError(null);
    const wantPause = marker !== 'set';
    const wanted: MarkerState = wantPause ? 'set' : 'clear';
    wantedRef.current = wanted;
    setPhase(wantPause ? 'pausing' : 'resuming');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (wantedRef.current === wanted) setPhase('unconfirmed');
    }, COORD_CONFIRM_MS);
    childReclaimPause(wantPause ? 'on' : 'off').catch((err: unknown) => {
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
    : marker === 'set' ? 'Resume reclaim' : 'Pause reclaim';

  return (
    <div className="child-reclaim-banner">
      {/* `role="status"` covers the switch readout
          ALONE (glyph, word, toggle, error) — never the attention list below,
          whose own changes must not re-announce every standing child's
          sentence through this live region. */}
      <div className="child-reclaim-status" role="status">
        <span className="child-reclaim-glyph" aria-hidden="true">{CHILD_RECLAIM_MARKER_GLYPH[marker]}</span>
        <span className="child-reclaim-word">{CHILD_RECLAIM_MARKER_WORD[marker]}</span>
        <button type="button" className="child-reclaim-toggle" disabled={busy} onClick={onToggle}>
          {toggleLabel}
        </button>
        {error !== null && <p className="child-reclaim-error">{error}</p>}
      </div>
      {attention.length > 0 && (
        <ul className="child-reclaim-attention" aria-label="children reclamation could not clean up">
          {attention.map((a) => (
            <li key={a.sessionId} className="child-reclaim-item">
              <span className="child-reclaim-who">
                {a.runId === null ? a.sessionId : `run #${a.runId} · ${a.sessionId}`}
              </span>
              <span className="child-reclaim-sentence">{a.sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
