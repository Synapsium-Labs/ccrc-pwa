// CCR-15 wave 10 (path-identity spec 2026-10-12 §5.5, §5.9): the executor's FINAL RE-READ. After the job's last await
// (the registry listing at step 5), with nothing awaited before the argv, the executor does four things:
//   - it retires the marker's latch through its one helper;
//   - it measures both capabilities;
//   - it reads the Settings row, its generation journal and the node the current connection measured;
//   - it resolves the switch through L1's `collectLaneEffective`.
// Each case changes the world inside that last await (`hooks.listing(2)`) or inside observation 2 (`hooks.audit`). Every
// case but the controls composes no `ws-collect`. The parts:
//   - a REAL store, a REAL journal adapter under a fixture HOME and a REAL identity cell;
//   - a scripted ccd behind the real whitelist;
//   - the lane's memory faked (`collectTempRootFixture.ts`);
//   - in the last describe, the real watcher (`collectLaneFixture.ts`).
// FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import {
  COLLECT_FEED_TITLE, COLLECT_SETTING_FEED_TITLE, collectLatchFeedBody, measureCollectLaneRow, type CollectLaneNotes,
} from '../src/collectLane.js';
import { COLLECT_LANE_JOURNAL_MAX_BYTES } from '../src/coord/collectLaneJournal.js';
import { collectLaneCaps, collectTempRoot, type CollectLanePort } from '../src/coord/collectTempRoot.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import type { CoordStore } from '../src/coord/store.js';
import type { FleetNodeMeasured } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import { FULL_CAPS, ID, TOK, WALL0, rig, type Rig } from './collectTempRootFixture.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';

const AUDIT = ['ws-audit', '--session', ID, '--collect'];
const ACT = ['ws-collect', '--expect', TOK, '--session', ID, '--surface', 'agent', '--actor', 'collect sweep'];
const NODE = '6f0c2a4e-1b7d-4c3a-9e5f-0a1b2c3d4e5f';
const OTHER = '7a1d3b5f-2c8e-4d4b-8f60-1b2c3d4e5f60';
/** The journal of a coherent state at generation 2. */
const JOURNAL_2 = '{"generation":1}\n{"generation":2}\n';
const NOTES: CollectLaneNotes = { latchDue: false, markerRecreated: false };
const known = (nodeId: string): FleetNodeMeasured => ({ kind: 'known', nodeId, measuredAt: WALL0 });
const without = (cap: string): string[] => FULL_CAPS.filter((c) => c !== cap);
/** Settings stores exactly `live` for NODE, coherent at generation 2 (the journal's two records and the row's own). The
 *  latch is SET unless `latched` is false. NODE is measured on the current connection unless `measured` is false. */
const settingsLive = (r: Rig, o: { readonly latched?: boolean; readonly measured?: boolean } = {}): void => {
  r.setRow({ choice: 'live', fleetNodeId: NODE, markerRetiredAt: o.latched === false ? null : WALL0, generation: 2,
    updatedAt: WALL0 });
  r.setJournal(JOURNAL_2);
  if (o.measured !== false) r.setNode(known(NODE));
};

describe('step 6: the switch resolved after the last await (path-identity spec §5.5)', () => {
  it('CONTROL: Settings live for the node measured on this connection, coherent, its latch set, no marker: the act is composed', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r);
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'acted', result: { kind: 'collected' } });
    expect(r.attempts).toEqual([AUDIT, ACT]);
    expect(r.lane.seen.map((s) => s.kind)).toEqual(['live']);
    expect(r.lane.flips).toEqual([]);
  });

  it('Settings live changed to off during the last await flips, and composes nothing', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r);
    let wrote = '';
    r.hooks.listing = (n) => { if (n === 2) wrote = r.coord.setCollectLane({ kind: 'off' }, WALL0 + 1, r.journal).kind; };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(wrote, 'the Off was written').toBe('written');
    expect(r.lane.flips).toEqual([false]);
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'shadowed', why: 'off' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a journal appended during the last await is safety-stopped: a flip from live, no argv either way', async () => {
    for (const lastSeenLive of [true, false]) {
      const r = rig({ live: false, lastSeenLive });
      settingsLive(r);
      r.hooks.listing = (n) => { if (n === 2) r.setJournal(`${JOURNAL_2}{"generation":3}\n`); };
      expect(await collectTempRoot(r.deps, r.job()), `last seen live: ${String(lastSeenLive)}`)
        .toMatchObject({ kind: 'answered', step: 5, why: lastSeenLive ? 'switch-flip' : 'safety-stopped' });
      expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'safety-stopped', why: 'generation-mismatch' });
      expect(r.lane.flips).toEqual(lastSeenLive ? [false] : []);
      expect(r.attempts).toEqual([AUDIT]);
    }
  });

  it('the node becoming another node is shadowed; no argv', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r);
    r.hooks.listing = (n) => { if (n === 2) r.setNode(known(OTHER)); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'shadowed', why: 'other-node' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it("an epoch bump during the last await is epoch-changed: clears ['epoch'], no flip, no row, no argv", async () => {
    const r = rig();                                        // the legacy marker stands, its latch unset: live by the marker
    r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'epoch-changed' });
    expect(r.lane.clears).toEqual(['epoch']);
    expect(r.lane.seen, 'the lane was never asked to compare: no flip, no row').toEqual([]);
    expect(r.latches).toEqual([]);
    expect(r.journal.read(), 'no generation consumed').toEqual({ kind: 'missing' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('an epoch bump during observation 2, with the marker standing and the latch null, is epoch-changed: no argv', async () => {
    const r = rig();
    r.hooks.audit = () => { r.bumpEpoch(); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'epoch-changed' });
    expect(r.lane.clears).toEqual(['epoch']);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a job queued under an earlier epoch than the one at its start is epoch-changed: no argv', async () => {
    const r = rig();
    const queued = r.job();
    r.bumpEpoch();                                          // a reconnect between the pass that queued it and its start
    expect(await collectTempRoot(r.deps, queued)).toMatchObject({ kind: 'answered', step: 5, why: 'epoch-changed' });
    expect(r.attempts).toEqual([AUDIT]);
    const fresh = rig();
    fresh.bumpEpoch();
    expect(await collectTempRoot(fresh.deps, fresh.job()), 'CONTROL: queued under the epoch it starts under, it acts')
      .toMatchObject({ kind: 'acted' });
  });

  // The latch's own epoch guard is the helper's (`collect-latch.test.ts`); these pin the PAIR the executor hands it. The
  // marker is absent beside the untouched seed and its latch is null, so only the epoch keeps the latch from being due:
  // a listing that straddled a reconnect, or followed one since the job was queued, proves nothing about the box now
  // connected, and must not consume a generation or retire the marker on the old connection's evidence.
  it.each(['last listing', 'observation 2', 'queued earlier'] as const)(
    'an epoch move with the marker absent retires nothing: the latch is fed the job’s own pair (path-identity spec 2026-10-12 §5.5): %s',
    async (move) => {
      const r = rig({ live: false });                       // the marker absent beside the seed: due but for the epoch
      const queued = r.job();
      if (move === 'last listing') r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); };
      if (move === 'observation 2') r.hooks.audit = () => { r.bumpEpoch(); };
      if (move === 'queued earlier') r.bumpEpoch();
      expect(await collectTempRoot(r.deps, queued)).toMatchObject({ kind: 'answered', step: 5, why: 'epoch-changed' });
      expect(r.writes, 'the writer was never asked').toEqual([]);
      expect(r.latches, 'no latch row').toEqual([]);
      expect(r.journal.read(), 'no generation consumed').toEqual({ kind: 'missing' });
      expect(r.attempts).toEqual([AUDIT]);
    },
  );

  it('an epoch bump with a raised pause reports the pause: the resolver asks the pause first, and nothing is composed', async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) { r.raise(RECLAIM_PAUSE_MARKER); r.bumpEpoch(); } };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'paused' });
    expect(r.lane.clears).toEqual(['paused']);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it("a stored live with the node unmeasured is unknown-fleet: clears ['node'], no flip, no row", async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r, { measured: false });
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'unknown-fleet' });
    expect(r.lane.clears).toEqual(['node']);
    expect(r.lane.seen, 'never compared, though the lane last saw it live: no flip, no row').toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it("reclaim-pause-v1 withdrawn during the last await is answered(6, 'caps') and clears ['caps']", async () => {
    const r = rig();
    r.hooks.listing = (n) => { if (n === 2) r.state.ccdVerbs = without(RECLAIM_PAUSE_CAP); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 6, why: 'caps' });
    expect(r.lane.clears).toEqual(['caps']);
    expect(r.lane.flips).toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each<[string, (r: Rig) => void, 'shadowed' | 'safety-stopped']>([
    ['Off', (r) => { r.coord.setCollectLane({ kind: 'off' }, WALL0 + 1, r.journal); }, 'shadowed'],
    ['a mismatch', (r) => { r.setRow({ generation: 5 }); }, 'safety-stopped'],
    ['an unreadable journal', (r) => { r.setJournal('x'.repeat(COLLECT_LANE_JOURNAL_MAX_BYTES + 1)); }, 'safety-stopped'],
    ['a node change', (r) => { r.setNode(known(OTHER)); }, 'shadowed'],
  ])('Off, a mismatch, an unreadable journal or a node change during observation 2 composes nothing: %s', async (_what, change, kind) => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r);
    r.hooks.audit = () => { change(r); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.seen.at(-1)?.kind).toBe(kind);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('every control and identity read happens after the last listing', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r);
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'acted' });
    const switchReads = r.reads.filter((e) => /^(?:row|journal|node)@/.test(e));
    expect(switchReads.length, 'the row, the journal and the node were read').toBeGreaterThanOrEqual(3);
    expect(switchReads.filter((e) => !e.endsWith('@2')), 'a control or identity read before the last listing returned')
      .toEqual([]);
    expect(r.reads.filter((e) => e.startsWith('epoch@')), 'the epoch, read before the last listing and again after it')
      .toEqual(['epoch@1', 'epoch@2']);
  });

  it('the marker absent with seed or coherent state retires the latch once, then re-reads', async () => {
    for (const start of ['seed', 'coherent'] as const) {
      const r = rig({ live: false });
      if (start === 'coherent') { r.setRow({ generation: 2, updatedAt: WALL0 }); r.setJournal(JOURNAL_2); }
      expect(await collectTempRoot(r.deps, r.job()), start).toMatchObject({ kind: 'would-collect' });
      expect(r.writes.map((w) => w.kind), start).toEqual(['retire']);
      expect(r.latches, start).toEqual([collectLatchFeedBody('collect sweep')]);
      expect(r.journal.read(), start).toMatchObject({ kind: 'ok', max: start === 'seed' ? 1 : 3 });
      // The store reads its own row inside its transaction without the order log's wrapper, so a `row@2` logged after
      // the retire is the executor's read again.
      expect(r.reads.lastIndexOf('row@2'), `${start}: the row read again after the retire`)
        .toBeGreaterThan(r.reads.indexOf('retire@2'));
    }
  });

  it('a refused retire whose re-read shows a mismatch composes nothing', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r, { latched: false });
    r.hooks.retire = () => { r.setRow({ generation: 5 }); };   // another writer, between the latch's read and its write
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.writes.map((w) => w.kind)).toEqual(['retire']);
    expect(r.latches, 'refused: no latch row').toEqual([]);
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'safety-stopped', why: 'generation-mismatch' });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a pre-latch database snapshot beside the later journal, the marker standing, is safety-stopped: the marker arms nothing', async () => {
    const r = rig();                                        // the marker stands, and the lane last saw it live
    // path-identity spec 2026-10-12 §5.3: the latch's retirement was journaled as generation 1. The restored row is the
    // untouched seed again, its latch null, beside that journal, and the marker was re-created by hand.
    r.setJournal('{"generation":1}\n');
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'safety-stopped', why: 'generation-mismatch' });
    expect(r.writes, 'nothing is retired or repaired').toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('a mismatch with the marker absent never calls retire', async () => {
    const r = rig({ live: false });
    r.setRow({ generation: 5, updatedAt: WALL0 });
    r.setJournal(JOURNAL_2);
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'safety-stopped' });
    expect(r.writes, 'the latch never heals a mismatch').toEqual([]);
    expect(measureCollectLaneRow(r.coord.collectLaneRow()))
      .toMatchObject({ kind: 'row', row: { generation: 5, markerRetiredAt: null } });
    expect(r.attempts).toEqual([AUDIT]);
  });

  it.each<[string, (r: Rig) => void, 'other-node' | 'future-choice']>([
    ['Live stored for another node', (r) => { settingsLive(r, { measured: false }); r.setNode(known(OTHER)); }, 'other-node'],
    ['a choice this build does not know', (r) => { settingsLive(r); r.setRow({ choice: 'LIVE' }); }, 'future-choice'],
  ])('shadowed with no flip reaches the per-id checks and stops at would-collect, never the argv: %s', async (_what, plant, why) => {
    const r = rig({ live: false, lastSeenLive: false });     // the lane last saw shadow, so this resolution is no flip
    plant(r);
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'would-collect' });
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'shadowed', why });
    expect(r.lane.flips).toEqual([]);
    expect(r.attempts).toEqual([AUDIT]);
  });

  it('handoff: marker absent, Settings live for this node, last-seen live: latch retires, no flip, the act is composed', async () => {
    const r = rig({ live: false, lastSeenLive: true });
    settingsLive(r, { latched: false });
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'acted' });
    expect(r.latches).toEqual([collectLatchFeedBody('collect sweep')]);
    expect(r.lane.flips, 'the source changed, the boolean did not').toEqual([]);
    expect(r.lane.seen.at(-1)).toMatchObject({ kind: 'live', armedBy: 'settings' });
    expect(r.attempts).toEqual([AUDIT, ACT]);
  });
});

describe('collectLaneCaps: both capabilities for the route and the view, refusing on no evidence (path-identity spec §5.6)', () => {
  const stateOf = (ccdVerbs: string[] | null): FleetState =>
    ({ connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs });

  it.each<[string, string[] | null, { collect: boolean; reclaimPause: boolean }]>([
    ['both advertised', [...FULL_CAPS], { collect: true, reclaimPause: true }],
    ['no reclaim-pause-v1', without(RECLAIM_PAUSE_CAP), { collect: true, reclaimPause: false }],
    ['no collect-v1', without(COLLECT_CAP), { collect: false, reclaimPause: true }],
    ['no caps list at all', null, { collect: false, reclaimPause: false }],
  ])('%s', (_what, verbs, want) => {
    expect(collectLaneCaps(stateOf(verbs))).toEqual(want);
  });

  it('no fleet state reads both absent', () => {
    expect(collectLaneCaps(undefined)).toEqual({ collect: false, reclaimPause: false });
  });
});

describe('through the lane: the watcher’s port, its control and the latch row (path-identity spec §5.4, §5.5)', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const switchRows = (f: CollectRig, prefix: string) =>
    f.feed().filter((e) => e.title === COLLECT_FEED_TITLE.switch && e.body.startsWith(prefix));
  const portOf = (f: CollectRig, id: string): CollectLanePort =>
    (f.watcher as unknown as { collectPortFor(coord: CoordStore, id: string): CollectLanePort }).collectPortFor(f.coord, id);

  it('a lane that sees the marker gone retires the latch: one kind:coord row, no session, no run, the setting title and the lane’s actor; then one shadowed flip', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a');
    await f.passesUntil(() => f.lane().lastSeenLive);
    f.disarm();
    await f.passesUntil(() => !f.lane().lastSeenLive);
    const setting = f.coord.feedEvents(500).filter((e) => e.title === COLLECT_SETTING_FEED_TITLE)
      .map((e) => ({ kind: e.kind, sessionId: e.sessionId, runId: e.runId, body: e.body }));
    expect(setting).toEqual([{ kind: 'coord', sessionId: '', runId: null, body: collectLatchFeedBody('collect sweep') }]);
    expect(f.journal.read(), 'one generation, journaled').toMatchObject({ kind: 'ok', max: 1 });
    expect(measureCollectLaneRow(f.coord.collectLaneRow())).toMatchObject({ kind: 'row', row: { choice: 'off', generation: 1 } });
    expect(switchRows(f, 'the collector lane is now shadowed')).toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });

  it('the port flips on the effective boolean, never its source: a handoff writes no row and clears no pair', async () => {
    const f = await collectRig();
    const port = portOf(f, 'demo-a');
    expect(port.flipped({ kind: 'live', armedBy: 'legacy-marker', notes: NOTES }), 'shadowed to live: a flip').toBe(true);
    const gen = f.lane().laneGen;
    expect(port.flipped({ kind: 'live', armedBy: 'both', notes: NOTES }), 'the source changed, the boolean did not').toBe(false);
    expect(port.flipped({ kind: 'live', armedBy: 'settings', notes: NOTES })).toBe(false);
    expect(f.lane().laneGen, 'no pair cleared').toBe(gen);
    expect(switchRows(f, 'the collector lane is now live')).toHaveLength(1);
    expect(port.flipped({ kind: 'safety-stopped', why: 'generation-mismatch' }), 'live to safety-stopped: a flip').toBe(true);
    expect(f.lane().lastSeenLive).toBe(false);
  });
});
