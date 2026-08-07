import { describe, it, expect } from 'vitest';
import { formatAge, formatReset } from '../src/fleet/formatReset';

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
