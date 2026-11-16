// D-7542: the automatic roll's wake admission is refundable. `FleetWatcher.admitWakeRefundable` spends a slot of the
// fleet-wide wake budget (`WAKE_BURST` in `WAKE_WINDOW_MS`) and stamps the session's last wake, as `admitWake('auto')`
// does; its `refund` gives both back, so a roll ccd refused, or whose wake failed, neither eats the burst nor delays
// the mail lane's own wake of that session (`MAIL_WAKE_FLOOR_MS`). Neutral ids (public repository).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { WAKE_BURST, type WakeAdmission } from '../src/coord/wakeBudget.js';
import type { HostPsi } from '../../shared/pressure.js';

const T0 = 1_800_000_000_000;
afterEach(() => { vi.restoreAllMocks(); });

function watcher(): FleetWatcher {
  const home = mkTmp('ccrc-roll-wake-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  return new FleetWatcher(testDeps(home, runner), new Bus(), 10_000);
}
const lastWakeAt = (w: FleetWatcher): Map<string, number> => (w as unknown as { lastWakeAt: Map<string, number> }).lastWakeAt;

describe('admitWakeRefundable (D-7542)', () => {
  it('spends a slot as an automatic wake does, and is refused when the window is full', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    expect(w.admitWakeRefundable('lane-a-project-a')).toBeNull();
  });

  it('a refund gives the slot back: the next automatic wake is admitted', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    const held = w.admitWakeRefundable('lane-a-project-a') as WakeAdmission | null;
    expect(held).not.toBeNull();
    for (let i = 1; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    expect(w.admitWake('auto', 'lane-a-project-z'), 'control: the window is full').toBe(false);
    held!.refund();
    expect(w.admitWake('auto', 'lane-a-project-z')).toBe(true);
  });

  it('a refund puts the session\'s last wake back as it stood: none, or the earlier one', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    const fresh = w.admitWakeRefundable('lane-a-project-a') as WakeAdmission | null;
    expect(lastWakeAt(w).get('lane-a-project-a')).toBe(T0);
    fresh!.refund();
    expect(lastWakeAt(w).has('lane-a-project-a'), 'no wake stood before').toBe(false);
    now.mockReturnValue(T0 + 120_000);
    expect(w.admitWake('auto', 'lane-a-project-b')).toBe(true);
    now.mockReturnValue(T0 + 125_000);
    const later = w.admitWakeRefundable('lane-a-project-b') as WakeAdmission | null;
    later!.refund();
    expect(lastWakeAt(w).get('lane-a-project-b')).toBe(T0 + 120_000);
  });

  it('a second refund of the same admission changes nothing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    const held = w.admitWakeRefundable('lane-a-project-a') as WakeAdmission | null;
    held!.refund();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    held!.refund();
    expect(w.admitWake('auto', 'lane-a-project-z'), 'the window is still full').toBe(false);
  });
});

// D-8122: the memory gate. An automatic wake (the roll's, the mail lane's) waits for a later pass while the node's
// pressure is at the gate level or its headroom is under the floor; an asked wake never reads it; no reading admits.
describe('the memory gate on automatic wakes (D-8122)', () => {
  const GiB = 2 ** 30;
  const psi = (full: number): HostPsi => ({
    memory: { some: { avg10: full, avg60: full }, full: { avg10: full, avg60: full } },
    io: { some: { avg10: 0, avg60: 0 }, full: { avg10: 0, avg60: 0 } },
  });
  const plant = (w: FleetWatcher, full: number, headroomBytes: number | null): void => {
    (w as unknown as { pressureLane: { state: unknown } }).pressureLane.state = {
      last: { at: T0, psi: psi(full), headroomBytes }, unansweredAt: null, inflightSince: null,
    };
  };

  it('pressure at warn refuses the roll\'s admission with its word, takes no slot and stamps no wake', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = watcher();
    plant(w, 12, 10 * GiB);
    expect(w.admitWakeRefundable('lane-a-project-a')).toEqual({ refused: 'memory-gate:pressure-warn' });
    expect(w.wakeVerdict('auto', 'lane-a-project-b')).toEqual({ admit: false, refused: 'pressure-warn' });
    expect(lastWakeAt(w).size).toBe(0);
    plant(w, 0, 10 * GiB);
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`), 'no slot was taken').toBe(true);
  });

  it('headroom under the floor refuses; an asked wake is admitted whatever the gate says', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = watcher();
    plant(w, 0, 2 * GiB);
    expect(w.wakeVerdict('auto', 'lane-a-project-a')).toEqual({ admit: false, refused: 'headroom-low' });
    plant(w, 80, 0);
    expect(w.admitWake('asked', 'lane-a-project-a')).toBe(true);
    expect(lastWakeAt(w).get('lane-a-project-a')).toBe(T0);
  });

  it('no reading (an agent with no headroom field, or none yet) admits and journals the fail-open once', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = watcher();
    plant(w, 0, null);
    expect(w.wakeVerdict('auto', 'lane-a-project-a')).toEqual({ admit: true, refused: null });
    expect(w.wakeVerdict('auto', 'lane-a-project-b')).toEqual({ admit: true, refused: null });
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('wake gate'));
    expect(lines).toEqual([expect.stringContaining('headroom-unmeasured')]);
    expect(lines[0]).toContain('fail open');
  });

  it('the budget still refuses as before once the gate admits', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    plant(w, 0, 10 * GiB);
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    expect(w.wakeVerdict('auto', 'lane-a-project-z')).toEqual({ admit: false, refused: 'wake-budget' });
    expect(w.admitWakeRefundable('lane-a-project-z')).toBeNull();
  });
});
