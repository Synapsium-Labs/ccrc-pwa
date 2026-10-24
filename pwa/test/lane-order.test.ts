// The lanes' one order and one binding-window decider (T2c, D-6329): `bindingWindow` names the window that binds a lane,
// and (once it lands) `lanesByFree` orders lanes by it, most free first.
import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { bindingWindow } from '../src/inspector/LaneSection';

const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: 1, fiveResetAt: 1000, sevenResetAt: 2000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});

describe('bindingWindow', () => {
  it('is the fuller window, 7d on a tie, the one measured window alone, null with neither', () => {
    expect(bindingWindow(lane('lane-a', 80, 20))).toEqual({ label: '5h', pct: 80, resetAt: 1000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 20, 80))).toEqual({ label: '7d', pct: 80, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 50, 50))).toEqual({ label: '7d', pct: 50, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', null, 30))).toEqual({ label: '7d', pct: 30, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 30, null))).toEqual({ label: '5h', pct: 30, resetAt: 1000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', null, null))).toBeNull();
  });

  it('on main, a tie whose 7d alone rolled over reads rolled over (the chosen window carries its own flag)', () => {
    expect(bindingWindow(lane('lane-a', 0, 0, { sevenRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: true });
  });
});
