// The fixture the registry-listing suites share (D-5864; ARCH-51 #786): a watcher on a fixture home whose fake
// `FleetIO` counts every `readdir` of the registry directory and tags it by the method that asked, read off the call
// stack, so a suite can drive a steady `tick` (every throttle elapsed) and read the listings per caller.
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

export const NOW = 1_785_300_000_000;
export const LATER = NOW + 3_600_000;
export const MONO0 = 5_000;
export const MONO_LATER = MONO0 + 3_600_000;

/** The watcher method (one of the registry-listing callers) the current call stack runs under, else `other`. */
const CALLERS = ['readLimits', 'tick', 'tasksPass', 'namesPass', 'prPass', 'divergencesPass', 'mailPass', 'askPass', 'sweepHookStates', 'detectDialogs'] as const;
export function callerOf(): string {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(2)) {
    const hit = CALLERS.find((c) => new RegExp(`\\.${c} \\(|\\b${c} \\(`).test(line));
    if (hit !== undefined) return hit;
  }
  return 'other';
}

export function rig() {
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
export type Rig = ReturnType<typeof rig>;

/** Prime the watcher (the first tick) and settle; a following tick is a steady one. */
export async function primed(r: Rig): Promise<void> {
  r.at(NOW, MONO0);
  await r.w.tick();
  await r.settle();
  r.listings.length = 0; r.reads.length = 0; r.stats.length = 0;
}
export const countBy = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
};

