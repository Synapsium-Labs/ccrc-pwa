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
//   3. the bottom strip, a `role="toolbar"` named `READER_MODE_TEXT.toolbar`, not a modal: Exit at its left end, then the turn
//      setting (X6 XR2.2: a `radiogroup` of two radios, Pages and Scroll, `aria-checked` on the turn in force, arrow keys moving
//      between them), then Aa
//      as its last control (the spec's order: Exit, the turn setting, Aa), then the progress text (a `role="status"` region, never
//      focusable): the percentage and, when the document has a reading time, the time left at the same share. The Esc
//      handler is bound on this strip alone, never on the container: a sheet is a React child of the container (its portal
//      target is the container's), so a handler higher up would see the Esc that closes a sheet.
// Showing it moves focus to Exit (spec 6.5). No timer hides it, and nothing here subscribes to the window's blur.
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { ReaderProgress } from './readerBar';
import type { ReaderTurn } from './reader/readerMode';
import { READER_MODE_TEXT, overlayProgressText } from './reader/readerModeWords';

/** The progress text changes at most this often, in milliseconds (spec 6.5: "updated at most once a second"). */
const PERCENT_EVERY_MS = 1000;

/** The turn setting's two buttons, in the strip's order: the way the reader turns, and the word on its button. */
const TURNS: ReadonlyArray<readonly [ReaderTurn, string]> = [
  ['screens', READER_MODE_TEXT.turnScreens],
  ['scroll', READER_MODE_TEXT.turnScroll],
];

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
  /** The turn in force: the pressed button of the turn setting. */
  turn: ReaderTurn;
  /** The turn setting's tap: the way the reader should turn from now on. */
  onTurn(next: ReaderTurn): void;
  /** The document's reading time in minutes, for the time left; absent when the library gave none (the percentage stands alone). */
  readingMinutes?: number;
  ref?: Ref<ReaderModeOverlayHandle>;
}

/** The share read of `progress`: the first value at once, then each change at most once a second, the final value of a burst
 *  landing when the second is up. The percentage and the time left are both made from this one value, so they change together,
 *  at most once a second. The one timer is a deadline for the next paint of this share, not a state. */
function useShare(progress: ReaderProgress): number {
  const [share, setShare] = useState(() => progress.read());
  useEffect(() => {
    let shownAt = Date.now();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const show = (): void => {
      pending = null;
      shownAt = Date.now();
      setShare(progress.read());
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
  return share;
}

/** The Exit button, written once: the overlay's and the frameless form's. A tap counts as activity, then leaves. */
function ExitButton(p: { onExit(): void; onActivity(): void; buttonRef?: Ref<HTMLButtonElement> }): ReactNode {
  return (
    <button
      type="button" className="docs-reading-exit" ref={p.buttonRef} aria-label={READER_MODE_TEXT.exit}
      onClick={() => { p.onActivity(); p.onExit(); }}
    >
      {READER_MODE_TEXT.exitShown}
    </button>
  );
}

/** The toolbar with Exit alone, for reader mode on with no frame standing (X6 XR fix round 1): no title, no turn switch, no Aa and
 *  no progress, since each of those belongs to a frame. It is drawn with no tap and takes no focus when it appears (a frame
 *  that comes back must not find focus pulled to it unasked); the leading focus guard reaches it through `focusLast`. */
export function ReaderModeExitOnly(p: { onExit(): void; onActivity(): void; ref?: Ref<ReaderModeOverlayHandle> }): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  useImperativeHandle(p.ref, () => ({ focusLast: () => { bar.current?.querySelector('button')?.focus(); } }), []);
  return (
    <div className="docs-reading-bottom" role="toolbar" aria-label={READER_MODE_TEXT.toolbar} ref={bar}>
      <ExitButton onExit={p.onExit} onActivity={p.onActivity} />
    </div>
  );
}

export function ReaderModeOverlay(p: ReaderModeOverlayProps): ReactNode {
  const { progress, onExit, onAa, onDismiss, onEsc, onActivity, turn, onTurn } = p;
  const exit = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const line = overlayProgressText(useShare(progress), p.readingMinutes);
  // The toolbar's last button, read from the toolbar itself: the turn setting goes before Aa, and a control added anywhere is
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
  // The ARIA radio pattern inside the toolbar: the checked radio is the group's one tab stop (roving `tabIndex`), and an arrow key
  // moves focus to the next or previous radio, wrapping, and chooses it, as a radio group does. The toolbar's own keys (Tab through
  // its controls, Esc) are unchanged: an arrow key is the only one the group takes, and it stops there.
  const onTurnKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const from = radios.indexOf(e.target as HTMLElement);
    const at = from === -1 ? TURNS.findIndex(([way]) => way === turn) : from;
    const next = (at + step + TURNS.length) % TURNS.length;
    radios[next]?.focus();
    onActivity();
    onTurn(TURNS[next]![0]);
  };
  return (
    <>
      <div className="docs-reading-top" onClick={onDismiss}>
        <span className="docs-reading-title">{p.title}</span>
      </div>
      <div className="docs-reading-layer" aria-hidden="true" onClick={onDismiss} />
      <div className="docs-reading-bottom" role="toolbar" aria-label={READER_MODE_TEXT.toolbar} ref={bar} onKeyDown={onKeyDown}>
        <ExitButton buttonRef={exit} onExit={onExit} onActivity={onActivity} />
        <div className="docs-reading-turns" role="radiogroup" aria-label={READER_MODE_TEXT.turn} onKeyDown={onTurnKey}>
          {TURNS.map(([way, word]) => (
            <button
              key={way} type="button" role="radio" className="docs-reading-turn" aria-checked={turn === way}
              tabIndex={turn === way ? 0 : -1} onClick={() => { onActivity(); onTurn(way); }}
            >
              {word}
            </button>
          ))}
        </div>
        <button
          type="button" className="docs-reading-aa" aria-label={READER_MODE_TEXT.aa}
          onClick={() => { onActivity(); onAa(); }}
        >
          {READER_MODE_TEXT.aaShown}
        </button>
        <span className="docs-reading-percent" role="status">{line}</span>
      </div>
    </>
  );
}
