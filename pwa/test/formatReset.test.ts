import { describe, it, expect } from 'vitest';
import { formatReset } from '../src/fleet/formatReset';

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
