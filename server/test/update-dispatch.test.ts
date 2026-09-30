// The dispatcher's decision (design 2026-09-20 §9/§10; programme wave 5, Task
// 4): planDispatch's table — eligibility, the halt, the order, the capability
// refusals, the direction, the met request — moveRefusal (the predicate the
// routes answer a single node's 409 with), deadlineExpired, the L0 order and
// refusal vocabulary, and the import block that keeps dispatch.ts L1. Values
// in, values out: nothing here needs a fixture home, a store or a clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEADLINE_DETAIL, DETACH_CAP, PROVENANCE_DETAIL_PREFIX, ROLLBACK_CAP, UNVERSIONED_DETAIL, UPDATE_DEADLINE_HARD_CAP_FACTOR,
  autoPermits, deadlineExpired, dispatchRefusalDetail, fleetGate, isHalting, moveRefusal, planDispatch,
  type DispatchNodeView, type DispatchPlan, type DispatchRow, type FleetGate,
} from '../src/update/dispatch.js';
import type { EligibilityRow } from '../src/update/resolve.js';
import type { NodeRow } from '../src/coord/store.js';
import {
  DISPATCH_REFUSALS, UPDATE_GATE_CAP, UPDATE_STATES, compareDispatchOrder, dispatchRank, isDispatchRefusal, rollbackTargetRefusal,
  type AutoMode, type DispatchRefusal, type NodeRole, type ProvenanceState, type RequestKind, type UpdateState,
} from '../../shared/api.js';
import { UPDATE_OP } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const FLEET_ID = '0f0f0f0f-0000-4000-8000-00000000000f';
const SERVER_ID = '5e5e5e5e-0000-4000-8000-00000000005e';
/** Wave 4's seven words on Linux (its Task 13's two arrays, written by `_inst_caps`), through the constants that spell them. */
const W4_CAPS = ['verify', 'node-id', 'floor', 'update-json', UPDATE_GATE_CAP, ROLLBACK_CAP, DETACH_CAP];

/** A W4 fleet node: v0.0.9 on stable with its floor at v0.0.9 (it completed that install), reachable, idle,
 *  advertising the op, no request, no desired tag. */
const fleet = (o: Partial<DispatchRow> = {}): DispatchRow => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', highestVersion: 'v0.0.9', floorRead: 'measured', stampRead: 'ok', caps: W4_CAPS, agentOps: [UPDATE_OP],
  reachable: true, updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
  reportedUpdatedAt: null, channel: 'stable', desiredTag: null, provenance: 'verified',
  requestedTag: null, requestedKind: null, requestedAt: null, ...o,
});
/** The server's own row: spawned locally, so `agentOps` is NULL by construction (decision 11). */
const server = (o: Partial<DispatchRow> = {}): DispatchRow =>
  fleet({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...o });
const ask = (tag: string, kind: RequestKind = 'update'): Partial<DispatchRow> =>
  ({ requestedTag: tag, requestedKind: kind, requestedAt: 1_000 });
const view = (row: DispatchRow, auto: AutoMode = 'off', refused: readonly string[] = []): DispatchNodeView =>
  ({ row, auto, refusedTags: new Set(refused) });
const rel = (tag: string, o: Partial<EligibilityRow> = {}): EligibilityRow =>
  ({ tag, channel: 'stable', bundleListed: true, yanked: false, ...o });
/** v0.0.8 yanked; v0.0.9 and v0.0.10 stable; v0.0.11 dev; v0.0.12 listed WITHOUT its provenance bundle. */
const RELEASES: EligibilityRow[] = [
  rel('v0.0.8', { yanked: true }), rel('v0.0.9'), rel('v0.0.10'), rel('v0.0.11', { channel: 'dev' }),
  rel('v0.0.12', { bundleListed: false }),
];
/** Wave 8 item C: RELEASES with v0.0.8 ALSO unbundled (still yanked, which rollbackTargetRefusal never reads) —
 *  for the fleet-hold cases, which need an unbundled tag a fleet row can stand a rollback REQUEST against. */
const RELEASES_V8_NO_BUNDLE: EligibilityRow[] = RELEASES.map((r) => (r.tag === 'v0.0.8' ? { ...r, bundleListed: false } : r));
const plan = (...nodes: DispatchNodeView[]): DispatchPlan => planDispatch({ nodes, releases: RELEASES });
const OPEN: FleetGate = { haltedBy: [], leaseHeldBy: null };
const refusalOf = (v: DispatchNodeView, kind: RequestKind, target: string,
  source: 'request' | 'auto' = 'request', gate: FleetGate = OPEN): DispatchRefusal | null =>
  moveRefusal(v, { kind, target, source }, RELEASES, gate);
const words = (p: DispatchPlan): [string, DispatchRefusal][] => p.refusals.map((r) => [r.nodeId, r.refusal]);

describe('the L0 refusal vocabulary and the dispatch order (design 2026-09-20 §9/§10)', () => {
  it('DISPATCH_REFUSALS is the twelve words, in order, with no duplicate', () => {
    expect([...DISPATCH_REFUSALS]).toEqual([
      'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
      'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet', 'no-bundle',
    ]);
    expect(new Set(DISPATCH_REFUSALS).size).toBe(DISPATCH_REFUSALS.length);
  });

  it('isDispatchRefusal admits every member and nothing else', () => {
    for (const w of DISPATCH_REFUSALS) expect(isDispatchRefusal(w), w).toBe(true);
    const probes: unknown[] = ['', null, undefined, 1, {}, [], 'busy', 'toString',
      ...DISPATCH_REFUSALS.flatMap((w) => [w.toUpperCase(), ` ${w}`, `${w} `, [w]])];
    for (const p of probes) expect(isDispatchRefusal(p), JSON.stringify(p)).toBe(false);
  });

  it('dispatchRank: fleet 0, server and both 1, an unnamed role 2', () => {
    const ranks: [NodeRole | null, number][] = [['fleet', 0], ['server', 1], ['both', 1], [null, 2]];
    for (const [role, rank] of ranks) expect(dispatchRank(role), String(role)).toBe(rank);
  });

  it('compareDispatchOrder: rank, then label, then nodeId — by code unit, never the locale', () => {
    const rows = [
      { role: null, label: 'a', nodeId: 'n1' }, { role: 'server' as const, label: 'server', nodeId: 'n2' },
      { role: 'both' as const, label: 'box', nodeId: 'n3' }, { role: 'fleet' as const, label: 'z', nodeId: 'n4' },
      { role: 'fleet' as const, label: 'B', nodeId: 'n5' }, { role: 'fleet' as const, label: 'a', nodeId: 'n7' },
      { role: 'fleet' as const, label: 'a', nodeId: 'n6' },
    ];
    // 'B' (0x42) before 'a' (0x61): a locale collation would put `a` first.
    expect([...rows].sort(compareDispatchOrder).map((r) => r.nodeId)).toEqual(['n5', 'n6', 'n7', 'n4', 'n3', 'n2', 'n1']);
    expect(compareDispatchOrder(rows[0]!, rows[0]!)).toBe(0);
  });
});

describe('the halt predicate and the fleet gate', () => {
  it('reverted and failed halt; idle and every busy state do not', () => {
    for (const s of UPDATE_STATES) {
      expect(isHalting({ updateState: s, updateDetail: null }), s).toBe(s === 'reverted' || s === 'failed');
    }
  });

  it('a failed row whose detail BEGINS provenance: does not halt — only the prefix counts', () => {
    expect(PROVENANCE_DETAIL_PREFIX).toBe('provenance:');
    expect(isHalting({ updateState: 'failed', updateDetail: 'provenance: signature does not verify' })).toBe(false);
    expect(isHalting({ updateState: 'failed', updateDetail: 'spawn-failed — provenance: later in the text' })).toBe(true);
    expect(isHalting({ updateState: 'failed', updateDetail: 'provenance signature' })).toBe(true);
    expect(isHalting({ updateState: 'reverted', updateDetail: 'provenance: a reverted row halts whatever it says' })).toBe(true);
  });

  it('fleetGate names the halting rows by nodeId and the first busy row — `unknown` holds the lease', () => {
    const a = fleet({ nodeId: 'b', updateState: 'failed', updateDetail: 'stamp-mismatch' });
    const b = fleet({ nodeId: 'a', updateState: 'reverted' });
    const c = fleet({ nodeId: 'c', updateState: 'failed', updateDetail: 'provenance: x' });
    expect(fleetGate([a, b, c])).toEqual({ haltedBy: ['a', 'b'], leaseHeldBy: null });
    for (const busy of ['pending', 'applying', 'unknown'] as UpdateState[]) {
      expect(fleetGate([fleet({ nodeId: 'z' }), fleet({ nodeId: 'y', updateState: busy })]).leaseHeldBy, busy).toBe('y');
    }
  });
});

describe('autoPermits', () => {
  it('off never; stable only on a stable-resolved node; channel on any resolved channel', () => {
    const table: [AutoMode, 'stable' | 'dev' | null, boolean][] = [
      ['off', 'stable', false], ['off', 'dev', false], ['off', null, false],
      ['stable', 'stable', true], ['stable', 'dev', false], ['stable', null, false],
      ['channel', 'stable', true], ['channel', 'dev', true], ['channel', null, false],
    ];
    for (const [auto, channel, want] of table) expect(autoPermits(auto, channel), `${auto}/${channel}`).toBe(want);
  });
});

describe('planDispatch — one node at a time, fleet-role first (§18 "fleet before server")', () => {
  it('two requested nodes: the fleet node moves, the server waits for it and says so', () => {
    const p = plan(view(fleet(ask('v0.0.10'))), view(server(ask('v0.0.10'))));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'request', viaLink: true,
      detail: 'requested update from v0.0.9 to v0.0.10',
    });
    expect(p.refusals).toEqual([{
      nodeId: SERVER_ID, refusal: 'waiting-for-fleet',
      detail: "waiting-for-fleet — fleet's request for v0.0.10 is outstanding — server moves to v0.0.10 after it is settled or acked",
    }]);
    expect(p.met).toEqual([]);
  });

  it('the same with the server first on the wire', () => {
    const p = plan(view(server(ask('v0.0.10'))), view(fleet(ask('v0.0.10'))));
    expect(p.move?.nodeId).toBe(FLEET_ID);
  });

  it('two AUTO-eligible nodes, the server first on the wire: the fleet node moves and the server waits for its auto move (D-3402)', () => {
    const p = plan(
      view(server({ desiredTag: 'v0.0.10' }), 'stable'),
      view(fleet({ desiredTag: 'v0.0.10' }), 'stable'),
    );
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', kind: 'update', target: 'v0.0.10' });
    expect(p.refusals).toEqual([{
      nodeId: SERVER_ID, refusal: 'waiting-for-fleet',
      detail: "waiting-for-fleet — fleet's auto update to v0.0.10 has not landed — server moves to v0.0.10 after it does, or once that node's own auto is off",
    }]);
  });

  it('a fleet AUTO move and a server REQUEST, the server first on the wire: the fleet moves, the server waits its turn un-noted', () => {
    // Nothing DEFERS the server here — a fleet row with no request never holds a request, and the auto hold holds
    // auto moves only — so only the ORDER keeps the server second (the case mutation 1 reds).
    const p = plan(view(server(ask('v0.0.10'))), view(fleet({ desiredTag: 'v0.0.10' }), 'stable'));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', target: 'v0.0.10' });
    expect(p.refusals).toEqual([]);
  });

  it('the server row moves locally (viaLink false) once the fleet has nothing asked of it', () => {
    const p = plan(view(fleet()), view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, viaLink: false, target: 'v0.0.10' });
  });

  it('a busy row anywhere holds the one lease: no move, the waiting node is not noted', () => {
    for (const busy of ['pending', 'applying', 'unknown'] as UpdateState[]) {
      const p = plan(view(fleet({ nodeId: 'held', label: 'other', updateState: busy })), view(fleet(ask('v0.0.10'))));
      expect(p.move, busy).toBeNull();
      expect(p.gate.leaseHeldBy, busy).toBe('held');
      expect(p.refusals, busy).toEqual([]);
    }
  });
});

describe('planDispatch — the halt (§18 "`failed` halts dispatch", "a provenance refusal does not halt")', () => {
  it('a failed row halts every move, and every requested idle row is noted halted, naming the halting node', () => {
    const p = plan(
      view(fleet({ nodeId: 'dead', label: 'other', updateState: 'failed', updateDetail: 'stamp-mismatch' })),
      view(fleet(ask('v0.0.10'))), view(server(ask('v0.0.10'))),
    );
    expect(p.move).toBeNull();
    expect(p.gate.haltedBy).toEqual(['dead']);
    expect(words(p)).toEqual([[FLEET_ID, 'halted'], [SERVER_ID, 'halted']]);
    expect(p.refusals[0]!.detail)
      .toBe('halted — a failed or reverted node (other) halts every move until it is acked — fleet waits for v0.0.10');
  });

  it('a reverted row halts too', () => {
    const p = plan(view(fleet({ nodeId: 'back', updateState: 'reverted' })), view(server(ask('v0.0.10'))));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'halted']]);
  });

  it('a provenance-failed row halts nothing, and is itself eligible to a newer tag it has not refused', () => {
    const verdict = { updateState: 'failed' as const, updateDetail: 'provenance: signature does not verify' };
    const p = plan(view(fleet({ ...verdict, ...ask('v0.0.10') }), 'off', ['v0.0.11']));
    expect(p.gate.haltedBy).toEqual([]);
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, target: 'v0.0.10' });
    // …and another node moves beside it while it reads failed with no intent of its own.
    const q = plan(view(fleet(verdict)), view(server(ask('v0.0.10'))));
    expect(q.move).toMatchObject({ nodeId: SERVER_ID });
  });

  it('a provenance-failed row whose standing request names the refused tag: no move, NEVER noted, auto does not take over', () => {
    // Decision 7: the refusal does not consume the request, so it stands until ack; the verdict detail is what
    // the halt exception reads, and a note written over it would turn a non-halting verdict into a halt.
    const row = fleet({ updateState: 'failed', updateDetail: 'provenance: bundle absent', ...ask('v0.0.10'), desiredTag: 'v0.0.9' });
    const p = plan(view(row, 'channel', ['v0.0.10']));
    expect(p.move).toBeNull();
    expect(p.refusals).toEqual([]);
    expect(p.met).toEqual([]);
  });
});

describe('planDispatch — who is considered', () => {
  it('an unreachable node is not considered: no move, no note, no met', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), reachable: false })));
    expect(p).toEqual({ gate: OPEN, move: null, refusals: [], met: [] });
    expect(plan(view(fleet({ ...ask('v0.0.9'), reachable: false }))).met).toEqual([]);
  });

  it('auto off with a desiredTag moves nothing; auto stable on a dev-resolved node moves nothing', () => {
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off')).move).toBeNull();
    expect(plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev' }), 'stable')).move).toBeNull();
  });

  it('auto channel with a desiredTag moves the node to it, source auto', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev' }), 'channel'));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'update', target: 'v0.0.11', source: 'auto', viaLink: true,
      detail: 'auto update from v0.0.9 to v0.0.11',
    });
  });

  it('auto on a node whose caps lack the gate word is refused no-update-gate (the planner half of §18)', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', caps: W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP) }), 'stable'));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-update-gate']]);
  });

  it('a request outranks auto on the same node', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev', ...ask('v0.0.10') }), 'channel'));
    expect(p.move).toMatchObject({ target: 'v0.0.10', source: 'request' });
  });

  it('a request whose kind this build cannot read moves nothing, and auto does not take over', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', requestedTag: 'v0.0.10', requestedKind: null }), 'stable'));
    expect(p).toEqual({ gate: OPEN, move: null, refusals: [], met: [] });
  });
});

describe('planDispatch — the direction and the met request (§18 "`apply` refuses an older tag…", Review Focus 1)', () => {
  it('an update requested at the running tag is met, never moved and never refused', () => {
    const p = plan(view(fleet(ask('v0.0.9'))));
    expect(p.met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
    expect(p.move).toBeNull();
    expect(p.refusals).toEqual([]);
  });

  it('a rollback requested at the running tag is met too', () => {
    expect(plan(view(fleet(ask('v0.0.9', 'rollback')))).met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
  });

  it('met needs an idle row whose stamp read: a halted row and an unread stamp are never met', () => {
    const halted = fleet({ updateState: 'reverted', ...ask('v0.0.9') });
    expect(plan(view(halted)).met).toEqual([]);
    const unread = fleet({ stampRead: 'unreadable', ...ask('v0.0.9') });
    expect(plan(view(unread)).met).toEqual([]);
  });

  it('an update below the running tag is not-newer — never met', () => {
    const p = plan(view(fleet({ currentVersion: 'v0.0.10', ...ask('v0.0.9') })));
    expect(p.met).toEqual([]);
    expect(words(p)).toEqual([[FLEET_ID, 'not-newer']]);
    expect(p.refusals[0]!.detail).toBe("not-newer — v0.0.9 is not newer than fleet's v0.0.10 — moving a node down is a rollback");
  });

  it('by the comparator, not the text: v0.0.10 is newer than v0.0.9', () => {
    expect(refusalOf(view(fleet()), 'update', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.10' })), 'update', 'v0.0.9')).toBe('not-newer');
  });

  it('an unversioned node (stamp read, no version, no floor) is never "not newer" and moves with the spec\'s detail', () => {
    expect(UNVERSIONED_DETAIL).toBe('unversioned box — any eligible release is newer');
    const p = plan(view(fleet({ currentVersion: null, highestVersion: null, floorRead: 'absent', ...ask('v0.0.9') })));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, target: 'v0.0.9', detail: UNVERSIONED_DETAIL });
  });

  it('a stamp that could not be read is stamp-unread, never unversioned (D-3379)', () => {
    for (const stampRead of ['absent', 'unreadable', 'malformed'] as const) {
      const p = plan(view(fleet({ stampRead, currentVersion: null, ...ask('v0.0.10') })));
      expect(words(p), stampRead).toEqual([[FLEET_ID, 'stamp-unread']]);
    }
    // A stamp that read but carries a non-tag version is the same unread fact.
    expect(refusalOf(view(fleet({ currentVersion: '0.0.9' })), 'update', 'v0.0.10')).toBe('stamp-unread');
  });

  it('an update needs a listed, unyanked row with its bundle — else unknown-tag', () => {
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.7', highestVersion: 'v0.0.7' })), 'update', 'v0.0.8'), 'yanked').toBe('unknown-tag');
    expect(refusalOf(view(fleet()), 'update', 'v0.0.12'), 'no bundle listed').toBe('unknown-tag');
    expect(refusalOf(view(fleet()), 'update', 'v0.0.99'), 'no row').toBe('unknown-tag');
    expect(refusalOf(view(fleet({ currentVersion: null })), 'update', 'v9'), 'not a tag, on an unversioned node').toBe('unknown-tag');
  });

  it('a rolled-back node: an update at or below its FLOOR is not-newer, naming the floor — the node would refuse it, and that failed row would halt the fleet (D-3403)', () => {
    // Rolled back from v0.0.10 to v0.0.8: the floor file keeps v0.0.10 (decision 8 — a rollback is sticky).
    const back = view(fleet({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10' }));
    expect(refusalOf(back, 'update', 'v0.0.9'), 'above what it runs, below its floor').toBe('not-newer');
    expect(refusalOf(back, 'update', 'v0.0.10'), 'at its floor').toBe('not-newer');
    expect(refusalOf(back, 'update', 'v0.0.11'), 'above its floor').toBeNull();
    expect(dispatchRefusalDetail('not-newer', back, 'v0.0.9'))
      .toBe("not-newer — v0.0.9 is not newer than fleet's floor v0.0.10 (it runs v0.0.8) — pin a newer tag, or use rollback");
    const p = plan(view(fleet({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', ...ask('v0.0.9') })));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'not-newer']]);
    // Rollback is the verb that names its direction: it is catalogue-gated, never floor-gated (decision 8).
    expect(refusalOf(back, 'rollback', 'v0.0.10')).toBeNull();
  });

  it('an unversioned node WITH a floor is not-newer at or below it; with none it is never not-newer (D-3403)', () => {
    const floored = view(fleet({ currentVersion: null, highestVersion: 'v0.0.9' }));
    expect(refusalOf(floored, 'update', 'v0.0.9')).toBe('not-newer');
    expect(refusalOf(floored, 'update', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ currentVersion: null, highestVersion: null, floorRead: 'absent' })), 'update', 'v0.0.9')).toBeNull();
    // A floor value that is not a tag is no floor (floorOf's own rule, W2 Task 12).
    expect(refusalOf(view(fleet({ currentVersion: null, highestVersion: '0.0.9' })), 'update', 'v0.0.9')).toBeNull();
    // A NULL floor never MEASURED (W2 D-3213, floorRead 'unmeasured') is not "no floor": the resolver refuses it
    // before floorOf, and so does the dispatcher — versioned or not, with its own word (the stamp DID read). A
    // rollback is not floor-gated.
    for (const currentVersion of ['v0.0.8', null]) {
      const unmeasured = view(fleet({ currentVersion, highestVersion: null, floorRead: 'unmeasured' }));
      expect(refusalOf(unmeasured, 'update', 'v0.0.10'), String(currentVersion)).toBe('floor-unread');
      expect(dispatchRefusalDetail('floor-unread', unmeasured, 'v0.0.10'))
        .toBe("floor-unread — fleet's floor has not been measured — v0.0.10 waits until it is");
      expect(refusalOf(unmeasured, 'rollback', 'v0.0.9')).toBeNull();
    }
  });
});

describe('planDispatch — rollback (decision 8: an explicit request, catalogue-gated)', () => {
  it('to a yanked release moves — rolling back to a yanked release is the point', () => {
    const p = plan(view(fleet(ask('v0.0.8', 'rollback'))));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'rollback', target: 'v0.0.8', source: 'request', viaLink: true,
      detail: 'requested rollback from v0.0.9 to v0.0.8',
    });
  });

  it('to a tag no releases row names is unknown-tag', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.7')).toBe('unknown-tag');
  });

  it('to a tag THIS node refused is refused-by-node; another node\'s refusal is not an input', () => {
    expect(refusalOf(view(fleet(), 'off', ['v0.0.8']), 'rollback', 'v0.0.8')).toBe('refused-by-node');
    const p = plan(view(fleet(ask('v0.0.8', 'rollback'))), view(server(), 'off', ['v0.0.8']));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, kind: 'rollback' });
  });

  it('an update to a refused tag is refused-by-node too (D-3394)', () => {
    expect(refusalOf(view(fleet(), 'off', ['v0.0.10']), 'update', 'v0.0.10')).toBe('refused-by-node');
  });

  it('without the rollback word it is no-rollback-cap; an update on the same node still moves', () => {
    const caps = W4_CAPS.filter((c) => c !== ROLLBACK_CAP);
    expect(refusalOf(view(fleet({ caps })), 'rollback', 'v0.0.8')).toBe('no-rollback-cap');
    expect(refusalOf(view(fleet({ caps })), 'update', 'v0.0.10')).toBeNull();
  });

  it('is never a not-newer: a rollback names its direction, and an unread stamp does not stop it', () => {
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.8' })), 'rollback', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ stampRead: 'unreadable', currentVersion: null })), 'rollback', 'v0.0.9')).toBeNull();
  });
});

describe('a rollback the node is known to refuse is refused before any lease (wave 8 item C)', () => {
  it('(a) a bundleListed:false row, provenance verified -> no-bundle', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.12')).toBe('no-bundle');
  });

  it('(b) the same, unverified -> null (the control that the word keys on provenance)', () => {
    expect(refusalOf(view(fleet({ provenance: 'unverified' })), 'rollback', 'v0.0.12')).toBeNull();
  });

  it('(c) the same, unknown -> null', () => {
    expect(refusalOf(view(fleet({ provenance: 'unknown' })), 'rollback', 'v0.0.12')).toBeNull();
  });

  it('(d) bundleListed:true, verified -> null', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.10')).toBeNull();
  });

  it('(e) no row -> unknown-tag', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.99')).toBe('unknown-tag');
  });

  it('(f) yanked:true, bundleListed:true, verified -> null (yanked stays permitted)', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.8')).toBeNull();
  });

  it('(g) an UPDATE to a bundleListed:false row is unchanged from main: unknown-tag (no-bundle is rollback-only)', () => {
    expect(refusalOf(view(fleet()), 'update', 'v0.0.12')).toBe('unknown-tag');
  });

  it('(h) rollbackTargetRefusal: the direct table over bundleListed x provenance, and undefined provenance', () => {
    const bundled = { bundleListed: true };
    const unbundled = { bundleListed: false };
    const table: [{ bundleListed: boolean } | undefined, ProvenanceState | undefined, 'unknown-tag' | 'no-bundle' | null][] = [
      [undefined, 'verified', 'unknown-tag'], [undefined, 'unverified', 'unknown-tag'],
      [undefined, 'unknown', 'unknown-tag'], [undefined, undefined, 'unknown-tag'],
      [bundled, 'verified', null], [bundled, 'unverified', null], [bundled, 'unknown', null], [bundled, undefined, null],
      [unbundled, 'verified', 'no-bundle'], [unbundled, 'unverified', null], [unbundled, 'unknown', null], [unbundled, undefined, null],
    ];
    for (const [release, provenance, want] of table) {
      expect(rollbackTargetRefusal(release, provenance), JSON.stringify({ release, provenance })).toBe(want);
    }
  });

  it('(i) dispatchRefusalDetail names the remedy commands and never claims --allow-unsigned on a rollback', () => {
    const d = dispatchRefusalDetail('no-bundle', view(fleet()), 'v0.0.8');
    expect(d.startsWith('no-bundle — the catalogue lists no provenance bundle for v0.0.8')).toBe(true);
    expect(d).toContain('ccrc rollback --to v0.0.8 flips to a kept copy if it keeps one');
    expect(d).toContain('ccrc update --to v0.0.8 --downgrade --allow-unsigned');
    expect(d).not.toContain('ccrc rollback --to v0.0.8 --allow-unsigned');
  });

  // (j) the premise pin already exists: `update-dispatch.test.ts:104`'s "a failed row whose detail BEGINS
  // provenance: does not halt" — cited here, nothing added.
});

describe('a standing fleet rollback the server refuses holds no server move (wave 8 item C, D-3588)', () => {
  it('(a) the fleet row\'s refused rollback request holds nothing: the server\'s auto move lands', () => {
    const p = planDispatch({
      nodes: [
        view(fleet({ requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: 1_000, desiredTag: 'v0.0.10' }), 'channel'),
        view(server({ desiredTag: 'v0.0.10' }), 'stable'),
      ],
      releases: RELEASES_V8_NO_BUNDLE,
    });
    expect(p.move?.nodeId).toBe(SERVER_ID);
    expect(words(p)).toEqual([[FLEET_ID, 'no-bundle']]);
  });

  it('(b) the control: the same fleet request over a BUNDLED row holds the server as waiting-for-fleet, exactly as main does', () => {
    const p = plan(
      view(fleet({ requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: 1_000, desiredTag: 'v0.0.10' }), 'channel'),
      view(server({ desiredTag: 'v0.0.10' }), 'stable'),
    );
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, kind: 'rollback', target: 'v0.0.8' });
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('(c) the fleet row itself gets a planned no-bundle refusal (non-halting)', () => {
    const p = planDispatch({
      nodes: [view(fleet({ requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: 1_000 }))],
      releases: RELEASES_V8_NO_BUNDLE,
    });
    expect(p.move).toBeNull();
    expect(p.gate.haltedBy).toEqual([]);
    expect(words(p)).toEqual([[FLEET_ID, 'no-bundle']]);
  });

  it('(d) the same fleet row with auto OFF, and a server row with a REQUESTED update: the server\'s request moves — isolates fleetAsk', () => {
    const p = planDispatch({
      nodes: [
        view(fleet({ requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: 1_000 }), 'off'),
        view(server(ask('v0.0.10')), 'off'),
      ],
      releases: RELEASES_V8_NO_BUNDLE,
    });
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, source: 'request', target: 'v0.0.10' });
    expect(words(p)).toEqual([[FLEET_ID, 'no-bundle']]);
  });
});

describe('planDispatch — capabilities (§18 "every capability refusal is in the dispatcher")', () => {
  it('no detach word: no-detach-cap, for either kind, on the server row too', () => {
    const caps = W4_CAPS.filter((c) => c !== DETACH_CAP);
    expect(refusalOf(view(fleet({ caps })), 'update', 'v0.0.10')).toBe('no-detach-cap');
    expect(refusalOf(view(fleet({ caps })), 'rollback', 'v0.0.8')).toBe('no-detach-cap');
    expect(refusalOf(view(server({ caps })), 'update', 'v0.0.10')).toBe('no-detach-cap');
  });

  it('a link-reached row whose agent advertises nothing is agent-predates-update-op (§18 "an agent without the op is never sent it")', () => {
    const p = plan(view(fleet({ agentOps: [], ...ask('v0.0.10') })));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'agent-predates-update-op']]);
    expect(refusalOf(view(fleet({ agentOps: ['something-else'] })), 'update', 'v0.0.10')).toBe('agent-predates-update-op');
  });

  it('the server row (agentOps NULL) is never refused for agentOps (§18)', () => {
    const p = plan(view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, viaLink: false });
  });

  it('a REQUEST on a node without the gate word moves — a request needs detach, not the auto gate', () => {
    const caps = W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP);
    const p = plan(view(fleet({ caps, desiredTag: 'v0.0.11', ...ask('v0.0.10') }), 'channel'));
    expect(p.move).toMatchObject({ target: 'v0.0.10', source: 'request' });
  });

  it('the server row under auto without the gate word is no-update-gate — checked for caps, never for agentOps', () => {
    const caps = W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP);
    expect(refusalOf(view(server({ caps })), 'update', 'v0.0.10', 'auto')).toBe('no-update-gate');
  });

  it('every word but waiting-for-fleet is reachable from moveRefusal alone', () => {
    const halted: FleetGate = { haltedBy: ['x'], leaseHeldBy: null };
    const without = (c: string): string[] => W4_CAPS.filter((w) => w !== c);
    const reach: Record<Exclude<DispatchRefusal, 'waiting-for-fleet'>, DispatchRefusal | null> = {
      halted: refusalOf(view(fleet()), 'update', 'v0.0.10', 'request', halted),
      'stamp-unread': refusalOf(view(fleet({ stampRead: 'unreadable' })), 'update', 'v0.0.10'),
      'floor-unread': refusalOf(view(fleet({ highestVersion: null, floorRead: 'unmeasured' })), 'update', 'v0.0.10'),
      'not-newer': refusalOf(view(fleet()), 'update', 'v0.0.9'),
      'unknown-tag': refusalOf(view(fleet()), 'update', 'v0.0.12'),
      'refused-by-node': refusalOf(view(fleet(), 'off', ['v0.0.10']), 'update', 'v0.0.10'),
      'no-detach-cap': refusalOf(view(fleet({ caps: without(DETACH_CAP) })), 'update', 'v0.0.10'),
      'no-rollback-cap': refusalOf(view(fleet({ caps: without(ROLLBACK_CAP) })), 'rollback', 'v0.0.8'),
      'no-update-gate': refusalOf(view(fleet({ caps: without(UPDATE_GATE_CAP) })), 'update', 'v0.0.10', 'auto'),
      'agent-predates-update-op': refusalOf(view(fleet({ agentOps: [] })), 'update', 'v0.0.10'),
      'no-bundle': refusalOf(view(fleet()), 'rollback', 'v0.0.12'),
    };
    for (const [want, got] of Object.entries(reach)) expect(got, want).toBe(want);
  });

  it('the order of the checks: a halted fleet says so before any one node\'s fault', () => {
    const worst = view(fleet({ stampRead: 'unreadable', caps: [], agentOps: [] }), 'off', ['v0.0.10']);
    expect(refusalOf(worst, 'update', 'v0.0.10', 'request', { haltedBy: ['x'], leaseHeldBy: null })).toBe('halted');
    expect(refusalOf(worst, 'update', 'v0.0.10')).toBe('stamp-unread');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.9']), 'update', 'v0.0.9')).toBe('not-newer');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.12']), 'update', 'v0.0.12')).toBe('unknown-tag');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.10']), 'update', 'v0.0.10')).toBe('refused-by-node');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] })), 'rollback', 'v0.0.8')).toBe('no-detach-cap');
    expect(refusalOf(view(fleet({ caps: [DETACH_CAP], agentOps: [] })), 'rollback', 'v0.0.8')).toBe('no-rollback-cap');
    expect(refusalOf(view(fleet({ caps: [DETACH_CAP], agentOps: [] })), 'update', 'v0.0.10', 'auto')).toBe('no-update-gate');
  });
});

describe('planDispatch — the order under partial eligibility (D-3381, Review Focus 2)', () => {
  const serverAsks = view(server(ask('v0.0.10')));

  it('fleet requested but unreachable: nothing moves, the server waits for the fleet', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), reachable: false })), serverAsks);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested but refused: the fleet is noted, the server still waits until the fleet row is acked', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), caps: W4_CAPS.filter((c) => c !== DETACH_CAP) })), serverAsks);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-detach-cap'], [SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested and holding its own lease: nothing moves, the server waits', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), updateState: 'pending', updateStartedAt: 5 })), serverAsks);
    expect(p.move).toBeNull();
    expect(p.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested and already there: its request is met on this run, the server waits one run', () => {
    const p = plan(view(fleet(ask('v0.0.9'))), serverAsks);
    expect(p.met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('a fleet node with NO request never blocks: the server moves', () => {
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off'), serverAsks).move).toMatchObject({ nodeId: SERVER_ID });
  });

  it('a server-role node with its own refusal reports that refusal, not the wait', () => {
    const p = plan(view(fleet(ask('v0.0.10'))), view(server({ ...ask('v0.0.10'), caps: [] })));
    expect(words(p)).toEqual([[SERVER_ID, 'no-detach-cap']]);
  });

  it('a role: null row (rank 2) is held by a fleet request exactly like a server row — D-3381 covers every non-fleet rank, not just server\'s', () => {
    // No planDispatch case elsewhere ever builds a `role: null` row; mutating the fleet-hold predicate's
    // `dispatchRank(row.role) !== 0` to `=== 1` would leave every OTHER case in this file green while a rank-2
    // row jumps the fleet — this is the one case that catches it.
    const unranked = view(fleet({ nodeId: 'null-role-id', role: null, label: 'stray', agentOps: [UPDATE_OP], ...ask('v0.0.10') }));
    const p = plan(view(fleet({ ...ask('v0.0.10'), reachable: false })), unranked);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([['null-role-id', 'waiting-for-fleet']]);
  });
});

describe('planDispatch — a fleet row that REFUSED its standing request holds nothing (D-3409, D-3378)', () => {
  // D-3378: a provenance refusal does not halt, and the request stands (decision 7) but can never move
  // (refused-by-node; auto cannot take over, D-3396). D-3381's hold must not treat that dead request as an
  // outstanding one, or a provenance refusal would halt every server move in practice.
  const provenanceFailed = (o: Partial<DispatchRow> = {}): DispatchRow =>
    fleet({ ...ask('v0.0.10'), updateState: 'failed', updateDetail: `${PROVENANCE_DETAIL_PREFIX} signature does not verify`, ...o });

  it('fleet failed provenance on the tag it was asked for: a server REQUEST for that tag moves', () => {
    const p = plan(view(provenanceFailed(), 'off', ['v0.0.10']), view(server(ask('v0.0.10'))));
    expect(p.gate.haltedBy).toEqual([]);
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, target: 'v0.0.10', source: 'request' });
    expect(p.refusals).toEqual([]);
  });

  it('fleet failed provenance on a request, server on AUTO: the server auto-moves', () => {
    const p = plan(view(provenanceFailed({ desiredTag: 'v0.0.10' }), 'stable', ['v0.0.10']), view(server({ desiredTag: 'v0.0.10' }), 'stable'));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto' });
  });

  it('a request the fleet row has NOT refused still holds the server (refusal is per tag): the fleet moves first', () => {
    const p = plan(view(provenanceFailed(), 'off', ['v0.0.11']), view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID });
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('an unreachable or capability-refused fleet row with a request still holds the server (D-3381 unchanged)', () => {
    for (const o of [{ reachable: false }, { caps: W4_CAPS.filter((c) => c !== DETACH_CAP) }] as Partial<DispatchRow>[]) {
      const p = plan(view(fleet({ ...ask('v0.0.10'), ...o }), 'off', ['v0.0.11']), view(server(ask('v0.0.10'))));
      expect(p.move, JSON.stringify(o)).toBeNull();
      expect(p.refusals.at(-1)).toMatchObject({ nodeId: SERVER_ID, refusal: 'waiting-for-fleet' });
    }
  });

  it('a fleet row whose auto desiredTag it has refused does not hold a server auto move (D-3402 side)', () => {
    const f = fleet({ desiredTag: 'v0.0.10', updateState: 'failed', updateDetail: `${PROVENANCE_DETAIL_PREFIX} x` });
    const p = plan(view(f, 'stable', ['v0.0.10']), view(server({ desiredTag: 'v0.0.10' }), 'stable'));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto' });
  });
});

describe('planDispatch — an auto server move waits for a fleet row auto has not converged (D-3402)', () => {
  const serverAuto = view(server({ desiredTag: 'v0.0.10' }), 'stable');

  it('fleet auto-eligible but unreachable: nothing moves, the server waits for the fleet', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', reachable: false }), 'stable'), serverAuto);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet auto-eligible but refused no-update-gate: the fleet is noted, the gated server still waits', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', caps: W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP) }), 'stable'), serverAuto);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-update-gate'], [SERVER_ID, 'waiting-for-fleet']]);
  });

  it('a converged fleet (desiredTag NULL) or a fleet whose own auto is off never holds it: the server auto-moves', () => {
    expect(plan(view(fleet(), 'stable'), serverAuto).move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off'), serverAuto).move).toMatchObject({ nodeId: SERVER_ID, source: 'auto' });
  });

  it("an operator's request on the server is never held by the fleet's auto — only by a fleet request", () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', reachable: false }), 'stable'), view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, source: 'request' });
    expect(p.refusals).toEqual([]);
  });
});

describe('deadlineExpired (spec §10: the later of updateStartedAt and reportedUpdatedAt)', () => {
  const D = 900_000;
  const busy = (o: Partial<DispatchRow>): DispatchRow => fleet({ updateState: 'pending', ...o });

  it('counts from updateStartedAt when the node never wrote a report — strictly after the deadline', () => {
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D - 1, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D + 1, D)).toBe(true);
  });

  it('a later report extends it; an earlier one does not shorten it', () => {
    expect(deadlineExpired(busy({ updateStartedAt: 1_000, reportedUpdatedAt: 500_000 }), 1_000 + D + 1, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000, reportedUpdatedAt: 500_000 }), 500_000 + D + 1, D)).toBe(true);
    expect(deadlineExpired(busy({ updateStartedAt: 900, reportedUpdatedAt: 100 }), 900 + D - 1, D)).toBe(false);
  });

  it('a busy row that nothing ever dated is expired; a settled row never is', () => {
    expect(deadlineExpired(busy({ updateState: 'unknown' }), 0, D)).toBe(true);
    for (const s of ['idle', 'failed', 'reverted'] as UpdateState[]) {
      expect(deadlineExpired(fleet({ updateState: s, updateStartedAt: 0 }), 10 * D, D), s).toBe(false);
    }
    expect(DEADLINE_DETAIL).toBe('deadline');
  });

  it('D-3407: a report dated far in the future cannot hold the lease past the hard cap — 4x deadline from updateStartedAt alone', () => {
    expect(UPDATE_DEADLINE_HARD_CAP_FACTOR).toBe(4);
    const started = 1_000;
    const futureReport = started + 1_000 * D;   // the node's own clock, far ahead — the later-of rule alone would never expire this row
    const row = busy({ updateStartedAt: started, reportedUpdatedAt: futureReport });
    expect(deadlineExpired(row, started + (UPDATE_DEADLINE_HARD_CAP_FACTOR - 1) * D, D)).toBe(false);
    expect(deadlineExpired(row, started + UPDATE_DEADLINE_HARD_CAP_FACTOR * D, D)).toBe(true);
  });

  it('an ordinary row (no future report) still expires by the later-of rule alone, well below the hard cap', () => {
    // Unchanged behaviour: every case above this one stays green because the hard cap is far above D+1.
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D + 1, D)).toBe(true);
    expect((UPDATE_DEADLINE_HARD_CAP_FACTOR - 1) * D).toBeGreaterThan(D + 1);
  });
});

describe('dispatchRefusalDetail — one sentence per word, stable across runs (Review Focus 5)', () => {
  it('every word renders `<word> — …` naming the node and the tag', () => {
    const v = view(fleet({ label: 'fleet-box' }));
    for (const w of DISPATCH_REFUSALS) {
      const d = dispatchRefusalDetail(w, v, 'v0.0.10', { label: 'other-box', tag: 'v0.0.11' });
      expect(d.startsWith(`${w} — `), w).toBe(true);
      expect(d, w).toContain('fleet-box');
      expect(d, w).toContain('v0.0.10');
    }
  });

  it('the two blocker words name the blocker', () => {
    const v = view(server());
    expect(dispatchRefusalDetail('waiting-for-fleet', v, 'v0.0.10', { label: 'fleet', tag: 'v0.0.11' }))
      .toBe("waiting-for-fleet — fleet's request for v0.0.11 is outstanding — server moves to v0.0.10 after it is settled or acked");
    expect(dispatchRefusalDetail('waiting-for-fleet', v, 'v0.0.10', { label: 'fleet', tag: 'v0.0.11', auto: true }))
      .toBe("waiting-for-fleet — fleet's auto update to v0.0.11 has not landed — server moves to v0.0.10 after it does, or once that node's own auto is off");
    expect(dispatchRefusalDetail('halted', v, 'v0.0.10', { label: 'fleet', tag: null })).toContain('(fleet)');
  });

  it('planning the same refused rows twice renders byte-identical notes', () => {
    const nodes = [view(fleet({ ...ask('v0.0.10'), caps: [] })), view(server(ask('v0.0.10')))];
    expect(plan(...nodes).refusals).toEqual(plan(...nodes).refusals);
  });
});

describe('the ring (programme wave 5, D-3383)', () => {
  it('dispatch.ts imports only the three shared modules and the resolver — no fs, no store, no link, no Runner', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(new Set(specs)).toEqual(new Set([
      '../../../shared/api.js', '../../../shared/agent-protocol.js', '../../../shared/semver.js', './resolve.js',
    ]));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});

// NodeRow — what `nodes()` returns — satisfies DispatchRow structurally, so the act (Task 5) hands the store's
// rows straight in. A column renamed on either side is TS2322 here (typecheck-tests.test.ts compiles this file).
const _rowFits: DispatchRow = null as unknown as NodeRow;
void _rowFits;
