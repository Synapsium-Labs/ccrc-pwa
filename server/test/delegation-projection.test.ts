// Delegation broker wave 4, PR1 Task 1.2: the PURE projection decider.
//
// `projectDelegation` turns the lane's checkpoint, the census and the registry into the `delegation` frame's payload. It reads no
// clock, makes no IO and makes no durable write. The rows below are the plan's W4-P1 to W4-P16 and pin its mutants W4-M02 to W4-M23.
//
// Fixtures only: names are `lane-a-demo`-shaped ids (`p`, `w`, `c`), `project-a` and `/fixture/...`. No file is read or written.
import { describe, it, expect } from 'vitest';
import {
  DELEGATION_PROJECTION_CLOSED_RUNS,
  isDelegationProjectionKebab,
  projectDelegation,
  type DelegationProjectionInput,
  type DelegationProjectionRun,
  type DelegationProjectionSession,
} from '../src/coord/delegation-projection.js';
import {
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationCensusRecord,
  type DelegationLeaseRow,
} from '../src/coord/delegation-model.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_CREATOR_KINDS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS } from '../../shared/api.js';

const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (min: number): string => formatDelegationInstant(T0 + min * 60_000);
const ms = (min: number): number => T0 + min * 60_000;
const PROJECT = 'project-a';

function activity(over: Partial<DelegationActivityRow> & { activityId: string }): DelegationActivityRow {
  return {
    parentId: 'p', parentIncarnation: 'inc-p', sourceKind: 'agent', upstreamId: `up-${over.activityId}`, identityJournalId: 'j-1',
    displayName: null, executionState: 'active', openedAt: at(10), endedAt: null, lastEventAt: at(11), ...over,
  };
}
function lease(over: Partial<DelegationLeaseRow> & { leaseId: string; adminRecord: string }): DelegationLeaseRow {
  return {
    generation: 1, creatingJournalSequence: 1, currentJournalSequence: 1, activityId: 'a-none', parentId: 'p', parentIncarnation: 'inc-p',
    project: PROJECT, canonicalPath: `/fixture/${over.adminRecord}`, creationBase: null, sourceKind: 'agent', parentageState: 'linked',
    workspaceState: 'present', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease',
    firstObservedAt: at(12), lastObservedAt: at(12), terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null,
    cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null, cleanupEvidenceJson: null, carrierGenerationSeen: null,
    releasedAt: null, ...over,
  };
}
function attempt(over: Partial<DelegationAttemptRow> & { attemptId: string; adminRecord: string }): DelegationAttemptRow {
  return {
    parentId: 'p', parentIncarnation: 'inc-p', project: PROJECT, canonicalPath: `/fixture/${over.adminRecord}`, attemptedAt: at(20),
    rung: null, verdict: 'unresolved', evidenceJournalIds: [], detail: 'no-correlating-evidence', ...over,
  };
}
function record(adminRecord: string, over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord {
  return {
    project: PROJECT, adminRecord, canonicalPath: `/fixture/${adminRecord}`, headBranch: null, headSha: null, claudeBase: null,
    locked: false, baseAgreesFirstLog: null, state: 'present', diagnostic: null, ...over,
  };
}
type Inc = { kind: 'measured'; incarnation: string } | { kind: 'unmeasured' };
function census(
  projects: Record<string, DelegationCensusRecord[] | null> = { [PROJECT]: [] },
  incarnations: Record<string, Inc> = { p: { kind: 'measured', incarnation: 'inc-p' } },
  measuredAt = ms(30),
): DelegationProjectionInput['census'] {
  return {
    measuredAt,
    projects: new Map(Object.entries(projects).map(([k, v]) => [k, { delegation: v }])),
    incarnations: new Map(Object.entries(incarnations)),
  };
}
const alive = (id: string, over: Partial<DelegationProjectionSession> = {}): DelegationProjectionSession => ({ id, status: 'idle', ...over });
function run(id: number, sessionId: string, claimedBy: string | null, openedMin: number, closedMin: number | null): DelegationProjectionRun {
  return { id, sessionId, claimedBy, openedAt: ms(openedMin), closedAt: closedMin === null ? null : ms(closedMin) };
}
function input(over: {
  activities?: DelegationActivityRow[]; leases?: DelegationLeaseRow[]; attempts?: DelegationAttemptRow[];
  census?: DelegationProjectionInput['census']; absences?: { project: string; adminRecord: string }[];
  sessions?: DelegationProjectionSession[]; runs?: DelegationProjectionRun[];
}): DelegationProjectionInput {
  return {
    checkpoint: { activities: over.activities ?? [], leases: over.leases ?? [], attempts: over.attempts ?? [] },
    census: over.census ?? census(), absences: over.absences ?? [], sessions: over.sessions ?? [alive('p')], runs: over.runs ?? [],
  };
}

describe('projectDelegation: activity rows and liveness', () => {
  it('W4-P1: a live agent activity under an alive parent in its own incarnation is one row', () => {
    const out = projectDelegation(input({ activities: [activity({ activityId: 'a1', displayName: 'explore' })] }));
    expect(out.activities).toEqual([{
      activityId: 'a1', parentId: 'p', group: 'parent', placement: 'row', sourceKind: 'agent', upstreamId: 'up-a1',
      displayName: 'explore', liveness: 'live', openedAt: at(10), lastEventAt: at(11),
    }]);
    expect(out.leases).toEqual([]);
    expect(out.unowned).toEqual([]);
  });

  it('W4-P2: an ended activity is not a row, and a bash-worktree activity is never one', () => {
    const out = projectDelegation(input({ activities: [
      activity({ activityId: 'a-ended', executionState: 'ended', endedAt: at(15) }),
      activity({ activityId: 'a-bash', sourceKind: 'bash-worktree' }),
      activity({ activityId: 'a-wf', sourceKind: 'workflow' }),
    ] }));
    expect(out.activities.map((a) => a.activityId)).toEqual(['a-wf']);
  });

  it('W4-P3: a dead parent reads stale, never live', () => {
    const out = projectDelegation(input({ activities: [activity({ activityId: 'a1' })], sessions: [alive('p', { status: 'dead' })] }));
    expect(out.activities.map((a) => a.liveness)).toEqual(['stale']);
  });

  it('W4-P4: another incarnation reads stale; an unmeasured or absent incarnation reads unmeasured; an unknown execution unmeasured', () => {
    const one = (inc: Record<string, Inc>, over: Partial<DelegationActivityRow> = {}) =>
      projectDelegation(input({ activities: [activity({ activityId: 'a1', ...over })], census: census(undefined, inc) })).activities[0]!.liveness;
    expect(one({ p: { kind: 'measured', incarnation: 'inc-other' } })).toBe('stale');
    expect(one({ p: { kind: 'unmeasured' } })).toBe('unmeasured');
    expect(one({})).toBe('unmeasured');
    expect(one({ p: { kind: 'measured', incarnation: 'inc-p' } }, { executionState: 'unknown' })).toBe('unmeasured');
  });

  it('W4-P5: an unlisted parent: the activity is stale, and the lease sits in offline-coordinator under its own parent', () => {
    const out = projectDelegation(input({
      activities: [activity({ activityId: 'a1' }), activity({ activityId: 'a2', sourceKind: 'agent' })],
      leases: [lease({ leaseId: 'l2', adminRecord: 't2', activityId: 'a2' })],
      census: census({ [PROJECT]: [record('t2')] }), sessions: [],
    }));
    expect(out.activities.map((a) => [a.activityId, a.liveness, a.group])).toEqual([['a1', 'stale', 'offline-coordinator']]);
    expect(out.leases.map((l) => [l.leaseId, l.parentId, l.group, l.liveness])).toEqual([['l2', 'p', 'offline-coordinator', 'stale']]);
  });
});

describe('projectDelegation: presence of a tree', () => {
  const leaseOn = (adminRecord: string) => lease({ leaseId: `l-${adminRecord}`, adminRecord });

  it('W4-P6: present, absent under a measured project, and unmeasured otherwise', () => {
    const present = projectDelegation(input({ leases: [leaseOn('t1')], census: census({ [PROJECT]: [record('t1')] }) }));
    expect(present.leases.map((l) => l.workspace)).toEqual(['present']);
    const absent = projectDelegation(input({ leases: [leaseOn('t1')], absences: [{ project: PROJECT, adminRecord: 't1' }] }));
    expect(absent.leases, 'a measured absence is no row').toEqual([]);
    const nullProject = projectDelegation(input({
      leases: [leaseOn('t1')], census: census({ [PROJECT]: null }), absences: [{ project: PROJECT, adminRecord: 't1' }],
    }));
    expect(nullProject.leases.map((l) => l.workspace), 'an unmeasured project is never absent').toEqual(['unmeasured']);
    const missing = projectDelegation(input({ leases: [leaseOn('t1')], census: census({}), absences: [{ project: PROJECT, adminRecord: 't1' }] }));
    expect(missing.leases.map((l) => l.workspace), 'a project the census does not hold').toEqual(['unmeasured']);
    const notListed = projectDelegation(input({ leases: [leaseOn('t1')] }));
    expect(notListed.leases.map((l) => l.workspace), 'no record and no absence').toEqual(['unmeasured']);
  });
});

describe('projectDelegation: R9, one level, bound to the run live at the instant', () => {
  it('W4-P7: lineage outlives its run: a closed run still answers for an instant inside its interval', () => {
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', parentId: 'w', firstObservedAt: at(12) })],
      sessions: [alive('w'), alive('c')], runs: [run(5, 'w', 'c', 0, 20)],
    }));
    expect(out.leases.map((l) => [l.parentId, l.via, l.group])).toEqual([['c', 'w', 'parent']]);
  });

  it('W4-P9: nesting is one level: a coordinator that is itself a worker is not followed', () => {
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', parentId: 'w', firstObservedAt: at(12) })],
      sessions: [alive('w'), alive('c1'), alive('c2')], runs: [run(5, 'w', 'c2', 0, null), run(3, 'c2', 'c1', 0, null)],
    }));
    expect(out.leases.map((l) => [l.parentId, l.via])).toEqual([['c2', 'w']]);
  });

  it('W4-P11: an activity whose parent is a run\'s worker is a chip under the worker itself', () => {
    const out = projectDelegation(input({
      activities: [activity({ activityId: 'a1', parentId: 'w', parentIncarnation: 'inc-w', openedAt: at(10) })],
      census: census(undefined, { w: { kind: 'measured', incarnation: 'inc-w' } }),
      sessions: [alive('w'), alive('c')], runs: [run(5, 'w', 'c', 0, null)],
    }));
    expect(out.activities.map((a) => [a.parentId, a.placement, a.liveness])).toEqual([['w', 'chip', 'live']]);
    const outside = projectDelegation(input({
      activities: [activity({ activityId: 'a1', parentId: 'w', parentIncarnation: 'inc-w', openedAt: at(30) })],
      census: census(undefined, { w: { kind: 'measured', incarnation: 'inc-w' } }),
      sessions: [alive('w'), alive('c')], runs: [run(5, 'w', 'c', 0, 20)],
    }));
    expect(outside.activities.map((a) => a.placement), 'opened after its run closed').toEqual(['row']);
  });

  it('W4-P15 (D-6999): a programme worker\'s raw lease nests under the coordinator, via the worker, marked inferred', () => {
    const out = projectDelegation(input({
      activities: [activity({ activityId: 'a-bash', parentId: 'w', sourceKind: 'bash-worktree', upstreamId: 'toolu_wt9' })],
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', parentId: 'w', sourceKind: 'raw', activityId: 'a-bash', firstObservedAt: at(12) })],
      sessions: [alive('w'), alive('c')], runs: [run(5, 'w', 'c', 0, null)],
    }));
    expect(out.leases.map((l) => [l.parentId, l.via, l.inferred])).toEqual([['c', 'w', { creator: { kind: 'bash-call', toolUseId: 'toolu_wt9' } }]]);
  });

  it('W4-P16: one id, two coordinators: each lease binds to the run live at its first observation', () => {
    const leases = [
      lease({ leaseId: 'l-run3', adminRecord: 't3', parentId: 'w', firstObservedAt: at(5) }),
      lease({ leaseId: 'l-run5', adminRecord: 't5', parentId: 'w', firstObservedAt: at(25) }),
      lease({ leaseId: 'l-after', adminRecord: 't9', parentId: 'w', firstObservedAt: at(45) }),
    ];
    const out = projectDelegation(input({
      leases, sessions: [alive('w'), alive('c1'), alive('c2')], runs: [run(3, 'w', 'c1', 0, 10), run(5, 'w', 'c2', 20, 40)],
    }));
    expect(out.leases.map((l) => [l.leaseId, l.parentId, l.via])).toEqual([
      ['l-run3', 'c1', 'w'], ['l-run5', 'c2', 'w'], ['l-after', 'w', null],
    ]);
  });

  it('R9 ignores a run claimed by nobody or by the worker itself', () => {
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', parentId: 'w', firstObservedAt: at(12) })],
      sessions: [alive('w')], runs: [run(5, 'w', null, 0, null), run(6, 'w', 'w', 0, null)],
    }));
    expect(out.leases.map((l) => [l.parentId, l.via])).toEqual([['w', null]]);
    expect(DELEGATION_PROJECTION_CLOSED_RUNS).toBe(200);
  });
});

describe('projectDelegation: programme ownership, the inferred marker and unowned work', () => {
  it('W4-P8: a tree on a listed session\'s workdir is neither a lease row nor an unowned row', () => {
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1' })],
      attempts: [attempt({ attemptId: 'x1', adminRecord: 't2' })],
      census: census({ [PROJECT]: [record('t1'), record('t2')] }),
      sessions: [alive('p'), alive('ws-1', { workdir: '/fixture/t1' }), alive('ws-2', { workdir: '/fixture/t2' })],
    }));
    expect(out.leases).toEqual([]);
    expect(out.unowned).toEqual([]);
  });

  it('W4-P10 (D-6999): every raw lease carries inferred; an agent lease does not', () => {
    const out = projectDelegation(input({
      activities: [activity({ activityId: 'a-bash', sourceKind: 'bash-worktree', upstreamId: 'toolu_wt1', executionState: 'ended' })],
      leases: [
        lease({ leaseId: 'l-raw', adminRecord: 't1', sourceKind: 'raw', activityId: 'a-bash' }),
        lease({ leaseId: 'l-raw-orphan', adminRecord: 't2', sourceKind: 'raw', activityId: 'a-gone', firstObservedAt: at(13) }),
        lease({ leaseId: 'l-agent', adminRecord: 't3', sourceKind: 'agent', activityId: 'a-gone2', firstObservedAt: at(14) }),
      ],
    }));
    expect(out.leases.map((l) => [l.leaseId, l.parentId, l.via, l.liveness, l.inferred])).toEqual([
      ['l-raw', 'p', null, 'ended', { creator: { kind: 'bash-call', toolUseId: 'toolu_wt1' } }],
      ['l-raw-orphan', 'p', null, 'unmeasured', { creator: { kind: 'unmeasured' } }],
      ['l-agent', 'p', null, 'unmeasured', null],
    ]);
  });

  it('a released lease is no row, and an activity a lease names is shown as its lease', () => {
    const out = projectDelegation(input({
      activities: [activity({ activityId: 'a1' }), activity({ activityId: 'a2', openedAt: at(11) })],
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', activityId: 'a1' }),
        lease({ leaseId: 'l2', adminRecord: 't2', activityId: 'a2', releasedAt: at(20) })],
    }));
    expect(out.activities.map((a) => a.activityId)).toEqual(['a2']);
    expect(out.leases.map((l) => [l.leaseId, l.liveness])).toEqual([['l1', 'live']]);
  });

  it('W4-P12: unowned rows from attempts, by R59\'s one classifier, newest per tree, and the conflict rules', () => {
    const base = projectDelegation(input({
      attempts: [attempt({ attemptId: 'x1', adminRecord: 't1', rung: 2 })], census: census({ [PROJECT]: [record('t1')] }),
    }));
    expect(base.unowned).toEqual([{
      project: PROJECT, adminRecord: 't1', canonicalPath: '/fixture/t1', verdict: 'unresolved', reason: 'no-correlating-evidence',
      rung: 2, workspace: 'present', attemptedAt: at(20),
    }]);
    for (const detail of ['ccrc-birth-wait', 'ccd-workspace-not-a-lease', 'evidence-horizon']) {
      expect(projectDelegation(input({ attempts: [attempt({ attemptId: 'x1', adminRecord: 't1', detail })] })).unowned, detail).toEqual([]);
    }
    const newer = projectDelegation(input({ attempts: [
      attempt({ attemptId: 'x2', adminRecord: 't1', attemptedAt: at(25), detail: 'overlapping-listing-window' }),
      attempt({ attemptId: 'x1', adminRecord: 't1', attemptedAt: at(20) }),
    ] }));
    expect(newer.unowned.map((u) => u.reason)).toEqual(['overlapping-listing-window']);
    const agentConflict = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1' })],
      attempts: [attempt({ attemptId: 'x1', adminRecord: 't1', verdict: 'conflicting', detail: 'rungs-disagree' })],
    }));
    expect(agentConflict.leases, 'a conflict makes an agent lease\'s tree unowned work').toEqual([]);
    expect(agentConflict.unowned.map((u) => [u.adminRecord, u.verdict])).toEqual([['t1', 'conflicting']]);
    const rawConflict = projectDelegation(input({
      activities: [activity({ activityId: 'a-bash', sourceKind: 'bash-worktree', upstreamId: 'toolu_wt1' })],
      leases: [lease({ leaseId: 'l1', adminRecord: 't1', sourceKind: 'raw', activityId: 'a-bash' })],
      attempts: [attempt({ attemptId: 'x1', adminRecord: 't1', verdict: 'conflicting', detail: 'rungs-disagree' })],
    }));
    expect(rawConflict.leases.map((l) => [l.leaseId, l.inferred]), 'a raw lease keeps its row on a conflict')
      .toEqual([['l1', { creator: { kind: 'bash-call', toolUseId: 'toolu_wt1' } }]]);
    expect(rawConflict.unowned.map((u) => [u.adminRecord, u.verdict])).toEqual([['t1', 'conflicting']]);
    const heldUnresolved = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1' })], attempts: [attempt({ attemptId: 'x1', adminRecord: 't1' })],
    }));
    expect(heldUnresolved.unowned, 'a leased tree\'s unresolved attempt is not unowned work').toEqual([]);
    expect(heldUnresolved.leases.map((l) => l.leaseId)).toEqual(['l1']);
    const absent = projectDelegation(input({
      attempts: [attempt({ attemptId: 'x1', adminRecord: 't1' })], absences: [{ project: PROJECT, adminRecord: 't1' }],
    }));
    expect(absent.unowned, 'a measured-absent tree').toEqual([]);
  });

  it('a superseded conflict: a newer unresolved attempt on a leased tree leaves the agent lease its row (D-7003)', () => {
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 't1' })],
      attempts: [
        attempt({ attemptId: 'x1', adminRecord: 't1', verdict: 'conflicting', detail: 'rungs-disagree', attemptedAt: at(20) }),
        attempt({ attemptId: 'x2', adminRecord: 't1', verdict: 'unresolved', attemptedAt: at(25) }),
      ],
    }));
    expect(out.leases.map((l) => l.leaseId), 'the tree never vanishes from both groups').toEqual(['l1']);
    expect(out.unowned).toEqual([]);
  });
});

describe('projectDelegation: order, instant and words', () => {
  it('W4-P13: the output is byte-identical when the inputs are permuted, and asOf is the census instant', () => {
    const activities = [activity({ activityId: 'a2', openedAt: at(10) }), activity({ activityId: 'a1', openedAt: at(10) }),
      activity({ activityId: 'a0', parentId: 'q', openedAt: at(1) })];
    const leases = [lease({ leaseId: 'l2', adminRecord: 't2' }), lease({ leaseId: 'l1', adminRecord: 't1' }),
      lease({ leaseId: 'l0', adminRecord: 't0', firstObservedAt: at(2) })];
    const attempts = [attempt({ attemptId: 'x2', adminRecord: 'u2' }), attempt({ attemptId: 'x1', adminRecord: 'u1' }),
      attempt({ attemptId: 'x0', adminRecord: 'u1', attemptedAt: at(15) })];
    const sessions = [alive('p'), alive('q')];
    const a = projectDelegation(input({ activities, leases, attempts, sessions }));
    const b = projectDelegation(input({
      activities: [...activities].reverse(), leases: [...leases].reverse(), attempts: [...attempts].reverse(), sessions: [...sessions].reverse(),
    }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.activities.map((x) => x.activityId)).toEqual(['a1', 'a2', 'a0']);
    expect(a.leases.map((x) => x.leaseId)).toEqual(['l0', 'l1', 'l2']);
    expect(a.unowned.map((x) => [x.adminRecord])).toEqual([['u1'], ['u2']]);
    expect(a.unowned[0]!.attemptedAt).toBe(at(20));
    expect(a.asOf).toBe(at(30));
  });

  it('W4-P14: isDelegationProjectionKebab accepts the four tables\' words and nothing else', () => {
    for (const w of [...DELEGATION_LIVENESS, ...DELEGATION_ROW_GROUPS, ...DELEGATION_ACTIVITY_PLACEMENTS, ...DELEGATION_CREATOR_KINDS]) {
      expect(isDelegationProjectionKebab(w), w).toBe(true);
    }
    expect(isDelegationProjectionKebab('linked')).toBe(false);
    expect(isDelegationProjectionKebab('')).toBe(false);
  });

  it('the tree key the decider joins on is the correlation module\'s', () => {
    // The absences the lane holds are keyed by `delegationTreeKey`; a project/record pair with a separator inside must not alias.
    expect(delegationTreeKey('a', 'b-c')).not.toBe(delegationTreeKey('a-b', 'c'));
    const out = projectDelegation(input({
      leases: [lease({ leaseId: 'l1', adminRecord: 'b-c', project: 'a' })],
      census: census({ a: [], 'a-b': [] }), absences: [{ project: 'a-b', adminRecord: 'c' }],
    }));
    expect(out.leases.map((l) => l.workspace)).toEqual(['unmeasured']);
  });
});
