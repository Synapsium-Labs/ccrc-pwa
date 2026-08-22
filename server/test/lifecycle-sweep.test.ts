// The sweep rides the EXISTING tick. Two properties, and the second is the one
// a reviewer cannot hold in place: no new timer, and `sweepMail` untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetWatcher, LC_SWEEP_MS } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  LC_ACT_UNKNOWN, LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LIFECYCLE_ACTS,
} from '../../shared/api.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const G1 = '1755780000000000000';
const NOW = 1_785_300_000_000;

// `mail-sweep.test.ts:239-245`'s shipped idiom, verbatim: only `Date` is faked,
// so `fs` and the microtask queue behave. A `vi.setSystemTime` with no
// `useFakeTimers` throws `Timers are not mocked`.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

const rig = () => {
  const home = mkTmp('ccrc-lcsweep-');
  const deps = testDeps(home);
  const dir = path.join(deps.cfg.registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher(
    { ...deps, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never,
    new Bus(),
  );
  return { w, dir, coord };
};

const aLine = (uid: string): string =>
  `${JSON.stringify({ uid, at: 1, act: AN_ACT, outcome: 'done', id: 'demo' })}\n`;

describe('FleetWatcher.sweepLifecycle', () => {
  it('ingests the journal on the existing tick', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
  });

  it('is GATED — a second call inside LC_SWEEP_MS does no io', async () => {
    const r = rig();
    await r.w.sweepLifecycle();                       // the FIRST sweep always runs
    fs.writeFileSync(path.join(r.dir, genFile(G1)), aLine('a.1'));
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }), 'the gate did not hold').toEqual([]);
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleFor({ limit: 10 }).map((e) => e.uid)).toEqual(['a.1']);
  });

  it('answers a health block once it has swept, and null with no coordination database', async () => {
    const r = rig();
    await r.w.sweepLifecycle();
    expect(r.w.lifecycleHealth()?.state).toBe('ok');
    const bare = new FleetWatcher(testDeps(mkTmp('ccrc-lcsweep-')), new Bus());
    expect(bare.lifecycleHealth()).toBeNull();
  });

  it('builds the mirror ONCE — its in-memory record must survive the tick', async () => {
    // A mirror re-minted per tick forgets everything it holds between sweeps:
    // the recorded-once gap names first of all, so a standing condition would
    // produce a gap row every five seconds forever.
    const r = rig();
    fs.writeFileSync(path.join(r.dir, `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`), aLine('x.1'));
    await r.w.sweepLifecycle();
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    expect(r.coord.lifecycleGaps(10), 'the mirror was re-minted between ticks').toHaveLength(1);
  });
});

describe('the tick itself', () => {
  const src = fs.readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');

  it('adds NO new timer — the sweep rides the tick that already exists', () => {
    // `start()` is the one place a timer is created in this class (`:484`). A
    // second setInterval/setTimeout would be a second clock nothing stops on
    // close.
    expect(src.match(/setInterval\(/g) ?? []).toHaveLength(1);
    expect(src).not.toContain('lifecycleTimer');
  });

  it('dispatches the sweep from tick(), never awaited', () => {
    expect(src).toContain('void this.sweepLifecycle().catch(');
  });

  it('leaves sweepMail byte-identical — D9 ships a parity test INSTEAD of a refactor', () => {
    // The most load-bearing loop on the box. Wave 4 adds a producer beside it,
    // never inside it. The slice ends on the method's OWN closing brace —
    // `\n  }\n` at two-space indent — rather than on the next member, so it
    // cannot silently widen to four hundred unrelated lines.
    const from = src.indexOf('  async sweepMail(');
    expect(from, 'sweepMail was not found — this assertion would pass vacuously').toBeGreaterThan(-1);
    const to = src.indexOf('\n  }\n', from);
    expect(to, 'sweepMail has no two-space closing brace').toBeGreaterThan(from);
    const body = src.slice(from, to);
    expect(body.length).toBeGreaterThan(2000);
    expect(body).not.toContain('lifecycle');
    expect(body).not.toContain('Lifecycle');
  });
});
