// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.6, §5.7): the one view composer. It never folds two
// read states into one, maps every resolver arm to the state the Settings section shows, passes the notice through,
// and composes a bounded remedy that names no path but the marker file's. The marker is imported from its definer.
import { describe, it, expect } from 'vitest';
import {
  COLLECT_LANE_APPLIES_TEXT, COLLECT_LANE_LIVE_MARKER, collectLaneView,
  type CollectCurrentNode, type CollectLaneRowRaw, type CollectLaneViewInput,
} from '../src/collectLane.js';
import type { CollectLaneView } from '../../shared/api.js';

type RowRead = CollectLaneViewInput['row'];
type JournalRead = CollectLaneViewInput['journal'];
type State = CollectLaneView['effective']['state'];

const NODE = 'node-a';
const MEASURED_AT = 1_760_000_000_000;
const SEED_RAW: CollectLaneRowRaw = { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };
const row = (o: Partial<CollectLaneRowRaw> = {}): RowRead => ({ kind: 'row', row: { ...SEED_RAW, ...o } });
const OK1: JournalRead = { kind: 'ok', max: 1, records: 1 };
const OK2: JournalRead = { kind: 'ok', max: 2, records: 2 };
const liveFor = (nodeId: string): RowRead => row({ choice: 'live', fleetNodeId: nodeId, generation: 1n, updatedAt: 5n });
const known = (connectionEpoch: number = 3): CollectCurrentNode => ({ kind: 'known', connectionEpoch, nodeId: NODE, measuredAt: MEASURED_AT });
const LIVE_HERE: Partial<CollectLaneViewInput> = { row: liveFor(NODE), journal: OK1 };
const LATCHED: Partial<CollectLaneViewInput> = { row: row({ markerRetiredAt: 9n, generation: 1n, updatedAt: 9n }), journal: OK1 };
const base = (o: Partial<CollectLaneViewInput> = {}): CollectLaneViewInput => ({
  row: row(), journal: { kind: 'missing' }, switches: { paused: false, marker: false }, epoch: { before: 3, after: 3 },
  node: known(), caps: { collect: true, reclaimPause: true }, counts: null, notice: null, ...o,
});
const view = (o: Partial<CollectLaneViewInput> = {}): CollectLaneView => collectLaneView(base(o));

const NOT_LIVE: [string, Partial<CollectLaneViewInput>, State][] = [
  ['a raised pause', { switches: { paused: true, why: 'raised', marker: true } }, 'paused'],
  ['an unlistable registry', { switches: { paused: true, why: 'unlistable' } }, 'unknown-fleet'],
  ['an epoch moved during the listing', { epoch: { before: 3, after: 4 }, node: known(4) }, 'unknown-fleet'],
  ['a stored Live with the node unmeasured', { ...LIVE_HERE, node: { kind: 'unmeasured', connectionEpoch: 3 } }, 'unknown-fleet'],
  ['a missing capability', { caps: { collect: true, reclaimPause: false } }, 'not-running'],
  ['a journal ahead of the row', { ...LIVE_HERE, journal: OK2 }, 'safety-stopped'],
  ['a malformed row beside a standing marker', { row: row({ generation: '0' }), switches: { paused: false, marker: true } }, 'safety-stopped'],
  ['Settings Live for another node', { row: liveFor('node-b'), journal: OK1 }, 'shadowed'],
  ['Off with no marker', {}, 'shadowed'],
];
const LIVE: [string, Partial<CollectLaneViewInput>, State][] = [
  ['the seed with the marker standing', { switches: { paused: false, marker: true } }, 'live'],
  ['Settings Live for this node', LIVE_HERE, 'live'],
];

describe('the view never folds two read states into one (§5.6)', () => {
  it('stored row, malformed and unreadable are three answers; the view\'s input type admits no absent row', () => {
    expect(view().stored).toEqual({ read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 });
    expect(view({ row: row({ choice: 'shadowed', generation: 1n, updatedAt: 1n }), journal: OK1 }).stored,
      'the raw stored token, a future one included').toMatchObject({ read: 'row', choice: 'shadowed' });
    expect(view({ row: row({ generation: '0' }) }).stored).toEqual({ read: 'malformed' });
    const unreadable = view({ row: { kind: 'unreadable', detail: 'fixture-home/.ccrc/coord.db: database is locked' } });
    expect(unreadable.stored).toEqual({ read: 'unreadable' });
    expect(JSON.stringify(unreadable), 'the driver detail never reaches the wire').not.toMatch(/coord\.db|database is locked/);
    // @ts-expect-error R38: the route answers 503 state-unmeasurable for an absent row; no view is composed for it
    const absent: RowRead = { kind: 'absent' };
    expect(absent.kind).toBe('absent');
  });

  it('journal ok, missing, malformed, unreadable and not-regular are five', () => {
    const cases: [JournalRead, CollectLaneView['journal']][] = [
      [{ kind: 'ok', max: 2, records: 2 }, { read: 'ok', max: 2 }],
      [{ kind: 'missing' }, { read: 'missing' }],
      [{ kind: 'malformed', fault: 'order', record: 2 }, { read: 'malformed' }],
      [{ kind: 'unreadable', code: 'EACCES' }, { read: 'unreadable' }],
      [{ kind: 'not-regular', fileKind: 'directory' }, { read: 'not-regular' }],
    ];
    for (const [j, want] of cases) expect(view({ journal: j }).journal, j.kind).toEqual(want);
    expect(JSON.stringify(view({ journal: { kind: 'unreadable', code: 'EACCES' } })), 'no errno on the wire').not.toContain('EACCES');
    // @ts-expect-error not-configured is the lane's word for a server built without the journal; the route answers 501
    const notConfigured: JournalRead = { kind: 'not-configured' };
    expect(notConfigured.kind).toBe('not-configured');
  });

  it('control coherent, mismatch ahead and behind, and unmeasurable', () => {
    expect(view().control, 'the seed with no journal is the bootstrap').toEqual({ state: 'coherent', bootstrap: true });
    expect(view(LIVE_HERE).control).toEqual({ state: 'coherent', bootstrap: false });
    expect(view({ row: liveFor(NODE), journal: OK2 }).control).toEqual({ state: 'mismatch', journal: 'ahead' });
    expect(view({ row: row({ choice: 'live', fleetNodeId: NODE, generation: 2n, updatedAt: 5n }), journal: OK1 }).control)
      .toEqual({ state: 'mismatch', journal: 'behind' });
    expect(view({ row: row({ generation: 1n, updatedAt: 1n }) }).control, 'a used row with no journal').toEqual({ state: 'unmeasurable' });
  });

  it.each([...NOT_LIVE, ...LIVE])('each resolver arm maps to its state: %s', (_name, o, want) => {
    expect(view(o).effective.state).toBe(want);
  });

  it('armedBy is neither unless live', () => {
    expect(view({ switches: { paused: false, marker: true } }).effective).toEqual({ state: 'live', armedBy: 'legacy-marker' });
    expect(view(LIVE_HERE).effective).toEqual({ state: 'live', armedBy: 'settings' });
    expect(view({ ...LIVE_HERE, switches: { paused: false, marker: true } }).effective).toEqual({ state: 'live', armedBy: 'both' });
    for (const [name, o] of NOT_LIVE) expect(view(o).effective.armedBy, name).toBe('neither');
  });

  it('marker listing and latch are three-valued', () => {
    expect(view().marker).toEqual({ listing: 'absent', latch: 'unset' });
    expect(view({ switches: { paused: false, marker: true } }).marker).toEqual({ listing: 'stands', latch: 'unset' });
    expect(view({ switches: { paused: true, why: 'raised', marker: true } }).marker).toEqual({ listing: 'stands', latch: 'unset' });
    expect(view({ switches: { paused: true, why: 'unlistable' } }).marker).toEqual({ listing: 'unmeasured', latch: 'unset' });
    expect(view(LATCHED).marker).toEqual({ listing: 'absent', latch: 'set' });
    expect(view({ row: row({ generation: '0' }) }).marker.latch, 'a malformed row').toBe('unmeasured');
    expect(view({ journal: { kind: 'unreadable', code: 'EIO' } }).marker.latch, 'a latch no journal vouches for').toBe('unmeasured');
  });

  it('node known with stored this, other, none or unread; unmeasured and collision', () => {
    expect(view(LIVE_HERE).node).toEqual({ state: 'known', nodeId: NODE, measuredAt: MEASURED_AT, stored: 'this' });
    expect(view({ row: liveFor('node-b'), journal: OK1 }).node).toEqual({ state: 'known', nodeId: NODE, measuredAt: MEASURED_AT, stored: 'other' });
    expect(view().node).toEqual({ state: 'known', nodeId: NODE, measuredAt: MEASURED_AT, stored: 'none' });
    expect(view({ row: { kind: 'unreadable', detail: 'locked' } }).node).toEqual({ state: 'known', nodeId: NODE, measuredAt: MEASURED_AT, stored: 'unread' });
    expect(view({ ...LIVE_HERE, node: { kind: 'unmeasured', connectionEpoch: 3 } }).node).toEqual({ state: 'unmeasured', stored: 'set' });
    expect(view({ node: { kind: 'unmeasured', connectionEpoch: 3 } }).node).toEqual({ state: 'unmeasured', stored: 'none' });
    expect(view({ node: { kind: 'collision', connectionEpoch: 3 } }).node).toEqual({ state: 'collision', stored: 'none' });
    expect(view({ row: row({ generation: '0' }), node: { kind: 'collision', connectionEpoch: 3 } }).node)
      .toEqual({ state: 'collision', stored: 'unread' });
    expect(view({ node: known(2) }).node, 'a node measured on an earlier connection is not this connection\'s')
      .toEqual({ state: 'unmeasured', stored: 'none' });
  });

  const REMEDIED: [string, Partial<CollectLaneViewInput>][] = [
    ['an unreadable row', { row: { kind: 'unreadable', detail: 'fixture-home/.ccrc/coord.db: database is locked' } }],
    ['a malformed row', { row: row({ generation: '0' }) }],
    ['a missing journal beside a used row', { row: row({ generation: 1n, updatedAt: 1n }) }],
    ['a malformed journal', { journal: { kind: 'malformed', fault: 'json', record: 1 } }],
    ['an unreadable journal', { journal: { kind: 'unreadable', code: 'EACCES' } }],
    ['a journal that is not a regular file', { journal: { kind: 'not-regular', fileKind: 'symlink' } }],
    ['a mismatch before the latch', { ...LIVE_HERE, journal: OK2 }],
    ['a mismatch after the latch', { ...LATCHED, journal: OK2 }],
    ['a re-created marker', { ...LATCHED, switches: { paused: false, marker: true } }],
    ['a missing capability', { caps: { collect: false, reclaimPause: true } }],
  ];

  it.each(REMEDIED)('the remedy is bounded and names no path but the marker file\'s: %s', (_name, o) => {
    const remedy = view(o).remedy;
    expect(remedy).not.toBeNull();
    expect((remedy ?? '').length).toBeGreaterThan(0);
    expect((remedy ?? '').length).toBeLessThanOrEqual(240);
    expect(remedy).not.toMatch(/\/|\.log\b|\.ccrc|coord\.db|EACCES|database is locked/);
  });

  it('only the re-created marker\'s remedy names the marker file, and a healthy lane has none', () => {
    expect(view({ ...LATCHED, switches: { paused: false, marker: true } }).remedy).toContain(COLLECT_LANE_LIVE_MARKER);
    for (const [name, o] of REMEDIED.filter(([n]) => n !== 'a re-created marker')) {
      expect(view(o).remedy, name).not.toContain(COLLECT_LANE_LIVE_MARKER);
    }
    expect(view({ ...LIVE_HERE, journal: OK2 }).remedy, 'Off cannot repair before the latch')
      .not.toBe(view({ ...LATCHED, journal: OK2 }).remedy);
    expect(view().remedy).toBeNull();
    expect(view(LIVE_HERE).remedy).toBeNull();
    expect(view({ switches: { paused: false, marker: true } }).remedy, 'a standing marker before the latch is the Off note\'s to say').toBeNull();
    expect(view({ switches: { paused: true, why: 'raised', marker: false } }).remedy, 'the pause is deliberate').toBeNull();
  });

  it('notice passes through', () => {
    expect(view().notice).toBeNull();
    expect(view({ notice: COLLECT_LANE_APPLIES_TEXT }).notice).toBe(COLLECT_LANE_APPLIES_TEXT);
  });

  it('caps and the counts pass through, and null counts stay null', () => {
    expect(view({ caps: { collect: false, reclaimPause: true } }).caps).toEqual({ collect: false, reclaimPause: true });
    expect(view().attention).toBeNull();
    expect(view({ counts: { wouldCollect: 2, held: 1, boxLines: 3 } }).attention).toEqual({ wouldCollect: 2, held: 1, boxLines: 3 });
  });
});
