import { describe, it, expect } from 'vitest';
import { resetClock } from '../src/lib/clock';

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
});
