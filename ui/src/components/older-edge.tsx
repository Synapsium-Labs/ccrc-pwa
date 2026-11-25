// Older messages, at the top of a session's chat (desktop polish wave 175): the Load older control and the words for
// each way loading older messages can end, and the marker for records a page left out.
//
// ONE WORD PER END, NEVER TWO COLLAPSED. The app decides which end it is in (`pwa/src/session/olderPages.ts`, its
// `OlderEdge`); this draws it. More to load and a retry offer the control; the start of what is available and an end that
// asking again cannot help are a sentence with no control. "The oldest message available here" never says the session
// began there: a context reset, a swap or retention can each leave earlier messages outside this transcript.
//
// THE CONTROL IS ONE BUTTON, KEPT. Loading changes its words and makes it inert (`aria-disabled`, never `disabled`, which
// would take focus from a reader who just pressed it). When an end has no control, the sentence that replaces it takes
// focus if the button had it, so a keyboard reader is never dropped to the page's start.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { OlderPageEnd } from '../../../shared/olderPage';
import { FOCUS_RING } from '../lib/focus';
import './older-edge.css';

/** Every state the top of the chat can be in while older messages are offered (the app's `none` draws nothing): the
 *  wire's end words less the two never shown (`invalid`, `expired`), and `loading`. */
export type OlderEdgeState = 'loading' | Exclude<OlderPageEnd, 'invalid' | 'expired'>;

/** The words, one sentence per end, and the control's label where there is one. */
export const OLDER_WORDS: Readonly<Record<OlderEdgeState, { readonly say: string | null; readonly control: string | null }>> =
  Object.freeze({
    more: { say: null, control: 'Load older messages' },
    loading: { say: null, control: 'Loading older messages…' },
    start: { say: 'This is the oldest message available here.', control: null },
    busy: { say: 'Another page of older messages was still loading.', control: 'Try again' },
    changed: { say: 'Older messages cannot be loaded now: the transcript changed.', control: null },
    absent: { say: 'Older messages cannot be loaded now: the transcript is no longer there.', control: null },
    unreadable: { say: 'Older messages cannot be loaded now: the transcript could not be read.', control: 'Try again' },
    unmeasured: { say: 'Older messages cannot be loaded now: the transcript could not be measured.', control: 'Try again' },
  });

/** The marker a page leaves where it skipped records too long to send. */
export const OLDER_GAP_WORDS = 'One or more records here were too long to load and are left out.';

export function OlderEdge({ state, onLoad }: { state: OlderEdgeState; onLoad: () => void }): ReactNode {
  const { say, control } = OLDER_WORDS[state];
  const box = useRef<HTMLDivElement>(null);
  const sayRef = useRef<HTMLParagraphElement>(null);
  const focused = useRef(false);
  // The button went away while it had focus: the sentence that took its place takes focus.
  useLayoutEffect(() => {
    if (control === null && focused.current && box.current !== null && !box.current.contains(document.activeElement)) {
      sayRef.current?.focus();
    }
  }, [control]);
  const loading = state === 'loading';
  return (
    <div
      ref={box}
      className="older-edge"
      data-older={state}
      onFocus={() => { focused.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused.current = false; }}
    >
      {say !== null && (
        <p ref={sayRef} className="older-edge-say" tabIndex={control === null ? -1 : undefined}>
          {say}
        </p>
      )}
      {control !== null && (
        <button
          type="button"
          className={`older-edge-load ${FOCUS_RING}`}
          aria-disabled={loading || undefined}
          onClick={() => { if (!loading) onLoad(); }}
        >
          {control}
        </button>
      )}
      {/* What loading did, said once to a screen reader: the button's own label changes are not announced. */}
      <span className="older-edge-live" role="status" aria-live="polite">{loading ? control : ''}</span>
    </div>
  );
}

/** Where a page left out one or more records too long to send. */
export function OlderGap(): ReactNode {
  return <p className="older-gap" data-older-gap="">{OLDER_GAP_WORDS}</p>;
}
