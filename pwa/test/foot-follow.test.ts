// What the chat list does when its height changes (desktop polish wave 168, review 3478 F5, F6 and A8, review 3607 F1):
// pure, beside the other chat policy. What the list feeds it, and does with its answer, is `hold-wiring.test.tsx`'s.
import { describe, expect, it } from 'vitest';
import { MOVE_SETTLE_MS, TAP_SETTLE_MS, footLeft, heightMove, holdShift, prependShift, type HeightChange } from '../src/session/footFollow';

/** A reader at the foot of a 2000px list in an 800px view, the pill's band 40px, nothing tapped. */
const AT_FOOT: HeightChange = {
  pinned: true, before: 2000, scrollTop: 1200, clientHeight: 800, band: 40, sinceTap: null, sinceMove: null, newItem: false,
  prepended: false,
};
/** A reader 900px above the foot. */
const UP: HeightChange = { ...AT_FOOT, pinned: false, scrollTop: 300 };

describe('heightMove', () => {
  it('goes to the foot for a change nobody tapped for, while the reader is at the foot', () => {
    expect(heightMove(AT_FOOT)).toBe('foot');
    // Within the pill's band of the foot is at the foot.
    expect(heightMove({ ...AT_FOOT, scrollTop: 1200 - 40 })).toBe('foot');
  });

  it('never takes a reader above the foot to it, whatever the flag says: it holds their place', () => {
    expect(heightMove({ ...AT_FOOT, scrollTop: 1200 - 42 })).toBe('hold');
    expect(heightMove({ ...AT_FOOT, pinned: false })).toBe('hold');
  });

  it('does nothing before the list has reported a height', () => {
    expect(heightMove({ ...AT_FOOT, before: null })).toBe('none');
  });

  it('moves nothing for a change the reader caused by opening or closing a disclosure: the header they tapped stays put', () => {
    for (const where of [AT_FOOT, { ...AT_FOOT, pinned: false, scrollTop: 300 }]) {
      expect(heightMove({ ...where, sinceTap: 0 })).toBe('none');
      expect(heightMove({ ...where, sinceTap: TAP_SETTLE_MS - 1 })).toBe('none');
    }
    // Once the disclosure has settled, a change nobody tapped for is acted on again.
    expect(heightMove({ ...AT_FOOT, sinceTap: TAP_SETTLE_MS })).toBe('foot');
    expect(heightMove({ ...AT_FOOT, pinned: false, sinceTap: TAP_SETTLE_MS })).toBe('hold');
  });
});

describe('the hold\'s bounds (the coordinator\'s, review 3478 round, review 3607 F1)', () => {
  it('never holds while the scroller reports the list moving, whatever moves it', () => {
    expect(heightMove(UP)).toBe('hold');
    expect(heightMove({ ...UP, sinceMove: 0 }), 'a scroll event just now: a fling, a smooth scroll, a key, code').toBe('none');
    expect(heightMove({ ...UP, sinceMove: MOVE_SETTLE_MS - 1 })).toBe('none');
    expect(heightMove({ ...UP, sinceMove: MOVE_SETTLE_MS })).toBe('hold');
  });

  it('never holds for a change that came with an item at either end: appends are the foot follow\'s', () => {
    expect(heightMove({ ...UP, newItem: true })).toBe('none');
    // The foot follow is not bounded by them: a reader at the foot is still followed.
    expect(heightMove({ ...AT_FOOT, newItem: true })).toBe('foot');
    expect(heightMove({ ...AT_FOOT, sinceMove: 0 })).toBe('foot');
  });
});

describe('holdShift', () => {
  it('scrolls by how far the item at the top of the view moved, and not for rounding', () => {
    expect(holdShift(-258, -208, false)).toBe(50);
    expect(holdShift(10, 4, false)).toBe(-6);
    expect(holdShift(10, 10.6, false)).toBe(0);
  });

  it('puts nothing back when the list moved between the change and the compare', () => {
    expect(holdShift(-258, -208, true), 'the difference holds the reader\'s own movement').toBe(0);
  });
});

describe('rows put before the first (desktop polish wave 175)', () => {
  it('a prepend is held for a reader above the foot, though it came with an item at an end', () => {
    expect(heightMove({ ...UP, newItem: true, prepended: true })).toBe('hold');
    expect(heightMove({ ...UP, newItem: true, prepended: false })).toBe('none');
  });

  it('a reader at the foot stays at the foot; a moving list and a tap are left alone, as for any change', () => {
    expect(heightMove({ ...AT_FOOT, newItem: true, prepended: true })).toBe('foot');
    expect(heightMove({ ...UP, newItem: true, prepended: true, sinceMove: MOVE_SETTLE_MS - 1 })).toBe('none');
    expect(heightMove({ ...UP, newItem: true, prepended: true, sinceTap: TAP_SETTLE_MS - 1 })).toBe('none');
  });
});

describe('prependShift: how far the rows moved, by key', () => {
  it('the rows a page put on top, counted by where a row the reader sees went, not by how many were added', () => {
    // Three rows on top; the old first divider went at the join, so four were added and one taken.
    expect(prependShift(['div-a', 'a', 'b', 'c'], ['p1', 'p2', 'p3', 'p4', 'a', 'b', 'c'], 'b')).toBe(3);
  });

  it('a row the join replaced (a stretch that took the page\'s calls) is stood in for by the next one down', () => {
    expect(prependShift(['activity-t5', 'a', 'b'], ['p', 'activity-t1', 'a', 'b'], 'activity-t5')).toBe(1);
  });

  it('nothing on top (the first row the same), or no row in both lists (a new file): no shift', () => {
    expect(prependShift(['a', 'b'], ['a', 'b', 'c'], 'b')).toBe(0);
    expect(prependShift(['a', 'b'], ['x', 'y'], 'a')).toBe(0);
    expect(prependShift([], ['x'], null)).toBe(0);
  });

  it('rows taken from the top move it the other way', () => {
    expect(prependShift(['o1', 'o2', 'a', 'b'], ['a', 'b'], 'a')).toBe(-2);
  });
});

describe('footLeft: the foot left the reader, or the reader left the foot (desktop polish wave 175, item 6a)', () => {
  const GREW = { settling: false, movedUp: false, sinceTap: null };
  it('growth below the reader, or a view that shrank, takes them back to the foot', () => {
    expect(footLeft(GREW)).toBe('foot');
    expect(footLeft({ ...GREW, sinceTap: TAP_SETTLE_MS + 1 })).toBe('foot');
  });

  it('a reader who moved the scroller up leaves the foot', () => {
    expect(footLeft({ ...GREW, movedUp: true })).toBe('leave');
  });

  it('a change the reader caused by tapping a disclosure leaves them where they tapped', () => {
    expect(footLeft({ ...GREW, sinceTap: TAP_SETTLE_MS - 1 })).toBe('leave');
  });

  it('while the column settles, a pinned reader is taken back whatever moved', () => {
    expect(footLeft({ settling: true, movedUp: true, sinceTap: 0 })).toBe('foot');
  });
});
