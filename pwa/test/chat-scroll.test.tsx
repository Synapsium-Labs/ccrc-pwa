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
const KINDS_KEY = 'ccrc:chat-item-heights';

/** What the list saved for one bucket: the INTERCEPT of its learned line. The
 *  transcripts below are all one-line turns, so none of them can show a slope
 *  and every fit reduces to `a = the mean of what was measured` — which is what
 *  makes the arithmetic in these cases readable. The slope has its own cases in
 *  `item-height.test.ts`, where the text can be made to vary on purpose. */
const saved = (bucket: string): number | null => {
  const raw = localStorage.getItem(KINDS_KEY);
  if (raw === null) return null;
  const m = (JSON.parse(raw) as Record<string, { a?: unknown } | undefined>)[bucket];
  const n = Number(m?.a);
  return Number.isFinite(n) ? n : null;
};

/** The slope, for the one case that asserts a kind did not learn one. */
const savedSlope = (bucket: string): number | null => {
  const raw = localStorage.getItem(KINDS_KEY);
  if (raw === null) return null;
  const m = (JSON.parse(raw) as Record<string, { b?: unknown } | undefined>)[bucket];
  const n = Number(m?.b);
  return Number.isFinite(n) ? n : null;
};

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

/** A transcript with a KNOWN mixture: `u` user turns then `a` assistant turns. */
const mixed = (u: number, a: number): ChatEvent[] => [
  ...Array.from({ length: u }, (_, i) => ({
    kind: 'user' as const, uuid: `u${i}`, ts: NOW, text: `ask ${i}`,
  })),
  ...Array.from({ length: a }, (_, i) => ({
    kind: 'assistant' as const, uuid: `a${i}`, ts: NOW, text: `answer ${i}`,
  })),
];

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
    expect(saved('user')).toBe(300);
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
    expect(saved('user')).toBe(100);
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
    // The list opens with a DATE DIVIDER before the first turn, so index 0 is
    // not a user turn. That is the point of bucketing rather than a wrinkle in
    // this test: 28 turns at 60 plus one at 1200 is 99 for the `user` bucket,
    // and the divider's own 60 is kept apart from it.
    // Not rounded on the way in: the stored line is blended again on every
    // later visit, and rounding a value that is about to be re-blended just
    // accumulates error. The rounding that matters happens at the render,
    // where `estimateRow` answers whole pixels.
    expect(saved('user')).toBeCloseTo(2880 / 29, 6); // (28 x 60 + 1200) / 29
    expect(saved('divider')).toBe(60);

    // Comfortably more sightings than the write threshold, so an accumulator
    // that counted them would have persisted a much larger average by now.
    for (let i = 0; i < 60; i++) rendered?.([tall]);
    expect(saved('user')).toBeCloseTo(2880 / 29, 6);
  });

  // THE RESIDUAL PR #191 LEFT. The thumb kept opening at the wrong size because
  // one learned number had to serve every session, and sessions differ by their
  // MIXTURE: modelled against virtuoso's own total, a review session and a
  // debugging session pull a single scalar in opposite directions for ever
  // (56% mean error at open, converging on nothing), while the same sequence
  // weighed per bucket gives 19% and falls visit by visit. The mixture is the
  // one thing already known at mount, before a single item is measured.
  it('opens with THIS session\'s mixture, not with one number for every session', () => {
    // The date divider is one of the rows, so it is one of the eleven — seeded
    // here too, because this case is about the MIXTURE and a bucket falling
    // back to a shipped constant would be measuring something else.
    localStorage.setItem(KINDS_KEY, JSON.stringify({ divider: 40, user: 60, assistant: 300 }));
    render(<ChatList id="s" events={mixed(9, 1)} pending={[]} />);
    expect(seen.props?.defaultItemHeight).toBe(80); // (40 + 9 x 60 + 300) / 11
    cleanup();
    // Not reset to null in between: the second render overwrites it, and the
    // two expectations differ, so a mount that never reached virtuoso reds here
    // rather than passing on the first render's props.
    render(<ChatList id="s" events={mixed(1, 9)} pending={[]} />);
    expect(seen.props?.defaultItemHeight).toBe(255); // (40 + 60 + 9 x 300) / 11
  });

  // THE TWO-VISIT PATH, end to end through the component — the one the fix
  // actually rides on, and the one a module test cannot show. Visit one opens
  // with what the old build left (a single scalar seeding every bucket, so the
  // mixture cannot speak yet), measures, and saves on leaving. Visit two opens
  // with the mixture. If this ever stops holding, the fix is inert in a browser
  // however green the arithmetic is.
  it('the SECOND visit opens with what the first one measured, per bucket', () => {
    localStorage.setItem(KEY, '240'); // what the old single-number build left
    render(<ChatList id="s" events={mixed(9, 1)} pending={[]} />);
    // Visit one cannot do better than the scalar: every bucket seeds from it.
    expect(seen.props?.defaultItemHeight).toBe(240);

    const rendered = (seen.props?.itemsRendered) as ((items: unknown[]) => void) | undefined;
    rendered?.([
      { index: 0, size: 40, offset: 0 },                                        // divider
      ...Array.from({ length: 9 }, (_, i) => ({ index: i + 1, size: 60, offset: 0 })), // user turns
      { index: 10, size: 300, offset: 0 },                                      // the answer
    ]);
    cleanup(); // leaving the session is what saves

    render(<ChatList id="s" events={mixed(9, 1)} pending={[]} />);
    // Each bucket's FIRST measurement is taken whole — the 240 was a guess about
    // a mixture, never a measurement of any bucket — so visit two opens on this
    // session's own composition: (40 + 9 x 60 + 300) / 11 = 80. Blending against
    // the guess instead would have opened at 192 and needed five more visits.
    expect(seen.props?.defaultItemHeight).toBe(80);
  });

  it('keeps each bucket apart when it saves', () => {
    render(<ChatList id="s" events={mixed(1, 1)} pending={[]} />);
    const rendered = (seen.props?.itemsRendered) as ((items: unknown[]) => void) | undefined;
    rendered?.([
      { index: 0, size: 40, offset: 0 },   // the date divider
      { index: 1, size: 70, offset: 0 },   // the user turn
      { index: 2, size: 900, offset: 0 },  // the assistant turn
    ]);
    // Three samples is under the mid-visit save threshold, so this visit saves
    // the way most short ones do: on leaving. That path is the reason the
    // threshold exists at all — a closed tab runs no cleanup.
    cleanup();
    expect(saved('divider')).toBe(40);
    expect(saved('user')).toBe(70);
    // Taken WHOLE, not clamped: one row of a kind cannot show a slope, so the
    // measurement lands in the intercept, and a ceiling there would simply
    // discard a real 900px row the way the old 600px band discarded a real
    // 1413px turn.
    expect(saved('assistant')).toBe(900);
    // …and it learned no slope from a single row, rather than inventing one.
    expect(savedSlope('assistant')).toBe(0);
  });

  // THE SEEDED SIZES — the part `defaultItemHeight` structurally cannot do.
  // That prop is ONE number for every unmeasured row, so it is right either
  // when nothing is measured or when half is, never both. These ranges are a
  // per-row prior in virtuoso's own size tree; real measurements arrive on the
  // same stream and replace them.
  describe('it seeds virtuoso with a size for EVERY row, not one for all of them', () => {
    const restored = () =>
      seen.props?.restoreStateFrom as
        { ranges: { startIndex: number; endIndex: number; size: number }[]; scrollTop: number } | undefined;

    it('prices each row from its own text, and collapses equal neighbours', () => {
      localStorage.setItem(KINDS_KEY, JSON.stringify({
        divider: { a: 35, b: 0 }, user: { a: 50, b: 20 }, assistant: { a: 40, b: 18 },
      }));
      // Three one-line asks, then one answer carrying sixty lines.
      const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
      render(<ChatList id="s" events={[
        ...Array.from({ length: 3 }, (_, i) => ({ kind: 'user' as const, uuid: `u${i}`, ts: NOW, text: 'ask' })),
        { kind: 'assistant' as const, uuid: 'a0', ts: NOW, text: long },
      ]} pending={[]} />);

      // divider(35), three asks at 50 + 20 x 1, then 40 + 18 x 60.
      expect(restored()?.ranges).toEqual([
        { startIndex: 0, endIndex: 0, size: 35 },
        { startIndex: 1, endIndex: 3, size: 70 },
        { startIndex: 4, endIndex: 4, size: 1120 },
      ]);
    });

    it('opens at the bottom UNDER ITS OWN MODEL, so the two openings agree', () => {
      // Virtuoso routes a restored snapshot through `initialTopMostItemIndex`,
      // the very prop the list also sets. If they disagreed they would fight
      // over the opening position; `scrollTop` is the seeded total, which is
      // the same place `{ index: 'LAST', align: 'end' }` asks for.
      localStorage.setItem(KINDS_KEY, JSON.stringify({ divider: { a: 35, b: 0 }, user: { a: 60, b: 0 } }));
      render(<ChatList id="s" events={events(4)} pending={[]} />);
      const r = restored();
      expect(r?.scrollTop).toBe(35 + 4 * 60);
      expect(r?.scrollTop).toBe(r?.ranges.reduce((a, g) => a + g.size * (g.endIndex - g.startIndex + 1), 0));
      expect(seen.props?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' });
    });

    it('hands over the same snapshot every render, never a fresh one', () => {
      const { rerender } = renderList(50);
      const first = restored();
      rerender(<ChatList id="s" events={events(51)} pending={[]} />);
      expect(seen.renders).toBeGreaterThan(1);
      expect(Object.is(restored(), first)).toBe(true);
    });

    it('seeds NOTHING for an empty transcript rather than an empty snapshot', () => {
      render(<ChatList id="s" events={[]} pending={[]} />);
      expect(restored()).toBeUndefined();
    });

    it('seeds NOTHING on a browser that has measured nothing yet', () => {
      // Every row would carry the same fallback, so the seed would say only
      // "n rows of 96px" — and saying it before the first render replaces the
      // total virtuoso would have reached by measuring what it shows. Measured
      // in a browser: seeding a cold profile opened at -53% against the truth,
      // not seeding at -8%.
      render(<ChatList id="s" events={events(4)} pending={[]} />);
      expect(restored()).toBeUndefined();
      expect(seen.props?.defaultItemHeight).toBe(96); // …and the guess still rides
    });

    it('DOES seed once any one kind on screen has been measured', () => {
      localStorage.setItem(KINDS_KEY, JSON.stringify({ user: { a: 60, b: 0 } }));
      render(<ChatList id="s" events={events(4)} pending={[]} />);
      expect(restored()?.ranges.length).toBeGreaterThan(0);
    });
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
