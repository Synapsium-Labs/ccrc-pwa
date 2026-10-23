// Characterization (D-5864; ARCH-51 #786; spec K13's listing half): what a steady `FleetWatcher.tick` lists, and what
// each lane that takes its own listing today sees of a registry that changes BETWEEN two ticks. Green on the code
// before the tick's one `FleetReadModel`. The fake `FleetIO` and its rig are `fleetListingFixture.ts`. Fixture homes
// only; no ccd, tmux or box is reached.
import { afterEach, describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { ASKS_DISABLED_MARKER, MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { LATER, MONO_LATER, callerOf, countBy, primed, rig } from './fleetListingFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('a steady tick, every throttle elapsed: the registry listings by caller (the base table)', () => {
  it('the listings by caller: the tick, the limits read in its assembly, and the lanes that still list for themselves', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const by = countBy(r.listings);
    const n = (c: string): number => by[c] ?? 0;
    // The dialog detector and the hook-state lane take the tick's own `records` and `names`; they never list. `limits` is
    // `readLimits`' marker listing inside `assembleFleet` (the plan counted eight by static reading and missed it).
    expect({ tick: n('tick'), limits: n('readLimits'), tasks: n('tasksPass'), names: n('namesPass'), pr: n('prPass'),
      divergences: n('divergencesPass'), ask: n('askPass'), mail: n('mailPass') })
      .toEqual({ tick: 1, limits: 1, tasks: 0, names: 1, pr: 1, divergences: 1, ask: 1, mail: 2 });
    expect(r.listings.length, 'the steady tick lists eight times in all').toBe(8);
  });
});

describe('a registry that changes between two ticks: each lane reads the newest listing', () => {
  it('the task lane sees a session that appeared between the ticks', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row('demo-b', 'demo');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const taskDirs = r.reads.filter((p) => p.endsWith(path.join('tasks', 'u-demo-b')));
    expect(taskDirs.length, 'the new session\'s plan directory was never read').toBeGreaterThan(0);
  });

  it('the name lane sees a workspace session that appeared between the ticks', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row('demo-w', 'demo', { workspace: 'slug', branch: 'ws/slug' });
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(r.stats.filter((p) => p.includes('u-demo-w')).length, 'the new session\'s transcript was never stat\'d').toBeGreaterThan(0);
  });

  it('the ask lane sees the hold switch raised between the ticks, and lowered again', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    const disabled = (): boolean => (r.w as unknown as { asksDisabled: boolean }).asksDisabled;
    expect(disabled()).toBe(false);
    r.marker(ASKS_DISABLED_MARKER);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(disabled(), 'a raised asks-disabled marker was not read').toBe(true);
    r.unmarker(ASKS_DISABLED_MARKER);
    r.at(LATER + 3_600_000, MONO_LATER + 3_600_000);
    await r.w.tick();
    await r.settle();
    expect(disabled(), 'a lowered asks-disabled marker was not read').toBe(false);
  });
});

describe('a mail switch raised after the tick\'s listing holds the mail lane', () => {
  it('a mail-disabled marker raised between the ticks stops the lane before it reads its queue; lowered, the lane goes on', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    const due = vi.spyOn(r.coord, 'dueDeliveries');
    r.marker(MAIL_DISABLED_MARKER);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length, 'a raised mail switch must stop the lane before it reads its queue').toBe(0);
    r.unmarker(MAIL_DISABLED_MARKER);
    r.at(LATER + 3_600_000, MONO_LATER + 3_600_000);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length, 'a lowered mail switch must let the lane read its queue').toBeGreaterThan(0);
  });
});

describe('an unlistable registry: the tick lists once and no lane lists at all', () => {
  it('a listing that fails ends the tick before any lane that lists runs', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    const failing: FleetIO = { ...localIO, readdir: async (p: string) => { if (p === r.cfg.registryDir) { r.listings.push(callerOf()); return null; } return localIO.readdir(p); } };
    (r.w as unknown as { deps: { io: FleetIO } }).deps.io = failing;
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(countBy(r.listings)).toEqual({ tick: 1 });
  });
});
