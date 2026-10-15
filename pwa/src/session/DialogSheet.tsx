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
// sending literal text the way a free-text reply is.
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
//  - Questions: `questionCorresponds` (below `isUsableAsk`) requires `dialog`
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
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, HookAsk } from '../../../shared/api';
import { EYEBROW, OptionRow, Sheet, Well, toast } from '@ccrc/ui';
import { EnvelopeSheet, TerminalCta } from './EnvelopeSheet';
import { api, ApiError, failedTo } from '../lib/api';
import { getSessionStore, type SessionStore } from '../stores/session';
import './chat.css';

/** The TUI's free-text escape hatch, however it happens to be worded. */
const CHAT_ABOUT_RE = /chat about this/i;
const CLEAR_POLL_MS = 400;
const CLEAR_TRIES = 20; // ~8 s — the stream polls the pane every 2 s

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
  // Free-form reply (answer in your own words) + the raw "full question" view.
  const [reply, setReply] = useState('');
  const [details, setDetails] = useState(false);

  // Remember the last dialog so the sheet has content to animate out with
  // after dialog_cleared empties the store.
  const lastRef = useRef<Dialog | null>(null);
  if (dialog !== null) lastRef.current = dialog;
  const shown = dialog ?? lastRef.current;

  // A new question (or a cleared one) invalidates the in-flight marker.
  const dialogId = dialog?.id ?? null;
  useEffect(() => {
    setAnswering(null);
  }, [dialogId]);

  // D-286: the transcript asked for this sheet back. Clearing the dismissal
  // is the WHOLE effect — the sheet then opens on exactly the envelope the
  // store still holds, through the same `open` computation as always, so the
  // raise cannot conjure a sheet for a question that is no longer live.
  useEffect(() => {
    if (raise) setDismissedKey(null);
  }, [raise]);

  const open = dialog !== null && dialog.id !== dismissedKey;

  const hide = (): void => {
    if (lastRef.current !== null) setDismissedKey(lastRef.current.id);
  };

  const close = (): void => {
    // Non-dismissable while an answer is in flight — the open sheet is the
    // only honest record that the tap is still landing.
    if (answering !== null) return;
    hide();
  };

  const answer = async (optionIndex: number): Promise<void> => {
    if (dialog === null || answering !== null) return;
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

  /** Wait for the stream to confirm the menu is gone (its poll is ~2 s). */
  const dialogCleared = async (): Promise<boolean> => {
    for (let i = 0; i < CLEAR_TRIES; i++) {
      if (useStore.getState().dialog === null) return true;
      await new Promise((r) => setTimeout(r, CLEAR_POLL_MS));
    }
    return useStore.getState().dialog === null;
  };

  // Answer in your own words. While a menu is up it owns the keyboard — there
  // is no input box, and the server refuses to type into one (dialog-open). The
  // TUI's own escape hatch is its "Chat about this" row, which drops the
  // session into free text: take that first, wait for the menu to go, then send.
  const respond = async (): Promise<void> => {
    const text = reply.trim();
    const current = dialog;
    if (text === '' || answering !== null || current === null) return;
    const chat = current.options.find((o) => CHAT_ABOUT_RE.test(o.label));
    if (!chat) {
      toast("This question has no free-text option — pick one, or use the terminal", 'error');
      return;
    }
    setReply('');
    setAnswering(chat.index);
    try {
      await api.answerDialog(id, current.id, chat.index);
      if (!(await dialogCleared())) {
        toast("The question is still up — answer it in the terminal", 'error');
        return;
      }
      hide();
      await useStore.getState().send(text);
    } catch (err) {
      toast(failedTo('send', err), 'error');
    } finally {
      setAnswering(null);
    }
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
        open={askKey !== dismissedKey}
        onHide={() => setDismissedKey(askKey)}
        onSelectOption={(optionIndex) => void answer(optionIndex)}
        onOpenTerminal={onOpenTerminal}
      />
    );
  }

  if (shown === null) return null;

  if (!shown.parsed) {
    return (
      <Sheet
        open={open}
        onClose={close}
        eyebrow="claude is asking"
        title="Answer this one in the terminal"
      >
        <p className="dlg-copy">
          This question doesn't fit tappable options. Answer it in the terminal — the
          session picks up from there.
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

  // The transcript's copy for this menu, when the two could be matched.
  const ask = shown.ask;
  // Nothing validates the question server-side beyond it being a string, so a
  // blank one has to degrade to the scraped pane rather than replace it: `??`
  // would keep the empty string and leave the sheet with no question on it at
  // all — no title, no preamble, and a dialog with no accessible name.
  const question = ask?.question.trim() ?? '';
  const eyebrow = ask?.header ? (
    <>
      claude is asking <span className="dlg-header-chip">{ask.header}</span>
    </>
  ) : (
    'claude is asking'
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      eyebrow={eyebrow}
      title={question || shown.title}
    >
      {/* The scraped preamble is a lossy copy of the question — once the real
          one is the title it would only say it twice. Keyed off the question
          actually shown, so a blank one keeps the pane's copy. */}
      {!question && shown.body && shown.body !== shown.title && (
        <p className="dlg-body">{shown.body}</p>
      )}
      <div className="opts">
        {shown.options.map((o) => {
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
                disabled={answering !== null}
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

      {/* Answer in your own words — declines the menu and sends your text. */}
      <form
        className="dlg-reply"
        onSubmit={(e) => {
          e.preventDefault();
          void respond();
        }}
      >
        <input
          className="dlg-reply-input"
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="…or answer in your own words"
          disabled={answering !== null}
          aria-label="Answer in your own words"
        />
        <button
          type="submit"
          className="dlg-reply-send"
          disabled={answering !== null || reply.trim() === ''}
        >
          Send
        </button>
      </form>

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
