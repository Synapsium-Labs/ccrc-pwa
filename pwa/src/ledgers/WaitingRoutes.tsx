// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `/waiting`, the combined list, and
// `/waiting/<id>`, one item. The screens they render (`WaitingScreen`, `ItemView`) take everything as props. The programme
// view (`ProgrammeScreen`, PL5b) reads the store and the router itself, as a screen of its own, through the hooks and the
// back button this file exports (`useHeard`, `useUnavailable`, `Back`). Ring L4: no decision is made here that the words
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
import { BackButton, Button, useMediaQuery } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle } from '../fleet/runWords';
import { api } from '../lib/api';
import { LEDGER_REFUSAL_TEXT } from '../lib/refusalWords';
import { navigate, useLocation } from '../lib/router';
import { ROUTES, programmePath, sessionPath } from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { ItemView } from './ItemView';
import {
  COMBINED_LIST, NO_FRAME_WORD, fromWord, groupByProgramme, itemPlace, listGroups, listOfFromWord, placeWords, programmeIsLive,
  questionRows, type ItemList, type ItemPlace, type ProgrammeGroup,
} from './ledgerWords';
import { ListGroup, WaitingScreen } from './WaitingScreen';
import { refetchWaiting } from './waitingStore';
import './ledgers.css';

/** The list's path, read off the `waiting` row of the route table: this file spells no path of its own. */
const WAITING_PATH: string = ROUTES.find((r) => r.id === 'waiting')?.path ?? '/';

/** The item path's query naming the list it was opened from (plan PL9), and the combined list's query naming its side
 *  rail's filter: both ride the URL, so a reload or a shared link keeps them. */
export const FROM_QUERY = 'from';
export const PROGRAMME_FILTER_QUERY = 'programme';

/** The one builder of an item's path, `/waiting/<id>`, which the `item` row of the route table parses, with `?from=` naming the
 *  list it is opened from (plan PL9). The combined list, unfiltered, is the default and writes no query. */
export const itemPath = (id: number, list: ItemList = COMBINED_LIST): string =>
  `${WAITING_PATH}/${id}${list.at === 'waiting' && list.programme === null ? '' : `?${new URLSearchParams({ [FROM_QUERY]: fromWord(list) })}`}`;

/** The one builder of a list's own path: the combined list, with its side rail's filter as a query, or a programme's view. */
export const listPath = (list: ItemList): string =>
  list.at === 'programme' ? programmePath(list.programme)
    : list.programme === null ? WAITING_PATH : `${WAITING_PATH}?${new URLSearchParams({ [PROGRAMME_FILTER_QUERY]: list.programme })}`;

/** The rows and runs this page has heard, or `null` for each it has not: see the file's header. */
export function useHeard(store: FleetStore): { sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null } {
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const runs = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  return { sessions: fleetFrameSeen ? sessions : null, runs: runsFrameSeen ? runs : null };
}

/** With no list yet, ask for it once on arrival, and say so when this box has none to give: a box with no coordination
 *  database sends no `waiting` frame and answers the read `not-configured`, so waiting for a first update would be for
 *  good. Any other failure (offline, refused) changes nothing: the page keeps waiting, and a focus asks again. */
export function useUnavailable(store: FleetStore, listed: boolean): string | null {
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

/** `/waiting`, with the side rail's filter read from and written to its URL (`?programme=`), so the way back from an item
 *  opened under the filter lands on the filtered list (plan PL9). */
export function WaitingRoute({ store = useFleetStore }: { store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  const { search } = useLocation();
  const programme = new URLSearchParams(search).get(PROGRAMME_FILTER_QUERY);
  return (
    <WaitingScreen view={view} sessions={sessions} runs={runs} now={Date.now()} unavailable={unavailable} programme={programme}
                   onFilter={(slug) => navigate(listPath({ at: 'waiting', programme: slug }), { replace: true })}
                   onOpenItem={(id, list) => navigate(itemPath(id, list))} onOpenSession={(id) => navigate(sessionPath(id))} />
  );
}

/** `/waiting/<id>`'s arm of the ladder: the id is digits by the route's pattern, and one past the safe integers names no
 *  item. Keyed by the id so a typed answer never leaks from one item's panel to the next. */
export function ItemRouteAt({ param, store = useFleetStore }: { param: string | null; store?: FleetStore }): ReactNode {
  const id = Number(param);
  const list = useOpenedFrom();
  return param !== null && Number.isSafeInteger(id) ? <ItemRoute key={id} id={id} store={store} /> : <ItemGone list={list} />;
}

/** The programme view's way back to the fleet. On a desk the shell hides it (`.shell-detail .back-btn`): the fleet beside the
 *  pane is the way back there. */
export function Back({ to, label }: { to: string; label: string }): ReactNode {
  return <BackButton className="wl-back" aria-label={label} onClick={() => navigate(to)}>‹</BackButton>;
}

/** The list an item's page names in its URL (`?from=`), or the combined list. */
function useOpenedFrom(): ItemList {
  const { search } = useLocation();
  return listOfFromWord(new URLSearchParams(search).get(FROM_QUERY));
}

/** The item's way back to the list it was opened from, AT EVERY WIDTH (plan PL9; spec §2, D23): labelled with that
 *  list's name, and not the shell's back chevron, which a desk hides because the fleet beside the pane is the way out of a
 *  screen; the fleet is not the way back to this list. */
function ListBack({ list, runs }: { list: ItemList; runs: readonly RunSummary[] | null }): ReactNode {
  const name = list.at === 'programme' ? programmeTitle(list.programme, runs ?? []) : 'Waiting on you';
  return (
    <Button variant="ghost" size="fit" className="wi-back" aria-label={`Back to ${name}`} onClick={() => navigate(listPath(list))}>
      <span aria-hidden="true">‹</span><span className="wi-back-name">{name}</span>
    </Button>
  );
}

/** The strip above an item: the way back, and the steps to the previous and next item of the list it was opened from with its
 *  position. An item that list does not hold (recently cleared) has the way back alone. The first item's Previous and the last
 *  item's Next are drawn disabled, so the strip keeps its shape as the operator steps along it. */
function ItemNav({ list, place, runs }: { list: ItemList; place: ItemPlace | null; runs: readonly RunSummary[] | null }): ReactNode {
  const step = (id: number | null): void => { if (id !== null && place !== null) navigate(itemPath(id, place.list)); };
  return (
    <nav className="wi-nav" aria-label="Between items">
      <ListBack list={place?.list ?? list} runs={runs} />
      {place !== null && (
        <span className="wi-steps-nav">
          <span className="wi-pos">{placeWords(place)}</span>
          <Button variant="ghost" size="fit" className="wi-step" aria-label="Previous item" disabled={place.prev === null}
                  onClick={() => step(place.prev)}><span aria-hidden="true">‹</span>Previous</Button>
          <Button variant="ghost" size="fit" className="wi-step" aria-label="Next item" disabled={place.next === null}
                  onClick={() => step(place.next)}>Next<span aria-hidden="true">›</span></Button>
        </span>
      )}
    </nav>
  );
}

/** The width from which the list an item was opened from stays beside it (plan PL9; spec §2, D23): the shell's own
 *  list column (`--shell-list-col`, shell.css) beside the item, which still has room for its card. Below it the item is alone
 *  with its way back and its steps. Mounted by the query, as the frame mounts its width-gated parts, never hidden by CSS. */
export const BESIDE_QUERY = '(min-width: 1280px)';

/** The list beside an open item: the groups the list it was opened from draws (`listGroups`, the same groups its steps read),
 *  each as the list draws it, with the open item marked current. A row opens its item in the same list. */
function ListBeside({ list, groups, currentId, runs, now }: {
  list: ItemList; groups: readonly ProgrammeGroup[]; currentId: number; runs: readonly RunSummary[] | null; now: number;
}): ReactNode {
  const hues = fleetHues(runs ?? []);
  return (
    <aside className="wl wl-beside" aria-label="The list beside this item">
      {listGroups(list, groups).map((g) => (
        <ListGroup key={g.program ?? ''} group={g} runs={runs} now={now} currentId={currentId}
                   hue={g.program === null ? null : hues.get(g.program) ?? null}
                   onOpenItem={(id) => navigate(itemPath(id, list))} onOpenSession={(id) => navigate(sessionPath(id))} />
      ))}
    </aside>
  );
}

function ItemGone({ list }: { list: ItemList }): ReactNode {
  return (
    <div className="wl">
      <ItemNav list={list} place={null} runs={null} />
      <p className="wl-note">That item is not on the list any more.</p>
    </div>
  );
}

/** `/waiting/<id>`: an item of the list, or of the recently cleared, found by its id. */
export function ItemRoute({ id, store = useFleetStore }: { id: number; store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  const list = useOpenedFrom();
  const wide = useMediaQuery(BESIDE_QUERY);
  if (view === null) {
    return (
      <div className="wl"><ItemNav list={list} place={null} runs={runs} />
        {unavailable !== null
          ? <p className="wl-note" role="alert">{unavailable}</p>
          : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>}
      </div>
    );
  }
  const item = view.items.find((i) => i.id === id) ?? view.cleared.find((i) => i.id === id) ?? null;
  if (item === null) return <ItemGone list={list} />;
  // The list's own groups, from the one grouping every list draws (`groupByProgramme`), so the steps follow the drawn order.
  const groups = groupByProgramme(view.items, questionRows(sessions ?? [], runs ?? []));
  const place = itemPlace(id, list, groups);
  // Beside the item only when it has a place in a list: a recently cleared item has no list to stay beside.
  const beside = wide && place !== null;
  return (
    <div className="wl-route" data-beside={beside ? 'list' : 'none'}>
      {beside && <ListBeside list={place.list} groups={groups} currentId={id} runs={runs} now={Date.now()} />}
      <div className="wl-route-item">
        <ItemNav list={list} place={place} runs={runs} />
        <ItemView item={item} now={Date.now()} programmeLive={programmeIsLive(item.program, runs)}
                  programme={{ name: programmeTitle(item.program, runs ?? []), hue: fleetHues(runs ?? []).get(item.program) ?? null }}
                  onTick={async (answer) => {
                    await (answer === undefined ? api.tickItem(item.id) : api.tickItem(item.id, answer));
                    await refetchWaiting(store);
                  }}
                  onDismiss={async () => {
                    await api.dismissItem(item.id);
                    await refetchWaiting(store);
                    navigate(listPath(place?.list ?? list));
                  }} />
      </div>
    </div>
  );
}
