// THE WAKE BUDGET (D-5242, plan Task 17b): every wake is a cold `--resume` on a box measured at its memory cap, and
// `ccd`'s spawn path has no concurrency control of its own, so automatic wakes are bounded fleet-wide — at most
// `WAKE_BURST` in any `WAKE_WINDOW_MS`. A wake somebody ASKED for (the operator's ensure, a dispatch's resume) is never
// refused, but it counts in the window.
import { describe, it, expect } from 'vitest';
import { WAKE_BURST, WAKE_WINDOW_MS, wakeAdmit } from '../src/coord/wakeBudget.js';

const T0 = 1_800_000_000_000;

describe('wakeAdmit', () => {
  it('pins the figures the operator ruled: two a minute', () => {
    expect(WAKE_BURST).toBe(2);
    expect(WAKE_WINDOW_MS).toBe(60_000);
  });

  it('admits two automatic wakes in a window and refuses the third', () => {
    const a = wakeAdmit([], T0, 'auto');
    expect(a.admit).toBe(true);
    const b = wakeAdmit(a.recent, T0 + 1_000, 'auto');
    expect(b.admit).toBe(true);
    const c = wakeAdmit(b.recent, T0 + 2_000, 'auto');
    expect(c.admit).toBe(false);
    expect(c.recent, 'a refused wake is not recorded').toEqual([T0, T0 + 1_000]);
  });

  it('admits every asked wake and counts it in the window', () => {
    let recent: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = wakeAdmit(recent, T0 + i, 'asked');
      expect(r.admit, `asked wake ${i}`).toBe(true);
      recent = r.recent;
    }
    expect(recent).toHaveLength(4);
    expect(wakeAdmit(recent, T0 + 10, 'auto').admit, 'asked wakes fill the window for automatic ones').toBe(false);
    const one = wakeAdmit([], T0, 'asked');
    expect(wakeAdmit(one.recent, T0 + 1, 'auto').admit, 'one asked wake leaves room for one automatic wake').toBe(true);
  });

  it('forgets a wake at exactly WAKE_WINDOW_MS, and not a millisecond before', () => {
    const full = [T0, T0];
    expect(wakeAdmit(full, T0 + WAKE_WINDOW_MS - 1, 'auto').admit).toBe(false);
    const at = wakeAdmit(full, T0 + WAKE_WINDOW_MS, 'auto');
    expect(at.admit).toBe(true);
    expect(at.recent).toEqual([T0 + WAKE_WINDOW_MS]);
  });

  it('never mutates the list it is handed', () => {
    const recent = [T0];
    wakeAdmit(recent, T0 + 1, 'auto');
    wakeAdmit(recent, T0 + WAKE_WINDOW_MS + 1, 'asked');
    expect(recent).toEqual([T0]);
  });
});
