// Instrument's fleet list (W2 Task S10, D-5473; spec §5.3, Fleet, Instrument column): the status-grouped table, the
// status · project toggle above it, and on a phone the underline tabs over the same groups. It fills the set's
// `FleetList` part, which `FleetScreen` places where Refined draws its project cards, so the banners, the runs line and
// the bucket bar around it stay the screen's own.
//
// STATUS MODE reads `groupByStatus` (statusGroups.ts): the groups, their order, their labels and which fold are that
// model's, never this file's. Needs you, Working and Done are open; Idle, Cleanup, Archived and Dead fold. A fold is
// `useFolded`'s, under `status::<bucket>`, and the key means "not as it starts": for a folding group its presence
// opens it (the archived fold's inversion, `FleetScreen`'s comment), for an open one its presence closes it. So a
// device that never touched a fold sees the defaults, and an unanswered question is never folded away by default
// (Needs you is always open until the operator closes it, the fleet rollup's rule, D-6088).
//
// A ROW IS THE SHARED `SessionLine`, in a dense arrangement (`ins-row`, `min-h-row`: `--row-h`, 44 under a coarse
// pointer and 32 under a fine one, skins.css). The line already carries its lamp, its state word (`sessionFacts`'s,
// one table for every reader, D-5545), its one marker and its context fact, so no fact a row shows today is dropped and
// no second word table exists here. Selecting opens the session; ⋯ is the line's own `actionDoor('open-actions')`.
//
// A CHILD in status mode sits in its own status's group, never under its coordinator's, so folding the coordinator's
// group cannot hide it; it carries a crumb naming its coordinator (`childRunContext`'s name, the label the row's own
// programme cell reads). Its run, its cross-project chip and its orphan marker are read through `fleetTree`'s groups,
// the card the server placed it on, exactly as the project card reads them (D-5527), so the two modes cannot disagree.
//
// PROJECT MODE places the shared `FleetCards`, the list Refined draws: its card heads hold the pool and add doors, its
// Released fold holds archive-all, and the rollup's rules hold unchanged. A card mixes statuses, so there each row
// shows its word beside its lamp (spec §3.1), which `SessionLine` always does.
//
// THE TOGGLE is remembered per device under `ccrc-fleet-group`; storage that is absent, unreadable or holds an unknown
// value answers status. The phone tabs (below the desk query) are a view over the status groups, not a mode: All shows
// every group with its folds.
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { BareRow, Button, CountBadge } from '@ccrc/ui';
import type { FleetSession, SessionBucket } from '../../../../shared/api';
import { FleetCards } from '../../fleet/FleetCards';
import { useFleetChrome } from '../../fleet/FleetChrome';
import { useFleetFlows } from '../../fleet/FleetFlows';
import { useFolded } from '../../fleet/foldState';
import { cardsOf, childRunContext, fleetTree, parentIdOf, workingOn, type FleetTreeGroup } from '../../fleet/fleetTree';
import { orphanNote } from '../../fleet/orphanWords';
import { isRunClosed, runForSession } from '../../fleet/runWords';
import { SessionLine } from '../../fleet/SessionLine';
import { groupByStatus, STATUS_GROUPS, type StatusGroup } from '../../fleet/statusGroups';
import { acksSnapshot, subscribeAcks } from '../../lib/seen';
import { matchRoute } from '../../lib/routes';
import { navigate, useLocation } from '../../lib/router';
import { DESK_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

/** The toggle's per-device memory. */
export const GROUP_MODE_KEY = 'ccrc-fleet-group';

export type GroupMode = 'status' | 'project';

/** The remembered mode: status unless storage says project. Never throws. */
export function loadGroupMode(): GroupMode {
  try {
    return window.localStorage.getItem(GROUP_MODE_KEY) === 'project' ? 'project' : 'status';
  } catch {
    return 'status';
  }
}

function saveGroupMode(mode: GroupMode): void {
  try {
    window.localStorage.setItem(GROUP_MODE_KEY, mode);
  } catch {
    /* a mode that cannot be saved still applies for this mount */
  }
}

const MODES: readonly { readonly id: GroupMode; readonly label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'project', label: 'Project' },
];

/** The phone's tabs: the three open groups, then All. Labels are the model's. */
type PhoneTab = 'attention' | 'working' | 'done' | 'all';
const PHONE_TABS: readonly PhoneTab[] = ['attention', 'working', 'done', 'all'];
const tabLabel = (t: PhoneTab): string => (t === 'all' ? 'All' : STATUS_GROUPS[t].label);

/** The fold key of a status group. */
const foldKey = (bucket: SessionBucket): string => `status::${bucket}`;

export function FleetTable(): ReactNode {
  const [mode, setMode] = useState<GroupMode>(loadGroupMode);
  const [tab, setTab] = useState<PhoneTab>('all');
  const desk = useMediaQuery(DESK_QUERY);
  const { path } = useLocation();
  const at = matchRoute(path);
  const selectedId = at?.route.id === 'session' ? at.param : null;

  const choose = (next: GroupMode): void => {
    setMode(next);
    saveGroupMode(next);
  };

  return (
    <div className="ins-table" data-mode={mode}>
      <div role="radiogroup" aria-label="Group sessions by" className="ins-toggle">
        {MODES.map((m) => (
          <Button
            key={m.id}
            variant="ghost"
            role="radio"
            aria-checked={mode === m.id}
            className="ins-toggle-option"
            onClick={() => choose(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      {mode === 'project'
        ? <FleetCards selectedId={selectedId} onOpen={openSession} />
        : <StatusTable selectedId={selectedId} phoneTab={desk ? null : tab} onTab={setTab} />}
    </div>
  );
}

const openSession = (id: string): void => navigate(`/s/${encodeURIComponent(id)}`);

function StatusTable({ selectedId, phoneTab, onTab }: {
  selectedId: string | null;
  /** The phone's chosen tab, or null at a desk (no tabs). */
  phoneTab: PhoneTab | null;
  onTab: (tab: PhoneTab) => void;
}): ReactNode {
  const chrome = useFleetChrome();
  const useStore = chrome.store;
  const sessions = useStore((s) => s.sessions);
  const roster = useStore((s) => s.roster);
  const frameSeen = useStore((s) => s.fleetFrameSeen);
  const activeRuns = useStore((s) => s.runs).filter((r) => !isRunClosed(r));
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const flows = useFleetFlows();
  const [folded, toggleFold] = useFolded();

  const groups = groupByStatus(sessions, acks);
  // Read by key, never compared: the bucket a group holds is the model's answer (instrument-shell's scan).
  const byBucket = new Map(groups.map((g) => [g.bucket, g] as const));
  // The cards the server placed each row on, and their runs and live rows: what the project card reads for the same
  // row (its run door, its cross-project chip, its orphan marker), so a row says the same thing in either mode.
  const cards = cardsOf(sessions);
  const tree = new Map<string, FleetTreeGroup>(
    fleetTree(sessions, chrome.projects.knownProjects, activeRuns, acks).map((g) => [g.project, g] as const));
  const lookup = (id: string): FleetSession | null => sessions.find((s) => s.id === id) ?? null;

  const row = (s: FleetSession): ReactNode => {
    const card = tree.get(cards.get(s.id) ?? s.project) ?? null;
    const runs = card?.runs ?? activeRuns;
    const child = childRunContext(s, runs, lookup);
    const crumb = parentIdOf(s, runs) === null ? null : child.coordinator;
    const note = card === null ? null
      : orphanNote({ kind: 'session', depth: 0, session: s }, card.runs, card.project, card.sessions, lookup, frameSeen);
    return (
      <li key={s.id} data-row={s.id} className="ins-row min-h-row">
        <SessionLine
          session={s}
          onOpen={openSession}
          selected={s.id === selectedId}
          onActions={(x) => flows.openActions(x.id)}
          roster={roster}
          projectPool={chrome.projects.poolFor(s.project)}
          onOpenRun={runForSession(runs, s) === null ? null : () => navigate('/runs')}
          workingOn={workingOn(s, cards)}
          childRun={child}
          coordinator={note?.presence ?? null}
          {...(note === null ? {} : { coordinatorTitle: note.title })}
        />
        {crumb !== null && (
          <span className="ins-coord-crumb" title={`coordinated by ${crumb}`}>
            <span aria-hidden="true">↳ </span>
            <span className="sr-only">coordinated by </span>
            {crumb}
          </span>
        )}
      </li>
    );
  };

  const isOpen = (g: StatusGroup): boolean => g.folds === folded.has(foldKey(g.bucket));
  // At a desk and under All, every group that holds a row; under a phone tab, that one group, even when empty.
  const shown = phoneTab === null || phoneTab === 'all'
    ? groups.filter((g) => g.sessions.length > 0)
    : [byBucket.get(phoneTab)].filter((g): g is StatusGroup => g !== undefined);

  return (
    <>
      {phoneTab !== null && (
        <div role="tablist" aria-label="Sessions by status" className="ins-tabs">
          {PHONE_TABS.map((t) => {
            const count = t === 'all' ? sessions.length : byBucket.get(t)?.sessions.length ?? 0;
            return (
              <Button
                key={t}
                variant="ghost"
                role="tab"
                aria-selected={phoneTab === t}
                className="ins-tab"
                onClick={() => onTab(t)}
              >
                {tabLabel(t)}
                <span className="ins-tab-count"> {count}</span>
              </Button>
            );
          })}
        </div>
      )}
      {shown.map((g) => {
        const open = isOpen(g);
        return (
          <section key={g.bucket} className="ins-group" data-status-group={g.bucket} aria-label={g.label}>
            <BareRow className="ins-group-head" aria-expanded={open} onClick={() => toggleFold(foldKey(g.bucket))}>
              <span className="ins-group-word">{g.label}</span>
              <span className="ins-group-count"> · {g.sessions.length}</span>
              {g.unseen > 0 && <CountBadge aria-label={`${g.unseen} unseen`}>{g.unseen}</CountBadge>}
            </BareRow>
            {open && g.sessions.length > 0 && <ul className="ins-rows">{g.sessions.map(row)}</ul>}
          </section>
        );
      })}
    </>
  );
}
