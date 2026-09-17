// Session screen (route `/s/:id`) — a thin renderer over the per-session
// store: SessionHeader (live name, interrupt keycap, terminal keycap),
// banners for every degraded state (offline, dead/read-only, missing
// transcript), the chat list, and the optimistic composer. The fleet store
// (connected app-wide in app.tsx) supplies the header's live identity.
// DialogSheet and the TerminalDrawer mount at the bottom.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { substrateFault, type RouteField } from '../../../shared/api';
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
import { HistoryTab } from '../session/HistoryTab';
import { TaskStrip } from '../session/TaskStrip';
import { TerminalDrawer } from '../session/TerminalDrawer';
import { modelOptions, effortOptions, modelReadbackFor, effortIsKnown, type PickOption } from '../lib/models';
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
  const fileMeasured = useStore((s) => s.fileMeasured);
  const file = useStore((s) => s.file);
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
  // D-286 (was D-B4-13)'s nonce. Bumped by the transcript's one `Answer` control; read by
  // `DialogSheet` to clear a dismissal the reader had made. It carries no
  // answer and cannot send — raising the sheet is the entire contract.
  const [raise, setRaise] = useState(0);
  // Lifecycle surfaces behind the header's overflow menu.
  const [swapOpen, setSwapOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [picker, setPicker] = useState<'model' | 'effort' | null>(null);
  const [reapOpen, setReapOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  // A routing write in flight, until the fleet frame reads it back — or 60s
  // pass with no confirmation (routing spec §5.3, slice 4, Task 5). `readback`
  // rides along so the read-back effect below never has to re-derive the
  // option list that produced this write.
  const [queued, setQueued] = useState<{ field: RouteField; value: string; readback: string } | null>(null);
  const queuedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearQueuedTimer = (): void => {
    if (queuedTimer.current !== null) {
      clearTimeout(queuedTimer.current);
      queuedTimer.current = null;
    }
  };
  useEffect(() => clearQueuedTimer, []);

  // The read-back half: a fleet frame that agrees with a queued write clears
  // it (and the timeout that would otherwise clear it at 60s with the
  // unconfirmed toast). `effort` compares the live level directly (or
  // `live.ultracode` for the `ultracode` value, since that is a separate
  // boolean on the wire, not an effort string); `class` compares the queued
  // row's `readback` key against the live model string the same loose way
  // `modelOptions`' own `active` highlight already does.
  useEffect(() => {
    if (queued === null) return;
    const agrees = queued.field === 'effort'
      ? (queued.value === 'ultracode' ? live?.ultracode === true : live?.effort === queued.value)
      : (live?.model ?? '').toLowerCase().includes(queued.readback);
    if (agrees) {
      clearQueuedTimer();
      setQueued(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, live?.effort, live?.ultracode, live?.model]);

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

  // Routing slice 6, Task 4: once `live.route` rides the wire, the pickers'
  // active row and the header's queued badge are DERIVED from it instead of
  // this screen's own optimistic `queued` state below. `route: null` (an
  // older ccd, or a session it has never routed) leaves every line here
  // inert and `queuedField` below falls through to exactly today's
  // behaviour — S6-R4's "nothing changes" contract.
  const routeInfo = live?.route ?? null;
  const classIntended = routeInfo?.fields.class ?? null;
  const effortIntended = routeInfo?.fields.effort ?? null;
  const classInert = routeInfo?.inert.includes('class') ?? false;
  const effortInert = routeInfo?.inert.includes('effort') ?? false;
  // The intended value's readback vs. the live read-back: `live.effort`
  // directly for effort (`ultracode` is its own boolean, not an effort
  // string — the same split `pick`'s own read-back effect already makes),
  // the model display name for class, reusing `modelOptions`' own loose
  // comparison through `modelReadbackFor`. An INERT field is never
  // "queued" — ccd will not apply it on this lane, so there is nothing for a
  // badge to wait on (`PickSheet` marks its row `inertOnThisLane` instead).
  //
  // Fix round 1, finding 1: two more conditions never light this badge,
  // mirroring the pre-existing LOCAL-write carve-out below (`pick`'s own
  // "neither value leaves a mark the pane can read back" comment) instead of
  // leaving the wire path with none of it:
  //   - `effort: 'auto'` / `class: 'default'` are ccd's absent-equivalents
  //     (`ccd/ccd:16189-16192`'s `_route_apply_now` types NOTHING for
  //     `auto` — "the live level stands" — so `live.effort` can never read
  //     back `auto`, and a wrapper's own default has no distinguishing
  //     model string `default` could ever match). Both AGREE unconditionally.
  //   - an intended value that names no row on THIS wrapper's own option
  //     list (`effortIsKnown` false, or `modelReadbackFor` null) is a word
  //     ccd itself will never confirm here — a rejected/stale/foreign-build
  //     registry value (the registry read behind `route` is deliberately
  //     unvalidated). Nothing on this pane can ever read it back, so it is
  //     UNMEASURABLE, not queued forever: no picker row highlights it either
  //     (`activeFor`/`modelOptions`'s exact-match `active` finds no row),
  //     so a permanent badge next to no active row is doubly wrong.
  const wireQueuedField: RouteField | null = routeInfo === null ? null : (() => {
    if (effortIntended !== null && !effortInert && effortIntended !== 'auto' && effortIsKnown(wrapper, effortIntended)) {
      const agrees = effortIntended === 'ultracode' ? live?.ultracode === true : live?.effort === effortIntended;
      if (!agrees) return 'effort';
    }
    if (classIntended !== null && !classInert && classIntended !== 'default') {
      const readback = modelReadbackFor(wrapper, classIntended);
      const agrees = readback !== null && (live?.model ?? '').toLowerCase().includes(readback);
      if (readback !== null && !agrees) return 'class';
    }
    return null;
  })();
  // Exclusively one source or the other, never both: with `route` present the
  // wire is the sole answer (a stale local write must not re-light a badge
  // the wire already cleared); with `route: null`, today's local state.
  const queuedField: RouteField | null = routeInfo !== null ? wireQueuedField : (queued?.field ?? null);
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
  // exactly the confident empty chat this spec exists to delete. `fileMeasured`
  // gates the same way, one seam further in: a search can finish and still not
  // have measured the transcript itself (D-114). A COMPLETE, MEASURED search
  // that found nothing keeps the empty state: there genuinely is no
  // transcript, and that is worth saying.
  const empty = !loading && events.length === 0 && pending.length === 0 && searchComplete && fileMeasured;

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

  // Model / effort are one-tap: the chooser sheets write the routing record
  // (`api.route`) and ccd types it into the pane, session-only keystrokes —
  // never a slash command sent straight from here (a context-window switch
  // still surfaces its own confirm through DialogSheet).
  const changeModel = (): void => setPicker('model');
  const changeEffort = (): void => setPicker('effort');
  const pick = async (o: PickOption): Promise<void> => {
    setPicker(null);
    // The timer is installed in the SAME statement sequence as `setQueued`,
    // before the `await` below (fix round 1, finding 1) — not after the
    // write resolves. A fleet frame (or `route --apply`'s own pane keystroke)
    // can read the write back WHILE the HTTP request is still in flight, and
    // the read-back effect's `clearQueuedTimer()` has to find a real timer at
    // that moment or the resumed continuation below installs a fresh one for
    // a write that is already confirmed — a false 60s "not confirmed" toast.
    // Installing it here also means this call's own leading
    // `clearQueuedTimer()` always cancels a PRIOR pick's real timer, never a
    // not-yet-installed one, so a fast second tap can no longer leak the
    // first pick's handle.
    clearQueuedTimer();
    setQueued({ field: o.route.field, value: o.route.value, readback: o.readback });
    queuedTimer.current = setTimeout(() => {
      setQueued(null);
      toast('Routing queued; the pane has not confirmed it yet');
    }, 60_000);
    try {
      await api.route(id, o.route.field, o.route.value);
      // Neither value leaves a mark the pane can read back — `auto` clears no
      // slider position it can be measured against, and `default` is what the
      // wrapper falls back to with no distinguishing model string of its own.
      // Absence, not a lie, so the 2xx response IS the confirmation. The
      // timer installed above must be cancelled here too, or it outlives its
      // own confirmation and fires the false toast 60s later.
      if ((o.route.field === 'effort' && o.route.value === 'auto')
          || (o.route.field === 'class' && o.route.value === 'default')) {
        clearQueuedTimer();
        setQueued(null);
      }
    } catch (err) {
      clearQueuedTimer();
      setQueued(null);
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
        queuedField={queuedField}
        onMoveAccount={() => setSwapOpen(true)}
        onStopSession={() => setStopOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
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

      {/* Two different facts, two different sentences. A COMPLETE, MEASURED
          search that found nothing keeps today's wording. An INCOMPLETE
          search, or a complete one that could not measure the transcript
          itself (D-114), says the host could not be read — never "there is
          no transcript", which is the overloaded-null rule (b) forbids at a
          seam. `!fileMeasured` alone (missingFile === null, missing: false)
          reaches this banner too — the fourth combination, a present
          transcript whose bytes could not be read. */}
      {(missingFile !== null || !fileMeasured) && (
        <div className="chat-banner chat-banner--missing" role="status">
          <span>
            {searchComplete && fileMeasured
              ? "Can't find this session's transcript"
              : "Can't read the fleet host right now"}
          </span>
          <span className="banner-path">{missingFile ?? file ?? ''}</span>
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
        options={modelOptions(wrapper, live?.model ?? null, routeInfo ? { intended: classIntended, inert: classInert } : undefined)}
        onPick={(o) => void pick(o)}
      />
      <PickSheet
        open={picker === 'effort'}
        onClose={() => setPicker(null)}
        eyebrow="effort"
        title="Reasoning effort"
        options={effortOptions(
          wrapper, live?.effort ?? null, live?.ultracode ?? false,
          routeInfo ? { intended: effortIntended, inert: effortInert } : undefined,
        )}
        onPick={(o) => void pick(o)}
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
      <HistoryTab id={id} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ReapSheet
        session={live}
        open={reapOpen}
        onClose={() => setReapOpen(false)}
        onReaped={() => { setReapOpen(false); navigate('/'); }}
      />
    </div>
  );
}
