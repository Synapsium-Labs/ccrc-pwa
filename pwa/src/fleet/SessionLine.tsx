// One session as a compact row: dot · label · state · tally · ⚠ · account · ···
//
// Replaces SessionCard in the fleet list. Three things are cut rather than
// shrunk. The attention SENTENCE ("Claude is asking you something") becomes the
// amber dot plus the word `waiting` — same information at a glance, and the
// sentence earned its space on a card that was already large. The limit
// sentence becomes `⚠`, with the full text in the actions sheet where there is
// room to say what will happen. The dead-card long-press becomes an explicit
// sheet action: a hidden gesture is the wrong home for recovery, and a worse
// one for "Remove workspace".
//
// There is no `inGroup` prop. A line is always inside a project card now, so
// the conditional that made SessionCard mean two different things is gone.
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession, SessionStatus } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { StatusDot } from '../components/StatusDot';
import './fleet.css';

/** Routing policy calls a window critical above this. */
const CRITICAL = 75;

// Only ONE element may carry a given view-transition-name — a second aborts
// the transition entirely. The stamp is never cleared on navigation and these
// nodes are key-stable, so the previous holder has to be released here.
let stamped: HTMLElement | null = null;

export function SessionLine({
  session,
  onOpen,
  selected = false,
  onActions,
}: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean; // the open session in the desktop sidebar
  onActions: (session: FleetSession) => void;
}): ReactNode {
  const dead = session.status === 'dead';
  const attention = !dead && session.dialogPending;
  const busy = !attention && session.status === 'busy';
  const dotStatus: SessionStatus | 'dialog' = dead ? 'dead' : attention ? 'dialog' : session.status;
  const state = dead ? 'exited' : attention ? 'waiting' : busy ? 'working' : 'idle';

  // Spec order: name ?? branch ?? workspace ?? id. Branch outranks the slug
  // because Phase 2's PR flow renames the branch to something descriptive while
  // `workspace` keeps the slug it was born with — slug-first would pin the line
  // to `quiet-mesa` forever. The `id` tail keeps the rule total for legacy rows,
  // which have no workspace.
  const label = session.name ?? session.branch ?? session.workspace ?? session.id;

  // Dead sessions stay silent about limits: they are meaningless when nothing runs.
  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical = !dead && ((five !== null && five > CRITICAL) || (seven !== null && seven > CRITICAL));

  // The tapped label is the shared element of the line->chat view transition:
  // stamping the name here (only on the line being opened) pairs it with the
  // chat header's `view-transition-name: session-title` (session/chat.css:61).
  const labelRef = useRef<HTMLButtonElement>(null);
  const open = (): void => {
    const el = labelRef.current;
    if (el) {
      if (stamped !== null && stamped !== el) stamped.style.viewTransitionName = '';
      el.style.viewTransitionName = 'session-title';
      stamped = el;
    }
    onOpen(session.id);
  };

  // Identity stays in the name; a dead line's account drains to gray.
  const acctVar = accountColorVar(session.wrapper);
  const acctStyle: CSSProperties = dead
    ? { color: 'var(--ink-secondary)' }
    : { color: `var(${acctVar})` };

  return (
    <div className={selected ? 'sess-line sess-line--active' : 'sess-line'} data-state={state}>
      <span className="sess-lamp" data-status={dotStatus}>
        <StatusDot status={dotStatus} />
      </span>

      <button ref={labelRef} type="button" className="sess-open" onClick={open}>
        <span className="sess-label">{label}</span>
        <span className={`sess-state sess-state--${state}`}>{state}</span>
      </button>

      {!dead && session.tasks !== null && (
        <span className="sess-tally">
          {session.tasks.done}/{session.tasks.total}
        </span>
      )}

      {critical && (
        <span className="sess-warn" role="img" aria-label="account limit near">
          ⚠
        </span>
      )}

      <span className="sess-acct" style={acctStyle}>
        {accountLabel(session.wrapper)}
      </span>

      <button
        type="button"
        className="sess-actions"
        aria-label={`Actions for ${label}`}
        onClick={() => onActions(session)}
      >
        <span aria-hidden="true">···</span>
      </button>
    </div>
  );
}
