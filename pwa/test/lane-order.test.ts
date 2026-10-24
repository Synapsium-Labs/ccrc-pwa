// The lanes' one order and one binding-window decider (T2c, D-6329): `bindingWindow` names the window that binds a lane,
// and (once it lands) `lanesByFree` orders lanes by it, most free first.
import { describe, expect, it } from 'vitest';
import type { AccountUsage } from '../../shared/api';
import { bindingWindow, lanesByFree } from '../src/fleet/laneOrder';

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

  it('a tie reads rolled over only when every window at it rolled over', () => {
    expect(bindingWindow(lane('lane-a', 0, 0, { sevenRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 0, { fiveRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 0, { fiveRolledOver: true, sevenRolledOver: true }))).toEqual({ label: '7d', pct: 0, resetAt: 2000, rolledOver: true });
    // Off a tie only the binding window counts: the other one's flag is not the lane's.
    expect(bindingWindow(lane('lane-a', 0, 40, { fiveRolledOver: true }))).toEqual({ label: '7d', pct: 40, resetAt: 2000, rolledOver: false });
    expect(bindingWindow(lane('lane-a', 0, 40, { sevenRolledOver: true }))).toEqual({ label: '7d', pct: 40, resetAt: 2000, rolledOver: true });
    expect(bindingWindow(lane('lane-a', null, 0, { sevenRolledOver: true }))?.rolledOver).toBe(true);
  });
});

describe('lanesByFree', () => {
  const names = (lanes: readonly AccountUsage[]): string[] => lanesByFree(lanes).map((l) => l.wrapper);

  it('lanes sort by binding use, lowest first, ties in roster order', () => {
    const lanes = [lane('lane-a', 70, 10), lane('lane-b', 5, 40), lane('lane-c', 40, 20), lane('lane-d', 40, 40), lane('lane-e', 0, 0)];
    expect(names(lanes)).toEqual(['lane-e', 'lane-b', 'lane-c', 'lane-d', 'lane-a']);
    // Ties (c, d at 40) keep the input order whichever way it runs.
    expect(names([lanes[3]!, lanes[2]!])).toEqual(['lane-d', 'lane-c']);
    // The input is not reordered in place.
    expect(lanes.map((l) => l.wrapper)).toEqual(['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e']);
  });

  it('a never-read lane and an expired sign-in sort last', () => {
    const lanes = [
      lane('lane-a', null, null), lane('lane-b', 90, 10), lane('lane-c', 5, 5, { authDead: true }),
      lane('lane-d', 20, 20), lane('lane-e', null, null, { authDead: true }), lane('lane-f', 0, null),
    ];
    // Read and signed in by use, then the never-read and the expired ones in their own relative order.
    expect(names(lanes)).toEqual(['lane-f', 'lane-d', 'lane-b', 'lane-a', 'lane-c', 'lane-e']);
  });
});
