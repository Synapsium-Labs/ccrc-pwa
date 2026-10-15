// The reclaim row on /runs (child-reclamation spec §5.8, §5.9): the switch on
// AUTOMATIC reclamation of child workspaces, and the one fleet-level attention
// list — the children a terminal refusal left standing, those whose reclaim
// has kept failing past the defer ceiling, and those the sweep keeps for a
// person to remove, each with the server's sentence.
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
// PWA renders them and maps no token. A collapsed line names its children after
// the server's sentence; the PWA counts nothing itself. The two item shapes are
// told apart by `sessionId`, the field the reader checks: every single item has
// one, and a collapsed line is rebuilt by the reader with none.
import type { ReactNode } from 'react';
import {
  CHILD_RECLAIM_MARKER_GLYPH, CHILD_RECLAIM_MARKER_WORD, childReclaimAttentionOf, childReclaimMarker,
} from './childReclaimWords';
import { useMarkerToggle } from './useMarkerToggle';
import { AttentionList } from './AttentionList';
import { ExpiryAttention } from './ExpiryAttention';
import { DeadCoordinatorAttention } from './DeadCoordinatorAttention';
import { api } from '../lib/api';
import { Button, ControlRow, CONTROL_ROW_NOTE } from '@ccrc/ui';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';


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
  const marker = childReclaimMarker(coord);
  // The switch's whole behaviour is `useMarkerToggle`'s, shared with the pause
  // banner — which is what this file's header asked for in prose ("CoordBanner's
  // shape, deliberately") and now gets as one implementation.
  const pause = useMarkerToggle(marker, (set) => childReclaimPause(set ? 'on' : 'off'));

  if (!coordFrameSeen || coord === null || marker === null) return null;
  const attention = childReclaimAttentionOf(coord);

  return (
    <ControlRow className="child-reclaim-banner">
      {/* `role="status"` covers the switch readout
          ALONE (glyph, word, toggle, error) — never the attention list below,
          whose own changes must not re-announce every standing child's
          sentence through this live region. */}
      <div className="child-reclaim-status" role="status">
        <span className="child-reclaim-glyph" aria-hidden="true">{CHILD_RECLAIM_MARKER_GLYPH[marker]}</span>
        <span className="child-reclaim-word">{CHILD_RECLAIM_MARKER_WORD[marker]}</span>
        <Button variant="quiet" size="fit" className="child-reclaim-toggle flex-none"
                disabled={pause.busy} onClick={pause.toggle}>
          {pause.label({ set: 'Resume cleanup', clear: 'Pause cleanup' })}
        </Button>
        {pause.error !== null && (
          <p className={`child-reclaim-error ${CONTROL_ROW_NOTE}`}>{pause.error}</p>
        )}
      </div>
      <AttentionList
        label="children reclamation could not clean up"
        lines={attention.map((a) => (!('sessionId' in a)
          ? {
            key: `kept-many ${a.word}`,
            who: a.members.map((m) => `run #${m.runId} · ${m.sessionId}`),
            sentence: a.sentence,
            sentenceFirst: true,
          }
          : {
            key: a.sessionId,
            who: [a.runId === null ? a.sessionId : `run #${a.runId} · ${a.sessionId}`],
            sentence: a.sentence,
          }))}
      />
      {/* Workspace lifecycle wave 3b: the expiry lane's own list, under the children's — the same switch stops both
          lanes, and the two lists stay two (child reclamation's run chip never reads this one). */}
      <ExpiryAttention coord={coord} />
      {/* Workspace lifecycle wave 4: the dead-coordinator lane's own list, under the expiry lane's — the same switch stops
          all three lanes, and each list stays its own. */}
      <DeadCoordinatorAttention coord={coord} />
    </ControlRow>
  );
}
