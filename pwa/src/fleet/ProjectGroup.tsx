// A project's sessions. One session renders bare — no header, no chevron, no
// indent — so the common case looks exactly as it did before workspaces
// existed. Two or more grow a header that carries the group's state even when
// collapsed: this screen's job is answering "what needs me?", and a fold must
// never be able to hide that answer.
//
// The `+` is the exception to "one session renders bare". It appears either
// way, because a group needs two sessions and every live project has one — so
// a `+` confined to the header would render nowhere and the first workspace on
// any project could only be made over SSH. It brings no header with it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectedHome } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import type { FleetGroup } from './groupFleet';
import { SessionCard } from './SessionCard';
import './fleet.css';

/** Score at which the projected landing account counts as exhausted — the same
 *  threshold the accounts strip calls `crit` and the card calls "limit near". */
const LOW_HEADROOM = 75;

export function ProjectGroup({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected = null,
  adding = false,
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
}): ReactNode {
  const [collapsed, setCollapsed] = useState(false);

  const cards = group.sessions.map((s) => (
    <SessionCard
      key={s.id}
      session={s}
      onOpen={onOpen}
      selected={s.id === selectedId}
      inGroup={group.grouped}
    />
  ));

  // Headroom, not load: "82% free" is the question being asked ("can this
  // workspace actually run?"), and the answer stays legible when the score is
  // above the swap ceiling — which ccd's rule permits, since it returns the
  // least-loaded account even when every account is pinned.
  const headroom = projected ? 100 - projected.score : null;
  const add = onAddWorkspace ? (
    <button
      type="button"
      className="proj-group-add"
      aria-label={
        projected
          ? `New workspace on ${group.project} — ${accountLabel(projected.wrapper)}, ${headroom}% free`
          : `New workspace on ${group.project}`
      }
      onClick={() => onAddWorkspace(group.project)}
      disabled={adding}
    >
      <span aria-hidden="true">+</span>
      {projected && (
        <span className="proj-add-acct" data-low={projected.score >= LOW_HEADROOM || undefined}>
          {accountLabel(projected.wrapper)} · {headroom}% free
        </span>
      )}
    </button>
  ) : null;

  // Bare: the cards exactly as before, plus the `+` on its own right-aligned
  // line. No section, no header, no chevron, no indent.
  if (!group.grouped) {
    return (
      <>
        {cards}
        {add && <div className="proj-add-bare">{add}</div>}
      </>
    );
  }

  return (
    <section className="proj-group" data-collapsed={collapsed || undefined}>
      <div className="proj-group-head">
        <button
          type="button"
          className="proj-group-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="proj-group-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="proj-group-name">{group.project}</span>
          <span className="proj-group-count">{group.sessions.length}</span>
          {group.attention && (
            <span className="proj-group-attn" aria-label="waiting on you" role="img">
              ●
            </span>
          )}
        </button>
        {add}
      </div>
      {!collapsed && <div className="proj-group-body">{cards}</div>}
    </section>
  );
}
