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
import { NO_PAGING, type OlderPaging } from '../src/session/olderPages';
import type { PendingSend } from '../src/stores/session';

const lay = vi.hoisted(() => ({
  scroller: null as HTMLElement | null,
  /** The scroller's position, and whether a change of it owes a scroll event the next frame dispatches. */
  top: 0,
  owed: false,
  /** Row heights by row key; a row not named is 100px. */
  heights: new Map<string, number>(),
  /** Whether a write to the scroller lands on a whole pixel, as a browser rounds a position to its device pixels. */
  round: false,
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
            set: (v: number) => { const at = lay.round ? Math.round(v) : v; if (at !== lay.top) { lay.top = at; lay.owed = true; } },
          });
          Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
          // Virtuoso moves its scroller only through these two (fix round 1, F1: the list notes where each left it).
          el.scrollTo = ((o: ScrollToOptions) => { el.scrollTop = o.top ?? el.scrollTop; }) as HTMLElement['scrollTo'];
          el.scrollBy = ((o: ScrollToOptions) => { el.scrollTop += o.top ?? 0; }) as HTMLElement['scrollBy'];
        }
        lay.scroller = el;
        (lay.props!.scrollerRef as (el: HTMLElement | null) => void)(el);
      }, []);
      const count = props.totalCount as number;
      // Virtuoso hands its callbacks its own index, which counts from `firstItemIndex` (wave 175).
      const first = (props.firstItemIndex as number | undefined) ?? 0;
      const key = props.computeItemKey as (i: number) => string | number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      const rows: React.ReactNode[] = [];
      for (let i = 0; i < count; i += 1) rows.push(React.createElement('div', { key: key(first + i), 'data-index': i }, content(first + i)));
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
  lay.round = false;
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
/** The session as the list is handed it; `tail` is what trails the rows and belongs to no transcript file: the working
 *  pulse (`busy`) and the sends still pending (wave 179, fix round 1, F1). */
interface Tail { readonly busy?: boolean; readonly pending?: PendingSend[] }
const view = (events: ChatEvent[], older?: OlderPaging, tail: Tail = {}) => (
  <SkinSetProvider set={REFINED_SET}>
    <ChatList id="s" events={events} pending={tail.pending ?? []} busy={tail.busy ?? false} onRetry={() => {}} onDiscard={() => {}} older={older} onLoadOlder={() => {}} />
  </SkinSetProvider>
);
/** Where the row `key` stands from the scroller's top, by the height model. */
const topOfRow = (key: string): number => {
  const row = rowsIn(lay.scroller!).find((r) => r.dataset.rowKey === key);
  expect(row, `no row ${key}`).toBeDefined();
  return row!.getBoundingClientRect().top;
};

/** Mount, and leave a reader resting 1050px down a 100px-per-row list (the row at index 10 crossing the top of the view,
 *  50px of it above), the list's first height reported long ago. */
function resting(events = session(), tail: Tail = {}) {
  const mounted = render(view(events, undefined, tail));
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

describe('carried from the tool-stretch reviews (desktop polish wave 175, item 6)', () => {
  it('a scroll that moved the scroller in the frame before its event (a smooth scroll\'s first step) is not written over', () => {
    resting();
    resize(2, 50);
    lay.top += 30; // the position moved; its scroll event comes a frame later
    clock += 8;
    frame();
    expect(lay.top, 'the hold wrote over a scroll that had begun').toBe(1080);
  });

  it('the scroll event after the hold\'s write is the reader\'s when they moved the scroller since: the list is moving', () => {
    resting();
    resize(2, 50);
    frame();
    expect(lay.top).toBe(1100);
    lay.top += 40; // the reader scrolls before the event the hold's write owes is dispatched
    frame();
    clock += 50;
    resize(3, 25); // not the reader's 40, so a hold would show
    frame();
    expect(lay.top, 'a reader\'s scroll was taken for the hold\'s own write, and the list was held while moving').toBe(1140);
  });

  it('a position the browser rounds is put back with the next change, never taken as the new place to hold', () => {
    lay.round = true;
    resting();
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    for (let n = 0; n < 6; n += 1) {
      resize(2, 50.6);
      frame();
      frame(); // the event the write owes
      clock += 1000;
    }
    expect(Math.abs(topOfRow(key) - was), 'rounded writes drifted the reader').toBeLessThan(0.75);
  });
});

describe('rows put before the first: an older page (desktop polish wave 175)', () => {
  /** Virtuoso settles a prepend first; the list corrects once the scroller has been quiet for its frames. */
  const settle = (): void => { for (let i = 0; i < 5; i += 1) frame(); };

  const paged = (n: number): ChatEvent[] => Array.from({ length: n }, (_, i) => ({
    kind: 'user' as const, uuid: `old${i}`, ts: TS, text: `Older ${i}.`,
  }));

  it('keeps the row the reader is looking at in place when a page lands above them, by its key', () => {
    const events = session();
    const { rerender } = resting(events);
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    settle();
    expect(topOfRow(key), 'the row the reader was reading moved when the page landed').toBeCloseTo(was, 5);
  });

  it('holds the next row down when the page changes the row at the join (the first time divider goes)', () => {
    const events = session();
    const { rerender } = render(view(events));
    lay.scroller!.scrollTop = 10;
    frame();
    reports(total());
    frame();
    clock += 1000;
    const keys = rowsIn(lay.scroller!).map((r) => r.dataset.rowKey!);
    expect(keys[0]!.startsWith('div-'), 'the list opened without its first time divider').toBe(true);
    const second = keys[1]!;
    const was = topOfRow(second);
    rerender(view([...paged(5), ...events], { ...NO_PAGING, edge: 'more', rows: 5 }));
    expect(rowsIn(lay.scroller!).map((r) => r.dataset.rowKey!), 'the join kept its divider').not.toContain(keys[0]);
    reports(total());
    settle();
    expect(topOfRow(second), 'the row under the join moved when the page landed').toBeCloseTo(was, 5);
  });

  it('a reader who moves while the page settles is left where they moved, never set back', () => {
    const events = session();
    const { rerender } = resting(events);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    lay.scroller!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
    lay.scroller!.scrollTop = 900;
    settle();
    expect(lay.top, 'the settle set back a reader who moved').toBe(900);
  });

  it('fix round 1, F1: a list that moves with no input event while the page settles (a fling, a thumb dragged) is not set back', () => {
    const events = session();
    const { rerender } = resting(events);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    // The finger came down before the page (or none did): only the scroller says the list moved.
    lay.scroller!.scrollTop = 900;
    settle();
    expect(lay.top, 'the settle set back movement no input event announced').toBe(900);
  });

  it('fix round 1, F1: the list\'s own write while the page settles is not the reader moving: the row is held', () => {
    const events = session();
    const { rerender } = resting(events);
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    // Virtuoso's own compensation, from its estimates: 300px of the 1,200 the page added.
    act(() => { lay.scroller!.scrollBy({ top: 300 }); });
    settle();
    expect(topOfRow(key), 'the list\'s own write was taken for the reader, and the row was not held').toBeCloseTo(was, 5);
  });

  it('fix round 2, A3: the list\'s write through scrollTo is its own too: the row is held', () => {
    const events = session();
    const { rerender } = resting(events);
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    act(() => { lay.scroller!.scrollTo({ top: lay.top + 300 }); });
    settle();
    expect(topOfRow(key), 'a scrollTo write was taken for the reader, and the row was not held').toBeCloseTo(was, 5);
  });

  it('fix round 2, A3: a move after the list\'s own write, with no input event, is the reader\'s: left where it went', () => {
    const events = session();
    const { rerender } = resting(events);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    // Virtuoso writes (so the list knows where it left the scroller), then the scroller moves on, by no write of its own and
    // with no input event: a fling under way. Both before the next scroll event.
    act(() => { lay.scroller!.scrollBy({ top: 300 }); });
    const went = lay.top + 200;
    lay.scroller!.scrollTop = went;
    settle();
    expect(lay.top, 'the settle set back a move made after the list\'s own write').toBe(went);
  });

  it('fix round 2, A2: a scroll whose frame comes after a page has landed reads no anchor: the settle holds the reader\'s row', () => {
    const events = session();
    const { rerender } = resting(events);
    // The reader moves up 50px; the scroll event queues its read of the anchor for the next frame.
    lay.scroller!.scrollTop = 1000;
    lay.owed = false;
    act(() => { lay.scroller!.dispatchEvent(new Event('scroll')); });
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    // Before that frame, a page lands: the rows at the top of the view are the page's until virtuoso moves the scroller.
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    settle();
    expect(topOfRow(key), 'the anchor was read off the page\'s rows, and the reader\'s row was not held').toBeCloseTo(was, 5);
  });

  const reset: ChatEvent = { kind: 'system', uuid: 'local-reset-1', ts: TS, text: 'Session context reset' };
  /** The same thirty turns, as another transcript file holds them: every row's own key differs. */
  const otherFile = (): ChatEvent[] => session().map((e): ChatEvent => (e.kind === 'tool_result' ? { ...e, toolId: `x-${e.toolId}` }
    : e.kind === 'tool_use' ? { ...e, uuid: `x-${e.uuid}`, toolId: `x-${e.toolId}` } : { ...e, uuid: `x-${e.uuid}` }));
  const sending: PendingSend = { key: 'p1', text: 'One more thing.', state: 'sending' };

  // Wave 179, fix round 1, F1: the working pulse and a pending send belong to no file, so they survive a change of
  // transcript; they are no row in common, or the lead difference is added to a shift found on them alone.
  for (const [name, tail] of [
    ['idle', {}], ['busy (the working pulse trails)', { busy: true }], ['with a send pending', { pending: [sending] }],
  ] as const satisfies readonly (readonly [string, Tail])[]) {
    it(`desktop polish wave 179, A1: a context reset, then another transcript with no rotation notice, moves no first index (${name})`, () => {
      // The reset row on top (the lead a page goes after), then a backlog onto another file with no row in common and no
      // reset row: nothing was put before the first row, so virtuoso's first index stays where it was.
      const { rerender } = resting([reset, ...session()], tail);
      const first = lay.props!.firstItemIndex;
      rerender(view(otherFile(), undefined, tail));
      expect(rowsIn(lay.scroller!).some((r) => r.dataset.rowKey!.includes('reset')), 'the reset row stayed').toBe(false);
      expect(lay.props!.firstItemIndex, 'a list nothing was put before had its first index moved').toBe(first);
    });
  }

  it('desktop polish wave 179, fix round 1 (M1): a new list that opens with the reset row moves no first index', () => {
    // The other way round: a list with no lead, then another file under a reset row. No row is in common, so the new
    // lead is no rows put before the first either.
    const { rerender } = resting(session());
    const first = lay.props!.firstItemIndex;
    rerender(view([reset, ...otherFile()]));
    expect(rowsIn(lay.scroller!).slice(0, 2).some((r) => r.dataset.rowKey!.includes('reset')), 'the new list opened without its reset row').toBe(true);
    expect(lay.props!.firstItemIndex, 'a new list\'s lead was counted as rows put before the first').toBe(first);
  });

  it('desktop polish wave 179, A2: a page under the reset row holds the reader\'s row (the lead read at the call site)', () => {
    const events = [reset, ...session()];
    const { rerender } = resting(events);
    expect(rowsIn(lay.scroller!).map((r) => r.dataset.rowKey!).slice(0, 2).some((k) => k.includes('reset')),
      'the list did not open with the reset row').toBe(true);
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    rerender(view([reset, ...paged(12), ...session()], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    settle();
    expect(topOfRow(key), 'the row the reader was reading moved when a page landed under the reset row').toBeCloseTo(was, 5);
  });

  it('fix round 2, A2: a height change whose frame comes after a page has landed writes nothing: the settle holds once', () => {
    const events = session();
    const { rerender } = resting(events);
    const key = rowsIn(lay.scroller!).find((r) => r.getBoundingClientRect().bottom > 0)!.dataset.rowKey!;
    const was = topOfRow(key);
    // A row above the reader grows; its hold is queued for the next frame. Before that frame, a page lands.
    resize(2, 40);
    rerender(view([...paged(12), ...events], { ...NO_PAGING, edge: 'more', rows: 12 }));
    reports(total());
    const at = lay.top;
    frame(); // the height change's frame: the page is settling, so it writes nothing
    expect(lay.top, 'the height change\'s frame wrote the scroller while the page settled').toBe(at);
    settle();
    expect(topOfRow(key), 'the row the reader was reading moved').toBeCloseTo(was, 5);
  });
});
