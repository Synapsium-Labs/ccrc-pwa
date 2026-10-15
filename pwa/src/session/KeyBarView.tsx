// The drawer's key bar (D-5007, spec 2026-10-14 §5.4): the keys a phone's
// keyboard lacks, as mono keycaps, in the two shapes the drawer's two views take.
// The GRID view keeps the strip it had — GRID_KEYS, the old quick keys plus ^C.
// The WRAPPED view has a primary row `esc ↑ ↓ ⏎ ^C ⌫ ⋯`, and `⋯` opens a second
// row with the rest of the keys and the `ctrl` latch.
//
// Every byte this sends comes from KEY_SEQ (keyBar.ts); this file spells none,
// and every byte goes through the ^C/^D guard: the bar is handed an `ExitGuard`,
// never a bare send, so no cap can reach the session around it. The guard's
// decision is the pure `exitNoticeShowing`; the send under it is the drawer's,
// which is inert until the socket is open. The drawer's own action cap (the
// history door) is rendered beside the keys through `action`, never inside a
// half of them.
//
// THE BAR WRAPS WHEN IT DOES NOT FIT, AT ANY WIDTH (D-5007, amended by
// `key-bar-wraps-when-it-does-not-fit`): the keys are two halves, broken where
// `barBreak` says, and the browser puts them on one line or two by the space the
// bar actually has. No width is named anywhere (chat.css, `.term-keys`).
//
// NAMED KeyBarView, NOT KeyBar: its pure half is `keyBar.ts`, and two modules
// whose names differ only in case are one file on a case-insensitive disk (the
// default on macOS). There `./KeyBar` resolves to `keyBar.ts`, the component is
// never loaded, and tsc refuses the pair (TS1149). `drawer-keybar.test.tsx`
// holds `pwa/src` to no such pair.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Keycap } from '@ccrc/ui';
import {
  GRID_KEYS,
  KEY_CAP,
  KEY_SEQ,
  OVERFLOW_KEYS,
  PRIMARY_KEYS,
  barBreak,
  ctrlCode,
  exitNoticeShowing,
  guardedKey,
  type KeyName,
} from './keyBar';

/** The one-shot `ctrl` latch. The drawer owns it, so that the bar's `ctrl` cap and
 *  the letter typed next into xterm's textarea (the drawer's `beforeinput` and
 *  keydown listeners on the host) share one latch. */
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

/**
 * THE ^C/^D GUARD (D-5007, spec 2026-10-14 §5.4, W11). Claude Code clears a
 * draft on a first Ctrl-C and then prints `Press Ctrl-C again to exit` under its
 * box; a second one ends the session. A key you can feel is a decision; a TAP
 * is not, so while that notice is on the screen a tapped ^C or ^D is HELD and
 * the bar asks first. Nothing else is ever held.
 *
 * What is guarded is a tap — a cap in either view, or the `ctrl` latch turning
 * a typed `c` or `d` into one. A physical Ctrl-C typed into an open terminal
 * reaches the session through xterm's own `onData`, never through here.
 */
export interface ExitGuard {
  /** A tap's bytes: sent at once, unless they are a guarded key AND the screen
   *  shows the exit notice now, when they are held for `confirm`. */
  send(data: string): void;
  /** The key held for a confirm, or null when nothing is. */
  readonly held: KeyName | null;
  /** Send the held key, once, and stop holding it. */
  confirm(): void;
  /** Stop holding it; nothing is sent. */
  cancel(): void;
}

/** `screen` is read when a guarded key is TAPPED — the model as it is then, one
 *  string per window row — never a copy taken earlier: the notice appears a
 *  moment after the first Ctrl-C, long after the bar was drawn. */
export function useExitGuard(send: (data: string) => void, screen: () => readonly string[]): ExitGuard {
  const [held, setHeldState] = useState<KeyName | null>(null);
  // A REF as well as the state, as the latch keeps one: two taps on Send can
  // land before React renders again, and the held key is sent ONCE.
  const heldRef = useRef<KeyName | null>(null);
  const setHeld = (k: KeyName | null): void => {
    heldRef.current = k;
    setHeldState(k);
  };
  return {
    held,
    send: (data) => {
      const k = guardedKey(data);
      if (k !== null && exitNoticeShowing(screen())) {
        setHeld(k);
        return;
      }
      send(data);
    },
    confirm: () => {
      const k = heldRef.current;
      if (k === null) return;
      setHeld(null);
      send(KEY_SEQ[k]);
    },
    cancel: () => setHeld(null),
  };
}

/** The bar's two inputs, wired once: the guard, and the latch sending THROUGH
 *  it, so `ctrl` then `c` is asked about exactly as the ^C cap is. The drawer
 *  takes both from here, and so does every test of them. */
export function useKeyInput(
  send: (data: string) => void,
  screen: () => readonly string[],
): { guard: ExitGuard; latch: CtrlLatch } {
  const guard = useExitGuard(send, screen);
  const latch = useCtrlLatch(guard.send);
  return { guard, latch };
}

export type KeyBarProps =
  | { view: 'grid'; guard: ExitGuard; action?: ReactNode }
  | { view: 'wrapped'; guard: ExitGuard; latch: CtrlLatch; action?: ReactNode };

/** Keep focus where it is (xterm's textarea): a tap on a cap must not take it,
 *  or a phone's keyboard closes under the reader's thumb. */
const keepFocus = (e: { preventDefault(): void }): void => e.preventDefault();

export function KeyBar(props: KeyBarProps): ReactNode {
  const [more, setMore] = useState(false);
  const { guard } = props;
  const cap = (k: KeyName): ReactNode => (
    <Keycap
      key={k}
      aria-label={KEY_CAP[k].label}
      onPointerDown={keepFocus}
      onClick={() => guard.send(KEY_SEQ[k])}
    >
      <span aria-hidden="true">{KEY_CAP[k].legend}</span>
    </Keycap>
  );

  // THE CONFIRM takes the keys' place, in either view, until it is answered:
  // a held ^C beside a live ^C cap would invite the second tap the guard is
  // there to stop. It names the consequence, and the two choices follow it
  // TOGETHER, side by side and neither stretched (chat.css,
  // `.term-confirm-choices`); the history door stays beside it.
  if (guard.held !== null) {
    const k = guard.held;
    return (
      <div className={`term-keys term-keys--${props.view}`} role="toolbar" aria-label="Terminal keys">
        <div className="term-confirm" role="group" aria-label={`Confirm ${KEY_CAP[k].label}`}>
          <span className="term-confirm-word" role="alert">
            Claude Code will exit
          </span>
          <div className="term-confirm-choices">
            <Keycap
              aria-label={`Send ${KEY_CAP[k].label}`}
              onPointerDown={keepFocus}
              onClick={guard.confirm}
            >
              <span aria-hidden="true">{`send ${KEY_CAP[k].legend}`}</span>
            </Keycap>
            <Keycap
              className="keycap--act"
              aria-label="Cancel"
              onPointerDown={keepFocus}
              onClick={guard.cancel}
            >
              <span aria-hidden="true">cancel</span>
            </Keycap>
          </div>
        </div>
        {props.action}
      </div>
    );
  }

  /**
   * THE TWO HALVES. `keys` and then the bar's own caps — `toggle` (the wrapped
   * view's `⋯`) and the history door — break where `barBreak` says: the first
   * half takes the larger share of the KEYS, and the second the rest, then
   * `toggle`, then (beside it, in the tail, never inside the half) the door. So
   * a bar too wide for its glass is two even lines, never `⋯` or the door alone
   * on a line.
   *
   * Each grows by its caps that STRETCH (`flex: 1 0 auto` on a key; `⋯` and
   * the door keep their width), so on a wide glass every key cap is the same
   * width whichever half it is in.
   */
  const halves = (keys: readonly KeyName[], toggle: ReactNode): ReactNode => {
    const trailing = (toggle === null ? 0 : 1) + (props.action === undefined ? 0 : 1);
    const cut = barBreak(keys.length + trailing);
    const first = keys.slice(0, cut);
    const second = keys.slice(cut);
    return (
      <>
        <div className="term-keys-seq" style={{ flexGrow: first.length }}>{first.map(cap)}</div>
        <div className="term-keys-tail" style={{ flexGrow: second.length }}>
          <div className="term-keys-seq">
            {second.map(cap)}
            {toggle}
          </div>
          {props.action}
        </div>
      </>
    );
  };

  if (props.view === 'grid') {
    return (
      <div className="term-keys term-keys--grid" role="toolbar" aria-label="Terminal keys">
        {halves(GRID_KEYS, null)}
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
      {halves(
        PRIMARY_KEYS,
        <Keycap
          className="keycap--act"
          aria-label="More keys"
          aria-expanded={more}
          onPointerDown={keepFocus}
          onClick={toggleMore}
        >
          <span aria-hidden="true">⋯</span>
        </Keycap>,
      )}
      {more && (
        <div className="term-keys-more" role="group" aria-label="More terminal keys">
          {OVERFLOW_KEYS.map(cap)}
          <Keycap
            className="keycap--act"
            aria-label="Control"
            aria-pressed={latch.latched}
            onPointerDown={keepFocus}
            onClick={() => latch.setLatched(!latch.latched)}
          >
            <span aria-hidden="true">ctrl</span>
          </Keycap>
        </div>
      )}
    </div>
  );
}
