// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `/waiting`, the combined list, and
// `/waiting/<id>`, one item. They are the only readers of the fleet store and the router in this directory: the screens
// they render (`WaitingScreen`, `ItemView`) take everything as props. Ring L4: no decision is made here that the words
// or the server did not make (a tick's order and refusals are the server's, the labels are `ledgerWords.ts`'s).
//
// THE CLOCK IS READ FRESH ON EVERY RENDER, never ticked (the rollup's rule, `useRollupClock`): an age is the screen's own
// words, and the one label that depends on time, "ticked; coordinator not responding", is the server's `stale`, which it
// re-sends in the `waiting` frame when it changes. A quiet page sets no timer.
// The fleet's rows and runs count only once their frames have landed: before that they are the offline snapshot's, which
// is not a fact this page has heard, so the screens are handed `null` and say they are waiting (the Waiting on you badge
// reads them the same way).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BackButton } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle } from '../fleet/runWords';
import { api } from '../lib/api';
import { LEDGER_REFUSAL_TEXT } from '../lib/refusalWords';
import { navigate } from '../lib/router';
import { ROUTES, sessionPath } from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { ItemView } from './ItemView';
import { NO_FRAME_WORD, programmeIsLive } from './ledgerWords';
import { WaitingScreen } from './WaitingScreen';
import { refetchWaiting } from './waitingStore';
import './ledgers.css';

/** The list's path, read off the `waiting` row of the route table: this file spells no path of its own. */
const WAITING_PATH: string = ROUTES.find((r) => r.id === 'waiting')?.path ?? '/';

/** The one builder of an item's path, `/waiting/<id>`, which the `item` row of the route table parses. */
export const itemPath = (id: number): string => `${WAITING_PATH}/${id}`;

/** The rows and runs this page has heard, or `null` for each it has not: see the file's header. */
function useHeard(store: FleetStore): { sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null } {
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const runs = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  return { sessions: fleetFrameSeen ? sessions : null, runs: runsFrameSeen ? runs : null };
}

/** With no list yet, ask for it once on arrival, and say so when this box has none to give: a box with no coordination
 *  database sends no `waiting` frame and answers the read `not-configured`, so waiting for a first update would be for
 *  good. Any other failure (offline, refused) changes nothing: the page keeps waiting, and a focus asks again. */
function useUnavailable(store: FleetStore, listed: boolean): string | null {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  useEffect(() => {
    if (listed) return undefined;
    let live = true;
    void refetchWaiting(store, api.waiting, true).then((read) => {
      if (live && read === 'not-configured') setUnavailable(LEDGER_REFUSAL_TEXT['not-configured']);
    });
    return () => { live = false; };
  }, [store, listed]);
  return unavailable;
}

/** `/waiting`. */
export function WaitingRoute({ store = useFleetStore }: { store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  return (
    <WaitingScreen view={view} sessions={sessions} runs={runs} now={Date.now()} unavailable={unavailable}
                   onOpenItem={(id) => navigate(itemPath(id))} onOpenSession={(id) => navigate(sessionPath(id))} />
  );
}

/** `/waiting/<id>`'s arm of the ladder: the id is digits by the route's pattern, and one past the safe integers names no
 *  item. Keyed by the id so a typed answer never leaks from one item's panel to the next. */
export function ItemRouteAt({ param, store = useFleetStore }: { param: string | null; store?: FleetStore }): ReactNode {
  const id = Number(param);
  return param !== null && Number.isSafeInteger(id) ? <ItemRoute key={id} id={id} store={store} /> : <ItemGone />;
}

function Back(): ReactNode {
  return <BackButton className="wl-back" aria-label="Back to Waiting on you" onClick={() => navigate(WAITING_PATH)}>‹</BackButton>;
}

function ItemGone(): ReactNode {
  return <div className="wl"><Back /><p className="wl-note">That item is not on the list any more.</p></div>;
}

/** `/waiting/<id>`: an item of the list, or of the recently cleared, found by its id. */
export function ItemRoute({ id, store = useFleetStore }: { id: number; store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  if (view === null) {
    return (
      <div className="wl"><Back />
        {unavailable !== null
          ? <p className="wl-note" role="alert">{unavailable}</p>
          : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>}
      </div>
    );
  }
  const item = view.items.find((i) => i.id === id) ?? view.cleared.find((i) => i.id === id) ?? null;
  if (item === null) return <ItemGone />;
  return (
    <div className="wl-route">
      <Back />
      <ItemView item={item} now={Date.now()} programmeLive={programmeIsLive(item.program, runs)}
                programme={{ name: programmeTitle(item.program, runs ?? []), hue: fleetHues(runs ?? []).get(item.program) ?? null }}
                onTick={async (answer) => {
                  await (answer === undefined ? api.tickItem(item.id) : api.tickItem(item.id, answer));
                  await refetchWaiting(store);
                }}
                onDismiss={async () => {
                  await api.dismissItem(item.id);
                  await refetchWaiting(store);
                  navigate(WAITING_PATH);
                }} />
    </div>
  );
}
