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
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, HookAsk } from '../../../shared/api';
import { EYEBROW, OptionRow, Sheet, Well, toast } from '@ccrc/ui';
import { EnvelopeSheet, TerminalCta } from './EnvelopeSheet';
import {
  AskEyebrow, AskReview, ChatRow, OwnWords, REVIEW_TITLE, SEVERAL_ANSWERS, wordsBusy, type Words, type WordsCall,
} from './AskParts';
import { chatRow, freeTextSlot, isAskReview, slotHolds } from './askLive';
import { dialogTextRefusal } from './askWords';
import { api, ApiError } from '../lib/api';
import { getSessionStore, type SessionStore } from '../stores/session';
import './chat.css';

/** No own-words text, and no call. */
const NO_WORDS: { text: string; call: WordsCall | null } = { text: '', call: null };

/** Does `dialog` still show the question `call` typed into, its free-text row holding exactly `text`? That is the
 *  typed row of this very send (the stream may deliver it after the call answered), not other text, and not a new
 *  question. */
const showsSent = (dialog: Dialog | null, call: WordsCall, text: string): boolean =>
  dialog !== null && dialog.title === call.title && slotHolds(freeTextSlot(dialog, call.row - 1), text);

/**
 * I4: is there anything accessible to actually show? Mirrors the scraped
 * path's own blank-question fallback further down (`ask?.question.trim() ??
 * ''`), but that path still has the PANE's own title/options to fall back
 * to when the transcript's copy is blank — a hook envelope has no such
 * second source of its own, so "blank" here means "treat as absent" rather
 * than "render with an empty title", which would leave the sheet with no
 * accessible name at all (the same failure mode that comment documents).
 * A type guard so the call site gets `hookAsk` narrowed to `HookAsk` for
 * free, rather than a boolean the compiler can't connect back to it.
 */
function isUsableAsk(a: HookAsk | null): a is HookAsk {
  if (a === null) return false;
  if ('approval' in a) return true;
  return a.questions.length > 0 && a.questions[0]!.question.trim() !== '';
}

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
}


export function DialogSheet({ id, store, onOpenTerminal, raise }: DialogSheetProps): ReactNode {
  const useStore = store ?? getSessionStore(id);
  const dialog = useStore((s) => s.dialog);
  const hookAsk = useStore((s) => s.ask);

  // The option index whose answer is in flight (null = none).
  const [answering, setAnswering] = useState<number | null>(null);
  // The identity of whichever content — a scraped dialog's id, or a
  // stringified hook envelope (HookAsk carries no id of its own; see
  // `askKey` below) — the user waved away with a scrim tap, Esc, or swipe.
  // It stays hidden until something with a DIFFERENT identity arrives. One
  // slot serves both sheets below: only one is ever open at a time (the
  // envelope preference), and sharing it means a dismissal survives the
  // moment display hands off from one to the other.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // D-5089: the pane dialog that was live when the operator hid the ENVELOPE.
  // The envelope's own key is a hash of its JSON, which no scraped dialog id
  // ever equals, so without this the hand-off on `ask_cleared` re-opened the
  // very question the operator had just waved away.
  const [dismissedDialogId, setDismissedDialogId] = useState<string | null>(null);
  // D-5090: the own-words text and its call, one value so the two change together (see `WordsCall`).
  const [own, setOwn] = useState(NO_WORDS);
  // The raw "full question" view.
  const [details, setDetails] = useState(false);

  // Remember the last dialog so the sheet has content to animate out with
  // after dialog_cleared empties the store.
  const lastRef = useRef<Dialog | null>(null);
  if (dialog !== null) lastRef.current = dialog;
  const shown = dialog ?? lastRef.current;

  // A new question (or a cleared one) invalidates the in-flight marker.
  // D-5090: and ends an own-words answer that LANDED, the same way, unless the new frame is that send's own typed row
  // (captured before its Enter, delivered after its ok). A call still in FLIGHT is never touched here: the typing
  // changes the id mid-call.
  const dialogId = dialog?.id ?? null;
  useEffect(() => {
    setAnswering(null);
    setOwn((o) => (o.call?.state === 'landed' && !showsSent(dialog, o.call, o.text) ? NO_WORDS : o));
    // `dialog` is read at the id it belongs to; a repaint under the same id is not a new screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogId]);

  // Anything in flight: an option's answer, or an own-words send. Either refuses another send and the dismissal.
  const locked = answering !== null || wordsBusy(own.call);

  // D-286: the transcript asked for this sheet back. Clearing the dismissal
  // is the WHOLE effect — the sheet then opens on exactly the envelope the
  // store still holds, through the same `open` computation as always, so the
  // raise cannot conjure a sheet for a question that is no longer live.
  useEffect(() => {
    if (!raise) return;
    setDismissedKey(null);
    setDismissedDialogId(null);
  }, [raise]);

  const open = dialog !== null && dialog.id !== dismissedKey && dialog.id !== dismissedDialogId;

  const hide = (): void => {
    if (lastRef.current !== null) setDismissedKey(lastRef.current.id);
  };

  const close = (): void => {
    // Non-dismissable while an answer is in flight — the open sheet is the
    // only honest record that the tap is still landing.
    if (locked) return;
    hide();
  };

  const answer = async (optionIndex: number): Promise<void> => {
    if (dialog === null || locked) return;
    setAnswering(optionIndex);
    try {
      await api.answerDialog(id, dialog.id, optionIndex);
      // Stay in "answering…" — the sheet closes when dialog_cleared lands.
    } catch (err) {
      setAnswering(null);
      if (err instanceof ApiError && err.status === 409) {
        // The on-screen menu moved on. The scraped sheet renders straight
        // from `dialog`, so it re-renders with the new one right after this
        // and "showing the latest" is literally true there — but the
        // envelope sheet renders `hookAsk`, not `dialog`, and a 409 here
        // changes nothing on screen: N1, that copy would read as a lie on
        // this branch, so say what actually happened instead.
        toast(
          isUsableAsk(hookAsk)
            ? "That question moved on in the terminal — this answer didn't land"
            : 'That question changed — showing the latest',
        );
      } else {
        toast(
          `Couldn't answer — ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    }
  };

  // D-5090: own words, into the free-text row printed `row`. The text is kept in the field through the call and on
  // any refusal (which says why); only an ok lets it go, once the pane has moved on. One call at a time: every Send is
  // disabled while one is under way.
  const sendWords = async (row: number): Promise<void> => {
    const current = dialog;
    const kept = own.text;
    if (current === null || locked) return;
    const call = { row, title: current.title };
    setOwn({ text: kept, call: { ...call, state: 'flight' } });
    try {
      await api.answerDialogText(id, current.id, row, kept.trim());
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

  // The hook envelope wins DISPLAY the moment it is USABLE — see the file
  // header (fix round 1's I4). It can be non-null while `shown` is still null
  // (the envelope arrived first), so this has to come before the
  // `shown === null` bailout.
  if (isUsableAsk(hookAsk)) {
    // A hash of the envelope's JSON stands in for an identity HookAsk
    // doesn't carry. Content equality is exactly what should reopen or stay
    // dismissed here: session-hook.sh rewrites the whole file on every
    // relevant transition, so two reads that serialize the same string ARE
    // the same question/approval as far as this sheet cares, and a
    // genuinely new one always serializes differently (a new question
    // string, a new tool/summary pair, an added/removed option, …).
    const askKey = JSON.stringify(hookAsk);
    return (
      <EnvelopeSheet
        id={id}
        ask={hookAsk}
        dialog={dialog}
        answering={answering}
        words={words}
        open={askKey !== dismissedKey}
        onHide={() => {
          setDismissedKey(askKey);
          setDismissedDialogId(dialog?.id ?? null);
        }}
        onSelectOption={(optionIndex) => void answer(optionIndex)}
        onOpenTerminal={onOpenTerminal}
      />
    );
  }

  if (shown === null) return null;

  if (!shown.parsed) {
    // D-5089: a multiSelect question the server read as one (`Dialog.multi`)
    // is NAMED, as the envelope sheet names it, so the hand-off on
    // `ask_cleared` changes nothing the operator reads: its title, the same
    // sentence, and the pane's boxes in the raw well. D-5091 answers it with
    // boxes. Any other unparsed pane keeps the generic dead end, and so does
    // one whose title came back blank (a sheet with no accessible name).
    const multi = shown.multi !== undefined && shown.title.trim() !== '';
    return (
      <Sheet
        open={open}
        onClose={close}
        eyebrow={<AskEyebrow />}
        title={multi ? shown.title : 'Answer this one in the terminal'}
      >
        <p className="dlg-copy">
          {multi
            ? SEVERAL_ANSWERS
            : "This question doesn't fit tappable options. Answer it in the terminal — the session picks up from there."}
        </p>
        <Well className="dlg-raw">{shown.raw}</Well>
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

  // D-5089: the review screen an ask ends on, the same as the envelope sheet
  // renders it (`AskReview`), so an ask whose envelope aged out can still be
  // submitted from here. Titled `Review your answers`, never the pane's title,
  // which on this screen is the tab row (or, on a tall review, an answer).
  if (isAskReview(shown)) {
    return (
      <Sheet open={open} onClose={close} eyebrow={<AskEyebrow />} title={REVIEW_TITLE}>
        <AskReview dialog={shown} answering={answering} locked={locked} onAnswer={(k) => void answer(k)} />
      </Sheet>
    );
  }

  // The transcript's copy for this menu, when the two could be matched.
  const ask = shown.ask;
  // Nothing validates the question server-side beyond it being a string, so a
  // blank one has to degrade to the scraped pane rather than replace it: `??`
  // would keep the empty string and leave the sheet with no question on it at
  // all — no title, no preamble, and a dialog with no accessible name.
  const question = ask?.question.trim() ?? '';
  // D-5090: the free-text row, under the question's n options. n is the transcript's option count when the server
  // matched the question; else, after this sheet's own text call under the same question, that call's row less one
  // (the stranded retry, which a held row needs: only the placeholder tells itself apart from an option); else
  // unknown, and only the empty placeholder row is the slot. That row, and the `Chat about this` row, are never
  // option rows here: own words go through `OwnWords`, and Chat is a row of its own saying what it does.
  const n = ask !== undefined
    ? ask.options.length
    : own.call !== null && own.call.title === shown.title ? own.call.row - 1 : null;
  const slot = freeTextSlot(shown, n);
  const chat = chatRow(shown);
  const slotRow = slot.kind === 'none' ? null : slot.index;
  const rows = shown.options.filter((o) => o.index !== slotRow && o.index !== chat?.index);
  return (
    <Sheet
      open={open}
      onClose={close}
      eyebrow={<AskEyebrow header={ask?.header} />}
      title={question || shown.title}
    >
      {/* The scraped preamble is a lossy copy of the question — once the real
          one is the title it would only say it twice. Keyed off the question
          actually shown, so a blank one keeps the pane's copy. */}
      {!question && shown.body && shown.body !== shown.title && (
        <p className="dlg-body">{shown.body}</p>
      )}
      <div className="opts">
        {rows.map((o) => {
          const selected = o.index === shown.selectedIndex;
          const waiting = answering === o.index;
          // By POSITION, never by matching text: the keystroke is o.index
          // whatever the transcript happens to call this row. `null` (the
          // position the server could not confirm) reads like a missing one —
          // every field below falls back to the pane's own copy.
          const rich = ask?.options[o.index - 1];
          const label = rich?.label ?? o.label;
          // An empty description is not an override either — fall back to the
          // sub-text the pane scraped rather than dropping both.
          const description = rich?.description || o.description;
          return (
            // Keyed by the (pane-derived) dialog id as well as the index so a
            // new question opens its own previews instead of inheriting the
            // last one's folded state. The id is stable across arrow moves.
            <Fragment key={`${shown.id}:${o.index}`}>
              <OptionRow
                selected={selected}
                glyph={selected ? '❯' : ''}
                index={o.index}
                label={label}
                sublabel={description}
                disabled={locked}
                busy={waiting}
                onClick={() => void answer(o.index)}
                // The optimistic "answering…" is this package's marker, not the
                // row's: it is a fact about a keystroke in flight to a pane.
                // It takes the slot the ↵ would have had, never both.
                marker={waiting ? <span className="opt-wait">answering…</span> : undefined}
                enter={!waiting && selected ? '↵' : undefined}
              />
              {rich?.preview && (
                <OptionPreview text={rich.preview} defaultOpen={selected} />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Answer in your own words, through the free-text row (D-5090), in that row's place. */}
      <OwnWords slot={slot} chat={chat?.label ?? null} words={words} locked={answering !== null} />
      {chat && (
        <ChatRow
          row={chat}
          selectedIndex={shown.selectedIndex}
          answering={answering}
          disabled={locked}
          onAnswer={(k) => void answer(k)}
        />
      )}

      {/* Some menus render a side-box of detail the tappable rows can't carry —
          the raw view shows the whole question exactly as the terminal does. */}
      <button
        type="button"
        className={`dlg-details-toggle ${EYEBROW}`}
        onClick={() => setDetails((d) => !d)}
        aria-expanded={details}
      >
        {details ? 'Hide full question' : 'Show full question'}
      </button>
      {details && <Well className="dlg-raw">{shown.raw}</Well>}

      <p className="sheet-foot">tap an option, or answer in your own words</p>
    </Sheet>
  );
}

/** An option's worked example, folded away under its row and opened for the
 *  preselected one. Fixed-width ASCII: it scrolls, it never wraps — the same
 *  rule code blocks follow. Capped at --well-max with internal scroll. */
function OptionPreview({
  text,
  defaultOpen,
}: {
  text: string;
  defaultOpen: boolean;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  // Names the region this toggle owns, so aria-expanded is about something a
  // screen reader can then be taken to.
  const previewId = useId();
  return (
    <div className="opt-preview-wrap">
      <button
        type="button"
        className="opt-preview-toggle"
        aria-expanded={open}
        aria-controls={previewId}
        onClick={() => setOpen((o) => !o)}
      >
        {/* The caret is decoration, like .opt-glyph and .opt-enter: inside the
            name it reads out as "black down-pointing small triangle preview",
            and the announced NAME would change on every toggle on top of the
            state change the toggle already announces. */}
        <span aria-hidden="true">{open ? '▾' : '▸'} </span>
        preview
      </button>
      {open && (
        <Well id={previewId} className="opt-preview">
          {text}
        </Well>
      )}
    </div>
  );
}
