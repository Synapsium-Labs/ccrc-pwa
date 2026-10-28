// The fleet's project cards (W2 Task S10, D-5473): the list `FleetScreen` drew inline until this task, lifted whole so
// two skins can place ONE list. Refined's fleet column draws it as before; Instrument's table (`FleetTable`) draws it
// in its project mode, so the cards' doors (the pool, archive-all, add workspace) and the rollup's rules (D-6088: an
// inactive project collapses, a coordinator's workers fold into one line, a row the operator is reading never moves,
// D-6090) hold in both skins, from one source. Nothing here was rewritten: the reads, the clock and the rollup's reset
// are the ones `FleetScreen` carried, moved with their comments.
//
// MEMOISED (C9, D-6441): the tree and the rollup are rebuilt only when what they read changes, and every callback a
// card is handed is stable, so `ProjectCard` and `SessionLine` (both `memo`'d, `lineProps.ts`) re-render only for what
// changed: a one-row frame rebuilds the tree, so the cards re-render, but one `SessionLine` only; a chrome change with
// the same fleet re-renders no card. No clock is read here: a spawning dispatch's readout ticks itself
// (`ProjectCard`'s `PendingSpawn`), and the rollup re-reads the time only when its own timer wakes it.
//
// It reads the chrome's store (`useFleetChrome`), the one `FleetScreen` itself checks it was handed, so the cards and
// the screen around them always describe one fleet.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { fleetTree } from './fleetTree';
import { ProjectCard } from './ProjectCard';
import { isRunClosed } from './runWords';
import { useFolded, useRollupPrefs } from './foldState';
import { useHoldView } from './useHoldView';
import { useRollupClock } from './useRollupClock';
import { prunePrefs, rollupFleet, toggleChildren, toggleProject } from './rollup';
import type { FleetSession } from '../../../shared/api';
import { useProjectedHome } from './useProjectedHome';
import { useFleetChrome } from './FleetChrome';
import { useFleetFlows } from './FleetFlows';
import { acksSnapshot, subscribeAcks } from '../lib/seen';
import './fleet.css';

export function FleetCards({ selectedId, onOpen }: {
  /** The open session, highlighted. */
  selectedId: string | null;
  onOpen: (id: string) => void;
}): ReactNode {
  const chrome = useFleetChrome();
  const useStore = chrome.store;
  const sessions = useStore((s) => s.sessions);
  const roster = useStore((s) => s.roster);
  const pools = useStore((s) => s.pools);
  const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);
  // The unseen watermark, subscribed as `FleetScreen` subscribes it (seen.ts publishes; no re-read of storage).
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const flows = useFleetFlows();
  const projects = chrome.projects;
  const open = onOpen;
  // The same active-only list the screen's runs line counts (`isRunClosed`), read from the same frame.
  const runs = useStore((s) => s.runs);
  const activeRuns = useMemo(() => runs.filter((r) => !isRunClosed(r)), [runs]);
  const projected = useProjectedHome(true, useStore);
  // Task 4's clock, for the pending child's elapsed readout, is the readout's own now (C9, D-6441): `PendingSpawn`
  // runs `useNow(1_000)` while it is drawn, so a spawning dispatch ticks one readout, never this list. The cadence still
  // follows the content (the `SessionHeader`/`ToolCard` idiom `RunsScreen` adopted for the same window), and a fleet
  // with nothing spawning still runs no one-second timer at all: no pending row, no readout, no clock.
  // Fold state persists across navigation (foldState.ts) — useState here would
  // re-expand every project on the way back from a session.
  const [folded, toggleFold] = useFolded();
  // D-6088: the rollup's per-device preferences, and the clock its 30-minute window reads: fresh on every render, and
  // one timer for the next window end only (`useRollupClock`), so a quiet fleet still runs no timer.
  const [rollupPrefs, updateRollup] = useRollupPrefs();
  const roll = useRollupClock(sessions);
  // The tree the cards draw, once, and its rollup over the same groups (D-6088). Memoised (C9): the rollup reads the
  // time when it is rebuilt, which is on a new tree, a new preference or selection, or its timer's wake.
  const tree = useMemo(
    () => fleetTree(sessions, projects.knownProjects, activeRuns, acks), [sessions, projects.knownProjects, activeRuns, acks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `roll.wake` stands for `roll.now`: the window moves only then.
  const rollup = useMemo(() => rollupFleet(tree, rollupPrefs, roll.now, selectedId), [tree, rollupPrefs, selectedId, roll.wake]);
  // Rule 4's reset: a stored ▾ made in the other activity class, or an open worker line whose coordinator left, is
  // dropped — from a FRESH frame only, never from a cached snapshot (`fleetFrameSeen`). `prunePrefs` answers null when
  // nothing changes, so this writes nothing on an ordinary frame.
  // Keyed on what the reset reads — each card's class and the fleet's ids — so it runs when one of them moves.
  const pruneKey = `${[...rollup.cards].map(([p, c]) => `${p}:${c.cls}`).join('|')}#${sessions.map((s) => s.id).join('|')}`;
  useEffect(() => {
    if (!fleetFrameSeen) return;
    const ids = new Set(sessions.map((s) => s.id));
    updateRollup((p) => prunePrefs(p, rollup, ids) ?? p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pruneKey` is the dependency: it names every input read.
  }, [fleetFrameSeen, pruneKey, updateRollup]);
  // D-6090: a card rolled up or out on its own must not move the one the operator is reading (`useHoldView`).
  const listRef = useRef<HTMLDivElement>(null);
  useHoldView(listRef, [...rollup.cards].map(([p, c]) => `${p}:${c.collapsed ? '-' : c.rows.length}`).join('|'));
  // "Archive all" in a card's Released fold (workspace lifecycle spec §5.1):
  // the cards read the loop's in-flight set, which the chrome holds (D-5468).
  // The ··· sheet's lifecycle, the guarded reap flow and the confirm's subject
  // are the chrome's too; this screen only opens them (`useFleetFlows`).
  const archiveAll = chrome.archiveAll;
  // The cards' callbacks, stable across renders (C9), so a memo'd card is handed the same function each time. The
  // project ▾ reads the NEWEST rollup from a ref: a toggle acts on the card as it is drawn now.
  const rollupRef = useRef(rollup);
  rollupRef.current = rollup;
  const onToggle = useCallback((key: string): void => {
    // A project's own key names its card; a sub-fold's key (`<project>::released`, `::archived`) names none.
    const card = rollupRef.current.cards.get(key);
    if (card !== undefined) updateRollup((p) => toggleProject(p, card, key));
    else toggleFold(key);
  }, [updateRollup, toggleFold]);
  const onToggleChildren = useCallback((id: string): void => updateRollup((p) => toggleChildren(p, id)), [updateRollup]);
  const onActions = useCallback((s: FleetSession): void => flows.openActions(s.id), [flows]);
  // Fleet-wide, by id: an orphan's coordinator is by construction NOT among its card's own sessions (D-3009).
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s] as const)), [sessions]);
  const coordOf = useCallback((id: string): FleetSession | null => byId.get(id) ?? null, [byId]);

  return (
    <div className="fleet-list" ref={listRef}>
      {tree.map((g) => (
        <ProjectCard
          key={g.project}
          group={g}
          onOpen={open}
          selectedId={selectedId}
          onAddWorkspace={flows.openAddWorkspace}
          projected={projected}
          placement={projects.placementFor(g.project)}
          poolFor={projects.poolFor}
          adding={projects.adding.has(g.project)}
          /* D-6088: the project fold and the worker lines are the rollup's (`rollup.ts`); the Released and
             Archived sub-folds keep `useFolded`. */
          rollup={rollup.cards.get(g.project)}
          onToggle={onToggle}
          onToggleChildren={onToggleChildren}
          onActions={onActions}
          roster={roster}
          pools={pools}
          onPool={flows.openPool}
          /* Task 4 (wave 2): THIS card's runs are the runs whose WORKER
             renders here — `runCard`, never `r.project`. A run kept on
             its worker's OWN project's card after the row moved would be
             spec §1's pure regression: one end on each card, no edge.
             Both lists are computed by `fleetTree` (D-5527), over the
             same card map as the rows; the filters described here live there. */
          runs={g.runs}
          /* The SECOND list (spec §3 F4): the runs this project is the
             HOME of, working somewhere else. NOT the exact complement of
             the filter above (D-2582): a run homed on a third project
             and working on a fourth is in NEITHER of this card's lists,
             and a crossing run appears in `runs` on the working card and
             in `abroad` on the home card — two different cards' lists —
             so there is no partition across cards either; the two
             filters are merely disjoint on this one card. What is true:
             that one asks where the work is, this one asks whose
             programme it is — and the two never merge, because only the
             first may reach `nestFleet`. `runHomeProject` rather than
             `r.homeProject`, for the house rule its own docstring
             gives — one reader per field — not because the tolerance is
             load-bearing at THIS `===` comparison: an older server's
             missing key makes `runHomeProject(r)` `null` and a raw
             `r.homeProject` `undefined`, and either one `=== g.project`
             is false, so the failure mode without the tolerant reader
             would have been a crossing run silently missing its abroad
             line on an older server, never every run landing on every
             card. And this predicate SPECIALIZES `crossingNote`'s
             decision rather than re-spelling it, which is the distinction
             D-2575 turns on: `crossingNote` asks whether a run is
             crossing AT ALL, judged from the run's own project, while
             this asks the same question from a THIRD party — the card
             whose project is neither necessarily the run's work nor its
             home. Named here so the next reader neither deletes it as a
             duplicate of that decision nor forks it into a second copy
             of it. Since wave 2 it also SUBTRACTS a run whose worker now
             renders on this very card — that run is a bracketed row
             here, and a second line for it would state the same wave
             twice (spec §6). */
          abroad={g.abroad}
          /* Fleet-wide, unlike every other lookup this card is handed —
             an orphan's coordinator is by construction NOT among this
             card's own sessions (D-3009), so a card-scoped read would
             always answer `null` for the one row that asks. */
          coordOf={coordOf}
          frameSeen={fleetFrameSeen}
          /* INVERTED against the project fold on purpose: foldState
             stores what is COLLAPSED, so absence means open — right for
             a project, wrong for an archive fold that must start
             closed. Under this composite key, presence means EXPANDED. */
          archivedOpen={folded.has(`${g.project}::archived`)}
          /* The same inversion, for the Released fold (workspace lifecycle spec §5.1). */
          releasedOpen={folded.has(`${g.project}::released`)}
          onArchiveReleased={flows.openArchiveAll}
          archivingReleased={archiveAll.archiving.has(g.project)}
        />
      ))}
    </div>
  );
}
