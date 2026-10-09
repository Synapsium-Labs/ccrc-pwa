// Every pure decision of the box-token rotation (server/src/token/policy.ts,
// ring L1): the gate of spec 9.2, the claim door's verdict (4.6), one
// rotation's next step and its confirmations (§5), retirement, backoff, the
// phase word, and the boot-recovery proof (4.2.1). No clock, no files.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BURNED_CODES_KEPT, CLAIM_MISS_BUDGET, CLAIM_MISS_WINDOW_MS, CONFIRM_DEADLINE_MS, GRACE_HARD_MS, GRACE_MS,
  HOLD_REPROBE_MS, MAX_PENDING, PENDING_HARD_CAP, applySyncResult, backoffMs, bothRoleWriterArmed, claimVerdict, codeExpiresAt,
  confirmedGeneration, extendedGraceState, handedOutState, mintedState, nextAction, phaseOf, promotedState,
  pendingExitOpen, recoveryPlan, retireDue, rotationGate, stagedState,
  adoptedState, foreignUnderUnusableRetired, oweForRetiredPresentation, retiringDigests, retiringLanded, retiringRecorded,
  type BoxTokenState, type ClaimDoorState, type FileMetaLike, type GateInput, type GateNode, type GateVerdict,
} from '../src/token/policy.js';
import { CLAIM_CODE_TTL_MS } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE = '11111111-2222-4333-8444-555555555555';
const W = (ino: number, at = 1000) => ({ dev: 7, ino, writtenAtMs: at });

const fleetRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: NODE, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null, ...over,
});
const serverRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: 'server', nodeIdMeasured: false, label: 'server', role: 'server', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: null, updateState: 'idle', reportedPhase: null, ...over,
});
const remote = (over: Partial<GateInput> = {}): GateInput => ({
  fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false,
  nodes: [serverRow(), fleetRow()], linkUp: true, learned: null, lastReadyAt: 0,
  handedOutUnconfirmed: 0, pendingExit: false, mintFailed: false, now: 10_000_000, ...over,
});
const bothLocal = (over: Partial<GateInput> = {}): GateInput => ({
  fleetMode: 'local', role: 'both', roleSource: 'recorded', agentEnvMarksFleet: false,
  nodes: [serverRow({ role: 'both', agentOps: null })], linkUp: true, learned: null, lastReadyAt: null,
  handedOutUnconfirmed: 0, pendingExit: false, mintFailed: false, now: 10_000_000, ...over,
});
const OPEN: GateVerdict = { open: true, mode: 'remote', nodeId: NODE };
const base = (): BoxTokenState => mintedState(1000, W(1), null, null, 'c'.repeat(16));

describe('rotationGate: each mechanical condition alone holds and names itself (spec 9.2)', () => {
  it('opens with everything measured, and binds the code to the one fleet node', () => {
    expect(rotationGate(remote())).toEqual(OPEN);
  });

  it.each<[string, Partial<GateInput>, string, string | null]>([
    ['a failed boot mint', { mintFailed: true }, 'mint-failed', null],
    ['no coord', { nodes: null }, 'no-coord', null],
    ['an update pending on the server row', { nodes: [serverRow({ updateState: 'pending' }), fleetRow()] }, 'update-in-flight', 'server'],
    ['a fleet report phase in flight', { nodes: [serverRow(), fleetRow({ reportedPhase: 'installing' })] }, 'update-in-flight', 'fleet'],
    ['no fleet row', { nodes: [serverRow()] }, 'fleet-rows', null],
    ['two reachable fleet rows', { nodes: [serverRow(), fleetRow(), fleetRow({ nodeId: 'x', label: 'fleet2' })] }, 'fleet-rows', null],
    ['an unmeasured node id', { nodes: [serverRow(), fleetRow({ nodeIdMeasured: false })] }, 'node-id-unmeasured', 'fleet'],
    ['the link down', { linkUp: false }, 'link-down', 'fleet'],
    ['an agent with no op list', { nodes: [serverRow(), fleetRow({ agentOps: null })] }, 'agent-predates-op', 'fleet'],
    ['an agent whose ready lacks the op', { nodes: [serverRow(), fleetRow({ agentOps: ['update'] })] }, 'agent-predates-op', 'fleet'],
    ['caps read without the verb', { nodes: [serverRow(), fleetRow({ caps: ['update'] })] }, 'verb-missing', 'fleet'],
    ['two values handed out and unconfirmed', { handedOutUnconfirmed: MAX_PENDING }, 'pending-cap', 'fleet'],
  ])('%s', (_n, over, hold, node) => {
    expect(rotationGate(remote(over))).toEqual({ open: false, hold, node });
  });

  it('an unreachable second fleet row does not count', () => {
    expect(rotationGate(remote({ nodes: [serverRow(), fleetRow(), fleetRow({ nodeId: 'x', reachable: false })] }))).toEqual(OPEN);
  });

  it('a node with no caps file (os unknown, a deploy.sh box) is not held: the op itself probes', () => {
    expect(rotationGate(remote({ nodes: [serverRow(), fleetRow({ os: 'unknown', caps: [] })] }))).toEqual(OPEN);
  });

  it('a learned hold stands until a fresh ready or the hourly re-probe', () => {
    const learned = { hold: 'stale-client' as const, at: 5_000_000 };
    const now = 5_000_100;
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now }))).toEqual({ open: false, hold: 'stale-client', node: 'fleet' });
    expect(rotationGate(remote({ learned, lastReadyAt: 5_000_001, now }))).toEqual(OPEN);
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now: 5_000_000 + HOLD_REPROBE_MS }))).toEqual(OPEN);
    expect(rotationGate(remote({ learned: { hold: 'verb-missing', at: 5_000_000 }, lastReadyAt: null, now })))
      .toEqual({ open: false, hold: 'verb-missing', node: 'fleet' });
  });

  it('a learned agent-predates-op hold stands until a fresh ready or the hourly re-probe (D-4401)', () => {
    const learned = { hold: 'agent-predates-op' as const, at: 5_000_000 };
    const now = 5_000_100;
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now }))).toEqual({ open: false, hold: 'agent-predates-op', node: 'fleet' });
    expect(rotationGate(remote({ learned, lastReadyAt: 5_000_001, now }))).toEqual(OPEN);
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now: 5_000_000 + HOLD_REPROBE_MS }))).toEqual(OPEN);
  });

  it('a recorded both box opens in local mode with agentOps NULL', () => {
    expect(rotationGate(bothLocal())).toEqual({ open: true, mode: 'both-local', nodeId: null });
  });

  it.each<[string, Partial<GateInput>]>([
    ['the role derived (no CCRC_ROLE)', { roleSource: 'derived-absent' }],
    ['the role derived (invalid CCRC_ROLE)', { roleSource: 'derived-invalid' }],
    ['an agent.env that marks a fleet box', { agentEnvMarksFleet: true }],
    ['a recorded server role', { role: 'server' }],
  ])('local mode holds role-unrecorded with %s', (_n, over) => {
    expect(rotationGate(bothLocal(over))).toEqual({ open: false, hold: 'role-unrecorded', node: null });
  });

  it('a both box holds on its own update in flight and its own missing verb', () => {
    expect(rotationGate(bothLocal({ nodes: [serverRow({ role: 'both', updateState: 'applying' })] })))
      .toEqual({ open: false, hold: 'update-in-flight', node: 'server' });
    expect(rotationGate(bothLocal({ nodes: [serverRow({ role: 'both', caps: [] })] })))
      .toEqual({ open: false, hold: 'verb-missing', node: 'server' });
  });

  it('bothRoleWriterArmed: recorded both, local mode, no fleet-marking agent.env — and nothing else', () => {
    const ok = { role: 'both', roleSource: 'recorded', fleetMode: 'local', agentEnvMarksFleet: false } as const;
    expect(bothRoleWriterArmed(ok)).toBe(true);
    expect(bothRoleWriterArmed({ ...ok, roleSource: 'derived-absent' })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, fleetMode: 'remote' })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, agentEnvMarksFleet: true })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, role: 'fleet' })).toBe(false);
  });
});

describe('the hold rule (R1 as amended by R5): one gate for every trigger, auto never read', () => {
  it('the gate has no trigger, auto or intent input', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'policy.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function rotationGate('), src.indexOf('// ── the claim door'));
    expect(body.length, 'the scan slice must not be empty (a renamed function or marker would pass vacuously)').toBeGreaterThan(200);
    expect(body).not.toMatch(/\bauto\b|\bintent\b|\btrigger\b|rotateRequested/);
    expect(Object.keys(remote()).sort()).toEqual(['agentEnvMarksFleet', 'fleetMode', 'handedOutUnconfirmed', 'lastReadyAt',
      'learned', 'linkUp', 'mintFailed', 'nodes', 'now', 'pendingExit', 'role', 'roleSource']);
  });

  it('an owed rotation and "Rotate now" stage on the same open gate, and both hold on the same closed one', () => {
    const owed: BoxTokenState = { ...base(), rotationOwed: true, owedWhy: 'adopted' };
    const held = rotationGate(remote({ nodes: [serverRow(), fleetRow({ updateState: 'applying' })] }));
    for (const [state, rotateRequested] of [[owed, false], [base(), true]] as const) {
      expect(nextAction({ state, gate: OPEN, generation: null, rotateRequested, backoffUntil: null, now: 2000 }).kind).toBe('stage');
      expect(nextAction({ state, gate: held, generation: null, rotateRequested, backoffUntil: null, now: 2000 }))
        .toEqual({ kind: 'hold', hold: 'update-in-flight', node: 'fleet' });
    }
  });
});

describe('claimVerdict (spec 4.6)', () => {
  const door = (over: Partial<ClaimDoorState> = {}): ClaimDoorState => ({
    live: [{ digest: 'd1', generation: 'g1', nodeId: NODE, expiresAt: codeExpiresAt(1000) }],
    burned: [], misses: { windowStart: 0, count: 0 }, ...over,
  });

  it('a live code within its TTL and bound to the node answers 200 once and is burned', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, NODE, 2000);
    expect(r.reply).toEqual({ status: 200, error: null, generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.next.burned).toEqual([{ digest: 'd1', generation: 'g1', at: 2000 }]);
    expect(r.alert).toBeNull();
  });

  it('a live code is served even with the miss budget used up, and misses never burn it', () => {
    let s = door();
    for (let i = 0; i < 1000; i++) s = claimVerdict(s, { kind: 'none' }, NODE, 2000).next;
    expect(claimVerdict(s, { kind: 'none' }, NODE, 2000).reply.status).toBe(429);
    expect(s.live).toHaveLength(1);
    expect(claimVerdict(s, { kind: 'live', index: 0 }, NODE, 2000).reply.status).toBe(200);
  });

  it('misses: 404 (or 400 malformed) until the budget, 429 past it, a fresh window resets', () => {
    let s = door();
    for (let i = 0; i < CLAIM_MISS_BUDGET; i++) {
      const r = claimVerdict(s, i % 2 ? { kind: 'none' } : { kind: 'malformed' }, NODE, 2000);
      expect(r.reply.status).toBe(i % 2 ? 404 : 400);
      s = r.next;
    }
    expect(claimVerdict(s, { kind: 'malformed' }, NODE, 2000).reply).toEqual({ status: 429, error: 'rate-limited', generation: null });
    expect(claimVerdict(s, { kind: 'none' }, NODE, CLAIM_MISS_WINDOW_MS + 1).reply.status).toBe(404);
  });

  it('past its TTL (TTL plus one second) a live code is burned as code-expired, with an alert', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, NODE, 1000 + CLAIM_CODE_TTL_MS + 1000);
    expect(r.reply).toEqual({ status: 410, error: 'code-expired', generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.alert).toEqual({ kind: 'expired', generation: 'g1' });
  });

  it('a live code presented with another node id is burned as wrong-node (403)', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, 'other', 2000);
    expect(r.reply).toEqual({ status: 403, error: 'wrong-node', generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.alert).toEqual({ kind: 'wrong-node', generation: 'g1' });
  });

  it('a replay of a burned code is 410 code-used and changes nothing', () => {
    const s = door({ live: [], burned: [{ digest: 'd1', generation: 'g1', at: 2000 }] });
    const r = claimVerdict(s, { kind: 'burned', index: 0 }, NODE, 3000);
    expect(r.reply).toEqual({ status: 410, error: 'code-used', generation: 'g1' });
    expect(r.next).toBe(s);
    expect(r.alert).toEqual({ kind: 'replay', generation: 'g1' });
  });

  it('keeps at most BURNED_CODES_KEPT burned codes', () => {
    let s = door({ live: Array.from({ length: 12 }, (_, i) => ({ digest: `d${i}`, generation: `g${i}`, nodeId: NODE, expiresAt: 1e12 })) });
    for (let i = 0; i < 12; i++) s = claimVerdict(s, { kind: 'live', index: 0 }, NODE, 2000).next;
    expect(s.burned).toHaveLength(BURNED_CODES_KEPT);
  });
});

describe('one rotation', () => {
  const G = '1'.repeat(16);
  const G2 = '2'.repeat(16);
  const staged = (): BoxTokenState => stagedState({ ...base(), rotationOwed: true, owedWhy: 'adopted' }, G, 2000, W(2));
  const handed = (at = 3000): BoxTokenState => handedOutState(staged(), G, at);

  it('stages, then sends the STAGED generation — never the current one, also for a fleet box that is behind', () => {
    const behind = { read: { kind: 'absent' as const }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: behind, rotateRequested: false, backoffUntil: null, now: 5000 }))
      .toEqual({ kind: 'stage', why: 'fleet-behind' });
    const other = { read: { kind: 'id' as const, id: 'f'.repeat(16) }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: other, rotateRequested: false, backoffUntil: null, now: 5000 }).kind).toBe('stage');
    const a = nextAction({ state: staged(), gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 5000 });
    expect(a).toEqual({ kind: 'send', generation: G, nodeId: NODE });
    expect(a.kind === 'send' && a.generation).not.toBe(base().current.id);
  });

  it('a fresh minted current with an absent fleet read stages fleet-behind (a new two-box install hands the fleet its first value)', () => {
    // Plan assembly (review, critical): a server-minted value carries a generation id, so a fleet box with no file
    // reads `behind` and the forward rotation hands it a value through the claim door. With `current.id` null this
    // returned `none` and the fleet box never received a token.
    const fresh = mintedState(1000, W(1), null, null, 'd'.repeat(16));
    expect([fresh.current.id, fresh.rotationOwed]).toEqual(['d'.repeat(16), false]);
    const absent = { read: { kind: 'absent' as const }, measuredAt: 5000 };
    expect(nextAction({ state: fresh, gate: OPEN, generation: absent, rotateRequested: false, backoffUntil: null, now: 5000 }))
      .toEqual({ kind: 'stage', why: 'fleet-behind' });
  });

  it('an unreadable generation read is never "behind"', () => {
    const r = { read: { kind: 'unreadable' as const }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: r, rotateRequested: false, backoffUntil: null, now: 5000 })).toEqual({ kind: 'none' });
  });

  it('promotion only on fleet confirmation: the op result for the outstanding, handed-out request', () => {
    expect(applySyncResult(handed(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBe(G);
    // not outstanding (already discarded), another id, or never handed out: nothing is promoted
    expect(applySyncResult(base(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBeNull();
    expect(applySyncResult(handed(), G, { kind: 'synced', generation: G2, transport: 'https' }, 4000).promote).toBeNull();
    expect(applySyncResult(staged(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBeNull();
  });

  it('promotion only on fleet confirmation: a generation read naming the issued id, measured after the hand-out', () => {
    const at = (id: string, measuredAt: number) => ({ read: { kind: 'id' as const, id }, measuredAt });
    expect(confirmedGeneration(handed(3000), at(G, 3001))).toBe(G);
    expect(confirmedGeneration(handed(3000), at(G, 3000))).toBeNull();
    expect(confirmedGeneration(handed(3000), at(G, 2999))).toBeNull();
    expect(confirmedGeneration(handed(3000), at('9'.repeat(16), 4000))).toBeNull();
    expect(confirmedGeneration(staged(), at(G, 4000))).toBeNull();
    expect(nextAction({ state: handed(3000), gate: OPEN, generation: at(G, 3001), rotateRequested: false, backoffUntil: null, now: 3001 }))
      .toEqual({ kind: 'promote', generation: G, via: 'generation-read' });
  });

  it('a handed-out value waits for its confirmation: no promotion, no second rotation, "Rotate now" joins', () => {
    for (const rotateRequested of [false, true]) {
      expect(nextAction({ state: handed(3000), gate: OPEN, generation: null, rotateRequested, backoffUntil: null, now: 3000 + CONFIRM_DEADLINE_MS }))
        .toEqual({ kind: 'none' });
    }
  });

  it('handed-out deadline without a fleet 401: held past its deadline, still pending; a forward rotation discards it once confirmed', () => {
    const late = 3000 + CONFIRM_DEADLINE_MS + 1;
    const down = rotationGate(remote({ linkUp: false }));
    const s = handed(3000);
    expect(nextAction({ state: s, gate: down, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'hold', hold: 'link-down', node: 'fleet' });
    expect(s.pending.map((p) => p.id)).toEqual([G]);           // still accepted
    // the forward rotation once the link is back
    const fwd = { ...s, rotationOwed: false, owedWhy: null };
    expect(nextAction({ state: fwd, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'stage', why: 'confirm-deadline' });
    const two = handedOutState(stagedState(fwd, G2, late, W(3)), G2, late + 1);
    expect(two.pending.map((p) => p.id)).toEqual([G, G2]);
    const r = applySyncResult(two, G2, { kind: 'synced', generation: G2, transport: 'https' }, late + 2);
    expect(r.promote).toBe(G2);
    const after = promotedState(r.state, G2, late + 2, W(4));
    expect(after.pending).toEqual([]);                            // G is discarded only now
    expect(after.current.id).toBe(G2);
  });

  it('promotedState: G current, the old current previous with grace and hard bound, the owed flag cleared', () => {
    const p = promotedState(handed(), G, 5000, W(9));
    expect(p.current).toEqual({ id: G, seq: 2, since: 5000, write: W(2) });
    expect(p.previous).toEqual({ id: 'c'.repeat(16), seq: 1, graceUntil: 5000 + GRACE_MS, hardUntil: 5000 + GRACE_HARD_MS, currentPresented: false, write: W(9) });
    expect([p.origin, p.rotationOwed, p.owedWhy, p.fleetConfirmed, p.lastRotationAt, p.promoting]).toEqual(['rotated', false, null, G, 5000, null]);
  });

  // Final review I2 (D-4409 item 6): the policy decides what a promotion counts as a presentation of the new current.
  it('promotedState: an own-write promotion, or a generation already presented while pending, records the new current as presented', () => {
    expect(promotedState(handed(), G, 5000, W(9)).previous?.currentPresented).toBe(false);
    expect(promotedState(handed(), G, 5000, W(9), { via: 'op-result', presented: false }).previous?.currentPresented).toBe(false);
    expect(promotedState(handed(), G, 5000, W(9), { via: 'own-write' }).previous?.currentPresented).toBe(true);
    expect(promotedState(handed(), G, 5000, W(9), { via: 'op-result', presented: true }).previous?.currentPresented).toBe(true);
    expect(promotedState(handed(), G, 5000, W(9), { via: 'generation-read', presented: true }).previous?.currentPresented).toBe(true);
  });

  it.each<[string, Parameters<typeof applySyncResult>[2], Partial<BoxTokenState>, string | null]>([
    ['stale-client is a learned hold, not a failure', { kind: 'refused', word: 'stale-client', detail: null }, { failures: 0 }, 'stale-client'],
    ['a ccrc without the verb is a learned hold (D-4395)', { kind: 'refused', word: 'spawn-failed', detail: 'ccrc: unknown argument: token' }, { failures: 0 }, 'verb-missing'],
    ['no launcher at all is the same hold (D-4395)', { kind: 'refused', word: 'spawn-failed', detail: 'could not start the launcher: ENOENT' }, { failures: 0 }, 'verb-missing'],
    ['any other spawn-failed is a failure', { kind: 'refused', word: 'spawn-failed', detail: 'boom' }, { failures: 1, lastFailure: 'spawn-failed' }, null],
    ['a lost result is a failure', { kind: 'lost', why: 'timeout' }, { failures: 1, lastFailure: 'timeout' }, null],
    ['an unsent request is not a failure', { kind: 'unsent' }, { failures: 0 }, null],
  ])('%s', (_n, r, expectState, learned) => {
    const out = applySyncResult(staged(), G, r, 4000);
    expect(out.state).toMatchObject(expectState);
    expect(out.learned?.hold ?? null).toBe(learned);
    expect(out.state.pending, 'a value never handed out is dropped').toEqual([]);
  });

  it('a handed-out value survives a lost result and a write or proof failure (the fleet may hold it)', () => {
    for (const r of [{ kind: 'lost', why: 'disconnected' }, { kind: 'refused', word: 'write-failed', detail: null },
      { kind: 'refused', word: 'proof-unmeasured', detail: null }] as const) {
      expect(applySyncResult(handed(), G, r, 4000).state.pending.map((p) => p.id)).toEqual([G]);
    }
  });

  it('code-used discards even a handed-out value and owes a rotation', () => {
    const out = applySyncResult({ ...handed(), rotationOwed: false, owedWhy: null }, G, { kind: 'refused', word: 'code-used', detail: null }, 4000);
    expect(out.state.pending).toEqual([]);
    expect([out.state.rotationOwed, out.state.owedWhy]).toEqual([true, 'code-used']);
  });

  it('predates-op is learned as the agent-predates-op hold, never a failure (D-4401)', () => {
    const out = applySyncResult(staged(), G, { kind: 'predates-op' }, 4000);
    expect(out.learned).toEqual({ hold: 'agent-predates-op', at: 4000 });
    expect([out.state.failures, out.state.lastFailure]).toEqual([0, null]);
    expect(out.promote).toBeNull();
    expect(out.state.pending, 'a value never handed out is dropped').toEqual([]);
    // handed out: kept (the fleet may hold it), still learned
    const kept = applySyncResult(handed(), G, { kind: 'predates-op' }, 4000);
    expect(kept.learned?.hold).toBe('agent-predates-op');
    expect(kept.state.pending.map((p) => p.id)).toEqual([G]);
  });

  it('promoting an earlier handed-out value keeps a LATER handed-out one accepted (D-4400)', () => {
    // G handed out and its result lost; past confirmBy a forward rotation hands out G2, result lost too.
    const late = 3000 + CONFIRM_DEADLINE_MS + 1;
    const fwd = { ...handed(3000), rotationOwed: false, owedWhy: null };
    const two = handedOutState(stagedState(fwd, G2, late, W(3)), G2, late + 1);
    // a generation read still showing G, measured after G's hand-out, promotes G
    const read = { read: { kind: 'id' as const, id: G }, measuredAt: late + 2 };
    expect(confirmedGeneration(two, read)).toBe(G);
    const act = nextAction({ state: two, gate: OPEN, generation: read, rotateRequested: false, backoffUntil: null, now: late + 2 });
    expect(act).toEqual({ kind: 'promote', generation: G, via: 'generation-read' });
    const after = promotedState(two, G, late + 2, W(4));
    expect(after.current.id).toBe(G);
    expect(after.pending.map((p) => [p.id, p.handedOutAt !== null])).toEqual([[G2, true]]);
    // G2's later confirmation promotes it normally and clears the rest
    const read2 = { read: { kind: 'id' as const, id: G2 }, measuredAt: late + 10 };
    expect(confirmedGeneration(after, read2)).toBe(G2);
    const done = promotedState(after, G2, late + 10, W(5));
    expect([done.current.id, done.pending, done.previous?.id]).toEqual([G2, [], G]);
  });

  it('promotion drops earlier values and later values never handed out (D-4400)', () => {
    const G3 = '3'.repeat(16);
    const s0 = handedOutState(stagedState(handed(3000), G2, 4000, W(3)), G2, 4001);   // G (seq 2), G2 (seq 3) both handed out
    const s1 = stagedState(s0, G3, 4002, W(4));                                       // G3 staged only
    expect(promotedState(s1, G2, 5000, W(9)).pending).toEqual([]);                    // G earlier, G3 never handed out
    expect(promotedState(s1, G, 5000, W(9)).pending.map((p) => p.id)).toEqual([G2]); // G3 dropped, G2 kept
  });

  it('"Rotate now" bypasses backoff also while a rotation is owed (D-4402)', () => {
    const owed = { ...base(), rotationOwed: true, owedWhy: 'adopted' as const, failures: 2 };
    expect(nextAction({ state: owed, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: 9000, now: 5000 }))
      .toEqual({ kind: 'backoff', until: 9000 });
    expect(nextAction({ state: owed, gate: OPEN, generation: null, rotateRequested: true, backoffUntil: 9000, now: 5000 }))
      .toEqual({ kind: 'stage', why: 'adopted' });
  });

  it('a both box promotes a staged value by its own write', () => {
    expect(nextAction({ state: staged(), gate: rotationGate(bothLocal()), generation: null, rotateRequested: false, backoffUntil: null, now: 3000 }))
      .toEqual({ kind: 'promote', generation: G, via: 'own-write' });
  });

  it('backs off after a failure, except for "Rotate now"', () => {
    const owed = { ...base(), rotationOwed: true, owedWhy: 'adopted' as const, failures: 1 };
    expect(nextAction({ state: owed, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: 9000, now: 5000 }))
      .toEqual({ kind: 'backoff', until: 9000 });
    expect(nextAction({ state: base(), gate: OPEN, generation: null, rotateRequested: true, backoffUntil: 9000, now: 5000 }).kind).toBe('stage');
  });
});

describe('retirement needs presentation (spec §5)', () => {
  const prev = (over: Partial<NonNullable<BoxTokenState['previous']>> = {}) =>
    ({ id: 'c'.repeat(16), seq: 1, graceUntil: 10_000, hardUntil: 50_000, currentPresented: false, write: W(9), ...over });

  it('no before grace; grace once passed and presented; extend while not presented; hard-bound at the hard bound', () => {
    expect(retireDue(prev(), 9_999)).toBe('no');
    expect(retireDue(prev({ currentPresented: true }), 9_999)).toBe('no');
    expect(retireDue(prev({ currentPresented: true }), 10_000)).toBe('grace');
    expect(retireDue(prev(), 10_000)).toBe('extend');
    expect(retireDue(prev(), 50_000)).toBe('hard-bound');
  });

  it('an extended grace owes a forward rotation and never passes the hard bound', () => {
    const s = extendedGraceState({ ...base(), previous: prev() }, 48_000);
    expect(s.previous?.graceUntil).toBe(50_000);
    expect([s.rotationOwed, s.owedWhy]).toEqual([true, 'fleet-behind']);
  });

  it('nextAction retires on grace or at the hard bound, and extends otherwise', () => {
    const at = (p: ReturnType<typeof prev>, now: number) =>
      nextAction({ state: { ...base(), previous: p }, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now });
    expect(at(prev({ currentPresented: true }), 10_000)).toEqual({ kind: 'retire', why: 'grace' });
    expect(at(prev(), 10_000)).toEqual({ kind: 'extend-grace' });
    expect(at(prev(), 50_000)).toEqual({ kind: 'retire', why: 'hard-bound' });
  });
});

describe('backoffMs and phaseOf', () => {
  it('60 s doubling, capped at one hour; none without failures', () => {
    expect([0, 1, 2, 3, 7, 40].map(backoffMs)).toEqual([0, 60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });

  it('restart from each phase: the persisted state names its phase and its next step', () => {
    const G = '1'.repeat(16);
    const st = stagedState(base(), G, 2000, W(2));
    const ho = handedOutState(st, G, 3000);
    const promoting = { ...ho, promoting: { id: G } };
    const grace = promotedState(ho, G, 4000, W(9));
    const owed = { ...base(), rotationOwed: true, owedWhy: 'recovered' as const };
    const cases: [BoxTokenState, string, string][] = [
      [base(), 'idle', 'none'], [st, 'staged', 'send'], [ho, 'handed-out', 'none'],
      [promoting, 'promoting', 'promote'], [grace, 'grace', 'none'], [owed, 'idle', 'stage'],
      [{ ...owed, failures: 2 }, 'failed', 'stage'],
    ];
    for (const [s, phase, action] of cases) {
      expect(phaseOf(s, null, true)).toBe(phase);
      expect(nextAction({ state: s, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 4500 }).kind).toBe(action);
    }
    expect(phaseOf(base(), 'link-down', true)).toBe('held');
    expect(phaseOf(base(), null, false)).toBe('unconfigured');
    expect(nextAction({ state: null, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 1 }))
      .toEqual({ kind: 'retry-mint' });
  });
});

describe('recoveryPlan: the 4.2.1 proof, metadata only', () => {
  const meta = (ino: number, mtimeMs = 900, kind: 'regular' | 'symlink' = 'regular') => ({ dev: 7, ino, mtimeMs, mode: 0o600, kind });
  const broken = (ino = 1, mtimeMs = 900, kind: 'regular' | 'symlink' = 'regular'): FileMetaLike =>
    ({ meta: meta(ino, mtimeMs, kind), usable: false, placeholder: false, digest: null });
  const good = (ino: number, digest = 'p'.repeat(64)): FileMetaLike => ({ meta: meta(ino), usable: true, placeholder: false, digest });
  const rotated = (): BoxTokenState => ({ ...base(), origin: 'rotated',
    previous: { id: null, seq: 0, graceUntil: 9e12, hardUntil: 9e12, currentPresented: false, write: W(5) } });

  it('recovers from the previous file when every check holds', () => {
    expect(recoveryPlan({ state: rotated(), current: broken(), pending: null, previous: good(5), retired: [] })).toEqual({ kind: 'from-previous' });
  });

  it('finishes a recorded promotion from its pending file first', () => {
    const G = '1'.repeat(16);
    const s = { ...handedOutState(stagedState(rotated(), G, 2000, W(6)), G, 3000), promoting: { id: G } };
    expect(recoveryPlan({ state: s, current: broken(), pending: good(6), previous: good(5), retired: [] })).toEqual({ kind: 'finish-promotion', id: G });
  });

  it.each<[string, Partial<Parameters<typeof recoveryPlan>[0]>]>([
    ['no state file', { state: null }],
    ['origin adopted', { state: { ...rotated(), origin: 'adopted' } }],
    ['mail.token replaced with a new inode', { current: broken(2) }],
    ['an in-place edit with a later mtime', { current: broken(1, 1001) }],
    ['mail.token a symlink', { current: broken(1, 900, 'symlink') }],
    ['the previous file holding a retired value', { retired: ['p'.repeat(64)] }],
    ['the previous file a new inode', { previous: good(8) }],
    ['the previous file unusable', { previous: { ...good(5), usable: false, digest: null } }],
    ['a handed-out pending file as the only sibling', { previous: null, pending: good(6) }],
  ])('refuses: %s', (_n, over) => {
    const i = { state: rotated(), current: broken(), pending: null, previous: good(5), retired: [] as string[], ...over };
    expect(recoveryPlan(i)).toEqual({ kind: 'refuse' });
  });

  it('an ABSENT mail.token (meta null) skips the current-file proof and keeps the sibling proof', () => {
    const absent: FileMetaLike = { meta: null, usable: false, placeholder: false, digest: null };
    expect(recoveryPlan({ state: rotated(), current: absent, pending: null, previous: good(5), retired: [] })).toEqual({ kind: 'from-previous' });
    expect(recoveryPlan({ state: rotated(), current: absent, pending: null, previous: good(8), retired: [] })).toEqual({ kind: 'refuse' });
  });
});

describe('ring L1', () => {
  it('policy.ts imports nothing but shared/', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'policy.ts'), 'utf8');
    const froms = [...src.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const f of froms) expect(f, f).toMatch(/^\.\.\/\.\.\/\.\.\/shared\/[a-z-]+\.js$/);
  });
});

// ── fix round 1, batch 1: D-4413 (the pending cap's exit), F3(c), F7 ─────────────────────────────────────────────
describe('the pending cap has an exit (D-4413)', () => {
  const ids = ['1', '2', '3', '4'].map((c) => c.repeat(16));
  /** `n` pending generations handed out at `at`; each confirmBy is `at + CONFIRM_DEADLINE_MS`. */
  const handedOutN = (n: number, at = 3000): BoxTokenState => {
    let s: BoxTokenState = { ...base(), rotationOwed: true, owedWhy: 'adopted' };
    for (let i = 0; i < n; i++) s = handedOutState(stagedState(s, ids[i], 2000, W(2 + i)), ids[i], at + i);
    return s;
  };

  it('the cap constants: two handed-out values hold the gate, three pending is the hard bound', () => {
    expect([MAX_PENDING, PENDING_HARD_CAP]).toEqual([2, 3]);
  });

  it('pendingExitOpen: exactly the two cap values, both strictly past confirmBy', () => {
    const s = handedOutN(2);                                               // confirmBy 3000+300000 and 3001+300000
    const last = s.pending[1].confirmBy as number;
    expect(pendingExitOpen(s.pending, last)).toBe(false);                  // the second still waits AT its deadline (nextAction's `now <= confirmBy`)
    expect(pendingExitOpen(s.pending, last + 1)).toBe(true);
    expect(pendingExitOpen(s.pending, (s.pending[0].confirmBy as number) + 1)).toBe(false);   // one waiting
    expect(pendingExitOpen(handedOutN(1).pending, 9_999_999)).toBe(false);                    // below the cap: no exit needed
    expect(pendingExitOpen(handedOutN(3).pending, 9_999_999)).toBe(false);                    // the third slot is in use: never a fourth
    const withStaged = stagedState(s, ids[2], last + 5, W(9));             // the exit's own staged value is not a cap value
    expect(pendingExitOpen(withStaged.pending, last + 6)).toBe(true);
    expect(pendingExitOpen([], 1)).toBe(false);
  });

  it('the gate: two handed out hold pending-cap unless the exit is open; three always hold', () => {
    expect(rotationGate(remote({ handedOutUnconfirmed: 2, pendingExit: false }))).toEqual({ open: false, hold: 'pending-cap', node: 'fleet' });
    expect(rotationGate(remote({ handedOutUnconfirmed: 2, pendingExit: true }))).toEqual(OPEN);
    expect(rotationGate(remote({ handedOutUnconfirmed: 3, pendingExit: true }))).toEqual({ open: false, hold: 'pending-cap', node: 'fleet' });
    expect(rotationGate(remote({ handedOutUnconfirmed: 1, pendingExit: true }))).toEqual(OPEN);
  });

  it('nextAction never stages a fourth pending value, whatever the gate says', () => {
    const three = handedOutN(3);
    const owed = { ...three, rotationOwed: true, owedWhy: 'adopted' as const };
    const late = 3000 + 3 * CONFIRM_DEADLINE_MS;
    expect(nextAction({ state: owed, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'hold', hold: 'pending-cap', node: null });
  });

  it('two overdue handed-out values stage the exit rotation once the gate is open', () => {
    const two = handedOutN(2);
    const late = (two.pending[1].confirmBy as number) + 1;
    expect(nextAction({ state: two, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'stage', why: 'adopted' });
  });

  it("the exit's confirmation drops both older values (the existing later-confirmed rule)", () => {
    const withExit = handedOutState(stagedState(handedOutN(2), ids[2], 400_000, W(7)), ids[2], 400_001);
    expect(withExit.pending).toHaveLength(3);
    const done = promotedState(withExit, ids[2], 500_000, W(9));
    expect(done.pending).toEqual([]);
    expect(done.current.id).toBe(ids[2]);
  });
});

describe('F3(c): the own-write promote waits out the backoff', () => {
  const G = '1'.repeat(16);
  const staged = (): BoxTokenState => stagedState({ ...base(), rotationOwed: true, owedWhy: 'adopted' }, G, 2000, W(2));

  it('a staged value on a both box is not promoted while a backoff stands, and is when it ends', () => {
    const gate = rotationGate(bothLocal());
    expect(nextAction({ state: staged(), gate, generation: null, rotateRequested: false, backoffUntil: 9000, now: 5000 }))
      .toEqual({ kind: 'backoff', until: 9000 });
    expect(nextAction({ state: staged(), gate, generation: null, rotateRequested: false, backoffUntil: 9000, now: 9000 }))
      .toEqual({ kind: 'promote', generation: G, via: 'own-write' });
    expect(nextAction({ state: staged(), gate, generation: null, rotateRequested: false, backoffUntil: null, now: 5000 }))
      .toEqual({ kind: 'promote', generation: G, via: 'own-write' });
  });
});

// D-4414 (review 352 F2): on a recorded both box a staged own-write generation that keeps failing must never keep the
// previous value from being retired (and its digest recorded) at its hard bound.
describe('D-4414 F2: the hard bound retires the previous value before the own-write branch', () => {
  const G = '1'.repeat(16);
  const staged = (): BoxTokenState => ({ ...stagedState({ ...base(), rotationOwed: true, owedWhy: 'adopted' }, G, 2000, W(2)),
    previous: { id: null, seq: 0, graceUntil: 5000, hardUntil: 9000, currentPresented: true, write: W(3) } });
  const gate = rotationGate(bothLocal());
  const ask = (now: number, backoffUntil: number | null, retireHeld?: boolean) =>
    nextAction({ state: staged(), gate, generation: null, rotateRequested: false, backoffUntil, now, ...(retireHeld === undefined ? {} : { retireHeld }) });

  it('past hardUntil with a staged own-write generation (in a backoff or not) the answer is retire, not promote or backoff', () => {
    expect(ask(9000, null)).toEqual({ kind: 'retire', why: 'grace' });
    expect(ask(9500, 99_000)).toEqual({ kind: 'retire', why: 'grace' });
    const unpresented = { ...staged(), previous: { ...(staged().previous as NonNullable<BoxTokenState['previous']>), currentPresented: false } };
    expect(nextAction({ state: unpresented, gate, generation: null, rotateRequested: false, backoffUntil: 99_000, now: 9500 }))
      .toEqual({ kind: 'retire', why: 'hard-bound' });
  });

  it('before hardUntil the own-write branch still goes first (grace alone does not pre-empt it)', () => {
    expect(ask(6000, null)).toEqual({ kind: 'promote', generation: G, via: 'own-write' });
    expect(ask(6000, 99_000)).toEqual({ kind: 'backoff', until: 99_000 });
  });

  it('a retirement the driver could not do this tick (retireHeld) does not block the own-write branch', () => {
    expect(ask(9500, null, true)).toEqual({ kind: 'promote', generation: G, via: 'own-write' });
    expect(ask(9500, 99_000, true)).toEqual({ kind: 'backoff', until: 99_000 });
  });
});

describe('F7: the timings that bound a live re-probe are pinned by value', () => {
  it('HOLD_REPROBE_MS is one hour (a 55-minute re-probe is faster than the plan, and reds here)', () => {
    expect(HOLD_REPROBE_MS).toBe(60 * 60_000);
  });
});

// ── D-4410: the retired digest is durable in box-token.json until the retired file has it ──
describe('D-4410: the retiring record (a digest in box-token.json until the append lands)', () => {
  const D1 = 'a'.repeat(64);
  const D2 = 'b'.repeat(64);

  it('retiringRecorded adds a digest once; retiringLanded removes exactly the landed ones; neither touches the rest', () => {
    const s = base();
    const a = retiringRecorded(s, D1, 5000);
    expect(a.retiring).toEqual([{ sha256: D1, at: 5000 }]);
    expect(retiringRecorded(a, D1, 6000).retiring).toEqual([{ sha256: D1, at: 5000 }]);   // deduplicated, the first stamp kept
    const b = retiringRecorded(a, D2, 6000);
    expect(retiringDigests(b)).toEqual([D1, D2]);
    expect(retiringLanded(b, [D1]).retiring).toEqual([{ sha256: D2, at: 6000 }]);
    expect(retiringLanded(b, [D1, D2]).retiring).toEqual([]);
    expect(retiringLanded(b, []).retiring).toEqual(b.retiring);
    expect(retiringDigests(s)).toEqual([]);                                              // absent reads as empty
  });

  it('a minted or adopted state over a prior one keeps its retiring record (a digest is never dropped by a re-mint)', () => {
    const prior = retiringRecorded(base(), D1, 5000);
    expect(mintedState(9000, W(3), prior, 'recovered', 'd'.repeat(16)).retiring).toEqual([{ sha256: D1, at: 5000 }]);
    expect(adoptedState(9000, prior).retiring).toEqual([{ sha256: D1, at: 5000 }]);
  });

  it('foreignUnderUnusableRetired: with an unusable retired file, only a current the server wrote stays; otherwise it is foreign', () => {
    const w = W(7, 5000);
    const proved: FileMetaLike = { meta: { dev: 7, ino: 7, mtimeMs: 4000, mode: 0o600, kind: 'regular' }, usable: true, placeholder: false, digest: 'c'.repeat(64) };
    const rewritten: FileMetaLike = { ...proved, meta: { ...(proved.meta as NonNullable<FileMetaLike['meta']>), ino: 8 } };
    const s: BoxTokenState = { ...base(), origin: 'rotated', current: { id: 'c'.repeat(16), seq: 2, since: 1, write: w } };
    expect(foreignUnderUnusableRetired({ retiredUnusable: true, state: s, current: proved })).toBe(false);      // server-written: stays
    expect(foreignUnderUnusableRetired({ retiredUnusable: true, state: s, current: rewritten })).toBe(true);    // written back by someone else
    expect(foreignUnderUnusableRetired({ retiredUnusable: true, state: null, current: proved })).toBe(true);    // no write record at all
    expect(foreignUnderUnusableRetired({ retiredUnusable: true, state: adoptedState(1, null), current: proved })).toBe(true);   // an adopted current has no record
    expect(foreignUnderUnusableRetired({ retiredUnusable: false, state: s, current: rewritten })).toBe(false);  // a usable list decides as before
    expect(foreignUnderUnusableRetired({ retiredUnusable: false, state: null, current: proved })).toBe(false);
  });
});

// ── D-4412: a retired value presented on a box-token lane owes one forward rotation, within a bound ──
describe('D-4412: a retired presentation owes one forward rotation, bounded', () => {
  const idle = (): BoxTokenState => ({ ...base(), origin: 'rotated' });
  const ask = (over: Partial<Parameters<typeof oweForRetiredPresentation>[0]> = {}) =>
    oweForRetiredPresentation({ state: idle(), fresh: 1, busy: false, lastOwedAt: null, now: 10_000_000, ...over });

  it('a new retired presentation on an idle, nothing-owed state owes the word retired-presented', () => {
    expect(ask()).toMatchObject({ rotationOwed: true, owedWhy: 'retired-presented' });
  });

  it('nothing is owed for no new presentation', () => {
    expect(ask({ fresh: 0 })).toBeNull();
  });

  it('nothing new is owed while a rotation is already owed, and the standing reason is never replaced', () => {
    expect(ask({ state: { ...idle(), rotationOwed: true, owedWhy: 'adopted' } })).toBeNull();
  });

  it.each([
    ['a staged value', (s: BoxTokenState) => stagedState(s, '1'.repeat(16), 2000, W(2))],
    ['a handed-out value', (s: BoxTokenState) => handedOutState(stagedState(s, '1'.repeat(16), 2000, W(2)), '1'.repeat(16), 2500)],
    ['a recorded promotion', (s: BoxTokenState) => ({ ...s, promoting: { id: '1'.repeat(16) } })],
  ])('nothing new is owed while a rotation is in flight: %s', (_n, mk) => {
    expect(ask({ state: mk(idle()) })).toBeNull();
  });

  it('nothing new is owed while a send or a promotion is running (the driver feeds it)', () => {
    expect(ask({ busy: true })).toBeNull();
  });

  it('at most one per HOLD_REPROBE_MS: just inside the bound owes nothing, at it owes again', () => {
    const last = 8_000_000;
    expect(ask({ lastOwedAt: last, now: last + HOLD_REPROBE_MS - 1 })).toBeNull();
    expect(ask({ lastOwedAt: last, now: last + HOLD_REPROBE_MS })).toMatchObject({ owedWhy: 'retired-presented' });
  });
});
