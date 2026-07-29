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
import type { ReactNode } from 'react';
import type { FleetSession, ProjectedHome } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import type { FleetGroup } from './groupFleet';
import { SessionLine } from './SessionLine';
import './fleet.css';

export function ProjectCard({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected = null,
  adding = false,
  collapsed = false,
  onToggle,
  onActions,
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  onAddWorkspace?: (project: string) => void;
  /** Where a new workspace would land, as the SERVER projects it (limits.ts
   *  `projectHome`, itself a mirror of ccd's `_ws_least_loaded`). Never
   *  recomputed here — a third copy of the routing rule would drift from both.
   *  Null until the first /api/accounts poll lands; the `+` never waits on it. */
  projected?: ProjectedHome | null;
  /** This project's own ws-add is in flight. ccd does not dedupe concurrent
   *  ws-adds, and the spawn window runs to minutes. */
  adding?: boolean;
  collapsed?: boolean;
  onToggle?: (project: string) => void;
  onActions: (session: FleetSession) => void;
}): ReactNode {
  // Headroom, not load: "91% free" is the question being asked ("can this
  // workspace actually run?"), and the answer stays legible when the score is
  // above the swap ceiling — which ccd's rule permits, since it returns the
  // least-loaded account even when every account is pinned.
  const headroom = projected ? 100 - projected.score : null;

  const addLabel = projected
    ? `New workspace on ${group.project} — ${accountLabel(projected.wrapper)}, ${headroom}% free`
    : `New workspace on ${group.project}`;

  const cardClass =
    'proj-card' +
    (group.attention ? ' proj-card--attention' : group.busy > 0 ? ' proj-card--busy' : '');

  return (
    <section className={cardClass} data-collapsed={collapsed || undefined}>
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
            aria-label={group.pin === null ? 'pinned accounts differ' : `pinned to ${accountLabel(group.pin)}`}
            style={group.pin === null ? undefined : { color: `var(${accountColorVar(group.pin)})` }}
          >
            {group.pin === null ? 'mixed' : accountLabel(group.pin)}
          </span>
          {/* Collapsed or not: a fold must never be able to hide a pending
              dialog, which is the one thing this screen exists to surface. */}
          {group.attention && (
            <span className="proj-card-attn" aria-label="waiting on you" role="img">
              ●
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
          {group.sessions.map((s) => (
            <SessionLine
              key={s.id}
              session={s}
              onOpen={onOpen}
              selected={s.id === selectedId}
              onActions={onActions}
            />
          ))}
        </div>
      )}
    </section>
  );
}
