// Delegation broker wave 5, PR7 (Task 5.7.2): the adoption decider, fed `now` (plan "## PR7", rules 1 to 9, W5-D1..W5-D21).
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  DELEGATION_ADOPTABLE_SOURCES, DELEGATION_ADOPT_CARRIER_READS_PER_PASS, DELEGATION_ADOPT_SETTLE_MS, DELEGATION_AUDITS_PER_PASS, DELEGATION_AUDIT_HOLD_MS,
  DELEGATION_HOLD_CLOSING, DELEGATION_REMINDER_LEAD_MS, adoptAuditWord, adoptTerminalEvidenceAt, adoptionAudits, adoptionCarrierReads, adoptionParentFacts,
  buildAdoptionFeedRow, buildLeaseDigest, buildLeaseReminder, decideAdoption, leaseRecipient, owedLeaseNotices, parseLeaseAuditAnswer, type AdoptWatch,
  type AdoptionInput, type AdoptionParentReads, type HeldLeaseAudit, type ParentFact,
} from '../src/coord/delegation-adoption.js';
import { carrierReadsOf, leastRecentlyRead } from '../src/coord/delegation-carrier.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { leaseCoordinatorOf } from '../src/coord/delegation-lease-acts.js';
import type { DelegationActivityRow, DelegationCheckpointV1, DelegationLeaseRow } from '../src/coord/delegation-model.js';
import { checkpointWithLease, equalCarrier } from './delegationLeaseFixture.js';

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
  ({ registry: 'present', incarnation: l.parentIncarnation, deadSince: null, ccd: true, alive: true, deathRetracted: false, lastAlive: null, ...over });
/** PR7b (review 1609 F8): a read-back EQUAL to the lease as PR6 compares it, at `generation`. */
const carrier = (l: DelegationLeaseRow, generation = l.generation) => equalCarrier(l, { generation });

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
    expect(u.decisions, 'a settled watch, then an unmeasured registry: no decision (review 1604 F1)').toEqual([]);
    expect(u.watch.get(l.leaseId), 'held exactly as it was').toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
    expect(decideAdoption(base(cp, T0 + 30 * DAY, { parents: unmeasured, watch: new Map() })).watch.size, 'and it starts no watch').toBe(0);
  });

  it('W5-D6: a changed incarnation is terminal; an absent .generation (incarnation null, registry present) is not', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const moved = new Map([[l.parentId, live(l, { incarnation: 'g2' })]]);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: moved })))).toEqual(['adopt']);
    const nullInc = new Map([[l.parentId, live(l, { incarnation: null })]]);
    const unread = decideAdoption(base(cp, T0 + 30 * DAY, { parents: nullInc }));
    expect(unread.decisions, 'a settled watch, then an unread incarnation: no decision (review 1604 F1)').toEqual([]);
    expect(unread.watch.get(l.leaseId), 'held exactly as it was').toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
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
    expect(r.watch.has(id), 'unchanged keeps the entry: asked again after the hold (review 1604 F6)').toBe(true);
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

  it('W5-D20: leaseRecipient — a closed run names its coordinator, a parent at its incarnation itself, another incarnation or no row record-only, an unmeasured read unmeasured', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const first = Date.parse(l.firstObservedAt);
    const runs = [{ id: 7, sessionId: l.parentId, claimedBy: 'coord-a-demo', openedAt: first - 60_000, closedAt: first + 60_000 }];
    const coordinator = leaseCoordinatorOf(l, runs);
    expect(coordinator, 'the run closed before adoption, but its interval holds firstObservedAt').toBe('coord-a-demo');
    expect(leaseRecipient(l, live(l), coordinator)).toEqual({ kind: 'mail', to: 'coord-a-demo' });
    expect(leaseRecipient(l, live(l), null)).toEqual({ kind: 'mail', to: l.parentId });
    expect(leaseRecipient(l, live(l, { incarnation: 'g9' }), null)).toEqual({ kind: 'record-only' });
    expect(leaseRecipient(l, live(l, { registry: 'absent', incarnation: null, ccd: false }), null)).toEqual({ kind: 'record-only' });
    // review 1587 F6, A2: an unmeasured read is never folded into "no recipient": it holds the notice
    expect(leaseRecipient(l, undefined, null)).toEqual({ kind: 'unmeasured' });
    expect(leaseRecipient(l, live(l, { registry: 'unmeasured', ccd: false }), null)).toEqual({ kind: 'unmeasured' });
    expect(leaseRecipient(l, live(l, { incarnation: null }), null)).toEqual({ kind: 'unmeasured' });
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
  it('adoptionCarrierReads names the ephemeral adoptable leases whose seen equals their generation, on no conflicting tree, past rules 4 to 6', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const reads = (c: DelegationCheckpointV1, over: Partial<AdoptionInput> = {}): string[] => {
      const { carriers: _unused, ...input } = base(c, SETTLED, over);
      return adoptionCarrierReads(input, new Map());
    };
    expect(reads(cp)).toEqual([l.leaseId]);
    expect(reads(cp, { conflicting: new Set([delegationTreeKey(l.project, l.adminRecord)]) })).toEqual([]);
    expect(reads(ended({ sourceKind: 'raw' }))).toEqual([]);
    expect(reads(ended({ carrierGenerationSeen: 0 }))).toEqual([]);
  });

  it('D-7968: terminalEvidenceAt is max(terminalAt, firstObservedAt)', () => {
    const l = ended().leases[0]!;
    expect(adoptTerminalEvidenceAt(iso(T0), l)).toBe(iso(T0));
    expect(adoptTerminalEvidenceAt('2026-10-01T00:00:00.000Z', l)).toBe(l.firstObservedAt);
  });

  it('owedLeaseNotices: every adopted lease at its generation with a recipient; a re-adopt (a refused transfer, two generations on) is owed again', () => {
    const cp = ended({ disposition: 'adopted', adoptedAt: iso(T0), cleanupDueAt: iso(T0 + 7 * DAY), generation: 2 });
    const l = cp.leases[0]!;
    const to = (id: string) => () => ({ kind: 'mail', to: id }) as const;
    const now = iso(T0 + DAY);
    expect(owedLeaseNotices(cp, now, to('coord-a-demo'))).toEqual([{ recipient: { kind: 'mail', to: 'coord-a-demo' },
      item: { leaseId: l.leaseId, generation: 2, canonicalPath: l.canonicalPath, parentId: l.parentId, expiresAt: iso(T0 + 7 * DAY) } }]);
    expect(owedLeaseNotices(cp, now, () => ({ kind: 'record-only' }))).toEqual([]);
    expect(owedLeaseNotices(cp, now, () => ({ kind: 'unmeasured' })).map((o) => o.recipient), 'an unmeasured recipient holds it, owed').toEqual([{ kind: 'unmeasured' }]);
    expect(owedLeaseNotices(ended(), now, to('x')), 'an ephemeral lease is owed nothing').toEqual([]);
    const readopted = { ...cp, leases: [{ ...l, generation: 4 }] };
    const subjects = [cp, readopted].map((c) => buildLeaseDigest('coord-a-demo', owedLeaseNotices(c, now, to('coord-a-demo'))[0]!.item, { retain: true, promote: false }).subject);
    expect(subjects).toEqual([`delegation: worktree kept for coord-a-demo (${l.leaseId}, generation 2)`,
      `delegation: worktree kept for coord-a-demo (${l.leaseId}, generation 4)`]);
    const transferring = { ...cp, leaseCarriers: [{ leaseId: l.leaseId, transferringSince: iso(T0), transferRun: 3, promotedRun: null,
      promotedSession: null, releaseReason: null, resolvedThrough: null } as never] };
    expect(owedLeaseNotices(transferring, now, to('x')), 'a transfer in flight is not adopted').toEqual([]);
  });

  it('review 1587 F5: owedLeaseNotices owes no digest once its hold has ended (the expired: item covers the lease)', () => {
    const due = T0 + 7 * DAY;
    const cp = ended({ disposition: 'adopted', adoptedAt: iso(T0), cleanupDueAt: iso(due), generation: 2 });
    const to = () => ({ kind: 'mail', to: 'coord-a-demo' }) as const;
    expect(owedLeaseNotices(cp, iso(due - 60_000), to), 'CONTROL: a minute before the date it is owed').toHaveLength(1);
    expect(owedLeaseNotices(cp, iso(due), to)).toEqual([]);
    expect(owedLeaseNotices(cp, iso(due + DAY), to)).toEqual([]);
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

describe('review 1587 (fix round 1): the parents, kept evidence, held audits and bounded carrier reads', () => {
  const reads = (l: DelegationLeaseRow, over: Partial<AdoptionParentReads> = {}): AdoptionParentReads => ({ now: iso(SETTLED), registryListed: true,
    listedIds: new Set([l.parentId]), built: new Set([l.parentId]), sessions: [{ id: l.parentId, presence: 'alive' }], retracted: new Set(),
    lastAlive: new Map(), incarnations: new Map([[l.parentId, { kind: 'measured', incarnation: l.parentIncarnation }]]), firstDead: new Map(), ...over });

  it('A7, F1: adoptionParentFacts — a built row is present; listed but not built, no listing or no listed ids is unmeasured; unlisted is absent', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const fact = (over: Partial<AdoptionParentReads>) => adoptionParentFacts(cp, reads(l, over)).get(l.parentId);
    expect(fact({})).toEqual({ registry: 'present', incarnation: l.parentIncarnation, deadSince: null, ccd: true, alive: true, deathRetracted: false,
      lastAlive: null });
    expect(fact({ sessions: [] })?.alive, 'not among the pass\'s sessions: liveness unmeasured').toBeNull();
    expect(fact({ retracted: new Set([l.parentId]) })?.deathRetracted, 'review 1604 F7').toBe(true);
    expect(fact({ built: new Set() }), 'F1: the listing names it, the registry could not assemble it').toMatchObject({ registry: 'unmeasured', ccd: false });
    expect(fact({ built: new Set(), listedIds: new Set() })).toMatchObject({ registry: 'absent', ccd: false });
    expect(fact({ registryListed: false })).toMatchObject({ registry: 'unmeasured', ccd: false });
    expect(fact({ listedIds: null })).toMatchObject({ registry: 'unmeasured', ccd: false });
    expect(fact({ incarnations: new Map([[l.parentId, { kind: 'unmeasured' }]]) })?.incarnation).toBeNull();
    const dead = [{ id: l.parentId, presence: 'dead' as const }];
    expect(fact({ sessions: dead, firstDead: new Map([[l.parentId, SETTLED - 60_000]]) })).toMatchObject({ deadSince: iso(SETTLED - 60_000), alive: false });
    expect(fact({ sessions: dead, firstDead: new Map([[l.parentId, SETTLED]]) })?.deadSince, 'recorded this pass: evidence from the next').toBeNull();
  });

  it('F1: a parent listed but not built gives no terminal evidence and never adopts, over the settle and the stable passes', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const walk = (over: Partial<AdoptionParentReads>): string[] => {
      let watch: ReadonlyMap<string, AdoptWatch> = new Map();
      const seen: string[] = [];
      for (let n = 0; n <= 10; n += 1) {
        const now = T0 + n * 60_000;
        const r = decideAdoption(base(cp, now, { parents: adoptionParentFacts(cp, reads(l, { now: iso(now), sessions: [], ...over })), watch }));
        seen.push(...kinds(r));
        watch = r.watch;
      }
      return seen;
    };
    expect(walk({ built: new Set() })).toEqual([]);
    expect(walk({ built: new Set(), listedIds: new Set() }), 'CONTROL: unlisted (absent), the same walk adopts').toContain('adopt');
  });

  it('F2: a death the lane saw is kept once the dead-since memory ages out; alive again at the lease\'s incarnation drops it; an unmeasured read neither adds nor drops', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const seen = new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }]]);
    const one = (p: ParentFact, watch: ReadonlyMap<string, AdoptWatch> = seen, over: Partial<AdoptionInput> = {}) =>
      decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, p]]), watch, ...over }));
    const aged = live(l, { alive: false });                                       // present, same incarnation, not alive, deadSince gone
    expect(kinds(one(aged)), 'live: adopted on the death seen').toEqual(['adopt']);
    expect(kinds(one(aged, seen, { marker: 'absent' })), 'shadow: still counted').toEqual(['would-adopt']);
    const again = one(live(l));
    expect(again.decisions, 'alive again at its incarnation (a supervisor restart)').toEqual([]);
    expect(again.watch.size).toBe(0);
    // review 1604 F1: an unmeasured read holds — no decision, the entry exactly as it was, and none started
    for (const p of [live(l, { registry: 'unmeasured', ccd: false, alive: false }), live(l, { incarnation: null }), live(l, { alive: null })]) {
      const held = one(p);
      expect(held.decisions, `no decision: ${JSON.stringify(p)}`).toEqual([]);
      expect(held.watch.get(l.leaseId), `held: ${JSON.stringify(p)}`).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
      expect(one(p, new Map()).watch.size, `and adds none: ${JSON.stringify(p)}`).toBe(0);
    }
    const restart = one(aged, new Map());
    expect(restart.decisions, 'a restart (fresh memory) over a dead parent: nothing on death alone').toEqual([]);
    expect(restart.watch.size).toBe(0);
  });

  it('F3, A8: adoptionAudits — a definite answer is held for its generation and an hour; one not definite is fed this pass and never held', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const yes = { ok: true, changed: true, token: 't' } as never, no = { ok: true, changed: false, token: 't' } as never;
    const unm = { ok: false, refusal: 'unmeasured', detail: 'x' } as never, half = { ok: true, changed: 'unmeasured', token: 't' } as never;
    const one = (answer: never, ms: number, generation = 1): Map<string, HeldLeaseAudit> => new Map([[l.leaseId, { generation, answer, at: iso(ms) }]]);
    const run = (over: Partial<Parameters<typeof adoptionAudits>[0]>) =>
      adoptionAudits({ now: iso(T0), checkpoint: cp, auditable: true, held: new Map(), fresh: new Map(), ...over });
    for (const a of [yes, no]) {
      const r = run({ fresh: one(a, T0) });
      expect(r.audits.get(l.leaseId)).toBe(a);
      expect(r.held.get(l.leaseId)?.answer).toBe(a);
      expect(run({ now: iso(T0 + DELEGATION_AUDIT_HOLD_MS), held: r.held }).audits.get(l.leaseId), 'held for the hour').toBe(a);
      const old = run({ now: iso(T0 + DELEGATION_AUDIT_HOLD_MS + 1), held: r.held });
      expect(old.audits.has(l.leaseId), 'past the hour: not fed, so asked again').toBe(false);
      expect(old.held.size).toBe(0);
    }
    for (const a of [unm, half]) {
      const r = run({ fresh: one(a, T0) });
      expect(r.audits.get(l.leaseId), 'fed this pass: rule 7 counts it changed').toBe(a);
      expect(r.held.size, 'never held').toBe(0);
      expect(run({ held: one(a, T0) }).audits.size, 'nor fed from a hold').toBe(0);
    }
    expect(run({ held: one(yes, T0, 0) }).audits.size, 'another generation').toBe(0);
    expect(run({ checkpoint: ended({ releasedAt: iso(T0) }), fresh: one(yes, T0) }).held.size, 'no longer a candidate: pruned').toBe(0);
    expect(run({ auditable: false, held: one(yes, T0) }).audits.get(l.leaseId)).toBe('unsupported');
    const later = SETTLED + DELEGATION_AUDIT_HOLD_MS + 1;
    const stale = run({ now: iso(later), held: one(yes, SETTLED) });
    expect(kinds(decideAdoption(base(cp, later, { audits: stale.audits }))), 'an answer past the hour is asked again before an adoption').toEqual(['audit']);
  });

  it('F7: adoptionCarrierReads reads no lease without terminal evidence, settle or census, and at most the bound a pass; over it waits', () => {
    const reads = (c: DelegationCheckpointV1, nowMs: number, over: Partial<AdoptionInput> = {}): string[] => {
      const { carriers: _unused, ...input } = base(c, nowMs, over);
      return adoptionCarrierReads(input, new Map());
    };
    const live1 = active();
    expect(reads(live1, SETTLED), 'rule 4: no terminal evidence, no read').toEqual([]);
    expect(reads(ended(), SETTLED, { watch: new Map() }), 'rule 5: one pass, no read').toEqual([]);
    expect(reads(ended(), SETTLED - 60_000), 'rule 5: inside the settle').toEqual([]);
    expect(reads(ended(), SETTLED, { censused: new Set() }), 'rule 6: uncensused').toEqual([]);
    expect(reads(ended(), SETTLED, { treePresent: new Set() }), 'rule 6: no tree').toEqual([]);
    const one = ended();
    const l0 = one.leases[0]!;
    const leases = Array.from({ length: 10 }, (_, i) => ({ ...l0, leaseId: `5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4f${String(i).padStart(2, '0')}`,
      adminRecord: `wt-${i}`, creatingJournalSequence: 5 + i }));
    const cp = { ...one, leases };
    const over: Partial<AdoptionInput> = {
      treePresent: new Set(leases.map((l) => delegationTreeKey(l.project, l.adminRecord))),
      watch: new Map(leases.map((l) => [l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }])),
      audits: new Map(leases.map((l) => [l.leaseId, { ok: true, changed: true } as never])),
    };
    const read = reads(cp, SETTLED, over);
    expect(read).toEqual(leases.slice(0, DELEGATION_ADOPT_CARRIER_READS_PER_PASS).map((l) => l.leaseId));
    const r = decideAdoption(base(cp, SETTLED, { ...over, carriers: new Map(read.map((id) => [id, carrier(leases.find((l) => l.leaseId === id)!)])) }));   // PR7b: each its own, equal
    expect(r.decisions.filter((d) => d.kind === 'adopt')).toHaveLength(DELEGATION_ADOPT_CARRIER_READS_PER_PASS);
    expect(r.health.waiting, 'the two over the bound wait a pass, watch kept').toBe(2);
    expect(r.watch.get(leases[9]!.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
  });
});

describe('review 1604 (fix round 2): unmeasured reads hold, the reads rotate, and what drops a kept death', () => {
  const settled = (l: DelegationLeaseRow) => new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }]]);

  it('F1: one measured absent pass, then eight unmeasured passes, never adopts', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const seen: string[][] = [];
    let watch: ReadonlyMap<string, AdoptWatch> = new Map();
    for (let n = 0; n < 9; n += 1) {
      const p = n === 0 ? live(l, { registry: 'absent', incarnation: null, ccd: false, alive: null }) : live(l, { registry: 'unmeasured', ccd: false, alive: null });
      const r = decideAdoption(base(cp, T0 + n * 60_000, { parents: new Map([[l.parentId, p]]), watch }));
      seen.push(kinds(r));
      watch = r.watch;
    }
    expect(seen.flat()).toEqual([]);
    expect(watch.get(l.leaseId), 'the one measured pass, held').toEqual({ generation: 1, terminalAt: iso(T0), passes: 1 });
  });

  it('F2: ten candidates are each read within two passes (never read first, then the oldest read)', () => {
    const one = ended();
    const l0 = one.leases[0]!;
    const leases = Array.from({ length: 10 }, (_, i) => ({ ...l0, leaseId: `5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4f${String(i).padStart(2, '0')}`,
      adminRecord: `wt-${i}`, creatingJournalSequence: 5 + i }));
    const cp = { ...one, leases };
    const { carriers: _unused, ...input } = base(cp, SETTLED, {
      treePresent: new Set(leases.map((l) => delegationTreeKey(l.project, l.adminRecord))),
      watch: new Map(leases.map((l) => [l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }])),
    });
    const lastRead = new Map<string, number>();
    const first = adoptionCarrierReads(input, lastRead);
    first.forEach((id) => lastRead.set(id, 1));
    const second = adoptionCarrierReads(input, lastRead);
    expect(first).toHaveLength(DELEGATION_ADOPT_CARRIER_READS_PER_PASS);
    expect(new Set([...first, ...second])).toEqual(new Set(leases.map((l) => l.leaseId)));
    expect(second.slice(0, 2), 'never read first').toEqual([leases[8]!.leaseId, leases[9]!.leaseId]);
  });

  it('F5: alive again at its incarnation while waiting at rule 2 drops the kept death; dead again, the new death\'s own window applies', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const key = delegationTreeKey(l.project, l.adminRecord);
    const dead = new Map([[l.parentId, live(l, { alive: false })]]);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: dead, watch: settled(l), marker: 'absent' }))), 'CONTROL: the kept death counts').toEqual(['would-adopt']);
    const conflicted = decideAdoption(base(cp, SETTLED, { conflicting: new Set([key]), watch: settled(l), parents: new Map([[l.parentId, live(l)]]) }));
    expect(conflicted.watch.size, 'alive again while waiting at rule 2: dropped').toBe(0);
    const again = decideAdoption(base(cp, SETTLED + 60_000, { parents: dead, watch: conflicted.watch }));
    expect(again.decisions).toEqual([]);
    expect(again.watch.size, 'the old death is gone; the new one has not yet been read (deadSince null)').toBe(0);
  });

  it('F6: a tree whose census record reads unreadable holds the entry; a definite changed:false keeps it', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const key = delegationTreeKey(l.project, l.adminRecord);
    const unread = decideAdoption(base(cp, SETTLED, { treePresent: new Set(), treeUnread: new Set([key]) }));
    expect(unread.decisions).toEqual([]);
    expect(unread.watch.get(l.leaseId), 'held as it was').toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
    expect(decideAdoption(base(cp, SETTLED, { treePresent: new Set() })).watch.size, 'CONTROL: absent drops it').toBe(0);
    const unchanged = decideAdoption(base(cp, SETTLED, { audits: new Map([[l.leaseId, { ok: true, changed: false } as never]]) }));
    expect(unchanged.decisions).toEqual([]);
    expect(unchanged.watch.get(l.leaseId)).toEqual({ generation: 1, terminalAt: iso(T0), passes: 3 });
  });

  it('F7: a kept death that the lane retracts (a stop stamp dated at or before it) is dropped and never adopts', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const retracted = new Map([[l.parentId, live(l, { alive: false, deathRetracted: true })]]);
    const r = decideAdoption(base(cp, SETTLED, { parents: retracted, watch: settled(l) }));
    expect(r.decisions).toEqual([]);
    expect(r.watch.size).toBe(0);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, live(l, { alive: false })]]), watch: settled(l) }))), 'CONTROL').toEqual(['adopt']);
  });

  it('F8: a backward clock step does not hold an answer past the hour', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    const held = new Map([[l.leaseId, { generation: 1, answer: { ok: true, changed: true, token: 't' } as never, at: iso(T0) }]]);
    const run = (nowMs: number) => adoptionAudits({ now: iso(nowMs), checkpoint: cp, auditable: true, held, fresh: new Map() });
    expect(run(T0 + 60_000).audits.has(l.leaseId), 'CONTROL: a minute on, held').toBe(true);
    expect(run(T0 - 30 * 60_000).audits.has(l.leaseId), 'the clock stepped back: not held').toBe(false);
  });

  it('F10 (h): a lease at generation 0 gets no carrier read', () => {
    const cp = ended({ generation: 0, carrierGenerationSeen: 0 });
    const l = cp.leases[0]!;
    const { carriers: _unused, ...input } = base(cp, SETTLED, { watch: new Map([[l.leaseId, { generation: 0, terminalAt: iso(T0), passes: 2 }]]) });
    expect(adoptionCarrierReads(input, new Map())).toEqual([]);
    const { carriers: _c, ...one } = base(ended(), SETTLED);
    expect(adoptionCarrierReads(one, new Map()), 'CONTROL: generation 1 is read').toHaveLength(1);
  });
});

// PR7b (run 1612): the coordinator's rulings on review 1609, the third review of PR7.
describe('review 1609 (PR7b): liveness from presence, an outlived death, PR6\'s equality, the audit\'s words and the one comparator', () => {
  const settled = (l: DelegationLeaseRow) => new Map([[l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }]]);
  const reads = (l: DelegationLeaseRow, over: Partial<AdoptionParentReads> = {}): AdoptionParentReads => ({ now: iso(SETTLED), registryListed: true,
    listedIds: new Set([l.parentId]), built: new Set([l.parentId]), sessions: [{ id: l.parentId, presence: 'alive' }], retracted: new Set(),
    lastAlive: new Map(), incarnations: new Map([[l.parentId, { kind: 'measured', incarnation: l.parentIncarnation }]]), firstDead: new Map(), ...over });

  it('F1: liveness is the row\'s presence: alive and dead are measured; unknown (D-309), asleep and no presence are not, and give no dead-since', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const died = new Map([[l.parentId, SETTLED - 120_000]]);
    const fact = (presence: 'alive' | 'dead' | 'unknown' | 'asleep' | undefined) =>
      adoptionParentFacts(cp, reads(l, { sessions: [{ id: l.parentId, presence }], firstDead: died })).get(l.parentId)!;
    expect(fact('alive')).toMatchObject({ alive: true, deadSince: null });
    expect(fact('dead')).toMatchObject({ alive: false, deadSince: iso(SETTLED - 120_000) });
    for (const p of ['unknown', 'asleep', undefined] as const) expect(fact(p), String(p)).toMatchObject({ alive: null, deadSince: null });
    // a kept death and a parent tmux did not answer for (or asleep): held exactly, counted waiting, no decision
    for (const p of ['unknown', 'asleep'] as const) {
      const r = decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, fact(p)]]), watch: settled(l) }));
      expect(r.decisions, p).toEqual([]);
      expect(r.watch.get(l.leaseId), p).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
      expect(r.health.waiting, p).toBe(1);
      expect(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, fact(p)]]), watch: new Map() })).watch.size, `${p}: starts no watch`).toBe(0);
    }
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, fact('dead')]]), watch: settled(l) }))), 'CONTROL: measured dead adopts').toEqual(['adopt']);
  });

  it('F5: a parent measured alive after the kept death, on a pass the decider never saw, ends it; dead again, the new death\'s own window applies', () => {
    const cp = active();
    const l = cp.leases[0]!;
    const deadAgain = (lastAlive: ParentFact['lastAlive']) => live(l, { alive: false, deadSince: iso(SETTLED - 60_000), lastAlive });
    const after = { at: iso(T0 + 60_000), incarnation: l.parentIncarnation };
    const r = decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, deadAgain(after)]]), watch: settled(l) }));
    expect(r.decisions, 'the old death is gone').toEqual([]);
    expect(r.watch.get(l.leaseId), 'the new death starts its own watch at this pass').toEqual({ generation: 1, terminalAt: iso(SETTLED), passes: 1 });
    expect(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, deadAgain({ ...after, incarnation: null })]]), watch: settled(l) })).decisions,
      'an incarnation the census did not read then: the same').toEqual([]);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, deadAgain({ ...after, incarnation: 'g-other' })]]), watch: settled(l) }))),
      'CONTROL: alive at another incarnation is not the lease\'s parent alive again').toEqual(['adopt']);
    expect(kinds(decideAdoption(base(cp, SETTLED, { parents: new Map([[l.parentId, deadAgain({ ...after, at: iso(T0) })]]), watch: settled(l) }))),
      'CONTROL: alive at the kept instant, not after it').toEqual(['adopt']);
    const done = ended();
    const e = done.leases[0]!;
    expect(kinds(decideAdoption(base(done, SETTLED, { parents: new Map([[e.parentId, live(e, { lastAlive: { at: iso(SETTLED), incarnation: e.parentIncarnation } })]]) }))),
      'CONTROL: an ended activity is never outlived (the parent lives on after its agent)').toEqual(['adopt']);
  });

  it('F8 (D-8093): rule 3 asks PR6\'s equality: a foreign carrier at the lease\'s generation waits; an equal one adopts', () => {
    const cp = ended();
    const l = cp.leases[0]!;
    for (const over of [{ journalSeq: l.currentJournalSequence + 1 }, { state: 'adopted' as const }, { parentIncarnation: 'g-other' }, { activityId: 'a'.repeat(64) }]) {
      const r = decideAdoption(base(cp, SETTLED, { carriers: new Map([[l.leaseId, equalCarrier(l, over)]]) }));
      expect(r.decisions, JSON.stringify(over)).toEqual([]);
      expect(r.health.waiting, JSON.stringify(over)).toBe(1);
      expect(r.watch.get(l.leaseId), `${JSON.stringify(over)}: the watch is kept`).toEqual({ generation: 1, terminalAt: iso(T0), passes: 2 });
    }
    expect(kinds(decideAdoption(base(cp, SETTLED, { carriers: new Map([[l.leaseId, equalCarrier(l)]]) }))), 'CONTROL: equal').toEqual(['adopt']);
  });

  it('F9: the feed row and the digest say "left changed" only for changed: true; an answer rule 7 counted as changed says it could not be checked', () => {
    const yes = { ok: true, changed: true, token: 't' } as never, half = { ok: true, changed: 'unmeasured', token: 't' } as never;
    const refused = { ok: false, refusal: 'unmeasured', detail: 'x' } as never;
    expect(adoptAuditWord(yes)).toBe('changed');
    for (const a of [half, refused, 'unsupported' as const, undefined]) expect(adoptAuditWord(a), JSON.stringify(a)).toBe('unchecked');
    const lease = { leaseId: 'l-1', project: 'demo', adminRecord: 'wt-x' };
    expect(buildAdoptionFeedRow(lease, iso(T0), 'changed')).toEqual({ title: 'worktree kept: demo/wt-x',
      body: `Delegated work left this worktree changed; it is kept until ${iso(T0)} (lease l-1).` });
    expect(buildAdoptionFeedRow(lease, iso(T0), 'unchecked')).toEqual({ title: 'worktree kept: demo/wt-x',
      body: `This delegated worktree is kept because its changes could not be checked, until ${iso(T0)} (lease l-1).` });
    const item = { leaseId: 'l-1', generation: 2, canonicalPath: '/w/demo/wt-x', parentId: 'lane-a-demo', expiresAt: iso(T0) };
    const first = (audit?: 'changed' | 'unchecked') =>
      buildLeaseDigest('lane-a-demo', audit === undefined ? item : { ...item, audit }, { retain: true, promote: false }).body.split('\n')[0];
    expect(first('changed')).toBe('A worktree that delegated work by lane-a-demo left changed is kept: /w/demo/wt-x');
    expect(first('unchecked')).toBe('A worktree of delegated work by lane-a-demo is kept because its changes could not be checked: /w/demo/wt-x');
    expect(first(), 'not remembered (a restart): it claims neither').toBe('A worktree of delegated work by lane-a-demo is kept: /w/demo/wt-x');
  });

  it('F10: PR6\'s re-reads and adoption\'s reads share one comparator: never read first, then the least recently read, then the given order', () => {
    expect(leastRecentlyRead(['a', 'b', 'c', 'd'], new Map([['a', 3], ['b', 1], ['d', 1]]), 3)).toEqual(['c', 'b', 'd']);
    const one = ended();
    const l0 = one.leases[0]!;
    const leases = Array.from({ length: 10 }, (_, i) => ({ ...l0, leaseId: `5b0d9d9e-6d3c-4d2e-9f7a-0a1b2c3d4f${String(i).padStart(2, '0')}`,
      adminRecord: `wt-${i}`, creatingJournalSequence: 5 + i }));
    const cp = { ...one, leases };
    const lastRead = new Map(leases.map((l, i) => [l.leaseId, 10 - i] as const));
    const { carriers: _unused, ...input } = base(cp, SETTLED, {
      treePresent: new Set(leases.map((l) => delegationTreeKey(l.project, l.adminRecord))),
      watch: new Map(leases.map((l) => [l.leaseId, { generation: 1, terminalAt: iso(T0), passes: 2 }])),
    });
    expect(adoptionCarrierReads(input, lastRead)).toEqual(carrierReadsOf(cp, lastRead).reverify);
    expect(adoptionCarrierReads(input, lastRead)).toEqual(leases.slice(2).reverse().map((l) => l.leaseId));
  });
});
