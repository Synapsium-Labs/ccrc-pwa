// Keyboard discipline — the visualViewport-driven bottom inset shared by the
// session screen and the terminal drawer (formerly two private hooks, both
// flagged "Task 14 may consolidate"). Living in lib/ keeps screens ↔ session
// imports acyclic.
import { useEffect, useState } from 'react';

export interface KeyboardInsetOptions {
  /** Track only while true (e.g. while a drawer is open). Default true. */
  active?: boolean;
  /** iOS scrolls the page when the keyboard opens even in a fixed-height
   *  layout; when set, pin the page back to the top so the header stays
   *  on-screen and the reader's place survives focusing the composer. */
  pinTop?: boolean;
}

/** Bottom inset (px) the on-screen keyboard covers, via the visualViewport.
 *  0 when no keyboard or no visualViewport (desktop needs no discipline). */
export function useKeyboardInset({ active = true, pinTop = false }: KeyboardInsetOptions = {}): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = (): void => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset(next);
      if (pinTop && next > 0 && (document.scrollingElement?.scrollTop ?? 0) > 0) {
        window.scrollTo(0, 0);
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active, pinTop]);
  return inset;
}
