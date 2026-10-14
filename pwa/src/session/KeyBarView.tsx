// The drawer's key bar (D-5007, spec 2026-10-14 §5.4): the keys a phone's
// keyboard lacks, as mono keycaps, in the two shapes the drawer's two views take.
// The GRID view keeps the strip it had — GRID_KEYS, the old quick keys plus ^C.
// The WRAPPED view has a primary row `esc ↑ ↓ ⏎ ^C ⌫ ⋯`, and `⋯` opens a second
// row with the rest of the keys and the `ctrl` latch.
//
// Every byte this sends comes from KEY_SEQ (keyBar.ts); this file spells none. It
// decides nothing about the session: `send` is the drawer's, which is inert until
// the socket is open, and the drawer's own action cap (the history door) is
// rendered beside the keys through `action`, never inside the strip that scrolls.
//
// NAMED KeyBarView, NOT KeyBar: its pure half is `keyBar.ts`, and two modules
// whose names differ only in case are one file on a case-insensitive disk (the
// default on macOS). There `./KeyBar` resolves to `keyBar.ts`, the component is
// never loaded, and tsc refuses the pair (TS1149). `drawer-keybar.test.tsx`
// holds `pwa/src` to no such pair.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GRID_KEYS, KEY_CAP, KEY_SEQ, OVERFLOW_KEYS, PRIMARY_KEYS, ctrlCode, type KeyName } from './keyBar';

/** The one-shot `ctrl` latch. The drawer owns it, so that the bar's `ctrl` cap and
 *  the text field (a later task) share one latch. */
export interface CtrlLatch {
  readonly latched: boolean;
  /** The bar's `ctrl` cap: latch, or unlatch without sending anything. */
  setLatched(v: boolean): void;
  /** Offer one typed character. True when the latch took it: its control code was
   *  sent and the latch cleared, so the caller must not insert the character. A
   *  character that is not one ASCII letter is not taken, and the latch stays. */
  take(ch: string): boolean;
}

export function useCtrlLatch(send: (data: string) => void): CtrlLatch {
  const [latched, setLatchedState] = useState(false);
  // A REF as well as the state: two characters can arrive before React renders
  // again (a fast typist, an IME commit), and a ONE-SHOT latch takes only the first.
  const latchedRef = useRef(false);
  const setLatched = (v: boolean): void => {
    latchedRef.current = v;
    setLatchedState(v);
  };
  const take = (ch: string): boolean => {
    if (!latchedRef.current) return false;
    const code = ctrlCode(ch);
    if (code === null) return false;
    setLatched(false);
    send(code);
    return true;
  };
  return { latched, setLatched, take };
}

export type KeyBarProps =
  | { view: 'grid'; send: (data: string) => void; action?: ReactNode }
  | { view: 'wrapped'; send: (data: string) => void; latch: CtrlLatch; action?: ReactNode };

/** Keep focus where it is (the terminal, or the text field): a tap on a cap must
 *  not take it, or a phone's keyboard closes under the reader's thumb. */
const keepFocus = (e: { preventDefault(): void }): void => e.preventDefault();

export function KeyBar(props: KeyBarProps): ReactNode {
  const [more, setMore] = useState(false);
  const { send } = props;
  const cap = (k: KeyName): ReactNode => (
    <button
      key={k}
      type="button"
      className="keycap"
      aria-label={KEY_CAP[k].label}
      onPointerDown={keepFocus}
      onClick={() => send(KEY_SEQ[k])}
    >
      <span aria-hidden="true">{KEY_CAP[k].legend}</span>
    </button>
  );

  if (props.view === 'grid') {
    return (
      <div className="term-keys term-keys--grid" role="toolbar" aria-label="Terminal keys">
        {/* The sequence caps are the half allowed to scroll away. MEASURED:
            ten caps at --tap-min plus nine gaps and this bar's padding come to
            10x44 + 9x8 + 2x12 = 536px before a legend is laid out,
            and `.sheet-panel--full` drops the drawer's side padding to zero
            — so on a 390px phone the tenth cap starts at x=480, entirely off
            the right edge. Survivable while every cap was a key the phone's
            own keyboard also lacked; not survivable once the strip holds the
            only door touch has to the console history. Below 420px the strip
            wraps onto a second row instead of scrolling (chat.css, D-5007). */}
        <div className="term-keys-seq">{GRID_KEYS.map(cap)}</div>
        {props.action}
      </div>
    );
  }

  const { latch } = props;
  const toggleMore = (): void => {
    // A latch the reader can no longer see is a latch they forget: closing the
    // row that holds the `ctrl` cap unlatches it, and sends nothing.
    if (more) latch.setLatched(false);
    setMore(!more);
  };
  return (
    <div className="term-keys term-keys--wrapped" role="toolbar" aria-label="Terminal keys">
      <div className="term-keys-seq">
        {PRIMARY_KEYS.map(cap)}
        <button
          type="button"
          className="keycap keycap--act"
          aria-label="More keys"
          aria-expanded={more}
          onPointerDown={keepFocus}
          onClick={toggleMore}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
      {props.action}
      {more && (
        <div className="term-keys-more" role="group" aria-label="More terminal keys">
          {OVERFLOW_KEYS.map(cap)}
          <button
            type="button"
            className="keycap keycap--act"
            aria-label="Control"
            aria-pressed={latch.latched}
            onPointerDown={keepFocus}
            onClick={() => latch.setLatched(!latch.latched)}
          >
            <span aria-hidden="true">ctrl</span>
          </button>
        </div>
      )}
    </div>
  );
}
