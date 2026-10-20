// The desktop Escape interrupt, owned by the session screen (W2 Task S2d, D-5466).
//
// It used to be an effect inside `SessionHeader`. In the two skins the session's chrome is a skin's part, so a switch
// would replace it, and a skin whose chrome is not `SessionHeader` would have lost the interrupt or copied the effect,
// which is behaviour forked into a skin. `SessionScreen` calls this once, so neither skin's chrome holds it.
//
// The `esc` keycap exists because phone keyboards have no Escape key. Where one exists ((pointer: fine)) the key is
// the better control and the cap is hidden, so the binding lives wherever the cap is hidden: here, for every skin.
import { useEffect } from 'react';
import { useMediaQuery } from '../lib/useMediaQuery';

export interface EscapeInterrupt {
  /** The LIVE status is `busy`: stopping a turn is a fact about the process now, not about how the fleet filed it. */
  busy: boolean;
  onInterrupt: () => void;
}

export function useEscapeInterrupt({ busy, onInterrupt }: EscapeInterrupt): void {
  const finePointer = useMediaQuery('(pointer: fine)');

  useEffect(() => {
    if (!finePointer || !busy) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // D-5235: AN ESCAPE THAT CLOSES A SHEET IS NOT AN INTERRUPT. Radix's
      // dismiss (under every `@ccrc/ui` Sheet and dialog, the terminal drawer
      // included) handles the key in its document capture listener and
      // prevents the default without stopping propagation, so the same
      // keystroke reached this window listener and killed the turn. Both
      // checks: the first is the one Radix sets today; the second holds if a
      // layer ever handles Escape without preventing it.
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]') !== null) return;
      // Escape inside a text field dismisses autocomplete or clears the draft —
      // it must not reach through and kill the turn.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true) return;
      onInterrupt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finePointer, busy, onInterrupt]);
}
