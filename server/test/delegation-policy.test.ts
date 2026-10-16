// Delegation broker wave 3, Task 12: the PURE report-only reconciliation policy.
//
// `planDelegationReconciliation` reads the recovery state, the worktree census, the correlation verdicts, the registry's
// readability, the first-dead parents and the previous successful census, and returns a closed list of report effects. It does no IO,
// reads no clock, mints no identifier and gives no authority. The rows below hold it to the plan's mutation rows W3-M51 to M54, the
// policy halves of W3-M62 and W3-M63, and the hand-offs of Tasks 9 to 11 (census reasons are never unowned work; a listing-only Bash
// call and a Workflow RUN row are no worker; a conflict is final across passes; measured absence is two SUCCESSFUL censuses).
//
// Fixtures only: names are `lane-a-demo`, `project-a`, `/fixture/...`. No file is read or written (the source scan reads the policy's
// own source text, nothing else).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELEGATION_CORRELATION_REASONS,
  type DelegationCorrelationVerdict,
} from '../src/coord/delegation-correlation.js';
import {
  DELEGATION_CIRCUIT_BREAKER_WINDOW_MS,
  delegationCircuitBreaker,
  isDelegationPolicyKebab,
  isUnownedWorkReason,
  planDelegationReconciliation,
  type DelegationReconciliationInput,
  type DelegationReportEffect,
} from '../src/coord/delegation-policy.js';
import {
  DelegationModelError,
  delegationSha256Hex,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
  type DelegationLeaseCreationRequest,
  type DelegationLeaseRow,
  type DelegationRecoveryState,
  type DelegationSessionRow,
} from '../src/coord/delegation-model.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const INC = 'g1';
const REPO = 'project-a';
const AGENT = 'abc123def456';
const NAME = `agent-${AGENT}`;
const RAW = 'wt-raw';
const WT = (name: string): string => `/fixture/${REPO}/.claude/worktrees/${name}`;
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const NOW = T(36000);                                   // 10:00:00.000Z
const MIN = 60 * 1000;
const hex = (s: string): string => delegationSha256Hex(`fixture-policy-${s}`);

const session = (sessionId = PARENT, parentIncarnation = INC): DelegationSessionRow => ({
  sessionId, parentIncarnation, explicitIntentAt: null, effective: true, effectiveBasis: ['delegation-inferred'], claudeSessionIds: [],
  firstObservedAt: T(1), lastObservedAt: T(2),
});
const activity = (sourceKind: DelegationActivityRow['sourceKind'], upstreamId: string, over: Partial<DelegationActivityRow> = {}): DelegationActivityRow => ({
  activityId: hex(`activity-${sourceKind}-${upstreamId}`), parentId: PARENT, parentIncarnation: INC, sourceKind, upstreamId,
  identityJournalId: hex(`identity-${sourceKind}-${upstreamId}`), displayName: null, executionState: 'active', openedAt: T(1), endedAt: null, lastEventAt: T(2), ...over,
});
const lease = (over: Partial<DelegationLeaseRow> = {}): DelegationLeaseRow => ({
  leaseId: hex('lease-1'), generation: 0, creatingJournalSequence: 1, currentJournalSequence: 1, activityId: hex('activity-agent-x'), parentId: PARENT,
  parentIncarnation: INC, project: REPO, adminRecord: NAME, canonicalPath: WT(NAME), creationBase: 'main', sourceKind: 'agent', parentageState: 'linked',
  workspaceState: 'present', disposition: 'ephemeral', cleanupState: 'not-due', cleanupPopulation: 'ephemeral-lease', firstObservedAt: T(1), lastObservedAt: T(1),
  terminalEvidenceAt: null, adoptedAt: null, retainedAt: null, promotedAt: null, cleanupDueAt: null, cleanupStartedAt: null, cleanupFinishedAt: null,
  cleanupEvidenceJson: null, carrierGenerationSeen: null, releasedAt: null, ...over,
});
const attempt = (over: Partial<DelegationAttemptRow> = {}): DelegationAttemptRow => ({
  attemptId: hex('attempt-1'), parentId: PARENT, parentIncarnation: INC, project: REPO, adminRecord: NAME, canonicalPath: WT(NAME), attemptedAt: T(1),
  rung: null, verdict: 'conflicting', evidenceJournalIds: [], detail: 'rungs-disagree', ...over,
});
const rec = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project: REPO, adminRecord: NAME, canonicalPath: WT(NAME), headBranch: `worktree-${NAME}`, headSha: null, claudeBase: 'main', locked: false,
  baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
const rawRec = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => rec({ adminRecord: RAW, canonicalPath: WT(RAW), headBranch: 'raw-branch', ...over });

const agentAct = activity('agent', AGENT);
const rawAct = activity('bash-worktree', 'toolu_b1');
const wfRun = activity('workflow', 'wf_run1');
/** A workflow worker is opened from its run's meta: it shares the RUN row's identity record (`openWorkflowWorkerFromMeta`). */
const wfAct = activity('workflow', 'wf_run1-0', { identityJournalId: wfRun.identityJournalId });

const linkedV = (act: DelegationActivityRow, rung: 2 | 3 | 4, evidence: readonly string[] = [hex('ev-1')]): DelegationCorrelationVerdict =>
  ({ kind: 'linked', activityId: act.activityId, rung, evidenceJournalIds: [...evidence, act.identityJournalId] });
const unresolvedV = (reason: string, evidenceJournalIds: readonly string[] = []): DelegationCorrelationVerdict => ({ kind: 'unresolved', reason, evidenceJournalIds });
const conflictingV = (reason: string, evidenceJournalIds: readonly string[] = []): DelegationCorrelationVerdict => ({ kind: 'conflicting', reason, evidenceJournalIds });
const unmeasuredV = (reason: string, evidenceJournalIds: readonly string[] = []): DelegationCorrelationVerdict => ({ kind: 'unmeasured', reason, evidenceJournalIds });
const ownedV = (act: DelegationActivityRow = agentAct): DelegationCorrelationVerdict => ({ kind: 'run-child-owned', activityId: act.activityId, evidenceJournalIds: [hex('rc-1')] });

const recovery = (over: Partial<DelegationCheckpointV1> = {}, phase: DelegationRecoveryState['phase'] = 'ready'): DelegationRecoveryState => ({
  checkpoint: {
    ...emptyDelegationCheckpoint(), revision: 7,
    sessions: [session()], activities: [agentAct, rawAct, wfAct, wfRun], ...over,
  },
  phase,
});
type PlanOver = Partial<DelegationReconciliationInput> & { verdicts?: readonly DelegationCorrelationVerdict[] };
/** `verdicts` is a convenience of the fixtures only: it pairs each verdict with the census record at the same index, building the
 *  `{record, verdict}` pairs the input requires. The policy itself never pairs by position. */
const plan = (over: PlanOver = {}): DelegationReconciliationInput => {
  const { verdicts, ...rest } = over;
  const census = rest.census ?? [];
  return {
    now: NOW, recovery: recovery(), census, correlations: (verdicts ?? []).map((verdict, i) => ({ record: census[i]!, verdict })),
    registryReadable: true, firstDeadParents: [], previousSuccessfulCensus: null, censusedProjects: [REPO], previousCensusedProjects: [REPO], ...rest,
  };
};
/** One record with its verdict. */
const one = (record: DelegationCensusRecord, verdict: DelegationCorrelationVerdict, over: PlanOver = {}): DelegationReconciliationInput =>
  plan({ census: [record], verdicts: [verdict], ...over });
const kinds = (effects: readonly DelegationReportEffect[]): string[] => effects.map((e) => e.kind);
/** Every effect but the per-pass projection repair, which every ready pass carries (see the repair rows). */
const without = (effects: readonly DelegationReportEffect[], ...drop: DelegationReportEffect['kind'][]): DelegationReportEffect[] =>
  effects.filter((e) => !drop.includes(e.kind));
const substantive = (effects: readonly DelegationReportEffect[]): DelegationReportEffect[] => without(effects, 'repair-report-projection');
const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
const deadAt = (parentId: string, msAgo: number) => ({ parentId, firstMeasuredDeadAt: formatDelegationInstant(Date.parse(NOW) - msAgo) });

const requestOf = (effects: readonly DelegationReportEffect[]): DelegationLeaseCreationRequest | undefined => {
  const e = effects.find((x) => x.kind === 'request-linked-lease-identity');
  return e?.kind === 'request-linked-lease-identity' ? e.request : undefined;
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 1: the state-transition table
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('state transitions: candidate present', () => {
  it('a linked rung-2 verdict on a present record requests ONE lease identity, with measured identity only', () => {
    const effects = substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2))));
    expect(kinds(effects)).toEqual(['request-linked-lease-identity']);
    const e = effects[0]!;
    if (e.kind !== 'request-linked-lease-identity') throw new Error('unreachable');
    expect(e.request).toEqual({
      activityId: agentAct.activityId, parentId: PARENT, parentIncarnation: INC, project: REPO, adminRecord: NAME, canonicalPath: WT(NAME),
      creationBase: 'main', sourceKind: 'agent', correlationJournalIds: [hex('ev-1'), agentAct.identityJournalId].sort(), firstObservedAt: NOW,
    });
    expect(e.attempt).toMatchObject({ parentId: PARENT, parentIncarnation: INC, project: REPO, adminRecord: NAME, canonicalPath: WT(NAME), attemptedAt: NOW, rung: 2, verdict: 'linked', detail: null });
  });
  it('rung 3 (the subagent\'s own path) and rung 4 (a creation delta, provenance `raw`) are linked the same way', () => {
    const r3 = requestOf(planDelegationReconciliation(one(rawRec(), linkedV(agentAct, 3))));
    expect(r3).toMatchObject({ adminRecord: RAW, sourceKind: 'agent', activityId: agentAct.activityId });
    const r4 = requestOf(planDelegationReconciliation(one(rawRec(), linkedV(rawAct, 4))));
    expect(r4).toMatchObject({ adminRecord: RAW, sourceKind: 'raw', activityId: rawAct.activityId });
  });
  it('a workflow WORKER (the activity whose upstream id is the tree\'s whole name) links at rung 2 with provenance `workflow`', () => {
    const r = requestOf(planDelegationReconciliation(one(rec({ adminRecord: 'wf_run1-0', canonicalPath: WT('wf_run1-0') }), linkedV(wfAct, 2))));
    expect(r).toMatchObject({ sourceKind: 'workflow', adminRecord: 'wf_run1-0' });
  });
  it('the creation base is the census record\'s `claudeBase`, null when the census read none', () => {
    expect(requestOf(planDelegationReconciliation(one(rec({ claudeBase: null }), linkedV(agentAct, 2))))?.creationBase).toBeNull();
  });
  it('a linked verdict whose activity the checkpoint does not hold requests nothing (it cannot name a parent)', () => {
    const ghost: DelegationCorrelationVerdict = { kind: 'linked', activityId: hex('no-such-activity'), rung: 2, evidenceJournalIds: [hex('ev-1')] };
    expect(substantive(planDelegationReconciliation(one(rec(), ghost)))).toEqual([]);
  });
  it('a linked verdict with no evidence at all, or for a record with no canonical path, requests nothing', () => {
    expect(substantive(planDelegationReconciliation(one(rec(), { kind: 'linked', activityId: agentAct.activityId, rung: 2, evidenceJournalIds: [] })))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec({ canonicalPath: null }), linkedV(agentAct, 2))))).toEqual([]);
  });
  it('a lease for the same activity and tree that is still open is not requested again', () => {
    const open = lease({ activityId: agentAct.activityId });
    expect(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: recovery({ leases: [open] }) })))).toEqual([]);
    const released = lease({ activityId: agentAct.activityId, releasedAt: T(5) });
    expect(kinds(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: recovery({ leases: [released] }) }))))).toEqual(['request-linked-lease-identity']);
  });
});

describe('state transitions: run-child-owned (W3-M63, the policy half)', () => {
  it('rung 1 emits ONLY `record-run-child-owned`, with a rung-1 attempt, and never a lease request', () => {
    const effects = substantive(planDelegationReconciliation(one(rec(), ownedV())));
    expect(kinds(effects)).toEqual(['record-run-child-owned']);
    const e = effects[0]!;
    if (e.kind !== 'record-run-child-owned') throw new Error('unreachable');
    expect(e.attempt).toMatchObject({ rung: 1, verdict: 'linked', parentId: PARENT, adminRecord: NAME, canonicalPath: WT(NAME) });
    expect(e.attempt.evidenceJournalIds).toEqual([hex('rc-1')]);
    expect(requestOf(planDelegationReconciliation(one(rec(), ownedV())))).toBeUndefined();
  });
  it('even beside a registry that is unreadable, or a prior conflict, rung 1 still never becomes a lease', () => {
    for (const over of [{ registryReadable: false }, { recovery: recovery({ attempts: [attempt()] }) }]) {
      const effects = planDelegationReconciliation(one(rec(), ownedV(), over));
      expect(kinds(effects)).not.toContain('request-linked-lease-identity');
    }
  });
  it('a run-child-owned verdict for a record that was not measured present, or without a canonical path, is not reported', () => {
    expect(substantive(planDelegationReconciliation(one(rec({ state: 'unreadable' }), ownedV())))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec({ canonicalPath: null }), ownedV())))).toEqual([]);
  });
  it('an unknown owner whose evidence names two parents\' activities reports NOTHING (no parent is guessed from evidence) (I5)', () => {
    const theirs = activity('agent', 'zzz', { parentId: OTHER });
    const rc = recovery({ sessions: [session(PARENT), session(OTHER)], activities: [agentAct, theirs] });
    const stranger: DelegationCorrelationVerdict = { kind: 'run-child-owned', activityId: 'act-unknown', evidenceJournalIds: [agentAct.identityJournalId, theirs.identityJournalId] };
    expect(substantive(planDelegationReconciliation(one(rec(), stranger, { recovery: rc })))).toEqual([]);
  });
  it('an owner the checkpoint holds but whose parent has no session row is not reported either', () => {
    expect(substantive(planDelegationReconciliation(one(rec(), ownedV(), { recovery: recovery({ sessions: [] }) })))).toEqual([]);
  });
  it('an owner the checkpoint cannot name is not reported (no parent is invented)', () => {
    const stranger: DelegationCorrelationVerdict = { kind: 'run-child-owned', activityId: 'act-unknown', evidenceJournalIds: [] };
    expect(substantive(planDelegationReconciliation(one(rec(), stranger)))).toEqual([]);
  });
});

describe('state transitions: measured absence is two SUCCESSFUL censuses', () => {
  const held = { recovery: recovery({ leases: [lease()] }) };
  const absence = (over: PlanOver) => substantive(planDelegationReconciliation(plan({ ...held, ...over })));
  it('a leased tree missing from this census and from the previous successful one is measured absent, at `now`', () => {
    expect(absence({ census: [], previousSuccessfulCensus: [] })).toEqual([{ kind: 'record-measured-absence', project: REPO, adminRecord: NAME, observedAt: NOW }]);
  });
  it('a record the listing measured `absent` counts the same as a record the listing does not name', () => {
    expect(kinds(absence({ census: [rec({ state: 'absent', canonicalPath: null })], verdicts: [unresolvedV('record-absent')], previousSuccessfulCensus: [rec({ state: 'absent' })] })))
      .toEqual(['record-measured-absence']);
  });
  it('ONE successful census is not absence: no previous successful census, or a previous one that held the tree', () => {
    expect(absence({ census: [], previousSuccessfulCensus: null })).toEqual([]);
    expect(absence({ census: [], previousSuccessfulCensus: [rec()] })).toEqual([]);
  });
  it('a record that is still present is not absent', () => {
    expect(absence({ census: [rec()], verdicts: [unmeasuredV('rung-2-evidence-absent')], previousSuccessfulCensus: [] })).toEqual([]);
  });
  it('an UNREADABLE record is never absence, in this census or in the previous one (including a worktree being born)', () => {
    expect(absence({ census: [rec({ state: 'unreadable', canonicalPath: null, diagnostic: 'record-initializing' })], verdicts: [unmeasuredV('record-unreadable')], previousSuccessfulCensus: [] })).toEqual([]);
    expect(absence({ census: [], previousSuccessfulCensus: [rec({ state: 'unreadable', canonicalPath: null })] })).toEqual([]);
  });
  it('only a tree the broker once held is reported absent: a record absent from two censuses that nothing names is not', () => {
    expect(substantive(planDelegationReconciliation(plan({ census: [], previousSuccessfulCensus: [] })))).toEqual([]);
  });
  it('a RELEASED lease is not a tree anyone waits on', () => {
    expect(absence({ recovery: recovery({ leases: [lease({ releasedAt: T(5) })] }), census: [], previousSuccessfulCensus: [] })).toEqual([]);
  });
  it('a recorded attempt keeps its tree\'s absence reportable (the unowned report must be able to clear)', () => {
    expect(kinds(absence({ recovery: recovery({ attempts: [attempt()] }), census: [], previousSuccessfulCensus: [] }))).toEqual(['record-measured-absence']);
  });
  it('a lease in a project the census did not cover reports no absence: only `project-a` was looked at (D-4650)', () => {
    const inB = lease({ project: 'project-b', adminRecord: 'agent-b', canonicalPath: '/fixture/project-b/.claude/worktrees/agent-b' });
    expect(absence({ recovery: recovery({ leases: [inB] }), census: [], previousSuccessfulCensus: [] })).toEqual([]);
    expect(absence({ recovery: recovery({ leases: [inB] }), census: [], previousSuccessfulCensus: [], censusedProjects: ['project-b'], previousCensusedProjects: ['project-b'] }))
      .toEqual([{ kind: 'record-measured-absence', project: 'project-b', adminRecord: 'agent-b', observedAt: NOW }]);
  });
  it('a project removed from configuration (in neither list) never has a tree reported absent, however long it stays gone', () => {
    expect(absence({ census: [], previousSuccessfulCensus: [], censusedProjects: [], previousCensusedProjects: [] })).toEqual([]);
  });
  it('a project censused THIS pass but not in the previous successful one (or the reverse) is not absent yet', () => {
    expect(absence({ census: [], previousSuccessfulCensus: [], censusedProjects: [REPO], previousCensusedProjects: [] })).toEqual([]);
    expect(absence({ census: [], previousSuccessfulCensus: [], censusedProjects: [], previousCensusedProjects: [REPO] })).toEqual([]);
    expect(absence({ census: [], previousSuccessfulCensus: [], previousCensusedProjects: null })).toEqual([]);
  });
  it('absence is projection, not removal: it carries no path, no branch, no action and no attempt', () => {
    const [e] = absence({ census: [], previousSuccessfulCensus: [] });
    expect(Object.keys(e!).sort()).toEqual(['adminRecord', 'kind', 'observedAt', 'project']);
  });
  it('absence reports are in a stable order whatever the order the leases were handed over', () => {
    const a = lease({ leaseId: hex('l-a'), creatingJournalSequence: 1, adminRecord: 'agent-a', canonicalPath: WT('agent-a') });
    const b = lease({ leaseId: hex('l-b'), creatingJournalSequence: 2, adminRecord: 'agent-b', canonicalPath: WT('agent-b') });
    const fwd = absence({ recovery: recovery({ leases: [a, b] }), census: [], previousSuccessfulCensus: [] });
    const rev = absence({ recovery: recovery({ leases: [b, a] }), census: [], previousSuccessfulCensus: [] });
    expect(rev).toEqual(fwd);
    expect(fwd.map((e) => (e.kind === 'record-measured-absence' ? e.adminRecord : ''))).toEqual(['agent-a', 'agent-b']);
  });
});

describe('state transitions: an unreadable record', () => {
  it('an unmeasured verdict for an unreadable record emits nothing, and neither does a stray linked verdict for it', () => {
    expect(substantive(planDelegationReconciliation(one(rec({ state: 'unreadable', canonicalPath: null }), unmeasuredV('record-unreadable'))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec({ state: 'unreadable', canonicalPath: null }), linkedV(agentAct, 2))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec({ state: 'absent', canonicalPath: null }), linkedV(agentAct, 2))))).toEqual([]);
  });
  it('every UNMEASURED verdict emits nothing: unknown stays unmeasured and is retried', () => {
    for (const reason of DELEGATION_CORRELATION_REASONS) {
      expect(substantive(planDelegationReconciliation(one(rec(), unmeasuredV(reason, [agentAct.identityJournalId]))))).toEqual([]);
    }
  });
});

describe('state transitions: ended activity, paused workflow, restarting supervisor (W3-M51)', () => {
  it('an ENDED activity\'s tree still gets only its identity request: nothing is reclaimed, retired or cleaned', () => {
    const ended = activity('agent', AGENT, { executionState: 'ended', endedAt: T(5) });
    const effects = planDelegationReconciliation(one(rec(), linkedV(ended, 2), { recovery: recovery({ activities: [ended] }) }));
    expect(kinds(substantive(effects))).toEqual(['request-linked-lease-identity']);
    expect(effects.every((e) => EFFECT_TAGS.includes(e.kind))).toBe(true);
  });
  it('a PAUSED workflow (an activity still `active` or `unknown` with no end evidence) stays a worker: its tree links, nothing ends it', () => {
    for (const executionState of ['active', 'unknown'] as const) {
      const paused = activity('workflow', 'wf_run1-0', { executionState, identityJournalId: wfRun.identityJournalId });
      const frozen = deepFreeze(one(rec({ adminRecord: 'wf_run1-0', canonicalPath: WT('wf_run1-0') }), linkedV(paused, 2), { recovery: recovery({ activities: [wfRun, paused] }) }));
      const effects = substantive(planDelegationReconciliation(frozen));
      expect(kinds(effects)).toEqual(['request-linked-lease-identity']);
      expect(frozen.recovery.checkpoint.activities[1]!.executionState).toBe(executionState);     // nothing was edited
    }
  });
  it('policy reads no execution state: an `unknown` activity (a supervisor mid-restart) neither suspends claims nor makes a parent dead', () => {
    // Every parent the checkpoint knows is in a state a restart passes through; none is in `firstDeadParents`.
    const restarting = recovery({ sessions: [session(PARENT), session(OTHER)], activities: [agentAct, activity('agent', 'zzz', { parentId: OTHER, executionState: 'unknown' })] });
    expect(delegationCircuitBreaker({ now: NOW, registryReadable: true, firstDeadParents: [] })).toBe('clear');
    expect(kinds(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: restarting }))))).toEqual(['request-linked-lease-identity']);
  });
});

describe('state transitions: registry unreadable', () => {
  it('suspends every ownership claim of the pass (no lease request, no unowned report) and keeps the census-only facts', () => {
    const base = { registryReadable: false, recovery: recovery({ leases: [lease({ adminRecord: 'agent-gone', canonicalPath: WT('agent-gone') })] }), previousSuccessfulCensus: [] as DelegationCensusRecord[] };
    const effects = planDelegationReconciliation(plan({
      ...base,
      census: [rec(), rawRec(), rawRec({ adminRecord: 'wt-own', canonicalPath: WT('wt-own') })],
      verdicts: [linkedV(agentAct, 2), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), ownedV()],
    }));
    expect(kinds(substantive(effects)).sort()).toEqual(['record-measured-absence', 'record-run-child-owned']);
    expect(kinds(effects)).not.toContain('request-linked-lease-identity');
    expect(kinds(effects)).not.toContain('record-unowned-worktree');
  });
  it('a readable registry with the same input requests the lease and reports the unowned tree', () => {
    const effects = planDelegationReconciliation(plan({
      census: [rec(), rawRec()], verdicts: [linkedV(agentAct, 2), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId])],
    }));
    expect(kinds(substantive(effects))).toEqual(['request-linked-lease-identity', 'record-unowned-worktree']);
  });
});

describe('state transitions: a carrier alone is no authority (W3-M52)', () => {
  // A tree can look like a ccrc lease to the census: locked, a branch, a base, a canonical path. None of that is a journal event, and
  // policy is handed a verdict, so a record whose verdict is not `linked` never becomes a request however carrier-like it reads.
  const carrierLike = rec({ locked: true, headBranch: `worktree-${NAME}`, headSha: 'a'.repeat(40), claudeBase: 'main', baseAgreesFirstLog: true });
  it('a carrier-like record with no correlating evidence requests no lease', () => {
    for (const v of [unresolvedV('no-correlating-evidence'), unresolvedV('rung-2-evidence-absent'), unmeasuredV('rung-2-evidence-absent'), unmeasuredV('rung-2-meta-absent')]) {
      expect(kinds(planDelegationReconciliation(one(carrierLike, v)))).not.toContain('request-linked-lease-identity');
    }
  });
  it('a carrier-like record beside an EXISTING lease row is not a second lease, and a conflict beside it stays unrequested', () => {
    expect(kinds(planDelegationReconciliation(one(carrierLike, conflictingV('rungs-disagree', [agentAct.identityJournalId]))))).not.toContain('request-linked-lease-identity');
  });
  it('the census record\'s own fields appear in no request except the canonical path, base and names the verdict already earned', () => {
    const r = requestOf(planDelegationReconciliation(one(carrierLike, linkedV(agentAct, 2))));
    expect(JSON.stringify(r)).not.toMatch(/locked|headBranch|headSha|baseAgreesFirstLog|aaaaaaaa/);
  });
});

describe('state transitions: a ccrc workspace being born, and other census reasons, are never unowned work', () => {
  it('`ccrc-birth-wait` and `ccd-workspace-not-a-lease` emit nothing, however much evidence names a parent', () => {
    for (const reason of ['ccrc-birth-wait', 'ccd-workspace-not-a-lease']) {
      expect(substantive(planDelegationReconciliation(one(rec(), unresolvedV(reason, [agentAct.identityJournalId]))))).toEqual([]);
    }
  });
  it('`record-absent` is not unowned work either (absence is its own report)', () => {
    expect(substantive(planDelegationReconciliation(one(rec({ state: 'absent', canonicalPath: null }), unresolvedV('record-absent', [agentAct.identityJournalId]))))).toEqual([]);
  });
  it('a verdict reason the policy has never heard of is not unowned work (it fails closed)', () => {
    expect(substantive(planDelegationReconciliation(one(rec(), unresolvedV('some-future-reason', [agentAct.identityJournalId]))))).toEqual([]);
  });
  it('the reasons that ARE unowned work are exactly the ones whose evidence leaves a tree attempted and undecided', () => {
    const reported = DELEGATION_CORRELATION_REASONS.filter((reason) =>
      kinds(substantive(planDelegationReconciliation(one(rec(), unresolvedV(reason, [agentAct.identityJournalId]))))).includes('record-unowned-worktree'));
    expect([...reported].sort()).toEqual([
      'agent-id-claimed-by-multiple-sessions', 'ambiguous-listing-windows', 'ambiguous-subagent-path', 'duplicate-activity-rows', 'meta-paths-disagree',
      'no-correlating-evidence', 'overlapping-listing-window', 'parent-cwd', 'path-claimed-by-multiple-parents', 'rungs-disagree', 'same-upstream-id-in-multiple-sessions',
    ].sort());
  });
});

describe('isUnownedWorkReason (R59): the ONE classifier of what counts as unowned work, derived from the total table', () => {
  it('answers true exactly for the reasons policy REPORTS as unowned work, for every reason correlation can emit', () => {
    for (const reason of DELEGATION_CORRELATION_REASONS) {
      const reported = kinds(substantive(planDelegationReconciliation(one(rec(), unresolvedV(reason, [agentAct.identityJournalId]))))).includes('record-unowned-worktree');
      expect(isUnownedWorkReason(reason), reason).toBe(reported);
    }
  });
  it('is false for a tree that is not work: a ccd workspace, a tree being born, an absent record, and an eviction (evidence-horizon)', () => {
    for (const reason of ['ccd-workspace-not-a-lease', 'ccrc-birth-wait', 'record-absent', 'record-unreadable', 'evidence-horizon', 'rung-2-meta-absent']) {
      expect(isUnownedWorkReason(reason), reason).toBe(false);
    }
  });
  it('is true for unowned work (attempted and undecided), and fails closed for a word it has never heard of', () => {
    for (const reason of ['no-correlating-evidence', 'overlapping-listing-window', 'parent-cwd', 'rungs-disagree']) expect(isUnownedWorkReason(reason), reason).toBe(true);
    for (const reason of ['some-future-reason', '', 'toString', '__proto__', 'constructor']) expect(isUnownedWorkReason(reason), reason).toBe(false);
  });
  it('there is no second table: the policy defines UNOWNED_BY_REASON once, and the watcher spells none of the reasons it classifies', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const policy = readFileSync(path.join(dir, 'coord', 'delegation-policy.ts'), 'utf8');
    expect(policy.match(/const UNOWNED_BY_REASON\b/g)).toHaveLength(1);
    const watch = readFileSync(path.join(dir, 'watch.ts'), 'utf8');
    const lane = watch.slice(watch.indexOf('THE DELEGATION LANE')).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const reason of DELEGATION_CORRELATION_REASONS) expect(lane.includes(`'${reason}'`), `${reason} is spelled in the lane`).toBe(false);
    expect(lane).toContain('isUnownedWorkReason(');
  });
});

describe('unowned work: what is reported, and about whom', () => {
  it('an unresolved verdict whose evidence names exactly one parent is reported against that parent, as an `unresolved` attempt', () => {
    const effects = substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId, hex('ev-x')]))));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
    const e = effects[0]!;
    if (e.kind !== 'record-unowned-worktree') throw new Error('unreachable');
    expect(e.attempt).toMatchObject({ parentId: PARENT, parentIncarnation: INC, project: REPO, adminRecord: RAW, canonicalPath: WT(RAW), rung: null, verdict: 'unresolved', detail: 'ambiguous-subagent-path', attemptedAt: NOW });
    expect(e.attempt.evidenceJournalIds).toEqual([agentAct.identityJournalId, hex('ev-x')].sort());
  });
  it('a conflicting verdict is a `conflicting` attempt', () => {
    const e = substantive(planDelegationReconciliation(one(rawRec(), conflictingV('rungs-disagree', [agentAct.identityJournalId]))))[0]!;
    expect(e.kind === 'record-unowned-worktree' && e.attempt.verdict).toBe('conflicting');
  });
  it('evidence that names two parents is reported once per parent (never one invented as "the" owner)', () => {
    const theirs = activity('agent', 'zzz', { parentId: OTHER });
    const rc = recovery({ sessions: [session(PARENT), session(OTHER)], activities: [agentAct, theirs] });
    const effects = substantive(planDelegationReconciliation(one(rawRec(), conflictingV('path-claimed-by-multiple-parents', [agentAct.identityJournalId, theirs.identityJournalId]), { recovery: rc })));
    expect(effects.map((e) => (e.kind === 'record-unowned-worktree' ? e.attempt.parentId : ''))).toEqual([PARENT, OTHER].sort());
  });
  it('evidence that names no parent the checkpoint holds cannot be filed under one, so nothing is reported (no parent is invented)', () => {
    expect(substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('no-correlating-evidence'))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('overlapping-listing-window', [hex('ev-unknown')]))))).toEqual([]);
  });
  it('a parent whose session row the checkpoint lacks is not a parent an attempt can reference', () => {
    expect(substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), { recovery: recovery({ sessions: [] }) })))).toEqual([]);
  });
  it('the same state seen again is not reported again: the attempt id is deterministic and already held', () => {
    const first = substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]))));
    const e = first[0]!;
    if (e.kind !== 'record-unowned-worktree') throw new Error('unreachable');
    const second = substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), { now: T(36060), recovery: recovery({ attempts: [e.attempt] }) })));
    expect(second).toEqual([]);
    const again = substantive(planDelegationReconciliation(one(rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), { now: T(36060) })));
    expect(again[0]!.kind === 'record-unowned-worktree' && again[0]!.attempt.attemptId).toBe(e.attempt.attemptId);
  });
  it('different evidence or a different reason is a different attempt', () => {
    const id = (v: DelegationCorrelationVerdict): string => {
      const e = substantive(planDelegationReconciliation(one(rawRec(), v)))[0]!;
      return e.kind === 'record-unowned-worktree' ? e.attempt.attemptId : '';
    };
    const a = id(unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]));
    expect(a).not.toBe('');
    expect(id(unresolvedV('parent-cwd', [agentAct.identityJournalId]))).not.toBe(a);
    expect(id(unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId, hex('more')]))).not.toBe(a);
  });
});

describe('one lease per tree (R51): a tree an unreleased lease holds is never requested again', () => {
  const other = activity('agent', 'zzz');
  const rc = (leases: DelegationLeaseRow[]) => recovery({ leases, activities: [agentAct, other, rawAct] });
  it('the SAME activity\'s link on a tree it already holds requests nothing and files nothing', () => {
    expect(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: rc([lease({ activityId: agentAct.activityId })]) })))).toEqual([]);
  });
  it('ANOTHER activity\'s link on a held tree requests nothing and files ONE conflicting attempt (`rungs-disagree`) under the new verdict\'s parent', () => {
    const effects = substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), {
      recovery: rc([lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })]),
    })));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
    const e = effects[0]!;
    if (e.kind !== 'record-unowned-worktree') throw new Error('unreachable');
    expect(e.attempt).toMatchObject({ verdict: 'conflicting', detail: 'rungs-disagree', parentId: PARENT, adminRecord: RAW, rung: null });
  });
  it('the tree is held by PATH too: a different admin record at the same canonical path is the same tree', () => {
    const effects = substantive(planDelegationReconciliation(one(rawRec({ adminRecord: 'wt-renamed' }), linkedV(other, 3), {
      recovery: rc([lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })]),
    })));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
  });
  it('the conflict is final: the next pass (which holds the attempt) files nothing more and still requests nothing', () => {
    const first = substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), { recovery: rc([lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })]) })))[0]!;
    if (first.kind !== 'record-unowned-worktree') throw new Error('unreachable');
    const next = recovery({ leases: [lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })], activities: [agentAct, other], attempts: [first.attempt] });
    expect(substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), { recovery: next, now: T(36060) })))).toEqual([]);
  });
  it('the existing lease is not touched: the held tree emits no absence, release or transition either', () => {
    const effects = substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), { recovery: rc([lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })]) })));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
  });
  it('R54 N3: the tree is held by KEY too: the same (project, admin record) at a different path is the same tree (no request, one conflict)', () => {
    const effects = substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), {
      recovery: rc([lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: '/fixture/old/path' })]),
    })));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
  });
  it('R54 N3: the conflict is filed under the NEW verdict\'s parent, never the holder\'s', () => {
    const theirs = activity('agent', 'zzz', { parentId: OTHER });
    const effects = substantive(planDelegationReconciliation(one(rawRec(), linkedV(theirs, 3), {
      recovery: recovery({ sessions: [session(PARENT), session(OTHER)], activities: [agentAct, theirs, rawAct], leases: [lease({ activityId: agentAct.activityId, adminRecord: RAW, canonicalPath: WT(RAW) })] }),
    })));
    expect(kinds(effects)).toEqual(['record-unowned-worktree']);
    const e = effects[0]!;
    if (e.kind !== 'record-unowned-worktree') throw new Error('unreachable');
    expect(e.attempt).toMatchObject({ parentId: OTHER, verdict: 'conflicting', detail: 'rungs-disagree' });
  });
  it('a lease on ANOTHER tree does not hold this one', () => {
    expect(kinds(substantive(planDelegationReconciliation(one(rawRec(), linkedV(other, 3), { recovery: rc([lease({ activityId: agentAct.activityId })]) }))))).toEqual(['request-linked-lease-identity']);
  });
});

describe('run versus worker is read from the rows, never from spelling (R52)', () => {
  const RUN = 'wf_5440bac3-123';                                   // a measured run-ID shape whose tail is all digits
  const runRow = activity('workflow', RUN);
  const worker = activity('workflow', `${RUN}-0`, { identityJournalId: runRow.identityJournalId });
  const rc = recovery({ activities: [runRow, worker] });
  it('a RUN row whose own ID ends in digits is no worker: a rung-2 link to it requests nothing', () => {
    expect(substantive(planDelegationReconciliation(one(rec({ adminRecord: RUN, canonicalPath: WT(RUN) }), linkedV(runRow, 2), { recovery: rc })))).toEqual([]);
  });
  it('its WORKER (the run\'s ID plus an index, sharing its identity record) requests a lease', () => {
    expect(requestOf(planDelegationReconciliation(one(rec({ adminRecord: `${RUN}-0`, canonicalPath: WT(`${RUN}-0`) }), linkedV(worker, 2), { recovery: rc }))))
      .toMatchObject({ sourceKind: 'workflow', adminRecord: `${RUN}-0` });
  });
  it('a workflow activity that looks like a worker but shares no run\'s identity record, parent or index shape is not one', () => {
    const noRun = recovery({ activities: [worker] });
    const otherParent = activity('workflow', `${RUN}-0`, { identityJournalId: runRow.identityJournalId, parentId: OTHER });
    const otherIdentity = activity('workflow', `${RUN}-0`);
    const badIndex = activity('workflow', `${RUN}-x`, { identityJournalId: runRow.identityJournalId });
    const leading = activity('workflow', `${RUN}-01`, { identityJournalId: runRow.identityJournalId });
    const cases: [DelegationActivityRow, DelegationRecoveryState][] = [
      [worker, noRun], [otherParent, recovery({ sessions: [session(PARENT), session(OTHER)], activities: [runRow, otherParent] })],
      [otherIdentity, recovery({ activities: [runRow, otherIdentity] })], [badIndex, recovery({ activities: [runRow, badIndex] })], [leading, recovery({ activities: [runRow, leading] })],
    ];
    for (const [w, r] of cases) {
      expect(substantive(planDelegationReconciliation(one(rec({ adminRecord: w.upstreamId, canonicalPath: WT(w.upstreamId) }), linkedV(w, 2), { recovery: r }))), w.upstreamId).toEqual([]);
    }
  });
  it('R54 N3: same parent and identity but ANOTHER incarnation (its session present) is not the run\'s worker: no request', () => {
    const otherInc = activity('workflow', `${RUN}-0`, { identityJournalId: runRow.identityJournalId, parentIncarnation: 'g2' });
    const r = recovery({ sessions: [session(PARENT), session(PARENT, 'g2')], activities: [runRow, otherInc] });
    expect(substantive(planDelegationReconciliation(one(rec({ adminRecord: `${RUN}-0`, canonicalPath: WT(`${RUN}-0`) }), linkedV(otherInc, 2), { recovery: r })))).toEqual([]);
  });
});

describe('a listing-only Bash call and a Workflow RUN row are no worker and no owner', () => {
  it('an unresolved verdict beside a bash-worktree activity requests no lease and claims no ownership (the single-added-record delta that makes a Bash call evidence is correlation\'s, so a non-answer here proves nothing more)', () => {
    for (const v of [unresolvedV('no-correlating-evidence', [rawAct.identityJournalId]), unresolvedV('ambiguous-listing-windows', [rawAct.identityJournalId])]) {
      const effects = planDelegationReconciliation(one(rawRec(), v));
      expect(kinds(effects)).not.toContain('request-linked-lease-identity');
      expect(kinds(effects)).not.toContain('record-run-child-owned');
    }
  });
  it('a linked verdict is honoured only for the rung that can name that activity\'s kind', () => {
    // rung 4 is a bash-worktree's, rungs 2 and 3 are an agent or workflow worker's; a mismatch is no proof of anything.
    expect(substantive(planDelegationReconciliation(one(rawRec(), linkedV(rawAct, 2))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rawRec(), linkedV(rawAct, 3))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rawRec(), linkedV(agentAct, 4))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rawRec(), linkedV(wfAct, 3))))).toEqual([]);
  });
  it('a Workflow RUN row (upstream id = the run) is never a worker: a rung-2 link to it, for any tree, requests nothing', () => {
    expect(substantive(planDelegationReconciliation(one(rec({ adminRecord: 'wf_run1-0', canonicalPath: WT('wf_run1-0') }), linkedV(wfRun, 2))))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec({ adminRecord: 'wf_run1', canonicalPath: WT('wf_run1') }), linkedV(wfRun, 2))))).toEqual([]);
  });
  it('a rung-2 link whose activity does not own the tree\'s name (the wrong agent) requests nothing', () => {
    const other = activity('agent', 'someoneelse');
    expect(substantive(planDelegationReconciliation(one(rec(), linkedV(other, 2), { recovery: recovery({ activities: [other] }) })))).toEqual([]);
  });
});

describe('conflict finality across passes', () => {
  it('a prior conflicting attempt for the tree is final: a later linked verdict requests no lease and a later unresolved one records nothing', () => {
    const rc = recovery({ attempts: [attempt()] });
    expect(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: rc })))).toEqual([]);
    expect(substantive(planDelegationReconciliation(one(rec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), { recovery: rc })))).toEqual([]);
  });
  it('the finality is the TREE\'s (project and admin record), not the attempt\'s parent or time', () => {
    const rc = recovery({ attempts: [attempt({ parentId: OTHER, attemptedAt: T(-100000) })], sessions: [session(PARENT), session(OTHER)] });
    expect(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: rc })))).toEqual([]);
  });
  it('a conflict on ANOTHER tree, or in another project, does not bind this one', () => {
    for (const a of [attempt({ adminRecord: 'agent-other' }), attempt({ project: 'project-b' })]) {
      expect(kinds(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: recovery({ attempts: [a] }) }))))).toEqual(['request-linked-lease-identity']);
    }
  });
  it('a prior attempt that was merely unresolved is not final: it may still link', () => {
    expect(kinds(substantive(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2), { recovery: recovery({ attempts: [attempt({ verdict: 'unresolved' })] }) }))))).toEqual(['request-linked-lease-identity']);
  });
});

describe('a recovery that is not ready decides nothing', () => {
  it('a `reconstructing` state yields no effect at all, not even absence or a repair', () => {
    const effects = planDelegationReconciliation(plan({
      recovery: recovery({ leases: [lease()] }, 'reconstructing'), census: [rec()], verdicts: [linkedV(agentAct, 2)], previousSuccessfulCensus: [],
    }));
    expect(effects).toEqual([]);
  });
});

describe('the projection repair is one statement of the revision the pass read', () => {
  it('a ready pass ends with exactly one `repair-report-projection` carrying the checkpoint revision it read', () => {
    const effects = planDelegationReconciliation(one(rec(), linkedV(agentAct, 2)));
    expect(effects.at(-1)).toEqual({ kind: 'repair-report-projection', checkpointRevision: 7 });
    expect(kinds(effects).filter((k) => k === 'repair-report-projection')).toHaveLength(1);
  });
  it('an empty pass is just the repair', () => {
    expect(planDelegationReconciliation(plan())).toEqual([{ kind: 'repair-report-projection', checkpointRevision: 7 }]);
  });
});

describe('the call\'s contract', () => {
  it('a verdict is paired with its record (D-4650): a pair whose record the census does not hold is a defect and throws', () => {
    expect(() => planDelegationReconciliation(plan({ census: [], correlations: [{ record: rec(), verdict: ownedV() }] }))).toThrow(DelegationModelError);
    expect(() => planDelegationReconciliation(plan({ census: [rawRec()], correlations: [{ record: rec(), verdict: ownedV() }] }))).toThrow(DelegationModelError);
    expect(() => planDelegationReconciliation(plan({ census: [rec({ project: 'project-b' })], correlations: [{ record: rec(), verdict: ownedV() }] }))).toThrow(DelegationModelError);
  });
  it('R54 N1: the pair contributes only its key: the plan reads the CENSUS\'s record, so a stale copy is never acted on as measured', () => {
    const born = rec({ state: 'unreadable', canonicalPath: null, diagnostic: 'record-initializing' });
    expect(substantive(planDelegationReconciliation(plan({ census: [born], correlations: [{ record: rec(), verdict: linkedV(agentAct, 2) }] }))), 'a tree the census reports being born').toEqual([]);
    const moved = rec({ canonicalPath: WT('elsewhere'), claudeBase: 'other-base' });
    const request = requestOf(planDelegationReconciliation(plan({ census: [moved], correlations: [{ record: rec(), verdict: linkedV(agentAct, 2) }] })));
    expect(request, 'the path and base the census measured, never the pair\'s').toMatchObject({ canonicalPath: WT('elsewhere'), creationBase: 'other-base' });
  });
  it('R54 N2: a tree paired twice is refused, and none of its pairs is planned', () => {
    const other = activity('agent', 'zzz');
    const twice = plan({ census: [rawRec()], recovery: recovery({ activities: [agentAct, other, rawAct] }),
      correlations: [{ record: rawRec(), verdict: linkedV(agentAct, 3) }, { record: rawRec(), verdict: linkedV(other, 3) }] });
    expect(() => planDelegationReconciliation(twice)).toThrow(DelegationModelError);
    expect(() => planDelegationReconciliation(twice)).toThrow(/paired with two verdicts/);
  });
  it('a census record with no verdict is allowed (it is simply not reasoned about), and pairs are matched by tree, never by position', () => {
    expect(substantive(planDelegationReconciliation(plan({ census: [rec(), rawRec()] })))).toEqual([]);
    const effects = substantive(planDelegationReconciliation(plan({
      census: [rec(), rawRec()],
      correlations: [{ record: rawRec(), verdict: unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]) }, { record: rec(), verdict: linkedV(agentAct, 2) }],
    })));
    expect(effects.map((e) => (e.kind === 'request-linked-lease-identity' ? `${e.kind}:${e.request.adminRecord}` : e.kind === 'record-unowned-worktree' ? `${e.kind}:${e.attempt.adminRecord}` : e.kind)))
      .toEqual([`record-unowned-worktree:${RAW}`, `request-linked-lease-identity:${NAME}`]);
  });
  it('a `now` that is not a canonical UTC millisecond instant throws the model\'s refusal', () => {
    expect(() => planDelegationReconciliation(plan({ now: '2026-10-14 10:00' }))).toThrow(DelegationModelError);
  });
  it('a deeply frozen input is accepted, is not changed, and gives the same answer twice', () => {
    const input = deepFreeze(structuredClone(plan({
      census: [rec(), rawRec(), rawRec({ adminRecord: 'wt-own', canonicalPath: WT('wt-own') })],
      verdicts: [linkedV(agentAct, 2), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), ownedV()],
      recovery: recovery({ leases: [lease({ adminRecord: 'agent-gone', canonicalPath: WT('agent-gone') })] }), previousSuccessfulCensus: [],
    })));
    const copy = structuredClone(input);
    const a = planDelegationReconciliation(input);
    const b = planDelegationReconciliation(input);
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
    expect(kinds(a)).toEqual(['request-linked-lease-identity', 'record-unowned-worktree', 'record-run-child-owned', 'record-measured-absence', 'repair-report-projection']);
  });
  it('effects do not alias the input: editing a returned list changes nothing the input holds', () => {
    const input = one(rec(), linkedV(agentAct, 2));
    const e = planDelegationReconciliation(input)[0]!;
    if (e.kind !== 'request-linked-lease-identity') throw new Error('unreachable');
    (e.request.correlationJournalIds as string[]).push('x');
    expect(input.correlations[0]!.verdict.evidenceJournalIds).not.toContain('x');
  });
  it('the order of the records in the census does not change what is reported about each', () => {
    const rows: [DelegationCensusRecord, DelegationCorrelationVerdict][] = [[rec(), linkedV(agentAct, 2)], [rawRec(), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId])]];
    const fwd = planDelegationReconciliation(plan({ census: rows.map((r) => r[0]), verdicts: rows.map((r) => r[1]) }));
    const rev = planDelegationReconciliation(plan({ census: [...rows].reverse().map((r) => r[0]), verdicts: [...rows].reverse().map((r) => r[1]) }));
    expect(kinds(rev).sort()).toEqual(kinds(fwd).sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 2: the effect census (W3-M53, M62, M63)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The six allowed tags, spelled by an EXHAUSTIVE switch: a seventh member of the union is a compile error here. */
function tagOf(e: DelegationReportEffect): string {
  switch (e.kind) {
    case 'request-linked-lease-identity': return e.kind;
    case 'record-run-child-owned': return e.kind;
    case 'record-measured-absence': return e.kind;
    case 'record-unowned-worktree': return e.kind;
    case 'repair-report-projection': return e.kind;
    case 'record-observation-interval': return e.kind;
  }
}
const EFFECT_TAGS: readonly string[] = [
  'request-linked-lease-identity', 'record-run-child-owned', 'record-measured-absence', 'record-unowned-worktree', 'repair-report-projection', 'record-observation-interval',
];

describe('the effect census: six tags, nothing executable (W3-M53)', () => {
  const everything = (): DelegationReportEffect[] => {
    const outs: DelegationReportEffect[] = [];
    const worlds: PlanOver[] = [
      { census: [rec(), rawRec(), rawRec({ adminRecord: 'wt-own', canonicalPath: WT('wt-own') }), rawRec({ adminRecord: 'wt-c', canonicalPath: WT('wt-c') })],
        verdicts: [linkedV(agentAct, 2), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), ownedV(), conflictingV('rungs-disagree', [agentAct.identityJournalId])],
        recovery: recovery({ leases: [lease({ adminRecord: 'agent-gone', canonicalPath: WT('agent-gone') })] }), previousSuccessfulCensus: [] },
      { registryReadable: false, firstDeadParents: [deadAt(PARENT, MIN), deadAt(OTHER, 2 * MIN)] },
    ];
    for (const w of worlds) outs.push(...planDelegationReconciliation(plan(w)));
    return outs;
  };
  it('every effect any world produces carries one of the six tags, and the world covers five of them', () => {
    const tags = new Set(everything().map(tagOf));
    for (const t of tags) expect(EFFECT_TAGS).toContain(t);
    expect([...tags].sort()).toEqual(['record-measured-absence', 'record-run-child-owned', 'record-unowned-worktree', 'repair-report-projection', 'request-linked-lease-identity']);
  });
  it('the observation interval is a member of the union the policy does not need: intervals are measured by ingestion', () => {
    expect(EFFECT_TAGS).toContain('record-observation-interval');
    expect(everything().map(tagOf)).not.toContain('record-observation-interval');
  });
  it('no effect carries a field that could act: no verb, path to touch, token, UUID, generation, sequence or clock beyond the stated ones', () => {
    const FORBIDDEN = /adopt|retain|promote|dispatch|audit|token|cleanup|carrier|delete|remove|reclaim|leaseId|generation|journalSequence|lineage|uuid/i;
    for (const e of everything()) {
      expect(JSON.stringify(Object.keys(e))).not.toMatch(FORBIDDEN);
      if (e.kind === 'request-linked-lease-identity') expect(JSON.stringify(Object.keys(e.request))).not.toMatch(FORBIDDEN);
    }
  });
  it('rung 1 emits only `record-run-child-owned`; rungs 2, 3 and 4 only `request-linked-lease-identity`; a non-link never requests a lease', () => {
    expect(kinds(substantive(planDelegationReconciliation(one(rec(), ownedV()))))).toEqual(['record-run-child-owned']);
    for (const [r, v] of [[rec(), linkedV(agentAct, 2)], [rawRec(), linkedV(agentAct, 3)], [rawRec(), linkedV(rawAct, 4)]] as const) {
      expect(kinds(substantive(planDelegationReconciliation(one(r, v))))).toEqual(['request-linked-lease-identity']);
    }
    for (const kind of ['unresolved', 'conflicting', 'unmeasured'] as const) {
      for (const reason of DELEGATION_CORRELATION_REASONS) {
        const v = { kind, reason, evidenceJournalIds: [agentAct.identityJournalId] } as DelegationCorrelationVerdict;
        expect(kinds(planDelegationReconciliation(one(rawRec(), v)))).not.toContain('request-linked-lease-identity');
      }
    }
  });
  it('the lease request is identity only: exactly the ten stated fields, none of them a UUID, generation, sequence, transition or token', () => {
    const r = requestOf(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2))))!;
    expect(Object.keys(r).sort()).toEqual([
      'activityId', 'adminRecord', 'canonicalPath', 'correlationJournalIds', 'creationBase', 'firstObservedAt', 'parentId', 'parentIncarnation', 'project', 'sourceKind',
    ]);
    expect(r.firstObservedAt).toBe(NOW);
    expect(r.sourceKind).not.toBe('attached');
  });
  it('the request is not a lease row: it cannot be read as one', () => {
    const r = requestOf(planDelegationReconciliation(one(rec(), linkedV(agentAct, 2))))!;
    for (const k of ['leaseId', 'generation', 'creatingJournalSequence', 'currentJournalSequence', 'disposition', 'cleanupState', 'cleanupPopulation', 'workspaceState', 'parentageState', 'carrierGenerationSeen']) {
      expect(r).not.toHaveProperty(k);
    }
  });
});

describe('the policy module is L1: pure, with no clock, no randomness and no IO (W3-M62, the policy half)', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'delegation-policy.ts');
  const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  it('imports shared types, the pure model and the pure correlation module only', () => {
    const specs = [...code.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
    expect(specs.sort()).toEqual(['./delegation-correlation.js', './delegation-model.js']);
  });
  it('names no filesystem, process, store, clock, randomness or async', () => {
    expect(code).not.toMatch(/node:fs|node:path|node:sqlite|node:crypto|fastify|CoordStore|process\.|readFileSync|writeFileSync|\bDate\.now\b|\bnew Date\(|performance\.now|\brandomUUID\b|\brandomBytes\b|Math\.random|\bsetTimeout\b|\bawait\b|\basync\b/);
  });
  it('returns no UUID and no full lease row: it spells no lease-row field a request must not carry', () => {
    expect(code).not.toMatch(/\bleaseId\b|\bgeneration\b|creatingJournalSequence|currentJournalSequence|\blineageId\b|DelegationLeaseRow\b/);
  });
  it('names no later-wave verb as an effect: adopt, retain, promote, dispatch, audit, cleanup, carrier, token, delete', () => {
    expect(code).not.toMatch(/kind:\s*'(?:adopt|retain|promote|dispatch|audit|cleanup|enqueue|carrier|token|delete|remove|reclaim|release|transfer|pause|suspend)/);
  });
  it('spells every returned effect tag from the closed list and no other `kind:` literal of an effect', () => {
    const emitted = new Set([...code.matchAll(/kind:\s*'([a-z-]+)'/g)].map((m) => m[1]!));
    const VERDICT_KINDS = ['run-child-owned', 'linked', 'unresolved', 'conflicting', 'unmeasured'];    // read in `Extract<...>` types, never emitted
    for (const k of emitted) expect([...EFFECT_TAGS, ...VERDICT_KINDS], k).toContain(k);
    for (const tag of EFFECT_TAGS.filter((t) => t !== 'record-observation-interval')) expect(emitted.has(tag), tag).toBe(true);
  });
  it('reads time only from `input.now`', () => {
    expect(code).not.toMatch(/\bDate\b/);
  });
  it('reads no census fold as evidence: `locked`, `baseAgreesFirstLog`, `headBranch` and `headSha` are never read', () => {
    expect(code).not.toMatch(/\.locked\b|\.baseAgreesFirstLog\b|\.headBranch\b|\.headSha\b|\.diagnostic\b|\.displayName\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 3: the circuit breaker (W3-M54)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('the circuit breaker is a report, never an action (W3-M54)', () => {
  const breaker = (firstDeadParents: DelegationReconciliationInput['firstDeadParents'], registryReadable = true) =>
    delegationCircuitBreaker({ now: NOW, registryReadable, firstDeadParents });
  it('the window is ten minutes', () => {
    expect(DELEGATION_CIRCUIT_BREAKER_WINDOW_MS).toBe(10 * MIN);
  });
  it('no dead parent, or one parent first measured dead inside ten minutes: clear', () => {
    expect(breaker([])).toBe('clear');
    expect(breaker([deadAt(PARENT, MIN)])).toBe('clear');
  });
  it('two parents first measured dead inside ten minutes: suspended', () => {
    expect(breaker([deadAt(PARENT, MIN), deadAt(OTHER, 9 * MIN)])).toBe('suspended');
  });
  it('three, or two at the very edge of the window (exactly ten minutes counts as inside): suspended', () => {
    expect(breaker([deadAt(PARENT, MIN), deadAt(OTHER, 2 * MIN), deadAt('lane-c-demo', 3 * MIN)])).toBe('suspended');
    expect(breaker([deadAt(PARENT, 10 * MIN), deadAt(OTHER, 10 * MIN)])).toBe('suspended');
  });
  it('a death OUTSIDE the window is old news: one fresh and one old is clear; two old is clear', () => {
    expect(breaker([deadAt(PARENT, MIN), deadAt(OTHER, 10 * MIN + 1)])).toBe('clear');
    expect(breaker([deadAt(PARENT, 11 * MIN), deadAt(OTHER, 3600 * 1000)])).toBe('clear');
  });
  it('one parent listed twice is one parent', () => {
    expect(breaker([deadAt(PARENT, MIN), deadAt(PARENT, 2 * MIN)])).toBe('clear');
  });
  it('a first-dead instant later than `now` (clock skew) counts as inside the window, the safe direction', () => {
    expect(breaker([deadAt(PARENT, -MIN), deadAt(OTHER, MIN)])).toBe('suspended');
  });
  it('a first-dead instant more than one window AHEAD of `now` is clock skew: unmeasured, not a death (exactly one window ahead still counts)', () => {
    expect(breaker([deadAt(PARENT, -10 * MIN - 1)])).toBe('unmeasured');
    expect(breaker([deadAt(PARENT, -10 * MIN), deadAt(OTHER, -10 * MIN)])).toBe('suspended');
    expect(breaker([deadAt(PARENT, MIN), deadAt(OTHER, -11 * MIN)])).toBe('unmeasured');
  });
  it('an unreadable registry: suspended, however few parents are dead', () => {
    expect(breaker([], false)).toBe('suspended');
    expect(breaker([deadAt(PARENT, 20 * MIN)], false)).toBe('suspended');
  });
  it('an instant the breaker cannot read is unmeasured unless two fresh deaths already suspend it', () => {
    const bad = { parentId: OTHER, firstMeasuredDeadAt: 'yesterday' };
    expect(breaker([bad])).toBe('unmeasured');
    expect(breaker([deadAt(PARENT, MIN), bad])).toBe('unmeasured');
    expect(breaker([deadAt(PARENT, MIN), deadAt('lane-c-demo', MIN), bad])).toBe('suspended');
    expect(breaker([bad], false)).toBe('suspended');
  });
  it('it answers one of three words and nothing else: no action, no list, no object', () => {
    for (const out of [breaker([]), breaker([deadAt(PARENT, MIN), deadAt(OTHER, MIN)]), breaker([], false)]) {
      expect(['clear', 'suspended', 'unmeasured']).toContain(out);
      expect(typeof out).toBe('string');
    }
  });
  it('a suspended pass emits the SAME closed effect list and only withholds ownership claims; nothing new appears', () => {
    const world = {
      census: [rec(), rawRec(), rawRec({ adminRecord: 'wt-own', canonicalPath: WT('wt-own') })],
      verdicts: [linkedV(agentAct, 2), unresolvedV('ambiguous-subagent-path', [agentAct.identityJournalId]), ownedV()],
    };
    const clear = planDelegationReconciliation(plan(world));
    for (const dead of [[deadAt(PARENT, MIN), deadAt(OTHER, MIN)], [deadAt(PARENT, MIN), { parentId: OTHER, firstMeasuredDeadAt: 'bad' }]]) {
      const held = planDelegationReconciliation(plan({ ...world, firstDeadParents: dead }));
      expect(kinds(held)).toEqual(['record-run-child-owned', 'repair-report-projection']);
      for (const e of held) expect(clear).toContainEqual(e);                    // a subset of what a clear pass emits: it adds nothing
    }
  });
  it('fresh deaths inside the window withhold lease requests and unowned reports; old deaths and a single death do not', () => {
    const world = { census: [rec()], verdicts: [linkedV(agentAct, 2)] };
    expect(kinds(substantive(planDelegationReconciliation(plan({ ...world, firstDeadParents: [deadAt(PARENT, MIN)] }))))).toEqual(['request-linked-lease-identity']);
    expect(kinds(substantive(planDelegationReconciliation(plan({ ...world, firstDeadParents: [deadAt(PARENT, 11 * MIN), deadAt(OTHER, 12 * MIN)] }))))).toEqual(['request-linked-lease-identity']);
    expect(substantive(planDelegationReconciliation(plan({ ...world, firstDeadParents: [deadAt(PARENT, MIN), deadAt(OTHER, 2 * MIN)] })))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the words this file spells, for the coordination scanner
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('the kebab guard declares the words policy spells', () => {
  it('admits the effect tags, every correlation reason it classifies and the verdict kind it reads', () => {
    for (const w of EFFECT_TAGS) expect(isDelegationPolicyKebab(w)).toBe(true);
    for (const w of DELEGATION_CORRELATION_REASONS) expect(isDelegationPolicyKebab(w)).toBe(true);
    expect(isDelegationPolicyKebab('run-child-owned')).toBe(true);
  });
  it('admits no word of the model or correlation vocabularies the policy does not spell (journal kinds, hold reasons, source kinds, cleanup states)', () => {
    for (const w of ['evidence-accepted', 'lease-created', 'checkpoint-anchor', 'open-lease', 'bash-worktree', 'not-due', 'torn-tail']) expect(isDelegationPolicyKebab(w), w).toBe(false);
    expect(isDelegationPolicyKebab('bad-row')).toBe(true);
  });
  it('does not admit an arbitrary kebab word or a near-miss of a tag', () => {
    for (const w of ['adopt-lease', 'request-linked-lease', 'record-measured-absent', 'cleanup-lease', 'not-a-delegation-word', '']) expect(isDelegationPolicyKebab(w)).toBe(false);
  });
  it('every kebab literal in the policy source is admitted by the guard', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'delegation-policy.ts');
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    const words = new Set([...code.matchAll(/['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"]/g)].map((m) => m[1]!));
    expect(words.size).toBeGreaterThan(6);
    for (const w of words) expect(isDelegationPolicyKebab(w), w).toBe(true);
  });
});
