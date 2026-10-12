// Child-reclamation wave 8: the kept-leaf item at the lane (spec §5.6, §5.9). Only the lane can show
// these: the item reaches the coord frame for a child that the registry no longer lists, on every pass
// (paused and capability-less passes included). It survives its own read's failure without failing the
// pass shut. A failed fail-shut read publishes nothing. A restart rebuilds the item, and the feed
// records it once per row per process. The rig is the shared `laneFixture`, with this file's feed log,
// its executor stub and its kept-leaf moments; this file builds no FleetWatcher of its own.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoordStore } from '../src/coord/store.js';
import { ACTOR_FLAGS_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { G1, laneFixture } from './childReclaimGenerationFixture.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const GONE = 'demo-gone';
const CCD_LINE = `temp root /h/.cc-tmp/${GONE} kept (in-use): pid 7 holds it`;

/** Every request answers reclaimed: these cases read only WHICH child was asked. */
const reclaimed = async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> =>
  ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });

/** The shared rig with a feed log. `cap: false` is a fleet that does not advertise the reclaim capability.
 *  `coord`, `home` and `notifyLog` from an earlier rig make a restart over the same coord.db; the rig's
 *  module-wide uid counter keeps its journal lines new. */
const fixture = async (o: { cap?: boolean; coord?: CoordStore; home?: string; notifyLog?: NotifyLog } = {}) => {
  const home = o.home ?? mkTmp('ccrc-cr-leaf-lane-');
  let notifyLog = o.notifyLog;
  if (notifyLog === undefined) {
    notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
  }
  const f = laneFixture({ home, coord: o.coord, notifyLog, exec: reclaimed,
    ccdVerbs: o.cap === false ? ['ws-audit', 'ws-reclaim', 'ws-release', RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP] : undefined });
  /** A reclaim ccd COMPLETED, keeping the temp root: ccd purged the row, so the registry lists nothing for it. */
  const reclaimedKeepingTmp = (): void => f.journal(GONE, 'reclaim', 'done',
    { verb: 'ws-reclaim', meas: { childOf: '41', tmpRootKept: 'in-use' }, detail: CCD_LINE });
  /** The frame at the clock the last pass stamped, so `tick()`'s own sweep dispatch is throttled. */
  const attention = async () => { await f.watcher.tick(); return f.watcher.currentCoord()?.childReclaimAttention; };
  const fed = () => f.coord.feedEvents(50).filter((e) => e.title === CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE);
  return { ...f, home, notifyLog, reclaimedKeepingTmp, attention, fed };
};

describe('the kept-leaf item at the lane', () => {
  it('lists a reclaimed child that no listing names, from the mirror, and feeds it ONCE', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    const at = f.now();
    await f.pass();
    const items = await f.attention();
    expect(items).toEqual([{ kind: 'leaf-kept', sessionId: GONE, runId: 41, at,
      sentence: expect.stringContaining(`its temp root ~/.cc-tmp/${GONE} (in-use: `) }]);
    f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.fed()).toHaveLength(1);
    expect(f.fed()[0]).toMatchObject({ kind: 'run', sessionId: GONE, runId: 41 });
    const sentence = (items![0] as { sentence: string }).sentence;
    expect(f.fed()[0]!.body).toBe(`${GONE}, child of run #41: ${sentence} ccd recorded: ${CCD_LINE}`);
  });

  it('is listed on a paused pass and on a capability-less pass: it is derived before both early returns', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    await f.pass();
    expect(await f.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
    const g = await fixture({ cap: false });
    g.reclaimedKeepingTmp();
    await g.pass();
    expect(await g.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
  });

  it('a failed kept-leaf read keeps the last items and fails nothing shut: the live child is still asked', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    f.finishedChild('demo-a', G1);
    await f.pass();                                                   // the item listed; demo-a sighted once
    const before = await f.attention();
    expect(before).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE })]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(f.coord, 'lifecycleReclaimRowsSince').mockImplementation(() => { throw new Error('mirror busy'); });
    f.next(); await f.pass();
    expect(f.requests.map((r) => r.sessionId), 'a failed display read failed the pass shut').toEqual(['demo-a']);
    expect(await f.attention()).toEqual(before);
    expect(warn.mock.calls.map((c) => String(c[0])))
      .toContainEqual(expect.stringContaining('could not read the kept leaves (mirror busy)'));
  });

  it('a failed fail-shut read publishes nothing and never asks for the kept leaves', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    const before = await f.attention();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(f.coord, 'childReclaimSessionIds').mockImplementation(() => { throw new Error('mirror unreadable'); });
    const leaf = vi.spyOn(f.coord, 'lifecycleReclaimRowsSince');
    f.next(); await f.pass();
    expect(leaf).not.toHaveBeenCalled();
    expect(await f.attention()).toEqual(before);
  });

  it('a restart lists it on its first pass, and writes exactly one more row', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    expect(f.fed()).toHaveLength(1);
    const g = await fixture({ coord: f.coord, home: f.home, notifyLog: f.notifyLog });
    await g.pass();
    expect(await g.attention()).toEqual([expect.objectContaining({ kind: 'leaf-kept', sessionId: GONE, runId: 41 })]);
    expect(g.fed()).toHaveLength(2);
    g.next(); await g.pass();
    expect(g.fed(), 'one process fed one row twice').toHaveLength(2);
  });

  it('a later placed create of the id ends it, and the feed keeps the record', async () => {
    const f = await fixture();
    f.reclaimedKeepingTmp();
    await f.pass();
    f.next();
    f.journal(GONE, 'create', 'done', { verb: 'ws-add' });
    await f.pass();
    expect(await f.attention()).toEqual([]);
    expect(f.fed()).toHaveLength(1);
  });
});
