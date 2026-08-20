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
import {
  substrateFault,
  type FleetSession, type RosterWire, type SessionBucket, type SessionStatus,
} from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { StatusDot } from '../components/StatusDot';
import { accountLabel } from '../lib/accounts';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNow } from '../lib/useNow';
import { sessionLabel } from '../fleet/sessionLabel';
import { TypedLabel } from '../fleet/TypedLabel';
import { PrKeycap } from './PrKeycap';
import { PrSheet } from './PrSheet';
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
  /** `PrSheet`'s merged phase "Clean up…" hands off here — Task 17 mounts
   *  `ReapSheet` off it. A no-op until then. */
  onReapWorkspace: () => void;
  /** Pre-snapshot identity derived from the session id (`wrapper:project`) —
   *  keeps the header instant on deep links before `/ws/fleet` lands. */
  fallback?: { title: string; wrapper: string };
  /** The account roster (`stores/fleet.ts`'s `roster`) — defaults to `[]` so
   *  a header rendered before the first poll lands degrades to
   *  `accountLabel`'s own raw-wrapper-name fallback rather than needing a
   *  roster it was never given. */
  roster?: readonly RosterWire[];
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
  onReapWorkspace,
  fallback,
  roster = [],
}: SessionHeaderProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  // Menu taps close the sheet first so the follow-up surface (swap sheet,
  // stop confirm, arriving model dialog) never fights it for the bottom edge.
  const menuAct = (fn: () => void): void => {
    setMenuOpen(false);
    fn();
  };

  // Live stream status wins; the fleet snapshot fills in before it connects.
  const st: SessionStatus | null = status ?? session?.status ?? null;
  const at = statusUpdatedAt ?? session?.statusUpdatedAt ?? null;

  // THE bucket — the server's, never this header's. It used to OR
  // `dialogPending`/`hookState` into an `attention` of its own, which is the
  // second writer §1 of the spec forbids and which made the two screens
  // contradict each other from ONE snapshot: a `done` session read `finished`
  // on its fleet row and `idle` here; a `cleanup` one read "merged, ready to
  // clean up" there and "not running" here.
  //
  // The fallback is not a re-derivation: on a deep link, before /ws/fleet
  // lands, there IS no bucket — only the live stream's status — so it is
  // translated into the same vocabulary ('busy' -> 'working'; idle and dead
  // spell the same word in both) purely so the strip can paint something.
  //
  // And neither is the `dead` override. This screen holds a LIVE stream for
  // one session; the fleet snapshot is up to a tick behind it. Making the
  // header snapshot-first (Task 6) dropped the override entirely, so a
  // session whose own stream has already reported it dead kept pulsing amber
  // "waiting on you" — the header contradicting the socket it is attached to,
  // over the one state that asks the reader to act on a process that is gone.
  // It only ever DEMOTES: `dead` is never manufactured into attention, and
  // the bucket the server chose is what paints in every other case. Archived
  // rows are exempt because `ws-archive` stops the session by construction —
  // `dead` is true of every one of them, and saying "not running" there would
  // bury `cleanup`'s merge facts under a liveness fact nobody is waiting on.
  const snapshotBucket = session?.bucket ?? null;
  const bucket: SessionBucket | null =
    st === 'dead' && session != null && session.archivedAt == null
      ? 'dead'
      : snapshotBucket ?? (st === null ? null : st === 'busy' ? 'working' : st);

  // `working` drives the visible clock's tempo; `busy` (the LIVE status, not
  // the snapshot's bucket) stays the gate on interrupting, because stopping a
  // turn is a fact about the process right now, not about how the fleet last
  // filed it.
  const working = bucket === 'working';
  const busy = st === 'busy';
  const now = useNow(working ? 1_000 : 30_000);

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

  // Dot, word and tint all read the one bucket, so this strip cannot
  // contradict itself either. The word is the bucket's, with the two facts
  // only this screen has — the live elapsed clock and the relative age —
  // spliced in; StatusDot supplies the glyph and the spoken label.
  const rel = relShort(now, at);
  const word =
    bucket === 'attention'
      ? 'waiting on you'
      : bucket === 'working'
        ? at !== null
          ? `working · ${clock(now - at)}`
          : 'working…'
        : bucket === 'done'
          ? rel
            ? `done · ${rel} ago`
            : 'done'
          : bucket === 'idle'
            ? rel
              ? `idle · ${rel} ago`
              : 'idle'
            : bucket === 'cleanup'
              ? 'merged, ready to clean up'
              : bucket === 'archived'
                ? 'archived'
                : bucket === 'dead'
                  ? 'not running'
                  : '';
  // Four tints for seven buckets, on purpose: `status-line--*` is the existing,
  // contrast-verified set (chat.css) and the glyph already carries the
  // distinction colour must not carry alone. done/cleanup/archived take idle's
  // matte ink, exactly as their dots do (StatusDot's table).
  const variant =
    bucket === 'attention' ? 'attention' : working ? 'busy' : bucket === 'dead' ? 'dead' : 'idle';

  // The substrate gate (spec §4): under a standing fault the console cannot
  // SEE this session, so Stop — an offer to act on a pane nobody can measure
  // — refuses, disabled with the reason on `title` (the PrSheet idiom; the
  // string is SessionLine's chip's own `tmux unreachable — <reason>`, never a
  // second copy). Read through `substrateFault`: the live frame is cast, not
  // revived, so an older server's row lacks the key at runtime. Interrupt
  // (esc) stays ungated — it targets the turn, not the substrate, and is not
  // on the spec's destructive list.
  const fault = session === null ? null : substrateFault(session);
  const faultTitle = fault !== null ? `tmux unreachable — ${fault.text}` : undefined;

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
  // With no chosen `name`, sessionLabel()'s fallback chain lands on `branch` —
  // so the crumb above and this chip would print the identical string a few
  // pixels apart. Compare the actual rendered text (crumb vs branch), not the
  // fields that produced them, so the two can never disagree about what
  // "duplicate" means. A chosen name, or a main checkout with no crumb at
  // all, always differ — the chip renders exactly as it does today.
  const branchDuplicatesCrumb = crumb !== null && branch === crumb;

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
              <TypedLabel className="chat-crumb" text={crumb} />
            </>
          )}
        </h1>
        <div className="chat-meta">
          {bucket !== null && (
            <>
              <StatusDot status={bucket} />
              <span className={`status-line status-line--${variant}`}>{word}</span>
            </>
          )}
          {wrapper !== '' && (
            <span className="chip chip--active">
              <i aria-hidden="true" />
              {accountLabel(roster, wrapper)}
            </span>
          )}
          {/* Derived from archivedAt, never from pr.phase — a merged PR whose
              archive was deferred must not claim it was archived. */}
          {session?.archivedAt != null && (
            <span className="chip chip--archived">
              archived{session.pr?.number != null ? ` · merged #${session.pr.number}` : ''}
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
            {branch !== null && !branchDuplicatesCrumb && (
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
      {/* Top right, to the right of the ···. `esc` keeps the OUTER edge because
          it is the interrupt and its position is muscle memory; on a fine
          pointer esc is absent and this becomes rightmost naturally. */}
      {session !== null && session.workspace !== null && (
        <PrKeycap pr={session.pr} onOpen={() => setPrOpen(true)} />
      )}
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
          <button
            type="button"
            className="menu-item"
            disabled={fault !== null}
            title={faultTitle}
            onClick={() => menuAct(onMoveAccount)}
          >
            {/* Gated like Stop below (branch review): this item opens the SAME
                SwapSheet as the actions sheet's gated opener, and SwapSheet's
                confirm fires api.swap with no substrate check of its own — so
                an ungated door here was a swap reachable with no gate anywhere. */}
            <span className="menu-label">Move to another account</span>
          </button>
          <button
            type="button"
            className="menu-item menu-item--danger"
            disabled={fault !== null}
            title={faultTitle}
            onClick={() => menuAct(onStopSession)}
          >
            <span className="menu-label">Stop session</span>
          </button>
        </div>
      </Sheet>

      <PrSheet
        session={session}
        open={prOpen}
        onClose={() => setPrOpen(false)}
        onReap={() => { setPrOpen(false); onReapWorkspace(); }}
      />
    </header>
  );
}
