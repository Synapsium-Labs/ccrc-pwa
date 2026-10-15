// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2, §5.4, §5.5): what arms the temp-root collector's
// deletion. `collectLaneEffective` (L1) resolves Figure 5 from measured inputs only: the registry listing, the
// connection epoch around it, both capabilities, the control state and the current connection's node. The control
// fixtures are built through the file's own row measure and coherence rule (`measureCollectLaneRow`,
// `collectLaneControl`), so every row here exercises the real exact-equality proof, never a hand-made shortcut.
// Pure: no file, row, clock or link is read.
import { describe, it, expect } from 'vitest';
import {
  collectLaneControl, collectLaneEffective, collectLaneLive, collectLatchDue, measureCollectLaneRow,
  type CollectCurrentNode, type CollectEpochPair, type CollectLaneCaps, type CollectLaneControl,
  type CollectLaneEffective, type CollectLaneInputs, type CollectLaneJournalRead, type CollectLaneNotes,
  type CollectLaneRowRaw, type CollectLaneSwitches, type CollectLaneUnmeasurable,
} from '../src/collectLane.js';

const EPOCH = 7;
const SAME: CollectEpochPair = { before: EPOCH, after: EPOCH };
const MOVED: CollectEpochPair = { before: EPOCH, after: EPOCH + 1 };
const CAPS: CollectLaneCaps = { collect: true, reclaimPause: true };
const STANDS: CollectLaneSwitches = { paused: false, marker: true };
const ABSENT: CollectLaneSwitches = { paused: false, marker: false };
const RAISED: CollectLaneSwitches = { paused: true, why: 'raised', marker: true };
const UNLISTABLE: CollectLaneSwitches = { paused: true, why: 'unlistable' };

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const KNOWN_A: CollectCurrentNode = { kind: 'known', connectionEpoch: EPOCH, nodeId: NODE_A, measuredAt: 1_000 };
const KNOWN_B: CollectCurrentNode = { kind: 'known', connectionEpoch: EPOCH, nodeId: NODE_B, measuredAt: 1_000 };
const KNOWN_A_EARLIER: CollectCurrentNode = { kind: 'known', connectionEpoch: EPOCH - 1, nodeId: NODE_A, measuredAt: 900 };
const KNOWN_A_LATER: CollectCurrentNode = { kind: 'known', connectionEpoch: EPOCH + 1, nodeId: NODE_A, measuredAt: 1_100 };
const UNMEASURED: CollectCurrentNode = { kind: 'unmeasured', connectionEpoch: EPOCH };
const COLLISION: CollectCurrentNode = { kind: 'collision', connectionEpoch: EPOCH };

/** The migration's exact seed, as the store reads it (bigints, `setReadBigInts`). */
const SEED_RAW: CollectLaneRowRaw = { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };
const MISSING: CollectLaneJournalRead = { kind: 'missing' };
const J = (max: number): CollectLaneJournalRead => ({ kind: 'ok', max, records: max });
const control = (row: Partial<CollectLaneRowRaw>, journal: CollectLaneJournalRead): CollectLaneControl =>
  collectLaneControl(measureCollectLaneRow({ kind: 'row', row: { ...SEED_RAW, ...row } }), journal);

const SEED = control({}, MISSING);
const OFF = control({ generation: 3n, updatedAt: 900n }, J(3));
const OFF_LATCHED = control({ markerRetiredAt: 800n, generation: 4n, updatedAt: 900n }, J(4));
const LIVE_A = control({ choice: 'live', fleetNodeId: NODE_A, generation: 3n, updatedAt: 900n }, J(3));
const LIVE_A_LATCHED = control({ choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: 800n, generation: 4n,
  updatedAt: 900n }, J(4));
/** The named regression {journal:4,row:5}, and its mirror {journal:5,row:4}: both are mismatches, never coherent. */
const BEHIND = control({ choice: 'live', fleetNodeId: NODE_A, generation: 5n, updatedAt: 900n }, J(4));
const AHEAD = control({ choice: 'live', fleetNodeId: NODE_A, generation: 4n, updatedAt: 900n }, J(5));
const USED = { generation: 4n, updatedAt: 900n } as const;
/** Total by type: a new unmeasurable state is a compile error here until it has a row (typecheck-tests). */
const UNMEASURABLE: Readonly<Record<CollectLaneUnmeasurable, CollectLaneControl>> = {
  'row-absent': collectLaneControl(measureCollectLaneRow({ kind: 'absent' }), J(4)),
  'row-unreadable': collectLaneControl(measureCollectLaneRow({ kind: 'unreadable', detail: 'SQLITE_IOERR' }), J(4)),
  'row-malformed': control({ ...USED, choice: 1 }, J(4)),
  'journal-missing': control(USED, MISSING),
  'journal-malformed': control(USED, { kind: 'malformed', fault: 'order', record: 3 }),
  'journal-unreadable': control(USED, { kind: 'unreadable', code: 'EACCES' }),
  'journal-not-regular': control(USED, { kind: 'not-regular', fileKind: 'symlink' }),
  'journal-not-configured': control({}, { kind: 'not-configured' }),
};

const inputs = (over: Partial<CollectLaneInputs>): CollectLaneInputs =>
  ({ switches: ABSENT, epoch: SAME, caps: CAPS, control: LIVE_A_LATCHED, node: KNOWN_A, ...over });
const notes = (latchDue: boolean, markerRecreated: boolean): CollectLaneNotes => ({ latchDue, markerRecreated });
const N = notes(false, false);
type Case = readonly [CollectLaneInputs, CollectLaneEffective];

const FIGURE_5: readonly (readonly [string, readonly Case[]])[] = [
  ['a raised pause beats a coherent Settings live for the same node and a standing marker', [
    [inputs({ switches: RAISED, control: LIVE_A, node: KNOWN_A }), { kind: 'stopped', why: 'raised' }],
    [inputs({ switches: RAISED, control: LIVE_A, epoch: MOVED, caps: { collect: false, reclaimPause: false } }),
      { kind: 'stopped', why: 'raised' }],
  ]],
  ['an unlistable registry stops', [
    [inputs({ switches: UNLISTABLE, control: LIVE_A }), { kind: 'stopped', why: 'unlistable' }],
    [inputs({ switches: UNLISTABLE, control: SEED, epoch: MOVED }), { kind: 'stopped', why: 'unlistable' }],
  ]],
  ['an epoch move stops, with a marker', [
    [inputs({ switches: STANDS, epoch: MOVED, control: SEED, node: UNMEASURED }), { kind: 'stopped', why: 'epoch-changed' }],
    [inputs({ switches: STANDS, epoch: MOVED, control: LIVE_A, node: KNOWN_A_LATER }), { kind: 'stopped', why: 'epoch-changed' }],
    [inputs({ switches: STANDS, epoch: MOVED, control: LIVE_A, caps: { collect: false, reclaimPause: true } }),
      { kind: 'stopped', why: 'epoch-changed' }],
  ]],
  ['either missing capability is not-running', [
    [inputs({ switches: STANDS, control: LIVE_A, caps: { collect: false, reclaimPause: true } }), { kind: 'not-running' }],
    [inputs({ switches: STANDS, control: LIVE_A, caps: { collect: true, reclaimPause: false } }), { kind: 'not-running' }],
    [inputs({ switches: STANDS, control: LIVE_A, caps: { collect: false, reclaimPause: false } }), { kind: 'not-running' }],
    [inputs({ switches: STANDS, control: BEHIND, caps: { collect: true, reclaimPause: false } }), { kind: 'not-running' }],
  ]],
  ['every unmeasurable control state suppresses the marker',
    (Object.entries(UNMEASURABLE) as [CollectLaneUnmeasurable, CollectLaneControl][]).map(([why, c]): Case =>
      [inputs({ switches: STANDS, control: c, node: KNOWN_A }), { kind: 'safety-stopped', why }])],
  ['{journal:4,row:5} suppresses the marker', [
    [inputs({ switches: STANDS, control: BEHIND, node: KNOWN_A }), { kind: 'safety-stopped', why: 'generation-mismatch' }],
    [inputs({ switches: ABSENT, control: BEHIND, node: KNOWN_A }), { kind: 'safety-stopped', why: 'generation-mismatch' }],
    [inputs({ switches: STANDS, control: AHEAD, node: KNOWN_A }), { kind: 'safety-stopped', why: 'generation-mismatch' }],
  ]],
  ['the seed with a missing journal and the marker is live by the legacy file', [
    [inputs({ switches: STANDS, control: SEED, node: UNMEASURED }), { kind: 'live', armedBy: 'legacy-marker', notes: N }],
  ]],
  ['a set latch makes a re-created marker ineffective', [
    [inputs({ switches: STANDS, control: OFF_LATCHED, node: KNOWN_A }),
      { kind: 'shadowed', why: 'off', notes: notes(false, true) }],
  ]],
  ['marker plus Settings live for this node is both; marker plus off is legacy-marker', [
    [inputs({ switches: STANDS, control: LIVE_A, node: KNOWN_A }), { kind: 'live', armedBy: 'both', notes: N }],
    [inputs({ switches: STANDS, control: OFF, node: KNOWN_A }), { kind: 'live', armedBy: 'legacy-marker', notes: N }],
  ]],
  ['coherent exact live for the known current node is live by Settings', [
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: KNOWN_A }), { kind: 'live', armedBy: 'settings', notes: N }],
    [inputs({ switches: ABSENT, control: LIVE_A, node: KNOWN_A }),
      { kind: 'live', armedBy: 'settings', notes: notes(true, false) }],
    [inputs({ switches: STANDS, control: LIVE_A_LATCHED, node: KNOWN_A }),
      { kind: 'live', armedBy: 'settings', notes: notes(false, true) }],
  ]],
  ['future tokens are shadowed', (['LIVE', 'toString', 'shadowed'] as const).map((choice): Case => [
    inputs({ switches: ABSENT, node: KNOWN_A, control: control({ choice, fleetNodeId: NODE_A, markerRetiredAt: 800n,
      generation: 4n, updatedAt: 900n }, J(4)) }),
    { kind: 'shadowed', why: 'future-choice', notes: N }])],
  ['another node is shadowed', [
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: KNOWN_B }), { kind: 'shadowed', why: 'other-node', notes: N }],
  ]],
  ['live with the node unmeasured or in collision is stopped', [
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: UNMEASURED }), { kind: 'stopped', why: 'unknown-fleet' }],
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: COLLISION }), { kind: 'stopped', why: 'unknown-fleet' }],
    [inputs({ switches: ABSENT, control: LIVE_A, node: UNMEASURED }), { kind: 'stopped', why: 'unknown-fleet' }],
  ]],
  ['live with the node unknown but the marker armed is still live by the legacy file', [
    [inputs({ switches: STANDS, control: LIVE_A, node: UNMEASURED }), { kind: 'live', armedBy: 'legacy-marker', notes: N }],
    [inputs({ switches: STANDS, control: LIVE_A, node: COLLISION }), { kind: 'live', armedBy: 'legacy-marker', notes: N }],
  ]],
  ['a node measured on another epoch is unknown-fleet', [
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: KNOWN_A_EARLIER }), { kind: 'stopped', why: 'unknown-fleet' }],
    [inputs({ switches: ABSENT, control: LIVE_A_LATCHED, node: KNOWN_A_LATER }), { kind: 'stopped', why: 'unknown-fleet' }],
  ]],
  ['off with the node unknown is shadowed, never unknown-fleet', [
    [inputs({ switches: ABSENT, control: OFF_LATCHED, node: UNMEASURED }), { kind: 'shadowed', why: 'off', notes: N }],
    [inputs({ switches: ABSENT, control: OFF_LATCHED, node: COLLISION }), { kind: 'shadowed', why: 'off', notes: N }],
  ]],
  ['a stored node arms only beside an exact live, and a live with no stored node never arms', [
    [inputs({ switches: ABSENT, node: KNOWN_A, control: control({ fleetNodeId: NODE_A, markerRetiredAt: 800n,
      generation: 4n, updatedAt: 900n }, J(4)) }), { kind: 'shadowed', why: 'off', notes: N }],
    [inputs({ switches: ABSENT, node: KNOWN_A, control: control({ choice: 'live', markerRetiredAt: 800n,
      generation: 4n, updatedAt: 900n }, J(4)) }), { kind: 'shadowed', why: 'other-node', notes: N }],
    [inputs({ switches: ABSENT, node: UNMEASURED, control: control({ choice: 'live', markerRetiredAt: 800n,
      generation: 4n, updatedAt: 900n }, J(4)) }), { kind: 'stopped', why: 'unknown-fleet' }],
  ]],
];

describe('Figure 5, with the three unknown-node cases (path-identity spec §5.2, §5.5)', () => {
  it('CONTROL: each control fixture is the state its name says, through the real coherence rule', () => {
    expect(SEED).toMatchObject({ kind: 'coherent', generation: 0, bootstrap: true });
    expect(OFF).toMatchObject({ kind: 'coherent', generation: 3, bootstrap: false, row: { choice: 'off', markerRetiredAt: null } });
    expect(OFF_LATCHED).toMatchObject({ kind: 'coherent', row: { choice: 'off', markerRetiredAt: 800 } });
    expect(LIVE_A).toMatchObject({ kind: 'coherent', row: { choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: null } });
    expect(LIVE_A_LATCHED).toMatchObject({ kind: 'coherent', row: { choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: 800 } });
    expect(BEHIND).toMatchObject({ kind: 'mismatch', journalMax: 4, rowGeneration: 5 });
    expect(AHEAD).toMatchObject({ kind: 'mismatch', journalMax: 5, rowGeneration: 4 });
    for (const [why, c] of Object.entries(UNMEASURABLE)) expect(c, why).toEqual({ kind: 'unmeasurable', why });
  });

  it.each<readonly [string, readonly Case[]]>(FIGURE_5)('%s', (_title, cases) => {
    for (const [i, want] of cases) expect(collectLaneEffective(i), JSON.stringify(i)).toEqual(want);
  });
});

describe('the latch predicate (path-identity spec §5.4)', () => {
  it('due on a coherent, unpaused, listed, same-epoch absence with the latch null', () => {
    for (const [what, c] of [['seed', SEED], ['off', OFF], ['live', LIVE_A]] as const) {
      expect(collectLatchDue(ABSENT, SAME, c), what).toBe(true);
    }
  });

  it('not due when any one condition fails', () => {
    const rows: readonly (readonly [string, CollectLaneSwitches, CollectEpochPair, CollectLaneControl])[] = [
      ['raised', { paused: true, why: 'raised', marker: false }, SAME, OFF],
      ['unlistable', UNLISTABLE, SAME, OFF],
      ['epoch moved', ABSENT, MOVED, OFF],
      ['marker stands', STANDS, SAME, OFF],
      ['latch set', ABSENT, SAME, OFF_LATCHED],
      ['mismatch, journal behind', ABSENT, SAME, BEHIND],
      ['mismatch, journal ahead', ABSENT, SAME, AHEAD],
      ...Object.entries(UNMEASURABLE).map(([why, c]) => [why, ABSENT, SAME, c] as const),
    ];
    expect(collectLatchDue(ABSENT, SAME, OFF), 'CONTROL: the row each case breaks is due').toBe(true);
    for (const [what, s, e, c] of rows) expect(collectLatchDue(s, e, c), what).toBe(false);
  });

  it('due even when choice is live and the node is unknown', () => {
    for (const node of [UNMEASURED, COLLISION, KNOWN_A_EARLIER]) {
      expect(collectLaneEffective(inputs({ switches: ABSENT, control: LIVE_A, node })), 'the arm is stopped')
        .toEqual({ kind: 'stopped', why: 'unknown-fleet' });
    }
    expect(collectLatchDue(ABSENT, SAME, LIVE_A), 'the latch is decided apart from the arm').toBe(true);
  });

  it('the resolver’s latchDue note is the predicate’s answer, so the latch has one definer', () => {
    let due = 0;
    let notDue = 0;
    for (const [i] of FIGURE_5.flatMap(([, cases]) => cases)) {
      const r = collectLaneEffective(i);
      if (r.kind !== 'live' && r.kind !== 'shadowed') continue;
      expect(r.notes.latchDue, JSON.stringify(i)).toBe(collectLatchDue(i.switches, i.epoch, i.control));
      if (r.notes.latchDue) due += 1;
      else notDue += 1;
    }
    expect(due, 'CONTROL: a due row is among them').toBeGreaterThan(0);
    expect(notDue, 'CONTROL: a row not due is among them').toBeGreaterThan(0);
  });
});

describe('the flip boolean (path-identity spec §5.5)', () => {
  it('collectLaneLive is true for the live arm alone, whatever armed it', () => {
    for (const armedBy of ['legacy-marker', 'settings', 'both'] as const) {
      expect(collectLaneLive({ kind: 'live', armedBy, notes: N }), armedBy).toBe(true);
    }
    for (const why of ['off', 'future-choice', 'other-node'] as const) {
      expect(collectLaneLive({ kind: 'shadowed', why, notes: N }), why).toBe(false);
    }
    expect(collectLaneLive({ kind: 'safety-stopped', why: 'generation-mismatch' })).toBe(false);
  });
});
