// The chat list's wiring of the above-reader hold and its bounds (desktop polish wave 168, review 3607 F1 and F7).
//
// `footFollow.ts#heightMove` decides and `foot-follow.test.ts` pins the decision; this file pins what the list feeds it
// and what it does with the answer, so cutting a bound in `ChatList.tsx` (not only in the decider) turns a case red:
//  - a static reader is held when a row above them changes size, and the hold keeps its own baseline (no drift);
//  - the list moving for any reason the scroller reports (a scroll event, whatever moved it) holds nothing, and a move
//    between the change and the compare holds nothing either;
//  - the hold's own correcting write is not taken for the list moving;
//  - a change that came with an item at an end of the list holds nothing;
//  - a tap on a disclosure holds nothing (the header the reader tapped stays).
//
// jsdom lays nothing out, so the stand-in list draws its rows INSIDE the scroller it hands over, and every row's place is
// computed from a height model: rows stacked in DOM order, each 100px unless the case changes it, less the scroller's
// position. Frames run by hand, in the browser's order: the scroll event a position change owes, then the frame callbacks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';

const lay = vi.hoisted(() => ({
  scroller: null as HTMLElement | null,
  /** The scroller's position, and whether a change of it owes a scroll event the next frame dispatches. */
  top: 0,
  owed: false,
  /** Row heights by row key; a row not named is 100px. */
  heights: new Map<string, number>(),
  props: null as Record<string, unknown> | null,
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      lay.props = props;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }));
      const own = React.useCallback((el: HTMLDivElement | null) => {
        if (el !== null) {
          Object.defineProperty(el, 'scrollTop', {
            configurable: true,
            get: () => lay.top,
            set: (v: number) => { if (v !== lay.top) { lay.top = v; lay.owed = true; } },
          });
          Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
        }
        lay.scroller = el;
        (lay.props!.scrollerRef as (el: HTMLElement | null) => void)(el);
      }, []);
      const count = props.totalCount as number;
      const key = props.computeItemKey as (i: number) => string | number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      const rows: React.ReactNode[] = [];
      for (let i = 0; i < count; i += 1) rows.push(React.createElement('div', { key: key(i), 'data-index': i }, content(i)));
      return React.createElement('div', { ref: own, 'data-testid': 'scroller' }, rows);
    }),
  };
});

const { ChatList } = await import('../src/session/ChatList');

// ---- the clock, the frames and the layout ------------------------------------------------------------------------------
let clock = 0;
const frames: FrameRequestCallback[] = [];
const rect = (top: number, height: number): DOMRect =>
  ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const rowsIn = (s: HTMLElement): HTMLElement[] => [...s.querySelectorAll<HTMLElement>('[data-row-key]')];
const heightOf = (key: string): number => lay.heights.get(key) ?? 100;

beforeEach(() => {
  clock = 0;
  frames.length = 0;
  lay.top = 0;
  lay.owed = false;
  lay.heights.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function place(this: HTMLElement): DOMRect {
    const s = lay.scroller;
    if (s === null) return rect(0, 0);
    if (this === s) return rect(0, 600);
    const key = this.dataset.rowKey;
    if (key === undefined) return rect(0, 0);
    let y = 0;
    for (const row of rowsIn(s)) {
      const h = heightOf(row.dataset.rowKey!);
      if (row === this) return rect(y - lay.top, h);
      y += h;
    }
    return rect(0, 0);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  lay.scroller = null;
  lay.props = null;
});

/** One frame, in the browser's order: the scroll event a position change owes, then every frame callback queued
 *  (those queued while it runs, by the scroll event, included). */
const frame = (): void => act(() => {
  if (lay.owed) {
    lay.owed = false;
    lay.scroller!.dispatchEvent(new Event('scroll'));
  }
  for (const f of frames.splice(0)) f(clock);
});
/** The list reports its total height. */
const reports = (h: number): void => act(() => { (lay.props!.totalListHeightChanged as (h: number) => void)(h); });
const total = (): number => rowsIn(lay.scroller!).reduce((sum, r) => sum + heightOf(r.dataset.rowKey!), 0);
/** The row at `index` (DOM order) changes size by `by` px, and the list reports it. */
const resize = (index: number, by: number): void => {
  const key = rowsIn(lay.scroller!)[index]!.dataset.rowKey!;
  lay.heights.set(key, heightOf(key) + by);
  reports(total());
};

// ---- the session ---------------------------------------------------------------------------------------------------------
const TS = '2026-11-22T10:00:00.000Z';
/** Thirty turns of prose, with one tool stretch (a disclosure with `aria-expanded`) in each. */
function session(turns = 30): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (let i = 0; i < turns; i += 1) {
    events.push({ kind: 'user', uuid: `q${i}`, ts: TS, text: `Step ${i}.` });
    events.push({ kind: 'assistant', uuid: `a${i}`, ts: TS, text: `Reading for step ${i}.` });
    events.push({ kind: 'tool_use', uuid: `u${i}`, ts: TS, toolId: `t${i}`, name: 'Read', input: JSON.stringify({ file_path: `/repo/a${i}.ts` }) });
    events.push({ kind: 'tool_result', ts: TS, toolId: `t${i}`, text: 'ok', isError: false });
  }
  return events;
}
const view = (events: ChatEvent[]) => (
  <SkinSetProvider set={REFINED_SET}>
    <ChatList id="s" events={events} pending={[]} busy={false} onRetry={() => {}} onDiscard={() => {}} />
  </SkinSetProvider>
);

/** Mount, and leave a reader resting 1050px down a 100px-per-row list (the row at index 10 crossing the top of the view,
 *  50px of it above), the list's first height reported long ago. */
function resting(events = session()) {
  const mounted = render(view(events));
  expect(rowsIn(lay.scroller!).length, 'the stand-in list drew no rows inside its scroller').toBeGreaterThan(20);
  lay.scroller!.scrollTop = 1050;
  frame();
  reports(total());
  frame();
  clock += 1000;
  return mounted;
}

describe('the list\'s hold of a reader above the foot (review 3607 F1, F7)', () => {
  it('holds a static reader when a row above them grows or shrinks', () => {
    resting();
    resize(2, 50);
    frame();
    expect(lay.top, 'a row above grew by 50px and the reader was not held').toBe(1100);
    clock += 1000;
    resize(3, -30);
    frame();
    expect(lay.top, 'a row above shrank by 30px and the reader was not held').toBe(1070);
  });

  it('holds nothing while the scroller reports the list moving, whatever moved it', () => {
    resting();
    // A scroll no input event announced: a fling's momentum, a smooth scroll, a key with focus on the page, code.
    lay.scroller!.scrollTop = 1080;
    clock += 16;
    frame();
    clock += 50;
    resize(2, 50);
    frame();
    expect(lay.top, 'the hold wrote the scroller while it was moving').toBe(1080);
  });

  it('holds nothing when the list moves between the change and the compare', () => {
    resting();
    resize(2, 50);
    lay.scroller!.scrollTop += 30; // a scroll lands before the frame the hold compares in
    clock += 8;
    frame();
    expect(lay.top, 'the hold set back a reader who moved after the change').toBe(1080);
  });

  it('does not take its own correcting write for the list moving', () => {
    resting();
    resize(2, 50);
    frame();
    expect(lay.top).toBe(1100);
    frame(); // the scroll event the hold's own write owes
    clock += 50;
    resize(3, 40);
    frame();
    expect(lay.top, 'the hold\'s own write stopped the next hold').toBe(1140);
  });

  it('keeps the place it holds as its baseline, so changes under a pixel add up and are put back', () => {
    resting();
    resize(2, 0.6);
    frame();
    expect(lay.top, 'a change under a pixel is not a move').toBe(1050);
    clock += 1000;
    resize(2, 0.6);
    frame();
    expect(lay.top, 'two changes under a pixel drifted the reader by their sum').toBeCloseTo(1051.2, 5);
  });

  it('holds nothing for a change that came with an item at an end of the list', () => {
    const events = session();
    const { rerender } = resting(events);
    rerender(view([...events, { kind: 'assistant', uuid: 'a-new', ts: TS, text: 'One more thing.' }]));
    resize(2, 50); // in the same report as the item arriving
    frame();
    expect(lay.top, 'the hold acted on a change that came with a new item').toBe(1050);
  });

  it('holds nothing for a change the reader caused by tapping a disclosure', () => {
    resting();
    const disclosure = lay.scroller!.querySelector<HTMLElement>('[aria-expanded]');
    expect(disclosure, 'no disclosure in the list').not.toBeNull();
    fireEvent.click(disclosure!);
    clock += 100;
    resize(2, 50);
    frame();
    expect(lay.top, 'a tap\'s change was held').toBe(1050);
  });
});
