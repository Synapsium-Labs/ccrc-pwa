// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `/waiting`, the combined list, and
// `/waiting/<id>`, one item. They are the only readers of the fleet store and the router in this directory: the screens
// they render (`WaitingScreen`, `ItemView`) take everything as props. Ring L4: no decision is made here that the words
// or the server did not make (a tick's order and refusals are the server's, the labels are `ledgerWords.ts`'s).
//
// THE CLOCK IS READ FRESH ON EVERY RENDER, never ticked (the rollup's rule, `useRollupClock`): an age is the screen's own
// words, and the one label that depends on time, "ticked; coordinator not responding", is the server's `stale`, which it
// re-sends in the `waiting` frame when it changes. A quiet page sets no timer.
// The fleet's rows and runs count only once their frames have landed: before that they are the offline snapshot's, which
// is not a fact this page has heard (the Waiting on you badge reads them the same way).
import type { ReactNode } from 'react';
import { BackButton } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { fleetHues } from '../fleet/programmeBoxes';
import { isRunClosed, programmeTitle } from '../fleet/runWords';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { itemPath, sessionPath } from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { ItemView } from './ItemView';
import { WaitingScreen } from './WaitingScreen';
import { refetchWaiting } from './waitingStore';
import './ledgers.css';

const NO_SESSIONS: readonly FleetSession[] = [];
const NO_RUNS: readonly RunSummary[] = [];
const WAITING_PATH = '/waiting';

/** The rows and runs this page has heard, or none: see the file's header. */
function useHeard(store: FleetStore): { sessions: readonly FleetSession[]; runs: readonly RunSummary[]; runsHeard: boolean } {
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const runs = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  return { sessions: fleetFrameSeen ? sessions : NO_SESSIONS, runs: runsFrameSeen ? runs : NO_RUNS, runsHeard: runsFrameSeen };
}

/** `/waiting`. */
export function WaitingRoute({ store = useFleetStore }: { store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  return (
    <WaitingScreen view={view} sessions={sessions} runs={runs} now={Date.now()}
                   onOpenItem={(id) => navigate(itemPath(id))} onOpenSession={(id) => navigate(sessionPath(id))} />
  );
}

/** `/waiting/<id>`: an item of the list, or of the recently cleared, found by its id. */
export function ItemRoute({ id, store = useFleetStore }: { id: number; store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { runs, runsHeard } = useHeard(store);
  const back = (
    <BackButton className="wl-back" aria-label="Back to Waiting on you" onClick={() => navigate(WAITING_PATH)}>‹</BackButton>
  );
  if (view === null) {
    return <div className="wl">{back}<p className="wl-note" role="status">Waiting for the first update from the server…</p></div>;
  }
  const item = view.items.find((i) => i.id === id) ?? view.cleared.find((i) => i.id === id) ?? null;
  if (item === null) {
    return <div className="wl">{back}<p className="wl-note">That item is not on the list any more.</p></div>;
  }
  // Until the runs frame lands the programme's runs are unknown, and an unknown run is treated as open: Dismiss is
  // refused `programme-live` while one is, so it is not offered on a guess.
  const programmeLive = !runsHeard || runs.some((r) => r.program === item.program && !isRunClosed(r));
  return (
    <div className="wl-route">
      {back}
      <ItemView item={item} now={Date.now()} programmeLive={programmeLive}
                programme={{ name: programmeTitle(item.program, runs), hue: fleetHues(runs).get(item.program) ?? null }}
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
