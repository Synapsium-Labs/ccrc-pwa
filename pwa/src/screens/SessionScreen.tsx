// Session screen (route `/s/:id`) — a thin renderer over the per-session
// store: SessionHeader (live name, interrupt keycap, terminal keycap),
// banners for every degraded state (offline, dead/read-only, missing
// transcript), the chat list, and the optimistic composer. The fleet store
// (connected app-wide in app.tsx) supplies the header's live identity.
// DialogSheet (Task 9) and TerminalDrawer (Task 12) mount at the bottom.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { accountColorVar } from '../lib/accounts';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { getSessionStore, type SessionStore } from '../stores/session';
import { ChatList } from '../session/ChatList';
import { Composer } from '../session/Composer';
import { SessionHeader } from '../session/SessionHeader';
import '../session/chat.css';

/** Keyboard discipline: the bottom inset (px) the on-screen keyboard covers,
 *  tracked via the visualViewport. The screen pads its shell by this much so
 *  the composer stays above the keyboard and the list shrinks in place —
 *  focusing the box never scrolls the chat away. 0 when no keyboard (or no
 *  visualViewport — desktop browsers without one need no discipline). */
export function useKeyboardInsets(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = (): void => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset(next);
      // iOS scrolls the page when the keyboard opens even in a fixed-height
      // layout — pin it back so the header stays on-screen and the reader's
      // place in the list survives focusing the composer.
      if (next > 0 && (document.scrollingElement?.scrollTop ?? 0) > 0) {
        window.scrollTo(0, 0);
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export function SessionScreen({
  id,
  store,
  fleet,
}: {
  id: string;
  store?: SessionStore; // injectable for tests
  fleet?: FleetStore; // injectable for tests
}): ReactNode {
  const useStore = store ?? getSessionStore(id);
  const useFleet = fleet ?? useFleetStore;
  const events = useStore((s) => s.events);
  const pending = useStore((s) => s.pending);
  const status = useStore((s) => s.status);
  const statusUpdatedAt = useStore((s) => s.statusUpdatedAt);
  const uuid = useStore((s) => s.uuid);
  const conn = useStore((s) => s.conn);
  const missingFile = useStore((s) => s.missingFile);
  // This session's fleet entry — live name, account, dialogPending badge.
  const live = useFleet((s) => s.sessions.find((x) => x.id === id) ?? null);

  const kbInset = useKeyboardInsets();
  const [restarting, setRestarting] = useState(false);
  // TerminalDrawer (Task 12) mounts on this flag.
  const [, setTerminalOpen] = useState(false);

  useEffect(() => {
    // Session sockets live with the screen: resume rides `?since=` on return.
    useStore.getState().connect();
    return () => useStore.getState().disconnect();
  }, [useStore]);

  // id is `${wrapper}:${project}` — the header's identity before /ws/fleet lands.
  const wrapperFromId = id.split(':', 1)[0] ?? id;
  const project = live?.project ?? (id.slice(wrapperFromId.length + 1) || id);
  const wrapper = live?.wrapper ?? wrapperFromId;
  const acctVar = accountColorVar(wrapper);
  const acct = acctVar.startsWith('--acct-') ? acctVar.slice('--acct-'.length) : undefined;

  const dead = status === 'dead';
  const loading = uuid === null && missingFile === null;
  const empty = !loading && events.length === 0 && pending.length === 0;

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    try {
      await api.ensure(id);
    } catch (err) {
      toast(`Couldn't restart — ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setRestarting(false);
    }
  };

  // Confirm-free: esc just sends. A 409 means the turn already ended — say so
  // quietly; anything else is a real failure.
  const interrupt = async (): Promise<void> => {
    try {
      await api.interrupt(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("Claude isn't working right now — nothing to stop");
      } else {
        toast(`Couldn't stop — ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
  };

  const openTerminal = (): void => {
    setTerminalOpen(true);
    // Until the drawer ships (Task 12) the tap still answers.
    toast('The terminal opens here soon');
  };

  return (
    <div
      className="chat"
      data-acct={acct}
      data-kb={kbInset > 0 ? 'true' : undefined}
      style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}
    >
      <SessionHeader
        session={live}
        status={status}
        statusUpdatedAt={statusUpdatedAt}
        onInterrupt={() => void interrupt()}
        onOpenTerminal={openTerminal}
        onBack={() => navigate('/')}
        fallback={{ title: project, wrapper }}
      />

      {conn === 'down' && (
        <div className="chat-banner chat-banner--offline" role="status">
          Reconnecting…
        </div>
      )}

      {missingFile !== null && (
        <div className="chat-banner chat-banner--missing" role="status">
          <span>Can't find this session's transcript</span>
          <span className="banner-path">{missingFile}</span>
          <button type="button" className="btn-ghost" onClick={openTerminal}>
            Open terminal
          </button>
        </div>
      )}

      {dead && (
        <div className="chat-banner chat-banner--dead" role="status">
          <span className="banner-copy">Not running — the chat is read-only.</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void restart()}
            disabled={restarting}
          >
            {restarting ? 'Restarting…' : 'Restart session'}
          </button>
        </div>
      )}

      <div className="chat-body">
        {loading ? (
          <div className="chat-skel">
            <Skeleton lines={1} className="skel--user" />
            <Skeleton lines={3} className="skel--assist" />
            <Skeleton lines={1} className="skel--user" />
            <Skeleton lines={2} className="skel--assist" />
          </div>
        ) : empty ? (
          <div className="chat-empty">
            <p className="chat-empty-mark" aria-hidden="true">
              ❯
            </p>
            <p className="chat-empty-title">No messages yet</p>
            <p className="chat-empty-copy">
              Say what you need — it lands in this session's Claude and the reply streams back
              here.
            </p>
          </div>
        ) : (
          <ChatList
            events={events}
            pending={pending}
            busy={status === 'busy'}
            onRetry={(key) => useStore.getState().retry(key)}
            onDiscard={(key) => useStore.getState().discard(key)}
          />
        )}
      </div>

      <Composer
        onSend={(text, replaceDraft) => void useStore.getState().send(text, replaceDraft)}
        pending={pending}
        disabled={dead}
        placeholder={dead ? 'Restart the session to send' : `Message ${project}`}
        onDiscard={(key) => useStore.getState().discard(key)}
      />

      {/* DialogSheet mounts here (Task 9). */}
      {/* TerminalDrawer mounts here (Task 12) — opened via `terminalOpen`. */}
    </div>
  );
}
