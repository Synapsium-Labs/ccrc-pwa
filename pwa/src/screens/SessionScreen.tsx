// Session screen (route `/s/:id`) — a thin renderer over the per-session
// store: SessionHeader (live name, interrupt keycap, terminal keycap),
// banners for every degraded state (offline, dead/read-only, missing
// transcript), the chat list, and the optimistic composer. The fleet store
// (connected app-wide in app.tsx) supplies the header's live identity.
// DialogSheet and the TerminalDrawer mount at the bottom.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { substrateFault } from '../../../shared/api';
import { QuickConfirm } from '../components/QuickConfirm';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { SwapSheet } from '../fleet/SwapSheet';
import { accountHue, accountLabel } from '../lib/accounts';
import { api, ApiError, apiErrorText } from '../lib/api';
import { useKeyboardInset } from '../lib/keyboard';
import { navigate } from '../lib/router';
import { ack } from '../lib/seen';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { getSessionStore, type SessionStore } from '../stores/session';
import { ChatList } from '../session/ChatList';
import { Composer } from '../session/Composer';
import { DialogSheet } from '../session/DialogSheet';
import { MailStrip } from '../session/MailStrip';
import { PickSheet } from '../session/PickSheet';
import { ReapSheet } from '../session/ReapSheet';
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
  const strandedAccount = useStore((s) => s.strandedAccount);
  const searchComplete = useStore((s) => s.searchComplete);
  const tasks = useStore((s) => s.tasks);
  const mail = useStore((s) => s.mail);
  // Build 4 Task 18, spec §2.3: the ask card's second derivation source. A
  // live `ask` (hook envelope) and a live `dialog` (scraped pane menu) are
  // hosted by the SAME sheet, so either one makes a resultless ask card
  // answerable — and neither, on its own, says which question it belongs to,
  // which is why the card's own `tool_result` wins over both.
  const liveAsk = useStore((s) => s.ask);
  const liveDialog = useStore((s) => s.dialog);
  const askPending = liveAsk !== null || liveDialog !== null;
  // This session's fleet entry — live name, account, dialogPending badge.
  const live = useFleet((s) => s.sessions.find((x) => x.id === id) ?? null);
  const roster = useFleet((s) => s.roster);

  const kbInset = useKeyboardInsets();
  const [restarting, setRestarting] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // D-B4-13's nonce. Bumped by the transcript's one `Answer` control; read by
  // `DialogSheet` to clear a dismissal the reader had made. It carries no
  // answer and cannot send — raising the sheet is the entire contract.
  const [raise, setRaise] = useState(0);
  // Lifecycle surfaces behind the header's overflow menu.
  const [swapOpen, setSwapOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [picker, setPicker] = useState<'model' | 'effort' | null>(null);
  const [reapOpen, setReapOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Session sockets live with the screen: resume rides `?since=` on return.
    useStore.getState().connect();
    return () => useStore.getState().disconnect();
  }, [useStore]);

  // Opening a session IS the ack — the honest signal that a human looked.
  // Keyed on `id`, not fired only once: navigating from one session straight
  // to another (no intervening fleet-screen visit) mounts this component
  // fresh with a new `id`, and that session is exactly as "seen" as one
  // reached via the fleet list.
  //
  // `bucketSince` rides along and is in the deps for two reasons. It floors
  // the stamp against the FLEET HOST's clock (seen.ts's `stampFor`: a device
  // running behind writes an ack older than the episode it just read, and the
  // badge never clears). And on a deep link the fleet snapshot has not landed
  // at mount, so the first fire has no episode to floor to — this re-fires
  // once it arrives. It is not a per-tick write: the dep is the timestamp
  // itself, so it fires only when the session actually enters a new episode,
  // which is exactly the episode this open screen is showing its human.
  const bucketSince = live?.bucketSince ?? null;
  useEffect(() => {
    ack(id, Date.now(), bucketSince);
  }, [id, bucketSince]);

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
  // A direct roster lookup, not a re-parse of a colour-token NAME: this used
  // to derive `data-acct` by stripping `--acct-` off `accountColorVar`'s
  // return value, which worked only for a wrapper whose colour happened to be
  // an `--acct-*` token. `claude-dev0`'s `colorVar` used to be the non-hue
  // `--ink-tertiary` (no account had it as a real hue), so the strip found no
  // `--acct-` prefix, `acct` came back `undefined`, and dev0 rendered in
  // `claude`'s cyan — a real user-visible bug this lookup closes, since
  // `accountHue` returns `undefined` for an unrostered wrapper and nothing
  // else.
  //
  // `'unknown'`, never a bare `undefined` here (fix round 1, finding 4): an
  // `undefined` value makes React omit the `data-acct` attribute entirely, no
  // `[data-acct]` rule in tokens.css matches, and `--acct-active` is left at
  // `:root`'s default — which is `--acct-cyan`. Before the roster arrives (or
  // for a wrapper it genuinely does not carry), every OTHER account used to
  // flash cyan — a real hue that reads as "this is the claude account" rather
  // than "unknown" — for exactly as long as the first `/api/accounts` poll
  // takes. `[data-acct='unknown']` (tokens.css) rebinds `--acct-active` to
  // neutral ink instead, the same fallback pair `accountColorVar` and
  // `SwapSheet`'s `AccountRow` already use for a hue-less wrapper.
  const acct = accountHue(roster, wrapper) ?? 'unknown';

  // The stream sends status only on change — until its first frame the fleet
  // snapshot speaks for the session (same fallback the header does), so a
  // dead session is read-only and a busy one wears the caret from first paint.
  const effectiveStatus = status ?? live?.status ?? null;
  const dead = effectiveStatus === 'dead';
  const loading = uuid === null && missingFile === null;
  // An UNMEASURED absence is not an empty chat. When the resolver could not
  // finish looking (§5.2's `searchComplete: false`, which §5.5 makes routine
  // in remote mode) the banner below states the real fact and this screen
  // says nothing further — "No messages yet" over a host nobody could read is
  // exactly the confident empty chat this spec exists to delete. A COMPLETE
  // search that found nothing keeps the empty state: there genuinely is no
  // transcript, and that is worth saying.
  const empty = !loading && events.length === 0 && pending.length === 0 && searchComplete;

  // The substrate gate (spec §4): under a standing fault the console cannot
  // SEE this session, so the two destructive controls this screen owns — the
  // dead banner's Restart and the stop confirm — refuse rather than fire at a
  // pane nobody can measure. Read through `substrateFault`, never
  // `live.substrate`: the live frame is cast, not revived, so an older
  // server's row lacks the key at runtime. `faultTitle` is SessionLine's
  // chip's own `tmux unreachable — <reason>` string, never a second copy.
  const fault = live === null ? null : substrateFault(live);
  const faultTitle = fault !== null ? `tmux unreachable — ${fault.text}` : undefined;

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
    // The gate's confirm-path half. The header's Stop menu item is already
    // disabled under a fault, but the fleet frame updates LIVE beneath an
    // open confirm and QuickConfirm owns its own button — so the fault is
    // re-checked at the moment of firing, and the refusal is named (the same
    // one string) rather than swallowed. Guarded on `faultTitle`, the one
    // composition site, so TS ties the toast to the check without a second
    // copy of the template.
    if (faultTitle !== undefined) {
      toast(faultTitle, 'error');
      return;
    }
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
        roster={roster}
        onInterrupt={() => void interrupt()}
        onOpenTerminal={openTerminal}
        onBack={() => navigate('/')}
        onChangeModel={changeModel}
        onChangeEffort={changeEffort}
        onMoveAccount={() => setSwapOpen(true)}
        onStopSession={() => setStopOpen(true)}
        onReapWorkspace={() => setReapOpen(true)}
        fallback={{ title: project, wrapper }}
      />

      {conn === 'down' && (
        <div className="chat-banner chat-banner--offline" role="status">
          Reconnecting…
        </div>
      )}

      {/* Rung 6 landed (§5.1, §5.2): the transcript being tailed lives under
          ANOTHER account's config dir — history a pre-fix swap left frozen
          where it was (M2: 17 of 23 rows carry residue like this on disk
          right now). It is real history and it renders; it is never rendered
          SILENTLY, because the operator has to know whose file this is before
          reading it as this account's conversation.

          The NAME degrades, the disclosure does not (final review, Minor 5).
          `foreignAccount` arrives on a cast frame from an independently
          versioned server, and an empty string sails through both the store's
          `?? null` and this `!== null` gate — measured at HEAD as "read from
          , not this session's own account." Suppressing the banner for it
          would trade a cosmetic defect for the exact silence D4 is about: a
          server saying "this came from somewhere else" but failing to say
          where is still a disclosure the operator needs. `accountLabel`
          already falls back to the raw id for a wrapper the roster does not
          have; this is the one step past that, where there is no id either. */}
      {strandedAccount !== null && (
        <div className="chat-banner" data-stranded="true" role="status">
          <span className="banner-copy">
            {`Stranded history — read from ${accountLabel(roster, strandedAccount).trim() || 'another account'}, not this session's own account.`}
          </span>
        </div>
      )}

      {/* Two different facts, two different sentences. A COMPLETE search that
          found nothing keeps today's wording. An INCOMPLETE one says the host
          could not be read — never "there is no transcript", which is the
          overloaded-null rule (b) forbids at a seam. */}
      {missingFile !== null && (
        <div className="chat-banner chat-banner--missing" role="status">
          <span>
            {searchComplete
              ? "Can't find this session's transcript"
              : "Can't read the fleet host right now"}
          </span>
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
            disabled={restarting || fault !== null}
            title={faultTitle}
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
            askPending={askPending}
            onAnswer={() => setRaise((n) => n + 1)}
          />
        )}
      </div>

      {/* Above the plan, which stays the composer's neighbour. */}
      <MailStrip mail={mail} />

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

      <DialogSheet id={id} store={useStore} onOpenTerminal={openTerminal} raise={raise} />
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
        // `home: null` — not `wrapper`. With no live row there is no home
        // account to read, and W3 §3.4's copy names the account a swap returns
        // to; naming the one it is leaving would be a guess wearing a fact's
        // clothes. `SwapSheet` renders the unnamed form for null.
        //
        // `held` is OMITTED from the synthetic row for the same reason, and
        // the omission is the answer, not an oversight (see `SwapSheetProps`):
        // a hold is read off the live fleet row, there is no live fleet row
        // here, so nobody measured it. `held: null` would claim this session
        // is unheld and earn it §3.4's unconditional return promise — which
        // §3.3 made false for a held session. The sheet hedges instead.
        session={live ?? { id, wrapper, project, home: null }}
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
      <ReapSheet
        session={live}
        open={reapOpen}
        onClose={() => setReapOpen(false)}
        onReaped={() => { setReapOpen(false); navigate('/'); }}
      />
    </div>
  );
}
