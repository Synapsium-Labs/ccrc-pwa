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
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dialog } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, ApiError } from '../lib/api';
import { getSessionStore, type SessionStore } from '../stores/session';
import './chat.css';

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

  return (
    <Sheet open={open} onClose={close} eyebrow="claude is asking" title={shown.title}>
      <div className="opts">
        {shown.options.map((o) => {
          const selected = o.index === shown.selectedIndex;
          const waiting = answering === o.index;
          return (
            <button
              key={o.index}
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
              <span className="opt-label">{o.label}</span>
              {waiting ? (
                <span className="opt-wait">answering…</span>
              ) : selected ? (
                <span className="opt-enter" aria-hidden="true">
                  ↵
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="sheet-foot">tap an option — it answers in the session</p>
    </Sheet>
  );
}
