// Session helpers S2 (D-8874; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.2, Table 10; plan
// docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2): EVERY READER OF TABLE 10, each as a test, and review 3026 F3.
// A record S2's pass closed reads `executionState: 'ended'`, `endedAt: null`, `endBasis: 'backfill-unmeasured'`. Each case writes
// such a row by hand (as S1's file did) and reaches the reader by behaviour, never through S2's new module, so each case reds on its
// own assertion against `main` (measured at 137f96672c), or is a CHARACTERIZATION PIN, labelled so, of what `main` already does and
// S2 must keep:
//   - RED on main: R-L1 (lease liveness reads the basis: review 2900 F1, the corrected first row), R-C1 (the identity hold), R-C2 (the
//     workflow hold), R-C3 (the retirable set), R-C4 (`retireBehindCut`), R-F3 (`openWorkflowWorkerFromMeta`, review 3026 F3).
//   - PIN: R-L2 (the activity rows drop it), R-A1 (`terminalOf`), R-A2 (`activityEnded`), R-C5 (the raw-lease window), R-Z1
//     (`retireZeroDeltaBash`), R-V1 (`assertDelegationCheckpointProjectable`).
// Every directory is a FIXTURE; nothing reads the live `~/.ccrc`.
import { describe, it, expect } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  delegationSha256Hex,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
  type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import { DELEGATION_RETENTION_FLOOR_MS, buildDelegationJournalRecord, encodeDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import {
  DelegationCheckpointBuilder,
  DelegationCheckpointError,
  assertDelegationCheckpointProjectable,
  delegationRecordNaming,
} from '../src/coord/delegation-checkpoint.js';
import { recoverDelegation } from '../src/coord/delegation-recovery.js';
import { DelegationCompactionPlanner, type DelegationCompactionPlan } from '../src/coord/delegation-compaction.js';
import { projectDelegation, type DelegationProjectionInput, type DelegationProjectionSession } from '../src/coord/delegation-projection.js';
import { decideAdoption, type AdoptionInput, type ParentFact } from '../src/coord/delegation-adoption.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { checkpointWithLease, equalCarrier } from './delegationLeaseFixture.js';

type Row = DelegationActivityRow;
const P = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const D0 = Date.UTC(2026, 9, 1);
const iso = (ms: number): string => formatDelegationInstant(ms);

/** A record as S2's pass leaves it: closed, no end time, the backfill's basis. */
const backfilled = (a: Row): Row => ({ ...a, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });
/** A record with a measured end, the way every end before S1 is written. */
const endedAt = (a: Row, ms: number): Row => ({ ...a, executionState: 'ended', endedAt: iso(ms), lastEventAt: iso(ms) });

let serial = 0;
const base = (ms: number) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: iso(ms), sessionId: P, parentIncarnation: INC, claudeSessionId: CLAUDE,
    eventId: delegationSha256Hex(`s2-readers-event-${n}`), bucket: '2026100100', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
type Ev = DelegationEventEnvelopeV1;
const sessionStart = (ms: number): Ev => ({ ...base(ms), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (ms: number, agentId: string): Ev => ({ ...base(ms), eventKind: 'SubagentStart', agentId, agentType: null });
const subagentStop = (ms: number, agentId: string): Ev => ({ ...base(ms), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const wfLaunch = (ms: number, runId: string): Ev => ({
  ...base(ms), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_${runId}`, outcome: 'async-launched',
  launch: { status: 'async-launched', taskId: `task_${runId}`, taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `/work/t/${runId}`, scriptPath: '/work/s.js' },
});
const bashPre = (ms: number, toolUseId: string): Ev => ({ ...base(ms), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId });

function chain(events: readonly Ev[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: iso(Date.parse(event.observedAt) + 1000), previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    out.push(r);
    prev = r.digest;
  });
  return out;
}
const recovered = (records: readonly DelegationJournalRecordV1[]): DelegationCheckpointV1 => {
  const report = recoverDelegation(null, records);
  expect(report.failure, 'the fixture journal recovers').toBeNull();
  return report.state.checkpoint as DelegationCheckpointV1;
};
const pick = (cp: DelegationCheckpointV1, sourceKind: Row['sourceKind'], upstreamId: string): Row =>
  cp.activities.find((a) => a.sourceKind === sourceKind && a.upstreamId === upstreamId)!;
const editRows = (cp: DelegationCheckpointV1, ids: readonly string[], edit: (a: Row) => Row): DelegationCheckpointV1 =>
  ({ ...cp, activities: cp.activities.map((a) => (ids.includes(a.activityId) ? edit(a) : a)) });

// ── the projection (the frame): spec Table 10, rows 1 and 2 ─────────────────────────────────────────────────────────

const PROJECT = 'project-a';
const T = Date.parse('2026-10-20T00:00:00.000Z');
const at = (min: number): string => iso(T + min * MIN);
const activity = (over: Partial<Row> & { activityId: string }): Row => ({
  parentId: 'p', parentIncarnation: 'inc-p', sourceKind: 'agent', upstreamId: `up-${over.activityId}`, identityJournalId: 'j-1',
  displayName: null, executionState: 'active', openedAt: at(10), endedAt: null, lastEventAt: at(11), ...over,
});
const leaseOf = (activityId: string): DelegationLeaseRow => ({
  leaseId: 'lease-1', generation: 1, creatingJournalSequence: 1, currentJournalSequence: 1, activityId, parentId: 'p', parentIncarnation: 'inc-p',
  project: PROJECT, adminRecord: 'wt-1', canonicalPath: '/fixture/wt-1', creationBase: null, sourceKind: 'agent', parentageState: 'linked',
  workspaceState: 'present', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease',
  firstObservedAt: at(12), lastObservedAt: at(12), terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null,
  cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null,
});
const present: DelegationCensusRecord = {
  project: PROJECT, adminRecord: 'wt-1', canonicalPath: '/fixture/wt-1', headBranch: null, headSha: null, claudeBase: null,
  locked: false, baseAgreesFirstLog: null, state: 'present', diagnostic: null,
};
const alive: DelegationProjectionSession = { id: 'p', presence: 'alive', lifecycle: 'running' };
const frame = (activities: Row[], leases: DelegationLeaseRow[], sessions: DelegationProjectionSession[]): ReturnType<typeof projectDelegation> =>
  projectDelegation({
    checkpoint: { activities, leases, attempts: [] },
    census: { measuredAt: T + 30 * MIN, projects: new Map([[PROJECT, { delegation: [present] }]]), incarnations: new Map([['p', { kind: 'measured', incarnation: 'inc-p' }]]) },
    absences: [], sessions, refused: new Set(), runs: [],
  } satisfies DelegationProjectionInput);

describe('S2, Table 10: the projection', () => {
  it('R-L1 (red on main; review 2900 F1): a lease row whose activity the pass closed reads as it read before, never `ended`', () => {
    const closed = backfilled(activity({ activityId: 'a1' }));
    expect(frame([closed], [leaseOf('a1')], [alive]).leases.map((l) => l.liveness), 'parent alive in its own incarnation').toEqual(['live']);
    expect(frame([closed], [leaseOf('a1')], []).leases.map((l) => l.liveness), 'parent gone').toEqual(['stale']);
    expect(frame([endedAt(activity({ activityId: 'a1' }), T + 15 * MIN)], [leaseOf('a1')], [alive]).leases.map((l) => l.liveness),
      'a measured end is still `ended`').toEqual(['ended']);
  });

  it('R-L2 (pin): the activity rows drop a record the pass closed, as they drop every ended record', () => {
    const out = frame([backfilled(activity({ activityId: 'a1' })), backfilled(activity({ activityId: 'w1', sourceKind: 'workflow' })), activity({ activityId: 'a2' })], [], [alive]);
    expect(out.activities.map((a) => a.activityId)).toEqual(['a2']);
  });
});

// ── adoption: spec Table 10, rows 3 and 4 ───────────────────────────────────────────────────────────────────────────

describe('S2, Table 10: the adoption decider', () => {
  const decide = (activity: Row, parent: ParentFact, watch: AdoptionInput['watch'] = new Map()) => {
    const cp0 = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1, activityId: activity.activityId });
    const cp: DelegationCheckpointV1 = { ...cp0, activities: [{ ...activity, parentId: cp0.leases[0]!.parentId, parentIncarnation: cp0.leases[0]!.parentIncarnation }] };
    const l = cp.leases[0]!;
    const input: AdoptionInput = {
      now: iso(D0 + 2 * DAY), checkpoint: cp, carriers: new Map([[l.leaseId, equalCarrier(l)]]), treePresent: new Set([delegationTreeKey(l.project, l.adminRecord)]),
      censused: new Set([l.project]), audits: new Map(), watch, parents: new Map([[l.parentId, parent]]), conflicting: new Set<string>(),
      boxHolds: true, breaker: 'clear', marker: 'present',
    };
    return { l, out: decideAdoption(input) };
  };
  const live = (incarnation: string): ParentFact => ({ registry: 'present', incarnation, deadSince: null, ccd: true, alive: true, retractedAt: null, lastAlive: [] });
  const gone: ParentFact = { registry: 'absent', incarnation: null, deadSince: null, ccd: false, alive: null, retractedAt: null, lastAlive: [] };
  const open = (): Row => ({ activityId: 'act-1', parentId: 'x', parentIncarnation: 'x', sourceKind: 'agent', upstreamId: 'agent-1', identityJournalId: 'b'.repeat(64),
    displayName: null, executionState: 'active', openedAt: iso(D0), endedAt: null, lastEventAt: iso(D0) });

  it('R-A1 (pin): `terminalOf` takes no terminal evidence from a closed record: under a live parent no watch starts; under a gone one, the parent\'s', () => {
    const lease = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1 }).leases[0]!;
    expect(decide(backfilled(open()), live(lease.parentIncarnation)).out.watch.get(lease.leaseId), 'no end time, a live parent').toBeUndefined();
    expect(decide(backfilled(open()), gone).out.watch.get(lease.leaseId)?.terminalAt, 'the parent\'s death, at the first pass').toBe(iso(D0 + 2 * DAY));
  });

  it('R-A2 (pin): `activityEnded` reads a closed record as not ended, so a watch is disproved by a live parent as for an open one', () => {
    const lease = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1 }).leases[0]!;
    const watch = new Map([[lease.leaseId, { generation: 1, terminalAt: iso(D0 + DAY), passes: 1 }]]);
    const closed = decide(backfilled(open()), live(lease.parentIncarnation), watch).out.watch.get(lease.leaseId);
    const stillOpen = decide(open(), live(lease.parentIncarnation), watch).out.watch.get(lease.leaseId);
    expect(closed, 'the same answer as an open record').toEqual(stillOpen);
    expect(closed, 'disproved: the parent is alive at the lease\'s incarnation').toBeUndefined();
  });
});

// ── compaction: spec Table 10, rows 5 to 7 ──────────────────────────────────────────────────────────────────────────

/** The planner over an in-memory journal, at `nowMs` with the 10-day floor, over `checkpoint`. */
function planOf(records: readonly DelegationJournalRecordV1[], checkpoint: DelegationCheckpointV1, nowMs: number): DelegationCompactionPlan {
  const planner = new DelegationCompactionPlanner({ checkpoint, ready: true, nowMs, floorMs: DELEGATION_RETENTION_FLOOR_MS, naming: delegationRecordNaming });
  let offset = 0;
  for (const r of records) {
    const length = encodeDelegationJournalRecord(r).length;
    planner.add(r, { offset, length });
    offset += length;
  }
  return planner.finish(offset);
}
const reasonsAt = (plan: DelegationCompactionPlan, seq: number): readonly string[] | undefined => plan.carried.find((l) => l.sequence === seq)?.reasons;

describe('S2, Table 10: compaction', () => {
  // Day 0: an agent A (open), an agent E (started and stopped), a workflow run R (open); then filler inside the floor.
  const records = chain([subagentStart(D0 + MIN, 'agent-a'), subagentStart(D0 + 2 * MIN, 'agent-e'), subagentStop(D0 + 3 * MIN, 'agent-e'),
    wfLaunch(D0 + 4 * MIN, 'wf_r'), sessionStart(D0 + 11 * DAY), sessionStart(D0 + 11 * DAY + HOUR)]);
  const now = D0 + 12 * DAY;
  const cp = recovered(records);
  const A = pick(cp, 'agent', 'agent-a');
  const E = pick(cp, 'agent', 'agent-e');
  const R = pick(cp, 'workflow', 'wf_r');
  const closedCp = editRows(cp, [A.activityId, R.activityId], backfilled);

  it('R-C1 (red on main): the identity hold holds a closed record\'s identity record, as an open record\'s', () => {
    expect(reasonsAt(planOf(records, cp, now), 1), 'open').toEqual(['active-identity']);
    expect(reasonsAt(planOf(records, closedCp, now), 1), 'closed by the pass').toEqual(['active-identity']);
  });

  it('R-C2 (red on main): the workflow hold holds a closed run\'s launch, as an open run\'s', () => {
    expect(reasonsAt(planOf(records, cp, now), 4), 'open').toEqual(['active-identity', 'active-workflow-launch']);
    expect(reasonsAt(planOf(records, closedCp, now), 4), 'closed by the pass').toEqual(['active-identity', 'active-workflow-launch']);
  });

  it('R-C3 (red on main): the retirable set never takes a record the pass closed; a measured end is still retired', () => {
    const plan = planOf(records, closedCp, now);
    expect(plan.retirable, 'E ended by its Stop').toContain(E.activityId);
    expect(plan.retirable).not.toContain(A.activityId);
    expect(plan.retirable).not.toContain(R.activityId);
  });

  it('R-C4 (red on main): `retireBehindCut` refuses a record the pass closed, as it refuses an open one', () => {
    const code = (ids: string[]): string => {
      try { DelegationCheckpointBuilder.from(closedCp).retireBehindCut(ids); } catch (err) { if (err instanceof DelegationCheckpointError) return err.code; throw err; }
      return 'retired';
    };
    expect(code([A.activityId])).toBe('change-refused');
    expect(code([R.activityId])).toBe('change-refused');
    expect(code([E.activityId]), 'a measured end is retired').toBe('retired');
  });

  it('R-C5 (pin): a raw lease\'s window on a closed activity ends at its openedAt (`endedAt ?? openedAt`)', () => {
    const bash: Row = backfilled({ activityId: 'act-b', parentId: P, parentIncarnation: INC, sourceKind: 'bash-worktree', upstreamId: 'toolu_b', identityJournalId: 'c'.repeat(64),
      displayName: null, executionState: 'active', openedAt: iso(D0 + MIN), endedAt: null, lastEventAt: iso(D0 + MIN) });
    const rec = chain([bashPre(D0 + MIN, 'toolu_b'), sessionStart(D0 + 2 * HOUR), sessionStart(D0 + 11 * DAY), sessionStart(D0 + 11 * DAY + HOUR)]);
    const raw = { ...leaseOf('act-b'), sourceKind: 'raw' as const, firstObservedAt: iso(D0 + MIN) };
    const withLease: DelegationCheckpointV1 = { ...recovered(rec), activities: [bash], leases: [raw] };
    const plan = planOf(rec, withLease, now);
    expect(reasonsAt(plan, 1), 'the call itself').toContain('raw-lease-window');
    expect(reasonsAt(plan, 2), 'two hours after it opened: outside a window that ends at openedAt').toBeUndefined();
  });
});

// ── the builder's other readers ─────────────────────────────────────────────────────────────────────────────────────

describe('S2, Table 10: the builder', () => {
  it('R-Z1 (pin): `retireZeroDeltaBash` never retires a closed bash-worktree record: it has no listing fact', () => {
    const rec = chain([sessionStart(D0), bashPre(D0 + MIN, 'toolu_z')]);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    for (const r of rec) b.foldRecord(r);
    expect(b.retirableZeroDeltaBash()).toEqual([]);
  });

  it('R-V1 (pin): `assertDelegationCheckpointProjectable` accepts a closed record: the basis requires a null endedAt', () => {
    const cp = recovered(chain([sessionStart(D0), subagentStart(D0 + MIN, 'agent-a')]));
    const closed = editRows(cp, [pick(cp, 'agent', 'agent-a').activityId], backfilled);
    expect(() => assertDelegationCheckpointProjectable(closed)).not.toThrow();
  });

  it('R-F3 (red on main; review 3026 F3): a worker the meta door opens under a run the pass closed opens closed by it too', () => {
    const cp = recovered(chain([sessionStart(D0), wfLaunch(D0 + MIN, 'wf_m')]));
    const run = pick(cp, 'workflow', 'wf_m');
    const open = (checkpoint: DelegationCheckpointV1): Row | undefined => {
      const b = DelegationCheckpointBuilder.from(checkpoint);
      expect(b.openWorkflowWorkerFromMeta(P, INC, 'wf_m', 0).kind).toBe('opened');
      return b.build(2).activities.find((a) => a.upstreamId === 'wf_m-0');
    };
    expect(open(editRows(cp, [run.activityId], backfilled)), 'under a closed run')
      .toMatchObject({ executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured', openedAt: run.openedAt });
    expect(open(cp), 'under an open run it opens active, as before').toMatchObject({ executionState: 'active', endedAt: null });
    const ended = open(editRows(cp, [run.activityId], (a) => endedAt(a, D0 + 2 * MIN)));
    expect(ended, 'under a run with a measured end it opens ended at that end, as before').toMatchObject({ executionState: 'ended', endedAt: iso(D0 + 2 * MIN) });
    expect(ended).not.toHaveProperty('endBasis');
  });
});
