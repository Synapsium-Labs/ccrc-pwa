// A project's sessions. One session renders bare — no header, no chevron, no
// indent — so the common case looks exactly as it did before workspaces
// existed. Two or more grow a header that carries the group's state even when
// collapsed: this screen's job is answering "what needs me?", and a fold must
// never be able to hide that answer.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetGroup } from './groupFleet';
import { SessionCard } from './SessionCard';
import './fleet.css';

export function ProjectGroup({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  onAddWorkspace?: (project: string) => void;
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

  if (!group.grouped) return <>{cards}</>;

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
        {onAddWorkspace && (
          <button
            type="button"
            className="proj-group-add"
            aria-label={`New workspace on ${group.project}`}
            onClick={() => onAddWorkspace(group.project)}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>
      {!collapsed && <div className="proj-group-body">{cards}</div>}
    </section>
  );
}
