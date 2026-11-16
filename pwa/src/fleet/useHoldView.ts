// D-6090: hold the view across an automatic roll-up or roll-out. The rollup can fold or open a project the operator is
// not touching (it goes quiet, or wakes); a card above the viewport then changes height under them. Chromium's scroll
// anchoring absorbs that, WebKit (iOS Safari) has none, so this hook does it for every engine: when `key` (the rollup's
// shape) changes, it records the first visible card's top from the layout still on screen — the render phase, before
// the commit — and, once the new layout is in, scrolls by how far that card moved. Where the engine already held it
// the card has not moved and nothing scrolls.
import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Anchor { readonly el: Element; readonly top: number; readonly scroller: Element }

/** The nearest scrolling ancestor, or the document's own scroller. */
function scrollerOf(el: Element): Element {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement ?? document.documentElement;
}

function anchorIn(list: HTMLElement): Anchor | null {
  const scroller = scrollerOf(list);
  const edge = scroller === document.scrollingElement || scroller === document.documentElement
    ? 0 : scroller.getBoundingClientRect().top;
  for (const el of Array.from(list.children)) {
    const r = el.getBoundingClientRect();
    if (r.bottom > edge) return { el, top: r.top, scroller };
  }
  return null;
}

export function useHoldView(list: RefObject<HTMLElement | null>, key: string): void {
  const seen = useRef(key);
  const anchor = useRef<Anchor | null>(null);
  // Render phase: the DOM still holds the layout on screen. Reading it is all this does (no write), so a render React
  // discards leaves nothing behind but a record the next real change overwrites.
  if (key !== seen.current && list.current !== null) anchor.current = anchorIn(list.current);
  useLayoutEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    const a = anchor.current;
    anchor.current = null;
    if (a === null || !a.el.isConnected) return;
    const shift = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(shift) >= 1) a.scroller.scrollTop += shift;
  }, [key]);
}
