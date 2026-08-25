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
import type { FleetSession, ProjectedHome, RosterWire, RunSummary } from '../../../shared/api';
import { accountColorVar, accountLabel, homeAbleLabelList } from '../lib/accounts';
import { formatElapsed } from './formatReset';
import type { FleetGroup } from './groupFleet';
import { nestFleet, type FleetRow } from './nestFleet';
import { DISPATCH_GLYPH, dispatchWindow } from './runWords';
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

export function ProjectCard({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected,
  adding = false,
  collapsed = false,
  onToggle,
  onActions,
  archivedOpen = false,
  roster = [],
  runs = [],
  nowMs = Date.now(),
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
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
  /** THIS project's ACTIVE runs (Task 4) — the programme edges the body's tree
   *  is drawn from, scoped and filtered by `FleetScreen`, which owns the store
   *  read. Defaults to `[]` so a card rendered before any `{type:'runs'}` frame
   *  has landed — or by a test that is not about the tree — renders the flat
   *  list it always did. */
  runs?: readonly RunSummary[];
  /** The shared tick, in MILLISECONDS, for the pending child's elapsed clock.
   *  This card is pure and controlled (fold state, roster and projection all
   *  arrive the same way), so the CADENCE belongs to `FleetScreen`, which runs
   *  it only while a spawn is actually in flight. The default reads the clock
   *  at render: honest, and it simply stops advancing until the next render —
   *  which is the correct degrade for a card nobody is ticking. */
  nowMs?: number;
}): ReactNode {
  // Headroom, not load: "91% free" is the question being asked ("can this
  // workspace actually run?"), and the answer stays legible when the score is
  // above the swap ceiling — which ccd's rule permits, since it returns the
  // least-loaded account even when every account is pinned.
  const headroom = projected ? 100 - projected.score : null;

  // Three JS values, three distinct facts — collapsing any two would either
  // invent a target (never happened here) or invent a diagnosis (the bug this
  // task exists to fix). `undefined`: nothing is known yet (first poll still
  // in flight, or every poll so far has failed) — the label says nothing it
  // hasn't observed. `null`: the poll landed and the server itself found no
  // home-able lane — that, and only that, earns this copy. It names the
  // three HOME_ABLE lanes individually (homeAbleLabelList) rather than
  // claiming "all accounts": gpt is never consulted for this fact, so a
  // blanket "all" would overstate what the server actually knows. A value:
  // name it. The button stays enabled in all three cases regardless, because
  // ccd's die at ws-add time is the authority, not this forecast.
  // The roster can genuinely land AFTER `projected === null` already has
  // (they poll independently — ProjectCard's own `projected` prop comes from
  // `useProjectedHome`, `roster` from the fleet store's separate poll), so
  // `homeAbleLabelList` can legitimately still return `''` here (fix round 1,
  // finding 7): `roster.filter((a) => a.homeAble)` over an empty array is
  // empty. Naming zero accounts individually read as "New workspace on demo
  // — all disabled" (single space, no phantom list) rather than a name
  // list gone missing mid-sentence.
  const homeAbleNames = homeAbleLabelList(roster);
  const addLabel = projected
    ? `New workspace on ${group.project} — ${accountLabel(roster, projected.wrapper)}, ${headroom}% free`
    : projected === null
      ? homeAbleNames === ''
        ? `New workspace on ${group.project} — all disabled`
        : `New workspace on ${group.project} — ${homeAbleNames} all disabled`
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
  const rowBody = (row: FleetRow): ReactNode =>
    row.kind === 'session' ? (
      <SessionLine
        session={row.session}
        onOpen={onOpen}
        selected={row.session.id === selectedId}
        onActions={onActions}
        roster={roster}
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
          <span
            className="proj-card-pin"
            data-mixed={group.pin === null || undefined}
            aria-label={group.pin === null ? 'pinned accounts differ' : `pinned to ${accountLabel(roster, group.pin)}`}
            style={group.pin === null ? undefined : { color: `var(${accountColorVar(roster, group.pin)})` }}
          >
            {group.pin === null ? 'mixed' : accountLabel(roster, group.pin)}
          </span>
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

        {onAddWorkspace && (
          <button
            type="button"
            className="proj-card-add"
            /* The projection lives in the accessible name and the tooltip, not
               in the layout: it is the SAME string on every card (where the
               next workspace lands is global, not per project), it was 41% of
               this header's width, and it was clipped in the desktop sidebar.
               The headroom % is dropped from the visible UI entirely — the
               accounts strip above says it, for every account, in more detail. */
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
          {rows.map((row) =>
            row.depth === 0 ? (
              // A Fragment, never a wrapper element: the top-level row's DOM
              // has to stay byte-identical to the one that shipped before this
              // task, and `.proj-card-body`'s column flex lays out its
              // children directly.
              <Fragment key={rowKey(row)}>{rowBody(row)}</Fragment>
            ) : (
              <div key={rowKey(row)} className="proj-nest" data-depth={row.depth}>
                <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
                {rowBody(row)}
              </div>
            ),
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
                <SessionLine key={s.id} session={s} onOpen={onOpen} selected={s.id === selectedId} onActions={onActions} roster={roster} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
