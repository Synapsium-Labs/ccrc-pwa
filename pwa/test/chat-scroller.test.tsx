// THE SCROLLER'S OWN PROPS, which every Virtuoso stand-in in this suite
// ignores.
//
// Four files mock `react-virtuoso` as a plain list — the right call for a
// screen test, because jsdom has no viewport to measure and the point there is
// the ITEMS. What that leaves unmeasured is everything `ChatList` tells the
// scroller: when to follow new output, when the reader has left the bottom,
// what key an item carries, and the "Jump to latest" pill that only exists
// once they have. Measured: statements 146, 161 and 171 of `ChatList.tsx` and
// branches 143#1, 146#0, 161#0/1, 166#1 uncovered with the suite green.
//
// So this mock CAPTURES the props instead of discarding them, the way
// `history-term-latch.test.ts` captures xterm's callbacks — and it exposes the
// imperative handle too, since the pill's whole job is to call it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';

interface Captured {
  totalCount: number;
  itemContent: (i: number) => unknown;
  computeItemKey: (i: number) => string | number;
  followOutput: (atBottom: boolean) => 'smooth' | false;
  atBottomStateChange: (atBottom: boolean) => void;
  initialTopMostItemIndex: number;
  alignToBottom: boolean;
}

const seen = vi.hoisted(() => ({
  props: null as null | Captured,
  scrolls: [] as { index: number; behavior?: string }[],
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Captured, ref: React.Ref<unknown>) => {
      seen.props = props;
      // The imperative handle the pill reaches for. A stand-in that rendered
      // the list but handed back no handle would leave `virtuoso.current`
      // null, and the pill's onClick would be a no-op that still passed a
      // "the button exists" assertion.
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: (arg: { index: number; behavior?: string }) => { seen.scrolls.push(arg); },
      }));
      return React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey(i) }, props.itemContent(i) as never)));
    }),
  };
});

const { ChatList } = await import('../src/session/ChatList');

afterEach(() => { cleanup(); vi.restoreAllMocks(); seen.props = null; seen.scrolls.length = 0; });

const TS = '2026-07-20T10:00:00.000Z';
const assistant = (uuid: string, text: string): ChatEvent =>
  ({ kind: 'assistant', uuid, ts: TS, text });

const mount = (events: ChatEvent[]) => {
  render(<ChatList id="claude:Proj" events={events} pending={[]}
                   onRetry={() => {}} onDiscard={() => {}} />);
  const p = seen.props;
  if (p === null) throw new Error('the scroller was never rendered');
  return p;
};

const THREE = [assistant('a', 'first'), assistant('b', 'second'), assistant('c', 'third')];

describe('what ChatList tells the scroller', () => {
  it('follows new output ONLY while the reader is at the bottom', () => {
    // `'smooth'` scrolls to the newest line; `false` leaves the view alone.
    // A list that followed unconditionally would yank a reader out of the
    // scrollback every time the session spoke — which is the one thing a
    // transcript must never do.
    const p = mount(THREE);
    expect(p.followOutput(true)).toBe('smooth');
    expect(p.followOutput(false), 'the reader was yanked back to the bottom').toBe(false);
  });

  it('opens on the LAST item, and keeps the list bottom-aligned', () => {
    // A transcript is read from the end. Opening at index 0 would show the
    // oldest line of a thousand.
    // Derived from `totalCount`, not written as a number: `buildChatItems`
    // inserts its own rows (a day divider), so three events are not three
    // items — measured, and the reason this reads the count back.
    const p = mount(THREE);
    expect(p.totalCount).toBeGreaterThan(THREE.length - 1);
    expect(p.initialTopMostItemIndex).toBe(p.totalCount - 1);
    expect(p.alignToBottom).toBe(true);
  });

  it('opens at 0 for an EMPTY transcript rather than at -1', () => {
    // `Math.max(0, length - 1)`. An index of -1 is not a position, and the
    // empty case is the one every fresh session starts in.
    const p = mount([]);
    expect(p.initialTopMostItemIndex).toBe(0);
    expect(p.totalCount).toBe(0);
  });

  it('keys each item by its own key, and falls back to the index', () => {
    // The key is what keeps a re-render from re-mounting every bubble (and
    // losing a copy button's "Copied" state with it). `?? i` is the arm for an
    // index the item list does not reach — which `itemContent` answers for
    // below, and the two have to agree or React keys a null.
    const p = mount(THREE);
    expect(p.computeItemKey(0)).not.toBe(0);
    expect(p.computeItemKey(99), 'an out-of-range index has no key of its own').toBe(99);
  });

  it('renders nothing for an index the list does not have', () => {
    // Virtuoso can ask for an index that has gone: it measures
    // asynchronously, and the transcript shrinks on a `backlog` frame. Without
    // the guard this reads `item.key` off `undefined` inside the renderer.
    const p = mount(THREE);
    expect(p.itemContent(99)).toBeNull();
  });
});

describe('Jump to latest', () => {
  it('is hidden while the reader is at the bottom', () => {
    // It would be a button offering to take them where they already are.
    mount(THREE);
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull();
  });

  it('appears once they have left, and scrolls to the newest line', () => {
    const p = mount(THREE);
    act(() => { p.atBottomStateChange(false); });
    const pill = screen.getByRole('button', { name: /jump to latest/i });

    fireEvent.click(pill);
    expect(seen.scrolls, 'the pill reached no scroller — the handle was never wired')
      .toEqual([{ index: p.totalCount - 1, behavior: 'smooth' }]);
  });

  it('goes away again when they come back', () => {
    const p = mount(THREE);
    act(() => { p.atBottomStateChange(false); });
    expect(screen.getByRole('button', { name: /jump to latest/i })).toBeInTheDocument();
    act(() => { p.atBottomStateChange(true); });
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull();
  });
});
