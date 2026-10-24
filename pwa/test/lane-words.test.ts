// The lanes' words (T2c, D-6329): a window's one reading and the row's name. Moved from fleet-pieces.test.tsx; the
// moved cases' expected words changed in the commit that made them windowReading's and lanesRowLabel's.
import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { lanesByFree } from '../src/fleet/laneOrder';
import { lanesRowLabel, windowReading } from '../src/fleet/laneWords';

const nowSec = Math.floor(Date.now() / 1000);
const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

describe('the lanes\' words', () => {
  it('a rolled-over window shows 0% and says it reset and the 0% is inferred', () => {
    expect(windowReading(0, true)).toEqual({ shown: '0%', spoken: '0%, inferred: the window reset' });
    // The rolled-over flag wins over whatever percentage came with it: the server zeroed the window.
    expect(windowReading(0, true).shown).toBe('0%');
  });

  it('a measured window shows its percentage and speaks the same words; one never measured shows — and says not measured', () => {
    expect(windowReading(80, false)).toEqual({ shown: '80%', spoken: '80%' });
    // A measured zero is still measured.
    expect(windowReading(0, false)).toEqual({ shown: '0%', spoken: '0%' });
    expect(windowReading(null, false)).toEqual({ shown: '—', spoken: 'not measured' });
  });

  it('the row\'s name with no lane read is \'account usage, no reading\'', () => {
    expect(lanesRowLabel([], [])).toBe('account usage, no reading');
    expect(lanesRowLabel([lane('lane-a', null, null)], [])).toBe('account usage, no reading');
  });

  it('the row\'s name names the fullest of every lane, the last in lanesByFree\'s order included, and ends in no \'open accounts\'', () => {
    const lanes = [lane('lane-a', 30, 80), lane('lane-b', 90, null)];
    const label = lanesRowLabel(lanes, []);
    expect(label).toBe('account usage, highest lane-b 90%');
    expect(label).not.toMatch(/open accounts/);
    // Seven lanes: the fullest is the last in lanesByFree's order (most free first), past any first-four cut.
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => lane(`lane-${x}`, 10 + i * 10, null));
    expect(lanesByFree(many).at(-1)?.wrapper).toBe('lane-g');
    expect(lanesRowLabel(many, [])).toBe('account usage, highest lane-g 70%');
    // A lane whose sign-in expired sorts last in lanesByFree's order; it is still a lane given.
    expect(lanesRowLabel([lane('lane-a', 20, null), lane('lane-b', 95, null, { authDead: true })], [])).toBe('account usage, highest lane-b 95%');
  });

  it('both names take the spoken words', () => {
    // The binding window rolled over: the row's name says it reset and the zero is inferred.
    expect(lanesRowLabel([lane('lane-a', 0, null, { fiveRolledOver: true })], [])).toBe(
      'account usage, highest lane-a 0%, inferred: the window reset',
    );
    // The 5h window rolled over but the 7d one binds and was measured.
    expect(lanesRowLabel([lane('lane-a', 0, 40, { fiveRolledOver: true })], [])).toBe('account usage, highest lane-a 40%');
    // A measured zero beside a rolled-over zero is still measured.
    expect(lanesRowLabel([lane('lane-a', 0, 0, { fiveRolledOver: true })], [])).toBe('account usage, highest lane-a 0%');
  });
});
