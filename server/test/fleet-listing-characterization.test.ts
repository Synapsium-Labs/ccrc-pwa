// Characterization (D-5864; ARCH-51 #786; spec K13's listing half): what a steady `FleetWatcher.tick` lists, and what
// each lane that takes its own listing today sees of a registry that changes BETWEEN two ticks. Green on the code
// before the tick's one `FleetReadModel`. A fake `FleetIO` counts every `readdir(registryDir)` and tags it by the
// method that asked (read off the call stack), with every throttle elapsed: the second tick, a long time after the
// first, on both the wall and the monotonic clock. Fixture homes only; no ccd, tmux or box is reached.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ASKS_DISABLED_MARKER, MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;
const LATER = NOW + 3_600_000;
const MONO0 = 5_000;
const MONO_LATER = MONO0 + 3_600_000;

afterEach(() => { vi.restoreAllMocks(); });

/** The watcher method (one of the registry-listing callers) the current call stack runs under, else `other`. */
const CALLERS = ['readLimits', 'tick', 'tasksPass', 'namesPass', 'prPass', 'divergencesPass', 'mailPass', 'askPass', 'sweepHookStates', 'detectDialogs'] as const;
function callerOf(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(2)) {
    const hit = CALLERS.find((c) => new RegExp(`\\.${c} \\(|\\b${c} \\(`).test(line));
    if (hit !== undefined) return hit;
  }
  return 'other';
}

function rig() {
  const home = mkTmp('ccrc-fleet-listing-');
  const projectsRoot = mkTmp('ccrc-fleet-listing-docs-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'fixture-token\n');
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const listings: string[] = [];
  const reads: string[] = [];
  const stats: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => { if (p === cfg.registryDir) { listings.push(callerOf()); } else reads.push(p); return localIO.readdir(p); },
    stat: async (p: string) => { stats.push(p); return localIO.stat(p); },
  };
  const t = { mono: MONO0 };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher({ ...testDeps(home), cfg, io, coord, monotonicMs: () => t.mono } as never, new Bus(), 10_000);
  const reg = cfg.registryDir;
  const row = (id: string, project: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const marker = (name: string): void => writeFileSync(path.join(reg, name), '');
  const unmarker = (name: string): void => rmSync(path.join(reg, name), { force: true });
  const at = (wall: number, mono: number): void => { vi.spyOn(Date, 'now').mockReturnValue(wall); t.mono = mono; };
  /** Let the fire-and-forget lanes of a tick settle. */
  const settle = async (): Promise<void> => { for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 5)); };
  return { home, cfg, coord, w, listings, reads, stats, row, marker, unmarker, at, settle };
}
type Rig = ReturnType<typeof rig>;

/** Prime the watcher (the first tick) and settle; a following tick is a steady one. */
async function primed(r: Rig): Promise<void> {
  r.at(NOW, MONO0);
  await r.w.tick();
  await r.settle();
  r.listings.length = 0; r.reads.length = 0; r.stats.length = 0;
}
const countBy = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};

describe('a steady tick, every throttle elapsed: the registry listings by caller (the base table)', () => {
  it('lists once for the tick, once for the limits read in its assembly, once each for tasks, names, PR, divergences and asks, and twice for the mail lane', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const by = countBy(r.listings);
    // The dialog detector and the hook-state lane take the tick's own `records` and `names`; they never list. `limits` is
    // `readLimits`' marker listing inside `assembleFleet` (the plan counted eight by static reading and missed it).
    expect({ tick: by.tick, limits: by.readLimits, tasks: by.tasksPass, names: by.namesPass, pr: by.prPass, divergences: by.divergencesPass, ask: by.askPass })
      .toEqual({ tick: 1, limits: 1, tasks: 1, names: 1, pr: 1, divergences: 1, ask: 1 });
    expect(by.mailPass, 'the mail lane lists for its switch read and again for its recipients').toBe(2);
    expect(r.listings.length, 'the steady tick lists nine times in all').toBe(9);
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
