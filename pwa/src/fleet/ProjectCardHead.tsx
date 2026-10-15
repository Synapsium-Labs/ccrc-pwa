// ProjectCard's header — the card's own chrome.
//
// WHY IT IS ITS OWN FILE. `ProjectCard` was a 565-line component body, and
// this header was 68 lines of it plus the two chips it is the only consumer
// of: `PoolChip` (50 lines) and `PinChip` (19). Nothing outside the header
// renders either, and nothing outside this file renders the header — so the
// three travelled together and the card lost 145 lines without a single
// prop crossing a seam that was not already a prop.
//
// EVERY COMMENT CAME WITH ITS CODE. The badge that would read `1` on every
// card, the word-not-a-dot argument for `busy` (two glyphs at 1.06:1 in
// greyscale), the sibling-not-descendant rule for the pool chip, and the
// forecast that took 41% of this header before it moved into the accessible
// name — those are the header's reasons, and they belong where the header is.
//
// The classes stay `proj-*`: fleet.css grounds them and this is the only
// consumer. The shape moves, the ground stays.
import type { ReactNode } from 'react';
import type { ProjectPoolWire, RosterWire } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import type { FleetGroup, FleetPin } from './groupFleet';
import { POOL_UNAVAILABLE_TEXT } from './ProjectCard';
import './fleet.css';

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

export interface ProjectCardHeadProps {
  group: FleetGroup;
  collapsed: boolean;
  onToggle: ((key: string) => void) | undefined;
  roster: readonly RosterWire[];
  pool: ProjectPoolWire | null;
  poolDim: boolean;
  onPool: ((project: string) => void) | undefined;
  onAddWorkspace: ((project: string) => void) | undefined;
  /** The add button's accessible name AND its tooltip — the project-specific
   *  forecast, which lives there rather than in the layout. */
  addLabel: string;
  adding: boolean;
}

export function ProjectCardHead({
  group, collapsed, onToggle, roster, pool, poolDim, onPool, onAddWorkspace, addLabel, adding,
}: ProjectCardHeadProps): ReactNode {
  return (
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
  );
}
