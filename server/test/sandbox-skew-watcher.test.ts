// The skew notice through the watcher (Overlord W1 sandbox PR B; review 3346 F8): `sweepLaunchProfile`'s real wiring, not the
// lane's stubs. The body's liveness is read from the watcher's fleet (`currentFleet`, through `skewRunningOf`), both builds from
// the node inventory (`inventoryBuilds`, a tag else a short sha), the once-only mark through `CoordStore.hasNotice`, and the
// raise through `pushOne` with the key as its `dedupeKey`, so a second pass and a restarted watcher raise nothing more. The
// inventory and the fleet are stubbed reads; the designation, the feed and the watcher are real. Fixture HOMEs only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { OverlordAuthorityJournal } from '../src/coord/overlordAuthorityJournal.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { NotifyLog } from '../src/notifylog.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const OV = 'lane-a-overlord';
const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
const D = 'a'.repeat(64);
const KEY = `${OV}:v0.9.1:v0.9.2`;
const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: 1 } }) } as unknown as OverlordAuthorityJournal;
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));

afterEach(removeTmpFixtures);

const node = (role: 'server' | 'fleet', version: string | null, sha: string) => ({
  role, stampRead: 'ok', currentSha: sha, currentRef: 'main', currentBuiltAt: '2026-11-22T00:00:00Z', currentDirty: false, currentVersion: version,
});

/** A designated Overlord over a fixture HOME, and a way to run one launch-profile pass on a fresh or the same watcher. */
async function world(over: { presence?: string; pending?: boolean } = {}) {
  const home = mkTmp('ccrc-skew-watch-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  expect(coord.designatePending(journal, { sessionId: OV, deadlineAt: 9e12, model: 'opus', accountPools: { pools: [], untagged: true },
    actor: OPERATOR, at: 1000, opKey: 'designate-skew' }).ok).toBe(true);
  expect(coord.bindPendingGeneration(OV, GEN, 1100).ok).toBe(true);
  if (over.pending !== true) expect(coord.goLive(journal, OV, GEN, 1200).ok).toBe(true);
  vi.spyOn(coord, 'nodes').mockReturnValue([node('server', 'v0.9.2', 'b'.repeat(40)), node('fleet', 'v0.9.1', 'c'.repeat(40))] as never);
  const base = testDeps(home);
  // The feed's ring, so a raise archives its row in coord.db (`notice.ts`): the watcher's real record path.
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  // A session record's shape as the watcher reads it: since the coordinator advisor (#3275) the lane's rows carry the
  // wrapper, read through `unmeasured`.
  const rows = [{ id: OV, child: { kind: 'none' }, route: { fields: { profile: 'overlord', profiledigest: D }, degraded: null, inert: [], unreadable: [] },
    wrapper: 'lane-a', unmeasured: [] }];
  const watchers: FleetWatcher[] = [];
  const pass = async (w?: FleetWatcher): Promise<FleetWatcher> => {
    const x = w ?? new FleetWatcher({ ...base, cfg, coord, notifyLog } as never, new Bus(), 10_000);
    if (w === undefined) watchers.push(x);
    vi.spyOn(x, 'currentFleet').mockReturnValue([{ id: OV, presence: over.presence ?? 'dead' }] as never);
    await x.sweepLaunchProfile(rows as never);
    return x;
  };
  const feedRows = () => (coord.db.prepare("SELECT COUNT(*) AS n FROM feed_events WHERE kind = 'coord' AND sessionId = ?").get(OV) as { n: number }).n;
  const close = async () => { for (const w of watchers) await quietWatcher(w); coord.db.close(); };
  return { coord, pass, feedRows, close };
}

describe('the skew notice through the watcher (review 3346 F8)', { timeout: 90_000 }, () => {
  it('a dead designated body under skew records one keyed notice, and neither a second pass nor a restarted watcher adds one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await world();
    try {
      expect(w.coord.hasNotice('coord', OV, KEY)).toBe(false);
      const first = await w.pass();
      expect(w.coord.hasNotice('coord', OV, KEY), 'the raise keys its row with the key the read asks').toBe(true);
      expect(w.feedRows()).toBe(1);
      await w.pass(first);
      expect(w.feedRows()).toBe(1);
      await w.pass();
      expect(w.feedRows(), 'a restarted watcher reads the mark back from the feed').toBe(1);
    } finally { warn.mockRestore(); await w.close(); }
  });

  it('negative controls: a running body and a pending attempt record nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const over of [{ presence: 'alive' }, { pending: true }]) {
      const w = await world(over);
      try {
        await w.pass();
        expect(w.feedRows(), JSON.stringify(over)).toBe(0);
        expect(w.coord.hasNotice('coord', OV, KEY)).toBe(false);
      } finally { await w.close(); }
    }
    warn.mockRestore();
  });
});
