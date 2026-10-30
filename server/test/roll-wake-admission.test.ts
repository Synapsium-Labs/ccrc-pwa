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
import { WAKE_BURST } from '../src/coord/wakeBudget.js';

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
    const held = w.admitWakeRefundable('lane-a-project-a');
    expect(held).not.toBeNull();
    for (let i = 1; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    expect(w.admitWake('auto', 'lane-a-project-z'), 'control: the window is full').toBe(false);
    held!.refund();
    expect(w.admitWake('auto', 'lane-a-project-z')).toBe(true);
  });

  it('a refund puts the session\'s last wake back as it stood: none, or the earlier one', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    const fresh = w.admitWakeRefundable('lane-a-project-a');
    expect(lastWakeAt(w).get('lane-a-project-a')).toBe(T0);
    fresh!.refund();
    expect(lastWakeAt(w).has('lane-a-project-a'), 'no wake stood before').toBe(false);
    now.mockReturnValue(T0 + 120_000);
    expect(w.admitWake('auto', 'lane-a-project-b')).toBe(true);
    now.mockReturnValue(T0 + 125_000);
    const later = w.admitWakeRefundable('lane-a-project-b');
    later!.refund();
    expect(lastWakeAt(w).get('lane-a-project-b')).toBe(T0 + 120_000);
  });

  it('a second refund of the same admission changes nothing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const w = watcher();
    const held = w.admitWakeRefundable('lane-a-project-a');
    held!.refund();
    for (let i = 0; i < WAKE_BURST; i++) expect(w.admitWake('auto', `lane-a-project-${i}`)).toBe(true);
    held!.refund();
    expect(w.admitWake('auto', 'lane-a-project-z'), 'the window is still full').toBe(false);
  });
});
