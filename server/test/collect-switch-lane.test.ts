// #166 wave 10 (path-identity spec 2026-10-12 §5.4, §5.5, §5.7): the collector switch, wired through the LANE. The
// executor's own final reads and its latch are `collect-switch-executor`'s and `collect-latch`'s; what is only provable
// HERE is what the pass and the port do:
// - the pass's own listing retires the latch (the hand transition), so an idle lane follows a removed marker within one
//   pass, and a marker re-created after it is ignored and warned once;
// - the connection epoch: a move between passes, or during the gather, clears every pair (a move during the gather also
//   ends the pass, with no latch), and an act job runs under the epoch it was queued under;
// - the flip on the effective boolean (a handoff writes no row and clears no pair; Off is one shadowed row), and the
//   warn latches, once per stuck state until a coherent resolution;
// - the counts the switch's view reads, null until the first population.
// FIXTURE HOME ONLY (`collectLaneFixture.ts`): ccd is a scripted model; the registry, coord.db and the generation journal
// are a fixture HOME's, and no case ticks after measuring a node.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  COLLECT_FEED_TITLE, COLLECT_LANE_LIVE_MARKER, COLLECT_SETTING_FEED_TITLE, collectLaneCounts, collectLatchFeedBody,
  collectSwitchFeedBody, measureCollectLaneRow,
} from '../src/collectLane.js';
import { COLLECT_LANE_JOURNAL_BASENAME } from '../src/coord/collectLaneJournal.js';
import { COLLECT_CAP } from '../src/ccdargv.js';
import { COLLECT_BOX_LABELS, type ChildReclaimCollectAttention } from '../../shared/api.js';
import { collectRig, type CollectRig } from './collectLaneFixture.js';
import { FULL_CAPS } from './collectTempRootFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

/** The fleet node a case's connection measured. */
const NODE = 'node-a';
/** The executor's actor, which the latch row names (path-identity spec 2026-10-12 §5.4). Spelled here: the executor
 *  keeps its constant module-private. */
const SWEEP_ACTOR = 'collect sweep';
/** A torn tail: the second record cut mid-write, which the strict grammar reads malformed (§5.2). */
const TORN = '{"generation":1}\n{"generation":';

/** The transition rows: the lane's `kind:'run'` switch rows, by Task 5's title. */
const switchRows = (f: CollectRig) => f.feed().filter((e) => e.title === COLLECT_FEED_TITLE.switch);
/** The latch rows: the `kind:'coord'` setting rows, by their own title. */
const latchRows = (f: CollectRig) => f.coord.feedEvents(500).filter((e) => e.title === COLLECT_SETTING_FEED_TITLE);
/** The stored latch, measured as the lane measures it. */
const latchOf = (f: CollectRig): number | null => {
  const m = measureCollectLaneRow(f.coord.collectLaneRow());
  if (m.kind !== 'seed' && m.kind !== 'row') throw new Error(`the switch's row reads ${m.kind}`);
  return m.row.markerRetiredAt;
};
/** Counts act jobs as each reaches its own audit (observation 2): an audit of the id the act slot is taken for. */
const actJobs = (f: CollectRig): { n: number } => {
  const seen = { n: 0 };
  f.onCall.push((c) => {
    const s = f.lane().slot;
    if (c.verb === 'audit' && s.kind === 'job' && s.id === c.id) seen.n += 1;
  });
  return seen;
};
/** The collector lane's warn lines that carry `words`. */
const warnedOf = (calls: readonly (readonly unknown[])[], words: string): string[] => calls.map((c) => String(c[0]))
  .filter((m) => m.startsWith('ccrc-server: sweepTempRootCollect: ') && m.includes(words));

/** A lane armed in Settings alone (path-identity spec 2026-10-12 §5.4): the first listing proves the marker absent and
 *  retires the latch (generation 1); Live is confirmed for the node this connection measured (generation 2); `ids` are
 *  witnessed, and the first act job flips the lane live by Settings, composing nothing. */
const settingsLive = async (ids: readonly string[]): Promise<CollectRig> => {
  const f = await collectRig();
  f.pastHoldOff();
  await f.pass(); await f.settled();
  expect(latchOf(f), 'the first listing retired the latch').not.toBeNull();
  f.knowNode(NODE);
  expect(f.setLive(NODE).kind, 'Settings Live for this node').toBe('written');
  expect(readFileSync(f.laneJournal.logPath, 'utf8'), 'the lane’s own journal, under the fixture HOME')
    .toBe('{"generation":1}\n{"generation":2}\n');
  for (const id of ids) f.witness(id);
  await f.passesUntil(() => f.lane().lastSeenLive);
  expect(switchRows(f).map((e) => e.body)).toEqual([
    collectSwitchFeedBody({ kind: 'live', armedBy: 'settings', notes: { latchDue: false, markerRecreated: false } })]);
  expect(f.collects(), 'the job that saw the flip composed nothing').toEqual([]);
  return f;
};

describe('the hand transition through the lane (path-identity spec §5.4)', () => {
  it('armed by the marker, Settings set live for this node, marker removed: the next act job writes no switch row, clears no pair, and acts', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();                     // step 1's build, armed by the legacy file before any pass
    f.knowNode(NODE);
    expect(f.setLive(NODE).kind, 'step 2: Settings Live for this node, beside the marker').toBe('written');
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();            // demo-a: observation 1 (the marker stands: no latch)
    expect(latchOf(f)).toBeNull();
    const rows = switchRows(f).length;
    const gen = f.lane().laneGen;
    f.disarm();                                             // step 3: the operator removes the file by hand
    const release = f.occupy('demo-a');                     // demo-a's act job, once queued, waits on its key
    f.next(); await f.pass();
    expect(latchOf(f), 'step 4: the pass’s own listing retired the latch, before the job ran').not.toBeNull();
    expect(latchRows(f)).toHaveLength(1);
    release(); await f.settled();
    expect(f.collects('demo-a'), 'it acts: still live, now by Settings').toHaveLength(1);
    expect(switchRows(f), 'a handoff that stays live writes no switch row').toHaveLength(rows);
    expect(f.lane().laneGen, 'and clears no pair').toBe(gen);
    expect(f.lane().lastSeenLive).toBe(true);
  });

  it("an idle lane retires a removed marker within one pass, with one kind:'coord' row and no act job", async () => {
    const f = await collectRig({ armed: true });
    await f.pass(); await f.settled();
    expect(latchOf(f), 'the marker stands: nothing to retire').toBeNull();
    f.disarm();
    const listed = f.registryListings();
    f.next(); await f.pass(); await f.settled();
    expect(latchOf(f), 'retired by the pass’s own listing').not.toBeNull();
    expect(f.registryListings() - listed, 'the gather alone listed the registry: no act job').toBe(1);
    expect(f.calls).toEqual([]);
    const rows = latchRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'coord', sessionId: '', runId: null, body: collectLatchFeedBody(SWEEP_ACTOR) });
    expect(f.laneJournal.logPath).toBe(path.join(f.cfg.ccrcDir, COLLECT_LANE_JOURNAL_BASENAME));
    expect(readFileSync(f.laneJournal.logPath, 'utf8'), 'one generation, journaled').toBe('{"generation":1}\n');
    f.next(); await f.pass(); await f.settled();
    expect(latchRows(f), 'once: a set latch is never retired again').toHaveLength(1);
  });

  it('a re-created marker after the latch stays ignored; one warn', async () => {
    const f = await collectRig();
    f.pastHoldOff();
    await f.pass(); await f.settled();                      // the first listing proves the marker absent: the latch retires
    expect(latchOf(f)).not.toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.touch(COLLECT_LANE_LIVE_MARKER);                       // any same-uid process can re-create the file
    for (const id of ['demo-a', 'demo-b', 'demo-c']) f.witness(id);
    const jobs = actJobs(f);
    await f.passesUntil(() => jobs.n >= 3);
    expect(f.lane().lastSeenLive, 'never live by the file again').toBe(false);
    expect(switchRows(f), 'no flip: shadowed throughout').toEqual([]);
    expect(f.collects()).toEqual([]);
    expect(f.wouldCollects('demo-a'), 'shadow still records').toHaveLength(1);
    expect(warnedOf(warn.mock.calls, 'legacy file was re-created'), 'one warn across three act jobs').toHaveLength(1);
    expect(readFileSync(f.laneJournal.logPath, 'utf8'), 'and nothing more was written').toBe('{"generation":1}\n');
  });
});

describe('the epoch (§5.5, R2, R37)', () => {
  it('an epoch move between passes clears every pair', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // demo-a: observation 1
    expect(f.lane().entries.get('demo-a')!.obs).not.toBeNull();
    const gen = f.lane().laneGen;
    f.bumpEpoch();                                          // a reconnect between two passes
    const listed = f.registryListings();
    f.next(); await f.pass(); await f.settled();
    expect(f.lane().laneGen, 'a lane-wide clear').toBeGreaterThan(gen);
    expect(f.registryListings() - listed, 'no act job: the pair it would spend was cleared').toBe(1);
    expect(f.audits('demo-a'), 'a fresh learning audit instead').toHaveLength(2);
    expect(f.wouldCollects('demo-a')).toEqual([]);
  });

  it('an epoch move during the gather clears every pair, and the pass ends without a latch', async () => {
    const f = await collectRig({ armed: true });
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // demo-a: observation 1; the marker stands, so no latch
    f.disarm();
    const gate = f.holdGather();
    const listed = f.registryListings();
    f.next();
    const held = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(2));
    f.bumpEpoch();                                          // a reconnect while the gather is out
    gate.release(); await held; await f.settled();
    expect(f.lane().entries.get('demo-a')!.obs, 'the pair is cleared').toBeNull();
    expect(latchOf(f), 'no latch from a listing that straddled two connections').toBeNull();
    expect(latchRows(f)).toEqual([]);
    expect(f.registryListings() - listed, 'the pass ended: no act job').toBe(1);
    expect(f.audits('demo-a'), 'nothing queued').toHaveLength(1);
    f.next(); await f.pass(); await f.settled();            // CONTROL: the next pass, on one epoch, retires it
    expect(latchOf(f)).not.toBeNull();
  });

  it('an epoch bump between the pass that queues the act and the job’s start composes no ws-collect', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();                      // live by the legacy file: the node plays no part
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();            // demo-a: observation 1
    const release = f.occupy('demo-a');                     // the act job, once queued, waits on its key
    f.next(); await f.pass();
    expect(f.lane().slot).toMatchObject({ kind: 'job', id: 'demo-a' });
    f.bumpEpoch();                                          // a reconnect after the queueing, before the job starts
    release(); await f.settled();
    expect(f.audits('demo-a'), 'the job ran to its own audit').toHaveLength(2);
    expect(f.collects(), 'nothing composed: the job runs under the epoch it was queued under').toEqual([]);
  });

  it('CONTROL: the same held job with no bump composes its ws-collect', async () => {
    const f = await collectRig();
    f.pastHoldOff(); await f.goLive();
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();
    const release = f.occupy('demo-a');
    f.next(); await f.pass();
    expect(f.lane().slot).toMatchObject({ kind: 'job', id: 'demo-a' });
    release(); await f.settled();
    expect(f.collects('demo-a')).toHaveLength(1);
  });
});

describe('flips and warn latches (§5.5)', () => {
  it('Settings live to Off is one shadowed row naming neither, and the pairs clear', async () => {
    const f = await settingsLive(['demo-a']);
    expect(f.setOff().kind, 'Off, after the latch').toBe('written');
    const gen = f.lane().laneGen;
    await f.passesUntil(() => !f.lane().lastSeenLive);
    const shadowed = switchRows(f).filter((e) => e.body.startsWith('the collector lane is now shadowed'));
    expect(shadowed.map((e) => e.body)).toEqual([
      collectSwitchFeedBody({ kind: 'shadowed', why: 'off', notes: { latchDue: false, markerRecreated: false } })]);
    expect(f.lane().laneGen, 'the flip cleared every pair').toBeGreaterThan(gen);
    expect(f.lane().entries.get('demo-a')!.obs, 'and the job that saw it observed nothing').toBeNull();
    expect(f.collects()).toEqual([]);
  });

  it('a truncated journal is one safety-stopped row, then exactly one warn across three passes', async () => {
    const f = await settingsLive(['demo-a', 'demo-b', 'demo-c']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const jobs = actJobs(f);
    writeFileSync(f.laneJournal.logPath, TORN);             // a torn tail: the journal is malformed
    await f.passesUntil(() => !f.lane().lastSeenLive);
    const at = jobs.n;
    const passes = await f.passesUntil(() => jobs.n >= at + 3);
    expect(passes, 'three act jobs read it, over at least three passes').toBeGreaterThanOrEqual(3);
    expect(switchRows(f).filter((e) => e.body === collectSwitchFeedBody({ kind: 'safety-stopped', why: 'journal-malformed' })),
      'one row: the flip').toHaveLength(1);
    expect(warnedOf(warn.mock.calls, 'safety-stopped (journal-malformed)'), 'one warn, however many jobs read it')
      .toHaveLength(1);
    expect(f.collects()).toEqual([]);
  });

  it('a coherent resolution re-arms the warn', async () => {
    const f = await settingsLive(['demo-a', 'demo-b', 'demo-c']);
    const good = readFileSync(f.laneJournal.logPath, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(f.laneJournal.logPath, TORN);
    await f.passesUntil(() => !f.lane().lastSeenLive);
    expect(warnedOf(warn.mock.calls, 'safety-stopped (journal-malformed)')).toHaveLength(1);
    writeFileSync(f.laneJournal.logPath, good);             // the same bytes back: coherent again
    await f.passesUntil(() => f.lane().lastSeenLive);       // a coherent resolution: live by Settings, and the latches clear
    writeFileSync(f.laneJournal.logPath, TORN);
    await f.passesUntil(() => !f.lane().lastSeenLive);
    expect(warnedOf(warn.mock.calls, 'safety-stopped (journal-malformed)'), 'warned again after the coherent read')
      .toHaveLength(2);
    expect(f.collects()).toEqual([]);
  });

  it('a latch the store cannot retire warns once per outcome while passes retry, a coherent resolution keeps it, and a retire clears it', async () => {
    // The coordinator's extension of the warn-latch ruling (2026-10-12): a stuck latch keeps Off refused, so it is said
    // once per outcome, never silent and never on every pass. The act jobs resolve the seed coherently (Off, shadowed)
    // all the while.
    const f = await collectRig();
    f.pastHoldOff();
    for (const id of ['demo-a', 'demo-b']) f.witness(id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = vi.spyOn(f.coord, 'setCollectLane').mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' });
    });
    const jobs = actJobs(f);
    await f.passesUntil(() => jobs.n >= 2);
    expect(store.mock.calls.length, 'the retire was retried').toBeGreaterThanOrEqual(2);
    expect(latchOf(f), 'nothing was written').toBeNull();
    expect(warnedOf(warn.mock.calls, 'threw before its append'), 'one warn, across passes and coherent resolutions')
      .toHaveLength(1);
    store.mockImplementation(() => ({ kind: 'failed', phase: 'append', code: 'ENOSPC' }));
    const at = jobs.n;
    await f.passesUntil(() => jobs.n >= at + 2);
    expect(warnedOf(warn.mock.calls, 'failed at append'), 'its own key, warned once').toHaveLength(1);
    store.mockRestore();
    f.next(); await f.pass(); await f.settled();
    expect(latchOf(f), 'the store answers again: the pass retired the latch').not.toBeNull();
    expect(latchRows(f)).toHaveLength(1);
    const warned = (f.watcher as unknown as { collectControlWarned: Set<string> }).collectControlWarned;
    expect([...warned].filter((k) => k.startsWith('latch-')), 'a retire clears the latch keys').toEqual([]);
    expect(f.collects()).toEqual([]);
  });
});

describe('the counts accessor (§5.7)', () => {
  it('null before the first population', async () => {
    const f = await collectRig();
    expect(f.watcher.currentCollectCounts()).toBeNull();
    f.fleetState.ccdVerbs = FULL_CAPS.filter((v) => v !== COLLECT_CAP);
    await f.pass();                                         // stopped at the capability gate: no population
    expect(f.watcher.currentCollectCounts()).toBeNull();
    f.fleetState.ccdVerbs = [...FULL_CAPS];
    f.next(); await f.pass(); await f.settled();
    expect(f.watcher.currentCollectCounts()).toEqual({ wouldCollect: 0, held: 0, boxLines: 0 });
  });

  it('matches collectLaneCounts over the lane’s memory', async () => {
    const f = await collectRig();
    f.pastHoldOff(); f.witness('demo-a');
    await f.pass(); await f.settled();                      // demo-a: observation 1
    f.next(); await f.pass(); await f.settled();            // its act job, shadowed: would collect
    expect(f.wouldCollects('demo-a')).toHaveLength(1);
    f.breakQuarantine();
    f.next(); await f.pass(); await f.settled();            // the record listing unmeasured: one box line
    const counts = f.watcher.currentCollectCounts();
    expect(counts).toEqual({ wouldCollect: 1, held: 0, boxLines: 1 });
    const input = (f.watcher as unknown as { collectAttentionInput(): Parameters<typeof collectLaneCounts>[0] })
      .collectAttentionInput();
    expect(counts, 'the accessor reads the published items’ own input').toEqual(collectLaneCounts(input));
    const items = await f.attention();
    const box = f.boxWide(items);
    const perId = items.filter((a): a is ChildReclaimCollectAttention => a.kind === 'collect').filter((a) => !box.includes(a));
    expect(counts, 'and agrees with what the frame lists').toEqual({
      wouldCollect: perId.filter((a) => a.word === 'would-collect').length,
      held: perId.filter((a) => a.word === 'held').length,
      boxLines: box.filter((a) => a.sessionId !== COLLECT_BOX_LABELS.unvouched).length,
    });
  });
});
