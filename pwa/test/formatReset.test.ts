import { describe, it, expect } from 'vitest';
import { formatAge, formatElapsed, formatReset } from '../src/fleet/formatReset';

describe('formatReset', () => {
  const now = 1_000_000;
  it('formats days, hours, minutes compactly', () => {
    expect(formatReset(now + 2 * 3600 + 10 * 60, now)).toBe('2h 10m');
    expect(formatReset(now + 3 * 86400 + 4 * 3600, now)).toBe('3d 4h');
    expect(formatReset(now + 45 * 60, now)).toBe('45m');
    expect(formatReset(now + 5 * 3600, now)).toBe('5h');
    expect(formatReset(now + 3 * 86400, now)).toBe('3d');
  });
  it('handles past / unknown', () => {
    expect(formatReset(now - 10, now)).toBe('now');
    expect(formatReset(null, now)).toBe('—');
  });
});

// AccountsScreen's freshness line ("last reported <age>"): the accounts
// screen's own honest-telemetry note, Task 6 of Build 3 PR G. `null` reads as
// "—" for the identical reason formatReset's does — no sample has ever
// landed, not a zero-age one.
describe('formatAge', () => {
  it('formats hours and days as ago-phrases', () => {
    expect(formatAge(2 * 3600)).toBe('2h ago');
    expect(formatAge(3 * 86400)).toBe('3d ago');
  });
  it('reads under two minutes as "just now"', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(90)).toBe('just now');
  });
  it('is "—" when nothing has ever been reported', () => {
    expect(formatAge(null)).toBe('—');
  });
});

// Task 3 (spawn visibility): the dispatch window's own readout. A THIRD
// time-format here rather than a fourth idiom somewhere else — `formatReset`
// counts DOWN to a future moment, `formatAge` rounds a settled past to a
// coarse ago-phrase ("just now" for anything under two minutes), and neither
// can say "42 seconds and climbing", which is the only thing an operator
// watching a spawn actually wants. A stopwatch reading is its own question.
describe('formatElapsed', () => {
  it('reads as a stopwatch: m:ss under the hour, seconds always two digits', () => {
    expect(formatElapsed(42_000)).toBe('0:42');
    expect(formatElapsed(247_000)).toBe('4:07');
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
  });

  it('grows an hours field rather than counting past 59 minutes', () => {
    // A wedged dispatch is rendered by its own branch, not by this helper, but
    // Task 4's pending child carries the same clock and nothing bounds how
    // long an operator leaves one on screen. `62:03` would read as a number,
    // not a duration.
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
  });

  it('floors the partial second rather than rounding it up', () => {
    // The row must never read `0:43` while `dispatchStartedAt` is 42.9s old:
    // the elapsed clock is a measurement of a span that has actually passed.
    expect(formatElapsed(42_999)).toBe('0:42');
  });

  it('clamps a negative span to zero — clock skew is not a negative duration', () => {
    // `dispatchStartedAt` is stamped by the SERVER's clock and subtracted from
    // the PHONE's. A few seconds of skew is ordinary and must render as
    // "the spawn just began", never as `-0:03` or `NaN`.
    expect(formatElapsed(-3_000)).toBe('0:00');
  });
});
