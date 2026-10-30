// Instrument's fleet list (W2 Task S10, D-5473; spec §5.3, Fleet, Instrument column): the status-grouped table, the
// status · project toggle above it, and on a phone the underline tabs over the same groups. It fills the set's
// `FleetList` part, which `FleetScreen` places where Refined draws its project cards, so the banners around it stay
// the screen's own (at a desk there is no runs line here, T2f, D-6371). The bucket bar is not: the screen draws it only
// for a set with no such part, so the counts appear once per screen (T3a, D-6331). Here the status groups' heads are
// the counts, and project mode draws the bar itself, because the cards carry none.
//
// STATUS MODE reads `statusView` (statusGroups.ts): the groups, their order, their labels, their counts and which fold
// are that model's, never this file's. Needs you, Programmes, Done and Working are open; Idle, Cleanup, Archived and
// Exited fold. A fold is `useFolded`'s, under `status::<group>`, and the key means "not as it starts": for a folding group its presence
// opens it (the archived fold's inversion, `FleetScreen`'s comment), for an open one its presence closes it. So a
// device that never touched a fold sees the defaults. Needs you, while it draws anything, is HELD open whatever is stored:
// an operator-facing session is never rolled up (the fleet rollup's rule 5, D-6088). Its head stays focusable
// (aria-disabled, never `disabled`), says why in text, and its click is ignored, as `ProjectCardHead`'s held ▾ does.
// A BADGED head reads `Done · 5 · 4 new` and offers Mark all seen, a SIBLING of the fold row (the row is itself a
// button), through `markSeen.ts`, the one helper the bucket chips use too: after the ack the button unmounts, focus moves
// to that head's fold row, and a status region outside the unmounting control says what happened.
// The keys share `useFolded`'s one set with the project cards' `<project>::<fold>` keys, so a project literally named
// `status` would share its sub-folds' keys with these groups; accepted, the plan names the keys.
//
// A ROW IS THE SHARED `SessionLine`, in a dense arrangement (`ins-row`, `min-h-row`: `--row-h`, 44 under a coarse
// pointer and 32 under a fine one, skins.css). The line already carries its lamp, its state word (`sessionFacts`'s,
// one table for every reader, D-5545), its one marker and its context fact, so no fact a row shows today is dropped and
// no second word table exists here. Selecting opens the session; ⋯ is the line's own `actionDoor('open-actions')`.
//
// PROGRAMMES, NOT CHILDREN (Task G3, D-7333): status mode draws `statusView`'s groups (statusGroups.ts), over the same
// `fleetTree` the project cards read. A coordinator's open work is its programme's box, G2's `ProgrammeBox` in its
// `needs-only` mode (no fold, no footer, the project in its kicker), and a child never draws as a row of its own: it is
// in its box's tray while it asks the operator, and nowhere otherwise. Needs you holds the boxes that need the operator,
// then the rows in no programme that do; Programmes the other boxes; the rest are today's groups over the rows in no
// programme. Every head counts what its group draws, a box as one. A row's run and its cross-project chip are read
// through `fleetTree`'s groups, the card the server placed it on, exactly as the project card reads them (D-5527), so
// the two modes agree on them. Its orphan marker is the same `orphanNote`, given the card's runs too, but asked about
// `keepers` (the coordinators of the boxes that keep their workers) where the project card passes its live rows. The
// two modes differ there on purpose (D-7377 as amended, R123): a dead claimant that is still a row of the worker's card
// leaves the worker a lone row saying "coordinator gone" here, where project mode nests it under that coordinator and
// says nothing; and NO row of this view carries "coordinator hibernated" for a claimant that heads a box here: the
// hibernated box the view draws says it, so the marker is dropped from the members in its tray and, as ruled for review
// 1239's C1, from the row outside any tray that `keepers` reaches too: a coordinator that is itself a worker of that
// claimant's run on another card, drawn as its own box's head (pinned in status-programmes). An archived worker of that
// run is a lone row too, and while it has a lifecycle word its line draws no coordinator marker either way, by marker
// precedence and not by this rule: a card row draws only the first of its markers (`markers(f)[0]`), and that word outranks
// `coordinator-hibernated`. An archived row still carrying `hibernatedAt` has no lifecycle word and relies on `keepers`.
// Project mode marks one whose claimant is not on its card "coordinator hibernated". A row whose hibernated claimant is NOT
// drawn in this view still gets the marker: that is a gap to raise, never a silent rule.
//
// MOVEMENT (Task G1c, D-7380): a box reads stalled or paused exactly as on its project card. `statusView` is handed the
// card's own three inputs, the stall watch's quiet time (the store's `stallQuietMs`, null on an older server, D-7376), the
// operator's pause (the coord frame's, D-7373) and a clock, and decides the state; this file only reads and passes them.
// The clock is `useBoxClock` (Task G1d), the one hook the project cards read too: its one timer wakes at the next instant a
// box crosses its threshold (`nextStallBoundary`), so a box reads stalled at its boundary with no frame, and the view is
// handed the time read when that boundary last moved (`boxNow`), so it is rebuilt only at a boundary or with a frame. No
// window is read here, so the clock is given no sessions: the rollup's window ends would wake a view that has no rollup.
//
// PROJECT MODE places the shared `FleetCards`, the list Refined draws: its card heads hold the pool and add doors, its
// Released fold holds archive-all, and the rollup's rules hold unchanged. A card mixes statuses, so there each row
// shows its word beside its lamp (spec §3.1), which `SessionLine` always does.
//
// THE CLASS CHOOSER sits on the toggle's row in project mode at a desk only (T2f, D-6371): its readers are the project
// cards' placement forecast and Add workspace, so in status mode it would do nothing. Below 900 it stays on the screen's
// runs line. It is the shared `ClassChooser`, a sibling of the radiogroup and never inside it; the radiogroup grows (`flex-auto`, so its
// basis stays its content and the row wraps the chooser under it at large text sizes, which `flex-1`'s 0% basis never did)
// to the space the chooser leaves, so the toggle keeps the row's width in both modes. `.ins-toggle` already sets
// `min-width: 0`, so no utility repeats it.
//
// THE TOGGLE is remembered per device under `ccrc-fleet-group`; storage that is absent, unreadable or holds an unknown
// value answers status. The phone tabs (below the desk query) are a view over the status groups, not a mode: Needs you,
// Programmes, Done, Working, then All, which shows every group with its folds; each counts what its group draws. Both are one tab stop with roving focus: the arrow keys, Home and End move and choose
// (the settings theme grid's pattern), and the tabs control the tabpanel that holds the groups.
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { BareRow, Button, CountBadge } from '@ccrc/ui';
import type { FleetSession } from '../../../../shared/api';
import { BucketBar } from '../../fleet/BucketBar';
import { ClassChooser } from '../../fleet/ClassChooser';
import { FleetCards } from '../../fleet/FleetCards';
import { useFleetChrome } from '../../fleet/FleetChrome';
import { useFleetFlows } from '../../fleet/FleetFlows';
import { useFolded } from '../../fleet/foldState';
import { cardsOf, childRunContext, fleetTree, workingOn, type FleetTreeGroup } from '../../fleet/fleetTree';
import { orphanNote } from '../../fleet/orphanWords';
import { ProgrammeBox } from '../../fleet/ProgrammeBox';
import type { ProgHue } from '../../fleet/programmeBoxes';
import { boundOpenRun, isRunClosed } from '../../fleet/runWords';
import { SessionLine } from '../../fleet/SessionLine';
import { markAllSeenLabel, useMarkSeen } from '../../fleet/markSeen';
import { OPEN_RUNS, openSession } from '../../fleet/openers';
import {
  statusGroupLabel, statusView, statusViewTotal, type BoxClock, type StatusBox, type StatusGroupId, type StatusViewGroup,
} from '../../fleet/statusGroups';
import { useBoxClock } from '../../fleet/useBoxClock';
import { ackAll, acksSnapshot, subscribeAcks } from '../../lib/seen';
import { matchRoute } from '../../lib/routes';
import { useLocation } from '../../lib/router';
import { rovingStep } from '../../lib/rovingStep';
import { readKey, writeKey } from '../../lib/storage';
import { DESK_QUERY, useMediaQuery } from '../../lib/useMediaQuery';

/** The toggle's per-device memory. */
export const GROUP_MODE_KEY = 'ccrc-fleet-group';

export type GroupMode = 'status' | 'project';

/** The remembered mode: status unless storage says project. Never throws. */
export function loadGroupMode(): GroupMode {
  return readKey(GROUP_MODE_KEY) === 'project' ? 'project' : 'status';
}

/** Through the storage port (`lib/storage.ts`, D-7190): a mode that cannot be saved still applies for this mount. */
function saveGroupMode(mode: GroupMode): void {
  writeKey(GROUP_MODE_KEY, mode);
}

const MODES: readonly { readonly id: GroupMode; readonly label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'project', label: 'Project' },
];

/** The phone's tabs: Needs you, Programmes (Task G3), Done and Working, then All. Labels are the model's. */
type PhoneTab = 'attention' | 'programmes' | 'done' | 'working' | 'all';
const PHONE_TABS: readonly PhoneTab[] = ['attention', 'programmes', 'done', 'working', 'all'];
const tabLabel = (t: PhoneTab): string => (t === 'all' ? 'All' : statusGroupLabel(t));

/** Roving choice over a radiogroup or tablist: an arrow, Home or End picks its target and moves focus there. The step
 *  is `rovingStep`'s (wrapping, a choice that cycles); this is its event half. */
function rovingKey(e: KeyboardEvent<HTMLElement>, at: number, n: number, role: string, pick: (i: number) => void): void {
  const next = rovingStep(e.key, at, n, { wrap: true });
  if (next === null) return;
  e.preventDefault();
  pick(next);
  e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)[next]?.focus();
}

/** The fold key of a status group. */
const foldKey = (id: StatusGroupId): string => `status::${id}`;

/** The view reads no rollup window, so its clock waits on no session. */
const NO_SESSIONS: readonly FleetSession[] = [];

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
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
        <div
          role="radiogroup"
          aria-label="Group sessions by"
          className="ins-toggle flex-auto"
          onKeyDown={(e) => rovingKey(e, MODES.findIndex((m) => m.id === mode), MODES.length, 'radio',
            (i) => choose(MODES[i]!.id))}
        >
          {MODES.map((m) => (
            <Button
              key={m.id}
              variant="ghost"
              role="radio"
              aria-checked={mode === m.id}
              tabIndex={mode === m.id ? 0 : -1}
              className="ins-toggle-option"
              onClick={() => choose(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
        {desk && mode === 'project' && <ClassChooser className="min-h-row" />}
      </div>
      {mode === 'project'
        ? <ProjectCards selectedId={selectedId} />
        : <StatusTable selectedId={selectedId} phoneTab={desk ? null : tab} onTab={setTab} />}
    </div>
  );
}

/** Project mode: the shared cards under the bucket chips. The cards carry no bucket counts and the screen draws no bar
 *  above a skin's own list, so the chips are drawn here, reading what the screen reads (the chrome store's rows and the
 *  device's acks), once. */
function ProjectCards({ selectedId }: { selectedId: string | null }): ReactNode {
  const useStore = useFleetChrome().store;
  const sessions = useStore((s) => s.sessions);
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  return (
    <>
      <BucketBar sessions={sessions} acks={acks} ackAll={ackAll} />
      <FleetCards selectedId={selectedId} onOpen={openSession} />
    </>
  );
}

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
  const allRuns = useStore((s) => s.runs);
  const activeRuns = useMemo(() => allRuns.filter((r) => !isRunClosed(r)), [allRuns]);
  // Task G1c, G1d (D-7380, D-7373, D-7376): the box clock, the one hook `FleetCards` reads too. `boxNow` is the time read
  // when the clock's `next` last moved, so with the same runs, quiet time and pause no box crosses between two moves of it,
  // and the groups below are rebuilt only at a boundary or with a frame.
  const { boxNow, stallQuietMs, coordPaused } = useBoxClock(useStore, NO_SESSIONS, activeRuns);
  const clock = useMemo((): BoxClock => ({ now: boxNow, quietMs: stallQuietMs, paused: coordPaused }), [boxNow, stallQuietMs, coordPaused]);
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const flows = useFleetFlows();
  const [folded, toggleFold] = useFolded();
  const tabsId = useId();
  // Mark all seen's focus repair and announcement, shared with the bucket chips.
  const { labelRef, note, markSeen } = useMarkSeen(ackAll);

  // Memoised on what each reads (C9, D-6441), and every prop a row is handed is stable, so a one-row frame re-renders
  // that row's `SessionLine` only (`memo`, `lineProps.ts`).
  // The cards the server placed each row on, and their runs: what the project card reads for the same row (its run
  // door, its cross-project chip), so those say the same thing in either mode. The orphan marker asks `keepers` below,
  // not the card's live rows, so it differs from project mode where the header says.
  const cards = useMemo(() => cardsOf(sessions), [sessions]);
  const treeGroups = useMemo(() => fleetTree(sessions, chrome.projects.knownProjects, activeRuns, acks),
    [sessions, chrome.projects.knownProjects, activeRuns, acks]);
  const tree = useMemo(() => new Map<string, FleetTreeGroup>(treeGroups.map((g) => [g.project, g] as const)), [treeGroups]);
  // By id, once per fleet: what `sessions.find` answered, without a scan per row.
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s] as const)), [sessions]);
  const lookup = useCallback((id: string): FleetSession | null => sessionById.get(id) ?? null, [sessionById]);
  const groups = useMemo(() => statusView(sessions, treeGroups, acks, selectedId, lookup, frameSeen, clock),
    [sessions, treeGroups, acks, selectedId, lookup, frameSeen, clock]);
  // Read by key, never compared: the group a key names is the model's answer (instrument-shell's scan).
  const byId = new Map<StatusGroupId, StatusViewGroup>(groups.map((g) => [g.id, g] as const));
  // Where a worker's coordinator is drawn in this view: a box that keeps its workers. The orphan marker asks this in place
  // of the card's live rows, so a worker whose coordinator is gone says so though that coordinator is a row of its card.
  const keepers = useMemo(() => groups.flatMap((g) => g.boxes).filter((b) => !b.gone).map((b) => b.view.coordinator), [groups]);
  const onActions = useCallback((x: FleetSession): void => flows.openActions(x.id), [flows]);

  // A row of a group's list is an `li`; a row inside a box is a `div` (the box is no list), in its programme's hue.
  const row = (s: FleetSession, Tag: 'li' | 'div' = 'li', hue?: ProgHue): ReactNode => {
    const card = tree.get(cards.get(s.id) ?? s.project) ?? null;
    const runs = card?.runs ?? activeRuns;
    const orphan = card === null ? null
      : orphanNote({ kind: 'session', depth: 0, session: s }, card.runs, card.project, keepers, lookup, frameSeen);
    return (
      <Tag key={s.id} data-row={s.id} data-hue={hue} className="ins-row min-h-row">
        <SessionLine
          session={s}
          onOpen={openSession}
          selected={s.id === selectedId}
          onActions={onActions}
          roster={roster}
          projectPool={chrome.projects.poolFor(s.project)}
          onOpenRun={boundOpenRun(runs, s) === null ? null : OPEN_RUNS}
          workingOn={workingOn(s, cards)}
          childRun={childRunContext(s, runs, lookup)}
          coordinator={orphan?.presence ?? null}
          {...(orphan === null ? {} : { coordinatorTitle: orphan.title })}
        />
      </Tag>
    );
  };

  // A programme's box, drawn with the table's own row: its tray is the members that ask, as the model handed them.
  const box = (b: StatusBox): ReactNode => (
    <ProgrammeBox
      key={`box:${b.view.coordinatorId}`}
      view={b.view}
      state={b.state}
      tray={b.tray}
      drawRow={(r, hue) => (r.kind === 'session' ? row(r.session, 'div', hue) : null)}
      drawAbroad={() => null}
      hueOf={(r) => (r.kind === 'session' ? b.hues.get(r.session.id) : undefined)}
      mode={{ folded: 'needs-only', project: b.project }}
    />
  );

  // Needs you drawing anything is held open, whatever is stored (D-6088 rule 5; the model's `held`); every other group
  // follows its fold.
  const isOpen = (g: StatusViewGroup): boolean => g.held || g.folds === folded.has(foldKey(g.id));
  // At a desk and under All, every group that draws something; under a phone tab, that one group, even when empty.
  const shown = phoneTab === null || phoneTab === 'all'
    ? groups.filter((g) => g.count > 0)
    : [byId.get(phoneTab)].filter((g): g is StatusViewGroup => g !== undefined);

  const tabId = (t: PhoneTab): string => `${tabsId}-tab-${t}`;
  const panelId = `${tabsId}-panel`;
  // Five tabs outgrow a phone's row, which scrolls sideways inside itself (instrument.css), so the chosen tab is
  // brought into view whenever it changes, and on the first paint, where it is All, the last.
  useEffect(() => {
    if (phoneTab === null) return;
    document.getElementById(`${tabsId}-tab-${phoneTab}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [phoneTab, tabsId]);
  const body = shown.map((g) => {
    const open = isOpen(g);
    const hold = g.held;
    return (
      <section key={g.id} className="ins-group" data-status-group={g.id} aria-label={g.label}>
        {/* The fold row is a button, so the door beside it is its sibling, never inside it. `BareRow` takes no ref, so
            the focus target is found from the wrapper: the fold row, already focusable, needs no tabIndex. */}
        <div
          className="flex items-center"
          ref={(el) => labelRef(g.id)(el?.querySelector<HTMLElement>('.ins-group-head') ?? null)}
        >
          <BareRow
            className="ins-group-head min-w-0"
            aria-expanded={open}
            aria-disabled={hold ? true : undefined}
            onClick={() => { if (!hold) toggleFold(foldKey(g.id)); }}
          >
            <span className="ins-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span className="ins-group-word">{g.label}</span>
            <span className="ins-group-count"> · {g.count}</span>
            {g.unseen > 0 && (
              <>
                {/* Read, not hidden: the fold row's name is its content, and without this "3" and "4 new" run into "34 new". */}
                <span className="ins-group-count"> · </span>
                <CountBadge aria-label={`${g.unseen} new`}>{g.unseen} new</CountBadge>
              </>
            )}
            {hold && <span className="sr-only">held open: a question here is waiting on you</span>}
          </BareRow>
          {g.unseen > 0 && (
            // The group is IN the name, as the chips' is: three badged groups are not three buttons named alike.
            <Button
              variant="ghost"
              size="fit"
              className="ins-group-seen shrink-0"
              aria-label={markAllSeenLabel(g.id)}
              onClick={() => markSeen(g.id, g.seen, g.unseen)}
            >
              Mark all seen
            </Button>
          )}
        </div>
        {open && g.boxes.map(box)}
        {open && g.sessions.length > 0 && <ul className="ins-rows">{g.sessions.map((s) => row(s))}</ul>}
      </section>
    );
  });

  // Outside the control that unmounts, so the update it reports is not the one that removes it.
  const announce = <div className="sr-only" role="status">{note}</div>;
  if (phoneTab === null) return <>{body}{announce}</>;
  return (
    <>
      <div
        role="tablist"
        aria-label="Sessions by status"
        className="ins-tabs"
        onKeyDown={(e) => rovingKey(e, PHONE_TABS.indexOf(phoneTab), PHONE_TABS.length, 'tab',
          (i) => onTab(PHONE_TABS[i]!))}
      >
        {PHONE_TABS.map((t) => {
          const count = t === 'all' ? statusViewTotal(groups) : byId.get(t)?.count ?? 0;
          return (
            <Button
              key={t}
              id={tabId(t)}
              variant="ghost"
              role="tab"
              aria-selected={phoneTab === t}
              aria-controls={panelId}
              tabIndex={phoneTab === t ? 0 : -1}
              className="ins-tab"
              onClick={() => onTab(t)}
            >
              {tabLabel(t)}
              <span className="ins-tab-count"> {count}</span>
            </Button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(phoneTab)} className="ins-panel">{body}</div>
      {announce}
    </>
  );
}
