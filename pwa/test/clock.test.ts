import { describe, it, expect } from 'vitest';
import { dayKey, resetClock } from '../src/lib/clock';

describe('resetClock (D-2366)', () => {
  // `now` is derived from the SAME instant so the expectation holds in any TZ.
  const at = 1789430400; // 2026-09-15T00:00:00Z
  it('same day: HH:MM in the local clock, nothing else', () => {
    const now = new Date(at * 1000 + 3_600_000);
    const d = new Date(at * 1000);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(resetClock(at, now)).toBe(hm);
  });
  it('another day: HH:MM · D Mon', () => {
    const now = new Date(at * 1000 - 3 * 86_400_000);
    expect(resetClock(at, now)).toMatch(/^\d\d:\d\d · \d{1,2} [A-Z][a-z]{2}$/);
  });
  it.each([NaN, Infinity])('a non-finite epoch %s has no clock', (value) => {
    expect(resetClock(value)).toBeNull();
  });
});

describe('dayKey (C7, review 1128)', () => {
  it('is the same all day and changes at local midnight', () => {
    const morning = new Date(2026, 9, 28, 0, 0, 0).getTime();
    const evening = new Date(2026, 9, 28, 23, 59, 59, 999).getTime();
    const next = new Date(2026, 9, 29, 0, 0, 0).getTime();
    expect(dayKey(morning)).toBe(dayKey(evening));
    expect(dayKey(next)).not.toBe(dayKey(evening));
    // Distinct across months and years too, not only day numbers.
    expect(dayKey(new Date(2026, 10, 28).getTime())).not.toBe(dayKey(morning));
    expect(dayKey(new Date(2027, 9, 28).getTime())).not.toBe(dayKey(morning));
  });
});
