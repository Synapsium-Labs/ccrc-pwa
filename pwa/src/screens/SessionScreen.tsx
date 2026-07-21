// Session screen (route `/s/:id`) — a thin renderer over the per-session
// store: header (Task 8 grows it into SessionHeader), banners for every
// degraded state (offline, dead/read-only, missing transcript), the chat
// list, and the optimistic composer. DialogSheet (Task 9) and TerminalDrawer
// (Task 12) mount at the bottom.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionStatus } from '../../../shared/api';
import { Skeleton } from '../components/Skeleton';
import { StatusDot } from '../components/StatusDot';
import { toast } from '../components/Toast';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { getSessionStore, type SessionStore } from '../stores/session';
import { ChatList } from '../session/ChatList';
import { Composer } from '../session/Composer';
import '../session/chat.css';

const STATUS_WORD: Record<SessionStatus | 'dialog', string> = {
  busy: 'working',
  idle: 'idle',
  dead: 'not running',
  dialog: 'waiting on you',
};
const STATUS_CLASS: Record<SessionStatus | 'dialog', string> = {
  busy: 'status-line--busy',
  idle: 'status-line--idle',
  dead: 'status-line--dead',
  dialog: 'status-line--attention',
};

export function SessionScreen({
  id,
  store,
}: {
  id: string;
  store?: SessionStore; // injectable for tests
}): ReactNode {
  const useStore = store ?? getSessionStore(id);
  const events = useStore((s) => s.events);
  const pending = useStore((s) => s.pending);
  const status = useStore((s) => s.status);
  const dialog = useStore((s) => s.dialog);
  const uuid = useStore((s) => s.uuid);
  const conn = useStore((s) => s.conn);
  const missingFile = useStore((s) => s.missingFile);

  const [restarting, setRestarting] = useState(false);
  // TerminalDrawer (Task 12) mounts on this flag.
  const [, setTerminalOpen] = useState(false);

  useEffect(() => {
    // Session sockets live with the screen: resume rides `?since=` on return.
    useStore.getState().connect();
    return () => useStore.getState().disconnect();
  }, [useStore]);

  // id is `${wrapper}:${project}` — enough for the Task-8-placeholder header.
  const wrapper = id.split(':', 1)[0] ?? id;
  const project = id.slice(wrapper.length + 1) || id;
  const acctVar = accountColorVar(wrapper);
  const acct = acctVar.startsWith('--acct-') ? acctVar.slice('--acct-'.length) : undefined;

  const dead = status === 'dead';
  const loading = uuid === null && missingFile === null;
  const empty = !loading && events.length === 0 && pending.length === 0;
  const dotStatus: SessionStatus | 'dialog' = dialog !== null ? 'dialog' : (status ?? 'idle');

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

  const openTerminal = (): void => {
    setTerminalOpen(true);
    // Until the drawer ships (Task 12) the tap still answers.
    toast('The terminal opens here soon');
  };

  return (
    <div className="chat" data-acct={acct}>
      <header className="chat-head">
        <button
          type="button"
          className="chat-back"
          aria-label="Back to fleet"
          onClick={() => navigate('/')}
        >
          ‹
        </button>
        <div className="chat-title-wrap">
          <h1 className="chat-title">{project}</h1>
          <div className="chat-meta">
            {status !== null && (
              <>
                <StatusDot status={dotStatus} />
                <span className={`status-line ${STATUS_CLASS[dotStatus]}`}>
                  {STATUS_WORD[dotStatus]}
                </span>
              </>
            )}
            <span className="chip chip--active">
              <i aria-hidden="true" />
              {accountLabel(wrapper)}
            </span>
          </div>
        </div>
      </header>

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
