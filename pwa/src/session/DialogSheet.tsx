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
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog, HookAsk } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, ApiError, apiErrorText } from '../lib/api';
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
}

export function DialogSheet({ id, store, onOpenTerminal }: DialogSheetProps): ReactNode {
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
        // The on-screen menu moved on; the store's dialog re-renders shortly.
        toast('That question changed — showing the latest');
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
      toast(`Couldn't send — ${apiErrorText(err)}`, 'error');
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
        <pre className="well dlg-raw">{shown.raw}</pre>
        <div className="dlg-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              hide();
              onOpenTerminal?.();
            }}
          >
            Open terminal to answer
          </button>
          <button type="button" className="dlg-later" onClick={close}>
            Not now
          </button>
        </div>
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
              <button
                type="button"
                className={selected ? 'opt opt--selected' : 'opt'}
                disabled={answering !== null}
                aria-busy={waiting || undefined}
                onClick={() => void answer(o.index)}
              >
                <span className="opt-glyph" aria-hidden="true">
                  {selected ? '❯' : ''}
                </span>
                <span className="opt-idx" aria-hidden="true">
                  {o.index}
                </span>
                <span className="opt-body">
                  <span className="opt-label">{label}</span>
                  {description && <span className="opt-desc">{description}</span>}
                </span>
                {waiting ? (
                  <span className="opt-wait">answering…</span>
                ) : selected ? (
                  <span className="opt-enter" aria-hidden="true">
                    ↵
                  </span>
                ) : null}
              </button>
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
        className="dlg-details-toggle"
        onClick={() => setDetails((d) => !d)}
        aria-expanded={details}
      >
        {details ? 'Hide full question' : 'Show full question'}
      </button>
      {details && <pre className="well dlg-raw">{shown.raw}</pre>}

      <p className="sheet-foot">tap an option, or answer in your own words</p>
    </Sheet>
  );
}

/**
 * The hook-sourced envelope's own content — see the file header for why this
 * exists alongside the scraped rendering above instead of replacing it, and
 * for the fix-round-1 summary of what changed here.
 *
 * Dismissal: `open`/`onHide` are wired from the PARENT exactly like the
 * scraped sheet's own `open`/`hide` (same `dismissedKey` slot, see there) —
 * a scrim tap, Esc, or swipe only hides this sheet, refused while a send
 * here (`answering` OR `denying`) is in flight, and never touches the store:
 * the header badge and fleet card keep signalling regardless.
 *
 * Fail-visible: `onSelectOption` IS `answer()` from the scraped flow (passed
 * down verbatim, so a tap here walks the live pane exactly as a scraped
 * option tap does) — and that walk needs `dialog` (re-parses the PANE, which
 * the envelope has none of its own). So numbered options and Allow (the same
 * call at index 1) are tappable only when `dialog` is non-null; otherwise
 * they render visibly disabled behind the same "Open terminal to
 * answer"/"Not now" CTA the unparsed-scraped branch above already uses. Deny
 * has no scraped counterpart to reuse and no such dependency either — Escape
 * has no option index to walk to, so it calls `api.interrupt` directly (the
 * same call SessionScreen's stop button makes) and stays enabled regardless
 * of `dialog`.
 */
function EnvelopeSheet({
  id,
  ask,
  dialog,
  answering,
  open,
  onHide,
  onSelectOption,
  onOpenTerminal,
}: {
  id: string;
  ask: HookAsk;
  /** The scraped dialog `answer()` needs to have anything to send against.
   *  null means the envelope showed up with no matching live pane menu yet
   *  (or it moved on) — read-only until one appears. */
  dialog: Dialog | null;
  /** The scraped flow's in-flight option index — shared so a numbered-option
   *  tap here disables the same way a scraped one does. */
  answering: number | null;
  open: boolean;
  onHide: () => void;
  onSelectOption: (optionIndex: number) => void;
  onOpenTerminal?: () => void;
}): ReactNode {
  // Deny's own busy flag: interrupt is not "answering an option" (there is no
  // optionIndex for Escape), so it can't reuse `answering` — but it disables
  // the same buttons `answering` would, and vice versa, so neither send can
  // race the other, and BOTH gate dismissal below (the open sheet is the only
  // honest record that a tap is still landing — same rule the scraped sheet's
  // `close` follows for `answering` alone).
  const [denying, setDenying] = useState(false);
  const busy = answering !== null || denying;
  const canAnswer = dialog !== null;

  const close = (): void => {
    if (busy) return;
    onHide();
  };

  const deny = async (): Promise<void> => {
    if (busy) return;
    setDenying(true);
    try {
      await api.interrupt(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // interrupt's `not-busy` can mean EITHER "the agent already finished
        // on its own" or "someone else already answered this same request" —
        // the response can't tell them apart, so the copy doesn't pretend to.
        toast("Couldn't stop — the session may be idle or the request already resolved");
      } else {
        toast(`Couldn't decline — ${apiErrorText(err)}`, 'error');
      }
    } finally {
      setDenying(false);
    }
  };

  // The fail-visible CTA (I-critical #2): identical markup to the unparsed
  // scraped branch above, so a dialog-less envelope reads as "the same kind
  // of dead end", not a new one. Both buttons route through `close` (not a
  // raw `onHide`) — stricter than that branch needs to be (nothing there can
  // ever be `answering`), but Deny here CAN be in flight with `dialog` still
  // null, and hopping to the terminal mid-Deny would be a second action
  // landing on top of an unresolved first one.
  const terminalCta = !canAnswer && (
    <div className="dlg-actions">
      <button
        type="button"
        className="btn-primary"
        onClick={() => {
          close();
          onOpenTerminal?.();
        }}
      >
        Open terminal to answer
      </button>
      <button type="button" className="dlg-later" onClick={close}>
        Not now
      </button>
    </div>
  );

  if ('approval' in ask) {
    const { tool, summary } = ask.approval;
    const allowing = answering === 1;
    return (
      <Sheet open={open} onClose={close} eyebrow="claude is asking" title={tool}>
        <div data-source="hook" className="ask-envelope">
          <p className="dlg-copy">{summary}</p>
          {!canAnswer && (
            <p className="dlg-copy">
              This hasn't shown up in the terminal pane yet — Allow can't be sent until it does.
            </p>
          )}
          <div className="dlg-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={!canAnswer || busy}
              aria-busy={allowing || undefined}
              onClick={() => onSelectOption(1)}
            >
              Allow
              {allowing && <span className="opt-wait"> answering…</span>}
            </button>
            <button
              type="button"
              className="dlg-later"
              disabled={busy}
              aria-busy={denying || undefined}
              onClick={() => void deny()}
            >
              Deny
              {denying && <span className="opt-wait"> answering…</span>}
            </button>
          </div>
          {terminalCta}
        </div>
      </Sheet>
    );
  }

  // I3: only the FIRST question is tappable. The digit space `answerDialog`
  // walks is one live menu's worth of options at a time (it re-parses the
  // pane, which shows one question at a time) — a global digit across
  // MULTIPLE questions would answer the wrong one, since tapping question 2's
  // first option would still send digit 1, which IS question 1's own first
  // option. Further questions in the envelope (AskUserQuestion can ask more
  // than one at once) render below, read-only — shown, never silently
  // dropped, just not wired to a send this sheet has no way to route safely.
  const first = ask.questions[0]!; // isUsableAsk (the caller's guard) proves this
  const rest = ask.questions.slice(1);
  const eyebrow = first.header ? (
    <>
      claude is asking <span className="dlg-header-chip">{first.header}</span>
    </>
  ) : (
    'claude is asking'
  );

  return (
    <Sheet open={open} onClose={close} eyebrow={eyebrow} title={first.question}>
      <div data-source="hook" className="ask-envelope">
        {!canAnswer && (
          <p className="dlg-copy">
            This hasn't shown up in the terminal pane yet — answer it there, or wait for it to
            catch up.
          </p>
        )}
        {/* v1: a multiSelect question renders the exact same plain rows as a
            single-select one — the send path is one digit either way
            (answerDialog walks to a single option index and confirms; there
            is no wire capacity to submit more than one). The scraped path has
            no multi-select rendering of its own to diverge from either: a
            multi-select pane comes back { parsed: false } there (see
            MULTISELECT_RE in server/src/pane/dialog.ts) and falls to the
            raw-pane view instead, so "match the scraped behavior" here means
            "there is none to match" — plain rows are the only rendering
            either path has for this case. */}
        <div className="opts">
          {first.options.map((o, oi) => {
            const idx = oi + 1;
            const waiting = answering === idx;
            return (
              <button
                key={oi}
                type="button"
                className="opt"
                disabled={!canAnswer || answering !== null}
                aria-busy={waiting || undefined}
                onClick={() => onSelectOption(idx)}
              >
                <span className="opt-idx" aria-hidden="true">
                  {idx}
                </span>
                <span className="opt-body">
                  <span className="opt-label">{o.label}</span>
                  {o.description && <span className="opt-desc">{o.description}</span>}
                </span>
                {waiting && <span className="opt-wait">answering…</span>}
              </button>
            );
          })}
        </div>
        {terminalCta}
        {rest.length > 0 && (
          // Read-only: see the comment above `first` for why only the first
          // question ever sends. Plain divs, not buttons — nothing here
          // should read as tappable to a screen reader either.
          <div className="ask-envelope-more">
            {rest.map((q, qi) => (
              <Fragment key={qi}>
                {q.header && <p className="dlg-header-chip">{q.header}</p>}
                <p className="dlg-copy">{q.question}</p>
                <div className="opts">
                  {q.options.map((o, oi) => (
                    <div key={oi} className="opt" aria-disabled="true">
                      <span className="opt-idx" aria-hidden="true">
                        {oi + 1}
                      </span>
                      <span className="opt-body">
                        <span className="opt-label">{o.label}</span>
                        {o.description && <span className="opt-desc">{o.description}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
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
        <pre id={previewId} className="well opt-preview">
          {text}
        </pre>
      )}
    </div>
  );
}
