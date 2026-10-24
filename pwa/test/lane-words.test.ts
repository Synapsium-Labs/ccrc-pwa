// The lanes' words (T2c, D-6329): the reading beside a lane and the accounts door's names. Moved from
// fleet-pieces.test.tsx with only their imports changed.
import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { compactDoorLabel, compactReading } from '../src/fleet/laneWords';

const nowSec = Math.floor(Date.now() / 1000);
const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

describe('the lanes\' words', () => {
  it('the reading is kept three ways, like the full strip: reset when the binding window rolled over, — never measured', () => {
    expect(compactReading(lane('x', 30, 80))).toBe('80%');
    expect(compactReading(lane('x', null, null))).toBe('—');
    // The 5h window rolled over (the server zeroed it) and nothing else was measured: the zero is inferred.
    expect(compactReading(lane('x', 0, null, { fiveRolledOver: true }))).toBe('reset');
    // The 5h window rolled over, but the 7d one binds and was measured.
    expect(compactReading(lane('x', 0, 40, { fiveRolledOver: true }))).toBe('40%');
    expect(compactReading(lane('x', 0, 0, { fiveRolledOver: true, sevenRolledOver: true }))).toBe('reset');
    // A measured zero beside a rolled-over zero is still measured.
    expect(compactReading(lane('x', 0, 0, { fiveRolledOver: true }))).toBe('0%');
  });

  it('the door\'s name carries the fullest lane\'s reading', () => {
    expect(compactDoorLabel([], [])).toBe('account usage — open accounts');
    expect(compactDoorLabel([lane('lane-a', 30, 80), lane('lane-b', 90, null)], [])).toBe('account usage, highest lane-b 90% — open accounts');
  });
});
