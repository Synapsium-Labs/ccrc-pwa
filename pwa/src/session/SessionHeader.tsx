// Session header — the chat's sticky, safe-area-padded top strip: back
// chevron, the session's live name (fleet `name`, falling back to project),
// status meta (breathing dot + mono word; busy ticks a live elapsed clock),
// the account chip, and raised keycaps — `>_` opens the terminal drawer,
// `⋯` opens the lifecycle overflow menu (change model / move account /
// stop), and `esc` interrupts (DIRECTION: "a keycap, not an icon"), enabled
// only while the session is busy. Confirm-free: pressing esc just sends it.
// The esc cap is touch-only: where a physical keyboard exists ((pointer:
// fine)) it hides and the real Escape key takes over instead, guarded so it
// never fires while focus is in a text field.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, SessionStatus } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { StatusDot } from '../components/StatusDot';
import { accountLabel } from '../lib/accounts';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { sessionLabel } from '../fleet/sessionLabel';
import './chat.css';

export interface SessionHeaderProps {
  session: FleetSession | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  onInterrupt: () => void;
  onOpenTerminal: () => void;
  onBack: () => void;
  /** "Change model" — opens the one-tap model chooser. */
  onChangeModel: () => void;
  /** "Change effort" — opens the one-tap effort chooser. */
  onChangeEffort: () => void;
  /** Overflow menu: "Move to another account" — opens the SwapSheet. */
  onMoveAccount: () => void;
  /** Overflow menu: "Stop session" — opens the stop QuickConfirm. */
  onStopSession: () => void;
  /** Pre-snapshot identity derived from the session id (`wrapper:project`) —
   *  keeps the header instant on deep links before `/ws/fleet` lands. */
  fallback?: { title: string; wrapper: string };
}

/** '04:12' (or '1:04:12') elapsed — rendered in tabular-nums mono. */
function clock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

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

export function SessionHeader({
  session,
  status,
  statusUpdatedAt,
  onInterrupt,
  onOpenTerminal,
  onBack,
  onChangeModel,
  onChangeEffort,
  onMoveAccount,
  onStopSession,
  fallback,
}: SessionHeaderProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  // Menu taps close the sheet first so the follow-up surface (swap sheet,
  // stop confirm, arriving model dialog) never fights it for the bottom edge.
  const menuAct = (fn: () => void): void => {
    setMenuOpen(false);
    fn();
  };

  // Live stream status wins; the fleet snapshot fills in before it connects.
  const st: SessionStatus | null = status ?? session?.status ?? null;
  const at = statusUpdatedAt ?? session?.statusUpdatedAt ?? null;
  const attention = session?.dialogPending === true && st !== 'dead';
  const busy = st === 'busy';
  const now = useNow(busy ? 1_000 : 30_000);

  // The keycap exists because phone keyboards have no Escape key. Where one
  // exists, the key is the better control and the cap is clutter — but the
  // binding has to land in the SAME change that hides the cap, or interrupting
  // simply stops being possible. The PWA had no Escape handler at all before.
  const finePointer = useMediaQuery('(pointer: fine)');

  useEffect(() => {
    if (!finePointer || !busy) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Escape inside a text field dismisses autocomplete or clears the draft —
      // it must not reach through and kill the turn.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true) return;
      onInterrupt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finePointer, busy, onInterrupt]);

  const dot: SessionStatus | 'dialog' | null = attention ? 'dialog' : st;
  const rel = relShort(now, at);
  const word = attention
    ? 'waiting on you'
    : busy
      ? at !== null
        ? `working · ${clock(now - at)}`
        : 'working…'
      : st === 'idle'
        ? rel
          ? `idle · ${rel} ago`
          : 'idle'
        : st === 'dead'
          ? 'not running'
          : '';
  const variant = attention ? 'attention' : busy ? 'busy' : st === 'dead' ? 'dead' : 'idle';

  // The project is the ground; the second crumb is this particular workspace.
  // Without it, two workspaces of one project produce two identical headers.
  const title = session ? session.project : (fallback?.title ?? '…');
  const crumb = session && session.workspace !== null ? sessionLabel(session) : null;
  const wrapper = session?.wrapper ?? fallback?.wrapper ?? '';

  // Model / effort / ultracode / branch — read from the pane statusline the
  // server already parses. Tapping the model or effort chip opens its chooser.
  const model = session?.model ?? null;
  const effort = session?.effort ?? null;
  const ultracode = session?.ultracode ?? false;
  const branch = session?.branch ?? null;
  const hasMeta = st !== 'dead' && (model !== null || branch !== null || effort !== null || ultracode);

  return (
    <header className="chat-head">
      <button type="button" className="chat-back" aria-label="Back to fleet" onClick={onBack}>
        ‹
      </button>
      <div className="chat-title-wrap">
        <h1 className="chat-title">
          {title}
          {crumb !== null && (
            <>
              <span className="chat-crumb-sep" aria-hidden="true">
                ›
              </span>
              <span className="chat-crumb">{crumb}</span>
            </>
          )}
        </h1>
        <div className="chat-meta">
          {dot !== null && (
            <>
              <StatusDot status={dot} />
              <span className={`status-line status-line--${variant}`}>{word}</span>
            </>
          )}
          {wrapper !== '' && (
            <span className="chip chip--active">
              <i aria-hidden="true" />
              {accountLabel(wrapper)}
            </span>
          )}
          {/* Status, account, model, effort and branch share ONE wrapping row —
              two fixed rows cost a line of chat height on every screen to say
              what fits comfortably on one. */}
          {hasMeta && (
            <>
              {model !== null && (
              <button type="button" className="metachip metachip--model" onClick={onChangeModel}>
                <span className="metachip-glyph" aria-hidden="true">🤖</span>
                <span className="metachip-text">{model}</span>
              </button>
            )}
            <button
              type="button"
              className={ultracode ? 'metachip metachip--ultra' : 'metachip'}
              onClick={onChangeEffort}
            >
              <span className="metachip-text">{ultracode ? 'ultracode' : (effort ?? 'set effort')}</span>
            </button>
            {branch !== null && (
              <span className="metachip metachip--branch" title={branch}>
                <span className="metachip-glyph" aria-hidden="true">⎇</span>
                <span className="metachip-text">{branch}</span>
              </span>
            )}
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        className="keycap keycap--term"
        aria-label="Terminal"
        onClick={onOpenTerminal}
      >
        <span aria-hidden="true">&gt;_</span>
      </button>
      <button
        type="button"
        className="keycap keycap--more"
        aria-label="More"
        onClick={() => setMenuOpen(true)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {!finePointer && (
        <button
          type="button"
          className="keycap keycap--esc"
          aria-label="Stop"
          disabled={!busy}
          onClick={onInterrupt}
        >
          esc
        </button>
      )}

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} eyebrow="session" title={title}>
        <div className="menu">
          <button type="button" className="menu-item" onClick={() => menuAct(onChangeModel)}>
            <span className="menu-label">Change model</span>
            <span className="menu-hint" aria-hidden="true">
              /model
            </span>
          </button>
          <button type="button" className="menu-item" onClick={() => menuAct(onChangeEffort)}>
            <span className="menu-label">Change effort</span>
            <span className="menu-hint" aria-hidden="true">
              /effort
            </span>
          </button>
          <button type="button" className="menu-item" onClick={() => menuAct(onMoveAccount)}>
            <span className="menu-label">Move to another account</span>
          </button>
          <button
            type="button"
            className="menu-item menu-item--danger"
            onClick={() => menuAct(onStopSession)}
          >
            <span className="menu-label">Stop session</span>
          </button>
        </div>
      </Sheet>
    </header>
  );
}
