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
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, ProjectedHome, ProjectPlacement, ProjectPoolWire, ProjectPoolsWire, ProjectRepoWire, RosterWire, RunSummary } from '../../../shared/api';
import { repoLabel } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { poolLabelList } from '../lib/pools';
import { navigate } from '../lib/router';
import { coordPresence, type CoordPresence } from './coordWords';
import { formatElapsed } from './formatReset';
import type { FleetGroup, FleetPin } from './groupFleet';
import { nestFleet, type FleetRow } from './nestFleet';
import { CROSSING_GLYPH, DISPATCH_GLYPH, crossingNote, dispatchWindow, runForSession, waveLabel } from './runWords';
import { SessionLine } from './SessionLine';
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

/** One project's authoritative placement read. Request state, row absence and
 *  legacy omission stay distinct so the card never turns ignorance into a
 *  per-account claim. */
export type ProjectPlacementRead =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'missing' }
  | { kind: 'legacy' }
  | { kind: 'measured'; pool: ProjectPoolWire; placement: ProjectPlacement };

/** The project's measured route pool as one chip. A non-measured read yields
 *  no pool and therefore no chip. Unrecognised residue means this app is older
 *  than the fleet, not a tag that can be diagnosed as unreadable or malformed. */
function PoolChip({ pool, project, dim, onTap }: {
  pool: ProjectPoolWire;
  project: string;
  dim: boolean;
  onTap: ((project: string) => void) | undefined;
}): ReactNode {
  const path = `~/.cc-sessions/pools/${project}`;
  const unrecognised = !['tagged', 'untagged', 'malformed', 'unreadable'].includes(pool.state);
  const word =
    pool.state === 'tagged' ? pool.name
    : pool.state === 'untagged' ? 'no pool'
    : pool.state === 'malformed' ? 'pool malformed'
    : pool.state === 'unreadable' ? 'pool unreadable'
    : 'app older than fleet; reload';
  const label =
    pool.state === 'tagged' ? `project pool ${pool.name}`
    : pool.state === 'untagged' ? 'no project pool — any account may serve this project'
    : pool.state === 'malformed' ? `project pool tag is malformed — rewrite ${path} as one pool name`
    : pool.state === 'unreadable' ? `project pool tag could not be read — check permissions on ${path}`
    : 'app bundle is older than the fleet; reload to understand this project pool';
  const dataPool = unrecognised ? 'unrecognised' : pool.state;
  // A span when there is nowhere to go: no handler, a fleet whose ccd would
  // answer 501, or a newer fleet state this app cannot safely edit.
  if (dim || onTap === undefined || unrecognised) {
    return (
      <span
        className="proj-card-pool"
        data-pool={dataPool}
        data-dim={dim || undefined}
        aria-label={label}
        title={dim ? POOL_UNAVAILABLE_TEXT : label}
      >
        {word}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="proj-card-pool"
      data-pool={dataPool}
      aria-label={label}
      title={label}
      onClick={() => onTap(project)}
    >
      {word}
    </button>
  );
}

function PendingSpawn({ run, nowMs }: { run: RunSummary; nowMs: number }): ReactNode {
  const spawn = dispatchWindow(run, nowMs);
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

/** The header's pin chip. Nothing at all on an empty card: `mixed` is a claim
 *  about disagreement, and zero sessions do not disagree (D-3010). */
function PinChip({ pin, roster }: { pin: FleetPin; roster: readonly RosterWire[] }): ReactNode {
  if (pin.state === 'empty') return null;
  if (pin.state === 'mixed') {
    return (
      <span className="proj-card-pin" data-mixed aria-label="pinned accounts differ">mixed</span>
    );
  }
  return (
    <span
      className="proj-card-pin"
      aria-label={`pinned to ${accountLabel(roster, pin.home)}`}
      style={{ color: `var(${accountColorVar(roster, pin.home)})` }}
    >
      {accountLabel(roster, pin.home)}
    </span>
  );
}

export function ProjectCard({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected,
  placement = { kind: 'legacy' },
  adding = false,
  collapsed = false,
  onToggle,
  onActions,
  archivedOpen = false,
  roster = [],
  pools = null,
  onPool,
  runs = [],
  abroad = [],
  poolFor = () => null,
  repoFor = () => undefined,
  nowMs = Date.now(),
  coordOf = () => null,
  frameSeen = false,
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
  /** The repository a project's main checkout was last measured to be, by
   *  name — `FleetScreen`'s lookup over the same `/api/projects` rows that
   *  feed `placement`, absent-key-aware (an older server yields `undefined`).
   *  A displaced row needs ITS OWN project's repo, which is by construction a
   *  different project from this card's, so a one-project `placement` read is
   *  the wrong shape and this is a lookup. Defaults to "nothing measured". */
  repoFor?: (project: string) => ProjectRepoWire | undefined;
  /** The shared tick, in MILLISECONDS, for the pending child's elapsed clock.
   *  This card is pure and controlled (fold state, roster and projection all
   *  arrive the same way), so the CADENCE belongs to `FleetScreen`, which runs
   *  it only while a spawn is actually in flight. The default reads the clock
   *  at render: honest, and it simply stops advancing until the next render —
   *  which is the correct degrade for a card nobody is ticking. */
  nowMs?: number;
  /** The coordinator session by id, looked up FLEET-WIDE — it may sit on
   *  another card, in an archive fold, or nowhere this pass. Feeds
   *  `coordPresence`, the same three-answer read the runs board uses (D-1129);
   *  `null` there reads as `unknown`, never as dead. Default: nothing known. */
  coordOf?: (id: string) => FleetSession | null;
  /** `stores/fleet.ts`'s `fleetFrameSeen`: without it a coordinator absent from
   *  a STALE array would read as gone (D-1138). Default false = unknown. */
  frameSeen?: boolean;
}): ReactNode {
  // A measured row carries pool and placement from one `/api/projects` read.
  // Only a legacy row's forecast falls back to the global projection; no row
  // reads a pool value from the independently paced websocket frame.
  const pool = placement.kind === 'measured' ? placement.pool : null;
  const poolName = pool !== null && pool.state === 'tagged' ? pool.name : null;
  const poolDim = pools?.enforcement === 'unavailable';

  // Task 4 fix round 1: a row belonging to THIS card's own project keeps
  // today's behaviour byte-for-byte (`pool`, from `group.project`'s own
  // placement read). A row the key flip moved here belongs to a different
  // project — its off-pool judgment has to ask `poolFor` about THAT project,
  // never this card's.
  const poolOf = (s: FleetSession): ProjectPoolWire | null =>
    s.project === group.project ? pool : poolFor(s.project);

  // A legacy server's global projection is honest only while no readable tag
  // narrows the project. Pending/failed/missing reads make no account claim.
  const legacySafe = pool === null || pool.state === 'untagged';
  const forecast = placement.kind === 'measured' && placement.placement.kind === 'projected'
    ? placement.placement
    : placement.kind === 'legacy' && legacySafe
      ? projected
      : undefined;

  // Headroom, not load: "91% free" is the question being asked ("can this
  // workspace actually run?"), and the answer stays legible when the score is
  // above the swap ceiling — which ccd's rule permits, since it returns the
  // least-loaded account even when every account is pinned.
  const headroom = forecast ? 100 - forecast.score : null;
  const placeableNames = poolLabelList(roster, pool);
  const measuredNone = placement.kind === 'measured' && placement.placement.kind === 'none';
  // The THIRD meaning of `none` (D-2854): the row was fetched with a class
  // and every eligible lane measured unservable for it. Only a `?class=`
  // fetch can ever carry this. The fleet screen's class chooser (routing
  // slice 5, Task 6) now sends one whenever an operator picks a class there
  // — with the chooser left on "Coordinator row" the fetch stays unrouted
  // and a card never takes this branch, reading exactly as before.
  const measuredNoneClass = placement.kind === 'measured' && placement.placement.kind === 'none'
    ? placement.placement.class
    : undefined;
  const legacyNone = placement.kind === 'legacy' && legacySafe && projected === null;
  const addLabel = forecast
    ? `New workspace on ${group.project} — ${accountLabel(roster, forecast.wrapper)}, ${headroom}% free`
    : measuredNoneClass !== undefined
      ? `New workspace on ${group.project} — no lane can serve ${measuredNoneClass}`
      : measuredNone || legacyNone
      ? poolName === null
        ? placeableNames === ''
          ? `New workspace on ${group.project} — all disabled`
          : `New workspace on ${group.project} — ${placeableNames} all disabled`
        : placeableNames === ''
          ? `New workspace on ${group.project} — nothing is in pool ${poolName}`
          : `New workspace on ${group.project} — nothing in pool ${poolName} is placeable, ${placeableNames} all disabled`
      : placement.kind === 'failed'
        ? `New workspace on ${group.project} — placement check failed; reopen ccrc to retry`
        : placement.kind === 'missing'
          ? `New workspace on ${group.project} — project absent from the latest placement check; reload ccrc`
          : `New workspace on ${group.project}`;

  // Status never owns the card's perimeter except for attention (the one state
  // that asks the reader to ACT). Busy lost it: on a one-session project the
  // rollup was a strict duplicate of the row's own lamp + word, and green on a
  // frame was being read as "selected".
  const cardClass = 'proj-card' + (group.attention ? ' proj-card--attention' : '');

  // Selection is a fact about the reader, not about the project, so it never
  // touches the perimeter — but a fold can hide it exactly as it can hide a
  // pending dialog, so the header carries it (as the slab, at chip scale)
  // while folded. This is the only place the card itself reads selectedId.
  const holdsSelection =
    collapsed && selectedId !== null && group.sessions.some((s) => s.id === selectedId);

  // Task 4. The tree's SHAPE is decided once, away from here (`nestFleet`, five
  // rules, one unit suite); this component maps over the answer and draws a
  // depth as a bracket plus an indent. Top-level order is `group.sessions`
  // verbatim — a child is lifted out of it and put back under its parent, and
  // nothing else moves.
  const rows = nestFleet(group.sessions, runs);
  const rowKey = (row: FleetRow): string =>
    row.kind === 'session' ? row.session.id : `spawn:${row.run.id}`;
  // Task 5: the hold reason's door, decided HERE because this is the level that
  // holds the runs. `runForSession` answers off the run rows — never by reading
  // the id out of the hold string, which stays display-only (its docstring
  // carries the measurement). `null` when the board has no row for this
  // session, and `SessionLine` renders exactly the inert cell it always did for
  // that, so a hand hold and a hold outliving its run both read as text.
  //
  // `/runs` unfocused, because there is no per-run route to focus
  // (`ArchiveConflictSheet`'s own note names that as the first of the three
  // things such a link would need). The board groups by programme and the cell
  // names the programme, so the operator lands looking at the right group.
  const openRunFor = (session: FleetSession): (() => void) | null =>
    runForSession(runs, session.id) === null ? null : () => navigate('/runs');

  // F4. `nestFleet`'s rule 3 leaves a worker whose coordinator is NOT on this
  // card at depth 0, unbracketed — right, and until now silent. This is the
  // sentence that ends the silence, computed HERE (the level that holds the
  // runs) from the run the card already has, so the tree stays pure and its
  // five rules stay exactly as they are.
  //
  // TWO facts, stated only when measured. The programme and wave come off the
  // run itself and are always available. The HOME clause is Task 5's own
  // decision — `crossingNote`, not a second copy of its predicate (D-2575) —
  // asked against THIS CARD's project, `group.project`, not `run.project`
  // (D-2576, re-read for wave 2): `group.project` is now the card this row
  // was PLACED on, which for a moved worker is its COORDINATOR's project. The
  // question the home clause asks is therefore "is this programme homed
  // somewhere other than the card the reader is looking at", which is still
  // the right question for a sentence printed on that card; `run.project`
  // would ask about a card the row is not on.
  // `crossingNote` answers `null` for two distinct reasons — home unknown (the
  // legacy generation, or an older server) or home genuinely IS this card's
  // project (measured sameness) — and both read the same way here: nothing to
  // claim about a home, so nothing is claimed.
  //
  // The guard below reads as ONE two-reasons-for-one-silence statement:
  // `parent === null` (no coordinator at all) and `parent === row.session.id`
  // (self-claimed) are two different reasons there is no OTHER coordinator to
  // call off-card, and collapsing either into "coordinator elsewhere" would be
  // the overloaded silence this repo forbids at a seam. Only the `parent ===
  // null` clause is independently load-bearing, though (D-2574(c), measured):
  // a rendered row's own session is, by construction, always a member of
  // `group.sessions` (rows are built from that exact array), so `parent ===
  // row.session.id` implies the `group.sessions.some(...)` guard one line
  // down is already true — dropping the self-claim clause changes nothing for
  // any reachable row. Kept for what it documents, not for what it guards.
  //
  // The `group.sessions.some(...)` guard is what makes this the ORPHAN's marker
  // and not every worker's: a child whose parent IS on this card is USUALLY
  // bracketed, and the bracket already says what this sentence would say — but
  // not always. `nestFleet`'s rule 4 lifts a session that is BOTH a child and
  // a parent back to depth 0 with no bracket at all (`nestFleet.test.ts:145-157`
  // pins it), and that row still reaches this guard, still finds its parent on
  // `group.sessions`, and still returns null here — so this card says nothing
  // about it either. That silence is acceptable for the same reason rule 4
  // itself gives: the row IS a parent, rendering its own children beneath it,
  // and a THIRD sentence ("your parent is also on this card") next to a row
  // that is already a visible coordinator was judged not worth a marker; it is
  // not evidence the guard's premise holds for every depth-0 row. It looks only
  // at `group.sessions`, never `group.archived` — an archived coordinator IS
  // still a row on this card (`group.archived.map(...)` renders it under the
  // `Archived (N)` fold), just not among this card's LIVE rows, so a worker
  // left behind by one still reads as an orphan (and still says nothing about
  // home when that home is, measured, this card's own project).
  const orphanNote = (row: FleetRow): { text: string; title: string; presence: CoordPresence } | null => {
    if (row.kind !== 'session' || row.depth !== 0) return null;
    const run = runForSession(runs, row.session.id);
    if (run === null) return null;
    const parent = run.claimedBy;
    if (parent === null || parent === row.session.id) return null;
    if (group.sessions.some((s) => s.id === parent)) return null;
    const crossing = crossingNote({ ...run, project: group.project });
    const label = `${run.program} ${waveLabel(run)}`;
    // D-3009: the runs board's own three-answer read (`coordPresence`), off a
    // FLEET-WIDE lookup — the coordinator may sit on another card, in an
    // archive fold, or nowhere this pass — so the marker never claims more
    // than the frame has actually measured.
    const presence = coordPresence(parent, coordOf(parent), frameSeen);
    const where = presence === 'dead'
      ? `coordinator ${parent} is gone — reclaim this programme from the run board (the held cell opens it)`
      : `this worker's coordinator is not among this card's live sessions`;
    return crossing === null
      ? { text: label, title: where, presence }
      : {
          text: `${label} · home ${crossing.home}`,
          title: `${where}; the programme is homed in ${crossing.home}`,
          presence,
        };
  };

  // Spec §6: the repo label appears where the card stops implying it — on a
  // row whose repo DIFFERS from this card's, both measured, and nowhere else.
  // At the REPO grain, not the project name: two projects can resolve to one
  // repo (a worktree-shaped project beside its parent), and a label there is
  // noise. Decided HERE, the one level that holds both the card's project and
  // the lookup; `SessionLine` composes it into the row's name and knows no card.
  const cardRepo = repoLabel(repoFor(group.project));
  const repoOf = (s: FleetSession): string | null => {
    if (s.project === group.project) return null;
    const own = repoLabel(repoFor(s.project));
    return own !== null && cardRepo !== null && own !== cardRepo ? own : null;
  };

  const rowBody = (row: FleetRow): ReactNode =>
    row.kind === 'session' ? (
      <SessionLine
        session={row.session}
        onOpen={onOpen}
        selected={row.session.id === selectedId}
        onActions={onActions}
        roster={roster}
        projectPool={poolOf(row.session)}
        onOpenRun={openRunFor(row.session)}
        repo={repoOf(row.session)}
      />
    ) : (
      <PendingSpawn run={row.run} nowMs={nowMs} />
    );

  return (
    <section
      className={cardClass}
      data-collapsed={collapsed || undefined}
      data-holds-selection={holdsSelection || undefined}
    >
      <div className="proj-card-head">
        <button
          type="button"
          className="proj-card-toggle"
          aria-expanded={!collapsed}
          onClick={() => onToggle?.(group.project)}
        >
          <span className="proj-card-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="proj-card-name">{group.project}</span>
          {/* A badge that reads `1` on every card carries no information. Every
              project on the live fleet holds exactly one session. */}
          {group.sessions.length > 1 && (
            <span className="proj-card-count">{group.sessions.length}</span>
          )}
          {/* The account this project is PINNED to (ccd `home`), which is not
              necessarily where any of its sessions is running — that is on the
              line. `mixed` when the sessions disagree: a header asserting one
              account while two lines show two different ones would be a lie,
              and divergent pins across one project is worth noticing. */}
          <PinChip pin={group.pin} roster={roster} />
          {/* A fold must not hide a session stranded with no valid destination. */}
          {group.stranded > 0 && (
            <span className="proj-card-stranded">{group.stranded} stranded</span>
          )}
          {/* Collapsed or not: a fold must never be able to hide a pending
              dialog, which is the one thing this screen exists to surface. */}
          {group.attention && (
            <span className="proj-card-attn" aria-label="waiting on you" role="img">
              ●
            </span>
          )}
          {/* Attention is an interrupt and shows folded or not; busy is ambient
              and shows only when the fold has hidden the rows that carry it.
              A WORD, never a second dot — two ● glyphs differing only in hue
              sit at 1.06:1 luminance and would make "quietly working, ignore"
              and "blocked, waiting on you" indistinguishable in greyscale. */}
          {collapsed && group.busy > 0 && (
            <span className="proj-card-busy">
              {group.busy > 1 ? `${group.busy} working` : 'working'}
            </span>
          )}
        </button>

        {/* A sibling, never a descendant of the project fold button: nested
            controls are invalid and inaccessible to Safari/VoiceOver. */}
        {pool !== null && (
          <PoolChip pool={pool} project={group.project} dim={poolDim} onTap={onPool} />
        )}

        {onAddWorkspace && (
          <button
            type="button"
            className="proj-card-add"
            /* The project-specific forecast lives in the accessible name and
               tooltip, not in the layout: its visible form took 41% of this
               header and clipped in the desktop sidebar. The accounts strip
               above already shows headroom for every account in more detail. */
            aria-label={addLabel}
            title={addLabel}
            onClick={() => onAddWorkspace(group.project)}
            disabled={adding}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="proj-card-body">
          {/* A depth-0 row renders EXACTLY as it did before this task — no
              wrapper, no prefix. The bracket is not decoration that happens to
              be invisible at the top level: a prefix on every row would say
              nothing, which is the whole reason the card can afford one at
              all. `aria-hidden` on the glyph because it is the picture of an
              edge, not a fact the row does not already carry. */}
          {rows.map((row) => {
            const note = orphanNote(row);
            return row.depth === 0 ? (
              // A Fragment, never a wrapper element: the top-level row's DOM
              // has to stay byte-identical to the one that shipped before the
              // tree existed, and `.proj-card-body`'s column flex lays out its
              // children directly. The marker is a SIBLING line for the same
              // reason — a wrapper would change the row it explains.
              <Fragment key={rowKey(row)}>
                {rowBody(row)}
                {note !== null && (
                  <div className="proj-crossing" title={note.title} data-presence={note.presence}>
                    <span className="proj-crossing-glyph" aria-hidden="true">{CROSSING_GLYPH}</span>
                    {note.text}
                  </div>
                )}
              </Fragment>
            ) : (
              <div key={rowKey(row)} className="proj-nest" data-depth={row.depth}>
                <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
                {rowBody(row)}
              </div>
            );
          })}
          {abroad.length > 0 && (
            <div className="proj-abroad">
              {abroad.map((r) => (
                <span key={r.id} className="proj-abroad-line">
                  <span className="proj-abroad-glyph" aria-hidden="true">{CROSSING_GLYPH}</span>
                  {`${r.program} ${waveLabel(r)} in ${r.project}`}
                </span>
              ))}
            </div>
          )}
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

      {!collapsed && group.archived.length > 0 && (
        <div className="proj-archived">
          {/* Folded, never hidden: the transcript still renders at /s/<id>, so
              a card that omitted these would leave them reachable only by a
              URL nobody has. Collapsed by default — archived rows are context,
              not the fleet. */}
          <button
            type="button"
            className="proj-archived-toggle"
            aria-expanded={archivedOpen}
            onClick={() => onToggle?.(`${group.project}::archived`)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{archivedOpen ? '▾' : '▸'}</span>
            Archived ({group.archived.length})
          </button>
          {archivedOpen && (
            <div className="proj-archived-body">
              {group.archived.map((s) => (
                <SessionLine key={s.id} session={s} onOpen={onOpen} selected={s.id === selectedId} onActions={onActions} roster={roster} projectPool={poolOf(s)} onOpenRun={openRunFor(s)} repo={repoOf(s)} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
