// Reader mode's overlay (native Docs reader, reader-mode plan Task XR1.4 with XR2.1 folded in, as amended 2026-11-24, D-8975,
// D-8803; reader-mode spec 2026-11-20 sections 2.1 and 2.2 (Mockups 1 and 2), 4.2 "The overlay, shown and hidden" and "Where
// things sit", 6.2 and 6.5). Ring L4 delivery: it draws and forwards taps, and it decides nothing; the state (shown or hidden)
// is `readerModeStep`'s, and `DocsReading` mounts this only while it is shown.
//
// Three parts, in DOM order, drawn inside `.docs-reading-controls`:
//   1. the top strip: the document's title ONLY, no control; a tap anywhere on it hides the overlay and does nothing else,
//      so a second tap where the frame's band showed it always hides it and never acts;
//   2. the clear layer over the reading area: `aria-hidden`, not focusable; a tap on it hides the overlay and does nothing else,
//      and while it shows it takes the touch and the wheel (docs.css), so the frame scrolls again once the overlay is gone;
//   3. the bottom strip, a `role="toolbar"` named `READER_MODE_TEXT.toolbar`, not a modal: Exit at its left end, then Aa as
//      its last control, then the progress text (a `role="status"` region, never focusable). XR2.2's Pages/Scroll switch takes
//      the place between Exit and Aa (the spec's order: Exit, the turn setting, Aa). The Esc
//      handler is bound on this strip alone, never on the container: a sheet is a React child of the container (its portal
//      target is the container's), so a handler higher up would see the Esc that closes a sheet.
// Showing it moves focus to Exit (spec 6.5). No timer hides it, and nothing here subscribes to the window's blur.
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { ReaderProgress } from './readerBar';
import { READER_MODE_TEXT, progressText } from './reader/readerModeWords';

/** The progress text changes at most this often, in milliseconds (spec 6.5: "updated at most once a second"). */
const PERCENT_EVERY_MS = 1000;

/** What the leading focus guard asks of the overlay while it shows: focus the toolbar's last control (its last button). */
export interface ReaderModeOverlayHandle {
  focusLast(): void;
}

export interface ReaderModeOverlayProps {
  title: string;
  progress: ReaderProgress;
  onExit(): void;
  onAa(): void;
  onDismiss(): void;
  onEsc(): void;
  onActivity(): void;
  ref?: Ref<ReaderModeOverlayHandle>;
}

/** The percentage text of `progress`: the first value at once, then each change at most once a second, the final value of a
 *  burst landing when the second is up. The one timer is a deadline for the next paint of this text, not a state. */
function usePercent(progress: ReaderProgress): string {
  const [text, setText] = useState(() => progressText(progress.read()));
  useEffect(() => {
    let shownAt = Date.now();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const show = (): void => {
      pending = null;
      shownAt = Date.now();
      setText(progressText(progress.read()));
    };
    show();
    const stop = progress.subscribe(() => {
      if (pending !== null) return;   // the paint already waiting reads the latest value
      const wait = shownAt + PERCENT_EVERY_MS - Date.now();
      if (wait <= 0) show(); else pending = setTimeout(show, wait);
    });
    return () => {
      stop();
      if (pending !== null) clearTimeout(pending);
    };
  }, [progress]);
  return text;
}

export function ReaderModeOverlay(p: ReaderModeOverlayProps): ReactNode {
  const { progress, onExit, onAa, onDismiss, onEsc, onActivity } = p;
  const exit = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const percent = usePercent(progress);
  // The toolbar's last button, read from the toolbar itself: XR2.2's turn switch goes before Aa, and a control added anywhere is
  // never skipped by the wrap.
  useImperativeHandle(p.ref, () => ({
    focusLast: () => {
      const buttons = bar.current?.querySelectorAll('button');
      buttons?.[buttons.length - 1]?.focus();
    },
  }), []);
  // Showing the overlay moves focus to Exit.
  useEffect(() => { exit.current?.focus(); }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onEsc();
  };
  return (
    <>
      <div className="docs-reading-top" onClick={onDismiss}>
        <span className="docs-reading-title">{p.title}</span>
      </div>
      <div className="docs-reading-layer" aria-hidden="true" onClick={onDismiss} />
      <div className="docs-reading-bottom" role="toolbar" aria-label={READER_MODE_TEXT.toolbar} ref={bar} onKeyDown={onKeyDown}>
        <button
          type="button" className="docs-reading-exit" ref={exit} aria-label={READER_MODE_TEXT.exit}
          onClick={() => { onActivity(); onExit(); }}
        >
          {READER_MODE_TEXT.exitShown}
        </button>
        <button
          type="button" className="docs-reading-aa" aria-label={READER_MODE_TEXT.aa}
          onClick={() => { onActivity(); onAa(); }}
        >
          {READER_MODE_TEXT.aaShown}
        </button>
        <span className="docs-reading-percent" role="status">{percent}</span>
      </div>
    </>
  );
}
