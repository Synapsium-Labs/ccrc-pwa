// The chat list's SIZING contract with react-virtuoso.
//
// This is the one part of the list a test can hold. jsdom reports every height
// as 0 — which is why `ChatListInner` exists as the plain renderer — so no test
// here can prove that the scrollbar stops jumping. What it CAN prove is that
// the four properties the jumping was traced to are still being passed, and
// that is worth pinning precisely because their absence is INVISIBLE: virtuoso
// has a working default for each, the list renders fine without them, and the
// failure only appears in a browser, on a transcript whose items happen to
// vary by a factor of thirty.
//
// Traced 2026-09-16 from three screenshots: the scrollbar thumb opens tiny (a
// transcript ten times longer than it is), grows as you scroll, the text jumps
// under the correction, and the viewport goes fully blank mid-scroll.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, renders: 0 }));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: Record<string, unknown>) => {
      seen.props = props;
      seen.renders += 1;
      return React.createElement('div', { 'data-testid': 'virtuoso' });
    },
  };
});

const { ChatList } = await import('../src/session/ChatList');

const KEY = 'ccrc:chat-item-height';

afterEach(() => {
  cleanup();
  seen.props = null;
  seen.renders = 0;
  localStorage.clear();
});

const NOW = '2026-09-16T02:00:00Z';
const events = (n: number): ChatEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'user' as const, uuid: `u${i}`, ts: NOW, text: `message ${i}`,
  }));

const renderList = (n = 50) =>
  render(<ChatList id="s" events={events(n)} pending={[]} />);

describe('the chat list tells virtuoso how tall a typical item is', () => {
  // Virtuoso's own docs: it "assumes the default item height from the first
  // rendered item (rendering it as a probe)", and warns that an outlier probe
  // costs "multiple passes of rendering". The list opens at the NEWEST turn,
  // so the probe is whatever was said last — a collapsed tool card one time, a
  // turn carrying two markdown tables the next. The second case tells virtuoso
  // that all fifty items are tables.
  it('passes a default height, so one outlier cannot speak for the whole transcript', () => {
    renderList();
    const h = seen.props?.defaultItemHeight;
    expect(typeof h).toBe('number');
    expect(h as number).toBeGreaterThan(0);
  });

  // The number that makes the total right is the MEAN, and the mean here is
  // decided by a handful of giants among a couple of hundred small rows — a
  // property of what this operator asks for, which no constant in a repository
  // can know. So the list opens with what this browser last measured.
  it('opens with what this browser measured last time, not with the fallback', () => {
    localStorage.setItem(KEY, '240');
    renderList();
    expect(seen.props?.defaultItemHeight).toBe(240);
  });

  it('reads that value ONCE — virtuoso takes it at init, so a later change is noise', () => {
    localStorage.setItem(KEY, '240');
    const { rerender } = renderList(50);
    localStorage.setItem(KEY, '480');
    rerender(<ChatList id="s" events={events(51)} pending={[]} />);
    expect(seen.props?.defaultItemHeight).toBe(240);
  });

  it('feeds the real measured sizes back, and remembers them', () => {
    renderList();
    const rendered = (seen.props?.itemsRendered) as ((items: unknown[]) => void) | undefined;
    expect(typeof rendered).toBe('function');

    // Enough samples to cross the write threshold, all the same height so the
    // arithmetic is obvious: nothing was remembered before, so the first sample
    // is taken whole.
    rendered?.(Array.from({ length: 30 }, (_, index) => ({ index, size: 300, offset: 0 })));
    expect(Number(localStorage.getItem(KEY))).toBe(300);
  });

  // Virtuoso reports a size of 0 for an item it has not measured yet; averaging
  // those in would drag the estimate toward zero on every fast scroll.
  it('ignores unmeasured items', () => {
    renderList();
    const rendered = (seen.props?.itemsRendered) as ((items: unknown[]) => void) | undefined;
    rendered?.([
      ...Array.from({ length: 29 }, (_, index) => ({ index, size: 100, offset: 0 })),
      { index: 29, size: 0, offset: 0 },
    ]);
    expect(Number(localStorage.getItem(KEY))).toBe(100);
  });

  // Virtuoso re-reports the same item on every scroll frame. If each sighting
  // were a sample, the average would bend toward whatever the reader happened
  // to park on — so the tall item here is re-reported twenty times and must
  // still weigh exactly as much as it did on the first frame.
  it('counts a re-reported item once, however long it sits on screen', () => {
    renderList();
    const rendered = (seen.props?.itemsRendered) as ((items: unknown[]) => void) | undefined;
    const tall = { index: 29, size: 1200, offset: 0 };
    rendered?.([
      ...Array.from({ length: 29 }, (_, index) => ({ index, size: 60, offset: 0 })),
      tall,
    ]);
    // (29 x 60 + 1200) / 30 = 98, taken whole because nothing was stored yet.
    expect(Number(localStorage.getItem(KEY))).toBe(98);

    // Comfortably more sightings than the write threshold, so an accumulator
    // that counted them would have persisted a much larger average by now.
    for (let i = 0; i < 60; i++) rendered?.([tall]);
    expect(Number(localStorage.getItem(KEY))).toBe(98);
  });

  // Two properties for two failures. The pixel budget covers ordinary
  // scrolling; the item-count floor is the one virtuoso's docs name for "items
  // with dynamic or very tall content, where the pixel-based
  // `increaseViewportBy` may not be sufficient to prevent empty areas".
  it('renders past the viewport in BOTH directions, by pixels and by count', () => {
    renderList();
    const px = seen.props?.increaseViewportBy as { top: number; bottom: number } | undefined;
    expect(px?.top).toBeGreaterThan(0);
    expect(px?.bottom).toBeGreaterThan(0);

    const count = seen.props?.minOverscanItemCount as { top: number; bottom: number } | undefined;
    expect(count?.top).toBeGreaterThan(0);
    expect(count?.bottom).toBeGreaterThan(0);
  });
});

describe('the chat list opens at the newest turn', () => {
  it('asks for the END of the last item, not for the last item at the top', () => {
    renderList();
    expect(seen.props?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' });
  });

  // The prop is read ONCE, on mount. Handing virtuoso a freshly-built object on
  // every render changes nothing it reads and invites it to re-run its initial
  // positioning; the value it replaced was `items.length - 1`, which genuinely
  // changed on every arriving event.
  it('hands over the same value every render, not a new one each time', () => {
    const { rerender } = renderList(50);
    const first = seen.props?.initialTopMostItemIndex;
    rerender(<ChatList id="s" events={events(51)} pending={[]} />);
    expect(seen.renders).toBeGreaterThan(1);
    expect(Object.is(seen.props?.initialTopMostItemIndex, first)).toBe(true);
  });
});
