// Delegation broker wave 5, PR7 (Task 5.7.2): the adoption decider, fed `now` (plan "## PR7", rules 1 to 9, W5-D1..W5-D21).
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  DELEGATION_ADOPTABLE_SOURCES, DELEGATION_ADOPT_SETTLE_MS, DELEGATION_AUDITS_PER_PASS, DELEGATION_HOLD_CLOSING, DELEGATION_REMINDER_LEAD_MS,
  adoptTerminalEvidenceAt, adoptionCarrierReads, buildLeaseDigest, buildLeaseReminder, decideAdoption, leaseRecipient, owedLeaseNotices,
  parseLeaseAuditAnswer, type AdoptionInput, type ParentFact,
} from '../src/coord/delegation-adoption.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { leaseCoordinatorOf } from '../src/coord/delegation-lease-acts.js';
import type { DelegationActivityRow, DelegationCheckpointV1, DelegationLeaseRow } from '../src/coord/delegation-model.js';
import { checkpointWithLease } from './delegationLeaseFixture.js';

const T0 = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const SETTLED = T0 + DELEGATION_ADOPT_SETTLE_MS;

/** A checkpoint with the fixture lease (generation 1, carrier seen) and its activity in `activity`'s state. */
const withActivity = (over: Partial<DelegationLeaseRow>, activity: Partial<DelegationActivityRow>): DelegationCheckpointV1 => {
  const cp = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1, ...over });
  const l = cp.leases[0]!;
  const row: DelegationActivityRow = { activityId: l.activityId, parentId: l.parentId, parentIncarnation: l.parentIncarnation,
    sourceKind: 'agent', upstreamId: 'agent-x', identityJournalId: 'j'.repeat(64), displayName: null, executionState: 'active',
    openedAt: l.firstObservedAt, endedAt: null, lastEventAt: l.firstObservedAt, ...activity };
  return { ...cp, activities: [row] };
};
const ended = (over: Partial<DelegationLeaseRow> = {}) => withActivity(over, { executionState: 'ended', endedAt: iso(T0) });
const active = (over: Partial<DelegationLeaseRow> = {}) => withActivity(over, { executionState: 'active', endedAt: null });
const live = (l: DelegationLeaseRow, over: Partial<ParentFact> = {}): ParentFact =>
  ({ registry: 'present', incarnation: l.parentIncarnation, deadSince: null, ccd: true, ...over });
const carrier = (l: DelegationLeaseRow, generation = l.generation) => ({ kind: 'carrier', body: { generation, state: 'ephemeral' } }) as never;

const base = (cp: DelegationCheckpointV1, nowMs: number, over: Partial<AdoptionInput> = {}): AdoptionInput => {
  const l = cp.leases[0]!;
  return {
    now: iso(nowMs), checkpoint: cp, carriers: new Map([[l.leaseId, carrier(l)]]),
    treePresent: new Set([delegationTreeKey(l.project, l.adminRecord)]), censused: new Set([l.project]),
    audits: new Map([[l.leaseId, { ok: true, changed: true } as never]]),
    watch: new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }]]),
    parents: new Map([[l.parentId, live(l)]]), conflicting: new Set<string>(), boxHolds: true, breaker: 'clear', marker: 'present', ...over,
  };
};
const kinds = (r: ReturnType<typeof decideAdoption>): string[] => r.decisions.map((d) => d.kind);

afterEach(() => { vi.restoreAllMocks(); });

describe('decideAdoption', () => {
  it('W5-D1: an ended agent lease, changed, settled for two passes, is adopted with a 7-day expiry', () => {
    const cp = ended();
    const r = decideAdoption(base(cp, SETTLED));
    expect(r.decisions).toEqual([{ kind: 'adopt', leaseId: cp.leases[0]!.leaseId, expectGeneration: 1, terminalAt: iso(T0),
      expiresAt: iso(SETTLED + 7 * DAY) }]);
    expect(r.health).toMatchObject({ mode: 'live', adopted: 1, wouldAdopt: 0 });
  });

  it('W5-D2: a raw or attached lease is never adopted; a workflow lease is', () => {
    for (const sourceKind of ['raw', 'attached'] as const) {
      const cp = ended({ sourceKind });
      expect(decideAdoption(base(cp, SETTLED)).decisions, sourceKind).toEqual([]);
    }
    expect(kinds(decideAdoption(base(ended({ sourceKind: 'workflow' }), SETTLED)))).toEqual(['adopt']);
    expect([...DELEGATION_ADOPTABLE_SOURCES]).toEqual(['agent', 'workflow']);
  });

  it('W5-D3: an active activity under a live parent is never adopted, however long it is silent', () => {
    const cp = active();
    const r = decideAdoption(base(cp, T0 + 30 * DAY));
    expect(r.decisions).toEqual([]);
    expect(r.watch.size, 'no terminal evidence: the watch entry is dropped').toBe(0);
  });

  it('W5-D4: an unknown activity under a live parent: no decision', () => {
    const cp = withActivity({}, { executionState: 'unknown', endedAt: null });
    expect(decideAdoption(base(cp, T0 + 30 * DAY)).decisions).toEqual([]);
  });

  it('W5-D5: a parent measured absent is terminal from the first pass it held; an unmeasured registry is not evidence', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const absent = new Map([[l.parentId, live(l, { registry: 'absent', incarnation: null, ccd: false })]]);
    const p1 = decideAdoption(base(cp, T0, { parents: absent, watch: new Map() }));
    expect(p1.decisions, 'the first pass only starts the watch').toEqual([]);
    expect(p1.watch.get(l.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 1 });
    const p2 = decideAdoption(base(cp, T0 + 60_000, { parents: absent, watch: p1.watch }));
    expect(p2.decisions, 'inside the settle').toEqual([]);
    const p3 = decideAdoption(base(cp, SETTLED, { parents: absent, watch: p2.watch }));
    expect(p3.decisions).toEqual([expect.objectContaining({ kind: 'adopt', terminalAt: iso(T0) })]);
    const unmeasured = new Map([[l.parentId, live(l, { registry: 'unmeasured', incarnation: null })]]);
    const u = decideAdoption(base(cp, T0 + 30 * DAY, { parents: unmeasured }));
    expect(u.decisions).toEqual([]);
    expect(u.watch.size).toBe(0);
  });

  it('W5-D6: a changed incarnation is terminal; an absent .generation (incarnation null, registry present) is not', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const moved = new Map([[l.parentId, live(l, { incarnation: 'g2' })]]);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: moved })))).toEqual(['adopt']);
    const nullInc = new Map([[l.parentId, live(l, { incarnation: null })]]);
    expect(decideAdoption(base(cp, T0 + 30 * DAY, { parents: nullInc })).decisions).toEqual([]);
    const dead = new Map([[l.parentId, live(l, { deadSince: iso(T0 - 120_000) })]]);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: dead }))), 'dead for two passes outside its restart window').toEqual(['adopt']);
  });

  it('W5-D7: one pass short, or one minute short of the settle: no adopt, and the watch counts the pass', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const short = decideAdoption(base(cp, SETTLED, { watch: new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 1 }]]) }));
    expect(short.decisions).toEqual([]);
    expect(short.watch.get(l.leaseId)!.passes).toBe(2);
    const early = decideAdoption(base(cp, SETTLED - 60_000));
    expect(early.decisions).toEqual([]);
    expect(early.watch.get(l.leaseId)!.passes).toBe(3);
    expect(early.health.waiting).toBe(1);
  });

  it('W5-D8: the breaker suspended: no adopt and mode suspended; the next clear pass adopts', () => {
    const cp = ended();
    const r = decideAdoption(base(cp, SETTLED, { breaker: 'suspended' }));
    expect(kinds(r)).toEqual(['attention']);
    expect(r.health.mode).toBe('suspended');
    expect(kinds(decideAdoption(base(cp, SETTLED + 60_000, { watch: r.watch, raised: r.raised })))).toEqual(['adopt']);
    expect(decideAdoption(base(cp, SETTLED, { breaker: 'unmeasured' })).decisions, 'an unmeasured breaker waits too').toEqual([]);
  });

  it('W5-D9: a generation change between passes resets the watch', () => {
    const cp = ended({ generation: 2, carrierGenerationSeen: 2 });
    const l = cp.leases[0]!;
    const r = decideAdoption(base(cp, SETTLED, { carriers: new Map([[l.leaseId, carrier(l)]]) }));
    expect(r.decisions, 'the watch was at generation 1').toEqual([]);
    expect(r.watch.get(l.leaseId)).toEqual({ generation: 2, terminalAt: iso(T0), passes: 1 });
  });

  it('W5-D10: an unsupported, unmeasured or refused audit adopts (the safe direction); changed:false does not, and counts unchanged', () => {
    const cp = ended();
    const id = cp.leases[0]!.leaseId;
    for (const a of ['unsupported', { ok: true, changed: 'unmeasured' }, { ok: false, refusal: 'no-tree', detail: 'x' }] as const) {
      expect(kinds(decideAdoption(base(cp, SETTLED, { audits: new Map([[id, a as never]]) }))), JSON.stringify(a)).toEqual(['adopt']);
    }
    const r = decideAdoption(base(cp, SETTLED, { audits: new Map([[id, { ok: true, changed: false } as never]]) }));
    expect(r.decisions).toEqual([]);
    expect(r.health.unchanged).toBe(1);
    expect(r.watch.has(id), 'unchanged leaves the lease to the orphan ladder').toBe(false);
  });

  it('W5-D11: marker absent and unmeasured give would-adopt and mode shadow / unmeasured, never adopt', () => {
    const cp = ended();
    const id = cp.leases[0]!.leaseId;
    const a = decideAdoption(base(cp, SETTLED, { marker: 'absent' }));
    expect(a.decisions).toEqual([{ kind: 'would-adopt', leaseId: id, why: 'marker-absent' }]);
    expect(a.health).toMatchObject({ mode: 'shadow', wouldAdopt: 1, adopted: 0 });
    const u = decideAdoption(base(cp, SETTLED, { marker: 'unmeasured' }));
    expect(u.decisions).toEqual([{ kind: 'would-adopt', leaseId: id, why: 'marker-unmeasured' }]);
    expect(u.health.mode).toBe('unmeasured');
  });

  it('W5-D13: no carrier read-back, or one a generation behind: wait, watch kept', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    for (const carriers of [new Map(), new Map([[l.leaseId, carrier(l, 0)]]), new Map([[l.leaseId, { kind: 'unreadable', detail: 'x' } as never]])]) {
      const r = decideAdoption(base(cp, SETTLED, { carriers }));
      expect(r.decisions).toEqual([]);
      expect(r.watch.get(l.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
    }
    const behind = decideAdoption(base(ended({ carrierGenerationSeen: 0 }), SETTLED));
    expect(behind.decisions, 'the journal has not seen the carrier at this generation').toEqual([]);
  });

  it('W5-D14: an admin record without its tree (not present): no decision', () => {
    const r = decideAdoption(base(ended(), SETTLED, { treePresent: new Set() }));
    expect(r.decisions).toEqual([]);
    expect(r.watch.size).toBe(0);
  });

  it('W5-D14b: a lease of an uncensused project waits with its watch kept, and continues once censused', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const r = decideAdoption(base(cp, SETTLED, { censused: new Set() }));
    expect(r.decisions).toEqual([]);
    expect(r.health.uncensused).toBe(1);
    expect(r.watch.get(l.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 3 });
    expect(kinds(decideAdoption(base(cp, SETTLED + 60_000, { watch: r.watch })))).toEqual(['adopt']);
  });

  it('W5-D15: five candidates with no audit answer give four audit decisions and unaudited 1', () => {
    const one = ended();
    const l0 = one.leases[0]!;
    const leases = [0, 1, 2, 3, 4].map((i) => ({ ...l0, leaseId: `5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4e5${i}`, adminRecord: `wt-${i}`,
      creatingJournalSequence: 5 + i }));
    const cp = { ...one, leases };
    const r = decideAdoption(base(cp, SETTLED, {
      carriers: new Map(leases.map((l) => [l.leaseId, carrier(l)])), audits: new Map(),
      treePresent: new Set(leases.map((l) => delegationTreeKey(l.project, l.adminRecord))),
      watch: new Map(leases.map((l) => [l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }])),
    }));
    expect(r.decisions).toEqual(leases.slice(0, DELEGATION_AUDITS_PER_PASS).map((l) => ({ kind: 'audit', leaseId: l.leaseId, generation: 1 })));
    expect(r.health.unaudited).toBe(1);
  });

  it('W5-D16: an adopted or retained lease 23 hours from expiry gives one remind; at 25 hours, none', () => {
    for (const disposition of ['adopted', 'retained'] as const) {
      const due = T0 + 30 * DAY;
      const cp = ended({ disposition, adoptedAt: iso(T0), cleanupDueAt: iso(due) });
      const id = cp.leases[0]!.leaseId;
      expect(decideAdoption(base(cp, due - 23 * 3_600_000)).decisions, disposition).toEqual([{ kind: 'remind', leaseId: id, generation: 1, expiresAt: iso(due) }]);
      expect(decideAdoption(base(cp, due - 25 * 3_600_000)).decisions, disposition).toEqual([]);
      expect(due - 23 * 3_600_000 >= due - DELEGATION_REMINDER_LEAD_MS).toBe(true);
    }
  });

  it('W5-D16b: a passed expiry, past the orphan hold\'s margin, raises one attention per lease and generation, and no reminder', () => {
    const due = T0 + 30 * DAY;
    const cp = ended({ disposition: 'adopted', adoptedAt: iso(T0), cleanupDueAt: iso(due) });
    const inMargin = decideAdoption(base(cp, due + 30 * 60_000));
    expect(inMargin.decisions).toEqual([]);
    const past = decideAdoption(base(cp, due + 2 * 3_600_000));
    expect(past.decisions).toEqual([expect.objectContaining({ kind: 'attention', key: `expired:${cp.leases[0]!.leaseId}:1` })]);
    expect(decideAdoption(base(cp, due + 3 * 3_600_000, { raised: past.raised })).decisions, 'standing: not raised again').toEqual([]);
  });

  it('W5-D18: a conflicting lease waits with its watch kept, counts conflicting and raises one attention; a resolved one is never adopted', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const key = delegationTreeKey(l.project, l.adminRecord);
    const r = decideAdoption(base(cp, SETTLED, { conflicting: new Set([key]) }));
    expect(r.decisions).toEqual([expect.objectContaining({ kind: 'attention', key: `conflicting:${l.leaseId}:1` })]);
    expect(r.health.conflicting).toBe(1);
    expect(r.watch.get(l.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
    expect(decideAdoption(base(cp, SETTLED, { conflicting: new Set([key]), raised: r.raised })).decisions, 'once per lease and generation').toEqual([]);
    // the operator's resolve: attach keeps it (retained), "not delegated" releases it; adoption starts only from ephemeral
    expect(decideAdoption(base(ended({ disposition: 'retained', retainedAt: iso(T0), cleanupDueAt: iso(T0 + 30 * DAY), generation: 2,
      carrierGenerationSeen: 2 }), SETTLED)).decisions).toEqual([]);
    expect(decideAdoption(base(ended({ releasedAt: iso(T0), generation: 2 }), SETTLED)).decisions).toEqual([]);
  });

  it('W5-D19: boxHolds false: no adopt, unsupported 1', () => {
    const r = decideAdoption(base(ended(), SETTLED, { boxHolds: false }));
    expect(r.decisions).toEqual([]);
    expect(r.health.unsupported).toBe(1);
  });

  it('W5-D20: leaseRecipient — a closed run names its coordinator, a parent at its incarnation itself, another incarnation or no row null', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const first = Date.parse(l.firstObservedAt);
    const runs = [{ id: 7, sessionId: l.parentId, claimedBy: 'coord-a-demo', openedAt: first - 60_000, closedAt: first + 60_000 }];
    const coordinator = leaseCoordinatorOf(l, runs);
    expect(coordinator, 'the run closed before adoption, but its interval holds firstObservedAt').toBe('coord-a-demo');
    expect(leaseRecipient(l, live(l), coordinator)).toBe('coord-a-demo');
    expect(leaseRecipient(l, live(l), null)).toBe(l.parentId);
    expect(leaseRecipient(l, live(l, { incarnation: 'g9' }), null)).toBeNull();
    expect(leaseRecipient(l, live(l, { registry: 'absent', incarnation: null, ccd: false }), null)).toBeNull();
    expect(leaseRecipient(l, undefined, null)).toBeNull();
  });

  it('W5-D21: the breaker suspended for three passes emits one attention for the episode; a new episode raises again', () => {
    const cp = ended();
    let raised: ReadonlySet<string> | undefined;
    const counts: number[] = [];
    for (const n of [0, 1, 2]) {
      const r = decideAdoption(base(cp, SETTLED + n * 60_000, { breaker: 'suspended', raised }));
      counts.push(r.decisions.filter((d) => d.kind === 'attention').length);
      raised = r.raised;
    }
    expect(counts).toEqual([1, 0, 0]);
    const clear = decideAdoption(base(active(), SETTLED, { raised }));
    expect(clear.raised.has('breaker-suspended'), 'the episode ends when the breaker clears').toBe(false);
    expect(kinds(decideAdoption(base(cp, SETTLED, { breaker: 'suspended', raised: clear.raised })))).toEqual(['attention']);
  });

  it('W5-D17: the decider reads no clock', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('the decider read the clock'); });
    expect(kinds(decideAdoption(base(ended(), SETTLED)))).toEqual(['adopt']);
    expect(decideAdoption(base(ended(), SETTLED, { marker: 'absent' })).health.mode).toBe('shadow');
  });
});

describe('the carrier reads, the clamp, the notices and the audit parser', () => {
  it('adoptionCarrierReads names the ephemeral adoptable leases whose seen equals their generation, on no conflicting tree', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    expect(adoptionCarrierReads(cp, new Set())).toEqual([l.leaseId]);
    expect(adoptionCarrierReads(cp, new Set([delegationTreeKey(l.project, l.adminRecord)]))).toEqual([]);
    expect(adoptionCarrierReads(ended({ sourceKind: 'raw' }), new Set())).toEqual([]);
    expect(adoptionCarrierReads(ended({ carrierGenerationSeen: 0 }), new Set())).toEqual([]);
  });

  it('D-7968: terminalEvidenceAt is max(terminalAt, firstObservedAt)', () => {
    const l = ended().leases[0]!;
    expect(adoptTerminalEvidenceAt(iso(T0), l)).toBe(iso(T0));
    expect(adoptTerminalEvidenceAt('2026-10-01T00:00:00.000Z', l)).toBe(l.firstObservedAt);
  });

  it('owedLeaseNotices: every adopted lease at its generation with a recipient; a re-adopt (a refused transfer, two generations on) is owed again', () => {
    const cp = ended({ disposition: 'adopted', adoptedAt: iso(T0), cleanupDueAt: iso(T0 + 7 * DAY), generation: 2 });
    const l = cp.leases[0]!;
    expect(owedLeaseNotices(cp, () => 'coord-a-demo')).toEqual([{ recipient: 'coord-a-demo',
      item: { leaseId: l.leaseId, generation: 2, canonicalPath: l.canonicalPath, parentId: l.parentId, expiresAt: iso(T0 + 7 * DAY) } }]);
    expect(owedLeaseNotices(cp, () => null)).toEqual([]);
    expect(owedLeaseNotices(ended(), () => 'x'), 'an ephemeral lease is owed nothing').toEqual([]);
    const readopted = { ...cp, leases: [{ ...l, generation: 4 }] };
    const subjects = [cp, readopted].map((c) => buildLeaseDigest('coord-a-demo', owedLeaseNotices(c, () => 'coord-a-demo')[0]!.item, { retain: true, promote: false }).subject);
    expect(subjects).toEqual([`delegation: worktree kept for coord-a-demo (${l.leaseId}, generation 2)`,
      `delegation: worktree kept for coord-a-demo (${l.leaseId}, generation 4)`]);
    const transferring = { ...cp, leaseCarriers: [{ leaseId: l.leaseId, transferringSince: iso(T0), transferRun: 3, promotedRun: null,
      promotedSession: null, releaseReason: null, resolvedThrough: null } as never] };
    expect(owedLeaseNotices(transferring, () => 'x'), 'a transfer in flight is not adopted').toEqual([]);
  });

  it('the digest and the reminder: the Retain line, the closing sentence, and no word of completion', () => {
    const item = { leaseId: 'L1', generation: 2, canonicalPath: '/w/project-a/.claude/worktrees/wt-1', parentId: 'lane-a-demo', expiresAt: '2026-11-17T12:05:00.000Z' };
    const d = buildLeaseDigest('lane-a-demo', item, { retain: true, promote: false });
    expect(d.subject).toBe('delegation: worktree kept for lane-a-demo (L1, generation 2)');
    expect(d.body).toContain(`~/.local/bin/ccrc-api leases retain L1 --json '{"byId":"<your id>","byUuid":"<your uuid>"}'`);
    expect(d.body).toContain('kept until 2026-11-17 12:05 UTC');
    expect(d.body.endsWith(DELEGATION_HOLD_CLOSING)).toBe(true);
    expect(DELEGATION_HOLD_CLOSING).toBe('After that date the worktree is no longer held back from the disk sweep, which never removes uncommitted work, '
      + 'and removes a worktree with unpushed commits only after saving them to a rescue ref.');
    const r = buildLeaseReminder(item, { retain: true, promote: false });
    expect(r.subject).toBe('delegation: worktree hold ends soon (L1, generation 2)');
    expect(r.body).toContain(DELEGATION_HOLD_CLOSING);
    for (const text of [d.subject, d.body, r.subject, r.body]) expect(text).not.toMatch(/\brunning\b|repair|finish|complet/i);
  });

  it('parseLeaseAuditAnswer keeps the box\'s answer and refusal, and reads anything else as unmeasured', () => {
    const okLine = { ok: true, lease: 'L', generation: 1, tip: 'a'.repeat(40), dirty: false, aheadOfBase: 0, branchAheadOfBase: 'no-branch', changed: false, token: 't' };
    expect(parseLeaseAuditAnswer(`noise\n${JSON.stringify(okLine)}\n`)).toEqual(okLine);
    expect(parseLeaseAuditAnswer(JSON.stringify({ ok: false, refusal: 'no-tree', detail: 'gone' }))).toEqual({ ok: false, refusal: 'no-tree', detail: 'gone' });
    for (const bad of ['', 'not json', '[]', JSON.stringify({ ok: false, refusal: 'invented' }), JSON.stringify({ ok: true, changed: 'maybe' })]) {
      expect(parseLeaseAuditAnswer(bad), bad).toMatchObject({ ok: false, refusal: 'unmeasured' });
    }
  });
});
