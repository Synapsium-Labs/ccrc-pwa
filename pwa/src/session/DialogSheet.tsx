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
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, ApiError, apiErrorText } from '../lib/api';
import { getSessionStore, type SessionStore } from '../stores/session';
import './chat.css';

/** The TUI's free-text escape hatch, however it happens to be worded. */
const CHAT_ABOUT_RE = /chat about this/i;
const CLEAR_POLL_MS = 400;
const CLEAR_TRIES = 20; // ~8 s — the stream polls the pane every 2 s

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

  // The option index whose answer is in flight (null = none).
  const [answering, setAnswering] = useState<number | null>(null);
  // Dialog id the user waved away — it stays hidden until a new question.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
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

  const open = dialog !== null && dialog.id !== dismissedId;

  const hide = (): void => {
    if (lastRef.current !== null) setDismissedId(lastRef.current.id);
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
  return (
    <div className="opt-preview-wrap">
      <button
        type="button"
        className="opt-preview-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾ preview' : '▸ preview'}
      </button>
      {open && <pre className="well opt-preview">{text}</pre>}
    </div>
  );
}
