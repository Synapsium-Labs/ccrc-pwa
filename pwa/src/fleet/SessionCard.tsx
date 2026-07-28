// Session card — the fleet's unit of glance. Glow means life: busy breathes
// phosphor, a pending dialog pulses amber (with a plain-language badge), dead
// is matte and cold with one-tap recovery. The whole card is one stretched
// ≥44px open target; on a dead card, holding it (or the inline button)
// restarts via api.ensure.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { FleetSession, SessionStatus } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { useNow } from '../lib/useNow';
import { StatusDot } from '../components/StatusDot';
import { toast } from '../components/Toast';
import { api } from '../lib/api';
import './fleet.css';

const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 12;
const PING_MS = 400; // --dur-ping plus a little settle

/** '2m' | '3h' | '5d' — null under a minute (callers phrase that case). */
function relShort(now: number, then: number | null): string | null {
  if (then === null) return null;
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function SessionCard({
  session,
  onOpen,
  selected = false,
  inGroup = false,
}: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean; // the open session in the desktop sidebar
  // inside a project group — the header already says the project, so the
  // card names the workspace instead
  inGroup?: boolean;
}): ReactNode {
  const now = useNow(30_000);
  const [restarting, setRestarting] = useState(false);

  const dead = session.status === 'dead';
  const attention = !dead && session.dialogPending;
  const busy = !attention && session.status === 'busy';
  const dotStatus: SessionStatus | 'dialog' = dead ? 'dead' : attention ? 'dialog' : session.status;

  // One-shot ping ring when the lamp changes state.
  const [ping, setPing] = useState(false);
  const prevDot = useRef(dotStatus);
  useEffect(() => {
    if (prevDot.current === dotStatus) return;
    prevDot.current = dotStatus;
    setPing(true);
    const timer = setTimeout(() => setPing(false), PING_MS);
    return () => clearTimeout(timer);
  }, [dotStatus]);

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    try {
      await api.ensure(session.id);
    } catch (err) {
      toast(`Couldn't restart — ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setRestarting(false);
    }
  };

  const [removing, setRemoving] = useState(false);
  const removeWorkspace = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    try {
      await api.workspaceRemove(session.id);
    } catch (err) {
      toast(`Couldn't remove — ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setRemoving(false);
    }
  };

  // Long-press on a dead card restarts; a short tap still opens the chat.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = (): void => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  };
  const onPointerDown = (e: ReactPointerEvent): void => {
    if (!dead) return;
    longPressed.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      longPressed.current = true;
      void restart();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent): void => {
    const origin = pressOrigin.current;
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX) {
      cancelPress(); // it's a scroll, not a hold
    }
  };
  // The tapped card's title is the shared element of the card→chat view
  // transition: stamping the name here (only on the card being opened) pairs
  // it with the chat header's `view-transition-name: session-title`.
  const titleRef = useRef<HTMLButtonElement>(null);
  const open = (): void => {
    if (longPressed.current) {
      longPressed.current = false;
      return; // the hold already restarted — don't also navigate
    }
    if (titleRef.current) titleRef.current.style.viewTransitionName = 'session-title';
    onOpen(session.id);
  };

  const rel = relShort(now, session.statusUpdatedAt);
  const statusLine = dead
    ? rel
      ? `exited · ${rel} ago`
      : 'exited · just now'
    : attention
      ? rel
        ? `waiting on you · ${rel}`
        : 'waiting on you'
      : busy
        ? rel
          ? `working · ${rel}`
          : 'working'
        : rel
          ? `idle · ${rel} ago`
          : 'idle · just now';
  const lineVariant = dead ? 'dead' : attention ? 'attention' : busy ? 'busy' : 'idle';

  // Critical limit window (routing policy: > 75%), if any — 5h is the more
  // urgent forecast when both windows are critical. Dead cards stay silent
  // (limits are meaningless when nothing runs).
  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical = dead ? null : five !== null && five > 75 ? '5h' : seven !== null && seven > 75 ? '7d' : null;

  // Chip colors resolve through the account token names; a dead card's chip
  // drains to gray — identity stays in the mono name.
  const acctVar = accountColorVar(session.wrapper);
  const chipStyle: CSSProperties = dead
    ? { color: 'var(--ink-secondary)', background: 'var(--bg-raised)' }
    : {
        color: `var(${acctVar})`,
        background: acctVar.startsWith('--acct-') ? `var(${acctVar}-tint)` : 'var(--bg-raised)',
      };

  const cardClass =
    (dead
      ? 'card card--dead'
      : attention
        ? 'card card--attention'
        : busy
          ? 'card card--busy'
          : 'card') + (selected ? ' card--active' : '');

  // Standalone, the project IS the identity. Inside a group the header already
  // carries the project, so repeating it renders every sibling identical.
  const title = inGroup
    ? (session.name ?? session.workspace ?? session.branch ?? session.id)
    : session.project;

  return (
    <article className={cardClass}>
      <div className="card-top">
        <h2 className="proj">
          <button
            ref={titleRef}
            type="button"
            className="card-open"
            onClick={open}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
          >
            {title}
          </button>
        </h2>
        <span className={ping ? 'lamp lamp--ping' : 'lamp'} data-status={dotStatus}>
          <StatusDot status={dotStatus} />
        </span>
      </div>

      <div className="card-sub">
        <span className="chip" style={chipStyle}>
          <i aria-hidden="true" />
          {accountLabel(session.wrapper)}
        </span>
        <span className={`status-line status-line--${lineVariant}`}>{statusLine}</span>
      </div>

      {attention && <p className="card-attn">Claude is asking you something — tap to answer</p>}

      {/* Plan progress — the same list the session's task strip shows, reduced
          to what a glance needs: how far along, and what it's on right now.
          Dead cards stay silent; a stopped session isn't making progress. */}
      {!dead && session.tasks !== null && (
        <div className="card-tasks">
          <span
            className="task-track"
            role="progressbar"
            aria-label="Tasks completed"
            aria-valuenow={session.tasks.done}
            aria-valuemin={0}
            aria-valuemax={session.tasks.total}
          >
            <i style={{ width: `${(session.tasks.done / session.tasks.total) * 100}%` }} />
          </span>
          <span className="task-tally">
            {session.tasks.done}/{session.tasks.total}
          </span>
          {session.tasks.active !== null && (
            <span className="task-active">{session.tasks.active}</span>
          )}
        </div>
      )}

      {/* Account usage lives once in the AccountsStrip; the card keeps only the
          per-session consequence when a window crosses critical. */}
      {critical !== null && (
        <p className="card-limit-note">{critical} limit near — will move to another account</p>
      )}

      {/* No confirm dialog: ccd ws-rm refuses on a dirty tree or an unmerged
          branch and says why, so the guard lives where the facts are rather
          than in a prompt the user learns to dismiss. */}
      {session.workspace !== null && (
        <button
          type="button"
          className="btn-ghost card-remove"
          aria-label="Remove workspace"
          onClick={() => void removeWorkspace()}
          disabled={removing}
        >
          {removing ? 'Removing…' : 'Remove workspace'}
        </button>
      )}

      {dead && (
        <>
          <p className="card-hint">Not running — tap to view, hold to restart</p>
          <button
            type="button"
            className="btn-ghost card-restart"
            onClick={() => void restart()}
            disabled={restarting}
          >
            {restarting ? 'Restarting…' : 'Restart session'}
          </button>
        </>
      )}
    </article>
  );
}
