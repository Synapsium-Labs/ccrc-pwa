// A project's card. ALWAYS a card, at every session count — a project holding
// one renders exactly like a project holding five.
//
// ProjectGroup showed a header only at two-or-more members, and the live fleet
// is nine sessions across nine distinct projects: the header rendered nowhere,
// so the strongest element on screen was a session while the thing a reader
// navigates by had no container. Making the project the container also removes
// an ambiguity — ProjectGroup titled a lone card on `project` and a grouped one
// on the workspace, so the same component meant two things depending on a
// sibling count.
//
// Fold state is passed IN, never owned here: FleetScreen holds it (foldState.ts)
// so it survives navigation, and a pure card is what lets a test assert folding
// without touching localStorage.
//
// MEMOISED (C9, D-6441): `ProjectCard` is `memo(…, sameCardProps)`, so a list that hands it the same props draws
// nothing; `placement` compares by value (`lineProps.ts`). It reads no clock of its own: a spawning dispatch's readout
// (`PendingSpawn`) and the folded header's "active … ago" (`ProjectCardHead`'s `LastActive`) each tick themselves.
//
// PROGRAMME BOXES (Task G2): a coordinator's open work is one box (`ProgrammeBox`), drawn first, most urgent first;
// the workers of programmes elsewhere and the rows in no programme follow under their sub-headings. The decision is
// `programmeBoxes.ts`'s; this maps over it with the one row renderer below. A box's movement readout ticks itself.
import { Fragment, memo } from 'react';
import type { ReactNode } from 'react';
import { BareRow, Button, useNow } from '@ccrc/ui';
import type {
  DelegationActivityWire, FleetSession, ProjectedHome, ProjectPoolWire, ProjectPoolsWire, RosterWire, RunSummary,
} from '../../../shared/api';
import { orphanNote, type OrphanNote } from './orphanWords';
import { addWorkspaceLabel, poolOfPlacement, type ProjectPlacementRead } from './placementWords';
import { formatElapsed } from './formatReset';
import { releasedByProgramme, type FleetGroup } from './groupFleet';
import { archivableReleased } from './archiveReleased';
import { fleetRowKey, nestFleet, type DelegationGroupKind, type FleetRow } from './nestFleet';
import { childRunContext, workingOnCard, type FleetTreeGroup } from './fleetTree';
import { ProjectCardHead } from './ProjectCardHead';
import type { CardRollup, RolledRow } from './rollup';
import { CROSSING_GLYPH, DISPATCH_GLYPH, boundOpenRun, dispatchWindow, waveLabel } from './runWords';
import {
  cardAbroad, cardBoxes, fleetHues, foldedCard, rowRun, trayOf, type BoxState, type ProgHue, type ProgrammeBoxView, type SummaryRow,
} from './programmeBoxes';
import { ProgrammeBox } from './ProgrammeBox';
import { SessionLine, WorksOnChip } from './SessionLine';
import { sameCardProps } from './lineProps';
import { OPEN_RUNS } from './openers';
import { sessionLabel } from './sessionLabel';
import { GROUP_WORDS, activityLine, creatorChip, inferredChip, unownedLine, worktreeLine } from './delegationWords';
import { actionDoor } from '../command/door';
import './fleet.css';

/** The nesting prefix, spelled ONCE (Task 4). Both branches that can draw a
 *  child — a settled session row and a spawn that has none yet — read it from
 *  here, so the tree cannot end up drawn with two different glyphs, and
 *  project-card.test.tsx asserts against the constant rather than a literal it
 *  would have to keep in step by hand. */
export const NEST_BRACKET = '└─';

/** The line for a child that does not exist yet: a run whose `ws-add` is in
 *  flight, or one whose dispatch never came back.
 *
 *  The DECISION that this row belongs here at all is `nestFleet`'s, and the
 *  three-way phase is `dispatchWindow`'s (Task 3) — this picks words, the same
 *  division `RunsScreen`'s own row already follows. Two cues on both branches,
 *  a word and a glyph, so neither is read out of colour.
 *
 *  The two sentences are this SURFACE's own, not copies of the board's. On
 *  /runs the row IS the run, so it says "dispatching…"; on the fleet card it is
 *  a phantom child under the coordinator that asked for it, so it says what is
 *  being spawned. And the wedge stops at "spawn never completed" here rather
 *  than adding the board's "a workspace may exist" — this card is the list of
 *  workspaces, so if one exists the operator is already looking at it. */
/** What the chip says when the fleet host's `ccd` has no pool machinery yet
 *  (`enforcement: 'unavailable'`). Hand-written tags still display, but nothing
 *  on the fleet is enforcing them, so the chip stops being a control.
 *
 *  Exported so the suite pins the sentence rather than a paraphrase of it. */
export const POOL_UNAVAILABLE_TEXT = 'fleet ccd predates pools';

function PendingSpawn({ run, nowMs }: { run: RunSummary; nowMs: number | undefined }): ReactNode {
  // The readout's own clock (C9, D-6441), to the second, while it is drawn; a test passes its clock instead. Only this
  // leaf re-renders each second, never its card or the card's rows.
  const tick = useNow(1_000, nowMs === undefined);
  const spawn = dispatchWindow(run, nowMs ?? tick);
  // Unreachable by construction — `nestFleet` emits this row only for a run
  // `dispatchWindow` has already answered non-`none` for, and THAT half of its
  // answer never reads the clock (`isDispatchPending`'s docstring). Handled
  // rather than asserted away with a `!`: a renderer that insists on a shape
  // it was handed is exactly where a NaN clock gets in.
  if (spawn.phase === 'none') return null;
  return (
    <div className="proj-pending" data-phase={spawn.phase}>
      <span className="proj-pending-glyph" aria-hidden="true">{DISPATCH_GLYPH[spawn.phase]}</span>
      <span className="proj-pending-meta">
        <span className="proj-pending-word">
          {spawn.phase === 'stalled' ? 'spawn never completed' : 'spawning a worker'}
        </span>
        <span className="proj-pending-program">{run.program}</span>
        <span className="proj-pending-elapsed">{formatElapsed(spawn.elapsedMs)}</span>
      </span>
    </div>
  );
}


function ProjectCardView({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected,
  placement = { kind: 'legacy' },
  adding = false,
  collapsed: collapsedProp = false,
  onToggle,
  onActions,
  archivedOpen = false,
  releasedOpen = false,
  onArchiveReleased,
  archivingReleased = false,
  roster = [],
  pools = null,
  onPool,
  runs = [],
  abroad = [],
  poolFor = () => null,
  nowMs,
  boxNow,
  stallQuietMs = null,
  coordPaused = false,
  coordOf = () => null,
  frameSeen = false,
  rollup,
  onToggleChildren,
  offlineOpen = false,
  unownedOpen = false,
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  /** The card fires `onAddWorkspace(project)` — nothing about a route lives
   *  here. Whether the resulting request carries one is FleetScreen's
   *  decision, made in its class chooser's closure before this callback is
   *  invoked (routing slice 5, Task 6): with the chooser left on
   *  "Coordinator row" the request is byte-identical to before this task;
   *  any other choice seeds `{ class }` on the wire. This card neither knows
   *  nor needs to know which. */
  onAddWorkspace?: (project: string) => void;
  /** Where a new workspace would land, as the SERVER projects it (limits.ts
   *  `projectHome`, itself a mirror of ccd's `_ws_least_loaded`). Never
   *  recomputed here — a third copy of the routing rule would drift from both.
   *  `undefined` until the first /api/accounts poll lands (or while every poll
   *  since has failed) — the `+` never waits on it. `null` is a DIFFERENT
   *  fact: the poll landed and the server genuinely has nothing to project
   *  (every home-able lane disabled) — collapsing the two would let "I don't
   *  know yet" and "the fleet says no" render the identical claim. */
  projected?: ProjectedHome | null;
  /** The matching `/api/projects` row's server-computed placement, with every
   *  way that read can be unavailable kept explicit. */
  placement?: ProjectPlacementRead;
  /** This project's own ws-add is in flight. ccd DOES serialise concurrent
   *  ws-adds per project now (a `flock -n` in `cmd_ws_add`, refusing with
   *  `busy: …`), so this is a courtesy that saves a round trip — see
   *  `FleetScreen`'s own note for the full argument. The spawn window is
   *  bounded at SPAWN_SETTLE_S. */
  adding?: boolean;
  collapsed?: boolean;
  onToggle?: (project: string) => void;
  onActions: (session: FleetSession) => void;
  /** Whether the `Archived (n)` sub-fold is expanded. Inverted against
   *  `collapsed`: `foldState.ts` stores what is COLLAPSED (absent means
   *  open), which is right for a project and wrong for an archive fold that
   *  must start closed — under the composite `<project>::archived` key,
   *  presence means EXPANDED. */
  archivedOpen?: boolean;
  /** Whether the `Released (n)` sub-fold is expanded — `archivedOpen`'s inversion, under the composite
   *  `<project>::released` key (workspace lifecycle spec §5.1). */
  releasedOpen?: boolean;
  /** "Archive all" in the Released fold. The card only asks: `FleetScreen` confirms, then runs the plain-archive
   *  loop (`archiveReleased.ts`). Without it the fold renders with no button. */
  onArchiveReleased?: (project: string) => void;
  /** That loop is running for this card — the button is disabled rather than queued twice. */
  archivingReleased?: boolean;
  /** The account roster (`stores/fleet.ts`'s `roster`, read by `FleetScreen`
   *  and threaded down) — defaults to `[]` so a card rendered before the
   *  first poll lands degrades to the same raw-name/neutral-ink fallback
   *  `accountLabel`/`accountColorVar` already carry for an unknown wrapper. */
  roster?: readonly RosterWire[];
  /** The fleet-level pool frame supplies enforcement capability only. Pool and
   *  placement come together from `ProjectPlacementRead` after the route lands. */
  pools?: ProjectPoolsWire | null;
  /** Open the pool sheet for this project. Without it, the chip remains an
   *  inert statement rather than a control with nowhere to go. */
  onPool?: (project: string) => void;
  /** THIS project's ACTIVE runs (Task 4) — the programme edges the body's tree
   *  is drawn from, scoped and filtered by `FleetScreen`, which owns the store
   *  read. Defaults to `[]` so a card rendered before any `{type:'runs'}` frame
   *  has landed — or by a test that is not about the tree — renders the flat
   *  list it always did. */
  runs?: readonly RunSummary[];
  /** The runs whose programme is HOMED in this project and whose work is
   *  happening somewhere else (spec §3 F4). A SECOND, additive list, and never
   *  merged into `runs`: `runs` is what the tree is drawn from and every one of
   *  its members belongs to this card's project by construction, while every
   *  member of this list belongs to another card by the same construction.
   *  Merging them would put a phantom child under a coordinator for a workspace
   *  that is not in this repo. Computed by `FleetScreen`, which owns the store
   *  read, for the same reason `runs` is: a card handed one session list cannot
   *  answer a question about other projects' runs. Defaults to `[]`, so every
   *  caller and every test that predates this renders exactly as it did. */
  abroad?: readonly RunSummary[];
  /** A row's OWN project's pool (Task 4 fix round 1) — for a row the key flip
   *  moved onto this card, `s.project` is by construction a DIFFERENT project
   *  from `group.project`, so this card's own `placement`/`pool` (one
   *  `/api/projects` read, for `group.project` alone) is the wrong shape to
   *  judge it against: a false off-pool warning when the destination is
   *  tagged differently from the row's real project, and a swallowed warning
   *  when the destination is untagged while the row's own project is tagged.
   *  Defaults to `() => null` — the same "unmeasured, no account claim"
   *  degrade `placementFor` itself uses — so a card rendered before `FleetScreen`
   *  passes this, or a test that predates the fix, keeps every row on the
   *  card's own project (the common case) rendering exactly as before. */
  poolFor?: (project: string) => ProjectPoolWire | null;
  /** A test's clock, in MILLISECONDS, for the pending child's elapsed readout and the folded header's "active … ago".
   *  Absent in the app (C9, D-6441): each of those leaves then ticks its own clock (`PendingSpawn` each second while a
   *  spawn is drawn, `LastActive` each half minute), so the card itself never re-renders for the time. */
  nowMs?: number;
  /** Task G1b (D-7380): the time the programme boxes' states are read at, `FleetCards`' rollup clock as its `next` last
   *  moved (`nextStallBoundary` wakes it when a box crosses its threshold). Absent, no box reads stalled. */
  boxNow?: number;
  /** The stall watch's quiet time, off the runs frame (`stores/fleet.ts`'s one read, D-7376); null, no box stalls. */
  stallQuietMs?: number | null;
  /** The operator's pause, off the coord frame (D-7373): a box reads paused, never stalled. */
  coordPaused?: boolean;
  /** The coordinator session by id, looked up FLEET-WIDE — it may sit on
   *  another card, in an archive fold, or nowhere this pass. Feeds
   *  `coordinatorPresence`, the same read the runs board uses (D-1129, D-7181);
   *  `null` there reads as `unknown`, never as dead. Default: nothing known. */
  coordOf?: (id: string) => FleetSession | null;
  /** `stores/fleet.ts`'s `fleetFrameSeen`: without it a coordinator absent from
   *  a STALE array would read as gone (D-1138). Default false = unknown. */
  frameSeen?: boolean;
  /** D-6088: this card's rollup (`rollup.ts`), the one answer both skins' lists draw. When given, it decides the
   *  fold and the body's rows (a coordinator's folded workers, drawn as its programme box's tray and footer, Task G2);
   *  without it the card draws its tree's rows and the `collapsed` it was handed, as before. */
  rollup?: CardRollup;
  /** Open or close a coordinator's worker line, by the coordinator's id. */
  onToggleChildren?: (parentId: string) => void;
  /** Whether the delegation broker's "Offline coordinator" and "Unowned work" groups are expanded (wave 4). The
   *  `archivedOpen` inversion: under `<project>::offline-coordinator` and `<project>::unowned`, presence means EXPANDED,
   *  so both start closed. */
  offlineOpen?: boolean;
  unownedOpen?: boolean;
}): ReactNode {
  const collapsed = rollup?.collapsed ?? collapsedProp;
  // A measured row carries pool and placement from one `/api/projects` read.
  // Only a legacy row's forecast falls back to the global projection; no row
  // reads a pool value from the independently paced websocket frame.
  const pool = poolOfPlacement(placement);
  const poolDim = pools?.enforcement === 'unavailable';

  // Task 4 fix round 1: a row belonging to THIS card's own project keeps
  // today's behaviour byte-for-byte (`pool`, from `group.project`'s own
  // placement read). A row the key flip moved here belongs to a different
  // project — its off-pool judgment has to ask `poolFor` about THAT project,
  // never this card's.
  const poolOf = (s: FleetSession): ProjectPoolWire | null =>
    s.project === group.project ? pool : poolFor(s.project);

  // The add control's whole sentence — the forecast, the headroom, and every
  // way a read can have no answer — is `addWorkspaceLabel`'s, beside the type
  // it branches on (`placementWords.ts`).
  const addLabel = addWorkspaceLabel(group.project, placement, projected, roster);

  // Status never owns the card's perimeter except for attention (the one state
  // that asks the reader to ACT). Busy lost it: on a one-session project the
  // rollup was a strict duplicate of the row's own lamp + word, and green on a
  // frame was being read as "selected".
  const cardClass = 'proj-card' + (group.attention ? ' proj-card--attention' : '');

  // Selection is a fact about the reader, not about the project, so it never
  // touches the perimeter — but a fold can hide it exactly as it can hide a
  // pending dialog, so the header carries it (as the slab, at chip scale)
  // while folded. This is the card's only read of selectedId that decides the CARD's own mark; the Released fold
  // reads it too (`selectionInReleased`, `releasedShown`, below), and each row compares it to mark itself selected.
  // A Released row is out of `group.sessions` (it sits in its own fold), so the fold's rows count too.
  const holdsSelection =
    collapsed && selectedId !== null &&
    (group.sessions.some((s) => s.id === selectedId) || group.released.some((s) => s.id === selectedId));

  // Task 4. The tree's SHAPE is decided once, away from here (`nestFleet`, five
  // rules, one unit suite); this component maps over the answer and draws a
  // depth as a bracket plus an indent. Top-level order is `group.sessions`
  // verbatim — a child is lifted out of it and put back under its parent, and
  // nothing else moves.
  // D-5527: the fleet tree's rows when the caller built them (`fleetTree`, the
  // one model both skins read); a caller that hands a bare group still gets
  // `nestFleet` over the same two inputs, which is the identical answer.
  const tree: readonly FleetRow[] = 'rows' in group ? (group as FleetTreeGroup).rows : nestFleet(group.sessions, runs);
  const rows: readonly RolledRow[] = rollup?.rows ?? tree;
  // Task G2: the boxes, over the tree's rows and every open run this card can know of — those whose worker renders
  // here, and those a session here claims (`fleetTree`'s `claimed`). The fold of each box's tray is the rollup's.
  const claimed = 'claimed' in group ? (group as FleetTreeGroup).claimed : [];
  const boxRuns = claimed.length === 0 ? runs : [...runs, ...claimed];
  // The fleet's hue map, this card's entries (`fleetTree`). A group drawn without the tree has no fleet to read, so its
  // own runs are the whole of what it knows.
  const hues = 'hues' in group ? (group as FleetTreeGroup).hues : fleetHues(boxRuns);
  // Task G1b: the moves (`runLastMove`, the one reader), the stall watch's threshold, the pause and the list's clock, in
  // the one composition the list's view hold counts too (`cardBoxes`).
  const { prog, ranked } = cardBoxes(tree, runs, claimed, hues, boxNow ?? null, stallQuietMs, coordPaused);
  const folded = collapsed ? foldedCard(ranked, prog.elsewhere, prog.lone) : null;
  const shownAbroad = cardAbroad(abroad, prog.boxes);
  const rowKey = fleetRowKey;
  // R9 (delegation broker wave 4): each session row's attached activities, by session id, off the tree's own rows.
  const delegatedOf = new Map(tree.flatMap((r) =>
    (r.kind === 'session' && r.delegated !== undefined ? [[r.session.id, r.delegated] as const] : [])));
  // Delegation broker wave 4: a group's members render only while the operator holds it open; the header always does.
  const groupOpen: Readonly<Record<DelegationGroupKind, boolean>> = { 'offline-coordinator': offlineOpen, unowned: unownedOpen };
  const memberOf = (row: RolledRow): DelegationGroupKind | null =>
    row.kind === 'activity' || row.kind === 'lease' || row.kind === 'unowned' ? row.group : null;
  const shown = (row: RolledRow): boolean => { const g = memberOf(row); return g === null || groupOpen[g]; };
  // A row outside a box (a worker of a programme elsewhere, a row in no programme, a delegation group) draws its
  // children as the rollup folded them (`foldChildren`): its own segment of the rolled rows, a closed group's members
  // left out. A box's children are its tray (`trayOf`); this is the same read for every other head.
  const freeRows = (list: readonly FleetRow[]): RolledRow[] => {
    const out: RolledRow[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const head = list[i]!;
      if (head.depth !== 0) continue;
      let end = i + 1;
      while (end < list.length && list[end]!.depth === 1) end += 1;
      const at = rows.findIndex((r) => r.depth === 0 && fleetRowKey(r) === fleetRowKey(head));
      const kids: RolledRow[] = [];
      if (at < 0) kids.push(...list.slice(i + 1, end));
      else for (let k = at + 1; k < rows.length && rows[k]!.depth === 1; k += 1) kids.push(rows[k]!);
      out.push(head, ...kids.filter(shown));
    }
    return out;
  };
  // A worktree's `via` worker by its display name, or its raw id when the fleet does not carry it.
  const viaLabel = (id: string | null): string | null => {
    if (id === null) return null;
    const s = coordOf(id);
    return s === null ? id : sessionLabel(s);
  };
  // Task 5: the hold reason's door, decided HERE because this is the level that
  // holds the runs. `boundOpenRun` answers off the wire's binding and the run
  // rows — never by reading the id out of the hold string, which stays
  // display-only (its docstring carries the measurement). `null` when the board
  // has no row for this session's open bound run, and `SessionLine` renders
  // exactly the inert cell it always did for
  // that, so a hand hold and a hold outliving its run both read as text.
  //
  // `/runs` unfocused, because there is no per-run route to focus
  // (`ArchiveConflictSheet`'s own note names that as the first of the three
  // things such a link would need). The board groups by programme and the cell
  // names the programme, so the operator lands looking at the right group.
  // `OPEN_RUNS`, one module constant (C9), so a memo'd line is handed the same door on every render.
  const openRunFor = (session: FleetSession): (() => void) | null =>
    boundOpenRun(runs, session) === null ? null : OPEN_RUNS;

  // The orphaned worker's marker and every ruling about when it stays silent:
  // `orphanWords.ts`. Bound here to this card's own runs, project and LIVE
  // rows — never `group.archived`, which is this card's rows too but not its
  // live ones.
  const noteFor = (row: FleetRow): OrphanNote | null =>
    orphanNote(row, runs, group.project, group.sessions, coordOf, frameSeen);

  // Spec §6's repo label left the row in D-5545: a row whose project differs from this card's carries the
  // cross-project chip (D-5527), which keeps two same-slug rows' accessible names apart, and the session header
  // names the repository (`SessionScreen`'s `repo`). The card is a glance; the header holds the rest.
  // "Archive all" sends only folded rows that are not children (`archiveReleased.ts`); the rest are named.
  const releasedArchivable = group.released.filter(archivableReleased).length;
  const releasedChildren = group.released.length - releasedArchivable;
  // A release is not the operator's own act (an archive is), so the row being READ must not vanish into a closed
  // fold when its run closes. While the fold holds the selection it does two things: it shows itself, and its toggle
  // is disabled — a tap could not collapse it, only silently invert the stored `<project>::released` key.
  const selectionInReleased = selectedId !== null && group.released.some((s) => s.id === selectedId);
  const releasedShown = releasedOpen || selectionInReleased;

  /** ONE spelling of this card's eight-prop `SessionLine` call. It was
   *  written out three times — here, in the released fold and in the archived
   *  fold — which is three places that have to agree about what a row on THIS
   *  card knows: its pool, its run door and whether its repo needs saying. */
  const line = (
    s: FleetSession, note: OrphanNote | null = null, delegated?: readonly DelegationActivityWire[],
  ): ReactNode => (
    <SessionLine
      key={s.id}
      session={s}
      onOpen={onOpen}
      selected={s.id === selectedId}
      onActions={onActions}
      roster={roster}
      projectPool={poolOf(s)}
      onOpenRun={openRunFor(s)}
      workingOn={workingOnCard(s, group.project)}
      childRun={childRunContext(s, runs, coordOf)}
      coordinator={note?.presence ?? null}
      {...(note === null ? {} : { coordinatorTitle: note.title })}
      {...(delegated === undefined ? {} : { delegated })}
    />
  );

  // Task G2: a coordinator's folded workers are its programme box's footer now (`ProgrammeBox`), so a body row is a
  // session, a spawn or a delegation row (wave 4); the rollup's summary row is read only as that footer's state
  // (`trayOf`), or, for a head outside a box, as its own line (`summaryLine`).
  /** A delegation row's words, each a cell of one line (delegation broker wave 4). `delegationWords.ts` spells them. */
  const workLine = (parts: readonly string[], title: string, tail: ReactNode = null): ReactNode => (
    <div className="proj-work" title={title}>
      <span className="proj-work-parts">
        {parts.map((p, i) => <span key={i} className="proj-work-part">{p}</span>)}
      </span>
      {tail}
    </div>
  );

  const rowBody = (row: FleetRow): ReactNode => {
    if (row.kind === 'activity') {
      const a = activityLine(row.activity);
      return workLine(a.parts, a.title);
    }
    if (row.kind === 'lease') {
      const w = worktreeLine(row.lease, viaLabel(row.via), workingOnCard({ project: row.lease.project }, group.project));
      // D-6999: the chips are words, never colour alone, and nothing here acts on the row.
      const chips = [inferredChip(row.lease), creatorChip(row.lease)];
      return workLine(w.parts, w.title, <>
        {w.sourceProject !== null && <WorksOnChip project={w.sourceProject} />}
        {chips.map((c, i) => c === null ? null : <span key={i} className="proj-work-chip" title={c.title}>{c.text}</span>)}
      </>);
    }
    if (row.kind === 'unowned') {
      const u = unownedLine(row.item);
      return workLine(u.parts, u.title);
    }
    if (row.kind === 'delegation-group') {
      const open = groupOpen[row.group];
      return (
        <BareRow
          className="proj-group-toggle"
          aria-expanded={open}
          title={GROUP_WORDS[row.group].title}
          onClick={() => onToggle?.(`${group.project}::${row.group}`)}
        >
          <span className="proj-card-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
          {`${GROUP_WORDS[row.group].label} (${row.count})`}
        </BareRow>
      );
    }
    // R9: the chip rides the row `nestFleet` attached it to; a box draws its coordinator's row itself, so that row's
    // activities are read back off the tree by id.
    return row.kind === 'session' ? line(row.session, noteFor(row), row.delegated ?? delegatedOf.get(row.session.id))
      : <PendingSpawn run={row.run} nowMs={nowMs} />;
  };

  /** D-6088 rule 6 outside a box (delegation broker wave 4): a head's folded children as one line, the Released
   *  fold's disclosure in the row's place. A box's own fold is its footer (`ProgrammeBox`). */
  const summaryLine = (row: SummaryRow): ReactNode => (
    <div key={`workers:${row.parentId}`} className="proj-nest" data-depth={row.depth}>
      <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
      <BareRow
        className="proj-children-toggle"
        aria-expanded={row.expanded}
        onClick={() => onToggleChildren?.(row.parentId)}
      >
        <span className="proj-card-chevron" aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>
        {/* D-6088: each count unbreakable, so a narrow column wraps only between counts; `needs you` in its ink. */}
        <span className="proj-children-parts">
          {row.parts.map((p, i) => (
            <Fragment key={p.word}>
              {i > 0 && ' · '}
              <span className={`proj-children-part${p.word === 'needs you' ? ' proj-children-part--needs-you' : ''}`}>
                {`${p.n} ${p.word}`}
              </span>
            </Fragment>
          ))}
        </span>
      </BareRow>
    </div>
  );
  /** A free row (`freeRows`) as the card draws it: the summary line, or the one body row spelling. */
  const freeRow = (row: RolledRow, hue?: ProgHue): ReactNode => (row.kind === 'summary' ? summaryLine(row) : nested(row, hue));

  // ONE spelling of a body row: a depth-0 row exactly as it shipped before the tree existed (a Fragment, no wrapper),
  // a depth-1 row under its bracket, in its programme's hue when it sits in a box's tray.
  const nested = (row: FleetRow, hue?: ProgHue): ReactNode => (
    row.depth === 0 ? (
      // A Fragment, never a wrapper element: the top-level row's DOM stays byte-identical to the one that
      // shipped before the tree existed, and `.proj-card-body`'s column flex lays out its children directly.
      <Fragment key={rowKey(row)}>{rowBody(row)}</Fragment>
    ) : (
      <div key={rowKey(row)} className="proj-nest" data-depth={row.depth} data-hue={hue}>
        <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
        {rowBody(row)}
      </div>
    )
  );
  const abroadLine = (r: RunSummary): ReactNode => (
    <span key={r.id} className="proj-abroad-line">
      <span className="proj-abroad-glyph" aria-hidden="true">{CROSSING_GLYPH}</span>
      {`${r.program} ${waveLabel(r)} in ${r.project}`}
    </span>
  );
  const hueOf = (row: FleetRow): ProgHue | undefined => prog.hues.get(rowRun(row, boxRuns)?.program ?? '');
  const box = ({ view, state }: { view: ProgrammeBoxView; state: BoxState }): ReactNode => (
    <ProgrammeBox
      key={`box:${view.coordinatorId}`}
      view={view}
      state={state}
      tray={trayOf(rows, view.coordinatorId)}
      drawRow={nested}
      drawAbroad={abroadLine}
      hueOf={hueOf}
      onToggleChildren={onToggleChildren}
      nowMs={nowMs}
    />
  );
  // The sub-headings say something only beside a programme: a card with none draws its rows exactly as before.
  const headed = prog.boxes.length > 0 || prog.elsewhere.length > 0;

  return (
    <section
      className={cardClass}
      data-collapsed={collapsed || undefined}
      data-holds-selection={holdsSelection || undefined}
    >
        <ProjectCardHead
          group={group}
          collapsed={collapsed}
          onToggle={onToggle}
          roster={roster}
          pool={pool}
          poolDim={poolDim}
          onPool={onPool}
          onAddWorkspace={onAddWorkspace}
          addLabel={addLabel}
          adding={adding}
          lastActive={rollup?.lastActive ?? null}
          now={nowMs}
          pinnedOpen={rollup?.pinnedOpen ?? false}
        />

      {!collapsed && (
        <div className="proj-card-body">
          {/* A depth-0 row renders EXACTLY as it did before this task — no
              wrapper, no prefix. The bracket is not decoration that happens to
              be invisible at the top level: a prefix on every row would say
              nothing, which is the whole reason the card can afford one at
              all. `aria-hidden` on the glyph because it is the picture of an
              edge, not a fact the row does not already carry. */}
          {/* D-5545: an orphaned worker's marker rides ITS ROW now — "coordinator gone" as the row's one
              attention marker (`orphanNote`'s presence, `SessionLine`'s `coordinator`) — instead of a second
              line under it that repeated the row's programme and wave. */}
          {ranked.map(box)}
          {prog.elsewhere.length > 0 && (
            <>
              <div className="pg-sub">Workers of programmes elsewhere</div>
              <div className="pg-elsewhere">
                {freeRows(prog.elsewhere).map((row) => (row.kind === 'summary' ? summaryLine(row) : (
                  <div key={rowKey(row)} className="pg-far" data-hue={hueOf(row)}>{nested(row)}</div>
                )))}
              </div>
            </>
          )}
          {headed && prog.lone.length > 0 && <div className="pg-sub">Not in a programme</div>}
          {freeRows(prog.lone).map((row) => freeRow(row))}
          {shownAbroad.length > 0 && <div className="proj-abroad">{shownAbroad.map(abroadLine)}</div>}
          {group.elsewhere.length > 0 && (
            /* Spec §6: an emptied card says where its work went, as PLAIN TEXT —
               never a link. A tappable route here would be the second access
               path R2 excludes, the same reason the abroad line above is a bare
               span with no onClick. */
            <div className="proj-elsewhere">
              {group.elsewhere.map((e) => (
                <span key={e.project} className="proj-elsewhere-line">
                  {`${e.count} ${e.count === 1 ? 'workspace' : 'workspaces'} under ${e.project}`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {folded !== null && folded.keep.length > 0 && (
        /* Spec §2.3: a folded card keeps a box that needs the operator or has stalled, and counts the rest. */
        <div className="proj-card-body">
          {folded.keep.map(box)}
          {folded.more > 0 && <div className="pg-more">{`${folded.more} more in this project`}</div>}
        </div>
      )}

      {!collapsed && group.released.length > 0 && (
        /* Workspace lifecycle spec §5.1: the transition zone. A programme is done with these rows; they wait
           here to be archived. Folded, never hidden, and above `Archived (N)`, which is where they go next. */
        <div className="proj-released">
          <BareRow
            className="proj-released-toggle"
            aria-expanded={releasedShown}
            disabled={selectionInReleased}
            onClick={() => onToggle?.(`${group.project}::released`)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{releasedShown ? '▾' : '▸'}</span>
            Released ({group.released.length})
          </BareRow>
          {releasedShown && (
            <div className="proj-released-body">
              {releasedByProgramme(group.released).map((p) => (
                <div key={p.program} className="proj-released-programme">
                  <div className="proj-released-heading">
                    {p.title !== null && p.title !== p.program ? `${p.program} · ${p.title}` : p.program}
                  </div>
                  {p.sessions.map((s) => line(s))}
                </div>
              ))}
              {onArchiveReleased !== undefined && releasedArchivable > 0 && (
                <Button
                  variant="ghost"
                  className="proj-released-archive"
                  disabled={archivingReleased}
                  // Every card carries this button, so its accessible name says WHICH card's rows it archives.
                  aria-label={archivingReleased
                    ? `Archiving released workspaces in ${group.project}`
                    : `Archive all ${releasedArchivable} released ${releasedArchivable === 1 ? 'workspace' : 'workspaces'} in ${group.project}`}
                  {...actionDoor('archive-all', () => onArchiveReleased(group.project))}
                >
                  {archivingReleased ? 'Archiving…' : `Archive all (${releasedArchivable})`}
                </Button>
              )}
              {releasedChildren > 0 && (
                <span className="proj-released-note">
                  {`Archive all skips ${releasedChildren} child ${releasedChildren === 1 ? 'workspace' : 'workspaces'}.`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && group.archived.length > 0 && (
        <div className="proj-archived">
          {/* Folded, never hidden: the transcript still renders at /s/<id>, so
              a card that omitted these would leave them reachable only by a
              URL nobody has. Collapsed by default — archived rows are context,
              not the fleet. */}
          <BareRow
            className="proj-archived-toggle"
            aria-expanded={archivedOpen}
            onClick={() => onToggle?.(`${group.project}::archived`)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{archivedOpen ? '▾' : '▸'}</span>
            Archived ({group.archived.length})
          </BareRow>
          {archivedOpen && (
            <div className="proj-archived-body">
              {group.archived.map((s) => line(s))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The card, memo'd (C9, D-6441): every prop by identity but `placement`, by value (`sameCardProps`). */
export const ProjectCard = memo(ProjectCardView, sameCardProps);
