// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.6): the collector switch's route decisions, pure. The
// body is refused, never clamped; the confirm key binds every safety fact and is FNV-1a over canonical JSON; the POST
// decision answers in the route's order from the 503 down; the feed body reads a repair from the journal read before
// the write; and a 200 is proved by a coherent re-read. No marker name, journal file name or capability token is
// spelled here.
import { describe, it, expect } from 'vitest';
import {
  COLLECT_LANE_APPLIES_TEXT, collectConfirmKey, collectLaneSettingChange, collectLaneWriteProved,
  decideCollectLaneBody, decideCollectLanePost,
  type CollectCurrentNode, type CollectLaneJournalRead, type CollectLaneKeyFacts, type CollectLaneRowRaw,
  type CollectLaneRowRead, type CollectLaneWriteRequest, type CollectPostDecision, type CollectPostInput,
} from '../src/collectLane.js';
import type { CollectLaneConfirmRequired } from '../../shared/api.js';

const NODE = 'node-a';
const OTHER = 'node-b';
const BOOT = 'boot-a';
const MEASURED_AT = 1_760_000_000_000;
/** The migration's exact seed, as the store reads it: bigints. */
const SEED_RAW: CollectLaneRowRaw = { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };
const row = (o: Partial<CollectLaneRowRaw> = {}): CollectLaneRowRead => ({ kind: 'row', row: { ...SEED_RAW, ...o } });
const SEED = row();
const MISSING: CollectLaneJournalRead = { kind: 'missing' };
const ok = (max: number): CollectLaneJournalRead => ({ kind: 'ok', max, records: max });
const liveRow = (generation: number, nodeId: string = NODE, latch: bigint | null = null): CollectLaneRowRead =>
  row({ choice: 'live', fleetNodeId: nodeId, markerRetiredAt: latch, generation: BigInt(generation), updatedAt: 5n });
const offRow = (generation: number, latch: bigint | null): CollectLaneRowRead =>
  row({ choice: 'off', fleetNodeId: null, markerRetiredAt: latch, generation: BigInt(generation), updatedAt: 5n });
const known = (connectionEpoch: number = 3, nodeId: string = NODE): CollectCurrentNode =>
  ({ kind: 'known', connectionEpoch, nodeId, measuredAt: MEASURED_AT });
const CAPS = { collect: true, reclaimPause: true };
const input = (o: Partial<CollectPostInput> = {}): CollectPostInput => ({
  request: { choice: 'live' }, row: SEED, journal: MISSING, switches: { paused: false, marker: false },
  epoch: { before: 3, after: 3 }, node: known(), caps: CAPS, boot: BOOT, counts: null, ...o,
});
const confirmOf = (d: CollectPostDecision): CollectLaneConfirmRequired => {
  if (d.kind !== 'confirm') throw new Error(`expected a confirm decision, got ${d.kind}`);
  return d.body;
};

describe('the body (path-identity spec §5.6)', () => {
  it('an unknown key is refused, naming it', () => {
    const r = decideCollectLaneBody({ choice: 'live', extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('unknown key extra');
    const proto = decideCollectLaneBody(JSON.parse('{"choice":"off","__proto__":{"x":1}}'));
    expect(proto.ok, 'an own __proto__ key is a key like any other').toBe(false);
    if (!proto.ok) expect(proto.detail).toContain('unknown key __proto__');
  });

  it('a non-object is refused', () => {
    for (const body of [null, undefined, [], ['live'], 'live', 7, true]) {
      expect(decideCollectLaneBody(body), String(JSON.stringify(body))).toEqual({ ok: false, detail: 'body must be an object' });
    }
  });

  it('LIVE and toString are not choices', () => {
    for (const body of [{ choice: 'LIVE' }, { choice: 'toString' }, { choice: 'shadowed' }, { choice: ' live' }, { choice: 1 }, {}]) {
      expect(decideCollectLaneBody(body), JSON.stringify(body)).toEqual({ ok: false, detail: 'choice must be off or live' });
    }
  });

  it('confirm must be 8 lowercase hex', () => {
    for (const confirm of [7, 'XYZ', 'ABCDEF12', 'abcdef123', 'abcdef1', '', null]) {
      const r = decideCollectLaneBody({ choice: 'live', confirm });
      expect(r.ok, String(confirm)).toBe(false);
      if (!r.ok) expect(r.detail, String(confirm)).toMatch(/^confirm /);
    }
  });

  it('{choice} and {choice, confirm} parse', () => {
    const off = decideCollectLaneBody({ choice: 'off' });
    expect(off).toEqual({ ok: true, request: { choice: 'off' } });
    if (off.ok) expect(Object.keys(off.request), 'no confirm key is invented').toEqual(['choice']);
    expect(decideCollectLaneBody({ choice: 'live', confirm: '0a1b2c3d' }))
      .toEqual({ ok: true, request: { choice: 'live', confirm: '0a1b2c3d' } });
  });
});

describe('the confirm key binds every safety fact (§5.6, R10)', () => {
  /** Written in a non-sorted order on purpose: JSON.stringify of it is NOT the canonical text. */
  const FACTS: CollectLaneKeyFacts = {
    boot: BOOT, epoch: 3, node: NODE,
    row: { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0 },
    journal: 'missing', marker: 'absent', caps: { collect: true, reclaimPause: true }, paused: false,
  };
  /** FACTS with every key sorted at every depth, written by hand: what the canonical JSON must be. */
  const CANONICAL = '{"boot":"boot-a","caps":{"collect":true,"reclaimPause":true},"epoch":3,"journal":"missing",'
    + '"marker":"absent","node":"node-a","paused":false,"row":{"choice":"off","fleetNodeId":null,"generation":0,'
    + '"markerRetiredAt":null}}';
  /** A reference FNV-1a, 32-bit, over UTF-16 code units, in bigint arithmetic, so it shares no step with the shipped one. */
  const fnvRef = (s: string): string => {
    let h = 2166136261n;
    for (let i = 0; i < s.length; i++) h = ((h ^ BigInt(s.charCodeAt(i))) * 16777619n) % 4294967296n;
    return h.toString(16).padStart(8, '0');
  };
  const ONE_FACT: [string, CollectLaneKeyFacts][] = [
    ['boot', { ...FACTS, boot: 'boot-b' }],
    ['epoch', { ...FACTS, epoch: 4 }],
    ['node', { ...FACTS, node: OTHER }],
    ['choice', { ...FACTS, row: { ...FACTS.row, choice: 'live' } }],
    ['fleetNodeId', { ...FACTS, row: { ...FACTS.row, fleetNodeId: NODE } }],
    ['markerRetiredAt', { ...FACTS, row: { ...FACTS.row, markerRetiredAt: 9 } }],
    ['generation', { ...FACTS, row: { ...FACTS.row, generation: 1 } }],
    ['journal', { ...FACTS, journal: 0 }],
    ['journal maximum', { ...FACTS, journal: 1 }],
    ['marker', { ...FACTS, marker: 'stands' }],
    ['collect cap', { ...FACTS, caps: { ...FACTS.caps, collect: false } }],
    ['reclaim-pause cap', { ...FACTS, caps: { ...FACTS.caps, reclaimPause: false } }],
    ['pause', { ...FACTS, paused: true }],
  ];

  it('CONTROL: the reference hash answers the published FNV-1a vectors', () => {
    expect([fnvRef(''), fnvRef('a'), fnvRef('foobar')]).toEqual(['811c9dc5', 'e40c292c', 'bf9cf968']);
  });

  it('8 lowercase hex', () => {
    expect(collectConfirmKey(FACTS)).toMatch(/^[0-9a-f]{8}$/);
    for (const [fact, f] of ONE_FACT) expect(collectConfirmKey(f), fact).toMatch(/^[0-9a-f]{8}$/);
  });

  it.each(ONE_FACT)('it changes when each fact changes alone: %s', (_fact, changed) => {
    expect(collectConfirmKey(changed)).not.toBe(collectConfirmKey(FACTS));
  });

  it('stable under key-order permutation', () => {
    const permuted: CollectLaneKeyFacts = {
      paused: false, caps: { reclaimPause: true, collect: true }, marker: 'absent', journal: 'missing',
      row: { generation: 0, markerRetiredAt: null, fleetNodeId: null, choice: 'off' }, node: NODE, epoch: 3, boot: BOOT,
    };
    expect(JSON.stringify(permuted), 'CONTROL: the two objects serialise differently as written').not.toBe(JSON.stringify(FACTS));
    expect(collectConfirmKey(permuted)).toBe(collectConfirmKey(FACTS));
  });

  it('equals an independent FNV-1a over the canonical JSON', () => {
    expect(JSON.stringify(FACTS), 'CONTROL: FACTS as written is not canonical').not.toBe(CANONICAL);
    expect(collectConfirmKey(FACTS)).toBe(fnvRef(CANONICAL));
  });
});

describe('the POST decision follows R11 and R24', () => {
  const LISTINGS: [string, Partial<CollectPostInput>][] = [
    ['listed, the marker absent', { switches: { paused: false, marker: false } }],
    ['listed, the marker standing', { switches: { paused: false, marker: true } }],
    ['paused, the marker standing', { switches: { paused: true, why: 'raised', marker: true } }],
    ['an unlistable registry', { switches: { paused: true, why: 'unlistable' } }],
    ['an epoch moved during the listing', { epoch: { before: 3, after: 4 }, node: known(4) }],
    ['a node not measured', { node: { kind: 'unmeasured', connectionEpoch: 3 } }],
  ];

  it('control unmeasurable is unmeasurable for both choices', () => {
    const bad: [string, Partial<CollectPostInput>][] = [
      ['a malformed row', { row: row({ generation: '0' }) }],
      ['an unreadable row', { row: { kind: 'unreadable', detail: 'database is locked' } }],
      ['an absent row', { row: { kind: 'absent' } }],
      ['a malformed journal', { journal: { kind: 'malformed', fault: 'json', record: 1 } }],
      ['an unreadable journal', { journal: { kind: 'unreadable', code: 'EACCES' } }],
      ['a journal that is not a regular file', { journal: { kind: 'not-regular', fileKind: 'symlink' } }],
      ['a missing journal beside a used row', { row: offRow(1, null) }],
    ];
    for (const [name, o] of bad) {
      for (const choice of ['off', 'live'] as const) {
        const d = decideCollectLanePost(input({ ...o, request: { choice } }));
        expect(d.kind, `${name}, ${choice}`).toBe('unmeasurable');
        if (d.kind === 'unmeasurable') expect(d.detail, name).not.toMatch(/\/|EACCES|database is locked/);
      }
    }
  });

  it('Off with the latch null is marker, whatever the listing', () => {
    const states: [string, Partial<CollectPostInput>][] = [
      ['the seed', {}],
      ['a coherent Live', { row: liveRow(1), journal: ok(1) }],
      ['a mismatch', { row: liveRow(4), journal: ok(5) }],
    ];
    for (const [s, state] of states) {
      for (const [l, listing] of LISTINGS) {
        expect(decideCollectLanePost(input({ ...state, ...listing, request: { choice: 'off' } })), `${s}; ${l}`)
          .toEqual({ kind: 'marker' });
      }
    }
  });

  it('Off with the latch set writes, even unlistable or epoch-moved', () => {
    const states: [string, Partial<CollectPostInput>][] = [
      ['a coherent Live, latched', { row: liveRow(2, NODE, 9n), journal: ok(2) }],
      ['a coherent Off, latched', { row: offRow(2, 9n), journal: ok(2) }],
      ['a latched journal ahead', { row: liveRow(4, NODE, 9n), journal: ok(5) }],
      ['a latched journal behind', { row: offRow(5, 9n), journal: ok(4) }],
    ];
    for (const [s, state] of states) {
      for (const [l, listing] of LISTINGS) {
        expect(decideCollectLanePost(input({ ...state, ...listing, request: { choice: 'off' } })), `${s}; ${l}`)
          .toEqual({ kind: 'write', request: { kind: 'off' } });
      }
    }
  });

  it('Live is unmeasurable on an unlistable listing, an epoch moved during the await, or a node unmeasured or in collision', () => {
    const cases: [string, Partial<CollectPostInput>][] = [
      ['an unlistable registry', { switches: { paused: true, why: 'unlistable' } }],
      ['an epoch moved during the listing', { epoch: { before: 3, after: 4 }, node: known(4) }],
      ['a node not measured yet', { node: { kind: 'unmeasured', connectionEpoch: 3 } }],
      ['a node id in collision', { node: { kind: 'collision', connectionEpoch: 3 } }],
      ['a node measured on an earlier connection', { node: known(2) }],
    ];
    for (const [name, o] of cases) {
      for (const confirm of [undefined, '0123abcd']) {
        const request = confirm === undefined ? { choice: 'live' as const } : { choice: 'live' as const, confirm };
        const d = decideCollectLanePost(input({ ...o, request }));
        expect(d.kind, `${name}, confirm ${String(confirm)}`).toBe('unmeasurable');
        if (d.kind === 'unmeasurable') expect(d.detail, name).not.toMatch(/\//);
      }
    }
  });

  it('Live without a key is confirm-required, with the sheet\'s facts and the key', () => {
    const body = confirmOf(decideCollectLanePost(input()));
    expect(body.ok).toBe(false);
    expect(body.error).toBe('confirm-required');
    expect(body.facts).toEqual({
      node: { nodeId: NODE, measuredAt: MEASURED_AT }, caps: { collect: true, reclaimPause: true },
      paused: false, marker: 'absent', repair: null, attention: null,
    });
    expect(body.confirmKey, 'the key over the facts this input measured: the seed, a missing journal, epoch 3').toBe(collectConfirmKey({
      boot: BOOT, epoch: 3, node: NODE, row: { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0 },
      journal: 'missing', marker: 'absent', caps: { collect: true, reclaimPause: true }, paused: false,
    }));
    const wide = input({
      row: liveRow(4, OTHER), journal: ok(5), switches: { paused: true, why: 'raised', marker: true },
      caps: { collect: false, reclaimPause: true }, epoch: { before: 7, after: 7 }, node: known(7),
    });
    expect(confirmOf(decideCollectLanePost(wide)).confirmKey,
      'the row generation, the journal maximum, the epoch after the listing, the marker, the caps and the pause').toBe(collectConfirmKey({
      boot: BOOT, epoch: 7, node: NODE, row: { choice: 'live', fleetNodeId: OTHER, markerRetiredAt: null, generation: 4 },
      journal: 5, marker: 'stands', caps: { collect: false, reclaimPause: true }, paused: true,
    }));
    const coherent = input({ row: liveRow(2, OTHER), journal: ok(2) });
    expect(confirmOf(decideCollectLanePost(coherent)).confirmKey, 'a used, coherent journal keys its maximum').toBe(collectConfirmKey({
      boot: BOOT, epoch: 3, node: NODE, row: { choice: 'live', fleetNodeId: OTHER, markerRetiredAt: null, generation: 2 },
      journal: 2, marker: 'absent', caps: { collect: true, reclaimPause: true }, paused: false,
    }));
    const latched = input({ row: liveRow(2, OTHER, 9n), journal: ok(2) });
    expect(confirmOf(decideCollectLanePost(latched)).confirmKey, 'a set latch is keyed').toBe(collectConfirmKey({
      boot: BOOT, epoch: 3, node: NODE, row: { choice: 'live', fleetNodeId: OTHER, markerRetiredAt: 9, generation: 2 },
      journal: 2, marker: 'absent', caps: { collect: true, reclaimPause: true }, paused: false,
    }));
    const counted = confirmOf(decideCollectLanePost(input({ counts: { wouldCollect: 2, held: 1, boxLines: 3 } })));
    expect(counted.facts.attention).toEqual({ wouldCollect: 2, held: 1, boxLines: 3 });
    expect(counted.confirmKey, 'the counts are shown on the sheet and never keyed').toBe(body.confirmKey);
  });

  it('Live with a wrong key is confirm-stale, with fresh facts and key', () => {
    const first = confirmOf(decideCollectLanePost(input()));
    const moved = input({ switches: { paused: false, marker: true }, request: { choice: 'live', confirm: first.confirmKey } });
    const stale = confirmOf(decideCollectLanePost(moved));
    expect(stale.error).toBe('confirm-stale');
    expect(stale.facts.marker, 'the fresh facts').toBe('stands');
    expect(stale.confirmKey).not.toBe(first.confirmKey);
    expect(stale.confirmKey, 'the fresh key').toBe(confirmOf(decideCollectLanePost({ ...moved, request: { choice: 'live' } })).confirmKey);
    expect(decideCollectLanePost({ ...moved, request: { choice: 'live', confirm: stale.confirmKey } }).kind, 'the fresh key writes')
      .toBe('write');
  });

  it('Live with the right key writes, carrying the expected row and journal', () => {
    const before = input({ row: liveRow(1, OTHER), journal: ok(1) });
    const key = confirmOf(decideCollectLanePost(before)).confirmKey;
    const confirmed: CollectPostInput = { ...before, request: { choice: 'live', confirm: key } };
    const d = decideCollectLanePost(confirmed);
    expect(d).toEqual({
      kind: 'write', request: { kind: 'live', fleetNodeId: NODE, expected: confirmed.row, expectedJournal: confirmed.journal },
    });
    if (d.kind !== 'write' || d.request.kind !== 'live') throw new Error('expected a live write');
    expect(d.request.expected, 'the read itself, never a copy').toBe(confirmed.row);
    expect(d.request.expectedJournal).toBe(confirmed.journal);
  });

  it('Live is confirmable with a capability missing or the pause standing', () => {
    const variants: Partial<CollectPostInput>[] = [
      { caps: { collect: false, reclaimPause: true } },
      { caps: { collect: true, reclaimPause: false } },
      { switches: { paused: true, why: 'raised', marker: false } },
    ];
    for (const o of variants) {
      const asked = input(o);
      const b = confirmOf(decideCollectLanePost(asked));
      expect(b.facts.caps).toEqual(asked.caps);
      expect(b.facts.paused).toBe(asked.switches.paused);
      expect(decideCollectLanePost({ ...asked, request: { choice: 'live', confirm: b.confirmKey } }).kind).toBe('write');
    }
  });

  it('a mismatch shows as the repair fact', () => {
    expect(confirmOf(decideCollectLanePost(input({ row: liveRow(4, OTHER), journal: ok(5) }))).facts.repair).toBe('journal-ahead');
    expect(confirmOf(decideCollectLanePost(input({ row: liveRow(5, OTHER), journal: ok(4) }))).facts.repair).toBe('journal-behind');
    expect(confirmOf(decideCollectLanePost(input({ row: liveRow(4, OTHER), journal: ok(4) }))).facts.repair).toBeNull();
    expect(confirmOf(decideCollectLanePost(input())).facts.repair, 'the bootstrap is coherent').toBeNull();
  });

  it('a no-op Live still needs the key', () => {
    const same = input({ row: liveRow(1), journal: ok(1) });
    const asked = confirmOf(decideCollectLanePost(same));
    expect(asked.error).toBe('confirm-required');
    expect(decideCollectLanePost({ ...same, request: { choice: 'live', confirm: asked.confirmKey } }).kind,
      'the store, not the decision, finds the no-op').toBe('write');
  });

  it('the wire facts carry neither the boot nonce nor the epoch', () => {
    const b = confirmOf(decideCollectLanePost(input({ epoch: { before: 4242, after: 4242 }, node: known(4242) })));
    expect(Object.keys(b.facts).sort()).toEqual(['attention', 'caps', 'marker', 'node', 'paused', 'repair']);
    expect(Object.keys(b.facts.node).sort()).toEqual(['measuredAt', 'nodeId']);
    const wire = JSON.stringify(b.facts);
    expect(wire).not.toContain(BOOT);
    expect(wire).not.toContain('4242');
  });
});

describe('the change body and the write proof', () => {
  const REPAIRING = ', repairing a journal that disagreed with the database';

  it('the change names before and after, the node for Live, the generation and a repair; no path', () => {
    const bodies = [
      collectLaneSettingChange(SEED, liveRow(1), MISSING),
      collectLaneSettingChange(liveRow(1), offRow(2, null), ok(1)),
      collectLaneSettingChange(offRow(4, null), liveRow(6), ok(5)),
      collectLaneSettingChange(offRow(2, null), offRow(3, 9n), ok(2)),
    ];
    expect(bodies[0]).toBe('choice off → live for fleet node node-a (generation 1)');
    expect(bodies[1]).toBe('choice live for fleet node node-a → off (generation 2)');
    expect(bodies[2], 'a journal ahead').toBe(`choice off → live for fleet node node-a (generation 6)${REPAIRING}`);
    expect(bodies[3], 'a retirement, which the POST never writes, still reads true')
      .toBe("choice off → off (generation 3), retiring the fleet box's legacy file");
    for (const b of bodies) expect(b).not.toMatch(/\//);
  });

  it('a behind-journal repair (row 5, journal 4, written at 6) still says repairing', () => {
    expect(collectLaneSettingChange(offRow(5, 9n), offRow(6, 9n), ok(4))).toBe(`choice off → off (generation 6)${REPAIRING}`);
    expect(collectLaneSettingChange(liveRow(5, OTHER), liveRow(6), ok(4)))
      .toBe(`choice live for fleet node node-b → live for fleet node node-a (generation 6)${REPAIRING}`);
  });

  it('a future stored token is quoted and bounded', () => {
    const was = (choice: string): CollectLaneRowRead => row({ choice, generation: 1n, updatedAt: 1n });
    expect(collectLaneSettingChange(was('L'.repeat(200)), liveRow(2), ok(1)))
      .toBe(`choice the unknown token "${'L'.repeat(32)}…" → live for fleet node node-a (generation 2)`);
    const bel = String.fromCharCode(7);
    expect(collectLaneSettingChange(was(`a${bel}b`), liveRow(2), ok(1)))
      .toBe('choice the unknown token "a b" → live for fleet node node-a (generation 2)');
    expect(collectLaneSettingChange(was('LIVE'), liveRow(2), ok(1)))
      .toBe('choice the unknown token "LIVE" → live for fleet node node-a (generation 2)');
  });

  it('the proof holds only for a coherent re-read at the written generation and target', () => {
    const live: CollectLaneWriteRequest = { kind: 'live', fleetNodeId: NODE, expected: SEED, expectedJournal: MISSING };
    const off: CollectLaneWriteRequest = { kind: 'off' };
    expect(collectLaneWriteProved(live, 1, liveRow(1), ok(1))).toBe(true);
    expect(collectLaneWriteProved(live, 1, liveRow(1), ok(2)), 'a mismatch').toBe(false);
    expect(collectLaneWriteProved(live, 1, liveRow(1), MISSING), 'a missing journal beside a used row').toBe(false);
    expect(collectLaneWriteProved(live, 1, liveRow(1, OTHER), ok(1)), 'another node').toBe(false);
    expect(collectLaneWriteProved(live, 1, offRow(1, null), ok(1)), 'another choice').toBe(false);
    expect(collectLaneWriteProved(live, 1, liveRow(2), ok(2)), 'another generation').toBe(false);
    expect(collectLaneWriteProved(live, 1, { kind: 'unreadable', detail: 'database is locked' }, ok(1)), 'an unreadable re-read').toBe(false);
    expect(collectLaneWriteProved(off, 2, offRow(2, 9n), ok(2))).toBe(true);
    expect(collectLaneWriteProved(off, 2, row({ fleetNodeId: NODE, markerRetiredAt: 9n, generation: 2n, updatedAt: 5n }), ok(2)),
      'Off keeps no node').toBe(false);
  });

  it('a no-op proof (generation null) holds only for a coherent re-read at the unchanged generation showing the requested choice and node', () => {
    const same: CollectLaneWriteRequest = { kind: 'live', fleetNodeId: NODE, expected: liveRow(1), expectedJournal: ok(1) };
    expect(collectLaneWriteProved(same, null, liveRow(1), ok(1))).toBe(true);
    expect(collectLaneWriteProved(same, null, liveRow(2), ok(2)), 'the generation moved').toBe(false);
    expect(collectLaneWriteProved(same, null, liveRow(1), ok(2)), 'a mismatch').toBe(false);
    expect(collectLaneWriteProved(same, null, liveRow(1, OTHER), ok(1)), 'another node').toBe(false);
    expect(collectLaneWriteProved(same, null, offRow(1, null), ok(1)), 'another choice').toBe(false);
    const off: CollectLaneWriteRequest = { kind: 'off' };
    expect(collectLaneWriteProved(off, null, SEED, MISSING)).toBe(true);
    expect(collectLaneWriteProved(off, null, liveRow(1), ok(1)), 'not off').toBe(false);
    expect(collectLaneWriteProved(off, null, offRow(1, null), ok(2)), 'a mismatch').toBe(false);
  });

  it('the 200 notice says when the choice applies, and what it cannot stop', () => {
    expect(COLLECT_LANE_APPLIES_TEXT)
      .toBe("The choice applies from the collector's next check; a removal already handed to ccd is not stopped.");
  });
});
