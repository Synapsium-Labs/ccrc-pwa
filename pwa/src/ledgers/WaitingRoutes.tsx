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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, Ref } from 'react';
import { BackButton, Button } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle } from '../fleet/runWords';
import { api } from '../lib/api';
import { LEDGER_REFUSAL_TEXT } from '../lib/refusalWords';
import { navigate, useLocation } from '../lib/router';
import { ROUTES, programmeIsOpenable, programmePath, sessionPath } from '../lib/routes';
import { FleetBanners } from '../screens/FleetScreen';
import { useFrameSet } from '../skins/frame';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { ItemView } from './ItemView';
import { homeProjectOf, programmeSpecHref } from './ledgerLinks';
import {
  BESIDE_LABEL, BETWEEN_ITEMS_LABEL, COMBINED_LIST, EMPTY_WORD, GONE_WORD, LEFT_LIST_WORD, NEXT_ITEM_LABEL, NEXT_WORD,
  NO_FRAME_WORD, PREVIOUS_ITEM_LABEL, PREVIOUS_WORD, backLabel, fromWord, groupByProgramme, itemPlace, knownProgrammes,
  listGroups, listOfFromWord, placeWords, positionWords, programmeIsLive, questionRows, resolveList, type ItemList,
  type ItemPlace, type ProgrammeGroup,
} from './ledgerWords';
import { ListGroup, WaitingScreen } from './WaitingScreen';
import { refetchWaiting } from './waitingStore';
import './ledgers.css';

/** The list's row of the route table, whose path and title this file reads: it spells neither of its own. */
const WAITING_ROUTE = ROUTES.find((r) => r.id === 'waiting');
const WAITING_PATH: string = WAITING_ROUTE?.path ?? '/';
const WAITING_TITLE: string = WAITING_ROUTE?.title ?? '';

/** The item path's query naming the list it was opened from (plan PL9), and the combined list's query naming its side
 *  rail's filter: both ride the URL, so a reload or a shared link keeps them. */
export const FROM_QUERY = 'from';
export const PROGRAMME_FILTER_QUERY = 'programme';

/** The one builder of an item's path, `/waiting/<id>`, which the `item` row of the route table parses, with `?from=` naming the
 *  list it is opened from (plan PL9). The combined list, unfiltered, is the default and writes no query. */
export const itemPath = (id: number, list: ItemList = COMBINED_LIST): string =>
  `${WAITING_PATH}/${id}${list.at === 'waiting' && list.programme === null ? '' : `?${new URLSearchParams({ [FROM_QUERY]: fromWord(list) })}`}`;

/** The combined list's path with its side rail's filter (`WaitingScreen`'s `programme`: a slug, `NO_PROGRAMME_FILTER`, or `null`
 *  for every programme) as its query. */
const filterPath = (programme: string | null): string =>
  programme === null ? WAITING_PATH : `${WAITING_PATH}?${new URLSearchParams({ [PROGRAMME_FILTER_QUERY]: programme })}`;

/** The one builder of a list's own path: the combined list, with its side rail's filter as a query, or a programme's view. */
export const listPath = (list: ItemList): string => (list.at === 'programme' ? programmePath(list.programme) : filterPath(list.programme));

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
 *  opened under the filter lands on the filtered list (plan PL9). The URL is the filter's one home: the screen keeps no copy. */
export function WaitingRoute({ store = useFleetStore }: { store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  const { search } = useLocation();
  const programme = new URLSearchParams(search).get(PROGRAMME_FILTER_QUERY);
  return (
    <WaitingScreen view={view} sessions={sessions} runs={runs} now={Date.now()} unavailable={unavailable} programme={programme}
                   onFilter={(programme) => navigate(filterPath(programme), { replace: true })}
                   onOpenItem={(id, list) => navigate(itemPath(id, list))} onOpenSession={(id) => navigate(sessionPath(id))} />
  );
}

/** `/waiting/<id>`'s arm of the ladder: the id is digits by the route's pattern, and one past the safe integers names no
 *  item. The route is NOT keyed by the id, so the strip above the item stays mounted as the operator steps along the list and
 *  the step control keeps the focus (fix round 1, F4); the item's own panel is keyed by it, so a typed answer never leaks from
 *  one item's panel to the next. */
export function ItemRouteAt({ param, store = useFleetStore }: { param: string | null; store?: FleetStore }): ReactNode {
  const id = Number(param);
  return <ItemRoute id={param !== null && Number.isSafeInteger(id) ? id : null} store={store} />;
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

/** The list's groups as this page has heard them, from the one grouping every list draws (`groupByProgramme`), or `null`
 *  before the first `waiting` frame. */
function useGroups(store: FleetStore): ProgrammeGroup[] | null {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  return view === null ? null : groupByProgramme(view.items, questionRows(sessions ?? [], runs ?? []));
}

/** The list the item's URL names, settled by the one stale-list rule (`resolveList`) with the programmes this page knows
 *  (`knownProgrammes`, follow-up F3); the named list itself before the first `waiting` frame, when there is nothing to
 *  settle it against. */
function useSettledList(store: FleetStore, named: ItemList, groups: readonly ProgrammeGroup[] | null): ItemList {
  const view = store((s) => s.waiting);
  const { runs } = useHeard(store);
  return groups === null || view === null ? named : resolveList(named, groups, knownProgrammes(view, runs));
}

/** One visit to an item: its id and the list it was opened from. */
const visitOf = (id: number | null, list: ItemList): string | null => (id === null ? null : `${id} ${fromWord(list)}`);

/** THE WALK KEEPS ITS PLACE (fix round 1, F2 and F6; departure pl9-walk-keeps-its-place). While the operator stays on one
 *  item, its steps and its position are the place it had when it was opened or last stepped to: a value taken from
 *  `itemPlace`, the one list function, never a second order. An act on the open item (a tick, an answer, or a change the
 *  coordinator pushed) moves the item in the live order, and must not move the steps under the operator, so "tick, then
 *  Next" reaches the item that was next. Kept in this route's state, keyed by the visit (the item's id and the list it was
 *  opened from): a step, a link to another item, Back or a reload is a new visit, which takes its place from the live order
 *  again; leaving the route drops it. `null` while the item has no place and never had one on this visit (recently cleared
 *  when opened, gone, or no list heard yet). */
function useKeptPlace(id: number | null, list: ItemList, live: ItemPlace | null): ItemPlace | null {
  const visit = visitOf(id, list);
  const [kept, setKept] = useState<{ readonly visit: string | null; readonly place: ItemPlace | null }>({ visit: null, place: null });
  // Taken during the render that first sees this visit, or the first place on it (React re-renders at once, before the
  // commit), so the page never draws a step the kept place would not take. A NEW VISIT ALWAYS RESETS IT, with no place too
  // (follow-up F2): a visit with no place (a cleared item) must not leave the previous visit's place behind, or Back to that
  // earlier visit would take the stale place instead of the live order's.
  if (kept.visit !== visit) setKept({ visit, place: live });
  else if (kept.place === null && live !== null) setKept({ visit, place: live });
  const mine = kept.visit === visit ? kept.place : null;
  return mine ?? live;
}

/** THE KEPT PLACE'S LIST, for the column beside the item (follow-up F3). The column is drawn in the frame's nav slot, outside
 *  this route's tree, so it cannot read the route's state; the route publishes the list its strip names (the kept place's,
 *  or the settled list with no place) here, keyed by the visit, and the column draws that list, so the strip and the column
 *  agree when the open item has left its list. A mirror with one writer (`ItemRoute`'s effect), never a second place: the
 *  place itself stays in `useKeptPlace`'s state. Cleared when the route unmounts. */
let shownList: { readonly visit: string; readonly list: ItemList } | null = null;
const shownListeners = new Set<() => void>();
function publishShownList(next: { readonly visit: string; readonly list: ItemList } | null): void {
  shownList = next;
  for (const l of shownListeners) l();
}
const subscribeShownList = (l: () => void): (() => void) => { shownListeners.add(l); return () => { shownListeners.delete(l); }; };
/** The list the item route's strip names on `visit`, or `null` when the route has published none for it yet. */
function useShownList(visit: string | null): ItemList | null {
  const shown = useSyncExternalStore(subscribeShownList, () => shownList, () => null);
  return shown !== null && shown.visit === visit ? shown.list : null;
}

/** The item's way back to the list it was opened from, AT EVERY WIDTH (plan PL9; spec §2, D23): labelled with that
 *  list's name, and not the shell's back chevron, which a desk hides because the column beside the pane is the way out of a
 *  screen. A phone has no such column, and on a desk the column holds the list's rows but not its page (the filter's summary,
 *  the programme view's Goals), so this is the way to that page. */
function ListBack({ list, runs, ref }: { list: ItemList; runs: readonly RunSummary[] | null; ref?: Ref<HTMLButtonElement> }): ReactNode {
  const name = list.at === 'programme' ? programmeTitle(list.programme, runs ?? []) : WAITING_TITLE;
  return (
    <Button ref={ref} variant="ghost" size="fit" className="wi-back" aria-label={backLabel(name)} onClick={() => navigate(listPath(list))}>
      <span aria-hidden="true">‹</span><span className="wi-back-name">{name}</span>
    </Button>
  );
}

type StepWay = 'prev' | 'next';

/** The strip above an item: the way back, and the steps to the previous and next item of the list it was opened from with its
 *  position. An item that list does not hold and never held on this visit (recently cleared) has the way back alone. The first
 *  item's Previous and the last item's Next are drawn disabled, so the strip keeps its shape as the operator steps along it.
 *  `left`: the open item has left the list while shown (its place is the kept one), which the strip says in words.
 *
 *  FOCUS (fix round 1, F4). The strip stays mounted across a step (`ItemRouteAt` is not keyed), and after Previous or Next the
 *  focus is put back on the same control, or on the other one when the end of the list has disabled it (a browser drops the
 *  focus of a control that turns disabled to the body). The position is a polite live region, so a screen reader hears where
 *  the step landed: drawn always, empty with no place, and carrying the open item's title beside "N of M" (follow-up A-3), so
 *  a step that lands on the same "N of M" still announces. The shown "N of M" is hidden from assistive technology, which
 *  hears the region instead. */
function ItemNav({ id, list, place, left, title, runs }: {
  id: number | null; list: ItemList; place: ItemPlace | null; left: boolean; title: string; runs: readonly RunSummary[] | null;
}): ReactNode {
  const pressed = useRef<StepWay | null>(null);
  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const way = pressed.current;
    if (way === null) return;
    pressed.current = null;
    const usable = (b: HTMLButtonElement | null): b is HTMLButtonElement => b !== null && b.isConnected && !b.disabled;
    const [same, other] = way === 'prev' ? [prevRef.current, nextRef.current] : [nextRef.current, prevRef.current];
    const target = usable(same) ? same : usable(other) ? other : backRef.current;
    target?.focus({ preventScroll: true });
  }, [id]);
  const step = (way: StepWay): void => {
    const to = place === null ? null : way === 'prev' ? place.prev : place.next;
    if (to === null || place === null) return;
    pressed.current = way;
    navigate(itemPath(to, place.list));
  };
  return (
    <nav className="wi-nav" aria-label={BETWEEN_ITEMS_LABEL}>
      <ListBack list={place?.list ?? list} runs={runs} ref={backRef} />
      <span className="sr-only" role="status">{positionWords(place, title)}</span>
      {place !== null && (
        <span className="wi-steps-nav">
          <span className="wi-pos" aria-hidden="true">{placeWords(place)}</span>
          <Button ref={prevRef} variant="ghost" size="fit" className="wi-step" aria-label={PREVIOUS_ITEM_LABEL}
                  disabled={place.prev === null} onClick={() => step('prev')}><span aria-hidden="true">‹</span>{PREVIOUS_WORD}</Button>
          <Button ref={nextRef} variant="ghost" size="fit" className="wi-step" aria-label={NEXT_ITEM_LABEL}
                  disabled={place.next === null} onClick={() => step('next')}>{NEXT_WORD}<span aria-hidden="true">›</span></Button>
        </span>
      )}
      {left && <p className="wi-left">{LEFT_LIST_WORD}</p>}
    </nav>
  );
}

/** The list an item was opened from, drawn in the frame's left column beside the open item on a desk, in place of the fleet
 *  (plan PL9; spec §2, D23): the fleet stays beside an open session the same way, and the fleet is one tap away in the
 *  navigation. `app.tsx` hands it to the frame's nav slot on the item route alone; the frame draws it only at the widths that
 *  show two columns, so a phone keeps its one screen. The list is the one the item's URL names, settled by the one stale-list
 *  rule (`resolveList`), and its groups are the ones that list draws (`listGroups`), each drawn as the list draws it, with the
 *  open item marked current when the list holds it. It follows the live order. It is the list the strip names (follow-up F3):
 *  the kept place's list as the item route publishes it (`useShownList`), or, before that, the live place's or the settled
 *  list, so it stays when the open item leaves the list (fix round 1, F6) and the strip and the column never disagree. It is
 *  drawn beside an item the list does not hold (recently cleared, gone): the column is the list's. A programme's view with
 *  nothing on the list says so, as the view does. Before the first `waiting` frame there is no list to draw, and the column
 *  shows `fleet`, what it shows elsewhere.
 *
 *  THE BANNERS (fix round 1, F1). A skin with no `Banners` part (Instrument) draws the fleet's banner stack inside its fleet
 *  column, which this column replaces, so here it mounts that same stack (`FleetBanners`) above the list: offline,
 *  reconnecting, halt, disk, backup, passkey and the sign-in resume show on an item as on the list, in a box with the fleet
 *  column's own gutters, top space and gap (`.wl-banners`, follow-up F1), so a banner sits where it sits there. That room is
 *  given only while a banner draws: with none the box takes no room (carry C, D-7951; review 1408 F1). A skin whose
 *  frame places the stack under its bar (Refined) draws it there, and none here: one stack is mounted at any width. */
export function ItemListColumn({ param, fleet, store = useFleetStore }: { param: string | null; fleet: ReactNode; store?: FleetStore }): ReactNode {
  const groups = useGroups(store);
  const { runs } = useHeard(store);
  const named = useOpenedFrom();
  const settled = useSettledList(store, named, groups);
  const set = useFrameSet();
  const id = Number(param);
  const valid = param !== null && Number.isSafeInteger(id);
  const shown = useShownList(valid ? visitOf(id, named) : null);
  if (groups === null || !valid) return fleet;
  const list = shown ?? itemPlace(id, named, groups)?.list ?? settled;
  const drawnGroups = listGroups(list, groups);
  const hues = fleetHues(runs ?? []);
  const now = Date.now();
  return (
    <>
      {set !== null && set.Banners === null && <div className="wl-banners"><FleetBanners /></div>}
      <aside className="wl wl-beside" aria-label={BESIDE_LABEL}>
        {drawnGroups.length === 0 && list.at === 'programme' && <p className="wl-note">{EMPTY_WORD}</p>}
        {drawnGroups.map((g) => (
          <ListGroup key={g.program ?? ''} group={g} runs={runs} now={now} currentId={id}
                     hue={g.program === null ? null : hues.get(g.program) ?? null}
                     onOpenItem={(next) => navigate(itemPath(next, list))} onOpenSession={(sid) => navigate(sessionPath(sid))} />
        ))}
      </aside>
    </>
  );
}

/** `/waiting/<id>`: an item of the list, or of the recently cleared, found by its id; `null` for a parameter that names none.
 *  The list its URL names is settled against the groups once (`resolveList`), for every branch, the gone item's included, so
 *  every way back is the same one (fix round 1, F7). */
export function ItemRoute({ id, store = useFleetStore }: { id: number | null; store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { runs } = useHeard(store);
  const groups = useGroups(store);
  const unavailable = useUnavailable(store, view !== null);
  const named = useOpenedFrom();
  const list = useSettledList(store, named, groups);
  const live = id === null || groups === null ? null : itemPlace(id, named, groups);
  const place = useKeptPlace(id, named, live);
  const item = id === null || view === null ? null : view.items.find((i) => i.id === id) ?? view.cleared.find((i) => i.id === id) ?? null;
  const back = place?.list ?? list;
  // The list the strip names, for the column beside the item (`useShownList`), once a list has been heard.
  const visit = visitOf(id, named);
  const backWord = groups === null ? null : fromWord(back);
  useLayoutEffect(() => {
    if (visit === null || backWord === null) return undefined;
    publishShownList({ visit, list: listOfFromWord(backWord) });
    return () => publishShownList(null);
  }, [visit, backWord]);
  let body: ReactNode;
  if (id !== null && view === null) {
    body = unavailable !== null
      ? <p className="wl-note" role="alert">{unavailable}</p>
      : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>;
  } else if (item === null) {
    body = <p className="wl-note">{GONE_WORD}</p>;
  } else {
    body = (
      <ItemView key={item.id} item={item} now={Date.now()} programmeLive={programmeIsLive(item.program, runs)}
                programme={{
                  name: programmeTitle(item.program, runs ?? []), hue: fleetHues(runs ?? []).get(item.program) ?? null,
                  // The band's doors (desktop-polish PL10, D-7952; D26): the programme view, and its pinned spec in the Docs reader.
                  href: programmeIsOpenable(item.program) ? programmePath(item.program) : null,
                  specHref: view === null ? null : programmeSpecHref(item.program, view.goals, runs ?? []),
                  homeProject: homeProjectOf(item.program, runs ?? []),
                }}
                onTick={async (answer) => {
                  await (answer === undefined ? api.tickItem(item.id) : api.tickItem(item.id, answer));
                  await refetchWaiting(store);
                }}
                onDismiss={async () => {
                  await api.dismissItem(item.id);
                  await refetchWaiting(store);
                  navigate(listPath(back));
                }} />
    );
  }
  return (
    <div className="wl-route">
      <ItemNav id={id} list={list} place={place} left={place !== null && live === null} title={item?.title ?? ''} runs={runs} />
      {item === null ? <div className="wl">{body}</div> : body}
    </div>
  );
}
