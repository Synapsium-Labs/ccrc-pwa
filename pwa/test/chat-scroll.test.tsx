// The chat list's SIZING contract with react-virtuoso, and the loop that
// teaches it.
//
// jsdom has no layout: every rendered height is 0, so no test here can prove
// that the scrollbar stops jumping. What a test CAN hold is the contract the
// fix rides on:
//
//   - the props that stop virtuoso guessing from one probe row are passed;
//   - each row is priced by the form it RENDERS, not by its source text;
//   - the model is taught ONLY by heights read off a row's own element — never
//     by the estimates virtuoso reports for rows it has not measured;
//   - a visit saves when the page is hidden or closed, not only on a clean
//     unmount, and counts once however many times it saves;
//   - a row counts once however many visits measure it: a session reopened
//     three times is the same rows, not three times as many;
//   - a row's lines are lines of the column it is drawn in, read as the list
//     opens and again when the column changes width, so a model learned at
//     one width prices another;
//   - a reader at the newest turn stays there while the list moves on its
//     own — as it opens, and as its rows re-wrap to a new width.
//
// Virtuoso is replaced by a list that renders every row, and ResizeObserver by
// one the test drives: `measure()` plays the browser, handing each row's
// element the height it "rendered" at. The real-pixel numbers live in the PR
// description; they were read in headless Chromium against the real virtuoso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatEvent } from '../../shared/api';
import type { PendingSend } from '../src/stores/session';

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  renders: 0,
  all: [] as Record<string, unknown>[],
  /** Every `scrollToIndex` the list asked of its handle. */
  scrolls: [] as unknown[],
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    // Every row, in order, each in its own wrapper the way virtuoso does it —
    // so the rows' own elements exist for the observer to measure.
    Virtuoso: (props: Record<string, unknown>) => {
      seen.props = props;
      seen.renders += 1;
      seen.all.push(props);
      React.useImperativeHandle(props.ref as React.Ref<unknown>, () => ({
        scrollToIndex: (location: unknown) => { seen.scrolls.push(location); },
      }));
      const count = props.totalCount as number;
      const content = props.itemContent as (i: number) => ReactNode;
      const keyOf = props.computeItemKey as (i: number) => string | number;
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: count }, (_, i) =>
          React.createElement('div', { key: keyOf(i), 'data-index': i }, content(i))),
      );
    },
  };
});

const { ChatList, buildChatItems, shapeOf } = await import('../src/session/ChatList');
const {
  FALLBACK_ITEM_HEIGHT, ROWS_KEY, TABLE_ROW_LINES, WELL_LINES, plainLines, rememberRows, rememberedRows,
} = await import('../src/session/itemHeight');
type HeightBucket = import('../src/session/itemHeight').HeightBucket;
type RowSample = import('../src/session/itemHeight').RowSample;
type MeasuredRow = import('../src/session/itemHeight').MeasuredRow;
type RowRecord = import('../src/session/itemHeight').RowRecord;
type ChatItem = import('../src/session/ChatList').ChatItem;

/** The browser's side of the observer: it is told which elements to watch, and
 *  `measure()` reports a size for them, exactly as a layout pass would. */
class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();
  readonly watched = new Set<Element>();
  readonly cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    FakeResizeObserver.live.add(this);
  }
  observe(el: Element): void { this.watched.add(el); }
  unobserve(el: Element): void { this.watched.delete(el); }
  disconnect(): void { this.watched.clear(); }
  report(px: (row: number) => number | undefined): void {
    const rows = Array.from(document.querySelectorAll('.chat-item'));
    const entries = [...this.watched].flatMap((target) => {
      const row = rows.indexOf(target);
      const h = row < 0 ? undefined : px(row);
      return h === undefined ? [] : [{
        target,
        borderBoxSize: [{ blockSize: h, inlineSize: 390 }],
        contentBoxSize: [{ blockSize: h, inlineSize: 390 }],
        devicePixelContentBoxSize: [],
        contentRect: { height: h, width: 390 } as DOMRectReadOnly,
      } as unknown as ResizeObserverEntry];
    });
    if (entries.length > 0) this.cb(entries, this as unknown as ResizeObserver);
  }
  /** The chat column itself is now `width` wide — a phone turned, a window dragged. */
  reportColumn(width: number): void {
    const entries = [...this.watched].filter((t) => t.classList.contains('chat-list')).map((target) => ({
      target,
      borderBoxSize: [{ blockSize: 600, inlineSize: width }],
      contentBoxSize: [{ blockSize: 600, inlineSize: width }],
      devicePixelContentBoxSize: [],
      contentRect: { height: 600, width } as DOMRectReadOnly,
    } as unknown as ResizeObserverEntry));
    if (entries.length > 0) this.cb(entries, this as unknown as ResizeObserver);
  }
}

/** THE COLUMN'S GEOMETRY. jsdom lays nothing out, so the list's probe of its
 *  column reads 0 everywhere and the list falls back to the nominal measure —
 *  which every test keeps unless it sets `layout.column`. A test ABOUT the
 *  column's width answers the probe here as a browser would at that width:
 *  8px glyphs, a row padded 16px a side, a paragraph capped at the 680px
 *  reading measure, and a bubble at 85% of the row. */
const layout = { column: null as number | null };
const GLYPH_PX = 8;
const realRect = Element.prototype.getBoundingClientRect;
const probedWidth = (el: Element): number | null => {
  const part = el instanceof HTMLElement ? el.dataset.probe : undefined;
  if (layout.column === null || part === undefined) return null;
  const row = layout.column - 32;
  if (part === 'glyphs') return (el.textContent ?? '').length * GLYPH_PX;
  if (part === 'prose') return Math.min(row, 680);
  return Math.floor(row * 0.85);
};
/** Characters a line holds at `width`, in each form — what the probe should read. */
const perLine = (width: number) => ({
  prose: Math.floor(Math.min(width - 32, 680) / GLYPH_PX),
  bubble: Math.floor(Math.floor((width - 32) * 0.85) / GLYPH_PX),
});

/** The column changes width under an open list. */
const widen = (width: number): void => {
  layout.column = width;
  act(() => { for (const o of FakeResizeObserver.live) o.reportColumn(width); });
};

/** Every row renders at the height `px` gives it (by row index); a row `px`
 *  answers `undefined` for is not reported at all. */
const measure = (px: readonly number[] | ((row: number) => number | undefined)): void => {
  const at = typeof px === 'function' ? px : (row: number) => px[row];
  act(() => { for (const o of FakeResizeObserver.live) o.report(at); });
};

const hide = (): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};
const unhide = (): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
};
/** A reload, a closed tab, a killed PWA: the page goes, React's cleanup never runs. */
const pagehide = (): void => { act(() => { window.dispatchEvent(new Event('pagehide')); }); };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element): DOMRect {
    const width = probedWidth(this);
    if (width === null) return realRect.call(this);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  unhide();
});

afterEach(() => {
  cleanup();
  FakeResizeObserver.live.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  layout.column = null;
  seen.props = null;
  seen.renders = 0;
  seen.all = [];
  seen.scrolls = [];
  localStorage.clear();
  unhide();
});

const T0 = Date.parse('2026-09-16T02:00:00Z');
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const linesOf = (n: number, word: string): string =>
  Array.from({ length: n }, (_, i) => `${word} ${i}`).join('\n');

/** Five exchanges eleven minutes apart — so each opens with its own date
 *  divider — of one ask (1..5 lines) and four answers (1, 3, 6 and 10 lines).
 *  Thirty rows: every kind at least five times, at lengths that differ, so a
 *  line is there to be learned. */
const ANSWERS = [1, 3, 6, 10];
const exchanges = (): ChatEvent[] => Array.from({ length: 5 }, (_, g): ChatEvent[] => [
  { kind: 'user', uuid: `u${g}`, ts: at(g * 11), text: linesOf(g + 1, 'ask') },
  ...ANSWERS.map((n, k): ChatEvent => (
    { kind: 'assistant', uuid: `a${g}-${k}`, ts: at(g * 11), text: linesOf(n, 'answer') })),
]).flat();

/** What those thirty rows "really" render at: a divider is 35px, an ask
 *  40 + 22/line, an answer 30 + 19/line. */
const TRUTH: number[] = Array.from({ length: 5 }, (_, g) => [
  35, 40 + 22 * (g + 1), ...ANSWERS.map((n) => 30 + 19 * n),
]).flat();

/** The seeded size of every row, expanded from virtuoso's runs. */
const seededRows = (props: Record<string, unknown> | null = seen.props): number[] | undefined => {
  const snap = props?.restoreStateFrom as
    { ranges: { startIndex: number; endIndex: number; size: number }[] } | undefined;
  return snap?.ranges.flatMap((r) => Array.from({ length: r.endIndex - r.startIndex + 1 }, () => r.size));
};

/** What virtuoso's `itemsRendered` hands over for a row it has NOT measured:
 *  the estimate from its size tree — on a cold profile, the fallback. It is
 *  never 0 while `defaultItemHeight` is set (virtuoso 4.18.11, listState). */
const estimatesFor = (n: number) =>
  Array.from({ length: n }, (_, index) => ({ index, size: FALLBACK_ITEM_HEIGHT, offset: index * FALLBACK_ITEM_HEIGHT }));

const visit = (events: ChatEvent[] = exchanges(), session = 's', busy = false) =>
  render(<ChatList id={session} events={events} pending={[]} busy={busy} />);

/** Put a record in storage the way a previous visit would have left it. */
const remembered = (rows: Partial<Record<HeightBucket, MeasuredRow[]>>): void => {
  rememberRows(new Map(Object.entries(rows) as [HeightBucket, MeasuredRow[]][]), rememberedRows(localStorage), localStorage);
};
let nextId = 0;
const onLine = (a: number, b: number, xs: number[]): MeasuredRow[] =>
  xs.map((lines) => ({ lines, px: a + b * lines, id: (nextId += 1) }));
const stored = (): RowRecord => rememberedRows(localStorage);
/** What was measured, without who it was. */
const bare = (rows: readonly RowSample[]): RowSample[] => rows.map(({ lines, px }) => ({ lines, px }));

describe('the chat list tells virtuoso how tall a row is before it renders one', () => {
  // Virtuoso's own docs: without it, it "assumes the default item height from
  // the first rendered item (rendering it as a probe)". The list opens at the
  // NEWEST turn, so the probe is whatever was said last.
  it('passes a default height, so one outlier cannot speak for the whole transcript', () => {
    visit();
    const h = seen.props?.defaultItemHeight;
    expect(typeof h).toBe('number');
    expect(h as number).toBeGreaterThan(0);
  });

  it('opens a browser that has measured nothing at the fallback, and seeds nothing', () => {
    // Every row would carry the same fallback, so a seed would say only "n
    // rows of 96px" and freeze that total in place of the one virtuoso reaches
    // by measuring what it shows.
    visit();
    expect(seen.props?.defaultItemHeight).toBe(FALLBACK_ITEM_HEIGHT);
    expect(seen.props?.restoreStateFrom).toBeUndefined();
  });

  it('renders past the viewport in BOTH directions, by pixels and by count', () => {
    visit();
    const px = seen.props?.increaseViewportBy as { top: number; bottom: number } | undefined;
    expect(px?.top).toBeGreaterThan(0);
    expect(px?.bottom).toBeGreaterThan(0);
    const count = seen.props?.minOverscanItemCount as { top: number; bottom: number } | undefined;
    expect(count?.top).toBeGreaterThan(0);
    expect(count?.bottom).toBeGreaterThan(0);
  });
});

// THE STUCK MODEL (review 191, F1). The learning loop used to read
// `itemsRendered().size`, which for a row virtuoso has not measured yet is its
// ESTIMATE — on a cold profile the 96px fallback. A save fired on a sample
// count stored those estimates as learned, a reload ran no cleanup to replace
// them, and every later visit opened seeded with the fallback and re-saved it:
// a fixed point. Measured in headless Chromium with the real virtuoso 4.18.11:
// visits 2 and 3 opened at -73% and re-saved 96 each time.
describe('the list learns from heights its rows MEASURED, never from estimates', () => {
  it('a cold visit that ends in a RELOAD teaches the next one the real heights', () => {
    visit();
    // Virtuoso prices rows it has not measured at its estimate…
    (seen.props?.itemsRendered as ((items: unknown[]) => void) | undefined)?.(estimatesFor(TRUTH.length));
    // …then the rows render, and their own elements report what they cost…
    measure(TRUTH);
    // …and the tab is reloaded: no unmount, no React cleanup at all.
    pagehide();

    // The next page load. The first one is still mounted, exactly as a page
    // that was torn down without cleanup would be — nothing of it ran again.
    visit();
    expect(seededRows()).toEqual(TRUTH);
  });

  it('a visit that measured nothing writes nothing, whatever virtuoso estimated', () => {
    visit();
    (seen.props?.itemsRendered as ((items: unknown[]) => void) | undefined)?.(estimatesFor(TRUTH.length));
    pagehide();
    cleanup();
    // "Silence is not evidence": no row was measured, so no kind was learned —
    // and nothing here may switch the next visit's seeding on.
    expect(localStorage.length).toBe(0);
    visit();
    expect(seen.props?.restoreStateFrom).toBeUndefined();
  });

  it('saves when the page is HIDDEN — a backgrounded PWA may never come back', () => {
    visit();
    measure(TRUTH);
    // A visibility change that does not hide the page is not the end of anything.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.length).toBe(0);
    hide();
    unhide();
    visit();
    expect(seededRows()).toEqual(TRUTH);
  });

  it('saves on leaving the session, the ordinary end of a visit', () => {
    visit();
    measure(TRUTH);
    cleanup();
    visit();
    expect(seededRows()).toEqual(TRUTH);
  });

  it('counts a visit ONCE however many times it saves', () => {
    // The record already holds an earlier visit; this one adds its own rows.
    const before = { user: onLine(50, 30, [1, 2, 3, 4]), assistant: onLine(20, 25, [2, 4, 8]) };

    remembered(before);
    visit();
    measure(TRUTH);
    pagehide();
    const once = localStorage.getItem(ROWS_KEY);
    cleanup();

    localStorage.clear();
    remembered(before);
    visit();
    // Hidden once with only the first two exchanges measured…
    measure((row) => (row < 12 ? TRUTH[row] : undefined));
    hide();
    unhide();
    // …then the reader comes back, the rest is measured, and the page goes.
    measure(TRUTH);
    pagehide();
    hide();
    unhide();
    pagehide();
    cleanup();
    // Every save adds this visit's rows to the record THIS VISIT OPENED WITH,
    // so five saves land exactly where one does. Re-reading storage at each
    // save would keep the first save's rows AND add the later ones: one visit
    // would add more than its share.
    expect(localStorage.getItem(ROWS_KEY)).toBe(once);
  });

  it('leaves a kind this visit never measured exactly as it was', () => {
    const tools = onLine(62, 0, [1, 1, 1, 1]);
    remembered({ tool: tools });
    visit();
    // Only the asks (rows 1, 7, 13, 19, 25) are measured.
    measure((row) => (row % 6 === 1 ? TRUTH[row] : undefined));
    cleanup();
    expect(stored().tool).toEqual(tools);
    expect(stored().user.length).toBe(5);
    // Rendered but never measured is not measured.
    expect(stored().assistant).toEqual([]);
    expect(stored().divider).toEqual([]);
  });

  it('counts a row once, however often it is re-measured', () => {
    visit();
    measure(TRUTH);
    for (let i = 0; i < 20; i += 1) measure((row) => (row === 1 ? TRUTH[1] : undefined));
    cleanup();
    expect(stored().user.length).toBe(5);
  });

  it('is not taught by a row that is not laid out — it measures 0', () => {
    visit();
    measure(() => 0);
    cleanup();
    expect(localStorage.length).toBe(0);
  });

  it('keeps a row\'s last real height when the screen stops laying it out', () => {
    // Another screen covers the chat: every row reports 0. That is not a
    // measurement, and it must not wipe the ones that were.
    visit();
    measure(TRUTH);
    measure(() => 0);
    pagehide();
    visit();
    expect(seededRows()).toEqual(TRUTH);
  });

  it('pairs a measurement with the row as it is NOW — a streaming turn grows', () => {
    const events = exchanges();
    const { rerender } = visit(events);
    const grown = [...events.slice(0, -1), { ...events[events.length - 1]!, text: linesOf(40, 'answer') } as ChatEvent];
    rerender(<ChatList id="s" events={grown} pending={[]} busy />);
    measure((row) => (row === TRUTH.length - 1 ? 30 + 19 * 40 : undefined));
    cleanup();
    expect(bare(stored().assistant)).toEqual([{ lines: 40, px: 790 }]);
  });

  // The next visit opens every disclosure CLOSED, so a row the reader opened is
  // not a sample of anything the model will be asked about. Its last closed
  // measurement stands.
  it('keeps a card\'s collapsed height when the reader expands it', () => {
    const events: ChatEvent[] = Array.from({ length: 3 }, (_, i): ChatEvent[] => [
      { kind: 'tool_use', uuid: `tu${i}`, ts: at(0), toolId: `t${i}`, name: 'Bash', input: JSON.stringify({ command: `ls ${i}` }) },
      { kind: 'tool_result', ts: at(0), toolId: `t${i}`, text: 'ok', isError: false },
    ]).flat();
    visit(events);
    // Row 0 is the date divider; the three cards follow.
    measure((row) => (row === 0 ? 35 : 62));
    const row = document.querySelectorAll('.chat-item')[1]!;
    act(() => { fireEvent.click(row.querySelector('.tool-row')!); });
    expect(row.querySelector('[aria-expanded="true"]')).not.toBeNull();
    measure((r) => (r === 1 ? 640 : undefined));
    cleanup();
    expect(stored().tool.map((s) => s.px)).toEqual([62, 62, 62]);
  });

  it('waits for an image to load before it counts the row, then prices the thumbnails apart', () => {
    const events: ChatEvent[] = [
      { kind: 'user', uuid: 'u0', ts: at(0), text: '/x/.cc-clips/demo/clip-a.png\nwhat is this?' },
    ];
    visit(events);
    const row = document.querySelectorAll('.chat-item')[1]!;
    const img = row.querySelector('img')!;
    // jsdom never loads an image, which is exactly the state under test.
    expect(img.complete).toBe(false);
    measure((r) => (r === 1 ? 96 : undefined));
    pagehide();
    expect(stored().user).toEqual([]);

    Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
    const grid = row.querySelector('.msg-attach')!;
    grid.getBoundingClientRect = () => ({ height: 180 }) as DOMRect;
    measure((r) => (r === 1 ? 250 : undefined));
    cleanup();
    // The bubble is priced by its prose alone; the thumbnails are their own term.
    expect(bare(stored().user)).toEqual([{ lines: 1, px: 70 }]);
    expect(bare(stored().attach)).toEqual([{ lines: 1, px: 180 }]);
  });

  it('stops listening when the visit ends — a later hide writes nothing', () => {
    visit();
    measure(TRUTH);
    cleanup();
    localStorage.clear();
    hide();
    unhide();
    pagehide();
    expect(localStorage.length).toBe(0);
  });

  // THE VERIFIER'S REPRO (review 191, F3 after the fix): a tool-heavy session
  // whose rendered window holds ONE assistant turn, a long report, visited
  // three times. The same row, measured on three visits, was three rows —
  // enough to fit — and the fit was that report as a level: every assistant
  // turn of the next session was priced at 1790px. Measured in headless
  // Chromium with the real virtuoso: it opened at +104.5% of its true length.
  it('a report seen on three visits does not price the next session\'s replies', () => {
    const report = linesOf(46, 'finding');
    const audit: ChatEvent[] = [
      { kind: 'user', uuid: 'd-u', ts: at(0), text: 'Run the audit and report back.' },
      ...Array.from({ length: 6 }, (_, i): ChatEvent[] => [
        { kind: 'tool_use', uuid: `d-tu${i}`, ts: at(0), toolId: `d-t${i}`, name: 'Bash', input: JSON.stringify({ command: `check ${i}` }) },
        { kind: 'tool_result', ts: at(0), toolId: `d-t${i}`, text: 'ok', isError: false },
      ]).flat(),
      { kind: 'assistant', uuid: 'd-a', ts: at(0), text: report },
    ];
    // Rows: the divider, the ask, six cards, the report.
    const px = (row: number) => (row === 0 ? 35 : row === 8 ? 1790 : 62);
    for (let v = 0; v < 3; v += 1) {
      visit(audit);
      measure(px);
      pagehide();
      cleanup();
    }
    expect(bare(stored().assistant)).toEqual([{ lines: 46, px: 1790 }]);
    visit([
      { kind: 'user', uuid: 'b-u', ts: at(0), text: 'q' },
      { kind: 'tool_use', uuid: 'b-tu', ts: at(0), toolId: 'b-t', name: 'Bash', input: JSON.stringify({ command: 'ls' }) },
      { kind: 'tool_result', ts: at(0), toolId: 'b-t', text: 'ok', isError: false },
      { kind: 'assistant', uuid: 'b-a', ts: at(0), text: 'two\nlines' },
    ]);
    // The cards are learned; one report and one ask are not a kind, so the
    // divider, the ask and the reply take the fallback.
    expect(seededRows()).toEqual([FALLBACK_ITEM_HEIGHT, FALLBACK_ITEM_HEIGHT, 62, FALLBACK_ITEM_HEIGHT]);
  });

  // A row's identity is its session AND its key: the working row has the key
  // `working` in every session, and those are different rows.
  it('tells the same row on a later visit from the same key in another session', () => {
    const turn: ChatEvent[] = [{ kind: 'assistant', uuid: 'w-a', ts: at(0), text: 'on it' }];
    // Rows: the divider, the turn, the working row.
    const px = (row: number) => (row === 2 ? 30 : undefined);
    for (let v = 0; v < 3; v += 1) { visit(turn, 'one', true); measure(px); cleanup(); }
    expect(stored().working.length).toBe(1);
    for (const session of ['two', 'three']) { visit(turn, session, true); measure(px); cleanup(); }
    expect(stored().working.length).toBe(3);
  });
});

// THE SEEDED SIZES — the part `defaultItemHeight` structurally cannot do. That
// prop is ONE number for every unmeasured row, so it is right either when
// nothing is measured or when half is, never both. These ranges are a per-row
// prior in virtuoso's own size tree; real measurements replace them.
describe('it seeds virtuoso with a size for EVERY row, not one for all of them', () => {
  const learned = (): void => remembered({
    divider: onLine(35, 0, [1, 1, 1]),
    user: onLine(50, 20, [1, 2, 3]),
    assistant: onLine(40, 18, [1, 5, 20]),
    folded: onLine(47, 0, [0, 0, 0]),
  });

  it('prices each row from its own text, and collapses equal neighbours', () => {
    learned();
    const long = linesOf(60, 'line');
    visit([
      ...Array.from({ length: 3 }, (_, i): ChatEvent => ({ kind: 'user', uuid: `u${i}`, ts: at(0), text: 'ask' })),
      { kind: 'assistant', uuid: 'a0', ts: at(0), text: long },
    ]);
    // divider(35), three asks at 50 + 20 x 1, then 40 + 18 x 60.
    expect((seen.props?.restoreStateFrom as { ranges: unknown }).ranges).toEqual([
      { startIndex: 0, endIndex: 0, size: 35 },
      { startIndex: 1, endIndex: 3, size: 70 },
      { startIndex: 4, endIndex: 4, size: 1120 },
    ]);
  });

  // The one number virtuoso prices a row it was NOT seeded with — a row that
  // arrives while the session tails — is this transcript's own mean, under the
  // learned model; the fallback is for a browser that has learned nothing.
  it('opens with the LEARNED default height, the mean of its own rows', () => {
    learned();
    visit();
    const rows = seededRows()!;
    const mean = Math.round(rows.reduce((a, b) => a + b, 0) / rows.length);
    expect(mean).not.toBe(FALLBACK_ITEM_HEIGHT);
    expect(seen.props?.defaultItemHeight).toBe(mean);
  });

  it('opens at the bottom UNDER ITS OWN MODEL, so the two openings agree', () => {
    // Virtuoso routes a restored snapshot through `initialTopMostItemIndex`,
    // the very prop the list also sets; `scrollTop` is the seeded total, the
    // same place `{ index: 'LAST', align: 'end' }` asks for.
    learned();
    visit([{ kind: 'user', uuid: 'u0', ts: at(0), text: 'ask' }]);
    const snap = seen.props?.restoreStateFrom as { scrollTop: number } | undefined;
    expect(snap?.scrollTop).toBe(35 + 70);
    expect(seen.props?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' });
  });

  it('opens a post-compaction session with the recap priced as the card it folds into', () => {
    // A /compact recap runs to hundreds of lines and renders as one ~47px row.
    // Priced by its text it was ~6000px, and the list opened believing it was
    // twice as long as it is — then collapsed by thousands of px on scroll-up.
    learned();
    const recap = 'This session is being continued from a previous conversation that ran out of context.\n'
      + linesOf(300, 'summary');
    visit([{ kind: 'user', uuid: 'u0', ts: at(0), text: recap }, { kind: 'assistant', uuid: 'a0', ts: at(0), text: 'ok' }]);
    expect(seededRows()).toEqual([35, 47, 58]);
  });

  // Virtuoso re-publishes every prop it is handed on every render, and each
  // re-publish of a snapshot rewrites `initialTopMostItemIndex` twice — measured
  // at three `itemsRendered` passes per render instead of one while a reply
  // streams. It only READS the snapshot on mount, so it is only passed then.
  it('hands the snapshot over on the mount render ONLY', () => {
    learned();
    const { rerender } = visit(exchanges());
    expect(seen.props?.restoreStateFrom).toBeDefined();
    rerender(<ChatList id="s" events={[...exchanges(), { kind: 'assistant', uuid: 'late', ts: at(60), text: 'more' }]} pending={[]} />);
    expect(seen.renders).toBeGreaterThan(1);
    expect(seen.props).not.toHaveProperty('restoreStateFrom');
  });

  it('reads storage ONCE per mount, not on every render', () => {
    learned();
    const owner = localStorage instanceof Storage ? Storage.prototype : localStorage;
    const read = vi.spyOn(owner, 'getItem');
    const { rerender } = visit(exchanges());
    for (let i = 0; i < 3; i += 1) {
      rerender(<ChatList id="s" events={[...exchanges(), { kind: 'assistant', uuid: `late${i}`, ts: at(60), text: 'more' }]} pending={[]} />);
    }
    expect(seen.renders).toBeGreaterThan(3);
    const ours = read.mock.calls.filter(([k]) => String(k).startsWith('ccrc:chat-'));
    read.mockRestore();
    expect(ours.length).toBe(1);
  });

  it('seeds NOTHING for an empty transcript rather than an empty snapshot', () => {
    learned();
    visit([]);
    expect(seen.props?.restoreStateFrom).toBeUndefined();
  });

  it('DOES seed once any one kind on screen has been learned', () => {
    remembered({ divider: onLine(35, 0, [1, 1, 1]) });
    visit([{ kind: 'user', uuid: 'u0', ts: at(0), text: 'ask' }]);
    // The ask is not learned yet, so it takes the fallback; the divider its level.
    expect(seededRows()).toEqual([35, FALLBACK_ITEM_HEIGHT]);
  });
});

// Review 191, F2: a row was priced by its SOURCE text even where the renderer
// shows something else. Each case below is a row whose text and whose pixels
// disagree, priced now by the form it is drawn in.
describe('a row is priced by what it RENDERS', () => {
  const only = (events: ChatEvent[], pending: PendingSend[] = []) => {
    const items = buildChatItems(events, pending).filter((i) => i.kind !== 'divider');
    expect(items.length).toBe(1);
    return shapeOf(items[0]!);
  };
  const RECAP = 'This session is being continued from a previous conversation that ran out of context.\n'
    + linesOf(380, 'summary');

  it('a compaction recap is ONE folded card, whoever said it and however long it is', () => {
    expect(only([{ kind: 'user', uuid: 'u', ts: at(0), text: RECAP }])).toEqual({ bucket: 'folded', lines: 0 });
    expect(only([{ kind: 'assistant', uuid: 'a', ts: at(0), text: RECAP }])).toEqual({ bucket: 'folded', lines: 0 });
  });

  it('a multi-line system row folds too; a one-line one is a pill', () => {
    expect(only([{ kind: 'system', uuid: 's', ts: at(0), text: linesOf(200, 'skill body') }]))
      .toEqual({ bucket: 'folded', lines: 0 });
    expect(only([{ kind: 'system', uuid: 's', ts: at(0), text: 'compacted' }]))
      .toEqual({ bucket: 'system', lines: 1 });
    // The harness's own rows are pills whatever their text holds.
    expect(only([{ kind: 'system', uuid: 's', ts: at(0), origin: 'limit', text: 'usage limit reached\nresets at noon' }]))
      .toEqual({ bucket: 'system', lines: 1 });
  });

  it('a collapsed tool card is one row, whatever its input holds', () => {
    const card = (input: string) => only([
      { kind: 'tool_use', uuid: 'tu', ts: at(0), toolId: 't', name: 'Write', input },
    ]);
    // The JSON a Write carries is capped at 4000 chars and has no newlines:
    // priced as text it was 67 nominal lines, and it renders as one 62px row.
    const big = card(JSON.stringify({ file_path: '/x/a.ts', content: 'x'.repeat(3900) }));
    const small = card(JSON.stringify({ command: 'ls' }));
    expect(big).toEqual({ bucket: 'tool', lines: 1 });
    expect(small).toEqual(big);
  });

  it('an AskUserQuestion card is priced by its questions and answers, not its JSON', () => {
    const input = JSON.stringify({ questions: [
      { question: 'Which branch?', header: 'h', multiSelect: false, options: [{ label: 'main', description: 'd'.repeat(500) }] },
      { question: 'Run the tests now?', header: 'h', multiSelect: false, options: [{ label: 'yes' }] },
    ] });
    const use: ChatEvent = { kind: 'tool_use', uuid: 'tu', ts: at(0), toolId: 't', name: 'AskUserQuestion', input };
    // Unanswered: the two questions and the state row under them.
    expect(only([use])).toEqual({ bucket: 'tool', lines: 3 });
    // Answered: each question with its answer on the row beneath.
    expect(only([use, {
      kind: 'tool_result', ts: at(0), toolId: 't', isError: false,
      text: 'Your questions have been answered: "Which branch?"="main", "Run the tests now?"="yes". You can now continue with these answers in mind.',
    }])).toEqual({ bucket: 'tool', lines: 4 });
  });

  it('an attachment is a row of thumbnails, not a line of text', () => {
    const clip = (n: string) => `/x/.cc-clips/demo/clip-${n}.png`;
    expect(only([{ kind: 'user', uuid: 'u', ts: at(0), text: `${clip('a')}\n${clip('b')}\nwhat is this?` }]))
      .toEqual({ bucket: 'user', lines: 1, attach: 1 });     // two sit side by side
    expect(only([{ kind: 'user', uuid: 'u', ts: at(0), text: `${clip('a')}\nwhat is this?` }]))
      .toEqual({ bucket: 'user', lines: 1, attach: 1 });
    expect(only([{ kind: 'user', uuid: 'u', ts: at(0), text: [clip('a'), clip('b'), clip('c'), 'see'].join('\n') }]))
      .toEqual({ bucket: 'user', lines: 1, attach: 2 });
    expect(only([], [{ key: 'p', text: 'look', state: 'sending', attachments: [{ path: clip('a') }, { path: clip('b') }] }]))
      .toEqual({ bucket: 'pending', lines: 1, attach: 1 });
  });

  it('an assistant turn is Markdown: a fence saturates at the well, a table row is taller', () => {
    const fence = '```\n' + linesOf(200, 'code') + '\n```';
    expect(only([{ kind: 'assistant', uuid: 'a', ts: at(0), text: fence }]))
      .toEqual({ bucket: 'assistant', lines: 2 + WELL_LINES });
    expect(only([{ kind: 'assistant', uuid: 'a', ts: at(0), text: '| a | b |\n| c | d |' }]))
      .toEqual({ bucket: 'assistant', lines: 2 * TABLE_ROW_LINES });
  });

  it('a pending send is plain text too: a fence in it is every one of its lines', () => {
    const text = '```\n' + linesOf(30, 'code') + '\n```';
    expect(only([], [{ key: 'p', text, state: 'sending' }])).toEqual({ bucket: 'pending', lines: 32, attach: 0 });
  });

  // Built directly: what is under test is the shape of the card, not the grammar
  // that produces one.
  const event: ChatEvent = { kind: 'user', uuid: 'src', ts: at(0), text: 'x' };
  it('a mail card is its sender and meta rows, a row per artifact, and its body\'s capped well', () => {
    const mail = (artifacts: string[], body: string): ChatItem => ({
      kind: 'mail', key: 'm', event: event as Extract<ChatItem, { kind: 'mail' }>['event'],
      envelope: { id: 1, fromId: 'a', toId: 'b', runId: null, program: null, wave: null, waveOf: null,
        kind: 'status', subject: 'done', artifacts, body },
    });
    // A well neither wraps nor grows past its cap, and is not Markdown.
    expect(shapeOf(mail(['/x/a.md', '/x/b.md'], linesOf(40, 'body')))).toEqual({ bucket: 'mail', lines: 2 + 2 + WELL_LINES });
    expect(shapeOf(mail([], 'x'.repeat(600)))).toEqual({ bucket: 'mail', lines: 2 + 1 });
    expect(shapeOf(mail([], ''))).toEqual({ bucket: 'mail', lines: 2 });
  });

  it('a task card is its summary row, and the closed details toggle when it has details', () => {
    const task = (fields: { name: string; value: string }[]): ChatItem => ({
      kind: 'task', key: 't', event: event as Extract<ChatItem, { kind: 'task' }>['event'],
      notification: { summary: 'build finished', status: 'completed', fields },
    });
    expect(shapeOf(task([]))).toEqual({ bucket: 'task', lines: 1 });
    expect(shapeOf(task([{ name: 'output', value: linesOf(30, 'log') }]))).toEqual({ bucket: 'task', lines: 2 });
  });

  it('a user bubble is plain text: a fence in it is every one of its lines', () => {
    // `.msg-user` is `white-space: pre-wrap` — no markdown, no capped well.
    const text = '```\n' + linesOf(30, 'code') + '\n```';
    expect(only([{ kind: 'user', uuid: 'u', ts: at(0), text }])).toEqual({ bucket: 'user', lines: 32, attach: 0 });
    expect(plainLines(text)).toBe(32);
  });
});

describe('the chat list opens at the newest turn', () => {
  it('asks for the END of the last item, not for the last item at the top', () => {
    visit();
    expect(seen.props?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' });
  });

  // The prop is read ONCE, on mount; a fresh object every render invites the
  // list to re-run its initial positioning.
  it('hands over the same value every render, not a new one each time', () => {
    const { rerender } = visit();
    const first = seen.props?.initialTopMostItemIndex;
    rerender(<ChatList id="s" events={[...exchanges(), { kind: 'assistant', uuid: 'late', ts: at(60), text: 'more' }]} pending={[]} />);
    expect(seen.renders).toBeGreaterThan(1);
    expect(Object.is(seen.props?.initialTopMostItemIndex, first)).toBe(true);
  });
});

// THE COLUMN'S OWN WIDTH (review 191, measured across widths). A row's "lines"
// were counted against a fixed 60 characters, so a row was the same number of
// lines at every width and the learned px-per-line carried the wrap of
// whatever width it was learned at — and the record is one per BROWSER, kept
// across a phone turned on its side or a window dragged narrower. Measured in
// headless Chromium with the real virtuoso: learned upright on a phone, a
// prompt-heavy session opened in landscape +32.6% off its true length, a
// prose-heavy one +19.3%.
describe('a line is a line of the column the row is drawn in', () => {
  const WORDS = ['the', 'cache', 'keeps', 'each', 'result', 'until', 'it', 'goes', 'stale'];
  const prose = (n: number): string => Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(' ');
  /** Five exchanges eleven minutes apart (so five date dividers), each an ask
   *  and a reply that wrap: from one line at any width to whole paragraphs. */
  const LENGTHS = [8, 30, 70, 130, 220];
  const wordy = (): ChatEvent[] => LENGTHS.flatMap((n, g): ChatEvent[] => [
    { kind: 'user', uuid: `wu${g}`, ts: at(g * 11), text: prose(n) },
    { kind: 'assistant', uuid: `wa${g}`, ts: at(g * 11), text: prose(n * 2) },
  ]);
  const wrapped = (text: string, chars: number): number => Math.max(1, Math.ceil(text.length / chars));
  /** What those rows render at in a column `width` wide: a divider 35px; a
   *  bubble 20px of padding and 24px a line; a reply 8px and 24px a line —
   *  at however many characters a line holds THERE. */
  const truthAt = (width: number): number[] => {
    const fit = perLine(width);
    return LENGTHS.flatMap((n) => [35, 20 + 24 * wrapped(prose(n), fit.bubble), 8 + 24 * wrapped(prose(n * 2), fit.prose)]);
  };

  it('a model learned on a phone prices the same rows right on a desktop, and back', () => {
    for (const [learnAt, openAt] of [[390, 1000], [1000, 390]] as const) {
      localStorage.clear();
      layout.column = learnAt;
      visit(wordy(), 'learn');
      measure(truthAt(learnAt));
      pagehide();
      cleanup();

      layout.column = openAt;
      visit(wordy(), 'open');
      expect(seededRows()).toEqual(truthAt(openAt));
      cleanup();
    }
  });

  it('prices a row measured AFTER the column changed width in the new column\'s lines', () => {
    layout.column = 390;
    visit(wordy());
    // Turned on its side mid-visit: every row re-wraps and reports again.
    widen(1000);
    measure(truthAt(1000));
    cleanup();

    layout.column = 1000;
    visit(wordy(), 'next');
    expect(seededRows()).toEqual(truthAt(1000));
  });

  it('does not read a record counted at the old, fixed measure — and clears it away', () => {
    // A record written by the fixed-60 build: three dividers at 35px. Read
    // now, its lines are a different unit from every row measured since.
    const OLD = 'ccrc:chat-row-samples';
    localStorage.setItem(OLD, JSON.stringify({ divider: [[1, 35, 1], [1, 35, 2], [1, 35, 3]] }));
    visit([{ kind: 'user', uuid: 'u0', ts: at(0), text: 'ask' }]);
    expect(seen.props?.restoreStateFrom).toBeUndefined();
    measure([35, 70]);
    cleanup();
    expect(localStorage.getItem(OLD)).toBeNull();
    expect(stored().divider.length).toBe(1);
  });
});

// THE LIST MOVES ON ITS OWN, and a reader at the newest turn stays there
// through it (review 191, measured across widths). Turning a phone or
// dragging a window re-wraps every rendered row, and virtuoso keeps what is in
// view steady by moving the scroll position — with rows rendered ABOVE the
// viewport (`increaseViewportBy`, `minOverscanItemCount`) that move carried a
// reader who was at the newest turn 475-1675px above it, with the "Jump to
// latest" pill up. `followOutput` only answers NEW items. The same happens as
// a cold list opens: rows measured taller than the fallback left it 35-102px
// above the newest turn, pill up, where main opened at the bottom.
describe('a reader at the newest turn stays there while the list moves on its own', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  const atBottom = (bottom: boolean): void => {
    act(() => { (seen.props?.atBottomStateChange as (b: boolean) => void)(bottom); });
  };
  const pill = (): Element | null => document.querySelector('.jump-latest');
  const LAST = { index: 'LAST', align: 'end' };

  it('through a change of width: the rows re-wrap, the reader stays at the newest turn', () => {
    visit();
    atBottom(true);
    clock += 5_000;
    widen(844);
    atBottom(false);
    expect(seen.scrolls).toEqual([LAST]);
    expect(pill()).toBeNull();
    // Back at the bottom, and a second turn of the phone holds as well.
    atBottom(true);
    widen(390);
    atBottom(false);
    expect(seen.scrolls).toEqual([LAST, LAST]);
    expect(pill()).toBeNull();
  });

  it('while it opens: rows taller than they were priced do not leave the reader above the newest turn', () => {
    visit();
    atBottom(false);
    expect(seen.scrolls).toEqual([LAST]);
    expect(pill()).toBeNull();
  });

  it('a reader who had scrolled up is left exactly where they were', () => {
    visit();
    clock += 5_000;
    atBottom(false);
    expect(pill()).not.toBeNull();
    widen(844);
    atBottom(false);
    expect(seen.scrolls).toEqual([]);
    expect(pill()).not.toBeNull();
  });

  it('once the list has settled, leaving the bottom is the reader\'s own doing', () => {
    visit();
    clock += 5_000;
    widen(844);
    clock += 5_000;
    atBottom(false);
    expect(seen.scrolls).toEqual([]);
    expect(pill()).not.toBeNull();
  });

  it('the reader\'s own hand ends the settling at once — a wheel, a touch, a key', () => {
    for (const touch of [
      (el: Element) => fireEvent.wheel(el),
      (el: Element) => fireEvent.touchStart(el),
      (el: Element) => fireEvent.pointerDown(el),
      (el: Element) => fireEvent.keyDown(el, { key: 'PageUp' }),
    ]) {
      visit();
      touch(document.querySelector('[data-testid="virtuoso"]')!);
      atBottom(false);
      expect(seen.scrolls).toEqual([]);
      expect(pill()).not.toBeNull();
      cleanup();
    }
  });
});
