// THE WAKE BUDGET (D-5242, plan Task 17b): every wake is a cold `--resume` on a box measured at its memory cap, and
// `ccd`'s spawn path has no concurrency control of its own, so automatic wakes are bounded fleet-wide — at most
// `WAKE_BURST` in any `WAKE_WINDOW_MS`. A wake somebody ASKED for (the operator's ensure, a dispatch's resume) is never
// refused, but it counts in the window.
import { describe, it, expect } from 'vitest';
import {
  WAKE_BURST, WAKE_GATE_DEFAULT, WAKE_HEADROOM_MIN_GIB_DEFAULT, WAKE_PRESSURE_GATES, WAKE_WINDOW_MS, wakeAdmit, wakeMemoryGate, wakeRefund,
  wakeRefusalWord,
} from '../src/coord/wakeBudget.js';
import { CLAUDE_HEADROOM_GATE_BYTES } from '../../shared/claudeVersion.js';
import { wakeGateConfigOf } from '../src/config.js';

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

// D-7542: a wake admitted and then not spent (ccd refused the roll, or its wake failed) gives its slot back.
describe('wakeRefund', () => {
  it('takes back the one admission it names, so the window has room again', () => {
    const a = wakeAdmit([], T0, 'auto');
    const b = wakeAdmit(a.recent, T0 + 1_000, 'auto');
    expect(wakeAdmit(b.recent, T0 + 2_000, 'auto').admit).toBe(false);
    const back = wakeRefund(b.recent, T0 + 1_000);
    expect(back).toEqual([T0]);
    expect(wakeAdmit(back, T0 + 2_000, 'auto').admit).toBe(true);
  });

  it('takes back ONE entry when two wakes share a millisecond', () => {
    expect(wakeRefund([T0, T0], T0)).toEqual([T0]);
  });

  it('an admission already out of the list (pruned, or refunded) changes nothing', () => {
    expect(wakeRefund([T0 + 5], T0)).toEqual([T0 + 5]);
  });

  it('never mutates the list it is handed', () => {
    const recent = [T0, T0 + 1];
    wakeRefund(recent, T0);
    expect(recent).toEqual([T0, T0 + 1]);
  });
});

// D-8122: the memory gate an automatic wake is also asked. Refused is for this pass only; a reading that is not there
// admits (fail open) and says so.
describe('wakeMemoryGate (D-8122)', () => {
  const GiB = 2 ** 30;
  const cfg = WAKE_GATE_DEFAULT;

  it('defaults: warn, and the floor is spec decision 6\'s one figure (no second literal)', () => {
    expect(WAKE_PRESSURE_GATES).toEqual(['warn', 'critical', 'off']);
    expect(cfg.pressure).toBe('warn');
    expect(cfg.headroomMinBytes).toBe(CLAUDE_HEADROOM_GATE_BYTES);
    expect(WAKE_HEADROOM_MIN_GIB_DEFAULT * GiB).toBe(CLAUDE_HEADROOM_GATE_BYTES);
  });

  it('refuses at or above the gate level, pressure first', () => {
    expect(wakeMemoryGate({ level: 'warn', headroomBytes: 0 }, cfg)).toEqual({ admit: false, refused: 'pressure-warn' });
    expect(wakeMemoryGate({ level: 'critical', headroomBytes: 10 * GiB }, cfg)).toEqual({ admit: false, refused: 'pressure-critical' });
    const crit = { ...cfg, pressure: 'critical' as const };
    expect(wakeMemoryGate({ level: 'warn', headroomBytes: 10 * GiB }, crit)).toEqual({ admit: true, notes: [] });
    expect(wakeMemoryGate({ level: 'critical', headroomBytes: 10 * GiB }, crit).admit).toBe(false);
  });

  it('refuses under the floor, admits at it', () => {
    expect(wakeMemoryGate({ level: 'ok', headroomBytes: 3 * GiB - 1 }, cfg)).toEqual({ admit: false, refused: 'headroom-low' });
    expect(wakeMemoryGate({ level: 'ok', headroomBytes: 3 * GiB }, cfg)).toEqual({ admit: true, notes: [] });
  });

  it('off ignores pressure; a 0 floor ignores headroom', () => {
    const off = { pressure: 'off' as const, headroomMinBytes: 0 };
    expect(wakeMemoryGate({ level: 'critical', headroomBytes: 0 }, off)).toEqual({ admit: true, notes: [] });
    expect(wakeMemoryGate({ level: 'unmeasured', headroomBytes: null }, off)).toEqual({ admit: true, notes: [] });
  });

  it('fails OPEN on a missing reading, and names what was missing', () => {
    expect(wakeMemoryGate({ level: 'unmeasured', headroomBytes: null }, cfg))
      .toEqual({ admit: true, notes: ['pressure-unmeasured', 'headroom-unmeasured'] });
    expect(wakeMemoryGate({ level: 'ok', headroomBytes: null }, cfg)).toEqual({ admit: true, notes: ['headroom-unmeasured'] });
  });

  it('the refusal word', () => {
    expect(wakeRefusalWord('headroom-low')).toBe('memory-gate:headroom-low');
  });
});

describe('wakeGateConfigOf (D-8122)', () => {
  const GiB = 2 ** 30;
  it('unset and empty read the defaults', () => {
    expect(wakeGateConfigOf({})).toEqual(WAKE_GATE_DEFAULT);
    expect(wakeGateConfigOf({ CCRC_WAKE_PRESSURE_GATE: '', CCRC_WAKE_HEADROOM_MIN_GIB: '' })).toEqual(WAKE_GATE_DEFAULT);
  });
  it('takes each word and a whole number of GiB', () => {
    expect(wakeGateConfigOf({ CCRC_WAKE_PRESSURE_GATE: 'critical', CCRC_WAKE_HEADROOM_MIN_GIB: '8' }))
      .toEqual({ pressure: 'critical', headroomMinBytes: 8 * GiB });
    expect(wakeGateConfigOf({ CCRC_WAKE_PRESSURE_GATE: 'off', CCRC_WAKE_HEADROOM_MIN_GIB: '0' })).toEqual({ pressure: 'off', headroomMinBytes: 0 });
  });
  it('a value it does not take reads as the default', () => {
    expect(wakeGateConfigOf({ CCRC_WAKE_PRESSURE_GATE: 'WARN', CCRC_WAKE_HEADROOM_MIN_GIB: '2.5' })).toEqual(WAKE_GATE_DEFAULT);
    expect(wakeGateConfigOf({ CCRC_WAKE_HEADROOM_MIN_GIB: '1025' })).toEqual(WAKE_GATE_DEFAULT);
  });
});
