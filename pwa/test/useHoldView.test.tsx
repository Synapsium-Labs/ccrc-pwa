// D-6090: an automatic roll-up or roll-out above the viewport must not move the card the operator is reading. Chromium's
// scroll anchoring already holds it; WebKit has none, so `useHoldView` scrolls by the anchor's shift itself. Each
// element's box here is its own committed `data-top`, so the render phase reads the old layout and the layout effect
// the new one — the order a real browser gives the hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useHoldView } from '../src/fleet/useHoldView';

function List({ tops, holdKey }: { tops: Record<string, number>; holdKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useHoldView(ref, holdKey);
  return (
    <div ref={ref}>
      {Object.entries(tops).map(([id, top]) => <section key={id} data-id={id} data-top={top} />)}
    </div>
  );
}

let scrollTop = 0;
beforeEach(() => {
  scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = Number(this.getAttribute('data-top') ?? 0);
    return { top, bottom: top + 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Object.defineProperty(document.documentElement, 'scrollTop', {
    configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (document.documentElement as { scrollTop?: number }).scrollTop;
});

describe('useHoldView (D-6090)', () => {
  it('scrolls by the first visible card\'s shift when the rollup changes above it', () => {
    // a is above the viewport, b straddles its top edge: b is the anchor.
    const { rerender } = render(<List holdKey="a:rolled" tops={{ a: -300, b: -50, c: 150 }} />);
    // a rolls out on its own: b and c move down 468 px.
    rerender(<List holdKey="a:open" tops={{ a: -300, b: 418, c: 618 }} />);
    expect(scrollTop).toBe(468);
  });

  it('does nothing when the rollup did not change', () => {
    const { rerender } = render(<List holdKey="k" tops={{ a: -300, b: -50 }} />);
    rerender(<List holdKey="k" tops={{ a: -300, b: 418 }} />);
    expect(scrollTop).toBe(0);
  });

  it('does nothing when the anchor did not move (an engine with scroll anchoring already held it)', () => {
    const { rerender } = render(<List holdKey="a:rolled" tops={{ a: -300, b: -50 }} />);
    rerender(<List holdKey="a:open" tops={{ a: -768, b: -50 }} />);
    expect(scrollTop).toBe(0);
  });
});
