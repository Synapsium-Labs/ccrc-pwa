// What the chat list does when its height changes (desktop polish wave 168, review 3478 F5, F6 and A8): pure, beside the
// other chat policy.
import { describe, expect, it } from 'vitest';
import { TAP_SETTLE_MS, heightMove, holdShift, type HeightChange } from '../src/session/footFollow';

/** A reader at the foot of a 2000px list in an 800px view, the pill's band 40px, nothing tapped. */
const AT_FOOT: HeightChange = { pinned: true, before: 2000, scrollTop: 1200, clientHeight: 800, band: 40, sinceTap: null };

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

describe('holdShift', () => {
  it('scrolls by how far the item at the top of the view moved, and not for rounding', () => {
    expect(holdShift(-258, -208)).toBe(50);
    expect(holdShift(10, 4)).toBe(-6);
    expect(holdShift(10, 10.6)).toBe(0);
  });
});
