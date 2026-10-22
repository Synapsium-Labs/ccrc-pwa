// Dialog bottom sheet — where the TUI menu becomes native (DIRECTION.md).
// Springs up whenever the session stream delivers a dialog. Parsed menus
// render as big tappable rows carrying the same mono index digits ccd's
// actual TUI answers to; the preselected row wears the ❯ cursor on the
// accent tint. Tapping shows an optimistic "answering…" and replays the
// arrow-walk server-side; the sheet only closes when `dialog_cleared`
// confirms the answer landed. A stale 409 toasts and re-renders from the
// store. Unparsed panes render raw in a well and point to the terminal.
// Scrim/Esc/swipe merely HIDE the sheet — the header badge and fleet card
// keep signalling dialogPending — and are refused while an answer is in
// flight.
//
// When the pane menu is an AskUserQuestion the server attaches `ask`: the real
// question, a header chip, and per-option descriptions/previews the 3-line TUI
// box had to truncate. That copy is decoration ONLY — enrichment is matched by
// POSITION, and the option index typed at the pane always comes from the pane.
// Rows the transcript doesn't cover (the TUI's own "Chat about this") keep
// their scraped label — and so do rows the server sends as `null`, the
// positions it matched loosely enough to accept the question but not loosely
// enough to believe the copy.
//
// Task 8 (PR C): the session store ALSO carries a hook-sourced envelope
// (`ask: HookAsk | null`, fed by the `ask`/`ask_cleared` stream frames —
// shared/api.ts's SessionStreamMsg comment has the transport rationale). It is
// a DIFFERENT thing from the `Dialog.ask` enrichment above: that one decorates
// a scraped menu whose OPTIONS still come from the pane; this one is the
// render content itself, on its own clock, and can exist with no scraped
// `dialog` at all (or disagree with one transiently — the two are read
// independently, see the type's own doc comment). Whenever it is present the
// sheet renders it INSTEAD of the scraped dialog (`EnvelopeSheet` below),
// tagged `data-source="hook"` for tests; `ask_cleared` empties it and the
// sheet falls back to whatever scraped dialog is still pending, unchanged
// from before this task. SEND still goes through the exact same functions the
// scraped path already uses below: `answer()`'s answerDialog walk for
// numbered options (envelope option N calls `answer(N + 1)`, so "Allow" is
// `answer(1)` — Claude Code's own confirm dialogs put "Yes" first) and
// `api.interrupt()`'s literal Escape for "Deny" — Claude Code's own hint for
// declining a permission confirm, independent of how many options it has.
// Those two are the only paths that can reach a live pane menu without typing
// into it: `sendPrompt` refuses outright while one is up (send.ts's `hasMenu`
// guard), so a permission confirm — which IS a menu — cannot be answered by
// sending literal text. D-5090: neither is an AskUserQuestion's own-words
// answer, which goes through the question's free-text row (see below).
//
// Fix round 1 (review of the above): the envelope was failing CLOSED in
// exactly the scrape-failure mode it exists to cover. Four corrections, all
// PWA-side:
//  - Dismissal parity: the envelope now shares the SAME dismissedKey/open/
//    hide machinery as the scraped sheet below (a hash of the envelope's own
//    JSON stands in for the id HookAsk doesn't carry) — scrim/Esc/swipe hide
//    it exactly as they hide a scraped dialog, refused while a send is in
//    flight, and the header badge/fleet card keep signalling regardless
//    (nothing here ever touches the store).
//  - Fail-visible, not fail-silent: `answer()` needs a live scraped `dialog`
//    to target (it re-parses the pane), so whenever `dialog` is null the
//    envelope's rows/Allow render VISIBLY DISABLED with the same "Open
//    terminal to answer"/"Not now" CTA the unparsed-scraped branch already
//    uses, instead of a tap that quietly does nothing.
//  - Only the FIRST question in a multi-question envelope is tappable — the
//    digit space answerDialog walks is one live menu's worth at a time,
//    matching what's actually on screen; later questions render read-only.
//    SUPERSEDED by D-5089 (plan 2026-10-15-ask-sheet-half.md, Task 2): the
//    pane paints one question at a time, so "the first" left every later
//    question and the review screen unanswerable. The tappable question is
//    now the one the PANE is painting (`askLive.ts`'s `liveQuestion`), the
//    others are listed read-only, and the review's own rows are offered.
//  - A blank/empty envelope (no questions, or a blank first question) has
//    nothing accessible of its own to show, so it is treated as absent and
//    the sheet falls through to the scraped dialog entirely.
//
// Fix round 2 (review of fix round 1): the "Open terminal to answer" CTA's
// handler was calling `close(); onOpenTerminal?.();` — `close()` refuses to
// HIDE while busy, but nothing stopped the navigation running right after it
// regardless, so a busy Deny (reachable with `dialog` still null) could still
// jump to the terminal. `EnvelopeSheet`'s `openTerminal` now gates the whole
// handler on `busy` once, not just the hide half of it.
//
// Fix round 3 (review of fix round 2 — Critical): `canAnswer` was `dialog !==
// null` and nothing else — it let a live pane menu answer a DIFFERENT
// question than the one on screen. A multi-question AskUserQuestion paints
// one question at a time, but the hook writes ALL questions at once and
// clears only on working/done, so while the pane shows question 2 the sheet
// could still show question 1's rows enabled; a tap then walked question 2's
// menu to question 1's index. Wrong answer, sent silently. `canAnswer` is now
// a real correspondence check, not a null check:
//  - Questions: `questionCorresponds` (`askLive.ts`) requires `dialog`
//    to be non-null, PARSED, and to have an option at every position the
//    envelope's first question does, each one a normalized prefix-match
//    (case/whitespace-insensitive, either side may be the truncated one —
//    the same rule server/src/transcript/ask.ts's `pairMatches` uses to
//    identify a question in the first place, reimplemented here rather than
//    imported since the pwa doesn't depend on server code).
//  - Approval: Allow requires `dialog.parsed` and its first option to read
//    like "Yes" — turning this file's own longstanding comment ("Claude
//    Code's own confirm dialogs put Yes first") from an assumption into an
//    assertion, since that's exactly what `answer(1)` bets on.
// Either way a non-match renders the same as `dialog === null` always did:
// rows/Allow disabled behind the "Open terminal to answer"/"Not now" CTA —
// fail-visible, not fail-silent, same principle as fix round 1's #2, just
// closing the gap that check left open.
//
// Known limitation, named rather than fixed (cross-channel, cheap to know
// about, not cheap to restructure): `dismissedKey` is ONE slot shared by two
// different identity spaces — a scraped `dialog`'s id, and a hash of the
// envelope's JSON (see `askKey`). Dismissing the envelope sets `dismissedKey`
// to the envelope's hash; if the SAME underlying question is also scraped
// (its `dialog.id` is a different string, hashed from pane text, not JSON),
// that scraped dialog is NOT suppressed by the same dismissal and can pop
// back open on its own poll cycle (~2 s) once `ask_cleared` (or a content
// change) drops the envelope out of the way. One dismissal does not
// necessarily mean "hidden" across both channels at once — only within
// whichever one is currently being displayed.
// D-5089 closed the half of this that the envelope's age-out reaches: hiding
// the envelope also records the id of the pane dialog live at that moment
// (`dismissedDialogId`), and the scraped sheet stays shut on that id, so an
// ask the operator waved away does not pop back when `ask_cleared` hands the
// same pane question over 30 minutes in. A new question has a new id and
// opens; the `raise` nonce clears both slots.
//
// D-5090 (plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 3):
// own words answer an AskUserQuestion THROUGH its free-text row
// (`api.answerDialogText`, D-5047), in both sheets (`AskParts.tsx`'s
// `OwnWords`). The reply this file used to send pressed the pane's `Chat about
// this` row, which declines the WHOLE ask, then typed the text as a new prompt
// while Claude carried on, and emptied the box before trying; it is deleted,
// with the rule it matched that row by. The scraped sheet no longer offers the
// empty `Type something.` row as a tap (Enter on it rejects the whole ask). The
// own-words text and its call live HERE, keyed to the call and never to
// `dialog.id`, which the typing itself changes: so the stream's frame of the
// typed row cannot reset a send mid-call, and an `ask_cleared` mid-call hands
// the same text and call to the scraped sheet.
//
// D-5091 (Task 4): a multiSelect question the pane carries as `Dialog.multi`
// is answered as boxes, in both sheets (`AskParts.tsx`'s `MultiPick`): the
// commit sends the whole set through `api.answerDialogMulti` (D-5048). The
// operator's set and the commit's call live HERE too, for the same two
// reasons: the boxes repaint under the same id while the server ticks them,
// and an `ask_cleared` mid-commit hands the same set and call to the scraped
// sheet.
//
// D-6325 (plan docs/superpowers/plans/2026-10-22-desktop-polish.md, Task T1b): every surface below is chosen by ONE pure
// function, `askSource` (`askLive.ts`), and renders its answer; no string the pane painted reaches an
// AskUserQuestion. This file stays the one controller and the one sender, and its branches are now: nothing; the
// approval and the structured question (both `EnvelopeSheet`, the hook's envelope or the transcript's copy of the
// question); the review (one render here for every source of copy); a question this screen cannot read (it says so and
// offers the terminal); a menu that is no ask (its parsed rows, `Claude needs a choice`); and an unparsed pane (the
// terminal). The history above describes the scraped sheet that took over when the envelope aged out; that sheet, its
// preamble, its raw well and its own-words machinery are gone, and a hand-off on `ask_cleared` now lands on the
// structured sheet from the transcript's copy, or on the unreadable one. The own-words text, the picks and the senders
// stay HERE, so that hand-off (and a change of source) keeps them.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, DialogTabTarget } from '../../../shared/api';
import { parseAskTabs } from '../../../shared/ask-menu';
import { OptionRow, Sheet, toast } from '@ccrc/ui';
import { EnvelopeSheet, TerminalCta } from './EnvelopeSheet';
import {
  AskHeader, AskReview, AskTabs, REVIEW_TITLE, escapeHidesOnly, keyed, lit, picksBusy, wordsBusy, type Asker,
  type PickCall, type Picks, type Words, type WordsCall,
} from './AskParts';
import {
  askScreen, askSource, freeTextSlot, isUsableAsk, paneTicks, picksUncommitted, questionKey, slotHolds,
} from './askLive';
import { keyTabs, questionKeys, reviewKeys, rowKey, type KeyScreen } from './askKeys';
import { dialogMultiRefusal, dialogRefusal, dialogTabRefusal, dialogTextRefusal } from './askWords';
import { useAskKeys } from './useAskKeys';
import { api, ApiError } from '../lib/api';
import { getSessionStore, type SessionStore } from '../stores/session';
import './chat.css';

/** No own-words text, and no call. */
const NO_WORDS: { text: string; call: WordsCall | null } = { text: '', call: null };

/** No box touched, and no commit. `id` is the question (dialog id) `picked` belongs to: a set is never carried from
 *  one question to another. */
const NO_PICK: { id: string | null; picked: readonly number[] | null; call: PickCall | null } = {
  id: null, picked: null, call: null,
};

/** Does `dialog` show the question `call` was made for (`questionKey`)? */
const showsQuestion = (dialog: Dialog | null, call: WordsCall): dialog is Dialog =>
  dialog !== null && questionKey(dialog, call.row) === call.question;

/** Does `dialog` still show the question `call` typed into, its free-text row holding exactly `text`? That is the
 *  typed row of this very send (the stream may deliver it after the call answered), not other text, and not a new
 *  question. */
const showsSent = (dialog: Dialog | null, call: WordsCall, text: string): boolean =>
  showsQuestion(dialog, call) && slotHolds(freeTextSlot(dialog, call.row - 1), text);

export interface DialogSheetProps {
  id: string;
  /** Injectable for tests; defaults to the shared per-session store. */
  store?: SessionStore;
  /** Unparsed dialogs escalate here (TerminalDrawer once Task 12 lands). */
  onOpenTerminal?: () => void;
  /**
   * A NONCE, not a flag (D-286 (was D-B4-13)). `dismissedKey` below is component-local
   * state, so a control outside this component — the transcript's `Answer`,
   * Build 4 Task 18 — had no way to re-open a sheet the reader had waved
   * away. Bumping this clears the dismissal and nothing else: no store change
   * and, above all, no second answer path. `EnvelopeSheet` stays the one
   * hardened sender, and this is what lets the transcript's one control mean
   * exactly "open it", with no ability to send.
   *
   * `0` is inert, so an ordinary mount never un-dismisses anything.
   */
  raise?: number;
  /** D-6325, R4: who asks (the session, its project, and the held line while a coordinator holds the question), for the
   *  header every surface draws. Null or absent: no who line. */
  asker?: Asker | null;
}


export function DialogSheet({ id, store, onOpenTerminal, raise, asker = null }: DialogSheetProps): ReactNode {
  const useStore = store ?? getSessionStore(id);
  const dialog = useStore((s) => s.dialog);
  /** Decision `ask-answer-returns-next-screen`: an answer route's `next`, into the store (`applyAnswered`). */
  const applyAnswered = (answeredId: string, next: Dialog | null): void => useStore.getState().applyAnswered(answeredId, next);
  const hookAsk = useStore((s) => s.ask);
  const askFrameSeen = useStore((s) => s.askFrameSeen);
  // D-6325: what an ask surface may show, decided once per render and before any branch returns (hooks run every
  // render). Everything below renders from it.
  const source = askSource({ ask: hookAsk, dialog, askFrameSeen });

  // The option index whose answer is in flight (null = none).
  const [answering, setAnswering] = useState<number | null>(null);
  // The identity of whichever content — a pane dialog's id, or a stringified hook envelope (HookAsk carries no id of
  // its own; see `askKey` below) — the user waved away with a scrim tap, Esc, or swipe. It stays hidden until something
  // with a DIFFERENT identity arrives. One slot serves both kinds of surface: only one is ever open at a time, and
  // sharing it means a dismissal survives the moment display hands off from one to the other.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // D-5089: the pane dialog that was live when the operator hid the ENVELOPE.
  // The envelope's own key is a hash of its JSON, which no pane dialog id
  // ever equals, so without this the hand-off on `ask_cleared` re-opened the
  // very question the operator had just waved away.
  const [dismissedDialogId, setDismissedDialogId] = useState<string | null>(null);
  /** The envelope's screen (`askScreen`) the sheet was hidden on; meaningful only while `dismissedKey` is that ask. */
  const [dismissedScreen, setDismissedScreen] = useState<string | null>(null);
  // D-5090: the own-words text and its call, one value so the two change together (see `WordsCall`).
  const [own, setOwn] = useState(NO_WORDS);
  // D-5091: a multiSelect question's set and its commit, one value for the same reason (see `PickCall`).
  const [pick, setPick] = useState(NO_PICK);
  // Decision `ask-dialog-tab-route`: a tab move (the arrow keys, or a tab-strip chip) is under way. It is a send like
  // any other: it refuses the others and the dismissal while it runs.
  const [tabbing, setTabbing] = useState(false);

  // A new question (or a cleared one) invalidates the in-flight marker.
  // D-5090: and ends an own-words answer that LANDED, the same way, unless the new frame is that send's own typed row
  // (captured before its Enter, delivered after its ok). A call still in FLIGHT is never touched here: the typing
  // changes the id mid-call.
  const dialogId = dialog?.id ?? null;
  // D-5091: and ends a multiSelect commit that landed, and forgets the set touched on the last question; a commit
  // still in FLIGHT keeps its call (the screen it moved on to can arrive before the call's answer), and its settle
  // decides.
  useEffect(() => {
    setAnswering(null);
    setOwn((o) => (o.call?.state === 'landed' && !showsSent(dialog, o.call, o.text) ? NO_WORDS : o));
    setPick((p) => (p.call?.state === 'flight' ? p : NO_PICK));
    // `dialog` is read at the id it belongs to; a repaint under the same id is not a new screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogId]);

  // Anything in flight: an option's answer, an own-words send or a multiSelect commit. Each refuses another send and
  // the dismissal.
  const locked = answering !== null || wordsBusy(own.call) || picksBusy(pick.call) || tabbing;
  // One send at a time, held where a send STARTS. `locked` is render state, and React commits a tap's state only after
  // its handler returns, so a second tap handled in the same tick finds every row still enabled and `locked` still
  // false: an option and then `Chat about this` (which declines the whole ask) would both be sent. `sending` is set the
  // moment a send starts (`claim`) and follows `locked` again from the next render on.
  const sending = useRef(false);
  useLayoutEffect(() => {
    sending.current = locked;
  });
  const claim = (): boolean => {
    if (sending.current) return false;
    sending.current = true;
    return true;
  };

  // D-286: the transcript asked for this sheet back. Clearing the dismissal
  // is the WHOLE effect — the sheet then opens on exactly the surface the
  // store still holds, through the same `open` computation as always, so the
  // raise cannot conjure a sheet for a question that is no longer live.
  useEffect(() => {
    if (!raise) return;
    setDismissedKey(null);
    setDismissedDialogId(null);
  }, [raise]);

  // Dismissal, per kind of surface. The hook's envelope has no id of its own: a hash of its JSON stands in for one
  // (`askKey`). Content equality is exactly what should reopen or stay dismissed here: session-hook.sh rewrites the
  // whole file on every relevant transition, so two reads that serialize the same string ARE the same question or
  // approval as far as this sheet cares, and a genuinely new one always serializes differently (a new question string,
  // a new tool/summary pair, an added/removed option, …). Decision `ask-envelope-dismissal-per-screen`: a hide hides
  // the SCREEN that was showing, never the rest of the ask. The envelope's JSON is the same for every question and the
  // review (the hook writes them all at once), so keying on it alone kept a sheet hidden on question 2 hidden through
  // the review: no Submit anywhere but the terminal. A screen is a QUESTION, or the review (`askScreen`), never a raw
  // dialog id: typing into the free-text row in the terminal, or a mid-redraw grab, repaints the same question under a
  // new id, and must not put a modal back over the terminal the operator is typing in. Only a different question or the
  // review opens it again; a screen the sheet cannot place (no menu, an unparsed grab) never does.
  // Every other surface (the transcript's copy, the review without an envelope, a menu, an unreadable ask, the
  // terminal) is the pane's, and keeps the pane dialog's id as its identity, as the scraped sheet always did.
  const envelope = isUsableAsk(hookAsk) ? hookAsk : null;
  const hooked = envelope !== null
    && (source.kind === 'approval' || (source.kind === 'structured' && source.from === 'hook') || source.kind === 'review');
  const askKey = hooked ? JSON.stringify(envelope) : null;
  // An approval is one screen; a question ask is one per question plus its review (`askScreen`).
  const screenNow = !hooked ? null : 'approval' in envelope ? (dialog === null ? null : 'approval') : askScreen(envelope, dialog);
  const open = hooked
    ? !(askKey === dismissedKey && (screenNow === null || screenNow === dismissedScreen))
    : dialog !== null && dialog.id !== dismissedKey && dialog.id !== dismissedDialogId;

  const hide = (): void => {
    if (hooked) {
      setDismissedKey(askKey);
      setDismissedScreen(screenNow);
      setDismissedDialogId(dialog?.id ?? null);
    } else if (dialog !== null) {
      setDismissedKey(dialog.id);
    }
  };

  const close = (): void => {
    // Non-dismissable while an answer is in flight — the open sheet is the
    // only honest record that the tap is still landing.
    if (locked) return;
    hide();
  };

  const answer = async (optionIndex: number): Promise<void> => {
    if (dialog === null || !claim()) return;
    setAnswering(optionIndex);
    const answered = dialog.id;
    try {
      const res = await api.answerDialog(id, answered, optionIndex);
      // Decision `ask-answer-returns-next-screen`: the route says which screen the pane moved to, so the next question
      // or the review opens now, not on the stream's next poll. Without it, stay in "answering…" until a frame lands.
      if (res.next !== undefined) applyAnswered(answered, res.next);
    } catch (err) {
      setAnswering(null);
      // Each refusal by its code (`dialogRefusal`, plan Task 5), where every 409 once read alike. A stale dialog is
      // news, not a failure where the sheet renders straight from `dialog` (a menu, which re-renders with the new one
      // right after this and "showing the latest" is literally true) — but the structured sheet renders Claude's own
      // copy, not `dialog`, and a 409 there changes nothing on screen: N1, that copy would read as a lie on that
      // branch, so it says what actually happened instead.
      const stale = err instanceof ApiError && err.message === 'stale-dialog';
      toast(dialogRefusal(err, source.kind === 'structured'), stale ? undefined : 'error');
    }
  };

  // D-5090: own words, into the free-text row printed `row`. The text is kept in the field through the call and on
  // any refusal (which says why); only an ok lets it go, once the pane has moved on. One call at a time: every Send is
  // disabled while one is under way.
  const sendWords = async (row: number): Promise<void> => {
    const current = dialog;
    const kept = own.text;
    if (current === null || !claim()) return;
    const call = { row, question: questionKey(current, row) };
    setOwn({ text: kept, call: { ...call, state: 'flight' } });
    try {
      const res = await api.answerDialogText(id, current.id, row, kept.trim());
      if (res.next !== undefined) {
        // Typing changed the screen's id, so the store may hold the typed row by now: the same question by its key.
        const held = useStore.getState().dialog;
        const same = held !== null && held.parsed && questionKey(held, row) === call.question;
        applyAnswered(same ? held.id : current.id, res.next);
      }
      // Landed. Like a tapped option, the sheet stays busy until the pane moves on — unless it already has: the next
      // screen can reach the store before the call's answer does, and must not be held busy by it.
      const now = useStore.getState().dialog;
      const waiting = now !== null && (now.id === current.id || showsSent(now, { ...call, state: 'landed' }, kept));
      setOwn(waiting ? { text: kept, call: { ...call, state: 'landed' } } : NO_WORDS);
    } catch (err) {
      setOwn({ text: kept, call: { ...call, state: 'refused' } });
      toast(dialogTextRefusal(err), 'error');
    }
  };
  const words: Words = {
    text: own.text,
    call: own.call,
    onText: (text) => setOwn((o) => ({ ...o, text })),
    onSend: (row) => void sendWords(row),
  };

  // D-5091: tick or untick a box on the sheet. The first touch seeds the set from the pane's ticks, so the operator
  // edits what the pane shows; from then the sheet's set stands until the question changes.
  const toggle = (index: number): void => {
    const current = dialog;
    if (current === null || current.multi === undefined || sending.current) return;
    const seed = paneTicks(current.multi);
    setPick((p) => {
      const base = p.id === current.id && p.picked !== null ? p.picked : seed;
      const picked = base.includes(index) ? base.filter((k) => k !== index) : [...base, index];
      return { ...p, id: current.id, picked };
    });
  };

  // D-5091: commit the WHOLE set (`wanted`, ordered as the answer will list it). Like a tapped option, the sheet stays
  // busy after ok until the pane moves on, unless it already has; a refusal says why and leaves the set sent as the
  // operator's, so trying again sends it again (the server presses only what is still needed).
  const commitPicks = async (wanted: readonly number[]): Promise<void> => {
    const current = dialog;
    if (current === null || !claim()) return;
    const call: PickCall = { dialogId: current.id, wanted, state: 'flight' };
    setPick((p) => ({ ...p, call }));
    try {
      const res = await api.answerDialogMulti(id, current.id, wanted);
      if (res.next !== undefined) applyAnswered(current.id, res.next);
      const waiting = useStore.getState().dialog?.id === current.id;
      setPick(waiting ? { id: current.id, picked: wanted, call: { ...call, state: 'landed' } } : NO_PICK);
    } catch (err) {
      setPick({ id: current.id, picked: wanted, call: null });
      toast(dialogMultiRefusal(err), 'error');
    }
  };
  const picks: Picks = {
    picked: dialog !== null && pick.id === dialog.id ? pick.picked : null,
    call: pick.call,
    onToggle: toggle,
    onCommit: (wanted) => void commitPicks(wanted),
  };

  // Decision `ask-dialog-tab-route`: move the PANE to another tab, and follow the screen it lands on (`next`), as an
  // answer's. `from` is the 1-based tab the sheet believes is up, for a numbered target. A refusal says why and leaves
  // the sheet where it is.
  const moveTab = async (to: DialogTabTarget, from?: number): Promise<void> => {
    const current = dialog;
    if (current === null || !claim()) return;
    setTabbing(true);
    try {
      const res = await api.answerDialogTab(id, { dialogId: current.id, to, ...(from === undefined ? {} : { from }) });
      if (res.next !== undefined) applyAnswered(current.id, res.next);
    } catch (err) {
      toast(dialogTabRefusal(err), 'error');
    } finally {
      setTabbing(false);
    }
  };
  // The boxes changed here and not committed: a tab move would lose them, so ←/→ and the strip wait.
  const picksHeld = dialog?.multi !== undefined && pick.id === dialog.id && pick.call === null
    && picksUncommitted(dialog.multi, pick.picked);

  // The keyboard of the surfaces this file renders itself (decision `ask-sheet-keyboard-model`): the review's two rows,
  // and a menu's parsed rows. The structured sheet keys its own screen, so every other kind switches the hook off.
  // Worked out before any branch below returns, since the hook runs on every render.
  const tabCount = dialog === null ? null : (parseAskTabs(dialog.raw)?.tabs.length ?? null);
  const keyScreen: KeyScreen | null = source.kind === 'review'
    ? reviewKeys(source.rows.submit, source.rows.cancel, keyTabs(tabCount, null, true, picksHeld))
    : source.kind === 'menu' ? questionKeys(source.options.map((o) => o.index), null, null, null) : null;
  const keys = useAskKeys({
    screenId: dialog?.id ?? null,
    screen: keyScreen,
    start: dialog === null ? null : rowKey(dialog.selectedIndex),
    open,
    onAnswer: (k) => void answer(k),
    onToggle: toggle,
    onTab: (to) => void moveTab(to),
  });

  if (source.kind === 'none') return null;

  // The approval, and Claude's own question (the hook's envelope, or the transcript's copy once that has aged out): one
  // sheet, the one hardened sender (`EnvelopeSheet`), whose SEND goes through the functions above.
  if (source.kind === 'approval' || source.kind === 'structured') {
    return (
      <EnvelopeSheet
        id={id}
        ask={source.kind === 'approval' ? { approval: source.approval } : { questions: source.questions }}
        from={source.kind === 'structured' ? source.from : 'hook'}
        asker={asker}
        dialog={dialog}
        answering={answering}
        words={words}
        picks={picks}
        open={open}
        onHide={hide}
        onSelectOption={(optionIndex) => void answer(optionIndex)}
        onOpenTerminal={onOpenTerminal}
        tabbing={tabbing}
        picksHeld={picksHeld}
        onTab={(to, from) => void moveTab(to, from)}
      />
    );
  }

  // The review screen an ask ends on (D-5089), one render for every source of copy (D-6325): titled `Review your
  // answers` and answered by the pane's own rows, never the pane's words. The strip is drawn when the structured copy
  // and the pane's tab row agree on the count (`summary` carries the marks only then).
  if (source.kind === 'review') {
    if (dialog === null) return null; // unreachable: the review is the pane's, so `askSource` had a dialog
    const chips = source.summary.length > 0 && source.summary.every((q) => q.answered !== null)
      ? source.summary.map((q) => ({ header: q.header, answered: q.answered === true }))
      : null;
    return (
      <Sheet open={open} onClose={close} onEscapeKeyDown={escapeHidesOnly} eyebrow={<AskHeader asker={asker} />} title={REVIEW_TITLE}>
        <div
          data-source={envelope !== null ? 'hook' : dialog.ask !== undefined ? 'transcript' : undefined}
          className="ask-envelope"
          ref={keys.root}
        >
          {chips !== null && (
            <AskTabs
              tabs={chips}
              active={null}
              onReview
              held={picksHeld}
              busy={locked}
              onGo={(to) => void moveTab(to)}
            />
          )}
          <AskReview
            dialogId={dialog.id}
            selectedIndex={dialog.selectedIndex}
            rows={source.rows}
            summary={source.summary}
            answering={answering}
            locked={locked}
            onAnswer={(k) => void answer(k)}
            keys={keys}
          />
        </div>
      </Sheet>
    );
  }

  // Ask evidence on the pane and no copy of the question that fully lines up: the surface says so and offers the
  // terminal. Nothing the pane painted is shown, and nothing is offered to tap.
  if (source.kind === 'ask-unreadable') {
    return (
      <Sheet
        open={open}
        onClose={close}
        onEscapeKeyDown={escapeHidesOnly}
        eyebrow={<AskHeader asker={asker} />}
        title="Claude is asking a question this screen can't read yet."
      >
        <TerminalCta
          onOpen={() => {
            hide();
            onOpenTerminal?.();
          }}
          onLater={close}
        />
      </Sheet>
    );
  }

  // A pane nothing could be read off, with no sign of an ask: only the terminal can answer it.
  if (source.kind === 'terminal-only') {
    return (
      <Sheet
        open={open}
        onClose={close}
        onEscapeKeyDown={escapeHidesOnly}
        eyebrow={<AskHeader kicker="Claude is waiting" asker={asker} />}
        title="Claude is waiting on the terminal."
      >
        <TerminalCta
          onOpen={() => {
            hide();
            onOpenTerminal?.();
          }}
          onLater={close}
        />
      </Sheet>
    );
  }

  // A menu that is no AskUserQuestion (a plan approval, a TUI prompt): no copy of it exists but the pane's parse, so its
  // title and rows are the one place pane text is shown (D-6325), and the foot line says only what a tap does. Its rows
  // are answered by their printed index, exactly as they always were.
  return (
    <Sheet
      open={open}
      onClose={close}
      onEscapeKeyDown={escapeHidesOnly}
      eyebrow={<AskHeader kicker="Claude needs a choice" asker={asker} />}
      title={source.title || 'Claude needs a choice'}
    >
      <div ref={keys.root} hidden />
      <div className="opts">
        {source.options.map((o) => {
          const selected = lit(keys, o.index);
          const waiting = answering === o.index;
          return (
            <OptionRow
              key={`${dialog?.id ?? ''}:${o.index}`}
              {...keyed(keys, o.index)}
              selected={selected}
              glyph={selected ? '❯' : ''}
              index={o.index}
              label={o.label}
              sublabel={o.description}
              disabled={locked}
              busy={waiting}
              onClick={() => void answer(o.index)}
              // The optimistic "answering…" is this package's marker, not the
              // row's: it is a fact about a keystroke in flight to a pane.
              // It takes the slot the ↵ would have had, never both.
              marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
              enter={!waiting && selected ? '↵' : undefined}
            />
          );
        })}
      </div>
      <p className="sheet-foot">Choose an option</p>
    </Sheet>
  );
}
