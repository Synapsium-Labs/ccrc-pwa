// The usage sidecar lane (routing slice 0, Task 4). Same `FleetWatcher.tick()`
// fixture idiom `dialog.test.ts`'s "FleetWatcher dialog detection" describe
// uses for its own sweep lanes. Also closes Task 3's review pointer (its
// ledger, deferred minor): `readUsage`'s positive arm was unpinned in
// `usage-sidecar.test.ts` — the first test below plants a real sidecar and
// observes the reading through the whole path (`readUsageMeasured` inside
// `sweepUsage` inside `tick()`), end to end.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { usageSidecarPath } from '../src/usage.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const seedSession = (home: string, id: string, wrapper: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const writeUsage = (home: string, id: string, over: Record<string, unknown> = {}): void => {
  const p = usageSidecarPath(path.join(home, '.cc-sessions'), id);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({
    ts: Math.floor(Date.now() / 1000) - 5, model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25, ...over,
  }));
};

/** A quiet pane: alive, nothing to capture — the same idiom `fleet.test.ts`'s
 *  `ctxPct` describe block uses, so this fixture exercises only the sweep
 *  lanes, never the dialog/pane-capture ones. */
const idleRun: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

const makeWatcher = (home: string, io: FleetIO): FleetWatcher => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const deps = { cfg, runCcd: ccdRunner(idleRun, cfg), tmux: new Tmux(idleRun), io, queue: new KeyedQueue() };
  return new FleetWatcher(deps, new Bus());
};

/** Counts `readFileMeasured` calls under the usage sidecar's own subdirectory
 *  only — `tick()`'s other lanes (hook state, task, PR) read their own files
 *  every tick, so a total call count would rise regardless of whether
 *  `sweepUsage` itself read anything this sweep. */
function countingUsageIO(): { io: FleetIO; usageReadCount: () => number } {
  let n = 0;
  const io: FleetIO = {
    ...localIO,
    readFileMeasured: async (p, t, s) => {
      if (p.includes(`${path.sep}usage${path.sep}`)) n += 1;
      return localIO.readFileMeasured(p, t, s);
    },
  };
  return { io, usageReadCount: () => n };
}

describe('FleetWatcher usage sweep lane (routing slice 0)', () => {
  it('reads a fresh sidecar on the first tick, end to end through readUsage inside sweepUsage', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-usage-a', 'claude');
    writeUsage(home, 'demo-usage-a');
    const watcher = makeWatcher(home, localIO);

    await watcher.tick();

    const usage = watcher.currentUsage().get('demo-usage-a');
    expect(usage).toEqual({
      ts: expect.any(Number), model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 12, cost: 1.25, stale: false,
    });
  });

  it('a second tick inside USAGE_SWEEP_MS reads no sidecar again — the lane is throttled to its own clock', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-usage-b', 'claude');
    writeUsage(home, 'demo-usage-b');
    const { io, usageReadCount } = countingUsageIO();
    const watcher = makeWatcher(home, io);

    await watcher.tick();
    const afterFirst = usageReadCount();
    expect(afterFirst).toBeGreaterThan(0);

    await watcher.tick();
    expect(usageReadCount()).toBe(afterFirst);
  });

  it('an UNREADABLE read this sweep keeps the previous reading rather than dropping the row', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'demo-usage-c', 'claude');
    writeUsage(home, 'demo-usage-c', { model: 'claude-sonnet-5' });
    let degrade = false;
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => (
        degrade && p.includes(`${path.sep}usage${path.sep}`)
          ? { ok: false, reason: 'unreadable' }
          : localIO.readFileMeasured(p, t, s)
      ),
    };
    const watcher = makeWatcher(home, io);

    await watcher.tick();
    const first = watcher.currentUsage().get('demo-usage-c');
    expect(first?.model).toBe('claude-sonnet-5');

    // Force the next tick past the lane's own throttle (USAGE_SWEEP_MS) —
    // the same private-field poke `dialog.test.ts` avoids needing by calling
    // `sweepHookStates()` directly, not available to us here since the
    // throttle itself is what this test is exercising.
    (watcher as unknown as { lastUsageSweep: number }).lastUsageSweep = 0;
    degrade = true;
    await watcher.tick();

    expect(watcher.currentUsage().get('demo-usage-c')).toEqual(first);
  });
});
