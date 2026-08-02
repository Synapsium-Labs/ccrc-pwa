// Session screen (route `/s/:id`) — a thin renderer over the per-session
// store: SessionHeader (live name, interrupt keycap, terminal keycap),
// banners for every degraded state (offline, dead/read-only, missing
// transcript), the chat list, and the optimistic composer. The fleet store
// (connected app-wide in app.tsx) supplies the header's live identity.
// DialogSheet and the TerminalDrawer mount at the bottom.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { QuickConfirm } from '../components/QuickConfirm';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { SwapSheet } from '../fleet/SwapSheet';
import { accountColorVar } from '../lib/accounts';
import { api, ApiError, apiErrorText } from '../lib/api';
import { useKeyboardInset } from '../lib/keyboard';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { getSessionStore, type SessionStore } from '../stores/session';
import { ChatList } from '../session/ChatList';
import { Composer } from '../session/Composer';
import { DialogSheet } from '../session/DialogSheet';
import { PickSheet } from '../session/PickSheet';
import { SessionHeader } from '../session/SessionHeader';
import { TaskStrip } from '../session/TaskStrip';
import { TerminalDrawer } from '../session/TerminalDrawer';
import { modelOptions, effortOptions } from '../lib/models';
import '../session/chat.css';

/** Keyboard discipline: the bottom inset the on-screen keyboard covers. The
 *  screen pads its shell by this much so the composer stays above the
 *  keyboard and the list shrinks in place — focusing the box never scrolls
 *  the chat away. Thin wrapper over the shared lib/keyboard hook (kept as a
 *  named export — tests and later tasks import it from here). */
export function useKeyboardInsets(): number {
  return useKeyboardInset({ pinTop: true });
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
  const tasks = useStore((s) => s.tasks);
  // This session's fleet entry — live name, account, dialogPending badge.
  const live = useFleet((s) => s.sessions.find((x) => x.id === id) ?? null);

  const kbInset = useKeyboardInsets();
  const [restarting, setRestarting] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // Lifecycle surfaces behind the header's overflow menu.
  const [swapOpen, setSwapOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [picker, setPicker] = useState<'model' | 'effort' | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Session sockets live with the screen: resume rides `?since=` on return.
    useStore.getState().connect();
    return () => useStore.getState().disconnect();
  }, [useStore]);

  // Published on :root, not on .chat — ToastHost is not inside this subtree, and
  // custom properties only inherit downward. Cleared on unmount so the fleet
  // screen keeps the plain offset.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--composer-h', `${Math.round(entry!.contentRect.height)}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--composer-h');
    };
  }, []);

  // id is `${wrapper}:${project}` — the header's identity before /ws/fleet lands.
  const wrapperFromId = id.split(':', 1)[0] ?? id;
  const project = live?.project ?? (id.slice(wrapperFromId.length + 1) || id);
  const wrapper = live?.wrapper ?? wrapperFromId;
  const acctVar = accountColorVar(wrapper);
  const acct = acctVar.startsWith('--acct-') ? acctVar.slice('--acct-'.length) : undefined;

  // The stream sends status only on change — until its first frame the fleet
  // snapshot speaks for the session (same fallback the header does), so a
  // dead session is read-only and a busy one wears the caret from first paint.
  const effectiveStatus = status ?? live?.status ?? null;
  const dead = effectiveStatus === 'dead';
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

  const openTerminal = (): void => setTerminalOpen(true);

  // Model / effort are one-tap: the chooser sheets send `/model <alias>` or
  // `/effort <level>` directly (a context-window switch surfaces its own
  // confirm through DialogSheet).
  const changeModel = (): void => setPicker('model');
  const changeEffort = (): void => setPicker('effort');
  const pick = async (command: string): Promise<void> => {
    setPicker(null);
    try {
      await api.prompt(id, command);
    } catch (err) {
      toast(`Couldn't apply that — ${apiErrorText(err)}`, 'error');
    }
  };

  const stopSession = async (): Promise<void> => {
    try {
      await api.stop(id);
    } catch (err) {
      toast(`Couldn't stop the session — ${apiErrorText(err)}`, 'error');
    }
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
        onChangeModel={changeModel}
        onChangeEffort={changeEffort}
        onMoveAccount={() => setSwapOpen(true)}
        onStopSession={() => setStopOpen(true)}
        // No-op until Task 17 mounts ReapSheet off it from the merged phase.
        onReapWorkspace={() => {}}
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
            id={id}
            events={events}
            pending={pending}
            busy={effectiveStatus === 'busy'}
            onRetry={(key) => useStore.getState().retry(key)}
            onDiscard={(key) => useStore.getState().discard(key)}
          />
        )}
      </div>

      {/* Sits between the conversation and the composer — where the TUI puts it,
          directly above the prompt you're about to type into. */}
      <TaskStrip tasks={tasks} />

      {/* Plain measuring shell so ToastHost's --composer-h offset has something
          to observe — Composer.tsx itself carries no ref to forward. */}
      <div ref={composerRef} className="composer-measure">
        <Composer
          // send/resolve take the same opts shape the store does, so both cross
          // straight through — attachments included.
          onSend={useStore.getState().send}
          pending={pending}
          id={id}
          disabled={dead}
          placeholder={dead ? 'Restart the session to send' : `Message ${project}`}
          onResolve={useStore.getState().resolve}
        />
      </div>

      <DialogSheet id={id} store={useStore} onOpenTerminal={openTerminal} />
      <PickSheet
        open={picker === 'model'}
        onClose={() => setPicker(null)}
        eyebrow="model"
        title="Choose a model"
        options={modelOptions(live?.wrapper ?? wrapperFromId, live?.model ?? null)}
        onPick={(c) => void pick(c)}
      />
      <PickSheet
        open={picker === 'effort'}
        onClose={() => setPicker(null)}
        eyebrow="effort"
        title="Reasoning effort"
        options={effortOptions(live?.wrapper ?? wrapperFromId, live?.effort ?? null, live?.ultracode ?? false)}
        onPick={(c) => void pick(c)}
      />
      <SwapSheet
        session={live ?? { id, wrapper, project }}
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        fleet={useFleet}
      />
      <QuickConfirm
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        title="Stop this session?"
        consequence="The session goes offline until you start it again. Its conversation is kept."
        confirmLabel="Stop session"
        onConfirm={() => void stopSession()}
      />
      <TerminalDrawer id={id} open={terminalOpen} onClose={() => setTerminalOpen(false)} />
    </div>
  );
}
