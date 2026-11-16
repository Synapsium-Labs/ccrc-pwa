import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { watcherTeardown } from './watcherTeardown.js';

// D-6179: `tick()` never awaits three of the writers it fires — the server-caps beat, the inventory run, and the
// dispatch run that run ends in — and each writes under `<ccrcDir>`. A teardown that removes the home while one is
// still in flight loses the race under load: the write lands mid-removal (`ENOTEMPTY`) or after it, recreating the
// directory. Each case here HOLDS one writer behind a gate, so the race is decided by the test, not by the clock.

/** A gate one writer's lane passes through: closed, it holds every call until `release`; once released it stays
 *  open. `drain` resolves once every call that went through it has landed. */
const gates = vi.hoisted(() => {
  const mk = () => {
    let open = false;
    let held = 0;
    const waiters: Array<() => void> = [];
    const calls: Array<Promise<unknown>> = [];
    return {
      get held(): number { return held; },
      pass<T>(fn: () => Promise<T>): Promise<T> {
        const p = (async () => {
          if (!open) { held += 1; await new Promise<void>((r) => { waiters.push(r); }); }
          return fn();
        })();
        calls.push(p.catch(() => undefined));
        return p;
      },
      release(): void { open = true; for (const w of waiters.splice(0)) w(); },
      async drain(): Promise<void> { while (calls.length > 0) await Promise.all(calls.splice(0)); },
      reset(): void { open = false; held = 0; },
    };
  };
  return { caps: mk(), intent: mk(), dispatch: mk() };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const writeFile: typeof real.writeFile = (file, ...rest) => {
    const name = path.basename(String(file));
    if (name.startsWith('.server-caps.')) return gates.caps.pass(() => real.writeFile(file, ...rest));
    if (name.startsWith('.update-intent.')) return gates.intent.pass(() => real.writeFile(file, ...rest));
    return real.writeFile(file, ...rest);
  };
  return { ...real, default: { ...real, writeFile }, writeFile };
});

vi.mock('../src/update/converge.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/update/converge.js')>();
  return { ...real, runDispatch: (...a: Parameters<typeof real.runDispatch>) => gates.dispatch.pass(() => real.runDispatch(...a)) };
});

type Gate = typeof gates.caps;

/** Run a teardown while `gate` holds a write, then release it and let everything land. While the write is held, the
 *  teardown must neither finish nor remove the home; once it finishes, the home must be gone and stay gone. */
async function tearDownWhileHeld(gate: Gate, home: string, teardown: () => Promise<void>) {
  let finished = false;
  const done = teardown().then(() => { finished = true; });
  await vi.waitFor(() => { expect(gate.held).toBeGreaterThan(0); });   // non-vacuous: a write really is in flight
  await new Promise((r) => setTimeout(r, 300));
  const whileHeld = { finished, homeExists: existsSync(home) };
  gate.release();
  await done;
  for (const g of [gates.caps, gates.intent, gates.dispatch]) { g.release(); await g.drain(); }
  return { whileHeld, homeExistsAfter: existsSync(home) };
}

describe('watcherTeardown (D-6179)', () => {
  afterEach(async () => {
    for (const g of [gates.caps, gates.intent, gates.dispatch]) { g.release(); await g.drain(); g.reset(); }
  });

  it("a bare watcher's in-flight server-caps write lands before the home is removed", async () => {
    gates.intent.release(); gates.dispatch.release();
    const home = mkTmp('ccrc-');
    const t = watcherTeardown();
    const watcher = t.track(new FleetWatcher(testDeps(home), new Bus()));
    await watcher.tick();
    expect(await tearDownWhileHeld(gates.caps, home, () => t.remove(home)))
      .toEqual({ whileHeld: { finished: false, homeExists: true }, homeExistsAfter: false });
  });

  it("an app-backed watcher's in-flight inventory projection lands before the home is removed", async () => {
    gates.caps.release(); gates.dispatch.release();
    const home = mkTmp('ccrc-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    const t = watcherTeardown();
    const watcher = t.track(new FleetWatcher(deps, bus));
    const app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    try {
      expect(await tearDownWhileHeld(gates.intent, home, () => t.remove(home, app)))
        .toEqual({ whileHeld: { finished: false, homeExists: true }, homeExistsAfter: false });
    } finally {
      coord.db.close();
    }
  });

  it('the dispatch run an inventory run ends in lands before the home is removed', async () => {
    gates.caps.release(); gates.intent.release();
    const home = mkTmp('ccrc-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    const t = watcherTeardown();
    const watcher = t.track(new FleetWatcher(deps, bus));
    const app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    try {
      expect(await tearDownWhileHeld(gates.dispatch, home, () => t.remove(home, app)))
        .toEqual({ whileHeld: { finished: false, homeExists: true }, homeExistsAfter: false });
    } finally {
      coord.db.close();
    }
  });

  it('a dispatch run that starts while the teardown is already waiting is awaited too', async () => {
    // Only the inventory run is in flight when the teardown begins; its tail starts the dispatch run later. A settle
    // that took one snapshot of what was in flight would miss it.
    gates.caps.release();
    const home = mkTmp('ccrc-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    const t = watcherTeardown();
    const watcher = t.track(new FleetWatcher(deps, bus));
    const app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    await vi.waitFor(() => { expect(gates.intent.held).toBeGreaterThan(0); });
    expect(gates.dispatch.held).toBe(0);
    try {
      expect(await tearDownWhileHeld(gates.dispatch, home, async () => {
        const done = t.remove(home, app);
        gates.intent.release();
        await done;
      })).toEqual({ whileHeld: { finished: false, homeExists: true }, homeExistsAfter: false });
    } finally {
      coord.db.close();
    }
  });
});
