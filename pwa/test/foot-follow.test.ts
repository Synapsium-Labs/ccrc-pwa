// The foot follow's decision (desktop polish wave 168, review 3478 F5 and A8): pure, beside the other chat policy.
import { describe, expect, it } from 'vitest';
import { TAP_SETTLE_MS, followsFoot, type FootFollowInput } from '../src/session/footFollow';

/** A reader at the foot of a 2000px list in an 800px view, the pill's band 40px, nothing tapped. */
const AT_FOOT: FootFollowInput = { pinned: true, before: 2000, scrollTop: 1200, clientHeight: 800, band: 40, sinceTap: null };

describe('followsFoot', () => {
  it('follows a height change nobody tapped for, while the reader is at the foot', () => {
    expect(followsFoot(AT_FOOT)).toBe(true);
    // Within the pill's band of the foot is at the foot.
    expect(followsFoot({ ...AT_FOOT, scrollTop: 1200 - 40 })).toBe(true);
  });

  it('never moves a reader who is above the foot, whatever the flag says', () => {
    expect(followsFoot({ ...AT_FOOT, scrollTop: 1200 - 42 })).toBe(false);
    expect(followsFoot({ ...AT_FOOT, pinned: false })).toBe(false);
  });

  it('does nothing before the list has reported a height', () => {
    expect(followsFoot({ ...AT_FOOT, before: null })).toBe(false);
  });

  it('ignores a change the reader caused by opening or closing a disclosure: the header they tapped stays put', () => {
    expect(followsFoot({ ...AT_FOOT, sinceTap: 0 })).toBe(false);
    expect(followsFoot({ ...AT_FOOT, sinceTap: TAP_SETTLE_MS - 1 })).toBe(false);
    // Once the disclosure has settled, growth nobody tapped for is followed again.
    expect(followsFoot({ ...AT_FOOT, sinceTap: TAP_SETTLE_MS })).toBe(true);
  });
});
