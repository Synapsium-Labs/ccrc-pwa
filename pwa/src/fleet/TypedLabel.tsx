import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Per-character delay. EXPORTED so the test advances the clock by a multiple
 *  of it rather than re-guessing a literal that a tuning change would silently
 *  invalidate. */
export const TYPE_MS = 28;

/**
 * Streams a CHANGED label in, character by character, with a caret.
 *
 * First mount never animates: a fleet screen that typed fourteen session names
 * in on every navigation would be a stunt, not a signal. What this marks is the
 * one event it exists for — a workspace's branch taking the name the model
 * wrote for it, arriving on some later frame with nothing else on screen
 * changing.
 *
 * The settled value is ONE text node. `getNodeText` — what Testing Library's
 * `getByText` matches on — concatenates direct text-node children only, and the
 * header's crumb is already read that way (`header.test.tsx:502`), so a
 * per-character split into sibling spans would break queries that have nothing
 * to do with this feature.
 *
 * The caret is a glyph rather than a stylesheet rule because a blinking one
 * would owe `contrast.test.ts`'s `KEYFRAME_TROUGHS` a registered opacity trough
 * — for a mark on screen for at most `text.length * TYPE_MS` ms.
 */
export function TypedLabel({ text, className }: { text: string; className?: string }): ReactNode {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(text);
  const prev = useRef(text);

  useEffect(() => {
    if (text === prev.current) return;   // first mount, and every re-render that changed nothing
    prev.current = text;
    if (reduced) { setShown(text); return; }
    setShown('');
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, TYPE_MS);
    // Retarget rather than interleave: a second change mid-flight cancels the
    // first run before the next one starts.
    return () => { clearInterval(timer); };
  }, [text, reduced]);

  return (
    <span className={className}>
      {shown}
      {shown !== text && <span className="typed-caret" aria-hidden="true">▏</span>}
    </span>
  );
}
