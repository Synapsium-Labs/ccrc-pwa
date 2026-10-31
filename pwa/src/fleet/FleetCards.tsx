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
// the same fleet re-renders no card. No one-second clock runs here: a spawning dispatch's readout ticks itself
// (`ProjectCard`'s `PendingSpawn`). The rollup's clock is read on every render (`useRollupClock`), but with the same
// fleet, preferences and selection the rollup is rebuilt only when its next boundary moves (`roll.next`: a window end,
// or since Task G1b a programme box's stall boundary), so it reads `roll.now` only then.
//
// It reads the chrome's store (`useFleetChrome`), the one `FleetScreen` itself checks it was handed, so the cards and
// the screen around them always describe one fleet.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { fleetTree, unplacedActivities } from './fleetTree';
import { ProjectCard } from './ProjectCard';
import { isRunClosed } from './runWords';
import { useFolded, useRollupPrefs } from './foldState';
import { useHoldView } from './useHoldView';
import { useBoxClock } from './useBoxClock';
import { cardBoxes, foldedCard } from './programmeBoxes';
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
  // Delegation broker wave 4: the `delegation` frame, `null` when unavailable — never defaulted to an empty one, so
  // an older server's screen claims nothing (spec §5.13).
  const delegation = useStore((s) => s.delegation);
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
  // D-6088: the rollup's per-device preferences, and the clock its 30-minute window reads: one timer, for the next window
  // end or box stall boundary (`useBoxClock`), and the rollup reads `roll.now` only when it is rebuilt. A folded
  // card's "active … ago" runs its own 30 s interval (`ProjectCardHead`'s `LastActive`), so a quiet fleet runs that,
  // and no one-second timer.
  const [rollupPrefs, updateRollup] = useRollupPrefs();
  // Task G1b, G1d (D-7380, D-7373, D-7376): a programme box's threshold is the stall watch's own quiet time (the runs frame's,
  // read once in the store), its pause the coord frame's, and its clock this one, the hook the Status view reads too: the
  // timer also wakes when a box crosses its threshold (`nextStallBoundary`). The cards are handed the time read when `next`
  // last moved (`boxNow`): with the same runs, quiet time and pause no box crosses between two moves of `next`, so that time
  // reads every box's state as the real time would, and a memo'd card's props change only at a boundary or with a frame (C9).
  const { roll, boxNow, stallQuietMs, coordPaused } = useBoxClock(useStore, sessions, activeRuns);
  // The tree the cards draw, once, and its rollup over the same groups (D-6088). Memoised (C9): the rollup reads the
  // time when it is rebuilt, which is on a new tree, a new preference or selection, or a move of `roll.next` (a window's
  // end, or a box's stall boundary, where the rollup is rebuilt to the same answer: harmless, one rebuild a boundary).
  const tree = useMemo(
    () => fleetTree(sessions, projects.knownProjects, activeRuns, acks, delegation),
    [sessions, projects.knownProjects, activeRuns, acks, delegation]);
  const unplaced = useMemo(() => unplacedActivities(sessions, delegation), [sessions, delegation]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `roll.next` stands for `roll.now`: it moves only at a boundary.
  const rollup = useMemo(() => rollupFleet(tree, rollupPrefs, roll.now, selectedId), [tree, rollupPrefs, selectedId, roll.next]);
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
  // A stall boundary can change which boxes a folded card keeps (spec §2.3) with no frame (Task G1b), so its part of the
  // key counts the kept boxes, by the composition the card itself draws (`cardBoxes`); an open card's is its rows. It counts
  // what a BOUNDARY moves and nothing else: a frame that grows a kept box's tray, or the more-line from 0 to 1, with the
  // same kept count grows the folded card with the key unchanged, as it did before G1b (review 1253 F1, left as it was).
  const holdKey = useMemo(() => {
    const groups = new Map(tree.map((g) => [g.project, g] as const));
    const kept = (p: string): number => {
      const g = groups.get(p);
      if (g === undefined) return 0;
      const { ranked } = cardBoxes(g.rows, g.runs, g.claimed, g.hues, boxNow, stallQuietMs, coordPaused);
      return foldedCard(ranked, [], []).keep.length;
    };
    return [...rollup.cards].map(([p, c]) => `${p}:${c.collapsed ? `-${kept(p)}` : c.rows.length}`).join('|');
  }, [tree, rollup, boxNow, stallQuietMs, coordPaused]);
  useHoldView(listRef, holdKey);
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
    <div
      className="fleet-list"
      ref={listRef}
      data-delegation={delegation === null ? 'unavailable' : 'measured'}
      data-delegation-unplaced={unplaced > 0 ? unplaced : undefined}
    >
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
          /* Task G1b: the programme boxes' clock, threshold and pause (above). */
          boxNow={boxNow}
          stallQuietMs={stallQuietMs}
          coordPaused={coordPaused}
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
          /* The same inversion, for the delegation broker's two groups (wave 4): both start closed. */
          offlineOpen={folded.has(`${g.project}::offline-coordinator`)}
          unownedOpen={folded.has(`${g.project}::unowned`)}
          onArchiveReleased={flows.openArchiveAll}
          archivingReleased={archiveAll.archiving.has(g.project)}
        />
      ))}
    </div>
  );
}
